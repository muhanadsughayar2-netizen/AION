// SnapToAI Content Script — BULLETPROOF VERSION
// Guard MUST be at very top with early return

if (window.__snaptoai_loaded) {
  // Already injected — exit immediately (prevents re-declaration errors)
  return;
}
window.__snaptoai_loaded = true;

// ═══════════════════════════════════════════════════════════════════════════
// ALL CODE BELOW THIS LINE (protected from re-injection)
// ═══════════════════════════════════════════════════════════════════════════

// Track last mouse position for toast placement
let lastMouseX = window.innerWidth - 20;
let lastMouseY = 20;

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
