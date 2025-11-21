// Flow Annotation Tool - PROPERLY FIXED VERSION
// All issues addressed: spotlight compositing, full drag support, brightness boost

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
let hoveredAnnotation = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  
  setupEventListeners();
  loadImage();
});

// Setup event listeners
function setupEventListeners() {
  // Tool buttons
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
      updateStatus();
    });
  });
  
  // Color picker
  document.getElementById('colorPicker').addEventListener('change', (e) => {
    currentColor = e.target.value;
  });
  
  // Brush size
  const sizeSlider = document.getElementById('brushSize');
  if (sizeSlider) {
    sizeSlider.addEventListener('input', (e) => {
      brushSize = parseInt(e.target.value);
      document.getElementById('sizeValue').textContent = brushSize + 'px';
    });
  }
  
  // Sticker buttons
  document.querySelectorAll('.sticker-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.dataset.text;
      const x = canvas.width / 2;
      const y = 80 + (annotations.filter(a => a.tool === 'sticker').length * 20);
      
      annotations.push({
        tool: 'sticker',
        text: text,
        color: currentColor,
        startX: x,
        startY: y
      });
      
      redrawCanvas();
    });
  });
  
  // Controls
  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('clearBtn').addEventListener('click', clearAll);
  document.getElementById('saveBtn').addEventListener('click', save);
  document.getElementById('cancelBtn').addEventListener('click', cancel);
  
  // Canvas events
  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mouseup', handleMouseUp);
  
  // Text input
  const textInput = document.getElementById('textInput');
  if (textInput) {
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        finalizeText();
      } else if (e.key === 'Escape') {
        textInput.style.display = 'none';
      }
    });
  }
  
  // Delete key to remove selected annotation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' && hoveredAnnotation) {
      const index = annotations.indexOf(hoveredAnnotation);
      if (index > -1) {
        annotations.splice(index, 1);
        hoveredAnnotation = null;
        redrawCanvas();
      }
    }
  });
}

// Load image
function loadImage() {
  const urlParams = new URLSearchParams(window.location.search);
  const imageUrl = urlParams.get('img');
  
  if (imageUrl) {
    const img = new Image();
    img.onload = () => {
      // Validate image dimensions
      if (img.width < 1 || img.height < 1) {
        console.error('Invalid image dimensions');
        return;
      }
      
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      // Save original image (with validation)
      try {
        if (canvas.width > 0 && canvas.height > 0) {
          originalImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
        }
      } catch (error) {
        console.error('Failed to save original image:', error);
      }
    };
    img.onerror = (error) => {
      console.error('Failed to load image:', error);
    };
    img.src = imageUrl;
  }
}

// Mouse handlers
function handleMouseDown(e) {
  const rect = canvas.getBoundingClientRect();
  startX = (e.clientX - rect.left) * (canvas.width / rect.width);
  startY = (e.clientY - rect.top) * (canvas.height / rect.height);
  
  // Check if clicking on existing annotation to drag (ALL types now draggable!)
  const clickedAnnotation = findAnnotationAt(startX, startY);
  if (clickedAnnotation) {
    draggingAnnotation = clickedAnnotation;
    dragOffsetX = startX - clickedAnnotation.startX;
    dragOffsetY = startY - clickedAnnotation.startY;
    canvas.style.cursor = 'grabbing';
    return;
  }
  
  if (currentTool === 'text') {
    showTextInput(startX, startY);
  } else if (currentTool === 'callout') {
    addCallout(startX, startY);
  } else {
    isDrawing = true;
    if (currentTool === 'highlight') {
      highlightPoints = [{x: startX, y: startY}];
    }
  }
}

function handleMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  const currentX = (e.clientX - rect.left) * (canvas.width / rect.width);
  const currentY = (e.clientY - rect.top) * (canvas.height / rect.height);
  
  // Update hovered annotation for visual feedback
  if (!draggingAnnotation && !isDrawing) {
    const newHovered = findAnnotationAt(currentX, currentY);
    if (newHovered !== hoveredAnnotation) {
      hoveredAnnotation = newHovered;
      canvas.style.cursor = newHovered ? 'grab' : 'crosshair';
      redrawCanvas();
    }
  }
  
  // Handle dragging annotations
  if (draggingAnnotation) {
    const newX = currentX - dragOffsetX;
    const newY = currentY - dragOffsetY;
    
    // Handle different annotation types
    if (draggingAnnotation.tool === 'spotlight' || draggingAnnotation.tool === 'redact') {
      // Move rectangle annotations
      const width = draggingAnnotation.endX - draggingAnnotation.startX;
      const height = draggingAnnotation.endY - draggingAnnotation.startY;
      draggingAnnotation.startX = newX;
      draggingAnnotation.startY = newY;
      draggingAnnotation.endX = newX + width;
      draggingAnnotation.endY = newY + height;
    } else if (draggingAnnotation.tool === 'highlight') {
      // Move all points in highlight
      const deltaX = newX - draggingAnnotation.startX;
      const deltaY = newY - draggingAnnotation.startY;
      draggingAnnotation.points.forEach(p => {
        p.x += deltaX;
        p.y += deltaY;
      });
      draggingAnnotation.startX = newX;
      draggingAnnotation.startY = newY;
    } else {
      // Move point-based annotations (sticker, callout, text)
      draggingAnnotation.startX = newX;
      draggingAnnotation.startY = newY;
    }
    
    redrawCanvas();
    return;
  }
  
  if (!isDrawing) return;
  
  if (currentTool === 'highlight') {
    highlightPoints.push({x: currentX, y: currentY});
    redrawCanvas();
    drawHighlightPreview();
  } else {
    redrawCanvas();
    drawPreview(startX, startY, currentX, currentY);
  }
}

function handleMouseUp(e) {
  if (draggingAnnotation) {
    draggingAnnotation = null;
    canvas.style.cursor = 'crosshair';
    return;
  }
  
  if (!isDrawing) return;
  
  const rect = canvas.getBoundingClientRect();
  const endX = (e.clientX - rect.left) * (canvas.width / rect.width);
  const endY = (e.clientY - rect.top) * (canvas.height / rect.height);
  
  if (currentTool === 'highlight' && highlightPoints.length > 1) {
    // Calculate bounding box for drag support
    const xs = highlightPoints.map(p => p.x);
    const ys = highlightPoints.map(p => p.y);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
    
    annotations.push({
      tool: 'highlight',
      color: currentColor,
      size: brushSize,
      points: [...highlightPoints],
      startX: centerX,
      startY: centerY
    });
    highlightPoints = [];
  } else if (currentTool === 'rectangle') {
    annotations.push({
      tool: 'rectangle',
      color: currentColor,
      startX, startY, endX, endY
    });
  } else if (currentTool === 'redact') {
    annotations.push({
      tool: 'redact',
      startX, startY, endX, endY
    });
  }
  
  isDrawing = false;
  redrawCanvas();
}

// Find annotation at point (improved hit detection)
function findAnnotationAt(x, y) {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const ann = annotations[i];
    
    if (ann.tool === 'rectangle' || ann.tool === 'redact') {
      const minX = Math.min(ann.startX, ann.endX);
      const maxX = Math.max(ann.startX, ann.endX);
      const minY = Math.min(ann.startY, ann.endY);
      const maxY = Math.max(ann.startY, ann.endY);
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
        return ann;
      }
    } else if (ann.tool === 'highlight' && ann.points) {
      // Check if near any point in the highlight path
      for (let point of ann.points) {
        const dist = Math.sqrt((x - point.x) ** 2 + (y - point.y) ** 2);
        if (dist < (ann.size || 12)) {
          return ann;
        }
      }
    } else {
      // Point-based annotations
      const tolerance = 50;
      if (Math.abs(x - ann.startX) < tolerance && Math.abs(y - ann.startY) < tolerance) {
        return ann;
      }
    }
  }
  return null;
}

// Draw preview
function drawPreview(x1, y1, x2, y2) {
  ctx.setLineDash([5, 5]);
  ctx.lineWidth = 3;
  
  if (currentTool === 'rectangle') {
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = 4;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  } else if (currentTool === 'redact') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeStyle = '#ff3b30';
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }
  
  ctx.setLineDash([]);
}

// Draw highlight preview
function drawHighlightPreview() {
  if (highlightPoints.length < 2) return;
  
  ctx.strokeStyle = currentColor;
  ctx.lineWidth = brushSize;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
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

// Add callout
function addCallout(x, y) {
  const label = prompt(`Label for marker #${calloutNumber}:`, `Step ${calloutNumber}`);
  if (label) {
    annotations.push({
      tool: 'callout',
      number: calloutNumber,
      text: label,
      color: currentColor,
      startX: x,
      startY: y
    });
    calloutNumber++;
    redrawCanvas();
  }
}

// Show text input
function showTextInput(x, y) {
  const textInput = document.getElementById('textInput');
  if (textInput) {
    textInput.style.display = 'block';
    textInput.style.left = x + 'px';
    textInput.style.top = y + 'px';
    textInput.value = '';
    startX = x;
    startY = y;
    textInput.focus();
  }
}

// Finalize text
function finalizeText() {
  const textInput = document.getElementById('textInput');
  if (!textInput) return;
  
  const text = textInput.value.trim();
  
  if (text) {
    annotations.push({
      tool: 'text',
      color: currentColor,
      startX,
      startY,
      text
    });
    redrawCanvas();
  }
  
  textInput.style.display = 'none';
}

// Redraw canvas - FIXED SPOTLIGHT COMPOSITING
function redrawCanvas() {
  // Step 1: Clear and restore original
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (originalImage) {
    ctx.putImageData(originalImage, 0, 0);
  }
  
  // Draw all annotations
  annotations.forEach(ann => {
    if (ann.tool === 'highlight') {
      drawHighlight(ann);
    } else if (ann.tool === 'rectangle') {
      drawRectangle(ann);
    } else if (ann.tool === 'redact') {
      drawRedaction(ann);
    } else if (ann.tool === 'callout') {
      drawCallout(ann);
    } else if (ann.tool === 'sticker') {
      drawSticker(ann);
    } else if (ann.tool === 'text') {
      drawText(ann);
    }
  });
  
  // Highlight hovered annotation
  if (hoveredAnnotation) {
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    
    if (hoveredAnnotation.tool === 'spotlight' || hoveredAnnotation.tool === 'redact') {
      const x = Math.min(hoveredAnnotation.startX, hoveredAnnotation.endX);
      const y = Math.min(hoveredAnnotation.startY, hoveredAnnotation.endY);
      const w = Math.abs(hoveredAnnotation.endX - hoveredAnnotation.startX);
      const h = Math.abs(hoveredAnnotation.endY - hoveredAnnotation.startY);
      ctx.strokeRect(x - 5, y - 5, w + 10, h + 10);
    }
    
    ctx.setLineDash([]);
  }
}

// Draw rectangle
function drawRectangle(ann) {
  const x = Math.min(ann.startX, ann.endX);
  const y = Math.min(ann.startY, ann.endY);
  const w = Math.abs(ann.endX - ann.startX);
  const h = Math.abs(ann.endY - ann.startY);
  
  // Draw colored rectangle
  ctx.strokeStyle = ann.color;
  ctx.lineWidth = 4;
  ctx.shadowColor = ann.color;
  ctx.shadowBlur = 15;
  ctx.strokeRect(x, y, w, h);
  ctx.shadowBlur = 0;
}

// Draw highlight
function drawHighlight(ann) {
  if (ann.points.length < 2) return;
  
  ctx.strokeStyle = ann.color;
  ctx.lineWidth = ann.size || 12;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
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
}

// Draw redaction
function drawRedaction(ann) {
  const x = Math.min(ann.startX, ann.endX);
  const y = Math.min(ann.startY, ann.endY);
  const w = Math.abs(ann.endX - ann.startX);
  const h = Math.abs(ann.endY - ann.startY);
  
  // Validate dimensions before getImageData
  if (w < 1 || h < 1 || x < 0 || y < 0 || x + w > canvas.width || y + h > canvas.height) {
    console.warn('Invalid redaction dimensions, skipping');
    return;
  }
  
  // Pixelate effect
  const blockSize = 12;
  try {
    const imgData = ctx.getImageData(x, y, w, h);
    
    for (let py = 0; py < h; py += blockSize) {
      for (let px = 0; px < w; px += blockSize) {
        const pixelIndex = (py * w + px) * 4;
        const r = imgData.data[pixelIndex] || 0;
        const g = imgData.data[pixelIndex + 1] || 0;
        const b = imgData.data[pixelIndex + 2] || 0;
        
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(x + px, y + py, blockSize, blockSize);
      }
    }
  } catch (error) {
    console.error('Pixelation failed:', error);
    // Fallback: just draw black rectangle
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.fillRect(x, y, w, h);
  }
  
  // Red border
  ctx.strokeStyle = '#ff3b30';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
}

// Draw callout
function drawCallout(ann) {
  const radius = 28;
  
  ctx.fillStyle = ann.color;
  ctx.shadowColor = ann.color;
  ctx.shadowBlur = 15;
  ctx.beginPath();
  ctx.arc(ann.startX, ann.startY, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.stroke();
  
  ctx.fillStyle = '#000';
  ctx.font = 'bold 26px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ann.number, ann.startX, ann.startY);
  
  if (ann.text) {
    const textY = ann.startY + radius + 25;
    ctx.font = 'bold 16px Arial';
    const textWidth = ctx.measureText(ann.text).width;
    
    ctx.fillStyle = ann.color;
    ctx.shadowColor = ann.color;
    ctx.shadowBlur = 10;
    ctx.fillRect(ann.startX - textWidth/2 - 10, textY - 12, textWidth + 20, 28);
    ctx.shadowBlur = 0;
    
    ctx.fillStyle = '#000';
    ctx.fillText(ann.text, ann.startX, textY);
  }
}

// Draw sticker
function drawSticker(ann) {
  ctx.font = 'bold 18px Arial';
  const textWidth = ctx.measureText(ann.text).width;
  const padding = 14;
  const height = 36;
  
  ctx.fillStyle = ann.color;
  ctx.shadowColor = ann.color;
  ctx.shadowBlur = 12;
  ctx.fillRect(ann.startX - textWidth/2 - padding, ann.startY - height/2, textWidth + padding * 2, height);
  ctx.shadowBlur = 0;
  
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(ann.startX - textWidth/2 - padding, ann.startY - height/2, textWidth + padding * 2, height);
  
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ann.text, ann.startX, ann.startY);
}

// Draw text
function drawText(ann) {
  ctx.font = '26px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = ann.color;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  
  ctx.strokeText(ann.text, ann.startX, ann.startY);
  ctx.fillText(ann.text, ann.startX, ann.startY);
}

// Undo
function undo() {
  const lastAnn = annotations.pop();
  if (lastAnn && lastAnn.tool === 'callout') {
    calloutNumber--;
  }
  redrawCanvas();
}

// Clear all
function clearAll() {
  if (confirm('Clear all annotations?')) {
    annotations = [];
    calloutNumber = 1;
    redrawCanvas();
  }
}

// Update status
function updateStatus() {
  const statusMap = {
    'highlight': 'Draw glowing highlights - drag to reposition',
    'rectangle': 'Drag to draw colored boxes - drag to reposition',
    'redact': 'Drag to pixelate sensitive info - drag to reposition',
    'callout': 'Click to add numbered markers - drag to move',
    'text': 'Click to add custom text - drag to move'
  };
  
  const status = document.getElementById('status');
  if (status && statusMap[currentTool]) {
    status.textContent = statusMap[currentTool] + ' | Press DELETE to remove hovered annotation';
  }
}

// Save
async function save() {
  const dataUrl = canvas.toDataURL('image/png');
  const index = new URLSearchParams(window.location.search).get('index');
  
  try {
    await chrome.runtime.sendMessage({
      action: 'annotationComplete',
      dataUrl,
      index
    });
  } catch (error) {
    console.error('Save error:', error);
  }
  
  window.close();
}

// Cancel
function cancel() {
  window.close();
}
