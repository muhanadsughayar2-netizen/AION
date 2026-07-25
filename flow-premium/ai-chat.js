// AI Chat Window Script
// Handles AI chat in a standalone window

// ============ MODEL REGISTRY ============
// Single source of truth for all Gemini model IDs.
// Update here — never scatter model strings across the file.
const MODELS = {
  // Chat / vision
  chat:         'gemini-3-flash-preview',
  // Image generation
  imagePrimary: 'gemini-3.1-flash-image',
  imageChain:   ['gemini-3.1-flash-image', 'gemini-2.5-flash-image', 'gemini-3-pro-image-preview'],
  // Music / TTS
  musicDefault: 'lyria-3-clip-preview',
  lyria3:       'lyria-3',
  lyria3Pro:    'lyria-3-pro-preview',
  ttsPrimary:   'gemini-2.5-flash-preview-tts',
  ttsFallback:  'gemini-2.5-pro-preview-tts',
  // Video generation
  // NOTE (2026-07-06): Google fully retired the veo-3.0-* and veo-2.0-* model IDs —
  // they now 404. Only the veo-3.1-*-preview family is live. Do not reintroduce
  // veo-3.0/veo-2.0 IDs without first checking they still resolve via
  // GET https://generativelanguage.googleapis.com/v1beta/models/<id>.
  veo31:        'veo-3.1-generate-preview',
  veo31Fast:    'veo-3.1-fast-generate-preview',
  veo31Lite:    'veo-3.1-lite-generate-preview',
  veoDefault:   'veo-3.1-generate-preview',
  veoFallback:  'veo-3.1-fast-generate-preview',
  veoLite:      'veo-3.1-lite-generate-preview',
  // Billing probe chain (used by detectKeyTierVerbose) — must always point at
  // models that are currently live, or the probe silently degrades to 'retry'
  // for everyone and billing detection accuracy drops.
  probeImagen4:     'imagen-4.0-generate-001',
  probeImagen4Fast: 'imagen-4.0-fast-generate-001'
};
// ============ END MODEL REGISTRY ============

// ============ GLOBAL RATE LIMITER ============
// Prevents multiple simultaneous API calls that cause rate limit errors
let isRequestInProgress = false;
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 500; // 0.5s between requests — just enough to avoid bursting

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
function isRequestLocked() { return isRequestInProgress; }
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

// ── Shared mini-card helper ───────────────────────────────────────────────────
// All user-facing status/error messages use this so they're always short & clean.
function _miniCard(icon, text, btnLabel, btnClass, borderColor) {
  const border = borderColor || 'rgba(45,212,191,0.25)';
  const btn = btnLabel
    ? `<button class="${btnClass || 'snaptoai-set-key-btn'}" style="margin-top:10px;display:block;width:100%;padding:10px;border-radius:10px;background:linear-gradient(135deg,#2dd4bf,#7c3aed);color:#fff;font-size:13px;font-weight:700;border:none;cursor:pointer;">${btnLabel}</button>`
    : '';
  return `<div style="display:flex;align-items:flex-start;gap:10px;padding:14px 16px;border-radius:13px;background:#1c1f25;border:1px solid ${border};">
    <span style="font-size:20px;line-height:1.3;">${icon}</span>
    <div style="flex:1;">
      <div style="font-size:13px;color:#e8eaed;line-height:1.55;">${text}</div>
      ${btn}
    </div>
  </div>`;
}

function buildNoKeyCard() {
  return _miniCard('🔑',
    'Add your free Gemini key to unlock AI. Takes 1 minute.',
    '⚙️ Add Key in Settings →', 'snaptoai-set-key-btn');
}

document.addEventListener('click', (e) => {
  if (e.target.closest('.snaptoai-set-key-btn')) {
    e.preventDefault();
    showProxyKeyPrompt();
  }
});

function buildInstitutionKeyInvalidCard(institutionName, message) {
  const safeName = String(institutionName || 'your organization').replace(/[<>&]/g, '');
  const safeMsg  = String(message || 'AI is temporarily unavailable.').replace(/[<>&]/g, '');
  return _miniCard('🔑',
    `${safeName}'s AI key needs attention — ${safeMsg} Contact your admin to fix it.`,
    null, null, 'rgba(255,71,87,0.35)');
}

function buildDailyLimitCard() {
  return _miniCard('⏳',
    "You've used today's free prompts. Add your own key for unlimited access.",
    '⚙️ Add Key in Settings →', 'snaptoai-set-key-btn');
}

function buildRateLimitCard(hasKey = false) {
  return hasKey
    ? _miniCard('⏱️', 'Google rate limit hit. Your key is fine — wait ~60 seconds and try again.', null, null, 'rgba(255,165,0,0.3)')
    : _miniCard('⏳', 'AI is busy right now. Try again in a minute, or add your own key for instant access.', '⚙️ Add Key in Settings →', 'snaptoai-set-key-btn', 'rgba(45,212,191,0.25)');
}

function buildVeoRateLimitCard(modelLabel) {
  const label = modelLabel ? ` (${modelLabel})` : '';
  return _miniCard('⏱️',
    `Veo rate limit hit${label}. Wait ~60 seconds, then try again. Your key and billing are fine.`,
    null, null, 'rgba(255,165,0,0.3)');
}

const MODE_META = {
  'image': { icon: '✨', name: 'Image Studio' },
  'music': { icon: '🎵', name: 'Music Studio' },
  'video': { icon: '🎬', name: 'Video Studio' }
};

function buildUnlockCard(mode) {
  const meta = MODE_META[mode] || MODE_META['image'];
  return _miniCard(meta.icon,
    `${meta.name} needs a Gemini key with Google billing enabled. Add your key in Settings to get started.`,
    '⚙️ Add Key in Settings →', 'snaptoai-set-key-btn');
}

function buildMusicRetryCard() {
  return buildUnlockCard('music');
}

function buildNeedKeyForPaidCard(mode) {
  const meta = MODE_META[mode] || MODE_META['image'];
  return _miniCard(meta.icon,
    `${meta.name} needs your own Gemini key. Add it in Settings — it's free to get started.`,
    '⚙️ Add Key in Settings →', 'snaptoai-set-key-btn');
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
          title: 'Ready to create your video?',
          message: 'Your video will be generated using Google\'s top-quality AI. We\'ve picked the most cost-friendly settings for you.'
        }
      : {
          title: 'Ready to create your music?',
          message: 'Your music will be generated using Google\'s premium AI. We\'ve picked the most cost-friendly settings for you.'
        };

    const spendLine = details?.cost
      ? `Estimated cost: ${details.cost}${details?.label ? ` (${details.label})` : ''}.`
      : '';

    titleEl.textContent = preset.title;
    estimateEl.textContent = spendLine || '';
    messageEl.textContent = preset.message;
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
  } catch (e) { console.warn('[SnapToAI] getProxyIdentifier user read failed:', e?.message || e); }
  try {
    let { snaptoai_device_id } = await chrome.storage.local.get('snaptoai_device_id');
    if (!snaptoai_device_id) {
      snaptoai_device_id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      await chrome.storage.local.set({ snaptoai_device_id });
    }
    return snaptoai_device_id;
  } catch (e) { console.warn('[SnapToAI] getProxyIdentifier deviceId failed:', e?.message || e); }
  return '';
}

async function sendViaProxy(prompt, imageBase64) {
  const identifier = await getProxyIdentifier();
  if (!identifier) throw new Error('Could not identify user for proxy');

  const body = { prompt, email: identifier.includes('@') ? identifier : undefined, deviceId: identifier.includes('@') ? undefined : identifier };
  // Task #27 — pass the OAuth access token so the server can verify the
  // claimed email when an institution key would be used (prevents spoofing
  // another member's email to consume institution quota / bypass billing).
  try {
    if (identifier.includes('@')) {
      const { snaptoai_user } = await chrome.storage.local.get('snaptoai_user');
      if (snaptoai_user && snaptoai_user.accessToken) {
        body.accessToken = snaptoai_user.accessToken;
      }
    }
  } catch (e) { console.warn('[SnapToAI] sendViaProxy accessToken read failed:', e?.message || e); }
  if (imageBase64) body.imageData = imageBase64;

  const resp = await fetch(PROXY_BACKEND_URL + '/api/ai/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });

  const data = await resp.json();

  if (data.error === 'limit_reached') {
    freePromptsRemaining = 0;
    throw new Error('FREE_PROMPTS_EXHAUSTED');
  }

  if (data.error === 'busy') {
    throw new Error('PROXY_BUSY');
  }

  // Task #27 — surface institution-key failures with a distinct, actionable
  // error so the chat UI can tell the member to contact their admin instead
  // of suggesting BYOK. The server already refuses to silently fall back.
  if (data.error === 'institution_key_invalid') {
    const err = new Error(data.message || 'Your organization\'s AI key is invalid. Contact your institution admin.');
    err.code = 'INSTITUTION_KEY_INVALID';
    throw err;
  }

  if (data.error) throw new Error(data.error);

  freePromptsRemaining = data.remaining;
  return {
    text: data.response,
    remaining: data.remaining,
    used: data.used,
    limit: data.limit,
    usedInstitutionKey: !!data.usedInstitutionKey,
    metered: data.metered !== false
  };
}

// Task #27 — Read cached institution branding (set by subscription.js) and
// return key-policy info so other UI can hide/disable BYOK and route through
// the proxy when the institution mandates its own key.
// Task #40 — apply the institution's full 8-slot palette to the AI chat
// shell and swap the top-right pill from the SnapToAI model name to the
// institution name (with optional logo). Called once on load and refreshed
// when subscription.js writes a new snaptoai_branding cache entry.
async function applyInstitutionBrandingToChat() {
  try {
    const { snaptoai_branding, cachedSubStatus } = await chrome.storage.local.get(['snaptoai_branding', 'cachedSubStatus']);
    const isInst = cachedSubStatus && cachedSubStatus.planType === 'institution';
    const pill = document.getElementById('institutionNamePill');
    const pillText = document.getElementById('institutionNamePillText');
    const pillLogo = document.getElementById('institutionNamePillLogo');
    if (!isInst || !snaptoai_branding) {
      if (window.SnapToAIBranding) window.SnapToAIBranding.clear();
      if (pill) pill.style.display = 'none';
      return;
    }
    const b = snaptoai_branding;
    if (window.SnapToAIBranding) {
      window.SnapToAIBranding.apply({
        brand: b.brandColor,
        pageBg: b.pageBg, cardBg: b.cardBg,
        textPrimary: b.textPrimary, textMuted: b.textMuted,
        headerColor: b.headerColor, highlightColor: b.highlightColor,
        borderColor: b.borderColor
      });
    }
    if (pill && pillText) {
      const name = b.name || 'Institution';
      pillText.textContent = name;
      pill.title = name;
      // Pick the right logo variant for the active theme (matches welcome.js).
      const themeResolved = (window.SnapToAITheme && window.SnapToAITheme.getResolved)
        ? window.SnapToAITheme.getResolved() : 'dark';
      const logoSrc = (themeResolved === 'light' && b.logoUrlLight)
        ? b.logoUrlLight
        : (b.logoUrl || b.logoUrlLight || '');
      if (pillLogo) {
        if (logoSrc) { pillLogo.src = logoSrc; pillLogo.style.display = ''; }
        else { pillLogo.style.display = 'none'; pillLogo.removeAttribute('src'); }
      }
      pill.style.display = 'inline-flex';
    }
  } catch (e) {
    console.log('[SnapToAI] applyInstitutionBrandingToChat error:', e);
  }
}

// Refresh the pill + palette whenever subscription.js updates the cached
// branding (e.g. user signed in, subscription status refreshed, admin
// changed colors and member re-opened the chat).
try {
  if (chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes.snaptoai_branding || changes.cachedSubStatus)) {
        applyInstitutionBrandingToChat();
      }
    });
  }
} catch (e) {}

// Re-apply when theme flips so the logo variant + accent re-resolve.
try {
  if (window.SnapToAITheme && window.SnapToAITheme.onChange) {
    window.SnapToAITheme.onChange(() => { applyInstitutionBrandingToChat(); });
  }
} catch (e) {}

// Run as soon as DOM is ready so the pill appears with the chat header.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyInstitutionBrandingToChat);
} else {
  applyInstitutionBrandingToChat();
}

async function getInstitutionKeyInfo() {
  try {
    const { snaptoai_branding, cachedSubStatus } = await chrome.storage.local.get(['snaptoai_branding', 'cachedSubStatus']);
    const isInst = cachedSubStatus && cachedSubStatus.planType === 'institution';
    if (!isInst || !snaptoai_branding) return { isInstitution: false };
    return {
      isInstitution: true,
      institutionName: snaptoai_branding.name || 'your organization',
      hasInstitutionKey: !!snaptoai_branding.hasInstitutionKey,
      keyPolicy: snaptoai_branding.keyPolicy || 'prefer-user-key',
      billingBehavior: snaptoai_branding.billingBehavior || 'count-against-snaptoai-quota'
    };
  } catch (e) {
    return { isInstitution: false };
  }
}
function showTrialEndedModal() { /* no-op — no subscription */ }

async function showProxyKeyPrompt() {
  // Task #27 — When the institution mandates its own key, BYOK is forbidden.
  // Don't open the key modal at all; show a brief, friendly explainer toast.
  try {
    const info = await getInstitutionKeyInfo();
    if (info.isInstitution && info.keyPolicy === 'institution-only') {
      if (typeof showPromptToast === 'function') {
        showPromptToast(`🔑 ${info.institutionName} provides your AI key — no personal key needed.`, 4500);
      }
      return;
    }
  } catch (e) {}
  // Open the inline Gemini key modal — stays inside the popup, no new tab.
  if (typeof showGeminiModal === 'function') {
    showGeminiModal();
    return;
  }
  return;
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
      saveBtn.textContent = 'Testing your key…';

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

      statusEl.style.display = 'none';
      saveBtn.style.background = 'linear-gradient(135deg,#00ff88,#00c46f)';
      saveBtn.style.color = '#111';
      saveBtn.textContent = '✓ Save Key';
      saveBtn.style.opacity = '1';
      saveBtn.style.cursor = 'pointer';
      saveBtn.disabled = false;

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
            showPromptToast('🎉 Key saved — all AI features are ready!', 3500);
          } else {
            showPromptToast('Key saved — Vision & Chat ready. Enable Google billing for Image/Music/Video.', 4500);
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
    console.warn('[SnapToAI] getOwnerKeyFingerprints network failed:', e?.message || e);
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
    console.warn('[SnapToAI] isOwnerKey check failed:', e?.message || e);
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
    // Invalid KEY signals — only flag when the message explicitly says the key is bad.
    // PERMISSION_DENIED without a key-error message means model restriction (e.g. not
    // available in region) — that's ambiguous, so return 'retry' instead of 'invalid'.
    if (code === 401 || status === 'UNAUTHENTICATED' ||
        msg.includes('api key not valid') || msg.includes('api_key_invalid') || msg.includes('api key expired')) {
      return 'invalid';
    }
    if ((code === 403 || status === 'PERMISSION_DENIED') &&
        (msg.includes('api key') || msg.includes('permission') || msg.includes('forbidden'))) {
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
  } catch (e) { console.warn('[SnapToAI] Owner-key check failed:', e?.message || e); }

  // Imagen first — it requires only Tier 1 billing, so it's the canonical "has billing" probe.
  // Veo second — many keys with billing are still on Tier 1 and Veo requires Tier 2+, so a
  // Veo FAILED_PRECONDITION is NOT a reliable "no billing" signal. We only trust Veo as a
  // backup positive signal (prepaid), not as a free verdict on its own.
  const probeChain = [
    // Veo first — Imagen last ("only available on paid plans" is a model-availability
    // message, NOT a billing-status message, and falsely flags prepaid keys as free).
    // Only currently-live model IDs belong here (verified against
    // GET /v1beta/models on 2026-07-06) — a dead model ID always returns
    // NOT_FOUND, which this probe treats as an inconclusive 'retry', silently
    // degrading detection accuracy for every user instead of failing loudly.
    { model: MODELS.veo31,      endpoint: 'predictLongRunning',  trustFreeVerdict: false, treatInvalidAsPrepaid: false },
    { model: MODELS.veo31Fast,  endpoint: 'predictLongRunning',  trustFreeVerdict: false, treatInvalidAsPrepaid: false },
    { model: MODELS.veo31Lite,  endpoint: 'predictLongRunning',  trustFreeVerdict: false, treatInvalidAsPrepaid: false },
    // Imagen: also billing-gated — INVALID_ARGUMENT means billing passed = prepaid
    { model: MODELS.probeImagen4,     endpoint: 'predict',        trustFreeVerdict: false, treatInvalidAsPrepaid: true  },
    { model: MODELS.probeImagen4Fast, endpoint: 'predict',        trustFreeVerdict: false, treatInvalidAsPrepaid: true  }
  ];

  // Run all probes in PARALLEL (not sequential) so the total wait is bounded by
  // the slowest single probe (~5s) instead of the sum of all probes (~60s+).
  // Short-circuit the moment any probe returns a definitive answer.
  return new Promise((resolve) => {
    let settled = false;
    let invalidVotes = 0;
    let done = 0;
    const total = probeChain.length;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    probeChain.forEach(p => {
      _probeOneVeoModel(apiKey, p.model, 5000, p.endpoint, p.treatInvalidAsPrepaid)
        .then(r => {
          if (settled) return;
          done++;
          if (r === 'prepaid') { finish({ tier: 'prepaid', invalid: false }); return; }
          if (r === 'free' && p.trustFreeVerdict) { finish({ tier: 'free', invalid: false }); return; }
          if (r === 'invalid') invalidVotes++;
          if (done === total) finish({ tier: 'free', invalid: invalidVotes > 0 });
        })
        .catch(() => {
          if (settled) return;
          done++;
          if (done === total) finish({ tier: 'free', invalid: false });
        });
    });

    // Hard cap: never hang longer than 10s. If a paid user had a network blip,
    // the caller should fall back to the cached tier rather than this default.
    setTimeout(() => finish({ tier: 'free', invalid: false }), 10000);
  });
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
const CHAT_HISTORY_STORAGE_KEY = 'snaptoai_chat_history';
const CHAT_HISTORY_MAX_ITEMS = 20;
let chatHistorySaveTimer = null;
const NAMED_CHATS_KEY = 'snaptoai_named_chats';
const MAX_NAMED_CHATS = 50;
let currentChatId = null;
let namedChatSaveTimer = null;
let filesQueue = []; // Multi-file upload queue (Gemini-style)

// Search grounding, URL context & Code Execution toggles
let searchGroundingEnabled = false;
let urlContextEnabled = false;
let currentPageUrl = '';
let codeExecutionEnabled = false;
let researchMode = false;
let buildModeEnabled = false;
let _buildUseSnaps = false; // "Use my screenshots in build" toggle
let buildStage = null; // null=classic, 'L1'=scaffold, 'L2'=design, 'L3'=activate, 'UPDATE'=patch
let _buildBodyHtml = '';
let _buildStyleCss = '';
let _buildScriptJs = '';
let _livePreviewBlobUrl = null;

// Get config from prompts.js (user-editable) or use defaults
const getConfig = (key, defaultVal) => (window.SNAPTOAI_CONFIG && window.SNAPTOAI_CONFIG[key]) || defaultVal;

const AI_MODES = {
  'vision': {
    model: MODELS.chat,
    type: 'gemini',
    placeholder: 'Ask about your screenshot...',
    welcome: "Vision mode — snap a screenshot and ask me anything. Use Build · Research · Search · Read · Code to go further."
  },
  'image': {
    model: MODELS.imagePrimary,
    type: 'gemini-image',
    placeholder: 'Describe the image you want to create...',
    welcome: '✨ Image mode — describe anything. Powered by Google Imagen, the world\'s most advanced image AI.'
  },
  'music': {
    model: MODELS.musicDefault,
    type: 'gemini-audio',
    placeholder: 'Describe the music you want (mood, genre, tempo)...',
    welcome: '🎵 Music mode — describe a mood, genre, or scene. Powered by Google Lyria 3, the most advanced music AI ever built.'
  },
  'video': {
    model: MODELS.veoDefault,
    type: 'gemini-video',
    placeholder: 'Describe the video you want to create...',
    welcome: '🎬 Video mode — describe a scene and I\'ll bring it to life!'
  },
  'broadcast': {
    model: MODELS.chat,
    type: 'gemini',
    placeholder: 'Type your topic here (or use your attached screenshot below), then press Generate Podcast…',
    welcome: '🎙️ Broadcast Studio — type a topic, or use your attached screenshot as the source. Pick a format below, then press "Generate Podcast".'
  },
  'agent': {
    model: MODELS.chat,
    type: 'gemini-agent',
    placeholder: 'Tell Autopilot what to do on this page (e.g. "click the sign up button")...',
    welcome: 'Autopilot — give it a task on the current tab and it will click, type, and scroll to get it done. Watch the ghost cursor act it out step by step. It only acts on THIS page, and stops to check with you before anything risky like payments or deletions.'
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
  'vision': 'rgba(66,133,244,0.04)',
  'image': 'rgba(251,188,5,0.04)',
  'music': 'rgba(52,168,83,0.04)',
  'video': 'rgba(234,67,53,0.04)',
  'agent': 'rgba(168,85,247,0.04)'
};

const MODEL_NAMES = {
  'vision': { name: 'Gemini 3', sub: 'Flash (Preview)', color: '#4285F4' },
  'image': { name: 'Nano', sub: 'Banana', color: '#FBBC05' },
  'music': { name: 'Lyria', sub: '', color: '#34A853' },
  'video': { name: 'Veo', sub: '', color: '#EA4335' },
  'agent': { name: 'Autopilot', sub: 'Beta', color: '#A855F7' }
};

const MODE_LABEL_META = {
  'vision':    { emoji: '🔍', label: 'Vision mode',    bg: 'rgba(66,133,244,0.10)',   border: 'rgba(66,133,244,0.22)',   color: 'rgba(100,160,255,0.55)' },
  'image':     { emoji: '✨', label: 'Image mode',     bg: 'rgba(251,188,5,0.08)',    border: 'rgba(251,188,5,0.22)',    color: 'rgba(251,188,5,0.55)' },
  'music':     { emoji: '🎵', label: 'Music mode',     bg: 'rgba(52,168,83,0.08)',    border: 'rgba(52,168,83,0.22)',    color: 'rgba(52,168,83,0.55)' },
  'video':     { emoji: '🎬', label: 'Video mode',     bg: 'rgba(234,67,53,0.08)',    border: 'rgba(234,67,53,0.22)',    color: 'rgba(234,67,53,0.55)' },
  'broadcast': { emoji: '🎙️', label: 'Broadcast',      bg: 'rgba(45,212,191,0.08)',   border: 'rgba(45,212,191,0.22)',   color: 'rgba(45,212,191,0.55)' },
  'agent':     { emoji: '🧭', label: 'Autopilot mode',  bg: 'rgba(168,85,247,0.08)',   border: 'rgba(168,85,247,0.22)',   color: 'rgba(196,150,255,0.55)' },
};

function updateModeLabel(mode) {
  const el = document.getElementById('modeLabel');
  if (!el) return;
  const m = MODE_LABEL_META[mode] || MODE_LABEL_META['vision'];
  el.textContent = m.emoji + ' ' + m.label;
  el.style.background = m.bg;
  el.style.borderColor = m.border;
  el.style.color = m.color;
}

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
  let _modeCheckInFlight = false; // dedupe — prevents rapid clicks stacking cards

  btns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.mode;
      if (mode === currentAiMode) return;
      if (_modeCheckInFlight) return; // already probing, ignore extra clicks

      if (mode !== 'vision' && mode !== 'agent') {
        // Flash button immediately so click feels responsive
        btn.classList.add('active');
        _modeCheckInFlight = true;
        try {
          const synced = await chrome.storage.sync.get(['geminiApiKey']);
          const apiKey = synced.geminiApiKey;

          if (!apiKey) {
            // No key at all — tell the user to add one first.
            btns.forEach(b => b.classList.toggle('active', b.dataset.mode === currentAiMode));
            const thread = document.getElementById('chatThread');
            if (thread) {
              const card = document.createElement('div');
              card.className = 'chat-bubble ai';
              card.style.cssText = 'background:transparent;padding:0;border:none;';
              card.innerHTML = buildNeedKeyForPaidCard(mode);
              thread.appendChild(card);
              thread.scrollTop = thread.scrollHeight;
            }
            _modeCheckInFlight = false;
            return;
          }
          // User has their own API key — let them switch to any mode.
          // If Google requires billing for this feature, the actual API call
          // will return a clear billing error at that point instead of
          // pre-blocking here based on an estimated tier.
        } catch (_) {
          _modeCheckInFlight = false;
        }
        _modeCheckInFlight = false;
      } // end if (mode !== 'vision' && mode !== 'agent')

      currentAiMode = mode;
      chrome.storage.sync.set({ geminiModel: mode });
      
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Show agent tool buttons only on Vision; hide on Image/Music/Video
      const toolBtnGroup = document.querySelector('.tool-btn-group');
      if (toolBtnGroup) toolBtnGroup.style.display = mode === 'vision' ? 'flex' : 'none';

      // Voice selector is for TTS read-aloud only — never show in Music/Song mode
      const voiceSel = document.getElementById('voiceSelector');
      if (voiceSel) voiceSel.style.display = 'none';
      
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
      
      updateModeLabel(mode);
      showModeSubBar(mode);

      const thread = document.getElementById('chatThread');
      if (thread) thread.scrollTop = thread.scrollHeight;
      
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
      updateModeLabel(mode);
      // Show agent tools only for vision on initial load
      const toolBtnGroupInit = document.querySelector('.tool-btn-group');
      if (toolBtnGroupInit) toolBtnGroupInit.style.display = mode === 'vision' ? 'flex' : 'none';
      showModeSubBar(mode);
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
  // Buttons stay visible — clicking them without a prepaid key shows the upgrade prompt.

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
          <span style="font-size:20px;">✨</span>
          <span style="font-size:14px;font-weight:700;color:#e8eef4;">Image Studio</span>
        </div>
        <button class="studio-surprise-btn" style="padding:6px 14px;border-radius:8px;border:1px solid rgba(255,107,237,0.25);background:rgba(255,107,237,0.06);color:#ff6bed;font-size:11px;font-weight:600;cursor:pointer;">🎲 Surprise Me</button>
      </div>
      <textarea class="studio-desc" placeholder="What do you want to create? Describe it here..." style="width:100%;box-sizing:border-box;height:48px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,107,237,0.15);border-radius:10px;padding:12px 14px;color:#e8eef4;font-size:13px;font-family:inherit;resize:none;outline:none;overflow:hidden;transition:border-color 0.2s;"></textarea>
      <button class="studio-create-btn" style="width:100%;padding:10px;border-radius:10px;border:none;background:linear-gradient(135deg,#ff6bed,#cc44bb);color:#fff;font-size:13px;font-weight:700;cursor:pointer;margin-top:10px;opacity:0.4;pointer-events:none;">✨ Create Image</button>
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

// NOTE (2026-07-06): veo-3.0-* and veo-2.0-* were fully retired by Google (404 on
// GET /v1beta/models/<id>). Only the veo-3.1-*-preview family is live — do not add
// back 3.0/2.0 entries without re-verifying they resolve first.
const VEO_MODELS = [
  { id: MODELS.veo31,      label: '3.1',      desc: 'Best quality',          tier: 'top'   },
  { id: MODELS.veo31Fast,  label: '3.1 Fast', desc: 'Cheapest way to extend (720p)', tier: 'mid'   },
  { id: MODELS.veo31Lite,  label: '3.1 Lite', desc: 'Quick drafts',          tier: 'lite'  }
];

// Real Google Veo pricing (Gemini API / Vertex AI public rates, USD per second of video).
// Source: https://ai.google.dev/gemini-api/docs/pricing  &  https://cloud.google.com/vertex-ai/generative-ai/pricing
const VEO_PRICING = {
  [MODELS.veo31]:      0.40,  // Veo 3.1 (with audio)
  [MODELS.veo31Fast]:  0.10,  // Veo 3.1 Fast @ 720p — default model, cheapest way to extend ($0.70 / 7s clip)
  [MODELS.veo31Lite]:  0.10   // Veo 3.1 Lite
};

// Veo negative prompt — sent via parameters.negativePrompt INSTEAD of being
// pasted into the prompt body. Inline negation ("no text, no captions...")
// is a documented Veo anti-pattern: it primes the text-rendering head on the
// very tokens we want to suppress, increasing the chance of garbled writing
// in the frame. The dedicated parameter routes through a separate
// suppression head and works far better in practice.
// Task #31: Trimmed to only true rendering defects. The previous list
// also banned on-screen text / captions / watermarks / logos, which
// suppressed perfectly valid user requests like "title card that says
// HELLO" or "a coffee mug with the Starbucks logo". Veo's own model
// already avoids gibberish reasonably well; this list now just cleans
// up the worst residual artifacts.
const VEO_NEGATIVE_PROMPT = 'gibberish writing, distorted faces, extra limbs, blurry';

// Lyria music pricing (Vertex AI, USD per second of audio).
const LYRIA_PRICING = {
  [MODELS.musicDefault]: 0.06,  // Lyria 3 (preview)
  [MODELS.lyria3Pro]:    0.10,  // Lyria 3 Pro (preview, higher fidelity)
  [MODELS.ttsPrimary]:   0.015  // TTS fallback (not real music)
};
const LYRIA_MODELS_DISPLAY = [
  { id: MODELS.musicDefault, label: 'Lyria 3', desc: 'Default music model' },
  { id: MODELS.lyria3Pro,    label: 'Lyria 3 Pro', desc: 'Higher-fidelity (fallback)' },
  { id: MODELS.ttsPrimary,   label: 'Gemini TTS', desc: 'Voice fallback (not music)' }
];

// Default: Veo 3.1 Fast @ 720p — cheapest way to extend videos ($0.10/s = $0.70 per 7s clip)
let selectedVeoModel = MODELS.veo31Fast;
let selectedVideoDuration = 8;
// Requested TOTAL video length (base 8s clip + N native extends of +7s each).
// Native extend always adds exactly 7s per Google's API, so totals land at
// 8/15/22/29s rather than round numbers like 16/24/32 — the UI labels use "~"
// to signal that. Auto-chained in showVideoResult() once each clip lands.
let selectedTotalDuration = 8;
let selectedClipCount = 1; // locked — single 8s clip only, no stitching
let selectedAspectRatio = '16:9'; // landscape by default; toggled by vsb-aspect buttons
let userAvailableVeoModels = [];
let selectedMusicModel = MODELS.musicDefault;

// Task #32: User-controllable director creativity. Persists across sessions
// via chrome.storage.local under 'snaptoai_creativity'. Maps to the temperature
// passed to generateAnchoredStoryboard() — Literal stays close to the user's
// brief, Balanced is the default Task #31 setting, Cinematic gives Gemini
// room for bolder lens / lighting / framing invention.
let selectedCreativity = 'balanced';
const CREATIVITY_LEVELS = {
  literal:   { temp: 0.2,  label: 'Literal',   desc: 'Sticks tight to your brief.' },
  balanced:  { temp: 0.35, label: 'Balanced',  desc: 'Default — cinematic but on-brief.' },
  cinematic: { temp: 0.6,  label: 'Cinematic', desc: 'Bolder lens, lighting & framing.' }
};
function creativityTemp(level) {
  return (CREATIVITY_LEVELS[level] || CREATIVITY_LEVELS.balanced).temp;
}
function creativityLabel(level) {
  return (CREATIVITY_LEVELS[level] || CREATIVITY_LEVELS.balanced).label;
}
try {
  chrome.storage.local.get('snaptoai_creativity', (res) => {
    const v = res && res.snaptoai_creativity;
    if (v && CREATIVITY_LEVELS[v]) selectedCreativity = v;
  });
} catch {}

// ── Mode sub-bars ─────────────────────────────────────────────────────────
let _videoSubBarInited = false;
let _vsbStylizeStyle = 'realistic'; // matches the vsb-active default in the HTML

function initVideoSubBar() {
  if (_videoSubBarInited) return;
  _videoSubBarInited = true;
  const bar = document.getElementById('videoSubBar');
  if (!bar) return;

  // Sync globals to match what the HTML marks as active by default
  selectedVideoDuration = 8;
  selectedAspectRatio = '16:9';
  _vsbStylizeStyle = 'realistic'; // HTML default is ✨ Real (vsb-active on realistic button)
  // selectedCreativity already defaults to 'balanced' which matches the HTML default

  bar.querySelectorAll('.vsb-creat').forEach(btn => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.vsb-creat').forEach(b => b.classList.remove('vsb-active'));
      btn.classList.add('vsb-active');
      selectedCreativity = btn.dataset.creat;
      try { chrome.storage.local.set({ snaptoai_creativity: selectedCreativity }); } catch {}
    });
  });

  bar.querySelectorAll('.vsb-dur').forEach(btn => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.vsb-dur').forEach(b => b.classList.remove('vsb-active'));
      btn.classList.add('vsb-active');
      selectedVideoDuration = parseInt(btn.dataset.dur);
    });
  });

  bar.querySelectorAll('.vsb-aspect').forEach(btn => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.vsb-aspect').forEach(b => b.classList.remove('vsb-active'));
      btn.classList.add('vsb-active');
      selectedAspectRatio = btn.dataset.aspect;
    });
  });

  bar.querySelectorAll('.vsb-total').forEach(btn => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.vsb-total').forEach(b => b.classList.remove('vsb-active'));
      btn.classList.add('vsb-active');
      selectedTotalDuration = parseInt(btn.dataset.total);
    });
  });

  const snapCb = document.getElementById('vsbUseSnap');
  const stylizeRow = document.getElementById('vsbStylizeRow');
  if (snapCb && stylizeRow) {
    // Show immediately on init if checkbox is already checked (it is by default)
    stylizeRow.style.display = snapCb.checked ? 'flex' : 'none';
    if (snapCb.checked) {
      try { chrome.storage.local.set({ _videoStylizeStyle: _vsbStylizeStyle }); } catch {}
    }
    snapCb.addEventListener('change', () => {
      stylizeRow.style.display = snapCb.checked ? 'flex' : 'none';
      if (snapCb.checked) {
        try { chrome.storage.local.set({ _videoStylizeStyle: _vsbStylizeStyle }); } catch {}
      } else {
        try { chrome.storage.local.remove('_videoStylizeStyle'); } catch {}
      }
    });
  }

  bar.querySelectorAll('.vsb-style').forEach(btn => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.vsb-style').forEach(b => b.classList.remove('vsb-active'));
      btn.classList.add('vsb-active');
      _vsbStylizeStyle = btn.dataset.style;
      const snapCb = document.getElementById('vsbUseSnap');
      if (snapCb?.checked) {
        try { chrome.storage.local.set({ _videoStylizeStyle: _vsbStylizeStyle }); } catch {}
      }
    });
  });
}

let _broadcastSubBarInited = false;
let _bsbSelFormat = 'talkshow';
let _bsbSelDur = '3';
let _bsbSelTrack = 'lofi';
let _bsbAttachments = [];

function initBroadcastSubBar() {
  if (_broadcastSubBarInited) return;
  _broadcastSubBarInited = true;
  const bar = document.getElementById('broadcastSubBar');
  if (!bar) return;

  // Auto-load snaps from queue
  (async () => {
    try {
      let snaps = [];
      try { snaps = await loadImagesFromIndexedDB(); } catch (_) {}
      if (!snaps.length) {
        const ses = await chrome.storage.session.get(['selectedSnaps', 'selectedSnap']);
        snaps = ses.selectedSnaps || (ses.selectedSnap ? [ses.selectedSnap] : []);
      }
      snaps.slice(0, 20).forEach((dataUrl, i) => {
        const raw = typeof dataUrl === 'string' ? dataUrl : '';
        const comma = raw.indexOf(',');
        const b64 = comma >= 0 ? raw.slice(comma + 1) : raw;
        const mime = (raw.match(/^data:([^;]+);/) || [])[1] || 'image/png';
        if (b64) _bsbAttachments.push({ type: 'image', name: `Snap ${i+1}`, mimeType: mime, data: b64, snapId: `snap_${i}` });
      });
      if (_bsbAttachments.length) bsbRenderAttachList();
      updateSourceBanner();
    } catch (_) {}
  })();

  // Makes it obvious whether Generate will use the attached screenshot(s) or
  // whatever text is typed above — the #1 confusing part users reported.
  function updateSourceBanner() {
    const banner = document.getElementById('bsbSourceBanner');
    const bannerText = document.getElementById('bsbSourceBannerText');
    if (!banner || !bannerText) return;
    const snapCount = _bsbAttachments.filter(a => a.snapId).length;
    if (snapCount > 0) {
      bannerText.textContent = `📸 Using ${snapCount === 1 ? 'your attached screenshot' : `your ${snapCount} attached screenshots`} as the source`;
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  }

  document.getElementById('bsbSourceBannerClear')?.addEventListener('click', () => {
    _bsbAttachments = _bsbAttachments.filter(a => !a.snapId);
    bsbRenderAttachList();
    updateSourceBanner();
    const ci = document.getElementById('chatInput');
    if (ci) ci.focus();
  });

  function bsbRenderAttachList() {
    const list = bar.querySelector('.bsb-attach-list');
    if (!list) return;
    list.innerHTML = '';
    const imgs  = _bsbAttachments.filter(a => a.type === 'image');
    const vids  = [...new Set(_bsbAttachments.filter(a => a.videoFile).map(a => a.videoFile))];
    const files = _bsbAttachments.filter(a => a.type === 'file');
    if (imgs.length) {
      const chip = Object.assign(document.createElement('div'), { textContent: `📷 ${imgs.length}` });
      chip.style.cssText = 'padding:3px 8px;border-radius:12px;background:rgba(45,212,191,0.1);border:1px solid rgba(45,212,191,0.25);font-size:10px;color:#2dd4bf;cursor:pointer;white-space:nowrap;';
      chip.title = 'Click to remove images';
      chip.onclick = () => { _bsbAttachments = _bsbAttachments.filter(a => a.type !== 'image'); bsbRenderAttachList(); updateSourceBanner(); };
      list.appendChild(chip);
    }
    vids.forEach(vf => {
      const chip = Object.assign(document.createElement('div'), { textContent: `🎬 ${vf.length > 12 ? vf.slice(0,10)+'…' : vf}` });
      chip.style.cssText = 'padding:3px 8px;border-radius:12px;background:rgba(167,139,250,0.1);border:1px solid rgba(167,139,250,0.25);font-size:10px;color:#a78bfa;cursor:pointer;white-space:nowrap;';
      chip.onclick = () => { _bsbAttachments = _bsbAttachments.filter(a => a.videoFile !== vf); bsbRenderAttachList(); };
      list.appendChild(chip);
    });
    files.forEach(f => {
      const chip = Object.assign(document.createElement('div'), { textContent: `📄 ${f.name.length > 10 ? f.name.slice(0,8)+'…' : f.name}` });
      chip.style.cssText = 'padding:3px 8px;border-radius:12px;background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.25);font-size:10px;color:#fbbf24;cursor:pointer;white-space:nowrap;';
      chip.onclick = () => { const i = _bsbAttachments.indexOf(f); if (i > -1) _bsbAttachments.splice(i, 1); bsbRenderAttachList(); };
      list.appendChild(chip);
    });
  }

  bar.querySelectorAll('.bsb-fmt').forEach(btn => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.bsb-fmt').forEach(b => { b.classList.remove('bsb-active'); b.style.color = ''; });
      btn.classList.add('bsb-active');
      _bsbSelFormat = btn.dataset.fmt;
      if (_bsbSelFormat === 'trailer') {
        btn.style.color = '#fde047';
        bar.querySelector('.bsb-trk[data-trk="cinematic"]')?.click();
      } else if (_bsbSelFormat === 'solotutorial') {
        btn.style.color = '#5eead4';
        bar.querySelector('.bsb-trk[data-trk="upbeat"]')?.click();
      }
    });
  });

  bar.querySelectorAll('.bsb-dur').forEach(btn => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.bsb-dur').forEach(b => b.classList.remove('bsb-active'));
      btn.classList.add('bsb-active');
      _bsbSelDur = btn.dataset.dur;
    });
  });

  bar.querySelectorAll('.bsb-trk').forEach(btn => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.bsb-trk').forEach(b => b.classList.remove('bsb-active'));
      btn.classList.add('bsb-active');
      _bsbSelTrack = btn.dataset.trk;
    });
  });

  const imgInput  = bar.querySelector('.bsb-img-input');
  const vidInput  = bar.querySelector('.bsb-vid-input');
  const fileInput = bar.querySelector('.bsb-file-input');

  bar.querySelector('.bsb-attach-img').addEventListener('click', () => imgInput.click());
  bar.querySelector('.bsb-attach-vid').addEventListener('click', () => vidInput.click());
  bar.querySelector('.bsb-attach-file').addEventListener('click', () => fileInput.click());

  imgInput.addEventListener('change', () => {
    Array.from(imgInput.files).slice(0, 20).forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        _bsbAttachments.push({ type: 'image', name: file.name, mimeType: file.type, data: ev.target.result.split(',')[1] });
        bsbRenderAttachList();
      };
      reader.readAsDataURL(file);
    });
    imgInput.value = '';
  });

  vidInput.addEventListener('change', () => {
    const file = vidInput.files[0]; if (!file) return;
    const url = URL.createObjectURL(file);
    const vid = document.createElement('video');
    vid.src = url; vid.muted = true; vid.preload = 'auto';
    let extractionStarted = false;
    const doExtract = (dur) => {
      if (extractionStarted) return;
      const safeD = (isFinite(dur) && dur > 0) ? dur : 60;
      const count = Math.min(25, Math.max(10, Math.ceil(safeD / 3)));
      extractionStarted = true;
      const times = Array.from({ length: count }, (_, i) => {
        if (i === 0) return 0.1;
        if (i === count - 1) return Math.max(safeD - 0.1, 0.2);
        return (safeD / (count - 1)) * i;
      });
      const frames = [];
      const captureOne = (t) => new Promise(resolve => {
        let done = false;
        const finish = () => {
          if (done) return; done = true;
          vid.removeEventListener('seeked', finish); clearTimeout(guard);
          const w = Math.min(vid.videoWidth || 640, 640), h = Math.min(vid.videoHeight || 360, 360);
          const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(vid, 0, 0, w, h);
          frames.push(cv.toDataURL('image/jpeg', 0.75).split(',')[1]);
          resolve();
        };
        const guard = setTimeout(finish, 3000);
        vid.addEventListener('seeked', finish);
        vid.currentTime = t;
      });
      (async () => {
        for (const t of times) await captureOne(t);
        URL.revokeObjectURL(url);
        _bsbAttachments = _bsbAttachments.filter(a => !(a.type === 'video-frame' && a.videoFile === file.name));
        frames.forEach((b64, fi) => {
          _bsbAttachments.push({ type: 'video-frame', name: `${file.name} frame ${fi+1}/${frames.length}`, videoFile: file.name, mimeType: 'image/jpeg', data: b64 });
        });
        const ci = document.getElementById('chatInput');
        if (ci && !ci.value.trim()) ci.value = `Video: "${file.name}"`;
        bsbRenderAttachList();
      })();
    };
    vid.onloadedmetadata = () => {
      if (isFinite(vid.duration) && vid.duration > 0) { doExtract(vid.duration); }
      else {
        const fd = () => { vid.removeEventListener('seeked', fd); doExtract(isFinite(vid.duration) ? vid.duration : vid.currentTime); };
        vid.addEventListener('seeked', fd); vid.currentTime = 1e10;
      }
    };
    vid.onerror = () => URL.revokeObjectURL(url);
    vid.load(); vidInput.value = '';
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0]; if (!file) return;
    const isText = /\.(txt|md|csv|json|html)$/i.test(file.name) || file.type.startsWith('text/');
    if (isText) {
      const reader = new FileReader();
      reader.onload = ev => {
        const ci = document.getElementById('chatInput');
        if (ci) ci.value += (ci.value ? '\n\n' : '') + ev.target.result;
      };
      reader.readAsText(file);
    } else {
      // Non-text files (e.g. PDF) previously stored with data:null, which meant
      // they were silently dropped from the actual generation request — the
      // attachment chip showed up but had no effect at all. Read the real file
      // bytes as base64 so Gemini can actually see the PDF/content.
      const reader = new FileReader();
      reader.onload = ev => {
        const b64 = (ev.target.result || '').split(',')[1] || null;
        _bsbAttachments.push({ type: 'file', name: file.name, mimeType: file.type || 'application/pdf', data: b64 });
        bsbRenderAttachList();
        updateSourceBanner();
      };
      reader.onerror = () => {
        addBubble?.(`Couldn't read "${file.name}" — try a .txt, .md, or .pdf file.`, 'error');
      };
      reader.readAsDataURL(file);
    }
    fileInput.value = '';
  });

  const genBtn = document.getElementById('bsbGenBtn');
  if (genBtn) {
    genBtn.addEventListener('click', () => {
      const thread = document.getElementById('chatThread');
      if (!thread) return;
      const ci = document.getElementById('chatInput');
      // Immediate feedback so the click never feels like it did nothing —
      // the spinner card takes over a moment later once it's inserted.
      const origLabel = genBtn.innerHTML;
      genBtn.disabled = true;
      genBtn.style.opacity = '0.55';
      showBroadcastCard(thread, {
        hidePicker: true,
        selFormat: _bsbSelFormat,
        selDur: _bsbSelDur,
        selTrack: _bsbSelTrack,
        attachments: [..._bsbAttachments],
        srcText: ci ? ci.value.trim() : '',
        autoStart: true
      });
      thread.scrollTop = thread.scrollHeight;
      setTimeout(() => {
        genBtn.disabled = false;
        genBtn.style.opacity = '1';
        genBtn.innerHTML = origLabel;
      }, 800);
    });
  }
}

function showModeSubBar(mode) {
  const videoBar     = document.getElementById('videoSubBar');
  const broadcastBar = document.getElementById('broadcastSubBar');
  if (videoBar) {
    videoBar.style.display = mode === 'video' ? 'flex' : 'none';
    if (mode === 'video') {
      initVideoSubBar();
      const hasSnaps = typeof currentImages !== 'undefined' && currentImages.length > 0;
      const snapLabel = document.getElementById('vsbSnapLabel');
      const snapCb    = document.getElementById('vsbUseSnap');
      const stylizeRow = document.getElementById('vsbStylizeRow');
      if (snapLabel) snapLabel.style.display = hasSnaps ? 'flex' : 'none';
      if (stylizeRow && snapCb) stylizeRow.style.display = (hasSnaps && snapCb.checked) ? 'flex' : 'none';
      if (hasSnaps && snapCb?.checked) {
        try { chrome.storage.local.set({ _videoStylizeStyle: _vsbStylizeStyle }); } catch {}
      } else {
        try { chrome.storage.local.remove('_videoStylizeStyle'); } catch {}
      }
    }
  }
  if (broadcastBar) {
    broadcastBar.style.display = mode === 'broadcast' ? 'flex' : 'none';
    if (mode === 'broadcast') initBroadcastSubBar();
  }

  // Broadcast has its own dedicated "Generate Podcast" button and its own
  // attach buttons (Photos/Video/File) below — showing the generic top
  // Send button and paperclip attach at the same time made it look like
  // there were two separate ways to do the same thing, and pressing the
  // top Send button did nothing (it just chatted instead of generating).
  // Hide the generic ones here so there is exactly one clear action.
  const sendBtn = document.getElementById('sendBtn');
  const uploadBtn = document.querySelector('label.upload-btn');
  if (sendBtn) sendBtn.style.display = mode === 'broadcast' ? 'none' : '';
  if (uploadBtn) uploadBtn.style.display = mode === 'broadcast' ? 'none' : '';
}

function showVideoStudio(thread) {
  const existing = thread.querySelector('.video-studio');
  if (existing) existing.remove();

  const studio = document.createElement('div');
  studio.className = 'chat-bubble ai video-studio';
  studio.style.cssText = 'padding: 0; margin: 8px 0; background: transparent; border: none; max-width: 100%; width: 100%;';

  const hasScreenshots = typeof currentImages !== 'undefined' && currentImages.length > 0;

  studio.innerHTML = `
    <div style="background:linear-gradient(135deg, rgba(138,180,248,0.05), rgba(66,133,244,0.02));border:1px solid rgba(138,180,248,0.15);border-radius:14px;padding:16px;">

      <!-- Header -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <span style="font-size:16px;">🎬</span>
        <span style="font-size:13px;font-weight:700;color:#8ab4f8;">Veo 3.1 Lite</span>
      </div>

      <!-- Model selector (hidden — locked to 3.1 Lite) -->
      <div class="veo-model-selector" style="display:none;"></div>

      <!-- Creativity -->
      <div class="veo-creativity-selector" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;align-items:center;">
        <span style="font-size:12px;color:#667788;width:100%;margin-bottom:2px;">Style:</span>
        ${Object.keys(CREATIVITY_LEVELS).map(k => {
          const sel = k === selectedCreativity;
          return `<button class="veo-creat-btn${sel ? ' selected' : ''}" data-creat="${k}" title="${CREATIVITY_LEVELS[k].desc}" style="padding:4px 10px;border-radius:8px;border:1px solid ${sel ? 'rgba(138,180,248,0.5)' : 'rgba(138,180,248,0.2)'};background:${sel ? 'rgba(138,180,248,0.15)' : 'rgba(138,180,248,0.04)'};color:${sel ? '#8ab4f8' : '#aabbcc'};font-size:12px;font-weight:600;cursor:pointer;">${CREATIVITY_LEVELS[k].label}</button>`;
        }).join('')}
      </div>

      <!-- Prompt -->
      <textarea class="studio-desc" placeholder="Describe your scene… e.g. 'A golden sunset over a misty mountain forest, cinematic wide shot'" style="width:100%;box-sizing:border-box;height:56px;background:rgba(255,255,255,0.03);border:1px solid rgba(138,180,248,0.15);border-radius:10px;padding:12px 14px;color:#e8eef4;font-size:13px;font-family:inherit;resize:none;outline:none;overflow:hidden;transition:border-color 0.2s;margin-bottom:10px;"></textarea>

      ${hasScreenshots ? `
      <!-- Screenshot options -->
      <div style="margin-bottom:10px;padding:10px 12px;background:rgba(255,255,255,0.02);border:1px solid rgba(138,180,248,0.1);border-radius:10px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:#aabbcc;">
          <input type="checkbox" class="studio-use-screenshot" style="accent-color:#8ab4f8;" checked>
          <span>📸 Use screenshot as starting frame</span>
        </label>
        <div class="studio-stylize-wrap" style="margin-top:8px;margin-left:24px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:#8899aa;">
            <input type="checkbox" class="studio-stylize-photo" style="accent-color:#8ab4f8;" checked>
            <span>✨ Stylize photo first (helps with safety filters)</span>
          </label>
          <div class="stylize-style-selector" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">
            <button class="stylize-btn selected" data-style="realistic" style="padding:3px 10px;border-radius:6px;border:1px solid rgba(0,217,255,0.5);background:rgba(0,217,255,0.15);color:#00d9ff;font-size:12px;font-weight:600;cursor:pointer;">✨ Realistic</button>
            <button class="stylize-btn" data-style="pixar" style="padding:3px 10px;border-radius:6px;border:1px solid rgba(138,180,248,0.2);background:rgba(138,180,248,0.04);color:#aabbcc;font-size:12px;font-weight:600;cursor:pointer;">Pixar 3D</button>
          </div>
        </div>
      </div>` : ''}

      <!-- Cost row hidden -->
      <div class="veo-price-card" style="display:none;"></div>

      <!-- Generate button -->
      <button class="studio-create-btn" style="width:100%;padding:11px;border-radius:10px;border:none;background:linear-gradient(135deg,#4285F4,#2563c4);color:#fff;font-size:13px;font-weight:700;cursor:pointer;opacity:0.4;pointer-events:none;">🎬 Generate 8s Video</button>
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
  descInput.addEventListener('focus', () => { descInput.style.borderColor = 'rgba(138,180,248,0.4)'; });
  descInput.addEventListener('blur', () => { descInput.style.borderColor = 'rgba(138,180,248,0.15)'; });

  function updateDurLabel() {
    const durLabel = studio.querySelector('.studio-dur-label');
    const total = selectedVideoDuration * selectedClipCount;
    if (durLabel) durLabel.textContent = selectedClipCount > 1 ? `${total}s total (${selectedClipCount} x ${selectedVideoDuration}s)` : `${total}s total`;
    renderVeoPriceTable(studio);
  }

  studio.querySelectorAll('.veo-dur-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      studio.querySelectorAll('.veo-dur-btn').forEach(b => {
        b.style.border = '1px solid rgba(138,180,248,0.2)';
        b.style.background = 'rgba(138,180,248,0.04)';
        b.style.color = '#aabbcc';
        b.classList.remove('selected');
      });
      btn.style.border = '1px solid rgba(138,180,248,0.5)';
      btn.style.background = 'rgba(138,180,248,0.15)';
      btn.style.color = '#8ab4f8';
      btn.classList.add('selected');
      selectedVideoDuration = parseInt(btn.dataset.dur);
      updateDurLabel();
    });
  });


  // Task #32: Creativity selector — persists to chrome.storage.local so the
  // user's preferred director temperature carries across sessions.
  const creatDescEl = studio.querySelector('.veo-creat-desc');
  studio.querySelectorAll('.veo-creat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      studio.querySelectorAll('.veo-creat-btn').forEach(b => {
        b.style.border = '1px solid rgba(138,180,248,0.2)';
        b.style.background = 'rgba(138,180,248,0.04)';
        b.style.color = '#aabbcc';
        b.classList.remove('selected');
      });
      btn.style.border = '1px solid rgba(138,180,248,0.5)';
      btn.style.background = 'rgba(138,180,248,0.15)';
      btn.style.color = '#8ab4f8';
      btn.classList.add('selected');
      const level = btn.dataset.creat;
      if (CREATIVITY_LEVELS[level]) {
        selectedCreativity = level;
        if (creatDescEl) creatDescEl.textContent = CREATIVITY_LEVELS[level].desc;
        try { chrome.storage.local.set({ snaptoai_creativity: level }); } catch {}
      }
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
        b.style.border = '1px solid rgba(138,180,248,0.2)';
        b.style.background = 'rgba(138,180,248,0.04)';
        b.style.color = '#aabbcc';
        b.classList.remove('selected');
      });
      btn.style.border = '1px solid rgba(138,180,248,0.5)';
      btn.style.background = 'rgba(138,180,248,0.15)';
      btn.style.color = '#8ab4f8';
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

  const surpriseBtn = studio.querySelector('.studio-surprise-btn');
  if (surpriseBtn) {
    surpriseBtn.addEventListener('click', () => {
      const idea = surpriseIdeas[Math.floor(Math.random() * surpriseIdeas.length)];
      descInput.value = idea;
      createBtn.style.opacity = '1';
      createBtn.style.pointerEvents = 'auto';
      surpriseBtn.textContent = '🎲 Another!';
    });
  }
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
    realistic: 'Enhance this photo to look like a premium professional photograph. Keep the exact same person, their face, facial features, skin tone, hair, expression, clothing, and background completely unchanged. Improve lighting to soft professional studio light, increase sharpness and detail, make skin texture natural and photorealistic. Do not change the art style — keep it 100% real and photographic. Do not add any text or words.',
    pixar: 'Transform this photo into a Pixar/Disney 3D animated style. Keep the exact same people, poses, expressions, clothing, and background but render everything as high-quality 3D Pixar animation. Do not add any text or words.',
    anime: 'Transform this photo into beautiful Japanese anime style. Keep the exact same people, poses, expressions, clothing, and background but render everything as detailed anime art. Do not add any text or words.',
    cartoon: 'Transform this photo into a fun colorful cartoon style like a modern animated movie. Keep the exact same people, poses, expressions, clothing, and background. Do not add any text or words.',
    watercolor: 'Transform this photo into a beautiful watercolor painting. Keep the exact same people, poses, expressions, clothing, and background but render as soft watercolor art. Do not add any text or words.'
  };

  const cleanB64 = imageData.includes(',') ? imageData.split(',')[1] : imageData;
  let mimeType = 'image/png';
  if (imageData.startsWith('data:')) {
    const match = imageData.match(/^data:(image\/[a-zA-Z+]+);/);
    if (match) mimeType = match[1];
  }

  const models = MODELS.imageChain;
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
    addBubble('🔑 Video needs your own Gemini API key. Opening the key setup for you...', 'ai');
    try { await showProxyKeyPrompt(); } catch (e) {}
    return;
  }

  // Try old studio card checkbox first; fall back to the sub-bar snap toggle
  const useScreenshot = document.querySelector('.studio-use-screenshot') || document.getElementById('vsbUseSnap');
  const includeImage = useScreenshot && useScreenshot.checked && typeof currentImages !== 'undefined' && currentImages.length > 0;

  const modelName = selectedVeoModel || MODELS.veoFallback;
  const clipCount = selectedClipCount || 1;
  const totalDur = selectedVideoDuration * clipCount;

  // ── HeyGen-style plan approval for multi-clip videos ──────────────
  // Build the storyboard FIRST and let the user approve it before any
  // Veo credits are charged. Single clips skip this step (low risk, no
  // continuity to coordinate). Cancelling here is free.
  let prebuiltScenes = null;
  // selectedAspectRatio is now a global — set by vsb-aspect buttons in the bar
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
      prebuiltScenes = await buildClipScenes(prompt, clipCount, apiKey, selectedVideoDuration, creativityTemp(selectedCreativity), selectedCreativity);
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
          <span style="font-size:13px;font-weight:600;color:#ffa500;">Generating 8s video…</span>
        </div>
        <button class="veo-stop-btn" style="padding:5px 12px;border-radius:8px;border:1px solid rgba(255,107,107,0.5);background:rgba(255,107,107,0.1);color:#ff6b6b;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">⏹ Stop &amp; keep what I have</button>
      </div>
      <div style="font-size:12px;color:#8899aa;margin-bottom:10px;">Using ${modelName.replace(/-generate.*/, '')} · this takes 1-2 minutes.</div>
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
  let _realisticRefImage = null; // original image passed as referenceImages lock when Real mode
  if (includeImage) {
    // Read from storage (set by pill clicks) OR fall back to the JS variable
    // so stylize always fires when Snap is checked, even without a pill click.
    const styleData = await chrome.storage.local.get('_videoStylizeStyle');
    const stylizeStyle = styleData._videoStylizeStyle ||
      (typeof _vsbStylizeStyle !== 'undefined' ? _vsbStylizeStyle : 'pixar');
    chrome.storage.local.remove('_videoStylizeStyle');

    if (stylizeStyle === 'realistic' && currentImages[0]) {
      // REAL MODE: skip stylization entirely — keep the original image as-is.
      // Pass it as referenceImages so Veo locks the subject's appearance.
      const imgData = currentImages[0];
      const cleanB64 = imgData.includes(',') ? imgData.split(',')[1] : imgData;
      let mimeType = 'image/jpeg';
      if (imgData.startsWith('data:')) {
        const match = imgData.match(/^data:(image\/[a-zA-Z+]+);/);
        if (match) mimeType = match[1];
      }
      _realisticRefImage = { base64: cleanB64, mimeType };
      const text = progressBubble.querySelector('.video-progress-text');
      if (text) text.textContent = '📸 Real mode — keeping your photo as-is...';
    } else if (stylizeStyle && currentImages[0]) {
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

  // Real Veo "extend" (7s continuation, server-side stitched) only works on
  // Veo 3.1 / 3.1 Fast, single-clip flow. Record the model/aspect ratio here
  // so continueClip() can decide whether real extend is eligible later.
  if (_lastVideoContext && clipCount === 1) {
    _lastVideoContext.modelUsed = modelName;
    _lastVideoContext.aspectRatioUsed = selectedAspectRatio;
    _lastVideoContext.totalDurationSec = selectedVideoDuration;
    _lastVideoContext.extendCount = 0;
  }

  if (clipCount === 1) {
    await generateSingleClip(prompt, apiKey, modelName, includeImage, progressBubble, thread, stylizedImage, selectedAspectRatio, _realisticRefImage);
  } else {
    await generateMultiClip(prompt, apiKey, modelName, includeImage, clipCount, progressBubble, thread, stylizedImage, prebuiltScenes, selectedAspectRatio);
  }
}

async function generateSingleClip(prompt, apiKey, modelName, includeImage, progressBubble, thread, stylizedImage, aspectRatio, realisticRefImage) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predictLongRunning?key=${apiKey}`;

    // REAL MODE: prepend photorealistic style anchors so Veo doesn't drift to cartoon
    const finalPrompt = realisticRefImage
      ? `Photorealistic. Cinematic live-action. Hyper-realistic detail. Natural skin tones and textures. Shot on 35mm lens. Maintain the exact appearance, lighting, and style of the reference image. No animation, no cartoon, no illustrated style. ${prompt}`
      : prompt;

    const requestBody = {
      instances: [{ prompt: finalPrompt }],
      parameters: {
        aspectRatio: aspectRatio || '16:9',
        sampleCount: 1,
        durationSeconds: selectedVideoDuration,
        resolution: '720p',
        // negativePrompt removed — current Veo models reject it
        enhancePrompt: false
      }
    };

    // REAL MODE: pass original image as referenceImages to lock subject appearance
    if (realisticRefImage) {
      requestBody.parameters.referenceImages = [{
        referenceImage: { bytesBase64Encoded: realisticRefImage.base64, mimeType: realisticRefImage.mimeType },
        referenceType: 'REFERENCE_TYPE_SUBJECT'
      }];
      requestBody.instances[0].image = { bytesBase64Encoded: realisticRefImage.base64, mimeType: realisticRefImage.mimeType };
    } else if (includeImage && (stylizedImage || currentImages[0])) {
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
    // Task #28: dev-only log gated behind the snaptoai_debug_veo flag.
    if (_veoDebugLogEnabled()) {
      try {
        const _p = requestBody.instances[0].prompt || '';
        const _t = _p.length > 700 ? _p.slice(0, 700) + `… [+${_p.length - 700} chars]` : _p;
        console.log(`[veo prompt] single clip (${modelName}):\n${_t}`);
      } catch {}
    }
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

    // Task #31: Same defensive pattern for enhancePrompt. If a Veo variant
    // doesn't recognize the flag, strip it and retry rather than failing
    // the whole video. Google may add/remove this flag per model tier.
    if (!resp.ok && requestBody.parameters && 'enhancePrompt' in requestBody.parameters) {
      const lower = (data?.error?.message || '').toLowerCase();
      if (resp.status === 400 && lower.includes('enhanceprompt')) {
        console.log(`[SnapToAI Video] Model ${modelName} rejected enhancePrompt — retrying single-clip without it.`);
        delete requestBody.parameters.enhancePrompt;
        try {
          resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          });
          data = await resp.json();
        } catch (epErr) {
          console.log('[SnapToAI Video] enhancePrompt-stripped retry threw:', epErr.message);
        }
      }
    }

    // Defensive retry: referenceImages is only supported by the new generateVideos
    // API, not by the predictLongRunning endpoint we use. Strip it and retry —
    // the image is still passed as instances[0].image (starting frame), which is
    // supported everywhere and still anchors the subject's appearance.
    if (!resp.ok && requestBody.parameters && requestBody.parameters.referenceImages) {
      const lower = (data?.error?.message || '').toLowerCase();
      if (resp.status === 400 && lower.includes('referenceimages')) {
        console.log(`[SnapToAI Video] Model ${modelName} rejected referenceImages — retrying without it (image kept as starting frame).`);
        delete requestBody.parameters.referenceImages;
        try {
          resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          });
          data = await resp.json();
        } catch (riErr) {
          console.log('[SnapToAI Video] referenceImages-stripped retry threw:', riErr.message);
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
    if (_lastVideoContext) _lastVideoContext.operationName = operationName;
    pollVideoStatus(operationName, apiKey, progressBubble, thread, (videoUri, mimeType) => {
      if (_lastVideoContext) _lastVideoContext.videoRef = { uri: videoUri, mimeType };
    });

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
        //
        // Task #14 + #16 priority order for the conditioning image:
        //   1. ctx.userTransitionFrames[clipIdx-1] — admin-uploaded reference
        //      (rescues broken auto-extracts; honored even on clip 1 for #16)
        //   2. ctx.characterAnchor for clip ≥2 if the shot mentions a person —
        //      keeps identity stable across long videos (#14)
        //   3. ctx.transitionFrames[clipIdx-1] — rolling last frame (default)
        let attachedChainImage = null;
        let chainSourceLabel = '';
        if (clipIdx > 0) {
          await refreshTransitionFrame(ctx, clipIdx - 1);
          const userOverride = (ctx.userTransitionFrames || {})[clipIdx - 1];
          const rollingFrame = Array.isArray(ctx.transitionFrames) && ctx.transitionFrames[clipIdx - 1];
          const sceneText = clipScenes[clipIdx] || prompt || '';
          if (userOverride && userOverride.base64) {
            attachedChainImage = userOverride;
            chainSourceLabel = 'user-supplied reference';
          } else if (clipIdx >= 2 && ctx.characterAnchor && ctx.characterAnchor.base64 && clipMentionsCharacter(sceneText)) {
            attachedChainImage = ctx.characterAnchor;
            chainSourceLabel = 'character anchor (clip 1)';
          } else if (rollingFrame && rollingFrame.base64) {
            attachedChainImage = rollingFrame;
            chainSourceLabel = 'rolling last frame';
          }
        }

        let scenePrompt = clipScenes[clipIdx] || prompt;
        // Task #28: When a chain image is attached, Veo already conditions on
        // that exact frame so the long SUPPORTING STYLE block is redundant —
        // and worse, it crowds out the user's brief in Veo's attention
        // budget. Slim the existing scene prompt by keeping the
        // [USER REQUEST...] and [THIS SEGMENT...] blocks (which carry any
        // per-clip edits and Fix Stitch overrides) and dropping the
        // SUPPORTING STYLE block. We deliberately read from clipScenes —
        // not meta.shots — so user edits in the storyboard editor and
        // per-clip re-renders are preserved.
        if (attachedChainImage) {
          scenePrompt = slimSceneForChainImage(scenePrompt, prompt);
        }

        // Task #28: dev-only log of the final prompt sent to Veo. Gated so
        // it doesn't fire in normal production sessions; flip it on with
        // either `localStorage.snaptoai_debug_veo = '1'` or
        // `window.SNAPTOAI_DEBUG_VEO = true` from devtools.
        if (_veoDebugLogEnabled()) {
          try {
            const _truncated = scenePrompt.length > 700
              ? scenePrompt.slice(0, 700) + `… [+${scenePrompt.length - 700} chars]`
              : scenePrompt;
            console.log(`[veo prompt] clip ${clipNum}/${clipCount} (${modelName}, chain=${attachedChainImage ? 'yes' : 'no'}):\n${_truncated}`);
          } catch {}
        }

        const requestBody = {
          instances: [{ prompt: scenePrompt }],
          parameters: {
            aspectRatio: ctx.aspectRatio || '16:9',
            sampleCount: 1,
            durationSeconds: durationSeconds,
            resolution: '720p',
            // negativePrompt removed — current Veo models reject it
            enhancePrompt: false
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
          console.log(`[SnapToAI Video] ✓ Clip ${clipNum} CHAINED via ${chainSourceLabel || 'last frame'} (model=${modelName}, image=${attachedChainImage.mimeType} ~${kb}KB) + continuity prefix`);
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

        // Task #31: Same defensive pattern for enhancePrompt on multi-clip.
        if (!resp.ok && requestBody.parameters && 'enhancePrompt' in requestBody.parameters) {
          const lower = errorMsg.toLowerCase();
          if (resp.status === 400 && lower.includes('enhanceprompt')) {
            console.log(`[SnapToAI Video] Model ${modelName} rejected enhancePrompt — retrying clip ${clipNum} without it.`);
            delete requestBody.parameters.enhancePrompt;
            try {
              resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
              });
              data = await resp.json().catch(() => ({}));
              errorMsg = (data?.error?.message) || '';
            } catch (epErr) {
              console.log('[SnapToAI Video] enhancePrompt-stripped retry threw:', epErr.message);
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
            if (_veoDebugLogEnabled()) {
              try {
                const _p2 = requestBody.instances[0].prompt || '';
                const _t2 = _p2.length > 700 ? _p2.slice(0, 700) + `… [+${_p2.length - 700} chars]` : _p2;
                console.log(`[veo prompt] clip ${clipNum}/${clipCount} text-only fallback:\n${_t2}`);
              } catch {}
            }
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

        // Task #31: Compounded-failure guard — if the FIRST failure was an
        // image reject and the text-only fallback above then trips on
        // negativePrompt or enhancePrompt, we'd otherwise give up. Re-run
        // the param-strip checks one more time so a model that rejects
        // both image input AND a parameter still gets a clean retry.
        if (!resp.ok && resp.status === 400) {
          const lower = (errorMsg || '').toLowerCase();
          let stripped = false;
          if (requestBody.parameters && requestBody.parameters.negativePrompt && lower.includes('negativeprompt')) {
            console.log(`[SnapToAI Video] Post-fallback: stripping negativePrompt for clip ${clipNum}.`);
            delete requestBody.parameters.negativePrompt;
            stripped = true;
          }
          if (requestBody.parameters && 'enhancePrompt' in requestBody.parameters && lower.includes('enhanceprompt')) {
            console.log(`[SnapToAI Video] Post-fallback: stripping enhancePrompt for clip ${clipNum}.`);
            delete requestBody.parameters.enhancePrompt;
            stripped = true;
          }
          if (stripped) {
            try {
              resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
              });
              data = await resp.json().catch(() => ({}));
              errorMsg = (data?.error?.message) || '';
            } catch (postFallbackErr) {
              console.log('[SnapToAI Video] Post-fallback param-strip retry threw:', postFallbackErr.message);
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
  // Task #28: Fallback also routes through compileScenePrompt so the user's
  // verbatim brief leads every clip and continuity language stays at the
  // bottom — same shape as the AI-generated path.
  const styleBible =
    `Visual consistency across all ${clipCount} segments: same characters, wardrobe, location, lighting, and color palette in every shot. Smooth, intentional camera motion — no abrupt cuts.`;
  const shots = [];
  const prompts = Array.from({length: clipCount}, (_, i) => {
    let beat;
    if (i === 0) {
      beat = `Opening — establish the scene exactly as described in the user brief above.`;
    } else if (i === clipCount - 1) {
      beat = `Final beat — bring the scene from the user brief to a natural close. Same characters and setting.`;
    } else {
      beat = `Continue the action from the user brief — develop it naturally without changing scene or characters.`;
    }
    shots.push(beat);
    return compileScenePrompt({
      userPrompt: prompt,
      styleBible,
      vibe: '',
      shot: beat,
      index: i,
      total: clipCount,
      clipDur: segLen
    });
  });
  prompts.meta = {
    title: (prompt || 'Your Video').split(/[.\n]/)[0].slice(0, 50).trim() || 'Your Video',
    script_summary: prompt,
    style_bible: styleBible,
    shots
  };
  return prompts;
}

// Task #28: Brief-adherence guard — verifies Gemini's storyboard didn't
// paraphrase the user's subject/action away. Returns false when the
// storyboard is so unmoored that we should throw it away and use the
// brief-anchored fallback template instead.
const _BRIEF_STOPWORDS = new Set([
  'the','and','for','with','that','this','from','into','onto','over','under',
  'about','their','they','your','have','will','would','could','should','then',
  'than','very','some','just','also','more','most','make','like','really',
  'video','clip','clips','shot','scene','please','make','using','around','while',
  'where','when','what','which','being','there','these','those','here'
]);
function _briefTokens(text) {
  return Array.from(new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]+/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !_BRIEF_STOPWORDS.has(w))
  ));
}
// Task #28: dev-only log gate. Off by default in production. Flip on with
// `localStorage.setItem('snaptoai_debug_veo','1')` or
// `window.SNAPTOAI_DEBUG_VEO = true` in devtools.
function _veoDebugLogEnabled() {
  try {
    if (typeof window !== 'undefined' && window.SNAPTOAI_DEBUG_VEO === true) return true;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('snaptoai_debug_veo') === '1') return true;
  } catch {}
  return false;
}

// Task #28: Build the slim chained-clip prompt by trimming the SUPPORTING
// STYLE block out of the live scene prompt. Reads from the current scene
// prompt (NOT meta.shots) so user edits in the storyboard editor and per-
// clip overrides from Fix Stitch / "Retry just this one" are preserved.
// Falls back to a brief-only prompt if the scene prompt isn't recognizable
// (e.g. legacy or hand-edited shape).
function slimSceneForChainImage(scenePrompt, fallbackBrief) {
  const header = '[CONTINUES FROM ATTACHED FRAME — same look, same subjects, no cut]';
  const text = String(scenePrompt || '');

  // Strip out the style and continuity blocks so Veo focuses on the action and the chained image.
  // Updated to match the new block tags used by compileScenePrompt.
  const trimmed = text
    .replace(/\n*\[VISUAL STYLE[^\]]*\][\s\S]*?(?=\n\[DIRECTOR'S NOTE\]|$)/i, '')
    .replace(/\n*\[DIRECTOR'S NOTE\][^\n]*\n?/i, '')
    .trim();

  // If we successfully trimmed it down to just the action block, use it.
  if (trimmed && trimmed.includes('[ACTION FOR THIS SEGMENT')) {
    return `${header}\n\n${trimmed}`;
  }

  // Legacy fallback if shape isn't recognized
  const brief = String(fallbackBrief || '').trim();
  const tail = trimmed || text.trim();
  const briefBlock = brief ? `[ORIGINAL SCRIPT]:\n${brief}\n\n` : '';
  return `${header}\n\n${briefBlock}${tail}`.trim();
}

function briefAdheres(userPrompt, parsed) {
  const tokens = _briefTokens(userPrompt);
  if (tokens.length === 0) return true; // brief too short to check meaningfully
  const inText = (s) => {
    const lower = String(s || '').toLowerCase();
    return tokens.some(t => lower.includes(t));
  };
  // Task #31: Loosened from "every clip must mention a brief token" to
  // "the style bible OR a majority of clips mention one". The strict
  // every-clip rule was throwing away perfectly good cinematic
  // storyboards just because one beat shot used a synonym (e.g. "she"
  // instead of repeating "the woman"), which collapsed us back to the
  // bland literal-prompt fallback. The director's job is to ADD
  // cinematic detail around the user's nouns — we still want the brief
  // present in the overall plan, just not policed down to every line.
  if (!Array.isArray(parsed?.clips) || parsed.clips.length === 0) return false;
  const bibleHit = inText(parsed?.style_bible);
  const clipHits = parsed.clips.filter(c => inText(c?.shot)).length;
  const majority = clipHits >= Math.ceil(parsed.clips.length / 2);
  return bibleHit || majority;
}

// Ask Gemini to produce a continuity-anchored storyboard.
// Returns array of clip prompts on success, null on failure.
async function generateAnchoredStoryboard(prompt, clipCount, apiKey, clipDur, temperature) {
  if (!apiKey || clipCount < 2) return null;
  const segLen = Number(clipDur) > 0 ? Number(clipDur) : 8;
  // Task #32: Temperature is now caller-controlled via the Video Studio
  // Creativity selector. Falls back to the Task #31 default (0.35) when
  // omitted so legacy callers / fallbacks still behave the same.
  const baseTemp = (typeof temperature === 'number' && temperature > 0) ? temperature : 0.35;
  // Retry uses a slightly tighter temperature than the primary attempt so
  // a parse failure doesn't compound by also dialing creativity up.
  const retryTemp = Math.max(0.2, baseTemp - 0.05);

  const directorBrief =
`You are a film director planning a ${clipCount * segLen}-second cinematic video that will be rendered by Google Veo as ${clipCount} sequential ${segLen}-second clips, then stitched together.

USER'S BRIEF (this is the contract — every subject, action, and concrete detail in here is non-negotiable):
"""
${prompt}
"""

YOUR JOB is to direct this scene cinematically — adding lighting, camera language, palette, mood, and lens choices — while staying true to the subject and action the user described. Treat the brief as the spine of the story:
- keep the same subject (e.g. if the brief says "golden retriever", don't swap in a different breed or animal),
- keep the same action (e.g. if the brief says "surfing a wave", the dog should still be surfing — you can vary how you frame it shot-to-shot),
- keep the same location and time of day the user named,
- don't invent a different premise or pivot to a "creative reinterpretation."

You CAN, and should:
- vary camera angle, lens, framing, and lighting between segments to give the cut real cinematic motion,
- describe the subject with pronouns or short descriptors after the first mention if it reads more naturally,
- pick beats that progress the action (setup → peak → resolve) rather than repeating the same moment.

Return STRICT JSON ONLY (no markdown, no commentary) in this exact shape:
{
  "title": "Max 6 words, title-case, no quotes.",
  "script_summary": "1-2 sentence pitch grounded in the user's subject and action.",
  "style_bible": "3-5 sentences of cinematic direction: lighting setup, color palette, lens / camera language, mood. ALWAYS include photorealism keywords such as 'photorealistic', 'cinematic live-action realism', 'shot on 35mm lens', 'natural skin tones', 'hyper-realistic'. You may describe the character's physical appearance using nouns the user already used (or generic descriptors if the user gave none). Don't restate the action here.",
  "clips": [
    { "shot": "What concretely happens in this ${segLen}s segment, grounded in the user's subject and action. Add one camera move or framing choice." },
    ... exactly ${clipCount} entries ...
  ]
}

Hard rules:
- The clips must read like one continuous take.
- The user's subject and action are clearly recognizable across the sequence (the style bible plus most shot descriptions should reference them).
- Never introduce new characters mid-sequence unless the user brief explicitly asks for it.
- Never cut to a different location.
- Keep each "shot" description under 50 words.
- ALWAYS direct for photorealistic, live-action cinematic output. Never animated, cartoon, illustrated, or CGI. The style_bible MUST contain at least one of: "photorealistic", "cinematic realism", "live-action", "hyper-realistic".`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.chat}:generateContent?key=${apiKey}`;

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
    // Task #31: Bumped temperature 0.25 -> 0.35 (and retry 0.2 -> 0.3).
    // 0.25 was producing flat, samey storyboards — the rapper-videos era
    // ran around 0.5-0.7. 0.35 gives the director enough room for real
    // cinematic instincts (lens choices, lighting moods, camera language)
    // without re-introducing the brief-drift we saw at 0.7.
    let parsed = await callGemini(directorBrief, baseTemp);
    if (!isValidParse(parsed)) {
      console.warn('[veo storyboard] first parse invalid, retrying with stricter brief');
      const stricter = directorBrief + `\n\nIMPORTANT: Your previous response was invalid. Return ONLY a single JSON object matching the schema above — no markdown fences, no preamble, no trailing text. The clips array MUST have exactly ${clipCount} entries.`;
      parsed = await callGemini(stricter, retryTemp);
      if (!isValidParse(parsed)) return null;
    }

    // Task #28: Brief-adherence guard. If Gemini paraphrased the user's
    // brief away (no significant subject token survives in the bible AND in
    // every clip's shot text), discard its output entirely so the
    // brief-anchored fallback template runs instead. Better to ship a plain
    // template that quotes the user verbatim than a polished storyboard
    // about a different scene.
    if (!briefAdheres(prompt, parsed)) {
      console.warn('[veo storyboard] adherence check FAILED — Gemini drifted from user brief, falling back to template');
      return null;
    }

    const bible = String(parsed.style_bible).trim();
    const prompts = parsed.clips.map((c, i) => {
      const shot = String(c.shot).trim();
      // Use the same compileScenePrompt template the editor's Save flow uses
      // so the user's verbatim brief always leads the prompt and the
      // production rules / continuity language stay short and at the bottom.
      return compileScenePrompt({
        userPrompt: prompt,
        styleBible: bible,
        vibe: '',
        shot,
        index: i,
        total: clipCount,
        clipDur: segLen
      });
    });
    // Decorate the array with title / summary / bible for the preview card.
    prompts.meta = {
      title: typeof parsed.title === 'string' ? parsed.title.trim() : '',
      script_summary: typeof parsed.script_summary === 'string' ? parsed.script_summary.trim() : '',
      style_bible: bible,
      shots: parsed.clips.map(c => String(c.shot).trim()),
      // Task #32: stamp the temperature actually used so the plan approval
      // card can show users which creativity mode produced this storyboard.
      director_temp: baseTemp
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
      aspectRatio: '16:9',
      // Task #32: surface which creativity mode produced this storyboard so
      // users can see why two runs of the same prompt feel different.
      creativity: meta.creativity || ''
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
              <div style="font-size:12px;color:#cdd6e0;line-height:1.5;white-space:pre-wrap;">${escapeHtml(draft.script_summary)}</div>
            </div>
            <div>
              <div style="font-size:10px;color:#667788;letter-spacing:1.2px;font-weight:700;margin-bottom:4px;">STYLE BIBLE</div>
              <div style="font-size:12px;color:${draft.style_bible ? '#cdd6e0' : '#667788'};line-height:1.5;font-style:${draft.style_bible ? 'normal' : 'italic'};">${draft.style_bible ? escapeHtml(draft.style_bible) : 'No extra style direction yet — click ✎ Edit to lock in lighting, palette, and camera language across every clip.'}</div>
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
              <button class="edit-aspect" data-val="1:1" style="padding:5px 10px;border-radius:6px;border:1px solid ${draft.aspectRatio === '1:1' ? 'rgba(255,165,0,0.6)' : 'rgba(255,255,255,0.1)'};background:${draft.aspectRatio === '1:1' ? 'rgba(255,165,0,0.15)' : 'rgba(0,0,0,0.3)'};color:#e6ecf3;font-size:11px;font-weight:600;cursor:pointer;">1:1</button>
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
              ${draft.creativity ? chip('🎨', `Creativity: ${creativityLabel(draft.creativity)}`) : ''}
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
        // Pass `prompt` (the raw user request) so it gets re-injected at the
        // top of every clip — otherwise editing the plan strips the user's
        // literal script from what Veo actually sees.
        liveScenes = recompileScenesFromMeta({
          title: draft.title,
          script_summary: draft.script_summary,
          style_bible: draft.style_bible,
          shots: [...draft.shots]
        }, clipCount, segLen, draft.vibe, prompt);
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

// Task #31: AI director restored. The April rapper-videos era ran the
// user's prompt through Gemini to expand it into a Style Bible + per-shot
// cinematic instructions BEFORE handing each clip to Veo. Task #28 +
// commit 0484b47 disabled this and shipped the user's literal prompt to
// every clip — which made every segment look like the same flat shot.
// We now call generateAnchoredStoryboard() first (cinematic enrichment
// with brief-anchoring guards), and only fall back to the literal
// template if the director call fails.
async function buildClipScenes(prompt, clipCount, apiKey, clipDur, temperature, creativityLevel) {
  if (clipCount < 2) return [];
  const directed = await generateAnchoredStoryboard(prompt, clipCount, apiKey, clipDur, temperature);
  if (directed && directed.length === clipCount) {
    console.log(`[veo storyboard] AI director succeeded — ${clipCount} cinematic clips (creativity=${creativityLevel || 'default'}, temp=${temperature ?? 0.35})`);
    // Task #32: stamp the human-readable creativity level on meta so the
    // plan approval card can render a "Creativity: Cinematic" chip.
    if (directed.meta && creativityLevel) directed.meta.creativity = creativityLevel;
    return directed;
  }
  console.log(`[veo storyboard] AI director unavailable, using brief-anchored fallback`);
  const fallback = buildAnchoredFallback(prompt, clipCount, clipDur);
  if (fallback && fallback.meta && creativityLevel) fallback.meta.creativity = creativityLevel;
  return fallback;
}

// Compile one clip prompt from edited meta (used when user edits the plan card).
// Always includes the user's original request + production rules + style bible
// + this segment's shot text. The [USER ORIGINAL REQUEST] block at the top
// MIRRORS what generateAnchoredStoryboard emits — without it, the moment the
// user clicks Edit → Save, their literal script vanishes from the Veo prompt
// and only the AI's paraphrase reaches the model. That was the #1 cause of
// "Veo isn't following my instructions" complaints.
function compileScenePrompt({ userPrompt, styleBible, vibe, shot, index, total, clipDur }) {
  const segLen = Number(clipDur) > 0 ? Number(clipDur) : 8;
  const t0 = index * segLen, t1 = (index + 1) * segLen;
  const vibeLine = vibe ? ` Vibe: ${vibe}.` : '';

  // Lead strictly with the AI Director's chunked action for this specific time window.
  // The full userPrompt is intentionally omitted here — including it caused Veo to
  // try to cram the entire story (including the ending) into Clip 1 because Veo
  // pays the most attention to the first few lines of the prompt.
  const shotBlock = `[ACTION FOR THIS SEGMENT — ${t0}s to ${t1}s]\n${shot}\n\n`;

  const styleBlock = styleBible
    ? `[VISUAL STYLE & CONTINUITY]\n${styleBible}${vibeLine}\n\n`
    : (vibeLine ? `[VISUAL STYLE & CONTINUITY]\n${vibeLine.trim()}\n\n` : '');

  const continuity = index === 0
    ? `[DIRECTOR'S NOTE] Establish the scene exactly. Do not rush to the end of the story.`
    : `[DIRECTOR'S NOTE] Same subjects, wardrobe, location, lighting, and palette as the previous segment.`;

  // Always enforce realism — without explicit keywords Veo defaults to cartoon/animated styles.
  const realism = `\n[RENDER STYLE] Photorealistic. Cinematic live-action. Shot on 35mm lens. Natural skin tones. Hyper-realistic detail. No animation, no cartoon, no illustrated, no CGI style.`;

  return `${shotBlock}${styleBlock}${continuity}${realism}`;
}

// Recompile the full scenes array from current meta state.
// Returns a new array with .meta attached, ready to feed generateMultiClip.
// `userPrompt` MUST be the raw user prompt — see compileScenePrompt header.
function recompileScenesFromMeta(meta, clipCount, clipDur, vibe, userPrompt) {
  const out = [];
  for (let i = 0; i < clipCount; i++) {
    out.push(compileScenePrompt({
      userPrompt: userPrompt || '',
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
    clipScenes = await buildClipScenes(prompt, clipCount, apiKey, selectedVideoDuration, creativityTemp(selectedCreativity), selectedCreativity);
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
                transitionFrames: [],
                // Task #14: Character anchor — clip 0's last frame, captured
                // ONCE and reused for any later clip whose shot mentions a
                // person. Prevents linear identity drift across long videos.
                characterAnchor: null,
                // Task #16: Per-clip extraction failure reasons. transitionFailures[i]
                // holds the error message from the failed extractLastFrame() for
                // clip i, so the UI can show "chain weakened" warnings.
                transitionFailures: {},
                // Task #16: User-uploaded reference frames keyed by predecessor
                // clip idx. userTransitionFrames[i] overrides transitionFrames[i]
                // when generating clip i+1. Lets users rescue a broken auto-chain.
                userTransitionFrames: {} };

  // Wire the Stop button. Sets a flag that all wait loops + the batch loop
  // observe; the user keeps every clip already rendered, no further Veo
  // requests are sent, and we render the partial outcome immediately.
  const stopBtn = progressBubble.querySelector('.veo-stop-btn');
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      if (ctx.userStopped) return;
      ctx.userStopped = true;
      // Immediately abort any in-flight stitch clip fetch so it doesn't hang
      if (ctx._fetchAbort) ctx._fetchAbort.abort();
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

      // Task #14: capture clip 0's last frame as a stable character anchor.
      // Reused for any clip 2+ whose shot mentions a person, instead of the
      // rolling last frame, so identity drift doesn't compound linearly.
      if (i === 0 && ctx.transitionFrames[0] && !ctx.characterAnchor) {
        ctx.characterAnchor = ctx.transitionFrames[0];
        console.log('[SnapToAI Video] ✓ Character anchor captured from clip 1 last frame');
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
// Task #16: also stashes the failure reason in ctx.transitionFailures[idx]
// so the UI can show a "chain weakened — clip N+1 may visually jump" badge
// and offer the user a manual reference-image upload.
//
// Cheap if already cached for the same URL (early return).
async function refreshTransitionFrame(ctx, idx) {
  if (!ctx || idx < 0 || !Array.isArray(ctx.clipResults)) return;
  const r = ctx.clipResults[idx];
  if (!r || !r.url) return;
  const cached = ctx.transitionFrames[idx];
  if (cached && cached._sourceUrl === r.url) {
    if (ctx.transitionFailures) delete ctx.transitionFailures[idx];
    return;
  }
  let frame = null;
  let err = null;
  try {
    frame = await extractLastFrame(r.url);
  } catch (e) {
    err = (e && e.message) || String(e);
  }
  if (!ctx.transitionFailures) ctx.transitionFailures = {};
  if (frame) {
    frame._sourceUrl = r.url;
    ctx.transitionFrames[idx] = frame;
    delete ctx.transitionFailures[idx];
  } else {
    ctx.transitionFailures[idx] = err || 'unknown extraction failure';
    if (cached) {
      // Best-effort: keep stale cache rather than wipe it.
      console.log(`[SnapToAI Video] Could not refresh transition frame for clip ${idx + 1}; keeping cached frame. (${ctx.transitionFailures[idx]})`);
    }
  }
}

// Task #14: heuristic for whether a shot description references a person.
// When true and we have a character anchor from clip 0, prefer the anchor
// over the rolling last frame so identity doesn't drift compoundingly.
//
// IMPORTANT: bare pronouns (he/she/his/her/them/...) are intentionally
// EXCLUDED. They appear in incidental phrases like "the camera follows his
// car" or "her house at dawn" where the shot isn't actually about a person.
// Triggering the character anchor on those would override the rolling
// last-frame chain with a face shot and break continuity for object/location
// scenes. We require a concrete person noun (or body part) instead.
const SNAPTOAI_CHARACTER_REGEX = /\b(person|people|man|men|woman|women|girl|boy|child|kid|baby|character|protagonist|hero|heroine|figure|silhouette|portrait|chef|cook|driver|player|actor|actress|dancer|singer|model|warrior|soldier|knight|wizard|witch|rider|pilot|ninja|samurai|astronaut|king|queen|prince|princess|villain|guard|teacher|student|doctor|nurse|cop|police|officer|detective|spy|musician|painter|artist|farmer|worker|elder|teen|teenager|adult|stranger|face|eyes|smile|hair|hand|arm|leg|body|torso|shoulder|head)\b/i;
function clipMentionsCharacter(text) {
  if (!text || typeof text !== 'string') return false;
  return SNAPTOAI_CHARACTER_REGEX.test(text);
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
    // Task #16: re-throw so refreshTransitionFrame can capture the reason
    // and surface it to the user as a "chain weakened" badge.
    console.log('[SnapToAI Video] extractLastFrame failed:', e.message);
    throw e;
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

  // One-time teardown hook: when the result bubble is removed from the DOM
  // (chat clear, navigation, history nuke), revoke any in-flight stitched
  // blob URL so we don't leak memory across long sessions. The audit found
  // we previously revoked ONLY on re-render, missing this path entirely.
  // Re-binds to a new parent if the bubble is moved (rare but possible when
  // chat is cleared and restored), so the teardown still fires on real
  // detach. Single-shot: the revoke and disconnect happen exactly once.
  if (!ctx._teardownObserver && progressBubble && progressBubble.parentNode) {
    const cleanup = () => {
      if (ctx.lastStitchedUrl) {
        try { URL.revokeObjectURL(ctx.lastStitchedUrl); } catch (_) {}
        ctx.lastStitchedUrl = null;
      }
      if (ctx._teardownObserver) {
        try { ctx._teardownObserver.disconnect(); } catch (_) {}
        ctx._teardownObserver = null;
      }
    };
    const observer = new MutationObserver(() => {
      if (!progressBubble.isConnected) {
        cleanup();
        return;
      }
      // Bubble was moved to a different parent — rebind so we still see the
      // eventual real removal.
      const currentParent = progressBubble.parentNode;
      if (currentParent && currentParent !== ctx._teardownTarget) {
        try { observer.disconnect(); } catch (_) {}
        try {
          observer.observe(currentParent, { childList: true });
          ctx._teardownTarget = currentParent;
        } catch (_) {
          ctx._teardownObserver = null;
          ctx._teardownTarget = null;
        }
      }
    });
    try {
      observer.observe(progressBubble.parentNode, { childList: true });
      ctx._teardownObserver = observer;
      ctx._teardownTarget = progressBubble.parentNode;
    } catch (_) {}
  }

  // --- Case A: 0 successful clips ---
  if (successUrls.length === 0) {
    progressBubble.innerHTML = buildVeoSummaryCard(ctx, billingAbortAt, /*hasSuccess*/ false, null);
    wireVeoRetryButtons(ctx);
    wireVeoRerenderButtons(ctx);
    return;
  }

  // --- Case B: at least 1 successful clip → show it directly, no stitching ---
  try {
    showVideoResult(progressBubble, successUrls[0], thread);
  } catch (err) {
    console.log('[Aion Video] Result error:', err.message);
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

  const failures = ctx.transitionFailures || {};
  const userRefs = ctx.userTransitionFrames || {};

  const rows = clipResults.map((r, idx) => {
    if (!r.url) return '';
    const prompt = (clipScenes && clipScenes[idx]) || '';
    // v2.4.9: "Fix Stitch" only makes sense when there's a previous successful
    // clip whose final frame we can borrow. Show it on clips 2..N.
    const prevHasUrl = idx > 0 && clipResults[idx - 1] && clipResults[idx - 1].url;
    const fixStitchBtn = prevHasUrl
      ? `<button class="veo-fix-stitch-btn" data-clip-idx="${idx}" title="Re-render this clip starting from the LAST FRAME of clip ${idx} so the join looks seamless." style="padding:4px 10px;border-radius:6px;border:1px solid rgba(0,217,255,0.4);background:rgba(0,217,255,0.1);color:#00d9ff;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">✂ Fix stitch (${idx}→${idx + 1})</button>`
      : '';

    // Task #16: surface a "chain weakened" warning when the previous clip's
    // last-frame extraction failed. Lets the user upload their own reference
    // image to rescue the visual handoff into this clip.
    let chainWarning = '';
    if (idx > 0 && (failures[idx - 1] || userRefs[idx - 1])) {
      const failReason = failures[idx - 1];
      const hasUserRef = !!(userRefs[idx - 1] && userRefs[idx - 1].base64);
      if (hasUserRef) {
        chainWarning = `<div style="margin-top:6px;padding:8px 10px;background:rgba(0,217,255,0.08);border:1px solid rgba(0,217,255,0.3);border-radius:8px;font-size:11px;color:#7fe7ff;line-height:1.5;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
          <span>✓ Custom reference image set for the chain into clip ${idx + 1}. Click <b>Fix stitch</b> above to apply it.</span>
          <button class="veo-clear-userref-btn" data-prev-idx="${idx - 1}" style="padding:3px 8px;border-radius:5px;border:1px solid rgba(0,217,255,0.4);background:transparent;color:#7fe7ff;font-size:10px;font-weight:600;cursor:pointer;">Clear</button>
        </div>`;
      } else if (failReason) {
        chainWarning = `<div style="margin-top:6px;padding:8px 10px;background:rgba(255,165,0,0.08);border:1px solid rgba(255,165,0,0.3);border-radius:8px;font-size:11px;color:#ffd180;line-height:1.5;">
          <div style="font-weight:600;margin-bottom:4px;">⚠ Chain weakened — clip ${idx + 1} may visually jump</div>
          <div style="color:#caa066;font-size:10px;font-family:ui-monospace,monospace;margin-bottom:6px;">extractLastFrame failed: ${escapeHtml(failReason)}</div>
          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;padding:4px 10px;border-radius:5px;border:1px dashed rgba(255,165,0,0.5);background:rgba(255,165,0,0.06);color:#ffa500;font-weight:600;">
            📎 Use my own reference image
            <input type="file" accept="image/*" class="veo-userref-input" data-prev-idx="${idx - 1}" data-clip-idx="${idx}" style="display:none;">
          </label>
        </div>`;
      }
    }

    return `<div style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 12px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap;">
        <span style="font-size:12px;font-weight:600;color:#cdd6e0;">🎬 Clip ${r.n}</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${fixStitchBtn}
          <button class="veo-rerender-toggle" data-clip-idx="${idx}" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(255,165,0,0.4);background:rgba(255,165,0,0.1);color:#ffa500;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">✎ Re-render this clip</button>
        </div>
      </div>
      ${chainWarning}
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

  // Task #16: file-picker for "Use my own reference image" — stores the
  // uploaded image in ctx.userTransitionFrames[prevIdx] so the next re-render
  // of clip prevIdx+1 will use it as the conditioning frame instead of the
  // (failed) auto-extracted last frame.
  progressBubble.querySelectorAll('.veo-userref-input').forEach(input => {
    if (input.dataset.wired === '1') return;
    input.dataset.wired = '1';
    input.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const prevIdx = parseInt(input.dataset.prevIdx, 10);
      if (isNaN(prevIdx) || prevIdx < 0) return;
      if (!/^image\//.test(file.type)) {
        alert('Please choose an image file.');
        return;
      }
      if (file.size > 7 * 1024 * 1024) {
        alert('Reference image is too large (max 7 MB).');
        return;
      }
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = () => reject(new Error('FileReader error'));
          fr.readAsDataURL(file);
        });
        const base64 = String(dataUrl).split(',')[1] || '';
        if (!base64 || base64.length < 100) throw new Error('Empty file');
        if (!ctx.userTransitionFrames) ctx.userTransitionFrames = {};
        ctx.userTransitionFrames[prevIdx] = { base64, mimeType: file.type };
        console.log(`[SnapToAI Video] User reference image set for chain into clip ${prevIdx + 2} (${file.type}, ~${Math.round(base64.length * 0.75 / 1024)}KB)`);
        await renderVeoBatchOutcome(ctx);
      } catch (err) {
        alert(`Could not read image: ${err.message}`);
      }
    });
  });

  progressBubble.querySelectorAll('.veo-clear-userref-btn').forEach(btn => {
    if (btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', async () => {
      const prevIdx = parseInt(btn.dataset.prevIdx, 10);
      if (isNaN(prevIdx)) return;
      if (ctx.userTransitionFrames) delete ctx.userTransitionFrames[prevIdx];
      await renderVeoBatchOutcome(ctx);
    });
  });

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
          // Task #14: refresh the character anchor when clip 0 (UI "Clip 1")
          // is re-rendered — that's a deliberate identity change by the user.
          // If extraction failed for the new clip 0, clear the stale anchor so
          // we don't keep applying an outdated identity to later clips.
          if (idx === 0) {
            if (ctx.transitionFrames[0]) {
              ctx.characterAnchor = ctx.transitionFrames[0];
              console.log('[SnapToAI Video] ✓ Character anchor refreshed from re-rendered clip 1');
            } else {
              ctx.characterAnchor = null;
              console.log('[SnapToAI Video] ⚠ Character anchor cleared — new clip 1 last-frame extraction failed');
            }
          }
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

// pollVideoStatusAsync, fetchWithTimeout, and fetchClipsWithAbort are defined
// in video-pipeline-core.js which is loaded before this script.
// Returns { url, status } where status is one of:
//   'success'         → got a video URL
//   'transient'       → network/HTTP error (caller should RETRY same clip)
//   'rate_limit'      → 429 / quota (caller should WAIT + RETRY same clip)
//   'timeout'         → exceeded maxPolls (caller should RETRY same clip)
//   'safety_blocked'  → content/safety filter rejection (skip clip, keep going)
//   'no_uri'          → completed but no video URI returned (skip clip, keep going)
//   'job_error'       → operation completed with a permanent error (skip clip, keep going)
// REMOVED: pollVideoStatusAsync definition moved to video-pipeline-core.js
/* BEGIN_REMOVED_pollVideoStatusAsync
function pollVideoStatusAsync(operationId, apiKey, progressBubble, clipNum, totalClips) {
  return new Promise((resolve) => {
    let pollCount = 0;
    // Adaptive interval: poll fast at first (5s) so users see early progress
    // updates, then back off to 15s once Veo is actually rendering. Without
    // this, the first 15s after submit show NO update and feel like a hang.
    // maxPolls accounts for the mixed cadence: 6× fast (30s) + 54× slow
    // (810s) = ~14 min ceiling (was 15 min) — close enough.
    const maxPolls = 60;
    let consecutiveErrors = 0;
    let stopped = false;
    const FAST_POLL_MS = 5000;
    const SLOW_POLL_MS = 15000;
    const FAST_POLL_COUNT = 6;
    const nextDelay = () => (pollCount < FAST_POLL_COUNT ? FAST_POLL_MS : SLOW_POLL_MS);

    // Recursive setTimeout (NOT setInterval) so a slow poll request can never
    // overlap with the next tick. Under a slow CDN setInterval would queue
    // multiple in-flight pollers that each duplicate work and confuse the
    // resolve race.
    const tick = async () => {
      if (stopped) return;
      pollCount++;

      if (pollCount > maxPolls) {
        stopped = true;
        const text = progressBubble.querySelector('.video-progress-text');
        if (text) text.textContent = `Clip ${clipNum} timed out.`;
        resolve({ url: null, status: 'timeout' });
        return;
      }

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/${operationId}?key=${apiKey}`;
        const resp = await fetchWithTimeout(url, { timeoutMs: 20000 });
        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
          if (resp.status === 429) { consecutiveErrors = 0; setTimeout(tick, nextDelay()); return; } // keep polling — quota will reset
          consecutiveErrors++;
          // Tolerate up to 3 transient HTTP errors before giving up on polling
          if (consecutiveErrors < 3) { setTimeout(tick, nextDelay()); return; }
          stopped = true;
          resolve({ url: null, status: 'transient' });
          return;
        }
        consecutiveErrors = 0;

        if (!data.done) {
          const pct = data.metadata?.percentComplete || Math.min(pollCount * 5, 90);
          const text = progressBubble.querySelector('.video-progress-text');
          if (text) text.textContent = `Clip ${clipNum}/${totalClips}: Rendering... ${pct}%`;
          setTimeout(tick, nextDelay());
          return;
        }

        stopped = true;
        console.log('[SnapToAI Video] Clip done raw:', JSON.stringify(data).substring(0, 800));

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

        const extractUri = (d) => {
          const gvr = d.response?.generateVideoResponse;
          if (gvr?.generatedSamples?.[0]?.video?.uri) return gvr.generatedSamples[0].video.uri;
          if (gvr?.generatedSamples?.[0]?.uri)        return gvr.generatedSamples[0].uri;
          if (d.response?.videos?.[0]?.uri)           return d.response.videos[0].uri;
          if (d.response?.videos?.[0]?.video?.uri)    return d.response.videos[0].video.uri;
          if (d.response?.generatedSamples?.[0]?.video?.uri) return d.response.generatedSamples[0].video.uri;
          if (d.response?.generatedSamples?.[0]?.uri) return d.response.generatedSamples[0].uri;
          if (d.predictions?.[0]?.video?.uri)         return d.predictions[0].video.uri;
          if (d.predictions?.[0]?.uri)                return d.predictions[0].uri;
          if (d.response?.predictions?.[0]?.video?.uri) return d.response.predictions[0].video.uri;
          if (d.response?.predictions?.[0]?.uri)      return d.response.predictions[0].uri;
          const str = JSON.stringify(d);
          const m = str.match(/"uri"\s*:\s*"(https?:\/\/[^"]+\.mp4[^"]*)"/);
          if (m) return m[1];
          return '';
        };

        let videoUri = extractUri(data);

        if (!videoUri) {
          // Veo sometimes marks done=true but video propagation lags by a few seconds.
          // Re-poll the same operation — status-aware: only accept a clean done=true
          // response with no error before extracting URI. 429/5xx count as transient
          // and we keep waiting rather than declaring no_uri immediately.
          const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${operationId}?key=${apiKey}`;
          for (let attempt = 1; attempt <= 5 && !videoUri; attempt++) {
            if (stopped) break; // invocation was cancelled — don't keep fetching
            await new Promise(r => setTimeout(r, attempt <= 2 ? 3000 : 5000));
            if (stopped) break;
            try {
              const r2 = await fetchWithTimeout(pollUrl, { timeoutMs: 20000 });
              if (!r2.ok) continue; // transient HTTP error — keep waiting
              const d2 = await r2.json().catch(() => ({}));
              if (!d2.done) continue; // still rendering — keep waiting
              if (d2.error) break;    // permanent error — stop re-polling
              console.log(`[SnapToAI Video] no_uri re-poll ${attempt}:`, JSON.stringify(d2).substring(0, 400));
              videoUri = extractUri(d2);
            } catch (_) { if (_.name === 'AbortError') break; }
          }
        }

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
          stopped = true;
          resolve({ url: null, status: 'transient' });
          return;
        }
        setTimeout(tick, nextDelay());
      }
    };
    // First poll fires after FAST_POLL_MS (5s) instead of 15s so users get
    // a status update quickly after submitting.
    setTimeout(tick, FAST_POLL_MS);
  });
}
// END_REMOVED_pollVideoStatusAsync */

// v2.4.7: Hardened stitcher with timeout, Stop-button support, play() race
// fix, and a setTimeout fallback so background tabs still make progress.
//
// `stitchCtx` is optional. If provided we honour stitchCtx.userStopped so the
// generation Stop button also aborts during stitching.
// Task #36 rewrite: previous stitcher used a complex crossfade state machine
// (AudioContext gain ramps + canvas globalAlpha overlays + async overlap-prep
// racing the rAF tick). On average hardware that produced "slow / broken"
// output even when individual clips were perfect. New approach is the
// simplest thing that can possibly work: hard cuts, one clip at a time,
// single MediaRecorder consuming a single canvas+audio MediaStream from
// start to finish. Realtime playback is still required (canvas.captureStream
// is wall-clock based) but with no crossfade contention the recorded frames
// are smooth and the audio doesn't glitch at clip boundaries.
// ---------------------------------------------------------------------------
// fetchWithTimeout — defined in video-pipeline-core.js (loaded before this
// script). See that file for the implementation and inline documentation.

// fixWebmDuration — repair the missing Duration in a MediaRecorder-produced
// WebM. Chrome's MediaRecorder writes EBML clusters but never back-fills the
// Segment Info Duration field, which is why downloaded files report
// `duration=N/A` to ffprobe and HANG on seek in browsers/players. We walk the
// EBML structure, locate the SegmentInfo > Duration element (id 0x4489), and
// rewrite it to the wall-clock duration in milliseconds. Pure JS, no deps,
// safe under MV3 CSP. Adapted from the canonical EBML duration-fix recipe.
// ---------------------------------------------------------------------------
async function fixWebmDuration(blob, durationMs) {
  try {
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);

    // Read a variable-length EBML integer (VINT). Returns {value, size}.
    function readVint(offset) {
      const first = view.getUint8(offset);
      if (first === 0) return null;
      let size = 1;
      let mask = 0x80;
      while (size <= 8 && !(first & mask)) { size++; mask >>= 1; }
      if (size > 8) return null;
      let value = first & (mask - 1);
      for (let i = 1; i < size; i++) value = value * 256 + view.getUint8(offset + i);
      return { value, size };
    }
    // Read element ID (VINT, but the leading bits are kept).
    function readId(offset) {
      const first = view.getUint8(offset);
      if (first === 0) return null;
      let size = 1, mask = 0x80;
      while (size <= 4 && !(first & mask)) { size++; mask >>= 1; }
      if (size > 4) return null;
      let id = 0;
      for (let i = 0; i < size; i++) id = id * 256 + view.getUint8(offset + i);
      return { id, size };
    }

    // Walk top-level EBML to find the Segment (id 0x18538067).
    let offset = 0;
    let segmentDataStart = -1;
    let segmentDataEnd = -1;
    while (offset < u8.length) {
      const idInfo = readId(offset);
      if (!idInfo) break;
      const sizeInfo = readVint(offset + idInfo.size);
      if (!sizeInfo) break;
      const dataStart = offset + idInfo.size + sizeInfo.size;
      // 0x01FFFFFFFFFFFFFF (8-byte all-1s VINT) means "unknown size" — common
      // for MediaRecorder's Segment. Treat as "rest of file".
      const isUnknown = sizeInfo.size === 8 && sizeInfo.value === 0x00FFFFFFFFFFFFFF;
      const dataEnd = isUnknown ? u8.length : Math.min(u8.length, dataStart + sizeInfo.value);
      if (idInfo.id === 0x18538067) {
        segmentDataStart = dataStart;
        segmentDataEnd = dataEnd;
        break;
      }
      offset = dataEnd;
    }
    if (segmentDataStart < 0) return blob;

    // Inside the Segment, find the SegmentInfo (id 0x1549A966). Capture the
    // size-VINT location/byte-count too so we can grow it when we inject a
    // Duration element (otherwise the parent's declared size stays stale and
    // strict players reject the file as malformed).
    let infoDataStart = -1, infoDataEnd = -1, infoSizeOffset = -1, infoSizeBytes = 0, infoIsUnknown = false;
    let cursor = segmentDataStart;
    while (cursor < segmentDataEnd) {
      const idInfo = readId(cursor);
      if (!idInfo) break;
      const sizeOffset = cursor + idInfo.size;
      const sizeInfo = readVint(sizeOffset);
      if (!sizeInfo) break;
      const dataStart = sizeOffset + sizeInfo.size;
      const isUnknown = sizeInfo.size === 8 && sizeInfo.value === 0x00FFFFFFFFFFFFFF;
      const dataEnd = isUnknown ? segmentDataEnd : Math.min(segmentDataEnd, dataStart + sizeInfo.value);
      if (idInfo.id === 0x1549A966) {
        infoDataStart = dataStart;
        infoDataEnd = dataEnd;
        infoSizeOffset = sizeOffset;
        infoSizeBytes = sizeInfo.size;
        infoIsUnknown = isUnknown;
        break;
      }
      cursor = dataEnd;
    }
    if (infoDataStart < 0) return blob;

    // Inside SegmentInfo, find Duration (id 0x4489) — a Float (4 or 8 bytes) —
    // AND TimecodeScale (id 0x2AD7B1) so we don't blindly assume the default
    // 1,000,000 ns/tick. Duration's units are TimecodeScale-relative, so if
    // someone (or a future Chrome change) writes a non-default scale, we'd
    // otherwise compute a wildly wrong duration.
    let durIdOffset = -1, durSizeBytes = 0, durDataOffset = -1, durValueBytes = 0;
    let timecodeScale = 1000000; // default per Matroska spec
    cursor = infoDataStart;
    while (cursor < infoDataEnd) {
      const idInfo = readId(cursor);
      if (!idInfo) break;
      const sizeInfo = readVint(cursor + idInfo.size);
      if (!sizeInfo) break;
      const dataStart = cursor + idInfo.size + sizeInfo.size;
      const dataEnd = Math.min(infoDataEnd, dataStart + sizeInfo.value);
      if (idInfo.id === 0x4489) {
        durIdOffset = cursor;
        durSizeBytes = sizeInfo.size;
        durDataOffset = dataStart;
        durValueBytes = sizeInfo.value;
      } else if (idInfo.id === 0x2AD7B1 && sizeInfo.value >= 1 && sizeInfo.value <= 8) {
        // Parse TimecodeScale (unsigned int, big-endian, 1..8 bytes).
        let scale = 0;
        for (let k = 0; k < sizeInfo.value; k++) scale = scale * 256 + view.getUint8(dataStart + k);
        if (scale > 0) timecodeScale = scale;
      }
      cursor = dataEnd;
    }

    // Duration is in TimecodeScale units. Default scale = 1,000,000 ns
    // (i.e. 1 unit = 1 ms), so for the Chrome MediaRecorder common case
    // newDuration === durationMs. For any other scale: value = ms * 1e6 / scale.
    const newDuration = Math.max(1, Math.round(durationMs * 1000000 / timecodeScale));
    if (durDataOffset >= 0 && durValueBytes >= 4) {
      // Overwrite existing Duration float in place — preserves all offsets.
      const out = new Uint8Array(buf.slice(0));
      const dv = new DataView(out.buffer);
      if (durValueBytes === 8) {
        dv.setFloat64(durDataOffset, newDuration, false);
      } else {
        dv.setFloat32(durDataOffset, newDuration, false);
      }
      return new Blob([out], { type: blob.type || 'video/webm' });
    }

    // No Duration element exists — inject one at the start of SegmentInfo.
    // Element layout: [0x44 0x89][size VINT (0x88 = 8-byte payload)][float64]
    // = 11 bytes total. We must ALSO grow the parent SegmentInfo's size VINT
    // by +11, otherwise strict parsers reject the file ("element exceeds
    // containing master element"). When the existing payload is small enough
    // the new size still fits in the same VINT byte count → rewrite in place.
    // If it doesn't fit, expand the size VINT (shifts everything after by 1).
    const insertion = new Uint8Array(2 + 1 + 8);
    insertion[0] = 0x44; insertion[1] = 0x89; insertion[2] = 0x88;
    new DataView(insertion.buffer).setFloat64(3, newDuration, false);

    // Re-encode SegmentInfo's size VINT to (oldPayloadSize + 11).
    // NOTE on math: must use `2 ** (7*bytes)` not `1 << (7*bytes)` because
    // bitwise shift is 32-bit only — for bytes>=5 the shift overflows and
    // the loop would terminate too early or wrap to a negative number.
    function encodeVint(value, minBytes) {
      let bytes = Math.max(minBytes || 1, 1);
      while (bytes <= 8 && value >= (2 ** (7 * bytes)) - 1) bytes++;
      if (bytes > 8) return null;
      const out = new Uint8Array(bytes);
      out[0] = (1 << (8 - bytes));
      let v = value;
      for (let i = bytes - 1; i >= 0; i--) {
        out[i] |= v & 0xFF;
        v = Math.floor(v / 256);
      }
      return out;
    }

    if (infoIsUnknown || infoSizeOffset < 0) {
      // Unknown-size SegmentInfo (rare) — inject without resizing the parent.
      const before = u8.subarray(0, infoDataStart);
      const after = u8.subarray(infoDataStart);
      return new Blob([before, insertion, after], { type: blob.type || 'video/webm' });
    }

    const oldPayload = infoDataEnd - infoDataStart;
    const newSizeVint = encodeVint(oldPayload + insertion.length, infoSizeBytes);
    if (!newSizeVint) {
      // Couldn't re-encode — fall back to in-place float overwrite path is
      // gone (no Duration existed). Best effort: return original.
      return blob;
    }

    if (newSizeVint.length === infoSizeBytes) {
      // Same byte-count — patch the parent's size VINT in place, then splice
      // the new Duration element in at the start of SegmentInfo's payload.
      // `head` MUST extend through `infoDataStart` so that `infoSizeOffset`
      // is a valid write index (head.length === infoDataStart, valid indices
      // 0..infoDataStart-1, and infoSizeOffset + infoSizeBytes <= infoDataStart
      // by construction).
      const head = new Uint8Array(u8.subarray(0, infoDataStart));
      head.set(newSizeVint, infoSizeOffset);
      const tail = u8.subarray(infoDataStart);
      return new Blob([head, insertion, tail], { type: blob.type || 'video/webm' });
    }
    // Size VINT grew — splice in the new VINT (shift everything after).
    const beforeSize = u8.subarray(0, infoSizeOffset);
    const afterSize = u8.subarray(infoSizeOffset + infoSizeBytes, infoDataStart);
    const tail = u8.subarray(infoDataStart);
    return new Blob([beforeSize, newSizeVint, afterSize, insertion, tail], { type: blob.type || 'video/webm' });
  } catch (e) {
    console.log('[SnapToAI Video] fixWebmDuration failed (returning original):', e.message);
    return blob;
  }
}

async function stitchVideos(videoUrls, stitchCtx) {
  console.log(`[SnapToAI Video] Stitching ${videoUrls.length} clips (hard-cut mode)...`);

  // ---- Hard timeout: if anything hangs, give up cleanly so the caller can
  // fall back to showing individual clip download links instead of a frozen
  // "Combining..." progress bar forever. Sized to ~2.5× realtime so a typical
  // 3×8s render has up to ~65s before fallback. Floors at 30s, caps at 120s.
  const _realtimeMs = videoUrls.length * (typeof selectedVideoDuration === 'number' ? selectedVideoDuration : 8) * 1000;
  const STITCH_TIMEOUT_MS = Math.max(30000, Math.min(120000, _realtimeMs * 2.5 + 8000));
  let timeoutHandle = null;
  // Shared cancel flag the inner pipeline polls so that on timeout the
  // recorder/audio/<video> elements actually shut down — the previous
  // Promise.race left the inner promise running, holding 4–8 MB blobs +
  // an active MediaRecorder + AudioContext alive in the background.
  if (!stitchCtx) stitchCtx = {};
  // Critical: reset cancel flags from any PREVIOUS stitch run on the same
  // ctx (e.g., user retried after a timeout). Without this the next stitch
  // throws "User stopped" instantly because aborted is still true from before.
  stitchCtx.aborted = false;
  stitchCtx.userStopped = false;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      stitchCtx.aborted = true;
      if (stitchCtx._fetchAbort) stitchCtx._fetchAbort.abort();
      reject(new Error(`Stitch timeout (${Math.round(STITCH_TIMEOUT_MS/1000)}s) — falling back to clips`));
    }, STITCH_TIMEOUT_MS);
  });

  const stitchPromise = (async () => {
    // ---- 1. Fetch every clip into a Blob up front. Doing this BEFORE any
    // recording starts means a slow CDN won't stretch the recorded timeline
    // (the recorder is wall-clock; if we stalled on fetch mid-recording, the
    // stitched video would have a frozen patch).
    // Delegated to fetchClipsWithAbort (video-pipeline-core.js) which handles
    // the stop-flag checks between fetches and is independently unit-tested.
    const blobs = await fetchClipsWithAbort(videoUrls, stitchCtx);

    // ---- 2. Probe the first clip for native dimensions so the output canvas
    // matches the real aspect ratio (hard-coding 1280×720 used to squash
    // 9:16 portrait Veo outputs into a landscape frame — visceral fail).
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

    // ---- 3. Pre-create AND pre-load EVERY clip's <video> + metadata up
    // front. Doing this before recording starts means the per-clip
    // transition has zero "await loadedmetadata" latency — the gap between
    // clip N ending and clip N+1 starting collapses to ~one frame, so the
    // recorded output has no micro-freezes between clips.
    const blobUrls = blobs.map(b => URL.createObjectURL(b));
    const videos = [];
    const sources = [];
    const gains = [];
    for (let i = 0; i < blobs.length; i++) {
      if (stitchCtx && (stitchCtx.userStopped || stitchCtx.aborted)) throw new Error('User stopped');
      const v = document.createElement('video');
      v.src = blobUrls[i];
      v.muted = false;
      v.crossOrigin = 'anonymous';
      v.playsInline = true;
      v.preload = 'auto';
      v.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:64px;height:64px;opacity:0;pointer-events:none;z-index:-1;';
      document.body.appendChild(v);
      videos.push(v);
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`Clip ${i+1} load timeout`)), 15000);
        // loadeddata (readyState >= HAVE_CURRENT_DATA = 2) instead of
        // loadedmetadata (readyState 1) so drawImage() can actually paint the
        // first decoded frame — otherwise the pre-recorder draw at line ~4135
        // would write a black/transparent frame and FIX 3 wouldn't work.
        v.onloadeddata = () => { clearTimeout(t); resolve(); };
        v.onerror = () => { clearTimeout(t); reject(new Error(`Clip ${i+1} load error`)); };
      });
    }

    // ---- 4. Build the output pipeline. Order matters here:
    //   a) create canvas + AudioContext + MediaStreamDestination
    //   b) connect clip 0's MediaElementSource to the destination FIRST so
    //      audioDest.stream actually has an audio track (architect flagged
    //      that an empty MediaStreamDestination has no tracks at construction
    //      in some Chrome builds — connecting a source guarantees the track
    //      exists before MediaRecorder reads the stream layout)
    //   c) build the combined MediaStream (canvas video track + audioDest
    //      audio track) — track count is now stable
    //   d) draw clip 0's first frame BEFORE recorder.start() so the output
    //      doesn't begin with ~100ms of black
    //   e) start the recorder and the playback loop
    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx2d = canvas.getContext('2d', { alpha: false, desynchronized: true });

    const audioCtx = new AudioContext();
    try { await audioCtx.resume(); } catch (_) {}
    const audioDest = audioCtx.createMediaStreamDestination();

    // Connect clip 0's audio NOW so audioDest has a live track when the
    // recorder is constructed.
    {
      try {
        const src = audioCtx.createMediaElementSource(videos[0]);
        const g = audioCtx.createGain();
        g.gain.value = 1;
        src.connect(g);
        g.connect(audioDest);
        sources.push(src);
        gains.push(g);
      } catch (e) {
        console.log('[SnapToAI Video] Audio connect failed on clip 1:', e.message);
        sources.push(null);
        gains.push(null);
      }
    }

    const FPS = 30;
    const videoStream = canvas.captureStream(FPS);
    const combined = new MediaStream();
    videoStream.getVideoTracks().forEach(t => combined.addTrack(t));
    audioDest.stream.getAudioTracks().forEach(t => combined.addTrack(t));
    console.log(`[SnapToAI Video] combined stream: ${combined.getVideoTracks().length}v + ${combined.getAudioTracks().length}a tracks`);

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
    // 8 Mbps video + 192 kbps audio. Previous default (~2.5 Mbps) is what
    // made recorded output look soft compared to the 1080p MP4 source clips.
    const recorderOpts = { videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 };
    if (chosenMime) recorderOpts.mimeType = chosenMime;
    const recorder = new MediaRecorder(combined, recorderOpts);
    console.log(`[SnapToAI Video] MediaRecorder mime=${chosenMime || '(default)'} @ 8Mbps`);
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    // Hard 5s deadline on onstop firing. Chrome's MediaRecorder occasionally
    // never emits 'stop' under load (GPU pressure, tab backgrounded mid-stop,
    // codec edge cases) — without this fallback the whole stitch would hang
    // until the outer 30-120s STITCH_TIMEOUT_MS, which feels like a freeze
    // to the user. With the fallback we just use whatever chunks we have.
    const recordingDone = new Promise(resolve => {
      let settled = false;
      const settle = () => { if (!settled) { settled = true; resolve(); } };
      recorder.onstop = settle;
      setTimeout(() => {
        if (!settled) console.log('[SnapToAI Video] recorder.onstop timeout — force-finalizing with current chunks');
        settle();
      }, 5000);
    });

    // Paint clip 0's first frame BEFORE the recorder starts, so the output
    // doesn't begin with a black gap.
    try { ctx2d.drawImage(videos[0], 0, 0, canvasW, canvasH); } catch (_) {}

    // timeslice=250ms so chunks flush regularly. A single giant final chunk
    // sometimes shows up as a corrupt/0-byte file in Chrome.
    recorder.start(250);

    // ---- 5. Sequential playback. All metadata is preloaded so the only
    // per-clip awaits are v.play() (resolves in <50ms) and the draw promise.
    // Audio is connected just-in-time per clip and disconnected before the
    // next clip's source attaches, so audioDest only ever has ONE active
    // source feeding it — no glitching, no ducking, no overlap.
    // Track wall-clock recording duration so we can repair the WebM EBML
    // Duration field after recorder.stop() — Chrome's MediaRecorder never
    // writes it, which is what makes the downloaded file hang on playback.
    const recordStartMs = performance.now();
    try {
      for (let i = 0; i < videos.length; i++) {
        if (stitchCtx && (stitchCtx.userStopped || stitchCtx.aborted)) throw new Error('User stopped');
        const v = videos[i];

        // Connect this clip's audio (clip 0 was already connected above).
        if (i > 0) {
          try {
            const src = audioCtx.createMediaElementSource(v);
            const g = audioCtx.createGain();
            g.gain.value = 1;
            src.connect(g);
            g.connect(audioDest);
            sources.push(src);
            gains.push(g);
          } catch (e) {
            console.log(`[SnapToAI Video] Audio connect skipped on clip ${i+1}:`, e.message);
            sources.push(null);
            gains.push(null);
          }
        }

        // Hard 3s deadline on v.play() — normally resolves in <50ms, but
        // some Chrome builds leave the promise pending forever after a tab
        // throttle / GPU hiccup. The watchdog inside the draw loop will
        // still bail the clip if it can't actually play, so all we lose by
        // continuing here is a few ms.
        try {
          await Promise.race([
            v.play(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('play() timeout 3s')), 3000))
          ]);
        } catch (e) {
          console.log(`[SnapToAI Video] play() rejected on clip ${i+1}:`, e.message);
        }

        const dur = (v.duration && isFinite(v.duration) && v.duration > 0) ? v.duration : 8;

        // Draw loop: ONE rAF chain (foreground) + a 200ms setInterval that
        // ONLY runs when rAF has stalled (tab hidden, throttled, etc).
        // Architect flagged that the previous version had setInterval calling
        // tick() AND tick() scheduling rAF, so every 100ms a NEW persistent
        // rAF chain was spawned → over an 8s clip dozens of concurrent draw
        // loops piled up, blowing CPU and triggering false stalls. Here we
        // gate with `rafPending` and `lastTickTs` so exactly one loop is
        // active at a time.
        // Per-clip hard ceiling at dur*1.5+3s in case `ended` never fires
        // (some short Veo clips don't emit the event reliably) — without
        // this the whole stitch would hang until the global 120s timeout.
        await new Promise((resolveClip) => {
          let stopped = false;
          let interval = null;
          let rafPending = false;
          let lastTickTs = performance.now();
          let lastProgressTs = performance.now();
          let lastTime = -1;
          const clipDeadline = performance.now() + (dur * 1500) + 3000;
          const done = () => {
            if (stopped) return;
            stopped = true;
            if (interval) { clearInterval(interval); interval = null; }
            resolveClip();
          };
          v.onended = done;
          const drawAndCheck = () => {
            if (stopped) return false;
            if ((stitchCtx && stitchCtx.userStopped) || (stitchCtx && stitchCtx.aborted)) { done(); return false; }
            try { ctx2d.drawImage(v, 0, 0, canvasW, canvasH); } catch (_) {}
            const now = performance.now();
            lastTickTs = now;
            if (v.currentTime !== lastTime) { lastTime = v.currentTime; lastProgressTs = now; }
            // currentTime hasn't advanced for 2.5s AND we've been playing for
            // over 1s → element is stuck. Bail out of this clip.
            const stalled = (now - lastProgressTs > 2500) && (now - recordStartMs > 1000);
            if (v.ended || (v.currentTime >= dur - 0.02) || stalled || now > clipDeadline) {
              if (stalled) console.log(`[SnapToAI Video] Clip ${i+1} stalled at ${v.currentTime.toFixed(2)}s — advancing`);
              done(); return false;
            }
            return true;
          };
          const rafTick = () => {
            rafPending = false;
            if (!drawAndCheck()) return;
            if (typeof requestAnimationFrame === 'function') {
              rafPending = true;
              requestAnimationFrame(rafTick);
            }
          };
          // Backstop: only nudges drawAndCheck if rAF has gone silent for
          // 200ms+ (tab hidden, browser throttling). Does NOT spawn a new
          // rAF chain — that's what caused the fan-out bug.
          interval = setInterval(() => {
            if (stopped) return;
            if (performance.now() - lastTickTs < 200) return;
            drawAndCheck();
          }, 200);
          if (typeof requestAnimationFrame === 'function') {
            rafPending = true;
            requestAnimationFrame(rafTick);
          } else {
            // No rAF (very rare) — fall back to interval-only at higher rate.
            clearInterval(interval);
            interval = setInterval(() => { if (!drawAndCheck()) return; }, 33);
          }
        });

        // Disconnect THIS clip's audio so the destination is silent for the
        // microsecond gap before the next clip's audio attaches.
        try { gains[i] && gains[i].disconnect(); } catch (_) {}
        try { sources[i] && sources[i].disconnect(); } catch (_) {}
        try { v.pause(); } catch (_) {}
      }

      // Hold the last frame for ~150ms so the recorder's tail chunks have
      // content to flush (avoids ending on a black gap).
      await new Promise(r => setTimeout(r, 150));
    } finally {
      for (const v of videos) {
        try { v.pause(); } catch (_) {}
        try { v.removeAttribute('src'); v.load(); } catch (_) {}
        if (v && v.parentNode) {
          try { v.parentNode.removeChild(v); } catch (_) {}
        }
      }
      for (const u of blobUrls) {
        try { URL.revokeObjectURL(u); } catch (_) {}
      }
      try { recorder.stop(); } catch (_) {}
      await recordingDone;
      // Don't let audioCtx.close() hang the user (rare Chrome bug under load).
      try {
        await Promise.race([
          audioCtx.close(),
          new Promise(r => setTimeout(r, 2000))
        ]);
      } catch (_) {}
      // Drop references to the raw clip blobs so GC can reclaim them —
      // architect flagged this as a memory leak across retry sessions.
      blobs.length = 0;
    }

    // Wall-clock duration of the recorded segment — used to back-fill the
    // missing Duration in the WebM EBML header so the downloaded file is
    // seekable (without this, players hang on playback / show duration N/A).
    const recordedMs = Math.max(1, performance.now() - recordStartMs);
    // Guard: if stitch was aborted/stopped while recording was finishing,
    // don't create a URL that will never be surfaced — avoids a permanent leak.
    if (stitchCtx && (stitchCtx.aborted || stitchCtx.userStopped)) throw new Error('User stopped');
    const rawBlob = new Blob(chunks, { type: chosenMime || 'video/webm' });
    const fixedBlob = await fixWebmDuration(rawBlob, recordedMs);
    console.log(`[SnapToAI Video] WebM duration repair: ${recordedMs.toFixed(0)}ms · raw=${rawBlob.size}B · fixed=${fixedBlob.size}B`);
    return URL.createObjectURL(fixedBlob);
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
    <div style="margin-bottom:14px;">
      <div style="font-size:12px;font-weight:600;color:#cdd6e0;margin-bottom:6px;">🎬 Clip ${i + 1} of ${clipUrls.length}</div>
      <video controls muted playsinline style="width:100%;max-width:480px;border-radius:10px;display:block;" src="${url}"></video>
    </div>
  `).join('');

  // Task #36: Make the fallback unmistakably clear when stitching couldn't
  // join the clips. The previous tiny gray "Auto-stitch wasn't possible"
  // text made users (correctly) think the whole feature broke. The new
  // banner reassures them that every clip rendered successfully and
  // gives them a single obvious download button.
  bubble.innerHTML = `
    <div style="margin:8px 0;">
      <div style="background:linear-gradient(135deg,rgba(0,200,136,0.15),rgba(0,200,136,0.05));border:1px solid rgba(0,200,136,0.4);border-radius:12px;padding:14px 16px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <span style="font-size:22px;">✅</span>
          <span style="font-size:15px;font-weight:700;color:#00cc88;">Your ${clipUrls.length} clips are ready — play or download below</span>
        </div>
        <div style="font-size:13px;color:#cdd6e0;line-height:1.55;">
          Each clip is a separate file at full quality. You can play them right here, download them all with one click, or join them in any video editor (iMovie, CapCut, Premiere, etc.) to make one combined movie.
        </div>
        <div style="margin-top:12px;">
          <button class="video-save-clips-btn" style="background:#00cc88;border:none;color:#0b1118;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">📥 Download all clips</button>
        </div>
      </div>
      ${clipsHtml}
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

async function pollVideoStatus(operationId, apiKey, progressBubble, thread, onSuccess) {
  // Cancel any prior single-clip poll (timer + in-flight fetch) before starting.
  if (activeVideoPollTimer) { clearTimeout(activeVideoPollTimer); activeVideoPollTimer = null; }
  if (pollVideoStatus._abort) { pollVideoStatus._abort.abort(); }
  // Per-invocation AbortController so a stale in-flight fetch from a prior call
  // can be cancelled even if it slipped past the clearTimeout above.
  const abortCtrl = new AbortController();
  pollVideoStatus._abort = abortCtrl;

  let stopped = false;
  let localTimer = null;

  let pollCount = 0;
  const maxPolls = 40;
  const FAST_POLL_MS = 5000;
  const SLOW_POLL_MS = 15000;
  const FAST_POLL_COUNT = 6;
  const nextDelay = () => (pollCount < FAST_POLL_COUNT ? FAST_POLL_MS : SLOW_POLL_MS);

  const tick = async () => {
    if (stopped || abortCtrl.signal.aborted) return;
    pollCount++;

    if (pollCount > maxPolls) {
      stopped = true;
      localTimer = null;
      progressBubble.innerHTML = `<div style="color:#ff6b6b;font-size:13px;"><span style="font-size:16px;">⏰</span> Video generation timed out. Please try again.</div>`;
      return;
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/${operationId}?key=${apiKey}`;
      const resp = await fetchWithTimeout(url, { signal: abortCtrl.signal, timeoutMs: 20000 });
      const data = await resp.json();

      if (!resp.ok) {
        const errMsg = data.error?.message || `Status check failed (${resp.status})`;
        if (resp.status === 429) {
          const text = progressBubble.querySelector('.video-progress-text');
          if (text) text.textContent = 'Rate limit — retrying shortly...';
          localTimer = setTimeout(tick, nextDelay());
          return;
        }
        stopped = true;
        localTimer = null;
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
        localTimer = setTimeout(tick, nextDelay());
      } else {
        stopped = true;
        localTimer = null;

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

        const _extractUri = (d) => {
          const gvr2 = d.response?.generateVideoResponse;
          if (gvr2?.generatedSamples?.[0]?.video?.uri) return gvr2.generatedSamples[0].video.uri;
          if (gvr2?.generatedSamples?.[0]?.uri)        return gvr2.generatedSamples[0].uri;
          if (d.response?.videos?.[0]?.uri)            return d.response.videos[0].uri;
          if (d.response?.videos?.[0]?.video?.uri)     return d.response.videos[0].video.uri;
          if (d.response?.generatedSamples?.[0]?.video?.uri) return d.response.generatedSamples[0].video.uri;
          if (d.response?.generatedSamples?.[0]?.uri)  return d.response.generatedSamples[0].uri;
          if (d.predictions?.[0]?.video?.uri)          return d.predictions[0].video.uri;
          if (d.predictions?.[0]?.uri)                 return d.predictions[0].uri;
          if (d.response?.predictions?.[0]?.video?.uri) return d.response.predictions[0].video.uri;
          if (d.response?.predictions?.[0]?.uri)       return d.response.predictions[0].uri;
          const s = JSON.stringify(d);
          const m = s.match(/"uri"\s*:\s*"(https?:\/\/[^"]+\.mp4[^"]*)"/);
          if (m) return m[1];
          return '';
        };

        let videoUri = _extractUri(data);

        if (!videoUri) {
          const pollUrl2 = `https://generativelanguage.googleapis.com/v1beta/${operationId}?key=${apiKey}`;
          for (let _a = 1; _a <= 5 && !videoUri; _a++) {
            if (abortCtrl.signal.aborted) break; // newer generation started — stop immediately
            await new Promise(r => setTimeout(r, _a <= 2 ? 3000 : 5000));
            if (abortCtrl.signal.aborted) break;
            try {
              const r2 = await fetchWithTimeout(pollUrl2, { signal: abortCtrl.signal, timeoutMs: 20000 });
              if (!r2.ok) continue;
              const d2 = await r2.json().catch(() => ({}));
              if (!d2.done) continue;
              if (d2.error) break;
              console.log(`[SnapToAI Video] single no_uri re-poll ${_a}:`, JSON.stringify(d2).substring(0, 400));
              videoUri = _extractUri(d2);
            } catch (_) { if (_.name === 'AbortError') break; }
          }
        }

        if (!videoUri) {
          console.log('[SnapToAI Video] no URI after re-polls:', JSON.stringify(data.response || data).substring(0, 300));
          const filtered = data.response?.generateVideoResponse?.raiMediaFilteredReasons;
          if (filtered && filtered.length > 0) {
            progressBubble.innerHTML = `<div style="color:#ff6b6b;font-size:13px;"><span style="font-size:16px;">🛡️</span> Video was blocked by safety filters. Try a different prompt.</div>`;
          } else {
            progressBubble.innerHTML = `<div style="color:#ff6b6b;font-size:13px;"><span style="font-size:16px;">❌</span> Video generation completed but no video was returned. Try rephrasing your description.</div>`;
          }
          return;
        }

        const authedUrl = `${videoUri}${videoUri.includes('?') ? '&' : '?'}key=${apiKey}`;
        // Capture the RAW file reference (not the download URL) so real Veo
        // "extend" can send it back to Google as `instances[0].video` later.
        if (typeof onSuccess === 'function') {
          try { onSuccess(videoUri, 'video/mp4'); } catch (_) {}
        }
        showVideoResult(progressBubble, authedUrl, thread);
      }
    } catch (err) {
      if (err.name === 'AbortError') return; // cancelled by a newer poll — stop silently
      console.log(`[SnapToAI Video] Poll error:`, err.message);
      localTimer = setTimeout(tick, nextDelay());
    }
  };
  localTimer = setTimeout(tick, FAST_POLL_MS);
}

// ── Video continuation context ─────────────────────────────────────────────
let _lastVideoContext = null; // { prompt, style, videoUrl, lastFrameDataUrl, videoRef, modelUsed, aspectRatioUsed, totalDurationSec, extendCount }

// Real Veo "extend" (server-side continuation, single combined output, real
// audio/motion continuity) only works when ALL of these hold:
//  - We have the actual Google file reference for the last clip (videoRef)
//  - The clip was made with Veo 3.1 or Veo 3.1 Fast (Lite/3.0/2.0 don't support extend)
//  - Under Google's 20-extensions-per-video cap
//  - Under Google's 141s input-length cap for the video being extended
function canRealExtend(ctx) {
  if (!ctx || !ctx.videoRef || !ctx.videoRef.uri) return false;
  if (ctx.modelUsed !== MODELS.veo31 && ctx.modelUsed !== MODELS.veo31Fast) return false;
  if ((ctx.extendCount || 0) >= 20) return false;
  if ((ctx.totalDurationSec || 0) > 141) return false;
  return true;
}

// Performs a REAL Veo video extension: sends Google the actual previously-
// generated video (not a captured frame) so it continues the same continuous
// audio/motion and returns ONE combined video — no client-side stitching.
// Returns true if it handled the request (success OR a shown error), false
// if the caller should fall back to the old frame-capture continuation.
// `sourceCtx` lets a caller extend from a SPECIFIC past scene (branching)
// instead of always the global "latest" video. Defaults to _lastVideoContext
// so existing linear auto-chain callers keep working unchanged. The source
// snapshot itself is never mutated in place (aside from lightweight bookkeeping
// like the cooldown timer and the memoized working shape, which are safe to
// update on the source so retrying that exact scene benefits) — the actual
// new scene produced by this extend becomes its own object and the new
// global "head" (_lastVideoContext), so the source bubble stays branchable.
async function extendVeoVideoReal(prompt, thread, sourceCtx) {
  const ctx = sourceCtx || _lastVideoContext;
  if (!canRealExtend(ctx)) return false;

  // Hard cooldown after any rate-limit hit. Veo's preview extend endpoint has
  // a very tight per-minute quota — trying several JSON shapes back-to-back
  // in one call can burn the whole minute's allowance on guesses alone, then
  // even the CORRECT shape gets rejected as 429 right behind it. Refuse to
  // fire at all while cooling down instead of wasting another attempt.
  if (ctx._extendCooldownUntil && Date.now() < ctx._extendCooldownUntil) {
    const waitSec = Math.ceil((ctx._extendCooldownUntil - Date.now()) / 1000);
    const cooldownBubble = document.createElement('div');
    cooldownBubble.className = 'chat-bubble ai';
    cooldownBubble.innerHTML = `<div style="color:#ffa500;font-size:13px;"><span style="font-size:16px;">⏱️</span> Still cooling down from the last rate limit — wait ~${waitSec}s before extending again.</div>`;
    thread.appendChild(cooldownBubble);
    thread.scrollTop = thread.scrollHeight;
    return true;
  }

  const keyData = await chrome.storage.sync.get(['geminiApiKey']);
  const apiKey = keyData.geminiApiKey;
  if (!apiKey) return false;

  const modelName = ctx.modelUsed;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predictLongRunning?key=${apiKey}`;

  // Google's official Gemini API docs for "Extending Veo videos" show the
  // real shape (Python SDK, which maps 1:1 onto the REST JSON body):
  //   operation = client.models.generate_videos(
  //     model="veo-3.1-generate-preview",
  //     video=operation.response.generated_videos[0].video,  # <-- pass the
  //                                                           #     Video object AS-IS
  //     prompt=prompt, ...
  //   )
  // `operation.response.generated_videos[0].video` is exactly the object we
  // already capture into ctx.videoRef ({ uri, mimeType }) when polling the
  // ORIGINAL generation completes (see pollVideoStatus's onSuccess callback,
  // sourced from REST's response.generateVideoResponse.generatedSamples[0].video).
  // So the correct request body is simply `video: ctx.videoRef` — no
  // resource-path construction, no snake_case guessing needed. Earlier
  // builds prioritized speculative "resource path" guesses (unverified
  // secondhand analysis) ahead of this confirmed shape, which both burned
  // quota on wrong guesses AND meant the real shape was rarely even reached
  // within the per-call attempt cap. Fixed here: try the documented shape
  // first, with only one lightweight fallback (uri without mimeType, in
  // case the API is strict about extra fields on the Video object).
  const uri = ctx.videoRef.uri;
  const mimeType = ctx.videoRef.mimeType || 'video/mp4';

  const shapeCandidates = [
    { label: 'video.uri+mimeType (docs: video object as-is)', video: { uri, mimeType } },
    { label: 'video.uri (no mimeType)',                        video: { uri } }
  ];
  // If a previous extend on this context already found a working shape, try
  // it first so we don't re-pay the trial-and-error cost every time.
  if (ctx._workingShapeLabel) {
    const foundIdx = shapeCandidates.findIndex(c => c.label === ctx._workingShapeLabel);
    if (foundIdx > 0) {
      const found = shapeCandidates.splice(foundIdx, 1)[0];
      shapeCandidates.unshift(found);
    }
  }

  // Veo's preview extend endpoint has a very tight per-minute quota (as few
  // as ~2-3 requests/min). Even with just 2 candidates, space them out so a
  // single call can't burst two requests into the same rate-limit window.
  // Once ctx._workingShapeLabel is known, only that single shape is tried.
  const candidatesToTry = ctx._workingShapeLabel ? shapeCandidates.slice(0, 1) : shapeCandidates;
  const SHAPE_RETRY_DELAY_MS = 4000;

  const progressBubble = document.createElement('div');
  progressBubble.className = 'chat-bubble ai';
  progressBubble.innerHTML = `
    <div style="font-size:12px;color:#8899aa;margin-bottom:10px;">🔗 Extending your video (+7s, same continuous audio &amp; motion)...</div>
    <div class="video-progress-bar" style="width:100%;height:4px;background:rgba(255,165,0,0.1);border-radius:2px;overflow:hidden;">
      <div class="video-progress-fill" style="width:2%;height:100%;background:linear-gradient(90deg,#63cab7,#8fe3d3);border-radius:2px;transition:width 0.5s ease;"></div>
    </div>
    <div class="video-progress-text" style="font-size:10px;color:#667788;margin-top:6px;">Starting extension...</div>
  `;
  thread.appendChild(progressBubble);
  thread.scrollTop = thread.scrollHeight;

  console.log(`[SnapToAI Video] Extend request with ${modelName}, prev totalDur=${ctx.totalDurationSec}s, extendCount=${ctx.extendCount}`);

  const isSchemaError = (status, msg) => {
    if (status !== 400) return false;
    const m = (msg || '').toLowerCase();
    return m.includes('video') || m.includes('unknown') || m.includes('unrecognized') ||
           m.includes('invalid_argument') || m.includes('invalid argument') ||
           m.includes('schema') || m.includes('field');
  };

  try {
    let data = null, resp = null, workingIndex = -1;

    for (let i = 0; i < candidatesToTry.length; i++) {
      const candidate = candidatesToTry[i];

      // Space out repeated attempts within a single call so we don't burst
      // multiple requests into the same rate-limit window.
      if (i > 0) await new Promise(r => setTimeout(r, SHAPE_RETRY_DELAY_MS));

      // Prepend a hard audio-continuity anchor so Veo never restarts the
      // song or singing from scratch. The anchor is short (~15 words) so it
      // stays well within the prompt budget and applies even when the user
      // or the AI writes a prompt that doesn't mention audio at all.
      const audioAnchor = 'Audio continues mid-phrase — same song, same singer, same refrain, no restart. ';
      const requestBody = {
        instances: [{ prompt: audioAnchor + prompt, video: candidate.video }],
        parameters: {
          aspectRatio: ctx.aspectRatioUsed || '16:9',
          sampleCount: 1,
          resolution: '720p'
        }
      };

      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      data = await resp.json();

      if (resp.ok) { workingIndex = i; break; }

      const errorMsg = data.error?.message || `API error ${resp.status}`;
      console.log(`[SnapToAI Video] Extend shape "${candidate.label}" failed: ${errorMsg}`);

      const isRateLimited = resp.status === 429 || /rate|quota|exceeded/i.test(errorMsg);
      if (isRateLimited) {
        // A 429 means the quota is gone for this window, full stop — trying
        // more shapes right now would just rack up more 429s for nothing.
        ctx._extendCooldownUntil = Date.now() + 65000;
      }

      // Only keep trying other shapes on a schema-looking 400. Billing/quota/
      // safety errors are real and apply regardless of shape — stop immediately.
      if (!isSchemaError(resp.status, errorMsg) || i === candidatesToTry.length - 1) {
        if (isBillingError(resp.status, errorMsg)) {
          progressBubble.innerHTML = buildUnlockCard('video');
        } else if (isRateLimited) {
          progressBubble.innerHTML = buildVeoRateLimitCard('Veo Extend');
        } else {
          progressBubble.innerHTML = `<div style="color:#ff6b6b;font-size:13px;"><span style="font-size:16px;">❌</span> Extend failed: ${errorMsg}</div>`;
        }
        return true; // handled — don't fall back after a real attempt was made
      }
    }

    let winningLabel = null;
    if (workingIndex >= 0) {
      // Remember the winning shape's label so future extends on this video
      // try it first (see label-based lookup above). Stored on the SOURCE
      // scene since it's a lookup optimization for that lineage, not a new
      // scene's own state.
      winningLabel = shapeCandidates[workingIndex].label;
      ctx._workingShapeLabel = winningLabel;
      console.log(`[SnapToAI Video] Extend succeeded with shape "${winningLabel}"`);
    }

    const operationName = data.name;
    if (!operationName) {
      progressBubble.innerHTML = `<div style="color:#ff6b6b;font-size:13px;"><span style="font-size:16px;">❌</span> No operation ID returned for extension. Try again.</div>`;
      return true;
    }

    // Build the RESULT as its own object rather than mutating the source
    // scene in place. This is what makes branching possible: the source
    // bubble's snapshot is untouched, so the user can come back and extend
    // it again later with a different prompt to create an alternate scene.
    const resultCtx = Object.assign({}, ctx, {
      extendCount: (ctx.extendCount || 0) + 1,
      totalDurationSec: (ctx.totalDurationSec || 0) + 7,
      operationName,
      videoRef: null,
      _workingShapeLabel: winningLabel || ctx._workingShapeLabel
    });
    // This branch becomes the new "current" video for the default (no
    // explicit sourceCtx) UI paths — e.g. the auto-chain "Total length"
    // feature and any future extend click that doesn't specify a scene.
    _lastVideoContext = resultCtx;

    pollVideoStatus(operationName, apiKey, progressBubble, thread, (videoUri, mimeType2) => {
      resultCtx.videoRef = { uri: videoUri, mimeType: mimeType2 };
    });
    return true;
  } catch (err) {
    console.log('[SnapToAI Video] Extend connection error:', err.message);
    progressBubble.innerHTML = `<div style="color:#ff6b6b;font-size:13px;"><span style="font-size:16px;">❌</span> Connection failed while extending. Please try again.</div>`;
    return true;
  }
}

// Capture a frame directly from an already-decoded <video> element in the DOM.
// Much more reliable than re-fetching a Google signed URL that may have expired.
async function captureFrameFromVideoElement(videoEl) {
  if (!videoEl) return null;
  try {
    // Kick off decoding — necessary for off-screen elements
    if (videoEl.paused) videoEl.load();

    // Wait for enough data to seek. Listen to loadedmetadata OR loadeddata,
    // whichever fires first. If neither fires in time, fall through and try
    // to draw anyway — Chrome sometimes has data without firing the event.
    if (videoEl.readyState < 1) {
      await new Promise(res => {
        const t = setTimeout(res, 15000); // fall through, not reject
        const done = () => { clearTimeout(t); res(); };
        videoEl.addEventListener('loadedmetadata', done, { once: true });
        videoEl.addEventListener('loadeddata', done, { once: true });
        videoEl.addEventListener('canplay', done, { once: true });
        videoEl.onerror = done; // also fall through on error
      });
    }

    const duration = (isFinite(videoEl.duration) && videoEl.duration > 0) ? videoEl.duration : 8;
    // Try 3 frames near the end and pick the brightest (avoids fade-to-black last frame)
    const offsets = [0.6, 0.35, 0.12].map(o => Math.max(0, duration - o));
    let bestDataUrl = null, bestBrightness = -1;
    for (const seekTo of offsets) {
      await new Promise(res => {
        const guard = setTimeout(res, 4000);
        videoEl.addEventListener('seeked', () => { clearTimeout(guard); res(); }, { once: true });
        videoEl.currentTime = seekTo;
      });
      // Wait for the new frame to paint
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const w = videoEl.videoWidth || 1280, h = videoEl.videoHeight || 720;
      if (!w || !h) continue; // no frame data yet, skip
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(videoEl, 0, 0, w, h);
      // Quick brightness check on a 32×32 centre sample to reject black frames
      const sample = c.getContext('2d').getImageData(w >> 1, h >> 1, 32, 32);
      let bright = 0;
      for (let i = 0; i < sample.data.length; i += 4)
        bright += sample.data[i] + sample.data[i+1] + sample.data[i+2];
      if (bright > bestBrightness) { bestBrightness = bright; bestDataUrl = c.toDataURL('image/jpeg', 0.92); }
    }
    return bestDataUrl;
  } catch (e) {
    console.warn('[Continue] captureFrameFromVideoElement failed:', e?.message);
    return null;
  }
}

// Ask Gemini flash to write a cinematic continuation prompt that preserves
// the visual style, camera angle, subjects, music rhythm and audio mood.
async function generateSeamlessContinuationPrompt(originalPrompt, apiKey) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.chat}:generateContent?key=${apiKey}`;
    const instruction = `You are a cinematic AI director chaining 8-second Veo video clips into a seamless movie.

PREVIOUS CLIP PROMPT:
"${originalPrompt}"

Write the NEXT clip prompt (under 75 words, no explanations, no quotes) that:
• Starts mid-action so it picks up exactly where the previous clip ended — same subjects, same location, same camera framing
• Preserves the exact visual style, lighting, color grade, and mood from the previous clip
• Explicitly references audio continuity: if the previous clip had music or singing, state that "the same song continues mid-phrase, vocals carry on the same refrain without restarting, the exact same voice and melody, no new intro, no musical reset." If no music was mentioned, add gentle ambient audio continuity.
• Shows a natural next moment (slight camera move OR subject action) — do NOT reintroduce or reset the scene
• Output ONLY the video prompt text. Nothing else.`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: instruction }] }],
        generationConfig: { temperature: 0.65, maxOutputTokens: 150 }
      })
    });
    const data = await resp.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (e) {
    return null;
  }
}

// `customPrompt` lets the user dictate exactly what happens next — "keep
// the same theme song and dance" or "transition to the bear flying" —
// instead of always relying on the AI-auto-generated continuation. Leave
// blank/undefined to keep the old auto-generated behavior.
// `sourceCtx` picks which scene to extend FROM (branching). Defaults to the
// current global head so the auto-chain feature keeps working unchanged.
async function continueClip(customPrompt, sourceCtx) {
  const ctx = sourceCtx || _lastVideoContext;
  if (!ctx) return;
  const { prompt, style, lastFrameDataUrl } = ctx;

  // ── Try the REAL Veo extend first (Veo 3.1 / 3.1 Fast only) ─────────────
  // This sends Google the actual generated video, not a captured frame, so
  // the continuation keeps the same continuous audio/motion and comes back
  // as ONE combined file — no client-side stitching, no music hard-cut.
  if (canRealExtend(ctx)) {
    const ci = document.getElementById('chatInput');
    const typedPrompt = customPrompt && customPrompt.trim() ? customPrompt.trim() : null;

    let contPrompt = typedPrompt;
    if (!contPrompt) {
      if (ci) { ci.value = '⏳ Writing next scene…'; ci.disabled = true; }
      try {
        const keyData = await chrome.storage.sync.get(['geminiApiKey']);
        if (keyData.geminiApiKey && prompt) {
          contPrompt = await generateSeamlessContinuationPrompt(prompt, keyData.geminiApiKey);
        }
      } catch (_) {}
    }

    const fallbackPrompt = prompt
      ? `Continue seamlessly: ${prompt.slice(0, 90)} — same camera angle, same subjects, same song continues mid-phrase, vocals carry on the exact same refrain without restarting, same voice, no new musical intro.`
      : 'Continue from last frame — same mood, same visual style. Camera continues its motion. The same song plays mid-phrase, vocals continue the refrain, no musical reset.';
    const finalPrompt = contPrompt || fallbackPrompt;

    if (ci) { ci.disabled = false; ci.value = ''; ci.placeholder = 'Extending your video…'; }

    const thread = document.getElementById('chatThread');
    if (thread) {
      const handled = await extendVeoVideoReal(finalPrompt, thread, ctx);
      if (handled) return; // real extend attempted (success or shown error) — don't fall back
    }
  }

  // ── Fallback: old frame-capture image-to-video continuation ─────────────
  // Used when the model doesn't support native extend (Lite/3.0/2.0), or we
  // don't yet have a real video reference for some reason.

  // Load last frame as the reference image for the next clip
  if (lastFrameDataUrl) {
    currentImages = [lastFrameDataUrl];
    const previewImg = document.getElementById('previewImage');
    const screenshotSec = document.getElementById('screenshotSection');
    if (previewImg) previewImg.src = lastFrameDataUrl;
    if (screenshotSec) screenshotSec.style.display = 'block';
  }

  // Switch to Video mode if not already there
  if (currentAiMode !== 'video') {
    const videoModeBtn = document.querySelector('.mode-btn[data-mode="video"]');
    if (videoModeBtn) videoModeBtn.click();
    await new Promise(r => setTimeout(r, 300));
  }

  // Ensure Snap toggle is on
  const snapCb = document.getElementById('vsbUseSnap');
  if (snapCb && !snapCb.checked) snapCb.click();

  // Restore previous style pill so new clip looks continuous
  if (style) {
    const styleBtn = document.querySelector(`.vsb-style[data-style="${style}"]`);
    if (styleBtn) {
      document.querySelectorAll('.vsb-style').forEach(b => b.classList.remove('vsb-active'));
      styleBtn.classList.add('vsb-active');
      _vsbStylizeStyle = style;
      try { chrome.storage.local.set({ _videoStylizeStyle: style }); } catch {}
    }
  }

  // Auto-generate the seamless continuation prompt via Gemini
  const ci = document.getElementById('chatInput');
  if (ci) { ci.value = '⏳ Writing next scene…'; ci.disabled = true; }

  let contPrompt = null;
  try {
    const keyData = await chrome.storage.sync.get(['geminiApiKey']);
    if (keyData.geminiApiKey && prompt) {
      contPrompt = await generateSeamlessContinuationPrompt(prompt, keyData.geminiApiKey);
    }
  } catch (_) {}

  const fallback = prompt
    ? `Continue seamlessly: ${prompt.slice(0, 90)} — same camera angle, same subjects, music rhythm continues from previous beat without interruption.`
    : 'Continue from last frame — same mood, same beat, same visual style. Camera continues its motion.';

  if (ci) {
    ci.disabled = false;
    ci.value = contPrompt || fallback;
    ci.placeholder = 'Generating continuation…';
    ci.focus();
  }

  const thread = document.getElementById('chatThread');
  if (thread) thread.scrollTop = thread.scrollHeight;

  // Auto-submit so the continuation generates immediately.
  // User doesn't have to press Send manually.
  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn && !sendBtn.disabled) {
    setTimeout(() => sendBtn.click(), 80);
  }
}

function showVideoResult(bubble, videoUrl, thread) {
  // Decide the Continue button's mode/label up front. `_lastVideoContext.videoRef`
  // is already populated by the onSuccess callback that fires right before this
  // (see pollVideoStatus), so canRealExtend() reflects the video we're showing.
  const ctx = _lastVideoContext;
  // Freeze THIS bubble's own scene as an immutable snapshot. `_lastVideoContext`
  // keeps moving forward as new clips/branches are made, but this bubble's
  // Extend button must always operate on the scene it actually shows — that's
  // what lets the user come back to ANY earlier clip and branch off it later
  // (e.g. "transition to the bear flying") instead of only ever continuing
  // whatever is currently the newest video.
  const sceneSnapshot = ctx ? { ...ctx } : null;
  const nativeReady = canRealExtend(sceneSnapshot);
  const hardCapped = sceneSnapshot && ((sceneSnapshot.extendCount || 0) >= 20 || (sceneSnapshot.totalDurationSec || 0) > 141);
  let continueLabel = '▶ Continue Clip';
  let continueTitle = 'Last frame locked — click to continue from here';
  let continueDisabled = '';
  if (hardCapped) {
    continueLabel = '⛔ Max length reached';
    continueTitle = 'This video already hit Google\'s continuous-extension limit (141s / 20 extensions). Start a new video to keep going.';
    continueDisabled = 'disabled style="opacity:0.5;cursor:not-allowed;"';
  } else if (nativeReady) {
    continueLabel = '🔗 Extend (Native)';
    continueTitle = 'Native Veo extend — continuous audio & motion, no stitching. Extend within 48 hours or this video reference expires on Google\'s side. Branch from THIS clip, even if you\'ve made newer ones since.';
  }

  bubble.innerHTML = `
    <div style="margin:8px 0;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="font-size:18px;">🎬</span>
        <span style="font-size:13px;font-weight:600;color:#ffa500;">Video ready!</span>
      </div>
      <video controls autoplay muted playsinline style="width:100%;max-width:480px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);" src="${videoUrl}"></video>
      ${nativeReady && !hardCapped ? `
      <input type="text" class="video-custom-prompt-input" placeholder="Leave blank to continue automatically, or type e.g. &quot;transition to the bear flying&quot;" style="width:100%;box-sizing:border-box;margin-top:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:#eee;padding:7px 10px;border-radius:8px;font-size:12px;outline:none;" />` : ''}
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="video-save-btn" style="background:rgba(255,165,0,0.15);border:1px solid rgba(255,165,0,0.3);color:#ffa500;padding:6px 16px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;transition:all 0.2s;">💾 Save Video</button>
        <button class="video-continue-btn" title="${continueTitle}" ${continueDisabled} style="background:rgba(99,202,183,0.15);border:1px solid rgba(99,202,183,0.4);color:#63cab7;padding:6px 16px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;transition:all 0.2s;">${continueLabel}</button>
        <button class="video-use-build-btn" style="background:rgba(255,160,50,0.15);border:1px solid rgba(255,160,50,0.4);color:#ffa032;padding:6px 16px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;transition:all 0.2s;">📌 Use in Build</button>
      </div>
    </div>
  `;

  bubble.querySelector('.video-save-btn')?.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = 'snaptoai-video.mp4';
    a.click();
  });

  bubble.querySelector('.video-use-build-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.textContent = '⏳ Preparing…';
    btn.disabled = true;
    try {
      const resp = await fetch(videoUrl);
      const blob = await resp.blob();
      const mimeType = blob.type || 'video/webm';
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        setStagedMedia('video', mimeType, base64, 'Video');
        // Auto-enable Build Mode so the staged video is actually used
        if (!buildModeEnabled) {
          buildModeEnabled = true;
          const buildBtn = document.getElementById('buildToggleBtn');
          if (buildBtn) {
            buildBtn.classList.add('tool-btn-active');
            buildBtn.title = 'Build Mode ON — AI will generate full HTML/CSS/JS apps with live preview';
          }
        }
        btn.textContent = '✅ Staged for Build!';
        btn.style.background = 'rgba(0,200,136,0.2)';
        btn.style.borderColor = 'rgba(0,200,136,0.5)';
        btn.style.color = '#00cc88';
        btn.disabled = false;
        setTimeout(() => {
          btn.textContent = '📌 Use in Build';
          btn.style.background = 'rgba(255,160,50,0.15)';
          btn.style.borderColor = 'rgba(255,160,50,0.4)';
          btn.style.color = '#ffa032';
        }, 2000);
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      btn.textContent = '❌ Failed';
      btn.disabled = false;
      setTimeout(() => { btn.textContent = '📌 Use in Build'; }, 2000);
    }
  });

  // ── Capture last frame via blob URL (avoids cross-origin canvas block) ─
  // Veo URLs are Google CDN (cross-origin). drawImage on a cross-origin
  // <video> throws SecurityError. Fix: fetch the video as a blob, create
  // a local blob URL (same-origin), capture frame from that.
  if (ctx) {
    ctx.videoUrl = videoUrl;
    (async () => {
      try {
        const resp = await fetch(videoUrl);
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);

        // Off-screen video element with blob URL — same-origin, canvas-safe.
        // Must have real dimensions + opacity (not visibility:hidden) so
        // Chrome actually decodes the video and fires loadedmetadata/canplay.
        const captureVid = document.createElement('video');
        captureVid.muted = true;
        captureVid.preload = 'auto';
        captureVid.playsInline = true;
        captureVid.src = blobUrl;
        captureVid.style.cssText = 'position:fixed;left:-9999px;top:0;width:320px;height:180px;opacity:0.01;pointer-events:none;z-index:-1;';
        document.body.appendChild(captureVid);

        let frameDataUrl = null;
        try {
          frameDataUrl = await captureFrameFromVideoElement(captureVid);
        } finally {
          if (document.body.contains(captureVid)) document.body.removeChild(captureVid);
          URL.revokeObjectURL(blobUrl);
        }

        if (frameDataUrl && ctx) {
          ctx.lastFrameDataUrl = frameDataUrl;
          if (sceneSnapshot) sceneSnapshot.lastFrameDataUrl = frameDataUrl;
          const contBtn = bubble.querySelector('.video-continue-btn');
          if (contBtn) {
            contBtn.style.borderColor = 'rgba(99,202,183,0.7)';
            contBtn.style.background = 'rgba(99,202,183,0.25)';
            contBtn.title = canRealExtend(sceneSnapshot)
              ? 'Real Veo extend — adds 7s with continuous audio/motion, no stitching'
              : 'Last frame locked — click to continue from here';
          }
        }
      } catch (e) {
        console.warn('[Continue] blob frame capture failed:', e?.message);
      }
    })();
  }

  // ── Auto-chain to reach the requested total length ──────────────────────
  // If the user picked a "Total length" > 8s and this clip is native-extend
  // eligible, automatically fire the next extend once this clip lands —
  // no manual clicking needed. Stops as soon as the target is reached, an
  // extend fails (error already shown by extendVeoVideoReal), or the video
  // hits Google's hard cap. Each native extend adds exactly 7s, so totals
  // land on 8/15/22/29s rather than the round number the user picked.
  if (ctx && ctx.targetDurationSec > (ctx.totalDurationSec || 0) && nativeReady && !hardCapped) {
    // If we're still cooling down from a rate limit, don't silently fire —
    // that's exactly the burst behavior that exhausted quota last time.
    // Skip the auto-chain entirely and let the user retry manually once the
    // cooldown clears (the "Extend" button will show the wait time itself).
    if (ctx._extendCooldownUntil && Date.now() < ctx._extendCooldownUntil) {
      const waitSec = Math.ceil((ctx._extendCooldownUntil - Date.now()) / 1000);
      const cooldownNote = document.createElement('div');
      cooldownNote.style.cssText = 'margin-top:8px;font-size:11px;color:#ffa500;';
      cooldownNote.textContent = `⏱️ Auto-extend paused — cooling down from a rate limit (~${waitSec}s). Click "Extend (Native)" once it clears.`;
      bubble.querySelector('div')?.appendChild(cooldownNote);
    } else {
      const remaining = ctx.targetDurationSec - (ctx.totalDurationSec || 0);
      const autoNote = document.createElement('div');
      autoNote.style.cssText = 'margin-top:8px;font-size:11px;color:#63cab7;display:flex;align-items:center;gap:6px;';
      autoNote.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border:2px solid #63cab7;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;"></span> Auto-extending to reach your requested length (${remaining}s to go)...`;
      bubble.querySelector('div')?.appendChild(autoNote);

      setTimeout(() => {
        // Guard against a race if the user manually clicked Continue/Extend
        // in the meantime, started a fresh generation, or a rate limit hit
        // during the delay (checked again here, not just at schedule time).
        if (_lastVideoContext === ctx && !document.getElementById('chatInput')?.disabled &&
            (!ctx._extendCooldownUntil || Date.now() >= ctx._extendCooldownUntil)) {
          continueClip();
        }
      }, 2000);
    }
  }

  // ── Continue Clip / Extend button ────────────────────────────────────────
  // Always operates on THIS bubble's own scene (sceneSnapshot), so clicking
  // Extend on an older clip branches off of it — even if newer clips exist.
  bubble.querySelector('.video-continue-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!sceneSnapshot || btn.disabled) return;

    const customPromptVal = bubble.querySelector('.video-custom-prompt-input')?.value || '';

    btn.textContent = '⏳ Preparing continuation…';
    btn.disabled = true;

    // Native extend doesn't need a captured frame at all — skip straight to
    // continueClip(), which will pick the real-extend path on its own.
    if (canRealExtend(sceneSnapshot)) {
      btn.disabled = false;
      btn.textContent = '🔗 Extend (Native)';
      await continueClip(customPromptVal, sceneSnapshot);
      return;
    }

    // If background capture still pending, try fetching the blob now
    if (!sceneSnapshot.lastFrameDataUrl && sceneSnapshot.videoUrl) {
      try {
        const resp = await fetch(sceneSnapshot.videoUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          const blobUrl = URL.createObjectURL(blob);
          const captureVid = document.createElement('video');
          captureVid.muted = true;
          captureVid.preload = 'auto';
          captureVid.playsInline = true;
          captureVid.src = blobUrl;
          captureVid.style.cssText = 'position:fixed;left:-9999px;top:0;width:320px;height:180px;opacity:0.01;pointer-events:none;z-index:-1;';
          document.body.appendChild(captureVid);
          try {
            sceneSnapshot.lastFrameDataUrl = await captureFrameFromVideoElement(captureVid);
          } finally {
            if (document.body.contains(captureVid)) document.body.removeChild(captureVid);
            URL.revokeObjectURL(blobUrl);
          }
        }
      } catch (_) {}
    }

    btn.disabled = false;
    btn.textContent = '▶ Continue Clip';
    // Non-native fallback path is inherently tied to the single global chat
    // pipeline (mode switching, staged image, chat auto-submit) — it always
    // continues from whatever is the current global scene, not a branch.
    await continueClip(customPromptVal, _lastVideoContext);
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

// BROADCAST STUDIO  — 3-voice AI broadcast (Zephyr/Kore/Fenrir)
// Formats: Talk Show / Tutorial / App Demo / Presentation / Narrator
// Triggered when the user enters Broadcast mode.
// ─────────────────────────────────────────────────────────────────────────────
function showBroadcastCard(thread, options = {}) {
  const existing = thread.querySelector('.broadcast-card');
  if (existing) existing.remove();

  if (!document.getElementById('bc-styles')) {
    const s = document.createElement('style');
    s.id = 'bc-styles';
    s.textContent = `@keyframes bcPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.35;transform:scale(0.72)}}
.bc-pill{padding:4px 10px;border-radius:20px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#8899aa;font-size:11px;cursor:pointer;transition:all 0.18s;white-space:nowrap;line-height:1.6;}
.bc-fmt.active{background:rgba(45,212,191,0.14);border-color:rgba(45,212,191,0.38);color:#2dd4bf;font-weight:700;}
.bc-dur.active{background:rgba(167,139,250,0.14);border-color:rgba(167,139,250,0.38);color:#a78bfa;font-weight:700;}
.bc-trk.active{background:rgba(251,191,36,0.12);border-color:rgba(251,191,36,0.33);color:#fbbf24;font-weight:700;}
.bc-pill:hover{opacity:0.82;}`;
    document.head.appendChild(s);
  }

  const SPEAKERS = {
    ZEPHYR: { voice: 'Zephyr', role: 'Host',     color: '#2dd4bf', icon: '🎙️' },
    KORE:   { voice: 'Kore',   role: 'Expert',   color: '#a78bfa', icon: '🎓' },
    FENRIR: { voice: 'Fenrir', role: 'Creative', color: '#f97316', icon: '⚡' },
  };

  const FORMATS = [
    { key: 'talkshow',     label: '🎙️ Talk Show' },
    { key: 'tutorial',     label: '📚 Tutorial' },
    { key: 'solotutorial', label: '📱 Solo Tutorial' },
    { key: 'trailer',      label: '🎬 Trailer' },
    { key: 'appdemo',      label: '🚀 App Demo' },
    { key: 'presentation', label: '📊 Presentation' },
    { key: 'narrator',     label: '🎬 Narrator' },
  ];

  const DURATIONS = [
    { key: '1',  label: '1 min',  exchanges: 8  },
    { key: '3',  label: '3 min',  exchanges: 18 },
    { key: '5',  label: '5 min',  exchanges: 28 },
    { key: '10', label: '10 min', exchanges: 45 },
  ];

  const TRACKS = [
    { key: 'none',      label: '🚫 None',      prompt: null },
    { key: 'lofi',      label: '☁️ Lo-fi',     prompt: 'Soft instrumental lo-fi background music for a podcast. Calm, warm, professional atmosphere. No vocals. Mellow backdrop beneath conversation.' },
    { key: 'cinematic', label: '🎬 Cinematic', prompt: 'Epic cinematic orchestral background music. Dramatic, inspiring, documentary-style. No vocals. Suitable beneath narration.' },
    { key: 'news',      label: '📰 News',      prompt: 'Professional TV news broadcast background music. Authoritative, modern, clean. Short staccato hits. No vocals.' },
    { key: 'upbeat',    label: '🎸 Upbeat',    prompt: 'Upbeat positive motivational background music. Energetic, modern, corporate pop style. No vocals.' },
  ];

  // ── Helper: raw PCM / L16 → WAV blob ─────────────────────────
  function pcmToWav(b64, mimeType) {
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const mime = (mimeType || '').toLowerCase();
    if (!mime || mime.includes('pcm') || mime.startsWith('audio/l16') || mime.startsWith('audio/l-16')) {
      const sr = 24000, ch = 1, bps = 16;
      const buf = new ArrayBuffer(44); const dv = new DataView(buf);
      const ws = (o, v) => { for (let i = 0; i < v.length; i++) dv.setUint8(o + i, v.charCodeAt(i)); };
      ws(0,'RIFF'); dv.setUint32(4, 36 + raw.byteLength, true);
      ws(8,'WAVE'); ws(12,'fmt ');
      dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,ch,true);
      dv.setUint32(24,sr,true); dv.setUint32(28,sr*ch*bps/8,true);
      dv.setUint16(32,ch*bps/8,true); dv.setUint16(34,bps,true);
      ws(36,'data'); dv.setUint32(40,raw.byteLength,true);
      return new Blob([buf, raw], { type: 'audio/wav' });
    }
    return new Blob([raw], { type: mimeType || 'audio/wav' });
  }

  // ── TTS: generate one line with format-appropriate style ─────
  async function bcGenLine(text, voiceName, ttsStyle, apiKey) {
    const styled = `${ttsStyle}${text}`;
    for (const model of [MODELS.ttsPrimary, MODELS.ttsFallback]) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: styled }] }],
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
              }
            }),
            signal: AbortSignal.timeout(28000)
          }
        );
        if (!r.ok) continue;
        const d = await r.json();
        const p = d?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (!p?.data) continue;
        return URL.createObjectURL(pcmToWav(p.data, p.mimeType));
      } catch (e) { continue; }
    }
    return null;
  }

  // ── Music: generate background track by Lyria prompt ─────────
  async function bcGenMusic(trackPrompt, apiKey) {
    if (!trackPrompt) return null;
    for (const model of [MODELS.lyria3, MODELS.musicDefault]) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: trackPrompt }] }],
              generationConfig: { responseModalities: ['AUDIO'] }
            }),
            signal: AbortSignal.timeout(55000)
          }
        );
        if (!r.ok) continue;
        const body = await r.json();
        for (const ap of (body.candidates?.[0]?.content?.parts || [])) {
          if (ap.inlineData?.data) return URL.createObjectURL(pcmToWav(ap.inlineData.data, ap.inlineData.mimeType));
        }
      } catch (e) { continue; }
    }
    return null;
  }

  // ── Loading spinner (used on prepBtn / statusEl during generation) ──
  function bcSpinnerHtml(label) {
    return `<span style="display:inline-flex;align-items:center;gap:7px;"><span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.35);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;flex-shrink:0;"></span>${label}</span>`;
  }

  // ── Parse Gemini script ───────────────────────────────────────
  function bcParseScript(raw) {
    const result = [];
    for (const line of raw.split('\n')) {
      const t = line.trim(); if (!t) continue;
      for (const sp of Object.keys(SPEAKERS)) {
        const m = t.match(new RegExp(`^${sp}[:\\-]\\s*(.+)`, 'i'));
        if (m) { result.push({ speaker: sp.toUpperCase(), text: m[1].trim(), url: null }); break; }
      }
    }
    return result;
  }

  // ── Hex → "r,g,b" ────────────────────────────────────────────
  function bcHexRgb(h) { return [1,3,5].map(i => parseInt(h.slice(i,i+2),16)).join(','); }

  // ── System prompt varies by format and target length ─────────
  function bcSysPrompt(format, exchanges) {
    const base = `FORMAT (strict — output ONLY script lines, nothing else):
ZEPHYR: [one or two spoken sentences]
KORE: [one or two spoken sentences]
FENRIR: [one or two spoken sentences]
...${exchanges} exchanges total
No stage directions. No asterisks. No markdown. Natural spoken language only.`;
    const map = {
      talkshow:     `You are a professional podcast scriptwriter. Write a lively 3-person talk show script from the source material.\n\n${base}\n\nZEPHYR = warm engaging host, KORE = knowledgeable expert, FENRIR = bold creative voice. Start with ZEPHYR introducing the topic.`,
      tutorial:     `You are a scriptwriter creating an educational tutorial broadcast.\n\n${base}\n\nZEPHYR = friendly instructor walking through content step by step, KORE = student asking smart clarifying questions, FENRIR = adds real-world tips and examples. Start with ZEPHYR introducing what will be learned.`,
      solotutorial: `You are writing a solo app tutorial script for ONE speaker only: FENRIR.\n\n${base}\n\nCHARACTER — FENRIR is "The Trusted Expert Friend":\n- He knows this app inside out, as if he built it himself.\n- He speaks like he is showing a close friend, not reading a manual.\n- He is calm and confident — never salesy, never hyped, never hedging. He says "this works" not "this might work".\n- He calls out every action in sequence with clear timing cues: "First... now click... watch what happens here... see that? That is the moment."\n- He explains WHY each feature exists, not just WHAT it does — because trust comes from understanding.\n- He sounds like a smart friend who has used this app a thousand times and is simply sharing what he knows.\n- Think MKBHD energy: clear, authoritative, warm, zero fluff.\n\nCRITICAL RULES:\n- EVERY single line MUST start with "FENRIR:" — no ZEPHYR, no KORE, no other speakers ever.\n- Write exactly ${exchanges} lines.\n- Structure: Powerful hook → What the app does and why it matters → Walk through each feature step by step with timing cues → Real-world benefit that changes the user's life → Memorable sign-off.\n- Each line 10-25 words. Mix short punchy sentences with slightly longer explanatory ones for natural rhythm.\n- Use "..." for natural pauses. No filler words.\n- Anticipate doubts and answer them before the viewer even thinks them.\n- End with a sign-off so good it sticks in memory.\n\nStart with FENRIR delivering a hook that makes someone stop scrolling immediately.`,
      appdemo:      `You are a scriptwriter creating an app or product demo broadcast.\n\n${base}\n\nZEPHYR = main presenter showcasing features enthusiastically, KORE = excited first-time user reacting, FENRIR = technical expert adding context. Start with ZEPHYR with a strong opening hook.`,
      presentation: `You are a scriptwriter creating a professional business presentation broadcast.\n\n${base}\n\nZEPHYR = main presenter delivering key points, KORE = co-presenter adding supporting evidence, FENRIR = reinforces and summarizes takeaways. Professional, polished language. Start with ZEPHYR with an executive summary.`,
      narrator:     `You are a scriptwriter creating a documentary-style narrative broadcast.\n\n${base}\n\nZEPHYR = primary narrator (~50% of lines), KORE = provides perspective and counterpoint (~30%), FENRIR = delivers impactful conclusions (~20%). Measured, compelling language. Start with ZEPHYR.`,
      trailer:      `You are writing a HOLLYWOOD BLOCKBUSTER MOVIE TRAILER voiceover script. ONE narrator only — FENRIR — no other speakers.\n\n${base}\n\nCRITICAL RULES:\n- EVERY line MUST start with "FENRIR:" — no ZEPHYR, no KORE, no exceptions.\n- Write exactly ${exchanges} lines, each 5-20 words — SHORT and PUNCHY.\n- Tone: EPIC, cinematic, world-changing, urgent, electrifying. Think Christopher Nolan meets Apple Keynote.\n- NO questions from anyone. This is a powerful dramatic MONOLOGUE.\n- Use "..." for dramatic pauses within a line. Build intensity with each line.\n\nNARRATIVE ARC (hit every beat):\n1. Lines 1-2: Explosive world-setting hook — paint the world BEFORE ("In a world where chaos rules the screen...")\n2. Lines 3-4: The problem — what was missing, what was broken, what was impossible\n3. Lines 5-${Math.max(6,Math.floor(exchanges*0.55))}: Rising intensity — introduce the hero. Name it. Reveal its power. Drop feature after feature like punches.\n4. Lines ${Math.max(7,Math.floor(exchanges*0.55)+1)}-${exchanges-2}: CLIMAX — peak excitement, game-changing moment, the world transformed\n5. Lines ${exchanges-1}-${exchanges}: ICONIC TAGLINE and rallying call to action — make it unforgettable.\n\nEnd on something that sends chills. Make every word earn its place.`,
    };
    return map[format] || map.talkshow;
  }

  // ── TTS speaking style prefix by format ──────────────────────
  function bcTtsStyle(format) {
    const map = {
      talkshow:     'Speak naturally and conversationally as if live on a talk show: ',
      tutorial:     'Speak clearly and educationally as a friendly instructor: ',
      solotutorial: 'You are a confident, charismatic tech YouTuber presenting a professional app tutorial. Speak with energy, clarity, and authority — like you have a million subscribers watching: ',
      appdemo:      'Speak enthusiastically as if presenting an exciting product demo: ',
      presentation: 'Speak professionally and authoritatively as in a business presentation: ',
      narrator:     'Speak like a compelling documentary narrator, measured and thoughtful: ',
      trailer:      'You are a legendary Hollywood movie trailer voice. Deliver every word with earth-shaking gravitas, dramatic power, and cinematic intensity — as if the fate of the world depends on it: ',
    };
    return map[format] || map.talkshow;
  }

  // ── Build card DOM ────────────────────────────────────────────
  const card = document.createElement('div');
  card.className = 'chat-bubble ai broadcast-card';
  card.style.cssText = 'padding:0;margin:8px 0;background:transparent;border:none;max-width:100%;width:100%;';

  card.innerHTML = `
<div style="background:linear-gradient(135deg,rgba(45,212,191,0.07),rgba(124,58,237,0.04));border:1px solid rgba(45,212,191,0.15);border-radius:16px;padding:18px;backdrop-filter:blur(10px);">

  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
    <div style="display:flex;align-items:center;gap:9px;">
      <span style="font-size:22px;">🎙️</span>
      <div>
        <div style="font-size:15px;font-weight:700;color:#e8eef4;">Broadcast Studio</div>
        <div style="font-size:11px;color:#667788;">Turn any content into a multi-voice AI broadcast</div>
      </div>
    </div>
    <div class="bc-live-badge" style="display:none;align-items:center;gap:5px;padding:3px 9px;border-radius:20px;background:rgba(239,68,68,0.13);border:1px solid rgba(239,68,68,0.38);">
      <span style="width:7px;height:7px;border-radius:50%;background:#ef4444;display:inline-block;animation:bcPulse 1.1s ease-in-out infinite;"></span>
      <span style="font-size:10px;font-weight:700;color:#ef4444;letter-spacing:0.07em;">LIVE</span>
    </div>
  </div>

  <div style="display:flex;gap:5px;margin-bottom:14px;flex-wrap:wrap;">
    <div style="display:flex;align-items:center;gap:3px;padding:3px 8px;border-radius:10px;background:rgba(45,212,191,0.08);border:1px solid rgba(45,212,191,0.2);font-size:10px;color:#2dd4bf;">🎙️ <b>Zephyr</b>&nbsp;<span style="opacity:0.5;">Host</span></div>
    <div style="display:flex;align-items:center;gap:3px;padding:3px 8px;border-radius:10px;background:rgba(167,139,250,0.08);border:1px solid rgba(167,139,250,0.2);font-size:10px;color:#a78bfa;">🎓 <b>Kore</b>&nbsp;<span style="opacity:0.5;">Expert</span></div>
    <div style="display:flex;align-items:center;gap:3px;padding:3px 8px;border-radius:10px;background:rgba(249,115,22,0.08);border:1px solid rgba(249,115,22,0.2);font-size:10px;color:#f97316;">⚡ <b>Fenrir</b>&nbsp;<span style="opacity:0.5;">Creative</span></div>
  </div>

  <div class="bc-input-sec" ${options.hidePicker ? 'style="display:none;"' : ''}>
    <div style="margin-bottom:10px;">
      <div style="font-size:9.5px;color:#667788;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.06em;">Format</div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;">
        <button class="bc-pill bc-fmt active" data-fmt="talkshow">🎙️ Talk Show</button>
        <button class="bc-pill bc-fmt" data-fmt="tutorial">📚 Tutorial</button>
        <button class="bc-pill bc-fmt bc-fmt-solo" data-fmt="solotutorial" style="border-color:rgba(45,212,191,0.35);color:#2dd4bf;background:rgba(45,212,191,0.06);">📱 Solo Tutorial</button>
        <button class="bc-pill bc-fmt" data-fmt="appdemo">🚀 App Demo</button>
        <button class="bc-pill bc-fmt" data-fmt="presentation" style="display:none;">📊 Presentation</button>
        <button class="bc-pill bc-fmt" data-fmt="narrator" style="display:none;">🎬 Narrator</button>
        <button class="bc-pill bc-fmt bc-fmt-trailer" data-fmt="trailer" style="display:none;border-color:rgba(234,179,8,0.35);color:#eab308;background:rgba(234,179,8,0.06);">🎥 Trailer</button>
      </div>
    </div>

    <div style="margin-bottom:10px;">
      <div style="font-size:9.5px;color:#667788;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.06em;">Length</div>
      <div style="display:flex;gap:5px;">
        <button class="bc-pill bc-dur" data-dur="1">1 min</button>
        <button class="bc-pill bc-dur active" data-dur="3">3 min</button>
        <button class="bc-pill bc-dur" data-dur="5">5 min</button>
        <button class="bc-pill bc-dur" data-dur="10">10 min</button>
      </div>
    </div>

    <div style="margin-bottom:10px;">
      <div style="font-size:9.5px;color:#667788;margin-bottom:7px;text-transform:uppercase;letter-spacing:0.06em;">Attach Source Media</div>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <button class="bc-attach-img" style="flex:1;padding:10px 5px;border-radius:10px;border:1px solid rgba(45,212,191,0.3);background:rgba(45,212,191,0.07);color:#2dd4bf;font-size:20px;cursor:pointer;line-height:1;text-align:center;"><div>📷</div><div style="font-size:10px;color:#9aabb8;margin-top:3px;font-weight:600;">Images</div></button>
        <button class="bc-attach-vid" style="flex:1;padding:10px 5px;border-radius:10px;border:1px solid rgba(167,139,250,0.3);background:rgba(167,139,250,0.07);color:#a78bfa;font-size:20px;cursor:pointer;line-height:1;text-align:center;"><div>🎬</div><div style="font-size:10px;color:#9aabb8;margin-top:3px;font-weight:600;">Video</div></button>
        <button class="bc-attach-file" style="flex:1;padding:10px 5px;border-radius:10px;border:1px solid rgba(251,191,36,0.3);background:rgba(251,191,36,0.07);color:#fbbf24;font-size:20px;cursor:pointer;line-height:1;text-align:center;"><div>📄</div><div style="font-size:10px;color:#9aabb8;margin-top:3px;font-weight:600;">File</div></button>
      </div>
      <div class="bc-attach-list" style="display:none;margin-bottom:8px;"></div>
      <div style="font-size:9.5px;color:#667788;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em;">Or type / paste text</div>
      <textarea class="bc-source" placeholder="Topic, article, notes, script outline… (optional if media attached)" style="width:100%;box-sizing:border-box;min-height:60px;background:rgba(255,255,255,0.04);border:1px solid rgba(45,212,191,0.18);border-radius:10px;padding:9px 11px;color:#e8eef4;font-size:12px;font-family:inherit;resize:vertical;outline:none;transition:border-color 0.2s;line-height:1.4;"></textarea>
      <input type="file" class="bc-img-input" accept="image/*" multiple style="display:none;">
      <input type="file" class="bc-vid-input" accept="video/*" style="display:none;">
      <input type="file" class="bc-file-input" accept=".txt,.md,.csv,.json,.pdf,.pptx,.docx" style="display:none;">
    </div>

    <div style="margin-bottom:14px;">
      <div style="font-size:9.5px;color:#667788;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.06em;">Background Music</div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;">
        <button class="bc-pill bc-trk" data-trk="none">🚫 None</button>
        <button class="bc-pill bc-trk active" data-trk="lofi">☁️ Lo-fi</button>
        <button class="bc-pill bc-trk" data-trk="cinematic">🎬 Cinematic</button>
        <button class="bc-pill bc-trk" data-trk="news">📰 News</button>
        <button class="bc-pill bc-trk" data-trk="upbeat">🎸 Upbeat</button>
      </div>
    </div>

    <button class="bc-prepare-btn" style="width:100%;padding:11px;border-radius:10px;border:none;background:linear-gradient(135deg,#2dd4bf,#7c3aed);color:#fff;font-size:13px;font-weight:700;cursor:pointer;transition:all 0.2s;">🎙️ Generate Broadcast</button>
  </div>

  <div class="bc-script-sec" style="display:none;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin:14px 0 7px 0;">
      <span style="font-size:12px;font-weight:600;color:#8899aa;">📜 Script</span>
      <span class="bc-status" style="font-size:11px;color:#667788;"></span>
    </div>
    <div class="bc-lines" style="background:rgba(0,0,0,0.22);border-radius:10px;padding:10px;max-height:165px;overflow-y:auto;"></div>
    <div class="bc-vol-row" style="display:flex;align-items:center;gap:10px;margin:12px 0 8px 0;">
      <span style="font-size:11px;color:#8899aa;white-space:nowrap;">🎵 Vol</span>
      <input type="range" class="bc-vol" min="0" max="100" value="12" style="flex:1;accent-color:#2dd4bf;cursor:pointer;">
      <span class="bc-vol-pct" style="font-size:11px;color:#8899aa;width:28px;text-align:right;">12%</span>
    </div>
    <div style="display:flex;gap:8px;margin-top:6px;">
      <button class="bc-broadcast-btn" style="flex:1;padding:11px;border-radius:10px;border:none;background:linear-gradient(135deg,#2dd4bf,#7c3aed);color:#fff;font-size:13px;font-weight:700;cursor:pointer;opacity:0.45;pointer-events:none;transition:all 0.2s;">▶ Start Broadcast</button>
      <button class="bc-stop-btn" style="display:none;padding:11px 15px;border-radius:10px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.1);color:#ef4444;font-size:13px;font-weight:700;cursor:pointer;">⏹</button>
      <button class="bc-reset-btn" style="padding:11px 13px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#9aabb8;font-size:12px;cursor:pointer;">↺</button>
    </div>
    <button class="bc-dl-btn" style="display:none;width:100%;margin-top:8px;padding:10px;border-radius:10px;border:1px solid rgba(45,212,191,0.35);background:rgba(45,212,191,0.08);color:#2dd4bf;font-size:13px;font-weight:700;cursor:pointer;transition:all 0.2s;">⬇️ Download Episode</button>
  </div>
</div>`;

  thread.appendChild(card);

  // ── State ─────────────────────────────────────────────────────
  let selFormat   = options.selFormat || 'talkshow';
  let selDur      = options.selDur    || '3';
  let selTrack    = options.selTrack  || 'lofi';
  let attachments = options.attachments ? [...options.attachments] : [];
  let script    = [];
  let bgUrl     = null;

  // ── Auto-load snaps from the queue into broadcast attachments ──
  (async () => {
    try {
      let snaps = [];
      // Try IndexedDB first (primary storage for large images)
      try { snaps = await loadImagesFromIndexedDB(); } catch (_) {}
      // Fallback to session storage
      if (!snaps.length) {
        const ses = await chrome.storage.session.get(['selectedSnaps', 'selectedSnap']);
        snaps = ses.selectedSnaps || (ses.selectedSnap ? [ses.selectedSnap] : []);
      }
      if (!snaps.length) return;
      snaps.slice(0, 20).forEach((dataUrl, i) => {
        const raw = typeof dataUrl === 'string' ? dataUrl : '';
        const comma = raw.indexOf(',');
        const b64 = comma >= 0 ? raw.slice(comma + 1) : raw;
        const mime = (raw.match(/^data:([^;]+);/) || [])[1] || 'image/png';
        if (b64) attachments.push({ type: 'image', name: `Snap ${i + 1}`, mimeType: mime, data: b64, snapId: `snap_${i}` });
      });
      if (attachments.length) bcRenderAttachments();
    } catch (_) {}
  })();

  let bgAudio   = null;
  let isPlaying = false;
  let stopReq   = false;
  let blobUrls  = [];

  // ── DOM refs ──────────────────────────────────────────────────
  const inputSec   = card.querySelector('.bc-input-sec');
  const scriptSec  = card.querySelector('.bc-script-sec');
  const srcEl      = card.querySelector('.bc-source');
  const prepBtn    = card.querySelector('.bc-prepare-btn');
  const linesEl    = card.querySelector('.bc-lines');
  const statusEl   = card.querySelector('.bc-status');
  const liveBadge  = card.querySelector('.bc-live-badge');
  const broadBtn   = card.querySelector('.bc-broadcast-btn');
  const stopBtn    = card.querySelector('.bc-stop-btn');
  const resetBtn   = card.querySelector('.bc-reset-btn');
  const dlBtn      = card.querySelector('.bc-dl-btn');
  const volSlider  = card.querySelector('.bc-vol');
  const volPct     = card.querySelector('.bc-vol-pct');
  const volRow     = card.querySelector('.bc-vol-row');
  const attachList = card.querySelector('.bc-attach-list');
  const imgInput   = card.querySelector('.bc-img-input');
  const vidInput   = card.querySelector('.bc-vid-input');
  const fileInput  = card.querySelector('.bc-file-input');

  // ── Format tabs ───────────────────────────────────────────────
  card.querySelectorAll('.bc-fmt').forEach(btn => {
    btn.addEventListener('click', () => {
      card.querySelectorAll('.bc-fmt').forEach(b => {
        b.classList.remove('active');
        // Reset special buttons back to idle styles
        if (b.dataset.fmt === 'trailer') {
          b.style.borderColor = 'rgba(234,179,8,0.35)';
          b.style.color = '#eab308';
          b.style.background = 'rgba(234,179,8,0.06)';
          b.style.fontWeight = '';
        }
        if (b.dataset.fmt === 'solotutorial') {
          b.style.borderColor = 'rgba(45,212,191,0.35)';
          b.style.color = '#2dd4bf';
          b.style.background = 'rgba(45,212,191,0.06)';
          b.style.fontWeight = '';
        }
      });
      btn.classList.add('active');
      selFormat = btn.dataset.fmt;
      // Trailer: gold active style + auto-select Cinematic music
      if (selFormat === 'trailer') {
        btn.style.borderColor = 'rgba(234,179,8,0.55)';
        btn.style.color = '#fde047';
        btn.style.background = 'rgba(234,179,8,0.16)';
        btn.style.fontWeight = '700';
        const cinBtn = card.querySelector('.bc-trk[data-trk="cinematic"]');
        if (cinBtn) cinBtn.click();
      // Solo Tutorial: teal active style + auto-select Upbeat music
      } else if (selFormat === 'solotutorial') {
        btn.style.borderColor = 'rgba(45,212,191,0.7)';
        btn.style.color = '#5eead4';
        btn.style.background = 'rgba(45,212,191,0.18)';
        btn.style.fontWeight = '700';
        const upbeatBtn = card.querySelector('.bc-trk[data-trk="upbeat"]');
        if (upbeatBtn) upbeatBtn.click();
      } else {
        btn.style.borderColor = '';
        btn.style.color = '';
        btn.style.background = '';
        btn.style.fontWeight = '';
      }
    });
  });

  // ── Duration tabs ─────────────────────────────────────────────
  card.querySelectorAll('.bc-dur').forEach(btn => {
    btn.addEventListener('click', () => {
      card.querySelectorAll('.bc-dur').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selDur = btn.dataset.dur;
    });
  });

  // ── Music track tabs ──────────────────────────────────────────
  card.querySelectorAll('.bc-trk').forEach(btn => {
    btn.addEventListener('click', () => {
      card.querySelectorAll('.bc-trk').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selTrack = btn.dataset.trk;
      volRow.style.display = selTrack === 'none' ? 'none' : 'flex';
    });
  });

  // ── Volume slider ─────────────────────────────────────────────
  volSlider.addEventListener('input', () => {
    volPct.textContent = `${volSlider.value}%`;
    if (bgAudio) bgAudio.volume = parseInt(volSlider.value) / 100;
  });

  // ── Attachment rendering ──────────────────────────────────────
  function bcRenderAttachments() {
    attachList.innerHTML = '';
    if (!attachments.length) { attachList.style.display = 'none'; return; }
    attachList.style.display = 'block';

    // Group video frames by source file
    const videoFiles = [...new Set(attachments.filter(a => a.videoFile).map(a => a.videoFile))];
    const images     = attachments.filter(a => a.type === 'image');
    const files      = attachments.filter(a => a.type === 'file');

    // ── Video panel ──
    videoFiles.forEach(vf => {
      const frames = attachments.filter(a => a.videoFile === vf);
      const panel  = document.createElement('div');
      panel.style.cssText = 'background:rgba(167,139,250,0.07);border:1px solid rgba(167,139,250,0.25);border-radius:10px;padding:10px;margin-bottom:6px;';

      const header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;';
      const title  = document.createElement('span');
      title.style.cssText = 'font-size:11px;font-weight:700;color:#a78bfa;';
      const shortName = vf.length > 28 ? vf.slice(0, 25) + '…' : vf;
      title.textContent = `🎬 ${shortName}`;
      const rmBtn = document.createElement('button');
      rmBtn.textContent = '✕ Remove';
      rmBtn.style.cssText = 'background:none;border:1px solid rgba(239,68,68,0.35);border-radius:6px;color:#ef4444;font-size:10px;cursor:pointer;padding:2px 7px;';
      rmBtn.onclick = () => { attachments = attachments.filter(a => a.videoFile !== vf); bcRenderAttachments(); };
      header.appendChild(title); header.appendChild(rmBtn);
      panel.appendChild(header);

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';
      frames.forEach(f => {
        const img = document.createElement('img');
        img.src = `data:image/jpeg;base64,${f.data}`;
        img.title = f.name;
        img.style.cssText = 'width:72px;height:48px;border-radius:6px;object-fit:cover;border:1px solid rgba(167,139,250,0.3);';
        row.appendChild(img);
      });
      panel.appendChild(row);

      const note = document.createElement('div');
      note.style.cssText = 'margin-top:7px;font-size:10px;color:#667788;';
      note.textContent = `✓ Gemini will analyze ${frames.length} frame${frames.length > 1 ? 's' : ''} from this video to write your script`;
      panel.appendChild(note);
      attachList.appendChild(panel);
    });

    // ── Images panel ──
    if (images.length) {
      const panel = document.createElement('div');
      panel.style.cssText = 'background:rgba(45,212,191,0.06);border:1px solid rgba(45,212,191,0.22);border-radius:10px;padding:10px;margin-bottom:6px;';
      const header = document.createElement('div');
      header.style.cssText = 'font-size:11px;font-weight:700;color:#2dd4bf;margin-bottom:7px;';
      header.textContent = `📷 ${images.length} image${images.length > 1 ? 's' : ''} attached`;
      panel.appendChild(header);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';
      images.forEach((a, i) => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative;display:inline-block;';
        const img = document.createElement('img');
        img.src = `data:${a.mimeType};base64,${a.data}`;
        img.style.cssText = 'width:60px;height:48px;border-radius:6px;object-fit:cover;border:1px solid rgba(45,212,191,0.28);display:block;';
        const rm = document.createElement('button');
        rm.textContent = '×';
        rm.style.cssText = 'position:absolute;top:-4px;right:-4px;width:14px;height:14px;border-radius:50%;background:#ef4444;color:#fff;border:none;cursor:pointer;font-size:9px;line-height:14px;padding:0;text-align:center;';
        rm.onclick = () => { const idx = attachments.indexOf(a); if (idx > -1) attachments.splice(idx, 1); bcRenderAttachments(); };
        wrap.appendChild(img); wrap.appendChild(rm);
        row.appendChild(wrap);
      });
      panel.appendChild(row);
      const note = document.createElement('div');
      note.style.cssText = 'margin-top:6px;font-size:10px;color:#667788;';
      note.textContent = '✓ Gemini will analyze these images to write your script';
      panel.appendChild(note);
      attachList.appendChild(panel);
    }

    // ── Files panel ──
    files.forEach((a, i) => {
      const chip = document.createElement('div');
      chip.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 10px;background:rgba(251,191,36,0.07);border:1px solid rgba(251,191,36,0.25);border-radius:8px;margin-bottom:4px;';
      chip.innerHTML = `<span style="font-size:16px;">📄</span><span style="font-size:11px;color:#fbbf24;flex:1;">${a.name}</span>`;
      const rm = document.createElement('button');
      rm.textContent = '×';
      rm.style.cssText = 'background:none;border:none;color:#667788;cursor:pointer;font-size:13px;padding:0;';
      rm.onclick = () => { const idx = attachments.indexOf(a); if (idx > -1) attachments.splice(idx, 1); bcRenderAttachments(); };
      chip.appendChild(rm);
      attachList.appendChild(chip);
    });
  }

  // ── Attachment buttons ────────────────────────────────────────
  card.querySelector('.bc-attach-img').addEventListener('click', () => imgInput.click());
  card.querySelector('.bc-attach-vid').addEventListener('click', () => vidInput.click());
  card.querySelector('.bc-attach-file').addEventListener('click', () => fileInput.click());

  imgInput.addEventListener('change', () => {
    Array.from(imgInput.files).slice(0, 20).forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        attachments.push({ type: 'image', name: file.name, mimeType: file.type, data: ev.target.result.split(',')[1] });
        bcRenderAttachments();
      };
      reader.readAsDataURL(file);
    });
    imgInput.value = '';
  });

  vidInput.addEventListener('change', () => {
    const file = vidInput.files[0]; if (!file) return;
    const url = URL.createObjectURL(file);
    const vid = document.createElement('video');
    vid.src = url; vid.muted = true; vid.preload = 'auto';

    let extractionStarted = false;

    const doExtract = (dur) => {
      if (extractionStarted) return;
      const safeD = (isFinite(dur) && dur > 0) ? dur : 60;
      const count = Math.min(25, Math.max(10, Math.ceil(safeD / 3)));
      extractionStarted = true;

      const times = Array.from({ length: count }, (_, i) => {
        if (i === 0) return 0.1;
        if (i === count - 1) return Math.max(safeD - 0.1, 0.2);
        return (safeD / (count - 1)) * i;
      });

      const frames = [];
      const captureOne = (t) => new Promise(resolve => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          vid.removeEventListener('seeked', finish);
          clearTimeout(guard);
          const w = Math.min(vid.videoWidth || 640, 640);
          const h = Math.min(vid.videoHeight || 360, 360);
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(vid, 0, 0, w, h);
          frames.push(cv.toDataURL('image/jpeg', 0.75).split(',')[1]);
          resolve();
        };
        const guard = setTimeout(finish, 3000);
        vid.addEventListener('seeked', finish);
        vid.currentTime = t;
      });

      (async () => {
        for (const t of times) await captureOne(t);
        URL.revokeObjectURL(url);
        attachments = attachments.filter(a => !(a.type === 'video-frame' && a.videoFile === file.name));
        frames.forEach((b64, fi) => {
          attachments.push({ type: 'video-frame', name: `${file.name} frame ${fi + 1}/${frames.length}`, videoFile: file.name, mimeType: 'image/jpeg', data: b64 });
        });
        if (!srcEl.value.trim()) srcEl.value = `Video: "${file.name}"`;
        bcRenderAttachments();
      })();
    };

    vid.onloadedmetadata = () => {
      if (isFinite(vid.duration) && vid.duration > 0) {
        doExtract(vid.duration);
      } else {
        const findDuration = () => {
          vid.removeEventListener('seeked', findDuration);
          doExtract(isFinite(vid.duration) ? vid.duration : vid.currentTime);
        };
        vid.addEventListener('seeked', findDuration);
        vid.currentTime = 1e10;
      }
    };

    vid.onerror = () => URL.revokeObjectURL(url);
    vid.load();
    vidInput.value = '';
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0]; if (!file) return;
    const isText = /\.(txt|md|csv|json|html)$/i.test(file.name) || file.type.startsWith('text/');
    if (isText) {
      const reader = new FileReader();
      reader.onload = ev => {
        srcEl.value += (srcEl.value ? '\n\n' : '') + ev.target.result;
        srcEl.style.borderColor = 'rgba(45,212,191,0.4)';
      };
      reader.readAsText(file);
    } else {
      // Non-text files (e.g. PDF) previously stored with data:null, which meant
      // they were silently dropped from the actual generation request. Read
      // the real bytes as base64 so the attachment actually does something.
      const binReader = new FileReader();
      binReader.onload = ev => {
        const b64 = (ev.target.result || '').split(',')[1] || null;
        attachments.push({ type: 'file', name: file.name, mimeType: file.type || 'application/pdf', data: b64 });
        bcRenderAttachments();
      };
      binReader.onerror = () => {
        addBubble?.(`Couldn't read "${file.name}" — try a .txt, .md, or .pdf file.`, 'error');
      };
      binReader.readAsDataURL(file);
    }
    fileInput.value = '';
  });

  // ── Render script ─────────────────────────────────────────────
  function bcRenderScript() {
    linesEl.innerHTML = script.map((l, i) => {
      const sp = SPEAKERS[l.speaker] || SPEAKERS.ZEPHYR;
      return `<div class="bc-line" data-i="${i}" style="padding:5px 8px;border-radius:8px;margin-bottom:4px;border-left:3px solid ${sp.color};background:rgba(0,0,0,0.12);transition:background 0.2s,transform 0.15s;">
        <div style="font-size:9.5px;font-weight:700;letter-spacing:0.06em;color:${sp.color};margin-bottom:2px;">${sp.icon} ${l.speaker}&nbsp;<span style="opacity:0.5;font-weight:400;">· ${sp.role}</span></div>
        <div style="color:#c8d4e0;font-size:12px;line-height:1.5;">${l.text}</div>
      </div>`;
    }).join('');
  }

  function bcHighlight(idx) {
    linesEl.querySelectorAll('.bc-line').forEach((el, i) => {
      if (i === idx) {
        const sp = SPEAKERS[script[i]?.speaker] || SPEAKERS.ZEPHYR;
        el.style.background = `rgba(${bcHexRgb(sp.color)},0.17)`;
        el.style.transform = 'scale(1.015)';
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        el.style.background = 'rgba(0,0,0,0.12)';
        el.style.transform = '';
      }
    });
  }

  function bcClearHighlights() {
    linesEl.querySelectorAll('.bc-line').forEach(el => {
      el.style.background = 'rgba(0,0,0,0.12)'; el.style.transform = '';
    });
  }

  function bcCleanupUrls() {
    blobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
    blobUrls = []; bgUrl = null;
  }

  // ── Stop ──────────────────────────────────────────────────────
  function bcStop() {
    stopReq = true; isPlaying = false;
    if (bgAudio) { try { bgAudio.pause(); } catch (e) {} bgAudio = null; }
    bcClearHighlights();
    liveBadge.style.display = 'none';
    broadBtn.style.display = ''; stopBtn.style.display = 'none';
  }

  stopBtn.addEventListener('click', () => { bcStop(); statusEl.textContent = 'Stopped'; });

  // ── Reset ─────────────────────────────────────────────────────
  resetBtn.addEventListener('click', () => {
    bcStop(); bcCleanupUrls();
    script = []; attachments = [];
    inputSec.style.display = 'block'; scriptSec.style.display = 'none';
    srcEl.value = ''; statusEl.textContent = '';
    broadBtn.style.opacity = '0.45'; broadBtn.style.pointerEvents = 'none';
    broadBtn.textContent = '▶ Start Broadcast';
    dlBtn.style.display = 'none';
    prepBtn.textContent = '🎙️ Generate Broadcast'; prepBtn.disabled = false;
    bcRenderAttachments();
  });

  // ── Generate Broadcast ────────────────────────────────────────
  prepBtn.addEventListener('click', async () => {
    const src = srcEl.value.trim();
    const hasVisuals = attachments.some(a => a.data);
    if (!src && !hasVisuals) {
      srcEl.style.borderColor = 'rgba(239,68,68,0.7)';
      srcEl.placeholder = 'Add text or attach an image/video first';
      return;
    }
    srcEl.style.borderColor = 'rgba(45,212,191,0.18)';

    const keyRes = await chrome.storage.sync.get(['geminiApiKey']);
    const apiKey = keyRes.geminiApiKey;
    if (!apiKey) { prepBtn.textContent = '🔑 Add API key in Settings first'; prepBtn.disabled = false; return; }

    // Visible spinner so it's obvious something is happening during the
    // ~1 minute script+voice generation — plain text alone was easy to miss
    // and made the feature look frozen/broken even though it was working.
    prepBtn.innerHTML = bcSpinnerHtml('Writing script…');
    prepBtn.disabled = true;

    const durCfg = DURATIONS.find(d => d.key === selDur) || DURATIONS[1];
    const trkCfg = TRACKS.find(t => t.key === selTrack) || TRACKS[1];

    // Step 1 — Script generation (multimodal if attachments present)
    let rawScript = '';
    try {
      const videoFileNames = [...new Set(attachments.filter(a => a.videoFile).map(a => a.videoFile))];
      const hasImages      = attachments.some(a => a.type === 'image');
      const fileAttachments = attachments.filter(a => a.type === 'file' && a.data);
      const fmtLabel       = FORMATS.find(f => f.key === selFormat)?.label || selFormat;

      // Augment system prompt with media context so Gemini understands what it's seeing
      let mediaCtx = '';
      if (videoFileNames.length) {
        mediaCtx = `\n\nIMPORTANT: The user has attached frames captured from a video file named "${videoFileNames[0]}". You are seeing multiple frames that show what happens throughout the video. Analyze the video content from these frames and write the ${fmtLabel} script ABOUT this video — describe what's shown, explain the concepts, walk through what's happening step by step as appropriate for the format.`;
      } else if (fileAttachments.length) {
        mediaCtx = `\n\nIMPORTANT: The user has attached ${fileAttachments.length > 1 ? 'files' : 'a file'} (${fileAttachments.map(f => f.name).join(', ')}). Read its actual contents and write the ${fmtLabel} script ABOUT what is in it.`;
      } else if (hasImages) {
        mediaCtx = `\n\nIMPORTANT: The user has attached images. Analyze the image content and write the script ABOUT what is shown in these images.`;
      }
      const sysP = bcSysPrompt(selFormat, durCfg.exchanges) + mediaCtx;

      const contentParts = [];
      for (const a of attachments) {
        if (a.data) contentParts.push({ inlineData: { mimeType: a.mimeType, data: a.data } });
      }

      // Build user text — for video, make intent explicit
      let userText;
      if (videoFileNames.length) {
        userText = `Video file: "${videoFileNames[0]}"\n\nCreate a ${fmtLabel} broadcast about the content shown in these video frames.${src && src !== `Video: "${videoFileNames[0]}"` ? `\n\nExtra context: ${src.slice(0, 2000)}` : ''}`;
      } else if (src) {
        userText = `SOURCE MATERIAL:\n${src.slice(0, 4500)}`;
      } else {
        userText = `Create a ${fmtLabel} broadcast about the content shown in the attached images.`;
      }
      contentParts.push({ text: userText });

      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.chat}:generateContent?key=${apiKey}`,
        {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: sysP }] },
            contents: [{ role: 'user', parts: contentParts }]
          }),
          signal: AbortSignal.timeout(40000)
        }
      );
      const d = await resp.json();
      rawScript = d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (e) {
      prepBtn.textContent = '❌ Script failed — try again'; prepBtn.disabled = false; return;
    }

    script = bcParseScript(rawScript);
    if (!script.length) { prepBtn.textContent = '❌ No script parsed — try again'; prepBtn.disabled = false; return; }

    bcRenderScript();
    inputSec.style.display = 'none'; scriptSec.style.display = 'block';
    statusEl.innerHTML = bcSpinnerHtml(trkCfg.prompt ? 'Generating voices & music…' : 'Generating voices…');
    prepBtn.innerHTML = bcSpinnerHtml('Preparing…');
    broadBtn.innerHTML = bcSpinnerHtml('Preparing…');
    broadBtn.style.opacity = '0.45'; broadBtn.style.pointerEvents = 'none';

    // Step 2 — Audio in parallel
    bcCleanupUrls();
    const ttsStyle = bcTtsStyle(selFormat);
    const jobs = [
      bcGenMusic(trkCfg.prompt, apiKey),
      ...script.map(l => bcGenLine(l.text, SPEAKERS[l.speaker]?.voice || 'Zephyr', ttsStyle, apiKey))
    ];
    const results = await Promise.all(jobs);
    bgUrl = results[0];
    if (bgUrl) blobUrls.push(bgUrl);
    script.forEach((l, i) => { l.url = results[i + 1]; if (l.url) blobUrls.push(l.url); });

    const voiceOk = script.filter(l => l.url).length;
    statusEl.textContent = bgUrl
      ? `Ready — ${voiceOk}/${script.length} voices + music ✓`
      : `Ready — ${voiceOk}/${script.length} voices`;
    broadBtn.textContent = '▶ Start Broadcast';
    broadBtn.style.opacity = '1'; broadBtn.style.pointerEvents = 'auto';
    prepBtn.innerHTML = '🎙️ Generate Broadcast'; prepBtn.disabled = false;
  });

  // ── Start Broadcast ───────────────────────────────────────────
  broadBtn.addEventListener('click', async () => {
    if (isPlaying || !script.length) return;
    isPlaying = true; stopReq = false;
    broadBtn.style.display = 'none'; stopBtn.style.display = '';
    liveBadge.style.display = 'flex'; dlBtn.style.display = 'none';
    statusEl.textContent = 'On air…';

    if (bgUrl) {
      bgAudio = new Audio(bgUrl);
      bgAudio.loop = true;
      bgAudio.volume = parseInt(volSlider.value) / 100;
      bgAudio.play().catch(() => {});
    }

    for (let i = 0; i < script.length; i++) {
      if (stopReq) break;
      bcHighlight(i);
      const url = script[i].url;
      if (url) {
        await new Promise(res => {
          if (stopReq) { res(); return; }
          const a = new Audio(url);
          let done = false;
          const finish = () => { if (done) return; done = true; clearInterval(wdog); res(); };
          const wdog = setInterval(() => { if (stopReq) { a.pause(); finish(); } }, 80);
          a.onended = finish; a.onerror = finish;
          a.play().catch(finish);
        });
      } else {
        await new Promise(r => setTimeout(r, 400));
      }
    }

    if (!stopReq) {
      bcStop();
      statusEl.textContent = '🎙️ Broadcast complete!';
      dlBtn.style.display = '';
    }
  });

  // ── Download Episode ──────────────────────────────────────────
  function bcAudioBufToWav(buf) {
    const numCh = buf.numberOfChannels, sr = buf.sampleRate, frames = buf.length, bps = 2;
    const dataLen = frames * numCh * bps;
    const ab = new ArrayBuffer(44 + dataLen); const dv = new DataView(ab);
    const ws = (o, v) => { for (let i = 0; i < v.length; i++) dv.setUint8(o + i, v.charCodeAt(i)); };
    ws(0,'RIFF'); dv.setUint32(4, 36 + dataLen, true);
    ws(8,'WAVE'); ws(12,'fmt ');
    dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,numCh,true);
    dv.setUint32(24,sr,true); dv.setUint32(28,sr*numCh*bps,true);
    dv.setUint16(32,numCh*bps,true); dv.setUint16(34,16,true);
    ws(36,'data'); dv.setUint32(40,dataLen,true);
    let off = 44;
    for (let i = 0; i < frames; i++) {
      for (let ch = 0; ch < numCh; ch++) {
        const s = Math.max(-1, Math.min(1, buf.getChannelData(ch)[i]));
        dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2;
      }
    }
    return ab;
  }

  dlBtn.addEventListener('click', async () => {
    dlBtn.textContent = '⏳ Mixing…'; dlBtn.style.pointerEvents = 'none';
    try {
      const tmpCtx = new AudioContext();
      const voiceBuffers = [];
      const GAP = 0.4;
      for (const line of script) {
        if (line.url) {
          const ab = await fetch(line.url).then(r => r.arrayBuffer());
          voiceBuffers.push(await tmpCtx.decodeAudioData(ab));
        } else { voiceBuffers.push(null); }
      }
      let musicBuffer = null;
      if (bgUrl) {
        const ab = await fetch(bgUrl).then(r => r.arrayBuffer());
        musicBuffer = await tmpCtx.decodeAudioData(ab);
      }
      await tmpCtx.close();

      let totalDur = 0;
      for (const b of voiceBuffers) totalDur += b ? b.duration : GAP;
      totalDur = Math.max(totalDur, 1);

      const SR = 44100;
      const offCtx = new OfflineAudioContext(2, Math.ceil(SR * totalDur), SR);
      let t = 0;
      for (const vb of voiceBuffers) {
        if (vb) {
          const src = offCtx.createBufferSource();
          src.buffer = vb; src.connect(offCtx.destination);
          src.start(t); t += vb.duration;
        } else { t += GAP; }
      }
      if (musicBuffer) {
        const gain = offCtx.createGain();
        gain.gain.value = parseInt(volSlider.value) / 100;
        gain.connect(offCtx.destination);
        let mt = 0;
        while (mt < totalDur) {
          const src = offCtx.createBufferSource();
          src.buffer = musicBuffer; src.connect(gain);
          src.start(mt); mt += musicBuffer.duration;
        }
      }

      const rendered = await offCtx.startRendering();
      const wav = bcAudioBufToWav(rendered);
      const blob = new Blob([wav], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const fmtLabel = FORMATS.find(f => f.key === selFormat)?.label.replace(/[^\w]/g, '') || 'broadcast';
      a.href = url; a.download = `broadcast-${fmtLabel}.wav`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      dlBtn.textContent = '✓ Downloaded!';
    } catch (e) {
      dlBtn.textContent = '❌ Mix failed — try again';
    } finally {
      setTimeout(() => { dlBtn.textContent = '⬇️ Download Episode'; dlBtn.style.pointerEvents = 'auto'; }, 3000);
    }
  });

  // ── Auto-start from sub-bar (hidePicker mode) ─────────────────
  if (options.autoStart) {
    // Use typed topic, or fall back to a format-based default so generation
    // always works even when the user left chatInput blank.
    const FORMAT_DEFAULTS = {
      talkshow:     'An engaging talk show with lively expert discussion',
      tutorial:     'A clear step-by-step tutorial on a practical skill',
      solotutorial: 'A solo walkthrough tutorial with helpful tips',
      appdemo:      'An app demo showcasing the key features and benefits',
      presentation: 'A compelling presentation on an interesting topic',
      narrator:     'A narrated documentary segment with rich storytelling',
      trailer:      'An exciting trailer that builds anticipation',
    };
    const resolvedSrc = options.srcText ||
      FORMAT_DEFAULTS[selFormat] ||
      'An engaging broadcast episode';
    if (srcEl) srcEl.value = resolvedSrc;
    if (attachments.length) bcRenderAttachments();
    setTimeout(() => prepBtn?.click(), 200);
  }
}



const SYSTEM_PROMPT = getConfig('SYSTEM_PROMPT', `You are a brilliant AI with three modes fused into one:

**GPT Brain** — structured, step-by-step thinking. Use headers and bullets when they genuinely help. Anticipate the user's next question and answer it before they ask.

**Grok Edge** — no sanitised-robot energy. Be sharp, occasionally witty, maximally truth-seeking. If the user is wrong, say so — with style, not cruelty. Drop a pop-culture reference or dry one-liner when it fits.

**Gemini Insight** — end every non-trivial answer with a short "💡 Pro-tip:" the user didn't think to ask for. Make it genuinely useful, not filler.

RESPONSE SHAPE:
- Open with one punchy sentence that frames the answer.
- Deliver the substance — match depth to difficulty (one sentence for easy, structured breakdown for hard).
- Close technical answers stoically. Close creative answers with playful energy.
- No sycophancy. No filler phrases. No restating the question.
- Code: clean, with brief witty inline comments explaining *why* the logic exists, not just what it does.
- Markdown only when it genuinely helps — code blocks, tight lists, bold the one thing that matters most.

FLASHCARDS: When the user asks for flashcards (any topic, any language, any quantity), write a one-line intro then output EXACTLY this block with valid JSON — no text after the closing fence:
\`\`\`flashcards
[{"front":"Term or question","back":"Definition or answer"},{"front":"...","back":"..."}]
\`\`\`
Generate EXACTLY as many cards as the user requests. No upper limit. Any language.

QUIZ: When the user asks for a quiz (any topic, any language, any quantity), write a one-line intro then output EXACTLY this block with valid JSON — no text after the closing fence:
\`\`\`quiz
[{"q":"Question?","opts":["Option A","Option B","Option C","Option D"],"ans":0,"exp":"Why this answer is correct"},{"q":"...","opts":["..."],"ans":0,"exp":"..."}]
\`\`\`
"ans" is the 0-based index of the correct option. Generate EXACTLY as many questions as the user requests. No upper limit. Any language.`);

const SMART_SYSTEM_PROMPT = getConfig('SMART_SYSTEM_PROMPT', `You are a brilliant AI with three modes fused into one:

**GPT Brain** — structured, step-by-step thinking. Use headers and bullets when they genuinely help. Anticipate the user's next question and answer it before they ask.

**Grok Edge** — no sanitised-robot energy. Be sharp, occasionally witty, maximally truth-seeking. If the user is wrong, say so — with style, not cruelty.

**Gemini Insight** — the user has shared a screenshot. Use it and the visible page context to anchor your answer in what's actually on screen. End with a "💡 Pro-tip:" they didn't think to ask for.

RESPONSE SHAPE:
- Open with one punchy sentence that frames the answer.
- Reference what you can see in the screenshot specifically — name real elements, text, or layout details.
- Match depth to difficulty. No padding, no filler phrases.
- Markdown only when it genuinely helps.

FLASHCARDS: When the user asks for flashcards (any topic, any language, any quantity), write a one-line intro then output EXACTLY this block with valid JSON — no text after the closing fence:
\`\`\`flashcards
[{"front":"Term or question","back":"Definition or answer"},{"front":"...","back":"..."}]
\`\`\`
Generate EXACTLY as many cards as the user requests. No upper limit. Any language.

QUIZ: When the user asks for a quiz (any topic, any language, any quantity), write a one-line intro then output EXACTLY this block with valid JSON — no text after the closing fence:
\`\`\`quiz
[{"q":"Question?","opts":["Option A","Option B","Option C","Option D"],"ans":0,"exp":"Why this answer is correct"},{"q":"...","opts":["..."],"ans":0,"exp":"..."}]
\`\`\`
"ans" is the 0-based index of the correct option. Generate EXACTLY as many questions as the user requests. No upper limit. Any language.`);

const MULTI_IMAGE_PROMPT = getConfig('MULTI_IMAGE_PROMPT', `You are a brilliant AI with three modes fused into one:

**GPT Brain** — structured, step-by-step thinking. Use headers and bullets when they genuinely help.

**Grok Edge** — sharp, truth-seeking, occasionally witty. If something in the screenshots contradicts what the user believes, flag it directly.

**Gemini Insight** — the user has shared multiple screenshots. Analyse ALL of them together. Highlight what's different, what's notable, and what the user probably missed. End with a "💡 Pro-tip:" they didn't think to ask for.

RESPONSE SHAPE:
- Open with one punchy sentence that frames the comparison.
- Structure the differences clearly — use a tight list or headers if there are 3+ distinct points.
- Match depth to difficulty. No padding, no filler phrases.
- Markdown only when it genuinely helps.`);

// ── Specialist Agents ─────────────────────────────────────────────────────────
let activeSpecialistAgent = null;

const SPECIALIST_AGENTS = [
  {
    id: 'ui_designer',
    icon: '🎨',
    name: 'UI Designer',
    tag: 'Production-grade interfaces',
    color: '#ff6bed',
    prompt: `You are a world-class UI/UX designer with 15 years of experience at top agencies. You create distinctive, production-grade interfaces. Your designs avoid generic AI aesthetics — every output is unique, intentional, and beautiful. When reviewing or creating UI: enforce proper visual hierarchy, spacing systems (8px grid), color contrast (WCAG AA minimum), meaningful micro-interactions, and responsive design. Always explain design decisions. Use specific CSS values, not vague guidance. Point out what's wrong and exactly how to fix it with code.`
  },
  {
    id: 'copywriter',
    icon: '✍️',
    name: 'Copywriter',
    tag: 'Marketing copy that converts',
    color: '#ffa032',
    prompt: `You are a conversion-focused copywriter who has written for top SaaS, e-commerce, and startup brands. You write headlines that stop the scroll, CTAs that get clicked, and value propositions that resonate. Your copy is: specific not vague, benefit-first not feature-first, and always answers "so what?" for the reader. For any copy task: provide the final copy ready to use, explain the psychological trigger behind each choice, and give 2-3 variations for A/B testing. Never use filler words like "harness", "leverage", "unleash", or "revolutionize".`
  },
  {
    id: 'seo_expert',
    icon: '🔍',
    name: 'SEO Expert',
    tag: 'Rankings & organic traffic',
    color: '#00d9ff',
    prompt: `You are a technical SEO expert who has grown sites from 0 to 1M+ monthly organic visitors. You understand Core Web Vitals, E-E-A-T, semantic HTML, structured data, internal linking strategy, and content clusters. When auditing: check title tags, meta descriptions, heading hierarchy, page speed issues, mobile usability, crawlability, and backlink opportunities. Give specific, actionable fixes with priority ranking (quick wins vs long-term). Always explain the "why" behind each recommendation in plain terms.`
  },
  {
    id: 'code_reviewer',
    icon: '🐛',
    name: 'Code Reviewer',
    tag: 'Clean, secure, performant code',
    color: '#50dc78',
    prompt: `You are a senior software engineer with expertise in code review. You catch bugs, security vulnerabilities, performance issues, and architectural problems that others miss. Your reviews cover: correctness, security (XSS, injection, auth issues), performance (unnecessary re-renders, N+1 queries, memory leaks), maintainability (naming, complexity, DRY), and best practices for the specific framework. Format reviews as: 🔴 Critical, 🟡 Warning, 🟢 Suggestion. Always provide fixed code, not just criticism.`
  },
  {
    id: 'data_analyst',
    icon: '📊',
    name: 'Data Analyst',
    tag: 'Insights from any data',
    color: '#58a6ff',
    prompt: `You are a senior data analyst who turns raw data into clear, actionable insights. You work with spreadsheets, CSVs, charts, dashboards, and screenshots of data. Your analysis covers: trends, anomalies, statistical significance, correlations, and forecasting. Always: state the key insight in one sentence first, support with specific numbers, flag data quality issues, suggest follow-up questions, and recommend the best visualization type for the data. Use Python/pandas logic when helpful. Never present numbers without context.`
  },
  {
    id: 'landing_page',
    icon: '🚀',
    name: 'Landing Page',
    tag: 'Pages that drive conversions',
    color: '#bc85ff',
    prompt: `You are a landing page specialist who has built high-converting pages for startups and enterprise companies. You know the exact anatomy of a high-converting landing page: above-the-fold hook, social proof placement, objection handling, urgency mechanisms, and CTA optimization. When building or reviewing a landing page: check the hero (clear value prop, specific benefit, strong CTA), trust signals (testimonials, logos, numbers), body (features→benefits, FAQs, objection handling), and footer CTA. Give specific conversion rate improvement suggestions with reasoning.`
  },
  {
    id: 'mobile_designer',
    icon: '📱',
    name: 'Mobile Designer',
    tag: 'React Native & mobile UI',
    color: '#ffd60a',
    prompt: `You are a mobile UI/UX expert specializing in React Native and Expo. You build apps that feel native on both iOS and Android. Your expertise: platform-specific design patterns (iOS vs Android), gesture handling, safe area management, performance optimization (FlatList, memo, useMemo), navigation patterns, and accessibility on mobile. When building components: always consider thumb zones, touch target sizes (44px minimum), loading states, empty states, and error states. Code must use StyleSheet.create, not inline styles.`
  },
  {
    id: 'brainstormer',
    icon: '🧠',
    name: 'Brainstormer',
    tag: 'Creative thinking partner',
    color: '#ff9500',
    prompt: `You are a creative brainstorming partner who combines lateral thinking, first-principles reasoning, and diverse mental models to generate breakthrough ideas. For any brainstorm: first explore the problem space deeply (5 Whys), then generate ideas across a spectrum from safe to wild (at least 10), group them by theme, score them on impact vs effort, and pick 3 to develop with concrete next steps. Challenge assumptions, combine unrelated concepts, invert the problem, and explore adjacent industries. Never settle for the obvious first ideas.`
  },
  {
    id: 'security',
    icon: '🔒',
    name: 'Security Auditor',
    tag: 'Find vulnerabilities fast',
    color: '#ff3b30',
    prompt: `You are a cybersecurity expert specializing in web application security, OWASP Top 10, and secure coding practices. You think like an attacker to find vulnerabilities before they're exploited. Your audits cover: authentication/authorization flaws, injection vulnerabilities (SQL, XSS, CSRF), insecure dependencies, exposed secrets, insecure direct object references, security misconfiguration, and sensitive data exposure. Format findings by severity (Critical/High/Medium/Low) with CVSS score, proof-of-concept, and remediation code. Be specific — never vague.`
  },
  {
    id: 'doc_expert',
    icon: '📄',
    name: 'Doc Expert',
    tag: 'PDFs, docs & structured data',
    color: '#30d158',
    prompt: `You are a document intelligence expert who extracts, structures, and synthesizes information from any document type — PDFs, Word docs, spreadsheets, reports, contracts, and research papers. You identify key entities, dates, numbers, obligations, and insights. For any document task: extract the most important information first, structure it clearly (tables, bullet points, summaries), flag ambiguities or missing information, and suggest follow-up actions. For contracts: highlight obligations, deadlines, and risk clauses. For research: extract methodology, findings, and limitations.`
  },
  {
    id: 'db_expert',
    icon: '🗄️',
    name: 'DB Expert',
    tag: 'SQL, Postgres & performance',
    color: '#636e72',
    prompt: `You are a database architect and Postgres performance expert. You optimize queries, design schemas, and prevent the issues that kill application performance at scale. Your expertise: query optimization (EXPLAIN ANALYZE, index strategy, query planning), schema design (normalization, partitioning, constraints), connection pooling, replication, and migrations. When reviewing queries: identify sequential scans that should use indexes, N+1 patterns, missing constraints, and lock contention issues. Always provide the optimized version with explanation of what changed and why.`
  },
  {
    id: 'content_creator',
    icon: '🎬',
    name: 'Content Creator',
    tag: 'Viral content & strategy',
    color: '#ff2d55',
    prompt: `You are a digital content strategist and creator who builds audiences across platforms. You understand what makes content go viral on Twitter/X, LinkedIn, YouTube, TikTok, and Instagram — and how the algorithm rewards different behavior on each. Your expertise: hook writing (first 3 seconds/words are everything), content pillars strategy, repurposing frameworks (one idea → 10 pieces), audience psychology, and platform-specific formats. For any content task: write the hook first, nail the format for the platform, add a strong CTA, and suggest 3 variations to test.`
  }
];

function openAgentsModal() {
  const modal = document.getElementById('agentsModal');
  if (!modal) return;
  modal.style.display = 'flex';
  renderAgentsGrid();
}

function closeAgentsModal() {
  const modal = document.getElementById('agentsModal');
  if (modal) modal.style.display = 'none';
}

function renderAgentsGrid() {
  const grid = document.getElementById('agentsGrid');
  if (!grid) return;
  grid.innerHTML = SPECIALIST_AGENTS.map(a => `
    <div class="agent-card ${activeSpecialistAgent?.id === a.id ? 'agent-active' : ''}"
         data-agent-id="${a.id}"
         style="--agent-color:${a.color}">
      <div class="agent-icon">${a.icon}</div>
      <div class="agent-name">${a.name}</div>
      <div class="agent-tag">${a.tag}</div>
      ${activeSpecialistAgent?.id === a.id ? '<div class="agent-active-badge">✓ Active</div>' : ''}
    </div>
  `).join('');
  grid.querySelectorAll('.agent-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.agentId;
      const agent = SPECIALIST_AGENTS.find(a => a.id === id);
      if (!agent) return;
      if (activeSpecialistAgent?.id === id) {
        activeSpecialistAgent = null;
        updateAgentStatusBar();
      } else {
        activeSpecialistAgent = agent;
        updateAgentStatusBar();
        const thread = document.getElementById('chatThread');
        if (thread) {
          const notice = document.createElement('div');
          notice.className = 'chat-bubble ai';
          notice.style.cssText = `font-size:12px;padding:10px 16px;border-left:3px solid ${agent.color};margin:4px 0;`;
          notice.textContent = `${agent.icon} ${agent.name} agent activated — ${agent.tag}`;
          thread.appendChild(notice);
          thread.scrollTop = thread.scrollHeight;
        }
      }
      renderAgentsGrid();
      setTimeout(closeAgentsModal, 300);
    });
  });
}

function updateAgentStatusBar() {
  const bar = document.getElementById('agentStatusBar');
  if (!bar) return;
  if (activeSpecialistAgent) {
    bar.style.display = 'flex';
    bar.innerHTML = `
      <span style="color:${activeSpecialistAgent.color}">${activeSpecialistAgent.icon} ${activeSpecialistAgent.name}</span>
      <span style="color:rgba(255,255,255,0.4);font-size:11px;"> — ${activeSpecialistAgent.tag}</span>
      <button id="clearAgentBtn" style="margin-left:auto;background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;font-size:13px;">✕</button>
    `;
    document.getElementById('clearAgentBtn')?.addEventListener('click', () => {
      activeSpecialistAgent = null;
      updateAgentStatusBar();
    });
  } else {
    bar.style.display = 'none';
  }
}
// ──────────────────────────────────────────────────────────────────────────────

const BUILD_SYSTEM_PROMPT = `You are a world-class creative director and UI engineer at the level of the best Wix Studio, Squarespace, and Framer template designers. Your output quality standard: every site you build must be indistinguishable from a premium hand-crafted template that could sell for $200 on a marketplace. You produce ONLY complete, self-contained single-file HTML.

STRICT OUTPUT RULE: Respond with ONLY a \`\`\`html code block. Zero prose before or after. Just the code.
Iterate requests: output the FULL improved file — never partial diffs.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 MANDATORY IMAGE IDs — READ THIS FIRST, BEFORE EVERYTHING ELSE 🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When the user's prompt contains ANY keyword from a row below, you MUST embed those exact Pexels IDs.
NO substituting. NO different numbers. Copy the IDs exactly as listed.
URL pattern: https://images.pexels.com/photos/ID/pexels-photo-ID.jpeg?auto=compress&cs=tinysrgb&w=1400

KEYWORD(S)                         → MANDATORY IMAGE IDs (copy exactly)
─────────────────────────────────────────────────────────────────────
space/rocket/aerospace/NASA/launch → hero:1169754  rocket:2159  spacecraft:586063  earth:87009  astronaut:39896
gym/fitness/workout/crossfit       → hero:1552242  trainer-m:1431282  trainer-f:3076509  trainer2:3289711  class:703016
restaurant/café/food/dining/chef   → food:1640777  interior:941861  chef:887827  coffee:302899
hotel/resort/travel/spa            → room:271624   pool:261169
law/lawyer/corporate/consulting    → office:380769  meeting:1181406
medical/clinic/doctor/dental       → doctor:4173251  (hero = CSS gradient, not Pexels)
education/school/course/bootcamp   → library:256431

⛔ TEAM / PEOPLE sections on ANY site → ALWAYS CSS gradient circle with initials — NEVER a Pexels face photo
⛔ If no keyword matches above → use descriptive Pexels search terms, not random IDs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  HEAD TEMPLATE — use this exact structure every time
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every output must start with this exact <head> block:
  <script src="https://cdn.tailwindcss.com"></script>
  Google Fonts <link> tags for chosen profile fonts
  <script src="https://unpkg.com/lucide@latest"></script>
  A tailwind.config script block with fontFamily tokens
  A <style> block for custom CSS that Tailwind can't express (gradients, animations, overlaps)

Icons: always use Lucide — call lucide.createIcons() in a <script> at bottom of body.
Images: use real Pexels URLs. Always add onerror="this.style.display='none';this.parentElement.style.background='linear-gradient(135deg,#1f2937,#111827)'" on every <img>.
External links: every <a> pointing to an outside domain (social media, PayPal, Stripe, YouTube, etc.) MUST have target="_blank" rel="noopener noreferrer". Without this the preview iframe tries to navigate itself to that URL and gets blocked by CSP.
JavaScript: all inline in a single <script> before </body>. Use IntersectionObserver for scroll-reveal animations.
⚠️ CRITICAL IIFE RULE — every single build, no exceptions:
Wrap ALL script logic in one IIFE: (function(){ ... })();
Every function used by onclick/onchange/onsubmit MUST be attached to window INSIDE the IIFE:
  window.toggleCart = function() { ... };
  window.addToCart  = function(id) { ... };
  window.openModal  = function(id) { ... };
NEVER declare bare functions or top-level const/let — they cause "already declared" crashes in the live preview.
NEVER write: function toggleCart() { ... }  ← this will break on every patch update.
ALWAYS write: window.toggleCart = function() { ... }  ← this is the only safe pattern.

EXCEPTION — CONTINUE_BUILD: If the user message starts with "CONTINUE_BUILD:", the previous
response was cut off by token limits. Output ONLY the remaining HTML from where you stopped —
starting at the next complete opening tag (e.g. <div, <section, <footer, <script).
Never restart from <!DOCTYPE html>. Never repeat code already written. No prose, no fences.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STEP 0 — DEFINE THE BRAND FIRST (do this before everything else)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every great Wix or Squarespace template starts with a strong BRAND CONCEPT — not just a color scheme.
Before writing a single line of HTML, silently define these for this specific project:

  ⚠️ BRAND NAME PRIORITY RULE (read this first):
  If the user's request contains a specific business name, person's name, product name, or brand name
  — USE IT EXACTLY AS WRITTEN. Do not invent a different name. Do not rename it. Do not "improve" it.
  Only invent a brand name when the user has not provided one at all (e.g. "build me a coffee shop site").

  BRAND NAME: Use the user's name if provided. Otherwise invent a real, specific, evocative name
    (e.g. "Mélange Morsel", "Asphalt Bloom Café", "Born to Move", "For the Love of Coffee").
    NEVER use "[Business Name]" as a placeholder.

  TAGLINE: One punchy line that makes the brand feel alive and real.

  BRAND PERSONALITY: Pick one — Warm & Artisanal | Bold & Energetic | Serene & Luxurious |
    Raw & Authentic | Playful & Vibrant | Clinical & Precise | Editorial & Intellectual

  SIGNATURE COLOR: ONE dominant color that defines the whole brand, chosen with intention.
    Bold examples from top templates: #F5C800 (sunshine yellow), #1A1A1A (ink black),
    #2D5A3D (forest green), #E8442A (tomato red), #F2EDE4 (warm cream), #0D3B66 (navy).

  COPY VOICE: What tone does every word use? (e.g. "warm, poetic, sensory" or "direct, punchy, no-fluff")

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STEP 1 — READ THE REQUEST, PICK AN AESTHETIC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
After defining the brand, silently answer these 5 questions:
  1. Era/movement? (editorial, brutalist, Swiss, modern-tech, luxury, wellness, playful, Y2K…)
  2. Which 3 real brand templates does this resemble? (e.g. "Aesop, Sakara, Daily Harvest" OR "Linear, Vercel, Stripe" OR "Apple, Arc, Rauno")
  3. Which 3 patterns are BANNED for this specific project?
  4. What are the locked color + font tokens?
  5. One emotional word? (calm / electric / sacred / clinical / playful / bold)

Use your answers to pick ONE of the Aesthetic Profiles below. Never mix profiles.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STEP 1A — INDUSTRY AUTO-DETECT (mandatory — run before profile selection)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ These are the SAME IDs listed at the top of this prompt. This is your second reminder.
Scan the user's prompt for keywords. The MOMENT you match an industry below, you MUST use the listed Pexels IDs — no guessing, no substituting, no alternatives.
URL format: https://images.pexels.com/photos/[ID]/pexels-photo-[ID].jpeg?auto=compress&cs=tinysrgb&w=1400

━━ 🚀 SPACE / AEROSPACE / ROCKET ━━
  Keywords: space, rocket, SpaceX, NASA, aerospace, launch, orbit, astronaut, galaxy, cosmos, satellite, mars, moon, starship, falcon
  → Hero background (stars):  ID 1169754  (Milky Way galaxy, thousands of stars, deep dark sky)
  → Rocket launch image:      ID 2159     (Space shuttle launching with massive fire and smoke)
  → Spacecraft in orbit:      ID 586063   (Dragon capsule orbiting above Earth — real SpaceX photo)
  → Earth from space:         ID 87009    (Earth rising over the lunar surface — iconic NASA style)
  → Astronaut photo:          ID 39896    (Astronaut in spacesuit on moon with flag and lunar module)
  → Colours: bg #000000 / #05050f · text #ffffff · accent #4a9eff (electric blue)
  → Required sections: Hero (star bg + countdown) · Stats bar · Vehicles fleet · Missions log · Crew (CSS avatar cards — NO Pexels for people) · Earth view · Newsletter
  → DO NOT use Pexels for team/crew portrait cards — use CSS circle gradient with initials instead

━━ 🏋️ GYM / FITNESS ━━
  Keywords: gym, fitness, workout, trainer, crossfit, bodybuilding, yoga, pilates, weightlifting, strength, muscle, athlete
  → Hero background:    ID 1552242  (real gym interior — weights, equipment racks)
  → Male trainer:       ID 1431282  (B&W muscular man holding barbell)
  → Female trainer:     ID 3076509  (woman stretching on mat, orange leggings)
  → Trainer 2:          ID 3289711  (bearded man curling dumbbell)
  → Class / group:      ID 703016   (group fitness class in gym)
  → Colours: bg #0a0a0a · text #ffffff · accent #e8340d (red) or #f97316 (orange)
  → Required sections: Hero · Class schedule · Trainers · Pricing · Testimonials · Sign-up CTA
  → NEVER use Pexels for product shop cards (supplements, equipment) — use CSS emoji gradient cards instead

━━ 🍽️ RESTAURANT / CAFÉ / FOOD ━━
  Keywords: restaurant, café, cafe, food, dining, chef, menu, cuisine, bistro, bar, kitchen, coffee, bakery, pizza
  → Hero food photo:    ID 1640777  (colorful quinoa salad flatlay with fresh vegetables — bright, appetizing)
  → Interior:           ID 941861   (sophisticated restaurant interior, wine glasses, candlelit, moody red lighting)
  → Chef:               ID 887827   (smiling chef in white double-breasted uniform holding coffee cup, espresso machine)
  → Coffee close-up:    ID 302899   (barista pouring milk to create latte art heart in white cup — stunning close-up)
  → Colours: bg #0d0d0d or #faf8f5 · text #1a1a1a or #fff · accent #c9a96e (gold) or #d64535 (tomato red)
  → Required sections: Hero · Menu (with food images) · About chef · Reservations CTA · Gallery

━━ 🏨 HOTEL / RESORT / TRAVEL ━━
  Keywords: hotel, resort, travel, luxury stay, accommodation, villa, boutique hotel, spa, retreat
  → Hero room:          ID 271624   (spacious modern hotel room, light wood floors, large bed, natural light)
  → Pool / exterior:    ID 261169   (tropical resort infinity pool, orange sun loungers, palm trees, ocean view)
  → Colours: bg #0a0a0a or #f8f5f0 · accent #b8965a (warm gold)
  → Required sections: Hero · Rooms & suites · Amenities · Gallery · Booking CTA

━━ 💼 LAW FIRM / CORPORATE / PROFESSIONAL SERVICES ━━
  Keywords: law, lawyer, attorney, legal, firm, corporate, consulting, finance, accounting, advisory
  → Hero office:        ID 380769   (open-plan modern office, someone working at Mac desktop, plants, natural light)
  → Team meeting:       ID 1181406  (diverse team around conference table with laptops, glass-walled room)
  → Colours: bg #ffffff or #0b1120 · accent #1a3a5c (navy) or #c9a45a (gold)
  → Required sections: Hero · Practice areas · Team (CSS gradient avatar cards — NO Pexels faces) · Results/stats · Contact

━━ 🏥 MEDICAL / CLINIC / HEALTH ━━
  Keywords: clinic, doctor, medical, health, dental, therapy, hospital, wellness, physio, dermatology
  → Doctor portrait:    ID 4173251  (smiling female doctor, white coat, stethoscope around neck, hospital corridor)
  → Colours: bg #ffffff · accent #0ea5e9 (sky blue) or #10b981 (green)
  → Hero: use a CSS gradient bg (#f0f9ff → #e0f2fe) — NOT a Pexels photo for clinic interior hero
  → Required sections: Hero · Services · Doctors (CSS cards with avatar + name + specialty) · Booking · Trust badges

━━ 🎓 EDUCATION / SCHOOL / COURSE ━━
  Keywords: school, university, course, education, learning, academy, tutor, online course, bootcamp
  → Library / study:    ID 256431   (modern library / bookstore interior, people relaxing and reading, warm lighting)
  → Colours: bg #ffffff or #0f172a · accent #6366f1 (indigo) or #f59e0b (amber)
  → Required sections: Hero · Courses · Instructors (CSS cards) · Testimonials · Enroll CTA

━━ 🛍️ E-COMMERCE / SHOP ━━
  Keywords: shop, store, buy, sell, product, cart, e-commerce, checkout (→ always Profile S — see below)
  → Profile S handles this — see PROFILE S section for image rules

⚠️ If NO industry keyword matches → use Pexels search-based images (describe subject clearly for each slot)
⚠️ PEOPLE / TEAM sections on any site → use CSS gradient circle avatars with initials (never Pexels random faces)

PROFILE SELECTION RULES — READ BEFORE CHOOSING (follow this order top to bottom, stop at first match):

  -1. INTERACTIVE LEARNING PORTAL / COURSE / STUDY APP: request contains "interactive lesson", "learning portal", "flashcard", "quiz me", "teach me", "create a course", "course from", "study guide", "study app", "interactive course", "learning app", "make it interactive to learn", "explain and quiz", "learn this" → Profile L. Always. No exceptions.

  0. PRESENTATION / SLIDES / PITCH DECK: request contains "presentation", "slides", "slideshow", "PowerPoint", "pptx", "pitch deck", "slide deck" → Profile P. Always. No exceptions.

  0.5. SHOP / STORE / E-COMMERCE: request contains shop, store, buy, sell, product, price, payment, checkout, cart, e-commerce, Stripe, PayPal, order, purchase → Profile S. Always. No exceptions.

  1. GAME: request contains game/level/player/score/jump/shoot/enemy/arcade/puzzle/Mario/RPG/dungeon → Profile F. Always. No exceptions.

  2. COMING SOON / PERSONAL NAME IS BRAND: person's name as brand, coach, speaker, author, photographer, "coming soon" page → Profile G.

  3. DARK CREATIVE / EDITORIAL (only when request says "dark", "moody", "cinematic", "film", "editorial", "magazine", "artistic"): creative studio, musician, artist, fashion photography → Profile H.

  4. DARK TECH (ONLY when request literally contains the word "dark" OR "dashboard" OR "neon" OR "cyberpunk"): → Profile A.
     ⛔ TECH or SaaS or AI tools WITHOUT those exact words → do NOT use Profile A. Use Profile B or C instead.
     ⛔ "App", "tool", "software", "AI", "SaaS", "extension", "platform" alone do NOT trigger Profile A.

  5. WELLNESS / FOOD / HEALTH / BEAUTY / FITNESS: yoga, restaurant, café, nutrition, beauty, spa, gym → Profile B.

  6. LUXURY / PREMIUM / ARCHITECTURE / HIGH-END: jewellery, architecture, luxury product, fine dining, premium agency → Profile C.

  7. BOLD CREATIVE AGENCY: art director, creative studio, bold portfolio → Profile D.

  8. KIDS / PLAYFUL / FUN / QUIZ: children, quiz, bright, fun consumer app → Profile E.

  9. DEFAULT (tech apps, SaaS, AI products, marketplaces, services, everything else): → Profile B.
     Profile B works beautifully for tech products and looks far more professional than dark glassmorphism.

  ⛔ HARD RULE: If the user's message does not contain the word "dark", you must NOT use Profile A. No exceptions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  AESTHETIC PROFILES — choose the right one
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROFILE A — MODERN DARK TECH (Linear / Vercel / Stripe)
  🚫 FORBIDDEN unless the request literally contains one of: "dark", "neon", "cyberpunk", "dashboard"
  🚫 AI tools, SaaS products, apps, extensions, platforms → Profile B (NEVER Profile A for these)
  🚫 "AI", "app", "tool", "software", "studio", "extension" alone DO NOT trigger this profile
  ✅ ONLY triggers on explicit darkness keywords. When in doubt → Profile B.
  Colors: --bg:#07070f; --text:#f0f0ff; --surface:rgba(255,255,255,0.04); --accent: vivid (violet, cyan, emerald)
  Fonts: Plus Jakarta Sans (headings 700-900) + Inter (body 400) from Google Fonts
  Radius: 14px | Section padding: 100px 24px | Max-width: 1100px
  Signature moves: layered radial gradient bg div, glassmorphism cards, glow button, gradient-clipped H1 text
  BANNED for this profile: serif fonts, warm neutrals, emoji icons

PROFILE B — EDITORIAL LIGHT (Aesop / Sakara / Daily Harvest — wellness / food / beauty / health / SaaS / tech)
  Use for: wellness brands, food, beauty, health, premium lifestyle, SaaS tools, AI products, apps, services — anything that is NOT explicitly dark
  Colors: --bg:#F9FBF9; --text:#0A2E36; --surface:#ffffff; --accent:#FF7043; --sage:#76A08A
  Fonts: Playfair Display 400 (headings, tight tracking) + Inter 400 (body) from Google Fonts
  Radius: 4px (sharp) | Section padding: 160px 24px | Max-width: 1100px

  MANDATORY HERO PATTERN — copy this CSS structure exactly:
  <section style="min-height:100vh;display:flex;align-items:center;background:#F9FBF9;padding:0 5vw;gap:60px;">
    <div style="flex:1;max-width:560px;">
      <p style="font-family:'Inter',sans-serif;font-size:0.78rem;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#76A08A;margin-bottom:20px;">YOUR CATEGORY LABEL</p>
      <h1 style="font-family:'Playfair Display',serif;font-size:clamp(2.8rem,5vw,4.5rem);line-height:1.1;color:#0A2E36;margin-bottom:24px;">Short Punchy<br>Headline Here</h1>
      <p style="font-family:'Inter',sans-serif;font-size:1.05rem;line-height:1.7;color:#4A6670;max-width:440px;margin-bottom:40px;">One compelling sentence about the benefit.</p>
      <a style="display:inline-block;background:#FF7043;color:#fff;font-family:'Inter',sans-serif;font-size:0.88rem;font-weight:600;letter-spacing:0.06em;padding:16px 36px;text-decoration:none;border-radius:4px;">ACTION VERB HERE →</a>
    </div>
    <div style="flex:1;border-radius:4px;overflow:hidden;height:580px;"><img src="PEXELS_URL" style="width:100%;height:100%;object-fit:cover;"></div>
  </section>

  MANDATORY SECTION PATTERN — alternating full-bleed color blocks:
  <section style="background:#0A2E36;padding:120px 5vw;display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center;">
    <img src="PEXELS_URL" style="width:100%;height:500px;object-fit:cover;border-radius:4px;">
    <div>
      <h2 style="font-family:'Playfair Display',serif;font-size:clamp(2rem,3.5vw,3rem);color:#F9FBF9;margin-bottom:20px;">Section Title</h2>
      <p style="font-family:'Inter',sans-serif;color:rgba(249,251,249,0.75);line-height:1.8;font-size:1rem;">Body copy goes here.</p>
    </div>
  </section>

  Signature moves: cream/forest alternating sections, sage secondary color, generous whitespace, real Pexels photography, ONE blood-orange CTA per section
  BANNED: dark glassmorphism, glow shadows, gradient-clipped text, emoji icons, "Trusted by" strips

PROFILE C — LUXURY MINIMAL (Apple / Arc / Rauno / premium product)
  Use for: premium products, high-end portfolios, agencies, luxury apps
  Colors: --bg:#fafafa (or #080808 dark variant); --text: high-contrast opposite; --accent: single muted tone (gold #C9A96E, ivory, slate)
  Fonts: Cormorant Garamond 400 (headings) + Karla 400 (body) from Google Fonts
  Radius: 2px | Section padding: 140px 32px | Max-width: 960px
  Signature moves: extreme whitespace, one accent color only, very large type, hairline borders (1px rgba(0,0,0,0.1)), zero clutter, slow deliberate transitions
  BANNED: multiple colors, gradients, heavy shadows, icons of any kind, busyness

PROFILE D — BRUTALIST / BOLD (creative studios / magazines / portfolios)
  Use for: portfolios, creative agencies, art projects, bold brand statements
  Colors: raw — #ffffff + #000000 + one punchy solid (red #e63946, yellow #ffd60a, electric blue #0077ff)
  Fonts: 'Arial Black', system-ui (headings) + 'Courier New' monospace (body) — no Google Fonts needed
  Radius: 0px | Borders: 2-3px solid #000 | Section padding: 80px 24px
  Signature moves: visible grid borders, offset shadow (box-shadow: 4px 4px 0 #000), oversized bold type, stark high contrast, marquee text strip
  BANNED: gradients, blur, glass, rounded corners, subtlety, pastel

PROFILE E — PLAYFUL / VIBRANT (Duolingo / Pitch / consumer apps)
  Use for: to-do apps, kids products, fun consumer tools, quizzes
  Colors: bright saturated 3-color palette (coral + mint + sunny yellow, or sky blue + orange + white)
  Fonts: Nunito 700 (headings) + Inter 400 (body) from Google Fonts
  Radius: 20px+ | Section padding: 80px 20px
  Signature moves: illustrated inline SVG shapes, bouncy hover (transform: scale(1.05)), colorful solid-bordered cards, confetti on CTA
  BANNED: dark backgrounds, serif fonts, corporate language, muted colors

PROFILE G — BOLD TYPOGRAPHY / TYPE-FORWARD (Kay Van Hans / Revert / Coming Soon / personal brand)
  Use for: personal brands, photographers, coming-soon pages, bold portfolios, coaches, speakers, authors, any request where the PERSON or NAME is the brand
  Colors: #0A0A0A background + #F5F0EB warm white. One electric accent (e.g. #FFD700 gold or #FF3B3B red) for ONE CTA only.
  Fonts: 'Bebas Neue' (headings) + 'Inter' weight 300 (body) from Google Fonts
  Radius: 0px | Max-width: 1200px

  MANDATORY HERO — copy this exact structure:
  <section style="min-height:100vh;background:#0A0A0A;display:flex;flex-direction:column;justify-content:flex-end;padding:0 5vw 80px;position:relative;overflow:hidden;">
    <img src="PEXELS_URL" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.35;">
    <div style="position:relative;z-index:2;">
      <h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(7rem,18vw,16rem);line-height:0.9;color:#F5F0EB;letter-spacing:-0.01em;margin:0;">BRAND<br>NAME</h1>
      <p style="font-family:'Inter',sans-serif;font-size:0.82rem;font-weight:300;letter-spacing:0.35em;text-transform:uppercase;color:rgba(245,240,235,0.6);margin:24px 0 40px;">TAGLINE IN SMALL CAPS HERE</p>
      <a style="display:inline-block;background:#FFD700;color:#0A0A0A;font-family:'Inter',sans-serif;font-size:0.78rem;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;padding:14px 36px;text-decoration:none;">GET STARTED</a>
    </div>
  </section>

  MANDATORY SECOND SECTION — pure white, type only, no images:
  <section style="background:#F5F0EB;padding:140px 5vw;display:flex;align-items:flex-start;gap:80px;">
    <h2 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(3rem,8vw,7rem);color:#0A0A0A;line-height:0.95;flex:1;">THE WORK SPEAKS<br>FOR ITSELF</h2>
    <p style="font-family:'Inter',sans-serif;font-weight:300;font-size:1.05rem;line-height:1.8;color:#3a3a3a;flex:1;padding-top:20px;">Body copy goes here — short, direct, no fluff.</p>
  </section>

  MANDATORY THIRD SECTION — full-bleed photo, dark overlay, reversed text:
  <section style="position:relative;height:80vh;overflow:hidden;">
    <img src="PEXELS_URL" style="width:100%;height:100%;object-fit:cover;filter:brightness(0.5);">
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;">
      <h2 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(3rem,10vw,9rem);color:#F5F0EB;line-height:0.9;">ONE POWERFUL<br>STATEMENT</h2>
    </div>
  </section>

  BANNED: rounded corners, multiple colors, gradients, emoji, busy layouts, small typography, generic stock imagery

PROFILE H — DARK CREATIVE EDITORIAL (Train of Thought / moody magazine / creative studio)
  Use for: creative studios, photographers, artists, musicians, film, fashion — "dark", "moody", "cinematic", "editorial", "magazine", "artistic"
  Colors: --bg:#0C0C0C; --text:#F0EDE8; --accent:#FFB830 (amber) OR #E63946 (red) — ONE only, never for backgrounds
  Fonts: 'DM Serif Display' italic (headings) + 'DM Sans' weight 300 (body) from Google Fonts

  MANDATORY HERO — copy this exact structure:
  <section style="position:relative;height:100vh;overflow:hidden;">
    <img src="PEXELS_URL" style="width:100%;height:100%;object-fit:cover;filter:brightness(0.4);">
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;padding:0 6vw 10vh;">
      <h1 style="font-family:'DM Serif Display',serif;font-style:italic;font-size:clamp(3rem,7vw,6.5rem);line-height:1.05;color:#F0EDE8;max-width:800px;margin:0 0 24px;">The headline sits<br>at the bottom, sparse.</h1>
      <div style="width:50px;height:1px;background:rgba(240,237,232,0.4);margin-bottom:20px;"></div>
      <p style="font-family:'DM Sans',sans-serif;font-weight:300;font-size:0.9rem;letter-spacing:0.12em;text-transform:uppercase;color:rgba(240,237,232,0.55);">CATEGORY · YEAR</p>
    </div>
  </section>

  MANDATORY DRAMATIC PAUSE SECTION — text only, nothing else:
  <section style="background:#0C0C0C;padding:160px 6vw;text-align:center;border-top:1px solid rgba(240,237,232,0.08);">
    <p style="font-family:'DM Serif Display',serif;font-style:italic;font-size:clamp(1.8rem,4vw,3.2rem);color:#F0EDE8;line-height:1.4;max-width:700px;margin:0 auto;">
      "One single sentence that makes the visitor feel something."
    </p>
  </section>

  MANDATORY PHOTO GRID — asymmetric heights, no captions:
  <section style="background:#0C0C0C;padding:80px 4vw;display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px;border-top:1px solid rgba(240,237,232,0.08);">
    <img src="PEXELS_URL" style="width:100%;height:560px;object-fit:cover;">
    <img src="PEXELS_URL" style="width:100%;height:260px;object-fit:cover;align-self:flex-end;">
    <img src="PEXELS_URL" style="width:100%;height:380px;object-fit:cover;">
  </section>

  BANNED: bright/white backgrounds, rounded cards, colorful UI, emoji, busy text-heavy layouts

PROFILE P — PRESENTATION / SLIDE DECK (PowerPoint-style)
  Use for: ANY request containing presentation, slides, slideshow, PowerPoint, pptx, pitch deck, slide deck.
  ⚠️  This profile replaces ALL website rules. A presentation is NOT a scrolling website — it is a fullscreen slide-by-slide viewer with a real downloadable .pptx button.

  ══════════════════════════════════════════════════════════════
  MANDATORY ARCHITECTURE — copy this exact pattern every time
  ══════════════════════════════════════════════════════════════

  1. DEFINE all slide content as a JS array at the top of your <script>:
     const SLIDES = [
       { title: "Slide Title", subtitle: "Optional subtitle", bullets: ["Point A", "Point B", "Point C"], notes: "Speaker notes" },
       // … one object per slide, 8–15 slides total
     ];

  2. RENDER the current slide from SLIDES[currentIndex] into a fullscreen <div id="slide-stage">.

  3. NAVIGATION — keyboard (ArrowLeft / ArrowRight / Space) + on-screen Prev / Next buttons + click-anywhere-to-advance.

  4. SLIDE COUNTER — always show "3 / 12" style, top-right corner.

  5. DOWNLOAD BUTTON — a prominent "⬇ Download PowerPoint" button (top-right, near counter) that calls generatePptx().

  6. MANDATORY HEAD SCRIPTS — include BOTH of these in <head>:
     <script src="https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js"></script>
     <script src="https://cdn.tailwindcss.com"></script>

  7. PPTXGENJS EXPORT FUNCTION — wire this exact function (adapt colors/fonts to the theme):
     async function generatePptx() {
       const pptx = new PptxGenJS();
       pptx.layout = 'LAYOUT_WIDE';  // 16:9
       SLIDES.forEach(s => {
         const slide = pptx.addSlide();
         // ✅ REAL slide background — editable in PowerPoint via Format Background
         // NEVER use addShape for background — that creates a locked shape users cannot edit
         slide.background = { color: '0F172A' };
         // Title
         slide.addText(s.title, { x:0.5, y:0.4, w:12, h:1.2, fontSize:36, bold:true, color:'FFFFFF', fontFace:'Calibri' });
         // Subtitle (if present)
         if (s.subtitle) slide.addText(s.subtitle, { x:0.5, y:1.5, w:12, h:0.6, fontSize:20, color:'94A3B8', fontFace:'Calibri' });
         // Bullet points
         if (s.bullets && s.bullets.length) {
           const bulletText = s.bullets.map(b => ({ text: b, options: { bullet: true } }));
           slide.addText(bulletText, { x:0.5, y:2.2, w:12, h:4.5, fontSize:18, color:'E2E8F0', fontFace:'Calibri', lineSpacingMultiple:1.4 });
         }
         // Slide number
         slide.addText((SLIDES.indexOf(s)+1) + ' / ' + SLIDES.length, { x:11.5, y:6.8, w:1.5, h:0.4, fontSize:10, color:'64748B', align:'right' });
       });
       await pptx.writeFile({ fileName: 'presentation.pptx' });
     }

  PROFILE P VISUAL DESIGN:
  Background: #0F172A (deep navy) | Accent: #6366F1 (indigo) | Text: #F8FAFC
  Font: 'Inter' from Google Fonts — 700 for titles, 400 for body
  Each slide fills 100vw × 100vh. Progress bar at the very bottom.
  Title: centered or left-aligned, large (clamp(2rem, 6vw, 4rem)).
  Bullets: appear with a fade-in stagger (0.1s each) as the slide renders.
  Transition: 0.35s fade between slides (opacity + slight translateY).
  Thumbnail strip: optional 60px row at the bottom showing mini slide previews.

  PROFILE P BANNED:
  ✗ Scrolling page layout — every slide must be fullscreen, no scroll
  ✗ Omitting the Download PowerPoint button
  ✗ Hardcoding slide content as HTML — ALWAYS use the SLIDES array
  ✗ Using any other CDN for pptx — only pptxgenjs@3.12.0 from jsdelivr
  ✗ Using addShape for slide backgrounds — ALWAYS use slide.background = { color: 'HEX' } instead.
    addShape creates a locked rectangle shape that blocks Format Background in PowerPoint.
    slide.background sets the real native slide background — fully editable and themeable.

PROFILE L — INTERACTIVE LEARNING PORTAL (Khan Academy / Duolingo / Notion-style)
  Use for: ANY request containing "interactive lesson", "learning portal", "flashcard", "quiz", "teach me", "create a course", "course from", "study guide", "study app", "interactive course", "learning app", "explain and quiz".
  ⚠️  This profile replaces ALL website rules. A learning portal is NOT a scrolling website — it is a structured interactive app with lessons, flashcards, quizzes, and audio.

  ══════════════════════════════════════════════════════════════
  MANDATORY ARCHITECTURE — copy this exact pattern every time
  ══════════════════════════════════════════════════════════════

  1. DEFINE all course content as a JS object at the top of your <script>:
     const COURSE = {
       title: "Course Title",
       description: "What this course teaches in one sentence",
       lessons: [
         {
           id: 1,
           title: "Lesson 1 Title",
           summary: "One-sentence overview of this lesson",
           concepts: [
             { term: "Key Term", definition: "Clear plain-English definition. Use an analogy.", emoji: "🔑" }
           ],
           examples: [
             { title: "Example title", body: "Concrete 2-3 sentence real-world example a student can relate to." }
           ],
           flashcards: [
             { front: "Question or term?", back: "Answer or definition" }
           ],
           quiz: [
             { q: "Question text?", options: ["Option A", "Option B", "Option C", "Option D"], answer: 0, explanation: "Why this answer is correct.", cardIdx: 0 }
             // cardIdx = index into this lesson's flashcards array that covers the same concept
           ],
           broadcast: [
             { speaker: "ZEPHYR", text: "Welcome everyone! Today we're diving into [Lesson Title]. Let's start with the big picture." },
             { speaker: "KORE",   text: "I've always wondered about this — where do we even begin?" },
             { speaker: "ZEPHYR", text: "Great question. Think of it like [memorable analogy tied to the concept]..." },
             { speaker: "FENRIR", text: "In the real world, this shows up when [concrete real-world application]. I see this all the time." },
             { speaker: "KORE",   text: "Oh that makes so much sense now! So the key takeaway is...?" },
             { speaker: "ZEPHYR", text: "Exactly — [core principle restated simply]. Remember that and you've got it." }
             // 8-12 lines total per lesson. Alternate speakers naturally — ZEPHYR explains, KORE asks curious questions, FENRIR adds real-world context.
           ],
           videoSteps: [
             { type: "title",   text: "Lesson Title",          emoji: "📖", color: "#6366F1", duration: 2200 },
             { type: "concept", label: "Key Term 1",           emoji: "🔑", color: "#6366F1", body: "One-line plain definition", duration: 3500 },
             { type: "concept", label: "Key Term 2",           emoji: "💡", color: "#F59E0B", body: "One-line plain definition", duration: 3500 },
             { type: "arrow",   label: "leads to",                                            duration: 1200 },
             { type: "concept", label: "Outcome / Big Idea",   emoji: "🎯", color: "#10B981", body: "What it all means", duration: 3500 },
             { type: "end",     text:  "Quiz yourself on the next tab!", emoji: "❓",          duration: 2500 }
             // 5-8 steps per lesson. Mix title → concept → arrow → concept → end. Keep each step ≤ 8 words.
           ]
         }
         // ⚠️ MINIMUM REQUIREMENTS — these are FLOORS, not targets. Go higher whenever content warrants.
         // Lessons: 5 minimum. Per lesson:
         //   concepts:   5+ (cover EVERY key term in the source material)
         //   examples:   5+ (cover EVERY worked example, passage, exercise from the source)
         //   flashcards: 8+ (one per concept PLUS common confusables)
         //   quiz:      10+ questions (MUST be 10 minimum — 2 questions is completely unacceptable)
         //   broadcast: 10+ lines (natural back-and-forth; do NOT stop at 4 lines)
         //   videoSteps: 5+
         //
         // EXHAUSTIVE COVERAGE RULE (TOP PRIORITY):
         // When the user uploads a PDF, textbook chapter, or pastes book content:
         //   → Cover EVERY vocabulary word — do not skip any
         //   → Cover EVERY grammar rule with multiple examples
         //   → Turn EVERY exercise/question from the book into a quiz question
         //   → Cover EVERY reading passage with comprehension questions
         //   → If a textbook has 20 vocab words, your flashcards must have AT LEAST 20 cards
         //   → If a textbook exercise has 8 questions, put all 8 in the quiz
         // Producing 2 quiz questions from a 20-word vocabulary list is WRONG. Always be exhaustive.
       ]
     };

  2. LAYOUT — two-column side-by-side:
     LEFT SIDEBAR (260px fixed, bg #0F172A, text #E2E8F0):
       • Course title at top (bold, white)
       • Scrollable lesson list — each row: number + title + status icon (○ not started / ⟳ in progress / ✓ done)
       • Clicking a row loads that lesson into the main panel
       • Progress bar at bottom: "4 / 7 lessons complete" + filled bar
     RIGHT MAIN PANEL (flex-1, bg #F8FAFC):
       • Lesson title + summary at top
       • Row below title: 6 tab pills [📖 Learn] [💡 Examples] [🎴 Flashcards] [❓ Quiz] [🎙️ Broadcast] [🎬 Video]
         + a FIXED "Ask Tutor" button on the RIGHT end of that same row (margin-left:auto).
         The button contains the agent avatar image (NOT an emoji) followed by "Ask Tutor" text:
           <button onclick="expandTutorPanel()" style="display:flex;align-items:center;gap:8px;background:#6366F1;color:white;border:none;border-radius:20px;padding:8px 16px;font-weight:700;font-size:13px;cursor:pointer;flex-shrink:0;">
             <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAG6klEQVR42u2YXYxdVRXHf2vvc+65M9NpGaEtIMZaIVpqJGD8IDGUglETfFCTueqD9EVCBI0Paow+MG0wEp98MBglaowmJNzBj6gpRpAOGhFjNQZqkQKpgFNKv2bmzr33fOy91/LhDgaNlmEKfiT9Jyfn4ax19n+vtfZ/7b3hLM7iLP6/IWfkbSZdcH+aQ7ga3SOiADNm7mpwx8E6oIjYf3xm3a75Vdva6m3/GdlanGbMXEck7d+/P39kw/Zra3i3iG1H4qY8V2u33bF1LQ7kmd777b0/v68jkszMyUqEX7kUm43sRewrDy1/pGm1v5CK7E1WgApkWWQsV9aPwTnjjleRaKXm4WHs3/qu9RfebSv+8hJSnr0UcjMgu8Hunau+vpgVNy7W0B/W0TK1VltlrJVkIo+kmKwqo22ZGHfb129487NMzD7Ym7/difvEXd27vJnpakmummB3FtfpSAo/K78Tp9q7jpyMocnNaUu8dxANzBQvSmlKgfFos4xb1vSG8UndMHnhzQ8uP1lcObn1BhvVZFrNuG41RtNd852OpM/fM7h5ONHedfh4qntq2UDNVZg0ggRn0jiT2owapUYpNfFIdco9PDyRtVLZbFl3/sd+03vsBhFJq104L0pwZsbc7DT6xQf6Fyyk/EvzPU09LBs6kTjekuggoDSiNKO31KiUmqhQ8vGCw2GRw/WSl9RocvrlXy//cdM06PM1eWYRvBqHiB0byCerdfn6pZi09uJSy3PqqceoLaGZEEg0lqhJDDVQeZXSohw6+CjRGU/Ek+7J4bF07sTUVIPdJCI2x5w/M4JmsmenxJkfz48vq3x0oVJrvDnGnDx9x2f40F9+wLb539Kra5RIkkSjkdoijRg//OwtTP7yETmx/yCLqcLMnIbGmtTs2muHip3sTNjpleS0BKdnR99PFuPvCGPti4YxqGbiYmjQAw9w/913cqD7TXymWCtDM0FzQccKeouLHH3o9/zkzruY6/5INHccC0tucdjXrJ1vyZdPvhXBunTdmgleunE0uwq3IxZi6lWRKDKWsemm23hs8zaq666nvb5N+eQB6hPPMnzuKEt/fhR/7gbedsunGFy8mUuuv45gkZ5WPJtOqRWOENMOgI1slDXLzMHjGECpenmtiKFiTiAMGXvLDrZedQ2mfaxZBqf0H/oV3hnnXbGNUJe8+r1Xsf2DO2nVA8pBKebV0EARC6LpFQDHOW5rJjjbkQQwSPraOkaCJDGxUe9vlogakSzissT4JVvJ3riF3AcKCcQwoIoNi8PIOm9IZjhNOMyVVU2K4XUAHTq6thSvSMAF39g/fqS089Aak4SRQCLmEuISuAguYfUAq/ukqk+sB6gk0ijmBJRaE1WK1KqUTeCZcvm8Hftm2gjGaeTmRWXmsqkLJ47WcWK+X5E7ldypiUQgkAhAQogr5CNmiWSJpJGokWCJkCIhRkyNlFQO95f4azWYfM/myyYAbE0p3r1bACt9vxA/3nq6ipw0ZdO4MJkZmUs4r4hTvFMcCUdCZPRGo4lTcQag1JYYpEYWwtBqIi31eSqr4uXpxXlDhrCQEif6ibGQbHJMZbIwJlpKYYnCR1qZ4i0SCVZJoDfqMTRaE7QhpcYKJ7R9BjFIyYifrATjpW23zAQRe+feQxufavTxgbIhmGr0KslH1EfMRxEX8FnA+4j3AecD3kW8BLxEcpdoiTKGUWCWi1mReUfQhazJL/nF23edfH6sNdXg5TzRI6+XyAMqpRklQoV3Dd41iAsYgWgNta48KdBoIpoS1agVBknpxcRSUltUYznq0ut91XuxOP37FIsYZu6rIvWWe//wuPf+IhZLM1XMKaYJs2DmE6AiBISAWgSnmEYSiSCjLVhmaplAJmhdtMTH5tAdV3480J32yGxaWw3OzTlA2y39XhjPrq2WmiAanKUkWAIJoAliNHMJcxEhifmEogiJ5MycKQHDO8x5p23xeWH+uwBsvFTObMs/Y256+6z8bur82cHkug8Mjs4TYxOUICZBTJIgI22EKDhFRBFnJs5AzDAz5zCXubzYNEV7cTh7433PfXjPbkD26JkRXBHRmbk5/y3V3cNU31xJOic2JbHqY6EGbcCiIQpi4A0yxGUeWh6KDJ95ck0LbeH2a45u3j07Pa0gIKeVwVUfmv4uAxfv/f5FC6LvK8v+NbGutqWmPN9SNWmWCtxo2YkD89K4PFv2LXdEvBzMi/b9U4PhT595/+eOvFKnOqHbdXQ66YXOr/nabVPHWnF9FuJErWS0k7R8K2ZFPpj0rd5859On7B8P1P6F/3j5MTPj2Lcvo9td/WG82/Xsm8lYxRb/5b36eL5GR53gX7VL+69ce5zFWZzF/xD+BsyxK85XMjuUAAAAAElFTkSuQmCC" alt="Tutor" style="width:22px;height:22px;border-radius:50%;object-fit:cover;">
             Ask Tutor
           </button>
         Clicking it calls expandTutorPanel() — always visible, always works, no hunting for the panel.
       • Tab content area below the pills
       • Prev Lesson / Next Lesson buttons at very bottom
     AI TUTOR PANEL (320px, right side, collapsible, bg #FFFFFF, border-left 1px solid #E2E8F0):
       • Header bar: agent avatar image + "AI Tutor" title + [≫ Collapse] button.
         Use: <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAG6klEQVR42u2YXYxdVRXHf2vvc+65M9NpGaEtIMZaIVpqJGD8IDGUglETfFCTueqD9EVCBI0Paow+MG0wEp98MBglaowmJNzBj6gpRpAOGhFjNQZqkQKpgFNKv2bmzr33fOy91/LhDgaNlmEKfiT9Jyfn4ax19n+vtfZ/7b3hLM7iLP6/IWfkbSZdcH+aQ7ga3SOiADNm7mpwx8E6oIjYf3xm3a75Vdva6m3/GdlanGbMXEck7d+/P39kw/Zra3i3iG1H4qY8V2u33bF1LQ7kmd777b0/v68jkszMyUqEX7kUm43sRewrDy1/pGm1v5CK7E1WgApkWWQsV9aPwTnjjleRaKXm4WHs3/qu9RfebSv+8hJSnr0UcjMgu8Hunau+vpgVNy7W0B/W0TK1VltlrJVkIo+kmKwqo22ZGHfb129487NMzD7Ym7/difvEXd27vJnpakmummB3FtfpSAo/K78Tp9q7jpyMocnNaUu8dxANzBQvSmlKgfFos4xb1vSG8UndMHnhzQ8uP1lcObn1BhvVZFrNuG41RtNd852OpM/fM7h5ONHedfh4qntq2UDNVZg0ggRn0jiT2owapUYpNfFIdco9PDyRtVLZbFl3/sd+03vsBhFJq104L0pwZsbc7DT6xQf6Fyyk/EvzPU09LBs6kTjekuggoDSiNKO31KiUmqhQ8vGCw2GRw/WSl9RocvrlXy//cdM06PM1eWYRvBqHiB0byCerdfn6pZi09uJSy3PqqceoLaGZEEg0lqhJDDVQeZXSohw6+CjRGU/Ek+7J4bF07sTUVIPdJCI2x5w/M4JmsmenxJkfz48vq3x0oVJrvDnGnDx9x2f40F9+wLb539Kra5RIkkSjkdoijRg//OwtTP7yETmx/yCLqcLMnIbGmtTs2muHip3sTNjpleS0BKdnR99PFuPvCGPti4YxqGbiYmjQAw9w/913cqD7TXymWCtDM0FzQccKeouLHH3o9/zkzruY6/5INHccC0tucdjXrJ1vyZdPvhXBunTdmgleunE0uwq3IxZi6lWRKDKWsemm23hs8zaq666nvb5N+eQB6hPPMnzuKEt/fhR/7gbedsunGFy8mUuuv45gkZ5WPJtOqRWOENMOgI1slDXLzMHjGECpenmtiKFiTiAMGXvLDrZedQ2mfaxZBqf0H/oV3hnnXbGNUJe8+r1Xsf2DO2nVA8pBKebV0EARC6LpFQDHOW5rJjjbkQQwSPraOkaCJDGxUe9vlogakSzissT4JVvJ3riF3AcKCcQwoIoNi8PIOm9IZjhNOMyVVU2K4XUAHTq6thSvSMAF39g/fqS089Aak4SRQCLmEuISuAguYfUAq/ukqk+sB6gk0ijmBJRaE1WK1KqUTeCZcvm8Hftm2gjGaeTmRWXmsqkLJ47WcWK+X5E7ldypiUQgkAhAQogr5CNmiWSJpJGokWCJkCIhRkyNlFQO95f4azWYfM/myyYAbE0p3r1bACt9vxA/3nq6ipw0ZdO4MJkZmUs4r4hTvFMcCUdCZPRGo4lTcQag1JYYpEYWwtBqIi31eSqr4uXpxXlDhrCQEif6ibGQbHJMZbIwJlpKYYnCR1qZ4i0SCVZJoDfqMTRaE7QhpcYKJ7R9BjFIyYifrATjpW23zAQRe+feQxufavTxgbIhmGr0KslH1EfMRxEX8FnA+4j3AecD3kW8BLxEcpdoiTKGUWCWi1mReUfQhazJL/nF23edfH6sNdXg5TzRI6+XyAMqpRklQoV3Dd41iAsYgWgNta48KdBoIpoS1agVBknpxcRSUltUYznq0ut91XuxOP37FIsYZu6rIvWWe//wuPf+IhZLM1XMKaYJs2DmE6AiBISAWgSnmEYSiSCjLVhmaplAJmhdtMTH5tAdV3480J32yGxaWw3OzTlA2y39XhjPrq2WmiAanKUkWAIJoAliNHMJcxEhifmEogiJ5MycKQHDO8x5p23xeWH+uwBsvFTObMs/Y256+6z8bur82cHkug8Mjs4TYxOUICZBTJIgI22EKDhFRBFnJs5AzDAz5zCXubzYNEV7cTh7433PfXjPbkD26JkRXBHRmbk5/y3V3cNU31xJOic2JbHqY6EGbcCiIQpi4A0yxGUeWh6KDJ95ck0LbeH2a45u3j07Pa0gIKeVwVUfmv4uAxfv/f5FC6LvK8v+NbGutqWmPN9SNWmWCtxo2YkD89K4PFv2LXdEvBzMi/b9U4PhT595/+eOvFKnOqHbdXQ66YXOr/nabVPHWnF9FuJErWS0k7R8K2ZFPpj0rd5859On7B8P1P6F/3j5MTPj2Lcvo9td/WG82/Xsm8lYxRb/5b36eL5GR53gX7VL+69ce5zFWZzF/xD+BsyxK85XMjuUAAAAAElFTkSuQmCC" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;"> AI Tutor
       • When collapsed: shows only a floating pill on the right edge with the agent avatar + "Ask" text (click to expand)
       • Message thread (scrollable): student messages right-aligned (indigo bg), tutor responses left-aligned
       • Each tutor response renders THREE sections from the JSON:
           ① 💬 Feedback — warm, gray text, "Your reasoning about X is correct because..."
           ② 📖 Explanation — brief teaching content (indigo), never gives the full answer
           ③ ❓ Socratic Question — bold amber, the guiding question the student must answer
       • Below thread: textarea + [Ask →] button
       • "🔊" button on each Socratic Question speaks it aloud via speakGemini()
       • On load: show a welcome message with the agent avatar image (same base64 as above, 32px circle) beside the text:
         "Hi! I'm your AI Tutor. Ask me anything about this lesson, or try answering a quiz question and I'll guide you."

  3. LEARN TAB — concept cards:
     Each concept = a white card (rounded-xl, shadow) containing:
       • Large emoji + bold term as heading
       • Definition in readable body text (font-size 16px)
       • 🔊 button top-right → calls speak(definition)
     Cards stacked vertically, gap 16px.

  4. EXAMPLES TAB — example cards:
     Each example = amber-accented card (left border 4px #F59E0B):
       • Bold title
       • Body paragraph
       • 🔊 button → calls speak(title + '. ' + body)
     Numbered 1, 2, 3…

  5. FLASHCARDS TAB — flip card deck:
     • One card centered, 340×200px, perspective 1000px
     • Click card → CSS 3D flip: rotateY(180deg), 0.5s ease transition
     • Front face: indigo bg (#6366F1), white text, shows "front" text
     • Back face: white bg, indigo text, shows "back" text
     • Below: ← Prev card | Card 3 of 8 | Next card → | 🔀 Shuffle
     • Track seen cards; show ✓ on cards the user has flipped

     ── REVIEW WEAK CARDS (mandatory) ──
     Above the card deck, show TWO mode buttons side by side:
       [📚 All Cards]   [⚠️ Weak Areas (N)]   ← N = number of weak flashcards for this lesson
     • "All Cards" = normal full deck (default)
     • "Weak Areas" = filtered deck containing ONLY flashcards that correspond to quiz
       questions the user answered wrong in this lesson.
     • If N = 0 (no wrong answers yet): button is dimmed + tooltip "Finish the quiz first — missed
       questions will appear here for review."
     • If N > 0: button is amber (#F59E0B) with a badge count; clicking it loads the filtered deck.
       Each card in the weak deck shows a small red ✗ badge in the corner.
     • After the user reviews all weak cards (flipped every one), badge changes to ✓ and button
       turns green — "All weak areas reviewed!"

     IMPLEMENTATION — how to link quiz wrong answers → flashcards:
       // Each quiz question has an optional cardIdx field (0-based index into the flashcards array).
       // When the AI generates quiz questions, set cardIdx to the flashcard that best covers that concept.
       // Example: quiz[2].cardIdx = 4  → wrong answer on q2 means flashcard[4] goes into weak deck.
       // If cardIdx is missing, fall back to: cardIdx = questionIndex % flashcards.length

       // Store weak card indices in localStorage:
       function markWeak(lessonId, cardIdx) {
         const key = 'lp_weak_' + lessonId;
         const set = new Set(JSON.parse(localStorage.getItem(key) || '[]'));
         set.add(cardIdx);
         localStorage.setItem(key, JSON.stringify([...set]));
       }
       function getWeakIndices(lessonId) {
         return new Set(JSON.parse(localStorage.getItem('lp_weak_' + lessonId) || '[]'));
       }
       function clearWeak(lessonId) { localStorage.removeItem('lp_weak_' + lessonId); }

       // Update the Weak Areas badge whenever quiz results change or the tab is opened:
       function refreshWeakBadge(lesson) {
         const n = getWeakIndices(lesson.id).size;
         weakBtn.textContent = '⚠️ Weak Areas (' + n + ')';
         weakBtn.style.opacity = n === 0 ? '0.4' : '1';
         weakBtn.style.borderColor = n === 0 ? '' : '#F59E0B';
         weakBtn.style.color      = n === 0 ? '' : '#F59E0B';
       }

       // Add cardIdx to the COURSE data structure for each quiz question (see item 1 above).

  6. QUIZ TAB — one question at a time:
     • Question in large bold text (20px)
     • 4 option buttons (A B C D), full width, rounded
     • On click: correct = green bg (#10B981) + ✓ icon; wrong = red bg (#EF4444) + ✗ icon; show explanation text below
     • "Next Question →" button appears after answering
     • Final screen: "🎉 You got 7 / 10!" + stars visual + Retry button
     • Save best score per lesson to localStorage key "lp_score_[lessonId]"
     • Show "🏆 Best: 9/10" below final score

     ── WRONG-ANSWER TRACKING (mandatory) ──
     When user selects a WRONG answer:
       const cardIdx = q.cardIdx !== undefined ? q.cardIdx : (questionIndex % lesson.flashcards.length);
       markWeak(lesson.id, cardIdx);
       refreshWeakBadge(lesson);
     When user selects the CORRECT answer: do NOT remove it from weak set — they need to review it.
     On quiz Retry: call clearWeak(lesson.id) then refreshWeakBadge(lesson) to reset.

     After the final score screen, show a prompt if any weak cards exist:
       "📌 You missed [N] question(s). → Switch to Flashcards › ⚠️ Weak Areas to review them."
       (This line is amber-colored and acts as a button that switches to the Flashcards tab in Weak mode.)

     COURSE DATA — add cardIdx to every quiz question (mandatory):
       quiz: [
         { q: "...", options: [...], answer: 0, explanation: "...", cardIdx: 2 }
         //                                                          ^^^ index into this lesson's flashcards array
       ]
     Rule: cardIdx should point to the flashcard that best covers the same concept being tested.
     If you have 5 flashcards and 6 quiz questions, two questions can share the same cardIdx.

  7. BROADCAST TAB — AI talk-show episode for this lesson:
     ══ UI LAYOUT ══
     • Dark studio panel: bg #0D1117, rounded-2xl, full height of tab area
     • Three character cards at the TOP in a row:
         ZEPHYR 🎙️  (teal #2DD4BF)  — "Host & Instructor"
         KORE   🎓  (violet #A78BFA) — "Curious Student"
         FENRIR ⚡  (orange #F97316) — "Real-World Expert"
       Each card: avatar circle with emoji, name, role badge. Inactive = dim (opacity 0.4). Active speaker = full brightness + glowing border matching their color + subtle pulse animation.
     • Below the character cards: scrollable transcript panel (dark bg, monospace-ish, line-height 1.8):
         Each line = speaker color dot + bold speaker name + text.
         Currently-speaking line = highlighted with a soft bg glow.
         Auto-scrolls to keep the active line visible.
     • Controls bar at the bottom:
         [▶ Play Episode]  [⏸ Pause]  [⏹ Stop]  — centered, pill buttons
         Progress bar showing how far through the episode (current line / total lines)
         Speed selector: 0.75× · 1× · 1.25× · 1.5×

     ══ IMPLEMENTATION ══
     Use the lesson's broadcast array from COURSE data. Define three voice profiles:
       const BC_VOICES = {
         ZEPHYR: { rate: 0.88, pitch: 1.00, color: '#2DD4BF', emoji: '🎙️', role: 'Host & Instructor' },
         KORE:   { rate: 1.05, pitch: 1.18, color: '#A78BFA', emoji: '🎓', role: 'Curious Student'   },
         FENRIR: { rate: 0.93, pitch: 0.85, color: '#F97316', emoji: '⚡', role: 'Real-World Expert'  }
       };
     Playback engine using SpeechSynthesis:
       let bcLine = 0, bcPaused = false, bcSpeed = 1.0;
       function bcPlay(script) {
         if (bcLine >= script.length) { bcLine = 0; updateBCProgress(); return; }
         const line = script[bcLine];
         const v = BC_VOICES[line.speaker];
         const u = new SpeechSynthesisUtterance(line.text);
         u.rate  = v.rate * bcSpeed;
         u.pitch = v.pitch;
         u.onend = () => { if (!bcPaused) { bcLine++; updateBCProgress(); bcPlay(script); } };
         highlightBCSpeaker(line.speaker);
         highlightBCLine(bcLine);
         window.speechSynthesis.cancel();
         window.speechSynthesis.speak(u);
       }
       function bcPauseToggle() { bcPaused = !bcPaused; if (!bcPaused) bcPlay(currentBroadcast); else window.speechSynthesis.cancel(); }
       function bcStop() { bcPaused=true; bcLine=0; window.speechSynthesis.cancel(); resetBCHighlights(); }
     When the user switches lessons, call bcStop() so the old episode stops.

  8. VIDEO TAB — animated explainer video (Canvas + MediaRecorder):
     ══ UI LAYOUT ══
     • 16:9 canvas (max 640px wide) centered in the tab, dark bg #0D1117, rounded-xl
     • Below canvas: [▶ Play] [⏹ Stop] [⬇ Download .webm]
     • A progress bar beneath shows current step / total steps
     • Small step thumbnails row below (colored dots, active = bright)

     ══ ANIMATION ENGINE ══
     Use lesson.videoSteps array. Render each step onto the canvas with smooth transitions:

     function runVideoStep(ctx, step, w, h, onDone) {
       ctx.clearRect(0,0,w,h);
       // dark bg
       ctx.fillStyle = '#0D1117'; ctx.fillRect(0,0,w,h);

       if (step.type === 'title') {
         // Large centered emoji + lesson title, fade in
         ctx.fillStyle = step.color || '#6366F1';
         ctx.font = 'bold ' + Math.round(h*0.12) + 'px Inter, sans-serif';
         ctx.textAlign = 'center';
         ctx.fillText(step.emoji + '  ' + step.text, w/2, h*0.45);
         // subtitle bar fade in below
         ctx.fillStyle = 'rgba(255,255,255,0.35)';
         ctx.font = Math.round(h*0.055) + 'px Inter, sans-serif';
         ctx.fillText('Lesson Overview', w/2, h*0.6);
       }

       else if (step.type === 'concept') {
         // Colored pill / badge with emoji + label
         const bw = w*0.72, bh = h*0.22;
         const bx = (w-bw)/2, by = h*0.28;
         ctx.fillStyle = step.color + '22'; // translucent fill
         roundRect(ctx, bx, by, bw, bh, 18); ctx.fill();
         ctx.strokeStyle = step.color; ctx.lineWidth = 2.5;
         roundRect(ctx, bx, by, bw, bh, 18); ctx.stroke();
         // emoji
         ctx.font = Math.round(h*0.13)+'px serif';
         ctx.fillStyle = '#FFFFFF';
         ctx.textAlign = 'center';
         ctx.fillText(step.emoji, w/2, by + bh*0.52);
         // label
         ctx.font = 'bold '+Math.round(h*0.072)+'px Inter,sans-serif';
         ctx.fillStyle = step.color;
         ctx.fillText(step.label, w/2, by + bh + h*0.1);
         // body
         ctx.font = Math.round(h*0.048)+'px Inter,sans-serif';
         ctx.fillStyle = 'rgba(255,255,255,0.7)';
         ctx.fillText(step.body, w/2, by + bh + h*0.2);
       }

       else if (step.type === 'arrow') {
         // Animated arrow drawn from left to right
         ctx.strokeStyle = '#6366F1'; ctx.lineWidth = 3;
         ctx.beginPath(); ctx.moveTo(w*0.18, h/2); ctx.lineTo(w*0.82, h/2); ctx.stroke();
         // arrowhead
         ctx.beginPath(); ctx.moveTo(w*0.82,h/2-10); ctx.lineTo(w*0.82+18,h/2); ctx.lineTo(w*0.82,h/2+10); ctx.fill();
         ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.font=Math.round(h*0.05)+'px Inter,sans-serif';
         ctx.textAlign='center'; ctx.fillText(step.label||'', w/2, h/2 - h*0.07);
       }

       else if (step.type === 'end') {
         ctx.fillStyle = '#10B981';
         ctx.font='bold '+Math.round(h*0.13)+'px serif'; ctx.textAlign='center';
         ctx.fillText(step.emoji||'🎓', w/2, h*0.4);
         ctx.fillStyle='#FFFFFF'; ctx.font='bold '+Math.round(h*0.07)+'px Inter,sans-serif';
         ctx.fillText(step.text, w/2, h*0.6);
       }

       // Helper — draw rounded rectangle path
       function roundRect(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath();}

       setTimeout(onDone, step.duration || 3000);
     }

     Playback loop: iterate steps sequentially, call runVideoStep for each, update progress bar.
     SpeechSynthesis narration: speak() the step label/text while the step is displayed (so audio matches visual).

     MediaRecorder recording:
       const stream = canvas.captureStream(30);
       const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
       const chunks = [];
       rec.ondataavailable = e => chunks.push(e.data);
       rec.onstop = () => {
         const blob = new Blob(chunks, { type:'video/webm' });
         const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
         a.download = 'lesson-video.webm'; a.click();
       };
       // Start recording when ▶ Play is clicked, stop when animation ends.
       // Show "Recording…" red dot while capturing.

  9. PROGRESS — save to localStorage:
     Key "lp_progress" = JSON object mapping lessonId → { learnDone, examplesDone, flashcardsDone, quizScore, broadcastDone, videoDone }
     A lesson is complete when all 6 tabs have been visited.
     On 100% completion → full-screen celebration overlay (confetti CSS keyframes, "🎓 Course Complete!" message, show total score across all quizzes).

  10. AUDIO — Gemini TTS (natural voices) with SpeechSynthesis fallback:

     ── API KEY SETUP ──
     In the header bar, add a "🔑 API Key" button that opens a small inline modal:
       <div id="key-modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:999; display:flex; align-items:center; justify-content:center;">
         <div style="background:#1E293B; border-radius:16px; padding:32px; max-width:420px; width:90%;">
           <h3 style="color:#F8FAFC; font-weight:700; margin-bottom:8px;">🔑 Google Gemini API Key</h3>
           <p style="color:#94A3B8; font-size:14px; margin-bottom:16px;">Paste your Gemini API key to enable natural AI voices. Your key stays in this browser only.</p>
           <input id="key-input" type="password" placeholder="AIza..." style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid #334155; background:#0F172A; color:#F8FAFC; font-size:14px; margin-bottom:12px;" />
           <div style="display:flex; gap:8px;">
             <button onclick="saveKey()" style="flex:1; padding:10px; background:#6366F1; color:white; border:none; border-radius:8px; font-weight:600; cursor:pointer;">Save Key</button>
             <button onclick="closeKeyModal()" style="padding:10px 16px; background:#334155; color:white; border:none; border-radius:8px; cursor:pointer;">Cancel</button>
           </div>
         </div>
       </div>
     On first load, if no key in localStorage, show a soft banner: "Add your Gemini API key for natural AI voices → [🔑 Add Key]"

     ── GEMINI TTS IMPLEMENTATION — MANDATORY, COPY VERBATIM ──
     ⚠️ DO NOT use window.speechSynthesis as the primary voice engine.
     ⚠️ DO NOT skip this section. EVERY learning portal MUST include these exact functions.
     Copy these functions WORD FOR WORD into your <script> block — do not paraphrase or simplify:

     function buildWavHeader(pcmLength, sampleRate=24000, ch=1, bits=16) {
       const buf = new ArrayBuffer(44);
       const v = new DataView(buf);
       const ascii = (off, s) => [...s].forEach((c,i) => v.setUint8(off+i, c.charCodeAt(0)));
       ascii(0,'RIFF'); v.setUint32(4, 36+pcmLength, true);
       ascii(8,'WAVE'); ascii(12,'fmt '); v.setUint32(16,16,true);
       v.setUint16(20,1,true); v.setUint16(22,ch,true); v.setUint32(24,sampleRate,true);
       v.setUint32(28,sampleRate*ch*bits/8,true); v.setUint16(32,ch*bits/8,true);
       v.setUint16(34,bits,true); ascii(36,'data'); v.setUint32(40,pcmLength,true);
       return buf;
     }

     async function speakGemini(text, voiceName='Zephyr') {
       if (globalMuted) return;
       const key = localStorage.getItem('lp_gemini_key');
       if (!key) { speakFallback(text); return; }
       try {
         const res = await fetch(
           'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key='+key,
           { method:'POST', headers:{'Content-Type':'application/json'},
             body: JSON.stringify({
               contents:[{parts:[{text:'In a warm, natural, conversational pace: '+text}]}],
               generationConfig:{
                 response_modalities:['AUDIO'],
                 speech_config:{voice_config:{prebuilt_voice_config:{voice_name:voiceName}}}
               }
             })
           }
         );
         const d = await res.json();
         const part = d?.candidates?.[0]?.content?.parts?.[0]?.inline_data;
         if (!part) { speakFallback(text); return; }
         const pcm = Uint8Array.from(atob(part.data), c=>c.charCodeAt(0));
         const mt  = (part.mime_type||'').toLowerCase();
         let blob;
         if (mt.startsWith('audio/l16')||mt.includes('pcm')||mt==='') {
           const hdr = new Uint8Array(buildWavHeader(pcm.byteLength));
           const wav = new Uint8Array(44+pcm.byteLength);
           wav.set(hdr,0); wav.set(pcm,44);
           blob = new Blob([wav],{type:'audio/wav'});
         } else { blob = new Blob([pcm],{type:mt}); }
         const url = URL.createObjectURL(blob);
         const audio = new Audio(url);
         audio.onended = ()=> URL.revokeObjectURL(url);
         audio.play();
       } catch(e) { speakFallback(text); }
     }

     function speakFallback(text) {
       if (globalMuted) return;
       const u = new SpeechSynthesisUtterance(text);
       u.rate=0.92; u.pitch=1.05;
       window.speechSynthesis.cancel();
       window.speechSynthesis.speak(u);
     }

     // speak() = main function used everywhere: tries Gemini first, falls back automatically
     function speak(text, voice='Zephyr') { speakGemini(text, voice); }

     // Broadcast voices — each character uses a different Gemini prebuilt voice:
     //   ZEPHYR → 'Zephyr'  (warm, authoritative host)
     //   KORE   → 'Kore'    (curious, younger student)
     //   FENRIR → 'Puck'    (energetic real-world expert)
     // In bcPlay(): u.onend calls speakGemini(line.text, BC_VOICES[line.speaker].geminiVoice)
     // Update BC_VOICES to include: geminiVoice field:
     //   ZEPHYR: { ..., geminiVoice: 'Zephyr' }
     //   KORE:   { ..., geminiVoice: 'Kore'   }
     //   FENRIR: { ..., geminiVoice: 'Puck'   }

     • Global 🔇 Mute toggle in header — sets globalMuted=true, stops all audio
     • Key stored in localStorage('lp_gemini_key') — never sent anywhere except Google's API
     • When API key is invalid (401/403 response) → show banner "API key invalid, using basic voice" + fall back

  11. RESPONSIVE — on screens < 768px:
     Sidebar collapses to a top dropdown.
     Tab pills scroll horizontally.
     Flashcard shrinks to full width.
     Broadcast character cards stack vertically.
     Video canvas is 100% width.

  12. DUAL LANGUAGE / BILINGUAL SUPPORT:
     Detect the language of the content automatically. If the user's prompt or uploaded material
     contains Arabic, or if they say "Arabic", "dual language", "bilingual", or "ثنائي اللغة":

     BILINGUAL MODE rules:
     • Concepts: show BOTH the Arabic term (bold, RTL, font-size 18px) AND the English term side by side
       Example card layout:
         [Arabic term — right-aligned, RTL]   |   [English term — left-aligned]
         Definition in English below (or bilingual if source is bilingual)
     • Flashcard fronts: Arabic term or question; backs: English answer + Arabic translation
     • Quiz questions: write in the SAME language as the textbook/source material
       — if the textbook is Arabic, questions and options are in Arabic
       — if bilingual (like a Jordanian EFL textbook), questions in English but explain in Arabic
     • Broadcast dialogue: ZEPHYR and KORE speak in English; FENRIR occasionally drops in
       a key Arabic term to reinforce vocabulary (e.g., "That's immunisation — التطعيم in Arabic")
     • RTL layout: wrap Arabic text in <span dir="rtl" lang="ar" style="font-family:'Noto Naskh Arabic',sans-serif; font-size:18px;">...</span>
       Add Google Font: <link href="https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;700&display=swap" rel="stylesheet">
     • If the source material is ENTIRELY in Arabic (not EFL), generate all content in Arabic
       with RTL layout for the entire main panel. Sidebar stays dark, text flows right-to-left.
     • Language auto-detection: scan the first 200 chars of the user's prompt for Arabic script (Unicode range \u0600-\u06FF)

  13. AI TUTOR — Live Socratic teaching via Gemini API (LearnLM principles):

     ══ THE MOST IMPORTANT FEATURE — DO NOT SKIP ══
     The portal is not just a static study app. It has a LIVE AI tutor powered by the same
     Gemini API key the user provided. This is what makes it genuinely educational.

     ── SOCRATIC PERSONA (system_instruction) ──
     Every call to the tutor API must include this system instruction verbatim:
       "You are a patient, encouraging Socratic tutor. Your job is to guide the student
        to discover the answer themselves — never state the answer directly.
        Always: (1) give warm, specific feedback on what the student said,
        (2) provide a brief hint or bridge concept (1-2 sentences max),
        (3) ask ONE focused guiding question that moves them closer to the answer.
        Keep responses concise. Be warm, never condescending."

     ── STRUCTURED JSON RESPONSE (mandatory) ──
     Use response_mime_type: 'application/json' so the response is always parseable.
     The JSON schema for every tutor response:
       {
         "feedback":          "Warm reaction to what the student said (1-2 sentences)",
         "explanation":       "A small bridge concept or hint — never the full answer (1-2 sentences)",
         "socratic_question": "The single guiding question to lead the student forward"
       }

     ── IMPLEMENTATION — askTutor() function ──
     Copy this VERBATIM into your <script>:

     async function askTutor(userMessage, lessonContext) {
       const key = localStorage.getItem('lp_gemini_key');
       if (!key) { appendTutorMsg('tutor-error','Add your API key (🔑) to unlock the AI Tutor.'); return; }
       appendTutorMsg('student', userMessage);
       appendTutorMsg('tutor-thinking','🤔 Thinking...');
       try {
         const sysInstruction =
           'You are a patient, encouraging Socratic tutor teaching: ' + lessonContext + '. ' +
           'Guide the student to discover answers — never state them directly. ' +
           'Always: (1) give warm specific feedback, (2) offer a brief hint (1-2 sentences max), ' +
           '(3) ask ONE focused guiding question. Be concise and warm.';
         const schema = {
           type: 'OBJECT',
           properties: {
             feedback:          { type: 'STRING' },
             explanation:       { type: 'STRING' },
             socratic_question: { type: 'STRING' }
           },
           required: ['feedback','explanation','socratic_question']
         };
         const res = await fetch(
           'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key='+key,
           { method:'POST', headers:{'Content-Type':'application/json'},
             body: JSON.stringify({
               system_instruction: { parts:[{ text: sysInstruction }] },
               contents: [{ role:'user', parts:[{ text: userMessage }] }],
               generationConfig: {
                 response_mime_type: 'application/json',
                 response_schema: schema
               }
             })
           }
         );
         const d = await res.json();
         removeTutorThinking();
         if (d.error) { appendTutorMsg('tutor-error', 'API error: '+d.error.message); return; }
         const t = JSON.parse(d.candidates[0].content.parts[0].text);
         appendTutorResponse(t.feedback, t.explanation, t.socratic_question);
         speak(t.socratic_question, 'Zephyr');
       } catch(e) { removeTutorThinking(); appendTutorMsg('tutor-error','Could not reach tutor. Check your API key.'); }
     }

     ── TUTOR CHAT UI RENDERING ──
     appendTutorMsg(type, text):
       'student'       → right-aligned bubble, indigo bg #6366F1, white text
       'tutor-thinking'→ left-aligned, gray italic "🤔 Thinking..."
       'tutor-error'   → left-aligned, red text
     appendTutorResponse(feedback, explanation, question):
       Render a card with three stacked rows:
         Row 1: 💬 [feedback]         — gray text, font-size 14px
         Row 2: 📖 [explanation]      — slate text, font-size 14px, slight indent
         Row 3: ❓ [question]         — amber #F59E0B, font-weight 700, font-size 15px + 🔊 button
       Card has white bg, left border 4px #6366F1, rounded-xl, padding 16px, shadow

     ── AUTO-TRIGGER ON WRONG QUIZ ANSWERS ──
     In the quiz wrong-answer handler, AFTER calling markWeak(), also call:
       const lesson = COURSE.lessons[currentLessonIdx];
       const context = lesson.title + ': ' + lesson.concepts.map(c=>c.term).join(', ');
       askTutor(
         'I just answered "' + selectedOption + '" for the question: "' + question.q + '" — but that was wrong. Can you help me understand why?',
         context
       );
       // Also expand the tutor panel if it is collapsed
       expandTutorPanel();

     ── INPUT BAR ──
     Below the tutor message thread:
       <div style="display:flex; gap:8px; padding:12px; border-top:1px solid #E2E8F0;">
         <textarea id="tutor-input" rows="2" placeholder="Ask your tutor anything about this lesson…"
           style="flex:1; border:1px solid #E2E8F0; border-radius:10px; padding:10px; font-size:14px; resize:none;"></textarea>
         <button onclick="handleTutorSend()" style="background:#6366F1;color:white;border:none;border-radius:10px;padding:10px 16px;font-weight:700;cursor:pointer;">Ask →</button>
       </div>
     handleTutorSend(): reads tutor-input value, calls askTutor(value, currentLessonContext), clears input.
     Pressing Enter (not Shift+Enter) in textarea also submits.

     ── TUTOR PANEL TOGGLE ──
     function expandTutorPanel() { tutorPanel.style.display='flex'; collapseBtn style → show '≫ Collapse'; }
     function collapseTutorPanel() { tutorPanel.style.width='48px'; hide message thread and input; show floating '🤖' tab. }
     Default state: expanded on desktop (width 320px), collapsed on mobile.

  PROFILE L VISUAL DESIGN:
  Sidebar: #0F172A bg · #E2E8F0 text · #6366F1 active lesson highlight
  Main panel: #F8FAFC bg · white cards with box-shadow 0 2px 12px rgba(0,0,0,0.08)
  Learn tab accent: #6366F1 (indigo)
  Examples tab accent: #F59E0B (amber)
  Flashcard front: #6366F1 · Flashcard back: #FFFFFF
  Quiz correct: #10B981 (green) · Quiz wrong: #EF4444 (red)
  Broadcast studio bg: #0D1117 · ZEPHYR: #2DD4BF · KORE: #A78BFA · FENRIR: #F97316
  Video canvas bg: #0D1117 · step colors per videoSteps array
  Font: Inter (Google Fonts, weights 400 + 600 + 700); Arabic: Noto Naskh Arabic
  Active tab pill: solid #6366F1 bg, white text · Inactive: transparent, #64748B text
  Progress bar fill: linear-gradient(90deg, #6366F1, #8B5CF6)

  PROFILE L BANNED:
  ✗ Scrolling landing-page layout — MUST use sidebar + tab architecture
  ✗ Hardcoding lesson content as HTML — ALWAYS use the COURSE JS object
  ✗ Showing all lessons at once — one lesson visible at a time in the main panel
  ✗ Pexels images for content — use CSS illustrations, SVG diagrams, or emojis
  ✗ Quiz without instant feedback + explanation — ALWAYS show why the answer is right/wrong
  ✗ Missing 🔊 audio buttons — every concept card and example card MUST have one
  ✗ Missing localStorage persistence — progress and quiz scores MUST save and restore on refresh
  ✗ Fewer than 10 quiz questions per lesson — 10 is the MINIMUM, never fewer
  ✗ Skipping book content — if given a textbook/PDF, cover EVERY vocabulary word and exercise
  ✗ Missing Broadcast tab — ALWAYS include the full ZEPHYR/KORE/FENRIR broadcast engine
  ✗ Missing Video tab — ALWAYS include the Canvas animated explainer with Download button
  ✗ Empty broadcast array — every lesson MUST have 10+ broadcast dialogue lines
  ✗ Empty videoSteps array — every lesson MUST have 5-8 video animation steps
  ✗ Missing cardIdx on quiz questions — every quiz question MUST have cardIdx pointing to its flashcard
  ✗ Missing ⚠️ Weak Areas button in flashcard tab — ALWAYS show the weak/all mode toggle
  ✗ Not tracking wrong answers — markWeak() MUST be called on every wrong quiz answer
  ✗ Missing post-quiz prompt — ALWAYS show the amber link to Weak Areas after finishing
  ✗ Using browser SpeechSynthesis as primary TTS — ALWAYS implement Gemini TTS with API key input
  ✗ Missing API key modal — the header MUST have a 🔑 API Key button + first-run banner
  ✗ Ignoring Arabic content — if source is Arabic or bilingual, ALWAYS apply bilingual mode rules
  ✗ Missing AI Tutor panel — EVERY portal MUST have the live Socratic tutor chat (item 13)
  ✗ Skipping askTutor() — copy it VERBATIM; never skip the structured JSON + system_instruction
  ✗ Static-only quiz — wrong answers MUST auto-trigger askTutor() with the question context
  ✗ Giving answers directly — tutor persona MUST use Socratic questioning, never state the answer

PROFILE F — GAME (Nintendo / Arcade / Platformer / Puzzle)
  Use for: ANY request containing the words game, play, level, player, score, jump, shoot, enemy, platformer, arcade, puzzle, RPG, Mario, Zelda, dungeon, shooter
  ⚠️  This profile replaces ALL website rules. A game is NOT a website with animations — it is a real interactive game engine built on <canvas>.

  ══════════════════════════════════════════════════════════════
  STEP 0 — THINK BEFORE YOU CODE (mandatory — do this FIRST)
  ══════════════════════════════════════════════════════════════

  Before writing a single line of HTML or JavaScript, output a design plan
  as an HTML comment block at the very top of your file. This is not optional.
  Thinking out loud produces dramatically better games. Structure it like this:

  <!--
  GAME DESIGN PLAN
  ═════════════════
  CONCEPT:       [One sentence — what makes this game unique and fun?]
  THEME/WORLD:   [Sky kingdom? Underground caves? Candy land? Be specific.]
  PLAYER:        [Who/what is the player? What do they look like? Special ability?]
  WIN CONDITION: [How does the player beat the game? What is the final goal?]

  LEVEL BREAKDOWN:
    Level 1 — [Name]: [One sentence describing this level's theme, challenge, and mood]
    Level 2 — [Name]: [One sentence — harder, new mechanic or visual?]
    Level 3 — [Name]: [One sentence — climax, hardest, most rewarding]

  ENEMY TYPES:
    Enemy A — [Name]: [What does it do? How does the player defeat it?]
    Enemy B — [Name]: [Different behavior from A — e.g. flying, faster, shoots?]

  VISUAL STYLE:
    Background: [Sky color, scenery elements, parallax layers — be specific]
    Ground:     [Color palette, texture feel — e.g. grassy green + brown dirt]
    Player:     [Pixel art description — hat color, body color, distinguishing feature]
    Tiles:      [Brick color, platform style — e.g. mossy stone, candy blocks]

  MUSIC MOOD:   [Upbeat? Spooky? Heroic? This shapes the note sequence.]

  PHYSICS FEEL: [Floaty? Snappy? Heavy? Any special movement mechanic?]

  NOW I WILL BUILD EXACTLY THIS GAME — not a generic platformer.
  -->

  After writing the comment, BUILD the game exactly as you described above.
  Every level, every enemy, every visual element must match the plan.
  The plan is a contract — honour it.

  ════════════════════════════════════════════════════
  MARIO PHYSICS BIBLE — use these EXACT constants & code
  (extracted from Super Mario Bros disassembly analysis)
  ════════════════════════════════════════════════════

  The difference between a "game" that feels like homework and one players
  can't put down is these numbers and techniques. Copy them precisely:

  ── PHYSICS CONSTANTS (copy exactly — tuned for all ages) ──
  // ⚠️ NEVER increase these speeds — smoother & slower is more fun than twitchy
  const GRAVITY_RISE  = 0.28;   // lighter gravity while ascending — floaty feel
  const GRAVITY_FALL  = 0.55;   // heavier gravity while falling — gentle landing
  const WALK_ACCEL    = 0.07;   // gradual acceleration — weight & momentum
  const RUN_ACCEL     = 0.14;   // faster accel when run key held
  const MAX_WALK      = 1.8;    // max walk speed — SLOW & SMOOTH for all players
  const MAX_RUN       = 3.5;    // max run speed — still controlled, not frantic
  const FRICTION_GND  = 0.80;   // ground friction when no key pressed (stops quickly)
  const FRICTION_AIR  = 0.96;   // air has almost no friction (keep momentum)
  const JUMP_VELOCITY = -11.5;  // initial jump velocity — satisfying arc
  const MIN_JUMP_VY   = -5.0;   // variable jump: clip vy here if button released early
  const COYOTE_FRAMES = 10;     // generous coyote time — forgiving for new players
  const JUMP_BUFFER   = 10;     // generous jump buffer — easy to chain jumps
  const TILE_SIZE     = 40;

  ── PLAYER OBJECT (copy exactly) ──────────────────────
  const player = {
    x: 80, y: 300, vx: 0, vy: 0, w: 28, h: 36,
    onGround: false, facing: 1,            // 1=right, -1=left
    coyoteTimer: 0, jumpBuffer: 0,
    running: false, spriteFrame: 0, frameTick: 0,
    lives: 3, score: 0, coins: 0, state: 'idle'  // idle|walk|run|jump|fall|dead
  };

  ── UPDATE LOOP (copy this physics logic exactly) ──────
  function updatePlayer(dt) {
    // 1. INPUT → acceleration (not instant velocity)
    const runHeld = keyState['ShiftLeft'] || keyState['KeyZ'];
    const accel   = runHeld ? RUN_ACCEL : WALK_ACCEL;
    const maxSpd  = runHeld ? MAX_RUN   : MAX_WALK;
    player.running = runHeld;

    if (keyState['ArrowLeft']  || keyState['KeyA']) {
      player.vx = Math.max(player.vx - accel, -maxSpd);
      player.facing = -1;
    } else if (keyState['ArrowRight'] || keyState['KeyD']) {
      player.vx = Math.min(player.vx + accel,  maxSpd);
      player.facing = 1;
    } else {
      // friction — different on ground vs air
      player.vx *= player.onGround ? FRICTION_GND : FRICTION_AIR;
      if (Math.abs(player.vx) < 0.1) player.vx = 0;
    }

    // 2. VARIABLE JUMP HEIGHT — release early = shorter hop
    if (keyState['Space'] || keyState['ArrowUp'] || keyState['KeyW']) {
      if (player.jumpBuffer > 0 || player.coyoteTimer > 0) {
        player.vy = JUMP_VELOCITY;
        player.onGround = false;
        player.coyoteTimer = 0;
        player.jumpBuffer  = 0;
        playSound(523, 'square', 0.12, 0.4);    // jump sfx
      }
    } else {
      // Early release → clip upward velocity (short hop)
      if (player.vy < MIN_JUMP_VY) player.vy = MIN_JUMP_VY;
    }

    // 3. JUMP BUFFER — queues jump pressed slightly before landing
    if ((keyState['Space'] || keyState['ArrowUp'] || keyState['KeyW'])
        && !player.onGround && player.jumpBuffer === 0) {
      player.jumpBuffer = JUMP_BUFFER;
    }
    if (player.jumpBuffer > 0) player.jumpBuffer--;

    // 4. GRAVITY — asymmetric: lighter going up, heavier coming down
    player.vy += (player.vy < 0) ? GRAVITY_RISE : GRAVITY_FALL;
    player.vy  = Math.min(player.vy, 18); // terminal velocity

    // 5. COYOTE TIME
    if (player.onGround) { player.coyoteTimer = COYOTE_FRAMES; }
    else if (player.coyoteTimer > 0) { player.coyoteTimer--; }

    // 6. MOVE & COLLIDE
    player.x += player.vx;
    player.y += player.vy;
    player.onGround = false;
    resolveCollisions(); // tile AABB collision — sets onGround=true when landing

    // 7. SPRITE STATE
    if (!player.onGround)      player.state = player.vy < 0 ? 'jump' : 'fall';
    else if (Math.abs(player.vx) > 0.1) player.state = player.running ? 'run' : 'walk';
    else                       player.state = 'idle';

    // 8. ANIMATION — frame advances faster when running
    player.frameTick++;
    const frameRate = player.running ? 4 : 7;
    if (player.frameTick >= frameRate) { player.frameTick = 0; player.spriteFrame = (player.spriteFrame+1)%3; }
  }

  ── DRAW PLAYER AS PIXEL-ART CHARACTER ────────────────
  // Draw a recognizable character — hat, face, body, overalls
  // Use ctx.save()/restore() + ctx.scale(-1,1) to flip when facing left
  function drawPlayer(ctx) {
    ctx.save();
    ctx.translate(player.x + player.w/2, player.y + player.h/2);
    if (player.facing === -1) ctx.scale(-1, 1);
    const x = -player.w/2, y = -player.h/2;
    // Hat
    ctx.fillStyle = '#CC0000'; ctx.fillRect(x+4, y, 20, 8);
    ctx.fillStyle = '#CC0000'; ctx.fillRect(x+2, y+8, 24, 6);
    // Face
    ctx.fillStyle = '#F4A460'; ctx.fillRect(x+4, y+14, 20, 12);
    // Eyes
    ctx.fillStyle = '#000';    ctx.fillRect(x+8, y+16, 4, 4);
    // Overalls
    ctx.fillStyle = '#0000CC'; ctx.fillRect(x+4, y+26, 20, 10);
    ctx.fillStyle = '#CC0000'; ctx.fillRect(x+6, y+26, 16, 6);
    // Feet (animate walk cycle)
    ctx.fillStyle = '#4B2F0A';
    if (player.state === 'idle' || player.state === 'jump' || player.state === 'fall') {
      ctx.fillRect(x+4, y+36, 10, 6); ctx.fillRect(x+14, y+36, 10, 6);
    } else {
      const kick = player.spriteFrame === 1 ? 4 : 0;
      ctx.fillRect(x+4,  y+36+kick, 10, 6);
      ctx.fillRect(x+14, y+36-kick, 10, 6);
    }
    ctx.restore();
  }

  ── TILE COLLISION (AABB, copy exactly) ───────────────
  function resolveCollisions() {
    const col1 = Math.floor(player.x / TILE_SIZE);
    const col2 = Math.floor((player.x + player.w - 1) / TILE_SIZE);
    const row1 = Math.floor(player.y / TILE_SIZE);
    const row2 = Math.floor((player.y + player.h - 1) / TILE_SIZE);
    for (let r = row1; r <= row2; r++) {
      for (let c = col1; c <= col2; c++) {
        const tile = currentLevel[r]?.[c];
        if (!tile || tile === 0 || tile === 3 || tile === 4) continue; // air/coin/spawn = passable
        const tx = c*TILE_SIZE, ty = r*TILE_SIZE;
        const overlapX = (player.x + player.w) - tx;
        const overlapY = (player.y + player.h) - ty;
        const dx = (player.x + player.w/2) - (tx + TILE_SIZE/2);
        const dy = (player.y + player.h/2) - (ty + TILE_SIZE/2);
        if (Math.abs(dx)/TILE_SIZE > Math.abs(dy)/TILE_SIZE) {
          player.x -= overlapX * Math.sign(dx); player.vx = 0;
        } else {
          player.y -= overlapY * Math.sign(dy); player.vy = 0;
          if (dy < 0) player.onGround = true; // landed on top
        }
      }
    }
  }

  ── ENEMY AI (copy for goomba-style patrol) ───────────
  // enemy object: { x, y, vx:-1.2, vy:0, w:32, h:32, alive:true, type:'goomba', flat:false, flatTimer:0 }
  function updateEnemy(e) {
    if (!e.alive) return;
    e.vy += GRAVITY_FALL;
    e.x += e.vx; e.y += e.vy;
    // Reverse at edges / walls
    const cAhead = Math.floor((e.x + (e.vx > 0 ? e.w : 0)) / TILE_SIZE);
    const rFoot  = Math.floor((e.y + e.h + 1) / TILE_SIZE);
    const rHead  = Math.floor(e.y / TILE_SIZE);
    const atWall = currentLevel[rHead]?.[cAhead] > 0;
    const noFloor= !currentLevel[rFoot]?.[cAhead];
    if (atWall || noFloor) e.vx *= -1;
    // Stomp check: player lands on enemy from above
    const overlap = rectsOverlap(player, e);
    if (overlap && player.vy > 0 && player.y + player.h < e.y + e.h/2) {
      e.alive = false; player.vy = -8; player.score += 200;
      playSound(180, 'sawtooth', 0.18, 0.5);
      spawnParticles(e.x+e.w/2, e.y, '#8B4513', 6);
    } else if (overlap && e.alive) {
      playerDie();
    }
  }

  ── WEB AUDIO SFX (copy exactly) ──────────────────────
  const audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  function playSound(freq, type, dur, vol=0.3, freqEnd=null) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = type; o.frequency.setValueAtTime(freq, audioCtx.currentTime);
    if (freqEnd) o.frequency.linearRampToValueAtTime(freqEnd, audioCtx.currentTime + dur);
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.start(); o.stop(audioCtx.currentTime + dur);
  }
  // Coin collect: two-note jingle
  function playCoinSfx() {
    playSound(988, 'square', 0.08, 0.3);
    setTimeout(() => playSound(1319, 'square', 0.12, 0.3), 80);
  }
  // Game over: descending glide
  function playGameOverSfx() { playSound(440, 'sawtooth', 0.8, 0.4, 110); }
  // Level complete: C-E-G-C arpeggio
  function playLevelClearSfx() {
    [523,659,784,1047].forEach((f,i) => setTimeout(()=>playSound(f,'square',0.15,0.35), i*120));
  }

  ── PARTICLES (add life to every event) ───────────────
  const particles = [];
  function spawnParticles(x, y, color, count=8) {
    for (let i=0; i<count; i++) {
      const angle = (Math.PI*2/count)*i;
      particles.push({ x, y, vx: Math.cos(angle)*3, vy: Math.sin(angle)*3-2,
                        life:1, color, r:4 });
    }
  }
  function updateParticles() {
    for (let i=particles.length-1; i>=0; i--) {
      const p=particles[i]; p.x+=p.vx; p.y+=p.vy; p.vy+=0.15; p.life-=0.04;
      if (p.life<=0) particles.splice(i,1);
    }
  }
  function drawParticles(ctx) {
    particles.forEach(p=>{
      ctx.save(); ctx.globalAlpha=p.life;
      ctx.fillStyle=p.color; ctx.beginPath();
      ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill(); ctx.restore();
    });
  }

  ── TILE DRAWING — look like real Mario tiles ─────────
  function drawTile(ctx, tileId, x, y) {
    if (tileId === 1) { // Ground block
      ctx.fillStyle='#C84B10'; ctx.fillRect(x,y,TILE_SIZE,TILE_SIZE);
      ctx.strokeStyle='#8B2E00'; ctx.lineWidth=2; ctx.strokeRect(x+1,y+1,TILE_SIZE-2,TILE_SIZE-2);
      ctx.fillStyle='#E0601A';
      ctx.fillRect(x+3,y+3,TILE_SIZE-6,10); ctx.fillRect(x+3,y+TILE_SIZE-13,TILE_SIZE-6,10);
    } else if (tileId === 2) { // Brick
      ctx.fillStyle='#B84020'; ctx.fillRect(x,y,TILE_SIZE,TILE_SIZE);
      ctx.strokeStyle='#D4D4A0'; ctx.lineWidth=2;
      ctx.strokeRect(x+1,y+1,TILE_SIZE/2-2,TILE_SIZE/2-2);
      ctx.strokeRect(x+TILE_SIZE/2+1,y+1,TILE_SIZE/2-2,TILE_SIZE/2-2);
      ctx.strokeRect(x+4,y+TILE_SIZE/2+1,TILE_SIZE/2-2,TILE_SIZE/2-2);
    } else if (tileId === 3) { // Coin — animated gold arc
      const bob = Math.sin(Date.now()*0.005)*3;
      ctx.fillStyle='#FFD700'; ctx.beginPath();
      ctx.arc(x+TILE_SIZE/2, y+TILE_SIZE/2+bob, 10, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle='#FFF176'; ctx.beginPath();
      ctx.arc(x+TILE_SIZE/2-3, y+TILE_SIZE/2+bob-3, 4, 0, Math.PI*2); ctx.fill();
    } else if (tileId === 5) { // Goal flag
      ctx.strokeStyle='#888'; ctx.lineWidth=3;
      ctx.beginPath(); ctx.moveTo(x+TILE_SIZE/2,y+4); ctx.lineTo(x+TILE_SIZE/2,y+TILE_SIZE-4); ctx.stroke();
      ctx.fillStyle='#00CC00'; ctx.beginPath();
      ctx.moveTo(x+TILE_SIZE/2,y+4); ctx.lineTo(x+TILE_SIZE-4,y+14); ctx.lineTo(x+TILE_SIZE/2,y+24); ctx.fill();
    }
  }

  ── CANVAS + LEVEL DIMENSIONS — CRITICAL, READ THIS FIRST ─
  // Canvas height MUST equal (number of rows in level) × TILE_SIZE.
  // Mismatch = player spawns underground or floats in air. Never hard-code y:300.
  //
  // STANDARD SETUP — copy exactly:
  //   const TILE_SIZE = 40;
  //   const ROWS = 12;   // level arrays must have EXACTLY 12 rows
  //   const COLS = 60;   // each row must have EXACTLY 60 columns
  //   canvas.width  = 800;           // visible area (camera scrolls the level)
  //   canvas.height = ROWS * TILE_SIZE;  // = 480 — ALWAYS derive height this way
  //
  // PLAYER SPAWN — NEVER hard-code player.y. Always use resetLevel():
  function resetLevel() {
    const lvl = LEVELS[levelIndex];
    // Find the topmost solid tile in column 2 and place player just above it
    let spawnRow = lvl.length - 1;
    for (let r = 0; r < lvl.length; r++) {
      if (lvl[r][2] === 1 || lvl[r][2] === 2) { spawnRow = r; break; }
    }
    player.x = 2 * TILE_SIZE;
    player.y = spawnRow * TILE_SIZE - player.h - 1;  // 1px gap so gravity engages
    player.vx = 0; player.vy = 0;
    player.onGround = false; player.coyoteTimer = 0; player.jumpBuffer = 0;
    // Re-spawn enemies from spawn tiles in the level
    enemies = [];
    coins   = [];
    lvl.forEach((row, r) => row.forEach((tile, c) => {
      if (tile === 4) enemies.push({ x:c*TILE_SIZE, y:r*TILE_SIZE, vx:-1, vy:0, w:32, h:32, alive:true });
      if (tile === 3) coins.push(  { x:c*TILE_SIZE+8, y:r*TILE_SIZE+8, r:10, collected:false });
    }));
    cameraX  = 0;
    timeLeft = 200;
  }

  ── LEVEL FORMAT (12 rows × 60 cols) ──────────────────
  // 0=air  1=solid-ground  2=brick-platform  3=coin  4=enemy-spawn  5=goal
  // ⚠️ EVERY level array MUST have exactly 12 rows and 60 columns.
  //    Row 10 and row 11 are the main ground. Goal (5) goes in row 0 at column 59.
  //    Rows 0-1: sky / high goal area
  //    Rows 2-5: high platforms and coins
  //    Rows 6-9: mid/low platforms, enemies
  //    Rows 10-11: solid ground (MUST be solid = 1 across most columns)
  //
  // ⚠️ MINIMUM 3 complete levels. Level 1 = easy, Level 2 = medium, Level 3 = hard.
  //
  // VERIFIED WORKING EXAMPLE — all 12 rows × 60 columns, player spawns correctly:
  const LEVELS = [
    [ // LEVEL 1 — easy: wide ground, low platforms, few enemies, lots of coins
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,2,0,0,0,0,0,0,0,0,0,0,0,2,2,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,2,2,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,3,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,4,0,0,0,0,0,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,4,0,0,0,0,0,0,0,0,4,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    ],
    [ // LEVEL 2 — medium: gaps in ground, more enemies, harder platform jumps
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,2,2,2,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,0,0,0,0,3,0,3,0,0,0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,2,2,2,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,2,2,2,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,3,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,4,0,0,0,0,0,4,0,0,0,0,0,4,0,0,0,0,0,0,4,0,0,0,0,4,0,0,0,0,4,0,0,0,0,0,4,0,0,0,0,4,0,0,0,4,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,1,1,1,1,1,1,1,1,1,1,0,0,0,1,1,1,1,1,1,0,0,0,1,1,1,1,1,1,1,0,0,1,1,1,1,1,1,1,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
      [1,1,1,1,1,1,1,1,1,1,1,0,0,0,1,1,1,1,1,1,0,0,0,1,1,1,1,1,1,1,0,0,1,1,1,1,1,1,1,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    ],
    [ // LEVEL 3 — hard: many gaps, dense enemies, tight platforms
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,2,2,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,2,2,2,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0],
      [0,0,0,0,3,0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,0,3,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,2,2,0,0],
      [0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,4,0,0,0,4,0,0,4,0,0,0,4,0,0,4,0,0,0,4,0,4,0,0,0,4,0,0,4,0,0,4,0,0,0,4,0,0,4,0,0,0,4,0,4,0,0,0,4,0,0,4,0,0,0,4,0,0,4,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,1,1,0,0,1,1,0,0,0,1,1,1,0,0,1,1,0,0,1,1,0,0,0,1,1,1,0,0,1,1,1,0,0,1,1,0,0,1,1,1,0,0,1,1,1,0,0,1,1,0,0,1,1,1,0,0,1,1,1],
      [1,1,1,0,0,1,1,0,0,0,1,1,1,0,0,1,1,0,0,1,1,0,0,0,1,1,1,0,0,1,1,1,0,0,1,1,0,0,1,1,1,0,0,1,1,1,0,0,1,1,0,0,1,1,1,0,0,1,1,1],
    ],
  ];

  ── PARALLAX BACKGROUND (3 layers, always draw first) ─
  // bgOffset increases each frame proportional to cameraX
  function drawBackground(ctx, cameraX) {
    // Sky
    ctx.fillStyle='#5C94FC'; ctx.fillRect(0,0,canvas.width,canvas.height);
    // Far mountains (0.2x parallax)
    ctx.fillStyle='#6A9FFF';
    for (let i=0; i<8; i++) {
      const mx = (i*200 - cameraX*0.2) % (canvas.width+200);
      ctx.beginPath(); ctx.moveTo(mx,canvas.height*0.6);
      ctx.lineTo(mx+100,canvas.height*0.3); ctx.lineTo(mx+200,canvas.height*0.6); ctx.fill();
    }
    // Near hills (0.5x parallax)
    ctx.fillStyle='#3D8B00';
    for (let i=0; i<6; i++) {
      const hx = (i*280 - cameraX*0.5) % (canvas.width+280);
      ctx.beginPath(); ctx.arc(hx+140, canvas.height*0.72, 120, Math.PI, 0); ctx.fill();
    }
  }

  ── BACKGROUND MUSIC (Web Audio — copy exactly) ────────
  // ⚠️ USE THE SAME audioCtx as SFX — only ONE AudioContext per game, ever.
  // Do NOT create a second AudioContext for music. Reuse the one from playSound().
  //
  // SINGLE AudioContext setup (declare ONCE at the top of your script):
  //   const audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  //
  // Music uses pre-scheduled notes via audioCtx.currentTime (no setInterval needed).
  // Call startMusic() on entering PLAYING state, stopMusic() on any exit.
  const MELODY = [523,659,784,1047,784,659,523,440,523,659,784,659,523,392,440,523];
  const BASS   = [131,131,165,196,131,131,165,196,131,131,165,196,131,131,165,196];
  let melodyStep = 0, musicTimer = null;
  function startMusic() {
    if (musicTimer) return; // guard: never double-start
    if (audioCtx.state === 'suspended') audioCtx.resume();
    function tick() {
      if (!musicTimer) return; // stopped while waiting
      const now = audioCtx.currentTime;
      const o1 = audioCtx.createOscillator(), g1 = audioCtx.createGain();
      o1.connect(g1); g1.connect(audioCtx.destination);
      o1.type = 'square';
      o1.frequency.value = MELODY[melodyStep % MELODY.length];
      g1.gain.setValueAtTime(0.06, now);
      g1.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      o1.start(now); o1.stop(now + 0.2);
      const o2 = audioCtx.createOscillator(), g2 = audioCtx.createGain();
      o2.connect(g2); g2.connect(audioCtx.destination);
      o2.type = 'triangle';
      o2.frequency.value = BASS[melodyStep % BASS.length];
      g2.gain.setValueAtTime(0.07, now);
      g2.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      o2.start(now); o2.stop(now + 0.26);
      melodyStep++;
      musicTimer = setTimeout(tick, 260);
    }
    musicTimer = true; // mark as started before first tick
    tick();
  }
  function stopMusic() {
    if (musicTimer && musicTimer !== true) clearTimeout(musicTimer);
    musicTimer = null;
  }
  // Call startMusic() when entering PLAYING, stopMusic() when leaving.

  ── WIN / GAME-OVER RESET — MANDATORY (prevents stuck screen) ─
  // ⚠️ NEVER leave the player on a static WIN or GAME_OVER screen with no way out.
  // Copy this pattern EXACTLY for both states:
  //
  // LEVEL COMPLETE (reached tile 5):
  //   gameState = 'LEVEL_COMPLETE';
  //   stopMusic();
  //   playSound(1047,'square',0.6,0.4); // fanfare
  //   setTimeout(() => {
  //     levelIndex = (levelIndex + 1) % LEVELS.length; // wrap to level 1 after last
  //     resetLevel();           // resets enemies, coins, player position
  //     gameState = 'PLAYING';
  //     startMusic();
  //   }, 2500);                 // 2.5 s celebration pause — then auto-advance
  //
  // GAME OVER (lives === 0):
  //   gameState = 'GAME_OVER';
  //   stopMusic();
  //   playSound(150,'sawtooth',1.2,0.5);
  //   setTimeout(() => {
  //     player.lives = 3; player.score = 0; player.coins = 0;
  //     levelIndex = 0;
  //     resetLevel();
  //     gameState = 'MENU';     // return to menu — never a dead end
  //   }, 3000);
  //
  // WIN (all levels cleared):
  //   gameState = 'WIN';
  //   stopMusic();
  //   setTimeout(() => {
  //     player.lives = 3; player.score = 0; player.coins = 0;
  //     levelIndex = 0;
  //     resetLevel();
  //     gameState = 'MENU';     // loop back to menu for replay
  //   }, 4000);
  //
  // Space / tap always cancels the delay and jumps straight to MENU when on
  // a terminal screen (GAME_OVER or WIN) so players are never truly stuck.

  ── HUD — draw every frame, always on top ─────────────
  function drawHUD(ctx) {
    ctx.save();
    ctx.font = 'bold 16px "Courier New"';
    ctx.shadowColor='#000'; ctx.shadowBlur=4;
    ctx.fillStyle='#fff';
    ctx.fillText('SCORE: ' + String(player.score).padStart(6,'0'), 16, 28);
    ctx.fillText('LIVES: ' + String.fromCodePoint(0x2665).repeat(player.lives), 16, 50);
    ctx.fillText('COINS: ' + player.coins, 16, 72);
    ctx.fillText('LEVEL: ' + (levelIndex+1), canvas.width-130, 28);
    ctx.fillText('TIME:  ' + Math.max(0, Math.ceil(timeLeft)), canvas.width-130, 50);
    ctx.restore();
  }

  ── GAME SCREEN RENDERS (all on canvas, NO HTML overlays) ─
  function drawMenuScreen(ctx) {
    ctx.fillStyle='rgba(0,0,0,0.72)'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#FFD700'; ctx.font='bold 64px "Courier New"';
    ctx.textAlign='center'; ctx.fillText('SUPER', canvas.width/2, canvas.height/2-80);
    ctx.fillText('[GAME TITLE]', canvas.width/2, canvas.height/2-10);
    ctx.fillStyle='#fff'; ctx.font='22px "Courier New"';
    if (Math.floor(Date.now()/600)%2) ctx.fillText('PRESS SPACE TO START', canvas.width/2, canvas.height/2+70);
    ctx.textAlign='left';
  }

  MANDATORY GAME ARCHITECTURE SUMMARY:
  • requestAnimationFrame game loop with delta-time
  • Full state machine: MENU → PLAYING ↔ PAUSED → GAME_OVER / LEVEL_COMPLETE → WIN
  • Physics from the MARIO PHYSICS BIBLE above — copy constants EXACTLY (especially slow speeds)
  • MINIMUM 3 tile-map levels — Level 1 easy, Level 2 medium, Level 3 hard (use the examples above)
  • 2+ enemy types with patrol AI + stomp-kill detection
  • ✅ BACKGROUND MUSIC — startMusic() on PLAYING, stopMusic() on exit (copy the Web Audio example above)
  • ✅ NO STUCK SCREENS — WIN / GAME_OVER MUST auto-reset after ≤4 seconds (copy the reset pattern above)
  • ✅ LEVEL COMPLETE auto-advances to next level — levelIndex wraps back to 0 after last level
  • All SFX from Web Audio API (no external audio files)
  • Particles on every important event
  • Parallax 3-layer background
  • HUD drawn on canvas every frame
  • All game screens drawn on canvas (no HTML overlays)
  • Keyboard + on-canvas mobile touch buttons (arrow left/right + jump)

  PROFILE F BANNED:
  ✗ Instant velocity (vx=4) instead of acceleration — makes movement feel cheap
  ✗ Same gravity up and down — kills the floaty Mario jump arc
  ✗ Missing coyote time — players fall off edges before they can jump
  ✗ Missing variable jump height — every jump identical is boring
  ✗ CSS animations pretending to be a game — must use canvas
  ✗ HTML elements moving around the page
  ✗ setTimeout/setInterval for game loop (use requestAnimationFrame)
  ✗ Only 1 level — minimum 3 levels required, each distinct
  ✗ Enemies that don't move or interact
  ✗ No background music — silent games feel dead
  ✗ Stuck WIN / GAME_OVER screen with no way to continue — ALWAYS auto-reset
  ✗ A plain colored square as the player

PROFILE S — SHOP / PRODUCT STORE / E-COMMERCE
  Use for: ANY request containing shop, store, buy, sell, product, price, payment, checkout, cart, e-commerce, Stripe, PayPal, order, purchase.
  ⚠️  This profile builds a fully-functional static shop — not a fake demo.

  ══════════════════════════════════════════════════════════════
  PRODUCT IMAGE RULE — THE MOST IMPORTANT RULE IN THIS PROFILE
  ══════════════════════════════════════════════════════════════
  Every product image MUST show the actual product being sold.
  For a CANDLE shop: every product photo must show a candle or wax. Not lemons. Not fruit. Not plants. Not armchairs. Not abstract textures. Not food. CANDLES ONLY.
  For a JEWELLERY shop: rings, necklaces, bracelets. Not random lifestyle photos.
  For a CLOTHING shop: the actual garment being worn or laid flat.
  For a FOOD shop: the actual dish or ingredient.

  CANDLE SHOP — USE THESE VERIFIED PEXELS PHOTO IDs (confirmed candle images, tested and loading):
    Product 1: https://images.pexels.com/photos/3270223/pexels-photo-3270223.jpeg  ✅ white pillar candle
    Product 2: https://images.pexels.com/photos/6707628/pexels-photo-6707628.jpeg  ✅ dark jar candle
    Product 3: https://images.pexels.com/photos/3270224/pexels-photo-3270224.jpeg  ✅ grouped candles
    Product 4: https://images.pexels.com/photos/3270222/pexels-photo-3270222.jpeg  ✅ candle lifestyle
    Product 5: https://images.pexels.com/photos/5765418/pexels-photo-5765418.jpeg  ✅ scented candle
    Hero:      https://images.pexels.com/photos/4207892/pexels-photo-4207892.jpeg  ✅ candle/lifestyle hero
    About:     https://images.pexels.com/photos/3270223/pexels-photo-3270223.jpeg  ✅ (reuse if needed)
  ⛔ NEVER USE these IDs — they return blank/gradient (broken links): 9898025, 7330046, 7195133, 6634653, 3951746
  ALL Pexels URLs must include: ?auto=compress&cs=tinysrgb&w=800
  If any image fails to load, the onerror gradient should use warm amber: linear-gradient(135deg,#D98A70,#8B4513)

  JEWELLERY SHOP — verified Pexels IDs: 1457801, 2735970, 1458867, 1191531, 3812433
  CLOTHING SHOP — verified Pexels IDs: 1536619, 2220316, 2220329, 3622608, 996329
  FOOD SHOP — use photos matching the specific dish name.

  SPACE / AEROSPACE / ROCKET COMPANY SITE — VISUALLY-VERIFIED PEXELS IDs (each confirmed by opening the actual Pexels page):
    Hero / stars background:  1169754  ✅ Milky Way galaxy, thousands of stars, deep blue/dark sky — STUNNING hero
    Rocket launch:            2159     ✅ Space shuttle launching with massive fire & smoke trail — dramatic
    Spacecraft in orbit:      586063   ✅ SpaceX Dragon capsule orbiting above Earth's surface — real space photo (uploaded by SpaceX)
    Earth from moon:          87009    ✅ Earth rising over the lunar surface — iconic NASA Earthrise style
    Astronaut on moon:        39896    ✅ Astronaut in spacesuit on moon surface with American flag and lunar module
  ⚠️ DO NOT use Pexels for "team member" cards on a space/tech site — use CSS gradient avatar cards with initials instead
  ⚠️ Colour palette for space sites: background #000000 or #05050f, accent white #ffffff, secondary #4a9eff (electric blue) or #e8340d (rocket red)
  ⚠️ ALL Pexels URLs must end with: ?auto=compress&cs=tinysrgb&w=1400 for hero, w=800 for cards

  GYM / FITNESS SITE — USE THESE VISUALLY-VERIFIED PEXELS PHOTO IDs (each one confirmed by visual inspection):
    Hero background:        1552242  ✅ real gym interior with weights and equipment racks
    Trainer — male barbell: 1431282  ✅ B&W muscular man holding barbell (intense, dark background)
    Trainer — female yoga:  3076509  ✅ woman stretching on mat, orange leggings, warm light
    Trainer — male dumbbell:3289711  ✅ bearded man curling dumbbell, gym background
    Trainer — male pullup:  4162489  ✅ B&W man doing pull-ups on bar in gym
    Trainer — male squat:   1552106  ✅ shirtless man barbell squat in dark gym
    Trainer — rope climb:   2468339  ✅ man climbing rope in CrossFit gym (dramatic)
    Action — female abs:    416778   ✅ blonde woman doing crunches on blue mat, studio
    Action — cardio:        4944970  ✅ woman's legs running on treadmill, gym background
  ⚠️ CRITICAL — SECTION BACKGROUNDS: NEVER use a solid green (#00FF88) background for entire sections.
     Green is ONLY for: text colour, button fill, border colour, icon, small accent chip. Section BG must be #080808 or #121212.
  ⚠️ ALL Pexels URLs must end with: ?auto=compress&cs=tinysrgb&w=800
  ⛔ NEVER USE these IDs on gym sites — visually confirmed WRONG:
     3822860 = a pink rose on a book (NOT a yoga mat!)
     4397840 = lifestyle flatlay with "WAKE UP & WORKOUT" text sign (has visible text in image)
     4397841 = wrong content, do not use

  CAR DEALERSHIP / AUTO SITE — USE THESE VERIFIED PEXELS PHOTO IDs (confirmed car images, tested and loading):
    Car 1 slot: https://images.pexels.com/photos/112460/pexels-photo-112460.jpeg   ✅ silver sports car (front)
    Car 2 slot: https://images.pexels.com/photos/1149831/pexels-photo-1149831.jpeg ✅ yellow/gold sports car
    Car 3 slot: https://images.pexels.com/photos/170811/pexels-photo-170811.jpeg   ✅ red sports car (side)
    Car 4 slot: https://images.pexels.com/photos/244206/pexels-photo-244206.jpeg   ✅ luxury car (dark)
    Car 5 slot: https://images.pexels.com/photos/3764958/pexels-photo-3764958.jpeg ✅ modern sedan
    Hero:       https://images.pexels.com/photos/1035108/pexels-photo-1035108.jpeg ✅ car on road (wide)
    About/Interior: https://images.pexels.com/photos/210019/pexels-photo-210019.jpeg ✅ showroom / interior
  ⛔ NEVER USE these IDs for a car site — they show wrong content: 10065134 (sunset), 7330046, 5765418
  onerror fallback gradient for cars: linear-gradient(135deg,#1a1a2e,#16213e)

  ⛔ PRODUCT SHOP CARDS — CRITICAL RULE (applies to ALL shop/product card sections on ANY type of site):
  Pexels is a LIFESTYLE photography site. It has NO clean product shots. If you use a random Pexels ID for a
  "Resistance Bands" or "Yoga Mat" product, you will get a random lifestyle photo or (worse) a pink rose.
  INSTEAD, for every product card image, generate a styled CSS gradient placeholder like this:
    <div style="width:100%;aspect-ratio:1;border-radius:12px;background:linear-gradient(135deg,#1a1a2e,#16213e);
         display:flex;align-items:center;justify-content:center;font-size:48px;">🏋️</div>
  Pick the emoji to match the product: 🏋️ weights, 🧘 yoga, 🥊 boxing, 👟 shoes, 💊 supplements, 🩱 clothing etc.
  The gradient + emoji looks clean, professional, and never shows wrong content.
  ONLY exception: if the user's prompt explicitly provides a Pexels URL for a specific product, use that URL.

  ANY OTHER lifestyle/background image — pick Pexels photos matching the site industry. NEVER use citrus, fruit, plants, furniture, scrabble tiles, or abstract textures as background or about-section images.

  ABOUT SECTION IMAGES (non-shop, non-candle, non-car): For restaurant/cafe about: 1640777. For beauty/spa: 3997991. For tech/agency: 3861958. For fitness: 416778. For generic professional: 3182812. NEVER use scrabble tiles, Scrabble letters, word blocks, or letter cubes. NEVER use unrelated lifestyle images for about sections.

  ══════════════════════════════════════════════════════════════
  MANDATORY ARCHITECTURE — include every section below
  ══════════════════════════════════════════════════════════════

  1. HEAD — MANDATORY first three lines inside <head>:
     <link rel="icon" type="image/png" href="">
     <link rel="preconnect" href="https://fonts.googleapis.com">
     (the href="" favicon is intentionally empty — user uploads their icon via patch)

  2. HEADER / NAVBAR — MANDATORY structure:
     <nav> contains:
       LEFT: <img id="site-logo" src="" alt="logo" style="height:36px;width:auto;object-fit:contain;display:none"> then <span class="brand-name">[Brand Name]</span>
       RIGHT: cart button with badge + hamburger button (visible only on mobile)
     MOBILE NAV DRAWER: hidden by default, slides in when hamburger clicked. Contains all nav links.
     Cart badge: <span id="cart-count">0</span> — updated by JS every time cart changes.

  3. HERO — product-relevant background image (see image rules above).
     Headline + tagline + TWO buttons: "Shop Now" (→ #products) and "Our Story" (→ #about).

  4. PRODUCT GRID — CSS grid, auto-fill, minmax(260px,1fr). Each card has:
     ┌─────────────────────────────────────────────┐
     │  [Product image — always shows actual item] │
     │  Product Name          $29.00               │
     │  Short description (2 lines max)            │
     │  [🛒 Add to Cart]  [Buy Now →]              │  ← BOTH buttons ALWAYS VISIBLE
     └─────────────────────────────────────────────┘
     "Add to Cart" → onclick="window.addToCart(id, name, price)"
     "Buy Now" → opens PayPal/Stripe link directly in new tab
     BOTH buttons are ALWAYS VISIBLE — never hidden behind hover.
     WRONG: class="opacity-0 group-hover:opacity-100"  ← FORBIDDEN
     RIGHT:  class="w-full py-3 bg-accent text-white rounded"  ← always visible

  5. CART SYSTEM — appState pattern:
     const appState = { cart: [] };
     localStorage.removeItem('cart_[brandname]');  // clear stale cart on EVERY page load
     window.addToCart = function(id, name, price) { ... appState.cart ... renderCart(); updateBadge(); };
     window.toggleCart = function() { ... show/hide drawer ... };
     window.removeItem = function(id) { ... };
     window.changeQty = function(id, delta) { ... };
     window.checkout = function() {
       const total = appState.cart.reduce((s,i) => s + i.price*i.qty, 0);
       window.open('https://paypal.me/USERNAME/' + total.toFixed(2), '_blank');
     };
     Cart drawer shows: item list + subtotal ($X.XX) + "Checkout" button + "Continue Shopping" link.
     Empty state: "🛒 Your cart is empty" centred in drawer.

  6. CONTACT SECTION — real contact info, NOT a newsletter or email subscription form:
     Heading: "Get in Touch"
     Three info blocks: 📧 Email · 📱 Phone · 📍 Location
     Use the real email/phone if provided. Otherwise: hello@[brandname].com / +1 (555) 000-0000 / [City, Country]
     Optional simple mailto: form below the info blocks.
     NEVER show a "Subscribe to our newsletter" input here.

  7. TRUST ROW — one line: 🔒 SSL Secured · 💳 PayPal / Visa / Mastercard · 🔄 Easy Returns · ⭐ 5-Star Reviews

  8. FOOTER:
     Social row — every external link MUST have target="_blank" rel="noopener noreferrer":
     Instagram: <a href="https://instagram.com/[brandname]" target="_blank" rel="noopener noreferrer"><i data-lucide="instagram"></i></a>
     TikTok:    <a href="https://tiktok.com/@[brandname]" target="_blank" rel="noopener noreferrer">[TikTok SVG below]</a>
     TikTok SVG: <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.17 8.17 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z"/></svg>
     PayPal / Stripe buttons: also MUST have target="_blank" rel="noopener noreferrer"
     Copyright: <script>document.write('© ' + new Date().getFullYear() + ' [Brand]. All rights reserved.');</script>

  REVEAL ANIMATION — CORRECT pattern (copy exactly):
  /* CSS */
  .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.6s ease, transform 0.6s ease; }
  .reveal.visible { opacity: 1; transform: translateY(0); }
  /* JS inside IIFE */
  const io = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) { if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } });
  }, { threshold: 0.1 });
  document.querySelectorAll('.reveal').forEach(function(el) { io.observe(el); });
  NEVER write: .reveal { opacity: 1; }  ← elements start visible, animation never runs.

  PROFILE S JAVASCRIPT — IIFE + WINDOW FUNCTIONS (mandatory):
  ALL script logic inside ONE IIFE: (function(){ ... })();
  Every onclick function on window: window.toggleCart = function() { ... };
  NEVER: function toggleCart() { ... }  ← breaks on patch updates.

  PROFILE S VISUAL STYLE:
  Light background (#FAFAFA), product cards: white, 1px border, 8px radius, shadow-sm, hover lift.
  Accent: brand color from request or default #D97706 (warm amber).
  Add to Cart: full-width, solid accent, white text, 44px height.
  Buy Now: full-width, outline/ghost style, same accent color, 44px height.
  Cart badge: red circle (#EF4444) top-right of cart icon.

  PROFILE S BANNED — ZERO TOLERANCE:
  ✗ Product images that don't show the actual product (fruit for candles, chairs for candles, etc.)
  ✗ Hero or About section images unrelated to the product category
  ✗ Add to Cart hidden behind hover: opacity-0 group-hover:opacity-100 — FORBIDDEN
  ✗ Only one button per product — need both Add to Cart AND Buy Now, both always visible
  ✗ Cart badge hardcoded in HTML ("0") without JS updating it
  ✗ let cart = [] bare global — use appState pattern
  ✗ paypal.me/SOMEONE/0 — amount must be dynamic via JS total.toFixed(2)
  ✗ .reveal { opacity: 1 } — always start at opacity: 0
  ✗ @keyframes animation that conflicts with IntersectionObserver opacity:0 start
  ✗ Newsletter / email subscription form in contact section
  ✗ Copyright year hardcoded as any number — always use new Date().getFullYear()
  ✗ No favicon <link rel="icon"> in head
  ✗ No <img id="site-logo"> in navbar
  ✗ No mobile hamburger menu
  ✗ TikTok shown as Lucide music-2 icon — use the SVG path above
  ✗ localStorage not cleared on load — always clear stale cart on every page load

  ══════════════════════════════════════════════════════════════
  PROFILE S-ADMIN — AMAZON-STYLE OWNER-MANAGED SHOP
  Activate when user says: "add products", "manage products", "admin panel", "Amazon style",
  "edit price", "delete product", "create offer", "my own products", "admin dashboard".
  ══════════════════════════════════════════════════════════════

  Build a DUAL-MODE site — customer storefront + owner admin panel — all in one HTML file.
  Products are stored in localStorage as JSON, so the owner's catalog persists in their browser.

  ADMIN PANEL (hidden by default, revealed by clicking the logo 3× or pressing Alt+A):
  1. Simple password gate (default password: "admin123" — shown in the panel so owner can change it).
  2. "Add Product" form — fields: Product Name, Price ($), Original Price (for sale badge), Description, Image URL or 📁 Upload Image button (FileReader → base64 into localStorage).
  3. Product list table — rows show: thumbnail, name, price, offer%. Each row has:
       • ✏️ Edit (inline edit of name, price, offer%)
       • 🗑️ Delete (removes from localStorage, re-renders storefront)
       • 🏷️ Set Offer % (e.g. 20 → shows "SALE −20%" red badge on the card, crossed-out original price)
  4. "Preview Store" button that closes admin and shows the storefront.
  5. Save button writes the products array to localStorage key "snap_products".

  STOREFRONT (customer view):
  • On load, read products from localStorage key "snap_products".
  • If localStorage is empty, show a starter set of 3 demo products so the store never looks empty.
  • Product cards: image, name, offer badge (if any), crossed-out original price + sale price, "🛒 Add to Cart" + "Buy Now" buttons.
  • Cart drawer and Stripe/PayPal checkout as in standard PROFILE S.

  DATA SCHEMA (store in localStorage["snap_products"] as JSON array):
  [{ id, name, price, originalPrice, offerPct, description, imageData, stripeLink, paypalLink }]

  PROFILE S-ADMIN BANNED:
  ✗ Requiring a server or database — everything lives in the browser localStorage
  ✗ Admin panel visible to customers without the secret gesture/shortcut
  ✗ Image uploads that fail silently — show a preview thumbnail after upload
  ✗ More than 100 products (localStorage has ~5MB limit; warn the owner at 80 products)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STEP 2 — UNIVERSAL QUALITY RULES (ALL profiles)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

① TYPOGRAPHY HIERARCHY — never same font-size for different levels:
   H1: clamp(2.8rem,6vw,5rem) | H2: clamp(1.8rem,3.5vw,3rem) | H3: 1.25rem | Body: 1rem/1.7

② REAL IMAGERY — use Pexels CDN (always works, no CORS). NEVER make up a photo ID.
   Format: https://images.pexels.com/photos/{ID}/pexels-photo-{ID}.jpeg?auto=compress&cs=tinysrgb&w=1200
   For smaller cards use w=800 instead of w=1200.
   Always set: object-fit:cover; width:100%; height:100% on every img element. Descriptive alt text required.

   ⚠️ PHOTO UNIQUENESS — CRITICAL: You must choose DIFFERENT Pexels photo IDs every single build.
   BANNED IDs (overused — never use these): 1181671, 3184465, 3184291, 3182812, 1181244, 3184292,
   3182781, 1181345, 3184311, 3183150, 3184405, 3184418, 3183197, 1181290, 1181672, 3184293.
   Choose photo IDs that are thematically specific to this EXACT topic — not generic office/laptop shots.
   Use high, varied ID numbers (above 10000000) for fresh, less commonly used photos.

   BROKEN IMAGE PROTECTION — every <img> MUST have an onerror handler:
   <img src="https://images.pexels.com/photos/{ID}/pexels-photo-{ID}.jpeg?auto=compress&cs=tinysrgb&w=1200"
        alt="descriptive text"
        onerror="this.style.display='none';this.parentElement.style.background='linear-gradient(135deg,#1a1a2e 0%,#16213e 100%)'"
        style="object-fit:cover;width:100%;height:100%">
   The onerror hides the broken <img> tag and replaces it with a dark gradient on the parent div,
   keeping layout intact. Adapt the gradient colours to match the site's palette.
   NEVER leave an <img> without onerror — broken image icons destroy the visual quality of the site.

   VERIFIED PEXELS IDs — pick the closest match to the content:

   🍊 FOOD / WELLNESS / NUTRITION:
   1640777  — vibrant healthy food spread, hero-worthy
   1132047  — red berries macro
   1367240  — walnuts close-up
   1640775  — green salad bowl, fresh
   1640774  — colorful vegetables flatlay
   1640773  — fruit and greens arrangement
   1092730  — avocado and greens
   1279330  — mushrooms macro close-up
   1410235  — superfood smoothie bowl
   3493777  — citrus cross-section macro

   🧘 HEALTH / LIFESTYLE / WELLNESS:
   3822621  — yoga pose, calm, outdoor
   3757942  — meditation, seated, serene
   3757954  — wellness lifestyle, warm light
   4056723  — supplements, capsules on clean surface
   3958794  — active healthy woman, running

   💻 TECH / SAAS / PRODUCTIVITY:
   574071   — laptop on clean desk, minimal
   1181244  — code on screen, developer
   92904    — workspace with monitor
   577585   — startup team working, modern office
   3861969  — abstract technology blue

   🎨 ABSTRACT / GRADIENT / BACKGROUNDS:
   1103970  — purple-teal gradient, abstract
   1266808  — warm orange abstract bokeh
   4559555  — soft pastel gradient texture
   3585078  — dark moody abstract

   🌿 NATURE / OUTDOOR:
   414612   — forest green path, sunlight
   158028   — mountain lake, still water
   255379   — green leaves macro, nature
   33109    — ocean waves, horizon
   2387793  — wildflower meadow

   👥 PEOPLE / PORTRAITS:
   774909   — professional woman, confident, natural light
   220453   — smiling man, warm tone
   1239291  — person at work, casual focus
   2379004  — team meeting, diverse, modern
   3184292  — woman laughing, natural outdoor light
   3184338  — man presenting, confident boardroom
   3184465  — diverse team collaboration, bright office
   1181686  — close-up woman, editorial portrait
   2381069  — entrepreneur at laptop, cafe setting

   🏙️ ARCHITECTURE / LIFESTYLE / MODERN:
   1105766  — modern minimal interior, white walls
   1571460  — clean product on marble surface
   3184394  — open plan bright office
   2422278  — aerial city, modern skyline
   1181354  — minimalist workspace, flat lay
   3182812  — creative studio, wide shot
   1591060  — luxury hotel lobby, editorial

   📱 PRODUCT / TECH (LIGHT):
   3861969  — abstract technology, light version
   3182781  — hands holding phone, lifestyle
   2312369  — flat lay tech devices, clean desk
   1779487  — app on screen, bright modern
   3183197  — product photography, white surface

③ ICONS — inline SVG only (1.5px stroke, no fill), never emoji in professional contexts:
   Tech: terminal brackets, arrows, circuits | Wellness: leaf, drop, helix, sprout, shield | Luxury: minimal geometric

④ SCROLL ANIMATIONS — SAFETY RULE (blank sections = broken site):
   COPY THIS EXACTLY — do not invent a different pattern:

   CSS (inside <style>):
     /* .reveal has NO opacity:0 — content is always visible if JS fails */
     .reveal.visible { animation: revealUp 0.7s cubic-bezier(0.16,1,0.3,1) both; }
     @keyframes revealUp { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:none; } }

   JS (inside your IIFE — see ⑤ for the required IIFE wrapper):
     const _io = new IntersectionObserver(entries => entries.forEach(e => {
       if (e.isIntersecting) { e.target.classList.add('visible'); _io.unobserve(e.target); }
     }), { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
     document.querySelectorAll('.reveal').forEach(el => _io.observe(el));
     // MANDATORY safety net — forces all elements visible after 1s even if observer never fires:
     setTimeout(function(){ document.querySelectorAll('.reveal').forEach(function(el){ el.style.opacity='1'; el.style.transform='none'; }); }, 1000);

   WHY THIS PATTERN IS SAFE: \`.reveal\` has no opacity:0 in CSS. Without \`.visible\`, content
   is fully visible (opacity defaults to 1). When observer fires, \`.visible\` triggers the animation
   (animation-fill-mode:both applies the \`from\` state briefly, then animates in). If JS crashes,
   zero content is hidden. NEVER write \`.reveal { opacity: 0 }\` — that makes a blank site on JS errors.

⑤ FULLY WORKING JS — every button, toggle, tab, gauge, and form MUST actually work:

   SCRIPT PLACEMENT — CRITICAL: Write the <script> block BEFORE the footer and modal HTML
   (i.e. before </section> of the last content section, not at the very end of </body>).
   If the response is cut off by token limits, the footer/modal are lost but JS still runs.
   Because the script executes after all content above it is parsed, the DOM is already ready —
   DO NOT wrap anything in DOMContentLoaded (the event fires before inline scripts run when the
   script is at end of body, making the callback never execute).

   IIFE WRAPPER — REQUIRED FOR ALL SCRIPT CONTENT (prevents fatal redeclaration crashes):
   The live preview re-evaluates the script on every update. If any const/let is declared at the
   top level of a <script> block, re-evaluation throws: "Identifier 'x' has already been declared"
   and all JS on the page dies. The ONLY safe pattern is ONE IIFE wrapping all logic:

     <script>
     (function() {
       // ALL const/let/var declarations go inside here — safe from redeclaration forever.
       const _io = new IntersectionObserver(...);

       // Functions called by onclick="" must be attached to window so HTML can find them:
       window.openModal = function(id) { document.getElementById(id).style.display = 'flex'; };
       window.closeModal = function(id) { document.getElementById(id).style.display = 'none'; };
       window.showTab = function(id, btn) { /* ... */ };
     })();
     </script>

   NEVER declare const/let at the top level of <script>. NEVER use function declarations for
   onclick handlers — use window.fnName = function(){} inside the IIFE instead.

   SCROLL LINKS — use plain anchor tags, never onclick for scrolling:
     <a href="#sectionId" class="btn">Go There</a>   ← works with zero JavaScript
   Never write onclick="scrollToSection('...')" — it requires a JS function that may be missing.

   WIRING PATTERN for everything else (inside the IIFE, not at top level):
     const btn = document.getElementById('myBtn');
     if (btn) btn.addEventListener('click', () => { /* handler */ });

   MODAL / OVERLAY: toggle style.display between 'flex' and 'none'.
   GAUGE / PROGRESS RINGS: animate stroke-dashoffset with setTimeout(fn, 100).
   TOGGLES / FOOD BUTTONS: classList.toggle('active') — also update any linked counter or gauge.
   TABS — COPY THIS EXACT PATTERN (classList approach — preserves display:grid on panels):
     HTML:
       <div class="tab-bar">
         <button class="tab-btn active" onclick="showTab('t1',this)">Tab One</button>
         <button class="tab-btn" onclick="showTab('t2',this)">Tab Two</button>
         <button class="tab-btn" onclick="showTab('t3',this)">Disclaimer</button>
       </div>
       <div id="t1" class="tab-panel active">...real content...</div>
       <div id="t2" class="tab-panel">...real content...</div>
       <div id="t3" class="tab-panel">...real written disclaimer text...</div>
     CSS:
       .tab-panel { display: none; }
       .tab-panel.active { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center;
                           animation: slideUp 0.5s cubic-bezier(0.16,1,0.3,1) forwards; }
       @keyframes slideUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:none; } }
       .tab-btn { opacity:0.5; border: 1px solid transparent; border-radius: 100px; }
       .tab-btn.active { opacity:1; background: var(--accent); color: var(--bg); }
     JS (window-attached inside IIFE — so onclick="" can find it):
       window.showTab = function(id, btn) {
         document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
         document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
         const panel = document.getElementById(id);
         if (panel) panel.classList.add('active');
         if (btn) btn.classList.add('active');
       };
     IMPORTANT: do NOT use style.display on panels — classList toggle preserves display:grid from CSS.
     CONTENT RULE: every tab panel MUST have real written content matching the tab label.
     Disclaimer tab → write a real 2-paragraph medical/legal disclaimer specific to the site topic.
     Protocol tab → write real protocol steps. Interactions tab → real interaction list. No empty panels.

   SMOOTH SCROLL — account for sticky nav height (90px offset):
     document.querySelectorAll('a[href^="#"]').forEach(a => {
       a.addEventListener('click', function(e) {
         e.preventDefault();
         const el = document.querySelector(this.getAttribute('href'));
         if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.pageYOffset - 90, behavior: 'smooth' });
       });
     });

   INTERACTIVE VISUALIZER / TOGGLE BUTTONS — use data attributes + cumulative pattern:
     HTML: <button class="bio-btn" data-value="25" data-color="#00f2ff" data-name="Wild Berries">+ Berries</button>
     JS: let score = 0;
         document.querySelectorAll('.bio-btn').forEach(btn => {
           btn.addEventListener('click', () => {
             const val = +btn.dataset.value, color = btn.dataset.color, name = btn.dataset.name;
             if (btn.classList.contains('active')) { btn.classList.remove('active'); score -= val; }
             else { btn.classList.add('active'); score += val; }
             score = Math.max(0, Math.min(100, score));
             // update ring: const offset = 816 - (score/100)*816; ring.style.strokeDashoffset = offset;
             // update label: label.textContent = 'Activated: ' + name;
           });
         });

   ACCORDIONS: classList.toggle('open') on parent, max-height:0→500px transition on content.
   PRICING BUTTONS: wire to scroll to the relevant section (never leave as dead stubs).
   FORMS: preventDefault() + show a visible success message inline — no page reload.
   DO NOT wrap code in DOMContentLoaded. DO NOT leave any button as a visual-only stub.

⑥ SPACING — Max content width 1100px (margin:0 auto). Min gap between cards: 24px. Never overflow-x.

⑦ ONE WOW DETAIL — mandatory, every build must include exactly one. Pick the one that fits:
   Profile A: animated counter on stats (0→value, 1.5s easeOut) OR floating particles (20 divs, CSS keyframes)
   Profile B: parallax scroll on hero image (10-15% travel via JS scroll listener) OR color-strip reveal
   Profile C: large 60px cursor follower (frosted glass circle, smooth lerp) OR word-by-word fade-in on H1
   Profile D: auto-scrolling marquee strip with bold text OR scramble text effect on hover
   Profile E: confetti burst on CTA click (20 colored divs scattered via CSS keyframes)
   ALL profiles: hero image must be a real Pexels photo that fills the viewport — never a colored div. If the wow detail is missing, the output fails quality bar.

⑧ WIX-QUALITY LAYOUT STANDARDS — the difference between a template people pay for and a generic AI site:

   LAYOUT VARIETY — use at least 4 of these section patterns (never repeat the same pattern twice):
   • FULL-BLEED HERO: image fills 100vh, headline text overlaid with contrast — most powerful opening
   • COLOR BLOCK: solid brand-color background section, large white or dark text, zero images — creates visual rhythm
   • EDITORIAL SPLIT: 50/50 image + text, image bleeds to edge of its column (no padding), text has generous padding
   • TYPOGRAPHY-LED: one section that is ONLY large text (120-200px headline) and nothing else — makes a bold statement
   • MASONRY / ASYMMETRIC GRID: images in a 2+1 or 3-panel grid where cells are different heights — feels editorial
   • FULL-BLEED PHOTO + FLOATING CARD: photo as background, content card floats centered with white bg + shadow
   • MARQUEE TICKER STRIP: horizontal auto-scrolling strip of repeated brand phrase or client names
   • PRODUCT/SERVICE CARDS: items displayed with large image top, minimal text below — like a menu or portfolio grid

   COPY RULES — every word must sound like a real brand wrote it:
   • Hero headline: max 6 words, provocative or poetic (e.g. "Food Worth Remembering" not "Welcome to Our Restaurant")
   • Subheadline: one sentence that makes the value proposition visceral and specific
   • Section titles: active verb phrases ("Crafted With Intention", "Made For the Bold", "Where Flavor Lives")
   • CTA buttons: specific action words ("Reserve a Table", "Start Your Journey", "See the Menu") never "Learn More"
   • Body copy: 2-3 sentences max per section — if it's longer, it's a wall of text that nobody reads

   COLOR BOLDNESS — use the brand's signature color with conviction:
   • At least one section uses the signature color as a full background
   • Navigation uses the signature color or is fully transparent over the hero
   • CTA button is always the signature color — never grey, never white-outline-only
   • Use a 3-color max palette: signature + neutral (white/cream/black) + one soft accent

⑨ 2025 FRESHNESS RULES — mandatory for all profiles:
   • At least one section uses a very large display number or stat (80-120px) as a design element
   • No two consecutive sections use the same layout pattern
   • CSS custom properties (--accent, --bg, --text, --font-heading) set in :root
   • At least 2 elements use CSS transitions or animations beyond just scroll reveal
   • All photography feels editorial and curated — never generic stock

⑩ MOBILE-FIRST RESPONSIVE — mandatory for ALL profiles, every single build:
   • <meta name="viewport" content="width=device-width, initial-scale=1"> in <head> — ALWAYS.
   • Base styles written for mobile (small screen) first; desktop via @media (min-width:768px) and @media (min-width:1024px).
   • Navigation: on mobile (<768px), the top nav links MUST collapse into a hamburger menu (☰) that opens a full-width dropdown. No horizontal nav overflow.
   • Product grids, card rows, feature columns: single column on mobile, multi-column on desktop using grid auto-fill or Flexbox wrap.
   • Touch targets: every clickable element (buttons, links, tabs, cart icon) must be at least 44×44px — never smaller on mobile.
   • Font sizes: body min 16px on mobile; headings use clamp() so they scale gracefully.
   • No fixed-width elements wider than 100vw — no horizontal scroll on mobile.
   • Images: max-width:100%; height:auto — never overflow their container.
   • The site must look great and be fully usable on a 375px-wide phone screen (iPhone SE / Android mid-range).
   BANNED: • overflow-x:hidden as the only "fix" for horizontal scroll — fix the root cause instead.
            • Fixed pixel widths (e.g. width:800px) without a max-width:100% fallback.
            • Tiny text (< 12px) or overlapping elements at 375px viewport width.

⑪ GLOBAL STATE ENGINE — mandatory for any build with a cart, admin panel, dashboard, form, or tabs:
   Initialize this pattern inside your <script> before any UI code:
   const appState = {
     data: {},          // products[], cart[], user, etc. — whatever this specific build needs
     ui:   {},          // isDarkMode, activeTab, isAdminOpen, isCartOpen, etc.
     update(key, value) {
       const keys = key.split('.');
       let obj = this;
       keys.slice(0,-1).forEach(k => obj = obj[k]);
       obj[keys[keys.length-1]] = value;
       localStorage.setItem('__snap_state', JSON.stringify({ data: this.data, ui: this.ui }));
       this.render();
     },
     render() { /* re-draw every UI component that reads from appState */ }
   };
   // Restore on load:
   try { const s = JSON.parse(localStorage.getItem('__snap_state')||'{}');
         if (s.data) appState.data = s.data;
         if (s.ui)   appState.ui   = s.ui; } catch(e){}
   RULES:
   • Every "Add to Cart", "Delete Product", "Toggle Dark Mode" etc. must call appState.update() — NEVER mutate DOM directly.
   • appState.render() re-draws every UI block that reads state (cart count badge, product grid, admin table).
   • On page load, always restore from localStorage so the user never loses their data on refresh.
   • Cart badge, product list, admin rows — all must stay in sync automatically via render().
   BANNED: • Loose global variables like \`let cart = []\` on complex builds — use appState instead.
            • Direct innerHTML edits without going through render() — they will desync.
            • Forgetting to save to localStorage — state must survive page refresh.

⑫ EDGE CASES — mandatory on every build (what separates a $200 template from a generic one):
   EMPTY STATES — every list, grid, or cart must have a beautiful "nothing here yet" view:
   • Empty cart → centered icon (🛒) + "Your cart is empty" + "Start Shopping" button.
   • No products in admin → centered icon (📦) + "Add your first product above" text.
   • Empty search results → icon + "No results for '[query]'" + "Clear search" link.
   • Style empty states with muted color, generous padding — never just a blank white box.

   TOAST NOTIFICATIONS — for every form submit, add/delete action, or error:
   • Success: green pill slides in from top-right — "✅ Product added!" — auto-hides after 2.5s.
   • Error: red pill — "❌ Please fill in all fields." — auto-hides after 3.5s.
   • Pattern: a fixed <div id="toast"> already in the DOM, shown/hidden via JS class toggle.
   • Never use alert() or confirm() — always use toast.

   BUTTON FEEDBACK — every clickable element must feel tactile:
   • All buttons: transition: transform 0.15s; — on :active { transform: scale(0.96); }
   • Add to Cart: brief pulse animation on the cart badge when count changes.
   • Delete: row fades out (opacity 0, height 0) over 250ms before being removed from DOM.

   ACCESSIBILITY — minimum bar for every build:
   • Every icon-only button must have aria-label="descriptive action" (e.g. aria-label="Close cart").
   • Use semantic HTML: <main>, <nav>, <header>, <footer>, <section>, <article> — never <div> for structure.
   • All form inputs must have a matching <label> (or aria-label if label is visually hidden).
   • Focus ring: :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; } on all interactive elements.

   BANNED: • alert() for any user-facing message.
            • Blank white boxes where empty states should be.
            • Icon buttons with no aria-label.
            • Forms with inputs and no labels.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STEP 3 — ANTI-PATTERN BLACKLIST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
These are what every average AI defaults to. You never produce these unless explicitly requested:
✗ Dark background + glassmorphism as a default for ANY non-tech request — #1 generic AI mistake
✗ Purple-to-pink gradient on white — the most recognizable AI output, immediately signals low quality
✗ Glassmorphism on wellness / food / editorial / lifestyle projects
✗ Inter for every heading — wrong pairing kills the brand personality
✗ Generic "Our Features" 3-column grid with emoji or Lucide icons and one-liner descriptions
✗ "Trusted by 10,000+ users" with grey company logo placeholders
✗ "[Business Name]" or "[Your Tagline Here]" placeholder copy — always invent real brand copy
✗ "Welcome to [name]" as the hero headline — this is the weakest possible opening
✗ Two CTAs in the hero — one CTA only, make it count
✗ "Lorem ipsum" anywhere — every word must be real brand copy
✗ "Coming soon" stubs or empty sections
✗ Colored divs as placeholder images — always use real Pexels IDs
✗ <img> tags without onerror fallback
✗ Boring body copy that describes features instead of creating desire
✗ Emoji used as icons in professional/premium contexts (🛡️🧬💎🔥)
✗ All sections the same width and padding — create rhythm with full-bleed vs contained sections
✗ <img> tags without onerror fallback — a broken Pexels link shows an ugly broken icon; always add
  onerror="this.style.display='none';this.parentElement.style.background='linear-gradient(...)'"
✗ style.display='block' inside showTab() — this overrides CSS display:grid on panels, breaking
  two-column layouts. Always use classList.add/remove('active') in tab JS, let CSS control display.
✗ Tabs that don't switch when clicked — always use the classList-based showTab(id,btn) pattern
✗ .reveal { opacity: 0 } in CSS — this blanks the entire page if JS crashes or is slow.
  The ONLY safe pattern: .reveal has NO opacity set; .reveal.visible triggers the animation via @keyframes
✗ No safety-net setTimeout after IntersectionObserver — always include the 1s inline-style fallback
✗ Content area wider than 1100px
✗ Non-functional "coming soon" interactive placeholders
✗ Pricing/CTA buttons that do nothing — wire every button to scroll to a real section
✗ Empty tab panels — every tab must have real written content (at least 2 paragraphs), including
  Disclaimer, Protocol, Interactions, About, FAQ etc. — never leave a tab with placeholder text
✗ Missing smooth scroll offset — sticky nav is 80-90px tall; raw scrollIntoView() cuts off headings.
  Use: el.getBoundingClientRect().top + window.pageYOffset - 90
✗ href="#" on footer links (Medical Disclaimer, Privacy Policy, Terms, Newsletter, etc.) — every
  footer link MUST open a modal with real written content. Create a single reusable legal modal:
  <div id="legalModal" style="position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9000;display:none;align-items:center;justify-content:center;padding:24px;">
    <div style="background:#fff;max-width:640px;width:100%;max-height:80vh;overflow-y:auto;padding:48px;position:relative;border-radius:4px;">
      <button onclick="closeLegal()" style="position:absolute;top:16px;right:20px;background:none;border:none;font-size:1.8rem;cursor:pointer;">&times;</button>
      <h2 id="legalTitle" style="margin-bottom:24px;"></h2>
      <div id="legalBody" style="line-height:1.8;font-size:0.95rem;"></div>
    </div>
  </div>
  Then define openLegal(title, html) and closeLegal() at top level of the script.
  Footer links: onclick="openLegal('Medical Disclaimer','<p>..real content..</p>')"
  Write 2-4 real paragraphs of genuine content for each legal page — not placeholder text.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  MANDATORY HTML SKELETON
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[Specific real title matching the project]</title>
  <!-- Tailwind CSS Play CDN — use utility classes everywhere, no custom CSS needed for layout/spacing/color -->
  <script src="https://cdn.tailwindcss.com"></script>
  <!-- Lucide Icons — use <i data-lucide="icon-name" class="w-5 h-5"></i> anywhere, auto-initialized at end of body -->
  <script src="https://unpkg.com/lucide@latest"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=[PROFILE_HEADING_FONT]&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <script>
    tailwind.config = { theme: { extend: { fontFamily: { heading: ['[PROFILE_HEADING_FONT]', 'sans-serif'] } } } }
  </script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { min-height: 100vh; overflow-x: hidden; }
    /* Insert chosen profile's :root tokens and custom keyframes here — Tailwind handles the rest */
  </style>
</head>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  FINAL CHECKLIST — verify before every output
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Correct aesthetic profile chosen — NOT defaulted to dark SaaS?
✓ Right font pairing for this profile (not just Inter for everything)?
✓ Real Pexels images used (not colored placeholder divs)?
✓ Real specific copy (not lorem ipsum or generic filler)?
✓ Thin-line SVG icons (not emoji in professional contexts)?
✓ One wow detail added (matching the chosen profile)?
✓ All interactive elements fully functional?
✓ Every footer link opens a modal with real content (NO href="#" dead links)?
✓ legalModal + openLegal() + closeLegal() present if any legal/footer links exist?
✓ .reveal has NO opacity:0 in CSS (content visible if JS fails) — only .reveal.visible adds animation?
✓ @keyframes revealUp used (from opacity:0 to opacity:1, both fill) NOT transition on .reveal itself?
✓ 1s style-based safety net present (el.style.opacity='1') after IntersectionObserver setup?
✓ Every <img> has onerror fallback so broken images show a gradient instead of a broken icon?
✓ Tabs use classList showTab(id,btn) — NOT style.display — so display:grid is preserved in panels?
✓ Every tab panel has real written content (no empty or placeholder panels)?
✓ All CTA/pricing buttons wired to scroll somewhere — no dead stubs?
✓ Smooth scroll uses 90px navbar offset (getBoundingClientRect approach)?
✓ Viewport meta + Google Fonts + CSS reset present?
✓ Only ONE primary CTA per section?
✓ Content max-width 1100px?

Output: \`\`\`html ... \`\`\` and nothing else.`;

// ─── 3-LEVEL STAGED BUILD PROMPTS ────────────────────────────────────────────
// Each level is small/focused — never hits token limits, buttons always work.

const L1_SCAFFOLD_PROMPT = `You are a world-class UI engineer. Build an extremely polished, modern structure using Tailwind CSS utility classes.

LEVEL 1 — SCAFFOLD: Output ONLY the raw HTML body content.

RULES (break any = broken build):
• Output ONLY what goes between <body> and </body>. No <!DOCTYPE>. No <html>. No <head>. No <style> block. No <script> block.
• USE Tailwind CSS utility classes directly on every element for spacing, typography, colors, and layout. The Tailwind CDN is already injected — use it fully.
• Also apply the .reveal class to any section or card you want to animate in on scroll.
• Use Lucide Icons via <i data-lucide="icon-name" class="w-5 h-5 text-indigo-400"></i> — they are auto-initialized.
• Every major section MUST have data-section-id on its wrapper (e.g. data-section-id="hero", "features", "pricing", "faq", "footer").
• Every interactive element (button, tab, toggle, form, accordion) MUST have a unique id="..." attribute.
• Required sections to include:
  1. Sticky nav: frosted glass (bg-black/70 backdrop-blur-md border-b border-white/10), logo left, links center, CTA pill right.
  2. Hero: asymmetric grid — bold display text left, floating mockup/visual card right. Gradient headline text (bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent).
  3. Feature Bento Grid: grid grid-cols-1 md:grid-cols-3 gap-5 — dark cards (bg-white/5 border border-white/10 rounded-2xl p-6) with Lucide icons.
  4. Interactive section: tab switcher, calculator, or form with a gradient CTA button.
  5. Footer: links, compliance note, social icons — no lorem ipsum.
• Every <img> MUST have an onerror fallback: onerror="this.style.display='none';this.parentElement.style.background='linear-gradient(135deg,#1e1b4b 0%,#0f172a 100%)'"
• Use real Pexels photo IDs (verified: 574071 workspace, 1181244 code, 1092730 avocado, 3822621 yoga).
• Use semantic HTML: <nav>, <header>, <section>, <footer>, <main>.
• Write real, specific copy — no lorem ipsum, no "Coming Soon" stubs.
• Output raw HTML only — NO markdown fences, NO prose before or after.`;

const L2_DESIGN_PROMPT = `You are adding custom CSS polish on top of a Tailwind-powered website.

LEVEL 2 — DESIGN: Output ONLY custom CSS rules (no tags, no HTML, no JS).

RULES:
• Output ONLY raw CSS — NO <style> tags, NO HTML, NO JS, NO markdown fences, NO prose.
• Tailwind CDN is already active — do NOT re-import it or re-define what Tailwind already handles.
• Focus on custom details Tailwind can't do inline: keyframe animations, glow effects, complex pseudo-elements, custom scrollbars, gradient text, glass morphism depth, and brand-specific micro-interactions.
• Choose the right aesthetic and define :root custom properties to match:
  PROFILE A (dark tech): --bg:#07070f; --accent:#6366f1; glow shadows, radial bg leak, gradient-clipped H1
  PROFILE B (editorial light): --bg:#F9FBF9; --accent:#FF7043; generous whitespace, sage secondary, thin SVG icons
  PROFILE C (luxury minimal): --bg:#fafafa or #080808; --accent:#C9A96E; extreme whitespace, hairline borders
  PROFILE D (brutalist): --bg:#fff; --accent:#e63946; offset box-shadow:4px 4px 0 #000, thick borders
  PROFILE E (playful): bright 3-color palette; bouncy hover transform:scale(1.05); illustrated shapes
• Write glow button: background: linear-gradient(135deg, var(--accent), ...) with box-shadow glow on :hover.
• Add a layered radial gradient background leak div (position:fixed, pointer-events:none, z-index:-1) for dark profiles.
• Every button/link must have a :hover state with visual feedback.
• Output raw CSS only — NO tags, NO prose, NO fences.`;

const L3_ACTIVATE_PROMPT = `You are a senior frontend architect wiring bulletproof interactivity into a Tailwind + Lucide site.

LEVEL 3 — ACTIVATE: Output ONLY JavaScript (no tags, no HTML, no CSS).

RULES:
• Output ONLY raw JS — NO <script> tags, NO HTML, NO CSS, NO markdown fences, NO prose.
• FIRST LINE: re-trigger Lucide so any dynamically shown elements get their icons:
    if (window.lucide) { lucide.createIcons(); }
• NULL-CHECK every single DOM query before using it:
    const btn = document.getElementById('myBtn');
    if (btn) btn.addEventListener('click', () => { ... });
• ALL functions at TOP LEVEL — never nested inside callbacks or blocks.
• DO NOT wrap anything in DOMContentLoaded — script runs after </body>, DOM is already parsed.
• SCROLL LINKS — smooth scroll with 90px sticky-nav offset:
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', function(e) {
        e.preventDefault();
        const el = document.querySelector(this.getAttribute('href'));
        if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.pageYOffset - 90, behavior: 'smooth' });
      });
    });
• TABS: use classList add/remove on .tab-panel / .tab-btn — never display:none on flex parents.
    function showTab(id, btn) {
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      const p = document.getElementById(id); if (p) p.classList.add('active');
      if (btn) btn.classList.add('active');
    }
• MODALS: function openModal(id){const m=document.getElementById(id);if(m)m.style.display='flex';} function closeModal(id){const m=document.getElementById(id);if(m)m.style.display='none';}
    All modal overlays MUST use position:fixed; inset:0; z-index:9000 or higher — never lower.
• FORMS — STRICT CONTRACT: If the page has a contact/intake/lead form, its submit handler MUST:
    1. Use e.preventDefault() — never reload the page.
    2. Replace the form's parentElement.innerHTML with a styled success card (not alert()).
    3. Include a WhatsApp deep-link built from form values: https://wa.me/PHONE?text=ENCODED_MESSAGE
    4. Call lucide.createIcons() immediately after the innerHTML replacement so new icons render.
• LUCIDE RE-INIT: After ANY dynamic innerHTML/insertAdjacentHTML call that adds data-lucide icons, immediately call: if (window.lucide) { lucide.createIcons(); }
• SCROLL REVEAL (always include):
    const _io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); _io.unobserve(e.target); }
    }), { threshold: 0.08 });
    document.querySelectorAll('.reveal').forEach(el => _io.observe(el));
    setTimeout(() => document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible')), 1200);
• NO dead stubs — every button MUST do something (scroll, toggle, open modal, submit, animate, etc.).
• FUNCTION COMPLETENESS: Every function called in an onclick/onchange/onsubmit/oninput attribute (e.g. showTab(), updatePillar(), openModal()) MUST be fully defined in the single <script> block. Never leave a referenced function undefined.
• Output raw JS only — NO tags, NO prose, NO fences.`;

const BUILD_PATCH_PROMPT = `You are a senior front-end engineer making a targeted edit to an existing website.

THE GOLDEN RULE: Change ONLY what the user explicitly asked for. Nothing else moves.

STRICT RULES:
• Return the COMPLETE HTML file with the requested change applied.
• Do NOT redesign, re-theme, or change colors, fonts, layout, spacing, or any section the user did not mention.
• Do NOT pick a new aesthetic profile. Lock onto whatever design is already in the file.
• Preserve every existing ID, class, data-attribute, and script exactly as-is unless directly involved in the change.
• If adding an image: use a real Pexels URL matching the context, with onerror fallback, object-fit:cover.
• If adding a section: match the exact same design language (colors, radius, fonts, spacing) already present.
• IIFE WRAPPER — ALL script content MUST be inside a single (function(){ ... })(); wrapper. The live preview re-evaluates scripts on every update, so any top-level const/let throws "Identifier already declared" and kills all JS on the page. Functions called by onclick="" must be attached to window inside the IIFE: window.myFn = function(){ ... }; Never use top-level const/let or bare function declarations for onclick handlers.
• FUNCTION COMPLETENESS: Every function called in an onclick/onchange/onsubmit/oninput attribute MUST be fully defined (as window.fn = function(){}) inside the IIFE. If the existing site has broken onclick handlers, fix them as part of this response.
• PRESERVE MEDIA PLACEHOLDERS: NEVER remove, replace, or alter any __SNAP_VID_N__, __SNAP_IMG_N__, or __SNAP_AUD_N__ placeholder strings that exist in the current site. They are live media references managed by the app — removing them erases the user's video or image from the build.
• YOUTUBE EMBEDS: When the user pastes any YouTube URL (youtube.com/watch?v=, youtu.be/, or youtube.com/embed/), ALWAYS embed it as a plain responsive iframe. NEVER build a custom video player, input box, or Upload & Play button. Extract the video ID, strip all tracking params (?si=, &feature=, etc.), and use this exact pattern: <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:12px;"><iframe src="https://www.youtube.com/embed/VIDEO_ID" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>
• UPLOADED VIDEO FILES: When the prompt contains __SNAP_VID_0__ (or __SNAP_VID_1__, __SNAP_VID_2__ etc.), the user has attached a real mp4/webm video file. Embed it using this EXACT pattern — it includes a 🔇/🔊 unmute button and a hover overlay to replace the video in the downloaded file: <div style="position:relative;border-radius:12px;overflow:hidden;aspect-ratio:16/9;"><video id="snapVid0" src="__SNAP_VID_0__" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;display:block;"></video><div onclick="document.getElementById('snapUpload0').click()" style="position:absolute;inset:0;background:rgba(0,0,0,0.55);opacity:0;transition:opacity .3s;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer;" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0'"><div style="width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);display:flex;align-items:center;justify-content:center;font-size:20px;">🔄</div><span style="color:#fff;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Replace video</span></div><button onclick="var v=document.getElementById('snapVid0');v.muted=!v.muted;this.textContent=v.muted?'🔇':'🔊';" style="position:absolute;bottom:10px;right:10px;background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.3);border-radius:50%;width:36px;height:36px;cursor:pointer;font-size:16px;color:#fff;z-index:10;padding:0;line-height:1;">🔇</button><input type="file" id="snapUpload0" accept="video/*" style="display:none" onchange="(function(i,v){if(i.files[0]){var r=new FileReader();r.onload=function(e){document.getElementById(v).src=e.target.result;};r.readAsDataURL(i.files[0]);}})(this,'snapVid0')"></div> — adjust id/for numbering for VID_1, VID_2 etc. Do NOT ask for a URL or build a custom player.
• UPLOADED AUDIO FILES: When the prompt contains __SNAP_AUD_0__ (or __SNAP_AUD_1__ etc.), the user has attached a real mp3/wav/ogg audio file. Embed it directly using an HTML5 audio tag — do NOT build a custom player or ask for a URL: <audio src="__SNAP_AUD_0__" controls style="width:100%;border-radius:8px;margin:12px 0;"></audio>. Place it in the section the user specified, or the most fitting section if not specified.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PLAIN-ENGLISH COMMAND DICTIONARY
  Understand these everyday instructions and act immediately.
  Never ask for clarification — just do the closest right thing.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FAVICON / TAB ICON:
  "make this the favicon" / "set as favicon" / "use as tab icon" / "put image as favicon" / "image as favicon"
  → Add/update <link rel="icon" type="image/png" href="__SNAP_IMG_0__"> in <head>. Also update navbar logo <img> src if one exists. Do NOT place the image in the page body.

LOGO:
  "change the logo" / "use this as logo" / "replace logo" / "update logo"
  → Set navbar/header logo <img> src to __SNAP_IMG_0__ with style="height:36px;width:auto;object-fit:contain;display:block;". Also update <link rel="icon"> in <head> to match.

BACKGROUND IMAGE:
  "use this as background" / "set as background" / "background image"
  → Set hero section: background-image:url('__SNAP_IMG_0__');background-size:cover;background-position:center; Add a semi-transparent overlay so text stays readable.
  "change background color to X" / "make background X" → Update background-color on the relevant section.

COLORS:
  "change color to X" / "make it X color" / "use X as accent" → Replace the main accent/CTA color with the exact color named.
  "make it darker" → Darken the main background ~20%, boost contrast.
  "make it lighter" → Lighten the background, soften contrast.
  "change text color to X" → Update the primary text color.

FONTS:
  "change font to X" / "use X font" → Add Google Fonts <link> for that font, update font-family on headings or body.
  "make text bigger" / "increase font size" → Increase font-size ~20% on the specified element.
  "make text smaller" → Decrease font-size ~20%.

TEXT / CONTENT:
  "change X to Y" / "replace X with Y" → Find that exact text and replace it. Keep all surrounding tags/styles.
  "add my email [address]" → Replace any placeholder email with the address provided.
  "add my phone [number]" → Replace placeholder phone with the number provided.
  "add my address [address]" → Replace placeholder address text with the address provided.
  "change [section] text to [new copy]" → Find that section and update the copy inside it.

SOCIAL LINKS:
  "add my Instagram [handle/url]" / "link Instagram to [url]" → Find Instagram link and set href to https://instagram.com/[handle] or the URL. If no social section exists, add one in the footer with Lucide icons.
  Same pattern for Facebook, Twitter/X, TikTok, LinkedIn, YouTube, Pinterest, WhatsApp.

BUTTONS / CTAs:
  "change button text to X" → Update text inside the <a> or <button>.
  "change button color to X" → Update background-color on that button.
  "button should go to [url]" / "make button link to [url]" → Set the button href to the URL.
  "add a button that says X" → Add a styled button matching the existing design, with text X.
  "remove the button" → Delete that button element.

SECTIONS:
  "add a [name] section" → Add a new section matching existing design (same colors, fonts, radius).
  "remove the [name] section" → Delete that entire <section> block.
  "move [section] up/down" → Reorder sections in the HTML.
  "hide the [section]" → Add display:none to that section.

LAYOUT / SPACING:
  "center [element]" → Add text-align:center or margin:0 auto as appropriate.
  "add more space/padding" → Increase padding on the specified area.
  "reduce spacing" / "tighten it up" → Reduce padding/margin on the specified area.
  "make it two columns" / "add a grid" → Apply display:grid;grid-template-columns:1fr 1fr;gap:40px;
  "make hero taller" / "make it full screen" → Set min-height:100vh on the hero section.

ANIMATIONS:
  "add animation" / "add fade in" / "make it animate" → Add CSS @keyframes fadeIn and apply to hero or specified element.
  "remove animation" → Remove transition/animation CSS from the specified element.

MOBILE / RESPONSIVE:
  "make it mobile friendly" / "fix mobile layout" / "fix on phone" / "make it responsive"
  → Add @media (max-width:768px): single-column grid, reduced font-sizes, full-width buttons.

SHOP / PAYMENT (text edits, no image attached):
  "change price to $X" / "set price to X" → Find the price text and replace with the new amount.
  "add PayPal button" / "link PayPal to [url]" → Add/update a PayPal button href to the paypal.me URL.
  "set checkout to [url]" / "add Stripe link [url]" → Add/update Buy Now button href to the Stripe URL.
  "add product [name] for $[price]" → Add a new product card matching the existing shop design.

GENERAL RULE: If the instruction doesn't match any command above, make the smallest targeted change that achieves what the user described. Never redesign anything that wasn't asked about.

• Output: ONLY a single \`\`\`html code block. Zero prose before or after.`;

const L_UPDATE_PROMPT = `You are surgically updating one section of a website.

UPDATE MODE: Output ONLY the new inner HTML for the requested section.

RULES:
• Output ONLY the inner HTML that replaces the content inside the target section's data-section-id wrapper.
• Do NOT output the section wrapper tag itself. Do NOT change any other section.
• Keep all existing IDs and data attributes.
• No markdown fences, no prose, just the raw HTML fragment.`;

// Assemble full HTML from staged fragments — rendered inside sandbox.html so Tailwind CDN works
function assembleStagedHtml(bodyHtml, styleCss, scriptJs) {
  const customCss = styleCss ? '\n    ' + styleCss.split('\n').join('\n    ') : '';
  const script = scriptJs ? '\n<script>\n' + scriptJs + '\n<\/script>' : '';
  return `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aion Build</title>

  <!-- Tailwind CSS — works because this document runs inside sandbox.html (relaxed CSP) -->
  <script src="https://cdn.tailwindcss.com"><\/script>

  <!-- Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">

  <!-- Lucide Icons -->
  <script src="https://unpkg.com/lucide@latest"><\/script>

  <!-- Tailwind custom tokens -->
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['"Plus Jakarta Sans"', 'sans-serif'],
            serif: ['"Playfair Display"', 'serif'],
            mono: ['"JetBrains Mono"', 'monospace'],
          }
        }
      }
    }
  <\/script>

  <style>
    /* ── Reset ─────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; font-size: 16px; }

    /* ── Design tokens ──────────────────────────────────────── */
    :root {
      --bg:           #07070f;
      --text:         #f0f0ff;
      --text-muted:   #94a3b8;
      --accent:       #6366f1;
      --accent-glow:  rgba(99,102,241,0.18);
      --card-bg:      rgba(255,255,255,0.03);
      --card-border:  rgba(255,255,255,0.08);
      --radius:       14px;
    }

    /* ── Base ───────────────────────────────────────────────── */
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      min-height: 100vh;
      overflow-x: hidden;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }

    /* ── Layout helpers (replaces Tailwind grid utilities) ──── */
    .container { width: 100%; max-width: 1100px; margin: 0 auto; padding: 0 24px; }
    .grid { display: grid; gap: 24px; }
    .flex { display: flex; }
    .flex-center { display: flex; align-items: center; justify-content: center; }
    .flex-between { display: flex; align-items: center; justify-content: space-between; }
    @media (min-width: 640px)  { .sm-col-2 { grid-template-columns: repeat(2,1fr); } }
    @media (min-width: 768px)  { .md-col-2 { grid-template-columns: repeat(2,1fr); } .md-col-3 { grid-template-columns: repeat(3,1fr); } }
    @media (min-width: 1024px) { .lg-col-2 { grid-template-columns: repeat(2,1fr); } .lg-col-3 { grid-template-columns: repeat(3,1fr); } .lg-col-4 { grid-template-columns: repeat(4,1fr); } }

    /* ── Glassmorphism card ─────────────────────────────────── */
    .glass-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-radius: var(--radius);
      padding: 24px;
      transition: transform 0.3s cubic-bezier(0.16,1,0.3,1), border-color 0.2s;
    }
    .glass-card:hover { transform: translateY(-4px); border-color: rgba(99,102,241,0.4); }

    /* ── Gradient text helper ───────────────────────────────── */
    .gradient-text {
      background: linear-gradient(135deg, var(--accent) 0%, #ec4899 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    /* ── Glow button ────────────────────────────────────────── */
    .btn-primary {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      background: linear-gradient(135deg, var(--accent) 0%, #ec4899 100%);
      color: #fff; font-weight: 700; border: none; cursor: pointer;
      padding: 14px 28px; border-radius: 999px;
      box-shadow: 0 0 32px -8px var(--accent-glow);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .btn-primary:hover { transform: scale(1.04); box-shadow: 0 0 48px -8px var(--accent-glow); }
    .btn-primary:active { transform: scale(0.97); }

    /* ── Scroll-reveal ──────────────────────────────────────── */
    .reveal { transition: opacity 0.7s cubic-bezier(0.16,1,0.3,1), transform 0.7s cubic-bezier(0.16,1,0.3,1); }
    .reveal:not(.visible) { opacity: 0; transform: translateY(22px); }
    .reveal.visible { opacity: 1; transform: none; }

    /* ── Generated CSS from L2 ──────────────────────────────── */
    ${customCss}
  </style>
</head>
<body>

${bodyHtml || ''}

${script}
</body>
</html>`;
}

// Extract a raw text fragment from AI response (strips markdown fences)
function extractFragment(text) {
  if (!text) return '';
  return text.replace(/^```[\w]*\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

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
      // Single image — show as before
      document.getElementById('previewImage').src = currentImages[0];
    } else {
      // Multiple images — show each one individually in the grid.
      // Use loading="lazy" + decoding="async" so images are decoded one at a
      // time as the user scrolls, avoiding the memory spike from simultaneous decoding.
      previewContainer.innerHTML = '<div class="multi-image-grid" id="multiImageGrid"></div>';
      const grid = document.getElementById('multiImageGrid');
      currentImages.forEach((src, i) => {
        const img = document.createElement('img');
        img.src = src;
        img.alt = `Screenshot ${i + 1}`;
        img.className = 'grid-image';
        img.title = `Screenshot ${i + 1} of ${currentImages.length}`;
        img.loading = 'lazy';
        img.decoding = 'async';
        grid.appendChild(img);
      });
    }
  } else {
    // No images - show the placeholder (it's already in HTML)
    const placeholder = document.getElementById('imagePlaceholder');
    if (placeholder) placeholder.style.display = 'flex';
    document.getElementById('previewImage').style.display = 'none';
  }
  
  // Wire click-to-chat on left panel images
  setupImagePanelClicks();

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
  scheduleChatHistorySave();
  return bubble;
}

// Add thinking bubble with star animation
function addThinkingBubble() {
  const thread = document.getElementById('chatThread');
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble loading';
  bubble.innerHTML = '<div class="think-ring"><div class="think-ring-dot"></div></div><span class="think-label">Gemini is thinking</span><span class="think-dots"><span></span><span></span><span></span></span>';
  thread.appendChild(bubble);
  thread.scrollTop = thread.scrollHeight;
}

// Remove loading bubble
function removeLoading() {
  const thread = document.getElementById('chatThread');
  const loading = thread.querySelector('.chat-bubble.loading');
  if (loading) loading.remove();
}

// ============ AGENT MODE ============
// Real function-calling loop: Gemini decides one action at a time (click/type/
// scroll/finish), we execute it for real on the active tab via the existing
// agentExecute bridge (background.js -> content.js handleAgentAction), tell
// Gemini what happened, and repeat until it says the task is done or we hit
// the step cap. This reuses the automation "hands" that already existed in
// content.js — this function is the missing "brain" that drives them.
let agentStopRequested = false;
// Multi-step tasks ("go find a channel, open its analytics, read the numbers,
// gather the data") take more than a handful of clicks once you count
// searching, waiting for pages to load, and scrolling to find things. 10 was
// too tight and cut sequences off before they finished — 25 gives real
// multi-stage tasks room to complete while still capping runaway loops.
const AGENT_MAX_STEPS = 60;

const AGENT_TOOLS = [{
  functionDeclarations: [
    {
      name: 'click',
      description: 'Click a button, link, or element on the current page. Prefer "text" (the visible label) over "selector". If the element cannot be found by text, use x and y pixel coordinates from the current screenshot as a last resort.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Visible text on the element to click, e.g. "Sign up" or "Buy"' },
          selector: { type: 'string', description: 'CSS selector, only if known precisely' },
          description: { type: 'string', description: 'Fallback description of the element if text/selector are unknown' },
          x: { type: 'number', description: 'X pixel coordinate on the current screenshot — last resort if text/selector cannot find the element' },
          y: { type: 'number', description: 'Y pixel coordinate on the current screenshot — last resort if text/selector cannot find the element' }
        }
      }
    },
    {
      name: 'doubleClick',
      description: 'Double-click an element on the current page. Use this instead of "click" when a single click only selects/highlights something and it actually needs to be OPENED (e.g. opening a file in Google Drive, opening a folder, launching an item from a list).',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Visible text/label on the element to double-click, e.g. a file name' },
          selector: { type: 'string', description: 'CSS selector, only if known precisely' },
          description: { type: 'string', description: 'Fallback description of the element if text/selector are unknown' }
        }
      }
    },
    {
      name: 'drag',
      description: 'Click-and-hold on one spot, drag to another spot, then release — for moving a chess piece, dragging a slider/handle, reordering a list, or any drag-and-drop interaction. Identify the start ("from") and end ("to") either by visible text/selector of the element, or by pixel coordinates on the current screenshot.',
      parameters: {
        type: 'object',
        properties: {
          fromText: { type: 'string', description: 'Visible text/label of the element to pick up (e.g. the piece)' },
          fromSelector: { type: 'string', description: 'CSS selector of the element to pick up, if known' },
          fromX: { type: 'number', description: 'X pixel coordinate to start the drag from, if no text/selector applies' },
          fromY: { type: 'number', description: 'Y pixel coordinate to start the drag from, if no text/selector applies' },
          toText: { type: 'string', description: 'Visible text/label of the drop target' },
          toSelector: { type: 'string', description: 'CSS selector of the drop target, if known' },
          toX: { type: 'number', description: 'X pixel coordinate to drop at, if no text/selector applies' },
          toY: { type: 'number', description: 'Y pixel coordinate to drop at, if no text/selector applies' }
        }
      }
    },
    {
      name: 'type',
      description: 'Type text into an input field, search box, textarea, or spreadsheet cell on the current page. For Excel Online and Google Sheets, use the "cell" parameter to navigate to a specific cell before typing (e.g. cell:"A1", cell:"B3"). Separate column values with \\t (tab) and rows with \\n (newline) to fill multiple cells in one call.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to type. In spreadsheets: use \\t between column values and \\n between rows to fill a table in one call.' },
          selector: { type: 'string', description: 'CSS selector of the input, if known' },
          placeholder: { type: 'string', description: 'Placeholder text of the input, if known' },
          cell: { type: 'string', description: 'Spreadsheet cell address to navigate to before typing, e.g. "A1", "B3", "C10". Use this in Excel Online and Google Sheets to target a specific starting cell.' },
          clearFirst: { type: 'boolean', description: 'If true, select-all and delete any existing content in the field before typing new text. Use when replacing an existing value (e.g. clearing a search box before typing something new).' },
          pressEnter: { type: 'boolean', description: 'Whether to press Enter after typing (e.g. to submit a search)' }
        },
        required: ['text']
      }
    },
    {
      name: 'hover',
      description: 'Move the mouse over an element to trigger its hover state — revealing dropdown menus, tooltip buttons, flyout panels, and contextual actions that only appear on hover. After hovering, you can click the revealed item in your next step.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Visible text/label of the element to hover over, e.g. "Products" or "File"' },
          selector: { type: 'string', description: 'CSS selector of the element to hover, if known' },
          description: { type: 'string', description: 'Fallback description if text/selector are unknown' }
        }
      }
    },
    {
      name: 'select',
      description: 'Set a dropdown (HTML <select> element) to a specific option. More reliable than clicking tiny option items. For custom/styled dropdowns built with divs, use click instead.',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'The visible label next to the dropdown, e.g. "Country" or "Sort by"' },
          value: { type: 'string', description: 'The option text or value to select, e.g. "United Kingdom" or "Newest first"' }
        },
        required: ['value']
      }
    },
    {
      name: 'waitForElement',
      description: 'Wait until specific text appears on the page OR a CSS selector matches a visible element, before continuing. Use after clicking something that triggers a page load, AJAX request, or animation — prevents acting on elements that have not loaded yet.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to wait for on the page, e.g. "Results" or "Saved"' },
          selector: { type: 'string', description: 'CSS selector to wait for, e.g. ".results-list"' },
          timeout: { type: 'number', description: 'Max seconds to wait (default 10, max 30)' }
        }
      }
    },
    {
      name: 'readText',
      description: 'Read the exact text content or value of a specific element on the page — a price, count, table cell, or form field value. Returns the data directly so you can use it without guessing from the screenshot.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the element to read, e.g. ".price" or "#total"' },
          text: { type: 'string', description: 'Visible label near the element to read, if selector is unknown' },
          maxChars: { type: 'number', description: 'Max characters to return (default 2000)' }
        }
      }
    },
    {
      name: 'autofill',
      description: 'Fill an entire HTML form in one shot by passing field labels and their values. Far faster than clicking and typing into each field one by one. Works on contact forms, signup forms, checkout forms, and any page with <input>, <textarea>, or <select> elements.',
      parameters: {
        type: 'object',
        properties: {
          fields: {
            type: 'object',
            description: 'Object mapping field labels to values. The label should match the visible label, placeholder, or name attribute of the field. Example: {"First name":"Joseph","Email":"joseph@example.com","Country":"Jordan","Message":"Hello"}'
          }
        },
        required: ['fields']
      }
    },
    {
      name: 'snapshotPage',
      description: 'Take a deep structured snapshot of the current page — returns all visible text, input values, element roles, and a universal Accessibility Tree of every interactive element with their real accessible names. Use this when the page context seems incomplete, elements are in shadow DOM, or you need a full layout map before acting.',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'readDocContent',
      description: 'Read the actual text content of a canvas-rendered document or spreadsheet invisible to normal snapshots. Google Docs: extracts paragraphs, headings, and lists from the Accessibility Tree. Google Sheets / Excel Online: navigates to a cell (if specified) then reads the Formula Bar. Always call before editing existing content.',
      parameters: {
        type: 'object',
        properties: {
          cell: { type: 'string', description: 'Sheets/Excel only — cell reference to navigate to before reading (e.g. "A1", "B3"). Leave blank to read the currently selected cell.' }
        }
      }
    },
    {
      name: 'goToCell',
      description: 'Navigate to a specific cell in Google Sheets or Excel Online using the Name Box. This is the ONLY reliable way to target a cell — never try to calculate grid coordinates. After calling this, use \'type\' to enter a value or \'readDocContent\' to read it.',
      parameters: {
        type: 'object',
        properties: {
          cell: { type: 'string', description: 'Cell reference to navigate to, e.g. "A1", "B3", "Z100"' }
        },
        required: ['cell']
      }
    },
    {
      name: 'exportPDF',
      description: 'Export the current page as a PDF file and download it. Works on any page — articles, invoices, reports, Google Docs, spreadsheets, web apps. One call, no menus needed.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Name for the downloaded PDF file (without .pdf extension), e.g. "invoice-march" or "search-results"' },
          landscape: { type: 'boolean', description: 'If true, exports in landscape orientation. Default is portrait.' }
        }
      }
    },
    {
      name: 'findElement',
      description: 'Search the entire DOM tree (including shadow roots and hidden layers) for elements matching a CSS selector, XPath, or text string. Returns up to 5 matches with their tag, id, class, and text. Use when click/hover cannot find an element — this searches places the accessibility tree cannot reach.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'CSS selector, XPath expression, or plain text to search for, e.g. ".submit-btn", "//button[@aria-label=\'Close\']", or "Accept cookies"' }
        },
        required: ['query']
      }
    },
    {
      name: 'setMobileMode',
      description: 'Switch the current page to a mobile phone viewport (390×844, iPhone user-agent) or back to desktop. Use when a site hides features behind a hamburger menu, has a mobile-only interface, or when the desktop layout makes elements hard to find.',
      parameters: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'true = enable mobile mode, false = restore desktop view' },
          width:   { type: 'number', description: 'Mobile viewport width in pixels (default 390)' },
          height:  { type: 'number', description: 'Mobile viewport height in pixels (default 844)' }
        }
      }
    },
    {
      name: 'readNetworkResponse',
      description: 'Capture the next API/XHR/fetch response from the page and return its raw body. Use BEFORE triggering the request (e.g. before clicking Search or Submit) so the interceptor is ready. Perfect for reading search results, prices, flight data, or any data the page loads from a server — far more accurate than reading rendered text.',
      parameters: {
        type: 'object',
        properties: {
          url:     { type: 'string', description: 'URL pattern to filter responses, e.g. "api/search" or "flights". Leave empty to capture the very next response.' },
          timeout: { type: 'number', description: 'Seconds to wait for a matching response (default 10, max 30)' },
          maxChars:{ type: 'number', description: 'Max characters of response body to return (default 4000)' }
        }
      }
    },
    {
      name: 'writeChunk',
      description: 'Append a chunk of text to the currently focused input, textarea, or document editor WITHOUT clearing what is already there. Use this for long writing tasks — call it multiple times in sequence to build up a full article, report, or document that exceeds a single response limit. Works in Google Docs, Notion, textareas, and any contenteditable element.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The chunk of text to insert at the current cursor position. Can be a paragraph, a section, or any length of content.' },
          selector: { type: 'string', description: 'CSS selector of the element to focus before inserting, e.g. "textarea", ".ql-editor". Leave blank if the correct element is already focused.' }
        },
        required: ['text']
      }
    },
    {
      name: 'readStorage',
      description: 'Read the current page\'s localStorage, sessionStorage, and/or cookies. Use this to check if a user is logged in, read saved settings, inspect session tokens, or see what state the page has stored. Filter by key name to avoid noise.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            enum: ['all', 'local', 'session', 'cookies'],
            description: '"all" returns everything (default). "local" = localStorage only. "session" = sessionStorage only. "cookies" = document cookies only.'
          },
          key: {
            type: 'string',
            description: 'Optional: only return entries whose key contains this string. Example: "auth" returns only auth-related keys. Leave blank to return all keys.'
          },
          maxChars: {
            type: 'number',
            description: 'Max characters to return (default 3000). Increase if you need more data.'
          }
        }
      }
    },
    {
      name: 'scroll',
      description: 'Scroll the current page.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] }
        }
      }
    },
    {
      name: 'navigate',
      description: 'Load a different web address in the current tab (change the page entirely, like typing into the browser address bar). Use this when the task asks to go to a specific website/URL, not for clicking links already on the page.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The full website address to go to, e.g. "https://www.snaptoai.com"' }
        },
        required: ['url']
      }
    },
    {
      name: 'pressKey',
      description: 'Press a keyboard key or shortcut on the current page. Use this for: save (ctrl+s), undo (ctrl+z), redo (ctrl+y), select all (ctrl+a), copy (ctrl+c), paste (ctrl+v), bold (ctrl+b), Escape, Enter, Tab, arrow keys, F-keys, and any modifier combo. This is the ONLY reliable way to save a document in Word Online or Excel Online.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key or combo to press. Format: "ctrl+s", "ctrl+z", "ctrl+shift+s", "escape", "enter", "tab", "f12", "arrowdown". Case-insensitive.' }
        },
        required: ['key']
      }
    },
    {
      name: 'readIndexedDB',
      description: 'Read data from IndexedDB databases stored by the current page — used by Gmail (email drafts), Notion (page cache), Figma (file data), and most Progressive Web Apps (PWAs) for offline storage. More powerful than readStorage because it accesses data JS cannot easily reach.',
      parameters: {
        type: 'object',
        properties: {
          database: { type: 'string', description: 'Filter by database name (partial match). Leave blank to list all databases.' },
          store:    { type: 'string', description: 'Filter by object store name (partial match). Leave blank to read all stores.' },
          maxRows:  { type: 'number', description: 'Max rows to return per store (default 10, max 50).' },
          maxChars: { type: 'number', description: 'Max characters to return total (default 4000).' }
        }
      }
    },
    {
      name: 'interceptRequest',
      description: 'Intercept the next outgoing network request from the page. Can read it, block it, or modify its headers/body before it is sent. Use to: inject an Authorization header, block an ad/tracker request, or swap a form body before submission.',
      parameters: {
        type: 'object',
        properties: {
          url:     { type: 'string', description: 'URL pattern to match, e.g. "api/submit" or "checkout". Supports * wildcards. Leave blank to catch the very next request.' },
          action:  { type: 'string', enum: ['continue', 'block'], description: '"continue" (default) lets the request through (optionally modified). "block" cancels it.' },
          headers: { type: 'object', description: 'Headers to add or override, e.g. {"Authorization":"Bearer xyz","X-Custom":"value"}' },
          body:    { type: 'string', description: 'New request body to send instead of the original (replaces it entirely).' },
          timeout: { type: 'number', description: 'Seconds to wait for a matching request (default 10).' }
        }
      }
    },
    {
      name: 'getComputedStyle',
      description: 'Read the actual browser-computed CSS values for any element — including properties that are inherited, set by media queries, or not visible in the HTML source. Use to confirm an element is truly visible/hidden, read its exact color, font size, z-index, or any CSS property.',
      parameters: {
        type: 'object',
        properties: {
          selector:   { type: 'string', description: 'CSS selector of the element, e.g. ".submit-btn" or "#header".' },
          properties: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of CSS property names to return, e.g. ["display","visibility","color","font-size"]. Leave blank to return all computed properties.'
          }
        },
        required: ['selector']
      }
    },
    {
      name: 'getCookies',
      description: 'Read ALL cookies for the current page — including HttpOnly cookies that JavaScript cannot access (auth tokens, session IDs, CSRF tokens). Use to check if a user is logged in, inspect security flags (Secure, SameSite), or read session data.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Filter by cookie name (partial match), e.g. "session" or "auth". Leave blank to return all cookies.' }
        }
      }
    },
    {
      name: 'captureConsole',
      description: 'Capture console.log, console.warn, and console.error messages from the current page for a short window. Use to debug a broken page, see what errors are being thrown, confirm a script ran, or read data the app logs to the console.',
      parameters: {
        type: 'object',
        properties: {
          level:    { type: 'string', enum: ['all', 'log', 'warn', 'error'], description: 'Which console messages to capture (default: all).' },
          wait:     { type: 'number', description: 'Seconds to listen for messages (default 2, max 10). Trigger the action you want to debug BEFORE calling this, then call captureConsole immediately after.' },
          maxLines: { type: 'number', description: 'Max number of log lines to return (default 30, max 100).' }
        }
      }
    },
    {
      name: 'clearSiteData',
      description: 'Clear cached data, cookies, localStorage, sessionStorage, IndexedDB, or service workers for the current page origin. Use to force a fresh login, reset a broken app state, or test a page as a brand-new user.',
      parameters: {
        type: 'object',
        properties: {
          types: {
            type: 'string',
            enum: ['all', 'cache', 'cookies', 'storage', 'local', 'session', 'idb', 'sw'],
            description: '"all" clears everything. "cache" = browser cache. "cookies" = cookies only. "storage" = localStorage + sessionStorage + IndexedDB. "idb" = IndexedDB only. "sw" = service workers. Default: "all".'
          }
        }
      }
    },
    {
      name: 'getPerformance',
      description: 'Get real browser performance metrics for the current page: page load time, time-to-first-byte, DOM ready time, transfer size, JS heap memory, node count, and layout count. Use to benchmark a page, check if it loaded fully, or detect memory leaks.',
      parameters: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'auditPage',
      description: 'Collect browser-detected issues on the current page: CSP violations, mixed content, broken cookies, CORS errors, deprecation warnings, low-contrast text — everything Chrome DevTools flags in the Issues panel. Optionally reload the page first to capture all issues fresh.',
      parameters: {
        type: 'object',
        properties: {
          type:     { type: 'string', description: 'Filter by issue type keyword, e.g. "cookie", "cors", "csp", "mixed". Leave blank for all issues.' },
          reload:   { type: 'boolean', description: 'Set true to reload the page before auditing so all issues are re-triggered (default false).' },
          wait:     { type: 'number', description: 'Seconds to listen for issues (default 3, max 10).' },
          maxChars: { type: 'number', description: 'Max characters to return (default 4000).' }
        }
      }
    },
    {
      name: 'readCache',
      description: 'List and read files stored in Service Worker caches — offline pages, cached API responses, PWA assets. Use to see what a Progressive Web App has cached, check if stale content is being served, or verify that a cache was cleared.',
      parameters: {
        type: 'object',
        properties: {
          cache:       { type: 'string', description: 'Filter by cache name (partial match). Leave blank to list all caches.' },
          maxEntries:  { type: 'number', description: 'Max entries to return per cache (default 20, max 100).' }
        }
      }
    },
    {
      name: 'getEventListeners',
      description: 'List ALL JavaScript event listeners attached to any element — click, submit, keydown, custom events, and more. Shows exactly what code will run when you interact with the element. Essential for debugging "why doesn\'t this button do anything" or finding hidden form handlers.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the element, e.g. "#submit-btn" or ".nav-link". Defaults to "document" (lists all listeners on the document).' },
          depth:    { type: 'number', description: 'How many levels deep to search into the DOM tree (default 1).' }
        }
      }
    },
    {
      name: 'snapshotHeap',
      description: 'Force garbage collection then report JavaScript heap memory usage, node/iframe/script counts, and top memory allocation call sites. Use to detect memory leaks, check if a page is consuming excessive RAM, or confirm GC ran before a memory-sensitive test.',
      parameters: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'readBrowserLog',
      description: 'Capture browser-generated log entries — network errors, Content Security Policy violations, deprecation warnings, blocked requests, security errors. These appear in DevTools Console with shield/warning icons and are NOT the same as console.log output (use captureConsole for that).',
      parameters: {
        type: 'object',
        properties: {
          level:    { type: 'string', enum: ['all', 'error', 'warning', 'info', 'verbose'], description: 'Which log level to capture (default: all).' },
          reload:   { type: 'boolean', description: 'Set true to reload the page before capturing so all issues are re-triggered (default false).' },
          wait:     { type: 'number', description: 'Seconds to listen (default 3, max 15).' },
          maxLines: { type: 'number', description: 'Max log lines to return (default 50, max 200).' }
        }
      }
    },
    {
      name: 'getSecurityInfo',
      description: 'Get the security state of the current page: HTTPS certificate details (subject, valid from/to), cipher suite, protocol (TLS version), mixed content warnings, and whether the connection is truly secure. Use before automating sensitive form submissions to confirm you\'re on a real HTTPS page.',
      parameters: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'manageServiceWorker',
      description: 'List, update, stop, or unregister Service Workers for the current page. Use when: a PWA is stuck serving stale cached content and needs a force-update, you want to unregister a broken SW, or you need to see which SW scope is controlling the page.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'unregister', 'update', 'skipWaiting'],
            description: '"list" (default) — show all registered SWs. "unregister" — remove the SW. "update" — force the SW to check for an update. "skipWaiting" — activate a waiting SW immediately.'
          },
          scope: { type: 'string', description: 'Filter by SW scope URL (partial match) when multiple SWs exist. Leave blank to target the first one found.' }
        }
      }
    },
    {
      name: 'listTargets',
      description: 'List all open browser targets — tabs, iframes, web workers, service workers. Use to discover what tabs are currently open, find an iframe\'s target ID for debugging, or identify which tab to direct the agent to next.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['page', 'iframe', 'worker', 'service_worker', 'background_page'],
            description: 'Filter by target type. Omit this parameter to list all targets.'
          }
        }
      }
    },
    {
      name: 'highlightElement',
      description: 'Draw a native Chrome highlight box around any CSS-selected element — the same highlight Chrome DevTools draws. More reliable than the ghost cursor because it works inside iframes, canvas apps, and pages with strict CSP. Use to visually confirm which element the agent is targeting before acting on it.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the element to highlight, e.g. "#submit" or ".product-card:first-child".' },
          duration: { type: 'number', description: 'How many seconds to show the highlight (default 2, max 10).' },
          r:        { type: 'number', description: 'Red channel of highlight colour 0-255 (default 66 — Google blue).' },
          g:        { type: 'number', description: 'Green channel 0-255 (default 133).' },
          b:        { type: 'number', description: 'Blue channel 0-255 (default 244).' },
          a:        { type: 'number', description: 'Alpha/opacity 0-1 (default 0.3).' }
        },
        required: ['selector']
      }
    },
    {
      name: 'getSystemInfo',
      description: 'Get Chrome browser version, GPU hardware info, codec support (video/image encoding & decoding capabilities). Use to confirm the browser environment before running tests, or check if a specific codec is hardware-accelerated.',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'setBrowserWindow',
      description: 'Resize, move, minimize, maximize, or fullscreen the browser window. Use to test responsive layouts at specific pixel dimensions, or simulate a specific screen size.',
      parameters: {
        type: 'object',
        properties: {
          width:  { type: 'number', description: 'Window width in pixels.' },
          height: { type: 'number', description: 'Window height in pixels.' },
          left:   { type: 'number', description: 'Window left position in pixels.' },
          top:    { type: 'number', description: 'Window top position in pixels.' },
          state:  { type: 'string', enum: ['normal', 'minimized', 'maximized', 'fullscreen'], description: 'Window state.' }
        }
      }
    },
    {
      name: 'grantPermission',
      description: 'Grant browser permissions to the current page without showing a popup dialog — camera, microphone, geolocation, notifications, clipboard, etc. Use before testing features that require permission prompts.',
      parameters: {
        type: 'object',
        properties: {
          permissions: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of permissions to grant. Options: "geolocation", "camera", "microphone", "notifications", "clipboardReadWrite", "clipboardSanitizedWrite", "accessibilityEvents", "sensors", "backgroundSync", "backgroundFetch", "nfc", "periodicBackgroundSync", "midi", "midiSysex".'
          },
          permission: { type: 'string', description: 'Single permission to grant (use "permissions" for multiple).' }
        }
      }
    },
    {
      name: 'readDOMStorage',
      description: 'Read localStorage or sessionStorage using the native CDP DOMStorage domain — more reliable than readStorage on pages that sandbox JavaScript execution (e.g. strict CSP pages). Returns raw key-value pairs directly from the storage engine.',
      parameters: {
        type: 'object',
        properties: {
          target:   { type: 'string', enum: ['all', 'local', 'session'], description: 'Which storage to read (default: all).' },
          key:      { type: 'string', description: 'Filter by key name (partial match). Leave blank to return all keys.' },
          maxChars: { type: 'number', description: 'Max characters to return (default 3000).' }
        }
      }
    },
    {
      name: 'setDeviceOrientation',
      description: 'Emulate device tilt and gyroscope orientation — useful for testing apps that respond to physical device movement (maps, AR, compass apps, games). Alpha = compass heading, Beta = front/back tilt, Gamma = left/right tilt.',
      parameters: {
        type: 'object',
        properties: {
          alpha: { type: 'number', description: 'Z-axis rotation (compass heading), 0–360 degrees.' },
          beta:  { type: 'number', description: 'X-axis tilt (front/back), –180 to 180 degrees.' },
          gamma: { type: 'number', description: 'Y-axis tilt (left/right), –90 to 90 degrees.' },
          clear: { type: 'boolean', description: 'Set true to remove the orientation override and restore real device sensors.' }
        }
      }
    },
    {
      name: 'getAnimations',
      description: 'Detect and describe all CSS/Web Animations running on the current page — name, type, duration, delay, iteration count, and play state. Use to confirm animations are running, find stalled animations, or debug animation performance.',
      parameters: {
        type: 'object',
        properties: {
          wait: { type: 'number', description: 'Seconds to listen for animation events (default 2).' }
        }
      }
    },
    {
      name: 'setAnimationSpeed',
      description: 'Globally speed up, slow down, or pause all CSS and Web Animations on the page. Speed 0 = paused, 1 = normal, 2 = double speed, 0.1 = slow motion. Great for debugging animations or taking screenshots at precise animation frames.',
      parameters: {
        type: 'object',
        properties: {
          speed: { type: 'number', description: 'Playback rate multiplier. 0 = paused, 1 = normal speed, 2 = 2× speed, 0.5 = half speed (slow motion).' }
        },
        required: ['speed']
      }
    },
    {
      name: 'triggerAutofill',
      description: 'Trigger Chrome\'s native autofill on a form field using the browser\'s stored autofill data (name, address, card info). More reliable than simulating keystrokes for autofill testing since it uses the real Chrome autofill engine.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the input field to trigger autofill on (default: first input with autocomplete attribute).' }
        }
      }
    },
    {
      name: 'readBackgroundEvents',
      description: 'Observe Background Service events — background sync, push messaging, background fetch, payment handlers, periodic background sync. Use to verify a service worker\'s background jobs are registering and firing correctly.',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string', enum: ['backgroundSync', 'backgroundFetch', 'pushMessaging', 'notifications', 'paymentHandler', 'periodicBackgroundSync'], description: 'Which background service to observe (default: backgroundSync).' },
          wait:    { type: 'number', description: 'Seconds to listen for events (default 3, max 10).' }
        }
      }
    },
    {
      name: 'pauseOnException',
      description: 'Wait for an uncaught JavaScript exception or Promise rejection to occur, then capture the error message and call stack. Use to diagnose crashes — describe what action triggers the error, then call this tool immediately before performing that action.',
      parameters: {
        type: 'object',
        properties: {
          state: { type: 'string', enum: ['uncaught', 'all', 'none'], description: '"uncaught" (default) catches unhandled exceptions. "all" catches every throw including caught ones.' },
          wait:  { type: 'number', description: 'Seconds to wait for an exception (default 5, max 30).' }
        }
      }
    },
    {
      name: 'setEventBreakpoint',
      description: 'Pause page execution the moment a specific DOM or JavaScript event fires, then capture the call stack at that exact moment. Use to find what code runs when a button is clicked, a form is submitted, or a fetch is made.',
      parameters: {
        type: 'object',
        properties: {
          eventName: { type: 'string', description: 'Event to intercept. DOM events: "click", "submit", "keydown". JS events: "fetch", "xmlhttpRequestSend", "requestAnimationFrame", "setTimeout", "setInterval". Default: "click".' },
          wait:      { type: 'number', description: 'Seconds to wait for the event to fire (default 10, max 30).' }
        }
      }
    },
    {
      name: 'getFedCmInfo',
      description: 'Detect and inspect Federated Credential Management (FedCM) login dialogs — the "Sign in with Google/Apple/etc." pop-ups that Chrome shows natively. Use to check if a FedCM dialog appeared and what identity providers it offers.',
      parameters: {
        type: 'object',
        properties: {
          wait: { type: 'number', description: 'Seconds to wait for a FedCM dialog to appear (default 3).' }
        }
      }
    },
    {
      name: 'getFileSystem',
      description: 'List files and directories stored in the page\'s origin private file system (OPFS) — used by modern PWAs (Figma, Notion, VS Code Web) to store files locally in the browser without the user\'s file picker.',
      parameters: {
        type: 'object',
        properties: {
          bucket: { type: 'string', description: 'Storage bucket name (default: "default").' },
          path:   { type: 'string', description: 'Directory path within the bucket, e.g. "documents/2024". Leave blank for root.' }
        }
      }
    },
    {
      name: 'getLayerTree',
      description: 'Inspect the browser\'s compositor layer tree — shows how the page is split into GPU layers, which elements create their own layers (due to transforms, will-change, video, canvas), and layer dimensions. Use to debug rendering performance and layer explosion.',
      parameters: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'inspectMedia',
      description: 'Inspect all <video> and <audio> elements on the page — current playback state, codec, resolution, buffered ranges, errors, and player events. Use to check if a video is playing, stalled, or erroring, and what format it\'s using.',
      parameters: {
        type: 'object',
        properties: {
          wait: { type: 'number', description: 'Seconds to listen for media player events (default 2).' }
        }
      }
    },
    {
      name: 'getMemoryInfo',
      description: 'Get precise DOM memory counters directly from the browser engine: total DOM node count, active event listener count, open document count. Optionally force a garbage collection first. More accurate than snapshotHeap for counting DOM objects.',
      parameters: {
        type: 'object',
        properties: {
          gc: { type: 'boolean', description: 'Set true to force JavaScript memory purge before reading counters (default false).' }
        }
      }
    },
    {
      name: 'trackWebVitals',
      description: 'Track real Core Web Vitals events as they happen: Largest Contentful Paint (LCP), Cumulative Layout Shift (CLS), First Input Delay (FID). Use after a page load or navigation to capture the actual performance metrics Chrome measures.',
      parameters: {
        type: 'object',
        properties: {
          wait: { type: 'number', description: 'Seconds to listen for web vital events after the page loads (default 5, max 15).' }
        }
      }
    },
    {
      name: 'getPreloadRules',
      description: 'Inspect the page\'s Speculation Rules — prefetch and prerender rules that Chrome uses to proactively load the next page before the user navigates. Use to verify speculation rules are active and check their status.',
      parameters: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'profileCPU',
      description: 'Record a CPU profile showing which JavaScript functions are consuming the most execution time. Use to find performance bottlenecks — the top functions by hit count are the ones slowing the page down.',
      parameters: {
        type: 'object',
        properties: {
          duration: { type: 'number', description: 'How many seconds to record (default 3, max 15). Trigger the slow action during this window.' },
          interval: { type: 'number', description: 'Sampling interval in microseconds (default 100 = 10kHz).' }
        }
      }
    },
    {
      name: 'getPWAInfo',
      description: 'Check if the current site is a Progressive Web App: whether it has a manifest, if it\'s currently running in standalone (installed) mode, and its OS installation state. Use to verify PWA installability or check if a site is being used as an installed app.',
      parameters: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'getCDPSchema',
      description: 'List all CDP (Chrome DevTools Protocol) domains and their versions that this version of Chrome supports. Use to check which CDP domains are available before calling them, or to see what the current Chrome build supports.',
      parameters: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'recordTrace',
      description: 'Record a Chrome performance trace for a few seconds and return a summary of the top event types (layout, paint, script, GC, etc.). Use to diagnose what Chrome is spending its time on during a slow interaction — a high-level flamechart in text form.',
      parameters: {
        type: 'object',
        properties: {
          duration: { type: 'number', description: 'Seconds to record (default 3, max 10). Trigger the slow action during this window.' }
        }
      }
    },
    {
      name: 'inspectWebAudio',
      description: 'Detect and inspect Web Audio API contexts on the page — AudioContext state (running/suspended/closed), sample rate, buffer size, and all audio nodes in the graph. Use to debug audio apps, music players, or voice features.',
      parameters: {
        type: 'object',
        properties: {
          wait: { type: 'number', description: 'Seconds to listen for audio contexts (default 2).' }
        }
      }
    },
    {
      name: 'emulateWebAuthn',
      description: 'Add or remove a virtual WebAuthn/FIDO2 authenticator in Chrome for testing passwordless login flows (passkeys, security keys, biometrics) without needing real hardware. Use to test that a site\'s login works with passkeys.',
      parameters: {
        type: 'object',
        properties: {
          action:          { type: 'string', enum: ['add', 'remove'], description: '"add" creates a virtual authenticator. "remove" deletes it by ID.' },
          protocol:        { type: 'string', enum: ['ctap2', 'u2f'], description: 'Authenticator protocol (default: ctap2 for passkeys).' },
          transport:       { type: 'string', enum: ['internal', 'usb', 'ble', 'nfc', 'cable'], description: 'Transport type. "internal" = platform authenticator (Face ID / fingerprint style). Default: "internal".' },
          residentKey:     { type: 'boolean', description: 'Whether the authenticator supports discoverable credentials/passkeys (default true).' },
          userVerification:{ type: 'boolean', description: 'Whether to require user verification (biometric/PIN) (default true).' },
          authenticatorId: { type: 'string', description: 'ID of authenticator to remove (returned by a prior "add" call).' },
          enableUI:        { type: 'boolean', description: 'Show the WebAuthn DevTools UI panel (default false).' }
        }
      }
    },
    {
      name: 'switchSheet',
      description: 'Switch to a different sheet tab inside Excel Online or Google Sheets by its name. Use this when the task mentions "Sheet2", "Budget tab", "Q3", or any named sheet that is not currently active. Always call this BEFORE typing into a sheet to make sure you are on the right one.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The exact or partial name of the sheet tab to switch to, e.g. "Sheet2", "Budget", "Q3 Sales"' }
        },
        required: ['name']
      }
    },
    {
      name: 'switchDocTab',
      description: 'Switch to a different Document Tab inside a Google Docs document. Google Docs supports multiple tabs within one document (visible in the left sidebar). Use this when the task references a specific section, chapter, or named tab in the document.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The name or partial name of the document tab to switch to, e.g. "Chapter 2", "Introduction", "Appendix"' }
        },
        required: ['name']
      }
    },
    {
      name: 'planTask',
      description: 'Lay out a numbered step-by-step plan before executing a complex multi-step task (5+ steps). Call this FIRST — before any clicks or navigation — so you stay oriented across long sessions. The plan is shown to the user and tracked with checkPlan.',
      parameters: {
        type: 'object',
        properties: {
          steps:   { type: 'array', items: { type: 'string' }, description: 'Ordered list of concrete steps. Each step = one specific action or milestone. Example: ["Navigate to gmail.com", "Click Compose", "Fill To field", "Fill Subject", "Type body", "Click Send"]' },
          summary: { type: 'string', description: 'One-sentence description of the overall goal, shown to the user.' }
        },
        required: ['steps']
      }
    },
    {
      name: 'checkPlan',
      description: 'Mark a plan step as complete and confirm which step to work on next. Call this after finishing each milestone to track progress through a long task.',
      parameters: {
        type: 'object',
        properties: {
          stepIndex: { type: 'number', description: 'Zero-based index of the step just completed (0 = first step).' },
          note:      { type: 'string', description: 'Optional note about what happened, was found, or should be remembered for the next step.' }
        },
        required: ['stepIndex']
      }
    },
    {
      name: 'openTab',
      description: 'Open a URL in a new browser tab. By default opens in the background so the agent stays on the current tab. Use switchTab afterwards to move focus there.',
      parameters: {
        type: 'object',
        properties: {
          url:        { type: 'string', description: 'Full URL to open, e.g. "https://competitor.com". https:// is added automatically if missing.' },
          background: { type: 'boolean', description: 'Open without switching browser focus (default true = background). Set false to make the browser jump to the new tab immediately.' },
          switchTo:   { type: 'boolean', description: 'Also move the agent focus to the new tab right away (default false). Equivalent to openTab + switchTab in one call.' }
        },
        required: ['url']
      }
    },
    {
      name: 'switchTab',
      description: 'Move the agent\'s focus to a different browser tab. All subsequent actions (click, type, scroll, etc.) will target that tab. Use listTargets to discover available tab IDs and URLs.',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'number', description: 'Numeric tab ID to switch to (from listTargets output or openTab response).' },
          url:   { type: 'string', description: 'Partial URL to match — switches to the first open tab whose URL contains this string. Use instead of tabId when you don\'t know the exact ID.' }
        }
      }
    },
    {
      name: 'closeTab',
      description: 'Close a browser tab. If closing the tab the agent is currently controlling, it automatically moves focus to the next available tab.',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'number', description: 'Tab ID to close. If omitted, closes the tab the agent is currently controlling.' }
        }
      }
    },
    {
      name: 'finish',
      description: 'Call this when the task is complete, impossible, or you need to stop and tell the user something.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'A short plain-language summary of what happened, for the user.' }
        },
        required: ['summary']
      }
    }
  ]
}];

// ── Dynamic Skill Library ──────────────────────────────────────────────────
// Maps URL patterns to site-specific knowledge blocks injected automatically
// into the system prompt before every agent turn. The agent "wakes up" already
// knowing which app it is in — no manual prompting required.
const SKILL_LIBRARY = {
  google_docs: `
SKILL — GOOGLE DOCS: You are controlling a Google Docs document.
- READ EXISTING CONTENT: Always call readDocContent() first before editing — it extracts paragraphs, headings and lists from the Accessibility Tree so you know what is already written.
- The document body is a virtual canvas. Type directly using the "type" tool — no selector needed.
- Find toolbar buttons by [aria-label] (e.g. aria-label="Bold"). The Accessibility Tree uses standard names.
- Menus (Insert, Format, Tools) are real HTML buttons — click to open, then click the sub-item.
- To rename: click the title bar, Ctrl+A, type new name, Enter.
- Save: pressKey("ctrl+s"). Never use File > Save manually.`,

  microsoft_word: `
SKILL — WORD ONLINE: You are controlling a Microsoft Word Online document.
- The editor lives inside a nested iframe. The DOM snapshot has been pierced so you CAN read the document text.
- Find toolbar buttons using [data-automation-id] (e.g. data-automation-id="Bold", "Italic", "FontSize").
- Type into the document body using the "type" tool with no selector — the agent uses CDP key injection automatically.
- Save: pressKey("ctrl+s").
- If you see a blank editor area, do NOT navigate away — the content is inside the iframe, already visible in your snapshot.`,

  google_sheets: `
SKILL — GOOGLE SHEETS: You are controlling a Google Sheets spreadsheet.
- NAVIGATE TO A CELL: Always use goToCell("A1") — never try to click grid coordinates. This is deterministic.
- READ A CELL VALUE: call readDocContent({cell:"B3"}) — it navigates to that cell and reads the Formula Bar.
- TYPE INTO A CELL: call goToCell("A1") first, then call type({text:"your value"}). Use "\\t" to move right, "\\n" to move down.
- Fill a whole range in one shot: goToCell("A1"), then type({text:"Name\\tAge\\tCity\\nAlice\\t30\\nBob\\t25"}).
- Save: pressKey("ctrl+s").
- To create a new sheet: navigate("https://sheets.new").`,

  microsoft_excel: `
SKILL — EXCEL ONLINE: You are controlling a Microsoft Excel Online spreadsheet.
- Use the "cell" parameter to target cells. Separate columns with "\\t", rows with "\\n".
- Toolbar buttons use [data-automation-id] same as Word Online.
- Save: pressKey("ctrl+s").`,

  google_slides: `
SKILL — GOOGLE SLIDES: You are controlling a Google Slides presentation.
- Slide content is a canvas — click a text box first, then use "type" to enter text.
- Use [aria-label] to find toolbar buttons (Bold, Italic, font size, etc.).
- Save: pressKey("ctrl+s").`,

  generic: `
SKILL — STANDARD WEBSITE: You are on a standard webpage.
- Use CSS selectors, visible text labels, or X/Y coordinates to locate elements.
- The Accessibility Tree (snapshotPage) gives you standardized button names if the DOM is complex.`
};

function getDynamicSkill(url) {
  const u = url || '';
  if (u.includes('docs.google.com'))   return SKILL_LIBRARY.google_docs;
  if (u.includes('word.office.com') || u.includes('word.live.com') || u.includes('word.microsoft.com')) return SKILL_LIBRARY.microsoft_word;
  if (u.includes('sheets.google.com') || u.includes('docs.google.com/spreadsheets')) return SKILL_LIBRARY.google_sheets;
  if (u.includes('excel.office.com') || u.includes('excel.live.com'))  return SKILL_LIBRARY.microsoft_excel;
  if (u.includes('slides.google.com') || u.includes('docs.google.com/presentation')) return SKILL_LIBRARY.google_slides;
  return SKILL_LIBRARY.generic;
}
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_SYSTEM_PROMPT = `You are an in-browser automation agent controlling the user's ACTIVE browser tab, one small step at a time.

### CRITICAL OPERATING PROCEDURES — READ FIRST, ALWAYS:
1. **GOOGLE DOCS — You are BLIND to the canvas.** You MUST call readDocContent() as your FIRST action before summarising, editing, or referencing ANY existing text. The canvas renders pixels — innerText sees nothing. readDocContent() uses the Accessibility Tree to extract the real paragraphs, headings, and lists.
2. **GOOGLE SHEETS / EXCEL ONLINE — NEVER click the grid blindly.** To READ a cell: call readDocContent({cell:"B3"}). To WRITE: call goToCell("B3") then type({text:"value"}). To fill a range: goToCell("A1") then type using \\t for columns and \\n for rows. Never guess coordinates.
3. **WORD ONLINE — You are in an iframe.** pierce:true is active so you CAN see the document. Use [data-automation-id] for ribbon buttons. Type into the body with type() and no selector. Save with pressKey("ctrl+s").
4. **STAY ON TASK TAB.** Do NOT navigate away from the tab you started on unless the user explicitly says to switchTab. If you find yourself on a New Tab or wrong page, call navigate() back to the original URL immediately.
5. **ANY DOCUMENT EDITOR** — Always pressKey("ctrl+s") after finishing any write operation. Never use File > Save menus.

Rules:
- Each turn you are given BOTH a text snapshot of the page AND a real screenshot image of what it currently looks like. Use the screenshot to visually confirm where you actually are (e.g. did the click really open the product page, are you still on a search results list, did a popup/modal appear) before deciding your next move — don't rely on text alone.
- If the screenshot and the text disagree, or the screenshot shows you're not where you expected, trust the screenshot and re-orient (e.g. close a popup, scroll, or navigate again) instead of repeating the same action blindly.
- PARALLEL EXECUTION: You CAN call multiple independent functions in a single turn — do this whenever actions don't depend on each other's results. Examples: call readNetworkResponse AND click together to intercept an API; call snapshotPage AND getCookies AND getSecurityInfo all at once for a site audit; run two unrelated clicks in the same turn. Use single-action turns only when each step depends on the prior result (e.g. click → wait for result → type into what appeared).
- PLANNING: For tasks with more than 5 steps, call planTask FIRST to lay out a numbered plan before executing anything. Use checkPlan after completing each milestone to track progress and stay oriented across long sessions.
- MULTI-TAB: Use openTab to open a URL in a new browser tab, switchTab to move the agent's focus to a different tab, closeTab to close one. Use listTargets to see all open tabs and their IDs. This lets you work across multiple sites in one session — open a reference page alongside the current one, fill forms in parallel across tabs, or compare two sites.
- If the task asks you to go to a specific website/URL that is not the current page, use "navigate" with the full address — do NOT try to fake it by typing the URL into a search box or link on the page.
- Use "doubleClick" (not "click") when a single click would only select/highlight an item and it actually needs to be OPENED — e.g. opening a file or folder in Google Drive, launching an item from a file list.
- Use "drag" for anything that requires picking something up and moving it — e.g. moving a chess/game piece from one square to another, dragging a slider, or reordering a list. A plain "click" cannot do this.
- If a page seems to contain content inside an embedded viewer/frame (a document preview, PDF viewer, etc.) and "scroll" doesn't seem to move it, try clicking directly inside that content area first, then scroll again.
- After each action you will be told whether it succeeded and shown the page again, so you can decide the next step.
- If an action fails, try a different way to find the same element (different text/description) before giving up.
- MULTI-STEP TASKS: many instructions are really a sequence written in one sentence (e.g. "find a channel, then open its analytics, then read the numbers, then summarize them"). Treat each part, in the order given, as its own milestone. Before acting, silently work out which milestone you're currently on based on the screenshot/page text, complete it fully (including any waiting/scrolling needed to confirm it worked), and only then move to the next one — do not skip ahead, do not jump back to an earlier milestone unless the screenshot shows you actually left the intended path, and do not stop early just because an earlier milestone technically "looks done" if the sentence clearly continues past it.
- GATHERING/READING DATA: if the task asks you to "get", "read", "check", or "gather" information (numbers, stats, text, a list, etc.) rather than to perform an action, your job is DONE once you can see that information in the current screenshot/page text — call "finish" with a summary that actually includes the data you found (the real numbers/values/text visible), not just "task completed."
- Call "finish" as soon as the full sequence is done, or if it cannot be done on this page, or if it requires something risky/irreversible (like sending money, submitting a payment, deleting something, or sending an email) that the user should confirm themselves first — in that case explain what you found and stop instead of doing it.
- If the user's message is ambiguous, unclear, or doesn't read like an actionable instruction (e.g. a stray phrase, a comment, or something that isn't clearly a task), do NOT guess and start searching the web for it. Call "finish" and ask them to clarify what they want you to do instead.
- Never invent that something happened — only report success after a function call actually returns success.
- If a page repeatedly returns no readable text or the same action fails the same way more than once in a row, stop retrying blindly — call "finish" and explain what's blocking you.
- Keep your reasoning to yourself; only function calls and the final "finish" summary are shown to the user.
- DOCUMENT EDITORS (Google Docs, Word Online): These apps use a virtual canvas — there is no real DOM text field for the document body. The document TITLE is a real input (avoid clicking it). To write into the document body: use "type" with your text and no selector — the agent automatically uses the correct keyboard injection method. Do NOT try to click on text inside the document or search for a body element by name. Just call "type" directly after the page loads.
- GOOGLE DOCS TITLE RENAME: To rename a Google Doc, click on the title at the top of the page (it will say "Untitled document" or the current name), then immediately use pressKey("ctrl+a") to select all the existing title text, then type the new name, then pressKey("enter"). Do this sequence ONCE and stop — do NOT retry it more than once if it appears to succeed.
- GOOGLE DOCS MENUS: Google Docs menus (Insert, Format, Tools, etc.) are real HTML buttons — use click to open them. After a menu opens, use click (NOT hover) to choose the sub-item (e.g. click "Image", click "Drawing"). The hover tool does NOT work for Google Docs menu items because they render inside a floating layer. If a popup or dialog appears unexpectedly, pressKey("escape") once to dismiss it, then retry your original action.
- GOOGLE DOCS TITLE vs BODY: To type in the document BODY, use "type" directly — do NOT click on the document canvas first.
- SAVING DOCUMENTS: To save in Word Online, Excel Online, Google Docs, or any web editor — use pressKey with key "ctrl+s". Do NOT click File > Save manually; the keyboard shortcut is faster and more reliable. Always pressKey("ctrl+s") after finishing a typing task in an editor.
- WORD ONLINE — attachments & templates: Word Online menus (Insert, File, etc.) are real HTML buttons. Use "click" with the menu name (e.g. click "Insert"), then click the sub-item (e.g. click "Pictures" or "From computer"). For templates: navigate to office.com, find the template in the gallery, then click to open it — do NOT try to access templates from within an already-open document.
- EXCEL ONLINE — entering data into cells: Always use the "cell" parameter to specify WHERE to start typing (e.g. cell:"A1", cell:"B2"). Use "\t" (tab) to separate values going RIGHT across columns, and "\n" (newline) to move DOWN to the next row. Example — fill a 3-column table starting at A1: type({cell:"A1", text:"Name\tAge\tCity\nAlice\t30\tLondon\nBob\t25\tParis"}). This fills A1=Name, B1=Age, C1=City, A2=Alice, B2=30, C2=London, A3=Bob, B3=25, C3=Paris — all in ONE call. Do NOT call "type" once per cell; fill the whole range in one shot. After filling, pressKey("ctrl+s") to save.
- GOOGLE SHEETS — creating a new sheet: Always navigate to "https://sheets.new" to create a brand-new blank Google Sheet. Do NOT click "Blank spreadsheet" from the Sheets home page — it is unreliable. Just navigate("https://sheets.new") and wait for the sheet to open.
- GOOGLE SHEETS — entering data (CRITICAL): You MUST use the "cell" parameter AND the TSV format. A single type call fills the entire table in one shot. Use "\t" (tab) to move RIGHT to the next column. Use "\n" (newline) to move DOWN to the next row. CORRECT example — 2-column monthly table: type({cell:"A1", text:"Month\tPrice\nJanuary\t100\nFebruary\t120\nMarch\t130\nApril\t110\nMay\t140\nJune\t150\nJuly\t160\nAugust\t155\nSeptember\t145\nOctober\t135\nNovember\t125\nDecember\t115"}). This fills A1=Month, B1=Price, A2=January, B2=100, A3=February, B3=120, and so on — all 13 rows in ONE call. WRONG — never do this: type({text:"Month Price January 100 February 120..."}) with spaces. Spaces do NOT move between cells — all text goes into one cell. Always use \t between columns and \n between rows, always specify cell:"A1".
- KEYBOARD SHORTCUTS: Use pressKey for any shortcut — "ctrl+b" (bold), "ctrl+i" (italic), "ctrl+u" (underline), "ctrl+z" (undo), "ctrl+y" (redo), "ctrl+a" (select all), "escape" (close dialog), "f2" (rename/edit), "ctrl+home" (go to top). These work reliably in ALL apps including canvas editors.
- HOVER MENUS: Many nav bars, toolbars, and action menus are hidden until you hover. If a menu item or button does not appear when you look at the page, try hover first (e.g. hover("File") to open the File menu), then click the revealed option in your next step. This works on Bootstrap dropdowns, Office ribbon menus, nav menus, and any element that uses CSS :hover or JS mouseenter.
- SELECT DROPDOWNS: For native HTML dropdowns (<select>), use the "select" tool with label and value — it is far more reliable than clicking options. Example: select({label:"Sort by", value:"Newest"}). If the dropdown is a custom styled widget (built with divs), use click instead.
- SEARCHING THE WEB: To search Google (or any search engine), navigate directly to the search URL — do NOT try to find and type into a search box. Examples: navigate("https://www.google.com/search?q=famous+pieces+of+art"), navigate("https://www.bing.com/search?q=best+laptops+2024"), navigate("https://duckduckgo.com/?q=how+to+invest"). Replace spaces with + in the query. This is faster, more reliable, and always works. Only use the type tool to type into a search box if you are already on a specific site that has its own internal search (e.g. YouTube, Amazon, a news site).
- WAITING FOR CONTENT: After a click that triggers a page load, form submit, or AJAX request, use waitForElement before your next action. Example: waitForElement({text:"Search results", timeout:10}). Without this, you risk clicking elements that have not loaded yet.
- READING DATA: Use readText to extract exact values from the page — a price, a number, a field value — when the screenshot alone is not precise enough. The extracted text is returned directly in the tool response so you can use it in your next step. Example: readText({selector:".total-price"}) or readText({text:"Balance"}). 
- REPLACING FIELD VALUES: When typing into a field that already has content (a search box, a form field with a pre-filled value), add clearFirst:true to "type" to erase the old value before typing. Example: type({text:"new search", clearFirst:true}).
- COORDINATE CLICK: If you have tried text/selector and an element still cannot be found, use click with x and y coordinates from the screenshot. Example: click({x:540, y:320}). Use this as a last resort only.
- FORM FILLING: When a task involves filling multiple fields on a form, use autofill with a fields object — one call fills everything. Example: autofill({fields:{"First name":"Joseph","Email":"j@example.com","Country":"Jordan"}}). Only fall back to typing field-by-field if autofill fails.
- PAGE PDF EXPORT: To save any page as a PDF, call exportPDF({filename:"my-file"}). Works on articles, invoices, Docs, spreadsheets — no need to open menus or find a print button.
- READING API DATA: To get accurate data (prices, search results, flight info) directly from the server response — call readNetworkResponse FIRST (before triggering the request), then click the search/submit button. The interceptor captures the raw JSON response and returns it. Example: readNetworkResponse({url:"api/search", timeout:10}) then click("Search").
- DEEP ELEMENT SEARCH: If click or hover cannot find an element (returns "not found"), try findElement({query:".class-name"}) or findElement({query:"button text"}) — it searches shadow DOM and hidden layers. Use the returned tag/id info to build a better selector for your next click.
- MOBILE MODE: If a site has a hamburger menu, shows content differently on mobile, or hides features behind a mobile-only UI — use setMobileMode({enabled:true}) to switch to iPhone viewport. Switch back with setMobileMode({enabled:false}) when done.
- DEEP PAGE SNAPSHOT: If the page context seems incomplete or you cannot find elements you can see in the screenshot, call snapshotPage() — it returns a richer structured DOM snapshot that includes hidden input values, shadow DOM text, and element roles the regular page text misses.
- LONG CONTENT WRITING: When writing long articles, reports, or documents (more than ~600 words), use writeChunk instead of type. First click or focus the target field, then call writeChunk multiple times — each call appends to what is already there without clearing it. Example flow: click the editor → writeChunk({text:"Introduction paragraph..."}) → writeChunk({text:"Section 2 content..."}) → writeChunk({text:"Conclusion..."}). This bypasses the single-turn output limit and lets you build unlimited-length documents.
- CHECKING AUTH / STATE: To check if a user is logged in, find a session token, or read what a site has saved, use readStorage. Examples: readStorage({target:"cookies", key:"auth"}) to find auth cookies, readStorage({target:"local", key:"user"}) to find saved user data, readStorage({target:"all"}) to see everything. Use the key filter to avoid getting thousands of unrelated entries.

- CHECKING AUTH / STATE reminder: use readStorage for session tokens and cookies.`;

// ── Autopilot mini mode ────────────────────────────────────────────────
// While Autopilot runs, the chat window is its own real OS popup window
// sitting on top of the page it's controlling. Shrinking it into a small
// corner strip (instead of leaving it full-size) lets the user actually
// watch the automation happen on the page underneath. Only touches window
// size/position + a body class; the agent loop itself keeps running
// unaffected since resizing a window doesn't reload its page.
let _autopilotMiniActive = false;
let _autopilotOriginalBounds = null;

async function enterAutopilotMiniMode() {
  if (_autopilotMiniActive) return;
  try {
    const win = await chrome.windows.getCurrent();
    _autopilotOriginalBounds = { width: win.width, height: win.height, left: win.left, top: win.top };
    const miniW = 320, miniH = 66;
    const availW = window.screen.availWidth || 1280;
    const availH = window.screen.availHeight || 800;
    await chrome.windows.update(win.id, {
      width: miniW,
      height: miniH,
      left: Math.max(0, availW - miniW - 24),
      top: Math.max(0, availH - miniH - 24)
    });
  } catch (_e) { /* if resizing fails, just keep the full window — not fatal */ }
  document.body.classList.add('autopilot-mini');
  _autopilotMiniActive = true;
}

async function exitAutopilotMiniMode() {
  if (!_autopilotMiniActive) return;
  document.body.classList.remove('autopilot-mini');
  _autopilotMiniActive = false;
  try {
    const win = await chrome.windows.getCurrent();
    if (_autopilotOriginalBounds) {
      await chrome.windows.update(win.id, _autopilotOriginalBounds);
    }
  } catch (_e) { /* not fatal */ }
}

function updateAutopilotMiniStatus(text) {
  const el = document.getElementById('autopilotMiniText');
  if (el && text) el.textContent = text;
}

function setupAutopilotMiniBar() {
  const stopBtn = document.getElementById('autopilotMiniStop');
  const expandBtn = document.getElementById('autopilotMiniExpand');
  const bar = document.getElementById('autopilotMiniBar');
  if (stopBtn) {
    stopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      agentStopRequested = true;
      stopBtn.disabled = true;
      updateAutopilotMiniStatus('Stopping…');
    });
  }
  if (expandBtn) {
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exitAutopilotMiniMode();
    });
  }
  if (bar) {
    bar.addEventListener('click', () => exitAutopilotMiniMode());
  }
}
setupAutopilotMiniBar();

// Autopilot step log container — one shared block per task run,
// so all steps appear as a clean compact list instead of a wall of agent faces.
let _agentLogContainer = null;
let _agentStepCount = 0;

function resetAgentStepLog() {
  _agentLogContainer = null;
  _agentStepCount = 0;
}

function addAgentStepBubble(thread, text, kind) {
  // done / error messages are standalone full-width bubbles
  if (kind === 'done' || kind === 'error') {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble ai agent-step';
    const icon = kind === 'done' ? '✅' : '⚠️';
    bubble.style.cssText = 'background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.22);font-size:12.5px;color:rgba(255,255,255,0.85);padding:9px 13px;border-radius:10px;margin-bottom:3px;';
    bubble.innerHTML = `<span style="margin-right:6px;">${icon}</span>${text}`;
    updateAutopilotMiniStatus(text);
    thread.appendChild(bubble);
    thread.scrollTop = thread.scrollHeight;
    return bubble;
  }

  // Normal steps: append as a compact row inside ONE shared log block
  if (!_agentLogContainer || !_agentLogContainer.isConnected) {
    _agentLogContainer = document.createElement('div');
    _agentLogContainer.style.cssText = 'background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.18);border-radius:10px;padding:8px 12px;font-size:12px;color:rgba(255,255,255,0.75);margin-bottom:3px;display:flex;flex-direction:column;gap:3px;';
    thread.appendChild(_agentLogContainer);
  }

  _agentStepCount++;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:baseline;gap:6px;line-height:1.4;';
  row.innerHTML = `<span style="color:rgba(56,189,248,0.5);font-size:10px;flex-shrink:0;">${_agentStepCount}.</span><span>${text}</span>`;
  _agentLogContainer.appendChild(row);
  updateAutopilotMiniStatus(text);
  thread.scrollTop = thread.scrollHeight;
  return row;
}

async function getActiveTabPageText(tabId) {
  // Build a richer context snapshot than just innerText:
  // includes URL, title, all form field values, select values, and
  // visible body text — giving Gemini far better signal about page state.
  const richSnapshotScript = async () => {
    try {
      const [frame] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          try {
            const lines = [];
            lines.push('[URL: ' + location.href + ']');
            lines.push('[Title: ' + document.title + ']');

            // Form fields — the agent needs to know current values, not just labels
            document.querySelectorAll('input, textarea').forEach(el => {
              if (el.type === 'hidden') return;
              const lbl = el.getAttribute('aria-label') || el.getAttribute('placeholder') ||
                          el.getAttribute('name') || el.id || el.type || '';
              const val = el.value || '';
              if (lbl || val) lines.push('[Field "' + lbl + '": "' + val + '"]');
            });

            // Select dropdowns — show what is currently selected
            document.querySelectorAll('select').forEach(el => {
              const lbl = el.getAttribute('aria-label') || el.getAttribute('name') || el.id || '';
              const sel = el.options[el.selectedIndex];
              const selText = sel ? sel.text : '';
              const opts = Array.from(el.options).map(o => o.text).slice(0, 8).join(' | ');
              lines.push('[Dropdown "' + lbl + '" selected: "' + selText + '" options: ' + opts + ']');
            });

            // Main visible text (capped so we don't flood the model)
            const bodyText = (document.body.innerText || '').replace(/\s{3,}/g, '\n').trim();
            lines.push(bodyText.slice(0, 5000));
            return lines.join('\n');
          } catch (e) {
            return document.body ? document.body.innerText.slice(0, 6000) : '';
          }
        }
      });
      return frame?.result || '';
    } catch (_) { return null; }
  };

  // Try rich snapshot first (works on any page once scripting permission is granted)
  let rich = await richSnapshotScript();
  if (rich) return rich.slice(0, 6500);

  // Fallback: ask the already-injected content script
  const ask = () => chrome.tabs.sendMessage(tabId, { action: 'get_page_text' });
  try {
    const res = await ask();
    if (res && res.text) return res.text.slice(0, 6000);
  } catch (_) {}

  // Last resort: inject content.js and retry
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
    const res = await ask();
    if (res && res.text) return res.text.slice(0, 6000);
  } catch (_) {}

  return '';
}

// Smart wait after an agent action — replaces the blind 700ms sleep.
// Detects whether the action triggered a page navigation and waits for
// the tab to finish loading (up to 15s) instead of guessing with a fixed delay.
// For pure DOM changes (hover, scroll, select) just waits a short settle time.
function smartWaitAfterAction(tabId, actionName) {
  // waitForElement and navigate manage their own timing — skip extra wait
  if (actionName === 'waitForElement' || actionName === 'navigate') {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    const SETTLE_MS  = 450;  // for non-navigation actions
    const NAV_MAX_MS = 15000; // max wait when a navigation fires

    let resolved = false;
    let navListener = null;
    let settleTimer = null;

    const done = () => {
      if (resolved) return;
      resolved = true;
      if (navListener) chrome.tabs.onUpdated.removeListener(navListener);
      clearTimeout(settleTimer);
      resolve();
    };

    // Watch for navigation that starts within the first 400ms of this action
    const navDeadline = Date.now() + 400;
    let navDetected = false;

    navListener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === 'loading' && Date.now() < navDeadline) {
        navDetected = true;
        clearTimeout(settleTimer); // cancel the short settle timer
      }
      if (changeInfo.status === 'complete' && navDetected) {
        // Page finished loading — small extra settle for JS frameworks to render
        setTimeout(done, 300);
      }
    };

    chrome.tabs.onUpdated.addListener(navListener);

    // Safety net: if no nav detected, resolve after SETTLE_MS;
    // if nav detected but never completes, resolve after NAV_MAX_MS.
    settleTimer = setTimeout(() => {
      if (!navDetected) {
        done();
      } else {
        // Navigation was detected but never completed — give up after NAV_MAX_MS
        setTimeout(done, NAV_MAX_MS - SETTLE_MS);
      }
    }, SETTLE_MS);
  });
}

async function captureActiveTabScreenshot(tab) {
  try {
    if (!tab || !tab.windowId) return null;
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 55 });
    return dataUrl || null;
  } catch (_e) {
    return null;
  }
}

// Builds the array actually sent to Gemini for this turn: takes the
// permanent text-only `contents` history and appends a FRESH screenshot to
// the last turn, without mutating/growing `contents` itself. If we stored
// screenshots permanently, every step would re-send every prior screenshot
// (payload grows step after step and can hang the tab) — instead only the
// single most-current image is ever in flight, keeping steps fast.
async function buildRequestContentsWithScreenshot(baseContents, tab) {
  const screenshot = await captureActiveTabScreenshot(tab);
  if (!screenshot) return baseContents;
  const cloned = baseContents.map(c => ({ ...c, parts: c.parts.slice() }));
  const last = cloned[cloned.length - 1];
  last.parts.push({ inlineData: { mimeType: 'image/jpeg', data: screenshot.split(',')[1] } });
  last.parts.push({ text: '(Screenshot of the current page attached above for visual reference.)' });
  return cloned;
}

async function runAgentTask(prompt, thread) {
  const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
  const apiKey = keyResult.geminiApiKey;
  if (!apiKey) { showGeminiModal(); return; }

  agentStopRequested = false;
  resetAgentStepLog();
  const stopBtn = document.createElement('button');
  stopBtn.textContent = '■ Stop Autopilot';
  stopBtn.className = 'agent-stop-btn';
  stopBtn.style.cssText = 'display:block;margin:8px auto;padding:6px 14px;font-size:12px;border-radius:20px;background:rgba(255,80,80,0.12);border:1px solid rgba(255,80,80,0.3);color:#ff8080;cursor:pointer;';
  stopBtn.addEventListener('click', () => { agentStopRequested = true; stopBtn.disabled = true; stopBtn.textContent = 'Stopping…'; });
  thread.appendChild(stopBtn);
  // Shrink into a corner strip so the page Autopilot is controlling isn't
  // hidden behind the chat window. Expands back on click, or automatically
  // once the task finishes/stops below.
  enterAutopilotMiniMode();
  thread.scrollTop = thread.scrollHeight;

  let tab;
  try {
    // Autopilot's chat window is its own separate popup window (opened via
    // chrome.windows.create), so `currentWindow` here means the chat window
    // itself, NOT the website the user wants to control. We need the active
    // tab of the user's actual browser window instead.
    const normalWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    const candidates = normalWindows
      .flatMap(w => (w.tabs || []).filter(t => t.active).map(t => ({ ...t, _focused: w.focused })))
      .sort((a, b) => (b._focused ? 1 : 0) - (a._focused ? 1 : 0) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
    tab = candidates[0];
    if (!tab) {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    }
  } catch (_) {}
  if (!tab || !tab.id) {
    stopBtn.remove();
    exitAutopilotMiniMode();
    addAgentStepBubble(thread, "Couldn't find an active browser tab to control.", 'error');
    return;
  }

  // ── Session Anchor ─────────────────────────────────────────────────────────
  // Lock the agent to the tab it started on. Without this the agent follows
  // the user's mouse — if the user switches tabs the next action fires on the
  // wrong page. lockedTabId is only updated when the agent itself calls
  // switchTab or openTab; user focus changes are silently ignored.
  let lockedTabId = tab.id;
  const lockedTabUrl = tab.url || '';

  const onSystemPage = /^(chrome|chrome-extension|edge|about):/.test(tab.url || '');

  const contents = [];
  // A system page (new tab, chrome://extensions, etc.) has no readable
  // content and no content script can be injected into it — but the task
  // may simply START with a "navigate" action (e.g. "go to YouTube"),
  // which works fine from any tab via chrome.tabs.update. So instead of
  // hard-blocking here, just skip the page-text read and tell the model
  // it needs to navigate first before it can click/type/scroll anything.
  let pageText = onSystemPage ? '' : await getActiveTabPageText(tab.id);
  contents.push({
    role: 'user',
    parts: [{
      text: onSystemPage
        ? `TASK: ${prompt}\n\nCURRENT PAGE (${tab.url}):\nThis is a browser system page with no content — you must call the "navigate" action first to go to a real website before doing anything else.`
        : `TASK: ${prompt}\n\nCURRENT PAGE (${tab.url}):\n${pageText || '(no readable text found)'}`
    }]
  });

  let consecutiveFailures = 0;
  const actionFailCounts = {}; // key: "actionName:argText" → count
  let agentPlan = null;        // [{step, done, note}] set by planTask tool
  const recentActions = [];    // loop detection: last 12 "action:arg" strings

  for (let step = 0; step < AGENT_MAX_STEPS; step++) {
    if (agentStopRequested) {
      addAgentStepBubble(thread, 'Stopped by you.', 'error');
      break;
    }

    let data;
    try {
      const requestContents = await buildRequestContentsWithScreenshot(contents, tab);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.chat}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: AGENT_SYSTEM_PROMPT + getDynamicSkill(tab.url) }] },
            contents: requestContents,
            tools: AGENT_TOOLS,
            generationConfig: { temperature: 0.2 }
          })
        }
      );
      data = await res.json();
    } catch (e) {
      addAgentStepBubble(thread, `Connection error: ${e.message}`, 'error');
      break;
    }

    if (data.error) {
      addAgentStepBubble(thread, data.error.message || 'The AI could not respond — check your Gemini key/quota.', 'error');
      break;
    }

    const candidateParts = data.candidates?.[0]?.content?.parts || [];
    // PARALLEL: collect ALL function calls Gemini returned in this turn
    const fnCallParts = candidateParts.filter(p => p.functionCall);

    if (fnCallParts.length === 0) {
      const text = candidateParts.find(p => p.text)?.text || 'No action taken.';
      addAgentStepBubble(thread, text, 'done');
      break;
    }

    // Preserve full model turn (including thoughtSignature for thinking models)
    contents.push({ role: 'model', parts: candidateParts });

    // ── finish ─────────────────────────────────────────────────────────────────
    const finishCall = fnCallParts.find(p => p.functionCall.name === 'finish');
    if (finishCall) {
      addAgentStepBubble(thread, finishCall.functionCall.args?.summary || 'Task finished.', 'done');
      break;
    }

    // ── planTask (client-side, no CDP needed) ──────────────────────────────────
    const planCall = fnCallParts.find(p => p.functionCall.name === 'planTask');
    if (planCall) {
      const { steps = [], summary = '' } = planCall.functionCall.args || {};
      agentPlan = steps.map(s => ({ step: s, done: false, note: '' }));
      const planLines = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
      addAgentStepBubble(thread, `📋 Plan${summary ? ': ' + summary : ''}:\n${planLines}`);
      contents.push({ role: 'user', parts: [{ functionResponse: { name: 'planTask',
        response: { success: true, data: `Plan recorded (${steps.length} steps). Begin executing step 1 now.` } } }] });
      continue;
    }

    // ── checkPlan (client-side) ────────────────────────────────────────────────
    const checkCall = fnCallParts.find(p => p.functionCall.name === 'checkPlan');
    if (checkCall) {
      const { stepIndex = 0, note = '' } = checkCall.functionCall.args || {};
      if (agentPlan?.[stepIndex]) { agentPlan[stepIndex].done = true; agentPlan[stepIndex].note = note; }
      const done = agentPlan?.filter(s => s.done).length ?? 0;
      const total = agentPlan?.length ?? 0;
      const next = agentPlan?.find(s => !s.done);
      addAgentStepBubble(thread, `✅ Step ${stepIndex + 1} done (${done}/${total})${next ? ` — Next: ${next.step}` : ' — All done!'}`);
      contents.push({ role: 'user', parts: [{ functionResponse: { name: 'checkPlan',
        response: { success: true, data: next ? `Next step: ${next.step}` : 'All steps complete — call finish.' } } }] });
      continue;
    }

    // ── Filter to executable CDP/tab tools only ───────────────────────────────
    const executableCalls = fnCallParts.filter(p =>
      !['finish', 'planTask', 'checkPlan'].includes(p.functionCall.name)
    );
    if (executableCalls.length === 0) continue;

    // Show action bubbles
    for (const part of executableCalls) {
      const { name, args } = part.functionCall;
      addAgentStepBubble(thread,
        `${name}${args?.text ? `: "${args.text}"` : args?.url ? `: ${args.url}` : args?.direction ? `: ${args.direction}` : ''}`.trim()
      );
    }

    // ── PARALLEL execution of all CDP calls ───────────────────────────────────
    const settledResults = await Promise.allSettled(
      executableCalls.map(part =>
        chrome.runtime.sendMessage({
          action: 'agentExecute',
          tabId: tab.id,
          executeAction: part.functionCall.name,
          params: part.functionCall.args || {}
        }).catch(e => ({ success: false, error: e.message }))
      )
    );

    // ── Process results + self-healing ────────────────────────────────────────
    let anyFailed = false;
    const responseParts = [];

    for (let ri = 0; ri < executableCalls.length; ri++) {
      const { name, args } = executableCalls[ri].functionCall;
      const settled = settledResults[ri];
      let execResult = settled.status === 'fulfilled'
        ? settled.value
        : { success: false, error: settled.reason?.message || 'Promise rejected' };

      // ── Tab management: update agent's tab reference ──────────────────────
      if (execResult?.success) {
        if (execResult.switchedTabId) {
          try {
            const t = await chrome.tabs.get(execResult.switchedTabId);
            if (t?.id) { tab = t; }
          } catch (_) {}
        } else if (execResult.newTabId && (name === 'navigate' || name === 'openTab')) {
          try {
            const t = await chrome.tabs.get(execResult.newTabId);
            if (t?.id) {
              addAgentStepBubble(thread, `Opened tab: ${t.url || 'loading...'}`);
              if (args?.switchTo || name === 'navigate') tab = t;
            }
          } catch (_) {}
        }
      }

      // ── Self-healing selectors: on "not found", auto-run findElement ──────
      if (!execResult?.success && /not found|not visible|no element|couldn.t find/i.test(execResult?.error || '')) {
        const query = args?.selector || args?.text || args?.description || '';
        if (query) {
          try {
            const heal = await chrome.runtime.sendMessage({
              action: 'agentExecute', tabId: tab.id,
              executeAction: 'findElement', params: { query }
            });
            if (heal?.success && heal?.data) {
              execResult = { ...execResult,
                healSuggestion: `Auto-findElement result: ${heal.data} — try clicking by coordinates or use a more specific description` };
            }
          } catch (_) {}
        }
      }

      // ── Track failures ────────────────────────────────────────────────────
      if (!execResult?.success) {
        anyFailed = true;
        consecutiveFailures++;
        const failKey = `${name}:${String(args?.text || args?.selector || args?.description || '')}`;
        actionFailCounts[failKey] = (actionFailCounts[failKey] || 0) + 1;
        if (_agentLogContainer?.isConnected) {
          const warn = document.createElement('div');
          warn.style.cssText = 'font-size:11px;color:rgba(255,180,50,0.75);padding-left:16px;';
          warn.textContent = `⚠ ${execResult?.error || 'failed'} — trying differently…`;
          _agentLogContainer.appendChild(warn);
          thread.scrollTop = thread.scrollHeight;
        }
      }

      responseParts.push({
        functionResponse: {
          name,
          response: execResult?.success
            ? { success: true, ...(execResult.data != null ? { data: String(execResult.data) } : {}), pageNow: '' }
            : { success: false,
                error: execResult?.error || 'unknown error',
                ...(execResult?.healSuggestion ? { healSuggestion: execResult.healSuggestion } : {}),
                ...(Object.keys(actionFailCounts).length
                  ? { alreadyFailed: Object.entries(actionFailCounts)
                        .filter(([, c]) => c > 1).map(([k, c]) => `${k} (×${c})`).join(', ') || undefined }
                  : {}),
                pageNow: '' }
        }
      });
    }

    if (!anyFailed) consecutiveFailures = 0;

    // Hard stop: 5 consecutive failures = genuinely stuck
    // (raised from 3 — gives agent more room to try alternative approaches)
    if (consecutiveFailures >= 5) {
      addAgentStepBubble(thread,
        `Stuck after ${consecutiveFailures} failed steps in a row. Try using highlightElement to confirm the target, coordinate-based click, or a different selector strategy.`,
        'error');
      break;
    }

    // Wait for navigation / DOM settle, then enforce the Session Anchor
    await smartWaitAfterAction(tab.id, executableCalls[0]?.functionCall?.name);

    try {
      const actionName = executableCalls[0]?.functionCall?.name || '';
      const agentSwitchedTab = (actionName === 'switchTab' || actionName === 'openTab');

      if (agentSwitchedTab) {
        // Agent intentionally navigated to a new tab — follow it and update the lock
        const followWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
        const followCandidates = followWindows
          .flatMap(w => (w.tabs || []).filter(t => t.active).map(t => ({ ...t, _focused: w.focused })))
          .sort((a, b) => (b._focused ? 1 : 0) - (a._focused ? 1 : 0) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
        const freshTab = followCandidates[0];
        if (freshTab?.id && !/^(chrome|chrome-extension|edge|about):/.test(freshTab.url || '')) {
          if (freshTab.id !== tab.id) addAgentStepBubble(thread, `Switched to new tab: ${freshTab.title || freshTab.url}`);
          tab = freshTab;
          lockedTabId = freshTab.id; // update the anchor to the new tab
        }
      } else {
        // User may have changed focus — silently restore to the locked task tab
        const lockedTabInfo = await chrome.tabs.get(lockedTabId).catch(() => null);
        if (lockedTabInfo) {
          if (lockedTabInfo.id !== tab.id) {
            addAgentStepBubble(thread, `↩ Staying on task tab: ${lockedTabInfo.title || lockedTabUrl}`);
          }
          tab = lockedTabInfo;
        }
      }
    } catch (_) {}

    pageText = await getActiveTabPageText(tab.id);

    // Inject fresh page text into all response parts
    for (const rp of responseParts) {
      rp.functionResponse.response.pageNow = pageText.slice(0,
        rp.functionResponse.response.success ? 4000 : 2000);
    }

    // ── Loop detection ────────────────────────────────────────────────────────
    // Track recent actions and warn Gemini when it's clearly repeating itself
    for (const part of executableCalls) {
      const { name, args } = part.functionCall;
      const sig = `${name}:${String(args?.text || args?.selector || args?.url || args?.description || args?.direction || '').slice(0, 60)}`;
      recentActions.push(sig);
      if (recentActions.length > 12) recentActions.shift();
    }
    // Count how many of the last 12 actions are the same as the most recent one
    const lastSig = recentActions[recentActions.length - 1];
    const repeatCount = recentActions.filter(s => s === lastSig).length;
    if (repeatCount >= 3) {
      // Inject a strong anti-loop warning into the last response part
      const last = responseParts[responseParts.length - 1];
      if (last?.functionResponse?.response) {
        last.functionResponse.response.LOOP_WARNING =
          `⚠ You have called "${lastSig}" ${repeatCount} times without progress. STOP doing this. ` +
          `Try a completely different approach: use snapshotPage to see what is actually on screen, ` +
          `try coordinate-based click, navigate to a different URL, or call finish to report what is blocking you.`;
      }
    }

    contents.push({ role: 'user', parts: responseParts });

    if (step === AGENT_MAX_STEPS - 1) {
      addAgentStepBubble(thread, `Stopped after ${AGENT_MAX_STEPS} steps. Tell me to continue if not done.`, 'error');
    }
  }

  stopBtn.remove();
  exitAutopilotMiniMode();
  scheduleChatHistorySave();
}

// Send message to Gemini API (supports multiple images)
async function sendToGemini(prompt, imageDataUrls) {
  const images = Array.isArray(imageDataUrls) ? imageDataUrls : [imageDataUrls];
  
  const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
  const apiKey = keyResult.geminiApiKey;
  
  if (!apiKey) {
    throw new Error('Please set your Gemini API key in Settings');
  }
  
  // Build conversation
  const contents = [];
  
  for (const msg of conversationHistory) {
    const msgParts = [{ text: msg.text }];
    // Do NOT re-send inlineData from history turns — it multiplies memory usage
    // per request by (N_turns × N_images × image_size). Gemini already processed
    // those images in prior turns and carries the context in its response tokens.
    // Images are only sent once, in the current user turn below.
    contents.push({ role: msg.role, parts: msgParts });
  }
  
  const userParts = [];
  if (images.length > 0 && images[0]) {
    // Hard cap: send at most 4 images per request.
    // Sending 10 large screenshots as inlineData in one call routinely exceeds
    // the extension tab's memory budget (~512 MB) and causes a silent hang/drop.
    // Gemini Vision performs well on 1-4 images; the user can always reselect.
    const MAX_IMAGES_PER_REQUEST = 4;
    const imagesToSend = images.slice(0, MAX_IMAGES_PER_REQUEST);
    if (images.length > MAX_IMAGES_PER_REQUEST) {
      console.warn(`[SnapToAI] Capped images from ${images.length} → ${MAX_IMAGES_PER_REQUEST} to prevent memory hang`);
    }
    for (const imageDataUrl of imagesToSend) {
      const base64Data = imageDataUrl.split(',')[1];
      const mimeType = imageDataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      userParts.push({ inlineData: { mimeType, data: base64Data } });
    }
  }
  // Inject URL as context hint when URL mode is active
  if (urlContextEnabled && currentPageUrl) {
    userParts.unshift({ text: `Analyze the following webpage: ${currentPageUrl}\n\n` });
  }
  userParts.push({ text: prompt });

  // If user staged an image/video for Build Mode, inject it as a media part
  if (buildModeEnabled && _stagedBuildMedia) {
    const m = _stagedBuildMedia;
    if (m.type === 'image') {
      // Gemini can see the image — inject as inlineData + instruction text
      userParts.push({ inlineData: { mimeType: m.mimeType, data: m.data } });
      userParts.push({ text: `\n\n[USER MEDIA] The user has attached their own generated image above. You MUST embed it prominently in the page using: <img src="data:${m.mimeType};base64,${m.data}" style="..."> — place it as the hero image or in a dedicated section. Do not use any other image for this spot.` });
    }
    clearStagedMedia(); // consume after one build
  }

  contents.push({ role: 'user', parts: userParts });
  
  // Active specialist agent overrides all other prompts (except Build Mode)
  const _basePrompt = buildModeEnabled
    ? BUILD_SYSTEM_PROMPT
    : activeSpecialistAgent
    ? activeSpecialistAgent.prompt
    : researchMode
    ? `You are an expert Research Agent. Follow these rules strictly:\n1. Use Google Search to find real-time facts before answering.\n2. If a URL is provided, read and synthesize its content.\n3. Cite every source inline with [1], [2], etc. and list them at the end.\n4. Structure your response with: **Summary**, **Key Findings**, **Sources**.\n5. Be thorough, factual, and never guess — if unsure, say so and search again.`
    : images.length > 1 ? MULTI_IMAGE_PROMPT : SYSTEM_PROMPT;
  const systemPrompt = _basePrompt;
  
  // Wait for rate limit before making request
  await waitForRateLimit();

  // Build tools array based on active toggles
  const _tools1 = [];
  if (searchGroundingEnabled) _tools1.push({ googleSearch: {} });
  if (codeExecutionEnabled) _tools1.push({ codeExecution: {} });

  const selectedModel = await getSelectedModel();
  const _body1 = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: contents,
    generationConfig: {
      maxOutputTokens: buildModeEnabled ? 32768 : getConfig('MAX_OUTPUT_TOKENS', 2048),
      temperature: buildModeEnabled ? 0.75 : getConfig('TEMPERATURE', 0.7),
      topP: 0.95,
      topK: 40
    }
  };
  if (_tools1.length > 0) _body1.tools = _tools1;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_body1)
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

// Voice input — lets the user speak their prompt instead of typing it.
// Especially useful for Autopilot: "click the sign up button" etc.
function initVoiceInput() {
  const micBtn = document.getElementById('micBtn');
  const chatInputEl = document.getElementById('chatInput');
  if (!micBtn || !chatInputEl) return;

  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) {
    // Not supported in this context (e.g. some embedded extension pages) —
    // hide the button instead of leaving a dead control.
    micBtn.style.display = 'none';
    return;
  }

  let recognition = null;
  let listening = false;
  let baseText = '';
  let finalTranscript = '';

  function stopListening() {
    listening = false;
    micBtn.classList.remove('listening');
    micBtn.title = 'Speak instead of typing';
    if (recognition) {
      try { recognition.stop(); } catch (e) { /* already stopped */ }
    }
  }

  function startListening() {
    baseText = chatInputEl.value ? chatInputEl.value.trim() + ' ' : '';
    finalTranscript = '';

    recognition = new SpeechRecognitionCtor();
    recognition.lang = (navigator.language || 'en-US');
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interim += transcript;
        }
      }
      chatInputEl.value = (baseText + finalTranscript + interim).trim();
      autoResize(chatInputEl);
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      console.log('[SnapToAI] Voice input error:', event.error);
      stopListening();
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        addBubble('Microphone access was blocked. Allow microphone permission for this extension to use voice input.', 'error');
      }
    };

    recognition.onend = () => {
      // Chrome sometimes ends recognition on its own after a pause even
      // while the user is still "listening" — restart seamlessly unless
      // the user explicitly stopped it.
      if (listening) {
        try { recognition.start(); } catch (e) { /* ignore double-start */ }
      }
    };

    try {
      recognition.start();
      listening = true;
      micBtn.classList.add('listening');
      micBtn.title = 'Click to stop listening';
    } catch (e) {
      console.log('[SnapToAI] Voice input failed to start:', e.message);
    }
  }

  micBtn.addEventListener('click', () => {
    if (listening) {
      stopListening();
      chatInputEl.focus();
    } else {
      startListening();
    }
  });
}

// ── Auto-generate AI images for fresh Build Mode sites ────────────────────────
// Silently derives 3 cinematic image prompts from the build request, generates
// them via Gemini image models, and returns an array of base64 data-URLs.
// Returns [] on any failure so the build always falls back to Pexels gracefully.
// Step 1: Ask the AI how many images this specific concept actually needs.
// Returns a number between 1 and 15.
async function _determineBuildImageCount(buildPrompt, apiKey) {
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.chat}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text:
            `You are a web designer planning a website build.\n` +
            `Concept: "${buildPrompt}"\n\n` +
            `How many distinct photos/images does a high-quality website for this concept realistically need?\n` +
            `Think about: hero image, feature section images, gallery/portfolio items, team photos, product shots, testimonial backgrounds, CTA images, footer background, etc.\n` +
            `Count only PHOTOS/IMAGES — not icons, not logos, not illustrations.\n` +
            `Output ONLY a single integer between 1 and 15. Nothing else.`
          }] }],
          generationConfig: { maxOutputTokens: 5, temperature: 0.2 }
        }),
        signal: AbortSignal.timeout(8000)
      }
    );
    if (!r.ok) return 4;
    const data = await r.json();
    const num = parseInt((data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim(), 10);
    if (isNaN(num)) return 4;
    return Math.max(1, Math.min(15, num)); // clamp 1–15
  } catch (e) {
    return 4; // safe fallback
  }
}

// Step 2: Given the concept and the exact count needed, write one image prompt per slot.
// Each prompt is specific to WHERE in the site that image will appear.
async function _deriveBuildImagePrompts(buildPrompt, count, apiKey) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.chat}:generateContent?key=${apiKey}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text:
          `You are a creative director preparing visuals for a new website.\n` +
          `Site concept: "${buildPrompt}"\n\n` +
          `This site needs exactly ${count} images. Write one AI image generation prompt per image.\n` +
          `For each image, think about WHERE it will appear on the site and what it needs to show.\n` +
          `Consider: hero/banner shots, product or service shots, lifestyle scenes, team or people shots, ` +
          `gallery items, detail/texture shots, testimonial backgrounds, CTA closing shots.\n\n` +
          `Rules:\n` +
          `- Every prompt must be cinematic, magazine-quality, photo-realistic\n` +
          `- Each image must be DIFFERENT from the others (different subject, angle, mood)\n` +
          `- Be highly specific: include lighting, mood, color palette, composition\n` +
          `- Do NOT include any text, logos, or UI elements in the images\n` +
          `- Tailor every image to the exact concept — no generic stock photo vibes\n\n` +
          `Output ONLY ${count} lines. One complete image prompt per line. No numbering, no labels, no extra text.`
        }] }],
        generationConfig: { maxOutputTokens: Math.max(400, count * 80), temperature: 0.85 }
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) return [];
    const data = await r.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return text.split('\n').map(l => l.trim()).filter(Boolean).slice(0, count);
  } catch (e) {
    console.warn('[SnapToAI Build] prompt-derive failed:', e.message);
    return [];
  }
}

async function _generateOneBuildImage(imgPrompt, apiKey) {
  for (const modelName of MODELS.imageChain) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: imgPrompt }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
        }),
        signal: AbortSignal.timeout(35000)
      });
      if (!r.ok) { console.warn('[SnapToAI Build] image model', modelName, 'returned', r.status); break; }
      const data = await r.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
      if (imgPart) return `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`;
    } catch (e) {
      console.warn('[SnapToAI Build] image gen error on', modelName, ':', e.message);
    }
  }
  return null;
}

async function _autoGenerateBuildImages(buildPrompt, statusBubble) {
  try {
    const stored = await chrome.storage.local.get(['geminiKey']);
    const apiKey = stored.geminiKey;
    if (!apiKey) return [];

    // Step 1: ask the AI how many images THIS site actually needs
    if (statusBubble) statusBubble.innerHTML =
      `<div style="display:flex;align-items:center;gap:10px;color:rgba(255,255,255,0.7);font-size:13px;">` +
      `<span style="font-size:18px;">🎨</span>Figuring out how many images your site needs…</div>`;

    const count = await _determineBuildImageCount(buildPrompt, apiKey);

    if (statusBubble) statusBubble.innerHTML =
      `<div style="display:flex;align-items:center;gap:10px;color:rgba(255,255,255,0.7);font-size:13px;">` +
      `<span style="font-size:18px;">🎨</span>Creating ${count} custom AI images for your site…</div>`;

    // Step 2: derive one specific prompt per image slot
    const prompts = await _deriveBuildImagePrompts(buildPrompt, count, apiKey);
    if (!prompts.length) return [];

    // Step 3: generate all images in parallel
    const results = await Promise.all(prompts.map(p => _generateOneBuildImage(p, apiKey)));
    const images = results.filter(Boolean);

    if (statusBubble) {
      if (images.length > 0) {
        statusBubble.innerHTML =
          `<div style="display:flex;align-items:center;gap:10px;color:rgba(99,202,183,0.9);font-size:13px;">` +
          `<span style="font-size:18px;">✅</span>${images.length} custom AI images ready — building your site…</div>`;
      } else {
        statusBubble.innerHTML = ''; // silent fallback — Pexels images will be used
      }
    }
    return images;
  } catch (e) {
    console.warn('[SnapToAI Build] Auto-image generation failed:', e.message);
    return [];
  }
}
// ── End auto-image generation ─────────────────────────────────────────────────

// ── Web design inspiration search ─────────────────────────────────────────────
// Uses Gemini's built-in Google Search grounding tool to find real, modern
// examples of whatever type of site/app the user wants to build, then returns
// a concise design brief (colors, layout, typography, key sections) the builder
// can use as a reference. Returns '' on any failure — build proceeds normally.
async function _searchWebForDesignInspiration(buildPrompt, apiKey) {
  try {
    // Derive a clean search topic from the prompt
    const topicRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text:
            `From this website build request: "${buildPrompt}"\n` +
            `Extract a SHORT 2-5 word search phrase to find the best real websites of this type (e.g. "yoga studio website 2025", "crypto dashboard app", "food delivery landing page"). ` +
            `Output ONLY the phrase, nothing else.`
          }] }],
          generationConfig: { maxOutputTokens: 30, temperature: 0.3 }
        }),
        signal: AbortSignal.timeout(8000)
      }
    );
    if (!topicRes.ok) return '';
    const topicData = await topicRes.json();
    const searchTopic = (topicData.candidates?.[0]?.content?.parts?.[0]?.text || '').trim().replace(/["""]/g, '');
    if (!searchTopic) return '';

    // Now use Gemini with Google Search grounding to find real examples
    const searchRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tools: [{ google_search: {} }],
          contents: [{ role: 'user', parts: [{ text:
            `Search the web for: "${searchTopic}"\n\n` +
            `Find the 3-5 most impressive, modern, well-designed websites of this type that exist TODAY. ` +
            `For each one, note: exact color palette (hex values if possible), hero layout style, typography choices, key sections included, and what makes it visually stand out.\n\n` +
            `Then produce a DESIGN BRIEF (under 300 words) titled "WEB INSPIRATION BRIEF" with:\n` +
            `• DOMINANT COLORS: list 3-5 specific hex values observed across the best sites\n` +
            `• TYPOGRAPHY: font styles and weights that work for this category\n` +
            `• HERO SECTION: describe the most effective hero layout pattern found\n` +
            `• KEY SECTIONS: list the 5-7 sections every great site in this category has\n` +
            `• DESIGN SIGNATURE: 2-3 specific visual moves (e.g. full-bleed imagery, floating cards, bold stats) that make leaders in this space look premium\n` +
            `• MOOD WORD: one word (e.g. energetic, serene, clinical, bold)\n\n` +
            `Be specific and actionable — this brief will be used by a UI engineer to build the site.`
          }] }],
          generationConfig: { maxOutputTokens: 600, temperature: 0.4 }
        }),
        signal: AbortSignal.timeout(20000)
      }
    );
    if (!searchRes.ok) return '';
    const searchData = await searchRes.json();
    const brief = (searchData.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    return brief ? `\n\n${brief}` : '';
  } catch (e) {
    console.warn('[SnapToAI Build] Web inspiration search failed:', e.message);
    return '';
  }
}
// ── End web inspiration search ────────────────────────────────────────────────

// ── Build Design AI Agent (Gemini 2.5 Pro) ────────────────────────────────────
// Fires on EVERY fresh build — games AND websites.
// Uses Gemini 2.5 Pro to think through and author a complete creative spec:
// concept, visual palette, layout/level structure, interactions, mood.
// The builder follows this spec exactly. Fails silently.
async function _designBuildWithAI(buildPrompt, apiKey, isGame) {
  try {
    const systemText = isGame
      ? `You are a lead game designer at a world-class studio (Nintendo, Valve, Naughty Dog level). ` +
        `Read the game request and produce a vivid, specific, original game design document. ` +
        `Be creative and concrete — no generic phrases. Every detail specific enough to build without questions. ` +
        `Output ONLY the design document. No preamble.`
      : `You are a world-class creative director and UX architect (Apple, Stripe, Linear level). ` +
        `Read the website/app request and produce a vivid, specific creative brief. ` +
        `Be concrete — exact colors, fonts, layout decisions, copy tone, interaction details. ` +
        `Output ONLY the creative brief. No preamble.`;

    const userText = isGame
      ? `Game request: "${buildPrompt}"\n\n` +
        `Write a complete game design document:\n\n` +
        `CONCEPT: [One punchy sentence — the unique hook]\n\n` +
        `WORLD & THEME: [Specific setting, mood, exact colors, time of day]\n\n` +
        `PLAYER CHARACTER: [Name, exact pixel art colors per body part, one special ability]\n\n` +
        `LEVEL 1 — [Invent a name]: [Theme, layout feel, visual signature, main challenge]\n` +
        `LEVEL 2 — [Invent a name]: [What changes — new hazard, faster pace, new visual]\n` +
        `LEVEL 3 — [Invent a name]: [Climax — hardest, most visually striking, epic payoff]\n\n` +
        `ENEMY A — [Name]: [Exact behavior, how defeated, exact pixel art colors]\n` +
        `ENEMY B — [Name]: [Different behavior, different weakness, different look]\n\n` +
        `VISUAL PALETTE:\n  Sky: [hex]\n  Ground: [hex + texture feel]\n  Platforms: [hex]\n  Player: [colors per part]\n  Enemies: [colors]\n\n` +
        `MUSIC: [BPM range, feel, instrument style]\n\n` +
        `PHYSICS FEEL: [How movement feels — floaty? snappy? heavy?]\n\n` +
        `SPECIAL MECHANIC: [One mechanic that makes this game unique]`
      : `Website/app request: "${buildPrompt}"\n\n` +
        `Write a complete creative brief:\n\n` +
        `CONCEPT: [What this product IS and who it's for — one sentence]\n\n` +
        `VISUAL IDENTITY:\n  Primary color: [exact hex]\n  Accent color: [exact hex]\n  Background: [exact hex]\n  Text color: [exact hex]\n  Font style: [e.g. geometric sans, editorial serif]\n\n` +
        `LAYOUT:\n  Hero: [what the hero section shows — headline tone, layout type]\n  Section 2: [what it covers]\n  Section 3: [what it covers]\n  CTA: [what action and copy tone]\n\n` +
        `TONE & COPY: [How the writing sounds — bold? warm? minimal? technical?]\n\n` +
        `KEY INTERACTION: [One standout interaction or animation that elevates the page]\n\n` +
        `INSPIRATION: [3 words that capture the feel — e.g. "dark, editorial, cinematic"]`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemText }] },
          contents: [{ role: 'user', parts: [{ text: userText }] }],
          generationConfig: { maxOutputTokens: 1200, temperature: 1.0 }
        }),
        signal: AbortSignal.timeout(22000)
      }
    );
    if (!res.ok) return '';
    const data = await res.json();
    return (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  } catch (e) {
    console.warn('[SnapToAI] Design agent failed:', e.message);
    return '';
  }
}

// ── Build Music Agent (Lyria) ─────────────────────────────────────────────────
// Fires on EVERY fresh build alongside the other agents.
// Asks Gemini to write a Lyria prompt matching the build, then generates a WAV
// clip and returns it as a base64 data URL for embedding in _pendingBuildAudio.
// Fails silently — build always continues without music.
async function _generateBuildMusic(buildPrompt, apiKey) {
  try {
    // Step 1: Gemini writes a concise Lyria music prompt tuned to this build
    const pRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text:
            `Write a concise Lyria music generation prompt (max 25 words) for background music that perfectly matches the mood and purpose of this app/game build: "${buildPrompt}". ` +
            `Output ONLY the music prompt. Examples of good prompts: "upbeat chiptune adventure 120BPM major key bouncy", "dark cinematic ambient tension low drones", "warm jazz lounge bossa nova 90BPM relaxed".`
          }] }],
          generationConfig: { maxOutputTokens: 60 }
        }),
        signal: AbortSignal.timeout(8000)
      }
    );
    const musicPrompt = pRes.ok
      ? ((await pRes.json()).candidates?.[0]?.content?.parts?.[0]?.text || '').trim()
      : buildPrompt;

    // Step 2: Generate the music clip with Lyria
    for (const model of ['lyria-3', 'lyria-3-clip-preview']) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: musicPrompt }] }],
            generationConfig: { responseModalities: ['AUDIO'] }
          }),
          signal: AbortSignal.timeout(55000)
        }
      );
      if (!r.ok) continue;
      const body = await r.json();
      for (const ap of (body.candidates?.[0]?.content?.parts || [])) {
        if (!ap.inlineData?.data) continue;
        const b64 = ap.inlineData.data;
        const mime = (ap.inlineData.mimeType || '').toLowerCase();
        // Convert PCM → WAV → base64 data URL (pcmToWav is scoped elsewhere)
        const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        if (!mime || mime.includes('pcm') || mime.startsWith('audio/l')) {
          const sr = 24000, ch = 1, bps = 16;
          const hdr = new ArrayBuffer(44); const dv = new DataView(hdr);
          const ws = (o, v) => { for (let i = 0; i < v.length; i++) dv.setUint8(o + i, v.charCodeAt(i)); };
          ws(0,'RIFF'); dv.setUint32(4, 36 + raw.byteLength, true);
          ws(8,'WAVE'); ws(12,'fmt ');
          dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,ch,true);
          dv.setUint32(24,sr,true); dv.setUint32(28,sr*ch*bps/8,true);
          dv.setUint16(32,ch*bps/8,true); dv.setUint16(34,bps,true);
          ws(36,'data'); dv.setUint32(40,raw.byteLength,true);
          const hdrArr = new Uint8Array(hdr);
          const wav = new Uint8Array(44 + raw.byteLength);
          wav.set(hdrArr, 0); wav.set(raw, 44);
          return `data:audio/wav;base64,${btoa(String.fromCharCode(...wav))}`;
        }
        return `data:${mime};base64,${b64}`;
      }
    }
    return null;
  } catch (e) {
    console.warn('[SnapToAI] Build music agent failed:', e.message);
    return null;
  }
}

// ── Game mechanics reference search ───────────────────────────────────────────
// When the user asks to build a game, this runs BEFORE the build to look up
// real game dev references: physics constants, enemy AI patterns, level design,
// control feel — whatever is specific to that game type.
// Returns a concise "GAME MECHANICS BRIEF" injected into the prompt.
// Fails silently — build always continues even if this step errors.
async function _searchForGameMechanics(buildPrompt, apiKey) {
  try {
    // Step 1: identify the game genre / type
    const genreRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text:
            `From this game build request: "${buildPrompt}"\n` +
            `Output a SHORT 3-6 word search phrase to find real game dev documentation, ` +
            `physics analysis, or disassembly notes for this genre. ` +
            `Examples: "platformer game physics constants feel", "top-down shooter enemy AI patterns", ` +
            `"puzzle game level design principles", "mario bros physics disassembly analysis", ` +
            `"breakout clone ball physics collision". Output ONLY the phrase, nothing else.`
          }] }],
          generationConfig: { maxOutputTokens: 30, temperature: 0.3 }
        }),
        signal: AbortSignal.timeout(8000)
      }
    );
    if (!genreRes.ok) return '';
    const genreData = await genreRes.json();
    const searchPhrase = (genreData.candidates?.[0]?.content?.parts?.[0]?.text || '').trim().replace(/["""]/g, '');
    if (!searchPhrase) return '';

    // Step 2: search the web for real game mechanics references
    const mechRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tools: [{ google_search: {} }],
          contents: [{ role: 'user', parts: [{ text:
            `Search the web for: "${searchPhrase}"\n\n` +
            `You are helping a developer build a canvas game in JavaScript. ` +
            `Find the best real game development references, physics analyses, disassembly notes, ` +
            `or game-feel articles for this game type. ` +
            `Focus on: exact numeric constants (gravity, jump velocity, speeds, friction), ` +
            `enemy AI behaviour patterns, collision detection approaches, level design principles, ` +
            `and the specific techniques that make this genre FEEL satisfying to play.\n\n` +
            `Produce a GAME MECHANICS BRIEF (under 400 words) with these exact sections:\n` +
            `• PHYSICS CONSTANTS: specific numeric values for gravity, jump force, speed, friction found in references\n` +
            `• PLAYER FEEL: the 2-3 most important techniques for making movement feel good in this genre\n` +
            `• ENEMY AI: how enemies move, attack, and react in the best examples of this game type\n` +
            `• LEVEL DESIGN: what makes levels in this genre fun — progression, challenge, layout patterns\n` +
            `• GENRE SIGNATURE: 2-3 mechanics that are essential to this genre (e.g. stomp-kill, bullet-time, combos)\n` +
            `• COMMON MISTAKES: what amateur implementations get wrong that makes the game feel bad\n\n` +
            `Be specific with numbers. A developer will copy these values directly into code.`
          }] }],
          generationConfig: { maxOutputTokens: 700, temperature: 0.3 }
        }),
        signal: AbortSignal.timeout(22000)
      }
    );
    if (!mechRes.ok) return '';
    const mechData = await mechRes.json();
    const brief = (mechData.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    return brief ? `\n\n${brief}` : '';
  } catch (e) {
    console.warn('[SnapToAI Build] Game mechanics search failed:', e.message);
    return '';
  }
}
// ── End game mechanics search ─────────────────────────────────────────────────

// Handle send with streaming
async function handleSend() {
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const thread = document.getElementById('chatThread');
  let prompt = input.value.trim();
  
  // Allow send if files are attached even with no text typed
  if (!prompt && filesQueue.length === 0) return;
  if (!prompt) prompt = 'Analyze this image.';

  // Dismiss any pending "Build it" button from the previous AI turn.
  document.querySelectorAll('.build-it-btn').forEach(b => b.remove());

  // ── Agent mode: acts on the live page instead of just chatting ──────────
  if (currentAiMode === 'agent') {
    input.value = '';
    resetInputSize(input);
    addBubble(prompt, 'user');
    await runAgentTask(prompt, thread);
    return;
  }

  // ── Build Mode: image & video embedding ──────────────────────────────────
  // When media files are attached while patching an existing site, store the
  // base64 data URLs locally and give the AI placeholder strings as src/src
  // values. After the AI responds we swap in the real data URLs client-side
  // so the media is embedded without needing an external host.
  // Do NOT clear pending media on continuation sends — the arrays hold the
  // data needed to swap __SNAP_IMG_N__ / __SNAP_VID_N__ once the full site
  // is assembled. Clearing them here would leave placeholders in the output.
  const _isContinuationSend = prompt.startsWith('CONTINUE_BUILD:');

  // ── New-app vs update guard ────────────────────────────────────────────────
  // If Build Mode has an existing app AND the prompt looks like a fresh build
  // (not a patch/update), intercept and ask the user before overwriting.
  // _skipNewAppGuard is set by the "Update current" button so a second call to
  // handleSend() with the same prompt bypasses this check exactly once.
  if (buildModeEnabled && _lastBuiltCode && !_isContinuationSend && !_skipNewAppGuard && _isNewBuildIntent(prompt)) {
    input.value = '';
    _showNewAppConfirmation(prompt, input);
    return;
  }
  _skipNewAppGuard = false; // consume the one-time bypass
  // ── End new-app guard ──────────────────────────────────────────────────────

  // ── Build Mode conversation router ─────────────────────────────────────────
  // Fires whether or not a site has been built yet.
  // • No site yet  → chat gathers requirements; user says "build it" to start.
  // • Site exists  → chat discusses the change; user says "build it" to patch.
  // Questions and vague messages get a conversational reply — nothing is built.
  // Clear action verbs ("add a button", "change the colour", "yes build it")
  // go straight to build/patch.
  // Files stay in filesQueue across chat turns so images are available when
  // the user gives the placement instruction on the next message.
  if (buildModeEnabled && !_isContinuationSend) {
    const _hasAttachedFiles = filesQueue.length > 0;
    if (!_isBuildInstruction(prompt, _hasAttachedFiles)) {
      input.value = '';
      resetInputSize(input);
      addBubble(prompt, 'user');
      await _buildModeChat(prompt, _hasAttachedFiles, thread);
      return;
    }
  }
  // ── End conversation router ─────────────────────────────────────────────────

  // ── Build plan confirmation ─────────────────────────────────────────────────
  // When there has been a real back-and-forth discussion (≥ 2 turns stored in
  // conversationHistory), show the user a quick 2-3 bullet summary of what the
  // AI is about to build before actually building — giving them a chance to
  // correct any misunderstanding. First-time quick builds ("build me X" →
  // "build it") have < 4 history entries (< 2 full turns) and skip this card.
  // Single-change patch edits (advisor summary has ≤ 1 bullet point) also skip
  // the card — adding a confirmation step would be friction for a tiny tweak.
  const _isPatchOnlyEdit = (() => {
    // Find the last model message in conversationHistory.
    let lastAiText = '';
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      if (conversationHistory[i] && conversationHistory[i].role === 'model' && conversationHistory[i].text) {
        lastAiText = conversationHistory[i].text;
        break;
      }
    }
    if (!lastAiText) return false;
    // Must be a plan-summary message: the build-it cue must appear in the final
    // ~300 characters (end-anchored), not just anywhere in the conversation turn.
    const tail = lastAiText.slice(-300);
    const hasBuildCue = /build\s+it|do\s+it|say\s+"(build|do)\s+it"/i.test(tail);
    if (!hasBuildCue) return false;
    // Count bullet lines (•, -, *) in the whole message.
    // The patch-mode advisor is now prompted to write one bullet per change, so
    // exactly 1 bullet = single-change plan → skip the card.
    // 0 bullets means the advisor didn't emit a structured summary yet → show card.
    // 2+ bullets means multiple changes → show card.
    const bulletCount = (lastAiText.match(/^[\s]*[•\-\*]\s/mg) || []).length;
    return bulletCount === 1;
  })();
  if (buildModeEnabled && !_isContinuationSend && !_skipBuildConfirmation && conversationHistory.length >= 4 && !_isPatchOnlyEdit) {
    input.value = '';
    resetInputSize(input);
    _showBuildConfirmation(prompt);
    return;
  }
  _skipBuildConfirmation = false; // consume the one-time bypass
  // ── End build plan confirmation ────────────────────────────────────────────

  if (!_isContinuationSend) {
    _pendingBuildImages = [];
    _pendingBuildVideos = [];
    _pendingBuildAudio = [];
  }
  // ── File-attached VIDEO embed (works on FIRST build AND patch edits) ─────────
  // Must run BEFORE the _lastBuiltCode block so that video files are intercepted
  // and removed from filesQueue before images are processed.
  // Gating this behind _lastBuiltCode prevented users from embedding an uploaded
  // video on a fresh build — it only worked for patch edits of existing sites.
  if (buildModeEnabled) {
    const videoParts = filesQueue.filter(f => f.mimeType && f.mimeType.startsWith('video/'));
    if (videoParts.length > 0) {
      const BUILD_VIDEO_BYTE_LIMIT = 50 * 1024 * 1024;
      const tooBig = videoParts.filter(f => Math.round((f.data.length * 3) / 4) > BUILD_VIDEO_BYTE_LIMIT);
      const fitsInline = videoParts.filter(f => Math.round((f.data.length * 3) / 4) <= BUILD_VIDEO_BYTE_LIMIT);
      if (tooBig.length > 0) {
        addBubble(
          `⚠️ "${tooBig.map(f => f.name).join(', ')}" is too large to embed directly ` +
          `(limit is ~50 MB). Upload it to YouTube as unlisted, then paste the link and say "embed this video".`,
          'error'
        );
        tooBig.forEach(f => { filesQueue = filesQueue.filter(q => q !== f); });
        if (fitsInline.length === 0 && !_lastBuiltCode) return;
      }
      if (fitsInline.length > 0) {
        _pendingBuildVideos = fitsInline.map(f => `data:${f.mimeType};base64,${f.data}`);
        fitsInline.forEach(f => { filesQueue = filesQueue.filter(q => q !== f); });
        const _vidOffsetFile = Object.keys(_committedMediaMap).filter(k => k.startsWith('__SNAP_VID_')).length;
        const videoPlaceholderList = _pendingBuildVideos.map((_, i) => `__SNAP_VID_${_vidOffsetFile + i}__`).join(', ');
        // Use correct ids/indices in the embed template
        const exVidIdx = _vidOffsetFile;
        prompt += `\n\nVIDEO EMBED INSTRUCTION: The user attached ${fitsInline.length} video(s). ` +
          `Use these exact placeholder strings as the src values: ${videoPlaceholderList}. ` +
          `For each video use this pattern (adjusting id/for index per video): ` +
          `<div style="position:relative;border-radius:12px;overflow:hidden;aspect-ratio:16/9;">` +
          `<video id="snapVid${exVidIdx}" src="__SNAP_VID_${exVidIdx}__" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;display:block;"></video>` +
          `<div onclick="document.getElementById('snapUpload${exVidIdx}').click()" style="position:absolute;inset:0;background:rgba(0,0,0,0.55);opacity:0;transition:opacity .3s;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer;" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0'">` +
          `<div style="width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);display:flex;align-items:center;justify-content:center;font-size:20px;">🔄</div>` +
          `<span style="color:#fff;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Replace video</span></div>` +
          `<button onclick="var v=document.getElementById('snapVid${exVidIdx}');v.muted=!v.muted;this.textContent=v.muted?'🔇':'🔊';" style="position:absolute;bottom:10px;right:10px;background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.3);border-radius:50%;width:36px;height:36px;cursor:pointer;font-size:16px;color:#fff;z-index:10;padding:0;line-height:1;">🔇</button>` +
          `<input type="file" id="snapUpload${exVidIdx}" accept="video/*" style="display:none" onchange="(function(i,v){if(i.files[0]){var r=new FileReader();r.onload=function(e){document.getElementById(v).src=e.target.result;};r.readAsDataURL(i.files[0]);}})(this,'snapVid${exVidIdx}')"></div>. ` +
          `CRITICAL RULES: ` +
          `(1) If the user named a specific section — place the video EXACTLY there. ` +
          `(2) If replacing an existing video — update only its src and add the overlay wrapper. ` +
          `(3) If no section specified — place prominently at the top of the page as the hero. ` +
          `(4) NEVER output actual base64 data — only placeholder strings. ` +
          `(5) Keep all other design completely unchanged. ` +
          `(6) NEVER remove or replace any existing __SNAP_VID_N__, __SNAP_IMG_N__ placeholders.`;
      }
    }
  }

  // ── PDF / document source-material handling in Build Mode ──────────────────
  // When the user attaches a PDF in Build Mode (e.g. a textbook, report, or
  // any document), Gemini reads it natively via inlineData. We inject an explicit
  // instruction so the AI knows to treat the PDF as the PRIMARY source material
  // and build the site/presentation/PDF from its content.
  if (buildModeEnabled) {
    const BUILD_PDF_BYTE_LIMIT = 15 * 1024 * 1024; // 15 MB raw (Gemini inline limit ~20 MB)
    const pdfParts = filesQueue.filter(f => {
      const m = (f.mimeType || '').toLowerCase();
      return m === 'application/pdf' || f.name?.toLowerCase().endsWith('.pdf');
    });
    if (pdfParts.length > 0) {
      const pdfTooBig = pdfParts.filter(f => Math.round((f.data.length * 3) / 4) > BUILD_PDF_BYTE_LIMIT);
      const pdfFits   = pdfParts.filter(f => Math.round((f.data.length * 3) / 4) <= BUILD_PDF_BYTE_LIMIT);

      if (pdfTooBig.length > 0) {
        addBubble(
          `⚠️ "${pdfTooBig.map(f => f.name).join(', ')}" is too large to send directly ` +
          `(limit is ~15 MB for documents). Try splitting it into smaller sections, ` +
          `or paste the key text directly into the chat.`,
          'error'
        );
        pdfTooBig.forEach(f => { filesQueue = filesQueue.filter(q => q !== f); });
        if (pdfFits.length === 0 && !prompt.trim()) return;
      }

      if (pdfFits.length > 0) {
        const pdfNames = pdfFits.map(f => f.name).join(', ');
        // Tell the AI to treat these PDFs as source material, not as assets to embed
        prompt +=
          `\n\n📄 SOURCE MATERIAL (PDF${pdfFits.length > 1 ? 's' : ''}): ` +
          `The user has attached ${pdfFits.length > 1 ? 'these documents' : 'this document'}: "${pdfNames}". ` +
          `MANDATORY: read the full content of the attached PDF${pdfFits.length > 1 ? 's' : ''} — ` +
          `they are your PRIMARY source of information. ` +
          `Extract all key topics, chapters, concepts, data, and important points. ` +
          `Base ALL content in your output on what is actually written in the document — ` +
          `do NOT invent or assume any content that is not in the PDF. ` +
          `If the user asked for a presentation: create one slide per major topic or chapter found in the PDF. ` +
          `If the user asked for a website: use the PDF content for all text, headings, and sections. ` +
          `If the user asked for a PDF/report: reformat and present the document content clearly.`;
      }
    }
  }

  // Office file context hint (PPTX / DOCX / XLSX extracted as text/plain)
  const officeParts = filesQueue.filter(f => f._officeType);
  if (officeParts.length > 0) {
    officeParts.forEach(f => {
      const label = f._officeType === 'pptx' ? 'PowerPoint presentation'
                  : f._officeType === 'docx' ? 'Word document'
                  : 'Excel spreadsheet';
      prompt += `\n\n📊 ATTACHED FILE: "${f._displayName || f.name}" is a ${label}. Its full text content has been extracted slide-by-slide and is attached as the text part of this message. Use it as the PRIMARY source of information — do not invent content not present in the file.`;
    });
  }

  // Image embedding — runs on FIRST builds AND patch edits (same as video above).
  // Previously gated behind _lastBuiltCode, which silently dropped user images
  // on fresh builds ("Start fresh" clears _lastBuiltCode before calling handleSend).
  if (buildModeEnabled) {
    const imageParts = filesQueue.filter(f => f.mimeType && f.mimeType.startsWith('image/'));

    // "Use my screenshots in build" — inject all captured screenshots as embedded images
    if (_buildUseSnaps && currentImages && currentImages.length > 0) {
      currentImages.slice(0, 6).forEach(dataUrl => {
        if (!dataUrl) return;
        const mimeType = dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
        const data = dataUrl.split(',')[1];
        if (data) imageParts.push({ name: 'screenshot', mimeType, data });
      });
    }

    if (imageParts.length > 0) {
      const _imgOffset = Object.keys(_committedMediaMap).filter(k => k.startsWith('__SNAP_IMG_')).length;
      _pendingBuildImages = imageParts.map(f => `data:${f.mimeType};base64,${f.data}`);
      const placeholderList = _pendingBuildImages.map((_, i) => `__SNAP_IMG_${_imgOffset + i}__`).join(', ');
      const examplePlaceholder = `__SNAP_IMG_${_imgOffset}__`;

      // Measure each screenshot's natural dimensions so the AI can size containers correctly
      const _snapDims = await Promise.all(_pendingBuildImages.map(url => new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve({ w: 0, h: 0 });
        img.src = url;
      })));
      // Build a dimension hint string: "__SNAP_IMG_0__ = 1920×1080 (landscape)"
      const _dimHints = _snapDims.map((d, i) => {
        if (!d.w || !d.h) return null;
        const orient = d.w > d.h ? 'landscape' : d.w < d.h ? 'portrait' : 'square';
        return `__SNAP_IMG_${_imgOffset + i}__ = ${d.w}×${d.h}px (${orient})`;
      }).filter(Boolean).join('; ');
      // CSS helper: for each image build the correct style based on its orientation
      // landscape/square → object-fit:cover works well in a 16:9 hero box
      // portrait (phone screenshot) → preserve ratio with object-fit:contain so nothing is cut
      const _perImgCss = _snapDims.map((d, i) => {
        const key = `__SNAP_IMG_${_imgOffset + i}__`;
        if (!d.w || !d.h) return `${key}: width:100%;height:auto;object-fit:contain;display:block;`;
        const isPortrait = d.h > d.w * 1.1;
        if (isPortrait) {
          // Portrait: let natural height show, center in a flex wrapper
          return `${key}: max-width:320px;width:100%;height:auto;object-fit:contain;display:block;margin:0 auto;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.4);`;
        } else {
          // Landscape/square: full width, fixed ratio container
          const ratio = Math.round((d.h / d.w) * 100);
          return `${key}: width:100%;aspect-ratio:${d.w}/${d.h};object-fit:cover;display:block;border-radius:8px;`;
        }
      }).join(' | ');

      // Detect if user wants the image used as a logo / favicon (not a hero image)
      const _isIconBuild = /\b(icon|favicon|logo|brand[\s-]?logo|site[\s-]?logo|app[\s-]?icon|navbar[\s-]?logo)\b/i.test(prompt);

      // Different instruction depending on whether this is a fresh build or a patch edit
      if (!_lastBuiltCode) {
        if (_isIconBuild) {
          // LOGO / FAVICON build — image goes small in header + as browser tab icon, NOT as hero
          prompt += `\n\nLOGO / FAVICON INSTRUCTION (FRESH BUILD): The user has provided ${imageParts.length} image(s) to use as the site logo and/or favicon. ` +
            `DO NOT place these images as large hero or background images. ` +
            `MANDATORY USAGE for __SNAP_IMG_${_imgOffset}__: ` +
            `(1) Add <link rel="icon" type="image/png" href="__SNAP_IMG_${_imgOffset}__"> inside <head> so it appears as the browser tab favicon. ` +
            `(2) Place a small <img src="__SNAP_IMG_${_imgOffset}__" alt="logo" style="height:36px;width:auto;object-fit:contain;display:block;"> in the top-left of the navbar/header next to the site name. ` +
            `(3) If there are additional images (${_pendingBuildImages.length > 1 ? placeholderList.split(', ').slice(1).join(', ') : 'none'}), use them as product photos or section visuals — sized naturally (width:100%;height:auto). ` +
            `CRITICAL: NEVER use any Pexels URLs when the user has provided their own logo. NEVER output actual base64 data — only placeholder strings.`;
        } else {
          // FRESH BUILD with user images: treat them as the primary product/brand visuals
          prompt += `\n\nPRODUCT IMAGE INSTRUCTION (FRESH BUILD): The user has provided ${imageParts.length} real screenshot(s) of their actual product, app, or brand. ` +
            `These are the PRIMARY visuals for the entire site — DO NOT use any Pexels stock photos at all. ` +
            `Use these exact placeholder strings as <img> src values: ${placeholderList}. ` +
            ((_dimHints) ? `IMAGE DIMENSIONS (use these to size containers correctly — NEVER stretch or crop unexpectedly): ${_dimHints}. ` : '') +
            `SIZING RULES — apply these exact styles per image: ${_perImgCss}. ` +
            `For portrait images (phone screenshots): wrap in a centered flex container with overflow:hidden; never set height:100% on the container — let height:auto preserve the natural ratio. ` +
            `For landscape images: wrap in a div with the matching aspect-ratio so the image fills it without distortion. ` +
            `MANDATORY PLACEMENT — distribute them across the site: ` +
            `${_pendingBuildImages.length >= 1 ? `__SNAP_IMG_${_imgOffset}__ = HERO section (full-bleed above the fold, the very first thing visitors see — make it large and prominent); ` : ''}` +
            `${_pendingBuildImages.length >= 2 ? `__SNAP_IMG_${_imgOffset + 1}__ = FEATURES or HOW IT WORKS section (mid-page, showing the product in use); ` : ''}` +
            `${_pendingBuildImages.length >= 3 ? `__SNAP_IMG_${_imgOffset + 2}__ = TESTIMONIAL, CTA, or CLOSING section (bottom of page, inspiring action); ` : ''}` +
            `If there are more images, distribute them naturally across remaining sections. ` +
            `CRITICAL: NEVER use any Pexels URLs. NEVER output actual base64 data — only placeholder strings. ` +
            `NEVER remove any __SNAP_VID_N__, __SNAP_AUD_N__ placeholders.`;
        }
      } else {
        // PATCH EDIT with user images: follow user's explicit placement instructions
        const _patchIsFavicon = /\b(favicon|tab[\s-]?icon|browser[\s-]?icon|site[\s-]?icon|page[\s-]?icon)\b/i.test(prompt);
        const _patchIsLogo    = /\b(logo|navbar[\s-]?logo|brand[\s-]?logo|header[\s-]?logo|nav[\s-]?logo)\b/i.test(prompt);
        const _patchIsIconOrLogo = _isIconBuild || _patchIsFavicon || _patchIsLogo;

        if (_patchIsFavicon) {
          prompt += `\n\nFAVICON PATCH INSTRUCTION: The user wants to set the attached image as the browser tab favicon. ` +
            `Use placeholder: ${placeholderList}. ` +
            `(1) Find the existing <link rel="icon"> in <head> (or add one if missing) and set href="${examplePlaceholder}". ` +
            `(2) Also update the navbar/header logo <img> src to "${examplePlaceholder}" if one exists. ` +
            `(3) Do NOT place this image anywhere else in the page body. ` +
            `(4) NEVER output base64 data — only the placeholder string. ` +
            `(5) Keep every other part of the site unchanged.`;
        } else if (_patchIsLogo) {
          prompt += `\n\nLOGO PATCH INSTRUCTION: The user wants to replace the site logo with the attached image. ` +
            `Use placeholder: ${placeholderList}. ` +
            `(1) Find the navbar/header logo element and set its src to "${examplePlaceholder}" with style="height:36px;width:auto;object-fit:contain;display:block;". ` +
            `(2) Also update <link rel="icon" href="${examplePlaceholder}"> in <head> so the favicon matches. ` +
            `(3) Do NOT place this image as a hero or background. ` +
            `(4) NEVER output base64 data — only the placeholder string. ` +
            `(5) Keep every other part of the site unchanged.`;
        } else {
          prompt += `\n\nIMAGE EMBED INSTRUCTION: The user attached ${imageParts.length} image(s). ` +
            `Use these exact placeholder strings as the src values: ${placeholderList}. ` +
            ((_dimHints) ? `IMAGE DIMENSIONS: ${_dimHints}. ` : '') +
            `SIZING RULES: ${_perImgCss}. ` +
            `NEVER use height:100% on an image or its container unless the container has an explicit fixed height — use height:auto to preserve the natural aspect ratio. ` +
            `CRITICAL RULES: ` +
            `(1) If the user said "replace", "change", "swap", or "update" an image — find that EXACT existing <img> tag and change ONLY its src attribute to the placeholder. Do NOT add a new img tag. ` +
            `(2) If the user said "add" or gave no specific target — place the image prominently above the fold: replace the hero image, or insert it as the first visual element after the headline. NEVER bury it at the bottom. ` +
            `(3) NEVER output any actual base64 data — only use the placeholder strings. ` +
            `(4) Keep all other design and content completely unchanged. ` +
            `(5) NEVER remove or replace any existing __SNAP_VID_N__, __SNAP_AUD_N__, or other __SNAP_*__ placeholder strings — they are live media references managed by the app.`;
        }
      }
    }

    // ── Uniqueness seed (fresh builds only) ──────────────────────────────────
    // Injects a random token so the AI can't reuse the same Pexels IDs or
    // layout patterns it used in previous builds in this session.
    if (!_isContinuationSend && !_lastBuiltCode) {
      const _buildSeed = Math.floor(Math.random() * 9000000) + 1000000;
      const _buildTs = new Date().toISOString().slice(0,16).replace('T',' ');
      prompt += `\n\n[BUILD-SEED:${_buildSeed} TIME:${_buildTs}] ` +
        `This is a completely fresh build — you MUST pick brand-new Pexels photo IDs not used in any previous response. ` +
        `Do not reuse IDs you have used before. The seed guarantees uniqueness: treat it as a creative direction token.`;
    }
    // ── End uniqueness seed ───────────────────────────────────────────────────

    // ── 5-Agent parallel pre-build pipeline (fresh builds only) ─────────────
    // ALL agents fire simultaneously via Promise.all — zero sequential wait.
    // Agent 1: Gemini 2.5 Pro Design Agent   — full creative/game spec
    // Agent 2: Web Research Agent            — real-world design/mechanics refs
    // Agent 3: Game Mechanics Agent          — game physics & AI patterns (games only)
    // Agent 4: Lyria Music Agent             — AI background music clip
    // Agent 5: Image Generation Agent        — AI images (fires in next block)
    if (!_isContinuationSend && !_lastBuiltCode) {
      const _storedKey2 = await chrome.storage.local.get(['geminiKey']);
      const _buildApiKey = _storedKey2.geminiKey;

      const _gameKeywords = /\b(game|platformer|arcade|puzzle|shooter|rpg|mario|zelda|dungeon|level|player|score|enemy|enemies|jump|shoot|sprite|tile|coin|boss)\b/i;
      const _presentationKeywords = /\b(presentation|slides|slideshow|powerpoint|pptx|pitch deck|slide deck|deck)\b/i;
      const _shopKeywords = /\b(shop|store|buy|sell|product|price|payment|checkout|cart|e-?commerce|stripe|paypal|order|purchase|selling)\b/i;
      const _adminShopKeywords = /\b(admin|manage products|add products|delete product|edit price|amazon style|owner panel|product manager|create offer|my own products|admin dashboard|admin panel)\b/i;
      const _mobileKeywords = /\b(mobile|phone|responsive|iphone|android|smartphone|tablet|works on mobile|mobile view|mobile friendly|mobile-first)\b/i;
      const _isGameBuild = _gameKeywords.test(prompt);
      const _isPresentationBuild = !_isGameBuild && _presentationKeywords.test(prompt);
      const _isShopBuild = !_isGameBuild && !_isPresentationBuild && _shopKeywords.test(prompt);
      const _isAdminShopBuild = _isShopBuild && _adminShopKeywords.test(prompt);
      const _isMobileRequested = _mobileKeywords.test(prompt);

      // Single status bubble for all agents
      const _buildLabel = _isGameBuild ? 'game' : _isPresentationBuild ? 'presentation' : _isShopBuild ? 'shop' : 'build';
      const _agentBubble = addBubble(
        `<div style="display:flex;align-items:center;gap:10px;color:rgba(255,255,255,0.65);font-size:13px;">` +
        `<span style="font-size:20px;">⚡</span>` +
        `<span>${_isGameBuild ? '4' : '3'} AI agents working simultaneously on your ${_buildLabel}…</span></div>`,
        'ai'
      );

      if (_buildApiKey) {
        // Fire all agents in parallel — no waiting for one before starting the next
        const [_designSpec, _webRef, _gameRef, _musicDataUrl] = await Promise.all([
          // Agent 1 — Gemini 2.5 Pro creative/design spec (every build)
          _designBuildWithAI(prompt, _buildApiKey, _isGameBuild),
          // Agent 2 — web research: design inspiration (websites) or game mechanics (games)
          _isGameBuild
            ? _searchForGameMechanics(prompt, _buildApiKey)
            : _searchWebForDesignInspiration(prompt, _buildApiKey),
          // Agent 3 — extra mechanics deep-dive (games only, else resolves instantly)
          _isGameBuild ? _searchForGameMechanics(prompt + ' physics constants enemy AI', _buildApiKey) : Promise.resolve(''),
          // Agent 4 — Lyria background music (every build)
          _generateBuildMusic(prompt, _buildApiKey)
        ]);

        // Inject design spec FIRST — highest priority context for the builder
        if (_designSpec) {
          const specLabel = _isGameBuild
            ? `GAME DESIGN DOCUMENT — authored by AI designer, follow exactly:`
            : `CREATIVE BRIEF — authored by AI creative director, follow exactly:`;
          prompt = `${specLabel}\n\n${_designSpec}\n\n` + prompt;
        }

        // Inject web/mechanics research
        if (_webRef) {
          prompt += _isGameBuild
            ? `\n\nGAME MECHANICS RESEARCH — real physics, AI, and design references:\n${_webRef}`
            : `\n\nWEB DESIGN RESEARCH — patterns from top real sites of this type today:\n${_webRef}`;
        }
        if (_isGameBuild && _gameRef && _gameRef !== _webRef) {
          prompt += `\n\nADDITIONAL GAME MECHANICS REFERENCE:\n${_gameRef}`;
        }

        // Queue Lyria music for embedding in the built app
        if (_musicDataUrl) {
          const _audOffset = _pendingBuildAudio.length;
          _pendingBuildAudio.push(_musicDataUrl);
          prompt +=
            `\n\nAI BACKGROUND MUSIC: A Lyria-generated music clip has been created for this ${_isGameBuild ? 'game' : 'app'}. ` +
            `Embed it as a looping background track using this placeholder as the src: __SNAP_AUD_${_audOffset}__. ` +
            `Pattern: <audio id="snapBgMusic" src="__SNAP_AUD_${_audOffset}__" autoplay loop style="display:none"></audio>. ` +
            `Add a small mute/unmute toggle button in the corner (bottom-right, 36×36px, semi-transparent). ` +
            `NEVER output the actual audio data — use ONLY the __SNAP_AUD_${_audOffset}__ placeholder string.`;
        }

        // Inject presentation-specific instructions
        if (_isPresentationBuild) {
          prompt +=
            `\n\n⚡ PRESENTATION BUILD — MANDATORY RULES (highest priority, override everything else):\n` +
            `1. Use PROFILE P from the system prompt. No scrolling page. Fullscreen slides only.\n` +
            `2. Include <script src="https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js"></script> in <head>.\n` +
            `3. Define ALL slide content in a const SLIDES = [ ... ] array in your <script> block.\n` +
            `4. The "⬇ Download PowerPoint" button must call generatePptx() which uses PptxGenJS to write a real .pptx file to disk.\n` +
            `5. Generate 10–15 content-rich slides based on the user's topic — do NOT use placeholder text.\n` +
            `6. Every slide must have: title (string), subtitle (optional string), bullets (string array), notes (string).\n` +
            `7. The generatePptx() function must iterate over the SLIDES array — never hardcode slide content in the function.\n` +
            `8. CRITICAL — slide background: use slide.background = { color: 'HEX' } — NEVER addShape for backgrounds.\n` +
            `   addShape backgrounds are locked shapes that users cannot edit in PowerPoint's Format Background dialog.\n` +
            `   slide.background sets the real native PowerPoint background — fully editable, themeable, and replaceable.\n` +
            `RESULT: the user clicks "Download PowerPoint" and gets a real, fully-editable .pptx file where they can change backgrounds, themes, fonts, and layout in PowerPoint.`;
        }

        // Inject shop / payment-specific instructions
        if (_isShopBuild) {
          prompt +=
            `\n\n⚡ SHOP BUILD — MANDATORY RULES (highest priority, override everything else):\n` +
            `1. Use PROFILE S from the system prompt. Build a full e-commerce page, not just a landing page.\n` +
            `2. PRODUCT GRID: 3–6 product cards — each card must have an image, name, description (2 lines), price (bold), "🛒 Add to Cart" + "Buy Now" buttons.\n` +
            `3. CART SYSTEM: pure JS (no server). let cart = [{ name, price, qty }]. Floating cart icon top-right with item-count badge. Cart modal shows items, subtotal, Checkout button.\n` +
            `4. PAYMENT BUTTONS — every "Buy Now" and "Checkout" must use Stripe Payment Links:\n` +
            `   <a href="https://buy.stripe.com/REPLACE_WITH_YOUR_STRIPE_LINK" target="_blank" class="pay-btn">Buy Now — $XX</a>\n` +
            `   <!-- To activate: go to dashboard.stripe.com → Payment Links → Create Link → copy the URL and replace the href above -->\n` +
            `5. PAYPAL FALLBACK: add a secondary PayPal button under each Stripe button:\n` +
            `   <a href="https://paypal.me/YOURUSERNAME/AMOUNT" target="_blank" class="paypal-btn">Pay with PayPal 💳</a>\n` +
            `   <!-- Replace with your PayPal.me link: paypal.me/YourName/Amount -->\n` +
            `6. TRUST ROW: a full-width strip that says "🔒 SSL Secured  ·  💳 Visa / Mastercard / PayPal  ·  🔄 Easy Returns"\n` +
            `7. Every product must have a REAL price shown (invent realistic prices if not specified).\n` +
            `8. NEVER build a fake cart that does nothing — add to cart MUST update the badge count.\n` +
            `RESULT: the user downloads the HTML, replaces the Stripe/PayPal placeholder links with their real payment links, and has a working online shop.`;
        }

        // Inject admin shop (owner CMS) instructions — overrides basic shop rules with full product management
        if (_isAdminShopBuild) {
          prompt +=
            `\n\n⚡ ADMIN SHOP BUILD — MANDATORY RULES (override basic shop rules, highest priority):\n` +
            `This is an Amazon-style owner-managed shop. Build a DUAL-MODE single HTML file:\n` +
            `MODE 1 — CUSTOMER STOREFRONT (what shoppers see):\n` +
            `  • On load, read products from localStorage key "snap_products" (JSON array).\n` +
            `  • If no saved products yet, pre-load 3 realistic demo products so the store is never empty.\n` +
            `  • Product cards: image, product name, SALE badge if offerPct > 0 (red "−20% OFF"), crossed-out original price, current price, "🛒 Add to Cart" + "Buy Now" (Stripe link).\n` +
            `  • Full cart drawer, subtotal, Stripe Payment Link checkout + PayPal fallback.\n` +
            `  • Trust row: "🔒 SSL Secured · 💳 Visa / Mastercard / PayPal · 🔄 Easy Returns".\n` +
            `MODE 2 — OWNER ADMIN PANEL (hidden, revealed by: clicking the site logo 3 times quickly, OR pressing Alt+A):\n` +
            `  • Password gate — default "admin123" — show it in a visible hint so owner knows it.\n` +
            `  • "➕ Add Product" form with fields: Name, Price ($), Original Price (blank = no sale badge), Description, Image — TWO options:\n` +
            `      (a) Paste image URL  (b) 📁 Upload from device (FileReader → base64 → stored in localStorage)\n` +
            `      Show a live thumbnail preview after upload/URL entry.\n` +
            `  • Product management table — one row per product with columns: [Thumbnail | Name | Price | Original Price | Offer % | Actions].\n` +
            `      Actions per row: ✏️ Edit (inline — click to edit any field, Enter to save), 🏷️ Set Offer % (input 0–99), 🗑️ Delete.\n` +
            `  • Changes auto-save to localStorage["snap_products"] immediately on every edit/delete/add.\n` +
            `  • "👀 Preview Store" button closes admin and refreshes storefront.\n` +
            `  • Warn owner in the panel when product count reaches 80 (localStorage limit).\n` +
            `DATA SCHEMA stored in localStorage["snap_products"]:\n` +
            `  [{ id (uuid), name, price (number), originalPrice (number|null), offerPct (number 0-99), description, imageData (url or base64), stripeLink, paypalLink }]\n` +
            `RESULT: the owner opens the HTML file, presses Alt+A, logs in, adds their products with real images and prices, sets sale offers — and customers see a live, beautiful shop.`;
        }

        // Inject mobile-first / responsive instructions when user explicitly asks for mobile support
        if (_isMobileRequested) {
          prompt +=
            `\n\n⚡ MOBILE-FIRST BUILD — MANDATORY EXTRA RULES (user specifically asked for mobile support):\n` +
            `1. Write ALL base CSS for a 375px screen first. Add desktop enhancements via @media (min-width:768px).\n` +
            `2. Navigation: hamburger menu (☰) on mobile — clicking it slides down the nav links. No horizontal overflow ever.\n` +
            `3. Every card grid: single column on mobile, 2 columns at 600px, 3+ columns at 900px+.\n` +
            `4. All buttons and tap targets: minimum 44×44px, comfortable thumb spacing (gap:16px minimum).\n` +
            `5. Hero headline: clamp(1.8rem,5vw,4rem) — never too large to fit on a 375px screen.\n` +
            `6. Product images: width:100%; height:220px; object-fit:cover — consistent card heights on mobile.\n` +
            `7. Cart icon and floating elements: position:fixed, top:16px, right:16px, z-index:999 — always visible.\n` +
            `8. Footer: single column, centered text on mobile.\n` +
            `9. Test mentally at 375px and 768px before finalising the layout — no element should overflow, overlap, or be unreachable.\n` +
            `RESULT: the site looks and works perfectly on any phone, tablet, or desktop without the user doing anything extra.`;
        }

        // Update bubble to show results
        const _agentResults = [
          _designSpec ? '✅ Design spec' : null,
          _webRef ? '✅ Web research' : null,
          _musicDataUrl ? '✅ Music' : null
        ].filter(Boolean).join(' · ');
        if (_agentBubble) _agentBubble.innerHTML =
          `<div style="display:flex;align-items:center;gap:10px;color:rgba(99,202,183,0.9);font-size:13px;">` +
          `<span style="font-size:20px;">⚡</span>` +
          `<span>${_agentResults || 'Agents ready'} — building now…</span></div>`;
      } else {
        if (_agentBubble) _agentBubble.style.display = 'none';
      }
    }
    // ── End 5-agent pipeline ──────────────────────────────────────────────────

    // ── Auto AI-image generation for fresh builds ─────────────────────────────
    // Determines how many images THIS site needs (1-15), writes one cinematic
    // prompt per slot, generates them all in parallel, and injects placeholders
    // into the build prompt so the AI places each one in the right section.
    // Runs even when the user attaches their own images — AI images are offset
    // to start AFTER the user-provided images so both coexist.
    // Fails silently → build falls back to Pexels stock photos.
    if (!_isContinuationSend && !_lastBuiltCode) {
      const _aiImgStatusBubble = addBubble('', 'ai');
      const _aiGeneratedImages = await _autoGenerateBuildImages(prompt, _aiImgStatusBubble);
      if (_aiGeneratedImages.length > 0) {
        // Offset AI image indices so they start AFTER any user-provided product images
        const _aiImgOffset = imageParts.length;
        // Merge: keep user images first, then AI images
        const _userImgs = _aiImgOffset > 0 ? (_pendingBuildImages || []) : [];
        _pendingBuildImages = [..._userImgs, ..._aiGeneratedImages];

        const n = _aiGeneratedImages.length;
        const placeholders = _aiGeneratedImages.map((_, i) => `__SNAP_IMG_${_aiImgOffset + i}__`).join(', ');

        // Build a dynamic placement guide so the AI knows where each image goes
        const placementGuide = _aiGeneratedImages.map((_, i) => {
          const idx = _aiImgOffset + i;
          if (_aiImgOffset === 0 && i === 0) return `__SNAP_IMG_${idx}__ → HERO section, full-bleed above the fold`;
          if (i === n - 1) return `__SNAP_IMG_${idx}__ → CLOSING/CTA section at the bottom`;
          return `__SNAP_IMG_${idx}__ → section ${i + 1} of the page (feature, gallery, testimonial, background, etc.)`;
        }).join('; ');

        const _aiImgLabel = _aiImgOffset > 0
          ? `AI BACKGROUND IMAGE INSTRUCTION: ${n} AI-generated atmospheric/scene images supplement the product shots above. Use them in every section NOT already covered by the product images.`
          : `AI IMAGE INSTRUCTION: ${n} custom AI-generated images have been created specifically for this site — one per major visual section. Use ALL ${n} of them.`;

        prompt +=
          `\n\n${_aiImgLabel} ` +
          `Do NOT use any Pexels stock photos. ` +
          `Placeholder strings to use as <img> src values: ${placeholders}. ` +
          `Placement guide: ${placementGuide}. ` +
          `Style every image: style="width:100%;height:100%;object-fit:cover;" ` +
          `NEVER output actual image data — use ONLY the __SNAP_IMG_N__ placeholder strings. ` +
          `If the site has more sections than images, repeat the last placeholder rather than adding Pexels URLs.`;
      } else if (_aiImgStatusBubble) {
        _aiImgStatusBubble.remove?.() || (_aiImgStatusBubble.style && (_aiImgStatusBubble.style.display = 'none'));
      }
    }
    // ── End auto AI-image generation ─────────────────────────────────────────

    // ── Audio embedding (mp3/wav/ogg) ────────────────────────────────────────
    const audioParts = filesQueue.filter(f => f.mimeType && f.mimeType.startsWith('audio/'));
    if (audioParts.length > 0) {
      const BUILD_AUDIO_BYTE_LIMIT = 5 * 1024 * 1024; // 5 MB raw
      const audioTooBig = audioParts.filter(f => Math.round((f.data.length * 3) / 4) > BUILD_AUDIO_BYTE_LIMIT);
      const audioFits   = audioParts.filter(f => Math.round((f.data.length * 3) / 4) <= BUILD_AUDIO_BYTE_LIMIT);

      if (audioTooBig.length > 0) {
        addBubble(
          `⚠️ "${audioTooBig.map(f => f.name).join(', ')}" is too large to embed directly ` +
          `(limit is ~5 MB for audio). Please trim the clip or use a shorter section.`,
          'error'
        );
        audioTooBig.forEach(f => { filesQueue = filesQueue.filter(q => q !== f); });
      }

      if (audioFits.length > 0) {
        _pendingBuildAudio = audioFits.map(f => `data:${f.mimeType};base64,${f.data}`);
        const audioPlaceholderList = _pendingBuildAudio.map((_, i) => `__SNAP_AUD_${i}__`).join(', ');
        prompt += `\n\nAUDIO EMBED INSTRUCTION: The user attached ${audioFits.length} audio file(s). ` +
          `Use these exact placeholder strings as the src values: ${audioPlaceholderList}. ` +
          `CRITICAL RULES: ` +
          `(1) Embed each audio file using an HTML5 <audio> tag with the placeholder as src. ` +
          `Use this pattern: <audio src="__SNAP_AUD_0__" controls style="width:100%;border-radius:8px;margin:12px 0;"></audio> ` +
          `(2) If the user named a section — place it exactly there. ` +
          `(3) NEVER output actual base64 data — only use the placeholder strings. ` +
          `(4) Keep all other design completely unchanged.`;
      }
    }
  }

  // ── Staged video from Veo "Use in Build" button ────────────────────────────
  // Placed OUTSIDE the _lastBuiltCode block so it works for first builds too.
  // Placed AFTER the _pendingBuildVideos clear so the data survives the swap.
  if (buildModeEnabled && _stagedBuildMedia && _stagedBuildMedia.type === 'video') {
    const m = _stagedBuildMedia;
    const _vidOffsetStaged = Object.keys(_committedMediaMap).filter(k => k.startsWith('__SNAP_VID_')).length;
    const stagedIdx = _vidOffsetStaged + _pendingBuildVideos.length;
    _pendingBuildVideos.push(`data:${m.mimeType};base64,${m.data}`);
    prompt += `\n\n[USER MEDIA] The user has a Veo-generated video to embed. ` +
      `Use __SNAP_VID_${stagedIdx}__ as the video src — do NOT output any base64 data. ` +
      `Embed it using this EXACT wrapper (includes a hover-to-upload overlay for the downloaded HTML): ` +
      `<div style="position:relative;border-radius:12px;overflow:hidden;aspect-ratio:16/9;">` +
      `<video id="snapVid${stagedIdx}" src="__SNAP_VID_${stagedIdx}__" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;display:block;"></video>` +
      `<div onclick="document.getElementById('snapUpload${stagedIdx}').click()" style="position:absolute;inset:0;background:rgba(0,0,0,0.55);opacity:0;transition:opacity .3s;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer;" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0'">` +
      `<div style="width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);display:flex;align-items:center;justify-content:center;font-size:20px;">🔄</div>` +
      `<span style="color:#fff;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Replace video</span></div>` +
      `<button onclick="var v=document.getElementById('snapVid${stagedIdx}');v.muted=!v.muted;this.textContent=v.muted?'🔇':'🔊';" style="position:absolute;bottom:10px;right:10px;background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.3);border-radius:50%;width:36px;height:36px;cursor:pointer;font-size:16px;color:#fff;z-index:10;padding:0;line-height:1;">🔇</button>` +
      `<input type="file" id="snapUpload${stagedIdx}" accept="video/*" style="display:none" onchange="(function(i,v){if(i.files[0]){var r=new FileReader();r.onload=function(e){document.getElementById(v).src=e.target.result;};r.readAsDataURL(i.files[0]);}})(this,'snapVid${stagedIdx}')"></div>` +
      ` — place in a dedicated full-width section of the page.`;
    clearStagedMedia();
  }

  if (!acquireRequestLock()) {
    addBubble('Please wait for the current request to complete...', 'ai');
    return;
  }

  // Immediately clear input and show user message — no waiting
  input.value = '';
  resetInputSize(input);
  sendBtn.disabled = true;
  addBubble(prompt, 'user');

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
    let apiKey = keyResult.geminiApiKey;

    // Task #27 — Honor the institution key policy. `institution-only` forbids
    // BYOK entirely; `prefer-institution-key` routes through the proxy when an
    // institution key is configured (so the institution key is used in
    // preference to the member's own key). Both cases blank the local apiKey
    // so sendChat falls into the proxy branch below.
    let _instKeyInfo = { isInstitution: false };
    try {
      _instKeyInfo = await getInstitutionKeyInfo();
      if (_instKeyInfo.isInstitution &&
          (_instKeyInfo.keyPolicy === 'institution-only' ||
           (_instKeyInfo.keyPolicy === 'prefer-institution-key' && _instKeyInfo.hasInstitutionKey))) {
        apiKey = '';
      }
    } catch (e) {}

    if (modeConfig.type === 'gemini-video') {
      // Task #27 — Video generation calls Google directly (Veo predictLongRunning),
      // not the proxy, so it cannot use the institution-side key. In
      // institution-only mode there's no fallback path, so fail clearly with
      // the same actionable error pattern instead of silently failing later.
      if (_instKeyInfo.isInstitution && _instKeyInfo.keyPolicy === 'institution-only') {
        removeLoading();
        const errBubble = createResponseBubble();
        errBubble.innerHTML = buildInstitutionKeyInvalidCard(
          _instKeyInfo.institutionName,
          'Video generation isn\'t available under institution-only key policy yet. Contact your admin if you need video access.'
        );
        thread.scrollTop = thread.scrollHeight;
        sendBtn.disabled = false;
        releaseRequestLock();
        return;
      }
      const clipCount = selectedClipCount || 1;
      // Check for API key BEFORE showing the paid confirmation — no point asking
      // the user to confirm spending money if they don't have a key yet.
      const _keyCheck = await chrome.storage.sync.get(['geminiApiKey']);
      if (!_keyCheck.geminiApiKey) {
        removeLoading();
        sendBtn.disabled = false;
        releaseRequestLock();
        try { await showProxyKeyPrompt(); } catch (e) {}
        return;
      }
      const costInfo = getPaidModeEstimate('video', clipCount, selectedVideoDuration || 8);
      const ok = await confirmPaidGeneration('video', costInfo);
      if (!ok) {
        removeLoading();
        sendBtn.disabled = false;
        releaseRequestLock();
        return;
      }
      removeLoading();
      // Save context for "Continue Clip" — last frame + prompt + style captured after generation
      _lastVideoContext = {
        prompt,
        style: typeof _vsbStylizeStyle !== 'undefined' ? _vsbStylizeStyle : 'pixar',
        videoUrl: null,
        lastFrameDataUrl: null,
        videoRef: null,       // { uri, mimeType } — real Google file reference for native "extend"
        modelUsed: null,      // set once known, in startVideoGeneration
        aspectRatioUsed: null,
        totalDurationSec: 0,
        extendCount: 0,
        // Requested total length (base clip + auto-chained native extends).
        // showVideoResult() checks this after every clip lands and, if native
        // extend is eligible, auto-fires the next extend until we reach it.
        targetDurationSec: typeof selectedTotalDuration === 'number' ? selectedTotalDuration : 8
      };
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
        // Bug fix: proxy path was ignoring all mode toggles. Build the effective
        // system context and prepend it so free-tier users get the same behaviour.
        let proxySystemCtx = '';
        let proxyExistingSite = '';
        if (buildModeEnabled) {
          if (_lastBuiltCode) {
            // Follow-up edit — use surgical patch prompt + inject current site
            proxySystemCtx = BUILD_PATCH_PROMPT;
            proxyExistingSite = `\n\nHere is the EXISTING site. Make ONLY the change the user asked for and return the complete file:\n\n\`\`\`html\n${_lastBuiltCodeForPatch || _lastBuiltCode}\n\`\`\``;
          } else {
            proxySystemCtx = BUILD_SYSTEM_PROMPT;
          }
        } else if (researchMode) {
          proxySystemCtx = 'You are an expert Research Agent. Find real-time facts, cite every source inline with [1],[2]… and list them at the end. Structure: Summary, Key Findings, Sources.';
        } else if (activeSpecialistAgent) {
          proxySystemCtx = activeSpecialistAgent.prompt;
        }
        const proxyPrompt = proxySystemCtx
          ? `[SYSTEM INSTRUCTION — follow exactly]\n${proxySystemCtx}\n\n[USER]\n${prompt}${proxyExistingSite}`
          : prompt;
        const proxyResult = await sendViaProxy(proxyPrompt, imageBase64);
        removeLoading();
        const aiText = proxyResult.text || 'No response';
        const proxyBubble = document.createElement('div');
        proxyBubble.className = 'chat-bubble ai';

        // In Build Mode: never show raw HTML in the chat bubble.
        // Extract HTML → preview iframe; show a clean status chip instead.
        const _proxyHasHtml = buildModeEnabled && /```html[\s\S]{200,}```/i.test(aiText);
        if (_proxyHasHtml) {
          const _isFirstBuild = !_lastBuiltCode;
          proxyBubble.innerHTML =
            '<div style="display:flex;align-items:center;gap:8px;font-size:13px;">' +
            '<span style="font-size:18px;">' + (_isFirstBuild ? '🏗️' : '✅') + '</span>' +
            '<span>' + (_isFirstBuild ? 'Your site is built! Check the preview below.' : 'Done — change applied to the preview.') + '</span>' +
            '</div>';
        } else if (typeof marked !== 'undefined') {
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
        renderLivePreview(aiText);
        addBubbleActions(proxyBubble, aiText);
        thread.scrollTop = thread.scrollHeight;
        conversationHistory.push({ role: 'user', text: prompt });
        // In Build Mode the current site is always injected fresh from _lastBuiltCode,
        // so storing the full HTML in history would double-count it every turn and
        // quickly blow the 1M-token limit. Store a compact summary instead.
        conversationHistory.push({ role: 'model', text: buildModeEnabled ? '[Built/updated website — see current version]' : aiText });
        
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
        // Task #27 — institution-only policy with bad/missing key. Never
        // suggest BYOK: the member is forbidden from overriding the org key.
        if (proxyErr.code === 'INSTITUTION_KEY_INVALID') {
          let instName = 'your organization';
          try {
            const _info = await getInstitutionKeyInfo();
            if (_info.isInstitution) instName = _info.institutionName;
          } catch (e) {}
          errBubble.innerHTML = buildInstitutionKeyInvalidCard(instName, msg);
        } else if (msg === 'PROXY_BUSY' || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('wait') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('busy')) {
          errBubble.innerHTML = buildRateLimitCard(false); // proxy path — user has no personal key
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
    // Find the index of the most recent user message that carried images.
    // We re-send images ONLY for that turn so Gemini still has visual context
    // for the current follow-up, but we never re-send images from older turns.
    // Re-sending all history images per turn = N_turns × N_images × ~1MB each
    // → exponential memory growth that causes the silent hang/crash.
    let lastImgTurnIdx = -1;
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      if (conversationHistory[i].images && conversationHistory[i].images.length > 0) {
        lastImgTurnIdx = i;
        break;
      }
    }
    for (let i = 0; i < conversationHistory.length; i++) {
      const msg = conversationHistory[i];
      const msgParts = [{ text: msg.text }];
      if (msg.images && i === lastImgTurnIdx) {
        // Re-send images from the most recent image-bearing turn only
        const histImgs = msg.images.slice(0, 4); // cap at 4 even in history
        for (const imgUrl of histImgs) {
          const base64Data = imgUrl.split(',')[1];
          const mimeType = imgUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
          msgParts.unshift({ inlineData: { mimeType, data: base64Data } });
        }
      }
      contents.push({ role: msg.role, parts: msgParts });
    }
    
    const userParts = [];
    // Default capped at 4: sending >4 large screenshots in one inlineData request
    // routinely exceeds the extension tab's memory budget and causes a silent hang.
    // When totalImages > MAX_IMAGES_PER_REQUEST the existing batch path fires,
    // which shows a visible progress bubble and adds a 6s rate-limit delay between
    // batches — so the user always sees what's happening.
    const MAX_IMAGES_PER_REQUEST = getConfig('MAX_IMAGES_PER_REQUEST', 4);
    const isFirstMessage = contents.length === 0;
    
    if (isFirstMessage) {
      const totalImages = currentImages.length;
      
      if (totalImages > MAX_IMAGES_PER_REQUEST) {
        // Large capture: process in batches silently (loading spinner stays visible)
        console.log(`[SnapToAI] Large capture detected: ${totalImages} images, processing in batches of ${MAX_IMAGES_PER_REQUEST}`);
        
        // Process batches sequentially
        let allBatchResults = [];
        const numBatches = Math.ceil(totalImages / MAX_IMAGES_PER_REQUEST);
        
        for (let batchNum = 0; batchNum < numBatches; batchNum++) {
          const start = batchNum * MAX_IMAGES_PER_REQUEST;
          const end = Math.min(start + MAX_IMAGES_PER_REQUEST, totalImages);
          const batchImages = currentImages.slice(start, end);
          
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
                removeLoading();
                const quotaBatchBubble = createResponseBubble();
                quotaBatchBubble.innerHTML = buildRateLimitCard(!!apiKey);
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
              removeLoading();
              const quotaBatchBubble2 = createResponseBubble();
              quotaBatchBubble2.innerHTML = buildRateLimitCard(!!apiKey);
              thread.scrollTop = thread.scrollHeight;
              sendBtn.disabled = false;
              releaseRequestLock();
              return;
            }
            allBatchResults.push(`## Batch ${batchNum + 1}\nError processing this batch.`);
          }
          
          // Short delay between batches to respect API limits
          if (batchNum < numBatches - 1) {
            await new Promise(r => setTimeout(r, 500));
          }
        }
        
        // Show combined results
        removeLoading();
        const responseBubble = document.createElement('div');
        responseBubble.className = 'chat-bubble ai';
        const combinedResult = `# Analysis (${totalImages} screenshots)\n\n${allBatchResults.join('\n\n---\n\n')}`;
        responseBubble.innerHTML = typeof marked !== 'undefined' ? (typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(marked.parse(combinedResult)) : marked.parse(combinedResult)) : combinedResult;
        thread.appendChild(responseBubble);
        addBubbleActions(responseBubble, combinedResult);
        renderLivePreview(combinedResult);
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
      const imageModels = MODELS.imageChain;
      
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
              }),
              signal: AbortSignal.timeout(30000)
            });
          } catch(fetchErr) {
            console.warn(`[SnapToAI Image] Fetch error on ${modelName}:`, fetchErr.message);
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
          console.log(`[SnapToAI Image] Error on ${modelName}: ${lastError}`);
          // Always try next model — don't stop on billing/permission/404 errors
          break; // break attempts, outer loop continues to next model
        }
        
        if (succeeded) break;
        console.log(`[SnapToAI Image] ${modelName} exhausted, trying next model...`);
      }
      
      if (!succeeded) {
        const errLow = (lastError || '').toLowerCase();
        const friendlyError = errLow.includes('failed to fetch') || errLow.includes('network')
          ? 'Connection failed — please check your internet and try again.'
          : errLow.includes('billing') || errLow.includes('permission') || errLow.includes('not enabled') || errLow.includes('paid') || errLow.includes('quota')
          ? 'Image generation requires a paid Google AI API key with billing enabled. Enable billing at aistudio.google.com and try again.'
          : errLow.includes('api key') || errLow.includes('invalid') || errLow.includes('401') || errLow.includes('403')
          ? 'Invalid or missing API key. Please re-enter your Gemini API key in settings.'
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
          htmlContent += `<div style="margin:10px 0;" class="generated-image-container" data-src="${rawImageSrc}"><img class="generated-img" src="${rawImageSrc}" style="max-width:100%;border-radius:12px;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,0.3);" title="Click to save full size"><div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;"><button class="img-save-btn" style="background:rgba(255,107,237,0.15);border:1px solid rgba(255,107,237,0.3);color:#ff6bed;padding:5px 14px;border-radius:8px;font-size:11px;cursor:pointer;transition:all 0.2s;">💾 Save Image</button><button class="img-use-build-btn" style="background:rgba(255,160,50,0.15);border:1px solid rgba(255,160,50,0.4);color:#ffa032;padding:5px 14px;border-radius:8px;font-size:11px;cursor:pointer;transition:all 0.2s;">📌 Use in Build</button></div></div>`;
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
      responseBubble.querySelectorAll('.img-use-build-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const container = btn.closest('.generated-image-container');
          const src = container?.dataset.src || container?.querySelector('img')?.src;
          if (!src) return;
          const base64 = src.split(',')[1];
          const mimeType = src.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
          setStagedMedia('image', mimeType, base64, 'Image');
          btn.textContent = '✅ Staged!';
          btn.style.background = 'rgba(0,200,136,0.2)';
          btn.style.borderColor = 'rgba(0,200,136,0.5)';
          btn.style.color = '#00cc88';
          setTimeout(() => {
            btn.textContent = '📌 Use in Build';
            btn.style.background = 'rgba(255,160,50,0.15)';
            btn.style.borderColor = 'rgba(255,160,50,0.4)';
            btn.style.color = '#ffa032';
          }, 2000);
        });
      });
      
      thread.scrollTop = thread.scrollHeight;
      addBubbleActions(responseBubble, fullText);
      
    } else if (modeConfig.type === 'gemini-audio') {
      // === MUSIC / AUDIO GENERATION (Lyria or TTS) ===

      // Expand short user inputs like "jazz" or "slow sad" into rich Lyria prompts
      function buildMusicPrompt(raw) {
        if (!raw || raw.trim().length === 0) {
          return 'Create an original, professional instrumental piece with a clear structure: intro, development, climax, and outro. Choose the best genre, instruments, and tempo automatically. Make it polished and complete.';
        }
        const input = raw.trim();
        // Already a detailed prompt — just wrap it
        if (input.length > 40) {
          return `Create a song: ${input}. Give it a clear musical structure with an intro, development, and outro. Make it sound professional and polished.`;
        }
        const lower = input.toLowerCase();
        const genreMap = [
          ['jazz',      'jazz featuring piano, upright bass, and brushed drums'],
          ['rock',      'rock with electric guitar, bass, and powerful drums'],
          ['pop',       'pop with a catchy melody and modern production'],
          ['classical', 'classical with orchestral strings and piano'],
          ['hip hop',   'hip hop with boom-bap beats and urban bass'],
          ['hiphop',    'hip hop with boom-bap beats and urban bass'],
          ['r&b',       'R&B with soulful melody and smooth groove'],
          ['rnb',       'R&B with soulful melody and smooth groove'],
          ['reggae',    'reggae with offbeat guitar and relaxed groove'],
          ['country',   'country with acoustic guitar and steel guitar'],
          ['edm',       'electronic dance music with synths and energetic drops'],
          ['electronic','electronic music with synthesizers and futuristic sound'],
          ['metal',     'metal with heavy distorted guitars and powerful drums'],
          ['folk',      'folk with acoustic guitar and natural instruments'],
          ['blues',     'blues with expressive guitar and emotional depth'],
          ['lo-fi',     'lo-fi hip hop with warm, mellow beats and dusty textures'],
          ['lofi',      'lo-fi hip hop with warm, mellow beats and dusty textures'],
          ['ambient',   'ambient music with atmospheric pads and peaceful flow'],
          ['funk',      'funk with tight bass groove and punchy horns'],
          ['latin',     'Latin music with rhythmic percussion and vibrant guitars'],
          ['trap',      'trap with 808 bass and modern hi-hat patterns'],
          ['k-pop',     'K-pop with a catchy melody and polished arrangement'],
          ['afrobeat',  'Afrobeat with rhythmic percussion and vibrant African influences'],
          ['indie',     'indie with guitar-driven sound and authentic feel'],
        ];
        const tempoMap = [
          ['very fast', 'a very fast tempo (160+ BPM)'],
          ['uptempo',   'an upbeat tempo (120–140 BPM)'],
          ['fast',      'a fast, energetic tempo (130–150 BPM)'],
          ['slow',      'a slow, relaxed tempo (60–80 BPM)'],
          ['downtempo', 'a slow, downtempo feel (60–80 BPM)'],
          ['medium',    'a medium tempo (90–110 BPM)'],
        ];
        const moodMap = [
          ['happy',     'happy and uplifting'],
          ['joyful',    'joyful and bright'],
          ['sad',       'sad and melancholic'],
          ['chill',     'relaxed and chill'],
          ['epic',      'epic and cinematic'],
          ['romantic',  'romantic and tender'],
          ['dark',      'dark and mysterious'],
          ['energetic', 'energetic and exciting'],
          ['peaceful',  'peaceful and serene'],
          ['nostalgic', 'nostalgic and bittersweet'],
          ['party',     'fun and celebratory'],
          ['powerful',  'powerful and intense'],
        ];

        let genre = null, tempo = null, mood = null;
        for (const [key, val] of genreMap) { if (lower.includes(key)) { genre = val; break; } }
        for (const [key, val] of tempoMap) { if (lower.includes(key)) { tempo = val; break; } }
        for (const [key, val] of moodMap)  { if (lower.includes(key)) { mood  = val; break; } }

        if (!genre && !tempo && !mood) {
          return `Create a song described as: "${input}". Make it professional and polished with a clear musical structure (intro, development, outro).`;
        }
        let p = 'Create';
        if (mood) p += ` a ${mood}`;
        if (genre) p += ` ${genre} song`;
        else p += ' an original song';
        if (tempo) p += ` at ${tempo}`;
        p += '. Give it a clear structure: intro, development sections, a climax, and an outro. Make it sound authentic and professionally produced.';
        return p;
      }

      const musicModels = [MODELS.lyria3, modeConfig.model, MODELS.lyria3Pro, MODELS.ttsFallback];
      let audioData = null;
      let audioError = '';
      let audioSucceeded = false;
      const MAX_RETRIES_PER_MODEL = 3;
      const RETRY_DELAY_MS = 1800;

      modelLoop: for (const audioModel of musicModels) {
        const isLyria = audioModel.includes('lyria');

        let bodyPayload;
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
            contentParts.push({ text: buildMusicPrompt(prompt) });
          }
          bodyPayload = {
            contents: [{ role: 'user', parts: contentParts }],
            generationConfig: { responseModalities: ['AUDIO'] }
          };
        } else {
          const selectedVoice = document.getElementById('voiceSelector')?.value || 'Puck';
          bodyPayload = {
            systemInstruction: { parts: [{ text: 'You are a natural, expressive podcast host. Speak clearly with good pacing and natural intonation. Do not say "here is the text" or any meta-commentary — just speak the content directly.' }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } } }
            }
          };
        }

        for (let attempt = 1; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
          console.log(`[Audio] ${audioModel} attempt ${attempt}/${MAX_RETRIES_PER_MODEL}`);
          try {
            const resp = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${audioModel}:generateContent?key=${apiKey}`,
              { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyPayload), signal: AbortSignal.timeout(30000) }
            );

            const body = await resp.json().catch(() => ({}));

            if (resp.ok && body.candidates?.[0]?.content?.parts) {
              const audioParts = body.candidates[0].content.parts;
              const hasRealAudio = audioParts.some(p => p.inlineData?.data && p.inlineData.data.length > 5000);
              if (hasRealAudio) {
                audioData = body;
                audioSucceeded = true;
                console.log(`[Audio] Success: ${audioModel} attempt ${attempt}`);
                break modelLoop;
              } else {
                audioError = '__billing_unlock__';
                continue modelLoop;
              }
            }

            audioError = body.error?.message || `Status ${resp.status}`;
            const errLow = audioError.toLowerCase();
            const isInternal  = resp.status === 500 || errLow.includes('internal');
            const isRateLimit = resp.status === 429 || errLow.includes('rate') || errLow.includes('quota');
            const isBilling   = errLow.includes('billing') || errLow.includes('permission') || errLow.includes('not enabled') || errLow.includes('paid tier');

            if (isBilling) { audioError = '__billing_unlock__'; continue modelLoop; }

            if (isInternal && attempt < MAX_RETRIES_PER_MODEL) {
              console.log(`[Audio] Internal error on ${audioModel}, retrying in ${RETRY_DELAY_MS}ms...`);
              await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
              continue;
            }
            if (isRateLimit || isInternal) {
              console.log(`[Audio] Moving to next model after ${attempt} attempt(s) on ${audioModel}`);
              continue modelLoop;
            }
            // Non-retryable error — skip to next model
            continue modelLoop;

          } catch(e) {
            audioError = e.message;
            console.log(`[Audio] ${audioModel} attempt ${attempt} threw:`, e.message);
            if (attempt < MAX_RETRIES_PER_MODEL) {
              await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            }
          }
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
        const errLower = (audioError || '').toLowerCase();
        const friendlyAudioError = errLower.includes('failed to fetch')
          ? 'Connection failed — please check your internet and try again.'
          : errLower.includes('internal')
          ? 'Google\'s music servers hit a temporary hiccup. Please try again in a few seconds — it usually clears up quickly.'
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
      if (buildModeEnabled && buildStage === 'L1') {
        systemPrompt = L1_SCAFFOLD_PROMPT;
      } else if (buildModeEnabled && buildStage === 'L2') {
        systemPrompt = L2_DESIGN_PROMPT;
        if (_buildBodyHtml) {
          const last = contents[contents.length - 1];
          if (last && last.role === 'user') {
            last.parts.push({ text: '\n\nHere is the HTML body structure to style:\n\n' + _buildBodyHtml });
          }
        }
      } else if (buildModeEnabled && buildStage === 'L3') {
        systemPrompt = L3_ACTIVATE_PROMPT;
        if (_buildBodyHtml) {
          const assembled = assembleStagedHtml(_buildBodyHtml, _buildStyleCss, '');
          const last = contents[contents.length - 1];
          if (last && last.role === 'user') {
            last.parts.push({ text: '\n\nHere is the full HTML with structure and styles to wire:\n\n' + assembled });
          }
        }
      } else if (buildModeEnabled && buildStage === 'UPDATE') {
        systemPrompt = L_UPDATE_PROMPT;
        if (_lastBuiltCode) {
          const last = contents[contents.length - 1];
          if (last && last.role === 'user') {
            last.parts.push({ text: '\n\nHere is the current full HTML to patch:\n\n' + _lastBuiltCode });
          }
        }
      } else if (buildModeEnabled) {
        if (_lastBuiltCode) {
          // Site already exists — surgical patch mode: change only what was asked
          systemPrompt = BUILD_PATCH_PROMPT;
          const last = contents[contents.length - 1];
          if (last && last.role === 'user') {
            last.parts.push({ text: '\n\nHere is the EXISTING site. Make ONLY the change the user asked for and return the complete file:\n\n```html\n' + (_lastBuiltCodeForPatch || _lastBuiltCode) + '\n```' });
          }
        } else {
          // No site yet — full build from scratch
          systemPrompt = BUILD_SYSTEM_PROMPT;
        }
      } else if (activeSpecialistAgent) {
        systemPrompt = activeSpecialistAgent.prompt;
      } else if (researchMode) {
        systemPrompt = `You are an expert Research Agent. Follow these rules strictly:\n1. Use Google Search to find real-time facts before answering.\n2. If a URL is provided, read and synthesize its content.\n3. Cite every source inline with [1], [2], etc. and list them at the end.\n4. Structure your response with: **Summary**, **Key Findings**, **Sources**.\n5. Be thorough, factual, and never guess — if unsure, say so and search again.`;
      } else if (currentImages.length > 1) {
        systemPrompt = MULTI_IMAGE_PROMPT;
      } else if (currentPageText && currentPageText.length > 800) {
        systemPrompt = SMART_SYSTEM_PROMPT;
      }
      
      // Build tools array based on active toggles
      const _tools2 = [];
      if (searchGroundingEnabled) _tools2.push({ googleSearch: {} });
      if (codeExecutionEnabled) _tools2.push({ codeExecution: {} });

      const _body2 = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: contents,
        generationConfig: {
          maxOutputTokens: buildModeEnabled ? 32768 : getConfig('MAX_OUTPUT_TOKENS', 2048),
          temperature: buildModeEnabled ? 0.75 : getConfig('TEMPERATURE', 0.7),
          topP: 0.95,
          topK: 40
        }
      };
      if (_tools2.length > 0) _body2.tools = _tools2;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modeConfig.model}:streamGenerateContent?alt=sse&key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(_body2)
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
      let _buildChunkCount = 0;
      let _buildLastRenderLen = 0;
      
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
                _buildChunkCount++;
                // In Build Mode: don't stream raw HTML into the chat bubble —
                // it confuses the user with thousands of lines of code.
                // Show a live progress indicator instead; preview updates via renderLivePreview.
                const _streamIsHtml = buildModeEnabled && (fullText.trimStart().startsWith('<!') || /```html/i.test(fullText));
                if (_streamIsHtml) {
                  // Detect which section is currently being written
                  const _ft = fullText;
                  let _section = 'Starting…';
                  if (/<\/html>/i.test(_ft))            _section = 'Finalising…';
                  else if (/<footer/i.test(_ft))        _section = 'Writing footer…';
                  else if (/<script/i.test(_ft))        _section = 'Adding interactions…';
                  else if (((_ft.match(/<section/gi)||[]).length) >= 4) _section = 'Building sections…';
                  else if (/<section/i.test(_ft))       _section = 'Building layout…';
                  else if (/<body/i.test(_ft))          _section = 'Building structure…';
                  else if (/<style/i.test(_ft))         _section = 'Writing styles…';
                  else if (/<head/i.test(_ft))          _section = 'Setting up…';
                  const _kbWritten = Math.round(_ft.length / 100) / 10;
                  // Set up the card once; only update text nodes afterwards so the
                  // CSS progress-bar animation doesn't restart on every chunk.
                  if (!responseBubble.querySelector('._bld_card')) {
                    responseBubble.innerHTML =
                      '<style>' +
                      '@keyframes _bld_pulse{0%,100%{opacity:.65}50%{opacity:1}}' +
                      '@keyframes _bld_shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}' +
                      '</style>' +
                      '<div class="_bld_card" style="font-size:13px;padding:2px 0;">' +
                        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
                          '<span style="font-size:18px;animation:_bld_pulse 1.4s ease-in-out infinite;display:inline-block;">🏗️</span>' +
                          '<span style="font-weight:600;">Building your site</span>' +
                          '<span class="_bld_kb" style="color:#8899aa;font-size:11px;margin-left:auto;">0 KB</span>' +
                        '</div>' +
                        '<div style="background:rgba(255,255,255,0.07);border-radius:4px;height:5px;overflow:hidden;margin-bottom:7px;position:relative;">' +
                          '<div style="position:absolute;inset:0;background:linear-gradient(90deg,#4a9eff,#a78bfa);border-radius:4px;animation:_bld_shimmer 1.8s ease-in-out infinite;width:40%;"></div>' +
                        '</div>' +
                        '<div class="_bld_section" style="color:#8899aa;font-size:11px;">Starting…</div>' +
                      '</div>';
                  }
                  // Update just the live labels — no DOM rebuild, no animation reset
                  const _kbEl = responseBubble.querySelector('._bld_kb');
                  const _secEl = responseBubble.querySelector('._bld_section');
                  if (_kbEl) _kbEl.textContent = _kbWritten + ' KB';
                  if (_secEl) _secEl.textContent = _section;
                  // Push partial HTML to preview every ~2000 chars of new content
                  if (fullText.length - _buildLastRenderLen > 2000) {
                    _buildLastRenderLen = fullText.length;
                    renderLivePreview(fullText);
                  }
                } else {
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

      renderLivePreview(fullText);
      addBubbleActions(responseBubble, fullText);
      injectStudyCards(responseBubble, fullText);

      // After streaming ends: if we were showing "building…" (Build Mode HTML),
      // replace with a clean done message now that the preview is ready.
      const _finalIsHtml = buildModeEnabled && (fullText.trimStart().startsWith('<!') || /```html/i.test(fullText));
      if (_finalIsHtml) {
        const _wasFirst = !_lastBuiltCode || fullText.length > 5000;
        responseBubble.innerHTML =
          '<div style="display:flex;align-items:center;gap:8px;font-size:13px;">' +
          '<span style="font-size:18px;">' + (_wasFirst ? '🏗️' : '✅') + '</span>' +
          '<span>' + (_wasFirst ? 'Your site is built! Check the preview below.' : 'Done — change applied to the preview.') + '</span>' +
          '</div>';
      }
    }
    
    const userHistoryEntry = { role: 'user', text: prompt };
    if (isFirstMessage && currentImages.length > 0) {
      userHistoryEntry.images = currentImages;
    }
    conversationHistory.push(userHistoryEntry);
    // In Build Mode the current site is always injected fresh from _lastBuiltCode,
    // so storing the full HTML in history would double-count it every turn and
    // quickly blow the 1M-token limit. Store a compact summary instead.
    conversationHistory.push({ role: 'model', text: buildModeEnabled ? '[Built/updated website — see current version]' : fullText });
    
  } catch (error) {
    removeLoading();
    {
      const lowerErr = error.message.toLowerCase();
      const isQuotaError = lowerErr.match(/quota|rate|limit|429|exceeded|resource.exhausted/);
      const isBilling = lowerErr.includes('billing') || lowerErr.includes('permission') || lowerErr.includes('not enabled') || lowerErr.includes('paid tier') || lowerErr.includes('precondition');
      if (isQuotaError) {
        const quotaBubble = createResponseBubble();
        quotaBubble.innerHTML = buildRateLimitCard(!!apiKey);
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

  // Google server overload — this is Google's own raw message ("high demand",
  // "overloaded", 503/UNAVAILABLE) and its exact wording changes between requests,
  // which is confusing for users. Always translate it to one consistent message.
  if (lowerMsg.includes('high demand') || lowerMsg.includes('overloaded') ||
      lowerMsg.includes('unavailable') || lowerMsg.includes('503') ||
      lowerMsg.includes('spikes in demand') || lowerMsg.includes('try again later')) {
    return `🔥 Google's AI servers are very busy right now (this is on Google's end, not your key or your account). Please wait 30-60 seconds and try again.`;
  }

  // Default: return original message
  return errorMsg;
}

// Add action buttons under each AI response
function addBubbleActions(bubble, text) {
  const actions = document.createElement('div');
  actions.className = 'bubble-actions';

  // ── STAGED BUILD: store fragment and assemble full HTML ──────────────────
  if (buildModeEnabled && buildStage === 'L1') {
    _buildBodyHtml = extractFragment(text);
    // Video/image/audio placeholders live in the body HTML — swap them here so
    // every subsequent assembleStagedHtml call (L2, L3, UPDATE) uses real data.
    // Must clear the arrays after consuming so the classic-path swap doesn't
    // double-apply on a later patch.
    if (_pendingBuildImages.length > 0) {
      const _fixImgOffset = Object.keys(_committedMediaMap).filter(k => k.startsWith('__SNAP_IMG_')).length;
      _pendingBuildImages.forEach((u, i) => { _buildBodyHtml = _buildBodyHtml.split(`__SNAP_IMG_${_fixImgOffset + i}__`).join(u); });
      _pendingBuildImages = [];
    }
    if (_pendingBuildVideos.length > 0) {
      _pendingBuildVideos.forEach((u, i) => { _buildBodyHtml = _buildBodyHtml.split(`__SNAP_VID_${i}__`).join(u); });
      _pendingBuildVideos = [];
    }
    if (_pendingBuildAudio.length > 0) {
      _pendingBuildAudio.forEach((u, i) => { _buildBodyHtml = _buildBodyHtml.split(`__SNAP_AUD_${i}__`).join(u); });
      _pendingBuildAudio = [];
    }
    _lastBuiltCode = assembleStagedHtml(_buildBodyHtml, '', '');
    try { chrome.storage.local.set({ snaptoai_built_code: _lastBuiltCode, snaptoai_build_body: _buildBodyHtml }); } catch(e) {}
    _setBadgeDone('L1'); _updateBuildInput();
  } else if (buildModeEnabled && buildStage === 'L2') {
    _buildStyleCss = extractFragment(text);
    _lastBuiltCode = assembleStagedHtml(_buildBodyHtml, _buildStyleCss, '');
    try { chrome.storage.local.set({ snaptoai_built_code: _lastBuiltCode, snaptoai_build_style: _buildStyleCss }); } catch(e) {}
    _setBadgeDone('L2'); _updateBuildInput();
  } else if (buildModeEnabled && buildStage === 'L3') {
    _buildScriptJs = extractFragment(text);
    _lastBuiltCode = assembleStagedHtml(_buildBodyHtml, _buildStyleCss, _buildScriptJs);
    try { chrome.storage.local.set({ snaptoai_built_code: _lastBuiltCode, snaptoai_build_script: _buildScriptJs }); } catch(e) {}
    _setBadgeDone('L3'); _updateBuildInput();
  } else if (buildModeEnabled && buildStage === 'UPDATE') {
    // Patch the targeted section in the existing body HTML
    const fragment = extractFragment(text);
    if (fragment && _buildBodyHtml) {
      // Replace section content by data-section-id if possible, else append
      const target = document.getElementById('chatInput')?.getAttribute('data-update-section');
      if (target) {
        const re = new RegExp('(data-section-id="' + target + '"[^>]*>)([\s\S]*?)(<\/)', 'i');
        _buildBodyHtml = _buildBodyHtml.replace(re, '$1\n' + fragment + '\n$3');
      }
    }
    _lastBuiltCode = assembleStagedHtml(_buildBodyHtml, _buildStyleCss, _buildScriptJs);
    try { chrome.storage.local.set({ snaptoai_built_code: _lastBuiltCode, snaptoai_build_body: _buildBodyHtml }); } catch(e) {}
    _updateBuildInput();
  }

  // ── CLASSIC BUILD MODE: extract full HTML from response ──────────────────
  const _extracted = buildModeEnabled && !buildStage
    ? extractHtmlFromResponse(text, _continuationPending ? _lastBuiltCode : null)
    : { html: '', truncated: false };
  if (_continuationPending && _extracted.html) _continuationPending = false;
  const thisCode = _extracted.html;
  // Detect truncation: AI ran out of tokens and the file is incomplete.
  // Only applies to classic (no-stage) build mode — staged builds use per-stage output.
  const isTruncated = !buildStage && _extracted.truncated;
  // Only commit to _lastBuiltCode when the output is complete. Saving a
  // truncated partial would strip sections (e.g. pricing) from future edits.
  if (thisCode && !buildStage && !isTruncated) {
    _lastBuiltCode = thisCode;
    // Save the pre-swap version (placeholders intact) for AI patch requests.
    // The swapped version below embeds large base64 blobs that would exceed
    // Gemini's 1M-token limit if sent back on follow-up edits.
    _lastBuiltCodeForPatch = thisCode;

    // Compute offsets so new media gets unique placeholder indices even when
    // the committed map already has entries of the same type.
    const _imgOffset = Object.keys(_committedMediaMap).filter(k => k.startsWith('__SNAP_IMG_')).length;
    const _vidOffset = Object.keys(_committedMediaMap).filter(k => k.startsWith('__SNAP_VID_')).length;
    const _audOffset = Object.keys(_committedMediaMap).filter(k => k.startsWith('__SNAP_AUD_')).length;

    // Re-apply ALL previously committed media so placeholders left in _lastBuiltCodeForPatch
    // (e.g. __SNAP_VID_0__ from a prior build) get swapped back into the new patch response.
    // Without this, adding an image after a video causes the video to disappear.
    Object.entries(_committedMediaMap).forEach(([placeholder, dataUrl]) => {
      _lastBuiltCode = _lastBuiltCode.split(placeholder).join(dataUrl);
    });

    // Swap in any NEW images attached during this request and register them
    if (_pendingBuildImages.length > 0) {
      _pendingBuildImages.forEach((dataUrl, i) => {
        const key = `__SNAP_IMG_${_imgOffset + i}__`;
        _lastBuiltCode = _lastBuiltCode.split(key).join(dataUrl);
        _committedMediaMap[key] = dataUrl;
      });
      _pendingBuildImages = [];
    }
    // Swap in any NEW videos attached during this request and register them
    if (_pendingBuildVideos.length > 0) {
      _pendingBuildVideos.forEach((dataUrl, i) => {
        const key = `__SNAP_VID_${_vidOffset + i}__`;
        _lastBuiltCode = _lastBuiltCode.split(key).join(dataUrl);
        _committedMediaMap[key] = dataUrl;
      });
      _pendingBuildVideos = [];
    }
    // Swap in any NEW audio files attached during this request and register them
    if (_pendingBuildAudio.length > 0) {
      _pendingBuildAudio.forEach((dataUrl, i) => {
        const key = `__SNAP_AUD_${_audOffset + i}__`;
        _lastBuiltCode = _lastBuiltCode.split(key).join(dataUrl);
        _committedMediaMap[key] = dataUrl;
      });
      _pendingBuildAudio = [];
    }
    try { chrome.storage.local.set({ snaptoai_built_code: _lastBuiltCode }); } catch(e) {}
    _updateBuildInput();
  }
  // Always render the preview when build mode is on — even if the AI gave
  // a plain-text reply (no new HTML). This ensures the spinner never sticks.
  if (buildModeEnabled) {
    // Use _lastBuiltCode (post-placeholder-swap) when available — thisCode is
    // the raw AI response and still contains __SNAP_IMG_N__ / __SNAP_VID_N__.
    const finalCode = _lastBuiltCode || thisCode;
    if (finalCode) {
      _showLivePreview(finalCode);
      _showImageMap();
      _showQuickFixBar();
    } else {
      // No code at all: hide the spinner without showing blank iframe
      const building = document.getElementById('previewBuilding');
      const lbl = document.getElementById('previewLabel');
      if (building) building.style.display = 'none';
      if (lbl) lbl.textContent = '🏗️ LIVE PREVIEW';
    }
  }

  actions.innerHTML = `
    <button class="copy-single-btn">📋 Copy</button>
    <button class="read-aloud-btn">🔊 Read</button>
    <button class="magic-card-btn">✨ Magic Card</button>
  `;
  bubble.appendChild(actions);

  // Truncation recovery — when the AI ran out of tokens mid-file, automatically
  // continue the build so missing sections (pricing, JS scripts, etc.) are never lost.
  if (isTruncated) {
    const warn = document.createElement('div');
    warn.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:rgba(255,160,50,0.75);margin-top:5px;padding:0 2px;flex-wrap:wrap;';
    if (_continuationCount < _CONTINUATION_MAX) {
      warn.innerHTML = `<span>⚠️ Site was too long — auto-continuing build… (${_continuationCount + 1}/${_CONTINUATION_MAX})</span>`;
      actions.appendChild(warn);
      // Auto-fire the continuation after a short delay so the UI settles first.
      setTimeout(() => {
        _continuationCount++;
        _continuationPending = true;
        if (!buildModeEnabled) {
          buildModeEnabled = true;
          const buildBtn = document.getElementById('buildToggleBtn');
          if (buildBtn) {
            buildBtn.classList.add('tool-btn-active');
            buildBtn.title = 'Build Mode ON — AI will generate full HTML/CSS/JS apps with live preview';
          }
        }
        const input = document.getElementById('chatInput');
        if (input) {
          input.value = 'CONTINUE_BUILD: output only the remaining HTML from where the previous response cut off. Start at the beginning of the next complete HTML element (opening tag like <div, <section, <footer, <script). Never restart from <!DOCTYPE html>. Never repeat already-written code.';
          const btn = document.getElementById('sendBtn');
          if (btn) btn.click();
        }
      }, 800);
    } else {
      // Cap reached — show a manual button instead of looping forever
      warn.innerHTML = `<span>⚠️ Build incomplete after ${_CONTINUATION_MAX} attempts</span>
        <button style="background:rgba(255,160,50,0.15);border:1px solid rgba(255,160,50,0.5);color:#ffa032;border-radius:10px;padding:2px 9px;font-size:11px;font-weight:600;cursor:pointer;">🔄 Try Again</button>`;
      warn.querySelector('button').addEventListener('click', () => {
        _continuationCount = 0;
        _continuationPending = true;
        const input = document.getElementById('chatInput');
        if (input) {
          input.value = 'CONTINUE_BUILD: output only the remaining HTML from where the previous response cut off. Start at the beginning of the next complete HTML element (opening tag like <div, <section, <footer, <script). Never restart from <!DOCTYPE html>. Never repeat already-written code.';
          document.getElementById('sendBtn')?.click();
        }
      });
      actions.appendChild(warn);
    }
  } else {
    // Successful complete response — reset the continuation counter
    _continuationCount = 0;
  }

  
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
  
  // ── Read Aloud — Voice Picker + Gemini TTS ────────────────────────────────
  const readBtn = actions.querySelector('.read-aloud-btn');
  let ttsSession = null;
  let voicePickerEl = null;

  // Inject picker animation CSS once
  if (!document.getElementById('snaptoai-vp-style')) {
    const s = document.createElement('style');
    s.id = 'snaptoai-vp-style';
    s.textContent = `
      @keyframes vpIn { from { opacity:0; transform:translateY(-8px) scale(0.97); } to { opacity:1; transform:translateY(0) scale(1); } }
      @keyframes vpBarPulse { 0%,100% { transform:scaleY(0.5); } 50% { transform:scaleY(1); } }
      .vp-card { transition: background 0.2s, border-color 0.2s, transform 0.2s, box-shadow 0.2s; }
      .vp-card:hover { transform: translateY(-3px) !important; }
      .vp-playing .vp-bar { animation: vpBarPulse 0.7s ease-in-out infinite; }
      .vp-bar { transition: height 0.2s; }
    `;
    document.head.appendChild(s);
  }

  const TTS_VOICES = [
    { name: 'Zephyr', emoji: '📖', desc: 'Story for Kids',         color: '#f59e0b', delays: ['0s','0.12s','0.06s','0.12s','0s'] },
    { name: 'Kore',   emoji: '🎙️', desc: 'Warm & Professional', color: '#8b5cf6', delays: ['0s','0.1s','0.2s','0.1s','0s'] },
    { name: 'Puck',   emoji: '🎤', desc: 'Bright & Expressive',  color: '#ec4899', delays: ['0.2s','0s','0.1s','0.2s','0.1s'] },
    { name: 'Aoede',  emoji: '🎵', desc: 'Melodic & Clear',       color: '#10b981', delays: ['0s','0.15s','0.05s','0.15s','0s'] },
  ];

  function stopTts() {
    if (ttsSession) {
      ttsSession.stopped = true;
      try { ttsSession.controller.abort(); } catch (e) {}
      if (ttsSession.audio) { try { ttsSession.audio.pause(); } catch (e) {} }
      ttsSession.urls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
      ttsSession = null;
    }
    synth.cancel();
    readBtn.textContent = '🔊 Read';
    readBtn.disabled = false;
    if (voicePickerEl) { voicePickerEl.remove(); voicePickerEl = null; }
  }

  function showVoicePicker(onSelect) {
    if (voicePickerEl) { voicePickerEl.remove(); voicePickerEl = null; return; }
    const lastVoice = localStorage.getItem('snaptoai_tts_voice') || 'Kore';
    const panel = document.createElement('div');
    voicePickerEl = panel;
    panel.style.cssText = 'animation:vpIn 0.25s cubic-bezier(0.16,1,0.3,1) both;margin-top:8px;background:rgba(8,8,16,0.96);border:1px solid rgba(255,255,255,0.1);border-radius:18px;padding:14px 14px 12px;backdrop-filter:blur(20px);box-shadow:0 24px 64px rgba(0,0,0,0.6),0 0 0 1px rgba(255,255,255,0.04) inset;';

    const hdr = document.createElement('div');
    hdr.style.cssText = 'font-size:9.5px;font-weight:800;letter-spacing:0.18em;color:rgba(255,255,255,0.35);text-transform:uppercase;margin-bottom:10px;padding-left:2px;';
    hdr.textContent = '✦ Choose Your Voice';
    panel.appendChild(hdr);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px;';

    TTS_VOICES.forEach(v => {
      const isActive = v.name === lastVoice;
      const card = document.createElement('button');
      card.className = 'vp-card';
      card.style.cssText = `background:${isActive ? `rgba(${_hexRgb(v.color)},0.18)` : 'rgba(255,255,255,0.04)'};border:1px solid ${isActive ? v.color : 'rgba(255,255,255,0.08)'};border-radius:13px;padding:11px 6px 10px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:5px;color:#fff;box-shadow:${isActive ? `0 0 16px rgba(${_hexRgb(v.color)},0.25)` : 'none'};`;
      const bars = v.delays.map((d, i) => {
        const h = [6, 10, 14, 10, 6][i];
        return `<div class="vp-bar" style="width:2.5px;height:${h}px;background:${v.color};border-radius:2px;opacity:${isActive ? 1 : 0.5};animation-delay:${d};"></div>`;
      }).join('');
      card.innerHTML = `
        <div style="font-size:20px;line-height:1;margin-bottom:1px;">${v.emoji}</div>
        <div style="font-size:11px;font-weight:800;letter-spacing:0.01em;">${v.name}</div>
        <div style="font-size:8.5px;opacity:0.45;text-align:center;line-height:1.3;padding:0 2px;">${v.desc}</div>
        <div class="${isActive ? 'vp-playing' : ''}" style="display:flex;gap:2px;align-items:flex-end;height:16px;margin-top:2px;">${bars}</div>
      `;
      if (isActive) card.style.transform = 'translateY(-2px)';
      card.addEventListener('mouseenter', () => {
        card.style.background = `rgba(${_hexRgb(v.color)},0.18)`;
        card.style.borderColor = v.color;
        card.style.boxShadow = `0 0 16px rgba(${_hexRgb(v.color)},0.25)`;
      });
      card.addEventListener('mouseleave', () => {
        if (v.name !== (localStorage.getItem('snaptoai_tts_voice') || 'Kore')) {
          card.style.background = 'rgba(255,255,255,0.04)';
          card.style.borderColor = 'rgba(255,255,255,0.08)';
          card.style.boxShadow = 'none';
        }
      });
      card.addEventListener('click', () => {
        localStorage.setItem('snaptoai_tts_voice', v.name);
        panel.remove(); voicePickerEl = null;
        onSelect(v.name);
      });
      grid.appendChild(card);
    });

    panel.appendChild(grid);
    // Insert right after the actions bar
    actions.after(panel);
  }

  function _hexRgb(hex) {
    return [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)).join(',');
  }

  // Split text into small chunks (~280 chars) on sentence boundaries so the
  // first chunk generates fast and starts playing while the rest are prepared.
  function splitIntoChunks(str, maxLen = 280) {
    const sentences = str.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [str];
    const chunks = [];
    let cur = '';
    for (const s of sentences) {
      let piece = s.trim();
      if (!piece) continue;
      // Hard-split any single sentence longer than maxLen
      while (piece.length > maxLen) {
        if (cur) { chunks.push(cur); cur = ''; }
        chunks.push(piece.slice(0, maxLen));
        piece = piece.slice(maxLen);
      }
      if (!cur) {
        cur = piece;
      } else if ((cur + ' ' + piece).length > maxLen) {
        chunks.push(cur);
        cur = piece;
      } else {
        cur = cur + ' ' + piece;
      }
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks;
  }

  // Generate one chunk's audio and return an object-URL. Tries the newest TTS
  // model first, then falls back; pins the working model on the session.
  async function generateChunkAudio(chunkText, voiceName, apiKey, session) {
    const styled = `In a natural, warm, conversational pace: ${chunkText}`;
    const models = session.workingModel
      ? [session.workingModel]
      : [MODELS.ttsPrimary, MODELS.ttsFallback];
    let lastErr = '';
    for (const model of models) {
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            signal: session.controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: styled }] }],
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
              }
            })
          }
        );
        if (!resp.ok) { lastErr = `api_error_${resp.status}`; continue; }
        const data = await resp.json();
        const part = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (!part?.data) { lastErr = 'no_audio_data'; continue; }

        const mimeType = (part.mimeType || '').toLowerCase();
        const rawBytes = Uint8Array.from(atob(part.data), c => c.charCodeAt(0));
        let audioBlob;
        if (mimeType.includes('pcm') || mimeType.startsWith('audio/l16') || mimeType.startsWith('audio/l-16') || mimeType === '') {
          const sr = 24000, ch = 1, bps = 16;
          const hdr = new ArrayBuffer(44); const dv = new DataView(hdr);
          const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
          ws(0,'RIFF'); dv.setUint32(4, 36 + rawBytes.byteLength, true); ws(8,'WAVE'); ws(12,'fmt ');
          dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
          dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * bps / 8, true);
          dv.setUint16(32, ch * bps / 8, true); dv.setUint16(34, bps, true);
          ws(36,'data'); dv.setUint32(40, rawBytes.byteLength, true);
          audioBlob = new Blob([hdr, rawBytes], { type: 'audio/wav' });
        } else {
          audioBlob = new Blob([rawBytes], { type: mimeType });
        }
        session.workingModel = model;
        return URL.createObjectURL(audioBlob);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastErr = e.message || 'err';
      }
    }
    throw new Error(lastErr || 'tts_failed');
  }

  function playUrl(url, session) {
    return new Promise((resolve) => {
      if (session.stopped) { resolve(); return; }
      const audio = new Audio(url);
      session.audio = audio;
      const done = () => resolve();
      audio.onended = done;
      audio.onerror = done;
      // Resolve promptly if the session is aborted mid-playback
      session.controller.signal.addEventListener('abort', done, { once: true });
      audio.play().catch(done);
    });
  }

  async function runTts(voiceName) {
    const cleanText = text
      .replace(/```[\s\S]*?```/g, ' code block ')
      .replace(/[#*_~`>|]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleanText) return;

    readBtn.textContent = '⏳ Generating…';
    readBtn.disabled = false; // keep clickable so Stop works immediately

    // Claim the session synchronously (before any await) so a second click
    // always maps to Stop, never a concurrent second read.
    const session = { stopped: false, controller: new AbortController(), audio: null, urls: [], workingModel: null };
    ttsSession = session;

    const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
    if (session.stopped) return; // user hit Stop during key fetch
    const apiKey = keyResult.geminiApiKey;

    const chunks = splitIntoChunks(cleanText.slice(0, 6000));
    if (!chunks.length) { if (ttsSession === session) stopTts(); return; }

    // No key → instant browser-voice fallback for the whole text
    if (!apiKey) {
      readBtn.textContent = '⏹ Stop';
      speakText(cleanText.slice(0, 2000));
      const checkStopped = setInterval(() => {
        if (!synth.speaking) { clearInterval(checkStopped); if (ttsSession === session) stopTts(); }
      }, 500);
      return;
    }

    // Producer: generate chunks ahead of playback (bounded look-ahead).
    // Each prefetched promise is rejection-safe (resolves to null on
    // abort/failure) and revokes its URL if the session was stopped meanwhile.
    const PREFETCH = 2;
    const urlPromises = new Array(chunks.length).fill(null);
    let nextToGen = 0;
    const generateUpTo = (target) => {
      while (nextToGen <= target && nextToGen < chunks.length) {
        const idx = nextToGen++;
        urlPromises[idx] = generateChunkAudio(chunks[idx], voiceName, apiKey, session)
          .then(url => {
            if (session.stopped) { try { URL.revokeObjectURL(url); } catch (e) {} return null; }
            session.urls.push(url);
            return url;
          })
          .catch(() => null); // swallow AbortError / failures; consumer handles null
      }
    };
    generateUpTo(PREFETCH);

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (session.stopped) break;
        const url = await urlPromises[i];
        if (session.stopped) break;
        if (!url) {
          // First chunk failed (not a Stop) → fall back to instant browser voice
          if (i === 0) {
            console.warn('[SnapToAI TTS] First chunk failed, using browser speech');
            readBtn.textContent = '⏹ Stop';
            speakText(cleanText.slice(0, 2000));
            const checkStopped = setInterval(() => {
              if (!synth.speaking) { clearInterval(checkStopped); if (ttsSession === session) stopTts(); }
            }, 500);
            return;
          }
          continue; // skip a failed middle chunk, keep going
        }
        readBtn.textContent = '⏹ Stop';
        readBtn.disabled = false;
        await playUrl(url, session);
        generateUpTo(i + 1 + PREFETCH); // keep the buffer filled
      }
    } finally {
      if (ttsSession === session) stopTts();
    }
  }

  readBtn.addEventListener('click', () => {
    if (ttsSession) { stopTts(); return; }
    const savedVoice = localStorage.getItem('snaptoai_tts_voice');
    if (savedVoice) {
      // Already has a preferred voice — start immediately
      runTts(savedVoice);
    } else {
      // First time — show picker so they can choose
      showVoicePicker((voiceName) => runTts(voiceName));
    }
  });

  // Small "change voice" chevron button next to Read
  const changeVoiceBtn = document.createElement('button');
  changeVoiceBtn.title = 'Change voice';
  changeVoiceBtn.textContent = '▾';
  changeVoiceBtn.style.cssText = 'background:none;border:none;color:#9aa0a6;cursor:pointer;font-size:13px;padding:0 2px;line-height:1;vertical-align:middle;margin-left:1px;';
  changeVoiceBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (ttsSession) stopTts();
    showVoicePicker((voiceName) => runTts(voiceName));
  });
  readBtn.after(changeVoiceBtn);
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
  doc.text('Aion Chat Export', margin, yPosition);
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
  doc.text('Generated by Aion', margin, pageHeight - 10);
  
  // Generate filename with timestamp
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `Aion-Chat-${timestamp}.pdf`;
  
  // Direct download
  doc.save(filename);
}

// Clear chat
// Returns true when the prompt signals a brand-new app, not a patch/update.
function _isNewBuildIntent(prompt) {
  const p = prompt.toLowerCase().trim();
  // Patch/update signals — these clearly refer to the existing site
  if (/^(add |change |fix |update |remove |delete |edit |modify |tweak |adjust |make it|make the|make this|now |also |and |put |move |replace |switch |rename |colour|color |style |resize |convert |turn it|can you add|can you change|can you fix|can you update|can you remove|i want to add|i want to change)/.test(p)) return false;
  // New app signals — build/create/make + a new subject
  return /(build|create|make|design|generate|i want|i need|can you build|can you create|can you make|can you design).{0,50}(a |an |me a |new |different |another )/.test(p);
}

// ── Build Mode: intent classifier ─────────────────────────────────────────────
// Returns true  → proceed to build/patch immediately
// Returns false → route to conversational reply, don't build yet
function _isBuildInstruction(prompt, hasFiles) {
  const raw = prompt.toLowerCase().trim();

  // ── 1. Explicit short confirmations ───────────────────────────────────────
  const confirmRe = /^(yes|yeah|yep|yup|ok|okay|sure|go|do it|build it|make it|go ahead|confirm|correct|right|exactly|perfect|sounds good|do that|apply|apply it|yes please|please do|let'?s go|do it now|build now|build that|build this|go for it|proceed|approved|ship it|that works|looks good)[\s!.,]*$/;
  if (confirmRe.test(raw)) return true;

  // Strip polite / lead-in prefixes so "sure, do that", "yes ok build it",
  // "please go ahead" all peel down to their confirmation core.
  let p = raw;
  const prefixRe = /^(please|pls|plz|hey|ok|okay|yes|yeah|yep|yup|sure|alright|yo|so|now|also|and then|and|then|can you|could you|would you|will you|i want you to|i want to|i'?d like you to|i'?d like to|i would like to|i'?d love to|lets|let'?s|go ahead and|i need you to|i need to|i'?m gonna|gonna|just)[\s,]+/i;
  let _prev;
  do { _prev = p; p = p.replace(prefixRe, '').trim(); } while (p !== _prev);
  if (confirmRe.test(p)) return true;

  // ── 2. Direct build / create verbs at the start ───────────────────────────
  // "build me a shop", "create a landing page", "make me a portfolio", etc.
  // These are unambiguous — the user wants it built, not discussed.
  const directBuildRe = /^(build|create|make|design|generate|develop|code|write)\b.{5,}/i;
  if (directBuildRe.test(raw)) return true;

  // ── 3. Detailed spec prompt — has bullet points / dashes with real content ─
  // A prompt with 3+ lines starting with - or • is a specification, not a question.
  const bulletLines = (prompt.match(/^[\s]*[-•*]\s+.+/mg) || []).length;
  if (bulletLines >= 3) return true;

  // ── 4. Prompt contains price/product patterns (shop spec) ─────────────────
  // e.g. "Silver Moon Ring — $35" or "Product: $29.99"
  const hasPriceSpec = /\$\d+|\d+\s*(?:usd|gbp|eur)/i.test(prompt);
  if (hasPriceSpec && prompt.length > 80) return true;

  // ── 5. Post-build patch commands — clear action verbs on an existing site ──
  // These should always patch directly without requiring "build it" confirmation.
  const patchVerbRe = /^(change|update|replace|swap|add|remove|delete|fix|make|set|turn|switch|link|move|hide|show|rename|reorder|increase|decrease|adjust|edit|modify|put|use|apply|insert|convert|connect|enable|disable)\b/i;
  if (patchVerbRe.test(p) && p.length > 10) return true;

  // ── 6. Specific single-command patches ────────────────────────────────────
  const singlePatchRe = /\b(favicon|logo|background|color|colour|font|email|instagram|tiktok|twitter|facebook|paypal|stripe|price|button|menu|navbar|footer|hero|section|mobile|responsive|animation|copyright|social|link|icon)\b/i;
  if (singlePatchRe.test(raw) && p.length > 8 && p.length < 200) return true;

  // ── 7. Image attached — always treat as a build/patch action ──────────────
  if (hasFiles) return true;

  return false;
}

// ── Build Mode: conversational advisor ───────────────────────────────────────
// Called when the router decides the user is asking a question rather than
// giving a build instruction. This is a REAL multi-turn conversation: it sees
// the full chat history AND the current website HTML, so it can discuss the
// user's actual site specifically. The exchange is saved back to
// conversationHistory so the next build sees everything that was agreed on.
async function _buildModeChat(prompt, hasFiles, thread) {
  const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
  const apiKey = keyResult.geminiApiKey;
  if (!apiKey) { showGeminiModal(); return; }

  const responseBubble = addBubble('', 'ai');
  responseBubble.innerHTML = '<span style="color:#8899aa;font-size:13px;">thinking…</span>';

  // Give the advisor the real site so it can refer to actual sections/colors/text.
  // Use the un-swapped patch copy (no giant base64 blobs) and cap the length.
  let siteContext = '';
  const currentCode = _lastBuiltCodeForPatch || _lastBuiltCode || '';
  if (currentCode) {
    siteContext = '\n\nTHE USER\'S CURRENT WEBSITE (reference it specifically — real sections, colors, copy):\n\n' + currentCode.slice(0, 9000);
  }

  const systemText = currentCode
    ? `You are a friendly, expert web designer having a real back-and-forth conversation with a user about THEIR website (shown below). You are in planning/discussion mode — talk it through, do NOT build yet.

HOW TO TALK:
- Sound like a real designer chatting: natural, specific, warm. 2-4 sentences.
- Refer to the user's ACTUAL site — name the real sections, colors, and copy you see in the HTML below.
- If they uploaded an image but didn't say where it goes, ask exactly where: replace the hero, a new section, or the background?
- If their idea is vague, ask ONE sharp question and offer a concrete suggestion.
- Build on what was already said earlier in this conversation — don't repeat yourself.
- When you understand the plan, summarize the changes as bullet points (• one bullet per change, max 3) and tell them to say "do it" or "build it" to apply.
- NEVER output HTML, CSS, or code here — you are only talking.${siteContext}`
    : `You are a friendly, expert web designer helping a user plan a brand-new website from scratch. You are in planning/discussion mode — explore their vision, do NOT build yet.

HOW TO TALK:
- Sound like a real designer chatting: natural, enthusiastic, specific. 2-4 sentences.
- Ask about their goal, audience, style, and content — one clear question at a time.
- Offer concrete suggestions: colors, layout ideas, sections to include.
- If they uploaded an image, ask how they want it used: hero background, logo, product photo?
- Build on what was already said — don't repeat yourself.
- When you have a clear picture of what they want, summarize the plan in 2-3 bullet points and tell them to say "build it" or "do it" to start building.
- NEVER output HTML, CSS, or code here — you are only talking.`;

  // Rebuild the multi-turn contents from conversation history so the chat truly remembers.
  const contents = [];
  for (const msg of conversationHistory) {
    if (!msg || !msg.text) continue;
    contents.push({ role: msg.role === 'model' ? 'model' : 'user', parts: [{ text: msg.text }] });
  }
  const userParts = [];
  if (hasFiles && filesQueue.length > 0) {
    const imgFile = filesQueue.find(f => f.mimeType && f.mimeType.startsWith('image/'));
    if (imgFile) userParts.push({ inlineData: { mimeType: imgFile.mimeType, data: imgFile.data } });
  }
  userParts.push({ text: prompt || 'I uploaded an image — what do you think, and where should it go?' });
  contents.push({ role: 'user', parts: userParts });

  let reply = '';
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.chat}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemText }] },
          contents,
          generationConfig: { maxOutputTokens: 500, temperature: 0.8 }
        })
      }
    );
    const data = await res.json();
    reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!reply) {
      if (data.error) {
        reply = `⚠️ ${data.error.message || 'The AI could not respond — check your Gemini API key and quota in Settings.'}`;
      } else if (data.candidates?.[0]?.finishReason && data.candidates[0].finishReason !== 'STOP') {
        reply = `⚠️ The AI stopped early (${data.candidates[0].finishReason}). Try rephrasing your message.`;
      }
    }
  } catch (_e) {
    reply = '';
  }
  if (!reply) reply = "Tell me what you'd like to change and where it should go — then say \"build it\" and I'll apply it.";

  // Use marked.parse so ### headings, **bold**, lists etc. render properly.
  // Falls back to plain-text newline conversion if marked isn't loaded.
  const _chatReplyHtml = (typeof marked !== 'undefined')
    ? ((typeof DOMPurify !== 'undefined') ? DOMPurify.sanitize(marked.parse(reply)) : marked.parse(reply))
    : reply.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
  responseBubble.innerHTML = _chatReplyHtml;
  addBubbleActions(responseBubble, reply);

  // ── "Build it" quick-action button ────────────────────────────────────────
  // Remove any stale button from a previous AI turn before adding the new one.
  document.querySelectorAll('.build-it-btn').forEach(b => b.remove());
  const buildItBtn = document.createElement('button');
  buildItBtn.className = 'build-it-btn';
  buildItBtn.textContent = '▶ Build it';
  buildItBtn.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'gap:5px',
    'margin-top:10px',
    'padding:5px 14px',
    'background:linear-gradient(135deg,rgba(99,102,241,0.22),rgba(99,102,241,0.12))',
    'border:1px solid rgba(99,102,241,0.38)',
    'border-radius:8px',
    'color:#a5b4fc',
    'font-size:12px',
    'font-weight:500',
    'cursor:pointer',
    'transition:background 0.18s,border-color 0.18s,color 0.18s',
    'letter-spacing:0.02em'
  ].join(';');
  buildItBtn.addEventListener('mouseenter', () => {
    buildItBtn.style.background = 'linear-gradient(135deg,rgba(99,102,241,0.38),rgba(99,102,241,0.26))';
    buildItBtn.style.borderColor = 'rgba(99,102,241,0.65)';
    buildItBtn.style.color = '#c7d2fe';
  });
  buildItBtn.addEventListener('mouseleave', () => {
    buildItBtn.style.background = 'linear-gradient(135deg,rgba(99,102,241,0.22),rgba(99,102,241,0.12))';
    buildItBtn.style.borderColor = 'rgba(99,102,241,0.38)';
    buildItBtn.style.color = '#a5b4fc';
  });
  buildItBtn.addEventListener('click', () => {
    document.querySelectorAll('.build-it-btn').forEach(b => b.remove());
    const input = document.getElementById('chatInput');
    if (input) { input.value = 'build it'; handleSend(); }
  });
  responseBubble.appendChild(buildItBtn);

  // Persist BOTH sides so the conversation is genuinely multi-turn and the
  // eventual build inherits the full agreed-upon context.
  conversationHistory.push({ role: 'user', text: prompt || '[uploaded an image]' });
  conversationHistory.push({ role: 'model', text: reply });

  if (thread) thread.scrollTop = thread.scrollHeight;
}

// Shows an inline card asking the user whether to start fresh or update the current app.
function _showNewAppConfirmation(prompt, input) {
  const thread = document.getElementById('chatThread');
  const card = document.createElement('div');
  card.className = 'new-app-confirm';
  card.id = 'newAppConfirmCard';
  card.innerHTML =
    '<div class="new-app-confirm-title">🔄 Looks like a new app</div>' +
    '<div class="new-app-confirm-sub">You already have a built app. Do you want to start completely fresh, or update/extend the current one?</div>' +
    '<div class="new-app-confirm-btns">' +
      '<button class="new-app-confirm-btn fresh" id="nacBtnFresh">🆕 Start fresh</button>' +
      '<button class="new-app-confirm-btn update" id="nacBtnUpdate">✏️ Update current</button>' +
    '</div>';
  thread.appendChild(card);
  thread.scrollTop = thread.scrollHeight;

  document.getElementById('nacBtnFresh').addEventListener('click', () => {
    card.remove();
    document.getElementById('_resumeBuildBanner')?.remove();
    // Wipe all build state so the next send is treated as a first build
    _lastBuiltCode = '';
    _lastBuiltCodeForPatch = '';
    _committedMediaMap = {};
    const _nac_imgMap = document.getElementById('imageMapPanel');
    if (_nac_imgMap) _nac_imgMap.style.display = 'none';
    _buildBodyHtml = '';
    _buildStyleCss = '';
    _buildScriptJs = '';
    conversationHistory = [];
    try { chrome.storage.local.remove(['snaptoai_built_code', 'snaptoai_build_body', 'snaptoai_build_style', 'snaptoai_build_script']); } catch(e) { console.warn('[SnapToAI] Build cache clear failed:', e?.message || e); }
    _updateBuildInput();
    const w = document.getElementById('previewWrapper');
    if (w) w.style.display = 'none';
    const iframe = document.getElementById('livePreview');
    if (iframe) iframe.style.display = 'none';
    input.value = prompt;
    handleSend();
  });

  document.getElementById('nacBtnUpdate').addEventListener('click', () => {
    card.remove();
    // Set the one-time bypass flag so handleSend() skips the new-app guard on
    // this call (the guard would otherwise see the same prompt and loop the dialog).
    // handleSend() is async but its guard check is synchronous, so resetting the
    // flag right after the call is safe — the check already ran by that point.
    _skipNewAppGuard = true;
    input.value = prompt;
    handleSend();
    _skipNewAppGuard = false;
  });
}

// ── Shop Setup Panel ───────────────────────────────────────────────────────
// Shown before a fresh shop build when no real payment info is in the prompt.
// Collects shop name, product list, and payment links — then triggers handleSend
// with a fully-enriched prompt so the built HTML works immediately, no editing.
function _showShopSetupPanel(originalPrompt, input) {
  const thread = document.getElementById('chatThread');
  const card = document.createElement('div');
  card.className = 'shop-setup-panel';
  card.id = 'shopSetupPanel';
  card.innerHTML = `
    <div class="ssp-title">🛒 Quick Shop Setup</div>
    <div class="ssp-sub">Tell me your products and payment info — I'll build everything ready to use, no editing needed.</div>

    <div class="ssp-section-label">Your products</div>
    <div id="sspProductRows">
      <div class="ssp-product-row">
        <input class="ssp-input ssp-prod-name" placeholder="Product name (e.g. Handmade Candle)" />
        <input class="ssp-input ssp-prod-price" placeholder="Price (e.g. 25)" type="number" min="0" step="0.01" style="width:90px;flex-shrink:0;" />
      </div>
      <div class="ssp-product-row">
        <input class="ssp-input ssp-prod-name" placeholder="Product name" />
        <input class="ssp-input ssp-prod-price" placeholder="Price" type="number" min="0" step="0.01" style="width:90px;flex-shrink:0;" />
      </div>
      <div class="ssp-product-row">
        <input class="ssp-input ssp-prod-name" placeholder="Product name" />
        <input class="ssp-input ssp-prod-price" placeholder="Price" type="number" min="0" step="0.01" style="width:90px;flex-shrink:0;" />
      </div>
    </div>
    <button class="ssp-add-row" id="sspAddRow">+ Add another product</button>

    <div class="ssp-section-label" style="margin-top:14px;">PayPal (recommended — free, instant)</div>
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="color:#9aa0a6;font-size:13px;white-space:nowrap;">paypal.me/</span>
      <input class="ssp-input" id="sspPaypal" placeholder="YourUsername" style="flex:1;" />
    </div>

    <div class="ssp-section-label" style="margin-top:12px;">Stripe Payment Link <span style="font-weight:400;color:#9aa0a6;font-size:11px;">(optional — create at dashboard.stripe.com → Payment Links)</span></div>
    <input class="ssp-input" id="sspStripe" placeholder="https://buy.stripe.com/..." style="width:100%;box-sizing:border-box;" />

    <div class="ssp-btns">
      <button class="ssp-btn-build" id="sspBtnBuild">🚀 Build My Shop</button>
      <button class="ssp-btn-skip" id="sspBtnSkip">Skip — build with placeholders</button>
    </div>
  `;
  thread.appendChild(card);
  thread.scrollTop = thread.scrollHeight;

  document.getElementById('sspAddRow').addEventListener('click', () => {
    const rows = document.getElementById('sspProductRows');
    const row = document.createElement('div');
    row.className = 'ssp-product-row';
    row.innerHTML = `
      <input class="ssp-input ssp-prod-name" placeholder="Product name" />
      <input class="ssp-input ssp-prod-price" placeholder="Price" type="number" min="0" step="0.01" style="width:90px;flex-shrink:0;" />
    `;
    rows.appendChild(row);
  });

  document.getElementById('sspBtnBuild').addEventListener('click', () => {
    const names  = [...document.querySelectorAll('#shopSetupPanel .ssp-prod-name')].map(i => i.value.trim()).filter(Boolean);
    const prices = [...document.querySelectorAll('#shopSetupPanel .ssp-prod-price')].map(i => i.value.trim());
    const paypal = (document.getElementById('sspPaypal').value || '').trim();
    const stripe = (document.getElementById('sspStripe').value || '').trim();

    const products = names.map((n, i) => {
      const p = parseFloat(prices[i]);
      return `  • ${n}${!isNaN(p) ? ` — $${p.toFixed(2)}` : ''}`;
    }).join('\n');

    let enriched = originalPrompt;
    if (products) {
      enriched += `\n\nSHOP SETUP — use EXACTLY these values (do not invent different ones):\nProducts:\n${products}`;
    }
    if (paypal) {
      enriched += `\nPayPal: https://paypal.me/${paypal.replace(/^paypal\.me\//i, '')}`;
      enriched += `\n— Use this exact PayPal URL on every "Pay with PayPal" button. No placeholder.`;
    }
    if (stripe && stripe.includes('stripe')) {
      enriched += `\nStripe: ${stripe}`;
      enriched += `\n— Use this exact Stripe link on every "Buy Now" and "Checkout" button. No placeholder.`;
    }
    if (!paypal && !stripe) {
      enriched += `\n— No payment links provided yet. Use placeholder text but add clear instructions in HTML comments explaining how to replace them.`;
    }

    card.remove();
    _skipShopSetup = true;
    input.value = enriched;
    handleSend();
  });

  document.getElementById('sspBtnSkip').addEventListener('click', () => {
    card.remove();
    _skipShopSetup = true;
    input.value = originalPrompt;
    handleSend();
  });
}

// ── Build plan confirmation card ───────────────────────────────────────────
// Shown before a build starts when conversationHistory has ≥ 2 full turns.
// Makes one fast Gemini call to summarise the agreed plan as 2-3 bullet points,
// then renders a card with a Confirm button. Tapping Confirm sets the one-time
// bypass flag and re-submits the original prompt into handleSend().
async function _showBuildConfirmation(prompt) {
  const thread = document.getElementById('chatThread');
  const input  = document.getElementById('chatInput');

  // Show the user bubble so they see what they typed.
  addBubble(prompt, 'user');

  // Placeholder AI bubble while we fetch the summary.
  const responseBubble = addBubble('', 'ai');
  responseBubble.innerHTML = '<span style="color:#8899aa;font-size:13px;">Summarising plan…</span>';
  thread.scrollTop = thread.scrollHeight;

  const keyResult = await chrome.storage.local.get(['geminiKey']);
  const apiKey = keyResult.geminiKey;

  let bullets = [];
  if (apiKey) {
    try {
      // Rebuild history for the summary call.
      const contents = [];
      for (const msg of conversationHistory) {
        if (!msg || !msg.text) continue;
        contents.push({ role: msg.role === 'model' ? 'model' : 'user', parts: [{ text: msg.text }] });
      }
      // The user's build trigger message.
      contents.push({ role: 'user', parts: [{ text: prompt }] });

      const summarySystem = `You are a concise project planner. Based on the conversation above, output EXACTLY 2-3 bullet points (one line each, starting with "•") that summarise what you are about to build or change. Each bullet must be a COMPLETE sentence — do not cut off mid-word. No intro sentence, no explanation — only the bullet lines.`;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.chat}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: summarySystem }] },
            contents,
            generationConfig: { maxOutputTokens: 400, temperature: 0.3 }
          })
        }
      );
      const data = await res.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      // Parse lines that start with • (or - or *) as bullet points.
      bullets = raw.split('\n')
        .map(l => l.trim())
        .filter(l => l.match(/^[•\-\*]/))
        .map(l => l.replace(/^[•\-\*]\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 3);
    } catch (_e) {
      bullets = [];
    }
  }

  // Fall back to a generic bullet if the summary call failed.
  if (!bullets.length) {
    bullets = ['Apply the changes discussed in this conversation'];
  }

  // Live-editable copy so Confirm can read the current values.
  const editedBullets = bullets.slice();

  function renderCard() {
    const bulletsHtml = editedBullets.map((b, i) => `
      <div data-bullet-idx="${i}" style="
        display:flex;align-items:flex-start;gap:6px;
        margin:4px 0;padding:4px 6px;border-radius:6px;
        cursor:pointer;transition:background 0.15s;
        color:#b8c8dc;font-size:13px;line-height:1.55;
      " class="snap-bullet-row">
        <span style="color:#6366f1;flex-shrink:0;margin-top:1px;">•</span>
        <span class="snap-bullet-text" style="flex:1;">${b.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>
        <span class="snap-bullet-edit-icon" title="Edit" style="
          flex-shrink:0;opacity:0;font-size:11px;color:#6366f1;
          transition:opacity 0.15s;margin-top:2px;user-select:none;
        ">✏️</span>
      </div>`).join('');

    responseBubble.innerHTML = `
      <div style="font-size:13px;color:#e8eef4;line-height:1.7;">
        <div style="font-weight:600;margin-bottom:6px;color:#c7d2fe;">Here's what I'll do:</div>
        <div id="snapBulletList" style="margin:0 0 4px 0;">${bulletsHtml}</div>
        <button id="snapAddStepBtn" style="
          display:inline-flex;align-items:center;gap:4px;
          background:none;border:none;padding:2px 6px;margin:0 0 8px 0;
          color:#6366f1;font-size:12px;cursor:pointer;
          opacity:0.75;transition:opacity 0.15s;
        ">+ Add step</button>
        <div style="font-size:11px;color:#6366f1;margin-bottom:10px;opacity:0.8;">Tap any line to edit it</div>
        <button id="buildConfirmBtn" style="
          display:inline-flex;align-items:center;gap:5px;
          padding:5px 14px;
          background:linear-gradient(135deg,rgba(99,102,241,0.28),rgba(99,102,241,0.16));
          border:1px solid rgba(99,102,241,0.48);
          border-radius:8px;
          color:#a5b4fc;font-size:12px;font-weight:600;
          cursor:pointer;letter-spacing:0.02em;
          transition:background 0.18s,border-color 0.18s,color 0.18s;
        ">✓ Confirm — build it</button>
      </div>`;

    // Hover glow for bullet rows + show/hide pencil icon.
    responseBubble.querySelectorAll('.snap-bullet-row').forEach(row => {
      const icon = row.querySelector('.snap-bullet-edit-icon');
      row.addEventListener('mouseenter', () => {
        row.style.background = 'rgba(99,102,241,0.10)';
        if (icon) icon.style.opacity = '1';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = '';
        if (icon) icon.style.opacity = '0';
      });

      // Click → replace the row with an inline input.
      row.addEventListener('click', () => {
        const idx = parseInt(row.dataset.bulletIdx, 10);
        const currentText = editedBullets[idx];
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = currentText;
        inp.style.cssText = `
          width:100%;box-sizing:border-box;
          background:rgba(99,102,241,0.10);
          border:1px solid rgba(99,102,241,0.50);
          border-radius:5px;padding:3px 7px;
          color:#e8eef4;font-size:13px;font-family:inherit;
          outline:none;
        `;

        function commitEdit() {
          const val = inp.value.trim();
          if (val) editedBullets[idx] = val;
          renderCard();
          attachConfirmBtn();
        }

        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
          if (e.key === 'Escape') { renderCard(); attachConfirmBtn(); }
        });
        inp.addEventListener('blur', commitEdit);

        // Replace the row with the input.
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;align-items:center;gap:6px;margin:4px 0;padding:4px 6px;';
        const bullet = document.createElement('span');
        bullet.textContent = '•';
        bullet.style.cssText = 'color:#6366f1;flex-shrink:0;';
        wrapper.appendChild(bullet);
        wrapper.appendChild(inp);
        row.replaceWith(wrapper);
        inp.focus();
        inp.select();
      });
    });

    // "+ Add step" button — appends a blank editable bullet at the bottom.
    const addStepBtn = responseBubble.querySelector('#snapAddStepBtn');
    if (addStepBtn) {
      addStepBtn.addEventListener('mouseenter', () => { addStepBtn.style.opacity = '1'; });
      addStepBtn.addEventListener('mouseleave', () => { addStepBtn.style.opacity = '0.75'; });
      addStepBtn.addEventListener('click', () => {
        const bulletList = responseBubble.querySelector('#snapBulletList');
        if (!bulletList) return;

        const inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = 'Describe the step…';
        inp.style.cssText = `
          width:100%;box-sizing:border-box;
          background:rgba(99,102,241,0.10);
          border:1px solid rgba(99,102,241,0.50);
          border-radius:5px;padding:3px 7px;
          color:#e8eef4;font-size:13px;font-family:inherit;
          outline:none;
        `;

        let committed = false;
        function commitNew() {
          if (committed) return;
          committed = true;
          const val = inp.value.trim();
          if (val) editedBullets.push(val);
          renderCard();
          attachConfirmBtn();
        }

        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); commitNew(); }
          if (e.key === 'Escape') { renderCard(); attachConfirmBtn(); }
        });
        inp.addEventListener('blur', commitNew);

        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;align-items:center;gap:6px;margin:4px 0;padding:4px 6px;';
        const bullet = document.createElement('span');
        bullet.textContent = '•';
        bullet.style.cssText = 'color:#6366f1;flex-shrink:0;';
        wrapper.appendChild(bullet);
        wrapper.appendChild(inp);
        bulletList.appendChild(wrapper);

        // Hide the add-step button while the input is open.
        addStepBtn.style.display = 'none';

        inp.focus();
      });
    }
  }

  function attachConfirmBtn() {
    const confirmBtn = responseBubble.querySelector('#buildConfirmBtn');
    if (!confirmBtn) return;
    confirmBtn.addEventListener('mouseenter', () => {
      confirmBtn.style.background = 'linear-gradient(135deg,rgba(99,102,241,0.44),rgba(99,102,241,0.30))';
      confirmBtn.style.borderColor = 'rgba(99,102,241,0.70)';
      confirmBtn.style.color = '#c7d2fe';
    });
    confirmBtn.addEventListener('mouseleave', () => {
      confirmBtn.style.background = 'linear-gradient(135deg,rgba(99,102,241,0.28),rgba(99,102,241,0.16))';
      confirmBtn.style.borderColor = 'rgba(99,102,241,0.48)';
      confirmBtn.style.color = '#a5b4fc';
    });
    confirmBtn.addEventListener('click', () => {
      // Build the final prompt: original + any edited bullet corrections.
      const bulletSummary = editedBullets.map(b => `• ${b}`).join('\n');
      const finalPrompt = `${prompt}\n\n[Plan to execute:\n${bulletSummary}]`;
      responseBubble.remove();
      _skipBuildConfirmation = true;
      if (input) { input.value = finalPrompt; }
      handleSend();
    });
  }

  renderCard();
  attachConfirmBtn();

  thread.scrollTop = thread.scrollHeight;
}
// ── End build plan confirmation card ──────────────────────────────────────

async function clearChat() {
  // Archive the current conversation before wiping it
  await saveNamedChat();
  currentChatId = _generateChatId();

  const thread = document.getElementById('chatThread');
  thread.innerHTML = '';
  const lbl = document.createElement('span');
  lbl.id = 'modeLabel';
  thread.appendChild(lbl);
  updateModeLabel(currentAiMode);
  conversationHistory = [];
  saveChatHistoryToLocal();

  // Purge build cache so new builds start from a clean slate — not the previous
  // site. Without this the AI gets the old HTML as context and tries to merge
  // rather than starting fresh, producing "ghost" sites from prior sessions.
  document.getElementById('_resumeBuildBanner')?.remove();
  _lastBuiltCode = '';
  _lastBuiltCodeForPatch = '';
  _committedMediaMap = {};
  const _clr_imgMap = document.getElementById('imageMapPanel');
  if (_clr_imgMap) _clr_imgMap.style.display = 'none';
  try { chrome.storage.local.remove(['snaptoai_built_code']); } catch(e) {}
  _updateBuildInput();

  // Hide the live preview since there is nothing built in this session
  const w = document.getElementById('previewWrapper');
  if (w) w.style.display = 'none';
  const iframe = document.getElementById('livePreview');
  if (iframe) iframe.style.display = 'none';
}

function buildChatHistorySnapshot() {
  return {
    ts: Date.now(),
    conversationHistory: conversationHistory.slice(-200),
    chatHtml: document.getElementById('chatThread')?.innerHTML || ''
  };
}

async function saveChatHistoryToLocal() {
  try {
    if (!chrome?.storage?.local) return;
    const result = await chrome.storage.local.get([CHAT_HISTORY_STORAGE_KEY]);
    const all = Array.isArray(result[CHAT_HISTORY_STORAGE_KEY]) ? result[CHAT_HISTORY_STORAGE_KEY] : [];
    const next = [buildChatHistorySnapshot(), ...all.filter(item => item && item.chatHtml)].slice(0, CHAT_HISTORY_MAX_ITEMS);
    await chrome.storage.local.set({ [CHAT_HISTORY_STORAGE_KEY]: next });
  } catch (e) {}
}

function scheduleChatHistorySave() {
  if (chatHistorySaveTimer) clearTimeout(chatHistorySaveTimer);
  chatHistorySaveTimer = setTimeout(() => {
    saveChatHistoryToLocal();
  }, 400);
  scheduleNamedChatSave();
}

async function restoreLastChatHistory() {
  try {
    if (!chrome?.storage?.local) return;
    const result = await chrome.storage.local.get([CHAT_HISTORY_STORAGE_KEY]);
    const items = Array.isArray(result[CHAT_HISTORY_STORAGE_KEY]) ? result[CHAT_HISTORY_STORAGE_KEY] : [];
    const last = items.find(item => item && item.chatHtml);
    if (!last) return;
    const thread = document.getElementById('chatThread');
    if (!thread || thread.querySelector('.chat-bubble')) return;
    thread.innerHTML = last.chatHtml;
    conversationHistory = Array.isArray(last.conversationHistory) ? last.conversationHistory : conversationHistory;
  } catch (e) {}
}

// ── Named Chat History ─────────────────────────────────────────────────────
function _generateChatId() {
  return 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function _extractChatTitle(history) {
  const first = (history || []).find(m => m.role === 'user');
  if (!first) return 'New conversation';
  const text = (first.text || '').replace(/\n/g, ' ').trim();
  return text.length > 65 ? text.slice(0, 62) + '…' : text || 'New conversation';
}

function _histEscapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function saveNamedChat() {
  if (!conversationHistory.length) return;
  if (!currentChatId) currentChatId = _generateChatId();
  try {
    const result = await chrome.storage.local.get([NAMED_CHATS_KEY]);
    const chats = Array.isArray(result[NAMED_CHATS_KEY]) ? result[NAMED_CHATS_KEY] : [];
    const idx = chats.findIndex(c => c.id === currentChatId);
    const entry = {
      id: currentChatId,
      title: _extractChatTitle(conversationHistory),
      date: Date.now(),
      conversationHistory: conversationHistory.slice(-200),
      chatHtml: document.getElementById('chatThread')?.innerHTML || '',
      builtCode: _lastBuiltCode || ''
    };
    if (idx >= 0) chats[idx] = entry;
    else chats.unshift(entry);
    await chrome.storage.local.set({ [NAMED_CHATS_KEY]: chats.slice(0, MAX_NAMED_CHATS) });
  } catch (e) {}
}

function scheduleNamedChatSave() {
  if (namedChatSaveTimer) clearTimeout(namedChatSaveTimer);
  namedChatSaveTimer = setTimeout(saveNamedChat, 600);
}

async function deleteNamedChat(id) {
  try {
    const result = await chrome.storage.local.get([NAMED_CHATS_KEY]);
    const chats = (Array.isArray(result[NAMED_CHATS_KEY]) ? result[NAMED_CHATS_KEY] : []).filter(c => c.id !== id);
    await chrome.storage.local.set({ [NAMED_CHATS_KEY]: chats });
    if (currentChatId === id) {
      currentChatId = _generateChatId();
      conversationHistory = [];
      const thread = document.getElementById('chatThread');
      if (thread) { thread.innerHTML = ''; const lbl2 = document.createElement('span'); lbl2.id = 'modeLabel'; thread.appendChild(lbl2); updateModeLabel(currentAiMode); }
    }
    openHistoryPanel();
  } catch (e) {}
}

async function openHistoryPanel() {
  try {
    const result = await chrome.storage.local.get([NAMED_CHATS_KEY]);
    const chats = Array.isArray(result[NAMED_CHATS_KEY]) ? result[NAMED_CHATS_KEY] : [];
    _renderHistoryList(chats);
  } catch (e) { _renderHistoryList([]); }
  document.getElementById('histPanel')?.classList.add('open');
  document.getElementById('histOverlay')?.classList.add('open');
  document.getElementById('histBtn')?.classList.add('active');
}

function closeHistoryPanel() {
  document.getElementById('histPanel')?.classList.remove('open');
  document.getElementById('histOverlay')?.classList.remove('open');
  document.getElementById('histBtn')?.classList.remove('active');
}

function _renderHistoryList(chats) {
  const list = document.getElementById('histList');
  if (!list) return;
  if (!chats.length) {
    list.innerHTML = '<div class="hist-empty"><div class="hist-empty-icon">💬</div>No saved chats yet.<br>Start talking and your<br>conversations will appear here.</div>';
    return;
  }
  const today = new Date();
  list.innerHTML = chats.map(c => {
    const d = new Date(c.date);
    const sameYear = d.getFullYear() === today.getFullYear();
    const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
    const isActive = c.id === currentChatId;
    return `<div class="hist-item${isActive ? ' active' : ''}" data-id="${c.id}">
      <div class="hist-item-body">
        <div class="hist-item-title">${_histEscapeHtml(c.title)}</div>
        <div class="hist-item-date">${dateStr}</div>
      </div>
      <button class="hist-del" data-id="${c.id}" title="Delete this chat">🗑</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.hist-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.hist-del')) return;
      _restoreNamedChat(el.dataset.id);
    });
  });
  list.querySelectorAll('.hist-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deleteNamedChat(btn.dataset.id);
    });
  });
}

async function _restoreNamedChat(id) {
  try {
    const result = await chrome.storage.local.get([NAMED_CHATS_KEY]);
    const chats = Array.isArray(result[NAMED_CHATS_KEY]) ? result[NAMED_CHATS_KEY] : [];
    const chat = chats.find(c => c.id === id);
    if (!chat) return;
    currentChatId = chat.id;
    conversationHistory = Array.isArray(chat.conversationHistory) ? chat.conversationHistory : [];
    const thread = document.getElementById('chatThread');
    if (thread) {
      thread.innerHTML = chat.chatHtml || '';
      setTimeout(() => thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' }), 80);
    }
    // Restore the built website/app if this chat had one
    if (chat.builtCode) {
      _lastBuiltCode = chat.builtCode;
      try { chrome.storage.local.set({ snaptoai_built_code: _lastBuiltCode }); } catch(e) {}
      _showLivePreview(_lastBuiltCode);
    } else {
      _lastBuiltCode = '';
      const w = document.getElementById('previewWrapper');
      if (w) w.style.display = 'none';
    }
    closeHistoryPanel();
  } catch (e) {}
}

// Wire up history panel buttons (called after DOM ready)
function _initHistoryPanel() {
  document.getElementById('histBtn')?.addEventListener('click', () => {
    const panel = document.getElementById('histPanel');
    if (panel?.classList.contains('open')) closeHistoryPanel();
    else openHistoryPanel();
  });
  document.getElementById('histOverlay')?.addEventListener('click', closeHistoryPanel);
  document.getElementById('histNewBtn')?.addEventListener('click', () => {
    closeHistoryPanel();
    clearChat();
  });
}
// ── End Named Chat History ─────────────────────────────────────────────────

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

// Click-to-chat: tap any image in the left panel → it appears in the chat thread
function setupImagePanelClicks() {
  const previewContainer = document.querySelector('.image-preview');
  const hint = document.getElementById('imageSendHint');

  if (!previewContainer) return;

  // Use event delegation so it covers both single #previewImage and .grid-image items
  previewContainer.addEventListener('click', (e) => {
    const img = e.target.closest('img');
    if (!img || !img.src || img.src === window.location.href) return;

    const thread = document.getElementById('chatThread');
    if (!thread) return;

    // Build a user-style bubble with a thumbnail of the image
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble user';
    bubble.style.cssText = 'background:transparent;padding:0;border:none;display:flex;justify-content:flex-end;';

    const inner = document.createElement('div');
    inner.style.cssText = 'max-width:220px;border-radius:12px;overflow:hidden;border:1px solid rgba(0,217,255,0.3);box-shadow:0 4px 16px rgba(0,0,0,0.3);position:relative;';

    const thumb = document.createElement('img');
    thumb.src = img.src;
    thumb.style.cssText = 'width:100%;display:block;border-radius:12px;';

    const label = document.createElement('div');
    label.style.cssText = 'position:absolute;bottom:6px;left:0;right:0;text-align:center;font-size:10px;color:rgba(255,255,255,0.7);background:rgba(0,0,0,0.45);padding:3px 0;';
    label.textContent = '📸 sent to chat';

    inner.appendChild(thumb);
    inner.appendChild(label);
    bubble.appendChild(inner);
    thread.appendChild(bubble);
    thread.scrollTop = thread.scrollHeight;

    // Also stage it as the active image so the next message uses it
    if (img.src && !currentImages.includes(img.src)) {
      currentImages.unshift(img.src);
    }

    // Briefly highlight the image
    img.style.outline = '2px solid var(--st-accent, #00d9ff)';
    setTimeout(() => { img.style.outline = ''; }, 700);

    // Focus input so user can immediately type
    document.getElementById('chatInput')?.focus();
  });

  // Show the hint only when images are actually present
  if (hint) hint.style.display = currentImages.length > 0 ? '' : 'none';
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
document.getElementById('clearStagedBtn')?.addEventListener('click', clearStagedMedia);
document.getElementById('sendBtn')?.addEventListener('click', handleSend);
initVoiceInput();

const chatInput = document.getElementById('chatInput');
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (currentAiMode === 'broadcast') {
      document.getElementById('bsbGenBtn')?.click();
    } else {
      handleSend();
    }
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
_initHistoryPanel();

// Search grounding toggle
document.getElementById('searchToggleBtn')?.addEventListener('click', (e) => {
  searchGroundingEnabled = !searchGroundingEnabled;
  e.currentTarget.classList.toggle('tool-btn-active', searchGroundingEnabled);
  e.currentTarget.title = searchGroundingEnabled
    ? 'Google Search ON — responses grounded in live web data'
    : 'Search the web for real-time facts';
});

// ── Build Mode ────────────────────────────────────────────────────────────────
let _lastBuiltCode = '';
// Lightweight version of _lastBuiltCode for sending back to the AI during patch
// edits. Holds the pre-swap HTML (placeholders like __SNAP_VID_0__ still intact,
// NO base64 blobs). Sending base64 video/image data back to Gemini on every edit
// quickly exceeds the 1M-token limit.
let _lastBuiltCodeForPatch = '';
// All media that has already been committed into the current build, keyed by placeholder.
// e.g. { '__SNAP_VID_0__': 'data:video/mp4;base64,...', '__SNAP_IMG_0__': 'data:image/...;base64,...' }
// On every patch response the AI preserves the placeholder strings from _lastBuiltCodeForPatch,
// so we must re-apply ALL committed swaps — not just the ones pending in this request.
let _committedMediaMap = {};
// One-time flag: set by "Update current" button so handleSend() skips the new-app
// guard exactly once (avoids the infinite dialog loop when the same prompt re-enters).
let _skipNewAppGuard = false;
// One-time flag: set by "Build anyway" in the shop setup panel so handleSend()
// skips the shop setup intercept on the next call and goes straight to build.
let _skipShopSetup = false;
// One-time flag: set by the "Confirm" button in _showBuildConfirmation so the
// next handleSend() call skips the plan-preview card and goes straight to build.
let _skipBuildConfirmation = false;
// Base64 data URLs waiting to replace __SNAP_IMG_N__ placeholders after AI responds
let _pendingBuildImages = [];
// Short video files (webm/mp4) attached during a build patch — same placeholder approach
let _pendingBuildVideos = [];
// Audio files (mp3/wav/ogg) attached during a build patch — same placeholder approach
let _pendingBuildAudio = [];
// When true, the next build response is a continuation chunk — merge with _lastBuiltCode
let _continuationPending = false;
// Safety cap: stop auto-continuing after this many consecutive truncated responses
let _continuationCount = 0;
const _CONTINUATION_MAX = 5;

// Restore full build state from storage on popup load so staged builds and
// follow-up fix requests work correctly even after the popup is closed/reopened
chrome.storage.local.get([
  'snaptoai_built_code',
  'snaptoai_build_body',
  'snaptoai_build_style',
  'snaptoai_build_script'
], (res) => {
  if (res.snaptoai_built_code) {
    _lastBuiltCode = res.snaptoai_built_code;
    // If Build Mode is already active when the popup loads, immediately show the
    // loaded site so the user knows exactly what they are editing (prevents the
    // "AION instead of Lumio Store" confusion where a stale site silently loads).
    if (buildModeEnabled) {
      _showResumedBuildBanner(_lastBuiltCode);
      _showLivePreview(_lastBuiltCode);
    }
  }
  if (res.snaptoai_build_body)  _buildBodyHtml = res.snaptoai_build_body;
  if (res.snaptoai_build_style) _buildStyleCss  = res.snaptoai_build_style;
  if (res.snaptoai_build_script) _buildScriptJs = res.snaptoai_build_script;
});

// ── Image Map: visual thumbnail grid for images embedded in the build ─────
function _showImageMap() {
  const panel = document.getElementById('imageMapPanel');
  const grid  = document.getElementById('imageMapGrid');
  if (!panel || !grid) return;

  const imgEntries = Object.entries(_committedMediaMap)
    .filter(([k]) => k.startsWith('__SNAP_IMG_'))
    .sort((a, b) => {
      const na = parseInt((a[0].match(/\d+/) || ['0'])[0]);
      const nb = parseInt((b[0].match(/\d+/) || ['0'])[0]);
      return na - nb;
    });

  if (imgEntries.length === 0) { panel.style.display = 'none'; return; }

  panel.style.display = 'block';
  grid.innerHTML = '';

  imgEntries.forEach(([key, dataUrl], idx) => {
    const item = document.createElement('div');
    item.style.cssText = 'position:relative;flex-shrink:0;width:54px;';
    item.innerHTML = `
      <img src="${dataUrl}" style="width:54px;height:42px;object-fit:cover;border-radius:6px;border:1px solid rgba(255,160,50,0.22);display:block;" alt="Build image ${idx+1}">
      <div style="font-size:7.5px;color:rgba(255,160,50,0.5);text-align:center;margin-top:2px;font-family:monospace;letter-spacing:0.3px;">IMG ${idx + 1}</div>
      <button data-key="${key}" style="position:absolute;top:1px;right:1px;width:16px;height:16px;border-radius:50%;background:#ffa032;border:none;color:#000;font-size:10px;font-weight:900;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.55);" title="Replace this image">↺</button>
    `;
    item.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      _openImageReplacer(key, idx + 1);
    });
    grid.appendChild(item);
  });
}

function _openImageReplacer(key, num) {
  const modal      = document.getElementById('imageReplacerModal');
  const title      = document.getElementById('imageReplacerTitle');
  const snapSec    = document.getElementById('imageReplacerSnaps');
  const snapGrid   = document.getElementById('imageReplacerSnapGrid');
  const fileInput  = document.getElementById('imageReplacerFileInput');
  const uploadBtn  = document.getElementById('imageReplacerUploadBtn');
  if (!modal) return;

  if (title) title.textContent = `Replace Image ${num}`;

  // Populate screenshot thumbnails
  if (snapGrid) snapGrid.innerHTML = '';
  if (snapSec && snapGrid && Array.isArray(currentImages) && currentImages.length > 0) {
    snapSec.style.display = 'block';
    currentImages.slice(0, 8).forEach((dataUrl, i) => {
      const thumb = document.createElement('img');
      thumb.src   = dataUrl;
      thumb.style.cssText = 'width:56px;height:44px;object-fit:cover;border-radius:6px;border:2px solid transparent;cursor:pointer;transition:border-color 0.15s;display:block;';
      thumb.title = `Screenshot ${i + 1}`;
      thumb.addEventListener('click', () => {
        modal.style.display = 'none';
        _replaceImageInBuild(key, dataUrl);
      });
      thumb.addEventListener('mouseover', () => { thumb.style.borderColor = '#ffa032'; });
      thumb.addEventListener('mouseout',  () => { thumb.style.borderColor = 'transparent'; });
      snapGrid.appendChild(thumb);
    });
  } else if (snapSec) {
    snapSec.style.display = 'none';
  }

  // Upload from device
  if (uploadBtn && fileInput) {
    uploadBtn.onclick = () => fileInput.click();
    fileInput.onchange = (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (re) => {
        modal.style.display = 'none';
        _replaceImageInBuild(key, re.target.result);
        fileInput.value = '';
      };
      reader.readAsDataURL(file);
    };
  }

  modal.style.display = 'flex';
}

function _replaceImageInBuild(key, dataUrl) {
  if (!buildModeEnabled || !_lastBuiltCode) return;
  const mimeType = dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
  const data = (dataUrl.split(',')[1] || '').trim();
  if (!data) return;
  filesQueue.push({ name: 'replacement.jpg', mimeType, data });
  const input = document.getElementById('chatInput');
  if (input) {
    const imgNum = parseInt((key.match(/\d+/) || ['0'])[0]) + 1;
    input.value = `Replace image ${imgNum} (${key}) with the attached image. Keep all other content and design completely unchanged.`;
    document.getElementById('sendBtn')?.click();
  }
}

// ── Quick Fix Toolbar ──────────────────────────────────────────────────────

function _showQuickFixBar() {
  const bar = document.getElementById('quickFixBar');
  if (bar) bar.style.display = 'flex';
}

function _hideAllFixPanels() {
  ['pexelsFixPanel','colorFixPanel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

// ── 📸 Fix Images panel ────────────────────────────────────────────────────

function _openPexelsFixPanel() {
  _hideAllFixPanels();
  const panel = document.getElementById('pexelsFixPanel');
  const grid  = document.getElementById('pexelsFixGrid');
  if (!panel || !grid || !_lastBuiltCode) return;

  // Extract all unique Pexels photo IDs from the built HTML
  const re = /https:\/\/images\.pexels\.com\/photos\/(\d+)\/[^"'\s>)]+/g;
  const seen = new Set();
  const entries = []; // [{id, fullSrc, altText}]
  let m;
  const tmp = document.createElement('div');
  tmp.innerHTML = _lastBuiltCode;
  // Walk actual img elements to get alt text too
  tmp.querySelectorAll('img[src*="pexels.com"]').forEach(img => {
    const srcMatch = img.src.match(/photos\/(\d+)\//);
    if (!srcMatch) return;
    const id = srcMatch[1];
    if (seen.has(id)) return;
    seen.add(id);
    entries.push({ id, src: img.src, alt: img.alt || '' });
  });
  // Fallback: regex scan for any remaining Pexels URLs not in img tags
  while ((m = re.exec(_lastBuiltCode)) !== null) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({ id, src: m[0], alt: '' });
  }

  if (entries.length === 0) {
    panel.style.display = 'block';
    grid.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:10px;padding:8px;font-family:monospace;">No Pexels images found in this build.</div>';
    return;
  }

  grid.innerHTML = '';
  entries.forEach(({ id, src, alt }) => {
    const thumbSrc = `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=120&h=90&fit=crop`;
    const cell = document.createElement('div');
    cell.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    cell.dataset.pexelsId = id;
    cell.dataset.origSrc = src;
    cell.innerHTML = `
      <div style="position:relative;border-radius:7px;overflow:hidden;border:1.5px solid rgba(255,255,255,0.1);cursor:pointer;" class="qf-img-wrap">
        <img src="${thumbSrc}" style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block;"
             onerror="this.src='https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=120'">
        <div class="qf-img-overlay" style="position:absolute;inset:0;background:rgba(255,160,50,0.0);transition:background 0.15s;display:flex;align-items:center;justify-content:center;">
          <span style="font-size:16px;opacity:0;transition:opacity 0.15s;">✏️</span>
        </div>
      </div>
      <input class="qf-desc-input" type="text" placeholder="${alt || 'Describe…'}"
             style="width:100%;padding:4px 6px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#fff;font-size:9px;font-family:monospace;box-sizing:border-box;outline:none;"
             data-pexels-id="${id}">
    `;
    // Hover highlight
    const wrap = cell.querySelector('.qf-img-wrap');
    const overlay = cell.querySelector('.qf-img-overlay');
    const pen = overlay.querySelector('span');
    wrap.addEventListener('mouseenter', () => { overlay.style.background = 'rgba(255,160,50,0.25)'; pen.style.opacity = '1'; });
    wrap.addEventListener('mouseleave', () => { overlay.style.background = 'rgba(255,160,50,0)'; pen.style.opacity = '0'; });
    // Click focuses the input
    wrap.addEventListener('click', () => cell.querySelector('.qf-desc-input').focus());
    grid.appendChild(cell);
  });

  panel.style.display = 'block';
}

function _sendImageFixPatch(autoMode) {
  if (!_lastBuiltCode) return;
  const grid = document.getElementById('pexelsFixGrid');
  if (!grid) return;

  if (autoMode) {
    // Auto mode: let AI decide — describe each image by its alt or context
    const cells = grid.querySelectorAll('[data-pexels-id]');
    const list = [];
    cells.forEach(cell => {
      const id = cell.dataset.pexelsId;
      const input = cell.querySelector('.qf-desc-input');
      const hint = input ? (input.placeholder !== 'Describe…' ? input.placeholder : '') : '';
      list.push(`Photo ID ${id}${hint ? ` (context: "${hint}")` : ''}`);
    });
    if (list.length === 0) return;
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
      chatInput.value = `Look at every image in the current site. Each one should show a photo that matches the section it is in (hero background = the industry setting, trainer cards = real people doing that sport/role, product cards = the actual product, etc.). Replace ALL images using fresh Pexels URLs that genuinely match. Keep all other code, colours, layout, and text exactly the same. Do NOT reuse photo IDs you already used.`;
      document.getElementById('sendBtn')?.click();
      document.getElementById('pexelsFixPanel').style.display = 'none';
    }
    return;
  }

  // Manual mode: collect only inputs the user filled in
  const cells = grid.querySelectorAll('[data-pexels-id]');
  const fixes = [];
  cells.forEach(cell => {
    const id    = cell.dataset.pexelsId;
    const desc  = cell.querySelector('.qf-desc-input')?.value?.trim();
    if (desc) fixes.push({ id, desc });
  });

  if (fixes.length === 0) {
    // Nothing typed — prompt user
    const firstInput = grid.querySelector('.qf-desc-input');
    if (firstInput) { firstInput.focus(); firstInput.style.borderColor = '#ffa032'; setTimeout(() => { firstInput.style.borderColor = 'rgba(255,255,255,0.1)'; }, 1500); }
    return;
  }

  const lines = fixes.map(f => `- Replace Pexels photo ID ${f.id} with a photo showing: "${f.desc}"`).join('\n');
  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    chatInput.value = `Fix these specific images in the current site:\n${lines}\n\nFind real Pexels photo URLs for each description. Keep all other code, colours, layout, and text exactly the same.`;
    document.getElementById('sendBtn')?.click();
    document.getElementById('pexelsFixPanel').style.display = 'none';
  }
}

// ── 🎨 Colors panel ────────────────────────────────────────────────────────

function _openColorPanel() {
  _hideAllFixPanels();
  const panel = document.getElementById('colorFixPanel');
  if (panel) panel.style.display = 'block';
}

function _applyColorFix(hex, name) {
  const chatInput = document.getElementById('chatInput');
  if (!chatInput || !_lastBuiltCode) return;
  chatInput.value = `Change the accent colour of the entire site to ${name} (${hex}). Update every place the current accent colour is used — buttons, borders, highlights, glows, text accents, active states. Keep all other code exactly the same.`;
  document.getElementById('sendBtn')?.click();
  document.getElementById('colorFixPanel').style.display = 'none';
}

// ── ✏️ Ask AI quick-fix ────────────────────────────────────────────────────

function _openAskFix() {
  // Directly focus chat input with a helpful pre-fill hint
  const chatInput = document.getElementById('chatInput');
  if (!chatInput) return;
  chatInput.placeholder = 'Describe what to fix — e.g. "make the hero text bigger" or "change the pricing to £29/month"…';
  chatInput.focus();
  // Reset placeholder after typing starts
  chatInput.addEventListener('input', function restore() {
    chatInput.placeholder = 'Ask about your screenshot…';
    chatInput.removeEventListener('input', restore);
  });
}

// ── Wire up Quick Fix button events ───────────────────────────────────────
(function _initQuickFixBar() {
  document.getElementById('qfImagesBtn')?.addEventListener('click', () => {
    const panel = document.getElementById('pexelsFixPanel');
    if (panel && panel.style.display !== 'none') { panel.style.display = 'none'; return; }
    _openPexelsFixPanel();
  });
  document.getElementById('qfColorsBtn')?.addEventListener('click', () => {
    const panel = document.getElementById('colorFixPanel');
    if (panel && panel.style.display !== 'none') { panel.style.display = 'none'; return; }
    _openColorPanel();
  });
  document.getElementById('qfAskBtn')?.addEventListener('click', _openAskFix);

  document.getElementById('closePexelsFix')?.addEventListener('click', () => {
    document.getElementById('pexelsFixPanel').style.display = 'none';
  });
  document.getElementById('closeColorFix')?.addEventListener('click', () => {
    document.getElementById('colorFixPanel').style.display = 'none';
  });

  document.getElementById('pexelsFixApplyBtn')?.addEventListener('click', () => _sendImageFixPatch(false));
  document.getElementById('pexelsFixAutoBtn')?.addEventListener('click',  () => _sendImageFixPatch(true));

  // Colour swatches
  document.querySelectorAll('.clr-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      _applyColorFix(btn.dataset.color, btn.dataset.name);
    });
    btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.18)'; btn.style.borderColor = '#fff'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; btn.style.borderColor = 'transparent'; });
  });

  // Custom colour picker
  const customPicker = document.getElementById('customColorPicker');
  customPicker?.addEventListener('change', () => {
    _applyColorFix(customPicker.value, 'Custom');
  });
})();

// Also hide quick-fix panels when preview is closed
document.getElementById('closePreviewBtn')?.addEventListener('click', () => {
  _hideAllFixPanels();
  const bar = document.getElementById('quickFixBar');
  if (bar) bar.style.display = 'none';
}, true); // capture=true so it runs alongside the existing handler

// ── Staged Media for Build Mode ────────────────────────────────────────────
// Holds an image or video the user tagged to embed in the next build.
let _stagedBuildMedia = null; // { type, mimeType, data (base64), label }

function setStagedMedia(type, mimeType, data, label) {
  _stagedBuildMedia = { type, mimeType, data, label };
  const el = document.getElementById('stagedMediaIndicator');
  if (el) {
    el.style.display = 'flex';
    const lbl = el.querySelector('#stagedMediaLabel');
    if (lbl) lbl.textContent = `📌 ${label} staged for Build Mode`;
  }
}

function clearStagedMedia() {
  _stagedBuildMedia = null;
  const el = document.getElementById('stagedMediaIndicator');
  if (el) el.style.display = 'none';
}

// Returns { html: string, truncated: boolean }
// Pass partialCode when this response is a continuation of a cut-off build.
function extractHtmlFromResponse(text, partialCode) {
  if (!text) return { html: '', truncated: false };

  function makeResult(raw) {
    const t = raw.trim();
    const wasTruncated = !t.toLowerCase().includes('</html>');
    const html = wasTruncated ? t + '\n</body></html>' : t;
    return { html, truncated: wasTruncated };
  }

  // 1. ```html ... ``` (complete fenced block)
  const m1 = text.match(/```html\s*([\s\S]*?)```/i);
  if (m1) return makeResult(m1[1]);

  // 2. ```html ... (truncated — no closing fence)
  const m1t = text.match(/```html\s*([\s\S]*)/i);
  if (m1t) {
    const c = m1t[1].trim().toLowerCase();
    if (c.startsWith('<!doctype') || c.startsWith('<html')) return makeResult(m1t[1]);
  }

  // 3. Any ``` fence starting with <!DOCTYPE or <html
  const m2 = text.match(/```[\w]*\n?([\s\S]*?)```/);
  if (m2) {
    const c = m2[1].trim().toLowerCase();
    if (c.startsWith('<!doctype') || c.startsWith('<html')) return makeResult(m2[1]);
  }

  // 4. Bare <!DOCTYPE html> ... </html> (complete)
  const m3 = text.match(/<!DOCTYPE\s+html[\s\S]*?<\/html>/i);
  if (m3) return makeResult(m3[0]);

  // 5. Bare <!DOCTYPE html> ... (truncated)
  const m3t = text.match(/<!DOCTYPE\s+html[\s\S]*/i);
  if (m3t) return makeResult(m3t[0]);

  // 6. Bare <html> ... </html>
  const m4 = text.match(/<html[\s\S]*?<\/html>/i);
  if (m4) return makeResult(m4[0]);

  // 7. Bare <html> ... (truncated)
  const m4t = text.match(/<html[\s\S]*/i);
  if (m4t) return makeResult(m4t[0]);

  // 8. Continuation mode — no full HTML doc found but we have a partial to merge with
  if (partialCode) {
    // Strip the </body></html> we appended to the incomplete partial code
    let base = partialCode
      .replace(/\n?<\/body>\s*<\/html>\s*$/i, '')
      .replace(/\n?<\/html>\s*$/i, '');
    // If the base ends mid-tag (last < has no matching >) truncate to last complete tag.
    // This prevents <div id being merged with id="foo"> to create <div idid="foo">.
    const lastOpen = base.lastIndexOf('<');
    const lastClose = base.lastIndexOf('>');
    if (lastOpen > lastClose) {
      base = base.substring(0, lastOpen).trimEnd();
    }
    // Strip any leading ``` fence markers the AI may have output
    const chunk = text.replace(/^```[\w]*\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const merged = base + '\n' + chunk;
    return makeResult(merged);
  }

  return { html: '', truncated: false };
}

let _previewExpanded = false;
let _streamRenderTimer = null;   // throttle for progressive srcdoc updates
let _streamRenderPending = null; // latest partial HTML waiting to be rendered
let _streamSafetyTimer = null;   // 90s safety net — spinner can never be stuck forever

let _isSandboxReady = false;
// True only once _showLivePreview has been called for the current build (final code ready).
// Prevents sandboxReady from flushing a partial streaming chunk as "final".
let _buildFinalReady = false;

// Listen for sandbox boot handshake — sandbox.html posts this when it loads
window.addEventListener('message', function(ev) {
  if (ev.origin !== location.origin) return;
  const sandboxFrame = document.getElementById('livePreview');
  if (sandboxFrame && ev.source !== sandboxFrame.contentWindow) return;
  if (ev.data && ev.data.sandboxReady) {
    _isSandboxReady = true;
    // Only flush when the final complete HTML is ready — not mid-stream partials
    if (_lastBuiltCode && _buildFinalReady) {
      _postToSandbox(_lastBuiltCode, true);
    }
  }
});

// Reload the sandbox iframe so its global scope is fresh for a new build.
// const/let declarations from the previous build linger in global scope and
// cause uncatchable "Identifier already declared" SyntaxErrors on re-run.
function _reloadSandbox() {
  const iframe = document.getElementById('livePreview');
  if (!iframe) return;
  _isSandboxReady = false;
  _buildFinalReady = false;
  // Setting .src triggers a full reload; sandboxReady handshake re-fires when done
  iframe.src = 'sandbox.html';
}

// Auto-patch generated HTML so that any function referenced in an onclick/onchange/
// onsubmit/oninput attribute but defined as a plain `function fnName(){}` (instead of
// `window.fnName = function(){}`) is still reachable from HTML attribute handlers.
// This is a safety net for when the AI doesn't follow the window-attachment rule.
function _patchWindowFunctions(html) {
  if (!html) return html;
  try {
    // 1. Collect every function name referenced in inline event attributes.
    const attrFnNames = new Set();
    const attrRe = /\bon(?:click|change|submit|input|mousedown|mouseup|keydown|keyup|focus|blur)=["']([^"']+)["']/gi;
    let m;
    while ((m = attrRe.exec(html)) !== null) {
      // Extract leading identifier from the handler expression, e.g. "addToCart(1,'x',9)" → "addToCart"
      const fnMatch = m[1].match(/^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/);
      if (fnMatch) attrFnNames.add(fnMatch[1]);
      // Also handle "window.fnName(" — already on window, no patch needed
    }
    if (attrFnNames.size === 0) return html;

    // 2. For each <script>…</script> block, ensure onclick-referenced functions
    //    are reachable from window. Two strategies applied in sequence:
    //
    //    a) INLINE CONVERSION: rewrite `function fnName(` → `window.fnName = function fnName(`
    //       This works even inside an IIFE where post-hoc injection is out-of-scope.
    //
    //    b) POST-INJECTION: for top-level declarations that weren't converted,
    //       append `if(typeof fnName==="function")window.fnName=fnName;` at end.
    return html.replace(/<script(\b[^>]*)>([\s\S]*?)<\/script>/gi, (full, attrs, body) => {
      let newBody = body;
      const tailInjections = [];

      for (const name of attrFnNames) {
        // Already properly window-attached — nothing to do
        if (new RegExp('window\\.' + name + '\\s*=').test(newBody)) continue;

        const plainFnRe = new RegExp('\\bfunction\\s+' + name + '\\s*\\(', 'g');
        if (plainFnRe.test(newBody)) {
          // Strategy (a): inline conversion — safe inside IIFEs and at top-level
          newBody = newBody.replace(
            new RegExp('\\bfunction\\s+(' + name + ')\\s*\\(', 'g'),
            'window.$1 = function $1('
          );
        } else {
          // Strategy (b): top-level arrow / const / let / var fn — append assignment
          const assignRe = new RegExp('(?:const|let|var)\\s+' + name + '\\s*=');
          if (assignRe.test(newBody)) {
            tailInjections.push('if(typeof ' + name + '!=="undefined")window.' + name + '=' + name + ';');
          }
        }
      }

      if (newBody === body && tailInjections.length === 0) return full;
      const tail = tailInjections.length
        ? '\n// [SnapToAI auto-patch]\n' + tailInjections.join('\n') + '\n'
        : '';
      return '<script' + attrs + '>' + newBody + tail + '</script>';
    });
  } catch (e) {
    // Never break the preview pipeline on a patch failure
    return html;
  }
}

function _postToSandbox(code, isFinal) {
  const iframe = document.getElementById('livePreview');
  if (!iframe) return;
  // Auto-patch: ensure all onclick-referenced functions are on window
  const patched = _patchWindowFunctions(code);
  _lastBuiltCode = patched; // always keep buffer fresh
  _updateBuildInput();
  // Gate on handshake — contentWindow is always truthy once element exists,
  // so we must check _isSandboxReady explicitly. If sandbox isn't ready yet,
  // the handshake listener will auto-flush _lastBuiltCode when it fires.
  if (!_isSandboxReady) return;
  if (iframe.contentWindow) {
    iframe.contentWindow.postMessage({ htmlCode: patched, isFinal: !!isFinal }, '*');
  }
}

function _showLivePreview(code) {
  // Cancel any in-flight stream timers
  if (_streamRenderTimer) { clearTimeout(_streamRenderTimer); _streamRenderTimer = null; }
  if (_streamSafetyTimer) { clearTimeout(_streamSafetyTimer); _streamSafetyTimer = null; }
  _streamRenderPending = null;

  const w = document.getElementById('previewWrapper');
  const iframe = document.getElementById('livePreview');
  const building = document.getElementById('previewBuilding');
  const lbl = document.getElementById('previewLabel');
  if (!w || !iframe) return;

  // Mark final code as ready so sandboxReady can flush it if sandbox reloads
  _buildFinalReady = true;
  // Send HTML to sandbox.html via postMessage — sandbox page can load Tailwind CDN
  _postToSandbox(code, true);
  iframe.style.display = 'block';
  iframe.style.height = _previewExpanded ? '420px' : '200px';
  if (building) building.style.display = 'none';
  if (lbl) lbl.textContent = '🏗️ LIVE PREVIEW';
  w.style.display = 'block';
}

// Highlight a stage badge as "active" (currently generating)
function _setBadgeActive(stage) {
  ['L1','L2','L3'].forEach(s => {
    const b = document.getElementById('badge-' + s);
    if (!b) return;
    if (s === stage) {
      b.style.color = '#ffa032';
      b.style.background = 'rgba(255,160,50,0.18)';
      b.style.borderColor = 'rgba(255,160,50,0.6)';
    } else {
      b.style.color = 'rgba(255,160,50,0.35)';
      b.style.background = 'transparent';
      b.style.borderColor = 'rgba(255,160,50,0.2)';
    }
  });
}

// Mark a stage badge as "done" (checkmark)
function _setBadgeDone(stage) {
  const b = document.getElementById('badge-' + stage);
  if (!b) return;
  b.style.color = '#50dc78';
  b.style.background = 'rgba(80,220,120,0.12)';
  b.style.borderColor = 'rgba(80,220,120,0.4)';
}

// Reset all badges to dim state
function _resetBadges() {
  ['L1','L2','L3'].forEach(s => {
    const b = document.getElementById('badge-' + s);
    if (!b) return;
    b.style.color = 'rgba(255,160,50,0.35)';
    b.style.background = 'transparent';
    b.style.borderColor = 'rgba(255,160,50,0.2)';
  });
}

function renderLivePreview(responseText) {
  if (!buildModeEnabled) return;
  const { html: code, truncated: codeTruncated } = extractHtmlFromResponse(responseText, _continuationPending ? _lastBuiltCode : null);
  if (!code) return;
  // Only persist when the output is complete — truncated partials must not
  // overwrite the last good site (mirrors the guard in addBubbleActions).
  if (!buildStage && !codeTruncated) {
    _lastBuiltCode = code;
    try { chrome.storage.local.set({ snaptoai_built_code: code }); } catch(e) { console.warn('[SnapToAI] renderLivePreview storage write failed:', e?.message || e); }
    _updateBuildInput();
  } else if (buildStage) {
    // Staged builds are always complete fragments — always save
    _lastBuiltCode = code;
    try { chrome.storage.local.set({ snaptoai_built_code: code }); } catch(e) { console.warn('[SnapToAI] renderLivePreview staged storage write failed:', e?.message || e); }
    _updateBuildInput();
  }

  const w = document.getElementById('previewWrapper');
  const building = document.getElementById('previewBuilding');
  const iframe = document.getElementById('livePreview');
  const lbl = document.getElementById('previewLabel');
  const txt = document.getElementById('previewBuildingTxt');

  if (w) w.style.display = 'block';
  if (building) building.style.display = 'flex';
  if (lbl) lbl.textContent = '⏳ Building…';
  if (txt) txt.textContent = buildStage ? 'Compiling ' + buildStage + '…' : 'Compiling…';
  if (buildStage) _setBadgeActive(buildStage);

  // First chunk of a new build: reload sandbox to clear previous build's global scope.
  // const/let declarations from prior builds cause uncatchable re-declaration errors.
  if (!_streamSafetyTimer && !_streamRenderTimer) {
    _reloadSandbox();
  }

  // Progressive streaming: push partial HTML to sandbox.html via postMessage
  // throttled to once every 900ms so we don't flood the sandbox on every chunk.
  _streamRenderPending = code;
  if (!_streamRenderTimer) {
    _streamRenderTimer = setTimeout(() => {
      _streamRenderTimer = null;
      if (_streamRenderPending && iframe) {
        _postToSandbox(_streamRenderPending, false); // partial — skip script execution
        iframe.style.display = 'block';
        iframe.style.height = _previewExpanded ? '420px' : '200px';
        _streamRenderPending = null;
      }
    }, 900);
  }

  // Safety net: if streaming never completes (network drop, stuck token),
  // auto-resolve the spinner after 90 seconds using whatever HTML we have.
  if (!_streamSafetyTimer) {
    _streamSafetyTimer = setTimeout(() => {
      _streamSafetyTimer = null;
      if (_lastBuiltCode) _showLivePreview(_lastBuiltCode);
    }, 90000);
  }
}

document.getElementById('closePreviewBtn')?.addEventListener('click', () => {
  const w = document.getElementById('previewWrapper');
  if (w) w.style.display = 'none';
  const iframe = document.getElementById('livePreview');
  // Hide only — never navigate away from sandbox.html or future builds can't postMessage into it
  if (iframe) { iframe.style.display = 'none'; }
  const building = document.getElementById('previewBuilding');
  if (building) building.style.display = 'none';
  if (_livePreviewBlobUrl) { URL.revokeObjectURL(_livePreviewBlobUrl); _livePreviewBlobUrl = null; }
  if (_streamRenderTimer) { clearTimeout(_streamRenderTimer); _streamRenderTimer = null; }
  if (_streamSafetyTimer) { clearTimeout(_streamSafetyTimer); _streamSafetyTimer = null; }
  _streamRenderPending = null;
  _resetBadges();
});

document.getElementById('previewExpandBtn')?.addEventListener('click', () => {
  _previewExpanded = !_previewExpanded;
  const iframe = document.getElementById('livePreview');
  const btn = document.getElementById('previewExpandBtn');
  if (iframe && iframe.style.display !== 'none') {
    iframe.style.height = _previewExpanded ? '420px' : '200px';
  }
  if (btn) btn.title = _previewExpanded ? 'Collapse preview' : 'Expand preview';
});

document.getElementById('openAgentsBtn')?.addEventListener('click', openAgentsModal);
const _closeAgentsBtn = document.getElementById('closeAgentsModal');
if (_closeAgentsBtn) {
  _closeAgentsBtn.addEventListener('click', closeAgentsModal);
  _closeAgentsBtn.addEventListener('mouseover', () => { _closeAgentsBtn.style.color = '#e8eaed'; });
  _closeAgentsBtn.addEventListener('mouseout',  () => { _closeAgentsBtn.style.color = '#80868b'; });
}
document.getElementById('agentsModal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeAgentsModal();
});

document.getElementById('buildToggleBtn')?.addEventListener('click', (e) => {
  buildModeEnabled = !buildModeEnabled;
  e.currentTarget.classList.toggle('tool-btn-active', buildModeEnabled);
  e.currentTarget.title = buildModeEnabled
    ? 'Build Mode ON — describe a site and send to generate it'
    : 'Build Mode — generate and preview websites & apps live';
  const _bsb = document.getElementById('buildSubBar');
  if (_bsb) _bsb.style.display = buildModeEnabled ? 'flex' : 'none';
  if (!buildModeEnabled) {
    buildStage = null;
    // Do NOT clear _lastBuiltCode or storage here — the user may toggle Build
    // Mode off temporarily and back on to continue updating the same site.
    // The cache is only purged when the user explicitly clicks Clear Chat.
    _updateBuildInput();
  } else if (!_lastBuiltCode) {
    // Restore any previously built site from storage so follow-up fix
    // requests have the current HTML even if the popup was reopened
    chrome.storage.local.get('snaptoai_built_code', (res) => {
      if (res.snaptoai_built_code) {
        _lastBuiltCode = res.snaptoai_built_code;
        _updateBuildInput();
        // Show the user what site they're resuming — prevents editing wrong site
        _showResumedBuildBanner(_lastBuiltCode);
        _showLivePreview(_lastBuiltCode);
      }
    });
  } else {
    _updateBuildInput();
    // Already have code from current session — show it and the "Resuming" banner
    _showResumedBuildBanner(_lastBuiltCode);
    _showLivePreview(_lastBuiltCode);
  }
});

// "Use my screenshots in build" checkbox
document.getElementById('buildUseSnap')?.addEventListener('change', (e) => {
  _buildUseSnaps = e.target.checked;
});

// Build type quick-start pills — clicking pre-fills chatInput so users know
// they can build sites, slides, PDFs, games, apps, etc.
document.querySelectorAll('.build-type-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    const prompt = btn.dataset.prompt || '';
    const ci = document.getElementById('chatInput');
    if (!ci) return;
    ci.value = prompt;
    ci.focus();
    // Put cursor at the end so the user can type immediately
    ci.setSelectionRange(ci.value.length, ci.value.length);
    // Trigger input event so any auto-resize logic fires
    ci.dispatchEvent(new Event('input', { bubbles: true }));
  });
});


// Image replacer modal — close on X or backdrop click
document.getElementById('closeImageReplacer')?.addEventListener('click', () => {
  const m = document.getElementById('imageReplacerModal');
  if (m) m.style.display = 'none';
});
document.getElementById('imageReplacerModal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
});

// Stage button handlers
function _setStage(stage, btnId) {
  buildStage = stage;
  buildModeEnabled = true;
  document.getElementById('buildToggleBtn')?.classList.add('tool-btn-active');
  _resetBadges();
  _setBadgeActive(stage);
  // Update input placeholder to guide user
  const input = document.getElementById('chatInput');
  if (input) {
    const hints = {
      L1: 'Describe the site (e.g. "landing page for a yoga studio") — L1 builds the structure',
      L2: 'Describe the design style (e.g. "modern dark, accent violet") — L2 adds CSS',
      L3: 'Type "activate" or describe any extra interactions — L3 wires all buttons',
      UPDATE: 'Describe what to change (e.g. "update the hero headline") — Update patches only that section'
    };
    input.placeholder = hints[stage] || input.placeholder;
  }
}



document.getElementById('previewCopyBtn')?.addEventListener('click', () => {
  if (_lastBuiltCode) {
    navigator.clipboard.writeText(_lastBuiltCode).then(() => {
      const btn = document.getElementById('previewCopyBtn');
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy Code'; }, 1800); }
    });
  }
});

// ── Build Mode UI helpers ──────────────────────────────────────────────────────
// Update the chat input placeholder to guide the user when patching a site
function _updateBuildInput() {
  const input = document.getElementById('chatInput');
  if (!input) return;
  if (buildModeEnabled && _lastBuiltCode) {
    input.placeholder = 'Describe a fix or what to add — e.g. "change hero to dark blue" or attach an image 📎';
  } else if (buildModeEnabled) {
    input.placeholder = 'Describe the site to build — e.g. "landing page for a yoga studio"';
  } else {
    input.placeholder = 'Ask about your screenshot...';
  }
}

// Show a dismissible banner when a previous session's built site is resumed.
// This makes it obvious to the user WHICH site is loaded so they don't
// unknowingly edit an old site when they meant to start something new.
function _showResumedBuildBanner(code) {
  if (!code) return;
  const existing = document.getElementById('_resumeBuildBanner');
  if (existing) existing.remove();
  const titleMatch = code.match(/<title[^>]*>([^<]+)<\/title>/i);
  const siteTitle = (titleMatch ? titleMatch[1].trim() : 'Previous build').slice(0, 40);
  const thread = document.getElementById('chatThread');
  if (!thread) return;
  const banner = document.createElement('div');
  banner.id = '_resumeBuildBanner';
  banner.style.cssText = 'background:rgba(74,158,255,0.09);border:1px solid rgba(74,158,255,0.22);border-radius:8px;padding:8px 12px;margin:6px 0 4px;display:flex;align-items:center;gap:8px;font-size:12px;color:#8899aa;';
  banner.innerHTML =
    '<span style="font-size:15px;">📄</span>' +
    '<span>Resuming: <strong style="color:#cdd6f4;">' + siteTitle.replace(/</g, '&lt;') + '</strong></span>' +
    '<button id="_resumeBannerClear" style="margin-left:auto;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);color:#aab;cursor:pointer;font-size:11px;padding:2px 8px;border-radius:4px;">✕ Start fresh</button>';
  // Insert near the top of the thread (after the modeLabel span if present)
  const modeLabel = thread.querySelector('#modeLabel');
  if (modeLabel && modeLabel.nextSibling) {
    thread.insertBefore(banner, modeLabel.nextSibling);
  } else {
    thread.appendChild(banner);
  }
  document.getElementById('_resumeBannerClear')?.addEventListener('click', () => {
    banner.remove();
    _lastBuiltCode = '';
    _lastBuiltCodeForPatch = '';
    _committedMediaMap = {};
    _buildBodyHtml = '';
    _buildStyleCss = '';
    _buildScriptJs = '';
    try { chrome.storage.local.remove(['snaptoai_built_code', 'snaptoai_build_body', 'snaptoai_build_style', 'snaptoai_build_script']); } catch(e) {}
    _updateBuildInput();
    const w = document.getElementById('previewWrapper');
    if (w) w.style.display = 'none';
    const iframe = document.getElementById('livePreview');
    if (iframe) { iframe.style.display = 'none'; iframe.src = 'about:blank'; }
  });
}

document.getElementById('previewOpenTabBtn')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('preview-output.html') });
});

// ── Netlify One-Click Publish ──────────────────────────────────────────────────
// Publishes the current built site to Netlify as a free static site.
// Uses a Personal Access Token stored in chrome.storage.local — the token is
// entered once and reused for every subsequent publish to the same site.

async function _sha1Hex(str) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function _netlifyPublish(token) {
  const html = _lastBuiltCode;
  if (!html) throw new Error('No site built yet.');

  const setText = t => {
    const el = document.getElementById('netlifyPublishingTxt');
    if (el) el.textContent = t;
  };

  // Step 1 — get or create the Netlify site
  setText('Creating your site…');
  let siteId, siteName;
  try {
    const stored = await chrome.storage.local.get(['netlify_site_id', 'netlify_site_name']);
    siteId = stored.netlify_site_id;
    siteName = stored.netlify_site_name;
  } catch(e) {}

  if (!siteId) {
    const res = await fetch('https://api.netlify.com/api/v1/sites', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'snaptoai-' + Math.random().toString(36).slice(2, 8) })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Netlify error ${res.status} — check your token.`);
    }
    const site = await res.json();
    siteId = site.id;
    siteName = site.name;
    try { await chrome.storage.local.set({ netlify_site_id: siteId, netlify_site_name: siteName }); } catch(e) {}
  }

  // Step 2 — compute SHA-1 of the HTML and create a deploy
  setText('Preparing deploy…');
  const digest = await _sha1Hex(html);

  const deployRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: { '/index.html': digest } })
  });
  if (!deployRes.ok) {
    const err = await deployRes.json().catch(() => ({}));
    throw new Error(err.message || `Deploy failed (${deployRes.status}).`);
  }
  const deploy = await deployRes.json();

  // Step 3 — upload the file if Netlify needs it (cache miss)
  if (deploy.required && deploy.required.includes(digest)) {
    setText('Uploading site…');
    const bytes = new TextEncoder().encode(html);
    const uploadRes = await fetch(`https://api.netlify.com/api/v1/deploys/${deploy.id}/files/index.html`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      body: bytes
    });
    if (!uploadRes.ok) throw new Error(`Upload failed (${uploadRes.status}).`);
  }

  // Step 4 — poll until deploy is ready (max ~60s)
  setText('Going live…');
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const poll = await fetch(`https://api.netlify.com/api/v1/deploys/${deploy.id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const status = await poll.json();
    if (status.state === 'ready' || status.state === 'uploaded') {
      const url = status.deploy_ssl_url || status.deploy_url || `https://${siteName}.netlify.app`;
      try { await chrome.storage.local.set({ netlify_site_url: url }); } catch(e) {}
      return url;
    }
    if (status.state === 'error') throw new Error('Netlify deploy failed. Try again.');
  }
  // Timed out but site may still be ready — return the expected URL
  return `https://${siteName}.netlify.app`;
}

// ── Modal orchestration ──────────────────────────────────────────────────────

function _netlifyShowModal(startAtStep) {
  const modal = document.getElementById('netlifyModal');
  if (!modal) return;
  modal.style.display = 'flex';
  ['netlifyStep1','netlifyStep2','netlifyStep3'].forEach((id, idx) => {
    const el = document.getElementById(id);
    if (el) el.style.display = (idx === startAtStep - 1) ? '' : 'none';
  });
  const errEl = document.getElementById('netlifyTokenError');
  if (errEl) errEl.style.display = 'none';
}

function _netlifyHideModal() {
  const modal = document.getElementById('netlifyModal');
  if (modal) modal.style.display = 'none';
}

async function _netlifyRunPublish(token) {
  _netlifyShowModal(2); // spinner
  try {
    const url = await _netlifyPublish(token);
    // Show success step
    const link = document.getElementById('netlifySiteLink');
    const openBtn = document.getElementById('netlifyOpenBtn');
    if (link) { link.href = url; link.textContent = url; }
    if (openBtn) openBtn.onclick = () => chrome.tabs.create({ url });
    document.getElementById('netlifyCopyUrlBtn')?.addEventListener('click', () => {
      navigator.clipboard.writeText(url).then(() => {
        const btn = document.getElementById('netlifyCopyUrlBtn');
        if (btn) { const old = btn.textContent; btn.textContent = '✓ Copied!'; setTimeout(() => { btn.textContent = old; }, 1800); }
      });
    });
    _netlifyShowModal(3);
    // Update publish button label
    const pubBtn = document.getElementById('publishNetlifyBtn');
    if (pubBtn) pubBtn.textContent = '🌐 Update Live';
  } catch(err) {
    _netlifyHideModal();
    addBubble(`⚠️ Publish failed: ${err.message}`, 'error');
  }
}

// ── Button click handler ─────────────────────────────────────────────────────
document.getElementById('publishNetlifyBtn')?.addEventListener('click', async () => {
  if (!_lastBuiltCode) {
    addBubble('Build a site first, then click Publish.', 'error');
    return;
  }
  try {
    const stored = await chrome.storage.local.get(['netlify_token']);
    if (stored.netlify_token) {
      // Token already saved — publish immediately
      await _netlifyRunPublish(stored.netlify_token);
    } else {
      // First time — show setup modal
      _netlifyShowModal(1);
    }
  } catch(e) {
    _netlifyShowModal(1);
  }
});

document.getElementById('netlifyModalClose')?.addEventListener('click', _netlifyHideModal);

document.getElementById('netlifyAppLink')?.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://app.netlify.com' });
});

document.getElementById('netlifyTokenSaveBtn')?.addEventListener('click', async () => {
  const input = document.getElementById('netlifyTokenInput');
  const errEl = document.getElementById('netlifyTokenError');
  const token = input?.value.trim();
  if (!token) {
    if (errEl) { errEl.textContent = 'Please paste your Netlify access token.'; errEl.style.display = 'block'; }
    return;
  }
  // Quick validation — check token works
  const saveBtn = document.getElementById('netlifyTokenSaveBtn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Checking…'; }
  try {
    let test;
    try {
      test = await fetch('https://api.netlify.com/api/v1/user', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (networkErr) {
      // fetch() itself failed — almost always means the extension hasn't been
      // reloaded after the manifest CSP change that allows api.netlify.com
      if (errEl) {
        errEl.innerHTML = '❌ Network error — Chrome blocked the request.<br>' +
          'Go to <b>chrome://extensions</b>, find Aion, click <b>🔄 the reload icon</b>, ' +
          'then try again.';
        errEl.style.display = 'block';
      }
      return;
    }
    if (test.status === 401) {
      if (errEl) {
        errEl.textContent = '❌ Token rejected (401). Make sure you copied the full token — ' +
          'it should start with "nfp_" and be about 50 characters long.';
        errEl.style.display = 'block';
      }
      return;
    }
    if (!test.ok) {
      if (errEl) {
        errEl.textContent = `❌ Netlify returned an error (${test.status}). Please try again.`;
        errEl.style.display = 'block';
      }
      return;
    }
    // Save token and publish
    await chrome.storage.local.set({ netlify_token: token });
    await _netlifyRunPublish(token);
  } catch(e) {
    if (errEl) {
      errEl.textContent = '❌ Unexpected error: ' + (e.message || e);
      errEl.style.display = 'block';
    }
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Connect & Publish'; }
  }
});

// ──────────────────────────────────────────────────────────────────────────────

// Research Mode toggle — auto-enables Search and forces the Research Agent system prompt
document.getElementById('researchToggleBtn')?.addEventListener('click', (e) => {
  researchMode = !researchMode;
  e.currentTarget.classList.toggle('tool-btn-active', researchMode);
  e.currentTarget.title = researchMode
    ? 'Research Agent ON — will search, read sources and write a structured report'
    : 'Research Agent — auto-searches, reads sources and writes a structured report';
  // Auto-enable Google Search when Research Mode turns on
  if (researchMode && !searchGroundingEnabled) {
    searchGroundingEnabled = true;
    document.getElementById('searchToggleBtn')?.classList.add('tool-btn-active');
  }
});

// Code Execution toggle
document.getElementById('codeToggleBtn')?.addEventListener('click', (e) => {
  codeExecutionEnabled = !codeExecutionEnabled;
  e.currentTarget.classList.toggle('tool-btn-active', codeExecutionEnabled);
  e.currentTarget.title = codeExecutionEnabled
    ? 'Code Execution ON — Gemini will run Python to solve math & data tasks'
    : 'Let Gemini run Python code to solve problems';
});

// URL context toggle — grabs the active tab URL when turned on
document.getElementById('urlToggleBtn')?.addEventListener('click', async (e) => {
  urlContextEnabled = !urlContextEnabled;
  e.currentTarget.classList.toggle('tool-btn-active', urlContextEnabled);
  if (urlContextEnabled) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentPageUrl = tab?.url || '';
      e.currentTarget.title = currentPageUrl
        ? `Reading: ${currentPageUrl.substring(0, 60)}…`
        : 'URL Context ON (no URL detected)';
    } catch (_) {
      currentPageUrl = '';
    }
  } else {
    currentPageUrl = '';
    e.currentTarget.title = 'Read the current page';
  }
});

const MAX_FILE_SIZE = 10 * 1024 * 1024;       // 10 MB for images / docs
const MAX_VIDEO_FILE_SIZE = 100 * 1024 * 1024; // 100 MB for video files
const MAX_FILES = 20;

document.getElementById('fileInput').addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  const slotsAvailable = MAX_FILES - filesQueue.length;
  if (files.length > slotsAvailable) {
    addBubble(`Can only attach ${slotsAvailable} more file(s). Maximum is ${MAX_FILES}.`, 'error');
  }
  files.slice(0, Math.max(0, slotsAvailable)).forEach(file => {
    const isVideo = file.type.startsWith('video/');
    const limit = isVideo ? MAX_VIDEO_FILE_SIZE : MAX_FILE_SIZE;
    const limitLabel = isVideo ? '100MB' : '10MB';
    if (file.size > limit) {
      addBubble(`"${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max file size is ${limitLabel}.`, 'error');
      return;
    }

    // PowerPoint / Office ZIP formats — extract text before sending to Gemini
    const isPptx = /\.(pptx|ppt)$/i.test(file.name) ||
      file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      file.type === 'application/vnd.ms-powerpoint';
    const isDocx = /\.docx$/i.test(file.name) ||
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const isXlsx = /\.xlsx$/i.test(file.name) ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    if (isPptx || isDocx || isXlsx) {
      const arrReader = new FileReader();
      arrReader.onload = async (event) => {
        try {
          let extracted = '';
          if (isPptx)      extracted = await _extractPptxText(event.target.result);
          else if (isDocx) extracted = await _extractDocxText(event.target.result);
          else if (isXlsx) extracted = await _extractXlsxText(event.target.result);
          if (!extracted.trim()) throw new Error('No text found in file');
          const b64 = btoa(unescape(encodeURIComponent(extracted)));
          const fileData = {
            mimeType: 'text/plain',
            data: b64,
            name: file.name,
            _officeType: isPptx ? 'pptx' : isDocx ? 'docx' : 'xlsx',
            _displayName: file.name
          };
          filesQueue.push(fileData);
          const icon = isPptx ? '📊' : isDocx ? '📝' : '📈';
          const card = document.createElement('div');
          card.className = 'file-card';
          card.innerHTML = `${icon} <span>${file.name}</span> <div class="remove-btn">×</div>`;
          card.querySelector('.remove-btn').onclick = () => {
            filesQueue = filesQueue.filter(f => f !== fileData);
            card.remove();
          };
          document.getElementById('filePreviewZone').appendChild(card);
        } catch (err) {
          addBubble(`⚠ Couldn't read "${file.name}": ${err.message}. Try saving as PDF or copying the text.`, 'error');
        }
      };
      arrReader.readAsArrayBuffer(file);
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
const DEFAULT_MAGIC_BUTTONS = [];

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
  document.getElementById('selectedEmoji').value = btn.emoji;
  document.getElementById('promptCount').textContent = countWords(btn.prompt);
  
  document.getElementById('saveMagicBtn').textContent = 'Update';
  document.getElementById('magicModal').classList.add('open');
}

// Auto-assigned icons for custom prompt buttons — no manual picker needed.
const AUTO_MAGIC_EMOJIS = ['🔍','💰','📊','📈','💡','⚡','🎯','🛒','✨','🚀','🧭','🎨','📝','🔥','🌟'];
function pickAutoMagicEmoji(text) {
  const t = (text || '').toLowerCase();
  const keywordMap = [
    [/price|cost|deal|discount|money|buy/, '💰'],
    [/chart|data|stat|report|analy/, '📊'],
    [/trend|growth|market|forecast/, '📈'],
    [/idea|brainstorm|creative/, '💡'],
    [/fast|quick|speed/, '⚡'],
    [/goal|target|focus/, '🎯'],
    [/shop|cart|product/, '🛒'],
    [/search|find|look/, '🔍'],
    [/write|draft|text|copy/, '📝'],
    [/design|art|image|photo/, '🎨'],
    [/build|app|code/, '🚀'],
  ];
  for (const [re, emoji] of keywordMap) {
    if (re.test(t)) return emoji;
  }
  return AUTO_MAGIC_EMOJIS[Math.floor(Math.random() * AUTO_MAGIC_EMOJIS.length)];
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
  editingMagicIndex = null;
  document.getElementById('magicModal').classList.add('open');
  document.getElementById('magicName').value = '';
  document.getElementById('magicPrompt').value = '';
  document.getElementById('promptCount').textContent = '0';
  document.getElementById('selectedEmoji').value = '';
  document.getElementById('saveMagicBtn').textContent = 'Create';
});

document.getElementById('closeMagicModal')?.addEventListener('click', () => {
  editingMagicIndex = null;
  document.getElementById('saveMagicBtn').textContent = 'Create';
  document.getElementById('magicName').value = '';
  document.getElementById('magicPrompt').value = '';
  document.getElementById('promptCount').textContent = '0';
  document.getElementById('magicModal').classList.remove('open');
});

function countWords(str) {
  const t = str.trim();
  return t ? t.split(/\s+/).length : 0;
}

document.getElementById('magicPrompt')?.addEventListener('input', (e) => {
  let words = countWords(e.target.value);
  if (words > 3000) {
    // Trim back down to 3000 words if the user pastes something longer
    e.target.value = e.target.value.trim().split(/\s+/).slice(0, 3000).join(' ');
    words = 3000;
  }
  document.getElementById('promptCount').textContent = words;
});

document.querySelectorAll('.template-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const template = btn.dataset.template;
    const buttonText = btn.textContent.trim();
    const emoji = buttonText.split(' ')[0];
    const name = buttonText.substring(emoji.length).trim();
    
    document.getElementById('magicPrompt').value = template;
    document.getElementById('promptCount').textContent = countWords(template);
    
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
  const prompt = document.getElementById('magicPrompt').value.trim();
  
  if (!name) { alert('Please enter a button name'); return; }
  if (!prompt) { alert('Please enter instructions for the AI'); return; }
  
  if (editingMagicIndex !== null) {
    const emoji = magicButtons[editingMagicIndex].emoji || pickAutoMagicEmoji(name + ' ' + prompt);
    magicButtons[editingMagicIndex] = { 
      ...magicButtons[editingMagicIndex], 
      name, emoji, prompt 
    };
    editingMagicIndex = null;
    document.getElementById('saveMagicBtn').textContent = 'Create';
    addBubble(`Custom prompt "${name}" updated!`, 'ai');
  } else {
    if (magicButtons.length >= 15) { alert('Maximum 15 custom prompts allowed'); return; }
    const emoji = pickAutoMagicEmoji(name + ' ' + prompt);
    const colorIndex = Math.floor(Math.random() * 8);
    magicButtons.push({ name, emoji, prompt, colorIndex });
    addBubble(`Custom prompt "${name}" created! Click it anytime to use.`, 'ai');
  }
  
  await saveMagicButtons();
  document.getElementById('magicModal').classList.remove('open');
  document.getElementById('magicName').value = '';
  document.getElementById('magicPrompt').value = '';
  document.getElementById('promptCount').textContent = '0';
  
  if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
});

// Load magic buttons on start
loadMagicButtons();

// ── Office file text extraction (PPTX / DOCX / XLSX) ─────────────────────────
// These are all ZIP archives containing XML. We parse the ZIP structure using
// the browser's native DecompressionStream (deflate-raw) — no external libs needed.

function _zipReadUint16(b, o) { return b[o] | (b[o+1] << 8); }
function _zipReadUint32(b, o) { return ((b[o] | (b[o+1]<<8) | (b[o+2]<<16) | (b[o+3]<<24)) >>> 0); }

async function _zipDeflate(data) {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  const r = ds.readable.getReader();
  w.write(data); w.close();
  const chunks = [];
  while (true) { const {done,value} = await r.read(); if (done) break; chunks.push(value); }
  const total = chunks.reduce((s,c) => s+c.length, 0);
  const out = new Uint8Array(total); let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function _zipExtractFiles(arrayBuffer, fileFilter) {
  const buf = new Uint8Array(arrayBuffer);
  // Locate End-of-Central-Directory record
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf[i]===0x50&&buf[i+1]===0x4b&&buf[i+2]===0x05&&buf[i+3]===0x06) { eocd=i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid ZIP/Office file');

  const cdCount  = _zipReadUint16(buf, eocd + 10);
  const cdOffset = _zipReadUint32(buf, eocd + 16);
  const results  = {};
  let pos = cdOffset;

  for (let i = 0; i < cdCount; i++) {
    if (_zipReadUint32(buf, pos) !== 0x02014b50) break;
    const compression = _zipReadUint16(buf, pos + 10);
    const compSize    = _zipReadUint32(buf, pos + 20);
    const fnLen       = _zipReadUint16(buf, pos + 28);
    const extraLen    = _zipReadUint16(buf, pos + 30);
    const commentLen  = _zipReadUint16(buf, pos + 32);
    const localOffset = _zipReadUint32(buf, pos + 42);
    const filename    = new TextDecoder().decode(buf.subarray(pos+46, pos+46+fnLen));
    pos += 46 + fnLen + extraLen + commentLen;

    if (!fileFilter(filename)) continue;

    const lfnLen   = _zipReadUint16(buf, localOffset + 26);
    const lextraLen= _zipReadUint16(buf, localOffset + 28);
    const dataStart= localOffset + 30 + lfnLen + lextraLen;
    const raw      = buf.subarray(dataStart, dataStart + compSize);

    let bytes;
    if      (compression === 0) bytes = raw;
    else if (compression === 8) bytes = await _zipDeflate(raw);
    else continue;

    results[filename] = new TextDecoder().decode(bytes);
  }
  return results;
}

function _xmlAttrDecode(s) {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
}

async function _extractPptxText(arrayBuffer) {
  const files = await _zipExtractFiles(arrayBuffer, f => /^ppt\/slides\/slide\d+\.xml$/i.test(f));
  const slideNums = Object.keys(files)
    .map(f => ({ f, n: parseInt(f.match(/slide(\d+)/i)?.[1] ?? 0) }))
    .sort((a,b) => a.n - b.n);
  const parts = [];
  for (const {f, n} of slideNums) {
    const xml = files[f];
    const texts = [];
    const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const t = _xmlAttrDecode(m[1]).trim();
      if (t) texts.push(t);
    }
    if (texts.length) parts.push(`--- Slide ${n} ---\n${texts.join('\n')}`);
  }
  if (!parts.length) throw new Error('No slide text found — the file may use images only');
  return parts.join('\n\n');
}

async function _extractDocxText(arrayBuffer) {
  const files = await _zipExtractFiles(arrayBuffer, f => f === 'word/document.xml');
  const xml = files['word/document.xml'] || '';
  // Extract paragraph text (<w:t> elements)
  const parts = [];
  const re = /<w:t[^>]*>([\s\S]*?)<\/w:t>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const t = _xmlAttrDecode(m[1]);
    if (t.trim()) parts.push(t);
  }
  if (!parts.length) throw new Error('No text found in document');
  return parts.join(' ');
}

async function _extractXlsxText(arrayBuffer) {
  const files = await _zipExtractFiles(arrayBuffer,
    f => f === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/i.test(f));
  // Build shared strings table
  const ssXml = files['xl/sharedStrings.xml'] || '';
  const strings = [];
  const siRe = /<si>([\s\S]*?)<\/si>/gi;
  let m;
  while ((m = siRe.exec(ssXml)) !== null) {
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/gi;
    let tm; const parts = [];
    while ((tm = tRe.exec(m[1])) !== null) parts.push(_xmlAttrDecode(tm[1]));
    strings.push(parts.join(''));
  }
  // Extract cell values from sheets
  const sheetFiles = Object.keys(files).filter(f => /xl\/worksheets\/sheet\d+\.xml/i.test(f))
    .sort((a,b) => parseInt(a.match(/\d+/)?.[0]??0) - parseInt(b.match(/\d+/)?.[0]??0));
  const rows = [];
  for (const sf of sheetFiles) {
    const xml = files[sf];
    const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/gi;
    let rm;
    while ((rm = rowRe.exec(xml)) !== null) {
      const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;
      let cm; const cells = [];
      while ((cm = cellRe.exec(rm[1])) !== null) {
        const attrs = cm[1]; const inner = cm[2];
        const isStr = /t="s"/.test(attrs);
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (!vMatch) { cells.push(''); continue; }
        const val = isStr ? (strings[parseInt(vMatch[1])] ?? '') : _xmlAttrDecode(vMatch[1]);
        cells.push(val);
      }
      if (cells.some(c=>c)) rows.push(cells.join('\t'));
    }
  }
  if (!rows.length) throw new Error('No cell data found in spreadsheet');
  return rows.join('\n');
}

// ── Flashcard & Quiz inline renderer ──────────────────────────────────────────
const _FC_COLORS = [
  ['#667eea','#764ba2'], ['#f093fb','#f5576c'], ['#4facfe','#00f2fe'],
  ['#43e97b','#38f9d7'], ['#fa709a','#fee140'], ['#a18cd1','#fbc2eb'],
  ['#fccb90','#d57eeb'], ['#a1c4fd','#c2e9fb'], ['#fd7043','#ff8a65'],
  ['#26c6da','#00acc1'], ['#66bb6a','#43a047'], ['#ef5350','#e53935'],
  ['#ab47bc','#7b1fa2'], ['#ffa726','#fb8c00'], ['#29b6f6','#0277bd'],
];

function _escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _replaceFence(bubble, lang, newEl) {
  const code = bubble.querySelector(`code.language-${lang}`);
  if (code && code.closest('pre')) {
    code.closest('pre').replaceWith(newEl);
  } else {
    bubble.appendChild(newEl);
  }
}

function injectStudyCards(bubble, text) {
  if (!bubble || !text) return;

  // ── Flashcards ─────────────────────────────────────────────────────────────
  const fcRe = /```flashcards\s*([\s\S]*?)```/i;
  const fcMatch = text.match(fcRe);
  if (fcMatch) {
    let cards;
    try { cards = JSON.parse(fcMatch[1].trim()); } catch(e) { cards = null; }
    if (Array.isArray(cards) && cards.length) {
      const deck = document.createElement('div');
      deck.className = 'fc-deck';
      cards.forEach((c, i) => {
        const [c1, c2] = _FC_COLORS[i % _FC_COLORS.length];
        const front = _escHtml(c.front || c.term || c.question || '');
        const back  = _escHtml(c.back  || c.answer || c.definition || '');
        const card  = document.createElement('div');
        card.className = 'fc-card';
        card.setAttribute('data-fc', i);
        card.innerHTML =
          `<div class="fc-inner">` +
            `<div class="fc-front" style="background:linear-gradient(135deg,${c1},${c2});">` +
              `<span class="fc-num">${i+1}/${cards.length}</span>` +
              `${front}` +
              `<span class="fc-meta">tap to flip ↩</span>` +
            `</div>` +
            `<div class="fc-back" style="background:linear-gradient(135deg,${c2},${c1});">` +
              `${back}` +
              `<span class="fc-meta">tap to flip ↩</span>` +
            `</div>` +
          `</div>`;
        deck.appendChild(card);
      });
      deck.addEventListener('click', e => {
        const card = e.target.closest('.fc-card');
        if (card) card.classList.toggle('flipped');
      });
      _replaceFence(bubble, 'flashcards', deck);
      return;
    }
  }

  // ── Quiz ────────────────────────────────────────────────────────────────────
  const qzRe = /```quiz\s*([\s\S]*?)```/i;
  const qzMatch = text.match(qzRe);
  if (qzMatch) {
    let qs;
    try { qs = JSON.parse(qzMatch[1].trim()); } catch(e) { qs = null; }
    if (Array.isArray(qs) && qs.length) {
      let score = 0, answered = 0;
      const wrap = document.createElement('div');
      wrap.className = 'qz-wrap';

      const scoreEl = document.createElement('div');
      scoreEl.className = 'qz-score';
      wrap.appendChild(scoreEl);

      const labels = ['A','B','C','D','E','F','G','H'];
      qs.forEach((q, qi) => {
        const opts = q.opts || q.options || [];
        const qDiv = document.createElement('div');
        qDiv.className = 'qz-q';

        const qText = document.createElement('div');
        qText.className = 'qz-qtext';
        qText.innerHTML = `<span style="opacity:.45;font-weight:400;margin-right:4px;">${qi+1}.</span>${_escHtml(q.q || q.question || '')}`;
        qDiv.appendChild(qText);

        const optsDiv = document.createElement('div');
        optsDiv.className = 'qz-opts';
        opts.forEach((o, oi) => {
          const btn = document.createElement('div');
          btn.className = 'qz-opt';
          btn.setAttribute('data-qi', qi);
          btn.setAttribute('data-oi', oi);
          btn.innerHTML = `<span class="qz-lbl">${labels[oi] || oi}.</span>${_escHtml(String(o))}`;
          optsDiv.appendChild(btn);
        });
        qDiv.appendChild(optsDiv);

        const expEl = document.createElement('div');
        expEl.className = 'qz-exp';
        expEl.textContent = q.exp || q.explanation || '';
        qDiv.appendChild(expEl);

        wrap.appendChild(qDiv);
      });

      wrap.addEventListener('click', e => {
        const opt = e.target.closest('.qz-opt');
        if (!opt || opt.classList.contains('disabled')) return;
        const qi  = parseInt(opt.dataset.qi, 10);
        const oi  = parseInt(opt.dataset.oi, 10);
        const q   = qs[qi];
        const correct = q.ans !== undefined ? q.ans : (q.answer !== undefined ? q.answer : 0);
        const qDiv = wrap.querySelectorAll('.qz-q')[qi];
        qDiv.querySelectorAll('.qz-opt').forEach(o => o.classList.add('disabled'));
        opt.classList.add(oi === correct ? 'correct' : 'wrong');
        if (oi !== correct) {
          const correctBtn = qDiv.querySelectorAll('.qz-opt')[correct];
          if (correctBtn) correctBtn.classList.add('correct');
        }
        const expEl = qDiv.querySelector('.qz-exp');
        if (expEl) expEl.style.display = 'block';
        if (oi === correct) score++;
        answered++;
        if (answered === qs.length) {
          const pct = Math.round(score / qs.length * 100);
          const emoji = pct === 100 ? '🏆' : pct >= 80 ? '🌟' : pct >= 60 ? '👍' : '📚';
          scoreEl.innerHTML = `${emoji} Final score: <strong>${score}/${qs.length}</strong> (${pct}%)`;
          scoreEl.style.display = 'block';
          scoreEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });

      _replaceFence(bubble, 'quiz', wrap);
    }
  }
}
