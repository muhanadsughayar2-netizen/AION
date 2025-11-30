// SnapToAI Content Script — BULLETPROOF VERSION
// Wrapped in IIFE to allow early return

(function() {
  'use strict';
  
  // Guard against multiple injections
  if (window.__snaptoai_loaded) {
    return; // Exit immediately (now legal inside function)
  }
  window.__snaptoai_loaded = true;

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

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'showToast') {
      showToast(request.message, request.type || 'success');
      sendResponse({ success: true });
    } else if (request.action === 'captureComplete') {
      showToast(request.message, 'success');
      sendResponse({ success: true });
    } else if (request.action === 'beginUpload') {
      uploadToAI(request.platform, request.useSelectedOnly).then(sendResponse);
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
      // Start full page capture with visible scrolling
      performFullPageCapture(request.tabId).then(sendResponse);
      return true;
    }
  });

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
        const selectedResult = await chrome.storage.session.get('selectedSnapsForUpload');
        snaps = selectedResult.selectedSnapsForUpload || [];
        await chrome.storage.session.remove('selectedSnapsForUpload');
      } else {
        const result = await chrome.storage.session.get('snaps');
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
      await chrome.storage.session.remove('snaps');
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
  async function dataUrlToFile(dataUrl, filename) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return new File([blob], filename, { type: 'image/png' });
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
  
  // Find ALL elements that need to be expanded for full page capture
  // Including html, body, and ancestor elements with overflow hidden
  function findElementsToExpand() {
    const elements = new Set();
    
    // Always include html and body if they have restricted overflow
    const html = document.documentElement;
    const body = document.body;
    
    const htmlStyle = window.getComputedStyle(html);
    const bodyStyle = window.getComputedStyle(body);
    
    if (htmlStyle.overflow !== 'visible' || htmlStyle.overflowY !== 'visible' ||
        htmlStyle.height === '100%' || htmlStyle.height === '100vh') {
      elements.add(html);
    }
    
    if (bodyStyle.overflow !== 'visible' || bodyStyle.overflowY !== 'visible' ||
        bodyStyle.height === '100%' || bodyStyle.height === '100vh') {
      elements.add(body);
    }
    
    // Common layout wrappers that restrict height
    const wrapperSelectors = [
      '#__next', // Next.js
      '#root', // React
      '#app', // Vue
      '[class*="layout"]',
      '[class*="wrapper"]',
      '[class*="container"]'
    ];
    
    for (const selector of wrapperSelectors) {
      const wrappers = document.querySelectorAll(selector);
      for (const el of wrappers) {
        const style = window.getComputedStyle(el);
        if (style.overflow !== 'visible' || style.overflowY !== 'visible' ||
            style.height === '100%' || style.height === '100vh') {
          elements.add(el);
        }
      }
    }
    
    // Find scrollable containers (chat areas, etc)
    const scrollSelectors = [
      'main[class*="scroll"]',
      'div[class*="conversation"]',
      'div[class*="chat-content"]',
      'div[class*="messages"]',
      '[role="main"]',
      '.overflow-y-auto',
      '[class*="overflow-auto"]',
      '[class*="overflow-y-scroll"]'
    ];
    
    for (const selector of scrollSelectors) {
      const scrollables = document.querySelectorAll(selector);
      for (const el of scrollables) {
        const style = window.getComputedStyle(el);
        const overflowY = style.overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && 
            el.scrollHeight > el.clientHeight + 100) {
          elements.add(el);
        }
      }
    }
    
    // Fallback: find any element with significant scrollable content
    const allElements = document.querySelectorAll('div, main, section');
    for (const el of allElements) {
      const style = window.getComputedStyle(el);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 200 &&
          el.clientHeight > 200) {
        elements.add(el);
        
        // Also add all ancestors with overflow restrictions
        let parent = el.parentElement;
        while (parent && parent !== document.documentElement) {
          const parentStyle = window.getComputedStyle(parent);
          if (parentStyle.overflow !== 'visible' || 
              parentStyle.overflowY !== 'visible' ||
              parentStyle.height === '100%' || 
              parentStyle.height === '100vh') {
            elements.add(parent);
          }
          parent = parent.parentElement;
        }
      }
    }
    
    return Array.from(elements);
  }
  
  // Expand all elements so content is in document flow
  function expandElements(elements) {
    const originalStyles = [];
    
    for (const el of elements) {
      // Save original styles
      originalStyles.push({
        element: el,
        overflow: el.style.overflow,
        overflowY: el.style.overflowY,
        overflowX: el.style.overflowX,
        height: el.style.height,
        maxHeight: el.style.maxHeight,
        position: el.style.position
      });
      
      // Expand the element
      el.style.overflow = 'visible';
      el.style.overflowY = 'visible';
      el.style.height = 'auto';
      el.style.maxHeight = 'none';
    }
    
    console.log(`[SnapToAI] Expanded ${elements.length} elements for full page capture`);
    return originalStyles;
  }
  
  // Restore original styles to all expanded elements
  function restoreExpandedElements(originalStyles) {
    for (const item of originalStyles) {
      item.element.style.overflow = item.overflow;
      item.element.style.overflowY = item.overflowY;
      item.element.style.overflowX = item.overflowX;
      item.element.style.height = item.height;
      item.element.style.maxHeight = item.maxHeight;
      item.element.style.position = item.position;
    }
    console.log(`[SnapToAI] Restored ${originalStyles.length} element styles`);
  }

  // Perform full page scroll and capture
  async function performFullPageCapture(tabId) {
    // Set guard flag immediately
    isFullPageCaptureRunning = true;
    console.log('[SnapToAI] Full page capture started');
    
    const overlay = createFullPageOverlay();
    const screenshots = [];
    let originalStyles = [];
    
    try {
      // Get page dimensions
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      
      // Measure initial document height
      const initialHeight = document.documentElement.scrollHeight;
      console.log(`[SnapToAI] Initial document height: ${initialHeight}px`);
      
      // Find and expand any elements restricting scroll (for AI chat sites like Grok, ChatGPT, Claude)
      const elementsToExpand = findElementsToExpand();
      if (elementsToExpand.length > 0) {
        originalStyles = expandElements(elementsToExpand);
        // Wait for reflow
        await new Promise(resolve => requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        }));
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // Now use document scroll (containers are expanded)
      let totalHeight = document.documentElement.scrollHeight;
      console.log(`[SnapToAI] Document height after expansion: ${totalHeight}px`);
      
      // Check if expansion worked - if height didn't increase significantly, 
      // just capture current viewport and notify user
      let limitedCapture = false;
      if (elementsToExpand.length > 0 && totalHeight <= initialHeight + 100) {
        console.log('[SnapToAI] Expansion did not increase document height. Capturing visible area only.');
        limitedCapture = true;
        // Restore styles immediately since expansion didn't help
        restoreExpandedElements(originalStyles);
        originalStyles = [];
        totalHeight = viewportHeight; // Just capture one viewport
      }
      
      // Calculate number of captures needed
      const overlap = 50; // Pixels of overlap between captures
      const stepHeight = viewportHeight - overlap;
      
      // Scroll to top first
      window.scrollTo(0, 0);
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Recalculate after scroll (some pages load content)
      totalHeight = await waitForScrollSettled(totalHeight, 300);
      
      const numCaptures = Math.ceil(totalHeight / stepHeight);
      let currentScroll = 0;
      
      console.log(`[SnapToAI] Full page: ${numCaptures} captures needed, total height: ${totalHeight}px`);
      
      for (let i = 0; i < numCaptures; i++) {
        // Calculate scroll position
        const targetScroll = Math.min(i * stepHeight, totalHeight - viewportHeight);
        
        // Smooth scroll to position (visible to user!)
        window.scrollTo({
          top: targetScroll,
          behavior: 'smooth'
        });
        
        // Wait for scroll animation + page settle
        await new Promise(resolve => setTimeout(resolve, 400));
        
        // Update progress
        const progress = Math.round(((i + 1) / numCaptures) * 100);
        updateOverlayProgress(progress);
        
        // Request capture from background script
        const response = await chrome.runtime.sendMessage({ 
          action: 'fullPageCaptureStep',
          tabId: tabId
        });
        
        if (response.success && response.dataUrl) {
          screenshots.push({
            dataUrl: response.dataUrl,
            scrollY: targetScroll,
            index: i
          });
          console.log(`[SnapToAI] Captured step ${i + 1}/${numCaptures}`);
        } else {
          console.error(`[SnapToAI] Capture step ${i + 1} failed:`, response.error);
        }
        
        // Check if we've reached the bottom
        if (targetScroll >= totalHeight - viewportHeight) {
          break;
        }
      }
      
      // Restore element styles before removing overlay
      if (originalStyles.length > 0) {
        restoreExpandedElements(originalStyles);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Remove overlay
      removeFullPageOverlay();
      
      // Scroll back to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
      
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
      console.error('[SnapToAI] Full page capture failed:', error);
      
      // Restore element styles on error
      if (originalStyles.length > 0) {
        restoreExpandedElements(originalStyles);
      }
      
      removeFullPageOverlay();
      
      // Notify background of failure so it can reset state
      chrome.runtime.sendMessage({
        action: 'fullPageStitchFailed'
      }).catch(() => {});
      
      return { success: false, error: error.message };
    } finally {
      // Always reset guard flag
      isFullPageCaptureRunning = false;
      console.log('[SnapToAI] Full page capture ended');
    }
  }

})();
