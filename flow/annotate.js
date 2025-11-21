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

document.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  
  setupEventListeners();
  loadImage();
});

function setupEventListeners() {
  // Tools
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
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
  
  // Stickers
  document.querySelectorAll('.sticker-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      annotations.push({
        tool: 'sticker',
        text: btn.dataset.text,
        color: currentColor,
        x: canvas.width / 2,
        y: 80 + (annotations.filter(a => a.tool === 'sticker').length * 60)
      });
      redraw();
    });
  });
  
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
    textInput.style.display = 'block';
    textInput.style.left = startX + 'px';
    textInput.style.top = startY + 'px';
    textInput.value = '';
    textInput.focus();
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
    canvas.style.cursor = findAnnotation(x, y) ? 'grab' : 'crosshair';
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
