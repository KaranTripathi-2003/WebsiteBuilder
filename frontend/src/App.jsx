import { useState, useRef, useEffect, useCallback } from "react";
import "./App.css";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

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

const NAV_ITEMS = [
  { id: "new",       icon: "✦",  label: "New Project" },
  { id: "sites",     icon: "⊞",  label: "My Sites"    },
  { id: "templates", icon: "⊟",  label: "Templates"   },
];



function App() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Hi! I'm WebWeave. Let's build your website!\n\nAsk me anything about building your site!",
    },
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
  const [navActive,      setNavActive]      = useState("new");

  const messagesEndRef = useRef(null);
  const stageTimerRef  = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const buildFullHTML = (site) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${site.title}</title>
  <style>${site.css}</style>
</head>
<body>
${site.html}
<script>${site.js}<\/script>
</body>
</html>`;

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
    const baseMsg  = (messageText || input).trim();
    if (!baseMsg || isLoading) return;

    // Build prompt
    const msg = `${baseMsg}. Generate a MULTI-PAGE website (Home, About, Services/Menu/Products, Contact pages) using <!-- PAGE: Name --> markers to separate each page.`;

    setInput("");
    const isRefinement = !!currentSite;
    setMessages((prev) => [...prev, { role: "user", text: baseMsg }]);
    setIsLoading(true);
    advanceLoadingStage();

    try {
      const res = await fetch(`${API_URL}/generate/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          previous_html: currentSite?.html || "",
          previous_css:  currentSite?.css  || "",
          previous_js:   currentSite?.js   || "",
          is_refinement: isRefinement,
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

          try {
            const event = JSON.parse(raw);

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
                    ? `✅ Updated! Changes applied. Keep refining or download when ready.`
                    : `✅ Built **${site.title}**! All buttons and links are fully interactive in the preview.`,
                  site,
                },
              ]);
            }

            if (event.type === "error") throw new Error(event.message);
          } catch (_) {}
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

  const handleVersionClick = (v) => {
    setActiveVersion(v);
    setCurrentSite(v);
  };

  const handleNewSite = () => {
    setCurrentSite(null);
    setVersions([]);
    setActiveVersion(null);
    setActiveTab("preview");
    setNavActive("new");
    setMessages([{ role: "assistant", text: "Starting fresh! Describe your next website." }]);
  };

  const copyCode = () => {
    if (currentSite) navigator.clipboard.writeText(buildFullHTML(currentSite));
  };

  const currentDevice = DEVICES.find((d) => d.id === device);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="app">

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="sidebar-logo-icon">W</span>
        </div>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`sidebar-nav-btn ${navActive === item.id ? "sidebar-nav-btn--active" : ""}`}
            onClick={() => { setNavActive(item.id); if (item.id === "new") handleNewSite(); }}
            title={item.label}
          >
            <span className="sidebar-nav-icon">{item.icon}</span>
            <span className="sidebar-nav-label">{item.label}</span>
          </button>
        ))}
        <div className="sidebar-spacer" />
        <button className="sidebar-nav-btn" title="Help">
          <span className="sidebar-nav-icon">?</span>
          <span className="sidebar-nav-label">Help</span>
        </button>
      </aside>

      {/* ── Main wrapper ── */}
      <div className="app-inner">

        {/* ── Header ── */}
        <header className="header">
          <div className="header-left">
            {/* Step progress */}
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
                    >
                      {d.icon}
                    </button>
                  ))}
                </div>
                <button className="btn btn-ghost" onClick={copyCode}>Copy</button>
                <button className="btn btn-ghost btn-download" onClick={() => {
                  if (!currentSite) return;
                  const blob = new Blob([buildFullHTML(currentSite)], { type: "text/html" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${currentSite.title.replace(/\s+/g, "-").toLowerCase()}.html`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}>↓ Download</button>
                <button className="btn btn-primary" onClick={handleNewSite}>+ New</button>
              </>
            )}
            {/* Notification bell */}
            <button className="notif-btn" title="Notifications">🔔</button>
          </div>
        </header>

        <div className="main">

          {/* ── Chat Panel ── */}
          <div className="chat-panel">

            {/* AI assistant header */}
            <div className="chat-ai-header">
              <div className="ai-avatar-wrap">
                <img
                  className="ai-avatar"
                  src="https://images.unsplash.com/photo-1676299081847-3f0b4b2e5e5e?w=80&h=80&q=80&fit=crop&crop=face"
                  alt="AI"
                  onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
                />
                <div className="ai-avatar-fallback">W</div>
              </div>
              <div>
                <div className="ai-name">WebWeave AI Assistant</div>
                <div className="ai-status">● Online</div>
              </div>
            </div>

            {/* Messages */}
            <div className="messages">
              {messages.map((m, i) => (
                <div key={i} className={`message message--${m.role} ${m.isError ? "message--error" : ""}`}>
                  {m.role === "assistant" && (
                    <div className="avatar">
                      <span>W</span>
                    </div>
                  )}
                  <div className="bubble">
                    {m.text.split("**").map((part, j) =>
                      j % 2 === 1 ? <strong key={j}>{part}</strong> : part
                    )}
                  </div>
                  {m.role === "user" && <div className="avatar avatar--user">U</div>}
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


            {/* Example prompts */}
            {!currentSite && !isLoading && (
              <div className="examples">
                {EXAMPLE_PROMPTS.map((p, i) => (
                  <button
                    key={i}
                    className="example-chip"
                    onClick={() => handleSend(p.label)}
                  >
                    {p.emoji} {p.label}
                  </button>
                ))}
              </div>
            )}

            {/* Version history */}
            {versions.length > 1 && (
              <div className="versions">
                <p className="versions-label">Version history</p>
                <div className="versions-list">
                  {versions.map((v, i) => (
                    <button
                      key={i}
                      className={`version-chip ${activeVersion === v ? "active" : ""}`}
                      onClick={() => handleVersionClick(v)}
                    >
                      v{i + 1}: {v.prompt.slice(0, 22)}…
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input */}
            <div className="input-area">
              <textarea
                className="input-box"
                rows={2}
                placeholder={
                  currentSite
                    ? "Refine: change colors, add section, update text…"
                    : "Describe the website you want to build…"
                }
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

          {/* ── Right Panel: Preview / Code ── */}
          <div className="preview-panel">
            {currentSite ? (
              <>
                {/* Tab bar */}
                <div className="preview-tabs">
                  <div className="preview-tab-group">
                    {["preview", "html", "css", "js"].map((tab) => (
                      <button
                        key={tab}
                        className={`tab ${activeTab === tab ? "tab--active" : ""}`}
                        onClick={() => setActiveTab(tab)}
                      >
                        {tab.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <div className="site-title-badge">{currentSite.title}</div>
                </div>

                {/* Preview */}
                {activeTab === "preview" && (
                  <div className="preview-viewport">
                    <div className="preview-frame-wrapper" style={{ width: currentDevice.width }}>
                      <iframe
                        key={activeVersion}
                        className="preview-frame"
                        title="Generated Site"
                        srcDoc={buildFullHTML(currentSite)}
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                      />
                    </div>
                  </div>
                )}

                {/* Code view */}
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

export default App;