// SnapToAI Background Service Worker
// Handles screenshot capture, storage management, downloads, and messaging

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
    files: ['content.js']
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
  if (command === 'capture') {
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
  } else if (request.action === 'agentExecute') {
    // Relay agent automation command to the target tab
    const { tabId, executeAction, params } = request;

    if (!tabId) {
      sendResponse({ success: false, error: 'No tab ID provided' });
      return;
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
                    showBanner('✅ Aion: paste sent');
                    return { success: true, method: 'ctrl-v-fallback' };
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
            if (tabHost.includes('word.office.com') || tabHost.includes('word.live.com')) {
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
            // ── Google AI / Gemini ecosystem ──────────────────────────────────
            || tabHostname.includes('aistudio.google.com')   // AI Studio (app builder)
            || tabHostname.includes('gemini.google.com')     // Gemini chat
            || tabHostname.includes('makersuite.google.com') // AI Studio (old name)
            || tabHostname.includes('notebooklm.google.com') // NotebookLM
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
            runFallbackType();
            return;
          }

          const { x, y, mode } = loc;

          // Attach CDP. Fails if DevTools is already open on this tab.
          const debuggee = { tabId };
          try {
            await chrome.debugger.attach(debuggee, '1.3');
          } catch (attachErr) {
            console.warn('[Aion Agent] CDP attach failed:', attachErr.message);
            runFallbackType();
            return;
          }

          try {
            // send: fire a CDP command, resolve when done (no return value needed)
            const send = (method, p) => new Promise((resolve, reject) => {
              chrome.debugger.sendCommand(debuggee, method, p, () => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve();
              });
            });

            // sendR: fire a CDP command AND return its result object
            const sendR = (method, p) => new Promise((resolve, reject) => {
              chrome.debugger.sendCommand(debuggee, method, p, (res) => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(res);
              });
            });

            const text      = String(params.text ?? '');
            const isDocs    = tabHostname.includes('docs.google.com') && tabPath.includes('/document/');
            const isGrid    = (mode === 'sheets');
            const isExcel   = (mode === 'excel');
            const isAiStudio = (mode === 'aistudio');

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

            if (isAiStudio) {
              // ── GOOGLE AI STUDIO ──────────────────────────────────────────────
              // CDP mouse click focuses the textarea, then Input.insertText drops
              // the whole string in one shot — no char-by-char, no "Illegal invocation".
              // This is the only method that works reliably on React-controlled inputs.
              await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
              await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: 1 });
              await new Promise(r => setTimeout(r, 300));
              if (params.clearFirst) {
                await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
                await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
                await new Promise(r => setTimeout(r, 80));
                await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
                await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
                await new Promise(r => setTimeout(r, 80));
              }
              // Input.insertText sends the full string as a single trusted insertion —
              // React's synthetic event system receives it as a normal user input.
              await send('Input.insertText', { text });
              sendResponse({ success: true });

            } else if (isDocs) {
              // ── GOOGLE DOCS ──────────────────────────────────────────────────
              // Focus the hidden texteventtarget-iframe body via Runtime.evaluate
              // so CDP char events land in Docs' own keyboard router.
              await send('Runtime.enable', {});
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
              // If a target cell is specified, navigate there via the Name Box first.
              // The Sheets Name Box is a real DOM input — focus it, type the address,
              // press Enter, wait for the grid to scroll to that cell.
              const sheetsCell = (params.cell && /^[A-Za-z]+\d+$/.test(params.cell.trim()))
                ? params.cell.trim().toUpperCase()
                : null;
              if (sheetsCell) {
                await send('Runtime.enable', {});
                await sendR('Runtime.evaluate', {
                  expression: `(async () => {
                    const sleep = ms => new Promise(r => setTimeout(r, ms));
                    // Sheets Name Box selectors
                    const nb = document.querySelector(
                      '#t-name-box-input, .docs-input-label-input, input[aria-label*="cell"], ' +
                      '.t-name-box-input, div.cell-input input, .goog-toolbar-combo-button input'
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
              // Double-click enters edit mode; then use keyDown+text (more reliable
              // than char events for Sheets' canvas input handler).
              for (let ci = 1; ci <= 2; ci++) {
                await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: ci });
                await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: ci });
                if (ci < 2) await new Promise(r => setTimeout(r, 100));
              }
              await new Promise(r => setTimeout(r, 200));
              for (const ch of text) {
                if (ch === '\n') {
                  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
                  await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
                } else if (ch === '\t') {
                  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
                  await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
                } else {
                  await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch });
                  await send('Input.dispatchKeyEvent', { type: 'keyUp',   text: ch, unmodifiedText: ch });
                }
              }

            } else {
              // ── WORD ONLINE / other canvas apps ──────────────────────────────
              await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
              await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: 1 });
              await new Promise(r => setTimeout(r, 200));
              await typeChars(text);
            }

            // Sheets / Excel: press Enter to COMMIT the cell value.
            if ((isGrid || isExcel) && params.pressEnter !== false) {
              await new Promise(r => setTimeout(r, 100));
              await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
              await send('Input.dispatchKeyEvent', { type: 'keyUp',     key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
            }

            sendResponse({ success: true });
          } finally {
            chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
          }
        } catch (e) {
          console.warn('[Aion Agent] CDP type failed, using paste fallback:', e && e.message);
          runFallbackType();
        }
      })();
      return true;
    }
    if (executeAction === 'click') {
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

        // ── Step 1: DOM text search via content.js ────────────────────────
        let loc = null;
        try { loc = await locateViaContent(); } catch (_) {}
        if (!loc) {
          try { await clearAndInject(tabId); loc = await locateViaContent(); } catch (_) {}
        }

        const debuggee = { tabId };
        let attached = false;
        try {
          await chrome.debugger.attach(debuggee, '1.3');
          attached = true;
        } catch (_) {
          // DevTools open — fall straight to synthetic
          fallbackSynthetic();
          return;
        }

        const cdpCmd = (method, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, method, p || {}, (r) => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });

        const cdpMouseClick = async (x, y) => {
          const base = { x, y, button: 'left', buttons: 1, clickCount: 1 };
          await cdpCmd('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
          await cdpCmd('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
        };

        try {
          if (loc && typeof loc.x === 'number') {
            // Content.js found it — click using trusted CDP events
            await cdpMouseClick(loc.x, loc.y);
            sendResponse({ success: true });
            return;
          }

          // ── Step 2: CDP Accessibility fallback ─────────────────────────
          // queryAXTree finds elements by accessible name (visible label) — works
          // in iframes, shadow DOM, and canvas apps where DOM text search fails.
          const searchLabel = (params.text || params.description || '').trim();
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
                  await cdpMouseClick(cx, cy);
                  sendResponse({ success: true });
                  return;
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
                      await cdpMouseClick(cx, cy);
                      sendResponse({ success: true });
                      return;
                    }
                  } catch (_) { continue; }
                }
              }
            } catch (_) {}
          }

          // ── Step 4: Direct coordinate click — agent supplied x,y ───────────
          if (typeof params.x === 'number' && typeof params.y === 'number') {
            await cdpMouseClick(params.x, params.y);
            sendResponse({ success: true });
            return;
          }

          // Nothing worked — tell the AI so it can try a different approach
          sendResponse({ success: false, error: `Element "${params.text || params.description || '?'}" not found via DOM, Accessibility tree, or DOM search` });

        } catch (e) {
          console.warn('[Aion Agent] CDP click failed:', e && e.message);
          fallbackSynthetic();
        } finally {
          if (attached) chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
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

        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) {}

        const cdpCmd = (method, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, method, p || {}, (r) => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });

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
          chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
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

        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) {}

        const cdpCmd = (method, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, method, p || {}, (r) => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });

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
          chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
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
        const debuggee = { tabId };
        try {
          await chrome.debugger.attach(debuggee, '1.3');
        } catch (_e) {
          sendResponse({ success: false, error: 'CDP attach failed (DevTools open?)' });
          return;
        }
        try {
          const sendKey = (type) => new Promise((res, rej) => {
            chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
              type,
              modifiers,
              key: finalKey,
              code: mapped.code,
              windowsVirtualKeyCode: mapped.kc,
              nativeVirtualKeyCode: mapped.kc
            }, () => {
              if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
              else res();
            });
          });
          await sendKey('rawKeyDown');
          await sendKey('keyUp');
          sendResponse({ success: true });
        } finally {
          chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
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

        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }

        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });

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
          chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
        }
      })();
      return true;
    }

    // ── select ─────────────────────────────────────────────────────────────────
    // Sets a native <select> dropdown to a specific option value via JS.
    // Much more reliable than trying to click tiny <option> elements.
    if (executeAction === 'select') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
          chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
        }
      })();
      return true;
    }

    // ── waitForElement ─────────────────────────────────────────────────────────
    // Polls until text appears on the page OR a CSS selector matches a visible
    // element.  Prevents the agent from clicking things mid-load.
    if (executeAction === 'waitForElement') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
        try {
          const target      = String(params.text || params.selector || '').trim();
          if (!target) {
            sendResponse({ success: false, error: 'waitForElement requires a non-empty "text" or "selector" — specify what to wait for' });
            return;
          }
          const useSelector = !params.text && !!params.selector;
          const timeoutSec  = Math.min(30, Math.max(1, parseInt(params.timeout) || 10));
          const deadline    = Date.now() + timeoutSec * 1000;
          let found = false;
          while (Date.now() < deadline) {
            const expr = useSelector
              ? `!!document.querySelector(${JSON.stringify(target)})`
              : `document.body.innerText.toLowerCase().includes(${JSON.stringify(target.toLowerCase())})`;
            const r = await cdpC('Runtime.evaluate', { expression: expr, returnByValue: true });
            if (r?.result?.value === true) { found = true; break; }
            await new Promise(r => setTimeout(r, 500));
          }
          sendResponse(found
            ? { success: true,  data: '"' + target + '" appeared on page' }
            : { success: false, error: 'Timed out after ' + timeoutSec + 's waiting for "' + target + '"' });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        } finally {
          chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
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
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
          chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
        }
      })();
      return true;
    }

    // ── autofill ───────────────────────────────────────────────────────────────
    // Fills an entire HTML form in one shot by matching field labels to values.
    // Much faster than clicking + typing into each field individually.
    if (executeAction === 'autofill') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })();
      return true;
    }

    // ── snapshotPage ───────────────────────────────────────────────────────────
    // DOMSnapshot.captureSnapshot returns the full structured DOM with element
    // positions, roles, and text — far richer than innerText for Gemini.
    if (executeAction === 'snapshotPage') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
          } catch (_) { /* AXTree optional — DOM snapshot already captured above */ }

          const axSection = axLines.length
            ? `\n\n--- Accessibility Tree (interactive elements) ---\n${axLines.join('\n')}`
            : '';

          sendResponse({ success: true, data: ([...lines].join('\n') + axSection).slice(0, 8000) });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })();
      return true;
    }

    // ── exportPDF ──────────────────────────────────────────────────────────────
    // Page.printToPDF exports any open page as a PDF and triggers a download.
    if (executeAction === 'exportPDF') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })();
      return true;
    }

    // ── findElement ────────────────────────────────────────────────────────────
    // DOM.performSearch searches the entire DOM tree including shadow roots —
    // finds elements that AX tree / CSS selectors miss (hidden components, etc).
    if (executeAction === 'findElement') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })();
      return true;
    }

    // ── setMobileMode ──────────────────────────────────────────────────────────
    // Emulation.setDeviceMetricsOverride switches the viewport to mobile size,
    // letting the agent access mobile-only menus, layouts, and features.
    if (executeAction === 'setMobileMode') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })();
      return true;
    }

    // ── readNetworkResponse ────────────────────────────────────────────────────
    // Intercepts the next fetch/XHR response matching a URL pattern and returns
    // the raw body — reads prices, search results, API data without OCR.
    if (executeAction === 'readNetworkResponse') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })();
      return true;
    }

    // ── drag (real CDP) ────────────────────────────────────────────────────────
    // Uses Input.dispatchDragEvent for genuine drag-and-drop that works on
    // Trello, kanban boards, file upload zones, sliders, and reorder lists.
    if (executeAction === 'drag') {
      (async () => {
        // Resolve from/to coordinates — try AX tree first, fall back to params
        const resolveCoord = async (textParam, selectorParam, xParam, yParam, debuggee, cdpC) => {
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

        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
        try {
          const from = await resolveCoord(params.fromText, params.fromSelector, params.fromX, params.fromY, debuggee, cdpC);
          const to   = await resolveCoord(params.toText,   params.toSelector,   params.toX,   params.toY,   debuggee, cdpC);
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })();
      return true;
    }

    // ── writeChunk ─────────────────────────────────────────────────────────────
    // Appends text to the currently focused element without clearing it.
    // Uses CDP Input.insertText — bypasses Gemini's ~800-word-per-turn limit
    // by letting the agent call this multiple times to build long documents.
    if (executeAction === 'writeChunk') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })();
      return true;
    }

    // ── readStorage ────────────────────────────────────────────────────────────
    // Reads localStorage, sessionStorage, and cookies — lets the agent check
    // auth state, session tokens, feature flags, and saved user settings.
    if (executeAction === 'readStorage') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })();
      return true;
    }

    // ── readIndexedDB ── IndexedDB domain ──────────────────────────────────────
    // Reads data from IndexedDB databases used by Gmail, Notion, Figma, PWAs.
    // Runtime.evaluate cannot read IndexedDB reliably — the CDP IndexedDB domain
    // has direct access to the storage engine without JS injection.
    if (executeAction === 'readIndexedDB') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
          chrome.debugger.sendCommand(debuggee, 'IndexedDB.disable', {}, () => {});
          chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
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
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
          try { await cdpC('Fetch.disable', {}); } catch (_) {}
          chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
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
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
          try { chrome.debugger.sendCommand(debuggee, 'CSS.disable', {}, () => {}); } catch(_) {}
          chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
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
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })();
      return true;
    }

    // ── captureConsole ── Runtime domain (console capture) ─────────────────────
    // Captures recent console.log / warn / error messages from the page.
    // Useful for debugging: see what errors the page is throwing, what the app
    // is logging, or confirming a function ran.
    if (executeAction === 'captureConsole') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })();
      return true;
    }

    // ── clearSiteData ── Storage domain ────────────────────────────────────────
    // Clears cache, cookies, localStorage, sessionStorage, or IndexedDB for the
    // current page's origin. Use before testing a fresh login, clearing a broken
    // app state, or resetting a site's local data.
    if (executeAction === 'clearSiteData') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })();
      return true;
    }

    // ── getPerformance ── Performance domain ───────────────────────────────────
    // Returns real browser performance metrics: FCP, LCP, DOM size, JS heap,
    // layout count, and more. Use to benchmark a page, check memory usage, or
    // verify a page actually loaded completely.
    if (executeAction === 'getPerformance') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
          try { chrome.debugger.sendCommand(debuggee, 'Performance.disable', {}, () => {}); } catch(_) {}
          chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
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
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
          try { chrome.debugger.sendCommand(debuggee, 'Audits.disable', {}, () => {}); } catch (_) {}
          chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
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
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
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
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })();
      return true;
    }

    // ── snapshotHeap ── HeapProfiler domain ────────────────────────────────────
    // Forces garbage collection then reports JS heap usage, retained object counts,
    // and memory pressure. Use to detect memory leaks, check if a page is
    // consuming excessive RAM, or confirm GC ran before a memory-sensitive test.
    if (executeAction === 'snapshotHeap') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
          try { chrome.debugger.sendCommand(debuggee, 'HeapProfiler.disable', {}, () => {}); } catch(_) {}
          chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
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
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
          try { chrome.debugger.sendCommand(debuggee, 'Log.disable', {}, () => {}); } catch(_) {}
          chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
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
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
          try { chrome.debugger.sendCommand(debuggee, 'Security.disable', {}, () => {}); } catch(_) {}
          chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
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
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
          try { chrome.debugger.sendCommand(debuggee, 'ServiceWorker.disable', {}, () => {}); } catch(_) {}
          chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
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
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
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
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); }
        catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => {
          chrome.debugger.sendCommand(debuggee, m, p || {}, r => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(r);
          });
        });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })();
      return true;
    }

    // ── getSystemInfo ── SystemInfo domain ────────────────────────────────────
    if (executeAction === 'getSystemInfo') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })(); return true;
    }

    // ── setBrowserWindow ── Browser domain ────────────────────────────────────
    if (executeAction === 'setBrowserWindow') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })(); return true;
    }

    // ── grantPermission ── Browser domain ─────────────────────────────────────
    if (executeAction === 'grantPermission') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
        try {
          const tab = await chrome.tabs.get(tabId);
          const origin = new URL(tab.url).origin;
          // permissions: 'geolocation','camera','microphone','notifications','clipboardReadWrite'...
          const perms = Array.isArray(params.permissions) ? params.permissions : [params.permission || 'notifications'];
          await cdpC('Browser.grantPermissions', { permissions: perms, origin });
          sendResponse({ success: true, data: `Granted [${perms.join(', ')}] for ${origin}` });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })(); return true;
    }

    // ── readDOMStorage ── DOMStorage domain ───────────────────────────────────
    // Native CDP read of localStorage/sessionStorage — more reliable than the
    // JS-injection approach used by readStorage (works on pages that sandbox JS).
    if (executeAction === 'readDOMStorage') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })(); return true;
    }

    // ── setDeviceOrientation ── DeviceOrientation domain ──────────────────────
    if (executeAction === 'setDeviceOrientation') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })(); return true;
    }

    // ── getAnimations ── Animation domain ─────────────────────────────────────
    if (executeAction === 'getAnimations') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })(); return true;
    }

    // ── setAnimationSpeed ── Animation domain ──────────────────────────────────
    if (executeAction === 'setAnimationSpeed') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
        try {
          const playbackRate = parseFloat(params.speed ?? 1); // 0 = pause, 1 = normal, 2 = 2x
          await cdpC('Animation.enable');
          await cdpC('Animation.setPlaybackRate', { playbackRate });
          sendResponse({ success: true, data: `Global animation playback rate set to ${playbackRate}x.` });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })(); return true;
    }

    // ── triggerAutofill ── Autofill domain ────────────────────────────────────
    if (executeAction === 'triggerAutofill') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })(); return true;
    }

    // ── readBackgroundEvents ── BackgroundService domain ───────────────────────
    if (executeAction === 'readBackgroundEvents') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })(); return true;
    }

    // ── pauseOnException ── Debugger domain ───────────────────────────────────
    if (executeAction === 'pauseOnException') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
          try { chrome.debugger.sendCommand(debuggee, 'Debugger.disable', {}, () => {}); } catch (_) {}
          chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
        }
      })(); return true;
    }

    // ── setEventBreakpoint ── EventBreakpoints domain ──────────────────────────
    if (executeAction === 'setEventBreakpoint') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
          try { chrome.debugger.sendCommand(debuggee, 'Debugger.disable', {}, () => {}); } catch (_) {}
          chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
        }
      })(); return true;
    }

    // ── getFedCmInfo ── FedCm domain ───────────────────────────────────────────
    if (executeAction === 'getFedCmInfo') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
          try { chrome.debugger.sendCommand(debuggee, 'FedCm.disable', {}, () => {}); } catch (_) {}
          chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
        }
      })(); return true;
    }

    // ── getFileSystem ── FileSystem domain ────────────────────────────────────
    if (executeAction === 'getFileSystem') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })(); return true;
    }

    // ── getLayerTree ── LayerTree domain ──────────────────────────────────────
    if (executeAction === 'getLayerTree') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })(); return true;
    }

    // ── inspectMedia ── Media domain ───────────────────────────────────────────
    if (executeAction === 'inspectMedia') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })(); return true;
    }

    // ── getMemoryInfo ── Memory domain ────────────────────────────────────────
    if (executeAction === 'getMemoryInfo') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })(); return true;
    }

    // ── trackWebVitals ── PerformanceTimeline domain ───────────────────────────
    if (executeAction === 'trackWebVitals') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })(); return true;
    }

    // ── getPreloadRules ── Preload domain ─────────────────────────────────────
    if (executeAction === 'getPreloadRules') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })(); return true;
    }

    // ── profileCPU ── Profiler domain ─────────────────────────────────────────
    if (executeAction === 'profileCPU') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })(); return true;
    }

    // ── getPWAInfo ── PWA domain ──────────────────────────────────────────────
    if (executeAction === 'getPWAInfo') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })(); return true;
    }

    // ── getCDPSchema ── Schema domain ─────────────────────────────────────────
    if (executeAction === 'getCDPSchema') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
        try {
          const { domains } = await cdpC('Schema.getDomains');
          const summary = (domains || []).map(d => ({ name: d.name, version: d.version }));
          sendResponse({ success: true, data: JSON.stringify(summary, null, 2) });
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })(); return true;
    }

    // ── recordTrace ── Tracing domain ─────────────────────────────────────────
    if (executeAction === 'recordTrace') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })(); return true;
    }

    // ── inspectWebAudio ── WebAudio domain ────────────────────────────────────
    if (executeAction === 'inspectWebAudio') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
        finally { chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; }); }
      })(); return true;
    }

    // ── emulateWebAuthn ── WebAuthn domain ────────────────────────────────────
    if (executeAction === 'emulateWebAuthn') {
      (async () => {
        const debuggee = { tabId };
        try { await chrome.debugger.attach(debuggee, '1.3'); } catch (_) { sendResponse({ success: false, error: 'CDP attach failed' }); return; }
        const cdpC = (m, p) => new Promise((res, rej) => { chrome.debugger.sendCommand(debuggee, m, p || {}, r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); });
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
          try { chrome.debugger.sendCommand(debuggee, 'WebAuthn.disable', {}, () => {}); } catch (_) {}
          chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
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
          const debuggee = { tabId };
          await chrome.debugger.attach(debuggee, '1.3');
          try {
            const send = (params2) => new Promise((resolve, reject) => {
              chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', params2, () => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve();
              });
            });
            const base = { x, y, button: 'left', buttons: 1 };
            await send({ ...base, type: 'mousePressed', clickCount: 1 });
            await send({ ...base, type: 'mouseReleased', clickCount: 1 });
            await new Promise(r => setTimeout(r, 60));
            await send({ ...base, type: 'mousePressed', clickCount: 2 });
            await send({ ...base, type: 'mouseReleased', clickCount: 2 });
            sendResponse({ success: true });
          } finally {
            chrome.debugger.detach(debuggee, () => { void chrome.runtime.lastError; });
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
    // Delay for lazy-loading (500ms allows dynamic content to load - like GoFullPage)
    // Increase this to 1000ms for very dynamic sites (investing.com, etc)
    await new Promise(resolve => setTimeout(resolve, 500));
    
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
