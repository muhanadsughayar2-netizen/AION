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
        status.textContent = 'Capture failed';
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

// Update thumbnails grid
function updateThumbnails() {
  const container = document.getElementById('thumbnails');
  const selectionBar = document.getElementById('selectionBar');
  container.innerHTML = '';
  
  if (currentSnaps.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'No snapshots yet. Press Ctrl+Shift+S to capture.';
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
    thumbnail.addEventListener('dragover', handleDragOver);
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
    
    status.textContent = `Copying ${selectedSnaps.length} snaps...`;
    status.className = 'status active';
    
    // Copy snaps sequentially (clipboard can only hold one at a time)
    for (let i = 0; i < selectedSnaps.length; i++) {
      const dataUrl = selectedSnaps[i];
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ]);
      
      // Brief status update
      status.textContent = `Copied ${i + 1}/${selectedSnaps.length}`;
      
      // Small delay between copies
      if (i < selectedSnaps.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    
    status.textContent = `${selectedSnaps.length} snaps copied ✓`;
    status.className = 'status active';
    
    setTimeout(() => {
      status.textContent = 'Flow: Ready';
      status.className = 'status';
    }, 2000);
  } catch (error) {
    console.error('Copy selected error:', error);
    status.textContent = 'Copy failed';
    status.className = 'status error';
    setTimeout(() => {
      status.textContent = 'Flow: Ready';
      status.className = 'status';
    }, 2000);
  }
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

// Handle Export as PDF
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
  
  try {
    status.textContent = 'Generating PDF...';
    status.className = 'status active';
    
    // Load jsPDF once
    if (!jsPDFLoaded) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      await new Promise((resolve, reject) => {
        script.onload = () => {
          jsPDFLoaded = true;
          resolve();
        };
        script.onerror = () => reject(new Error('Failed to load jsPDF'));
        document.head.appendChild(script);
      });
      // Wait a bit for library to initialize
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (typeof window.jspdf === 'undefined') {
      throw new Error('jsPDF library failed to load');
    }
    
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = 210; // A4 width in mm
    const pageHeight = 297; // A4 height in mm
    const margin = 10;
    const maxWidth = pageWidth - (2 * margin);
    const maxHeight = pageHeight - (2 * margin);
    
    for (let i = 0; i < currentSnaps.length; i++) {
      if (i > 0) {
        pdf.addPage();
      }
      
      // Add image to PDF
      const img = await createImageBitmap(await (await fetch(currentSnaps[i])).blob());
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
      
      pdf.addImage(currentSnaps[i], 'PNG', x, y, imgWidth, imgHeight);
      
      // Add page number at bottom
      pdf.setFontSize(10);
      pdf.setTextColor(150);
      pdf.text(`Snap ${i + 1} of ${currentSnaps.length}`, pageWidth / 2, pageHeight - 5, { align: 'center' });
    }
    
    // Save PDF
    const timestamp = new Date().toISOString().slice(0, 10);
    pdf.save(`flow-screenshots-${timestamp}.pdf`);
    
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
  e.currentTarget.classList.add('drag-over');
}

// Handle drop
async function handleDrop(e, dropIndex) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  
  if (draggedIndex === null) return;
  
  // Only reorder if actually moving to different index
  if (draggedIndex !== dropIndex) {
    // Reorder the array
    const temp = currentSnaps[draggedIndex];
    currentSnaps.splice(draggedIndex, 1);
    currentSnaps.splice(dropIndex, 0, temp);
    
    // Update storage
    await chrome.runtime.sendMessage({ 
      action: 'setSnaps', 
      snaps: currentSnaps 
    });
    
    // Clear selections only when order changed
    selectedSnapIds.clear();
    
    updateUI();
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
