// Flow Annotation Tool - Professional Edition
// AI-focused highlighting with wow-factor features

let canvas, ctx;
let currentTool = 'highlight';
let currentColor = '#00d9ff';
let isDrawing = false;
let startX, startY;
let annotations = [];
let imageData;
let calloutNumber = 1;
let spotlightArea = null;
let highlightPoints = [];

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  
  setupCanvas();
  setupEventListeners();
  loadImage();
});

// Setup canvas
function setupCanvas() {
  canvas.style.cursor = 'crosshair';
}

// Setup event listeners
function setupEventListeners() {
  // Tool buttons
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
    });
  });
  
  // Color picker
  document.getElementById('colorPicker').addEventListener('change', (e) => {
    currentColor = e.target.value;
  });
  
  // Sticker buttons
  document.querySelectorAll('.sticker-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.dataset.text;
      const x = canvas.width / 2;
      const y = 80 + (annotations.filter(a => a.tool === 'sticker').length * 70);
      
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
  
  // Undo
  document.getElementById('undoBtn').addEventListener('click', undo);
  
  // Clear all
  document.getElementById('clearBtn').addEventListener('click', clearAll);
  
  // Save
  document.getElementById('saveBtn').addEventListener('click', save);
  
  // Cancel
  document.getElementById('cancelBtn').addEventListener('click', cancel);
  
  // Canvas drawing
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
}

// Load image from URL parameter
function loadImage() {
  const urlParams = new URLSearchParams(window.location.search);
  const imageUrl = urlParams.get('img');
  
  if (imageUrl) {
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    };
    img.src = imageUrl;
  }
}

// Mouse handlers
function handleMouseDown(e) {
  const rect = canvas.getBoundingClientRect();
  startX = (e.clientX - rect.left) * (canvas.width / rect.width);
  startY = (e.clientY - rect.top) * (canvas.height / rect.height);
  
  if (currentTool === 'text') {
    showTextInput(e.clientX, e.clientY);
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
  if (!isDrawing) return;
  
  const rect = canvas.getBoundingClientRect();
  const currentX = (e.clientX - rect.left) * (canvas.width / rect.width);
  const currentY = (e.clientY - rect.top) * (canvas.height / rect.height);
  
  if (currentTool === 'highlight') {
    highlightPoints.push({x: currentX, y: currentY});
    redrawCanvas();
    drawHighlightPreview();
  } else {
    // For other tools, show preview
    redrawCanvas();
    drawPreview(startX, startY, currentX, currentY);
  }
}

function handleMouseUp(e) {
  if (!isDrawing) return;
  
  const rect = canvas.getBoundingClientRect();
  const endX = (e.clientX - rect.left) * (canvas.width / rect.width);
  const endY = (e.clientY - rect.top) * (canvas.height / rect.height);
  
  if (currentTool === 'highlight' && highlightPoints.length > 1) {
    annotations.push({
      tool: 'highlight',
      color: currentColor,
      points: [...highlightPoints]
    });
    highlightPoints = [];
  } else if (currentTool === 'spotlight') {
    spotlightArea = {
      startX, startY, endX, endY
    };
    annotations.push({
      tool: 'spotlight',
      startX, startY, endX, endY
    });
  } else if (currentTool === 'redact') {
    annotations.push({
      tool: 'redact',
      color: currentColor,
      startX, startY, endX, endY
    });
  }
  
  isDrawing = false;
  redrawCanvas();
}

// Draw preview while dragging
function drawPreview(x1, y1, x2, y2) {
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = currentColor;
  ctx.lineWidth = 3;
  
  if (currentTool === 'spotlight') {
    ctx.strokeStyle = '#00d9ff';
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  } else if (currentTool === 'redact') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeStyle = '#ff3b30';
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }
  
  ctx.setLineDash([]);
}

// Draw highlight preview while drawing
function drawHighlightPreview() {
  if (highlightPoints.length < 2) return;
  
  ctx.strokeStyle = currentColor;
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.5;
  ctx.shadowColor = currentColor;
  ctx.shadowBlur = 20;
  
  ctx.beginPath();
  ctx.moveTo(highlightPoints[0].x, highlightPoints[0].y);
  for (let i = 1; i < highlightPoints.length; i++) {
    ctx.lineTo(highlightPoints[i].x, highlightPoints[i].y);
  }
  ctx.stroke();
  
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

// Add numbered callout
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
    textInput.focus();
  }
}

// Finalize text annotation
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

// Redraw canvas with all annotations
function redrawCanvas() {
  // Clear and redraw original image
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (imageData) {
    ctx.putImageData(imageData, 0, 0);
  }
  
  // Apply spotlight dimming effect first (if exists)
  const spotlights = annotations.filter(a => a.tool === 'spotlight');
  if (spotlights.length > 0) {
    // Dim entire canvas
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Clear spotlight areas
    spotlights.forEach(spot => {
      const x = Math.min(spot.startX, spot.endX);
      const y = Math.min(spot.startY, spot.endY);
      const w = Math.abs(spot.endX - spot.startX);
      const h = Math.abs(spot.endY - spot.startY);
      
      ctx.clearRect(x, y, w, h);
      if (imageData) {
        const spotData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        ctx.putImageData(imageData, 0, 0);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.drawImage(canvas, 0, 0);
        ctx.restore();
        ctx.putImageData(spotData, 0, 0);
      }
      
      // Add glowing border
      ctx.strokeStyle = '#00d9ff';
      ctx.lineWidth = 4;
      ctx.shadowColor = '#00d9ff';
      ctx.shadowBlur = 25;
      ctx.strokeRect(x, y, w, h);
      ctx.shadowBlur = 0;
    });
  }
  
  // Draw all other annotations
  annotations.forEach(ann => {
    if (ann.tool === 'highlight') {
      drawHighlight(ann);
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
}

// Draw highlight brush stroke
function drawHighlight(ann) {
  if (ann.points.length < 2) return;
  
  ctx.strokeStyle = ann.color;
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.5;
  ctx.shadowColor = ann.color;
  ctx.shadowBlur = 20;
  
  ctx.beginPath();
  ctx.moveTo(ann.points[0].x, ann.points[0].y);
  for (let i = 1; i < ann.points.length; i++) {
    ctx.lineTo(ann.points[i].x, ann.points[i].y);
  }
  ctx.stroke();
  
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

// Draw redaction (pixelated)
function drawRedaction(ann) {
  const x = Math.min(ann.startX, ann.endX);
  const y = Math.min(ann.startY, ann.endY);
  const w = Math.abs(ann.endX - ann.startX);
  const h = Math.abs(ann.endY - ann.startY);
  
  // Pixelate effect
  const blockSize = 15;
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
  
  // Red border
  ctx.strokeStyle = '#ff3b30';
  ctx.lineWidth = 4;
  ctx.strokeRect(x, y, w, h);
}

// Draw numbered callout
function drawCallout(ann) {
  const radius = 30;
  
  // Circle with glow
  ctx.fillStyle = ann.color;
  ctx.shadowColor = ann.color;
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(ann.startX, ann.startY, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  
  // White border
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 4;
  ctx.stroke();
  
  // Number
  ctx.fillStyle = '#000';
  ctx.font = 'bold 28px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ann.number, ann.startX, ann.startY);
  
  // Label below
  if (ann.text) {
    const textY = ann.startY + radius + 30;
    ctx.font = 'bold 18px Arial';
    const textWidth = ctx.measureText(ann.text).width;
    
    // Background
    ctx.fillStyle = ann.color;
    ctx.shadowColor = ann.color;
    ctx.shadowBlur = 10;
    ctx.fillRect(ann.startX - textWidth/2 - 10, textY - 14, textWidth + 20, 32);
    ctx.shadowBlur = 0;
    
    // Text
    ctx.fillStyle = '#000';
    ctx.fillText(ann.text, ann.startX, textY);
  }
}

// Draw sticker label
function drawSticker(ann) {
  ctx.font = 'bold 22px Arial';
  const textWidth = ctx.measureText(ann.text).width;
  const padding = 16;
  const height = 40;
  
  // Background with glow
  ctx.fillStyle = ann.color;
  ctx.shadowColor = ann.color;
  ctx.shadowBlur = 15;
  ctx.fillRect(ann.startX - textWidth/2 - padding, ann.startY - height/2, textWidth + padding * 2, height);
  ctx.shadowBlur = 0;
  
  // Border
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.strokeRect(ann.startX - textWidth/2 - padding, ann.startY - height/2, textWidth + padding * 2, height);
  
  // Text
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ann.text, ann.startX, ann.startY);
}

// Draw text annotation
function drawText(ann) {
  ctx.font = '28px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = ann.color;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  
  // Outline for readability
  ctx.strokeText(ann.text, ann.startX, ann.startY);
  ctx.fillText(ann.text, ann.startX, ann.startY);
}

// Undo last annotation
function undo() {
  const lastAnn = annotations.pop();
  if (lastAnn && lastAnn.tool === 'callout') {
    calloutNumber--;
  }
  redrawCanvas();
}

// Clear all annotations
function clearAll() {
  annotations = [];
  calloutNumber = 1;
  spotlightArea = null;
  redrawCanvas();
}

// Save annotated image
async function save() {
  const dataUrl = canvas.toDataURL('image/png');
  const index = new URLSearchParams(window.location.search).get('index');
  
  // Send back to popup via Chrome messaging
  try {
    await chrome.runtime.sendMessage({
      action: 'annotationComplete',
      dataUrl,
      index
    });
  } catch (error) {
    console.error('Failed to save annotation:', error);
  }
  
  window.close();
}

// Cancel annotation
function cancel() {
  window.close();
}
