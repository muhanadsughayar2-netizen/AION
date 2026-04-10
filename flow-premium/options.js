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
    console.log('Failed to load settings:', error);
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
    console.log('Failed to save settings:', error);
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
  const subscribeSection = document.getElementById('subscribeSection');
  const proInfo = document.getElementById('proInfo');

  if (!window.SnapToAISubscription) {
    if (badge) { badge.textContent = 'Loading...'; badge.className = 'status-badge'; }
    return;
  }

  try {
    const status = await window.SnapToAISubscription.check();

    const subActions = document.getElementById('subscriptionActions');

    if (status.isEarlyAccess) {
      if (badge) { badge.textContent = 'Pro Early Access'; badge.className = 'status-badge pro'; }
      if (message) message.textContent = 'All features available during Early Access!';
      if (subscribeSection) subscribeSection.style.display = 'none';
      if (subActions) subActions.style.display = 'none';
      return;
    }

    if (status.status === 'subscribed') {
      if (badge) { badge.textContent = 'Pro Active'; badge.className = 'status-badge pro'; }
      if (message) message.textContent = 'Your subscription is active. All features unlocked.';
      if (subscribeSection) subscribeSection.style.display = 'none';
      if (proInfo) {
        proInfo.style.display = 'block';
        document.getElementById('proStatus').textContent = 'Active';
        document.getElementById('proPlan').textContent = (status.planType || 'pro').charAt(0).toUpperCase() + (status.planType || 'pro').slice(1);
      }
      if (subActions) subActions.style.display = 'flex';
    } else if (status.status === 'trial') {
      if (badge) { badge.textContent = 'Trial'; badge.className = 'status-badge trial'; }
      if (message) message.textContent = 'You have ' + status.daysRemaining + ' days remaining in your trial.';
      if (subscribeSection) subscribeSection.style.display = 'none';
      if (proInfo) proInfo.style.display = 'none';
      if (subActions) subActions.style.display = 'none';
    } else if (status.status === 'trial_expired' || status.status === 'subscription_expired') {
      if (badge) { badge.textContent = 'Expired'; badge.className = 'status-badge expired'; }
      if (message) message.textContent = 'Your trial has ended. Subscribe to continue using AI features.';
      if (subscribeSection) subscribeSection.style.display = 'block';
      if (proInfo) proInfo.style.display = 'none';
      if (subActions) subActions.style.display = status.status === 'subscription_expired' ? 'flex' : 'none';
    } else {
      if (badge) { badge.textContent = 'Not signed in'; badge.className = 'status-badge'; }
      if (message) message.textContent = 'Sign in with Google to start your 30-day trial.';
      if (subscribeSection) subscribeSection.style.display = 'none';
      if (proInfo) proInfo.style.display = 'none';
      if (subActions) subActions.style.display = 'none';
    }
  } catch (e) {
    console.log('Failed to load subscription status:', e);
    if (badge) { badge.textContent = 'Unknown'; badge.className = 'status-badge'; }
  }
}

async function refreshSubscription() {
  if (!window.SnapToAISubscription) return;
  const btn = document.getElementById('refreshSubBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Checking...'; }

  try {
    const result = await window.SnapToAISubscription.refresh();
    if (result.success && result.status === 'subscribed') {
      showStatus('Subscription verified! All features unlocked.', 'success');
    } else {
      showStatus(result.error || 'No active subscription found.', 'error');
    }
    loadSubscriptionStatus();
  } catch (e) {
    showStatus('Could not check subscription. Please try again.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Refresh Subscription Status'; }
  }
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
  
  const refreshSubBtn = document.getElementById('refreshSubBtn');
  if (refreshSubBtn) refreshSubBtn.addEventListener('click', refreshSubscription);

  let _tc = 0, _tt = 0;
  const _crown = document.getElementById('_crown');
  const _devbox = document.getElementById('_devbox');
  const _xi = document.getElementById('_xi');
  const _xibtn = document.getElementById('_xibtn');

  const _showBox = () => {
    _xi.value = '';
    _devbox.style.display = 'flex';
    setTimeout(() => _xi.focus(), 50);
  };
  const _hideBox = () => {
    _devbox.style.display = 'none';
    _xi.value = '';
  };
  const _submit = async () => {
    const val = _xi.value;
    _hideBox();
    if (val) {
      const r = await window.SnapToAI_DEV.unlock(val);
      if (r.success) location.reload();
    }
  };

  if (_crown && _devbox && _xi) {
    _crown.addEventListener('click', () => {
      const now = Date.now();
      if (now - _tt > 2000) _tc = 0;
      _tt = now;
      _tc++;
      if (_tc >= 7) { _tc = 0; _showBox(); }
    });
    _devbox.addEventListener('click', (e) => { if (e.target === _devbox) _hideBox(); });
    _xibtn.addEventListener('click', _submit);
    _xi.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); _submit(); }
      if (e.key === 'Escape') _hideBox();
    });
  }
});
