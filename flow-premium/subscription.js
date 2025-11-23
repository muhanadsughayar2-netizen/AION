// Flow Subscription Manager
// Handles trial period and subscription logic

const TRIAL_DAYS = 30; // 1 month free trial
const SUBSCRIPTION_PRICE = 9.90; // USD per year
const STRIPE_CHECKOUT_URL = 'https://buy.stripe.com/your_product_link'; // Will be replaced with your Stripe link

// Check subscription status
async function checkSubscription() {
  const { installDate, subscriptionActive, trialUsed } = await chrome.storage.sync.get([
    'installDate',
    'subscriptionActive', 
    'trialUsed'
  ]);

  // First time install
  if (!installDate) {
    const now = Date.now();
    await chrome.storage.sync.set({
      installDate: now,
      trialUsed: false,
      subscriptionActive: false
    });
    return {
      status: 'trial',
      daysRemaining: TRIAL_DAYS,
      canUse: true
    };
  }

  // Check if subscribed
  if (subscriptionActive) {
    return {
      status: 'subscribed',
      canUse: true
    };
  }

  // Check trial period
  const daysSinceInstall = Math.floor((Date.now() - installDate) / (1000 * 60 * 60 * 24));
  const daysRemaining = Math.max(0, TRIAL_DAYS - daysSinceInstall);

  if (daysRemaining > 0) {
    return {
      status: 'trial',
      daysRemaining,
      canUse: true
    };
  }

  // Trial expired
  return {
    status: 'expired',
    daysRemaining: 0,
    canUse: false
  };
}

// Verify subscription (would connect to your backend)
async function verifySubscription(licenseKey) {
  // In production, this would verify with your backend server
  // For now, we'll simulate verification
  
  try {
    // Example API call to your server:
    // const response = await fetch('https://your-server.com/verify', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ licenseKey, extensionId: chrome.runtime.id })
    // });
    // const data = await response.json();
    
    // Simulated response
    const isValid = licenseKey && licenseKey.length === 24; // Simple validation
    
    if (isValid) {
      await chrome.storage.sync.set({
        subscriptionActive: true,
        licenseKey: licenseKey,
        subscribedDate: Date.now()
      });
      return { success: true };
    }
    
    return { success: false, error: 'Invalid license key' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Open Stripe checkout
function openCheckout() {
  chrome.tabs.create({ url: STRIPE_CHECKOUT_URL });
}

// Show upgrade prompt
async function showUpgradePrompt() {
  const status = await checkSubscription();
  
  if (status.status === 'expired') {
    // Create notification
    chrome.notifications.create('upgrade-prompt', {
      type: 'basic',
      iconUrl: 'icon-128.png',
      title: chrome.i18n.getMessage('trialEnded'),
      message: chrome.i18n.getMessage('upgradeNow'),
      buttons: [
        { title: 'Upgrade Now' },
        { title: 'Enter License Key' }
      ],
      priority: 2
    });
  }
}

// Handle notification clicks
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (notificationId === 'upgrade-prompt') {
    if (buttonIndex === 0) {
      openCheckout();
    } else {
      // Open popup to enter license key
      chrome.action.openPopup();
    }
  }
});

// Export functions
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    checkSubscription,
    verifySubscription,
    openCheckout,
    showUpgradePrompt
  };
}