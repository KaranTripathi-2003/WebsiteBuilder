import os
import json
import re
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ValidationError
from groq import Groq
from typing import Optional
from dotenv import load_dotenv

load_dotenv()  # ← loads your .env file automatically

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
app = FastAPI(title="GenAI Website Builder API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # tighten for prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# ── Pydantic models ────────────────────────────────────────────────────────
class GenerateRequest(BaseModel):
    message: str
    previous_html: Optional[str] = ""
    previous_css: Optional[str] = ""
    previous_js: Optional[str] = ""
    is_refinement: bool = False

class SiteOutput(BaseModel):
    title: str
    html: str
    css: str
    js: str

# ── Prompts ────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are an expert web developer. Generate beautiful, modern websites.

CRITICAL RULES:
1. Respond with ONLY valid JSON — no markdown, no backticks, no explanation.
2. JSON shape EXACTLY: { "title": "", "html": "", "css": "", "js": "" }
3. html: ONLY <body> inner content — no <html>, <head>, <body> tags
4. css: complete styles — modern, responsive, beautiful. Use @import for Google Fonts.
5. js: interactivity JS or empty string ""
6. KEEP CODE CONCISE — avoid repetition, combine selectors, no redundant rules
7. Max ~60 HTML elements, max ~150 CSS lines — quality over quantity
8. Mobile responsive using flexbox/grid

DESIGN: gradients, good typography, proper spacing, hover effects, real placeholder content."""

REFINEMENT_PREFIX = """You are refining an existing website. The user wants changes — do NOT regenerate from scratch.
Keep all existing content/structure unless the user asks to change it.
Only modify what the user specifically requests.

CURRENT SITE CODE:
HTML: {html}
CSS: {css}  
JS: {js}

USER REQUEST FOR CHANGES:
"""

# ── Helper: extract JSON from LLM response ─────────────────────────────────
def extract_json(text: str) -> dict:
    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Strip markdown fences
    cleaned = re.sub(r"```(?:json)?", "", text).strip().strip("`").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    # Find first {...} block
    match = re.search(r'\{[\s\S]*\}', cleaned)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    raise ValueError("Could not parse JSON from LLM response")

# ── Route: generate / refine ───────────────────────────────────────────────
@app.post("/generate", response_model=SiteOutput)
async def generate_site(req: GenerateRequest):
    if not os.getenv("GROQ_API_KEY"):
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not set")

    # Build user message
    if req.is_refinement and req.previous_html:
        user_msg = REFINEMENT_PREFIX.format(
            html=req.previous_html,
            css=req.previous_css,
            js=req.previous_js,
        ) + req.message
    else:
        user_msg = f"Build a website: {req.message}"

    # ── Langfuse trace ─────────────────────────────────────────────────────
    trace = None
    if LANGFUSE_ENABLED:
        try:
            trace = langfuse.trace(name="website-generation", input={"message": req.message})
        except Exception:
            pass

    # ── Groq call ──────────────────────────────────────────────────────────
    try:
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.7,
            max_tokens=8000,
            response_format={"type": "json_object"},
        )
        raw = completion.choices[0].message.content
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Groq API error: {str(e)}")

    # ── Parse & validate ───────────────────────────────────────────────────
    try:
        data = extract_json(raw)
        site = SiteOutput(**data)
    except (ValueError, ValidationError) as e:
        if trace:
            try:
                trace.update(output={"error": str(e), "raw": raw[:500]})
            except Exception:
                pass
        raise HTTPException(
            status_code=422,
            detail=f"LLM returned invalid output: {str(e)}. Raw snippet: {raw[:300]}"
        )

    if trace:
        try:
            trace.update(output={"title": site.title})
        except Exception:
            pass

    return site

# ── Health check ───────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "groq_key_set": bool(os.getenv("GROQ_API_KEY"))}