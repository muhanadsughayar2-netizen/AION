// Flow Popup Script
// Handles UI interactions, thumbnail display, and communication with background

let currentSnaps = [];
let selectedSnapIds = new Set();

// Initialize popup on load
document.addEventListener('DOMContentLoaded', async () => {
  await loadSnaps();
  await loadPlatformPreference();
  setupEventListeners();
  updateUI();
});

// Setup event listeners
function setupEventListeners() {
  // Orb button click
  document.getElementById('orbButton').addEventListener('click', handleOrbClick);
  
  // Clear button
  document.getElementById('clearButton').addEventListener('click', handleClear);
  
  // Platform selector
  document.getElementById('aiPlatform').addEventListener('change', handlePlatformChange);
  
  // Selection controls
  document.getElementById('selectAllBtn').addEventListener('click', handleSelectAll);
  document.getElementById('copySelectedBtn').addEventListener('click', handleCopySelected);
  document.getElementById('downloadSelectedBtn').addEventListener('click', handleDownloadSelected);
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
      // Upload mode - get preferred platform
      const preferredPlatform = document.getElementById('aiPlatform').value;
      
      status.textContent = `Uploading ${currentSnaps.length} snaps...`;
      status.className = 'status uploading';
      
      const response = await chrome.runtime.sendMessage({ 
        action: 'upload',
        preferredPlatform
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
async function handlePlatformChange(e) {
  const platform = e.target.value;
  await chrome.storage.sync.set({ preferredPlatform: platform });
}

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
async function loadPlatformPreference() {
  try {
    const result = await chrome.storage.sync.get('preferredPlatform');
    if (result.preferredPlatform) {
      document.getElementById('aiPlatform').value = result.preferredPlatform;
    }
  } catch (error) {
    console.error('Load platform preference error:', error);
  }
}

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
    
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = `Snap ${index + 1}`;
    
    const number = document.createElement('div');
    number.className = 'thumbnail-number';
    number.textContent = index + 1;
    
    thumbnail.appendChild(checkbox);
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
