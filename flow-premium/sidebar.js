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

  // Preview capture is delegated to the background service worker so
  // snap captures and live-preview captures share one global cooldown
  // (avoids MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND races). We still
  // keep a local mutex + minimum gap so we don't spam the message
  // channel uselessly.
  function bgRequest(action, payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(Object.assign({ action }, payload || {}), (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(resp || { success: false, error: 'No response' });
          }
        });
      } catch (e) {
        resolve({ success: false, error: (e && e.message) || String(e) });
      }
    });
  }

  async function captureOnce() {
    if (previewPaused) return;
    if (document.visibilityState === 'hidden') return;
    if (previewInFlight) return;                 // local mutex
    const sinceLast = Date.now() - lastPreviewCaptureAt;
    if (sinceLast < PREVIEW_MIN_GAP_MS) return;  // local rate-limit floor
    previewInFlight = true;
    try {
      const resp = await bgRequest('sidebarPreviewCapture');
      if (resp.success && resp.dataUrl) {
        showPreviewImage(resp.dataUrl, { title: resp.tabTitle, url: resp.tabUrl });
        setPreviewBadge('live', 'LIVE');
        lastPreviewError = null;
        if (resp.tabId) lastPreviewTabId = resp.tabId;
      } else if (resp.skip) {
        // Cooldown / in-flight from background — quietly try again next tick
      } else if (resp.error === 'restricted') {
        setPreviewBadge('paused', 'OFF');
        setPreviewEmpty("Preview unavailable on this page");
      } else if (resp.error === 'no_tab') {
        setPreviewBadge('paused');
        setPreviewEmpty('No active tab');
      } else {
        const msg = String(resp.error || '');
        lastPreviewError = msg;
        if (/MAX_CAPTURE/i.test(msg)) {
          setPreviewBadge('paused', 'BUSY');
        } else if (/Cannot access|chrome:\/\/|extension/i.test(msg)) {
          setPreviewBadge('paused', 'OFF');
          setPreviewEmpty("Preview unavailable on this page");
        } else {
          setPreviewBadge('paused');
          setPreviewEmpty('Preview paused — switch tabs to retry');
        }
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
      // Task #27 — When the institution provides the key (and especially when
      // policy=institution-only), the pill must reflect that BYOK is moot.
      let instInfo = null;
      try {
        const { snaptoai_branding, cachedSubStatus } = await chrome.storage.local.get(['snaptoai_branding', 'cachedSubStatus']);
        const isInst = cachedSubStatus && cachedSubStatus.planType === 'institution';
        if (isInst && snaptoai_branding) instInfo = snaptoai_branding;
      } catch (e) {}
      if (instInfo && instInfo.keyPolicy === 'institution-only') {
        const name = instInfo.name || 'your organization';
        if (instInfo.hasInstitutionKey) {
          setKeyPillState('ready', `AI key provided by ${name}`, 'Managed');
        } else {
          setKeyPillState('missing', `${name} hasn't set their AI key yet — contact your admin`, 'Contact admin');
        }
        return;
      }
      const res = await chrome.storage.sync.get(['geminiApiKey', 'geminiKey']);
      const key = res.geminiApiKey || res.geminiKey || '';
      if (instInfo && instInfo.hasInstitutionKey && instInfo.keyPolicy === 'prefer-institution-key') {
        setKeyPillState('ready', `AI key provided by ${instInfo.name || 'your organization'}`, 'Manage');
      } else if (key && key.length > 10) {
        setKeyPillState('ready', 'AI ready — your Gemini key is active', 'Manage');
      } else if (instInfo && instInfo.hasInstitutionKey) {
        setKeyPillState('ready', `AI ready — ${instInfo.name || 'your organization'} provides a fallback key`, 'Add personal');
      } else {
        setKeyPillState('missing', 'No Gemini key — tap to add (free)', 'Add key');
      }
    } catch (e) {
      setKeyPillState('', 'Key status unknown', 'Manage');
    }
  }
  async function openKeyManager() {
    // Task #27 — institution-only members can't add a personal key; surface a
    // toast instead of opening the BYOK modal they would never be able to use.
    try {
      const { snaptoai_branding, cachedSubStatus } = await chrome.storage.local.get(['snaptoai_branding', 'cachedSubStatus']);
      const isInst = cachedSubStatus && cachedSubStatus.planType === 'institution';
      if (isInst && snaptoai_branding && snaptoai_branding.keyPolicy === 'institution-only') {
        if (typeof toast === 'function') {
          toast(`${snaptoai_branding.name || 'Your organization'} provides the AI key — no personal key needed.`, 'info');
        }
        return;
      }
    } catch (e) {}
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
      // Task #27 — re-render the key pill when institution branding/policy
      // changes (server pushed a new policy or rotated the institution key).
      if (area === 'local' && (changes.snaptoai_branding || changes.cachedSubStatus)) {
        refreshKeyPill();
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
    els.signIn.addEventListener('click', async () => {
      els.signIn.disabled = true;
      const original = els.signIn.textContent;
      els.signIn.textContent = 'Signing in…';
      try {
        const resp = await bgRequest('signInWithGoogle');
        if (resp.success) {
          toast('Signed in as ' + (resp.user && resp.user.email || 'your Google account'), 'success');
          refreshAccount();
        } else {
          const err = resp.error || 'Sign-in failed';
          if (/cancel/i.test(err)) {
            toast('Sign-in cancelled', '', 2200);
          } else {
            toast('Sign-in failed: ' + err, 'error', 4000);
          }
        }
      } finally {
        els.signIn.disabled = false;
        els.signIn.textContent = original;
      }
    });
  }
  if (els.avatar) {
    els.avatar.addEventListener('click', async () => {
      // Click avatar -> simple sign-out confirm
      if (confirm('Sign out of SnapToAI?')) {
        const resp = await bgRequest('signOutGoogle');
        if (resp.success) {
          toast('Signed out', 'success');
          refreshAccount();
        } else {
          toast('Sign-out failed: ' + (resp.error || 'unknown'), 'error');
        }
      }
    });
  }
  if (els.openWindow) {
    // Repurposed as "Switch to popup mode" — long-press / click toggles
    // the persisted UI preference so the icon click goes back to the
    // popup on next use (and across browser restarts).
    els.openWindow.title = 'Switch back to popup mode';
    els.openWindow.textContent = '↺';
    els.openWindow.addEventListener('click', async () => {
      const resp = await bgRequest('setUiModePreference', { mode: 'popup' });
      if (resp.success) {
        toast('Switched back to popup mode — click the extension icon next time', 'success', 4200);
      } else {
        toast('Could not switch: ' + (resp.error || 'unknown'), 'error');
      }
    });
  }

  // ---------- v2.7.0: institution white-label branding ----------
  async function applyInstitutionBranding() {
    try {
      const { snaptoai_branding, cachedSubStatus } = await chrome.storage.local.get(['snaptoai_branding', 'cachedSubStatus']);
      const isInst = cachedSubStatus && cachedSubStatus.planType === 'institution';
      const b = (isInst && snaptoai_branding) ? snaptoai_branding : null;
      const img = document.getElementById('sbBrandLogo');
      const text = document.querySelector('#sbLogo .sb-logo-text');
      if (b && (b.logoUrl || b.logoUrlLight)) {
        const themeResolved = (window.SnapToAITheme && window.SnapToAITheme.getResolved)
          ? window.SnapToAITheme.getResolved() : 'dark';
        const pick = (themeResolved === 'light' && b.logoUrlLight) ? b.logoUrlLight : (b.logoUrl || b.logoUrlLight);
        const hasBoth = !!(b.logoUrl && b.logoUrlLight);
        const url = pick.startsWith('http') ? pick : 'https://www.snaptoai.com' + pick;
        if (img) {
          img.src = url; img.alt = b.name || ''; img.style.display = 'inline-block';
          img.classList.toggle('themed-logo', hasBoth);
        }
        if (text) text.style.display = 'none';
      } else if (b && b.name) {
        if (text) { text.innerHTML = '<span class="sb-logo-emoji">📸</span> <span>' + (b.name.replace(/[<>&]/g,'')) + '</span>'; text.style.display = ''; }
        if (img) img.style.display = 'none';
      } else {
        if (img) img.style.display = 'none';
        if (text) { text.style.display = ''; text.innerHTML = '<span class="sb-logo-emoji">📸</span> <span>Snap <span class="sb-logo-accent">To AI</span></span>'; }
      }
      if (window.SnapToAIBranding) {
        if (b && b.brandColor) window.SnapToAIBranding.apply(b.brandColor);
        else window.SnapToAIBranding.clear();
      } else if (b && b.brandColor) {
        document.documentElement.style.setProperty('--st-accent', b.brandColor);
        document.documentElement.style.setProperty('--accent', b.brandColor);
      }
    } catch (e) {
      console.log('[SnapToAI] sidebar branding error:', e);
    }
  }
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes.snaptoai_branding || changes.cachedSubStatus)) {
        applyInstitutionBranding();
      }
    });
  } catch (e) {}
  // Re-adapt institution accent when the user flips Light/Dark/Auto so it
  // stays readable against the new background without reopening the panel.
  try {
    if (window.SnapToAITheme && window.SnapToAITheme.onChange) {
      window.SnapToAITheme.onChange(() => { applyInstitutionBranding(); });
    }
  } catch (e) {}

  // ---------- Queue Strip (recent snaps) ----------
  const queueEls = {
    root: $('sbQueue'),
    scroll: $('sbQueueScroll'),
    count: $('sbQueueCount'),
    clear: $('sbQueueClear'),
    modeBtn: $('sbQueueModeBtn'),
    selBar: $('sbSelectionBar'),
    selAll: $('sbSelAllBtn'),
    selAi: $('sbSelAiBtn'),
    selCopy: $('sbSelCopyBtn'),
  };
  let queueSnaps = [];               // dataUrls, mirrored from chrome.storage.local.snaps
  const attachedSnapKeys = new Set(); // stable keys (snapKey()) of snaps currently attached to chat
  const selectedKeys = new Set();    // keys selected in grid mode
  let gridMode = false;
  const GRID_MODE_KEY = 'sidebar_queue_grid_mode_v1';
  const MAX_SNAPS = 10;

  // Stable per-snap key — survives reordering / FIFO trims in other surfaces.
  // We hash a short window of the dataUrl tail (which is the unique base64
  // payload) plus the length, so identical pixels produce identical keys
  // without us scanning megabytes of base64.
  function snapKey(dataUrl) {
    if (!dataUrl) return '';
    const len = dataUrl.length;
    const tail = dataUrl.slice(Math.max(0, len - 96));
    return len + ':' + tail;
  }

  function reconcileAttachedKeys() {
    const live = new Set(queueSnaps.map(snapKey));
    for (const k of Array.from(attachedSnapKeys)) {
      if (!live.has(k)) attachedSnapKeys.delete(k);
    }
    // Same liveness rule for grid-mode selection — drop selections whose
    // underlying snap was deleted/trimmed elsewhere.
    for (const k of Array.from(selectedKeys)) {
      if (!live.has(k)) selectedKeys.delete(k);
    }
  }

  async function loadQueueSnaps() {
    try {
      const { snaps } = await chrome.storage.local.get({ snaps: [] });
      queueSnaps = Array.isArray(snaps) ? snaps : [];
      reconcileAttachedKeys();
      renderQueue();
    } catch (e) {
      console.log('[SnapToAI sidebar] loadQueueSnaps failed:', e && e.message);
    }
  }

  function renderQueue(force) {
    if (!queueEls.root || !queueEls.scroll || !queueEls.count) return;
    const n = queueSnaps.length;
    queueEls.count.textContent = `${n} / ${MAX_SNAPS}`;
    queueEls.root.classList.toggle('has-snaps', n > 0);
    const tileTitle = (i) => gridMode
      ? `Click to ${selectedKeys.has(snapKey(queueSnaps[i])) ? 'deselect' : 'select'} snap #${i + 1}`
      : `Tap to attach snap #${i + 1} to chat`;
    // Diff-render only when count is unchanged so we don't replay the
    // scale-in animation on every keystroke. Attach state is keyed by
    // dataUrl, so it stays correct even after reorder/trim elsewhere.
    const existing = queueEls.scroll.children;
    if (!force && existing.length === n) {
      for (let i = 0; i < n; i++) {
        const tile = existing[i];
        const key = snapKey(queueSnaps[i]);
        tile.classList.toggle('attached', attachedSnapKeys.has(key));
        tile.classList.toggle('sb-selected', selectedKeys.has(key));
        tile.dataset.key = key;
        const img = tile.querySelector('img');
        if (img && img.src !== queueSnaps[i]) img.src = queueSnaps[i];
        const num = tile.querySelector('.sb-queue-num');
        if (num) num.textContent = String(i + 1);
        tile.title = tileTitle(i);
      }
      updateSelectionBar();
      return;
    }
    queueEls.scroll.innerHTML = '';
    queueSnaps.forEach((dataUrl, idx) => {
      const key = snapKey(dataUrl);
      const tile = document.createElement('div');
      tile.className = 'sb-queue-thumb'
        + (attachedSnapKeys.has(key) ? ' attached' : '')
        + (selectedKeys.has(key) ? ' sb-selected' : '');
      tile.title = tileTitle(idx);
      tile.dataset.key = key;
      // Make every tile reachable via the keyboard so grid mode is
      // usable without a pointer. Strip mode = "attach", grid mode =
      // "toggle selection" — both fire on Enter / Space.
      tile.tabIndex = 0;
      tile.setAttribute('role', 'button');
      tile.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        if (gridMode) toggleSelectKey(tile.dataset.key);
        else attachSnapByKey(tile.dataset.key);
      });
      tile.innerHTML =
        '<span class="sb-queue-num">' + (idx + 1) + '</span>' +
        '<button class="sb-queue-x" aria-label="Remove snap" title="Remove">×</button>' +
        '<img alt="Snap ' + (idx + 1) + '" />' +
        '<span class="sb-queue-attached-tick" title="Attached to chat">✓</span>' +
        '<span class="sb-queue-check" aria-label="Toggle selection"></span>';
      const img = tile.querySelector('img');
      img.src = dataUrl;
      // Resolve the key from the tile's dataset at click time — the diff
      // path reuses tiles and rewrites dataset.key when the queue is
      // reordered, so closing over the creation-time key would mis-target
      // attach/remove after a reorder.
      tile.addEventListener('click', (ev) => {
        const t = ev.target;
        if (t && t.classList && t.classList.contains('sb-queue-x')) return;
        // The checkbox is CSS-hidden in strip mode; only honour its
        // selection toggle when grid mode is active so a stray bubbled
        // click in strip mode doesn't silently mutate selection state
        // that the user can't see.
        if (gridMode) {
          toggleSelectKey(tile.dataset.key);
        } else {
          attachSnapByKey(tile.dataset.key);
        }
      });
      tile.querySelector('.sb-queue-x').addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeSnapByKey(tile.dataset.key);
      });
      queueEls.scroll.appendChild(tile);
    });
    updateSelectionBar();
  }

  // ---------- Multi-select (grid mode) ----------
  function toggleSelectKey(key) {
    if (!key) return;
    if (selectedKeys.has(key)) selectedKeys.delete(key);
    else selectedKeys.add(key);
    // Lightweight class toggle — no need to re-render whole list.
    const tile = queueEls.scroll && queueEls.scroll.querySelector(`.sb-queue-thumb[data-key="${CSS.escape(key)}"]`);
    if (tile) tile.classList.toggle('sb-selected', selectedKeys.has(key));
    updateSelectionBar();
  }

  function updateSelectionBar() {
    if (!queueEls.selBar) return;
    const count = selectedKeys.size;
    if (queueEls.selAi) {
      queueEls.selAi.disabled = count === 0;
      queueEls.selAi.textContent = count > 0 ? `✦ Send ${count} to AI` : '✦ Send to AI';
    }
    if (queueEls.selCopy) {
      queueEls.selCopy.disabled = count === 0;
      queueEls.selCopy.textContent = count > 0 ? `Copy ${count}` : 'Copy';
    }
    if (queueEls.selAll) {
      const total = queueSnaps.length;
      queueEls.selAll.textContent = (total > 0 && count === total) ? 'Deselect All' : 'Select All';
      queueEls.selAll.disabled = total === 0;
    }
  }

  function applyGridMode() {
    if (!queueEls.root) return;
    queueEls.root.classList.toggle('grid-mode', gridMode);
    if (queueEls.modeBtn) {
      queueEls.modeBtn.textContent = gridMode ? 'Strip' : 'Select';
      queueEls.modeBtn.title = gridMode
        ? 'Switch back to compact strip'
        : 'Switch to multi-select grid';
    }
    if (!gridMode) selectedKeys.clear();
    renderQueue(true);
  }

  function toggleGridMode() {
    gridMode = !gridMode;
    try { chrome.storage.local.set({ [GRID_MODE_KEY]: gridMode }); } catch (e) {}
    applyGridMode();
  }

  async function loadGridMode() {
    try {
      const got = await chrome.storage.local.get(GRID_MODE_KEY);
      gridMode = !!got[GRID_MODE_KEY];
    } catch (e) {}
    applyGridMode();
  }

  function selectAllToggle() {
    const total = queueSnaps.length;
    if (total === 0) return;
    if (selectedKeys.size === total) {
      selectedKeys.clear();
    } else {
      selectedKeys.clear();
      queueSnaps.forEach(d => selectedKeys.add(snapKey(d)));
    }
    if (queueEls.scroll) {
      Array.from(queueEls.scroll.children).forEach(t => {
        t.classList.toggle('sb-selected', selectedKeys.has(t.dataset.key));
      });
    }
    updateSelectionBar();
  }

  async function sendSelectedToAi() {
    if (selectedKeys.size === 0) return;
    // Preserve queue order and skip already-attached snaps. Reuses the
    // existing attachSnapByKey path so the chat-side preview cards and
    // attachedSnapKeys state stay in lockstep.
    const ordered = queueSnaps.filter(d => selectedKeys.has(snapKey(d)));
    let attached = 0;
    for (const d of ordered) {
      const k = snapKey(d);
      if (attachedSnapKeys.has(k)) continue;
      attachSnapByKey(k);
      attached++;
    }
    if (attached === 0) {
      toast('All selected snaps are already attached', '', 1800);
    }
    // Keep grid mode on — user may want to copy too.
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image load failed'));
      img.src = dataUrl;
    });
  }

  async function buildCompositePngBlob(dataUrls) {
    const imgs = await Promise.all(dataUrls.map(loadImage));
    if (imgs.length === 1) {
      const c = document.createElement('canvas');
      c.width = imgs[0].naturalWidth;
      c.height = imgs[0].naturalHeight;
      c.getContext('2d').drawImage(imgs[0], 0, 0);
      return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'));
    }
    const maxW = Math.max(...imgs.map(i => i.naturalWidth));
    const heights = imgs.map(i => Math.round(i.naturalHeight * (maxW / i.naturalWidth)));
    const totalH = heights.reduce((a, b) => a + b, 0);
    const canvas = document.createElement('canvas');
    canvas.width = maxW;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, maxW, totalH);
    let y = 0;
    for (let i = 0; i < imgs.length; i++) {
      ctx.drawImage(imgs[i], 0, y, maxW, heights[i]);
      y += heights[i];
    }
    return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'));
  }

  async function copySelectedToClipboard() {
    if (selectedKeys.size === 0) return;
    const ordered = queueSnaps.filter(d => selectedKeys.has(snapKey(d)));
    if (!ordered.length) return;
    try {
      const blob = await buildCompositePngBlob(ordered);
      // ClipboardItem requires the same MIME we asked toBlob for.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast(`Copied ${ordered.length} snap${ordered.length > 1 ? 's' : ''} to clipboard ✓`, 'success', 1800);
    } catch (e) {
      console.log('[SnapToAI sidebar] copySelectedToClipboard failed:', e && e.message);
      toast('Copy failed: ' + (e && e.message ? e.message : e), 'error');
    }
  }

  if (queueEls.modeBtn) queueEls.modeBtn.addEventListener('click', toggleGridMode);
  if (queueEls.selAll) queueEls.selAll.addEventListener('click', selectAllToggle);
  if (queueEls.selAi) queueEls.selAi.addEventListener('click', sendSelectedToAi);
  if (queueEls.selCopy) queueEls.selCopy.addEventListener('click', copySelectedToClipboard);

  // ---------- Hero / chat splitter ----------
  const SPLIT_KEY = 'sidebar_split_v1';
  const HERO_MIN = 220;
  const CHAT_MIN = 280;
  // Fixed pixels eaten by the resizer + a small safety buffer for the
  // chat region's own internal padding/footer rows. Without this the
  // chat could dip below CHAT_MIN of *content* on short windows.
  const CHAT_OVERHEAD = 8 /* resizer */ + 12 /* breathing room */;

  function clampHero(h) {
    const total = window.innerHeight || 800;
    const max = Math.max(HERO_MIN, total - CHAT_MIN - CHAT_OVERHEAD);
    return Math.max(HERO_MIN, Math.min(h, max));
  }
  function setHeroHeight(h) {
    const clamped = clampHero(h);
    document.documentElement.style.setProperty('--sb-hero-h', clamped + 'px');
    const resizer = $('sbResizer');
    if (resizer) {
      const total = window.innerHeight || 800;
      resizer.setAttribute('aria-valuemin', String(HERO_MIN));
      resizer.setAttribute('aria-valuemax', String(Math.max(HERO_MIN, total - CHAT_MIN)));
      resizer.setAttribute('aria-valuenow', String(Math.round(clamped)));
    }
  }
  function getHeroHeight() {
    const hero = document.querySelector('.sb-hero');
    return hero ? hero.getBoundingClientRect().height : HERO_MIN;
  }
  async function loadHeroHeight() {
    try {
      const got = await chrome.storage.local.get(SPLIT_KEY);
      const h = got[SPLIT_KEY];
      if (typeof h === 'number' && isFinite(h) && h > 0) setHeroHeight(h);
    } catch (e) {}
  }
  function persistHeroHeight(h) {
    try { chrome.storage.local.set({ [SPLIT_KEY]: clampHero(h) }); } catch (e) {}
  }

  function initResizer() {
    const resizer = $('sbResizer');
    if (!resizer) return;
    let dragging = false;
    let startY = 0;
    let startH = 0;
    const onMove = (e) => {
      if (!dragging) return;
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      setHeroHeight(startH + (y - startY));
      if (e.cancelable) e.preventDefault();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      resizer.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      persistHeroHeight(getHeroHeight());
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('touchcancel', onUp);
    };
    const onDown = (e) => {
      dragging = true;
      resizer.classList.add('dragging');
      startY = e.touches ? e.touches[0].clientY : e.clientY;
      startH = getHeroHeight();
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp);
      window.addEventListener('touchcancel', onUp);
      if (e.cancelable) e.preventDefault();
    };
    resizer.addEventListener('mousedown', onDown);
    resizer.addEventListener('touchstart', onDown, { passive: false });
    resizer.addEventListener('keydown', (e) => {
      const STEP = e.shiftKey ? 64 : 24;
      let next;
      if (e.key === 'ArrowUp') next = getHeroHeight() - STEP;
      else if (e.key === 'ArrowDown') next = getHeroHeight() + STEP;
      else if (e.key === 'Home') next = HERO_MIN;
      else if (e.key === 'End') next = (window.innerHeight || 800) - CHAT_MIN;
      else return;
      e.preventDefault();
      setHeroHeight(next);
      persistHeroHeight(next);
    });
    // Re-clamp when the window/side-panel resizes so the chat region keeps
    // its minimum room even if the user shrinks the panel vertically.
    window.addEventListener('resize', () => setHeroHeight(getHeroHeight()));
  }

  function dataUrlToParts(dataUrl) {
    // "data:image/png;base64,XXXX" → { mimeType, data }
    const m = /^data:([^;,]+)(?:;base64)?,(.*)$/.exec(dataUrl || '');
    if (!m) return null;
    return { mimeType: m[1] || 'image/png', data: m[2] || '' };
  }

  function findSnapByKey(key) {
    for (let i = 0; i < queueSnaps.length; i++) {
      if (snapKey(queueSnaps[i]) === key) return { idx: i, dataUrl: queueSnaps[i] };
    }
    return null;
  }

  function attachSnapByKey(key) {
    const found = findSnapByKey(key);
    if (!found) {
      toast('That snap is no longer in the queue', 'error');
      renderQueue();
      return;
    }
    if (attachedSnapKeys.has(key)) {
      toast('Already attached to chat', '', 1500);
      return;
    }
    const { idx, dataUrl } = found;
    const parts = dataUrlToParts(dataUrl);
    if (!parts) {
      toast('Could not attach this snap', 'error');
      return;
    }
    // ai-chat.js owns `filesQueue` (a top-level `let`) and #filePreviewZone.
    // sidebar.html loads ai-chat.js BEFORE sidebar.js, so the identifier is
    // in the shared script-level lexical scope reachable from this IIFE.
    const fileData = {
      mimeType: parts.mimeType,
      data: parts.data,
      name: `Snap #${idx + 1}`,
    };
    try {
      let pushed = false;
      try {
        // eslint-disable-next-line no-undef
        if (typeof filesQueue !== 'undefined' && Array.isArray(filesQueue)) {
          // eslint-disable-next-line no-undef
          filesQueue.push(fileData);
          pushed = true;
        }
      } catch (e) { /* ReferenceError if scope changes — fall through */ }
      if (!pushed) {
        toast('Chat not ready yet — try again', 'error');
        return;
      }
      const zone = document.getElementById('filePreviewZone');
      if (zone) {
        const card = document.createElement('div');
        card.className = 'file-card';
        // Name is fixed text we control ("Snap #N") — safe.
        card.innerHTML = '🖼️ <span>' + fileData.name + '</span> <div class="remove-btn">×</div>';
        card.querySelector('.remove-btn').onclick = () => {
          try {
            // eslint-disable-next-line no-undef
            if (typeof filesQueue !== 'undefined' && Array.isArray(filesQueue)) {
              // eslint-disable-next-line no-undef
              const i = filesQueue.indexOf(fileData);
              // eslint-disable-next-line no-undef
              if (i > -1) filesQueue.splice(i, 1);
            }
          } catch (e) {}
          card.remove();
          attachedSnapKeys.delete(key);
          renderQueue();
        };
        zone.appendChild(card);
      }
      attachedSnapKeys.add(key);
      renderQueue();
      toast(`Snap #${idx + 1} attached to chat ✓`, 'success', 1800);
      // Bring the chat into focus so the user sees what just happened.
      const input = document.getElementById('chatInput');
      if (input) {
        try { input.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
        try { input.focus({ preventScroll: true }); } catch (e) { try { input.focus(); } catch (e2) {} }
      }
    } catch (e) {
      console.log('[SnapToAI sidebar] attachSnapByKey failed:', e && e.message);
      toast('Could not attach this snap', 'error');
    }
  }

  async function removeSnapByKey(key) {
    try {
      const { snaps = [], snapMetadata = [] } = await chrome.storage.local.get(['snaps', 'snapMetadata']);
      const idx = snaps.findIndex(d => snapKey(d) === key);
      if (idx < 0) return;
      snaps.splice(idx, 1);
      if (Array.isArray(snapMetadata) && idx < snapMetadata.length) {
        snapMetadata.splice(idx, 1);
      }
      await chrome.storage.local.set({ snaps, snapMetadata });
      attachedSnapKeys.delete(key);
      // chrome.storage.onChanged will also trigger; render now for snappiness.
      queueSnaps = snaps;
      reconcileAttachedKeys();
      renderQueue();
      try { chrome.action.setBadgeText({ text: snaps.length ? String(snaps.length) : '' }); } catch (e) {}
    } catch (e) {
      console.log('[SnapToAI sidebar] removeSnapByKey failed:', e && e.message);
    }
  }

  async function clearAllSnaps() {
    try {
      await chrome.storage.local.set({ snaps: [], snapMetadata: [] });
      attachedSnapKeys.clear();
      queueSnaps = [];
      renderQueue();
      try { chrome.action.setBadgeText({ text: '' }); } catch (e) {}
      toast('Queue cleared', 'success', 1500);
    } catch (e) {
      console.log('[SnapToAI sidebar] clearAllSnaps failed:', e && e.message);
    }
  }

  if (queueEls.clear) queueEls.clear.addEventListener('click', clearAllSnaps);

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.snaps) {
        queueSnaps = Array.isArray(changes.snaps.newValue) ? changes.snaps.newValue : [];
        reconcileAttachedKeys();
        renderQueue();
      }
    });
  }

  // ---------- Init ----------
  function init() {
    refreshKeyPill();
    refreshAccount();
    startPreviewLoop();
    applyInstitutionBranding();
    loadHeroHeight();
    initResizer();
    loadGridMode();
    loadQueueSnaps();

    // Persist that the user is now using sidebar mode AND ask the
    // background to wire up the action click so future icon clicks
    // open the side panel directly (across browser restarts).
    bgRequest('setUiModePreference', { mode: 'sidebar' });
    try { chrome.storage.local.set({ sidebarLastOpened: Date.now() }); } catch (e) {}
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
