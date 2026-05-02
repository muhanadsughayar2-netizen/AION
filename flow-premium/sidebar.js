// ============================================================
// SnapToAI — Sidebar Mode (v2.5.0)
// Wires the new sidebar hero (live preview + capture row + key
// status + account) on top of the embedded ai-chat UI. The chat
// itself is initialised by ai-chat.js using the same DOM IDs.
// ============================================================
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const els = {
    previewWrap: $('sbPreviewWrap'),
    previewImg: $('sbPreviewImg'),
    previewEmpty: $('sbPreviewEmpty'),
    previewEmptyText: $('sbPreviewEmptyText'),
    previewBadge: $('sbPreviewBadge'),
    previewBadgeText: $('sbPreviewBadgeText'),
    previewTabTitle: $('sbPreviewTabTitle'),
    snap: $('sbSnapBtn'),
    snip: $('sbSnipBtn'),
    full: $('sbFullPageBtn'),
    askAi: $('sbAskAiBtn'),
    keyPill: $('sbKeyPill'),
    keyText: $('sbKeyText'),
    keyAction: $('sbKeyAction'),
    signIn: $('sbSignInBtn'),
    avatar: $('sbAvatar'),
    openWindow: $('sbOpenWindowBtn'),
    toast: $('sbToast'),
    chatInput: $('chatInput'),
  };

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg, kind = '', ms = 2600) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.className = 'sb-toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.remove('show');
    }, ms);
  }

  // ---------- Tab targeting ----------
  // The sidebar lives inside the user's main browser window so we
  // simply ask Chrome for the active tab in that window. We exclude
  // chrome:// / extension pages where captureVisibleTab fails.
  const RESTRICTED_PREFIXES = [
    'chrome://', 'chrome-extension://', 'about:', 'edge://',
    'devtools://', 'chrome-search://', 'view-source:', 'moz-extension://'
  ];
  function isRestricted(url) {
    if (!url) return true;
    return RESTRICTED_PREFIXES.some(p => url.startsWith(p));
  }
  async function getActiveBrowserTab() {
    try {
      // Sidebar shares its window with the browser tabs, so this works.
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab) return tab;
    } catch (e) { /* fall through */ }
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab || null;
    } catch (e) {
      return null;
    }
  }

  // ---------- Live preview ----------
  const PREVIEW_INTERVAL_MS = 2000;       // 0.5 fps ambient
  const PREVIEW_HOVER_INTERVAL_MS = 800;  // ~1.25 fps on hover
  const PREVIEW_MIN_GAP_MS = 600;         // hard floor between any two preview captures
  let previewTimer = null;
  let previewRunning = false;
  let previewBoosted = false;
  let lastPreviewTabId = null;
  let lastPreviewError = null;
  let previewPaused = false;
  let previewInFlight = false;            // mutex — only one captureOnce at a time
  let lastPreviewCaptureAt = 0;           // last completed capture timestamp

  function setPreviewBadge(state, text) {
    if (!els.previewBadge || !els.previewBadgeText) return;
    els.previewBadge.classList.toggle('paused', state !== 'live');
    els.previewBadgeText.textContent = text || (state === 'live' ? 'LIVE' : 'PAUSED');
  }

  function setPreviewEmpty(message) {
    if (!els.previewWrap || !els.previewEmpty) return;
    els.previewWrap.classList.add('is-empty');
    els.previewImg.classList.add('hidden');
    if (message) els.previewEmptyText.textContent = message;
    if (els.previewTabTitle) els.previewTabTitle.style.display = 'none';
  }

  function showPreviewImage(dataUrl, tab) {
    if (!els.previewWrap || !els.previewImg) return;
    els.previewImg.src = dataUrl;
    els.previewImg.classList.remove('hidden');
    els.previewWrap.classList.remove('is-empty');
    if (els.previewTabTitle && tab) {
      const title = (tab.title || '').trim() || tab.url || '';
      if (title) {
        els.previewTabTitle.textContent = title;
        els.previewTabTitle.style.display = 'block';
      } else {
        els.previewTabTitle.style.display = 'none';
      }
    }
  }

  async function captureOnce() {
    if (previewPaused) return;
    if (document.visibilityState === 'hidden') return;
    if (previewInFlight) return;                 // mutex: skip if another capture is already running
    const sinceLast = Date.now() - lastPreviewCaptureAt;
    if (sinceLast < PREVIEW_MIN_GAP_MS) return;  // hard rate-limit floor
    previewInFlight = true;
    let tab;
    try {
      tab = await getActiveBrowserTab();
    } catch (e) {
      previewInFlight = false;
      setPreviewBadge('paused');
      setPreviewEmpty('Preview unavailable');
      return;
    }
    if (!tab) {
      previewInFlight = false;
      setPreviewBadge('paused');
      setPreviewEmpty('No active tab');
      return;
    }
    lastPreviewTabId = tab.id;
    if (isRestricted(tab.url)) {
      previewInFlight = false;
      setPreviewBadge('paused', 'OFF');
      setPreviewEmpty("Preview unavailable on this page");
      return;
    }
    try {
      // JPEG @ low quality keeps payload tiny (~30-80 KB) so 0.5 fps
      // is well under Chrome's MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND.
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 45 });
      if (dataUrl) {
        showPreviewImage(dataUrl, tab);
        setPreviewBadge('live', 'LIVE');
        lastPreviewError = null;
      }
    } catch (e) {
      const msg = (e && e.message) || String(e);
      lastPreviewError = msg;
      // Common: "Cannot access contents of url" or rate limiting.
      if (/MAX_CAPTURE/i.test(msg)) {
        setPreviewBadge('paused', 'BUSY');
      } else if (/Cannot access|chrome:\/\/|extension/i.test(msg)) {
        setPreviewBadge('paused', 'OFF');
        setPreviewEmpty("Preview unavailable on this page");
      } else {
        setPreviewBadge('paused');
        setPreviewEmpty('Preview paused — switch tabs to retry');
      }
    } finally {
      lastPreviewCaptureAt = Date.now();
      previewInFlight = false;
    }
  }

  function startPreviewLoop() {
    if (previewRunning) return;
    previewRunning = true;
    captureOnce();
    schedulePreview();
  }
  function stopPreviewLoop() {
    previewRunning = false;
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
  }
  function schedulePreview() {
    if (!previewRunning) return;
    if (previewTimer) clearTimeout(previewTimer);
    const delay = previewBoosted ? PREVIEW_HOVER_INTERVAL_MS : PREVIEW_INTERVAL_MS;
    previewTimer = setTimeout(async () => {
      await captureOnce();
      schedulePreview();
    }, delay);
  }

  // Boost frame rate while user hovers the preview
  if (els.previewWrap) {
    els.previewWrap.addEventListener('mouseenter', () => {
      previewBoosted = true;
      schedulePreview();
    });
    els.previewWrap.addEventListener('mouseleave', () => {
      previewBoosted = false;
      schedulePreview();
    });
  }

  // Pause when sidebar tab/window is hidden
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && previewRunning) {
      captureOnce();
    }
  });

  // Refresh when active tab changes / page loads
  if (chrome.tabs && chrome.tabs.onActivated) {
    chrome.tabs.onActivated.addListener(() => {
      if (previewRunning) captureOnce();
    });
  }
  if (chrome.tabs && chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.status === 'complete' && previewRunning) {
        // Small delay so the page has actually painted
        setTimeout(captureOnce, 250);
      }
    });
  }

  // ---------- Capture wiring ----------
  function disableCaptureButtons(disabled) {
    [els.snap, els.snip, els.full].forEach(b => { if (b) b.disabled = disabled; });
  }

  async function ensureNotRestricted() {
    const tab = await getActiveBrowserTab();
    if (!tab) {
      toast('No active tab found', 'error');
      return null;
    }
    if (isRestricted(tab.url)) {
      toast("Can't capture this page (Chrome internal page)", 'error');
      return null;
    }
    return tab;
  }

  async function doSnap() {
    const tab = await ensureNotRestricted();
    if (!tab) return;
    disableCaptureButtons(true);
    // Briefly pause the live preview so its captureVisibleTab call
    // doesn't race against the SNAP capture and trip Chrome's rate limit.
    previewPaused = true;
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'capture' }, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(resp || { success: false, error: 'No response' });
          }
        });
      });
      if (response.success) {
        toast('Captured! ✓ ' + (response.count ? `(${response.count} in queue)` : ''), 'success');
      } else {
        toast(response.error || 'Capture failed', 'error');
      }
    } catch (e) {
      toast('Capture failed: ' + (e.message || e), 'error');
    } finally {
      disableCaptureButtons(false);
      // Resume preview after a short cooldown
      setTimeout(() => { previewPaused = false; if (previewRunning) captureOnce(); }, 700);
    }
  }

  async function doSnip() {
    const tab = await ensureNotRestricted();
    if (!tab) return;
    disableCaptureButtons(true);
    previewPaused = true;
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      if (!dataUrl) {
        toast('Capture failed', 'error');
        return;
      }
      const snipId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await chrome.storage.local.set({ ['snipImage_' + snipId]: dataUrl });
      const width = 1200;
      const height = 800;
      const left = Math.round((screen.width - width) / 2);
      const top = Math.round((screen.height - height) / 2);
      chrome.windows.create({
        url: chrome.runtime.getURL(`annotate.html?mode=snip&snipId=${snipId}`),
        type: 'popup',
        width, height, left, top
      });
      toast('Snip editor opened ✂', 'success');
    } catch (e) {
      toast("Can't snip this page", 'error');
      console.log('[SnapToAI sidebar] Snip failed:', e.message);
    } finally {
      disableCaptureButtons(false);
      setTimeout(() => { previewPaused = false; if (previewRunning) captureOnce(); }, 700);
    }
  }

  async function doFullPage() {
    const tab = await ensureNotRestricted();
    if (!tab) return;
    disableCaptureButtons(true);
    previewPaused = true;
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'startFullPageCapture' }, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(resp || { success: false, error: 'No response' });
          }
        });
      });
      if (response.success) {
        toast('Full page capture started — scrolling page…', 'success', 4000);
      } else {
        toast(response.error || 'Full page capture failed', 'error');
      }
    } catch (e) {
      toast('Full page failed: ' + (e.message || e), 'error');
    } finally {
      // Re-enable buttons sooner — the capture itself runs in background
      setTimeout(() => disableCaptureButtons(false), 1200);
      setTimeout(() => { previewPaused = false; if (previewRunning) captureOnce(); }, 1500);
    }
  }

  function doAskAi() {
    // Scroll the chat input into view and focus — full chat is right below.
    if (els.chatInput) {
      els.chatInput.focus();
      try { els.chatInput.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    }
  }

  if (els.snap) els.snap.addEventListener('click', doSnap);
  if (els.snip) els.snip.addEventListener('click', doSnip);
  if (els.full) els.full.addEventListener('click', doFullPage);
  if (els.askAi) els.askAi.addEventListener('click', doAskAi);

  // ---------- AI key status pill ----------
  function setKeyPillState(state, text, actionLabel) {
    if (!els.keyPill || !els.keyText || !els.keyAction) return;
    els.keyPill.classList.remove('ready', 'missing');
    if (state === 'ready') els.keyPill.classList.add('ready');
    if (state === 'missing') els.keyPill.classList.add('missing');
    els.keyText.textContent = text;
    els.keyAction.textContent = actionLabel || 'Manage';
  }

  async function refreshKeyPill() {
    try {
      const res = await chrome.storage.sync.get(['geminiApiKey', 'geminiKey']);
      const key = res.geminiApiKey || res.geminiKey || '';
      if (key && key.length > 10) {
        setKeyPillState('ready', 'AI ready — your Gemini key is active', 'Manage');
      } else {
        setKeyPillState('missing', 'No Gemini key — tap to add (free)', 'Add key');
      }
    } catch (e) {
      setKeyPillState('', 'Key status unknown', 'Manage');
    }
  }
  function openKeyManager() {
    // Reuse the in-chat key modal that ai-chat.js already wires up.
    const modal = document.getElementById('geminiKeyModal');
    if (modal) {
      modal.classList.add('open');
      modal.style.display = 'flex';
      const input = document.getElementById('geminiKeyModalInput');
      if (input) setTimeout(() => input.focus(), 80);
    } else {
      // Fallback: open the options page
      try { chrome.runtime.openOptionsPage(); } catch (e) {}
    }
  }
  if (els.keyAction) els.keyAction.addEventListener('click', openKeyManager);
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && (changes.geminiApiKey || changes.geminiKey)) {
        refreshKeyPill();
      }
      if (area === 'local' && changes.snaptoai_user) {
        refreshAccount();
      }
    });
  }

  // ---------- Account display ----------
  async function refreshAccount() {
    try {
      const res = await chrome.storage.local.get(['snaptoai_user']);
      const user = res.snaptoai_user;
      if (user && user.picture) {
        els.avatar.src = user.picture;
        els.avatar.style.display = 'inline-block';
        els.avatar.title = user.email || 'Signed in';
        els.signIn.style.display = 'none';
      } else {
        els.avatar.style.display = 'none';
        els.signIn.style.display = 'inline-flex';
      }
    } catch (e) {
      // Auth not configured — just hide both
      els.avatar.style.display = 'none';
      els.signIn.style.display = 'none';
    }
  }
  if (els.signIn) {
    els.signIn.addEventListener('click', () => {
      // Open the popup so the user can sign in there (Google OAuth lives in popup)
      try {
        chrome.runtime.sendMessage({ action: 'openPopupForSignIn' });
      } catch (e) {}
      toast('Click the SnapToAI extension icon to sign in', '', 4000);
    });
  }
  if (els.avatar) {
    els.avatar.addEventListener('click', () => {
      toast('Account: signed in', '', 1800);
    });
  }
  if (els.openWindow) {
    els.openWindow.addEventListener('click', async () => {
      try {
        await chrome.windows.create({
          url: chrome.runtime.getURL('ai-chat.html?direct=true'),
          type: 'popup', width: 1000, height: 700, focused: true
        });
      } catch (e) {
        toast('Could not open window', 'error');
      }
    });
  }

  // ---------- Init ----------
  function init() {
    refreshKeyPill();
    refreshAccount();
    startPreviewLoop();

    // Mark uiMode so future popup opens know to suggest sidebar
    try { chrome.storage.local.set({ uiMode: 'sidebar', sidebarLastOpened: Date.now() }); } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for debugging
  window.__snapToAISidebar = {
    captureOnce,
    refreshKeyPill,
    refreshAccount,
    toast,
  };
})();
