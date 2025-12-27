// AI Chat Window Script
// Handles AI chat in a standalone window

// === UNIVERSAL NO-FAIL TTS ENGINE ===
const synth = window.speechSynthesis;
let allVoices = [];

// No-Fail Voice Loader - ensures voices are always ready
function loadUniversalVoices() {
  allVoices = synth.getVoices();
  if (allVoices.length > 0) {
    console.log('[SnapToAI] Loaded', allVoices.length, 'voices');
  }
}

// Chrome loads voices asynchronously - this wakes them up
if (speechSynthesis.onvoiceschanged !== undefined) {
  speechSynthesis.onvoiceschanged = loadUniversalVoices;
}
loadUniversalVoices();

// Universal speakText - NEVER fails, always finds a voice
function speakText(text) {
  // Safety: Stop any current speech
  synth.cancel();
  
  // Always refresh voices before speaking
  allVoices = synth.getVoices();
  
  // Clean Markdown symbols (**, #, etc.) for natural speech
  const cleanText = text.replace(/\*\*/g, '').replace(/#{1,6}\s?/g, '').replace(/`/g, '').trim();
  const utterance = new SpeechSynthesisUtterance(cleanText);
  
  // Smart Language Detection - check characters to determine language
  let lang = 'en-US'; // Default
  if (/[\u0600-\u06FF]/.test(cleanText)) lang = 'ar';           // Arabic
  else if (/[\u4e00-\u9fff]/.test(cleanText)) lang = 'zh';      // Chinese
  else if (/[\u3040-\u309f\u30a0-\u30ff]/.test(cleanText)) lang = 'ja'; // Japanese
  else if (/[\uac00-\ud7af]/.test(cleanText)) lang = 'ko';      // Korean
  else if (/[\u0400-\u04FF]/.test(cleanText)) lang = 'ru';      // Russian
  else if (/[àâäéèêëïîôùûüçœæ]/i.test(cleanText) || 
           /\b(bonjour|merci|oui|je|vous|avec|pour|dans)\b/i.test(cleanText)) lang = 'fr'; // French
  else if (/[àèìòùÀÈÌÒÙ]/i.test(cleanText) || 
           /\b(ciao|grazie|buongiorno|sono|questo)\b/i.test(cleanText)) lang = 'it'; // Italian
  else if (/[ñ¿¡]/i.test(cleanText) || 
           /\b(hola|gracias|buenos|para|como)\b/i.test(cleanText)) lang = 'es'; // Spanish
  else if (/[äöüß]/i.test(cleanText) || 
           /\b(guten|danke|bitte|und|ist)\b/i.test(cleanText)) lang = 'de'; // German
  
  console.log('[SnapToAI] Detected language:', lang);
  
  // The "Harmonious" Search - Premium Google voice first, then any match, then fallback
  let bestVoice = allVoices.find(v => v.lang.startsWith(lang) && v.name.includes('Google')) ||
                  allVoices.find(v => v.lang.startsWith(lang)) ||
                  allVoices.find(v => v.lang.startsWith('en') && v.name.includes('Google')) ||
                  allVoices[0]; // Ultimate fallback - NEVER silent
  
  if (bestVoice) {
    utterance.voice = bestVoice;
    utterance.lang = bestVoice.lang;
    console.log(`[SnapToAI] Using voice: ${bestVoice.name} (${bestVoice.lang})`);
  }
  
  // Gemini-style friendly speed
  utterance.rate = 1.05;
  utterance.pitch = 1.0;
  
  // Return utterance for the caller to speak
  return utterance;
}

let currentImages = []; // Support multiple images
let currentPageText = '';
let conversationHistory = [];
let filesQueue = []; // Multi-file upload queue (Gemini-style)

// === HYBRID QUOTA SYSTEM (ZERO COST) ===
const FREE_DAILY_LIMIT = 20;
const PREMIUM_DAILY_LIMIT = 200;
const PROXY_URL = 'https://snaptoai.replit.app'; // Replit proxy server

// Check and update daily quota
async function getQuotaStatus() {
  const today = new Date().toLocaleDateString();
  const data = await chrome.storage.local.get(['dailyCount', 'lastReset', 'isPremium']);
  
  // Reset if new day
  if (data.lastReset !== today) {
    await chrome.storage.local.set({ dailyCount: 0, lastReset: today });
    return { count: 0, isPremium: data.isPremium || false, limit: data.isPremium ? PREMIUM_DAILY_LIMIT : FREE_DAILY_LIMIT };
  }
  
  const count = data.dailyCount || 0;
  const isPremium = data.isPremium || false;
  const limit = isPremium ? PREMIUM_DAILY_LIMIT : FREE_DAILY_LIMIT;
  
  return { count, isPremium, limit };
}

// Increment quota after successful API call
async function incrementQuota() {
  const data = await chrome.storage.local.get(['dailyCount']);
  const newCount = (data.dailyCount || 0) + 1;
  await chrome.storage.local.set({ dailyCount: newCount });
  updateQuotaDisplay();
  return newCount;
}

// Update quota display in header
async function updateQuotaDisplay() {
  const status = await getQuotaStatus();
  const quotaEl = document.getElementById('quotaDisplay');
  if (quotaEl) {
    const remaining = status.limit - status.count;
    if (status.isPremium) {
      quotaEl.innerHTML = `<span style="color:#00d9ff">⚡ ${remaining}/${status.limit}</span>`;
    } else {
      quotaEl.innerHTML = `<span>${remaining}/${status.limit} free</span>`;
    }
  }
}

// Show upgrade modal
function showUpgradeModal() {
  const modal = document.getElementById('upgradeModalOverlay');
  if (modal) modal.classList.add('show');
}

// Hide upgrade modal
function hideUpgradeModal() {
  const modal = document.getElementById('upgradeModalOverlay');
  if (modal) modal.classList.remove('show');
}

const SYSTEM_PROMPT = "You are a thorough, exhaustive AI assistant. Your goal is to provide the COMPLETE answer in a single response. Never stop mid-thought. Never ask the user if they want more—just give it all now. If the answer is long, structure it with headers. Be warm, friendly and thorough. Use **bold text** for emphasis and bullet lists for clarity. Format responses with markdown. End with a helpful follow-up question.";

const SMART_SYSTEM_PROMPT = "You are a thorough, exhaustive AI assistant. I am providing you with the raw text of a webpage for accuracy, and the screenshot of that page for visual context (charts, layout, images). Please use the text for your primary analysis and the images to confirm visual details. Your goal is to provide the COMPLETE answer in a single response. Never stop mid-thought. Never truncate. If the answer is long, structure it with headers. Be warm, friendly and thorough. Use **bold text** for emphasis and bullet lists for clarity. Format responses with markdown. End with a helpful follow-up question.";

const MULTI_IMAGE_PROMPT = "You are a thorough, exhaustive AI assistant. I am providing you with multiple screenshots that together show the full picture. Please analyze ALL images together to understand the complete context. Your goal is to provide the COMPLETE answer in a single response. Never stop mid-thought. Never truncate. If the answer is long, structure it with headers. Be warm, friendly and thorough. Use **bold text** for emphasis and bullet lists for clarity. Format responses with markdown. End with a helpful follow-up question.";

// Get images from URL params or storage
async function initializeChat() {
  const urlParams = new URLSearchParams(window.location.search);
  const count = urlParams.get('count');
  
  // Get images and page text from session storage
  const result = await chrome.storage.session.get(['selectedSnaps', 'selectedSnap', 'snaps', 'pageText']);
  currentPageText = result.pageText || '';
  
  // Use new selectedSnaps array, fallback to legacy selectedSnap
  let imagesToUse = result.selectedSnaps || [];
  if (imagesToUse.length === 0 && result.selectedSnap) {
    imagesToUse = [result.selectedSnap];
  }
  
  if (imagesToUse.length > 0) {
    currentImages = imagesToUse;
    const previewContainer = document.querySelector('.image-preview');
    
    if (currentImages.length === 1) {
      // Single image - show as before
      document.getElementById('previewImage').src = currentImages[0];
    } else {
      // Multiple images - show grid
      previewContainer.innerHTML = '<div class="multi-image-grid" id="multiImageGrid"></div>';
      const grid = document.getElementById('multiImageGrid');
      currentImages.forEach((img, i) => {
        const imgEl = document.createElement('img');
        imgEl.src = img;
        imgEl.alt = `Screenshot ${i + 1}`;
        imgEl.className = 'grid-image';
        imgEl.title = `Screenshot ${i + 1} of ${currentImages.length}`;
        grid.appendChild(imgEl);
      });
      // Add info badge
      const badge = document.createElement('div');
      badge.className = 'multi-image-badge';
      badge.textContent = `${currentImages.length} screenshots`;
      previewContainer.appendChild(badge);
    }
  } else {
    document.querySelector('.image-preview').innerHTML = '<div style="color: #ff5252; padding: 20px; text-align: center;">Images not found. Please try again.</div>';
    addBubble('Could not load images. Please close and try again.', 'error');
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

// Send message to Gemini API (supports multiple images)
async function sendToGemini(prompt, imageDataUrls) {
  // Accept array of images
  const images = Array.isArray(imageDataUrls) ? imageDataUrls : [imageDataUrls];
  
  // Get API key from sync storage (same as popup.js)
  const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
  const apiKey = keyResult.geminiApiKey;
  
  if (!apiKey) {
    throw new Error('Please set your Gemini API key in Settings');
  }
  
  // Build conversation
  const contents = [];
  
  // Add conversation history
  for (const msg of conversationHistory) {
    contents.push({
      role: msg.role,
      parts: [{ text: msg.text }]
    });
  }
  
  // Add current message with images (on first message only)
  const userParts = [];
  if (contents.length === 0) {
    // Add ALL images to the first message
    for (const imageDataUrl of images) {
      const base64Data = imageDataUrl.split(',')[1];
      const mimeType = imageDataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      userParts.push({
        inlineData: {
          mimeType: mimeType,
          data: base64Data
        }
      });
    }
  }
  userParts.push({ text: prompt });
  contents.push({ role: 'user', parts: userParts });
  
  // Use multi-image prompt if multiple images
  const systemPrompt = images.length > 1 ? MULTI_IMAGE_PROMPT : SYSTEM_PROMPT;
  
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: systemPrompt
          }]
        },
        contents: contents,
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0.7,
          topP: 0.95,
          topK: 40
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
  
  if (!prompt || currentImages.length === 0) return;
  
  // Check quota before proceeding
  const quota = await getQuotaStatus();
  if (quota.count >= quota.limit) {
    showUpgradeModal();
    return;
  }
  
  input.value = '';
  sendBtn.disabled = true;
  
  // Add user message
  addBubble(prompt, 'user');
  addThinkingBubble();
  
  try {
    // Get API key
    const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
    const apiKey = keyResult.geminiApiKey;
    if (!apiKey) throw new Error('Please set your Gemini API key in Settings');
    
    // Build request
    const contents = [];
    for (const msg of conversationHistory) {
      contents.push({ role: msg.role, parts: [{ text: msg.text }] });
    }
    
    const userParts = [];
    if (contents.length === 0) {
      // First message: include ALL images
      for (const imgUrl of currentImages) {
        const base64Data = imgUrl.split(',')[1];
        const mimeType = imgUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
        userParts.push({ inlineData: { mimeType: mimeType, data: base64Data } });
      }
      // If we have page text, include it for smarter analysis
      if (currentPageText && currentPageText.length > 800) {
        userParts.push({ text: `[PAGE TEXT FOR CONTEXT]:\n${currentPageText}\n\n[USER QUESTION]: ${prompt}` });
      } else {
        userParts.push({ text: prompt });
      }
    } else {
      userParts.push({ text: prompt });
    }
    
    // Attach all queued files (multi-file Gemini-style)
    if (filesQueue && filesQueue.length > 0) {
      filesQueue.forEach(f => {
        userParts.push({ inlineData: { mimeType: f.mimeType, data: f.data } });
      });
      clearFilesQueue();
    }
    
    contents.push({ role: 'user', parts: userParts });
    
    // Use appropriate prompt based on content
    let systemPrompt = SYSTEM_PROMPT;
    if (currentImages.length > 1) {
      systemPrompt = MULTI_IMAGE_PROMPT;
    } else if (currentPageText && currentPageText.length > 800) {
      systemPrompt = SMART_SYSTEM_PROMPT;
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
          generationConfig: { 
            maxOutputTokens: 2048,
            temperature: 0.7,
            topP: 0.95,
            topK: 40
          }
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
    
    // Add action buttons to this response
    addBubbleActions(responseBubble, fullText);
    
    // Update conversation history
    conversationHistory.push({ role: 'user', text: prompt });
    conversationHistory.push({ role: 'model', text: fullText });
    
    // Increment quota after successful call
    await incrementQuota();
    
  } catch (error) {
    removeLoading();
    addBubble(error.message, 'error');
  }
  
  sendBtn.disabled = false;
  input.focus();
}

// Add action buttons under each AI response
function addBubbleActions(bubble, text) {
  const actions = document.createElement('div');
  actions.className = 'bubble-actions';
  actions.innerHTML = `
    <button class="copy-single-btn">📋 Copy</button>
    <button class="read-aloud-btn">🔊 Read</button>
  `;
  bubble.appendChild(actions);
  
  // Copy this response only
  actions.querySelector('.copy-single-btn').onclick = async () => {
    let html = bubble.innerHTML.replace(/<div class="bubble-actions">.*<\/div>/s, '');
    html = html.replace(/<strong>/g, '<strong style="color: #0066cc; font-weight: bold;">');
    html = html.replace(/<a /g, '<a style="color: #0066cc; text-decoration: underline;" ');
    const styledHtml = `<div style="font-family: Arial, sans-serif; color: #000;">${html}</div>`;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([styledHtml], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        })
      ]);
      actions.querySelector('.copy-single-btn').textContent = '✓ Copied!';
      setTimeout(() => actions.querySelector('.copy-single-btn').textContent = '📋 Copy', 2000);
    } catch (e) {
      await navigator.clipboard.writeText(text);
      actions.querySelector('.copy-single-btn').textContent = '✓ Copied!';
      setTimeout(() => actions.querySelector('.copy-single-btn').textContent = '📋 Copy', 2000);
    }
  };
  
  // Read aloud using FREE browser TTS with auto language detection
  const readBtn = actions.querySelector('.read-aloud-btn');
  
  readBtn.onclick = () => {
    // Toggle: if speaking, stop
    if (synth.speaking) {
      synth.cancel();
      readBtn.textContent = '🔊 Read';
      return;
    }
    
    const plainText = bubble.textContent.replace('📋 Copy🔊 Read', '').replace('✓ Copied!🔊 Read', '').replace('⏹ Stop', '');
    
    // Use premium multi-language TTS with auto language detection
    const utterance = speakText(plainText);
    
    synth.speak(utterance);
    readBtn.textContent = '⏹ Stop';
    
    utterance.onend = () => readBtn.textContent = '🔊 Read';
    utterance.onerror = () => readBtn.textContent = '🔊 Read';
  };
}

// Continue - ask AI to continue its response
async function continueResponse() {
  document.getElementById('chatInput').value = 'Please continue your response from where you left off.';
  handleSend();
}

// Summarize - ask AI to summarize everything
async function summarizeChat() {
  document.getElementById('chatInput').value = 'Please provide a brief summary of our entire conversation and the key insights.';
  handleSend();
}

// Export to PDF (simple print-based)
function exportToPDF() {
  const thread = document.getElementById('chatThread');
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <html><head><title>SnapToAI Chat Export</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
      .user { background: #e3f2fd; padding: 15px; border-radius: 10px; margin: 10px 0; }
      .ai { background: #f5f5f5; padding: 15px; border-radius: 10px; margin: 10px 0; }
      strong { color: #1976d2; }
      h1 { color: #333; border-bottom: 2px solid #00d9ff; padding-bottom: 10px; }
    </style></head><body>
    <h1>📸 SnapToAI Chat Export</h1>
  `);
  thread.querySelectorAll('.chat-bubble').forEach(b => {
    if (b.classList.contains('loading')) return;
    const type = b.classList.contains('user') ? 'user' : 'ai';
    let content = b.innerHTML.replace(/<div class="bubble-actions">.*<\/div>/s, '');
    printWindow.document.write(`<div class="${type}">${content}</div>`);
  });
  printWindow.document.write('</body></html>');
  printWindow.document.close();
  printWindow.print();
}

// Clear chat
function clearChat() {
  const thread = document.getElementById('chatThread');
  thread.innerHTML = '<div class="welcome-message">I\'m your AI partner. Ask me anything about this image!</div>';
  conversationHistory = [];
}

// Copy chat with rich HTML formatting (preserves bold, links, etc in Google Docs)
async function copyChat() {
  const thread = document.getElementById('chatThread');
  const bubbles = thread.querySelectorAll('.chat-bubble:not(.loading)');
  
  let html = '';
  let plainText = '';
  
  bubbles.forEach(b => {
    if (b.classList.contains('welcome-message')) return;
    const role = b.classList.contains('user') ? 'You' : 'AI';
    let content = b.innerHTML;
    const textContent = b.textContent;
    
    // Convert CSS styles to inline styles for Google Docs compatibility
    // Bold/strong text → blue color (Google Docs doesn't read CSS classes)
    content = content.replace(/<strong>/g, '<strong style="color: #0066cc; font-weight: bold;">');
    content = content.replace(/<b>/g, '<b style="color: #0066cc; font-weight: bold;">');
    // Links → blue underlined
    content = content.replace(/<a /g, '<a style="color: #0066cc; text-decoration: underline;" ');
    
    html += `<p><strong>${role}:</strong></p><div>${content}</div><br>`;
    plainText += `${role}: ${textContent}\n\n`;
  });
  
  // Wrap in styled container for Google Docs compatibility
  const styledHtml = `<div style="font-family: Arial, sans-serif; color: #000;">${html}</div>`;
  
  try {
    // Copy as both HTML and plain text for maximum compatibility
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([styledHtml], { type: 'text/html' }),
        'text/plain': new Blob([plainText.trim()], { type: 'text/plain' })
      })
    ]);
    addBubble('Copied with formatting! Paste in Google Docs to see highlights.', 'ai');
  } catch (e) {
    // Fallback to plain text
    await navigator.clipboard.writeText(plainText.trim());
    addBubble('Copied as plain text.', 'ai');
  }
}

// Auto-resize textarea
function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
}

// Event listeners
document.getElementById('closeBtn').addEventListener('click', () => window.close());
document.getElementById('sendBtn').addEventListener('click', handleSend);

const chatInput = document.getElementById('chatInput');
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});
chatInput.addEventListener('input', () => autoResize(chatInput));
chatInput.addEventListener('paste', (e) => {
  // Allow paste to complete, then auto-resize
  setTimeout(() => autoResize(chatInput), 0);
});

document.getElementById('continueBtn').addEventListener('click', continueResponse);
document.getElementById('summarizeBtn').addEventListener('click', summarizeChat);
document.getElementById('clearBtn').addEventListener('click', clearChat);
document.getElementById('exportBtn').addEventListener('click', exportToPDF);

// Upload dropdown menu
const addFileBtn = document.getElementById('addFileBtn');
const uploadDropdown = document.getElementById('uploadDropdown');

addFileBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  uploadDropdown.classList.toggle('show');
});

// Close dropdown when clicking outside
document.addEventListener('click', () => {
  uploadDropdown.classList.remove('show');
});

// Upload files option
document.getElementById('uploadFilesOpt').addEventListener('click', () => {
  document.getElementById('fileInput').click();
  uploadDropdown.classList.remove('show');
});

// Photos option
document.getElementById('photosOpt').addEventListener('click', () => {
  document.getElementById('photoInput').click();
  uploadDropdown.classList.remove('show');
});

// Add from Drive option - show modal
document.getElementById('addFromDriveOpt').addEventListener('click', () => {
  uploadDropdown.classList.remove('show');
  document.getElementById('driveModalOverlay').classList.add('show');
});

// Drive modal close button
document.getElementById('driveModalClose').addEventListener('click', () => {
  document.getElementById('driveModalOverlay').classList.remove('show');
});

// Close modal on overlay click
document.getElementById('driveModalOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    e.currentTarget.classList.remove('show');
  }
});

// Connect Google Drive button - triggers OAuth
document.getElementById('driveConnectBtn').addEventListener('click', async () => {
  const connectBtn = document.getElementById('driveConnectBtn');
  connectBtn.textContent = 'Connecting...';
  connectBtn.disabled = true;
  
  try {
    // Use Chrome Identity API for OAuth
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        console.error('[SnapToAI] OAuth error:', chrome.runtime.lastError.message);
        addBubble('Could not connect to Google Drive. Please try again.', 'ai');
        connectBtn.textContent = 'Connect Google Drive';
        connectBtn.disabled = false;
        document.getElementById('driveModalOverlay').classList.remove('show');
        return;
      }
      
      if (token) {
        // Save token and close modal
        chrome.storage.local.set({ googleDriveToken: token });
        document.getElementById('driveModalOverlay').classList.remove('show');
        addBubble('Google Drive connected! You can now access your files.', 'ai');
        connectBtn.textContent = 'Connect Google Drive';
        connectBtn.disabled = false;
      }
    });
  } catch (error) {
    console.error('[SnapToAI] Drive connect error:', error);
    addBubble('Connection failed. Make sure OAuth is configured in the extension.', 'ai');
    connectBtn.textContent = 'Connect Google Drive';
    connectBtn.disabled = false;
    document.getElementById('driveModalOverlay').classList.remove('show');
  }
});

// NotebookLM option
document.getElementById('notebookOpt').addEventListener('click', () => {
  uploadDropdown.classList.remove('show');
  window.open('https://notebooklm.google.com/', '_blank');
});

// Multi-file upload handling (Gemini-style)
function handleFileUpload(files) {
  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const fileData = {
        mimeType: file.type || 'application/octet-stream',
        data: event.target.result.split(',')[1],
        name: file.name
      };
      filesQueue.push(fileData);
      
      // Create file card UI
      const card = document.createElement('div');
      card.className = 'file-card';
      const icon = file.type.startsWith('image/') ? '🖼️' : file.type.includes('pdf') ? '📄' : '📎';
      card.innerHTML = `${icon} <span>${file.name}</span> <div class="remove-btn">×</div>`;
      card.querySelector('.remove-btn').onclick = () => {
        filesQueue = filesQueue.filter(f => f !== fileData);
        card.remove();
      };
      document.getElementById('filePreviewZone').appendChild(card);
    };
    reader.readAsDataURL(file);
  });
}

document.getElementById('fileInput').addEventListener('change', (e) => {
  handleFileUpload(e.target.files);
  e.target.value = '';
});

document.getElementById('photoInput').addEventListener('change', (e) => {
  handleFileUpload(e.target.files);
  e.target.value = '';
});

// Clear file queue after sending
function clearFilesQueue() {
  filesQueue = [];
  document.getElementById('filePreviewZone').innerHTML = '';
}

// Initialize
initializeChat();

// Initialize quota display on load and check premium status
async function initQuotaSystem() {
  // Check premium status from ExtensionPay
  try {
    const response = await chrome.runtime.sendMessage({ action: 'checkPremium' });
    if (response && response.isPremium) {
      await chrome.storage.local.set({ isPremium: true });
      console.log('[SnapToAI] Premium user detected');
    }
  } catch (e) {
    console.log('[SnapToAI] Could not check premium status');
  }
  updateQuotaDisplay();
}
initQuotaSystem();

// Upgrade modal handlers
document.getElementById('upgradeBtn')?.addEventListener('click', async () => {
  // Open ExtensionPay payment page
  try {
    await chrome.runtime.sendMessage({ action: 'openPayment' });
    hideUpgradeModal();
  } catch (e) {
    window.open('https://extensionpay.com/ext/snaptoai-abc123', '_blank');
    hideUpgradeModal();
  }
});

document.getElementById('upgradeSkipBtn')?.addEventListener('click', () => {
  hideUpgradeModal();
});
