import { useState, useRef, useEffect } from "react";
import "./App.css";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

const EXAMPLE_PROMPTS = [
  "🚀 SaaS landing page for a productivity app",
  "🎨 Portfolio for a UI/UX designer",
  "📋 Contact form with modern card design",
  "🛒 E-commerce product page for sneakers",
  "📊 Dashboard with stats and charts",
];

function App() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Hey! Describe any website and I'll build it live in seconds. Try one of the examples →",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentSite, setCurrentSite] = useState(null);
  const [versions, setVersions] = useState([]);
  const [activeVersion, setActiveVersion] = useState(null);
  const [showCode, setShowCode] = useState(false);
  const [activeTab, setActiveTab] = useState("preview");
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const buildFullHTML = (site) => {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${site.title}</title>
  <style>${site.css}</style>
</head>
<body>
${site.html}
<script>${site.js}</` + `script>
</body>
</html>`;
  };

  const handleSend = async (messageText) => {
    const msg = (messageText || input).trim();
    if (!msg || isLoading) return;

    setInput("");
    const isRefinement = !!currentSite;

    setMessages((prev) => [...prev, { role: "user", text: msg }]);
    setIsLoading(true);

    try {
      const res = await fetch(`${API_URL}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          previous_html: currentSite?.html || "",
          previous_css: currentSite?.css || "",
          previous_js: currentSite?.js || "",
          is_refinement: isRefinement,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Generation failed");
      }

      const site = await res.json();
      setCurrentSite(site);

      const newVersion = { ...site, prompt: msg, timestamp: new Date() };
      setVersions((prev) => [...prev, newVersion]);
      setActiveVersion(newVersion);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: isRefinement
            ? `✅ Updated! I refined the site based on your request. You can keep refining or start fresh.`
            : `✅ Built **${site.title}**! You can now refine it — just describe what to change.`,
          site,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `❌ Error: ${err.message}. Please try again.`,
          isError: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleVersionClick = (v) => {
    setActiveVersion(v);
    setCurrentSite(v);
  };

  const handleNewSite = () => {
    setCurrentSite(null);
    setVersions([]);
    setActiveVersion(null);
    setMessages([
      {
        role: "assistant",
        text: "Starting fresh! Describe your next website.",
      },
    ]);
  };

  const copyCode = () => {
    if (currentSite) {
      navigator.clipboard.writeText(buildFullHTML(currentSite));
    }
  };

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <span className="logo-icon">⚡</span>
            <span className="logo-text">SiteForge</span>
            <span className="logo-badge">AI</span>
          </div>
        </div>
        <div className="header-right">
          {currentSite && (
            <>
              <button className="btn btn-ghost" onClick={() => setShowCode(!showCode)}>
                {showCode ? "Hide Code" : "View Code"}
              </button>
              <button className="btn btn-ghost" onClick={copyCode}>
                Copy HTML
              </button>
              <button className="btn btn-primary" onClick={handleNewSite}>
                + New Site
              </button>
            </>
          )}
        </div>
      </header>

      <div className="main">
        {/* ── Left Panel: Chat ── */}
        <div className="chat-panel">
          <div className="messages">
            {messages.map((m, i) => (
              <div key={i} className={`message message--${m.role} ${m.isError ? "message--error" : ""}`}>
                {m.role === "assistant" && (
                  <div className="avatar">⚡</div>
                )}
                <div className="bubble">
                  {m.text.split("**").map((part, j) =>
                    j % 2 === 1 ? <strong key={j}>{part}</strong> : part
                  )}
                </div>
                {m.role === "user" && (
                  <div className="avatar avatar--user">U</div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="message message--assistant">
                <div className="avatar">⚡</div>
                <div className="bubble bubble--loading">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                  <span className="loading-text">Generating your site...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Example prompts — show only when no site yet */}
          {!currentSite && !isLoading && (
            <div className="examples">
              {EXAMPLE_PROMPTS.map((p, i) => (
                <button
                  key={i}
                  className="example-chip"
                  onClick={() => handleSend(p.slice(2).trim())}
                >
                  {p}
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
                    v{i + 1}: {v.prompt.slice(0, 28)}…
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="input-area">
            <textarea
              ref={textareaRef}
              className="input-box"
              rows={2}
              placeholder={
                currentSite
                  ? "Refine: change colors, add a section, update text…"
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
              {isLoading ? "⏳" : "⚡"}
            </button>
          </div>
        </div>

        {/* ── Right Panel: Preview / Code ── */}
        <div className="preview-panel">
          {currentSite ? (
            <>
              <div className="preview-tabs">
                <button
                  className={`tab ${activeTab === "preview" ? "tab--active" : ""}`}
                  onClick={() => setActiveTab("preview")}
                >
                  Preview
                </button>
                <button
                  className={`tab ${activeTab === "html" ? "tab--active" : ""}`}
                  onClick={() => setActiveTab("html")}
                >
                  HTML
                </button>
                <button
                  className={`tab ${activeTab === "css" ? "tab--active" : ""}`}
                  onClick={() => setActiveTab("css")}
                >
                  CSS
                </button>
                <button
                  className={`tab ${activeTab === "js" ? "tab--active" : ""}`}
                  onClick={() => setActiveTab("js")}
                >
                  JS
                </button>
                <div className="site-title-badge">{currentSite.title}</div>
              </div>

              {activeTab === "preview" && (
                <iframe
                  className="preview-frame"
                  title="Generated Site"
                  srcDoc={buildFullHTML(currentSite)}
                  sandbox="allow-scripts allow-same-origin"
                />
              )}

              {activeTab !== "preview" && (
                <pre className="code-view">
                  <code>
                    {activeTab === "html" && currentSite.html}
                    {activeTab === "css" && currentSite.css}
                    {activeTab === "js" && (currentSite.js || "// No JavaScript")}
                  </code>
                </pre>
              )}
            </>
          ) : (
            <div className="empty-preview">
              <div className="empty-icon">🌐</div>
              <h2>Your site will appear here</h2>
              <p>Type a description in the chat and hit ⚡ to generate</p>
              <div className="empty-hint">
                <span>Try: "landing page for a coffee shop"</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;




