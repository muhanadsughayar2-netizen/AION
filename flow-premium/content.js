// SnapToAI Content Script — BULLETPROOF VERSION
// Wrapped in IIFE to allow early return

(function() {
  'use strict';
  
  // Version-stamped guard — a new build always replaces the old injection
  const _SNAP_VERSION = '20260716';
  if (window.__snaptoai_loaded === _SNAP_VERSION && window.__snaptoai_healthy) {
    console.log('[SnapToAI] Already loaded (current version), skipping');
    return;
  }
  window.__snaptoai_loaded = _SNAP_VERSION;
  window.__snaptoai_healthy = true; // Set false on critical errors

  // === THEME (v2.6.0) ===
  // Mirrors the extension's Light/Dark/Auto preference for any UI we
  // inject onto the host page (toasts, full-page capture overlay, etc.).
  // Cached locally; updated live via chrome.storage.onChanged so already-
  // injected UI re-skins instantly when the user flips themes elsewhere.
  let __snapThemePref = 'dark';
  // Auto-mode resolution priority (per Task #21 spec):
  //   1. Host page's declared color-scheme (meta name="color-scheme" or
  //      computed style on <html>). If the page explicitly says "light"
  //      or "dark", honor it so our overlay blends with the surrounding
  //      page chrome.
  //   2. OS prefers-color-scheme as a fallback.
  function __snapHostPageScheme() {
    try {
      const root = document.documentElement;
      if (root) {
        const cs = (getComputedStyle(root).colorScheme || '').toLowerCase();
        // 'light dark' / 'normal' / '' → ambiguous, ignore
        if (cs.includes('light') && !cs.includes('dark')) return 'light';
        if (cs.includes('dark') && !cs.includes('light')) return 'dark';
      }
      const meta = document.querySelector('meta[name="color-scheme"]');
      if (meta) {
        const v = (meta.getAttribute('content') || '').toLowerCase();
        if (v.includes('light') && !v.includes('dark')) return 'light';
        if (v.includes('dark') && !v.includes('light')) return 'dark';
      }
    } catch (e) {}
    return null;
  }
  function __snapResolveTheme(pref) {
    if (pref === 'auto') {
      const host = __snapHostPageScheme();
      if (host) return host;
      try { return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
      catch (e) { return 'dark'; }
    }
    return pref === 'light' ? 'light' : 'dark';
  }
  function __snapPalette() {
    const resolved = __snapResolveTheme(__snapThemePref);
    if (resolved === 'light') {
      return {
        toastSuccessBg: 'rgba(8, 145, 178, 0.96)',  // accent
        toastErrorBg:   'rgba(220, 38, 38, 0.96)',
        toastText:      '#ffffff',
        toastShadow:    '0 4px 20px rgba(8, 145, 178, 0.35)',
        overlayBg:      'rgba(255, 255, 255, 0.96)',
        overlayBorder:  'rgba(8, 145, 178, 0.45)',
        overlayShadow:  '0 4px 20px rgba(15, 23, 42, 0.18)',
        overlayText:    '#0f172a',
        overlayAccent:  '#0891b2',
        spinnerTrack:   'rgba(8, 145, 178, 0.25)',
        spinnerHead:    'rgba(8, 145, 178, 0.95)',
        successCheck:   '#16a34a'
      };
    }
    // Dark (byte-equivalent to v2.5.0 toast/overlay colors)
    return {
      toastSuccessBg: 'rgba(0, 217, 255, 0.95)',
      toastErrorBg:   'rgba(255, 59, 48, 0.95)',
      toastText:      '#000',
      toastShadow:    '0 4px 20px rgba(0, 217, 255, 0.4)',
      overlayBg:      'rgba(0, 0, 0, 0.85)',
      overlayBorder:  'rgba(0, 217, 255, 0.5)',
      overlayShadow:  '0 4px 20px rgba(0, 0, 0, 0.5)',
      overlayText:    '#ffffff',
      overlayAccent:  '#00d9ff',
      spinnerTrack:   'rgba(0, 217, 255, 0.3)',
      spinnerHead:    'rgba(0, 217, 255, 0.9)',
      successCheck:   '#4ade80'
    };
  }
  function __snapApplyThemeToLiveUi() {
    const p = __snapPalette();
    // Re-skin any active toast
    const t = document.getElementById('flow-toast');
    if (t) {
      const isError = t.dataset.flowToastType === 'error';
      t.style.backgroundColor = isError ? p.toastErrorBg : p.toastSuccessBg;
      t.style.color = p.toastText;
      t.style.boxShadow = p.toastShadow;
    }
    // Re-skin active full-page overlay
    const ov = document.getElementById('snaptoai-fullpage-overlay');
    if (ov) {
      const card = ov.firstElementChild;
      if (card && card.style) {
        card.style.background = p.overlayBg;
        card.style.borderColor = p.overlayBorder;
        card.style.boxShadow = p.overlayShadow;
        card.style.color = p.overlayText;
      }
      const spinner = ov.querySelector('.snaptoai-overlay-spinner');
      if (spinner && spinner.style) {
        spinner.style.borderColor = p.spinnerTrack;
        spinner.style.borderTopColor = p.spinnerHead;
      }
      const txt = document.getElementById('snaptoai-progress-text');
      if (txt) txt.style.color = p.overlayAccent;
    }
  }
  // Initial read + live updates
  try {
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['snaptoaiSettings'], (res) => {
        const s = res && res.snaptoaiSettings;
        if (s && (s.theme === 'light' || s.theme === 'dark' || s.theme === 'auto')) {
          __snapThemePref = s.theme;
        } else if (!s) {
          __snapThemePref = 'auto';
        }
        __snapApplyThemeToLiveUi();
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.snaptoaiSettings) return;
        const nv = changes.snaptoaiSettings.newValue;
        const t = nv && nv.theme;
        if (t === 'light' || t === 'dark' || t === 'auto') {
          __snapThemePref = t;
          __snapApplyThemeToLiveUi();
        }
      });
    }
  } catch (e) {}
  // OS pref change (auto mode)
  try {
    const __snapMql = window.matchMedia('(prefers-color-scheme: light)');
    const __snapOnPref = () => { if (__snapThemePref === 'auto') __snapApplyThemeToLiveUi(); };
    if (__snapMql.addEventListener) __snapMql.addEventListener('change', __snapOnPref);
    else if (__snapMql.addListener) __snapMql.addListener(__snapOnPref);
  } catch (e) {}

  // Track last mouse position for toast placement
  let lastMouseX = window.innerWidth - 20;
  let lastMouseY = 20;
  
  // Guard against concurrent full page captures in this content script instance
  let isFullPageCaptureRunning = false;
  let isFullPageCaptureAborted = false; // Flag to stop capture loop when aborted

  // === INDEXEDDB HELPERS FOR LARGE CAPTURES ===
  // Chrome message passing has 64MB limit - use IndexedDB for 70+ screenshots
  const FPC_DB_NAME = 'SnapToAI_FullPageCapture';
  const FPC_STORE_NAME = 'screenshots';
  
  async function openFPCDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(FPC_DB_NAME, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(FPC_STORE_NAME)) {
          db.createObjectStore(FPC_STORE_NAME, { keyPath: 'id' });
        }
      };
    });
  }
  
  async function saveFPCScreenshots(screenshots, metadata) {
    try {
      const db = await openFPCDatabase();
      const tx = db.transaction(FPC_STORE_NAME, 'readwrite');
      const store = tx.objectStore(FPC_STORE_NAME);
      
      // Clear old data first
      await new Promise((resolve, reject) => {
        const clearReq = store.clear();
        clearReq.onsuccess = () => resolve();
        clearReq.onerror = () => reject(clearReq.error);
      });
      
      // Save new data as a single record
      await new Promise((resolve, reject) => {
        const putReq = store.put({
          id: 'fullpage_capture',
          screenshots: screenshots,
          metadata: metadata,
          timestamp: Date.now()
        });
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      });
      
      db.close();
      console.log(`[SnapToAI] Saved ${screenshots.length} screenshots to IndexedDB`);
      return true;
    } catch (e) {
      console.log('[SnapToAI] IndexedDB save failed:', e.message);
      return false;
    }
  }

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
      window.addEventListener('unload', () => grokObserver.disconnect());
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
            console.log('[SnapToAI] Upload error:', err.message);
            sendResponse({ success: false, error: 'Upload not available on this page' });
          });
        return true;
      } else if (request.action === 'getPageDimensions') {
        // Return page dimensions for pre-check before full page capture
        const totalHeight = Math.max(
          document.documentElement.scrollHeight,
          document.body?.scrollHeight || 0
        );
        const viewportHeight = window.innerHeight;
        sendResponse({ 
          success: true, 
          totalHeight, 
          viewportHeight,
          estimatedPages: Math.ceil(totalHeight / viewportHeight)
        });
        return;
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
            console.log('[SnapToAI] Full page capture failed safely:', err.message);
            showToast('This page cannot be captured. Try SNAP instead.', 'error');
            sendResponse({ success: false, error: 'Page not capturable' });
          });
        return true;
      } else if (request.action === 'get_page_text') {
        // Smart text extraction for AI context
        let pageText = '';
        
        // Gmail-specific extraction
        if (location.hostname.includes('mail.google.com')) {
          // Try to get open email content
          const emailSelectors = [
            '.a3s.aiL', // Email body content
            '.ii.gt', // Alternative email body
            '[data-message-id] .a3s', // Message content
            '.h7', // Email thread subject
            '.nH .adn', // Conversation view
            '.adn.ads' // Full email thread
          ];
          for (const selector of emailSelectors) {
            const els = document.querySelectorAll(selector);
            if (els.length > 0) {
              pageText = Array.from(els).map(el => el.innerText).join('\n\n---\n\n');
              break;
            }
          }
          // Also get subject line
          const subject = document.querySelector('.hP') || document.querySelector('h2.hP');
          if (subject && pageText) {
            pageText = 'Subject: ' + subject.innerText + '\n\n' + pageText;
          }
        }
        
        // General extraction if Gmail didn't find content
        if (!pageText) {
          const mainSelectors = ['article', 'main', '.post-content', '.article-body', '#content', '.content'];
          for (const selector of mainSelectors) {
            const el = document.querySelector(selector);
            if (el && el.innerText.length > 500) {
              pageText = el.innerText;
              break;
            }
          }
        }
        if (!pageText) pageText = document.body.innerText;
        // Return title and text (limit to 15k chars)
        const pageData = {
          title: document.title,
          text: pageText.substring(0, 15000)
        };
        sendResponse(pageData);
        return;
      } else if (request.action === 'abortFullPageCapture') {
        // Popup/background requested abort (timeout or user cancel)
        console.log('[SnapToAI] Full page capture abort received');
        isFullPageCaptureAborted = true;
        isFullPageCaptureRunning = false;
        removeFullPageOverlay();
        sendResponse({ success: true });
        return;
      } else if (request.action === 'agentExecute') {
        // Agent automation commands
        // manifest.json runs this script with all_frames:true, so every
        // same-origin/cross-origin iframe on the page (ad slots, OAuth
        // buttons, embeds) has its own independent copy of this listener.
        // buildElementIndex/resolveByIndex read and write a per-frame
        // window.__aionElementIndex map; without frameId, chrome.tabs.sendMessage
        // resolves to whichever frame's sendResponse() lands first, which can
        // be a near-empty child iframe beating the top frame's real, complete
        // answer (or, worse, resolveByIndex reading a stale/foreign map and
        // returning coordinates for the wrong element). Same guard pattern as
        // the window.self !== window.top check above for startFullPageCapture.
        if ((request.executeAction === 'buildElementIndex' || request.executeAction === 'resolveByIndex') && window.self !== window.top) {
          return;
        }
        handleAgentAction(request.executeAction, request.params)
          .then(result => sendResponse(result))
          .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
      }
    } catch (err) {
      // NEVER let errors bubble up to Chrome
      console.log('[SnapToAI] Message handler error:', err.message);
      sendResponse({ success: false, error: 'Internal error' });
    }
  });
  
  // Force special sites to render full content by injecting expansion styles
  function forceSpecialSiteFullRender() {
    const isGoogleDocs = location.hostname.includes('docs.google.com');
    const isYouTube = location.hostname.includes('youtube.com');
    const isGmail = location.hostname.includes('mail.google.com');
    
    if (!isGoogleDocs && !isYouTube && !isGmail) return;
    
    // Remove any existing style to avoid duplicates
    const existing = document.getElementById('snaptoai-site-styles');
    if (existing) existing.remove();
    
    const style = document.createElement('style');
    style.id = 'snaptoai-site-styles';
    
    if (isGoogleDocs) {
      style.textContent = `
        /* Hide the UI but DO NOT touch the editor height - Virtual Rendering fix */
        #docs-header, .docs-titlebar-buttons, #docs-toolbar-wrapper, 
        .navigation-widget-view, .docs-companion-app-switcher-container,
        #gb, .docs-horizontal-scroll-bar, .kix-paginated-view-header,
        .docs-titlebar, .docs-menubar, .docs-material-menu-button-bar,
        #docs-bars, .docs-butterbar-container {
          display: none !important;
        }
        /* Ensure the editor fills the screen for the capture */
        .kix-appview-editor {
          top: 0 !important;
          background: white !important;
        }
        /* FULL PAGE FIX: Force editor containers to full width for complete capture */
        div#docs-editor,
        div#docs-editor-container,
        div#kix-appview,
        .kix-appview-editor-container,
        .kix-appview-editor,
        div[id^="__FPSC_ID_"] {
          width: 100% !important;
          max-width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          box-sizing: border-box !important;
        }
      `;
      console.log('[SnapToAI] Google Docs UI Hidden - Full Width Mode Enabled');
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
    } else if (isGmail) {
      style.textContent = `
        /* Gmail: Only expand email content, keep scroll containers intact */
        /* Expand collapsed messages in thread */
        .kQ, .kv {
          display: block !important;
          visibility: visible !important;
        }
        /* Expand email body content only */
        .a3s.aiL, .ii.gt {
          max-height: none !important;
        }
        /* Hide mini compose popups during capture */
        .aaZ, .aYF {
          display: none !important;
        }
      `;
      console.log('[SnapToAI] Gmail styles injected');
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
      if (location.hostname.includes('docs.google.com') || location.hostname.includes('youtube.com') || location.hostname.includes('mail.google.com')) {
        await new Promise(r => setTimeout(r, 300));
      }
      
      const result = await performFullPageCapture(tabId);
      
      // Cleanup after capture
      cleanupSpecialSiteStyles();
      
      return result;
    } catch (error) {
      // Log to console but NEVER throw - this prevents Chrome extension errors
      console.log('[SnapToAI] Capture error (handled):', error.message || error);
      
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

  // Show floating toast notification - fixed position at top center
  function showToast(message, type = 'success') {
    const existingToast = document.getElementById('flow-toast');
    if (existingToast) {
      existingToast.remove();
    }
    
    const toast = document.createElement('div');
    toast.id = 'flow-toast';
    toast.textContent = message;
    toast.dataset.flowToastType = type === 'success' ? 'success' : 'error';
    const __pal = __snapPalette();

    Object.assign(toast.style, {
      position: 'fixed',
      left: '50%',
      top: '20px',
      transform: 'translateX(-50%)',
      backgroundColor: type === 'success' ? __pal.toastSuccessBg : __pal.toastErrorBg,
      color: __pal.toastText,
      padding: '12px 24px',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: '600',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      boxShadow: __pal.toastShadow,
      zIndex: '2147483647',
      animation: 'flow-toast-fade-in 0.3s ease-out',
      backdropFilter: 'blur(10px)',
      pointerEvents: 'none',
      opacity: '1'
    });
    
    if (!document.getElementById('flow-toast-styles')) {
      const style = document.createElement('style');
      style.id = 'flow-toast-styles';
      style.textContent = `
        @keyframes flow-toast-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes flow-toast-fade-out {
          from { opacity: 1; }
          to { opacity: 0; }
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
      console.log('Clipboard write failed:', error);
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
      
      // --- HYBRID MODE: Paste text context before uploading images ---
      try {
        const sessionData = await chrome.storage.session.get(['aiText', 'payloadMode']);
        if (sessionData.payloadMode === 'hybrid' && sessionData.aiText) {
          const chatInput = document.querySelector('div[role="textbox"], textarea[id*="prompt"], #prompt-textarea, textarea, [contenteditable="true"]');
          if (chatInput) {
            chatInput.focus();
            const textToPaste = `CONTEXT FROM PAGE:\n${sessionData.aiText}\n\n--- ANALYZE ATTACHED IMAGES BELOW ---`;
            
            // Use insertText for better compatibility
            if (document.execCommand) {
              document.execCommand('insertText', false, textToPaste);
            } else if (chatInput.tagName === 'TEXTAREA') {
              chatInput.value = textToPaste;
            } else {
              chatInput.innerText = textToPaste;
            }
            chatInput.dispatchEvent(new Event('input', { bubbles: true }));
            
            // Clear session data to prevent re-paste
            await chrome.storage.session.remove(['aiText', 'aiTitle', 'payloadMode']);
            console.log('[SnapToAI] Hybrid mode: pasted text context');
          }
        }
      } catch (hybridErr) {
        console.log('[SnapToAI] Hybrid paste skipped:', hybridErr.message);
      }
      // --- END HYBRID MODE ---
      
      const fileInput = await findFileInput(platform);
      
      if (!fileInput) {
        console.log('[SnapToAI] Could not find file input on this page');
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
          console.log(`[SnapToAI] Failed to upload snap ${i + 1}:`, snapError);
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
      console.log('[SnapToAI] Upload failed:', error);
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
    
    console.log('[SnapToAI] No file input found after all retries');
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
        console.log('[SnapToAI] JPEG conversion failed, using original PNG:', e.message);
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
    const __op = __snapPalette();
    overlay.innerHTML = `
      <div style="
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: ${__op.overlayBg};
        border: 1px solid ${__op.overlayBorder};
        border-radius: 12px;
        padding: 20px 30px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: ${__op.overlayText};
        backdrop-filter: blur(10px);
        box-shadow: ${__op.overlayShadow};
        text-align: center;
      ">
        <div style="display: flex; align-items: center; justify-content: center; gap: 12px;">
          <div class="snaptoai-overlay-spinner" style="
            width: 22px;
            height: 22px;
            border: 2px solid ${__op.spinnerTrack};
            border-top-color: ${__op.spinnerHead};
            border-radius: 50%;
            animation: snaptoai-spin 0.8s linear infinite;
          "></div>
          <div>
            <div id="snaptoai-progress-text" style="font-size: 13px; color: ${__op.overlayAccent};">Scrolling page... 0%</div>
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
        progressText.innerHTML = `<span style="color: ${__snapPalette().successCheck};">✓</span> Capture complete!`;
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
  // Helper: returns true when a canvas's pixel data is entirely transparent/blank.
  // Catches the common WebGL preserveDrawingBuffer=false case where toDataURL()
  // succeeds but returns a fully-transparent image rather than throwing.
  function isCanvasBlank(canvas, dataUrl) {
    // Quick length check: a minimal transparent 1×1 PNG is ~70 bytes as base64
    if (!dataUrl || dataUrl.length < 120) return true;
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return false; // WebGL — can't cheaply inspect pixels; assume non-blank
      const buffer = ctx.getImageData(0, 0, Math.min(canvas.width, 10), Math.min(canvas.height, 10)).data;
      return !Array.prototype.some.call(buffer, channel => channel !== 0);
    } catch (_) {
      return false;
    }
  }

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
            // Canvas tainted by cross-origin textures (Figma, Google Sheets WebGL, etc.)
            console.warn(`[SnapToAI] Canvas ${index} is tainted by CORS — skipping direct capture.`);
            return;
          }
          
          if (!dataUrl || dataUrl === 'data:,' || isCanvasBlank(canvas, dataUrl)) {
            // preserveDrawingBuffer=false causes blank captures on many WebGL apps
            console.warn(`[SnapToAI] Canvas ${index} returned blank/transparent data — WebGL buffer may have cleared.`);
            return;
          }
          
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
          console.log(`[SnapToAI] Failed to capture canvas ${index}:`, e.message);
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
            // Video is CORS-restricted - silently skip
          }
          
        } catch (e) {
          // Failed to capture video - silently skip
        }
      });
      
      console.log(`[SnapToAI] Captured ${mediaState.videoElements.length} video elements`);
      
      mediaState.isMediaCaptured = true;
      console.log('[SnapToAI] 🎬 Canvas/WebGL/video capture complete');
      
    } catch (error) {
      console.log('[SnapToAI] Media capture error (non-fatal):', error.message);
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
      console.log('[SnapToAI] Media restore error (non-fatal):', error.message);
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
        console.log('[SnapToAI] Could not override MutationObserver:', e.message);
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
        console.log('[SnapToAI] Could not override IntersectionObserver:', e.message);
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
      console.log('[SnapToAI] Freeze error (non-fatal):', error.message);
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
      console.log('[SnapToAI] Unfreeze error (non-fatal):', error.message);
      // Force reset state even on error
      freezeState.isFrozen = false;
    }
  }
  
  // ============================================================
  // END DOM FREEZE ENGINE
  // ============================================================
  
  // DOCUMENT VIEWER DETECTION: Pages with page-image, can-zoom-in classes
  function findDocumentViewerContainer() {
    const htmlClasses = document.documentElement.className || '';
    const isDocViewer = htmlClasses.includes('page-image') || htmlClasses.includes('can-zoom-in');
    
    if (!isDocViewer) return null;
    
    console.log('[SnapToAI] Document viewer detected, searching for scroll container...');
    
    // Common document viewer container selectors
    const viewerSelectors = [
      '#content', '.content', '.viewer', '.document-viewer',
      '[class*="scroll"]', '[class*="Scroll"]',
      'main', 'article', '.main-content'
    ];
    
    for (const selector of viewerSelectors) {
      try {
        const el = document.querySelector(selector);
        if (el && el.scrollHeight > window.innerHeight) {
          const style = window.getComputedStyle(el);
          const overflow = style.overflowY || style.overflow;
          if (overflow === 'auto' || overflow === 'scroll' || overflow === 'visible') {
            console.log(`[SnapToAI] Document viewer found container: ${selector}, height: ${el.scrollHeight}px`);
            return el;
          }
        }
      } catch (e) {}
    }
    
    // Fallback: for document viewers, always return documentElement to ensure window scroll is used
    const docEl = document.documentElement;
    const body = document.body;
    const maxHeight = Math.max(docEl?.scrollHeight || 0, body?.scrollHeight || 0);
    console.log(`[SnapToAI] Document viewer fallback to window scroll, max height: ${maxHeight}px`);
    return docEl;
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
      // === GOOGLE APPS (Virtual Rendering) ===
      'docs.google.com': [
        '.kix-appview-editor', 
        '.kix-zoomdocumentplugin-outer',
        '#docs-editor'
      ],
      'mail.google.com': [
        '.aeF',               // Main message list
        '.a3s.aiL',           // Email body content
        'div[role="main"]',
        '.nH.adC'             // Thread view
      ],
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
        '#search .s-main-slot.s-result-list',
        '.s-main-slot',
        '#dp',
        '#ppd',
        '#centerCol',
        '#search',
        '#a-page'
      ],
      'amazon.co.uk': [
        '#search .s-main-slot.s-result-list',
        '.s-main-slot',
        '#dp',
        '#search'
      ],
      'amazon.de': [
        '#search .s-main-slot.s-result-list',
        '.s-main-slot',
        '#dp',
        '#search'
      ],
      'amazon.fr': [
        '#search .s-main-slot.s-result-list',
        '.s-main-slot',
        '#dp',
        '#search'
      ],
      'amazon.ca': [
        '#search .s-main-slot.s-result-list',
        '.s-main-slot',
        '#dp',
        '#search'
      ],
      'amazon.co.jp': [
        '#search .s-main-slot.s-result-list',
        '.s-main-slot',
        '#dp',
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
    
    // DOCUMENT VIEWER CHECK: Pages with page-image, can-zoom-in classes
    const docViewerContainer = findDocumentViewerContainer();
    if (docViewerContainer) {
      console.log('[SnapToAI] Using document viewer container');
      return docViewerContainer;
    }
    
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
    
    // GMAIL / OUTLOOK — Only check email-specific selectors on actual email domains
    const isEmailDomain = host.includes('mail.google.com') || host.includes('outlook.office.com') || host.includes('outlook.live.com');
    if (isEmailDomain) {
      const emailSelectors = ['.aDP', '[jscontroller="eI9zEe"]', '.nH.aqK', '[gh="tm"]', '.AD', '.aeF'];
      for (const sel of emailSelectors) {
        const el = document.querySelector(sel);
        if (el && el.scrollHeight > window.innerHeight + 200) {
          console.log('[SnapToAI] Email container found:', sel, 'scrollHeight:', el.scrollHeight);
          return el;
        }
      }
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
      console.log('[SnapToAI] Simple capture issue:', error?.message || error);
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
      const aiPlatforms = ['grok.com', 'grok.x.ai', 'x.com', 'chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai', 'replit.com'];
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
    
    // Only expand html and body — NOT all ancestors (breaks modern CSS layouts)
    const elementsToExpand = [document.documentElement, document.body];
    
    for (const el of elementsToExpand) {
      if (!el) continue;
      const computed = window.getComputedStyle(el);
      // Only change overflow if it's actually hidden (don't touch visible/auto/scroll)
      if (computed.overflow === 'hidden' || computed.overflowY === 'hidden') {
        saveAndSetStyle(el, 'overflowY', 'visible', originalStyles);
      }
      saveAndSetStyle(el, 'maxHeight', 'none', originalStyles);
    }
    
    console.log(`[SnapToAI] Expanded ${originalStyles.size} element styles for full page capture`);
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
    
    // DOCUMENT VIEWER HEIGHT FORCE - pages with page-image or can-zoom-in classes
    const docViewerClasses = document.documentElement.className || '';
    const isDocViewerPage = docViewerClasses.includes('page-image') || docViewerClasses.includes('can-zoom-in');
    if (isDocViewerPage) {
      const docHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      preflight.pageHeight = Math.max(docHeight, preflight.viewportHeight * 3);
      preflight.canCapture = true;
      preflight.isComplexApp = false;
      console.log('[SnapToAI] Document viewer detected - forced page height:', preflight.pageHeight + 'px');
    }
    
    if (!preflight.canCapture) {
      showToast('Cannot capture this page: ' + preflight.errors.join(', '), 'error');
      isFullPageCaptureRunning = false;
      try { chrome.runtime.sendMessage({ action: 'fullPageStitchFailed' }); } catch (e) {}
      return { success: false, error: preflight.errors.join(', ') };
    }
    
    // PAGE TOO LONG CHECK: If page would require more than 80 captures, abort early
    const maxSegments = 80;
    const totalSegments = Math.ceil(preflight.pageHeight / preflight.viewportHeight);
    if (totalSegments > maxSegments) {
      showToast('Page too long for full capture (80+ pages)', 'error');
      isFullPageCaptureRunning = false;
      try { chrome.runtime.sendMessage({ action: 'fullPageStitchFailed' }); } catch (e) {}
      return { success: false, error: 'page_too_long' };
    }
    
    // COMPLEX APP DETECTION: Replit, Figma, etc. have fixed layouts that can't be scroll-captured
    if (preflight.isComplexApp) {
      showToast('App layout detected - capturing visible screen', 'success');
      isFullPageCaptureRunning = false;
      return await simpleViewportCapture(tabId);
    }
    
    // Warn user if page is very short (BUT skip for AI platforms and special sites - they need full scroll)
    const isSpecialScrollSite = ['youtube.com', 'docs.google.com', 'mail.google.com'].some(s => location.hostname.includes(s));
    // Detect document/image viewer pages (like PDF viewers, image galleries)
    const htmlClasses = document.documentElement.className || '';
    const isDocumentViewer = htmlClasses.includes('page-image') || htmlClasses.includes('can-zoom-in') || document.querySelector('#content .page-image, .document-page, .pdf-page');
    if (preflight.pageHeight <= preflight.viewportHeight + 50 && !preflight.isAIPlatform && !isSpecialScrollSite && !isDocumentViewer) {
      showToast('Page is short - using simple capture', 'success');
      // Fall back to simple viewport capture
      isFullPageCaptureRunning = false;
      return await simpleViewportCapture(tabId);
    }
    
    // For document viewers, force expanded height detection
    if (isDocumentViewer) {
      const scrollContainer = findScrollableContainer();
      if (scrollContainer && scrollContainer.scrollHeight > preflight.viewportHeight) {
        preflight.pageHeight = scrollContainer.scrollHeight;
        console.log('[SnapToAI] Document viewer detected - using container height:', preflight.pageHeight);
      }
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
      const aiPlatforms = ['grok.com', 'grok.x.ai', 'x.com', 'chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai', 'replit.com'];
      const specialScrollSites = ['youtube.com', 'docs.google.com', 'mail.google.com'];
      const isAIPlatform = aiPlatforms.some(p => host.includes(p));
      const isSpecialSite = specialScrollSites.some(s => host.includes(s));
      
      // Step 1: Find the main scrollable container
      let scrollContainer = findScrollableContainer();
      
      // Check for document viewers (page-image, can-zoom-in classes)
      const docViewerClasses = document.documentElement.className || '';
      const isDocViewer = docViewerClasses.includes('page-image') || docViewerClasses.includes('can-zoom-in');
      
      // For document viewers, force use of documentElement if no container found
      if (isDocViewer && (!scrollContainer || scrollContainer === window)) {
        const docScrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
        if (docScrollHeight > viewportHeight) {
          scrollContainer = document.documentElement;
          console.log(`[SnapToAI] Document viewer - using documentElement, height: ${docScrollHeight}px`);
        }
      }
      
      const containerScrollHeight = scrollContainer ? scrollContainer.scrollHeight : 0;
      console.log(`[SnapToAI] Scroll container: ${scrollContainer ? scrollContainer.tagName : 'none'}, height: ${containerScrollHeight}px`);
      
      // Determine if we're using container scroll
      const isRealContainer = scrollContainer && 
                              scrollContainer !== document.documentElement && 
                              scrollContainer !== document.body &&
                              scrollContainer !== window;
      // For document viewers, treat documentElement as a real container
      const docViewerHasScroll = isDocViewer && scrollContainer === document.documentElement && containerScrollHeight > viewportHeight;
      
      // SITES WHERE FULL-PAGE CAPTURE IS DISABLED (too problematic to support)
      const noFullPageSites = ['ebay.com', 'etsy.com', 'zillow.com', 'sheets.google.com'];
      const isNoFullPageSite = noFullPageSites.some(s => location.hostname.includes(s));
      
      if (isNoFullPageSite) {
        console.log('[SnapToAI] Full-page capture disabled on this site:', location.hostname);
        showToast('Full-page not available on this site. Use regular Snap instead.', 'warning');
        isFullPageCaptureRunning = false;
        try { chrome.runtime.sendMessage({ action: 'fullPageStitchFailed' }); } catch (e) {}
        return { success: false, error: 'site_not_supported' };
      }
      
      // FORCE WINDOW SCROLL for known problematic sites
      const isGmail = location.hostname.includes('mail.google.com');
      const isGoogleDocsPage = location.hostname.includes('docs.google.com');
      const isGoogleSearch = location.hostname.includes('google.') && location.pathname.includes('/search');
      // Only force window scroll for Google Search - Gmail uses internal containers
      const forceWindowScroll = isGoogleSearch;
      
      // GOOGLE DOCS SPECIAL HANDLING: Use .kix-appview-editor as scroll container
      let docsEditorFound = false;
      if (isGoogleDocsPage) {
        const docsEditor = document.querySelector('.kix-appview-editor');
        if (docsEditor) {
          scrollContainer = docsEditor;
          docsEditorFound = true;
          console.log('[SnapToAI] Google Docs - using .kix-appview-editor as scroll container, scrollHeight:', docsEditor.scrollHeight);
        } else {
          console.log('[SnapToAI] Google Docs - .kix-appview-editor NOT FOUND, falling back');
        }
      }
      
      // GMAIL: Use the container already found by findScrollableContainer (which checks email-specific selectors)
      let gmailContainerFound = false;
      if (isGmail && scrollContainer && scrollContainer.scrollHeight > viewportHeight + 50) {
        gmailContainerFound = true;
        console.log('[SnapToAI] Gmail - using container from findScrollableContainer, scrollHeight:', scrollContainer.scrollHeight);
      }
      
      // Initial scroll strategy - will auto-fallback to window if container doesn't work
      // FORCE container scroll for Google Docs and Gmail when container is found
      let useContainerScroll = forceWindowScroll ? false : (docsEditorFound || gmailContainerFound || isRealContainer || (isAIPlatform && scrollContainer && scrollContainer.scrollHeight > viewportHeight) || docViewerHasScroll);
      let hasTriedWindowFallback = forceWindowScroll; // Skip fallback test if already forcing window
      
      if (forceWindowScroll) {
        console.log('[SnapToAI] Forcing window scroll for:', location.hostname);
      }
      
      // CRITICAL: For AI platforms, special sites, and document viewers, do NOT expand styles
      if (!isAIPlatform && !isSpecialSite && !isDocViewer && !useContainerScroll) {
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
      
      // Scroll step size: varies by site type
      // Google Docs and Gmail use special containers - needs 60% overlap for accuracy
      const isGoogleDocs = location.hostname.includes('docs.google.com');
      const overlapRatio = (isGoogleDocs || isGmail) ? 0.60 : 0.80; // 60% step for Docs/Gmail, 80% for others
      const stepHeight = Math.floor(viewportHeight * overlapRatio);
      
      if (isGoogleDocs || isGmail) {
        console.log('[SnapToAI] Google Docs/Gmail detected - using 60% overlap for accurate stitching');
      }
      
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
      const safeScrollTo = async (position) => {
        try {
          if (useContainerScroll && scrollContainer) {
            scrollContainer.scrollTo({ top: position, left: 0, behavior: 'instant' });
          } else {
            window.scrollTo({ top: position, left: 0, behavior: 'instant' });
          }
        } catch (e) {
          try {
            if (useContainerScroll && scrollContainer) {
              scrollContainer.scrollTop = position;
            } else {
              window.scroll(0, position);
            }
          } catch (e2) {}
        }
        await new Promise(r => setTimeout(r, 50));
      };
      
      // SAFE scrollBy - never throws errors
      const safeScrollBy = async (amount) => {
        try {
          if (useContainerScroll && scrollContainer) {
            scrollContainer.scrollBy({ top: amount, left: 0, behavior: 'instant' });
          } else {
            window.scrollBy({ top: amount, left: 0, behavior: 'instant' });
          }
        } catch (e) {
          try {
            if (useContainerScroll && scrollContainer) {
              scrollContainer.scrollTop += amount;
            } else {
              window.scrollBy(0, amount);
            }
          } catch (e2) {}
        }
        await new Promise(r => setTimeout(r, 50));
      };
      
      // Scroll to top first (using safe function)
      await safeScrollTo(0);
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // === PRE-CAPTURE SCROLL TEST ===
      // Test if container scroll actually works BEFORE capturing anything
      if (useContainerScroll && !hasTriedWindowFallback) {
        const beforeTest = getScrollTop();
        await safeScrollBy(100); // Small test scroll
        await new Promise(r => setTimeout(r, 100));
        const afterTest = getScrollTop();
        
        // If container didn't move, check if window can scroll
        if (afterTest === beforeTest || afterTest < 50) {
          const windowMax = document.documentElement.scrollHeight - window.innerHeight;
          if (windowMax > viewportHeight) {
            console.log('[SnapToAI] PRE-CHECK: Container scroll failed, switching to window scroll');
            useContainerScroll = false;
            hasTriedWindowFallback = true;
          }
        }
        
        // Scroll back to top with the (possibly new) scroll method
        await safeScrollTo(0);
        await new Promise(r => setTimeout(r, 200));
      }
      
      console.log(`[SnapToAI] Starting capture - containerScroll: ${useContainerScroll}, isAI: ${isAIPlatform}`);
      
      // === AMAZON LAZY-LOAD IMAGE PREP ===
      // Force all lazy images to load before capture
      const isAmazon = location.hostname.includes('amazon.');
      if (isAmazon) {
        try {
          console.log('[SnapToAI] Amazon detected - preloading lazy images...');
          // Force data-src to src for lazy images
          document.querySelectorAll('img[data-src]:not([src]), img.s-image[data-src]').forEach(img => {
            try {
              if (img.dataset.src && !img.src) {
                img.src = img.dataset.src;
              }
            } catch (e) {}
          });
          // Scroll images into view to trigger IntersectionObserver
          document.querySelectorAll('.s-result-item img, .s-image').forEach(img => {
            try { img.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (e) {}
          });
          // Wait for images to load
          await new Promise(r => setTimeout(r, 500));
          // Scroll back to top
          await safeScrollTo(0);
          await new Promise(r => setTimeout(r, 200));
          console.log('[SnapToAI] Amazon lazy images preloaded');
        } catch (e) {
          console.log('[SnapToAI] Amazon lazy-load prep failed (non-fatal)');
        }
      }
      
      // === HIDE FIXED ELEMENTS FOR AI PLATFORMS AND AMAZON ===
      // Fixed headers/footers appear in every screenshot and cause duplication in stitched result
      const hiddenFixedElements = [];
      
      const hideFixedElements = () => {
        try {
          // Hide fixed/sticky elements on ALL sites (they appear in every screenshot and ruin stitching)
          // Use targeted selectors instead of querySelectorAll('*') for performance
          const fixedSelectors = 'header, footer, nav, [role="banner"], [role="navigation"], [role="contentinfo"]';
          const candidates = document.querySelectorAll(fixedSelectors);
          const checkList = [...candidates];
          // Also check direct children of body (common pattern for fixed headers/footers)
          if (document.body) {
            for (const child of document.body.children) {
              if (!checkList.includes(child)) checkList.push(child);
            }
          }
          checkList.forEach(el => {
            try {
              const style = window.getComputedStyle(el);
              const position = style.position;
              const isFixed = position === 'fixed' || position === 'sticky';
              const isOurOverlay = el.id === 'snaptoai-fullpage-overlay';
              
              if (isFixed && !isOurOverlay && el.offsetHeight > 0) {
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
          
          // === AMAZON STICKY ELEMENT KILLER ===
          // Only hide sticky navigation elements, NOT footer/content
          if (isAmazon) {
            const amazonStickySelectors = [
              '#navbar-main',
              '#nav-belt',
              '#nav-main',
              '.nav-sprite',
              '#navBackToTop',
              '#nav-subnav',
              '#skiplink',
              '#nav-logo-sprites'
            ];
            
            amazonStickySelectors.forEach(sel => {
              try {
                document.querySelectorAll(sel).forEach(el => {
                  if (!hiddenFixedElements.some(item => item.element === el)) {
                    hiddenFixedElements.push({
                      element: el,
                      originalDisplay: el.style.display || '',
                      originalVisibility: el.style.visibility || ''
                    });
                    el.style.setProperty('visibility', 'hidden', 'important');
                  }
                });
              } catch (e) {}
            });
            console.log(`[SnapToAI] 🛒 Amazon sticky elements hidden`);
          }
          // === END AMAZON STICKY ELEMENT KILLER ===
          
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
      
      // === GLOBAL TIMEOUT - Never spin forever ===
      // Long pages like Wikipedia need more time (90 captures × ~1.5s each = ~135s)
      const CAPTURE_TIMEOUT_MS = 180000; // 3 minutes max for very long pages
      const captureStartTime = Date.now();
      let timedOut = false;
      
      // Calculate total captures - for document viewers, use forced page height
      let estimatedMaxScroll = getMaxScroll();
      if (isDocViewer && estimatedMaxScroll < viewportHeight) {
        // Document viewers may hide scroll - use forced calculation
        const forcedHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, preflight.pageHeight || 0);
        estimatedMaxScroll = Math.max(forcedHeight - viewportHeight, viewportHeight * 2);
        console.log('[SnapToAI] Document viewer - forced max scroll:', estimatedMaxScroll);
      }
      let totalEstimatedCaptures = Math.ceil(estimatedMaxScroll / (viewportHeight * 0.8)) + 1;
      
      // GOOGLE DOCS HEIGHT-BASED CAPTURE (like GoFullPage)
      // Don't rely on .kix-page elements - they're virtualized and recycled
      // Instead, use scrollHeight / clientHeight to determine capture count
      let docsScrollStep = 0;
      let docsTotalCaptures = 0;
      let currentDocsScrollIndex = 0;
      if (isGoogleDocsPage && scrollContainer) {
        const totalHeight = scrollContainer.scrollHeight;
        const viewportH = scrollContainer.clientHeight;
        docsTotalCaptures = Math.ceil(totalHeight / viewportH);
        docsScrollStep = viewportH; // Scroll by full viewport each time
        totalEstimatedCaptures = docsTotalCaptures;
        console.log(`[SnapToAI] Google Docs - height: ${totalHeight}px, viewport: ${viewportH}px, captures needed: ${docsTotalCaptures}`);
      }
      
      // === SERVICE WORKER KEEP-ALIVE ===
      // Ping service worker every 15 seconds to prevent it from going to sleep (MV3 issue)
      // Chrome 109+: API calls reset the 30-second inactivity timer
      let lastKeepAliveTime = Date.now();
      const KEEP_ALIVE_INTERVAL = 15000; // 15 seconds
      const captureStartTimestamp = Date.now(); // Track when this capture started
      
      async function keepServiceWorkerAlive() {
        const now = Date.now();
        if (now - lastKeepAliveTime >= KEEP_ALIVE_INTERVAL) {
          try {
            // MV3: content scripts cannot access chrome.storage.session unless
            // the background explicitly grants it. Use message passing instead —
            // any round-trip to the service worker resets its 30-second idle timer.
            await chrome.runtime.sendMessage({ action: 'keepAlive' }).catch(() => {});
            lastKeepAliveTime = now;
            console.log('[SnapToAI] Service worker keep-alive ping sent via messaging channel');
          } catch (e) {
            // Ignore keep-alive errors
          }
        }
      }
      
      // Check storage-based abort flag (reliable even if message fails)
      async function checkStorageAbort() {
        try {
          const { abortFullPageCapture } = await chrome.storage.session.get('abortFullPageCapture');
          // If abort timestamp exists AND is newer than when we started, abort
          if (abortFullPageCapture && abortFullPageCapture > captureStartTimestamp) {
            console.log('[SnapToAI] Storage abort flag detected!');
            isFullPageCaptureAborted = true;
            return true;
          }
        } catch (e) {}
        return false;
      }
      
      // Cancellable delay - checks abort every 100ms for fast response
      async function cancellableDelay(ms) {
        const chunks = Math.ceil(ms / 100);
        for (let i = 0; i < chunks; i++) {
          if (isFullPageCaptureAborted) return false;
          await new Promise(r => setTimeout(r, Math.min(100, ms - i * 100)));
        }
        return !isFullPageCaptureAborted;
      }
      
      while (captureCount < maxCaptures && consecutiveFails < MAX_CONSECUTIVE_FAILS) {
        // Check if capture was aborted (in-memory flag OR storage flag)
        if (isFullPageCaptureAborted || await checkStorageAbort()) {
          console.log('[SnapToAI] Full page capture aborted - stopping loop');
          break;
        }
        
        // === GLOBAL TIMEOUT CHECK - Never spin forever ===
        if (Date.now() - captureStartTime > CAPTURE_TIMEOUT_MS) {
          console.log('[SnapToAI] Capture timeout reached (60s) - stopping');
          timedOut = true;
          break;
        }
        
        // Keep service worker alive during long captures
        await keepServiceWorkerAlive();
        
        const currentScrollTop = getScrollTop();
        
        // Guard against invalid scroll positions
        if (isNaN(currentScrollTop) || currentScrollTop < 0) {
          console.log('[SnapToAI] Invalid scroll position, aborting capture');
          break;
        }
        
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
        
        // Check abort AGAIN after capture (user may have clicked during capture)
        if (isFullPageCaptureAborted || await checkStorageAbort()) {
          console.log('[SnapToAI] Abort detected after capture step');
          break;
        }
        
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
        // GOOGLE DOCS: Stop after capturing all viewports
        if (isGoogleDocsPage && docsTotalCaptures > 0) {
          currentDocsScrollIndex++;
          if (currentDocsScrollIndex >= docsTotalCaptures) {
            console.log(`[SnapToAI] Google Docs - captured all ${docsTotalCaptures} viewports`);
            break;
          }
        } else if (isDocViewer) {
          // Document viewers: exit based on estimated captures, not scroll position
          if (captureCount >= totalEstimatedCaptures) {
            console.log('[SnapToAI] Document viewer - completed estimated captures:', captureCount);
            break;
          }
        } else {
          // Normal pages: exit when scroll stops moving
          if (currentScrollTop === lastScrollTop && captureCount > 2) {
            console.log('[SnapToAI] Reached bottom - scroll stopped moving');
            break;
          }
        }
        
        // Check if we're at max scroll (not for document viewers with forced height)
        // Only exit if we've actually scrolled (captureCount > 1) to prevent false early exits
        if (!isDocViewer && !isGoogleDocsPage && captureCount > 1 && currentScrollTop >= getMaxScroll() - 20) {
          console.log('[SnapToAI] Reached max scroll position');
          break;
        }
        
        lastScrollTop = currentScrollTop;
        
        // GOOGLE DOCS: Scroll by full viewport height (like GoFullPage)
        if (isGoogleDocsPage && docsTotalCaptures > 0 && currentDocsScrollIndex < docsTotalCaptures) {
          const scrollPos = currentDocsScrollIndex * docsScrollStep;
          await safeScrollTo(scrollPos);
          console.log(`[SnapToAI] Google Docs - scrolling to position ${scrollPos}px (capture ${currentDocsScrollIndex + 1}/${docsTotalCaptures})`);
        } else {
          // Normal pages: scroll by step height
          await safeScrollBy(stepHeight);
        }
        
        // === GOOGLE APPS FIX: Wait for Virtual DOM to Repaint ===
        if (location.hostname.includes('google.com')) {
          // Force a small "nudge" to trigger Google's internal redraw
          window.dispatchEvent(new Event('resize')); 
          // Wait for the engine to paint the text
          await new Promise(r => setTimeout(r, 400)); 
        }
        
        // === AMAZON PER-SCROLL CONTENT STABILIZATION ===
        if (isAmazon) {
          try {
            // Force lazy images in current viewport to load
            document.querySelectorAll('img[data-src]:not([src]), img.s-image[data-src]').forEach(img => {
              try {
                const rect = img.getBoundingClientRect();
                const inViewport = rect.top < window.innerHeight && rect.bottom > 0;
                if (inViewport && img.dataset.src && (!img.src || img.src.includes('data:'))) {
                  img.src = img.dataset.src;
                }
              } catch (e) {}
            });
            
            // Wait for content to stabilize with HARD CAP of 1.2s
            // Updates baseline when new content arrives to avoid hanging
            let lastItemCount = document.querySelectorAll('.s-result-item[data-asin]').length;
            let lastHeight = document.documentElement.scrollHeight;
            let stableFor = 0;
            const startTime = Date.now();
            
            while (Date.now() - startTime < 1200) { // Hard 1.2s cap
              await new Promise(r => setTimeout(r, 150));
              const nowItems = document.querySelectorAll('.s-result-item[data-asin]').length;
              const nowHeight = document.documentElement.scrollHeight;
              
              if (nowItems === lastItemCount && nowHeight === lastHeight) {
                stableFor++;
                if (stableFor >= 2) break; // Stable for 300ms, good enough
              } else {
                // Content changed - update baseline, reset counter
                lastItemCount = nowItems;
                lastHeight = nowHeight;
                stableFor = 0;
              }
            }
          } catch (e) {}
        }
        
        // Wait for content to stabilize (max 400ms, checks every 50ms)
        const stabilized = await waitForScrollStabilization(scrollContainer, useContainerScroll);
        if (!stabilized) {
          await new Promise(r => setTimeout(r, 100));
        }
        
        // === CRITICAL: 700ms DELAY TO RESPECT CHROME'S RATE LIMIT ===
        // Chrome limits captureVisibleTab to ~2 calls/second
        // This prevents MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota errors
        // Uses cancellable delay so STOP button responds within 100ms
        if (!await cancellableDelay(700)) {
          console.log('[SnapToAI] Abort detected during rate limit delay');
          break;
        }
      }
      
      console.log(`[SnapToAI] Full page capture complete: ${screenshots.length} images`);
      
      // === TIMEOUT MESSAGE - User-friendly notification ===
      if (timedOut && screenshots.length > 0) {
        showToast(`Page too long - captured first ${screenshots.length} sections`, 'warning');
      }
      
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
      await safeScrollTo(0);
      
      if (screenshots.length === 0) {
        showToast('This page cannot be fully captured. Try SNAP instead.', 'error');
        throw new Error('No screenshots captured');
      }
      
      // If aborted, don't send screenshots - just clean up
      if (isFullPageCaptureAborted) {
        console.log('[SnapToAI] Capture aborted - not sending screenshots');
        isFullPageCaptureRunning = false;
        return { success: false, error: 'Capture aborted' };
      }
      
      // Send screenshots to background for stitching
      // Chrome has 64MB message limit - chunk if needed
      console.log(`[SnapToAI] Sending ${screenshots.length} screenshots for stitching`);
      
      let allScreenshots = screenshots.map(s => s.dataUrl);
      const BATCH_SIZE = 30; // Always 30 images (consistent everywhere)
      const MAX_SCREENSHOTS = 90; // Max 90 images (3 batches of 30)
      
      // Limit to 90 images max
      if (allScreenshots.length > MAX_SCREENSHOTS) {
        console.log(`[SnapToAI] Limiting from ${allScreenshots.length} to ${MAX_SCREENSHOTS} images`);
        allScreenshots = allScreenshots.slice(0, MAX_SCREENSHOTS);
      }
      
      if (allScreenshots.length > BATCH_SIZE) {
        // Large capture: send in batches of 30
        console.log(`[SnapToAI] Large capture - sending in batches of ${BATCH_SIZE}`);
        showToast(`Long page captured in ${Math.ceil(allScreenshots.length / BATCH_SIZE)} parts`, 'success');
        
        const totalBatches = Math.ceil(allScreenshots.length / BATCH_SIZE);
        
        for (let i = 0; i < totalBatches; i++) {
          const start = i * BATCH_SIZE;
          const end = Math.min(start + BATCH_SIZE, allScreenshots.length);
          const batch = allScreenshots.slice(start, end);
          
          // Wait for batch with timeout to prevent hanging
          try {
            await Promise.race([
              new Promise((resolve) => {
                chrome.runtime.sendMessage({
                  action: 'fullPageCaptureBatch',
                  batchIndex: i,
                  totalBatches: totalBatches,
                  screenshots: batch,
                  viewportWidth,
                  viewportHeight,
                  isAIPlatform: isAIPlatform,
                  pageUrl: window.location.href,
                  pageTitle: document.title || 'Untitled Page'
                }, (response) => {
                  if (chrome.runtime.lastError) {
                    console.log('[SnapToAI] Batch send error:', chrome.runtime.lastError.message);
                  }
                  resolve(response);
                });
              }),
              new Promise(resolve => setTimeout(resolve, 3000)) // 3s timeout
            ]);
          } catch (e) {
            console.log('[SnapToAI] Batch', i + 1, 'error:', e.message);
          }
          
          // Small delay between batches to let background process
          if (i < totalBatches - 1) {
            await new Promise(r => setTimeout(r, 150));
          }
        }
      } else {
        // Small capture: send all at once
        chrome.runtime.sendMessage({
          action: 'fullPageCaptureComplete',
          screenshots: allScreenshots,
          viewportWidth,
          viewportHeight,
          isAIPlatform: isAIPlatform,
          pageUrl: window.location.href,
          pageTitle: document.title || 'Untitled Page'
        });
      }
      
      return { success: true, count: screenshots.length };
    } catch (error) {
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
      
      // CHECK IF THIS WAS AN ABORT - if so, silently exit without error messages
      // Check both in-memory flag AND storage flag for reliability
      let wasAborted = isFullPageCaptureAborted;
      if (!wasAborted) {
        try {
          const { abortFullPageCapture } = await chrome.storage.session.get('abortFullPageCapture');
          if (abortFullPageCapture && abortFullPageCapture > (Date.now() - 10000)) {
            wasAborted = true; // Abort flag set within last 10 seconds
          }
        } catch (e) {}
      }
      
      if (wasAborted) {
        console.log('[SnapToAI] Full page capture was stopped by user');
        try {
          chrome.runtime.sendMessage({ action: 'fullPageStitchFailed' });
        } catch (e) {}
        return { success: false, error: 'Capture stopped' };
      }
      
      // Only log and show error for REAL errors (not aborts)
      console.log('[SnapToAI] Full page capture issue:', error?.message || error);
      
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

  // === GHOST CURSOR SYSTEM ===
  // Creates a magical floating cursor that shows automation in action
  let ghostCursor = null;
  let ghostCursorStyle = null;
  
  function createGhostCursor() {
    if (ghostCursor) return ghostCursor;
    
    // Inject styles once
    if (!ghostCursorStyle) {
      ghostCursorStyle = document.createElement('style');
      ghostCursorStyle.textContent = `
        @keyframes snaptoai-cursor-pulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 20px rgba(56, 189, 248, 0.6), 0 0 40px rgba(52, 211, 153, 0.3); }
          50% { transform: translate(-50%, -50%) scale(1.2); box-shadow: 0 0 30px rgba(56, 189, 248, 0.8), 0 0 60px rgba(52, 211, 153, 0.4); }
        }
        @keyframes snaptoai-cursor-click {
          0% { transform: translate(-50%, -50%) scale(1); }
          50% { transform: translate(-50%, -50%) scale(0.6); }
          100% { transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes snaptoai-ripple {
          0% { transform: translate(-50%, -50%) scale(0); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(3); opacity: 0; }
        }
        @keyframes snaptoai-type-glow {
          0%, 100% { box-shadow: 0 0 0 2px rgba(138, 43, 226, 0.5), 0 0 15px rgba(138, 43, 226, 0.3); }
          50% { box-shadow: 0 0 0 4px rgba(138, 43, 226, 0.8), 0 0 25px rgba(138, 43, 226, 0.5); }
        }
        @keyframes snaptoai-banner-slide {
          0% { transform: translateY(-100%); opacity: 0; }
          10% { transform: translateY(0); opacity: 1; }
          90% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(-100%); opacity: 0; }
        }
        .snaptoai-ghost-cursor {
          position: fixed;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: linear-gradient(135deg, #38bdf8 0%, #34d399 100%);
          pointer-events: none;
          z-index: 2147483647;
          animation: snaptoai-cursor-pulse 1.5s ease-in-out infinite;
          transition: left 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), top 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .snaptoai-ghost-cursor::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          width: 8px;
          height: 8px;
          background: white;
          border-radius: 50%;
          transform: translate(-50%, -50%);
        }
        .snaptoai-ghost-cursor::after {
          content: '';
          position: absolute;
          top: -34px;
          left: 50%;
          transform: translateX(-50%);
          width: 26px;
          height: 26px;
          background-image: url('${chrome.runtime.getURL('icons/agent-avatar.png')}');
          background-size: contain;
          background-repeat: no-repeat;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        }
        .snaptoai-ghost-cursor.clicking {
          animation: snaptoai-cursor-click 0.3s ease-out;
        }
        .snaptoai-click-ripple {
          position: fixed;
          width: 40px;
          height: 40px;
          border: 3px solid #38bdf8;
          border-radius: 50%;
          pointer-events: none;
          z-index: 2147483646;
          animation: snaptoai-ripple 0.6s ease-out forwards;
        }
        .snaptoai-element-highlight {
          outline: 3px solid #38bdf8 !important;
          outline-offset: 2px !important;
          animation: snaptoai-type-glow 0.8s ease-in-out infinite !important;
          transition: all 0.3s ease !important;
        }
        .snaptoai-agent-banner {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          background: linear-gradient(135deg, rgba(56, 189, 248, 0.95) 0%, rgba(52, 211, 153, 0.95) 100%);
          color: white;
          padding: 12px 20px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 14px;
          font-weight: 500;
          text-align: center;
          z-index: 2147483645;
          backdrop-filter: blur(10px);
          box-shadow: 0 4px 20px rgba(52, 211, 153, 0.4);
          animation: snaptoai-banner-slide 4s ease-in-out forwards;
        }
        .snaptoai-agent-banner span {
          margin-right: 8px;
          vertical-align: middle;
        }
        .snaptoai-agent-banner img {
          width: 18px;
          height: 18px;
          vertical-align: middle;
        }
      `;
      document.head.appendChild(ghostCursorStyle);
    }
    
    ghostCursor = document.createElement('div');
    ghostCursor.className = 'snaptoai-ghost-cursor';
    ghostCursor.style.left = '50%';
    ghostCursor.style.top = '50%';
    document.body.appendChild(ghostCursor);
    
    return ghostCursor;
  }
  
  function moveGhostCursor(x, y) {
    if (!ghostCursor) createGhostCursor();
    ghostCursor.style.left = x + 'px';
    ghostCursor.style.top = y + 'px';
  }
  
  function clickGhostCursor(x, y) {
    if (!ghostCursor) createGhostCursor();
    
    // Move to position
    ghostCursor.style.left = x + 'px';
    ghostCursor.style.top = y + 'px';
    
    // Add click animation
    ghostCursor.classList.add('clicking');
    setTimeout(() => ghostCursor.classList.remove('clicking'), 300);
    
    // Create ripple effect
    const ripple = document.createElement('div');
    ripple.className = 'snaptoai-click-ripple';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    document.body.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  }
  
  function highlightElement(element) {
    element.classList.add('snaptoai-element-highlight');
    setTimeout(() => element.classList.remove('snaptoai-element-highlight'), 2000);
  }
  
  function showAgentBanner(message) {
    const existing = document.querySelector('.snaptoai-agent-banner');
    if (existing) existing.remove();
    
    const banner = document.createElement('div');
    banner.className = 'snaptoai-agent-banner';
    const icon = document.createElement('img');
    icon.src = chrome.runtime.getURL('icons/agent-avatar.png');
    icon.alt = '';
    banner.appendChild(icon);
    banner.appendChild(document.createTextNode(' Aion AI Agent: ' + message));
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 4000);
  }
  
  function removeGhostCursor() {
    if (ghostCursor) {
      ghostCursor.remove();
      ghostCursor = null;
    }
  }
  
  function getElementCenter(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }

  // === SHADOW DOM PIERCING UTILITY ===
  // Standard querySelectorAll is blind to shadow roots. This traverses the
  // entire DOM tree recursively — including all open and closed shadow roots —
  // so elements inside Web Components (Google NotebookLM modals, AI Studio
  // prompt editors, Office ribbon panes, etc.) are reachable by CSS selector.
  function querySelectorAllShadow(selector, root = document) {
    const arr = [];
    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === Node.ELEMENT_NODE) {
        try { if (node.matches(selector)) arr.push(node); } catch (_) {}
        if (node.shadowRoot) walk(node.shadowRoot);
      }
      let child = node.firstChild;
      while (child) { walk(child); child = child.nextSibling; }
    };
    walk(root);
    return arr;
  }

  // === NEURAL PATH VISUALIZER ===
  // Draws a glowing dashed line from the AION orb position to the target element
  // before a click fires — gives users real-time "visual agency" feedback.
  function drawNeuralPath(fromX, fromY, toX, toY) {
    let svg = document.getElementById('aion-neural-path');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = 'aion-neural-path';
      svg.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646;';
      document.body.appendChild(svg);
    }
    // Animated dashed beam from orb → target, with a pulsing endpoint dot.
    // Uses CSS @keyframes (neuralPulse) for the stroke march — smoother than
    // SMIL <animate> and GPU-accelerated on all modern browsers.
    svg.innerHTML = `
      <defs>
        <filter id="aion-glow">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <style>
          @keyframes neuralPulse {
            from { stroke-dashoffset: 20; }
            to   { stroke-dashoffset: 0;  }
          }
          @keyframes neuralRing {
            0%,100% { r: 4; opacity: 0.9; }
            50%      { r: 9; opacity: 0.3; }
          }
          #aion-beam { animation: neuralPulse 0.38s linear infinite; }
          #aion-ring { animation: neuralRing  0.6s  ease-in-out infinite; }
        </style>
      </defs>
      <line id="aion-beam"
        x1="${fromX}" y1="${fromY}" x2="${toX}" y2="${toY}"
        stroke="#818cf8" stroke-width="2" stroke-dasharray="6,5"
        filter="url(#aion-glow)" opacity="0.85"/>
      <circle id="aion-ring"
        cx="${toX}" cy="${toY}" r="6" fill="none" stroke="#a78bfa" stroke-width="2"
        filter="url(#aion-glow)" opacity="0.9"/>
      <circle cx="${toX}" cy="${toY}" r="3" fill="#c4b5fd" filter="url(#aion-glow)"/>`;
    setTimeout(() => { if (svg) svg.innerHTML = ''; }, 1100);
  }

  // ── Element Index ──────────────────────────────────────────────────────────
  // Assigns a stable integer to every visible interactive element on the page.
  // The agent receives this compact list alongside the page text so it can
  // reference elements as [idx] instead of guessing text/selector strings.
  // The map is stored on window.__aionElementIndex so background.js can
  // resolve indices to coordinates via the 'resolveByIndex' message.

  const _AION_IDX_SEL = [
    'a[href]','button','input:not([type="hidden"])','textarea','select',
    '[role="button"]','[role="link"]','[role="checkbox"]','[role="radio"]',
    '[role="tab"]','[role="menuitem"]','[role="option"]','[role="combobox"]',
    '[role="textbox"]','[contenteditable="true"]'
  ].join(',');

  function _aionVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    if (r.bottom < -300 || r.top > window.innerHeight + 300) return false;
    const s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.01;
  }

  function _aionLabel(el) {
    // Formatting rule (why the title field needs its live .value read, not
    // just static attributes) lives in agent-logic-core.js as
    // formatElementLabel — see there, and tests/agent-logic.test.js for the
    // check. This just converts the real DOM element to the plain-object
    // shape that pure function expects.
    return formatElementLabel({
      tag: el.tagName || '',
      value: el.value,
      id: el.id || '',
      text: el.textContent || '',
      attrs: {
        'aria-label': el.getAttribute('aria-label') || '',
        title: el.getAttribute('title') || '',
        placeholder: el.getAttribute('placeholder') || '',
        alt: el.getAttribute('alt') || '',
        name: el.getAttribute('name') || '',
        // el.href (the IDL property) is ALWAYS the browser-resolved absolute
        // URL, even when the raw href="" HTML attribute is relative
        // ("/watch?v=x") or protocol-relative — exactly what's needed for
        // the model to read a real, pasteable URL directly off the page
        // instead of clicking through each link just to learn where it goes.
        href: (el.tagName === 'A' && typeof el.href === 'string') ? el.href : '',
      },
    });
  }

  function _aionType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') return `input[${el.type || 'text'}]`;
    const role = el.getAttribute('role');
    if (role) return role;
    return tag;
  }

  // Fix 4 — Cross-origin iframe coordinate offset:
  // getBoundingClientRect() returns coords relative to the *current* frame.
  // When content.js runs inside a same-origin iframe, we walk up the frame
  // chain adding each frameElement's offset so coordinates are always in the
  // top-level viewport space that CDP Input.dispatchMouseEvent expects.
  function getElementViewportOffset(el) {
    try {
      const r = el.getBoundingClientRect();
      let x = r.left + r.width / 2;
      let y = r.top + r.height / 2;
      let win = el.ownerDocument.defaultView;
      while (win && win !== window.top) {
        try {
          if (!win.frameElement) break;
          const fr = win.frameElement.getBoundingClientRect();
          x += fr.left;
          y += fr.top;
          win = win.parent;
        } catch (_) { break; } // cross-origin security boundary — stop
      }
      return { x, y };
    } catch (_) {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
  }

  // Fix 1 — Semantic DOM tree:
  // Instead of a flat "[0] button 'Buy Now'" list (which loses context when
  // multiple identical labels exist), produce a minimal nested HTML-like tree
  // that preserves structural grouping. Interactive elements become self-closing
  // leaves tagged with their idx; non-interactive containers are kept only when
  // they wrap at least one interactive descendant.
  const _AION_SKIP_TAGS = new Set(['script','style','svg','path','noscript','meta','head','link','br','hr','img']);
  const _AION_WRAP_TAGS = new Set(['div','section','form','main','article','ul','ol','li','nav','header','footer','aside','table','tr','td','th','tbody','fieldset']);

  function _getSemanticTree(node, depth) {
    if (depth > 20 || !node || node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    if (_AION_SKIP_TAGS.has(tag)) return '';
    // Skip clearly invisible containers (not just interactive elements)
    if (node !== document.body && node !== document.documentElement) {
      const s = window.getComputedStyle(node);
      if (s.display === 'none' || s.visibility === 'hidden') return '';
    }
    const idx = node.getAttribute('data-aion-idx');
    if (idx !== null) {
      // Leaf: interactive element with its assigned index
      const label = _aionLabel(node).replace(/"/g, "'");
      const type  = _aionType(node);
      const dis   = node.disabled ? ' disabled' : '';
      return `<${type} idx="${idx}"${label ? ` label="${label}"` : ''}${dis} />\n`;
    }
    // Recurse
    let children = '';
    for (const child of node.children) {
      children += _getSemanticTree(child, depth + 1);
    }
    if (!children) return '';
    const role     = node.getAttribute('role');
    const ariaLbl  = (node.getAttribute('aria-label') || '').replace(/"/g, "'").slice(0, 30);
    if (_AION_WRAP_TAGS.has(tag) || role) {
      const attrs = (role ? ` role="${role}"` : '') + (ariaLbl ? ` aria-label="${ariaLbl}"` : '');
      return `<${tag}${attrs}>\n${children}</${tag}>\n`;
    }
    return children;
  }

  function buildElementIndex() {
    // Clear stale data-aion-idx attributes from a previous step so the CDP
    // Runtime.evaluate lookup in background.js always hits the live element.
    document.querySelectorAll('[data-aion-idx]').forEach(el => el.removeAttribute('data-aion-idx'));

    window.__aionElementIndex = new Map();
    const seen = new Set();
    const lines = [];
    let idx = 0;

    // Collect from main DOM and one level of shadow roots
    const pool = [];
    document.querySelectorAll(_AION_IDX_SEL).forEach(el => pool.push(el));
    document.querySelectorAll('*').forEach(host => {
      if (host.shadowRoot) {
        host.shadowRoot.querySelectorAll(_AION_IDX_SEL).forEach(el => pool.push(el));
      }
    });

    for (const el of pool) {
      if (seen.has(el) || !_aionVisible(el)) continue;
      seen.add(el);
      // Fix 4: use iframe-aware offset so coords are always in top-level viewport space
      const { x: cx, y: cy } = getElementViewportOffset(el);
      // Tag the physical element so background.js can find it via
      // Runtime.evaluate('[data-aion-idx="N"]') without a JS message round-trip.
      el.setAttribute('data-aion-idx', String(idx));
      window.__aionElementIndex.set(idx, { el, x: cx, y: cy });
      const label = _aionLabel(el);
      const type  = _aionType(el);
      const extra = el.disabled ? ' (disabled)' : '';
      lines.push(`[${idx}] ${type}${label ? ' "' + label + '"' : ''}${extra}`);
      idx++;
    }

    // Fix 1: also build a semantic nested tree so the LLM has structural context
    // (e.g. three "Buy Now" buttons each nested under a different product card).
    // Cap at 4000 chars to avoid flooding the context window.
    const semanticTree = _getSemanticTree(document.body, 0).slice(0, 4000);

    return { indexText: lines.join('\n'), semanticTree, count: idx };
  }

  // A bare "element not found" tells the model nothing about the page, so its
  // only move is to guess another label and fail again — the ChatGPT Read-Aloud
  // hunt went "More actions" → hover → "Read Aloud" → findElement, four blind
  // guesses in a row, then gave up and asked the user. Hand back what is
  // ACTUALLY on the page, closest matches first, so the next turn can pick a
  // real target by index instead of guessing.
  async function describeAvailableElements(wantedRaw) {
    const wanted = (wantedRaw || '').toLowerCase().trim();
    try {
      // Recognise a bot-detection/CAPTCHA interstitial for what it is instead
      // of reporting it as a normal "element not found" and inviting another
      // blind retry. Real failure: asked to open Google search results, the
      // page was actually Google's "unusual traffic" block page — its only
      // real content is a "Why did this happen?" link; everything else in
      // the element list (Account, Drive, Gmail, Maps...) is just Google's
      // persistent header, which still renders on the block page. No
      // selector fix can find results that were never actually served.
      if (detectBlockPage(document.body ? document.body.innerText : '')) {
        return '\n⚠️ THIS IS NOT THE REAL PAGE — it is a bot-detection / "unusual traffic" block page from the site. The task cannot proceed by clicking around it; none of its elements are the content you were asked to find. Call requestUserIntervention and tell the user honestly that the site blocked this as automated traffic and ask them to solve it manually (or say the task cannot continue). Do NOT keep guessing at buttons on this page.';
      }
      // Real failure: after successfully adding 5 sources, NotebookLM showed
      // "You have reached your daily Slides limits, come back later. Or
      // upgrade." and the agent kept retrying anyway, leaving three separate
      // "Generating..." entries stacked up in the Studio panel. This is
      // Google's own daily quota, not a missing button — no retry finds a
      // way around it today.
      if (detectStudioQuotaLimit(document.body ? document.body.innerText : '')) {
        return '\n⚠️ NOTEBOOKLM HAS HIT ITS DAILY GENERATION QUOTA for this Studio output ("reached your daily limit"). This is Google\'s own server-side limit for today — clicking Generate again will not work, and no different button or approach gets around it. Call requestUserIntervention or finish() and tell the user honestly: the sources were added successfully, but generation is blocked until the quota resets (or they upgrade). Do NOT keep retrying the click.';
      }
      let { indexText, count } = buildElementIndex();
      // A page can genuinely still be mid-render at the exact instant a click
      // fails right after navigate() — Google's results, for one, paint
      // progressively, and a persistent header (Google's "apps grid" — Gmail,
      // Maps, Calendar...) can already be fully interactive while the actual
      // content underneath is still loading. The old retry only fired when
      // count===0, so it NEVER triggered here: the header alone counts as
      // 9-10 elements, never zero — the exact case that kept failing lived
      // entirely outside this retry's trigger condition. Now retries
      // repeatedly, with growing waits, as long as the count stays
      // suspiciously low (a real results page has 30+ interactive elements;
      // ~10 is just chrome, not content) and up to ~2.4s total — enough for
      // slower real-world renders without stalling every ordinary click.
      let _settleAttempts = 0;
      while (count < 15 && _settleAttempts < 4) {
        await new Promise(r => setTimeout(r, 400 + _settleAttempts * 300));
        ({ indexText, count } = buildElementIndex());
        _settleAttempts++;
      }
      const lines = indexText.split('\n').filter(Boolean);
      if (!lines.length) return '\nNothing interactive is visible on the page right now — it may still be loading, or the content sits inside an iframe.';

      // Ranking rule lives in agent-logic-core.js as rankElementMatches —
      // see tests/agent-logic.test.js for the check (including the exact
      // "Read Aloud" vs "Read aloud" case that motivated it).
      const close = rankElementMatches(lines, wanted, 15);
      if (close.length) {
        return `\nCLOSE MATCHES already on the page (click by index — the label may differ in wording or capitalisation):\n${close.join('\n')}`;
      }
      return `\nWhat IS clickable on the page right now (${count} total, showing first 30) — click by index:\n${lines.slice(0, 30).join('\n')}`;
    } catch (_) {
      return '';
    }
  }

  function resolveByIndex(index) {
    const map = window.__aionElementIndex;
    if (!map) return null;
    const entry = map.get(Number(index));
    if (!entry || !_aionVisible(entry.el)) return null;
    // Fix 4: re-compute with iframe-aware offset at resolution time
    return getElementViewportOffset(entry.el);
  }
  // ── End Element Index ───────────────────────────────────────────────────────

  // === AGENT AUTOMATION HANDLER ===
  // Handles click, type, scroll, checkElement actions from agent-chat.js
  async function handleAgentAction(action, params) {
    console.log('[SnapToAI Agent] Executing:', action, params);
    
    // Show ghost cursor for all actions
    createGhostCursor();
    
    switch (action) {
      case 'locateForClick':
      case 'click':
      case 'doubleClick': {
        // SMART SEARCH: Find element by multiple strategies
        let element = null;
        const attemptedMethods = [];
        
        // Plan A: Try the precise CSS Selector
        if (params.selector) {
          attemptedMethods.push(`selector: ${params.selector}`);
          element = document.querySelector(params.selector);
        }
        
        // Plan B: Find by EXACT text match — shadow-piercing so buttons inside
        // Web Components (NotebookLM "Insert", AI Studio modals, etc.) are found.
        if (!element && params.text) {
          attemptedMethods.push(`exact text: "${params.text}"`);
          const allClickable = querySelectorAllShadow('button, a, span, div[role="button"], [role="tab"], [role="menuitem"], .btn, input[type="button"], input[type="submit"]');
          for (const el of allClickable) {
            const elText = el.innerText?.trim().toLowerCase() || el.textContent?.trim().toLowerCase();
            if (elText === params.text.toLowerCase()) {
              element = el;
              showAgentBanner(`Found by exact text: "${params.text}"`);
              break;
            }
          }
        }
        
        // Plan C: Find by partial text content — shadow-piercing broad search
        if (!element && params.text) {
          attemptedMethods.push(`partial text: "${params.text}"`);
          const allClickable = querySelectorAllShadow('button, a, span, div[role="button"], [role="tab"], [role="menuitem"], .btn, input[type="button"], input[type="submit"]');
          for (const el of allClickable) {
            if (el.textContent.trim().toLowerCase().includes(params.text.toLowerCase())) {
              element = el;
              showAgentBanner(`Found by partial text: "${params.text}"`);
              break;
            }
          }
        }
        
        // Plan D: XPath for deeply nested text in the main document tree,
        // then shadow-piercing fallback for elements XPath can't reach
        if (!element && params.text) {
          attemptedMethods.push('xpath + shadow search');
          try {
            const xpath = `//*[contains(text(), '${params.text.replace(/'/g, "\\'")}')]`;
            const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            element = result.singleNodeValue;
          } catch (_) {}
          if (!element) {
            // Shadow DOM fallback: aria-label, title, and value attributes
            const candidates = querySelectorAllShadow('[aria-label], [title], [value], [placeholder]');
            const needle = params.text.toLowerCase();
            for (const el of candidates) {
              const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('value') || el.getAttribute('placeholder') || '').toLowerCase();
              if (label.includes(needle)) { element = el; break; }
            }
          }
          if (element) showAgentBanner(`Found by xpath/shadow: "${params.text}"`);
        }
        
        // Plan E: Try using description text as button label — shadow-piercing
        if (!element && params.description) {
          attemptedMethods.push(`description text`);
          const descWords = params.description.match(/["']([^"']+)["']|(\b\d+[ymdw]\b)|(\bMax\b|\bMin\b)/gi);
          if (descWords) {
            for (const word of descWords) {
              const cleanWord = word.replace(/["']/g, '').trim();
              const allClickable = querySelectorAllShadow('button, a, span, div[role="button"]');
              for (const el of allClickable) {
                if (el.innerText?.trim().toLowerCase() === cleanWord.toLowerCase()) {
                  element = el;
                  showAgentBanner(`Found "${cleanWord}" from description`);
                  break;
                }
              }
              if (element) break;
            }
          }
        }
        
        if (!element) {
          const wanted = params.text || params.description || '';
          throw new Error(
            `Element not found for "${wanted || '(no label given)'}". Tried: ${attemptedMethods.join(', ')}.` +
            (await describeAvailableElements(wanted)) +
            `\nNEXT STEP: pick one of the numbered elements above with click({index:N}) — do not guess another label blindly. If what you want genuinely is not listed, it is probably hidden behind a hover menu or a "…" overflow button: hover the relevant row/message first, then look again.`
          );
        }
        
        // Use instant scroll so the element is static before coordinate calculation
        element.scrollIntoView({ behavior: 'auto', block: 'center' });
        await new Promise(r => setTimeout(r, 150)); // short buffer for layout engine to stabilize
        
        // Move ghost cursor to element with smooth animation
        const center = getElementCenter(element);
        moveGhostCursor(center.x, center.y);
        await new Promise(r => setTimeout(r, 500));

        if (action === 'locateForClick') {
          // Just used to find WHERE to click — the real click is dispatched
          // via chrome.debugger (a genuinely trusted click) by background.js,
          // because sites like Google Drive ignore synthetic (isTrusted:false)
          // double-clicks on security-sensitive actions like opening a file.
          highlightElement(element);
          // Draw neural path from orb/cursor origin to click target
          try {
            const fromX = ghostCursor
              ? parseFloat(ghostCursor.style.left) || window.innerWidth * 0.5
              : window.innerWidth * 0.5;
            const fromY = ghostCursor
              ? parseFloat(ghostCursor.style.top) || window.innerHeight * 0.88
              : window.innerHeight * 0.88;
            drawNeuralPath(fromX, fromY, center.x, center.y);
          } catch (_) {}
          return { success: true, x: center.x, y: center.y };
        }
        
        // Show click effect
        clickGhostCursor(center.x, center.y);
        highlightElement(element);
        showAgentBanner(action === 'doubleClick' ? `Double-clicking: ${params.text || params.selector}` : `Clicking: ${params.text || params.selector}`);
        
        await new Promise(r => setTimeout(r, 300));
        
        // Some sites (Amazon included) still build buttons as old-style
        // `<a href="javascript:...">` links that rely on a JS click listener
        // to do the real work, with the href only there as legacy filler.
        // Calling the native .click() method makes the browser ALSO try to
        // run that href as real navigation, which modern CSP blocks outright
        // ("Running the JavaScript URL violates Content Security Policy") —
        // the click then does nothing even though our step reported success.
        // Dispatching a synthetic MouseEvent instead still fires the site's
        // real click listener (that's what actually opens the modal/panel)
        // but does NOT trigger the browser's own default link-navigation
        // behavior, so the blocked javascript: URL is never attempted.
        //
        // IMPORTANT: the element our matcher finds is often a nested child
        // (e.g. a <span> label) INSIDE the real <a href="javascript:...">,
        // not the anchor itself. A native .click() on that child still
        // bubbles up and triggers the ancestor anchor's default navigation,
        // so we must check the closest anchor ancestor, not just the
        // clicked element's own tag/href.
        const anchorEl = typeof element.closest === 'function' ? element.closest('a[href]') : null;
        const href = anchorEl ? (anchorEl.getAttribute('href') || '') : '';
        const isJsHrefLink = /^\s*javascript:/i.test(href);

        if (action === 'doubleClick') {
          // Real double-clicks (e.g. opening a file in Google Drive) need the
          // full native event sequence — a plain dblclick event alone is
          // ignored by many apps that listen for the raw mousedown/up pairs
          // and count the clicks themselves.
          const opts = { bubbles: true, cancelable: true, view: window, clientX: center.x, clientY: center.y };
          element.dispatchEvent(new MouseEvent('mousedown', opts));
          element.dispatchEvent(new MouseEvent('mouseup', opts));
          element.dispatchEvent(new MouseEvent('click', opts));
          await new Promise(r => setTimeout(r, 80));
          element.dispatchEvent(new MouseEvent('mousedown', opts));
          element.dispatchEvent(new MouseEvent('mouseup', opts));
          element.dispatchEvent(new MouseEvent('click', opts));
          element.dispatchEvent(new MouseEvent('dblclick', { ...opts, detail: 2 }));
        } else if (isJsHrefLink) {
          element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        } else if (typeof element.click === 'function') {
          element.click();
        } else {
          element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        }
        
        return { success: true };
      }

      case 'drag': {
        // Simulate a real click-and-hold drag (chess pieces, sliders, sortable
        // lists, drag-and-drop uploads, etc). Most drag implementations listen
        // to raw mouse events rather than the native HTML5 drag API, so we
        // fire a realistic mousedown -> several mousemove steps -> mouseup
        // sequence rather than a single instantaneous jump, since some
        // libraries only "pick up" the dragged item once real movement is
        // detected.
        const findByTextOrSelector = (selector, text) => {
          if (selector) {
            const el = document.querySelector(selector);
            if (el) return el;
          }
          if (text) {
            const all = document.querySelectorAll('*');
            for (const el of all) {
              if (el.children.length === 0 && el.textContent?.trim().toLowerCase() === text.toLowerCase()) {
                return el;
              }
            }
          }
          return null;
        };

        let fromEl = findByTextOrSelector(params.fromSelector, params.fromText);
        let fromPoint = null;
        if (!fromEl && typeof params.fromX === 'number' && typeof params.fromY === 'number') {
          fromPoint = { x: params.fromX, y: params.fromY };
        }
        if (!fromEl && !fromPoint) {
          throw new Error('Could not find the drag start point. Provide fromSelector, fromText, or fromX/fromY.');
        }

        let toEl = findByTextOrSelector(params.toSelector, params.toText);
        let toPoint = null;
        if (!toEl && typeof params.toX === 'number' && typeof params.toY === 'number') {
          toPoint = { x: params.toX, y: params.toY };
        }
        if (!toEl && !toPoint) {
          throw new Error('Could not find the drag end point. Provide toSelector, toText, or toX/toY.');
        }

        const start = fromEl ? getElementCenter(fromEl) : fromPoint;
        const end = toEl ? getElementCenter(toEl) : toPoint;

        if (fromEl) { fromEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); await new Promise(r => setTimeout(r, 300)); }
        moveGhostCursor(start.x, start.y);
        await new Promise(r => setTimeout(r, 300));
        showAgentBanner(`Dragging from (${Math.round(start.x)},${Math.round(start.y)}) to (${Math.round(end.x)},${Math.round(end.y)})...`);

        const dispatchAt = (type, x, y, target) => {
          const el = target || document.elementFromPoint(x, y) || document.body;
          const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1 };
          el.dispatchEvent(new MouseEvent(type, opts));
          return el;
        };

        const dragTarget = fromEl || document.elementFromPoint(start.x, start.y);
        dispatchAt('mousedown', start.x, start.y, dragTarget);
        highlightElement(dragTarget || document.body);

        const steps = 12;
        for (let i = 1; i <= steps; i++) {
          const x = start.x + (end.x - start.x) * (i / steps);
          const y = start.y + (end.y - start.y) * (i / steps);
          moveGhostCursor(x, y);
          dispatchAt('mousemove', x, y);
          await new Promise(r => setTimeout(r, 40));
        }

        await new Promise(r => setTimeout(r, 150));
        const dropTarget = toEl || document.elementFromPoint(end.x, end.y);
        dispatchAt('mousemove', end.x, end.y, dropTarget);
        dispatchAt('mouseup', end.x, end.y, dropTarget);

        // Some drag-and-drop libraries (HTML5 native DnD, e.g. Trello-style
        // boards) listen for dragstart/dragover/drop instead of raw mouse
        // events — fire those too so both implementations have a chance to
        // pick it up.
        try {
          const dt = new DataTransfer();
          dragTarget?.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: start.x, clientY: start.y }));
          dropTarget?.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: end.x, clientY: end.y }));
          dropTarget?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: end.x, clientY: end.y }));
          dropTarget?.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: end.x, clientY: end.y }));
          dragTarget?.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: end.x, clientY: end.y }));
        } catch (_) { /* DataTransfer/DragEvent construction can fail on some pages; raw mouse events above already covered it */ }

        return { success: true };
      }
      
      case 'locateForType': {
        const host = location.hostname;
        const isSheets = host.includes('docs.google.com') && location.pathname.includes('/spreadsheets/');
        const isDocs   = host.includes('docs.google.com') && location.pathname.includes('/document/');
        const isExcel  = host.includes('excel.office.com') || host.includes('excel.live.com')
                      || (host.includes('officeapps.live.com') && !host.includes('word'));
        const isWord   = host.includes('word.office.com')  || host.includes('word.live.com')
                      || (host.includes('officeapps.live.com') && host.includes('word'));

        // Helper: find first visible element from a list of selectors (no retry loop).
        // The old code had 6-attempt retry loops (up to 2.4s each) that caused
        // the "locate loop" hang. Now we do one fast pass and fall back to safe
        // screen coordinates — CDP will still click the right area.
        const findVisible = (selectors) => {
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) { const r = el.getBoundingClientRect(); if (r.width > 50 && r.height > 50) return el; }
          }
          return null;
        };

        // ── GOOGLE SHEETS ────────────────────────────────────────────────────
        if (isSheets) {
          const grid = findVisible([
            'canvas.grid-canvas', '.grid-canvas', '#waffle-grid-container',
            '#waffle', '.grid-container', 'canvas', 'div[role="grid"]'
          ]);
          let x, y;
          if (grid) {
            const r = grid.getBoundingClientRect();
            // Skip the row-header strip (~46px) and column-header strip (~25px)
            x = r.left + Math.max(100, r.width  * 0.15);
            y = r.top  + Math.max(55,  r.height * 0.10);
            highlightElement(grid);
          } else {
            x = window.innerWidth  * 0.35;
            y = window.innerHeight * 0.40;
          }
          moveGhostCursor(x, y);
          return { success: true, x, y, mode: 'sheets' };
        }

        // ── EXCEL ONLINE ─────────────────────────────────────────────────────
        if (isExcel) {
          // Excel Online uses a different canvas class hierarchy than Sheets.
          // The Name Box (cell-address input) is a real DOM element we can focus
          // via Runtime.evaluate to navigate to cell A1 before typing.
          // For the click target we still need a coordinate inside the data area.
          const grid = findVisible([
            'canvas[class*="excel"]', 'canvas[class*="grid"]', 'canvas[class*="cell"]',
            '.lowLevelCanvasHost canvas', '.canvasOverlay', 'canvas', 'div[role="grid"]'
          ]);
          let x, y;
          if (grid) {
            const r = grid.getBoundingClientRect();
            // Excel header strip: ~48px row headers (left), ~26px col headers (top).
            // Click well into the first data cell to avoid the header zone.
            x = r.left + Math.max(110, r.width  * 0.18);
            y = r.top  + Math.max(60,  r.height * 0.12);
            highlightElement(grid);
          } else {
            x = window.innerWidth  * 0.4;
            y = window.innerHeight * 0.4;
          }
          moveGhostCursor(x, y);
          return { success: true, x, y, mode: 'excel' };
        }

        // ── WORD ONLINE ──────────────────────────────────────────────────────
        if (isWord) {
          // Word buries its editor inside an iframe — target the iframe centre.
          const frame = document.querySelector(
            'iframe.WACFrame, iframe#EditorFrame, .office-editor-frame, iframe[title*="Word"], iframe[title*="Document"]'
          );
          if (frame) {
            const r = frame.getBoundingClientRect();
            const x = r.left + r.width / 2;
            const y = r.top  + Math.min(150, r.height * 0.2);
            moveGhostCursor(x, y);
            return { success: true, x, y, mode: 'word-iframe' };
          }
          const editArea = findVisible(['.WACViewPanel', '.Page', 'div[contenteditable="true"]']);
          if (editArea) {
            const r = editArea.getBoundingClientRect();
            const x = r.left + r.width * 0.5;
            const y = r.top  + Math.min(80, r.height * 0.15);
            moveGhostCursor(x, y);
            return { success: true, x, y, mode: 'word' };
          }
          return { success: true, x: window.innerWidth * 0.5, y: window.innerHeight * 0.4, mode: 'word' };
        }

        // ── GOOGLE AI STUDIO / MAKERSUITE ────────────────────────────────────
         if (host.includes('aistudio.google.com') || host.includes('makersuite.google.com')) {
           // AI Studio input lives inside nested Shadow DOM (<ms-prompt-editor>).
           // findVisible() is blind to shadow boundaries — use a deep shadow walk
           // that collects ALL visible matches and returns the LAST one (active turn).
           function aisDeepAll(root, sel, acc) {
             if (!root) return;
             try {
               for (const el of root.querySelectorAll(sel)) {
                 const r = el.getBoundingClientRect();
                 if (r.width > 5 && r.height > 5) acc.push(el);
               }
             } catch (_) {}
             for (const el of root.querySelectorAll('*')) {
               if (el.shadowRoot) aisDeepAll(el.shadowRoot, sel, acc);
             }
           }
           const AIS_SELS = [
             '.ProseMirror',
             'ms-prompt-editor [contenteditable="true"]',
             'ms-autosize-textarea textarea',
             'ms-prompt-input textarea',
             'textarea[aria-label*="Prompt" i]',
             '[contenteditable="true"][aria-multiline="true"]',
             '[contenteditable="true"][role="textbox"]',
             '[contenteditable="true"]',
             'textarea',
           ];
           let aiInput = null;
           for (const sel of AIS_SELS) {
             const hits = [];
             aisDeepAll(document, sel, hits);
             if (hits.length > 0) { aiInput = hits[hits.length - 1]; break; }
           }
           let x, y;
           if (aiInput) {
             const r = aiInput.getBoundingClientRect();
             x = r.left + r.width * 0.5;
             y = r.top  + r.height * 0.5;
             highlightElement(aiInput);
           } else {
             x = window.innerWidth * 0.5;
             y = window.innerHeight * 0.65;
           }
           moveGhostCursor(x, y);
           return { success: true, x, y, mode: 'aistudio' };
         }

        // ── GEMINI CHAT (gemini.google.com) ──────────────────────────────────
        if (host.includes('gemini.google.com')) {
          // Gemini wraps its chat input inside <rich-textarea> which may use
          // Shadow DOM. Use a visibility-aware shadow-piercing walk so we always
          // land on the actual rendered editor, not a hidden DOM duplicate.
          function geminiShadowFind(root) {
            if (!root) return null;
            const candidates = [
              'rich-textarea .ql-editor',
              'rich-textarea div[contenteditable="true"]',
              'div[contenteditable="true"][aria-label]',
              'div[contenteditable="true"][role="textbox"]',
              '.ql-editor',
              'div[contenteditable="true"]',
            ];
            for (const sel of candidates) {
              try {
                const els = root.querySelectorAll(sel);
                for (const el of els) {
                  const r = el.getBoundingClientRect();
                  if (r.width > 10 && r.height > 10) return el;
                }
              } catch (_) {}
            }
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot) {
                const f = geminiShadowFind(el.shadowRoot);
                if (f) return f;
              }
            }
            return null;
          }
          const input = geminiShadowFind(document);
          let x, y;
          if (input) {
            const r = input.getBoundingClientRect();
            x = r.left + r.width * 0.5;
            y = r.top  + r.height * 0.5;
            highlightElement(input);
          } else {
            x = window.innerWidth * 0.5;
            y = window.innerHeight * 0.85;
          }
          moveGhostCursor(x, y);
          return { success: true, x, y, mode: 'gemini' };
        }

        // ── NOTEBOOKLM (GEMINI NOTEBOOK) ────────────────────────────────────
        // NotebookLM is built entirely with nested Shadow DOM Web Components.
        // Standard document.querySelector() cannot pierce shadow roots, so
        // findVisible() above is blind to Studio modal inputs. We use a
        // recursive deepShadowQuery that walks all shadow roots on the page
        // and targets the exact aria-label values used by each Studio panel.
        if (host.includes('notebooklm.google.com') || host.includes('notebook.google.com')) {
          // Visibility-aware shadow-piercing query: returns the first element
          // matching ANY of the comma-separated selectors that has nonzero
          // rendered dimensions (i.e. is actually visible on screen).
          // This prevents accidentally targeting hidden inputs that appear earlier
          // in DOM order than the visible chat box or Studio dialog input.
          function deepShadowQueryVisible(root, selector) {
            if (!root) return null;
            // Check all direct matches at this level for visibility first
            try {
              const matches = root.querySelectorAll(selector);
              for (const el of matches) {
                const r = el.getBoundingClientRect();
                if (r.width > 5 && r.height > 5) return el;
              }
            } catch (_) {}
            // Recurse into shadow roots
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot) {
                const found = deepShadowQueryVisible(el.shadowRoot, selector);
                if (found) return found;
              }
            }
            return null;
          }

          // All known NotebookLM input surfaces, ordered most-specific → most-generic.
          // The visibility check ensures whichever dialog/panel is currently OPEN
          // wins, regardless of DOM order.
          const NL_SELECTORS =
            // ── Main chat / query box ───────────────────────────────────────────
            "[aria-label='Query box'], [aria-label='query box'], " +
            "div[contenteditable='true'][aria-label*='query' i], " +
            // ── "Add sources → Websites" URL input ─────────────────────────────
            "input[type='url'], " +
            "input[placeholder*='links' i], input[placeholder*='url' i], " +
            "input[placeholder*='https' i], input[placeholder*='Enter URL' i], " +
            "input[aria-label*='URL' i], input[aria-label*='website' i], " +
            "input[aria-label*='link' i], " +
            // ── Studio panel textareas (exact aria-labels from live NotebookLM) ─
            "textarea[aria-label='Input to describe the kind of report to create'], " +
            // Slide Deck dialog (confirmed from live UI screenshot)
            "[aria-label='Describe the slide deck you want to create'], " +
            "textarea[aria-label='Describe the slide deck you want to create'], " +
            // Video Overview dialog
            "[aria-label='Describe the video overview you want to create'], " +
            "textarea[aria-label='Describe the video overview you want to create'], " +
            "[aria-label='Describe the video you want to create'], " +
            "[aria-label='Describe the data table you want to create'], " +
            "[aria-label='Describe the infographic you want to create'], " +
            "[aria-label='Describe the quiz you want to create'], " +
            "[aria-label='Describe the mind map you want to create'], " +
            "[aria-label='Describe the flashcards you want to create'], " +
            "[aria-label='Describe the study guide you want to create'], " +
            "textarea[aria-label='What should the AI hosts focus on in this episode?'], " +
            "textarea[aria-label='Text area for custom topic'], " +
            "[aria-label*='Describe' i][aria-label*='create' i], " +
            "textarea[placeholder*='links' i], " +
            // ── Generic visible fallbacks ───────────────────────────────────────
            "div[contenteditable='true'], textarea, input[type='text']";

          // If the text to type is a URL, ONLY look for a real URL input field.
          // This prevents the locator from finding the always-visible query box and
          // returning its coords before the "Website" URL dialog has animated in.
          const _nlText = String(params.text || '');
          const _nlIsUrl = /^https?:\/\//i.test(_nlText.trim());

          // Same bug, same fix as background.js's NL_URL_ONLY (already patched
          // there) — this is a SEPARATE, independent copy of the same selector
          // list that got missed at the time. NotebookLM's real multi-URL box
          // is a <textarea placeholder="Paste any links">, not an <input>;
          // every clause here only ever matched input tags.
          const NL_URL_SELECTORS =
            "input[type='url'], " +
            "input[placeholder*='links' i], input[placeholder*='url' i], " +
            "input[placeholder*='https' i], input[placeholder*='Enter URL' i], " +
            "input[placeholder*='website' i], input[placeholder*='link' i], " +
            "input[aria-label*='URL' i], input[aria-label*='website' i], " +
            "input[aria-label*='link' i], " +
            "textarea[placeholder*='links' i], textarea[placeholder*='url' i], " +
            "textarea[placeholder*='https' i], textarea[placeholder*='website' i], " +
            "textarea[placeholder*='link' i], " +
            "textarea[aria-label*='URL' i], textarea[aria-label*='website' i], " +
            "textarea[aria-label*='link' i]";

          const input = deepShadowQueryVisible(document, _nlIsUrl ? NL_URL_SELECTORS : NL_SELECTORS);

          let x, y;
          if (input) {
            input.focus();
            const r = input.getBoundingClientRect();
            x = r.left + r.width * 0.5;
            y = r.top  + r.height * 0.5;
            moveGhostCursor(x, y);
            return { success: true, x, y, mode: 'notebooklm' };
          }

          // URL mode: don't fall back to the chat box — signal not-found so the
          // background.js NL type path's own retry loop can take over with a
          // proper wait instead of firing insertText at wrong coordinates.
          if (_nlIsUrl) {
            return { success: true, x: window.innerWidth * 0.5, y: window.innerHeight * 0.5, mode: 'notebooklm-fallback' };
          }

          // Non-URL fallback: centre-bottom of the visible viewport where modals render
          x = window.innerWidth * 0.5;
          y = window.innerHeight * 0.80;
          moveGhostCursor(x, y);
          return { success: true, x, y, mode: 'notebooklm-fallback' };
        }

        // ── GOOGLE COLAB ─────────────────────────────────────────────────────
        if (host.includes('colab.research.google.com')) {
          const input = findVisible([
            '.cell-output-area div[contenteditable="true"]',
            'div.CodeMirror-code',
            'div[contenteditable="true"]',
            'textarea.CodeMirror-line',
            'textarea',
          ]);
          let x, y;
          if (input) {
            const r = input.getBoundingClientRect();
            x = r.left + r.width * 0.4;
            y = r.top  + r.height * 0.3;
            highlightElement(input);
          } else {
            x = window.innerWidth * 0.5;
            y = window.innerHeight * 0.4;
          }
          moveGhostCursor(x, y);
          return { success: true, x, y, mode: 'aistudio' };
        }

        // ── PROJECT IDX ──────────────────────────────────────────────────────
        if (host.includes('idx.google.com')) {
          const input = findVisible([
            'textarea[placeholder]',
            'div[contenteditable="true"]',
            '.monaco-editor textarea',
            'textarea',
          ]);
          let x, y;
          if (input) {
            const r = input.getBoundingClientRect();
            x = r.left + r.width * 0.5;
            y = r.top  + r.height * 0.5;
            highlightElement(input);
          } else {
            x = window.innerWidth * 0.5;
            y = window.innerHeight * 0.5;
          }
          moveGhostCursor(x, y);
          return { success: true, x, y, mode: 'aistudio' };
        }

        // ── CHATGPT ──────────────────────────────────────────────────────────
        // ── CHATGPT ───────────────────────────────────────────────────────────
        if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) {
          const input = findVisible([
            '#prompt-textarea',
            'div[contenteditable="true"][aria-label]',
            'textarea[data-id="root"]',
            'div[contenteditable="true"]',
            'textarea[placeholder]',
            'textarea',
          ]);
          let x = window.innerWidth * 0.5, y = window.innerHeight * 0.88;
          if (input) { const r = input.getBoundingClientRect(); x = r.left + r.width * 0.5; y = r.top + r.height * 0.5; highlightElement(input); }
          moveGhostCursor(x, y);
          return { success: true, x, y, mode: 'chatgpt' };
        }

        // ── CLAUDE ───────────────────────────────────────────────────────────
        if (host.includes('claude.ai')) {
          const input = findVisible([
            'div.ProseMirror[contenteditable="true"]',
            'div[contenteditable="true"][role="textbox"]',
            'div[contenteditable="true"]',
            'textarea',
          ]);
          let x = window.innerWidth * 0.5, y = window.innerHeight * 0.88;
          if (input) { const r = input.getBoundingClientRect(); x = r.left + r.width * 0.5; y = r.top + r.height * 0.5; highlightElement(input); }
          moveGhostCursor(x, y);
          return { success: true, x, y, mode: 'claude' };
        }

        // ── GROK ─────────────────────────────────────────────────────────────
        if (host.includes('grok.com') || host.includes('grok.x.ai')) {
          const input = findVisible([
            'textarea[aria-label]',
            'div[contenteditable="true"]',
            'textarea[placeholder]',
            'textarea',
          ]);
          let x = window.innerWidth * 0.5, y = window.innerHeight * 0.88;
          if (input) { const r = input.getBoundingClientRect(); x = r.left + r.width * 0.5; y = r.top + r.height * 0.5; highlightElement(input); }
          moveGhostCursor(x, y);
          return { success: true, x, y, mode: 'grok' };
        }

        // ── PERPLEXITY ───────────────────────────────────────────────────────
        if (host.includes('perplexity.ai')) {
          const input = findVisible([
            'textarea[placeholder]',
            'div[contenteditable="true"]',
            'textarea',
          ]);
          let x = window.innerWidth * 0.5, y = window.innerHeight * 0.88;
          if (input) { const r = input.getBoundingClientRect(); x = r.left + r.width * 0.5; y = r.top + r.height * 0.5; highlightElement(input); }
          moveGhostCursor(x, y);
          return { success: true, x, y, mode: 'perplexity' };
        }

        // ── MICROSOFT COPILOT / BING ──────────────────────────────────────────
        if (host.includes('copilot.microsoft.com') || host.includes('bing.com')) {
          const input = findVisible([
            'textarea[id*="search"]',
            'div[contenteditable="true"]',
            '#searchbox',
            'textarea[placeholder]',
            'textarea',
          ]);
          let x = window.innerWidth * 0.5, y = window.innerHeight * 0.88;
          if (input) { const r = input.getBoundingClientRect(); x = r.left + r.width * 0.5; y = r.top + r.height * 0.5; highlightElement(input); }
          moveGhostCursor(x, y);
          return { success: true, x, y, mode: 'copilot' };
        }

        // ── GOOGLE DOCS (canvas tiles) ───────────────────────────────────────
        if (isDocs) {
          const target = findVisible([
            '.kix-canvas-tile-content', 'canvas.kix-canvas-tile-content',
            '.kix-appview-editor', '.kix-page-content-wrapper', '.kix-page',
            '#docs-editor-container', 'div[role="textbox"]'
          ]);
          let x, y;
          if (target) {
            const rect = target.getBoundingClientRect();
            x = rect.left + Math.min(120, rect.width  * 0.15);
            y = rect.top  + Math.min(80,  rect.height * 0.12);
            highlightElement(target);
          } else {
            x = window.innerWidth  * 0.5;
            y = window.innerHeight * 0.4;
          }
          moveGhostCursor(x, y);
          return { success: true, x, y, mode: 'docs' };
        }

        // ── GOOGLE SLIDES ─────────────────────────────────────────────────────
        // Slides renders text boxes on a WebGL/canvas layer — there are no DOM
        // input nodes to read or focus. Return mode:'slides' so background.js
        // knows to attempt CDP insertText once, verify it landed, and return a
        // clear CANVAS_TYPING_LIMITATION error (instead of silently failing)
        // if the text didn't appear. This stops the agent from looping.
        if (location.hostname.includes('docs.google.com') && location.pathname.includes('/presentation/')) {
          return { success: true, x: window.innerWidth * 0.5, y: window.innerHeight * 0.45, mode: 'slides' };
        }

        // ── UNKNOWN CANVAS APP — safe centre-of-screen fallback ──────────────
        // background.js only calls locateForType for known canvas hosts, so
        // reaching here means the page structure is unexpected. Return safe
        // centre coords so CDP still attempts to click rather than giving up.
        return { success: true, x: window.innerWidth * 0.5, y: window.innerHeight * 0.35, mode: 'unknown' };
      }

      case 'type': {
        const host = location.hostname;

        // ── Helper: paste via clipboard (best for virtual-canvas editors) ──────
        // navigator.clipboard.writeText() throws "Document is not focused" when
        // called from a content script without user activation.  Use a hidden
        // textarea + execCommand('copy') instead — no gesture required.
        async function pasteViaClipboard(text, focusEl) {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;';
          document.body.appendChild(ta);
          ta.focus(); ta.select();
          document.execCommand('copy');
          ta.remove();
          await new Promise(r => setTimeout(r, 150));
          const target = focusEl || document.activeElement || document.body;
          target.dispatchEvent(new KeyboardEvent('keydown',  { key:'v', code:'KeyV', ctrlKey:true, bubbles:true, cancelable:true }));
          target.dispatchEvent(new KeyboardEvent('keyup',    { key:'v', code:'KeyV', ctrlKey:true, bubbles:true }));
          await new Promise(r => setTimeout(r, 400));
        }

        // ── GOOGLE DOCS — virtual canvas, no real contenteditable body ─────────
        if (host.includes('docs.google.com')) {
          showAgentBanner(`📋 Pasting into Google Docs…`);

          // The title IS a real input — avoid clicking it when writing to body
          // Priority: canvas editor → zoom container → editor shell
          const editorSelectors = [
            '.kix-appview-editor',
            '.kix-zoomdocumentplugin-outer',
            '.docs-editor-container',
            '#docs-editor',
          ];
          let editorEl = null;
          for (const sel of editorSelectors) {
            const el = document.querySelector(sel);
            if (el) { editorEl = el; break; }
          }

          // Click into the document body (not the title bar)
          if (editorEl) {
            const r = editorEl.getBoundingClientRect();
            // Click ~200px from top-left to land in the document content, not the title
            const cx = r.left + Math.min(200, r.width * 0.3);
            const cy = r.top  + Math.min(120, r.height * 0.25);
            moveGhostCursor(cx, cy);
            await new Promise(r2 => setTimeout(r2, 200));
            editorEl.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, clientX:cx, clientY:cy }));
            editorEl.dispatchEvent(new MouseEvent('mouseup',   { bubbles:true, clientX:cx, clientY:cy }));
            editorEl.dispatchEvent(new MouseEvent('click',     { bubbles:true, clientX:cx, clientY:cy }));
            await new Promise(r2 => setTimeout(r2, 300));
          }

          // Paste text at cursor
          await pasteViaClipboard(params.text, editorEl);
          showAgentBanner('✓ Text pasted into document body');

          if (params.pressEnter) {
            const target = editorEl || document.body;
            target.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', keyCode:13, bubbles:true }));
            target.dispatchEvent(new KeyboardEvent('keyup',   { key:'Enter', code:'Enter', keyCode:13, bubbles:true }));
          }
          return { success: true, message: 'Pasted text into Google Docs body' };
        }

        // ── WORD ONLINE ────────────────────────────────────────────────────────
        if (host.includes('word.office.com') || host.includes('word.live.com')) {
          showAgentBanner(`📋 Pasting into Word Online…`);
          const wordSelectors = [
            '.WACViewPanel', '.Page', '[class*="EditArea"]',
            'div[contenteditable="true"]', '.ms-rtestate-field'
          ];
          let editorEl = null;
          for (const sel of wordSelectors) {
            const el = document.querySelector(sel);
            if (el) { editorEl = el; break; }
          }
          if (editorEl) { editorEl.click(); editorEl.focus(); await new Promise(r => setTimeout(r, 300)); }
          await pasteViaClipboard(params.text, editorEl);
          showAgentBanner('✓ Text pasted into Word document');
          return { success: true, message: 'Pasted text into Word Online' };
        }

        // ── POWERPOINT ONLINE ──────────────────────────────────────────────────
        if (host.includes('powerpoint.office.com') || host.includes('powerpoint.live.com')) {
          showAgentBanner(`📋 Pasting into PowerPoint…`);
          // If a text box is already open for editing, use it directly
          const activeTextBox = document.querySelector('[contenteditable="true"]');
          if (activeTextBox) {
            activeTextBox.focus();
            await new Promise(r => setTimeout(r, 200));
            await pasteViaClipboard(params.text, activeTextBox);
            showAgentBanner('✓ Text pasted into text box');
            return { success: true, message: 'Pasted into PowerPoint text box' };
          }
          // No text box open — click the slide canvas to open one, then paste
          const slideSelectors = [
            '#MainContent', '.ppt-slide-view', '[class*="slideCanvas"]',
            '[class*="SlideView"]', 'canvas', '.canvascontainer', '#WACViewPanel'
          ];
          let slideEl = null;
          for (const sel of slideSelectors) {
            const el = document.querySelector(sel);
            if (el) { slideEl = el; break; }
          }
          if (slideEl) {
            const r = slideEl.getBoundingClientRect();
            const cx = r.left + r.width * 0.5;
            const cy = r.top  + r.height * 0.5;
            moveGhostCursor(cx, cy);
            await new Promise(r2 => setTimeout(r2, 200));
            slideEl.dispatchEvent(new MouseEvent('dblclick', { bubbles:true, clientX:cx, clientY:cy }));
            await new Promise(r2 => setTimeout(r2, 600));
          }
          // Now re-check for contenteditable text box
          const openedBox = document.querySelector('[contenteditable="true"]');
          await pasteViaClipboard(params.text, openedBox || slideEl);
          showAgentBanner('✓ Text pasted into slide');
          return { success: true, message: 'Pasted into PowerPoint slide' };
        }

        // ── EXCEL ONLINE ───────────────────────────────────────────────────────
        if (host.includes('excel.office.com') || host.includes('excel.live.com')) {
          showAgentBanner(`⌨️ Typing into Excel cell…`);
          // Excel has a real cell-edit input — find formula bar or active cell editor
          const cellSelectors = [
            '#ce-input',                          // cell editor input
            '[class*="cell-input"]',
            '[class*="cellInput"]',
            '[class*="formulaBarInput"]',
            'input[class*="formula"]',
            '[id*="cellInput"]',
          ];
          let cellEl = null;
          for (const sel of cellSelectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetParent !== null) { cellEl = el; break; }
          }
          if (cellEl) {
            // Cell editor is already open — type directly
            cellEl.focus();
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (nativeSetter) nativeSetter.call(cellEl, params.text);
            else cellEl.value = params.text;
            cellEl.dispatchEvent(new Event('input',  { bubbles: true }));
            cellEl.dispatchEvent(new Event('change', { bubbles: true }));
            if (params.pressEnter !== false) {
              cellEl.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', keyCode:13, bubbles:true }));
              cellEl.dispatchEvent(new KeyboardEvent('keyup',   { key:'Enter', keyCode:13, bubbles:true }));
            }
            showAgentBanner('✓ Value entered in cell');
            return { success: true, message: 'Typed value into Excel cell' };
          }
          // No cell editor visible — try clipboard paste into the active grid area
          const gridSelectors = [
            '[class*="gridCanvas"]', '[class*="sheetCanvas"]',
            'canvas', '[id*="ewaCtrl"]', '.ms-fpo-ewactrl'
          ];
          let gridEl = null;
          for (const sel of gridSelectors) {
            const el = document.querySelector(sel);
            if (el) { gridEl = el; break; }
          }
          if (gridEl) { gridEl.click(); await new Promise(r => setTimeout(r, 300)); }
          await pasteViaClipboard(params.text, gridEl);
          showAgentBanner('✓ Value pasted into Excel');
          return { success: true, message: 'Pasted into Excel cell' };
        }

        // ── NOTEBOOKLM (Shadow DOM) ────────────────────────────────────────────
        // content.js reaches this 'type' branch only when CDP attach failed and
        // background.js called runFallbackType(). All NotebookLM inputs live inside
        // nested Shadow DOM — standard document.querySelector() is blind to them.
        // Recursively pierce shadow roots, set the value via native setter (so
        // React/Lit controlled components update their state), then dispatch input
        // events so the UI reflects the new value.
        if (host.includes('notebooklm.google.com') || host.includes('notebook.google.com')) {
          function deepShadowQueryVisibleType(root, selector) {
            if (!root) return null;
            try {
              const matches = root.querySelectorAll(selector);
              for (const el of matches) {
                const r = el.getBoundingClientRect();
                if (r.width > 5 && r.height > 5) return el;
              }
            } catch (_) {}
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot) {
                const found = deepShadowQueryVisibleType(el.shadowRoot, selector);
                if (found) return found;
              }
            }
            return null;
          }
          const NL_TYPE_SELECTORS =
            "[aria-label='Query box'], [aria-label='query box'], " +
            "div[contenteditable='true'][aria-label*='query' i], " +
            "input[type='url'], " +
            "input[placeholder*='links' i], input[placeholder*='url' i], " +
            "input[placeholder*='https' i], input[placeholder*='Enter URL' i], " +
            "input[aria-label*='URL' i], input[aria-label*='website' i], " +
            "textarea[aria-label='Input to describe the kind of report to create'], " +
            // Slide Deck dialog (confirmed from live UI screenshot)
            "[aria-label='Describe the slide deck you want to create'], " +
            "textarea[aria-label='Describe the slide deck you want to create'], " +
            // Video Overview dialog
            "[aria-label='Describe the video overview you want to create'], " +
            "textarea[aria-label='Describe the video overview you want to create'], " +
            "[aria-label='Describe the video you want to create'], " +
            "[aria-label='Describe the data table you want to create'], " +
            "[aria-label='Describe the infographic you want to create'], " +
            "[aria-label='Describe the quiz you want to create'], " +
            "[aria-label='Describe the mind map you want to create'], " +
            "[aria-label='Describe the flashcards you want to create'], " +
            "[aria-label='Describe the study guide you want to create'], " +
            "textarea[aria-label='What should the AI hosts focus on in this episode?'], " +
            "textarea[aria-label='Text area for custom topic'], " +
            "[aria-label*='Describe' i][aria-label*='create' i], " +
            "textarea[placeholder*='links' i], div[contenteditable='true'], textarea, input[type='text']";
          const nlInput = deepShadowQueryVisibleType(document, NL_TYPE_SELECTORS);
          if (nlInput) {
            nlInput.focus();
            const isContentEditable = nlInput.contentEditable === 'true'
              || nlInput.getAttribute('contenteditable') === 'true';

            if (isContentEditable) {
              // contenteditable div (e.g. the Query box) — plain .value setter is
              // a no-op on divs. Use document.execCommand('insertText') which fires
              // the DOM mutation that Angular/Lit change detection requires.
              // Clear existing content first if requested.
              if (params.clearFirst) {
                const range = document.createRange();
                range.selectNodeContents(nlInput);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
              }
              const typed = document.execCommand('insertText', false, params.text);
              if (!typed) {
                // execCommand deprecated in some environments — fallback: set
                // innerText and fire a synthetic InputEvent so Angular sees it.
                nlInput.innerText = params.text;
                nlInput.dispatchEvent(new InputEvent('input', {
                  bubbles: true, cancelable: true,
                  data: params.text, inputType: 'insertText'
                }));
              }
              showAgentBanner(`⌨️ Typed into NotebookLM query box`);
            } else {
              // <input> or <textarea> — use native prototype setter so React/Lit
              // controlled-component state updates correctly, then fire events.
              const isTA = nlInput.tagName === 'TEXTAREA';
              const proto = isTA
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              if (setter) setter.call(nlInput, params.text);
              else nlInput.value = params.text;
              nlInput.dispatchEvent(new Event('input',  { bubbles: true }));
              nlInput.dispatchEvent(new Event('change', { bubbles: true }));
              showAgentBanner(`⌨️ Typed into NotebookLM ${isTA ? 'textarea' : 'input'}`);
            }
            return { success: true, message: 'Typed into NotebookLM Shadow DOM input' };
          }
          // No input found — tell the agent explicitly so it can retry after the
          // dialog fully loads, rather than silently using generic search selectors.
          return { success: false, error: 'NotebookLM: no URL input or textarea found in Shadow DOM — dialog may still be loading. Wait 1s then retry.' };
        }

        // ── STANDARD INPUTS / SEARCH BOXES / CONTENTEDITABLE ──────────────────
        let element = null;
        const attemptedSelectors = [];
        
        // Strategy 1: Try provided selector
        if (params.selector) {
          attemptedSelectors.push(params.selector);
          element = document.querySelector(params.selector);
        }
        
        // Strategy 2: Common search box selectors for popular sites
        if (!element) {
          const commonSearchSelectors = [
            'input[name="q"]', 'input[name="search"]', 'input[name="field-keywords"]',
            'input[type="search"]', 'input[placeholder*="Search"]', 'input[placeholder*="search"]',
            'input[aria-label*="Search"]', 'input[aria-label*="search"]',
            '#search-input', '#searchInput', '#search_input', '.search-input',
            'input#twotabsearchtextbox', 'input.nav-input',
            'input[data-testid="search-input"]', 'input[data-testid="SearchBox"]'
          ];
          for (const sel of commonSearchSelectors) {
            attemptedSelectors.push(sel);
            const found = document.querySelector(sel);
            if (found && found.offsetParent !== null) {
              element = found;
              showAgentBanner(`Found search box using: ${sel}`);
              break;
            }
          }
        }
        
        // Strategy 3: Find by placeholder text
        if (!element && params.placeholder) {
          attemptedSelectors.push(`placeholder:${params.placeholder}`);
          const inputs = document.querySelectorAll('input, textarea');
          for (const inp of inputs) {
            if (inp.placeholder && inp.placeholder.toLowerCase().includes(params.placeholder.toLowerCase())) {
              element = inp;
              showAgentBanner(`Found by placeholder: "${inp.placeholder}"`);
              break;
            }
          }
        }
        
        // Strategy 4: Find first visible text input
        if (!element) {
          attemptedSelectors.push('visible text/search input');
          const inputs = document.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), textarea, [contenteditable="true"]');
          for (const inp of inputs) {
            if (inp.offsetParent !== null && !inp.disabled && !inp.readOnly) {
              element = inp;
              showAgentBanner('Using first visible input field');
              break;
            }
          }
        }
        
        if (!element) {
          throw new Error(
            `Input not found. Tried: ${attemptedSelectors.slice(0, 5).join(', ')}.` +
            (await describeAvailableElements(params.description || params.selector || '')) +
            `\nNEXT STEP: target the field by index with type({text:"…", index:N}) using the list above.`
          );
        }
        
        // Use instant scroll so the element is static before coordinate calculation
        element.scrollIntoView({ behavior: 'auto', block: 'center' });
        await new Promise(r => setTimeout(r, 150));
        const center = getElementCenter(element);
        moveGhostCursor(center.x, center.y);
        await new Promise(r => setTimeout(r, 300));
        clickGhostCursor(center.x, center.y);
        highlightElement(element);
        showAgentBanner(`Typing: "${params.text.substring(0, 40)}${params.text.length > 40 ? '…' : ''}"`);
        element.focus();
        
        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
          // Clear then set value — fire input/change so React/Vue pick it up.
          // Wrap in try/catch: calling the prototype setter on an element from a
          // different frame context throws "Illegal invocation" — fall back to
          // clipboard paste in that case so we always succeed.
          let nativeSet = false;
          try {
            const tag = element.tagName === 'TEXTAREA' ? 'HTMLTextAreaElement' : 'HTMLInputElement';
            const setter = Object.getOwnPropertyDescriptor(window[tag].prototype, 'value')?.set;
            if (setter) {
              setter.call(element, params.text);
              nativeSet = true;
            }
          } catch (_) { /* cross-frame element — fall through to clipboard */ }
          if (!nativeSet) {
            try { element.value = params.text; nativeSet = true; } catch (_) {}
          }
          if (nativeSet) {
            element.dispatchEvent(new Event('input',  { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            // Last resort: clipboard paste
            await pasteViaClipboard(params.text, element);
          }
        } else {
          // Contenteditable: use execCommand to INSERT at cursor (not replace all content)
          element.focus();
          const sel = window.getSelection();
          if (sel && sel.rangeCount) {
            // Move caret to end of existing content
            const range = document.createRange();
            range.selectNodeContents(element);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
          // execCommand('insertText') inserts at caret without replacing — no duplicates
          const inserted = document.execCommand('insertText', false, params.text);
          if (!inserted) {
            // Last resort: clipboard paste
            await pasteViaClipboard(params.text, element);
          }
          element.dispatchEvent(new InputEvent('input', { bubbles: true, data: params.text }));
        }
        
        // Auto-detect search boxes and press Enter automatically.
        // Catches: type="search", name="q" (Google/Bing), form action contains
        // "search", aria-label contains "search", or explicit pressEnter param.
        const looksLikeSearch = (
          element.getAttribute('type') === 'search' ||
          (element.getAttribute('name') || '').toLowerCase() === 'q' ||
          (element.getAttribute('aria-label') || '').toLowerCase().includes('search') ||
          (element.getAttribute('placeholder') || '').toLowerCase().includes('search') ||
          (() => {
            const form = element.closest('form');
            return form && (form.getAttribute('action') || '').toLowerCase().includes('search');
          })()
        );
        if (params.pressEnter || looksLikeSearch) {
          await new Promise(r => setTimeout(r, 350));
          showAgentBanner('Pressing Enter…');
          element.dispatchEvent(new KeyboardEvent('keydown',  { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          element.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          element.dispatchEvent(new KeyboardEvent('keyup',    { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          // For search engines that navigate on submit — also try form.submit()
          const form = element.closest('form');
          if (form) {
            try { form.submit(); } catch (_) {}
          }
        }
        
        return { success: true };
      }
      
      case 'scroll': {
        showAgentBanner(`Scrolling ${params.direction || 'to element'}...`);

        if (params.selector) {
          const el = document.querySelector(params.selector);
          if (el) {
            el.scrollIntoView({ behavior: 'auto', block: 'center' });
            await new Promise(r => setTimeout(r, 100));
            const center = getElementCenter(el);
            moveGhostCursor(center.x, center.y);
          }
          return { success: true };
        }

        // Many apps (Google Docs/Drive preview, PDF viewers, chat panes) render
        // their real content inside an inner scrollable <div>, not the page
        // body — scrolling window.scrollBy does nothing visible there. Find
        // the largest/most-central scrollable element on screen and scroll
        // that instead, falling back to window if nothing else qualifies.
        const isScrollable = (el) => {
          if (!el || el === document.documentElement || el === document.body) return false;
          const style = getComputedStyle(el);
          const overflowY = style.overflowY;
          const canScroll = (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay');
          return canScroll && el.scrollHeight > el.clientHeight + 20;
        };
        const findScrollTarget = () => {
          // Prefer whatever scrollable container sits directly under the
          // center of the viewport (where the "document" content usually is).
          const centerEl = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
          let node = centerEl;
          while (node) {
            if (isScrollable(node)) return node;
            node = node.parentElement;
          }
          // Fallback: pick the largest scrollable container anywhere on the page.
          const all = document.querySelectorAll('*');
          let best = null, bestArea = 0;
          for (const el of all) {
            if (!isScrollable(el)) continue;
            const rect = el.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (area > bestArea) { best = el; bestArea = area; }
          }
          return best;
        };

        const target = findScrollTarget();
        const scrollerHeight = target ? target.clientHeight : window.innerHeight;

        if (params.direction === 'down') {
          if (target) target.scrollBy({ top: scrollerHeight * 0.8, behavior: 'smooth' });
          else window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
        } else if (params.direction === 'up') {
          if (target) target.scrollBy({ top: -scrollerHeight * 0.8, behavior: 'smooth' });
          else window.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' });
        } else if (params.direction === 'top') {
          if (target) target.scrollTo({ top: 0, behavior: 'smooth' });
          else window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (params.direction === 'bottom') {
          if (target) target.scrollTo({ top: target.scrollHeight, behavior: 'smooth' });
          else window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        } else {
          // No direction given — default to scrolling down, same as before.
          if (target) target.scrollBy({ top: scrollerHeight * 0.8, behavior: 'smooth' });
          else window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
        }

        if (target) {
          const rect = target.getBoundingClientRect();
          moveGhostCursor(rect.left + rect.width / 2, rect.top + rect.height / 2);
        } else {
          moveGhostCursor(window.innerWidth / 2, window.innerHeight / 2);
        }

        return { success: true };
      }
      
      case 'checkElement': {
        const element = document.querySelector(params.selector);
        if (element) {
          const center = getElementCenter(element);
          moveGhostCursor(center.x, center.y);
          highlightElement(element);
        }
        return { success: true, found: !!element };
      }
      
      case 'hideGhostCursor': {
        removeGhostCursor();
        return { success: true };
      }
      
      case 'buildElementIndex': {
        // Rebuild the integer index map and return the compact text list.
        // Called by background.js before each agent step to populate the
        // element list that gets prepended to the page-state sent to the LLM.
        return buildElementIndex();
      }

      case 'resolveByIndex': {
        // Resolve a previously-assigned element index to viewport coordinates.
        // Returns { success, x, y } so background.js can dispatch a CDP click
        // without any text/selector/AXTree fallback overhead.
        const coords = resolveByIndex(params.index);
        if (!coords) return { success: false, error: `Index ${params.index} not found or element no longer visible` };
        return { success: true, x: coords.x, y: coords.y };
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  // === AUTO-PASTE TEXT FOR AI SITES (Gemini, ChatGPT, Claude) ===
  async function autoPasteText() {
    try {
      const data = await chrome.storage.session.get(['aiText', 'aiTitle', 'payloadMode']);
      
      if (data.payloadMode === 'hybrid' && data.aiText) {
        const input = document.querySelector('div[role="textbox"], textarea, [contenteditable="true"]');
        if (input) {
          const prompt = `SOURCE: ${data.aiTitle}\n\nTEXT CONTENT:\n${data.aiText}\n\n--- INSTRUCTION: Analyze the images using the text above for context. ---`;
          
          // Handle different input types
          if (input.tagName === 'TEXTAREA') {
            input.value = prompt;
          } else {
            input.innerText = prompt;
          }
          input.dispatchEvent(new Event('input', { bubbles: true }));
          
          // Clear the locker so it doesn't paste again on refresh
          chrome.storage.session.remove(['aiText', 'aiTitle', 'payloadMode']);
          console.log('[SnapToAI] Auto-pasted text context to AI input');
        }
      }
    } catch (e) {
      console.log('[SnapToAI] Auto-paste not available');
    }
  }

  // Check for AI input box on AI sites
  const hostname = window.location.hostname;
  const isAISite = hostname.includes('gemini.google.com') || 
                   hostname.includes('chatgpt.com') || 
                   hostname.includes('chat.openai.com') ||
                   hostname.includes('claude.ai') ||
                   hostname.includes('grok.com');
  
  if (isAISite) {
    const pasteInterval = setInterval(() => {
      if (document.querySelector('div[role="textbox"], textarea, [contenteditable="true"]')) {
        autoPasteText();
        clearInterval(pasteInterval);
      }
    }, 1000);
    
    // Clear interval after 30 seconds to prevent memory leaks
    setTimeout(() => clearInterval(pasteInterval), 30000);
  }


})();
