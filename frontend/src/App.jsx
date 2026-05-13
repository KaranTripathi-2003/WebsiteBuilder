import { useState, useRef, useEffect, useCallback } from "react";
import "./App.css";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

const EXAMPLE_PROMPTS = [
  "🚀 SaaS landing page for an AI productivity app",
  "🎨 Portfolio for a motion designer",
  "☕ Landing page for a premium coffee shop",
  "🛒 E-commerce product page for luxury sneakers",
  "🏋️ Fitness studio website with class schedules",
];

const LOADING_STAGES = [
  { label: "Thinking...", icon: "🧠", duration: 1200 },
  { label: "Writing code...", icon: "⌨️", duration: 2000 },
  { label: "Styling...", icon: "🎨", duration: 1500 },
  { label: "Rendering...", icon: "✨", duration: 800 },
];

const DEVICES = [
  { id: "desktop", icon: "🖥️", label: "Desktop", width: "100%" },
  { id: "tablet", icon: "📱", label: "Tablet", width: "768px" },
  { id: "mobile", icon: "📲", label: "Mobile", width: "375px" },
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
  const [activeTab, setActiveTab] = useState("preview");
  const [device, setDevice] = useState("desktop");
  const [loadingStage, setLoadingStage] = useState(0);
  const [streamProgress, setStreamProgress] = useState(0);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const stageTimerRef = useRef(null);

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
    const msg = (messageText || input).trim();
    if (!msg || isLoading) return;

    setInput("");
    const isRefinement = !!currentSite;

    setMessages((prev) => [...prev, { role: "user", text: msg }]);
    setIsLoading(true);
    advanceLoadingStage();

    try {
      const res = await fetch(`${API_URL}/generate/stream`, {
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

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let charCount = 0;

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
              const newVersion = { ...site, prompt: msg, timestamp: new Date() };
              setVersions((prev) => [...prev, newVersion]);
              setActiveVersion(newVersion);
              setActiveTab("preview");

              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  text: isRefinement
                    ? `✅ Updated! Refined based on your request.`
                    : `✅ Built **${site.title}**! Refine it or download below.`,
                  site,
                },
              ]);
            }

            if (event.type === "error") {
              throw new Error(event.message);
            }
          } catch (parseErr) {
            // skip malformed SSE line
          }
        }
      }
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
      stopLoadingStage();
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
    setActiveTab("preview");
    setMessages([
      {
        role: "assistant",
        text: "Starting fresh! Describe your next website.",
      },
    ]);
  };

  const downloadHTML = () => {
    if (!currentSite) return;
    const blob = new Blob([buildFullHTML(currentSite)], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentSite.title.replace(/\s+/g, "-").toLowerCase()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyCode = () => {
    if (currentSite) {
      navigator.clipboard.writeText(buildFullHTML(currentSite));
    }
  };

  const currentDevice = DEVICES.find((d) => d.id === device);

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
              <button className="btn btn-ghost" onClick={copyCode}>
                Copy
              </button>
              <button className="btn btn-ghost btn-download" onClick={downloadHTML}>
                ↓ Download
              </button>
              <button className="btn btn-primary" onClick={handleNewSite}>
                + New
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
              <div
                key={i}
                className={`message message--${m.role} ${m.isError ? "message--error" : ""}`}
              >
                {m.role === "assistant" && <div className="avatar">⚡</div>}
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
                <div className="avatar avatar--pulse">⚡</div>
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
                    v{i + 1}: {v.prompt.slice(0, 24)}…
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
              {isLoading ? "⏳" : "⚡"}
            </button>
          </div>
        </div>

        {/* ── Right Panel: Preview / Code ── */}
        <div className="preview-panel">
          {currentSite ? (
            <>
              <div className="preview-tabs">
                {["preview", "html", "css", "js"].map((tab) => (
                  <button
                    key={tab}
                    className={`tab ${activeTab === tab ? "tab--active" : ""}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab.toUpperCase()}
                  </button>
                ))}
                <div className="site-title-badge">{currentSite.title}</div>
              </div>

              {activeTab === "preview" && (
                <div className="preview-viewport">
                  <div
                    className="preview-frame-wrapper"
                    style={{ width: currentDevice.width }}
                  >
                    <iframe
                      className="preview-frame"
                      title="Generated Site"
                      srcDoc={buildFullHTML(currentSite)}
                      sandbox="allow-scripts allow-same-origin"
                    />
                  </div>
                </div>
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