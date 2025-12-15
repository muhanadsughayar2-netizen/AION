// SnapToAI Offscreen Document Script
// Handles clipboard operations that require DOM access

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'offscreenWriteClipboard') {
    writeToClipboard(request.dataUrl)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
});

async function writeToClipboard(dataUrl) {
  try {
    // Convert data URL to blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    
    // Write to clipboard using Clipboard API
    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob
      })
    ]);
    
    console.log('[SnapToAI:Offscreen] Image written to clipboard');
    return { success: true };
  } catch (error) {
    console.error('[SnapToAI:Offscreen] Clipboard write failed:', error);
    return { success: false, error: error.message };
  }
}
