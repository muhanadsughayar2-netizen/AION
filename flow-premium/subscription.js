// SnapToAI Subscription Manager
// Handles trial period, Gumroad license verification, and subscription status

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
const GUMROAD_PRODUCT = 'YOUR_PRODUCT_PERMALINK'; // Replace with your Gumroad product permalink after setup
const CHECKOUT_MONTHLY = 'https://gumroad.com/l/YOUR_MONTHLY_LINK'; // Replace with your Gumroad link
const CHECKOUT_YEARLY = 'https://gumroad.com/l/YOUR_YEARLY_LINK';   // Replace with your Gumroad link
const VERIFY_INTERVAL_HOURS = 24;
const GRACE_PERIOD_HOURS = 48;

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

// Check subscription status
async function checkSubscription() {
  const { 
    subscriptionActive, 
    licenseKey, 
    planType, 
    lastVerified, 
    graceUntil,
    cachedTrialStartDate,
    cachedServerDaysRemaining,
    lastServerCheck
  } = await chrome.storage.local.get([
    'subscriptionActive',
    'licenseKey',
    'planType',
    'lastVerified',
    'graceUntil',
    'cachedTrialStartDate',
    'cachedServerDaysRemaining',
    'lastServerCheck'
  ]);

  const now = Date.now();
  
  // Get user ID from API key hash
  const userId = await getUserId();
  
  // If no API key, user hasn't set up AI yet - no trial needed
  if (!userId) {
    console.log('[SnapToAI] No API key set - trial not started yet');
    return {
      status: 'no_api_key',
      daysRemaining: TRIAL_DAYS,
      canUseAI: false,
      needsApiKey: true
    };
  }
  
  // Check server for trial date - more aggressive freshness checks for accurate countdown
  const CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes
  const MAX_CACHE_AGE = 24 * 60 * 60 * 1000; // 24 hours - force refresh daily
  let trialStartDate = null; // Don't trust cache blindly
  
  // Also track which API key hash we cached for
  const { cachedApiKeyHash } = await chrome.storage.local.get(['cachedApiKeyHash']);
  const apiKeyChanged = cachedApiKeyHash && cachedApiKeyHash !== userId;
  
  // Calculate if a day boundary has passed since last check
  const lastCheckDay = lastServerCheck ? Math.floor(lastServerCheck / 86400000) : 0;
  const currentDay = Math.floor(now / 86400000);
  const dayBoundaryPassed = currentDay > lastCheckDay;
  
  // Cache is stale if: too old (24h), or a calendar day has passed
  const cacheIsStale = !lastServerCheck || (now - lastServerCheck) > MAX_CACHE_AGE || dayBoundaryPassed;
  
  // Force server check if: API key changed, no cached data, interval passed, OR cache is stale
  const needsServerCheck = apiKeyChanged || !cachedTrialStartDate || !lastServerCheck || (now - lastServerCheck) > CHECK_INTERVAL || cacheIsStale;
  
  // Track server-provided days remaining for accuracy
  let serverDaysRemaining = null;
  
  if (needsServerCheck) {
    console.log('[SnapToAI] Checking server for trial status...');
    const serverResult = await getServerTrialDate(userId);
    if (serverResult && serverResult.trialStartDate) {
      trialStartDate = serverResult.trialStartDate;
      serverDaysRemaining = serverResult.serverDaysRemaining;
      // Cache locally for offline/speed - include server's calculated days
      await chrome.storage.local.set({ 
        cachedTrialStartDate: serverResult.trialStartDate,
        cachedServerDaysRemaining: serverResult.serverDaysRemaining,
        cachedApiKeyHash: userId,
        lastServerCheck: now
      });
      console.log('[SnapToAI] Trial synced with server, days remaining:', serverResult.serverDaysRemaining);
    }
  }
  
  // Fallback to cached data if server unavailable (but only if cache is reasonably fresh)
  if (!trialStartDate && cachedTrialStartDate && lastServerCheck && (now - lastServerCheck) < MAX_CACHE_AGE) {
    trialStartDate = cachedTrialStartDate;
    // Use cached server days, but adjust for time passed since last check
    const hoursSinceCheck = (now - lastServerCheck) / (1000 * 60 * 60);
    if (cachedServerDaysRemaining !== undefined && hoursSinceCheck < 24) {
      serverDaysRemaining = cachedServerDaysRemaining;
    }
    console.log('[SnapToAI] Server unavailable, using cached trial date (cache age:', Math.floor((now - lastServerCheck) / 60000), 'minutes)');
  }
  
  // Last resort fallback to local storage data
  if (!trialStartDate) {
    const { trialStartDate: syncDate } = await chrome.storage.sync.get(['trialStartDate']);
    const { initialInstallTimestamp, trialStartDate: localDate } = await chrome.storage.local.get(['initialInstallTimestamp', 'trialStartDate']);
    
    const toNum = (v) => {
      if (typeof v === 'number' && v > 0) return v;
      if (typeof v === 'string') {
        const n = parseInt(v, 10) || Date.parse(v);
        return n > 0 ? n : null;
      }
      return null;
    };
    const candidates = [initialInstallTimestamp, syncDate, localDate].map(toNum).filter(d => d && d > 0);
    trialStartDate = candidates.length > 0 ? Math.min(...candidates) : null;
    
    // If we have local data but server failed, try to sync to server
    if (trialStartDate) {
      console.log('[SnapToAI] Using local trial date, server unavailable');
    }
  }

  console.log('[SnapToAI] Trial check - Start:', trialStartDate ? new Date(trialStartDate).toLocaleDateString() : 'none', 'Days elapsed:', trialStartDate ? Math.floor((now - trialStartDate) / 86400000) : 0);

  // Handle missing trial date
  if (!trialStartDate) {
    // First time user - register with server
    const serverResult = await getServerTrialDate(userId);
    if (serverResult && serverResult.trialStartDate) {
      trialStartDate = serverResult.trialStartDate;
      serverDaysRemaining = serverResult.serverDaysRemaining;
      await chrome.storage.local.set({ 
        cachedTrialStartDate: serverResult.trialStartDate,
        cachedServerDaysRemaining: serverResult.serverDaysRemaining,
        cachedApiKeyHash: userId,
        lastServerCheck: now 
      });
    } else {
      // Server unavailable - create local trial (will sync later)
      trialStartDate = now;
      await chrome.storage.local.set({ initialInstallTimestamp: trialStartDate, trialStartDate });
      await chrome.storage.sync.set({ trialStartDate });
      console.log('[SnapToAI] Created local trial, will sync to server later');
    }
  }
  
  const installDate = trialStartDate;

  // Check if has valid subscription
  if (licenseKey) {
    // Check if re-verification is needed
    const nextVerify = lastVerified ? lastVerified + (VERIFY_INTERVAL_HOURS * 60 * 60 * 1000) : 0;
    
    if (now > nextVerify) {
      // Try to re-verify silently
      const result = await verifyLicenseWithGumroad(licenseKey);
      if (!result.valid) {
        // Start grace period if not already
        if (!graceUntil) {
          const grace = now + (GRACE_PERIOD_HOURS * 60 * 60 * 1000);
          await chrome.storage.local.set({ graceUntil: grace, subscriptionActive: true });
          return { status: 'subscribed', planType: planType || 'monthly', canUseAI: true, warning: 'verification_pending' };
        } else if (now > graceUntil) {
          // Grace period expired - subscription no longer valid
          await chrome.storage.local.set({ subscriptionActive: false });
          return { status: 'subscription_expired', daysRemaining: 0, canUseAI: false };
        }
        // Still within grace period
        return { status: 'subscribed', planType: planType || 'monthly', canUseAI: true, warning: 'grace_period' };
      }
    }
    
    // Valid subscription
    if (subscriptionActive) {
      return {
        status: 'subscribed',
        planType: planType || 'monthly',
        canUseAI: true
      };
    }
  }

  // Check trial period - prefer server-calculated days for accuracy
  const daysSinceInstall = Math.floor((now - installDate) / (1000 * 60 * 60 * 24));
  const localDaysRemaining = Math.max(0, TRIAL_DAYS - daysSinceInstall);
  
  // Use server's daysRemaining when available (more accurate), otherwise use local calculation
  const daysRemaining = (serverDaysRemaining !== null && serverDaysRemaining !== undefined) 
    ? serverDaysRemaining 
    : localDaysRemaining;

  if (daysRemaining > 0) {
    return {
      status: 'trial',
      daysRemaining,
      canUseAI: true
    };
  }

  // Trial expired, no license
  return {
    status: 'expired',
    daysRemaining: 0,
    canUseAI: false
  };
}

// Verify license with our server (server calls Gumroad and updates database)
async function verifyLicenseWithServer(licenseKey) {
  try {
    // Get user hash to link license to user
    const userId = await getUserId();
    if (!userId) {
      return { valid: false, reason: 'no_api_key' };
    }
    
    const response = await fetch(TRIAL_SERVER_URL.replace('/trial', '/verify-license'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey: licenseKey,
        userHash: userId
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Server verified and marked user as paid
      await chrome.storage.local.set({
        subscriptionActive: true,
        planType: data.planType,
        lastVerified: Date.now(),
        graceUntil: null,
        subscriptionExpires: data.expiresAt
      });
      
      console.log('[SnapToAI] License verified! Plan:', data.planType);
      return { valid: true, planType: data.planType };
    }
    
    return { valid: false, reason: data.error || 'invalid_license' };
  } catch (error) {
    console.log('[SnapToAI] License verification error:', error.message);
    return { valid: false, reason: 'network_error' };
  }
}

// Save and verify new license key
async function saveLicenseKey(licenseKey) {
  if (!licenseKey || licenseKey.trim().length < 8) {
    return { success: false, error: 'Invalid license key format' };
  }
  
  // Verify via our server (which calls Gumroad and updates database)
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

// Open Gumroad checkout
function openCheckout(plan = 'yearly') {
  const url = plan === 'monthly' ? CHECKOUT_MONTHLY : CHECKOUT_YEARLY;
  chrome.tabs.create({ url });
}

// Get checkout URLs for UI
function getCheckoutUrls() {
  return {
    monthly: CHECKOUT_MONTHLY,
    yearly: CHECKOUT_YEARLY
  };
}

// Export for popup and ai-chat
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
}
