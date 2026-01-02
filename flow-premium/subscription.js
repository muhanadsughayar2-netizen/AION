// SnapToAI Subscription Manager
// Handles trial period, Gumroad license verification, and subscription status

const TRIAL_DAYS = 30;
const GUMROAD_PRODUCT = 'YOUR_PRODUCT_PERMALINK'; // Replace with your Gumroad product permalink after setup
const CHECKOUT_MONTHLY = 'https://gumroad.com/l/YOUR_MONTHLY_LINK'; // Replace with your Gumroad link
const CHECKOUT_YEARLY = 'https://gumroad.com/l/YOUR_YEARLY_LINK';   // Replace with your Gumroad link
const VERIFY_INTERVAL_HOURS = 24;
const GRACE_PERIOD_HOURS = 48;

// Check subscription status
async function checkSubscription() {
  const { installDate, subscriptionActive, licenseKey, planType, lastVerified, graceUntil } = 
    await chrome.storage.local.get([
      'installDate',
      'subscriptionActive',
      'licenseKey',
      'planType',
      'lastVerified',
      'graceUntil'
    ]);

  const now = Date.now();

  // First time install - start trial
  if (!installDate) {
    await chrome.storage.local.set({
      installDate: now,
      subscriptionActive: false,
      licenseKey: null,
      planType: null
    });
    return {
      status: 'trial',
      daysRemaining: TRIAL_DAYS,
      canUseAI: true
    };
  }

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
