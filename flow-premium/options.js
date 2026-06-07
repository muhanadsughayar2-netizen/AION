// Aion AI — Options Page

const DEFAULT_SETTINGS = {
  theme: 'auto',
  imageFormat: 'png',
  jpegQuality: 90,
  pdfPaperSize: 'letter-portrait',
  smartPageSplit: true,
  addUrlDateTime: false,
  downloadDirectory: '',
  showSaveAs: false,
  autoDownload: false,
  fitGoogleDocsLimit: true,
  defaultBorderEnabled: true,
  defaultBorderColor: '#00d9ff',
  defaultBorderWidth: 8,
  defaultFrameStyle: 'none'
};

// Null-safe helpers
function elVal(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  if (val === undefined) return 'value' in el ? el.value : undefined;
  if ('checked' in el && typeof val === 'boolean') el.checked = val;
  else if ('value' in el) el.value = val;
  else if ('textContent' in el) el.textContent = val;
}
function elChecked(id) {
  const el = document.getElementById(id);
  return el ? el.checked : DEFAULT_SETTINGS[id] ?? false;
}
function elSelected(id) {
  const el = document.getElementById(id);
  return el ? el.value : undefined;
}

function applyThemeSelection(theme) {
  const valid = { light: 1, dark: 1, auto: 1 };
  const t = valid[theme] ? theme : 'auto';
  document.querySelectorAll('.appearance-card').forEach(card => {
    const isMatch = card.dataset.theme === t;
    card.classList.toggle('selected', isMatch);
    const radio = card.querySelector('input[type="radio"]');
    if (radio) radio.checked = isMatch;
  });
}

async function loadSettings() {
  try {
    const result = await chrome.storage.local.get('snaptoaiSettings');
    const stored = result.snaptoaiSettings;
    const baseDefaults = { ...DEFAULT_SETTINGS };
    if (stored && !stored.theme) baseDefaults.theme = 'dark';
    const settings = { ...baseDefaults, ...stored };

    applyThemeSelection(settings.theme);
    elVal('imageFormat',         settings.imageFormat);
    elVal('jpegQuality',         settings.jpegQuality);
    elVal('jpegQualityValue',    settings.jpegQuality + '%');
    elVal('pdfPaperSize',        settings.pdfPaperSize);
    elVal('smartPageSplit',      settings.smartPageSplit);
    elVal('addUrlDateTime',      settings.addUrlDateTime);
    elVal('downloadDirectory',   settings.downloadDirectory);
    elVal('showSaveAs',          settings.showSaveAs);
    elVal('autoDownload',        settings.autoDownload);
    elVal('fitGoogleDocsLimit',  settings.fitGoogleDocsLimit);
    elVal('defaultBorderEnabled',settings.defaultBorderEnabled);
    elVal('defaultBorderColor',  settings.defaultBorderColor);
    elVal('defaultBorderWidth',  settings.defaultBorderWidth);
    elVal('defaultFrameStyle',   settings.defaultFrameStyle);

    toggleJpegQuality(settings.imageFormat === 'jpeg');
  } catch (e) {
    console.warn('[Aion] loadSettings failed:', e?.message || e);
  }
}

async function saveSettings() {
  try {
    const themeRadio = document.querySelector('.appearance-card input[type="radio"]:checked');
    const settings = {
      theme:               themeRadio ? themeRadio.value : 'auto',
      imageFormat:         elSelected('imageFormat')          || DEFAULT_SETTINGS.imageFormat,
      jpegQuality:         parseInt(elSelected('jpegQuality'))|| DEFAULT_SETTINGS.jpegQuality,
      pdfPaperSize:        elSelected('pdfPaperSize')         || DEFAULT_SETTINGS.pdfPaperSize,
      smartPageSplit:      elChecked('smartPageSplit'),
      addUrlDateTime:      elChecked('addUrlDateTime'),
      downloadDirectory:   sanitizeDirectory(elSelected('downloadDirectory') || ''),
      showSaveAs:          elChecked('showSaveAs'),
      autoDownload:        elChecked('autoDownload'),
      fitGoogleDocsLimit:  elChecked('fitGoogleDocsLimit'),
      defaultBorderEnabled:elChecked('defaultBorderEnabled'),
      defaultBorderColor:  elSelected('defaultBorderColor')   || DEFAULT_SETTINGS.defaultBorderColor,
      defaultBorderWidth:  parseInt(elSelected('defaultBorderWidth')) || DEFAULT_SETTINGS.defaultBorderWidth,
      defaultFrameStyle:   elSelected('defaultFrameStyle')    || DEFAULT_SETTINGS.defaultFrameStyle,
    };
    await chrome.storage.local.set({ snaptoaiSettings: settings });
    showStatus('Settings saved!', 'success');
  } catch (e) {
    console.warn('[Aion] saveSettings failed:', e?.message || e);
    showStatus('Failed to save.', 'error');
  }
}

async function resetSettings() {
  if (confirm('Reset all settings to defaults?')) {
    await chrome.storage.local.set({ snaptoaiSettings: DEFAULT_SETTINGS });
    loadSettings();
    showStatus('Reset to defaults.', 'success');
  }
}

function sanitizeDirectory(dir) {
  return dir.replace(/[^a-zA-Z0-9\-_\/]/g, '').replace(/^\/+|\/+$/g, '');
}

function toggleJpegQuality(show) {
  const row = document.getElementById('jpegQualityRow') || document.getElementById('jpegQualityContainer');
  if (row) row.style.display = show ? 'flex' : 'none';
}

function showStatus(msg, type) {
  const el = document.getElementById('saveStatus') || document.getElementById('saveMsg');
  if (!el) return;
  el.textContent = msg;
  if (el.id === 'saveMsg') {
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  } else {
    el.className = 'save-status ' + type;
    setTimeout(() => { el.className = 'save-status'; }, 3000);
  }
}

async function loadSubscriptionStatus() {
  if (!window.SnapToAISubscription) return;
  const badge   = document.getElementById('statusBadge');
  const message = document.getElementById('trialMessage');
  const subscribeSection = document.getElementById('subscribeSection');
  const proInfo = document.getElementById('proInfo');
  try {
    const status = await window.SnapToAISubscription.check();
    const subActions = document.getElementById('subscriptionActions');
    if (status.isEarlyAccess) {
      if (badge)   { badge.textContent = 'Pro Early Access'; badge.className = 'status-badge pro'; }
      if (message) message.textContent = 'All features available during Early Access!';
      if (subscribeSection) subscribeSection.style.display = 'none';
      if (subActions) subActions.style.display = 'none';
      return;
    }
    if (status.status === 'subscribed') {
      if (badge)   { badge.textContent = 'Pro Active'; badge.className = 'status-badge pro'; }
      if (message) message.textContent = 'Your subscription is active. All features unlocked.';
      if (subscribeSection) subscribeSection.style.display = 'none';
      if (proInfo) {
        proInfo.style.display = 'block';
        const ps = document.getElementById('proStatus'); if (ps) ps.textContent = 'Active';
        const pp = document.getElementById('proPlan');   if (pp) pp.textContent = (status.planType || 'pro').charAt(0).toUpperCase() + (status.planType || 'pro').slice(1);
      }
      if (subActions) subActions.style.display = 'flex';
    } else if (status.status === 'trial') {
      if (badge)   { badge.textContent = 'Trial'; badge.className = 'status-badge trial'; }
      if (message) message.textContent = 'You have ' + status.daysRemaining + ' days remaining.';
      if (subscribeSection) subscribeSection.style.display = 'none';
      if (proInfo) proInfo.style.display = 'none';
      if (subActions) subActions.style.display = 'none';
    } else if (status.status === 'trial_expired' || status.status === 'subscription_expired') {
      if (badge)   { badge.textContent = 'Expired'; badge.className = 'status-badge expired'; }
      if (message) message.textContent = 'Subscribe to continue using AI features.';
      if (subscribeSection) subscribeSection.style.display = 'block';
      if (proInfo) proInfo.style.display = 'none';
      if (subActions) subActions.style.display = status.status === 'subscription_expired' ? 'flex' : 'none';
    } else {
      if (badge)   { badge.textContent = 'Not signed in'; badge.className = 'status-badge'; }
      if (message) message.textContent = 'Sign in with Google to start your free trial.';
      if (subscribeSection) subscribeSection.style.display = 'none';
      if (proInfo) proInfo.style.display = 'none';
      if (subActions) subActions.style.display = 'none';
    }
  } catch (e) {
    console.warn('[Aion] loadSubscriptionStatus failed:', e?.message || e);
    if (badge) { badge.textContent = 'Unknown'; badge.className = 'status-badge'; }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadSubscriptionStatus();

  const imgFmt = document.getElementById('imageFormat');
  if (imgFmt) imgFmt.addEventListener('change', e => toggleJpegQuality(e.target.value === 'jpeg'));

  const jpegQ = document.getElementById('jpegQuality');
  if (jpegQ) jpegQ.addEventListener('input', e => {
    const v = document.getElementById('jpegQualityValue');
    if (v) v.textContent = e.target.value + '%';
  });

  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.addEventListener('click', saveSettings);

  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) resetBtn.addEventListener('click', resetSettings);

  const refreshSubBtn = document.getElementById('refreshSubBtn');
  if (refreshSubBtn) refreshSubBtn.addEventListener('click', async () => {
    if (!window.SnapToAISubscription) return;
    refreshSubBtn.disabled = true; refreshSubBtn.textContent = '⏳ Checking…';
    try {
      const r = await window.SnapToAISubscription.refresh();
      showStatus(r.success && r.status === 'subscribed' ? 'Subscription verified!' : (r.error || 'No active subscription found.'), r.success ? 'success' : 'error');
      loadSubscriptionStatus();
    } catch (e) { showStatus('Could not check subscription.', 'error'); }
    finally { refreshSubBtn.disabled = false; refreshSubBtn.textContent = '🔄 Refresh Subscription Status'; }
  });

  // Theme appearance cards
  document.querySelectorAll('.appearance-card').forEach(card => {
    card.addEventListener('click', () => {
      const t = card.dataset.theme;
      if (!t) return;
      applyThemeSelection(t);
      if (window.SnapToAITheme?.set) window.SnapToAITheme.set(t);
    });
  });
  if (window.SnapToAITheme?.onChange) window.SnapToAITheme.onChange(p => applyThemeSelection(p));

  // Dev box (owner only — 7 clicks on crown)
  let _tc = 0, _tt = 0;
  const _crown = document.getElementById('_crown');
  const _devbox = document.getElementById('_devbox');
  const _xi = document.getElementById('_xi');
  const _xibtn = document.getElementById('_xibtn');
  if (_crown && _devbox && _xi) {
    const _showBox = () => { _xi.value = ''; _devbox.style.display = 'flex'; setTimeout(() => _xi.focus(), 50); };
    const _hideBox = () => { _devbox.style.display = 'none'; _xi.value = ''; };
    const _submit  = async () => { const val = _xi.value; _hideBox(); if (val) { const r = await window.SnapToAI_DEV?.unlock(val); if (r?.success) location.reload(); } };
    _crown.addEventListener('click', () => { const now = Date.now(); if (now - _tt > 2000) _tc = 0; _tt = now; _tc++; if (_tc >= 7) { _tc = 0; _showBox(); } });
    _devbox.addEventListener('click', e => { if (e.target === _devbox) _hideBox(); });
    if (_xibtn) _xibtn.addEventListener('click', _submit);
    _xi.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); _submit(); } if (e.key === 'Escape') _hideBox(); });
  }
});
