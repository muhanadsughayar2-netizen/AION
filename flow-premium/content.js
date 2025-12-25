rame
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
        // For document viewers: use forced page height to determine when to stop
        if (isDocViewer) {
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
        if (!isDocViewer && captureCount > 1 && currentScrollTop >= getMaxScroll() - 20) {
          console.log('[SnapToAI] Reached max scroll position');
          break;
        }
        
        lastScrollTop = currentScrollTop;
        
        // Scroll down by one viewport using safe scrollBy (never throws errors!)
        safeScrollBy(stepHeight);
        
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
