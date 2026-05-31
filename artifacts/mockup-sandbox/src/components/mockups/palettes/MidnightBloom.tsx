export function MidnightBloom() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'linear-gradient(135deg, #ffe0f0 0%, #f0e8ff 100%)', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ width: 360, background: '#ffffff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 20px 60px rgba(255,45,120,0.18), 0 4px 16px rgba(0,0,0,0.08)', border: '1.5px solid rgba(255,45,120,0.12)' }}>

        {/* Header */}
        <div style={{ padding: '16px 18px', background: 'linear-gradient(135deg, #FF2D78 0%, #9B51E0 100%)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 22 }}>📸</span>
            <div>
              <span style={{ color: '#fff', fontWeight: 800, fontSize: 14, letterSpacing: 0.5 }}>Snap To AI</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ background: 'rgba(255,255,255,0.25)', borderRadius: 20, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10 }}>▶</span>
              <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>Tutorials</span>
            </div>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FF2D78', fontSize: 13, fontWeight: 800, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>m</div>
          </div>
        </div>

        {/* Pro Badge */}
        <div style={{ padding: '10px 18px', background: '#fdf5ff', display: 'flex', justifyContent: 'center', borderBottom: '1px solid #f0e4ff' }}>
          <div style={{ background: 'linear-gradient(90deg, #FF2D78, #9B51E0)', borderRadius: 20, padding: '5px 18px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#fff', fontSize: 11 }}>✓</span>
            <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>Pro Active</span>
          </div>
        </div>

        {/* Mode Buttons */}
        <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {[
            { icon: '📷', label: 'SNAP', active: false },
            { icon: '✂️', label: 'SNIP', active: false },
            { icon: '📄', label: 'FULL PAGE', active: false },
            { icon: '⭐', label: 'ASK AI', active: true },
          ].map((btn) => (
            <div key={btn.label} style={{
              background: btn.active ? 'linear-gradient(135deg, rgba(255,45,120,0.1), rgba(155,81,224,0.1))' : '#f9f9fb',
              border: `1.5px solid ${btn.active ? '#FF2D78' : '#e8e8f0'}`,
              borderRadius: 14, padding: '12px 4px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer',
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                border: `2px solid ${btn.active ? '#FF2D78' : '#dddde8'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17,
                background: btn.active ? 'linear-gradient(135deg, rgba(255,45,120,0.12), rgba(155,81,224,0.12))' : '#fff',
                boxShadow: btn.active ? '0 4px 14px rgba(255,45,120,0.3)' : '0 1px 4px rgba(0,0,0,0.06)',
              }}>{btn.icon}</div>
              <span style={{ color: btn.active ? '#FF2D78' : '#aaaabc', fontSize: 9, fontWeight: 700, letterSpacing: 0.4 }}>{btn.label}</span>
            </div>
          ))}
        </div>

        {/* Status bar */}
        <div style={{ margin: '0 18px 12px', background: '#fff0f6', border: '1.5px solid #ffd0e4', borderRadius: 10, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
          <span style={{ color: '#FF2D78', fontSize: 11, fontWeight: 600 }}>SnapToAI: Ready</span>
        </div>

        {/* Action Buttons */}
        <div style={{ padding: '0 18px 12px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <button style={{ background: '#f4f4fb', border: '1.5px solid #e4e4f0', borderRadius: 10, padding: '10px 4px', color: '#666', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Select All</button>
          <button style={{ background: 'linear-gradient(135deg, #FF2D78, #9B51E0)', border: 'none', borderRadius: 10, padding: '10px 4px', color: '#fff', fontSize: 11, fontWeight: 800, cursor: 'pointer', boxShadow: '0 6px 18px rgba(255,45,120,0.4)' }}>✦ Send to AI</button>
          <button style={{ background: '#f4f4fb', border: '1.5px solid #e4e4f0', borderRadius: 10, padding: '10px 4px', color: '#666', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Copy</button>
        </div>

        {/* Thumbnails */}
        <div style={{ padding: '0 18px 12px', display: 'flex', gap: 8 }}>
          {[1, 2].map(i => (
            <div key={i} style={{ width: 58, height: 44, borderRadius: 8, background: '#fff0f6', border: '1.5px solid #ffd0e4', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
              <span style={{ fontSize: 18 }}>🖼️</span>
            </div>
          ))}
          <div style={{ width: 58, height: 44, borderRadius: 8, border: '1.5px dashed #e0c4f4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#ccc', fontSize: 18 }}>+</span>
          </div>
        </div>

        {/* Delete */}
        <div style={{ padding: '0 18px 12px' }}>
          <button style={{ width: '100%', background: '#fff', border: '1.5px solid #ffe0ec', borderRadius: 10, padding: '9px', color: '#FF2D78', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Delete Selected</button>
        </div>

        {/* Export */}
        <div style={{ padding: '0 18px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button style={{ background: '#fff5f8', border: '1.5px solid #ffd0e4', borderRadius: 10, padding: '11px', color: '#FF2D78', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>🖼 Export PNG</button>
          <button style={{ background: '#f8f4ff', border: '1.5px solid #e0c4f4', borderRadius: 10, padding: '11px', color: '#9B51E0', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>📄 Export PDF</button>
        </div>

        {/* Palette swatch */}
        <div style={{ background: '#fdf5ff', padding: '10px 18px', borderTop: '1px solid #f0e4ff', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ color: '#c090e0', fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>BUBBLEGUM</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {['#FF2D78', '#9B51E0', '#ffffff', '#fdf5ff', '#22c55e'].map(c => (
              <div key={c} style={{ width: 14, height: 14, borderRadius: 4, background: c, border: '1.5px solid #e8e0f4' }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
