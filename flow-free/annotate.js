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

document.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  
  // Check if we're in snip mode
  const urlParams = new URLSearchParams(window.location.search);
  isSnipMode = urlParams.get('mode') === 'snip';
  
  if (isSnipMode) {
    // Auto-select crop tool in snip mode
    currentTool = 'crop';
    document.title = 'Snip Mode - SnapToAI';
    updateStatus('Draw a rectangle to snip. Click Save Snip when done.');
    
    // Update save button text
    const saveBtn = document.getElementById('saveBtn');
    if (saveBtn) saveBtn.innerHTML = '✂️ Save Snip';
    
    // SNIP MODE: Hide all tools except scissors, save, cancel
    // Hide annotation tools (highlight, numbers, text)
    document.querySelectorAll('#toolSection .tool-btn:not(#cropToolBtn)').forEach(btn => {
      btn.style.display = 'none';
    });
    
    // Hide stickers section entirely
    const stickerSection = document.getElementById('stickerSection');
    if (stickerSection) stickerSection.style.display = 'none';
    
    // Hide color/brush section entirely
    const colorSection = document.getElementById('colorSection');
    if (colorSection) colorSection.style.display = 'none';
    
    // Hide undo and clear buttons (keep only save and cancel)
    const undoBtn = document.getElementById('undoBtn');
    const clearBtn = document.getElementById('clearBtn');
    if (undoBtn) undoBtn.style.display = 'none';
    if (clearBtn) clearBtn.style.display = 'none';
  } else {
    // Hide scissors/crop button in regular annotate mode (Snap)
    const cropBtn = document.getElementById('cropToolBtn');
    if (cropBtn) cropBtn.style.display = 'none';
  }
  
  setupEventListeners();
  loadCustomStickers();
  loadImage();
  
  // Highlight crop tool if in snip mode
  if (isSnipMode) {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
    const cropBtn = document.querySelector('.tool-btn[data-tool="crop"]');
    if (cropBtn) cropBtn.classList.add('active');
  }
});

function setupEventListeners() {
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

function loadImage() {
  const urlParams = new URLSearchParams(window.location.search);
  const imageUrl = urlParams.get('img');
  
  if (imageUrl) {
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      originalImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
    };
    img.src = imageUrl;
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

function handleMouseUp() {
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

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (originalImage) {
    ctx.putImageData(originalImage, 0, 0);
  }
  
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
      
      // Alternative: Use drawImage for better quality
      const cropDataUrl = tempCanvas.toDataURL('image/png');
      
      // Send as new snap (add to queue)
      await chrome.runtime.sendMessage({
        action: 'snipComplete',
        dataUrl: cropDataUrl
      });
      
      // Redirect to popup to show the queue (same behavior as Snap)
      window.location.href = 'popup.html';
      return;
    }
    
    // SNIP MODE without crop: just save the current selection
    if (mode === 'snip' && !cropRect) {
      updateStatus('Draw a rectangle first to snip an area.');
      return;
    }
    
    // ANNOTATION MODE: Replace existing snap with annotated version
    const dataUrl = canvas.toDataURL('image/png');
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
