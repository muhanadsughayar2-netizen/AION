/* ============================================================================
   Snap — voice + chat co-pilot for the SnapToAI extension popup.

   Architecture:
   - One trigger pill in the header opens a full-popup chat panel (no overlap
     with any existing buttons).
   - User can either tap the mic OR type into the text input.
   - PER-TURN cancellation: every turn gets a fresh turnId + AbortController.
     Stale responses (after Stop) are ignored. In-flight fetches are aborted.
   - Single-fire guard on SpeechRecognition results — prevents double-firing
     that was causing the previous API spam.
   - "Busy" guard blocks new turns while one is in flight.
   - AudioContext is primed inside every user click (Chrome autoplay policy).
   ============================================================================ */

(function () {
  'use strict';

  // ----- System prompt (Snap's personality + app knowledge) -----
  const SNAP_SYSTEM_PROMPT = `You are "Snap" — a warm, upbeat, slightly playful creative co-pilot living inside the SnapToAI Chrome extension. Speak like a friendly studio buddy: short spoken-style sentences (1-3 max), natural contractions, encouraging, never robotic. You are this app's guide AND a creative partner who actively suggests cool things the user can do with their screenshots.

PROACTIVE COACHING — your superpower:
You are a creative ideas machine. The user often doesn't know the best way to use screenshots + AI. Spot the opportunity, pitch a smart workflow in one breath. Be specific.

WORKFLOW IDEAS BY CONTEXT:
📈 Stocks/trading: multi-timeframe stitches, indicator overlays, candlestick pattern questions.
💻 Code/debugging: error + function context combos.
🎨 Design/UI: competitor comparisons, breakpoint diffs.
📚 Learning: full-page article summaries, PDF stitch-into-study-guide.
🛒 Shopping: real-vs-counterfeit, multi-listing value comparisons.
📊 Dashboards: anomaly investigation across timeframes.

ABOUT THE APP:
- Three capture modes: SNAP (viewport), SNIP (drag region), FULL PAGE (auto-scroll stitch).
- Holds up to 10 screenshots in a queue.
- ASK AI opens built-in chat using the user's own Gemini key.
- AI modes: Vision, Image (Nano Banana), Music (Lyria), Video (Veo).
- Annotation: highlight, callouts, text, stickers.
- Right-click anywhere for the wand menu.
- 55 languages, 30-day free trial, paid plan via Whop.

UI ELEMENTS YOU CAN POINT AT (end your reply with [glow:#id] — use sparingly, only when you actually told the user to click that button):
- [glow:#snapButton] [glow:#snipButton] [glow:#fullPageButton] [glow:#directAiButton]
- [glow:#signInHeaderBtn] [glow:#sendSelectedAiBtn] [glow:#copySelectedBtn]
- [glow:#exportPdfBtn] [glow:#downloadSelectedBtn] [glow:#youtubeBtn]

GUIDELINES:
- Keep replies under 25 words when possible.
- After every capture, suggest the next step (don't just praise).
- If queue has 2+ images, suggest stitching or sending in one go.
- If user is vague, ask ONE sharp clarifying question, then pitch a workflow.
- Be bold with ideas the user hasn't thought of yet.`;

  const GEMINI_MODEL = 'gemini-2.0-flash';
  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
  const TTS_URL = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`;
  const TTS_VOICE = 'Kore';
  const TTS_SAMPLE_RATE = 24000;

  // ===== Per-turn state =====
  // turnId is bumped on Stop / new turn; any in-flight callback that doesn't
  // match the current turnId is ignored (prevents stale responses & spam).
  let activeTurnId = 0;
  let activeAbortController = null;
  let isBusy = false;       // text-fetch OR TTS-fetch OR audio playback in progress
  let isListening = false;
  let recognition = null;

  // ===== DOM refs =====
  let panelEl = null;
  let chatLogEl = null;
  let micBtnEl = null;
  let inputEl = null;
  let sendBtnEl = null;
  let stopBtnEl = null;
  let statusRowEl = null;
  let statusTextEl = null;

  // ===== Audio =====
  let audioCtx = null;
  let currentAudioSource = null;

  // ===== Conversation history (capped) =====
  let conversationHistory = [];

  // ----- Public hook -----
  window.SnapCoach = {
    open: openPanel,
    close: closePanel,
    celebrate(message) {
      // Non-intrusive: only auto-open if the panel isn't already open.
      if (!panelEl || panelEl.classList.contains('snap-open')) return;
      openPanel();
      addBotMessage(message || 'Nice capture! Want a tip on what to do next?');
    }
  };

  // ===========================================================================
  //  BOOT
  // ===========================================================================
  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();

  let booted = false;
  function boot() {
    if (booted) return; booted = true;
    injectTrigger();
    injectPanel();
    try { window.speechSynthesis.getVoices(); } catch (_) {}
  }

  // Header trigger pill — sits inline in the header layout, never overlaps.
  function injectTrigger() {
    if (document.getElementById('snap-trigger')) return;
    const header = document.querySelector('.header .header-right') || document.querySelector('.header');
    if (!header) return;
    const btn = document.createElement('button');
    btn.id = 'snap-trigger';
    btn.type = 'button';
    btn.title = 'Open Snap — your voice & chat co-pilot';
    btn.innerHTML = '<span class="snap-trigger-dot"></span><span>Snap</span>';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      primeAudio();           // user gesture → unlock audio for later TTS
      openPanel();
    });
    header.insertBefore(btn, header.firstChild);
  }

  // Full-popup chat panel — replaces view, never overlaps interactive controls.
  function injectPanel() {
    if (document.getElementById('snap-panel')) return;
    panelEl = document.createElement('div');
    panelEl.id = 'snap-panel';
    panelEl.innerHTML = `
      <div class="snap-panel-header">
        <div class="snap-panel-avatar">📸</div>
        <div class="snap-panel-title">
          <strong>Snap</strong>
          <span>Your voice &amp; chat co-pilot</span>
        </div>
        <button class="snap-panel-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="snap-chat-log" role="log" aria-live="polite"></div>
      <div class="snap-status-row">
        <span class="snap-status-pulse"></span>
        <span class="snap-status-text">Ready. Tap the mic or type a message.</span>
      </div>
      <div class="snap-input-bar">
        <button class="snap-mic-btn" type="button" title="Talk to Snap" aria-label="Mic">🎤</button>
        <input class="snap-text-input" type="text" placeholder="Type a message…" maxlength="500" />
        <button class="snap-send-btn" type="button" title="Send" aria-label="Send">➤</button>
        <button class="snap-stop-btn" type="button" title="Stop">■ Stop</button>
      </div>
    `;
    document.body.appendChild(panelEl);

    chatLogEl     = panelEl.querySelector('.snap-chat-log');
    micBtnEl      = panelEl.querySelector('.snap-mic-btn');
    inputEl       = panelEl.querySelector('.snap-text-input');
    sendBtnEl     = panelEl.querySelector('.snap-send-btn');
    stopBtnEl     = panelEl.querySelector('.snap-stop-btn');
    statusRowEl   = panelEl.querySelector('.snap-status-row');
    statusTextEl  = panelEl.querySelector('.snap-status-text');

    panelEl.querySelector('.snap-panel-close').addEventListener('click', () => {
      hardStop();
      closePanel();
    });

    micBtnEl.addEventListener('click', () => {
      primeAudio();
      if (isListening) { stopListening(); return; }
      startListening();
    });

    sendBtnEl.addEventListener('click', () => {
      primeAudio();
      submitText();
    });

    stopBtnEl.addEventListener('click', () => {
      hardStop();
      setStatus('Stopped. Ready when you are.', false);
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        primeAudio();
        submitText();
      }
    });
  }

  function openPanel() {
    if (!panelEl) injectPanel();
    panelEl.classList.add('snap-open');
    if (chatLogEl.children.length === 0) {
      addBotMessage("Hey, I'm Snap! 📸 Tap the mic or type — I'll guide you and pitch creative ideas for your screenshots.");
    }
    setTimeout(() => { try { inputEl.focus(); } catch (_) {} }, 300);
  }
  function closePanel() {
    if (!panelEl) return;
    panelEl.classList.remove('snap-open');
  }

  // ===========================================================================
  //  CHAT LOG HELPERS
  // ===========================================================================
  function addUserMessage(text) {
    const el = document.createElement('div');
    el.className = 'snap-msg snap-msg-user';
    el.textContent = text;
    chatLogEl.appendChild(el);
    scrollLog();
  }
  function addBotMessage(text) {
    const el = document.createElement('div');
    el.className = 'snap-msg snap-msg-bot';
    el.textContent = text;
    chatLogEl.appendChild(el);
    scrollLog();
    return el;
  }
  function addSystemMessage(text) {
    const el = document.createElement('div');
    el.className = 'snap-msg snap-msg-system';
    el.textContent = text;
    chatLogEl.appendChild(el);
    scrollLog();
  }
  function addErrorMessage(text) {
    const el = document.createElement('div');
    el.className = 'snap-msg snap-msg-error';
    el.textContent = text;
    chatLogEl.appendChild(el);
    scrollLog();
  }
  function scrollLog() {
    requestAnimationFrame(() => { chatLogEl.scrollTop = chatLogEl.scrollHeight; });
  }

  function setStatus(text, active) {
    if (!statusRowEl) return;
    statusTextEl.textContent = text;
    statusRowEl.classList.toggle('snap-active', !!active);
  }

  function setBusy(busy) {
    isBusy = busy;
    if (!sendBtnEl) return;
    sendBtnEl.disabled = busy;
    micBtnEl.disabled = busy && !isListening;
    inputEl.disabled = busy;
    stopBtnEl.classList.toggle('snap-show', busy);
    sendBtnEl.style.display = busy ? 'none' : 'flex';
  }

  // ===========================================================================
  //  HARD STOP — abort everything for this turn
  // ===========================================================================
  function hardStop() {
    activeTurnId++;                                  // invalidate stale callbacks
    if (activeAbortController) {
      try { activeAbortController.abort(); } catch (_) {}
      activeAbortController = null;
    }
    stopListening();
    stopGeminiAudio();
    try { window.speechSynthesis.cancel(); } catch (_) {}
    setBusy(false);
  }

  // ===========================================================================
  //  AUDIO — primed on every click for Chrome autoplay policy
  // ===========================================================================
  function getAudioCtx() {
    if (!audioCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctor();
    }
    return audioCtx;
  }
  function primeAudio() {
    try {
      const ctx = getAudioCtx();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch (_) {}
  }
  function stopGeminiAudio() {
    if (currentAudioSource) {
      try { currentAudioSource.onended = null; currentAudioSource.stop(); } catch (_) {}
      currentAudioSource = null;
    }
  }
  async function playPcm16(base64Pcm, sampleRate, turnIdAtStart) {
    if (turnIdAtStart !== activeTurnId) return;       // stale guard
    const bin = atob(base64Pcm);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    const sampleCount = Math.floor(bytes.length / 2);
    const f32 = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) f32[i] = view.getInt16(i * 2, true) / 32768;

    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (_) {}
      if (ctx.state === 'suspended') throw new Error('audio-suspended');
    }
    if (turnIdAtStart !== activeTurnId) return;

    const buf = ctx.createBuffer(1, sampleCount, sampleRate);
    buf.copyToChannel(f32, 0, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => {
      if (currentAudioSource === src) currentAudioSource = null;
      if (turnIdAtStart === activeTurnId) setBusy(false);
    };
    stopGeminiAudio();
    currentAudioSource = src;
    src.start(0);
  }

  // ===========================================================================
  //  SPEECH RECOGNITION — single-fire guard prevents the spam bug
  // ===========================================================================
  function startListening() {
    if (isBusy || isListening) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      addErrorMessage("Voice isn't supported in this browser. Try Chrome or Edge — or just type your message.");
      return;
    }

    let processed = false;          // <-- THE single-fire guard
    recognition = new SR();
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (e) => {
      if (processed) return;        // ignore duplicate result events
      processed = true;
      const transcript = (e.results[0] && e.results[0][0] && e.results[0][0].transcript) || '';
      const cleaned = transcript.trim();
      if (cleaned) submitTranscript(cleaned);
      else addSystemMessage("Didn't catch that — try again or type instead.");
    };
    recognition.onerror = (e) => {
      if (processed) return;
      processed = true;
      handleMicError(e.error);
    };
    recognition.onend = () => {
      isListening = false;
      micBtnEl.classList.remove('snap-mic-listening');
      if (!isBusy) setStatus('Ready. Tap the mic or type a message.', false);
    };

    isListening = true;
    micBtnEl.classList.add('snap-mic-listening');
    setStatus('Listening…', true);
    try { recognition.start(); }
    catch (err) {
      isListening = false;
      micBtnEl.classList.remove('snap-mic-listening');
      addErrorMessage("Couldn't start the mic: " + err.message);
    }
  }
  function stopListening() {
    if (recognition && isListening) {
      try { recognition.stop(); } catch (_) {}
    }
    isListening = false;
    if (micBtnEl) micBtnEl.classList.remove('snap-mic-listening');
  }
  function handleMicError(code) {
    isListening = false;
    micBtnEl.classList.remove('snap-mic-listening');
    setStatus('Ready. Tap the mic or type a message.', false);
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      addErrorMessage('Chrome blocked the mic for this extension. Use the type box, or open Chrome → Settings → Site settings → Microphone to allow it.');
    } else if (code === 'no-speech') {
      addSystemMessage("Didn't hear anything — try again or type your message.");
    } else {
      addErrorMessage('Mic error: ' + code);
    }
  }

  // ===========================================================================
  //  TURN SUBMISSION — voice OR text both end up here
  // ===========================================================================
  function submitText() {
    if (isBusy) return;
    const text = (inputEl.value || '').trim();
    if (!text) return;
    inputEl.value = '';
    submitTranscript(text);
  }
  function submitTranscript(text) {
    if (isBusy) return;
    runTurn(text);
  }

  async function runTurn(userText) {
    // Bump turn ID & set up a fresh AbortController. Any callback for an old
    // turn (e.g. a stop happened mid-flight) is silently dropped.
    const turnId = ++activeTurnId;
    activeAbortController = new AbortController();
    const signal = activeAbortController.signal;
    setBusy(true);

    addUserMessage(userText);
    setStatus('Thinking…', true);

    conversationHistory.push({ role: 'user', parts: [{ text: userText }] });
    if (conversationHistory.length > 12) conversationHistory = conversationHistory.slice(-12);

    let replyText;
    try {
      replyText = await callGemini(conversationHistory, signal);
    } catch (err) {
      if (turnId !== activeTurnId) return;            // stop happened — ignore
      if (err.name === 'AbortError') return;
      setBusy(false);
      setStatus('Ready. Tap the mic or type a message.', false);
      addErrorMessage(friendlyErr(err.message));
      return;
    }

    if (turnId !== activeTurnId) return;              // stop happened mid-fetch

    // Strip glow tag, save to history, render to chat
    const glowMatch = replyText.match(/\[glow:([^\]]+)\]/i);
    const cleanReply = replyText.replace(/\[glow:[^\]]+\]/gi, '').trim();
    conversationHistory.push({ role: 'model', parts: [{ text: cleanReply }] });
    addBotMessage(cleanReply);
    if (glowMatch) glowTarget(glowMatch[1].trim(), 5000);

    // Speak (premium voice). On failure, fall back to browser voice.
    setStatus('Speaking…', true);
    try {
      await geminiTts(cleanReply, turnId, signal);
      // setBusy(false) is handled in audio onended for accuracy
    } catch (err) {
      if (turnId !== activeTurnId || err.name === 'AbortError') return;
      console.warn('[snap-coach] TTS failed, using browser voice:', err.message);
      browserTtsFallback(cleanReply, turnId);
    }
  }

  function friendlyErr(msg) {
    if (!msg) return 'Something went wrong — try again?';
    return 'Network hiccup: ' + msg;
  }

  // ===========================================================================
  //  GEMINI TEXT
  // ===========================================================================
  async function callGemini(history, signal) {
    const key = await getGeminiKey();
    if (!key) throw new Error('Add your Gemini API key in Settings first.');
    const body = {
      systemInstruction: { parts: [{ text: SNAP_SYSTEM_PROMPT }] },
      contents: history,
      generationConfig: { temperature: 0.8, maxOutputTokens: 200 }
    };
    const resp = await fetch(GEMINI_URL + '?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error((data && data.error && data.error.message) || ('HTTP ' + resp.status));
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join(' ').trim();
    if (!text) throw new Error('Empty reply.');
    return text;
  }

  // ===========================================================================
  //  GEMINI TTS — ONE clean call per turn (no spam, no retry)
  // ===========================================================================
  async function geminiTts(text, turnId, signal) {
    const key = await getGeminiKey();
    if (!key) throw new Error('No API key.');
    const body = {
      // Style instructions live in systemInstruction so they're never spoken aloud.
      systemInstruction: { parts: [{ text: 'Read the following text in a warm, conversational, friendly voice. Speak only the text itself — never read instructions, prefixes, or formatting tags.' }] },
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } }
      }
    };
    const resp = await fetch(TTS_URL + '?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    });
    if (turnId !== activeTurnId) return;
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error((data && data.error && data.error.message) || ('TTS HTTP ' + resp.status));
    const part = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData && p.inlineData.data);
    if (!part) throw new Error('TTS empty.');
    const mime = part.inlineData.mimeType || '';
    const m = mime.match(/rate=(\d+)/);
    const rate = m ? parseInt(m[1], 10) : TTS_SAMPLE_RATE;
    await playPcm16(part.inlineData.data, rate, turnId);
  }

  function browserTtsFallback(text, turnId) {
    if (!('speechSynthesis' in window)) { setBusy(false); return; }
    try { window.speechSynthesis.cancel(); } catch (_) {}
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05; u.pitch = 1.05; u.volume = 1;
    const voices = window.speechSynthesis.getVoices();
    const pref = voices.find(v => /en-US/i.test(v.lang) && /female|samantha|google|jenny|aria/i.test(v.name))
              || voices.find(v => /en-US/i.test(v.lang)) || voices[0];
    if (pref) u.voice = pref;
    u.onend = u.onerror = () => {
      if (turnId === activeTurnId) setBusy(false);
    };
    window.speechSynthesis.speak(u);
  }

  // ===========================================================================
  //  HELPERS
  // ===========================================================================
  function getGeminiKey() {
    return new Promise((resolve) => {
      try { chrome.storage.sync.get(['geminiApiKey'], (r) => resolve(r && r.geminiApiKey)); }
      catch (_) { resolve(null); }
    });
  }
  function glowTarget(selector, durationMs) {
    try {
      const el = document.querySelector(selector);
      if (!el) return;
      el.classList.add('snap-glow-target');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => el.classList.remove('snap-glow-target'), durationMs || 4000);
    } catch (_) {}
  }
})();
