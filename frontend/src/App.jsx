import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import "./App.css";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || "";

// ── Constants ──────────────────────────────────────────────────────────────
const EXAMPLE_PROMPTS = [
  { emoji: "🚀", label: "SaaS landing page for an AI productivity app" },
  { emoji: "🎨", label: "Portfolio for a motion designer" },
  { emoji: "☕", label: "Landing page for a premium coffee shop" },
  { emoji: "🛒", label: "E-commerce product page for luxury sneakers" },
  { emoji: "🏋️", label: "Fitness studio website with class schedules" },
  { emoji: "🏠", label: "Real estate agency with property listings" },
];

const LOADING_STAGES = [
  { label: "Thinking...",    icon: "🧠", duration: 1200 },
  { label: "Writing code...", icon: "⌨️", duration: 2000 },
  { label: "Styling...",     icon: "🎨", duration: 1500 },
  { label: "Rendering...",   icon: "✨", duration: 800  },
];

const DEVICES = [
  { id: "desktop", icon: "🖥️", label: "Desktop", width: "100%" },
  { id: "tablet",  icon: "📱", label: "Tablet",  width: "768px" },
  { id: "mobile",  icon: "📲", label: "Mobile",  width: "375px" },
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
    s.async = true;
    s.defer = true;
    s.onload = resolve;
    document.head.appendChild(s);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// AUTH PAGE
// ══════════════════════════════════════════════════════════════════════════
function AuthPage({ onAuth }) {
  const [mode,    setMode]    = useState("login");
  const [name,    setName]    = useState("");
  const [email,   setEmail]   = useState("");
  const [pass,    setPass]    = useState("");
  const [error,   setError]   = useState("");
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
    setLoading(true);
    setError("");
    try {
      const res  = await fetch(`${API_URL}/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: response.credential }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Google sign-in failed");
      storage.set("ww_token", data.token);
      storage.set("ww_user",  data.user);
      onAuth(data.user, data.token);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
      const body     = mode === "login"
        ? { email, password: pass }
        : { name, email, password: pass };
      const res  = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Auth failed");
      storage.set("ww_token", data.token);
      storage.set("ww_user",  data.user);
      onAuth(data.user, data.token);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
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

        {GOOGLE_CLIENT_ID && (
          <div className="auth-google-wrap">
            <div ref={googleBtnRef} />
          </div>
        )}
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
  const [messages,       setMessages]       = useState([
    { role: "assistant", text: "Hi! I'm WebWeave, your intelligent website creation partner. Tell me your project goal, and I'll build it instantly!" },
  ]);
  const [input,          setInput]          = useState("");
  const [isLoading,      setIsLoading]      = useState(false);
  const [currentSite,    setCurrentSite]    = useState(null);
  const [versions,       setVersions]       = useState([]);
  const [activeVersion,  setActiveVersion]  = useState(null);
  const [activeTab,      setActiveTab]      = useState("preview");
  const [device,         setDevice]         = useState("desktop");
  const [loadingStage,   setLoadingStage]   = useState(0);
  const [streamProgress, setStreamProgress] = useState(0);
  const [previewUrl,     setPreviewUrl]     = useState(null);
  const [projectId,      setProjectId]      = useState(null);
  const [projects,       setProjects]       = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [userMenuOpen,   setUserMenuOpen]   = useState(false);

  const messagesEndRef = useRef(null);
  const stageTimerRef  = useRef(null);

  const authHeaders = useMemo(() => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
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

  const buildFullHTML = (site) => `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="referrer" content="no-referrer"/>
  <title>${site.title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js"><\/script>
  <style>${site.css}<\/style>
</head>
<body>
${site.html}
<script>${site.js}<\/script>
</body>
</html>`;

  useEffect(() => {
    if (!currentSite) { setPreviewUrl(null); return; }
    const html = buildFullHTML(currentSite);
    const blob = new Blob([html], { type: "text/html; charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleSend = async (messageText) => {
    const baseMsg = (messageText || input).trim();
    if (!baseMsg || isLoading) return;

    setInput("");
    const isRefinement = !!currentSite;
    setMessages((prev) => [...prev, { role: "user", text: baseMsg }]);
    setIsLoading(true);
    advanceLoadingStage();

    const pid = projectId || `proj_${Date.now()}`;
    if (!projectId) setProjectId(pid);

    try {
      const res = await fetch(`${API_URL}/generate/stream`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          message:       baseMsg,
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

          // ✅ BUG FIX 3: The original swallowed ALL errors with catch(_){}.
          // This meant SSE parse errors and server errors were silently dropped,
          // so the user just saw a spinner forever. Now errors are surfaced.
          let event;
          try {
            event = JSON.parse(raw);
          } catch (parseErr) {
            console.error("SSE parse error:", parseErr, "raw:", raw);
            continue;
          }

          if (event.type === "chunk") {
            charCount += event.text.length;
            setStreamProgress(Math.min(90, Math.round((charCount / 5000) * 90)));
          }

          if (event.type === "done") {
            const site = event.site;
            setStreamProgress(100);
            setCurrentSite(site);
            const newVersion = { ...site, prompt: baseMsg, timestamp: new Date() };
            setVersions((prev) => [...prev, newVersion]);
            setActiveVersion(newVersion);
            setActiveTab("preview");
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                text: isRefinement
                  ? `✅ Updated! Changes applied to your site.`
                  : `✅ Built **${site.title}**! Check it out on the right — all sections are live and interactive.`,
                site,
              },
            ]);
            loadProjects();
          }

          if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `❌ Error: ${err.message}. Please try again.`, isError: true },
      ]);
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
      setCurrentSite({ title: full.title, html: full.html, css: full.css, js: full.js });
      setProjectId(full.id);
      setVersions([{ title: full.title, html: full.html, css: full.css, js: full.js, prompt: full.prompt }]);
      setMessages([
        { role: "assistant", text: "Hi! I'm WebWeave, your intelligent website creation partner. Tell me your project goal, and I'll build it instantly!" },
        { role: "user",      text: full.prompt || "Loaded project" },
        { role: "assistant", text: `✅ Loaded **${full.title}**. Continue refining or start a new project.` },
      ]);
      setActiveTab("preview");
    } catch (_) {}
  };

  const deleteProject = async (e, proj) => {
    e.stopPropagation();
    await fetch(`${API_URL}/projects/${proj.id}`, { method: "DELETE", headers: authHeaders });
    setProjects((prev) => prev.filter((p) => p.id !== proj.id));
  };

  const handleNewSite = () => {
    setCurrentSite(null);
    setVersions([]);
    setActiveVersion(null);
    setActiveTab("preview");
    setProjectId(null);
    setMessages([{ role: "assistant", text: "Starting fresh! Describe your next website." }]);
  };

  const downloadSite = () => {
    if (!currentSite) return;
    const blob = new Blob([buildFullHTML(currentSite)], { type: "text/html" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${currentSite.title.replace(/\s+/g, "-").toLowerCase()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const currentDevice = DEVICES.find((d) => d.id === device);

  return (
    <div className="app">

      {/* ════════════════ HISTORY SIDEBAR ════════════════ */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="sidebar-logo-icon">W</span>
          <span className="sidebar-logo-text">WebWeave</span>
        </div>

        <button className="sidebar-new-btn" onClick={handleNewSite}>
          <span>✦</span> New Project
        </button>

        <div className="sidebar-section-label">Recent Projects</div>

        <div className="sidebar-history">
          {historyLoading && <div className="sidebar-history-loading">Loading…</div>}
          {!historyLoading && projects.length === 0 && (
            <div className="sidebar-history-empty">No projects yet.<br/>Build your first site!</div>
          )}
          {projects.map((proj) => (
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
              <button
                className="sidebar-history-del"
                onClick={(e) => deleteProject(e, proj)}
                title="Delete"
              >✕</button>
            </button>
          ))}
        </div>

        <div className="sidebar-spacer" />

        <div className="sidebar-user" onClick={() => setUserMenuOpen((o) => !o)}>
          {user.avatar
            ? <img src={user.avatar} alt={user.name} className="sidebar-user-avatar" />
            : <div className="sidebar-user-avatar sidebar-user-avatar--fallback">{user.name?.[0]?.toUpperCase()}</div>
          }
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">{user.name}</span>
            <span className="sidebar-user-email">{user.email}</span>
          </div>
          <span className="sidebar-user-caret">⌄</span>
        </div>
        {userMenuOpen && (
          <div className="sidebar-user-menu">
            <button onClick={onLogout}>Sign out</button>
          </div>
        )}
      </aside>

      {/* ════════════════ RIGHT SIDE ════════════════ */}
      <div className="app-inner">

        <header className="header">
          <div className="header-left">
            <div className="step-progress">
              {["Project Setup", "Structure", "Content", "Design"].map((step, i) => (
                <div key={step} className={`step ${i === 0 ? "step--done" : i === 1 && currentSite ? "step--done" : i === 1 ? "step--active" : i === 2 && currentSite ? "step--active" : ""}`}>
                  <div className="step-dot" />
                  {i < 3 && <div className="step-line" />}
                  <span className="step-label">{step}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="header-right">
            {currentSite && (
              <>
                <div className="device-switcher">
                  {DEVICES.map((d) => (
                    <button
                      key={d.id}
                      className={`device-btn ${device === d.id ? "device-btn--active" : ""}`}
                      onClick={() => setDevice(d.id)}
                      title={d.label}
                    >{d.icon}</button>
                  ))}
                </div>
                <button className="btn btn-ghost" onClick={() => navigator.clipboard.writeText(buildFullHTML(currentSite))}>Copy</button>
                <button className="btn btn-ghost btn-download" onClick={downloadSite}>↓ Download</button>
                <button className="btn btn-primary" onClick={handleNewSite}>+ New</button>
              </>
            )}
            <button className="notif-btn" title="Notifications">🔔</button>
          </div>
        </header>

        <div className="main">

          {/* ════════════════ CHAT PANEL ════════════════ */}
          <div className="chat-panel">

            <div className="chat-ai-header">
              <div className="ai-avatar-wrap">
                <div className="ai-avatar-fallback" style={{ display: "flex" }}>W</div>
              </div>
              <div>
                <div className="ai-name">WebWeave AI Assistant</div>
                <div className="ai-status">● Online</div>
              </div>
            </div>

            <div className="messages">
              {messages.map((m, i) => (
                <div key={i} className={`message message--${m.role} ${m.isError ? "message--error" : ""}`}>
                  {m.role === "assistant" && <div className="avatar"><span>W</span></div>}
                  <div className="bubble">
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
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {!currentSite && !isLoading && (
              <div className="examples">
                {EXAMPLE_PROMPTS.map((p, i) => (
                  <button key={i} className="example-chip" onClick={() => handleSend(p.label)}>
                    {p.emoji} {p.label}
                  </button>
                ))}
              </div>
            )}

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
                      v{i + 1}: {v.prompt.slice(0, 22)}…
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="input-area">
              <textarea
                className="input-box"
                rows={2}
                placeholder={currentSite
                  ? "Refine: change colors, add section, update text…"
                  : "e.g., coffee shop landing page"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
              />
              <button
                className={`send-btn ${isLoading ? "send-btn--loading" : ""}`}
                onClick={() => handleSend()}
                disabled={isLoading || !input.trim()}
              >
                {isLoading ? "⏳" : "▶"}
              </button>
            </div>
          </div>

          {/* ════════════════ PREVIEW PANEL ════════════════ */}
          <div className="preview-panel">
            {currentSite ? (
              <>
                <div className="preview-tabs">
                  <div className="preview-tab-group">
                    {["preview", "html", "css", "js"].map((tab) => (
                      <button
                        key={tab}
                        className={`tab ${activeTab === tab ? "tab--active" : ""}`}
                        onClick={() => setActiveTab(tab)}
                      >{tab.toUpperCase()}</button>
                    ))}
                  </div>
                  <div className="site-title-badge">{currentSite.title}</div>
                </div>

                {activeTab === "preview" && (
                  <div className="preview-viewport">
                    <div className="preview-frame-wrapper" style={{ width: currentDevice.width }}>
                      <iframe
                        key={previewUrl}
                        className="preview-frame"
                        title="Generated Site"
                        src={previewUrl || "about:blank"}
                        sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"
                      />
                    </div>
                  </div>
                )}

                {activeTab !== "preview" && (
                  <pre className="code-view">
                    <code>
                      {activeTab === "html" && currentSite.html}
                      {activeTab === "css"  && currentSite.css}
                      {activeTab === "js"   && (currentSite.js || "// No JavaScript")}
                    </code>
                  </pre>
                )}
              </>
            ) : (
              <div className="empty-preview">
                <div className="empty-icon">🌐</div>
                <h2>Live Website Preview</h2>
                <p>Type a description in the chat and hit ▶ to generate a multi-page website with real images.</p>
                <div className="empty-hint"><span>Try: "coffee shop landing page"</span></div>
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