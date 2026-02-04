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

// LemonSqueezy Checkout URLs (replace with your actual URLs)
const CHECKOUT_MONTHLY = 'YOUR_MONTHLY_CHECKOUT_URL';
const CHECKOUT_YEARLY = 'YOUR_YEARLY_CHECKOUT_URL';

// Load subscription status
async function loadSubscriptionStatus() {
  const statusDiv = document.getElementById('subscriptionStatus');
  const licenseInfo = document.getElementById('licenseInfo');
  const licenseKeyInput = document.getElementById('licenseKey');
  
  try {
    const { subscriptionActive, planType, licenseKey, lastVerified } = await chrome.storage.local.get([
      'subscriptionActive', 'planType', 'licenseKey', 'lastVerified'
    ]);
    
    if (subscriptionActive && licenseKey) {
      // Pro user
      statusDiv.innerHTML = `<div class="status-badge pro">Pro (${planType === 'yearly' ? 'Yearly' : 'Monthly'})</div>`;
      licenseInfo.style.display = 'block';
      document.getElementById('licenseStatus').textContent = 'Active';
      document.getElementById('licensePlan').textContent = planType === 'yearly' ? 'Yearly ($39/year)' : 'Monthly ($4.99/month)';
      licenseKeyInput.value = '••••••••' + licenseKey.slice(-4);
      licenseKeyInput.disabled = true;
      document.getElementById('activateBtn').style.display = 'none';
      document.querySelector('.upgrade-section').style.display = 'none';
    } else {
      // Check trial status
      const { cachedServerDaysRemaining, cachedTrialStartDate } = await chrome.storage.local.get([
        'cachedServerDaysRemaining', 'cachedTrialStartDate'
      ]);
      
      if (cachedTrialStartDate) {
        const daysRemaining = cachedServerDaysRemaining || 
          Math.max(0, 30 - Math.floor((Date.now() - cachedTrialStartDate) / 86400000));
        
        if (daysRemaining > 0) {
          statusDiv.innerHTML = `<div class="status-badge trial">Trial - ${daysRemaining} days left</div>`;
        } else {
          statusDiv.innerHTML = `<div class="status-badge expired">Trial Expired</div>`;
        }
      } else {
        statusDiv.innerHTML = `<div class="status-badge trial">Free Trial</div>`;
      }
      
      licenseInfo.style.display = 'none';
      licenseKeyInput.disabled = false;
      document.getElementById('activateBtn').style.display = 'inline-block';
      document.querySelector('.upgrade-section').style.display = 'block';
    }
  } catch (error) {
    console.error('Failed to load subscription status:', error);
    statusDiv.innerHTML = `<div class="status-badge trial">Unknown</div>`;
  }
}

// Validate license with LemonSqueezy
async function validateLicense(licenseKey) {
  try {
    const response = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        license_key: licenseKey
      })
    });
    
    if (!response.ok) {
      return { valid: false, error: 'Network error. Please try again.' };
    }
    
    const data = await response.json();
    
    if (data.valid === true && data.meta && data.meta.status === 'active') {
      let planType = 'monthly';
      if (data.meta.variant_name && data.meta.variant_name.toLowerCase().includes('year')) {
        planType = 'yearly';
      }
      return { valid: true, planType, meta: data.meta };
    }
    
    return { valid: false, error: data.error || 'Invalid or inactive license key.' };
  } catch (error) {
    return { valid: false, error: 'Network error. Please check your connection.' };
  }
}

// Activate license
async function activateLicense() {
  const licenseKeyInput = document.getElementById('licenseKey');
  const activateBtn = document.getElementById('activateBtn');
  const licenseKey = licenseKeyInput.value.trim();
  
  if (!licenseKey || licenseKey.length < 8) {
    showStatus('Please enter a valid license key.', 'error');
    return;
  }
  
  activateBtn.disabled = true;
  activateBtn.textContent = 'Validating...';
  
  const result = await validateLicense(licenseKey);
  
  if (result.valid) {
    // Save license
    await chrome.storage.local.set({
      licenseKey: licenseKey,
      subscriptionActive: true,
      planType: result.planType,
      lastVerified: Date.now(),
      offlineGraceUntil: Date.now() + (7 * 24 * 60 * 60 * 1000),
      graceUntil: null
    });
    
    showStatus('License activated successfully! Enjoy Pro features.', 'success');
    loadSubscriptionStatus();
  } else {
    showStatus(result.error, 'error');
  }
  
  activateBtn.disabled = false;
  activateBtn.textContent = 'Activate';
}

// Deactivate license
async function deactivateLicense() {
  if (!confirm('Are you sure you want to deactivate your license?')) return;
  
  await chrome.storage.local.set({
    licenseKey: null,
    subscriptionActive: false,
    planType: null,
    lastVerified: null,
    offlineGraceUntil: null,
    graceUntil: null
  });
  
  document.getElementById('licenseKey').value = '';
  showStatus('License deactivated.', 'success');
  loadSubscriptionStatus();
}

// Open checkout
function openCheckout(plan) {
  const url = plan === 'monthly' ? CHECKOUT_MONTHLY : CHECKOUT_YEARLY;
  chrome.tabs.create({ url });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadSubscriptionStatus();
  
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
  
  // License activation
  document.getElementById('activateBtn').addEventListener('click', activateLicense);
  document.getElementById('deactivateBtn').addEventListener('click', deactivateLicense);
  
  // Upgrade buttons
  document.getElementById('upgradeMonthlyBtn').addEventListener('click', () => openCheckout('monthly'));
  document.getElementById('upgradeYearlyBtn').addEventListener('click', () => openCheckout('yearly'));
});
