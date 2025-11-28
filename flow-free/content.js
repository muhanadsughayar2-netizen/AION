// Flow Content Script
// Handles floating toasts, clipboard writes, and AI platform uploads

// Track last mouse position for toast placement
let lastMouseX = window.innerWidth - 20;
let lastMouseY = 20;

document.addEventListener('mousemove', (e) => {
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
}, { passive: true });

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
  } else if (request.action === 'startSnipOverlay') {
    createSnipOverlay();
    sendResponse({ success: true });
  }
});

// ============ SNIP OVERLAY FUNCTIONALITY ============
let snipOverlay = null;
let snipSelection = null;
let isSnipDrawing = false;
let snipStartX = 0;
let snipStartY = 0;

function createSnipOverlay() {
  // Remove any existing overlay
  if (snipOverlay) snipOverlay.remove();
  
  // Create overlay
  snipOverlay = document.createElement('div');
  snipOverlay.id = 'snaptoai-snip-overlay';
  Object.assign(snipOverlay.style, {
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
  snipSelection = document.createElement('div');
  Object.assign(snipSelection.style, {
    position: 'absolute',
    border: '2px solid #00d9ff',
    backgroundColor: 'rgba(0, 217, 255, 0.1)',
    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
    display: 'none',
    pointerEvents: 'none'
  });
  snipOverlay.appendChild(snipSelection);
  
  // Instruction text
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
  snipOverlay.appendChild(instruction);
  
  // Mouse events
  snipOverlay.addEventListener('mousedown', onSnipMouseDown);
  snipOverlay.addEventListener('mousemove', onSnipMouseMove);
  snipOverlay.addEventListener('mouseup', onSnipMouseUp);
  document.addEventListener('keydown', onSnipKeyDown);
  
  document.body.appendChild(snipOverlay);
  console.log('SnapToAI: Snip overlay activated');
}

function onSnipMouseDown(e) {
  if (e.button !== 0) return;
  isSnipDrawing = true;
  snipStartX = e.clientX;
  snipStartY = e.clientY;
  snipSelection.style.display = 'block';
  snipSelection.style.left = snipStartX + 'px';
  snipSelection.style.top = snipStartY + 'px';
  snipSelection.style.width = '0';
  snipSelection.style.height = '0';
}

function onSnipMouseMove(e) {
  if (!isSnipDrawing) return;
  const left = Math.min(snipStartX, e.clientX);
  const top = Math.min(snipStartY, e.clientY);
  const width = Math.abs(e.clientX - snipStartX);
  const height = Math.abs(e.clientY - snipStartY);
  snipSelection.style.left = left + 'px';
  snipSelection.style.top = top + 'px';
  snipSelection.style.width = width + 'px';
  snipSelection.style.height = height + 'px';
}

function onSnipMouseUp(e) {
  if (!isSnipDrawing) return;
  isSnipDrawing = false;
  
  const left = Math.min(snipStartX, e.clientX);
  const top = Math.min(snipStartY, e.clientY);
  const width = Math.abs(e.clientX - snipStartX);
  const height = Math.abs(e.clientY - snipStartY);
  
  // Minimum size check
  if (width < 10 || height < 10) {
    cleanupSnipOverlay();
    return;
  }
  
  // Get DPR for retina
  const dpr = window.devicePixelRatio || 1;
  const bounds = {
    x: Math.round(left * dpr),
    y: Math.round(top * dpr),
    width: Math.round(width * dpr),
    height: Math.round(height * dpr),
    dpr: dpr
  };
  
  // Remove overlay first
  cleanupSnipOverlay();
  
  // Wait for overlay to be removed, then capture
  setTimeout(() => {
    chrome.runtime.sendMessage({ action: 'snipCapture', bounds }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('SnapToAI Snip error:', chrome.runtime.lastError);
        showToast('Snip failed: ' + chrome.runtime.lastError.message, 'error');
      } else if (response && response.success) {
        showToast(`Snip ${response.count} captured!`, 'success');
      } else if (response && response.error) {
        showToast('Snip failed: ' + response.error, 'error');
      }
    });
  }, 100);
}

function onSnipKeyDown(e) {
  if (e.key === 'Escape') {
    cleanupSnipOverlay();
  }
}

function cleanupSnipOverlay() {
  if (snipOverlay) {
    snipOverlay.remove();
    snipOverlay = null;
    snipSelection = null;
  }
  document.removeEventListener('keydown', onSnipKeyDown);
  isSnipDrawing = false;
}
// ============ END SNIP OVERLAY ============

// Show floating toast notification near cursor
function showToast(message, type = 'success') {
  // Remove any existing toast
  const existingToast = document.getElementById('flow-toast');
  if (existingToast) {
    existingToast.remove();
  }
  
  // Create toast element
  const toast = document.createElement('div');
  toast.id = 'flow-toast';
  toast.textContent = message;
  
  // Calculate position near cursor (offset to avoid covering cursor)
  const offsetX = 20;
  const offsetY = -40;
  let posX = lastMouseX + offsetX;
  let posY = lastMouseY + offsetY;
  
  // For keyboard captures (no recent mouse movement), use top-center
  if (lastMouseX === window.innerWidth - 20 && lastMouseY === 20) {
    posX = (window.innerWidth / 2) - 100;
    posY = 20;
  }
  
  // Keep toast on screen
  if (posX + 200 > window.innerWidth) {
    posX = lastMouseX - 220;
  }
  if (posY < 10) {
    posY = 10;
  }
  
  // Style the toast
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
  
  // Add animation keyframes if not already added
  if (!document.getElementById('flow-toast-styles')) {
    const style = document.createElement('style');
    style.id = 'flow-toast-styles';
    style.textContent = `
      @keyframes flow-toast-fade-in {
        from {
          opacity: 0;
          transform: scale(0.9);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }
      @keyframes flow-toast-fade-out {
        from {
          opacity: 1;
          transform: scale(1);
        }
        to {
          opacity: 0;
          transform: scale(0.9);
        }
      }
    `;
    document.head.appendChild(style);
  }
  
  // Append to body
  document.body.appendChild(toast);
  
  // Auto-remove after 2 seconds with fade out
  setTimeout(() => {
    toast.style.animation = 'flow-toast-fade-out 0.3s ease-out';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 2000);
}

// Write screenshot to clipboard (requires user gesture context)
async function writeToClipboard(dataUrl) {
  try {
    // Convert dataURL to Blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    
    // Write to clipboard
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

// Upload snaps to AI platform (pulls from storage)
async function uploadToAI(platform, useSelectedOnly = false) {
  try {
    // Check if we should use selected snaps or all snaps
    let snaps;
    if (useSelectedOnly) {
      // Get selected snaps that were stored by background
      const selectedResult = await chrome.storage.session.get('selectedSnapsForUpload');
      snaps = selectedResult.selectedSnapsForUpload || [];
      // Clean up after retrieving
      await chrome.storage.session.remove('selectedSnapsForUpload');
    } else {
      // Get all snaps from storage
      const result = await chrome.storage.session.get('snaps');
      snaps = result.snaps || [];
    }
    
    if (snaps.length === 0) {
      showToast('No snaps to upload', 'error');
      return { success: false, error: 'No snaps found' };
    }
    
    // Find the file input for this platform
    const fileInput = await findFileInput(platform);
    
    if (!fileInput) {
      showToast('Could not find file input', 'error');
      return { success: false, error: 'File input not found' };
    }
    
    // Upload each snap with delay
    for (let i = 0; i < snaps.length; i++) {
      const dataUrl = snaps[i];
      
      // Convert dataURL to File
      const file = await dataUrlToFile(dataUrl, `snap_${i + 1}.png`);
      
      // Create DataTransfer and assign to input
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
      
      // Dispatch change event
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      
      // Wait before next upload
      if (i < snaps.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1400));
      }
    }
    
    // Show success toast
    showToast('All snaps uploaded ✓', 'success');
    
    // Clear snaps from storage after successful upload
    await chrome.storage.session.remove('snaps');
    
    // Notify background to update badge
    chrome.runtime.sendMessage({ action: 'uploadComplete' });
    
    return { success: true };
  } catch (error) {
    console.error('Upload failed:', error);
    showToast('Upload failed', 'error');
    return { success: false, error: error.message };
  }
}

// Find file input for AI platform
async function findFileInput(platform) {
  let selector = null;
  
  if (platform.includes('chatgpt.com') || platform.includes('chat.openai.com')) {
    // ChatGPT file input selectors
    selector = 'input[type="file"][accept*="image"]';
  } else if (platform.includes('claude.ai')) {
    // Claude file input selectors
    selector = 'input[type="file"]';
  } else if (platform.includes('grok.com')) {
    // Grok file input selectors
    selector = 'input[type="file"]';
  }
  
  if (!selector) return null;
  
  // Try to find the input
  let input = document.querySelector(selector);
  
  // If not found, wait a bit and try again
  if (!input) {
    await new Promise(resolve => setTimeout(resolve, 500));
    input = document.querySelector(selector);
  }
  
  return input;
}

// Convert dataURL to File object
async function dataUrlToFile(dataUrl, filename) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: 'image/png' });
}
