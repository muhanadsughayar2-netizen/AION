import { useState } from "react";
import {
  Camera, Scissors, FileImage, Send, X, Maximize2,
  MessageSquare, ChevronRight, Download, Monitor,
  Search, Code, BookOpen, Wrench, FlaskConical,
  Paperclip, ChevronDown, Music, Video,
  Eye, ImageIcon, Play, AlignLeft, RotateCcw,
  Save, Users, Wand2, Sparkles, Mic,
} from "lucide-react";

/* ── GEMINI / GOOGLE AI STUDIO palette ── */
const G = {
  bg:          "#ffffff",
  surface:     "#f8f9fa",
  surfaceHov:  "#f1f3f4",
  border:      "#e8eaed",
  borderFocus: "#c5cae9",
  accentBlue:  "#4285f4",
  accentPurp:  "#9c27b0",
  accentGrad:  "linear-gradient(90deg,#4285f4,#9c27b0,#ea4c89)",
  chip:        "#e8f0fe",
  chipText:    "#1a73e8",
  text:        "#202124",
  textSec:     "#5f6368",
  textMuted:   "#bdc1c6",
  tabLine:     "#4285f4",
  bubbleUser:  "linear-gradient(135deg,#4285f4,#7c4dff)",
  bubbleAI:    "#f8f9fa",
  sendActive:  "linear-gradient(135deg,#4285f4,#9c27b0)",
  analyzeBtn:  "linear-gradient(135deg,#1a73e8,#4285f4)",
};

type Tab = "capture" | "chat";
type Mode = "vision" | "image" | "music" | "video";

/* Empty queue — real screenshots would appear here */
const queue: { id: number; color: string; title: string; url: string }[] = [];

const chatMessages = [
  { role: "user", text: "Analyse these screenshots and tell me what to improve." },
  { role: "ai",  text: "Sure! Here's what I can see:\n\n• The hero heading could be larger — it gets lost against the background\n• The CTA button contrast ratio is below WCAG AA\n• Mobile nav items are too close together for comfortable tapping" },
];

export function AmieGlowGemini() {
  const [tab,    setTab]    = useState<Tab>("chat");
  const [input,  setInput]  = useState("");
  const [mode,   setMode]   = useState<Mode>("vision");
  const [model,  setModel]  = useState("Gemini 2.5 Flash");
  const [picker, setPicker] = useState(false);

  /* Material-style underline tab */
  const tabBtn = (key: Tab, label: string, Icon: React.FC<{ size: number }>) => {
    const active = tab === key;
    return (
      <button
        key={key}
        onClick={() => setTab(key)}
        style={{
          flex: 1, position: "relative",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
          padding: "10px 0 9px",
          border: "none", background: "transparent",
          color: active ? G.accentBlue : G.textSec,
          fontSize: 13, fontWeight: active ? 600 : 500,
          cursor: "pointer", transition: "color 0.15s",
          borderBottom: active ? `2px solid ${G.accentBlue}` : "2px solid transparent",
        }}
      >
        <Icon size={14} />{label}
      </button>
    );
  };

  return (
    <div style={{ width: 390, height: 820, background: G.bg, fontFamily: "'Google Sans','Inter',system-ui,sans-serif", display: "flex", flexDirection: "column", color: G.text, overflow: "hidden" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Gemini gradient star */}
          <span style={{ fontSize: 20, background: G.accentGrad, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1 }}>✦</span>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em", color: G.text }}>Amie Glow</span>
        </div>
        <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
          <div style={{ padding: "3px 10px", borderRadius: 20, background: G.chip, fontSize: 10, fontWeight: 700, color: G.chipText }}>PRO</div>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#4285f4,#9c27b0)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff" }}>J</div>
        </div>
      </div>

      {/* Material underline tabs */}
      <div style={{ display: "flex", margin: "6px 0 0", borderBottom: `1px solid ${G.border}`, flexShrink: 0 }}>
        {tabBtn("capture", "Capture", Camera)}
        {tabBtn("chat", "Chat", MessageSquare)}
      </div>

      {/* ── CAPTURE TAB ── */}
      {tab === "capture" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Live preview */}
          <div style={{ padding: "14px 16px 0", flexShrink: 0 }}>
            <div style={{ width: "100%", aspectRatio: "16/9", borderRadius: 12, background: G.surface, border: `1px solid ${G.border}`, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 6 }}>
                <Monitor size={28} style={{ color: G.textMuted }} />
                <span style={{ fontSize: 12, color: G.textSec }}>Live tab preview</span>
              </div>
              <div style={{ position: "absolute", top: 8, right: 8, display: "flex", alignItems: "center", gap: 4, background: "rgba(0,0,0,0.06)", borderRadius: 20, padding: "3px 8px" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#34a853" }} />
                <span style={{ fontSize: 10, color: G.textSec }}>Live</span>
              </div>
            </div>
          </div>
          {/* Capture buttons */}
          <div style={{ padding: "12px 16px", display: "flex", gap: 8, flexShrink: 0 }}>
            {([
              { Icon: Camera,   label: "Snap",      color: "#1a73e8" },
              { Icon: Scissors, label: "Snip",       color: "#34a853" },
              { Icon: FileImage,label: "Full Page",  color: "#9c27b0" },
            ] as { Icon: React.FC<{ size: number }>, label: string, color: string }[]).map(({ Icon, label, color }) => (
              <button key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "12px 4px", borderRadius: 12, border: `1.5px solid ${G.border}`, background: G.bg, color: G.textSec, cursor: "pointer", transition: "all 0.15s" }}>
                <span style={{ color }}><Icon size={18} /></span>
                <span style={{ fontSize: 12, fontWeight: 500 }}>{label}</span>
              </button>
            ))}
          </div>
          {/* Queue */}
          <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: G.textSec }}>Queue ({queue.length})</span>
              {queue.length > 0 && <button style={{ background: "none", border: "none", color: G.accentBlue, cursor: "pointer", fontSize: 12, fontWeight: 500 }}>Clear all</button>}
            </div>
            {queue.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: "40px 0", color: G.textMuted }}>
                <Camera size={32} style={{ opacity: 0.35 }} />
                <span style={{ fontSize: 13, textAlign: "center", lineHeight: 1.5 }}>No screenshots yet.<br />Tap Snap, Snip, or Full Page to start.</span>
              </div>
            ) : queue.map(s => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, marginBottom: 6, border: `1px solid ${G.border}`, background: G.bg, cursor: "pointer" }}>
                <div style={{ width: 52, height: 36, borderRadius: 7, background: G.surface, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}><Monitor size={14} style={{ color: G.textMuted }} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: G.text }}>{s.title}</div>
                  <div style={{ fontSize: 11, color: G.textSec, marginTop: 1 }}>{s.url}</div>
                </div>
                <button style={{ background: "none", border: "none", color: G.textMuted, cursor: "pointer", padding: 4 }}><X size={14} /></button>
              </div>
            ))}
          </div>
          {/* Send button */}
          {queue.length > 0 && (
            <div style={{ padding: "8px 16px 14px", flexShrink: 0 }}>
              <button onClick={() => setTab("chat")} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px", borderRadius: 24, background: G.analyzeBtn, border: "none", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 12px rgba(66,133,244,0.35)" }}>
                <MessageSquare size={15} />Send {queue.length} screenshots to Chat
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── CHAT TAB ── */}
      {tab === "chat" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Model row */}
          <div style={{ padding: "10px 16px 0", flexShrink: 0, position: "relative" }}>
            <button onClick={() => setPicker(!picker)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px 5px 10px", borderRadius: 20, background: G.surface, border: `1px solid ${G.border}`, color: G.textSec, fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
              {/* Gemini G logo-style dot */}
              <span style={{ width: 14, height: 14, borderRadius: "50%", background: G.accentGrad, display: "inline-block", flexShrink: 0 }} />
              {model}
              <ChevronDown size={12} style={{ color: G.textMuted }} />
            </button>
            {picker && (
              <div style={{ position: "absolute", top: 40, left: 16, zIndex: 50, background: G.bg, border: `1px solid ${G.border}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,0.12)", minWidth: 200 }}>
                {["Gemini 2.0 Flash", "Gemini 2.5 Flash", "Gemini 2.5 Pro"].map(m => (
                  <button key={m} onClick={() => { setModel(m); setPicker(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "10px 14px", background: model === m ? G.chip : "transparent", border: "none", color: model === m ? G.accentBlue : G.text, fontSize: 13, fontWeight: model === m ? 600 : 400, cursor: "pointer" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: model === m ? G.accentBlue : G.textMuted, flexShrink: 0 }} />
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* AI mode pills — Google-chip style */}
          <div style={{ padding: "8px 16px 0", flexShrink: 0, display: "flex", gap: 6, overflowX: "auto" }}>
            {(["vision", "image", "music", "video"] as Mode[]).map((m, i) => {
              const colors     = ["#1a73e8", "#34a853", "#fbbc04", "#ea4335"];
              const icons      = [<Eye size={12} />, <ImageIcon size={12} />, <Music size={12} />, <Video size={12} />];
              const labels     = ["Vision", "Image", "Music", "Video"];
              const c = colors[i];
              const active = mode === m;
              return (
                <button key={m} onClick={() => setMode(m)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 20, border: `1px solid ${active ? c : G.border}`, background: active ? c + "18" : G.bg, color: active ? c : G.textSec, fontSize: 12, fontWeight: active ? 600 : 400, cursor: "pointer", flexShrink: 0, transition: "all 0.15s" }}>
                  {icons[i]}{labels[i]}
                </button>
              );
            })}
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px 0", display: "flex", flexDirection: "column", gap: 12 }}>
            {chatMessages.map((m, i) => (
              <div key={i} style={{ display: "flex", gap: 8, flexDirection: m.role === "user" ? "row-reverse" : "row", alignItems: "flex-start" }}>
                {m.role === "ai" && (
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: G.accentGrad, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                    <span style={{ fontSize: 12, color: "#fff", fontWeight: 700 }}>✦</span>
                  </div>
                )}
                <div style={{ maxWidth: "82%", padding: "10px 14px", borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "4px 18px 18px 18px", background: m.role === "user" ? G.bubbleUser : G.bubbleAI, border: m.role === "ai" ? `1px solid ${G.border}` : "none", fontSize: 13, lineHeight: 1.6, color: m.role === "user" ? "#fff" : G.text, whiteSpace: "pre-line" }}>
                  {m.text}
                </div>
              </div>
            ))}
            <div style={{ height: 4 }} />
          </div>

          {/* Bottom — Google AI Studio style */}
          <div style={{ flexShrink: 0, padding: "8px 12px 12px", borderTop: `1px solid ${G.border}` }}>
            {/* Quick action chips */}
            <div style={{ display: "flex", gap: 6, marginBottom: 8, overflowX: "auto" }}>
              {[
                { Icon: Wrench,       label: "Build" },
                { Icon: FlaskConical, label: "Research" },
                { Icon: Search,       label: "Search" },
                { Icon: BookOpen,     label: "Read" },
                { Icon: Code,         label: "Code" },
              ].map(({ Icon, label }) => (
                <button key={label} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 20, flexShrink: 0, background: G.surface, border: `1px solid ${G.border}`, color: G.textSec, fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>
                  <Icon size={12} />{label}
                </button>
              ))}
            </div>

            {/* Input box — Google AI Studio style */}
            <div style={{ background: G.surface, border: `1.5px solid ${input.trim() ? G.accentBlue : G.border}`, borderRadius: 24, padding: "10px 12px 10px 16px", transition: "border-color 0.15s" }}>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={
                  mode === "vision" ? "Ask about your screenshots…" :
                  mode === "image"  ? "Describe an image to generate…" :
                  mode === "music"  ? "Describe the music you want…" :
                  "Describe the video you want…"
                }
                rows={1}
                style={{ width: "100%", background: "none", border: "none", outline: "none", color: G.text, fontSize: 13, lineHeight: 1.5, resize: "none", fontFamily: "inherit", caretColor: G.accentBlue }}
              />
              {/* Bottom row of input */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => setTab("capture")} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 14, background: G.bg, border: `1px solid ${G.border}`, color: G.textSec, fontSize: 11, fontWeight: 500, cursor: "pointer" }}>
                    <Camera size={11} />Add screenshots
                  </button>
                  <button style={{ width: 28, height: 28, borderRadius: "50%", background: "none", border: `1px solid ${G.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: G.textSec, cursor: "pointer" }}>
                    <Paperclip size={12} />
                  </button>
                  <button style={{ width: 28, height: 28, borderRadius: "50%", background: "none", border: `1px solid ${G.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: G.textSec, cursor: "pointer" }}>
                    <Mic size={12} />
                  </button>
                </div>
                <button style={{ width: 34, height: 34, borderRadius: "50%", border: "none", background: input.trim() ? G.sendActive : G.border, display: "flex", alignItems: "center", justifyContent: "center", color: input.trim() ? "#fff" : G.textMuted, cursor: input.trim() ? "pointer" : "default", transition: "all 0.2s" }}>
                  <Send size={14} />
                </button>
              </div>
            </div>

            {/* Analyze / Agents / Magic */}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 20, background: G.analyzeBtn, border: "none", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0, boxShadow: "0 2px 8px rgba(66,133,244,0.3)" }}>
                <Sparkles size={13} />Analyze
              </button>
              <button style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 20, flexShrink: 0, background: G.bg, border: `1px solid ${G.border}`, color: G.textSec, fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
                <Users size={12} />Agents
              </button>
              <button style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 20, flexShrink: 0, background: "#f3e8ff", border: "1px solid #d8b4fe", color: "#7c3aed", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
                <Wand2 size={12} />Magic
              </button>
            </div>

            {/* Action row */}
            <div style={{ display: "flex", gap: 5, marginTop: 8 }}>
              {([
                { Icon: Play,      label: "Continue" },
                { Icon: AlignLeft, label: "Summarize" },
                { Icon: RotateCcw, label: "Clear" },
                { Icon: Save,      label: "Save" },
              ] as { Icon: React.FC<{ size: number }>, label: string }[]).map(({ Icon, label }) => (
                <button key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "6px 4px", borderRadius: 10, border: `1px solid ${G.border}`, background: G.surface, color: G.textSec, fontSize: 10, fontWeight: 500, cursor: "pointer" }}>
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
