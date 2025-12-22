// AI Chat Window Script
// Handles AI chat in a standalone window

let currentImage = null;
let currentPageText = '';
let conversationHistory = [];
let lastRequestTime = 0;
const THROTTLE_MS = 3000;

const SYSTEM_PROMPT = "You are Gemini, a helpful AI assistant. Be warm, friendly and thorough. Use **bold text** for emphasis and bullet lists for clarity. Format responses with markdown. ALWAYS end with a helpful follow-up question to keep the conversation going.";

const TUTOR_PROMPT = "You are a Socratic Tutor. Do NOT give the answer directly. Instead, analyze what the student is asking and respond with a SHORT guiding question or hint that helps them discover the answer themselves. Be encouraging but brief. Use **bold** for key concepts. End with a thought-provoking question.";

const SMART_SYSTEM_PROMPT = "I am providing you with the raw text of a webpage for accuracy, and the screenshot of that page for visual context (charts, layout, images). Please use the text for your primary analysis and the images to confirm visual details. Be warm, friendly and thorough. Use **bold text** for emphasis and bullet lists for clarity. Format responses with markdown. ALWAYS end with a helpful follow-up question.";

const SMART_TUTOR_PROMPT = "I am providing you with the raw text of a webpage and a screenshot for context. You are a Socratic Tutor - do NOT give answers directly. Ask guiding questions that help the student discover the answer themselves. Be encouraging but brief. End with a thought-provoking question.";

let lastAiResponse = '';

// Get image from URL params or storage
async function initializeChat() {
  const urlParams = new URLSearchParams(window.location.search);
  const imageIndex = urlParams.get('imageIndex');
  
  if (imageIndex !== null) {
    // Get image and page text from session storage
    // Try selectedSnap first (quota-friendly), fallback to full snaps array
    const result = await chrome.storage.session.get(['selectedSnap', 'snaps', 'pageText']);
    currentPageText = result.pageText || '';
    const index = parseInt(imageIndex);
    
    if (currentPageText) {
      console.log('[AI Chat] Got page text:', currentPageText.length, 'chars');
    }
    
    // Use selectedSnap if available, otherwise find in snaps array
    let imageToUse = result.selectedSnap;
    if (!imageToUse && result.snaps && result.snaps[index]) {
      imageToUse = result.snaps[index];
    }
    
    if (imageToUse) {
      currentImage = imageToUse;
      document.getElementById('previewImage').src = currentImage;
    } else {
      // Show error if image not found
      document.querySelector('.image-preview').innerHTML = '<div style="color: #ff5252; padding: 20px; text-align: center;">Image not found. Please try again.</div>';
      addBubble('Could not load image. Please close and try again.', 'error');
    }
  } else {
    document.querySelector('.image-preview').innerHTML = '<div style="color: #888; padding: 20px; text-align: center;">No image selected</div>';
  }
  
  // Focus input
  document.getElementById('chatInput').focus();
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

// Send message to Gemini API
async function sendToGemini(prompt, imageDataUrl) {
  // Throttle check
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < THROTTLE_MS) {
    const waitTime = Math.ceil((THROTTLE_MS - timeSinceLastRequest) / 1000);
    throw new Error(`Please wait ${waitTime}s (free tier limit)`);
  }
  
  // Get API key from sync storage (same as popup.js)
  const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
  const apiKey = keyResult.geminiApiKey;
  
  if (!apiKey) {
    throw new Error('Please set your Gemini API key in Settings');
  }
  
  lastRequestTime = Date.now();
  
  // Use original high-quality image (no compression)
  const base64Data = imageDataUrl.split(',')[1];
  
  // Build conversation
  const contents = [];
  
  // Add conversation history
  for (const msg of conversationHistory) {
    contents.push({
      role: msg.role,
      parts: [{ text: msg.text }]
    });
  }
  
  // Add current message with image
  const userParts = [];
  if (contents.length === 0) {
    const mimeType = imageDataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
    userParts.push({
      inlineData: {
        mimeType: mimeType,
        data: base64Data
      }
    });
  }
  userParts.push({ text: prompt });
  contents.push({ role: 'user', parts: userParts });
  
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: SYSTEM_PROMPT
          }]
        },
        contents: contents,
        generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0.3
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
  
  // Update conversation history
  conversationHistory.push({ role: 'user', text: prompt });
  conversationHistory.push({ role: 'model', text: text });
  
  return text;
}

// Handle send with streaming
async function handleSend() {
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const thread = document.getElementById('chatThread');
  const prompt = input.value.trim();
  
  if (!prompt || !currentImage) return;
  
  input.value = '';
  sendBtn.disabled = true;
  
  // Add user message
  addBubble(prompt, 'user');
  addThinkingBubble();
  
  try {
    // Throttle check
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < THROTTLE_MS) {
      const waitTime = Math.ceil((THROTTLE_MS - timeSinceLastRequest) / 1000);
      throw new Error(`Please wait ${waitTime}s (free tier limit)`);
    }
    
    // Get API key
    const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
    const apiKey = keyResult.geminiApiKey;
    if (!apiKey) throw new Error('Please set your Gemini API key in Settings');
    
    lastRequestTime = Date.now();
    
    // Use original high-quality image (no compression)
    const base64Data = currentImage.split(',')[1];
    
    // Build request
    const contents = [];
    for (const msg of conversationHistory) {
      contents.push({ role: msg.role, parts: [{ text: msg.text }] });
    }
    
    const userParts = [];
    if (contents.length === 0) {
      // First message: include image
      const mimeType = currentImage.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      userParts.push({ inlineData: { mimeType: mimeType, data: base64Data } });
      // If we have page text, include it for smarter analysis
      if (currentPageText && currentPageText.length > 800) {
        userParts.push({ text: `[PAGE TEXT FOR CONTEXT]:\n${currentPageText}\n\n[USER QUESTION]: ${prompt}` });
      } else {
        userParts.push({ text: prompt });
      }
    } else {
      userParts.push({ text: prompt });
    }
    contents.push({ role: 'user', parts: userParts });
    
    // Use smart prompt if we have page text, and tutor prompt if tutor mode is on
    const isTutor = document.getElementById('tutorToggle')?.checked || false;
    let systemPrompt;
    if (currentPageText && currentPageText.length > 800) {
      systemPrompt = isTutor ? SMART_TUTOR_PROMPT : SMART_SYSTEM_PROMPT;
    } else {
      systemPrompt = isTutor ? TUTOR_PROMPT : SYSTEM_PROMPT;
    }
    
    // Stream request
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse&key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: contents,
          generationConfig: { maxOutputTokens: 1024, temperature: 0.7 }
        })
      }
    );
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API Error: ${response.status}`);
    }
    
    // Remove thinking bubble and create response bubble
    removeLoading();
    const responseBubble = document.createElement('div');
    responseBubble.className = 'chat-bubble ai';
    thread.appendChild(responseBubble);
    
    // Stream the response
    let fullText = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              fullText += text;
              // Render markdown
              if (typeof marked !== 'undefined') {
                responseBubble.innerHTML = marked.parse(fullText);
                // Make all links open in new tabs
                responseBubble.querySelectorAll('a').forEach(link => {
                  link.setAttribute('target', '_blank');
                  link.setAttribute('rel', 'noopener noreferrer');
                });
              } else {
                responseBubble.textContent = fullText;
              }
              thread.scrollTop = thread.scrollHeight;
            }
          } catch (e) {}
        }
      }
    }
    
    // Update conversation history and store for voice
    conversationHistory.push({ role: 'user', text: prompt });
    conversationHistory.push({ role: 'model', text: fullText });
    lastAiResponse = fullText;
    
  } catch (error) {
    removeLoading();
    addBubble(error.message, 'error');
  }
  
  sendBtn.disabled = false;
  input.focus();
}

// Test API connection
async function testApi() {
  const testBtn = document.getElementById('testBtn');
  testBtn.disabled = true;
  testBtn.textContent = 'Testing...';
  
  try {
    const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
    if (!keyResult.geminiApiKey) {
      addBubble('No API key set. Go to Settings in main popup.', 'error');
      return;
    }
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${keyResult.geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Reply with just: OK' }] }],
          generationConfig: { maxOutputTokens: 10 }
        })
      }
    );
    
    if (response.ok) {
      addBubble('API connection successful!', 'ai');
    } else {
      const err = await response.json().catch(() => ({}));
      addBubble('API Error: ' + (err.error?.message || response.status), 'error');
    }
  } catch (e) {
    addBubble('Connection failed: ' + e.message, 'error');
  }
  
  testBtn.disabled = false;
  testBtn.textContent = '🔌 Test API';
}

// Clear chat
function clearChat() {
  const thread = document.getElementById('chatThread');
  thread.innerHTML = '<div class="welcome-message">I\'m your AI partner. Ask me anything about this image!</div>';
  conversationHistory = [];
  lastAiResponse = '';
  window.speechSynthesis.cancel();
}

// Copy chat
function copyChat() {
  const thread = document.getElementById('chatThread');
  const bubbles = thread.querySelectorAll('.chat-bubble');
  let text = '';
  bubbles.forEach(b => {
    const role = b.classList.contains('user') ? 'You' : 'AI';
    text += `${role}: ${b.textContent}\n\n`;
  });
  navigator.clipboard.writeText(text.trim());
  addBubble('Chat copied to clipboard!', 'ai');
}

// Event listeners
document.getElementById('closeBtn').addEventListener('click', () => window.close());
document.getElementById('sendBtn').addEventListener('click', handleSend);
document.getElementById('chatInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleSend();
});
document.getElementById('testBtn').addEventListener('click', testApi);
document.getElementById('clearBtn').addEventListener('click', clearChat);
document.getElementById('copyBtn').addEventListener('click', copyChat);
document.getElementById('voiceBtn').addEventListener('click', speakLastResponse);
document.getElementById('flashcardBtn').addEventListener('click', generateFlashcards);

// Text-to-Speech function
function speakLastResponse() {
  const voiceBtn = document.getElementById('voiceBtn');
  const synth = window.speechSynthesis;
  
  // If already speaking, stop
  if (synth.speaking) {
    synth.cancel();
    voiceBtn.classList.remove('speaking');
    voiceBtn.textContent = '🔊';
    return;
  }
  
  if (!lastAiResponse) {
    addBubble('No response to read yet. Ask a question first!', 'error');
    return;
  }
  
  // Clean markdown for speech
  const cleanText = lastAiResponse
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, 'code block')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/\n+/g, '. ');
  
  const utterance = new SpeechSynthesisUtterance(cleanText);
  
  // Try to get a good voice
  const voices = synth.getVoices();
  const preferredVoice = voices.find(v => 
    (v.name.includes('Google') && v.lang.startsWith('en')) ||
    v.name.includes('Samantha') ||
    v.name.includes('Daniel')
  ) || voices.find(v => v.lang.startsWith('en')) || voices[0];
  
  if (preferredVoice) utterance.voice = preferredVoice;
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  
  // Visual feedback
  utterance.onstart = () => {
    voiceBtn.classList.add('speaking');
    voiceBtn.textContent = '🔇';
  };
  utterance.onend = () => {
    voiceBtn.classList.remove('speaking');
    voiceBtn.textContent = '🔊';
  };
  utterance.onerror = () => {
    voiceBtn.classList.remove('speaking');
    voiceBtn.textContent = '🔊';
  };
  
  synth.speak(utterance);
}

// Preload voices
window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();

// Generate Flashcards from screenshot content
async function generateFlashcards() {
  const thread = document.getElementById('chatThread');
  
  // Need either page text or previous conversation to make cards from
  const textContext = currentPageText || lastAiResponse;
  if (!textContext && conversationHistory.length === 0) {
    addBubble('Ask a question first, then I can make flashcards from the response!', 'error');
    return;
  }
  
  // Use last AI response if available, otherwise page text
  const sourceText = lastAiResponse || currentPageText || '';
  if (!sourceText) {
    addBubble('No content to make flashcards from. Ask a question first!', 'error');
    return;
  }
  
  addThinkingBubble();
  
  try {
    const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
    const apiKey = keyResult.geminiApiKey;
    if (!apiKey) throw new Error('Please set your Gemini API key in Settings');
    
    const prompt = `Based on the following text, generate 5 study flashcards (Questions and Answers).
Strictly return ONLY a valid JSON array in this format:
[{"front": "Question", "back": "Answer"}]
Do not add markdown formatting or conversational text.

TEXT TO STUDY:
${sourceText.substring(0, 3000)}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1024, temperature: 0.3 }
        })
      }
    );
    
    if (!response.ok) throw new Error('API Error');
    
    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // ERROR ARMOR: Clean and fix JSON
    let cleanJson = rawText.trim();
    
    // Remove markdown code blocks
    if (cleanJson.includes('```')) {
      cleanJson = cleanJson.replace(/```json?|```/g, '').trim();
    }
    
    // Extract JSON array using regex (ignores any text before/after)
    const jsonMatch = cleanJson.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      cleanJson = jsonMatch[0];
    }
    
    // Auto-fix unclosed brackets (common AI truncation issue)
    const openBrackets = (cleanJson.match(/\[/g) || []).length;
    const closeBrackets = (cleanJson.match(/\]/g) || []).length;
    if (openBrackets > closeBrackets) {
      cleanJson += ']'.repeat(openBrackets - closeBrackets);
    }
    
    // Fix trailing commas before ]
    cleanJson = cleanJson.replace(/,\s*\]/g, ']');
    
    const cards = JSON.parse(cleanJson);
    
    removeLoading();
    renderFlashcards(cards);
    
  } catch (error) {
    removeLoading();
    addBubble('Error generating flashcards: ' + error.message, 'error');
  }
}

// Render 3D flip flashcards
function renderFlashcards(cards) {
  const thread = document.getElementById('chatThread');
  const uniqueId = 'cards-' + Date.now();
  
  const wrapper = document.createElement('div');
  wrapper.className = 'flashcard-wrapper';
  wrapper.id = uniqueId;
  
  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-pdf-btn';
  saveBtn.innerText = '📄 Download PDF';
  saveBtn.onclick = () => printFlashcards(uniqueId);
  wrapper.appendChild(saveBtn);
  
  const grid = document.createElement('div');
  grid.className = 'flashcard-grid';
  
  cards.forEach(card => {
    const cardEl = document.createElement('div');
    cardEl.className = 'flashcard-container';
    cardEl.onclick = () => {
      const wasFlipped = cardEl.classList.contains('flipped');
      cardEl.classList.toggle('flipped');
      // Auto-speak the answer when flipping to back
      if (!wasFlipped && 'speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(card.back);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        window.speechSynthesis.speak(utterance);
      }
    };
    cardEl.innerHTML = `
      <div class="flashcard-inner">
        <div class="flashcard-front"><div>${card.front}</div></div>
        <div class="flashcard-back"><div>${card.back}</div></div>
      </div>
    `;
    grid.appendChild(cardEl);
  });
  
  wrapper.appendChild(grid);
  thread.appendChild(wrapper);
  thread.scrollTop = thread.scrollHeight;
}

// Print flashcards as PDF
function printFlashcards(wrapperId) {
  const content = document.getElementById(wrapperId).querySelector('.flashcard-grid').outerHTML;
  const win = window.open('', '', 'height=600,width=800');
  win.document.write('<html><head><title>Study Flashcards - SnapToAI</title>');
  win.document.write(`<style>
    body { font-family: sans-serif; padding: 20px; }
    .flashcard-grid { display: block; }
    .flashcard-container { border: 2px dashed #333; margin: 10px; padding: 20px; page-break-inside: avoid; display: inline-block; width: 45%; height: 150px; vertical-align: top; }
    .flashcard-front { font-weight: bold; border-bottom: 1px solid #ccc; margin-bottom: 5px; padding-bottom: 5px; display: block; }
    .flashcard-back { display: block; color: #555; }
    .flashcard-inner { position: static; transform: none !important; display: block; height: auto; }
  </style>`);
  win.document.write('</head><body>');
  win.document.write('<h2>Flashcards (Cut along dashed lines)</h2>');
  win.document.write(content);
  win.document.write('</body></html>');
  win.document.close();
  win.print();
}

// Initialize
initializeChat();
