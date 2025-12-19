// AI Chat Window Script
// Handles AI chat in a standalone window

let currentImage = null;
let conversationHistory = [];
let lastRequestTime = 0;
const THROTTLE_MS = 3000;

// Get image from URL params or storage
async function initializeChat() {
  const urlParams = new URLSearchParams(window.location.search);
  const imageIndex = urlParams.get('imageIndex');
  
  if (imageIndex !== null) {
    // Get image from session storage
    const result = await chrome.storage.session.get(['snaps']);
    const snaps = result.snaps || [];
    const index = parseInt(imageIndex);
    
    if (snaps[index]) {
      currentImage = snaps[index];
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

// Optimize image for API (reduce size and quality)
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
  
  // Optimize image
  const optimizedImage = await optimizeImage(imageDataUrl);
  const base64Data = optimizedImage.split(',')[1];
  
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
    userParts.push({
      inlineData: {
        mimeType: 'image/jpeg',
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
            text: "You are a helpful AI assistant analyzing images. Be concise but thorough. Focus on what's most useful to the user."
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

// Handle send
async function handleSend() {
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const prompt = input.value.trim();
  
  if (!prompt || !currentImage) return;
  
  input.value = '';
  sendBtn.disabled = true;
  
  addBubble(prompt, 'user');
  addThinkingBubble();
  
  try {
    const response = await sendToGemini(prompt, currentImage);
    removeLoading();
    addBubble(response, 'ai');
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

// Initialize
initializeChat();
