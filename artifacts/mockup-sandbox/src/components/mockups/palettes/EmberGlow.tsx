export function EmberGlow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#080500', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ width: 360, background: '#0d0900', borderRadius: 16, overflow: 'hidden', boxShadow: '0 32px 80px rgba(0,0,0,0.75)', border: '1px solid rgba(255,146,0,0.13)' }}>

        {/* Header */}
        <div style={{ padding: '14px 16px', background: 'linear-gradient(135deg, #110900 0%, #180e00 100%)', borderBottom: '1px solid rgba(255,146,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>📸</span>
            <div>
              <span style={{ color: '#fff', fontWeight: 800, fontSize: 13, letterSpacing: 1 }}>SNAP</span>
              <span style={{ color: '#ff9200', fontWeight: 800, fontSize: 13, letterSpacing: 1 }}> TO AI</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ background: 'rgba(255,146,0,0.13)', border: '1px solid rgba(255,146,0,0.4)', borderRadius: 20, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 10 }}>▶</span>
              <span style={{ color: '#ff9200', fontSize: 10, fontWeight: 700 }}>Tutorials</span>
            </div>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #ff9200, #ffd60a)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', fontSize: 12, fontWeight: 700 }}>m</div>
          </div>
        </div>

        {/* Pro Badge */}
        <div style={{ padding: '10px 16px', background: '#0f0a00', display: 'flex', justifyContent: 'center' }}>
          <div style={{ background: 'rgba(255,214,10,0.1)', border: '1px solid rgba(255,214,10,0.4)', borderRadius: 20, padding: '5px 18px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#ffd60a', fontSize: 11 }}>✓</span>
            <span style={{ color: '#fff', fontSize: 11, fontWeight: 600 }}>Pro Active</span>
          </div>
        </div>

        {/* Mode Buttons */}
        <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {[
            { icon: '📷', label: 'SNAP', active: false },
            { icon: '✂️', label: 'SNIP', active: false },
            { icon: '📄', label: 'FULL PAGE', active: false },
            { icon: '⭐', label: 'ASK AI', active: true },
          ].map((btn) => (
            <div key={btn.label} style={{
              background: btn.active ? 'rgba(255,146,0,0.1)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${btn.active ? 'rgba(255,146,0,0.65)' : 'rgba(255,255,255,0.06)'}`,
              borderRadius: 12, padding: '12px 4px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer',
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: '50%',
                border: `2px solid ${btn.active ? '#ff9200' : 'rgba(255,255,255,0.14)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                background: btn.active ? 'rgba(255,146,0,0.12)' : 'transparent',
                boxShadow: btn.active ? '0 0 14px rgba(255,146,0,0.4)' : 'none',
              }}>
                {btn.icon}
              </div>
              <span style={{ color: btn.active ? '#ff9200' : 'rgba(255,255,255,0.38)', fontSize: 9, fontWeight: 700, letterSpacing: 0.5 }}>{btn.label}</span>
            </div>
          ))}
        </div>

        {/* Status */}
        <div style={{ padding: '6px 16px 10px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#50dc78', boxShadow: '0 0 6px #50dc78' }} />
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>AI Ready</span>
          </div>
          <span style={{ color: 'rgba(255,255,255,0.18)', fontSize: 10 }}>◎ Settings</span>
        </div>

        {/* Status Bar */}
        <div style={{ margin: '0 16px 10px', background: 'rgba(255,146,0,0.06)', border: '1px solid rgba(255,146,0,0.13)', borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#ffd60a', boxShadow: '0 0 6px #ffd60a' }} />
          <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11 }}>SnapToAI: Ready</span>
        </div>

        {/* Action Buttons */}
        <div style={{ padding: '0 16px 10px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <button style={{ background: 'rgba(255,146,0,0.08)', border: '1px solid rgba(255,146,0,0.22)', borderRadius: 8, padding: '9px 4px', color: '#ff9200', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Select All</button>
          <button style={{ background: 'linear-gradient(135deg, #ff9200, #ffd60a)', border: 'none', borderRadius: 8, padding: '9px 4px', color: '#000', fontSize: 11, fontWeight: 800, cursor: 'pointer', boxShadow: '0 4px 16px rgba(255,146,0,0.4)' }}>✦ Send to AI</button>
          <button style={{ background: 'rgba(255,214,10,0.07)', border: '1px solid rgba(255,214,10,0.2)', borderRadius: 8, padding: '9px 4px', color: '#ffd60a', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Copy</button>
        </div>

        {/* Thumbnails */}
        <div style={{ padding: '0 16px 10px', display: 'flex', gap: 6 }}>
          {[1, 2].map(i => (
            <div key={i} style={{ width: 54, height: 40, borderRadius: 6, background: 'rgba(255,146,0,0.07)', border: '1px solid rgba(255,146,0,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 16 }}>🖼️</span>
            </div>
          ))}
        </div>

        {/* Delete */}
        <div style={{ padding: '0 16px 12px' }}>
          <button style={{ width: '100%', background: 'transparent', border: '1px solid rgba(255,146,0,0.12)', borderRadius: 8, padding: '8px', color: 'rgba(255,146,0,0.38)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Delete Selected</button>
        </div>

        {/* Export */}
        <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button style={{ background: 'rgba(255,146,0,0.08)', border: '1px solid rgba(255,146,0,0.22)', borderRadius: 8, padding: '10px', color: '#ff9200', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>🖼 PNG</button>
          <button style={{ background: 'rgba(255,214,10,0.08)', border: '1px solid rgba(255,214,10,0.22)', borderRadius: 8, padding: '10px', color: '#ffd60a', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>📄 PDF</button>
        </div>

        {/* Palette swatch */}
        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9, fontWeight: 600, letterSpacing: 1 }}>EMBER GLOW</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {['#0d0900', '#1c1100', '#ff9200', '#ffd60a', '#50dc78'].map(c => (
              <div key={c} style={{ width: 14, height: 14, borderRadius: 3, background: c, border: '1px solid rgba(255,255,255,0.12)' }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
