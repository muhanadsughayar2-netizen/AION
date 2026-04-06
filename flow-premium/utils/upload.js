// Flow Upload Utilities
// Helper functions for AI platform uploads

const UPLOAD_DELAY_MS = 1400;

// AI platform file input selectors
const AI_SELECTORS = {
  'chatgpt.com': [
    'input[type="file"][accept*="image"]',
    'input[type="file"]',
    '[data-testid="file-upload"] input[type="file"]'
  ],
  'chat.openai.com': [
    'input[type="file"][accept*="image"]',
    'input[type="file"]',
    '[data-testid="file-upload"] input[type="file"]'
  ],
  'claude.ai': [
    'input[type="file"]',
    'input[type="file"][accept*="image"]',
    '[data-testid="file-input"]'
  ],
  'grok.com': [
    'input[type="file"]',
    'input[type="file"][accept*="image"]',
    'input.file-input'
  ]
};

// Get platform from hostname
function getPlatform(hostname) {
  if (hostname.includes('chatgpt.com')) return 'chatgpt.com';
  if (hostname.includes('chat.openai.com')) return 'chat.openai.com';
  if (hostname.includes('claude.ai')) return 'claude.ai';
  if (hostname.includes('grok.com')) return 'grok.com';
  return null;
}

// Find file input for platform
async function findFileInput(platform, retries = 3) {
  const selectors = AI_SELECTORS[platform] || ['input[type="file"]'];
  
  for (let attempt = 0; attempt < retries; attempt++) {
    for (const selector of selectors) {
      const input = document.querySelector(selector);
      if (input) {
        return input;
      }
    }
    
    // Wait before retry
    if (attempt < retries - 1) {
      await delay(500);
    }
  }
  
  return null;
}

// Convert dataURL to File object
async function dataUrlToFile(dataUrl, filename) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: 'image/png' });
}

// Upload single file to input
async function uploadFile(fileInput, file) {
  try {
    // Create DataTransfer object
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    
    // Assign to input
    fileInput.files = dataTransfer.files;
    
    // Dispatch events
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    
    return true;
  } catch (error) {
    console.log('Upload file error:', error);
    return false;
  }
}

// Upload multiple files with delay
async function uploadFiles(fileInput, files, delayMs = UPLOAD_DELAY_MS) {
  const results = [];
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const success = await uploadFile(fileInput, file);
    results.push({ index: i, success });
    
    // Wait before next upload (except for last file)
    if (i < files.length - 1) {
      await delay(delayMs);
    }
  }
  
  return results;
}

// Upload snaps to AI platform
async function uploadSnapsToAI(snaps, platform) {
  try {
    // Find file input
    const fileInput = await findFileInput(platform);
    
    if (!fileInput) {
      throw new Error('File input not found for platform: ' + platform);
    }
    
    // Convert snaps to files
    const files = [];
    for (let i = 0; i < snaps.length; i++) {
      const file = await dataUrlToFile(snaps[i], `snap_${i + 1}.png`);
      files.push(file);
    }
    
    // Upload files
    const results = await uploadFiles(fileInput, files);
    
    // Check if all uploads succeeded
    const allSuccess = results.every(r => r.success);
    
    return {
      success: allSuccess,
      results,
      count: files.length
    };
  } catch (error) {
    console.log('Upload snaps error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Delay helper
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Check if current site is AI platform
function isAIPlatform(hostname) {
  return hostname.includes('chatgpt.com') ||
         hostname.includes('chat.openai.com') ||
         hostname.includes('claude.ai') ||
         hostname.includes('grok.com');
}

// Export utilities for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AI_SELECTORS,
    UPLOAD_DELAY_MS,
    getPlatform,
    findFileInput,
    dataUrlToFile,
    uploadFile,
    uploadFiles,
    uploadSnapsToAI,
    delay,
    isAIPlatform
  };
}
