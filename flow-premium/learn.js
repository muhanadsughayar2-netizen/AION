/* learn.js — SnapToAI Native Study Portal
   MV3 compliant: no inline handlers, all listeners via addEventListener
   API key read from chrome.storage.sync.geminiApiKey */

'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let GEMINI_KEY = '';
let COURSE = null;
let currentLessonIdx = 0;
let currentTab = 'learn';
let currentCardIdx = 0;
let quizAnswered = {};
let completedLessons = new Set();
let tutorOpen = false;
let tutorContext = '';

const GEMINI_URL = key =>
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadApiKey();
  bindUploadHandlers();
  bindStudyHandlers();
  bindTutorHandlers();
});

function loadApiKey() {
  chrome.storage.sync.get(['geminiApiKey'], res => {
    GEMINI_KEY = res.geminiApiKey || '';
    const keyStatus = document.getElementById('keyStatus');
    const noKeyWarning = document.getElementById('noKeyWarning');
    if (GEMINI_KEY) {
      keyStatus.textContent = '🔑 Key ready';
      keyStatus.style.background = 'rgba(16,185,129,0.15)';
      keyStatus.style.color = '#6EE7B7';
      keyStatus.style.borderColor = 'rgba(16,185,129,0.35)';
      noKeyWarning.style.display = 'none';
    } else {
      keyStatus.textContent = '⚠️ No key';
      noKeyWarning.style.display = '';
    }
  });
}

// ── Upload ────────────────────────────────────────────────────────────────────
function bindUploadHandlers() {
  const uploadBtn = document.getElementById('uploadBtn');
  const fileInput = document.getElementById('fileInput');
  const uploadBox = document.getElementById('uploadBox');

  uploadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) startProcessing(e.target.files[0]);
  });

  uploadBox.addEventListener('dragover', e => {
    e.preventDefault();
    uploadBox.classList.add('drag-over');
  });
  uploadBox.addEventListener('dragleave', () => uploadBox.classList.remove('drag-over'));
  uploadBox.addEventListener('drop', e => {
    e.preventDefault();
    uploadBox.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (file) startProcessing(file);
  });

  document.getElementById('newStudyBtn').addEventListener('click', resetToUpload);
}

async function startProcessing(file) {
  if (!GEMINI_KEY) { alert('No Gemini API key found. Open SnapToAI and save your key first.'); return; }

  const allowed = ['application/pdf','image/png','image/jpeg','image/webp','image/gif','text/plain','text/markdown'];
  const mime = file.type || 'text/plain';
  if (!allowed.includes(mime) && !file.name.endsWith('.md')) {
    alert('Please upload a PDF, image (PNG/JPG/WEBP), or text/markdown file.');
    return;
  }

  showScreen('processing');
  document.getElementById('processingFile').textContent = file.name;

  try {
    const base64 = await fileToBase64(file);
    const course = await generateCourse(base64, mime, file.name);
    COURSE = course;
    renderCourse();
    showScreen('study');
  } catch (err) {
    showScreen('upload');
    alert('Could not generate course: ' + (err.message || err));
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const b64 = result.split(',')[1];
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Gemini — Course Extraction ────────────────────────────────────────────────
async function generateCourse(base64, mimeType, fileName) {
  const isText = mimeType.startsWith('text/') || fileName.endsWith('.md');

  const systemPrompt = `You are an expert curriculum designer. Analyse the provided study material and extract it into a structured course JSON.

Return ONLY valid JSON that matches this schema exactly:
{
  "title": "Short course title (max 8 words)",
  "lessons": [
    {
      "id": "lesson-1",
      "title": "Lesson title",
      "summary": "One-sentence summary of this lesson",
      "concepts": [
        { "emoji": "🔬", "term": "Term or concept", "definition": "Clear, concise definition (2-3 sentences)" }
      ],
      "examples": [
        { "title": "Example title", "body": "Concrete real-world example with explanation" }
      ],
      "flashcards": [
        { "front": "Question or term", "back": "Answer or definition" }
      ],
      "quiz": [
        { "q": "Question?", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "answer": "A) ...", "explanation": "Why this answer is correct" }
      ]
    }
  ]
}

Rules:
- Create 2-5 lessons based on the material (more for longer content)
- Each lesson: 3-8 concepts, 2-4 examples, 5-10 flashcards, 5-8 quiz questions
- Quiz answers must exactly match one of the 4 options
- Use emojis that visually represent each concept
- Return only JSON, no markdown fences or extra text`;

  let parts;
  if (isText) {
    const textContent = atob(base64);
    parts = [
      { text: systemPrompt },
      { text: 'Study material:\n\n' + textContent }
    ];
  } else {
    parts = [
      { text: systemPrompt },
      { inline_data: { mime_type: mimeType, data: base64 } }
    ];
  }

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json'
    }
  };

  const res = await fetch(GEMINI_URL(GEMINI_KEY), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const cleaned = raw.replace(/^```json\s*/,'').replace(/\s*```$/,'').trim();
  return JSON.parse(cleaned);
}

// ── Render Course ─────────────────────────────────────────────────────────────
function renderCourse() {
  document.getElementById('courseTitle').textContent = COURSE.title || 'My Course';
  document.getElementById('newStudyBtn').style.display = '';

  const list = document.getElementById('lessonList');
  list.innerHTML = '';
  COURSE.lessons.forEach((lesson, i) => {
    const item = document.createElement('div');
    item.className = 'lesson-item' + (i === 0 ? ' active' : '');
    item.dataset.idx = i;
    item.innerHTML = `<span>${i + 1}.</span><span style="flex:1">${lesson.title}</span><span class="lesson-status" id="ls-${i}"></span>`;
    item.addEventListener('click', () => selectLesson(i));
    list.appendChild(item);
  });

  selectLesson(0);
  updateProgress();
}

function selectLesson(idx) {
  currentLessonIdx = idx;
  currentTab = 'learn';
  currentCardIdx = 0;
  quizAnswered = {};

  document.querySelectorAll('.lesson-item').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });

  const lesson = COURSE.lessons[idx];
  document.getElementById('lessonTitle').textContent = lesson.title;
  document.getElementById('lessonSummary').textContent = lesson.summary || '';

  document.querySelectorAll('.tab-pill').forEach(p => p.classList.toggle('active', p.dataset.tab === 'learn'));

  tutorContext = `Current lesson: "${lesson.title}". Summary: ${lesson.summary}. Key concepts: ${lesson.concepts.map(c => c.term).join(', ')}.`;
  renderTab('learn');
}

function renderTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-pill').forEach(p => p.classList.toggle('active', p.dataset.tab === tab));
  const lesson = COURSE.lessons[currentLessonIdx];
  const area = document.getElementById('tabContent');
  area.innerHTML = '';

  if (tab === 'learn') renderLearnTab(lesson, area);
  else if (tab === 'flashcards') renderFlashcardsTab(lesson, area);
  else if (tab === 'quiz') renderQuizTab(lesson, area);
}

// Learn tab
function renderLearnTab(lesson, area) {
  const conceptsDiv = document.createElement('div');
  conceptsDiv.innerHTML = `<h3 style="font-size:15px;font-weight:700;color:#0F172A;margin-bottom:14px">📌 Key Concepts</h3>`;
  (lesson.concepts || []).forEach(c => {
    const card = document.createElement('div');
    card.className = 'concept-card';
    card.innerHTML = `
      <div class="concept-emoji">${c.emoji || '💡'}</div>
      <div class="concept-body">
        <div class="concept-term">${escHtml(c.term)}</div>
        <div class="concept-def">${escHtml(c.definition)}</div>
      </div>
      <button class="speak-btn" data-text="${escAttr(c.term + '. ' + c.definition)}" title="Read aloud">🔊</button>`;
    card.querySelector('.speak-btn').addEventListener('click', e => {
      speakText(e.currentTarget.dataset.text);
    });
    conceptsDiv.appendChild(card);
  });
  area.appendChild(conceptsDiv);

  if (lesson.examples?.length) {
    const exDiv = document.createElement('div');
    exDiv.style.marginTop = '20px';
    exDiv.innerHTML = `<h3 style="font-size:15px;font-weight:700;color:#0F172A;margin-bottom:14px">🧩 Examples</h3>`;
    lesson.examples.forEach(ex => {
      const card = document.createElement('div');
      card.className = 'example-card';
      card.innerHTML = `<div class="example-title">${escHtml(ex.title)}</div><div class="example-body">${escHtml(ex.body)}</div>`;
      exDiv.appendChild(card);
    });
    area.appendChild(exDiv);
  }

  markLessonDone(currentLessonIdx);
}

// Flashcards tab
function renderFlashcardsTab(lesson, area) {
  const cards = lesson.flashcards || [];
  if (!cards.length) { area.innerHTML = '<p style="color:#94A3B8;text-align:center;margin-top:40px">No flashcards for this lesson.</p>'; return; }

  const wrapper = document.createElement('div');
  wrapper.id = 'flashcardArea';

  const flipCard = document.createElement('div');
  flipCard.className = 'flip-card';
  flipCard.innerHTML = `<div class="flip-inner"><div class="flip-face flip-front" id="cardFront">${escHtml(cards[0].front)}</div><div class="flip-face flip-back" id="cardBack">${escHtml(cards[0].back)}</div></div>`;
  flipCard.addEventListener('click', () => flipCard.classList.toggle('flipped'));
  wrapper.appendChild(flipCard);

  const counter = document.createElement('div');
  counter.id = 'cardCounter';
  counter.style.cssText = 'font-size:13px;color:#94A3B8';
  counter.textContent = `1 / ${cards.length}`;
  wrapper.appendChild(counter);

  const nav = document.createElement('div');
  nav.id = 'cardNav';
  const prevBtn = document.createElement('button'); prevBtn.textContent = '← Prev';
  const nextBtn = document.createElement('button'); nextBtn.textContent = 'Next →';

  prevBtn.addEventListener('click', () => {
    if (currentCardIdx > 0) { currentCardIdx--; updateCard(); }
  });
  nextBtn.addEventListener('click', () => {
    if (currentCardIdx < cards.length - 1) { currentCardIdx++; updateCard(); }
  });
  nav.appendChild(prevBtn);
  nav.appendChild(counter);
  nav.appendChild(nextBtn);
  wrapper.appendChild(nav);

  function updateCard() {
    flipCard.classList.remove('flipped');
    setTimeout(() => {
      document.getElementById('cardFront').textContent = cards[currentCardIdx].front;
      document.getElementById('cardBack').textContent = cards[currentCardIdx].back;
      counter.textContent = `${currentCardIdx + 1} / ${cards.length}`;
    }, 150);
  }

  const hint = document.createElement('p');
  hint.style.cssText = 'font-size:12px;color:#94A3B8';
  hint.textContent = 'Click card to flip';
  wrapper.appendChild(hint);

  area.appendChild(wrapper);
}

// Quiz tab
function renderQuizTab(lesson, area) {
  const questions = lesson.quiz || [];
  if (!questions.length) { area.innerHTML = '<p style="color:#94A3B8;text-align:center;margin-top:40px">No quiz for this lesson.</p>'; return; }

  questions.forEach((q, qi) => {
    const card = document.createElement('div');
    card.className = 'quiz-question';
    card.innerHTML = `<div class="quiz-q">${qi + 1}. ${escHtml(q.q)}</div><div class="quiz-options"></div><div class="quiz-explanation" id="qexpl-${qi}">${escHtml(q.explanation || '')}</div>`;

    const optionsDiv = card.querySelector('.quiz-options');
    q.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'quiz-opt';
      btn.textContent = opt;
      btn.addEventListener('click', () => {
        if (quizAnswered[qi]) return;
        quizAnswered[qi] = opt;
        const isCorrect = opt === q.answer;
        btn.classList.add(isCorrect ? 'correct' : 'wrong');
        if (!isCorrect) {
          optionsDiv.querySelectorAll('.quiz-opt').forEach(b => {
            if (b.textContent === q.answer) b.classList.add('correct');
          });
          openTutor();
          appendTutorMessage('student', `I got question ${qi + 1} wrong. The question was: "${q.q}" I chose: "${opt}"`);
          askTutor(`I answered question "${q.q}" with "${opt}" but the correct answer is "${q.answer}". Help me understand.`);
        }
        optionsDiv.querySelectorAll('.quiz-opt').forEach(b => b.disabled = true);
        document.getElementById(`qexpl-${qi}`).style.display = '';
        checkQuizComplete(questions.length);
      });
      optionsDiv.appendChild(btn);
    });
    area.appendChild(card);
  });

  const scoreEl = document.createElement('div');
  scoreEl.id = 'quizScore';
  scoreEl.innerHTML = `<div style="font-size:28px">🎉</div><div style="font-size:18px;font-weight:700;color:#0F172A;margin:8px 0" id="scoreText"></div><div style="font-size:13px;color:#64748B">Complete!</div>`;
  area.appendChild(scoreEl);
}

function checkQuizComplete(total) {
  if (Object.keys(quizAnswered).length < total) return;
  const correct = Object.entries(quizAnswered).filter(([qi, ans]) => ans === COURSE.lessons[currentLessonIdx].quiz[qi].answer).length;
  const scoreEl = document.getElementById('quizScore');
  if (scoreEl) {
    scoreEl.style.display = '';
    document.getElementById('scoreText').textContent = `${correct} / ${total} correct`;
  }
  markLessonDone(currentLessonIdx);
}

// ── Progress ───────────────────────────────────────────────────────────────────
function markLessonDone(idx) {
  completedLessons.add(idx);
  updateProgress();
}

function updateProgress() {
  if (!COURSE) return;
  const total = COURSE.lessons.length;
  const done = completedLessons.size;
  document.getElementById('progressLabel').textContent = `${done} / ${total} lessons done`;
  document.getElementById('progressFill').style.width = `${(done / total) * 100}%`;
  COURSE.lessons.forEach((_, i) => {
    const statusEl = document.getElementById(`ls-${i}`);
    if (statusEl) statusEl.textContent = completedLessons.has(i) ? '✓' : '';
  });
}

// ── Tutor ─────────────────────────────────────────────────────────────────────
function bindStudyHandlers() {
  document.querySelectorAll('.tab-pill').forEach(pill => {
    pill.addEventListener('click', () => renderTab(pill.dataset.tab));
  });
  document.getElementById('askTutorBtn').addEventListener('click', openTutor);
}

function bindTutorHandlers() {
  document.getElementById('closeTutorBtn').addEventListener('click', closeTutor);
  document.getElementById('tutorSendBtn').addEventListener('click', sendTutorMessage);
  document.getElementById('tutorInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTutorMessage(); }
  });
}

function openTutor() {
  tutorOpen = true;
  document.getElementById('tutorPanel').classList.add('open');
}

function closeTutor() {
  tutorOpen = false;
  document.getElementById('tutorPanel').classList.remove('open');
}

function sendTutorMessage() {
  const input = document.getElementById('tutorInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  appendTutorMessage('student', msg);
  askTutor(msg);
}

function appendTutorMessage(type, text) {
  const msgs = document.getElementById('tutorMessages');
  const el = document.createElement('div');
  if (type === 'student') {
    el.className = 'tutor-msg-student';
    el.textContent = text;
  } else if (type === 'thinking') {
    el.className = 'tutor-msg-thinking';
    el.id = 'tutorThinking';
    el.textContent = '✦ Thinking…';
  } else if (type === 'error') {
    el.className = 'tutor-msg-error';
    el.textContent = '⚠ ' + text;
  } else if (type === 'response') {
    el.className = 'tutor-response-card';
    if (text.feedback) {
      const fb = document.createElement('div');
      fb.className = 'tutor-feedback';
      fb.textContent = text.feedback;
      el.appendChild(fb);
    }
    if (text.explanation) {
      const exp = document.createElement('div');
      exp.className = 'tutor-explanation';
      exp.textContent = '💡 ' + text.explanation;
      el.appendChild(exp);
    }
    if (text.socratic_question) {
      const sq = document.createElement('div');
      sq.className = 'tutor-question';
      sq.innerHTML = `<span>🤔</span><span>${escHtml(text.socratic_question)}</span>`;
      el.appendChild(sq);
    }
  }
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
  return el;
}

async function askTutor(userMessage) {
  if (!GEMINI_KEY) { appendTutorMessage('error', 'No API key. Save your key in SnapToAI first.'); return; }

  openTutor();
  appendTutorMessage('thinking', '');

  const systemInstruction = `You are a warm, encouraging Socratic AI tutor. Your role is to guide students to understanding through questions, never just giving answers.

Context about what the student is currently studying:
${tutorContext}

You MUST respond with valid JSON matching exactly:
{
  "feedback": "Brief, warm acknowledgment (1-2 sentences). Praise effort, not just correctness.",
  "explanation": "Clear explanation of the concept (2-4 sentences). Use an analogy if helpful.",
  "socratic_question": "One open-ended Socratic question that leads the student to think deeper. Do NOT answer it — let them think."
}`;

  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 512,
      responseMimeType: 'application/json'
    }
  };

  try {
    const res = await fetch(GEMINI_URL(GEMINI_KEY), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    document.getElementById('tutorThinking')?.remove();

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `API ${res.status}`);
    }

    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const cleaned = raw.replace(/^```json\s*/,'').replace(/\s*```$/,'').trim();
    const parsed = JSON.parse(cleaned);
    appendTutorMessage('response', parsed);
  } catch (err) {
    document.getElementById('tutorThinking')?.remove();
    appendTutorMessage('error', err.message);
  }
}

// ── TTS ───────────────────────────────────────────────────────────────────────
function speakText(text) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function showScreen(which) {
  document.getElementById('uploadScreen').style.display = which === 'upload' ? '' : 'none';
  document.getElementById('processingScreen').style.display = which === 'processing' ? 'flex' : 'none';
  document.getElementById('studyScreen').style.display = which === 'study' ? 'flex' : 'none';
}

function resetToUpload() {
  COURSE = null;
  completedLessons.clear();
  quizAnswered = {};
  currentLessonIdx = 0;
  document.getElementById('newStudyBtn').style.display = 'none';
  document.getElementById('fileInput').value = '';
  showScreen('upload');
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(str) {
  return String(str).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
