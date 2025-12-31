// AI Chat Window Script
// Handles AI chat in a standalone window

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
    console.error('[SnapToAI] IndexedDB load failed:', e);
    return [];
  }
}

// === PREMIUM MULTI-LANGUAGE TTS ===
let synth = window.speechSynthesis;
let voices = [];
let voicesReady = false;

function loadVoices() {
  voices = synth.getVoices();
  if (voices.length > 0) voicesReady = true;
}
loadVoices();
if (speechSynthesis.onvoiceschanged !== undefined) {
  speechSynthesis.onvoiceschanged = loadVoices;
}

function speakText(text) {
  if (!('speechSynthesis' in window)) {
    showToast('Text-to-speech not supported');
    return;
  }
  const cleanText = text.replace(/📋|🔊|💾/g, '');
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.rate = 0.95;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

let currentImages = [];
let currentPageText = '';
let conversationHistory = [];

const SYSTEM_PROMPT = "You are a thorough, exhaustive AI assistant. Your goal is to provide the COMPLETE answer in a single response. Never stop mid-thought. Never ask the user if they want more—just give it all now. If the answer is long, structure it with headers. Be warm, friendly and thorough. Use **bold text** for emphasis and bullet lists for clarity. Format responses with markdown. End with a helpful follow-up question.";

// === FINAL MAGIC CARD RENDERER ===
function renderMagicCard(rawResponse, btn, batchLabel = '', imageCount = 1) {
  const thread = document.getElementById('chatThread');

  // 1. Safe JSON Parsing
  let data = {
    title: "Deep Analysis",
    tone: "blue",
    score: 75,
    highlight: "Insights generated",
    sections: [{ label: "Key Insights", items: ["Analysis complete"] }],
    actions: [],
    verdict: "Review and act",
    nextStep: "Apply insights",
    risk: "MEDIUM"
  };

  try {
    const cleaned = rawResponse
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      data = { ...data, ...parsed };
    }
  } catch (e) {
    console.log('[SnapToAI] Safe fallback — JSON parse failed');
  }

  // 2. XP + Daily Cap + Streak
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  let stats = JSON.parse(
    localStorage.getItem('snaptoai_progress') ||
    '{"xp":0,"level":1,"streak":0,"lastDate":"","todayXp":0}'
  );

  if (stats.lastDate !== today) stats.todayXp = 0;

  const DAILY_XP_CAP = 600;
  const remainingToday = DAILY_XP_CAP - stats.todayXp;
  const xpGainRaw = Math.max(30, Math.round((data.score || 75) * 0.7));
  const xpGain = Math.max(0, Math.min(xpGainRaw, remainingToday));

  stats.xp += xpGain;
  stats.todayXp += xpGain;
  stats.level = Math.floor(stats.xp / 400) + 1;

  if (stats.lastDate === yesterday) {
    stats.streak += 1;
  } else if (stats.lastDate !== today) {
    stats.streak = 1;
  }

  stats.lastDate = today;
  localStorage.setItem('snaptoai_progress', JSON.stringify(stats));

  // 3. Rarity
  const rarity = data.score >= 90 ? { name: 'LEGENDARY', color: '#fbbf24', emoji: '👑', sparkles: 12 }
               : data.score >= 80 ? { name: 'EPIC', color: '#a855f7', emoji: '💎', sparkles: 8 }
               : data.score >= 70 ? { name: 'RARE', color: '#3b82f6', emoji: '🔥', sparkles: 5 }
               : { name: 'COMMON', color: '#9ca3af', emoji: '⚪', sparkles: 0 };

  // 4. Tone
  const toneColor = {
    gold: '#fbbf24', green: '#34d399', red: '#f87171',
    blue: '#60a5fa', purple: '#c084fc'
  }[data.tone?.toLowerCase()] || '#60a5fa';

  // 5. Build Card
  const card = document.createElement('div');
  card.className = 'magic-card-final';
  card.style.setProperty('--glow', toneColor);
  card.style.setProperty('--rarity-glow', rarity.color);

  let sparkles = '';
  for (let i = 0; i < rarity.sparkles; i++) {
    const left = 10 + Math.random() * 80;
    const delay = Math.random() * 2;
    sparkles += `<div class="sparkle" style="left:${left}%;animation-delay:${delay}s;"></div>`;
  }

  const nextHooks = ['Reveal the hidden risk factor','See why this scored higher than average','Uncover the blind spot you missed','Compare to top 10% results','Unlock counter-analysis'];
  const nextText = data.nextStep || nextHooks[Math.floor(Math.random() * nextHooks.length)];

  card.innerHTML = `
    <div class="sparkles">${sparkles}</div>
    <div class="header">
      <div class="emoji">${btn.emoji}</div>
      <h2 class="title">${data.title}</h2>
      ${imageCount > 1 ? `<div class="badge">${imageCount} screenshots${batchLabel ? ' • ' + batchLabel : ''}</div>` : ''}
    </div>
    <div class="rarity" style="color:${rarity.color}">${rarity.emoji} ${rarity.name} Insight</div>
    <div class="score-ring">
      <div class="ring-fill"></div>
      <div class="score-value">${data.score || '??'}</div>
      <div class="score-max">/100</div>
    </div>
    <div class="highlight"><strong>Key Insight:</strong> ${data.highlight}</div>
    ${(data.sections || []).map(s => `
      <div class="section">
        <h3 class="label">${s.label}</h3>
        <ul class="list">
          ${(s.items || []).map(i => {
            const clean = i.replace(/\[.*?\]/g, '').trim();
            const pri = /CRITICAL|URGENT|HIGH|IMPORTANT/i.test(i) ? 'high' : '';
            return `<li class="item ${pri}">${clean}</li>`;
          }).join('')}
        </ul>
      </div>
    `).join('')}
    <div class="verdict">
      <div class="label">FINAL VERDICT</div>
      <div class="text">${data.verdict}</div>
      <div class="risk ${data.risk?.toLowerCase() || 'medium'}">${data.risk || 'MEDIUM'} RISK</div>
    </div>
    <div class="next">Next → ${nextText}</div>
    <div class="progress">
      <div class="bar"><div class="fill" style="width:${((stats.xp % 400) / 400) * 100}%"></div></div>
      <div class="stats">Level ${stats.level} • +${xpGain} XP • 🔥 ${stats.streak}-day streak</div>
    </div>
    <div class="buttons">
      <button class="btn copy">📋 Copy</button>
      <button class="btn speak">🔊 Read</button>
      <button class="btn save">💾 Save</button>
    </div>
  `;

  thread.appendChild(card);
  setTimeout(() => card.classList.add('show'), 50);
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });

  requestAnimationFrame(() => {
    const ringFill = card.querySelector('.ring-fill');
    if (ringFill) ringFill.style.background = `conic-gradient(${toneColor} ${data.score || 75}%, transparent 0)`;
  });

  card.querySelector('.copy').onclick = () => {
    navigator.clipboard.writeText(card.innerText.replace(/📋|🔊|💾/g, ''));
    showToast('Copied!');
  };
  card.querySelector('.speak').onclick = () => speakText(card.innerText);
  card.querySelector('.save').onclick = () => {
    const saved = JSON.parse(localStorage.getItem('snaptoai_saved') || '[]');
    saved.unshift({ date: new Date().toISOString(), title: data.title, score: data.score, verdict: data.verdict });
    localStorage.setItem('snaptoai_saved', JSON.stringify(saved.slice(0, 100)));
    showToast('Saved!');
  };
}

async function initializeChat() {
  const result = await chrome.storage.session.get(['pageText', 'useIndexedDB', 'selectedSnaps', 'selectedSnap']);
  currentPageText = result.pageText || '';
  let images = result.useIndexedDB ? await loadImagesFromIndexedDB() : (result.selectedSnaps || []);
  if (images.length === 0 && result.selectedSnap) images = [result.selectedSnap];
  
  if (images.length > 0) {
    currentImages = images;
    document.getElementById('previewImage').src = images[0];
  }
  
  const keyRes = await chrome.storage.local.get(['magicButtons']);
  const btns = keyRes.magicButtons || [];
  const container = document.getElementById('magicButtons');
  container.innerHTML = btns.map((b, i) => `<button class="magic-btn" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:8px 12px;color:#fff;font-size:12px;cursor:pointer;margin:4px" onclick="runMagic(${i})">${b.emoji} ${b.name}</button>`).join('');
}

window.runMagic = async (index) => {
  const keyRes = await chrome.storage.local.get(['magicButtons', 'geminiApiKey']);
  const btn = keyRes.magicButtons[index];
  const apiKey = keyRes.geminiApiKey;
  if (!apiKey) return showToast('Set API Key in Settings');

  const thread = document.getElementById('chatThread');
  const loader = document.createElement('div');
  loader.className = 'chat-bubble ai';
  loader.innerHTML = '✨ Analyzing...';
  thread.appendChild(loader);

  try {
    const parts = [{ text: `Output ONLY valid JSON for: ${btn.prompt}` }];
    currentImages.forEach(img => parts.push({ inlineData: { mimeType: 'image/png', data: img.split(',')[1] } }));

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 4096 } })
    });
    const data = await res.json();
    loader.remove();
    renderMagicCard(data.candidates[0].content.parts[0].text, btn, '', currentImages.length);
  } catch (e) {
    loader.textContent = 'Failed: ' + e.message;
  }
};

document.getElementById('sendBtn').onclick = async () => {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  const thread = document.getElementById('chatThread');
  const userB = document.createElement('div');
  userB.className = 'chat-bubble user';
  userB.textContent = text;
  thread.appendChild(userB);
  // Simple chat logic omitted for brevity, focusing on Magic Cards
};

initializeChat();
