// SnapToAI Offscreen Document
// Handles canvas operations for full-page stitching
// This runs independently of popup lifecycle

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'stitchFullPage') {
    handleStitch(message)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
});

async function handleStitch(message) {
  const { tiles, viewportWidth, viewportHeight, overlap } = message;
  
  console.log('[SnapToAI Offscreen] Starting stitch:', tiles.length, 'tiles');
  
  if (!tiles || tiles.length === 0) {
    throw new Error('No tiles to stitch');
  }
  
  // Load all tile images
  const images = await Promise.all(tiles.map(loadImage));
  
  // Calculate total height (accounting for overlap)
  const effectiveHeight = viewportHeight - overlap;
  const totalHeight = (tiles.length - 1) * effectiveHeight + viewportHeight;
  
  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = viewportWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d');
  
  // Draw each tile
  for (let i = 0; i < images.length; i++) {
    const y = i * effectiveHeight;
    ctx.drawImage(images[i], 0, y);
  }
  
  // Add invisible watermark
  addWatermark(ctx, canvas.width, canvas.height);
  
  // Convert to data URL
  const dataUrl = canvas.toDataURL('image/png');
  
  console.log('[SnapToAI Offscreen] Stitch complete, size:', Math.round(dataUrl.length / 1024), 'KB');
  
  return { success: true, dataUrl };
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load tile image'));
    img.src = dataUrl;
  });
}

function addWatermark(ctx, width, height) {
  ctx.save();
  ctx.globalAlpha = 0.01;
  ctx.fillStyle = '#ffffff';
  ctx.font = '10px Arial';
  const text = 'SnapToAI.com';
  const positions = [
    { x: 10, y: height - 10 },
    { x: width - 80, y: 10 },
    { x: width / 2 - 30, y: height / 2 }
  ];
  positions.forEach(pos => ctx.fillText(text, pos.x, pos.y));
  ctx.restore();
}
