// Flow Background Service Worker
// Handles screenshot capture, storage management, and messaging

const MAX_SNAPS = 9;
const AI_SITES = ['grok.com', 'grok.x.ai', 'chat.openai.com', 'chatgpt.com', 'claude.ai'];
const CAPTURE_COOLDOWN = 500; // Minimum 500ms between captures to avoid Chrome rate limit

// Track last capture time to prevent rate limiting
let lastCaptureTime = 0;

// Full page capture state - managed entirely in background, independent of popup
let isFullPageCaptureInProgress = false;
let fullPageCaptureData = {
  tabId: null,
  tiles: [],
  viewportWidth: 0,
  viewportHeight: 0,
  overlap: 50
};

// Listen for keyboard command (Ctrl+Shift+S)
chrome.commands.onCommand.addListener((command) => {
  if (command === 'capture') {
    captureScreenshot();
  }
});

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'capture') {
    captureScreenshot().then(sendResponse);
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
  } else if (request.action === 'setSnaps') {
    setSnaps(request.snaps).then(sendResponse);
    return true;
  } else if (request.action === 'getSnapCount') {
    getSnapCount().then(sendResponse);
    return true;
  } else if (request.action === 'uploadComplete') {
    clearSnaps().then(sendResponse);
    return true;
  } else if (request.action === 'snipComplete') {
    // Handle snip (cropped image) - add as new snap
    addSnip(request.dataUrl).then(sendResponse);
    return true;
  } else if (request.action === 'startFullPageCapture') {
    // Start full page capture - everything managed in background
    startFullPageCapture().then(sendResponse);
    return true;
  } else if (request.action === 'fullPageTileReady') {
    // Content script captured a tile, store it in background
    handleFullPageTile(request).then(sendResponse);
    return true;
  } else if (request.action === 'fullPageScrollComplete') {
    // Content script finished scrolling, now stitch via offscreen
    handleFullPageScrollComplete().then(sendResponse);
    return true;
  } else if (request.action === 'fullPageScrollFailed') {
    // Scrolling failed, reset state
    resetFullPageCapture('Scroll failed: ' + (request.error || 'Unknown error'));
    sendResponse({ success: false });
    return true;
  } else if (request.action === 'getFullPageStatus') {
    // Popup asking for current status
    sendResponse({ 
      inProgress: isFullPageCaptureInProgress,
      tileCount: fullPageCaptureData.tiles.length
    });
    return true;
  } else if (request.action === 'cancelFullPageCapture') {
    // User wants to cancel
    resetFullPageCapture('Cancelled by user');
    sendResponse({ success: true });
    return true;
  } else if (request.action === 'forceResetFullPageCapture') {
    // Force reset - for when capture gets stuck
    console.log('[SnapToAI] Force reset requested');
    isFullPageCaptureInProgress = false;
    fullPageCaptureData = { tabId: null, tiles: [], viewportWidth: 0, viewportHeight: 0, overlap: 50 };
    sendResponse({ success: true });
    return true;
  }
});


// Capture screenshot of active tab
async function captureScreenshot() {
  try {
    // Check cooldown to prevent Chrome rate limit
    const now = Date.now();
    const timeSinceLastCapture = now - lastCaptureTime;
    
    if (timeSinceLastCapture < CAPTURE_COOLDOWN) {
      const remainingTime = Math.ceil((CAPTURE_COOLDOWN - timeSinceLastCapture) / 1000);
      console.log(`Capture on cooldown. Wait ${remainingTime}s`);
      return { 
        success: false, 
        error: `Please wait ${remainingTime} second${remainingTime > 1 ? 's' : ''} before capturing again` 
      };
    }
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Update last capture time
    lastCaptureTime = now;
    
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
    await chrome.storage.session.set({ snaps });
    
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
    console.error('Capture failed:', error);
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
      await chrome.storage.session.set({ selectedSnapsForUpload: snapsToUpload });
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
    
    // Send upload command to content script with snap count
    await chrome.tabs.sendMessage(tab.id, {
      action: 'beginUpload',
      platform: targetPlatform,
      useSelectedOnly: selectedSnaps !== null
    });
    
    return { success: true, count: snapsToUpload.length };
  } catch (error) {
    console.error('Upload failed:', error);
    return { success: false, error: error.message };
  }
}

// Get all snaps from session storage
async function getSnaps() {
  const result = await chrome.storage.session.get('snaps');
  return result.snaps || [];
}

// Get snap count
async function getSnapCount() {
  const snaps = await getSnaps();
  return snaps.length;
}

// Clear all snaps
async function clearSnaps() {
  await chrome.storage.session.remove('snaps');
  await updateBadge(0);
  return { success: true };
}

// Set snaps (for individual delete)
async function setSnaps(snaps) {
  await chrome.storage.session.set({ snaps });
  await updateBadge(snaps.length);
  return { success: true };
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

// Add snip (cropped image) as new snap
async function addSnip(dataUrl) {
  try {
    // Get current snaps
    const snaps = await getSnaps();
    
    // Block snip if queue is full - user must delete to make room
    if (snaps.length >= MAX_SNAPS) {
      return { 
        success: false, 
        error: `Queue full (${MAX_SNAPS}/${MAX_SNAPS}). Delete some images first.`,
        queueFull: true
      };
    }
    
    // Check for duplicate save within time window
    const now = Date.now();
    const imageHash = simpleHash(dataUrl);
    if (imageHash === lastSavedImageHash && (now - lastSaveTime) < DUPLICATE_WINDOW) {
      console.log('[SnapToAI] Duplicate image detected, skipping save');
      return { success: true, count: snaps.length, duplicate: true };
    }
    
    // Update duplicate detection state
    lastSavedImageHash = imageHash;
    lastSaveTime = now;
    
    // Add new snip
    snaps.push(dataUrl);
    
    // Save to session storage
    await chrome.storage.session.set({ snaps });
    
    // Update badge
    await updateBadge(snaps.length);
    
    // Notify popup about saved snip (for preview)
    chrome.runtime.sendMessage({ action: 'snipSaved', dataUrl: dataUrl }).catch(() => {});
    
    return { success: true, count: snaps.length };
  } catch (error) {
    console.error('Add snip failed:', error);
    return { success: false, error: error.message };
  }
}

// Update extension badge
async function updateBadge(count) {
  if (count > 0) {
    await chrome.action.setBadgeText({ text: `●${count}` });
    await chrome.action.setBadgeBackgroundColor({ color: '#00d9ff' }); // Cyan
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

// Initialize badge on startup
chrome.runtime.onStartup.addListener(async () => {
  const count = await getSnapCount();
  await updateBadge(count);
});

// Update badge when extension icon is clicked
chrome.action.onClicked.addListener(async () => {
  const count = await getSnapCount();
  await updateBadge(count);
});

// ============================================
// FULL PAGE CAPTURE - BACKGROUND ORCHESTRATED
// Uses offscreen document for stitching
// Independent of popup lifecycle
// ============================================

// Ensure offscreen document exists
async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  
  if (existingContexts.length > 0) {
    return; // Already exists
  }
  
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: 'Canvas stitching for full-page screenshots'
  });
}

// Close offscreen document when done
async function closeOffscreenDocument() {
  try {
    await chrome.offscreen.closeDocument();
  } catch (e) {
    // Ignore if already closed
  }
}

// Reset full page capture state
function resetFullPageCapture(errorMessage = null) {
  console.log('[SnapToAI] Resetting full page capture state', errorMessage ? `(${errorMessage})` : '');
  isFullPageCaptureInProgress = false;
  fullPageCaptureData = {
    tabId: null,
    tiles: [],
    viewportWidth: 0,
    viewportHeight: 0,
    overlap: 50
  };
  
  // Notify popup about the reset
  chrome.runtime.sendMessage({
    action: 'fullPageCaptureReset',
    error: errorMessage
  }).catch(() => {});
}

// Start full page capture process
async function startFullPageCapture() {
  try {
    // Check if capture already in progress
    if (isFullPageCaptureInProgress) {
      return { 
        success: false, 
        error: 'Full page capture already in progress. Please wait.' 
      };
    }
    
    // Check if queue has space
    const snaps = await getSnaps();
    if (snaps.length >= MAX_SNAPS) {
      return { 
        success: false, 
        error: `Queue full (${MAX_SNAPS}/${MAX_SNAPS}). Delete some images first.` 
      };
    }
    
    // Set capture in progress - this flag is managed entirely in background
    isFullPageCaptureInProgress = true;
    fullPageCaptureData = {
      tabId: null,
      tiles: [],
      viewportWidth: 0,
      viewportHeight: 0,
      overlap: 50
    };
    
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    fullPageCaptureData.tabId = tab.id;
    
    // Inject content script if needed
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (e) {
      console.log('Content script already injected:', e.message);
    }
    
    // Small delay to ensure content script is ready
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Tell content script to start scrolling
    // Content script will call back with fullPageTileReady for each tile
    try {
      const scrollResponse = await chrome.tabs.sendMessage(tab.id, {
        action: 'startFullPageScroll',
        tabId: tab.id
      });
      
      console.log('[SnapToAI] Full page capture started for tab', tab.id, scrollResponse);
      
      // Set a timeout to reset the flag if no tiles are received
      // This prevents the flag from getting stuck if content script fails silently
      setTimeout(() => {
        if (isFullPageCaptureInProgress && fullPageCaptureData.tiles.length === 0) {
          console.log('[SnapToAI] Timeout: No tiles received, resetting capture state');
          resetFullPageCapture('No response from page. Try refreshing and try again.');
        }
      }, 10000); // 10 second timeout
      
      return { success: true };
    } catch (sendError) {
      console.error('[SnapToAI] Failed to send message to content script:', sendError);
      resetFullPageCapture('Could not connect to page. Try refreshing the page.');
      return { success: false, error: 'Could not connect to page. Try refreshing the page.' };
    }
  } catch (error) {
    console.error('Start full page capture failed:', error);
    resetFullPageCapture(error.message);
    return { success: false, error: error.message };
  }
}

// Handle a tile captured by content script
async function handleFullPageTile(request) {
  try {
    if (!isFullPageCaptureInProgress) {
      return { success: false, error: 'No capture in progress' };
    }
    
    // Store viewport dimensions from first tile
    if (fullPageCaptureData.tiles.length === 0) {
      fullPageCaptureData.viewportWidth = request.viewportWidth;
      fullPageCaptureData.viewportHeight = request.viewportHeight;
    }
    
    // Capture the visible tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    
    // Store the tile
    fullPageCaptureData.tiles.push(dataUrl);
    
    // Notify popup of progress
    chrome.runtime.sendMessage({
      action: 'fullPageProgress',
      current: fullPageCaptureData.tiles.length,
      total: request.totalTiles || 0,
      percent: request.percent || 0
    }).catch(() => {});
    
    console.log('[SnapToAI] Tile captured:', fullPageCaptureData.tiles.length);
    return { success: true, tileCount: fullPageCaptureData.tiles.length };
  } catch (error) {
    console.error('Handle tile failed:', error);
    return { success: false, error: error.message };
  }
}

// Handle scroll complete - stitch via offscreen document
async function handleFullPageScrollComplete() {
  try {
    if (!isFullPageCaptureInProgress) {
      return { success: false, error: 'No capture in progress' };
    }
    
    const tiles = fullPageCaptureData.tiles;
    console.log('[SnapToAI] Scroll complete, stitching', tiles.length, 'tiles');
    
    if (tiles.length === 0) {
      resetFullPageCapture('No tiles captured');
      return { success: false, error: 'No tiles captured' };
    }
    
    // Check queue space before stitching
    const snaps = await getSnaps();
    if (snaps.length >= MAX_SNAPS) {
      resetFullPageCapture('Queue full');
      return { success: false, error: `Queue full (${MAX_SNAPS}/${MAX_SNAPS})` };
    }
    
    // Notify popup we're stitching
    chrome.runtime.sendMessage({
      action: 'fullPageStitching'
    }).catch(() => {});
    
    // Create offscreen document for canvas stitching
    await ensureOffscreenDocument();
    
    // Send tiles to offscreen for stitching
    const result = await chrome.runtime.sendMessage({
      action: 'stitchFullPage',
      tiles: tiles,
      viewportWidth: fullPageCaptureData.viewportWidth,
      viewportHeight: fullPageCaptureData.viewportHeight,
      overlap: fullPageCaptureData.overlap
    });
    
    // Close offscreen document
    await closeOffscreenDocument();
    
    if (!result || !result.success) {
      resetFullPageCapture(result?.error || 'Stitching failed');
      return { success: false, error: result?.error || 'Stitching failed' };
    }
    
    // Save stitched image to queue
    const saveResult = await addSnip(result.dataUrl);
    
    if (!saveResult.success) {
      resetFullPageCapture(saveResult.error);
      return saveResult;
    }
    
    // Success! Reset state
    console.log('[SnapToAI] Full page capture saved successfully');
    
    // Notify popup of completion
    chrome.runtime.sendMessage({
      action: 'fullPageCaptureComplete',
      count: saveResult.count
    }).catch(() => {});
    
    resetFullPageCapture();
    return { success: true, count: saveResult.count };
  } catch (error) {
    console.error('Scroll complete handling failed:', error);
    resetFullPageCapture(error.message);
    return { success: false, error: error.message };
  }
}
