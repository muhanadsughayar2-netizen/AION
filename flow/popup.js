// Flow Popup Script
// Handles UI interactions, thumbnail display, and communication with background

let currentSnaps = [];
let selectedSnapIds = new Set();

// Initialize popup on load
document.addEventListener('DOMContentLoaded', async () => {
  await loadSnaps();
  setupEventListeners();
  updateUI();
});

// Setup event listeners
function setupEventListeners() {
  // Orb button click
  document.getElementById('orbButton').addEventListener('click', handleOrbClick);
  
  // Clear button
  document.getElementById('clearButton').addEventListener('click', handleClear);
  
  // Selection controls
  document.getElementById('selectAllBtn').addEventListener('click', handleSelectAll);
  document.getElementById('copySelectedBtn').addEventListener('click', handleCopySelected);
  document.getElementById('downloadSelectedBtn').addEventListener('click', handleDownloadSelected);
  document.getElementById('exportPdfBtn').addEventListener('click', handleExportPDF);
  
  // Preview modal
  document.getElementById('previewClose').addEventListener('click', closePreview);
  document.getElementById('previewModal').addEventListener('click', (e) => {
    if (e.target.id === 'previewModal') closePreview();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePreview();
  });
  
  // Listen for annotation completion via Chrome runtime messaging
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'annotationComplete') {
      handleAnnotationMessage(request);
    }
  });
}

// Handle orb button click
async function handleOrbClick() {
  const orbButton = document.getElementById('orbButton');
  const status = document.getElementById('status');
  
  // Disable button during operation
  orbButton.disabled = true;
  
  try {
    // Check if we're on an AI site and have snaps
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url);
    const hostname = url.hostname;
    const isAISite = hostname.includes('grok.com') || 
                     hostname.includes('chatgpt.com') || 
                     hostname.includes('chat.openai.com') || 
                     hostname.includes('claude.ai');
    
    if (isAISite && currentSnaps.length > 0) {
      // Upload mode
      status.textContent = `Uploading ${currentSnaps.length} snaps...`;
      status.className = 'status uploading';
      
      const response = await chrome.runtime.sendMessage({ 
        action: 'upload'
      });
      
      if (response.success) {
        status.textContent = 'Upload complete ✓';
        status.className = 'status active';
        
        // Reload snaps after upload
        setTimeout(async () => {
          await loadSnaps();
          updateUI();
          status.textContent = 'Flow: Ready';
          status.className = 'status';
        }, 1500);
      } else {
        status.textContent = 'Upload failed';
        status.className = 'status error';
        setTimeout(() => {
          status.textContent = 'Flow: Ready';
          status.className = 'status';
        }, 2000);
      }
    } else {
      // Capture mode
      status.textContent = 'Snapping...';
      status.className = 'status active';
      
      const response = await chrome.runtime.sendMessage({ action: 'capture' });
      
      if (response.success && response.dataUrl) {
        // Write to clipboard immediately (user gesture context)
        try {
          const res = await fetch(response.dataUrl);
          const blob = await res.blob();
          await navigator.clipboard.write([
            new ClipboardItem({ [blob.type]: blob })
          ]);
        } catch (clipError) {
          console.error('Clipboard write failed:', clipError);
        }
        
        status.textContent = `Snap ${response.count} captured ✓`;
        status.className = 'status active';
        
        // Reload snaps
        await loadSnaps();
        updateUI();
        
        setTimeout(() => {
          status.textContent = 'Flow: Ready';
          status.className = 'status';
        }, 1500);
      } else {
        // Show specific error message or generic failure
        status.textContent = response.error || 'Capture failed';
        status.className = 'status error';
        setTimeout(() => {
          status.textContent = 'Flow: Ready';
          status.className = 'status';
        }, 2000);
      }
    }
  } catch (error) {
    console.error('Orb click error:', error);
    status.textContent = 'Error occurred';
    status.className = 'status error';
    setTimeout(() => {
      status.textContent = 'Flow: Ready';
      status.className = 'status';
    }, 2000);
  } finally {
    orbButton.disabled = false;
  }
}

// Handle clear all
async function handleClear() {
  const status = document.getElementById('status');
  
  try {
    await chrome.runtime.sendMessage({ action: 'clearSnaps' });
    
    status.textContent = 'Cleared ✓';
    status.className = 'status active';
    
    await loadSnaps();
    updateUI();
    
    setTimeout(() => {
      status.textContent = 'Flow: Ready';
      status.className = 'status';
    }, 1500);
  } catch (error) {
    console.error('Clear error:', error);
  }
}

// Handle platform change
// Load snaps from storage
async function loadSnaps() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getSnaps' });
    const newSnaps = response || [];
    
    // Clear selection if snap count changed (FIFO or clear happened)
    if (newSnaps.length !== currentSnaps.length) {
      selectedSnapIds.clear();
    }
    
    currentSnaps = newSnaps;
  } catch (error) {
    console.error('Load snaps error:', error);
    currentSnaps = [];
    selectedSnapIds.clear();
  }
}

// Load platform preference

// Update UI based on current state
function updateUI() {
  updateCounter();
  updateThumbnails();
  updateClearButton();
}

// Update snap counter
function updateCounter() {
  document.getElementById('snapCount').textContent = currentSnaps.length;
}

// Dynamically adjust popup height based on number of screenshots
function adjustPopupHeight(snapCount) {
  // Base height for empty state
  let height = 380;
  
  if (snapCount === 0) {
    // Empty state: small and compact
    height = 380;
  } else if (snapCount <= 3) {
    // 1 row of screenshots
    height = 430;
  } else if (snapCount <= 6) {
    // 2 rows of screenshots
    height = 490;
  } else {
    // 3 rows for 7-9 screenshots
    height = 550;
  }
  
  // Apply the height to the body
  document.body.style.height = height + 'px';
}

// Update thumbnails grid
function updateThumbnails() {
  const container = document.getElementById('thumbnails');
  const selectionBar = document.getElementById('selectionBar');
  container.innerHTML = '';
  
  // Dynamically adjust popup height based on number of screenshots
  adjustPopupHeight(currentSnaps.length);
  
  if (currentSnaps.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.innerHTML = `
      <div class="empty-sparkle">✦</div>
      <div class="empty-heading">One click. One flow.</div>
      <div class="empty-subheading">Your pages, ready for AI in seconds.</div>
      <div class="empty-instruction">Click the glowing camera button above to capture instantly</div>
    `;
    container.appendChild(emptyState);
    selectionBar.style.display = 'none';
    return;
  }
  
  // Show selection bar when snaps exist
  selectionBar.style.display = 'flex';
  
  currentSnaps.forEach((dataUrl, index) => {
    const thumbnail = document.createElement('div');
    thumbnail.className = 'thumbnail fade-in';
    thumbnail.dataset.index = index;
    
    // Add selected class if this snap is selected
    if (selectedSnapIds.has(index)) {
      thumbnail.classList.add('selected');
    }
    
    // Create checkbox
    const checkbox = document.createElement('div');
    checkbox.className = 'thumbnail-checkbox';
    if (selectedSnapIds.has(index)) {
      checkbox.classList.add('checked');
    }
    
    // Checkbox click handler
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSelection(index);
    });
    
    // Create delete button
    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'thumbnail-delete';
    deleteBtn.title = 'Delete this snap';
    
    // Delete button click handler
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteSnap(index);
    });
    
    // Create annotate button
    const annotateBtn = document.createElement('div');
    annotateBtn.className = 'thumbnail-annotate';
    annotateBtn.title = 'Annotate this snap';
    
    // Annotate button click handler
    annotateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleAnnotate(index);
    });
    
    // Create copy button
    const copyBtn = document.createElement('div');
    copyBtn.className = 'thumbnail-copy';
    copyBtn.title = 'Copy this snap';
    
    // Copy button click handler
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleCopySingle(index);
    });
    
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = `Snap ${index + 1}`;
    
    // Thumbnail click to preview
    thumbnail.addEventListener('click', (e) => {
      // Don't open preview if clicking checkbox, delete, annotate, or copy button
      if (!e.target.classList.contains('thumbnail-checkbox') && 
          !e.target.classList.contains('thumbnail-delete') &&
          !e.target.classList.contains('thumbnail-annotate') &&
          !e.target.classList.contains('thumbnail-copy')) {
        showPreview(index);
      }
    });
    
    // Drag and drop support
    thumbnail.draggable = true;
    thumbnail.addEventListener('dragstart', (e) => handleDragStart(e, index));
    thumbnail.addEventListener('dragover', (e) => handleDragOver(e));
    thumbnail.addEventListener('dragenter', (e) => handleDragEnter(e));
    thumbnail.addEventListener('dragleave', (e) => handleDragLeave(e));
    thumbnail.addEventListener('drop', (e) => handleDrop(e, index));
    thumbnail.addEventListener('dragend', handleDragEnd);
    
    const number = document.createElement('div');
    number.className = 'thumbnail-number';
    number.textContent = index + 1;
    
    thumbnail.appendChild(checkbox);
    thumbnail.appendChild(deleteBtn);
    thumbnail.appendChild(annotateBtn);
    thumbnail.appendChild(copyBtn);
    thumbnail.appendChild(img);
    thumbnail.appendChild(number);
    container.appendChild(thumbnail);
  });
  
  updateSelectAllButton();
}

// Toggle selection for a snap
function toggleSelection(index) {
  if (selectedSnapIds.has(index)) {
    selectedSnapIds.delete(index);
  } else {
    selectedSnapIds.add(index);
  }
  updateThumbnails();
}

// Handle Select All / Deselect All
function handleSelectAll() {
  const allSelected = selectedSnapIds.size === currentSnaps.length;
  
  if (allSelected) {
    // Deselect all
    selectedSnapIds.clear();
  } else {
    // Select all
    selectedSnapIds.clear();
    currentSnaps.forEach((_, index) => {
      selectedSnapIds.add(index);
    });
  }
  
  updateThumbnails();
}

// Update Select All button text
function updateSelectAllButton() {
  const btn = document.getElementById('selectAllBtn');
  const allSelected = selectedSnapIds.size === currentSnaps.length;
  btn.textContent = allSelected ? 'Deselect All' : 'Select All';
}

// Handle Copy Selected
async function handleCopySelected() {
  const status = document.getElementById('status');
  
  if (selectedSnapIds.size === 0) {
    status.textContent = 'No snaps selected';
    status.className = 'status error';
    setTimeout(() => {
      status.textContent = 'Flow: Ready';
      status.className = 'status';
    }, 1500);
    return;
  }
  
  try {
    const selectedSnaps = Array.from(selectedSnapIds)
      .sort((a, b) => a - b)
      .map(index => currentSnaps[index]);
    
    status.textContent = `Creating composite image...`;
    status.className = 'status active';
    
    // Clipboard can only hold ONE image at a time!
    // Solution: Combine all selected images into a single composite image
    const compositeDataUrl = await createCompositeImage(selectedSnaps);
    
    // Copy the single composite image
    const res = await fetch(compositeDataUrl);
    const blob = await res.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type]: blob })
    ]);
    
    status.textContent = `${selectedSnaps.length} snaps copied as collage ✓`;
    status.className = 'status active';
    
    setTimeout(() => {
      status.textContent = 'Flow: Ready';
      status.className = 'status';
    }, 2000);
  } catch (error) {
    console.error('Copy selected error:', error);
    status.textContent = 'Copy failed - try Upload instead';
    status.className = 'status error';
    setTimeout(() => {
      status.textContent = 'Flow: Ready';
      status.className = 'status';
    }, 2000);
  }
}

// Create composite image from multiple snapshots
async function createCompositeImage(dataUrls) {
  // Load all images first
  const images = await Promise.all(dataUrls.map(url => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }));
  
  // Calculate composite dimensions
  const padding = 20;
  const maxWidth = Math.max(...images.map(img => img.width));
  const totalHeight = images.reduce((sum, img) => sum + img.height + padding, padding);
  
  // Create canvas for composite
  const canvas = document.createElement('canvas');
  canvas.width = maxWidth + (padding * 2);
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d');
  
  // Fill background
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Draw each image vertically stacked
  let currentY = padding;
  images.forEach((img, index) => {
    const x = (canvas.width - img.width) / 2; // Center horizontally
    
    // Add subtle border and shadow
    ctx.shadowColor = 'rgba(0, 217, 255, 0.3)';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = 'rgba(0, 217, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 1, currentY - 1, img.width + 2, img.height + 2);
    ctx.shadowBlur = 0;
    
    // Draw image
    ctx.drawImage(img, x, currentY);
    
    // Add snap number label
    ctx.fillStyle = 'rgba(0, 217, 255, 0.9)';
    ctx.font = 'bold 16px Arial';
    ctx.fillText(`Snap ${index + 1}`, x + 10, currentY + 25);
    
    currentY += img.height + padding;
  });
  
  // Convert to dataURL
  return canvas.toDataURL('image/png');
}

// Handle Copy Single (individual snap)
async function handleCopySingle(index) {
  const status = document.getElementById('status');
  
  try {
    const dataUrl = currentSnaps[index];
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type]: blob })
    ]);
    
    status.textContent = `Snap ${index + 1} copied ✓`;
    status.className = 'status active';
    
    setTimeout(() => {
      status.textContent = 'Flow: Ready';
      status.className = 'status';
    }, 1500);
  } catch (error) {
    console.error('Copy single error:', error);
    status.textContent = 'Copy failed';
    status.className = 'status error';
    setTimeout(() => {
      status.textContent = 'Flow: Ready';
      status.className = 'status';
    }, 1500);
  }
}

// Handle Download Selected
async function handleDownloadSelected() {
  const status = document.getElementById('status');
  
  if (selectedSnapIds.size === 0) {
    status.textContent = 'No snaps selected';
    status.className = 'status error';
    setTimeout(() => {
      status.textContent = 'Flow: Ready';
      status.className = 'status';
    }, 1500);
    return;
  }
  
  try {
    const selectedSnaps = Array.from(selectedSnapIds)
      .sort((a, b) => a - b)
      .map(index => ({ index, dataUrl: currentSnaps[index] }));
    
    status.textContent = `Downloading ${selectedSnaps.length} snaps...`;
    status.className = 'status active';
    
    // Download each snap
    for (const { index, dataUrl } of selectedSnaps) {
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `flow_snap_${index + 1}.png`;
      link.click();
      
      // Small delay between downloads
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    status.textContent = `${selectedSnaps.length} snaps downloaded ✓`;
    status.className = 'status active';
    
    setTimeout(() => {
      status.textContent = 'Flow: Ready';
      status.className = 'status';
    }, 2000);
  } catch (error) {
    console.error('Download selected error:', error);
    status.textContent = 'Download failed';
    status.className = 'status error';
    setTimeout(() => {
      status.textContent = 'Flow: Ready';
      status.className = 'status';
    }, 2000);
  }
}

// Update clear button state
function updateClearButton() {
  const clearButton = document.getElementById('clearButton');
  clearButton.disabled = currentSnaps.length === 0;
}

// Handle annotation
function handleAnnotate(index) {
  const dataUrl = currentSnaps[index];
  // Open annotation window with image data
  const width = 1200;
  const height = 800;
  const left = (screen.width - width) / 2;
  const top = (screen.height - height) / 2;
  
  window.open(
    `annotate.html?index=${index}&img=${encodeURIComponent(dataUrl)}`,
    'Annotate',
    `width=${width},height=${height},left=${left},top=${top}`
  );
}

// Handle annotation message from annotation window
async function handleAnnotationMessage(request) {
  const { dataUrl, index } = request;
  
  // Replace the snap with annotated version
  currentSnaps[parseInt(index)] = dataUrl;
  
  // Update storage
  await chrome.runtime.sendMessage({ 
    action: 'setSnaps', 
    snaps: currentSnaps 
  });
  
  updateUI();
  
  // Show success message
  const status = document.getElementById('status');
  status.textContent = 'Annotation saved ✓';
  status.className = 'status active';
  setTimeout(() => {
    status.textContent = 'Flow: Ready';
    status.className = 'status';
  }, 1500);
}

// Track if jsPDF is loaded
let jsPDFLoaded = false;
let jsPDFLoadPromise = null;

// Handle Export as PDF - Show modal with options
async function handleExportPDF() {
  const status = document.getElementById('status');
  
  if (currentSnaps.length === 0) {
    status.textContent = 'No snaps to export';
    status.className = 'status error';
    setTimeout(() => {
      status.textContent = 'Flow: Ready';
      status.className = 'status';
    }, 1500);
    return;
  }
  
  // Show PDF export modal
  showPDFExportModal();
}

// Get indexes of selected thumbnails
function getSelectedIndexes() {
  const thumbnails = document.querySelectorAll('.thumbnail');
  const selectedIndexes = [];
  
  thumbnails.forEach((thumbnail, index) => {
    const checkbox = thumbnail.querySelector('.thumbnail-checkbox');
    if (checkbox && checkbox.classList.contains('checked')) {
      selectedIndexes.push(index);
    }
  });
  
  return selectedIndexes;
}

// Show PDF Export Modal
function showPDFExportModal() {
  const modal = document.getElementById('pdfExportModal');
  const selectedCount = getSelectedIndexes().length;
  
  // Disable/enable selected options based on selection
  const selectedCombinedBtn = document.getElementById('selectedCombinedBtn');
  const selectedSeparateBtn = document.getElementById('selectedSeparateBtn');
  
  if (selectedCount === 0) {
    selectedCombinedBtn.classList.add('disabled');
    selectedSeparateBtn.classList.add('disabled');
  } else {
    selectedCombinedBtn.classList.remove('disabled');
    selectedSeparateBtn.classList.remove('disabled');
  }
  
  modal.style.display = 'flex';
}

// Hide PDF Export Modal
function hidePDFExportModal() {
  const modal = document.getElementById('pdfExportModal');
  modal.style.display = 'none';
}

// Setup PDF modal listeners
document.getElementById('pdfModalClose').addEventListener('click', hidePDFExportModal);
document.getElementById('pdfCancelBtn').addEventListener('click', hidePDFExportModal);

// Handle PDF option selection
document.querySelectorAll('.pdf-option-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (btn.classList.contains('disabled')) return;
    
    const mode = btn.dataset.mode;
    let snaps = [];
    
    if (mode.startsWith('all-')) {
      snaps = [...currentSnaps];
    } else {
      const selectedIndexes = getSelectedIndexes();
      if (selectedIndexes.length === 0) {
        const status = document.getElementById('status');
        status.textContent = 'No screenshots selected';
        status.className = 'status error';
        setTimeout(() => {
          status.textContent = 'Flow: Ready';
          status.className = 'status';
        }, 1500);
        hidePDFExportModal();
        return;
      }
      snaps = selectedIndexes.map(i => currentSnaps[i]);
    }
    
    hidePDFExportModal();
    
    switch(mode) {
      case 'all-combined':
      case 'selected-combined':
        await exportPDFCombined(snaps, mode.includes('selected') ? 'selected' : 'all');
        break;
      case 'all-separate':
      case 'selected-separate':
        await exportPDFSeparate(snaps, mode.includes('selected') ? 'selected' : 'all');
        break;
    }
  });
});

// Export Combined PDF (original function refactored)
async function exportPDFCombined(snaps, mode) {
  const status = document.getElementById('status');
  
  try {
    status.textContent = 'Loading PDF library...';
    status.className = 'status active';
    
    // Load jsPDF once (or wait if already loading)
    if (!jsPDFLoaded) {
      if (!jsPDFLoadPromise) {
        jsPDFLoadPromise = new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'jspdf.min.js';
          script.onload = () => {
            console.log('jsPDF loaded successfully');
            jsPDFLoaded = true;
            // Wait for library to be available on window
            setTimeout(() => resolve(), 200);
          };
          script.onerror = (err) => {
            console.error('jsPDF load error:', err);
            reject(new Error('Failed to load jsPDF library'));
          };
          document.head.appendChild(script);
        });
      }
      await jsPDFLoadPromise;
    }
    
    // Verify library is available
    if (!window.jspdf || typeof window.jspdf.jsPDF === 'undefined') {
      throw new Error('jsPDF library not available after loading');
    }
    
    status.textContent = 'Generating PDF...';
    
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = 210; // A4 width in mm
    const pageHeight = 297; // A4 height in mm
    const margin = 10;
    const maxWidth = pageWidth - (2 * margin);
    const maxHeight = pageHeight - (2 * margin);
    
    for (let i = 0; i < snaps.length; i++) {
      if (i > 0) {
        pdf.addPage();
      }
      
      // Add image to PDF
      const img = await createImageBitmap(await (await fetch(snaps[i])).blob());
      const aspectRatio = img.width / img.height;
      
      let imgWidth = maxWidth;
      let imgHeight = imgWidth / aspectRatio;
      
      // If image is too tall, scale by height instead
      if (imgHeight > maxHeight) {
        imgHeight = maxHeight;
        imgWidth = imgHeight * aspectRatio;
      }
      
      // Center the image
      const x = (pageWidth - imgWidth) / 2;
      const y = margin;
      
      pdf.addImage(snaps[i], 'PNG', x, y, imgWidth, imgHeight);
      
      // Add page number at bottom
      pdf.setFontSize(10);
      pdf.setTextColor(150);
      pdf.text(`Snap ${i + 1} of ${snaps.length}`, pageWidth / 2, pageHeight - 5, { align: 'center' });
    }
    
    // Save PDF
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = mode === 'selected' ? `flow-selected-${timestamp}.pdf` : `flow-screenshots-${timestamp}.pdf`;
    pdf.save(filename);
    
    status.textContent = 'PDF exported ✓';
    status.className = 'status active';
    
    setTimeout(() => {
      status.textContent = 'Flow: Ready';
      status.className = 'status';
    }, 2000);
  } catch (error) {
    console.error('PDF export error:', error);
    status.textContent = 'PDF export failed';
    status.className = 'status error';
    setTimeout(() => {
      status.textContent = 'Flow: Ready';
      status.className = 'status';
    }, 2000);
  }
}

// Export Separate PDFs (one file per screenshot)
async function exportPDFSeparate(snaps, mode) {
  const status = document.getElementById('status');
  
  if (snaps.length === 0) {
    status.textContent = 'No screenshots to export';
    status.className = 'status error';
    setTimeout(() => {
      status.textContent = 'Flow: Ready';
      status.className = 'status';
    }, 1500);
    return;
  }
  
  try {
    status.textContent = 'Loading PDF library...';
    status.className = 'status active';
    
    // Load jsPDF once (or wait if already loading)
    if (!jsPDFLoaded) {
      if (!jsPDFLoadPromise) {
        jsPDFLoadPromise = new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'jspdf.min.js';
          script.onload = () => {
            console.log('jsPDF loaded successfully');
            jsPDFLoaded = true;
            setTimeout(() => resolve(), 200);
          };
          script.onerror = (err) => {
            console.error('jsPDF load error:', err);
            reject(new Error('Failed to load jsPDF library'));
          };
          document.head.appendChild(script);
        });
      }
      await jsPDFLoadPromise;
    }
    
    // Verify library is available
    if (!window.jspdf || typeof window.jspdf.jsPDF === 'undefined') {
      throw new Error('jsPDF library not available after loading');
    }
    
    const { jsPDF } = window.jspdf;
    const pageWidth = 210; // A4 width in mm
    const pageHeight = 297; // A4 height in mm
    const margin = 10;
    const maxWidth = pageWidth - (2 * margin);
    const maxHeight = pageHeight - (2 * margin);
    const timestamp = new Date().toISOString().slice(0, 10);
    
    // Generate and download each PDF
    for (let i = 0; i < snaps.length; i++) {
      status.textContent = `Generating PDF ${i + 1} of ${snaps.length}...`;
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      
      // Add image to PDF
      const img = await createImageBitmap(await (await fetch(snaps[i])).blob());
      const aspectRatio = img.width / img.height;
      
      let imgWidth = maxWidth;
      let imgHeight = imgWidth / aspectRatio;
      
      // If image is too tall, scale by height instead
      if (imgHeight > maxHeight) {
        imgHeight = maxHeight;
        imgWidth = imgHeight * aspectRatio;
      }
      
      // Center the image
      const x = (pageWidth - imgWidth) / 2;
      const y = margin;
      
      pdf.addImage(snaps[i], 'PNG', x, y, imgWidth, imgHeight);
      
      // Save individual PDF
      const filename = `flow-screenshot-${i + 1}-${timestamp}.pdf`;
      pdf.save(filename);
      
      // Small delay between downloads to prevent browser blocking
      if (i < snaps.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    
    status.textContent = `${snaps.length} PDFs exported ✓`;
    status.className = 'status active';
    
    setTimeout(() => {
      status.textContent = 'Flow: Ready';
      status.className = 'status';
    }, 2000);
  } catch (error) {
    console.error('PDF export error:', error);
    status.textContent = 'PDF export failed';
    status.className = 'status error';
    setTimeout(() => {
      status.textContent = 'Flow: Ready';
      status.className = 'status';
    }, 2000);
  }
}

// Drag and drop variables
let draggedIndex = null;

// Handle drag start
function handleDragStart(e, index) {
  draggedIndex = index;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

// Handle drag over
function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

// Handle drag enter
function handleDragEnter(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

// Handle drag leave
function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

// Handle drop
async function handleDrop(e, dropIndex) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');
  
  if (draggedIndex === null || draggedIndex === dropIndex) return;
  
  try {
    // Reorder the array
    const temp = currentSnaps[draggedIndex];
    currentSnaps.splice(draggedIndex, 1);
    currentSnaps.splice(dropIndex, 0, temp);
    
    // Update storage
    const response = await chrome.runtime.sendMessage({ 
      action: 'setSnaps', 
      snaps: currentSnaps 
    });
    
    if (response && response.success) {
      // Clear selections only when order changed
      selectedSnapIds.clear();
      updateUI();
    }
  } catch (error) {
    console.error('Drag drop error:', error);
  }
}

// Handle drag end
function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  document.querySelectorAll('.thumbnail').forEach(t => t.classList.remove('drag-over'));
  draggedIndex = null;
}

// Show preview modal
function showPreview(index) {
  const modal = document.getElementById('previewModal');
  const image = document.getElementById('previewImage');
  const number = document.getElementById('previewNumber');
  
  image.src = currentSnaps[index];
  number.textContent = `Snap ${index + 1} of ${currentSnaps.length}`;
  modal.style.display = 'flex';
}

// Close preview modal
function closePreview() {
  const modal = document.getElementById('previewModal');
  modal.style.display = 'none';
}

// Delete individual snap
async function handleDeleteSnap(index) {
  const status = document.getElementById('status');
  
  try {
    // Remove snap from array
    currentSnaps.splice(index, 1);
    
    // Update storage via background
    await chrome.runtime.sendMessage({ 
      action: 'setSnaps', 
      snaps: currentSnaps 
    });
    
    // Clear selection if this snap was selected
    if (selectedSnapIds.has(index)) {
      selectedSnapIds.delete(index);
    }
    
    // Adjust other selections (indices have shifted)
    const newSelection = new Set();
    selectedSnapIds.forEach(id => {
      if (id > index) {
        newSelection.add(id - 1);
      } else if (id < index) {
        newSelection.add(id);
      }
    });
    selectedSnapIds = newSelection;
    
    status.textContent = 'Snap deleted ✓';
    status.className = 'status active';
    
    updateUI();
    
    setTimeout(() => {
      status.textContent = 'Flow: Ready';
      status.className = 'status';
    }, 1500);
  } catch (error) {
    console.error('Delete snap error:', error);
    status.textContent = 'Delete failed';
    status.className = 'status error';
    setTimeout(() => {
      status.textContent = 'Flow: Ready';
      status.className = 'status';
    }, 2000);
  }
}
