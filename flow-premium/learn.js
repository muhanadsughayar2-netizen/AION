/* learn.js — SnapToAI Conversational Study Portal
   All APIs: Gemini text, Gemini TTS (voices), Gemini image, Veo video, Broadcast, Build
   API key: chrome.storage.sync.geminiApiKey
   MV3 compliant: no inline handlers */
'use strict';

// ── Models ────────────────────────────────────────────────────────────────────
const M = {
  chat:   'gemini-2.5-flash',
  tts:    'gemini-2.5-flash-preview-tts',
  imgGen: 'gemini-2.0-flash-preview-image-generation',
  veo:    'veo-3.1-generate-preview',
};
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const url  = (model, method = 'generateContent') =>
  k => `${BASE}${model}:${method}?key=${k}`;

// ── State ─────────────────────────────────────────────────────────────────────
let GEMINI_KEY   = '';
let fileCtx      = '';   // extracted text from uploaded file
let fileData     = null; // { base64, mimeType } — kept for image/PDF re-sends
let chatHistory  = [];   // [{role,text}] shown in UI
let isBusy       = false;

// Broadcast playback state
let bcLines = [];
let bcIdx   = 0;
let bcPlaying = false;
let bcAbort  = false;
const BC_VOICES = {
  ZEPHYR: { role: 'Host',    geminiVoice: 'Zephyr', color: '#2DD4BF', icon: '🎙️' },
  KORE:   { role: 'Expert',  geminiVoice: 'Kore',   color: '#A78BFA', icon: '🎓' },
  FENRIR: { role: 'Creative',geminiVoice: 'Puck',   color: '#F97316', icon: '⚡' },
};

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadKey();
  bindAll();
});

function loadKey() {
  chrome.storage.sync.get(['geminiApiKey'], res => {
    GEMINI_KEY = res.geminiApiKey || '';
    const badge = document.getElementById('keyBadge');
    if (GEMINI_KEY) {
      badge.textContent = '🔑 Key ready';
      badge.className = 'ok';
    } else {
      badge.textContent = '⚠ No Key — open SnapToAI and save your Gemini key first';
      badge.className = '';
    }
  });
}

// ── Bind all events ───────────────────────────────────────────────────────────
function bindAll() {
  // Send button
  document.getElementById('sendBtn').addEventListener('click', handleSend);

  // Enter to send (Shift+Enter = newline)
  document.getElementById('msgInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });

  // Auto-resize textarea
  document.getElementById('msgInput').addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  // Quick chips
  document.querySelectorAll('.quick-chip, .example-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const msg = chip.dataset.msg;
      if (msg) { sendMessage(msg); }
    });
  });

  // File buttons
  document.getElementById('fileDropBtn').addEventListener('click', () =>
    document.getElementById('fileInputHidden').click());
  document.getElementById('uploadHintBtn')?.addEventListener('click', () =>
    document.getElementById('fileInputHidden').click());
  document.getElementById('fileInputHidden').addEventListener('change', e => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });
  document.getElementById('hdrCtx').addEventListener('click', clearFile);

  // Drag & drop anywhere on page
  document.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragging'); });
  document.addEventListener('dragleave', e => {
    if (!e.relatedTarget || e.relatedTarget === document.body) document.body.classList.remove('dragging');
  });
  document.addEventListener('drop', e => {
    e.preventDefault();
    document.body.classList.remove('dragging');
    const file = e.dataTransfer?.files[0];
    if (file) handleFile(file);
  });
}

// ── File handling ─────────────────────────────────────────────────────────────
async function handleFile(file) {
  if (!GEMINI_KEY) { appendSystem('No API key — save your key in SnapToAI first.'); return; }
  const allowed = ['application/pdf','image/png','image/jpeg','image/webp','text/plain','text/markdown'];
  const mime = file.type || 'text/plain';
  if (!allowed.includes(mime) && !file.name.endsWith('.md')) {
    appendSystem('Please use a PDF, PNG, JPG, WEBP, or TXT/MD file.'); return;
  }

  appendSystem(`📎 Reading "${file.name}"…`);
  try {
    const b64 = await fileToBase64(file);
    fileData = { base64: b64, mimeType: mime };

    if (mime.startsWith('text/') || file.name.endsWith('.md')) {
      fileCtx = atob(b64).slice(0, 12000);
    } else {
      // Extract text context from image/PDF using Gemini vision
      const res = await fetch(url(M.chat)(GEMINI_KEY), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [
            { text: 'Extract all text content and key information from this file. Return plain text, comprehensive.' },
            { inline_data: { mime_type: mime, data: b64 } }
          ]}],
          generationConfig: { temperature: 0.1, maxOutputTokens: 6000 }
        })
      });
      const d = await res.json();
      fileCtx = d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    // Update header context indicator
    document.getElementById('hdrCtx').style.display = '';
    document.getElementById('ctxName').textContent = file.name;
    hideWelcome();
    appendSystem(`✅ File loaded: "${file.name}". Now tell me what to create — flashcards, quiz, broadcast, video, and more.`);
  } catch (err) {
    appendSystem('Error reading file: ' + err.message);
    fileCtx = ''; fileData = null;
  }
}

function clearFile() {
  fileCtx = ''; fileData = null;
  document.getElementById('hdrCtx').style.display = 'none';
  document.getElementById('fileInputHidden').value = '';
  appendSystem('File cleared. You can upload a new one anytime.');
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ── Message send ──────────────────────────────────────────────────────────────
function handleSend() {
  const input = document.getElementById('msgInput');
  const msg = input.value.trim();
  if (!msg || isBusy) return;
  input.value = '';
  input.style.height = '';
  sendMessage(msg);
}

async function sendMessage(msg) {
  if (isBusy) return;
  if (!GEMINI_KEY) { appendSystem('No API key. Open SnapToAI and add your Gemini key via the 🔑 button.'); return; }

  hideWelcome();
  appendUserMsg(msg);
  chatHistory.push({ role: 'user', text: msg });

  setBusy(true);
  const thinkEl = appendThinking();

  try {
    const response = await callConversational(msg);
    thinkEl.remove();

    // Show conversational reply
    if (response.reply) appendAIMsg(response.reply);

    // Execute action
    await executeAction(response.action, response.payload, msg);

    chatHistory.push({ role: 'ai', text: response.reply || '' });
  } catch (err) {
    thinkEl.remove();
    appendSystem('Error: ' + (err.message || 'Something went wrong'));
  } finally {
    setBusy(false);
  }
}

// ── Core conversational Gemini call ──────────────────────────────────────────
async function callConversational(userMsg) {
  const fileSection = fileCtx
    ? `\n\nUPLOADED STUDY MATERIAL (use this as the topic unless the user specifies otherwise):\n"""\n${fileCtx.slice(0,8000)}\n"""`
    : '';

  const historyText = chatHistory.slice(-6)
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n');

  const systemInstruction = `You are SnapToAI Study — a powerful AI learning assistant with access to ALL these capabilities. Understand the user's intent and respond with the best action.

CAPABILITIES:
- "flashcards" → create flip cards to memorize content
- "quiz" → multiple-choice questions with answers and explanations
- "broadcast" → 3-host podcast/talk show script (ZEPHYR=host, KORE=expert, FENRIR=energetic commentator)
- "explain" → clear explanation with optional language and voice
- "tts" → speak text aloud using a Gemini AI voice
- "video" → generate a tutorial video using Veo AI
- "build" → create a full website, presentation, or game
- "image" → generate an AI illustration of the topic
- "none" → just have a friendly conversation

INTENT DETECTION:
- "flashcards", "flash cards", "cards", "memorize" → action: "flashcards"
- "quiz", "test me", "questions" → action: "quiz"
- "broadcast", "podcast", "talk show", "radio", "episode" → action: "broadcast"
- "explain", "teach me", "tell me about" → action: "explain"
- "read aloud", "speak", "voice", "listen", "audio" → action: "tts"
- "video", "tutorial video", "make a video" → action: "video"
- "build", "website", "site", "presentation", "game" → action: "build"
- "illustrate", "draw", "generate image", "picture" → action: "image"

RECENT CONVERSATION:
${historyText}${fileSection}

RESPONSE FORMAT — always return valid JSON, no markdown fences:
{
  "reply": "Short friendly message (1-2 sentences, MAX 40 words). Confirm what you're creating.",
  "action": "none|flashcards|quiz|broadcast|explain|tts|video|build|image",
  "payload": { ... }
}

PAYLOAD SCHEMAS:
flashcards → { "topic":"...", "cards":[{"front":"term or question","back":"answer or definition"}] }
  - Create as many cards as requested (default 10, max 100)

quiz → { "topic":"...", "questions":[{"q":"...","options":["A) ...","B) ...","C) ...","D) ..."],"answer":"A) ...","explanation":"..."}] }
  - Default 10 questions, create as many as requested

broadcast → { "title":"...", "format":"talkshow", "lines":[{"speaker":"ZEPHYR|KORE|FENRIR","text":"..."}] }
  - ZEPHYR: warm host, KORE: curious expert, FENRIR: energetic commentator
  - 1 min = ~8 exchanges, 3 min = ~20 exchanges, 5 min = ~30 exchanges
  - Default to 3 minutes unless user specifies

explain → { "language":"English", "title":"...", "text":"Full explanation (300-600 words)...", "voice":"Zephyr" }
  - Use the language the user requests. Voice: Zephyr, Kore, Puck, Fenrir, Aoede, Charon

tts → { "text":"Text to speak aloud (keep under 300 words)...", "voice":"Zephyr" }

video → { "title":"...", "prompt":"Detailed cinematic Veo video prompt for a tutorial video about this topic. Describe visuals, narration style, shots. Be specific and cinematic.", "durationSeconds": 8 }

build → { "type":"site|presentation|game", "title":"...", "buildPrompt":"Full build instruction for the AI — e.g. Build a beautiful landing page about [topic] with..." }
  - type "site" → website
  - type "presentation" → PowerPoint-style slides
  - type "game" → browser game

image → { "title":"...", "imagePrompt":"Detailed Imagen prompt — educational illustration of [topic]. Style: clean, modern, labeled diagram. Bright colors." }`;

  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: userMsg }] }],
    generationConfig: { temperature: 0.6, maxOutputTokens: 8192, responseMimeType: 'application/json' }
  };

  const res = await fetch(url(M.chat)(GEMINI_KEY), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `API ${res.status}`); }
  const d = await res.json();
  const raw = d?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  return JSON.parse(raw.replace(/^```json\s*/,'').replace(/\s*```$/,'').trim());
}

// ── Action Router ─────────────────────────────────────────────────────────────
async function executeAction(action, payload, userMsg) {
  if (!payload || action === 'none' || !action) return;

  switch (action) {
    case 'flashcards': renderFlashcards(payload); break;
    case 'quiz':       renderQuiz(payload); break;
    case 'broadcast':  renderBroadcast(payload); break;
    case 'explain':    renderExplain(payload); break;
    case 'tts':        await speakText(payload.text || userMsg, payload.voice || 'Zephyr'); break;
    case 'video':      await renderVideo(payload); break;
    case 'build':      await renderBuild(payload); break;
    case 'image':      await renderImage(payload); break;
    default: break;
  }
}

// ── Flashcards ────────────────────────────────────────────────────────────────
function renderFlashcards(p) {
  const cards = p.cards || [];
  if (!cards.length) return;
  let idx = 0;

  const card = makeContentCard(`🎴 Flashcards — ${p.topic || ''} (${cards.length} cards)`);
  const body = card.querySelector('.content-card-body');

  const wrap = el('div','flashcard-set');
  const flipWrap = el('div','flip-wrap');
  flipWrap.innerHTML = `<div class="flip-inner"><div class="flip-face flip-front" id="fcFront">${escH(cards[0].front)}</div><div class="flip-face flip-back" id="fcBack">${escH(cards[0].back)}</div></div>`;
  flipWrap.addEventListener('click', () => flipWrap.classList.toggle('flipped'));

  const counter = el('div','fc-counter'); counter.textContent = `1 / ${cards.length}`;

  const nav = el('div','fc-nav');
  const prev = btn('← Prev','fc-nav'); const next = btn('Next →','fc-nav');
  prev.addEventListener('click', () => { if (idx > 0) { idx--; updateCard(); } });
  next.addEventListener('click', () => { if (idx < cards.length-1) { idx++; updateCard(); } });
  nav.append(prev, counter, next);

  function updateCard() {
    flipWrap.classList.remove('flipped');
    setTimeout(() => {
      document.getElementById('fcFront').textContent = cards[idx].front;
      document.getElementById('fcBack').textContent  = cards[idx].back;
      counter.textContent = `${idx+1} / ${cards.length}`;
    }, 180);
  }

  const hint = el('p'); hint.style.cssText='font-size:11px;color:#475569'; hint.textContent='Tap card to flip';
  wrap.append(flipWrap, nav, hint);
  body.appendChild(wrap);
  appendCard(card);
}

// ── Quiz ──────────────────────────────────────────────────────────────────────
function renderQuiz(p) {
  const qs = p.questions || [];
  if (!qs.length) return;
  const answered = {};

  const card = makeContentCard(`❓ Quiz — ${p.topic || ''} (${qs.length} questions)`);
  const body = card.querySelector('.content-card-body');

  qs.forEach((q, qi) => {
    const block = el('div','quiz-q-block');
    const qText = el('div','quiz-q-text'); qText.textContent = `${qi+1}. ${q.q}`;
    const opts  = el('div','quiz-opts');
    const expl  = el('div','quiz-expl'); expl.textContent = q.explanation || '';

    q.options.forEach(opt => {
      const b = el('button','quiz-opt-btn'); b.textContent = opt;
      b.addEventListener('click', () => {
        if (answered[qi]) return;
        answered[qi] = opt;
        const correct = opt === q.answer;
        b.classList.add(correct ? 'correct' : 'wrong');
        opts.querySelectorAll('.quiz-opt-btn').forEach(ob => {
          if (ob.textContent === q.answer) ob.classList.add('correct');
          ob.disabled = true;
        });
        expl.style.display = '';
        // wrong answer → auto-ask tutor inline
        if (!correct) {
          const tutorNote = el('div'); tutorNote.style.cssText='margin-top:8px;font-size:12px;color:#F59E0B';
          tutorNote.textContent = '💡 Ask your tutor about this by typing below!';
          block.appendChild(tutorNote);
          // Pre-fill the input with a tutor question
          document.getElementById('msgInput').value =
            `I got question "${q.q}" wrong. I chose "${opt}" but the answer is "${q.answer}". Can you explain why?`;
        }
        checkScore();
      });
      opts.appendChild(b);
    });

    block.append(qText, opts, expl);
    body.appendChild(block);
  });

  const scoreEl = el('div','quiz-score');
  body.appendChild(scoreEl);

  function checkScore() {
    if (Object.keys(answered).length < qs.length) return;
    const correct = qs.filter((q,i) => answered[i] === q.answer).length;
    scoreEl.textContent = `🎉 ${correct} / ${qs.length} correct!`;
    scoreEl.style.display = '';
  }

  appendCard(card);
}

// ── Broadcast ─────────────────────────────────────────────────────────────────
function renderBroadcast(p) {
  bcLines = p.lines || [];
  bcIdx = 0; bcPlaying = false; bcAbort = false;

  const card = makeContentCard(`🎙️ ${p.title || 'Broadcast'}`);
  const body = card.querySelector('.content-card-body');

  // Script display
  const scriptEl = el('div','bc-script');
  bcLines.forEach((line, i) => {
    const spk = BC_VOICES[line.speaker] || BC_VOICES.ZEPHYR;
    const row = el('div','bc-line'); row.id = `bc-line-${i}`;
    const spkEl = el('div','bc-speaker');
    spkEl.style.color = spk.color;
    spkEl.textContent = `${spk.icon} ${line.speaker}`;
    const txt = el('div','bc-text'); txt.textContent = line.text;
    row.append(spkEl, txt);
    scriptEl.appendChild(row);
  });
  body.appendChild(scriptEl);

  // Controls
  const controls = el('div','bc-controls');

  const playBtn = el('button','bc-btn'); playBtn.id = 'bcPlayBtn';
  playBtn.innerHTML = '▶ Play Broadcast';
  playBtn.addEventListener('click', () => {
    if (bcPlaying) { bcAbort = true; bcPlaying = false; playBtn.innerHTML = '▶ Play Broadcast'; }
    else { bcAbort = false; playBtn.innerHTML = '⏹ Stop'; playBroadcast(playBtn); }
  });
  controls.appendChild(playBtn);
  body.appendChild(controls);

  appendCard(card);
}

async function playBroadcast(playBtn) {
  bcPlaying = true;
  for (let i = bcIdx; i < bcLines.length; i++) {
    if (bcAbort) break;
    bcIdx = i;
    // Highlight current line
    document.querySelectorAll('.bc-line').forEach(r => r.style.background = '');
    const lineEl = document.getElementById(`bc-line-${i}`);
    if (lineEl) lineEl.style.background = 'rgba(99,102,241,0.12)';

    const line = bcLines[i];
    const spk  = BC_VOICES[line.speaker] || BC_VOICES.ZEPHYR;
    await speakGemini(line.text, spk.geminiVoice);
    if (bcAbort) break;
    await sleep(200);
  }
  document.querySelectorAll('.bc-line').forEach(r => r.style.background = '');
  bcPlaying = false; bcIdx = 0;
  if (playBtn) playBtn.innerHTML = '▶ Play Broadcast';
}

// ── Explain ───────────────────────────────────────────────────────────────────
function renderExplain(p) {
  const card = makeContentCard(`📖 ${p.title || 'Explanation'}${p.language !== 'English' ? ' — ' + p.language : ''}`);
  const body = card.querySelector('.content-card-body');

  const textEl = el('div','explain-body'); textEl.textContent = p.text || '';
  body.appendChild(textEl);

  // Voice buttons
  const voiceRow = el('div','speak-row');
  const voices = [
    { name: 'Zephyr', label: '🎙 Zephyr' },
    { name: 'Kore',   label: '🎓 Kore' },
    { name: 'Puck',   label: '⚡ Puck' },
    { name: 'Aoede',  label: '🌊 Aoede' },
  ];
  voices.forEach(v => {
    const vBtn = el('button','speak-voice-btn');
    vBtn.textContent = v.label;
    vBtn.addEventListener('click', () => speakText(p.text, v.name));
    voiceRow.appendChild(vBtn);
  });
  body.appendChild(voiceRow);
  appendCard(card);
}

// ── TTS ───────────────────────────────────────────────────────────────────────
async function speakText(text, voice = 'Zephyr') {
  await speakGemini(text, voice);
}

async function speakGemini(text, voiceName = 'Zephyr') {
  if (!GEMINI_KEY) { speakFallback(text); return; }
  try {
    const res = await fetch(
      `${BASE}${M.tts}:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Speak naturally and clearly: ' + text }] }],
          generationConfig: {
            response_modalities: ['AUDIO'],
            speech_config: { voice_config: { prebuilt_voice_config: { voice_name: voiceName } } }
          }
        })
      }
    );
    const d = await res.json();
    const part = d?.candidates?.[0]?.content?.parts?.[0]?.inline_data;
    if (!part?.data) { speakFallback(text); return; }
    const pcm  = Uint8Array.from(atob(part.data), c => c.charCodeAt(0));
    const mime = (part.mime_type || '').toLowerCase();
    let blob;
    if (!mime || mime.includes('pcm') || mime.startsWith('audio/l16')) {
      blob = new Blob([pcmToWav(pcm)], { type: 'audio/wav' });
    } else {
      blob = new Blob([pcm], { type: mime });
    }
    const audioURL = URL.createObjectURL(blob);
    const audio = new Audio(audioURL);
    audio.onended = () => URL.revokeObjectURL(audioURL);
    await audio.play();
    // Wait for it to finish before resolving (for broadcast sequential playback)
    await new Promise(resolve => { audio.onended = () => { URL.revokeObjectURL(audioURL); resolve(); }; });
  } catch (e) { speakFallback(text); }
}

function speakFallback(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.93; u.pitch = 1.02;
  window.speechSynthesis.speak(u);
  // Return promise that resolves when done
  return new Promise(resolve => { u.onend = resolve; });
}

function pcmToWav(pcm) {
  const sr = 24000, ch = 1, bps = 16;
  const buf = new ArrayBuffer(44 + pcm.byteLength);
  const dv  = new DataView(buf);
  const ws  = (o, v) => { for (let i = 0; i < v.length; i++) dv.setUint8(o+i, v.charCodeAt(i)); };
  ws(0,'RIFF'); dv.setUint32(4, 36+pcm.byteLength, true);
  ws(8,'WAVE'); ws(12,'fmt ');
  dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,ch,true);
  dv.setUint32(24,sr,true); dv.setUint32(28,sr*ch*bps/8,true);
  dv.setUint16(32,ch*bps/8,true); dv.setUint16(34,bps,true);
  ws(36,'data'); dv.setUint32(40,pcm.byteLength,true);
  new Uint8Array(buf).set(pcm, 44);
  return buf;
}

// ── Video (Veo) ───────────────────────────────────────────────────────────────
async function renderVideo(p) {
  const card = makeContentCard(`🎬 ${p.title || 'Tutorial Video'}`);
  const body = card.querySelector('.content-card-body');

  const statusEl = el('div','video-status'); statusEl.textContent = '⏳ Generating video with Veo AI… (this takes 1-3 minutes)';
  body.appendChild(statusEl);
  appendCard(card);

  try {
    const prompt = p.prompt || `Educational tutorial video about: ${p.title}`;
    const dur    = p.durationSeconds || 8;

    // Kick off Veo predictLongRunning
    const initRes = await fetch(
      `${BASE}${M.veo}:predictLongRunning?key=${GEMINI_KEY}`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { aspectRatio: '16:9', durationSeconds: dur, sampleCount: 1 }
        })
      }
    );
    if (!initRes.ok) { const e = await initRes.json().catch(()=>({})); throw new Error(e?.error?.message || `Veo ${initRes.status}`); }
    const initData = await initRes.json();
    const opName = initData.name;
    if (!opName) throw new Error('No operation name returned from Veo');

    // Poll
    statusEl.textContent = '🎬 Rendering… checking every 15 seconds…';
    let videoUri = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await sleep(attempt < 4 ? 8000 : 15000);
      const pollRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${opName}?key=${GEMINI_KEY}`
      );
      const pollData = await pollRes.json();
      if (pollData.done) {
        const videos = pollData.response?.predictions?.[0]?.video?.uri
          ? [pollData.response.predictions[0].video.uri]
          : (pollData.response?.predictions || []).map(pred => pred?.bytesBase64Encoded ? pred : null).filter(Boolean);
        if (pollData.response?.predictions?.[0]?.bytesBase64Encoded) {
          const b64  = pollData.response.predictions[0].bytesBase64Encoded;
          const blob = new Blob([Uint8Array.from(atob(b64), c=>c.charCodeAt(0))], { type: 'video/mp4' });
          videoUri = URL.createObjectURL(blob);
        } else if (pollData.response?.predictions?.[0]?.video?.uri) {
          videoUri = pollData.response.predictions[0].video.uri + '?key=' + GEMINI_KEY;
        }
        break;
      }
      statusEl.textContent = `🎬 Still rendering… (attempt ${attempt+1}/20)`;
    }

    if (videoUri) {
      statusEl.remove();
      const videoEl = document.createElement('video');
      videoEl.src = videoUri; videoEl.controls = true; videoEl.className = 'gen-image';
      body.appendChild(videoEl);
    } else {
      statusEl.textContent = '⚠ Video generation timed out. Try again or use a shorter prompt.';
    }
  } catch (err) {
    statusEl.textContent = '⚠ Video error: ' + err.message;
  }
}

// ── Build (Site / Presentation / Game) ───────────────────────────────────────
async function renderBuild(p) {
  const card = makeContentCard(`🏗️ Building ${p.type || 'site'}: ${p.title || ''}`);
  const body = card.querySelector('.content-card-body');
  const statusEl = el('div','video-status'); statusEl.textContent = '⚙️ Gemini is generating your ' + (p.type || 'site') + '…';
  body.appendChild(statusEl);
  appendCard(card);

  try {
    // Use the build system prompt from ai-chat
    const buildPromptMap = {
      site:         'Build a beautiful, professional landing page / website',
      presentation: 'Create a stunning PowerPoint-style HTML presentation with slide navigation',
      game:         'Build a fun, playable browser game using HTML canvas',
    };
    const base = buildPromptMap[p.type] || buildPromptMap.site;
    const fullPrompt = `${base} about: ${p.buildPrompt || p.title || 'the topic'}.

CRITICAL RULES:
- Return ONLY raw HTML (no markdown fences, no explanation)
- Complete self-contained HTML page with all CSS inline
- Beautiful, modern design with animations
- No external CDN links except Google Fonts
- Mobile responsive`;

    const res = await fetch(url(M.chat)(GEMINI_KEY), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
      })
    });
    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e?.error?.message || `API ${res.status}`); }
    const d = await res.json();
    const html = (d?.candidates?.[0]?.content?.parts?.[0]?.text || '')
      .replace(/^```html\s*/,'').replace(/\s*```$/,'').trim();

    statusEl.remove();
    const blob = new Blob([html], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);
    const iframe = document.createElement('iframe');
    iframe.src = blobUrl; iframe.className = 'build-result-frame';
    body.appendChild(iframe);

    // Download button
    const dlBtn = el('button','bc-btn'); dlBtn.style.marginTop = '10px';
    dlBtn.textContent = '⬇ Download HTML';
    dlBtn.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = blobUrl; a.download = (p.title || 'page').replace(/\s+/g,'-').toLowerCase() + '.html';
      a.click();
    });
    body.appendChild(dlBtn);
  } catch (err) {
    statusEl.textContent = '⚠ Build error: ' + err.message;
  }
}

// ── Image generation ──────────────────────────────────────────────────────────
async function renderImage(p) {
  const card = makeContentCard(`🖼️ ${p.title || 'Illustration'}`);
  const body = card.querySelector('.content-card-body');
  const statusEl = el('div','video-status'); statusEl.textContent = '🎨 Generating illustration…';
  body.appendChild(statusEl);
  appendCard(card);

  try {
    const res = await fetch(url(M.imgGen)(GEMINI_KEY), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: p.imagePrompt || 'Educational illustration about: ' + p.title }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
      })
    });
    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e?.error?.message || `API ${res.status}`); }
    const d = await res.json();
    const imgPart = d?.candidates?.[0]?.content?.parts?.find(pt => pt.inline_data?.mime_type?.startsWith('image/'));
    if (!imgPart) throw new Error('No image returned');
    statusEl.remove();
    const imgEl = document.createElement('img');
    imgEl.src = `data:${imgPart.inline_data.mime_type};base64,${imgPart.inline_data.data}`;
    imgEl.className = 'gen-image';
    body.appendChild(imgEl);
  } catch (err) {
    statusEl.textContent = '⚠ Image error: ' + err.message;
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function appendUserMsg(text) {
  const chat = document.getElementById('chatArea');
  const row = el('div','msg-row user');
  const av  = el('div','msg-avatar user-av'); av.textContent = '👤';
  const bbl = el('div','msg-bubble user');    bbl.textContent = text;
  row.append(av, bbl);
  chat.appendChild(row);
  scrollChat();
}

function appendAIMsg(text) {
  const chat = document.getElementById('chatArea');
  const row = el('div','msg-row');
  const av  = document.createElement('img');
  av.src = 'icons/agent-avatar.png'; av.className = 'msg-avatar'; av.alt='';
  const bbl = el('div','msg-bubble ai'); bbl.textContent = text;
  row.append(av, bbl);
  chat.appendChild(row);
  scrollChat();
  return bbl;
}

function appendSystem(text) {
  const chat = document.getElementById('chatArea');
  const bbl = el('div','msg-bubble system'); bbl.textContent = text;
  chat.appendChild(bbl);
  scrollChat();
}

function appendThinking() {
  const chat = document.getElementById('chatArea');
  const div = el('div','msg-thinking');
  div.innerHTML = `<img src="icons/agent-avatar.png" style="width:24px;height:24px;border-radius:50%;object-fit:cover;" alt=""><span class="dot-pulse"><span></span><span></span><span></span></span>`;
  chat.appendChild(div);
  scrollChat();
  return div;
}

function appendCard(card) {
  document.getElementById('chatArea').appendChild(card);
  scrollChat();
}

function makeContentCard(title) {
  const card = el('div','content-card');
  const hdr  = el('div','content-card-header'); hdr.textContent = title;
  const body = el('div','content-card-body');
  card.append(hdr, body);
  return card;
}

function hideWelcome() {
  const w = document.getElementById('welcome');
  if (w) w.style.display = 'none';
}

function setBusy(b) {
  isBusy = b;
  document.getElementById('sendBtn').disabled = b;
  document.getElementById('msgInput').disabled = b;
}

function scrollChat() {
  const chat = document.getElementById('chatArea');
  chat.scrollTop = chat.scrollHeight;
}

function el(tag, cls = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function btn(text, cls = '') {
  const b = document.createElement('button');
  b.textContent = text;
  if (cls) b.className = cls;
  return b;
}

function escH(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
