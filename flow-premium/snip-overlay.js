// SnapToAI Snip Overlay - Content Script
// This creates the snipping selection overlay on the page

(function() {
  // Remove any existing overlay
  const existing = document.getElementById('snaptoai-snip-overlay');
  if (existing) existing.remove();
  
  // Create overlay container
  const overlay = document.createElement('div');
  overlay.id = 'snaptoai-snip-overlay';
  
  // Styling for the overlay
  Object.assign(overlay.style, {
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
  const selection = document.createElement('div');
  selection.id = 'snaptoai-snip-selection';
  Object.assign(selection.style, {
    position: 'absolute',
    border: '2px solid #00d9ff',
    backgroundColor: 'rgba(0, 217, 255, 0.1)',
    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
    display: 'none',
    pointerEvents: 'none'
  });
  overlay.appendChild(selection);
  
  // Create instruction text
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
  overlay.appendChild(instruction);
  
  // Tracking variables
  let isDrawing = false;
  let startX = 0;
  let startY = 0;
  
  // Mouse down - start selection
  overlay.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDrawing = true;
    startX = e.clientX;
    startY = e.clientY;
    selection.style.display = 'block';
    selection.style.left = startX + 'px';
    selection.style.top = startY + 'px';
    selection.style.width = '0';
    selection.style.height = '0';
  });
  
  // Mouse move - update selection rectangle
  overlay.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    
    const currentX = e.clientX;
    const currentY = e.clientY;
    
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    
    selection.style.left = left + 'px';
    selection.style.top = top + 'px';
    selection.style.width = width + 'px';
    selection.style.height = height + 'px';
  });
  
  // Mouse up - complete selection and capture
  overlay.addEventListener('mouseup', (e) => {
    if (!isDrawing) return;
    isDrawing = false;
    
    const currentX = e.clientX;
    const currentY = e.clientY;
    
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    
    // Minimum selection size
    if (width < 10 || height < 10) {
      overlay.remove();
      return;
    }
    
    // Get device pixel ratio for retina displays
    const dpr = window.devicePixelRatio || 1;
    
    // Calculate bounds for capture
    const bounds = {
      x: Math.round(left * dpr),
      y: Math.round(top * dpr),
      width: Math.round(width * dpr),
      height: Math.round(height * dpr),
      dpr: dpr
    };
    
    // Remove overlay before capture
    overlay.remove();
    document.removeEventListener('keydown', handleKeyDown);
    
    // Small delay to ensure overlay is gone, then capture
    setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'snipCapture', bounds }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('SnapToAI Snip error:', chrome.runtime.lastError);
        } else if (response && response.success) {
          console.log('SnapToAI: Snip captured!', response.count);
        } else if (response && response.error) {
          console.error('SnapToAI Snip failed:', response.error);
        }
      });
    }, 100);
  });
  
  // ESC key to cancel
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', handleKeyDown);
    }
  };
  document.addEventListener('keydown', handleKeyDown);
  
  // Append overlay to document
  document.body.appendChild(overlay);
  
  console.log('SnapToAI: Snip overlay activated');
})();
