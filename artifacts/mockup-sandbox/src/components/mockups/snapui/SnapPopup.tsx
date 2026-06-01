import { useState } from "react";

const thumbnails = [
  { id: 1, selected: true, bg: "from-emerald-900 to-slate-900" },
  { id: 2, selected: false, bg: "from-indigo-900 to-slate-900" },
  { id: 3, selected: false, bg: "from-violet-900 to-slate-900" },
  { id: 4, selected: false, bg: "from-slate-800 to-slate-900" },
  { id: 5, selected: false, bg: "from-blue-900 to-slate-900" },
  { id: 6, selected: false, bg: "from-purple-900 to-slate-900" },
];

export default function SnapPopup() {
  const [selected, setSelected] = useState<number[]>([1]);

  const toggle = (id: number) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id]
    );

  return (
    <div
      style={{
        fontFamily: "'Inter', system-ui, sans-serif",
        background: "#0A0A0A",
        width: 380,
        minHeight: 660,
        borderRadius: 20,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        color: "#fff",
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "0 32px 80px rgba(0,0,0,0.8)",
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "#111111",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 20 }}>📸</span>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>
            <span style={{ color: "#fff" }}>Snap</span>
            <span style={{ color: "#A1A1AA" }}> To AI</span>
          </span>
          {/* Tutorials pill */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 20,
              padding: "3px 9px",
              fontSize: 11,
              color: "#A1A1AA",
              cursor: "pointer",
            }}
          >
            <span style={{ color: "#ef4444", fontSize: 10 }}>▶</span> Tutorials
          </div>
        </div>
        {/* Avatar */}
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          M
        </div>
      </div>

      {/* ── Pro badge ── */}
      <div style={{ padding: "10px 16px 0" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "rgba(99,102,241,0.12)",
            border: "1px solid rgba(99,102,241,0.3)",
            borderRadius: 20,
            padding: "5px 14px",
            fontSize: 12,
            fontWeight: 600,
            color: "#a5b4fc",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#6366f1", display: "inline-block" }} />
          Pro Active
        </div>
      </div>

      {/* ── Capture buttons ── */}
      <div style={{ padding: "14px 16px 0" }}>
        <p style={{ margin: "0 0 10px", fontSize: 10.5, fontWeight: 600, color: "#52525b", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Capture Studio
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
          {[
            { icon: "📷", label: "Snap" },
            { icon: "✂️", label: "Snip" },
            { icon: "📄", label: "Full Page" },
            { icon: "⭐", label: "Ask AI", accent: true },
          ].map((btn) => (
            <button
              key={btn.label}
              style={{
                background: btn.accent
                  ? "linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.25))"
                  : "rgba(255,255,255,0.04)",
                border: btn.accent
                  ? "1px solid rgba(139,92,246,0.5)"
                  : "1px solid rgba(255,255,255,0.08)",
                borderRadius: 14,
                padding: "12px 4px 10px",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                backdropFilter: "blur(20px)",
                transition: "all 0.2s",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {btn.accent && (
                <div style={{
                  position: "absolute", inset: 0,
                  background: "radial-gradient(ellipse at 50% 0%, rgba(139,92,246,0.3) 0%, transparent 70%)",
                  pointerEvents: "none",
                }} />
              )}
              <span style={{ fontSize: 20 }}>{btn.icon}</span>
              <span style={{
                fontSize: 10, fontWeight: 600, color: btn.accent ? "#c4b5fd" : "#A1A1AA",
                letterSpacing: "0.04em",
              }}>
                {btn.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Status ── */}
      <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#6ee7b7" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#6ee7b7", display: "inline-block" }} />
          AI Ready
        </div>
        <div style={{ fontSize: 11, color: "#52525b", cursor: "pointer" }}>⚙ Settings</div>
      </div>

      {/* ── Ready bar ── */}
      <div
        style={{
          margin: "0 16px",
          background: "#161616",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 12,
          padding: "9px 14px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          color: "#A1A1AA",
          backdropFilter: "blur(20px)",
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#6366f1", display: "inline-block" }} />
        Ready
      </div>

      {/* ── Action row ── */}
      <div style={{ padding: "10px 16px", display: "flex", gap: 8 }}>
        {[
          { label: "Select All", flex: 1 },
          { label: "✦ Send to AI", flex: 1.4, accent: true },
          { label: "Copy", flex: 0.8 },
        ].map((b) => (
          <button
            key={b.label}
            style={{
              flex: b.flex,
              background: b.accent
                ? "linear-gradient(135deg,#6366f1,#8b5cf6)"
                : "rgba(255,255,255,0.05)",
              border: b.accent ? "none" : "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              padding: "8px 4px",
              fontSize: 11.5,
              fontWeight: 600,
              color: b.accent ? "#fff" : "#A1A1AA",
              cursor: "pointer",
              backdropFilter: "blur(20px)",
              letterSpacing: "0.01em",
              boxShadow: b.accent ? "0 4px 20px rgba(99,102,241,0.35)" : "none",
              transition: "all 0.2s",
              position: "relative",
            }}
          >
            {b.label}
          </button>
        ))}
      </div>

      {/* ── Screenshot grid ── */}
      <div
        style={{
          flex: 1,
          padding: "0 16px",
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: 7,
        }}
      >
        {thumbnails.map((t) => {
          const isSel = selected.includes(t.id);
          return (
            <div
              key={t.id}
              onClick={() => toggle(t.id)}
              style={{
                position: "relative",
                aspectRatio: "4/3",
                borderRadius: 10,
                overflow: "hidden",
                cursor: "pointer",
                border: isSel
                  ? "1.5px solid rgba(139,92,246,0.8)"
                  : "1.5px solid rgba(255,255,255,0.05)",
                transition: "border 0.15s",
                boxShadow: isSel ? "0 0 10px rgba(139,92,246,0.3)" : "none",
              }}
            >
              <div
                style={{
                  position: "absolute", inset: 0,
                  background: `linear-gradient(135deg, var(--from), var(--to))`,
                  backgroundImage: `linear-gradient(135deg, #1a1a2e, #16213e)`,
                }}
              />
              {/* Mini content lines */}
              <div style={{ position: "absolute", inset: "8px 8px", display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.15)", width: "70%" }} />
                <div style={{ height: 2, borderRadius: 2, background: "rgba(255,255,255,0.08)", width: "90%" }} />
                <div style={{ height: 2, borderRadius: 2, background: "rgba(255,255,255,0.08)", width: "60%" }} />
                <div style={{ marginTop: 4, height: 12, borderRadius: 4, background: "rgba(99,102,241,0.25)", width: "80%" }} />
              </div>
              {/* Number badge */}
              <div style={{
                position: "absolute", top: 5, right: 5,
                width: 16, height: 16, borderRadius: "50%",
                background: isSel ? "rgba(139,92,246,0.9)" : "rgba(255,255,255,0.12)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 8.5, fontWeight: 700, color: "#fff",
              }}>
                {t.id}
              </div>
              {/* Selection checkbox */}
              {isSel && (
                <div style={{
                  position: "absolute", top: 5, left: 5,
                  width: 14, height: 14, borderRadius: 4,
                  background: "rgba(99,102,241,0.9)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 8, color: "#fff",
                }}>
                  ✓
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Delete ── */}
      <div style={{ padding: "10px 16px 6px" }}>
        <button style={{
          width: "100%",
          background: "rgba(239,68,68,0.07)",
          border: "1px solid rgba(239,68,68,0.15)",
          borderRadius: 10,
          padding: "8px",
          fontSize: 11.5,
          fontWeight: 600,
          color: "#f87171",
          cursor: "pointer",
          letterSpacing: "0.01em",
        }}>
          Delete Selected
        </button>
      </div>

      {/* ── Export row ── */}
      <div style={{ padding: "6px 16px 16px", display: "flex", gap: 8 }}>
        {["🖼 PNG", "📄 PDF"].map((label) => (
          <button
            key={label}
            style={{
              flex: 1,
              background: "#161616",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              padding: "8px",
              fontSize: 11.5,
              fontWeight: 600,
              color: "#A1A1AA",
              cursor: "pointer",
              backdropFilter: "blur(20px)",
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
