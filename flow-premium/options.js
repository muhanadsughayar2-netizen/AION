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

async function loadSubscriptionStatus() {
  const badge = document.getElementById('statusBadge');
  const message = document.getElementById('trialMessage');
  const licenseSection = document.getElementById('licenseSection');
  const licenseInfo = document.getElementById('licenseInfo');

  if (!window.SnapToAISubscription) {
    if (badge) { badge.textContent = 'Loading...'; badge.className = 'status-badge'; }
    return;
  }

  try {
    const status = await window.SnapToAISubscription.check();

    if (status.isEarlyAccess) {
      if (badge) { badge.textContent = 'Pro Early Access'; badge.className = 'status-badge pro'; }
      if (message) message.textContent = 'All features are free during Early Access!';
      if (licenseSection) licenseSection.style.display = 'none';
      return;
    }

    if (status.status === 'subscribed') {
      if (badge) { badge.textContent = 'Pro Active'; badge.className = 'status-badge pro'; }
      if (message) message.textContent = 'Your subscription is active. All features unlocked.';
      if (licenseSection) licenseSection.style.display = 'none';
      if (licenseInfo) {
        licenseInfo.style.display = 'block';
        document.getElementById('licenseStatus').textContent = 'Active';
        document.getElementById('licensePlan').textContent = (status.planType || 'pro').charAt(0).toUpperCase() + (status.planType || 'pro').slice(1);
      }
    } else if (status.status === 'trial') {
      if (badge) { badge.textContent = 'Free Trial'; badge.className = 'status-badge trial'; }
      if (message) message.textContent = 'You have ' + status.daysRemaining + ' days remaining in your free trial.';
      if (licenseSection) licenseSection.style.display = 'block';
      if (licenseInfo) licenseInfo.style.display = 'none';
    } else if (status.status === 'trial_expired' || status.status === 'subscription_expired') {
      if (badge) { badge.textContent = 'Expired'; badge.className = 'status-badge expired'; }
      if (message) message.textContent = 'Your trial has ended. Subscribe to continue using AI features.';
      if (licenseSection) licenseSection.style.display = 'block';
      if (licenseInfo) licenseInfo.style.display = 'none';
    } else {
      if (badge) { badge.textContent = 'Free'; badge.className = 'status-badge'; }
      if (message) message.textContent = 'Set up your API key to start your 30-day free trial.';
      if (licenseSection) licenseSection.style.display = 'block';
      if (licenseInfo) licenseInfo.style.display = 'none';
    }
  } catch (e) {
    console.error('Failed to load subscription status:', e);
    if (badge) { badge.textContent = 'Unknown'; badge.className = 'status-badge'; }
  }
}

async function activateLicense() {
  const input = document.getElementById('licenseKey');
  const key = input ? input.value.trim() : '';
  if (!key) {
    showStatus('Please enter a license key.', 'error');
    return;
  }
  if (!window.SnapToAISubscription) {
    showStatus('Subscription system not loaded.', 'error');
    return;
  }

  const btn = document.getElementById('activateBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Verifying...'; }

  try {
    const result = await window.SnapToAISubscription.saveLicense(key);
    if (result.success) {
      showStatus('License activated! Enjoy Pro features.', 'success');
      loadSubscriptionStatus();
    } else {
      showStatus(result.error || 'Invalid license key.', 'error');
    }
  } catch (e) {
    showStatus('Failed to verify license. Please try again.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Activate'; }
  }
}

async function deactivateLicense() {
  if (!confirm('Are you sure you want to deactivate your license?')) return;
  if (!window.SnapToAISubscription) return;

  await window.SnapToAISubscription.clearLicense();
  showStatus('License deactivated.', 'success');
  loadSubscriptionStatus();
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadSubscriptionStatus();
  
  document.getElementById('imageFormat').addEventListener('change', (e) => {
    toggleJpegQuality(e.target.value === 'jpeg');
  });
  
  document.getElementById('jpegQuality').addEventListener('input', (e) => {
    document.getElementById('jpegQualityValue').textContent = e.target.value + '%';
  });
  
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('resetBtn').addEventListener('click', resetSettings);
  
  const activateBtn = document.getElementById('activateBtn');
  if (activateBtn) activateBtn.addEventListener('click', activateLicense);
  const deactivateBtn = document.getElementById('deactivateBtn');
  if (deactivateBtn) deactivateBtn.addEventListener('click', deactivateLicense);
});
