// Flow Annotation Tool
// Allows users to annotate screenshots with arrows, text, rectangles, and blur

let canvas, ctx;
let currentTool = 'arrow';
let currentColor = '#00d9ff';
let isDrawing = false;
let startX, startY;
let annotations = [];
let imageData;

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
  // Set canvas to match image size (will be set when image loads)
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
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      finalizeText();
    } else if (e.key === 'Escape') {
      textInput.style.display = 'none';
    }
  });
}

// Load image from URL parameter
function loadImage() {
  const urlParams = new URLSearchParams(window.location.search);
  const imageUrl = urlParams.get('img');
  const index = urlParams.get('index');
  
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
  } else {
    isDrawing = true;
  }
}

function handleMouseMove(e) {
  if (!isDrawing) return;
  
  const rect = canvas.getBoundingClientRect();
  const currentX = (e.clientX - rect.left) * (canvas.width / rect.width);
  const currentY = (e.clientY - rect.top) * (canvas.height / rect.height);
  
  // Redraw canvas with preview
  redrawCanvas();
  drawPreview(startX, startY, currentX, currentY);
}

function handleMouseUp(e) {
  if (!isDrawing) return;
  
  const rect = canvas.getBoundingClientRect();
  const endX = (e.clientX - rect.left) * (canvas.width / rect.width);
  const endY = (e.clientY - rect.top) * (canvas.height / rect.height);
  
  // Save annotation
  annotations.push({
    tool: currentTool,
    color: currentColor,
    startX, startY, endX, endY
  });
  
  isDrawing = false;
  redrawCanvas();
}

// Draw preview while dragging
function drawPreview(x1, y1, x2, y2) {
  ctx.strokeStyle = currentColor;
  ctx.fillStyle = currentColor;
  ctx.lineWidth = 3;
  
  if (currentTool === 'arrow') {
    drawArrow(x1, y1, x2, y2);
  } else if (currentTool === 'rectangle') {
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  } else if (currentTool === 'blur') {
    ctx.filter = 'blur(20px)';
    ctx.drawImage(canvas, x1, y1, x2 - x1, y2 - y1, x1, y1, x2 - x1, y2 - y1);
    ctx.filter = 'none';
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }
}

// Draw arrow
function drawArrow(x1, y1, x2, y2) {
  const headLength = 20;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  
  // Draw line
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  
  // Draw arrowhead
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLength * Math.cos(angle - Math.PI / 6), y2 - headLength * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLength * Math.cos(angle + Math.PI / 6), y2 - headLength * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

// Redraw canvas
function redrawCanvas() {
  // Clear and redraw original image
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (imageData) {
    ctx.putImageData(imageData, 0, 0);
  }
  
  // Redraw all annotations
  annotations.forEach(ann => {
    ctx.strokeStyle = ann.color;
    ctx.fillStyle = ann.color;
    ctx.lineWidth = 3;
    
    if (ann.tool === 'arrow') {
      drawArrow(ann.startX, ann.startY, ann.endX, ann.endY);
    } else if (ann.tool === 'rectangle') {
      ctx.strokeRect(ann.startX, ann.startY, ann.endX - ann.startX, ann.endY - ann.startY);
    } else if (ann.tool === 'blur') {
      ctx.filter = 'blur(20px)';
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.putImageData(imageData, 0, 0);
      ctx.drawImage(tempCanvas, ann.startX, ann.startY, ann.endX - ann.startX, ann.endY - ann.startY,
                    ann.startX, ann.startY, ann.endX - ann.startX, ann.endY - ann.startY);
      ctx.filter = 'none';
      ctx.strokeRect(ann.startX, ann.startY, ann.endX - ann.startX, ann.endY - ann.startY);
    } else if (ann.tool === 'text') {
      ctx.font = '24px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(ann.text, ann.startX, ann.startY);
    }
  });
}

// Show text input
function showTextInput(x, y) {
  const textInput = document.getElementById('textInput');
  textInput.style.display = 'block';
  textInput.style.left = x + 'px';
  textInput.style.top = y + 'px';
  textInput.value = '';
  textInput.focus();
}

// Finalize text annotation
function finalizeText() {
  const textInput = document.getElementById('textInput');
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

// Undo last annotation
function undo() {
  annotations.pop();
  redrawCanvas();
}

// Clear all annotations
function clearAll() {
  annotations = [];
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
