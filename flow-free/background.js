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

// Track last capture time to prevent rate limiting
let lastCaptureTime = 0;

// Get current settings
async function getSettings() {
  const result = await chrome.storage.local.get('snaptoaiSettings');
  return { ...DEFAULT_SETTINGS, ...result.snaptoaiSettings };
}

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
  } else if (request.action === 'fullPageCaptureStep') {
    // Capture a single step during full page capture
    captureFullPageStep(request.tabId).then(sendResponse);
    return true;
  } else if (request.action === 'fullPageCaptureComplete') {
    // Stitch and save full page capture (now includes page URL for browser frame + text for PDF)
    finalizeFullPageCapture(request.screenshots, request.viewportWidth, request.viewportHeight, request.isAIPlatform, request.pageUrl, request.pageTitle, request.screenshotText).then(sendResponse);
    return true;
  } else if (request.action === 'fullPageStitchComplete' || request.action === 'fullPageStitchFailed') {
    // Full page capture cycle complete (success or failure) - reset the flag
    isFullPageCaptureInProgress = false;
    fullPageCapturePort = null;
    console.log('[SnapToAI] Full page capture completed, flag reset');
    sendResponse({ success: true });
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
    await chrome.storage.local.set({ snaps });
    
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
    
    // Send upload command to content script with snap count
    await chrome.tabs.sendMessage(tab.id, {
      action: 'beginUpload',
      platform: targetPlatform,
      useSelectedOnly: selectedSnaps !== null
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
    'addons.mozilla.org'
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
async function startFullPageCapture() {
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
    
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
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
    // Port connection from popup will detect if popup closes and reset the flag
    isFullPageCaptureInProgress = true;
    
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
    // Small delay to ensure page has settled after scroll
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
async function finalizeFullPageCapture(screenshots, viewportWidth, viewportHeight, isAIPlatform = false, pageUrl = '', pageTitle = '', screenshotText = []) {
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
    
    // Store the captured page URL for the editor's browser frame feature
    await chrome.storage.session.set({ 
      lastCapturedPageUrl: pageUrl || '',
      lastCapturedPageTitle: pageTitle || 'Untitled Page'
    });
    
    // Send to popup for stitching - popup will notify us when done
    // Pass isAIPlatform flag so stitching uses correct overlap (0% for AI, 10% for regular)
    chrome.runtime.sendMessage({
      action: 'stitchFullPage',
      screenshots,
      screenshotText, // Text extracted from each page for PDF searchability
      viewportWidth,
      viewportHeight,
      isAIPlatform,
      pageUrl,
      pageTitle
    }).catch(() => {
      // If popup isn't open, reset the flag
      isFullPageCaptureInProgress = false;
    });
    
    return { success: true, pending: true };
  } catch (error) {
    console.log('[SnapToAI] Finalize:', error.message || error);
    isFullPageCaptureInProgress = false;
    return { success: false, error: error.message };
  }
}

// Reset full page capture state (called when stitch completes or fails)
function resetFullPageCaptureState() {
  isFullPageCaptureInProgress = false;
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
