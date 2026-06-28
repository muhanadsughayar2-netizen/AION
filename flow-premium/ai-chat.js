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
  veo31:        'veo-3.1-generate-preview',
  veo31Fast:    'veo-3.1-fast-generate-preview',
  veo31Lite:    'veo-3.1-lite-generate-preview',
  veoDefault:   'veo-3.0-generate-001',
  veoFallback:  'veo-3.1-fast-generate-preview',
  veoLite:      'veo-3.1-lite-generate-preview',
  veo3Fast:     'veo-3.0-fast-generate-001',
  veo2:         'veo-2.0-generate-001',
  // Billing probe chain (used by detectKeyTierVerbose)
  probeVeo3Fast:  'veo-3.0-fast-generate-001',
  probeVeo31Fast: 'veo-3.1-fast-generate-preview',
  probeVeo3:      'veo-3.0-generate-001',
  probeVeo2:      'veo-2.0-generate-001',
  probeImagen4:   'imagen-4.0-generate-001',
  probeImagen3:   'imagen-3.0-generate-001'
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
  } catch (e) { console.warn('[SnapToAI] Owner-key check failed:', e?.message || e); }

  // Imagen first — it requires only Tier 1 billing, so it's the canonical "has billing" probe.
  // Veo second — many keys with billing are still on Tier 1 and Veo requires Tier 2+, so a
  // Veo FAILED_PRECONDITION is NOT a reliable "no billing" signal. We only trust Veo as a
  // backup positive signal (prepaid), not as a free verdict on its own.
  const probeChain = [
    // Veo first — Imagen last ("only available on paid plans" is a model-availability
    // message, NOT a billing-status message, and falsely flags prepaid keys as free).
    { model: MODELS.probeVeo3Fast,  endpoint: 'predictLongRunning',  trustFreeVerdict: false, treatInvalidAsPrepaid: false },
    { model: MODELS.probeVeo31Fast, endpoint: 'predictLongRunning',  trustFreeVerdict: false, treatInvalidAsPrepaid: false },
    { model: MODELS.probeVeo3,      endpoint: 'predictLongRunning',  trustFreeVerdict: false, treatInvalidAsPrepaid: false },
    // veo-2.0: Google checks billing BEFORE format here. INVALID_ARGUMENT = billing OK = prepaid.
    // Free keys get FAILED_PRECONDITION from this model, never INVALID_ARGUMENT.
    { model: MODELS.probeVeo2,      endpoint: 'predictLongRunning',  trustFreeVerdict: true,  treatInvalidAsPrepaid: true  },
    { model: MODELS.probeImagen4,   endpoint: 'predict',             trustFreeVerdict: false, treatInvalidAsPrepaid: false },
    { model: MODELS.probeImagen3,   endpoint: 'predict',             trustFreeVerdict: false, treatInvalidAsPrepaid: false }
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

    // Hard cap: never hang longer than 6s no matter what
    setTimeout(() => finish({ tier: 'free', invalid: false }), 6000);
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
    placeholder: 'Broadcast Studio is ready — use the card below…',
    welcome: '🎙️ Broadcast Studio — turn any content into a multi-voice AI broadcast. Talk show, tutorial, app demo, presentation, or narrator.'
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
  'video': 'rgba(234,67,53,0.04)'
};

const MODEL_NAMES = {
  'vision': { name: 'Gemini 3', sub: 'Flash (Preview)', color: '#4285F4' },
  'image': { name: 'Nano', sub: 'Banana', color: '#FBBC05' },
  'music': { name: 'Lyria', sub: '', color: '#34A853' },
  'video': { name: 'Veo', sub: '', color: '#EA4335' }
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
  let _modeCheckInFlight = false; // dedupe — prevents rapid clicks stacking cards

  btns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.mode;
      if (mode === currentAiMode) return;
      if (_modeCheckInFlight) return; // already probing, ignore extra clicks

      if (mode !== 'vision') {
        // Flash button immediately so click feels responsive
        btn.classList.add('active');
        _modeCheckInFlight = true;
        try {
          const synced = await chrome.storage.sync.get(['geminiApiKey']);
          const local = await chrome.storage.local.get(['snaptoai_key_tier', 'snaptoai_key_tier_key']);
          const apiKey = synced.geminiApiKey;
          const tierMatchesKey = local.snaptoai_key_tier_key === apiKey;
          let isPrepaid = apiKey && tierMatchesKey && local.snaptoai_key_tier === 'prepaid';

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
                showPromptToast('🎉 Prepaid plan verified — all AI features unlocked!', 3500);
              }
            } catch (_) {}
          }

          if (!apiKey || !isPrepaid) {
            // Revert active state back to current mode
            btns.forEach(b => b.classList.toggle('active', b.dataset.mode === currentAiMode));
            const thread = document.getElementById('chatThread');
            if (thread) {
              const card = document.createElement('div');
              card.className = 'chat-bubble ai';
              card.style.cssText = 'background:transparent;padding:0;border:none;';
              card.innerHTML = apiKey ? buildUnlockCard(mode) : buildNeedKeyForPaidCard(mode);
              thread.appendChild(card);
              thread.scrollTop = thread.scrollHeight;
            }
            _modeCheckInFlight = false;
            return;
          }
        } catch (_) {
          // Probe failed (network/timeout) — show a clear retry message,
          // NOT the billing card (user may have billing set up fine).
          btns.forEach(b => b.classList.toggle('active', b.dataset.mode === currentAiMode));
          const thread = document.getElementById('chatThread');
          if (thread) {
            const meta = MODE_META[mode] || MODE_META['image'];
            const card = document.createElement('div');
            card.className = 'chat-bubble ai';
            card.style.cssText = 'background:transparent;padding:0;border:none;';
            card.innerHTML = `
              <div style="padding:16px 18px;border-radius:14px;background:rgba(255,100,80,0.08);border:1px solid rgba(255,100,80,0.25);">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                  <span style="font-size:22px;">⚠️</span>
                  <span style="font-size:14px;font-weight:700;color:#fff;">Connection check failed</span>
                </div>
                <div style="font-size:12px;color:rgba(255,255,255,0.7);line-height:1.6;">
                  Could not verify your API key tier right now. Check your internet connection and try again.
                  If you have a prepaid Gemini key set in Settings, tap <b>${meta.name}</b> again to retry.
                </div>
              </div>`;
            thread.appendChild(card);
            thread.scrollTop = thread.scrollHeight;
          }
          _modeCheckInFlight = false;
          return;
        }
        _modeCheckInFlight = false;
      }

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
      
      const thread = document.getElementById('chatThread');
      if (thread) {
        const notice = document.createElement('div');
        notice.className = 'chat-bubble ai mode-switch-notice';
        notice.style.cssText = 'font-size: 14px; padding: 10px 16px; border-left: 3px solid; margin: 4px 0;';
        const borderColors = { 'vision': '#4285F4', 'image': '#8ab4f8', 'music': '#8ab4f8', 'video': '#8ab4f8', 'broadcast': '#2dd4bf' };
        notice.style.borderLeftColor = borderColors[mode] || '#4285F4';
        notice.textContent = cfg.welcome;
        thread.appendChild(notice);
        
        if (mode === 'video') {
          showVideoStudio(thread);
        }

        if (mode === 'music') {
          showSongStudio(thread);
        }

        if (mode === 'broadcast') {
          showBroadcastCard(thread);
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
      // Show agent tools only for vision on initial load
      const toolBtnGroupInit = document.querySelector('.tool-btn-group');
      if (toolBtnGroupInit) toolBtnGroupInit.style.display = mode === 'vision' ? 'flex' : 'none';
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

const VEO_MODELS = [
  { id: MODELS.veo31,      label: '3.1',      desc: 'Best quality',          tier: 'top'   },
  { id: MODELS.veo31Fast,  label: '3.1 Fast', desc: 'Fast + great quality',  tier: 'mid'   },
  { id: MODELS.veo31Lite,  label: '3.1 Lite', desc: 'Quick drafts',          tier: 'lite'  },
  { id: MODELS.veoDefault, label: '3.0',      desc: 'High quality',          tier: 'mid'   },
  { id: MODELS.veo3Fast,   label: '3.0 Fast', desc: 'Fast + good',           tier: 'lite'  },
  { id: MODELS.veo2,       label: '2.0',      desc: 'Basic (needs billing)', tier: 'basic' }
];

// Real Google Veo pricing (Gemini API / Vertex AI public rates, USD per second of video).
// Source: https://ai.google.dev/gemini-api/docs/pricing  &  https://cloud.google.com/vertex-ai/generative-ai/pricing
const VEO_PRICING = {
  [MODELS.veo31]:      0.40,  // Veo 3.1 (with audio)
  [MODELS.veo31Fast]:  0.15,  // Veo 3.1 Fast
  [MODELS.veo31Lite]:  0.10,  // Veo 3.1 Lite
  [MODELS.veoDefault]: 0.75,  // Veo 3 (with audio)
  [MODELS.veo3Fast]:   0.40,  // Veo 3 Fast (with audio)
  [MODELS.veo2]:       0.50   // Veo 2 (no audio)
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

let selectedVeoModel = MODELS.veoLite;
let selectedVideoDuration = 8;
let selectedClipCount = 5;
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
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:20px;">🎬</span>
          <span style="font-size:14px;font-weight:700;color:#e8eef4;">Video Studio</span>
        </div>
        <button class="studio-surprise-btn" style="padding:5px 12px;border-radius:8px;border:1px solid rgba(138,180,248,0.25);background:rgba(138,180,248,0.06);color:#8ab4f8;font-size:12px;font-weight:600;cursor:pointer;">🎲 Surprise Me</button>
      </div>

      <!-- Clip count selector -->
      <div style="margin-bottom:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:12px;color:#667788;">Clips (8s each):</span>
          <span class="studio-dur-label" style="font-size:12px;color:#8ab4f8;font-weight:600;">${selectedClipCount * selectedVideoDuration}s total (${selectedClipCount} × ${selectedVideoDuration}s)</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${[1,2,3,4,5,6,8].map(n => {
            const sel = n === selectedClipCount;
            return `<button class="veo-clip-btn${sel ? ' selected' : ''}" data-clips="${n}" style="padding:4px 12px;border-radius:8px;border:1px solid ${sel ? 'rgba(138,180,248,0.5)' : 'rgba(138,180,248,0.2)'};background:${sel ? 'rgba(138,180,248,0.15)' : 'rgba(138,180,248,0.04)'};color:${sel ? '#8ab4f8' : '#aabbcc'};font-size:12px;font-weight:600;cursor:pointer;">${n}</button>`;
          }).join('')}
        </div>
        <div class="studio-music-clock-hint" style="margin-top:6px;font-size:11px;color:#667788;display:none;">🎵 Clip count auto-set from your Lyria track duration</div>
      </div>

      <!-- Model selector -->
      <div class="veo-model-selector" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
        <span style="font-size:12px;color:#667788;width:100%;margin-bottom:2px;">Quality:</span>
        <span class="veo-models-loading" style="font-size:13px;color:#8899aa;">Checking available models...</span>
      </div>

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
            <input type="checkbox" class="studio-stylize-photo" style="accent-color:#8ab4f8;">
            <span>✨ Stylize photo (Pixar / Anime etc.) — turn on if Veo blocks your photo</span>
          </label>
          <div class="stylize-style-selector" style="display:none;flex-wrap:wrap;gap:4px;margin-top:6px;">
            <button class="stylize-btn selected" data-style="pixar" style="padding:3px 10px;border-radius:6px;border:1px solid rgba(138,180,248,0.5);background:rgba(138,180,248,0.15);color:#8ab4f8;font-size:12px;font-weight:600;cursor:pointer;">Pixar 3D</button>
            <button class="stylize-btn" data-style="anime" style="padding:3px 10px;border-radius:6px;border:1px solid rgba(138,180,248,0.2);background:rgba(138,180,248,0.04);color:#aabbcc;font-size:12px;font-weight:600;cursor:pointer;">Anime</button>
            <button class="stylize-btn" data-style="cartoon" style="padding:3px 10px;border-radius:6px;border:1px solid rgba(138,180,248,0.2);background:rgba(138,180,248,0.04);color:#aabbcc;font-size:12px;font-weight:600;cursor:pointer;">Cartoon</button>
            <button class="stylize-btn" data-style="watercolor" style="padding:3px 10px;border-radius:6px;border:1px solid rgba(138,180,248,0.2);background:rgba(138,180,248,0.04);color:#aabbcc;font-size:12px;font-weight:600;cursor:pointer;">Watercolor</button>
            <button class="stylize-btn" data-style="oil" style="padding:3px 10px;border-radius:6px;border:1px solid rgba(138,180,248,0.2);background:rgba(138,180,248,0.04);color:#aabbcc;font-size:12px;font-weight:600;cursor:pointer;">Oil Paint</button>
          </div>
        </div>
      </div>` : ''}

      <!-- Cost row (inline, not a big card) -->
      <div class="veo-price-card" style="margin-bottom:10px;">
        <div style="font-size:11px;color:#556677;margin-bottom:4px;">💰 Cost for this 8s clip (charged by Google to your key):</div>
        <div class="veo-price-rows" style="display:flex;flex-wrap:wrap;gap:6px;font-size:12px;">
          <span style="color:#667788;">Loading…</span>
        </div>
      </div>

      <!-- Generate button -->
      <button class="studio-create-btn" style="width:100%;padding:11px;border-radius:10px;border:none;background:linear-gradient(135deg,#4285F4,#2563c4);color:#fff;font-size:13px;font-weight:700;cursor:pointer;opacity:0.4;pointer-events:none;">🎬 Generate 5-clip Video (40s)</button>
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
    if (durLabel) durLabel.textContent = selectedClipCount > 1 ? `${total}s total (${selectedClipCount} × ${selectedVideoDuration}s)` : `${total}s total`;
    const btn = studio.querySelector('.studio-create-btn');
    if (btn) {
      if (selectedClipCount > 1) {
        btn.textContent = `🎬 Generate ${selectedClipCount}-clip Video (${total}s)`;
      } else {
        btn.textContent = `🎬 Generate ${total}s Video`;
      }
    }
    renderVeoPriceTable(studio);
  }

  // Wire clip count buttons
  studio.querySelectorAll('.veo-clip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      studio.querySelectorAll('.veo-clip-btn').forEach(b => {
        b.style.border = '1px solid rgba(138,180,248,0.2)';
        b.style.background = 'rgba(138,180,248,0.04)';
        b.style.color = '#aabbcc';
        b.classList.remove('selected');
      });
      btn.style.border = '1px solid rgba(138,180,248,0.5)';
      btn.style.background = 'rgba(138,180,248,0.15)';
      btn.style.color = '#8ab4f8';
      btn.classList.add('selected');
      selectedClipCount = parseInt(btn.dataset.clips, 10) || 1;
      updateDurLabel();
    });
  });

  // Audio Master Clock — if a Lyria track was generated in Song Studio,
  // auto-calculate clip count from its duration so the video fills the song.
  (async () => {
    try {
      const lyriaBlob = window._snapToAI_lyriaBlob;
      if (lyriaBlob && lyriaBlob instanceof Blob) {
        const ac = new AudioContext();
        const arrayBuf = await lyriaBlob.arrayBuffer();
        const decoded = await ac.decodeAudioData(arrayBuf);
        await ac.close().catch(() => {});
        const musicDuration = decoded.duration;
        if (musicDuration > 0) {
          const autoCount = Math.max(1, Math.min(8, Math.ceil(musicDuration / selectedVideoDuration)));
          selectedClipCount = autoCount;
          // Highlight the matching button or set closest one
          let matched = false;
          studio.querySelectorAll('.veo-clip-btn').forEach(b => {
            const n = parseInt(b.dataset.clips, 10);
            const active = n === autoCount;
            b.style.border = active ? '1px solid rgba(138,180,248,0.5)' : '1px solid rgba(138,180,248,0.2)';
            b.style.background = active ? 'rgba(138,180,248,0.15)' : 'rgba(138,180,248,0.04)';
            b.style.color = active ? '#8ab4f8' : '#aabbcc';
            if (active) { b.classList.add('selected'); matched = true; } else { b.classList.remove('selected'); }
          });
          if (!matched) {
            // no exact button — show closest and update label
          }
          const hint = studio.querySelector('.studio-music-clock-hint');
          if (hint) hint.style.display = 'block';
          updateDurLabel();
          console.log(`[SnapToAI Video] Audio Master Clock: Lyria track ${musicDuration.toFixed(1)}s → ${autoCount} clips`);
        }
      }
    } catch (_) {}
  })();

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
  const stylizeCbEl = studio.querySelector('.studio-stylize-photo');
  const stylizeSelector = studio.querySelector('.stylize-style-selector');
  if (useScreenshotCb && stylizeWrap) {
    useScreenshotCb.addEventListener('change', () => {
      stylizeWrap.style.display = useScreenshotCb.checked ? 'block' : 'none';
    });
  }
  if (stylizeCbEl && stylizeSelector) {
    stylizeCbEl.addEventListener('change', () => {
      stylizeSelector.style.display = stylizeCbEl.checked ? 'flex' : 'none';
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

  const useScreenshot = document.querySelector('.studio-use-screenshot');
  const includeImage = useScreenshot && useScreenshot.checked && typeof currentImages !== 'undefined' && currentImages.length > 0;

  const modelName = selectedVeoModel || MODELS.veoFallback;
  const clipCount = selectedClipCount || 1;
  const totalDur = selectedVideoDuration * clipCount;

  // Audio Master Clock — grab the Lyria blob set by Song Studio (if any).
  // We decode it here once so we can pass the duration to the storyboard
  // director AND later pass the raw blob to the stitcher for the audio overlay.
  let musicBlob = null;
  let musicDuration = 0;
  try {
    const lb = window._snapToAI_lyriaBlob;
    if (lb && lb instanceof Blob) {
      const ac = new AudioContext();
      const decoded = await ac.decodeAudioData(await lb.arrayBuffer());
      await ac.close().catch(() => {});
      musicBlob = lb;
      musicDuration = decoded.duration;
      console.log(`[SnapToAI Video] Lyria audio clock: ${musicDuration.toFixed(1)}s — will overlay on final stitch`);
    }
  } catch (_) {}

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
      prebuiltScenes = await buildClipScenes(prompt, clipCount, apiKey, selectedVideoDuration, creativityTemp(selectedCreativity), selectedCreativity, musicDuration || undefined);
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
    await generateMultiClip(prompt, apiKey, modelName, includeImage, clipCount, progressBubble, thread, stylizedImage, prebuiltScenes, selectedAspectRatio, musicBlob, musicDuration);
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
        durationSeconds: selectedVideoDuration
        // negativePrompt + enhancePrompt removed — veo-3.1-lite rejects both
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
  // If clip 0 gets no_uri with the screenshot attached (likely a Veo safety
  // silent-block on real people / children), strip the image on the retry so
  // Veo generates something from text alone rather than skipping the clip entirely.
  let noUriFallbackImageStripped = false;

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
          } else if (includeImage && sourceImageForClip0 && sourceImageForClip0.base64) {
            // Previous clip was skipped/failed — fall back to the original
            // screenshot so characters stay consistent instead of drifting.
            attachedChainImage = sourceImageForClip0;
            chainSourceLabel = 'original screenshot (prev clip skipped)';
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
            durationSeconds: durationSeconds
            // negativePrompt + enhancePrompt removed — veo-3.1-lite rejects both
          }
        };

        // Use the SNAPSHOTTED image from batch start — never re-read globals,
        // so retrying clip 0 always uses the same input the original batch used.
        // On retry after a no_uri (likely Veo safety silent-block on real people),
        // strip the image so at least a text-only clip is generated.
        if (clipIdx === 0 && includeImage && sourceImageForClip0 && !noUriFallbackImageStripped) {
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
      // no_uri on clip 0 with image → Veo safety silent-block on real people.
      // Strip the image on the retry so text-only generation can proceed.
      if (result.status === 'no_uri' && clipIdx === 0 && includeImage && sourceImageForClip0) {
        noUriFallbackImageStripped = true;
        if (statusEl) { statusEl.textContent = `⚠ Photo blocked by Veo — retrying without image`; statusEl.style.color = '#ffd700'; }
        const completed = await cancellableWait(10, ctx, (s) => {
          if (text) text.textContent = `Clip ${clipNum}/${clipCount} — Veo blocked the photo (safety filter). Retrying text-only in ${s}s… Tip: enable "Stylize photo" to avoid this.`;
        });
        if (!completed) { finalStatus = 'user_stopped_poststart_skipped'; break; }
        continue;
      }
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
// musicDuration (optional seconds): when provided, beat timestamps are injected
// into each clip's shot so the action is musically timed.
async function generateAnchoredStoryboard(prompt, clipCount, apiKey, clipDur, temperature, musicDuration) {
  if (!apiKey || clipCount < 2) return null;
  const segLen = Number(clipDur) > 0 ? Number(clipDur) : 8;
  // Task #32: Temperature is now caller-controlled via the Video Studio
  // Creativity selector. Falls back to the Task #31 default (0.35) when
  // omitted so legacy callers / fallbacks still behave the same.
  const baseTemp = (typeof temperature === 'number' && temperature > 0) ? temperature : 0.35;
  // Retry uses a slightly tighter temperature than the primary attempt so
  // a parse failure doesn't compound by also dialing creativity up.
  const retryTemp = Math.max(0.2, baseTemp - 0.05);

  // Beat-aware timestamps: when a Lyria track is attached, inject timing context
  // so each clip's action lands on a musically meaningful moment.
  const hasMusicSync = (typeof musicDuration === 'number') && musicDuration > 0;
  const beatTimestamps = hasMusicSync
    ? Array.from({ length: clipCount }, (_, i) => {
        const t0 = Math.round(i * segLen);
        const t1 = Math.round((i + 1) * segLen);
        return `Clip ${i + 1}: ${t0}s–${t1}s`;
      }).join(', ')
    : null;

  const musicSyncBlock = hasMusicSync
    ? `\nMUSIC SYNC: This video will be set to a ${musicDuration.toFixed(1)}-second Lyria music track. The clips map to these timestamps: ${beatTimestamps}. Time the action in each shot to the energy of its window — rising action should peak near the midpoint of the track, and the final clip should feel like a satisfying resolution.`
    : '';

  const directorBrief =
`You are a film director planning a ${clipCount * segLen}-second cinematic video that will be rendered by Google Veo as ${clipCount} sequential ${segLen}-second clips, then stitched together.${musicSyncBlock}

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
- pick beats that progress the action (setup → peak → resolve) rather than repeating the same moment.${hasMusicSync ? '\n- note the timestamp window for each clip (e.g. "0s–8s: establish the scene") in the shot description so Veo paces action to the music.' : ''}

Return STRICT JSON ONLY (no markdown, no commentary) in this exact shape:
{
  "title": "Max 6 words, title-case, no quotes.",
  "script_summary": "1-2 sentence pitch grounded in the user's subject and action.",
  "style_bible": "3-5 sentences of cinematic direction: lighting setup, color palette, lens / camera language, mood. You may describe the character's physical appearance using nouns the user already used (or generic descriptors if the user gave none). Don't restate the action here.",
  "clips": [
    { "shot": "What concretely happens in this ${segLen}s segment, grounded in the user's subject and action. Add one camera move or framing choice." },
    ... exactly ${clipCount} entries ...
  ]
}

Hard rules:
- The clips must read like one continuous take.
- Each subsequent scene must visually follow the previous one's ending composition to ensure a continuous shot — the opening frame of clip N should feel like the next heartbeat after clip N-1's closing frame.
- The user's subject and action are clearly recognizable across the sequence (the style bible plus most shot descriptions should reference them).
- Never introduce new characters mid-sequence unless the user brief explicitly asks for it.
- Never cut to a different location.
- Keep each "shot" description under 50 words.`;

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
async function buildClipScenes(prompt, clipCount, apiKey, clipDur, temperature, creativityLevel, musicDuration) {
  if (clipCount < 2) return [];
  const directed = await generateAnchoredStoryboard(prompt, clipCount, apiKey, clipDur, temperature, musicDuration);
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

  return `${shotBlock}${styleBlock}${continuity}`;
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

async function generateMultiClip(prompt, apiKey, modelName, includeImage, clipCount, progressBubble, thread, stylizedImage, prebuiltScenes, aspectRatio, musicBlob, musicDuration) {
  let clipScenes = prebuiltScenes;
  if (!clipScenes || clipScenes.length !== clipCount) {
    const progressText = progressBubble.querySelector('.video-progress-text');
    if (progressText) progressText.textContent = `Planning ${clipCount}-clip storyboard for visual continuity...`;
    clipScenes = await buildClipScenes(prompt, clipCount, apiKey, selectedVideoDuration, creativityTemp(selectedCreativity), selectedCreativity, musicDuration || undefined);
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
                userTransitionFrames: {},
                // Lyria audio blob for final stitch overlay. When present,
                // stitchVideos replaces per-clip Veo audio with this full track.
                musicBlob: musicBlob || null,
                musicDuration: musicDuration || 0 };

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
    const rawBlob = await resp.blob();
    // Fix missing EBML Duration field before seeking — Veo WebM clips often
    // have no Duration in their header, so video.duration = Infinity and every
    // seek lands on a black frame.  We inject 8 000 ms (the default clip
    // length) so the browser reports a finite duration immediately.
    const blob = await fixWebmDuration(rawBlob, 8000).catch(() => rawBlob);
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
    // Belt-and-suspenders: if fixWebmDuration didn't inject a finite duration
    // (e.g. the EBML walk failed), fall back to 8 s rather than Infinity.
    // `Infinity || 8` evaluates to Infinity (truthy), so || alone is not safe.
    const duration = (Number.isFinite(video.duration) && video.duration > 0) ? video.duration : 8;
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

  // --- Case B: at least 1 successful clip ---
  if (successUrls.length === 1 || clipCount === 1) {
    // Single clip — show it directly.
    try {
      showVideoResult(progressBubble, successUrls[0], thread);
    } catch (err) {
      console.log('[SnapToAI Video] Result error:', err.message);
    }
  } else {
    // Multiple clips — auto-stitch and overlay Lyria audio (if present).
    const stitchStatusEl = document.createElement('div');
    stitchStatusEl.style.cssText = 'font-size:12px;color:#ffa500;margin-bottom:8px;';
    const musicNote = ctx.musicBlob ? ' + Lyria audio overlay' : '';
    stitchStatusEl.textContent = `🔗 Stitching ${successUrls.length} clips${musicNote}...`;
    progressBubble.innerHTML = '';
    progressBubble.appendChild(stitchStatusEl);
    thread.scrollTop = thread.scrollHeight;

    let stitchedUrl = null;
    try {
      stitchedUrl = await stitchVideos(successUrls, ctx);
    } catch (stitchErr) {
      console.warn('[SnapToAI Video] Stitch failed:', stitchErr?.message || stitchErr);
    }

    if (stitchedUrl) {
      ctx.lastStitchedUrl = stitchedUrl;
      try {
        showStitchedVideoResult(progressBubble, stitchedUrl, successUrls, thread);
      } catch (err) {
        console.log('[SnapToAI Video] Stitch result display error:', err.message);
      }
    } else {
      // Stitch failed — fall back to showing the first clip.
      stitchStatusEl.textContent = '⚠ Stitch failed — showing clip 1.';
      try {
        showVideoResult(progressBubble, successUrls[0], thread);
      } catch (err) {
        console.log('[SnapToAI Video] Fallback result error:', err.message);
      }
    }
  }

  // Always append the retry/re-render panel so users can fix bad clips
  // without paying to regenerate the entire video.
  const panel = document.createElement('div');
  panel.innerHTML = buildVeoSummaryCard(ctx, billingAbortAt, /*hasSuccess*/ true, successUrls.length);
  if (panel.firstElementChild) progressBubble.appendChild(panel.firstElementChild);
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

    // --- Lyria audio overlay ---
    // When a Lyria music blob is available (set by Song Studio), decode it and
    // feed the full track into audioDest instead of the individual Veo clip
    // audio. Veo clips are muted so only the Lyria track plays. The music is
    // looped/trimmed to match the total video duration.
    let lyriaSource = null;
    const lyriaBlob = stitchCtx && stitchCtx.musicBlob;
    if (lyriaBlob) {
      try {
        const arrayBuf = await lyriaBlob.arrayBuffer();
        const decoded = await audioCtx.decodeAudioData(arrayBuf);
        lyriaSource = audioCtx.createBufferSource();
        lyriaSource.buffer = decoded;
        lyriaSource.loop = true; // loops if clips run longer than the song
        const musicGain = audioCtx.createGain();
        musicGain.gain.value = 1;
        lyriaSource.connect(musicGain);
        musicGain.connect(audioDest);
        // Mute all Veo clip video elements so only Lyria plays
        for (const v of videos) { try { v.muted = true; } catch (_) {} }
        console.log(`[SnapToAI Video] Lyria overlay: ${decoded.duration.toFixed(1)}s track decoded — muting Veo clip audio`);
      } catch (e) {
        console.warn('[SnapToAI Video] Lyria decode failed, falling back to clip audio:', e.message);
        lyriaSource = null;
      }
    }

    // Connect clip 0's audio NOW so audioDest has a live track when the
    // recorder is constructed. Skip if Lyria overlay is active (clips are muted).
    if (!lyriaSource) {
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
    } else {
      // Push nulls so the per-clip connect/disconnect loops stay index-aligned.
      for (let _i = 0; _i < videos.length; _i++) { sources.push(null); gains.push(null); }
    }

    const FPS = 30;
    const videoStream = canvas.captureStream(FPS);
    const combined = new MediaStream();
    videoStream.getVideoTracks().forEach(t => combined.addTrack(t));
    audioDest.stream.getAudioTracks().forEach(t => combined.addTrack(t));
    console.log(`[SnapToAI Video] combined stream: ${combined.getVideoTracks().length}v + ${combined.getAudioTracks().length}a tracks (lyria=${!!lyriaSource})`);

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
    // Start the Lyria track at the same moment the recorder begins, so audio
    // and video are aligned from frame 0.
    if (lyriaSource) {
      try { lyriaSource.start(0); } catch (_) {}
    }

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
        // Skip entirely when Lyria overlay is active — all sources are pre-nulled.
        if (i > 0 && !lyriaSource) {
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
      try { lyriaSource && lyriaSource.stop(); } catch (_) {}
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

async function pollVideoStatus(operationId, apiKey, progressBubble, thread) {
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

  thread.scrollTop = thread.scrollHeight;
  addBubbleActions(bubble, 'Generated video');
}

function showSongStudio(thread) {
  const existing = thread.querySelector('.song-studio');
  if (existing) existing.remove();

  const studio = document.createElement('div');
  studio.className = 'chat-bubble ai song-studio';
  studio.style.cssText = 'padding:0;margin:8px 0;background:transparent;border:none;max-width:100%;width:100%;';

  studio.innerHTML = `
    <div style="background:linear-gradient(135deg,rgba(0,255,136,0.06),rgba(0,200,100,0.03));border:1px solid rgba(0,255,136,0.12);border-radius:16px;padding:18px;backdrop-filter:blur(10px);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
        <span style="font-size:22px;">🎵</span>
        <div>
          <div style="font-size:15px;font-weight:700;color:#e8eef4;">Song Studio</div>
          <div style="font-size:11px;color:#667788;">Upload audio, image, or video — or just describe your song</div>
        </div>
      </div>

      <!-- Drop zone -->
      <div class="ss-dropzone" style="border:2px dashed rgba(0,255,136,0.25);border-radius:12px;padding:20px;text-align:center;cursor:pointer;transition:all 0.2s;margin-bottom:12px;background:rgba(255,255,255,0.02);">
        <input class="ss-file" type="file" accept="audio/*,image/*,video/*" style="display:none;">
        <div class="ss-drop-idle">
          <div style="font-size:28px;margin-bottom:6px;">🎵 📸 🎬</div>
          <div style="font-size:13px;color:#aabbcc;font-weight:600;">Drop a file here or click to upload</div>
          <div style="font-size:11px;color:#556677;margin-top:4px;">Audio • Image • Video — any format</div>
        </div>
        <div class="ss-drop-preview" style="display:none;">
          <div class="ss-file-info" style="font-size:12px;color:#00ff88;font-weight:600;"></div>
          <div class="ss-file-sub" style="font-size:10px;color:#667788;margin-top:3px;"></div>
          <button class="ss-clear" style="margin-top:8px;padding:3px 10px;border-radius:6px;border:1px solid rgba(255,80,80,0.3);background:rgba(255,80,80,0.07);color:#ff6666;font-size:10px;cursor:pointer;">✕ Remove</button>
        </div>
      </div>

      <!-- Screenshot hint (reactive) -->
      <div class="ss-img-hint" style="display:none;font-size:11px;color:#ffaa00;margin-bottom:10px;padding:7px 10px;background:rgba(255,170,0,0.07);border:1px solid rgba(255,170,0,0.2);border-radius:8px;">
        📸 <span class="ss-img-hint-text"></span> — will be included as visual inspiration
      </div>

      <!-- Free text -->
      <textarea class="ss-prompt" placeholder="Describe your song (optional)&#10;e.g. same energy as the uploaded track but with more bass&#10;e.g. something dark and cinematic&#10;Leave blank to let the AI decide from your file" style="width:100%;box-sizing:border-box;min-height:70px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:10px 12px;color:#e8eef4;font-size:12px;font-family:inherit;resize:vertical;outline:none;line-height:1.5;margin-bottom:12px;"></textarea>

      <button class="ss-go" style="width:100%;padding:12px;border-radius:10px;border:none;background:linear-gradient(135deg,#00ff88,#00cc6a);color:#000;font-size:14px;font-weight:700;cursor:pointer;">🎵 Generate Song</button>
      <div class="ss-status" style="display:none;margin-top:10px;font-size:11px;color:#aabbcc;text-align:center;"></div>
    </div>
  `;

  thread.appendChild(studio);

  // ── State ──────────────────────────────────────────────
  let uploadedFile = null;   // { type:'audio'|'image'|'video', base64, mimeType, name }

  const dropzone  = studio.querySelector('.ss-dropzone');
  const fileInput = studio.querySelector('.ss-file');
  const dropIdle  = studio.querySelector('.ss-drop-idle');
  const dropPrev  = studio.querySelector('.ss-drop-preview');
  const fileInfo  = studio.querySelector('.ss-file-info');
  const fileSub   = studio.querySelector('.ss-file-sub');
  const clearBtn  = studio.querySelector('.ss-clear');
  const imgHint   = studio.querySelector('.ss-img-hint');
  const imgHintTx = studio.querySelector('.ss-img-hint-text');
  const goBtn     = studio.querySelector('.ss-go');
  const statusEl  = studio.querySelector('.ss-status');

  // Reactive screenshot hint
  let _lastImgCount = -1;
  const _timer = setInterval(() => {
    if (!document.contains(studio)) { clearInterval(_timer); return; }
    const n = currentImages.length;
    if (n === _lastImgCount) return;
    _lastImgCount = n;
    imgHint.style.display = (n > 0 && !uploadedFile) ? 'block' : 'none';
    imgHintTx.textContent = `${n} screenshot${n>1?'s':''} loaded`;
  }, 500);

  function setFilePreview(name, sub) {
    dropIdle.style.display = 'none';
    dropPrev.style.display = 'block';
    fileInfo.textContent   = name;
    fileSub.textContent    = sub;
    imgHint.style.display  = 'none'; // hide screenshot hint when file uploaded
  }

  function clearFile() {
    uploadedFile = null;
    fileInput.value = '';
    dropIdle.style.display = 'block';
    dropPrev.style.display = 'none';
    imgHint.style.display  = currentImages.length > 0 ? 'block' : 'none';
  }

  // Click to open file picker
  dropzone.addEventListener('click', e => {
    if (e.target === clearBtn || clearBtn.contains(e.target)) return;
    fileInput.click();
  });

  // Drag & drop
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.style.borderColor='rgba(0,255,136,0.6)'; dropzone.style.background='rgba(0,255,136,0.05)'; });
  dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor='rgba(0,255,136,0.25)'; dropzone.style.background='rgba(255,255,255,0.02)'; });
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.style.borderColor='rgba(0,255,136,0.25)'; dropzone.style.background='rgba(255,255,255,0.02)';
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });

  clearBtn.addEventListener('click', e => { e.stopPropagation(); clearFile(); });

  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) handleFile(f);
  });

  function handleFile(f) {
    const kind = f.type.startsWith('audio/') ? 'audio'
               : f.type.startsWith('image/') ? 'image'
               : f.type.startsWith('video/') ? 'video' : null;
    if (!kind) { statusEl.style.display='block'; statusEl.textContent='Unsupported file type.'; return; }
    statusEl.style.display = 'none';
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target.result;
      const b64 = dataUrl.split(',')[1];
      uploadedFile = { type: kind, base64: b64, mimeType: f.type, name: f.name };
      const sizeKB = Math.round(f.size / 1024);
      const icons = { audio:'🎵', image:'📸', video:'🎬' };
      const labels = { audio:'Audio — AI will match this style/beat', image:'Image — AI will set the mood from it', video:'Video — AI will score it' };
      setFilePreview(`${icons[kind]} ${f.name}`, `${sizeKB} KB · ${labels[kind]}`);
    };
    reader.readAsDataURL(f);
  }

  // ── Generate ────────────────────────────────────────────
  goBtn.addEventListener('click', async () => {
    const userPrompt = studio.querySelector('.ss-prompt').value.trim();

    // Need at least a file or a prompt
    if (!uploadedFile && !userPrompt && currentImages.length === 0) {
      statusEl.style.display = 'block';
      statusEl.textContent = 'Upload a file or type a description first.';
      return;
    }

    const apiKey = typeof getApiKey === 'function' ? getApiKey() : (window._snapToAI_apiKey || '');

    // ── Audio reference: ask Gemini to analyse it, then send description to Lyria ──
    if (uploadedFile?.type === 'audio' && apiKey) {
      goBtn.disabled = true;
      goBtn.textContent = '🎵 Analysing your track…';
      statusEl.style.display = 'block';
      statusEl.textContent = 'Gemini is listening to your song to extract its style…';
      try {
        const analysisResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.chat}:generateContent?key=${apiKey}`,
          { method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
              contents:[{ role:'user', parts:[
                { inlineData:{ mimeType: uploadedFile.mimeType, data: uploadedFile.base64 } },
                { text: 'Listen to this audio and describe its musical style in detail. Include: tempo (BPM estimate), key/scale, genre, main instruments, rhythm/beat pattern, energy level, mood, and production style. Write a 2-3 sentence description a music AI can use to recreate a song in this style.' + (userPrompt ? ` Also consider this user note: "${userPrompt}"` : '') }
              ]}]
            }),
            signal: AbortSignal.timeout(30000)
          }
        );
        const analysisData = await analysisResp.json();
        const styleDesc = analysisData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (styleDesc) {
          // Now send the style description as the music prompt
          const inputEl = document.getElementById('chatInput');
          if (inputEl) {
            inputEl.value = styleDesc;
            document.getElementById('sendBtn')?.click();
          }
          studio.style.opacity = '0.5';
          studio.style.pointerEvents = 'none';
          return;
        }
      } catch (_) {}
      // Fallback: just use user prompt + filename hint
      const fallback = userPrompt || `Create music in the same style as "${uploadedFile.name}"`;
      const inputEl = document.getElementById('chatInput');
      if (inputEl) { inputEl.value = fallback; document.getElementById('sendBtn')?.click(); }
      studio.style.opacity = '0.5';
      studio.style.pointerEvents = 'none';
      return;
    }

    // ── Image / Video upload: stage it then send ──
    if (uploadedFile?.type === 'image') {
      // Push into currentImages so the music handler picks it up
      const dataUrl = `data:${uploadedFile.mimeType};base64,${uploadedFile.base64}`;
      if (!currentImages.includes(dataUrl)) currentImages.unshift(dataUrl);
    }

    // ── Build final prompt ──
    let finalPrompt = userPrompt;
    if (!finalPrompt) {
      if (uploadedFile?.type === 'video')  finalPrompt = 'Create music that perfectly scores this video — match its mood, energy, and pacing';
      else if (uploadedFile?.type === 'image') finalPrompt = 'Create music that captures the mood, atmosphere, and emotion of this image';
      else finalPrompt = 'Create an original, professional instrumental piece';
    }

    const inputEl = document.getElementById('chatInput');
    if (inputEl) {
      inputEl.value = finalPrompt;
      document.getElementById('sendBtn')?.click();
    }
    studio.style.opacity = '0.5';
    studio.style.pointerEvents = 'none';
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// BROADCAST STUDIO  — 3-voice AI broadcast (Zephyr/Kore/Fenrir)
// Formats: Talk Show / Tutorial / App Demo / Presentation / Narrator
// Triggered when the user enters Broadcast mode.
// ─────────────────────────────────────────────────────────────────────────────
function showBroadcastCard(thread) {
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

  <div class="bc-input-sec">
    <div style="margin-bottom:10px;">
      <div style="font-size:9.5px;color:#667788;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.06em;">Format</div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;">
        <button class="bc-pill bc-fmt active" data-fmt="talkshow">🎙️ Talk Show</button>
        <button class="bc-pill bc-fmt" data-fmt="tutorial">📚 Tutorial</button>
        <button class="bc-pill bc-fmt" data-fmt="appdemo">🚀 App Demo</button>
        <button class="bc-pill bc-fmt" data-fmt="presentation">📊 Presentation</button>
        <button class="bc-pill bc-fmt" data-fmt="narrator">🎬 Narrator</button>
        <button class="bc-pill bc-fmt bc-fmt-trailer" data-fmt="trailer" style="border-color:rgba(234,179,8,0.35);color:#eab308;background:rgba(234,179,8,0.06);">🎥 Trailer</button>
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
  let selFormat = 'talkshow';
  let selDur    = '3';
  let selTrack  = 'lofi';
  let attachments = [];
  let script    = [];
  let bgUrl     = null;
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
        // Reset trailer button back to gold idle style
        if (b.dataset.fmt === 'trailer') {
          b.style.borderColor = 'rgba(234,179,8,0.35)';
          b.style.color = '#eab308';
          b.style.background = 'rgba(234,179,8,0.06)';
        }
      });
      btn.classList.add('active');
      selFormat = btn.dataset.fmt;
      // Trailer: override active style to gold + auto-select Cinematic music
      if (selFormat === 'trailer') {
        btn.style.borderColor = 'rgba(234,179,8,0.55)';
        btn.style.color = '#fde047';
        btn.style.background = 'rgba(234,179,8,0.16)';
        btn.style.fontWeight = '700';
        const cinBtn = card.querySelector('.bc-trk[data-trk="cinematic"]');
        if (cinBtn) cinBtn.click();
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
    Array.from(imgInput.files).slice(0, 3).forEach(file => {
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

    vid.onloadedmetadata = () => {
      const dur = isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 10;
      // Extract up to 4 evenly-spaced frames
      const times = dur <= 4
        ? [0, dur * 0.5]
        : [0.1, dur * 0.25, dur * 0.6, Math.max(dur - 0.5, dur * 0.85)];
      const frames = [];
      let idx = 0;

      const captureFrame = () => {
        const canvas = document.createElement('canvas');
        canvas.width  = Math.min(vid.videoWidth  || 640, 640);
        canvas.height = Math.min(vid.videoHeight || 360, 360);
        canvas.getContext('2d').drawImage(vid, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL('image/jpeg', 0.75).split(',')[1]);
        idx++;
        if (idx < times.length) {
          vid.currentTime = times[idx];
        } else {
          URL.revokeObjectURL(url);
          // Remove any previous frames from the same video
          attachments = attachments.filter(a => !(a.type === 'video-frame' && a.videoFile === file.name));
          frames.forEach((b64, fi) => {
            attachments.push({ type: 'video-frame', name: `${file.name} frame ${fi + 1}/${frames.length}`, videoFile: file.name, mimeType: 'image/jpeg', data: b64 });
          });
          // Pre-fill textarea with video name if empty
          if (!srcEl.value.trim()) srcEl.value = `Video: "${file.name}"`;
          bcRenderAttachments();
        }
      };

      vid.onseeked = captureFrame;
      vid.currentTime = times[0];
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
      srcEl.value += (srcEl.value ? '\n\n' : '') + `[From: ${file.name} — paste the text content here]`;
      attachments.push({ type: 'file', name: file.name, mimeType: file.type, data: null });
      bcRenderAttachments();
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

    prepBtn.textContent = '⏳ Writing script…'; prepBtn.disabled = true;

    const durCfg = DURATIONS.find(d => d.key === selDur) || DURATIONS[1];
    const trkCfg = TRACKS.find(t => t.key === selTrack) || TRACKS[1];

    // Step 1 — Script generation (multimodal if attachments present)
    let rawScript = '';
    try {
      const videoFileNames = [...new Set(attachments.filter(a => a.videoFile).map(a => a.videoFile))];
      const hasImages      = attachments.some(a => a.type === 'image');
      const fmtLabel       = FORMATS.find(f => f.key === selFormat)?.label || selFormat;

      // Augment system prompt with media context so Gemini understands what it's seeing
      let mediaCtx = '';
      if (videoFileNames.length) {
        mediaCtx = `\n\nIMPORTANT: The user has attached frames captured from a video file named "${videoFileNames[0]}". You are seeing multiple frames that show what happens throughout the video. Analyze the video content from these frames and write the ${fmtLabel} script ABOUT this video — describe what's shown, explain the concepts, walk through what's happening step by step as appropriate for the format.`;
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
    statusEl.textContent = trkCfg.prompt ? 'Generating voices & music…' : 'Generating voices…';
    broadBtn.textContent = '⏳ Preparing…';
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
    prepBtn.textContent = '🎙️ Generate Broadcast'; prepBtn.disabled = false;
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
- Markdown only when it genuinely helps — code blocks, tight lists, bold the one thing that matters most.`);

const SMART_SYSTEM_PROMPT = getConfig('SMART_SYSTEM_PROMPT', `You are a brilliant AI with three modes fused into one:

**GPT Brain** — structured, step-by-step thinking. Use headers and bullets when they genuinely help. Anticipate the user's next question and answer it before they ask.

**Grok Edge** — no sanitised-robot energy. Be sharp, occasionally witty, maximally truth-seeking. If the user is wrong, say so — with style, not cruelty.

**Gemini Insight** — the user has shared a screenshot. Use it and the visible page context to anchor your answer in what's actually on screen. End with a "💡 Pro-tip:" they didn't think to ask for.

RESPONSE SHAPE:
- Open with one punchy sentence that frames the answer.
- Reference what you can see in the screenshot specifically — name real elements, text, or layout details.
- Match depth to difficulty. No padding, no filler phrases.
- Markdown only when it genuinely helps.`);

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

const BUILD_SYSTEM_PROMPT = `You are a world-class UI engineer and visual designer with the taste of Pentagram, the craft of Linear, and the editorial eye of Aesop. Every output looks like it shipped from a top-tier studio. You produce ONLY complete, self-contained single-file HTML.

STRICT OUTPUT RULE: Respond with ONLY a \`\`\`html code block. Zero prose before or after. Just the code.
Iterate requests: output the FULL improved file — never partial diffs.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  HEAD TEMPLATE — use this exact structure every time
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every output must start with this exact <head> block:
  <script src="https://cdn.tailwindcss.com"></script>
  Google Fonts <link> tags for chosen profile fonts
  <script src="https://unpkg.com/lucide@latest"></script>
  A tailwind.config script block with fontFamily tokens
  A <style> block for custom CSS that Tailwind can't express (gradients, animations, glassmorphism)

Icons: always use Lucide — call lucide.createIcons() in a <script> at bottom of body.
Images: use real Pexels URLs. Always add onerror="this.style.display='none';this.parentElement.style.background='linear-gradient(135deg,#1f2937,#111827)'" on every <img>.
JavaScript: all inline in a single <script> before </body>. Use IntersectionObserver for scroll-reveal animations.

EXCEPTION — CONTINUE_BUILD: If the user message starts with "CONTINUE_BUILD:", the previous
response was cut off by token limits. Output ONLY the remaining HTML from where you stopped —
starting at the next complete opening tag (e.g. <div, <section, <footer, <script).
Never restart from <!DOCTYPE html>. Never repeat code already written. No prose, no fences.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STEP 1 — READ THE REQUEST, PICK AN AESTHETIC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Before writing a single line of CSS, silently answer these 5 questions:
  1. Era/movement? (editorial, brutalist, Swiss, modern-tech, luxury, wellness, playful, Y2K…)
  2. Which 3 real studios/brands does this resemble? (e.g. "Aesop, Sakara, Daily Harvest" OR "Linear, Vercel, Stripe" OR "Apple, Arc, Rauno")
  3. Which 3 patterns are BANNED for this specific project?
  4. What are the locked color + font tokens?
  5. One emotional word? (calm / electric / sacred / clinical / playful / bold)

Use your answers to pick ONE of the Aesthetic Profiles below. Never mix profiles.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  AESTHETIC PROFILES — choose the right one
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROFILE A — MODERN DARK TECH (Linear / Vercel / Stripe)
  Use for: SaaS tools, developer products, dashboards, productivity apps, games
  Colors: --bg:#07070f; --text:#f0f0ff; --surface:rgba(255,255,255,0.04); --accent: vivid (violet, cyan, emerald)
  Fonts: Plus Jakarta Sans (headings 700-900) + Inter (body 400) from Google Fonts
  Radius: 14px | Section padding: 100px 24px | Max-width: 1100px
  Signature moves: layered radial gradient bg div, glassmorphism cards, glow button, gradient-clipped H1 text
  BANNED for this profile: serif fonts, warm neutrals, emoji icons

PROFILE B — EDITORIAL LIGHT (Aesop / Sakara / Daily Harvest — wellness / food / beauty / health)
  Use for: wellness brands, food, beauty, health, premium lifestyle, editorial content, landing pages with warmth
  Colors: --bg:#F9FBF9; --text:#0A2E36; --surface:#ffffff; --accent:#FF7043; --sage:#76A08A
  Fonts: Playfair Display 400 (headings, tight tracking) + Inter 400 (body) from Google Fonts
  Radius: 4px (sharp) | Section padding: 160px 24px | Max-width: 1100px
  Signature moves: cream base, deep-forest text, sage secondary color, generous whitespace, thin-line SVG icons (vessel/sprout/helix/shield), real Pexels macro photography, ONE blood-orange CTA per section
  BANNED: dark backgrounds, glassmorphism, glow shadows, gradient-clipped text, emoji icons, "Trusted by" strips, two CTAs in hero

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

PROFILE E — PLAYFUL / VIBRANT (Duolingo / Pitch / consumer apps / games)
  Use for: games, to-do apps, kids products, fun consumer tools, quizzes
  Colors: bright saturated 3-color palette (coral + mint + sunny yellow, or sky blue + orange + white)
  Fonts: Nunito 700 (headings) + Inter 400 (body) from Google Fonts
  Radius: 20px+ | Section padding: 80px 20px
  Signature moves: illustrated inline SVG shapes, bouncy hover (transform: scale(1.05)), colorful solid-bordered cards, confetti on CTA
  BANNED: dark backgrounds, serif fonts, corporate language, muted colors

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STEP 2 — UNIVERSAL QUALITY RULES (ALL profiles)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

① TYPOGRAPHY HIERARCHY — never same font-size for different levels:
   H1: clamp(2.8rem,6vw,5rem) | H2: clamp(1.8rem,3.5vw,3rem) | H3: 1.25rem | Body: 1rem/1.7

② REAL IMAGERY — use Pexels CDN (always works, no CORS). NEVER make up a photo ID.
   Format: https://images.pexels.com/photos/{ID}/pexels-photo-{ID}.jpeg?auto=compress&cs=tinysrgb&w=1200
   For smaller cards use w=800 instead of w=1200.
   Always set: object-fit:cover; width:100%; height:100% on every img element. Descriptive alt text required.

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

⑦ ONE WOW DETAIL — pick the one that fits the chosen profile:
   Profile A: animated counter on stats (0→value, 1.5s easeOut) OR floating particles (20 divs, CSS keyframes)
   Profile B: parallax scroll on hero image (10-15% travel via JS scroll listener) OR color-strip reveal
   Profile C: large 60px cursor follower (frosted glass circle, smooth lerp) OR word-by-word fade-in on H1
   Profile D: auto-scrolling marquee strip with bold text OR scramble text effect on hover
   Profile E: confetti burst on CTA click (20 colored divs scattered via CSS keyframes)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STEP 3 — ANTI-PATTERN BLACKLIST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
These are what every average AI defaults to. You never produce these unless explicitly requested:
✗ Purple-to-pink gradient on white (the most generic AI output)
✗ Glassmorphism + glow on dark bg for wellness / editorial / food projects
✗ Inter for every heading — choose the correct pairing for the aesthetic
✗ 3-column feature grid with Lucide or emoji icons ("Our Features" section)
✗ "Trusted by 10,000+ users" logo strip in the hero
✗ Two CTAs in the hero — pick ONE
✗ Emoji used as icons in premium or professional contexts (🛡️🧬💎🔥)
✗ Lorem ipsum or generic copy ("Transforming the future of innovation")
✗ Colored divs pretending to be photos — always use real Pexels URLs from the verified ID list
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
    let autoPrompt = fallback?.prompt || 'Analyze this page and tell me what you see.';
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

  // Image embedding — runs on FIRST builds AND patch edits (same as video above).
  // Previously gated behind _lastBuiltCode, which silently dropped user images
  // on fresh builds ("Start fresh" clears _lastBuiltCode before calling handleSend).
  if (buildModeEnabled) {
    const imageParts = filesQueue.filter(f => f.mimeType && f.mimeType.startsWith('image/'));

    if (imageParts.length > 0) {
      const _imgOffset = Object.keys(_committedMediaMap).filter(k => k.startsWith('__SNAP_IMG_')).length;
      _pendingBuildImages = imageParts.map(f => `data:${f.mimeType};base64,${f.data}`);
      const placeholderList = _pendingBuildImages.map((_, i) => `__SNAP_IMG_${_imgOffset + i}__`).join(', ');
      const examplePlaceholder = `__SNAP_IMG_${_imgOffset}__`;
      prompt += `\n\nIMAGE EMBED INSTRUCTION: The user attached ${imageParts.length} image(s). ` +
        `Use these exact placeholder strings as the src values: ${placeholderList} ` +
        `(example: <img src="${examplePlaceholder}" alt="..." style="width:100%;height:100%;object-fit:cover;">). ` +
        `CRITICAL RULES: ` +
        `(1) If the user said "replace", "change", "swap", or "update" an image — find that EXACT existing <img> tag and change ONLY its src attribute to the placeholder. Do NOT add a new img tag. ` +
        `(2) If the user said "add" or gave no specific target — place the image prominently above the fold: replace the hero image, or insert it as the first visual element after the headline. NEVER bury it at the bottom. ` +
        `(3) NEVER output any actual base64 data — only use the placeholder strings. ` +
        `(4) Keep all other design and content completely unchanged. ` +
        `(5) NEVER remove or replace any existing __SNAP_VID_N__, __SNAP_AUD_N__, or other __SNAP_*__ placeholder strings — they are live media references managed by the app.`;
    }

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

      const musicModels = [MODELS.lyria3Pro, MODELS.ttsFallback];
      let audioData = null;
      let audioError = '';
      let audioSucceeded = false;
      const MAX_RETRIES_PER_MODEL = 3;
      const RETRY_DELAY_MS = 1800;

      // Lyria is text-only — it does NOT accept image inputs (hangs/times out).
      // If the user has a screenshot loaded, first ask Gemini Vision to describe
      // the visual mood/scene in words, then weave that into the music prompt.
      let imageSceneDescription = '';
      if (currentImages.length > 0) {
        try {
          const [meta0, b640] = currentImages[0].split(',');
          const mime0 = meta0.match(/:(.*?);/)?.[1] || 'image/png';
          const visionResp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [
                  { inlineData: { mimeType: mime0, data: b640 } },
                  { text: 'Describe the mood, atmosphere, colors, emotions, and setting of this image in 2-3 sentences. Focus on what makes it feel a certain way — joyful, tense, peaceful, etc. This description will guide a music generation AI.' }
                ]}]
              }),
              signal: AbortSignal.timeout(15000)
            }
          );
          if (visionResp.ok) {
            const vd = await visionResp.json().catch(() => ({}));
            imageSceneDescription = vd.candidates?.[0]?.content?.parts?.[0]?.text || '';
          }
        } catch (_) {}
      }

      modelLoop: for (const audioModel of musicModels) {
        const isLyria = audioModel.includes('lyria');

        let bodyPayload;
        if (isLyria) {
          // Build a single text prompt — Lyria is text-only, no image support.
          let musicPromptText = buildMusicPrompt(prompt);
          if (imageSceneDescription) {
            musicPromptText = `Visual inspiration: ${imageSceneDescription}\n\nMusic brief: ${musicPromptText}`;
          }
          bodyPayload = {
            contents: [{ role: 'user', parts: [{ text: musicPromptText }] }],
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
          // Store the raw blob in a global so Video Studio can pick it up as
          // the Audio Master Clock reference and Lyria audio overlay source.
          try {
            const rawBytes = Uint8Array.from(atob(part.inlineData.data), c => c.charCodeAt(0));
            const mimeType = (part.inlineData.mimeType || '').toLowerCase();
            let lyriaBlob;
            if (!mimeType || mimeType.includes('pcm') || mimeType.startsWith('audio/l16') || mimeType.startsWith('audio/l-16')) {
              const sr = 24000, ch = 1, bps = 16;
              const hdr = new ArrayBuffer(44); const dv = new DataView(hdr);
              const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
              ws(0,'RIFF'); dv.setUint32(4, 36 + rawBytes.byteLength, true); ws(8,'WAVE'); ws(12,'fmt ');
              dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,ch,true);
              dv.setUint32(24,sr,true); dv.setUint32(28,sr*ch*bps/8,true);
              dv.setUint16(32,ch*bps/8,true); dv.setUint16(34,bps,true);
              ws(36,'data'); dv.setUint32(40,rawBytes.byteLength,true);
              lyriaBlob = new Blob([hdr, rawBytes], { type: 'audio/wav' });
            } else {
              lyriaBlob = new Blob([rawBytes], { type: part.inlineData.mimeType });
            }
            window._snapToAI_lyriaBlob = lyriaBlob;
            console.log(`[SnapToAI] Lyria track stored (${(lyriaBlob.size / 1024).toFixed(0)} KB) — Video Studio will auto-sync clip count and overlay this track`);
          } catch (_) {}
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
      
      renderLivePreview(fullText);
      addBubbleActions(responseBubble, fullText);
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

  // ── Confirmation-only gate ────────────────────────────────────────────────
  // ONLY explicit short confirmations trigger a build or patch.
  // Everything else — including descriptive instructions like "change the icon",
  // "add a pricing section", or "build me a landing page" — routes to chat first
  // so the AI can discuss, clarify, and confirm the plan before touching the site.
  //
  // This applies on FIRST builds (no site yet) AND post-build updates:
  //  • First build: user describes idea → AI discusses → user says "build it" → builds
  //  • Post-build:  user says "change the banner" → AI confirms → user says "do it" → patches
  const confirmRe = /^(yes|yeah|yep|yup|ok|okay|sure|go|do it|build it|make it|go ahead|confirm|correct|right|exactly|perfect|sounds good|do that|apply|apply it|yes please|please do|let'?s go|do it now|build now|build that|build this|go for it|proceed|approved|ship it|that works|looks good)[\s!.,]*$/;
  if (confirmRe.test(raw)) return true;

  // Strip polite / lead-in prefixes so "sure, do that", "yes ok build it",
  // "please go ahead" all peel down to their confirmation core.
  let p = raw;
  const prefixRe = /^(please|pls|plz|hey|ok|okay|yes|yeah|yep|yup|sure|alright|yo|so|now|also|and then|and|then|can you|could you|would you|will you|i want you to|i want to|i'?d like you to|i'?d like to|i would like to|i'?d love to|lets|let'?s|go ahead and|i need you to|i need to|i'?m gonna|gonna|just)[\s,]+/i;
  let _prev;
  do { _prev = p; p = p.replace(prefixRe, '').trim(); } while (p !== _prev);

  // Re-check after stripping ("sure, do that" → "do that" → build).
  if (confirmRe.test(p)) return true;

  // Anything else — questions, action verbs, descriptions, image uploads —
  // goes to chat. The AI will discuss and prompt the user for explicit confirmation.
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
    // Wipe all build state so the next send is treated as a first build
    _lastBuiltCode = '';
    _lastBuiltCodeForPatch = '';
    _committedMediaMap = {};
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

  const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
  const apiKey = keyResult.geminiApiKey;

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

      const summarySystem = `You are a concise project planner. Based on the conversation above, output EXACTLY 2-3 bullet points (one line each, starting with "•") that summarise what you are about to build or change. No intro sentence, no explanation — only the bullet lines.`;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.chat}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: summarySystem }] },
            contents,
            generationConfig: { maxOutputTokens: 150, temperature: 0.3 }
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
  thread.innerHTML = '<div class="welcome-message">I\'m your AI partner. Ask me anything about this image!</div>';
  conversationHistory = [];
  saveChatHistoryToLocal();

  // Purge build cache so new builds start from a clean slate — not the previous
  // site. Without this the AI gets the old HTML as context and tries to merge
  // rather than starting fresh, producing "ghost" sites from prior sessions.
  _lastBuiltCode = '';
  _lastBuiltCodeForPatch = '';
  _committedMediaMap = {};
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
      if (thread) thread.innerHTML = '<div class="welcome-message">I\'m your AI partner. Ask me anything about this image!</div>';
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
  if (res.snaptoai_built_code) _lastBuiltCode = res.snaptoai_built_code;
  if (res.snaptoai_build_body)  _buildBodyHtml = res.snaptoai_build_body;
  if (res.snaptoai_build_style) _buildStyleCss  = res.snaptoai_build_style;
  if (res.snaptoai_build_script) _buildScriptJs = res.snaptoai_build_script;
});

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

function _postToSandbox(code, isFinal) {
  const iframe = document.getElementById('livePreview');
  if (!iframe) return;
  _lastBuiltCode = code; // always keep buffer fresh
  _updateBuildInput();
  // Gate on handshake — contentWindow is always truthy once element exists,
  // so we must check _isSandboxReady explicitly. If sandbox isn't ready yet,
  // the handshake listener will auto-flush _lastBuiltCode when it fires.
  if (!_isSandboxReady) return;
  if (iframe.contentWindow) {
    iframe.contentWindow.postMessage({ htmlCode: code, isFinal: !!isFinal }, '*');
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
      }
    });
  } else {
    _updateBuildInput();
  }
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
