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
window.SnapToAI_TEST = {
  async simulateTrial(daysRemaining = 15) {
    const now = Date.now();
    const daysUsed = TRIAL_DAYS - daysRemaining;
    const trialStartDate = now - (daysUsed * 24 * 60 * 60 * 1000);
    await chrome.storage.sync.set({ trialStartDate });
    await chrome.storage.local.set({ subscriptionActive: false, licenseKey: null });
    console.log('[TEST] Trial set to ' + daysRemaining + ' days remaining. Close & reopen popup.');
    return 'Done! Close and reopen popup.';
  },
  async simulateExpired() {
    const trialStartDate = Date.now() - (35 * 24 * 60 * 60 * 1000);
    await chrome.storage.sync.set({ trialStartDate });
    await chrome.storage.local.set({ subscriptionActive: false, licenseKey: null });
    console.log('[TEST] Trial EXPIRED. Close popup, reopen, click AI button to see modal.');
    return 'Done! Close popup, reopen, click AI button.';
  },
  async simulateSubscribed() {
    await chrome.storage.local.set({ subscriptionActive: true, licenseKey: 'TEST-KEY', planType: 'yearly', lastVerified: Date.now() });
    console.log('[TEST] SUBSCRIBED user. Close & reopen popup - full AI access.');
    return 'Done! Close and reopen popup.';
  },
  async reset() {
    await chrome.storage.sync.set({ trialStartDate: Date.now() });
    await chrome.storage.local.set({ subscriptionActive: false, licenseKey: null, planType: null, lastVerified: null, graceUntil: null });
    console.log('[TEST] RESET to fresh install. 30 day trial started.');
    return 'Done! Fresh 30-day trial.';
  },
  async status() {
    const sync = await chrome.storage.sync.get(['trialStartDate']);
    const local = await chrome.storage.local.get(['subscriptionActive','licenseKey','planType']);
    const days = sync.trialStartDate ? Math.floor((Date.now() - sync.trialStartDate) / 86400000) : 0;
    console.table({ 'Days Used': days, 'Trial Left': Math.max(0, TRIAL_DAYS - days), 'Subscribed': local.subscriptionActive || false, 'License': local.licenseKey ? 'Yes' : 'No' });
    return { ...sync, ...local };
  }
};
// =========================================== END TEST MODE
const GUMROAD_PRODUCT = 'YOUR_PRODUCT_PERMALINK'; // Replace with your Gumroad product permalink after setup
const CHECKOUT_MONTHLY = 'https://gumroad.com/l/YOUR_MONTHLY_LINK'; // Replace with your Gumroad link
const CHECKOUT_YEARLY = 'https://gumroad.com/l/YOUR_YEARLY_LINK';   // Replace with your Gumroad link
const VERIFY_INTERVAL_HOURS = 24;
const GRACE_PERIOD_HOURS = 48;

// Check subscription status
async function checkSubscription() {
  // Trial date in SYNC storage (tied to Google account, persists across reinstalls)
  let { trialStartDate } = await chrome.storage.sync.get(['trialStartDate']);
  
  // MIGRATION: Check for legacy installDate in local storage (old users)
  if (!trialStartDate) {
    const { installDate: legacyDate } = await chrome.storage.local.get(['installDate']);
    if (legacyDate) {
      // Migrate to sync storage
      trialStartDate = legacyDate;
      await chrome.storage.sync.set({ trialStartDate: legacyDate });
      await chrome.storage.local.remove('installDate');
      console.log('[SnapToAI] Migrated trial date to sync storage.');
    }
  }
  
  // License/subscription in LOCAL storage
  const { subscriptionActive, licenseKey, planType, lastVerified, graceUntil } = 
    await chrome.storage.local.get([
      'subscriptionActive',
      'licenseKey',
      'planType',
      'lastVerified',
      'graceUntil'
    ]);

  const now = Date.now();

  // First time install - start trial (saved to sync = persists across reinstalls)
  if (!trialStartDate) {
    await chrome.storage.sync.set({ trialStartDate: now });
    await chrome.storage.local.set({
      subscriptionActive: false,
      licenseKey: null,
      planType: null
    });
    console.log('[SnapToAI] 🎉 First install! 30-day AI trial started.');
    return {
      status: 'trial',
      daysRemaining: TRIAL_DAYS,
      canUseAI: true
    };
  }
  
  // Use trialStartDate from sync storage
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

  // Check trial period
  const daysSinceInstall = Math.floor((now - installDate) / (1000 * 60 * 60 * 24));
  const daysRemaining = Math.max(0, TRIAL_DAYS - daysSinceInstall);

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

// Verify license with Gumroad API
async function verifyLicenseWithGumroad(licenseKey) {
  try {
    const response = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        product_id: GUMROAD_PRODUCT,
        license_key: licenseKey
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      const purchase = data.purchase;
      
      // Check if subscription ended
      if (purchase.subscription_ended_at) {
        return { valid: false, reason: 'subscription_ended' };
      }
      
      // Determine plan type
      let detectedPlan = 'monthly';
      if (purchase.recurrence === 'yearly' || 
          (purchase.variants && purchase.variants.toLowerCase().includes('year'))) {
        detectedPlan = 'yearly';
      }
      
      // Update local storage
      await chrome.storage.local.set({
        subscriptionActive: true,
        planType: detectedPlan,
        lastVerified: Date.now(),
        graceUntil: null
      });
      
      return { valid: true, planType: detectedPlan };
    }
    
    return { valid: false, reason: data.message || 'invalid_license' };
  } catch (error) {
    console.log('[SnapToAI] Gumroad verification error:', error.message);
    return { valid: false, reason: 'network_error' };
  }
}

// Save and verify new license key
async function saveLicenseKey(licenseKey) {
  if (!licenseKey || licenseKey.trim().length < 8) {
    return { success: false, error: 'Invalid license key format' };
  }
  
  const result = await verifyLicenseWithGumroad(licenseKey.trim());
  
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
