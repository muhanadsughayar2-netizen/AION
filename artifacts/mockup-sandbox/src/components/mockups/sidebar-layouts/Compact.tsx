import { useState } from "react";
import {
  Camera, Scissors, FileImage, Send, Paperclip,
  X, ChevronDown, ChevronUp, Sparkles, Trash2, Download
} from "lucide-react";

const snaps = [
  { id: 1, label: "Snap 1", color: "#1e3a5f" },
  { id: 2, label: "Snap 2", color: "#2d1b4e" },
  { id: 3, label: "Snap 3", color: "#1a3d2b" },
  { id: 4, label: "Snap 4", color: "#3d2010" },
  { id: 5, label: "Snap 5", color: "#1e2d45" },
];

const messages = [
  { role: "user", text: "Can you explain what's in these screenshots?", snaps: [1, 2] },
  { role: "ai", text: "Sure! The first screenshot shows a dashboard with key metrics — revenue trending up 12% this week. The second shows a settings panel where authentication options are configured." },
  { role: "user", text: "What should I improve on the settings page?", snaps: [2] },
];

export function Compact() {
  const [input, setInput] = useState("");
  const [snapsTrayOpen, setSnapsTrayOpen] = useState(true);
  const [selectedModel, setSelectedModel] = useState("2.5 Flash");

  return (
    <div
      style={{
        width: 390,
        height: 820,
        background: "linear-gradient(160deg, #0f1117 0%, #141824 100%)",
        fontFamily: "'Inter', system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        color: "#e8eaf0",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* ── TOP BAR ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(255,255,255,0.03)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>📸</span>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.02em", color: "#fff" }}>Snap To AI</span>
        </div>

        {/* Capture strip — inline, compact */}
        <div style={{ display: "flex", gap: 6 }}>
          {[
            { icon: <Camera size={14} />, label: "Snap" },
            { icon: <Scissors size={14} />, label: "Snip" },
            { icon: <FileImage size={14} />, label: "Full" },
          ].map(({ icon, label }) => (
            <button
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "5px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.06)",
                color: "#c8cce0",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── SNAPS TRAY (collapsible) ── */}
      <div
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(255,255,255,0.02)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 14px",
            cursor: "pointer",
          }}
          onClick={() => setSnapsTrayOpen(!snapsTrayOpen)}
        >
          <span style={{ fontSize: 11, fontWeight: 600, color: "#8892a4", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Snaps · {snaps.length}
          </span>
          <span style={{ color: "#556070" }}>
            {snapsTrayOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </span>
        </div>

        {snapsTrayOpen && (
          <div
            style={{
              display: "flex",
              gap: 8,
              padding: "0 14px 10px",
              overflowX: "auto",
              scrollbarWidth: "none",
            }}
          >
            {snaps.map((s) => (
              <div
                key={s.id}
                style={{
                  position: "relative",
                  flexShrink: 0,
                  width: 58,
                  height: 44,
                  borderRadius: 8,
                  background: s.color,
                  border: "1px solid rgba(255,255,255,0.1)",
                  cursor: "pointer",
                  overflow: "hidden",
                }}
              >
                {/* mini screenshot simulation */}
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", padding: 3, gap: 2 }}>
                  <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.2)" }} />
                  <div style={{ height: 2, borderRadius: 2, background: "rgba(255,255,255,0.1)", width: "70%" }} />
                  <div style={{ height: 2, borderRadius: 2, background: "rgba(255,255,255,0.1)", width: "50%" }} />
                </div>
                <button
                  style={{
                    position: "absolute",
                    top: 2,
                    right: 2,
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: "rgba(0,0,0,0.6)",
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

            {/* Upload placeholder */}
            <div
              style={{
                flexShrink: 0,
                width: 58,
                height: 44,
                borderRadius: 8,
                border: "1.5px dashed rgba(255,255,255,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "#4a5568",
              }}
            >
              <Paperclip size={14} />
            </div>
          </div>
        )}
      </div>

      {/* ── CHAT AREA — takes remaining space ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 0", display: "flex", flexDirection: "column", gap: 14, scrollbarWidth: "none" }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start", gap: 6 }}>
            {/* snap badges attached to message */}
            {m.snaps && m.snaps.length > 0 && (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                {m.snaps.map((sid) => {
                  const snap = snaps.find((s) => s.id === sid);
                  return (
                    <div
                      key={sid}
                      style={{
                        width: 36,
                        height: 28,
                        borderRadius: 5,
                        background: snap?.color ?? "#222",
                        border: "1px solid rgba(255,255,255,0.12)",
                      }}
                    />
                  );
                })}
              </div>
            )}
            <div
              style={{
                maxWidth: "82%",
                padding: "9px 13px",
                borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                background: m.role === "user"
                  ? "linear-gradient(135deg, #3b5bdb 0%, #4c6ef5 100%)"
                  : "rgba(255,255,255,0.06)",
                border: m.role === "ai" ? "1px solid rgba(255,255,255,0.08)" : "none",
                fontSize: 13,
                lineHeight: 1.55,
                color: m.role === "user" ? "#fff" : "#d0d4e0",
              }}
            >
              {m.text}
            </div>
          </div>
        ))}

        {/* AI typing indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ display: "flex", gap: 4, padding: "9px 13px", borderRadius: "14px 14px 14px 4px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: 6, height: 6, borderRadius: "50%", background: "#4c6ef5",
                  animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            ))}
          </div>
        </div>

        <div style={{ height: 12 }} />
      </div>

      {/* ── INPUT BAR ── */}
      <div
        style={{
          padding: "10px 12px 14px",
          borderTop: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(255,255,255,0.02)",
          flexShrink: 0,
        }}
      >
        {/* Model selector */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 4 }}>
            {["2.0 Flash", "2.5 Flash", "2.5 Pro"].map((m) => (
              <button
                key={m}
                onClick={() => setSelectedModel(m)}
                style={{
                  padding: "3px 8px",
                  borderRadius: 6,
                  border: "1px solid",
                  borderColor: selectedModel === m ? "rgba(76,110,245,0.6)" : "rgba(255,255,255,0.08)",
                  background: selectedModel === m ? "rgba(76,110,245,0.15)" : "transparent",
                  color: selectedModel === m ? "#7b97ff" : "#556070",
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {m}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ background: "none", border: "none", color: "#4a5568", cursor: "pointer", padding: 2 }}>
              <Download size={13} />
            </button>
            <button style={{ background: "none", border: "none", color: "#4a5568", cursor: "pointer", padding: 2 }}>
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Input row */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 14,
            padding: "8px 10px 8px 14px",
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your snaps…"
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
              background: input.trim() ? "linear-gradient(135deg, #3b5bdb, #4c6ef5)" : "rgba(255,255,255,0.06)",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: input.trim() ? "#fff" : "#4a5568",
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
        @keyframes pulse {
          0%, 80%, 100% { transform: scale(0.7); opacity: 0.5; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
