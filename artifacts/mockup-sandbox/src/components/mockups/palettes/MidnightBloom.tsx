// Blue Pill Button style applied — showing actual SnapToAI popup with new button design
const BLUE = "#3B7BFF";
const BLUE_HOVER = "#2B6AEE";
const BG = "#1C1C1E";
const CARD = "#2C2C2E";
const WHITE = "#ffffff";
const GRAY = "#888888";

function PillBtn({ label, icon, solid, wide, danger }: {
  label: string; icon?: string; solid?: boolean; wide?: boolean; danger?: boolean;
}) {
  return (
    <button style={{
      flex: wide ? 1.3 : 1,
      background: danger ? "rgba(255,71,87,0.15)" : solid ? BLUE : BLUE,
      border: danger ? "1px solid rgba(255,71,87,0.35)" : "none",
      borderRadius: 50,
      padding: "10px 8px",
      color: danger ? "#ff4757" : WHITE,
      fontSize: 12,
      fontWeight: 700,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      boxShadow: danger ? "none" : `0 2px 10px rgba(59,123,255,0.35)`,
    }}>
      {icon && <span>{icon}</span>}
      {label}
    </button>
  );
}

function CircleBtn({ icon, label, active }: { icon: string; label: string; active?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: 1 }}>
      <div style={{
        width: 54, height: 54, borderRadius: "50%",
        background: active ? "rgba(255,215,0,0.08)" : `rgba(59,123,255,0.15)`,
        border: `2px solid ${active ? "#ffd700" : BLUE}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 22,
        boxShadow: active ? "0 0 14px rgba(255,215,0,0.2)" : `0 0 14px rgba(59,123,255,0.25)`,
      }}>{icon}</div>
      <span style={{ color: active ? "#ffd700" : BLUE, fontSize: 9, fontWeight: 700, letterSpacing: 0.8 }}>{label}</span>
    </div>
  );
}

function Thumb({ n }: { n: number }) {
  const colors: Record<number, string> = {
    1: `linear-gradient(135deg,${BG},${CARD})`,
    2: "linear-gradient(135deg,#1a1a3a,#3a2060,#ff80b5)",
    3: "linear-gradient(135deg,#0a1a2a,#0e2a40,#3B7BFF22)",
    4: `linear-gradient(135deg,#1a1a1a,#2a2a2a)`,
  };
  return (
    <div style={{
      position: "relative", flex: 1, height: 72, borderRadius: 8,
      background: CARD,
      border: `1.5px solid ${n === 1 ? BLUE : "#3a3a3a"}`,
      overflow: "hidden",
      boxShadow: n === 1 ? `0 0 8px rgba(59,123,255,0.3)` : "none",
    }}>
      <div style={{ width: "100%", height: "100%", background: colors[n] }} />
      <div style={{
        position: "absolute", top: 4, right: 4,
        width: 18, height: 18, borderRadius: "50%",
        background: BLUE, display: "flex", alignItems: "center",
        justifyContent: "center", color: WHITE, fontSize: 9, fontWeight: 700,
      }}>{n}</div>
    </div>
  );
}

export function MidnightBloom() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#111", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ width: 360, background: BG, borderRadius: 20, overflow: "hidden", boxShadow: "0 32px 80px rgba(0,0,0,0.7)", border: "1px solid #2a2a2a" }}>

        {/* Header */}
        <div style={{ padding: "16px 16px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: WHITE, fontWeight: 900, fontSize: 15, letterSpacing: 1 }}>SNAP</span>
            <span style={{ color: BLUE, fontWeight: 900, fontSize: 15, letterSpacing: 1 }}>TO AI</span>
            <div style={{ background: "#FF0000", borderRadius: 50, padding: "2px 10px", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: WHITE, fontSize: 10 }}>▶</span>
              <span style={{ color: WHITE, fontSize: 10, fontWeight: 700 }}>Tutorials</span>
            </div>
          </div>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,#FF9200,#FF5500)", display: "flex", alignItems: "center", justifyContent: "center", color: WHITE, fontWeight: 800, fontSize: 13 }}>m</div>
        </div>

        {/* Pro Active */}
        <div style={{ display: "flex", justifyContent: "center", paddingBottom: 14 }}>
          <button style={{ background: BLUE, border: "none", borderRadius: 50, padding: "6px 22px", color: WHITE, fontSize: 12, fontWeight: 700, cursor: "pointer", boxShadow: `0 2px 12px rgba(59,123,255,0.4)`, display: "flex", alignItems: "center", gap: 6 }}>
            <span>✓</span> Pro Active
          </button>
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
          <span style={{ color: GRAY, fontSize: 11 }}>◎ Settings</span>
        </div>

        {/* Status Bar */}
        <div style={{ margin: "0 16px 12px", background: CARD, borderRadius: 50, padding: "9px 16px", display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: BLUE, boxShadow: `0 0 6px ${BLUE}` }} />
          <span style={{ color: WHITE, fontSize: 12, fontWeight: 500 }}>SnapToAI: Ready</span>
        </div>

        {/* Action Buttons */}
        <div style={{ padding: "0 16px 12px", display: "flex", gap: 8 }}>
          <PillBtn label="Select All" />
          <PillBtn label="✦ Send to AI" solid wide />
          <PillBtn label="Copy" />
        </div>

        {/* Thumbnails */}
        <div style={{ padding: "0 16px 8px", display: "flex", gap: 8 }}>
          <Thumb n={1} /><Thumb n={2} /><Thumb n={3} />
        </div>
        <div style={{ padding: "0 16px 12px", display: "flex", gap: 8 }}>
          <Thumb n={4} /><div style={{ flex: 2 }} />
        </div>

        {/* Delete */}
        <div style={{ padding: "0 16px 12px" }}>
          <PillBtn label="Delete Selected" danger />
        </div>

        {/* Export */}
        <div style={{ padding: "0 16px 16px", display: "flex", gap: 8 }}>
          <PillBtn label="🖨 PNG" />
          <PillBtn label="📄 PDF" />
        </div>

        {/* Swatch */}
        <div style={{ background: "#151515", padding: "8px 16px", display: "flex", alignItems: "center" }}>
          <span style={{ color: "#444", fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>BLUE PILL · #3B7BFF</span>
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
