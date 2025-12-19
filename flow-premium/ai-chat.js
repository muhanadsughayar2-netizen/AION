// AI Chat Window Script - Clean Gemini-style interface

let currentImage = null;
let conversationHistory = [];
let lastRequestTime = 0;
const THROTTLE_MS = 3000;

const SYSTEM_PROMPT = "You are Gemini, a helpful AI assistant analyzing screenshots. Be warm and friendly. Use **bold text** for key points. Use bullet lists for clarity. Keep responses well-organized. End with a helpful follow-up question.";

// Initialize
async function initializeChat() {
  const urlParams = new URLSearchParams(window.location.search);
  const imageIndex = urlParams.get('imageIndex');
  
  if (imageIndex !== null) {
    const result = await chrome.storage.session.get(['snaps']);
    const snaps = result.snaps || [];
    const index = parseInt(imageIndex);
    
    if (snaps[index]) {
      currentImage = snaps[index];
      document.getElementById('chipImage').src = currentImage;
      document.getElementById('modalImage').src = currentImage;
    } else {
      document.getElementById('imageChip').style.display = 'none';
      showToast('Image not found');
    }
  } else {
    document.getElementById('imageChip').style.display = 'none';
  }
  
  document.getElementById('chatInput').focus();
}

// Show/hide image modal
function showImageModal() {
  document.getElementById('imageModal').style.display = 'flex';
}

function hideImageModal() {
  document.getElementById('imageModal').style.display = 'none';
}

// Show toast notification
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 2000);
}

// Add user message
function addUserMessage(text) {
  const thread = document.getElementById('chatThread');
  const container = document.createElement('div');
  container.className = 'message-container user';
  container.innerHTML = `<div class="user-bubble">${escapeHtml(text)}</div>`;
  thread.appendChild(container);
  scrollToBottom();
}

// Add AI message
function addAIMessage(html) {
  const thread = document.getElementById('chatThread');
  const container = document.createElement('div');
  container.className = 'message-container';
  container.innerHTML = `
    <div class="ai-message">
      <div class="ai-icon">
        <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
      </div>
      <div class="ai-content">${html}</div>
    </div>
    <div class="message-actions">
      <button class="action-btn" onclick="copyMessage(this)" title="Copy">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
      </button>
    </div>
  `;
  thread.appendChild(container);
  scrollToBottom();
  return container.querySelector('.ai-content');
}

// Create empty AI message for streaming
function createStreamingMessage() {
  const thread = document.getElementById('chatThread');
  const container = document.createElement('div');
  container.className = 'message-container';
  container.innerHTML = `
    <div class="ai-message">
      <div class="ai-icon">
        <svg viewBox="0 0 24 24"><path fill="white" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
      </div>
      <div class="ai-content"></div>
    </div>
    <div class="message-actions">
      <button class="action-btn" onclick="copyMessage(this)" title="Copy">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
      </button>
    </div>
  `;
  thread.appendChild(container);
  scrollToBottom();
  return container.querySelector('.ai-content');
}

// Add error message
function addErrorMessage(text) {
  const thread = document.getElementById('chatThread');
  const container = document.createElement('div');
  container.className = 'message-container';
  container.innerHTML = `
    <div class="ai-message">
      <div class="ai-icon" style="background: #f44336;">
        <svg viewBox="0 0 24 24"><path fill="white" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
      </div>
      <div class="ai-content" style="color: #f44336;">${escapeHtml(text)}</div>
    </div>
  `;
  thread.appendChild(container);
  scrollToBottom();
}

// Copy specific message
function copyMessage(btn) {
  const content = btn.closest('.message-container').querySelector('.ai-content');
  if (content) {
    navigator.clipboard.writeText(content.innerText);
    showToast('Copied to clipboard!');
  }
}

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Scroll to bottom
function scrollToBottom() {
  const area = document.getElementById('chatArea');
  area.scrollTop = area.scrollHeight;
}

// Show/hide thinking
function showThinking() {
  document.getElementById('thinking').style.display = 'flex';
  scrollToBottom();
}

function hideThinking() {
  document.getElementById('thinking').style.display = 'none';
}

// Optimize image for API
async function optimizeImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxSize = 768;
      let w = img.width;
      let h = img.height;
      
      if (w > maxSize || h > maxSize) {
        if (w > h) {
          h = Math.round((h * maxSize) / w);
          w = maxSize;
        } else {
          w = Math.round((w * maxSize) / h);
          h = maxSize;
        }
      }
      
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.src = dataUrl;
  });
}

// Handle send with streaming
async function handleSend() {
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const prompt = input.value.trim();
  
  if (!prompt || !currentImage) return;
  
  input.value = '';
  sendBtn.disabled = true;
  
  addUserMessage(prompt);
  showThinking();
  
  try {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < THROTTLE_MS) {
      const waitTime = Math.ceil((THROTTLE_MS - timeSinceLastRequest) / 1000);
      throw new Error(`Please wait ${waitTime}s (free tier limit)`);
    }
    
    const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
    const apiKey = keyResult.geminiApiKey;
    if (!apiKey) throw new Error('Please set your Gemini API key in Settings');
    
    lastRequestTime = Date.now();
    
    const optimizedImage = await optimizeImage(currentImage);
    const base64Data = optimizedImage.split(',')[1];
    
    const contents = [];
    for (const msg of conversationHistory) {
      contents.push({ role: msg.role, parts: [{ text: msg.text }] });
    }
    
    const userParts = [];
    if (contents.length === 0) {
      userParts.push({ inlineData: { mimeType: 'image/jpeg', data: base64Data } });
    }
    userParts.push({ text: prompt });
    contents.push({ role: 'user', parts: userParts });
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse&key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: contents,
          generationConfig: { maxOutputTokens: 1024, temperature: 0.7 }
        })
      }
    );
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API Error: ${response.status}`);
    }
    
    hideThinking();
    const contentDiv = createStreamingMessage();
    
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
              if (typeof marked !== 'undefined') {
                contentDiv.innerHTML = marked.parse(fullText);
              } else {
                contentDiv.textContent = fullText;
              }
              scrollToBottom();
            }
          } catch (e) {}
        }
      }
    }
    
    conversationHistory.push({ role: 'user', text: prompt });
    conversationHistory.push({ role: 'model', text: fullText });
    
  } catch (error) {
    hideThinking();
    addErrorMessage(error.message);
  }
  
  sendBtn.disabled = false;
  input.focus();
}

// Test API
async function testApi() {
  const testBtn = document.getElementById('testBtn');
  const originalText = testBtn.innerHTML;
  testBtn.disabled = true;
  testBtn.innerHTML = '<svg viewBox="0 0 24 24" style="animation: spin 1s linear infinite;"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor"/></svg> Testing...';
  
  try {
    const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
    const apiKey = keyResult.geminiApiKey;
    
    if (!apiKey) {
      showToast('No API key set');
      return;
    }
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Hi' }] }],
          generationConfig: { maxOutputTokens: 10 }
        })
      }
    );
    
    if (response.ok) {
      showToast('API Connected!');
    } else {
      const data = await response.json().catch(() => ({}));
      showToast(data.error?.message || 'API Error');
    }
  } catch (e) {
    showToast('Connection failed');
  } finally {
    testBtn.disabled = false;
    testBtn.innerHTML = originalText;
  }
}

// Clear chat
function clearChat() {
  document.getElementById('chatThread').innerHTML = '';
  conversationHistory = [];
  showToast('Chat cleared');
}

// Copy entire chat
function copyChat() {
  const thread = document.getElementById('chatThread');
  const messages = thread.querySelectorAll('.message-container');
  let text = '';
  
  messages.forEach(msg => {
    if (msg.classList.contains('user')) {
      text += 'You: ' + msg.querySelector('.user-bubble').textContent + '\n\n';
    } else {
      const content = msg.querySelector('.ai-content');
      if (content) text += 'Gemini: ' + content.innerText + '\n\n';
    }
  });
  
  if (text) {
    navigator.clipboard.writeText(text.trim());
    showToast('Chat copied!');
  } else {
    showToast('Nothing to copy');
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', initializeChat);
