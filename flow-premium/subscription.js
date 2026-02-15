// SnapToAI Subscription Manager
// Handles trial period and Early Access status

const TRIAL_DAYS = 30;

// ===========================================
// TEST MODE - Open popup, right-click, Inspect, Console tab
// Then type these commands to test different states:
//
//   SnapToAI_TEST.simulateTrial(25)    - 25 days left in trial
//   SnapToAI_TEST.simulateExpired()    - Trial ended, shows modal
//   SnapToAI_TEST.simulateSubscribed() - Paid user, full access
//   SnapToAI_TEST.reset()              - Fresh install, 30 days
//   SnapToAI_TEST.status()             - Show current state
//
// After each command, CLOSE and REOPEN the popup to see changes!
// ===========================================
// ⚠️ TEST MODE - For development ONLY. These functions modify trial data!
// Set to false before publishing to Chrome Web Store!
const ENABLE_TEST_MODE = false; // DISABLED for production - prevents accidental trial resets

window.SnapToAI_TEST = ENABLE_TEST_MODE ? {
  // SAFETY: Store original date before any test modifications
  _originalDate: null,
  
  async _backupOriginal() {
    if (!this._originalDate) {
      const { trialStartDate } = await chrome.storage.sync.get(['trialStartDate']);
      this._originalDate = trialStartDate;
      console.log('[TEST] Original trial date backed up:', new Date(trialStartDate).toLocaleDateString());
    }
  },
  
  async simulateTrial(daysRemaining = 15) {
    await this._backupOriginal();
    const now = Date.now();
    const daysUsed = TRIAL_DAYS - daysRemaining;
    const trialStartDate = now - (daysUsed * 24 * 60 * 60 * 1000);
    await chrome.storage.sync.set({ trialStartDate });
    await chrome.storage.local.set({ subscriptionActive: false, licenseKey: null });
    console.log('[TEST] Trial set to ' + daysRemaining + ' days remaining. Close & reopen popup.');
    console.log('[TEST] Use SnapToAI_TEST.restore() to restore original trial date.');
    return 'Done! Close and reopen popup.';
  },
  
  async simulateExpired() {
    await this._backupOriginal();
    const trialStartDate = Date.now() - (35 * 24 * 60 * 60 * 1000);
    await chrome.storage.sync.set({ trialStartDate });
    await chrome.storage.local.set({ subscriptionActive: false, licenseKey: null });
    console.log('[TEST] Trial EXPIRED. Close popup, reopen, click AI button to see modal.');
    console.log('[TEST] Use SnapToAI_TEST.restore() to restore original trial date.');
    return 'Done! Close popup, reopen, click AI button.';
  },
  
  async simulateSubscribed() {
    await this._backupOriginal();
    await chrome.storage.local.set({ subscriptionActive: true, licenseKey: 'TEST-KEY', planType: 'yearly', lastVerified: Date.now() });
    console.log('[TEST] SUBSCRIBED user. Close & reopen popup - full AI access.');
    console.log('[TEST] Use SnapToAI_TEST.restore() to restore original state.');
    return 'Done! Close and reopen popup.';
  },
  
  // RESTORE original trial date (use this after testing!)
  async restore() {
    if (this._originalDate) {
      await chrome.storage.sync.set({ trialStartDate: this._originalDate });
      await chrome.storage.local.set({ subscriptionActive: false, licenseKey: null, planType: null, lastVerified: null, graceUntil: null });
      console.log('[TEST] RESTORED original trial date:', new Date(this._originalDate).toLocaleDateString());
      this._originalDate = null;
      return 'Original trial restored! Close and reopen popup.';
    } else {
      console.log('[TEST] No backup found - trial date unchanged.');
      return 'No backup to restore.';
    }
  },
  
  // DANGER: Only use for fresh testing - permanently resets trial
  async reset() {
    console.warn('[TEST] ⚠️ WARNING: This permanently resets the trial to 30 days!');
    console.warn('[TEST] This should NEVER be used in production!');
    await chrome.storage.sync.set({ trialStartDate: Date.now() });
    await chrome.storage.local.set({ subscriptionActive: false, licenseKey: null, planType: null, lastVerified: null, graceUntil: null });
    this._originalDate = null; // Clear backup since this is intentional
    console.log('[TEST] RESET to fresh install. 30 day trial started.');
    return 'Done! Fresh 30-day trial.';
  },
  
  async status() {
    const sync = await chrome.storage.sync.get(['trialStartDate']);
    const local = await chrome.storage.local.get(['subscriptionActive','licenseKey','planType']);
    const days = sync.trialStartDate ? Math.floor((Date.now() - sync.trialStartDate) / 86400000) : 0;
    console.table({ 
      'Trial Start': sync.trialStartDate ? new Date(sync.trialStartDate).toLocaleDateString() : 'Not set',
      'Days Used': days, 
      'Trial Left': Math.max(0, TRIAL_DAYS - days), 
      'Subscribed': local.subscriptionActive || false, 
      'License': local.licenseKey ? 'Yes' : 'No',
      'Backup Saved': this._originalDate ? 'Yes' : 'No'
    });
    return { ...sync, ...local };
  }
} : { disabled: () => console.log('[SnapToAI] Test mode disabled in production.') };
// =========================================== END TEST MODE
const EARLY_ACCESS_MODE = false;
const VERIFY_INTERVAL_HOURS = 24;
const GRACE_PERIOD_HOURS = 48;
const OFFLINE_GRACE_DAYS = 7;

// Server URL for trial tracking (replace with your production URL)
const TRIAL_SERVER_URL = 'https://snaptoai.com/api/trial';

// Daily credit limit for users who change API keys (free tier)
const FREE_TIER_DAILY_CREDITS = 20;

// Hash the API key to create a unique identifier (never sends actual key)
async function hashApiKey(apiKey) {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey + 'snaptoai_salt_2024');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate or retrieve a unique device ID (persists across sessions)
// This is more reliable than IP for trial tracking
async function getDeviceId() {
  const { snaptoai_device_id } = await chrome.storage.local.get(['snaptoai_device_id']);
  
  if (snaptoai_device_id) {
    return snaptoai_device_id;
  }
  
  // Generate a new device ID (UUID v4 format)
  const newDeviceId = 'dev_' + crypto.randomUUID();
  await chrome.storage.local.set({ snaptoai_device_id: newDeviceId });
  console.log('[SnapToAI] New device ID generated:', newDeviceId);
  return newDeviceId;
}

// Get user ID from API key hash
async function getUserId() {
  const { geminiApiKey } = await chrome.storage.sync.get(['geminiApiKey']);
  if (!geminiApiKey) {
    return null; // No API key = no trial tracking
  }
  // Hash the API key - this is the user's unique identifier
  return await hashApiKey(geminiApiKey);
}

// Get extension version from manifest
function getExtensionVersion() {
  try {
    return chrome.runtime.getManifest().version || '1.0.0';
  } catch (e) {
    return '1.0.0';
  }
}

// Get trial start date from server (source of truth)
async function getServerTrialDate(userId) {
  try {
    // Collect additional analytics data
    const browserLanguage = navigator.language || navigator.userLanguage || 'en';
    const extensionVersion = getExtensionVersion();
    
    // Collect device info (non-personal, for analytics)
    const screenResolution = `${window.screen.width}x${window.screen.height}`;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const platform = navigator.platform || navigator.userAgentData?.platform || '';
    
    // Get device ID for reliable trial tracking (persists across IP changes)
    const deviceId = await getDeviceId();
    
    const response = await fetch(TRIAL_SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        userHash: userId,
        deviceId: deviceId,
        browserLanguage: browserLanguage,
        extensionVersion: extensionVersion,
        screenResolution: screenResolution,
        timezone: timezone,
        platform: platform
      })
    });
    
    if (!response.ok) {
      console.log('[SnapToAI] Server trial check failed:', response.status);
      return null;
    }
    
    const data = await response.json();
    if (data.success && data.trialStartDate) {
      console.log('[SnapToAI] Server trial date:', new Date(data.trialStartDate).toLocaleDateString(), 'Days remaining:', data.daysRemaining);
      // Return both trial start date AND server-calculated days remaining
      return { trialStartDate: data.trialStartDate, serverDaysRemaining: data.daysRemaining };
    }
    return null;
  } catch (error) {
    console.log('[SnapToAI] Server trial check error:', error.message);
    return null;
  }
}

async function checkSubscription() {
  if (EARLY_ACCESS_MODE) {
    console.log('[SnapToAI] Early Access Mode - All features unlocked');
    return {
      status: 'subscribed',
      planType: 'early_access',
      canUseAI: true,
      isEarlyAccess: true,
      daysRemaining: 999,
      needsApiKey: false
    };
  }

  const local = await chrome.storage.local.get(['subscriptionActive', 'licenseKey', 'planType', 'lastVerified', 'graceUntil']);

  if (local.subscriptionActive && local.licenseKey) {
    const hoursSinceVerify = local.lastVerified ? (Date.now() - local.lastVerified) / 3600000 : 999;

    if (hoursSinceVerify < VERIFY_INTERVAL_HOURS) {
      return { status: 'subscribed', planType: local.planType, canUseAI: true, isEarlyAccess: false, daysRemaining: null, needsApiKey: false };
    }

    const result = await verifyLicenseWithServer(local.licenseKey);
    if (result.valid) {
      await chrome.storage.local.set({ lastVerified: Date.now(), graceUntil: null });
      return { status: 'subscribed', planType: result.planType, canUseAI: true, isEarlyAccess: false, daysRemaining: null, needsApiKey: false };
    }

    if (!local.graceUntil) {
      const graceUntil = Date.now() + (GRACE_PERIOD_HOURS * 3600000);
      await chrome.storage.local.set({ graceUntil });
      console.log('[SnapToAI] License verification failed, starting grace period until', new Date(graceUntil).toLocaleString());
      return { status: 'subscribed', planType: local.planType, canUseAI: true, isEarlyAccess: false, daysRemaining: null, needsApiKey: false };
    }

    if (local.graceUntil && Date.now() < local.graceUntil) {
      console.log('[SnapToAI] License verification failed, using grace period');
      return { status: 'subscribed', planType: local.planType, canUseAI: true, isEarlyAccess: false, daysRemaining: null, needsApiKey: false };
    }

    const offlineDays = local.lastVerified ? (Date.now() - local.lastVerified) / 86400000 : 999;
    if (offlineDays <= OFFLINE_GRACE_DAYS) {
      console.log('[SnapToAI] Offline grace - last verified', Math.round(offlineDays), 'days ago');
      return { status: 'subscribed', planType: local.planType, canUseAI: true, isEarlyAccess: false, daysRemaining: null, needsApiKey: false };
    }

    return { status: 'subscription_expired', planType: null, canUseAI: false, isEarlyAccess: false, daysRemaining: 0, needsApiKey: false };
  }

  const userId = await getUserId();
  if (!userId) {
    return { status: 'no_api_key', planType: null, canUseAI: false, isEarlyAccess: false, daysRemaining: TRIAL_DAYS, needsApiKey: true };
  }

  let { trialStartDate } = await chrome.storage.sync.get(['trialStartDate']);

  if (!trialStartDate) {
    trialStartDate = Date.now();
    await chrome.storage.sync.set({ trialStartDate });
  }

  const serverData = await getServerTrialDate(userId);
  let daysRemaining;

  if (serverData && serverData.serverDaysRemaining !== undefined) {
    daysRemaining = serverData.serverDaysRemaining;
    if (serverData.trialStartDate < trialStartDate) {
      await chrome.storage.sync.set({ trialStartDate: serverData.trialStartDate });
    }
  } else {
    const daysUsed = Math.floor((Date.now() - trialStartDate) / 86400000);
    daysRemaining = Math.max(0, TRIAL_DAYS - daysUsed);
  }

  if (daysRemaining <= 0) {
    return { status: 'trial_expired', planType: null, canUseAI: false, isEarlyAccess: false, daysRemaining: 0, needsApiKey: false };
  }

  return { status: 'trial', planType: 'trial', canUseAI: true, isEarlyAccess: false, daysRemaining, needsApiKey: false };
}

async function verifyLicenseWithServer(licenseKey) {
  try {
    const userId = await getUserId();
    const response = await fetch(TRIAL_SERVER_URL.replace('/trial', '/verify-license'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey, userHash: userId })
    });

    if (!response.ok) {
      console.log('[SnapToAI] License verification failed:', response.status);
      return { valid: false, reason: 'Server error' };
    }

    const data = await response.json();
    if (data.success) {
      return { valid: true, planType: data.planType || 'pro' };
    }
    return { valid: false, reason: data.error || 'Invalid license' };
  } catch (error) {
    console.log('[SnapToAI] License verification error:', error.message);
    return { valid: false, reason: 'Connection error' };
  }
}

// Save and verify new license key (placeholder for future use)
async function saveLicenseKey(licenseKey) {
  if (!licenseKey || licenseKey.trim().length < 8) {
    return { success: false, error: 'Invalid license key format' };
  }
  
  const result = await verifyLicenseWithServer(licenseKey.trim());
  
  if (result.valid) {
    await chrome.storage.local.set({
      licenseKey: licenseKey.trim(),
      subscriptionActive: true,
      planType: result.planType,
      lastVerified: Date.now(),
      graceUntil: null
    });
    return { success: true, planType: result.planType };
  }
  
  return { success: false, error: result.reason };
}

// Clear license key
async function clearLicenseKey() {
  await chrome.storage.local.set({
    licenseKey: null,
    subscriptionActive: false,
    planType: null,
    lastVerified: null,
    graceUntil: null
  });
  return { success: true };
}

// Get license key (masked for display)
async function getLicenseKey() {
  const { licenseKey } = await chrome.storage.local.get('licenseKey');
  if (licenseKey) {
    // Show only last 4 characters
    return '••••••••' + licenseKey.slice(-4);
  }
  return null;
}

function openCheckout(plan = 'yearly') {
  const urls = getCheckoutUrls();
  const url = plan === 'monthly' ? urls.monthly : urls.yearly;
  chrome.tabs.create({ url });
}

function getCheckoutUrls() {
  return {
    monthly: 'https://snaptoai.lemonsqueezy.com/buy/monthly',
    yearly: 'https://snaptoai.lemonsqueezy.com/buy/yearly'
  };
}

const DEV_PASSWORD_HASH = '85bfe6364f8612f84c121ef2075abcbc';

async function devOverride(password) {
  try {
    const hash = Array.from(new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))
    )).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
    if (hash === DEV_PASSWORD_HASH) {
      await chrome.storage.local.set({ snaptoai_dev_override: true });
      console.log('[SnapToAI] Developer access activated. Close and reopen popup.');
      return { success: true, message: 'Access granted. Close and reopen popup.' };
    }
  } catch (e) {
    console.log('[SnapToAI] Dev override error:', e);
  }
  return { success: false, message: 'Invalid password.' };
}

async function devRevoke() {
  await chrome.storage.local.remove(['snaptoai_dev_override']);
  console.log('[SnapToAI] Developer override removed.');
  return 'Override removed. Close and reopen popup.';
}

if (typeof window !== 'undefined') {
  window.SnapToAISubscription = {
    check: checkSubscription,
    saveLicense: saveLicenseKey,
    clearLicense: clearLicenseKey,
    getLicense: getLicenseKey,
    openCheckout,
    getCheckoutUrls,
    TRIAL_DAYS
  };
  window.SnapToAI_DEV = { unlock: devOverride, lock: devRevoke };
}
