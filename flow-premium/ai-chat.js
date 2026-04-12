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

// ============ BACKEND PROXY (3 free prompts) ============
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
  
  const closeModal = () => modal.classList.remove('open');
  if (closeBtn) closeBtn.onclick = closeModal;
  if (cancelBtn) cancelBtn.onclick = closeModal;
  if (modal) modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  
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
    saveBtn.onclick = async () => {
      if (saveBtn.disabled) return;
      const key = input.value.trim();
      if (!key) return;
      await chrome.storage.sync.set({ geminiApiKey: key });
      freePromptsRemaining = null;
      closeModal();
      showPromptToast('Key saved! You now have unlimited AI access.', 3000);
    };
  }
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
    model: 'gemini-2.5-flash-image',
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
    model: 'veo-2.0-generate-001',
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
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode === currentAiMode) return;
      
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

(async function checkVideoSupport() {
  try {
    const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
    const apiKey = keyResult.geminiApiKey;
    if (!apiKey) {
      console.log('[SnapToAI] Video mode hidden — no API key set');
      return;
    }
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) {
      console.log('[SnapToAI] Video mode hidden — model list failed');
      return;
    }
    const data = await resp.json();
    const hasVeo = (data.models || []).some(m => m.name && m.name.toLowerCase().includes('veo'));
    if (hasVeo) {
      const videoBtn = document.getElementById('videoModeBtn');
      if (videoBtn) videoBtn.style.display = '';
      console.log('[SnapToAI] Video mode enabled — Veo models available');
    } else {
      console.log('[SnapToAI] Video mode hidden — no Veo models on this key');
    }
  } catch (e) {
    console.log('[SnapToAI] Video support check skipped:', e.message);
  }
})();

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

let selectedVeoModel = 'veo-3.1-fast-generate-preview';
let selectedVideoDuration = 8;
let userAvailableVeoModels = [];

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
      <div class="veo-duration-selector" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
        <span style="font-size:11px;color:#667788;width:100%;margin-bottom:2px;">Duration:</span>
        <button class="veo-dur-btn" data-dur="5" style="padding:4px 12px;border-radius:8px;border:1px solid rgba(255,165,0,0.2);background:rgba(255,165,0,0.04);color:#aabbcc;font-size:11px;font-weight:600;cursor:pointer;">5s</button>
        <button class="veo-dur-btn selected" data-dur="8" style="padding:4px 12px;border-radius:8px;border:1px solid rgba(255,165,0,0.5);background:rgba(255,165,0,0.15);color:#ffa500;font-size:11px;font-weight:600;cursor:pointer;">8s</button>
        <button class="veo-dur-btn" data-dur="10" style="padding:4px 12px;border-radius:8px;border:1px solid rgba(255,165,0,0.2);background:rgba(255,165,0,0.04);color:#aabbcc;font-size:11px;font-weight:600;cursor:pointer;">10s</button>
      </div>
      <textarea class="studio-desc" placeholder="Describe the video scene you want to create..." style="width:100%;box-sizing:border-box;height:48px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,165,0,0.15);border-radius:10px;padding:12px 14px;color:#e8eef4;font-size:13px;font-family:inherit;resize:none;outline:none;overflow:hidden;transition:border-color 0.2s;"></textarea>
      ${hasScreenshots ? `
      <label style="display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer;font-size:12px;color:#aabbcc;">
        <input type="checkbox" class="studio-use-screenshot" style="accent-color:#ffa500;" checked>
        <span>📸 Use loaded screenshot as starting frame</span>
      </label>` : ''}
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
        <span style="font-size:10px;color:#667788;">⏱ ~1-2 min render time</span>
        <span style="font-size:10px;color:#667788;">•</span>
        <span class="studio-dur-label" style="font-size:10px;color:#667788;">8s clip</span>
      </div>
      <button class="studio-create-btn" style="width:100%;padding:10px;border-radius:10px;border:none;background:linear-gradient(135deg,#ffa500,#cc8400);color:#fff;font-size:13px;font-weight:700;cursor:pointer;margin-top:10px;opacity:0.4;pointer-events:none;">🎬 Generate Video</button>
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
      const durLabel = studio.querySelector('.studio-dur-label');
      if (durLabel) durLabel.textContent = `${selectedVideoDuration}s clip`;
    });
  });

  createBtn.addEventListener('click', async () => {
    const desc = descInput.value.trim();
    if (!desc) return;

    studio.style.opacity = '0.5';
    studio.style.pointerEvents = 'none';

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
      if (loadingEl) loadingEl.innerHTML = '<span style="color:#ff9900;font-size:11px;">No Veo models found on your key. Enable Google Cloud billing or get the $300 free credit to unlock video generation.</span>';
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
      });
    });

    console.log(`[SnapToAI Video] ${userAvailableVeoModels.length} Veo models available for user`);
  } catch (e) {
    if (loadingEl) loadingEl.innerHTML = '<span style="color:#ff6b6b;font-size:11px;">Could not load models</span>';
    console.log('[SnapToAI Video] Model check error:', e.message);
  }
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

  const progressBubble = document.createElement('div');
  progressBubble.className = 'chat-bubble ai video-progress';
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
  thread.appendChild(progressBubble);
  thread.scrollTop = thread.scrollHeight;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predictLongRunning?key=${apiKey}`;

    const requestBody = {
      instances: [{ prompt: prompt }],
      parameters: {
        aspectRatio: '16:9',
        sampleCount: 1,
        durationSeconds: selectedVideoDuration,
        personGeneration: 'allow_adult'
      }
    };

    if (includeImage && currentImages[0]) {
      const imgData = currentImages[0];
      const cleanB64 = imgData.includes(',') ? imgData.split(',')[1] : imgData;
      let mimeType = 'image/png';
      if (imgData.startsWith('data:')) {
        const match = imgData.match(/^data:(image\/[a-zA-Z+]+);/);
        if (match) mimeType = match[1];
      }
      requestBody.instances[0].image = { bytesBase64Encoded: cleanB64, mimeType: mimeType };
    }

    console.log(`[SnapToAI Video] Starting generation with ${modelName}`);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const data = await resp.json();

    if (!resp.ok) {
      const errorMsg = data.error?.message || `API error ${resp.status}`;
      console.log(`[SnapToAI Video] API error: ${errorMsg}`);
      let friendlyMsg = errorMsg;
      if (resp.status === 400 && errorMsg.toLowerCase().includes('billing')) {
        friendlyMsg = 'This model requires Google Cloud billing. Enable billing or get the $300 free credit at console.cloud.google.com/billing';
      } else if (resp.status === 429) {
        friendlyMsg = 'Rate limit reached. Please wait a few minutes and try again.';
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
          return;
        }
        clearInterval(activeVideoPollTimer);
        activeVideoPollTimer = null;
        progressBubble.innerHTML = `<div style="color:#ff6b6b;font-size:13px;"><span style="font-size:16px;">❌</span> ${errMsg}</div>`;
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
          progressBubble.innerHTML = `<div style="color:#ff6b6b;font-size:13px;"><span style="font-size:16px;">❌</span> ${errMsg}</div>`;
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

const SYSTEM_PROMPT = getConfig('SYSTEM_PROMPT', "You are a professional assistant. Give COMPLETE, DIRECT answers. Never truncate or ask 'would you like more?' Be thorough but concise. Use **bold** for key insights, headers for sections, bullets for clarity. NEVER ask follow-up questions.");

const SMART_SYSTEM_PROMPT = getConfig('SMART_SYSTEM_PROMPT', "You are a professional assistant. I'm providing webpage text for accuracy and screenshots for visual context. Give COMPLETE, DIRECT answers. Never truncate. Be thorough but concise. Use **bold** for key insights, headers for sections, bullets for clarity. NEVER ask follow-up questions.");

const MULTI_IMAGE_PROMPT = getConfig('MULTI_IMAGE_PROMPT', "You are a professional assistant. I'm providing multiple screenshots that together show the full picture. Analyze ALL images together. Give COMPLETE, DIRECT answers. Never truncate. Be thorough but concise. Use **bold** for key insights, headers for sections, bullets for clarity. NEVER ask follow-up questions.");

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

  // Allow browser to paint before heavy processing
  await new Promise(r => requestAnimationFrame(r));
  
  try {
    const modeConfig = AI_MODES[currentAiMode] || AI_MODES['vision'];

    const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
    const apiKey = keyResult.geminiApiKey;

    if (modeConfig.type === 'gemini-video') {
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
          const limit = proxyResult.limit || 10;
          
          if (remaining === 0) {
            showPromptToast('Last prompt used! Add your Gemini key for unlimited access.', 5000, true);
            setTimeout(() => showProxyKeyPrompt(), 1500);
          } else if (remaining === 1) {
            showPromptToast('⚠️ 1 prompt remaining — add your Gemini key soon', 5000, true);
          } else if (remaining === 3) {
            showPromptToast(`📊 3 of ${limit} prompts left. Get your own key for unlimited access + $300 Cloud credits!`, 5000);
          } else if (remaining === 5) {
            showPromptToast(`📊 ${remaining} of ${limit} prompts remaining. Tip: add your own Gemini key for unlimited prompts.`, 4000);
          } else {
            showPromptToast(`📊 ${remaining} of ${limit} prompts remaining`, 3000);
          }
        }
        sendBtn.disabled = false;
        releaseRequestLock();
        return;
      } catch (proxyErr) {
        if (proxyErr.message === 'FREE_PROMPTS_EXHAUSTED') {
          removeLoading();
          sendBtn.disabled = false;
          releaseRequestLock();
          setTimeout(() => showProxyKeyPrompt(), 400);
          return;
        }
        removeLoading();
        const msg = proxyErr.message || '';
        if (msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('wait')) {
          addBubble('⏳ Too many requests — please wait a moment and try again.', 'ai');
        } else {
          addBubble('Something went wrong. Please try again in a moment.', 'error');
        }
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
              allBatchResults.push(`## Batch ${batchNum + 1}\n⚠️ Failed to process this batch.`);
            }
          } catch (batchError) {
            allBatchResults.push(`## Batch ${batchNum + 1}\n⚠️ Error: ${batchError.message}`);
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

    const createResponseBubble = () => {
      removeLoading();
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble ai';
      thread.appendChild(bubble);
      return bubble;
    };

    if (modeConfig.type === 'gemini-image') {
      // === IMAGE GENERATION (via generateContent with responseModalities) ===
      const imageModels = [
        'gemini-2.5-flash-image',
        'gemini-3.1-flash-image-preview',
        'gemini-3-pro-image-preview'
      ];
      
      let lastResponseData = null;
      let lastError = '';
      let succeeded = false;
      
      for (const modelName of imageModels) {
        const retryDelays = [8, 15, 25];
        
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
                contents: [{ role: 'user', parts: [{ text: `Generate an image: ${prompt}` }] }],
                generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
              })
            });
          } catch(fetchErr) {
            console.log(`[SnapToAI Image] Fetch error on ${modelName}:`, fetchErr.message);
            lastError = fetchErr.message;
            if (attempt < 2) {
              const waitSec = retryDelays[attempt];
              if (loadingEl) loadingEl.innerHTML = `<span style="color:#ff6bed;">⏳ Connection issue — retrying in ${waitSec}s...</span>`;
              await new Promise(r => setTimeout(r, waitSec * 1000));
            }
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
          
          const isRetryable = response.status === 429 || response.status === 503 ||
            lastError.toLowerCase().includes('resource') || 
            lastError.toLowerCase().includes('quota') || 
            lastError.toLowerCase().includes('rate') ||
            lastError.toLowerCase().includes('exhausted');
          
          if (!isRetryable) break;
          
          if (attempt < 2) {
            const waitSec = retryDelays[attempt];
            if (loadingEl) loadingEl.innerHTML = `<span style="color:#ff6bed;">⏳ Rate limited — retrying in ${waitSec}s...</span>`;
            await new Promise(r => setTimeout(r, waitSec * 1000));
          }
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
            const hasRealAudio = audioParts.some(p => p.inlineData?.data && p.inlineData.data.length > 100);
            if (hasRealAudio) {
              audioData = body;
              audioSucceeded = true;
              console.log(`[SnapToAI Audio] Success with ${audioModel}!`);
              break;
            } else {
              audioError = 'Model returned empty audio. Your API key may not have access to music generation — try adding Google Cloud billing for full Lyria access.';
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
        if (part.inlineData && part.inlineData.mimeType?.startsWith('audio')) {
          hasAudio = true;
          const audioSrc = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          htmlContent += `<div style="margin:10px 0;">
            <audio controls style="width:100%; border-radius:8px; outline:none;" src="${audioSrc}"></audio>
            <div style="margin-top:8px; display:flex; gap:8px;">
              <button class="audio-save-btn" style="background:rgba(0,255,136,0.15);border:1px solid rgba(0,255,136,0.3);color:#00ff88;padding:5px 14px;border-radius:8px;font-size:11px;cursor:pointer;transition:all 0.2s;">💾 Save Audio</button>
            </div>
          </div>`;
        }
      }
      
      if (!hasAudio && !fullText) {
        htmlContent = '<div style="color:#ff6b6b;">No audio was generated. Try typing a sentence to speak.</div>';
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
      const friendlyMsg = await getFriendlyErrorMessage(error.message);
      const isQuotaError = error.message.toLowerCase().match(/quota|rate|limit|429|exceeded/);
      addBubble(friendlyMsg, isQuotaError ? 'ai' : 'error');
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
  
  // Quota/Rate limit errors
  if (lowerMsg.includes('quota') || lowerMsg.includes('rate') || lowerMsg.includes('limit') || lowerMsg.includes('429') || lowerMsg.includes('exceeded')) {
    if (hasOwnApiKey) {
      // User has their own API key - show technical error
      return `⚠️ API rate limit reached.\n\n` +
             `This is a temporary limit from Google. Please wait a few seconds and try again.\n\n` +
             `If this persists, check your Google AI Studio dashboard for quota details.`;
    } else {
      return `✨ To use AI analysis, connect your Gemini API key.\n\n` +
             `It takes about 1 minute:\n` +
             `1. Go to aistudio.google.com\n` +
             `2. Click "Create API key"\n` +
             `3. Copy the key and paste it in Settings\n\n` +
             `That's it — you'll get unlimited AI prompts!`;
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
  
  readBtn.onclick = () => {
    // Toggle: if speaking, stop
    if (synth.speaking) {
      synth.cancel();
      readBtn.textContent = '🔊 Read';
      return;
    }
    
    const plainText = bubble.textContent.replace('📋 Copy🔊 Read', '').replace('✓ Copied!🔊 Read', '').replace('⏹ Stop', '');
    
    // Use premium multi-language TTS with auto language detection
    const utterance = speakText(plainText);
    
    synth.speak(utterance);
    readBtn.textContent = '⏹ Stop';
    
    utterance.onend = () => readBtn.textContent = '🔊 Read';
    utterance.onerror = () => readBtn.textContent = '🔊 Read';
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
