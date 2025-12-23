// SnapToAI Options Page

// Default settings
const DEFAULT_SETTINGS = {
  imageFormat: 'png',
  jpegQuality: 90,
  pdfPaperSize: 'letter-portrait',
  smartPageSplit: true,
  addUrlDateTime: false,
  downloadDirectory: '',
  showSaveAs: false,
  autoDownload: false,
  fitGoogleDocsLimit: true,
  defaultBorderEnabled: true,
  defaultBorderColor: '#00bcd4',
  defaultBorderWidth: 8,
  defaultFrameStyle: 'none'
};

// Load settings from storage
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get('snaptoaiSettings');
    const settings = { ...DEFAULT_SETTINGS, ...result.snaptoaiSettings };
    
    // Apply to UI
    document.getElementById('imageFormat').value = settings.imageFormat;
    document.getElementById('jpegQuality').value = settings.jpegQuality;
    document.getElementById('jpegQualityValue').textContent = settings.jpegQuality + '%';
    document.getElementById('pdfPaperSize').value = settings.pdfPaperSize;
    document.getElementById('smartPageSplit').checked = settings.smartPageSplit;
    document.getElementById('addUrlDateTime').checked = settings.addUrlDateTime;
    document.getElementById('downloadDirectory').value = settings.downloadDirectory;
    document.getElementById('showSaveAs').checked = settings.showSaveAs;
    document.getElementById('autoDownload').checked = settings.autoDownload;
    document.getElementById('fitGoogleDocsLimit').checked = settings.fitGoogleDocsLimit;
    document.getElementById('defaultBorderEnabled').checked = settings.defaultBorderEnabled;
    document.getElementById('defaultBorderColor').value = settings.defaultBorderColor;
    document.getElementById('defaultBorderWidth').value = settings.defaultBorderWidth;
    document.getElementById('defaultFrameStyle').value = settings.defaultFrameStyle;
    
    // Show/hide JPEG quality based on format
    toggleJpegQuality(settings.imageFormat === 'jpeg');
    
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

// Save settings to storage
async function saveSettings() {
  try {
    const settings = {
      imageFormat: document.getElementById('imageFormat').value,
      jpegQuality: parseInt(document.getElementById('jpegQuality').value),
      pdfPaperSize: document.getElementById('pdfPaperSize').value,
      smartPageSplit: document.getElementById('smartPageSplit').checked,
      addUrlDateTime: document.getElementById('addUrlDateTime').checked,
      downloadDirectory: sanitizeDirectory(document.getElementById('downloadDirectory').value),
      showSaveAs: document.getElementById('showSaveAs').checked,
      autoDownload: document.getElementById('autoDownload').checked,
      fitGoogleDocsLimit: document.getElementById('fitGoogleDocsLimit').checked,
      defaultBorderEnabled: document.getElementById('defaultBorderEnabled').checked,
      defaultBorderColor: document.getElementById('defaultBorderColor').value,
      defaultBorderWidth: parseInt(document.getElementById('defaultBorderWidth').value),
      defaultFrameStyle: document.getElementById('defaultFrameStyle').value
    };
    
    await chrome.storage.local.set({ snaptoaiSettings: settings });
    
    showStatus('Settings saved successfully!', 'success');
    
  } catch (error) {
    console.error('Failed to save settings:', error);
    showStatus('Failed to save settings.', 'error');
  }
}

// Reset to defaults
async function resetSettings() {
  if (confirm('Reset all settings to defaults?')) {
    await chrome.storage.local.set({ snaptoaiSettings: DEFAULT_SETTINGS });
    loadSettings();
    showStatus('Settings reset to defaults.', 'success');
  }
}

// Sanitize directory input
function sanitizeDirectory(dir) {
  return dir.replace(/[^a-zA-Z0-9\-_\/]/g, '').replace(/^\/+|\/+$/g, '');
}

// Toggle JPEG quality visibility
function toggleJpegQuality(show) {
  document.getElementById('jpegQualityContainer').style.display = show ? 'block' : 'none';
}

// Show status message
function showStatus(message, type) {
  const status = document.getElementById('saveStatus');
  status.textContent = message;
  status.className = 'save-status ' + type;
  
  setTimeout(() => {
    status.className = 'save-status';
  }, 3000);
}

// Unlock Pro features when API key is set
function unlockProFeatures() {
  const freeLink = document.getElementById('freeKeyLink');
  const proDashboard = document.getElementById('proDashboard');
  if (freeLink) freeLink.style.display = 'none';
  if (proDashboard) proDashboard.classList.remove('hidden');
}

// Load API key and model from sync storage
async function loadAiSettings() {
  try {
    const result = await chrome.storage.sync.get(['geminiApiKey', 'geminiModel']);
    const apiKeyInput = document.getElementById('geminiApiKey');
    const modelPicker = document.getElementById('modelPicker');
    
    if (result.geminiApiKey) {
      apiKeyInput.value = result.geminiApiKey;
      unlockProFeatures();
    }
    if (result.geminiModel) {
      modelPicker.value = result.geminiModel;
    }
  } catch (e) {
    console.error('Failed to load AI settings:', e);
  }
}

// Save API key to sync storage (secure Chrome storage)
async function saveApiKey(value) {
  if (value && value.length > 20) {
    await chrome.storage.sync.set({ geminiApiKey: value });
    unlockProFeatures();
  }
}

// Save model preference
async function saveModel(value) {
  await chrome.storage.sync.set({ geminiModel: value });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadAiSettings();
  
  // API key input handler
  const apiKeyInput = document.getElementById('geminiApiKey');
  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', (e) => {
      const value = e.target.value.trim();
      if (value.length > 20) {
        saveApiKey(value);
      }
    });
  }
  
  // Model picker handler
  const modelPicker = document.getElementById('modelPicker');
  if (modelPicker) {
    modelPicker.addEventListener('change', (e) => {
      saveModel(e.target.value);
    });
  }
  
  // Image format change handler
  document.getElementById('imageFormat').addEventListener('change', (e) => {
    toggleJpegQuality(e.target.value === 'jpeg');
  });
  
  // JPEG quality slider
  document.getElementById('jpegQuality').addEventListener('input', (e) => {
    document.getElementById('jpegQualityValue').textContent = e.target.value + '%';
  });
  
  // Save button
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  
  // Reset button
  document.getElementById('resetBtn').addEventListener('click', resetSettings);
});
