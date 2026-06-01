import { useState, useEffect } from "react";

const EV = "#7C3AED";          // Electric Violet
const EV2 = "#9333EA";         // Electric Violet light
const GLASS = "rgba(255,255,255,0.04)";
const BORDER = "1px solid rgba(255,255,255,0.10)";

const thumbData = [1, 2, 3, 4, 5, 6];

const pulseStyle = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

  * { font-family: 'Inter', system-ui, sans-serif; box-sizing: border-box; }

  @keyframes pulse-glow {
    0%, 100% { box-shadow: 0 0 18px 4px rgba(124,58,237,0.35), 0 4px 24px rgba(124,58,237,0.25); }
    50%       { box-shadow: 0 0 32px 8px rgba(147,51,234,0.55), 0 4px 32px rgba(124,58,237,0.4); }
  }
  @keyframes mesh-shift {
    0%   { background-position: 0% 50%; }
    50%  { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  .ask-ai-btn {
    background: linear-gradient(135deg, #5B21B6, #7C3AED, #9333EA, #6D28D9);
    background-size: 300% 300%;
    animation: pulse-glow 2.8s ease-in-out infinite, mesh-shift 5s ease infinite;
  }
  .thumb:hover { border-color: rgba(124,58,237,0.5) !important; }
  button:active { transform: scale(0.97); }
`;

export default function SnapPopup() {
  const [selected, setSelected] = useState<number[]>([1]);
  const [, forceUpdate] = useState(0);

  useEffect(() => { forceUpdate(1); }, []);

  const toggle = (id: number) =>
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const glass = {
    background: GLASS,
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    border: BORDER,
  };

  return (
    <>
      <style>{pulseStyle}</style>
      <div style={{
        background: "#000000",
        width: 380,
        minHeight: 660,
        borderRadius: 24,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        color: "#fff",
        border: BORDER,
        boxShadow: "0 40px 100px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}>

        {/* ── Header ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(255,255,255,0.02)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 19 }}>📸</span>
            <span style={{ fontWeight: 700, fontSize: 14.5, letterSpacing: "-0.02em" }}>
              <span style={{ color: "#fff" }}>Snap</span>
              <span style={{ color: "rgba(255,255,255,0.35)" }}> To AI</span>
            </span>
            <div style={{
              ...glass,
              borderRadius: 20, padding: "3px 9px",
              fontSize: 10.5, color: "rgba(255,255,255,0.45)",
              display: "flex", alignItems: "center", gap: 4, cursor: "pointer",
            }}>
              <span style={{ color: "#ef4444", fontSize: 9 }}>▶</span> Tutorials
            </div>
          </div>
          <div style={{
            width: 30, height: 30, borderRadius: "50%",
            background: `linear-gradient(135deg, ${EV}, ${EV2})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 700, cursor: "pointer",
            boxShadow: "0 2px 12px rgba(124,58,237,0.4)",
          }}>M</div>
        </div>

        {/* ── Pro badge ── */}
        <div style={{ padding: "11px 16px 0" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            ...glass,
            borderRadius: 16, padding: "5px 13px",
            fontSize: 11.5, fontWeight: 600,
            color: "rgba(255,255,255,0.65)",
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: "50%",
              background: EV, display: "inline-block",
              boxShadow: `0 0 6px ${EV}`,
            }} />
            Pro Active
          </div>
        </div>

        {/* ── Capture Studio label ── */}
        <div style={{ padding: "13px 16px 9px" }}>
          <p style={{
            margin: 0, fontSize: 10, fontWeight: 600,
            color: "rgba(255,255,255,0.25)",
            letterSpacing: "0.10em", textTransform: "uppercase",
          }}>Capture Studio</p>
        </div>

        {/* ── Capture buttons ── */}
        <div style={{ padding: "0 16px", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
          {[
            { icon: "📷", label: "Snap" },
            { icon: "✂️", label: "Snip" },
            { icon: "📄", label: "Full Page" },
            { icon: "⭐", label: "Ask AI", special: true },
          ].map(btn => (
            <button
              key={btn.label}
              className={btn.special ? "ask-ai-btn" : ""}
              style={{
                ...(!btn.special ? glass : {}),
                borderRadius: 16,
                padding: "13px 4px 11px",
                cursor: "pointer",
                display: "flex", flexDirection: "column",
                alignItems: "center", gap: 7,
                transition: "transform 0.15s",
                border: btn.special ? "1px solid rgba(147,51,234,0.4)" : BORDER,
                position: "relative", overflow: "hidden",
              }}
            >
              {/* subtle inner highlight for glass buttons */}
              {!btn.special && (
                <div style={{
                  position: "absolute", top: 0, left: 0, right: 0, height: 1,
                  background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent)",
                }} />
              )}
              <span style={{ fontSize: 20 }}>{btn.icon}</span>
              <span style={{
                fontSize: 10, fontWeight: 600,
                color: btn.special ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.45)",
                letterSpacing: "0.04em",
              }}>{btn.label}</span>
            </button>
          ))}
        </div>

        {/* ── Status row ── */}
        <div style={{
          padding: "10px 16px 8px",
          display: "flex", alignItems: "center", gap: 14,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
            AI Ready
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.22)", cursor: "pointer" }}>⚙ Settings</div>
        </div>

        {/* ── Ready bar ── */}
        <div style={{
          margin: "0 16px",
          ...glass,
          borderRadius: 16, padding: "9px 14px",
          display: "flex", alignItems: "center", gap: 8,
          fontSize: 12, color: "rgba(255,255,255,0.4)",
        }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: EV, display: "inline-block", boxShadow: `0 0 5px ${EV}` }} />
          Ready
        </div>

        {/* ── Action row ── */}
        <div style={{ padding: "9px 16px", display: "flex", gap: 7 }}>
          {[
            { label: "Select All", flex: 1 },
            { label: "✦ Send to AI", flex: 1.5, accent: true },
            { label: "Copy", flex: 0.75 },
          ].map(b => (
            <button key={b.label} style={{
              flex: b.flex,
              background: b.accent ? `linear-gradient(135deg, ${EV}, ${EV2})` : GLASS,
              border: b.accent ? "none" : BORDER,
              backdropFilter: b.accent ? undefined : "blur(20px)",
              borderRadius: 16, padding: "8px 4px",
              fontSize: 11.5, fontWeight: 600,
              color: b.accent ? "#fff" : "rgba(255,255,255,0.45)",
              cursor: "pointer",
              letterSpacing: "0.01em",
              boxShadow: b.accent ? `0 4px 20px rgba(124,58,237,0.4)` : "none",
              transition: "transform 0.15s, box-shadow 0.15s",
            }}>{b.label}</button>
          ))}
        </div>

        {/* ── Thumbnail grid ── */}
        <div style={{ flex: 1, padding: "0 16px", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 7 }}>
          {thumbData.map(id => {
            const isSel = selected.includes(id);
            return (
              <div
                key={id}
                className="thumb"
                onClick={() => toggle(id)}
                style={{
                  position: "relative", aspectRatio: "4/3",
                  borderRadius: 16, overflow: "hidden", cursor: "pointer",
                  border: isSel ? `1.5px solid ${EV}` : "1.5px solid rgba(255,255,255,0.07)",
                  boxShadow: isSel ? `0 0 12px rgba(124,58,237,0.3)` : "none",
                  transition: "border 0.15s, box-shadow 0.15s",
                  background: "#0d0d0d",
                }}
              >
                {/* content preview lines */}
                <div style={{ position: "absolute", inset: "8px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ height: 3, borderRadius: 3, background: "rgba(255,255,255,0.12)", width: "72%" }} />
                  <div style={{ height: 2, borderRadius: 2, background: "rgba(255,255,255,0.06)", width: "90%" }} />
                  <div style={{ height: 2, borderRadius: 2, background: "rgba(255,255,255,0.06)", width: "55%" }} />
                  <div style={{ marginTop: 5, height: 14, borderRadius: 6, background: `rgba(124,58,237,0.18)`, width: "80%" }} />
                </div>
                {/* number badge */}
                <div style={{
                  position: "absolute", top: 5, right: 5,
                  width: 16, height: 16, borderRadius: "50%",
                  background: isSel ? EV : "rgba(255,255,255,0.1)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 8.5, fontWeight: 700, color: "#fff",
                  boxShadow: isSel ? `0 0 6px ${EV}` : "none",
                }}>{id}</div>
                {/* checkbox */}
                {isSel && (
                  <div style={{
                    position: "absolute", top: 5, left: 5,
                    width: 15, height: 15, borderRadius: 5,
                    background: EV, display: "flex",
                    alignItems: "center", justifyContent: "center",
                    fontSize: 9, color: "#fff", boxShadow: `0 0 6px ${EV}`,
                  }}>✓</div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Delete ── */}
        <div style={{ padding: "9px 16px 6px" }}>
          <button style={{
            width: "100%",
            ...glass,
            borderRadius: 16, padding: "8px",
            fontSize: 11.5, fontWeight: 600,
            color: "rgba(248,113,113,0.7)",
            cursor: "pointer",
            border: "1px solid rgba(248,113,113,0.12)",
          }}>Delete Selected</button>
        </div>

        {/* ── Export ── */}
        <div style={{ padding: "6px 16px 16px", display: "flex", gap: 7 }}>
          {["🖼 PNG", "📄 PDF"].map(label => (
            <button key={label} style={{
              flex: 1,
              ...glass,
              borderRadius: 16, padding: "8px",
              fontSize: 11.5, fontWeight: 600,
              color: "rgba(255,255,255,0.35)",
              cursor: "pointer",
            }}>{label}</button>
          ))}
        </div>

      </div>
    </>
  );
}
