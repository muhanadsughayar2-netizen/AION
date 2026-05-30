import { useState } from "react";
import {
  Camera, Scissors, FileImage, Send, X,
  MessageSquare, ChevronRight, Download, Monitor,
  Search, Code, BookOpen, Wrench,
  Paperclip, ChevronDown, Music, Video,
  Eye, ImageIcon, Play, AlignLeft, RotateCcw,
  Save, Users, Wand2, Sparkles, Mic, Key,
  Globe, Terminal, FileCode, RefreshCw,
  Maximize2, CheckCircle, Lock, Unlock,
  ChevronUp, ZoomIn,
} from "lucide-react";

/* ─── Gemini/Google palette ─── */
const G = {
  bg:         "#ffffff",
  surface:    "#f8f9fa",
  surfaceHov: "#f1f3f4",
  border:     "#e8eaed",
  text:       "#202124",
  textSec:    "#5f6368",
  textMuted:  "#bdc1c6",
  blue:       "#4285f4",
  green:      "#34a853",
  yellow:     "#fbbc04",
  red:        "#ea4335",
  purple:     "#9c27b0",
  grad:       "linear-gradient(90deg,#4285f4,#9c27b0,#ea4c89)",
  gradBtn:    "linear-gradient(135deg,#4285f4,#7c4dff)",
  analyzeBtn: "linear-gradient(135deg,#1a73e8,#4285f4)",
  webChipBg:  "#e8f0fe",
  webChipTxt: "#1557b0",
  webChipBdr: "#c5d8fb",
  codeBg:     "#1e1e2e",
  codeText:   "#cdd6f4",
  codeKw:     "#cba6f7",
  codeStr:    "#a6e3a1",
  codeCmt:    "#6c7086",
};

type Tab  = "capture" | "chat" | "build";
type Mode = "vision" | "image" | "music" | "video";

/* ─── sample messages showing rich media output ─── */
const visionMsgs = [
  { role: "user", text: "What's wrong with this landing page?", hasSnap: true },
  { role: "ai",   text: "I can see three issues:\n\n• Hero text too small on mobile — bump to 32px\n• CTA button fails WCAG AA contrast (3.2:1 vs 4.5 required)\n• Navigation items collapse too early — breakpoint at 768px is too wide" },
];
const imageMsgs = [
  { role: "user", text: "Generate a futuristic city skyline at dusk, neon lights, cinematic" },
  { role: "ai",   text: "", isImage: true },
];
const videoMsgs = [
  { role: "user", text: "Create a 5-second clip: glowing SnapToAI logo flies in from left, camera zooms" },
  { role: "ai",   text: "", isVideo: true },
];

export function AmieGlowGeminiV2() {
  const [tab,       setTab]       = useState<Tab>("chat");
  const [input,     setInput]     = useState("");
  const [mode,      setMode]      = useState<Mode>("vision");
  const [model,     setModel]     = useState("Gemini 2.5 Flash");
  const [picker,    setPicker]    = useState(false);
  const [apiKey,    setApiKey]    = useState("");
  const [apiSaved,  setApiSaved]  = useState(false);
  const [showKey,   setShowKey]   = useState(false);
  const [isPro,     setIsPro]     = useState(false);
  const [buildFile, setBuildFile] = useState("index.js");
  const [codeOut,   setCodeOut]   = useState(false);

  const msgs = mode === "image" ? imageMsgs : mode === "video" ? videoMsgs : visionMsgs;

  /* ── Material underline tab ── */
  const tabBtn = (key: Tab, label: string, Icon: React.FC<{ size: number }>) => {
    const active = tab === key;
    return (
      <button key={key} onClick={() => setTab(key)} style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
        padding: "9px 0 8px", border: "none", background: "transparent",
        color: active ? G.blue : G.textSec,
        fontSize: 12.5, fontWeight: active ? 600 : 500, cursor: "pointer",
        borderBottom: active ? `2px solid ${G.blue}` : "2px solid transparent",
        transition: "color 0.15s",
      }}>
        <Icon size={13} />{label}
      </button>
    );
  };

  /* ── chips that change per mode ── */
  const ChipsForMode = () => {
    if (mode === "vision") return (
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 1 }}>
        <span style={{ fontSize: 11, color: G.textSec, alignSelf: "center", flexShrink: 0, display: "flex", alignItems: "center", gap: 3 }}>
          <Globe size={11} />Web:
        </span>
        {[
          { label: "Research", icon: <Sparkles size={11} /> },
          { label: "Search",   icon: <Search size={11} /> },
          { label: "Read",     icon: <BookOpen size={11} /> },
        ].map(({ label, icon }) => (
          <button key={label} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 16, flexShrink: 0, background: G.webChipBg, border: `1px solid ${G.webChipBdr}`, color: G.webChipTxt, fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
            {icon}{label}
          </button>
        ))}
        <div style={{ width: 1, background: G.border, flexShrink: 0, margin: "2px 2px" }} />
        {[
          { label: "Build",   icon: <Wrench size={11} />, color: G.blue },
          { label: "Code",    icon: <Code size={11} />,   color: G.purple },
        ].map(({ label, icon, color }) => (
          <button key={label} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 16, flexShrink: 0, background: G.surface, border: `1px solid ${G.border}`, color, fontSize: 11, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>
            {icon}{label}
          </button>
        ))}
      </div>
    );
    if (mode === "image") return (
      <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
        {[
          { label: "Realistic",   color: G.green },
          { label: "Artistic",    color: G.purple },
          { label: "3D render",   color: G.blue },
          { label: "Pixel art",   color: G.red },
          { label: "Watercolour", color: "#0097a7" },
        ].map(({ label, color }) => (
          <button key={label} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 11px", borderRadius: 16, flexShrink: 0, background: color + "12", border: `1px solid ${color}44`, color, fontSize: 11, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>
            {label}
          </button>
        ))}
      </div>
    );
    if (mode === "music") return (
      <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
        {[
          { label: "Ambient",  color: G.blue },
          { label: "Upbeat",   color: G.yellow },
          { label: "Cinematic",color: G.purple },
          { label: "Lo-fi",    color: G.green },
          { label: "Lyrics",   color: G.red },
        ].map(({ label, color }) => (
          <button key={label} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 11px", borderRadius: 16, flexShrink: 0, background: color + "12", border: `1px solid ${color}44`, color, fontSize: 11, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>
            {label}
          </button>
        ))}
      </div>
    );
    /* video */
    return (
      <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
        {[
          { label: "Cinematic",  color: G.blue },
          { label: "Short clip", color: G.purple },
          { label: "Loop",       color: G.green },
          { label: "Scene",      color: G.red },
          { label: "Multi-clip", color: "#0097a7" },
        ].map(({ label, color }) => (
          <button key={label} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 11px", borderRadius: 16, flexShrink: 0, background: color + "12", border: `1px solid ${color}44`, color, fontSize: 11, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>
            {label}
          </button>
        ))}
      </div>
    );
  };

  /* ── message bubble ── */
  const Bubble = ({ m }: { m: (typeof visionMsgs)[0] & { isImage?: boolean; isVideo?: boolean; hasSnap?: boolean } }) => (
    <div style={{ display: "flex", gap: 8, flexDirection: m.role === "user" ? "row-reverse" : "row", alignItems: "flex-start" }}>
      {m.role === "ai" && (
        <div style={{ width: 26, height: 26, borderRadius: "50%", background: G.grad, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
          <span style={{ fontSize: 11, color: "#fff", fontWeight: 700 }}>✦</span>
        </div>
      )}
      <div style={{ maxWidth: m.isImage || m.isVideo ? "100%" : "82%", flex: m.isImage || m.isVideo ? 1 : undefined }}>
        {/* attached snap thumbnail */}
        {m.hasSnap && (
          <div style={{ display: "flex", gap: 5, marginBottom: 5, justifyContent: "flex-end" }}>
            <div style={{ width: 54, height: 38, borderRadius: 8, background: G.surface, border: `1px solid ${G.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Monitor size={14} style={{ color: G.textMuted }} />
            </div>
          </div>
        )}
        {/* text bubble */}
        {m.text ? (
          <div style={{ padding: "9px 13px", borderRadius: m.role === "user" ? "17px 17px 4px 17px" : "4px 17px 17px 17px", background: m.role === "user" ? G.gradBtn : G.surface, border: m.role === "ai" ? `1px solid ${G.border}` : "none", fontSize: 12.5, lineHeight: 1.65, color: m.role === "user" ? "#fff" : G.text, whiteSpace: "pre-line" }}>
            {m.text}
          </div>
        ) : null}
        {/* generated IMAGE card — full width, not cut */}
        {m.isImage && (
          <div style={{ borderRadius: 14, overflow: "hidden", border: `1px solid ${G.border}` }}>
            <div style={{ width: "100%", aspectRatio: "4/3", background: "linear-gradient(135deg,#e8f0fe,#f3e8ff,#fce8f3)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
              <div style={{ textAlign: "center" }}>
                <ImageIcon size={32} style={{ color: G.purple, opacity: 0.5, display: "block", margin: "0 auto 6px" }} />
                <span style={{ fontSize: 12, color: G.textSec }}>Generated image</span>
              </div>
              <button style={{ position: "absolute", top: 8, right: 8, background: "rgba(255,255,255,0.85)", border: `1px solid ${G.border}`, borderRadius: 8, padding: "4px 8px", display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: G.textSec, cursor: "pointer" }}>
                <ZoomIn size={11} />View
              </button>
            </div>
            <div style={{ background: G.surface, padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, color: G.textSec }}>Imagen · futuristic city skyline</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={{ background: "none", border: `1px solid ${G.border}`, borderRadius: 7, padding: "3px 8px", fontSize: 11, color: G.blue, cursor: "pointer" }}>Edit</button>
                <button style={{ background: "none", border: `1px solid ${G.border}`, borderRadius: 7, padding: "3px 8px", fontSize: 11, color: G.textSec, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}><Download size={11} /></button>
              </div>
            </div>
          </div>
        )}
        {/* generated VIDEO card — full width */}
        {m.isVideo && (
          <div style={{ borderRadius: 14, overflow: "hidden", border: `1px solid ${G.border}` }}>
            <div style={{ width: "100%", aspectRatio: "16/9", background: "linear-gradient(135deg,#1a1a2e,#16213e,#0f3460)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
              <div style={{ width: 46, height: 46, borderRadius: "50%", background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <Play size={18} style={{ color: "#fff" }} />
              </div>
              <div style={{ position: "absolute", bottom: 8, left: 10, fontSize: 10, color: "rgba(255,255,255,0.7)" }}>0:05</div>
              <div style={{ position: "absolute", bottom: 8, right: 10, background: "rgba(0,0,0,0.4)", borderRadius: 6, padding: "2px 7px", fontSize: 10, color: "#fff" }}>Veo 2</div>
            </div>
            <div style={{ background: G.surface, padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, color: G.textSec }}>Video · SnapToAI logo reveal</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={{ background: "none", border: `1px solid ${G.border}`, borderRadius: 7, padding: "3px 8px", fontSize: 11, color: G.blue, cursor: "pointer" }}>Extend</button>
                <button style={{ background: "none", border: `1px solid ${G.border}`, borderRadius: 7, padding: "3px 8px", fontSize: 11, color: G.textSec, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}><Download size={11} /></button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ width: 390, height: 880, background: G.bg, fontFamily: "'Google Sans','Inter',system-ui,sans-serif", display: "flex", flexDirection: "column", color: G.text, overflow: "hidden" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 19, background: G.grad, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1 }}>✦</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: G.text, letterSpacing: "-0.01em" }}>Amie Glow</span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {/* API key indicator */}
          <button onClick={() => setShowKey(!showKey)} title="API Key" style={{ width: 28, height: 28, borderRadius: "50%", background: apiSaved ? "#e6f4ea" : G.surface, border: `1px solid ${apiSaved ? "#34a85344" : G.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: apiSaved ? G.green : G.textSec }}>
            <Key size={13} />
          </button>
          <div style={{ padding: "3px 10px", borderRadius: 20, background: isPro ? "linear-gradient(90deg,#4285f4,#9c27b0)" : G.surface, border: `1px solid ${isPro ? "transparent" : G.border}`, fontSize: 10, fontWeight: 700, color: isPro ? "#fff" : G.textSec, cursor: "pointer" }} onClick={() => setIsPro(!isPro)}>
            {isPro ? "PRO ✦" : "Free"}
          </div>
          <div style={{ width: 27, height: 27, borderRadius: "50%", background: G.grad, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff" }}>J</div>
        </div>
      </div>

      {/* ── API Key panel (inline) ── */}
      {showKey && (
        <div style={{ margin: "8px 14px 0", padding: "12px 14px", borderRadius: 14, background: G.surface, border: `1px solid ${G.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: G.text }}>Gemini API Key</div>
              <div style={{ fontSize: 11, color: G.textSec, marginTop: 1 }}>Get yours free at <span style={{ color: G.blue }}>aistudio.google.com</span></div>
            </div>
            <button onClick={() => setShowKey(false)} style={{ background: "none", border: "none", color: G.textMuted, cursor: "pointer", padding: 2 }}><X size={14} /></button>
          </div>
          <div style={{ display: "flex", gap: 7, marginBottom: 10 }}>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="AIza..." style={{ flex: 1, padding: "7px 10px", borderRadius: 10, border: `1.5px solid ${apiKey ? G.blue : G.border}`, fontSize: 12, outline: "none", fontFamily: "monospace", color: G.text, background: G.bg }} />
            <button onClick={() => { setApiSaved(true); setShowKey(false); }} style={{ padding: "7px 14px", borderRadius: 10, background: G.gradBtn, border: "none", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Save</button>
          </div>
          {/* Plan tiers */}
          <div style={{ display: "flex", gap: 7 }}>
            <div style={{ flex: 1, padding: "9px 10px", borderRadius: 10, border: `1.5px solid ${!isPro ? G.blue : G.border}`, background: !isPro ? "#e8f0fe" : G.bg }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                <Unlock size={11} style={{ color: !isPro ? G.blue : G.textSec }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: !isPro ? G.blue : G.textSec }}>Free</span>
              </div>
              <div style={{ fontSize: 10.5, color: G.textSec, lineHeight: 1.5 }}>
                ✓ Vision mode<br />
                ✓ 20 prompts / day<br />
                <span style={{ color: G.textMuted }}>✗ Image, Music, Video</span>
              </div>
            </div>
            <div style={{ flex: 1, padding: "9px 10px", borderRadius: 10, border: `1.5px solid ${isPro ? G.purple : G.border}`, background: isPro ? "#f3e8ff" : G.bg }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                <Sparkles size={11} style={{ color: isPro ? G.purple : G.textSec }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: isPro ? G.purple : G.textSec }}>Pro</span>
              </div>
              <div style={{ fontSize: 10.5, color: G.textSec, lineHeight: 1.5 }}>
                ✓ All modes unlocked<br />
                ✓ 300 prompts / day<br />
                ✓ Priority generation
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 3 Tabs: Capture | Chat | Build ── */}
      <div style={{ display: "flex", margin: "8px 0 0", borderBottom: `1px solid ${G.border}`, flexShrink: 0 }}>
        {tabBtn("capture", "Capture", Camera)}
        {tabBtn("chat", "Chat", MessageSquare)}
        {tabBtn("build", "Build", Code)}
      </div>

      {/* ════════ CAPTURE TAB ════════ */}
      {tab === "capture" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "12px 14px 0", flexShrink: 0 }}>
            <div style={{ width: "100%", aspectRatio: "16/9", borderRadius: 12, background: G.surface, border: `1px solid ${G.border}`, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 6 }}>
                <Monitor size={26} style={{ color: G.textMuted }} />
                <span style={{ fontSize: 12, color: G.textSec }}>Live tab preview</span>
              </div>
              <div style={{ position: "absolute", top: 8, right: 8, display: "flex", alignItems: "center", gap: 4, background: "rgba(255,255,255,0.9)", borderRadius: 20, padding: "2px 8px", border: `1px solid ${G.border}` }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: G.green }} />
                <span style={{ fontSize: 10, color: G.textSec }}>Live</span>
              </div>
            </div>
          </div>
          <div style={{ padding: "10px 14px 6px", display: "flex", gap: 8, flexShrink: 0 }}>
            {([
              { Icon: Camera, label: "Snap", color: G.blue },
              { Icon: Scissors, label: "Snip", color: G.green },
              { Icon: FileImage, label: "Full Page", color: G.purple },
            ] as { Icon: React.FC<{ size: number }>, label: string, color: string }[]).map(({ Icon, label, color }) => (
              <button key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "11px 4px", borderRadius: 12, border: `1.5px solid ${G.border}`, background: G.bg, color: G.textSec, cursor: "pointer" }}>
                <span style={{ color }}><Icon size={18} /></span>
                <span style={{ fontSize: 12, fontWeight: 500 }}>{label}</span>
              </button>
            ))}
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: G.textMuted, padding: "0 24px" }}>
            <Camera size={34} style={{ opacity: 0.3 }} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: G.textSec, marginBottom: 4 }}>Queue is empty</div>
              <div style={{ fontSize: 12, lineHeight: 1.6, color: G.textMuted }}>Take a screenshot with the buttons above. Your captured tabs will appear here, ready to send to Chat.</div>
            </div>
            <button onClick={() => setTab("chat")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 20, background: G.surface, border: `1px solid ${G.border}`, color: G.blue, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <MessageSquare size={13} />Go to Chat anyway
            </button>
          </div>
        </div>
      )}

      {/* ════════ CHAT TAB ════════ */}
      {tab === "chat" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Model picker */}
          <div style={{ padding: "8px 14px 0", flexShrink: 0, position: "relative" }}>
            <button onClick={() => setPicker(!picker)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px 5px 9px", borderRadius: 20, background: G.surface, border: `1px solid ${G.border}`, color: G.textSec, fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
              <span style={{ width: 12, height: 12, borderRadius: "50%", background: G.grad, display: "inline-block", flexShrink: 0 }} />
              {model}<ChevronDown size={11} style={{ color: G.textMuted, marginLeft: 2 }} />
            </button>
            {picker && (
              <div style={{ position: "absolute", top: 38, left: 14, zIndex: 50, background: G.bg, border: `1px solid ${G.border}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,0.12)", minWidth: 210 }}>
                {["Gemini 2.0 Flash", "Gemini 2.5 Flash", "Gemini 2.5 Pro"].map(m => (
                  <button key={m} onClick={() => { setModel(m); setPicker(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "10px 14px", background: model === m ? "#e8f0fe" : "transparent", border: "none", color: model === m ? G.blue : G.text, fontSize: 12.5, fontWeight: model === m ? 600 : 400, cursor: "pointer" }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: model === m ? G.blue : G.textMuted, flexShrink: 0 }} />{m}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* AI Mode pills */}
          <div style={{ padding: "7px 14px 0", flexShrink: 0, display: "flex", gap: 6 }}>
            {([
              { key: "vision", label: "Vision", icon: <Eye size={12} />, color: G.blue, locked: false },
              { key: "image",  label: "Image",  icon: <ImageIcon size={12} />, color: G.green, locked: !isPro },
              { key: "music",  label: "Music",  icon: <Music size={12} />, color: G.yellow, locked: !isPro },
              { key: "video",  label: "Video",  icon: <Video size={12} />, color: G.red, locked: !isPro },
            ] as { key: Mode, label: string, icon: React.ReactNode, color: string, locked: boolean }[]).map(({ key, label, icon, color, locked }) => {
              const active = mode === key;
              return (
                <button key={key} onClick={() => !locked && setMode(key)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 11px", borderRadius: 20, border: `1px solid ${active ? color : G.border}`, background: active ? color + "18" : G.bg, color: locked ? G.textMuted : active ? color : G.textSec, fontSize: 11.5, fontWeight: active ? 600 : 400, cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.6 : 1, transition: "all 0.15s", position: "relative" }}>
                  {icon}{label}
                  {locked && <Lock size={9} style={{ marginLeft: 1 }} />}
                </button>
              );
            })}
          </div>

          {/* Mode-specific context chips */}
          <div style={{ padding: "6px 14px 0", flexShrink: 0 }}>
            <ChipsForMode />
          </div>

          {/* ── Messages — generous space ── */}
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px 6px", display: "flex", flexDirection: "column", gap: 13 }}>
            {msgs.map((m, i) => <Bubble key={i} m={m as any} />)}
          </div>

          {/* ── Bottom input ── */}
          <div style={{ flexShrink: 0, padding: "6px 12px 10px", borderTop: `1px solid ${G.border}` }}>
            <div style={{ background: G.surface, border: `1.5px solid ${input.trim() ? G.blue : G.border}`, borderRadius: 22, padding: "9px 12px 9px 15px", transition: "border-color 0.15s", marginBottom: 7 }}>
              <textarea value={input} onChange={e => setInput(e.target.value)}
                placeholder={
                  mode === "vision" ? "Ask about your screenshots or the web…" :
                  mode === "image"  ? "Describe the image you want to generate…" :
                  mode === "music"  ? "Describe the music or song you want…" :
                  "Describe the video you want to generate…"
                }
                rows={2}
                style={{ width: "100%", background: "none", border: "none", outline: "none", color: G.text, fontSize: 13, lineHeight: 1.5, resize: "none", fontFamily: "inherit", caretColor: G.blue }}
              />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => setTab("capture")} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 14, background: G.bg, border: `1px solid ${G.border}`, color: G.textSec, fontSize: 11, fontWeight: 500, cursor: "pointer" }}>
                    <Camera size={11} />Screenshots
                  </button>
                  <button style={{ width: 27, height: 27, borderRadius: "50%", background: "none", border: `1px solid ${G.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: G.textSec, cursor: "pointer" }}><Mic size={12} /></button>
                </div>
                <button style={{ width: 34, height: 34, borderRadius: "50%", border: "none", background: input.trim() ? G.gradBtn : G.border, display: "flex", alignItems: "center", justifyContent: "center", color: input.trim() ? "#fff" : G.textMuted, cursor: input.trim() ? "pointer" : "default", transition: "all 0.2s" }}>
                  <Send size={14} />
                </button>
              </div>
            </div>
            {/* Analyze / Agents / Magic */}
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <button style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 18, background: G.analyzeBtn, border: "none", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 8px rgba(66,133,244,0.28)" }}>
                <Sparkles size={12} />Analyze
              </button>
              <button style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 13px", borderRadius: 18, background: G.bg, border: `1px solid ${G.border}`, color: G.textSec, fontSize: 11.5, fontWeight: 500, cursor: "pointer" }}>
                <Users size={12} />Agents
              </button>
              <button style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 13px", borderRadius: 18, background: "#f3e8ff", border: "1px solid #d8b4fe", color: "#7c3aed", fontSize: 11.5, fontWeight: 500, cursor: "pointer" }}>
                <Wand2 size={12} />Magic
              </button>
            </div>
            {/* Continue / Summarize / Clear / Save */}
            <div style={{ display: "flex", gap: 5 }}>
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

      {/* ════════ BUILD TAB ════════ */}
      {tab === "build" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* File tabs bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 0, borderBottom: `1px solid ${G.border}`, flexShrink: 0, background: G.surface, overflowX: "auto" }}>
            {["index.js", "styles.css", "README.md"].map(f => (
              <button key={f} onClick={() => setBuildFile(f)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", border: "none", borderBottom: buildFile === f ? `2px solid ${G.blue}` : "2px solid transparent", background: buildFile === f ? G.bg : "transparent", color: buildFile === f ? G.text : G.textSec, fontSize: 12, fontWeight: buildFile === f ? 500 : 400, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
                <FileCode size={12} style={{ color: buildFile === f ? G.blue : G.textMuted }} />{f}
              </button>
            ))}
            <button style={{ marginLeft: "auto", padding: "6px 10px", background: "none", border: "none", color: G.textSec, cursor: "pointer", flexShrink: 0 }}>+</button>
          </div>

          {/* Code editor area */}
          <div style={{ flex: codeOut ? 0.5 : 1, overflowY: "auto", background: G.codeBg, padding: "12px 14px", fontFamily: "'JetBrains Mono','Fira Code',monospace", fontSize: 12, lineHeight: 1.7 }}>
            {buildFile === "index.js" && (
              <>
                <div><span style={{ color: G.codeCmt }}>// SnapToAI — screenshot analyser</span></div>
                <div><span style={{ color: G.codeKw }}>import</span><span style={{ color: G.codeText }}> {"{"} analyzeScreenshots {"}"} </span><span style={{ color: G.codeKw }}>from</span><span style={{ color: G.codeStr }}> './ai'</span><span style={{ color: G.codeText }}>;</span></div>
                <div style={{ height: 8 }} />
                <div><span style={{ color: G.codeKw }}>const</span><span style={{ color: "#89dceb" }}> results</span><span style={{ color: G.codeText }}> = </span><span style={{ color: G.codeKw }}>await</span><span style={{ color: "#89dceb" }}> analyzeScreenshots</span><span style={{ color: G.codeText }}>({"{"}</span></div>
                <div style={{ paddingLeft: 18 }}><span style={{ color: "#f38ba8" }}>images</span><span style={{ color: G.codeText }}>: screenshots,</span></div>
                <div style={{ paddingLeft: 18 }}><span style={{ color: "#f38ba8" }}>mode</span><span style={{ color: G.codeText }}>: </span><span style={{ color: G.codeStr }}>'vision'</span><span style={{ color: G.codeText }}>,</span></div>
                <div style={{ paddingLeft: 18 }}><span style={{ color: "#f38ba8" }}>apiKey</span><span style={{ color: G.codeText }}>: process.env.</span><span style={{ color: "#fab387" }}>GEMINI_KEY</span><span style={{ color: G.codeText }}>,</span></div>
                <div><span style={{ color: G.codeText }}>{"}"});</span></div>
                <div style={{ height: 8 }} />
                <div><span style={{ color: G.codeText }}>console.</span><span style={{ color: "#89dceb" }}>log</span><span style={{ color: G.codeText }}>(results);</span></div>
              </>
            )}
            {buildFile === "styles.css" && (
              <>
                <div><span style={{ color: G.codeCmt }}>/* SnapToAI sidebar styles */</span></div>
                <div><span style={{ color: "#f38ba8" }}>.sidebar</span><span style={{ color: G.codeText }}> {"{"}</span></div>
                <div style={{ paddingLeft: 18 }}><span style={{ color: "#89dceb" }}>width</span><span style={{ color: G.codeText }}>: </span><span style={{ color: G.codeStr }}>390px</span><span style={{ color: G.codeText }}>;</span></div>
                <div style={{ paddingLeft: 18 }}><span style={{ color: "#89dceb" }}>background</span><span style={{ color: G.codeText }}>: </span><span style={{ color: G.codeStr }}>#ffffff</span><span style={{ color: G.codeText }}>;</span></div>
                <div><span style={{ color: G.codeText }}>{"}"}</span></div>
              </>
            )}
            {buildFile === "README.md" && (
              <>
                <div><span style={{ color: G.codeStr }}># SnapToAI Build</span></div>
                <div style={{ height: 4 }} />
                <div><span style={{ color: G.codeText }}>Screenshot analysis powered by Gemini.</span></div>
              </>
            )}
          </div>

          {/* Prompt-to-code input */}
          <div style={{ flexShrink: 0, borderTop: `1px solid rgba(255,255,255,0.08)`, background: G.codeBg, padding: "8px 12px" }}>
            <div style={{ display: "flex", gap: 7 }}>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, background: "rgba(255,255,255,0.06)", borderRadius: 12, padding: "6px 12px", border: "1px solid rgba(255,255,255,0.1)" }}>
                <Sparkles size={13} style={{ color: G.purple, flexShrink: 0 }} />
                <input placeholder="Describe what to build…" style={{ flex: 1, background: "none", border: "none", outline: "none", color: "#cdd6f4", fontSize: 12.5, fontFamily: "inherit" }} />
              </div>
              <button style={{ padding: "6px 14px", borderRadius: 12, background: G.gradBtn, border: "none", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                <Wand2 size={12} />Generate
              </button>
            </div>
          </div>

          {/* Terminal output toggle */}
          <div style={{ flexShrink: 0, borderTop: `1px solid rgba(255,255,255,0.08)`, background: G.codeBg }}>
            <button onClick={() => setCodeOut(!codeOut)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", border: "none", background: "none", color: "#6c7086", fontSize: 11.5, fontWeight: 500, cursor: "pointer", textAlign: "left" }}>
              <Terminal size={12} />Terminal {codeOut ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button style={{ padding: "3px 10px", borderRadius: 8, background: G.green + "22", border: `1px solid ${G.green}44`, color: G.green, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>▶ Run</button>
                <button style={{ padding: "3px 10px", borderRadius: 8, background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "#6c7086", fontSize: 11, cursor: "pointer" }}><RefreshCw size={10} /></button>
              </div>
            </button>
            {codeOut && (
              <div style={{ padding: "0 14px 10px", fontFamily: "monospace", fontSize: 11.5, color: G.green, lineHeight: 1.7 }}>
                <div>$ node index.js</div>
                <div style={{ color: G.codeText }}>Connecting to Gemini 2.5 Flash…</div>
                <div style={{ color: G.green }}>✓ Analysis complete (1.2s)</div>
                <div style={{ color: G.codeText }}>{"{"} issues: 3, severity: 'medium' {"}"}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
