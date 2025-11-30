chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'offscreenStitch') {
    stitchImages(request.screenshots, request.viewportWidth, request.viewportHeight, request.totalHeight, request.stepHeight)
      .then(dataUrl => sendResponse({ dataUrl }))
      .catch(error => {
        console.error('Offscreen stitch error:', error);
        sendResponse({ dataUrl: null, error: error.message });
      });
    return true;
  }
});

async function stitchImages(screenshots, viewportWidth, viewportHeight, totalHeight, stepHeight) {
  const canvas = document.createElement('canvas');
  canvas.width = viewportWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d');
  
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  for (let i = 0; i < screenshots.length; i++) {
    const img = await loadImage(screenshots[i]);
    const y = i * stepHeight;
    ctx.drawImage(img, 0, y);
  }
  
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  
  canvas.width = 0;
  canvas.height = 0;
  
  return dataUrl;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}
