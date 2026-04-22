/* ============================================================================
   Snap — mascot-first voice + chat co-pilot.

   UI:
   - Header trigger pill (no floating mess).
   - Full-popup STAGE with a big animated mascot center-screen.
   - Live SUBTITLES near the mascot (no chat history / WhatsApp look).
   - Mic + text input + Stop at the bottom.

   Logic (kept from v2.6.0 — these fixes prevent API spam):
   - Per-turn turnId + AbortController. Stop bumps the ID and aborts in-flight
     fetches; stale callbacks are silently dropped.
   - Single-fire `processed` guard on SpeechRecognition.onresult.
   - isBusy gate blocks new turns while one is running.
   - AudioContext primed on every user click (Chrome autoplay policy).
   ============================================================================ */

(function () {
  'use strict';

  // ===== System prompt =====
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

UI ELEMENTS YOU CAN POINT AT (end your reply with [glow:#id] — only when you actually told the user to click that button):
- [glow:#snapButton] [glow:#snipButton] [glow:#fullPageButton] [glow:#directAiButton]
- [glow:#signInHeaderBtn] [glow:#sendSelectedAiBtn] [glow:#copySelectedBtn]
- [glow:#exportPdfBtn] [glow:#downloadSelectedBtn] [glow:#youtubeBtn]

GUIDELINES:
- Keep replies under 25 words when possible (live subtitles — short reads better).
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
  let activeTurnId = 0;
  let activeAbortController = null;
  let isBusy = false;
  let isListening = false;
  let recognition = null;

  // ===== DOM refs =====
  let panelEl = null;
  let stageEl = null;
  let subtitleEl = null;
  let micBtnEl = null;
  let inputEl = null;
  let sendBtnEl = null;
  let stopBtnEl = null;

  // ===== Audio =====
  let audioCtx = null;
  let currentAudioSource = null;

  // ===== Conversation memory =====
  let conversationHistory = [];

  // ===== Public hook =====
  window.SnapCoach = {
    open: openPanel,
    close: closePanel,
    celebrate(message) {
      if (!panelEl || panelEl.classList.contains('snap-open')) return;
      openPanel();
      showSubtitle(message || 'Nice capture! Want a tip on what to do next?', 'bot');
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
      primeAudio();
      openPanel();
    });
    header.insertBefore(btn, header.firstChild);
  }

  function injectPanel() {
    if (document.getElementById('snap-panel')) return;
    panelEl = document.createElement('div');
    panelEl.id = 'snap-panel';
    panelEl.innerHTML = `
      <div class="snap-stage-topbar">
        <button class="snap-panel-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="snap-stage snap-state-idle">
        <div class="snap-mascot-wrap">
          <div class="snap-mascot-ring"></div>
          <div class="snap-mascot-ring"></div>
          <div class="snap-mascot-ring"></div>
          <div class="snap-mascot">📸</div>
        </div>
        <div class="snap-mascot-name">
          <strong>SNAP</strong>
          <span>Your AI co-pilot</span>
        </div>
        <div class="snap-subtitle" aria-live="polite"></div>
      </div>
      <div class="snap-input-bar">
        <button class="snap-mic-btn" type="button" title="Talk to Snap" aria-label="Mic">🎤</button>
        <input class="snap-text-input" type="text" placeholder="Or type a message…" maxlength="500" />
        <button class="snap-send-btn" type="button" title="Send" aria-label="Send">➤</button>
        <button class="snap-stop-btn" type="button" title="Stop">■ Stop</button>
      </div>
    `;
    document.body.appendChild(panelEl);

    stageEl     = panelEl.querySelector('.snap-stage');
    subtitleEl  = panelEl.querySelector('.snap-subtitle');
    micBtnEl    = panelEl.querySelector('.snap-mic-btn');
    inputEl     = panelEl.querySelector('.snap-text-input');
    sendBtnEl   = panelEl.querySelector('.snap-send-btn');
    stopBtnEl   = panelEl.querySelector('.snap-stop-btn');

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
      showSubtitle('Stopped. Tap the mic or type when ready.', 'bot');
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
    setStage('idle');
    showSubtitle("Hey, I'm Snap! Tap the mic or type — I'll guide you.", 'bot');
    setTimeout(() => { try { inputEl.focus({ preventScroll: true }); } catch (_) {} }, 320);
  }
  function closePanel() {
    if (!panelEl) return;
    panelEl.classList.remove('snap-open');
  }

  // ===========================================================================
  //  STAGE STATE & SUBTITLES
  // ===========================================================================
  function setStage(state) {
    if (!stageEl) return;
    stageEl.classList.remove('snap-state-idle', 'snap-state-listening', 'snap-state-thinking', 'snap-state-talking');
    stageEl.classList.add('snap-state-' + state);
  }

  let subtitleHideTimer = null;
  function showSubtitle(text, kind, opts) {
    if (!subtitleEl) return;
    clearTimeout(subtitleHideTimer);
    subtitleEl.classList.remove('snap-user', 'snap-error', 'snap-thinking');
    if (kind === 'user')     subtitleEl.classList.add('snap-user');
    if (kind === 'error')    subtitleEl.classList.add('snap-error');
    if (kind === 'thinking') subtitleEl.classList.add('snap-thinking');
    subtitleEl.textContent = text || '';
    subtitleEl.classList.add('snap-show');
    if (opts && opts.autoHideMs) {
      subtitleHideTimer = setTimeout(hideSubtitle, opts.autoHideMs);
    }
  }
  function hideSubtitle() {
    if (!subtitleEl) return;
    subtitleEl.classList.remove('snap-show');
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
  //  HARD STOP — abort fetches + audio + recognition for current turn
  // ===========================================================================
  function hardStop() {
    activeTurnId++;
    if (activeAbortController) {
      try { activeAbortController.abort(); } catch (_) {}
      activeAbortController = null;
    }
    stopListening();
    stopGeminiAudio();
    try { window.speechSynthesis.cancel(); } catch (_) {}
    setBusy(false);
    setStage('idle');
  }

  // ===========================================================================
  //  AUDIO
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
    if (turnIdAtStart !== activeTurnId) return;
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
    setStage('talking');
    src.onended = () => {
      if (currentAudioSource === src) currentAudioSource = null;
      if (turnIdAtStart === activeTurnId) {
        setBusy(false);
        setStage('idle');
        // Subtitle stays visible briefly after speech, then fades
        subtitleHideTimer = setTimeout(hideSubtitle, 4500);
      }
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
      showSubtitle("Voice isn't supported here. Try Chrome or just type below.", 'error');
      return;
    }

    let processed = false;       // <-- the single-fire guard
    recognition = new SR();
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (e) => {
      if (processed) return;     // ignore duplicate result events
      processed = true;
      const transcript = (e.results[0] && e.results[0][0] && e.results[0][0].transcript) || '';
      const cleaned = transcript.trim();
      if (cleaned) submitTranscript(cleaned);
      else showSubtitle("Didn't catch that — try again or type instead.", 'bot');
    };
    recognition.onerror = (e) => {
      if (processed) return;
      processed = true;
      handleMicError(e.error);
    };
    recognition.onend = () => {
      isListening = false;
      micBtnEl.classList.remove('snap-mic-listening');
      if (!isBusy) setStage('idle');
    };

    isListening = true;
    micBtnEl.classList.add('snap-mic-listening');
    setStage('listening');
    showSubtitle('Listening… speak now.', 'bot');
    try { recognition.start(); }
    catch (err) {
      isListening = false;
      micBtnEl.classList.remove('snap-mic-listening');
      setStage('idle');
      showSubtitle("Couldn't start the mic: " + err.message, 'error');
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
    setStage('idle');
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      showSubtitle('Mic blocked by Chrome. Just type below — or enable the mic in Site settings.', 'error');
    } else if (code === 'no-speech') {
      showSubtitle("Didn't hear anything — try again or type below.", 'bot');
    } else {
      showSubtitle('Mic error: ' + code, 'error');
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
    const turnId = ++activeTurnId;
    activeAbortController = new AbortController();
    const signal = activeAbortController.signal;
    setBusy(true);

    // Briefly echo what the user said
    showSubtitle('“' + userText + '”', 'user');
    setStage('thinking');
    setTimeout(() => {
      if (turnId === activeTurnId && isBusy) showSubtitle('Thinking', 'thinking');
    }, 700);

    conversationHistory.push({ role: 'user', parts: [{ text: userText }] });
    if (conversationHistory.length > 12) conversationHistory = conversationHistory.slice(-12);

    let replyText;
    try {
      replyText = await callGemini(conversationHistory, signal);
    } catch (err) {
      if (turnId !== activeTurnId) return;
      if (err.name === 'AbortError') return;
      setBusy(false);
      setStage('idle');
      showSubtitle(friendlyErr(err.message), 'error', { autoHideMs: 6000 });
      return;
    }

    if (turnId !== activeTurnId) return;

    const glowMatch = replyText.match(/\[glow:([^\]]+)\]/i);
    const cleanReply = replyText.replace(/\[glow:[^\]]+\]/gi, '').trim();
    conversationHistory.push({ role: 'model', parts: [{ text: cleanReply }] });

    showSubtitle(cleanReply, 'bot');
    if (glowMatch) glowTarget(glowMatch[1].trim(), 5000);

    try {
      await geminiTts(cleanReply, turnId, signal);
    } catch (err) {
      if (turnId !== activeTurnId || err.name === 'AbortError') return;
      console.warn('[snap-coach] TTS failed, using browser voice:', err.message);
      browserTtsFallback(cleanReply, turnId);
    }
  }

  function friendlyErr(msg) {
    if (!msg) return 'Something went wrong — try again?';
    if (/quota|exhausted|429/i.test(msg)) return "Google says I'm rate-limited for a moment. Wait a few seconds and try again.";
    if (/api key|key/i.test(msg)) return 'I need your Gemini API key in Settings first.';
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
  //  GEMINI TTS — exactly ONE call per turn
  // ===========================================================================
  async function geminiTts(text, turnId, signal) {
    const key = await getGeminiKey();
    if (!key) throw new Error('No API key.');
    const body = {
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
    if (!('speechSynthesis' in window)) { setBusy(false); setStage('idle'); return; }
    try { window.speechSynthesis.cancel(); } catch (_) {}
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05; u.pitch = 1.05; u.volume = 1;
    const voices = window.speechSynthesis.getVoices();
    const pref = voices.find(v => /en-US/i.test(v.lang) && /female|samantha|google|jenny|aria/i.test(v.name))
              || voices.find(v => /en-US/i.test(v.lang)) || voices[0];
    if (pref) u.voice = pref;
    setStage('talking');
    u.onend = u.onerror = () => {
      if (turnId === activeTurnId) {
        setBusy(false);
        setStage('idle');
        subtitleHideTimer = setTimeout(hideSubtitle, 4500);
      }
    };
    window.speechSynthesis.speak(u);
  }

  // ===== Helpers =====
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
