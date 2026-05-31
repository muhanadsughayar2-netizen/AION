// Variant 3 — Sky Blue #0EA5E9 (lighter, airier)
const BLUE = "#0EA5E9";
const BG = "#1C1C1E";
const CARD = "#2C2C2E";
const WHITE = "#FFFFFF";
const GRAY = "#888888";

function CircleBtn({ icon, label, active }: { icon: string; label: string; active?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: 1 }}>
      <div style={{
        width: 52, height: 52, borderRadius: "50%",
        border: `2px solid ${active ? "#FFD60A" : BLUE}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 22,
        boxShadow: active ? "0 0 10px rgba(255,214,10,0.25)" : `0 0 12px rgba(14,165,233,0.28)`,
      }}>{icon}</div>
      <span style={{ color: BLUE, fontSize: 9, fontWeight: 700, letterSpacing: 0.8 }}>{label}</span>
    </div>
  );
}

function Thumb({ n, wide }: { n: number; wide?: boolean }) {
  return (
    <div style={{
      position: "relative", flex: wide ? 1.3 : 1,
      height: 72, borderRadius: 8,
      background: CARD,
      border: `1.5px solid ${n === 1 ? BLUE : "#3a3a3a"}`,
      overflow: "hidden",
      boxShadow: n === 1 ? `0 0 8px rgba(14,165,233,0.3)` : "none",
    }}>
      <div style={{ width: "100%", height: "100%", background: n === 2 ? "linear-gradient(135deg,#1a1a3a,#3a2060,#ff80b5)" : n === 3 ? "linear-gradient(135deg,#0a1a2a,#0e2a40,#0EA5E922)" : n === 4 ? "linear-gradient(135deg,#1a1a1a,#2a2a2a)" : `linear-gradient(135deg,${BG},${CARD})` }} />
      <div style={{ position: "absolute", top: 4, right: 4, width: 18, height: 18, borderRadius: "50%", background: BLUE, display: "flex", alignItems: "center", justifyContent: "center", color: WHITE, fontSize: 9, fontWeight: 700 }}>{n}</div>
    </div>
  );
}

export function EmberGlow() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#111", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ width: 360, background: BG, borderRadius: 20, overflow: "hidden", boxShadow: "0 32px 80px rgba(0,0,0,0.7)", border: "1px solid #2a2a2a" }}>

        {/* Header */}
        <div style={{ padding: "16px 16px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: WHITE, fontWeight: 900, fontSize: 15, letterSpacing: 1 }}>SNAP</span>
            <span style={{ color: BLUE, fontWeight: 900, fontSize: 15, letterSpacing: 1 }}>TO AI</span>
            <div style={{ background: "#FF0000", borderRadius: 12, padding: "2px 8px", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: WHITE, fontSize: 10 }}>▶</span>
              <span style={{ color: WHITE, fontSize: 10, fontWeight: 700 }}>Tutorials</span>
            </div>
          </div>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,#FF9200,#FF5500)", display: "flex", alignItems: "center", justifyContent: "center", color: WHITE, fontWeight: 800, fontSize: 13 }}>m</div>
        </div>

        {/* Pro Active */}
        <div style={{ display: "flex", justifyContent: "center", paddingBottom: 14 }}>
          <div style={{ border: "1.5px solid #22c55e", borderRadius: 20, padding: "5px 20px", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#22c55e", fontSize: 12 }}>✓</span>
            <span style={{ color: "#22c55e", fontSize: 12, fontWeight: 700 }}>Pro Active</span>
          </div>
        </div>

        {/* Mode Buttons */}
        <div style={{ padding: "0 16px 12px", display: "flex", gap: 4 }}>
          <CircleBtn icon="📷" label="SNAP" />
          <CircleBtn icon="✂️" label="SNIP" />
          <CircleBtn icon="📋" label="FULL PAGE" />
          <CircleBtn icon="⭐" label="ASK AI" active />
        </div>

        {/* AI Ready row */}
        <div style={{ padding: "0 16px 10px", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e" }} />
            <span style={{ color: GRAY, fontSize: 11 }}>AI Ready</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ color: GRAY, fontSize: 11 }}>◎</span>
            <span style={{ color: GRAY, fontSize: 11 }}>Settings</span>
          </div>
        </div>

        {/* Status Bar */}
        <div style={{ margin: "0 16px 12px", background: CARD, borderRadius: 8, padding: "9px 14px", display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: BLUE }} />
          <span style={{ color: WHITE, fontSize: 12, fontWeight: 500 }}>SnapToAI: Ready</span>
        </div>

        {/* Action Buttons */}
        <div style={{ padding: "0 16px 12px", display: "grid", gridTemplateColumns: "1fr 1.2fr 1fr", gap: 8 }}>
          <button style={{ background: "transparent", border: `1.5px solid ${BLUE}`, borderRadius: 8, padding: "10px 4px", color: BLUE, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Select All</button>
          <button style={{ background: BLUE, border: "none", borderRadius: 8, padding: "10px 4px", color: WHITE, fontSize: 12, fontWeight: 800, cursor: "pointer", boxShadow: `0 4px 18px ${BLUE}55` }}>✦ Send to AI</button>
          <button style={{ background: "transparent", border: `1.5px solid ${BLUE}`, borderRadius: 8, padding: "10px 4px", color: BLUE, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Copy</button>
        </div>

        {/* Thumbnails */}
        <div style={{ padding: "0 16px 8px", display: "flex", gap: 8 }}>
          <Thumb n={1} />
          <Thumb n={2} wide />
          <Thumb n={3} />
        </div>
        <div style={{ padding: "0 16px 12px", display: "flex", gap: 8 }}>
          <Thumb n={4} />
          <div style={{ flex: 2.3 }} />
        </div>

        {/* Delete */}
        <div style={{ padding: "0 16px 12px" }}>
          <button style={{ width: "100%", background: "transparent", border: `1px solid #3a3a3a`, borderRadius: 8, padding: "10px", color: GRAY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Delete Selected</button>
        </div>

        {/* Export */}
        <div style={{ padding: "0 16px 16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button style={{ background: CARD, border: "none", borderRadius: 8, padding: "11px", color: WHITE, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>🖨 PNG</button>
          <button style={{ background: CARD, border: "none", borderRadius: 8, padding: "11px", color: WHITE, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>📄 PDF</button>
        </div>

        {/* Label */}
        <div style={{ background: "#151515", padding: "8px 16px", display: "flex", alignItems: "center" }}>
          <span style={{ color: "#444", fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>SKY BLUE · #0EA5E9</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            {[BG, CARD, BLUE, WHITE, "#22c55e"].map(c => (
              <div key={c} style={{ width: 14, height: 14, borderRadius: 3, background: c, border: "1px solid #333" }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
