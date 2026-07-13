/* learn.js — SnapToAI Conversational Study Portal
   All APIs: Gemini text, Gemini TTS (voices), Gemini image, Veo video, Broadcast, Build
   API key: chrome.storage.sync.geminiApiKey
   MV3 compliant: no inline handlers */
'use strict';

// ── Models — mirror MODELS constant from ai-chat.js ──────────────────────────
const M = {
  chat:       'gemini-3-flash-preview',
  tts:        'gemini-2.5-flash-preview-tts',
  ttsFallback:'gemini-2.5-pro-preview-tts',
  imgChain:  ['gemini-3.1-flash-image','gemini-2.5-flash-image','gemini-3-pro-image-preview'],
  veo:        'veo-3.1-generate-preview',
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

  const systemInstruction = `You are AI Tutor — an unlimited AI learning assistant. Your job is to understand what the user wants and create it, no matter how much or how little. There are NO limits on quantity, length, or language.

RECENT CONVERSATION:
${historyText}${fileSection}

ACTIONS — pick the one that best matches what the user is asking for:
- "flashcards" → flip cards to memorize content. Create EXACTLY as many as requested. If the user says 100, make 100. If they say 5, make 5.
- "quiz" → multiple-choice questions. Create EXACTLY as many as the user asks. No limit.
- "broadcast" → 3-host podcast/talk show. ZEPHYR=warm host, KORE=expert, FENRIR=energetic. Scale to the requested duration.
- "explain" → thorough explanation in ANY language the user requests (Arabic, French, Spanish, Hindi, etc). Write as much or as little as asked.
- "tts" → speak text aloud with a Gemini AI voice. Use this when user says "read aloud", "speak", "listen", "voice".
- "video" → generate a Veo AI tutorial video. Create a detailed cinematic prompt.
- "image" → generate an AI illustration with Imagen.
- "none" → conversational reply only (use when user is asking a question, not requesting content creation).

INTENT SIGNALS:
flashcards → "flashcards", "flash cards", "cards", "memorize", "study cards"
quiz → "quiz", "test me", "questions", "multiple choice", "exam"
broadcast → "broadcast", "podcast", "talk show", "radio show", "episode", "host"
explain → "explain", "teach me", "what is", "describe", "in [language]", "tell me about"
tts → "read", "speak", "voice", "listen", "audio", "read aloud", "say this"
video → "video", "tutorial video", "make a video", "veo"
image → "illustrate", "draw", "image", "picture", "generate", "visualize", "diagram"

RESPONSE FORMAT — return ONLY valid JSON (no markdown fences, no extra text):
{
  "reply": "Short friendly confirmation of what you are creating (1-2 sentences max).",
  "action": "none|flashcards|quiz|broadcast|explain|tts|video|image",
  "payload": { ... }
}

PAYLOAD SCHEMAS — follow these exactly:

flashcards:
{ "topic": "Topic name", "cards": [{ "front": "question or term", "back": "answer or definition" }] }
→ Generate EXACTLY the number of cards requested. No default limit. Comprehensive coverage.

quiz:
{ "topic": "Topic name", "questions": [{ "q": "Question?", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "answer": "A) ...", "explanation": "Why this is correct." }] }
→ Generate EXACTLY the number of questions requested. No limit.

broadcast:
{ "title": "Episode title", "lines": [{ "speaker": "ZEPHYR|KORE|FENRIR", "text": "What they say" }] }
→ 1 min ≈ 8 exchanges, 3 min ≈ 20, 5 min ≈ 30, 10 min ≈ 55. Scale to user's request.

explain:
{ "language": "English|Arabic|French|Spanish|...", "title": "Topic", "text": "Full explanation — as long as the user requests. Write in the requested language throughout.", "voice": "Zephyr" }
→ Use EXACTLY the language the user requests. Write the ENTIRE explanation in that language.

tts:
{ "text": "The text to speak. Can be any length.", "voice": "Zephyr|Kore|Puck|Fenrir|Aoede|Charon" }

video:
{ "title": "Video title", "prompt": "Detailed cinematic Veo prompt describing visuals, narration, camera angles, lighting. Be specific.", "durationSeconds": 8 }

image:
{ "title": "Image title", "imagePrompt": "Detailed Imagen prompt. Educational illustration of [topic]. Clean, labeled diagram style. Bright, modern colors." }`;

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
  for (const ttsModel of [M.tts, M.ttsFallback]) {
  try {
    const res = await fetch(
      `${BASE}${ttsModel}:generateContent?key=${GEMINI_KEY}`,
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
    if (!part?.data) throw new Error('no audio data');
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
    await new Promise((resolve) => {
      const done = () => { URL.revokeObjectURL(audioURL); resolve(); };
      audio.onended  = done;
      audio.onerror  = done;
      // safety timeout: 150ms per char + 4s buffer
      const t = setTimeout(done, text.length * 150 + 4000);
      audio.play().catch(() => { clearTimeout(t); done(); });
    });
    return; // success — exit the model loop
  } catch (e) { /* try next model */ }
  } // end model loop
  await speakFallback(text);
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

// ── Image generation ──────────────────────────────────────────────────────────
// Strategy A: Imagen 4 via predict endpoint (correct endpoint for generation)
// Strategy B: Gemini generateContent with responseModalities fallback
async function renderImage(p) {
  const card = makeContentCard(`🖼️ ${p.title || 'Illustration'}`);
  const body = card.querySelector('.content-card-body');
  const statusEl = el('div','video-status'); statusEl.textContent = '🎨 Generating illustration…';
  body.appendChild(statusEl);
  appendCard(card);

  const prompt = p.imagePrompt || `Educational illustration, clean labeled diagram: ${p.title}`;

  // ── Strategy A: Imagen 4 predict endpoint ───────────────────────────────────
  for (const model of ['imagen-4.0-generate-001', 'imagen-4.0-fast-generate-001']) {
    try {
      statusEl.textContent = `🎨 Generating with ${model}…`;
      const res = await fetch(`${BASE}${model}:predict?key=${GEMINI_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { sampleCount: 1, aspectRatio: '1:1' }
        })
      });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e?.error?.message || `HTTP ${res.status}`); }
      const d = await res.json();
      const pred = d?.predictions?.[0];
      const b64  = pred?.bytesBase64Encoded;
      const mime = pred?.mimeType || 'image/png';
      if (!b64) throw new Error('No image data');
      statusEl.remove();
      const imgEl = document.createElement('img');
      imgEl.src = `data:${mime};base64,${b64}`;
      imgEl.className = 'gen-image'; imgEl.alt = p.title || '';
      body.appendChild(imgEl);
      return;
    } catch (err) { /* try next */ }
  }

  // ── Strategy B: Gemini generateContent + responseModalities ────────────────
  for (const model of ['gemini-2.0-flash', M.chat]) {
    try {
      statusEl.textContent = `🎨 Generating with ${model}…`;
      const res = await fetch(`${BASE}${model}:generateContent?key=${GEMINI_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
        })
      });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e?.error?.message || `HTTP ${res.status}`); }
      const d = await res.json();
      const imgPart = d?.candidates?.[0]?.content?.parts?.find(pt => pt.inline_data?.mime_type?.startsWith('image/'));
      if (!imgPart?.data) throw new Error('no image part');
      statusEl.remove();
      const imgEl = document.createElement('img');
      imgEl.src = `data:${imgPart.inline_data.mime_type};base64,${imgPart.inline_data.data}`;
      imgEl.className = 'gen-image'; imgEl.alt = p.title || '';
      body.appendChild(imgEl);
      return;
    } catch (err) { /* try next */ }
  }

  statusEl.textContent = '⚠ Image generation not available with your current API key tier. Try generating a video or broadcast instead.';
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
