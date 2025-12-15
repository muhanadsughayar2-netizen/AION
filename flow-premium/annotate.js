// Flow Annotation Tool - SIMPLE VERSION (only working tools)

let canvas, ctx;
let currentTool = 'select';
let currentColor = '#007AFF';
let brushSize = 12;
let isDrawing = false;
let startX, startY;
let annotations = [];
let originalImage = null;
let calloutNumber = 1;
let draggingAnnotation = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let pendingStickerText = null;
let pendingSpecialEmoji = null;

// Crop/Snip mode variables
let isSnipMode = false;
let cropRect = null;
let isCropping = false;
let cropStartX, cropStartY, cropEndX, cropEndY;
let cropHandle = null; // 'tl', 'tr', 'bl', 'br', 't', 'r', 'b', 'l', or 'move'
let cropDragStartX = 0, cropDragStartY = 0;

// Full Page Paginated Mode variables
let isFullPageMode = false;
let pages = []; // Array of page image data URLs
let pageImages = []; // Array of loaded Image objects
let pageAnnotations = []; // Annotations per page: [[page0 annotations], [page1 annotations], ...]
let pageOriginalImages = []; // Original ImageData per page
let pagesUntouched = []; // Original unmodified pages for smart crop (never mutated)
let currentPageIndex = 0;

// Cumulative crop state for smart crop (relative to pagesUntouched)
let cumulativeCrop = {
  sideX: 0,         // Left offset applied
  sideWidth: null,  // Width after crop (null = full width)
  topCrop: 0,       // Top crop on page 0
  bottomCrop: 0     // Bottom crop on last page
};

// Zoom and Frame variables - will be overridden by settings
let zoomLevel = 1.0;
let hasBrowserFrame = false;
let browserFrameUrl = '';
let browserFrameStyle = 'mac'; // 'mac', 'windows', 'minimal'
let browserFramePosition = 'top'; // 'top' or 'bottom' - exactly like GoFullPage
let hasBorder = true; // ENABLED by default for professional output

// History stack for full undo/redo (GoFullPage-style)
let historyStack = [];
let redoStack = [];
const MAX_HISTORY = 50; // Limit to prevent memory issues
let borderColor = '#007AFF'; // Blue - SnapToAI brand (fixed, no picker)
let borderWidth = 2; // Default to thin
let borderRadius = 0; // Always square (no rounded corners)

// PDF chunk uniform dimensions (ensures all chunks in PDF have same width & height)
window.finalChunkWidth = null;
window.finalChunkHeight = null;

// Generate smart name for RE-EDIT functionality
function generateSmartNameForFullPage(url, title) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    
    // AI Platforms
    if (hostname.includes('chatgpt.com') || hostname.includes('chat.openai.com')) return 'ChatGPT Chat';
    if (hostname.includes('claude.ai')) return 'Claude Conversation';
    if (hostname.includes('grok.com') || hostname.includes('x.com/i/grok')) return 'Grok Thread';
    if (hostname.includes('gemini.google.com')) return 'Gemini Session';
    if (hostname.includes('perplexity.ai')) return 'Perplexity Search';
    if (hostname.includes('specode.ai')) return 'Specode Code';
    if (hostname.includes('replit.com')) return 'Replit Project';
    
    // Popular sites
    if (hostname.includes('github.com')) return 'GitHub Page';
    if (hostname.includes('stackoverflow.com')) return 'StackOverflow';
    if (hostname.includes('wikipedia.org')) return 'Wikipedia Article';
    if (hostname.includes('youtube.com')) return 'YouTube Page';
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'X/Twitter';
    if (hostname.includes('reddit.com')) return 'Reddit Thread';
    if (hostname.includes('notion.so') || hostname.includes('notion.site')) return 'Notion Page';
    if (hostname.includes('docs.google.com')) return 'Google Docs';
    
    // Fallback: Use page title (first 30 chars) or domain
    if (title && title.length > 0) {
      const cleanTitle = title.replace(/[^\w\s-]/g, '').trim();
      return cleanTitle.length > 30 ? cleanTitle.substring(0, 30) + '...' : cleanTitle;
    }
    
    // Last fallback: domain name
    return hostname.replace('www.', '').split('.')[0];
  } catch (e) {
    return 'Full Page';
  }
}

// ============================================================
// AUTO DUPLICATE-ROW REMOVAL
// Compares pixel rows in overlap area to find exact match point
// ============================================================

function findBestOverlapMatch(img1Data, img2, expectedOverlap, searchRange = 50) {
  try {
    const canvas2 = document.createElement('canvas');
    canvas2.width = img2.width;
    canvas2.height = Math.min(expectedOverlap + searchRange, img2.height);
    const ctx2 = canvas2.getContext('2d', { willReadFrequently: true });
    ctx2.drawImage(img2, 0, 0);
    const img2Data = ctx2.getImageData(0, 0, canvas2.width, canvas2.height);
    
    const width = img2.width;
    const sampleWidth = Math.min(width, 200);
    const sampleStart = Math.floor((width - sampleWidth) / 2);
    
    let bestMatch = expectedOverlap;
    let bestScore = Infinity;
    
    const minOverlap = Math.max(0, expectedOverlap - searchRange);
    const maxOverlap = Math.min(img1Data.height, expectedOverlap + searchRange);
    
    for (let testOverlap = minOverlap; testOverlap <= maxOverlap; testOverlap++) {
      let score = 0;
      const rowsToCompare = Math.min(5, expectedOverlap);
      
      for (let row = 0; row < rowsToCompare; row++) {
        const y1 = img1Data.height - testOverlap + row;
        const y2 = row;
        
        if (y1 < 0 || y1 >= img1Data.height || y2 >= img2Data.height) continue;
        
        for (let x = sampleStart; x < sampleStart + sampleWidth; x++) {
          const idx1 = (y1 * img1Data.width + x) * 4;
          const idx2 = (y2 * width + x) * 4;
          
          const dr = Math.abs(img1Data.data[idx1] - img2Data.data[idx2]);
          const dg = Math.abs(img1Data.data[idx1 + 1] - img2Data.data[idx2 + 1]);
          const db = Math.abs(img1Data.data[idx1 + 2] - img2Data.data[idx2 + 2]);
          
          score += dr + dg + db;
        }
      }
      
      score = score / (rowsToCompare * sampleWidth);
      
      if (score < bestScore) {
        bestScore = score;
        bestMatch = testOverlap;
      }
      
      if (bestScore < 5) break;
    }
    
    if (bestScore < 30) {
      console.log(`[SnapToAI] Duplicate-row removal: adjusted overlap ${expectedOverlap}px -> ${bestMatch}px`);
      return bestMatch;
    }
    return expectedOverlap;
  } catch (e) {
    return expectedOverlap;
  }
}

function getCanvasImageData(canvas, bottomRows) {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const startY = Math.max(0, canvas.height - bottomRows);
    const height = Math.min(bottomRows, canvas.height);
    return ctx.getImageData(0, startY, canvas.width, height);
  } catch (e) {
    return null;
  }
}

// ============================================================
// END AUTO DUPLICATE-ROW REMOVAL
// ============================================================

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
  ctx = canvas.getContext('2d', { willReadFrequently: true });
  
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
    // Crop tool is now available in ALL modes - users can crop and continue editing
    const cropBtn = document.querySelector('.tool-btn[data-tool="crop"]');
    if (cropBtn) cropBtn.style.display = 'inline-flex';
  }
});

// Initialize border and frame UI to reflect current settings
function initializeBorderUI() {
  // Border UI - color is fixed blue, always square, no radius option
  const borderBtn = document.getElementById('toggleBorder');
  const widthSelect = document.getElementById('borderWidth');
  
  if (hasBorder) {
    borderBtn.classList.add('active');
    widthSelect.style.display = 'block';
  } else {
    borderBtn.classList.remove('active');
    widthSelect.style.display = 'none';
  }
  
  // Apply initial CSS border
  updateCssBorder();
  
  // Browser frame UI
  const frameBtn = document.getElementById('toggleBrowserFrame');
  
  // Force fixed settings: always macOS style, always top
  browserFrameStyle = 'mac';
  browserFramePosition = 'top';
  
  if (hasBrowserFrame) {
    frameBtn.classList.add('active');
  } else {
    frameBtn.classList.remove('active');
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
  if (saveBtn) saveBtn.innerHTML = '💾 Save Snip';
  
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
  
  
  // Browser frame toggle - SIMPLIFIED: always macOS style, always top, auto URL
  document.getElementById('toggleBrowserFrame').addEventListener('click', async () => {
    hasBrowserFrame = !hasBrowserFrame;
    const btn = document.getElementById('toggleBrowserFrame');
    
    // Force fixed settings: macOS style, URL on top (no extra UI needed)
    browserFrameStyle = 'mac';
    browserFramePosition = 'top';
    
    if (hasBrowserFrame) {
      btn.classList.add('active');
      
      // Auto-fill URL from storage (captured page URL) - no input field shown
      try {
        const stored = await chrome.storage.session.get(['lastCapturedPageUrl', 'lastCapturedPageTitle']);
        if (stored.lastCapturedPageUrl && stored.lastCapturedPageUrl !== '') {
          browserFrameUrl = stored.lastCapturedPageUrl;
        } else {
          browserFrameUrl = 'example.com';
        }
      } catch (e) {
        browserFrameUrl = 'example.com';
      }
    } else {
      btn.classList.remove('active');
    }
    updateBrowserFrameOverlay();
    redraw();
  });
  
  document.getElementById('urlInput').addEventListener('input', (e) => {
    browserFrameUrl = e.target.value;
    updateBrowserFrameOverlay();
    if (hasBrowserFrame) redraw();
  });
  
  document.getElementById('frameStyle').addEventListener('change', (e) => {
    browserFrameStyle = e.target.value;
    updateBrowserFrameOverlay();
    if (hasBrowserFrame) redraw();
  });
  
  // URL position toggle (top/bottom)
  document.getElementById('frameUrlPosition').addEventListener('change', (e) => {
    browserFramePosition = e.target.value;
    updateBrowserFrameOverlay();
    if (hasBrowserFrame) redraw();
  });
  
  // Border toggle - color is fixed blue, only show size option (always square)
  document.getElementById('toggleBorder').addEventListener('click', () => {
    hasBorder = !hasBorder;
    const btn = document.getElementById('toggleBorder');
    const widthSelect = document.getElementById('borderWidth');
    
    if (hasBorder) {
      btn.classList.add('active');
      widthSelect.style.display = 'block';
    } else {
      btn.classList.remove('active');
      widthSelect.style.display = 'none';
    }
    updateCssBorder(); // Use CSS border on wrapper (wraps browser frame too)
  });
  
  document.getElementById('borderColor').addEventListener('input', (e) => {
    borderColor = e.target.value;
    if (hasBorder) updateCssBorder();
  });
  
  document.getElementById('borderWidth').addEventListener('change', (e) => {
    borderWidth = parseInt(e.target.value);
    if (hasBorder) updateCssBorder();
  });
  
  // Tools
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tool = btn.dataset.tool;
      
      // Special emoji tool - show/hide panel
      if (tool === 'special') {
        e.stopPropagation();
        const panel = document.getElementById('emojiPanel');
        const isVisible = panel.style.display === 'block';
        panel.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) {
          updateStatus('Click an emoji to place it on the image');
        }
        return;
      }
      
      // Hide emoji panel when switching to other tools
      document.getElementById('emojiPanel').style.display = 'none';
      
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = tool;
      pendingStickerText = null; // Clear pending sticker when switching tools
      pendingSpecialEmoji = null; // Clear pending emoji when switching tools
      
      // Handle crop tool activation
      if (tool === 'crop') {
        enterCropMode();
        return;
      }
      
      // Update status based on tool
      if (tool === 'select') {
        updateStatus('Click objects to move, delete with Backspace');
      } else {
        updateStatus('Add numbers, shapes, or text. All draggable!');
      }
    });
  });
  
  // Emoji panel items
  document.querySelectorAll('.emoji-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const emoji = item.dataset.emoji;
      pendingSpecialEmoji = emoji;
      currentTool = 'special';
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      document.getElementById('specialBtn').classList.add('active');
      document.getElementById('emojiPanel').style.display = 'none';
      canvas.style.cursor = 'crosshair';
      updateStatus(`Click on the image to place ${emoji}`);
    });
  });
  
  // Close emoji panel when clicking outside
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('emojiPanel');
    const specialBtn = document.getElementById('specialBtn');
    if (panel && !panel.contains(e.target) && e.target !== specialBtn) {
      panel.style.display = 'none';
    }
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
    undo();
  });
  
  // Redo button handler
  const redoBtn = document.getElementById('redoBtn');
  if (redoBtn) {
    redoBtn.addEventListener('click', () => {
      redo();
    });
  }
  
  // Initialize history buttons
  updateHistoryButtons();
  
  document.getElementById('clearBtn').addEventListener('click', () => {
    pushHistory(); // Save state before clearing (enables undo)
    annotations = [];
    calloutNumber = 1;
    redraw();
    updateHistoryButtons();
  });
  
  document.getElementById('saveBtn').addEventListener('click', save);
  document.getElementById('cancelBtn').addEventListener('click', () => window.close());
  
  // Crop Done/Cancel button handlers
  const doneCropBtn = document.getElementById('doneCropBtn');
  if (doneCropBtn) {
    doneCropBtn.addEventListener('click', () => {
      applyVisualCrop();
    });
  }
  
  const cancelCropBtn = document.getElementById('cancelCropBtn');
  if (cancelCropBtn) {
    cancelCropBtn.addEventListener('click', () => {
      exitCropMode();
    });
  }
  
  // ESC key handler - cancel current action, return to select mode
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (currentTool === 'crop') {
        exitCropMode();
        return;
      }
      currentTool = 'select';
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      const selectBtn = document.querySelector('[data-tool="select"]');
      if (selectBtn) selectBtn.classList.add('active');
      canvas.style.cursor = 'default';
      cropRect = null;
      isCropping = false;
      pendingStickerText = null;
      pendingSpecialEmoji = null;
      redraw();
      updateStatus('Select mode — click objects to move, delete with Backspace');
    }
  });
  
  // Canvas
  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mouseup', handleMouseUp);
  
}

async function loadImage() {
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode');
  
  // Full Page Mode - load pages from local storage
  if (isFullPageMode) {
    loadFullPageImages();
    return;
  }
  
  // Edit Mode OR Reedit Mode - load image from local storage (handles large images)
  if (mode === 'edit' || mode === 'reedit') {
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
        
        // Clear editImage from storage after loading (but keep reeditCapture for save)
        chrome.storage.local.remove(['editImage']);
        
        // Redraw immediately to apply default border styling
        redraw();
        updateCssBorder(); // Apply CSS border on wrapper
        
        // Push initial state to history (enables undo)
        pushHistory();
        updateHistoryButtons();
        
        if (mode === 'reedit') {
          updateStatus('Full page ready for editing');
        }
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
      updateCssBorder(); // Apply CSS border on wrapper
      
      // Push initial state to history (enables undo)
      pushHistory();
      updateHistoryButtons();
      
      // Load real URL for browser frame (same as full-page)
      (async () => {
        try {
          const stored = await chrome.storage.session.get(['lastCapturedPageUrl']);
          if (stored.lastCapturedPageUrl && stored.lastCapturedPageUrl !== '') {
            browserFrameUrl = stored.lastCapturedPageUrl;
          } else {
            browserFrameUrl = 'example.com';
          }
          updateBrowserFrameOverlay();
          redraw();
        } catch (e) {
          browserFrameUrl = 'example.com';
        }
      })();
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
    
    // Store untouched copy for smart crop (never modify this array)
    pagesUntouched = [...pages];
    
    // Reset cumulative crop state
    cumulativeCrop = { sideX: 0, sideWidth: null, topCrop: 0, bottomCrop: 0 };
    
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
    updateCssBorder(); // Apply CSS border on wrapper for full page mode
    
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
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
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
  
  // Handle visual crop tool with 8 handles
  if (currentTool === 'crop' && cropRect) {
    const pos = { x: startX, y: startY };
    cropHandle = getCropHandleAt(pos);
    
    if (cropHandle) {
      cropDragStartX = startX;
      cropDragStartY = startY;
      canvas.style.cursor = getCropCursor(cropHandle);
      return;
    }
  }
  
  // Handle snip mode (drawing new crop area)
  if (currentTool === 'crop' && !cropRect) {
    isCropping = true;
    cropStartX = startX;
    cropStartY = startY;
    cropEndX = startX;
    cropEndY = startY;
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
  
  if (currentTool === 'special' && pendingSpecialEmoji) {
    // Place selected emoji from panel
    pushHistory();
    annotations.push({
      tool: 'special',
      text: pendingSpecialEmoji,
      x: startX,
      y: startY
    });
    pendingSpecialEmoji = null;
    canvas.style.cursor = 'default';
    redraw();
    updateStatus('Emoji placed! Click 🎯 to add more.');
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
    updateStatus('Add numbers, shapes, or text. All draggable!');
  } else if (currentTool === 'rectangle' || currentTool === 'arrow') {
    isDrawing = true;
    // Store starting position for rectangle/arrow
  } else if (currentTool === 'callout') {
    const label = prompt('Label:', 'Step ' + calloutNumber);
    if (label) {
      pushHistory(); // Save state before action
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
  }
}

function handleMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  
  // Handle visual crop handle dragging
  if (currentTool === 'crop' && cropHandle && cropRect) {
    const dx = x - cropDragStartX;
    const dy = y - cropDragStartY;
    
    let { x: cx, y: cy, width: cw, height: ch } = cropRect;
    
    // Check if multi-page full-page mode (must be explicit true check)
    const isMultiPageFullPage = isFullPageMode === true && Array.isArray(pages) && pages.length > 1;
    
    if (cropHandle === 'move') {
      // Move: preserve size, just change position
      cx += dx;
      // Only allow vertical move for single images (not full-page groups)
      if (!isMultiPageFullPage) {
        cy += dy;
      }
      // Clamp position to keep box inside canvas
      if (cx < 0) cx = 0;
      if (cy < 0) cy = 0;
      if (cx + cw > canvas.width) cx = canvas.width - cw;
      if (cy + ch > canvas.height) cy = canvas.height - ch;
    } else {
      // Resize handles - horizontal always allowed
      if (cropHandle.includes('l')) { cx += dx; cw -= dx; }
      if (cropHandle.includes('r')) cw += dx;
      
      // Vertical resize logic
      if (isMultiPageFullPage) {
        // Full-page group: smart vertical cropping based on page position
        const isFirstPage = currentPageIndex === 0;
        const isLastPage = currentPageIndex === pages.length - 1;
        if (isFirstPage && cropHandle === 't') { cy += dy; ch -= dy; }
        if (isLastPage && cropHandle === 'b') ch += dy;
      } else {
        // Single image/snip: full vertical cropping allowed
        if (cropHandle.includes('t')) { cy += dy; ch -= dy; }
        if (cropHandle.includes('b')) ch += dy;
      }
      
      // Prevent too small
      if (cw < 50) cw = 50;
      if (ch < 50) ch = 50;
      if (cx < 0) cx = 0;
      if (cy < 0) cy = 0;
      if (cx + cw > canvas.width) cw = canvas.width - cx;
      if (cy + ch > canvas.height) ch = canvas.height - cy;
    }
    
    cropRect = { x: cx, y: cy, width: cw, height: ch };
    cropDragStartX = x;
    cropDragStartY = y;
    
    redraw();
    if (isMultiPageFullPage) {
      const isFirstPage = currentPageIndex === 0;
      const isLastPage = currentPageIndex === pages.length - 1;
      if (isFirstPage) {
        updateStatus(`Crop: ${Math.round(cw)}px wide, top trim ${Math.round(cy)}px`);
      } else if (isLastPage) {
        updateStatus(`Crop: ${Math.round(cw)}px wide, bottom trim ${Math.round(canvas.height - cy - ch)}px`);
      } else {
        updateStatus(`Sidebar crop: ${Math.round(cw)}px wide (left/right only on this page)`);
      }
    } else {
      updateStatus(`Crop: ${Math.round(cw)} × ${Math.round(ch)}`);
    }
    return;
  }
  
  // Handle new crop drawing (snip mode)
  if (isCropping && currentTool === 'crop') {
    cropEndX = x;
    cropEndY = y;
    redraw();
    drawCropPreview();
    return;
  }
  
  // Update cursor for crop mode
  if (currentTool === 'crop' && cropRect) {
    const pos = { x, y };
    const handle = getCropHandleAt(pos);
    canvas.style.cursor = handle ? getCropCursor(handle) : 'default';
    return;
  }
  
  if (draggingAnnotation) {
    draggingAnnotation.x = x - dragOffsetX;
    draggingAnnotation.y = y - dragOffsetY;
    
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
    // Arrow preview - line uses currentColor, arrowhead always white
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = 3;
    ctx.shadowColor = currentColor;
    ctx.shadowBlur = 10;
    ctx.globalAlpha = 0.7;
    
    // Draw line
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(x, y);
    ctx.stroke();
    
    // Draw white arrowhead with dark border (visible on any background)
    ctx.fillStyle = '#fff';
    const angle = Math.atan2(y - startY, x - startX);
    const headLength = 20;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - headLength * Math.cos(angle - Math.PI / 6), y - headLength * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x - headLength * Math.cos(angle + Math.PI / 6), y - headLength * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    return;
  }
  
}

function handleMouseUp(e) {
  // Handle crop handle release
  if (cropHandle) {
    cropHandle = null;
    if (cropRect) {
      canvas.style.cursor = 'default';
    }
    return;
  }
  
  // Handle crop completion (new crop drawing)
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
    if (width > 50 && height > 50) {
      cropRect = { x: x1, y: y1, width, height };
      redraw();
      updateStatus(`Crop: ${Math.round(width)} × ${Math.round(height)}. Drag handles to adjust.`);
    } else {
      updateStatus('Crop area too small (min 50x50)');
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
      pushHistory(); // Save state before action
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
      pushHistory(); // Save state before action
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
  ctx.strokeStyle = '#007AFF';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.strokeRect(x1, y1, width, height);
  ctx.setLineDash([]);
  
  // Draw corner handles
  const handleSize = 8;
  ctx.fillStyle = '#007AFF';
  ctx.fillRect(x1 - handleSize/2, y1 - handleSize/2, handleSize, handleSize);
  ctx.fillRect(x1 + width - handleSize/2, y1 - handleSize/2, handleSize, handleSize);
  ctx.fillRect(x1 - handleSize/2, y1 + height - handleSize/2, handleSize, handleSize);
  ctx.fillRect(x1 + width - handleSize/2, y1 + height - handleSize/2, handleSize, handleSize);
  
  // Draw dimensions label
  ctx.fillStyle = '#007AFF';
  ctx.font = 'bold 14px Arial';
  ctx.fillText(`${Math.round(width)} x ${Math.round(height)}`, x1 + 5, y1 - 8);
}

// Draw final crop rectangle with smart handles based on mode and page position
function drawCropRect() {
  if (!cropRect) return;
  
  const { x, y, width, height } = cropRect;
  
  // Check if multi-page full-page mode (must be explicit true check)
  const isMultiPageFullPage = isFullPageMode === true && Array.isArray(pages) && pages.length > 1;
  
  // Draw semi-transparent overlay outside crop area
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, canvas.width, y); // Top
  ctx.fillRect(0, y + height, canvas.width, canvas.height - y - height); // Bottom
  ctx.fillRect(0, y, x, height); // Left
  ctx.fillRect(x + width, y, canvas.width - x - width, height); // Right
  
  // Draw crop border
  ctx.strokeStyle = '#007AFF';
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x, y, width, height);
  ctx.setLineDash([]);
  
  const hs = 12;
  ctx.fillStyle = '#007AFF';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  
  if (isMultiPageFullPage) {
    // For full-page groups: show handles based on page position
    // Compute boundary flags only inside this block (safe since pages.length > 1)
    const isFirstPage = currentPageIndex === 0;
    const isLastPage = currentPageIndex === pages.length - 1;
    
    // Always show left/right edge handles (sidebar crop)
    ctx.fillRect(x - hs/2, y + height/2 - hs/2, hs, hs);
    ctx.strokeRect(x - hs/2, y + height/2 - hs/2, hs, hs);
    ctx.fillRect(x + width - hs/2, y + height/2 - hs/2, hs, hs);
    ctx.strokeRect(x + width - hs/2, y + height/2 - hs/2, hs, hs);
    
    // Top handle: only on first page
    if (isFirstPage) {
      ctx.fillRect(x + width/2 - hs/2, y - hs/2, hs, hs);
      ctx.strokeRect(x + width/2 - hs/2, y - hs/2, hs, hs);
    }
    
    // Bottom handle: only on last page
    if (isLastPage) {
      ctx.fillRect(x + width/2 - hs/2, y + height - hs/2, hs, hs);
      ctx.strokeRect(x + width/2 - hs/2, y + height - hs/2, hs, hs);
    }
    
    // Draw info label
    ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#007AFF';
    if (isFirstPage) {
      ctx.fillText(`Page 1: Crop sidebar + top`, x + width/2, y + height/2);
    } else if (isLastPage) {
      ctx.fillText(`Last page: Crop sidebar + bottom`, x + width/2, y + height/2);
    } else {
      ctx.fillText(`Sidebar crop only (${Math.round(width)}px)`, x + width/2, y + height/2);
    }
  } else {
    // Single image/snip: show all 8 handles (corners + edges)
    // Corner handles
    ctx.fillRect(x - hs/2, y - hs/2, hs, hs);
    ctx.strokeRect(x - hs/2, y - hs/2, hs, hs);
    ctx.fillRect(x + width - hs/2, y - hs/2, hs, hs);
    ctx.strokeRect(x + width - hs/2, y - hs/2, hs, hs);
    ctx.fillRect(x - hs/2, y + height - hs/2, hs, hs);
    ctx.strokeRect(x - hs/2, y + height - hs/2, hs, hs);
    ctx.fillRect(x + width - hs/2, y + height - hs/2, hs, hs);
    ctx.strokeRect(x + width - hs/2, y + height - hs/2, hs, hs);
    
    // Edge handles (centers of each side)
    ctx.fillRect(x + width/2 - hs/2, y - hs/2, hs, hs);
    ctx.strokeRect(x + width/2 - hs/2, y - hs/2, hs, hs);
    ctx.fillRect(x + width/2 - hs/2, y + height - hs/2, hs, hs);
    ctx.strokeRect(x + width/2 - hs/2, y + height - hs/2, hs, hs);
    ctx.fillRect(x - hs/2, y + height/2 - hs/2, hs, hs);
    ctx.strokeRect(x - hs/2, y + height/2 - hs/2, hs, hs);
    ctx.fillRect(x + width - hs/2, y + height/2 - hs/2, hs, hs);
    ctx.strokeRect(x + width - hs/2, y + height/2 - hs/2, hs, hs);
    
    // Draw dimensions label
    ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#007AFF';
    ctx.fillText(`${Math.round(width)} × ${Math.round(height)}`, x + width/2, y + height/2);
  }
}

// ========================================
// APPLY CROP - Permanently resize canvas
// ========================================
function applyCrop() {
  if (!cropRect) {
    updateStatus('Draw a crop rectangle first.');
    return;
  }
  
  const { x, y, width, height } = cropRect;
  
  // Validate crop dimensions
  if (width < 10 || height < 10) {
    updateStatus('Crop area too small.');
    return;
  }
  
  // Save state before crop for undo
  pushHistory();
  
  console.log('[SnapToAI] Applying crop:', { x, y, width, height });
  
  // Extract the cropped region from original image
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
  
  // Draw the cropped region
  tempCtx.putImageData(
    originalImage,
    -x, -y,
    x, y, width, height
  );
  
  // Resize main canvas to cropped size
  canvas.width = width;
  canvas.height = height;
  
  // Draw cropped image onto main canvas
  ctx.drawImage(tempCanvas, 0, 0);
  
  // Update original image reference
  originalImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
  
  // Clear annotations (they're relative to old coordinates)
  // User can add new ones on the cropped canvas
  annotations = [];
  calloutNumber = 1;
  
  // Clear crop rectangle
  cropRect = null;
  
  // Redraw
  redraw();
  
  // Update frame overlay position if enabled
  updateBrowserFrameOverlay();
  
  updateStatus(`Cropped to ${width}x${height}. Continue editing or save.`);
  console.log('[SnapToAI] Crop applied successfully');
}

// SNIP MODE: Save snip to queue WITHOUT modifying the original image
// Allows multiple snips from the same source image
async function saveSnipToQueue() {
  if (!cropRect) {
    updateStatus('Draw a rectangle first to snip an area.');
    return;
  }
  
  const { x, y, width, height } = cropRect;
  
  // Validate dimensions
  if (width < 10 || height < 10) {
    updateStatus('Snip area too small.');
    return;
  }
  
  try {
    // Create temporary canvas for the snipped region
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    
    // Draw the snipped region from original image (NOT modifying original)
    tempCtx.putImageData(
      originalImage,
      -x, -y,
      x, y, width, height
    );
    
    // Apply border and browser frame decoration if enabled
    let snipDataUrl;
    if (hasBorder || hasBrowserFrame) {
      const decoratedCanvas = applyBorderDecoration(tempCanvas);
      snipDataUrl = decoratedCanvas.toDataURL('image/png');
    } else {
      snipDataUrl = tempCanvas.toDataURL('image/png');
    }
    
    // Send as new snap (add to queue) with isSnip metadata
    const response = await chrome.runtime.sendMessage({
      action: 'snipComplete',
      dataUrl: snipDataUrl,
      metadata: { isSnip: true }
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
    
    // Clear crop rectangle but KEEP original image intact
    cropRect = null;
    
    // Redraw the original image (ready for more snips)
    redraw();
    
    updateStatus('Snip saved! Draw another area to snip more.');
    console.log('[SnapToAI] Snip saved to queue, original preserved for more snips');
    
  } catch (error) {
    console.error('[SnapToAI] Snip save error:', error);
    updateStatus('Failed to save snip. Try again.');
  }
}

function findAnnotation(x, y) {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const ann = annotations[i];
    const tolerance = 50;
    
    if (Math.abs(x - ann.x) < tolerance && Math.abs(y - ann.y) < tolerance) {
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
  const newCtx = newCanvas.getContext('2d', { willReadFrequently: true });
  
  if (browserFrameStyle === 'mac') {
    // macOS Style - SnapToAI brand (black + blue)
    newCtx.fillStyle = '#000';
    newCtx.fillRect(0, 0, newCanvas.width, frameHeight);
    
    // Traffic lights - all blue with opacity
    const buttonY = frameHeight / 2;
    const circles = [
      { x: 20, opacity: 1 },
      { x: 40, opacity: 0.6 },
      { x: 60, opacity: 0.3 }
    ];
    circles.forEach(c => {
      newCtx.fillStyle = '#007AFF';
      newCtx.globalAlpha = c.opacity;
      newCtx.beginPath();
      newCtx.arc(c.x, buttonY, 6, 0, Math.PI * 2);
      newCtx.fill();
    });
    newCtx.globalAlpha = 1;
    
    // URL bar
    newCtx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    newCtx.beginPath();
    newCtx.roundRect(85, 10, newCanvas.width - 110, 24, 6);
    newCtx.fill();
    
    // Lock icon + URL
    newCtx.fillStyle = '#fff';
    newCtx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    newCtx.textAlign = 'left';
    newCtx.textBaseline = 'middle';
    newCtx.fillText('🔒 ' + (browserFrameUrl || 'example.com'), 95, buttonY);
    
  } else if (browserFrameStyle === 'windows') {
    // Windows Style - SnapToAI brand (white + blue)
    newCtx.fillStyle = '#fff';
    newCtx.fillRect(0, 0, newCanvas.width, frameHeight);
    
    // Window controls (right side)
    const btnWidth = 46;
    const btnHeight = frameHeight;
    // Minimize
    newCtx.fillStyle = '#fff';
    newCtx.fillRect(newCanvas.width - btnWidth * 3, 0, btnWidth, btnHeight);
    newCtx.strokeStyle = '#007AFF';
    newCtx.lineWidth = 1;
    newCtx.beginPath();
    newCtx.moveTo(newCanvas.width - btnWidth * 3 + 18, frameHeight / 2);
    newCtx.lineTo(newCanvas.width - btnWidth * 3 + 28, frameHeight / 2);
    newCtx.stroke();
    // Maximize
    newCtx.fillStyle = '#fff';
    newCtx.fillRect(newCanvas.width - btnWidth * 2, 0, btnWidth, btnHeight);
    newCtx.strokeRect(newCanvas.width - btnWidth * 2 + 18, frameHeight / 2 - 5, 10, 10);
    // Close
    newCtx.fillStyle = '#007AFF';
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
    newCtx.strokeStyle = '#007AFF';
    newCtx.lineWidth = 1;
    newCtx.beginPath();
    newCtx.roundRect(10, 8, newCanvas.width - 160, 28, 4);
    newCtx.fill();
    newCtx.stroke();
    
    // URL text
    newCtx.fillStyle = '#000';
    newCtx.font = '13px Segoe UI, sans-serif';
    newCtx.textAlign = 'left';
    newCtx.textBaseline = 'middle';
    newCtx.fillText('🔒 ' + (browserFrameUrl || 'example.com'), 20, frameHeight / 2);
    
  } else {
    // Minimal Style - SnapToAI brand
    newCtx.fillStyle = '#000';
    newCtx.fillRect(0, 0, newCanvas.width, frameHeight);
    
    // Simple URL bar
    newCtx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    newCtx.strokeStyle = '#007AFF';
    newCtx.lineWidth = 1;
    newCtx.beginPath();
    newCtx.roundRect(10, 6, newCanvas.width - 20, 20, 10);
    newCtx.fill();
    newCtx.stroke();
    
    // URL text centered
    newCtx.fillStyle = '#fff';
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
  // First, apply browser frame if enabled (adds height at top or bottom)
  let workingCanvas = sourceCanvas;
  
  if (hasBrowserFrame) {
    const frameHeight = browserFrameStyle === 'minimal' ? 32 : 44;
    const framedCanvas = document.createElement('canvas');
    framedCanvas.width = sourceCanvas.width;
    framedCanvas.height = sourceCanvas.height + frameHeight;
    const framedCtx = framedCanvas.getContext('2d', { willReadFrequently: true });
    
    // Determine frame Y position based on browserFramePosition (top/bottom)
    const isBottom = browserFramePosition === 'bottom';
    const frameY = isBottom ? sourceCanvas.height : 0;
    const imageY = isBottom ? 0 : frameHeight;
    
    // Draw the source canvas first (at correct position)
    framedCtx.drawImage(sourceCanvas, 0, imageY);
    
    // Draw the frame header at frameY - SnapToAI brand colors
    if (browserFrameStyle === 'mac') {
      framedCtx.fillStyle = '#000';
      framedCtx.fillRect(0, frameY, framedCanvas.width, frameHeight);
      const buttonY = frameY + frameHeight / 2;
      [{ x: 20, opacity: 1 }, { x: 40, opacity: 0.6 }, { x: 60, opacity: 0.3 }].forEach(b => {
        framedCtx.fillStyle = '#007AFF';
        framedCtx.globalAlpha = b.opacity;
        framedCtx.beginPath();
        framedCtx.arc(b.x, buttonY, 6, 0, Math.PI * 2);
        framedCtx.fill();
      });
      framedCtx.globalAlpha = 1;
      framedCtx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      framedCtx.beginPath();
      framedCtx.roundRect(85, frameY + 10, framedCanvas.width - 110, 24, 6);
      framedCtx.fill();
      framedCtx.fillStyle = '#fff';
      framedCtx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
      framedCtx.textAlign = 'left';
      framedCtx.textBaseline = 'middle';
      framedCtx.fillText('🔒 ' + (browserFrameUrl || 'example.com'), 95, buttonY);
    } else if (browserFrameStyle === 'windows') {
      framedCtx.fillStyle = '#fff';
      framedCtx.fillRect(0, frameY, framedCanvas.width, frameHeight);
      const btnWidth = 46;
      framedCtx.fillStyle = '#fff';
      framedCtx.fillRect(framedCanvas.width - btnWidth * 3, frameY, btnWidth, frameHeight);
      framedCtx.strokeStyle = '#007AFF';
      framedCtx.lineWidth = 1;
      framedCtx.beginPath();
      framedCtx.moveTo(framedCanvas.width - btnWidth * 3 + 18, frameY + frameHeight / 2);
      framedCtx.lineTo(framedCanvas.width - btnWidth * 3 + 28, frameY + frameHeight / 2);
      framedCtx.stroke();
      framedCtx.fillStyle = '#fff';
      framedCtx.fillRect(framedCanvas.width - btnWidth * 2, frameY, btnWidth, frameHeight);
      framedCtx.strokeRect(framedCanvas.width - btnWidth * 2 + 16, frameY + frameHeight / 2 - 5, 14, 10);
      framedCtx.fillStyle = '#007AFF';
      framedCtx.fillRect(framedCanvas.width - btnWidth, frameY, btnWidth, frameHeight);
      framedCtx.strokeStyle = '#fff';
      framedCtx.lineWidth = 1.5;
      framedCtx.beginPath();
      framedCtx.moveTo(framedCanvas.width - btnWidth + 16, frameY + frameHeight / 2 - 5);
      framedCtx.lineTo(framedCanvas.width - btnWidth + 30, frameY + frameHeight / 2 + 5);
      framedCtx.moveTo(framedCanvas.width - btnWidth + 30, frameY + frameHeight / 2 - 5);
      framedCtx.lineTo(framedCanvas.width - btnWidth + 16, frameY + frameHeight / 2 + 5);
      framedCtx.stroke();
      framedCtx.fillStyle = '#fff';
      framedCtx.beginPath();
      framedCtx.roundRect(10, frameY + 10, framedCanvas.width - btnWidth * 3 - 30, 24, 4);
      framedCtx.fill();
      framedCtx.strokeStyle = '#007AFF';
      framedCtx.lineWidth = 1;
      framedCtx.stroke();
      framedCtx.fillStyle = '#000';
      framedCtx.font = '12px Segoe UI, sans-serif';
      framedCtx.textAlign = 'left';
      framedCtx.textBaseline = 'middle';
      framedCtx.fillText('🔒 ' + (browserFrameUrl || 'example.com'), 20, frameY + frameHeight / 2);
    } else if (browserFrameStyle === 'minimal') {
      framedCtx.fillStyle = '#000';
      framedCtx.fillRect(0, frameY, framedCanvas.width, frameHeight);
      const barWidth = Math.min(400, framedCanvas.width - 40);
      framedCtx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      framedCtx.beginPath();
      framedCtx.roundRect((framedCanvas.width - barWidth) / 2, frameY + 6, barWidth, 20, 4);
      framedCtx.fill();
      framedCtx.fillStyle = '#fff';
      framedCtx.font = '11px system-ui, sans-serif';
      framedCtx.textAlign = 'center';
      framedCtx.textBaseline = 'middle';
      framedCtx.fillText('🔒 ' + (browserFrameUrl || 'example.com'), framedCanvas.width / 2, frameY + frameHeight / 2);
    }
    
    workingCanvas = framedCanvas;
  }
  
  // Now apply border if enabled
  if (!hasBorder) {
    return workingCanvas;
  }
  
  const padding = borderWidth;
  const decoratedCanvas = document.createElement('canvas');
  const decoratedCtx = decoratedCanvas.getContext('2d', { willReadFrequently: true });
  
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

// Update CSS border on canvas-wrapper (wraps around browser frame overlay too)
function updateCssBorder() {
  const wrapper = document.getElementById('canvasWrapper');
  
  // Remove all border classes first
  wrapper.classList.remove('has-border', 'border-thin', 'border-medium', 'border-thick', 'border-extra');
  
  if (!hasBorder) {
    wrapper.style.borderColor = '';
    return;
  }
  
  // Add border class
  wrapper.classList.add('has-border');
  
  // Set border color dynamically via inline style (matches export)
  wrapper.style.borderColor = borderColor;
  
  // Add width class based on borderWidth
  if (borderWidth <= 2) {
    wrapper.classList.add('border-thin');
  } else if (borderWidth <= 4) {
    wrapper.classList.add('border-medium');
  } else if (borderWidth <= 8) {
    wrapper.classList.add('border-thick');
  } else {
    wrapper.classList.add('border-extra');
  }
}

// Update the floating browser frame overlay (GoFullPage-style, never overlaps content)
function updateBrowserFrameOverlay() {
  const wrapper = document.getElementById('canvasWrapper');
  const overlay = document.getElementById('browserFrameOverlay');
  const urlText = document.getElementById('frameUrlText');
  const trafficLights = overlay.querySelector('.frame-traffic-lights');
  const windowsControls = overlay.querySelector('.frame-windows-controls');
  
  if (!hasBrowserFrame) {
    overlay.style.display = 'none';
    wrapper.classList.remove('url-top', 'url-bottom');
    return;
  }
  
  // Show overlay
  overlay.style.display = 'flex';
  
  // Apply position classes
  wrapper.classList.remove('url-top', 'url-bottom');
  overlay.classList.remove('frame-top', 'frame-bottom');
  
  if (browserFramePosition === 'top') {
    wrapper.classList.add('url-top');
    overlay.classList.add('frame-top');
  } else {
    wrapper.classList.add('url-bottom');
    overlay.classList.add('frame-bottom');
  }
  
  // Apply style classes
  overlay.classList.remove('style-mac', 'style-windows', 'style-minimal', 'frame-minimal');
  wrapper.classList.remove('frame-is-minimal');
  
  if (browserFrameStyle === 'mac') {
    overlay.classList.add('style-mac');
    trafficLights.style.display = 'flex';
    windowsControls.style.display = 'none';
  } else if (browserFrameStyle === 'windows') {
    overlay.classList.add('style-windows');
    trafficLights.style.display = 'none';
    windowsControls.style.display = 'flex';
  } else {
    overlay.classList.add('style-minimal', 'frame-minimal');
    wrapper.classList.add('frame-is-minimal');
    trafficLights.style.display = 'none';
    windowsControls.style.display = 'none';
  }
  
  // Update URL text with ellipsis
  urlText.textContent = '🔒 ' + (browserFrameUrl || 'example.com');
}

// Draw browser frame preview overlay on canvas (for live preview)
function drawBrowserFramePreview() {
  if (!hasBrowserFrame) return;
  
  const frameHeight = browserFrameStyle === 'minimal' ? 32 : 44;
  
  ctx.save();
  
  if (browserFrameStyle === 'mac') {
    // macOS Style - SnapToAI brand (black + blue)
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, frameHeight);
    
    // Traffic lights - all blue with opacity
    const buttonY = frameHeight / 2;
    const circles = [
      { x: 20, opacity: 1 },
      { x: 40, opacity: 0.6 },
      { x: 60, opacity: 0.3 }
    ];
    circles.forEach(c => {
      ctx.fillStyle = '#007AFF';
      ctx.globalAlpha = c.opacity;
      ctx.beginPath();
      ctx.arc(c.x, buttonY, 6, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    
    // URL bar
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.roundRect(85, 10, canvas.width - 110, 24, 6);
    ctx.fill();
    
    // Lock icon + URL
    ctx.fillStyle = '#fff';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔒 ' + (browserFrameUrl || 'example.com'), 95, buttonY);
    
  } else if (browserFrameStyle === 'windows') {
    // Windows Style - SnapToAI brand (white + blue)
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, frameHeight);
    
    // Window controls (right side)
    const btnWidth = 46;
    // Minimize
    ctx.fillStyle = '#fff';
    ctx.fillRect(canvas.width - btnWidth * 3, 0, btnWidth, frameHeight);
    ctx.strokeStyle = '#007AFF';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(canvas.width - btnWidth * 3 + 18, frameHeight / 2);
    ctx.lineTo(canvas.width - btnWidth * 3 + 28, frameHeight / 2);
    ctx.stroke();
    
    // Maximize
    ctx.fillStyle = '#fff';
    ctx.fillRect(canvas.width - btnWidth * 2, 0, btnWidth, frameHeight);
    ctx.strokeRect(canvas.width - btnWidth * 2 + 16, frameHeight / 2 - 5, 14, 10);
    
    // Close (blue)
    ctx.fillStyle = '#007AFF';
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
    ctx.strokeStyle = '#007AFF';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // URL text
    ctx.fillStyle = '#000';
    ctx.font = '12px Segoe UI, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔒 ' + (browserFrameUrl || 'example.com'), 20, frameHeight / 2);
    
  } else if (browserFrameStyle === 'minimal') {
    // Minimal Style - SnapToAI brand
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, frameHeight);
    
    // Centered URL bar
    const barWidth = Math.min(400, canvas.width - 40);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.roundRect((canvas.width - barWidth) / 2, 6, barWidth, 20, 4);
    ctx.fill();
    
    // URL text
    ctx.fillStyle = '#fff';
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

// ========================================
// HISTORY STACK - Full Undo/Redo (GoFullPage-style)
// ========================================

function pushHistory() {
  try {
    // Save current state: canvas data + annotations + settings
    const state = {
      imageData: canvas.toDataURL('image/png'),
      annotations: JSON.parse(JSON.stringify(annotations)),
      calloutNumber: calloutNumber,
      width: canvas.width,
      height: canvas.height
    };
    
    historyStack.push(state);
    
    // Limit history size
    if (historyStack.length > MAX_HISTORY) {
      historyStack.shift();
    }
    
    // Clear redo stack when new action is performed
    redoStack = [];
    
    updateHistoryButtons();
  } catch (e) {
    console.log('[SnapToAI] History push failed:', e);
  }
}

function undo() {
  if (historyStack.length === 0) return;
  
  try {
    // Save current state to redo stack
    const currentState = {
      imageData: canvas.toDataURL('image/png'),
      annotations: JSON.parse(JSON.stringify(annotations)),
      calloutNumber: calloutNumber,
      width: canvas.width,
      height: canvas.height
    };
    redoStack.push(currentState);
    
    // Restore previous state
    const prevState = historyStack.pop();
    
    const img = new Image();
    img.onload = () => {
      canvas.width = prevState.width;
      canvas.height = prevState.height;
      ctx.drawImage(img, 0, 0);
      originalImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
      annotations = prevState.annotations;
      calloutNumber = prevState.calloutNumber;
      redraw();
      updateHistoryButtons();
    };
    img.src = prevState.imageData;
  } catch (e) {
    console.log('[SnapToAI] Undo failed:', e);
  }
}

function redo() {
  if (redoStack.length === 0) return;
  
  try {
    // Save current state to history stack
    const currentState = {
      imageData: canvas.toDataURL('image/png'),
      annotations: JSON.parse(JSON.stringify(annotations)),
      calloutNumber: calloutNumber,
      width: canvas.width,
      height: canvas.height
    };
    historyStack.push(currentState);
    
    // Restore redo state
    const redoState = redoStack.pop();
    
    const img = new Image();
    img.onload = () => {
      canvas.width = redoState.width;
      canvas.height = redoState.height;
      ctx.drawImage(img, 0, 0);
      originalImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
      annotations = redoState.annotations;
      calloutNumber = redoState.calloutNumber;
      redraw();
      updateHistoryButtons();
    };
    img.src = redoState.imageData;
  } catch (e) {
    console.log('[SnapToAI] Redo failed:', e);
  }
}

function updateHistoryButtons() {
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  
  if (undoBtn) {
    undoBtn.disabled = historyStack.length === 0;
    undoBtn.style.opacity = historyStack.length === 0 ? '0.4' : '1';
  }
  
  if (redoBtn) {
    redoBtn.disabled = redoStack.length === 0;
    redoBtn.style.opacity = redoStack.length === 0 ? '0.4' : '1';
  }
}

function redraw() {
  // Guard: Only redraw if we have image data
  if (!originalImage) {
    return;
  }
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.putImageData(originalImage, 0, 0);
  
  // Browser frame is HTML overlay only - no canvas drawing (prevents duplicate URL bar)
  
  // Draw annotations first
  annotations.forEach(ann => {
    if (ann.tool === 'callout') {
      // Soft professional circle (Apple-style)
      ctx.fillStyle = '#007AFF';
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(ann.x, ann.y, 32, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      
      // Clean white number
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ann.number, ann.x, ann.y + 1);
      
      // Label (if exists) - rounded pill style
      if (ann.text) {
        const textY = ann.y + 55;
        ctx.font = 'bold 17px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        const metrics = ctx.measureText(ann.text);
        const padding = 14;
        const labelW = metrics.width + padding * 2;
        
        ctx.fillStyle = '#007AFF';
        ctx.beginPath();
        ctx.roundRect(ann.x - labelW/2, textY - 18, labelW, 36, 18);
        ctx.fill();
        
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(ann.text, ann.x, textY);
      }
    } else if (ann.tool === 'sticker') {
      // Sticky note - uses color picker, auto-contrast text
      ctx.save();
      ctx.translate(ann.x, ann.y);
      ctx.rotate(-0.05); // Slight tilt
      
      const stickerColor = ann.color || '#FFFF88';
      const textColor = getContrastColor(stickerColor);
      ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, sans-serif';
      const w = Math.max(ctx.measureText(ann.text).width + 40, 100);
      const h = 70;
      
      // Background with shadow
      ctx.fillStyle = stickerColor;
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 4;
      ctx.fillRect(-w/2, -h/2, w, h);
      
      // Border
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 2;
      ctx.strokeRect(-w/2, -h/2, w, h);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      
      // Text - always visible with auto contrast
      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ann.text, 0, 0);
      
      ctx.restore();
    } else if (ann.tool === 'special') {
      // Special emoji - large centered
      ctx.font = '48px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
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
      // Draw arrow - line uses stored color, arrowhead always white
      const lineColor = ann.color || '#007AFF';
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 3;
      ctx.shadowColor = lineColor;
      ctx.shadowBlur = 10;
      
      // Draw line
      ctx.beginPath();
      ctx.moveTo(ann.x1, ann.y1);
      ctx.lineTo(ann.x2, ann.y2);
      ctx.stroke();
      
      // Draw white arrowhead with dark border (visible on any background)
      ctx.fillStyle = '#fff';
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
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  });
  
  // Note: Visual border is now CSS-based on canvas-wrapper (see updateCssBorder)
  // Border for export is handled in createDecoratedCanvas function
  
  // Draw crop rectangle if exists (for snip mode)
  if (cropRect && currentTool === 'crop') {
    drawCropRect();
  }
}

// Helper: auto black/white text for contrast
function getContrastColor(hex) {
  if (!hex || hex.length < 7) return '#000000';
  const r = parseInt(hex.substr(1,2),16);
  const g = parseInt(hex.substr(3,2),16);
  const b = parseInt(hex.substr(5,2),16);
  const yiq = ((r*299)+(g*587)+(b*114))/1000;
  return (yiq >= 128) ? '#000000' : '#FFFFFF';
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
      updateStatus('Click on the image to place sticky note');
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
    
    const text = prompt('Enter sticky note text (e.g., "TODO", "CHECK THIS", "URGENT"):');
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
    
    // RE-EDIT MODE: Save annotated image back to lastFullPageCapture
    if (mode === 'reedit') {
      updateStatus('Saving annotated full page...');
      
      // Apply border/frame decoration if enabled
      let exportCanvas;
      if (hasBorder || hasBrowserFrame) {
        exportCanvas = applyBorderDecoration(canvas);
      } else {
        exportCanvas = canvas;
      }
      
      const annotatedDataUrl = exportCanvas.toDataURL('image/png');
      
      // Get existing lastFullPageCapture and update with annotated version
      const result = await chrome.storage.local.get(['lastFullPageCapture', 'reeditCapture']);
      const capture = result.reeditCapture || result.lastFullPageCapture || {};
      
      // Store the annotated image as a single chunk (replacing previous chunks)
      const updatedCapture = {
        ...capture,
        chunks: [annotatedDataUrl], // Single annotated image
        totalParts: 1,
        timestamp: Date.now(),
        annotated: true
      };
      
      await chrome.storage.local.set({ 
        lastFullPageCapture: updatedCapture,
        reeditMode: false,
        reeditCapture: null
      });
      
      updateStatus('Full page with annotations saved! ✓');
      
      setTimeout(() => {
        window.close();
      }, 1000);
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
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      
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
    
    // Check if this is a chunked group edit (multiple chunks stitched into one)
    const isChunkedEdit = urlParams.get('chunked') === 'true';
    
    if (isChunkedEdit) {
      // Get all chunk indices that were edited together
      const stored = await chrome.storage.local.get('editChunkGroup');
      const chunkIndices = stored.editChunkGroup || [parseInt(index)];
      
      // Send special message to replace all chunks with single edited image
      await chrome.runtime.sendMessage({
        action: 'chunkedAnnotationComplete',
        dataUrl,
        chunkIndices,
        primaryIndex: parseInt(index)
      });
      
      // Clean up storage
      await chrome.storage.local.remove('editChunkGroup');
    } else {
      // Normal single-image annotation
      await chrome.runtime.sendMessage({
        action: 'annotationComplete',
        dataUrl,
        index
      });
    }
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
    // Reset chunk dimensions for fresh export (prevent leaking between sessions)
    window.finalChunkWidth = null;
    window.finalChunkHeight = null;
    
    const totalPages = pages.length;
    const PAGES_PER_CHUNK = 5; // Smaller chunks for AI compatibility (5 pages max)
    
    // Calculate how many chunks we need
    const totalChunks = Math.ceil(totalPages / PAGES_PER_CHUNK);
    
    // Check queue capacity first - NEVER save partial captures
    const queueStatus = await chrome.runtime.sendMessage({ action: 'getQueueStatus' });
    const currentQueueSize = queueStatus?.count || 0;
    const availableSlots = 9 - currentQueueSize;
    
    // CRITICAL: Refuse to save if we can't fit ALL chunks
    if (totalChunks > availableSlots) {
      const shortfall = totalChunks - availableSlots;
      updateStatus(`⚠️ Need ${totalChunks} slots but only ${availableSlots} available. Clear ${shortfall} image${shortfall > 1 ? 's' : ''} first!`);
      
      // Flash the status bar to make it noticeable
      const statusBar = document.querySelector('.status-bar') || document.getElementById('status');
      if (statusBar) {
        statusBar.style.background = 'rgba(255, 71, 87, 0.3)';
        setTimeout(() => {
          statusBar.style.background = '';
        }, 3000);
      }
      return;
    }
    
    updateStatus(`Splitting ${totalPages} pages into ${totalChunks} chunks for AI...`);
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
    
    // STEP 2: Process each chunk
    const savedChunks = [];
    const savedChunkDataUrls = []; // For RE-EDIT functionality
    
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
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
      const chunkCtx = chunkCanvas.getContext('2d', { willReadFrequently: true });
      
      // Render pages to chunk
      let currentY = 0;
      for (let i = startPage; i < endPage; i++) {
        const img = pageImages[i];
        if (!img) continue;
        
        // Create temp canvas with annotations
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = img.width;
        pageCanvas.height = img.height;
        const pageCtx = pageCanvas.getContext('2d', { willReadFrequently: true });
        pageCtx.drawImage(img, 0, 0);
        
        const pageAnns = pageAnnotations[i] || [];
        drawAnnotationsToContext(pageCtx, pageAnns);
        
        // Stitch to chunk - clean seamless stitching (DPR-aware, no visible breaks)
        if (i === startPage) {
          chunkCtx.drawImage(pageCanvas, 0, 0);
          currentY = pageCanvas.height;
        } else {
          // === AUTO DUPLICATE-ROW REMOVAL ===
          // Find exact overlap point by comparing pixel rows
          let actualOverlap = overlapPx;
          try {
            const bottomData = getCanvasImageData(chunkCanvas, overlapPx + 50);
            if (bottomData) {
              actualOverlap = findBestOverlapMatch(bottomData, pageCanvas, overlapPx, 30);
            }
          } catch (e) {
            actualOverlap = overlapPx;
          }
          
          // Use adjusted overlap to skip the correct number of device pixels
          const sourceY = actualOverlap;
          const sourceHeight = pageCanvas.height - actualOverlap;
          
          // Draw seamlessly - skip the overlapped region at top of each page
          chunkCtx.drawImage(
            pageCanvas,
            0, sourceY, pageCanvas.width, sourceHeight,
            0, currentY - actualOverlap, pageCanvas.width, sourceHeight
          );
          currentY += pageCanvas.height - actualOverlap;
        }
        
        // Release temp canvas
        pageCanvas.width = 0;
        pageCanvas.height = 0;
      }
      
      // Add watermark to chunk
      addInvisibleWatermarkToCanvas(chunkCanvas);
      
      // Add border and browser frame if enabled — ENSURE UNIFORM SIZE FOR PDF
      if (hasBorder || hasBrowserFrame) {
        const decoratedChunk = applyBorderDecoration(chunkCanvas);
        
        // Track max dimensions across all chunks
        if (chunkIndex === 0) {
          window.finalChunkWidth = decoratedChunk.width;
          window.finalChunkHeight = decoratedChunk.height;
        }
        
        // Pad shorter chunks to match the tallest
        if (decoratedChunk.height < window.finalChunkHeight || decoratedChunk.width < window.finalChunkWidth) {
          const paddedCanvas = document.createElement('canvas');
          paddedCanvas.width = window.finalChunkWidth || decoratedChunk.width;
          paddedCanvas.height = window.finalChunkHeight || decoratedChunk.height;
          const pctx = paddedCanvas.getContext('2d');
          
          // Fill background with border color
          pctx.fillStyle = borderColor;
          pctx.fillRect(0, 0, paddedCanvas.width, paddedCanvas.height);
          
          // Center the decorated chunk (horizontally + vertically)
          const offsetX = (paddedCanvas.width - decoratedChunk.width) / 2;
          const offsetY = (paddedCanvas.height - decoratedChunk.height) / 2;
          pctx.drawImage(decoratedChunk, offsetX, offsetY);
          
          // Use padded version
          chunkCanvas.width = paddedCanvas.width;
          chunkCanvas.height = paddedCanvas.height;
          chunkCtx.drawImage(paddedCanvas, 0, 0);
        } else {
          // This chunk is the tallest/widest — update max
          window.finalChunkWidth = decoratedChunk.width;
          window.finalChunkHeight = decoratedChunk.height;
          
          chunkCanvas.width = decoratedChunk.width;
          chunkCanvas.height = decoratedChunk.height;
          chunkCtx.drawImage(decoratedChunk, 0, 0);
        }
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
      savedChunkDataUrls.push(chunkDataUrl); // Store for RE-EDIT
      
      // Brief pause between chunks
      await yieldToUI();
    }
    
    // Clear local storage (screenshots and viewport dimensions)
    await chrome.storage.local.remove(['fullPageScreenshots', 'fullPageViewportWidth', 'fullPageViewportHeight']);
    
    // Save lastFullPageCapture for RE-EDIT functionality
    if (savedChunkDataUrls.length > 0) {
      const urlParams = new URLSearchParams(window.location.search);
      const capturedUrl = urlParams.get('url') || window.location.href;
      const capturedTitle = urlParams.get('title') || document.title;
      const smartName = generateSmartNameForFullPage(capturedUrl, capturedTitle);
      
      const lastFullPageCapture = {
        smartName: smartName,
        timestamp: Date.now(),
        captureGroupId: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        totalParts: savedChunkDataUrls.length,
        chunks: savedChunkDataUrls,
        url: capturedUrl,
        title: capturedTitle
      };
      
      await chrome.storage.local.set({ lastFullPageCapture });
      console.log('[SnapToAI] Saved lastFullPageCapture for RE-EDIT:', smartName);
    }
    
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
    if (ann.tool === 'callout') {
      // Soft professional circle (Apple-style)
      ctx.fillStyle = '#007AFF';
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(ann.x, ann.y, 32, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      
      // Clean white number
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ann.number.toString(), ann.x, ann.y + 1);
      
      // Label (if exists) - rounded pill style
      if (ann.text) {
        const textY = ann.y + 55;
        ctx.font = 'bold 17px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        const metrics = ctx.measureText(ann.text);
        const padding = 14;
        const labelW = metrics.width + padding * 2;
        
        ctx.fillStyle = '#007AFF';
        ctx.beginPath();
        ctx.roundRect(ann.x - labelW/2, textY - 18, labelW, 36, 18);
        ctx.fill();
        
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(ann.text, ann.x, textY);
      }
    } else if (ann.tool === 'special') {
      // Special emoji - large centered
      ctx.font = '48px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ann.text, ann.x, ann.y);
    } else if (ann.tool === 'sticker') {
      // Sticky note - uses color picker, auto-contrast text
      ctx.save();
      ctx.translate(ann.x, ann.y);
      ctx.rotate(-0.05); // Slight tilt
      
      const stickerColor = ann.color || '#FFFF88';
      const textColor = getContrastColor(stickerColor);
      ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, sans-serif';
      const w = Math.max(ctx.measureText(ann.text).width + 40, 100);
      const h = 70;
      
      // Background with shadow
      ctx.fillStyle = stickerColor;
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 4;
      ctx.fillRect(-w/2, -h/2, w, h);
      
      // Border
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 2;
      ctx.strokeRect(-w/2, -h/2, w, h);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      
      // Text - always visible with auto contrast
      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ann.text, 0, 0);
      
      ctx.restore();
    }
  }
}

// Add invisible watermark to canvas
function addInvisibleWatermarkToCanvas(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
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

// ========================================
// VISUAL CROP MODE - Professional crop tool
// ========================================

function enterCropMode() {
  currentTool = 'crop';
  
  // Start with full image selected
  cropRect = {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height
  };
  
  // Show/hide controls
  const cropBtn = document.getElementById('cropBtn');
  const cropControls = document.getElementById('cropControls');
  if (cropBtn) cropBtn.style.display = 'none';
  if (cropControls) cropControls.style.display = 'flex';
  
  canvas.style.cursor = 'crosshair';
  redraw();
  
  // Show helpful message based on mode
  if (isFullPageMode && pages && pages.length > 1) {
    const isFirstPage = currentPageIndex === 0;
    const isLastPage = currentPageIndex === pages.length - 1;
    if (isFirstPage) {
      updateStatus(`Page 1: Crop sidebars (all pages) + top edge. Navigate to last page to crop bottom.`);
    } else if (isLastPage) {
      updateStatus(`Last page: Crop sidebars (all pages) + bottom edge. Navigate to page 1 to crop top.`);
    } else {
      updateStatus(`Middle page: Sidebar crop only (applies to all ${pages.length} pages).`);
    }
  } else {
    updateStatus('Drag the handles to crop. Click Done when ready.');
  }
}

function exitCropMode() {
  currentTool = 'select';
  cropRect = null;
  cropHandle = null;
  
  // Show/hide controls
  const cropBtn = document.getElementById('cropBtn');
  const cropControls = document.getElementById('cropControls');
  if (cropBtn) cropBtn.style.display = 'inline-flex';
  if (cropControls) cropControls.style.display = 'none';
  
  // Update toolbar
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
  const selectBtn = document.querySelector('[data-tool="select"]');
  if (selectBtn) selectBtn.classList.add('active');
  
  canvas.style.cursor = 'default';
  redraw();
  updateStatus('Crop canceled.');
}

function applyVisualCrop() {
  if (!cropRect || cropRect.width < 50 || cropRect.height < 50) {
    updateStatus('Crop area too small (min 50x50)');
    return;
  }
  
  pushHistory(); // Save state before crop
  
  const { x, y, width, height } = cropRect;
  
  // SMART FULL-PAGE CROP with cumulative offsets:
  // - LEFT/RIGHT crop applies to ALL pages (sidebar removal)
  // - TOP crop applies ONLY when editing page 0
  // - BOTTOM crop applies ONLY when editing last page
  // Uses pagesUntouched + cumulative offsets to prevent drift
  if (isFullPageMode && pages && pages.length > 1 && pagesUntouched.length > 0) {
    updateStatus(`Smart cropping ${pages.length} pages...`);
    
    // Calculate new crop relative to current view, then add to cumulative
    const newSideX = Math.round(x);
    const newSideWidth = Math.round(width);
    
    // Update cumulative sidebar crop (add new offset to existing)
    cumulativeCrop.sideX += newSideX;
    cumulativeCrop.sideWidth = newSideWidth;
    
    // Top crop: only if editing page 0
    if (currentPageIndex === 0) {
      cumulativeCrop.topCrop += Math.round(y);
    }
    
    // Bottom crop: only if editing last page
    if (currentPageIndex === pages.length - 1) {
      cumulativeCrop.bottomCrop += Math.round(canvas.height - (y + height));
    }
    
    // Helper to load image
    const loadImage = (src) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    
    // Process all pages from untouched source with cumulative offsets
    (async () => {
      for (let i = 0; i < pagesUntouched.length; i++) {
        const srcUrl = pagesUntouched[i];
        if (!srcUrl) continue;
        
        const srcImg = await loadImage(srcUrl);
        if (!srcImg || !srcImg.width || !srcImg.height) continue;
        
        const srcWidth = srcImg.width;
        const srcHeight = srcImg.height;
        
        // Apply cumulative crop values
        const finalSideX = Math.min(cumulativeCrop.sideX, srcWidth - 50);
        const finalSideWidth = Math.min(cumulativeCrop.sideWidth || srcWidth, srcWidth - finalSideX);
        
        let finalTopCrop = 0;
        let finalBottomCrop = srcHeight;
        
        // First page: apply cumulative top crop
        if (i === 0 && cumulativeCrop.topCrop > 0) {
          finalTopCrop = Math.min(cumulativeCrop.topCrop, srcHeight - 50);
        }
        
        // Last page: apply cumulative bottom crop
        if (i === pages.length - 1 && cumulativeCrop.bottomCrop > 0) {
          finalBottomCrop = Math.max(50, srcHeight - cumulativeCrop.bottomCrop);
        }
        
        const pageHeight = Math.max(50, finalBottomCrop - finalTopCrop);
        
        // Create cropped canvas
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = finalSideWidth;
        tempCanvas.height = pageHeight;
        const tctx = tempCanvas.getContext('2d', { willReadFrequently: true });
        
        // Crop from untouched source using cumulative offsets
        tctx.drawImage(srcImg, finalSideX, finalTopCrop, finalSideWidth, pageHeight, 0, 0, finalSideWidth, pageHeight);
        
        // Update pages
        const newDataUrl = tempCanvas.toDataURL();
        pages[i] = newDataUrl;
        pageOriginalImages[i] = tctx.getImageData(0, 0, finalSideWidth, pageHeight);
        pageImages[i] = await loadImage(newDataUrl);
        
        // Clamp annotations to new bounds
        const anns = pageAnnotations[i] || [];
        anns.forEach(ann => {
          if (ann.x !== undefined) {
            ann.x = Math.max(0, Math.min(ann.x, finalSideWidth - 10));
          }
          if (ann.y !== undefined) {
            ann.y = Math.max(0, Math.min(ann.y, pageHeight - 10));
          }
        });
        pageAnnotations[i] = anns;
      }
      
      // Reload current page
      if (pages[currentPageIndex]) {
        const img = await loadImage(pages[currentPageIndex]);
        if (img) {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          originalImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
        }
      }
      
      redraw();
      updateCssBorder();
      updateBrowserFrameOverlay();
      updateStatus(`Smart crop complete! Sidebars removed from all ${pages.length} pages.`);
    })();
  } else {
    // Single image: full crop (including top/bottom)
    applyCropToCurrentPageOnly(x, y, width, height);
    updateStatus(`Cropped to ${Math.round(width)}×${Math.round(height)}.`);
  }
  
  // Exit crop mode
  cropRect = null;
  cropHandle = null;
  currentTool = 'select';
  
  // Reset controls
  const cropBtn = document.getElementById('cropBtn');
  const cropControls = document.getElementById('cropControls');
  if (cropBtn) cropBtn.style.display = 'inline-flex';
  if (cropControls) cropControls.style.display = 'none';
  
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
  const selectBtn = document.querySelector('[data-tool="select"]');
  if (selectBtn) selectBtn.classList.add('active');
  
  canvas.style.cursor = 'default';
  redraw();
  updateCssBorder();
  updateBrowserFrameOverlay();
}

// Helper: Apply crop to current page only (used by applyVisualCrop)
function applyCropToCurrentPageOnly(x, y, width, height) {
  // Get source image - use pageOriginalImages for full-page mode, or current originalImage
  let sourceImage = originalImage;
  if (isFullPageMode && pageOriginalImages[currentPageIndex]) {
    sourceImage = pageOriginalImages[currentPageIndex];
  }
  
  // Extract cropped region
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
  tempCtx.putImageData(sourceImage, -x, -y, x, y, width, height);
  
  // Resize main canvas
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(tempCanvas, 0, 0);
  originalImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
  
  // Update page data for full-page mode (ensures crop persists on navigation)
  if (isFullPageMode) {
    pageOriginalImages[currentPageIndex] = originalImage;
    // Update pages[] data URL
    const newDataUrl = canvas.toDataURL();
    pages[currentPageIndex] = newDataUrl;
    // Update pageImages[] so navigation shows cropped version
    const newImg = new Image();
    newImg.src = newDataUrl;
    pageImages[currentPageIndex] = newImg;
  }
  
  // Shift annotations for current page
  annotations.forEach(ann => {
    if (ann.x !== undefined) ann.x -= x;
    if (ann.y !== undefined) ann.y -= y;
    if (ann.points) {
      ann.points = ann.points.map(p => ({ x: p.x - x, y: p.y - y }));
    }
  });
}

// Get crop cursor based on handle
function getCropCursor(handle) {
  if (handle === 'move') return 'move';
  if (handle === 'tl' || handle === 'br') return 'nwse-resize';
  if (handle === 'tr' || handle === 'bl') return 'nesw-resize';
  if (handle === 't' || handle === 'b') return 'ns-resize';
  if (handle === 'l' || handle === 'r') return 'ew-resize';
  return 'default';
}

// Detect which crop handle is at position
function getCropHandleAt(pos) {
  if (!cropRect) return null;
  
  const { x, y, width, height } = cropRect;
  const handleSize = 20;
  
  // Check if multi-page full-page mode (pages array must exist and have >1 pages)
  // This MUST be false for single images/snips to enable all 8 handles
  const isMultiPageFullPage = isFullPageMode === true && Array.isArray(pages) && pages.length > 1;
  
  if (isMultiPageFullPage) {
    // For full-page groups: smart vertical cropping based on page position
    // Compute boundary flags only inside this block (safe since pages.length > 1)
    const isFirstPage = currentPageIndex === 0;
    const isLastPage = currentPageIndex === pages.length - 1;
    
    // Always allow left/right edges (sidebar crop)
    if (Math.abs(pos.x - (x + width)) < handleSize && pos.y > y && pos.y < y + height) return 'r';
    if (Math.abs(pos.x - x) < handleSize && pos.y > y && pos.y < y + height) return 'l';
    
    // Top edge: only on first page
    if (isFirstPage && Math.abs(pos.y - y) < handleSize && pos.x > x && pos.x < x + width) return 't';
    
    // Bottom edge: only on last page
    if (isLastPage && Math.abs(pos.y - (y + height)) < handleSize && pos.x > x && pos.x < x + width) return 'b';
    
    // Move allowed (restricted in handleMouseMove based on page)
    if (pos.x > x && pos.x < x + width && pos.y > y && pos.y < y + height) return 'move';
    return null;
  }
  
  // Single images/snips: full 8-handle cropping (corners + edges + move)
  // Check corners first (higher priority)
  if (Math.abs(pos.x - x) < handleSize && Math.abs(pos.y - y) < handleSize) return 'tl';
  if (Math.abs(pos.x - (x + width)) < handleSize && Math.abs(pos.y - y) < handleSize) return 'tr';
  if (Math.abs(pos.x - x) < handleSize && Math.abs(pos.y - (y + height)) < handleSize) return 'bl';
  if (Math.abs(pos.x - (x + width)) < handleSize && Math.abs(pos.y - (y + height)) < handleSize) return 'br';
  
  // Check edges
  if (Math.abs(pos.y - y) < handleSize && pos.x > x && pos.x < x + width) return 't';
  if (Math.abs(pos.x - (x + width)) < handleSize && pos.y > y && pos.y < y + height) return 'r';
  if (Math.abs(pos.y - (y + height)) < handleSize && pos.x > x && pos.x < x + width) return 'b';
  if (Math.abs(pos.x - x) < handleSize && pos.y > y && pos.y < y + height) return 'l';
  
  // Check inside for move
  if (pos.x > x && pos.x < x + width && pos.y > y && pos.y < y + height) return 'move';
  
  return null;
}
