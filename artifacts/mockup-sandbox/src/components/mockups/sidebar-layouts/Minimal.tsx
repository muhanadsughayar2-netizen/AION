import { useState } from "react";
import {
  Camera, Scissors, FileImage, Send, X,
  ChevronUp, Sparkles, Plus, Trash2
} from "lucide-react";

const snaps = [
  { id: 1, color: "#1e3a5f", label: "Dashboard" },
  { id: 2, color: "#2d1b4e", label: "Settings" },
  { id: 3, color: "#1a3d2b", label: "Analytics" },
  { id: 4, color: "#3d2010", label: "Profile" },
  { id: 5, color: "#1e2d45", label: "Logs" },
];

const messages = [
  {
    role: "ai",
    text: "Hello! I can see 5 screenshots in your queue. What would you like to know about them?",
    time: "2:41 PM",
  },
  {
    role: "user",
    text: "Summarize the key differences across all 5 screens",
    time: "2:41 PM",
  },
  {
    role: "ai",
    text: "Here's a quick rundown:\n\n**Dashboard** — High-level metrics, revenue trending up. Clean layout with cards.\n\n**Settings** — Dense form layout. A few contrast issues on button labels.\n\n**Analytics** — Chart-heavy. Good data density but legend is hard to read at small sizes.\n\n**Profile** — Avatar + bio. Minimalist — could use more visual hierarchy.\n\n**Logs** — Technical table view. Works well for power users.",
    time: "2:42 PM",
  },
];

export function Minimal() {
  const [input, setInput] = useState("");
  const [trayOpen, setTrayOpen] = useState(false);
  const [trayExpanded, setTrayExpanded] = useState(false);

  const trayHeight = trayExpanded ? 260 : 100;

  return (
    <div
      style={{
        width: 390,
        height: 820,
        background: "#0a0c12",
        fontFamily: "'Inter', system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        color: "#e0e4f0",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* ── HEADER — ultra minimal ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 18px 12px",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>📸</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>Snap To AI</span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {/* Inline quick-capture — just icons */}
          {[
            { icon: <Camera size={16} />, label: "Snap" },
            { icon: <Scissors size={16} />, label: "Snip" },
            { icon: <FileImage size={16} />, label: "Full" },
          ].map(({ icon, label }) => (
            <button
              key={label}
              title={label}
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.09)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#7a8499",
                cursor: "pointer",
              }}
            >
              {icon}
            </button>
          ))}
          <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.08)" }} />
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 700,
              color: "#fff",
            }}
          >
            J
          </div>
        </div>
      </div>

      {/* ── CHAT — fills all space ── */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 18px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          scrollbarWidth: "none",
          paddingBottom: trayOpen ? trayHeight + 80 : 80,
        }}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: m.role === "user" ? "flex-end" : "flex-start",
              gap: 4,
            }}
          >
            {m.role === "ai" && (
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, #3b5bdb, #7b52d4)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Sparkles size={10} style={{ color: "#fff" }} />
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, color: "#4a5568" }}>Gemini</span>
                <span style={{ fontSize: 10, color: "#333" }}>·</span>
                <span style={{ fontSize: 10, color: "#333" }}>{m.time}</span>
              </div>
            )}
            <div
              style={{
                maxWidth: "88%",
                padding: "11px 15px",
                borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "4px 16px 16px 16px",
                background: m.role === "user"
                  ? "linear-gradient(135deg, #2c44c4 0%, #3d5bd5 100%)"
                  : "rgba(255,255,255,0.04)",
                border: m.role === "ai" ? "1px solid rgba(255,255,255,0.06)" : "none",
                fontSize: 13,
                lineHeight: 1.65,
                color: m.role === "user" ? "#eef0ff" : "#b8bdd0",
                whiteSpace: "pre-line",
              }}
            >
              {m.text}
            </div>
            {m.role === "user" && (
              <span style={{ fontSize: 10, color: "#333", paddingRight: 4 }}>{m.time}</span>
            )}
          </div>
        ))}

        {/* Streaming indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #3b5bdb, #7b52d4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Sparkles size={10} style={{ color: "#fff" }} />
          </div>
          <div
            style={{
              padding: "10px 14px",
              borderRadius: "4px 16px 16px 16px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#4c6ef5",
                    animation: `blink 1.2s ease-in-out ${i * 0.2}s infinite`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── SLIDE-UP SNAPS TRAY ── */}
      {trayOpen && (
        <div
          style={{
            position: "absolute",
            bottom: 72,
            left: 0,
            right: 0,
            height: trayHeight,
            background: "rgba(14,17,26,0.97)",
            backdropFilter: "blur(20px)",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            transition: "height 0.25s cubic-bezier(.4,0,.2,1)",
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 16px 8px",
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, color: "#8892a4", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {snaps.length} Snaps queued
            </span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={() => setTrayExpanded(!trayExpanded)}
                style={{ background: "none", border: "none", color: "#4a5568", cursor: "pointer", display: "flex" }}
              >
                <ChevronUp size={14} style={{ transform: trayExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
              </button>
              <button
                onClick={() => setTrayOpen(false)}
                style={{ background: "none", border: "none", color: "#4a5568", cursor: "pointer", display: "flex" }}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Snap thumbnails */}
          <div style={{ flex: 1, display: "flex", gap: 8, padding: "0 16px", overflowX: "auto", alignItems: "center", scrollbarWidth: "none" }}>
            {snaps.map((s) => (
              <div
                key={s.id}
                style={{
                  flexShrink: 0,
                  position: "relative",
                  width: trayExpanded ? 100 : 72,
                  height: trayExpanded ? 72 : 52,
                  borderRadius: 8,
                  background: s.color,
                  border: "1px solid rgba(255,255,255,0.12)",
                  transition: "all 0.2s",
                  cursor: "pointer",
                  overflow: "hidden",
                }}
              >
                <div style={{ position: "absolute", inset: 0, padding: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.2)" }} />
                  <div style={{ height: 2, borderRadius: 2, background: "rgba(255,255,255,0.1)", width: "75%" }} />
                  <div style={{ height: 2, borderRadius: 2, background: "rgba(255,255,255,0.1)", width: "55%" }} />
                </div>
                {trayExpanded && (
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "2px 5px", background: "rgba(0,0,0,0.5)" }}>
                    <span style={{ fontSize: 9, color: "#aaa", fontWeight: 500 }}>{s.label}</span>
                  </div>
                )}
                <button
                  style={{
                    position: "absolute",
                    top: 3,
                    right: 3,
                    width: 15,
                    height: 15,
                    borderRadius: "50%",
                    background: "rgba(0,0,0,0.65)",
                    border: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    color: "#aaa",
                  }}
                >
                  <X size={8} />
                </button>
              </div>
            ))}
            <div
              style={{
                flexShrink: 0,
                width: trayExpanded ? 100 : 72,
                height: trayExpanded ? 72 : 52,
                borderRadius: 8,
                border: "1.5px dashed rgba(255,255,255,0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "#333",
                transition: "all 0.2s",
              }}
            >
              <Plus size={16} />
            </div>
          </div>

          {trayExpanded && (
            <div style={{ padding: "8px 16px 10px", display: "flex", gap: 6 }}>
              <button
                style={{
                  flex: 1,
                  padding: "8px",
                  borderRadius: 10,
                  background: "rgba(76,110,245,0.2)",
                  border: "1px solid rgba(76,110,245,0.3)",
                  color: "#7b97ff",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
                onClick={() => setTrayOpen(false)}
              >
                <Send size={12} />
                Send all to chat
              </button>
              <button
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  background: "rgba(255,80,80,0.1)",
                  border: "1px solid rgba(255,80,80,0.2)",
                  color: "#ff6060",
                  fontSize: 12,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── BOTTOM INPUT BAR ── */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "10px 14px 18px",
          background: "rgba(10,12,18,0.95)",
          backdropFilter: "blur(20px)",
          borderTop: "1px solid rgba(255,255,255,0.07)",
          zIndex: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 16,
            padding: "8px 8px 8px 14px",
          }}
        >
          {/* Snaps tray toggle */}
          <button
            onClick={() => setTrayOpen(!trayOpen)}
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: trayOpen ? "rgba(76,110,245,0.2)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${trayOpen ? "rgba(76,110,245,0.4)" : "rgba(255,255,255,0.08)"}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: trayOpen ? "#7b97ff" : "#556070",
              flexShrink: 0,
              position: "relative",
            }}
          >
            <Camera size={15} />
            {snaps.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: -4,
                  right: -4,
                  width: 15,
                  height: 15,
                  borderRadius: "50%",
                  background: "#4c6ef5",
                  fontSize: 9,
                  fontWeight: 700,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1.5px solid #0a0c12",
                }}
              >
                {snaps.length}
              </div>
            )}
          </button>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Gemini anything…"
            rows={1}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              color: "#e0e4f0",
              fontSize: 13,
              lineHeight: 1.5,
              resize: "none",
              fontFamily: "inherit",
              caretColor: "#4c6ef5",
            }}
          />

          <button
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: input.trim() ? "linear-gradient(135deg, #2c44c4, #3d5bd5)" : "rgba(255,255,255,0.05)",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: input.trim() ? "#fff" : "#333",
              cursor: input.trim() ? "pointer" : "default",
              flexShrink: 0,
              transition: "all 0.2s",
            }}
          >
            <Send size={15} />
          </button>
        </div>
      </div>

      <style>{`
        @keyframes blink {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
