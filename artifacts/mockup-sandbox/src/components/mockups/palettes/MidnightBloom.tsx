export function MidnightBloom() {
  const bg = "#1C1C1E";
  const card = "#2C2C2E";
  const accent = "#3B7BFF";
  const tabBg = "#2C2C2E";

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#111", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ width: 360, background: bg, borderRadius: 24, overflow: "hidden", boxShadow: "0 32px 80px rgba(0,0,0,0.6)" }}>

        {/* Header */}
        <div style={{ padding: "18px 20px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⚡</div>
            <div>
              <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>SnapToAI</span>
              <span style={{ color: "#aaa", fontWeight: 400, fontSize: 15 }}> Pro</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "#888", fontSize: 20 }}>⚙</span>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: `linear-gradient(135deg, ${accent}, #60a5fa)`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 13 }}>M</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ padding: "0 20px 16px" }}>
          <div style={{ background: tabBg, borderRadius: 12, padding: 4, display: "flex", gap: 2 }}>
            {["Capture", "History", "Ask AI"].map((tab, i) => (
              <div key={tab} style={{
                flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 9,
                background: i === 0 ? "#fff" : "transparent",
                color: i === 0 ? "#000" : "#888",
                fontWeight: i === 0 ? 700 : 500,
                fontSize: 13, cursor: "pointer",
              }}>{tab}</div>
            ))}
          </div>
        </div>

        {/* Capture Buttons */}
        <div style={{ padding: "0 20px 20px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {[
            { icon: "🖥", label: "SCREEN" },
            { icon: "✂️", label: "SNIP" },
            { icon: "📄", label: "FULL" },
          ].map((btn) => (
            <div key={btn.label} style={{
              background: card, borderRadius: 16, padding: "20px 0",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 10, cursor: "pointer",
            }}>
              <span style={{ fontSize: 24 }}>{btn.icon}</span>
              <span style={{ color: "#ccc", fontSize: 11, fontWeight: 700, letterSpacing: 0.8 }}>{btn.label}</span>
            </div>
          ))}
        </div>

        {/* Recent Capture */}
        <div style={{ padding: "0 20px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#888", fontSize: 12, fontWeight: 700, letterSpacing: 0.8 }}>RECENT CAPTURE</span>
          <span style={{ color: accent, fontSize: 12, fontWeight: 700, letterSpacing: 0.5 }}>LIVE PREVIEW</span>
        </div>

        {/* Preview Image */}
        <div style={{ margin: "0 20px 20px", borderRadius: 14, overflow: "hidden", height: 180, position: "relative" }}>
          <img src="/recent-capture.png" alt="Recent capture" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>

        {/* CTA */}
        <div style={{ padding: "0 20px 20px" }}>
          <button style={{
            width: "100%", background: accent, border: "none", borderRadius: 50,
            padding: "16px", color: "#fff", fontSize: 15, fontWeight: 700,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            boxShadow: `0 8px 24px ${accent}55`,
          }}>
            <span style={{ fontSize: 18 }}>✦</span> Analyze with AI
          </button>
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid #2a2a2a" }}>
          <div style={{ display: "flex", gap: 16 }}>
            <span style={{ color: "#666", fontSize: 11, fontWeight: 600, letterSpacing: 0.5 }}>PRIVACY</span>
            <span style={{ color: "#666", fontSize: 11, fontWeight: 600, letterSpacing: 0.5 }}>EXPORT</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {["⧉", "⬇"].map(ic => (
              <div key={ic} style={{ width: 32, height: 32, borderRadius: 8, background: card, display: "flex", alignItems: "center", justifyContent: "center", color: "#888", fontSize: 14, cursor: "pointer" }}>{ic}</div>
            ))}
          </div>
        </div>

        {/* Label */}
        <div style={{ background: "#151515", padding: "8px 20px", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#555", fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>ELECTRIC BLUE</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            {[bg, card, accent, "#fff", "#888"].map(c => (
              <div key={c} style={{ width: 14, height: 14, borderRadius: 3, background: c, border: "1px solid #333" }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
