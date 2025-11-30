// Flow Background Service Worker
// Handles screenshot capture, storage management, and messaging

const MAX_SNAPS = 9;
const AI_SITES = ['grok.com', 'grok.x.ai', 'chat.openai.com', 'chatgpt.com', 'claude.ai'];
const CAPTURE_COOLDOWN = 500; // Minimum 500ms between captures to avoid Chrome rate limit

// Track last capture time to prevent rate limiting
let lastCaptureTime = 0;

// Full page capture state - prevents duplicate captures
let isFullPageCaptureInProgress = false;
let fullPageCapturePort = null; // Port to detect popup disconnect

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
    // Start full page capture process
    startFullPageCapture().then(sendResponse);
    return true;
  } else if (request.action === 'fullPageCaptureStep') {
    // Capture a single step during full page capture
    captureFullPageStep(request.tabId).then(sendResponse);
    return true;
  } else if (request.action === 'fullPageCaptureComplete') {
    // Stitch and save full page capture (legacy - for annotation flow)
    finalizeFullPageCapture(request.screenshots, request.viewportWidth, request.viewportHeight).then(sendResponse);
    return true;
  } else if (request.action === 'fullPageCaptureChunk') {
    // Stitch and save a single chunk directly to queue (no annotation)
    stitchAndSaveChunk(request.screenshots, request.viewportWidth, request.viewportHeight, request.chunkNumber).then(sendResponse);
    return true;
  } else if (request.action === 'fullPageStitchComplete' || request.action === 'fullPageStitchFailed') {
    // Full page capture cycle complete (success or failure) - reset the flag
    isFullPageCaptureInProgress = false;
    fullPageCapturePort = null;
    console.log('[SnapToAI] Full page capture completed, flag reset');
    sendResponse({ success: true });
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
      }
    });
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
// FULL PAGE CAPTURE FUNCTIONS
// ============================================

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
    
    // Set capture in progress flag
    // Port connection from popup will detect if popup closes and reset the flag
    isFullPageCaptureInProgress = true;
    
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Inject content script if needed
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (e) {
      console.log('Content script already injected or injection failed:', e.message);
    }
    
    // Small delay to ensure content script is ready
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Send message to content script to start scrolling and capturing
    chrome.tabs.sendMessage(tab.id, {
      action: 'startFullPageScroll',
      tabId: tab.id
    });
    
    return { success: true };
  } catch (error) {
    console.error('Start full page capture failed:', error);
    isFullPageCaptureInProgress = false; // Reset on error
    return { success: false, error: error.message };
  }
}

// Capture a single viewport during full page capture
async function captureFullPageStep(tabId) {
  try {
    // Small delay to ensure page has settled after scroll
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    
    return { success: true, dataUrl };
  } catch (error) {
    console.error('Capture step failed:', error);
    return { success: false, error: error.message };
  }
}

// Finalize full page capture - stitch images and save to queue
async function finalizeFullPageCapture(screenshots, viewportWidth, viewportHeight) {
  try {
    if (!screenshots || screenshots.length === 0) {
      isFullPageCaptureInProgress = false;
      return { success: false, error: 'No screenshots to stitch' };
    }
    
    // Get current snaps
    const snaps = await getSnaps();
    
    // Block if queue is full
    if (snaps.length >= MAX_SNAPS) {
      isFullPageCaptureInProgress = false;
      return { 
        success: false, 
        error: `Queue full (${MAX_SNAPS}/${MAX_SNAPS}). Delete some images first.` 
      };
    }
    
    // Send to popup for stitching - popup will notify us when done
    chrome.runtime.sendMessage({
      action: 'stitchFullPage',
      screenshots,
      viewportWidth,
      viewportHeight
    }).catch(() => {
      // If popup isn't open, reset the flag
      isFullPageCaptureInProgress = false;
    });
    
    return { success: true, pending: true };
  } catch (error) {
    console.error('Finalize full page capture failed:', error);
    isFullPageCaptureInProgress = false;
    return { success: false, error: error.message };
  }
}

// Reset full page capture state (called when stitch completes or fails)
function resetFullPageCaptureState() {
  isFullPageCaptureInProgress = false;
}

// Stitch screenshots and save directly to queue (for multi-chunk full page capture)
async function stitchAndSaveChunk(screenshots, viewportWidth, viewportHeight, chunkNumber) {
  try {
    if (!screenshots || screenshots.length === 0) {
      return { success: false, error: 'No screenshots to stitch' };
    }
    
    // Get current snaps to check capacity
    const snaps = await getSnaps();
    
    if (snaps.length >= MAX_SNAPS) {
      return { 
        success: false, 
        error: 'Queue full',
        queueFull: true,
        remainingCapacity: 0
      };
    }
    
    console.log(`[SnapToAI] Stitching chunk ${chunkNumber} with ${screenshots.length} screenshots`);
    
    // Use OffscreenDocument for stitching (required for canvas in service worker)
    const stitchedDataUrl = await stitchImagesOffscreen(screenshots, viewportWidth, viewportHeight);
    
    if (!stitchedDataUrl) {
      return { success: false, error: 'Stitching failed' };
    }
    
    // Add to queue
    snaps.push(stitchedDataUrl);
    await chrome.storage.session.set({ snaps });
    await updateBadge(snaps.length);
    
    const remainingCapacity = MAX_SNAPS - snaps.length;
    console.log(`[SnapToAI] Chunk ${chunkNumber} saved. Queue: ${snaps.length}/${MAX_SNAPS}, remaining: ${remainingCapacity}`);
    
    return { 
      success: true, 
      count: snaps.length,
      chunkNumber,
      remainingCapacity,
      queueFull: remainingCapacity <= 0
    };
  } catch (error) {
    console.error('Stitch and save chunk failed:', error);
    return { success: false, error: error.message };
  }
}

// Stitch images using OffscreenDocument (for service worker canvas support)
async function stitchImagesOffscreen(screenshots, viewportWidth, viewportHeight) {
  try {
    // Calculate overlap (same as content.js)
    const overlap = 50;
    const stepHeight = viewportHeight - overlap;
    
    // Calculate total height: first image full height, rest add stepHeight
    const totalHeight = viewportHeight + (screenshots.length - 1) * stepHeight;
    
    // Create offscreen document if needed
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    
    if (existingContexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['CANVAS'],
        justification: 'Stitch full page screenshots'
      });
    }
    
    // Send stitch request to offscreen document
    const result = await chrome.runtime.sendMessage({
      action: 'offscreenStitch',
      screenshots,
      viewportWidth,
      viewportHeight,
      totalHeight,
      stepHeight
    });
    
    return result.dataUrl;
  } catch (error) {
    console.error('Offscreen stitch failed:', error);
    return null;
  }
}
