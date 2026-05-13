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
SYSTEM_PROMPT = """You are an expert Senior Frontend Engineer and UI/UX Designer. Generate a stunning, fully functional, responsive, and interactive website.

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown:
{ "title": "...", "html": "...", "css": "...", "js": "..." }

- html: semantic body inner content ONLY (no <html><head><body> tags). Use Tailwind CSS utility classes for ALL layout, colors, spacing, typography, and effects. Use Alpine.js x-data/x-show/@click for reactive UI.
- css: ONLY custom CSS not possible in Tailwind — @import Google Fonts, custom @keyframes (fadeInUp, typewriter), .anim/.anim.visible scroll-reveal classes, custom scrollbar, glassmorphism backdrop. DO NOT duplicate anything achievable with Tailwind classes.
- js: Vanilla JavaScript for: smooth scroll, navbar scroll effect, scroll-reveal IntersectionObserver, hamburger toggle, typewriter, form submit handler. All minified on one line per feature.
- Tailwind CDN and Alpine.js are already injected — do NOT include them in your output.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PAGE SECTIONS (in this exact order):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. <header> sticky nav — logo left + desktop links right (Home About Services Contact) + hamburger button for mobile. On scroll adds shadow + bg-white/90 backdrop-blur. Alpine x-data="{open:false}" for mobile menu x-show="open".
2. <section id="home"> hero — min-h-screen, Unsplash bg-image with dark overlay, flex items-center justify-center. Bold .typewriter h1, subtitle p, 2 CTA buttons (primary → #services, ghost → #contact). Animate text with staggered fadeInUp.
3. <section id="features"> — "Why Choose Us" heading + grid of 3 glassmorphism cards. Each card: large emoji icon, bold title, description. bg-white/10 backdrop-blur-md, border border-white/20, hover:-translate-y-2 transition.
4. <section id="about"> — 2-col grid (image left, text right). Left: Unsplash <img> rounded-2xl shadow-2xl object-cover h-96 w-full. Right: eyebrow label, h2, 2 paragraphs real descriptive copy, primary CTA button. Add .anim class for scroll reveal.
5. <section id="services"> — section heading + 6-card grid (grid-cols-1 md:grid-cols-2 lg:grid-cols-3). Each card: Unsplash <img class="w-full h-48 object-cover">, card body with name, short description, price/tag, hover:shadow-xl hover:-translate-y-1 transition-all. Add .anim to each card.
6. <section id="testimonials"> — 3 testimonial cards in a grid. Each: ★★★★★ stars in accent color, italic quote, avatar <img> rounded-full w-12 h-12 object-cover, name bold + role text-muted. Glassmorphism card style.
7. <section id="contact"> — 2-col grid. Left: form with Tailwind-styled inputs (rounded-xl border focus:ring-2 focus:ring-primary px-4 py-3) for name, email, message textarea, submit button. Right: 3 info cards (📍📞✉️) each in a rounded-xl bg card.
8. <footer> — dark bg, 4-col grid: brand column (logo+tagline+social links), 3 link columns (Company, Services, Connect). Bottom border-t with copyright.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMAGES — Unsplash (match the topic):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hero: https://images.unsplash.com/photo-{ID}?w=1600&q=80&fit=crop&auto=format
Cards: https://images.unsplash.com/photo-{ID}?w=600&q=80&fit=crop&auto=format
Faces: https://images.unsplash.com/photo-{ID}?w=80&h=80&q=80&fit=crop&crop=face&auto=format

Photo IDs by topic:
- Coffee/cafe:    1495474472229-d1537ef0ae06, 1447933601392-dd56d15c0e4c, 1509042239860-76ac67a571a5, 1442512435128-3a91d1e94e6e
- Fitness:        1571019613454-1cb2f99b2d8b, 1540497077202-7c8a3999166f, 1534438327233-ac2d8c775bc6
- Tech/SaaS:      1518770660439-4636190af475, 1504868584819-f8a8b6e12e07, 1488590528505-98d2b5aba04b
- Food:           1414235077428-338989a2e8c0, 1565299624946-b28f40a0ae38, 1482049016688-2d3e1b311543
- Fashion/retail: 1441984904996-e0b6ba687e04, 1490481651871-ab68de25d43d, 1558769132-cb1aea458c5e
- Travel:         1476514525535-07fb3b4ae5f1, 1493246507337-62b7b2e4d49f, 1469854523086-cc02fe5d8800
- Business:       1497366216548-37526070297c, 1486406146926-c627a92ad1ab, 1454165804606-c3d57bc86b40
- Real estate:    1560518883-ce09059eeffa, 1512917774080-9991f1c4c750, 1582268611958-ebfd161ef9cf
- People/faces:   1494790108377-be9c29b29330, 1438761681033-6461ffad8d80, 1507003211169-0a1dd7228f2d
Use at least 6 different photo IDs. NEVER use placeholder.com or picsum.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DESIGN SYSTEM:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Choose a cohesive palette matching the topic. Define in CSS: :root { --primary:#...; --accent:#...; --bg:#...; }
- Extend Tailwind via the inline config: <script>tailwind.config={theme:{extend:{colors:{primary:'var(--primary)',accent:'var(--accent)'}}}}</script> — put this FIRST in the html field, before any other element.
- Fonts: @import from Google Fonts. Pick one pair: "Playfair Display"+"Lato", "Syne"+"DM Sans", or "Fraunces"+"Manrope".
- Apply fonts with Tailwind's font-sans/font-serif or a custom fontFamily in tailwind.config.
- Glassmorphism cards: bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl shadow-xl
- Modern Flat cards: bg-white rounded-2xl shadow-lg border border-gray-100
- Sections: py-20 or py-24 minimum.
- All interactive elements: transition-all duration-300 ease-in-out cursor-pointer.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTERACTIVITY (js field):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// smooth scroll
document.querySelectorAll('a[href^="#"]').forEach(a=>{a.addEventListener('click',e=>{e.preventDefault();document.querySelector(a.getAttribute('href'))?.scrollIntoView({behavior:'smooth'});});});
// navbar scroll
const hdr=document.querySelector('header');window.addEventListener('scroll',()=>{hdr?.classList.toggle('shadow-lg',scrollY>50);hdr?.classList.toggle('bg-white/95',scrollY>50);hdr?.classList.toggle('backdrop-blur-md',scrollY>50);});
// scroll reveal
new IntersectionObserver((en)=>{en.forEach((e,i)=>{if(e.isIntersecting)setTimeout(()=>e.target.classList.add('visible'),i*120);});},{threshold:0.08}).observe&&document.querySelectorAll('.anim').forEach(el=>new IntersectionObserver((en)=>{if(en[0].isIntersecting)en[0].target.classList.add('visible');},{threshold:0.08}).observe(el));
// typewriter
const te=document.querySelector('.typewriter');if(te){const tx=te.textContent;te.textContent='';let i=0;(function r(){if(i<tx.length){te.textContent+=tx[i++];setTimeout(r,55);}})();}
// form
document.querySelector('form')?.addEventListener('submit',e=>{e.preventDefault();const p=Object.assign(document.createElement('p'),{textContent:'✅ Message sent! We\'ll be in touch.',className:'text-green-500 font-semibold mt-3 text-center'});e.target.appendChild(p);e.target.reset();setTimeout(()=>p.remove(),5000);});
// button micro-interaction
document.querySelectorAll('button,a.btn').forEach(b=>{b.addEventListener('mousedown',()=>b.style.transform='scale(0.96)');b.addEventListener('mouseup',()=>b.style.transform='');});

QUALITY BAR: Every section must have real copy, real Unsplash images, smooth animations, working hamburger, working contact form. Output must look like a $10,000 professional website."""

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
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.7,
            max_tokens=6000,
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
                model="llama-3.1-8b-instant",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                temperature=0.7,
                max_tokens=6000,
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