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
    // Show toast (clipboard handled by popup for reliable user gesture)
    showToast(request.message, 'success');
    sendResponse({ success: true });
  } else if (request.action === 'beginUpload') {
    // Pull snaps from storage and upload
    uploadToAI(request.platform).then(sendResponse);
    return true;
  }
});

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
async function uploadToAI(platform) {
  try {
    // Pull snaps from chrome.storage.session
    const result = await chrome.storage.session.get('snaps');
    const snaps = result.snaps || [];
    
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
