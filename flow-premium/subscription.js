const TRIAL_DAYS = 30;

const ENABLE_TEST_MODE = false;

window.SnapToAI_TEST = ENABLE_TEST_MODE ? {
  _originalDate: null,
  
  async _backupOriginal() {
    if (!this._originalDate) {
      const { trialStartDate } = await chrome.storage.sync.get(['trialStartDate']);
      this._originalDate = trialStartDate;
    }
  },
  
  async simulateTrial(daysRemaining = 15) {
    await this._backupOriginal();
    const now = Date.now();
    const daysUsed = TRIAL_DAYS - daysRemaining;
    const trialStartDate = now - (daysUsed * 24 * 60 * 60 * 1000);
    await chrome.storage.sync.set({ trialStartDate });
    await chrome.storage.local.set({ subscriptionActive: false, subscriptionPlan: null });
    return 'Done! Close and reopen popup.';
  },
  
  async simulateExpired() {
    await this._backupOriginal();
    const trialStartDate = Date.now() - (35 * 24 * 60 * 60 * 1000);
    await chrome.storage.sync.set({ trialStartDate });
    await chrome.storage.local.set({ subscriptionActive: false, subscriptionPlan: null });
    return 'Done! Close popup, reopen, click AI button.';
  },
  
  async simulateSubscribed() {
    await this._backupOriginal();
    await chrome.storage.local.set({ subscriptionActive: true, subscriptionPlan: 'yearly', lastVerified: Date.now() });
    return 'Done! Close and reopen popup.';
  },
  
  async restore() {
    if (this._originalDate) {
      await chrome.storage.sync.set({ trialStartDate: this._originalDate });
      await chrome.storage.local.set({ subscriptionActive: false, subscriptionPlan: null, lastVerified: null });
      this._originalDate = null;
      return 'Original trial restored! Close and reopen popup.';
    }
    return 'No backup to restore.';
  },
  
  async reset() {
    await chrome.storage.sync.set({ trialStartDate: Date.now() });
    await chrome.storage.local.set({ subscriptionActive: false, subscriptionPlan: null, lastVerified: null });
    this._originalDate = null;
    return 'Done! Fresh 30-day trial.';
  },
  
  async status() {
    const sync = await chrome.storage.sync.get(['trialStartDate']);
    const local = await chrome.storage.local.get(['subscriptionActive', 'subscriptionPlan']);
    const days = sync.trialStartDate ? Math.floor((Date.now() - sync.trialStartDate) / 86400000) : 0;
    console.table({ 
      'Trial Start': sync.trialStartDate ? new Date(sync.trialStartDate).toLocaleDateString() : 'Not set',
      'Days Used': days, 
      'Trial Left': Math.max(0, TRIAL_DAYS - days), 
      'Subscribed': local.subscriptionActive || false
    });
    return { ...sync, ...local };
  }
} : { disabled: () => console.log('[SnapToAI] Test mode disabled in production.') };

const EARLY_ACCESS_MODE = false;
const VERIFY_INTERVAL_HOURS = 24;
const OFFLINE_GRACE_DAYS = 7;
const BACKEND_URL = 'https://www.snaptoai.com';
const OWNER_EMAILS = new Set([
  'muhanadsughayar2@gmail.com',
  'muhanadsughayar@gmail.com',
  'muhanadsughayar1@gmail.com',
  'jospeh@smartconnects.com'
]);

async function getSignedInEmail() {
  try {
    const { snaptoai_user } = await chrome.storage.local.get(['snaptoai_user']);
    if (snaptoai_user && snaptoai_user.email) {
      return snaptoai_user.email;
    }
  } catch (e) {}
  return null;
}

async function getDeviceId() {
  const { snaptoai_device_id } = await chrome.storage.local.get(['snaptoai_device_id']);
  if (snaptoai_device_id) return snaptoai_device_id;
  const newDeviceId = 'dev_' + crypto.randomUUID();
  await chrome.storage.local.set({ snaptoai_device_id: newDeviceId });
  return newDeviceId;
}

async function checkSubscriptionWithServer(email) {
  try {
    const deviceId = await getDeviceId();
    const response = await fetch(`${BACKEND_URL}/api/subscription/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, deviceId })
    });
    if (!response.ok) return null;
    const data = await response.json();
    console.log('[SnapToAI] /api/subscription/status →', data.planType || data.status, data.branding ? `(branded: ${data.branding.name}, policy=${data.branding.keyPolicy})` : '(no branding)');
    // Guard against late responses from a previous account: if the user has
    // signed out or switched accounts while this request was in flight,
    // discard the response so we don't overwrite the new account's cache or
    // re-paint stale institution branding.
    const currentEmailNow = (await getSignedInEmail() || '').toLowerCase();
    const requestedEmail = (email || '').toLowerCase();
    if (currentEmailNow !== requestedEmail) {
      console.log('[SnapToAI] Discarding stale subscription response (account switched mid-flight).');
      return null;
    }
    if (data.success) {
      const updates = {
        subscriptionActive: data.canUseAI && data.status === 'subscribed',
        subscriptionPlan: data.planType || null,
        // Email-scope the cache so a different signed-in account doesn't
        // inherit the previous user's plan/branding.
        subscriptionEmail: (email || '').toLowerCase(),
        lastVerified: Date.now(),
        cachedSubStatus: data
      };
      // Cache white-label institution branding so the UI can swap logo/color instantly
      if (data.branding && typeof data.branding === 'object') {
        updates.snaptoai_branding = data.branding;
      } else if (data.planType !== 'institution') {
        // No longer an institution member — clear stale branding
        try { await chrome.storage.local.remove('snaptoai_branding'); } catch (e) {}
      }
      await chrome.storage.local.set(updates);
      return data;
    }
    return null;
  } catch (error) {
    console.log('[SnapToAI] Server subscription check error:', error.message);
    return null;
  }
}

async function checkSubscription() {
  const { snaptoai_dev_override } = await chrome.storage.local.get(['snaptoai_dev_override']);
  if (snaptoai_dev_override) {
    return {
      status: 'subscribed',
      planType: 'developer',
      canUseAI: true,
      isEarlyAccess: false,
      daysRemaining: 999,
      needsApiKey: false
    };
  }

  if (EARLY_ACCESS_MODE) {
    return {
      status: 'subscribed',
      planType: 'early_access',
      canUseAI: true,
      isEarlyAccess: true,
      daysRemaining: 999,
      needsApiKey: false
    };
  }

  const email = await getSignedInEmail();

  if (email && OWNER_EMAILS.has(email.toLowerCase())) {
    return {
      status: 'subscribed',
      planType: 'owner',
      canUseAI: true,
      isEarlyAccess: false,
      daysRemaining: 999,
      needsApiKey: false
    };
  }

  if (!email) {
    return { status: 'no_sign_in', planType: null, canUseAI: false, isEarlyAccess: false, daysRemaining: TRIAL_DAYS, needsApiKey: false, needsSignIn: true };
  }

  const local = await chrome.storage.local.get(['subscriptionActive', 'subscriptionPlan', 'lastVerified', 'cachedSubStatus', 'subscriptionEmail']);

  // If the cached email belongs to a different account, force a fresh server
  // check — otherwise signing in as user B inherits user A's plan/branding.
  const cachedEmail = (local.subscriptionEmail || '').toLowerCase();
  const currentEmail = (email || '').toLowerCase();
  const emailMatches = cachedEmail && cachedEmail === currentEmail;

  if (local.subscriptionActive && emailMatches) {
    const hoursSinceVerify = local.lastVerified ? (Date.now() - local.lastVerified) / 3600000 : 999;
    // Institution members revalidate hourly so admin actions (suspend, remove,
    // expiry change, branding/logo update, key rotation) take effect quickly
    // instead of waiting up to 24h.
    const cacheWindow = (local.subscriptionPlan === 'institution') ? 1 : VERIFY_INTERVAL_HOURS;

    if (hoursSinceVerify < cacheWindow) {
      return { status: 'subscribed', planType: local.subscriptionPlan, canUseAI: true, isEarlyAccess: false, daysRemaining: null, needsApiKey: false };
    }

    const serverResult = await checkSubscriptionWithServer(email);
    if (serverResult && serverResult.canUseAI && serverResult.status === 'subscribed') {
      return { status: 'subscribed', planType: serverResult.planType, canUseAI: true, isEarlyAccess: false, daysRemaining: null, needsApiKey: false };
    }

    const offlineDays = local.lastVerified ? (Date.now() - local.lastVerified) / 86400000 : 999;
    if (offlineDays <= OFFLINE_GRACE_DAYS) {
      return { status: 'subscribed', planType: local.subscriptionPlan, canUseAI: true, isEarlyAccess: false, daysRemaining: null, needsApiKey: false };
    }
  }

  const serverResult = await checkSubscriptionWithServer(email);

  if (serverResult) {
    if (serverResult.canUseAI) {
      return {
        status: serverResult.status === 'subscribed' ? 'subscribed' : 'trial',
        planType: serverResult.planType || 'trial',
        canUseAI: true,
        isEarlyAccess: false,
        daysRemaining: serverResult.daysRemaining,
        needsApiKey: false
      };
    }

    let mappedStatus = 'trial_expired';
    if (serverResult.status === 'subscription_expired') mappedStatus = 'subscription_expired';
    else if (serverResult.status === 'institution_expired') mappedStatus = 'institution_expired';
    return {
      status: mappedStatus,
      planType: serverResult.planType || null,
      institutionName: (serverResult.branding && serverResult.branding.name) || null,
      canUseAI: false,
      isEarlyAccess: false,
      daysRemaining: 0,
      needsApiKey: false
    };
  }

  let { trialStartDate } = await chrome.storage.sync.get(['trialStartDate']);
  if (!trialStartDate) {
    trialStartDate = Date.now();
    await chrome.storage.sync.set({ trialStartDate });
  }

  const daysUsed = Math.floor((Date.now() - trialStartDate) / 86400000);
  const daysRemaining = Math.max(0, TRIAL_DAYS - daysUsed);

  if (daysRemaining <= 0) {
    return { status: 'trial_expired', planType: null, canUseAI: false, isEarlyAccess: false, daysRemaining: 0, needsApiKey: false };
  }

  return { status: 'trial', planType: 'trial', canUseAI: true, isEarlyAccess: false, daysRemaining, needsApiKey: false };
}

async function refreshSubscription() {
  const email = await getSignedInEmail();
  if (!email) {
    return { success: false, error: 'Please sign in with Google first' };
  }

  // Hard-invalidate the cache so checkSubscriptionWithServer always re-hits
  // the server and refreshes branding / key policy / member last_seen.
  await chrome.storage.local.set({ lastVerified: 0 });
  await chrome.storage.local.remove(['snaptoai_branding']);
  const result = await checkSubscriptionWithServer(email);

  if (result && result.canUseAI && result.status === 'subscribed') {
    return { success: true, canUseAI: true, status: 'subscribed', planType: result.planType };
  }

  if (result && result.canUseAI) {
    return { success: true, canUseAI: true, status: 'trial', daysRemaining: result.daysRemaining };
  }

  return { success: false, canUseAI: false, error: result ? 'No active subscription found for this account' : 'Could not reach server. Please check your connection.' };
}

let checkoutPollTimer = null;
let checkoutPollCount = 0;
const CHECKOUT_POLL_INTERVAL = 4000;
const CHECKOUT_POLL_MAX = 90;

function openCheckout(plan = 'yearly') {
  const urls = getCheckoutUrls();
  const url = plan === 'monthly' ? urls.monthly : urls.yearly;
  chrome.tabs.create({ url });
  startCheckoutPolling();
}

let checkoutPollInFlight = false;

function startCheckoutPolling() {
  stopCheckoutPolling();
  checkoutPollCount = 0;
  checkoutPollInFlight = false;
  checkoutPollTimer = setInterval(async () => {
    if (checkoutPollInFlight) return;
    checkoutPollCount++;
    if (checkoutPollCount > CHECKOUT_POLL_MAX) {
      stopCheckoutPolling();
      return;
    }
    checkoutPollInFlight = true;
    try {
      const email = await getSignedInEmail();
      if (!email) return;
      const result = await checkSubscriptionWithServer(email);
      if (result && result.canUseAI && result.status === 'subscribed') {
        stopCheckoutPolling();
        if (typeof window !== 'undefined' && window.onSubscriptionActivated) {
          window.onSubscriptionActivated(result);
        }
      }
    } catch (e) {
    } finally {
      checkoutPollInFlight = false;
    }
  }, CHECKOUT_POLL_INTERVAL);
}

window.addEventListener('unload', stopCheckoutPolling);

function stopCheckoutPolling() {
  if (checkoutPollTimer) {
    clearInterval(checkoutPollTimer);
    checkoutPollTimer = null;
  }
  checkoutPollCount = 0;
}

function getCheckoutUrls() {
  return {
    monthly: 'https://whop.com/checkout/plan_hmWCOg7IaSal9/',
    yearly: 'https://whop.com/checkout/1aDc9KSfVUI7ebt70t-b0CG-pC20-A6BO-J1wnDPrjfcVL/'
  };
}

const DEV_PASSWORD_HASH = '58624a8dc37fb843b67f758e9f7a20d3';

async function devOverride(password) {
  try {
    const hash = Array.from(new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))
    )).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
    if (hash === DEV_PASSWORD_HASH) {
      await chrome.storage.local.set({ snaptoai_dev_override: true });
      return { success: true, message: 'Access granted. Close and reopen popup.' };
    }
  } catch (e) {}
  return { success: false, message: 'Invalid password.' };
}

async function devRevoke() {
  await chrome.storage.local.remove(['snaptoai_dev_override']);
  return 'Override removed. Close and reopen popup.';
}

if (typeof window !== 'undefined') {
  window.SnapToAISubscription = {
    check: checkSubscription,
    refresh: refreshSubscription,
    openCheckout,
    getCheckoutUrls,
    TRIAL_DAYS
  };
  window.SnapToAI_DEV = { unlock: devOverride, lock: devRevoke };
}
