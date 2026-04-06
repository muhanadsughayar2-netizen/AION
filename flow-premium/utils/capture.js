// Flow Capture Utilities
// Helper functions for screenshot capture and storage management

const MAX_SNAPS = 9; // Maximum 9 screenshots in queue

// Convert dataURL to Blob
async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return await response.blob();
}

// Convert dataURL to File
async function dataUrlToFile(dataUrl, filename) {
  const blob = await dataUrlToBlob(dataUrl);
  return new File([blob], filename, { type: blob.type });
}

// Convert Blob to dataURL
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Enforce FIFO queue limit
function enforceFIFO(snaps, maxCount = MAX_SNAPS) {
  if (snaps.length > maxCount) {
    return snaps.slice(snaps.length - maxCount);
  }
  return snaps;
}

// Add snap to queue with FIFO enforcement
function addSnapToQueue(snaps, newSnap, maxCount = MAX_SNAPS) {
  const updatedSnaps = [...snaps, newSnap];
  return enforceFIFO(updatedSnaps, maxCount);
}

// Get snapshot count from storage
async function getSnapCount() {
  try {
    const result = await chrome.storage.session.get('snaps');
    const snaps = result.snaps || [];
    return snaps.length;
  } catch (error) {
    console.log('Error getting snap count:', error);
    return 0;
  }
}

// Save snaps to session storage
async function saveSnaps(snaps) {
  try {
    await chrome.storage.session.set({ snaps });
    return true;
  } catch (error) {
    console.log('Error saving snaps:', error);
    return false;
  }
}

// Load snaps from session storage
async function loadSnaps() {
  try {
    const result = await chrome.storage.session.get('snaps');
    return result.snaps || [];
  } catch (error) {
    console.log('Error loading snaps:', error);
    return [];
  }
}

// Clear all snaps from storage
async function clearAllSnaps() {
  try {
    await chrome.storage.session.remove('snaps');
    return true;
  } catch (error) {
    console.log('Error clearing snaps:', error);
    return false;
  }
}

// Export utilities for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    dataUrlToBlob,
    dataUrlToFile,
    blobToDataUrl,
    enforceFIFO,
    addSnapToQueue,
    getSnapCount,
    saveSnaps,
    loadSnaps,
    clearAllSnaps,
    MAX_SNAPS
  };
}
