// Flow Popup Script
// Handles UI interactions, thumbnail display, and communication with background

let currentSnaps = [];
let selectedSnapIds = new Set();

// Global translation function
function getMessage(key, fallback) {
  const msg = chrome.i18n.getMessage(key);
  return msg || fallback;
}

// Initialize popup on load
document.addEventListener('DOMContentLoaded', async () => {
  translateUI(); // Add translation support
  await loadSnaps();
  setupEventListeners();
  updateUI();
});

// Translate all UI elements
function translateUI() {
  // Check if language is RTL (Arabic)
  const uiLang = chrome.i18n.getUILanguage();
  if (uiLang.startsWith('ar')) {
    document.documentElement.setAttribute('dir', 'rtl');
  }
  
  document.querySelector('.status').textContent = getMessage('flowReady', 'Flow: Ready');
  document.getElementById('selectAllBtn').textContent = getMessage('selectAll', 'Select All');
  document.getElementById('copySelectedBtn').textContent = getMessage('copySelected', 'Copy Selected');
  document.getElementById('downloadSelectedBtn').textContent = getMessage('downloadSelected', 'Download Selected');
  document.getElementById('exportPdfBtn').textContent = '📄 ' + getMessage('exportPDF', 'Export PDF');
  document.getElementById('clearButton').textContent = getMessage('clearAll', 'Clear All');
  
  // Translate PDF modal
  const pdfOptions = document.querySelectorAll('.pdf-option-text strong');
  if (pdfOptions.length >= 4) {
    pdfOptions[0].textContent = getMessage('allAsOnePDF', 'All as One PDF');
    pdfOptions[1].textContent = getMessage('allAsSeparatePDFs', 'All as Separate PDFs');
    pdfOptions[2].textContent = getMessage('selectedAsOnePDF', 'Selected as One PDF');
    pdfOptions[3].textContent = getMessage('selectedAsSeparatePDFs', 'Selected as Separate PDFs');
  }
  
  const cancelBtn = document.getElementById('pdfCancelBtn');
  if (cancelBtn) {
    cancelBtn.textContent = getMessage('cancel', 'Cancel');
  }
}

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
  chrome.runtime.onMessage.addListener(async (request) => {
    if (request.action === 'annotationComplete') {
      const { dataUrl, index } = request;
      
      // Update the snap in currentSnaps array
      currentSnaps[index] = dataUrl;
      
      // Send to background to save
      await chrome.runtime.sendMessage({ 
        action: 'setSnaps', 
        snaps: currentSnaps 
      });
      
      // Update UI
      await loadSnaps();
      updateUI();
    }
  });
}

// Handle orb button click (Capture or Upload)
async function handleOrbClick() {
  const orbButton = document.getElementById('orbButton');
  const status = document.getElementById('status');
  
  try {
    // Check if on AI platform
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    const isAIPlatform = ['chat.openai.com', 'chatgpt.com', 'claude.ai', 'grok.com']
      .some(domain => currentTab.url?.includes(domain));
    
    if (isAIPlatform) {
      // Upload mode - send selected snaps or all if none selected
      const selectedIndexes = Array.from(selectedSnapIds).map(id => {
        return currentSnaps.findIndex(snap => snap === id);
      }).filter(idx => idx !== -1);
      
      const snapsToUpload = selectedIndexes.length > 0 
        ? selectedIndexes.map(idx => currentSnaps[idx])
        : currentSnaps;
      
      if (snapsToUpload.length === 0) {
        status.textContent = getMessage('noSnapsToUpload', 'No snaps to upload');
        status.className = 'status error';
        setTimeout(() => {
          status.textContent = getMessage('flowReady', 'Flow: Ready');
          status.className = 'status';
        }, 1500);
        return;
      }
      
      // Start upload
      orbButton.style.pointerEvents = 'none';
      status.textContent = getMessage('uploadingSnaps', 'Uploading snaps...');
      status.className = 'status active';
      
      // Send upload message
      await chrome.runtime.sendMessage({ 
        action: 'upload', 
        snaps: snapsToUpload 
      });
      
      // Clear selection and update
      if (selectedIndexes.length > 0) {
        selectedSnapIds.clear();
        await loadSnaps();
        updateUI();
        status.textContent = getMessage('flowReady', 'Flow: Ready');
        status.className = 'status';
      }
    } else {
      // Capture mode
      orbButton.style.pointerEvents = 'none';
      status.textContent = getMessage('capturingSnap', 'Capturing...');
      status.className = 'status active';
      
      const response = await chrome.runtime.sendMessage({ action: 'capture' });
      
      if (response?.success) {
        await handleCaptureSuccess(response);
        setTimeout(() => {
          status.textContent = getMessage('flowReady', 'Flow: Ready');
          status.className = 'status';
        }, 1500);
      } else {
        throw new Error(response?.error || 'Capture failed');
      }
    }
  } catch (error) {
    console.error('Orb click error:', error);
    if (error.message?.includes('500ms')) {
      status.textContent = getMessage('tooFastError', 'Too fast! Wait a moment');
      status.className = 'status error';
      setTimeout(() => {
        status.textContent = getMessage('flowReady', 'Flow: Ready');
        status.className = 'status';
      }, 1500);
    } else {
      status.textContent = getMessage('errorOccurred', 'Error occurred');
      status.className = 'status error';
      setTimeout(() => {
        status.textContent = getMessage('flowReady', 'Flow: Ready');
        status.className = 'status';
      }, 2000);
    }
  } finally {
    orbButton.style.pointerEvents = 'auto';
  }
}

// Handle clear button click
async function handleClear() {
  const status = document.getElementById('status');
  
  if (currentSnaps.length === 0) return;
  
  // Clear all snaps
  await chrome.runtime.sendMessage({ action: 'clearSnaps' });
  currentSnaps = [];
  selectedSnapIds.clear();
  
  // Update UI
  updateUI();
  status.textContent = getMessage('allSnapsCleared', 'All snaps cleared');
  status.className = 'status active';
  
  setTimeout(() => {
    status.textContent = getMessage('flowReady', 'Flow: Ready');
    status.className = 'status';
  }, 1500);
}

// Handle successful capture
async function handleCaptureSuccess(response) {
  const status = document.getElementById('status');
  
  // Copy to clipboard
  try {
    const blob = await fetch(response.dataUrl).then(r => r.blob());
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob })
    ]);
    
    status.textContent = getMessage('capturedAndCopied', 'Captured & copied!');
    status.className = 'status success';
  } catch (clipError) {
    console.error('Clipboard error:', clipError);
    status.textContent = getMessage('capturedOnly', 'Captured!');
    status.className = 'status success';
  }
  
  // Reload snaps and update UI
  await loadSnaps();
  updateUI();
}

// Load snapshots from storage
async function loadSnaps() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getSnaps' });
    if (response?.snaps) {
      currentSnaps = response.snaps;
    }
  } catch (error) {
    console.error('Error loading snaps:', error);
    currentSnaps = [];
  }
}

// Update UI elements
function updateUI() {
  updateOrbButton();
  updateThumbnails();
  updateSelectionBar();
  updateClearButton();
  
  // Update badge
  chrome.action.setBadgeText({
    text: currentSnaps.length > 0 ? currentSnaps.length.toString() : ''
  });
  
  // Update popup size based on content
  updatePopupSize();
}

// Update orb button appearance and functionality
async function updateOrbButton() {
  const orbButton = document.getElementById('orbButton');
  const orbIcon = document.getElementById('orbIcon');
  const orbSubtext = document.getElementById('orbSubtext');
  
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    
    // Check if on AI platform
    const isAIPlatform = ['chat.openai.com', 'chatgpt.com', 'claude.ai', 'grok.com']
      .some(domain => currentTab.url?.includes(domain));
    
    if (isAIPlatform) {
      // Upload mode
      orbButton.className = 'orb-button upload-mode';
      orbIcon.textContent = '⬆';
      
      const selectedCount = selectedSnapIds.size;
      if (selectedCount > 0) {
        orbSubtext.textContent = getMessage('uploadSelectedCount', `Upload ${selectedCount} selected`).replace('{count}', selectedCount);
      } else {
        orbSubtext.textContent = getMessage('uploadAllCount', `Upload all ${currentSnaps.length}`).replace('{count}', currentSnaps.length);
      }
    } else {
      // Capture mode
      orbButton.className = 'orb-button capture-mode';
      orbIcon.textContent = '📸';
      const capturedCount = `${currentSnaps.length}/9`;
      orbSubtext.textContent = getMessage('capturedCount', `Captured: ${capturedCount}`).replace('{count}', capturedCount);
    }
  } catch (error) {
    console.error('Error updating orb button:', error);
  }
}

// Update thumbnails display
function updateThumbnails() {
  const container = document.getElementById('thumbnailsContainer');
  const noSnapsMessage = document.getElementById('noSnapsMessage');
  
  if (currentSnaps.length === 0) {
    container.innerHTML = '';
    noSnapsMessage.style.display = 'block';
    
    // Update no snaps message with translated text
    noSnapsMessage.innerHTML = `
      <h3>${getMessage('oneClickOneFlow', 'One click. One flow.')}</h3>
      <p>${getMessage('pagesReadyForAI', 'Your pages ready for AI in seconds.')}</p>
      <p>${getMessage('clickCameraButton', 'Click the glowing camera button above to capture instantly')}</p>
    `;
  } else {
    noSnapsMessage.style.display = 'none';
    container.innerHTML = '';
    
    currentSnaps.forEach((snap, index) => {
      const thumbnail = createThumbnail(snap, index);
      container.appendChild(thumbnail);
    });
  }
}

// Create thumbnail element
function createThumbnail(snap, index) {
  const div = document.createElement('div');
  div.className = 'thumbnail';
  
  // Check if this snap is selected
  if (selectedSnapIds.has(snap)) {
    div.classList.add('selected');
  }
  
  // Checkbox
  const checkbox = document.createElement('div');
  checkbox.className = 'thumbnail-checkbox';
  if (selectedSnapIds.has(snap)) {
    checkbox.classList.add('checked');
    checkbox.textContent = '✓';
  }
  checkbox.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSelection(snap);
  });
  
  // Thumbnail image
  const img = document.createElement('img');
  img.src = snap;
  img.alt = `Snap ${index + 1}`;
  img.addEventListener('click', () => openPreview(snap));
  
  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'thumbnail-delete';
  deleteBtn.innerHTML = '×';
  deleteBtn.title = getMessage('deleteSnap', 'Delete');
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteSnap(index);
  });
  
  div.appendChild(checkbox);
  div.appendChild(img);
  div.appendChild(deleteBtn);
  
  return div;
}

// Toggle selection of a snap
function toggleSelection(snapId) {
  if (selectedSnapIds.has(snapId)) {
    selectedSnapIds.delete(snapId);
  } else {
    selectedSnapIds.add(snapId);
  }
  
  updateUI();
}

// Handle Select All / Deselect All
function handleSelectAll() {
  if (selectedSnapIds.size === currentSnaps.length) {
    // Deselect all
    selectedSnapIds.clear();
  } else {
    // Select all
    currentSnaps.forEach(snap => selectedSnapIds.add(snap));
  }
  
  updateThumbnails();
  updateSelectionBar();
  updateOrbButton();
}

// Update selection bar visibility and button states
function updateSelectionBar() {
  const selectionBar = document.getElementById('selectionBar');
  
  if (currentSnaps.length > 0) {
    selectionBar.style.display = 'flex';
    updateSelectAllButton();
  } else {
    selectionBar.style.display = 'none';
  }
  
  updateThumbnails();
}

// Update Select All button text
function updateSelectAllButton() {
  const btn = document.getElementById('selectAllBtn');
  const allSelected = selectedSnapIds.size === currentSnaps.length;
  
  btn.textContent = allSelected ? 
    getMessage('deselectAll', 'Deselect All') : 
    getMessage('selectAll', 'Select All');
}

// Handle Copy Selected
async function handleCopySelected() {
  const status = document.getElementById('status');
  
  if (selectedSnapIds.size === 0) {
    status.textContent = getMessage('noSnapsSelected', 'No snaps selected');
    status.className = 'status error';
    setTimeout(() => {
      status.textContent = getMessage('flowReady', 'Flow: Ready');
      status.className = 'status';
    }, 1500);
    return;
  }
  
  try {
    // Convert selected snaps to blobs
    const selectedSnaps = Array.from(selectedSnapIds);
    const items = {};
    
    for (let i = 0; i < selectedSnaps.length; i++) {
      const response = await fetch(selectedSnaps[i]);
      const blob = await response.blob();
      items[`image/png`] = blob; // Clipboard can only handle one image
      break; // Only copy first selected image
    }
    
    await navigator.clipboard.write([new ClipboardItem(items)]);
    
    status.textContent = getMessage('copiedToClipboard', 'Copied to clipboard!');
    status.className = 'status success';
    
    setTimeout(() => {
      status.textContent = getMessage('flowReady', 'Flow: Ready');
      status.className = 'status';
    }, 1500);
  } catch (error) {
    console.error('Copy error:', error);
    status.textContent = getMessage('copyFailed', 'Copy failed');
    status.className = 'status error';
    
    setTimeout(() => {
      status.textContent = getMessage('flowReady', 'Flow: Ready');
      status.className = 'status';
    }, 1500);
  }
}

// Delete a specific snap
async function deleteSnap(index) {
  const snapToDelete = currentSnaps[index];
  
  // Remove from selected if it was selected
  selectedSnapIds.delete(snapToDelete);
  
  // Remove from array
  currentSnaps.splice(index, 1);
  
  // Update storage
  await chrome.runtime.sendMessage({ 
    action: 'setSnaps', 
    snaps: currentSnaps 
  });
  
  // Update UI
  updateUI();
  
  // Show status
  const status = document.getElementById('status');
  status.textContent = getMessage('snapDeleted', 'Snap deleted');
  status.className = 'status active';
  
  setTimeout(() => {
    status.textContent = getMessage('flowReady', 'Flow: Ready');
    status.className = 'status';
  }, 1000);
}

// Update Clear button visibility
function updateClearButton() {
  const clearButton = document.getElementById('clearButton');
  clearButton.style.display = currentSnaps.length > 0 ? 'block' : 'none';
}

// Update popup size based on content
function updatePopupSize() {
  const thumbnailsContainer = document.getElementById('thumbnailsContainer');
  const snapCount = currentSnaps.length;
  
  // Calculate rows needed (3 thumbnails per row)
  const rows = Math.ceil(snapCount / 3);
  
  if (snapCount === 0) {
    // No snaps - minimum height
    document.body.style.minHeight = '380px';
    thumbnailsContainer.style.height = 'auto';
  } else if (snapCount <= 3) {
    // 1 row
    document.body.style.minHeight = '420px';
    thumbnailsContainer.style.height = '120px';
  } else if (snapCount <= 6) {
    // 2 rows
    document.body.style.minHeight = '480px';
    thumbnailsContainer.style.height = '240px';
  } else {
    // 3 rows (max)
    document.body.style.minHeight = '550px';
    thumbnailsContainer.style.height = '360px';
  }
}

// Handle Download Selected
async function handleDownloadSelected() {
  const status = document.getElementById('status');
  
  if (selectedSnapIds.size === 0) {
    status.textContent = getMessage('noSnapsSelected', 'No snaps selected');
    status.className = 'status error';
    setTimeout(() => {
      status.textContent = getMessage('flowReady', 'Flow: Ready');
      status.className = 'status';
    }, 1500);
    return;
  }
  
  try {
    const selectedSnaps = Array.from(selectedSnapIds);
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
    
    for (let i = 0; i < selectedSnaps.length; i++) {
      const dataUrl = selectedSnaps[i];
      const link = document.createElement('a');
      link.download = `flow-snap-${i + 1}-${timestamp}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Small delay between downloads
      if (i < selectedSnaps.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    status.textContent = getMessage('downloadingSnaps', 'Downloading snaps...');
    status.className = 'status success';
    
    setTimeout(() => {
      status.textContent = getMessage('flowReady', 'Flow: Ready');
      status.className = 'status';
    }, 1500);
  } catch (error) {
    console.error('Download error:', error);
    status.textContent = getMessage('downloadFailed', 'Download failed');
    status.className = 'status error';
    
    setTimeout(() => {
      status.textContent = getMessage('flowReady', 'Flow: Ready');
      status.className = 'status';
    }, 1500);
  }
}

// Open preview modal
function openPreview(dataUrl) {
  const modal = document.getElementById('previewModal');
  const img = document.getElementById('previewImage');
  const editBtn = document.getElementById('previewEditBtn');
  
  img.src = dataUrl;
  modal.style.display = 'flex';
  
  // Set up edit button
  editBtn.onclick = () => {
    const index = currentSnaps.indexOf(dataUrl);
    if (index !== -1) {
      openAnnotationEditor(dataUrl, index);
      closePreview();
    }
  };
}

// Close preview modal
function closePreview() {
  const modal = document.getElementById('previewModal');
  modal.style.display = 'none';
}

// Open annotation editor (simplified)
function openAnnotationEditor(dataUrl, index) {
  // Send message to open annotation editor
  chrome.tabs.create({
    url: chrome.runtime.getURL(`annotate.html?index=${index}`)
  });
}

// Save annotated image
async function saveAnnotatedImage(dataUrl, index) {
  // Update the snap at the given index
  currentSnaps[parseInt(index)] = dataUrl;
  
  // Update storage
  await chrome.runtime.sendMessage({ 
    action: 'setSnaps', 
    snaps: currentSnaps 
  });
  
  updateUI();
  
  // Show success message
  const status = document.getElementById('status');
  status.textContent = getMessage('annotationSaved', 'Annotation saved ✓');
  status.className = 'status active';
  setTimeout(() => {
    status.textContent = getMessage('flowReady', 'Flow: Ready');
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
    status.textContent = getMessage('noSnapsToExport', 'No snaps to export');
    status.className = 'status error';
    setTimeout(() => {
      status.textContent = getMessage('flowReady', 'Flow: Ready');
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
  
  // Translate PDF modal every time it opens
  translatePDFModal();
  
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

// Translate PDF modal texts
function translatePDFModal() {
  // Translate header
  const modalHeader = document.querySelector('.pdf-modal-header h3');
  if (modalHeader) {
    modalHeader.textContent = '📄 ' + getMessage('exportPDFOptions', 'Export PDF Options');
  }
  
  // Translate all option buttons
  const pdfOptions = document.querySelectorAll('.pdf-option-text strong');
  if (pdfOptions.length >= 4) {
    pdfOptions[0].textContent = getMessage('allAsOnePDF', 'All as One PDF');
    pdfOptions[1].textContent = getMessage('allAsSeparatePDFs', 'All as Separate PDFs');
    pdfOptions[2].textContent = getMessage('selectedAsOnePDF', 'Selected as One PDF');
    pdfOptions[3].textContent = getMessage('selectedAsSeparatePDFs', 'Selected as Separate PDFs');
  }
  
  // Translate descriptions
  const pdfDescriptions = document.querySelectorAll('.pdf-option-text span');
  if (pdfDescriptions.length >= 4) {
    pdfDescriptions[0].textContent = getMessage('allAsOnePDFDesc', 'Combine all screenshots into one PDF file');
    pdfDescriptions[1].textContent = getMessage('allAsSeparatePDFsDesc', 'Download each screenshot as individual PDF');
    pdfDescriptions[2].textContent = getMessage('selectedAsOnePDFDesc', 'Combine selected screenshots into one PDF');
    pdfDescriptions[3].textContent = getMessage('selectedAsSeparatePDFsDesc', 'Download each selected screenshot as PDF');
  }
  
  // Translate cancel button
  const cancelBtn = document.getElementById('pdfCancelBtn');
  if (cancelBtn) {
    cancelBtn.textContent = getMessage('cancel', 'Cancel');
  }
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
        hidePDFExportModal();
        return;
      }
      snaps = selectedIndexes.map(i => currentSnaps[i]);
    }
    
    hidePDFExportModal();
    
    if (mode.endsWith('-combined')) {
      await exportAsCombinedPDF(snaps);
    } else {
      await exportAsSeparatePDFs(snaps);
    }
  });
});

// Load jsPDF library dynamically
async function loadJsPDF() {
  const status = document.getElementById('status');
  
  if (jsPDFLoaded) return;
  
  if (jsPDFLoadPromise) {
    await jsPDFLoadPromise;
    return;
  }
  
  jsPDFLoadPromise = new Promise((resolve, reject) => {
    status.textContent = getMessage('loadingPDFLibrary', 'Loading PDF library...');
    status.className = 'status active';
    
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('libs/jspdf.umd.min.js');
    script.onload = () => {
      jsPDFLoaded = true;
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
  
  await jsPDFLoadPromise;
}

// Export as Combined PDF
async function exportAsCombinedPDF(snaps) {
  const status = document.getElementById('status');
  
  try {
    status.textContent = getMessage('loadingPDFLibrary', 'Loading PDF library...');
    status.className = 'status active';
    
    // Load jsPDF if not already loaded
    await loadJsPDF();
    
    status.textContent = getMessage('generatingPDF', 'Generating PDF...');
    
    // Create PDF with A4 dimensions
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });
    
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const contentWidth = pageWidth - (2 * margin);
    const contentHeight = pageHeight - (2 * margin);
    
    // Process each snap
    for (let i = 0; i < snaps.length; i++) {
      if (i > 0) {
        pdf.addPage();
      }
      
      // Convert dataURL to image
      const img = new Image();
      img.src = snaps[i];
      await new Promise(resolve => {
        img.onload = resolve;
      });
      
      // Calculate dimensions to fit page
      const imgRatio = img.width / img.height;
      const pageRatio = contentWidth / contentHeight;
      
      let finalWidth, finalHeight, offsetX, offsetY;
      
      if (imgRatio > pageRatio) {
        // Image is wider than page ratio
        finalWidth = contentWidth;
        finalHeight = contentWidth / imgRatio;
        offsetX = margin;
        offsetY = margin + (contentHeight - finalHeight) / 2;
      } else {
        // Image is taller than page ratio
        finalHeight = contentHeight;
        finalWidth = contentHeight * imgRatio;
        offsetX = margin + (contentWidth - finalWidth) / 2;
        offsetY = margin;
      }
      
      // Add image to PDF
      pdf.addImage(snaps[i], 'PNG', offsetX, offsetY, finalWidth, finalHeight);
      
      // Add page number
      pdf.setFontSize(10);
      pdf.setTextColor(128);
      pdf.text(`${i + 1} / ${snaps.length}`, pageWidth / 2, pageHeight - 5, { align: 'center' });
    }
    
    // Generate timestamp for filename
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
    
    // Save the PDF
    pdf.save(`flow-screenshots-${timestamp}.pdf`);
    
    status.textContent = getMessage('pdfExported', 'PDF exported successfully!');
    status.className = 'status success';
    
    setTimeout(() => {
      status.textContent = getMessage('flowReady', 'Flow: Ready');
      status.className = 'status';
    }, 2000);
  } catch (error) {
    console.error('PDF export error:', error);
    status.textContent = getMessage('pdfExportFailed', 'PDF export failed');
    status.className = 'status error';
    
    setTimeout(() => {
      status.textContent = getMessage('flowReady', 'Flow: Ready');
      status.className = 'status';
    }, 2000);
  }
}

// Export as Separate PDFs
async function exportAsSeparatePDFs(snaps) {
  const status = document.getElementById('status');
  
  try {
    // Same PDF generation logic but save each snap as separate PDF
    status.textContent = getMessage('generatingSeparatePDFs', 'Generating PDFs...');
    status.className = 'status active';
    
    await loadJsPDF();
    status.textContent = getMessage('generatingSeparatePDFs', 'Generating PDFs...');
    
    const { jsPDF } = window.jspdf;
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
    
    for (let i = 0; i < snaps.length; i++) {
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });
      
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const contentWidth = pageWidth - (2 * margin);
      const contentHeight = pageHeight - (2 * margin);
      
      // Convert dataURL to image
      const img = new Image();
      img.src = snaps[i];
      await new Promise(resolve => {
        img.onload = resolve;
      });
      
      // Calculate dimensions to fit page
      const imgRatio = img.width / img.height;
      const pageRatio = contentWidth / contentHeight;
      
      let finalWidth, finalHeight, offsetX, offsetY;
      
      if (imgRatio > pageRatio) {
        finalWidth = contentWidth;
        finalHeight = contentWidth / imgRatio;
        offsetX = margin;
        offsetY = margin + (contentHeight - finalHeight) / 2;
      } else {
        finalHeight = contentHeight;
        finalWidth = contentHeight * imgRatio;
        offsetX = margin + (contentWidth - finalWidth) / 2;
        offsetY = margin;
      }
      
      // Add image to PDF
      pdf.addImage(snaps[i], 'PNG', offsetX, offsetY, finalWidth, finalHeight);
      
      // Save individual PDF
      pdf.save(`flow-screenshot-${i + 1}-${timestamp}.pdf`);
      
      // Small delay between downloads
      if (i < snaps.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    status.textContent = getMessage('pdfsSaved', `${snaps.length} PDFs saved!`).replace('{count}', snaps.length);
    status.className = 'status success';
    
    setTimeout(() => {
      status.textContent = getMessage('flowReady', 'Flow: Ready');
      status.className = 'status';
    }, 2000);
  } catch (error) {
    console.error('PDF export error:', error);
    status.textContent = getMessage('pdfExportFailed', 'PDF export failed');
    status.className = 'status error';
    
    setTimeout(() => {
      status.textContent = getMessage('flowReady', 'Flow: Ready');
      status.className = 'status';
    }, 2000);
  }
}

// Initialize subscription UI
async function initSubscriptionUI() {
  try {
    const { daysRemaining, isExpired } = await chrome.runtime.sendMessage({ 
      action: 'getTrialStatus' 
    });
    
    if (isExpired) {
      showTrialExpired();
    } else if (daysRemaining <= 7) {
      showTrialWarning(daysRemaining);
    }
  } catch (error) {
    console.error('Error checking trial status:', error);
  }
}

// Show trial warning
function showTrialWarning(daysRemaining) {
  const banner = document.createElement('div');
  banner.className = 'trial-banner warning';
  banner.innerHTML = `
    <span>${getMessage('daysRemaining', `${daysRemaining} days remaining`).replace('{days}', daysRemaining)}</span>
    <button class="upgrade-btn">${getMessage('upgradeNow', 'Upgrade Now - $9.90/year')}</button>
  `;
  
  document.body.insertBefore(banner, document.body.firstChild);
  
  banner.querySelector('.upgrade-btn').addEventListener('click', handleUpgrade);
}

// Show trial expired
function showTrialExpired() {
  const banner = document.createElement('div');
  banner.className = 'trial-banner expired';
  banner.innerHTML = `
    <span>${getMessage('trialEnded', 'Trial ended')}</span>
    <button class="upgrade-btn pulse">${getMessage('upgradeNow', 'Upgrade Now - $9.90/year')}</button>
  `;
  
  document.body.insertBefore(banner, document.body.firstChild);
  
  banner.querySelector('.upgrade-btn').addEventListener('click', handleUpgrade);
  
  // Disable functionality
  document.getElementById('orbButton').style.pointerEvents = 'none';
  document.getElementById('orbButton').style.opacity = '0.5';
}

// Handle upgrade click
async function handleUpgrade() {
  const status = document.getElementById('status');
  status.textContent = getMessage('redirectingToUpgrade', 'Redirecting to upgrade...');
  status.className = 'status active';
  
  // Open Stripe Checkout
  chrome.tabs.create({
    url: 'https://buy.stripe.com/test_28o5md4Qy4Ni5EI7ss' // Test mode URL
  });
  
  setTimeout(() => {
    status.textContent = getMessage('flowReady', 'Flow: Ready');
    status.className = 'status';
  }, 1500);
}

// Initialize subscription check on popup load
document.addEventListener('DOMContentLoaded', async () => {
  await initSubscriptionUI();
});