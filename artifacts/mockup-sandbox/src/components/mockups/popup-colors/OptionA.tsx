export function OptionA() {
  return (
    <div style={{
      width: '100%',
      minHeight: '100vh',
      background: '#0d1117',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#e6edf3',
      padding: '16px',
      boxSizing: 'border-box'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontWeight: 800, fontSize: '16px', color: '#fff' }}>SNAP</span>
          <span style={{ fontWeight: 800, fontSize: '16px', color: '#7c5cfc' }}>TO AI</span>
          <span style={{ fontSize: '10px' }}>🔴</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', color: '#8b949e', cursor: 'pointer' }}>👤 Sign in</span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '10px' }}>
        <span style={{
          padding: '4px 14px',
          borderRadius: '20px',
          background: 'rgba(124,92,252,0.12)',
          border: '1px solid rgba(124,92,252,0.3)',
          color: '#7c5cfc',
          fontSize: '13px',
          fontWeight: 700
        }}>0/9</span>
        <span style={{
          padding: '4px 14px',
          borderRadius: '20px',
          background: 'rgba(245,158,11,0.1)',
          border: '1px solid rgba(245,158,11,0.3)',
          color: '#f59e0b',
          fontSize: '12px',
          fontWeight: 600
        }}>Trial · 14 days left</span>
      </div>

      <div style={{
        background: 'rgba(124,92,252,0.04)',
        border: '1px solid rgba(124,92,252,0.12)',
        borderRadius: '16px',
        padding: '16px',
        marginBottom: '10px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', marginBottom: '10px' }}>
          {[
            { label: 'SNAP', icon: 'camera', color: '#7c5cfc' },
            { label: 'SNIP', icon: 'scissors', color: '#a78bfa' },
            { label: 'FULL PAGE', icon: 'doc', color: '#c4b5fd' },
            { label: 'AI', icon: 'star', color: '#f59e0b' }
          ].map((btn, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '9px', fontWeight: 700, color: btn.color, letterSpacing: '1px' }}>{btn.label}</span>
              <div style={{
                width: '56px',
                height: '56px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: `${btn.color}10`,
                border: `2px solid ${btn.color}40`,
                borderRadius: '50%',
                color: btn.color,
                transition: 'all 0.2s'
              }}>
                {btn.icon === 'camera' && <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>}
                {btn.icon === 'scissors' && <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>}
                {btn.icon === 'doc' && <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="13" y2="14"/></svg>}
                {btn.icon === 'star' && <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '11px', color: '#8b949e' }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34d399' }}></span>
          <span>AI Ready</span>
          <span style={{ color: '#555', fontSize: '10px', marginLeft: '4px' }}>Manage</span>
        </div>
      </div>

      <div style={{
        background: 'rgba(124,92,252,0.04)',
        border: '1px solid rgba(124,92,252,0.1)',
        borderRadius: '12px',
        padding: '10px',
        textAlign: 'center',
        marginBottom: '10px'
      }}>
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34d399', display: 'inline-block', marginRight: '6px' }}></span>
        <span style={{ fontSize: '13px', color: '#c0c8d2' }}>Captured! ✓</span>
      </div>

      <div style={{ textAlign: 'center', padding: '30px 0' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#7c5cfc', marginBottom: '6px' }}>Right-click to begin</div>
        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>or use the buttons above ☝️</div>
      </div>

      <div style={{
        position: 'fixed',
        bottom: '16px',
        left: '16px',
        right: '16px',
        display: 'flex',
        gap: '8px'
      }}>
        {['Select All', 'Copy Combined', 'Save PNG', 'Export PDF'].map((label, i) => (
          <button key={i} style={{
            flex: 1,
            padding: '8px 4px',
            background: i === 0 ? 'rgba(124,92,252,0.08)' : 'rgba(124,92,252,0.04)',
            border: `1px solid rgba(124,92,252,${i === 0 ? '0.3' : '0.12'})`,
            borderRadius: '8px',
            color: i === 0 ? '#a78bfa' : '#8b949e',
            fontSize: '10px',
            fontWeight: 600,
            cursor: 'pointer'
          }}>{label}</button>
        ))}
      </div>

      <div style={{ position: 'fixed', bottom: '0', left: '0', right: '0', textAlign: 'center', padding: '6px', fontSize: '9px', color: '#555', background: '#0d1117' }}>
        Option A: Blue-Violet + Amber
      </div>
    </div>
  );
}
