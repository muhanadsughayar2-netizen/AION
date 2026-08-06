// SnapToAI Background Service Worker
// Handles screenshot capture, storage management, downloads, and messaging

// Load the shared Autopilot decision-logic (hasSearchTarget, detectBlockPage,
// etc.) into this service worker's OWN global scope. clearAndInject() below
// separately injects agent-logic-core.js into TARGET TABS for content.js to
// use — that is a completely different JS environment from this file, which
// runs as its own service worker and needs the same functions loaded here
// too if this file wants to call them directly (not through a tab).
importScripts('agent-logic-core.js');

// ── Autopilot risk guard ────────────────────────────────────────────────────
// A code-level (not just prompt-level) checkpoint for irreversible actions.
// The system prompt already tells Gemini to stop before payments/deletions/
// sends, but that's advisory — it relies on the model correctly reasoning
// about every click it makes. This guard inspects the ACTUAL text of the
// element an action is about to fire on, independent of what the model
// believes it's doing, and blocks execution until a human explicitly
// confirms. Only click/doubleClick are covered — these are the actions that
// actually trigger irreversible page effects; typing/reading/navigating are
// left alone to avoid false-positive friction on ordinary tasks.
const RISKY_ACTIONS = new Set(['click', 'doubleClick']);

// Intentionally conservative — matches whole visible label text after
// trimming, so "Send" in a chat app or "Delete" in a text editor won't
// constantly interrupt normal tasks. This is a backstop for the clear,
// high-confidence cases: real payment/checkout/deletion buttons.
const RISKY_PATTERNS = [
  /\bpay(\s+now)?\b/i,
  /\bplace\s+order\b/i,
  /\bconfirm\s+(purchase|order|payment)\b/i,
  /\bcomplete\s+(purchase|order|checkout)\b/i,
  /\bsubmit\s+payment\b/i,
  /\bbuy\s+now\b/i,
  /\bcheckout\b/i,
  /\bwire\s+transfer\b/i,
  /\btransfer\s+funds\b/i,
  /\bdelete\s+(account|permanently|forever)\b/i,
  /\bpermanently\s+delete\b/i,
  /\bdeactivate\s+account\b/i,
  /\bclose\s+account\b/i,
  /\bcancel\s+subscription\b/i,
  /\byes,?\s*delete\b/i,
  /\bconfirm\s+delete\b/i,
  /\bsubmit\s+application\b/i,
  /\bsign\s+(and\s+)?submit\b/i,
];

function assessActionRisk(executeAction, params) {
  const label = String(params?.text || params?.description || params?.selector || '').trim();
  if (!label) return null; // coordinate-only clicks — no readable label to judge
  for (const re of RISKY_PATTERNS) {
    if (re.test(label)) {
      return `The target of this ${executeAction} ("${label}") looks like a payment, deletion, or other irreversible action.`;
    }
  }
  return null;
}

// ── Human-mimetic click jitter ─────────────────────────────────────────────
// Adds a tiny random sub-pixel offset (±2 px) to every CDP mouse event so
// clicks look like a human pointer rather than a perfect centroid hit.
// Sites that bot-detect on exact-integer coordinates (e.g. Grok, LinkedIn)
// are much less likely to flag the session.
const jitter = v => Math.round(v + (Math.random() * 4 - 2));

// ── Pattern 2 helper: resolve a CSS selector to viewport centre via CDP ────
// Tries DOM.querySelector → DOM.getBoxModel so background.js can find any
// element by its exact selector without going through content.js messaging.
// Used by the S2 selector-cascade expansion in the click pipeline.
async function getBoxModelBySelector(selector, cdpCmd) {
  try {
    const { root } = await cdpCmd('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdpCmd('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) return null;
    await cdpCmd('DOM.scrollIntoViewIfNeeded', { nodeId }).catch(() => {});
    const box = await cdpCmd('DOM.getBoxModel', { nodeId });
    if (!box?.model?.content) return null;
    const [x1, y1, x2,,,y3] = box.model.content;
    return { x: (x1 + x2) / 2, y: (y1 + y3) / 2 };
  } catch (_) { return null; }
}

// ── Persistent CDP Session Pool (Self-Healing & MV3 Compliant) ────────────
// Eliminates per-action attach/detach flashing and race conditions.
// • Reuses the connection for the same tab (ref-counted).
// • Serialises commands on a per-tab mutex so rapid/parallel actions never race.
// • Schedules idle detach 15 s after the last release to avoid constant re-attaching.
// • Self-heals when the user clicks "Cancel" on the Chrome debugger infobar.
class CdpSessionPool {
  constructor() {
    this.sessions = new Map(); // tabId -> { refCount, timeout, attached }
    this.mutexes  = new Map(); // tabId -> Promise chain (mutex)

    // Self-healing: when the user cancels the debugger infobar, Chrome fires
    // onDetach. Remove the stale session entry so the next acquire() re-attaches
    // cleanly instead of thinking it's still connected.
    chrome.debugger.onDetach.addListener((source) => {
      const { tabId } = source;
      if (tabId && this.sessions.has(tabId)) {
        console.warn(`[Aion CDP] Debugger manually detached from tab ${tabId} — clearing pool entry`);
        const s = this.sessions.get(tabId);
        if (s?.timeout) clearTimeout(s.timeout);
        this.sessions.delete(tabId);
      }
    });
  }

  async acquire(tabId) {
    // Serialised mutex per tab
    let releaseLock;
    const prev = this.mutexes.get(tabId) || Promise.resolve();
    const next  = new Promise(r => { releaseLock = r; });
    this.mutexes.set(tabId, prev.then(() => next));
    await prev;

    try {
      let s = this.sessions.get(tabId);
      if (!s) { s = { refCount: 0, timeout: null, attached: false }; this.sessions.set(tabId, s); }
      if (s.timeout) { clearTimeout(s.timeout); s.timeout = null; }
      if (!s.attached) {
        try {
          await chrome.debugger.attach({ tabId }, '1.3');
          // Session grouping — captures spawned sub-windows (login popups, build
          // previews, OAuth flows) so the agent stays connected to child targets.
          await chrome.debugger.sendCommand({ tabId }, 'Target.setAutoAttach',
            { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }
          ).catch(() => {}); // non-fatal: some tabs don't support Target domain
        } catch (e) {
          const msg = (e && e.message) || String(e);
          if (!/already attached|Another debugger/i.test(msg)) { releaseLock(); throw e; }
          // already attached by another path — reuse
        }
        s.attached = true;
        // Fix 5a — Stealth: hide navigator.webdriver before any page JS runs.
        // Advanced bot-detection (Cloudflare, Akamai) checks this flag when the
        // CDP debugger is attached; overriding it keeps the session undetected.
        chrome.debugger.sendCommand({ tabId }, 'Page.addScriptToEvaluateOnNewDocument', {
          source: `Object.defineProperty(navigator, 'webdriver', { get: () => undefined });`
        }).catch(() => {}); // non-fatal — some restricted pages disallow this
        // Fix 3: enable Network domain so _netReqs tracking receives events
        chrome.debugger.sendCommand({ tabId }, 'Network.enable', {}).catch(() => {});
      }
      s.refCount++;

      const send = (method, params) => new Promise((resolve, reject) => {
        chrome.debugger.sendCommand({ tabId }, method, params || {}, result => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(result);
        });
      });

      const release = () => {
        s.refCount = Math.max(0, s.refCount - 1);
        if (s.refCount === 0) {
          s.timeout = setTimeout(async () => {
            if (s.refCount === 0 && s.attached) {
              try { await chrome.debugger.detach({ tabId }); } catch (_) {}
              s.attached = false;
              this.sessions.delete(tabId);
            }
          }, 15000); // 15 s — fast enough to release, long enough to survive rapid follow-ups
        }
        releaseLock();
      };

      return { send, release };
    } catch (err) {
      releaseLock();
      throw err;
    }
  }
}

const cdpPool = new CdpSessionPool();

// ── Sub-session tracker ────────────────────────────────────────────────────
// When Target.setAutoAttach fires and a child window/popup attaches, Chrome
// emits Target.attachedToTarget with a fresh sessionId. We track those here
// so any future CDP command can route to the correct child target.
const subSessions = new Map(); // sessionId → { targetId, url, attachedAt }

// ── Fix 3: Network idle tracking ──────────────────────────────────────────
// CDP Network events tell us exactly how many requests are in-flight for a tab.
// waitForNetworkIdle() polls this counter so the agent only screenshots/reads
// the page after SPAs have finished their async data fetches.
const _netReqs = new Map(); // tabId → in-flight request count

async function waitForNetworkIdle(tabId, timeout = 4000) {
  const deadline = Date.now() + timeout;
  const IDLE_WINDOW = 500; // ms with zero requests to declare idle
  let idleSince = null;
  while (Date.now() < deadline) {
    const count = _netReqs.get(tabId) || 0;
    if (count === 0) {
      if (!idleSince) idleSince = Date.now();
      if (Date.now() - idleSince >= IDLE_WINDOW) return; // sustained idle
    } else {
      idleSince = null; // requests still flying
    }
    await new Promise(r => setTimeout(r, 100));
  }
  // Timeout — return anyway so we don't block forever
}

chrome.debugger.onEvent.addListener((source, eventName, eventParams) => {
  // Fix 3: track in-flight network requests per tab for waitForNetworkIdle
  const tabId = source.tabId;
  if (tabId) {
    if (eventName === 'Network.requestWillBeSent') {
      _netReqs.set(tabId, (_netReqs.get(tabId) || 0) + 1);
    } else if (eventName === 'Network.loadingFinished' || eventName === 'Network.loadingFailed') {
      _netReqs.set(tabId, Math.max(0, (_netReqs.get(tabId) || 0) - 1));
    }
  }

  if (eventName === 'Target.attachedToTarget') {
    const { sessionId, targetInfo } = eventParams || {};
    if (sessionId && targetInfo) {
      const entry = {
        targetId:   targetInfo.targetId,
        url:        targetInfo.url || '',
        type:       targetInfo.type || 'unknown',
        tabId:      null,   // resolved below
        attachedAt: Date.now()
      };
      subSessions.set(sessionId, entry);
      // Resolve the Chrome tabId from the CDP targetId so we can route
      // normal CDP pool commands (click/type) to the popup window later.
      chrome.debugger.getTargets(targets => {
        const match = (targets || []).find(t => t.id === targetInfo.targetId);
        if (match?.tabId) {
          entry.tabId = match.tabId;
          console.log(`[Aion CDP] Sub-session attached — sessionId=${sessionId} tabId=${match.tabId} url=${targetInfo.url}`);
        } else {
          console.log(`[Aion CDP] Sub-session attached — sessionId=${sessionId} (tabId unresolved) url=${targetInfo.url}`);
        }
      });
    }
  } else if (eventName === 'Target.detachedFromTarget') {
    const { sessionId } = eventParams || {};
    if (sessionId && subSessions.has(sessionId)) {
      console.log(`[Aion CDP] Sub-session detached — sessionId=${sessionId}`);
      subSessions.delete(sessionId);
    }
  }
});

const MAX_SNAPS = 10;
const AI_SITES = ['grok.com', 'grok.x.ai', 'x.com', 'chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai', 'specode.ai'];
const CAPTURE_COOLDOWN = 700; // Minimum 700ms between captures to avoid Chrome rate limit (MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND)

// Helper: clear the version-stamp guard then inject content.js fresh.
// Defined at module scope so it's accessible from all message handlers,
// not just the agentExecute block where it was previously trapped.
const clearAndInject = async (tid, allFrames = true) => {
  await chrome.scripting.executeScript({
    target: { tabId: tid, allFrames },
    func: () => { window.__snaptoai_loaded = null; window.__snaptoai_healthy = false; }
  }).catch(() => {});
  await chrome.scripting.executeScript({
    target: { tabId: tid, allFrames },
    // agent-logic-core.js first: it's plain global function declarations (no
    // module wrapper in a browser context), so loading it before content.js
    // in the same isolated-world injection puts buildActionSignature/
    // rankElementMatches/formatElementLabel etc. directly in scope for
    // content.js to call — same shared logic the Jest tests in
    // tests/agent-logic.test.js exercise, not a separate copy that could drift.
    files: ['agent-logic-core.js', 'content.js']
  });
};

// Default settings
const DEFAULT_SETTINGS = {
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

// Track last capture time to prevent rate limiting (shared between
// snap captures AND sidebar live-preview captures — see
// `sidebarPreviewCapture` handler below)
let lastCaptureTime = 0;
const SIDEBAR_PREVIEW_MIN_GAP_MS = 700;
let lastSidebarPreviewAt = 0;
let sidebarPreviewInFlight = false;

// ============================================
// UI MODE PREFERENCE (popup vs sidebar)
// ============================================
// applyUiMode: switch the action click between opening the popup
// (default) and opening the side panel. This is what makes the
// user's choice persist across browser restarts.
// Serialization guard: ensure only ONE applyUiMode is in flight at a
// time. Concurrent callers (popup click + onStartup + sidebar init +
// fullpage abort) all chain off the same promise, which prevents them
// from racing and toggling popup/sidebar state inconsistently.
let _applyUiModeChain = Promise.resolve();
function applyUiMode(mode) {
  // TEMPORARILY DISABLED: sidebar mode is hidden from users while we
  // sort out the side-panel UX. We force popup mode here so any
  // previously-persisted `uiMode: 'sidebar'` preference is overridden
  // on every load and the icon click always opens the popup.
  const _ignoredMode = mode; // eslint-disable-line no-unused-vars
  const next = _applyUiModeChain.catch(() => {}).then(async () => {
    try {
      if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
      }
      await chrome.action.setPopup({ popup: 'popup.html' });
      console.log('[SnapToAI] UI mode: popup (sidebar entry point disabled)');
    } catch (e) {
      console.log('[SnapToAI] applyUiMode failed:', e && e.message);
    }
  });
  _applyUiModeChain = next;
  return next;
}
function loadAndApplyUiMode() {
  return chrome.storage.local.get(['uiMode'])
    .then((res) => applyUiMode((res && res.uiMode) || 'popup'))
    .catch(() => applyUiMode('popup'));
}

// Open welcome page on first install and initialize subscription
// ============================================
// GOOGLE SIGN-IN (callable from popup OR sidebar)
// ============================================
async function backgroundGoogleSignIn() {
  const manifest = chrome.runtime.getManifest();
  const clientId = manifest && manifest.oauth2 && manifest.oauth2.client_id;
  if (!clientId) throw new Error('OAuth client_id missing in manifest');
  const redirectUrl = chrome.identity.getRedirectURL();
  const scopes = 'openid email profile';
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth' +
    '?client_id=' + encodeURIComponent(clientId) +
    '&response_type=token' +
    '&redirect_uri=' + encodeURIComponent(redirectUrl) +
    '&scope=' + encodeURIComponent(scopes);

  const responseUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (url) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!url) return reject(new Error('No response from Google sign-in'));
      resolve(url);
    });
  });
  const tokenMatch = responseUrl.match(/access_token=([^&]+)/);
  if (!tokenMatch) throw new Error('No access token in response');
  const token = tokenMatch[1];

  const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000)
  });
  if (!resp.ok) throw new Error('Failed to get user info from Google');
  const userInfo = await resp.json();
  if (!userInfo.email) throw new Error('No email returned from Google account');

  const userData = {
    name: userInfo.name || '',
    email: userInfo.email,
    picture: userInfo.picture || '',
    signedInAt: Date.now(),
    accessToken: token,
    tokenObtainedAt: Date.now()
  };
  await chrome.storage.local.set({ snaptoai_user: userData });
  return userData;
}

chrome.runtime.onInstalled.addListener(async (details) => {
  // Apply persisted UI mode preference on install/update so the icon
  // click behaves consistently across browser restarts.
  await loadAndApplyUiMode();

  // v2.6.0 theme migration: existing v2.5.0 users were always dark.
  // On the first upgrade, persist that preference explicitly so the
  // theme controller reconciles to dark immediately and any future
  // first-paint resolves correctly with no light flash on light-OS.
  if (details.reason === 'update') {
    try {
      const r = await chrome.storage.local.get(['snaptoaiSettings']);
      const s = r && r.snaptoaiSettings;
      if (s && !s.theme) {
        await chrome.storage.local.set({ snaptoaiSettings: Object.assign({}, s, { theme: 'dark' }) });
      }
    } catch (e) { /* non-fatal */ }
  }

  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
    
    // CRITICAL: Check BOTH sync AND local storage for existing trial
    // On reinstall: local is WIPED but sync SURVIVES (tied to Google account)
    const { trialStartDate: syncDate } = await chrome.storage.sync.get(['trialStartDate']);
    const { initialInstallTimestamp: localTimestamp, trialStartDate: localDate } = 
      await chrome.storage.local.get(['initialInstallTimestamp', 'trialStartDate']);
    
    // Find the earliest valid timestamp from ANY source
    // IMPORTANT: Convert string values to numbers (legacy storage issue)
    const toNum = (v) => {
      if (typeof v === 'number' && v > 0) return v;
      if (typeof v === 'string') {
        const n = parseInt(v, 10) || Date.parse(v);
        return n > 0 ? n : null;
      }
      return null;
    };
    const candidates = [syncDate, localTimestamp, localDate].map(toNum).filter(d => d && d > 0);
    const existingTimestamp = candidates.length > 0 ? Math.min(...candidates) : null;
    
    if (!existingTimestamp) {
      // TRUE FIRST INSTALL - No trial data anywhere, create new trial
      const now = Date.now();
      await chrome.storage.sync.set({ trialStartDate: now });
      await chrome.storage.local.set({
        initialInstallTimestamp: now,
        trialStartDate: now,
        subscriptionActive: false,
        subscriptionPlan: null
      });
      console.log('[SnapToAI] Trial started:', new Date(now).toLocaleDateString());
    } else {
      // REINSTALL - Found existing trial data, preserve it
      await chrome.storage.sync.set({ trialStartDate: existingTimestamp });
      await chrome.storage.local.set({ 
        initialInstallTimestamp: existingTimestamp,
        trialStartDate: existingTimestamp 
      });
      console.log('[SnapToAI] Reinstall detected - trial preserved from:', new Date(existingTimestamp).toLocaleDateString());
    }
  } else if (details.reason === 'update') {
    // On update: Verify trial date exists, repair from immutable timestamp if needed
    const { initialInstallTimestamp, trialStartDate: localDate } = await chrome.storage.local.get(['initialInstallTimestamp', 'trialStartDate']);
    const { trialStartDate: syncDate } = await chrome.storage.sync.get(['trialStartDate']);
    
    // Use the immutable timestamp as source of truth, fallback to earliest available
    // CRITICAL: Guard against empty array (Math.min() returns Infinity on empty array)
    // IMPORTANT: Convert string values to numbers (legacy storage issue)
    const toNum = (v) => {
      if (typeof v === 'number' && v > 0) return v;
      if (typeof v === 'string') {
        const n = parseInt(v, 10) || Date.parse(v);
        return n > 0 ? n : null;
      }
      return null;
    };
    const candidates = [initialInstallTimestamp, localDate, syncDate].map(toNum).filter(d => d && d > 0);
    const canonicalDate = candidates.length > 0 ? Math.min(...candidates) : null;
    
    if (canonicalDate) {
      // Repair any missing storage
      if (!localDate) await chrome.storage.local.set({ trialStartDate: canonicalDate });
      if (!syncDate) await chrome.storage.sync.set({ trialStartDate: canonicalDate });
      // Ensure immutable timestamp exists
      if (!initialInstallTimestamp) await chrome.storage.local.set({ initialInstallTimestamp: canonicalDate });
      console.log('[SnapToAI] Extension updated - trial preserved from:', new Date(canonicalDate).toLocaleDateString());
    } else {
      // No trial data found anywhere - this is an error state
      // DO NOT create new trial - checkSubscription will handle this
      console.log('[SnapToAI] Extension updated but NO trial data found! User needs to reinstall.');
    }
  }
});

// ============================================
// SNAPTOAI MOUSE WAND MENU (Right-click controls everything)
// Reuses ALL existing functions - no other files touched
// ============================================

let _menuRegistrationPending = false;
function registerSnapToAIMenu() {
  // Guard against concurrent calls — rapid MV3 service-worker wake-ups can
  // fire this before the first removeAll callback completes, producing
  // "Cannot create item with duplicate id" errors in the extension panel.
  if (_menuRegistrationPending) return;
  _menuRegistrationPending = true;
  chrome.contextMenus.removeAll(() => {
    _menuRegistrationPending = false;
    chrome.contextMenus.create({
      id: 'snaptoai-parent',
      title: 'Aion ✨',
      contexts: ['all']
    });

    chrome.contextMenus.create({ id: 'snap-viewport', title: '📸 Snap Viewport', parentId: 'snaptoai-parent', contexts: ['all'] });
    chrome.contextMenus.create({ id: 'snip-region', title: '✂️ Snip Region', parentId: 'snaptoai-parent', contexts: ['all'] });
    chrome.contextMenus.create({ id: 'full-page', title: '🧩 Full Page Capture', parentId: 'snaptoai-parent', contexts: ['all'] });

    chrome.contextMenus.create({ id: 'sep1', type: 'separator', parentId: 'snaptoai-parent' });

    chrome.contextMenus.create({ id: 'ask-ai-this', title: '✨ Ask AI About This', parentId: 'snaptoai-parent', contexts: ['all'] });
    chrome.contextMenus.create({ id: 'explain-text', title: '📝 Explain Selected Text', parentId: 'snaptoai-parent', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'analyze-image', title: '🖼️ Analyze This Image', parentId: 'snaptoai-parent', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'image-to-music', title: '🎵 Make Music From This Image', parentId: 'snaptoai-parent', contexts: ['image'] });

    chrome.contextMenus.create({ id: 'sep2', type: 'separator', parentId: 'snaptoai-parent' });

    chrome.contextMenus.create({ id: 'send-queue-ai', title: '📤 Send 0 Snaps to AI', parentId: 'snaptoai-parent', contexts: ['all'] });
    chrome.contextMenus.create({ id: 'open-ai-chat', title: '💬 Open AI Chat', parentId: 'snaptoai-parent', contexts: ['all'] });
    chrome.contextMenus.create({ id: 'view-queue', title: '👀 View Queue', parentId: 'snaptoai-parent', contexts: ['all'] });
  });
}

registerSnapToAIMenu();

async function updateQueueMenuTitle() {
  try {
    const result = await chrome.storage.local.get('snaps');
    const count = (result.snaps || []).length;
    const title = `📤 Send ${count} Snap${count === 1 ? '' : 's'} to AI`;
    chrome.contextMenus.update('send-queue-ai', { title });
  } catch (e) {}
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.snaps) {
    updateQueueMenuTitle();
  }
});

setTimeout(updateQueueMenuTitle, 1000);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  switch (info.menuItemId) {
    case 'snap-viewport':
      await captureScreenshot(tab.id);
      break;

    case 'snip-region': {
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        if (dataUrl) {
          const snipId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          await chrome.storage.local.set({ ['snipImage_' + snipId]: dataUrl });
          chrome.windows.create({
            url: chrome.runtime.getURL(`annotate.html?mode=snip&snipId=${snipId}`),
            type: 'popup',
            width: 1200,
            height: 800,
            focused: true
          });
        }
      } catch (e) {
        console.log('[SnapToAI] Snip from menu failed:', e.message);
      }
      break;
    }

    case 'full-page':
      await startFullPageCapture(tab.id);
      break;

    case 'ask-ai-this':
    case 'explain-text':
    case 'analyze-image':
      await handleAskSnapToAI(info, tab);
      break;

    case 'image-to-music':
      await handleImageToMusic(info, tab);
      break;

    case 'send-queue-ai': {
      try {
        const snaps = await getSnaps();
        if (snaps.length === 0) {
          console.log('[SnapToAI] Queue empty - opening direct AI chat');
          chrome.windows.create({
            url: chrome.runtime.getURL('ai-chat.html?direct=true'),
            type: 'popup', width: 1000, height: 700, focused: true
          });
        } else {
          await chrome.storage.session.set({
            selectedSnaps: snaps,
            useIndexedDB: false
          });
          chrome.windows.create({
            url: chrome.runtime.getURL(`ai-chat.html?count=${snaps.length}`),
            type: 'popup', width: 1000, height: 700, focused: true
          });
        }
      } catch (e) {
        console.log('[SnapToAI] Send queue to AI failed:', e.message);
      }
      break;
    }

    case 'open-ai-chat':
      chrome.windows.create({
        url: chrome.runtime.getURL('ai-chat.html?direct=true'),
        type: 'popup', width: 1000, height: 700, focused: true
      });
      break;

    case 'view-queue':
      await chrome.storage.session.set({ mouseWandSourceTab: { tabId: tab.id, windowId: tab.windowId } });
      chrome.windows.create({
        url: chrome.runtime.getURL('popup.html?source=menu'),
        type: 'popup', width: 420, height: 600, focused: true
      });
      break;
  }
});

async function handleImageToMusic(info, tab) {
  try {
    if (!info.srcUrl) {
      console.log('[SnapToAI] No image URL for image-to-music');
      return;
    }
    
    let imageData = info.srcUrl;
    
    if (!imageData.startsWith('data:')) {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (url) => {
            return new Promise((resolve) => {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
              };
              img.onerror = () => resolve(null);
              img.src = url;
            });
          },
          args: [info.srcUrl]
        });
        if (result?.result) {
          imageData = result.result;
        }
      } catch(e) {
        console.log('[SnapToAI] Could not convert image, trying screenshot fallback');
        try {
          imageData = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 85 });
        } catch(e2) {
          console.log('[SnapToAI] Screenshot fallback failed:', e2.message);
          return;
        }
      }
    }
    
    await chrome.storage.session.set({
      selectedSnaps: [imageData],
      useIndexedDB: false,
      geminiModel: 'music'
    });
    
    chrome.storage.sync.set({ geminiModel: 'music' });
    
    chrome.windows.create({
      url: chrome.runtime.getURL('ai-chat.html?count=1&source=contextmenu&mode=music&img2music=true'),
      type: 'popup',
      width: 1000,
      height: 700,
      focused: true
    });
    
  } catch(e) {
    console.log('[SnapToAI] Image-to-music failed:', e.message);
  }
}

async function handleAskSnapToAI(info, tab) {
  try {
    if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:') || tab.url.startsWith('edge://') || tab.url.startsWith('devtools://') || tab.url.startsWith('chrome-search://') || tab.url.startsWith('view-source:')) {
      console.log('[SnapToAI] Cannot analyze restricted page');
      return;
    }

    try {
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tab.id, { active: true });
    } catch (e) {
      console.log('[SnapToAI] Tab focus failed:', e.message);
    }
    await new Promise(r => setTimeout(r, 80));

    let screenshot = null;
    try {
      screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 85 });
    } catch (e) {
      console.log('[SnapToAI] Screenshot capture failed:', e);
    }

    let pageContext = {
      url: tab.url || '',
      title: tab.title || '',
      selectedText: info.selectionText || '',
      linkUrl: info.linkUrl || '',
      srcUrl: info.srcUrl || '',
      mediaType: info.mediaType || ''
    };

    const contextPromise = new Promise(async (resolve) => {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [info.frameId || 0] },
          func: () => {
            const sel = window.getSelection();
            const selectedText = sel ? sel.toString() : '';
            let clickedElementInfo = '';
            const active = document.activeElement;
            if (active && active !== document.body) {
              const tag = active.tagName || '';
              const text = (active.textContent || '').substring(0, 500);
              clickedElementInfo = `<${tag}> ${text}`;
            }
            const codeBlocks = [];
            document.querySelectorAll('pre, code').forEach(el => {
              const text = (el.textContent || '').trim();
              if (text.length > 10 && text.length < 5000) {
                codeBlocks.push(text.substring(0, 2000));
              }
            });
            return {
              selectedText,
              clickedElement: clickedElementInfo,
              visibleCodeBlocks: codeBlocks.slice(0, 3),
              pageText: document.title
            };
          }
        });
        resolve(result?.result || null);
      } catch (e) {
        resolve(null);
      }
    });

    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 1500));
    const contextResult = await Promise.race([contextPromise, timeoutPromise]);

    if (contextResult) {
      if (contextResult.selectedText && contextResult.selectedText.length > (pageContext.selectedText || '').length) {
        pageContext.selectedText = contextResult.selectedText;
      }
      pageContext.clickedElement = contextResult.clickedElement || '';
      pageContext.visibleCodeBlocks = contextResult.visibleCodeBlocks || [];
    }

    const payload = {
      screenshot: screenshot,
      context: pageContext,
      timestamp: Date.now()
    };

    try {
      await chrome.storage.session.set({ askAiPayload: payload });
    } catch (storageErr) {
      console.log('[SnapToAI] Storage failed, retrying without screenshot:', storageErr.message);
      payload.screenshot = null;
      try { await chrome.storage.session.set({ askAiPayload: payload }); } catch (e2) {
        console.log('[SnapToAI] Storage retry also failed:', e2.message);
      }
    }

    chrome.windows.create({
      url: chrome.runtime.getURL('ai-chat.html?source=contextmenu&count=1'),
      type: 'popup',
      width: 1000,
      height: 700,
      focused: true
    });

  } catch (err) {
    console.log('[SnapToAI] Ask AI error:', err);
    chrome.windows.create({
      url: chrome.runtime.getURL('ai-chat.html?source=contextmenu&error=storage'),
      type: 'popup',
      width: 1000, height: 700,
      focused: true
    });
  }
}

// ============================================
// END SNAPTOAI MOUSE WAND MENU
// ============================================

// Get current settings
async function getSettings() {
  const result = await chrome.storage.local.get('snaptoaiSettings');
  return { ...DEFAULT_SETTINGS, ...result.snaptoaiSettings };
}

// Full page capture state - prevents duplicate captures
let isFullPageCaptureInProgress = false;
let fullPageCapturePort = null; // Port to detect popup disconnect

// Batch buffer for large captures (images sent in batches of 30)
let batchBuffer = [];
let batchMetadata = null;

// Listen for keyboard command (Ctrl+Shift+S)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'stop-autopilot') {
    // Writes to session storage so the agent loop picks it up even if the
    // popup is closed or in mini-mode and the local JS variable is unreachable.
    await chrome.storage.session.set({ agentStopRequested: true });
    console.log('[Aion Autopilot] Stop requested via global hotkey (Ctrl+Shift+X).');
  } else if (command === 'capture') {
    captureScreenshot();
  } else if (command === 'ask-ai') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      let selectedText = '';
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const sel = window.getSelection();
            if (sel && sel.toString().trim().length > 0) return sel.toString();
            const active = document.activeElement;
            if (active && active.value && typeof active.selectionStart === 'number' && active.selectionStart !== active.selectionEnd) {
              return active.value.substring(active.selectionStart, active.selectionEnd);
            }
            return '';
          }
        });
        selectedText = result?.result || '';
      } catch (e) {
        console.log('[SnapToAI] Selection read failed:', e.message);
      }
      await handleAskSnapToAI({ selectionText: selectedText, frameId: 0 }, tab);
    }
  }
});

// Listen for extension icon click - ABORT full page capture if running
// ALWAYS try to abort (don't check state - it might be stale after service worker restart)
chrome.action.onClicked.addListener(async (tab) => {
  console.log('[SnapToAI] ICON CLICKED - ABORT TRIGGERED');
  
  // SET ABORT FLAG IN STORAGE (survives service worker restart)
  await chrome.storage.session.set({ abortFullPageCapture: Date.now() });
  console.log('[SnapToAI] Abort flag set in storage');
  
  // Send abort message to content script (always try, even if state is stale)
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'abortFullPageCapture' });
    console.log('[SnapToAI] Abort message sent to tab:', tab.id);
  } catch (e) {
    console.log('[SnapToAI] Could not send abort:', e.message);
  }
  
  // Reset capture state (cleanup)
  isFullPageCaptureInProgress = false;
  batchBuffer = [];
  batchMetadata = null;
  
  // Re-apply the user's UI mode preference (popup OR sidebar) instead
  // of hard-resetting to popup — preserves sidebar-mode users' choice.
  await loadAndApplyUiMode();
  
  console.log('[SnapToAI] Abort complete, UI mode restored');
});

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'capture') {
    captureScreenshot().then(sendResponse);
    return true;
  } else if (request.action === 'keepAlive') {
    // Lightweight ping from content script's keepServiceWorkerAlive().
    // The round-trip itself resets the service worker's 30-second idle timer —
    // no work needed here beyond responding so the promise resolves cleanly.
    sendResponse({ success: true });
    return true;
  } else if (request.action === 'askAiDirect') {
    const sourceTabId = request.sourceTabId;
    (async () => {
      try {
        let tab = null;
        if (sourceTabId) {
          try { tab = await chrome.tabs.get(sourceTabId); } catch (e) {}
        }
        if (!tab) {
          const allTabs = await chrome.tabs.query({});
          tab = allTabs
            .filter(t => t.url && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('chrome://') && !t.url.startsWith('about:'))
            .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
        }
        if (tab) {
          await handleAskSnapToAI({ selectionText: '', frameId: 0 }, tab);
        } else {
          chrome.windows.create({
            url: chrome.runtime.getURL('ai-chat.html?direct=true'),
            type: 'popup', width: 1000, height: 700, focused: true
          });
        }
        sendResponse({ success: true });
      } catch (e) {
        console.log('[SnapToAI] askAiDirect error:', e);
        chrome.windows.create({
          url: chrome.runtime.getURL('ai-chat.html?direct=true'),
          type: 'popup', width: 1000, height: 700, focused: true
        });
        sendResponse({ success: false });
      }
    })();
    return true;
  } else if (request.action === 'upload') {
    handleUpload(request.preferredPlatform, request.selectedSnaps).then(sendResponse);
    return true;
  } else if (request.action === 'getSnaps') {
    getSnaps().then(sendResponse);
    return true;
  } else if (request.action === 'clearSnaps') {
    clearSnaps().then(sendResponse);
    return true;
  } else if (request.action === 'deleteSnap') {
    // Delete a single snap by index
    deleteSnapByIndex(request.index).then(sendResponse);
    return true;
  } else if (request.action === 'setSnaps') {
    setSnaps(request.snaps, request.metadata || null).then(sendResponse);
    return true;
  } else if (request.action === 'getSnapCount') {
    getSnapCount().then(sendResponse);
    return true;
  } else if (request.action === 'uploadComplete') {
    clearSnaps().then(sendResponse);
    return true;
  } else if (request.action === 'snipComplete') {
    // Handle snip (cropped image) - add as new snap with optional metadata
    addSnip(request.dataUrl, request.metadata).then(sendResponse);
    return true;
  } else if (request.action === 'getQueueStatus') {
    // Return current queue size for capacity checking
    getSnaps().then(snaps => {
      sendResponse({ count: snaps.length, max: MAX_SNAPS, available: MAX_SNAPS - snaps.length });
    });
    return true;
  } else if (request.action === 'startFullPageCapture') {
    // Start full page capture process
    startFullPageCapture().then(sendResponse);
    return true;
  } else if (request.action === 'sidebarPreviewCapture') {
    // Throttled, mutex-guarded preview capture for the sidebar live preview.
    // Centralizing here means snap captures and preview captures share one
    // global cooldown so we never trip MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND.
    (async () => {
      try {
        if (sidebarPreviewInFlight) {
          sendResponse({ success: false, skip: true, reason: 'in_flight' });
          return;
        }
        const now = Date.now();
        const sinceLastPreview = now - lastSidebarPreviewAt;
        const sinceLastSnap = now - lastCaptureTime;
        if (sinceLastPreview < SIDEBAR_PREVIEW_MIN_GAP_MS || sinceLastSnap < CAPTURE_COOLDOWN) {
          sendResponse({ success: false, skip: true, reason: 'cooldown' });
          return;
        }
        sidebarPreviewInFlight = true;
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab) { sidebarPreviewInFlight = false; sendResponse({ success: false, error: 'no_tab' }); return; }
        if (!isCapturableUrl(tab.url)) {
          sidebarPreviewInFlight = false;
          sendResponse({ success: false, error: 'restricted', tabUrl: tab.url, tabTitle: tab.title });
          return;
        }
        try {
          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 45 });
          // Update BOTH timers so snap captures see the preview as recent
          // activity too (bidirectional shared cooldown).
          const t = Date.now();
          lastSidebarPreviewAt = t;
          lastCaptureTime = t;
          sendResponse({ success: true, dataUrl, tabUrl: tab.url, tabTitle: tab.title, tabId: tab.id });
        } catch (e) {
          sendResponse({ success: false, error: (e && e.message) || String(e) });
        } finally {
          sidebarPreviewInFlight = false;
        }
      } catch (e) {
        sidebarPreviewInFlight = false;
        sendResponse({ success: false, error: (e && e.message) || String(e) });
      }
    })();
    return true;
  } else if (request.action === 'setUiModePreference') {
    (async () => {
      const mode = request.mode === 'sidebar' ? 'sidebar' : 'popup';
      await chrome.storage.local.set({ uiMode: mode });
      await applyUiMode(mode);
      sendResponse({ success: true, mode });
    })();
    return true;
  } else if (request.action === 'signInWithGoogle') {
    (async () => {
      try {
        const result = await backgroundGoogleSignIn();
        sendResponse({ success: true, user: result });
      } catch (e) {
        sendResponse({ success: false, error: (e && e.message) || String(e) });
      }
    })();
    return true;
  } else if (request.action === 'signOutGoogle') {
    (async () => {
      try {
        await chrome.storage.local.remove('snaptoai_user');
        try { await chrome.identity.clearAllCachedAuthTokens(); } catch (_) {}
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: (e && e.message) || String(e) });
      }
    })();
    return true;
  } else if (request.action === 'agentWaitNetworkIdle') {
    // Fix 3: block until no in-flight network requests for this tab (or timeout)
    const { tabId } = request;
    if (!tabId) { sendResponse({ ok: true }); return; }
    waitForNetworkIdle(tabId, 3000).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: true }));
    return true; // async

  } else if (request.action === 'agentExecute') {
    // Relay agent automation command to the target tab
    const { tabId, executeAction, params } = request;

    if (!tabId) {
      sendResponse({ success: false, error: 'No tab ID provided' });
      return;
    }
    // ── Risk guard ─────────────────────────────────────────────────────────
    // Runs BEFORE any DOM/CDP work on click/doubleClick actions. Checks the
    // actual element label text against the RISKY_PATTERNS list. If it
    // matches, block immediately and return requiresConfirmation:true so
    // ai-chat.js can show the user a real Yes/No card. The _riskConfirmed
    // flag lets a user-approved re-send pass through exactly once.
    if (!params?._riskConfirmed && RISKY_ACTIONS.has(executeAction)) {
      const risk = assessActionRisk(executeAction, params);
      if (risk) {
        sendResponse({ success: false, requiresConfirmation: true, riskReason: risk });
        return true;
      }
    }

    if (executeAction === 'navigate') {
      // Changing the address bar / loading a new URL can only be done from
      // the background script via chrome.tabs.update — a content script
      // running inside the page has no access to browser navigation.
      (async () => {
        try {
          let url = (params && params.url || '').trim();
          if (!url) { sendResponse({ success: false, error: 'No URL provided' }); return; }
          // Reject navigating TO a chrome:// or extension:// URL — those are
          // privileged pages the agent cannot control anyway.
          if (/^(chrome|chrome-extension|edge|about|devtools|brave|opera|vivaldi):/.test(url)) {
            sendResponse({ success: false, error: `Cannot navigate to a restricted browser URL: ${url}` });
            return;
          }
          if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

          // Get the current tab URL to check if it's a restricted system page.
          let currentTab = null;
          try { currentTab = await chrome.tabs.get(tabId); } catch (_) {}
          const isSystemPage = /^(chrome|chrome-extension|edge|about|devtools|brave|opera|vivaldi):/.test(
            (currentTab && currentTab.url) || ''
          );

          if (isSystemPage) {
            // chrome.tabs.update on NTP/system pages is restricted in MV3.
            // Open the URL in the same tab via tabs.create (reuses the window).
            try {
              const newTab = await chrome.tabs.create({ url, windowId: currentTab.windowId, index: currentTab.index, active: true });
              // Wait up to 15s for the new tab to finish loading
              await new Promise(resolve => {
                const timeout = setTimeout(() => {
                  chrome.tabs.onUpdated.removeListener(listener);
                  resolve();
                }, 15000);
                function listener(changedTabId, info) {
                  if (changedTabId === newTab.id && info.status === 'complete') {
                    clearTimeout(timeout);
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                  }
                }
                chrome.tabs.onUpdated.addListener(listener);
              });
              sendResponse({ success: true, newTabId: newTab.id });
            } catch (createErr) {
              sendResponse({ success: false, error: (createErr && createErr.message) || String(createErr) });
            }
            return;
          }

          // Normal tab: just navigate in place and wait for it to load.
          await chrome.tabs.update(tabId, { url });
          await new Promise(resolve => {
            const timeout = setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }, 15000);
            function listener(changedTabId, info) {
              if (changedTabId === tabId && info.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            }
            chrome.tabs.onUpdated.addListener(listener);
          });
          sendResponse({ success: true });
        } catch (e) {
          sendResponse({ success: false, error: (e && e.message) || String(e) });
        }
      })();
      return true;
    }

    // ── openTab ────────────────────────────────────────────────────────────────
    if (executeAction === 'openTab') {
      (async () => {
        try {
          let url = (params.url || '').trim();
          if (!url) { sendResponse({ success: false, error: 'No URL provided' }); return; }
          if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
          const active = !(params.background !== false); // default: open in background
          const currentTab = await chrome.tabs.get(tabId).catch(() => null);
          const newTab = await chrome.tabs.create({ url, active, windowId: currentTab?.windowId });
          // Wait for it to load
          await new Promise(resolve => {
            const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); resolve(); }, 15000);
            function fn(id, info) { if (id === newTab.id && info.status === 'complete') { clearTimeout(t); chrome.tabs.onUpdated.removeListener(fn); resolve(); } }
            chrome.tabs.onUpdated.addListener(fn);
          });
          sendResponse({ success: true, newTabId: newTab.id, data: `New tab opened: ${url} (tabId: ${newTab.id})` });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
      })(); return true;
    }

    // ── switchTab ──────────────────────────────────────────────────────────────
    if (executeAction === 'switchTab') {
      (async () => {
        try {
          let targetId = params.tabId ? parseInt(params.tabId) : null;
          if (!targetId && params.url) {
            const allTabs = await chrome.tabs.query({});
            const match = allTabs.find(t => t.url && t.url.includes(params.url));
            if (!match) { sendResponse({ success: false, error: `No tab found with URL containing "${params.url}"` }); return; }
            targetId = match.id;
          }
          if (!targetId) { sendResponse({ success: false, error: 'Provide tabId or url to switch to' }); return; }
          await chrome.tabs.update(targetId, { active: true });
          const info = await chrome.tabs.get(targetId);
          sendResponse({ success: true, switchedTabId: targetId, data: `Switched to tab ${targetId}: ${info.url}` });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
      })(); return true;
    }

    // ── closeTab ───────────────────────────────────────────────────────────────
    if (executeAction === 'closeTab') {
      (async () => {
        try {
          const idToClose = params.tabId ? parseInt(params.tabId) : tabId;
          await chrome.tabs.remove(idToClose);
          sendResponse({ success: true, data: `Closed tab ${idToClose}` });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
      })(); return true;
    }

    if (executeAction === 'extractTabText') {
      // Used by Council Mode to scrape the last AI response from a tab.
      // Runs a caller-supplied JS expression via Runtime.evaluate and returns
      // the string result — no content-script injection needed.
      (async () => {
        const { expression = '' } = params || {};
        if (!expression) { sendResponse({ success: false, error: 'No expression provided' }); return; }
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (e) {
          sendResponse({ success: false, error: `CDP unavailable: ${e.message}` }); return;
        }
        try {
          const result = await session.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise:  false
          });
          const text = result?.result?.value ?? '';
          sendResponse({ success: true, text: String(text) });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        } finally { session.release(); }
      })(); return true;
    }

    if (executeAction === 'type') {
      // Google Sheets/Docs draw their real content on <canvas>, so they
      // don't have a normal input to set .value on — the plain content-script
      // "type" path used for regular websites ends up grabbing whichever
      // stray text box it can find (the filename/title field at the very
      // top), which is why typing landed "at the top" of the sheet/doc
      // instead of inside it. Canvas apps like Sheets also flatly ignore
      // synthetic (isTrusted:false) keyboard events, so once we know we're
      // on a Sheets/Docs page we click + type using the real Chrome
      // DevTools Protocol keyboard (chrome.debugger) instead — indistinguishable
      // from someone physically typing. Every other site keeps using the
      // existing content-script type path untouched below.
      (async () => {
        // runFallbackType: for Google Docs/Word/Excel we inject the typing
        // logic as an INLINE function (not via content.js) so it always runs
        // fresh code from this extension regardless of which content.js
        // version is loaded in the tab.
        const runFallbackType = async () => {
          try {
            const currentTab = await chrome.tabs.get(tabId).catch(() => null);
            const tabUrl = currentTab && currentTab.url ? currentTab.url : '';
            const tabHost = (() => { try { return new URL(tabUrl).hostname; } catch(_) { return ''; } })();

            // ── Google Docs ──────────────────────────────────────────────────────
            if (tabHost.includes('docs.google.com') && tabUrl.includes('/document/')) {
              const text = String(params && params.text ? params.text : '');
              try {
                const results = await chrome.scripting.executeScript({
                  target: { tabId },
                  func: async (textToType) => {
                    const sleep = ms => new Promise(res => setTimeout(res, ms));

                    // Show a status banner so the user can see what's happening
                    const showBanner = (msg) => {
                      let b = document.getElementById('__aion_type_banner');
                      if (!b) {
                        b = document.createElement('div');
                        b.id = '__aion_type_banner';
                        b.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:999999;background:#1a73e8;color:#fff;padding:8px 18px;border-radius:20px;font:600 13px/1.4 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);pointer-events:none;';
                        document.body.appendChild(b);
                      }
                      b.textContent = msg;
                      clearTimeout(b.__t);
                      b.__t = setTimeout(() => b.remove(), 4000);
                    };

                    // ── Method 1: docs-texteventtarget-iframe ─────────────────
                    // Google Docs routes ALL keyboard input through this hidden
                    // same-origin iframe. We must WAIT for it — on a freshly
                    // navigated tab it can take 1-3 seconds to appear.
                    showBanner('⌨️ Aion: waiting for Docs editor…');
                    let textIframe = null;
                    for (let i = 0; i < 15; i++) {
                      textIframe = document.querySelector('.docs-texteventtarget-iframe');
                      if (textIframe && textIframe.contentDocument && textIframe.contentDocument.body) break;
                      await sleep(300);
                    }

                    if (textIframe && textIframe.contentDocument) {
                      try {
                        const iframeDoc = textIframe.contentDocument;
                        iframeDoc.body.focus();
                        await sleep(150);
                        showBanner('⌨️ Aion: typing into Docs…');
                        const ok = iframeDoc.execCommand('insertText', false, textToType);
                        if (ok) {
                          showBanner('✅ Aion: typed into Docs');
                          return { success: true, method: 'textevent-iframe' };
                        }
                      } catch(iframeErr) { /* fall through */ }
                    }

                    // ── Method 2: click canvas tile → insertText on body ──────
                    // If iframe focus didn't work, click a canvas tile to give
                    // Docs the focus it needs, then try insertText on the body.
                    showBanner('⌨️ Aion: trying canvas click…');
                    const tile = document.querySelector('.kix-canvas-tile-content')
                               || document.querySelector('.kix-appview-editor')
                               || document.querySelector('#docs-editor');
                    if (tile) {
                      const r = tile.getBoundingClientRect();
                      const cx = r.left + Math.min(150, r.width * 0.2);
                      const cy = r.top  + Math.min(100, r.height * 0.15);
                      tile.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
                      tile.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, clientX: cx, clientY: cy }));
                      tile.dispatchEvent(new MouseEvent('click',     { bubbles: true, clientX: cx, clientY: cy }));
                      await sleep(400);
                    }
                    // Re-try iframe after click
                    const iframe2 = document.querySelector('.docs-texteventtarget-iframe');
                    if (iframe2 && iframe2.contentDocument) {
                      try {
                        iframe2.contentDocument.body.focus();
                        await sleep(150);
                        const ok2 = iframe2.contentDocument.execCommand('insertText', false, textToType);
                        if (ok2) {
                          showBanner('✅ Aion: typed (method 2)');
                          return { success: true, method: 'iframe-after-click' };
                        }
                      } catch(_) { /* fall through */ }
                    }

                    // ── Method 3: clipboard stage → Ctrl+V ────────────────────
                    showBanner('📋 Aion: pasting via clipboard…');
                    const ta = document.createElement('textarea');
                    ta.value = textToType;
                    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;';
                    document.body.appendChild(ta);
                    ta.focus(); ta.select();
                    document.execCommand('copy');
                    ta.remove();
                    await sleep(150);
                    const activeEl = document.activeElement || document.body;
                    activeEl.dispatchEvent(new KeyboardEvent('keydown', { key:'v', code:'KeyV', ctrlKey:true, bubbles:true, cancelable:true }));
                    activeEl.dispatchEvent(new KeyboardEvent('keyup',   { key:'v', code:'KeyV', ctrlKey:true, bubbles:true }));
                    await sleep(400);
                    // Synthetic Ctrl+V is isTrusted:false — canvas editors silently ignore it.
                    // Return false so the brain retries via real CDP, not a lying success.
                    showBanner('⚠️ Aion: synthetic paste blocked — CDP required');
                    return { success: false, error: 'Synthetic paste (isTrusted:false) ignored by canvas editor — CDP path required.' };
                  },
                  args: [text]
                });
                const r = results && results[0] && results[0].result;
                sendResponse(r || { success: false, error: 'Script returned nothing' });
              } catch (inlineErr) {
                sendResponse({ success: false, error: 'Docs script failed: ' + inlineErr.message });
              }
              return;
            }

            // ── Word Online inline paste ────────────────────────────────────────
            if (tabHost.includes('word.office.com') || tabHost.includes('word.live.com')
                || tabHost.includes('sharepoint.com') || tabHost.includes('cloud.microsoft')
                || tabHost.includes('microsoft365.com') || tabHost.includes('office365.com')
                || (tabHost.includes('office.com') && (tabUrl.includes('/word/') || tabUrl.includes('Word')))
            ) {
              const text = String(params && params.text ? params.text : '');
              try {
                const results = await chrome.scripting.executeScript({
                  target: { tabId },
                  func: async (textToType) => {
                    const selectors = ['.WACViewPanel', '.Page', '[class*="EditArea"]', 'div[contenteditable="true"]'];
                    let el = null;
                    for (const sel of selectors) { el = document.querySelector(sel); if (el) break; }
                    // Stage text without needing document focus (navigator.clipboard requires user gesture)
                    const ta = document.createElement('textarea');
                    ta.value = textToType;
                    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;';
                    document.body.appendChild(ta);
                    ta.focus(); ta.select();
                    document.execCommand('copy');
                    ta.remove();
                    if (el) { el.click(); el.focus(); await new Promise(r => setTimeout(r, 300)); }
                    await new Promise(r => setTimeout(r, 150));
                    const t = document.activeElement || el || document.body;
                    t.dispatchEvent(new KeyboardEvent('keydown', { key:'v', code:'KeyV', ctrlKey:true, bubbles:true, cancelable:true }));
                    t.dispatchEvent(new KeyboardEvent('keyup',   { key:'v', code:'KeyV', ctrlKey:true, bubbles:true }));
                    await new Promise(r => setTimeout(r, 400));
                    return { success: true };
                  },
                  args: [text]
                });
                sendResponse(results?.[0]?.result || { success: false });
              } catch (e) {
                sendResponse({ success: false, error: 'Word inline paste failed: ' + e.message });
              }
              return;
            }

            // ── Google Sheets inline paste ──────────────────────────────────────
            // Uses clipboard paste — Sheets handles TSV (tab-separated) natively
            // for 2D range fill. Tab = next column, newline = next row.
            if (tabHost.includes('docs.google.com') && tabUrl.includes('/spreadsheets/')) {
              const text = String(params && params.text ? params.text : '');
              // Respect params.cell — navigate to that cell first, defaulting to A1
              const targetCell = (params.cell && /^[A-Za-z]+\d+$/.test(String(params.cell).trim()))
                ? String(params.cell).trim().toUpperCase()
                : 'A1';
              try {
                const results = await chrome.scripting.executeScript({
                  target: { tabId },
                  func: async (textToType, cell) => {
                    const sleep = ms => new Promise(res => setTimeout(res, ms));

                    // Stage text without needing real clipboard API (avoids "Document not focused" error)
                    const stageClipboard = (txt) => {
                      const ta = document.createElement('textarea');
                      ta.value = txt;
                      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;';
                      document.body.appendChild(ta);
                      ta.focus(); ta.select();
                      document.execCommand('copy');
                      ta.remove();
                    };

                    try {
                      // ── 1. Navigate to target cell via Name Box ────────────────
                      const nameBox = document.querySelector(
                        '#t-name-box, [id="t-name-box"], .docs-objectbox-container input, [aria-label="Name Box"]'
                      );
                      if (nameBox) {
                        nameBox.click(); nameBox.focus(); await sleep(120);
                        nameBox.value = cell;
                        nameBox.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', keyCode:13, bubbles:true }));
                        nameBox.dispatchEvent(new KeyboardEvent('keyup',   { key:'Enter', keyCode:13, bubbles:true }));
                        await sleep(350);
                      }

                      // ── 2. Prepare paste content ────────────────────────────────
                      // TSV (has \t): paste as-is — Sheets handles 2D TSV natively
                      //   "Month\tPrice\nJan\t100\nFeb\t120"  →  A1=Month B1=Price A2=Jan B2=100 ...
                      // Rows only (has \n, no \t): paste as column
                      // Space-separated (neither): split on whitespace into a column
                      let pasteContent;
                      if (textToType.includes('\t')) {
                        // True TSV — preserve exactly; Sheets parses rows + columns
                        pasteContent = textToType;
                      } else if (textToType.includes('\n')) {
                        // Rows only — each line is one cell going down column A
                        pasteContent = textToType;
                      } else {
                        // Fallback: space-separated — each word becomes its own row
                        const parts = textToType.split(/\s+/).filter(Boolean);
                        pasteContent = parts.length > 1 ? parts.join('\n') : textToType;
                      }

                      // ── 3. Paste ────────────────────────────────────────────────
                      stageClipboard(pasteContent);
                      await sleep(150);
                      document.execCommand('paste');
                      await sleep(600);
                      return {
                        success: true,
                        method: pasteContent.includes('\t') ? 'sheets-tsv-2d' : 'sheets-column',
                        cell,
                        rows: pasteContent.split('\n').length
                      };
                    } catch (e) {
                      return { success: false, error: String(e && e.message || e) };
                    }
                  },
                  args: [text, targetCell]
                });
                sendResponse(results?.[0]?.result || { success: false });
              } catch (e) {
                sendResponse({ success: false, error: 'Sheets inline paste failed: ' + e.message });
              }
              return;
            }

            // ── All other sites: try content.js, inject fresh if needed ─────────
            chrome.tabs.sendMessage(tabId, { action: 'agentExecute', executeAction, params }, (response) => {
              if (chrome.runtime.lastError) {
                clearAndInject(tabId)
                  .then(() => chrome.tabs.sendMessage(tabId, { action: 'agentExecute', executeAction, params }, sendResponse))
                  .catch(err => sendResponse({ success: false, error: err.message }));
              } else {
                sendResponse(response);
              }
            });
          } catch (fallbackErr) {
            sendResponse({ success: false, error: fallbackErr.message });
          }
        };

        try {
          // Determine if this tab is a canvas-based editor that needs CDP.
          // BUG FIX: the old check only covered docs.google.com — Word Online
          // and Excel Online were never reaching CDP and fell into the clipboard
          // fallback which silently fails. Now all canvas apps use CDP first.
          const tab = await chrome.tabs.get(tabId);
          const tabUrlObj = tab && tab.url ? (() => { try { return new URL(tab.url); } catch(_) { return null; } })() : null;
          const tabHostname = tabUrlObj ? tabUrlObj.hostname : '';
          const tabPath     = tabUrlObj ? tabUrlObj.pathname : '';

          const isCanvasApp = tabHostname.includes('docs.google.com')
            || tabHostname.includes('office.com')
            || tabHostname.includes('live.com')
            || tabHostname.includes('sharepoint.com')       // SharePoint Online
            || tabHostname.includes('cloud.microsoft')       // Microsoft 365 cloud
            || tabHostname.includes('microsoft365.com')      // Microsoft 365 tenant URLs
            || tabHostname.includes('office365.com')         // Legacy Office 365 URLs
            || tabHostname.includes('microsoftonline.com')   // Microsoft SSO / enterprise
            // ── Google AI / Gemini ecosystem ──────────────────────────────────
            || tabHostname.includes('aistudio.google.com')   // AI Studio (app builder)
            || tabHostname.includes('gemini.google.com')     // Gemini chat
            || tabHostname.includes('makersuite.google.com') // AI Studio (old name)
            || tabHostname.includes('notebooklm.google.com') // NotebookLM
            || tabHostname.includes('notebook.google.com')  // NotebookLM (redirect target)
            || tabHostname.includes('labs.google.com')       // Google Labs
            || tabHostname.includes('colab.research.google.com') // Colab
            || tabHostname.includes('idx.google.com')        // Project IDX
            // ── Other major AI chat platforms ─────────────────────────────────
            || tabHostname.includes('chatgpt.com')           // ChatGPT
            || tabHostname.includes('chat.openai.com')       // ChatGPT (old)
            || tabHostname.includes('claude.ai')             // Claude
            || tabHostname.includes('grok.com')              // Grok
            || tabHostname.includes('perplexity.ai')         // Perplexity
            || tabHostname.includes('copilot.microsoft.com') // Microsoft Copilot
            || tabHostname.includes('bing.com');             // Bing Copilot

          if (!isCanvasApp) {
            runFallbackType();
            return;
          }

          // Ask content.js for the (x, y) coordinates to click.
          // If content.js isn't loaded yet, inject it then retry once.
          const locate = () => new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, { action: 'agentExecute', executeAction: 'locateForType', params }, (response) => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
              else resolve(response);
            });
          });

          let loc;
          try { loc = await locate(); }
          catch (_e) { await clearAndInject(tabId); loc = await locate(); }

          if (!loc || !loc.success || typeof loc.x !== 'number' || typeof loc.y !== 'number') {
            // For Google Docs: even without DOM coordinates we can type via CDP —
            // the isDocs branch uses Runtime.evaluate to focus the texteventtarget-iframe
            // and then dispatchKeyEvent char-by-char. No mouse click coordinates needed.
            // Skip runFallbackType() (execCommand / synthetic Ctrl+V) — those are
            // isTrusted:false and Google Docs silently ignores them.
            const isDocsUrl = tabHostname.includes('docs.google.com') && tabPath.includes('/document/');
            if (!isDocsUrl) {
              runFallbackType();
              return;
            }
            // Provide dummy coords — the Docs CDP path doesn't use them
            loc = { success: true, x: 400, y: 400, mode: 'docs' };
          }

          const { x, y, mode } = loc;

          // Attach CDP via persistent session pool (no per-action flash/race).
          let session;
          try {
            session = await cdpPool.acquire(tabId);
          } catch (attachErr) {
            console.warn('[Aion Agent] CDP attach failed:', attachErr.message);
            runFallbackType();
            return;
          }

          try {
            const send  = session.send; // fire CDP command (returns result)
            const sendR = session.send; // alias — pool.send always returns result

            const text      = String(params.text ?? '');
            const isDocs    = tabHostname.includes('docs.google.com') && tabPath.includes('/document/');
            const isGrid    = (mode === 'sheets');
            const isExcel   = (mode === 'excel');
            const isAiStudio = (mode === 'aistudio');
            const isGemini   = (mode === 'gemini');
            // Per-chatbot modes — each gets dedicated focus selectors + React event
            // firing so framework-managed inputs (ChatGPT React, Claude ProseMirror,
            // Grok, Perplexity) all receive trusted text and enable their send buttons.
            const isChatbot  = ['chatgpt','claude','grok','perplexity','copilot'].includes(mode);

            // Selector lists per chatbot — tried in priority order, first visible wins
            const CHATBOT_SELECTORS = {
              chatgpt:    ['#prompt-textarea', 'div[contenteditable="true"][aria-label]', 'div[contenteditable="true"]', 'textarea'],
              claude:     ['div.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]', 'textarea'],
              grok:       ['textarea[aria-label]', 'div[contenteditable="true"]', 'textarea[placeholder]', 'textarea'],
              perplexity: ['textarea[placeholder]', 'div[contenteditable="true"]', 'textarea'],
              copilot:    ['textarea[id*="search"]', 'div[contenteditable="true"]', '#searchbox', 'textarea[placeholder]', 'textarea'],
            };
            // Google Slides uses a WebGL canvas renderer for text boxes.
            // CDP Input.insertText sometimes works when a text box is focused,
            // but there is no DOM field to verify against — we attempt once and
            // check via AX tree whether any text appeared. If not, we return a
            // CANVAS_TYPING_LIMITATION error so the agent stops and asks for
            // human help instead of retrying in a loop.
            const isSlides  = (mode === 'slides') ||
              (tabHostname.includes('docs.google.com') && tabPath.includes('/presentation/'));

            // clearFirst: select all + delete before typing, so existing field
            // content is replaced instead of appended.
            if (params.clearFirst) {
              await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
              await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
              await new Promise(r => setTimeout(r, 50));
              await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
              await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
              await new Promise(r => setTimeout(r, 50));
            }

            // Helper — send CDP char + special-key events into whatever element has focus
            const typeChars = async (str) => {
              for (const ch of str) {
                if (ch === '\n') {
                  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
                  await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
                } else if (ch === '\t') {
                  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
                  await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
                } else {
                  await send('Input.dispatchKeyEvent', { type: 'char', text: ch, unmodifiedText: ch, key: ch });
                }
              }
            };

            if (isChatbot) {
              // ── ALL CHATBOTS (ChatGPT, Claude, Grok, Perplexity, Copilot) ─────
              // Each bot has a direct DOM input (no Shadow DOM) so we use plain
              // querySelector focus rather than shadow-piercing executeScript.
              // Critical fix for ChatGPT: Input.insertText alone doesn't notify
              // React's synthetic event system — the send button stays disabled.
              // After insertion we fire a native InputEvent so React sees the change.
              const cbSels = CHATBOT_SELECTORS[mode] || ['div[contenteditable="true"]', 'textarea'];

              // Step 1: focus the input element via executeScript
              const cbFocusRes = await chrome.scripting.executeScript({
                target: { tabId },
                func: (sels) => {
                  for (const sel of sels) {
                    const el = document.querySelector(sel);
                    if (el) {
                      el.focus();
                      const r = el.getBoundingClientRect();
                      return { found: true, tag: el.tagName, x: r.left + r.width / 2, y: r.top + r.height / 2 };
                    }
                  }
                  return { found: false };
                },
                args: [cbSels]
              }).catch(() => [{ result: { found: false } }]);

              const cbFocus = cbFocusRes?.[0]?.result;
              if (!cbFocus?.found) {
                // Fallback: coordinate click to give the input OS focus
                await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
                await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: 1 });
              }
              await new Promise(r => setTimeout(r, 150));

              // Step 2: clear existing content if requested
              if (params.clearFirst) {
                await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
                await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
                await new Promise(r => setTimeout(r, 80));
                await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
                await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
                await new Promise(r => setTimeout(r, 80));
              }

              // Step 3: insert text via trusted CDP event
              await send('Input.insertText', { text });

              // Step 4: fire framework synthetic events so React/Vue/Angular see the change.
              // Uses Runtime.evaluate + deep shadow activeElement traversal + composed:true
              // so events cross shadow boundaries and reach Lit/Angular host listeners.
              await send('Runtime.evaluate', {
                expression: `(function() {
                  let el = document.activeElement;
                  while (el && el.shadowRoot && el.shadowRoot.activeElement) { el = el.shadowRoot.activeElement; }
                  if (!el) return false;
                  const cfg = { bubbles: true, composed: true, cancelable: true };
                  ['input', 'change', 'blur'].forEach(t => {
                    el.dispatchEvent(new Event(t, cfg));
                    const host = el.getRootNode && el.getRootNode().host;
                    if (host) host.dispatchEvent(new Event(t, cfg));
                  });
                  return true;
                })()`,
                returnByValue: true
              }).catch(() => {});

              // Step 5: verify text appeared; auto-retry once via coordinate click
              const cbSample = text.slice(0, 20);
              if (cbSample && !(await verifyTextInPage(tabId, cbSample))) {
                await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
                await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: 1 });
                await new Promise(r => setTimeout(r, 250));
                await send('Input.insertText', { text });
                await chrome.scripting.executeScript({
                  target: { tabId },
                  func: (sels) => {
                    for (const sel of sels) {
                      const el = document.querySelector(sel);
                      if (el) { el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true })); return true; }
                    }
                    return false;
                  },
                  args: [cbSels]
                }).catch(() => {});
                if (!(await verifyTextInPage(tabId, cbSample))) {
                  sendResponse({ success: false, error: `Text did not appear in ${mode} input after two attempts. Try clicking the input box first, then type.` });
                  return;
                }
              }

              // Step 6: submit if requested — Enter key works on all these bots.
              // ChatGPT, Claude, Grok, Perplexity all send on Enter (not Ctrl+Enter).
              if (params.run) {
                await new Promise(r => setTimeout(r, 150));
                await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
                await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
              }

              sendResponse({ success: true, data: `Typed into ${mode} (${cbFocus?.found ? 'DOM focus' : 'coordinate fallback'})${params.run ? ' + submitted' : ''}` });

            } else if (isGemini) {
              // ── GEMINI CHAT (gemini.google.com) ───────────────────────────────
              // Gemini's prompt box is a <rich-textarea> custom element whose
              // inner .ql-editor / contenteditable lives inside a Shadow Root.
              // We pierce it with a visibility-aware executeScript query, then
              // use Input.insertText so Angular's change detection fires correctly.
              const gemFocusRes = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                  function gemShadowFindVisible(root) {
                    if (!root) return null;
                    const sels = [
                      'rich-textarea .ql-editor',
                      'rich-textarea div[contenteditable="true"]',
                      'div[contenteditable="true"][aria-label]',
                      'div[contenteditable="true"][role="textbox"]',
                      '.ql-editor',
                      'div[contenteditable="true"]',
                    ];
                    for (const sel of sels) {
                      try {
                        for (const el of root.querySelectorAll(sel)) {
                          const r = el.getBoundingClientRect();
                          if (r.width > 10 && r.height > 10) return el;
                        }
                      } catch (_) {}
                    }
                    for (const el of root.querySelectorAll('*')) {
                      if (el.shadowRoot) {
                        const f = gemShadowFindVisible(el.shadowRoot);
                        if (f) return f;
                      }
                    }
                    return null;
                  }
                  const el = gemShadowFindVisible(document);
                  if (!el) return { found: false };
                  el.focus();
                  return { found: true, tag: el.tagName, cls: el.className.slice(0, 60) };
                }
              }).catch(() => [{ result: { found: false } }]);

              const gemFocused = gemFocusRes?.[0]?.result?.found;
              if (!gemFocused) {
                // Hard fallback: coordinate click at the centre of the textarea area
                await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
                await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: 1 });
              }
              await new Promise(r => setTimeout(r, 150));

              if (params.clearFirst) {
                await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
                await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
                await new Promise(r => setTimeout(r, 80));
                await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
                await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
                await new Promise(r => setTimeout(r, 80));
              }

              // Input.insertText operates on OS-level focus so it works inside shadow roots
              await send('Input.insertText', { text });

              // ── Verify text actually appeared; auto-retry once via coordinate click ──
              const gemSample = text.slice(0, 20);
              if (gemSample && !(await verifyTextInPage(tabId, gemSample))) {
                // First attempt: text didn't land — click at coordinates and retry
                await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
                await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: 1 });
                await new Promise(r => setTimeout(r, 250));
                await send('Input.insertText', { text });
                if (!(await verifyTextInPage(tabId, gemSample))) {
                  sendResponse({ success: false, error: 'Text not detected in Gemini input after two attempts — the field may not have accepted focus. Try clicking the input first, then retype.' });
                  return;
                }
              }

              // params.run = true → press Enter to send the message
              // ChatGPT, Claude, Grok, Perplexity, Copilot: chatbots use plain Enter (not Ctrl+Enter)
              if (params.run) {
                await new Promise(r => setTimeout(r, 80));
                await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
                await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
              }
              sendResponse({ success: true, data: gemFocused ? 'Typed via Gemini shadow focus' : 'Typed via coordinate fallback' });

            } else if (isAiStudio) {
              // ── GOOGLE AI STUDIO ──────────────────────────────────────────────
              // AI Studio uses Lit/Angular Web Components (<ms-prompt-editor>)
              // with nested Shadow Roots. Standard querySelector is blind to shadow
              // boundaries, so content.js often returns the outer wrapper coords.
              // We pierce Shadow Roots recursively to find the real ProseMirror /
              // Monaco editor and focus it directly before inserting text.
              const aisFocusRes = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                  // Visibility-aware deep shadow query — AI Studio has one ProseMirror
                  // div per conversation turn; all old turns are hidden.
                  // querySelector() returns the FIRST (hidden) one — we need LAST VISIBLE.
                  function dSQVAll(root, sel, acc) {
                    if (!root) return;
                    try {
                      for (const el of root.querySelectorAll(sel)) {
                        const r = el.getBoundingClientRect();
                        if (r.width > 5 && r.height > 5) acc.push(el);
                      }
                    } catch (_) {}
                    for (const el of root.querySelectorAll('*')) {
                      if (el.shadowRoot) dSQVAll(el.shadowRoot, sel, acc);
                    }
                  }
                  const AIS_SELS = [
                    '.ProseMirror',
                    'ms-prompt-editor [contenteditable="true"]',
                    'ms-autosize-textarea textarea',
                    'ms-prompt-input textarea',
                    'textarea[aria-label*="Prompt" i]',
                    '[contenteditable="true"][aria-multiline="true"]',
                    '[contenteditable="true"][role="textbox"]',
                    '[contenteditable="true"]',
                    'textarea',
                  ];
                  for (const sel of AIS_SELS) {
                    const hits = [];
                    dSQVAll(document, sel, hits);
                    if (hits.length > 0) {
                      const editor = hits[hits.length - 1]; // last visible = active input
                      editor.focus();
                      editor.click();
                      const r = editor.getBoundingClientRect();
                      return { found: true, tag: editor.tagName, sel,
                               cx: r.left + r.width * 0.5, cy: r.top + r.height * 0.5 };
                    }
                  }
                  return { found: false };
                }
              }).catch(() => [{ result: { found: false } }]);
              const aisRes = aisFocusRes?.[0]?.result;
              const shadowFocused = aisRes?.found;
              // Use the exact editor coordinates returned by the script if available,
              // otherwise fall back to what content.js reported.
              const aisX = aisRes?.cx ?? x;
              const aisY = aisRes?.cy ?? y;

              // Always fire a CDP coordinate click AT THE EDITOR so ProseMirror
              // activates its cursor. Without this, insertText fires but ProseMirror
              // may ignore it because it hasn't received a real mousedown event.
              await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: aisX, y: aisY, button: 'left', buttons: 1, clickCount: 1 });
              await new Promise(r => setTimeout(r, 60));
              await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: aisX, y: aisY, button: 'left', buttons: 1, clickCount: 1 });
              await new Promise(r => setTimeout(r, 200));

              if (params.clearFirst) {
                await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
                await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
                await new Promise(r => setTimeout(r, 80));
                await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
                await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
                await new Promise(r => setTimeout(r, 80));
              }
              await send('Input.insertText', { text });

              // ── Verify text actually appeared; auto-retry once via coordinate click ──
              const aisSample = text.slice(0, 20);
              if (aisSample && !(await verifyTextInPage(tabId, aisSample))) {
                await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
                await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: 1 });
                await new Promise(r => setTimeout(r, 250));
                await send('Input.insertText', { text });
                if (!(await verifyTextInPage(tabId, aisSample))) {
                  sendResponse({ success: false, error: 'Text not detected in AI Studio input after two attempts — the editor may not have accepted focus. Try clicking the prompt area first.' });
                  return;
                }
              }

              // If params.run is true, fire Ctrl+Enter to submit the prompt
              if (params.run) {
                await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 2 });
                await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 2 });
              }
              sendResponse({ success: true, data: shadowFocused ? 'Typed via shadow-piercing focus' : 'Typed via coordinate fallback' });

            } else if (isDocs) {
              // ── GOOGLE DOCS ──────────────────────────────────────────────────
              // This used to ONLY call iframe.contentDocument.body.focus() via JS
              // before typing — no real click. That's the one thing every other
              // canvas app here (Sheets, Excel) does differently: they fire a
              // genuine CDP mouse click first, because a JS .focus() moves the DOM
              // active element but does not reliably grant the renderer-level
              // input focus that Input.dispatchKeyEvent needs to route into an
              // iframe — especially once any time has passed since the user's
              // last real click (a round trip to Gemini between actions is enough).
              // That is why this worked once right after the doc loaded and then
              // failed on every later type: nothing was re-establishing real
              // focus. Fix: locate the visible editor tile and click it for real
              // via CDP first, THEN focus the iframe, THEN type.
              await send('Runtime.enable', {});
              const editorLoc = await sendR('Runtime.evaluate', {
                expression: `(function() {
                  const tile = document.querySelector('.kix-canvas-tile-content')
                             || document.querySelector('.kix-appview-editor')
                             || document.querySelector('#docs-editor');
                  if (!tile) return null;
                  const r = tile.getBoundingClientRect();
                  return { x: r.left + Math.min(150, r.width * 0.2), y: r.top + Math.min(100, r.height * 0.15) };
                })()`,
                returnByValue: true
              }).catch(() => null);
              const ex = editorLoc?.result?.value;
              if (ex && typeof ex.x === 'number' && typeof ex.y === 'number') {
                await send('Input.dispatchMouseEvent', { type: 'mousePressed',  x: ex.x, y: ex.y, button: 'left', buttons: 1, clickCount: 1 });
                await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ex.x, y: ex.y, button: 'left', buttons: 1, clickCount: 1 });
                await new Promise(r => setTimeout(r, 150));
              }
              await sendR('Runtime.evaluate', {
                expression: `(async () => {
                  const sleep = ms => new Promise(r => setTimeout(r, ms));
                  let iframe = null;
                  for (let i = 0; i < 20; i++) {
                    iframe = document.querySelector('.docs-texteventtarget-iframe');
                    if (iframe && iframe.contentDocument && iframe.contentDocument.body) break;
                    await sleep(250);
                  }
                  if (!iframe || !iframe.contentDocument) return 'no-iframe';
                  iframe.contentDocument.body.focus();
                  return 'focused';
                })()`,
                awaitPromise: true,
                returnByValue: true
              });
              await new Promise(r => setTimeout(r, 200));
              await typeChars(text);

            } else if (isExcel) {
              // ── EXCEL ONLINE ─────────────────────────────────────────────────
              // Step 1: Focus the Name Box and navigate to the requested cell.
              // params.cell lets the agent target any cell (e.g. "B3", "C10").
              // Falls back to "A1" when no cell is specified.
              const targetCell = (params.cell && /^[A-Za-z]+\d+$/.test(params.cell.trim()))
                ? params.cell.trim().toUpperCase()
                : 'A1';
              await send('Runtime.enable', {});
              await sendR('Runtime.evaluate', {
                expression: `(async () => {
                  const sleep = ms => new Promise(r => setTimeout(r, ms));
                  // Name Box selectors used across Excel Online versions
                  const nb = document.querySelector(
                    'input[aria-label="Name Box"], input#NameBox, input.nameBox, ' +
                    'input[class*="NameBox"], input[class*="nameBox"], .formulaBar input'
                  );
                  if (nb) { nb.focus(); nb.select(); return 'namebox'; }
                  return 'no-namebox';
                })()`,
                awaitPromise: true,
                returnByValue: true
              });
              await new Promise(r => setTimeout(r, 100));
              // Type the target cell address + Enter to navigate there
              for (const ch of targetCell) {
                await send('Input.dispatchKeyEvent', { type: 'char', text: ch, unmodifiedText: ch, key: ch });
              }
              await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
              await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
              await new Promise(r => setTimeout(r, 300));
              // Step 2: Click the data-area coordinate so the grid has OS focus
              await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
              await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: 1 });
              await new Promise(r => setTimeout(r, 200));
              // Step 3: Type — starting to type in Excel with a cell selected
              // automatically enters edit mode. Tab moves RIGHT (next column),
              // Enter moves DOWN (next row). typeChars handles both correctly.
              await typeChars(text);

            } else if (isGrid) {
              // ── GOOGLE SHEETS ─────────────────────────────────────────────────
              // Deterministic Name Box Navigation (spec fix):
              // Google Sheets draws cells on a WebGL/Canvas surface — guessing (x,y)
              // pixel coords fails under zoom, frozen panes, or scrolled views.
              // Instead: focus the Name Box (real DOM input), type the cell address,
              // press Enter to navigate, then use Input.insertText for the value.
              // Tab-separated values (\t = next column, \n = next row) let the agent
              // populate multi-row/column tables in a single call.
              const sheetsCell = (params.cell && /^[A-Za-z]+\d+$/.test(params.cell.trim()))
                ? params.cell.trim().toUpperCase()
                : null;

              // Navigate to target cell via Name Box (always, when cell is given)
              if (sheetsCell) {
                await send('Runtime.enable', {});
                await sendR('Runtime.evaluate', {
                  expression: `(async () => {
                    const nb = document.querySelector(
                      '#t-name-box-input, .docs-input-label-input, input[aria-label*="cell"], ' +
                      '.t-name-box-input, div.cell-input input, .goog-toolbar-combo-button input, ' +
                      'input[aria-label="Cell reference"]'
                    );
                    if (nb) { nb.focus(); nb.select(); return 'ok'; }
                    return 'no-namebox';
                  })()`,
                  awaitPromise: true,
                  returnByValue: true
                });
                await new Promise(r => setTimeout(r, 80));
                for (const ch of sheetsCell) {
                  await send('Input.dispatchKeyEvent', { type: 'char', text: ch, unmodifiedText: ch, key: ch });
                }
                await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
                await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
                await new Promise(r => setTimeout(r, 250));
              }

              // Insert text via trusted Input.insertText — avoids canvas coordinate
              // guessing entirely. Tabs/newlines in the string move columns/rows naturally.
              await send('Input.insertText', { text });

            } else if (mode === 'notebooklm' || mode === 'notebooklm-fallback') {
              // ── NOTEBOOKLM (Shadow DOM inputs) ────────────────────────────────
              // NotebookLM builds every input/textarea inside nested Shadow DOM
              // Web Components. Input.insertText only works after the element has
              // OS-level keyboard focus (not just DOM focus).
              //
              // Key fixes vs old approach:
              // 1. executeScript is now ASYNC — waits up to 600ms for a URL input
              //    dialog to appear (needed after "Websites" click which animates in).
              // 2. Returns cx/cy so we can fire mousedown at the exact element centre.
              // 3. mousedown CDP event at element coordinates transfers OS focus to
              //    shadow DOM inputs — el.focus() alone is insufficient.
              const nlFocus = await chrome.scripting.executeScript({
                target: { tabId },
                func: async (textToType) => {
                  // Visibility-aware deep shadow query
                  function dSQV(root, sel) {
                    if (!root) return null;
                    try {
                      const hits = root.querySelectorAll(sel);
                      for (const h of hits) {
                        const r = h.getBoundingClientRect();
                        if (r.width > 5 && r.height > 5) return h;
                      }
                    } catch (_) {}
                    for (const el of root.querySelectorAll('*')) {
                      if (el.shadowRoot) { const f = dSQV(el.shadowRoot, sel); if (f) return f; }
                    }
                    return null;
                  }
                  // Detect if text being typed is a URL — if so, wait exclusively for
                  // a URL input element. This prevents the retry loop from finding the
                  // always-visible query box and typing the URL into the chat instead.
                  const _textToType = textToType;
                  const _looksLikeUrl = /^https?:\/\//i.test(_textToType.trim());

                  // Real failure: NotebookLM's actual "paste multiple URLs" modal
                  // ("Website and YouTube URLs — Paste in Website and YouTube URLs
                  // below") is a resizable <textarea placeholder="Paste any links">,
                  // not an <input>. Every clause here only ever matched input tags,
                  // so the agent correctly opened the real multi-URL box and this
                  // code still could not see it — it only ever found the SINGLE-url
                  // quick-add <input> from an earlier step, which is why exactly one
                  // video landed as a source and every subsequent multi-URL paste
                  // attempt silently searched for something that was never there.
                  const NL_URL_ONLY =
                    "input[type='url'], " +
                    "input[placeholder*='links' i], input[placeholder*='url' i], " +
                    "input[placeholder*='https' i], input[placeholder*='Enter URL' i], " +
                    "input[placeholder*='website' i], input[placeholder*='link' i], " +
                    "input[aria-label*='URL' i], input[aria-label*='website' i], " +
                    "input[aria-label*='link' i], " +
                    "textarea[placeholder*='links' i], textarea[placeholder*='url' i], " +
                    "textarea[placeholder*='https' i], textarea[placeholder*='website' i], " +
                    "textarea[placeholder*='link' i], " +
                    "textarea[aria-label*='URL' i], textarea[aria-label*='website' i], " +
                    "textarea[aria-label*='link' i]";

                  const NL_FULL =
                    "[aria-label='Query box'], [aria-label='query box'], " +
                    "div[contenteditable='true'][aria-label*='query' i], " +
                    "input[type='url'], " +
                    "input[placeholder*='links' i], input[placeholder*='url' i], " +
                    "input[placeholder*='https' i], input[placeholder*='Enter URL' i], " +
                    "input[placeholder*='link' i], input[placeholder*='website' i], " +
                    "input[aria-label*='URL' i], input[aria-label*='website' i], " +
                    "input[aria-label*='link' i], " +
                    // ── Studio modal textareas (exact aria-labels from live NotebookLM) ──
                    "textarea[aria-label='Input to describe the kind of report to create'], " +
                    // Slide Deck dialog (confirmed from live UI screenshot)
                    "[aria-label='Describe the slide deck you want to create'], " +
                    "textarea[aria-label='Describe the slide deck you want to create'], " +
                    // Video Overview dialog
                    "[aria-label='Describe the video overview you want to create'], " +
                    "textarea[aria-label='Describe the video overview you want to create'], " +
                    "[aria-label='Describe the video you want to create'], " +
                    "[aria-label='Describe the data table you want to create'], " +
                    "[aria-label='Describe the infographic you want to create'], " +
                    "[aria-label='Describe the quiz you want to create'], " +
                    "[aria-label='Describe the mind map you want to create'], " +
                    "[aria-label='Describe the flashcards you want to create'], " +
                    "[aria-label='Describe the study guide you want to create'], " +
                    "textarea[aria-label='What should the AI hosts focus on in this episode?'], " +
                    "textarea[aria-label='Text area for custom topic'], " +
                    "[aria-label*='Describe' i][aria-label*='create' i], " +
                    "textarea[placeholder*='links' i], div[contenteditable='true'], textarea, input[type='text']";

                  // Phase 1 — URL mode: wait up to 1800ms for the URL input dialog.
                  // NotebookLM dialogs animate in over ~800-1200ms after "Website" click.
                  if (_looksLikeUrl) {
                    for (let attempt = 0; attempt < 12; attempt++) {
                      const el = dSQV(document, NL_URL_ONLY);
                      if (el) {
                        el.focus();
                        const r = el.getBoundingClientRect();
                        return {
                          found: true, urlInput: true,
                          tag: el.tagName,
                          ph: el.placeholder || '',
                          al: el.getAttribute('aria-label') || '',
                          isContentEditable: false,
                          cx: r.left + r.width * 0.5,
                          cy: r.top  + r.height * 0.5
                        };
                      }
                      await new Promise(r => setTimeout(r, 150));
                    }
                    // The precise URL-labelled search found nothing after 1.8s — before
                    // giving up, try the broad catch-all (any visible textarea/
                    // contenteditable) once. NotebookLM's actual wording for this box
                    // has already been wrong once (a textarea when only inputs were
                    // expected); this is a real last resort against the NEXT wording
                    // change, not a guess dressed up as a fix.
                    const fallbackEl = dSQV(document, 'textarea, div[contenteditable="true"]');
                    if (fallbackEl) {
                      fallbackEl.focus();
                      const r = fallbackEl.getBoundingClientRect();
                      return {
                        found: true, urlInput: true, viaFallback: true,
                        tag: fallbackEl.tagName,
                        ph: fallbackEl.placeholder || '',
                        al: fallbackEl.getAttribute('aria-label') || '',
                        isContentEditable: fallbackEl.getAttribute('contenteditable') === 'true',
                        cx: r.left + r.width * 0.5,
                        cy: r.top  + r.height * 0.5
                      };
                    }
                    // URL input dialog never appeared — signal clearly so background.js
                    // can return a helpful error instead of typing into the query box.
                    return { found: false, urlDialogMissing: true };
                  }

                  // Phase 2 — non-URL text (query, Studio instructions, etc.):
                  // use the full selector list and wait up to 1800ms.
                  const NL = NL_FULL;
                  for (let attempt = 0; attempt < 12; attempt++) {
                    const el = dSQV(document, NL);
                    if (el) {
                      el.focus();
                      const r = el.getBoundingClientRect();
                      return {
                        found: true,
                        tag: el.tagName,
                        ph: el.placeholder || '',
                        al: el.getAttribute('aria-label') || '',
                        isContentEditable: el.contentEditable === 'true' || el.getAttribute('contenteditable') === 'true',
                        cx: r.left + r.width * 0.5,
                        cy: r.top  + r.height * 0.5
                      };
                    }
                    await new Promise(r => setTimeout(r, 150));
                  }
                  return { found: false };
                },
                args: [text]
              }).catch(() => [{ result: { found: false } }]);

              const nlRes = nlFocus?.[0]?.result;

              // If we were typing a URL but the URL input dialog never appeared,
              // stop now with a clear error — don't fire into the chat query box.
              if (nlRes?.urlDialogMissing) {
                sendResponse({ success: false, error: 'URL input dialog not found after 1800ms. Click "Website" (singular) inside the "Add sources" dialog first to open the URL input, then call type again.' });
                return;
              }

              // Always fire a mousedown at the element's exact center to transfer
              // OS keyboard focus. el.focus() alone does NOT move OS focus for
              // elements inside Shadow DOM — the tab needs a real mouse event.
              const nlX = nlRes?.cx ?? x;
              const nlY = nlRes?.cy ?? y;
              await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: nlX, y: nlY, button: 'left', buttons: 1, clickCount: 1 });
              await new Promise(r => setTimeout(r, 60));
              await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: nlX, y: nlY, button: 'left', buttons: 1, clickCount: 1 });
              await new Promise(r => setTimeout(r, 200)); // let shadow DOM focus settle

              await send('Input.insertText', { text });

              // ── React/Lit/Angular event dispatch (Fix: "Insert button stays grey") ──
              // NotebookLM is a Lit + Angular app. Input.insertText writes bytes into
              // the OS input buffer but does NOT fire synthetic framework events.
              // Without input + change + blur events the framework's internal state
              // never updates — the "Insert" / "Generate" button stays disabled.
              // We use Runtime.evaluate (CDP, no round-trip to scripting API) and
              // walk shadowRoot.activeElement recursively to reach the deepest focused
              // element, then fire events with composed:true so they cross boundaries.
              await send('Runtime.evaluate', {
                expression: `(function() {
                  let el = document.activeElement;
                  while (el && el.shadowRoot && el.shadowRoot.activeElement) {
                    el = el.shadowRoot.activeElement;
                  }
                  if (!el) return false;
                  const cfg = { bubbles: true, composed: true, cancelable: true };
                  ['input', 'change', 'blur'].forEach(type => {
                    el.dispatchEvent(new Event(type, cfg));
                    const host = el.getRootNode && el.getRootNode().host;
                    if (host) host.dispatchEvent(new Event(type, cfg));
                  });
                  return true;
                })()`,
                returnByValue: true
              }).catch(() => {});

              // Verify text actually landed — NotebookLM's Shadow DOM focus can
              // silently fail if a modal just opened and focus hasn't settled yet.
              const nlSample = text.slice(0, 20);
              if (nlSample && !(await verifyTextInPage(tabId, nlSample))) {
                // Retry: coordinate click to force focus then re-insert
                await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: nlX, y: nlY, button: 'left', buttons: 1, clickCount: 1 });
                await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: nlX, y: nlY, button: 'left', buttons: 1, clickCount: 1 });
                await new Promise(r => setTimeout(r, 300));
                await send('Input.insertText', { text });
                // Fire framework events again after retry insert
                await send('Runtime.evaluate', {
                  expression: `(function() {
                    let el = document.activeElement;
                    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
                      el = el.shadowRoot.activeElement;
                    }
                    if (!el) return false;
                    const cfg = { bubbles: true, composed: true, cancelable: true };
                    ['input', 'change', 'blur'].forEach(type => {
                      el.dispatchEvent(new Event(type, cfg));
                      const host = el.getRootNode && el.getRootNode().host;
                      if (host) host.dispatchEvent(new Event(type, cfg));
                    });
                    return true;
                  })()`,
                  returnByValue: true
                }).catch(() => {});
                if (!(await verifyTextInPage(tabId, nlSample))) {
                  sendResponse({ success: false, error: 'Text did not appear in NotebookLM input after two attempts. The target input may not be open yet — try clicking the button that opens it first.' });
                  return;
                }
              }

              // Auto-click "Insert" for the URL box — do NOT leave this to the
              // model's next turn. It was told, in writing, in the system
              // prompt, "click Insert, not Add sources" — and clicked
              // "Add sources" anyway, live, twice in a row, discarding the
              // URLs it had just correctly typed both times. Remembering one
              // exact button name several turns after reading it is not
              // reliable enough to depend on here. Since this code already
              // knows for certain it just typed into the real URL box
              // (nlRes.urlInput), it finds and clicks "Insert" itself, in the
              // same action, instead of hoping the next model turn gets it
              // right. Only runs for the URL box — the chat query box and
              // Studio textareas below use params.run/Enter instead, which
              // already works and is left alone.
              if (nlRes?.urlInput) {
                await new Promise(r => setTimeout(r, 250)); // let the Insert button's disabled state update
                const insertLoc = await chrome.scripting.executeScript({
                  target: { tabId },
                  func: () => {
                    function findInsertBtn(root) {
                      if (!root) return null;
                      try {
                        for (const el of root.querySelectorAll('button, [role="button"]')) {
                          const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
                          if (/^insert$/i.test(label) && !el.disabled && el.getAttribute('aria-disabled') !== 'true') {
                            const r = el.getBoundingClientRect();
                            if (r.width > 0 && r.height > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                          }
                        }
                      } catch (_) {}
                      for (const el of root.querySelectorAll('*')) {
                        if (el.shadowRoot) { const f = findInsertBtn(el.shadowRoot); if (f) return f; }
                      }
                      return null;
                    }
                    return findInsertBtn(document);
                  }
                }).catch(() => [{ result: null }]);
                const insertXY = insertLoc?.[0]?.result;
                if (insertXY) {
                  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: insertXY.x, y: insertXY.y, button: 'left', buttons: 1, clickCount: 1 });
                  await new Promise(r => setTimeout(r, 60));
                  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: insertXY.x, y: insertXY.y, button: 'left', buttons: 1, clickCount: 1 });
                  sendResponse({ success: true, data: `NotebookLM URL(s) typed and Insert clicked automatically` });
                  return;
                }
                // Insert button not found/enabled — text is still safely typed
                // (verified above), just tell the model plainly instead of
                // silently leaving it unsubmitted.
                sendResponse({ success: true, data: `URL(s) typed into NotebookLM's source box but the "Insert" button could not be found or is still disabled — call snapshotPage to find it and click it by index. Do NOT click "Add sources" to submit this, that reopens the source-type picker instead.` });
                return;
              }

              // Submit if requested: Enter sends the query in the chat box;
              // for Studio modal textareas use params.run to also click Generate.
              if (params.run) {
                await new Promise(r => setTimeout(r, 150));
                await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
                await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
              }

              sendResponse({ success: true, data: `NotebookLM ${nlRes?.found ? `${nlRes.tag} "${nlRes.al || nlRes.ph}"` : 'coordinate fallback'}${params.run ? ' + submitted' : ''}` });

            } else if (isSlides) {
              // ── GOOGLE SLIDES (canvas typing stop condition) ──────────────────
              // Slides renders text boxes via a WebGL/SVG layer. CDP Input.insertText
              // sometimes lands when a text box is properly focused after a click,
              // but often silently misses because the canvas renderer never routes
              // keyboard events through the DOM. Strategy:
              //   1. Click the coord to give the canvas text layer OS focus
              //   2. Attempt Input.insertText once
              //   3. Wait 500ms and query the AX tree for the typed text
              //   4. If found → success; if not → return CANVAS_TYPING_LIMITATION
              //      so the agent immediately calls requestUserIntervention instead
              //      of looping through more failed type attempts.
              await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
              await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: 1 });
              await new Promise(r => setTimeout(r, 300)); // let canvas focus settle
              await send('Input.insertText', { text });
              await new Promise(r => setTimeout(r, 500)); // let renderer process

              // Verify: ask AX tree if any node now contains our text
              let slidesTextVerified = false;
              try {
                const axRes = await send('Accessibility.queryAXTree', {
                  accessibleName: text.slice(0, 30) // check first 30 chars
                }).catch(() => null);
                slidesTextVerified = (axRes?.nodes?.length > 0);
              } catch (_) {}

              if (slidesTextVerified) {
                sendResponse({ success: true, data: 'Typed into Google Slides text box (AX verified)' });
              } else {
                // Text did not land — the canvas renderer silently ignored it.
                // Return a specific error so the agent stops and asks for help.
                sendResponse({
                  success: false,
                  error: 'CANVAS_TYPING_LIMITATION: Google Slides uses a WebGL/canvas renderer. ' +
                    'CDP text injection was attempted but the text did not appear in the presentation. ' +
                    'You MUST stop retrying type() and instead: ' +
                    '(1) call requestUserIntervention() asking the user to click the text box and type manually, OR ' +
                    '(2) use pressKey() to send individual characters one at a time as a last resort. ' +
                    'Do NOT call type() again — it will produce the same result.'
                });
              }
              return;

            } else {
              // ── WORD ONLINE / other canvas apps ──────────────────────────────
              // Word Online wraps documents inside cross-origin WAC frames
              // (.WACViewPanel). Top-level content scripts can't reach inside, so we
              // use allFrames:true to focus the contenteditable edit area, then
              // Input.insertText for reliable trusted-event text insertion.
              const isWordOnline = tabHostname.includes('word.office.com')
                || tabHostname.includes('word.live.com')
                || tabHostname.includes('sharepoint.com')
                || tabHostname.includes('cloud.microsoft')
                || tabHostname.includes('microsoft365.com')
                || tabHostname.includes('office365.com');

              if (isWordOnline) {
                await chrome.scripting.executeScript({
                  target: { tabId, allFrames: true },
                  func: () => {
                    // WAC frame selectors — try most specific first
                    const el = document.querySelector(
                      '.WACViewPanel [contenteditable="true"], ' +
                      '[class*="EditArea"] [contenteditable="true"], ' +
                      'div[contenteditable="true"][class*="Word"], ' +
                      'div[contenteditable="true"]'
                    );
                    if (el) { el.focus(); return true; }
                    return false;
                  }
                }).catch(() => {});
                await new Promise(r => setTimeout(r, 150));
                await send('Input.insertText', { text });
                // Word Online / Office: blur+focus toggle wakes the auto-save state
                // machine and triggers framework change-detection listeners.
                await send('Runtime.evaluate', {
                  expression: `(function() {
                    let el = document.activeElement;
                    while (el && el.shadowRoot && el.shadowRoot.activeElement) { el = el.shadowRoot.activeElement; }
                    if (!el) return false;
                    const cfg = { bubbles: true, composed: true, cancelable: true };
                    ['input', 'change'].forEach(t => el.dispatchEvent(new Event(t, cfg)));
                    el.blur(); el.focus();
                    return true;
                  })()`,
                  returnByValue: true
                }).catch(() => {});
              } else {
                // Generic canvas / unknown app — CDP coordinate click then char-by-char
                await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
                await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: 1 });
                await new Promise(r => setTimeout(r, 200));
                await typeChars(text);
                // Generic fallback: also force framework sync after char-by-char typing
                await send('Runtime.evaluate', {
                  expression: `(function() {
                    let el = document.activeElement;
                    while (el && el.shadowRoot && el.shadowRoot.activeElement) { el = el.shadowRoot.activeElement; }
                    if (!el) return false;
                    const cfg = { bubbles: true, composed: true, cancelable: true };
                    ['input', 'change'].forEach(t => el.dispatchEvent(new Event(t, cfg)));
                    return true;
                  })()`,
                  returnByValue: true
                }).catch(() => {});
              }
            }

            // Sheets / Excel: press Enter to COMMIT the cell value.
            if ((isGrid || isExcel) && params.pressEnter !== false) {
              await new Promise(r => setTimeout(r, 100));
              await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
              await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
            }

            // ── Sheets/Excel: verify text actually landed ─────────────────────
            // Read the Formula Bar after commit. If we typed something non-empty
            // but the bar shows nothing, the events were silently ignored —
            // return false so the brain retries instead of building on a lie.
            if ((isGrid || isExcel) && text.trim().length > 0) {
              try {
                await new Promise(r => setTimeout(r, 300)); // let cell update
                const verifyExpr = isGrid
                  ? `document.querySelector('#t-formula-bar-input-container input, [id*="formula-bar"] input, .cell-display')?.value || ''`
                  : `document.querySelector('[data-automation-id="formulaBarInput"]')?.textContent?.trim() || document.querySelector('[data-automation-id="formulaBarInput"] input')?.value || ''`;
                const vr = await sendR('Runtime.evaluate', { expression: verifyExpr, returnByValue: true });
                const barVal = (vr?.result?.value || '').trim();
                if (barVal.length === 0) {
                  sendResponse({ success: false, error: 'Formula Bar is empty after typing — cell did not receive input. Call goToCell first to focus the target cell, then type.' });
                  return;
                }
              } catch (_) { /* verification optional — network/DOM issue, proceed as success */ }
            }

            // ── SPA / AIS / Word / generic: verify field received the text ────
            // Sheets & Excel are already verified above via Formula Bar.
            // Docs uses a canvas renderer — no DOM field to read — so we skip it.
            // NotebookLM is already handled above (Shadow DOM path) — skip here.
            // For everything else: after a short React-settle pause, check the
            // active element is non-empty. If it's empty, the focus was lost and
            // Input.insertText fired into the void — return false so the agent
            // can refocus and retry instead of building on a silent miss.
            const isNotebookLM = (mode === 'notebooklm' || mode === 'notebooklm-fallback');
            if (!isDocs && !isGrid && !isExcel && !isNotebookLM && !isAiStudio && text.trim().length > 0 && !params.run) {
              try {
                await new Promise(r => setTimeout(r, 180)); // React state settle
                const vr = await sendR('Runtime.evaluate', {
                  // Shadow DOM apps (e.g. AI Studio) keep keyboard focus inside a
                  // shadow root, so document.activeElement returns the shadow HOST,
                  // whose .value is always empty. Pierce shadow roots recursively
                  // to find the actual focused element before reading its value.
                  expression: `(()=>{
                    function getDeepActive(el) {
                      while (el && el.shadowRoot && el.shadowRoot.activeElement)
                        el = el.shadowRoot.activeElement;
                      return el;
                    }
                    const el = getDeepActive(document.activeElement);
                    if (!el || el === document.body) return 'no-focus';
                    const val = (el.value ?? el.innerText ?? el.textContent ?? '').trim();
                    return val.length > 0 ? 'ok' : 'empty';
                  })()`,
                  returnByValue: true,
                  timeout: 3000
                });
                const state = vr?.result?.value || '';
                if (state === 'empty') {
                  sendResponse({ success: false,
                    error: 'Field is empty after typing — focus may have been lost. ' +
                           'Click the target element first (or use waitForElement to ' +
                           'confirm it exists), then call type again.' });
                  return;
                }
                if (state === 'no-focus') {
                  sendResponse({ success: false,
                    error: 'No focused element found after typing — document.body has focus. ' +
                           'The textarea or input was never activated. Click it first.' });
                  return;
                }
              } catch (_) { /* verification optional — don't break on CDP quirks */ }
            }

            sendResponse({ success: true });
          } finally {
            if (session) session.release();
          }
        } catch (e) {
          console.warn('[Aion Agent] CDP type failed, using paste fallback:', e && e.message);
          runFallbackType();
        }
      })();
      return true;
    }
    if (executeAction === 'click') {
      // ── S5 helper: Vision Fallback ────────────────────────────────────────────
      // Called when every DOM/AX/XPath strategy has failed.
      // Captures the current tab screenshot, sends it to Gemini Vision with a
      // tight prompt, and parses back {x,y} center coordinates for the target.
      // Returns null on any failure so the caller can fall through gracefully.
      async function visionFindCoordinates(tId, targetLabel) {
        if (!targetLabel) return null;
        // 1. Get API key
        const { geminiApiKey } = await chrome.storage.sync.get(['geminiApiKey']);
        if (!geminiApiKey) return null;

        // 2. Screenshot the tab (must be focused — session is still active here)
        let dataUrl;
        try {
          const tabInfo = await chrome.tabs.get(tId);
          dataUrl = await chrome.tabs.captureVisibleTab(tabInfo.windowId, { format: 'jpeg', quality: 80 });
        } catch (_) { return null; }
        if (!dataUrl) return null;

        // Strip the "data:image/jpeg;base64," prefix
        const base64 = dataUrl.split(',')[1];
        if (!base64) return null;

        // 3. Ask Gemini Vision for center pixel coordinates
        // We use a zero-temperature, single-sentence response format so the
        // model can't ramble. The prompt explicitly states the output contract.
        const prompt = `You are a precise UI element locator for browser automation.
Look at this screenshot of a web page.
Find the clickable element that best matches this description: "${targetLabel.replace(/"/g, "'")}"
Return ONLY a valid JSON object on a single line — no markdown, no explanation:
{"x": <center_x_integer>, "y": <center_y_integer>}
If the element is not visible in the screenshot, return:
{"x": null, "y": null}`;

        let resp;
        try {
          resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  parts: [
                    { inlineData: { mimeType: 'image/jpeg', data: base64 } },
                    { text: prompt }
                  ]
                }],
                generationConfig: { temperature: 0, maxOutputTokens: 64 }
              }),
              signal: AbortSignal.timeout(12000)
            }
          );
        } catch (_) { return null; }

        if (!resp.ok) return null;
        const json = await resp.json().catch(() => null);
        const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // 4. Parse JSON out of the response (strip any accidental markdown fences)
        const cleaned = raw.replace(/```[a-z]*\n?/gi, '').trim();
        let coords;
        try { coords = JSON.parse(cleaned); } catch (_) {
          // Try to extract with regex as last resort
          const m = cleaned.match(/"x"\s*:\s*(\d+).*?"y"\s*:\s*(\d+)/s);
          if (m) coords = { x: parseInt(m[1], 10), y: parseInt(m[2], 10) };
        }
        if (!coords || coords.x == null || coords.y == null) return null;
        console.log(`[Aion Vision] Found "${targetLabel}" at (${coords.x}, ${coords.y})`);
        return { x: coords.x, y: coords.y };
      }

      // CDP-first click pipeline:
      //   1. content.js DOM/text search  → finds x,y  → CDP trusted mouse click
      //   2. If not found               → CDP Accessibility.queryAXTree by visible label
      //                                  → DOM.getBoxModel for coords → CDP click
      //   3. If CDP unavailable         → content.js synthetic click (fallback)
      //
      // Accessibility.queryAXTree is the wow-factor: it finds ANY element by what
      // the user sees (its accessible name), even inside iframes and shadow DOM,
      // without needing CSS selectors. Perfect for Word Online ribbon, Excel menus, etc.
      (async () => {
        // ── helpers ──────────────────────────────────────────────────────────
        const fallbackSynthetic = () => {
          chrome.tabs.sendMessage(tabId, { action: 'agentExecute', executeAction, params }, (r) => {
            if (chrome.runtime.lastError) {
              clearAndInject(tabId)
                .then(() => chrome.tabs.sendMessage(tabId, { action: 'agentExecute', executeAction, params }, sendResponse))
                .catch(e => sendResponse({ success: false, error: e.message }));
            } else { sendResponse(r); }
          });
        };

        const locateViaContent = () => new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { action: 'agentExecute', executeAction: 'locateForClick', params }, (r) => {
            if (chrome.runtime.lastError || !r || !r.success) resolve(null);
            else resolve(r);
          });
        });

        // ── Step 0: Integer index resolution (zero-fallback fast path) ────────
        // If the agent supplied an element index from the INTERACTIVE ELEMENTS
        // list, resolve it directly through the content script's live element
        // map and click immediately — no text search, no AXTree, no retries.
        if (params.index != null) {
          const idxLoc = await new Promise(resolve => {
            chrome.tabs.sendMessage(tabId, {
              action: 'agentExecute',
              executeAction: 'resolveByIndex',
              params: { index: params.index }
            }, r => resolve(chrome.runtime.lastError ? null : r));
          }).catch(() => null);

          if (idxLoc?.success && typeof idxLoc.x === 'number') {
            console.log(`[Aion Agent] Index [${params.index}] resolved → (${idxLoc.x.toFixed(0)}, ${idxLoc.y.toFixed(0)})`);
            let idxSession;
            try {
              idxSession = await cdpPool.acquire(tabId);
              const jx = jitter(idxLoc.x), jy = jitter(idxLoc.y);
              const base = { x: jx, y: jy, button: 'left', buttons: 1, clickCount: 1 };
              await idxSession.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
              await new Promise(r => setTimeout(r, 40 + Math.random() * 30));
              await idxSession.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
              sendResponse({ success: true, data: `Clicked via element index [${params.index}]` });
              return;
            } catch (e) {
              console.warn('[Aion Agent] Index click failed, falling through to text search:', e?.message);
            } finally {
              if (idxSession) idxSession.release();
            }
          }
          // Index miss (element scrolled off viewport, DOM changed) — fall through
          console.log(`[Aion Agent] Index [${params.index}] not resolved, falling back to text search`);
        }

        // ── Step 0.5: reject a click with NOTHING to search by ──────────────
        // Rule lives in agent-logic-core.js as hasSearchTarget — see there for
        // the real failure that motivated it, and tests/agent-logic.test.js
        // for the check. Fail fast and cheaply instead of burning DOM search,
        // Accessibility tree, XPath, AND a real paid Gemini Vision API call on
        // a call that was doomed from the start.
        if (!hasSearchTarget(params)) {
          sendResponse({ success: false, error:
            'click was called with no index, text, description, or selector — nothing to search for. ' +
            'Look at the most recent INTERACTIVE ELEMENTS list from snapshotPage or a prior error and click by index, e.g. click({index:5}).' });
          return;
        }

        // ── Step 1: DOM text search via content.js (500 ms budget) ──────────
        // Race the DOM locate against a 500 ms timeout. 300 ms was too tight on
        // heavy SPAs (Google AI Studio, Grok, React apps) — the content-script
        // injection + DOM walk can take 400–600 ms on first load, causing a
        // premature AXTree fallback that adds another 200–300 ms. 500 ms gives
        // content.js enough room to finish on a single try, making the happy
        // path faster overall while still bounding the worst case tightly.
        let loc = null;
        const domRace = async () => {
          const domPromise = locateViaContent();
          const timeoutPromise = new Promise(resolve => setTimeout(() => resolve('timeout'), 500));
          const result = await Promise.race([domPromise, timeoutPromise]);
          if (result === 'timeout' || !result) {
            console.log('[Aion Agent] DOM locate timed out or empty — engaging AXTree eyes…');
            return null;
          }
          return result;
        };
        try { loc = await domRace(); } catch (_) {}
        if (!loc) {
          // Re-inject content script once and retry with the same 500 ms budget
          try { await clearAndInject(tabId); loc = await domRace(); } catch (_) {}
        }

        let session;
        try {
          session = await cdpPool.acquire(tabId);
        } catch (_) {
          // DevTools open / attach failed — fall straight to synthetic
          fallbackSynthetic();
          return;
        }

        const cdpCmd = session.send;

        const cdpMouseClick = async (x, y) => {
          // Pattern 3 — Proactive overlay dismissal (browser-use watchdog pattern):
          // Before clicking, check whether the target coordinates are obscured by a
          // high-z-index fixed overlay (cookie banner, newsletter gate, modal).
          // If found, auto-click its close button and wait for the animation.
          try {
            const overlayDismissed = await cdpCmd('Runtime.evaluate', {
              expression: `(() => {
                const topEl = document.elementFromPoint(${x}, ${y});
                if (!topEl) return false;
                let cur = topEl;
                while (cur && cur !== document.body) {
                  const s = window.getComputedStyle(cur);
                  const z = parseInt(s.zIndex, 10);
                  if ((s.position === 'fixed' || s.position === 'absolute') &&
                      z > 100 && cur.offsetHeight > window.innerHeight * 0.3) {
                    const closeSel = [
                      'button[aria-label*="close" i]','button[class*="close" i]',
                      '[id*="close" i]','.close-btn','.modal-close'
                    ].join(',');
                    const btn = cur.querySelector(closeSel) ||
                      Array.from(cur.querySelectorAll('button,span,a')).find(el =>
                        /^(close|dismiss|✕|×|hide|cancel)$/i.test((el.innerText||'').trim())
                      );
                    if (btn) { btn.click(); return true; }
                  }
                  cur = cur.parentElement;
                }
                return false;
              })()`,
              returnByValue: true
            }).catch(() => ({ result: { value: false } }));
            if (overlayDismissed?.result?.value === true) {
              console.log('[Aion Watchdog] Dismissed blocking overlay before click');
              await new Promise(r => setTimeout(r, 300)); // let overlay animate out
            }
          } catch (_) {}

          // Apply ±2 px jitter — makes pointer events indistinguishable from a
          // real mouse, avoids bot-detection on exact-integer centroid coordinates.
          const jx = jitter(x), jy = jitter(y);
          const base = { x: jx, y: jy, button: 'left', buttons: 1, clickCount: 1 };

          // ── Pointer events (Angular/Lit/Material fix) ───────────────────────
          // CDP Input.dispatchMouseEvent only fires mousedown/mouseup — it does
          // NOT fire pointerdown/pointerup. Google's Angular/Lit Web Components
          // (NotebookLM buttons, AI Studio toolbar, Google Workspace ribbon) only
          // listen to pointer events, so the button highlights but NEVER fires.
          //
          // CRITICAL FIX — two issues with the old approach:
          // 1. document.elementFromPoint() cannot pierce Shadow DOM — it returns
          //    the outer shadow HOST, so events fire on the wrapper, not the button.
          // 2. Events without composed:true are stopped at shadow boundaries and
          //    never reach framework listeners on the host element.
          //
          // Fix: deepElAt() recursively walks shadowRoot.elementFromPoint() to find
          // the actual inner element. Events are fired with composed:true so they
          // bubble through shadow boundaries. We also fire on the closest clickable
          // ancestor to catch Angular/Lit host-level listeners.
          const ptrExpr = (evtType) => `(() => {
            function deepElAt(root, x, y) {
              let el = root.elementFromPoint ? root.elementFromPoint(x, y) : null;
              if (!el) return null;
              for (let i = 0; i < 12; i++) {
                if (!el.shadowRoot) break;
                const inner = el.shadowRoot.elementFromPoint(x, y);
                if (!inner || inner === el) break;
                el = inner;
              }
              return el;
            }
            const el = deepElAt(document, ${jx}, ${jy});
            if (!el) return false;
            const opts = {
              bubbles: true, cancelable: true, composed: true,
              clientX: ${jx}, clientY: ${jy},
              screenX: ${jx}, screenY: ${jy},
              pointerId: 1, pointerType: 'mouse', isPrimary: true,
              buttons: 1, button: 0
            };
            // Fire on deepest element AND closest clickable ancestor so both
            // the inner button and Angular/Lit host-level listeners receive it.
            el.dispatchEvent(new PointerEvent(${JSON.stringify(evtType)}, opts));
            const btn = el.closest('button,[role="button"],a,[role="link"],[role="menuitem"],[role="option"],[role="tab"]');
            if (btn && btn !== el) btn.dispatchEvent(new PointerEvent(${JSON.stringify(evtType)}, opts));
            return true;
          })()`;

          await cdpCmd('Runtime.evaluate', { expression: ptrExpr('pointerdown'), returnByValue: true }).catch(() => {});
          await cdpCmd('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
          // Human pacing: 80–150 ms between press and release.
          await new Promise(r => setTimeout(r, 80 + Math.random() * 70));
          await cdpCmd('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
          await cdpCmd('Runtime.evaluate', { expression: ptrExpr('pointerup'),   returnByValue: true }).catch(() => {});

          // Synthetic click event — ensures React onClick and Angular (click)
          // bindings fire even if they missed the pointer/mouse sequence above.
          // Also uses deep shadow pierce + composed:true.
          await cdpCmd('Runtime.evaluate', {
            expression: `(() => {
              function deepElAt(root, x, y) {
                let el = root.elementFromPoint ? root.elementFromPoint(x, y) : null;
                if (!el) return null;
                for (let i = 0; i < 12; i++) {
                  if (!el.shadowRoot) break;
                  const inner = el.shadowRoot.elementFromPoint(x, y);
                  if (!inner || inner === el) break;
                  el = inner;
                }
                return el;
              }
              const el = deepElAt(document, ${jx}, ${jy});
              if (!el) return false;
              const opts = { bubbles: true, cancelable: true, composed: true, clientX: ${jx}, clientY: ${jy}, button: 0, buttons: 0 };
              el.dispatchEvent(new MouseEvent('click', opts));
              const btn = el.closest('button,[role="button"],a,[role="link"],[role="menuitem"],[role="option"],[role="tab"]');
              if (btn && btn !== el) btn.dispatchEvent(new MouseEvent('click', opts));
              return true;
            })()`,
            returnByValue: true
          }).catch(() => {});
        };

         // ── DOM mutation watch helpers ────────────────────────────────────────
         // Arms a MutationObserver before any click to verify something actually
         // changed. If nothing mutates, smartClick auto-retries with a direct
         // shadow-piercing DOM .click() — fixes Angular/Lit buttons that swallow
         // CDP pointer events silently.
         const armMutations = async () => {
           await cdpCmd('Runtime.evaluate', {
             expression: `(function(){
               window.__aionMutCt = 0;
               if (window.__aionMutObs2) window.__aionMutObs2.disconnect();
               window.__aionMutObs2 = new MutationObserver(function(m){ window.__aionMutCt += m.length; });
               window.__aionMutObs2.observe(document.documentElement,
                 { childList:true, subtree:true, attributes:true, characterData:true });
             })()`,
             returnByValue: true
           }).catch(() => {});
         };

         const checkMutations = async () => {
           const res = await cdpCmd('Runtime.evaluate', {
             expression: `(function(){
               if(window.__aionMutObs2){window.__aionMutObs2.disconnect();window.__aionMutObs2=null;}
               return window.__aionMutCt || 0;
             })()`,
             returnByValue: true
           }).catch(() => ({ result: { value: 1 } }));
           return (res?.result?.value || 0) > 0;
         };

         // smartClick — wraps cdpMouseClick with mutation verification.
         // If the click lands but nothing changes, retries with a shadow-piercing
         // direct DOM .click(). Also waits for any new dialog to settle.
         const smartClick = async (cx, cy) => {
           await armMutations();
           await cdpMouseClick(cx, cy);
           await new Promise(r => setTimeout(r, 500));
           const mutated = await checkMutations();
           if (!mutated) {
             console.log(`[Aion] Click at (${cx},${cy}) had no DOM effect — retrying with shadow-piercing .click()`);
             await cdpCmd('Runtime.evaluate', {
               expression: `(function(){
                 let el = document.elementFromPoint(${cx}, ${cy});
                 if (!el) return false;
                 for (let i = 0; i < 8; i++) {
                   if (!el.shadowRoot) break;
                   const inner = el.shadowRoot.elementFromPoint(${cx}, ${cy});
                   if (!inner || inner === el) break;
                   el = inner;
                 }
                 const btn = el.closest(
                   'button,[role="button"],a,[role="link"],[role="menuitem"],' +
                   '[role="option"],[role="tab"],[role="checkbox"],[role="switch"]'
                 ) || el;
                 btn.focus();
                 btn.click();
                 btn.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,clientX:${cx},clientY:${cy},pointerId:1,isPrimary:true}));
                 btn.dispatchEvent(new PointerEvent('pointerup',  {bubbles:true,cancelable:true,clientX:${cx},clientY:${cy},pointerId:1,isPrimary:true}));
                 return true;
               })()`,
               returnByValue: true
             }).catch(() => {});
             await new Promise(r => setTimeout(r, 300));
           }
           // Wait for any newly-opened dialog/modal to settle
           const dRes = await cdpCmd('Runtime.evaluate', {
             expression: `(function(){
               const d = document.querySelector(
                 '[role="dialog"],[aria-modal="true"],[data-state="open"],' +
                 '.mat-dialog-container,dialog[open],.cdk-overlay-pane');
               return !!d;
             })()`,
             returnByValue: true
           }).catch(() => ({ result: { value: false } }));
           if (dRes?.result?.value === true) await new Promise(r => setTimeout(r, 420));
         };

         // ── Per-site click memory ─────────────────────────────────────────────
         // Remembers the (cx,cy,strategy) that worked for a given (hostname,label).
         // Next run tries the remembered position first, skipping the full cascade.
         // Entries expire after 7 days.
         const _cmKey = (lbl) =>
           `aion_cm_${tabHostname}__${(lbl||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').slice(0,40)}`;

         const loadClickMem = async (lbl) => {
           if (!lbl) return null;
           try {
             const r = await chrome.storage.local.get(_cmKey(lbl));
             const m = r[_cmKey(lbl)];
             if (m && m.cx && m.cy && (Date.now() - m.ts < 7 * 86400000)) return m;
           } catch (_) {}
           return null;
         };

         const saveClickMem = async (lbl, cx, cy, strategy) => {
           if (!lbl) return;
           try { await chrome.storage.local.set({ [_cmKey(lbl)]: { cx, cy, strategy, ts: Date.now() } }); } catch (_) {}
         };


        try {
          if (loc && typeof loc.x === 'number') {
            // Content.js found it — click using trusted CDP events
            await smartClick(loc.x, loc.y);
            sendResponse({ success: true, data: 'Clicked via content.js loc' });
            return;
          }

          // ── Step 1b: Selector cascade expansion (Pattern 2 / S2) ───────────
          // If a selector was given, also probe stable data-attributes that survive
          // DOM refactors — data-testid, data-id, and bare ID before hitting AXTree.
          if (params.selector) {
            const rawSel = params.selector.replace(/^[#.]/, '');
            const selectorsToTry = [
              params.selector,
              `[data-testid="${rawSel}"]`,
              `[data-id="${rawSel}"]`,
              `#${rawSel}`
            ];
            for (const sel of selectorsToTry) {
              const box = await getBoxModelBySelector(sel, cdpCmd).catch(() => null);
              if (box) {
                await smartClick(box.x, box.y);
                sendResponse({ success: true, data: `Clicked via selector cascade (${sel})` });
                return;
              }
            }
          }

          // ── Step 1c: NotebookLM shadow DOM button finder ───────────────────
          // NotebookLM buttons (Add source, Websites, Insert, Studio panel
          // buttons) live inside nested Shadow DOM Web Components. The AX tree
          // (step 2) reaches them but DOM.getBoxModel sometimes fails because
          // shadow-DOM backendDOMNodeIds are not always resolvable cross-context.
          // This step walks all shadow roots directly in JS, finds the button
          // by textContent / aria-label match, and clicks it — before any AX/CDP
          // coordinate cascade. Runs ONLY for NotebookLM to stay surgical.
          const searchLabel = (params.text || params.description || '').trim();
          if (searchLabel && (tabHostname.includes('notebooklm.google.com') || tabHostname.includes('notebook.google.com'))) {
            try {
              const nlShadowRes = await cdpCmd('Runtime.evaluate', {
                expression: `(function() {
                  const query = ${JSON.stringify(searchLabel.toLowerCase())};
                  function findInShadow(root) {
                    const CLICKABLE = 'button,[role="button"],[role="option"],[role="menuitem"],[role="tab"],[role="listitem"],a';
                    try {
                      const els = root.querySelectorAll(CLICKABLE);
                      for (const el of els) {
                        const txt = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).trim().toLowerCase();
                        if (txt.includes(query) || query.includes(txt.replace(/\\s+/g,' ').trim().slice(0, 20))) {
                          const r = el.getBoundingClientRect();
                          if (r.width > 0 && r.height > 0 && r.top > 0 && r.top < window.innerHeight) {
                            return { x: r.left + r.width / 2, y: r.top + r.height / 2, txt: txt.slice(0, 40) };
                          }
                        }
                      }
                    } catch (_) {}
                    for (const el of root.querySelectorAll('*')) {
                      if (el.shadowRoot) {
                        const f = findInShadow(el.shadowRoot);
                        if (f) return f;
                      }
                    }
                    return null;
                  }
                  return findInShadow(document);
                })()`,
                returnByValue: true
              }).catch(() => null);
              const nlCoords = nlShadowRes?.result?.value;
              if (nlCoords?.x) {
                console.log(`[Aion] NotebookLM shadow finder: "${nlCoords.txt}" at (${nlCoords.x},${nlCoords.y})`);
                await smartClick(nlCoords.x, nlCoords.y);
                await saveClickMem(searchLabel, nlCoords.x, nlCoords.y, 'nl-shadow');
                sendResponse({ success: true, data: `Clicked via NotebookLM shadow DOM button finder` });
                return;
              }
            } catch (_nlShadow) {}
          }

           // Memory-first: try remembered coords before full AX cascade
           if (searchLabel) {
             const mem = await loadClickMem(searchLabel);
             if (mem) {
               console.log(`[Aion] Memory hit for "${searchLabel}" at (${mem.cx},${mem.cy}) via ${mem.strategy}`);
               await smartClick(mem.cx, mem.cy);
               sendResponse({ success: true, data: `Clicked via memory (${mem.strategy})` });
               return;
             }
           }

          if (searchLabel) {
            await cdpCmd('Accessibility.enable');
            await cdpCmd('DOM.enable');

            // Try several roles so we cast a wide net; collect all candidates.
            const rolesToTry = [null, 'button', 'link', 'menuitem', 'menuitemcheckbox',
                                'option', 'tab', 'treeitem', 'textbox'];
            let axNodes = [];
            for (const role of rolesToTry) {
              const qp = { accessibleName: searchLabel };
              if (role) qp.role = role;
              try {
                const res = await cdpCmd('Accessibility.queryAXTree', qp);
                if (res && res.nodes && res.nodes.length > 0) {
                  axNodes = res.nodes;
                  break;  // first match set is enough
                }
              } catch (_) {}
            }

            // Also try a partial / case-insensitive match via getFullAXTree if needed
            if (axNodes.length === 0) {
              try {
                const full = await cdpCmd('Accessibility.getFullAXTree');
                if (full && full.nodes) {
                  const lower = searchLabel.toLowerCase();
                  axNodes = full.nodes.filter(n =>
                    n.name && n.name.value && n.name.value.toLowerCase().includes(lower) &&
                    n.backendDOMNodeId
                  );
                }
              } catch (_) {}
            }

            for (const node of axNodes) {
              if (!node.backendDOMNodeId) continue;
              try {
                // Scroll element into view first — DOM.getBoxModel returns viewport-relative
                // coords, so an off-screen element returns negative/out-of-range values.
                try { await cdpCmd('DOM.scrollIntoViewIfNeeded', { backendNodeId: node.backendDOMNodeId }); } catch (_) {}
                await new Promise(r => setTimeout(r, 80));
                const box = await cdpCmd('DOM.getBoxModel', { backendNodeId: node.backendDOMNodeId });
                if (!box || !box.model || !box.model.content) continue;
                const [x1, y1, x2, , , y3] = box.model.content;
                const cx = (x1 + x2) / 2;
                const cy = (y1 + y3) / 2;
                 if (cx > 0 && cy > 0 && cx < 8000 && cy < 6000) {
                   await smartClick(cx, cy);
                   await saveClickMem(searchLabel, cx, cy, 'ax');
                   sendResponse({ success: true, data: 'Clicked via AX tree' });
                }
              } catch (_) { continue; }
            }
          }

          // ── Step 3: DOM.performSearch fallback ─────────────────────────────
          // Searches the full DOM tree (incl. shadow roots) by text or selector.
          // Catches elements the AX tree misses — custom components, hidden layers.
          if (searchLabel) {
            try {
              const sr = await cdpCmd('DOM.performSearch', { query: searchLabel, includeUserAgentShadowDOM: true });
              if (sr && sr.resultCount > 0) {
                const hits = await cdpCmd('DOM.getSearchResults', { searchId: sr.searchId, fromIndex: 0, toIndex: Math.min(sr.resultCount, 5) });
                await cdpCmd('DOM.discardSearchResults', { searchId: sr.searchId }).catch(() => {});
                for (const nodeId of (hits.nodeIds || [])) {
                  try {
                    try { await cdpCmd('DOM.scrollIntoViewIfNeeded', { nodeId }); } catch (_) {}
                    await new Promise(r => setTimeout(r, 60));
                    const box = await cdpCmd('DOM.getBoxModel', { nodeId });
                    if (!box?.model?.content) continue;
                    const [x1, y1, x2, , , y3] = box.model.content;
                    const cx = (x1 + x2) / 2, cy = (y1 + y3) / 2;
                     if (cx > 0 && cy > 0 && cx < 8000 && cy < 6000) {
                       await smartClick(cx, cy);
                       await saveClickMem(searchLabel, cx, cy, 'dom-search');
                       sendResponse({ success: true, data: 'Clicked via DOM search' });
                    }
                  } catch (_) { continue; }
                }
              }
            } catch (_) {}
          }

          // ── Step 4: Direct coordinate click — agent supplied x,y ───────────
          // Fix 2 — DPR scaling: the LLM receives a screenshot captured at the
          // physical pixel resolution (DPR > 1 on Retina/4K displays). CDP
          // Input.dispatchMouseEvent expects logical CSS pixels, so we divide.
          if (typeof params.x === 'number' && typeof params.y === 'number') {
            let dpr = 1;
            try {
              const dprRes = await cdpCmd('Runtime.evaluate', {
                expression: 'window.devicePixelRatio || 1', returnByValue: true
              });
              dpr = dprRes?.result?.value || 1;
            } catch (_) {}
            const scaledX = Math.round(params.x / dpr);
            const scaledY = Math.round(params.y / dpr);
            await smartClick(scaledX, scaledY);
            sendResponse({ success: true, data: `Coordinate click (DPR ${dpr})` });
            return;
          }

          // ── Step 5: Sub-session popup routing ─────────────────────────────
          // If the target element lives in a spawned popup (login flow, build
          // preview, OAuth dialog) the main tabId won't find it. Check the
          // subSessions map for a recently attached child window and retry there.
          const recentSub = [...subSessions.values()]
            .filter(s => s.tabId && s.tabId !== tabId && Date.now() - s.attachedAt < 45000)
            .sort((a, b) => b.attachedAt - a.attachedAt)[0];

          if (recentSub?.tabId) {
            console.log(`[Aion Agent] Routing click to sub-session popup tabId=${recentSub.tabId} url=${recentSub.url}`);
            let subSession;
            try { subSession = await cdpPool.acquire(recentSub.tabId); } catch (_) {}
            if (subSession) {
              const subCmd = subSession.send;
              const subClick = async (x, y) => {
                const jx = jitter(x), jy = jitter(y);
                const base = { x: jx, y: jy, button: 'left', buttons: 1, clickCount: 1 };
                await subCmd('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
                await new Promise(r => setTimeout(r, 40 + Math.random() * 30));
                await subCmd('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
              };
              try {
                // Try AXTree on the sub-session tab
                if (searchLabel) {
                  await subCmd('Accessibility.enable');
                  const res = await subCmd('Accessibility.queryAXTree', { accessibleName: searchLabel }).catch(() => ({ nodes: [] }));
                  for (const node of (res?.nodes || [])) {
                    if (!node.backendDOMNodeId) continue;
                    try {
                      await subCmd('DOM.scrollIntoViewIfNeeded', { backendNodeId: node.backendDOMNodeId }).catch(() => {});
                      const box = await subCmd('DOM.getBoxModel', { backendNodeId: node.backendDOMNodeId });
                      if (!box?.model?.content) continue;
                      const [x1, y1, x2,,,y3] = box.model.content;
                      const cx = (x1 + x2) / 2, cy = (y1 + y3) / 2;
                      if (cx > 0 && cy > 0) {
                        await subClick(cx, cy);
                        sendResponse({ success: true, note: `Clicked in popup window (tabId=${recentSub.tabId})` });
                        return;
                      }
                    } catch (_) { continue; }
                  }
                }
              } finally { subSession.release(); }
            }
          }

          // Backup fallback: dispatch a direct DOM .click() via Runtime.evaluate
          // before giving up — catches elements the AX tree temporarily missed.
          try {
            const selectorQuery = params.selector || '';
            const textQuery     = (params.text || params.description || '').toLowerCase();
            const domFallback = await session.send('Runtime.evaluate', {
              expression: `(() => {
                const sel = ${JSON.stringify(selectorQuery)};
                const txt = ${JSON.stringify(textQuery)};
                let el = sel ? document.querySelector(sel) : null;
                if (!el && txt) {
                  for (const c of document.querySelectorAll('button,a,[role="button"],span,[role="link"]')) {
                    if ((c.textContent || '').toLowerCase().includes(txt)) { el = c; break; }
                  }
                }
                if (el) { el.scrollIntoView({ behavior:'auto', block:'center' }); el.click(); return true; }
                return false;
              })()`,
              returnByValue: true
            }).catch(() => ({ result: { value: false } }));
            if (domFallback?.result?.value === true) {
              console.log('[Aion Agent] Click completed via direct DOM fallback');
              sendResponse({ success: true, data: 'Clicked via DOM fallback (AX tree miss)' });
              return;
            }
          } catch (_domFallbackErr) { /* ignore, fall through to failure */ }

          // ── S4: XPath structural search (Pattern 2 / S4) ──────────────────
          // Case-insensitive XPath catches elements whose label is set via
          // child text nodes rather than accessible-name attributes — a common
          // pattern in legacy CMSs and server-rendered HTML.
          const xpathLabel = (params.text || params.description || '').trim();
          if (xpathLabel) {
            try {
              const xpathResult = await session.send('Runtime.evaluate', {
                expression: `(() => {
                  const txt = ${JSON.stringify(xpathLabel.toLowerCase())};
                  const xpath = "//*[self::button or self::a or @role='button' or @role='link']" +
                    "[contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'" + txt.replace(/'/g,"'") + "')]";
                  const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                  const el = result.singleNodeValue;
                  if (el) {
                    el.scrollIntoView({ behavior: 'auto', block: 'center' });
                    const r = el.getBoundingClientRect();
                    return { x: r.left + r.width / 2, y: r.top + r.height / 2, found: true };
                  }
                  return { found: false };
                })()`,
                returnByValue: true
              }).catch(() => ({ result: { value: { found: false } } }));
              if (xpathResult?.result?.value?.found) {
                const { x, y } = xpathResult.result.value;
                await smartClick(x, y);
                await saveClickMem(searchLabel, x, y, 'xpath');
                sendResponse({ success: true, data: 'Clicked via XPath' });
                return;
              }
            } catch (_xpathErr) { /* ignore, fall through to failure */ }
          }

          // ── S5: Vision Fallback ───────────────────────────────────────────────
          // All DOM/AX/XPath paths failed. Canvas-rendered UIs (Google Slides,
          // NotebookLM modals, Figma, etc.) have no DOM nodes for their buttons —
          // they are painted pixels. Last resort: send the live screenshot to
          // Gemini Vision and ask it to locate the target by appearance, then
          // fire a CDP mouse event at the returned coordinates.
          try {
            const visionCoords = await visionFindCoordinates(
              tabId,
              params.text || params.description || ''
            );
            if (visionCoords) {
              await smartClick(visionCoords.x, visionCoords.y);
              sendResponse({ success: true, data: `Clicked via vision fallback at (${visionCoords.x}, ${visionCoords.y})` });
              return;
            }
          } catch (_visionErr) { /* fall through to failure */ }

          // Nothing worked — tell the AI so it can try a different approach
          sendResponse({ success: false, error: `Element "${params.text || params.description || '?'}" not found via DOM, Accessibility tree, DOM search, or vision fallback` });

        } catch (e) {
          console.warn('[Aion Agent] CDP click failed:', e && e.message);
          fallbackSynthetic();
        } finally {
          if (session) session.release();
        }
      })();
      return true;
    }

    if (executeAction === 'switchSheet') {
      // Switch to a named sheet tab in Excel Online or Google Sheets.
      // Both apps expose sheet tabs as real DOM buttons/list-items — we find
      // the one whose text matches params.name and CDP-click it.
      (async () => {
        const targetName = String(params.name || '').trim().toLowerCase();
        if (!targetName) { sendResponse({ success: false, error: 'No sheet name provided' }); return; }

        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) {}

        const cdpCmd = session ? session.send : () => Promise.reject(new Error('CDP unavailable'));

        try {
          await cdpCmd('Runtime.enable', {});
          const result = await cdpCmd('Runtime.evaluate', {
            expression: `(async () => {
              const target = ${JSON.stringify(targetName)};
              // ── Google Sheets sheet tabs ──────────────────────────────────
              // Each tab is a <li> with class docs-sheet-tab; the label is in a span
              const sheetTabs = [
                ...document.querySelectorAll(
                  '.docs-sheet-tab, [data-id][role="tab"], ' +
                  'li.docs-sheet-tab, .sheet-tab-button'
                )
              ];
              for (const tab of sheetTabs) {
                if ((tab.textContent || '').trim().toLowerCase().includes(target)) {
                  const r = tab.getBoundingClientRect();
                  return { x: r.left + r.width/2, y: r.top + r.height/2, found: true, via: 'sheets-tab' };
                }
              }
              // ── Excel Online sheet tabs ───────────────────────────────────
              // Excel renders tabs as <button> or <span> elements in a tab bar
              const excelTabs = [
                ...document.querySelectorAll(
                  '[data-sheet-id], .tab-button, .tab-label, ' +
                  'button[class*="sheet"], span[class*="sheet-name"], ' +
                  '[role="tab"], .awsui-tabs-tab, li[class*="tab"]'
                )
              ];
              for (const tab of excelTabs) {
                if ((tab.textContent || '').trim().toLowerCase().includes(target)) {
                  const r = tab.getBoundingClientRect();
                  return { x: r.left + r.width/2, y: r.top + r.height/2, found: true, via: 'excel-tab' };
                }
              }
              // ── Generic: any clickable element whose text matches ─────────
              const all = [...document.querySelectorAll('button, li, a, [role="tab"], [class*="tab"]')];
              for (const el of all) {
                const t = (el.textContent || '').trim().toLowerCase();
                if (t === target || t.includes(target)) {
                  const r = el.getBoundingClientRect();
                  if (r.width > 10 && r.height > 5) {
                    return { x: r.left + r.width/2, y: r.top + r.height/2, found: true, via: 'generic' };
                  }
                }
              }
              return { found: false };
            })()`,
            awaitPromise: true,
            returnByValue: true
          });

          const loc = result && result.result && result.result.value;
          if (!loc || !loc.found) {
            sendResponse({ success: false, error: `Sheet tab "${params.name}" not found on page.` });
            return;
          }

          const { x, y } = loc;
          await cdpCmd('Input.dispatchMouseEvent', { type: 'mousePressed',  x, y, button: 'left', buttons: 1, clickCount: 1 });
          await cdpCmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: 1 });
          await new Promise(r => setTimeout(r, 400));
          sendResponse({ success: true, message: `Switched to sheet "${params.name}" via ${loc.via}` });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        } finally {
          if (session) session.release();
        }
      })();
      return true;
    }

    if (executeAction === 'switchDocTab') {
      // Switch to a named Document Tab in Google Docs (the left-sidebar tabs
      // introduced in 2024). Uses Accessibility.queryAXTree first (most reliable
      // because the tab title IS the accessible name), then falls back to
      // Runtime.evaluate text search.
      (async () => {
        const targetName = String(params.name || '').trim().toLowerCase();
        if (!targetName) { sendResponse({ success: false, error: 'No tab name provided' }); return; }

        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) {}

        const cdpCmd = session ? session.send : () => Promise.reject(new Error('CDP unavailable'));

        try {
          // ── Step 1: Accessibility tree search (finds by visible tab name) ──
          await cdpCmd('Accessibility.enable', {});
          let axResult = null;
          try {
            axResult = await cdpCmd('Accessibility.queryAXTree', {
              accessibleName: params.name,
              role: 'treeitem'
            });
          } catch (_) {}

          // Also try with role 'tab'
          if (!axResult || !axResult.nodes || axResult.nodes.length === 0) {
            try {
              axResult = await cdpCmd('Accessibility.queryAXTree', {
                accessibleName: params.name,
                role: 'tab'
              });
            } catch (_) {}
          }

          if (axResult && axResult.nodes && axResult.nodes.length > 0) {
            const node = axResult.nodes[0];
            if (node.backendDOMNodeId) {
              const boxResult = await cdpCmd('DOM.getBoxModel', { backendNodeId: node.backendDOMNodeId });
              if (boxResult && boxResult.model && boxResult.model.content) {
                const [x1, y1, x2, y2, x3, y3, x4, y4] = boxResult.model.content;
                const x = (x1 + x3) / 2;
                const y = (y1 + y3) / 2;
                await cdpCmd('Input.dispatchMouseEvent', { type: 'mousePressed',  x, y, button: 'left', buttons: 1, clickCount: 1 });
                await cdpCmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: 1 });
                await new Promise(r => setTimeout(r, 500));
                sendResponse({ success: true, message: `Switched to doc tab "${params.name}" via accessibility tree` });
                return;
              }
            }
          }

          // ── Step 2: Runtime JS fallback — search all sidebar tab elements ──
          await cdpCmd('Runtime.enable', {});
          const rtResult = await cdpCmd('Runtime.evaluate', {
            expression: `(async () => {
              const target = ${JSON.stringify(targetName)};
              // Google Docs tab sidebar selectors (2024 tabs feature)
              const candidates = [
                ...document.querySelectorAll(
                  '[class*="docs-tab"], [class*="tab-title"], [role="treeitem"], ' +
                  '[data-tab-id], [class*="document-tab"], [role="tab"], ' +
                  '.kix-appview-tab, [jsname][class*="tab"]'
                )
              ];
              for (const el of candidates) {
                if ((el.textContent || '').trim().toLowerCase().includes(target)) {
                  const r = el.getBoundingClientRect();
                  if (r.width > 5 && r.height > 5) {
                    return { x: r.left + r.width/2, y: r.top + r.height/2, found: true };
                  }
                }
              }
              // Wider search: any visible element with matching text in the left ~250px
              const all = [...document.querySelectorAll('[role="button"], button, li, div[tabindex]')];
              for (const el of all) {
                const t = (el.textContent || '').trim().toLowerCase();
                const r = el.getBoundingClientRect();
                if (t.includes(target) && r.left < 300 && r.width > 5 && r.height > 5) {
                  return { x: r.left + r.width/2, y: r.top + r.height/2, found: true, via: 'left-panel' };
                }
              }
              return { found: false };
            })()`,
            awaitPromise: true,
            returnByValue: true
          });

          const loc = rtResult && rtResult.result && rtResult.result.value;
          if (!loc || !loc.found) {
            sendResponse({ success: false, error: `Document tab "${params.name}" not found. Make sure the Tabs panel is open in Google Docs (View → Show document tabs).` });
            return;
          }

          const { x, y } = loc;
          await cdpCmd('Input.dispatchMouseEvent', { type: 'mousePressed',  x, y, button: 'left', buttons: 1, clickCount: 1 });
          await cdpCmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: 1 });
          await new Promise(r => setTimeout(r, 500));
          sendResponse({ success: true, message: `Switched to doc tab "${params.name}"` });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        } finally {
          if (session) session.release();
        }
      })();
      return true;
    }

    if (executeAction === 'pressKey') {
      // Fire a keyboard shortcut via CDP — the ONLY way to reliably send
      // modifier key combos (Ctrl+S, Ctrl+Z, etc.) to canvas-based apps.
      // Modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8.
      (async () => {
        const combo = String(params.key || '').toLowerCase().trim();
        const parts = combo.split('+').map(p => p.trim());
        let modifiers = 0;
        let keyName = '';
        for (const p of parts) {
          if (p === 'ctrl' || p === 'control')           modifiers |= 2;
          else if (p === 'alt')                          modifiers |= 1;
          else if (p === 'shift')                        modifiers |= 8;
          else if (p === 'meta'||p==='cmd'||p==='super') modifiers |= 4;
          else keyName = p;
        }
        const KEY_MAP = {
          'a':{ key:'a', code:'KeyA', kc:65 },  'b':{ key:'b', code:'KeyB', kc:66 },
          'c':{ key:'c', code:'KeyC', kc:67 },  'd':{ key:'d', code:'KeyD', kc:68 },
          'e':{ key:'e', code:'KeyE', kc:69 },  'f':{ key:'f', code:'KeyF', kc:70 },
          'g':{ key:'g', code:'KeyG', kc:71 },  'h':{ key:'h', code:'KeyH', kc:72 },
          'i':{ key:'i', code:'KeyI', kc:73 },  'j':{ key:'j', code:'KeyJ', kc:74 },
          'k':{ key:'k', code:'KeyK', kc:75 },  'l':{ key:'l', code:'KeyL', kc:76 },
          'm':{ key:'m', code:'KeyM', kc:77 },  'n':{ key:'n', code:'KeyN', kc:78 },
          'o':{ key:'o', code:'KeyO', kc:79 },  'p':{ key:'p', code:'KeyP', kc:80 },
          'q':{ key:'q', code:'KeyQ', kc:81 },  'r':{ key:'r', code:'KeyR', kc:82 },
          's':{ key:'s', code:'KeyS', kc:83 },  't':{ key:'t', code:'KeyT', kc:84 },
          'u':{ key:'u', code:'KeyU', kc:85 },  'v':{ key:'v', code:'KeyV', kc:86 },
          'w':{ key:'w', code:'KeyW', kc:87 },  'x':{ key:'x', code:'KeyX', kc:88 },
          'y':{ key:'y', code:'KeyY', kc:89 },  'z':{ key:'z', code:'KeyZ', kc:90 },
          '1':{ key:'1', code:'Digit1', kc:49 },'2':{ key:'2', code:'Digit2', kc:50 },
          '3':{ key:'3', code:'Digit3', kc:51 },'4':{ key:'4', code:'Digit4', kc:52 },
          '5':{ key:'5', code:'Digit5', kc:53 },'6':{ key:'6', code:'Digit6', kc:54 },
          '7':{ key:'7', code:'Digit7', kc:55 },'8':{ key:'8', code:'Digit8', kc:56 },
          '9':{ key:'9', code:'Digit9', kc:57 },'0':{ key:'0', code:'Digit0', kc:48 },
          'enter':    { key:'Enter',    code:'Enter',    kc:13  },
          'escape':   { key:'Escape',   code:'Escape',   kc:27  },
          'esc':      { key:'Escape',   code:'Escape',   kc:27  },
          'tab':      { key:'Tab',      code:'Tab',      kc:9   },
          'backspace':{ key:'Backspace',code:'Backspace',kc:8   },
          'delete':   { key:'Delete',   code:'Delete',   kc:46  },
          'arrowup':  { key:'ArrowUp',  code:'ArrowUp',  kc:38  },
          'arrowdown':{ key:'ArrowDown',code:'ArrowDown',kc:40  },
          'arrowleft':{ key:'ArrowLeft',code:'ArrowLeft',kc:37  },
          'arrowright':{ key:'ArrowRight',code:'ArrowRight',kc:39 },
          'up':       { key:'ArrowUp',  code:'ArrowUp',  kc:38  },
          'down':     { key:'ArrowDown',code:'ArrowDown',kc:40  },
          'left':     { key:'ArrowLeft',code:'ArrowLeft',kc:37  },
          'right':    { key:'ArrowRight',code:'ArrowRight',kc:39 },
          'home':     { key:'Home',     code:'Home',     kc:36  },
          'end':      { key:'End',      code:'End',      kc:35  },
          'pageup':   { key:'PageUp',   code:'PageUp',   kc:33  },
          'pagedown': { key:'PageDown', code:'PageDown', kc:34  },
          'f1': { key:'F1', code:'F1', kc:112 },'f2': { key:'F2', code:'F2', kc:113 },
          'f3': { key:'F3', code:'F3', kc:114 },'f4': { key:'F4', code:'F4', kc:115 },
          'f5': { key:'F5', code:'F5', kc:116 },'f6': { key:'F6', code:'F6', kc:117 },
          'f7': { key:'F7', code:'F7', kc:118 },'f8': { key:'F8', code:'F8', kc:119 },
          'f9': { key:'F9', code:'F9', kc:120 },'f10':{ key:'F10',code:'F10',kc:121 },
          'f11':{ key:'F11',code:'F11',kc:122 },'f12':{ key:'F12',code:'F12',kc:123 },
        };
        const mapped = KEY_MAP[keyName];
        if (!mapped) { sendResponse({ success: false, error: `Unknown key: "${keyName}" in combo "${combo}"` }); return; }
        const finalKey = (modifiers & 8) && mapped.key.length === 1 ? mapped.key.toUpperCase() : mapped.key;
        let session;
        try {
          session = await cdpPool.acquire(tabId);
        } catch (_e) {
          sendResponse({ success: false, error: 'CDP attach failed (DevTools open?)' });
          return;
        }
        try {
          const cdpSendKey = session.send;
          const sendKey = (type) => cdpSendKey('Input.dispatchKeyEvent', {
            type,
            modifiers,
            key: finalKey,
            code: mapped.code,
            windowsVirtualKeyCode: mapped.kc,
            nativeVirtualKeyCode: mapped.kc
          });
          await sendKey('rawKeyDown');
          await sendKey('keyUp');
          sendResponse({ success: true });
        } finally {
          if (session) session.release();
        }
      })();
      return true;
    }

    // ── hover ──────────────────────────────────────────────────────────────────
    // Moves the synthetic mouse to an element, triggering CSS :hover AND
    // JavaScript mouseenter/mouseover handlers.  Reveals dropdown menus,
    // flyout panels, and contextual action buttons that are invisible until hovered.
    // The hover state persists after CDP detach because Input.dispatchMouseEvent
    // updates the browser's real internal mouse position.
    if (executeAction === 'hover') {
      (async () => {
        const locateViaContent = () => new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { action: 'agentExecute', executeAction: 'locateForClick', params }, (r) => {
            if (chrome.runtime.lastError || !r || !r.success) resolve(null);
            else resolve(r);
          });
        });
        let loc = null;
        try { loc = await locateViaContent(); } catch (_) {}
        if (!loc) {
          try { await clearAndInject(tabId); loc = await locateViaContent(); } catch (_) {}
        }

        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }

        const cdpC = session.send;

        try {
          let cx, cy;
          if (loc && typeof loc.x === 'number') {
            cx = loc.x; cy = loc.y;
          } else {
            const searchLabel = (params.text || params.description || '').trim();
            if (!searchLabel) { sendResponse({ success: false, error: 'No element label provided for hover' }); return; }
            await cdpC('Accessibility.enable');
            await cdpC('DOM.enable');
            let axNodes = [];
            for (const role of [null, 'button', 'link', 'menuitem', 'option', 'tab']) {
              const qp = { accessibleName: searchLabel };
              if (role) qp.role = role;
              try { const r = await cdpC('Accessibility.queryAXTree', qp); if (r?.nodes?.length) { axNodes = r.nodes; break; } } catch (_) {}
            }
            for (const node of axNodes) {
              if (!node.backendDOMNodeId) continue;
              try {
                try { await cdpC('DOM.scrollIntoViewIfNeeded', { backendNodeId: node.backendDOMNodeId }); } catch (_) {}
                await new Promise(r => setTimeout(r, 80));
                const box = await cdpC('DOM.getBoxModel', { backendNodeId: node.backendDOMNodeId });
                if (!box?.model?.content) continue;
                const [x1, y1, x2, , , y3] = box.model.content;
                cx = (x1 + x2) / 2; cy = (y1 + y3) / 2;
                if (cx > 0 && cy > 0) break;
              } catch (_) { continue; }
            }
          }
          if (!cx || !cy) { sendResponse({ success: false, error: 'Element not found for hover' }); return; }
          // Fire a real synthetic mouse-move — triggers CSS :hover + JS mouseenter
          await cdpC('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none', buttons: 0 });
          await new Promise(r => setTimeout(r, 400)); // let hover animations run
          sendResponse({ success: true });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        } finally {
          if (session) session.release();
        }
      })();
      return true;
    }

    // ── select ─────────────────────────────────────────────────────────────────
    // Sets a native <select> dropdown to a specific option value via JS.
    // Much more reliable than trying to click tiny <option> elements.
    if (executeAction === 'select') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const label = String(params.label || params.text || '');
          const value = String(params.value || '');
          const evalRes = await cdpC('Runtime.evaluate', {
            expression: `(function(label, value) {
              const selects = Array.from(document.querySelectorAll('select'));
              const sel = selects.find(s => {
                if (s.offsetWidth === 0 && s.offsetHeight === 0) return false;
                const lb = document.querySelector('label[for="' + s.id + '"]');
                const lbTxt = (lb ? lb.textContent : '') + (s.getAttribute('aria-label') || '') +
                              (s.name || '') + (s.id || '') +
                              (s.closest('label')?.textContent || '') +
                              (s.parentElement?.querySelector('label')?.textContent || '');
                return lbTxt.toLowerCase().includes(label.toLowerCase());
              }) || (selects.length === 1 ? selects[0] : null);
              if (!sel) return JSON.stringify({ ok:false, error:'No <select> found matching: ' + label });
              const opt = Array.from(sel.options).find(o =>
                o.value === value || o.text === value ||
                o.text.toLowerCase().includes(value.toLowerCase()) ||
                o.value.toLowerCase().includes(value.toLowerCase())
              );
              if (!opt) {
                const avail = Array.from(sel.options).map(o => o.text).join(', ');
                return JSON.stringify({ ok:false, error:'Option not found. Available: ' + avail });
              }
              sel.value = opt.value;
              sel.dispatchEvent(new Event('change', { bubbles:true }));
              sel.dispatchEvent(new Event('input',  { bubbles:true }));
              return JSON.stringify({ ok:true, selected: opt.text });
            })(${JSON.stringify(label)}, ${JSON.stringify(value)})`,
            returnByValue: true
          });
          const result = evalRes?.result?.value ? JSON.parse(evalRes.result.value) : { ok:false, error:'No response' };
          sendResponse(result.ok
            ? { success: true,  data: 'Selected: ' + result.selected }
            : { success: false, error: result.error });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        } finally {
          if (session) session.release();
        }
      })();
      return true;
    }

    // ── waitForElement ─────────────────────────────────────────────────────────
    // Polls until text appears on the page OR a CSS selector matches a visible
    // element.  Prevents the agent from clicking things mid-load.
    if (executeAction === 'waitForElement') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const target      = String(params.text || params.selector || '').trim();
          if (!target) {
            sendResponse({ success: false, error: 'waitForElement requires a non-empty "text" or "selector" — specify what to wait for' });
            return;
          }
          const useSelector = !params.text && !!params.selector;
          const timeoutSec  = Math.min(300, Math.max(1, parseInt(params.timeout) || 10));
          const deadline    = Date.now() + timeoutSec * 1000;
          let found = false;

          // Shadow-DOM-aware text extraction: NotebookLM and AI Studio render ALL
          // their UI inside nested Web Components. document.body.innerText only sees
          // the light DOM — shadow roots are completely invisible to it. This recursive
          // walker reads textContent from every shadow root so waitForElement("Ready"),
          // waitForElement("Generate"), etc. reliably find elements in these apps.
          const shadowTextExpr = `(function() {
            const needle = ${JSON.stringify(target.toLowerCase())};
            function collectText(root) {
              let text = '';
              try {
                for (const el of root.querySelectorAll('*')) {
                  if (el.shadowRoot) text += collectText(el.shadowRoot);
                }
                // Include aria-labels and button labels not in textContent
                for (const el of root.querySelectorAll('[aria-label]')) {
                  text += ' ' + (el.getAttribute('aria-label') || '');
                }
                text += ' ' + (root.body ? root.body.innerText : (root.innerText || root.textContent || ''));
              } catch (_) {}
              return text;
            }
            const fullText = collectText(document).toLowerCase();
            return fullText.includes(needle);
          })()`;

          while (Date.now() < deadline) {
            let matched = false;
            if (useSelector) {
              // Selector mode: try both regular DOM and shadow DOM
              const selExpr = `(function() {
                if (document.querySelector(${JSON.stringify(target)})) return true;
                function findInShadow(root) {
                  try {
                    if (root.querySelector(${JSON.stringify(target)})) return true;
                    for (const el of root.querySelectorAll('*')) {
                      if (el.shadowRoot && findInShadow(el.shadowRoot)) return true;
                    }
                  } catch (_) {}
                  return false;
                }
                return findInShadow(document);
              })()`;
              const r = await cdpC('Runtime.evaluate', { expression: selExpr, returnByValue: true });
              matched = r?.result?.value === true;
            } else {
              // Text mode: check shadow-DOM-aware full text first, fall back to innerText
              const r = await cdpC('Runtime.evaluate', { expression: shadowTextExpr, returnByValue: true });
              matched = r?.result?.value === true;
            }
            if (matched) { found = true; break; }
            await new Promise(r => setTimeout(r, 500));
          }
          sendResponse(found
            ? { success: true,  data: '"' + target + '" appeared on page' }
            : { success: false, error: 'Timed out after ' + timeoutSec + 's waiting for "' + target + '"' });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        } finally {
          if (session) session.release();
        }
      })();
      return true;
    }

    // ── readText ───────────────────────────────────────────────────────────────
    // Extracts the exact text content or value of a specific element — lets the
    // agent read prices, counts, form values, and table cells without relying on
    // screenshot OCR.  Returns the data field in the tool response.
    if (executeAction === 'readText') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const selector = String(params.selector || '');
          const label    = String(params.text || params.label || '');
          const maxCh    = Math.min(5000, parseInt(params.maxChars) || 2000);
          const evalRes  = await cdpC('Runtime.evaluate', {
            expression: `(function(sel, lbl, max) {
              let el = null;
              if (sel) {
                el = document.querySelector(sel);
              } else if (lbl) {
                // Walk visible text nodes to find closest named container
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                let node;
                while ((node = walker.nextNode())) {
                  if (node.textContent.toLowerCase().includes(lbl.toLowerCase())) {
                    el = node.parentElement; break;
                  }
                }
                if (!el) el = document.querySelector('[aria-label*="' + lbl.replace(/"/g,'') + '"]');
              }
              if (!el) return JSON.stringify({ ok:false, error:'Element not found' });
              const tag = el.tagName;
              let text = (tag==='INPUT'||tag==='TEXTAREA') ? el.value
                       : tag==='SELECT' ? (el.options[el.selectedIndex]?.text || '')
                       : (el.innerText || el.textContent || '');
              return JSON.stringify({ ok:true, text: text.trim().slice(0, max) });
            })(${JSON.stringify(selector)}, ${JSON.stringify(label)}, ${maxCh})`,
            returnByValue: true
          });
          const result = evalRes?.result?.value ? JSON.parse(evalRes.result.value) : { ok:false, error:'No response' };
          sendResponse(result.ok
            ? { success: true,  data: result.text }
            : { success: false, error: result.error });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        } finally {
          if (session) session.release();
        }
      })();
      return true;
    }

    // ── autofill ───────────────────────────────────────────────────────────────
    // Fills an entire HTML form in one shot by matching field labels to values.
    // Much faster than clicking + typing into each field individually.
    if (executeAction === 'autofill') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const fields = params.fields || {};
          const evalRes = await cdpC('Runtime.evaluate', {
            expression: `(function(fields) {
              let filled = 0, failed = [];
              const inputs = Array.from(document.querySelectorAll(
                'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=file]), textarea, select'
              ));
              for (const [label, value] of Object.entries(fields)) {
                const lbl = label.toLowerCase();
                const el = inputs.find(inp => {
                  const al = (inp.getAttribute('aria-label') || '').toLowerCase();
                  const ph = (inp.placeholder || '').toLowerCase();
                  const nm = (inp.name || '').toLowerCase();
                  const id = (inp.id || '').toLowerCase();
                  const la = (document.querySelector('label[for="'+inp.id+'"]')?.textContent || '').toLowerCase();
                  const pl = (inp.closest('label')?.textContent || '').toLowerCase();
                  const pp = (inp.parentElement?.querySelector('label')?.textContent || '').toLowerCase();
                  return al.includes(lbl)||ph.includes(lbl)||nm.includes(lbl)||id.includes(lbl)||la.includes(lbl)||pl.includes(lbl)||pp.includes(lbl);
                });
                if (!el) { failed.push(label); continue; }
                if (el.tagName === 'SELECT') {
                  const opt = Array.from(el.options).find(o =>
                    o.text.toLowerCase().includes(value.toLowerCase()) || o.value.toLowerCase().includes(value.toLowerCase())
                  );
                  if (opt) { el.value = opt.value; el.dispatchEvent(new Event('change',{bubbles:true})); filled++; }
                  else failed.push(label);
                } else {
                  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set
                    || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value')?.set;
                  if (setter) setter.call(el, value); else el.value = value;
                  el.dispatchEvent(new Event('input',{bubbles:true}));
                  el.dispatchEvent(new Event('change',{bubbles:true}));
                  filled++;
                }
              }
              return JSON.stringify({ filled, failed, total: Object.keys(fields).length });
            })(${JSON.stringify(fields)})`,
            returnByValue: true
          });
          const r = evalRes?.result?.value ? JSON.parse(evalRes.result.value) : null;
          if (!r) { sendResponse({ success: false, error: 'Autofill script returned no result' }); return; }
          sendResponse({
            success: r.filled > 0,
            data: `Filled ${r.filled}/${r.total} fields` + (r.failed.length ? `. Not found: ${r.failed.join(', ')}` : '')
          });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })();
      return true;
    }

    // ── snapshotPage ───────────────────────────────────────────────────────────
    // DOMSnapshot.captureSnapshot returns the full structured DOM with element
    // positions, roles, and text — far richer than innerText for Gemini.
    if (executeAction === 'snapshotPage') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          await cdpC('DOM.enable');
          const snap = await cdpC('DOMSnapshot.captureSnapshot', {
            computedStyles: ['display', 'visibility'],
            includeDOMRects: false,
            includeBlendedBackgroundColors: false,
            includeShadowTree: 'all'   // pierce shadow DOM + same-origin nested iframes
          });
          const strings = snap?.strings || [];
          const lines = new Set();
          for (const doc of (snap?.documents || [])) {
            const nodes = doc.nodes || {};
            for (const vi of (nodes.textValue?.value || [])) {
              const t = (strings[vi] || '').trim();
              if (t.length > 1) lines.add(t);
            }
            for (const vi of (nodes.inputValue?.value || [])) {
              const v = (strings[vi] || '').trim();
              if (v) lines.add('[Input: "' + v + '"]');
            }
          }

          // ── AXTree layer ─────────────────────────────────────────────────────
          // Accessibility.getFullAXTree gives a universal, standardised map of
          // every interactive element (buttons, inputs, links, menus) using their
          // REAL accessible names — the same names across Google Docs, Word Online,
          // Excel, and any other app. This replaces site-specific CSS guessing.
          const axLines = [];
          try {
            await cdpC('Accessibility.enable');
            const axTree = await cdpC('Accessibility.getFullAXTree', {});
            const INTERACTIVE = new Set(['button','link','textbox','combobox','checkbox',
              'radio','menuitem','menuitemcheckbox','menuitemradio','slider','spinbutton',
              'searchbox','switch','tab','option','treeitem','columnheader','rowheader']);
            for (const node of (axTree?.nodes || [])) {
              const role = node.role?.value || '';
              if (!INTERACTIVE.has(role)) continue;
              const name = node.name?.value?.trim() || '';
              if (!name || name.length > 120) continue;
              const extra = node.description?.value ? ` (${node.description.value})` : '';
              axLines.push(`[AX:${role}] ${name}${extra}`);
              if (axLines.length >= 200) break; // cap to avoid token bloat
            }
            // Must disable before detach — leaving Accessibility enabled breaks
            // Google Docs canvas focus and causes CDP attach failures on next action
            try { await cdpC('Accessibility.disable'); } catch (_) {}
          } catch (_) { /* AXTree optional — DOM snapshot already captured above */ }

          const axSection = axLines.length
            ? `\n\n--- Accessibility Tree (interactive elements) ---\n${axLines.join('\n')}`
            : '';

          sendResponse({ success: true, data: ([...lines].join('\n') + axSection).slice(0, 8000) });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })();
      return true;
    }

    // ── readDocContent ─────────────────────────────────────────────────────────
    // Reads canvas-rendered document text that innerText cannot see.
    // Google Docs  → full AXTree filtered for paragraph/heading/listitem roles.
    // Sheets/Excel → optionally navigates to a cell via Name Box, then reads
    //                the Formula Bar (standard HTML — always visible).
    if (executeAction === 'readDocContent') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) {}
        const cdpC = session ? session.send : () => Promise.reject(new Error('CDP unavailable'));
        try {
          const tabInfo = await chrome.tabs.get(tabId).catch(() => ({}));
          const url = tabInfo.url || '';
          const isSheets = url.includes('sheets.google.com') || url.includes('docs.google.com/spreadsheets')
                        || url.includes('excel.office.com') || url.includes('excel.live.com');

          if (isSheets) {
            // ── Sheets / Excel: navigate to cell then read Formula Bar ──
            const cell = String(params.cell || '').trim().toUpperCase();
            if (cell) {
              // Use Name Box to jump to the cell
              await cdpC('Runtime.evaluate', {
                expression: `(() => {
                  const nb = document.querySelector('#t-name-box,input[aria-label="Cell reference"],input[id*="name-box"],.cell-reference-input');
                  if (!nb) return 'NAME_BOX_NOT_FOUND';
                  nb.focus(); nb.select();
                  nb.value = ${JSON.stringify(cell)};
                  nb.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
                  nb.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true}));
                  return 'ok';
                })()`,
                awaitPromise: false
              });
              await new Promise(r => setTimeout(r, 600));
            }
            // Read the Formula Bar
            const fbResult = await cdpC('Runtime.evaluate', {
              expression: `(() => {
                const fb = document.querySelector('#formula-bar-text,.cell-input,[aria-label="Formula bar"],[id*="formula-bar"]');
                if (fb) return (fb.value || fb.innerText || fb.textContent || '').trim();
                // Fallback: try any focused input
                const active = document.activeElement;
                return active ? (active.value || active.innerText || '').trim() : '';
              })()`,
              awaitPromise: false
            });
            const value = fbResult?.result?.value || '';
            sendResponse({ success: true, data: cell
              ? `Cell ${cell} value: ${value || '(empty)'}`
              : `Selected cell value: ${value || '(empty)'}` });

          } else {
            // ── Google Docs: AXTree paragraph/heading extraction ──
            await cdpC('Accessibility.enable');
            const axTree = await cdpC('Accessibility.getFullAXTree', {});
            const TEXT_ROLES = new Set(['staticText','paragraph','heading','listitem',
              'list','blockquote','term','definition','caption','contentinfo','article',
              'cell','gridCell','gridcell','row','columnHeader','rowHeader','table']);
            const lines = [];
            let lastRole = '';
            for (const node of (axTree?.nodes || [])) {
              const role = node.role?.value || '';
              if (!TEXT_ROLES.has(role)) continue;
              const text = (node.name?.value || '').trim();
              if (!text || text.length < 2) continue;
              if (role === 'heading') {
                if (lines.length) lines.push('');
                lines.push(`## ${text}`);
              } else if (role === 'listitem') {
                lines.push(`• ${text}`);
              } else {
                if (lastRole === 'paragraph' && role === 'paragraph') lines.push('');
                lines.push(text);
              }
              lastRole = role;
              if (lines.length > 300) break;
            }
            // CRITICAL: disable Accessibility domain before detaching so the
            // Docs canvas regains normal focus and CDP can re-attach cleanly
            // for subsequent pressKey / type actions.
            try { await cdpC('Accessibility.disable'); } catch (_) {}
            const docText = lines.join('\n').trim();
            sendResponse({ success: true, data: docText
              ? `Document content:\n${docText}`
              : 'Document appears empty or content is not yet accessible via AXTree.' });
          }
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })();
      return true;
    }

    // ── goToCell ───────────────────────────────────────────────────────────────
    // Navigates to a specific cell in Google Sheets or Excel Online by typing
    // the reference into the Name Box — the only fully reliable cell-targeting
    // method (no coordinate maths, survives scrolling and frozen rows).
    // PRIMARY: CDP Input.dispatchKeyEvent char-by-char (bypasses CSP).
    // FALLBACK: chrome.scripting.executeScript for simpler cases.
    if (executeAction === 'goToCell') {
      (async () => {
        const cell = String(params.cell || '').trim().toUpperCase();
        if (!cell) { sendResponse({ success: false, error: 'cell parameter is required' }); return; }

        let session;
        // ── Step 1: Find the Name Box coords via content script ──────────────
        // allFrames:true covers Excel Online where the Name Box lives inside an iframe
        try {
          const locResult = await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            func: () => {
              const nb = document.querySelector(
                '#t-name-box, input[aria-label="Name Box"], input[id*="name-box"], ' +
                '.cell-reference-input, [data-automation-id="NameBox"] input, ' +
                'input[aria-label="Cell reference"]'
              );
              if (!nb) return null;
              const r = nb.getBoundingClientRect();
              return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            }
          });
          // allFrames returns one result per frame — take the first non-null one
          const coords = locResult?.find(r => r.result != null)?.result;
          if (!coords) { sendResponse({ success: false, error: 'Name Box not found — is this a Sheets or Excel tab?' }); return; }

          // ── Step 2: CDP click + clear + type char-by-char ────────────────────
          try { session = await cdpPool.acquire(tabId); } catch (_) {}
          const cdpK = (type, char) => {
            const code = char.toUpperCase().charCodeAt(0);
            return session.send('Input.dispatchKeyEvent', {
              type, text: char, unmodifiedText: char,
              windowsVirtualKeyCode: code, nativeVirtualKeyCode: code
            });
          };
          const cdpMouse = (type, x, y) => session.send('Input.dispatchMouseEvent',
            { type, x, y, button: 'left', clickCount: 1 });

          // Click the Name Box to focus it
          await cdpMouse('mousePressed', coords.x, coords.y);
          await cdpMouse('mouseReleased', coords.x, coords.y);
          await new Promise(r => setTimeout(r, 150));

          // Select-all to clear existing content (Ctrl+A)
          await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', windowsVirtualKeyCode: 65, modifiers: 2 });
          await session.send('Input.dispatchKeyEvent', { type: 'keyUp',   key: 'a', windowsVirtualKeyCode: 65, modifiers: 2 });
          await new Promise(r => setTimeout(r, 80));

          // Type each character of the cell reference (e.g. "B3" → 'B', '3')
          for (const ch of cell) {
            await cdpK('keyDown', ch);
            await cdpK('keyUp', ch);
            await new Promise(r => setTimeout(r, 40));
          }

          // Press Enter to confirm navigation
          await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
          await session.send('Input.dispatchKeyEvent', { type: 'keyUp',   key: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });

          await new Promise(r => setTimeout(r, 500)); // let Sheets scroll & focus
          sendResponse({ success: true, data: `Navigated to cell ${cell}. Read Formula Bar with readDocContent() to see the value.` });

        } catch (e) {
          // ── Fallback: scripting.executeScript ────────────────────────────────
          try {
            const fb = await chrome.scripting.executeScript({
              target: { tabId, allFrames: true },
              func: (cellRef) => {
                const nb = document.querySelector(
                  '#t-name-box, input[aria-label="Name Box"], input[id*="name-box"], ' +
                  '.cell-reference-input, [data-automation-id="NameBox"] input, ' +
                  'input[aria-label="Cell reference"], input[aria-label*="Name box" i]');
                if (!nb) return false;
                const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
                if (desc && desc.set) desc.set.call(nb, cellRef);
                else nb.value = cellRef;
                nb.dispatchEvent(new Event('input', { bubbles: true }));
                nb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
                nb.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', keyCode: 13, bubbles: true }));
                return true;
              }, args: [cell]
            });
            if ((fb || []).some(r => r && r.result)) {
              await new Promise(r => setTimeout(r, 500));
              sendResponse({ success: true, data: `Navigated to cell ${cell} (fallback method).` });
            } else {
              sendResponse({ success: false, error: e.message });
            }
          } catch (e2) { sendResponse({ success: false, error: e2.message }); }
        } finally {
          if (session) session.release();
        }
      })();
      return true;
    }

    // ── exportPDF ──────────────────────────────────────────────────────────────
    // Page.printToPDF exports any open page as a PDF and triggers a download.
    if (executeAction === 'exportPDF') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const filename = ((params.filename || 'export') + '.pdf').replace(/[^a-z0-9_\-\.]/gi, '-');
          const result = await cdpC('Page.printToPDF', {
            landscape: !!params.landscape,
            printBackground: true,
            paperWidth: 8.5, paperHeight: 11,
            marginTop: 0.4, marginBottom: 0.4, marginLeft: 0.4, marginRight: 0.4
          });
          if (!result?.data) { sendResponse({ success: false, error: 'No PDF data returned from CDP' }); return; }
          // Trigger download inside the tab via a blob URL
          await cdpC('Runtime.evaluate', {
            expression: `(function(b64, fname) {
              const bytes = atob(b64), arr = new Uint8Array(bytes.length);
              for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
              const url = URL.createObjectURL(new Blob([arr], { type:'application/pdf' }));
              Object.assign(document.createElement('a'), { href: url, download: fname }).click();
              setTimeout(() => URL.revokeObjectURL(url), 6000);
            })(${JSON.stringify(result.data)}, ${JSON.stringify(filename)})`
          });
          sendResponse({ success: true, data: 'PDF downloaded: ' + filename });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })();
      return true;
    }

    // ── findElement ────────────────────────────────────────────────────────────
    // DOM.performSearch searches the entire DOM tree including shadow roots —
    // finds elements that AX tree / CSS selectors miss (hidden components, etc).
    if (executeAction === 'findElement') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          await cdpC('DOM.enable');
          const query = String(params.query || params.text || params.selector || '');
          if (!query) { sendResponse({ success: false, error: 'Provide query, text, or selector' }); return; }
          const searchRes = await cdpC('DOM.performSearch', { query, includeUserAgentShadowDOM: true });
          const { searchId, resultCount } = searchRes;
          if (!resultCount) {
            await cdpC('DOM.discardSearchResults', { searchId }).catch(() => {});
            sendResponse({ success: false, error: `Nothing found for: "${query}"` });
            return;
          }
          const items = await cdpC('DOM.getSearchResults', { searchId, fromIndex: 0, toIndex: Math.min(resultCount, 5) });
          await cdpC('DOM.discardSearchResults', { searchId }).catch(() => {});
          const summaries = [];
          for (const nodeId of (items.nodeIds || [])) {
            try {
              const { node } = await cdpC('DOM.describeNode', { nodeId, depth: 1 });
              const attrs = node?.attributes || [];
              const am = {};
              for (let i = 0; i < attrs.length - 1; i += 2) am[attrs[i]] = attrs[i+1];
              const tag = node?.localName || '?';
              const hint = am.id ? '#'+am.id : am.class ? '.'+am.class.split(' ')[0] : '';
              const txt = (node?.children?.[0]?.nodeValue || am['aria-label'] || am.value || '').slice(0, 50);
              summaries.push(`<${tag}${hint}> "${txt}"`);
              if (summaries.length === 1) {
                try { await cdpC('DOM.scrollIntoViewIfNeeded', { nodeId }); } catch (_) {}
              }
            } catch (_) {}
          }
          sendResponse({ success: true, data: `${resultCount} match(es) for "${query}":\n` + summaries.join('\n') });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })();
      return true;
    }

    // ── setMobileMode ──────────────────────────────────────────────────────────
    // Emulation.setDeviceMetricsOverride switches the viewport to mobile size,
    // letting the agent access mobile-only menus, layouts, and features.
    if (executeAction === 'setMobileMode') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const enable = params.enabled !== false;
          if (enable) {
            await cdpC('Emulation.setDeviceMetricsOverride', {
              width: params.width || 390, height: params.height || 844,
              deviceScaleFactor: 2, mobile: true
            });
            await cdpC('Emulation.setUserAgentOverride', {
              userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
            });
            sendResponse({ success: true, data: 'Mobile mode ON — 390×844, iPhone UA' });
          } else {
            await cdpC('Emulation.clearDeviceMetricsOverride');
            await cdpC('Emulation.setUserAgentOverride', { userAgent: '' });
            sendResponse({ success: true, data: 'Mobile mode OFF — desktop view restored' });
          }
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })();
      return true;
    }

    // ── readNetworkResponse ────────────────────────────────────────────────────
    // Intercepts the next fetch/XHR response matching a URL pattern and returns
    // the raw body — reads prices, search results, API data without OCR.
    if (executeAction === 'readNetworkResponse') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const pattern   = String(params.url || params.pattern || '');
          const maxChars  = Math.min(8000, parseInt(params.maxChars) || 4000);
          const timeoutMs = Math.min(30000, (parseInt(params.timeout) || 10) * 1000);
          // Inject fetch + XHR interceptors that capture the next matching response
          await cdpC('Runtime.evaluate', {
            expression: `(function(pat) {
              window.__aionNet = undefined;
              window.__aionNetPat = pat;
              // fetch interceptor
              const _f = window._aionOrigFetch || window.fetch;
              window._aionOrigFetch = _f;
              window.fetch = async function(...a) {
                const url = typeof a[0]==='string' ? a[0] : (a[0]?.url||'');
                const r = await _f.apply(this, a);
                if (!window.__aionNet && (!pat || url.includes(pat))) {
                  try {
                    const ct = r.headers.get('content-type')||'';
                    const body = ct.includes('json') ? JSON.stringify(await r.clone().json()) : await r.clone().text();
                    window.__aionNet = { url, body: body.slice(0, ${maxChars}) };
                  } catch(_) {}
                }
                return r;
              };
              // XHR interceptor
              const _open = XMLHttpRequest.prototype.open;
              const _send = XMLHttpRequest.prototype.send;
              XMLHttpRequest.prototype.open = function(m,u,...rest){ this._au=u; return _open.apply(this,[m,u,...rest]); };
              XMLHttpRequest.prototype.send = function(...a) {
                this.addEventListener('load', function() {
                  if (!window.__aionNet && (!pat||(this._au||'').includes(pat)))
                    try { window.__aionNet = { url:this._au, body:this.responseText.slice(0,${maxChars}) }; } catch(_){}
                });
                return _send.apply(this, a);
              };
            })(${JSON.stringify(pattern)})`,
            returnByValue: true
          });
          // Poll until response captured or timeout
          const deadline = Date.now() + timeoutMs;
          let captured = null;
          while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 400));
            const poll = await cdpC('Runtime.evaluate', {
              expression: 'window.__aionNet ? JSON.stringify(window.__aionNet) : null',
              returnByValue: true
            });
            if (poll?.result?.value) { captured = JSON.parse(poll.result.value); break; }
          }
          // Clean up interceptors
          await cdpC('Runtime.evaluate', {
            expression: 'if(window._aionOrigFetch){window.fetch=window._aionOrigFetch;delete window._aionOrigFetch;} delete window.__aionNet; delete window.__aionNetPat;'
          }).catch(() => {});
          if (!captured) {
            sendResponse({ success: false, error: `No network response captured within ${timeoutMs/1000}s${pattern ? ' for pattern "'+pattern+'"' : ''}` });
            return;
          }
          sendResponse({ success: true, data: `[from: ${captured.url}]\n${captured.body}` });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })();
      return true;
    }

    // ── drag (real CDP) ────────────────────────────────────────────────────────
    // Uses Input.dispatchDragEvent for genuine drag-and-drop that works on
    // Trello, kanban boards, file upload zones, sliders, and reorder lists.
    if (executeAction === 'drag') {
      (async () => {
        // Resolve from/to coordinates — try AX tree first, fall back to params
        const resolveCoord = async (textParam, selectorParam, xParam, yParam, cdpC) => {
          if (typeof xParam === 'number' && typeof yParam === 'number') return { x: xParam, y: yParam };
          const label = String(textParam || selectorParam || '');
          if (!label) return null;
          try {
            await cdpC('Accessibility.enable');
            await cdpC('DOM.enable');
            const r = await cdpC('Accessibility.queryAXTree', { accessibleName: label });
            for (const node of (r?.nodes || [])) {
              if (!node.backendDOMNodeId) continue;
              try {
                await cdpC('DOM.scrollIntoViewIfNeeded', { backendNodeId: node.backendDOMNodeId }).catch(()=>{});
                const box = await cdpC('DOM.getBoxModel', { backendNodeId: node.backendDOMNodeId });
                const [x1,y1,x2,,, y3] = box?.model?.content || [];
                if (x1 && y1) return { x: (x1+x2)/2, y: (y1+y3)/2 };
              } catch (_) {}
            }
          } catch (_) {}
          return null;
        };

        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const from = await resolveCoord(params.fromText, params.fromSelector, params.fromX, params.fromY, cdpC);
          const to   = await resolveCoord(params.toText,   params.toSelector,   params.toX,   params.toY,   cdpC);
          if (!from) { sendResponse({ success: false, error: 'Could not find drag source element' }); return; }
          if (!to)   { sendResponse({ success: false, error: 'Could not find drag target element' }); return; }

          // Full CDP drag sequence: dragIntercepted → dragEnter → drag → drop
          await cdpC('Input.dispatchDragEvent', {
            type: 'dragEnter', x: from.x, y: from.y,
            data: { items: [], dragOperationsMask: 1 }
          });
          await new Promise(r => setTimeout(r, 50));
          // Glide in 5 steps for smooth drag
          const steps = 5;
          for (let i = 1; i <= steps; i++) {
            const sx = from.x + (to.x - from.x) * (i / steps);
            const sy = from.y + (to.y - from.y) * (i / steps);
            await cdpC('Input.dispatchDragEvent', {
              type: 'drag', x: sx, y: sy,
              data: { items: [], dragOperationsMask: 1 }
            });
            await new Promise(r => setTimeout(r, 30));
          }
          await cdpC('Input.dispatchDragEvent', {
            type: 'dragOver', x: to.x, y: to.y,
            data: { items: [], dragOperationsMask: 1 }
          });
          await new Promise(r => setTimeout(r, 80));
          await cdpC('Input.dispatchDragEvent', {
            type: 'drop', x: to.x, y: to.y,
            data: { items: [], dragOperationsMask: 1 }
          });
          await new Promise(r => setTimeout(r, 100));
          sendResponse({ success: true, data: `Dragged from (${Math.round(from.x)},${Math.round(from.y)}) to (${Math.round(to.x)},${Math.round(to.y)})` });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })();
      return true;
    }

    // ── writeChunk ─────────────────────────────────────────────────────────────
    // Appends text to the currently focused element without clearing it.
    // Uses CDP Input.insertText — bypasses Gemini's ~800-word-per-turn limit
    // by letting the agent call this multiple times to build long documents.
    if (executeAction === 'writeChunk') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const text = String(params.text || '');
          if (!text) { sendResponse({ success: false, error: 'No text provided' }); return; }

          // If a selector/target is given, focus it first
          if (params.selector || params.text_target) {
            const sel = params.selector || params.text_target;
            await cdpC('Runtime.evaluate', {
              expression: `(function(s){const el=document.querySelector(s);if(el){el.focus();return true;}return false;})(${JSON.stringify(sel)})`
            }).catch(() => {});
            await new Promise(r => setTimeout(r, 60));
          }

          // Input.insertText inserts at cursor without clearing existing content.
          // Works in textareas, contenteditable divs, Google Docs, Notion, etc.
          await cdpC('Input.insertText', { text });
          sendResponse({ success: true, data: `Inserted ${text.length} characters` });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })();
      return true;
    }

    // ── readStorage ────────────────────────────────────────────────────────────
    // Reads localStorage, sessionStorage, and cookies — lets the agent check
    // auth state, session tokens, feature flags, and saved user settings.
    if (executeAction === 'readStorage') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const target = (params.target || 'all').toLowerCase(); // 'local' | 'session' | 'cookies' | 'all'
          const filterKey = (params.key || '').toLowerCase();    // optional: only return keys containing this string
          const maxChars = Math.min(8000, parseInt(params.maxChars) || 3000);

          const evalRes = await cdpC('Runtime.evaluate', {
            expression: `(function(target, filter, max) {
              const out = {};
              const pick = (store, name) => {
                const obj = {};
                for (let i = 0; i < store.length; i++) {
                  const k = store.key(i);
                  if (!filter || k.toLowerCase().includes(filter)) obj[k] = store.getItem(k);
                }
                if (Object.keys(obj).length) out[name] = obj;
              };
              if (target === 'all' || target === 'local')   try { pick(localStorage, 'localStorage'); }   catch(_) {}
              if (target === 'all' || target === 'session') try { pick(sessionStorage, 'sessionStorage'); } catch(_) {}
              if (target === 'all' || target === 'cookies') {
                try {
                  const cobj = {};
                  document.cookie.split(';').forEach(c => {
                    const [k, ...v] = c.trim().split('=');
                    if (k && (!filter || k.toLowerCase().includes(filter))) cobj[k] = v.join('=');
                  });
                  if (Object.keys(cobj).length) out['cookies'] = cobj;
                } catch(_) {}
              }
              return JSON.stringify(out).slice(0, max);
            })(${JSON.stringify(target)}, ${JSON.stringify(filterKey)}, ${maxChars})`,
            returnByValue: true
          });

          const raw = evalRes?.result?.value;
          if (!raw) { sendResponse({ success: false, error: 'Could not read storage' }); return; }
          let parsed;
          try { parsed = JSON.parse(raw); } catch (_) { parsed = raw; }
          const isEmpty = typeof parsed === 'object' && Object.keys(parsed).length === 0;
          if (isEmpty) {
            sendResponse({ success: true, data: `No storage entries found${filterKey ? ' matching "' + filterKey + '"' : ''}.` });
            return;
          }
          sendResponse({ success: true, data: JSON.stringify(parsed, null, 2).slice(0, maxChars) });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })();
      return true;
    }

    // ── readIndexedDB ── IndexedDB domain ──────────────────────────────────────
    // Reads data from IndexedDB databases used by Gmail, Notion, Figma, PWAs.
    // Runtime.evaluate cannot read IndexedDB reliably — the CDP IndexedDB domain
    // has direct access to the storage engine without JS injection.
    if (executeAction === 'readIndexedDB') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const tab = await chrome.tabs.get(tabId);
          const origin = new URL(tab.url).origin;
          const filterDb    = (params.database || '').toLowerCase();
          const filterStore = (params.store    || '').toLowerCase();
          const maxRows     = Math.min(50, parseInt(params.maxRows) || 10);

          await cdpC('IndexedDB.enable');
          const { databaseNames } = await cdpC('IndexedDB.requestDatabaseNames', {
            securityOrigin: origin
          });
          if (!databaseNames || databaseNames.length === 0) {
            sendResponse({ success: true, data: 'No IndexedDB databases found for this origin.' });
            return;
          }
          const results = {};
          for (const dbName of databaseNames) {
            if (filterDb && !dbName.toLowerCase().includes(filterDb)) continue;
            const { databaseWithObjectStores } = await cdpC('IndexedDB.requestDatabase', {
              securityOrigin: origin, databaseName: dbName
            });
            const stores = (databaseWithObjectStores?.objectStores || []);
            results[dbName] = {};
            for (const store of stores) {
              if (filterStore && !store.name.toLowerCase().includes(filterStore)) continue;
              const { objectStoreDataEntries } = await cdpC('IndexedDB.requestData', {
                securityOrigin: origin, databaseName: dbName,
                objectStoreName: store.name, indexName: '',
                skipCount: 0, pageSize: maxRows
              });
              results[dbName][store.name] = (objectStoreDataEntries || []).map(e => ({
                key:   e.key?.value,
                value: e.value?.value
              }));
            }
          }
          const maxChars = Math.min(8000, parseInt(params.maxChars) || 4000);
          sendResponse({ success: true, data: JSON.stringify(results, null, 2).slice(0, maxChars) });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally {
          if (session) { try { await session.send('IndexedDB.disable'); } catch (_) {} session.release(); }
        }
      })();
      return true;
    }

    // ── interceptRequest ── Fetch domain ───────────────────────────────────────
    // Pauses the NEXT outgoing request matching a URL pattern, lets the agent
    // optionally modify headers/body, then continues it. Unlike readNetworkResponse
    // (which only READS responses), this can CHANGE the request before it leaves.
    if (executeAction === 'interceptRequest') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const urlFilter  = params.url     || '*';
          const modHeaders = params.headers || null; // { 'Authorization': 'Bearer ...' }
          const modBody    = params.body    || null; // string, replaces request body
          const action     = params.action  || 'continue'; // 'continue' | 'block'
          const timeoutMs  = Math.min(30000, (parseInt(params.timeout) || 10) * 1000);

          await cdpC('Fetch.enable', {
            patterns: [{ urlPattern: urlFilter.includes('*') ? urlFilter : `*${urlFilter}*`, requestStage: 'Request' }]
          });

          const intercepted = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              chrome.debugger.onEvent.removeListener(listener);
              reject(new Error(`No matching request within ${timeoutMs / 1000}s`));
            }, timeoutMs);

            function listener(source, evtName, evtParams) {
              if (source.tabId !== tabId) return;
              if (evtName !== 'Fetch.requestPaused') return;
              clearTimeout(timer);
              chrome.debugger.onEvent.removeListener(listener);
              resolve(evtParams);
            }
            chrome.debugger.onEvent.addListener(listener);
          });

          const { requestId, request } = intercepted;
          if (action === 'block') {
            await cdpC('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
            sendResponse({ success: true, data: `Blocked: ${request.url}` });
            return;
          }

          // Build modified headers if requested
          let headers = request.headers;
          if (modHeaders) {
            const merged = { ...headers, ...modHeaders };
            headers = Object.entries(merged).map(([name, value]) => ({ name, value }));
          }

          await cdpC('Fetch.continueRequest', {
            requestId,
            ...(modHeaders ? { headers } : {}),
            ...(modBody    ? { postData: btoa(modBody) } : {})
          });

          sendResponse({ success: true, data: `Intercepted and continued: ${request.url} [${request.method}]` });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally {
          if (session) { try { await session.send('Fetch.disable'); } catch (_) {} session.release(); }
        }
      })();
      return true;
    }

    // ── getComputedStyle ── CSS domain ─────────────────────────────────────────
    // Returns actual browser-computed CSS values for any element — including
    // properties not visible in the HTML (inherited, pseudo-class, media-query-
    // dependent). Useful for confirming an element is truly visible/hidden,
    // reading colors, fonts, or layout values the agent needs.
    if (executeAction === 'getComputedStyle') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const selector  = params.selector  || '';
          const propNames = params.properties // ['display','color','font-size'] or empty = all
            ? (Array.isArray(params.properties) ? params.properties : [params.properties])
            : [];

          await cdpC('DOM.enable');
          await cdpC('CSS.enable');

          // Resolve the selector to a nodeId
          const { root } = await cdpC('DOM.getDocument', { depth: 0 });
          const query = selector
            ? await cdpC('DOM.querySelector',  { nodeId: root.nodeId, selector })
            : { nodeId: root.nodeId };

          if (!query?.nodeId) {
            sendResponse({ success: false, error: `Element not found: "${selector}"` });
            return;
          }

          const { computedStyle } = await cdpC('CSS.getComputedStyleForNode', { nodeId: query.nodeId });
          const filtered = propNames.length
            ? computedStyle.filter(p => propNames.includes(p.name))
            : computedStyle;

          const out = {};
          for (const { name, value } of filtered) out[name] = value;
          sendResponse({ success: true, data: JSON.stringify(out, null, 2).slice(0, 4000) });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally {
          if (session) { try { await session.send('CSS.disable'); } catch (_) {} session.release(); }
        }
      })();
      return true;
    }

    // ── getCookies ── Network domain ────────────────────────────────────────────
    // Returns ALL cookies for the current page including HttpOnly ones that
    // document.cookie (and readStorage) cannot access. Useful for checking auth
    // tokens, session IDs, and security flags (Secure, SameSite).
    if (executeAction === 'getCookies') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const filterKey = (params.key || '').toLowerCase();
          await cdpC('Network.enable', {});
          const { cookies } = await cdpC('Network.getCookies');
          const filtered = (cookies || [])
            .filter(c => !filterKey || c.name.toLowerCase().includes(filterKey))
            .map(c => ({
              name:     c.name,
              value:    c.value,
              domain:   c.domain,
              path:     c.path,
              httpOnly: c.httpOnly,
              secure:   c.secure,
              sameSite: c.sameSite,
              expires:  c.expires > 0 ? new Date(c.expires * 1000).toISOString() : 'session'
            }));
          if (filtered.length === 0) {
            sendResponse({ success: true, data: `No cookies found${filterKey ? ` matching "${filterKey}"` : ''}.` });
            return;
          }
          sendResponse({ success: true, data: JSON.stringify(filtered, null, 2).slice(0, 6000) });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })();
      return true;
    }

    // ── captureConsole ── Runtime domain (console capture) ─────────────────────
    // Captures recent console.log / warn / error messages from the page.
    // Useful for debugging: see what errors the page is throwing, what the app
    // is logging, or confirming a function ran.
    if (executeAction === 'captureConsole') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const maxLines  = Math.min(100, parseInt(params.maxLines) || 30);
          const level     = (params.level || 'all').toLowerCase(); // 'all'|'error'|'warn'|'log'
          const waitMs    = Math.min(10000, (parseInt(params.wait) || 2) * 1000);

          const messages = [];
          function onEvent(source, evtName, evtParams) {
            if (source.tabId !== tabId) return;
            if (evtName !== 'Runtime.consoleAPICalled') return;
            if (level !== 'all' && evtParams.type !== level) return;
            const text = (evtParams.args || [])
              .map(a => a.value !== undefined ? String(a.value) : a.description || '')
              .join(' ');
            messages.push(`[${evtParams.type.toUpperCase()}] ${text}`);
          }
          chrome.debugger.onEvent.addListener(onEvent);

          await cdpC('Runtime.enable');
          await new Promise(r => setTimeout(r, waitMs));

          chrome.debugger.onEvent.removeListener(onEvent);
          const out = messages.slice(-maxLines);
          sendResponse({
            success: true,
            data: out.length ? out.join('\n') : `No console messages captured in ${waitMs / 1000}s.`
          });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })();
      return true;
    }

    // ── clearSiteData ── Storage domain ────────────────────────────────────────
    // Clears cache, cookies, localStorage, sessionStorage, or IndexedDB for the
    // current page's origin. Use before testing a fresh login, clearing a broken
    // app state, or resetting a site's local data.
    if (executeAction === 'clearSiteData') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const tab    = await chrome.tabs.get(tabId);
          const origin = new URL(tab.url).origin;
          // types: 'appcache','cookies','file_systems','indexeddb','local_storage',
          //        'shader_cache','websql','service_workers','cache_storage','all','other'
          const requested = (params.types || 'all').toLowerCase();
          const typeMap = {
            'all':      'cookies,local_storage,session_storage,indexeddb,cache_storage,service_workers',
            'cache':    'cache_storage',
            'cookies':  'cookies',
            'storage':  'local_storage,session_storage,indexeddb',
            'local':    'local_storage',
            'session':  'session_storage',
            'idb':      'indexeddb',
            'sw':       'service_workers',
          };
          const storageTypes = typeMap[requested] || requested;
          await cdpC('Storage.clearDataForOrigin', { origin, storageTypes });
          sendResponse({ success: true, data: `Cleared [${storageTypes}] for ${origin}` });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })();
      return true;
    }

    // ── getPerformance ── Performance domain ───────────────────────────────────
    // Returns real browser performance metrics: FCP, LCP, DOM size, JS heap,
    // layout count, and more. Use to benchmark a page, check memory usage, or
    // verify a page actually loaded completely.
    if (executeAction === 'getPerformance') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          await cdpC('Performance.enable');
          const { metrics } = await cdpC('Performance.getMetrics');
          // Also get navigation timing via Runtime for human-readable load times
          const timingRes = await cdpC('Runtime.evaluate', {
            expression: `JSON.stringify((function(){
              const t = performance.timing;
              const n = performance.getEntriesByType('navigation')[0];
              return {
                pageLoadMs:    Math.round(t.loadEventEnd - t.navigationStart),
                domReadyMs:    Math.round(t.domContentLoadedEventEnd - t.navigationStart),
                ttfbMs:        Math.round(t.responseStart - t.navigationStart),
                transferBytes: n ? n.transferSize : null,
                resourceCount: performance.getEntriesByType('resource').length
              };
            })())`,
            returnByValue: true
          });
          const timing = JSON.parse(timingRes?.result?.value || '{}');
          const interesting = ['JSHeapUsedSize','JSHeapTotalSize','Nodes','LayoutCount',
                               'TaskDuration','ScriptDuration','RecalcStyleCount'];
          const cdpMet = {};
          for (const m of (metrics || [])) {
            if (interesting.includes(m.name)) cdpMet[m.name] = m.value;
          }
          sendResponse({
            success: true,
            data: JSON.stringify({ ...timing, ...cdpMet }, null, 2)
          });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally {
          if (session) { try { await session.send('Performance.disable'); } catch (_) {} session.release(); }
        }
      })();
      return true;
    }

    // ── auditPage ── Audits domain ─────────────────────────────────────────────
    // Collects browser-detected issues: CSP violations, mixed content, broken
    // cookies, CORS errors, deprecation warnings, low-contrast text — everything
    // Chrome DevTools flags in the Issues panel. Uses the real CDP Audits domain
    // (stable 1.3+) — not a Lighthouse run, but near-instant browser audit.
    if (executeAction === 'auditPage') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const waitMs   = Math.min(10000, (parseInt(params.wait) || 3) * 1000);
          const filterType = (params.type || '').toLowerCase();
          const issues = [];

          function onEvent(source, evtName, evtParams) {
            if (source.tabId !== tabId || evtName !== 'Audits.issueAdded') return;
            const d = evtParams?.issue?.details || {};
            const type = evtParams?.issue?.code || 'Unknown';
            if (filterType && !type.toLowerCase().includes(filterType)) return;
            const detail = d.cookieIssueDetails || d.mixedContentDetails ||
                           d.blockedByResponseIssueDetails || d.contentSecurityPolicyIssueDetails ||
                           d.corsIssueDetails || d.deprecationIssueDetails ||
                           d.genericIssueDetails || {};
            issues.push({ type, detail });
          }
          chrome.debugger.onEvent.addListener(onEvent);
          await cdpC('Audits.enable');
          // Reload page to re-trigger all issues, or just wait for live ones
          const reload = params.reload === true || params.reload === 'true';
          if (reload) await cdpC('Page.reload', { ignoreCache: true });
          await new Promise(r => setTimeout(r, waitMs));
          chrome.debugger.onEvent.removeListener(onEvent);

          if (issues.length === 0) {
            sendResponse({ success: true, data: `No issues detected in ${waitMs / 1000}s${filterType ? ` (filter: ${filterType})` : ''}.` });
            return;
          }
          const maxChars = Math.min(8000, parseInt(params.maxChars) || 4000);
          sendResponse({ success: true, data: JSON.stringify(issues, null, 2).slice(0, maxChars) });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally {
          if (session) { try { await session.send('Audits.disable'); } catch (_) {} session.release(); }
        }
      })();
      return true;
    }

    // ── readCache ── CacheStorage domain ───────────────────────────────────────
    // Lists and reads files stored in Service Worker caches — offline pages,
    // cached API responses, PWA assets. Useful for seeing what a PWA has cached
    // or checking if stale content is being served.
    if (executeAction === 'readCache') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const tab    = await chrome.tabs.get(tabId);
          const securityOrigin = new URL(tab.url).origin;
          const filterCache = (params.cache || '').toLowerCase();
          const maxEntries  = Math.min(100, parseInt(params.maxEntries) || 20);

          const { caches } = await cdpC('CacheStorage.requestCacheNames', { securityOrigin });
          if (!caches || caches.length === 0) {
            sendResponse({ success: true, data: 'No Service Worker caches found for this origin.' });
            return;
          }
          const result = {};
          for (const c of caches) {
            if (filterCache && !c.cacheName.toLowerCase().includes(filterCache)) continue;
            const { cacheDataEntries } = await cdpC('CacheStorage.requestEntries', {
              cacheId: c.cacheId, skipCount: 0, pageSize: maxEntries
            });
            result[c.cacheName] = (cacheDataEntries || []).map(e => ({
              url:          e.requestURL,
              responseType: e.responseType,
              responseTime: e.responseTime
                ? new Date(e.responseTime * 1000).toISOString()
                : null
            }));
          }
          sendResponse({ success: true, data: JSON.stringify(result, null, 2).slice(0, 6000) });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })();
      return true;
    }

    // ── getEventListeners ── DOMDebugger domain ────────────────────────────────
    // Returns ALL JavaScript event listeners attached to an element — click,
    // submit, keydown, custom events, etc. Tells you exactly what code runs when
    // you interact with any element. Indispensable for debugging "why doesn't this
    // button do anything" or finding hidden form submission handlers.
    if (executeAction === 'getEventListeners') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const selector  = params.selector || 'document';
          const depth     = parseInt(params.depth) || 1; // pierce shadow roots etc.

          await cdpC('DOM.enable');
          await cdpC('Runtime.enable');

          // Resolve selector to a remote object for DOMDebugger.getEventListeners
          const expr = selector === 'document'
            ? 'document'
            : `document.querySelector(${JSON.stringify(selector)})`;
          const { result: obj } = await cdpC('Runtime.evaluate', {
            expression: expr, objectGroup: 'evtQuery'
          });
          if (!obj?.objectId) {
            sendResponse({ success: false, error: `Element not found: "${selector}"` });
            return;
          }

          const { listeners } = await cdpC('DOMDebugger.getEventListeners', {
            objectId: obj.objectId,
            depth,
            pierce: true
          });
          await cdpC('Runtime.releaseObjectGroup', { objectGroup: 'evtQuery' });

          const summary = (listeners || []).map(l => ({
            type:       l.type,
            useCapture: l.useCapture,
            passive:    l.passive,
            once:       l.once,
            scriptId:   l.handler?.scriptId,
            location:   l.location ? `${l.location.scriptId}:${l.location.lineNumber}:${l.location.columnNumber}` : null
          }));
          sendResponse({
            success: true,
            data: summary.length
              ? JSON.stringify(summary, null, 2).slice(0, 4000)
              : `No event listeners found on "${selector}".`
          });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })();
      return true;
    }

    // ── snapshotHeap ── HeapProfiler domain ────────────────────────────────────
    // Forces garbage collection then reports JS heap usage, retained object counts,
    // and memory pressure. Use to detect memory leaks, check if a page is
    // consuming excessive RAM, or confirm GC ran before a memory-sensitive test.
    if (executeAction === 'snapshotHeap') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          await cdpC('HeapProfiler.enable');
          // Force GC so we see true live usage, not pre-GC noise
          await cdpC('HeapProfiler.collectGarbage');

          // Read JS heap stats via Runtime (HeapProfiler.getObjectByHeapObjectId
          // requires a prior snapshot which is heavy; sampling stats are sufficient)
          const { result } = await cdpC('Runtime.evaluate', {
            expression: `JSON.stringify((function(){
              const m = performance.memory || {};
              return {
                jsHeapUsedMB:  parseFloat((m.usedJSHeapSize  / 1048576).toFixed(2)) || null,
                jsHeapTotalMB: parseFloat((m.totalJSHeapSize / 1048576).toFixed(2)) || null,
                jsHeapLimitMB: parseFloat((m.jsHeapSizeLimit / 1048576).toFixed(2)) || null,
                nodeCount:     document.querySelectorAll('*').length,
                iframeCount:   document.querySelectorAll('iframe').length,
                scriptCount:   document.querySelectorAll('script').length
              };
            })())`,
            returnByValue: true
          });
          const stats = JSON.parse(result?.value || '{}');

          // Sampling-based heap profile for top object allocation sites
          await cdpC('HeapProfiler.startSampling', { samplingInterval: 32768 });
          await new Promise(r => setTimeout(r, 1000)); // 1s sample
          const { profile } = await cdpC('HeapProfiler.stopSampling');

          // Summarise top allocation call frames
          const topNodes = [];
          function walkTree(node, depth) {
            if (!node || depth > 3) return;
            if (node.selfSize > 0) {
              const f = node.callFrame;
              topNodes.push({
                selfKB: Math.round(node.selfSize / 1024),
                fn:     f?.functionName || '(anonymous)',
                url:    f?.url ? f.url.split('/').slice(-2).join('/') : ''
              });
            }
            for (const child of (node.children || [])) walkTree(child, depth + 1);
          }
          if (profile?.head) walkTree(profile.head, 0);
          topNodes.sort((a, b) => b.selfKB - a.selfKB);

          sendResponse({
            success: true,
            data: JSON.stringify({ ...stats, topAllocations: topNodes.slice(0, 15) }, null, 2)
          });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally {
          if (session) { try { await session.send('HeapProfiler.disable'); } catch (_) {} session.release(); }
        }
      })();
      return true;
    }

    // ── readBrowserLog ── Log domain ───────────────────────────────────────────
    // Captures browser-generated log entries: network errors, CSP violations,
    // deprecation warnings, blocked requests, security errors — things that appear
    // in DevTools Console with the 🛡/⚠ icons but are NOT from console.log calls.
    // Complements captureConsole (which reads JS console output).
    if (executeAction === 'readBrowserLog') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const waitMs   = Math.min(15000, (parseInt(params.wait) || 3) * 1000);
          const level    = (params.level  || 'all').toLowerCase(); // 'all'|'error'|'warning'|'info'
          const maxLines = Math.min(200, parseInt(params.maxLines) || 50);
          const entries  = [];

          function onEvent(source, evtName, evtParams) {
            if (source.tabId !== tabId || evtName !== 'Log.entryAdded') return;
            const e = evtParams?.entry || {};
            if (level !== 'all' && e.level !== level) return;
            entries.push({
              level:  e.level,
              source: e.source,
              text:   e.text,
              url:    e.url || null,
              line:   e.lineNumber || null
            });
          }
          chrome.debugger.onEvent.addListener(onEvent);
          await cdpC('Log.enable');
          const reload = params.reload === true || params.reload === 'true';
          if (reload) await cdpC('Page.reload', { ignoreCache: true });
          await new Promise(r => setTimeout(r, waitMs));
          chrome.debugger.onEvent.removeListener(onEvent);

          const out = entries.slice(-maxLines);
          sendResponse({
            success: true,
            data: out.length
              ? out.map(e => `[${e.level?.toUpperCase()}][${e.source}] ${e.text}${e.url ? ` (${e.url}:${e.line})` : ''}`).join('\n')
              : `No browser log entries in ${waitMs / 1000}s.`
          });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally {
          if (session) { try { await session.send('Log.disable'); } catch (_) {} session.release(); }
        }
      })();
      return true;
    }

    // ── getSecurityInfo ── Security domain ─────────────────────────────────────
    // Returns the page's security state: HTTPS cert details, mixed content
    // warnings, cert validity, cipher suite, whether the connection is truly
    // secure. Use before automating form submissions to confirm you're on HTTPS.
    if (executeAction === 'getSecurityInfo') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          await cdpC('Security.enable');
          const state = await cdpC('Security.getSecurityState');
          const tab   = await chrome.tabs.get(tabId);
          const url   = tab.url;
          const isHttps = url.startsWith('https://');
          const out = {
            url,
            isHttps,
            securityState:       state?.securityState,
            summary:             state?.summary,
            certificateSubject:  state?.certificateSecurityState?.certificate?.[0] || null,
            protocol:            state?.certificateSecurityState?.protocol || null,
            keyExchange:         state?.certificateSecurityState?.keyExchange || null,
            cipher:              state?.certificateSecurityState?.cipher || null,
            validFrom:           state?.certificateSecurityState?.validFrom
              ? new Date(state.certificateSecurityState.validFrom * 1000).toISOString() : null,
            validTo:             state?.certificateSecurityState?.validTo
              ? new Date(state.certificateSecurityState.validTo * 1000).toISOString() : null,
            mixedContent:        state?.mixedContentStatus || null,
            explanations:        (state?.explanations || []).map(x => ({ state: x.securityState, summary: x.summary }))
          };
          sendResponse({ success: true, data: JSON.stringify(out, null, 2) });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally {
          try { await session.send('Security.disable'); } catch (_) {}
          if (session) session.release();
        }
      })();
      return true;
    }

    // ── manageServiceWorker ── ServiceWorker domain ────────────────────────────
    // List, inspect, update, stop, or unregister Service Workers for the page.
    // Useful when: a PWA is stuck serving stale cached content, you want to force
    // a fresh update, or you need to see which SW scope is controlling the page.
    if (executeAction === 'manageServiceWorker') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const action = (params.action || 'list').toLowerCase(); // 'list'|'unregister'|'update'|'skipWaiting'
          const waitMs = 2000;
          const workers = [];

          function onWorkerEvent(source, evtName, evtParams) {
            if (source.tabId !== tabId) return;
            if (evtName === 'ServiceWorker.workerRegistrationUpdated') {
              for (const r of (evtParams.registrations || [])) {
                workers.push({ scopeURL: r.scopeURL, registrationId: r.registrationId });
              }
            }
            if (evtName === 'ServiceWorker.workerVersionUpdated') {
              for (const v of (evtParams.versions || [])) {
                const w = workers.find(x => x.registrationId === v.registrationId);
                if (w) Object.assign(w, { status: v.status, runningStatus: v.runningStatus, scriptURL: v.scriptURL, versionId: v.versionId });
              }
            }
          }
          chrome.debugger.onEvent.addListener(onWorkerEvent);
          await cdpC('ServiceWorker.enable');
          await new Promise(r => setTimeout(r, waitMs));
          chrome.debugger.onEvent.removeListener(onWorkerEvent);

          if (action === 'list') {
            sendResponse({
              success: true,
              data: workers.length
                ? JSON.stringify(workers, null, 2)
                : 'No Service Workers registered for this page.'
            });
            return;
          }
          if ((action === 'unregister' || action === 'update' || action === 'skipWaiting') && workers.length === 0) {
            sendResponse({ success: false, error: 'No Service Workers found to ' + action }); return;
          }
          const target = workers.find(w => params.scope ? w.scopeURL.includes(params.scope) : true) || workers[0];
          if (action === 'unregister') {
            await cdpC('ServiceWorker.unregister', { scopeURL: target.scopeURL });
            sendResponse({ success: true, data: `Unregistered SW: ${target.scopeURL}` });
          } else if (action === 'update') {
            await cdpC('ServiceWorker.updateRegistration', { scopeURL: target.scopeURL });
            sendResponse({ success: true, data: `Update triggered for SW: ${target.scopeURL}` });
          } else if (action === 'skipWaiting') {
            await cdpC('ServiceWorker.skipWaiting', { scopeURL: target.scopeURL });
            sendResponse({ success: true, data: `skipWaiting sent to SW: ${target.scopeURL}` });
          }
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally {
          try { await session.send('ServiceWorker.disable'); } catch (_) {}
          if (session) session.release();
        }
      })();
      return true;
    }

    // ── listTargets ── Target domain ───────────────────────────────────────────
    // Returns all open browser targets: tabs, iframes, workers, extensions.
    // Use to: discover what tabs are open, find an iframe's target to debug it,
    // or get the targetId needed to attach the agent to a specific tab/frame.
    if (executeAction === 'listTargets') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const filterType = (params.type || '').toLowerCase(); // 'page'|'iframe'|'worker'|'service_worker'|''
          const { targetInfos } = await cdpC('Target.getTargets');
          const filtered = (targetInfos || [])
            .filter(t => !filterType || t.type === filterType)
            .map(t => ({
              targetId: t.targetId,
              type:     t.type,
              title:    t.title,
              url:      t.url,
              attached: t.attached,
              openerId: t.openerId || null
            }));
          sendResponse({
            success: true,
            data: filtered.length
              ? JSON.stringify(filtered, null, 2).slice(0, 6000)
              : `No targets found${filterType ? ` of type "${filterType}"` : ''}.`
          });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })();
      return true;
    }

    // ── highlightElement ── Overlay domain ─────────────────────────────────────
    // Uses Chrome's native Overlay domain to draw a coloured highlight box around
    // any CSS-selected element — the same highlight DevTools draws. More reliable
    // than the JS-based ghost cursor highlight because it works in iframes, canvas
    // apps, and pages with strict CSP. Use to visually confirm which element the
    // agent is targeting before acting on it.
    if (executeAction === 'highlightElement') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const selector  = params.selector || '';
          const durationMs = Math.min(10000, (parseFloat(params.duration) || 2) * 1000);
          const color = {
            r: parseInt(params.r ?? 66),
            g: parseInt(params.g ?? 133),
            b: parseInt(params.b ?? 244),
            a: parseFloat(params.a ?? 0.3)
          };

          await cdpC('DOM.enable');
          const { root } = await cdpC('DOM.getDocument', { depth: 0 });
          const { nodeId } = selector
            ? await cdpC('DOM.querySelector', { nodeId: root.nodeId, selector })
            : { nodeId: root.nodeId };

          if (!nodeId) {
            sendResponse({ success: false, error: `Element not found: "${selector}"` }); return;
          }

          await cdpC('Overlay.highlightNode', {
            highlightConfig: {
              showInfo: true,
              contentColor:  color,
              paddingColor:  { r: color.r, g: color.g, b: color.b, a: 0.1 },
              borderColor:   { r: color.r, g: color.g, b: color.b, a: 0.8 }
            },
            nodeId
          });

          await new Promise(r => setTimeout(r, durationMs));
          await cdpC('Overlay.hideHighlight');
          sendResponse({ success: true, data: `Highlighted "${selector || 'document'}" for ${durationMs / 1000}s.` });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })();
      return true;
    }

    // ── getSystemInfo ── SystemInfo domain ────────────────────────────────────
    if (executeAction === 'getSystemInfo') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const info = await cdpC('SystemInfo.getInfo');
          const ver  = await cdpC('Browser.getVersion');
          sendResponse({ success: true, data: JSON.stringify({
            product: ver?.product, revision: ver?.revision,
            userAgent: ver?.userAgent, jsVersion: ver?.jsVersion,
            gpu: info?.gpu?.devices?.map(d => `${d.vendorString} ${d.deviceString}`),
            gpuFeatures: info?.featureStatus,
            imageDecoding: info?.imageDecoding,
            videoDecoding: info?.videoDecoding,
            videoEncoding: info?.videoEncoding
          }, null, 2) });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })(); return true;
    }

    // ── setBrowserWindow ── Browser domain ────────────────────────────────────
    if (executeAction === 'setBrowserWindow') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const { windowId } = await cdpC('Browser.getWindowForTarget');
          const bounds = {};
          if (params.left   != null) bounds.left   = parseInt(params.left);
          if (params.top    != null) bounds.top    = parseInt(params.top);
          if (params.width  != null) bounds.width  = parseInt(params.width);
          if (params.height != null) bounds.height = parseInt(params.height);
          if (params.state) bounds.windowState = params.state; // 'normal'|'minimized'|'maximized'|'fullscreen'
          await cdpC('Browser.setWindowBounds', { windowId, bounds });
          sendResponse({ success: true, data: `Window updated: ${JSON.stringify(bounds)}` });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })(); return true;
    }

    // ── grantPermission ── Browser domain ─────────────────────────────────────
    if (executeAction === 'grantPermission') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const tab = await chrome.tabs.get(tabId);
          const origin = new URL(tab.url).origin;
          // permissions: 'geolocation','camera','microphone','notifications','clipboardReadWrite'...
          const perms = Array.isArray(params.permissions) ? params.permissions : [params.permission || 'notifications'];
          await cdpC('Browser.grantPermissions', { permissions: perms, origin });
          sendResponse({ success: true, data: `Granted [${perms.join(', ')}] for ${origin}` });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })(); return true;
    }

    // ── readDOMStorage ── DOMStorage domain ───────────────────────────────────
    // Native CDP read of localStorage/sessionStorage — more reliable than the
    // JS-injection approach used by readStorage (works on pages that sandbox JS).
    if (executeAction === 'readDOMStorage') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const tab = await chrome.tabs.get(tabId);
          const securityOrigin = new URL(tab.url).origin;
          const filterKey = (params.key || '').toLowerCase();
          const result = {};
          for (const isLocal of [true, false]) {
            const label = isLocal ? 'localStorage' : 'sessionStorage';
            if (params.target && params.target !== 'all' && params.target !== (isLocal ? 'local' : 'session')) continue;
            const { entries } = await cdpC('DOMStorage.getDOMStorageItems', {
              storageId: { securityOrigin, isLocalStorage: isLocal }
            });
            const obj = {};
            for (const [k, v] of (entries || [])) {
              if (!filterKey || k.toLowerCase().includes(filterKey)) obj[k] = v;
            }
            if (Object.keys(obj).length) result[label] = obj;
          }
          const maxChars = Math.min(8000, parseInt(params.maxChars) || 3000);
          sendResponse({
            success: true,
            data: Object.keys(result).length
              ? JSON.stringify(result, null, 2).slice(0, maxChars)
              : `No DOMStorage entries found${filterKey ? ` matching "${filterKey}"` : ''}.`
          });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })(); return true;
    }

    // ── setDeviceOrientation ── DeviceOrientation domain ──────────────────────
    if (executeAction === 'setDeviceOrientation') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          if (params.clear) {
            await cdpC('DeviceOrientation.clearDeviceOrientationOverride');
            sendResponse({ success: true, data: 'Device orientation override cleared.' });
          } else {
            const alpha = parseFloat(params.alpha ?? 0); // z-axis rotation 0-360
            const beta  = parseFloat(params.beta  ?? 0); // x-axis tilt -180 to 180
            const gamma = parseFloat(params.gamma ?? 0); // y-axis tilt -90 to 90
            await cdpC('DeviceOrientation.setDeviceOrientationOverride', { alpha, beta, gamma });
            sendResponse({ success: true, data: `Orientation set: alpha=${alpha} beta=${beta} gamma=${gamma}` });
          }
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })(); return true;
    }

    // ── getAnimations ── Animation domain ─────────────────────────────────────
    if (executeAction === 'getAnimations') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const waitMs = Math.min(5000, (parseInt(params.wait) || 2) * 1000);
          const animations = [];
          function onEvent(source, evtName, evtParams) {
            if (source.tabId !== tabId || evtName !== 'Animation.animationCreated') return;
            animations.push(evtParams?.id);
          }
          chrome.debugger.onEvent.addListener(onEvent);
          await cdpC('Animation.enable');
          await new Promise(r => setTimeout(r, waitMs));
          chrome.debugger.onEvent.removeListener(onEvent);

          // Get detail for each animation
          const details = [];
          for (const id of animations.slice(0, 20)) {
            try {
              const { animation } = await cdpC('Animation.getAnimation', { animationId: id });
              details.push({
                id: animation?.id,
                name: animation?.name,
                type: animation?.type,
                duration: animation?.source?.duration,
                delay: animation?.source?.delay,
                iterations: animation?.source?.iterations,
                playState: animation?.playState
              });
            } catch (_) {}
          }
          await cdpC('Animation.disable');
          sendResponse({ success: true, data: details.length ? JSON.stringify(details, null, 2) : 'No animations detected.' });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })(); return true;
    }

    // ── setAnimationSpeed ── Animation domain ──────────────────────────────────
    if (executeAction === 'setAnimationSpeed') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const playbackRate = parseFloat(params.speed ?? 1); // 0 = pause, 1 = normal, 2 = 2x
          await cdpC('Animation.enable');
          await cdpC('Animation.setPlaybackRate', { playbackRate });
          sendResponse({ success: true, data: `Global animation playback rate set to ${playbackRate}x.` });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })(); return true;
    }

    // ── triggerAutofill ── Autofill domain ────────────────────────────────────
    if (executeAction === 'triggerAutofill') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const selector = params.selector || 'input[autocomplete]';
          await cdpC('DOM.enable');
          const { root } = await cdpC('DOM.getDocument', { depth: 0 });
          const { nodeId } = await cdpC('DOM.querySelector', { nodeId: root.nodeId, selector });
          if (!nodeId) { sendResponse({ success: false, error: `No element found: "${selector}"` }); return; }
          // Autofill.trigger fills the form using Chrome's stored autofill data
          await cdpC('Autofill.trigger', { fieldId: nodeId });
          sendResponse({ success: true, data: `Autofill triggered on "${selector}".` });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })(); return true;
    }

    // ── readBackgroundEvents ── BackgroundService domain ───────────────────────
    if (executeAction === 'readBackgroundEvents') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const waitMs = Math.min(10000, (parseInt(params.wait) || 3) * 1000);
          // service: 'backgroundFetch'|'backgroundSync'|'pushMessaging'|'notifications'|'paymentHandler'|'periodicBackgroundSync'
          const service = params.service || 'backgroundSync';
          const events = [];
          function onEvent(source, evtName, evtParams) {
            if (source.tabId !== tabId || evtName !== 'BackgroundService.backgroundServiceEventReceived') return;
            events.push(evtParams?.backgroundServiceEvent);
          }
          chrome.debugger.onEvent.addListener(onEvent);
          await cdpC('BackgroundService.startObserving', { service });
          await cdpC('BackgroundService.setRecording', { shouldRecord: true, service });
          await new Promise(r => setTimeout(r, waitMs));
          chrome.debugger.onEvent.removeListener(onEvent);
          await cdpC('BackgroundService.stopObserving', { service });
          sendResponse({
            success: true,
            data: events.length ? JSON.stringify(events, null, 2) : `No ${service} events in ${waitMs / 1000}s.`
          });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })(); return true;
    }

    // ── pauseOnException ── Debugger domain ───────────────────────────────────
    if (executeAction === 'pauseOnException') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const waitMs = Math.min(30000, (parseInt(params.wait) || 5) * 1000);
          const state  = params.state || 'uncaught'; // 'none'|'uncaught'|'all'
          let caught = null;

          function onEvent(source, evtName, evtParams) {
            if (source.tabId !== tabId || evtName !== 'Debugger.paused') return;
            const reason = evtParams?.reason;
            if (reason !== 'exception' && reason !== 'promiseRejection') return;
            caught = {
              reason,
              exception: evtParams?.data?.description || evtParams?.data?.value,
              callFrames: (evtParams?.callFrames || []).slice(0, 5).map(f => ({
                fn:   f.functionName || '(anonymous)',
                url:  f.url,
                line: f.location?.lineNumber,
                col:  f.location?.columnNumber
              }))
            };
          }
          chrome.debugger.onEvent.addListener(onEvent);
          await cdpC('Debugger.enable');
          await cdpC('Debugger.setPauseOnExceptions', { state });
          await new Promise(r => setTimeout(r, waitMs));
          chrome.debugger.onEvent.removeListener(onEvent);

          if (caught) {
            // Resume execution so page doesn't stay frozen
            try { await cdpC('Debugger.resume'); } catch (_) {}
          }
          sendResponse({
            success: true,
            data: caught ? JSON.stringify(caught, null, 2) : `No ${state} exceptions in ${waitMs / 1000}s.`
          });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally {
          if (session) { try { await session.send('Debugger.disable'); } catch (_) {} session.release(); }
        }
      })(); return true;
    }

    // ── setEventBreakpoint ── EventBreakpoints domain ──────────────────────────
    if (executeAction === 'setEventBreakpoint') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const eventName = params.eventName || 'click'; // 'click','submit','fetch','xmlhttpRequestSend'...
          const waitMs    = Math.min(30000, (parseInt(params.wait) || 10) * 1000);
          let caught = null;
          function onEvent(source, evtName, evtParams) {
            if (source.tabId !== tabId || evtName !== 'Debugger.paused') return;
            caught = {
              reason: evtParams?.reason,
              callFrames: (evtParams?.callFrames || []).slice(0, 5).map(f => ({
                fn: f.functionName || '(anonymous)', url: f.url, line: f.location?.lineNumber
              }))
            };
          }
          chrome.debugger.onEvent.addListener(onEvent);
          await cdpC('Debugger.enable');
          await cdpC('EventBreakpoints.setInstrumentationBreakpoint', { eventName });
          await new Promise(r => setTimeout(r, waitMs));
          chrome.debugger.onEvent.removeListener(onEvent);
          if (caught) { try { await cdpC('Debugger.resume'); } catch (_) {} }
          await cdpC('EventBreakpoints.removeInstrumentationBreakpoint', { eventName });
          sendResponse({ success: true, data: caught ? JSON.stringify(caught, null, 2) : `No "${eventName}" event in ${waitMs / 1000}s.` });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally {
          if (session) { try { await session.send('Debugger.disable'); } catch (_) {} session.release(); }
        }
      })(); return true;
    }

    // ── getFedCmInfo ── FedCm domain ───────────────────────────────────────────
    if (executeAction === 'getFedCmInfo') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const waitMs = Math.min(10000, (parseInt(params.wait) || 3) * 1000);
          const dialogs = [];
          function onEvent(source, evtName, evtParams) {
            if (source.tabId !== tabId) return;
            if (evtName === 'FedCm.dialogShown') dialogs.push({ type: 'dialogShown', ...evtParams });
            if (evtName === 'FedCm.dialogClosed') dialogs.push({ type: 'dialogClosed', ...evtParams });
          }
          chrome.debugger.onEvent.addListener(onEvent);
          await cdpC('FedCm.enable', { disableRejectionDelay: false });
          await new Promise(r => setTimeout(r, waitMs));
          chrome.debugger.onEvent.removeListener(onEvent);
          sendResponse({ success: true, data: dialogs.length ? JSON.stringify(dialogs, null, 2) : 'No FedCM dialogs detected.' });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally {
          if (session) { try { await session.send('FedCm.disable'); } catch (_) {} session.release(); }
        }
      })(); return true;
    }

    // ── getFileSystem ── FileSystem domain ────────────────────────────────────
    if (executeAction === 'getFileSystem') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const tab = await chrome.tabs.get(tabId);
          const { directory } = await cdpC('FileSystem.getDirectory', {
            bucketFileSystemLocator: {
              storageKey:    new URL(tab.url).origin,
              bucketName:    params.bucket || 'default',
              pathComponents: (params.path || '').split('/').filter(Boolean)
            }
          });
          sendResponse({ success: true, data: JSON.stringify(directory, null, 2).slice(0, 4000) });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })(); return true;
    }

    // ── getLayerTree ── LayerTree domain ──────────────────────────────────────
    if (executeAction === 'getLayerTree') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const layers = [];
          function onEvent(source, evtName, evtParams) {
            if (source.tabId !== tabId || evtName !== 'LayerTree.layerTreeDidChange') return;
            for (const l of (evtParams?.layers || [])) {
              layers.push({ layerId: l.layerId, parentLayerId: l.parentLayerId, width: l.width, height: l.height, drawsContent: l.drawsContent, invisible: l.invisible });
            }
          }
          chrome.debugger.onEvent.addListener(onEvent);
          await cdpC('LayerTree.enable');
          await new Promise(r => setTimeout(r, 1000));
          chrome.debugger.onEvent.removeListener(onEvent);
          await cdpC('LayerTree.disable');
          sendResponse({ success: true, data: layers.length ? JSON.stringify(layers.slice(0, 50), null, 2) : 'No layers captured.' });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })(); return true;
    }

    // ── inspectMedia ── Media domain ───────────────────────────────────────────
    if (executeAction === 'inspectMedia') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const waitMs = Math.min(5000, (parseInt(params.wait) || 2) * 1000);
          const players = {};
          function onEvent(source, evtName, evtParams) {
            if (source.tabId !== tabId) return;
            if (evtName === 'Media.playerAdded') players[evtParams.player.playerId] = { playerId: evtParams.player.playerId, properties: {} };
            if (evtName === 'Media.playerPropertiesChanged') {
              if (!players[evtParams.playerId]) players[evtParams.playerId] = { properties: {} };
              for (const p of (evtParams.properties || [])) players[evtParams.playerId].properties[p.name] = p.value;
            }
            if (evtName === 'Media.playerEventsAdded') {
              if (!players[evtParams.playerId]) players[evtParams.playerId] = { properties: {} };
              players[evtParams.playerId].events = (evtParams.events || []).map(e => ({ type: e.type, timestamp: e.timestamp }));
            }
          }
          chrome.debugger.onEvent.addListener(onEvent);
          await cdpC('Media.enable');
          await new Promise(r => setTimeout(r, waitMs));
          chrome.debugger.onEvent.removeListener(onEvent);
          await cdpC('Media.disable');
          const list = Object.values(players);
          sendResponse({ success: true, data: list.length ? JSON.stringify(list, null, 2).slice(0, 4000) : 'No media players found.' });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })(); return true;
    }

    // ── getMemoryInfo ── Memory domain ────────────────────────────────────────
    if (executeAction === 'getMemoryInfo') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const counters = await cdpC('Memory.getDOMCounters');
          if (params.gc) await cdpC('Memory.forciblyPurgeJavaScriptMemory');
          const { result } = await cdpC('Runtime.evaluate', {
            expression: `JSON.stringify({usedMB:+(performance.memory?.usedJSHeapSize/1048576).toFixed(2),totalMB:+(performance.memory?.totalJSHeapSize/1048576).toFixed(2),limitMB:+(performance.memory?.jsHeapSizeLimit/1048576).toFixed(2)})`,
            returnByValue: true
          });
          const heap = JSON.parse(result?.value || '{}');
          sendResponse({ success: true, data: JSON.stringify({ domNodes: counters?.nodes, domEventListeners: counters?.jsEventListeners, documents: counters?.documents, ...heap }, null, 2) });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })(); return true;
    }

    // ── trackWebVitals ── PerformanceTimeline domain ───────────────────────────
    if (executeAction === 'trackWebVitals') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const waitMs = Math.min(15000, (parseInt(params.wait) || 5) * 1000);
          const events = [];
          function onEvent(source, evtName, evtParams) {
            if (source.tabId !== tabId || evtName !== 'PerformanceTimeline.timelineEventAdded') return;
            events.push({ type: evtParams?.event?.type, name: evtParams?.event?.name, time: evtParams?.event?.time, duration: evtParams?.event?.duration });
          }
          chrome.debugger.onEvent.addListener(onEvent);
          // LCP, FID, CLS, navigation, resource
          await cdpC('PerformanceTimeline.enable', { filters: [{ eventType: 'largest-contentful-paint' }, { eventType: 'layout-shift' }, { eventType: 'first-input' }] });
          await new Promise(r => setTimeout(r, waitMs));
          chrome.debugger.onEvent.removeListener(onEvent);
          sendResponse({ success: true, data: events.length ? JSON.stringify(events, null, 2) : `No web vital events in ${waitMs / 1000}s.` });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })(); return true;
    }

    // ── getPreloadRules ── Preload domain ─────────────────────────────────────
    if (executeAction === 'getPreloadRules') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const waitMs = 2000;
          const rules = [], statuses = [];
          function onEvent(source, evtName, evtParams) {
            if (source.tabId !== tabId) return;
            if (evtName === 'Preload.ruleSetUpdated') rules.push(evtParams?.ruleSet);
            if (evtName === 'Preload.prefetchStatusUpdated') statuses.push({ url: evtParams?.url, status: evtParams?.status });
            if (evtName === 'Preload.prerenderStatusUpdated') statuses.push({ url: evtParams?.url, status: evtParams?.status, type: 'prerender' });
          }
          chrome.debugger.onEvent.addListener(onEvent);
          await cdpC('Preload.enable');
          await new Promise(r => setTimeout(r, waitMs));
          chrome.debugger.onEvent.removeListener(onEvent);
          await cdpC('Preload.disable');
          sendResponse({ success: true, data: JSON.stringify({ rules, statuses }, null, 2).slice(0, 4000) || 'No preload rules found.' });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })(); return true;
    }

    // ── profileCPU ── Profiler domain ─────────────────────────────────────────
    if (executeAction === 'profileCPU') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const durationMs = Math.min(15000, (parseInt(params.duration) || 3) * 1000);
          await cdpC('Profiler.enable');
          await cdpC('Profiler.setSamplingInterval', { interval: parseInt(params.interval) || 100 });
          await cdpC('Profiler.start');
          await new Promise(r => setTimeout(r, durationMs));
          const { profile } = await cdpC('Profiler.stop');

          // Aggregate sample counts per function
          const counts = {};
          for (const node of (profile?.nodes || [])) {
            const f = node.callFrame;
            const key = `${f.functionName || '(anonymous)'}|${f.url ? f.url.split('/').slice(-2).join('/') : ''}:${f.lineNumber}`;
            counts[key] = (counts[key] || 0) + (node.hitCount || 0);
          }
          const top = Object.entries(counts)
            .sort((a, b) => b[1] - a[1]).slice(0, 20)
            .map(([k, hits]) => { const [fn, loc] = k.split('|'); return { fn, loc, hits, pct: ((hits / (profile?.samples?.length || 1)) * 100).toFixed(1) + '%' }; });
          await cdpC('Profiler.disable');
          sendResponse({ success: true, data: JSON.stringify({ durationMs, totalSamples: profile?.samples?.length, topFunctions: top }, null, 2) });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })(); return true;
    }

    // ── getPWAInfo ── PWA domain ──────────────────────────────────────────────
    if (executeAction === 'getPWAInfo') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const tab = await chrome.tabs.get(tabId);
          let pwaState = null;
          try {
            pwaState = await cdpC('PWA.getOsAppState', { manifestId: tab.url });
          } catch (_) {}
          // Supplement with manifest from page
          const { result } = await cdpC('Runtime.evaluate', {
            expression: `JSON.stringify((function(){const l=document.querySelector('link[rel="manifest"]');return{manifestHref:l?l.href:null,isStandalone:window.matchMedia('(display-mode: standalone)').matches,isInstalled:window.navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches}})())`,
            returnByValue: true
          });
          const pageInfo = JSON.parse(result?.value || '{}');
          sendResponse({ success: true, data: JSON.stringify({ ...pageInfo, pwaState }, null, 2) });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })(); return true;
    }

    // ── getCDPSchema ── Schema domain ─────────────────────────────────────────
    if (executeAction === 'getCDPSchema') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const { domains } = await cdpC('Schema.getDomains');
          const summary = (domains || []).map(d => ({ name: d.name, version: d.version }));
          sendResponse({ success: true, data: JSON.stringify(summary, null, 2) });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })(); return true;
    }

    // ── recordTrace ── Tracing domain ─────────────────────────────────────────
    if (executeAction === 'recordTrace') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const durationMs = Math.min(10000, (parseInt(params.duration) || 3) * 1000);
          const chunks = [];
          let complete = false;

          function onEvent(source, evtName, evtParams) {
            if (source.tabId !== tabId) return;
            if (evtName === 'Tracing.dataCollected') chunks.push(...(evtParams?.value || []));
            if (evtName === 'Tracing.tracingComplete') complete = true;
          }
          chrome.debugger.onEvent.addListener(onEvent);
          await cdpC('Tracing.start', {
            traceConfig: { recordMode: 'recordUntilFull', includedCategories: ['devtools.timeline', 'v8', 'blink.user_timing'] },
            transferMode: 'ReportEvents'
          });
          await new Promise(r => setTimeout(r, durationMs));
          await cdpC('Tracing.end');
          await new Promise(r => setTimeout(r, 1000)); // wait for data
          chrome.debugger.onEvent.removeListener(onEvent);

          // Summarise: count event types
          const typeCounts = {};
          for (const e of chunks) typeCounts[e.name] = (typeCounts[e.name] || 0) + 1;
          const topEvents = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);
          sendResponse({ success: true, data: JSON.stringify({ totalEvents: chunks.length, durationMs, topEventTypes: topEvents.map(([name, count]) => ({ name, count })) }, null, 2) });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })(); return true;
    }

    // ── inspectWebAudio ── WebAudio domain ────────────────────────────────────
    if (executeAction === 'inspectWebAudio') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const waitMs = Math.min(5000, (parseInt(params.wait) || 2) * 1000);
          const contexts = {};
          const nodes = [];
          function onEvent(source, evtName, evtParams) {
            if (source.tabId !== tabId) return;
            if (evtName === 'WebAudio.contextCreated') {
              const c = evtParams?.context;
              contexts[c?.contextId] = { contextId: c?.contextId, contextType: c?.contextType, contextState: c?.contextState, sampleRate: c?.sampleRate, callbackBufferSize: c?.callbackBufferSize };
            }
            if (evtName === 'WebAudio.contextChanged') {
              const c = evtParams?.context;
              if (contexts[c?.contextId]) Object.assign(contexts[c?.contextId], { contextState: c?.contextState });
            }
            if (evtName === 'WebAudio.audioNodeCreated') {
              nodes.push({ nodeId: evtParams?.node?.nodeId, nodeType: evtParams?.node?.nodeType, contextId: evtParams?.node?.contextId });
            }
          }
          chrome.debugger.onEvent.addListener(onEvent);
          await cdpC('WebAudio.enable');
          await new Promise(r => setTimeout(r, waitMs));
          chrome.debugger.onEvent.removeListener(onEvent);
          await cdpC('WebAudio.disable');
          sendResponse({
            success: true,
            data: Object.keys(contexts).length
              ? JSON.stringify({ contexts: Object.values(contexts), nodes: nodes.slice(0, 30) }, null, 2)
              : 'No Web Audio contexts found on this page.'
          });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { if (session) session.release(); }
      })(); return true;
    }

    // ── emulateWebAuthn ── WebAuthn domain ────────────────────────────────────
    if (executeAction === 'emulateWebAuthn') {
      (async () => {
        let session;
        try { session = await cdpPool.acquire(tabId); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = session.send;
        try {
          const action = (params.action || 'add').toLowerCase(); // 'add'|'remove'|'list'
          await cdpC('WebAuthn.enable', { enableUI: !!params.enableUI });
          if (action === 'add') {
            const { authenticatorId } = await cdpC('WebAuthn.addVirtualAuthenticator', {
              options: {
                protocol:    params.protocol    || 'ctap2',
                transport:   params.transport   || 'internal',
                hasResidentKey:      params.residentKey    !== false,
                hasUserVerification: params.userVerification !== false,
                isUserVerified:      params.userVerified   !== false
              }
            });
            sendResponse({ success: true, data: `Virtual authenticator added: ${authenticatorId}` });
          } else if (action === 'remove') {
            await cdpC('WebAuthn.removeVirtualAuthenticator', { authenticatorId: params.authenticatorId });
            sendResponse({ success: true, data: `Authenticator ${params.authenticatorId} removed.` });
          } else if (action === 'list') {
            sendResponse({ success: true, data: 'Use action:"add" to create a virtual authenticator, then test passwordless login.' });
          }
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally {
          if (session) { try { await session.send('WebAuthn.disable'); } catch (_) {} session.release(); }
        }
      })(); return true;
    }

    if (executeAction === 'doubleClick') {
      // Content-script click/dblclick events are ALWAYS isTrusted:false — no
      // amount of synthetic dispatchEvent() can change that. Security-sensitive
      // actions like opening a file in Google Drive check isTrusted and simply
      // ignore fake events, so the old approach silently did nothing. The only
      // way to fire a click the page can't tell apart from a real one is the
      // Chrome DevTools Protocol (Input.dispatchMouseEvent), attached briefly
      // via chrome.debugger. If that's unavailable for any reason, we fall
      // straight back to the old synthetic-event double-click so nothing else
      // in the existing flow breaks.
      (async () => {
        const fallbackToSyntheticDoubleClick = () => {
          chrome.tabs.sendMessage(tabId, { action: 'agentExecute', executeAction, params }, (response) => {
            if (chrome.runtime.lastError) {
              clearAndInject(tabId)
                .then(() => {
                  chrome.tabs.sendMessage(tabId, { action: 'agentExecute', executeAction, params }, sendResponse);
                })
                .catch(err => sendResponse({ success: false, error: err.message }));
            } else {
              sendResponse(response);
            }
          });
        };

        try {
          // Ask the content script WHERE to click (element search only, no
          // click dispatched), injecting it first if it isn't loaded yet.
          const locate = async () => new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, { action: 'agentExecute', executeAction: 'locateForClick', params }, (response) => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
              else resolve(response);
            });
          });

          let loc;
          try {
            loc = await locate();
          } catch (_e) {
            await clearAndInject(tabId);
            loc = await locate();
          }

          if (!loc || !loc.success || typeof loc.x !== 'number' || typeof loc.y !== 'number') {
            fallbackToSyntheticDoubleClick();
            return;
          }

          const { x, y } = loc;
          let session;
          try { session = await cdpPool.acquire(tabId); } catch (_) { fallbackToSyntheticDoubleClick(); return; }
          try {
            const base = { x, y, button: 'left', buttons: 1 };
            await session.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed',  clickCount: 1 });
            await session.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', clickCount: 1 });
            await new Promise(r => setTimeout(r, 60));
            await session.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed',  clickCount: 2 });
            await session.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', clickCount: 2 });
            sendResponse({ success: true });
          } finally {
            if (session) session.release();
          }
        } catch (e) {
          console.warn('[SnapToAI Agent] Trusted double-click failed, falling back:', e && e.message);
          fallbackToSyntheticDoubleClick();
        }
      })();
      return true;
    }
    chrome.tabs.sendMessage(tabId, {
      action: 'agentExecute',
      executeAction,
      params
    }, (response) => {
      if (chrome.runtime.lastError) {
        // Try injecting content script first, then retry. allFrames:true also
        // reaches embedded iframes (e.g. a Google Docs/Drive preview pane) so
        // clicks/drags/scrolls can target content that lives inside them.
        clearAndInject(tabId).then(() => {
          chrome.tabs.sendMessage(tabId, {
            action: 'agentExecute',
            executeAction,
            params
          }, sendResponse);
        }).catch(err => {
          sendResponse({ success: false, error: err.message });
        });
      } else {
        sendResponse(response);
      }
    });
    return true;
  } else if (request.action === 'agentSnap') {
    // SNAP triggered by Agent automation - uses same pathway as SNAP button
    const { tabId } = request;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab ID provided' });
      return true;
    }
    
    // Must focus BOTH the window AND the tab for captureVisibleTab to work
    (async () => {
      try {
        // Get the tab to find its window
        const tab = await chrome.tabs.get(tabId);
        
        // Focus the window first
        await chrome.windows.update(tab.windowId, { focused: true });
        
        // Then activate the tab within that window
        await chrome.tabs.update(tabId, { active: true });
        
        // Wait for window and tab to be fully focused
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Use captureScreenshot with explicit tabId
        const result = await captureScreenshot(tabId);
        sendResponse(result);
      } catch (error) {
        sendResponse({ success: false, error: error.message || 'Capture failed' });
      }
    })();
    return true;
  } else if (request.action === 'agentCaptureTab') {
    // Capture screenshot for agent automation - with proper window focusing
    const { tabId } = request;
    (async () => {
      try {
        // Get the tab to find its window
        const tab = await chrome.tabs.get(tabId);
        
        // Focus the window first
        await chrome.windows.update(tab.windowId, { focused: true });
        
        // Then activate the tab
        await chrome.tabs.update(tabId, { active: true });
        
        // Wait for focus to complete
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Capture using the tab's windowId
        chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataUrl) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ success: true, dataUrl });
          }
        });
      } catch (error) {
        sendResponse({ success: false, error: error.message || 'Capture failed' });
      }
    })();
    return true;
  } else if (request.action === 'agentAddSnaps') {
    // Add multiple snaps from agent automation
    const { images } = request;
    getSnaps().then(async (currentSnaps) => {
      const newSnaps = [...(currentSnaps || [])];
      for (const img of images) {
        if (newSnaps.length < MAX_SNAPS) {
          newSnaps.push(img);
        }
      }
      await setSnaps(newSnaps);
      sendResponse({ success: true, count: newSnaps.length });
    });
    return true;
  } else if (request.action === 'agentFullPageCapture') {
    // Full page capture triggered by Agent automation
    // Uses the same startFullPageCapture() function but with explicit tabId
    const { tabId } = request;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab ID provided' });
      return true;
    }
    
    // Must focus BOTH the window AND the tab for full page capture to work
    (async () => {
      try {
        // Get the tab to find its window
        const tab = await chrome.tabs.get(tabId);
        
        // Focus the window first
        await chrome.windows.update(tab.windowId, { focused: true });
        
        // Then activate the tab within that window
        await chrome.tabs.update(tabId, { active: true });
        
        // Wait for window and tab to be fully focused
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Pass tabId to startFullPageCapture so it uses the correct tab
        const result = await startFullPageCapture(tabId);
        sendResponse(result);
      } catch (error) {
        sendResponse({ success: false, error: error.message || 'Capture failed' });
      }
    })();
    return true;
  } else if (request.action === 'fullPageCaptureStep') {
    // Capture a single step during full page capture
    captureFullPageStep(request.tabId).then(sendResponse);
    return true;
  } else if (request.action === 'fullPageCaptureBatch') {
    // Receive batch of large capture (images in batches of 30)
    console.log(`[SnapToAI] Received batch ${request.batchIndex + 1}/${request.totalBatches}`);
    
    // Initialize buffer on first batch
    if (request.batchIndex === 0) {
      batchBuffer = [];
      batchMetadata = {
        viewportWidth: request.viewportWidth,
        viewportHeight: request.viewportHeight,
        isAIPlatform: request.isAIPlatform,
        pageUrl: request.pageUrl,
        pageTitle: request.pageTitle,
        totalBatches: request.totalBatches
      };
    }
    
    // Add screenshots from this batch
    batchBuffer.push(...request.screenshots);
    
    // If all batches received, finalize
    if (request.batchIndex === request.totalBatches - 1) {
      console.log(`[SnapToAI] All ${request.totalBatches} batches received (${batchBuffer.length} total images)`);
      finalizeFullPageCapture(
        batchBuffer,
        batchMetadata.viewportWidth,
        batchMetadata.viewportHeight,
        batchMetadata.isAIPlatform,
        batchMetadata.pageUrl,
        batchMetadata.pageTitle
      ).then(sendResponse);
      // Clear buffer
      batchBuffer = [];
      batchMetadata = null;
    } else {
      sendResponse({ success: true, waiting: true });
    }
    return true;
  } else if (request.action === 'fullPageCaptureComplete') {
    // Stitch and save full page capture (now includes page URL for browser frame)
    finalizeFullPageCapture(request.screenshots, request.viewportWidth, request.viewportHeight, request.isAIPlatform, request.pageUrl, request.pageTitle).then(sendResponse);
    return true;
  } else if (request.action === 'fullPageStitchComplete' || request.action === 'fullPageStitchFailed') {
    // Full page capture cycle complete (success or failure) - reset the flag.
    // We MUST await loadAndApplyUiMode before sendResponse so the MV3 service
    // worker stays alive long enough for the popup/sidebar toggle to apply.
    isFullPageCaptureInProgress = false;
    fullPageCapturePort = null;
    loadAndApplyUiMode().finally(() => {
      console.log('[SnapToAI] Full page capture completed, flag reset, UI mode restored');
      sendResponse({ success: true });
    });
    return true;
  } else if (request.action === 'fullPageCaptureAborted') {
    // Timeout/abort from popup - reset capture state and notify content script
    isFullPageCaptureInProgress = false;
    fullPageCapturePort = null;
    
    // SET ABORT FLAG IN STORAGE (reliable even if message fails)
    chrome.storage.session.set({ abortFullPageCapture: Date.now() }).catch(() => {});
    
    // Try to notify content script to stop scrolling
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'abortFullPageCapture' }).catch(() => {
          // Content script may not be running - that's fine
        });
      }
    }).catch(() => {});
    
    // Awaited so the worker doesn't go idle before mode is restored
    loadAndApplyUiMode().finally(() => {
      console.log('[SnapToAI] Full page capture aborted, UI mode restored');
      sendResponse({ success: true });
    });
    return true;
  } else if (request.action === 'getSettings') {
    // Get current settings
    getSettings().then(sendResponse);
    return true;
  } else if (request.action === 'downloadImage') {
    // Download image with settings
    downloadImage(request.dataUrl, request.filename, request.options).then(sendResponse);
    return true;
  } else if (request.action === 'downloadMultiple') {
    // Download multiple images
    downloadMultipleImages(request.images).then(sendResponse);
    return true;
  } else if (request.action === 'copyToClipboard') {
    // Copy image to clipboard with Google Docs limit check
    copyToClipboardWithLimit(request.dataUrl).then(sendResponse);
    return true;
  }
});

// Listen for port connections from popup for full page capture
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'fullPageCapture') {
    fullPageCapturePort = port;
    
    // When popup disconnects (closes, navigates away, crashes), reset the flag immediately
    port.onDisconnect.addListener(() => {
      if (isFullPageCaptureInProgress) {
        console.log('[SnapToAI] Popup disconnected during full page capture - resetting flag');
        isFullPageCaptureInProgress = false;
        fullPageCapturePort = null;
        // Returning the promise into the chain keeps the serialization
        // guard happy; we can't await here (event listener is sync) but
        // the chain in applyUiMode will still serialize subsequent calls.
        loadAndApplyUiMode().catch(() => {});
      }
    });
  }
});

// Capture screenshot of active tab
// Optional targetTabId parameter for agent automation
async function captureScreenshot(targetTabId = null) {
  try {
    // BIDIRECTIONAL COOLDOWN: snap captures and sidebar live-preview
    // captures share Chrome's underlying captureVisibleTab rate limit,
    // so we gate snap on BOTH lastCaptureTime (snap-to-snap) AND
    // lastSidebarPreviewAt (preview-to-snap). Timers update only AFTER
    // a successful captureVisibleTab so failed snaps don't impose a
    // false cooldown on the next attempt.
    const now = Date.now();
    const timeSinceLastCapture = now - lastCaptureTime;
    const timeSinceLastPreview = now - lastSidebarPreviewAt;
    const gap = Math.min(timeSinceLastCapture, timeSinceLastPreview);
    if (gap < CAPTURE_COOLDOWN) {
      const remainingTime = Math.max(1, Math.ceil((CAPTURE_COOLDOWN - gap) / 1000));
      console.log(`Capture on cooldown (gap=${gap}ms). Wait ${remainingTime}s`);
      return { 
        success: false, 
        error: `Please wait ${remainingTime} second${remainingTime > 1 ? 's' : ''} before capturing again` 
      };
    }
    
    // Get tab - either the provided tabId or the active tab
    let tab;
    if (targetTabId) {
      tab = await chrome.tabs.get(targetTabId);
    } else {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = activeTab;
    }
    
    // Re-inject content script to handle iframe-heavy sites like Grok
    // This ensures the content script is fresh and ready for toast display
    try {
      await clearAndInject(tab.id, true);
    } catch (injectError) {
      // Ignore injection errors (e.g., chrome:// pages)
      console.log('Content script injection skipped:', injectError.message);
    }
    
    // Small delay to let DOM be ready after injection
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Capture visible tab as PNG
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    
    // Update BOTH cooldown timers AFTER successful capture so the
    // sidebar live-preview won't race with this snap on the next tick.
    const captureCompletedAt = Date.now();
    lastCaptureTime = captureCompletedAt;
    lastSidebarPreviewAt = captureCompletedAt;
    
    // Get current snaps
    const snaps = await getSnaps();
    const snapCount = snaps.length;
    
    // Block capture if queue is full - user must delete to make room
    if (snapCount >= MAX_SNAPS) {
      return { 
        success: false, 
        error: `Queue full (${MAX_SNAPS}/${MAX_SNAPS}). Delete some images first.`,
        queueFull: true
      };
    }
    
    // Add new snap
    snaps.push(dataUrl);
    
    // Save to session storage
    await chrome.storage.local.set({ snaps });
    
    // Store the captured page URL for the editor's browser frame feature (for SNAP mode)
    await chrome.storage.session.set({ 
      lastCapturedPageUrl: tab.url || '',
      lastCapturedPageTitle: tab.title || 'Untitled Page'
    });
    
    // Update badge
    await updateBadge(snaps.length);
    
    // Show toast on the page and provide dataUrl for clipboard
    const newSnapNumber = snaps.length;
    chrome.tabs.sendMessage(tab.id, {
      action: 'captureComplete',
      message: `Snap ${newSnapNumber} ✓`,
      snapNumber: newSnapNumber
    }).catch(() => {
      // Content script might not be ready, ignore
    });
    
    return { success: true, count: snaps.length, dataUrl };
  } catch (error) {
    console.log('Capture failed:', error.message);
    
    // Check for storage quota exceeded error
    if (error.message && (error.message.includes('QUOTA') || error.message.includes('quota') || error.message.includes('exceeded'))) {
      return { 
        success: false, 
        error: 'Storage full! Delete some images first.',
        storageFull: true
      };
    }
    
    return { success: false, error: error.message };
  }
}

// Handle upload to AI platform
async function handleUpload(preferredPlatform = 'auto', selectedSnaps = null) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url);
    const hostname = url.hostname;
    
    // Check if current tab is an AI site
    const isAISite = AI_SITES.some(site => hostname.includes(site));
    
    if (!isAISite) {
      return { success: false, error: 'Not on an AI platform' };
    }
    
    // If selectedSnaps provided, use those; otherwise get all snaps
    let snapsToUpload;
    if (selectedSnaps && selectedSnaps.length > 0) {
      // Use provided selected snaps
      snapsToUpload = selectedSnaps;
      // Temporarily store selected snaps for content script
      await chrome.storage.local.set({ selectedSnapsForUpload: snapsToUpload });
    } else {
      // Get all snaps from storage
      const allSnaps = await getSnaps();
      if (allSnaps.length === 0) {
        return { success: false, error: 'No snaps to upload' };
      }
      snapsToUpload = allSnaps;
    }
    
    // Determine target platform: use preferred if set, otherwise current hostname
    let targetPlatform = hostname;
    if (preferredPlatform && preferredPlatform !== 'auto') {
      // Map selection to hostname for content script selectors
      if (preferredPlatform === 'chatgpt.com') {
        targetPlatform = 'chatgpt.com';
      } else if (preferredPlatform === 'claude.ai') {
        targetPlatform = 'claude.ai';
      } else if (preferredPlatform === 'grok.com') {
        targetPlatform = 'grok.com';
      }
    }
    
    // Smart AI Payload: Try to get page text for hybrid mode
    let pageData = null;
    let useHybridPayload = false;
    
    try {
      pageData = await chrome.tabs.sendMessage(tab.id, { action: 'get_page_text' });
      useHybridPayload = pageData && pageData.text && pageData.text.length >= 800;
    } catch (err) {
      console.log('[SnapToAI] Could not get text, using images only');
    }
    
    // Store to Session Locker (MV3-safe, clears on tab close)
    await chrome.storage.session.set({
      aiText: useHybridPayload ? pageData.text : null,
      aiTitle: useHybridPayload ? pageData.title : null,
      payloadMode: useHybridPayload ? 'hybrid' : 'images'
    });
    
    if (useHybridPayload) {
      console.log('[SnapToAI] Hybrid payload:', pageData.text.length, 'chars');
    }
    
    // Send upload command to content script with payload mode
    await chrome.tabs.sendMessage(tab.id, {
      action: 'beginUpload',
      platform: targetPlatform,
      useSelectedOnly: selectedSnaps !== null,
      payloadMode: useHybridPayload ? 'hybrid' : 'images'
    });
    
    return { success: true, count: snapsToUpload.length };
  } catch (error) {
    console.log('[SnapToAI] Upload:', error.message || error);
    return { success: false, error: error.message };
  }
}

// Get all snaps from session storage
async function getSnaps() {
  const result = await chrome.storage.local.get('snaps');
  return result.snaps || [];
}

// Get snap count
async function getSnapCount() {
  const snaps = await getSnaps();
  return snaps.length;
}

// Clear all snaps
async function clearSnaps() {
  await chrome.storage.local.remove(['snaps', 'snapMetadata']);
  await updateBadge(0);
  return { success: true };
}

// Set snaps (for individual delete) - also update metadata
async function setSnaps(snaps, metadata = null) {
  if (metadata !== null) {
    await chrome.storage.local.set({ snaps, snapMetadata: metadata });
  } else {
    await chrome.storage.local.set({ snaps });
  }
  await updateBadge(snaps.length);
  return { success: true };
}

// Delete a single snap by index
async function deleteSnapByIndex(index) {
  try {
    const snaps = await getSnaps();
    const result = await chrome.storage.local.get({ snapMetadata: [] });
    const snapMetadata = result.snapMetadata || [];
    
    if (index < 0 || index >= snaps.length) {
      return { success: false, error: 'Invalid index' };
    }
    
    // Remove the snap at the specified index
    snaps.splice(index, 1);
    
    // Also remove the metadata at the same index if it exists
    if (snapMetadata.length > index) {
      snapMetadata.splice(index, 1);
    }
    
    // Save updated arrays
    await chrome.storage.local.set({ snaps, snapMetadata });
    await updateBadge(snaps.length);
    
    return { success: true, count: snaps.length };
  } catch (error) {
    console.log('[SnapToAI] Delete snap error:', error);
    return { success: false, error: error.message };
  }
}

// Track last saved image to prevent duplicates
let lastSavedImageHash = null;
let lastSaveTime = 0;
const DUPLICATE_WINDOW = 5000; // 5 second window to detect duplicates

// Simple hash function for duplicate detection
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < Math.min(str.length, 1000); i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

// Add snip (cropped image) as new snap with optional chunk metadata
async function addSnip(dataUrl, metadata = null) {
  try {
    // Get current snaps and metadata
    const snaps = await getSnaps();
    const result = await chrome.storage.local.get({ snapMetadata: [] });
    const snapMetadata = result.snapMetadata || [];
    
    // Block snip if queue is full - user must delete to make room
    if (snaps.length >= MAX_SNAPS) {
      return { 
        success: false, 
        error: `Queue full (${MAX_SNAPS}/${MAX_SNAPS}). Delete some images first.`,
        queueFull: true
      };
    }
    
    // Check for duplicate save within time window (skip for chunked saves)
    if (!metadata?.isChunk) {
      const now = Date.now();
      const imageHash = simpleHash(dataUrl);
      if (imageHash === lastSavedImageHash && (now - lastSaveTime) < DUPLICATE_WINDOW) {
        console.log('[SnapToAI] Duplicate image detected, skipping save');
        return { success: true, count: snaps.length, duplicate: true };
      }
      
      // Update duplicate detection state
      lastSavedImageHash = imageHash;
      lastSaveTime = now;
    }
    
    // Add new snip
    snaps.push(dataUrl);
    
    // Add metadata (null for regular snaps, chunk info for chunked captures)
    snapMetadata.push(metadata);
    
    // Save to local storage
    await chrome.storage.local.set({ snaps, snapMetadata });
    
    // Update badge
    await updateBadge(snaps.length);
    
    // Notify popup about saved snip (for preview)
    chrome.runtime.sendMessage({ 
      action: 'snipSaved', 
      dataUrl: dataUrl,
      metadata: metadata
    }).catch(() => {});
    
    return { success: true, count: snaps.length };
  } catch (error) {
    console.log('[SnapToAI] Snip:', error.message || error);
    
    // Check for storage quota exceeded error
    if (error.message && (error.message.includes('QUOTA') || error.message.includes('quota') || error.message.includes('storage'))) {
      return { 
        success: false, 
        error: 'Storage full! Delete some images to make room for new captures.',
        storageFull: true
      };
    }
    
    return { success: false, error: error.message };
  }
}

// Update extension badge (disabled for cleaner icon look)
async function updateBadge(count) {
  await chrome.action.setBadgeText({ text: '' });
}

// Initialize badge on startup
chrome.runtime.onStartup.addListener(async () => {
  const count = await getSnapCount();
  await updateBadge(count);
  await loadAndApplyUiMode();
});

// Update badge when extension icon is clicked
chrome.action.onClicked.addListener(async () => {
  const count = await getSnapCount();
  await updateBadge(count);
});

// ============================================
// FULL PAGE CAPTURE FUNCTIONS
// ============================================

// Check if a URL is capturable (not a restricted page)
function isCapturableUrl(url) {
  if (!url) return false;
  const restrictedPrefixes = [
    'chrome://',
    'chrome-extension://',
    'about:',
    'edge://',
    'brave://',
    'opera://',
    'vivaldi://',
    'file://',
    'view-source:',
    'devtools://',
    'chrome-search://'
  ];
  const restrictedDomains = [
    'chrome.google.com/webstore',
    'chromewebstore.google.com',
    'addons.mozilla.org',
    'youtube.com',
    'www.youtube.com'
  ];
  
  const lowerUrl = url.toLowerCase();
  
  // Check prefixes
  for (const prefix of restrictedPrefixes) {
    if (lowerUrl.startsWith(prefix)) return false;
  }
  
  // Check domains
  for (const domain of restrictedDomains) {
    if (lowerUrl.includes(domain)) return false;
  }
  
  return true;
}

// Start full page capture process
// Optional targetTabId parameter for agent automation
async function startFullPageCapture(targetTabId = null) {
  try {
    // Check if capture already in progress
    if (isFullPageCaptureInProgress) {
      return { 
        success: false, 
        error: 'Full page capture already in progress. Please wait.',
        isExpected: true
      };
    }
    
    // Check if queue has space
    const snaps = await getSnaps();
    if (snaps.length >= MAX_SNAPS) {
      return { 
        success: false, 
        error: `Queue full (${MAX_SNAPS}/${MAX_SNAPS}). Delete some images first.`,
        isExpected: true
      };
    }
    
    // Get tab - either the provided tabId or the active tab
    let tab;
    if (targetTabId) {
      tab = await chrome.tabs.get(targetTabId);
    } else {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = activeTab;
    }
    
    // Check if this is a capturable page
    if (!isCapturableUrl(tab.url)) {
      console.log('[SnapToAI] Cannot capture this page type:', tab.url?.split('/')[0] || 'unknown');
      return { 
        success: false, 
        error: 'Cannot capture this page. Works on regular websites only.',
        isExpected: true
      };
    }
    
    // Set capture in progress flag
    isFullPageCaptureInProgress = true;
    
    // DISABLE POPUP so icon click can abort capture
    await chrome.action.setPopup({ popup: '' });
    console.log('[SnapToAI] Popup disabled - click icon to abort capture');
    
    // Check if this is an AI platform (Grok, ChatGPT, Claude, etc.)
    const isAIPlatform = AI_SITES.some(site => tab.url.includes(site));
    
    // Inject content script - use allFrames for AI platforms with nested iframes
    try {
      await clearAndInject(tab.id, isAIPlatform);
      console.log(`[SnapToAI] Content script injected (allFrames: ${isAIPlatform})`);
    } catch (e) {
      console.log('[SnapToAI] Content script injection skipped:', e.message);
    }
    
    // Longer delay for AI platforms (they need time to settle after injection)
    await new Promise(resolve => setTimeout(resolve, isAIPlatform ? 300 : 100));
    
    // Send message to content script to start scrolling and capturing
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'startFullPageScroll',
        tabId: tab.id
      });
    } catch (msgError) {
      console.log('[SnapToAI] Cannot access this page');
      isFullPageCaptureInProgress = false;
      await loadAndApplyUiMode(); // Awaited: ensure UI mode restored before returning
      return { 
        success: false, 
        error: 'Cannot capture this page. Works on regular websites only.',
        isExpected: true
      };
    }
    
    return { success: true };
  } catch (error) {
    console.log('[SnapToAI] Capture not available:', error.message);
    isFullPageCaptureInProgress = false; // Reset on error
    await loadAndApplyUiMode(); // Awaited: ensure UI mode restored before returning
    return { 
      success: false, 
      error: 'Cannot capture this page. Works on regular websites only.',
      isExpected: true
    };
  }
}

// Capture a single viewport during full page capture
async function captureFullPageStep(tabId) {
  try {
    // Reduced from 500ms → 100ms: content script's waitForScrollStabilization already
    // confirms the layout has fully settled before requesting capture, so only a
    // lightweight paint-cycle buffer is needed here. Speeds up long captures significantly.
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Get the tab info using the provided tabId (more reliable than querying active tab)
    const tab = await chrome.tabs.get(tabId);
    
    // Capture using the tab's windowId - with retry logic for permission issues
    let dataUrl;
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch (captureError) {
      // If first attempt fails, retry with null windowId (current window)
      console.log('[SnapToAI] Retrying capture with current window...');
      dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    }
    
    return { success: true, dataUrl };
  } catch (error) {
    console.log('[SnapToAI] Capture step error:', error.message || error);
    return { success: false, error: error.message };
  }
}

// Finalize full page capture - stitch images and save to queue
async function finalizeFullPageCapture(screenshots, viewportWidth, viewportHeight, isAIPlatform = false, pageUrl = '', pageTitle = '') {
  try {
    if (!screenshots || screenshots.length === 0) {
      isFullPageCaptureInProgress = false;
      await loadAndApplyUiMode();
      return { success: false, error: 'No screenshots to stitch' };
    }
    
    // Get current snaps
    const snaps = await getSnaps();
    
    // Block if queue is full
    if (snaps.length >= MAX_SNAPS) {
      isFullPageCaptureInProgress = false;
      await loadAndApplyUiMode();
      return { 
        success: false, 
        error: `Queue full (${MAX_SNAPS}/${MAX_SNAPS}). Delete some images first.` 
      };
    }
    
    // Store the captured page URL for the editor's browser frame feature
    await chrome.storage.session.set({ 
      lastCapturedPageUrl: pageUrl || '',
      lastCapturedPageTitle: pageTitle || 'Untitled Page'
    });
    
    // Try to send to popup for stitching first
    // Pass isAIPlatform flag so stitching uses correct overlap (0% for AI, 10% for regular)
    try {
      await chrome.runtime.sendMessage({
        action: 'stitchFullPage',
        screenshots,
        viewportWidth,
        viewportHeight,
        isAIPlatform,
        pageUrl,
        pageTitle
      });
      return { success: true, pending: true };
    } catch (popupError) {
      // Popup isn't open - use annotate.html with autoSave for high-quality stitching
      console.log('[SnapToAI] Popup not open, using annotate.html with autoSave...');
      
      try {
        // Store screenshots same way popup does (annotate.html reads from here)
        await chrome.storage.local.set({ 
          fullPageScreenshots: screenshots,
          fullPageViewportWidth: viewportWidth,
          fullPageViewportHeight: viewportHeight,
          fullPageIsAIPlatform: isAIPlatform
        });
        
        // Check if we're in batch mode
        const { batchContext } = await chrome.storage.session.get(['batchContext']);
        
        if (batchContext) {
          // Batch mode: Open editor visible with batch params (no autoSave)
          const batchParams = `batchCurrent=${batchContext.current}&batchTotal=${batchContext.total}&batchUrl=${encodeURIComponent(batchContext.url || '')}`;
          chrome.windows.create({
            url: `annotate.html?mode=fullpage&${batchParams}`,
            type: 'popup',
            width: 1200,
            height: 800,
            left: 50,
            top: 50,
            focused: true
          });
        } else {
          // Normal mode: Open small unfocused window for autoSave processing
          // Use safe bounds (left/top) to avoid "Bounds must be 50% within visible screen" error
          chrome.windows.create({
            url: 'annotate.html?mode=fullpage&autoSave=true',
            type: 'popup',
            width: 400,
            height: 300,
            left: 50,
            top: 50,
            focused: false
          });
        }
        
        return { success: true, pending: true };
      } catch (autoSaveError) {
        console.log('[SnapToAI] AutoSave error:', autoSaveError.message);
        isFullPageCaptureInProgress = false;
        await loadAndApplyUiMode();
        return { success: false, error: autoSaveError.message };
      }
    }
  } catch (error) {
    console.log('[SnapToAI] Finalize:', error.message || error);
    isFullPageCaptureInProgress = false;
    await loadAndApplyUiMode();
    return { success: false, error: error.message };
  }
}

// Reset full page capture state (called when stitch completes or fails)
async function resetFullPageCaptureState() {
  isFullPageCaptureInProgress = false;
  // Re-apply user UI mode preference instead of hard-resetting to popup
  await loadAndApplyUiMode();
}

// ============================================
// DOWNLOAD FUNCTIONS
// ============================================

// Download a single image
async function downloadImage(dataUrl, filename = null, options = {}) {
  try {
    const settings = await getSettings();
    
    // Generate filename if not provided
    if (!filename) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const format = settings.imageFormat === 'jpeg' ? 'jpg' : 'png';
      filename = `Aion_${timestamp}.${format}`;
    }
    
    // Build full path with directory setting
    let fullPath = filename;
    if (settings.downloadDirectory) {
      fullPath = `${settings.downloadDirectory}/${filename}`;
    }
    
    // Convert format if needed
    let finalDataUrl = dataUrl;
    if (settings.imageFormat === 'jpeg' && dataUrl.includes('image/png')) {
      finalDataUrl = await convertToJpeg(dataUrl, settings.jpegQuality);
    }
    
    // Download options
    const downloadOptions = {
      url: finalDataUrl,
      filename: fullPath,
      saveAs: settings.showSaveAs
    };
    
    // Use chrome.downloads API
    const downloadId = await chrome.downloads.download(downloadOptions);
    
    return { success: true, downloadId, filename: fullPath };
  } catch (error) {
    console.log('[SnapToAI] Download:', error.message || error);
    return { success: false, error: error.message };
  }
}

// Download multiple images
async function downloadMultipleImages(images) {
  try {
    const settings = await getSettings();
    const results = [];
    
    for (let i = 0; i < images.length; i++) {
      const { dataUrl, filename } = images[i];
      
      // Generate filename with index
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const format = settings.imageFormat === 'jpeg' ? 'jpg' : 'png';
      const finalFilename = filename || `Aion_${timestamp}_${i + 1}.${format}`;
      
      // Build full path
      let fullPath = finalFilename;
      if (settings.downloadDirectory) {
        fullPath = `${settings.downloadDirectory}/${finalFilename}`;
      }
      
      // Convert format if needed
      let finalDataUrl = dataUrl;
      if (settings.imageFormat === 'jpeg' && dataUrl.includes('image/png')) {
        finalDataUrl = await convertToJpeg(dataUrl, settings.jpegQuality);
      }
      
      // Download (no saveAs for multiple files)
      const downloadId = await chrome.downloads.download({
        url: finalDataUrl,
        filename: fullPath,
        saveAs: false // Never show saveAs for batch downloads
      });
      
      results.push({ success: true, downloadId, filename: fullPath });
      
      // Small delay between downloads to prevent issues
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return { success: true, results };
  } catch (error) {
    console.log('[SnapToAI] Download:', error.message || error);
    return { success: false, error: error.message };
  }
}

// Convert PNG to JPEG with quality setting (service worker compatible)
async function convertToJpeg(pngDataUrl, quality) {
  try {
    // Fetch the data URL as a blob
    const response = await fetch(pngDataUrl);
    const blob = await response.blob();
    
    // Use createImageBitmap (available in service workers)
    const imageBitmap = await createImageBitmap(blob);
    
    // Create offscreen canvas
    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    // Fill white background (JPEG doesn't support transparency)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imageBitmap, 0, 0);
    
    // Convert to JPEG blob
    const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality / 100 });
    
    // Convert blob to data URL
    return await blobToDataUrl(jpegBlob);
  } catch (error) {
    console.log('[SnapToAI] JPEG:', error.message || error);
    return pngDataUrl; // Return original if conversion fails
  }
}

// Copy to clipboard with Google Docs limit (service worker compatible)
// Note: Clipboard operations need to be done via content script
async function copyToClipboardWithLimit(dataUrl) {
  try {
    const settings = await getSettings();
    
    // Get image dimensions using createImageBitmap
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);
    
    const pixels = imageBitmap.width * imageBitmap.height;
    const GOOGLE_DOCS_LIMIT = 25000000; // 25 million pixels
    
    let finalDataUrl = dataUrl;
    let resized = false;
    
    // Resize if needed and setting is enabled
    if (settings.fitGoogleDocsLimit && pixels > GOOGLE_DOCS_LIMIT) {
      const scale = Math.sqrt(GOOGLE_DOCS_LIMIT / pixels);
      const newWidth = Math.floor(imageBitmap.width * scale);
      const newHeight = Math.floor(imageBitmap.height * scale);
      
      const canvas = new OffscreenCanvas(newWidth, newHeight);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(imageBitmap, 0, 0, newWidth, newHeight);
      
      const resizedBlob = await canvas.convertToBlob({ type: 'image/png' });
      finalDataUrl = await blobToDataUrl(resizedBlob);
      resized = true;
      
      console.log(`[SnapToAI] Resized from ${imageBitmap.width}x${imageBitmap.height} to ${newWidth}x${newHeight} for Google Docs`);
    }
    
    // Return the dataUrl - clipboard write must be done in content script/popup
    return { 
      success: true, 
      dataUrl: finalDataUrl,
      resized: resized,
      originalPixels: pixels,
      limitPixels: GOOGLE_DOCS_LIMIT
    };
  } catch (error) {
    console.log('[SnapToAI] Resize:', error.message || error);
    return { success: false, error: error.message, dataUrl: dataUrl };
  }
}

// Helper: Get image dimensions (service worker compatible)
async function getImageDimensions(dataUrl) {
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);
    return { width: imageBitmap.width, height: imageBitmap.height };
  } catch (error) {
    console.log('[SnapToAI] Dimensions:', error.message || error);
    return { width: 0, height: 0 };
  }
}

// Helper: Convert blob to data URL (service worker compatible)
async function blobToDataUrl(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return `data:${blob.type};base64,${base64}`;
}

// ── Resilient Service Worker Checkpoints ────────────────────────────────────
// MV3 background service workers are ephemeral — they can be terminated mid-task
// by the browser (especially during 30-60 second Autopilot sequences). Saving
// state to chrome.storage.session (survives SW restarts, cleared on browser quit)
// lets the agent resume exactly where it left off instead of losing its place.

// ── Post-type DOM verification ────────────────────────────────────────────────
// After Input.insertText we check whether the text actually landed in the
// focused element.  Returns true if verified (or if the check itself can't run),
// false if the element is provably empty after typing.
async function verifyTextInPage(tabId, sample) {
  if (!sample || sample.length === 0) return true;
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: (s) => {
        // Walk shadow roots to reach the truly active leaf element
        function deepActive(root) {
          const ae = root.activeElement;
          return (ae && ae.shadowRoot) ? deepActive(ae.shadowRoot) : ae;
        }
        const el = deepActive(document);
        if (!el) return true; // can't verify — assume ok
        const content = el.value ?? el.textContent ?? el.innerText ?? '';
        return content.includes(s);
      },
      args: [sample]
    });
    const result = res?.[0]?.result;
    return result !== false; // treat undefined/null as ok (verify failed to run)
  } catch (_) {
    return true; // executeScript blocked (e.g. CSP) — assume ok
  }
}

async function saveAgentCheckpoint(tabId, state) {
  try {
    await chrome.storage.session.set({
      [`agent_checkpoint_${tabId}`]: {
        state,
        timestamp: Date.now()
      }
    });
  } catch (e) {
    console.error('[Aion] Failed to save session checkpoint:', e);
  }
}

async function resumeAgentCheckpoint(tabId) {
  try {
    const key = `agent_checkpoint_${tabId}`;
    const result = await chrome.storage.session.get([key]);
    const checkpoint = result[key];
    // Only restore if the checkpoint is recent (under 5 minutes old);
    // stale checkpoints from a previous browsing session are discarded.
    if (checkpoint && (Date.now() - checkpoint.timestamp < 300000)) {
      console.log('[Aion] Resuming previous task from session checkpoint');
      return checkpoint.state;
    }
  } catch (e) {
    console.error('[Aion] Failed to read session checkpoint:', e);
  }
  return null;
}
