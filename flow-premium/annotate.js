.remove('active'));
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
