// Flow Background Service Worker
// Handles screenshot capture, storage management, and messaging

const MAX_SNAPS = 9;
const AI_SITES = ['grok.com', 'grok.x.ai', 'chat.openai.com', 'chatgpt.com', 'claude.ai'];
const CAPTURE_COOLDOWN = 500; // Minimum 500ms between captures to avoid Chrome rate limit

// Track last capture time to prevent rate limiting
let lastCaptureTime = 0;

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
