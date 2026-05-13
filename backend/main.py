import os
import json
import re
import uuid
import hashlib
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError, Field
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
LANGFUSE_ENABLED = False
langfuse = None

try:
    from langfuse import Langfuse
    _lf_pub = os.getenv("LANGFUSE_PUBLIC_KEY", "").strip()
    _lf_sec = os.getenv("LANGFUSE_SECRET_KEY", "").strip()
    if _lf_pub and _lf_sec:
        langfuse = Langfuse(
            public_key=_lf_pub,
            secret_key=_lf_sec,
            host=os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com"),
        )
        LANGFUSE_ENABLED = True
        print("✅ Langfuse tracing ENABLED")
    else:
        print("ℹ️  Langfuse keys not set — tracing DISABLED")
except ImportError:
    print("ℹ️  langfuse package not installed — tracing DISABLED")
except Exception as e:
    print(f"⚠️  Langfuse init failed ({e}) — tracing DISABLED")

# ── App setup ──────────────────────────────────────────────────────────────
app = FastAPI(title="WebWeave AI – Website Builder API")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://.*\.vercel\.app|http://localhost:3000|http://127.0.0.1:3000",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"), timeout=120.0)  # increased timeout
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
JWT_SECRET = os.getenv("JWT_SECRET", "webweave-secret-change-in-production")

# ── Model selection ────────────────────────────────────────────────────────
# openai/gpt-oss-120b → 120B params, 128k context — ELITE quality on Groq
# Fallback: llama-3.3-70b-versatile → flagship stability
TEXT_MODEL     = "openai/gpt-oss-120b"
FALLBACK_MODEL = "llama-3.3-70b-versatile"
VISION_MODEL   = "openai/gpt-oss-120b"
MAX_TOKENS     = 6000
MAX_INPUT_CHARS = 10000 # 120B can handle more context


# ── Pydantic models ────────────────────────────────────────────────────────
class GenerateRequest(BaseModel):
    message:       str
    image:         Optional[str] = None
    previous_html: Optional[str] = ""
    previous_css:  Optional[str] = ""
    previous_js:   Optional[str] = ""
    is_refinement: bool = False
    project_id:    Optional[str] = None

class SiteOutput(BaseModel):
    title: str = Field(default="Untitled Site")
    html:  str = Field(default="")
    css:   str = Field(default="")
    js:    str = Field(default="")

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
    title:      str
    prompt:     str
    html:       str
    css:        str
    js:         str
    messages:   Optional[list] = []


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
                user = {
                    "_id": user_id, "name": name, "email": email,
                    "google_id": google_id, "provider": "google",
                    "avatar": avatar, "created_at": datetime.utcnow().isoformat(),
                }
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


# ── Project routes ─────────────────────────────────────────────────────────
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
            "_id": project_id, "user_id": user["_id"],
            "title": req.title, "prompt": req.prompt,
            "html": req.html, "css": req.css, "js": req.js,
            "messages": req.messages, "updated_at": now,
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


# ── System Prompts ─────────────────────────────────────────────────────────
SYSTEM_PROMPT = """Elite Site Builder. Output ONLY JSON: {"title":"","html":"","css":"","js":""}
- Use \\n for newlines in strings. No literal newlines.
- 3 Core Pages (Home, About, Services). Contact in footer.
- High-end Tailwind, Emerald theme, AOS animations.
- Content: Use the provided enterprise copy accurately.
HTML Requirements:
- 4 pages (Home, About, Services, Contact) using <section id="ID" class="page">
- Multi-page navigation using <a href="#" data-target="ID">
- Professional Tailwind CSS design, emerald accent (#00ad6a).
- Images: https://loremflickr.com/WIDTH/HEIGHT/KEYWORD
- Interactivity: Alpine.js (v3).
- Every navigating button MUST have data-target="PAGE_ID".
- The universal nav engine is injected by the wrapper - do NOT write nav JS.

DESIGN SYSTEM:
- Fonts: "DM Sans" body, "Playfair Display" hero headings (both loaded by wrapper)
- Colors: headings #0a0a0a, body #111, white bg, accent #00ad6a (emerald)
- Hero h1: 56-72px bold | Section h2: 36-42px | Body: 16-18px line-height 1.7
- Cards: white bg, shadow(0 2px 20px rgba(0,0,0,0.08)), rounded-2xl, good padding
- Navbar: Sticky (top-0), glassmorphism (bg-white/80 backdrop-blur-md), border-b.
- CRITICAL: Ensure all content sections have `pt-24` or similar padding to avoid being hidden behind the sticky navbar.
- Primary btn: bg-[#00ad6a] text-white rounded-full px-8 py-3.5 font-semibold
- Ghost btn: transparent border rounded-full px-8 py-3.5
- Tailwind CDN + AOS + Alpine.js loaded by wrapper. Use freely.
- Animate with data-aos="fade-up" on sections, data-aos="zoom-in" on images

MANDATORY COMPONENTS:
- NAVBAR: A sticky <nav> with links/buttons for all sections.
- NAV LINKS: MUST use <a href="#" data-target="SECTION_ID">...</a>.
- SECTIONS: Use <section id="SECTION_ID" class="page">.

IMAGES (STRICT RULE - No placeholders, NO EXTRA QUOTES):
- Format: <img src="https://loremflickr.com/1600/900/gym-equipment" class="...">
- CRITICAL: Do NOT use single quotes inside double quotes for src (e.g., NOT src="'https...'").
- Rule: Replace 1600/900 with your dimensions and gym-equipment with your keywords.
- Anti-Repetition: Vary width by 1px (1600, 1601, 1602) to bypass cache.
- Fallback: https://picsum.photos/1600/900?random=1 if relevance fails.
- Hero: 1600x900 | About: 1000x600 | Services/Features: 800x600
- CRITICAL: Images MUST be sharp. Use `class="w-full h-full object-cover rounded-2xl shadow-xl block"`
- CSS Rule: `img { image-rendering: -webkit-optimize-contrast; }`
- NEVER use generic keywords like "image" or "photo"

CONTENT:
- Real professional copy - ZERO Lorem Ipsum, ZERO placeholders
- Adapt everything to the specific business type described
- Include realistic stats, testimonials, team bios, service details
- Footer on every page: logo, quick links, copyright, social icons

JS FIELD: site-specific logic only (counters, form validation, carousels).
Do NOT include navigation logic - handled by wrapper."""

REFINEMENT_SYSTEM = """You are refining an existing multi-page website. Rules:
1. Preserve ALL existing pages, nav structure, and page IDs exactly.
2. Only modify what the user explicitly requested.
3. Return complete JSON with all four keys — never truncate.
4. Never break data-target ↔ section id matching.
Output: valid JSON only. Keys: title, html, css, js."""

IMAGE_NOTE = "User uploaded an image. Analyze it: if it's a logo use it in the navbar; if a product/service place it in the relevant section; if a reference design match its colors and aesthetic.\n\n"


# ── Input sanitizer ────────────────────────────────────────────────────────
def sanitize_and_trim_message(message: str, max_chars: int = MAX_INPUT_CHARS) -> str:
    """
    Clean up and trim large user messages so they fit within model context.
    Removes excessive whitespace/newlines and truncates gracefully at a sentence boundary.
    """
    # Collapse multiple blank lines into one
    message = re.sub(r'\n{3,}', '\n\n', message)
    # Collapse multiple spaces
    message = re.sub(r'  +', ' ', message)
    message = message.strip()

    if len(message) <= max_chars:
        return message

    # Trim to max_chars at the last sentence/paragraph boundary
    truncated = message[:max_chars]
    # Try to cut at last newline
    last_newline = truncated.rfind('\n')
    last_period  = truncated.rfind('. ')
    cut_at = max(last_newline, last_period)
    if cut_at > max_chars * 0.7:
        truncated = truncated[:cut_at]

    truncated += "\n\n[Content trimmed for processing. Use the above content to build the full website.]"
    return truncated


# ── Helpers ────────────────────────────────────────────────────────────────
def extract_json(text: str) -> dict:
    """Try multiple strategies to parse JSON from LLM output."""
    text = text.strip()

    # Remove markdown code fences
    text = re.sub(r"```(?:json)?", "", text).strip().strip("`").strip()

    # Find the outermost { ... } block
    first_brace = text.find('{')
    last_brace  = text.rfind('}')
    if first_brace != -1 and last_brace != -1:
        text = text[first_brace:last_brace + 1]

    # Pre-cleaning: escape literal newlines inside strings
    def escape_internal_newlines(m):
        return m.group(0).replace('\n', '\\n')
    text = re.sub(r'":\s*"([\s\S]*?)"(?=\s*[,}])', escape_internal_newlines, text)

    # Attempt 1: direct parse
    try:
        data = json.loads(text)
        # Post-clean: strip accidental quotes from URLs (fixes the %22 / 404 bug)
        if isinstance(data, dict) and "html" in data:
            data["html"] = re.sub(r'src=["\'][\'"](https?://[^"\']+)[\'"]["\']', r'src="\1"', data["html"])
        return data
    except json.JSONDecodeError:
        pass

    # Attempt 2: salvage truncated JSON
    try:
        depth   = 0
        in_str  = False
        escape  = False
        for ch in text:
            if escape:
                escape = False
                continue
            if ch == '\\' and in_str:
                escape = True
                continue
            if ch == '"' and not escape:
                in_str = not in_str
                continue
            if not in_str:
                if ch == '{':
                    depth += 1
                elif ch == '}':
                    depth -= 1
        if depth > 0:
            tail = text.rstrip()
            if tail and tail[-1] not in ('"', '}', ']'):
                tail += '"'
            tail += '}' * depth
            return json.loads(tail)
    except Exception:
        pass

    # Attempt 3: regex field extraction fallback
    result = {}
    for field in ["title", "html", "css", "js"]:
        pattern = rf'["\']?{field}["\']?\s*:\s*["\']((?:[^"\'\\]|\\.)*)(?:["\']|$)'
        m = re.search(pattern, text, re.DOTALL)
        if m:
            raw_val = m.group(1)
            try:
                result[field] = json.loads(f'"{raw_val}"')
            except Exception:
                result[field] = raw_val.replace('\\"', '"').replace("\\'", "'")

    if result.get("html") or result.get("title"):
        for field in ["title", "html", "css", "js"]:
            result.setdefault(field, "")
        return result

    # Final cleanup: remove trailing commas
    cleaned = re.sub(r",\s*([\]}])", r"\1", text)
    for suffix in ['"}', '}', '"]}', '"}}}']:
        try:
            return json.loads(cleaned + suffix)
        except Exception:
            continue

    raise ValueError(f"Could not parse JSON from LLM output. First 300 chars: {text[:300]}")


def normalize_site_fields(data: dict) -> dict:
    for k in ["title", "html", "css", "js"]:
        if not isinstance(data.get(k), str) or data[k] is None:
            data[k] = "" if k != "title" else "Untitled Site"
    return data


def trim_for_refinement(html: str, css: str, js: str):
    """Keep existing code context lean so input + output stays within token budget."""
    return html[:5000], css[:1500], js[:1500]


def safe_langfuse_trace(**kwargs):
    if not LANGFUSE_ENABLED or not langfuse:
        return None
    try:
        return langfuse.trace(**kwargs)
    except Exception:
        return None


def safe_langfuse_update(trace, **kwargs):
    if trace is None:
        return
    try:
        trace.update(**kwargs)
    except Exception:
        pass


def build_messages_payload(system: str, user_content, model_name: str, use_vision: bool, image: str = None) -> list:
    """Build the messages array for the Groq API call."""
    strict_json_suffix = (
        "\n\nSTRICT JSON RULE:\n"
        "- Respond with ONLY the JSON object.\n"
        "- NO conversational text before or after.\n"
        "- NO markdown backticks.\n"
        "- Start your response with { and end with }."
    )
    if use_vision and "llama" in model_name:
        msg_content = [
            {"type": "text",      "text": user_content},
            {"type": "image_url", "image_url": {"url": image}},
        ]
    else:
        msg_content = user_content

    return [
        {"role": "system", "content": system + strict_json_suffix},
        {"role": "user",   "content": msg_content},
    ]


async def call_groq_with_fallback(kwargs: dict, use_vision: bool, stream: bool = False):
    """
    Try TEXT_MODEL first; if it fails (rate limit, model error), fall back to FALLBACK_MODEL.
    """
    models_to_try = [TEXT_MODEL, FALLBACK_MODEL]

    for model in models_to_try:
        try:
            kwargs["model"] = model
            # json_object response_format support check
            if not use_vision and model in ("openai/gpt-oss-120b", "llama-3.3-70b-versatile"):
                kwargs["response_format"] = {"type": "json_object"}

            result = groq_client.chat.completions.create(**kwargs)
            return result, model
        except Exception as e:
            err_str = str(e).lower()
            # If it's a hard error (auth, bad request), don't retry
            if "401" in err_str or "invalid_api_key" in err_str:
                raise
            print(f"⚠️  Model {model} failed: {e}. Trying next model...")
            continue

    raise Exception(f"All models failed. Last error on {FALLBACK_MODEL}.")


# ── Streaming generate endpoint ────────────────────────────────────────────
@app.post("/generate/stream")
async def generate_site_stream(req: GenerateRequest, user=Depends(get_current_user)):
    if not os.getenv("GROQ_API_KEY"):
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not set")

    use_vision = bool(req.image)
    model_name = VISION_MODEL if use_vision else TEXT_MODEL

    # Build user content
    if req.is_refinement:
        h, c, j = trim_for_refinement(
            req.previous_html or "", req.previous_css or "", req.previous_js or ""
        )
        system       = REFINEMENT_SYSTEM
        user_content = (
            f"CURRENT HTML:\n{h}\n\nCURRENT CSS:\n{c}\n\nCURRENT JS:\n{j}\n\n"
            f"REQUESTED CHANGES:\n{sanitize_and_trim_message(req.message, 2000)}"
        )
    else:
        system       = SYSTEM_PROMPT
        # ⬇️ KEY FIX: sanitize and trim large input messages
        clean_message = sanitize_and_trim_message(req.message)
        user_content  = f"Build a complete professional multi-page website for:\n\n{clean_message}"

    if req.image:
        user_content = IMAGE_NOTE + user_content

    messages_payload = build_messages_payload(
        system, user_content, model_name, use_vision, req.image
    )

    trace = safe_langfuse_trace(
        name="webweave-stream",
        input={"message": req.message[:500], "model": model_name, "refinement": req.is_refinement},
        metadata={"user_id": str(user.get("_id", ""))},
    )

    async def event_stream():
        full_text = ""
        try:
            kwargs = {
                "model":       model_name,
                "messages":    messages_payload,
                "temperature": 0.1,
                "max_tokens":  MAX_TOKENS,
                "stream":      True,
            }
            if not use_vision:
                kwargs["response_format"] = {"type": "json_object"}

            # Try primary model, fall back if needed (streaming version)
            models_to_try = [model_name] if use_vision else [TEXT_MODEL, FALLBACK_MODEL]
            stream_obj    = None
            used_model    = model_name

            for mdl in models_to_try:
                try:
                    kwargs["model"] = mdl
                    if not use_vision:
                        kwargs["response_format"] = {"type": "json_object"}
                    stream_obj = groq_client.chat.completions.create(**kwargs)
                    used_model = mdl
                    break
                except Exception as e:
                    err_str = str(e).lower()
                    if "401" in err_str or "invalid_api_key" in err_str:
                        raise
                    print(f"⚠️  Stream model {mdl} failed: {e}. Trying fallback...")
                    # Remove json_object for fallback if not supported
                    kwargs.pop("response_format", None)
                    continue

            if stream_obj is None:
                yield f"data: {json.dumps({'type': 'error', 'message': 'All models failed to start stream'})}\n\n"
                return

            print(f"✅ Using model: {used_model}")

            for chunk in stream_obj:
                delta = chunk.choices[0].delta.content or ""
                full_text += delta
                yield f"data: {json.dumps({'type': 'chunk', 'text': delta})}\n\n"

            # ── Parse final result ─────────────────────────────────────────
            try:
                data = extract_json(full_text)
                data = normalize_site_fields(data)
                site = SiteOutput(**data)

                safe_langfuse_update(trace, output={"title": site.title}, level="DEFAULT")

                if MONGO_ENABLED and req.project_id:
                    now = datetime.utcnow().isoformat()
                    await projects_col.update_one(
                        {"_id": req.project_id, "user_id": user["_id"]},
                        {"$set": {
                            "html": site.html, "css": site.css, "js": site.js,
                            "title": site.title, "updated_at": now,
                        }, "$setOnInsert": {
                            "created_at": now, "prompt": req.message,
                            "user_id": user["_id"], "_id": req.project_id,
                        }},
                        upsert=True,
                    )

                yield f"data: {json.dumps({'type': 'done', 'site': site.model_dump()})}\n\n"

            except (ValueError, ValidationError) as e:
                # Save the failed output for inspection
                with open("failed_generation.txt", "w", encoding="utf-8") as f:
                    f.write(full_text)
                safe_langfuse_update(trace, level="WARNING", status_message=f"Parse failed, retrying: {e}")
                try:
                    retry_completion = groq_client.chat.completions.create(
                        model=FALLBACK_MODEL,
                        messages=[
                            {
                                "role": "system",
                                "content": (
                                    "You are a JSON repair assistant. "
                                    "Output ONLY valid JSON with keys: title, html, css, js. "
                                    "No markdown, no explanation."
                                ),
                            },
                            {
                                "role": "user",
                                "content": (
                                    f"The following JSON was truncated or malformed. "
                                    f"Complete and return it as valid JSON:\n\n{full_text[-2000:]}"
                                ),
                            },
                        ],
                        temperature=0,
                        max_tokens=MAX_TOKENS,
                        response_format={"type": "json_object"},
                    )
                    retry_raw  = retry_completion.choices[0].message.content
                    retry_data = extract_json(retry_raw)
                    retry_data = normalize_site_fields(retry_data)
                    site       = SiteOutput(**retry_data)

                    safe_langfuse_update(trace, output={"title": site.title, "retried": True}, level="DEFAULT")
                    yield f"data: {json.dumps({'type': 'done', 'site': site.model_dump()})}\n\n"

                except Exception as retry_err:
                    with open("failed_generation.txt", "a", encoding="utf-8") as f:
                        f.write(f"\n\nRETRY FAILED: {retry_err}")
                    safe_langfuse_update(trace, level="ERROR", status_message=str(retry_err))
                    yield f"data: {json.dumps({'type': 'error', 'message': f'JSON parse failed. Check failed_generation.txt for the raw output. Reason: {retry_err}'})}\n\n"

        except Exception as e:
            safe_langfuse_update(trace, level="ERROR", status_message=str(e))
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Non-streaming generate endpoint ───────────────────────────────────────
@app.post("/generate", response_model=SiteOutput)
async def generate_site(req: GenerateRequest, user=Depends(get_current_user)):
    if not os.getenv("GROQ_API_KEY"):
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not set")

    use_vision = bool(req.image)
    model_name = VISION_MODEL if use_vision else TEXT_MODEL

    if req.is_refinement:
        h, c, j = trim_for_refinement(
            req.previous_html or "", req.previous_css or "", req.previous_js or ""
        )
        system       = REFINEMENT_SYSTEM
        user_content = (
            f"CURRENT HTML:\n{h}\n\nCURRENT CSS:\n{c}\n\nCURRENT JS:\n{j}\n\n"
            f"REQUESTED CHANGES:\n{sanitize_and_trim_message(req.message, 2000)}"
        )
    else:
        system       = SYSTEM_PROMPT
        clean_message = sanitize_and_trim_message(req.message)
        user_content  = f"Build a complete professional multi-page website for:\n\n{clean_message}"

    if req.image:
        user_content = IMAGE_NOTE + user_content

    messages_payload = build_messages_payload(
        system, user_content, model_name, use_vision, req.image
    )

    try:
        kwargs = {
            "model":            model_name,
            "messages":         messages_payload,
            "temperature":      0.1,
            "max_tokens":       MAX_TOKENS,
        }
        if not use_vision:
            kwargs["response_format"] = {"type": "json_object"}

        completion, used_model = await call_groq_with_fallback(kwargs, use_vision)
        print(f"✅ Non-stream used model: {used_model}")
        raw = completion.choices[0].message.content
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Groq API error: {str(e)}")

    try:
        data = extract_json(raw)
        data = normalize_site_fields(data)
        return SiteOutput(**data)
    except (ValueError, ValidationError) as e:
        raise HTTPException(status_code=422, detail=f"LLM returned invalid output: {str(e)}")


# ── Health check ───────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status":         "ok",
        "groq_key_set":   bool(os.getenv("GROQ_API_KEY")),
        "mongo":          MONGO_ENABLED,
        "langfuse":       LANGFUSE_ENABLED,
        "text_model":     TEXT_MODEL,
        "fallback_model": FALLBACK_MODEL,
        "vision_model":   VISION_MODEL,
        "max_tokens":     MAX_TOKENS,
        "max_input_chars": MAX_INPUT_CHARS,
    }