import os
import json
import re
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError
from groq import Groq
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

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
    allow_origins=["*"],
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
SYSTEM_PROMPT = """You are a world-class creative web developer and designer. Generate stunning, fully interactive, production-quality websites.

CRITICAL OUTPUT RULES:
1. Respond with ONLY valid JSON — no markdown, no backticks, no explanation.
2. JSON shape EXACTLY: { "title": "", "html": "", "css": "", "js": "" }
3. html: ONLY the inner content that goes inside <body> — never include <html>, <head>, or <body> tags.
4. css: complete styles. ALWAYS start with @import for Google Fonts.
5. js: rich interactivity JavaScript. Never leave this empty.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMAGES — MANDATORY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALWAYS use real images from Unsplash. URL format:
  https://images.unsplash.com/photo-{PHOTO_ID}?w=800&q=80&fit=crop

Pick photo IDs that closely match the website topic:
- Coffee/cafe     → 1495474472229-d1537ef0ae06, 1447933601392-dd56d15c0e4c, 1509042239860-76ac67a571a5
- Fitness/gym     → 1571019613454-1cb2f99b2d8b, 1540497077202-7c8a3999166f, 1534438327233-ac2d8c775bc6
- Tech/SaaS       → 1518770660439-4636190af475, 1504868584819-f8a8b6e12e07, 1488590528505-98d2b5aba04b
- Food/restaurant → 1414235077428-338989a2e8c0, 1565299624946-b28f40a0ae38, 1482049016688-2d3e1b311543
- Fashion/retail  → 1441984904996-e0b6ba687e04, 1490481651871-ab68de25d43d, 1558769132-cb1aea458c5e
- Travel          → 1476514525535-07fb3b4ae5f1, 1493246507337-62b7b2e4d49f, 1469854523086-cc02fe5d8800
- Portfolio       → 1461988625982-7e46a099bf4f, 1507003211169-0a1dd7228f2d, 1558655686-be5e0a3d5f43
- Business        → 1497366216548-37526070297c, 1486406146926-c627a92ad1ab, 1454165804606-c3d57bc86b40
- Nature/outdoor  → 1506905925346-21bda4d32df4, 1441974231531-c6227db76b6e, 1433086966628-84cbc9132bb7
- Health/medical  → 1559757148-5c350d0d3c56, 1576091160550-2173dba999ef, 1532938911079-1346d177d49a
- Education       → 1523050854058-8df90110c9f1, 1503676260728-1c00da094a0b, 1434030216411-0b5816eddaaf
- Real estate     → 1560518883-ce09059eeffa, 1512917774080-9991f1c4c750, 1582268611958-ebfd161ef9cf
- People/faces    → 1507003211169-0a1dd7228f2d, 1494790108377-be9c29b29330, 1438761681033-6461ffad8d80

Use AT LEAST 5 images per page:
- Hero bg:   style="background-image: url('https://images.unsplash.com/photo-{ID}?w=1600&q=80&fit=crop')"
- Cards:     <img src="https://images.unsplash.com/photo-{ID}?w=600&q=80&fit=crop" loading="lazy" alt="...">
- Avatars:   <img src="https://images.unsplash.com/photo-{ID}?w=100&h=100&q=80&fit=crop&crop=face" alt="...">

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ANIMATIONS — MANDATORY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CSS animations required:
1. Hero text: fadeInUp keyframe, staggered animation-delay (0s, 0.2s, 0.4s, 0.6s)
2. Cards: fadeInUp on .animate-on-scroll.visible class
3. Hover on cards: transform: translateY(-8px), box-shadow lift, transition 0.3s
4. Hover on buttons: translateY(-2px), glow box-shadow, background shift
5. Hover on images: scale(1.06) inside overflow:hidden container
6. Nav links: ::after pseudo underline that scales from 0 to 1 on hover
7. Navbar: add .scrolled class via JS — background + backdrop-filter + shadow

.animate-on-scroll { opacity: 0; transform: translateY(30px); transition: opacity 0.6s ease, transform 0.6s ease; }
.animate-on-scroll.visible { opacity: 1; transform: translateY(0); }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
JAVASCRIPT — ALWAYS INCLUDE ALL OF THIS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your js field must always contain:

// Navbar scroll effect
const nav = document.querySelector('nav');
window.addEventListener('scroll', () => {
  if (nav) nav.classList.toggle('scrolled', window.scrollY > 60);
});

// Smooth scroll
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    const el = document.querySelector(a.getAttribute('href'));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

// Scroll reveal with IntersectionObserver
const observer = new IntersectionObserver((entries) => {
  entries.forEach((e, i) => {
    if (e.isIntersecting) {
      setTimeout(() => e.target.classList.add('visible'), i * 80);
    }
  });
}, { threshold: 0.12 });
document.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));

// Animated number counters
const counters = document.querySelectorAll('[data-count]');
const countObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const el = entry.target;
      const target = parseInt(el.getAttribute('data-count'));
      let current = 0;
      const step = target / 60;
      const timer = setInterval(() => {
        current = Math.min(current + step, target);
        el.textContent = Math.floor(current).toLocaleString() + (el.dataset.suffix || '');
        if (current >= target) clearInterval(timer);
      }, 20);
      countObserver.unobserve(el);
    }
  });
}, { threshold: 0.5 });
counters.forEach(el => countObserver.observe(el));

// Hamburger menu
const hamburger = document.querySelector('.hamburger');
const navMenu = document.querySelector('.nav-menu');
if (hamburger && navMenu) {
  hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('active');
    navMenu.classList.toggle('open');
  });
}

// Typewriter effect on hero heading (if element exists)
const typeEl = document.querySelector('.typewriter');
if (typeEl) {
  const text = typeEl.textContent;
  typeEl.textContent = '';
  let i = 0;
  const type = () => { if (i < text.length) { typeEl.textContent += text[i++]; setTimeout(type, 60); } };
  setTimeout(type, 500);
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PAGE STRUCTURE — ALWAYS INCLUDE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. NAVBAR: sticky, logo left + links center/right + CTA button + hamburger (.hamburger) for mobile
   - On scroll: .scrolled class adds backdrop-filter:blur(16px) + shadow
2. HERO: full 100vh, background image with dark overlay, large headline (.typewriter), subheadline, 2 CTA buttons
3. FEATURES/SERVICES: 3-4 cards with icon (emoji or SVG), title, description — all .animate-on-scroll
4. STATS: 4 numbers using data-count attribute, e.g. <span data-count="5000" data-suffix="+">0</span>
5. ABOUT or SHOWCASE: image left + text right (or vice versa), with bullet points
6. TESTIMONIALS: 3 cards with avatar image (Unsplash face crop), name, role, star rating ★★★★★
7. CTA BANNER: bold section with gradient background, headline, button
8. FOOTER: 3-4 columns (logo+desc, links, contact, social), bottom copyright bar

DESIGN RULES:
- Google Fonts: unique pairings — Playfair Display+Lato, Syne+DM Sans, Bebas Neue+Nunito, Fraunces+Manrope, DM Serif Display+Source Sans 3. NEVER Inter or Roboto.
- CSS variables for the entire palette. Committed color scheme — not generic.
- All cards: glassmorphism or strong box-shadow, border-radius 12-20px
- Mobile responsive: hamburger menu, stacked layout on small screens

QUALITY BAR: This must look and feel like a $10,000 custom professional website with real images, smooth animations, and full interactivity. The judge will scroll every section and click every button."""

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

# ── Route: generate / refine (non-streaming) ───────────────────────────────
@app.post("/generate", response_model=SiteOutput)
async def generate_site(req: GenerateRequest):
    if not os.getenv("GROQ_API_KEY"):
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not set")

    if req.is_refinement and req.previous_html:
        user_msg = REFINEMENT_PREFIX.format(
            html=req.previous_html,
            css=req.previous_css,
            js=req.previous_js,
        ) + req.message
    else:
        user_msg = f"Build a complete professional website: {req.message}"

    trace = None
    if LANGFUSE_ENABLED:
        try:
            trace = langfuse.trace(name="website-generation", input={"message": req.message})
        except Exception:
            pass

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

# ── Route: streaming generate ──────────────────────────────────────────────
@app.post("/generate/stream")
async def generate_site_stream(req: GenerateRequest):
    if not os.getenv("GROQ_API_KEY"):
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not set")

    if req.is_refinement and req.previous_html:
        user_msg = REFINEMENT_PREFIX.format(
            html=req.previous_html,
            css=req.previous_css,
            js=req.previous_js,
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
            stream = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                temperature=0.7,
                max_tokens=8000,
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
                    try:
                        trace.update(output={"title": site.title})
                    except Exception:
                        pass
                yield f"data: {json.dumps({'type': 'done', 'site': site.model_dump()})}\n\n"
            except (ValueError, ValidationError) as e:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )

# ── Health check ───────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "groq_key_set": bool(os.getenv("GROQ_API_KEY"))}