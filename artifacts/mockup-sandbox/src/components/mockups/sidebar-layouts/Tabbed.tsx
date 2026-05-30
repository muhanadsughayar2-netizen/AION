import { useState } from "react";
import {
  Camera, Scissors, FileImage, Send, X, Maximize2,
  MessageSquare, Zap, ChevronRight, Trash2, Download,
  Monitor, Search, Code, BookOpen, Wrench, FlaskConical,
  Paperclip, Sparkles, ChevronDown, Music, Video, Eye,
  ImageIcon, Play, AlignLeft, RotateCcw, Save, Users, Wand2
} from "lucide-react";

const snaps = [
  { id: 1, color: "#1e3a5f", label: "Dashboard view" },
  { id: 2, color: "#2d1b4e", label: "Settings panel" },
  { id: 3, color: "#1a3d2b", label: "Analytics chart" },
  { id: 4, color: "#3d2010", label: "User profile" },
];

const messages = [
  {
    role: "user",
    text: "What's wrong with this settings UI?",
    snaps: [1, 2],
  },
  {
    role: "ai",
    text: "A few issues stand out:\n\n1. Contrast ratio on secondary buttons is below WCAG AA\n2. Form fields lack visible focus states\n3. Spacing between sections is inconsistent",
  },
];

type AIMode = "vision" | "image" | "music" | "video";
type Tab = "capture" | "chat";

const AI_MODES: { key: AIMode; label: string; icon: React.ReactNode; color: string }[] = [
  { key: "vision", label: "Vision", icon: <Eye size={12} />, color: "#06b6d4" },
  { key: "image", label: "Image", icon: <ImageIcon size={12} />, color: "#f59e0b" },
  { key: "music", label: "Music", icon: <Music size={12} />, color: "#8b5cf6" },
  { key: "video", label: "Video", icon: <Video size={12} />, color: "#ec4899" },
];

const QUICK_ACTIONS = [
  { icon: <Wrench size={11} />, label: "Build" },
  { icon: <FlaskConical size={11} />, label: "Research" },
  { icon: <Search size={11} />, label: "Search" },
  { icon: <BookOpen size={11} />, label: "Read" },
  { icon: <Code size={11} />, label: "Code" },
];

const BOTTOM_ACTIONS = [
  { icon: <Play size={12} />, label: "Continue", accent: "#0d9488" },
  { icon: <AlignLeft size={12} />, label: "Summarize", accent: "#0d9488" },
  { icon: <RotateCcw size={12} />, label: "Clear", accent: "#374151" },
  { icon: <Save size={12} />, label: "Save", accent: "#374151" },
];

export function Tabbed() {
  const [tab, setTab] = useState<Tab>("chat");
  const [input, setInput] = useState("");
  const [selectedSnap, setSelectedSnap] = useState<number | null>(1);
  const [aiMode, setAiMode] = useState<AIMode>("vision");
  const [model, setModel] = useState("Gemini 2.5 Flash");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [attachedSnaps, setAttachedSnaps] = useState<number[]>([1, 2]);

  const modelOptions = ["Gemini 2.0 Flash", "Gemini 2.5 Flash", "Gemini 2.5 Pro"];

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
          padding: "10px 14px 0",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 17 }}>📸</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Snap To AI</span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 8px",
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
              width: 26, height: 26, borderRadius: "50%",
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700, color: "#fff",
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
          margin: "10px 14px 0",
          background: "rgba(255,255,255,0.04)",
          borderRadius: 11,
          padding: 3,
          border: "1px solid rgba(255,255,255,0.07)",
          flexShrink: 0,
        }}
      >
        {[
          { key: "capture" as Tab, icon: <Camera size={12} />, label: "Capture" },
          { key: "chat" as Tab, icon: <MessageSquare size={12} />, label: "Chat" },
        ].map(({ key, icon, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              flex: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 5, padding: "7px 0",
              borderRadius: 8, border: "none",
              background: tab === key ? "rgba(76,110,245,0.22)" : "transparent",
              color: tab === key ? "#7b97ff" : "#556070",
              fontSize: 12, fontWeight: 600, cursor: "pointer",
              transition: "all 0.18s",
            }}
          >
            {icon}
            {label}
            {key === "capture" && snaps.length > 0 && (
              <span
                style={{
                  background: tab === key ? "#4c6ef5" : "#2a3444",
                  color: "#fff", borderRadius: 8,
                  fontSize: 9, fontWeight: 700, padding: "1px 5px", lineHeight: "14px",
                }}
              >
                {snaps.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ════════════════ CAPTURE TAB ════════════════ */}
      {tab === "capture" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Live preview */}
          <div style={{ padding: "12px 14px 0", flexShrink: 0 }}>
            <div
              style={{
                width: "100%", aspectRatio: "16/9", borderRadius: 12,
                background: "linear-gradient(135deg, #1a2035 0%, #0f1824 100%)",
                border: "1px solid rgba(255,255,255,0.1)",
                position: "relative", overflow: "hidden",
              }}
            >
              <div style={{ position: "absolute", inset: 0, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ width: 18, height: 18, borderRadius: 4, background: "rgba(76,110,245,0.4)" }} />
                  <div style={{ height: 5, width: "40%", borderRadius: 3, background: "rgba(255,255,255,0.15)" }} />
                  <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                    {[28, 28].map((w, i) => <div key={i} style={{ height: 5, width: w, borderRadius: 3, background: "rgba(255,255,255,0.08)" }} />)}
                  </div>
                </div>
                {[80, 60, 90, 45, 70].map((w, i) => (
                  <div key={i} style={{ height: 4, width: `${w}%`, borderRadius: 3, background: "rgba(255,255,255,0.07)" }} />
                ))}
                <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                  {[1, 2, 3].map((i) => (
                    <div key={i} style={{ flex: 1, height: 28, borderRadius: 6, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.06)" }} />
                  ))}
                </div>
              </div>
              <div style={{ position: "absolute", top: 7, right: 7 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 3, background: "rgba(0,0,0,0.6)", borderRadius: 20, padding: "2px 7px" }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e" }} />
                  <span style={{ fontSize: 9, color: "#aaa" }}>Live</span>
                </div>
              </div>
              <button style={{ position: "absolute", bottom: 7, right: 7, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: 4, color: "#aaa", cursor: "pointer", display: "flex" }}>
                <Maximize2 size={11} />
              </button>
            </div>
          </div>

          {/* Capture buttons */}
          <div style={{ padding: "10px 14px", display: "flex", gap: 8, flexShrink: 0 }}>
            {[
              { icon: <Camera size={15} />, label: "Snap", accent: "#3b5bdb" },
              { icon: <Scissors size={15} />, label: "Snip", accent: "#1a7a52" },
              { icon: <FileImage size={15} />, label: "Full Page", accent: "#6b21a8" },
            ].map(({ icon, label, accent }) => (
              <button
                key={label}
                style={{
                  flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                  gap: 5, padding: "10px 6px", borderRadius: 12,
                  border: `1px solid ${accent}44`, background: `${accent}18`,
                  color: "#c0c8e0", cursor: "pointer",
                }}
              >
                <span style={{ color: accent }}>{icon}</span>
                <span style={{ fontSize: 11, fontWeight: 600 }}>{label}</span>
              </button>
            ))}
          </div>

          {/* Queue */}
          <div style={{ flex: 1, overflowY: "auto", padding: "0 14px 10px", scrollbarWidth: "none" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#8892a4", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Queue · {snaps.length}
              </span>
              <button style={{ background: "none", border: "none", color: "#4a5568", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>Clear all</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {snaps.map((s) => (
                <div
                  key={s.id}
                  onClick={() => setSelectedSnap(s.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                    borderRadius: 10, cursor: "pointer",
                    border: `1px solid ${selectedSnap === s.id ? "rgba(76,110,245,0.4)" : "rgba(255,255,255,0.07)"}`,
                    background: selectedSnap === s.id ? "rgba(76,110,245,0.08)" : "rgba(255,255,255,0.03)",
                  }}
                >
                  <div style={{ width: 50, height: 34, borderRadius: 6, background: s.color, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Monitor size={11} style={{ color: "rgba(255,255,255,0.3)" }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#c8cce0" }}>{s.label}</div>
                    <div style={{ fontSize: 10, color: "#556070", marginTop: 1 }}>Just now</div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button style={{ background: "none", border: "none", color: "#4a5568", cursor: "pointer", padding: 3 }}><Download size={12} /></button>
                    <button style={{ background: "none", border: "none", color: "#4a5568", cursor: "pointer", padding: 3 }}><X size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Send to Chat CTA */}
          <div style={{ padding: "8px 14px 14px", flexShrink: 0 }}>
            <button
              onClick={() => setTab("chat")}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                gap: 8, padding: "11px", borderRadius: 12,
                background: "linear-gradient(135deg, #3b5bdb 0%, #4c6ef5 100%)",
                border: "none", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
                boxShadow: "0 4px 20px rgba(76,110,245,0.3)",
              }}
            >
              <MessageSquare size={14} />
              Send {snaps.length} snaps to Chat
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ════════════════ CHAT TAB ════════════════ */}
      {tab === "chat" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Model selector row */}
          <div style={{ padding: "8px 14px 0", flexShrink: 0, position: "relative" }}>
            <button
              onClick={() => setShowModelPicker(!showModelPicker)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 10px 5px 8px", borderRadius: 20,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#a0a8c0", fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}
            >
              <Sparkles size={11} style={{ color: "#4c6ef5" }} />
              {model}
              <ChevronDown size={10} style={{ color: "#556070" }} />
            </button>

            {showModelPicker && (
              <div
                style={{
                  position: "absolute", top: 36, left: 14, zIndex: 50,
                  background: "#141824", border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 10, overflow: "hidden",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                }}
              >
                {modelOptions.map((m) => (
                  <button
                    key={m}
                    onClick={() => { setModel(m); setShowModelPicker(false); }}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "9px 14px", background: model === m ? "rgba(76,110,245,0.12)" : "transparent",
                      border: "none", color: model === m ? "#7b97ff" : "#a0a8c0",
                      fontSize: 12, fontWeight: model === m ? 600 : 400, cursor: "pointer",
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* AI Mode tabs */}
          <div style={{ padding: "8px 14px 0", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 4 }}>
              {AI_MODES.map(({ key, label, icon, color }) => (
                <button
                  key={key}
                  onClick={() => setAiMode(key)}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "5px 10px", borderRadius: 20, border: "1px solid",
                    borderColor: aiMode === key ? `${color}66` : "rgba(255,255,255,0.08)",
                    background: aiMode === key ? `${color}18` : "transparent",
                    color: aiMode === key ? color : "#556070",
                    fontSize: 11, fontWeight: 600, cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Attached snaps pills */}
          <div style={{ padding: "8px 14px 0", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 5, overflowX: "auto", scrollbarWidth: "none" }}>
              {attachedSnaps.map((sid) => {
                const s = snaps.find((x) => x.id === sid);
                return s ? (
                  <div
                    key={sid}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "3px 7px 3px 4px", borderRadius: 7,
                      background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                      flexShrink: 0,
                    }}
                  >
                    <div style={{ width: 18, height: 14, borderRadius: 3, background: s.color }} />
                    <span style={{ fontSize: 10, color: "#8892a4", fontWeight: 500 }}>{s.label}</span>
                    <X size={8} style={{ color: "#4a5568", cursor: "pointer" }}
                      onClick={() => setAttachedSnaps(attachedSnaps.filter((x) => x !== sid))} />
                  </div>
                ) : null;
              })}
              <button
                onClick={() => setTab("capture")}
                style={{
                  display: "flex", alignItems: "center", gap: 4, padding: "3px 8px",
                  borderRadius: 7, border: "1px dashed rgba(255,255,255,0.1)",
                  background: "transparent", color: "#4a5568",
                  fontSize: 10, fontWeight: 600, cursor: "pointer", flexShrink: 0,
                }}
              >
                <Camera size={10} />
                Add
              </button>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px 0", display: "flex", flexDirection: "column", gap: 12, scrollbarWidth: "none" }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div
                  style={{
                    maxWidth: "88%", padding: "9px 13px",
                    borderRadius: m.role === "user" ? "13px 13px 4px 13px" : "4px 13px 13px 13px",
                    background: m.role === "user"
                      ? "linear-gradient(135deg, #3b5bdb 0%, #4c6ef5 100%)"
                      : "rgba(255,255,255,0.05)",
                    border: m.role === "ai" ? "1px solid rgba(255,255,255,0.08)" : "none",
                    fontSize: 12.5, lineHeight: 1.6,
                    color: m.role === "user" ? "#fff" : "#c0c8d8",
                    whiteSpace: "pre-line",
                  }}
                >
                  {m.text}
                </div>
              </div>
            ))}
            <div style={{ height: 6 }} />
          </div>

          {/* ── BOTTOM CONTROLS ── */}
          <div
            style={{
              flexShrink: 0,
              borderTop: "1px solid rgba(255,255,255,0.07)",
              background: "rgba(10,12,18,0.6)",
              padding: "8px 12px 10px",
            }}
          >
            {/* Quick action chips */}
            <div style={{ display: "flex", gap: 5, marginBottom: 8, overflowX: "auto", scrollbarWidth: "none" }}>
              <button
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                  color: "#7a8499", cursor: "pointer",
                }}
              >
                <Paperclip size={12} />
              </button>
              {QUICK_ACTIONS.map(({ icon, label }) => (
                <button
                  key={label}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "5px 10px", borderRadius: 20, flexShrink: 0,
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
                    color: "#7a8499", fontSize: 11, fontWeight: 600, cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>

            {/* Input row */}
            <div
              style={{
                display: "flex", alignItems: "flex-end", gap: 8,
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 13, padding: "7px 8px 7px 12px",
                marginBottom: 8,
              }}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  aiMode === "vision" ? "Ask about your screenshots…" :
                  aiMode === "image" ? "Describe an image to generate…" :
                  aiMode === "music" ? "Describe the music you want…" :
                  "Describe the video you want…"
                }
                rows={1}
                style={{
                  flex: 1, background: "none", border: "none", outline: "none",
                  color: "#e0e4f0", fontSize: 12.5, lineHeight: 1.5,
                  resize: "none", fontFamily: "inherit", caretColor: "#4c6ef5",
                }}
              />
              <button
                style={{
                  width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                  background: input.trim() ? "linear-gradient(135deg, #3b5bdb, #4c6ef5)" : "rgba(255,255,255,0.06)",
                  border: "none", display: "flex", alignItems: "center", justifyContent: "center",
                  color: input.trim() ? "#fff" : "#4a5568", cursor: input.trim() ? "pointer" : "default",
                  transition: "all 0.2s",
                }}
              >
                <Send size={14} />
              </button>
            </div>

            {/* Analyze + Agent row */}
            <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
              {/* Analyze — primary CTA */}
              <button
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "7px 14px", borderRadius: 10,
                  background: "linear-gradient(135deg, #7c3aed 0%, #ec4899 100%)",
                  border: "none", color: "#fff", fontSize: 12, fontWeight: 700,
                  cursor: "pointer", flexShrink: 0,
                  boxShadow: "0 3px 14px rgba(124,58,237,0.35)",
                }}
              >
                <Zap size={12} />
                Analyze
              </button>
              {/* Agents */}
              <button
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "7px 10px", borderRadius: 10, flexShrink: 0,
                  background: "linear-gradient(135deg, #6d28d9, #7c3aed)",
                  border: "none", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}
              >
                <Users size={11} />
                Agents
              </button>
              {/* Magic Agents */}
              <button
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "7px 10px", borderRadius: 10, flexShrink: 0,
                  background: "linear-gradient(135deg, #7c3aed, #ec4899)",
                  border: "none", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}
              >
                <Wand2 size={11} />
                Magic
              </button>
            </div>

            {/* Continue / Summarize / Clear / Save */}
            <div style={{ display: "flex", gap: 5 }}>
              {BOTTOM_ACTIONS.map(({ icon, label, accent }) => (
                <button
                  key={label}
                  style={{
                    flex: 1, display: "flex", flexDirection: "column",
                    alignItems: "center", gap: 3, padding: "6px 4px",
                    borderRadius: 9, border: `1px solid ${accent}55`,
                    background: `${accent}22`,
                    color: label === "Continue" || label === "Summarize" ? "#5eead4" : "#6b7280",
                    fontSize: 10, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
