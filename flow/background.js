// Flow Background Service Worker
// Handles screenshot capture, storage management, and messaging

const MAX_SNAPS = 9;
const AI_SITES = ['grok.com', 'chat.openai.com', 'chatgpt.com', 'claude.ai'];
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
  } else if (request.action === 'startSnip') {
    startSnipMode().then(sendResponse);
    return true;
  } else if (request.action === 'snipCapture') {
    captureSnipRegion(request.bounds).then(sendResponse);
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
    
    // Capture visible tab as PNG
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    
    // Get current snaps
    const snaps = await getSnaps();
    const snapCount = snaps.length;
    
    // Enforce FIFO: if at max, remove oldest
    if (snapCount >= MAX_SNAPS) {
      snaps.shift(); // Remove first (oldest)
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

// Check if URL is restricted (cannot be captured)
function isRestrictedUrl(url) {
  if (!url) return true;
  
  const restrictedPrefixes = [
    'chrome://',
    'chrome-extension://',
    'chrome-untrusted://',
    'chrome-search://',
    'edge://',
    'about:',
    'devtools://',
    'view-source:',
    'data:',
    'chrome.google.com/webstore'  // Chrome Web Store
  ];
  
  return restrictedPrefixes.some(prefix => url.startsWith(prefix) || url.includes(prefix));
}

// Start snip mode - inject snipping overlay into active tab
async function startSnipMode() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Check if tab is accessible
    if (!tab || !tab.id) {
      return { success: false, error: 'No active tab found. Please open a webpage first.' };
    }
    
    // Check if URL is accessible
    if (!tab.url) {
      return { success: false, error: 'Cannot access this page. Try a regular website.' };
    }
    
    // Check if URL is restricted
    if (isRestrictedUrl(tab.url)) {
      return { success: false, error: 'Open a regular website first (not browser settings)' };
    }
    
    // Inject the snipping overlay script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectSnippingOverlay
    });
    
    return { success: true };
  } catch (error) {
    console.error('Start snip mode failed:', error);
    // Provide user-friendly error messages
    if (error.message.includes('Cannot access')) {
      return { success: false, error: 'Cannot snip this page. Try a regular website.' };
    }
    return { success: false, error: 'Snip failed. Please try on a different page.' };
  }
}

// Injected function that creates the snipping overlay
function injectSnippingOverlay() {
  // Remove any existing overlay
  const existing = document.getElementById('snaptoai-snip-overlay');
  if (existing) existing.remove();
  
  // Create overlay container
  const overlay = document.createElement('div');
  overlay.id = 'snaptoai-snip-overlay';
  
  // Styling for the overlay
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    cursor: 'crosshair',
    zIndex: '2147483647',
    userSelect: 'none'
  });
  
  // Create selection rectangle
  const selection = document.createElement('div');
  selection.id = 'snaptoai-snip-selection';
  Object.assign(selection.style, {
    position: 'absolute',
    border: '2px solid #00d9ff',
    backgroundColor: 'rgba(0, 217, 255, 0.1)',
    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
    display: 'none',
    pointerEvents: 'none'
  });
  overlay.appendChild(selection);
  
  // Create instruction text
  const instruction = document.createElement('div');
  Object.assign(instruction.style, {
    position: 'absolute',
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(0, 217, 255, 0.95)',
    color: '#000',
    padding: '12px 24px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    boxShadow: '0 4px 20px rgba(0, 217, 255, 0.4)',
    zIndex: '2147483648'
  });
  instruction.textContent = 'Drag to select area • ESC to cancel';
  overlay.appendChild(instruction);
  
  // Tracking variables
  let isDrawing = false;
  let startX = 0;
  let startY = 0;
  
  // Mouse down - start selection
  overlay.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // Only left click
    isDrawing = true;
    startX = e.clientX;
    startY = e.clientY;
    selection.style.display = 'block';
    selection.style.left = startX + 'px';
    selection.style.top = startY + 'px';
    selection.style.width = '0';
    selection.style.height = '0';
  });
  
  // Mouse move - update selection rectangle
  overlay.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    
    const currentX = e.clientX;
    const currentY = e.clientY;
    
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    
    selection.style.left = left + 'px';
    selection.style.top = top + 'px';
    selection.style.width = width + 'px';
    selection.style.height = height + 'px';
  });
  
  // Mouse up - complete selection
  overlay.addEventListener('mouseup', async (e) => {
    if (!isDrawing) return;
    isDrawing = false;
    
    const currentX = e.clientX;
    const currentY = e.clientY;
    
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    
    // Minimum selection size
    if (width < 10 || height < 10) {
      overlay.remove();
      return;
    }
    
    // Get device pixel ratio for retina displays
    const dpr = window.devicePixelRatio || 1;
    
    // Calculate bounds for capture (multiply by DPR for retina)
    const bounds = {
      x: left * dpr,
      y: top * dpr,
      width: width * dpr,
      height: height * dpr,
      dpr: dpr
    };
    
    // Remove overlay before capture
    overlay.remove();
    
    // Small delay to ensure overlay is gone from the screenshot
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Send bounds to background for capture
    chrome.runtime.sendMessage({ action: 'snipCapture', bounds });
  });
  
  // ESC key to cancel
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', handleKeyDown);
    }
  };
  document.addEventListener('keydown', handleKeyDown);
  
  // Append overlay to document
  document.body.appendChild(overlay);
}

// Capture and crop the selected region
async function captureSnipRegion(bounds) {
  try {
    // Check cooldown
    const now = Date.now();
    const timeSinceLastCapture = now - lastCaptureTime;
    
    if (timeSinceLastCapture < CAPTURE_COOLDOWN) {
      return { success: false, error: 'Please wait before capturing again' };
    }
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Update last capture time
    lastCaptureTime = now;
    
    // Capture full visible tab
    const fullDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    
    // Crop the image to the selected region using OffscreenCanvas
    const croppedDataUrl = await cropImage(fullDataUrl, bounds);
    
    // Get current snaps and add the cropped image
    const snaps = await getSnaps();
    
    // Enforce FIFO: if at max, remove oldest
    if (snaps.length >= MAX_SNAPS) {
      snaps.shift();
    }
    
    // Add new snap
    snaps.push(croppedDataUrl);
    
    // Save to session storage
    await chrome.storage.session.set({ snaps });
    
    // Update badge
    await updateBadge(snaps.length);
    
    // Show toast on the page
    const newSnapNumber = snaps.length;
    chrome.tabs.sendMessage(tab.id, {
      action: 'captureComplete',
      message: `Snip ${newSnapNumber} ✓`,
      snapNumber: newSnapNumber
    }).catch(() => {});
    
    return { success: true, count: snaps.length, dataUrl: croppedDataUrl };
  } catch (error) {
    console.error('Snip capture failed:', error);
    return { success: false, error: error.message };
  }
}

// Crop image using OffscreenCanvas (works in service worker)
async function cropImage(dataUrl, bounds) {
  // Fetch the image data
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const imageBitmap = await createImageBitmap(blob);
  
  // Create OffscreenCanvas for cropping
  const canvas = new OffscreenCanvas(bounds.width, bounds.height);
  const ctx = canvas.getContext('2d');
  
  // Draw the cropped region
  ctx.drawImage(
    imageBitmap,
    bounds.x, bounds.y, bounds.width, bounds.height,  // Source rectangle
    0, 0, bounds.width, bounds.height                   // Destination rectangle
  );
  
  // Convert to blob and then to data URL (service worker compatible)
  const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
  
  // Convert blob to base64 using ArrayBuffer (FileReader not available in service workers)
  const arrayBuffer = await croppedBlob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  let binaryString = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binaryString += String.fromCharCode(uint8Array[i]);
  }
  const base64 = btoa(binaryString);
  return `data:image/png;base64,${base64}`;
}
