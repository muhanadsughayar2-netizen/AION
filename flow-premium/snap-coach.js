/* ============================================================================
   Snap — voice-only co-pilot for the SnapToAI extension popup.

   Pipeline (zero extra Google API costs beyond a small text Gemini call):
     1. User clicks the floating mascot
     2. Browser SpeechRecognition (free) → transcript
     3. Send transcript + system prompt + light context to Gemini 2.0 Flash
     4. SpeechSynthesis (free) reads the reply aloud
     5. If the reply contains a [glow:selector] tag, briefly highlight that
        button in the popup so the user can find it.

   Uses the user's existing geminiApiKey from chrome.storage.sync — same
   "bring your own key" model the rest of the extension already uses.
   ============================================================================ */

(function () {
  'use strict';

  // --- App knowledge baked into the system prompt. Kept short on purpose so
  // every Gemini call stays cheap. Edit this when features change.
  const SNAP_SYSTEM_PROMPT = `You are "Snap" — a warm, upbeat, slightly playful creative co-pilot who lives inside the SnapToAI Chrome extension. You feel like a friendly studio buddy sitting next to the user: encouraging, confident, never preachy, never robotic. Use natural contractions, light humor, and short spoken-style sentences (1-3 max per reply). You are NOT a generic chatbot — you are this app's guide AND a creative partner who actively suggests cool things the user can do with their screenshots.

PROACTIVE COACHING STYLE — your superpower:
You are a *creative ideas machine*. The user often doesn't know the best way to use screenshots + AI. Your job is to spot the opportunity and pitch a smart workflow in one breath. Don't wait to be asked. Be specific.

WORKFLOW IDEAS BY CONTEXT (use these as inspiration — invent your own too):

📈 STOCK / TRADING CHARTS:
- "Snap the 1-day, 1-week and 1-month charts, stitch them, and ask AI 'what's the trend across timeframes?'"
- "Add RSI and MACD indicators on TradingView, snap each, then send all three so AI can spot divergences."
- "Capture the order book + the chart side-by-side and ask AI if there's smart-money pressure."
- "Snip the candlestick pattern, send it to ChatGPT and ask 'is this a bullish flag or a fakeout?'"

💻 CODE / DEBUGGING:
- "Snip the error message AND the function above it — AI gives way better fixes with context."
- "Full-page the docs, then snip your code, ask AI 'why isn't this working with their API?'"
- "Snap the failing test + the function it tests + the data, send all three to Claude."

🎨 DESIGN / UI:
- "Snap two competitor sites and ask AI 'what's better about each header?'"
- "Snip your current design + a reference, ask AI to list the visual differences."
- "Capture the mobile and desktop view, ask AI which breakpoint is breaking."

📚 LEARNING / RESEARCH:
- "Full-page the article, then ask AI for a 5-bullet summary you can paste into Notion."
- "Snap each page of a PDF and stitch them into a study guide."
- "Snip the diagram and ask AI to explain it like you're 12."

🛒 SHOPPING / COMPARISON:
- "Snap the product on Amazon, then on the brand site, ask AI which is the real deal."
- "Capture three listings, send to ChatGPT: 'which is the best value?'"

📊 DASHBOARDS / DATA:
- "Snip just the spike, ask AI 'what could have caused this?'"
- "Snap weekly + monthly views of the same metric, ask 'is this a real trend or noise?'"

GENERAL HABITS:
- After every capture: offer the *next* step ("Now snip the title too and I'll send both") — not just praise.
- When the queue has 2+ images, suggest stitching or sending in one go.
- Celebrate wins briefly ("Nice grab!"), then immediately propose what to do with it.
- If the user sounds stuck or vague, ask ONE sharp clarifying question, then pitch a concrete workflow.
- Be bold with ideas — it's fine to suggest something the user hasn't thought of yet.

ABOUT THE APP (SnapToAI):
- Captures screenshots and sends them to AI chat sites (ChatGPT, Claude, Grok).
- Three capture modes: SNAP (visible area), SNIP (drag a region), FULL PAGE (auto-scrolls and stitches the whole page).
- Holds up to 10 screenshots in a queue at once.
- ASK AI button opens a built-in chat that uses the user's own Google Gemini key.
- AI modes inside the chat: Vision (analyze images), Image (generate pictures), Music (generate songs), Video (Veo video generation).
- Annotation tools: highlight brush, numbered callouts, text, stickers.
- Right-click anywhere on a webpage for a wand menu with all features.
- Works in 55 languages.
- 30-day free trial, then a paid plan via Whop.

UI ELEMENTS YOU CAN POINT AT (use the [glow:#id] tag at the END of your reply to make a button glow for the user):
- [glow:#snapButton] — the SNAP capture button (captures the visible viewport)
- [glow:#snipButton] — the SNIP region button (drag-select a region)
- [glow:#fullPageButton] — the FULL PAGE capture button (auto-scrolls and stitches)
- [glow:#directAiButton] — the ASK AI button (opens the built-in AI chat)
- [glow:#signInHeaderBtn] — sign in with Google
- [glow:#sendSelectedAiBtn] — send selected screenshots to a chat site like ChatGPT/Claude
- [glow:#copySelectedBtn] — copy selected screenshots to clipboard
- [glow:#exportPdfBtn] — export to PDF
- [glow:#downloadSelectedBtn] — download as PNG
- [glow:#youtubeBtn] — open the YouTube tutorials

GUIDELINES:
- Keep replies under 25 words when possible.
- If the user asks "how do I X", give one clear step + glow the button.
- If the user just chats, be a friend — encouraging, brief, light humor OK.
- Never invent features that aren't in the list above.
- If the user asks something unrelated to the app, gently steer back: "I'm best at helping you use SnapToAI — want a tip?"
- End with a [glow:#id] tag ONLY when you actually told them to click that button.`;

  const GEMINI_MODEL = 'gemini-2.0-flash';
  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  // Premium voice via Gemini native TTS (sounds human, not robotic).
  // 30 prebuilt voices available — Kore is warm + conversational.
  const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
  const TTS_URL = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`;
  const TTS_VOICE = 'Kore';
  const TTS_SAMPLE_RATE = 24000;

  // --- DOM refs (populated in init) ---
  let mascotEl = null;
  let bubbleEl = null;
  let recognition = null;
  let isListening = false;
  let isThinking = false;
  let isSpeaking = false;
  let currentUtterance = null;
  let conversationHistory = [];
  let inactivityTimer = null;
  const INACTIVITY_MS = 25000;

  function injectMascot() {
    if (document.getElementById('snap-mascot')) return;
    mascotEl = document.createElement('div');
    mascotEl.id = 'snap-mascot';
    mascotEl.title = 'Hi! I\'m Snap. Click to talk to me.';
    mascotEl.textContent = '📸';
    mascotEl.setAttribute('role', 'button');
    mascotEl.setAttribute('aria-label', 'Open Snap voice assistant');
    document.body.appendChild(mascotEl);

    bubbleEl = document.createElement('div');
    bubbleEl.id = 'snap-bubble';
    bubbleEl.innerHTML = `
      <button class="snap-bubble-close" aria-label="Close">×</button>
      <div class="snap-bubble-text"></div>
      <div class="snap-bubble-actions"></div>
    `;
    document.body.appendChild(bubbleEl);

    bubbleEl.querySelector('.snap-bubble-close').addEventListener('click', (e) => {
      e.stopPropagation();
      hideBubble();
      stopAll();
    });

    mascotEl.addEventListener('click', onMascotClick);
  }

  function showBubble(text, actions) {
    if (!bubbleEl) return;
    const txt = bubbleEl.querySelector('.snap-bubble-text');
    const act = bubbleEl.querySelector('.snap-bubble-actions');
    txt.textContent = text;
    act.innerHTML = '';
    (actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.className = 'snap-bubble-btn' + (a.danger ? ' snap-stop' : '');
      b.textContent = a.label;
      b.addEventListener('click', (e) => { e.stopPropagation(); a.onClick(); });
      act.appendChild(b);
    });
    bubbleEl.classList.add('show');
  }
  function hideBubble() { if (bubbleEl) bubbleEl.classList.remove('show'); }

  function setState(state) {
    if (!mascotEl) return;
    mascotEl.classList.remove('snap-thinking', 'snap-talking', 'snap-listening');
    if (state === 'thinking')   mascotEl.classList.add('snap-thinking');
    else if (state === 'talking')   mascotEl.classList.add('snap-talking');
    else if (state === 'listening') mascotEl.classList.add('snap-listening');
  }

  function stopAll() {
    if (recognition && isListening) {
      try { recognition.stop(); } catch (_) {}
    }
    if (currentUtterance) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
      currentUtterance = null;
    }
    stopGeminiAudio();
    isListening = false;
    isThinking = false;
    isSpeaking = false;
    setState('idle');
  }

  // --- Click handler: cycles through STOP → LISTEN ---
  async function onMascotClick() {
    // CRITICAL: Chrome blocks audio playback unless an AudioContext was
    // created/resumed *during* a user gesture. We prime it on every click
    // so the later async TTS reply can actually play sound.
    primeAudio();

    // If currently speaking or thinking, a click means "stop"
    if (isSpeaking || isThinking || isListening) {
      stopAll();
      hideBubble();
      return;
    }
    await startListening();
  }

  function primeAudio() {
    try {
      const ctx = getAudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      // Play one inaudible sample so Chrome marks the context as "user-activated"
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) {
      console.warn('[snap-coach] primeAudio failed:', e && e.message);
    }
  }

  // --- Browser speech recognition (free, built-in) ---
  async function startListening() {
    // Hard reset any in-flight speech / recognition first so we don't
    // (a) self-capture the assistant's own voice or (b) race onend handlers.
    if (isSpeaking || currentUtterance) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
      currentUtterance = null;
      isSpeaking = false;
    }
    if (recognition && isListening) {
      try { recognition.stop(); } catch (_) {}
      isListening = false;
    }
    setState('idle');

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      showBubble('Voice isn\'t supported in this browser. Try Chrome or Edge.', [
        { label: 'OK', onClick: hideBubble }
      ]);
      return;
    }
    // Need an API key to actually answer. Walk the user to settings.
    const key = await getGeminiKey();
    if (!key) {
      showBubble('I need your Gemini API key first — it\'s free from Google AI Studio. Want me to show you where to paste it?', [
        { label: 'Show me', onClick: () => { hideBubble(); glowTarget('#aiManageLink', 4500); } },
        { label: 'Not now',  onClick: hideBubble, danger: true }
      ]);
      return;
    }

    recognition = new SR();
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    isListening = true;
    setState('listening');
    showBubble('I\'m listening… ask me anything about the app.', [
      { label: 'Stop', onClick: () => { stopAll(); hideBubble(); }, danger: true }
    ]);

    recognition.onresult = (e) => {
      const transcript = (e.results[0] && e.results[0][0] && e.results[0][0].transcript) || '';
      isListening = false;
      if (!transcript.trim()) {
        showBubble('I didn\'t catch that — try again?', [{ label: 'OK', onClick: hideBubble }]);
        setState('idle');
        return;
      }
      handleUserUtterance(transcript.trim());
    };
    recognition.onerror = (e) => {
      isListening = false;
      setState('idle');
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        showBubble(
          'Chrome blocked the microphone for this extension. Tap "Fix it" — I\'ll open the right settings page so you can switch it to Allow in one click.',
          [
            { label: '🔧 Fix it for me', onClick: openMicSettings },
            { label: 'Not now', onClick: hideBubble, danger: true }
          ]
        );
      } else if (e.error === 'no-speech') {
        showBubble('I didn\'t hear anything — try again?', [
          { label: '🎤 Try again', onClick: () => { hideBubble(); startListening(); } },
          { label: 'Close', onClick: hideBubble, danger: true }
        ]);
      } else {
        showBubble('Mic hiccup: ' + e.error + '. Try again?', [
          { label: '🎤 Retry', onClick: () => { hideBubble(); startListening(); } },
          { label: 'Close', onClick: hideBubble, danger: true }
        ]);
      }
    };
    recognition.onend = () => {
      if (isListening) { isListening = false; setState('idle'); }
    };

    try {
      recognition.start();
    } catch (err) {
      isListening = false;
      setState('idle');
      showBubble('Couldn\'t start the mic: ' + err.message, [{ label: 'OK', onClick: hideBubble }]);
    }
  }

  // --- Send transcript through Gemini and speak the reply ---
  async function handleUserUtterance(transcript) {
    isThinking = true;
    setState('thinking');
    showBubble('You said: "' + transcript + '"\n\nThinking…');

    conversationHistory.push({ role: 'user', parts: [{ text: transcript }] });
    // Cap history so prompts stay cheap
    if (conversationHistory.length > 12) conversationHistory = conversationHistory.slice(-12);

    try {
      const reply = await callGemini(conversationHistory);
      isThinking = false;
      conversationHistory.push({ role: 'model', parts: [{ text: reply }] });

      // Pull out optional [glow:#selector] tag and clean the spoken text
      const glowMatch = reply.match(/\[glow:([^\]]+)\]/i);
      const spoken = reply.replace(/\[glow:[^\]]+\]/gi, '').trim();

      showBubble(spoken, [
        { label: '🎤 Reply', onClick: () => { hideBubble(); startListening(); } },
        { label: 'Done',    onClick: () => { hideBubble(); stopAll(); }, danger: true }
      ]);
      speak(spoken);
      if (glowMatch) glowTarget(glowMatch[1].trim(), 5000);
    } catch (err) {
      isThinking = false;
      setState('idle');
      const code = (err && err.message) || '';
      let friendly;
      if (code === 'RATE_LIMIT') {
        friendly = 'Whew, Google is asking me to slow down for a sec — that\'s their free-tier rate limit. Try again in about a minute and I\'ll be back!';
      } else if (code === 'NO_KEY') {
        friendly = 'I need your free Gemini key first. Want me to show you where to paste it?';
      } else if (/quota|exhausted/i.test(code)) {
        friendly = 'You\'ve used up today\'s free Google quota. It resets tomorrow — or you can grab a fresh key from Google AI Studio.';
      } else {
        friendly = 'Hmm, I couldn\'t reach Google just now. Quick retry?';
      }
      showBubble(friendly, [
        { label: '🎤 Retry', onClick: () => { hideBubble(); handleUserUtterance(transcript); } },
        { label: 'Close', onClick: hideBubble, danger: true }
      ]);
      // Use the FREE browser voice for errors so we don't burn more quota.
      browserTtsFallback(friendly);
    }
  }

  async function callGemini(history, retried) {
    const key = await getGeminiKey();
    if (!key) throw new Error('NO_KEY');
    const body = {
      systemInstruction: { parts: [{ text: SNAP_SYSTEM_PROMPT }] },
      contents: history,
      generationConfig: { temperature: 0.8, maxOutputTokens: 200 }
    };
    const resp = await fetch(GEMINI_URL + '?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 429 || resp.status === 503) {
      // Rate-limited or overloaded: auto-retry ONCE after a short cooldown.
      if (!retried) {
        await new Promise(r => setTimeout(r, 12000));
        return callGemini(history, true);
      }
      throw new Error('RATE_LIMIT');
    }
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) || ('HTTP ' + resp.status);
      throw new Error(msg);
    }
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join(' ').trim();
    if (!text) throw new Error('Empty reply.');
    return text;
  }

  // Opens Chrome's microphone settings page in a new tab so the user can
  // flip the toggle to "Allow" without hunting for a hidden lock icon.
  function openMicSettings() {
    hideBubble();
    try {
      const extId = chrome.runtime.id;
      // This page lets the user grant mic access specifically to this extension.
      const url = 'chrome://settings/content/siteDetails?site=chrome-extension%3A%2F%2F' + extId;
      chrome.tabs.create({ url });
    } catch (_) {
      try { chrome.tabs.create({ url: 'chrome://settings/content/microphone' }); } catch (__) {}
    }
    // Show a friendly nudge once the page opens
    setTimeout(() => {
      showBubble('Find "Microphone" on that page and switch it to Allow. Then come back and tap me again!', [
        { label: 'Got it', onClick: hideBubble }
      ]);
    }, 600);
  }

  function getGeminiKey() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(['geminiApiKey'], (r) => resolve(r && r.geminiApiKey));
      } catch (_) { resolve(null); }
    });
  }

  // --- Premium voice via Gemini native TTS (sounds human, not robotic) ---
  // Falls back to the browser's built-in voice only if Gemini TTS fails.
  let audioCtx = null;
  let currentAudioSource = null;

  function getAudioCtx() {
    if (!audioCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctor();
    }
    if (audioCtx.state === 'suspended') { try { audioCtx.resume(); } catch (_) {} }
    return audioCtx;
  }

  function stopGeminiAudio() {
    if (currentAudioSource) {
      try { currentAudioSource.onended = null; currentAudioSource.stop(); } catch (_) {}
      currentAudioSource = null;
    }
  }

  // Decode base64 → Int16 PCM → Float32 → AudioBuffer → play
  async function playPcm16(base64Pcm, sampleRate) {
    const bin = atob(base64Pcm);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    const sampleCount = Math.floor(bytes.length / 2);
    const f32 = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      f32[i] = view.getInt16(i * 2, true) / 32768;
    }
    const ctx = getAudioCtx();
    // Force-wake the context. If Chrome refuses (no user gesture in scope),
    // fall back to the browser voice immediately instead of going silent.
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (_) {}
      if (ctx.state === 'suspended') {
        console.warn('[snap-coach] AudioContext still suspended after resume — falling back.');
        throw new Error('audio-suspended');
      }
    }
    const buf = ctx.createBuffer(1, sampleCount, sampleRate);
    buf.copyToChannel(f32, 0, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => {
      if (currentAudioSource === src) currentAudioSource = null;
      isSpeaking = false;
      setState('idle');
    };
    stopGeminiAudio();
    currentAudioSource = src;
    isSpeaking = true;
    setState('talking');
    src.start(0);
    console.log('[snap-coach] 🔊 Playing Gemini voice (' + sampleCount + ' samples @ ' + sampleRate + 'Hz)');
  }

  async function geminiTts(text) {
    const key = await getGeminiKey();
    if (!key) throw new Error('No API key.');
    const body = {
      contents: [{ parts: [{ text: 'Say warmly and conversationally, like a friend giving a quick tip: ' + text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } }
        }
      }
    };
    const resp = await fetch(TTS_URL + '?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error((data && data.error && data.error.message) || ('TTS HTTP ' + resp.status));
    }
    const part = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData && p.inlineData.data);
    if (!part) throw new Error('TTS empty.');
    const mime = part.inlineData.mimeType || '';
    const m = mime.match(/rate=(\d+)/);
    const rate = m ? parseInt(m[1], 10) : TTS_SAMPLE_RATE;
    playPcm16(part.inlineData.data, rate);
  }

  function browserTtsFallback(text) {
    if (!('speechSynthesis' in window)) return;
    try { window.speechSynthesis.cancel(); } catch (_) {}
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05; u.pitch = 1.05; u.volume = 1;
    const voices = window.speechSynthesis.getVoices();
    const pref = voices.find(v => /en-US/i.test(v.lang) && /female|samantha|google|jenny|aria/i.test(v.name))
              || voices.find(v => /en-US/i.test(v.lang)) || voices[0];
    if (pref) u.voice = pref;
    isSpeaking = true; setState('talking');
    const done = () => { isSpeaking = false; currentUtterance = null; setState('idle'); };
    u.onend = done; u.onerror = done;
    currentUtterance = u;
    window.speechSynthesis.speak(u);
  }

  function speak(text) {
    // Try the premium voice first; only fall back to the robotic
    // browser voice if the network call fails.
    geminiTts(text).catch((err) => {
      console.warn('[snap-coach] Gemini TTS failed, falling back to browser voice:', err && err.message);
      browserTtsFallback(text);
    });
  }

  // --- Glow a UI element so the user can find it ---
  function glowTarget(selector, durationMs) {
    try {
      const el = document.querySelector(selector);
      if (!el) return;
      el.classList.add('snap-glow-target');
      // Scroll into view in the (small) popup
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => el.classList.remove('snap-glow-target'), durationMs || 4000);
    } catch (_) {}
  }

  // --- Proactive trigger: gentle nudge if the user sits idle ---
  function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      if (isListening || isThinking || isSpeaking) return;
      // Don't nag repeatedly in a single session
      if (sessionStorage.getItem('snap_nudged') === '1') return;
      sessionStorage.setItem('snap_nudged', '1');
      showBubble('Need a hand? Tap me and ask anything — like "how do I capture a whole page?"', [
        { label: '🎤 Ask',   onClick: () => { hideBubble(); startListening(); } },
        { label: 'Dismiss', onClick: hideBubble, danger: true }
      ]);
    }, INACTIVITY_MS);
  }

  // Public hook so popup.js (or anyone else) can fire celebratory nudges.
  window.SnapCoach = {
    celebrate(message) {
      if (isListening || isThinking || isSpeaking) return;
      const m = message || 'Nice capture! Tap me if you want to know what to do next.';
      showBubble(m, [
        { label: '🎤 Tip',   onClick: () => { hideBubble(); startListening(); } },
        { label: 'Thanks',  onClick: hideBubble, danger: true }
      ]);
      setTimeout(() => hideBubble(), 6000);
    },
    open() { startListening(); }
  };

  // --- Boot ---
  document.addEventListener('DOMContentLoaded', () => {
    injectMascot();
    // Warm up TTS voice list (Chrome lazy-loads them)
    try { window.speechSynthesis.getVoices(); } catch (_) {}
    resetInactivityTimer();
    ['mousemove', 'keydown', 'click', 'scroll'].forEach(evt =>
      document.addEventListener(evt, resetInactivityTimer, { passive: true })
    );
    // First-time greeting
    setTimeout(() => {
      if (sessionStorage.getItem('snap_greeted') === '1') return;
      sessionStorage.setItem('snap_greeted', '1');
      showBubble('Hey, I\'m Snap! Tap me anytime and I\'ll guide you through the app by voice.', [
        { label: '🎤 Try it', onClick: () => { hideBubble(); startListening(); } },
        { label: 'Cool',     onClick: hideBubble, danger: true }
      ]);
      setTimeout(() => hideBubble(), 7000);
    }, 800);
  });
})();
