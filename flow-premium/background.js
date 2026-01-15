    isFullPageCaptureInProgress = false;
      return { success: false, error: 'No screenshots to stitch' };
    }
    
    // Get current snaps
    const snaps = await getSnaps();
    
    // Block if queue is full
    if (snaps.length >= MAX_SNAPS) {
      isFullPageCaptureInProgress = false;
      return { 
        success: false, 
        error: `Queue full (${MAX_SNAPS}/${MAX_SNAPS}). Delete some images first.` 
      };
    }
    
    // Store the captured page URL for the editor's browser frame feature
    await chrome.storage.session.set({ 
      lastCapturedPageUrl: pageUrl || '',
      lastCapturedPageTitle: pageTitle || 'Untitled Page'
    });
    
    // Try to send to popup for stitching first
    // Pass isAIPlatform flag so stitching uses correct overlap (0% for AI, 10% for regular)
    try {
      await chrome.runtime.sendMessage({
        action: 'stitchFullPage',
        screenshots,
        viewportWidth,
        viewportHeight,
        isAIPlatform,
        pageUrl,
        pageTitle
      });
      return { success: true, pending: true };
    } catch (popupError) {
      // Popup isn't open - use annotate.html with autoSave for high-quality stitching
      console.log('[SnapToAI] Popup not open, using annotate.html with autoSave...');
      
      try {
        // Store screenshots same way popup does (annotate.html reads from here)
        await chrome.storage.local.set({ 
          fullPageScreenshots: screenshots,
          fullPageViewportWidth: viewportWidth,
          fullPageViewportHeight: viewportHeight,
          fullPageIsAIPlatform: isAIPlatform
        });
        
        // Check if we're in batch mode
        const { batchContext } = await chrome.storage.session.get(['batchContext']);
        
        if (batchContext) {
          // Batch mode: Open editor visible with batch params (no autoSave)
          const batchParams = `batchCurrent=${batchContext.current}&batchTotal=${batchContext.total}&batchUrl=${encodeURIComponent(batchContext.url || '')}`;
          chrome.windows.create({
            url: `annotate.html?mode=fullpage&${batchParams}`,
            type: 'popup',
            width: 1200,
            height: 800,
            focused: true
          });
        } else {
          // Normal mode: Open off-screen with autoSave
          chrome.windows.create({
            url: 'annotate.html?mode=fullpage&autoSave=true',
            type: 'popup',
            width: 400,
            height: 300,
            left: -1000,
            top: -1000
          });
        }
        
        return { success: true, pending: true };
      } catch (autoSaveError) {
        console.log('[SnapToAI] AutoSave error:', autoSaveError.message);
        isFullPageCaptureInProgress = false;
        return { success: false, error: autoSaveError.message };
      }
    }
  } catch (error) {
    console.log('[SnapToAI] Finalize:', error.message || error);
    isFullPageCaptureInProgress = false;
    return { success: false, error: error.message };
  }
}

// Reset full page capture state (called when stitch completes or fails)
function resetFullPageCaptureState() {
  isFullPageCaptureInProgress = false;
}

// ============================================
// DOWNLOAD FUNCTIONS
// ============================================

// Download a single image
async function downloadImage(dataUrl, filename = null, options = {}) {
  try {
    const settings = await getSettings();
    
    // Generate filename if not provided
    if (!filename) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const format = settings.imageFormat === 'jpeg' ? 'jpg' : 'png';
      filename = `SnapToAI_${timestamp}.${format}`;
    }
    
    // Build full path with directory setting
    let fullPath = filename;
    if (settings.downloadDirectory) {
      fullPath = `${settings.downloadDirectory}/${filename}`;
    }
    
    // Convert format if needed
    let finalDataUrl = dataUrl;
    if (settings.imageFormat === 'jpeg' && dataUrl.includes('image/png')) {
      finalDataUrl = await convertToJpeg(dataUrl, settings.jpegQuality);
    }
    
    // Download options
    const downloadOptions = {
      url: finalDataUrl,
      filename: fullPath,
      saveAs: settings.showSaveAs
    };
    
    // Use chrome.downloads API
    const downloadId = await chrome.downloads.download(downloadOptions);
    
    return { success: true, downloadId, filename: fullPath };
  } catch (error) {
    console.log('[SnapToAI] Download:', error.message || error);
    return { success: false, error: error.message };
  }
}

// Download multiple images
async function downloadMultipleImages(images) {
  try {
    const settings = await getSettings();
    const results = [];
    
    for (let i = 0; i < images.length; i++) {
      const { dataUrl, filename } = images[i];
      
      // Generate filename with index
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const format = settings.imageFormat === 'jpeg' ? 'jpg' : 'png';
      const finalFilename = filename || `SnapToAI_${timestamp}_${i + 1}.${format}`;
      
      // Build full path
      let fullPath = finalFilename;
      if (settings.downloadDirectory) {
        fullPath = `${settings.downloadDirectory}/${finalFilename}`;
      }
      
      // Convert format if needed
      let finalDataUrl = dataUrl;
      if (settings.imageFormat === 'jpeg' && dataUrl.includes('image/png')) {
        finalDataUrl = await convertToJpeg(dataUrl, settings.jpegQuality);
      }
      
      // Download (no saveAs for multiple files)
      const downloadId = await chrome.downloads.download({
        url: finalDataUrl,
        filename: fullPath,
        saveAs: false // Never show saveAs for batch downloads
      });
      
      results.push({ success: true, downloadId, filename: fullPath });
      
      // Small delay between downloads to prevent issues
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return { success: true, results };
  } catch (error) {
    console.log('[SnapToAI] Download:', error.message || error);
    return { success: false, error: error.message };
  }
}

// Convert PNG to JPEG with quality setting (service worker compatible)
async function convertToJpeg(pngDataUrl, quality) {
  try {
    // Fetch the data URL as a blob
    const response = await fetch(pngDataUrl);
    const blob = await response.blob();
    
    // Use createImageBitmap (available in service workers)
    const imageBitmap = await createImageBitmap(blob);
    
    // Create offscreen canvas
    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    // Fill white background (JPEG doesn't support transparency)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imageBitmap, 0, 0);
    
    // Convert to JPEG blob
    const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality / 100 });
    
    // Convert blob to data URL
    return await blobToDataUrl(jpegBlob);
  } catch (error) {
    console.log('[SnapToAI] JPEG:', error.message || error);
    return pngDataUrl; // Return original if conversion fails
  }
}

// Copy to clipboard with Google Docs limit (service worker compatible)
// Note: Clipboard operations need to be done via content script
async function copyToClipboardWithLimit(dataUrl) {
  try {
    const settings = await getSettings();
    
    // Get image dimensions using createImageBitmap
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);
    
    const pixels = imageBitmap.width * imageBitmap.height;
    const GOOGLE_DOCS_LIMIT = 25000000; // 25 million pixels
    
    let finalDataUrl = dataUrl;
    let resized = false;
    
    // Resize if needed and setting is enabled
    if (settings.fitGoogleDocsLimit && pixels > GOOGLE_DOCS_LIMIT) {
      const scale = Math.sqrt(GOOGLE_DOCS_LIMIT / pixels);
      const newWidth = Math.floor(imageBitmap.width * scale);
      const newHeight = Math.floor(imageBitmap.height * scale);
      
      const canvas = new OffscreenCanvas(newWidth, newHeight);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(imageBitmap, 0, 0, newWidth, newHeight);
      
      const resizedBlob = await canvas.convertToBlob({ type: 'image/png' });
      finalDataUrl = await blobToDataUrl(resizedBlob);
      resized = true;
      
      console.log(`[SnapToAI] Resized from ${imageBitmap.width}x${imageBitmap.height} to ${newWidth}x${newHeight} for Google Docs`);
    }
    
    // Return the dataUrl - clipboard write must be done in content script/popup
    return { 
      success: true, 
      dataUrl: finalDataUrl,
      resized: resized,
      originalPixels: pixels,
      limitPixels: GOOGLE_DOCS_LIMIT
    };
  } catch (error) {
    console.log('[SnapToAI] Resize:', error.message || error);
    return { success: false, error: error.message, dataUrl: dataUrl };
  }
}

// Helper: Get image dimensions (service worker compatible)
async function getImageDimensions(dataUrl) {
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);
    return { width: imageBitmap.width, height: imageBitmap.height };
  } catch (error) {
    console.log('[SnapToAI] Dimensions:', error.message || error);
    return { width: 0, height: 0 };
  }
}

// Helper: Convert blob to data URL (service worker compatible)
async function blobToDataUrl(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return `data:${blob.type};base64,${base64}`;
}
