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
  function updateOverlayProgress(percent, current = null, total = null) {
    const progressText = document.getElementById('snaptoai-progress-text');
    if (progressText) {
      // === TOUCH #7: PREMIUM PROGRESS TEXT ===
      if (percent >= 100) {
        progressText.innerHTML = `<span style="color: #4ade80;">✓</span> Capture complete!`;
      } else if (current !== null && total !== null) {
        progressText.textContent = `Capturing magic… ${current} of ${total}`;
      } else {
        progressText.textContent = `Capturing magic… ${percent}%`;
      }
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
  
  // ============================================================
  // SMART SCROLL STABILIZER v2
  // Waits for scrollHeight to stop changing before capture
  // Eliminates white gaps and duplicated posts on infinite-scroll pages
  // ============================================================
  
  /**
   * waitForScrollStabilization() - Waits for page content to stabilize
   * 
   * Checks every 50ms until scrollHeight stops changing (max 400ms)
   * This ensures lazy-loaded content has finished loading before capture
   * 
   * @param {Element|null} scrollContainer - The scroll container (or null for window)
   * @param {boolean} useContainerScroll - Whether to use container or window scroll
   * @returns {Promise<boolean>} - True if stabilized, false if timeout
   */
  async function waitForScrollStabilization(scrollContainer, useContainerScroll) {
    const MAX_WAIT = 400;      // Maximum wait time in ms
    const CHECK_INTERVAL = 50; // Check every 50ms
    const STABLE_COUNT = 2;    // Need 2 consecutive stable readings
    
    let lastScrollHeight = 0;
    let lastClientHeight = 0;
    let stableCount = 0;
    let elapsed = 0;
    
    // Get current scroll height
    const getScrollHeight = () => {
      try {
        if (useContainerScroll && scrollContainer) {
          return scrollContainer.scrollHeight || 0;
        }
        return document.documentElement.scrollHeight || 0;
      } catch (e) {
        return 0;
      }
    };
    
    // Get current client height (visible area)
    const getClientHeight = () => {
      try {
        if (useContainerScroll && scrollContainer) {
          return scrollContainer.clientHeight || 0;
        }
        return window.innerHeight || 0;
      } catch (e) {
        return 0;
      }
    };
    
    // Initial reading
    lastScrollHeight = getScrollHeight();
    lastClientHeight = getClientHeight();
    
    return new Promise(resolve => {
      const check = () => {
        const currentScrollHeight = getScrollHeight();
        const currentClientHeight = getClientHeight();
        
        // Check if heights are stable
        if (currentScrollHeight === lastScrollHeight && currentClientHeight === lastClientHeight) {
          stableCount++;
          if (stableCount >= STABLE_COUNT) {
            // Stabilized!
            resolve(true);
            return;
          }
        } else {
          // Heights changed, reset counter
          stableCount = 0;
          lastScrollHeight = currentScrollHeight;
          lastClientHeight = currentClientHeight;
        }
        
        elapsed += CHECK_INTERVAL;
        
        if (elapsed >= MAX_WAIT) {
          // Timeout - proceed anyway
          resolve(false);
          return;
        }
        
        // Check again after interval
        setTimeout(check, CHECK_INTERVAL);
      };
      
      // Start checking after first interval
      setTimeout(check, CHECK_INTERVAL);
    });
  }
  
  // ============================================================
  // CANVAS / WEBGL / VIDEO CAPTURE ENGINE
  // Replaces dynamic canvas/WebGL/video with static images during capture
  // Fixes: black charts, maps, Figma, Replit previews, YouTube videos
  // ============================================================
  
  // Storage for canvas/video replacements
  const mediaState = {
    canvasElements: [],    // Original canvas elements and their data
    videoElements: [],     // Original video elements and their frames
    isMediaCaptured: false
  };
  
  /**
   * captureCanvasAndVideo() - Captures all canvas and video elements
   * 
   * Replaces each canvas with a static image of its current content
   * Replaces each video with a static image of its current frame
   * This ensures dynamic content appears in screenshots instead of black boxes
   */
  function captureCanvasAndVideo() {
    if (mediaState.isMediaCaptured) {
      console.log('[SnapToAI] Media already captured, skipping');
      return;
    }
    
    console.log('[SnapToAI] 🎬 Capturing canvas/WebGL/video elements...');
    
    try {
      // 1. CAPTURE ALL CANVAS ELEMENTS (including WebGL)
      const canvases = document.querySelectorAll('canvas');
      canvases.forEach((canvas, index) => {
        try {
          // Skip if canvas is too small or invisible
          if (canvas.width < 10 || canvas.height < 10) return;
          if (canvas.offsetWidth === 0 || canvas.offsetHeight === 0) return;
          
          // Try to capture canvas content
          let dataUrl = null;
          
          try {
            // For WebGL, we need to preserve drawing buffer
            const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
            if (gl) {
              // WebGL canvas - attempt to capture
              // Note: Some WebGL contexts don't have preserveDrawingBuffer
              // and may return a blank image
              dataUrl = canvas.toDataURL('image/png');
            } else {
              // 2D canvas - straightforward capture
              dataUrl = canvas.toDataURL('image/png');
            }
          } catch (e) {
            // Canvas may be tainted by CORS
            console.warn(`[SnapToAI] Canvas ${index} is tainted, cannot capture`);
            return;
          }
          
          if (!dataUrl || dataUrl === 'data:,') return;
          
          // Create replacement image
          const img = document.createElement('img');
          img.src = dataUrl;
          img.style.cssText = window.getComputedStyle(canvas).cssText;
          img.style.width = canvas.offsetWidth + 'px';
          img.style.height = canvas.offsetHeight + 'px';
          img.className = canvas.className;
          img.dataset.snaptoaiCanvasReplacement = 'true';
          
          // Store original canvas and its parent
          mediaState.canvasElements.push({
            original: canvas,
            replacement: img,
            parent: canvas.parentNode,
            nextSibling: canvas.nextSibling,
            originalDisplay: canvas.style.display
          });
          
          // Replace canvas with static image
          canvas.style.display = 'none';
          canvas.parentNode.insertBefore(img, canvas);
          
        } catch (e) {
          console.warn(`[SnapToAI] Failed to capture canvas ${index}:`, e.message);
        }
      });
      
      console.log(`[SnapToAI] Captured ${mediaState.canvasElements.length} canvas elements`);
      
      // 2. CAPTURE ALL VIDEO ELEMENTS
      const videos = document.querySelectorAll('video');
      videos.forEach((video, index) => {
        try {
          // Skip if video is too small or invisible
          if (video.videoWidth < 10 || video.videoHeight < 10) return;
          if (video.offsetWidth === 0 || video.offsetHeight === 0) return;
          
          // Create canvas to capture current frame
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = video.videoWidth;
          tempCanvas.height = video.videoHeight;
          const tempCtx = tempCanvas.getContext('2d');
          
          try {
            // Draw current video frame to canvas
            tempCtx.drawImage(video, 0, 0);
            const dataUrl = tempCanvas.toDataURL('image/png');
            
            if (!dataUrl || dataUrl === 'data:,') return;
            
            // Create replacement image
            const img = document.createElement('img');
            img.src = dataUrl;
            img.style.cssText = window.getComputedStyle(video).cssText;
            img.style.width = video.offsetWidth + 'px';
            img.style.height = video.offsetHeight + 'px';
            img.className = video.className;
            img.dataset.snaptoaiVideoReplacement = 'true';
            
            // Store original video and its parent
            mediaState.videoElements.push({
              original: video,
              replacement: img,
              parent: video.parentNode,
              nextSibling: video.nextSibling,
              originalDisplay: video.style.display,
              wasPlaying: !video.paused,
              currentTime: video.currentTime
            });
            
            // Replace video with static image
            video.style.display = 'none';
            video.parentNode.insertBefore(img, video);
            
          } catch (e) {
            // Video may be CORS-restricted
            console.warn(`[SnapToAI] Video ${index} is CORS-restricted, cannot capture frame`);
          }
          
        } catch (e) {
          console.warn(`[SnapToAI] Failed to capture video ${index}:`, e.message);
        }
      });
      
      console.log(`[SnapToAI] Captured ${mediaState.videoElements.length} video elements`);
      
      mediaState.isMediaCaptured = true;
      console.log('[SnapToAI] 🎬 Canvas/WebGL/video capture complete');
      
    } catch (error) {
      console.warn('[SnapToAI] Media capture error (non-fatal):', error.message);
    }
  }
  
  /**
   * restoreCanvasAndVideo() - Restores all original canvas and video elements
   * 
   * Removes replacement images and shows original elements again
   */
  function restoreCanvasAndVideo() {
    if (!mediaState.isMediaCaptured) {
      console.log('[SnapToAI] No media to restore');
      return;
    }
    
    console.log('[SnapToAI] 🔄 Restoring canvas/WebGL/video elements...');
    
    try {
      // 1. RESTORE CANVAS ELEMENTS
      mediaState.canvasElements.forEach(item => {
        try {
          // Remove replacement image
          if (item.replacement && item.replacement.parentNode) {
            item.replacement.parentNode.removeChild(item.replacement);
          }
          // Show original canvas
          item.original.style.display = item.originalDisplay || '';
        } catch (e) {}
      });
      
      // 2. RESTORE VIDEO ELEMENTS
      mediaState.videoElements.forEach(item => {
        try {
          // Remove replacement image
          if (item.replacement && item.replacement.parentNode) {
            item.replacement.parentNode.removeChild(item.replacement);
          }
          // Show original video
          item.original.style.display = item.originalDisplay || '';
          // Resume playback if was playing
          if (item.wasPlaying) {
            item.original.play().catch(() => {});
          }
        } catch (e) {}
      });
      
      // Reset state
      mediaState.canvasElements = [];
      mediaState.videoElements = [];
      mediaState.isMediaCaptured = false;
      
      console.log('[SnapToAI] 🔄 Canvas/WebGL/video restore complete');
      
    } catch (error) {
      console.warn('[SnapToAI] Media restore error (non-fatal):', error.message);
      // Force reset state even on error
      mediaState.canvasElements = [];
      mediaState.videoElements = [];
      mediaState.isMediaCaptured = false;
    }
  }
  
  // ============================================================
  // END CANVAS / WEBGL / VIDEO CAPTURE ENGINE
  // ============================================================
  
  // ============================================================
  // DOM FREEZE ENGINE - Professional Full Page Capture
  // Freezes ALL dynamic content during capture for perfect results
  // ============================================================
  
  // Storage for original states (for perfect restoration)
  const freezeState = {
    styleElement: null,
    originalRAF: null,
    rafBlocked: false,
    mutationObservers: [],
    originalCursor: null,
    originalOverflow: null,
    hiddenSpinners: [],
    intersectionObservers: [],
    animatedImages: [],
    videos: [],
    intervals: [],
    timeouts: [],
    scrollListeners: [],
    isFrozen: false
  };
  
  /**
   * freezeDOM() - Freezes ALL dynamic content on the page
   * 
   * What it freezes:
   * - All CSS animations (paused)
   * - All CSS transitions (disabled)
   * - All GIFs and animated images (paused via canvas replacement)
   * - requestAnimationFrame (blocked)
   * - MutationObserver callbacks (disconnected)
   * - IntersectionObserver (disconnected - stops lazy loading)
   * - Videos (paused)
   * - Scroll-triggered events (blocked)
   * - Blinking cursors (hidden)
   */
  function freezeDOM() {
    if (freezeState.isFrozen) {
      console.log('[SnapToAI] DOM already frozen, skipping');
      return;
    }
    
    console.log('[SnapToAI] 🧊 Freezing DOM...');
    
    try {
      // === TOUCH #1: CURSOR & SELECTION KILLER ===
      // Hide cursor and remove any text selection
      freezeState.originalCursor = document.body.style.cursor;
      document.body.style.cursor = 'none';
      try {
        window.getSelection()?.removeAllRanges();
      } catch (e) {}
      
      // === TOUCH #4: SCROLLBAR HIDER ===
      // Hide scrollbars for clean capture (GoFullPage does this)
      freezeState.originalOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      
      // 1. INJECT FREEZE STYLESHEET
      // Pauses all CSS animations and disables all transitions
      const freezeCSS = document.createElement('style');
      freezeCSS.id = 'snaptoai-freeze-styles';
      freezeCSS.textContent = `
        /* Pause ALL CSS animations */
        *, *::before, *::after {
          animation-play-state: paused !important;
          -webkit-animation-play-state: paused !important;
        }
        
        /* Disable ALL CSS transitions */
        *, *::before, *::after {
          transition: none !important;
          -webkit-transition: none !important;
        }
        
        /* === TOUCH #1: Hide blinking cursors and selections === */
        *::selection { background: transparent !important; }
        [contenteditable], input, textarea {
          caret-color: transparent !important;
        }
        
        /* === TOUCH #3: FOCUS OUTLINE KILLER === */
        /* Removes ugly blue focus rings on ChatGPT/Gemini input boxes */
        *:focus, *:focus-visible {
          outline: none !important;
          box-shadow: none !important;
        }
        
        /* Freeze any loading spinners */
        [class*="loading"], [class*="spinner"], [class*="loader"] {
          animation-play-state: paused !important;
        }
        
        /* Disable smooth scrolling during capture */
        html, body, * {
          scroll-behavior: auto !important;
        }
        
        /* === TOUCH #2: HOVER-STATE KILLER === */
        /* Disable pointer events to prevent hover states changing */
        body.snaptoai-frozen * {
          pointer-events: none !important;
        }
        
        /* === TOUCH #4: SCROLLBAR HIDER === */
        ::-webkit-scrollbar {
          display: none !important;
        }
        * {
          scrollbar-width: none !important;
        }
      `;
      document.head.appendChild(freezeCSS);
      freezeState.styleElement = freezeCSS;
      
      // Add frozen class to body
      document.body.classList.add('snaptoai-frozen');
      
      // 2. BLOCK requestAnimationFrame
      // This stops JS-driven animations (React transitions, D3 charts, etc.)
      freezeState.originalRAF = window.requestAnimationFrame;
      freezeState.rafBlocked = true;
      window.requestAnimationFrame = function(callback) {
        // Store but don't execute - will be restored later
        return 0;
      };
      
      // 3. DISCONNECT ALL MutationObservers
      // This prevents React/Vue/Angular from updating the DOM during capture
      try {
        // We can't access existing observers directly, but we can override the constructor
        // to catch new ones. For existing ones, we rely on the CSS freeze.
        const originalMutationObserver = window.MutationObserver;
        window.MutationObserver = function(callback) {
          const observer = new originalMutationObserver(callback);
          const originalObserve = observer.observe.bind(observer);
          observer.observe = function() {
            // Don't observe while frozen
            if (freezeState.isFrozen) return;
            return originalObserve.apply(this, arguments);
          };
          freezeState.mutationObservers.push({ observer, originalObserve });
          return observer;
        };
        window.MutationObserver.prototype = originalMutationObserver.prototype;
        freezeState.originalMutationObserver = originalMutationObserver;
      } catch (e) {
        console.warn('[SnapToAI] Could not override MutationObserver:', e.message);
      }
      
      // 4. DISCONNECT ALL IntersectionObservers
      // This stops lazy-loading images from loading during capture
      try {
        const originalIntersectionObserver = window.IntersectionObserver;
        if (originalIntersectionObserver) {
          window.IntersectionObserver = function(callback, options) {
            const observer = new originalIntersectionObserver(callback, options);
            const originalObserve = observer.observe.bind(observer);
            observer.observe = function() {
              if (freezeState.isFrozen) return;
              return originalObserve.apply(this, arguments);
            };
            freezeState.intersectionObservers.push({ observer, originalObserve });
            return observer;
          };
          window.IntersectionObserver.prototype = originalIntersectionObserver.prototype;
          freezeState.originalIntersectionObserver = originalIntersectionObserver;
        }
      } catch (e) {
        console.warn('[SnapToAI] Could not override IntersectionObserver:', e.message);
      }
      
      // 5. PAUSE ALL VIDEOS
      try {
        const videos = document.querySelectorAll('video');
        videos.forEach(video => {
          if (!video.paused) {
            freezeState.videos.push({
              element: video,
              wasPlaying: true,
              currentTime: video.currentTime
            });
            video.pause();
          }
        });
        console.log(`[SnapToAI] Paused ${freezeState.videos.length} videos`);
      } catch (e) {}
      
      // 6. FREEZE GIFS AND ANIMATED IMAGES
      // Replace animated GIFs with static canvas snapshots
      try {
        const images = document.querySelectorAll('img[src*=".gif"], img[src*="giphy"], img[src*="tenor"]');
        images.forEach(img => {
          try {
            // Only freeze if image is loaded and visible
            if (!img.complete || img.offsetWidth === 0) return;
            
            // Create canvas with current frame
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            
            // Store original src and replace with static image
            freezeState.animatedImages.push({
              element: img,
              originalSrc: img.src,
              originalSrcset: img.srcset
            });
            
            // Replace with data URL of current frame
            try {
              img.src = canvas.toDataURL('image/png');
              img.srcset = '';
            } catch (e) {
              // Canvas tainted by CORS - skip this image
            }
          } catch (e) {}
        });
        console.log(`[SnapToAI] Froze ${freezeState.animatedImages.length} animated images`);
      } catch (e) {}
      
      // 7. BLOCK SCROLL EVENT LISTENERS (prevent lazy load triggers)
      try {
        const originalAddEventListener = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function(type, listener, options) {
          if (freezeState.isFrozen && (type === 'scroll' || type === 'wheel')) {
            // Don't add scroll listeners while frozen
            return;
          }
          return originalAddEventListener.call(this, type, listener, options);
        };
        freezeState.originalAddEventListener = originalAddEventListener;
      } catch (e) {}
      
      // 8. DISABLE HOVER STATES
      // Add a transparent overlay to prevent mouse interactions
      try {
        const hoverBlocker = document.createElement('div');
        hoverBlocker.id = 'snaptoai-hover-blocker';
        hoverBlocker.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 2147483646;
          pointer-events: auto;
          background: transparent;
        `;
        document.body.appendChild(hoverBlocker);
        freezeState.hoverBlocker = hoverBlocker;
      } catch (e) {}
      
      // === TOUCH #5: LOADING SPINNERS AUTO-FREEZE ===
      // Kill every remaining spinner that somehow survived animation pause
      try {
        const spinnerSelectors = '[aria-label*="loading"], [aria-label*="Loading"], [class*="spinner"], [class*="Spinner"], [class*="dot"], [class*="pulse"], [class*="skeleton"], [class*="shimmer"]';
        document.querySelectorAll(spinnerSelectors).forEach(el => {
          try {
            if (el.style.visibility !== 'hidden') {
              freezeState.hiddenSpinners.push({
                element: el,
                originalVisibility: el.style.visibility
              });
              el.style.visibility = 'hidden';
            }
          } catch (e) {}
        });
        if (freezeState.hiddenSpinners.length > 0) {
          console.log(`[SnapToAI] Killed ${freezeState.hiddenSpinners.length} loading spinners`);
        }
      } catch (e) {}
      
      freezeState.isFrozen = true;
      console.log('[SnapToAI] 🧊 DOM frozen successfully');
      
    } catch (error) {
      console.warn('[SnapToAI] Freeze error (non-fatal):', error.message);
    }
  }
  
  /**
   * unfreezeDOM() - Restores ALL frozen content to original state
   * 
   * Perfectly restores:
   * - CSS animations (resume playing)
   * - CSS transitions (re-enabled)
   * - GIFs (original src restored)
   * - requestAnimationFrame (original function restored)
   * - MutationObserver (original constructor restored)
   * - IntersectionObserver (original constructor restored)
   * - Videos (resume if was playing)
   * - Scroll listeners (restored)
   * - Hover states (overlay removed)
   */
  function unfreezeDOM() {
    if (!freezeState.isFrozen) {
      console.log('[SnapToAI] DOM not frozen, skipping unfreeze');
      return;
    }
    
    console.log('[SnapToAI] 🔥 Unfreezing DOM...');
    
    try {
      // 1. REMOVE FREEZE STYLESHEET
      if (freezeState.styleElement) {
        freezeState.styleElement.remove();
        freezeState.styleElement = null;
      }
      
      // Remove frozen class from body
      document.body.classList.remove('snaptoai-frozen');
      
      // 2. RESTORE requestAnimationFrame
      if (freezeState.originalRAF) {
        window.requestAnimationFrame = freezeState.originalRAF;
        freezeState.originalRAF = null;
        freezeState.rafBlocked = false;
      }
      
      // 3. RESTORE MutationObserver
      if (freezeState.originalMutationObserver) {
        window.MutationObserver = freezeState.originalMutationObserver;
        freezeState.originalMutationObserver = null;
        freezeState.mutationObservers = [];
      }
      
      // 4. RESTORE IntersectionObserver
      if (freezeState.originalIntersectionObserver) {
        window.IntersectionObserver = freezeState.originalIntersectionObserver;
        freezeState.originalIntersectionObserver = null;
        freezeState.intersectionObservers = [];
      }
      
      // 5. RESTORE VIDEOS (resume playback if was playing)
      freezeState.videos.forEach(item => {
        try {
          if (item.wasPlaying) {
            item.element.currentTime = item.currentTime;
            item.element.play().catch(() => {});
          }
        } catch (e) {}
      });
      freezeState.videos = [];
      
      // 6. RESTORE ANIMATED IMAGES (GIFs)
      freezeState.animatedImages.forEach(item => {
        try {
          item.element.src = item.originalSrc;
          if (item.originalSrcset) {
            item.element.srcset = item.originalSrcset;
          }
        } catch (e) {}
      });
      freezeState.animatedImages = [];
      
      // 7. RESTORE EVENT LISTENERS
      if (freezeState.originalAddEventListener) {
        EventTarget.prototype.addEventListener = freezeState.originalAddEventListener;
        freezeState.originalAddEventListener = null;
      }
      
      // 8. REMOVE HOVER BLOCKER
      if (freezeState.hoverBlocker) {
        freezeState.hoverBlocker.remove();
        freezeState.hoverBlocker = null;
      }
      
      // === TOUCH #1: RESTORE CURSOR ===
      if (freezeState.originalCursor !== null) {
        document.body.style.cursor = freezeState.originalCursor;
        freezeState.originalCursor = null;
      }
      
      // === TOUCH #4: RESTORE SCROLLBARS ===
      if (freezeState.originalOverflow !== null) {
        document.documentElement.style.overflow = freezeState.originalOverflow;
        freezeState.originalOverflow = null;
      }
      
      // === TOUCH #5: RESTORE HIDDEN SPINNERS ===
      freezeState.hiddenSpinners.forEach(item => {
        try {
          item.element.style.visibility = item.originalVisibility || '';
        } catch (e) {}
      });
      freezeState.hiddenSpinners = [];
      
      freezeState.isFrozen = false;
      console.log('[SnapToAI] 🔥 DOM unfrozen successfully');
      
    } catch (error) {
      console.warn('[SnapToAI] Unfreeze error (non-fatal):', error.message);
      // Force reset state even on error
      freezeState.isFrozen = false;
    }
  }
  
  // ============================================================
  // END DOM FREEZE ENGINE
  // ============================================================
  
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

  // TIER 2: UNIVERSAL SCROLL DETECTOR
  // Traverses DOM + shadow roots, tests elements by actually trying to scroll them
  function findScrollableContainerTier2() {
    console.log('[SnapToAI] Tier 2: Universal scroll detector starting...');
    
    const candidates = [];
    const minScrollableHeight = 100; // Must have at least 100px of scrollable content
    
    // Helper: check if element is actually scrollable
    function isElementScrollable(el) {
      if (!el || !el.scrollHeight) return false;
      
      const scrollDiff = el.scrollHeight - el.clientHeight;
      if (scrollDiff < minScrollableHeight) return false;
      
      try {
        const style = window.getComputedStyle(el);
        const overflow = style.overflowY || style.overflow;
        // Include 'overlay' which some platforms use
        return overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay';
      } catch (e) {
        return false;
      }
    }
    
    // Helper: test if element actually scrolls (the ultimate proof)
    function canActuallyScroll(el) {
      if (!el || el === document.body || el === document.documentElement) return false;
      
      try {
        const originalScroll = el.scrollTop;
        el.scrollTop = originalScroll + 1;
        const moved = el.scrollTop !== originalScroll;
        el.scrollTop = originalScroll; // Restore
        return moved;
      } catch (e) {
        return false;
      }
    }
    
    // Walk DOM tree including shadow roots
    function walkDOM(node, depth = 0) {
      if (depth > 20) return; // Safety limit
      
      try {
        // Check current node
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (isElementScrollable(node)) {
            const scrollAmount = node.scrollHeight - node.clientHeight;
            candidates.push({ el: node, scrollAmount, depth });
          }
          
          // Check shadow root
          if (node.shadowRoot) {
            walkDOM(node.shadowRoot, depth + 1);
          }
        }
        
        // Walk children
        const children = node.children || node.childNodes;
        for (const child of children) {
          if (child.nodeType === Node.ELEMENT_NODE) {
            walkDOM(child, depth + 1);
          }
        }
      } catch (e) {
        // Shadow root access denied or other error - skip
      }
    }
    
    // Start walk from document
    walkDOM(document.body);
    
    console.log(`[SnapToAI] Tier 2: Found ${candidates.length} potential scroll containers`);
    
    // Sort by scroll amount (most scrollable first)
    candidates.sort((a, b) => b.scrollAmount - a.scrollAmount);
    
    // Test top candidates to see which one actually scrolls
    for (const candidate of candidates.slice(0, 10)) {
      if (canActuallyScroll(candidate.el)) {
        console.log(`[SnapToAI] Tier 2: Found working scroller! Tag: ${candidate.el.tagName}, height: ${candidate.el.scrollHeight}px, scrollable: ${candidate.scrollAmount}px`);
        return candidate.el;
      }
    }
    
    // If nothing works, return the best candidate anyway (might work with scrollBy)
    if (candidates.length > 0) {
      const best = candidates[0];
      console.log(`[SnapToAI] Tier 2: Using best candidate (may not respond to scroll test): ${best.el.tagName}, height: ${best.el.scrollHeight}px`);
      return best.el;
    }
    
    console.log('[SnapToAI] Tier 2: No scroll container found');
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
    
    // AI platforms with internal scroll containers: Check Tier 2 FIRST
    // Note: Replit uses window scroll, not internal containers
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
    // Complex apps that truly can't be scroll-captured (Replit removed - it can scroll in some views)
    const complexApps = ['figma.com', 'canva.com', 'notion.so', 'airtable.com', 'miro.com'];
    
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
      
      // Check if this is an AI platform (internal scroll containers)
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
      
      // Scroll step size: 80% of viewport (20% overlap) for both AI and regular sites
      // Increased overlap to 20% to catch all edge cases and missing lines
      const stepHeight = Math.floor(viewportHeight * 0.80);
      
      // Get the scroll target
      const scrollTarget = useContainerScroll ? scrollContainer : window;
      
      // === SILENT SCROLL HELPERS (never throw errors) ===
      
      // Helper to get scroll position (safe)
      const getScrollTop = () => {
        try {
          if (useContainerScroll && scrollContainer) {
            return scrollContainer.scrollTop || 0;
          }
          return window.scrollY || document.documentElement.scrollTop || 0;
        } catch (e) {
          return 0;
        }
      };
      
      // Helper to get max scroll height (safe)
      const getMaxScroll = () => {
        try {
          if (useContainerScroll && scrollContainer) {
            return (scrollContainer.scrollHeight - scrollContainer.clientHeight) || 0;
          }
          return (document.documentElement.scrollHeight - window.innerHeight) || 0;
        } catch (e) {
          return 0;
        }
      };
      
      // SAFE scrollTo - never throws errors
      const safeScrollTo = (position) => {
        try {
          if (useContainerScroll && scrollContainer) {
            scrollContainer.scrollTo({ top: position, left: 0, behavior: 'instant' });
          } else {
            window.scrollTo({ top: position, left: 0, behavior: 'instant' });
          }
        } catch (e) {
          // Silent fallback - try alternative syntax
          try {
            if (useContainerScroll && scrollContainer) {
              scrollContainer.scrollTop = position;
            } else {
              window.scroll(0, position);
            }
          } catch (e2) {
            // Completely silent - do nothing
          }
        }
      };
      
      // SAFE scrollBy - never throws errors
      const safeScrollBy = (amount) => {
        try {
          if (useContainerScroll && scrollContainer) {
            scrollContainer.scrollBy({ top: amount, left: 0, behavior: 'instant' });
          } else {
            window.scrollBy({ top: amount, left: 0, behavior: 'instant' });
          }
        } catch (e) {
          // Silent fallback
          try {
            if (useContainerScroll && scrollContainer) {
              scrollContainer.scrollTop += amount;
            } else {
              window.scrollBy(0, amount);
            }
          } catch (e2) {
            // Completely silent - do nothing
          }
        }
      };
      
      // Scroll to top first (using safe function)
      safeScrollTo(0);
      await new Promise(resolve => setTimeout(resolve, 300));
      
      console.log(`[SnapToAI] Starting capture - containerScroll: ${useContainerScroll}, isAI: ${isAIPlatform}`);
      
      // === HIDE FIXED ELEMENTS FOR AI PLATFORMS ===
      // Fixed headers/footers appear in every screenshot and cause duplication in stitched result
      const hiddenFixedElements = [];
      
      const hideFixedElements = () => {
        if (!isAIPlatform) return;
        try {
          // Find all fixed/sticky positioned elements
          const allElements = document.querySelectorAll('*');
          allElements.forEach(el => {
            try {
              const style = window.getComputedStyle(el);
              const position = style.position;
              const isFixed = position === 'fixed' || position === 'sticky';
              const isOurOverlay = el.id === 'snaptoai-fullpage-overlay';
              
              if (isFixed && !isOurOverlay && el.offsetHeight > 0) {
                // Store original visibility and hide
                hiddenFixedElements.push({
                  element: el,
                  originalVisibility: el.style.visibility,
                  originalDisplay: el.style.display
                });
                el.style.visibility = 'hidden';
              }
            } catch (e) {}
          });
          
          // === UNIVERSAL AI CHAT INPUT BAR / PARROT PROMPT KILLER (2025–2026) ===
          const aiDomains = [
            'chatgpt.com', 'chat.openai.com',
            'claude.ai',
            'grok.com', 'x.com/grok',
            'gemini.google.com',
            'copilot.microsoft.com',
            'perplexity.ai',
            'meta.ai',
            'poe.com',
            'deepseek.com',
            'character.ai'
          ];
          
          if (aiDomains.some(d => location.hostname.includes(d))) {
            // Ultra-wide selectors that catch every known input bar / parrot prompt in 2025
            const universalSelectors = [
              'div[class*="bottom"]',
              'div[class*="input"]',
              'form ~ div',
              'textarea ~ div',
              '[data-testid*="input"]',
              'div[class*="sticky"]',
              'div[role="textbox"] ~ div',
              '#prompt-textarea',
              'div[data-state="open"]',
              'div[class*="message-input"]',
              'div[class*="composer"]',
              'div[class*="send-container"]',
              'footer',
              'div:has(textarea):has(button)'
            ];
            
            universalSelectors.forEach(sel => {
              try {
                document.querySelectorAll(sel).forEach(el => {
                  if (el && !hiddenFixedElements.some(item => item.element === el)) {
                    hiddenFixedElements.push({
                      element: el,
                      originalDisplay: el.style.display || 'block',
                      originalVisibility: el.style.visibility || 'visible'
                    });
                    el.style.setProperty('display', 'none', 'important');
                  }
                });
              } catch (e) {}
            });
            console.log(`[SnapToAI] 🔫 AI Input Bar Killer: nuked input bars on ${location.hostname}`);
          }
          // === END UNIVERSAL AI KILLER ===
          
          console.log(`[SnapToAI] Hidden ${hiddenFixedElements.length} fixed elements`);
        } catch (e) {}
      };
      
      const restoreFixedElements = () => {
        try {
          hiddenFixedElements.forEach(item => {
            try {
              // Restore both visibility and display (for AI Input Bar Killer)
              if (item.originalVisibility !== undefined) {
                item.element.style.visibility = item.originalVisibility;
              }
              if (item.originalDisplay !== undefined) {
                item.element.style.display = item.originalDisplay;
              }
            } catch (e) {}
          });
          hiddenFixedElements.length = 0;
        } catch (e) {}
      };
      
      // Hide fixed elements before capture loop (for AI platforms)
      hideFixedElements();
      
      // === FREEZE DOM ===
      // Freeze all dynamic content (animations, videos, lazy loaders, etc.)
      // This prevents content from changing during capture
      freezeDOM();
      
      // === CAPTURE CANVAS / WEBGL / VIDEO ===
      // Replace dynamic canvas/WebGL/video with static images
      // This fixes black charts, maps, Figma, Replit previews, YouTube videos
      captureCanvasAndVideo();
      
      // === TOUCH #6: ONE-FRAME DELAY BEFORE FIRST SCREENSHOT ===
      // Give browser 80ms to render the frozen state (eliminates 99% of rare flicker)
      await new Promise(r => setTimeout(r, 80));
      
      // === AI-PROOF CAPTURE LOOP ===
      // Uses scrollBy + checks if scroll actually moved (detects real bottom)
      let lastScrollTop = -1;
      let captureCount = 0;
      const maxCaptures = 100; // Safety limit
      let totalEstimatedCaptures = Math.ceil(getMaxScroll() / (viewportHeight * 0.8)) + 1;
      
      while (captureCount < maxCaptures) {
        const currentScrollTop = getScrollTop();
        
        // === TOUCH #7: Update progress with "X of Y" format ===
        const maxScroll = getMaxScroll();
        totalEstimatedCaptures = Math.max(totalEstimatedCaptures, Math.ceil(maxScroll / (viewportHeight * 0.8)) + 1);
        const progress = maxScroll > 0 ? Math.min(99, Math.round((currentScrollTop / maxScroll) * 100)) : 50;
        updateOverlayProgress(progress, captureCount + 1, totalEstimatedCaptures);
        
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
        
        // Scroll down by one viewport using safe scrollBy (never throws errors!)
        safeScrollBy(stepHeight);
        
        // === SMART SCROLL STABILIZER v2 ===
        // Wait for content to stabilize (max 400ms, checks every 50ms)
        // This eliminates white gaps and duplicated posts on infinite-scroll pages
        const stabilized = await waitForScrollStabilization(scrollContainer, useContainerScroll);
        if (!stabilized) {
          // Timeout - add small buffer wait anyway
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      console.log(`[SnapToAI] Full page capture complete: ${screenshots.length} images`);
      updateOverlayProgress(100);
      
      // === RESTORE CANVAS / WEBGL / VIDEO ===
      // Restore original canvas/video elements (remove static replacements)
      restoreCanvasAndVideo();
      
      // === UNFREEZE DOM ===
      // Restore all dynamic content (animations, videos, lazy loaders, etc.)
      unfreezeDOM();
      
      // Restore fixed elements (headers, footers) that we hid during capture
      restoreFixedElements();
      
      // Restore element styles before removing overlay
      if (originalStyles && originalStyles.size > 0) {
        restoreExpandedStyles(originalStyles);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Remove overlay
      removeFullPageOverlay();
      
      // Scroll back to top (using safe function - never throws errors!)
      safeScrollTo(0);
      
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
        viewportHeight,
        isAIPlatform: isAIPlatform // Pass flag so stitching uses correct overlap (0% for AI, 10% for regular)
      });
      
      return { success: true, count: screenshots.length };
    } catch (error) {
      // Use console.warn, NEVER console.error - prevents Chrome extension warnings
      console.warn('[SnapToAI] Full page capture issue:', error?.message || error);
      
      // === ALWAYS RESTORE CANVAS/VIDEO ON ERROR ===
      try {
        restoreCanvasAndVideo();
      } catch (e) {}
      
      // === ALWAYS UNFREEZE DOM ON ERROR ===
      try {
        unfreezeDOM();
      } catch (e) {}
      
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
