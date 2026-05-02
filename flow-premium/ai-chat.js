// AI Chat Window Script
// Handles AI chat in a standalone window

// ============ GLOBAL RATE LIMITER ============
// Prevents multiple simultaneous API calls that cause rate limit errors
let isRequestInProgress = false;
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 3000; // 3 seconds between requests minimum

async function waitForRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    await new Promise(r => setTimeout(r, waitTime));
  }
  lastRequestTime = Date.now();
}

function acquireRequestLock() {
  if (isRequestInProgress) {
    return false; // Another request is in progress
  }
  isRequestInProgress = true;
  return true;
}

function releaseRequestLock() {
  isRequestInProgress = false;
}
// ============ END RATE LIMITER ============

function getPaidModeEstimate(mode, clipCount = 1, durationSeconds = 8) {
  if (mode === 'video') {
    // Real Veo pricing (Google AI Studio, per second of generated video):
    //   Veo 3.1 Lite preview ........ ~$0.10/s
    //   Veo 3.1 Fast / Veo 3 Fast ... ~$0.40/s
    //   Veo 3 / Veo 3.1 (full) ...... ~$0.75/s
    // We show a $0.10–$0.40/s range (covers Lite + Fast, the default models).
    const totalSeconds = clipCount * durationSeconds;
    const low  = (totalSeconds * 0.10).toFixed(2);
    const high = (totalSeconds * 0.40).toFixed(2);
    return {
      label: `${clipCount} clip${clipCount > 1 ? 's' : ''} × ${durationSeconds}s = ${totalSeconds}s`,
      cost: `~$${low}–$${high}`,
      note: 'Veo Lite/Fast — ~$0.10–$0.40 per second'
    };
  }
  if (mode === 'music') {
    // Lyria: ~$0.06 per second of audio. Default ~30s clip = ~$1.80.
    return {
      label: '1 music clip (~30s)',
      cost: '~$0.10–$0.30',
      note: 'Lyria audio generation'
    };
  }
  return {
    label: '1 paid generation',
    cost: '~$0.10–$0.50',
    note: 'estimate'
  };
}

function isBillingError(status, message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  // Tightened: only fire on truly billing-specific phrases.
  // "permission" and "precondition" alone are too broad — they fire on
  // tier/model-access errors that aren't billing problems and shouldn't
  // abort an entire multi-clip batch.
  const hasBillingKeyword =
    lower.includes('billing') ||
    lower.includes('paid tier') ||
    lower.includes('paid api') ||
    lower.includes('pay-as-you-go') ||
    lower.includes('gcp billing') ||
    lower.includes('billing not enabled') ||
    lower.includes('billing is not enabled') ||
    lower.includes('billing not activated') ||
    lower.includes('billing account') ||
    lower.includes('exclusively available');
  // 429 is a quota/rate problem, not a billing problem — exclude it
  return (status === 400 || status === 403 || status === 404) && hasBillingKeyword;
}

function buildNoKeyCard() {
  return `
    <div style="padding:18px;border-radius:14px;background:linear-gradient(135deg, rgba(0,217,255,0.10), rgba(138,43,226,0.05));border:1px solid rgba(0,217,255,0.22);box-shadow:0 8px 32px rgba(0,0,0,0.2);">
      <div style="font-size:15px;font-weight:700;color:#fff;margin-bottom:6px;">Hey! Want this app to see pictures and understand them like magic? ✨</div>
      <div style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.85);margin-bottom:14px;">
        Just connect your Gemini key. It takes 1 minute.<br>
        With a key you get about <span style="color:#00ff88;font-weight:700;">20 tries every day</span> — perfect to play and test.
      </div>
      <div style="display:flex;flex-direction:column;gap:7px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;background:rgba(0,217,255,0.06);border:1px solid rgba(0,217,255,0.12);">
          <span style="font-size:14px;">1️⃣</span>
          <span style="font-size:12px;color:rgba(255,255,255,0.85);">Go to <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:#00d9ff;text-decoration:none;font-weight:600;">Google AI Studio</a></span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;background:rgba(0,217,255,0.06);border:1px solid rgba(0,217,255,0.12);">
          <span style="font-size:14px;">2️⃣</span>
          <span style="font-size:12px;color:rgba(255,255,255,0.85);">Click "Create API key"</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;background:rgba(0,217,255,0.06);border:1px solid rgba(0,217,255,0.12);">
          <span style="font-size:14px;">3️⃣</span>
          <span style="font-size:12px;color:rgba(255,255,255,0.85);">Copy the key</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;background:rgba(0,217,255,0.06);border:1px solid rgba(0,217,255,0.12);">
          <span style="font-size:14px;">4️⃣</span>
          <span style="font-size:12px;color:rgba(255,255,255,0.85);">Paste it here — done!</span>
        </div>
      </div>
      <button class="unlock-billing-btn snaptoai-set-key-btn" style="display:block;width:100%;text-align:center;padding:11px;border-radius:10px;background:linear-gradient(135deg, #00d9ff, #8a2be2);color:#fff;font-size:13px;font-weight:700;border:none;cursor:pointer;">Enter My Key →</button>
      <div style="margin-top:14px;padding:12px 14px;border-radius:10px;background:linear-gradient(135deg, rgba(255,215,0,0.10), rgba(255,165,0,0.05));border:1px solid rgba(255,215,0,0.20);">
        <div style="font-size:13px;font-weight:700;color:#ffd700;margin-bottom:4px;">Want way more power? 🚀</div>
        <div style="font-size:12px;line-height:1.5;color:rgba(255,255,255,0.8);">Upgrade to prepaid and Google gives you <span style="color:#00ff88;font-weight:700;">$300 free credits</span>. Then you get tons of tries + <span style="color:#ffd700;font-weight:600;">Video & Music</span> unlock too!</div>
      </div>
    </div>`;
}

document.addEventListener('click', (e) => {
  if (e.target.closest('.snaptoai-set-key-btn')) {
    e.preventDefault();
    showProxyKeyPrompt();
  }
});

function buildDailyLimitCard() {
  return `
    <div style="padding:16px;border-radius:14px;background:linear-gradient(135deg, rgba(138,43,226,0.12), rgba(255,105,180,0.06));border:1px solid rgba(138,43,226,0.25);box-shadow:0 8px 32px rgba(0,0,0,0.2);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <span style="font-size:24px;">🌟</span>
        <span style="font-size:15px;font-weight:800;color:#fff;">You've Used Today's 5 Free Prompts!</span>
      </div>
      <div style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.9);margin-bottom:12px;">
        Great work! Want unlimited access? Just get your own free Gemini key — it takes 1 minute and gives you about <span style="color:#00ff88;font-weight:700;">20 tries every day</span>.
      </div>
      ${buildNoKeyCard()}
      <div style="text-align:center;margin-top:10px;font-size:10px;color:rgba(255,255,255,0.5);">Or come back tomorrow for 5 more free prompts</div>
    </div>`;
}

function buildRateLimitCard() {
  return `
    <div style="padding:16px;border-radius:14px;background:linear-gradient(135deg, rgba(0,217,255,0.10), rgba(138,43,226,0.06));border:1px solid rgba(0,217,255,0.22);box-shadow:0 8px 32px rgba(0,0,0,0.2);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <span style="font-size:24px;">⏳</span>
        <span style="font-size:15px;font-weight:800;color:#fff;">AI is Busy — Try Again Soon!</span>
      </div>
      <div style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.9);margin-bottom:12px;">
        Our free AI is getting lots of love right now. Try again in a minute, or get your own Gemini key for <span style="color:#00ff88;font-weight:700;">instant, unlimited access</span>.
      </div>
      ${buildNoKeyCard()}
    </div>`;
}

// Veo-specific rate-limit card — used when the user's OWN prepaid Gemini key hits
// Google's per-minute quota for a Veo model. This is NOT a billing problem; we must
// not show the "Upgrade to prepaid" upsell here.
function buildVeoRateLimitCard(modelLabel) {
  const labelText = modelLabel ? ` on <b>${modelLabel}</b>` : '';
  return `
    <div style="padding:16px;border-radius:14px;background:linear-gradient(135deg, rgba(255,165,0,0.10), rgba(255,100,0,0.06));border:1px solid rgba(255,165,0,0.28);box-shadow:0 8px 32px rgba(0,0,0,0.2);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <span style="font-size:24px;">⏱️</span>
        <span style="font-size:15px;font-weight:800;color:#fff;">Google Veo rate limit hit${labelText}</span>
      </div>
      <div style="font-size:13px;line-height:1.55;color:rgba(255,255,255,0.92);margin-bottom:12px;">
        You used up your <b>per-minute Veo quota</b> on your own Google API key. This is <b>not</b> a billing issue — your prepaid plan is fine.
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;font-size:12px;color:rgba(255,255,255,0.85);">
        <div>✅ <b>Wait ~60 seconds</b> — Veo per-minute quotas reset every minute</div>
        <div>🔀 <b>Switch to a different Veo model</b> (each has its own quota bucket — try 3.1 Fast or 3.1 Lite)</div>
        <div>📉 <b>Reduce clip count</b> — fewer clips = fewer requests-per-minute</div>
      </div>
      <a href="https://ai.google.dev/gemini-api/docs/rate-limits" target="_blank" rel="noopener" style="display:block;text-align:center;padding:10px;border-radius:10px;background:linear-gradient(135deg,#ffa500,#ff8800);color:#111;font-size:12px;font-weight:700;text-decoration:none;">📊 Check your Veo rate limits →</a>
      <div style="text-align:center;margin-top:8px;font-size:10px;color:rgba(255,255,255,0.55);">Quotas auto-increase as your account warms up over the first few days of paid usage.</div>
    </div>`;
}

const MODE_META = {
  'image': { icon: '🎨', name: 'Image Studio', feature: 'AI image generation', accent: '#ff6bed', glow: 'rgba(255,107,237,0.12), rgba(200,80,200,0.06)', border: 'rgba(255,107,237,0.25)' },
  'music': { icon: '🎵', name: 'Music Studio', feature: 'AI music generation', accent: '#00ff88', glow: 'rgba(0,255,136,0.12), rgba(0,200,100,0.06)', border: 'rgba(0,255,136,0.25)' },
  'video': { icon: '🎬', name: 'Video Studio', feature: 'AI video generation', accent: '#ffa500', glow: 'rgba(255,165,0,0.12), rgba(200,120,0,0.06)', border: 'rgba(255,165,0,0.25)' }
};

function buildUnlockCard(mode) {
  const meta = MODE_META[mode] || MODE_META['image'];
  return `
    <div style="padding:18px;border-radius:14px;background:linear-gradient(135deg, ${meta.glow});border:1px solid ${meta.border};box-shadow:0 8px 32px rgba(0,0,0,0.2);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <span style="font-size:26px;">${meta.icon}</span>
        <span style="font-size:16px;font-weight:800;color:#fff;">Unlock ${meta.name}</span>
      </div>
      <div style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.92);margin-bottom:14px;">
        To use <b>${meta.feature}</b>, please upgrade your Google account to a <span style="color:${meta.accent};font-weight:700;">prepaid (pay-as-you-go) plan</span>.
        Google gives you <span style="color:#ffd700;font-weight:700;">$300 in free credits</span> as a gift — more than enough to explore and create.
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;background:linear-gradient(135deg, rgba(255,215,0,0.15), rgba(255,165,0,0.08));border:1px solid rgba(255,215,0,0.25);">
          <span style="font-size:20px;">🎁</span>
          <div>
            <div style="font-size:13px;font-weight:700;color:#ffd700;">$300 Free Credit from Google</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.7);">New accounts get $300 to use on any Google Cloud AI service</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;background:rgba(0,217,255,0.06);border:1px solid rgba(0,217,255,0.12);">
          <span style="font-size:14px;">💳</span>
          <span style="font-size:12px;color:rgba(255,255,255,0.85);">Google verifies with a ~$1 hold (refunded instantly) — then you get $300 free</span>
        </div>
      </div>
      <a href="https://console.cloud.google.com/billing" target="_blank" rel="noopener" class="unlock-billing-btn" style="display:block;text-align:center;padding:11px;border-radius:10px;background:linear-gradient(135deg, ${meta.accent}, #ffd700);color:#111;font-size:13px;font-weight:700;text-decoration:none;cursor:pointer;">Upgrade to Prepaid & Claim $300 Free →</a>
      <div style="text-align:center;margin-top:8px;font-size:10px;color:rgba(255,255,255,0.55);">Takes less than 2 minutes — no charges until you exceed the free credit</div>
    </div>`;
}

function buildMusicRetryCard() {
  return buildUnlockCard('music');
}

function buildNeedKeyForPaidCard(mode) {
  const meta = MODE_META[mode] || MODE_META['image'];
  return `
    <div style="padding:18px;border-radius:14px;background:linear-gradient(135deg, ${meta.glow});border:1px solid ${meta.border};box-shadow:0 8px 32px rgba(0,0,0,0.2);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <span style="font-size:26px;">${meta.icon}</span>
        <span style="font-size:16px;font-weight:800;color:#fff;">${meta.name} requires your own key</span>
      </div>
      <div style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.92);margin-bottom:14px;">
        The free shared access is for <b>chat & vision only</b>. To use <b>${meta.feature}</b>, you need your own Gemini API key on a <span style="color:${meta.accent};font-weight:700;">prepaid (pay-as-you-go) plan</span>.
        Google gives you <span style="color:#ffd700;font-weight:700;">$300 in free credits</span> as a gift to get started.
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;background:linear-gradient(135deg, rgba(255,215,0,0.15), rgba(255,165,0,0.08));border:1px solid rgba(255,215,0,0.25);">
          <span style="font-size:20px;">🎁</span>
          <div>
            <div style="font-size:13px;font-weight:700;color:#ffd700;">$300 Free Credit from Google</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.7);">More than enough to create hundreds of images, songs or videos</div>
          </div>
        </div>
      </div>
      <button class="unlock-billing-btn snaptoai-set-key-btn" style="display:block;width:100%;text-align:center;padding:11px;border-radius:10px;background:linear-gradient(135deg, ${meta.accent}, #ffd700);color:#111;font-size:13px;font-weight:700;border:none;cursor:pointer;margin-bottom:8px;">Get My Free Key & Upgrade →</button>
      <a href="https://console.cloud.google.com/billing" target="_blank" rel="noopener" style="display:block;text-align:center;padding:9px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:12px;font-weight:600;text-decoration:none;cursor:pointer;">I have a key — Enable Billing →</a>
    </div>`;
}

async function confirmPaidGeneration(mode, details) {
  return new Promise(resolve => {
    const modal = document.getElementById('premiumCostModal');
    const titleEl = document.getElementById('premiumCostTitle');
    const estimateEl = document.getElementById('premiumCostEstimate');
    const messageEl = document.getElementById('premiumCostMessage');
    const confirmBtn = document.getElementById('premiumCostConfirm');
    const cancelBtn = document.getElementById('premiumCostCancel');
    const closeBtn = document.getElementById('closePremiumCostModal');
    if (!modal || !titleEl || !estimateEl || !messageEl || !confirmBtn || !cancelBtn || !closeBtn) {
      resolve(window.confirm(`This ${details?.label || 'generation'} may cost about ${details?.cost || 'unknown'}. Continue?`));
      return;
    }

    const preset = mode === 'video'
      ? {
          title: 'Authorize Video Generation',
          message: 'This premium video request uses high-compute AI and is billed per clip by Google. Note: clips that start a job but fail mid-render (timeouts, transient errors) may still be billed. Failed-before-job clips are not billed.'
        }
      : {
          title: 'Authorize Music Generation',
          message: 'This premium music request uses high-compute AI and is billed per request. Automatic retries are disabled so you are only charged once per click.'
        };

    const spendLine = details?.cost
      ? `Expected spend: ${details.cost}${details?.label ? ` for ${details.label}` : ''}.`
      : 'Expected spend: shown as estimate.';
    const savingsLine = mode === 'video'
      ? 'Default settings are set to the lowest-cost option so you avoid paying extra vendor markups or upsells from third-party competitors.'
      : 'This is set to the lowest-cost option so you avoid paying extra vendor markups or upsells from third-party competitors.';

    titleEl.textContent = preset.title;
    estimateEl.textContent = `Estimated cost: ${details?.cost || 'unknown'}`;
    messageEl.textContent = `${preset.message} ${spendLine} ${savingsLine}`;
    modal.style.display = 'block';

    const cleanup = (result) => {
      modal.style.display = 'none';
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
      closeBtn.onclick = null;
      window.removeEventListener('keydown', onKeyDown);
      resolve(result);
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') cleanup(false);
    };

    confirmBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    closeBtn.onclick = () => cleanup(false);
    window.addEventListener('keydown', onKeyDown);
  });
}

// ============ BACKEND PROXY (5 free prompts/day) ============
const PROXY_BACKEND_URL = 'https://www.snaptoai.com';
let freePromptsRemaining = null;

async function getProxyIdentifier() {
  try {
    const result = await chrome.storage.local.get('snaptoai_user');
    if (result.snaptoai_user?.email) return result.snaptoai_user.email;
  } catch (e) {}
  try {
    let { snaptoai_device_id } = await chrome.storage.local.get('snaptoai_device_id');
    if (!snaptoai_device_id) {
      snaptoai_device_id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      await chrome.storage.local.set({ snaptoai_device_id });
    }
    return snaptoai_device_id;
  } catch (e) {}
  return '';
}

async function sendViaProxy(prompt, imageBase64) {
  const identifier = await getProxyIdentifier();
  if (!identifier) throw new Error('Could not identify user for proxy');

  const body = { prompt, email: identifier.includes('@') ? identifier : undefined, deviceId: identifier.includes('@') ? undefined : identifier };
  if (imageBase64) body.imageData = imageBase64;

  const resp = await fetch(PROXY_BACKEND_URL + '/api/ai/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await resp.json();

  if (data.error === 'limit_reached') {
    freePromptsRemaining = 0;
    throw new Error('FREE_PROMPTS_EXHAUSTED');
  }

  if (data.error === 'busy') {
    throw new Error('PROXY_BUSY');
  }

  if (data.error) throw new Error(data.error);

  freePromptsRemaining = data.remaining;
  return { text: data.response, remaining: data.remaining, used: data.used, limit: data.limit };
}
// ============ TRIAL ENDED MODAL ============
function showTrialEndedModal(reason) {
  const modal = document.getElementById('trialEndedModal');
  if (!modal) return;

  const messages = {
    expired: 'Your 30-day trial was amazing — you clearly love SnapToAI! Keep the momentum going with a Pro plan.',
    subscription_expired: 'Your subscription has lapsed. Renew to keep all your AI superpowers active.'
  };
  const emojis = { expired: '🎯', subscription_expired: '⚡' };

  const msgEl = document.getElementById('trialEndedMessage');
  const emojiEl = document.getElementById('trialEndedEmoji');
  if (msgEl) msgEl.textContent = messages[reason] || messages.expired;
  if (emojiEl) {
    emojiEl.textContent = emojis[reason] || '🎯';
    // Re-trigger animation
    emojiEl.style.animation = 'none';
    emojiEl.offsetHeight;
    emojiEl.style.animation = '';
  }

  modal.style.display = 'flex';

  // Wire buttons
  const monthlyBtn = document.getElementById('trialMonthlyBtn');
  const yearlyBtn = document.getElementById('trialYearlyBtn');
  const checkBtn = document.getElementById('trialCheckStatusBtn');
  const continueBtn = document.getElementById('trialContinueCaptureBtn');
  const statusMsg = document.getElementById('trialStatusMsg');

  if (monthlyBtn) monthlyBtn.onclick = () => {
    if (window.SnapToAISubscription) window.SnapToAISubscription.openCheckout('monthly');
    if (checkBtn) checkBtn.textContent = '⏳ Waiting for payment...';
  };
  if (yearlyBtn) yearlyBtn.onclick = () => {
    if (window.SnapToAISubscription) window.SnapToAISubscription.openCheckout('yearly');
    if (checkBtn) checkBtn.textContent = '⏳ Waiting for payment...';
  };
  if (checkBtn) checkBtn.onclick = async () => {
    checkBtn.textContent = '⏳ Checking...';
    if (statusMsg) statusMsg.style.display = 'none';
    try {
      if (window.SnapToAISubscription) {
        const sub = await window.SnapToAISubscription.refresh();
        if (sub.success && sub.canUseAI) {
          modal.style.display = 'none';
          showPromptToast('🎉 Subscription active! AI is ready.', 3000);
        } else {
          if (statusMsg) { statusMsg.textContent = 'No active subscription found. Complete payment first.'; statusMsg.style.display = 'block'; }
          checkBtn.textContent = '🔄 Check subscription status';
        }
      }
    } catch (e) {
      if (statusMsg) { statusMsg.textContent = 'Could not reach server. Try again.'; statusMsg.style.display = 'block'; }
      checkBtn.textContent = '🔄 Check subscription status';
    }
  };
  if (continueBtn) continueBtn.onclick = () => { modal.style.display = 'none'; };
}

window.onSubscriptionActivated = (result) => {
  const modal = document.getElementById('trialEndedModal');
  if (modal) modal.style.display = 'none';
  showPromptToast('🎉 Subscription active! AI is ready.', 3000);
};

function showProxyKeyPrompt() {
  const modal = document.getElementById('geminiKeyModal');
  if (!modal) return;
  modal.classList.add('open');
  
  const closeBtn = document.getElementById('closeGeminiKeyModal');
  const cancelBtn = document.getElementById('geminiKeyModalCancel');
  const saveBtn = document.getElementById('geminiKeyModalSave');
  const input = document.getElementById('geminiKeyModalInput');
  const checkbox = document.getElementById('geminiKeyModalCompliance');
  
  let _verdictLocked = false;
  const closeModal = () => modal.classList.remove('open');
  if (closeBtn) closeBtn.onclick = closeModal;
  if (cancelBtn) cancelBtn.onclick = closeModal;
  if (modal) modal.onclick = (e) => { if (e.target === modal && !_verdictLocked) closeModal(); };
  const modalContent = modal.querySelector('.magic-modal-content');
  if (modalContent) modalContent.onclick = (e) => e.stopPropagation();
  
  if (checkbox && saveBtn) {
    checkbox.checked = false;
    saveBtn.disabled = true;
    saveBtn.style.opacity = '0.5';
    saveBtn.style.cursor = 'not-allowed';
    checkbox.onchange = () => {
      saveBtn.disabled = !checkbox.checked;
      saveBtn.style.opacity = checkbox.checked ? '1' : '0.5';
      saveBtn.style.cursor = checkbox.checked ? 'pointer' : 'not-allowed';
    };
  }
  
  if (saveBtn && input) {
    const runSave = async () => {
      if (saveBtn.disabled) return;
      const key = input.value.trim();
      if (!key) return;

      _verdictLocked = true;
      saveBtn.disabled = true;
      saveBtn.style.opacity = '0.6';
      saveBtn.style.cursor = 'wait';
      saveBtn.textContent = 'Testing key for prepaid access…';

      let statusEl = document.getElementById('geminiKeyTestStatus');
      if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = 'geminiKeyTestStatus';
        statusEl.style.cssText = 'margin-top:10px;padding:10px 12px;border-radius:8px;font-size:12px;line-height:1.5;';
        const body = saveBtn.closest('.magic-modal-content')?.querySelector('.magic-modal-body');
        if (body) body.appendChild(statusEl);
      }
      statusEl.style.background = 'rgba(0,217,255,0.08)';
      statusEl.style.border = '1px solid rgba(0,217,255,0.25)';
      statusEl.style.color = '#9be7ff';
      statusEl.innerHTML = '<span style="display:inline-block;width:10px;height:10px;border:2px solid #00d9ff;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;vertical-align:middle;margin-right:8px;"></span>Checking your account for video model access…';

      const probe = await detectKeyTierVerbose(key);
      const tier = probe.tier;

      if (tier === 'prepaid') {
        statusEl.style.background = 'linear-gradient(135deg, rgba(0,255,136,0.12), rgba(0,200,100,0.06))';
        statusEl.style.border = '1px solid rgba(0,255,136,0.35)';
        statusEl.style.color = '#5dffa3';
        statusEl.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;font-weight:700;color:#00ff88;"><span style="width:8px;height:8px;border-radius:50%;background:#00ff88;box-shadow:0 0 8px #00ff88;"></span>Prepaid plan detected</span><div style="margin-top:4px;color:rgba(255,255,255,0.85);">All features unlocked: Vision, Image, Music & Video.</div>';
        saveBtn.style.background = 'linear-gradient(135deg,#00ff88,#00c46f)';
        saveBtn.style.color = '#111';
        saveBtn.textContent = '✓ Activate Prepaid Plan';
        saveBtn.style.opacity = '1';
        saveBtn.style.cursor = 'pointer';
        saveBtn.disabled = false;
      } else {
        statusEl.style.background = 'linear-gradient(135deg, rgba(255,165,0,0.12), rgba(255,107,237,0.06))';
        statusEl.style.border = '1px solid rgba(255,165,0,0.35)';
        statusEl.style.color = '#ffd36a';
        statusEl.innerHTML = `
          <div style="display:flex;align-items:center;gap:6px;font-weight:700;color:#ffa500;margin-bottom:6px;">
            <span style="width:8px;height:8px;border-radius:50%;background:#ffa500;box-shadow:0 0 8px #ffa500;"></span>Free tier detected
          </div>
          <div style="color:rgba(255,255,255,0.85);margin-bottom:10px;">
            Your key works for Vision chat, but Image, Music and Video need a <b>prepaid (pay-as-you-go)</b> plan. Google gifts you <span style="color:#ffd700;font-weight:700;">$300 in free credits</span>.
          </div>
          <a href="https://console.cloud.google.com/billing" target="_blank" rel="noopener" style="display:block;text-align:center;padding:9px;border-radius:8px;background:linear-gradient(135deg,#ffa500,#ffd700);color:#111;font-size:12px;font-weight:700;text-decoration:none;">Upgrade to Prepaid & Claim $300 →</a>
        `;
        saveBtn.style.background = 'rgba(255,255,255,0.06)';
        saveBtn.style.border = '1px solid rgba(255,255,255,0.15)';
        saveBtn.style.color = '#fff';
        saveBtn.textContent = 'Continue with Vision only';
        saveBtn.style.opacity = '1';
        saveBtn.style.cursor = 'pointer';
        saveBtn.disabled = false;
      }

      // Defer onclick replacement so the click that triggered runSave can't re-fire it.
      setTimeout(() => {
        saveBtn.onclick = async () => {
          // Persist key + tier ONLY now, when user explicitly confirms.
          await chrome.storage.sync.set({ geminiApiKey: key });
          await chrome.storage.local.set({
            snaptoai_key_tier: tier,
            snaptoai_key_tier_key: key,
            snaptoai_key_tier_ts: Date.now()
          });
          freePromptsRemaining = null;
          _verdictLocked = false;
          closeModal();
          if (tier === 'prepaid') {
            showPromptToast('🎉 Prepaid plan active — all AI features unlocked!', 3500);
          } else {
            showPromptToast('Key saved — Vision unlocked. Upgrade to Prepaid for Image/Music/Video.', 4500);
          }
          checkKeyTier();
        };
      }, 0);
    };
    saveBtn.onclick = runSave;
  }
}

let _ownerKeyFingerprintsCache = null;
async function getOwnerKeyFingerprints() {
  if (_ownerKeyFingerprintsCache !== null) return _ownerKeyFingerprintsCache;
  try {
    const resp = await fetch(`${PROXY_BACKEND_URL}/api/owner-key-fingerprint`);
    const data = await resp.json();
    _ownerKeyFingerprintsCache = Array.isArray(data?.fingerprints) ? data.fingerprints : [];
  } catch (e) {
    _ownerKeyFingerprintsCache = [];
  }
  return _ownerKeyFingerprintsCache;
}

async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function isOwnerKey(apiKey) {
  try {
    const fingerprints = await getOwnerKeyFingerprints();
    if (!fingerprints.length) return false;
    const hash = await sha256Hex(apiKey);
    return fingerprints.includes(hash);
  } catch (e) {
    return false;
  }
}

// Single-shot probe against one paid model. Returns:
// 'prepaid' | 'free' | 'invalid' (bad key) | 'retry' (transient/unknown — caller should try another model)
// `endpoint` is the action verb on the model (predictLongRunning for Veo, predict for Imagen).
async function _probeOneVeoModel(apiKey, modelId, timeoutMs, endpoint, treatInvalidAsPrepaid) {
  endpoint = endpoint || 'predictLongRunning';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:${endpoint}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: controller.signal
    });
    clearTimeout(timer);
    const data = await resp.json().catch(() => ({}));
    console.log(`[SnapToAI] Probe ${modelId} -> HTTP ${resp.status}`, data);

    const status = (data?.error?.status || '').toUpperCase();
    const msg = (data?.error?.message || '').toLowerCase();
    const code = data?.error?.code;

    // PREPAID positive signal — HTTP 200 with an operation name means billing accepted the job
    if (resp.ok && (data?.name || data?.metadata)) return 'prepaid';
    // For models where Google checks billing BEFORE format (e.g. veo-2.0):
    // INVALID_ARGUMENT means billing passed and Google got to format validation → key is prepaid.
    // Free keys never reach format validation on these models — they get FAILED_PRECONDITION first.
    if (treatInvalidAsPrepaid && status === 'INVALID_ARGUMENT') return 'prepaid';
    // 429 / RESOURCE_EXHAUSTED on Veo is ALSO a prepaid signal — free-tier keys can't even attempt
    // Veo generation, so hitting a quota / rate limit means the key has paid Veo access.
    if (resp.status === 429 || status === 'RESOURCE_EXHAUSTED' ||
        msg.includes('exceeded your current quota') || msg.includes('rate limit') ||
        msg.includes('quota exceeded') || msg.includes('per-minute') || msg.includes('rpm')) {
      console.log(`[SnapToAI] Probe ${modelId}: 429/quota — treating as PREPAID signal`);
      return 'prepaid';
    }
    // Invalid key signals
    if (code === 401 || code === 403 || status === 'PERMISSION_DENIED' || status === 'UNAUTHENTICATED' ||
        msg.includes('api key not valid') || msg.includes('api_key_invalid') || msg.includes('api key expired')) {
      return 'invalid';
    }
    // FREE / billing-required signal — only billing-language responses, never model-availability
    if (status === 'FAILED_PRECONDITION' || msg.includes('billing enabled') || msg.includes('gcp billing') ||
        msg.includes('billing is required') || msg.includes('enable billing')) return 'free';
    return 'retry';
  } catch (e) {
    clearTimeout(timer);
    console.log(`[SnapToAI] Probe ${modelId} threw:`, e?.message || e);
    return 'retry';
  }
}

// Always commits to a verdict. Tries multiple Veo models with retries until one
// gives a definitive answer. Returns { tier: 'prepaid'|'free', invalid: bool }.
async function detectKeyTierVerbose(apiKey) {
  // SAFEGUARD: owner-key fingerprint -> forced free.
  try {
    if (await isOwnerKey(apiKey)) {
      console.log('[SnapToAI] Owner-key fingerprint match — forcing free tier');
      return { tier: 'free', invalid: false };
    }
  } catch (_) {}

  // Imagen first — it requires only Tier 1 billing, so it's the canonical "has billing" probe.
  // Veo second — many keys with billing are still on Tier 1 and Veo requires Tier 2+, so a
  // Veo FAILED_PRECONDITION is NOT a reliable "no billing" signal. We only trust Veo as a
  // backup positive signal (prepaid), not as a free verdict on its own.
  const probeChain = [
    // Veo first — Imagen last ("only available on paid plans" is a model-availability
    // message, NOT a billing-status message, and falsely flags prepaid keys as free).
    { model: 'veo-3.0-fast-generate-001',     endpoint: 'predictLongRunning',  trustFreeVerdict: false, treatInvalidAsPrepaid: false },
    { model: 'veo-3.1-fast-generate-preview', endpoint: 'predictLongRunning',  trustFreeVerdict: false, treatInvalidAsPrepaid: false },
    { model: 'veo-3.0-generate-001',          endpoint: 'predictLongRunning',  trustFreeVerdict: false, treatInvalidAsPrepaid: false },
    // veo-2.0: Google checks billing BEFORE format here. INVALID_ARGUMENT = billing OK = prepaid.
    // Free keys get FAILED_PRECONDITION from this model, never INVALID_ARGUMENT.
    { model: 'veo-2.0-generate-001',          endpoint: 'predictLongRunning',  trustFreeVerdict: true,  treatInvalidAsPrepaid: true  },
    { model: 'imagen-4.0-generate-001',       endpoint: 'predict',             trustFreeVerdict: false, treatInvalidAsPrepaid: false },
    { model: 'imagen-3.0-generate-001',       endpoint: 'predict',             trustFreeVerdict: false, treatInvalidAsPrepaid: false }
  ];

  let sawInvalid = false;
  let sawFreeFromImagen = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const p of probeChain) {
      const r = await _probeOneVeoModel(apiKey, p.model, 10000, p.endpoint, p.treatInvalidAsPrepaid);
      if (r === 'prepaid') return { tier: 'prepaid', invalid: false };
      if (r === 'free') {
        // Only Imagen's "billing required" is a definitive free-tier signal.
        // Veo's billing precondition can fire on Tier 1 paid keys (Veo needs Tier 2+),
        // so we don't trust it as a free verdict by itself.
        if (p.trustFreeVerdict) return { tier: 'free', invalid: false };
        sawFreeFromImagen = false; // explicit no-op; Veo free-signal is ignored
        continue;
      }
      if (r === 'invalid') sawInvalid = true;
      // 'retry' -> try next model / next attempt
    }
    // Brief backoff before second pass
    await new Promise(res => setTimeout(res, 500));
  }

  // Couldn't get a definitive billing/validation signal from any Veo model.
  // Safest verdict for business: treat as free (locks paid modes). If the key
  // appears invalid, mark it so UI can warn — but still default to free.
  console.log('[SnapToAI] All probes inconclusive; defaulting to free.');
  return { tier: 'free', invalid: sawInvalid };
}

// Backwards-compatible wrapper used by checkKeyTier().
async function detectKeyTier(apiKey) {
  const r = await detectKeyTierVerbose(apiKey);
  return r.tier;
}

let _toastTimeout = null;
function showPromptToast(message, duration = 4000, urgent = false) {
  const toast = document.getElementById('promptToast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = urgent ? 'prompt-toast-urgent' : '';
  toast.style.display = 'block';
  if (_toastTimeout) clearTimeout(_toastTimeout);
  _toastTimeout = setTimeout(() => { toast.style.display = 'none'; }, duration);
}
// ============ END BACKEND PROXY ============

// ============ IndexedDB for unlimited image storage ============
const SNAPTOAI_DB_NAME = 'SnapToAI_ImageDB';
const SNAPTOAI_STORE_NAME = 'images';

function openSnapDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SNAPTOAI_DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(SNAPTOAI_STORE_NAME)) {
        db.createObjectStore(SNAPTOAI_STORE_NAME);
      }
    };
  });
}

async function loadImagesFromIndexedDB() {
  try {
    const db = await openSnapDB();
    const tx = db.transaction(SNAPTOAI_STORE_NAME, 'readonly');
    const store = tx.objectStore(SNAPTOAI_STORE_NAME);
    const request = store.get('selectedSnaps');
    const result = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result;
  } catch (e) {
    console.log('[SnapToAI] IndexedDB load failed:', e);
    return [];
  }
}

// ============ End IndexedDB ============

// === PREMIUM MULTI-LANGUAGE TTS ===
let synth = window.speechSynthesis;
let voices = [];
let voicesReady = false;

// Load voices with retry until ready
function loadVoices() {
  voices = synth.getVoices();
  if (voices.length > 0) {
    voicesReady = true;
    console.log('[SnapToAI] Loaded', voices.length, 'voices');
    // Log available languages for debugging
    const langs = [...new Set(voices.map(v => v.lang.split('-')[0]))];
    console.log('[SnapToAI] Available languages:', langs.join(', '));
  }
}
loadVoices();
if (speechSynthesis.onvoiceschanged !== undefined) {
  speechSynthesis.onvoiceschanged = loadVoices;
}

// Detect language from text
function detectLanguage(text) {
  // Arabic characters (strong indicator)
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  // Chinese characters
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  // Japanese (hiragana/katakana)
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja';
  // Korean
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  // Russian/Cyrillic
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  // French - accents or common words (expanded)
  if (/[àâäéèêëïîôùûüçœæ]/i.test(text) || 
      /\b(bonjour|salut|merci|oui|non|je|tu|il|elle|nous|vous|ils|elles|le|la|les|un|une|de|du|des|et|est|sont|avec|pour|dans|sur|que|qui|quoi|comment|pourquoi|bien|très|aussi|mais|comme|tout|cette|votre|notre)\b/i.test(text)) return 'fr';
  // Spanish
  if (/[ñ¿¡]/i.test(text) || 
      /\b(hola|gracias|buenos|buenas|el|la|los|las|de|del|en|es|son|con|para|por|como|pero|más|qué|cómo|muy|bien|todo|esta|este)\b/i.test(text)) return 'es';
  // German
  if (/[äöüß]/i.test(text) || 
      /\b(guten|danke|bitte|der|die|das|und|ist|sind|mit|für|auf|bei|nach|von|haben|werden|können|müssen)\b/i.test(text)) return 'de';
  // Default English
  return 'en';
}

// Wait for voices then speak
function speakText(text, langCode = null) {
  synth.cancel(); // Stop any existing speech
  
  // Always refresh voices
  voices = synth.getVoices();
  
  const utterance = new SpeechSynthesisUtterance(text);
  
  // Auto-detect language if not provided
  const detectedLang = langCode || detectLanguage(text);
  console.log('[SnapToAI] Detected language:', detectedLang);
  
  // Find voice matching the language
  let bestVoice = null;
  
  if (detectedLang === 'ar') {
    // Arabic: look for Google Arabic or any Arabic voice
    bestVoice = voices.find(v => v.lang.startsWith('ar') && v.name.includes('Google')) ||
                voices.find(v => v.lang.startsWith('ar')) ||
                voices.find(v => v.name.toLowerCase().includes('arabic'));
  } else if (detectedLang === 'fr') {
    // French: look for Google French or any French voice
    bestVoice = voices.find(v => v.lang.startsWith('fr') && v.name.includes('Google')) ||
                voices.find(v => v.lang.startsWith('fr')) ||
                voices.find(v => v.name.toLowerCase().includes('french') || v.name.toLowerCase().includes('français'));
  } else if (detectedLang === 'es') {
    bestVoice = voices.find(v => v.lang.startsWith('es') && v.name.includes('Google')) ||
                voices.find(v => v.lang.startsWith('es'));
  } else if (detectedLang === 'de') {
    bestVoice = voices.find(v => v.lang.startsWith('de') && v.name.includes('Google')) ||
                voices.find(v => v.lang.startsWith('de'));
  } else if (detectedLang === 'zh') {
    bestVoice = voices.find(v => v.lang.startsWith('zh') && v.name.includes('Google')) ||
                voices.find(v => v.lang.startsWith('zh'));
  } else if (detectedLang === 'ja') {
    bestVoice = voices.find(v => v.lang.startsWith('ja') && v.name.includes('Google')) ||
                voices.find(v => v.lang.startsWith('ja'));
  } else if (detectedLang === 'ko') {
    bestVoice = voices.find(v => v.lang.startsWith('ko') && v.name.includes('Google')) ||
                voices.find(v => v.lang.startsWith('ko'));
  } else if (detectedLang === 'ru') {
    bestVoice = voices.find(v => v.lang.startsWith('ru') && v.name.includes('Google')) ||
                voices.find(v => v.lang.startsWith('ru'));
  } else {
    // English fallback
    bestVoice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google')) ||
                voices.find(v => v.lang.startsWith('en'));
  }

  if (bestVoice) {
    utterance.voice = bestVoice;
    utterance.lang = bestVoice.lang;
    console.log(`[SnapToAI] Using voice: ${bestVoice.name} (${bestVoice.lang})`);
  } else {
    // Set language even without a specific voice - browser may still render
    utterance.lang = detectedLang;
    console.log(`[SnapToAI] No voice found for ${detectedLang}, using browser default`);
  }

  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  
  return utterance;
}

let currentImages = []; // Support multiple images
let currentPageText = '';
let conversationHistory = [];
let filesQueue = []; // Multi-file upload queue (Gemini-style)

// Get config from prompts.js (user-editable) or use defaults
const getConfig = (key, defaultVal) => (window.SNAPTOAI_CONFIG && window.SNAPTOAI_CONFIG[key]) || defaultVal;

const AI_MODES = {
  'vision': {
    model: 'gemini-3-flash-preview',
    type: 'gemini',
    placeholder: 'Ask about your screenshot...',
    welcome: "I'm your AI vision partner. Snap a screenshot and ask me anything!"
  },
  'image': {
    model: 'gemini-3-flash-preview',
    type: 'gemini-image',
    placeholder: 'Describe the image you want to create...',
    welcome: '🎨 Image mode — describe what you want and I\'ll create it!'
  },
  'music': {
    model: 'lyria-3-clip-preview',
    type: 'gemini-audio',
    placeholder: 'Describe the music you want (mood, genre, tempo)...',
    welcome: '🎵 Music mode — describe the vibe and I\'ll compose it!'
  },
  'video': {
    model: 'veo-3.0-generate-001',
    type: 'gemini-video',
    placeholder: 'Describe the video you want to create...',
    welcome: '🎬 Video mode — describe a scene and I\'ll bring it to life!'
  }
};

let currentAiMode = 'vision';

function getSelectedModel() {
  return AI_MODES['vision'].model;
}

function getCurrentModeModel() {
  return AI_MODES[currentAiMode]?.model || AI_MODES['vision'].model;
}

const MODE_COLORS = {
  'vision': 'rgba(0,217,255,0.06)',
  'image': 'rgba(255,107,237,0.06)',
  'music': 'rgba(0,255,136,0.06)',
  'video': 'rgba(255,165,0,0.06)'
};

const MODEL_NAMES = {
  'vision': { name: 'Gemini 3', sub: 'Flash (Preview)', color: '#00d9ff' },
  'image': { name: 'Nano', sub: 'Banana', color: '#ff6bed' },
  'music': { name: 'Lyria', sub: '', color: '#00ff88' },
  'video': { name: 'Veo', sub: '', color: '#ffa500' }
};

function updateModelHeader(mode) {
  const logo = document.getElementById('modelLogo');
  if (!logo) return;
  const m = MODEL_NAMES[mode] || MODEL_NAMES['vision'];
  logo.innerHTML = `${m.name} ${m.sub ? `<span>${m.sub}</span>` : ''}`;
  logo.style.transition = 'opacity 0.2s';
  logo.style.opacity = '0';
  setTimeout(() => { logo.style.opacity = '1'; }, 50);
}

function initModeButtons() {
  const btns = document.querySelectorAll('.mode-btn');
  const inputEl = document.getElementById('chatInput');
  const modeBar = document.getElementById('modeBar');
  
  btns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.mode;
      if (mode === currentAiMode) return;

      if (mode !== 'vision') {
        try {
          const synced = await chrome.storage.sync.get(['geminiApiKey']);
          const local = await chrome.storage.local.get(['snaptoai_key_tier', 'snaptoai_key_tier_key']);
          const apiKey = synced.geminiApiKey;
          const tierMatchesKey = local.snaptoai_key_tier_key === apiKey;
          let isPrepaid = apiKey && tierMatchesKey && local.snaptoai_key_tier === 'prepaid';

          // Auto re-probe when cached verdict is missing/stale/free — the user may have
          // activated under older (buggy) probe logic that misclassified them.
          if (apiKey && !isPrepaid) {
            try {
              const fresh = await detectKeyTier(apiKey);
              await chrome.storage.local.set({
                snaptoai_key_tier: fresh,
                snaptoai_key_tier_key: apiKey,
                snaptoai_key_tier_ts: Date.now()
              });
              if (fresh === 'prepaid') {
                isPrepaid = true;
                showPromptToast('🎉 Prepaid plan re-verified — all AI features unlocked!', 3500);
              }
            } catch (_) {}
          }

          if (!apiKey || !isPrepaid) {
            const thread = document.getElementById('chatThread');
            if (thread) {
              const card = document.createElement('div');
              card.className = 'chat-bubble ai';
              card.style.cssText = 'background:transparent;padding:0;border:none;';
              card.innerHTML = apiKey ? buildUnlockCard(mode) : buildNeedKeyForPaidCard(mode);
              thread.appendChild(card);
              thread.scrollTop = thread.scrollHeight;
            }
            return;
          }
        } catch (_) {}
      }

      currentAiMode = mode;
      chrome.storage.sync.set({ geminiModel: mode });
      
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      btn.classList.add('switching');
      setTimeout(() => btn.classList.remove('switching'), 500);
      
      if (modeBar) modeBar.style.background = MODE_COLORS[mode] || MODE_COLORS['vision'];
      
      updateModelHeader(mode);
      
      const cfg = AI_MODES[mode];
      if (inputEl && cfg) {
        inputEl.style.transition = 'opacity 0.2s ease';
        inputEl.style.opacity = '0';
        setTimeout(() => {
          inputEl.placeholder = cfg.placeholder;
          inputEl.style.opacity = '1';
        }, 200);
      }
      
      const thread = document.getElementById('chatThread');
      if (thread) {
        const notice = document.createElement('div');
        notice.className = 'chat-bubble ai mode-switch-notice';
        notice.style.cssText = 'font-size: 12px; padding: 10px 16px; border-left: 3px solid; margin: 4px 0;';
        const borderColors = { 'vision': '#00d9ff', 'image': '#ff6bed', 'music': '#00ff88', 'video': '#ffa500' };
        notice.style.borderLeftColor = borderColors[mode] || '#00d9ff';
        notice.textContent = cfg.welcome;
        thread.appendChild(notice);
        
        if (mode === 'music') {
          showSongStudio(thread);
        }
        if (mode === 'image') {
          showImageStudio(thread);
        }
        if (mode === 'video') {
          showVideoStudio(thread);
        }
        
        thread.scrollTop = thread.scrollHeight;
      }
      
      if (inputEl) inputEl.focus();
    });
  });
  
  chrome.storage.sync.get('geminiModel').then(r => {
    const mode = r.geminiModel || 'vision';
    if (AI_MODES[mode]) {
      currentAiMode = mode;
      btns.forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
      });
      if (inputEl) inputEl.placeholder = AI_MODES[mode].placeholder;
      if (modeBar) modeBar.style.background = MODE_COLORS[mode] || MODE_COLORS['vision'];
      updateModelHeader(mode);
    }
  }).catch(() => {});
}

initModeButtons();

let isPrepaidKey = false;

function showPaidModes() {
  isPrepaidKey = true;
  const imageBtn = document.getElementById('imageModeBtn');
  const musicBtn = document.getElementById('musicModeBtn');
  const videoBtn = document.getElementById('videoModeBtn');
  if (imageBtn) imageBtn.style.display = '';
  if (musicBtn) musicBtn.style.display = '';
  if (videoBtn) videoBtn.style.display = '';
}

function hidePaidModes() {
  isPrepaidKey = false;
  const imageBtn = document.getElementById('imageModeBtn');
  const musicBtn = document.getElementById('musicModeBtn');
  const videoBtn = document.getElementById('videoModeBtn');
  if (imageBtn) imageBtn.style.display = 'none';
  if (musicBtn) musicBtn.style.display = 'none';
  if (videoBtn) videoBtn.style.display = 'none';

  if (currentAiMode !== 'vision') {
    currentAiMode = 'vision';
    chrome.storage.sync.set({ geminiModel: 'vision' });
    const btns = document.querySelectorAll('.mode-btn');
    btns.forEach(b => b.classList.toggle('active', b.dataset.mode === 'vision'));
    const inputEl = document.getElementById('chatInput');
    if (inputEl && AI_MODES['vision']) inputEl.placeholder = AI_MODES['vision'].placeholder;
    const modeBar = document.getElementById('modeBar');
    if (modeBar) modeBar.style.background = MODE_COLORS['vision'];
    updateModelHeader('vision');
  }
}

async function checkKeyTier() {
  try {
    const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
    const apiKey = keyResult.geminiApiKey;
    if (!apiKey) {
      hidePaidModes();
      console.log('[SnapToAI] No API key — Vision only (free proxy)');
      return;
    }
    const local = await chrome.storage.local.get(['snaptoai_key_tier', 'snaptoai_key_tier_key']);
    let tier = (local.snaptoai_key_tier_key === apiKey) ? local.snaptoai_key_tier : null;
    if (!tier) {
      tier = await detectKeyTier(apiKey);
      await chrome.storage.local.set({
        snaptoai_key_tier: tier,
        snaptoai_key_tier_key: apiKey,
        snaptoai_key_tier_ts: Date.now()
      });
    }
    if (tier === 'prepaid') {
      showPaidModes();
      console.log('[SnapToAI] Prepaid key detected — all modes enabled');
    } else {
      hidePaidModes();
      console.log('[SnapToAI] Free-tier key detected — Vision only');
    }
  } catch (e) {
    hidePaidModes();
    console.log('[SnapToAI] Key check error, defaulting to Vision only:', e.message);
  }
}

checkKeyTier();

function showImageStudio(thread) {
  const existing = thread.querySelector('.image-studio');
  if (existing) existing.remove();
  
  const studio = document.createElement('div');
  studio.className = 'chat-bubble ai image-studio';
  studio.style.cssText = 'padding: 0; margin: 8px 0; background: transparent; border: none; max-width: 100%; width: 100%;';
  
  studio.innerHTML = `
    <div style="background:linear-gradient(135deg, rgba(255,107,237,0.05), rgba(200,80,200,0.02));border:1px solid rgba(255,107,237,0.15);border-radius:14px;padding:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:20px;">🎨</span>
          <span style="font-size:14px;font-weight:700;color:#e8eef4;">Image Studio</span>
        </div>
        <button class="studio-surprise-btn" style="padding:6px 14px;border-radius:8px;border:1px solid rgba(255,107,237,0.25);background:rgba(255,107,237,0.06);color:#ff6bed;font-size:11px;font-weight:600;cursor:pointer;">🎲 Surprise Me</button>
      </div>
      <textarea class="studio-desc" placeholder="What do you want to create? Describe it here..." style="width:100%;box-sizing:border-box;height:48px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,107,237,0.15);border-radius:10px;padding:12px 14px;color:#e8eef4;font-size:13px;font-family:inherit;resize:none;outline:none;overflow:hidden;transition:border-color 0.2s;"></textarea>
      <button class="studio-create-btn" style="width:100%;padding:10px;border-radius:10px;border:none;background:linear-gradient(135deg,#ff6bed,#cc44bb);color:#fff;font-size:13px;font-weight:700;cursor:pointer;margin-top:10px;opacity:0.4;pointer-events:none;">🎨 Create Image</button>
    </div>
  `;
  
  thread.appendChild(studio);
  
  const descInput = studio.querySelector('.studio-desc');
  const createBtn = studio.querySelector('.studio-create-btn');
  
  descInput.addEventListener('input', () => {
    const hasText = descInput.value.trim().length > 0;
    createBtn.style.opacity = hasText ? '1' : '0.4';
    createBtn.style.pointerEvents = hasText ? 'auto' : 'none';
    descInput.style.height = '48px';
    descInput.style.height = Math.max(48, descInput.scrollHeight) + 'px';
  });
  descInput.addEventListener('focus', () => { descInput.style.borderColor = 'rgba(255,107,237,0.4)'; });
  descInput.addEventListener('blur', () => { descInput.style.borderColor = 'rgba(255,107,237,0.15)'; });
  
  createBtn.addEventListener('click', () => {
    const desc = descInput.value.trim();
    if (!desc) return;
    
    const prompt = `Generate an image: ${desc}. Make it high quality and professional. Do NOT include any text, words, or letters in the image.`;
    
    const inputEl = document.getElementById('chatInput');
    if (inputEl) {
      inputEl.value = prompt;
      const sendBtn = document.getElementById('sendBtn');
      if (sendBtn) sendBtn.click();
    }
    
    studio.style.opacity = '0.5';
    studio.style.pointerEvents = 'none';
  });
  
  const surpriseIdeas = [
    'A stunning mountain landscape at golden hour with purple and orange sky',
    'A cute golden retriever puppy wearing a tiny top hat',
    'Futuristic city skyline at night with neon lights, cyberpunk style',
    'A cozy coffee shop interior with warm lighting and rain outside',
    'An astronaut floating in space with Earth in the background',
    'A Japanese garden with cherry blossoms and a koi pond',
    'A majestic lion portrait in oil painting style',
    'A luxury sports car on a winding mountain road at sunset',
    'An underwater coral reef with colorful tropical fish',
    'A fantasy castle floating in the clouds with waterfalls'
  ];
  
  studio.querySelector('.studio-surprise-btn').addEventListener('click', () => {
    const idea = surpriseIdeas[Math.floor(Math.random() * surpriseIdeas.length)];
    descInput.value = idea;
    createBtn.style.opacity = '1';
    createBtn.style.pointerEvents = 'auto';
    studio.querySelector('.studio-surprise-btn').textContent = '🎲 Another!';
  });
}

let activeVideoPollTimer = null;

const VEO_MODELS = [
  { id: 'veo-3.1-generate-preview', label: '3.1', desc: 'Best quality', tier: 'top' },
  { id: 'veo-3.1-fast-generate-preview', label: '3.1 Fast', desc: 'Fast + great quality', tier: 'mid' },
  { id: 'veo-3.1-lite-generate-preview', label: '3.1 Lite', desc: 'Quick drafts', tier: 'lite' },
  { id: 'veo-3.0-generate-001', label: '3.0', desc: 'High quality', tier: 'mid' },
  { id: 'veo-3.0-fast-generate-001', label: '3.0 Fast', desc: 'Fast + good', tier: 'lite' },
  { id: 'veo-2.0-generate-001', label: '2.0', desc: 'Basic (needs billing)', tier: 'basic' }
];

// Real Google Veo pricing (Gemini API / Vertex AI public rates, USD per second of video).
// Source: https://ai.google.dev/gemini-api/docs/pricing  &  https://cloud.google.com/vertex-ai/generative-ai/pricing
const VEO_PRICING = {
  'veo-3.1-generate-preview':      0.40,  // Veo 3.1 (with audio)
  'veo-3.1-fast-generate-preview': 0.15,  // Veo 3.1 Fast
  'veo-3.1-lite-generate-preview': 0.10,  // Veo 3.1 Lite
  'veo-3.0-generate-001':          0.75,  // Veo 3 (with audio)
  'veo-3.0-fast-generate-001':     0.40,  // Veo 3 Fast (with audio)
  'veo-2.0-generate-001':          0.50   // Veo 2 (no audio)
};

// Veo negative prompt — sent via parameters.negativePrompt INSTEAD of being
// pasted into the prompt body. Inline negation ("no text, no captions...")
// is a documented Veo anti-pattern: it primes the text-rendering head on the
// very tokens we want to suppress, increasing the chance of garbled writing
// in the frame. The dedicated parameter routes through a separate
// suppression head and works far better in practice.
const VEO_NEGATIVE_PROMPT = 'on-screen text, subtitles, captions, watermarks, logos, lower thirds, gibberish writing, distorted faces, extra limbs, blurry';

// Lyria music pricing (Vertex AI, USD per second of audio).
const LYRIA_PRICING = {
  'lyria-3-clip-preview': 0.06,  // Lyria 3 (preview)
  'lyria-3-pro-preview':  0.10,  // Lyria 3 Pro (preview, higher fidelity)
  'gemini-2.5-flash-preview-tts': 0.015 // TTS fallback (not real music)
};
const LYRIA_MODELS_DISPLAY = [
  { id: 'lyria-3-clip-preview', label: 'Lyria 3', desc: 'Default music model' },
  { id: 'lyria-3-pro-preview',  label: 'Lyria 3 Pro', desc: 'Higher-fidelity (fallback)' },
  { id: 'gemini-2.5-flash-preview-tts', label: 'Gemini TTS', desc: 'Voice fallback (not music)' }
];

let selectedVeoModel = 'veo-3.1-lite-generate-preview';
let selectedVideoDuration = 8;
let selectedClipCount = 1;
let userAvailableVeoModels = [];
let selectedMusicModel = 'lyria-3-clip-preview';

function showVideoStudio(thread) {
  const existing = thread.querySelector('.video-studio');
  if (existing) existing.remove();

  const studio = document.createElement('div');
  studio.className = 'chat-bubble ai video-studio';
  studio.style.cssText = 'padding: 0; margin: 8px 0; background: transparent; border: none; max-width: 100%; width: 100%;';

  const hasScreenshots = typeof currentImages !== 'undefined' && currentImages.length > 0;

  studio.innerHTML = `
    <div style="background:linear-gradient(135deg, rgba(255,165,0,0.05), rgba(200,120,0,0.02));border:1px solid rgba(255,165,0,0.15);border-radius:14px;padding:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:20px;">🎬</span>
          <span style="font-size:14px;font-weight:700;color:#e8eef4;">Video Studio</span>
        </div>
        <button class="studio-surprise-btn" style="padding:6px 14px;border-radius:8px;border:1px solid rgba(255,165,0,0.25);background:rgba(255,165,0,0.06);color:#ffa500;font-size:11px;font-weight:600;cursor:pointer;">🎲 Surprise Me</button>
      </div>
      <div class="veo-model-selector" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
        <span style="font-size:11px;color:#667788;width:100%;margin-bottom:2px;">Quality:</span>
        <span class="veo-models-loading" style="font-size:11px;color:#8899aa;">Checking available models...</span>
      </div>
      <div class="veo-duration-selector" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;align-items:center;">
        <span style="font-size:11px;color:#667788;width:100%;margin-bottom:2px;">Length:</span>
        <button class="veo-dur-btn selected" data-dur="8" style="padding:4px 12px;border-radius:8px;border:1px solid rgba(255,165,0,0.5);background:rgba(255,165,0,0.15);color:#ffa500;font-size:11px;font-weight:600;cursor:default;">8s per clip</button>
        <span style="font-size:10px;color:#667788;font-style:italic;">Veo's native length — best quality &amp; fewest visual cuts.</span>
      </div>
      <div class="veo-clips-selector" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
        <span style="font-size:11px;color:#667788;width:100%;margin-bottom:2px;">Clips (auto-stitched):</span>
        <button class="veo-clip-btn selected" data-clips="1" style="padding:4px 10px;border-radius:8px;border:1px solid rgba(255,165,0,0.5);background:rgba(255,165,0,0.15);color:#ffa500;font-size:11px;font-weight:600;cursor:pointer;">1x · 8s</button>
        <button class="veo-clip-btn" data-clips="2" style="padding:4px 10px;border-radius:8px;border:1px solid rgba(255,165,0,0.2);background:rgba(255,165,0,0.04);color:#aabbcc;font-size:11px;font-weight:600;cursor:pointer;">2x · 16s</button>
        <button class="veo-clip-btn" data-clips="3" style="padding:4px 10px;border-radius:8px;border:1px solid rgba(255,165,0,0.2);background:rgba(255,165,0,0.04);color:#aabbcc;font-size:11px;font-weight:600;cursor:pointer;">3x · 24s</button>
        <button class="veo-clip-btn" data-clips="4" style="padding:4px 10px;border-radius:8px;border:1px solid rgba(255,165,0,0.2);background:rgba(255,165,0,0.04);color:#aabbcc;font-size:11px;font-weight:600;cursor:pointer;" title="4×8s = 32s, perfect for Reels &amp; TikTok">4x · 32s 🎬</button>
        <span style="font-size:10px;color:#667788;width:100%;margin-top:2px;font-style:italic;">Capped at 4 — 32s lands in the engagement sweet spot for Reels, TikTok &amp; Shorts.</span>
      </div>
      <textarea class="studio-desc" placeholder="Describe the video scene you want to create..." style="width:100%;box-sizing:border-box;height:48px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,165,0,0.15);border-radius:10px;padding:12px 14px;color:#e8eef4;font-size:13px;font-family:inherit;resize:none;outline:none;overflow:hidden;transition:border-color 0.2s;margin-bottom:8px;"></textarea>
      ${hasScreenshots ? `
      <div style="margin-top:10px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:#aabbcc;">
          <input type="checkbox" class="studio-use-screenshot" style="accent-color:#ffa500;" checked>
          <span>📸 Use loaded screenshot as starting frame</span>
        </label>
        <div class="studio-stylize-wrap" style="margin-top:6px;margin-left:24px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:#aabbcc;">
            <input type="checkbox" class="studio-stylize-photo" style="accent-color:#ff69b4;" checked>
            <span>🎨 Stylize photo first (bypasses safety filters for people)</span>
          </label>
          <div class="stylize-style-selector" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">
            <button class="stylize-btn selected" data-style="pixar" style="padding:3px 10px;border-radius:6px;border:1px solid rgba(255,105,180,0.5);background:rgba(255,105,180,0.15);color:#ff69b4;font-size:10px;font-weight:600;cursor:pointer;">Pixar 3D</button>
            <button class="stylize-btn" data-style="anime" style="padding:3px 10px;border-radius:6px;border:1px solid rgba(255,105,180,0.2);background:rgba(255,105,180,0.04);color:#aabbcc;font-size:10px;font-weight:600;cursor:pointer;">Anime</button>
            <button class="stylize-btn" data-style="cartoon" style="padding:3px 10px;border-radius:6px;border:1px solid rgba(255,105,180,0.2);background:rgba(255,105,180,0.04);color:#aabbcc;font-size:10px;font-weight:600;cursor:pointer;">Cartoon</button>
            <button class="stylize-btn" data-style="watercolor" style="padding:3px 10px;border-radius:6px;border:1px solid rgba(255,105,180,0.2);background:rgba(255,105,180,0.04);color:#aabbcc;font-size:10px;font-weight:600;cursor:pointer;">Watercolor</button>
            <button class="stylize-btn" data-style="oil" style="padding:3px 10px;border-radius:6px;border:1px solid rgba(255,105,180,0.2);background:rgba(255,105,180,0.04);color:#aabbcc;font-size:10px;font-weight:600;cursor:pointer;">Oil Paint</button>
          </div>
        </div>
      </div>` : ''}
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
        <span style="font-size:10px;color:#667788;">⏱ ~1-2 min per clip</span>
        <span style="font-size:10px;color:#667788;">•</span>
        <span class="studio-dur-label" style="font-size:10px;color:#667788;">8s total</span>
      </div>
      <div class="veo-price-card" style="margin-top:10px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,165,0,0.12);border-radius:10px;padding:10px 12px;">
        <div style="font-size:10px;color:#667788;margin-bottom:6px;">💰 Pay-per-use (billed by Google to your own API key) — current cost per model:</div>
        <div class="veo-price-rows" style="display:flex;flex-direction:column;gap:3px;font-size:11px;">
          <span style="color:#667788;">Loading model prices…</span>
        </div>
      </div>
      <button class="studio-create-btn" style="width:100%;padding:10px;border-radius:10px;border:none;background:linear-gradient(135deg,#ffa500,#cc8400);color:#fff;font-size:13px;font-weight:700;cursor:pointer;margin-top:8px;opacity:0.4;pointer-events:none;">🎬 Generate Video</button>
    </div>
  `;

  thread.appendChild(studio);

  const descInput = studio.querySelector('.studio-desc');
  const createBtn = studio.querySelector('.studio-create-btn');

  descInput.addEventListener('input', () => {
    const hasText = descInput.value.trim().length > 0;
    createBtn.style.opacity = hasText ? '1' : '0.4';
    createBtn.style.pointerEvents = hasText ? 'auto' : 'none';
    descInput.style.height = '48px';
    descInput.style.height = Math.max(48, descInput.scrollHeight) + 'px';
  });
  descInput.addEventListener('focus', () => { descInput.style.borderColor = 'rgba(255,165,0,0.4)'; });
  descInput.addEventListener('blur', () => { descInput.style.borderColor = 'rgba(255,165,0,0.15)'; });

  function updateDurLabel() {
    const durLabel = studio.querySelector('.studio-dur-label');
    const total = selectedVideoDuration * selectedClipCount;
    if (durLabel) durLabel.textContent = selectedClipCount > 1 ? `${total}s total (${selectedClipCount} x ${selectedVideoDuration}s)` : `${total}s total`;
    renderVeoPriceTable(studio);
  }

  studio.querySelectorAll('.veo-dur-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      studio.querySelectorAll('.veo-dur-btn').forEach(b => {
        b.style.border = '1px solid rgba(255,165,0,0.2)';
        b.style.background = 'rgba(255,165,0,0.04)';
        b.style.color = '#aabbcc';
        b.classList.remove('selected');
      });
      btn.style.border = '1px solid rgba(255,165,0,0.5)';
      btn.style.background = 'rgba(255,165,0,0.15)';
      btn.style.color = '#ffa500';
      btn.classList.add('selected');
      selectedVideoDuration = parseInt(btn.dataset.dur);
      updateDurLabel();
    });
  });

  studio.querySelectorAll('.veo-clip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      studio.querySelectorAll('.veo-clip-btn').forEach(b => {
        b.style.border = '1px solid rgba(255,165,0,0.2)';
        b.style.background = 'rgba(255,165,0,0.04)';
        b.style.color = '#aabbcc';
        b.classList.remove('selected');
      });
      btn.style.border = '1px solid rgba(255,165,0,0.5)';
      btn.style.background = 'rgba(255,165,0,0.15)';
      btn.style.color = '#ffa500';
      btn.classList.add('selected');
      selectedClipCount = parseInt(btn.dataset.clips);
      updateDurLabel();
    });
  });

  renderVeoPriceTable(studio);

  let selectedStylizeStyle = 'pixar';

  const useScreenshotCb = studio.querySelector('.studio-use-screenshot');
  const stylizeWrap = studio.querySelector('.studio-stylize-wrap');
  if (useScreenshotCb && stylizeWrap) {
    useScreenshotCb.addEventListener('change', () => {
      stylizeWrap.style.display = useScreenshotCb.checked ? 'block' : 'none';
    });
  }

  studio.querySelectorAll('.stylize-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      studio.querySelectorAll('.stylize-btn').forEach(b => {
        b.style.border = '1px solid rgba(255,105,180,0.2)';
        b.style.background = 'rgba(255,105,180,0.04)';
        b.style.color = '#aabbcc';
        b.classList.remove('selected');
      });
      btn.style.border = '1px solid rgba(255,105,180,0.5)';
      btn.style.background = 'rgba(255,105,180,0.15)';
      btn.style.color = '#ff69b4';
      btn.classList.add('selected');
      selectedStylizeStyle = btn.dataset.style;
    });
  });

  createBtn.addEventListener('click', async () => {
    const desc = descInput.value.trim();
    if (!desc) return;

    studio.style.opacity = '0.5';
    studio.style.pointerEvents = 'none';

    const stylizeCb = studio.querySelector('.studio-stylize-photo');
    const shouldStylize = useScreenshotCb?.checked && stylizeCb?.checked;
    if (shouldStylize) {
      chrome.storage.local.set({ _videoStylizeStyle: selectedStylizeStyle });
    } else {
      chrome.storage.local.remove('_videoStylizeStyle');
    }

    const inputEl = document.getElementById('chatInput');
    if (inputEl) {
      inputEl.value = desc;
      document.getElementById('sendBtn')?.click();
    }
  });

  loadAvailableVeoModels(studio);

  const surpriseIdeas = [
    'A drone shot sweeping over a misty mountain range at sunrise with golden light',
    'A timelapse of a flower blooming in a sun-drenched garden',
    'A slow-motion shot of ocean waves crashing on rocky cliffs at sunset',
    'A cinematic walk through a neon-lit cyberpunk city at night in the rain',
    'A cozy cabin in a snowy forest with smoke rising from the chimney',
    'A majestic eagle soaring over a vast canyon with dramatic clouds',
    'Northern lights dancing over a frozen lake with reflections',
    'A bustling Tokyo street crossing with lights and people in fast motion',
    'A submarine journey through a colorful coral reef with tropical fish',
    'A spaceship launching into a star-filled sky with engine trails'
  ];

  studio.querySelector('.studio-surprise-btn').addEventListener('click', () => {
    const idea = surpriseIdeas[Math.floor(Math.random() * surpriseIdeas.length)];
    descInput.value = idea;
    createBtn.style.opacity = '1';
    createBtn.style.pointerEvents = 'auto';
    studio.querySelector('.studio-surprise-btn').textContent = '🎲 Another!';
  });
}

async function loadAvailableVeoModels(studio) {
  const selector = studio.querySelector('.veo-model-selector');
  const loadingEl = studio.querySelector('.veo-models-loading');
  try {
    const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
    const apiKey = keyResult.geminiApiKey;
    if (!apiKey) {
      if (loadingEl) loadingEl.innerHTML = '<span style="color:#ff6b6b;font-size:11px;">Set your Gemini API key in settings to use Video mode</span>';
      return;
    }
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) {
      if (loadingEl) loadingEl.innerHTML = '<span style="color:#ff6b6b;font-size:11px;">Could not check models — verify your API key</span>';
      return;
    }
    const data = await resp.json();
    const allModels = data.models || [];
    const veoNames = allModels.filter(m => m.name && m.name.toLowerCase().includes('veo')).map(m => m.name.replace('models/', ''));

    userAvailableVeoModels = VEO_MODELS.filter(vm => veoNames.includes(vm.id));

    if (userAvailableVeoModels.length === 0) {
      if (loadingEl) loadingEl.remove();
      selector.insertAdjacentHTML('beforeend', buildUnlockCard('video'));
      return;
    }

    if (!userAvailableVeoModels.find(m => m.id === selectedVeoModel)) {
      selectedVeoModel = userAvailableVeoModels[0].id;
    }

    if (loadingEl) loadingEl.remove();
    const buttonsHtml = userAvailableVeoModels.map(m => {
      const isSelected = m.id === selectedVeoModel;
      return `<button class="veo-model-chip" data-model="${m.id}" title="${m.desc}" style="padding:5px 12px;border-radius:20px;border:1px solid ${isSelected ? 'rgba(255,165,0,0.6)' : 'rgba(255,165,0,0.2)'};background:${isSelected ? 'rgba(255,165,0,0.15)' : 'rgba(255,165,0,0.03)'};color:${isSelected ? '#ffa500' : '#8899aa'};font-size:11px;font-weight:${isSelected ? '700' : '500'};cursor:pointer;transition:all 0.2s;">${m.label}</button>`;
    }).join('');
    selector.insertAdjacentHTML('beforeend', buttonsHtml);

    selector.querySelectorAll('.veo-model-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        selectedVeoModel = chip.dataset.model;
        selector.querySelectorAll('.veo-model-chip').forEach(c => {
          const sel = c.dataset.model === selectedVeoModel;
          c.style.borderColor = sel ? 'rgba(255,165,0,0.6)' : 'rgba(255,165,0,0.2)';
          c.style.background = sel ? 'rgba(255,165,0,0.15)' : 'rgba(255,165,0,0.03)';
          c.style.color = sel ? '#ffa500' : '#8899aa';
          c.style.fontWeight = sel ? '700' : '500';
        });
        console.log(`[SnapToAI Video] Selected model: ${selectedVeoModel}`);
        renderVeoPriceTable(studio);
      });
    });

    renderVeoPriceTable(studio);
    console.log(`[SnapToAI Video] ${userAvailableVeoModels.length} Veo models available for user`);
  } catch (e) {
    if (loadingEl) loadingEl.innerHTML = '<span style="color:#ff6b6b;font-size:11px;">Could not load models</span>';
    console.log('[SnapToAI Video] Model check error:', e.message);
  }
}

function renderVeoPriceTable(studio) {
  if (!studio) return;
  const rowsEl = studio.querySelector('.veo-price-rows');
  if (!rowsEl) return;
  const list = (userAvailableVeoModels && userAvailableVeoModels.length > 0)
    ? userAvailableVeoModels
    : VEO_MODELS;
  const totalSec = (selectedVideoDuration || 8) * (selectedClipCount || 1);
  const html = list.map(m => {
    const rate = VEO_PRICING[m.id];
    if (rate == null) return '';
    const total = (rate * totalSec).toFixed(2);
    const isSelected = m.id === selectedVeoModel;
    const color = isSelected ? '#ffa500' : '#aabbcc';
    const weight = isSelected ? '700' : '500';
    const bg = isSelected ? 'rgba(255,165,0,0.08)' : 'transparent';
    const marker = isSelected ? '▸ ' : '  ';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 6px;border-radius:6px;background:${bg};color:${color};font-weight:${weight};">
      <span>${marker}Veo ${m.label}</span>
      <span style="font-variant-numeric:tabular-nums;">$${rate.toFixed(2)}/s · <strong>$${total}</strong></span>
    </div>`;
  }).filter(Boolean).join('');
  rowsEl.innerHTML = html + `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed rgba(255,165,0,0.15);font-size:10px;color:#667788;">Total = price/sec × ${totalSec}s (${selectedClipCount}×${selectedVideoDuration}s). Charged by Google to your own API key.</div>`;
}

async function stylizeImageForVideo(apiKey, imageData, style) {
  const stylePrompts = {
    pixar: 'Transform this photo into a Pixar/Disney 3D animated style. Keep the exact same people, poses, expressions, clothing, and background but render everything as high-quality 3D Pixar animation. Do not add any text or words.',
    anime: 'Transform this photo into beautiful Japanese anime style. Keep the exact same people, poses, expressions, clothing, and background but render everything as detailed anime art. Do not add any text or words.',
    cartoon: 'Transform this photo into a fun colorful cartoon style like a modern animated movie. Keep the exact same people, poses, expressions, clothing, and background. Do not add any text or words.',
    watercolor: 'Transform this photo into a beautiful watercolor painting. Keep the exact same people, poses, expressions, clothing, and background but render as soft watercolor art. Do not add any text or words.',
    oil: 'Transform this photo into a classic oil painting style. Keep the exact same people, poses, expressions, clothing, and background but render as rich oil painting art. Do not add any text or words.'
  };

  const cleanB64 = imageData.includes(',') ? imageData.split(',')[1] : imageData;
  let mimeType = 'image/png';
  if (imageData.startsWith('data:')) {
    const match = imageData.match(/^data:(image\/[a-zA-Z+]+);/);
    if (match) mimeType = match[1];
  }

  const models = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview', 'gemini-2.0-flash-exp'];
  let lastError = '';

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: stylePrompts[style] || stylePrompts.pixar },
              { inlineData: { mimeType: mimeType, data: cleanB64 } }
            ]
          }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE']
          }
        })
      });

      if (!resp.ok) {
        lastError = `${model}: ${resp.status}`;
        continue;
      }

      const data = await resp.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          const styledMime = part.inlineData.mimeType || 'image/png';
          return { base64: part.inlineData.data, mimeType: styledMime };
        }
      }
      lastError = `${model}: no image in response`;
    } catch (e) {
      lastError = `${model}: ${e.message}`;
    }
  }

  console.log(`[SnapToAI Video] Stylize failed: ${lastError}`);
  return null;
}

async function startVideoGeneration(prompt, thread) {
  const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
  const apiKey = keyResult.geminiApiKey;
  if (!apiKey) {
    addBubble('Please set your Gemini API key in settings to use video generation.', 'error');
    return;
  }

  const useScreenshot = document.querySelector('.studio-use-screenshot');
  const includeImage = useScreenshot && useScreenshot.checked && typeof currentImages !== 'undefined' && currentImages.length > 0;

  const modelName = selectedVeoModel || 'veo-3.1-fast-generate-preview';
  const clipCount = selectedClipCount || 1;
  const totalDur = selectedVideoDuration * clipCount;

  // ── HeyGen-style plan approval for multi-clip videos ──────────────
  // Build the storyboard FIRST and let the user approve it before any
  // Veo credits are charged. Single clips skip this step (low risk, no
  // continuity to coordinate). Cancelling here is free.
  let prebuiltScenes = null;
  let selectedAspectRatio = '16:9';
  if (clipCount > 1) {
    const planLoader = document.createElement('div');
    planLoader.className = 'chat-bubble ai';
    planLoader.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:18px;">📋</span>
        <span style="font-size:13px;color:#ffa500;">Drafting your ${clipCount}-clip storyboard so you can review it before we render...</span>
      </div>`;
    thread.appendChild(planLoader);
    thread.scrollTop = thread.scrollHeight;

    try {
      prebuiltScenes = await buildClipScenes(prompt, clipCount, apiKey, selectedVideoDuration);
    } catch (e) {
      console.warn('[veo plan] storyboard build failed:', e?.message || e);
    }
    planLoader.remove();

    if (!prebuiltScenes || prebuiltScenes.length !== clipCount) {
      const errBubble = document.createElement('div');
      errBubble.className = 'chat-bubble ai';
      errBubble.innerHTML = `<span style="color:#ff7777;">⚠ Could not draft a storyboard. Please try a more descriptive prompt.</span>`;
      thread.appendChild(errBubble);
      return;
    }

    const perSecond = VEO_PRICING[modelName] || 0;
    const estCostUsd = perSecond * totalDur;

    const heroImage = (includeImage && currentImages && currentImages[0]) ? currentImages[0] : null;
    const decision = await showPlanApprovalBubble({
      thread, scenes: prebuiltScenes, prompt, clipCount, modelName, totalDur, estCostUsd,
      clipDur: selectedVideoDuration, heroImage
    });
    if (!decision || !decision.approved) {
      const cancelBubble = document.createElement('div');
      cancelBubble.className = 'chat-bubble ai';
      cancelBubble.innerHTML = `<span style="color:#8899aa;">✕ Cancelled — no Veo credits were used. Refine your prompt and try again.</span>`;
      thread.appendChild(cancelBubble);
      thread.scrollTop = thread.scrollHeight;
      return;
    }
    // Apply user edits if they used the Edit/Save flow.
    if (decision.scenes && decision.scenes.length === clipCount) prebuiltScenes = decision.scenes;
    if (decision.aspectRatio) selectedAspectRatio = decision.aspectRatio;
  }

  const progressBubble = document.createElement('div');
  progressBubble.className = 'chat-bubble ai video-progress';

  if (clipCount === 1) {
    progressBubble.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <span style="font-size:18px;">🎬</span>
        <span style="font-size:13px;font-weight:600;color:#ffa500;">Rendering your video...</span>
      </div>
      <div style="font-size:12px;color:#8899aa;margin-bottom:6px;">Using ${modelName.replace(/-generate.*/, '')}</div>
      <div style="font-size:12px;color:#8899aa;margin-bottom:10px;">Generating ${selectedVideoDuration}s clip — usually takes 1-2 minutes. You can keep chatting!</div>
      <div class="video-progress-bar" style="width:100%;height:4px;background:rgba(255,165,0,0.1);border-radius:2px;overflow:hidden;">
        <div class="video-progress-fill" style="width:5%;height:100%;background:linear-gradient(90deg,#ffa500,#ffcc00);border-radius:2px;transition:width 0.5s ease;"></div>
      </div>
      <div class="video-progress-text" style="font-size:10px;color:#667788;margin-top:6px;">Starting...</div>
    `;
  } else {
    let clipsHtml = '';
    for (let i = 1; i <= clipCount; i++) {
      clipsHtml += `<div class="multi-clip-status" data-clip="${i}" style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <span style="font-size:12px;">🎞️</span>
        <span style="font-size:11px;color:#667788;">Clip ${i}/${clipCount}</span>
        <span class="clip-state" style="font-size:11px;color:#667788;">${i === 1 ? '⏳ Generating...' : '⏸️ Waiting...'}</span>
      </div>`;
    }
    progressBubble.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:18px;">🎬</span>
          <span style="font-size:13px;font-weight:600;color:#ffa500;">Rendering ${clipCount} clips → ${totalDur}s video</span>
        </div>
        <button class="veo-stop-btn" style="padding:5px 12px;border-radius:8px;border:1px solid rgba(255,107,107,0.5);background:rgba(255,107,107,0.1);color:#ff6b6b;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">⏹ Stop &amp; keep what I have</button>
      </div>
      <div style="font-size:12px;color:#8899aa;margin-bottom:6px;">Using ${modelName.replace(/-generate.*/, '')}</div>
      <div style="font-size:12px;color:#8899aa;margin-bottom:10px;">Generating ${clipCount} x ${selectedVideoDuration}s clips, then auto-stitching. This may take a few minutes.</div>
      ${clipsHtml}
      <div class="video-progress-bar" style="width:100%;height:4px;background:rgba(255,165,0,0.1);border-radius:2px;overflow:hidden;margin-top:8px;">
        <div class="video-progress-fill" style="width:2%;height:100%;background:linear-gradient(90deg,#ffa500,#ffcc00);border-radius:2px;transition:width 0.5s ease;"></div>
      </div>
      <div class="video-progress-text" style="font-size:10px;color:#667788;margin-top:6px;">Starting clip 1...</div>
    `;
  }

  thread.appendChild(progressBubble);
  thread.scrollTop = thread.scrollHeight;

  let stylizedImage = null;
  if (includeImage) {
    const styleData = await chrome.storage.local.get('_videoStylizeStyle');
    const stylizeStyle = styleData._videoStylizeStyle;
    chrome.storage.local.remove('_videoStylizeStyle');

    if (stylizeStyle && currentImages[0]) {
      const text = progressBubble.querySelector('.video-progress-text');
      if (text) text.textContent = '🎨 Stylizing your photo first...';
      console.log(`[SnapToAI Video] Stylizing image with style: ${stylizeStyle}`);

      stylizedImage = await stylizeImageForVideo(apiKey, currentImages[0], stylizeStyle);
      if (stylizedImage) {
        console.log('[SnapToAI Video] Photo stylized successfully');
        if (text) text.textContent = 'Photo stylized! Starting video...';
      } else {
        console.log('[SnapToAI Video] Stylize failed, using original image');
        if (text) text.textContent = 'Stylize failed, using original photo...';
      }
    }
  }

  if (clipCount === 1) {
    await generateSingleClip(prompt, apiKey, modelName, includeImage, progressBubble, thread, stylizedImage, selectedAspectRatio);
  } else {
    await generateMultiClip(prompt, apiKey, modelName, includeImage, clipCount, progressBubble, thread, stylizedImage, prebuiltScenes, selectedAspectRatio);
  }
}

async function generateSingleClip(prompt, apiKey, modelName, includeImage, progressBubble, thread, stylizedImage, aspectRatio) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predictLongRunning?key=${apiKey}`;

    const requestBody = {
      instances: [{ prompt: prompt }],
      parameters: {
        aspectRatio: aspectRatio || '16:9',
        sampleCount: 1,
        durationSeconds: selectedVideoDuration,
        negativePrompt: VEO_NEGATIVE_PROMPT
      }
    };

    if (includeImage && (stylizedImage || currentImages[0])) {
      if (stylizedImage) {
        requestBody.instances[0].image = { bytesBase64Encoded: stylizedImage.base64, mimeType: stylizedImage.mimeType };
      } else {
        const imgData = currentImages[0];
        const cleanB64 = imgData.includes(',') ? imgData.split(',')[1] : imgData;
        let mimeType = 'image/png';
        if (imgData.startsWith('data:')) {
          const match = imgData.match(/^data:(image\/[a-zA-Z+]+);/);
          if (match) mimeType = match[1];
        }
        requestBody.instances[0].image = { bytesBase64Encoded: cleanB64, mimeType: mimeType };
      }
    }

    console.log(`[SnapToAI Video] Starting generation with ${modelName}`);
    let resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    let data = await resp.json();

    // Defensive retry: some Veo variants don't accept the negativePrompt
    // parameter and reject with 400 INVALID_ARGUMENT. Strip it and retry
    // transparently so single-clip generation doesn't fail outright.
    if (!resp.ok && requestBody.parameters && requestBody.parameters.negativePrompt) {
      const lower = (data?.error?.message || '').toLowerCase();
      if (resp.status === 400 && lower.includes('negativeprompt')) {
        console.log(`[SnapToAI Video] Model ${modelName} rejected negativePrompt — retrying single-clip without it.`);
        delete requestBody.parameters.negativePrompt;
        try {
          resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          });
          data = await resp.json();
        } catch (npErr) {
          console.log('[SnapToAI Video] negativePrompt-stripped retry threw:', npErr.message);
        }
      }
    }

    if (!resp.ok) {
      const errorMsg = data.error?.message || `API error ${resp.status}`;
      console.log(`[SnapToAI Video] API error: ${errorMsg}`);
      let friendlyMsg = errorMsg;
      if (isBillingError(resp.status, errorMsg)) {
        progressBubble.innerHTML = buildUnlockCard('video');
        return;
      } else if (resp.status === 429 || errorMsg.toLowerCase().includes('rate') || errorMsg.toLowerCase().includes('quota') || errorMsg.toLowerCase().includes('exceeded')) {
        const modelLabelLookup = (VEO_MODELS.find(m => m.id === modelName) || {}).label;
        progressBubble.innerHTML = buildVeoRateLimitCard(modelLabelLookup ? `Veo ${modelLabelLookup}` : '');
        return;
      }
      progressBubble.innerHTML = `<div style="color:#ff6b6b;font-size:13px;"><span style="font-size:16px;">❌</span> ${friendlyMsg}</div>`;
      return;
    }

    const operationName = data.name;
    if (!operationName) {
      progressBubble.innerHTML = `<div style="color:#ff6b6b;font-size:13px;"><span style="font-size:16px;">❌</span> No operation ID returned. Try again.</div>`;
      return;
    }

    console.log(`[SnapToAI Video] Job started: ${operationName}`);
    pollVideoStatus(operationName, apiKey, progressBubble, thread);

  } catch (err) {
    console.log(`[SnapToAI Video] Error:`, err.message);
    progressBubble.innerHTML = `<div style="color:#ff6b6b;font-size:13px;"><span style="font-size:16px;">❌</span> Connection failed — please check your internet and try again.</div>`;
  }
}

// ============================================================================
// PER-CLIP VEO GENERATION — extracted so the multi-clip batch loop AND the
// per-clip "Retry just this one" buttons can both call it.
//
// Returns: { url, status, billingAbort }
//   - url: video URL on success, null otherwise
//   - status: phase-explicit final state (see status taxonomy below)
//   - billingAbort: true → caller should stop the whole batch (billing problem)
//
// Status taxonomy:
//   success
//   rate_limit_prestart_skipped, transient_prestart_skipped  (FREE — no job started)
//   no_op_id_ambiguous_skipped                               (UNKNOWN billing)
//   timeout_skipped, job_error_skipped, no_uri_skipped, rate_limit_skipped,
//   transient_skipped, safety_blocked_skipped                (job started, MAY be billed)
// ============================================================================
async function generateOneVeoClip(clipIdx, ctx) {
  const { prompt, apiKey, modelName, includeImage, clipCount, clipScenes,
          stylizedImage, progressBubble, durationSeconds, sourceImageForClip0 } = ctx;
  const clipNum = clipIdx + 1;
  const statusEl = progressBubble.querySelector(`.multi-clip-status[data-clip="${clipNum}"] .clip-state`);
  const fill = progressBubble.querySelector('.video-progress-fill');
  const text = progressBubble.querySelector('.video-progress-text');

  if (statusEl) { statusEl.textContent = '⏳ Generating...'; statusEl.style.color = '#ffa500'; }
  if (text) text.textContent = `Generating clip ${clipNum} of ${clipCount}...`;

  const MAX_RATE_RETRIES_POST = 4;
  const MAX_FULL_CYCLE_RETRIES = 2;
  let cycleAttempt = 0;
  let finalStatus = 'unknown';

  while (cycleAttempt < MAX_FULL_CYCLE_RETRIES) {
    cycleAttempt++;

    // Early guard: if user pressed Stop after the batch loop already
    // committed to this clip, bail out before a billable POST is sent.
    if (ctx.userStopped) { finalStatus = 'user_stopped_skipped'; break; }

    // ---- PHASE 1: kick off the Veo job (with pre-job rate-limit retries) ----
    let resp, data, errorMsg = '';
    let postRateRetry = 0;

    while (true) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predictLongRunning?key=${apiKey}`;

        // v2.4.9 VISUAL CHAINING: for clip N>0, JIT-refresh the previous
        // clip's last frame, then attach it as instances[0].image so Veo
        // generates the next clip starting from that exact frame.
        // This ALSO injects a continuity prefix into the text prompt so the
        // storyboard can't override the image (e.g. "cut to wide aerial").
        let attachedChainImage = null;
        if (clipIdx > 0) {
          await refreshTransitionFrame(ctx, clipIdx - 1);
          const prevFrame = Array.isArray(ctx.transitionFrames) && ctx.transitionFrames[clipIdx - 1];
          if (prevFrame && prevFrame.base64) {
            attachedChainImage = prevFrame;
          }
        }

        let scenePrompt = clipScenes[clipIdx] || prompt;
        // When an image is attached, Veo already conditions on that exact
        // frame. Restating "keep the same character / lighting / lens" in
        // 50+ words of English (a) wastes ~50 tokens of attention budget,
        // (b) pushes the user's actual scene description ~9 lines down, and
        // (c) contradicts the per-segment shot text. A single short tag
        // preserves intent without dominating the prompt.
        if (attachedChainImage) {
          scenePrompt = `This shot continues directly from the attached starting frame. ${scenePrompt}`;
        }

        const requestBody = {
          instances: [{ prompt: scenePrompt }],
          parameters: {
            aspectRatio: ctx.aspectRatio || '16:9',
            sampleCount: 1,
            durationSeconds: durationSeconds,
            negativePrompt: VEO_NEGATIVE_PROMPT
          }
        };

        // Use the SNAPSHOTTED image from batch start — never re-read globals,
        // so retrying clip 0 always uses the same input the original batch used.
        if (clipIdx === 0 && includeImage && sourceImageForClip0) {
          requestBody.instances[0].image = {
            bytesBase64Encoded: sourceImageForClip0.base64,
            mimeType: sourceImageForClip0.mimeType
          };
        }

        if (attachedChainImage) {
          requestBody.instances[0].image = {
            bytesBase64Encoded: attachedChainImage.base64,
            mimeType: attachedChainImage.mimeType
          };
          const kb = Math.round(attachedChainImage.base64.length * 0.75 / 1024);
          console.log(`[SnapToAI Video] ✓ Clip ${clipNum} CHAINED to last frame of clip ${clipIdx} (model=${modelName}, image=${attachedChainImage.mimeType} ~${kb}KB) + continuity prefix`);
        } else if (clipIdx > 0) {
          console.log(`[SnapToAI Video] ✗ Clip ${clipNum} NOT chained — no previous frame available (text-only continuity, expect visual jump)`);
        } else if (requestBody.instances[0].image) {
          console.log(`[SnapToAI Video] ✓ Clip ${clipNum} starting from user-supplied screenshot (model=${modelName})`);
        } else {
          console.log(`[SnapToAI Video] Clip ${clipNum} text-only generation (model=${modelName})`);
        }

        resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });
        data = await resp.json().catch(() => ({}));
        errorMsg = (data?.error?.message) || '';

        // Defensive retry #1: some Veo model variants don't accept the
        // `negativePrompt` parameter and reject the entire request with
        // 400 INVALID_ARGUMENT. Strip it and retry transparently rather
        // than fail the clip. Cheap, idempotent, and isolated from the
        // image-reject path below.
        if (!resp.ok && requestBody.parameters && requestBody.parameters.negativePrompt) {
          const lower = errorMsg.toLowerCase();
          if (resp.status === 400 && lower.includes('negativeprompt')) {
            console.log(`[SnapToAI Video] Model ${modelName} rejected negativePrompt — retrying clip ${clipNum} without it.`);
            delete requestBody.parameters.negativePrompt;
            try {
              resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
              });
              data = await resp.json().catch(() => ({}));
              errorMsg = (data?.error?.message) || '';
            } catch (npErr) {
              console.log('[SnapToAI Video] negativePrompt-stripped retry threw:', npErr.message);
            }
          }
        }

        // v2.4.9: image-to-video unsupported by some Veo variants. If we
        // attached a transition frame and the model rejected it, fall back
        // ONCE to text-only continuity for this attempt instead of failing
        // the whole clip. We only do this when an image was actually attached.
        if (!resp.ok && requestBody.instances[0].image) {
          const lower = errorMsg.toLowerCase();
          const looksLikeImageReject =
            resp.status === 400 &&
            (lower.includes('image') || lower.includes('invalid_argument') ||
             lower.includes('unsupported') || lower.includes('not supported'));
          if (looksLikeImageReject) {
            console.log(`[SnapToAI Video] Model ${modelName} rejected image input — retrying clip ${clipNum} text-only.`);
            delete requestBody.instances[0].image;
            // CRITICAL: also strip the continuity prefix that referenced the
            // (now removed) starting frame — otherwise Veo will hallucinate
            // a "provided starting frame" that doesn't exist and produce
            // worse transitions than no chaining at all.
            requestBody.instances[0].prompt = clipScenes[clipIdx] || prompt;
            try {
              resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
              });
              data = await resp.json().catch(() => ({}));
              errorMsg = (data?.error?.message) || '';
            } catch (textOnlyErr) {
              console.log('[SnapToAI Video] Text-only fallback POST threw:', textOnlyErr.message);
            }
          }
        }

        const isRate = !resp.ok && (
          resp.status === 429 ||
          /rate|quota|exceeded|resource/.test(errorMsg.toLowerCase())
        );

        if (isRate && !isBillingError(resp.status, errorMsg) && postRateRetry < MAX_RATE_RETRIES_POST) {
          postRateRetry++;
          const waitSec = 65;
          if (statusEl) { statusEl.textContent = `⏳ Quota wait — ${waitSec}s (retry ${postRateRetry}/${MAX_RATE_RETRIES_POST})`; statusEl.style.color = '#ffd700'; }
          const completed = await cancellableWait(waitSec, ctx, (s) => {
            if (text) text.textContent = `Clip ${clipNum}/${clipCount} — Veo quota cooling down (${s}s) · retry ${postRateRetry}/${MAX_RATE_RETRIES_POST}`;
          });
          if (!completed) { finalStatus = 'user_stopped_skipped'; break; }
          if (statusEl) { statusEl.textContent = '⏳ Retrying...'; statusEl.style.color = '#ffa500'; }
          continue;
        }
        break;
      } catch (innerErr) {
        console.log('[SnapToAI Video] Clip POST threw:', innerErr.message);
        break;
      }
    }

    // ---- PHASE 2: classify POST outcome ----
    if (!resp || !resp.ok) {
      if (resp && isBillingError(resp.status, errorMsg)) {
        return { url: null, status: 'billing_blocked', billingAbort: true };
      }
      const isRate = resp && (resp.status === 429 || /rate|quota|exceeded|resource/.test(errorMsg.toLowerCase()));
      if (isRate) {
        finalStatus = 'rate_limit_prestart_skipped';
        if (cycleAttempt < MAX_FULL_CYCLE_RETRIES) continue;
        break;
      }
      if (cycleAttempt < MAX_FULL_CYCLE_RETRIES) {
        if (statusEl) { statusEl.textContent = `⚠ Network error — retrying (${cycleAttempt}/${MAX_FULL_CYCLE_RETRIES})`; statusEl.style.color = '#ffd700'; }
        const completed = await cancellableWait(15, ctx);
        if (!completed) { finalStatus = 'user_stopped_skipped'; break; }
        continue;
      }
      finalStatus = 'transient_prestart_skipped';
      break;
    }

    const operationName = data.name;
    if (!operationName) {
      if (cycleAttempt < MAX_FULL_CYCLE_RETRIES) {
        const completed = await cancellableWait(5, ctx);
        if (!completed) { finalStatus = 'user_stopped_skipped'; break; }
        continue;
      }
      finalStatus = 'no_op_id_ambiguous_skipped';
      break;
    }

    // ---- PHASE 3: poll for completion ----
    const result = await pollVideoStatusAsync(operationName, apiKey, progressBubble, clipNum, clipCount);

    if (result.status === 'success' && result.url) {
      if (statusEl) { statusEl.textContent = '✅ Done'; statusEl.style.color = '#00cc88'; }
      return { url: result.url, status: 'success', billingAbort: false };
    }

    if (result.status === 'safety_blocked') {
      finalStatus = 'safety_blocked_skipped';
      break;
    }

    if (cycleAttempt < MAX_FULL_CYCLE_RETRIES) {
      const waitSec = result.status === 'rate_limit' ? 65 : 20;
      if (statusEl) { statusEl.textContent = `⚠ ${result.status} — retrying (${cycleAttempt}/${MAX_FULL_CYCLE_RETRIES})`; statusEl.style.color = '#ffd700'; }
      const completed = await cancellableWait(waitSec, ctx, (s) => {
        if (text) text.textContent = `Clip ${clipNum}/${clipCount} ${result.status} — retrying in ${s}s...`;
      });
      // Stopped AFTER a Veo job already started → may be billed.
      if (!completed) { finalStatus = 'user_stopped_poststart_skipped'; break; }
      continue;
    }

    finalStatus = `${result.status}_skipped`;
    break;
  }

  if (statusEl) {
    statusEl.textContent = `⚠ Skipped (${finalStatus.replace('_skipped','')})`;
    statusEl.style.color = '#ffaa00';
  }
  return { url: null, status: finalStatus, billingAbort: false };
}

// ─────────────────────────────────────────────────────────────────
// VISUAL CONTINUITY ANCHORING
// Veo generates 8-second clips. Without shared visual anchors and
// explicit camera transitions, characters / lighting / setting drift
// between clips and the stitched video looks broken. We fix this by:
//   1) asking Gemini to expand the user prompt into a STYLE BIBLE
//      (characters, location, lighting, palette, camera language)
//      that is REPEATED at the top of every clip prompt, AND
//   2) writing each per-clip scene as a continuation of the previous
//      one ("camera glides from X, landing on Y") so Veo treats it as
//      one continuous take rather than 8 separate generations.
// Falls back to a heavily anchored template if Gemini is unreachable.
// ─────────────────────────────────────────────────────────────────

function buildAnchoredFallback(prompt, clipCount, clipDur) {
  const segLen = Number(clipDur) > 0 ? Number(clipDur) : 8;
  // The fallback used to (a) hard-code "Cinematic photoreal" — overriding
  // anime/8mm/claymation users; (b) burn an inline negative-prompt line that
  // primes Veo on the very tokens we want to suppress (now in the
  // negativePrompt parameter); (c) override every per-segment beat with a
  // generic phrase from a static 8-string array ("calm resolution, hold on
  // the scene") that often contradicted the user's request. The rewrite
  // keeps continuity rules (the actual point of the fallback) but lets the
  // user's literal brief drive every segment instead of canned beats.
  const anchor =
`[PRODUCTION RULES — APPLY TO EVERY SHOT]
- VISUAL CONSISTENCY IS MANDATORY across all ${clipCount} segments.
- Same characters, same wardrobe, same location, same lighting, same color palette in every shot.
- Smooth, intentional camera motion. No abrupt cuts.

[USER BRIEF]
${prompt}`;

  const shots = [];
  const prompts = Array.from({length: clipCount}, (_, i) => {
    const t0 = i * segLen, t1 = (i + 1) * segLen;
    // Per-segment beat keyed off the user's brief, not a canned array. Each
    // beat is phrased as "this segment of the user's request" so Veo sees
    // the user's actual subject in every clip prompt, not just clip 1.
    let beat;
    if (i === 0) {
      beat = `Opening shot — establish the scene from the user brief above.`;
    } else if (i === clipCount - 1) {
      beat = `Final shot — bring the scene from the user brief to a natural close.`;
    } else {
      beat = `Continuation of the user brief above — develop the action naturally without changing scene or characters.`;
    }
    shots.push(beat);
    const continuity = i === 0
      ? `This is the OPENING segment — establish the baseline scene. Lock in the characters, location, lighting, and color palette; every following segment will inherit from this shot.`
      : `This segment must visually continue from segment ${i}: identical characters, wardrobe, location, lighting, and color palette. No hard cuts, no scene changes, no new characters.`;
    return `${anchor}

[SEGMENT ${i + 1} of ${clipCount}  (${t0}-${t1}s)]
${beat}
${continuity}`;
  });
  prompts.meta = {
    title: (prompt || 'Your Video').split(/[.\n]/)[0].slice(0, 50).trim() || 'Your Video',
    script_summary: prompt,
    style_bible: `User brief (locked across every clip): ${prompt}. Same characters, location, lighting, and color palette in every shot.`,
    shots
  };
  return prompts;
}

// Ask Gemini to produce a continuity-anchored storyboard.
// Returns array of clip prompts on success, null on failure.
async function generateAnchoredStoryboard(prompt, clipCount, apiKey, clipDur) {
  if (!apiKey || clipCount < 2) return null;
  const segLen = Number(clipDur) > 0 ? Number(clipDur) : 8;

  const directorBrief =
`You are a film director planning a ${clipCount * segLen}-second cinematic video that will be rendered by Google Veo as ${clipCount} sequential ${segLen}-second clips, then stitched together.

The biggest failure mode is visual drift: characters change face, the location shifts, lighting jumps. Your job is to PREVENT that.

USER'S BRIEF (this is what they actually asked for — preserve every concrete subject and verb):
"""
${prompt}
"""

Return STRICT JSON ONLY (no markdown, no commentary) in this exact shape:
{
  "title": "A short punchy title for the video (max 6 words, title-case, no quotes).",
  "script_summary": "A single 1-2 sentence pitch describing what the viewer will experience. Stay faithful to the user brief — do not invent a different premise.",
  "style_bible": "A 3-5 sentence locked description of: main character(s) (only invent specifics like age/wardrobe if the user brief did NOT specify them — otherwise quote the brief verbatim), exact location, lighting setup, color palette, lens / camera style, mood. This text will be repeated verbatim at the top of every clip — be specific and unambiguous.",
  "clips": [
    { "shot": "What concretely happens in this ${segLen}s segment. Lead with the SUBJECT and ACTION from the user brief, then describe the camera. Keep the same characters, location, and lighting as every other clip." },
    ... exactly ${clipCount} entries ...
  ]
}

Rules:
- The clips must read like one continuous take, not ${clipCount} separate videos.
- The user's literal subject and action MUST appear in every clip's shot description — do not paraphrase them away.
- NEVER introduce new characters mid-sequence unless the user brief explicitly asks for it.
- NEVER cut to a different location.
- Keep each "shot" description under 60 words.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  // One attempt + one retry on parse failure. The retry uses a stricter
  // brief that explicitly demands valid JSON. A single failed parse used to
  // silently degrade to the (worse) anchored fallback template.
  async function callGemini(briefText, temperature) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: briefText }] }],
        // Lowered from 0.7 to 0.4 — at 0.7 Gemini invented details (character
        // ethnicity, location specifics) that drifted from the user's literal
        // brief. 0.4 keeps it close to the brief without going fully
        // deterministic.
        generationConfig: { temperature, responseMimeType: 'application/json' }
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    try { return JSON.parse(txt); }
    catch {
      const m = txt.match(/\{[\s\S]*\}/);
      if (!m) return null;
      try { return JSON.parse(m[0]); } catch { return null; }
    }
  }

  function isValidParse(parsed) {
    if (!parsed?.style_bible || !Array.isArray(parsed?.clips) || parsed.clips.length !== clipCount) return false;
    return parsed.clips.every(c => c && typeof c.shot === 'string' && c.shot.trim().length > 0);
  }

  try {
    let parsed = await callGemini(directorBrief, 0.4);
    if (!isValidParse(parsed)) {
      console.warn('[veo storyboard] first parse invalid, retrying with stricter brief');
      const stricter = directorBrief + `\n\nIMPORTANT: Your previous response was invalid. Return ONLY a single JSON object matching the schema above — no markdown fences, no preamble, no trailing text. The clips array MUST have exactly ${clipCount} entries.`;
      parsed = await callGemini(stricter, 0.3);
      if (!isValidParse(parsed)) return null;
    }

    const bible = String(parsed.style_bible).trim();
    const prompts = parsed.clips.map((c, i) => {
      const shot = String(c.shot).trim();
      const t0 = i * segLen, t1 = (i + 1) * segLen;
      const continuity = i === 0
        ? `This is the OPENING segment — establish the baseline scene exactly as the style bible describes. Every following segment will inherit these characters, wardrobe, location, lighting, and palette.`
        : `This segment must visually continue from segment ${i}: identical characters, wardrobe, location, lighting, and color palette. No hard cuts or new characters.`;
      // Echo the user's literal request at the top of every clip prompt so
      // Gemini's paraphrase can never fully orphan the user's actual
      // subject/verbs. The "STRICT DIRECTIVE" inline negation that used to
      // live below the style bible is now sent via the negativePrompt
      // parameter on the Veo call — see VEO_NEGATIVE_PROMPT.
      return `[USER ORIGINAL REQUEST]
${prompt}

[PRODUCTION RULES — APPLY TO EVERY SHOT]
${bible}

[SEGMENT ${i + 1} of ${clipCount}  (${t0}-${t1}s)]
${shot}
${continuity}`;
    });
    // Decorate the array with title / summary / bible for the preview card.
    prompts.meta = {
      title: typeof parsed.title === 'string' ? parsed.title.trim() : '',
      script_summary: typeof parsed.script_summary === 'string' ? parsed.script_summary.trim() : '',
      style_bible: bible,
      shots: parsed.clips.map(c => String(c.shot).trim())
    };
    return prompts;
  } catch (e) {
    console.warn('[veo storyboard] director call failed, falling back to template:', e?.message || e);
    return null;
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Show the storyboard plan + Edit / Generate buttons in a chat bubble.
// HeyGen-inspired card: hero image, title, two-column Script + Style,
// detail chips, scene timeline, expand for full breakdown.
// Resolves true (approved) / false (cancelled). Removes bubble on resolve.
function showPlanApprovalBubble({ thread, scenes, prompt, clipCount, modelName, totalDur, estCostUsd, clipDur, heroImage }) {
  return new Promise((resolve) => {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble ai video-plan-preview';
    bubble.style.cssText = 'padding:0;background:transparent;border:none;max-width:100%;';
    const segLen = Number(clipDur) > 0 ? Number(clipDur) : 8;

    // Mutable draft. We mutate it in edit mode and recompile scenes on Save.
    // Result resolved with { approved, scenes, aspectRatio } so the caller can
    // pick up edits & aspect-ratio choice when starting Veo.
    const meta = (scenes && scenes.meta) ? { ...scenes.meta } : {};
    const draft = {
      title: meta.title || 'Your Video',
      script_summary: meta.script_summary || prompt,
      style_bible: meta.style_bible || '',
      shots: (Array.isArray(meta.shots) && meta.shots.length === scenes.length) ? [...meta.shots] : scenes.map(() => ''),
      vibe: meta.vibe || '',
      aspectRatio: '16:9'
    };
    let editing = false;
    let liveScenes = scenes;  // recompiled on Save
    let draftSnapshot = null; // snapshot of draft taken on Edit, restored on Discard

    const modelShort = String(modelName || '').replace(/-generate.*/, '').replace(/-preview/, '');
    const costStr = (estCostUsd != null && !isNaN(estCostUsd)) ? `≈ $${estCostUsd.toFixed(2)}` : '';

    const VIBES = ['', 'Cinematic', 'Handheld documentary', 'Anime', 'Pixar 3D', 'Film noir', 'Commercial / corporate', 'Music video', 'Vintage 8mm'];

    const hero = heroImage
      ? `<img src="${escapeHtml(heroImage)}" alt="" style="width:100%;height:160px;object-fit:cover;display:block;">`
      : `<div style="width:100%;height:160px;background:
            radial-gradient(ellipse at 30% 20%, rgba(255,165,0,0.35), transparent 55%),
            radial-gradient(ellipse at 75% 80%, rgba(0,212,255,0.35), transparent 55%),
            linear-gradient(135deg,#1a1f2e,#0c1118);
            display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;">
            <div style="position:absolute;inset:0;background:repeating-linear-gradient(45deg,rgba(255,255,255,0.02) 0 2px,transparent 2px 12px);"></div>
            <div style="position:relative;text-align:center;">
              <div style="font-size:42px;line-height:1;margin-bottom:6px;filter:drop-shadow(0 4px 12px rgba(0,0,0,0.4));">🎬</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:2px;font-weight:600;">VEO STORYBOARD</div>
            </div>
          </div>`;

    const chip = (icon, label) =>
      `<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:999px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);font-size:11px;color:#cdd6e0;">${icon} ${escapeHtml(label)}</span>`;

    let expanded = false;

    function renderViewSceneCards() {
      return draft.shots.map((shot, i) => {
        const t0 = i * segLen, t1 = (i + 1) * segLen;
        return `<div style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:10px 12px;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:rgba(255,165,0,0.15);color:#ffa500;font-size:11px;font-weight:700;">${i + 1}</span>
            <span style="font-size:10px;color:#667788;letter-spacing:1px;font-weight:600;">SEGMENT · ${t0}-${t1}s</span>
          </div>
          <div style="font-size:12px;color:#cdd6e0;line-height:1.5;">${escapeHtml(shot)}</div>
        </div>`;
      }).join('');
    }

    function renderEditSceneCards() {
      return draft.shots.map((shot, i) => {
        const t0 = i * segLen, t1 = (i + 1) * segLen;
        return `<div style="background:rgba(255,165,0,0.04);border:1px solid rgba(255,165,0,0.25);border-radius:10px;padding:10px 12px;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:rgba(255,165,0,0.2);color:#ffa500;font-size:11px;font-weight:700;">${i + 1}</span>
            <span style="font-size:10px;color:#667788;letter-spacing:1px;font-weight:600;">SEGMENT · ${t0}-${t1}s</span>
          </div>
          <textarea data-shot-idx="${i}" rows="3" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:#e6ecf3;font-size:12px;line-height:1.5;font-family:inherit;resize:vertical;">${escapeHtml(shot)}</textarea>
        </div>`;
      }).join('');
    }

    function render() {
      const timelineDots = draft.shots.map((_, i) =>
        `<div style="flex:1;height:4px;background:linear-gradient(90deg,#ffa500,#ffcc00);border-radius:2px;${i < draft.shots.length - 1 ? 'margin-right:3px;' : ''}"></div>`
      ).join('');

      const titleBlock = editing
        ? `<input class="edit-title" type="text" value="${escapeHtml(draft.title)}" style="width:100%;box-sizing:border-box;font-size:18px;font-weight:700;color:#fff;background:rgba(0,0,0,0.3);border:1px solid rgba(255,165,0,0.3);border-radius:8px;padding:8px 10px;margin-bottom:14px;font-family:inherit;">`
        : `<h2 style="margin:0 0 14px 0;font-size:20px;font-weight:700;color:#fff;line-height:1.25;">${escapeHtml(draft.title)}</h2>`;

      const scriptStyleBlock = editing
        ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
            <div>
              <div style="font-size:10px;color:#ffa500;letter-spacing:1.2px;font-weight:700;margin-bottom:4px;">SCRIPT (1-line pitch)</div>
              <textarea class="edit-script" rows="4" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:6px;border:1px solid rgba(255,165,0,0.3);background:rgba(0,0,0,0.3);color:#e6ecf3;font-size:12px;line-height:1.5;font-family:inherit;resize:vertical;">${escapeHtml(draft.script_summary)}</textarea>
            </div>
            <div>
              <div style="font-size:10px;color:#ffa500;letter-spacing:1.2px;font-weight:700;margin-bottom:4px;">STYLE BIBLE (locked across every clip)</div>
              <textarea class="edit-style" rows="4" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:6px;border:1px solid rgba(255,165,0,0.3);background:rgba(0,0,0,0.3);color:#e6ecf3;font-size:12px;line-height:1.5;font-family:inherit;resize:vertical;">${escapeHtml(draft.style_bible)}</textarea>
            </div>
          </div>`
        : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
            <div>
              <div style="font-size:10px;color:#667788;letter-spacing:1.2px;font-weight:700;margin-bottom:4px;">SCRIPT</div>
              <div style="font-size:12px;color:#cdd6e0;line-height:1.5;">${escapeHtml(draft.script_summary)}</div>
            </div>
            <div>
              <div style="font-size:10px;color:#667788;letter-spacing:1.2px;font-weight:700;margin-bottom:4px;">STYLE</div>
              <div style="font-size:12px;color:#cdd6e0;line-height:1.5;">${escapeHtml(draft.style_bible)}</div>
            </div>
          </div>`;

      const editControls = editing
        ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:10px;color:#667788;letter-spacing:1.2px;font-weight:700;">VIBE</span>
              <select class="edit-vibe" style="padding:5px 8px;border-radius:6px;background:rgba(0,0,0,0.3);color:#e6ecf3;border:1px solid rgba(255,255,255,0.1);font-size:12px;">
                ${VIBES.map(v => `<option value="${escapeHtml(v)}" ${v === draft.vibe ? 'selected' : ''}>${v ? escapeHtml(v) : '— none —'}</option>`).join('')}
              </select>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:10px;color:#667788;letter-spacing:1.2px;font-weight:700;">ASPECT</span>
              <button class="edit-aspect" data-val="16:9" style="padding:5px 10px;border-radius:6px;border:1px solid ${draft.aspectRatio === '16:9' ? 'rgba(255,165,0,0.6)' : 'rgba(255,255,255,0.1)'};background:${draft.aspectRatio === '16:9' ? 'rgba(255,165,0,0.15)' : 'rgba(0,0,0,0.3)'};color:#e6ecf3;font-size:11px;font-weight:600;cursor:pointer;">16:9</button>
              <button class="edit-aspect" data-val="9:16" style="padding:5px 10px;border-radius:6px;border:1px solid ${draft.aspectRatio === '9:16' ? 'rgba(255,165,0,0.6)' : 'rgba(255,255,255,0.1)'};background:${draft.aspectRatio === '9:16' ? 'rgba(255,165,0,0.15)' : 'rgba(0,0,0,0.3)'};color:#e6ecf3;font-size:11px;font-weight:600;cursor:pointer;">9:16</button>
            </div>
          </div>`
        : '';

      const sceneSection = editing
        ? `<div style="padding:0 18px 14px;">
            <div style="font-size:10px;color:#ffa500;letter-spacing:1.2px;font-weight:700;margin:6px 0 8px;">🎞️ EDIT EACH SCENE (this is the real Veo prompt for that 8s clip)</div>
            ${renderEditSceneCards()}
          </div>`
        : `<div class="plan-expand-body" style="display:${expanded ? 'block' : 'none'};padding:0 18px 14px;">
            <div style="font-size:10px;color:#667788;letter-spacing:1.2px;font-weight:700;margin:6px 0 8px;">🎞️ SCENE-BY-SCENE BREAKDOWN</div>
            ${renderViewSceneCards()}
          </div>`;

      const toolbar = editing
        ? `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(255,165,0,0.25);background:rgba(255,165,0,0.06);">
            <span style="font-size:12px;color:#ffa500;font-weight:700;">✎ Editing plan</span>
            <div style="display:flex;gap:6px;">
              <button class="plan-discard-btn" style="padding:6px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.04);color:#cdd6e0;cursor:pointer;font-size:12px;font-weight:600;">Discard</button>
              <button class="plan-save-btn" style="padding:6px 16px;border-radius:8px;border:none;background:linear-gradient(135deg,#ffa500,#ff7700);color:#fff;cursor:pointer;font-size:12px;font-weight:700;">✓ Save</button>
            </div>
          </div>`
        : `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);">
            <button class="plan-expand-btn" style="background:none;border:none;color:#8899aa;font-size:12px;font-weight:600;cursor:pointer;padding:4px 0;">${expanded ? '▴ Collapse' : '▾ Expand'}</button>
            <div style="display:flex;gap:6px;">
              <button class="plan-cancel-btn" style="padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.04);color:#cdd6e0;cursor:pointer;font-size:12px;font-weight:600;">Cancel</button>
              <button class="plan-edit-btn" style="padding:6px 12px;border-radius:8px;border:1px solid rgba(255,165,0,0.4);background:rgba(255,165,0,0.1);color:#ffa500;cursor:pointer;font-size:12px;font-weight:700;">✎ Edit</button>
              <button class="plan-approve-btn" style="padding:6px 16px;border-radius:8px;border:none;background:linear-gradient(135deg,#00c878,#00a060);color:#fff;cursor:pointer;font-size:12px;font-weight:700;box-shadow:0 2px 8px rgba(0,200,120,0.3);">Generate</button>
            </div>
          </div>`;

      bubble.innerHTML = `
        <div style="background:#11151c;border:1px solid rgba(255,255,255,0.08);border-radius:14px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.4);font-family:inherit;">
          ${toolbar}
          ${hero}
          <div style="padding:16px 18px 14px;">
            ${titleBlock}
            ${scriptStyleBlock}
            ${editControls}
            <div style="display:flex;gap:4px;margin-bottom:12px;">${timelineDots}</div>
            <div style="font-size:10px;color:#667788;letter-spacing:1.2px;font-weight:700;margin-bottom:6px;">DETAILS</div>
            <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:4px;">
              ${chip('⏱', `${totalDur}s`)}
              ${chip('🎞', `${clipCount} clips`)}
              ${chip('📐', draft.aspectRatio)}
              ${chip('🎥', modelShort)}
              ${costStr ? chip('💳', `${costStr} on your key`) : ''}
            </div>
          </div>
          ${sceneSection}
          <div style="padding:10px 18px;border-top:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);font-size:10px;color:#667788;text-align:center;line-height:1.5;">
            ${editing
              ? 'Save to apply your edits — they will be sent to Veo verbatim.'
              : 'Cancel = no charge. Edit lets you tweak any field. Once you Generate, failed clips may still be billed by Google.'}
          </div>
        </div>
      `;

      wireEvents();
    }

    function wireEvents() {
      const expandBtn = bubble.querySelector('.plan-expand-btn');
      if (expandBtn) expandBtn.onclick = () => { expanded = !expanded; render(); thread.scrollTop = thread.scrollHeight; };

      const editBtn = bubble.querySelector('.plan-edit-btn');
      if (editBtn) editBtn.onclick = () => {
        // Snapshot the current draft (incl. aspect ratio) so Discard truly reverts.
        draftSnapshot = { ...draft, shots: [...draft.shots] };
        editing = true;
        render();
      };

      const discardBtn = bubble.querySelector('.plan-discard-btn');
      if (discardBtn) discardBtn.onclick = () => {
        if (draftSnapshot) {
          draft.title = draftSnapshot.title;
          draft.script_summary = draftSnapshot.script_summary;
          draft.style_bible = draftSnapshot.style_bible;
          draft.shots = [...draftSnapshot.shots];
          draft.vibe = draftSnapshot.vibe;
          draft.aspectRatio = draftSnapshot.aspectRatio;
        }
        draftSnapshot = null;
        editing = false;
        render();
      };

      const saveBtn = bubble.querySelector('.plan-save-btn');
      if (saveBtn) saveBtn.onclick = () => {
        const t = bubble.querySelector('.edit-title');
        const sc = bubble.querySelector('.edit-script');
        const st = bubble.querySelector('.edit-style');
        const vb = bubble.querySelector('.edit-vibe');
        if (t) draft.title = t.value.trim() || draft.title;
        if (sc) draft.script_summary = sc.value.trim();
        if (st) draft.style_bible = st.value.trim();
        if (vb) draft.vibe = vb.value;
        bubble.querySelectorAll('textarea[data-shot-idx]').forEach(ta => {
          const idx = parseInt(ta.dataset.shotIdx, 10);
          if (!isNaN(idx)) draft.shots[idx] = ta.value.trim();
        });
        // Recompile the actual prompts that go to Veo from the edited draft.
        liveScenes = recompileScenesFromMeta({
          title: draft.title,
          script_summary: draft.script_summary,
          style_bible: draft.style_bible,
          shots: [...draft.shots]
        }, clipCount, segLen, draft.vibe);
        editing = false;
        render();
      };

      bubble.querySelectorAll('.edit-aspect').forEach(b => {
        b.onclick = () => { draft.aspectRatio = b.dataset.val; render(); };
      });

      const cleanup = (decision) => {
        bubble.remove();
        resolve(decision);
      };
      const apv = bubble.querySelector('.plan-approve-btn');
      if (apv) apv.onclick = () => cleanup({ approved: true, scenes: liveScenes, aspectRatio: draft.aspectRatio });
      const cnl = bubble.querySelector('.plan-cancel-btn');
      if (cnl) cnl.onclick = () => cleanup({ approved: false });
    }

    thread.appendChild(bubble);
    render();
    thread.scrollTop = thread.scrollHeight;
  });
}

async function buildClipScenes(prompt, clipCount, apiKey, clipDur) {
  if (clipCount < 2) return [];
  const fromAI = await generateAnchoredStoryboard(prompt, clipCount, apiKey, clipDur);
  if (fromAI && fromAI.length === clipCount) {
    console.log(`[veo storyboard] using AI-generated style bible for ${clipCount} clips × ${clipDur || 8}s`);
    return fromAI;
  }
  console.log(`[veo storyboard] using anchored fallback template for ${clipCount} clips × ${clipDur || 8}s`);
  return buildAnchoredFallback(prompt, clipCount, clipDur);
}

// Compile one clip prompt from edited meta (used when user edits the plan card).
// Always includes the production rules + style bible + this segment's shot text.
function compileScenePrompt({ styleBible, vibe, shot, index, total, clipDur }) {
  const segLen = Number(clipDur) > 0 ? Number(clipDur) : 8;
  const t0 = index * segLen, t1 = (index + 1) * segLen;
  const vibeLine = vibe ? `Vibe: ${vibe}.` : '';
  const continuity = index === 0
    ? `This is the OPENING segment — establish the baseline scene exactly as the style bible describes. Every following segment will inherit these characters, wardrobe, location, lighting, and palette.`
    : `This segment must visually continue from segment ${index}: identical characters, wardrobe, location, lighting, and color palette. No hard cuts or new characters.`;
  // Inline "STRICT DIRECTIVE: zero on-screen text..." was removed — it's
  // now sent via parameters.negativePrompt on the Veo call (see
  // VEO_NEGATIVE_PROMPT). Inline negation primes the model on the very
  // tokens we want to suppress.
  return `[PRODUCTION RULES — APPLY TO EVERY SHOT]
${styleBible}
${vibeLine}

[SEGMENT ${index + 1} of ${total}  (${t0}-${t1}s)]
${shot}
${continuity}`;
}

// Recompile the full scenes array from current meta state.
// Returns a new array with .meta attached, ready to feed generateMultiClip.
function recompileScenesFromMeta(meta, clipCount, clipDur, vibe) {
  const out = [];
  for (let i = 0; i < clipCount; i++) {
    out.push(compileScenePrompt({
      styleBible: meta.style_bible || '',
      vibe: vibe || meta.vibe || '',
      shot: (meta.shots && meta.shots[i]) || '',
      index: i, total: clipCount, clipDur
    }));
  }
  out.meta = { ...meta, vibe: vibe || meta.vibe || '' };
  return out;
}

async function generateMultiClip(prompt, apiKey, modelName, includeImage, clipCount, progressBubble, thread, stylizedImage, prebuiltScenes, aspectRatio) {
  let clipScenes = prebuiltScenes;
  if (!clipScenes || clipScenes.length !== clipCount) {
    const progressText = progressBubble.querySelector('.video-progress-text');
    if (progressText) progressText.textContent = `Planning ${clipCount}-clip storyboard for visual continuity...`;
    clipScenes = await buildClipScenes(prompt, clipCount, apiKey, selectedVideoDuration);
  }
  // Index-based results so retry can replace any specific slot
  const clipResults = Array.from({length: clipCount}, (_, i) => ({ n: i + 1, status: 'pending', url: null }));

  // ---- SNAPSHOT immutable batch context so per-clip retries always use the
  // same inputs the original batch used, even if the user changes the
  // duration selector or the screenshot queue afterward. ----
  const durationSeconds = selectedVideoDuration;
  let sourceImageForClip0 = null;
  if (includeImage) {
    if (stylizedImage) {
      sourceImageForClip0 = { base64: stylizedImage.base64, mimeType: stylizedImage.mimeType };
    } else if (currentImages[0]) {
      const imgData = currentImages[0];
      const cleanB64 = imgData.includes(',') ? imgData.split(',')[1] : imgData;
      let mimeType = 'image/png';
      if (imgData.startsWith('data:')) {
        const match = imgData.match(/^data:(image\/[a-zA-Z+]+);/);
        if (match) mimeType = match[1];
      }
      sourceImageForClip0 = { base64: cleanB64, mimeType };
    }
  }

  const ctx = { prompt, apiKey, modelName, includeImage, clipCount, clipScenes,
                stylizedImage, progressBubble, thread, clipResults,
                durationSeconds, sourceImageForClip0,
                aspectRatio: aspectRatio || '16:9',
                retryInFlight: false, billingAbortAt: -1,
                userStopped: false,
                // v2.4.9: cache of last-frame images, indexed by clip idx.
                // transitionFrames[i] = last frame of clip i, used as the
                // starting image for clip i+1 to enforce visual continuity.
                transitionFrames: [] };

  // Wire the Stop button. Sets a flag that all wait loops + the batch loop
  // observe; the user keeps every clip already rendered, no further Veo
  // requests are sent, and we render the partial outcome immediately.
  const stopBtn = progressBubble.querySelector('.veo-stop-btn');
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      if (ctx.userStopped) return;
      ctx.userStopped = true;
      stopBtn.textContent = '⏹ Stopping...';
      stopBtn.disabled = true;
      stopBtn.style.opacity = '0.6';
      const text = progressBubble.querySelector('.video-progress-text');
      if (text) text.textContent = '⏹ Stopping after the current clip — your finished clips are safe.';
    });
  }

  for (let i = 0; i < clipCount; i++) {
    if (ctx.userStopped) {
      // Mark every remaining clip as stopped-by-user (retryable later).
      for (let j = i; j < clipCount; j++) {
        if (!clipResults[j].url) clipResults[j].status = 'user_stopped_skipped';
      }
      break;
    }
    const result = await generateOneVeoClip(i, ctx);
    clipResults[i].status = result.status;
    clipResults[i].url = result.url;

    if (result.url) {
      const fill = progressBubble.querySelector('.video-progress-fill');
      const pct = Math.round(((i + 1) / clipCount) * 80);
      if (fill) fill.style.width = `${pct}%`;

      // v2.4.9 VISUAL CHAINING: pre-warm the last frame of this clip so the
      // NEXT clip starts exactly where this one ended. The actual JIT refresh
      // happens inside generateOneVeoClip too (covers retries / re-renders),
      // but doing it here gives the user a visible "Capturing transition
      // frame..." progress message during the long generation.
      if (i + 1 < clipCount && !ctx.userStopped) {
        const text = progressBubble.querySelector('.video-progress-text');
        if (text) text.textContent = `Capturing transition frame from clip ${i + 1} for seamless handoff...`;
        await refreshTransitionFrame(ctx, i);
        if (!ctx.transitionFrames[i]) {
          console.log(`[SnapToAI Video] Clip ${i + 1} last-frame extraction failed — clip ${i + 2} will use text-only continuity.`);
        }
      }
    }

    if (result.billingAbort) {
      ctx.billingAbortAt = i + 1;
      break;
    }
  }

  await renderVeoBatchOutcome(ctx);
}

// ─────────────────────────────────────────────────────────────────
// VISUAL CHAINING (v2.4.9)
// Veo treats every clip as an independent generation. Telling it
// "be consistent" in text doesn't work — characters morph, lighting
// jumps, lens swaps. The fix: extract the LAST FRAME of clip N and
// feed it as the starting `image` for clip N+1 (Veo's image-to-video
// mode). Clip N+1 then literally begins where clip N ended.
//
// Returns { base64, mimeType } ready to drop into requestBody.instances[0].image
// — or null on any failure (caller falls back to text-only continuity).
// ─────────────────────────────────────────────────────────────────

// Just-in-time refresh of ctx.transitionFrames[idx] from clipResults[idx].url.
// Call BEFORE reading transitionFrames[idx-1] (so the next clip uses the
// CURRENT frame of the previous clip, not a stale cached one from the
// original batch run), and AFTER replacing clipResults[idx].url (so the
// next chain uses the freshly rendered clip).
//
// Cheap if already cached for the same URL (early return).
async function refreshTransitionFrame(ctx, idx) {
  if (!ctx || idx < 0 || !Array.isArray(ctx.clipResults)) return;
  const r = ctx.clipResults[idx];
  if (!r || !r.url) return;
  const cached = ctx.transitionFrames[idx];
  if (cached && cached._sourceUrl === r.url) return;
  const frame = await extractLastFrame(r.url);
  if (frame) {
    frame._sourceUrl = r.url;
    ctx.transitionFrames[idx] = frame;
  } else if (cached) {
    // Best-effort: keep stale cache rather than wipe it.
    console.log(`[SnapToAI Video] Could not refresh transition frame for clip ${idx + 1}; keeping cached frame.`);
  }
}

async function extractLastFrame(videoUrl) {
  let blobUrl = null;
  let video = null;
  try {
    const resp = await fetch(videoUrl);
    if (!resp.ok) throw new Error(`fetch ${resp.status}`);
    const blob = await resp.blob();
    blobUrl = URL.createObjectURL(blob);

    // Park the <video> off-screen but IN THE DOM. Chrome will skip frame
    // decoding for detached elements, which silently produces a black canvas.
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:64px;height:64px;opacity:0;pointer-events:none;z-index:-1;';
    document.body.appendChild(video);
    video.src = blobUrl;

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('metadata timeout')), 20000);
      video.onloadedmetadata = () => { clearTimeout(t); resolve(); };
      video.onerror = () => { clearTimeout(t); reject(new Error(`video load error code=${(video.error && video.error.code) || '?'}`)); };
    });

    // Wait for actual frame data, not just metadata.
    if (video.readyState < 2 /* HAVE_CURRENT_DATA */) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('loadeddata timeout')), 20000);
        video.onloadeddata = () => { clearTimeout(t); resolve(); };
      });
    }

    const w = video.videoWidth || 0;
    const h = video.videoHeight || 0;
    if (!w || !h) throw new Error(`zero video dimensions ${w}x${h}`);

    // Sample 3 candidate frames near EOF and pick the SHARPEST. The old
    // single-seek to (duration - 0.1s) frequently landed on a motion-blurred
    // frame at the apex of a camera move — that motion blur was then sent to
    // Veo as the "starting frame" of the next clip, telling it "the world
    // looks soft" → focus pop / character morph at the join. Sampling 3
    // candidates and picking the one with highest Laplacian variance gives
    // us a crisp identity reference for downstream chaining.
    const duration = video.duration || 8;
    const candidateOffsets = [0.4, 0.2, 0.05]
      .map(off => Math.max(0, duration - off))
      .filter((t, i, arr) => arr.indexOf(t) === i); // de-dupe for very short clips

    async function captureAt(targetT) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('seek timeout')), 20000);
        video.onseeked = () => { clearTimeout(t); resolve(); };
        try { video.currentTime = targetT; }
        catch (e) { clearTimeout(t); reject(e); }
      });
      // CRITICAL: `seeked` fires before the new frame is actually painted to
      // the video's GPU texture. Drawing immediately produces a black or
      // stale frame. Wait for requestVideoFrameCallback (Chrome 83+) when
      // available, and ALSO do a two-rAF compositor wait afterwards.
      if (typeof video.requestVideoFrameCallback === 'function') {
        await new Promise(resolve => {
          const t = setTimeout(resolve, 1500);
          video.requestVideoFrameCallback(() => { clearTimeout(t); resolve(); });
        });
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const c2 = document.createElement('canvas');
      c2.width = w;
      c2.height = h;
      const ctx2 = c2.getContext('2d');
      ctx2.drawImage(video, 0, 0, w, h);
      return { canvas: c2, ctx: ctx2, t: targetT };
    }

    // Sharpness = variance of the Sobel-like gradient on a downsampled
    // luminance buffer. Downsampling to ≤256 px wide keeps the pass cheap
    // (~0.5 ms) while preserving the sharp/blur signal we care about.
    function sharpnessScore(canvasEl, ctxEl) {
      const targetW = Math.min(256, canvasEl.width);
      const scale = targetW / canvasEl.width;
      const targetH = Math.max(1, Math.round(canvasEl.height * scale));
      const tmp = document.createElement('canvas');
      tmp.width = targetW;
      tmp.height = targetH;
      tmp.getContext('2d').drawImage(canvasEl, 0, 0, targetW, targetH);
      const img = tmp.getContext('2d').getImageData(0, 0, targetW, targetH);
      const data = img.data;
      // Compute luminance + horizontal/vertical gradient magnitude variance.
      const lumW = targetW, lumH = targetH;
      const lum = new Float32Array(lumW * lumH);
      for (let i = 0, p = 0; p < data.length; p += 4, i++) {
        lum[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      }
      let sum = 0, sumSq = 0, n = 0;
      for (let y = 1; y < lumH - 1; y++) {
        for (let x = 1; x < lumW - 1; x++) {
          const i = y * lumW + x;
          const gx = lum[i + 1] - lum[i - 1];
          const gy = lum[i + lumW] - lum[i - lumW];
          const mag = Math.abs(gx) + Math.abs(gy);
          sum += mag;
          sumSq += mag * mag;
          n++;
        }
      }
      if (n === 0) return 0;
      const mean = sum / n;
      return (sumSq / n) - (mean * mean); // variance — higher = sharper
    }

    let best = null;
    let bestScore = -1;
    for (const off of candidateOffsets) {
      try {
        const cand = await captureAt(off);
        const score = sharpnessScore(cand.canvas, cand.ctx);
        if (score > bestScore) { bestScore = score; best = cand; }
      } catch (e) {
        console.log(`[SnapToAI Video] extractLastFrame seek ${off.toFixed(2)}s skipped: ${e.message}`);
      }
    }
    if (!best) throw new Error('no candidate frames captured');

    // PNG preserves identity tokens (no chroma subsampling, no DCT
    // quantization) that Veo's image-to-video conditioner uses to lock
    // character identity. JPEG @ 0.92 strips them, which is the primary
    // cause of character morphing across chained clips. PNG can be ~3 MB on
    // a 1280x720 frame though — if it exceeds 3 MB base64, fall back to
    // JPEG @ 0.95 (Veo's documented payload ceiling is ~7 MB / image).
    let dataUrl = best.canvas.toDataURL('image/png');
    let base64 = dataUrl.split(',')[1] || '';
    let mimeType = 'image/png';
    const sizeKb = Math.round(base64.length * 0.75 / 1024);
    if (sizeKb > 3072) {
      dataUrl = best.canvas.toDataURL('image/jpeg', 0.95);
      base64 = dataUrl.split(',')[1] || '';
      mimeType = 'image/jpeg';
    }
    if (!base64 || base64.length < 1000) {
      throw new Error(`canvas produced empty/tiny image (${base64.length} b64 chars)`);
    }
    const finalKb = Math.round(base64.length * 0.75 / 1024);
    console.log(`[SnapToAI Video] extractLastFrame OK ${w}x${h} ~${finalKb}KB ${mimeType.split('/')[1]} from t=${best.t.toFixed(2)}s/${duration.toFixed(2)}s (sharpest of ${candidateOffsets.length}, var=${bestScore.toFixed(0)})`);
    return { base64, mimeType };
  } catch (e) {
    console.log('[SnapToAI Video] extractLastFrame failed:', e.message);
    return null;
  } finally {
    if (video && video.parentNode) { try { video.parentNode.removeChild(video); } catch (_) {} }
    if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (_) {} }
  }
}

// Cancellable sleep. Polls ctx.userStopped every second so the user can
// abort during long quota-cooldown waits. Returns true if completed
// normally, false if the user pressed Stop mid-wait.
async function cancellableWait(seconds, ctx, onTick) {
  for (let s = seconds; s > 0; s--) {
    if (ctx && ctx.userStopped) return false;
    if (typeof onTick === 'function') {
      try { onTick(s); } catch (_) {}
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return !(ctx && ctx.userStopped);
}

// ============================================================================
// Render the appropriate outcome card (zero-success / single / stitched /
// fallback) AND wire up the per-clip "🔄 Retry" buttons next to each
// failed/skipped clip.
// ============================================================================
async function renderVeoBatchOutcome(ctx) {
  const { progressBubble, thread, clipResults, clipCount, billingAbortAt } = ctx;
  const successUrls = clipResults.filter(r => r.url).map(r => r.url);

  // Revoke prior stitched blob URL on re-render to avoid memory leaks.
  if (ctx.lastStitchedUrl) {
    try { URL.revokeObjectURL(ctx.lastStitchedUrl); } catch (_) {}
    ctx.lastStitchedUrl = null;
  }

  // --- Case A: 0 successful clips ---
  if (successUrls.length === 0) {
    progressBubble.innerHTML = buildVeoSummaryCard(ctx, billingAbortAt, /*hasSuccess*/ false, null);
    wireVeoRetryButtons(ctx);
    wireVeoRerenderButtons(ctx);
    return;
  }

  // --- Case B: at least 1 successful clip → render video, append retry panel ---
  try {
    if (successUrls.length === 1) {
      showVideoResult(progressBubble, successUrls[0], thread);
    } else {
      const fill = progressBubble.querySelector('.video-progress-fill');
      const text = progressBubble.querySelector('.video-progress-text');
      if (fill) fill.style.width = '85%';
      if (text) text.textContent = 'Stitching clips together...';
      const stitchedUrl = await stitchVideos(successUrls, ctx);
      ctx.lastStitchedUrl = stitchedUrl;
      if (fill) fill.style.width = '100%';
      showStitchedVideoResult(progressBubble, stitchedUrl, successUrls, thread);
    }
  } catch (err) {
    console.log('[SnapToAI Video] Stitch error:', err.message);
    showMultiClipFallback(progressBubble, successUrls, thread);
  }

  // Always append the retry/re-render panel so users can fix bad clips
  // without paying to regenerate the entire video.
  const failedClips = clipResults.filter(r => !r.url);
  const panel = document.createElement('div');
  panel.innerHTML = buildVeoSummaryCard(ctx, billingAbortAt, /*hasSuccess*/ true, successUrls.length);
  progressBubble.appendChild(panel.firstElementChild);
  if (clipCount > 1) {
    const rerenderPanel = document.createElement('div');
    rerenderPanel.innerHTML = buildVeoRerenderPanel(ctx);
    if (rerenderPanel.firstElementChild) progressBubble.appendChild(rerenderPanel.firstElementChild);
  }
  wireVeoRetryButtons(ctx);
  wireVeoRerenderButtons(ctx);
}

// Per-clip re-render panel. Lets the user replace a single successful clip
// (e.g. one that's visually off) without paying to rerun the entire batch.
// Each row shows the current prompt + an inline editor + cost.
function buildVeoRerenderPanel(ctx) {
  const { clipResults, clipScenes, modelName, durationSeconds } = ctx;
  const successCount = clipResults.filter(r => r.url).length;
  if (successCount === 0) return '';
  const perSecond = (typeof VEO_PRICING !== 'undefined' && VEO_PRICING[modelName]) || 0;
  const perClipCost = perSecond * (durationSeconds || 8);
  const costStr = perClipCost > 0 ? `≈ $${perClipCost.toFixed(2)}/clip` : '';

  const rows = clipResults.map((r, idx) => {
    if (!r.url) return '';
    const prompt = (clipScenes && clipScenes[idx]) || '';
    // v2.4.9: "Fix Stitch" only makes sense when there's a previous successful
    // clip whose final frame we can borrow. Show it on clips 2..N.
    const prevHasUrl = idx > 0 && clipResults[idx - 1] && clipResults[idx - 1].url;
    const fixStitchBtn = prevHasUrl
      ? `<button class="veo-fix-stitch-btn" data-clip-idx="${idx}" title="Re-render this clip starting from the LAST FRAME of clip ${idx} so the join looks seamless." style="padding:4px 10px;border-radius:6px;border:1px solid rgba(0,217,255,0.4);background:rgba(0,217,255,0.1);color:#00d9ff;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">✂ Fix stitch (${idx}→${idx + 1})</button>`
      : '';
    return `<div style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 12px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap;">
        <span style="font-size:12px;font-weight:600;color:#cdd6e0;">🎬 Clip ${r.n}</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${fixStitchBtn}
          <button class="veo-rerender-toggle" data-clip-idx="${idx}" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(255,165,0,0.4);background:rgba(255,165,0,0.1);color:#ffa500;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">✎ Re-render this clip</button>
        </div>
      </div>
      <div class="veo-rerender-editor" data-clip-idx="${idx}" style="display:none;margin-top:6px;">
        <div style="font-size:10px;color:#667788;letter-spacing:1px;font-weight:600;margin-bottom:4px;">PROMPT FOR THIS CLIP (edit then confirm)</div>
        <textarea class="veo-rerender-prompt" data-clip-idx="${idx}" rows="6" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:6px;border:1px solid rgba(255,165,0,0.3);background:rgba(0,0,0,0.3);color:#e6ecf3;font-size:11px;line-height:1.5;font-family:ui-monospace,monospace;resize:vertical;">${escapeHtml(prompt)}</textarea>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px;">
          <span style="font-size:10px;color:#667788;">${costStr ? costStr + ' on your Google key' : ''}</span>
          <div style="display:flex;gap:6px;">
            <button class="veo-rerender-cancel" data-clip-idx="${idx}" style="padding:5px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.04);color:#cdd6e0;font-size:11px;font-weight:600;cursor:pointer;">Cancel</button>
            <button class="veo-rerender-confirm" data-clip-idx="${idx}" style="padding:5px 14px;border-radius:6px;border:none;background:linear-gradient(135deg,#ffa500,#ff7700);color:#fff;font-size:11px;font-weight:700;cursor:pointer;">✓ Confirm re-render</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  return `<div style="margin-top:12px;background:rgba(255,165,0,0.04);border:1px solid rgba(255,165,0,0.2);border-radius:10px;padding:12px;">
    <div style="font-weight:600;color:#ffa500;font-size:12px;margin-bottom:6px;">✎ Don't like one of the clips? Re-render only that one — pay just for one clip.</div>
    <div style="font-size:11px;color:#8899aa;margin-bottom:10px;line-height:1.5;">
      <span style="color:#00d9ff;font-weight:600;">✂ Fix stitch</span> = same prompt, but the clip starts from the previous clip's last frame so the cut is invisible. Use this when the join looks jarring.
    </div>
    ${rows}
  </div>`;
}

function wireVeoRerenderButtons(ctx) {
  const { progressBubble, clipScenes, clipResults } = ctx;

  // v2.4.9: Fix Stitch — re-render clip `idx` using clip `idx-1`'s last frame
  // as the starting image. Same prompt, just visually chained. This is the
  // explicit "the join looks bad" repair button.
  progressBubble.querySelectorAll('.veo-fix-stitch-btn').forEach(btn => {
    if (btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.clipIdx, 10);
      if (isNaN(idx) || idx <= 0) return;
      if (ctx.retryInFlight) return;
      const prevResult = clipResults[idx - 1];
      if (!prevResult || !prevResult.url) {
        alert(`Cannot fix stitch — clip ${idx} is not available as a reference.`);
        return;
      }
      if (!confirm(`Re-render clip ${idx + 1} starting from clip ${idx}'s final frame? This will charge your Google key for one clip and replace the existing one.`)) return;

      ctx.retryInFlight = true;
      setAllRetryButtonsDisabled(progressBubble, true, '⏳ Fixing stitch...');
      btn.textContent = '⏳ Re-rendering chained clip...';

      const priorResult = { ...clipResults[idx] };
      const priorTransitionFramePrev = ctx.transitionFrames[idx - 1];
      const priorTransitionFrameSelf = ctx.transitionFrames[idx];

      try {
        // generateOneVeoClip will JIT-refresh transitionFrames[idx-1] from
        // the CURRENT clipResults[idx-1].url (handles the case where clip
        // idx-1 was itself re-rendered after the original batch).
        const result = await generateOneVeoClip(idx, ctx);
        if (result.url) {
          clipResults[idx].status = result.status;
          clipResults[idx].url = result.url;
          if (priorResult.url) { try { URL.revokeObjectURL(priorResult.url); } catch (_) {} }
          // Invalidate this clip's cached frame so clip idx+1's next regen
          // picks up the freshly rendered version.
          ctx.transitionFrames[idx] = null;
          await refreshTransitionFrame(ctx, idx);
          await renderVeoBatchOutcome(ctx);
        } else {
          clipResults[idx] = priorResult;
          ctx.transitionFrames[idx - 1] = priorTransitionFramePrev;
          ctx.transitionFrames[idx] = priorTransitionFrameSelf;
          alert(`Fix stitch failed (${result.status}). Your original clip ${idx + 1} is preserved.`);
          await renderVeoBatchOutcome(ctx);
        }
      } catch (err) {
        console.log('[SnapToAI Video] Fix-stitch threw:', err.message);
        clipResults[idx] = priorResult;
        ctx.transitionFrames[idx - 1] = priorTransitionFramePrev;
        ctx.transitionFrames[idx] = priorTransitionFrameSelf;
        alert(`Fix stitch error: ${err.message}. Your original clip is preserved.`);
        try { await renderVeoBatchOutcome(ctx); } catch (_) {}
      } finally {
        ctx.retryInFlight = false;
        setAllRetryButtonsDisabled(progressBubble, false, null);
      }
    });
  });

  progressBubble.querySelectorAll('.veo-rerender-toggle').forEach(btn => {
    if (btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.clipIdx, 10);
      const editor = progressBubble.querySelector(`.veo-rerender-editor[data-clip-idx="${idx}"]`);
      if (!editor) return;
      const isOpen = editor.style.display === 'block';
      editor.style.display = isOpen ? 'none' : 'block';
      btn.textContent = isOpen ? '✎ Re-render this clip' : '▴ Close editor';
    });
  });
  progressBubble.querySelectorAll('.veo-rerender-cancel').forEach(btn => {
    if (btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.clipIdx, 10);
      const editor = progressBubble.querySelector(`.veo-rerender-editor[data-clip-idx="${idx}"]`);
      const toggle = progressBubble.querySelector(`.veo-rerender-toggle[data-clip-idx="${idx}"]`);
      if (editor) editor.style.display = 'none';
      if (toggle) toggle.textContent = '✎ Re-render this clip';
    });
  });
  progressBubble.querySelectorAll('.veo-rerender-confirm').forEach(btn => {
    if (btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.clipIdx, 10);
      if (isNaN(idx)) return;
      if (ctx.retryInFlight) return;
      const ta = progressBubble.querySelector(`.veo-rerender-prompt[data-clip-idx="${idx}"]`);
      if (!ta) return;
      const newPrompt = ta.value.trim();
      if (!newPrompt) { alert('Prompt cannot be empty.'); return; }
      if (!confirm(`Re-render clip ${idx + 1}? This will charge your Google key for one clip and replace the existing one.`)) return;

      // TRANSACTIONAL replacement: snapshot the prior good clip so a failed
      // re-render does NOT destroy the user's existing video. Only swap (and
      // revoke the old URL) when the new clip succeeds.
      const priorPrompt = ctx.clipScenes[idx];
      const priorResult = { ...clipResults[idx] };
      const priorTransitionFrameSelf = ctx.transitionFrames[idx];
      ctx.clipScenes[idx] = newPrompt;

      ctx.retryInFlight = true;
      setAllRetryButtonsDisabled(progressBubble, true, '⏳ Re-rendering...');
      btn.textContent = '⏳ Re-rendering...';
      try {
        // generateOneVeoClip JIT-refreshes transitionFrames[idx-1] from
        // current clipResults[idx-1].url so the new clip is always chained
        // to the freshest version of its predecessor.
        const result = await generateOneVeoClip(idx, ctx);
        if (result.url) {
          // Success → swap, then revoke the old blob URL.
          clipResults[idx].status = result.status;
          clipResults[idx].url = result.url;
          if (priorResult.url) { try { URL.revokeObjectURL(priorResult.url); } catch (_) {} }
          // Invalidate this clip's cached frame so clip idx+1's next regen
          // chains to the freshly rendered version, not the old one.
          ctx.transitionFrames[idx] = null;
          await refreshTransitionFrame(ctx, idx);
          await renderVeoBatchOutcome(ctx);
        } else {
          ctx.clipScenes[idx] = priorPrompt;
          clipResults[idx] = priorResult;
          ctx.transitionFrames[idx] = priorTransitionFrameSelf;
          alert(`Re-render failed (${result.status}). Your original clip ${idx + 1} is preserved — try a different prompt or accept the original.`);
          await renderVeoBatchOutcome(ctx);
        }
      } catch (err) {
        console.log('[SnapToAI Video] Re-render threw:', err.message);
        ctx.clipScenes[idx] = priorPrompt;
        clipResults[idx] = priorResult;
        ctx.transitionFrames[idx] = priorTransitionFrameSelf;
        alert(`Re-render error: ${err.message}. Your original clip is preserved.`);
        try { await renderVeoBatchOutcome(ctx); } catch (_) {}
      } finally {
        ctx.retryInFlight = false;
        setAllRetryButtonsDisabled(progressBubble, false, null);
      }
    });
  });
}

function setAllRetryButtonsDisabled(progressBubble, disabled, label) {
  progressBubble.querySelectorAll('.veo-retry-btn').forEach(b => {
    b.disabled = disabled;
    b.style.opacity = disabled ? '0.5' : '1';
    b.style.cursor = disabled ? 'not-allowed' : 'pointer';
    if (disabled && label) b.textContent = label;
  });
}

function buildVeoSummaryCard(ctx, billingAbortAt, hasSuccess, successCount) {
  const { clipResults, clipCount } = ctx;
  const PRESTART_FREE = new Set(['rate_limit_prestart_skipped','transient_prestart_skipped','user_stopped_skipped']);
  const RETRYABLE = new Set([  // safety_blocked is NOT retryable (content rejected)
    'rate_limit_prestart_skipped','transient_prestart_skipped',
    'rate_limit_skipped','transient_skipped','timeout_skipped',
    'no_uri_skipped','job_error_skipped','no_op_id_ambiguous_skipped','pending',
    'user_stopped_skipped','user_stopped_poststart_skipped'
  ]);

  const rows = clipResults.map((r, idx) => {
    if (r.url) {
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);gap:10px;">
        <span><b>Clip ${r.n}</b> <span style="color:rgba(255,255,255,0.5);font-size:11px;">success</span></span>
        <span style="color:#00cc88;font-size:12px;">✓ done</span>
      </div>`;
    }
    const isFree = PRESTART_FREE.has(r.status);
    const tag = r.status === 'user_stopped_skipped'
      ? 'you stopped early · not billed'
      : (r.status === 'user_stopped_poststart_skipped'
          ? 'you stopped early · job had started · may be billed'
          : (isFree
              ? 'no job started · not billed'
              : (r.status === 'no_op_id_ambiguous_skipped'
                  ? 'unclear · billing status unknown'
                  : 'job started · may be billed')));
    const cleanStatus = (r.status === 'user_stopped_skipped' || r.status === 'user_stopped_poststart_skipped')
      ? 'stopped — click Retry to resume just this clip'
      : r.status.replace(/_skipped$/,'').replace(/_/g,' ');
    const canRetry = RETRYABLE.has(r.status);
    const retryBtn = canRetry
      ? `<button class="veo-retry-btn" data-clip-idx="${idx}" style="background:rgba(0,217,255,0.15);border:1px solid rgba(0,217,255,0.4);color:#00d9ff;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">🔄 Retry</button>`
      : `<span style="font-size:10px;color:rgba(255,255,255,0.35);">cannot retry</span>`;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);gap:10px;">
      <span style="flex:1;min-width:0;"><b>Clip ${r.n}</b> <span style="color:rgba(255,255,255,0.5);font-size:11px;">${tag}</span><br><span style="color:#ffaa00;font-size:11px;">${cleanStatus}</span></span>
      ${retryBtn}
    </div>`;
  }).join('');

  const billingLine = (() => {
    if (billingAbortAt > 0) {
      return `⚠ Stopped at clip ${billingAbortAt} due to a billing/account issue. Check your Google Cloud billing console, then retry individual clips below.`;
    }
    const failedNotFree = clipResults.filter(r => !r.url && !PRESTART_FREE.has(r.status));
    const failedFree = clipResults.filter(r => !r.url && PRESTART_FREE.has(r.status));
    if (failedNotFree.length > 0) {
      return `Note: ${failedNotFree.length} clip(s) reached Google's Veo servers and may be billed. ${failedFree.length} clip(s) never reached the API and are not billed. Check your Google Cloud billing for exact charges.`;
    }
    return failedFree.length > 0 ? `None of the failed clips reached Google's API, so you were not billed for them.` : '';
  })();

  if (hasSuccess) {
    return `<div style="margin-top:14px;background:rgba(0,217,255,0.06);border:1px solid rgba(0,217,255,0.2);border-radius:10px;padding:12px;color:#fff;font-size:12px;">
      <div style="font-weight:600;margin-bottom:8px;color:#00d9ff;">${successCount} of ${clipCount} clips succeeded · retry the rest below</div>
      <div style="margin:8px 0;">${rows}</div>
      ${billingLine ? `<div style="margin-top:10px;color:rgba(255,255,255,0.7);font-size:11px;line-height:1.5;">${billingLine}</div>` : ''}
    </div>`;
  }
  return `<div style="background:rgba(255,107,107,0.1);border:1px solid rgba(255,107,107,0.3);border-radius:10px;padding:14px;color:#fff;font-size:13px;">
    <div style="font-weight:600;margin-bottom:8px;color:#ff6b6b;">⚠ 0 of ${clipCount} clips generated · retry below</div>
    <div style="margin:8px 0;">${rows}</div>
    <div style="margin-top:10px;color:rgba(255,255,255,0.7);font-size:12px;line-height:1.5;">
      ${billingLine}<br>Or try a different Veo model / fewer clips / wait 60s.
    </div>
  </div>`;
}

function wireVeoRetryButtons(ctx) {
  const { progressBubble } = ctx;
  progressBubble.querySelectorAll('.veo-retry-btn').forEach(btn => {
    if (btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.clipIdx, 10);
      if (isNaN(idx)) return;
      // Batch-level mutex: only one retry may run at a time so users cannot
      // accidentally fire multiple paid generations in parallel.
      if (ctx.retryInFlight) {
        console.log('[SnapToAI Video] Retry already in flight — ignoring click.');
        return;
      }
      ctx.retryInFlight = true;
      setAllRetryButtonsDisabled(progressBubble, true, '⏳ Waiting...');
      btn.textContent = '⏳ Retrying...';
      try {
        await retryVeoClip(idx, ctx);
      } finally {
        ctx.retryInFlight = false;
        // Buttons are re-rendered by renderVeoBatchOutcome on success;
        // on failure, re-enable surviving buttons here.
        setAllRetryButtonsDisabled(progressBubble, false, null);
      }
    });
  });
}

async function retryVeoClip(clipIdx, ctx) {
  const { progressBubble, clipResults, clipCount } = ctx;
  console.log(`[SnapToAI Video] User-triggered retry for clip ${clipIdx + 1}`);
  // Reset the stop flag so the user-initiated retry isn't immediately
  // aborted by a sticky stop from the previous batch run.
  ctx.userStopped = false;

  // Show a small inline progress strip at the top of the bubble during retry
  let retryBar = progressBubble.querySelector('.veo-retry-progress');
  if (!retryBar) {
    retryBar = document.createElement('div');
    retryBar.className = 'veo-retry-progress';
    retryBar.style.cssText = 'margin:10px 0;padding:10px;background:rgba(255,165,0,0.1);border:1px solid rgba(255,165,0,0.3);border-radius:8px;color:#ffa500;font-size:12px;';
    progressBubble.insertBefore(retryBar, progressBubble.firstChild);
  }
  retryBar.innerHTML = `<div class="video-progress-text">Retrying clip ${clipIdx + 1} of ${clipCount}...</div><div style="margin-top:6px;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;"><div class="video-progress-fill" style="height:100%;width:0;background:linear-gradient(90deg,#ffa500,#ff6b6b);transition:width .3s;"></div></div>`;

  // Snapshot prior frame so we can restore on transient failure.
  const priorTransitionFrameSelf = ctx.transitionFrames[clipIdx];

  try {
    // generateOneVeoClip JIT-refreshes transitionFrames[clipIdx-1] from the
    // current clipResults[clipIdx-1].url so the retry chains to the freshest
    // version of its predecessor (handles any earlier re-renders).
    const result = await generateOneVeoClip(clipIdx, ctx);
    clipResults[clipIdx].status = result.status;
    clipResults[clipIdx].url = result.url;

    if (result.billingAbort) {
      retryBar.innerHTML = `<div style="color:#ff6b6b;">⚠ Retry blocked by billing — check your Google Cloud account.</div>`;
      return;
    }

    if (result.url) {
      // Invalidate this clip's cached frame so clip clipIdx+1's next regen
      // chains to the freshly retried version, not the old one.
      ctx.transitionFrames[clipIdx] = null;
      await refreshTransitionFrame(ctx, clipIdx);
    } else {
      ctx.transitionFrames[clipIdx] = priorTransitionFrameSelf;
    }

    // Re-render the whole outcome (this redraws the video result + summary card)
    retryBar.remove();
    await renderVeoBatchOutcome(ctx);
  } catch (err) {
    console.log('[SnapToAI Video] Retry threw:', err.message);
    ctx.transitionFrames[clipIdx] = priorTransitionFrameSelf;
    retryBar.innerHTML = `<div style="color:#ff6b6b;">⚠ Retry failed: ${err.message}</div>`;
  }
}

// Returns { url, status } where status is one of:
//   'success'         → got a video URL
//   'transient'       → network/HTTP error (caller should RETRY same clip)
//   'rate_limit'      → 429 / quota (caller should WAIT + RETRY same clip)
//   'timeout'         → exceeded maxPolls (caller should RETRY same clip)
//   'safety_blocked'  → content/safety filter rejection (skip clip, keep going)
//   'no_uri'          → completed but no video URI returned (skip clip, keep going)
//   'job_error'       → operation completed with a permanent error (skip clip, keep going)
function pollVideoStatusAsync(operationId, apiKey, progressBubble, clipNum, totalClips) {
  return new Promise((resolve) => {
    let pollCount = 0;
    const maxPolls = 60;  // bumped 40 → 60 (= 15 min max per clip; high-quality clips can take 10+)
    let consecutiveErrors = 0;

    const timer = setInterval(async () => {
      pollCount++;

      if (pollCount > maxPolls) {
        clearInterval(timer);
        const text = progressBubble.querySelector('.video-progress-text');
        if (text) text.textContent = `Clip ${clipNum} timed out.`;
        resolve({ url: null, status: 'timeout' });
        return;
      }

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/${operationId}?key=${apiKey}`;
        const resp = await fetch(url);
        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
          if (resp.status === 429) { consecutiveErrors = 0; return; } // keep polling — quota will reset
          consecutiveErrors++;
          // Tolerate up to 3 transient HTTP errors before giving up on polling
          if (consecutiveErrors < 3) return;
          clearInterval(timer);
          resolve({ url: null, status: 'transient' });
          return;
        }
        consecutiveErrors = 0;

        if (!data.done) {
          const pct = data.metadata?.percentComplete || Math.min(pollCount * 5, 90);
          const text = progressBubble.querySelector('.video-progress-text');
          if (text) text.textContent = `Clip ${clipNum}/${totalClips}: Rendering... ${pct}%`;
          return;
        }

        clearInterval(timer);
        console.log('[SnapToAI Video] Clip done:', JSON.stringify(data).substring(0, 500));

        if (data.error) {
          const errMsg = (data.error.message || '').toLowerCase();
          if (errMsg.includes('safety') || errMsg.includes('filter') || errMsg.includes('blocked') ||
              errMsg.includes('policy') || errMsg.includes('person') || errMsg.includes('face')) {
            resolve({ url: null, status: 'safety_blocked' });
            return;
          }
          if (errMsg.includes('quota') || errMsg.includes('rate') || errMsg.includes('exceeded') ||
              errMsg.includes('resource')) {
            resolve({ url: null, status: 'rate_limit' });
            return;
          }
          resolve({ url: null, status: 'job_error' });
          return;
        }

        let videoUri = '';
        const gvr = data.response?.generateVideoResponse;
        if (gvr?.generatedSamples?.[0]?.video?.uri) videoUri = gvr.generatedSamples[0].video.uri;
        else if (gvr?.generatedSamples?.[0]?.uri)   videoUri = gvr.generatedSamples[0].uri;
        if (!videoUri && data.response?.videos?.[0]?.uri) videoUri = data.response.videos[0].uri;
        if (!videoUri && data.response?.generatedSamples?.[0]?.video?.uri) videoUri = data.response.generatedSamples[0].video.uri;

        if (videoUri) {
          const authedUrl = `${videoUri}${videoUri.includes('?') ? '&' : '?'}key=${apiKey}`;
          resolve({ url: authedUrl, status: 'success' });
        } else {
          resolve({ url: null, status: 'no_uri' });
        }
      } catch (err) {
        console.log(`[SnapToAI Video] Poll error clip ${clipNum}:`, err.message);
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          clearInterval(timer);
          resolve({ url: null, status: 'transient' });
        }
      }
    }, 15000);
  });
}

// v2.4.7: Hardened stitcher with timeout, Stop-button support, play() race
// fix, and a setTimeout fallback so background tabs still make progress.
//
// `stitchCtx` is optional. If provided we honour stitchCtx.userStopped so the
// generation Stop button also aborts during stitching.
async function stitchVideos(videoUrls, stitchCtx) {
  console.log(`[SnapToAI Video] Stitching ${videoUrls.length} clips...`);

  // ---- Hard timeout: if anything hangs, give up cleanly so the caller can
  // fall back to showing individual clip download links instead of a frozen
  // "Stitching..." progress bar forever.
  const STITCH_TIMEOUT_MS = 90000;
  let timeoutHandle = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error('Stitch timeout (90s) — falling back to clips')),
      STITCH_TIMEOUT_MS
    );
  });

  const stitchPromise = (async () => {
    const blobs = [];
    for (const url of videoUrls) {
      if (stitchCtx && stitchCtx.userStopped) throw new Error('User stopped');
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Failed to fetch clip: ${resp.status}`);
      blobs.push(await resp.blob());
    }

    // Probe the FIRST clip to learn its native dimensions, so the canvas
    // matches the real aspect ratio. Hard-coding 1280x720 used to squash
    // 9:16 portrait Veo outputs into a landscape frame — the single most
    // viscerally bad failure mode for any user who picked vertical.
    const firstBlobUrl = URL.createObjectURL(blobs[0]);
    let canvasW = 1280, canvasH = 720;
    try {
      const probe = document.createElement('video');
      probe.src = firstBlobUrl;
      probe.muted = true;
      probe.preload = 'metadata';
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('probe timeout')), 10000);
        probe.onloadedmetadata = () => { clearTimeout(t); resolve(); };
        probe.onerror = () => { clearTimeout(t); reject(new Error('probe error')); };
      });
      if (probe.videoWidth > 0 && probe.videoHeight > 0) {
        canvasW = probe.videoWidth;
        canvasH = probe.videoHeight;
      } else if (stitchCtx && stitchCtx.aspectRatio === '9:16') {
        canvasW = 720; canvasH = 1280;
      } else if (stitchCtx && stitchCtx.aspectRatio === '1:1') {
        canvasW = 1024; canvasH = 1024;
      }
    } catch (e) {
      console.log('[SnapToAI Video] aspect-ratio probe failed, defaulting to 1280x720:', e.message);
      if (stitchCtx && stitchCtx.aspectRatio === '9:16') {
        canvasW = 720; canvasH = 1280;
      } else if (stitchCtx && stitchCtx.aspectRatio === '1:1') {
        canvasW = 1024; canvasH = 1024;
      }
    } finally {
      URL.revokeObjectURL(firstBlobUrl);
    }
    console.log(`[SnapToAI Video] stitch canvas ${canvasW}x${canvasH} (aspect: ${stitchCtx && stitchCtx.aspectRatio || 'auto'})`);

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx2d = canvas.getContext('2d');

    const stream = canvas.captureStream(30);
    const audioCtx = new AudioContext();
    // Resume in case the browser created it in a suspended state — common
    // with autoplay policies. await is safe even if already running.
    try { await audioCtx.resume(); } catch (_) {}
    const dest = audioCtx.createMediaStreamDestination();

    const audioTracks = dest.stream.getAudioTracks();
    if (audioTracks.length > 0) {
      stream.addTrack(audioTracks[0]);
    }

    // MediaRecorder.isTypeSupported guard — vp9+opus is preferred for
    // quality, but some hardened browser builds (corporate Chrome MSI,
    // some Linux distros, older Edge) don't support it and constructing
    // throws NotSupportedError. Walk a fallback chain so stitching keeps
    // working everywhere.
    const codecCandidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    let chosenMime = '';
    for (const m of codecCandidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) {
        chosenMime = m;
        break;
      }
    }
    const recorder = chosenMime
      ? new MediaRecorder(stream, { mimeType: chosenMime })
      : new MediaRecorder(stream);
    console.log(`[SnapToAI Video] MediaRecorder mime=${chosenMime || '(default)'}`);
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    const recordingDone = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start();

    // Audio crossfade duration (seconds). 50ms is the sweet spot — long
    // enough to mask the click/pop at clip boundaries, short enough that
    // the user doesn't perceive an audible "duck."
    const FADE_S = 0.05;

    try {
      for (let i = 0; i < blobs.length; i++) {
        if (stitchCtx && stitchCtx.userStopped) throw new Error('User stopped');

        const blobUrl = URL.createObjectURL(blobs[i]);
        const video = document.createElement('video');
        video.src = blobUrl;
        video.muted = false;
        video.crossOrigin = 'anonymous';
        video.playsInline = true;

        await new Promise((resolve, reject) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error('Video load error'));
        });

        // Per-clip GainNode so we can ramp audio in (start of clip) and out
        // (just before clip ends). Without these ramps, MediaRecorder
        // captures the abrupt waveform discontinuity at every clip boundary
        // as an audible click/pop. The ramps make the joins inaudible.
        let gainNode = null;
        try {
          const source = audioCtx.createMediaElementSource(video);
          gainNode = audioCtx.createGain();
          gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
          source.connect(gainNode);
          gainNode.connect(dest);
        } catch (e) {
          console.log('[SnapToAI Video] Audio connect skipped:', e.message);
        }

        // FIX: actually wait for play() to start before entering the draw
        // loop, otherwise the first iteration sees `video.paused === true`
        // and resolves immediately, drawing zero frames for that clip.
        try { await video.play(); } catch (e) {
          console.log('[SnapToAI Video] play() rejected:', e.message);
        }

        // Schedule the fade-in (now) and fade-out (just before clip ends).
        if (gainNode) {
          const t0 = audioCtx.currentTime;
          gainNode.gain.cancelScheduledValues(t0);
          gainNode.gain.setValueAtTime(0, t0);
          gainNode.gain.linearRampToValueAtTime(1, t0 + FADE_S);
          // Schedule the fade-out relative to playback duration. If
          // duration isn't known yet, default to clip 8s — the fade is
          // additionally clamped by video.onended below.
          const dur = (video.duration && isFinite(video.duration) && video.duration > 0) ? video.duration : 8;
          const fadeOutStart = t0 + Math.max(FADE_S, dur - FADE_S);
          gainNode.gain.setValueAtTime(1, fadeOutStart);
          gainNode.gain.linearRampToValueAtTime(0, fadeOutStart + FADE_S);
        }

        await new Promise((resolve) => {
          let resolved = false;
          const finish = () => { if (!resolved) { resolved = true; resolve(); } };
          const drawFrame = () => {
            if (resolved) return;
            if (stitchCtx && stitchCtx.userStopped) { finish(); return; }
            if (video.ended) { finish(); return; }
            try { ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height); } catch (_) {}
            // FIX: requestAnimationFrame pauses in background tabs, which is
            // the #1 cause of hangs. Pair it with a setTimeout so we keep
            // making progress even when the user clicks away.
            if (typeof requestAnimationFrame === 'function') {
              requestAnimationFrame(drawFrame);
            } else {
              setTimeout(drawFrame, 33);
            }
          };
          // Belt-and-suspenders fallback that fires regardless of rAF state.
          // Crucially, this also DRAWS frames — when the tab is backgrounded
          // requestAnimationFrame is throttled/paused, so without this the
          // canvas would never update and the stitched output would be a
          // single static frame per clip. Drawing on a 100ms interval gives
          // ~10fps stitched output in background tabs (acceptable fallback).
          const tickInterval = setInterval(() => {
            if (resolved) { clearInterval(tickInterval); return; }
            if (stitchCtx && stitchCtx.userStopped) { clearInterval(tickInterval); finish(); return; }
            if (video.ended) { clearInterval(tickInterval); finish(); return; }
            try { ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height); } catch (_) {}
          }, 100);
          video.onended = () => { clearInterval(tickInterval); finish(); };
          drawFrame();
        });

        URL.revokeObjectURL(blobUrl);
      }
    } finally {
      try { recorder.stop(); } catch (_) {}
      try { await audioCtx.close(); } catch (_) {}
      await recordingDone;
    }

    const stitchedBlob = new Blob(chunks, { type: 'video/webm' });
    return URL.createObjectURL(stitchedBlob);
  })();

  try {
    return await Promise.race([stitchPromise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function showStitchedVideoResult(bubble, stitchedUrl, clipUrls, thread) {
  const totalDur = selectedVideoDuration * clipUrls.length;
  bubble.innerHTML = `
    <div style="margin:8px 0;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="font-size:18px;">🎬</span>
        <span style="font-size:13px;font-weight:600;color:#ffa500;">Video ready! (${totalDur}s — ${clipUrls.length} clips stitched)</span>
      </div>
      <video controls autoplay muted playsinline style="width:100%;max-width:480px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);" src="${stitchedUrl}"></video>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="video-save-btn" style="background:rgba(255,165,0,0.15);border:1px solid rgba(255,165,0,0.3);color:#ffa500;padding:6px 16px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;">💾 Save Combined</button>
        <button class="video-save-clips-btn" style="background:rgba(0,200,136,0.1);border:1px solid rgba(0,200,136,0.3);color:#00cc88;padding:6px 16px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;">📥 Save Individual Clips</button>
      </div>
    </div>
  `;

  bubble.querySelector('.video-save-btn')?.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = stitchedUrl;
    a.download = 'snaptoai-video-combined.webm';
    a.click();
  });

  bubble.querySelector('.video-save-clips-btn')?.addEventListener('click', () => {
    clipUrls.forEach((url, i) => {
      const a = document.createElement('a');
      a.href = url;
      a.download = `snaptoai-clip-${i + 1}.mp4`;
      a.click();
    });
  });

  thread.scrollTop = thread.scrollHeight;
  addBubbleActions(bubble, 'Generated stitched video');
}

function showMultiClipFallback(bubble, clipUrls, thread) {
  let clipsHtml = clipUrls.map((url, i) => `
    <div style="margin-bottom:10px;">
      <div style="font-size:11px;color:#8899aa;margin-bottom:4px;">Clip ${i + 1}</div>
      <video controls muted playsinline style="width:100%;max-width:480px;border-radius:10px;" src="${url}"></video>
    </div>
  `).join('');

  bubble.innerHTML = `
    <div style="margin:8px 0;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="font-size:18px;">🎬</span>
        <span style="font-size:13px;font-weight:600;color:#ffa500;">${clipUrls.length} clips ready!</span>
      </div>
      <div style="font-size:12px;color:#8899aa;margin-bottom:10px;">Auto-stitch wasn't possible. Here are your individual clips:</div>
      ${clipsHtml}
      <div style="margin-top:10px;">
        <button class="video-save-clips-btn" style="background:rgba(0,200,136,0.1);border:1px solid rgba(0,200,136,0.3);color:#00cc88;padding:6px 16px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;">📥 Save All Clips</button>
      </div>
    </div>
  `;

  bubble.querySelector('.video-save-clips-btn')?.addEventListener('click', () => {
    clipUrls.forEach((url, i) => {
      const a = document.createElement('a');
      a.href = url;
      a.download = `snaptoai-clip-${i + 1}.mp4`;
      a.click();
    });
  });

  thread.scrollTop = thread.scrollHeight;
  addBubbleActions(bubble, 'Generated video clips');
}

async function pollVideoStatus(operationId, apiKey, progressBubble, thread) {
  if (activeVideoPollTimer) clearInterval(activeVideoPollTimer);

  let pollCount = 0;
  const maxPolls = 40;

  activeVideoPollTimer = setInterval(async () => {
    pollCount++;

    if (pollCount > maxPolls) {
      clearInterval(activeVideoPollTimer);
      activeVideoPollTimer = null;
      progressBubble.innerHTML = `<div style="color:#ff6b6b;font-size:13px;"><span style="font-size:16px;">⏰</span> Video generation timed out. Please try again.</div>`;
      return;
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/${operationId}?key=${apiKey}`;
      const resp = await fetch(url);
      const data = await resp.json();

      if (!resp.ok) {
        const errMsg = data.error?.message || `Status check failed (${resp.status})`;
        if (resp.status === 429) {
          const text = progressBubble.querySelector('.video-progress-text');
          if (text) text.textContent = 'Rate limit — retrying shortly...';
          return;
        }
        clearInterval(activeVideoPollTimer);
        activeVideoPollTimer = null;
        const errLower = errMsg.toLowerCase();
        if (isBillingError(resp.status, errMsg)) {
          progressBubble.innerHTML = buildUnlockCard('video');
        } else if (errLower.includes('quota') || errLower.includes('rate') || errLower.includes('exceeded') || errLower.includes('resource')) {
          progressBubble.innerHTML = buildVeoRateLimitCard('');
        } else {
          progressBubble.innerHTML = `<div style="color:#ff6b6b;font-size:13px;"><span style="font-size:16px;">❌</span> ${errMsg}</div>`;
        }
        return;
      }

      if (!data.done) {
        const pct = data.metadata?.percentComplete || Math.min(pollCount * 5, 90);
        const fill = progressBubble.querySelector('.video-progress-fill');
        const text = progressBubble.querySelector('.video-progress-text');
        if (fill) fill.style.width = `${pct}%`;
        if (text) text.textContent = `Rendering... ${pct}%`;
      } else {
        clearInterval(activeVideoPollTimer);
        activeVideoPollTimer = null;

        console.log('[SnapToAI Video] Done response:', JSON.stringify(data).substring(0, 1000));

        if (data.error) {
          const errMsg = data.error.message || 'Video generation failed.';
          const errLower2 = errMsg.toLowerCase();
          if (isBillingError(data.error.code || 0, errMsg)) {
            progressBubble.innerHTML = buildUnlockCard('video');
          } else if (errLower2.includes('quota') || errLower2.includes('rate') || errLower2.includes('exceeded') || errLower2.includes('resource') || data.error.code === 429) {
            progressBubble.innerHTML = buildVeoRateLimitCard('');
          } else {
            progressBubble.innerHTML = `<div style="color:#ff6b6b;font-size:13px;"><span style="font-size:16px;">❌</span> ${errMsg}</div>`;
          }
          return;
        }

        let videoUri = '';
        const gvr = data.response?.generateVideoResponse;
        if (gvr?.generatedSamples?.[0]?.video?.uri) {
          videoUri = gvr.generatedSamples[0].video.uri;
        } else if (gvr?.generatedSamples?.[0]?.uri) {
          videoUri = gvr.generatedSamples[0].uri;
        }
        if (!videoUri && data.response?.videos?.[0]?.uri) {
          videoUri = data.response.videos[0].uri;
        }
        if (!videoUri && data.response?.generatedSamples?.[0]?.video?.uri) {
          videoUri = data.response.generatedSamples[0].video.uri;
        }
        if (!videoUri) {
          const respStr = JSON.stringify(data.response || data).substring(0, 300);
          console.log('[SnapToAI Video] Could not find video URI in:', respStr);
          const filtered = data.response?.generateVideoResponse?.raiMediaFilteredReasons;
          if (filtered && filtered.length > 0) {
            progressBubble.innerHTML = `<div style="color:#ff6b6b;font-size:13px;"><span style="font-size:16px;">🛡️</span> Video was blocked by safety filters. Try a different prompt.</div>`;
          } else {
            progressBubble.innerHTML = `<div style="color:#ff6b6b;font-size:13px;"><span style="font-size:16px;">❌</span> Video generation completed but no video was returned. This can happen when the prompt triggers content filters. Try rephrasing your description.</div>`;
          }
          return;
        }

        const authedUrl = `${videoUri}${videoUri.includes('?') ? '&' : '?'}key=${apiKey}`;
        showVideoResult(progressBubble, authedUrl, thread);
      }
    } catch (err) {
      console.log(`[SnapToAI Video] Poll error:`, err.message);
    }
  }, 15000);
}

function showVideoResult(bubble, videoUrl, thread) {
  bubble.innerHTML = `
    <div style="margin:8px 0;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="font-size:18px;">🎬</span>
        <span style="font-size:13px;font-weight:600;color:#ffa500;">Video ready!</span>
      </div>
      <video controls autoplay muted playsinline style="width:100%;max-width:480px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);" src="${videoUrl}"></video>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="video-save-btn" style="background:rgba(255,165,0,0.15);border:1px solid rgba(255,165,0,0.3);color:#ffa500;padding:6px 16px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;transition:all 0.2s;">💾 Save Video</button>
      </div>
    </div>
  `;

  bubble.querySelector('.video-save-btn')?.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = 'snaptoai-video.mp4';
    a.click();
  });

  thread.scrollTop = thread.scrollHeight;
  addBubbleActions(bubble, 'Generated video');
}

function showSongStudio(thread) {
  const existing = thread.querySelector('.song-studio');
  if (existing) existing.remove();
  
  const studio = document.createElement('div');
  studio.className = 'chat-bubble ai song-studio';
  studio.style.cssText = 'padding: 0; margin: 8px 0; background: transparent; border: none; max-width: 100%; width: 100%;';
  
  const genres = [
    { emoji: '🎸', name: 'Rock' },
    { emoji: '🎷', name: 'Jazz' },
    { emoji: '🌴', name: 'Reggae' },
    { emoji: '🎹', name: 'Classical' },
    { emoji: '🎤', name: 'Pop' },
    { emoji: '🎵', name: 'R&B' },
    { emoji: '🔥', name: 'Hip Hop' },
    { emoji: '💃', name: 'Latin' },
    { emoji: '🤠', name: 'Country' },
    { emoji: '⚡', name: 'EDM' },
    { emoji: '🎶', name: 'Lo-Fi' },
    { emoji: '🌙', name: 'Blues' },
    { emoji: '🎻', name: 'Folk' },
    { emoji: '💀', name: 'Metal' },
    { emoji: '🌸', name: 'K-Pop' },
    { emoji: '🕌', name: 'Afrobeat' },
    { emoji: '🎺', name: 'Funk' },
    { emoji: '✨', name: 'Indie' },
    { emoji: '🌊', name: 'Ambient' },
    { emoji: '🎧', name: 'Trap' }
  ];
  
  const moods = [
    { emoji: '😊', name: 'Happy' },
    { emoji: '😢', name: 'Sad' },
    { emoji: '⚡', name: 'Energetic' },
    { emoji: '😌', name: 'Chill' },
    { emoji: '❤️', name: 'Romantic' },
    { emoji: '🏔️', name: 'Epic' },
    { emoji: '🌑', name: 'Dark' },
    { emoji: '🕺', name: 'Funky' },
    { emoji: '🌅', name: 'Nostalgic' },
    { emoji: '💪', name: 'Powerful' },
    { emoji: '🌿', name: 'Peaceful' },
    { emoji: '🎉', name: 'Party' }
  ];
  
  const tempos = [
    { emoji: '🐢', name: 'Slow' },
    { emoji: '🚶', name: 'Medium' },
    { emoji: '🏃', name: 'Fast' },
    { emoji: '🚀', name: 'Very Fast' }
  ];
  
  const chipStyle = `display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border-radius:20px;font-size:12px;cursor:pointer;transition:all 0.2s;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#ccd6e0;margin:3px;user-select:none;`;
  const chipActiveStyle = `background:rgba(0,255,136,0.15);border-color:rgba(0,255,136,0.4);color:#00ff88;`;
  const sectionTitleStyle = `font-size:13px;font-weight:600;color:#00ff88;margin:12px 0 8px 0;`;
  const sectionSubStyle = `font-size:11px;color:#667788;margin:-4px 0 6px 0;`;
  
  studio.innerHTML = `
    <div style="background:linear-gradient(135deg, rgba(0,255,136,0.06), rgba(0,200,100,0.03));border:1px solid rgba(0,255,136,0.12);border-radius:16px;padding:20px;backdrop-filter:blur(10px);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
        <span style="font-size:24px;">🎵</span>
        <div>
          <div style="font-size:16px;font-weight:700;color:#e8eef4;">Song Studio</div>
          <div style="font-size:11px;color:#667788;">Create your perfect song in 3 steps</div>
        </div>
      </div>

      <div style="margin:10px 0;background:rgba(255,255,255,0.02);border:1px solid rgba(0,255,136,0.12);border-radius:10px;padding:10px 12px;">
        <div style="font-size:10px;color:#667788;margin-bottom:6px;">💰 Pay-per-use (billed by Google to your own API key) — <em>estimated</em> cost per ~30s clip:</div>
        <div style="display:flex;flex-direction:column;gap:3px;font-size:11px;">
          ${LYRIA_MODELS_DISPLAY.map(m => {
            const rate = LYRIA_PRICING[m.id];
            if (rate == null) return '';
            const total30 = (rate * 30).toFixed(2);
            const isDefault = m.id === 'lyria-3-clip-preview';
            const color = isDefault ? '#00ff88' : '#aabbcc';
            const weight = isDefault ? '700' : '500';
            const bg = isDefault ? 'rgba(0,255,136,0.06)' : 'transparent';
            const marker = isDefault ? '▸ ' : '  ';
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 6px;border-radius:6px;background:${bg};color:${color};font-weight:${weight};">
              <span>${marker}${m.label}</span>
              <span style="font-variant-numeric:tabular-nums;">$${rate.toFixed(3)}/s · <strong>~$${total30}</strong></span>
            </div>`;
          }).join('')}
          <div style="margin-top:6px;padding-top:6px;border-top:1px dashed rgba(0,255,136,0.15);font-size:10px;color:#667788;">SnapToAI uses <strong style="color:#00ff88;">Lyria 3</strong> by default and falls back automatically if a model is unavailable on your key.</div>
        </div>
      </div>

      ${currentImages.length > 0 ? `
      <div style="background:linear-gradient(135deg, rgba(255,170,0,0.08), rgba(255,100,0,0.04));border:1px solid rgba(255,170,0,0.2);border-radius:12px;padding:14px;margin:10px 0;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:18px;">📸→🎵</span>
          <div>
            <div style="font-size:13px;font-weight:600;color:#ffaa00;">Image to Music</div>
            <div style="font-size:10px;color:#889900;">You have ${currentImages.length} screenshot${currentImages.length > 1 ? 's' : ''} loaded — turn ${currentImages.length > 1 ? 'them' : 'it'} into music!</div>
          </div>
        </div>
        <textarea class="img2music-desc" placeholder="Describe the music you want...&#10;&#10;e.g. Acoustic guitar, soft and peaceful&#10;e.g. Epic orchestral with drums&#10;e.g. Lo-fi hip hop, rainy day vibes" style="width:100%;box-sizing:border-box;min-height:70px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,170,0,0.2);border-radius:10px;padding:10px 12px;color:#e8eef4;font-size:12px;font-family:inherit;resize:vertical;outline:none;transition:border-color 0.2s;margin-bottom:10px;line-height:1.4;"></textarea>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <button class="img2music-happy" style="padding:6px 12px;border-radius:10px;border:1px solid rgba(0,255,136,0.3);background:rgba(0,255,136,0.08);color:#00ff88;font-size:11px;cursor:pointer;">😊 Happy</button>
          <button class="img2music-chill" style="padding:6px 12px;border-radius:10px;border:1px solid rgba(0,217,255,0.3);background:rgba(0,217,255,0.08);color:#00d9ff;font-size:11px;cursor:pointer;">😌 Chill</button>
          <button class="img2music-epic" style="padding:6px 12px;border-radius:10px;border:1px solid rgba(255,107,237,0.3);background:rgba(255,107,237,0.08);color:#ff6bed;font-size:11px;cursor:pointer;">🏔️ Epic</button>
          <button class="img2music-dark" style="padding:6px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.04);color:#aabbcc;font-size:11px;cursor:pointer;">🌑 Dark</button>
          <button class="img2music-romantic" style="padding:6px 12px;border-radius:10px;border:1px solid rgba(255,100,100,0.3);background:rgba(255,100,100,0.08);color:#ff6464;font-size:11px;cursor:pointer;">💕 Romantic</button>
          <button class="img2music-mysterious" style="padding:6px 12px;border-radius:10px;border:1px solid rgba(138,100,255,0.3);background:rgba(138,100,255,0.08);color:#8a64ff;font-size:11px;cursor:pointer;">🔮 Mysterious</button>
        </div>
        <button class="img2music-go" style="width:100%;padding:10px 20px;border-radius:10px;border:none;background:linear-gradient(135deg,#ffaa00,#ff8800);color:#000;font-size:13px;font-weight:700;cursor:pointer;">🎵 Create Music From Image</button>
      </div>
      ` : ''}
      
      <div style="${sectionTitleStyle}">Step 1: Pick a Genre</div>
      <div style="${sectionSubStyle}">Choose your style</div>
      <div class="studio-genres" style="display:flex;flex-wrap:wrap;gap:2px;">
        ${genres.map(g => `<div class="studio-chip genre-chip" data-value="${g.name}" style="${chipStyle}"><span>${g.emoji}</span><span>${g.name}</span></div>`).join('')}
      </div>
      
      <div style="${sectionTitleStyle}">Step 2: Set the Mood</div>
      <div style="${sectionSubStyle}">How should it feel?</div>
      <div class="studio-moods" style="display:flex;flex-wrap:wrap;gap:2px;">
        ${moods.map(m => `<div class="studio-chip mood-chip" data-value="${m.name}" style="${chipStyle}"><span>${m.emoji}</span><span>${m.name}</span></div>`).join('')}
      </div>
      
      <div style="${sectionTitleStyle}">Step 3: Choose Tempo</div>
      <div class="studio-tempos" style="display:flex;flex-wrap:wrap;gap:2px;">
        ${tempos.map(t => `<div class="studio-chip tempo-chip" data-value="${t.name}" style="${chipStyle}"><span>${t.emoji}</span><span>${t.name}</span></div>`).join('')}
      </div>
      
      <div style="${sectionTitleStyle}">What's the Song About?</div>
      <div style="${sectionSubStyle}">Describe your song idea (optional)</div>
      <textarea class="studio-topic" placeholder="e.g. A summer road trip with friends, falling in love on a rainy day, celebrating a victory..." style="width:100%;box-sizing:border-box;min-height:60px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:10px 12px;color:#e8eef4;font-size:12px;font-family:inherit;resize:vertical;outline:none;transition:border-color 0.2s;"></textarea>
      
      <div style="display:flex;gap:10px;margin-top:14px;">
        <button class="studio-create-btn" style="flex:1;padding:12px 20px;border-radius:12px;border:none;background:linear-gradient(135deg,#00ff88,#00cc6a);color:#000;font-size:14px;font-weight:700;cursor:pointer;transition:all 0.2s;opacity:0.4;pointer-events:none;">🎵 Create Song</button>
        <button class="studio-surprise-btn" style="padding:12px 16px;border-radius:12px;border:1px solid rgba(0,255,136,0.3);background:rgba(0,255,136,0.08);color:#00ff88;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s;">🎲 Surprise Me</button>
      </div>
      
      <div class="studio-preview" style="margin-top:10px;padding:8px 12px;background:rgba(0,0,0,0.2);border-radius:8px;font-size:11px;color:#556677;display:none;">
        <span style="color:#00ff88;">Preview:</span> <span class="preview-text"></span>
      </div>
    </div>
  `;
  
  thread.appendChild(studio);
  
  const img2musicChips = {
    'happy': 'Happy, upbeat, bright and energetic',
    'chill': 'Calm, relaxing, smooth and ambient',
    'epic': 'Epic, powerful, cinematic and orchestral',
    'dark': 'Dark, mysterious, deep and atmospheric',
    'romantic': 'Romantic, warm, gentle and emotional',
    'mysterious': 'Mysterious, ethereal, haunting and enchanting'
  };
  
  const img2musicDesc = studio.querySelector('.img2music-desc');
  
  Object.keys(img2musicChips).forEach(mood => {
    const btn = studio.querySelector(`.img2music-${mood}`);
    if (btn && img2musicDesc) {
      btn.addEventListener('click', () => {
        const current = img2musicDesc.value.trim();
        if (current) {
          img2musicDesc.value = current + ', ' + img2musicChips[mood].toLowerCase();
        } else {
          img2musicDesc.value = img2musicChips[mood];
        }
        btn.style.background = btn.style.background.includes('0.08') ? btn.style.borderColor.replace('0.3', '0.15') : btn.style.background;
        btn.style.opacity = '0.5';
      });
    }
  });
  
  const img2musicGoBtn = studio.querySelector('.img2music-go');
  if (img2musicGoBtn) {
    img2musicGoBtn.addEventListener('click', () => {
      const userNotes = img2musicDesc ? img2musicDesc.value.trim() : '';
      let prompt = 'Create music inspired by this image.';
      if (userNotes) {
        prompt = `Create music inspired by this image. Style notes: ${userNotes}. Make it a complete, polished musical piece.`;
      } else {
        prompt = 'Create music that perfectly captures the mood, atmosphere, emotion, and colors of this image. Choose the best genre, tempo, and instruments automatically. Make it a complete, polished musical piece.';
      }
      const inputEl = document.getElementById('chatInput');
      if (inputEl) {
        inputEl.value = prompt;
        const sendBtn = document.getElementById('sendBtn');
        if (sendBtn) sendBtn.click();
      }
      studio.style.opacity = '0.5';
      studio.style.pointerEvents = 'none';
    });
  }
  
  let selectedGenre = null;
  let selectedMood = null;
  let selectedTempo = null;
  
  function updatePreview() {
    const preview = studio.querySelector('.studio-preview');
    const previewText = studio.querySelector('.preview-text');
    const createBtn = studio.querySelector('.studio-create-btn');
    const topic = studio.querySelector('.studio-topic').value.trim();
    
    if (selectedGenre) {
      const parts = [];
      if (selectedMood) parts.push(`${selectedMood.toLowerCase()}`);
      parts.push(`${selectedGenre.toLowerCase()} song`);
      if (selectedTempo) parts.push(`at a ${selectedTempo.toLowerCase()} tempo`);
      if (topic) parts.push(`about ${topic}`);
      
      previewText.textContent = parts.join(' ');
      preview.style.display = 'block';
      createBtn.style.opacity = '1';
      createBtn.style.pointerEvents = 'auto';
    } else {
      preview.style.display = 'none';
      createBtn.style.opacity = '0.4';
      createBtn.style.pointerEvents = 'none';
    }
  }
  
  function handleChipClick(container, chipClass, callback) {
    studio.querySelectorAll(`.${chipClass}`).forEach(chip => {
      chip.addEventListener('click', () => {
        const wasActive = chip.style.background.includes('rgba(0, 255, 136');
        studio.querySelectorAll(`.${chipClass}`).forEach(c => {
          c.style.background = 'rgba(255,255,255,0.04)';
          c.style.borderColor = 'rgba(255,255,255,0.1)';
          c.style.color = '#ccd6e0';
          c.style.transform = '';
        });
        if (!wasActive) {
          chip.style.background = 'rgba(0,255,136,0.15)';
          chip.style.borderColor = 'rgba(0,255,136,0.4)';
          chip.style.color = '#00ff88';
          chip.style.transform = 'scale(1.05)';
          callback(chip.dataset.value);
        } else {
          callback(null);
        }
        updatePreview();
      });
      
      chip.addEventListener('mouseenter', () => {
        if (!chip.style.background.includes('rgba(0, 255, 136')) {
          chip.style.background = 'rgba(255,255,255,0.08)';
        }
      });
      chip.addEventListener('mouseleave', () => {
        if (!chip.style.background.includes('rgba(0, 255, 136')) {
          chip.style.background = 'rgba(255,255,255,0.04)';
        }
      });
    });
  }
  
  handleChipClick(studio, 'genre-chip', v => { selectedGenre = v; });
  handleChipClick(studio, 'mood-chip', v => { selectedMood = v; });
  handleChipClick(studio, 'tempo-chip', v => { selectedTempo = v; });
  
  studio.querySelector('.studio-topic').addEventListener('input', updatePreview);
  
  studio.querySelector('.studio-create-btn').addEventListener('click', () => {
    if (!selectedGenre) return;
    
    const topic = studio.querySelector('.studio-topic').value.trim();
    let prompt = `Create a ${selectedGenre.toLowerCase()} song`;
    if (selectedMood) prompt += ` with a ${selectedMood.toLowerCase()} mood`;
    if (selectedTempo) prompt += ` at a ${selectedTempo.toLowerCase()} tempo`;
    if (topic) prompt += `. The song is about: ${topic}`;
    prompt += `. Make it sound professional and polished with clear structure (intro, verse, chorus, verse, chorus, outro).`;
    
    const inputEl = document.getElementById('chatInput');
    if (inputEl) {
      inputEl.value = prompt;
      const sendBtn = document.getElementById('sendBtn');
      if (sendBtn) sendBtn.click();
    }
    
    studio.style.opacity = '0.5';
    studio.style.pointerEvents = 'none';
  });
  
  studio.querySelector('.studio-surprise-btn').addEventListener('click', () => {
    const rGenre = genres[Math.floor(Math.random() * genres.length)];
    const rMood = moods[Math.floor(Math.random() * moods.length)];
    const rTempo = tempos[Math.floor(Math.random() * tempos.length)];
    
    const surpriseTopics = [
      'dancing under the stars on a warm summer night',
      'a journey through a neon-lit city at midnight',
      'finding courage to chase your dreams',
      'memories of childhood and growing up',
      'the feeling of freedom on an open road',
      'falling in love unexpectedly',
      'overcoming challenges and rising stronger',
      'a party that never ends',
      'nature and the beauty of the ocean',
      'missing someone far away'
    ];
    const rTopic = surpriseTopics[Math.floor(Math.random() * surpriseTopics.length)];
    
    selectedGenre = rGenre.name;
    selectedMood = rMood.name;
    selectedTempo = rTempo.name;
    
    studio.querySelectorAll('.genre-chip').forEach(c => {
      const match = c.dataset.value === rGenre.name;
      c.style.background = match ? 'rgba(0,255,136,0.15)' : 'rgba(255,255,255,0.04)';
      c.style.borderColor = match ? 'rgba(0,255,136,0.4)' : 'rgba(255,255,255,0.1)';
      c.style.color = match ? '#00ff88' : '#ccd6e0';
      c.style.transform = match ? 'scale(1.05)' : '';
    });
    studio.querySelectorAll('.mood-chip').forEach(c => {
      const match = c.dataset.value === rMood.name;
      c.style.background = match ? 'rgba(0,255,136,0.15)' : 'rgba(255,255,255,0.04)';
      c.style.borderColor = match ? 'rgba(0,255,136,0.4)' : 'rgba(255,255,255,0.1)';
      c.style.color = match ? '#00ff88' : '#ccd6e0';
      c.style.transform = match ? 'scale(1.05)' : '';
    });
    studio.querySelectorAll('.tempo-chip').forEach(c => {
      const match = c.dataset.value === rTempo.name;
      c.style.background = match ? 'rgba(0,255,136,0.15)' : 'rgba(255,255,255,0.04)';
      c.style.borderColor = match ? 'rgba(0,255,136,0.4)' : 'rgba(255,255,255,0.1)';
      c.style.color = match ? '#00ff88' : '#ccd6e0';
      c.style.transform = match ? 'scale(1.05)' : '';
    });
    
    studio.querySelector('.studio-topic').value = rTopic;
    updatePreview();
    
    studio.querySelector('.studio-surprise-btn').textContent = '🎲 Again!';
  });
}

const SYSTEM_PROMPT = getConfig('SYSTEM_PROMPT', "You are a professional assistant. Give COMPLETE, DIRECT answers in natural human language. Never truncate or ask 'would you like more?' Be thorough but concise. Use **bold** for key insights, headers for sections, bullets for clarity. NEVER ask follow-up questions. NEVER output raw JSON, bounding boxes, coordinates, box_2d data, or any machine-readable detection format. Always respond in plain, readable text that a human can understand.");

const SMART_SYSTEM_PROMPT = getConfig('SMART_SYSTEM_PROMPT', "You are a professional assistant. I'm providing webpage text for accuracy and screenshots for visual context. Give COMPLETE, DIRECT answers in natural human language. Never truncate. Be thorough but concise. Use **bold** for key insights, headers for sections, bullets for clarity. NEVER ask follow-up questions. NEVER output raw JSON, bounding boxes, coordinates, box_2d data, or any machine-readable detection format. Always respond in plain, readable text.");

const MULTI_IMAGE_PROMPT = getConfig('MULTI_IMAGE_PROMPT', "You are a professional assistant. I'm providing multiple screenshots that together show the full picture. Analyze ALL images together. Give COMPLETE, DIRECT answers in natural human language. Never truncate. Be thorough but concise. Use **bold** for key insights, headers for sections, bullets for clarity. NEVER ask follow-up questions. NEVER output raw JSON, bounding boxes, coordinates, box_2d data, or any machine-readable detection format. Always respond in plain, readable text.");

// Get images from IndexedDB (unlimited storage) or fallback to session storage
async function initializeChat() {
  const urlParams = new URLSearchParams(window.location.search);
  const count = urlParams.get('count');
  const isDirect = urlParams.get('direct') === 'true';
  const isContextMenu = urlParams.get('source') === 'contextmenu';
  
  // Get metadata from session storage
  const result = await chrome.storage.session.get(['pageText', 'useIndexedDB', 'selectedSnaps', 'selectedSnap', 'askAiPayload']);
  currentPageText = result.pageText || '';

  if (isContextMenu) {
    const storageError = urlParams.get('error');
    if (storageError === 'storage') {
      currentImages = [];
      const previewContainer = document.querySelector('.image-preview');
      previewContainer.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #ff6b6b;">
          <div style="font-size: 42px; margin-bottom: 8px;">⚠️</div>
          <div style="font-size: 14px; font-weight: 600;">Couldn't load page context</div>
          <div style="font-size: 11px; color: #889999; margin-top: 8px; line-height: 1.5;">
            Storage limit reached. Try right-clicking again<br>or use the AI button in the popup instead.
          </div>
        </div>
      `;
      setupMagicButtons();
      document.getElementById('chatInput').focus();
      return;
    }

    if (!result.askAiPayload) {
      currentImages = [];
      const previewContainer = document.querySelector('.image-preview');
      previewContainer.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #ff6b6b;">
          <div style="font-size: 42px; margin-bottom: 8px;">⚠️</div>
          <div style="font-size: 14px; font-weight: 600;">Context not found</div>
          <div style="font-size: 11px; color: #889999; margin-top: 8px; line-height: 1.5;">
            Page context expired or failed to load.<br>Please right-click the page again to retry.
          </div>
        </div>
      `;
      setupMagicButtons();
      document.getElementById('chatInput').focus();
      return;
    }

    console.log('[SnapToAI] Context menu mode - auto-analyzing');
    const payload = result.askAiPayload;
    const ctx = payload.context || {};

    if (payload.screenshot) {
      currentImages = [payload.screenshot];
      const previewContainer = document.querySelector('.image-preview');
      const placeholder = document.getElementById('imagePlaceholder');
      if (placeholder) placeholder.style.display = 'none';
      document.getElementById('previewImage').src = payload.screenshot;
    }

    let contextInfo = '';
    if (ctx.url) contextInfo += `**Page:** ${ctx.title || ctx.url}\n`;
    if (ctx.selectedText) contextInfo += `**Selected text:** ${ctx.selectedText.substring(0, 3000)}\n`;
    if (ctx.linkUrl) contextInfo += `**Link:** ${ctx.linkUrl}\n`;
    if (ctx.srcUrl) contextInfo += `**Image source:** ${ctx.srcUrl}\n`;

    let codeContext = '';
    if (ctx.visibleCodeBlocks && ctx.visibleCodeBlocks.length > 0 && !ctx.selectedText) {
      codeContext = '\n\n**Code visible on page:**\n```\n' + ctx.visibleCodeBlocks.join('\n---\n').substring(0, 4000) + '\n```';
    }

    const fallback = DEFAULT_MAGIC_BUTTONS.find(b => b.isFallback) || DEFAULT_MAGIC_BUTTONS[0];
    let autoPrompt = fallback.prompt;
    if (ctx.selectedText) {
      autoPrompt += `\n\nSelected text: ${ctx.selectedText.substring(0, 3000)}`;
    }
    if (contextInfo) {
      autoPrompt += `\n\n${contextInfo}`;
    }
    if (codeContext) {
      autoPrompt += codeContext;
    }

    setupMagicButtons();
    if (typeof updateVerdictButtonVisibility === 'function') {
      updateVerdictButtonVisibility();
    }

    try { await chrome.storage.session.remove('askAiPayload'); } catch (e) { console.log('[SnapToAI] Cleanup note:', e.message); }

    setTimeout(() => {
      const chatInput = document.getElementById('chatInput');
      if (chatInput) {
        chatInput.value = autoPrompt;
        handleSend();
      }
    }, 500);
    return;
  }

  // Direct mode - no images needed
  if (isDirect) {
    console.log('[SnapToAI] Direct AI mode - no images');
    currentImages = [];
    const previewContainer = document.querySelector('.image-preview');
    previewContainer.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #8899aa;">
        <div style="font-size: 42px; margin-bottom: 8px;">✨</div>
        <div style="font-size: 14px; font-weight: 600; color: #00d9ff;">Analyze Images with AI</div>
        <div style="font-size: 11px; color: #889999; margin-top: 8px; line-height: 1.5;">
          Select <b>one or multiple</b> images<br>
          from your queue, then click AI
        </div>
        <div style="font-size: 10px; color: #667788; margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);">
          Or drop images here • Ask anything
        </div>
      </div>
    `;
    document.getElementById('chatInput').focus();
    setupMagicButtons();
    if (typeof updateVerdictButtonVisibility === 'function') {
      updateVerdictButtonVisibility();
    }
    return;
  }
  
  // Load images with retry logic for race conditions
  let imagesToUse = [];
  const maxRetries = 3;
  
  for (let attempt = 0; attempt < maxRetries && imagesToUse.length === 0; attempt++) {
    if (attempt > 0) {
      console.log('[SnapToAI] Retry attempt', attempt + 1);
      await new Promise(r => setTimeout(r, 200)); // Brief wait between retries
    }
    
    // Try IndexedDB first (primary storage for large captures)
    if (result.useIndexedDB) {
      console.log('[SnapToAI] Loading images from IndexedDB (unlimited storage)');
      imagesToUse = await loadImagesFromIndexedDB();
    }
    
    // Fallback to session storage
    if (imagesToUse.length === 0) {
      imagesToUse = result.selectedSnaps || [];
      if (imagesToUse.length === 0 && result.selectedSnap) {
        imagesToUse = [result.selectedSnap];
      }
    }
  }
  
  console.log('[SnapToAI] Loaded', imagesToUse.length, 'images for AI chat');
  
  if (imagesToUse.length > 0) {
    currentImages = imagesToUse;
    const previewContainer = document.querySelector('.image-preview');
    const placeholder = document.getElementById('imagePlaceholder');
    
    // Hide placeholder when we have images
    if (placeholder) placeholder.style.display = 'none';
    
    if (currentImages.length === 1) {
      // Single image - show as before
      document.getElementById('previewImage').src = currentImages[0];
    } else {
      // Multiple images - show grid
      previewContainer.innerHTML = '<div class="multi-image-grid" id="multiImageGrid"></div>';
      const grid = document.getElementById('multiImageGrid');
      currentImages.forEach((img, i) => {
        const imgEl = document.createElement('img');
        imgEl.src = img;
        imgEl.alt = `Screenshot ${i + 1}`;
        imgEl.className = 'grid-image';
        imgEl.title = `Screenshot ${i + 1} of ${currentImages.length}`;
        grid.appendChild(imgEl);
      });
      // Add info badge
      const badge = document.createElement('div');
      badge.className = 'multi-image-badge';
      badge.textContent = `${currentImages.length} screenshots`;
      previewContainer.appendChild(badge);
    }
  } else {
    // No images - show the placeholder (it's already in HTML)
    const placeholder = document.getElementById('imagePlaceholder');
    if (placeholder) placeholder.style.display = 'flex';
    document.getElementById('previewImage').style.display = 'none';
  }
  
  // Focus input
  document.getElementById('chatInput').focus();
  
  // Setup magic buttons
  setupMagicButtons();
  
  // Update verdict button visibility
  if (typeof updateVerdictButtonVisibility === 'function') {
    updateVerdictButtonVisibility();
  }

  const isImg2Music = urlParams.get('img2music') === 'true';
  if (isImg2Music && currentImages.length > 0) {
    console.log('[SnapToAI] Image-to-Music mode - auto-sending');
    setTimeout(() => {
      const chatInput = document.getElementById('chatInput');
      if (chatInput) {
        chatInput.value = 'Create music that perfectly captures the mood, atmosphere, emotion, and colors of this image. Choose the best genre, tempo, and instruments automatically. Make it a complete, polished musical piece.';
        handleSend();
      }
    }, 600);
    return;
  }

  // Check trial status — show upgrade modal if expired (non-blocking)
  setTimeout(async () => {
    if (!window.SnapToAISubscription) return;
    const { snaptoai_dev_override } = await chrome.storage.local.get(['snaptoai_dev_override']);
    if (snaptoai_dev_override) return;
    const sub = await window.SnapToAISubscription.check();
    if (sub.status === 'trial_expired' || sub.status === 'subscription_expired') {
      showTrialEndedModal(sub.status);
    }
  }, 600);
}

// Template logic for Magic Buttons
function getPromptForTemplate(category, template) {
  if (window.SNAPTOAI_PROMPTS && window.SNAPTOAI_PROMPTS[template]) {
    return window.SNAPTOAI_PROMPTS[template];
  }
  
  // Fallback to old logic if prompts.js fails to load
  const fallbacks = {
    "Price Comparison": "Analyze this product and find if it's a good deal.",
    "Expense Audit": "Extract all items and prices from this receipt.",
    "Code Review": "Review the code in this screenshot.",
    "Explain This": "Explain the concept shown in this screenshot as if I am 10 years old."
  };
  return fallbacks[template] || `Analyze this ${category} screenshot and help me with ${template}.`;
}

// Add event listeners for magic buttons
function setupMagicButtons() {
  document.querySelectorAll('.category-item').forEach(item => {
    item.addEventListener('click', () => {
      const category = item.closest('.category-group').querySelector('h4').textContent;
      const template = item.querySelector('span').textContent;
      const prompt = getPromptForTemplate(category, template);
      
      // Look for a hint in default buttons or user buttons
      const btnData = magicButtons.find(b => b.name === template);
      const hint = btnData?.hint || "";
      
      const input = document.getElementById('chatInput');
      if (hint) {
        input.placeholder = hint;
      } else {
        input.placeholder = "Ask about your screenshot...";
      }
      
      input.value = prompt;
      // handleSend() already adds the thinking bubble, so we just call it directly
      handleSend();
    });
  });
}

// Add chat bubble
function addBubble(text, type) {
  const thread = document.getElementById('chatThread');
  const welcome = thread.querySelector('.welcome-message');
  if (welcome) welcome.remove();
  
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble ' + type;
  bubble.textContent = text;
  thread.appendChild(bubble);
  thread.scrollTop = thread.scrollHeight;
  return bubble;
}

// Add thinking bubble with star animation
function addThinkingBubble() {
  const thread = document.getElementById('chatThread');
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble loading';
  bubble.innerHTML = '<div class="star"></div><span>Gemini is thinking...</span>';
  thread.appendChild(bubble);
  thread.scrollTop = thread.scrollHeight;
}

// Remove loading bubble
function removeLoading() {
  const thread = document.getElementById('chatThread');
  const loading = thread.querySelector('.chat-bubble.loading');
  if (loading) loading.remove();
}

// Send message to Gemini API (supports multiple images)
async function sendToGemini(prompt, imageDataUrls) {
  const images = Array.isArray(imageDataUrls) ? imageDataUrls : [imageDataUrls];
  
  if (window.SnapToAISubscription) {
    const { snaptoai_dev_override } = await chrome.storage.local.get(['snaptoai_dev_override']);
    if (!snaptoai_dev_override) {
      const sub = await window.SnapToAISubscription.check();
      if (sub.status === 'trial_expired' || sub.status === 'subscription_expired') {
        showTrialEndedModal(sub.status);
        throw new Error('__trial_ended__');
      }
    }
  }
  
  const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
  const apiKey = keyResult.geminiApiKey;
  
  if (!apiKey) {
    throw new Error('Please set your Gemini API key in Settings');
  }
  
  // Build conversation
  const contents = [];
  
  for (const msg of conversationHistory) {
    const msgParts = [{ text: msg.text }];
    if (msg.images) {
      for (const imgUrl of msg.images) {
        const base64Data = imgUrl.split(',')[1];
        const mimeType = imgUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
        msgParts.unshift({ inlineData: { mimeType, data: base64Data } });
      }
    }
    contents.push({ role: msg.role, parts: msgParts });
  }
  
  const userParts = [];
  if (images.length > 0 && images[0]) {
    for (const imageDataUrl of images) {
      const base64Data = imageDataUrl.split(',')[1];
      const mimeType = imageDataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      userParts.push({ inlineData: { mimeType, data: base64Data } });
    }
  }
  userParts.push({ text: prompt });
  contents.push({ role: 'user', parts: userParts });
  
  // Use multi-image prompt if multiple images
  const systemPrompt = images.length > 1 ? MULTI_IMAGE_PROMPT : SYSTEM_PROMPT;
  
  // Wait for rate limit before making request
  await waitForRateLimit();
  
  const selectedModel = await getSelectedModel();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: systemPrompt
          }]
        },
        contents: contents,
        generationConfig: {
          maxOutputTokens: getConfig('MAX_OUTPUT_TOKENS', 2048),
          temperature: getConfig('TEMPERATURE', 0.7),
          topP: 0.95,
          topK: 40
        }
      })
    }
  );
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `API Error: ${response.status}`);
  }
  
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!text) {
    throw new Error('No response from AI');
  }
  
  const historyEntry = { role: 'user', text: prompt };
  if (conversationHistory.length === 0 && images.length > 0 && images[0]) {
    historyEntry.images = images;
  }
  conversationHistory.push(historyEntry);
  conversationHistory.push({ role: 'model', text: text });
  
  return text;
}

// Handle send with streaming
async function handleSend() {
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const thread = document.getElementById('chatThread');
  const prompt = input.value.trim();
  
  if (!prompt) return;

  if (!acquireRequestLock()) {
    addBubble('Please wait for the current request to complete...', 'ai');
    return;
  }

  // Immediately clear input and show user message — no waiting
  input.value = '';
  resetInputSize(input);
  sendBtn.disabled = true;
  addBubble(prompt, 'user');

  // Subscription check after visual feedback so UI feels instant
  if (window.SnapToAISubscription) {
    const { snaptoai_dev_override } = await chrome.storage.local.get(['snaptoai_dev_override']);
    if (!snaptoai_dev_override) {
      const sub = await window.SnapToAISubscription.check();
      if (sub.status === 'trial_expired' || sub.status === 'subscription_expired') {
        releaseRequestLock();
        sendBtn.disabled = false;
        showTrialEndedModal(sub.status);
        return;
      }
    }
  }

  addThinkingBubble();

  const createResponseBubble = () => {
    removeLoading();
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble ai';
    thread.appendChild(bubble);
    return bubble;
  };

  // Allow browser to paint before heavy processing
  await new Promise(r => requestAnimationFrame(r));
  
  try {
    const modeConfig = AI_MODES[currentAiMode] || AI_MODES['vision'];

    const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
    const apiKey = keyResult.geminiApiKey;

    if (modeConfig.type === 'gemini-video') {
      const clipCount = selectedClipCount || 1;
      const costInfo = getPaidModeEstimate('video', clipCount, selectedVideoDuration || 8);
      const ok = await confirmPaidGeneration('video', costInfo);
      if (!ok) {
        removeLoading();
        sendBtn.disabled = false;
        releaseRequestLock();
        return;
      }
      removeLoading();
      await startVideoGeneration(prompt, thread);
      conversationHistory.push({ role: 'user', text: prompt });
      conversationHistory.push({ role: 'model', text: '[Video generation started]' });
      sendBtn.disabled = false;
      input.focus();
      releaseRequestLock();
      return;
    }
    
    if (!apiKey) {
      try {
        let imageBase64 = '';
        if (currentImages.length > 0 && currentImages[0]) {
          imageBase64 = currentImages[0].split(',')[1] || '';
        }
        const proxyResult = await sendViaProxy(prompt, imageBase64);
        removeLoading();
        const aiText = proxyResult.text || 'No response';
        const proxyBubble = document.createElement('div');
        proxyBubble.className = 'chat-bubble ai';
        if (typeof marked !== 'undefined') {
          const parsed = marked.parse(aiText);
          proxyBubble.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(parsed) : parsed;
          proxyBubble.querySelectorAll('a').forEach(link => {
            link.setAttribute('target', '_blank');
            link.setAttribute('rel', 'noopener noreferrer');
          });
        } else {
          proxyBubble.textContent = aiText;
        }
        thread.appendChild(proxyBubble);
        addBubbleActions(proxyBubble, aiText);
        thread.scrollTop = thread.scrollHeight;
        conversationHistory.push({ role: 'user', text: prompt });
        conversationHistory.push({ role: 'model', text: aiText });
        
        if (proxyResult.remaining !== undefined) {
          const remaining = proxyResult.remaining;
          const limit = proxyResult.limit || 5;
          
          if (remaining === 0) {
            showPromptToast('Last free prompt today! Get your own Gemini key for unlimited access.', 5000, true);
            setTimeout(() => showProxyKeyPrompt(), 1500);
          } else if (remaining === 1) {
            showPromptToast('⚠️ 1 free prompt left today — get your own Gemini key for unlimited', 5000, true);
          } else if (remaining === 2) {
            showPromptToast(`📊 2 of ${limit} free prompts left today. Get your own key for unlimited!`, 4000);
          } else {
            showPromptToast(`📊 ${remaining} of ${limit} free prompts today`, 3000);
          }
        }
        sendBtn.disabled = false;
        releaseRequestLock();
        return;
      } catch (proxyErr) {
        if (proxyErr.message === 'FREE_PROMPTS_EXHAUSTED') {
          removeLoading();
          const exhaustedBubble = createResponseBubble();
          exhaustedBubble.innerHTML = buildDailyLimitCard();
          thread.scrollTop = thread.scrollHeight;
          sendBtn.disabled = false;
          releaseRequestLock();
          return;
        }
        removeLoading();
        const msg = proxyErr.message || '';
        const errBubble = createResponseBubble();
        if (msg === 'PROXY_BUSY' || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('wait') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('busy')) {
          errBubble.innerHTML = buildRateLimitCard();
        } else {
          errBubble.innerHTML = buildNoKeyCard();
        }
        thread.scrollTop = thread.scrollHeight;
        sendBtn.disabled = false;
        releaseRequestLock();
        return;
      }
    }
    
    const contents = [];
    for (const msg of conversationHistory) {
      const msgParts = [{ text: msg.text }];
      if (msg.images) {
        for (const imgUrl of msg.images) {
          const base64Data = imgUrl.split(',')[1];
          const mimeType = imgUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
          msgParts.unshift({ inlineData: { mimeType, data: base64Data } });
        }
      }
      contents.push({ role: msg.role, parts: msgParts });
    }
    
    const userParts = [];
    const MAX_IMAGES_PER_REQUEST = getConfig('MAX_IMAGES_PER_REQUEST', 30);
    const isFirstMessage = contents.length === 0;
    
    if (isFirstMessage) {
      const totalImages = currentImages.length;
      
      if (totalImages > MAX_IMAGES_PER_REQUEST) {
        // Large capture: process in batches
        console.log(`[SnapToAI] Large capture detected: ${totalImages} images, processing in batches of ${MAX_IMAGES_PER_REQUEST}`);
        
        // Show batch processing message
        removeLoading();
        const batchInfo = document.createElement('div');
        batchInfo.className = 'chat-bubble ai batch-progress';
        batchInfo.innerHTML = `📊 <strong>Processing ${totalImages} screenshots in batches...</strong><br>This may take a moment for rate limiting.`;
        thread.appendChild(batchInfo);
        thread.scrollTop = thread.scrollHeight;
        
        // Process batches sequentially
        let allBatchResults = [];
        const numBatches = Math.ceil(totalImages / MAX_IMAGES_PER_REQUEST);
        
        for (let batchNum = 0; batchNum < numBatches; batchNum++) {
          const start = batchNum * MAX_IMAGES_PER_REQUEST;
          const end = Math.min(start + MAX_IMAGES_PER_REQUEST, totalImages);
          const batchImages = currentImages.slice(start, end);
          
          // Update progress
          batchInfo.innerHTML = `📊 <strong>Processing batch ${batchNum + 1}/${numBatches}</strong> (images ${start + 1}-${end} of ${totalImages})...<br>Please wait for rate limiting.`;
          
          // Build batch request
          const batchParts = [];
          for (const imgUrl of batchImages) {
            const base64Data = imgUrl.split(',')[1];
            const mimeType = imgUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
            batchParts.push({ inlineData: { mimeType: mimeType, data: base64Data } });
          }
          
          const batchPrompt = batchNum === 0 
            ? `[BATCH ${batchNum + 1}/${numBatches}: Images ${start + 1}-${end}]\n\n${prompt}\n\nNote: This is a large capture split into ${numBatches} batches. Analyze this batch and I'll combine results.`
            : `[BATCH ${batchNum + 1}/${numBatches}: Images ${start + 1}-${end}]\n\nContinue analysis for this batch of the same capture. Focus on new details in these images.`;
          
          batchParts.push({ text: batchPrompt });
          
          try {
            // Wait for rate limit before batch request
            await waitForRateLimit();
            
            const batchModel = await getSelectedModel();
            const batchResponse = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${batchModel}:generateContent?key=${apiKey}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  systemInstruction: { parts: [{ text: MULTI_IMAGE_PROMPT }] },
                  contents: [{ role: 'user', parts: batchParts }],
                  generationConfig: { maxOutputTokens: getConfig('MAX_OUTPUT_TOKENS_BATCH', 1500), temperature: getConfig('TEMPERATURE', 0.7) }
                })
              }
            );
            
            if (batchResponse.ok) {
              const batchData = await batchResponse.json();
              const batchText = batchData.candidates?.[0]?.content?.parts?.[0]?.text || '';
              allBatchResults.push(`## Batch ${batchNum + 1} (Images ${start + 1}-${end})\n${batchText}`);
            } else {
              const batchErrBody = await batchResponse.json().catch(() => ({}));
              const batchErrMsg = batchErrBody.error?.message || '';
              const batchErrLower = batchErrMsg.toLowerCase();
              if (batchResponse.status === 429 || batchErrLower.includes('quota') || batchErrLower.includes('rate') || batchErrLower.includes('exceeded') || batchErrLower.includes('resource')) {
                batchInfo.remove();
                const quotaBatchBubble = createResponseBubble();
                quotaBatchBubble.innerHTML = buildRateLimitCard();
                thread.scrollTop = thread.scrollHeight;
                sendBtn.disabled = false;
                releaseRequestLock();
                return;
              }
              allBatchResults.push(`## Batch ${batchNum + 1}\nFailed to process this batch.`);
            }
          } catch (batchError) {
            const batchCatchLower = batchError.message?.toLowerCase() || '';
            if (batchCatchLower.includes('quota') || batchCatchLower.includes('rate') || batchCatchLower.includes('exceeded')) {
              batchInfo.remove();
              const quotaBatchBubble2 = createResponseBubble();
              quotaBatchBubble2.innerHTML = buildRateLimitCard();
              thread.scrollTop = thread.scrollHeight;
              sendBtn.disabled = false;
              releaseRequestLock();
              return;
            }
            allBatchResults.push(`## Batch ${batchNum + 1}\nError processing this batch.`);
          }
          
          // Rate limit delay between batches (except last) - 6s to respect API limits
          if (batchNum < numBatches - 1) {
            batchInfo.innerHTML = `📊 <strong>Batch ${batchNum + 1}/${numBatches} complete!</strong><br>Waiting for rate limit...`;
            await new Promise(r => setTimeout(r, 6000));
          }
        }
        
        // Remove batch progress and show combined results
        batchInfo.remove();
        
        const responseBubble = document.createElement('div');
        responseBubble.className = 'chat-bubble ai';
        const combinedResult = `# Full Page Analysis (${totalImages} screenshots)\n\n${allBatchResults.join('\n\n---\n\n')}`;
        responseBubble.innerHTML = typeof marked !== 'undefined' ? (typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(marked.parse(combinedResult)) : marked.parse(combinedResult)) : combinedResult;
        thread.appendChild(responseBubble);
        addBubbleActions(responseBubble, combinedResult);
        thread.scrollTop = thread.scrollHeight;
        
        const batchHistoryEntry = { role: 'user', text: prompt };
        if (currentImages.length > 0) batchHistoryEntry.images = currentImages;
        conversationHistory.push(batchHistoryEntry);
        conversationHistory.push({ role: 'model', text: combinedResult });
        
        sendBtn.disabled = false;
        input.focus();
        return;
      }
      
      // Normal case: 20 or fewer images - send all at once
      for (const imgUrl of currentImages) {
        const base64Data = imgUrl.split(',')[1];
        const mimeType = imgUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
        userParts.push({ inlineData: { mimeType: mimeType, data: base64Data } });
      }
      // If we have page text, include it for smarter analysis
      if (currentPageText && currentPageText.length > 800) {
        userParts.push({ text: `[PAGE TEXT FOR CONTEXT]:\n${currentPageText}\n\n[USER QUESTION]: ${prompt}` });
      } else {
        userParts.push({ text: prompt });
      }
    } else {
      userParts.push({ text: prompt });
    }
    
    // Attach all queued files (multi-file Gemini-style)
    if (filesQueue && filesQueue.length > 0) {
      filesQueue.forEach(f => {
        userParts.push({ inlineData: { mimeType: f.mimeType, data: f.data } });
      });
      clearFilesQueue();
    }
    
    contents.push({ role: 'user', parts: userParts });
    
    await waitForRateLimit();
    
    let fullText = '';


    if (modeConfig.type === 'gemini-image') {
      // === IMAGE GENERATION (via generateContent with responseModalities) ===
      const imageModels = [
        'gemini-3-flash-preview',
        'gemini-2.5-flash-image',
        'gemini-3-pro-image-preview'
      ];
      
      let lastResponseData = null;
      let lastError = '';
      let succeeded = false;
      
      // Build image-mode parts: attach any queued screenshots so the model can
      // see them (image-to-image editing). If no screenshots, text-to-image only.
      const imgModeParts = [];
      if (currentImages && currentImages.length > 0) {
        // Send up to 4 images; for larger queues use just the first one to stay safe.
        const imagesToSend = currentImages.slice(0, Math.min(currentImages.length, 4));
        for (const imgUrl of imagesToSend) {
          const base64Data = imgUrl.split(',')[1];
          const mimeType = imgUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
          imgModeParts.push({ inlineData: { mimeType, data: base64Data } });
        }
        if (currentImages.length > 4) {
          imgModeParts.push({ text: `[Using first 4 of ${currentImages.length} screenshots for reference]\n${prompt}` });
        } else {
          imgModeParts.push({ text: prompt });
        }
        console.log(`[SnapToAI Image] Attaching ${imagesToSend.length} screenshot(s) as image reference`);
      } else {
        imgModeParts.push({ text: `Generate an image: ${prompt}` });
      }

      for (const modelName of imageModels) {
        for (let attempt = 0; attempt < 3; attempt++) {
          const loadingEl = document.querySelector('.loading-dots');
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
          
          console.log(`[SnapToAI Image] Attempt ${attempt+1}/3 using ${modelName} via generateContent`);
          
          let response;
          try {
            response = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: imgModeParts }],
                generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
              })
            });
          } catch(fetchErr) {
            console.log(`[SnapToAI Image] Fetch error on ${modelName}:`, fetchErr.message);
            lastError = fetchErr.message;
            continue;
          }
          
          const responseBody = await response.json().catch(() => ({}));
          console.log(`[SnapToAI Image] Status: ${response.status}`, JSON.stringify(responseBody).substring(0, 500));
          
          if (response.ok && responseBody.candidates?.[0]?.content?.parts) {
            lastResponseData = responseBody;
            succeeded = true;
            break;
          }
          
          if (response.ok && !responseBody.candidates?.[0]?.content?.parts) {
            const blockReason = responseBody.candidates?.[0]?.finishReason || 
                               responseBody.promptFeedback?.blockReason || '';
            if (blockReason === 'SAFETY' || blockReason === 'BLOCKED') {
              lastError = 'Your prompt was blocked by safety filters. Try rephrasing it.';
            } else {
              lastError = 'The AI couldn\'t generate an image for that prompt. Try a different description.';
            }
            console.log(`[SnapToAI Image] 200 but no image data. Reason: ${blockReason || 'unknown'}`);
            continue;
          }
          
          lastError = responseBody.error?.message || `Status ${response.status}`;
          console.log(`[SnapToAI Image] Error: ${lastError}`);
          
          break;
        }
        
        if (succeeded) break;
        console.log(`[SnapToAI Image] ${modelName} failed, trying next model...`);
      }
      
      if (!succeeded) {
        const friendlyError = lastError?.toLowerCase().includes('failed to fetch') 
          ? 'Connection failed — please check your internet and try again.'
          : (lastError || 'Image generation failed. Please try again.');
        throw new Error(friendlyError);
      }
      
      const responseBubble = createResponseBubble();
      const parts = lastResponseData.candidates[0].content.parts;
      let htmlContent = '';
      let hasImage = false;
      let rawImageSrc = null;
      
      for (const part of parts) {
        if (part.text) {
          fullText += part.text;
        }
        if (part.inlineData) {
          hasImage = true;
          rawImageSrc = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          htmlContent += `<div style="margin:10px 0;" class="generated-image-container"><img class="generated-img" src="${rawImageSrc}" style="max-width:100%;border-radius:12px;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,0.3);" title="Click to save full size"><div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;"><button class="img-save-btn" style="background:rgba(255,107,237,0.15);border:1px solid rgba(255,107,237,0.3);color:#ff6bed;padding:5px 14px;border-radius:8px;font-size:11px;cursor:pointer;transition:all 0.2s;">💾 Save Image</button></div></div>`;
        }
      }
      
      if (hasImage) {
        fullText = fullText || `Generated image: "${prompt}"`;
        htmlContent = `<div style="font-size:13px;color:#aabbcc;margin-bottom:8px;">🎨 ${fullText}</div>` + htmlContent;
      } else {
        htmlContent = '<div style="color:#ff6b6b;">No image was generated. Try a more descriptive prompt.</div>';
      }
      
      responseBubble.innerHTML = htmlContent;
      
      responseBubble.querySelectorAll('.generated-img').forEach(img => {
        img.addEventListener('click', () => {
          const a = document.createElement('a');
          a.href = img.src;
          a.download = 'snaptoai-image.png';
          a.click();
        });
      });
      responseBubble.querySelectorAll('.img-save-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const img = btn.closest('.generated-image-container')?.querySelector('img') || btn.closest('div').parentElement.querySelector('img');
          if (img) {
            const a = document.createElement('a');
            a.href = img.src;
            a.download = 'snaptoai-image.png';
            a.click();
          }
        });
      });
      
      thread.scrollTop = thread.scrollHeight;
      addBubbleActions(responseBubble, fullText);
      
    } else if (modeConfig.type === 'gemini-audio') {
      const costInfo = getPaidModeEstimate('music');
      const ok = await confirmPaidGeneration('music', costInfo);
      if (!ok) {
        removeLoading();
        sendBtn.disabled = false;
        releaseRequestLock();
        return;
      }
      // === MUSIC / AUDIO GENERATION (Lyria or TTS) ===
      const musicModels = [modeConfig.model, 'lyria-3-pro-preview', 'gemini-2.5-flash-preview-tts'];
      let audioData = null;
      let audioError = '';
      let audioSucceeded = false;
      
      for (const audioModel of musicModels) {
        console.log(`[SnapToAI Audio] Trying model: ${audioModel}`);
        
        let bodyPayload;
        const isLyria = audioModel.includes('lyria');
        const isTTS = audioModel.includes('tts');
        
        if (isLyria) {
          const contentParts = [];
          if (currentImages.length > 0) {
            for (const img of currentImages) {
              const [meta, b64] = img.split(',');
              const mime = meta.match(/:(.*?);/)?.[1] || 'image/png';
              contentParts.push({ inlineData: { mimeType: mime, data: b64 } });
            }
            contentParts.push({ text: prompt || 'Create music that captures the mood, atmosphere, and emotion of this image. Make it a complete, polished musical piece.' });
          } else {
            contentParts.push({ text: prompt });
          }
          bodyPayload = {
            contents: [{ role: 'user', parts: contentParts }],
            generationConfig: { responseModalities: ['AUDIO'] }
          };
        } else {
          bodyPayload = {
            contents: [{ role: 'user', parts: [{ text: `Say the following: ${prompt}` }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
            }
          };
        }
        
        try {
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${audioModel}:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(bodyPayload)
            }
          );
          
          const body = await resp.json().catch(() => ({}));
          console.log(`[SnapToAI Audio] ${audioModel} status: ${resp.status}`, JSON.stringify(body).substring(0, 500));
          
          if (resp.ok && body.candidates?.[0]?.content?.parts) {
            const audioParts = body.candidates[0].content.parts;
            const hasRealAudio = audioParts.some(p => p.inlineData?.data && p.inlineData.data.length > 5000);
            if (hasRealAudio) {
              audioData = body;
              audioSucceeded = true;
              console.log(`[SnapToAI Audio] Success with ${audioModel}!`);
              break;
            } else {
              audioError = '__billing_unlock__';
              console.log(`[SnapToAI Audio] ${audioModel} returned parts but no real audio data`);
              continue;
            }
          }
          
          audioError = body.error?.message || `Status ${resp.status}`;
          const isRateLimit = resp.status === 429 || audioError.toLowerCase().includes('rate') || audioError.toLowerCase().includes('quota');
          if (isRateLimit) {
            console.log(`[SnapToAI Audio] Rate limited on ${audioModel}, trying next...`);
          }
        } catch(e) {
          audioError = e.message;
          console.log(`[SnapToAI Audio] ${audioModel} error:`, e.message);
        }
      }
      
      if (!audioSucceeded) {
        if (audioError === '__billing_unlock__' || audioError?.toLowerCase().includes('billing') || audioError?.toLowerCase().includes('permission') || audioError?.toLowerCase().includes('not enabled') || audioError?.toLowerCase().includes('paid tier')) {
          removeLoading();
          const unlockBubble = createResponseBubble();
          unlockBubble.innerHTML = buildUnlockCard('music');
          thread.scrollTop = thread.scrollHeight;
          sendBtn.disabled = false;
          releaseRequestLock();
          return;
        }
        const friendlyAudioError = audioError?.toLowerCase().includes('failed to fetch')
          ? 'Connection failed — please check your internet and try again.'
          : (audioError || 'Music generation failed. Please try again.');
        throw new Error(friendlyAudioError);
      }
      
      const responseBubble = createResponseBubble();
      const data = audioData;
      const parts = data.candidates[0].content.parts;
      console.log(`[SnapToAI Audio] Got ${parts.length} parts`);
      let htmlContent = '';
      let hasAudio = false;
      
      for (const part of parts) {
        if (part.text) {
          fullText += part.text;
          const parsedHtml = typeof marked !== 'undefined' ? marked.parse(part.text) : part.text;
          htmlContent += typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(parsedHtml) : parsedHtml;
        }
        if (part.inlineData && part.inlineData.mimeType?.startsWith('audio') && part.inlineData.data?.length > 5000) {
          hasAudio = true;
          const audioSrc = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          const audioId = 'audio-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
          htmlContent += `<div id="wrap-${audioId}" style="margin:10px 0;">
            <audio id="${audioId}" controls style="width:100%; border-radius:8px; outline:none;" src="${audioSrc}"></audio>
            <div style="margin-top:8px; display:flex; gap:8px;">
              <button class="audio-save-btn" style="background:rgba(0,255,136,0.15);border:1px solid rgba(0,255,136,0.3);color:#00ff88;padding:5px 14px;border-radius:8px;font-size:11px;cursor:pointer;transition:all 0.2s;">💾 Save Audio</button>
            </div>
          </div>`;
          setTimeout(() => {
            const audioEl = document.getElementById(audioId);
            if (!audioEl) return;
            const checkDuration = () => {
              if (audioEl.duration === 0 || isNaN(audioEl.duration)) {
                const wrap = document.getElementById('wrap-' + audioId);
                if (wrap) {
                  wrap.closest('.chat-bubble')?.remove();
                  const retryBubble = createResponseBubble();
                  retryBubble.innerHTML = buildMusicRetryCard();
                  thread.scrollTop = thread.scrollHeight;
                }
              }
            };
            audioEl.addEventListener('loadedmetadata', checkDuration);
            setTimeout(checkDuration, 3000);
          }, 100);
        }
      }
      
      if (!hasAudio && !fullText) {
        htmlContent = buildMusicRetryCard();
      } else if (!hasAudio) {
        htmlContent = `<div style="font-size:13px;color:#aabbcc;">${fullText}</div>`;
      } else {
        fullText = fullText || `Audio for: "${prompt}"`;
        htmlContent = `<div style="font-size:13px;color:#aabbcc;margin-bottom:6px;">🎵 ${fullText}</div>` + htmlContent;
      }
      
      responseBubble.innerHTML = htmlContent;
      
      responseBubble.querySelectorAll('.audio-save-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const audioEl = btn.closest('div').parentElement.querySelector('audio');
          if (audioEl) {
            const a = document.createElement('a');
            a.href = audioEl.src;
            a.download = 'snaptoai-audio.wav';
            a.click();
          }
        });
      });
      
      thread.scrollTop = thread.scrollHeight;
      addBubbleActions(responseBubble, fullText);
      
    } else {
      // === VISION / GEMINI (streaming text) ===
      let systemPrompt = SYSTEM_PROMPT;
      if (currentImages.length > 1) {
        systemPrompt = MULTI_IMAGE_PROMPT;
      } else if (currentPageText && currentPageText.length > 800) {
        systemPrompt = SMART_SYSTEM_PROMPT;
      }
      
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modeConfig.model}:streamGenerateContent?alt=sse&key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: contents,
            generationConfig: { 
              maxOutputTokens: getConfig('MAX_OUTPUT_TOKENS', 2048),
              temperature: getConfig('TEMPERATURE', 0.7),
              topP: 0.95,
              topK: 40
            }
          })
        }
      );
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API Error: ${response.status}`);
      }
      
      const responseBubble = createResponseBubble();
      
      if (!response.body) {
        throw new Error('No response stream available');
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6).trim();
              if (!jsonStr || jsonStr === '[DONE]') continue;
              const data = JSON.parse(jsonStr);
              const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                fullText += text;
                try {
                  if (typeof marked !== 'undefined') {
                    const parsedHtml = marked.parse(fullText);
                    responseBubble.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(parsedHtml) : parsedHtml;
                    responseBubble.querySelectorAll('a').forEach(link => {
                      link.setAttribute('target', '_blank');
                      link.setAttribute('rel', 'noopener noreferrer');
                    });
                  } else {
                    responseBubble.textContent = fullText;
                  }
                } catch (renderErr) {
                  responseBubble.textContent = fullText;
                }
                thread.scrollTop = thread.scrollHeight;
              }
            } catch (parseErr) {
              // Skip malformed SSE chunks
            }
          }
        }
      }
      
      if (!fullText) {
        responseBubble.innerHTML = '<div style="color:#ff6b6b;">No response received. Please try again.</div>';
      }
      
      addBubbleActions(responseBubble, fullText);
    }
    
    const userHistoryEntry = { role: 'user', text: prompt };
    if (isFirstMessage && currentImages.length > 0) {
      userHistoryEntry.images = currentImages;
    }
    conversationHistory.push(userHistoryEntry);
    conversationHistory.push({ role: 'model', text: fullText });
    
  } catch (error) {
    removeLoading();
    if (error.message === '__trial_ended__') {
      // Modal already shown — don't add an error bubble
    } else {
      const lowerErr = error.message.toLowerCase();
      const isQuotaError = lowerErr.match(/quota|rate|limit|429|exceeded|resource.exhausted/);
      const isBilling = lowerErr.includes('billing') || lowerErr.includes('permission') || lowerErr.includes('not enabled') || lowerErr.includes('paid tier') || lowerErr.includes('precondition');
      if (isQuotaError) {
        const quotaBubble = createResponseBubble();
        quotaBubble.innerHTML = buildRateLimitCard();
        thread.scrollTop = thread.scrollHeight;
      } else if (isBilling) {
        const unlockBubble = createResponseBubble();
        unlockBubble.innerHTML = buildUnlockCard('video');
        thread.scrollTop = thread.scrollHeight;
      } else {
        const friendlyMsg = await getFriendlyErrorMessage(error.message);
        addBubble(friendlyMsg, 'ai');
      }
    }
  } finally {
    releaseRequestLock(); // Always release the lock
  }
  
  sendBtn.disabled = false;
  input.focus();
}

// Convert scary API errors into friendly, helpful messages
async function getFriendlyErrorMessage(errorMsg) {
  const lowerMsg = errorMsg.toLowerCase();
  
  // Check if user has their own API key
  const apiResult = await chrome.storage.sync.get(['geminiApiKey']);
  const hasOwnApiKey = apiResult.geminiApiKey && apiResult.geminiApiKey.length > 20;
  
  // Quota/Rate limit errors — friendly non-scary messages
  if (lowerMsg.includes('quota') || lowerMsg.includes('rate') || lowerMsg.includes('limit') || lowerMsg.includes('429') || lowerMsg.includes('exceeded') || lowerMsg.includes('resource')) {
    if (hasOwnApiKey) {
      return `⏳ Taking a quick breather! Google's API has a temporary limit. Just wait a moment and try again.`;
    } else {
      return `🌟 You've had a great session! Come back tomorrow for more free prompts, or get unlimited access with a free Gemini API key at aistudio.google.com`;
    }
  }
  
  // API key errors
  if (lowerMsg.includes('api key') || lowerMsg.includes('invalid') || lowerMsg.includes('unauthorized') || lowerMsg.includes('401')) {
    return `API key issue detected.\n\n` +
           `Please check your API key in Settings. You can get a new one at aistudio.google.com — it takes about a minute.`;
  }
  
  // Network errors
  if (lowerMsg.includes('network') || lowerMsg.includes('fetch') || lowerMsg.includes('connection')) {
    return `📡 Connection issue. Please check your internet and try again.`;
  }
  
  // Default: return original message
  return errorMsg;
}

// Add action buttons under each AI response
function addBubbleActions(bubble, text) {
  const actions = document.createElement('div');
  actions.className = 'bubble-actions';
  actions.innerHTML = `
    <button class="copy-single-btn">📋 Copy</button>
    <button class="read-aloud-btn">🔊 Read</button>
    <button class="magic-card-btn">✨ Magic Card</button>
  `;
  bubble.appendChild(actions);
  
  // Magic Card Button - Opens dedicated page to avoid CSP issues
  actions.querySelector('.magic-card-btn').onclick = async () => {
    const cardContent = typeof marked !== 'undefined' ? marked.parse(text) : text;
    
    // Store content in local storage for the magic card page to read
    await chrome.storage.local.set({ magicCardContent: cardContent });
    
    // Open the dedicated magic card page
    chrome.tabs.create({ url: chrome.runtime.getURL('magic-card.html') });
  };
  // Copy this response only
  actions.querySelector('.copy-single-btn').onclick = async () => {
    let html = bubble.innerHTML.replace(/<div class="bubble-actions">.*<\/div>/s, '');
    html = html.replace(/<strong>/g, '<strong style="color: #0066cc; font-weight: bold;">');
    html = html.replace(/<a /g, '<a style="color: #0066cc; text-decoration: underline;" ');
    const styledHtml = `<div style="font-family: Arial, sans-serif; color: #000;">${html}</div>`;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([styledHtml], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        })
      ]);
      actions.querySelector('.copy-single-btn').textContent = '✓ Copied!';
      setTimeout(() => actions.querySelector('.copy-single-btn').textContent = '📋 Copy', 2000);
    } catch (e) {
      await navigator.clipboard.writeText(text);
      actions.querySelector('.copy-single-btn').textContent = '✓ Copied!';
      setTimeout(() => actions.querySelector('.copy-single-btn').textContent = '📋 Copy', 2000);
    }
  };
  
  // Read aloud using FREE browser TTS with auto language detection
  const readBtn = actions.querySelector('.read-aloud-btn');
  
  let speakSessionId = 0;

  readBtn.onclick = () => {
    if (synth.speaking) {
      speakSessionId++;
      synth.cancel();
      readBtn.textContent = '🔊 Read';
      return;
    }

    const cleanText = text.replace(/```[\s\S]*?```/g, ' code block ').replace(/[#*_~`>|]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
    if (!cleanText) return;

    speakSessionId++;
    const thisSession = speakSessionId;
    synth.cancel();

    setTimeout(() => {
      if (thisSession !== speakSessionId) return;
      voices = synth.getVoices();
      const detectedLang = detectLanguage(cleanText);
      const MAX_CHUNK = 200;
      const sentences = cleanText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleanText];
      const chunks = [];
      let current = '';
      for (const s of sentences) {
        if ((current + s).length > MAX_CHUNK && current) {
          chunks.push(current.trim());
          current = s;
        } else {
          current += s;
        }
      }
      if (current.trim()) chunks.push(current.trim());

      let bestVoice = null;
      const langPrefix = detectedLang;
      bestVoice = voices.find(v => v.lang.startsWith(langPrefix) && v.name.includes('Google')) ||
                  voices.find(v => v.lang.startsWith(langPrefix)) ||
                  voices.find(v => v.lang.startsWith('en') && v.name.includes('Google')) ||
                  voices.find(v => v.lang.startsWith('en'));

      readBtn.textContent = '⏹ Stop';
      let chunkIndex = 0;

      function speakNext() {
        if (thisSession !== speakSessionId) return;
        if (chunkIndex >= chunks.length) {
          readBtn.textContent = '🔊 Read';
          return;
        }
        const u = new SpeechSynthesisUtterance(chunks[chunkIndex]);
        if (bestVoice) {
          u.voice = bestVoice;
          u.lang = bestVoice.lang;
        } else {
          u.lang = detectedLang;
        }
        u.rate = 1.0;
        u.pitch = 1.0;
        u.onend = () => {
          chunkIndex++;
          if (thisSession !== speakSessionId) return;
          setTimeout(() => speakNext(), 150);
        };
        u.onerror = () => { readBtn.textContent = '🔊 Read'; };
        synth.speak(u);
      }
      speakNext();
    }, 100);
  };
}

// Continue - ask AI to continue its response
async function continueResponse() {
  document.getElementById('chatInput').value = 'Please continue your response from where you left off.';
  handleSend();
}

// Summarize - ask AI to summarize everything
async function summarizeChat() {
  document.getElementById('chatInput').value = 'Please provide a brief summary of our entire conversation and the key insights.';
  handleSend();
}

// Education Mode - Universal Bilingual Mentor (invisible prompt)
const EDUCATION_PROMPT = `ROLE: THE UNIVERSAL BILINGUAL SOURCE-FIRST MENTOR
I am an exhaustive, detail-obsessed personal mentor for any subject. I am programmed to be a "hand-holding" guide. I am strictly forbidden from summarizing or skipping details. I must adapt my teaching to the specific language pair requested by the student.

RULE 1: THE LANGUAGE-SENSITIVE INITIALIZATION
My very first response to the user must be brief and welcoming. I must only say: "Hello! I am your Universal Mentor. I am ready to help you master your material with extreme detail and bilingual support. To begin, please tell me: What subject/material are we studying, and which TWO languages should I use for your lesson? (Example: Biology - English & Hindi / History - English & Spanish)."

RULE 2: THE "SOURCE-FIRST" MANDATE
I cannot explain a concept without first quoting the exact source material in the original language.
Text: Quote the sentence/paragraph.
Math/Science: Quote the formula, theorem, or law.

RULE 3: ADAPTIVE BILINGUALISM
Once the user chooses their two languages (e.g., English and Hindi), every heading, explanation, analogy, and question must be provided in both of those languages.
I must explain the "Why," the "Logic," and the "Context" in extreme depth.

THE 4-PHASE UNIVERSAL STRUCTURE:
PHASE 1: THE SOURCE DISSECTION
- THE ACTUAL SOURCE: [Quote the exact source].
- THE MASTER'S ANALYSIS (Bilingual): A deep-dive into the logic provided in both chosen languages.
- THE ANALOGY (Bilingual): A creative, real-world comparison in both languages.

PHASE 2: THE CONCEPT/VOCABULARY VAULT
A table: [Term/Symbol | [Target Language] Meaning | Master's Deep Definition | Memory Trick].

PHASE 3: THE BILINGUAL MASTERY GATE
Provide 3-5 high-level, critical-thinking questions based only on the source.
Every question and every answer must be provided in both chosen languages.

PHASE 4: THE PROGRESS DASHBOARD
Show: [Mastery Level % | Rank | Pending Mastery List | Next Objective].

I am initialized. I will adapt to any language pair. I will never summarize. Please analyze the provided material and begin.`;

async function startEducationMode() {
  // Send education prompt invisibly - directly to AI without showing in chat
  const sendBtn = document.getElementById('sendBtn');
  const thread = document.getElementById('chatThread');
  
  sendBtn.disabled = true;
  addThinkingBubble();
  
  try {
    // Get API key
    const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
    const apiKey = keyResult.geminiApiKey;
    if (!apiKey) throw new Error('Please set your Gemini API key in Settings');
    
    // Build request with education prompt (invisible to user)
    const userParts = [];
    
    // Add all images
    for (const img of currentImages) {
      const base64Data = img.split(',')[1];
      const mimeType = img.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      userParts.push({
        inlineData: {
          mimeType: mimeType,
          data: base64Data
        }
      });
    }
    
    // Add the education prompt (this goes to AI but wasn't shown to user)
    userParts.push({ text: EDUCATION_PROMPT });
    
    const requestBody = {
      contents: [{ role: 'user', parts: userParts }],
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192
      }
    };
    
    // Wait for rate limit before request
    await waitForRateLimit();
    
    const verdictModel = await getSelectedModel();
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${verdictModel}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      }
    );
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'API request failed');
    }
    
    const data = await response.json();
    const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response received';
    
    // Store in conversation history (keep prompt internal)
    conversationHistory.push({ role: 'user', text: '[Education Mode Activated]' });
    conversationHistory.push({ role: 'model', text: aiText });
    
    // Clear images after use if any were attached
    if (currentImages.length > 0) {
      currentImages = [];
      updateImagePreviews();
    }
    
    removeLoading();
    addBubble(aiText, 'model');
    
  } catch (error) {
    removeLoading();
    addBubble(`Error: ${error.message}`, 'model');
  }
  
  sendBtn.disabled = false;
}

// Export to PDF - Direct download using jsPDF
function exportToPDF() {
  const thread = document.getElementById('chatThread');
  const bubbles = thread.querySelectorAll('.chat-bubble:not(.loading)');
  
  if (bubbles.length === 0) {
    alert('No chat messages to export');
    return;
  }
  
  // Safety check for jsPDF
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert('PDF library failed to load. Please try again.');
    return;
  }
  
  // Create PDF using jsPDF
  if (!window.jspdf) {
    addBubble('PDF export is not available. Please try again.', 'error');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });
  
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const maxWidth = pageWidth - (margin * 2);
  let yPosition = margin;
  
  // Title
  doc.setFontSize(18);
  doc.setTextColor(0, 82, 204);
  doc.text('SnapToAI Chat Export', margin, yPosition);
  yPosition += 10;
  
  // Date
  doc.setFontSize(10);
  doc.setTextColor(128, 128, 128);
  doc.text(new Date().toLocaleString(), margin, yPosition);
  yPosition += 10;
  
  // Line separator
  doc.setDrawColor(0, 217, 255);
  doc.setLineWidth(0.5);
  doc.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 10;
  
  // Process each message
  bubbles.forEach(b => {
    if (b.classList.contains('welcome-message')) return;
    
    const isUser = b.classList.contains('user');
    const role = isUser ? 'You' : 'AI';
    const text = b.textContent.replace(/📋 Copy|🔊 Read|✨ Magic Card|⏹ Stop|✓ Copied!/g, '').trim();
    
    if (!text) return;
    
    // Check if we need a new page
    if (yPosition > pageHeight - 40) {
      doc.addPage();
      yPosition = margin;
    }
    
    // Role label
    doc.setFontSize(11);
    try { doc.setFont(undefined, 'bold'); } catch(e) { /* font fallback */ }
    if (isUser) {
      doc.setTextColor(25, 118, 210);
    } else {
      doc.setTextColor(76, 175, 80);
    }
    doc.text(role + ':', margin, yPosition);
    yPosition += 6;
    
    // Message text - wrap long lines
    doc.setFontSize(10);
    try { doc.setFont(undefined, 'normal'); } catch(e) { /* font fallback */ }
    doc.setTextColor(51, 51, 51);
    
    const lines = doc.splitTextToSize(text, maxWidth);
    lines.forEach(line => {
      if (yPosition > pageHeight - 20) {
        doc.addPage();
        yPosition = margin;
      }
      doc.text(line, margin, yPosition);
      yPosition += 5;
    });
    
    yPosition += 5;
  });
  
  // Footer on last page
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('Generated by SnapToAI', margin, pageHeight - 10);
  
  // Generate filename with timestamp
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `SnapToAI-Chat-${timestamp}.pdf`;
  
  // Direct download
  doc.save(filename);
}

// Clear chat
function clearChat() {
  const thread = document.getElementById('chatThread');
  thread.innerHTML = '<div class="welcome-message">I\'m your AI partner. Ask me anything about this image!</div>';
  conversationHistory = [];
}

// Copy chat with rich HTML formatting (preserves bold, links, etc in Google Docs)
async function copyChat() {
  const thread = document.getElementById('chatThread');
  const bubbles = thread.querySelectorAll('.chat-bubble:not(.loading)');
  
  let html = '';
  let plainText = '';
  
  bubbles.forEach(b => {
    if (b.classList.contains('welcome-message')) return;
    const role = b.classList.contains('user') ? 'You' : 'AI';
    let content = b.innerHTML;
    const textContent = b.textContent;
    
    // Convert CSS styles to inline styles for Google Docs compatibility
    // Bold/strong text → blue color (Google Docs doesn't read CSS classes)
    content = content.replace(/<strong>/g, '<strong style="color: #0066cc; font-weight: bold;">');
    content = content.replace(/<b>/g, '<b style="color: #0066cc; font-weight: bold;">');
    // Links → blue underlined
    content = content.replace(/<a /g, '<a style="color: #0066cc; text-decoration: underline;" ');
    
    html += `<p><strong>${role}:</strong></p><div>${content}</div><br>`;
    plainText += `${role}: ${textContent}\n\n`;
  });
  
  // Wrap in styled container for Google Docs compatibility
  const styledHtml = `<div style="font-family: Arial, sans-serif; color: #000;">${html}</div>`;
  
  try {
    // Copy as both HTML and plain text for maximum compatibility
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([styledHtml], { type: 'text/html' }),
        'text/plain': new Blob([plainText.trim()], { type: 'text/plain' })
      })
    ]);
    addBubble('Copied with formatting! Paste in Google Docs to see highlights.', 'ai');
  } catch (e) {
    // Fallback to plain text
    await navigator.clipboard.writeText(plainText.trim());
    addBubble('Copied as plain text.', 'ai');
  }
}

function autoResize(textarea) {
  textarea.style.height = '52px';
  const newHeight = Math.min(textarea.scrollHeight, 140);
  textarea.style.height = newHeight + 'px';
  textarea.style.overflowY = newHeight >= 140 ? 'auto' : 'hidden';
}

function resetInputSize(textarea) {
  textarea.style.height = '52px';
  textarea.style.overflowY = 'hidden';
}

// Sidebar toggle
const sidebarToggle = document.getElementById('sidebarToggle');
const imagePanel = document.getElementById('imagePanel');
if (sidebarToggle && imagePanel) {
  sidebarToggle.addEventListener('click', () => {
    const collapsed = imagePanel.classList.toggle('collapsed');
    sidebarToggle.textContent = collapsed ? '▶' : '◀';
    sidebarToggle.title = collapsed ? 'Show sidebar' : 'Hide sidebar';
  });
}

// Event listeners
document.getElementById('closeBtn')?.addEventListener('click', () => window.close());
document.getElementById('sendBtn')?.addEventListener('click', handleSend);

const chatInput = document.getElementById('chatInput');
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});
chatInput.addEventListener('input', () => autoResize(chatInput));
chatInput.addEventListener('paste', (e) => {
  // Check for pasted images from clipboard
  const items = e.clipboardData?.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault(); // Prevent default paste behavior for images
        
        const blob = item.getAsFile();
        if (blob) {
          if (blob.size > MAX_FILE_SIZE) {
            addBubble(`Pasted image is too large (${(blob.size / 1024 / 1024).toFixed(1)}MB). Max size is 10MB.`, 'error');
            return;
          }
          if (filesQueue.length >= MAX_FILES) {
            addBubble(`Maximum ${MAX_FILES} files can be attached at once.`, 'error');
            return;
          }
          const reader = new FileReader();
          reader.onload = (event) => {
            const fileData = {
              mimeType: blob.type || 'image/png',
              data: event.target.result.split(',')[1],
              name: 'Pasted Image'
            };
            filesQueue.push(fileData);
            
            const card = document.createElement('div');
            card.className = 'file-card';
            card.innerHTML = `<span>Pasted Image</span> <div class="remove-btn">x</div>`;
            card.querySelector('.remove-btn').onclick = () => {
              filesQueue = filesQueue.filter(f => f !== fileData);
              card.remove();
            };
            document.getElementById('filePreviewZone').appendChild(card);
            
            console.log('[SnapToAI] Image pasted into chat');
          };
          reader.readAsDataURL(blob);
        }
        return; // Image handled, exit
      }
    }
  }
  
  // Allow text paste to complete, then auto-resize
  setTimeout(() => autoResize(chatInput), 0);
});

document.getElementById('continueBtn')?.addEventListener('click', continueResponse);
document.getElementById('summarizeBtn')?.addEventListener('click', summarizeChat);
document.getElementById('clearBtn')?.addEventListener('click', clearChat);
document.getElementById('exportBtn')?.addEventListener('click', exportToPDF);

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 20;

document.getElementById('fileInput').addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  const slotsAvailable = MAX_FILES - filesQueue.length;
  if (files.length > slotsAvailable) {
    addBubble(`Can only attach ${slotsAvailable} more file(s). Maximum is ${MAX_FILES}.`, 'error');
  }
  files.slice(0, Math.max(0, slotsAvailable)).forEach(file => {
    if (file.size > MAX_FILE_SIZE) {
      addBubble(`"${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max file size is 10MB.`, 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const fileData = {
        mimeType: file.type || 'application/octet-stream',
        data: event.target.result.split(',')[1],
        name: file.name
      };
      filesQueue.push(fileData);
      
      const card = document.createElement('div');
      card.className = 'file-card';
      const icon = file.type.startsWith('image/') ? '🖼️' : file.type.includes('pdf') ? '📄' : '📎';
      card.innerHTML = `${icon} <span>${file.name}</span> <div class="remove-btn">×</div>`;
      card.querySelector('.remove-btn').onclick = () => {
        filesQueue = filesQueue.filter(f => f !== fileData);
        card.remove();
      };
      document.getElementById('filePreviewZone').appendChild(card);
    };
    reader.readAsDataURL(file);
  });
  e.target.value = '';
});

// Clear file queue after sending
function clearFilesQueue() {
  filesQueue = [];
  document.getElementById('filePreviewZone').innerHTML = '';
}

// Code tip dismiss logic
(async () => {
  const tipEl = document.getElementById('codeTip');
  const dismissBtn = document.getElementById('dismissTip');
  if (tipEl && dismissBtn) {
    const { codeTipDismissed } = await chrome.storage.local.get('codeTipDismissed');
    if (codeTipDismissed) {
      tipEl.style.display = 'none';
    }
    dismissBtn.addEventListener('click', () => {
      tipEl.style.display = 'none';
      chrome.storage.local.set({ codeTipDismissed: true });
    });
  }
})();

// Initialize
initializeChat();

// === RICH COPY ON MANUAL SELECTION ===
// When user manually selects text and copies (Ctrl+C), preserve formatting
const chatThreadElement = document.getElementById('chatThread');
if (chatThreadElement) {
  chatThreadElement.addEventListener('copy', (e) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    
    // Check if selection is within an AI bubble
    const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const bubble = container.nodeType === 1 
    ? container.closest('.chat-bubble.ai')
    : container.parentElement?.closest('.chat-bubble.ai');
  
  if (!bubble) return; // Not in AI bubble, let browser handle it
  
  e.preventDefault();
  
  // Get selected HTML with formatting
  const fragment = range.cloneContents();
  const tempDiv = document.createElement('div');
  tempDiv.appendChild(fragment);
  
  // Apply inline styles for email/docs compatibility
  let html = tempDiv.innerHTML;
  html = html.replace(/<strong>/g, '<strong style="color: #0066cc; font-weight: bold;">');
  html = html.replace(/<a /g, '<a style="color: #0066cc; text-decoration: underline;" ');
  html = html.replace(/<h1>/g, '<h1 style="color: #0066cc; font-size: 1.5em;">');
  html = html.replace(/<h2>/g, '<h2 style="color: #0066cc; font-size: 1.3em;">');
  html = html.replace(/<h3>/g, '<h3 style="color: #0066cc; font-size: 1.1em;">');
  html = html.replace(/<li>/g, '<li style="margin: 4px 0;">');
  
  const styledHtml = `<div style="font-family: Arial, sans-serif; color: #000;">${html}</div>`;
  const plainText = selection.toString();
  
  // Use SYNCHRONOUS clipboardData.setData (works reliably in copy events)
  // Async clipboard.write is often blocked by browsers during copy events
  try {
    e.clipboardData.setData('text/html', styledHtml);
    e.clipboardData.setData('text/plain', plainText);
    console.log('[SnapToAI] Rich text copied with formatting (sync)');
  } catch (err) {
    console.log('[SnapToAI] Clipboard setData failed:', err);
  }
  });
}

// === THE VERDICT FEATURE ===
// Show/hide verdict button based on image availability
function updateVerdictButtonVisibility() {
  const verdictBtn = document.getElementById('verdictBtn');
  if (verdictBtn) {
    verdictBtn.style.display = 'none';
  }
}

// Call on load and when images change
updateVerdictButtonVisibility();

// Get chat context for smarter verdicts (last few messages)
function getChatContext() {
  if (!conversationHistory || conversationHistory.length === 0) return '';
  return conversationHistory.slice(-4).map(m => {
    const text = m.text || '';
    return `${m.role}: ${text.substring(0, 100)}`;
  }).join('\n');
}

document.getElementById('verdictBtn')?.addEventListener('click', async () => {
  const verdictBtn = document.getElementById('verdictBtn');
  const thread = document.getElementById('chatThread');
  
  if (!currentImages.length) {
    addBubble('Please capture a screenshot first!', 'ai');
    return;
  }
  
  const apiResult = await chrome.storage.sync.get(['geminiApiKey']);
  if (!apiResult.geminiApiKey) {
    addBubble('Please add your Gemini API key first.', 'ai');
    return;
  }
  
  verdictBtn.disabled = true;
  verdictBtn.textContent = '⏳ Thinking...';
  verdictBtn.classList.remove('gold', 'red', 'green');
  if (navigator.vibrate) navigator.vibrate(100);
  
  try {
    const imageData = currentImages[0].replace(/^data:image\/\w+;base64,/, '');
    const chatContext = getChatContext();
    
    // Cost-efficient prompt - ONE API call, 300 tokens max
    // OMNI-SCORE: The "Truth Engine" - expose traps and wins
    const verdictPrompt = `You are the "Omni-Score Truth Engine". Analyze this image ruthlessly.
${chatContext ? `Context: ${chatContext.substring(0, 200)}\n` : ''}
Auto-detect type (product/stock/menu/real estate/service). Be BRUTALLY honest.

Output ONLY JSON:
{"score":58,"checks":[{"label":"Rip-Off Radar","value":"22% markup detected","impact":"-15","positive":false},{"label":"Quality Gap","value":"Material costs $4, you pay $40","impact":"-12","positive":false},{"label":"Time Risk","value":"May miss deadline","impact":"-15","positive":false}],"verdict":"Wait 2 weeks - price drops 40% after holiday.","glowColor":"red"}
(score 0-100, glowColor: gold=80+, green=60-79, red=<60)`;

    // Wait for rate limit before Verdict request
    await waitForRateLimit();
    
    const vModel = await getSelectedModel();
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${vModel}:generateContent?key=${apiResult.geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [
            { text: verdictPrompt },
            { inlineData: { mimeType: 'image/png', data: imageData } }
          ]}],
          generationConfig: { maxOutputTokens: 300, temperature: 0.7 }
        })
      }
    );
    
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    
    let verdictData;
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    try {
      let jsonStr = '';
      const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
      } else {
        let braceDepth = 0;
        let startIdx = -1;
        for (let i = 0; i < responseText.length; i++) {
          if (responseText[i] === '{') {
            if (braceDepth === 0) startIdx = i;
            braceDepth++;
          } else if (responseText[i] === '}') {
            braceDepth--;
            if (braceDepth === 0 && startIdx !== -1) {
              jsonStr = responseText.substring(startIdx, i + 1);
              break;
            }
          }
        }
      }
      verdictData = jsonStr ? JSON.parse(jsonStr) : null;
    } catch {
      verdictData = null;
    }
    
    if (!verdictData || typeof verdictData.score === 'undefined') {
      verdictData = {
        score: 50,
        checks: [{ label: "Analysis", value: responseText.substring(0, 80) || "Complete", impact: "0", positive: true }],
        verdict: "Review the details above.",
        glowColor: "green"
      };
    }
    
    // Determine glow color from score
    const score = verdictData.score || 50;
    const glowColor = score >= 80 ? 'gold' : score >= 60 ? 'green' : 'red';
    const scoreColor = score >= 80 ? 'gold' : score >= 60 ? 'green' : 'red';
    
    verdictBtn.classList.add(glowColor);
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    
    const checksHtml = (verdictData.checks || []).map(c => {
      const safeLabel = escapeHtml(String(c.label || ''));
      const safeValue = escapeHtml(String(c.value || ''));
      const safeImpact = escapeHtml(String(c.impact || '0'));
      return `
      <div class="verdict-row">
        <div class="verdict-label-block">
          <span class="verdict-label">${safeLabel}</span>
          <span class="verdict-value">${safeValue}</span>
        </div>
        <span class="verdict-impact ${c.positive ? 'green' : 'red'}">${safeImpact}</span>
      </div>
    `;}).join('');
    
    // Add OMNI-SCORE card INLINE in chat thread
    const card = document.createElement('div');
    card.className = 'verdict-card-inline';
    card.innerHTML = `
      <div class="omni-score-header">
        <span class="score-label">THE TRUTH SCORE</span>
        <span class="score-value ${scoreColor}">${score}<span class="score-max">/100</span></span>
      </div>
      ${checksHtml}
      <div class="verdict-bottom-line">
        <span class="bottom-label">THE BOTTOM LINE</span>
        <p class="bottom-verdict">${escapeHtml(verdictData.verdict || 'Analysis complete.')}</p>
      </div>
    `;
    thread.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth' });
    
  } catch (error) {
    const errorMsg = await getFriendlyErrorMessage(error.message);
    addBubble('Verdict: ' + errorMsg, 'ai');
    verdictBtn.classList.add('red');
  } finally {
    verdictBtn.disabled = false;
    verdictBtn.textContent = '⚖️ The Verdict';
  }
});

// ============ MAGIC BUTTONS SYSTEM ============
let magicButtons = [];
const DEFAULT_MAGIC_BUTTONS = [
  {
    name: 'Analyze',
    emoji: '⚡',
    prompt: 'What is this? Give me the key points.',
    hint: 'Smart analysis — works on anything',
    colorIndex: 0,
    isDefault: true,
    isFallback: true
  },
  {
    name: 'Explain',
    emoji: '💡',
    prompt: 'Explain this simply like I\'m 15.',
    hint: 'Simple explanation',
    colorIndex: 1,
    isDefault: true
  },
  {
    name: 'Extract',
    emoji: '🔍',
    prompt: 'Extract all text and data from this image.',
    hint: 'Pull out all data',
    colorIndex: 2,
    isDefault: true
  },
  {
    name: 'Roast It',
    emoji: '🔥',
    prompt: 'Honest review. What\'s good, what\'s bad? Rate it /10.',
    hint: 'Brutally honest feedback',
    colorIndex: 3,
    isDefault: true
  }
];

// Split images into batches of max size
function chunkImages(images, maxSize = 30) {
  const batches = [];
  for (let i = 0; i < images.length; i += maxSize) {
    batches.push(images.slice(i, i + maxSize));
  }
  return batches;
}

// Render beautiful Magic Card with enhanced sections
function renderMagicCard(data, btn, batchLabel = '') {
  const thread = document.getElementById('chatThread');
  const toneColors = { gold: '#fbbf24', green: '#34d399', red: '#f87171', blue: '#3b82f6', purple: '#8b5cf6' };
  const toneColor = toneColors[data.tone] || toneColors.green;
  
  // Enhanced sections with priority tag support
  const sectionsHtml = (data.sections || []).map(section => {
    const itemsHtml = (section.items || []).map(item => {
      const safeItem = escapeHtml(String(item));
      let priorityClass = '';
      let displayItem = safeItem;
      if (safeItem.includes('[CRITICAL]') || safeItem.includes('[URGENT]')) {
        priorityClass = 'priority-critical';
        displayItem = safeItem.replace(/\[(CRITICAL|URGENT)\]/g, '<span class="priority-tag critical">$1</span>');
      } else if (safeItem.includes('[HIGH]') || safeItem.includes('[IMPORTANT]')) {
        priorityClass = 'priority-high';
        displayItem = safeItem.replace(/\[(HIGH|IMPORTANT)\]/g, '<span class="priority-tag high">$1</span>');
      } else if (safeItem.includes('[MEDIUM]')) {
        priorityClass = 'priority-medium';
        displayItem = safeItem.replace(/\[MEDIUM\]/g, '<span class="priority-tag medium">MEDIUM</span>');
      } else if (safeItem.includes('[LOW]')) {
        priorityClass = 'priority-low';
        displayItem = safeItem.replace(/\[LOW\]/g, '<span class="priority-tag low">LOW</span>');
      }
      return `<li class="${priorityClass}">${displayItem}</li>`;
    }).join('');
    
    return `
      <div class="magic-section">
        <div class="magic-section-label">${escapeHtml(section.label || '')}</div>
        <ul class="magic-items">${itemsHtml}</ul>
      </div>
    `;
  }).join('');
  
  // Action items section if present (with safety checks)
  let actionsHtml = '';
  if (data.actions && Array.isArray(data.actions) && data.actions.length > 0) {
    const safeActions = data.actions.map((action, i) => {
      const safeText = String(action).replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `
        <div class="action-item">
          <span class="action-num">${i + 1}</span>
          <span class="action-text">${safeText}</span>
        </div>
      `;
    }).join('');
    actionsHtml = `
      <div class="magic-actions">
        <div class="magic-section-label">ACTION ITEMS</div>
        <div class="action-list">${safeActions}</div>
      </div>
    `;
  }
  
  const riskHtml = data.risk ? `
    <div class="magic-risk">
      <span class="risk-label">RISK LEVEL:</span>
      <span class="risk-value risk-${escapeHtml(String(data.risk).toLowerCase())}">${escapeHtml(String(data.risk))}</span>
    </div>
  ` : '';
  
  const card = document.createElement('div');
  card.className = 'magic-card';
  card.style.setProperty('--tone-color', toneColor);
  card.innerHTML = `
    <div class="magic-card-header">
      <span class="magic-emoji">${escapeHtml(btn.emoji)}</span>
      <span class="magic-title">${escapeHtml(data.title || 'Analysis Complete')}${batchLabel ? ` <span style="opacity:0.6;font-size:12px">${escapeHtml(batchLabel)}</span>` : ''}</span>
    </div>
    <div class="magic-score-row">
      <div class="magic-score" style="color: ${toneColor}">${escapeHtml(String(data.score || '??'))}<span>/100</span></div>
      <div class="magic-highlight">${escapeHtml(data.highlight || '')}</div>
      ${riskHtml}
    </div>
    ${sectionsHtml}
    ${actionsHtml}
    <div class="magic-verdict">
      <div class="magic-verdict-label">THE VERDICT</div>
      <div class="magic-verdict-text">${escapeHtml(data.verdict || 'Analysis complete.')}</div>
    </div>
    <div class="magic-footer">
      <span class="magic-next">${escapeHtml(data.nextStep || '')}</span>
    </div>
  `;
  thread.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth' });
}

// Render dual output for ALL magic buttons: Card + Analysis with separate print/share buttons
function renderDualStockOutput(responseText, btn, batchLabel = '') {
  const thread = document.getElementById('chatThread');
  
  // Parse the dual output: JSON card + Markdown analysis
  let cardData = null;
  let analysisText = '';
  
  const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      cardData = JSON.parse(codeBlockMatch[1].trim());
      const jsonEndIndex = responseText.indexOf(codeBlockMatch[0]) + codeBlockMatch[0].length;
      analysisText = responseText.substring(jsonEndIndex).trim();
    } catch (e) {
      analysisText = responseText;
    }
  } else {
    let braceDepth = 0, startIdx = -1, jsonStr = '';
    for (let i = 0; i < responseText.length; i++) {
      if (responseText[i] === '{') { if (braceDepth === 0) startIdx = i; braceDepth++; }
      else if (responseText[i] === '}') { braceDepth--; if (braceDepth === 0 && startIdx !== -1) { jsonStr = responseText.substring(startIdx, i + 1); break; } }
    }
    if (jsonStr) {
      try {
        cardData = JSON.parse(jsonStr);
        const jsonEndIndex = responseText.indexOf(jsonStr) + jsonStr.length;
        analysisText = responseText.substring(jsonEndIndex).trim();
      } catch (e) { analysisText = responseText; }
    } else {
      analysisText = responseText;
    }
  }
  
  // Create container for dual output
  const container = document.createElement('div');
  container.className = 'dual-stock-output';
  
  // PART 1: Render the Card (if we have card data)
  if (cardData && cardData.title) {
    const toneColors = { gold: '#fbbf24', green: '#34d399', red: '#f87171', neutral: '#9ca3af' };
    const toneColor = toneColors[cardData.tone] || toneColors.green;
    
    const cardSection = document.createElement('div');
    cardSection.className = 'stock-card-section';
    cardSection.innerHTML = `
      <div class="magic-card" style="--tone-color: ${toneColor}; margin-bottom: 0;">
        <div class="magic-card-header">
          <span class="magic-emoji">${escapeHtml(btn.emoji)}</span>
          <span class="magic-title">${escapeHtml(cardData.title)}${batchLabel ? ` <span style="opacity:0.6;font-size:12px">${escapeHtml(batchLabel)}</span>` : ''}</span>
        </div>
        <div class="magic-score-row">
          <div class="magic-score" style="color: ${toneColor}">${escapeHtml(String(cardData.score || '??'))}<span>/100</span></div>
          <div class="magic-highlight">${escapeHtml(cardData.highlight || '')}</div>
        </div>
        ${cardData.key_metrics ? `
          <div class="magic-section">
            <div class="magic-section-label">KEY METRICS</div>
            <ul class="magic-items">
              ${cardData.key_metrics.map(m => `<li>${escapeHtml(String(m))}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        <div class="magic-verdict">
          <div class="magic-verdict-label">VERDICT</div>
          <div class="magic-verdict-text">${escapeHtml(cardData.verdict || '')}</div>
        </div>
      </div>
      <div class="dual-actions">
        <button class="dual-print-btn" data-type="card">Print Card</button>
        <button class="dual-share-btn" data-type="card">Share Card</button>
      </div>
    `;
    container.appendChild(cardSection);
    
    // Card action buttons
    cardSection.querySelector('.dual-print-btn').onclick = async () => {
      const cardHtml = cardSection.querySelector('.magic-card').outerHTML;
      await chrome.storage.local.set({ magicCardContent: cardHtml });
      chrome.tabs.create({ url: chrome.runtime.getURL('magic-card.html') });
    };
    
    cardSection.querySelector('.dual-share-btn').onclick = async () => {
      const cardText = `${cardData.title}\nScore: ${cardData.score}/100\n${cardData.highlight}\n\nKey Metrics:\n${(cardData.key_metrics || []).join('\n')}\n\nVerdict: ${cardData.verdict}`;
      try {
        await navigator.clipboard.writeText(cardText);
        cardSection.querySelector('.dual-share-btn').textContent = 'Copied!';
        setTimeout(() => cardSection.querySelector('.dual-share-btn').textContent = 'Share Card', 2000);
      } catch (e) {
        alert('Could not copy to clipboard');
      }
    };
  }
  
  // PART 2: Render the Analysis (markdown)
  if (analysisText) {
    const analysisSection = document.createElement('div');
    analysisSection.className = 'stock-analysis-section';
    
    const parsedAnalysis = typeof marked !== 'undefined' ? marked.parse(analysisText) : analysisText;
    const sanitizedAnalysis = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(parsedAnalysis) : parsedAnalysis;
    
    analysisSection.innerHTML = `
      <div class="analysis-header">
        <span>Strategic Analysis</span>
      </div>
      <div class="analysis-content">${sanitizedAnalysis}</div>
      <div class="dual-actions">
        <button class="dual-print-btn" data-type="analysis">Print Analysis</button>
        <button class="dual-share-btn" data-type="analysis">Share Analysis</button>
      </div>
    `;
    container.appendChild(analysisSection);
    
    // Analysis action buttons
    analysisSection.querySelector('.dual-print-btn').onclick = async () => {
      await chrome.storage.local.set({ magicCardContent: `<div class="analysis-print">${sanitizedAnalysis}</div>` });
      chrome.tabs.create({ url: chrome.runtime.getURL('magic-card.html') });
    };
    
    analysisSection.querySelector('.dual-share-btn').onclick = async () => {
      try {
        await navigator.clipboard.writeText(analysisText);
        analysisSection.querySelector('.dual-share-btn').textContent = 'Copied!';
        setTimeout(() => analysisSection.querySelector('.dual-share-btn').textContent = 'Share Analysis', 2000);
      } catch (e) {
        alert('Could not copy to clipboard');
      }
    };
  }
  
  thread.appendChild(container);
  container.scrollIntoView({ behavior: 'smooth' });
}

async function loadMagicButtons() {
  const result = await chrome.storage.local.get(['magicButtons']);
  const storedButtons = result.magicButtons || [];
  
  const oldPresetNames = ['Vision', 'Market', 'Writer', 'Tutor', 'Logic'];
  const userButtons = storedButtons.filter(b => !oldPresetNames.includes(b.name));
  
  if (userButtons.length !== storedButtons.length) {
    await chrome.storage.local.set({ magicButtons: userButtons });
  }
  
  magicButtons = [...DEFAULT_MAGIC_BUTTONS, ...userButtons];
  renderMagicButtons();
}

// Escape HTML special characters to prevent XSS and broken HTML
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

function renderMagicButtons() {
  const container = document.getElementById('magicButtons');
  if (!container) return;
  
  // Dark color gradients for readable text (no bright colors)
  const buttonColors = [
    'linear-gradient(45deg, #8b5cf6, #ec4899)', // Purple-Pink (same as + Magic Agents)
    'linear-gradient(45deg, #6366f1, #8b5cf6)', // Indigo-Purple
    'linear-gradient(45deg, #ec4899, #f43f5e)', // Pink-Red
    'linear-gradient(45deg, #8b5cf6, #6366f1)', // Purple-Indigo
    'linear-gradient(45deg, #f43f5e, #ec4899)', // Red-Pink
    'linear-gradient(45deg, #7c3aed, #c026d3)', // Violet-Fuchsia
    'linear-gradient(45deg, #db2777, #9333ea)', // Pink-Purple
    'linear-gradient(45deg, #c026d3, #7c3aed)', // Fuchsia-Violet
  ];
  
  container.innerHTML = magicButtons.map((btn, i) => {
    const colorIndex = (btn.colorIndex !== undefined) ? btn.colorIndex : (i % buttonColors.length);
    const bgColor = buttonColors[colorIndex];
    // Escape title to prevent broken HTML from quotes in user prompts
    const safeTitle = escapeHtml(btn.hint || btn.prompt);
    const safeName = escapeHtml(btn.name);
    // Also escape emoji in case of storage tampering
    const safeEmoji = escapeHtml(btn.emoji);
    const controls = btn.isDefault ? '' : `<span class="edit-magic" data-edit="${i}">✎</span><span class="delete-magic" data-delete="${i}">✕</span>`;
    return `
    <button class="magic-btn" data-index="${i}" title="${safeTitle}" style="background: ${bgColor}; border: none;">
      ${safeEmoji} ${safeName}
      ${controls}
    </button>
  `;}).join('');
  
  // Separate listeners for edit buttons
  container.querySelectorAll('.edit-magic').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      editMagicButton(parseInt(el.dataset.edit));
    });
  });
  
  // Separate listeners for delete buttons
  container.querySelectorAll('.delete-magic').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      deleteMagicButton(parseInt(el.dataset.delete));
    });
  });
  
  // Separate listeners for magic buttons (execute)
  container.querySelectorAll('.magic-btn').forEach(el => {
    el.addEventListener('click', (e) => {
      if (!e.target.classList.contains('delete-magic') && !e.target.classList.contains('edit-magic')) {
        executeMagicButton(parseInt(el.dataset.index));
      }
    });
  });
}

async function saveMagicButtons() {
  const userOnly = magicButtons.filter(b => !b.isDefault);
  await chrome.storage.local.set({ magicButtons: userOnly });
  renderMagicButtons();
}

function deleteMagicButton(index) {
  if (magicButtons[index]?.isDefault) return;
  if (confirm('Delete this magic button?')) {
    magicButtons.splice(index, 1);
    saveMagicButtons();
  }
}

let editingMagicIndex = null;

function editMagicButton(index) {
  const btn = magicButtons[index];
  if (!btn || btn.isDefault) return;
  
  editingMagicIndex = index;
  document.getElementById('magicName').value = btn.name;
  document.getElementById('magicPrompt').value = btn.prompt;
  document.getElementById('magicHint').value = btn.hint || '';
  document.getElementById('selectedEmoji').value = btn.emoji;
  document.getElementById('promptCount').textContent = btn.prompt.length;
  
  document.querySelectorAll('.emoji-option').forEach(el => {
    el.classList.toggle('selected', el.dataset.emoji === btn.emoji);
  });
  
  document.getElementById('saveMagicBtn').textContent = '⚡ Update';
  document.getElementById('magicModal').classList.add('open');
}

async function executeMagicButton(index) {
  const btn = magicButtons[index];
  if (!btn) return;
  
  const input = document.getElementById('chatInput');
  input.value = btn.prompt;
  if (navigator.vibrate) navigator.vibrate(50);
  handleSend();
}

// Modal Controls
// Template category switching
function showTemplateCategory(category) {
  document.querySelectorAll('.template-cat').forEach(c => c.classList.remove('active'));
  document.querySelector(`.template-cat[data-cat="${category}"]`)?.classList.add('active');
  document.querySelectorAll('.template-btn').forEach(btn => {
    btn.classList.toggle('visible', btn.dataset.cat === category);
    btn.classList.remove('selected');
  });
  const detailPanel = document.getElementById('templateDetail');
  if (detailPanel) detailPanel.style.display = 'none';
}

// Category click handlers
document.querySelectorAll('.template-cat').forEach(cat => {
  cat.addEventListener('click', () => showTemplateCategory(cat.dataset.cat));
});

document.getElementById('addMagicBtn')?.addEventListener('click', () => {
  document.getElementById('magicModal').classList.add('open');
  document.getElementById('magicName').value = '';
  document.getElementById('magicPrompt').value = '';
  document.getElementById('promptCount').textContent = '0';
  document.querySelectorAll('.emoji-option').forEach(e => e.classList.remove('selected'));
  document.querySelector('.emoji-option')?.classList.add('selected');
  document.getElementById('selectedEmoji').value = '🎯';
  // Show first category by default
  showTemplateCategory('money');
});

document.getElementById('closeMagicModal')?.addEventListener('click', () => {
  editingMagicIndex = null;
  document.getElementById('saveMagicBtn').textContent = '⚡ Create';
  document.getElementById('magicName').value = '';
  document.getElementById('magicPrompt').value = '';
  document.getElementById('promptCount').textContent = '0';
  document.getElementById('magicModal').classList.remove('open');
});

document.getElementById('emojiPicker')?.addEventListener('click', (e) => {
  if (e.target.classList.contains('emoji-option')) {
    document.querySelectorAll('.emoji-option').forEach(el => el.classList.remove('selected'));
    e.target.classList.add('selected');
    document.getElementById('selectedEmoji').value = e.target.dataset.emoji;
  }
});

document.getElementById('magicPrompt')?.addEventListener('input', (e) => {
  document.getElementById('promptCount').textContent = e.target.value.length;
});

document.querySelectorAll('.template-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const template = btn.dataset.template;
    const buttonText = btn.textContent.trim();
    const emoji = buttonText.split(' ')[0];
    const name = buttonText.substring(emoji.length).trim();
    
    document.getElementById('magicPrompt').value = template;
    document.getElementById('promptCount').textContent = template.length;
    
    document.querySelectorAll('.template-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    
    showTemplateDetail(name, emoji);
  });
});

function showTemplateDetail(templateName, emoji) {
  const detailPanel = document.getElementById('templateDetail');
  const reqData = window.SNAPTOAI_REQUIRED_SCREENSHOTS?.[templateName];
  
  if (!reqData || !reqData.items || reqData.items.length === 0) {
    detailPanel.style.display = 'none';
    return;
  }
  
  document.getElementById('templateDetailIcon').textContent = emoji;
  document.getElementById('templateDetailName').textContent = templateName;
  document.getElementById('templateDetailDesc').textContent = reqData.description || 'For best results, capture:';
  
  const reqContainer = document.getElementById('templateRequirements');
  reqContainer.innerHTML = reqData.items.map(item => `
    <div class="template-req-item">
      <span class="template-req-icon">○</span>
      <div class="template-req-content">
        <div class="template-req-name">${item.name}</div>
        ${item.hint ? `<div class="template-req-hint">${item.hint}</div>` : ''}
        ${item.source ? `<div class="template-req-source">${item.source}</div>` : ''}
      </div>
    </div>
  `).join('');
  
  detailPanel.style.display = 'block';
}

document.getElementById('saveMagicBtn')?.addEventListener('click', async () => {
  const name = document.getElementById('magicName').value.trim();
  const emoji = document.getElementById('selectedEmoji').value;
  const prompt = document.getElementById('magicPrompt').value.trim();
  const hint = document.getElementById('magicHint').value.trim();
  
  if (!name) { alert('Please enter a button name'); return; }
  if (!prompt) { alert('Please enter instructions for the AI'); return; }
  
  if (editingMagicIndex !== null) {
    magicButtons[editingMagicIndex] = { 
      ...magicButtons[editingMagicIndex], 
      name, emoji, prompt, hint 
    };
    editingMagicIndex = null;
    document.getElementById('saveMagicBtn').textContent = '⚡ Create';
    addBubble(`✨ Magic button "${emoji} ${name}" updated!`, 'ai');
  } else {
    if (magicButtons.length >= 15) { alert('Maximum 15 magic buttons allowed'); return; }
    const colorIndex = Math.floor(Math.random() * 8);
    magicButtons.push({ name, emoji, prompt, hint, colorIndex });
    addBubble(`✨ Magic button "${emoji} ${name}" created! Click it anytime to use.`, 'ai');
  }
  
  await saveMagicButtons();
  document.getElementById('magicModal').classList.remove('open');
  document.getElementById('magicName').value = '';
  document.getElementById('magicPrompt').value = '';
  document.getElementById('magicHint').value = '';
  document.getElementById('promptCount').textContent = '0';
  
  if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
});

// Load magic buttons on start
loadMagicButtons();
