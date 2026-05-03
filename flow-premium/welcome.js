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
    if (b.brandColor) {
      if (window.SnapToAIBranding) {
        resolved = window.SnapToAIBranding.apply(b.brandColor);
      } else {
        document.documentElement.style.setProperty('--accent', b.brandColor);
      }
      const cyans = document.querySelectorAll('h1 .cyan');
      const tint = resolved ? resolved.accent : b.brandColor;
      cyans.forEach((c) => { c.style.color = tint; });
    }
    if (b.logoUrl) {
      const img = document.getElementById('welcomeBrandLogo');
      const url = b.logoUrl.startsWith('http') ? b.logoUrl : 'https://www.snaptoai.com' + b.logoUrl;
      if (img) { img.src = url; img.alt = b.name || ''; img.style.display = 'inline-block'; }
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

(function inviteCodeForm() {
  try {
    if (!chrome || !chrome.storage || !chrome.storage.local) return;
    const toggle = document.getElementById('inviteCodeToggle');
    const form = document.getElementById('inviteCodeForm');
    const input = document.getElementById('inviteCodeInput');
    const save = document.getElementById('inviteCodeSave');
    const msg = document.getElementById('inviteCodeMsg');
    if (!toggle || !form || !input || !save) return;

    chrome.storage.local.get(['snaptoai_pending_invite'], (r) => {
      if (r && r.snaptoai_pending_invite) {
        input.value = String(r.snaptoai_pending_invite).slice(0, 64);
        form.style.display = 'block';
        if (msg) msg.textContent = 'Saved. It will be applied at sign-in.';
      }
    });

    toggle.addEventListener('click', function (e) {
      e.preventDefault();
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
      if (form.style.display === 'block') input.focus();
    });

    save.addEventListener('click', function () {
      const code = (input.value || '').trim().slice(0, 64);
      if (!code) {
        chrome.storage.local.remove('snaptoai_pending_invite', () => {
          if (msg) msg.textContent = 'Cleared.';
        });
        return;
      }
      chrome.storage.local.set({ snaptoai_pending_invite: code }, () => {
        if (msg) msg.textContent = 'Saved. Sign in with Google to join.';
      });
    });
  } catch (e) { /* ignore */ }
})();
