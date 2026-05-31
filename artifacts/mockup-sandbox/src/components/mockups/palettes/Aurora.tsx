export function Aurora() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#04080f', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ width: 360, background: '#060d14', borderRadius: 16, overflow: 'hidden', boxShadow: '0 32px 80px rgba(0,0,0,0.7)', border: '1px solid rgba(0,212,255,0.12)' }}>

        {/* Header */}
        <div style={{ padding: '14px 16px', background: 'linear-gradient(135deg, #080f1a 0%, #0a1520 100%)', borderBottom: '1px solid rgba(0,212,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>📸</span>
            <div>
              <span style={{ color: '#fff', fontWeight: 800, fontSize: 13, letterSpacing: 1 }}>SNAP</span>
              <span style={{ color: '#00d4ff', fontWeight: 800, fontSize: 13, letterSpacing: 1 }}> TO AI</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ background: 'rgba(0,212,255,0.12)', border: '1px solid rgba(0,212,255,0.35)', borderRadius: 20, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 10 }}>▶</span>
              <span style={{ color: '#00d4ff', fontSize: 10, fontWeight: 700 }}>Tutorials</span>
            </div>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #00d4ff, #00ff88)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', fontSize: 12, fontWeight: 700 }}>m</div>
          </div>
        </div>

        {/* Pro Badge */}
        <div style={{ padding: '10px 16px', background: '#070e17', display: 'flex', justifyContent: 'center' }}>
          <div style={{ background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.4)', borderRadius: 20, padding: '5px 18px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#00ff88', fontSize: 11 }}>✓</span>
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
              background: btn.active ? 'rgba(0,212,255,0.1)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${btn.active ? 'rgba(0,212,255,0.6)' : 'rgba(255,255,255,0.07)'}`,
              borderRadius: 12, padding: '12px 4px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer',
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: '50%',
                border: `2px solid ${btn.active ? '#00d4ff' : 'rgba(255,255,255,0.15)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                background: btn.active ? 'rgba(0,212,255,0.12)' : 'transparent',
                boxShadow: btn.active ? '0 0 14px rgba(0,212,255,0.35)' : 'none',
              }}>
                {btn.icon}
              </div>
              <span style={{ color: btn.active ? '#00d4ff' : 'rgba(255,255,255,0.4)', fontSize: 9, fontWeight: 700, letterSpacing: 0.5 }}>{btn.label}</span>
            </div>
          ))}
        </div>

        {/* Status */}
        <div style={{ padding: '6px 16px 10px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#00ff88', boxShadow: '0 0 6px #00ff88' }} />
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>AI Ready</span>
          </div>
          <span style={{ color: 'rgba(255,255,255,0.18)', fontSize: 10 }}>◎ Settings</span>
        </div>

        {/* Status Bar */}
        <div style={{ margin: '0 16px 10px', background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.12)', borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00d4ff', boxShadow: '0 0 6px #00d4ff' }} />
          <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11 }}>SnapToAI: Ready</span>
        </div>

        {/* Action Buttons */}
        <div style={{ padding: '0 16px 10px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <button style={{ background: 'rgba(0,212,255,0.07)', border: '1px solid rgba(0,212,255,0.2)', borderRadius: 8, padding: '9px 4px', color: '#00d4ff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Select All</button>
          <button style={{ background: 'linear-gradient(135deg, #00d4ff, #00ff88)', border: 'none', borderRadius: 8, padding: '9px 4px', color: '#000', fontSize: 11, fontWeight: 800, cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,212,255,0.35)' }}>✦ Send to AI</button>
          <button style={{ background: 'rgba(0,255,136,0.07)', border: '1px solid rgba(0,255,136,0.2)', borderRadius: 8, padding: '9px 4px', color: '#00ff88', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Copy</button>
        </div>

        {/* Thumbnails */}
        <div style={{ padding: '0 16px 10px', display: 'flex', gap: 6 }}>
          {[1, 2].map(i => (
            <div key={i} style={{ width: 54, height: 40, borderRadius: 6, background: 'rgba(0,212,255,0.07)', border: '1px solid rgba(0,212,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 16 }}>🖼️</span>
            </div>
          ))}
        </div>

        {/* Delete */}
        <div style={{ padding: '0 16px 12px' }}>
          <button style={{ width: '100%', background: 'transparent', border: '1px solid rgba(0,212,255,0.12)', borderRadius: 8, padding: '8px', color: 'rgba(0,212,255,0.35)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Delete Selected</button>
        </div>

        {/* Export */}
        <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.22)', borderRadius: 8, padding: '10px', color: '#00d4ff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>🖼 PNG</button>
          <button style={{ background: 'rgba(0,255,136,0.08)', border: '1px solid rgba(0,255,136,0.22)', borderRadius: 8, padding: '10px', color: '#00ff88', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>📄 PDF</button>
        </div>

        {/* Palette swatch */}
        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9, fontWeight: 600, letterSpacing: 1 }}>AURORA</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {['#060d14', '#0d1f2d', '#00d4ff', '#00ff88', '#ffffff'].map(c => (
              <div key={c} style={{ width: 14, height: 14, borderRadius: 3, background: c, border: '1px solid rgba(255,255,255,0.12)' }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
