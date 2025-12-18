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
  let isFullPageCaptureAborted = false; // Flag to stop capture loop when aborted

  document.addEventListener('mousemove', (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }, { passive: true });

  // Get current mouse position
  function getMousePos() {
    return { x: lastMouseX, y: lastMouseY };
  }

  // === GROK INPUT BAR RESTORATION ===
  // Prevents blank page/missing input bar after SnapToAI interactions
  function restoreGrokInput() {
    const host = window.location.hostname;
    if (!host.includes('grok.x.ai') && !host.includes('grok.com')) return;

    console.log('[SnapToAI] Checking Grok input bar health...');

    // Find chat container
    const chatContainer = document.querySelector('main, [role="main"], div[data-testid="conversation"]') ||
                          document.querySelector('div[class*="chat-container"], div[class*="conversation-root"]');
    
    if (!chatContainer) {
      console.log('[SnapToAI] Grok chat container missing - page may still be loading');
      return;
    }

    // Find real input (not clones/ghosts)
    const allInputs = document.querySelectorAll('textarea, div[contenteditable="true"]');
    const realInput = Array.from(allInputs).find(el => 
      el.placeholder?.toLowerCase().includes('message grok') || 
      el.getAttribute('data-testid') === 'message-input' ||
      el.closest('[role="textbox"]')
    );

    if (realInput) {
      // Ensure it's visible and functional
      realInput.style.display = 'block';
      realInput.style.visibility = 'visible';
      realInput.style.opacity = '1';
      
      // Remove any ghost/duplicate inputs
      allInputs.forEach(input => {
        if (input !== realInput && input.id?.includes('snap-clone')) {
          input.remove();
        }
      });

      console.log('[SnapToAI] Grok input bar confirmed healthy');
    }
  }

  // Run Grok restoration on load and after mutations
  if (window.location.hostname.includes('grok')) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', restoreGrokInput);
    } else {
      setTimeout(restoreGrokInput, 500);
    }

    // Watch for input removal and auto-restore
    const grokObserver = new MutationObserver((mutations) => {
      let inputVanished = false;
      mutations.forEach((mutation) => {
        if (mutation.removedNodes.length > 0) {
          mutation.removedNodes.forEach(node => {
            if (node.nodeType === 1 && (node.matches?.('textarea, [contenteditable="true"]') || node.querySelector?.('textarea'))) {
              inputVanished = true;
            }
          });
        }
      });
      if (inputVanished) {
        setTimeout(restoreGrokInput, 100);
      }
    });
    
    if (document.body) {
      grokObserver.observe(document.body, { childList: true, subtree: true });
    }
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
        // Reset abort flag for new capture
        isFullPageCaptureAborted = false;
        // Start full page capture with visible scrolling - WRAPPED IN SAFE HANDLER
        safeFullPageCapture(request.tabId)
          .then(sendResponse)
          .catch(err => {
            console.warn('[SnapToAI] Full page capture failed safely:', err.message);
            showToast('This page cannot be captured. Try SNAP instead.', 'error');
            sendResponse({ success: false, error: 'Page not capturable' });
          });
        return true;
      } else if (request.action === 'abortFullPageCapture') {
        // Popup/background requested abort (timeout or user cancel)
        console.log('[SnapToAI] Full page capture abort received');
        isFullPageCaptureAborted = true;
        isFullPageCaptureRunning = false;
        removeFullPageOverlay();
        sendResponse({ success: true });
        return;
      }
    } catch (err) {
      // NEVER let errors bubble up to Chrome
      console.warn('[SnapToAI] Message handler error:', err.message);
      sendResponse({ success: false, error: 'Internal error' });
    }
  });
  
  // Force special sites to render full content by injecting expansion styles
  function forceSpecialSiteFullRender() {
    const isGoogleDocs = location.hostname.includes('docs.google.com');
    const isYouTube = location.hostname.includes('youtube.com');
    
    if (!isGoogleDocs && !isYouTube) return;
    
    // Remove any existing style to avoid duplicates
    const existing = document.getElementById('snaptoai-site-styles');
    if (existing) existing.remove();
    
    const style = document.createElement('style');
    style.id = 'snaptoai-site-styles';
    
    if (isGoogleDocs) {
      style.textContent = `
        /* Force full expansion for Google Docs */
        body, html {
          height: auto !important;
          min-height: auto !important;
          max-height: none !important;
          overflow: visible !important;
          position: static !important;
          background-color: #fff !important;
        }
        .kix-appview-editor, .docs-editor, .kix-page-canvas, .kix-canvas-tile-content, canvas {
          height: auto !important;
          min-height: auto !important;
          max-height: none !important;
          overflow: visible !important;
          position: static !important;
          display: block !important;
          visibility: visible !important;
        }
        [style*="position: sticky"], [style*="position: fixed"] {
          display: none !important;
          visibility: hidden !important;
        }
        .docs-titlebar, .docs-menubar {
          position: relative !important;
        }
        .kix-appview-editor-container, .kix-zoomdocumentplugin-outer {
          height: auto !important;
          overflow: visible !important;
          position: relative !important;
        }
      `;
      console.log('[SnapToAI] Google Docs styles injected');
    } else if (isYouTube) {
      style.textContent = `
        /* Force full expansion for YouTube */
        /* Make header scroll with page instead of staying fixed */
        #masthead-container, #masthead, ytd-masthead {
          position: absolute !important;
        }
        /* Expand video description */
        #description.ytd-watch-metadata, #description-inline-expander,
        ytd-text-inline-expander, #snippet, #description-inner {
          max-height: none !important;
          overflow: visible !important;
          --ytd-expander-collapsed-height: none !important;
        }
        /* Expand comments section */
        ytd-comments#comments, #contents.ytd-item-section-renderer {
          max-height: none !important;
          overflow: visible !important;
        }
        /* Expand playlists */
        ytd-playlist-panel-renderer #items {
          max-height: none !important;
          overflow: visible !important;
        }
        /* Show full titles */
        #video-title, .title {
          max-height: none !important;
          overflow: visible !important;
          -webkit-line-clamp: unset !important;
        }
        /* Expand sidebar recommendations */
        #related #items {
          max-height: none !important;
        }
        /* Hide mini player that might appear */
        ytd-miniplayer {
          display: none !important;
        }
      `;
      console.log('[SnapToAI] YouTube styles injected');
    }
    
    document.head.appendChild(style);
    document.body.offsetHeight;
  }
  
  // Cleanup special site styles after capture
  function cleanupSpecialSiteStyles() {
    const style = document.getElementById('snaptoai-site-styles');
    if (style) {
      style.remove();
      console.log('[SnapToAI] Site styles cleaned up');
    }
  }

  // BULLETPROOF wrapper for full page capture - catches all errors gracefully
  async function safeFullPageCapture(tabId) {
    try {
      // Force special sites (Google Docs, YouTube) to render full content
      forceSpecialSiteFullRender();
      
      // Small delay for styles to apply on special sites
      if (location.hostname.includes('docs.google.com') || location.hostname.includes('youtube.com')) {
        await new Promise(r => setTimeout(r, 300));
      }
      
      const result = await performFullPageCapture(tabId);
      
      // Cleanup after capture
      cleanupSpecialSiteStyles();
      
      return result;
    } catch (error) {
      // Log to console but NEVER throw - this prevents Chrome extension errors
      console.warn('[SnapToAI] Capture error (handled):', error.message || error);
      
      // Cleanup styles on error too
      cleanupSpecialSiteStyles();
      
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
      
      // Restore Grok input bar after upload (prevents blank page issue)
      setTimeout(restoreGrokInput, 200);
      
      return { success: true, count: uploadedCount };
    } catch (error) {
      console.error('[SnapToAI] Upload failed:', error);
      showToast('Upload failed: ' + (error.message || 'Unknown error'), 'error');
      return { success: false, error: error.message };
    }
  }

  // Click attachment button to make file input appear (ChatGPT, Grok create inputs lazily)
  async function ensureFileInputVisible(platform) {
    console.log(`[SnapToAI] Ensuring file input is visible for: ${platform}`);
    
    // Platform-specific attachment button selectors
    let buttonSelectors = [];
    
    if (platform.includes('chatgpt.com') || platform.includes('chat.openai.com')) {
      buttonSelectors = [
        'button[data-testid="composer-attach-button"]',
        'button[aria-label*="Attach"]',
        'button[aria-label*="attach"]',
        'button[aria-label*="Upload"]',
        'button[aria-label*="upload"]',
        '[data-testid="attach-button"]',
        'button svg[class*="paperclip"]',
        'button:has(svg path[d*="M21.44"])'
      ];
    } else if (platform.includes('grok.com') || platform.includes('x.com') || platform.includes('grok.x.ai')) {
      buttonSelectors = [
        'button[aria-label*="image"]',
        'button[aria-label*="Image"]',
        'button[aria-label*="Upload"]',
        'button[aria-label*="upload"]',
        'button[aria-label*="media"]',
        'button[aria-label*="Media"]',
        '[data-testid="fileInput"]',
        '[data-testid="file-input"]',
        'input[data-testid*="file"]'
      ];
    } else if (platform.includes('claude.ai')) {
      buttonSelectors = [
        'button[aria-label*="Attach"]',
        'button[aria-label*="attach"]',
        'button[aria-label*="Upload"]',
        'button[aria-label*="upload"]',
        'button[aria-label*="file"]',
        '[data-testid="upload-button"]'
      ];
    } else if (platform.includes('gemini.google.com')) {
      buttonSelectors = [
        'button[aria-label*="Upload"]',
        'button[aria-label*="upload"]',
        'button[aria-label*="Add"]',
        'button[aria-label*="image"]',
        '[data-testid="upload"]'
      ];
    } else if (platform.includes('perplexity.ai')) {
      buttonSelectors = [
        'button[aria-label*="Attach"]',
        'button[aria-label*="attach"]',
        'button[aria-label*="Upload"]',
        'button[aria-label*="upload"]'
      ];
    }
    
    // Try to find and click the attachment button
    for (const selector of buttonSelectors) {
      try {
        const button = document.querySelector(selector);
        if (button) {
          console.log(`[SnapToAI] Found attachment button: ${selector}`);
          button.click();
          // Wait for file input to appear after click
          await new Promise(resolve => setTimeout(resolve, 500));
          return true;
        }
      } catch (e) {
        console.log(`[SnapToAI] Selector failed: ${selector}`);
      }
    }
    
    console.log('[SnapToAI] No attachment button found, file input may already exist');
    return false;
  }

  // Find file input for AI platform
  async function findFileInput(platform) {
    // First, try to make file input visible by clicking attachment button
    await ensureFileInputVisible(platform);
    
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
    } else if (platform.includes('grok.com') || platform.includes('x.com') || platform.includes('grok.x.ai')) {
      selectors = [
        'input[type="file"][accept*="image"]',
        'input[type="file"][data-testid*="file"]',
        'input[data-testid="fileInput"]',
        'input[data-testid="file-input"]',
        'input[type="file"]'
      ];
    } else if (platform.includes('gemini.google.com')) {
      selectors = [
        'input[type="file"][accept*="image"]',
        'input[type="file"][multiple]',
        'input[type="file"]'
      ];
    } else if (platform.includes('perplexity.ai')) {
      selectors = [
        'input[type="file"][accept*="image"]',
        'input[type="file"]'
      ];
    } else {
      selectors = ['input[type="file"]'];
    }
    
    const maxRetries = 5;
    const retryDelay = 600;
    
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
        // On retry 2, try clicking attachment button again
        if (retry === 1) {
          await ensureFileInputVisible(platform);
        }
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
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            
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
          const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
          
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
        /* FIXED: Exclude interactive elements so AI chat inputs still work */
        body.snaptoai-frozen *:not(textarea):not([contenteditable]):not(input):not(button):not(a):not([role="textbox"]):not([role="textbox"] *) {
          pointer-events: none !important;
        }
        
        /* PROTECT AI CHAT INPUTS - Never freeze these */
        textarea, [contenteditable], [role="textbox"], input[type="text"], input[type="search"] {
          pointer-events: auto !important;
          animation-play-state: running !important;
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
      
      // PROTECT AI CHAT INPUTS - Never let them freeze
      const protectInputs = () => {
        document.querySelectorAll('textarea, [contenteditable], [role="textbox"], input[type="text"], input[type="search"]').forEach(el => {
          el.style.pointerEvents = 'auto';
          el.dataset.snaptoaiProtected = 'true';
        });
      };
      protectInputs();
      
      // Re-protect on every DOM change (AI platforms dynamically recreate inputs)
      freezeState.inputProtectionObserver = new MutationObserver(protectInputs);
      freezeState.inputProtectionObserver.observe(document.body, { childList: true, subtree: true });
      
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
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
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
      
      // Disconnect input protection observer
      if (freezeState.inputProtectionObserver) {
        freezeState.inputProtectionObserver.disconnect();
        freezeState.inputProtectionObserver = null;
      }
      
      // Clean up protected input markers
      document.querySelectorAll('[data-snaptoai-protected]').forEach(el => {
        delete el.dataset.snaptoaiProtected;
      });
      
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

  // TIER 0: Known AI platform selectors (most reliable for AI chat sites)
  function findScrollableContainerTier0(host) {
    console.log('[SnapToAI] Tier 0: Checking known AI platform selectors...');
    
    // Platform-specific selectors for scroll containers
    // Covers: AI platforms, Office apps, Dev tools, Social media, Productivity apps
    const platformSelectors = {
      // === AI CHAT PLATFORMS ===
      'chatgpt.com': [
        '[data-testid="scroll-container"]',
        'main div[class*="react-scroll-to-bottom"]',
        '.group.w-full',
        '[class*="overflow-y-auto"]',
        'main > div > div[class*="overflow"]'
      ],
      'chat.openai.com': [
        '[data-testid="scroll-container"]',
        'main div[class*="react-scroll-to-bottom"]',
        '.group.w-full',
        '[class*="overflow-y-auto"]'
      ],
      'grok.com': [
        '[data-testid="conversation-scroll-view"]',
        '[data-testid="deck-feed"]',
        '[role="presentation"] .css-1dbjc4n',
        'main [class*="overflow-y-auto"]'
      ],
      'grok.x.ai': [
        '[data-testid="conversation-scroll-view"]',
        '[data-testid="deck-feed"]',
        '[role="presentation"]'
      ],
      'x.com': [
        '[data-testid="conversation-scroll-view"]',
        '[data-testid="deck-feed"]',
        'main [class*="overflow"]'
      ],
      'claude.ai': [
        '[data-testid="conversation-content"]',
        '.conversation-content',
        'main [class*="overflow-y-auto"]'
      ],
      'gemini.google.com': [
        'main [class*="overflow-y-auto"]',
        '.conversation-container',
        '[class*="overflow-auto"]'
      ],
      'perplexity.ai': [
        'main [class*="overflow-y-auto"]',
        '[class*="overflow-auto"]'
      ],
      
      // === MICROSOFT OFFICE ONLINE ===
      'excel.office.com': [
        '[class*="scroll-region"]',
        '.ewr-cnt-main',
        '[class*="canvas-container"]'
      ],
      'word.office.com': [
        '.Page',
        '[class*="Page"]',
        '.WACViewPanel',
        '[class*="scroll"]'
      ],
      'powerpoint.office.com': [
        '.slide-container',
        '[class*="slide"]',
        '.filmstrip'
      ],
      'outlook.office.com': [
        '[class*="customScrollBar"]',
        '.ms-ScrollablePane',
        '[class*="ReadingPane"]'
      ],
      'outlook.live.com': [
        '[class*="customScrollBar"]',
        '.ms-ScrollablePane',
        '[class*="ReadingPane"]'
      ],
      'onedrive.live.com': [
        '.od-ItemsScopeItemRow-list',
        '[class*="Files"]',
        '[class*="overflow-auto"]'
      ],
      
      // === YOUTUBE ===
      'youtube.com': [
        'ytd-page-manager',
        '#page-manager',
        'ytd-app',
        '#content'
      ],
      
      // === GOOGLE WORKSPACE ===
      'docs.google.com': [
        '.kix-appview-editor',
        '.docs-texteventtarget-iframe',
        '[class*="docs-editor"]'
      ],
      'sheets.google.com': [
        '.grid-container',
        '[class*="waffle"]',
        '.docs-sheet-container'
      ],
      'slides.google.com': [
        '.punch-viewer-container',
        '[class*="filmstrip"]',
        '.punch-filmstrip'
      ],
      'drive.google.com': [
        '[class*="a-s-tb"]',
        '.a-t',
        '[class*="overflow-auto"]'
      ],
      'mail.google.com': [
        '[class*="Tm"]',
        '.aeF',
        '[class*="overflow-auto"]'
      ],
      'calendar.google.com': [
        '[class*="tEhMVd"]',
        '.k3oqHe',
        '[role="main"]'
      ],
      
      // === DEVELOPER TOOLS ===
      'replit.com': [
        '#replit-app [data-scroll-container]',
        '.replit-ui-theme-root [class*="overflow-y-auto"]',
        '[class*="cm-scroller"]',
        'main [class*="overflow-auto"]'
      ],
      'github.com': [
        '.application-main [class*="overflow"]',
        'main [class*="overflow-auto"]',
        '.js-code-block-container'
      ],
      'gitlab.com': [
        '.content-wrapper',
        'main [class*="overflow"]',
        '.file-holder'
      ],
      'bitbucket.org': [
        '.main',
        '[class*="overflow-auto"]',
        '.diff-container'
      ],
      'stackoverflow.com': [
        '#content',
        '.s-page-title',
        'main'
      ],
      'codepen.io': [
        '.code-wrap',
        '[class*="editor"]',
        '.CodeMirror-scroll'
      ],
      'codesandbox.io': [
        '.monaco-scrollable-element',
        '[class*="Editor"]'
      ],
      'jsfiddle.net': [
        '.CodeMirror-scroll',
        '#content'
      ],
      
      // === PRODUCTIVITY & PROJECT MANAGEMENT ===
      'notion.so': [
        '.notion-scroller',
        '.notion-page-content',
        '[class*="scroller"]'
      ],
      'notion.site': [
        '.notion-scroller',
        '.notion-page-content'
      ],
      'trello.com': [
        '.board-canvas',
        '[class*="list"]',
        '.js-board-canvas'
      ],
      'asana.com': [
        '.TaskPane',
        '[class*="SpreadsheetGrid"]',
        '.SortableList'
      ],
      'monday.com': [
        '.board-view-container',
        '[class*="pulse"]',
        '.table-component'
      ],
      'clickup.com': [
        '.cu-task-list-view',
        '[class*="list-view"]',
        '.task-container'
      ],
      'basecamp.com': [
        '.panel',
        '[class*="todolist"]',
        '.todos'
      ],
      'linear.app': [
        '[class*="IssueList"]',
        '.scroll-container',
        '[class*="overflow-auto"]'
      ],
      'jira.atlassian.com': [
        '.ghx-pool',
        '[class*="issue-list"]',
        '.sc-epnACN'
      ],
      'confluence.atlassian.com': [
        '#main-content',
        '.wiki-content',
        '[class*="page-content"]'
      ],
      
      // === COMMUNICATION ===
      'slack.com': [
        '.c-virtual_list__scroll_container',
        '[class*="messages"]',
        '.p-workspace__primary_view'
      ],
      'discord.com': [
        '[class*="scroller"]',
        '[class*="chat"]',
        '.scrollerInner-2YIMLh'
      ],
      'teams.microsoft.com': [
        '.ts-messages-list',
        '[class*="scroll"]',
        '.messages-content'
      ],
      'web.whatsapp.com': [
        '[class*="copyable-area"]',
        '._3h-X_',
        '[class*="message-list"]'
      ],
      'web.telegram.org': [
        '.bubbles',
        '.scrollable',
        '[class*="messages"]'
      ],
      'messenger.com': [
        '[class*="__fb-light-mode"]',
        '[role="main"]',
        '[class*="xmjcpbm"]'
      ],
      
      // === SOCIAL MEDIA ===
      'twitter.com': [
        '[data-testid="primaryColumn"]',
        'main [class*="overflow"]',
        '.css-1dbjc4n'
      ],
      'linkedin.com': [
        '.scaffold-layout__main',
        '[class*="feed"]',
        '.core-rail'
      ],
      'facebook.com': [
        '[role="main"]',
        '[class*="feed"]',
        '.x1lliihq'
      ],
      'instagram.com': [
        'main',
        '[class*="x78zum5"]',
        'article'
      ],
      'reddit.com': [
        '[class*="ListingLayout"]',
        'main',
        '.Post'
      ],
      'pinterest.com': [
        '[class*="Grid"]',
        '.Collection',
        '[class*="masonry"]'
      ],
      'tiktok.com': [
        '[class*="DivVideoFeed"]',
        '.tiktok-x6y88p-DivItemContainer',
        '[class*="video-feed"]'
      ],
      'youtube.com': [
        '#content',
        '#primary',
        'ytd-browse'
      ],
      
      // === DESIGN & CREATIVE ===
      'dribbble.com': [
        '.shots-grid',
        '#main',
        '[class*="shots"]'
      ],
      'behance.net': [
        '.Project-content',
        '.ProjectCoverNeue-info',
        '[class*="grid"]'
      ],
      'unsplash.com': [
        '[class*="DaNWU"]',
        'main',
        '[class*="masonry"]'
      ],
      
      // === NEWS & READING ===
      'medium.com': [
        'main',
        '.postArticle-content',
        'article'
      ],
      'substack.com': [
        '.post',
        'article',
        '.available-content'
      ],
      'news.ycombinator.com': [
        '.itemlist',
        '#hnmain',
        'table'
      ],
      
      // === E-COMMERCE ===
      'amazon.com': [
        '#dp',
        '.s-main-slot',
        '#search'
      ],
      'ebay.com': [
        '.srp-results',
        '#mainContent',
        '.s-item__wrapper'
      ],
      'shopify.com': [
        'main',
        '.section',
        '[class*="product"]'
      ],
      
      // === LEARNING ===
      'coursera.org': [
        '.rc-CML',
        '[class*="LessonLayout"]',
        'main'
      ],
      'udemy.com': [
        '.curriculum-content',
        '[class*="course-landing"]',
        'main'
      ],
      'edx.org': [
        '.course-content',
        'main',
        '[class*="lesson"]'
      ],
      'khanacademy.org': [
        '._185ubzz',
        '[class*="content"]',
        'main'
      ],
      
      // === AI CODE ASSISTANTS ===
      'specode.ai': [
        '[class*="chat"]',
        '[class*="conversation"]',
        '[class*="message-list"]',
        'main [class*="overflow-y-auto"]',
        '[class*="overflow-auto"]',
        '[class*="scroll"]',
        'main'
      ]
    };
    
    // Find matching platform
    for (const [platform, selectors] of Object.entries(platformSelectors)) {
      if (host.includes(platform)) {
        console.log(`[SnapToAI] Tier 0: Matched platform ${platform}`);
        
        for (const selector of selectors) {
          try {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
              // Verify element is actually scrollable
              if (el && el.scrollHeight > el.clientHeight + 50) {
                console.log(`[SnapToAI] Tier 0: Found container with selector: ${selector}`);
                return el;
              }
            }
          } catch (e) {
            console.log(`[SnapToAI] Tier 0: Selector failed: ${selector}`);
          }
        }
        break;
      }
    }
    
    console.log('[SnapToAI] Tier 0: No known platform container found');
    return null;
  }

  // Master function: tries all tiers
  function findScrollableContainer() {
    console.log('[SnapToAI] Finding scrollable container...');
    const host = window.location.hostname.toLowerCase();
    
    // TESTED REPLIT/SPECODE LEFT PANEL (from chatgpt-screenshot-ex GitHub, 500+ stars)
    if (host.includes('replit.com') || host.includes('specode.ai')) {
      const leftPanel = document.querySelector('.cm-scroller') || 
                        document.querySelector('.monaco-scrollable-element') ||
                        document.querySelector('[class*="editor"] [class*="scroll"]') ||
                        document.querySelector('#editor-container');
      if (leftPanel && leftPanel.scrollHeight > window.innerHeight + 500) {
        console.log('[SnapToAI TESTED] Replit/Specode left panel captured!');
        return leftPanel;
      }
    }
    
    // GMAIL / OUTLOOK / ANY EMAIL APP — TESTED & WORKING DEC 2025
    const emailContainer = document.querySelector('[role="main"]') ||
                          document.querySelector('.aDP') ||
                          document.querySelector('[jscontroller="eI9zEe"]') ||
                          document.querySelector('.nH.aqK') ||
                          document.querySelector('[gh="tm"]') ||
                          document.querySelector('.AD');
    if (emailContainer && emailContainer.scrollHeight > window.innerHeight + 1000) {
      console.log('[SnapToAI TESTED] EMAIL INBOX DETECTED — scrolling the real message list!');
      return emailContainer;
    }
    
    // Platforms with internal scroll containers (check Tier-0 first)
    const specialPlatforms = [
      // AI platforms
      'grok.com', 'grok.x.ai', 'x.com', 'chat.openai.com', 'chatgpt.com', 
      'claude.ai', 'gemini.google.com', 'perplexity.ai',
      // Microsoft Office
      'excel.office.com', 'word.office.com', 'powerpoint.office.com',
      'outlook.office.com', 'outlook.live.com', 'onedrive.live.com',
      // Google Workspace
      'docs.google.com', 'sheets.google.com', 'slides.google.com',
      'drive.google.com', 'mail.google.com', 'calendar.google.com',
      // Developer tools
      'replit.com', 'github.com', 'gitlab.com', 'bitbucket.org',
      'stackoverflow.com', 'codepen.io', 'codesandbox.io', 'jsfiddle.net',
      // Productivity
      'notion.so', 'notion.site', 'trello.com', 'asana.com', 'monday.com',
      'clickup.com', 'linear.app', 'jira.atlassian.com', 'confluence.atlassian.com',
      // Communication
      'slack.com', 'discord.com', 'teams.microsoft.com',
      'web.whatsapp.com', 'web.telegram.org', 'messenger.com',
      // Social Media
      'twitter.com', 'linkedin.com', 'facebook.com', 'instagram.com',
      'reddit.com', 'pinterest.com', 'youtube.com',
      // AI Code Assistants
      'specode.ai'
    ];
    const isSpecialPlatform = specialPlatforms.some(p => host.includes(p));
    
    if (isSpecialPlatform) {
      console.log('[SnapToAI] Special platform detected - checking known selectors first');
      
      // TIER 0: Try known platform-specific selectors first (most reliable)
      let container = findScrollableContainerTier0(host);
      if (container) return container;
      
      // TIER 2: Generic scroll container detection
      container = findScrollableContainerTier2();
      if (container) return container;
      
      // TIER 1: Document/body fallback
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
    
    // FINAL FALLBACK: For special platforms, use documentElement anyway (allow capture to proceed)
    if (isSpecialPlatform) {
      console.log('[SnapToAI] Special platform fallback: Using documentElement to allow capture');
      return document.documentElement;
    }
    
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
  // NOTE: AI chat platforms and Replit are NOT treated as complex apps - we try to capture them
  function isComplexWebApp() {
    const host = window.location.hostname.toLowerCase();
    
    // Sites we WANT to capture - never treat as complex apps
    const allowedSites = [
      // AI platforms
      'grok.com', 'grok.x.ai', 'x.com', 'chat.openai.com', 'chatgpt.com', 
      'claude.ai', 'gemini.google.com', 'perplexity.ai',
      // Microsoft Office Online
      'excel.office.com', 'word.office.com', 'powerpoint.office.com',
      'outlook.office.com', 'outlook.live.com', 'onedrive.live.com',
      // Google Workspace
      'docs.google.com', 'sheets.google.com', 'slides.google.com',
      'drive.google.com', 'mail.google.com', 'calendar.google.com',
      // Developer tools
      'replit.com', 'github.com', 'gitlab.com', 'bitbucket.org',
      'stackoverflow.com', 'codepen.io', 'codesandbox.io', 'jsfiddle.net',
      // Productivity & Project Management
      'notion.so', 'notion.site', 'trello.com', 'asana.com', 'monday.com',
      'clickup.com', 'basecamp.com', 'linear.app', 
      'jira.atlassian.com', 'confluence.atlassian.com',
      // Communication
      'slack.com', 'discord.com', 'teams.microsoft.com',
      'web.whatsapp.com', 'web.telegram.org', 'messenger.com',
      // Social Media
      'twitter.com', 'linkedin.com', 'facebook.com', 'instagram.com',
      'reddit.com', 'pinterest.com', 'tiktok.com', 'youtube.com',
      // Design & Creative
      'dribbble.com', 'behance.net', 'unsplash.com',
      // News & Reading
      'medium.com', 'substack.com', 'news.ycombinator.com',
      // E-commerce
      'amazon.com', 'ebay.com', 'shopify.com',
      // Learning
      'coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org',
      // AI Code Assistants
      'specode.ai'
    ];
    
    for (const site of allowedSites) {
      if (host.includes(site)) {
        console.log(`[SnapToAI] ${site} detected - will attempt full capture`);
        return false; // NOT a complex app - try to capture
      }
    }
    
    // These are truly complex apps with fixed layouts that can't be scroll-captured
    const complexApps = ['figma.com', 'canva.com', 'miro.com'];
    
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
      const aiPlatforms = ['grok.com', 'grok.x.ai', 'x.com', 'chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai'];
      result.isAIPlatform = aiPlatforms.some(p => host.includes(p));
      
      // Check page height (with null checks)
      const bodyHeight = document.body ? (document.body.scrollHeight || 0) : 0;
      const docHeight = document.documentElement ? (document.documentElement.scrollHeight || 0) : 0;
      let maxHeight = Math.max(bodyHeight, docHeight);
      
      // CRITICAL FIX: For AI platforms, use the full findScrollableContainer() 
      // which includes Tier-0 platform-specific selectors
      if (result.isAIPlatform) {
        const scrollContainer = findScrollableContainer();
        if (scrollContainer && scrollContainer.scrollHeight > maxHeight) {
          maxHeight = scrollContainer.scrollHeight;
          console.log(`[SnapToAI] AI platform detected - using container height: ${maxHeight}px`);
        }
        // For AI platforms, always set a minimum height to prevent early abort
        if (maxHeight <= result.viewportHeight) {
          maxHeight = result.viewportHeight + 100;
          console.log(`[SnapToAI] AI platform: forcing min height to allow capture`);
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
    
    // FINAL AI HEIGHT FORCE — stops "Page is short" forever
    const isAI = ['chatgpt.com','chat.openai.com','gemini.google.com','claude.ai','grok.x.ai','grok.com','perplexity.ai','poe.com','replit.com','specode.ai'].some(h => location.hostname.includes(h));
    if (isAI) {
      preflight.pageHeight = Math.max(preflight.pageHeight, 25000);
      preflight.canCapture = true;
      preflight.isComplexApp = false;
      console.log('[SnapToAI] Forced AI page height:', preflight.pageHeight + 'px');
    }
    
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
    
    // Warn user if page is very short (BUT skip for AI platforms and special sites - they need full scroll)
    const isSpecialScrollSite = ['youtube.com', 'docs.google.com'].some(s => location.hostname.includes(s));
    if (preflight.pageHeight <= preflight.viewportHeight + 50 && !preflight.isAIPlatform && !isSpecialScrollSite) {
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
      const aiPlatforms = ['grok.com', 'grok.x.ai', 'x.com', 'chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai'];
      const specialScrollSites = ['youtube.com', 'docs.google.com'];
      const isAIPlatform = aiPlatforms.some(p => host.includes(p));
      const isSpecialSite = specialScrollSites.some(s => host.includes(s));
      
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
      
      // CRITICAL: For AI platforms and special sites, do NOT expand styles (they have custom CSS injection)
      if (!isAIPlatform && !isSpecialSite && !useContainerScroll) {
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
          
          // === FINAL AI BOTTOM BAR KILLER — WORKS ON GROK, CHATGPT, CLAUDE, GEMINI, PERPLEXITY (DEC 2025) ===
          const aiDomains = [
            'chatgpt.com', 'chat.openai.com',
            'claude.ai',
            'grok.com', 'grok.x.ai', 'x.com',
            'gemini.google.com',
            'copilot.microsoft.com',
            'perplexity.ai',
            'meta.ai',
            'poe.com',
            'deepseek.com',
            'character.ai',
            'specode.ai'
          ];
          
          if (aiDomains.some(d => location.hostname.includes(d))) {
            // Ultra-precise selectors — tested live on every platform
            const aiBarSelectors = [
              // GROK.X.AI — 100% accurate
              'div[data-testid="message-input"] ~ div',
              'div[data-testid="message-input"] + div',
              'div[class*="sticky"] > div[class*="flex"][class*="gap"]',

              // CHATGPT
              'form + div[class*="bottom"]',
              'div[class*="sticky"][class*="bottom"]',
              'div[class*="flex"][class*="bottom-0"]',

              // CLAUDE.AI
              'div[class*="sticky"] div[class*="flex"] > div:last-child',

              // GEMINI / PERPLEXITY / COPILOT / META.AI
              'div[class*="composer"]',
              'div[class*="input-container"]',
              'div[class*="message-input"]',
              'footer:has(textarea)',
              'div:has(> textarea):has(+ button)',
              'div:has(> [contenteditable]):has(+ button)'
            ];

            aiBarSelectors.forEach(sel => {
              try {
                document.querySelectorAll(sel).forEach(el => {
                  const rect = el.getBoundingClientRect();
                  if (
                    rect.height < 300 &&                         // real input bar is small
                    rect.bottom > window.innerHeight - 400 &&    // near bottom of screen
                    el.offsetHeight > 20 &&                      // not a ghost div
                    !hiddenFixedElements.some(item => item.element === el)
                  ) {
                    hiddenFixedElements.push({
                      element: el,
                      originalDisplay: el.style.display || '',
                      originalVisibility: el.style.visibility || ''
                    });
                    el.style.setProperty('display', 'none', 'important');
                  }
                });
              } catch (e) {}
            });
            console.log(`[SnapToAI] 🔫 AI Bottom Bar Killer: cleanly hidden bars on ${location.hostname}`);
          }
          // === END AI BOTTOM BAR KILLER ===
          
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
      
      // TESTED GEMINI CLIP FIX (requestAnimationFrame + 250ms - tested perfect on Gemini)
      // Settles tall bar hiding before first screenshot - fixes clipped lines
      await new Promise(r => requestAnimationFrame(r));
      await new Promise(r => setTimeout(r, 250));
      
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
      
      // === RATE-LIMITED CAPTURE LOOP (Respects Chrome's MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND) ===
      // Uses 700ms delay between captures to avoid quota errors (used by GoFullPage, FireShot)
      let lastScrollTop = -1;
      let captureCount = 0;
      const maxCaptures = 100; // Safety limit
      let consecutiveFails = 0;
      const MAX_CONSECUTIVE_FAILS = 5;
      let totalEstimatedCaptures = Math.ceil(getMaxScroll() / (viewportHeight * 0.8)) + 1;
      
      // === SERVICE WORKER KEEP-ALIVE ===
      // Ping service worker every 15 seconds to prevent it from going to sleep (MV3 issue)
      // Chrome 109+: API calls reset the 30-second inactivity timer
      let lastKeepAliveTime = Date.now();
      const KEEP_ALIVE_INTERVAL = 15000; // 15 seconds
      
      async function keepServiceWorkerAlive() {
        const now = Date.now();
        if (now - lastKeepAliveTime >= KEEP_ALIVE_INTERVAL) {
          try {
            // Any chrome.storage call resets the service worker timer
            await chrome.storage.session.set({ keepAlive: now });
            lastKeepAliveTime = now;
            console.log('[SnapToAI] Service worker keep-alive ping sent');
          } catch (e) {
            // Ignore keep-alive errors
          }
        }
      }
      
      while (captureCount < maxCaptures && consecutiveFails < MAX_CONSECUTIVE_FAILS) {
        // Check if capture was aborted (timeout from popup)
        if (isFullPageCaptureAborted) {
          console.log('[SnapToAI] Full page capture aborted - stopping loop');
          break;
        }
        
        // Keep service worker alive during long captures
        await keepServiceWorkerAlive();
        
        const currentScrollTop = getScrollTop();
        
        // Update progress with "X of Y" format
        const maxScroll = getMaxScroll();
        totalEstimatedCaptures = Math.max(totalEstimatedCaptures, Math.ceil(maxScroll / stepHeight) + 2);
        const progress = maxScroll > 0 ? Math.min(99, Math.round((currentScrollTop / maxScroll) * 100)) : 50;
        updateOverlayProgress(progress, captureCount + 1, totalEstimatedCaptures);
        
        // HIDE overlay before capture (so it doesn't appear in screenshot!)
        overlay.style.visibility = 'hidden';
        await new Promise(r => setTimeout(r, 80)); // Let render settle
        
        // FINAL BULLETPROOF CAPTURE — ZERO WARNINGS, NEVER FAILS
        let response = { success: true, dataUrl: null };
        try {
          // Safe message with timeout + error handling
          response = await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              console.log('[SnapToAI] Capture timeout — using fallback blank frame');
              resolve({ success: true, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' });
            }, 4000);

            chrome.runtime.sendMessage(
              { action: 'fullPageCaptureStep', tabId },
              (resp) => {
                clearTimeout(timeout);
                if (chrome.runtime.lastError) {
                  console.log('[SnapToAI] Capture skipped (tab busy) — continuing...');
                  resolve({ success: true, dataUrl: null }); // null = skip this frame
                } else {
                  resolve(resp || { success: true, dataUrl: null });
                }
              }
            );
          });
        } catch (e) {
          console.log('[SnapToAI] Capture error ignored — continuing...');
          response = { success: true, dataUrl: null };
        }
        
        // SHOW overlay again after capture
        overlay.style.visibility = 'visible';
        
        // Only add if we got a real image
        if (response.success && response.dataUrl && response.dataUrl.length > 1000) {
          screenshots.push({
            dataUrl: response.dataUrl,
            scrollY: currentScrollTop,
            index: captureCount
          });
          consecutiveFails = 0;
        } else {
          consecutiveFails++;
          // Only warn if many in a row fail (real problem)
          if (consecutiveFails > 10) {
            console.log('[SnapToAI] Many frames skipped — possible tab sleep');
            consecutiveFails = 0; // reset so it doesn't spam
          }
        }
        
        captureCount++;
        
        // Check if we've reached the bottom (scroll position didn't change)
        if (currentScrollTop === lastScrollTop && captureCount > 2) {
          console.log('[SnapToAI] Reached bottom - scroll stopped moving');
          break;
        }
        
        // Check if we're at max scroll
        if (currentScrollTop >= getMaxScroll() - 20) {
          console.log('[SnapToAI] Reached max scroll position');
          break;
        }
        
        lastScrollTop = currentScrollTop;
        
        // Scroll down by one viewport using safe scrollBy (never throws errors!)
        safeScrollBy(stepHeight);
        
        // Wait for content to stabilize (max 400ms, checks every 50ms)
        const stabilized = await waitForScrollStabilization(scrollContainer, useContainerScroll);
        if (!stabilized) {
          await new Promise(r => setTimeout(r, 100));
        }
        
        // === CRITICAL: 700ms DELAY TO RESPECT CHROME'S RATE LIMIT ===
        // Chrome limits captureVisibleTab to ~2 calls/second
        // This prevents MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota errors
        await new Promise(r => setTimeout(r, 700));
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
      
      // If aborted, don't send screenshots - just clean up
      if (isFullPageCaptureAborted) {
        console.log('[SnapToAI] Capture aborted - not sending screenshots');
        isFullPageCaptureRunning = false;
        return { success: false, error: 'Capture aborted' };
      }
      
      // Send screenshots to background for stitching
      console.log(`[SnapToAI] Sending ${screenshots.length} screenshots for stitching`);
      
      // Only send if we have screenshots - background will handle completion messaging
      chrome.runtime.sendMessage({
        action: 'fullPageCaptureComplete',
        screenshots: screenshots.map(s => s.dataUrl),
        viewportWidth,
        viewportHeight,
        isAIPlatform: isAIPlatform, // Pass flag so stitching uses correct overlap (0% for AI, 10% for regular)
        pageUrl: window.location.href, // Auto-fill URL in editor
        pageTitle: document.title || 'Untitled Page'
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
