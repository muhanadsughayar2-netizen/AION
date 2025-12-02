// Flow Annotation Tool - SIMPLE VERSION (only working tools)

let canvas, ctx;
let currentTool = 'highlight';
let currentColor = '#00d9ff';
let brushSize = 12;
let isDrawing = false;
let startX, startY;
let annotations = [];
let originalImage = null;
let calloutNumber = 1;
let highlightPoints = [];
let draggingAnnotation = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let pendingStickerText = null;

// Crop/Snip mode variables
let isSnipMode = false;
let cropRect = null;
let isCropping = false;
let cropStartX, cropStartY, cropEndX, cropEndY;

// Full Page Paginated Mode variables
let isFullPageMode = false;
let pages = []; // Array of page image data URLs
let pageImages = []; // Array of loaded Image objects
let pageAnnotations = []; // Annotations per page: [[page0 annotations], [page1 annotations], ...]
let pageOriginalImages = []; // Original ImageData per page
let currentPageIndex = 0;

// Zoom and Frame variables - will be overridden by settings
let zoomLevel = 1.0;
let hasBrowserFrame = false;
let browserFrameUrl = '';
let browserFrameStyle = 'mac'; // 'mac', 'windows', 'minimal'
let hasBorder = true; // ENABLED by default for professional output
let borderColor = '#00bcd4'; // Cyan like GoFullPage
let borderWidth = 8; // Default to thick
let borderRadius = 0; // Square by default for professional look

// Load settings from storage
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get('snaptoaiSettings');
    const settings = result.snaptoaiSettings || {};
    
    // Apply border defaults
    if (settings.defaultBorderEnabled !== undefined) {
      hasBorder = settings.defaultBorderEnabled;
    }
    if (settings.defaultBorderColor) {
      borderColor = settings.defaultBorderColor;
      document.getElementById('borderColor').value = borderColor;
    }
    if (settings.defaultBorderWidth) {
      borderWidth = settings.defaultBorderWidth;
      document.getElementById('borderWidth').value = borderWidth;
    }
    
    // Apply frame defaults
    if (settings.defaultFrameStyle && settings.defaultFrameStyle !== 'none') {
      hasBrowserFrame = true;
      browserFrameStyle = settings.defaultFrameStyle;
      document.getElementById('frameStyle').value = browserFrameStyle;
    }
    
  } catch (error) {
    console.log('Failed to load settings:', error);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  
  // Load settings first (for default border/frame preferences)
  await loadSettings();
  
  // Check mode from URL params
  const urlParams = new URLSearchParams(window.location.search);
  isSnipMode = urlParams.get('mode') === 'snip';
  isFullPageMode = urlParams.get('mode') === 'fullpage';
  
  if (isSnipMode) {
    // Auto-select crop tool in snip mode
    currentTool = 'crop';
    document.title = 'Snip Mode - SnapToAI';
    updateStatus('Draw a rectangle to snip. Click Save Snip when done.');
    
    // Simplify toolbar for snip mode - hide all except scissors, save, exit
    simplifyToolbarForSnipMode();
  }
  
  if (isFullPageMode) {
    document.title = 'Full Page Editor - SnapToAI';
    setupFullPageMode();
  }
  
  setupEventListeners();
  loadCustomStickers();
  loadImage();
  
  // Initialize border UI to reflect current settings
  initializeBorderUI();
  
  // Highlight crop tool if in snip mode
  if (isSnipMode) {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
    const cropBtn = document.querySelector('.tool-btn[data-tool="crop"]');
    if (cropBtn) cropBtn.classList.add('active');
  } else {
    // Hide scissors in regular edit mode - scissors is only for snip mode
    const cropBtn = document.querySelector('.tool-btn[data-tool="crop"]');
    if (cropBtn) cropBtn.style.display = 'none';
  }
});

// Initialize border and frame UI to reflect current settings
function initializeBorderUI() {
  // Border UI
  const borderBtn = document.getElementById('toggleBorder');
  const colorPicker = document.getElementById('borderColor');
  const widthSelect = document.getElementById('borderWidth');
  const radiusSelect = document.getElementById('borderRadius');
  
  if (hasBorder) {
    borderBtn.classList.add('active');
    colorPicker.style.display = 'block';
    widthSelect.style.display = 'block';
    radiusSelect.style.display = 'block';
  } else {
    borderBtn.classList.remove('active');
    colorPicker.style.display = 'none';
    widthSelect.style.display = 'none';
    radiusSelect.style.display = 'none';
  }
  
  // Browser frame UI
  const frameBtn = document.getElementById('toggleBrowserFrame');
  const urlInput = document.getElementById('urlInput');
  const frameStyleSelect = document.getElementById('frameStyle');
  
  if (hasBrowserFrame) {
    frameBtn.classList.add('active');
    urlInput.style.display = 'block';
    frameStyleSelect.style.display = 'block';
  } else {
    frameBtn.classList.remove('active');
    urlInput.style.display = 'none';
    frameStyleSelect.style.display = 'none';
  }
  
  // Apply initial zoom
  applyZoom();
}

// Simplify toolbar for snip mode - only scissors, save snip, exit
function simplifyToolbarForSnipMode() {
  // Hide all tool buttons except scissors (crop)
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    if (btn.dataset.tool !== 'crop') {
      btn.style.display = 'none';
    }
  });
  
  // Hide all sticker buttons
  document.querySelectorAll('.sticker-btn').forEach(btn => {
    btn.style.display = 'none';
  });
  
  // Hide custom stickers area and create button
  const customStickers = document.getElementById('customStickers');
  if (customStickers) customStickers.style.display = 'none';
  
  const createStickerBtn = document.getElementById('createStickerBtn');
  if (createStickerBtn) createStickerBtn.style.display = 'none';
  
  // Hide color picker and brush size
  const colorPicker = document.getElementById('colorPicker');
  if (colorPicker) colorPicker.style.display = 'none';
  
  const sizeControl = document.querySelector('.size-control');
  if (sizeControl) sizeControl.style.display = 'none';
  
  // Hide undo and clear buttons
  const undoBtn = document.getElementById('undoBtn');
  if (undoBtn) undoBtn.style.display = 'none';
  
  const clearBtn = document.getElementById('clearBtn');
  if (clearBtn) clearBtn.style.display = 'none';
  
  // Update save button text
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.innerHTML = '✂️ Save Snip';
  
  // Change cancel button to "Exit Snip Mode"
  const cancelBtn = document.getElementById('cancelBtn');
  if (cancelBtn) cancelBtn.innerHTML = '✖ Exit Snip Mode';
}

// Setup Full Page Paginated Mode
function setupFullPageMode() {
  // Show page navigation
  const pageNav = document.getElementById('pageNav');
  if (pageNav) pageNav.style.display = 'flex';
  
  // Update save button text
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.innerHTML = '💾 Save All Pages';
  
  // Setup navigation buttons
  document.getElementById('prevPage').addEventListener('click', () => navigatePage(-1));
  document.getElementById('nextPage').addEventListener('click', () => navigatePage(1));
  
  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (isFullPageMode && !document.activeElement.matches('input, textarea')) {
      if (e.key === 'ArrowLeft') navigatePage(-1);
      if (e.key === 'ArrowRight') navigatePage(1);
    }
  });
  
  updateStatus('Use ◀ ▶ to navigate pages. Edit each page at full size!');
}

// Navigate between pages
async function navigatePage(direction) {
  if (!isFullPageMode || pages.length === 0) return;
  
  // Save current page annotations before navigating (deep copy)
  pageAnnotations[currentPageIndex] = JSON.parse(JSON.stringify(annotations));
  
  // Calculate new index
  const newIndex = currentPageIndex + direction;
  if (newIndex < 0 || newIndex >= pages.length) return;
  
  currentPageIndex = newIndex;
  
  // Load page if not yet loaded (lazy loading)
  if (!pageImages[currentPageIndex]) {
    updateStatus(`Loading page ${currentPageIndex + 1}...`);
    await loadPageImage(currentPageIndex);
  }
  
  loadCurrentPage();
  updatePageIndicator();
  
  // Preload neighbors for smooth navigation
  preloadNeighbors(currentPageIndex);
}

// Load current page into canvas
function loadCurrentPage() {
  if (!pageImages[currentPageIndex]) {
    updateStatus(`Page ${currentPageIndex + 1} loading...`);
    return;
  }
  
  const img = pageImages[currentPageIndex];
  canvas.width = img.width;
  canvas.height = img.height;
  
  // Draw the image first
  ctx.drawImage(img, 0, 0);
  
  // Restore original image data for this page
  originalImage = pageOriginalImages[currentPageIndex];
  
  // Restore annotations for this page (deep copy)
  annotations = pageAnnotations[currentPageIndex] 
    ? JSON.parse(JSON.stringify(pageAnnotations[currentPageIndex])) 
    : [];
  
  // Redraw with annotations
  redraw();
}

// Update page indicator
function updatePageIndicator() {
  const indicator = document.getElementById('pageIndicator');
  if (indicator) {
    indicator.textContent = `Page ${currentPageIndex + 1} / ${pages.length}`;
  }
  
  // Update button states
  document.getElementById('prevPage').disabled = currentPageIndex === 0;
  document.getElementById('nextPage').disabled = currentPageIndex === pages.length - 1;
}

function setupEventListeners() {
  // Zoom controls
  document.getElementById('zoomIn').addEventListener('click', () => {
    zoomLevel = Math.min(zoomLevel + 0.25, 3.0);
    applyZoom();
  });
  
  document.getElementById('zoomOut').addEventListener('click', () => {
    zoomLevel = Math.max(zoomLevel - 0.25, 0.25);
    applyZoom();
  });
  
  document.getElementById('zoomReset').addEventListener('click', () => {
    zoomLevel = 1.0;
    applyZoom();
  });
  
  // Browser frame toggle
  document.getElementById('toggleBrowserFrame').addEventListener('click', () => {
    hasBrowserFrame = !hasBrowserFrame;
    const btn = document.getElementById('toggleBrowserFrame');
    const urlInput = document.getElementById('urlInput');
    const frameStyleSelect = document.getElementById('frameStyle');
    
    if (hasBrowserFrame) {
      btn.classList.add('active');
      urlInput.style.display = 'block';
      frameStyleSelect.style.display = 'block';
      browserFrameUrl = urlInput.value || 'https://example.com';
    } else {
      btn.classList.remove('active');
      urlInput.style.display = 'none';
      frameStyleSelect.style.display = 'none';
    }
    redraw();
  });
  
  document.getElementById('urlInput').addEventListener('input', (e) => {
    browserFrameUrl = e.target.value;
    if (hasBrowserFrame) redraw();
  });
  
  document.getElementById('frameStyle').addEventListener('change', (e) => {
    browserFrameStyle = e.target.value;
    if (hasBrowserFrame) redraw();
  });
  
  // Border toggle
  document.getElementById('toggleBorder').addEventListener('click', () => {
    hasBorder = !hasBorder;
    const btn = document.getElementById('toggleBorder');
    const colorPicker = document.getElementById('borderColor');
    const widthSelect = document.getElementById('borderWidth');
    const radiusSelect = document.getElementById('borderRadius');
    
    if (hasBorder) {
      btn.classList.add('active');
      colorPicker.style.display = 'block';
      widthSelect.style.display = 'block';
      radiusSelect.style.display = 'block';
    } else {
      btn.classList.remove('active');
      colorPicker.style.display = 'none';
      widthSelect.style.display = 'none';
      radiusSelect.style.display = 'none';
    }
    redraw();
  });
  
  document.getElementById('borderColor').addEventListener('input', (e) => {
    borderColor = e.target.value;
    if (hasBorder) redraw();
  });
  
  document.getElementById('borderWidth').addEventListener('change', (e) => {
    borderWidth = parseInt(e.target.value);
    if (hasBorder) redraw();
  });
  
  document.getElementById('borderRadius').addEventListener('change', (e) => {
    borderRadius = parseInt(e.target.value);
    if (hasBorder) redraw();
  });
  
  // Tools
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
      pendingStickerText = null; // Clear pending sticker when switching tools
      updateStatus('Draw highlights, add numbers, or add text. All draggable!');
    });
  });
  
  // Color & size
  document.getElementById('colorPicker').addEventListener('change', (e) => {
    currentColor = e.target.value;
  });
  
  document.getElementById('brushSize').addEventListener('input', (e) => {
    brushSize = parseInt(e.target.value);
    document.getElementById('sizeValue').textContent = brushSize + 'px';
  });
  
  // Stickers - click to place at cursor position
  setupStickerListeners();
  
  // Create custom sticker
  document.getElementById('createStickerBtn').addEventListener('click', createCustomSticker);
  
  // Controls
  document.getElementById('undoBtn').addEventListener('click', () => {
    const removed = annotations.pop();
    if (removed && removed.tool === 'callout') {
      calloutNumber--;
    }
    redraw();
  });
  
  document.getElementById('clearBtn').addEventListener('click', () => {
    annotations = [];
    calloutNumber = 1;
    redraw();
  });
  
  document.getElementById('saveBtn').addEventListener('click', save);
  document.getElementById('cancelBtn').addEventListener('click', () => window.close());
  
  // Canvas
  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mouseup', handleMouseUp);
  
  // Text input
  const textInput = document.getElementById('textInput');
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = textInput.value.trim();
      if (text) {
        annotations.push({
          tool: 'text',
          color: currentColor,
          x: startX,
          y: startY,
          text
        });
        redraw();
      }
      textInput.style.display = 'none';
    }
  });
}

async function loadImage() {
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode');
  
  // Full Page Mode - load pages from local storage
  if (isFullPageMode) {
    loadFullPageImages();
    return;
  }
  
  // Edit Mode - load image from local storage (handles large images)
  if (mode === 'edit') {
    try {
      const result = await chrome.storage.local.get(['editImage', 'editIndex']);
      const imageUrl = result.editImage;
      
      if (!imageUrl) {
        updateStatus('Image not found. Please try again.');
        return;
      }
      
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        originalImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        // Clear storage after loading
        chrome.storage.local.remove(['editImage']);
        
        // Redraw immediately to apply default border styling
        // (originalImage is now set, so redraw() will restore image properly)
        redraw();
      };
      img.onerror = () => {
        updateStatus('Failed to load image.');
      };
      img.src = imageUrl;
    } catch (error) {
      console.log('Load edit image error:', error);
      updateStatus('Failed to load image.');
    }
    return;
  }
  
  // Legacy mode - load from URL param (for small images/snip mode)
  const imageUrl = urlParams.get('img');
  if (imageUrl) {
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      originalImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // Redraw immediately to apply default border styling
      redraw();
    };
    img.src = imageUrl;
  }
}

// Load pages for full page mode - LAZY LOADING for performance
async function loadFullPageImages() {
  try {
    // Get pages from local storage (unlimited size)
    const result = await chrome.storage.local.get('fullPageScreenshots');
    pages = result.fullPageScreenshots || [];
    
    if (pages.length === 0) {
      updateStatus('No pages found. Please try again.');
      return;
    }
    
    // Show warning for large captures
    if (pages.length > 30) {
      updateStatus(`Loading ${pages.length} pages (large capture - please wait)...`);
    } else {
      updateStatus(`Loading ${pages.length} pages...`);
    }
    
    // Initialize arrays - but DON'T load all images yet (lazy loading)
    pageAnnotations = new Array(pages.length).fill(null).map(() => []);
    pageOriginalImages = new Array(pages.length).fill(null);
    pageImages = new Array(pages.length).fill(null);
    
    console.log(`[SnapToAI] Prepared ${pages.length} pages for lazy loading`);
    
    // Load first page and neighbors
    currentPageIndex = 0;
    await loadPageImage(0);
    if (pages.length > 1) {
      loadPageImage(1); // Preload next page (don't await)
    }
    
    loadCurrentPage();
    updatePageIndicator();
    
    if (pages.length > 50) {
      updateStatus(`Page 1 of ${pages.length} - Large capture loaded!`);
    } else {
      updateStatus(`Page 1 of ${pages.length} - Use ◀ ▶ to navigate`);
    }
    
  } catch (error) {
    console.error('Failed to load full page images:', error);
    updateStatus('Failed to load pages. Please try again.');
  }
}

// Load a single page image on demand (lazy loading)
async function loadPageImage(index) {
  if (index < 0 || index >= pages.length) return;
  if (pageImages[index]) return; // Already loaded
  
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      pageImages[index] = img;
      
      // Create original image data for this page
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = img.width;
      tempCanvas.height = img.height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(img, 0, 0);
      pageOriginalImages[index] = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      
      resolve();
    };
    img.onerror = () => {
      console.log(`Failed to load page ${index + 1}`);
      resolve(); // Don't block on error
    };
    img.src = pages[index];
  });
}

// Preload neighboring pages for smooth navigation
function preloadNeighbors(currentIndex) {
  // Preload next 2 and previous 1 pages
  const toPreload = [currentIndex - 1, currentIndex + 1, currentIndex + 2];
  toPreload.forEach(idx => {
    if (idx >= 0 && idx < pages.length && !pageImages[idx]) {
      loadPageImage(idx); // Fire and forget
    }
  });
  
  // Release memory for distant pages (keep 5 page window)
  const keepRange = 3;
  for (let i = 0; i < pages.length; i++) {
    if (Math.abs(i - currentIndex) > keepRange) {
      if (pageImages[i]) {
        pageImages[i] = null; // Release Image object
        pageOriginalImages[i] = null; // Release ImageData
      }
    }
  }
}

function handleMouseDown(e) {
  const rect = canvas.getBoundingClientRect();
  startX = (e.clientX - rect.left) * (canvas.width / rect.width);
  startY = (e.clientY - rect.top) * (canvas.height / rect.height);
  
  // Handle crop tool
  if (currentTool === 'crop') {
    isCropping = true;
    cropStartX = startX;
    cropStartY = startY;
    cropEndX = startX;
    cropEndY = startY;
    cropRect = null;
    return;
  }
  
  // Check for drag
  const clicked = findAnnotation(startX, startY);
  if (clicked) {
    draggingAnnotation = clicked;
    dragOffsetX = startX - clicked.x;
    dragOffsetY = startY - clicked.y;
    canvas.style.cursor = 'grabbing';
    return;
  }
  
  if (currentTool === 'text') {
    const textInput = document.getElementById('textInput');
    const canvasRect = canvas.getBoundingClientRect();
    const container = document.querySelector('.canvas-container');
    const containerRect = container.getBoundingClientRect();
    
    // Convert canvas coordinates to container-relative coordinates
    const canvasLeft = canvasRect.left - containerRect.left;
    const canvasTop = canvasRect.top - containerRect.top;
    const scaleX = canvasRect.width / canvas.width;
    const scaleY = canvasRect.height / canvas.height;
    
    const inputX = canvasLeft + (startX * scaleX);
    const inputY = canvasTop + (startY * scaleY);
    
    textInput.style.display = 'block';
    textInput.style.left = inputX + 'px';
    textInput.style.top = inputY + 'px';
    textInput.value = '';
    textInput.focus();
  } else if (currentTool === 'sticker' && pendingStickerText) {
    annotations.push({
      tool: 'sticker',
      text: pendingStickerText,
      color: currentColor,
      x: startX,
      y: startY
    });
    pendingStickerText = null;
    redraw();
    updateStatus('Draw highlights, add numbers, or add text. All draggable!');
  } else if (currentTool === 'rectangle' || currentTool === 'arrow') {
    isDrawing = true;
    // Store starting position for rectangle/arrow
  } else if (currentTool === 'callout') {
    const label = prompt('Label:', 'Step ' + calloutNumber);
    if (label) {
      annotations.push({
        tool: 'callout',
        number: calloutNumber++,
        text: label,
        color: currentColor,
        x: startX,
        y: startY
      });
      redraw();
    }
  } else if (currentTool === 'highlight') {
    isDrawing = true;
    highlightPoints = [{x: startX, y: startY}];
  }
}

function handleMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  
  // Handle crop drawing
  if (isCropping && currentTool === 'crop') {
    cropEndX = x;
    cropEndY = y;
    redraw();
    drawCropPreview();
    return;
  }
  
  if (draggingAnnotation) {
    draggingAnnotation.x = x - dragOffsetX;
    draggingAnnotation.y = y - dragOffsetY;
    
    // Move highlight points
    if (draggingAnnotation.tool === 'highlight' && draggingAnnotation.points) {
      const deltaX = (x - dragOffsetX) - draggingAnnotation.centerX;
      const deltaY = (y - dragOffsetY) - draggingAnnotation.centerY;
      draggingAnnotation.points.forEach(p => {
        p.x += deltaX;
        p.y += deltaY;
      });
      draggingAnnotation.centerX = x - dragOffsetX;
      draggingAnnotation.centerY = y - dragOffsetY;
    }
    
    redraw();
    return;
  }
  
  if (!isDrawing) {
    canvas.style.cursor = currentTool === 'crop' ? 'crosshair' : (findAnnotation(x, y) ? 'grab' : 'crosshair');
    return;
  }
  
  // Preview rectangle/arrow while drawing
  if (currentTool === 'rectangle') {
    redraw();
    const x1 = Math.min(startX, x);
    const y1 = Math.min(startY, y);
    const width = Math.abs(x - startX);
    const height = Math.abs(y - startY);
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = brushSize;
    ctx.shadowColor = currentColor;
    ctx.shadowBlur = 10;
    ctx.globalAlpha = 0.7;
    ctx.strokeRect(x1, y1, width, height);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    return;
  }
  
  if (currentTool === 'arrow') {
    redraw();
    ctx.strokeStyle = currentColor;
    ctx.fillStyle = currentColor;
    ctx.lineWidth = brushSize;
    ctx.shadowColor = currentColor;
    ctx.shadowBlur = 10;
    ctx.globalAlpha = 0.7;
    
    // Draw line
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(x, y);
    ctx.stroke();
    
    // Draw arrowhead
    const angle = Math.atan2(y - startY, x - startX);
    const headLength = 20;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - headLength * Math.cos(angle - Math.PI / 6), y - headLength * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x - headLength * Math.cos(angle + Math.PI / 6), y - headLength * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    return;
  }
  
  if (currentTool === 'highlight') {
    highlightPoints.push({x, y});
    redraw();
    
    // Draw preview
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.6;
    ctx.shadowColor = currentColor;
    ctx.shadowBlur = 15;
    
    ctx.beginPath();
    ctx.moveTo(highlightPoints[0].x, highlightPoints[0].y);
    for (let i = 1; i < highlightPoints.length; i++) {
      ctx.lineTo(highlightPoints[i].x, highlightPoints[i].y);
    }
    ctx.stroke();
    
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}

function handleMouseUp(e) {
  // Handle crop completion
  if (isCropping && currentTool === 'crop') {
    isCropping = false;
    
    // Calculate crop rectangle (normalize coordinates)
    const x1 = Math.min(cropStartX, cropEndX);
    const y1 = Math.min(cropStartY, cropEndY);
    const x2 = Math.max(cropStartX, cropEndX);
    const y2 = Math.max(cropStartY, cropEndY);
    const width = x2 - x1;
    const height = y2 - y1;
    
    // Only create crop if it's a valid size
    if (width > 10 && height > 10) {
      cropRect = { x: x1, y: y1, width, height };
      redraw();
      drawCropRect();
      updateStatus(`Snip area selected (${Math.round(width)}x${Math.round(height)}). Click Save Snip to add to your snaps.`);
    } else {
      cropRect = null;
      redraw();
      updateStatus('Draw a larger rectangle to snip.');
    }
    return;
  }
  
  if (draggingAnnotation) {
    draggingAnnotation = null;
    canvas.style.cursor = 'crosshair';
    return;
  }
  
  if (!isDrawing) return;
  
  // Get end position for rectangle/arrow using the passed event parameter
  const rect = canvas.getBoundingClientRect();
  const endX = e ? (e.clientX - rect.left) * (canvas.width / rect.width) : startX;
  const endY = e ? (e.clientY - rect.top) * (canvas.height / rect.height) : startY;
  
  if (currentTool === 'rectangle') {
    const x1 = Math.min(startX, endX);
    const y1 = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);
    
    if (width > 5 && height > 5) {
      annotations.push({
        tool: 'rectangle',
        x: x1,
        y: y1,
        width: width,
        height: height,
        color: currentColor,
        lineWidth: brushSize
      });
      redraw();
    }
    isDrawing = false;
    return;
  }
  
  if (currentTool === 'arrow') {
    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length > 10) {
      annotations.push({
        tool: 'arrow',
        x1: startX,
        y1: startY,
        x2: endX,
        y2: endY,
        color: currentColor,
        lineWidth: brushSize
      });
      redraw();
    }
    isDrawing = false;
    return;
  }
  
  if (currentTool === 'highlight' && highlightPoints.length > 1) {
    const xs = highlightPoints.map(p => p.x);
    const ys = highlightPoints.map(p => p.y);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
    
    annotations.push({
      tool: 'highlight',
      color: currentColor,
      size: brushSize,
      points: [...highlightPoints],
      x: centerX,
      y: centerY,
      centerX,
      centerY
    });
    highlightPoints = [];
    redraw();
  }
  
  isDrawing = false;
}

// Draw crop preview while dragging
function drawCropPreview() {
  const x1 = Math.min(cropStartX, cropEndX);
  const y1 = Math.min(cropStartY, cropEndY);
  const width = Math.abs(cropEndX - cropStartX);
  const height = Math.abs(cropEndY - cropStartY);
  
  // Draw semi-transparent overlay outside crop area
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, canvas.width, y1); // Top
  ctx.fillRect(0, y1 + height, canvas.width, canvas.height - y1 - height); // Bottom
  ctx.fillRect(0, y1, x1, height); // Left
  ctx.fillRect(x1 + width, y1, canvas.width - x1 - width, height); // Right
  
  // Draw crop border
  ctx.strokeStyle = '#00d9ff';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.strokeRect(x1, y1, width, height);
  ctx.setLineDash([]);
  
  // Draw corner handles
  const handleSize = 8;
  ctx.fillStyle = '#00d9ff';
  ctx.fillRect(x1 - handleSize/2, y1 - handleSize/2, handleSize, handleSize);
  ctx.fillRect(x1 + width - handleSize/2, y1 - handleSize/2, handleSize, handleSize);
  ctx.fillRect(x1 - handleSize/2, y1 + height - handleSize/2, handleSize, handleSize);
  ctx.fillRect(x1 + width - handleSize/2, y1 + height - handleSize/2, handleSize, handleSize);
  
  // Draw dimensions label
  ctx.fillStyle = 'rgba(0, 217, 255, 0.9)';
  ctx.font = 'bold 14px Arial';
  ctx.fillText(`${Math.round(width)} x ${Math.round(height)}`, x1 + 5, y1 - 8);
}

// Draw final crop rectangle
function drawCropRect() {
  if (!cropRect) return;
  
  const { x, y, width, height } = cropRect;
  
  // Draw semi-transparent overlay outside crop area
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, canvas.width, y); // Top
  ctx.fillRect(0, y + height, canvas.width, canvas.height - y - height); // Bottom
  ctx.fillRect(0, y, x, height); // Left
  ctx.fillRect(x + width, y, canvas.width - x - width, height); // Right
  
  // Draw crop border
  ctx.strokeStyle = '#00d9ff';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, width, height);
  
  // Draw corner handles
  const handleSize = 10;
  ctx.fillStyle = '#00d9ff';
  ctx.fillRect(x - handleSize/2, y - handleSize/2, handleSize, handleSize);
  ctx.fillRect(x + width - handleSize/2, y - handleSize/2, handleSize, handleSize);
  ctx.fillRect(x - handleSize/2, y + height - handleSize/2, handleSize, handleSize);
  ctx.fillRect(x + width - handleSize/2, y + height - handleSize/2, handleSize, handleSize);
  
  // Draw "✂️ SNIP" label
  ctx.fillStyle = 'rgba(0, 217, 255, 0.95)';
  const labelWidth = 80;
  const labelHeight = 28;
  ctx.fillRect(x + width/2 - labelWidth/2, y + height/2 - labelHeight/2, labelWidth, labelHeight);
  ctx.fillStyle = '#000';
  ctx.font = 'bold 14px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('✂️ SNIP', x + width/2, y + height/2);
}

function findAnnotation(x, y) {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const ann = annotations[i];
    const tolerance = 50;
    
    if (ann.tool === 'highlight' && ann.points) {
      for (let p of ann.points) {
        if (Math.sqrt((x - p.x) ** 2 + (y - p.y) ** 2) < (ann.size || 12)) {
          return ann;
        }
      }
    } else if (Math.abs(x - ann.x) < tolerance && Math.abs(y - ann.y) < tolerance) {
      return ann;
    }
  }
  return null;
}

// Apply zoom to canvas container
function applyZoom() {
  const container = document.querySelector('.canvas-container');
  container.style.transform = `scale(${zoomLevel})`;
  container.style.transformOrigin = 'center top';
  document.getElementById('zoomLevel').textContent = Math.round(zoomLevel * 100) + '%';
}

// Draw browser frame on canvas - with style presets
function drawBrowserFrame(targetCtx, targetCanvas) {
  if (!hasBrowserFrame) return null;
  
  const useCtx = targetCtx || ctx;
  const useCanvas = targetCanvas || canvas;
  const frameHeight = browserFrameStyle === 'minimal' ? 32 : 44;
  
  const originalData = useCtx.getImageData(0, 0, useCanvas.width, useCanvas.height);
  
  // Expand canvas for frame
  const newCanvas = document.createElement('canvas');
  newCanvas.width = useCanvas.width;
  newCanvas.height = useCanvas.height + frameHeight;
  const newCtx = newCanvas.getContext('2d');
  
  if (browserFrameStyle === 'mac') {
    // macOS Style - Dark with traffic lights
    newCtx.fillStyle = '#3a3a3c';
    newCtx.fillRect(0, 0, newCanvas.width, frameHeight);
    
    // Traffic lights
    const buttonY = frameHeight / 2;
    const circles = [
      { x: 20, color: '#ff5f57' },
      { x: 40, color: '#ffbd2e' },
      { x: 60, color: '#28c840' }
    ];
    circles.forEach(c => {
      newCtx.fillStyle = c.color;
      newCtx.beginPath();
      newCtx.arc(c.x, buttonY, 6, 0, Math.PI * 2);
      newCtx.fill();
    });
    
    // URL bar
    newCtx.fillStyle = '#1c1c1e';
    newCtx.beginPath();
    newCtx.roundRect(85, 10, newCanvas.width - 110, 24, 6);
    newCtx.fill();
    
    // Lock icon + URL
    newCtx.fillStyle = '#86868b';
    newCtx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    newCtx.textAlign = 'left';
    newCtx.textBaseline = 'middle';
    newCtx.fillText('🔒 ' + (browserFrameUrl || 'example.com'), 95, buttonY);
    
  } else if (browserFrameStyle === 'windows') {
    // Windows Style - Light gray with square buttons
    newCtx.fillStyle = '#f3f3f3';
    newCtx.fillRect(0, 0, newCanvas.width, frameHeight);
    
    // Window controls (right side)
    const btnWidth = 46;
    const btnHeight = frameHeight;
    // Minimize
    newCtx.fillStyle = '#e1e1e1';
    newCtx.fillRect(newCanvas.width - btnWidth * 3, 0, btnWidth, btnHeight);
    newCtx.strokeStyle = '#616161';
    newCtx.lineWidth = 1;
    newCtx.beginPath();
    newCtx.moveTo(newCanvas.width - btnWidth * 3 + 18, frameHeight / 2);
    newCtx.lineTo(newCanvas.width - btnWidth * 3 + 28, frameHeight / 2);
    newCtx.stroke();
    // Maximize
    newCtx.fillStyle = '#e1e1e1';
    newCtx.fillRect(newCanvas.width - btnWidth * 2, 0, btnWidth, btnHeight);
    newCtx.strokeRect(newCanvas.width - btnWidth * 2 + 18, frameHeight / 2 - 5, 10, 10);
    // Close
    newCtx.fillStyle = '#e81123';
    newCtx.fillRect(newCanvas.width - btnWidth, 0, btnWidth, btnHeight);
    newCtx.strokeStyle = '#fff';
    newCtx.lineWidth = 1.5;
    newCtx.beginPath();
    newCtx.moveTo(newCanvas.width - btnWidth + 18, 16);
    newCtx.lineTo(newCanvas.width - btnWidth + 28, frameHeight - 16);
    newCtx.moveTo(newCanvas.width - btnWidth + 28, 16);
    newCtx.lineTo(newCanvas.width - btnWidth + 18, frameHeight - 16);
    newCtx.stroke();
    
    // URL bar
    newCtx.fillStyle = '#fff';
    newCtx.strokeStyle = '#ccc';
    newCtx.lineWidth = 1;
    newCtx.beginPath();
    newCtx.roundRect(10, 8, newCanvas.width - 160, 28, 4);
    newCtx.fill();
    newCtx.stroke();
    
    // URL text
    newCtx.fillStyle = '#333';
    newCtx.font = '13px Segoe UI, sans-serif';
    newCtx.textAlign = 'left';
    newCtx.textBaseline = 'middle';
    newCtx.fillText('🔒 ' + (browserFrameUrl || 'example.com'), 20, frameHeight / 2);
    
  } else {
    // Minimal Style - Just URL bar
    newCtx.fillStyle = '#f5f5f5';
    newCtx.fillRect(0, 0, newCanvas.width, frameHeight);
    
    // Simple URL bar
    newCtx.fillStyle = '#fff';
    newCtx.strokeStyle = '#ddd';
    newCtx.lineWidth = 1;
    newCtx.beginPath();
    newCtx.roundRect(10, 6, newCanvas.width - 20, 20, 10);
    newCtx.fill();
    newCtx.stroke();
    
    // URL text centered
    newCtx.fillStyle = '#666';
    newCtx.font = '11px system-ui, sans-serif';
    newCtx.textAlign = 'center';
    newCtx.textBaseline = 'middle';
    newCtx.fillText(browserFrameUrl || 'example.com', newCanvas.width / 2, frameHeight / 2);
  }
  
  // Draw original image below frame
  newCtx.putImageData(originalData, 0, frameHeight);
  
  // Update canvas
  useCanvas.height = newCanvas.height;
  useCtx.drawImage(newCanvas, 0, 0);
  
  if (!targetCtx) {
    originalImage = useCtx.getImageData(0, 0, useCanvas.width, useCanvas.height);
  }
  
  return { frameHeight };
}

// Reusable decoration helper - applies border AND browser frame to any canvas
function applyBorderDecoration(sourceCanvas) {
  // First, apply browser frame if enabled (adds height at top)
  let workingCanvas = sourceCanvas;
  
  if (hasBrowserFrame) {
    const frameHeight = browserFrameStyle === 'minimal' ? 32 : 44;
    const framedCanvas = document.createElement('canvas');
    framedCanvas.width = sourceCanvas.width;
    framedCanvas.height = sourceCanvas.height + frameHeight;
    const framedCtx = framedCanvas.getContext('2d');
    
    // Draw the frame header
    if (browserFrameStyle === 'mac') {
      framedCtx.fillStyle = '#3a3a3c';
      framedCtx.fillRect(0, 0, framedCanvas.width, frameHeight);
      const buttonY = frameHeight / 2;
      [{ x: 20, c: '#ff5f57' }, { x: 40, c: '#ffbd2e' }, { x: 60, c: '#28c840' }].forEach(b => {
        framedCtx.fillStyle = b.c;
        framedCtx.beginPath();
        framedCtx.arc(b.x, buttonY, 6, 0, Math.PI * 2);
        framedCtx.fill();
      });
      framedCtx.fillStyle = '#1c1c1e';
      framedCtx.beginPath();
      framedCtx.roundRect(85, 10, framedCanvas.width - 110, 24, 6);
      framedCtx.fill();
      framedCtx.fillStyle = '#86868b';
      framedCtx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
      framedCtx.textAlign = 'left';
      framedCtx.textBaseline = 'middle';
      framedCtx.fillText('🔒 ' + (browserFrameUrl || 'example.com'), 95, buttonY);
    } else if (browserFrameStyle === 'windows') {
      framedCtx.fillStyle = '#f3f3f3';
      framedCtx.fillRect(0, 0, framedCanvas.width, frameHeight);
      const btnWidth = 46;
      framedCtx.fillStyle = '#e1e1e1';
      framedCtx.fillRect(framedCanvas.width - btnWidth * 3, 0, btnWidth, frameHeight);
      framedCtx.strokeStyle = '#616161';
      framedCtx.lineWidth = 1;
      framedCtx.beginPath();
      framedCtx.moveTo(framedCanvas.width - btnWidth * 3 + 18, frameHeight / 2);
      framedCtx.lineTo(framedCanvas.width - btnWidth * 3 + 28, frameHeight / 2);
      framedCtx.stroke();
      framedCtx.fillStyle = '#e1e1e1';
      framedCtx.fillRect(framedCanvas.width - btnWidth * 2, 0, btnWidth, frameHeight);
      framedCtx.strokeRect(framedCanvas.width - btnWidth * 2 + 16, frameHeight / 2 - 5, 14, 10);
      framedCtx.fillStyle = '#e81123';
      framedCtx.fillRect(framedCanvas.width - btnWidth, 0, btnWidth, frameHeight);
      framedCtx.strokeStyle = '#fff';
      framedCtx.lineWidth = 1.5;
      framedCtx.beginPath();
      framedCtx.moveTo(framedCanvas.width - btnWidth + 16, frameHeight / 2 - 5);
      framedCtx.lineTo(framedCanvas.width - btnWidth + 30, frameHeight / 2 + 5);
      framedCtx.moveTo(framedCanvas.width - btnWidth + 30, frameHeight / 2 - 5);
      framedCtx.lineTo(framedCanvas.width - btnWidth + 16, frameHeight / 2 + 5);
      framedCtx.stroke();
      framedCtx.fillStyle = '#fff';
      framedCtx.beginPath();
      framedCtx.roundRect(10, 10, framedCanvas.width - btnWidth * 3 - 30, 24, 4);
      framedCtx.fill();
      framedCtx.strokeStyle = '#ccc';
      framedCtx.lineWidth = 1;
      framedCtx.stroke();
      framedCtx.fillStyle = '#333';
      framedCtx.font = '12px Segoe UI, sans-serif';
      framedCtx.textAlign = 'left';
      framedCtx.textBaseline = 'middle';
      framedCtx.fillText('🔒 ' + (browserFrameUrl || 'example.com'), 20, frameHeight / 2);
    } else if (browserFrameStyle === 'minimal') {
      framedCtx.fillStyle = '#2d2d30';
      framedCtx.fillRect(0, 0, framedCanvas.width, frameHeight);
      const barWidth = Math.min(400, framedCanvas.width - 40);
      framedCtx.fillStyle = '#1e1e1e';
      framedCtx.beginPath();
      framedCtx.roundRect((framedCanvas.width - barWidth) / 2, 6, barWidth, 20, 4);
      framedCtx.fill();
      framedCtx.fillStyle = '#aaa';
      framedCtx.font = '11px system-ui, sans-serif';
      framedCtx.textAlign = 'center';
      framedCtx.textBaseline = 'middle';
      framedCtx.fillText('🔒 ' + (browserFrameUrl || 'example.com'), framedCanvas.width / 2, frameHeight / 2);
    }
    
    // Draw the source canvas below the frame
    framedCtx.drawImage(sourceCanvas, 0, frameHeight);
    workingCanvas = framedCanvas;
  }
  
  // Now apply border if enabled
  if (!hasBorder) {
    return workingCanvas;
  }
  
  const padding = borderWidth;
  const decoratedCanvas = document.createElement('canvas');
  const decoratedCtx = decoratedCanvas.getContext('2d');
  
  decoratedCanvas.width = workingCanvas.width + (padding * 2);
  decoratedCanvas.height = workingCanvas.height + (padding * 2);
  
  // Fill with border color
  decoratedCtx.fillStyle = borderColor;
  decoratedCtx.fillRect(0, 0, decoratedCanvas.width, decoratedCanvas.height);
  
  // Apply rounded corners if needed
  if (borderRadius > 0) {
    decoratedCtx.save();
    decoratedCtx.beginPath();
    decoratedCtx.roundRect(padding, padding, workingCanvas.width, workingCanvas.height, borderRadius);
    decoratedCtx.clip();
  }
  
  // Draw source canvas
  decoratedCtx.drawImage(workingCanvas, padding, padding);
  
  if (borderRadius > 0) {
    decoratedCtx.restore();
  }
  
  return decoratedCanvas;
}

// Draw browser frame preview overlay on canvas (for live preview)
function drawBrowserFramePreview() {
  if (!hasBrowserFrame) return;
  
  const frameHeight = browserFrameStyle === 'minimal' ? 32 : 44;
  
  ctx.save();
  
  if (browserFrameStyle === 'mac') {
    // macOS Style - Dark with traffic lights
    ctx.fillStyle = '#3a3a3c';
    ctx.fillRect(0, 0, canvas.width, frameHeight);
    
    // Traffic lights
    const buttonY = frameHeight / 2;
    const circles = [
      { x: 20, color: '#ff5f57' },
      { x: 40, color: '#ffbd2e' },
      { x: 60, color: '#28c840' }
    ];
    circles.forEach(c => {
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.arc(c.x, buttonY, 6, 0, Math.PI * 2);
      ctx.fill();
    });
    
    // URL bar
    ctx.fillStyle = '#1c1c1e';
    ctx.beginPath();
    ctx.roundRect(85, 10, canvas.width - 110, 24, 6);
    ctx.fill();
    
    // Lock icon + URL
    ctx.fillStyle = '#86868b';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔒 ' + (browserFrameUrl || 'example.com'), 95, buttonY);
    
  } else if (browserFrameStyle === 'windows') {
    // Windows Style - Light gray with square buttons
    ctx.fillStyle = '#f3f3f3';
    ctx.fillRect(0, 0, canvas.width, frameHeight);
    
    // Window controls (right side)
    const btnWidth = 46;
    // Minimize
    ctx.fillStyle = '#e1e1e1';
    ctx.fillRect(canvas.width - btnWidth * 3, 0, btnWidth, frameHeight);
    ctx.strokeStyle = '#616161';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(canvas.width - btnWidth * 3 + 18, frameHeight / 2);
    ctx.lineTo(canvas.width - btnWidth * 3 + 28, frameHeight / 2);
    ctx.stroke();
    
    // Maximize
    ctx.fillStyle = '#e1e1e1';
    ctx.fillRect(canvas.width - btnWidth * 2, 0, btnWidth, frameHeight);
    ctx.strokeRect(canvas.width - btnWidth * 2 + 16, frameHeight / 2 - 5, 14, 10);
    
    // Close (red)
    ctx.fillStyle = '#e81123';
    ctx.fillRect(canvas.width - btnWidth, 0, btnWidth, frameHeight);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(canvas.width - btnWidth + 16, frameHeight / 2 - 5);
    ctx.lineTo(canvas.width - btnWidth + 30, frameHeight / 2 + 5);
    ctx.moveTo(canvas.width - btnWidth + 30, frameHeight / 2 - 5);
    ctx.lineTo(canvas.width - btnWidth + 16, frameHeight / 2 + 5);
    ctx.stroke();
    
    // URL bar
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.roundRect(10, 10, canvas.width - btnWidth * 3 - 30, 24, 4);
    ctx.fill();
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // URL text
    ctx.fillStyle = '#333';
    ctx.font = '12px Segoe UI, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔒 ' + (browserFrameUrl || 'example.com'), 20, frameHeight / 2);
    
  } else if (browserFrameStyle === 'minimal') {
    // Minimal Style - Just URL bar
    ctx.fillStyle = '#2d2d30';
    ctx.fillRect(0, 0, canvas.width, frameHeight);
    
    // Centered URL bar
    const barWidth = Math.min(400, canvas.width - 40);
    ctx.fillStyle = '#1e1e1e';
    ctx.beginPath();
    ctx.roundRect((canvas.width - barWidth) / 2, 6, barWidth, 20, 4);
    ctx.fill();
    
    // URL text
    ctx.fillStyle = '#aaa';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔒 ' + (browserFrameUrl || 'example.com'), canvas.width / 2, frameHeight / 2);
  }
  
  ctx.restore();
}

// Draw border around canvas
function drawBorder() {
  if (!hasBorder) return;
  
  ctx.save();
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = borderWidth;
  
  if (borderRadius > 0) {
    // Draw rounded border
    const offset = borderWidth / 2;
    ctx.beginPath();
    ctx.roundRect(offset, offset, canvas.width - borderWidth, canvas.height - borderWidth, borderRadius);
    ctx.stroke();
  } else {
    // Draw square border
    ctx.strokeRect(borderWidth / 2, borderWidth / 2, canvas.width - borderWidth, canvas.height - borderWidth);
  }
  ctx.restore();
}

function redraw() {
  // Guard: Only redraw if we have image data
  if (!originalImage) {
    return;
  }
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.putImageData(originalImage, 0, 0);
  
  // Draw browser frame preview if enabled (overlay at top)
  drawBrowserFramePreview();
  
  // Draw border first (below annotations)
  drawBorder();
  
  annotations.forEach(ann => {
    if (ann.tool === 'highlight') {
      ctx.strokeStyle = ann.color;
      ctx.lineWidth = ann.size || 12;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.6;
      ctx.shadowColor = ann.color;
      ctx.shadowBlur = 15;
      
      ctx.beginPath();
      ctx.moveTo(ann.points[0].x, ann.points[0].y);
      for (let i = 1; i < ann.points.length; i++) {
        ctx.lineTo(ann.points[i].x, ann.points[i].y);
      }
      ctx.stroke();
      
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    } else if (ann.tool === 'callout') {
      // Circle
      ctx.fillStyle = ann.color;
      ctx.shadowColor = ann.color;
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.arc(ann.x, ann.y, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
      
      // Number
      ctx.fillStyle = '#000';
      ctx.font = 'bold 26px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ann.number, ann.x, ann.y);
      
      // Label
      if (ann.text) {
        const textY = ann.y + 50;
        ctx.font = 'bold 16px Arial';
        const w = ctx.measureText(ann.text).width;
        
        ctx.fillStyle = ann.color;
        ctx.shadowColor = ann.color;
        ctx.shadowBlur = 10;
        ctx.fillRect(ann.x - w/2 - 10, textY - 12, w + 20, 28);
        ctx.shadowBlur = 0;
        
        ctx.fillStyle = '#000';
        ctx.fillText(ann.text, ann.x, textY);
      }
    } else if (ann.tool === 'sticker') {
      ctx.font = 'bold 18px Arial';
      const w = ctx.measureText(ann.text).width;
      
      ctx.fillStyle = ann.color;
      ctx.shadowColor = ann.color;
      ctx.shadowBlur = 12;
      ctx.fillRect(ann.x - w/2 - 14, ann.y - 18, w + 28, 36);
      ctx.shadowBlur = 0;
      
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(ann.x - w/2 - 14, ann.y - 18, w + 28, 36);
      
      ctx.fillStyle = '#000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ann.text, ann.x, ann.y);
    } else if (ann.tool === 'text') {
      ctx.font = '26px Arial';
      ctx.fillStyle = ann.color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      
      ctx.strokeText(ann.text, ann.x, ann.y);
      ctx.fillText(ann.text, ann.x, ann.y);
    } else if (ann.tool === 'rectangle') {
      // Draw rectangle with glow
      ctx.strokeStyle = ann.color;
      ctx.lineWidth = ann.lineWidth || 4;
      ctx.shadowColor = ann.color;
      ctx.shadowBlur = 10;
      ctx.strokeRect(ann.x, ann.y, ann.width, ann.height);
      ctx.shadowBlur = 0;
    } else if (ann.tool === 'arrow') {
      // Draw arrow with glow
      ctx.strokeStyle = ann.color;
      ctx.fillStyle = ann.color;
      ctx.lineWidth = ann.lineWidth || 4;
      ctx.shadowColor = ann.color;
      ctx.shadowBlur = 10;
      
      // Draw line
      ctx.beginPath();
      ctx.moveTo(ann.x1, ann.y1);
      ctx.lineTo(ann.x2, ann.y2);
      ctx.stroke();
      
      // Draw arrowhead
      const angle = Math.atan2(ann.y2 - ann.y1, ann.x2 - ann.x1);
      const headLength = 20;
      ctx.beginPath();
      ctx.moveTo(ann.x2, ann.y2);
      ctx.lineTo(
        ann.x2 - headLength * Math.cos(angle - Math.PI / 6),
        ann.y2 - headLength * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        ann.x2 - headLength * Math.cos(angle + Math.PI / 6),
        ann.y2 - headLength * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  });
  
  // Draw crop rectangle if exists (for snip mode)
  if (cropRect && currentTool === 'crop') {
    drawCropRect();
  }
}

function updateStatus(message) {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function setupStickerListeners() {
  document.querySelectorAll('.sticker-btn, .custom-sticker-btn').forEach(btn => {
    const deleteBtn = btn.querySelector('.delete-sticker');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteCustomSticker(btn.dataset.text);
      });
    }
    
    btn.addEventListener('click', () => {
      pendingStickerText = btn.dataset.text;
      currentTool = 'sticker';
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      canvas.style.cursor = 'crosshair';
      updateStatus('Click on the image to place sticker');
    });
  });
}

async function loadCustomStickers() {
  try {
    const result = await chrome.storage.local.get('customStickers');
    const customStickers = result.customStickers || [];
    const container = document.getElementById('customStickers');
    container.innerHTML = '';
    
    customStickers.forEach(text => {
      const btn = document.createElement('button');
      btn.className = 'custom-sticker-btn';
      btn.dataset.text = text;
      btn.innerHTML = `${text}<span class="delete-sticker">×</span>`;
      container.appendChild(btn);
    });
    
    setupStickerListeners();
  } catch (error) {
    console.error('Failed to load custom stickers:', error);
  }
}

async function createCustomSticker() {
  try {
    const result = await chrome.storage.local.get('customStickers');
    const customStickers = result.customStickers || [];
    
    if (customStickers.length >= 5) {
      alert('Maximum 5 custom stickers allowed. Delete one to create a new one.');
      return;
    }
    
    const text = prompt('Enter your custom sticker text (e.g., "TODO", "CHECK THIS", "URGENT"):');
    if (text && text.trim()) {
      const trimmed = text.trim().toUpperCase();
      if (customStickers.includes(trimmed)) {
        alert('This sticker already exists!');
        return;
      }
      
      customStickers.push(trimmed);
      await chrome.storage.local.set({ customStickers });
      loadCustomStickers();
    }
  } catch (error) {
    console.error('Failed to create custom sticker:', error);
  }
}

async function deleteCustomSticker(text) {
  try {
    const result = await chrome.storage.local.get('customStickers');
    const customStickers = result.customStickers || [];
    const filtered = customStickers.filter(s => s !== text);
    await chrome.storage.local.set({ customStickers: filtered });
    loadCustomStickers();
  } catch (error) {
    console.error('Failed to delete custom sticker:', error);
  }
}

async function save() {
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode');
  const index = urlParams.get('index');
  
  try {
    // FULL PAGE MODE: Stitch all pages with annotations and save
    if (mode === 'fullpage' && isFullPageMode) {
      await saveFullPageWithAnnotations();
      return;
    }
    
    // SNIP MODE: Save cropped region as new snap
    if (mode === 'snip' && cropRect) {
      // Extract the cropped region from original image
      const { x, y, width, height } = cropRect;
      
      // Create temporary canvas for crop
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = width;
      tempCanvas.height = height;
      const tempCtx = tempCanvas.getContext('2d');
      
      // Draw the cropped region from original image
      tempCtx.putImageData(
        originalImage,
        -x, -y,
        x, y, width, height
      );
      
      // Apply border and browser frame decoration if enabled
      let cropDataUrl;
      if (hasBorder || hasBrowserFrame) {
        const decoratedCanvas = applyBorderDecoration(tempCanvas);
        cropDataUrl = decoratedCanvas.toDataURL('image/png');
      } else {
        cropDataUrl = tempCanvas.toDataURL('image/png');
      }
      
      // Send as new snap (add to queue)
      const response = await chrome.runtime.sendMessage({
        action: 'snipComplete',
        dataUrl: cropDataUrl
      });
      
      // Check if queue is full
      if (response && response.queueFull) {
        alert(response.error || 'Queue full (9/9). Delete some images first.');
        return;
      }
      
      if (response && !response.success) {
        updateStatus(response.error || 'Failed to save snip.');
        return;
      }
      
      updateStatus('Snip saved! You can snip more or close.');
      cropRect = null;
      redraw();
      
      // Optionally close after save, or allow multiple snips
      // window.close();
      return;
    }
    
    // SNIP MODE without crop: just save the current selection
    if (mode === 'snip' && !cropRect) {
      updateStatus('Draw a rectangle first to snip an area.');
      return;
    }
    
    // ANNOTATION MODE: Replace existing snap with annotated version
    // Use shared decorator helper for consistent border AND browser frame styling
    let exportCanvas;
    if (hasBorder || hasBrowserFrame) {
      exportCanvas = applyBorderDecoration(canvas);
    } else {
      exportCanvas = canvas;
    }
    
    const dataUrl = exportCanvas.toDataURL('image/png');
    await chrome.runtime.sendMessage({
      action: 'annotationComplete',
      dataUrl,
      index
    });
    window.close();
  } catch (error) {
    console.error('Save error:', error);
    updateStatus('Save failed. Try again.');
  }
}

// Yield to UI thread to prevent freezing
function yieldToUI() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// Save full page with all annotations - CHUNKED for AI readability
// Splits into 5-page chunks so AI platforms can process each piece
async function saveFullPageWithAnnotations() {
  try {
    const totalPages = pages.length;
    const PAGES_PER_CHUNK = 5; // Smaller chunks for AI compatibility (5 pages max)
    
    // Calculate how many chunks we need
    const totalChunks = Math.ceil(totalPages / PAGES_PER_CHUNK);
    
    // Check queue capacity first
    const queueStatus = await chrome.runtime.sendMessage({ action: 'getQueueStatus' });
    const currentQueueSize = queueStatus?.count || 0;
    const availableSlots = 9 - currentQueueSize;
    
    // If we need more chunks than available slots, save what we can
    const chunksToSave = Math.min(totalChunks, availableSlots);
    
    if (chunksToSave === 0) {
      updateStatus('Queue full! Clear some images first.');
      return;
    }
    
    if (chunksToSave < totalChunks) {
      updateStatus(`Will save ${chunksToSave} of ${totalChunks} chunks. Upload these, clear queue, capture again for rest.`);
      await new Promise(r => setTimeout(r, 2000)); // Let user read the message
    } else {
      updateStatus(`Splitting ${totalPages} pages into ${totalChunks} chunks for AI...`);
    }
    await yieldToUI();
    
    // Save current page annotations first
    pageAnnotations[currentPageIndex] = JSON.parse(JSON.stringify(annotations));
    
    // STEP 1: Load all page images and get dimensions
    updateStatus('Loading all pages...');
    await yieldToUI();
    
    // Get stored viewport dimensions and AI platform flag for accurate overlap calculation
    const storedDims = await chrome.storage.local.get(['fullPageViewportWidth', 'fullPageViewportHeight', 'fullPageIsAIPlatform']);
    const storedViewportHeight = storedDims.fullPageViewportHeight || window.innerHeight;
    const isAIPlatform = storedDims.fullPageIsAIPlatform || false;
    
    // Calculate CSS_OVERLAP: 20% of viewport for all sites
    // Increased to catch all missing lines at page boundaries (ChatGPT/Grok)
    const CSS_OVERLAP = Math.round(storedViewportHeight * 0.20);
    
    let pageWidth = 0;
    let overlapPx = CSS_OVERLAP; // Will be scaled for actual capture DPR
    
    for (let i = 0; i < totalPages; i++) {
      if (!pageImages[i]) {
        if (i % 10 === 0) {
          updateStatus(`Loading page ${i + 1}/${totalPages}...`);
          await yieldToUI();
        }
        await loadPageImage(i);
      }
      if (i === 0 && pageImages[0]) {
        pageWidth = pageImages[0].width;
        // Calculate ACTUAL capture scale from image dimensions vs stored viewport
        // This is critical: the annotation window DPR may differ from the capture DPR
        const captureScale = pageImages[0].height / storedViewportHeight;
        overlapPx = Math.round(CSS_OVERLAP * captureScale);
        console.log(`[SnapToAI] Capture scale: ${captureScale.toFixed(2)}x, AI platform: ${isAIPlatform}, CSS overlap: ${CSS_OVERLAP}px -> ${overlapPx}px device`);
      }
    }
    
    // STEP 2: Process each chunk (only save up to chunksToSave)
    const savedChunks = [];
    
    for (let chunkIndex = 0; chunkIndex < chunksToSave; chunkIndex++) {
      const startPage = chunkIndex * PAGES_PER_CHUNK;
      const endPage = Math.min(startPage + PAGES_PER_CHUNK, totalPages);
      const pagesInChunk = endPage - startPage;
      
      updateStatus(`Creating chunk ${chunkIndex + 1}/${totalChunks} (pages ${startPage + 1}-${endPage})...`);
      await yieldToUI();
      
      // Calculate chunk height (using DPR-scaled overlap)
      let chunkHeight = 0;
      for (let i = startPage; i < endPage; i++) {
        const img = pageImages[i];
        if (img) {
          if (i === startPage) {
            chunkHeight = img.height;
          } else {
            chunkHeight += img.height - overlapPx;
          }
        }
      }
      
      // Create chunk canvas
      const chunkCanvas = document.createElement('canvas');
      chunkCanvas.width = pageWidth;
      chunkCanvas.height = chunkHeight;
      const chunkCtx = chunkCanvas.getContext('2d');
      
      // Render pages to chunk
      let currentY = 0;
      for (let i = startPage; i < endPage; i++) {
        const img = pageImages[i];
        if (!img) continue;
        
        // Create temp canvas with annotations
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = img.width;
        pageCanvas.height = img.height;
        const pageCtx = pageCanvas.getContext('2d');
        pageCtx.drawImage(img, 0, 0);
        
        const pageAnns = pageAnnotations[i] || [];
        drawAnnotationsToContext(pageCtx, pageAnns);
        
        // Stitch to chunk - clean seamless stitching (DPR-aware, no visible breaks)
        if (i === startPage) {
          chunkCtx.drawImage(pageCanvas, 0, 0);
          currentY = pageCanvas.height;
        } else {
          // Use DPR-scaled overlap to skip the correct number of device pixels
          const sourceY = overlapPx;
          const sourceHeight = pageCanvas.height - overlapPx;
          
          // Draw seamlessly - skip the overlapped region at top of each page
          chunkCtx.drawImage(
            pageCanvas,
            0, sourceY, pageCanvas.width, sourceHeight,
            0, currentY - overlapPx, pageCanvas.width, sourceHeight
          );
          currentY += pageCanvas.height - overlapPx;
        }
        
        // Release temp canvas
        pageCanvas.width = 0;
        pageCanvas.height = 0;
      }
      
      // Add watermark to chunk
      addInvisibleWatermarkToCanvas(chunkCanvas);
      
      // Add border and browser frame if enabled (professional look like GoFullPage)
      // Use shared decorator helper for consistent styling
      if (hasBorder || hasBrowserFrame) {
        const decoratedChunk = applyBorderDecoration(chunkCanvas);
        chunkCanvas.width = decoratedChunk.width;
        chunkCanvas.height = decoratedChunk.height;
        chunkCtx.drawImage(decoratedChunk, 0, 0);
      }
      
      // Add subtle part indicator (bottom right, professional styling)
      if (totalChunks > 1) {
        const labelWidth = 90;
        const labelHeight = 24;
        const labelX = chunkCanvas.width - labelWidth - 10;
        const labelY = chunkCanvas.height - labelHeight - 10;
        
        // Semi-transparent background
        chunkCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        chunkCtx.beginPath();
        chunkCtx.roundRect(labelX, labelY, labelWidth, labelHeight, 4);
        chunkCtx.fill();
        
        // Label text
        chunkCtx.fillStyle = '#ffffff';
        chunkCtx.font = '12px system-ui, -apple-system, sans-serif';
        chunkCtx.textAlign = 'center';
        chunkCtx.textBaseline = 'middle';
        chunkCtx.fillText(`${chunkIndex + 1} / ${totalChunks}`, labelX + labelWidth / 2, labelY + labelHeight / 2);
      }
      
      // Export chunk - USE PNG for crisp text (JPEG destroys text quality!)
      updateStatus(`Exporting chunk ${chunkIndex + 1}/${totalChunks}...`);
      await yieldToUI();
      
      // PNG format for maximum text clarity - never use JPEG for screenshots with text
      const chunkDataUrl = chunkCanvas.toDataURL('image/png');
      
      // Release chunk canvas
      chunkCanvas.width = 0;
      chunkCanvas.height = 0;
      
      // Save to queue with part metadata
      const response = await chrome.runtime.sendMessage({
        action: 'snipComplete',
        dataUrl: chunkDataUrl,
        metadata: {
          isChunk: true,
          part: chunkIndex + 1,
          totalParts: totalChunks,
          pagesInChunk: pagesInChunk,
          startPage: startPage + 1,
          endPage: endPage
        }
      });
      
      if (response && response.queueFull) {
        updateStatus(`Saved ${chunkIndex} chunks. Queue full - clear and retry for remaining.`);
        break;
      }
      
      savedChunks.push(chunkIndex + 1);
      
      // Brief pause between chunks
      await yieldToUI();
    }
    
    // Clear local storage (screenshots and viewport dimensions)
    await chrome.storage.local.remove(['fullPageScreenshots', 'fullPageViewportWidth', 'fullPageViewportHeight']);
    
    updateStatus(`Saved ${savedChunks.length} chunks! Upload to AI one at a time.`);
    
    // Notify background
    chrome.runtime.sendMessage({ action: 'fullPageStitchComplete' }).catch(() => {});
    
    setTimeout(() => window.close(), 2000);
    
  } catch (error) {
    console.error('Save full page error:', error);
    updateStatus('Failed to save. Please try again.');
  }
}

// Draw annotations to a canvas context (for rendering annotated pages)
function drawAnnotationsToContext(ctx, anns) {
  for (const ann of anns) {
    if (ann.tool === 'highlight' && ann.points) {
      ctx.strokeStyle = ann.color;
      ctx.lineWidth = ann.size || 12;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.6;
      ctx.shadowColor = ann.color;
      ctx.shadowBlur = 15;
      
      ctx.beginPath();
      if (ann.points.length > 0) {
        ctx.moveTo(ann.points[0].x, ann.points[0].y);
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x, ann.points[i].y);
        }
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    } else if (ann.tool === 'callout') {
      // Circle with glow (matches redraw())
      ctx.fillStyle = ann.color;
      ctx.shadowColor = ann.color;
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.arc(ann.x, ann.y, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      
      // White border
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
      
      // Number
      ctx.fillStyle = '#000';
      ctx.font = 'bold 26px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ann.number.toString(), ann.x, ann.y);
      
      // Label pill (if text exists)
      if (ann.text) {
        const textY = ann.y + 50;
        ctx.font = 'bold 16px Arial';
        const w = ctx.measureText(ann.text).width;
        
        ctx.fillStyle = ann.color;
        ctx.shadowColor = ann.color;
        ctx.shadowBlur = 10;
        ctx.fillRect(ann.x - w/2 - 10, textY - 12, w + 20, 28);
        ctx.shadowBlur = 0;
        
        ctx.fillStyle = '#000';
        ctx.fillText(ann.text, ann.x, textY);
      }
    } else if (ann.tool === 'text') {
      // Text with outline (matches redraw())
      ctx.font = '26px Arial';
      ctx.fillStyle = ann.color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      
      ctx.strokeText(ann.text, ann.x, ann.y);
      ctx.fillText(ann.text, ann.x, ann.y);
    } else if (ann.tool === 'sticker') {
      // Sticker pill with glow (matches redraw())
      ctx.font = 'bold 18px Arial';
      const w = ctx.measureText(ann.text).width;
      
      ctx.fillStyle = ann.color;
      ctx.shadowColor = ann.color;
      ctx.shadowBlur = 12;
      ctx.fillRect(ann.x - w/2 - 14, ann.y - 18, w + 28, 36);
      ctx.shadowBlur = 0;
      
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(ann.x - w/2 - 14, ann.y - 18, w + 28, 36);
      
      ctx.fillStyle = '#000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ann.text, ann.x, ann.y);
    }
  }
}

// Add invisible watermark to canvas
function addInvisibleWatermarkToCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.globalAlpha = 0.005;
  ctx.fillStyle = '#fff';
  ctx.font = '12px Arial';
  
  const lines = [
    'Captured with SnapToAI',
    'snaptoai.com',
    'Free Chrome Extension',
    'Batch Screenshots for AI'
  ];
  
  for (let y = 50; y < canvas.height; y += 200) {
    for (let x = 50; x < canvas.width; x += 300) {
      const line = lines[Math.floor(Math.random() * lines.length)];
      ctx.fillText(line, x, y);
    }
  }
  
  ctx.globalAlpha = 1;
  
  // Magic pixel
  const imageData = ctx.getImageData(canvas.width - 1, canvas.height - 1, 1, 1);
  imageData.data[0] = 0x53;
  imageData.data[1] = 0x4E;
  imageData.data[2] = 0x41;
  imageData.data[3] = 255;
  ctx.putImageData(imageData, canvas.width - 1, canvas.height - 1);
}
