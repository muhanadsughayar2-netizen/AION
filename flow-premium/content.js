// SnapToAI Content Script — BULLETPROOF VERSION
// Wrapped in IIFE to allow early return

(function() {
  'use strict';
  
  // Guard against multiple injections - but allow re-injection after errors
  // Reset flag on each page load to allow fresh start
  if (window.__snaptoai_loaded && window.__snaptoai_healthy) {
    console.log('[SnapToAI] Already loaded and healthy, skipping');
    return;
  }
  window.__snaptoai_loaded = true;
  window.__snaptoai_healthy = true; // Will be set to false on critical errors

  // Track last mouse position for toast placement
  let lastMouseX = window.innerWidth - 20;
  let lastMouseY = 20;
  
  // Guard against concurrent full page captures in this content script instance
  let isFullPageCaptureRunning = false;

  document.addEventListener('mousemove', (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }, { passive: true });

  // Get current mouse position
  function getMousePos() {
    return { x: lastMouseX, y: lastMouseY };
  }

  // Listen for messages from background script - BULLETPROOF ERROR HANDLING
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
      if (request.action === 'showToast') {
        showToast(request.message, request.type || 'success');
        sendResponse({ success: true });
      } else if (request.action === 'captureComplete') {
        showToast(request.message, 'success');
        sendResponse({ success: true });
      } else if (request.action === 'beginUpload') {
        uploadToAI(request.platform, request.useSelectedOnly)
          .then(sendResponse)
          .catch(err => {
            console.warn('[SnapToAI] Upload error:', err.message);
            sendResponse({ success: false, error: 'Upload not available on this page' });
          });
        return true;
      } else if (request.action === 'startFullPageScroll') {
        // Only run full page capture in main frame, not iframes
        if (window.self !== window.top) {
          console.log('[SnapToAI] Ignoring full page capture in iframe');
          sendResponse({ success: false, error: 'iframe' });
          return;
        }
        // Prevent concurrent captures in same content script
        if (isFullPageCaptureRunning) {
          console.log('[SnapToAI] Full page capture already running, ignoring duplicate request');
          sendResponse({ success: false, error: 'already_running' });
          return;
        }
        // Start full page capture with visible scrolling - WRAPPED IN SAFE HANDLER
        safeFullPageCapture(request.tabId)
          .then(sendResponse)
          .catch(err => {
            console.warn('[SnapToAI] Full page capture failed safely:', err.message);
            showToast('This page cannot be captured. Try SNAP instead.', 'error');
            sendResponse({ success: false, error: 'Page not capturable' });
          });
        return true;
      }
    } catch (err) {
      // NEVER let errors bubble up to Chrome
      console.warn('[SnapToAI] Message handler error:', err.message);
      sendResponse({ success: false, error: 'Internal error' });
    }
  });
  
  // BULLETPROOF wrapper for full page capture - catches all errors gracefully
  async function safeFullPageCapture(tabId) {
    try {
      return await performFullPageCapture(tabId);
    } catch (error) {
      // Log to console but NEVER throw - this prevents Chrome extension errors
      console.warn('[SnapToAI] Capture error (handled):', error.message || error);
      
      // Clean up any UI elements
      try {
        removeFullPageOverlay();
      } catch (e) {}
      
      // Reset state
      isFullPageCaptureRunning = false;
      
      // Notify background to reset state
      try {
        chrome.runtime.sendMessage({ action: 'fullPageStitchFailed' });
      } catch (e) {}
      
      // Show user-friendly message
      showToast('This page cannot be captured. Try SNAP instead.', 'error');
      
      return { success: false, error: 'Page not capturable' };
    }
  }

  // Show floating toast notification near cursor
  function showToast(message, type = 'success') {
    const existingToast = document.getElementById('flow-toast');
    if (existingToast) {
      existingToast.remove();
    }
    
    const toast = document.createElement('div');
    toast.id = 'flow-toast';
    toast.textContent = message;
    
    const mousePos = getMousePos();
    
    const offsetX = 20;
    const offsetY = -40;
    let posX = mousePos.x + offsetX;
    let posY = mousePos.y + offsetY;
    
    if (mousePos.x === window.innerWidth - 20 && mousePos.y === 20) {
      posX = (window.innerWidth / 2) - 100;
      posY = 20;
    }
    
    if (posX + 200 > window.innerWidth) {
      posX = mousePos.x - 220;
    }
    if (posY < 10) {
      posY = 10;
    }
    
    Object.assign(toast.style, {
      position: 'fixed',
      left: `${posX}px`,
      top: `${posY}px`,
      backgroundColor: type === 'success' ? 'rgba(0, 217, 255, 0.95)' : 'rgba(255, 59, 48, 0.95)',
      color: '#000',
      padding: '12px 24px',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: '600',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      boxShadow: '0 4px 20px rgba(0, 217, 255, 0.4)',
      zIndex: '2147483647',
      animation: 'flow-toast-fade-in 0.3s ease-out',
      backdropFilter: 'blur(10px)',
      pointerEvents: 'none'
    });
    
    if (!document.getElementById('flow-toast-styles')) {
      const style = document.createElement('style');
      style.id = 'flow-toast-styles';
      style.textContent = `
        @keyframes flow-toast-fade-in {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes flow-toast-fade-out {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0; transform: scale(0.9); }
        }
      `;
      document.head.appendChild(style);
    }
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'flow-toast-fade-out 0.3s ease-out';
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 2000);
  }

  // Write screenshot to clipboard
  async function writeToClipboard(dataUrl) {
    try {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob
        })
      ]);
      
      return { success: true };
    } catch (error) {
      console.error('Clipboard write failed:', error);
      return { success: false, error: error.message };
    }
  }

  // Upload snaps to AI platform
  async function uploadToAI(platform, useSelectedOnly = false) {
    try {
      console.log(`[SnapToAI] Starting upload to platform: ${platform}`);
      
      let snaps;
      if (useSelectedOnly) {
        const selectedResult = await chrome.storage.local.get('selectedSnapsForUpload');
        snaps = selectedResult.selectedSnapsForUpload || [];
        await chrome.storage.local.remove('selectedSnapsForUpload');
      } else {
        const result = await chrome.storage.local.get('snaps');
        snaps = result.snaps || [];
      }
      
      console.log(`[SnapToAI] Found ${snaps.length} snaps to upload`);
      
      if (snaps.length === 0) {
        showToast('No snaps to upload', 'error');
        return { success: false, error: 'No snaps found' };
      }
      
      const fileInput = await findFileInput(platform);
      
      if (!fileInput) {
        console.error('[SnapToAI] Could not find file input on this page');
        showToast('Upload button not found. Try clicking the paperclip/attach icon first.', 'error');
        return { success: false, error: 'File input not found. Make sure the chat input area is visible.' };
      }
      
      console.log(`[SnapToAI] File input found, uploading ${snaps.length} snaps...`);
      
      let uploadedCount = 0;
      for (let i = 0; i < snaps.length; i++) {
        try {
          const dataUrl = snaps[i];
          const file = await dataUrlToFile(dataUrl, `snap_${i + 1}.png`);
          
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          fileInput.files = dataTransfer.files;
          
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          fileInput.dispatchEvent(new Event('input', { bubbles: true }));
          
          uploadedCount++;
          console.log(`[SnapToAI] Uploaded snap ${i + 1}/${snaps.length}`);
          
          if (i < snaps.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1400));
          }
        } catch (snapError) {
          console.error(`[SnapToAI] Failed to upload snap ${i + 1}:`, snapError);
        }
      }
      
      if (uploadedCount === 0) {
        showToast('Upload failed - no images processed', 'error');
        return { success: false, error: 'Failed to process images' };
      }
      
      showToast(`${uploadedCount} snap${uploadedCount > 1 ? 's' : ''} uploaded ✓`, 'success');
      await chrome.storage.local.remove('snaps');
      chrome.runtime.sendMessage({ action: 'uploadComplete' });
      
      return { success: true, count: uploadedCount };
    } catch (error) {
      console.error('[SnapToAI] Upload failed:', error);
      showToast('Upload failed: ' + (error.message || 'Unknown error'), 'error');
      return { success: false, error: error.message };
    }
  }

  // Find file input for AI platform
  async function findFileInput(platform) {
    let selectors = [];
    
    if (platform.includes('chatgpt.com') || platform.includes('chat.openai.com')) {
      selectors = [
        'input[type="file"][accept*="image"]',
        'input[type="file"][multiple]',
        'input[type="file"][data-testid]',
        'input[type="file"]'
      ];
    } else if (platform.includes('claude.ai')) {
      selectors = [
        'input[type="file"][accept*="image"]',
        'input[type="file"][multiple]',
        'input[type="file"]'
      ];
    } else if (platform.includes('grok.com')) {
      selectors = [
        'input[type="file"][accept*="image"]',
        'input[type="file"]'
      ];
    } else {
      selectors = ['input[type="file"]'];
    }
    
    const maxRetries = 3;
    const retryDelay = 500;
    
    for (let retry = 0; retry < maxRetries; retry++) {
      for (const selector of selectors) {
        const inputs = document.querySelectorAll(selector);
        
        for (const input of inputs) {
          if (input && !input.disabled) {
            console.log(`[SnapToAI] Found file input with selector: ${selector}`);
            return input;
          }
        }
      }
      
      if (retry < maxRetries - 1) {
        console.log(`[SnapToAI] File input not found, retry ${retry + 1}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
    
    console.error('[SnapToAI] No file input found after all retries');
    return null;
  }

  // Convert dataURL to File object
  // For uploads: try JPEG for speed, fallback to PNG if conversion fails
  async function dataUrlToFile(dataUrl, filename, forUpload = true) {
    if (forUpload) {
      try {
        // Try to convert to optimized JPEG for faster AI platform uploads
        return await convertToOptimizedJpeg(dataUrl, filename.replace('.png', '.jpg'));
      } catch (e) {
        console.warn('[SnapToAI] JPEG conversion failed, using original PNG:', e.message);
        // Fall through to PNG
      }
    }
    // Keep original format for downloads (or if JPEG conversion failed)
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return new File([blob], filename, { type: 'image/png' });
  }
  
  // Convert dataURL to optimized JPEG for fast uploads
  async function convertToOptimizedJpeg(dataUrl, filename) {
    return new Promise((resolve, reject) => {
      try {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            
            // White background for JPEG (no transparency)
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            
            // Convert to JPEG with good quality (0.85 = good balance of quality/size)
            canvas.toBlob((blob) => {
              if (blob) {
                resolve(new File([blob], filename, { type: 'image/jpeg' }));
              } else {
                reject(new Error('Blob creation failed'));
              }
            }, 'image/jpeg', 0.85);
          } catch (canvasErr) {
            reject(canvasErr);
          }
        };
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = dataUrl;
      } catch (err) {
        reject(err);
      }
    });
  }

  // ============================================
  // FULL PAGE CAPTURE FUNCTIONS
  // ============================================
  
  // Create full page capture overlay
  function createFullPageOverlay() {
    // Remove existing overlay if any
    const existing = document.getElementById('snaptoai-fullpage-overlay');
    if (existing) existing.remove();
    
    const overlay = document.createElement('div');
    overlay.id = 'snaptoai-fullpage-overlay';
    overlay.innerHTML = `
      <div style="
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.9);
        border: 2px solid rgba(0, 217, 255, 0.7);
        border-radius: 12px;
        padding: 20px 30px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: white;
        backdrop-filter: blur(10px);
        box-shadow: 0 4px 30px rgba(0, 217, 255, 0.3);
      ">
        <div style="display: flex; align-items: center; gap: 15px;">
          <div style="
            width: 24px;
            height: 24px;
            border: 3px solid rgba(0, 217, 255, 0.3);
            border-top-color: rgba(0, 217, 255, 0.9);
            border-radius: 50%;
            animation: snaptoai-spin 0.8s linear infinite;
          "></div>
          <div>
            <div style="font-weight: 600; font-size: 14px; color: #00d9ff;">SnapToAI Full Page</div>
            <div id="snaptoai-progress-text" style="font-size: 12px; color: #aaa; margin-top: 4px;">Capturing... 0%</div>
          </div>
        </div>
      </div>
    `;
    
    // Add animation style
    const style = document.createElement('style');
    style.id = 'snaptoai-fullpage-styles';
    style.textContent = `
      @keyframes snaptoai-spin {
        to { transform: rotate(360deg); }
      }
    `;
    if (!document.getElementById('snaptoai-fullpage-styles')) {
      document.head.appendChild(style);
    }
    
    document.body.appendChild(overlay);
    return overlay;
  }
  
  // Update overlay progress
  function updateOverlayProgress(percent) {
    const progressText = document.getElementById('snaptoai-progress-text');
    if (progressText) {
      progressText.textContent = `Capturing... ${percent}%`;
    }
    
    // Also notify popup
    chrome.runtime.sendMessage({ 
      action: 'fullPageProgress', 
      progress: percent 
    }).catch(() => {});
  }
  
  // Remove overlay
  function removeFullPageOverlay() {
    const overlay = document.getElementById('snaptoai-fullpage-overlay');
    if (overlay) overlay.remove();
  }
  
  // Wait for scroll to settle (for infinite scroll sites)
  async function waitForScrollSettled(previousHeight, timeout = 500) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const currentHeight = document.documentElement.scrollHeight;
      if (currentHeight !== previousHeight) {
        // Height changed, reset wait
        previousHeight = currentHeight;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    return document.documentElement.scrollHeight;
  }
  
  // Temporarily hide sticky headers/footers during capture to avoid duplication
  function hideStickyElements() {
    const stickySelectors = [
      '[style*="position: sticky"]',
      '[style*="position: fixed"]',
      'header[class*="sticky"]',
      'nav[class*="sticky"]',
      'div[class*="sticky"]',
      '[class*="fixed-top"]',
      '[class*="fixed-header"]'
    ];
    
    const hidden = [];
    for (const sel of stickySelectors) {
      try {
        const elements = document.querySelectorAll(sel);
        elements.forEach(el => {
          // Don't hide our overlay
          if (el.id === 'snaptoai-fullpage-overlay') return;
          // Skip if already hidden
          if (el.dataset.snaptoaiHidden) return;
          
          const originalVisibility = el.style.visibility;
          el.style.visibility = 'hidden';
          el.dataset.snaptoaiHidden = 'true';
          el.dataset.snaptoaiOriginalVisibility = originalVisibility;
          hidden.push(el);
        });
      } catch (e) {
        continue;
      }
    }
    
    console.log(`[SnapToAI] Hid ${hidden.length} sticky elements`);
    return hidden;
  }
  
  // Restore hidden sticky elements
  function restoreStickyElements(elements) {
    elements.forEach(el => {
      try {
        el.style.visibility = el.dataset.snaptoaiOriginalVisibility || '';
        delete el.dataset.snaptoaiHidden;
        delete el.dataset.snaptoaiOriginalVisibility;
      } catch (e) {
        // Element may have been removed
      }
    });
    console.log(`[SnapToAI] Restored ${elements.length} sticky elements`);
  }
  
  // TIER 1: Check if document/body is scrollable (preferred - works on most sites)
  function findScrollableContainerTier1() {
    // ALWAYS try document-level scroll first - this works for 95% of sites
    // including AI chat platforms when properly expanded
    const docEl = document.documentElement;
    const body = document.body;
    
    // Check if document is scrollable
    if (docEl && docEl.scrollHeight > window.innerHeight + 100) {
      console.log(`[SnapToAI] Tier 1: Using documentElement (height: ${docEl.scrollHeight}px)`);
      return docEl;
    }
    
    // Check if body is scrollable
    if (body && body.scrollHeight > window.innerHeight + 100) {
      console.log(`[SnapToAI] Tier 1: Using body (height: ${body.scrollHeight}px)`);
      return body;
    }
    
    return null;
  }

  // TIER 2: AI Chat Platform specific selectors - ULTRA AI-PROOF
  // These selectors find the REAL scrolling container that AI platforms hide
  function findScrollableContainerTier2() {
    // Universal selectors that work across ALL AI platforms
    const universalSelectors = [
      // Grok specific
      'div[data-testid="conversation-container"]',
      'div[data-testid="conversation"]',
      // ChatGPT specific  
      'main div.overflow-y-auto',
      'div[class*="overflow-auto"]',
      '[data-testid^="conversation"]',
      // Claude specific
      'div[class*="messages"]',
      'div[class*="conversation"]',
      // Gemini / Perplexity / general
      'div[style*="overflow"]',
      'div[class*="scroll"]',
      '[role="main"]',
      'main'
    ];
    
    console.log('[SnapToAI] Tier 2: Scanning for AI scroll container...');
    
    for (const selector of universalSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          // Check if this element is actually scrollable
          if (el && el.scrollHeight > el.clientHeight + 50 && el.scrollHeight > window.innerHeight) {
            const style = window.getComputedStyle(el);
            const isScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll' || 
                                 style.overflow === 'auto' || style.overflow === 'scroll';
            
            if (isScrollable || el.scrollHeight > window.innerHeight * 1.5) {
              console.log(`[SnapToAI] Tier 2: Found scroll container: ${selector}, height: ${el.scrollHeight}px`);
              return el;
            }
          }
        }
      } catch (e) {
        continue;
      }
    }
    
    // Last resort: find ANY div with overflow that's scrollable
    try {
      const allDivs = document.querySelectorAll('div');
      let best = null;
      let bestHeight = 0;
      
      for (const el of allDivs) {
        try {
          const style = window.getComputedStyle(el);
          const isScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll';
          
          if (isScrollable && el.scrollHeight > el.clientHeight + 100 && 
              el.scrollHeight > window.innerHeight && el.scrollHeight > bestHeight) {
            best = el;
            bestHeight = el.scrollHeight;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (best) {
        console.log(`[SnapToAI] Tier 2: Found scrollable div, height: ${bestHeight}px`);
        return best;
      }
    } catch (e) {
      console.log('[SnapToAI] Tier 2: Scan failed:', e.message);
    }
    
    return null;
  }

  // TIER 3: Use document.body or documentElement as fallback
  function findScrollableContainerTier3() {
    try {
      // Check if body exists and is scrollable
      if (document.body && document.body.scrollHeight && 
          document.body.scrollHeight > window.innerHeight + 100) {
        console.log('[SnapToAI] Tier 3: Using document.body');
        return document.body;
      }
      // Check documentElement
      if (document.documentElement && document.documentElement.scrollHeight &&
          document.documentElement.scrollHeight > window.innerHeight + 100) {
        console.log('[SnapToAI] Tier 3: Using documentElement');
        return document.documentElement;
      }
    } catch (e) {
      console.log('[SnapToAI] Tier 3 error:', e);
    }
    return null;
  }

  // Master function: tries all tiers
  function findScrollableContainer() {
    console.log('[SnapToAI] Finding scrollable container...');
    const host = window.location.hostname.toLowerCase();
    
    // AI platforms: Check Tier 2 FIRST (their scroll containers are internal, not body)
    const aiPlatforms = ['grok.com', 'grok.x.ai', 'chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai'];
    const isAIPlatform = aiPlatforms.some(p => host.includes(p));
    
    if (isAIPlatform) {
      console.log('[SnapToAI] AI platform detected - checking internal containers first');
      let container = findScrollableContainerTier2();
      if (container) return container;
      
      // Fallback to document/body
      container = findScrollableContainerTier1();
      if (container) return container;
    } else {
      // Normal sites: Check document/body first
      let container = findScrollableContainerTier1();
      if (container) return container;
      
      // Then check internal containers
      container = findScrollableContainerTier2();
      if (container) return container;
    }
    
    // Try Tier 3: Body/documentElement fallback
    let container = findScrollableContainerTier3();
    if (container) return container;
    
    console.log('[SnapToAI] No scrollable container found - page may be short');
    return null;
  }

  // Simple viewport capture - fallback for short pages
  async function simpleViewportCapture(tabId) {
    try {
      const response = await chrome.runtime.sendMessage({ 
        action: 'fullPageCaptureStep',
        tabId: tabId
      });
      
      if (response.success && response.dataUrl) {
        // Save single screenshot as full page result
        await chrome.storage.local.set({ 
          fullPageScreenshots: [response.dataUrl],
          fullPageViewportWidth: window.innerWidth,
          fullPageViewportHeight: window.innerHeight
        });
        
        // Open annotate screen
        chrome.runtime.sendMessage({
          action: 'openAnnotateForFullPage'
        });
        
        return { success: true };
      } else {
        showToast('Capture failed - try SNAP instead', 'error');
        return { success: false, error: 'Capture failed' };
      }
    } catch (error) {
      console.warn('[SnapToAI] Simple capture issue:', error?.message || error);
      showToast('Capture failed: ' + error.message, 'error');
      return { success: false, error: error.message };
    }
  }

  // Detect if this is a complex web app with non-scrollable body
  // NOTE: AI chat platforms are NOT treated as complex apps - we try to capture them
  function isComplexWebApp() {
    const host = window.location.hostname.toLowerCase();
    
    // AI platforms we WANT to capture - never treat as complex apps
    const aiPlatforms = ['grok.com', 'grok.x.ai', 'chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai'];
    for (const ai of aiPlatforms) {
      if (host.includes(ai)) {
        console.log('[SnapToAI] AI platform detected - will attempt full capture');
        return false; // NOT a complex app - try to capture
      }
    }
    
    // These are truly complex apps with fixed layouts that can't be scroll-captured
    const complexApps = ['replit.com', 'figma.com', 'canva.com', 'notion.so', 'airtable.com', 'miro.com'];
    
    // Check by hostname
    for (const app of complexApps) {
      if (host.includes(app)) return true;
    }
    
    // Check if body has fixed/hidden overflow (indicator of complex app layout)
    const bodyStyle = window.getComputedStyle(document.body);
    const htmlStyle = window.getComputedStyle(document.documentElement);
    
    if ((bodyStyle.overflow === 'hidden' || bodyStyle.overflowY === 'hidden') &&
        (htmlStyle.overflow === 'hidden' || htmlStyle.overflowY === 'hidden')) {
      // Both body and html have hidden overflow - likely a complex app
      const bodyHeight = document.body.scrollHeight || 0;
      const viewportHeight = window.innerHeight;
      
      // If body height equals viewport, it's a fixed-layout app
      if (Math.abs(bodyHeight - viewportHeight) < 50) {
        return true;
      }
    }
    
    return false;
  }
  
  // Pre-flight check: validate page is capturable
  function preFlightCheck() {
    const result = {
      canCapture: true,
      warnings: [],
      errors: [],
      pageHeight: 0,
      viewportHeight: window.innerHeight,
      isComplexApp: false,
      isAIPlatform: false
    };
    
    try {
      // Check if this is a complex web app (Replit, Figma, etc.)
      result.isComplexApp = isComplexWebApp();
      if (result.isComplexApp) {
        result.warnings.push('Complex app detected - capturing viewport only');
      }
      
      // Check if this is an AI platform (they hide scroll in nested containers)
      const host = window.location.hostname.toLowerCase();
      const aiPlatforms = ['grok.com', 'grok.x.ai', 'chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai'];
      result.isAIPlatform = aiPlatforms.some(p => host.includes(p));
      
      // Check page height (with null checks)
      const bodyHeight = document.body ? (document.body.scrollHeight || 0) : 0;
      const docHeight = document.documentElement ? (document.documentElement.scrollHeight || 0) : 0;
      let maxHeight = Math.max(bodyHeight, docHeight);
      
      // CRITICAL FIX: For AI platforms, also check for hidden scroll containers
      // because body has overflow:hidden and scrollHeight is misleading
      if (result.isAIPlatform) {
        const scrollContainer = findScrollableContainerTier2();
        if (scrollContainer && scrollContainer.scrollHeight > maxHeight) {
          maxHeight = scrollContainer.scrollHeight;
          console.log(`[SnapToAI] AI platform detected - using container height: ${maxHeight}px`);
        }
      }
      
      result.pageHeight = maxHeight;
      
      // Warning: page is very short (but skip this warning for AI platforms - they often look short)
      if (result.pageHeight <= result.viewportHeight && !result.isAIPlatform) {
        result.warnings.push('Page fits in one screen - use SNAP instead');
      }
      
      // Warning: page is extremely long
      if (result.pageHeight > 50000) {
        result.warnings.push('Very long page - may create many chunks');
      }
      
      // Check for problematic elements
      const iframes = document.querySelectorAll('iframe');
      if (iframes.length > 5) {
        result.warnings.push('Page has many iframes - some content may not capture');
      }
      
    } catch (e) {
      result.errors.push('Pre-flight check failed: ' + e.message);
    }
    
    result.canCapture = result.errors.length === 0;
    return result;
  }
  
  // Save and set a style property, tracking original value
  function saveAndSetStyle(el, prop, value, originalStyles) {
    if (!originalStyles.has(el)) originalStyles.set(el, new Map());
    if (!originalStyles.get(el).has(prop)) {
      originalStyles.get(el).set(prop, el.style[prop]);
    }
    el.style[prop] = value;
  }
  
  // Expand scrollable container and ALL its ancestors
  function expandForFullPage(scrollContainer) {
    const originalStyles = new Map();
    
    // Build list: html, body, scrollContainer, and all ancestors
    const elementsToExpand = [document.documentElement, document.body];
    
    if (scrollContainer) {
      elementsToExpand.push(scrollContainer);
      // Add all ancestors
      let parent = scrollContainer.parentElement;
      while (parent && parent !== document.documentElement) {
        elementsToExpand.push(parent);
        parent = parent.parentElement;
      }
    }
    
    // Expand each element
    for (const el of elementsToExpand) {
      saveAndSetStyle(el, 'overflow', 'visible', originalStyles);
      saveAndSetStyle(el, 'overflowX', 'visible', originalStyles);
      saveAndSetStyle(el, 'overflowY', 'visible', originalStyles);
      saveAndSetStyle(el, 'height', 'auto', originalStyles);
      saveAndSetStyle(el, 'maxHeight', 'none', originalStyles);
      saveAndSetStyle(el, 'position', 'static', originalStyles);
    }
    
    // Force scrollContainer to show full content
    if (scrollContainer) {
      saveAndSetStyle(scrollContainer, 'height', scrollContainer.scrollHeight + 'px', originalStyles);
      saveAndSetStyle(scrollContainer, 'minHeight', '100vh', originalStyles);
    }
    
    console.log(`[SnapToAI] Expanded ${elementsToExpand.length} elements for full page capture`);
    return originalStyles;
  }
  
  // Restore all original styles
  function restoreExpandedStyles(originalStyles) {
    originalStyles.forEach((props, el) => {
      props.forEach((val, prop) => {
        el.style[prop] = val;
      });
    });
    console.log(`[SnapToAI] Restored ${originalStyles.size} element styles`);
  }

  // Perform full page scroll and capture - with robust error handling
  async function performFullPageCapture(tabId) {
    // Set guard flag immediately
    isFullPageCaptureRunning = true;
    console.log('[SnapToAI] Full page capture started');
    
    // PRE-FLIGHT CHECK
    const preflight = preFlightCheck();
    console.log('[SnapToAI] Pre-flight:', preflight);
    
    if (!preflight.canCapture) {
      showToast('Cannot capture this page: ' + preflight.errors.join(', '), 'error');
      isFullPageCaptureRunning = false;
      return { success: false, error: preflight.errors.join(', ') };
    }
    
    // COMPLEX APP DETECTION: Replit, Figma, etc. have fixed layouts that can't be scroll-captured
    if (preflight.isComplexApp) {
      showToast('App layout detected - capturing visible screen', 'success');
      isFullPageCaptureRunning = false;
      return await simpleViewportCapture(tabId);
    }
    
    // Warn user if page is very short (BUT skip for AI platforms - they need container scroll)
    if (preflight.pageHeight <= preflight.viewportHeight + 50 && !preflight.isAIPlatform) {
      showToast('Page is short - using simple capture', 'success');
      // Fall back to simple viewport capture
      isFullPageCaptureRunning = false;
      return await simpleViewportCapture(tabId);
    }
    
    const overlay = createFullPageOverlay();
    const screenshots = [];
    let originalStyles = null;
    
    try {
      // Get page dimensions
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      
      // Check if this is an AI platform
      const host = window.location.hostname.toLowerCase();
      const aiPlatforms = ['grok.com', 'grok.x.ai', 'chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai'];
      const isAIPlatform = aiPlatforms.some(p => host.includes(p));
      
      // Step 1: Find the main scrollable container
      const scrollContainer = findScrollableContainer();
      const containerScrollHeight = scrollContainer ? scrollContainer.scrollHeight : 0;
      console.log(`[SnapToAI] Scroll container: ${scrollContainer ? scrollContainer.tagName : 'none'}, height: ${containerScrollHeight}px`);
      
      // Determine if we're using container scroll
      const isRealContainer = scrollContainer && 
                              scrollContainer !== document.documentElement && 
                              scrollContainer !== document.body &&
                              scrollContainer !== window;
      const useContainerScroll = isRealContainer || (isAIPlatform && scrollContainer && scrollContainer.scrollHeight > viewportHeight);
      
      // CRITICAL: For AI platforms, do NOT expand styles (it breaks scrolling!)
      if (!isAIPlatform && !useContainerScroll) {
        const initialHeight = document.documentElement.scrollHeight;
        console.log(`[SnapToAI] Initial document height: ${initialHeight}px`);
        
        originalStyles = expandForFullPage(scrollContainer);
        
        await new Promise(resolve => requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        }));
        await new Promise(resolve => setTimeout(resolve, 300));
      } else {
        console.log('[SnapToAI] AI platform detected - skipping style expansion to preserve scroll');
      }
      
      // Scroll step size (full viewport for AI platforms, 90% otherwise)
      const stepHeight = isAIPlatform ? viewportHeight : Math.floor(viewportHeight * 0.9);
      
      // Get the scroll target
      const scrollTarget = useContainerScroll ? scrollContainer : window;
      
      // Helper to get scroll position
      const getScrollTop = () => {
        if (useContainerScroll) {
          return scrollContainer.scrollTop;
        }
        return window.scrollY || document.documentElement.scrollTop;
      };
      
      // Helper to get max scroll height
      const getMaxScroll = () => {
        if (useContainerScroll) {
          return scrollContainer.scrollHeight - scrollContainer.clientHeight;
        }
        return document.documentElement.scrollHeight - window.innerHeight;
      };
      
      // Scroll to top first
      if (useContainerScroll) {
        scrollContainer.scrollTo(0, 0);
      } else {
        window.scrollTo(0, 0);
      }
      await new Promise(resolve => setTimeout(resolve, 300));
      
      console.log(`[SnapToAI] Starting capture - containerScroll: ${useContainerScroll}, isAI: ${isAIPlatform}`);
      
      // === AI-PROOF CAPTURE LOOP ===
      // Uses scrollBy + checks if scroll actually moved (detects real bottom)
      let lastScrollTop = -1;
      let captureCount = 0;
      const maxCaptures = 100; // Safety limit
      
      while (captureCount < maxCaptures) {
        const currentScrollTop = getScrollTop();
        
        // Update progress (estimate based on scroll position)
        const maxScroll = getMaxScroll();
        const progress = maxScroll > 0 ? Math.min(99, Math.round((currentScrollTop / maxScroll) * 100)) : 50;
        updateOverlayProgress(progress);
        
        // HIDE overlay before capture (so it doesn't appear in screenshot!)
        overlay.style.visibility = 'hidden';
        await new Promise(resolve => setTimeout(resolve, 50)); // Brief wait for render
        
        // Request capture from background script
        const response = await chrome.runtime.sendMessage({ 
          action: 'fullPageCaptureStep',
          tabId: tabId
        });
        
        // SHOW overlay again after capture
        overlay.style.visibility = 'visible';
        
        if (response.success && response.dataUrl) {
          screenshots.push({
            dataUrl: response.dataUrl,
            scrollY: currentScrollTop,
            index: captureCount
          });
          console.log(`[SnapToAI] Captured ${captureCount + 1}, scrollTop: ${currentScrollTop}px`);
        } else {
          console.warn(`[SnapToAI] Capture ${captureCount + 1} failed:`, response.error);
        }
        
        captureCount++;
        
        // Check if we've reached the bottom (scroll position didn't change)
        if (currentScrollTop === lastScrollTop && captureCount > 1) {
          console.log('[SnapToAI] Reached bottom - scroll stopped moving');
          break;
        }
        
        // Check if we're at max scroll
        if (currentScrollTop >= getMaxScroll() - 10) {
          console.log('[SnapToAI] Reached max scroll position');
          break;
        }
        
        lastScrollTop = currentScrollTop;
        
        // Scroll down by one viewport using scrollBy (works on AI platforms!)
        if (useContainerScroll) {
          scrollContainer.scrollBy(0, stepHeight);
        } else {
          window.scrollBy(0, stepHeight);
        }
        
        // Wait for scroll + render
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      console.log(`[SnapToAI] Full page capture complete: ${screenshots.length} images`);
      updateOverlayProgress(100);
      
      // Restore element styles before removing overlay
      if (originalStyles && originalStyles.size > 0) {
        restoreExpandedStyles(originalStyles);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Remove overlay
      removeFullPageOverlay();
      
      // Scroll back to top (using container or window)
      scrollTo(0);
      
      if (screenshots.length === 0) {
        throw new Error('No screenshots captured');
      }
      
      // Send screenshots to background for stitching
      console.log(`[SnapToAI] Sending ${screenshots.length} screenshots for stitching`);
      
      // Only send if we have screenshots - background will handle completion messaging
      chrome.runtime.sendMessage({
        action: 'fullPageCaptureComplete',
        screenshots: screenshots.map(s => s.dataUrl),
        viewportWidth,
        viewportHeight
      });
      
      return { success: true, count: screenshots.length };
    } catch (error) {
      // Use console.warn, NEVER console.error - prevents Chrome extension warnings
      console.warn('[SnapToAI] Full page capture issue:', error?.message || error);
      
      // Restore element styles on error
      try {
        if (originalStyles && originalStyles.size > 0) {
          restoreExpandedStyles(originalStyles);
        }
      } catch (e) {}
      
      try {
        removeFullPageOverlay();
      } catch (e) {}
      
      // SHOW USER-FRIENDLY ERROR MESSAGE - calm, not alarming
      showToast('This page cannot be captured. Try SNAP instead.', 'error');
      
      // Notify background of failure so it can reset state - wrapped in try/catch
      try {
        chrome.runtime.sendMessage({
          action: 'fullPageStitchFailed'
        });
      } catch (e) {}
      
      return { success: false, error: 'Page not capturable' };
    } finally {
      // Always reset guard flag
      isFullPageCaptureRunning = false;
      console.log('[SnapToAI] Full page capture ended');
    }
  }

})();
