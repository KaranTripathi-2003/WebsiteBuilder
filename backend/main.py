import os
import json
import re
import uuid
import hashlib
from datetime import datetime
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError
from groq import Groq
from dotenv import load_dotenv
import httpx

load_dotenv()

# ── Optional MongoDB ───────────────────────────────────────────────────────
try:
    from motor.motor_asyncio import AsyncIOMotorClient
    MONGO_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
    mongo_client = AsyncIOMotorClient(MONGO_URL)
    db = mongo_client["webweave"]
    users_col    = db["users"]
    sessions_col = db["sessions"]
    projects_col = db["projects"]
    MONGO_ENABLED = True
except Exception:
    MONGO_ENABLED = False

# ── Optional Langfuse tracing ──────────────────────────────────────────────
try:
    from langfuse import Langfuse
    langfuse = Langfuse(
        public_key=os.getenv("LANGFUSE_PUBLIC_KEY", ""),
        secret_key=os.getenv("LANGFUSE_SECRET_KEY", ""),
        host=os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com"),
    )
    LANGFUSE_ENABLED = bool(os.getenv("LANGFUSE_PUBLIC_KEY"))
except Exception:
    LANGFUSE_ENABLED = False

# ── App setup ──────────────────────────────────────────────────────────────
app = FastAPI(title="WebWeave AI – Website Builder API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
JWT_SECRET = os.getenv("JWT_SECRET", "webweave-secret-change-in-production")


# ── Pydantic models ────────────────────────────────────────────────────────
class GenerateRequest(BaseModel):
    message: str
    previous_html: Optional[str] = ""
    previous_css:  Optional[str] = ""
    previous_js:   Optional[str] = ""
    is_refinement: bool = False
    project_id:    Optional[str] = None

class SiteOutput(BaseModel):
    title: str
    html:  str
    css:   str
    js:    str

class RegisterRequest(BaseModel):
    name:     str
    email:    str
    password: str

class LoginRequest(BaseModel):
    email:    str
    password: str

class GoogleAuthRequest(BaseModel):
    token: str

class SaveProjectRequest(BaseModel):
    project_id: Optional[str] = None
    title:  str
    prompt: str
    html:   str
    css:    str
    js:     str
    messages: Optional[list] = []


# ── Auth helpers ───────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return hashlib.sha256((password + JWT_SECRET).encode()).hexdigest()

def create_session_token(seed: str) -> str:
    payload = f"{seed}:{datetime.utcnow().isoformat()}:{uuid.uuid4()}"
    return hashlib.sha256(payload.encode()).hexdigest()

async def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    if MONGO_ENABLED:
        session = await sessions_col.find_one({"token": token})
        if not session:
            raise HTTPException(status_code=401, detail="Invalid or expired session")
        user = await users_col.find_one({"_id": session["user_id"]})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    # Demo mode (no MongoDB) — accept any token
    return {"_id": "demo", "name": "Demo User", "email": "demo@webweave.ai", "avatar": ""}


# ── Auth routes ────────────────────────────────────────────────────────────
@app.post("/auth/register")
async def register(req: RegisterRequest):
    if MONGO_ENABLED:
        existing = await users_col.find_one({"email": req.email})
        if existing:
            raise HTTPException(status_code=400, detail="Email already registered")
        user_id = str(uuid.uuid4())
        avatar  = f"https://api.dicebear.com/7.x/initials/svg?seed={req.name}&backgroundColor=4F46E5&textColor=ffffff"
        user = {
            "_id":           user_id,
            "name":          req.name,
            "email":         req.email,
            "password_hash": hash_password(req.password),
            "provider":      "email",
            "avatar":        avatar,
            "created_at":    datetime.utcnow().isoformat(),
        }
        await users_col.insert_one(user)
        token = create_session_token(user_id)
        await sessions_col.insert_one({"token": token, "user_id": user_id, "created_at": datetime.utcnow().isoformat()})
        return {"token": token, "user": {"id": user_id, "name": req.name, "email": req.email, "avatar": avatar}}
    else:
        token  = create_session_token(req.email)
        avatar = f"https://api.dicebear.com/7.x/initials/svg?seed={req.name}&backgroundColor=4F46E5&textColor=ffffff"
        return {"token": token, "user": {"id": "demo", "name": req.name, "email": req.email, "avatar": avatar}}

@app.post("/auth/login")
async def login(req: LoginRequest):
    if MONGO_ENABLED:
        user = await users_col.find_one({"email": req.email})
        if not user or user.get("password_hash") != hash_password(req.password):
            raise HTTPException(status_code=401, detail="Invalid email or password")
        token = create_session_token(user["_id"])
        await sessions_col.insert_one({"token": token, "user_id": user["_id"], "created_at": datetime.utcnow().isoformat()})
        return {"token": token, "user": {"id": user["_id"], "name": user["name"], "email": user["email"], "avatar": user.get("avatar", "")}}
    else:
        token = create_session_token(req.email)
        return {"token": token, "user": {"id": "demo", "name": "Demo User", "email": req.email, "avatar": ""}}

@app.post("/auth/google")
async def google_auth(req: GoogleAuthRequest):
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"https://oauth2.googleapis.com/tokeninfo?id_token={req.token}")
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid Google token")
        payload = resp.json()
        if GOOGLE_CLIENT_ID and payload.get("aud") != GOOGLE_CLIENT_ID:
            raise HTTPException(status_code=401, detail="Token audience mismatch")
        email     = payload["email"]
        name      = payload.get("name", email.split("@")[0])
        avatar    = payload.get("picture", "")
        google_id = payload["sub"]

        if MONGO_ENABLED:
            user = await users_col.find_one({"email": email})
            if not user:
                user_id = str(uuid.uuid4())
                user = {"_id": user_id, "name": name, "email": email,
                        "google_id": google_id, "provider": "google",
                        "avatar": avatar, "created_at": datetime.utcnow().isoformat()}
                await users_col.insert_one(user)
            else:
                user_id = user["_id"]
                await users_col.update_one({"_id": user_id}, {"$set": {"avatar": avatar, "google_id": google_id}})
            token = create_session_token(user_id)
            await sessions_col.insert_one({"token": token, "user_id": user_id, "created_at": datetime.utcnow().isoformat()})
            return {"token": token, "user": {"id": user_id, "name": name, "email": email, "avatar": avatar}}
        else:
            token = create_session_token(email)
            return {"token": token, "user": {"id": google_id, "name": name, "email": email, "avatar": avatar}}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Google auth failed: {str(e)}")

@app.post("/auth/logout")
async def logout(user=Depends(get_current_user), authorization: Optional[str] = Header(None)):
    if MONGO_ENABLED and authorization:
        token = authorization.split(" ", 1)[1]
        await sessions_col.delete_one({"token": token})
    return {"ok": True}

@app.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return {"id": user["_id"], "name": user["name"], "email": user["email"], "avatar": user.get("avatar", "")}


# ── Project / history routes ───────────────────────────────────────────────
@app.get("/projects")
async def list_projects(user=Depends(get_current_user)):
    if not MONGO_ENABLED:
        return []
    cursor = projects_col.find(
        {"user_id": user["_id"]},
        {"html": 0, "css": 0, "js": 0}
    ).sort("updated_at", -1)
    projects = []
    async for p in cursor:
        p["id"] = p.pop("_id")
        projects.append(p)
    return projects

@app.get("/projects/{project_id}")
async def get_project(project_id: str, user=Depends(get_current_user)):
    if not MONGO_ENABLED:
        raise HTTPException(status_code=404, detail="MongoDB not enabled")
    p = await projects_col.find_one({"_id": project_id, "user_id": user["_id"]})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    p["id"] = p.pop("_id")
    return p

@app.post("/projects")
async def save_project(req: SaveProjectRequest, user=Depends(get_current_user)):
    if not MONGO_ENABLED:
        return {"id": str(uuid.uuid4())}
    project_id = req.project_id or str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    await projects_col.update_one(
        {"_id": project_id, "user_id": user["_id"]},
        {"$set": {
            "_id":        project_id,
            "user_id":    user["_id"],
            "title":      req.title,
            "prompt":     req.prompt,
            "html":       req.html,
            "css":        req.css,
            "js":         req.js,
            "messages":   req.messages,
            "updated_at": now,
        }, "$setOnInsert": {"created_at": now}},
        upsert=True
    )
    return {"id": project_id}

@app.delete("/projects/{project_id}")
async def delete_project(project_id: str, user=Depends(get_current_user)):
    if not MONGO_ENABLED:
        return {"ok": True}
    await projects_col.delete_one({"_id": project_id, "user_id": user["_id"]})
    return {"ok": True}


# ── Prompts ────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are an expert UI/UX Designer. Generate a stunning, fully responsive website.
OUTPUT FORMAT: ONLY valid JSON, no markdown: { "title": "...", "html": "...", "css": "...", "js": "..." }
- html: body inner content only. Use Tailwind CSS for ALL styling. Include sticky navbar, hero, services, testimonials, contact, footer.
- css: Minimal custom CSS only. No Tailwind duplicates.
- js: Vanilla JS for smooth scrolling, mobile nav, scroll-reveal.
- images: Use real Unsplash URLs (e.g. https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&q=80). Never use placeholders."""

REFINEMENT_PREFIX = """You are refining an existing website. Keep all existing content, images, animations, and structure.
Only modify exactly what the user requests. Do not regenerate from scratch.

CURRENT SITE CODE:
HTML: {html}
CSS: {css}
JS: {js}

USER REQUEST FOR CHANGES:
"""

# ── Helper: extract JSON ───────────────────────────────────────────────────
def extract_json(text: str) -> dict:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    cleaned = re.sub(r"```(?:json)?", "", text).strip().strip("`").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    match = re.search(r'\{[\s\S]*\}', cleaned)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    raise ValueError("Could not parse JSON from LLM response")


# ── Route: streaming generate (authenticated) ──────────────────────────────
@app.post("/generate/stream")
async def generate_site_stream(req: GenerateRequest, user=Depends(get_current_user)):
    if not os.getenv("GROQ_API_KEY"):
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not set")

    if req.is_refinement and req.previous_html:
        user_msg = REFINEMENT_PREFIX.format(
            html=req.previous_html[:6000],
            css=(req.previous_css or "")[:3000],
            js=(req.previous_js or "")[:2000],
        ) + req.message
    else:
        user_msg = f"Build a complete professional website: {req.message}"

    trace = None
    if LANGFUSE_ENABLED:
        try:
            trace = langfuse.trace(name="website-generation-stream", input={"message": req.message})
        except Exception:
            pass

    async def event_stream():
        full_text = ""
        try:
            stream = groq_client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user",   "content": user_msg},
                ],
                temperature=0.7,
                max_tokens=2500,
                response_format={"type": "json_object"},
                stream=True,
            )
            for chunk in stream:
                delta = chunk.choices[0].delta.content or ""
                full_text += delta
                yield f"data: {json.dumps({'type': 'chunk', 'text': delta})}\n\n"

            try:
                data = extract_json(full_text)
                site = SiteOutput(**data)
                if trace:
                    try: trace.update(output={"title": site.title})
                    except Exception: pass
                # Auto-save project if MongoDB is enabled
                if MONGO_ENABLED and req.project_id:
                    now = datetime.utcnow().isoformat()
                    await projects_col.update_one(
                        {"_id": req.project_id, "user_id": user["_id"]},
                        {"$set": {"html": site.html, "css": site.css, "js": site.js,
                                  "title": site.title, "updated_at": now},
                         "$setOnInsert": {"created_at": now, "prompt": req.message,
                                          "user_id": user["_id"], "_id": req.project_id}},
                        upsert=True
                    )
                yield f"data: {json.dumps({'type': 'done', 'site': site.model_dump()})}\n\n"
            except (ValueError, ValidationError) as e:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Route: non-streaming generate (authenticated) ──────────────────────────
@app.post("/generate", response_model=SiteOutput)
async def generate_site(req: GenerateRequest, user=Depends(get_current_user)):
    if not os.getenv("GROQ_API_KEY"):
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not set")
    if req.is_refinement and req.previous_html:
        user_msg = REFINEMENT_PREFIX.format(
            html=req.previous_html[:6000], css=(req.previous_css or "")[:3000], js=(req.previous_js or "")[:2000],
        ) + req.message
    else:
        user_msg = f"Build a complete professional website: {req.message}"
    try:
        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": user_msg},
            ],
            temperature=0.7,
            max_tokens=2500,
            response_format={"type": "json_object"},
        )
        raw = completion.choices[0].message.content
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Groq API error: {str(e)}")
    try:
        data = extract_json(raw)
        return SiteOutput(**data)
    except (ValueError, ValidationError) as e:
        raise HTTPException(status_code=422, detail=f"LLM returned invalid output: {str(e)}")


# ── Health check ───────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "groq_key_set": bool(os.getenv("GROQ_API_KEY")), "mongo": MONGO_ENABLED}