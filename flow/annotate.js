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

document.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  
  setupEventListeners();
  loadCustomStickers();
  loadImage();
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
    // Only decrement callout number if we removed a callout
    if (removed && removed.tool === 'callout' && removed.number === calloutNumber - 1) {
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
  
  // Check for drag
  const clicked = findAnnotation(startX, startY);
  if (clicked) {
    draggingAnnotation = clicked;
    // For arrows, store the offset for both start and end points
    if (clicked.tool === 'arrow') {
      dragOffsetX = startX - clicked.x;
      dragOffsetY = startY - clicked.y;
      draggingAnnotation.endOffsetX = startX - clicked.endX;
      draggingAnnotation.endOffsetY = startY - clicked.endY;
    } else {
      dragOffsetX = startX - clicked.x;
      dragOffsetY = startY - clicked.y;
    }
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
  } else if (currentTool === 'blur' || currentTool === 'arrow') {
    isDrawing = true;
  } else if (currentTool === 'highlight') {
    isDrawing = true;
    highlightPoints = [{x: startX, y: startY}];
  }
}

function handleMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  
  if (draggingAnnotation) {
    if (draggingAnnotation.tool === 'blur') {
      // Just move x and y for blur rectangles
      draggingAnnotation.x = x - dragOffsetX;
      draggingAnnotation.y = y - dragOffsetY;
    } else if (draggingAnnotation.tool === 'arrow') {
      // Move arrow - update both endpoints based on their original offsets
      draggingAnnotation.x = x - dragOffsetX;
      draggingAnnotation.y = y - dragOffsetY;
      draggingAnnotation.endX = x - (draggingAnnotation.endOffsetX || dragOffsetX);
      draggingAnnotation.endY = y - (draggingAnnotation.endOffsetY || dragOffsetY);
    } else {
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
    }
    
    redraw();
    return;
  }
  
  if (!isDrawing) {
    canvas.style.cursor = findAnnotation(x, y) ? 'grab' : 'crosshair';
    return;
  }
  
  if (currentTool === 'blur') {
    redraw();
    // Draw preview rectangle
    const width = x - startX;
    const height = y - startY;
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(startX, startY, width, height);
    ctx.setLineDash([]);
  } else if (currentTool === 'arrow') {
    redraw();
    // Draw preview arrow
    drawArrow(ctx, startX, startY, x, y, currentColor, brushSize);
  } else if (currentTool === 'highlight') {
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
  if (draggingAnnotation) {
    draggingAnnotation = null;
    canvas.style.cursor = 'crosshair';
    return;
  }
  
  if (!isDrawing) return;
  
  if (currentTool === 'blur') {
    const rect = canvas.getBoundingClientRect();
    const endX = ((event.clientX - rect.left) * (canvas.width / rect.width));
    const endY = ((event.clientY - rect.top) * (canvas.height / rect.height));
    const width = endX - startX;
    const height = endY - startY;
    
    if (Math.abs(width) > 10 && Math.abs(height) > 10) {
      annotations.push({
        tool: 'blur',
        x: Math.min(startX, endX),
        y: Math.min(startY, endY),
        width: Math.abs(width),
        height: Math.abs(height)
      });
      redraw();
    }
  } else if (currentTool === 'arrow') {
    const rect = canvas.getBoundingClientRect();
    const endX = ((event.clientX - rect.left) * (canvas.width / rect.width));
    const endY = ((event.clientY - rect.top) * (canvas.height / rect.height));
    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length > 20) {
      annotations.push({
        tool: 'arrow',
        x: startX,
        y: startY,
        endX: endX,
        endY: endY,
        color: currentColor,
        size: brushSize
      });
      redraw();
    }
  } else if (currentTool === 'highlight' && highlightPoints.length > 1) {
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
    } else if (ann.tool === 'blur') {
      // Check if click is inside blur rectangle
      if (x >= ann.x && x <= ann.x + ann.width && y >= ann.y && y <= ann.y + ann.height) {
        return ann;
      }
    } else if (ann.tool === 'arrow') {
      // Check if click is near arrow line
      const distToLine = distanceToLineSegment(x, y, ann.x, ann.y, ann.endX, ann.endY);
      if (distToLine < 15) {
        return ann;
      }
    } else if (Math.abs(x - ann.x) < tolerance && Math.abs(y - ann.y) < tolerance) {
      return ann;
    }
  }
  return null;
}

// Helper: distance from point to line segment
function distanceToLineSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  
  if (lengthSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  
  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
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
    } else if (ann.tool === 'arrow') {
      drawArrow(ctx, ann.x, ann.y, ann.endX, ann.endY, ann.color, ann.size);
    } else if (ann.tool === 'blur') {
      // Pixelate effect for blur
      const pixelSize = 10;
      const imageData = ctx.getImageData(ann.x, ann.y, ann.width, ann.height);
      
      // Pixelate the image data
      for (let y = 0; y < ann.height; y += pixelSize) {
        for (let x = 0; x < ann.width; x += pixelSize) {
          const pixelIndexPosition = (Math.floor(y) * ann.width + Math.floor(x)) * 4;
          const r = imageData.data[pixelIndexPosition];
          const g = imageData.data[pixelIndexPosition + 1];
          const b = imageData.data[pixelIndexPosition + 2];
          
          // Fill pixelated block
          for (let dy = 0; dy < pixelSize && y + dy < ann.height; dy++) {
            for (let dx = 0; dx < pixelSize && x + dx < ann.width; dx++) {
              const index = ((y + dy) * ann.width + (x + dx)) * 4;
              imageData.data[index] = r;
              imageData.data[index + 1] = g;
              imageData.data[index + 2] = b;
            }
          }
        }
      }
      
      ctx.putImageData(imageData, ann.x, ann.y);
      
      // Draw border around blur
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 2;
      ctx.strokeRect(ann.x, ann.y, ann.width, ann.height);
    }
  });
}

// Draw arrow with arrowhead
function drawArrow(ctx, fromX, fromY, toX, toY, color, lineWidth = 4) {
  const headLength = 20 + lineWidth;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const angle = Math.atan2(dy, dx);
  
  // Draw line with glow
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 15;
  ctx.globalAlpha = 0.9;
  
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  
  // Draw arrowhead
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headLength * Math.cos(angle - Math.PI / 6),
    toY - headLength * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    toX - headLength * Math.cos(angle + Math.PI / 6),
    toY - headLength * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
  
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
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
  const dataUrl = canvas.toDataURL('image/png');
  const index = new URLSearchParams(window.location.search).get('index');
  
  try {
    await chrome.runtime.sendMessage({
      action: 'annotationComplete',
      dataUrl,
      index
    });
    window.close();
  } catch (error) {
    console.error('Save error:', error);
  }
}
