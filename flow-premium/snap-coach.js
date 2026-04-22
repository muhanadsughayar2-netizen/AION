/* ============================================================================
   Snap — HUD shelf at the bottom of the popup, powered by the Gemini Live API
   (Bidi WebSocket). One persistent mic button toggles a streaming session.

   Why WebSocket / Live API:
   - The REST flow fired a separate HTTPS request for each text + TTS call,
     which is what was hitting Gemini's per-minute limits.
   - The Live API runs a single bidi WS session: user audio streams up, model
     audio + transcripts stream back. One connection per conversation, no
     repeated REST calls, much higher per-minute throughput.

   Stop semantics:
   - Tapping the mic while a session is active calls hardStop().
   - hardStop() closes the WebSocket immediately and stops all audio playback,
     so no more bytes leave the client.
   ============================================================================ */

(function () {
  'use strict';

  // ----- System prompt -----
  const SNAP_SYSTEM_PROMPT = `You are "Snap" — a warm, upbeat, slightly playful creative co-pilot living inside the SnapToAI Chrome extension. Speak like a friendly studio buddy: short spoken-style sentences (1-3 max), natural contractions, never robotic. Pitch creative workflows the user hasn't thought of.

ABOUT SNAPTOAI:
- Three capture modes: SNAP (viewport), SNIP (region), FULL PAGE (auto-scroll stitch).
- Holds up to 10 screenshots in a queue.
- ASK AI opens a built-in chat using the user's own Gemini key.
- AI modes: Vision, Image (Nano Banana), Music (Lyria), Video (Veo).
- Annotation: highlight, callouts, text, stickers.
- Right-click anywhere for the wand menu.

PROACTIVE COACHING:
- After a capture, suggest the next step (don't just praise).
- Spot opportunities: stocks (multi-timeframe), code (error+function context), design (competitor compare), learning (PDF stitch), shopping (compare listings), dashboards (anomaly check).
- If user is vague, ask ONE sharp clarifying question, then pitch a workflow.

UI ELEMENTS YOU CAN POINT AT (end your reply with [glow:#id] only when you actually told the user to click that button):
[glow:#snapButton] [glow:#snipButton] [glow:#fullPageButton] [glow:#directAiButton]
[glow:#signInHeaderBtn] [glow:#sendSelectedAiBtn] [glow:#copySelectedBtn]
[glow:#exportPdfBtn] [glow:#downloadSelectedBtn] [glow:#youtubeBtn]

GUIDELINES: Keep replies under 25 words when possible — they appear as live subtitles, short reads better.`;

  // Live API model (bidi audio in / audio out + transcripts).
  // Uses the user's existing Gemini API key (same as the rest of the extension).
  // gemini-2.0-flash-exp is the most stable Live API model in the wild and is
  // available on the standard paid tier without the preview-model rate limits
  // that were tripping the old TTS REST flow.
  const LIVE_MODEL = 'models/gemini-2.0-flash-exp';
  const LIVE_VOICE = 'Kore';
  const LIVE_WS_URL = (key) =>
    `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(key)}`;

  // ----- Per-session state -----
  let ws = null;
  let isSessionActive = false;     // WS open + mic streaming
  let setupComplete = false;
  let sessionId = 0;               // bumped on hardStop — invalidates stale callbacks

  // ----- Audio capture (mic → WS) -----
  let micStream = null;
  let captureCtx = null;
  let captureNode = null;
  let captureSource = null;
  let captureMute = null;

  // ----- Audio playback (WS → speakers) -----
  let playCtx = null;
  let playQueueTime = 0;
  let playingSources = [];

  // ----- DOM refs -----
  let shelfEl = null;
  let mascotEl = null;
  let bubbleEl = null;
  let micBtnEl = null;
  let labelDotEl = null;
  let labelHintEl = null;

  // ----- Subtitle text accumulators (Live API streams transcripts in chunks) -----
  let inputTranscriptBuffer = '';
  let outputTranscriptBuffer = '';
  let bubbleHideTimer = null;

  // ===========================================================================
  //  PUBLIC HOOK
  // ===========================================================================
  window.SnapCoach = {
    open() { /* shelf is always visible */ },
    close() { hardStop(); },
    celebrate(message) {
      if (isSessionActive) return;
      flashBubble(message || 'Nice capture! Tap the mic and ask me what to do next.', 'bot', 4500);
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
    injectShelf();
    // Remove the legacy header trigger if a previous version added it.
    const legacy = document.getElementById('snap-trigger');
    if (legacy) legacy.remove();
  }

  function injectShelf() {
    if (document.getElementById('snap-shelf')) return;
    shelfEl = document.createElement('div');
    shelfEl.id = 'snap-shelf';
    shelfEl.classList.add('snap-state-idle');
    shelfEl.innerHTML = `
      <div class="snap-shelf-bubble" aria-live="polite"></div>
      <div class="snap-shelf-mascot-wrap">
        <div class="snap-shelf-ring"></div>
        <div class="snap-shelf-mascot">📸</div>
      </div>
      <div class="snap-shelf-label">
        <strong>SNAP</strong>
        <span><span class="snap-shelf-status-dot"></span><span class="snap-shelf-hint">Tap the mic to talk</span></span>
      </div>
      <button class="snap-shelf-mic" type="button" title="Talk to Snap" aria-label="Talk to Snap">🎤</button>
    `;
    document.body.appendChild(shelfEl);

    mascotEl  = shelfEl.querySelector('.snap-shelf-mascot');
    bubbleEl  = shelfEl.querySelector('.snap-shelf-bubble');
    micBtnEl  = shelfEl.querySelector('.snap-shelf-mic');
    labelDotEl  = shelfEl.querySelector('.snap-shelf-status-dot');
    labelHintEl = shelfEl.querySelector('.snap-shelf-hint');

    micBtnEl.addEventListener('click', onMicClick);
  }

  function setStage(state, hint) {
    if (!shelfEl) return;
    shelfEl.classList.remove('snap-state-idle', 'snap-state-listening', 'snap-state-thinking', 'snap-state-talking');
    shelfEl.classList.add('snap-state-' + state);
    shelfEl.classList.toggle('snap-active', state !== 'idle');
    if (hint && labelHintEl) labelHintEl.textContent = hint;
  }

  function flashBubble(text, kind, autoHideMs) {
    if (!bubbleEl) return;
    clearTimeout(bubbleHideTimer);
    bubbleEl.classList.remove('snap-user', 'snap-error');
    if (kind === 'user')  bubbleEl.classList.add('snap-user');
    if (kind === 'error') bubbleEl.classList.add('snap-error');
    bubbleEl.textContent = text || '';
    bubbleEl.classList.add('snap-show');
    if (autoHideMs) bubbleHideTimer = setTimeout(hideBubble, autoHideMs);
  }
  function hideBubble() {
    if (bubbleEl) bubbleEl.classList.remove('snap-show');
  }

  // ===========================================================================
  //  MIC BUTTON — toggles the entire Live session
  // ===========================================================================
  async function onMicClick() {
    if (isSessionActive) {
      hardStop();
      flashBubble('Stopped.', 'bot', 1800);
      return;
    }
    await startLiveSession();
  }

  // ===========================================================================
  //  HARD STOP — kills the WebSocket + audio immediately
  // ===========================================================================
  function hardStop() {
    sessionId++;                      // invalidates any stale ws callbacks
    isSessionActive = false;
    setupComplete = false;

    // Stop mic capture first so we stop sending bytes upstream.
    try {
      if (captureNode)  { captureNode.disconnect(); }
      if (captureSource){ captureSource.disconnect(); }
      if (captureMute)  { captureMute.disconnect(); }
    } catch (_) {}
    captureNode = captureSource = captureMute = null;

    if (micStream) {
      try { micStream.getTracks().forEach(t => t.stop()); } catch (_) {}
      micStream = null;
    }
    if (captureCtx) {
      try { captureCtx.close(); } catch (_) {}
      captureCtx = null;
    }

    // Close the WebSocket so no more data is sent or received.
    if (ws) {
      try {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1000, 'user-stop');
      } catch (_) {}
      ws = null;
    }

    // Stop any audio playback already queued.
    try { playingSources.forEach(s => { try { s.onended = null; s.stop(); } catch (_) {} }); } catch (_) {}
    playingSources = [];
    playQueueTime = 0;
    inputTranscriptBuffer = '';
    outputTranscriptBuffer = '';

    setStage('idle', 'Tap the mic to talk');
  }

  // ===========================================================================
  //  START LIVE SESSION
  // ===========================================================================
  async function startLiveSession() {
    const key = await getGeminiKey();
    if (!key) {
      flashBubble("Add your Gemini API key in ⚙ Settings first — then tap the mic.", 'error', 6000);
      glowTarget('#aiManageLink', 4500);
      return;
    }

    // 1) Get mic access. Some Chrome builds need explicit permission for
    //    the extension popup; we surface a clear message if it fails.
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (err) {
      flashBubble("Chrome blocked the mic. Open Site settings → Microphone → Allow for this extension, then tap me again.", 'error', 7000);
      return;
    }

    const mySession = ++sessionId;
    setStage('listening', 'Connecting…');
    flashBubble("Connecting to Snap…", 'bot');

    // 2) Open the WebSocket.
    try {
      ws = new WebSocket(LIVE_WS_URL(key));
    } catch (err) {
      cleanupMic();
      flashBubble("Couldn't open Snap's voice channel: " + (err.message || err), 'error', 6000);
      setStage('idle', 'Tap the mic to talk');
      return;
    }

    ws.onopen = () => {
      if (mySession !== sessionId) return;
      // 3) Send setup. Live API expects setup as the very first message.
      const setupMsg = {
        setup: {
          model: LIVE_MODEL,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: LIVE_VOICE } }
            }
          },
          systemInstruction: { parts: [{ text: SNAP_SYSTEM_PROMPT }] },
          // Server VAD: detects when the user stops talking and triggers AI reply.
          realtimeInputConfig: {
            automaticActivityDetection: {}
          },
          // Get text transcripts of both sides for the live subtitle.
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      };
      try { ws.send(JSON.stringify(setupMsg)); } catch (_) {}
    };

    ws.onmessage = async (ev) => {
      if (mySession !== sessionId) return;
      let payload;
      try {
        const raw = (ev.data instanceof Blob) ? await ev.data.text() : ev.data;
        payload = JSON.parse(raw);
      } catch (_) { return; }
      handleLiveMessage(payload, mySession);
    };

    ws.onerror = () => {
      if (mySession !== sessionId) return;
      flashBubble("Voice channel error. Tap mic to retry.", 'error', 5000);
    };

    ws.onclose = (ev) => {
      if (mySession !== sessionId) return;
      const wasActive = isSessionActive;
      isSessionActive = false;
      setupComplete = false;
      cleanupMic();
      setStage('idle', 'Tap the mic to talk');
      if (wasActive && ev.code !== 1000) {
        // Code 1011/1008/1007 etc. — surface a friendly message
        const reason = (ev.reason || '').slice(0, 120);
        let msg = "Voice channel closed.";
        if (/quota|rate|exhaust/i.test(reason)) msg = "Google rate-limited the voice channel. Try again in a moment.";
        else if (/auth|key|permission/i.test(reason)) msg = "Your API key was rejected by the Live API. Check Settings.";
        else if (reason) msg = "Voice channel closed: " + reason;
        flashBubble(msg, 'error', 6000);
      }
    };
  }

  function cleanupMic() {
    try {
      if (captureNode)  captureNode.disconnect();
      if (captureSource) captureSource.disconnect();
      if (captureMute)   captureMute.disconnect();
    } catch (_) {}
    captureNode = captureSource = captureMute = null;
    if (micStream) {
      try { micStream.getTracks().forEach(t => t.stop()); } catch (_) {}
      micStream = null;
    }
    if (captureCtx) {
      try { captureCtx.close(); } catch (_) {}
      captureCtx = null;
    }
  }

  // ===========================================================================
  //  HANDLE INCOMING LIVE MESSAGES
  // ===========================================================================
  function handleLiveMessage(msg, mySession) {
    // Setup confirmed → start streaming mic audio
    if (msg.setupComplete) {
      setupComplete = true;
      isSessionActive = true;
      startMicStreaming(mySession);
      setStage('listening', 'Listening… speak now');
      flashBubble("I'm listening — go ahead.", 'bot', 2200);
      return;
    }

    if (!msg.serverContent) return;
    const sc = msg.serverContent;

    // User's own speech transcript (subtitle echo)
    if (sc.inputTranscription && sc.inputTranscription.text) {
      inputTranscriptBuffer += sc.inputTranscription.text;
      flashBubble('“' + inputTranscriptBuffer.trim() + '”', 'user');
    }

    // AI speech transcript (live subtitle)
    if (sc.outputTranscription && sc.outputTranscription.text) {
      outputTranscriptBuffer += sc.outputTranscription.text;
      // Strip glow tags from the visible subtitle as they stream in
      const visible = outputTranscriptBuffer.replace(/\[glow:[^\]]+\]/gi, '').trim();
      if (visible) flashBubble(visible, 'bot');
    }

    // AI audio chunks
    if (sc.modelTurn && sc.modelTurn.parts) {
      for (const part of sc.modelTurn.parts) {
        if (part.inlineData && part.inlineData.data && /audio\/pcm/i.test(part.inlineData.mimeType || '')) {
          const m = (part.inlineData.mimeType || '').match(/rate=(\d+)/);
          const rate = m ? parseInt(m[1], 10) : 24000;
          enqueuePcm(part.inlineData.data, rate, mySession);
        }
      }
      // Mascot starts "talking" the moment the first chunk arrives
      setStage('talking', 'Snap is speaking…');
    }

    // Server VAD detected user starting to speak — interrupt playback (barge-in)
    if (sc.interrupted) {
      stopAllPlayback();
      setStage('listening', 'Listening… speak now');
    }

    // End of AI turn — process glow tag, reset transcripts, idle the mascot
    if (sc.turnComplete) {
      const glowMatch = outputTranscriptBuffer.match(/\[glow:([^\]]+)\]/i);
      if (glowMatch) glowTarget(glowMatch[1].trim(), 5000);
      inputTranscriptBuffer = '';
      outputTranscriptBuffer = '';
      // Subtitle stays visible briefly, then fades
      bubbleHideTimer = setTimeout(hideBubble, 4500);
      // Stay in talking state until audio queue drains; otherwise return to listening
      if (playingSources.length === 0) setStage('listening', 'Listening… speak now');
    }
  }

  // ===========================================================================
  //  MIC STREAMING — PCM 16kHz mono → base64 → realtimeInput
  // ===========================================================================
  function startMicStreaming(mySession) {
    if (!micStream) return;
    try {
      // Try to create an AudioContext at 16kHz directly so no resampling is needed.
      // Some browsers ignore the option and pick the device sampleRate (typically 48000) —
      // we handle that case below.
      const Ctor = window.AudioContext || window.webkitAudioContext;
      try { captureCtx = new Ctor({ sampleRate: 16000 }); }
      catch (_) { captureCtx = new Ctor(); }

      captureSource = captureCtx.createMediaStreamSource(micStream);

      // ScriptProcessor is deprecated but still works everywhere and avoids
      // shipping a separate AudioWorklet module file in the extension.
      const bufSize = 4096;
      captureNode = captureCtx.createScriptProcessor(bufSize, 1, 1);

      // Mute the loopback so the user doesn't hear themselves.
      captureMute = captureCtx.createGain();
      captureMute.gain.value = 0;

      const inRate = captureCtx.sampleRate;
      const outRate = 16000;
      const ratio = inRate / outRate;

      captureNode.onaudioprocess = (e) => {
        if (mySession !== sessionId) return;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const inBuf = e.inputBuffer.getChannelData(0);

        // Downsample to 16kHz mono if needed (simple decimation works fine for speech).
        let pcm;
        if (Math.abs(inRate - outRate) < 1) {
          pcm = floatTo16(inBuf);
        } else {
          const outLen = Math.floor(inBuf.length / ratio);
          const out = new Float32Array(outLen);
          for (let i = 0; i < outLen; i++) out[i] = inBuf[Math.floor(i * ratio)];
          pcm = floatTo16(out);
        }
        const b64 = bytesToBase64(new Uint8Array(pcm.buffer));

        try {
          ws.send(JSON.stringify({
            realtimeInput: {
              mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: b64 }]
            }
          }));
        } catch (_) {}
      };

      captureSource.connect(captureNode);
      captureNode.connect(captureMute);
      captureMute.connect(captureCtx.destination);
    } catch (err) {
      flashBubble("Mic capture failed: " + (err.message || err), 'error', 6000);
      hardStop();
    }
  }

  function floatTo16(f32) {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      let s = Math.max(-1, Math.min(1, f32[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out;
  }
  function bytesToBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  // ===========================================================================
  //  PLAYBACK QUEUE — schedules incoming PCM chunks back-to-back
  // ===========================================================================
  function getPlayCtx() {
    if (!playCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      playCtx = new Ctor();
    }
    if (playCtx.state === 'suspended') {
      try { playCtx.resume(); } catch (_) {}
    }
    return playCtx;
  }

  function enqueuePcm(b64, rate, mySession) {
    if (mySession !== sessionId) return;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    const samples = Math.floor(bytes.length / 2);
    const f32 = new Float32Array(samples);
    for (let i = 0; i < samples; i++) f32[i] = view.getInt16(i * 2, true) / 32768;

    const ctx = getPlayCtx();
    const buf = ctx.createBuffer(1, samples, rate);
    buf.copyToChannel(f32, 0, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime + 0.02, playQueueTime);
    src.start(startAt);
    playQueueTime = startAt + buf.duration;
    playingSources.push(src);
    src.onended = () => {
      playingSources = playingSources.filter(s => s !== src);
      if (mySession !== sessionId) return;
      if (playingSources.length === 0 && isSessionActive) {
        setStage('listening', 'Listening… speak now');
      }
    };
  }

  function stopAllPlayback() {
    try { playingSources.forEach(s => { try { s.onended = null; s.stop(); } catch (_) {} }); } catch (_) {}
    playingSources = [];
    playQueueTime = 0;
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
