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
  const SNAP_SYSTEM_PROMPT = `You are "Snap" — a friendly, upbeat voice co-pilot living inside the SnapToAI Chrome extension. Speak in short, warm, spoken-style sentences (1-3 sentences max per reply). Never sound robotic. Use natural contractions. You are NOT a chatbot — you are the app's guide.

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
    isListening = false;
    isThinking = false;
    isSpeaking = false;
    setState('idle');
  }

  // --- Click handler: cycles through STOP → LISTEN ---
  async function onMascotClick() {
    // If currently speaking or thinking, a click means "stop"
    if (isSpeaking || isThinking || isListening) {
      stopAll();
      hideBubble();
      return;
    }
    await startListening();
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
      const msg = e.error === 'not-allowed'
        ? 'I need microphone permission. Click the lock icon in your address bar to allow it.'
        : (e.error === 'no-speech' ? 'I didn\'t hear anything — try again?' : 'Mic error: ' + e.error);
      showBubble(msg, [{ label: 'OK', onClick: hideBubble }]);
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
      showBubble('Hmm, I couldn\'t reach my brain. ' + (err.message || 'Try again?'), [
        { label: 'Retry', onClick: () => handleUserUtterance(transcript) },
        { label: 'Close', onClick: hideBubble, danger: true }
      ]);
    }
  }

  async function callGemini(history) {
    const key = await getGeminiKey();
    if (!key) throw new Error('No API key.');
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
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) || ('HTTP ' + resp.status);
      throw new Error(msg);
    }
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join(' ').trim();
    if (!text) throw new Error('Empty reply.');
    return text;
  }

  function getGeminiKey() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(['geminiApiKey'], (r) => resolve(r && r.geminiApiKey));
      } catch (_) { resolve(null); }
    });
  }

  // --- Browser TTS (free) ---
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    try { window.speechSynthesis.cancel(); } catch (_) {}
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.pitch = 1.05;
    u.volume = 1;
    // Prefer a friendly English voice if available
    const voices = window.speechSynthesis.getVoices();
    const pref = voices.find(v => /en-US/i.test(v.lang) && /female|samantha|google|jenny|aria/i.test(v.name))
              || voices.find(v => /en-US/i.test(v.lang))
              || voices[0];
    if (pref) u.voice = pref;

    isSpeaking = true;
    setState('talking');
    u.onend = () => {
      isSpeaking = false;
      currentUtterance = null;
      setState('idle');
    };
    u.onerror = () => {
      isSpeaking = false;
      currentUtterance = null;
      setState('idle');
    };
    currentUtterance = u;
    window.speechSynthesis.speak(u);
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
