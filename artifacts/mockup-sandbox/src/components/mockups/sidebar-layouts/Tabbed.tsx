import { useState } from "react";
import {
  Camera, Scissors, FileImage, Send, X, Maximize2,
  MessageSquare, Zap, ChevronRight, Trash2, Download,
  Monitor
} from "lucide-react";

const snaps = [
  { id: 1, color: "#1e3a5f", w: "70%", label: "Dashboard view" },
  { id: 2, color: "#2d1b4e", w: "55%", label: "Settings panel" },
  { id: 3, color: "#1a3d2b", w: "80%", label: "Analytics chart" },
  { id: 4, color: "#3d2010", w: "60%", label: "User profile" },
];

const messages = [
  { role: "user", text: "What's wrong with this settings UI?", snaps: [1, 2] },
  { role: "ai", text: "A few issues stand out:\n\n1. The contrast ratio on the secondary buttons is below WCAG AA standard\n2. The form fields lack visible focus states\n3. The spacing between sections is inconsistent — some have 16px, others 24px" },
];

export function Tabbed() {
  const [tab, setTab] = useState<"capture" | "chat">("chat");
  const [input, setInput] = useState("");
  const [selectedSnap, setSelectedSnap] = useState<number | null>(1);

  return (
    <div
      style={{
        width: 390,
        height: 820,
        background: "linear-gradient(160deg, #0d1018 0%, #111522 100%)",
        fontFamily: "'Inter', system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        color: "#e0e4f0",
        overflow: "hidden",
      }}
    >
      {/* ── HEADER ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px 0",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>📸</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Snap To AI</span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 9px",
              borderRadius: 20,
              background: "rgba(76,110,245,0.15)",
              border: "1px solid rgba(76,110,245,0.3)",
              fontSize: 10,
              fontWeight: 700,
              color: "#7b97ff",
            }}
          >
            <Zap size={9} />
            PRO
          </div>
          <div
            style={{
              width: 26,
              height: 26,
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

      {/* ── TAB SWITCHER ── */}
      <div
        style={{
          display: "flex",
          margin: "12px 16px 0",
          background: "rgba(255,255,255,0.04)",
          borderRadius: 12,
          padding: 3,
          border: "1px solid rgba(255,255,255,0.07)",
          flexShrink: 0,
        }}
      >
        {[
          { key: "capture", icon: <Camera size={13} />, label: "Capture" },
          { key: "chat", icon: <MessageSquare size={13} />, label: "Chat" },
        ].map(({ key, icon, label }) => (
          <button
            key={key}
            onClick={() => setTab(key as any)}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "8px 0",
              borderRadius: 9,
              border: "none",
              background: tab === key ? "rgba(76,110,245,0.2)" : "transparent",
              color: tab === key ? "#7b97ff" : "#556070",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.18s",
              boxShadow: tab === key ? "0 1px 8px rgba(76,110,245,0.15)" : "none",
            }}
          >
            {icon}
            {label}
            {key === "capture" && snaps.length > 0 && (
              <span
                style={{
                  background: tab === key ? "#4c6ef5" : "#2a3444",
                  color: "#fff",
                  borderRadius: 8,
                  fontSize: 9,
                  fontWeight: 700,
                  padding: "1px 5px",
                  lineHeight: "14px",
                }}
              >
                {snaps.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── CAPTURE TAB ── */}
      {tab === "capture" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Live preview */}
          <div style={{ padding: "14px 16px 0", flexShrink: 0 }}>
            <div
              style={{
                width: "100%",
                aspectRatio: "16/9",
                borderRadius: 12,
                background: "linear-gradient(135deg, #1a2035 0%, #0f1824 100%)",
                border: "1px solid rgba(255,255,255,0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* Simulated live page */}
              <div style={{ position: "absolute", inset: 0, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ width: 20, height: 20, borderRadius: 4, background: "rgba(76,110,245,0.4)" }} />
                  <div style={{ height: 6, width: "40%", borderRadius: 3, background: "rgba(255,255,255,0.15)" }} />
                  <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                    <div style={{ height: 6, width: 28, borderRadius: 3, background: "rgba(255,255,255,0.08)" }} />
                    <div style={{ height: 6, width: 28, borderRadius: 3, background: "rgba(255,255,255,0.08)" }} />
                  </div>
                </div>
                {[80, 60, 90, 45, 70].map((w, i) => (
                  <div key={i} style={{ height: 5, width: `${w}%`, borderRadius: 3, background: "rgba(255,255,255,0.07)" }} />
                ))}
                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  {[1, 2, 3].map((i) => (
                    <div key={i} style={{ flex: 1, height: 30, borderRadius: 6, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.06)" }} />
                  ))}
                </div>
              </div>
              <div style={{ position: "absolute", top: 8, right: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(0,0,0,0.6)", borderRadius: 20, padding: "3px 8px" }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e" }} />
                  <span style={{ fontSize: 9, color: "#aaa" }}>Live</span>
                </div>
              </div>
              <button style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: 4, color: "#aaa", cursor: "pointer", display: "flex" }}>
                <Maximize2 size={11} />
              </button>
            </div>
          </div>

          {/* Capture buttons */}
          <div style={{ padding: "12px 16px", display: "flex", gap: 8, flexShrink: 0 }}>
            {[
              { icon: <Camera size={15} />, label: "Snap", accent: "#3b5bdb" },
              { icon: <Scissors size={15} />, label: "Snip", accent: "#1a7a52" },
              { icon: <FileImage size={15} />, label: "Full Page", accent: "#6b21a8" },
            ].map(({ icon, label, accent }) => (
              <button
                key={label}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 5,
                  padding: "10px 6px",
                  borderRadius: 12,
                  border: `1px solid ${accent}44`,
                  background: `${accent}18`,
                  color: "#c0c8e0",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                <span style={{ color: accent }}>{icon}</span>
                <span style={{ fontSize: 11, fontWeight: 600 }}>{label}</span>
              </button>
            ))}
          </div>

          {/* Snaps queue */}
          <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 14px", scrollbarWidth: "none" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#8892a4", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Queue · {snaps.length}
              </span>
              <button style={{ background: "none", border: "none", color: "#4a5568", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                Clear all
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {snaps.map((s, i) => (
                <div
                  key={s.id}
                  onClick={() => setSelectedSnap(s.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: `1px solid ${selectedSnap === s.id ? "rgba(76,110,245,0.4)" : "rgba(255,255,255,0.07)"}`,
                    background: selectedSnap === s.id ? "rgba(76,110,245,0.08)" : "rgba(255,255,255,0.03)",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  <div
                    style={{
                      width: 52,
                      height: 36,
                      borderRadius: 6,
                      background: s.color,
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Monitor size={12} style={{ color: "rgba(255,255,255,0.3)" }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#c8cce0" }}>{s.label}</div>
                    <div style={{ fontSize: 10, color: "#556070", marginTop: 2 }}>Just now · Snap {i + 1}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button style={{ background: "none", border: "none", color: "#4a5568", cursor: "pointer", padding: 3 }}>
                      <Download size={13} />
                    </button>
                    <button style={{ background: "none", border: "none", color: "#4a5568", cursor: "pointer", padding: 3 }}>
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Send to chat CTA */}
          <div style={{ padding: "10px 16px 16px", flexShrink: 0 }}>
            <button
              onClick={() => setTab("chat")}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "12px",
                borderRadius: 12,
                background: "linear-gradient(135deg, #3b5bdb 0%, #4c6ef5 100%)",
                border: "none",
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 4px 20px rgba(76,110,245,0.3)",
              }}
            >
              <MessageSquare size={15} />
              Send {snaps.length} snaps to Chat
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ── CHAT TAB ── */}
      {tab === "chat" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Attached snaps pill */}
          <div style={{ padding: "10px 16px 0", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none" }}>
              {snaps.slice(0, 2).map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "4px 8px 4px 5px",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    flexShrink: 0,
                  }}
                >
                  <div style={{ width: 20, height: 15, borderRadius: 3, background: s.color }} />
                  <span style={{ fontSize: 10, color: "#8892a4", fontWeight: 500 }}>{s.label}</span>
                  <X size={9} style={{ color: "#4a5568", cursor: "pointer" }} />
                </div>
              ))}
              <button
                onClick={() => setTab("capture")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 8px",
                  borderRadius: 8,
                  border: "1px dashed rgba(255,255,255,0.12)",
                  background: "transparent",
                  color: "#556070",
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <Camera size={11} />
                Add snap
              </button>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 0", display: "flex", flexDirection: "column", gap: 14, scrollbarWidth: "none" }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div
                  style={{
                    maxWidth: "85%",
                    padding: "10px 14px",
                    borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "4px 14px 14px 14px",
                    background: m.role === "user"
                      ? "linear-gradient(135deg, #3b5bdb 0%, #4c6ef5 100%)"
                      : "rgba(255,255,255,0.06)",
                    border: m.role === "ai" ? "1px solid rgba(255,255,255,0.08)" : "none",
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: m.role === "user" ? "#fff" : "#c8cce0",
                    whiteSpace: "pre-line",
                  }}
                >
                  {m.text}
                </div>
              </div>
            ))}
            <div style={{ height: 8 }} />
          </div>

          {/* Input */}
          <div style={{ padding: "10px 14px 16px", borderTop: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 4 }}>
                {["Flash", "Pro"].map((m) => (
                  <span key={m} style={{ fontSize: 10, color: "#556070", padding: "2px 7px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer" }}>
                    Gemini {m}
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={{ background: "none", border: "none", color: "#4a5568", cursor: "pointer" }}><Download size={13} /></button>
                <button style={{ background: "none", border: "none", color: "#4a5568", cursor: "pointer" }}><Trash2 size={13} /></button>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 8,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 14,
                padding: "9px 10px 9px 14px",
              }}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask Gemini about your snaps…"
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
                }}
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
