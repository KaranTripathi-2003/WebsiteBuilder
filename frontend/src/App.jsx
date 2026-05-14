import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import "./App.css";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || "";

// ── Constants ──────────────────────────────────────────────────────────────
const LOADING_STAGES = [
  { label: "Analyzing your request...", icon: "🧠", duration: 1200 },
  { label: "Architecting pages...", icon: "📐", duration: 2000 },
  { label: "Writing content & code...", icon: "⌨️", duration: 2500 },
  { label: "Applying design polish...", icon: "✨", duration: 1000 },
];

const DEVICES = [
  { id: "desktop", icon: "🖥️", label: "Desktop", width: "100%" },
  { id: "tablet",  icon: "📱", label: "Tablet",  width: "768px" },
  { id: "mobile",  icon: "📲", label: "Mobile",  width: "390px" },
];

// ── Storage helpers ────────────────────────────────────────────────────────
const storage = {
  get:    (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set:    (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  remove: (k) => localStorage.removeItem(k),
};

// ── Google SDK loader ──────────────────────────────────────────────────────
function loadGoogleScript() {
  return new Promise((resolve) => {
    if (window.google) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true; s.defer = true; s.onload = resolve;
    document.head.appendChild(s);
  });
}

// ── Build full HTML document ───────────────────────────────────────────────
function buildFullHTML(site) {
  const title = site.title || "Untitled Site";
  const html  = site.html  || "";
  const css   = site.css   || "";
  const js    = site.js    || "";

  return `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="referrer" content="no-referrer"/>
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet"/>
  <link href="https://unpkg.com/aos@2.3.1/dist/aos.css" rel="stylesheet"/>
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js"></script>
  <script src="https://unpkg.com/aos@2.3.1/dist/aos.js"></script>
  <style>
    body { font-family: 'DM Sans', sans-serif; }
    h1, h2, h3 { font-family: 'DM Sans', sans-serif; }
    .hero-heading { font-family: 'Playfair Display', serif; }
    .page { display: none; }
    .page.active { display: block; }
    nav { position: sticky; top: 0; z-index: 1000; }
    img { image-rendering: -webkit-optimize-contrast; object-fit: cover; }
    ${css}
  </style>
</head>
<body>
${html}
<script>
/* ── Universal Multi-Page Navigation Engine ── */
(function() {
  function showPage(targetId) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(function(el) {
      el.classList.remove('active');
      el.style.display = 'none';
    });
    // Show target page
    var target = document.getElementById(targetId);
    if (target) {
      target.classList.add('active');
      target.style.display = 'block';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    // Update active nav link
    document.querySelectorAll('[data-target]').forEach(function(el) {
      el.classList.remove('active', 'nav-active');
      if (el.getAttribute('data-target') === targetId) {
        el.classList.add('nav-active');
      }
    });
  }

  // Click handler for all data-target elements
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-target]');
    if (!btn) return;
    e.preventDefault();
    var targetId = btn.getAttribute('data-target');
    if (document.getElementById(targetId)) {
      showPage(targetId);
    }
  });

  // Show first page (home) on load
  window.addEventListener('DOMContentLoaded', function() {
    var firstPage = document.querySelector('.page');
    if (firstPage) {
      firstPage.classList.add('active');
      firstPage.style.display = 'block';
    }
    // Init AOS
    if (typeof AOS !== 'undefined') {
      AOS.init({ duration: 800, once: true, offset: 80 });
    }
  });

  // Also handle immediate execution if DOM already loaded
  if (document.readyState !== 'loading') {
    var firstPage = document.querySelector('.page');
    if (firstPage) {
      firstPage.classList.add('active');
      firstPage.style.display = 'block';
    }
    if (typeof AOS !== 'undefined') {
      AOS.init({ duration: 800, once: true, offset: 80 });
    }
  }
})();

/* ── Site-Specific JS ── */
try {
  ${js}
} catch(e) { console.warn('Site JS error:', e); }
</script>
</body>
</html>`;
}

function isSiteValid(site) {
  return site && typeof site.html === "string" && site.html.trim().length > 20;
}

function getCodeForTab(site, tab) {
  if (!site) return "";
  const raw = site[tab] || "";
  if (!raw.trim()) return `/* No ${tab.toUpperCase()} generated */`;
  return raw;
}


// ══════════════════════════════════════════════════════════════════════════
// AUTH PAGE
// ══════════════════════════════════════════════════════════════════════════
function AuthPage({ onAuth }) {
  const [mode, setMode]       = useState("login");
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [pass, setPass]       = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);
  const googleBtnRef = useRef(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    loadGoogleScript().then(() => {
      if (!window.google || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredential,
      });
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: "outline", size: "large", width: "100%", text: "continue_with",
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const handleGoogleCredential = async (response) => {
    setLoading(true); setError("");
    try {
      const res  = await fetch(`${API_URL}/auth/google`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: response.credential }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Google sign-in failed");
      storage.set("ww_token", data.token);
      storage.set("ww_user", data.user);
      onAuth(data.user, data.token);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
      const body     = mode === "login"
        ? { email, password: pass }
        : { name, email, password: pass };
      const res  = await fetch(`${API_URL}${endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Auth failed");
      storage.set("ww_token", data.token);
      storage.set("ww_user", data.user);
      onAuth(data.user, data.token);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="auth-logo-icon">W</span>
          <span className="auth-logo-text">WebWeave</span>
        </div>
        <h1 className="auth-title">
          {mode === "login" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="auth-subtitle">
          {mode === "login"
            ? "Sign in to continue building stunning websites"
            : "Start building beautiful websites with AI"}
        </p>

        {GOOGLE_CLIENT_ID && <div className="auth-google-wrap"><div ref={googleBtnRef} /></div>}
        {!GOOGLE_CLIENT_ID && (
          <button className="auth-google-btn" disabled>
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>
        )}

        <div className="auth-divider"><span>or</span></div>
        {error && <div className="auth-error">{error}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "signup" && (
            <div className="auth-field">
              <label>Full Name</label>
              <input type="text" placeholder="Jane Smith" value={name}
                onChange={e => setName(e.target.value)} required />
            </div>
          )}
          <div className="auth-field">
            <label>Email</label>
            <input type="email" placeholder="you@example.com" value={email}
              onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="auth-field">
            <label>Password</label>
            <input type="password" placeholder="••••••••" value={pass}
              onChange={e => setPass(e.target.value)} required minLength={6} />
          </div>
          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <p className="auth-switch">
          {mode === "login" ? "Don't have an account?" : "Already have an account?"}
          {" "}
          <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}>
            {mode === "login" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
      <div className="auth-bg-orb auth-bg-orb--1" />
      <div className="auth-bg-orb auth-bg-orb--2" />
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════
function MainApp({ user, token, onLogout }) {
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Hi! I'm WebWeave. Describe the website you want to build — include the business type, style preferences, and any content you want. I'll create a complete multi-page professional website for you." },
  ]);
  const [input, setInput]               = useState("");
  const [selectedImage, setSelectedImage] = useState(null);  // base64
  const [isLoading, setIsLoading]       = useState(false);
  const [currentSite, setCurrentSite]   = useState(null);
  const [versions, setVersions]         = useState([]);
  const [activeVersion, setActiveVersion] = useState(null);
  const [activeTab, setActiveTab]       = useState("preview");
  const [device, setDevice]             = useState("desktop");
  const [loadingStage, setLoadingStage] = useState(0);
  const [streamProgress, setStreamProgress] = useState(0);
  const [previewError, setPreviewError] = useState(null);
  const [projectId, setProjectId]       = useState(null);
  const [projects, setProjects]         = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen]   = useState(true);

  const messagesEndRef  = useRef(null);
  const stageTimerRef   = useRef(null);
  const fileInputRef    = useRef(null);
  const textareaRef     = useRef(null);

  const authHeaders = useMemo(() => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  }), [token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadProjects = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_URL}/projects`, { headers: authHeaders });
      if (res.ok) setProjects(await res.json());
    } catch (_) {}
    setHistoryLoading(false);
  }, [authHeaders]);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  const fullHtmlDoc = useMemo(() => {
    if (!currentSite || !isSiteValid(currentSite)) return null;
    return buildFullHTML(currentSite);
  }, [currentSite]);

  useEffect(() => {
    setPreviewError(null);
    if (!currentSite) return;
    if (!isSiteValid(currentSite)) {
      setPreviewError("The AI returned incomplete output. Please refine your prompt or try again.");
    }
  }, [currentSite]);

  const advanceLoadingStage = useCallback(() => {
    setLoadingStage(0);
    let stage = 0;
    const advance = () => {
      stage++;
      if (stage < LOADING_STAGES.length) {
        setLoadingStage(stage);
        stageTimerRef.current = setTimeout(advance, LOADING_STAGES[stage].duration);
      }
    };
    stageTimerRef.current = setTimeout(advance, LOADING_STAGES[0].duration);
  }, []);

  const stopLoadingStage = useCallback(() => {
    clearTimeout(stageTimerRef.current);
    setLoadingStage(0);
    setStreamProgress(0);
  }, []);

  // Auto-resize textarea
  const handleInputChange = (e) => {
    setInput(e.target.value);
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setSelectedImage(reader.result);
    reader.readAsDataURL(file);
  };

  const handleSend = async (overrideText) => {
    const baseMsg = (overrideText || input).trim();
    if (!baseMsg && !selectedImage) return;
    if (isLoading) return;

    const msgText = baseMsg || "Analyze the uploaded image and build a website based on it.";
    const imgData  = selectedImage;
    setInput("");
    setSelectedImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const isRefinement = !!currentSite;
    setMessages(prev => [...prev, {
      role: "user",
      text: msgText,
      image: imgData ? true : false,
    }]);
    setIsLoading(true);
    advanceLoadingStage();

    const pid = projectId || `proj_${Date.now()}`;
    if (!projectId) setProjectId(pid);

    try {
      const res = await fetch(`${API_URL}/generate/stream`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          message:       msgText,
          image:         imgData || null,
          previous_html: currentSite?.html || "",
          previous_css:  currentSite?.css  || "",
          previous_js:   currentSite?.js   || "",
          is_refinement: isRefinement,
          project_id:    pid,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Generation failed");
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", charCount = 0;

      // Fail-safe timeout: if no data for 120s, abort
      const streamTimeout = setTimeout(() => {
        reader.cancel();
        setIsLoading(false);
        stopLoadingStage();
        setMessages(prev => [...prev, { role: "assistant", text: "❌ Generation timed out. The model is likely overwhelmed by the content size. Please try a more specific or slightly shorter prompt." }]);
      }, 120000);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let event;
          try { event = JSON.parse(raw); }
          catch { continue; }

          if (event.type === "chunk") {
            charCount += event.text.length;
            setStreamProgress(Math.min(90, Math.round((charCount / 6000) * 90)));
          }

          if (event.type === "done") {
            const site = event.site;
            setStreamProgress(100);
            const normalized = {
              title: site.title || "Untitled Site",
              html:  site.html  || "",
              css:   site.css   || "",
              js:    site.js    || "",
            };

            // If user uploaded an image, inject it as hero image in HTML
            if (imgData && normalized.html) {
              // Replace the first picsum or loremflickr hero image src with the uploaded image
              // Handles formats like: /WIDTH/HEIGHT/KEYWORD or /KEYWORD/WIDTH/HEIGHT
              normalized.html = normalized.html.replace(
                /https:\/\/(picsum\.photos|loremflickr\.com)\/[^"']+(?:\d+\/\d+|\d+x\d+)[^"']*/,
                imgData
              );
            }

            setCurrentSite(normalized);
            const newVersion = { ...normalized, prompt: msgText, timestamp: new Date() };
            setVersions(prev => [...prev, newVersion]);
            setActiveVersion(newVersion);
            setActiveTab("preview");

            const isValid = isSiteValid(normalized);
            setMessages(prev => [...prev, {
              role: "assistant",
              text: !isValid
                ? `⚠️ Generated **${normalized.title}** but the output may be incomplete. Try adding more detail to your prompt.`
                : isRefinement
                  ? `✅ Updated! Your changes have been applied to **${normalized.title}**.`
                  : `✅ Built **${normalized.title}**! Your multi-page website is ready — use the navbar buttons inside the preview to navigate between pages.`,
            }]);
            loadProjects();
          }

          if (event.type === "error") throw new Error(event.message);
        }
      }
      clearTimeout(streamTimeout);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: "assistant",
        text: `❌ Error: ${err.message}. Please try again.`,
        isError: true,
      }]);
    } finally {
      stopLoadingStage();
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const openProject = async (proj) => {
    try {
      const res = await fetch(`${API_URL}/projects/${proj.id}`, { headers: authHeaders });
      if (!res.ok) return;
      const full = await res.json();
      const normalized = {
        title: full.title || "Untitled Site",
        html:  full.html  || "",
        css:   full.css   || "",
        js:    full.js    || "",
      };
      setCurrentSite(normalized);
      setProjectId(full.id);
      setVersions([{ ...normalized, prompt: full.prompt }]);
      setMessages([
        { role: "assistant", text: "Hi! I'm WebWeave. Describe the website you want to build — include the business type, style preferences, and any content you want. I'll create a complete multi-page professional website for you." },
        { role: "user",      text: full.prompt || "Loaded project" },
        { role: "assistant", text: `✅ Loaded **${normalized.title}**. You can refine it or start a new project.` },
      ]);
      setActiveTab("preview");
    } catch (_) {}
  };

  const deleteProject = async (e, proj) => {
    e.stopPropagation();
    await fetch(`${API_URL}/projects/${proj.id}`, { method: "DELETE", headers: authHeaders });
    setProjects(prev => prev.filter(p => p.id !== proj.id));
    if (projectId === proj.id) handleNewSite();
  };

  const handleNewSite = () => {
    setCurrentSite(null);
    setVersions([]);
    setActiveVersion(null);
    setActiveTab("preview");
    setProjectId(null);
    setPreviewError(null);
    setSelectedImage(null);
    setMessages([{ role: "assistant", text: "Starting fresh! Describe your next website — business type, style, pages, and any specific content you want included." }]);
  };

  const downloadSite = () => {
    if (!currentSite || !fullHtmlDoc) return;
    const blob = new Blob([fullHtmlDoc], { type: "text/html" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `${(currentSite.title || "site").replace(/\s+/g, "-").toLowerCase()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyHTML = () => {
    if (fullHtmlDoc) navigator.clipboard.writeText(fullHtmlDoc);
  };

  const currentDevice = DEVICES.find(d => d.id === device);

  return (
    <div className="app">

      {/* ════════════ SIDEBAR ════════════ */}
      <aside className={`sidebar ${sidebarOpen ? "sidebar--open" : "sidebar--closed"}`}>
        <div className="sidebar-logo">
          <span className="sidebar-logo-icon">W</span>
          {sidebarOpen && <span className="sidebar-logo-text">WebWeave</span>}
        </div>

        <button className="sidebar-new-btn" onClick={handleNewSite}>
          <span className="btn-plus">+</span>
          {sidebarOpen && <span>New Project</span>}
        </button>

        {sidebarOpen && (
          <>
            <div className="sidebar-section-label">Recent Projects</div>
            <div className="sidebar-history">
              {historyLoading && <div className="sidebar-history-loading">Loading…</div>}
              {!historyLoading && projects.length === 0 && (
                <div className="sidebar-history-empty">No projects yet.<br/>Build your first site!</div>
              )}
              {projects.map(proj => (
                <button
                  key={proj.id}
                  className={`sidebar-history-item ${projectId === proj.id ? "sidebar-history-item--active" : ""}`}
                  onClick={() => openProject(proj)}
                >
                  <span className="sidebar-history-icon">🌐</span>
                  <div className="sidebar-history-info">
                    <span className="sidebar-history-title">{proj.title || "Untitled"}</span>
                    <span className="sidebar-history-date">
                      {proj.updated_at ? new Date(proj.updated_at).toLocaleDateString() : ""}
                    </span>
                  </div>
                  <button className="sidebar-history-del" onClick={e => deleteProject(e, proj)} title="Delete">✕</button>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="sidebar-spacer" />

        <div className="sidebar-user" onClick={() => setUserMenuOpen(o => !o)}>
          {user.avatar
            ? <img src={user.avatar} alt={user.name} className="sidebar-user-avatar" />
            : <div className="sidebar-user-avatar sidebar-user-avatar--fallback">{user.name?.[0]?.toUpperCase()}</div>
          }
          {sidebarOpen && (
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{user.name}</span>
              <span className="sidebar-user-email">{user.email}</span>
            </div>
          )}
          {sidebarOpen && <span className="sidebar-user-caret">⌄</span>}
        </div>
        {userMenuOpen && sidebarOpen && (
          <div className="sidebar-user-menu">
            <button onClick={onLogout}>Sign out</button>
          </div>
        )}

        {/* Sidebar toggle */}
        <button className="sidebar-toggle" onClick={() => setSidebarOpen(o => !o)} title="Toggle sidebar">
          {sidebarOpen ? "◀" : "▶"}
        </button>
      </aside>

      {/* ════════════ RIGHT SIDE ════════════ */}
      <div className="app-inner">

        {/* ── HEADER ── */}
        <header className="header">
          <div className="header-left">
            {currentSite && (
              <div className="site-name-pill">
                <span>🌐</span>
                <span>{currentSite.title}</span>
              </div>
            )}
            {!currentSite && (
              <div className="header-welcome">
                <span className="header-welcome-text">Build something great today</span>
              </div>
            )}
          </div>
          <div className="header-right">
            {currentSite && (
              <>
                <div className="device-switcher">
                  {DEVICES.map(d => (
                    <button
                      key={d.id}
                      className={`device-btn ${device === d.id ? "device-btn--active" : ""}`}
                      onClick={() => setDevice(d.id)}
                      title={d.label}
                    >{d.icon}</button>
                  ))}
                </div>
                <button className="btn btn-ghost" onClick={copyHTML}>Copy HTML</button>
                <button className="btn btn-ghost btn-download" onClick={downloadSite}>↓ Download</button>
                <button className="btn btn-primary" onClick={handleNewSite}>+ New</button>
              </>
            )}
          </div>
        </header>

        {/* ── MAIN CONTENT ── */}
        <div className="main">

          {/* ════ CHAT PANEL ════ */}
          <div className="chat-panel">

            <div className="chat-ai-header">
              <div className="ai-avatar-wrap">
                <div className="ai-avatar-fallback">W</div>
                <div className="ai-status-dot" />
              </div>
              <div>
                <div className="ai-name">WebWeave AI</div>
                <div className="ai-status">● Ready to build</div>
              </div>
            </div>

            {/* Messages */}
            <div className="messages">
              {messages.map((m, i) => (
                <div key={i} className={`message message--${m.role} ${m.isError ? "message--error" : ""}`}>
                  {m.role === "assistant" && (
                    <div className="avatar"><span>W</span></div>
                  )}
                  <div className="bubble">
                    {m.image && (
                      <div className="msg-image-badge">📎 Image attached</div>
                    )}
                    {m.text.split("**").map((part, j) =>
                      j % 2 === 1 ? <strong key={j}>{part}</strong> : part
                    )}
                  </div>
                  {m.role === "user" && (
                    <div className="avatar avatar--user">
                      {user.avatar
                        ? <img src={user.avatar} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
                        : user.name?.[0]?.toUpperCase()
                      }
                    </div>
                  )}
                </div>
              ))}

              {/* Loading state */}
              {isLoading && (
                <div className="message message--assistant">
                  <div className="avatar avatar--pulse">W</div>
                  <div className="bubble bubble--loading">
                    <div className="loading-stage">
                      <span className="loading-stage-icon">{LOADING_STAGES[loadingStage].icon}</span>
                      <span className="loading-stage-label">{LOADING_STAGES[loadingStage].label}</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-bar-fill" style={{ width: `${streamProgress}%` }} />
                    </div>
                    <div className="progress-label">{streamProgress}%</div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Version history */}
            {versions.length > 1 && (
              <div className="versions">
                <p className="versions-label">Version history</p>
                <div className="versions-list">
                  {versions.map((v, i) => (
                    <button
                      key={i}
                      className={`version-chip ${activeVersion === v ? "active" : ""}`}
                      onClick={() => { setActiveVersion(v); setCurrentSite(v); }}
                    >
                      v{i + 1}: {v.prompt.slice(0, 24)}…
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input area */}
            <div className="input-area">
              <div className="input-container">
                {/* Image preview (ChatGPT-style) */}
                {selectedImage && (
                  <div className="input-image-preview">
                    <div className="input-image-card">
                      <img src={selectedImage} alt="Upload preview" />
                      <button 
                        className="input-image-remove" 
                        onClick={() => {
                          setSelectedImage(null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                        title="Remove image"
                      >✕</button>
                    </div>
                  </div>
                )}

                <div className="input-row">
                  {/* Image upload button */}
                  <input
                    type="file"
                    accept="image/*"
                    ref={fileInputRef}
                    onChange={handleImageUpload}
                    style={{ display: "none" }}
                  />
                  <button
                    className="input-attach-btn"
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach image — it will be used in your website"
                    disabled={isLoading}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                  </button>

                  <textarea
                    ref={textareaRef}
                    className="input-box"
                    rows={1}
                    placeholder={currentSite
                      ? "Describe changes — e.g. 'Change the hero color to navy blue'..."
                      : "Describe your website — business type, pages, style..."
                    }
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    disabled={isLoading}
                  />
                  
                  <button
                    className={`send-btn ${isLoading ? "send-btn--loading" : ""}`}
                    onClick={() => handleSend()}
                    disabled={isLoading || (!input.trim() && !selectedImage)}
                  >
                    {isLoading ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="spin">
                        <path d="M21 12a9 9 0 11-6.219-8.56"/>
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="22" y1="2" x2="11" y2="13"/>
                        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              <div className="input-hint">
                {currentSite
                  ? "Shift+Enter for new line • Enter to send"
                  : "Shift+Enter for new line • Enter to send"
                }
              </div>
            </div>
          </div>

          {/* ════ PREVIEW PANEL ════ */}
          <div className="preview-panel">
            {currentSite ? (
              <>
                <div className="preview-tabs">
                  <div className="preview-tab-group">
                    {["preview", "html", "css", "js"].map(tab => (
                      <button
                        key={tab}
                        className={`tab ${activeTab === tab ? "tab--active" : ""}`}
                        onClick={() => setActiveTab(tab)}
                      >{tab.toUpperCase()}</button>
                    ))}
                  </div>
                  <div className="preview-meta">
                    <span className="preview-page-hint">Use navbar buttons inside preview to switch pages</span>
                  </div>
                </div>

                {activeTab === "preview" && (
                  <div className="preview-viewport">
                    {previewError ? (
                      <div className="preview-error-state">
                        <span style={{ fontSize: "2.5rem" }}>⚠️</span>
                        <p>{previewError}</p>
                        <button onClick={() => handleSend("Regenerate the site with complete content and working navigation")}>
                          Regenerate
                        </button>
                      </div>
                    ) : (
                      <div className="preview-frame-wrapper" style={{ width: currentDevice.width, margin: "0 auto" }}>
                        <iframe
                          className="preview-frame"
                          title="Generated Site Preview"
                          srcDoc={fullHtmlDoc || ""}
                          sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"
                        />
                      </div>
                    )}
                  </div>
                )}

                {activeTab !== "preview" && (
                  <div className="code-view-wrap">
                    <pre className="code-view">
                      <code>{getCodeForTab(currentSite, activeTab)}</code>
                    </pre>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-preview">
                <div className="empty-icon">🌐</div>
                <h2>Your website will appear here</h2>
                <p>Describe your project in the chat — include the business type, tone, pages you need, and any content. I'll build a complete multi-page professional website.</p>
                <div className="empty-tips">
                  <div className="empty-tip">
                    <span className="empty-tip-icon">📄</span>
                    <span>Multi-page with working navigation</span>
                  </div>
                  <div className="empty-tip">
                    <span className="empty-tip-icon">🖼️</span>
                    <span>Real images on every page</span>
                  </div>
                  <div className="empty-tip">
                    <span className="empty-tip-icon">📎</span>
                    <span>Attach your own images to use them</span>
                  </div>
                  <div className="empty-tip">
                    <span className="empty-tip-icon">✏️</span>
                    <span>Refine anything with follow-up messages</span>
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [user,  setUser]  = useState(() => storage.get("ww_user"));
  const [token, setToken] = useState(() => storage.get("ww_token"));

  const handleAuth = (u, t) => { setUser(u); setToken(t); };

  const handleLogout = async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (_) {}
    storage.remove("ww_token");
    storage.remove("ww_user");
    setUser(null);
    setToken(null);
  };

  if (!user || !token) return <AuthPage onAuth={handleAuth} />;
  return <MainApp user={user} token={token} onLogout={handleLogout} />;
}