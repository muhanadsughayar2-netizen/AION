async function applyBranding() {
  try {
    if (!chrome || !chrome.storage || !chrome.storage.local) return;
    const { snaptoai_branding } = await chrome.storage.local.get(['snaptoai_branding']);
    const b = snaptoai_branding;
    if (!b) {
      if (window.SnapToAIBranding) window.SnapToAIBranding.clear();
      return;
    }
    let resolved = null;
    // Task #40 — pass full palette so the welcome page's background, text,
    // and borders also reflect the institution's full theme, not just the
    // accent color on the heading.
    if (window.SnapToAIBranding && (b.brandColor || b.pageBg || b.cardBg ||
        b.textPrimary || b.textMuted || b.headerColor || b.highlightColor || b.borderColor)) {
      resolved = window.SnapToAIBranding.apply({
        brand: b.brandColor,
        pageBg: b.pageBg, cardBg: b.cardBg,
        textPrimary: b.textPrimary, textMuted: b.textMuted,
        headerColor: b.headerColor, highlightColor: b.highlightColor,
        borderColor: b.borderColor
      });
    } else if (b.brandColor) {
      document.documentElement.style.setProperty('--accent', b.brandColor);
    }
    if (b.brandColor) {
      const cyans = document.querySelectorAll('h1 .cyan');
      const tint = resolved ? resolved.accent : b.brandColor;
      cyans.forEach((c) => { c.style.color = tint; });
    }
    if (b.logoUrl || b.logoUrlLight) {
      const themeResolved = (window.SnapToAITheme && window.SnapToAITheme.getResolved)
        ? window.SnapToAITheme.getResolved() : 'dark';
      const pick = (themeResolved === 'light' && b.logoUrlLight) ? b.logoUrlLight : (b.logoUrl || b.logoUrlLight);
      const hasBoth = !!(b.logoUrl && b.logoUrlLight);
      const img = document.getElementById('welcomeBrandLogo');
      const url = pick.startsWith('http') ? pick : 'https://www.snaptoai.com' + pick;
      if (img) {
        img.src = url; img.alt = b.name || ''; img.style.display = 'inline-block';
        img.classList.toggle('themed-logo', hasBoth);
      }
      const mark = document.getElementById('welcomeDefaultMark');
      if (mark) mark.style.display = 'none';
      const nameEl = document.getElementById('welcomeInstName');
      if (nameEl && b.name) { nameEl.textContent = 'Welcome to ' + b.name; nameEl.style.display = 'block'; }
    } else if (b.name) {
      const mark = document.getElementById('welcomeDefaultMark');
      if (mark) mark.style.display = 'none';
      const nameEl = document.getElementById('welcomeInstName');
      if (nameEl) { nameEl.textContent = 'Welcome to ' + b.name; nameEl.style.display = 'block'; }
    }
  } catch (e) { /* ignore */ }
}
applyBranding();
// Keep the welcome page's hero accent legible if the visitor toggles
// Light/Dark while the page is open.
try {
  if (window.SnapToAITheme && window.SnapToAITheme.onChange) {
    window.SnapToAITheme.onChange(() => { applyBranding(); });
  }
} catch (e) {}

// Invite codes were retired in favor of email-only institution onboarding.
// Purge any legacy pending-invite key from prior installs.
try {
  if (chrome && chrome.storage && chrome.storage.local) {
    chrome.storage.local.remove('snaptoai_pending_invite');
  }
} catch (e) { /* ignore */ }
