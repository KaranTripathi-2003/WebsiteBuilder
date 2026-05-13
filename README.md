# ⚡ SiteForge AI — GenAI Website Builder

Chat interface that generates and renders websites live using Groq LLM.

## Setup (< 5 steps)

### 1. Clone & install

```bash
git clone <your-repo>
cd genai-website-builder
```

### 2. Backend setup

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# Edit .env and add your GROQ_API_KEY from console.groq.com
```

### 3. Run backend

```bash
uvicorn main:app --reload --port 8000
```

### 4. Frontend setup

```bash
cd ../frontend
npm install
```

### 5. Run frontend

```bash
npm start
# Opens at http://localhost:3000
```

---

## Deploy

### Backend → Render
1. Push to GitHub
2. New Web Service on render.com → connect repo → set root dir to `backend`
3. Build command: `pip install -r requirements.txt`
4. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add env var: `GROQ_API_KEY=your_key`

### Frontend → Vercel
1. Import repo on vercel.com → set root dir to `frontend`
2. Add env var: `REACT_APP_API_URL=https://your-backend.onrender.com`
3. Deploy ✅

---

## Architecture

```
React (Chat UI + iframe Preview)
        ↓ POST /generate
FastAPI Backend
        ↓
Groq LLM (llama-3.3-70b)
        ↓
Pydantic validates { html, css, js, title }
        ↓
Langfuse traces every call (optional)
```

## Features

- ✅ Chat → Groq → live site preview in iframe
- ✅ Follow-up prompts refine existing site (not regenerate)
- ✅ Structured JSON output validated with Pydantic
- ✅ Version history — revert to any previous version
- ✅ Code viewer (HTML / CSS / JS tabs)
- ✅ Copy full HTML to clipboard
- ✅ Graceful error handling
- ✅ Langfuse tracing (optional)
