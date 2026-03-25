export function OptionD() {
  const cyan = '#00e5cc';
  const bg = '#0a0e17';
  const panelBg = 'rgba(0,229,204,0.03)';
  const panelBorder = 'rgba(0,229,204,0.12)';
  const textDim = 'rgba(200,215,230,0.5)';
  const textMuted = '#5a6a7a';
  const textLight = '#c8d7e6';
  const glowSm = `0 0 8px rgba(0,229,204,0.15)`;
  const glowMd = `0 0 15px rgba(0,229,204,0.2)`;

  return (
    <div style={{
      width: '100%',
      minHeight: '100vh',
      background: bg,
      fontFamily: "'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif",
      color: textLight,
      padding: '16px',
      boxSizing: 'border-box',
      position: 'relative'
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontWeight: 700, fontSize: '15px', color: 'rgba(255,255,255,0.9)', letterSpacing: '1.5px', fontFamily: "'Space Grotesk', sans-serif" }}>SNAP</span>
          <span style={{ fontWeight: 700, fontSize: '15px', color: cyan, letterSpacing: '1.5px', fontFamily: "'Space Grotesk', sans-serif", textShadow: `0 0 10px rgba(0,229,204,0.4)` }}>TO AI</span>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ff4757', boxShadow: '0 0 6px rgba(255,71,87,0.5)', display: 'inline-block', marginLeft: '2px' }}></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={textMuted} strokeWidth="1.5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span style={{ fontSize: '11px', color: textMuted, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '0.5px' }}>Sign in</span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '12px' }}>
        <span style={{
          padding: '4px 16px',
          borderRadius: '20px',
          background: 'rgba(0,229,204,0.08)',
          border: `1px solid rgba(0,229,204,0.25)`,
          color: cyan,
          fontSize: '13px',
          fontWeight: 600,
          fontFamily: "'JetBrains Mono', monospace",
          boxShadow: glowSm,
          letterSpacing: '0.5px'
        }}>0/9</span>
        <span style={{
          padding: '4px 14px',
          borderRadius: '20px',
          background: 'rgba(0,229,204,0.04)',
          border: `1px solid rgba(0,229,204,0.12)`,
          color: textDim,
          fontSize: '11px',
          fontWeight: 500,
          fontFamily: "'Space Grotesk', sans-serif",
          letterSpacing: '0.5px'
        }}>Trial · 14 days left</span>
      </div>

      <div style={{
        background: panelBg,
        border: `1px solid ${panelBorder}`,
        borderRadius: '16px',
        padding: '20px 16px 14px',
        marginBottom: '12px',
        backdropFilter: 'blur(12px)',
        boxShadow: `inset 0 1px 0 rgba(0,229,204,0.06), ${glowSm}`
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginBottom: '14px' }}>
          {[
            { label: 'SNAP', icon: 'camera', active: true },
            { label: 'SNIP', icon: 'scissors', active: false },
            { label: 'FULL PAGE', icon: 'doc', active: false },
            { label: 'AI', icon: 'star', active: false }
          ].map((btn, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '54px',
                height: '54px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: btn.active ? 'rgba(0,229,204,0.1)' : 'rgba(0,229,204,0.03)',
                border: `1.5px solid ${btn.active ? 'rgba(0,229,204,0.5)' : 'rgba(0,229,204,0.15)'}`,
                borderRadius: '50%',
                color: btn.active ? cyan : 'rgba(0,229,204,0.5)',
                boxShadow: btn.active ? glowMd : 'none',
                transition: 'all 0.3s ease'
              }}>
                {btn.icon === 'camera' && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>}
                {btn.icon === 'scissors' && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>}
                {btn.icon === 'doc' && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="13" y2="14"/></svg>}
                {btn.icon === 'star' && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>}
              </div>
              <span style={{
                fontSize: '8px',
                fontWeight: 600,
                color: btn.active ? cyan : textMuted,
                letterSpacing: '1.5px',
                fontFamily: "'Space Grotesk', sans-serif",
                textTransform: 'uppercase',
                textShadow: btn.active ? `0 0 8px rgba(0,229,204,0.3)` : 'none'
              }}>{btn.label}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '11px' }}>
          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#00e5cc', boxShadow: '0 0 6px rgba(0,229,204,0.5)' }}></span>
          <span style={{ color: cyan, fontWeight: 500, fontFamily: "'Space Grotesk', sans-serif", fontSize: '11px' }}>AI Ready</span>
          <span style={{ color: textMuted, fontSize: '10px', marginLeft: '4px', fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '0.3px' }}>Manage</span>
        </div>
      </div>

      <div style={{
        background: panelBg,
        border: `1px solid ${panelBorder}`,
        borderRadius: '12px',
        padding: '10px',
        textAlign: 'center',
        marginBottom: '12px',
        backdropFilter: 'blur(8px)'
      }}>
        <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#00e5cc', boxShadow: '0 0 6px rgba(0,229,204,0.5)', display: 'inline-block', marginRight: '6px' }}></span>
        <span style={{ fontSize: '12px', color: textLight, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 500 }}>Captured! ✓</span>
      </div>

      <div style={{ textAlign: 'center', padding: '28px 0' }}>
        <div style={{
          fontSize: '15px',
          fontWeight: 700,
          color: cyan,
          marginBottom: '6px',
          fontFamily: "'Space Grotesk', sans-serif",
          letterSpacing: '0.5px',
          textShadow: `0 0 20px rgba(0,229,204,0.3)`
        }}>Right-click to begin</div>
        <div style={{ fontSize: '12px', color: textDim, fontFamily: "'Space Grotesk', sans-serif" }}>or use the buttons above ☝️</div>
      </div>

      <div style={{
        position: 'fixed',
        bottom: '28px',
        left: '16px',
        right: '16px',
        display: 'flex',
        gap: '6px'
      }}>
        {['SELECT ALL', 'COPY COMBINED', 'SAVE PNG', 'EXPORT PDF'].map((label, i) => (
          <button key={i} style={{
            flex: 1,
            padding: '10px 4px',
            background: i === 2 ? 'rgba(0,229,204,0.12)' : 'rgba(0,229,204,0.03)',
            border: `1px solid ${i === 2 ? 'rgba(0,229,204,0.4)' : 'rgba(0,229,204,0.1)'}`,
            borderRadius: '8px',
            color: i === 2 ? cyan : textMuted,
            fontSize: '9px',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: "'Space Grotesk', sans-serif",
            letterSpacing: '0.8px',
            textTransform: 'uppercase',
            boxShadow: i === 2 ? glowSm : 'none',
            transition: 'all 0.2s ease'
          }}>{label}</button>
        ))}
      </div>

      <div style={{
        position: 'fixed',
        bottom: '0',
        left: '0',
        right: '0',
        textAlign: 'center',
        padding: '8px',
        fontSize: '10px',
        color: textMuted,
        background: bg,
        fontFamily: "'Space Grotesk', sans-serif",
        letterSpacing: '1px'
      }}>
        Electric Cyan · Dark Mode
      </div>
    </div>
  );
}
