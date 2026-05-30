import { useState } from "react";
import {
  Camera, Scissors, FileImage, Send, X, Maximize2,
  MessageSquare, ChevronRight, Download, Monitor,
  Search, Code, BookOpen, Wrench, FlaskConical,
  Paperclip, Sparkles, ChevronDown, Music, Video,
  Eye, ImageIcon, Play, AlignLeft, RotateCcw,
  Save, Users, Wand2,
} from "lucide-react";

const TEAL = {
  bg: "#060d0d",
  surface: "#0a1414",
  border: "rgba(255,255,255,0.08)",
  accent: "#2dd4bf",
  accentDim: "rgba(45,212,191,0.14)",
  accentBorder: "rgba(45,212,191,0.3)",
  text: "#d0f0ec",
  textSec: "#4a7070",
  textMuted: "#2a4040",
};

type Tab = "capture" | "chat";
type Mode = "vision" | "image" | "music" | "video";

const snaps = [
  { id: 1, color: "#071010", label: "Dashboard" },
  { id: 2, color: "#070f0a", label: "Settings" },
  { id: 3, color: "#080a10", label: "Analytics" },
  { id: 4, color: "#0a0707", label: "Profile" },
];

const chatMessages = [
  { role: "user", text: "What's wrong with this dashboard layout?" },
  { role: "ai", text: "Three issues stand out:\n\n1. Heading hierarchy skips levels — h2 to h4\n2. Card padding is inconsistent — 12px vs 20px\n3. The date filter label is placed below the chart it controls" },
];

export function AmieGlowTeal() {
  const [tab, setTab] = useState<Tab>("chat");
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("vision");
  const [model, setModel] = useState("Gemini 2.5 Flash");
  const [picker, setPicker] = useState(false);
  const [attached, setAttached] = useState<number[]>([1, 2]);
  const [selSnap, setSelSnap] = useState<number | null>(1);

  const tabBtn = (key: Tab, label: string, Icon: React.FC<{ size: number }>) => (
    <button
      key={key}
      onClick={() => setTab(key)}
      style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        gap: 5, padding: "7px 0", borderRadius: 8, border: "none",
        background: tab === key ? TEAL.accentDim : "transparent",
        color: tab === key ? TEAL.accent : TEAL.textSec,
        fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
      }}
    >
      <Icon size={12} />
      {label}
      {key === "capture" && (
        <span style={{ background: tab === key ? TEAL.accent : "#0f1a1a", color: tab === key ? "#000" : "#888", borderRadius: 8, fontSize: 9, fontWeight: 700, padding: "1px 5px" }}>
          {snaps.length}
        </span>
      )}
    </button>
  );

  return (
    <div style={{ width: 390, height: 820, background: TEAL.bg, fontFamily: "'Inter',system-ui,sans-serif", display: "flex", flexDirection: "column", color: TEAL.text, overflow: "hidden" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ color: TEAL.accent, fontSize: 18 }}>✦</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>Amie Glow</span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <div style={{ padding: "3px 9px", borderRadius: 20, background: TEAL.accentDim, border: `1px solid ${TEAL.accentBorder}`, fontSize: 10, fontWeight: 700, color: TEAL.accent }}>PRO</div>
          <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg,#0f766e,#2dd4bf)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff" }}>J</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", margin: "10px 14px 0", background: "rgba(255,255,255,0.03)", borderRadius: 11, padding: 3, border: `1px solid ${TEAL.border}`, flexShrink: 0 }}>
        {tabBtn("capture", "Capture", Camera)}
        {tabBtn("chat", "Chat", MessageSquare)}
      </div>

      {/* ── CAPTURE TAB ── */}
      {tab === "capture" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "12px 14px 0", flexShrink: 0 }}>
            <div style={{ width: "100%", aspectRatio: "16/9", borderRadius: 12, background: "#070d0d", border: `1px solid ${TEAL.border}`, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0, padding: 12, display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ height: 5, width: "55%", borderRadius: 3, background: "rgba(45,212,191,0.2)" }} />
                {[75, 55, 85, 40].map((w, i) => <div key={i} style={{ height: 4, width: `${w}%`, borderRadius: 3, background: "rgba(255,255,255,0.06)" }} />)}
                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  {[1, 2, 3].map(i => <div key={i} style={{ flex: 1, height: 28, borderRadius: 6, background: "rgba(255,255,255,0.04)", border: `1px solid ${TEAL.border}` }} />)}
                </div>
              </div>
              <div style={{ position: "absolute", top: 7, right: 7, display: "flex", alignItems: "center", gap: 3, background: "rgba(0,0,0,0.7)", borderRadius: 20, padding: "2px 7px" }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e" }} />
                <span style={{ fontSize: 9, color: "#888" }}>Live</span>
              </div>
              <button style={{ position: "absolute", bottom: 7, right: 7, background: "rgba(0,0,0,0.5)", border: `1px solid ${TEAL.border}`, borderRadius: 6, padding: 4, color: "#888", cursor: "pointer", display: "flex" }}><Maximize2 size={11} /></button>
            </div>
          </div>
          <div style={{ padding: "10px 14px", display: "flex", gap: 8, flexShrink: 0 }}>
            {([
              { Icon: Camera, label: "Snap", color: "#0d6b64" },
              { Icon: Scissors, label: "Snip", color: "#0f4f33" },
              { Icon: FileImage, label: "Full Page", color: "#1e3a5f" },
            ] as { Icon: React.FC<{ size: number }>, label: string, color: string }[]).map(({ Icon, label, color }) => (
              <button key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "10px 4px", borderRadius: 11, border: `1px solid ${color}55`, background: `${color}20`, color: "#8ab0a8", cursor: "pointer" }}>
                <span style={{ color }}><Icon size={14} /></span>
                <span style={{ fontSize: 11, fontWeight: 600 }}>{label}</span>
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 14px 10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: TEAL.textSec, textTransform: "uppercase", letterSpacing: "0.06em" }}>Queue · {snaps.length}</span>
              <button style={{ background: "none", border: "none", color: TEAL.textSec, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>Clear all</button>
            </div>
            {snaps.map(s => (
              <div key={s.id} onClick={() => setSelSnap(s.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, marginBottom: 6, border: `1px solid ${selSnap === s.id ? TEAL.accentBorder : TEAL.border}`, background: selSnap === s.id ? TEAL.accentDim : "rgba(255,255,255,0.02)", cursor: "pointer" }}>
                <div style={{ width: 50, height: 34, borderRadius: 6, background: s.color, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}><Monitor size={11} style={{ color: "rgba(255,255,255,0.2)" }} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: TEAL.text }}>{s.label}</div>
                  <div style={{ fontSize: 10, color: TEAL.textSec, marginTop: 1 }}>Just now</div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button style={{ background: "none", border: "none", color: TEAL.textSec, cursor: "pointer", padding: 3 }}><Download size={12} /></button>
                  <button style={{ background: "none", border: "none", color: TEAL.textSec, cursor: "pointer", padding: 3 }}><X size={12} /></button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding: "8px 14px 14px", flexShrink: 0 }}>
            <button onClick={() => setTab("chat")} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "11px", borderRadius: 11, background: "linear-gradient(135deg,#064e3b,#059669)", border: "none", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 20px rgba(5,150,105,0.3)" }}>
              <MessageSquare size={14} />Send {snaps.length} snaps to Chat<ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── CHAT TAB ── */}
      {tab === "chat" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "8px 14px 0", flexShrink: 0, position: "relative" }}>
            <button onClick={() => setPicker(!picker)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 8px", borderRadius: 20, background: "rgba(255,255,255,0.04)", border: `1px solid ${TEAL.border}`, color: TEAL.textSec, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
              <Sparkles size={11} style={{ color: TEAL.accent }} />{model}<ChevronDown size={10} style={{ color: TEAL.textMuted }} />
            </button>
            {picker && (
              <div style={{ position: "absolute", top: 38, left: 14, zIndex: 50, background: TEAL.surface, border: `1px solid ${TEAL.border}`, borderRadius: 10, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
                {["Gemini 2.0 Flash", "Gemini 2.5 Flash", "Gemini 2.5 Pro"].map(m => (
                  <button key={m} onClick={() => { setModel(m); setPicker(false); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 14px", background: model === m ? TEAL.accentDim : "transparent", border: "none", color: model === m ? TEAL.accent : TEAL.textSec, fontSize: 12, fontWeight: model === m ? 600 : 400, cursor: "pointer" }}>{m}</button>
                ))}
              </div>
            )}
          </div>
          <div style={{ padding: "7px 14px 0", flexShrink: 0, display: "flex", gap: 5 }}>
            {(["vision", "image", "music", "video"] as Mode[]).map((m, i) => {
              const colors = [TEAL.accent, "#34d399", "#6ee7b7", "#a7f3d0"];
              const icons = [<Eye size={11} />, <ImageIcon size={11} />, <Music size={11} />, <Video size={11} />];
              const labels = ["Vision", "Image", "Music", "Video"];
              const c = colors[i];
              return (
                <button key={m} onClick={() => setMode(m)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 20, border: `1px solid ${mode === m ? c + "66" : TEAL.border}`, background: mode === m ? c + "1a" : "transparent", color: mode === m ? c : TEAL.textSec, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  {icons[i]}{labels[i]}
                </button>
              );
            })}
          </div>
          <div style={{ padding: "6px 14px 0", flexShrink: 0, display: "flex", gap: 5, overflowX: "auto" }}>
            {attached.map(sid => {
              const s = snaps.find(x => x.id === sid);
              if (!s) return null;
              return (
                <div key={sid} style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 7px 3px 4px", borderRadius: 7, background: "rgba(255,255,255,0.04)", border: `1px solid ${TEAL.border}`, flexShrink: 0 }}>
                  <div style={{ width: 18, height: 13, borderRadius: 3, background: s.color }} />
                  <span style={{ fontSize: 10, color: TEAL.textSec, fontWeight: 500 }}>{s.label}</span>
                  <X size={8} style={{ color: TEAL.textMuted, cursor: "pointer" }} onClick={() => setAttached(attached.filter(x => x !== sid))} />
                </div>
              );
            })}
            <button onClick={() => setTab("capture")} style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 8px", borderRadius: 7, border: `1px dashed ${TEAL.border}`, background: "transparent", color: TEAL.textSec, fontSize: 10, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
              <Camera size={10} />Add
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px 0", display: "flex", flexDirection: "column", gap: 11 }}>
            {chatMessages.map((m, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{ maxWidth: "88%", padding: "9px 13px", borderRadius: m.role === "user" ? "13px 13px 4px 13px" : "4px 13px 13px 13px", background: m.role === "user" ? "linear-gradient(135deg,#0f4f4a,#0d6b64)" : "rgba(255,255,255,0.04)", border: m.role === "ai" ? `1px solid ${TEAL.border}` : "none", fontSize: 12.5, lineHeight: 1.6, color: m.role === "user" ? "#d0f0ec" : "#7aaaa0", whiteSpace: "pre-line" }}>
                  {m.text}
                </div>
              </div>
            ))}
          </div>
          <div style={{ flexShrink: 0, borderTop: `1px solid ${TEAL.border}`, background: "rgba(6,13,13,0.85)", padding: "8px 12px 10px" }}>
            <div style={{ display: "flex", gap: 5, marginBottom: 7, overflowX: "auto" }}>
              <button style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: "rgba(255,255,255,0.04)", border: `1px solid ${TEAL.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: TEAL.textSec, cursor: "pointer" }}><Paperclip size={12} /></button>
              {[
                { Icon: Wrench, label: "Build" }, { Icon: FlaskConical, label: "Research" },
                { Icon: Search, label: "Search" }, { Icon: BookOpen, label: "Read" }, { Icon: Code, label: "Code" },
              ].map(({ Icon, label }) => (
                <button key={label} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 20, flexShrink: 0, background: "rgba(255,255,255,0.04)", border: `1px solid ${TEAL.border}`, color: TEAL.textSec, fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                  <Icon size={11} />{label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 7, background: "rgba(255,255,255,0.04)", border: `1px solid ${TEAL.border}`, borderRadius: 12, padding: "7px 8px 7px 12px", marginBottom: 7 }}>
              <textarea value={input} onChange={e => setInput(e.target.value)} placeholder={mode === "vision" ? "Ask about your screenshots…" : mode === "image" ? "Describe an image to generate…" : mode === "music" ? "Describe the music you want…" : "Describe the video you want…"} rows={1} style={{ flex: 1, background: "none", border: "none", outline: "none", color: TEAL.text, fontSize: 12.5, lineHeight: 1.5, resize: "none", fontFamily: "inherit", caretColor: TEAL.accent }} />
              <button style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, background: input.trim() ? "linear-gradient(135deg,#0f766e,#2dd4bf)" : "rgba(255,255,255,0.04)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", color: input.trim() ? "#fff" : TEAL.textMuted, cursor: input.trim() ? "pointer" : "default" }}>
                <Send size={14} />
              </button>
            </div>
            <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
              <button style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 10, background: "linear-gradient(135deg,#064e3b,#059669)", border: "none", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0, boxShadow: "0 3px 14px rgba(5,150,105,0.35)" }}>
                <Sparkles size={12} />Analyze
              </button>
              <button style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 11px", borderRadius: 10, flexShrink: 0, background: "linear-gradient(135deg,#022c22,#065f46)", border: `1px solid ${TEAL.border}`, color: "#5ecbba", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                <Users size={11} />Agents
              </button>
              <button style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 11px", borderRadius: 10, flexShrink: 0, background: "linear-gradient(135deg,#0f4f4a,#2dd4bf)", border: "1px solid rgba(45,212,191,0.2)", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                <Wand2 size={11} />Magic
              </button>
            </div>
            <div style={{ display: "flex", gap: 5 }}>
              {[
                { Icon: Play, label: "Continue" }, { Icon: AlignLeft, label: "Summarize" },
                { Icon: RotateCcw, label: "Clear" }, { Icon: Save, label: "Save" },
              ].map(({ Icon, label }) => (
                <button key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "6px 4px", borderRadius: 9, border: `1px solid ${TEAL.border}`, background: "rgba(255,255,255,0.04)", color: TEAL.textSec, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
                  <Icon size={12} />{label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
