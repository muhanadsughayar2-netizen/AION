// AI Chat Window Script
// Handles AI chat in a standalone window

// === PREMIUM MULTI-LANGUAGE TTS ===
let synth = window.speechSynthesis;
let voices = [];
let voicesReady = false;

// Load voices with retry until ready
function loadVoices() {
  voices = synth.getVoices();
  if (voices.length > 0) {
    voicesReady = true;
    console.log('[SnapToAI] Loaded', voices.length, 'voices');
    // Log available languages for debugging
    const langs = [...new Set(voices.map(v => v.lang.split('-')[0]))];
    console.log('[SnapToAI] Available languages:', langs.join(', '));
  }
}
loadVoices();
if (speechSynthesis.onvoiceschanged !== undefined) {
  speechSynthesis.onvoiceschanged = loadVoices;
}

// Detect language from text
function detectLanguage(text) {
  // Arabic characters (strong indicator)
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  // Chinese characters
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  // Japanese (hiragana/katakana)
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja';
  // Korean
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  // Russian/Cyrillic
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  // French - accents or common words (expanded)
  if (/[àâäéèêëïîôùûüçœæ]/i.test(text) || 
      /\b(bonjour|salut|merci|oui|non|je|tu|il|elle|nous|vous|ils|elles|le|la|les|un|une|de|du|des|et|est|sont|avec|pour|dans|sur|que|qui|quoi|comment|pourquoi|bien|très|aussi|mais|comme|tout|cette|votre|notre)\b/i.test(text)) return 'fr';
  // Spanish
  if (/[ñ¿¡]/i.test(text) || 
      /\b(hola|gracias|buenos|buenas|el|la|los|las|de|del|en|es|son|con|para|por|como|pero|más|qué|cómo|muy|bien|todo|esta|este)\b/i.test(text)) return 'es';
  // German
  if (/[äöüß]/i.test(text) || 
      /\b(guten|danke|bitte|der|die|das|und|ist|sind|mit|für|auf|bei|nach|von|haben|werden|können|müssen)\b/i.test(text)) return 'de';
  // Default English
  return 'en';
}

// Wait for voices then speak
function speakText(text, langCode = null) {
  synth.cancel(); // Stop any existing speech
  
  // Always refresh voices
  voices = synth.getVoices();
  
  const utterance = new SpeechSynthesisUtterance(text);
  
  // Auto-detect language if not provided
  const detectedLang = langCode || detectLanguage(text);
  console.log('[SnapToAI] Detected language:', detectedLang);
  
  // Find voice matching the language
  let bestVoice = null;
  
  if (detectedLang === 'ar') {
    // Arabic: look for Google Arabic or any Arabic voice
    bestVoice = voices.find(v => v.lang.startsWith('ar') && v.name.includes('Google')) ||
                voices.find(v => v.lang.startsWith('ar')) ||
                voices.find(v => v.name.toLowerCase().includes('arabic'));
  } else if (detectedLang === 'fr') {
    // French: look for Google French or any French voice
    bestVoice = voices.find(v => v.lang.startsWith('fr') && v.name.includes('Google')) ||
                voices.find(v => v.lang.startsWith('fr')) ||
                voices.find(v => v.name.toLowerCase().includes('french') || v.name.toLowerCase().includes('français'));
  } else if (detectedLang === 'es') {
    bestVoice = voices.find(v => v.lang.startsWith('es') && v.name.includes('Google')) ||
                voices.find(v => v.lang.startsWith('es'));
  } else if (detectedLang === 'de') {
    bestVoice = voices.find(v => v.lang.startsWith('de') && v.name.includes('Google')) ||
                voices.find(v => v.lang.startsWith('de'));
  } else if (detectedLang === 'zh') {
    bestVoice = voices.find(v => v.lang.startsWith('zh') && v.name.includes('Google')) ||
                voices.find(v => v.lang.startsWith('zh'));
  } else if (detectedLang === 'ja') {
    bestVoice = voices.find(v => v.lang.startsWith('ja') && v.name.includes('Google')) ||
                voices.find(v => v.lang.startsWith('ja'));
  } else if (detectedLang === 'ko') {
    bestVoice = voices.find(v => v.lang.startsWith('ko') && v.name.includes('Google')) ||
                voices.find(v => v.lang.startsWith('ko'));
  } else if (detectedLang === 'ru') {
    bestVoice = voices.find(v => v.lang.startsWith('ru') && v.name.includes('Google')) ||
                voices.find(v => v.lang.startsWith('ru'));
  } else {
    // English fallback
    bestVoice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google')) ||
                voices.find(v => v.lang.startsWith('en'));
  }

  if (bestVoice) {
    utterance.voice = bestVoice;
    utterance.lang = bestVoice.lang;
    console.log(`[SnapToAI] Using voice: ${bestVoice.name} (${bestVoice.lang})`);
  } else {
    // Set language even without a specific voice - browser may still render
    utterance.lang = detectedLang;
    console.log(`[SnapToAI] No voice found for ${detectedLang}, using browser default`);
  }

  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  
  return utterance;
}

let currentImages = []; // Support multiple images
let currentPageText = '';
let conversationHistory = [];
let filesQueue = []; // Multi-file upload queue (Gemini-style)

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
  
  // Update verdict button visibility
  if (typeof updateVerdictButtonVisibility === 'function') {
    updateVerdictButtonVisibility();
  }
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

// Multi-file upload handling (Gemini-style)
document.getElementById('fileInput').addEventListener('change', (e) => {
  Array.from(e.target.files).forEach(file => {
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
  e.target.value = '';
});

// Clear file queue after sending
function clearFilesQueue() {
  filesQueue = [];
  document.getElementById('filePreviewZone').innerHTML = '';
}

// Initialize
initializeChat();

// === THE VERDICT FEATURE ===
// Show/hide verdict button based on image availability
function updateVerdictButtonVisibility() {
  const verdictBtn = document.getElementById('verdictBtn');
  if (verdictBtn) {
    verdictBtn.style.display = currentImages.length > 0 ? 'inline-block' : 'none';
  }
}

// Call on load and when images change
updateVerdictButtonVisibility();

// Get chat context for smarter verdicts (last few messages)
function getChatContext() {
  if (!conversationHistory || conversationHistory.length === 0) return '';
  return conversationHistory.slice(-4).map(m => {
    const text = m.text || '';
    return `${m.role}: ${text.substring(0, 100)}`;
  }).join('\n');
}

document.getElementById('verdictBtn')?.addEventListener('click', async () => {
  const verdictBtn = document.getElementById('verdictBtn');
  const thread = document.getElementById('chatThread');
  
  if (!currentImages.length) {
    addBubble('Please capture a screenshot first!', 'ai');
    return;
  }
  
  const apiResult = await chrome.storage.sync.get(['geminiApiKey']);
  if (!apiResult.geminiApiKey) {
    addBubble('Please add your Gemini API key first.', 'ai');
    return;
  }
  
  verdictBtn.disabled = true;
  verdictBtn.textContent = '⏳ Thinking...';
  verdictBtn.classList.remove('gold', 'red', 'green');
  if (navigator.vibrate) navigator.vibrate(100);
  
  try {
    const imageData = currentImages[0].replace(/^data:image\/\w+;base64,/, '');
    const chatContext = getChatContext();
    
    // Cost-efficient prompt - ONE API call, 300 tokens max
    // OMNI-SCORE: The "Truth Engine" - expose traps and wins
    const verdictPrompt = `You are the "Omni-Score Truth Engine". Analyze this image ruthlessly.
${chatContext ? `Context: ${chatContext.substring(0, 200)}\n` : ''}
Auto-detect type (product/stock/menu/real estate/service). Be BRUTALLY honest.

Output ONLY JSON:
{"score":58,"checks":[{"label":"Rip-Off Radar","value":"22% markup detected","impact":"-15","positive":false},{"label":"Quality Gap","value":"Material costs $4, you pay $40","impact":"-12","positive":false},{"label":"Time Risk","value":"May miss deadline","impact":"-15","positive":false}],"verdict":"Wait 2 weeks - price drops 40% after holiday.","glowColor":"red"}
(score 0-100, glowColor: gold=80+, green=60-79, red=<60)`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiResult.geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [
            { text: verdictPrompt },
            { inlineData: { mimeType: 'image/png', data: imageData } }
          ]}],
          generationConfig: { maxOutputTokens: 300, temperature: 0.7 }
        })
      }
    );
    
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    
    let verdictData;
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
      verdictData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      verdictData = null;
    }
    
    if (!verdictData) {
      verdictData = {
        score: 50,
        checks: [{ label: "Analysis", value: responseText.substring(0, 80) || "Complete", impact: "0", positive: true }],
        verdict: "Review the details above.",
        glowColor: "green"
      };
    }
    
    // Determine glow color from score
    const score = verdictData.score || 50;
    const glowColor = score >= 80 ? 'gold' : score >= 60 ? 'green' : 'red';
    const scoreColor = score >= 80 ? 'gold' : score >= 60 ? 'green' : 'red';
    
    verdictBtn.classList.add(glowColor);
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    
    // Build checks HTML
    const checksHtml = (verdictData.checks || []).map(c => `
      <div class="verdict-row">
        <div class="verdict-label-block">
          <span class="verdict-label">${c.label}</span>
          <span class="verdict-value">${c.value}</span>
        </div>
        <span class="verdict-impact ${c.positive ? 'green' : 'red'}">${c.impact}</span>
      </div>
    `).join('');
    
    // Add OMNI-SCORE card INLINE in chat thread
    const card = document.createElement('div');
    card.className = 'verdict-card-inline';
    card.innerHTML = `
      <div class="omni-score-header">
        <span class="score-label">THE TRUTH SCORE</span>
        <span class="score-value ${scoreColor}">${score}<span class="score-max">/100</span></span>
      </div>
      ${checksHtml}
      <div class="verdict-bottom-line">
        <span class="bottom-label">THE BOTTOM LINE</span>
        <p class="bottom-verdict">${verdictData.verdict || 'Analysis complete.'}</p>
      </div>
    `;
    thread.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth' });
    
  } catch (error) {
    addBubble('Verdict failed: ' + error.message, 'ai');
    verdictBtn.classList.add('red');
  } finally {
    verdictBtn.disabled = false;
    verdictBtn.textContent = '⚖️ The Verdict';
  }
});

// ============ MAGIC BUTTONS SYSTEM ============
let magicButtons = [];

// Render beautiful Magic Card
function renderMagicCard(data, btn) {
  const thread = document.getElementById('chatThread');
  const toneColors = { gold: '#fbbf24', green: '#34d399', red: '#f87171' };
  const toneColor = toneColors[data.tone] || toneColors.green;
  
  const sectionsHtml = (data.sections || []).map(section => `
    <div class="magic-section">
      <div class="magic-section-label">${section.label}</div>
      <ul class="magic-items">
        ${(section.items || []).map(item => `<li>${item}</li>`).join('')}
      </ul>
    </div>
  `).join('');
  
  const card = document.createElement('div');
  card.className = 'magic-card';
  card.style.setProperty('--tone-color', toneColor);
  card.innerHTML = `
    <div class="magic-card-header">
      <span class="magic-emoji">${btn.emoji}</span>
      <span class="magic-title">${data.title || 'Analysis Complete'}</span>
    </div>
    <div class="magic-score-row">
      <div class="magic-score" style="color: ${toneColor}">${data.score || '??'}<span>/100</span></div>
      <div class="magic-highlight">${data.highlight || ''}</div>
    </div>
    ${sectionsHtml}
    <div class="magic-verdict">
      <div class="magic-verdict-label">THE VERDICT</div>
      <div class="magic-verdict-text">${data.verdict || 'Analysis complete.'}</div>
    </div>
    <div class="magic-footer">
      <span class="magic-next">${data.nextStep || ''}</span>
    </div>
  `;
  thread.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth' });
}

async function loadMagicButtons() {
  const result = await chrome.storage.local.get(['magicButtons']);
  magicButtons = result.magicButtons || [];
  renderMagicButtons();
}

function renderMagicButtons() {
  const container = document.getElementById('magicButtons');
  if (!container) return;
  
  container.innerHTML = magicButtons.map((btn, i) => `
    <button class="magic-btn" data-index="${i}" title="${btn.prompt}">
      ${btn.emoji} ${btn.name}
      <span class="delete-magic" data-delete="${i}">✕</span>
    </button>
  `).join('');
  
  // Separate listeners for delete buttons
  container.querySelectorAll('.delete-magic').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      deleteMagicButton(parseInt(el.dataset.delete));
    });
  });
  
  // Separate listeners for magic buttons (execute)
  container.querySelectorAll('.magic-btn').forEach(el => {
    el.addEventListener('click', (e) => {
      if (!e.target.classList.contains('delete-magic')) {
        executeMagicButton(parseInt(el.dataset.index));
      }
    });
  });
}

async function saveMagicButtons() {
  await chrome.storage.local.set({ magicButtons });
  renderMagicButtons();
}

function deleteMagicButton(index) {
  if (confirm('Delete this magic button?')) {
    magicButtons.splice(index, 1);
    saveMagicButtons();
  }
}

async function executeMagicButton(index) {
  const btn = magicButtons[index];
  if (!btn) return;
  
  if (!currentImages.length) {
    addBubble('Please capture a screenshot first!', 'ai');
    return;
  }
  
  const apiResult = await chrome.storage.sync.get(['geminiApiKey']);
  if (!apiResult.geminiApiKey) {
    addBubble('Please add your Gemini API key first.', 'ai');
    return;
  }
  
  addBubble(`${btn.emoji} Using: ${btn.name}`, 'user');
  const thinkingBubble = addBubble('✨ Magic in progress...', 'ai');
  if (navigator.vibrate) navigator.vibrate(100);
  
  try {
    const chatContext = getChatContext();
    
    // Structured prompt - CONFIDENT, NO EXCUSES, IMAGE-FOCUSED
    const magicPrompt = `ROLE: Expert analyst who gives DECISIVE, HELPFUL advice.

CRITICAL RULES:
- You have NO internet access. NEVER say "I can't search" or "I cannot browse"
- Base ALL insights purely on the image content - prices, text, ratings, visuals
- Be CONFIDENT and SPECIFIC. Extract numbers, compare values, spot patterns
- Give ACTIONABLE advice. No hedging, no excuses, no disclaimers
- If you see prices, calculate savings. If you see ratings, interpret them
- Pretend you're a helpful friend who knows everything about this topic

USER'S REQUEST: "${btn.prompt}"
${chatContext ? `CONTEXT: ${chatContext.substring(0, 150)}\n` : ''}

Analyze the image deeply. Extract every useful detail. Output ONLY valid JSON:
{"title":"Catchy 3-5 word title","tone":"gold|green|red","score":75,"highlight":"The #1 insight from the image","sections":[{"label":"What I Found","items":["Specific detail 1","Specific detail 2","Specific detail 3"]},{"label":"My Analysis","items":["Insight based on image","Value assessment"]},{"label":"Action Steps","items":["Do this first","Then do this"]}],"verdict":"Confident one-sentence recommendation","nextStep":"Specific next action"}
(tone: gold=recommended, green=okay, red=avoid)`;

    // Build parts with ALL images
    const parts = [{ text: magicPrompt }];
    currentImages.forEach(img => {
      const imageData = img.replace(/^data:image\/\w+;base64,/, '');
      parts.push({ inlineData: { mimeType: 'image/png', data: imageData } });
    });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiResult.geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { maxOutputTokens: 450, temperature: 0.7 }
        })
      }
    );
    
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Robust JSON parsing with multiple fallback attempts
    let cardData = null;
    try {
      // Clean response: remove markdown code blocks, trim whitespace
      let cleanedText = responseText.trim()
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();
      
      // Extract JSON object
      const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cardData = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.log('Magic JSON parse failed:', e.message);
      cardData = null;
    }
    
    // Update thinking bubble with result (don't remove, reuse it)
    if (cardData && cardData.title && cardData.sections) {
      // Render beautiful MAGIC CARD (replace thinking bubble)
      thinkingBubble.remove();
      renderMagicCard(cardData, btn);
    } else {
      // Fallback: show as regular markdown (clean up AI hedging)
      let cleanResponse = responseText
        .replace(/As an AI[^.]*\./gi, '')
        .replace(/I cannot (browse|search)[^.]*\./gi, '')
        .trim() || 'Analysis complete. Ask me a follow-up question!';
      thinkingBubble.innerHTML = marked.parse(cleanResponse);
      addBubbleActions(thinkingBubble, cleanResponse);
    }
    
    document.getElementById('chatThread').scrollTop = document.getElementById('chatThread').scrollHeight;
    conversationHistory.push({ role: 'user', text: `[${btn.emoji} ${btn.name}] ${btn.prompt}` });
    conversationHistory.push({ role: 'model', text: responseText });
    
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    
  } catch (error) {
    thinkingBubble.textContent = '✨ Magic failed: ' + error.message;
  }
}

// Modal Controls
document.getElementById('addMagicBtn')?.addEventListener('click', () => {
  document.getElementById('magicModal').classList.add('open');
  document.getElementById('magicName').value = '';
  document.getElementById('magicPrompt').value = '';
  document.getElementById('promptCount').textContent = '0';
  document.querySelectorAll('.emoji-option').forEach(e => e.classList.remove('selected'));
  document.querySelector('.emoji-option')?.classList.add('selected');
  document.getElementById('selectedEmoji').value = '🎯';
});

document.getElementById('closeMagicModal')?.addEventListener('click', () => {
  document.getElementById('magicModal').classList.remove('open');
});

document.getElementById('emojiPicker')?.addEventListener('click', (e) => {
  if (e.target.classList.contains('emoji-option')) {
    document.querySelectorAll('.emoji-option').forEach(el => el.classList.remove('selected'));
    e.target.classList.add('selected');
    document.getElementById('selectedEmoji').value = e.target.dataset.emoji;
  }
});

document.getElementById('magicPrompt')?.addEventListener('input', (e) => {
  document.getElementById('promptCount').textContent = e.target.value.length;
});

document.querySelectorAll('.template-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const template = btn.dataset.template;
    document.getElementById('magicPrompt').value = template;
    document.getElementById('promptCount').textContent = template.length;
  });
});

document.getElementById('saveMagicBtn')?.addEventListener('click', async () => {
  const name = document.getElementById('magicName').value.trim();
  const emoji = document.getElementById('selectedEmoji').value;
  const prompt = document.getElementById('magicPrompt').value.trim();
  
  if (!name) { alert('Please enter a button name'); return; }
  if (!prompt) { alert('Please enter instructions for the AI'); return; }
  if (magicButtons.length >= 8) { alert('Maximum 8 magic buttons allowed'); return; }
  
  magicButtons.push({ name, emoji, prompt });
  await saveMagicButtons();
  document.getElementById('magicModal').classList.remove('open');
  
  if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
  addBubble(`✨ Magic button "${emoji} ${name}" created! Click it anytime to use.`, 'ai');
});

// Load magic buttons on start
loadMagicButtons();
