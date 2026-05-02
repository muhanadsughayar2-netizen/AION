// SnapToAI Background Service Worker
// Handles screenshot capture, storage management, downloads, and messaging

const MAX_SNAPS = 9;
const AI_SITES = ['grok.com', 'grok.x.ai', 'x.com', 'chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai', 'specode.ai'];
const CAPTURE_COOLDOWN = 700; // Minimum 700ms between captures to avoid Chrome rate limit (MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND)

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
  defaultBorderColor: '#00bcd4',
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
  const next = _applyUiModeChain.catch(() => {}).then(async () => {
    try {
      if (mode === 'sidebar' && chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
        // Disabling the popup makes the icon click trigger sidePanel.open
        await chrome.action.setPopup({ popup: '' });
        console.log('[SnapToAI] UI mode: sidebar (icon click -> side panel)');
      } else {
        if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
          await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
        }
        await chrome.action.setPopup({ popup: 'popup.html' });
        console.log('[SnapToAI] UI mode: popup (icon click -> popup)');
      }
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
    headers: { Authorization: `Bearer ${token}` }
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

function registerSnapToAIMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'snaptoai-parent',
      title: 'SnapToAI ✨',
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
    chrome.tabs.sendMessage(tabId, {
      action: 'agentExecute',
      executeAction,
      params
    }, (response) => {
      if (chrome.runtime.lastError) {
        // Try injecting content script first, then retry
        chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js']
        }).then(() => {
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
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['content.js']
      });
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
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: isAIPlatform },
        files: ['content.js']
      });
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
      filename = `SnapToAI_${timestamp}.${format}`;
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
      const finalFilename = filename || `SnapToAI_${timestamp}_${i + 1}.${format}`;
      
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
