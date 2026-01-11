// SnapToAI Agent Chat - Autonomous Web Automation
// Allows users to describe tasks in natural language, AI plans steps, then executes them

const GEMINI_API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

let isAgentRunning = false;
let currentSteps = [];
let capturedImages = [];
let abortController = null;

// DOM Elements
const chatContainer = document.getElementById('chatContainer');
const welcomeMessage = document.getElementById('welcomeMessage');
const inputField = document.getElementById('inputField');
const sendBtn = document.getElementById('sendBtn');
const closeBtn = document.getElementById('closeBtn');
const quickActions = document.getElementById('quickActions');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  inputField.focus();
});

function setupEventListeners() {
  // Send button
  sendBtn.addEventListener('click', handleSend);
  
  // Enter to send (Shift+Enter for new line)
  inputField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
  
  // Auto-resize textarea
  inputField.addEventListener('input', () => {
    inputField.style.height = 'auto';
    inputField.style.height = Math.min(inputField.scrollHeight, 120) + 'px';
  });
  
  // Close button
  closeBtn.addEventListener('click', () => window.close());
  
  // Example prompts
  document.querySelectorAll('.example-prompt').forEach(el => {
    el.addEventListener('click', () => {
      inputField.value = el.dataset.prompt;
      inputField.focus();
    });
  });
  
  // Quick actions
  document.querySelectorAll('.quick-action').forEach(el => {
    el.addEventListener('click', () => handleQuickAction(el.dataset.action));
  });
}

async function handleSend() {
  const message = inputField.value.trim();
  if (!message || isAgentRunning) return;
  
  // Hide welcome message
  if (welcomeMessage) {
    welcomeMessage.style.display = 'none';
  }
  
  // Add user message
  addMessage(message, 'user');
  inputField.value = '';
  inputField.style.height = 'auto';
  
  // Disable input while processing
  setInputEnabled(false);
  
  try {
    // Step 1: Ask Gemini to plan the steps
    addMessage('🤔 Planning automation steps...', 'system');
    const plan = await planWithGemini(message);
    
    if (!plan || !plan.steps || plan.steps.length === 0) {
      addMessage('I couldn\'t understand that request. Please try being more specific about which website to visit and what to capture.', 'agent');
      setInputEnabled(true);
      return;
    }
    
    // Show the plan
    addMessage(`📋 I'll execute ${plan.steps.length} steps:\n${plan.steps.map((s, i) => `${i + 1}. ${s.description}`).join('\n')}`, 'agent');
    
    // Step 2: Execute the plan
    await executePlan(plan);
    
  } catch (error) {
    console.error('Agent error:', error);
    addMessage(`❌ Error: ${error.message}`, 'error');
  }
  
  setInputEnabled(true);
}

async function planWithGemini(userRequest) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('API key not found. Please open SnapToAI popup → Settings → add your Gemini API key, then try again.');
  }
  
  const systemPrompt = `You are an automation planning AI. The user will describe what data they want to gather from websites. Your job is to create a step-by-step plan that a browser automation script can execute.

Available actions:
- navigate: Go to a URL
- click: Click an element (provide CSS selector or text content)
- type: Type text into a field (provide selector and text)
- wait: Wait for something to load (provide seconds or selector)
- screenshot: Capture a screenshot. Set "fullPage": true for a complete page stitch (highly recommended for charts).
- scroll: Scroll the page (up, down, or to element)

Respond ONLY with a valid JSON object in this exact format:
{
  "steps": [
    {"action": "navigate", "url": "https://example.com", "description": "Go to Example website"},
    {"action": "wait", "seconds": 2, "description": "Wait for page to load"},
    {"action": "click", "selector": "button.search", "text": "Search", "description": "Click search button"},
    {"action": "type", "selector": "input#search", "text": "AAPL", "description": "Type search term"},
    {"action": "wait", "seconds": 2, "description": "Wait for results"},
    {"action": "screenshot", "fullPage": true, "description": "Capture results"}
  ],
  "summary": "Brief description of what this automation does"
}

Important rules:
1. Always start with a navigate action to go to the website
2. Add wait actions after navigation and clicks to let content load
3. Use specific, common CSS selectors or descriptive text for clicks
4. End with screenshot actions to capture the desired data. Use "fullPage": true if the content might be long.
5. Keep it simple - aim for fewer, reliable steps
6. For TradingView, Yahoo Finance, CoinGecko - use their public URLs
7. If the user mentions a stock ticker, search for it on the site
8. For technical indicators (like Moving Averages), you MUST click the "Indicators" or "Studies" menu, type the name, and select the first result.
9. For search boxes that might use custom selectors, try clicking on the search icon or search area first before typing.`;

  const response = await fetch(`${GEMINI_API_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: systemPrompt },
          { text: `User request: ${userRequest}\n\nRespond with ONLY the JSON plan, no markdown or explanation.` }
        ]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2000
      }
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to plan with AI');
  }
  
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  
  // Extract JSON from response - try multiple approaches
  let parsed = null;
  
  // Approach 1: Look for JSON code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      parsed = JSON.parse(codeBlockMatch[1].trim());
    } catch (e) {
      console.log('Code block JSON parse failed, trying other methods');
    }
  }
  
  // Approach 2: Look for raw JSON object
  if (!parsed) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.log('Raw JSON parse failed');
      }
    }
  }
  
  // Approach 3: Try the whole text
  if (!parsed) {
    try {
      parsed = JSON.parse(text.trim());
    } catch (e) {
      console.log('Full text JSON parse failed');
    }
  }
  
  if (!parsed || !parsed.steps) {
    console.error('Could not parse AI response:', text.substring(0, 500));
    throw new Error('Could not understand the AI response. Please try rephrasing your request.');
  }
  
  return parsed;
}

// Ask Gemini for an alternative approach when a step fails
async function askGeminiForFix(originalPlan, errorMessage, tabId) {
  const apiKey = await getApiKey();
  if (!apiKey) return null;
  
  addMessage('🔍 Analyzing what went wrong...', 'system');
  
  const retryPrompt = `The automation failed with this error: "${errorMessage}"

Original plan was:
${JSON.stringify(originalPlan, null, 2)}

Please provide an ALTERNATIVE plan that avoids this error. Common fixes:
- For "Input not found": Use different selectors or try clicking the search icon first
- For "Element not found": Use text-based matching instead of CSS selectors
- Try simpler, more universal approaches

Respond with ONLY a valid JSON object with the same format (steps array + summary).
Focus on completing the user's original goal with a different approach.`;

  try {
    const response = await fetch(`${GEMINI_API_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: retryPrompt }]
        }],
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 2000
        }
      })
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Extract JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.steps && parsed.steps.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Retry prompt failed:', e);
  }
  
  return null;
}

async function executePlan(plan, retryCount = 0) {
  isAgentRunning = true;
  currentSteps = plan.steps;
  capturedImages = [];
  abortController = new AbortController();
  
  // Create progress UI
  const progressEl = createProgressUI(plan.steps);
  chatContainer.appendChild(progressEl);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  
  let targetTabId = null;
  const MAX_RETRIES = 2;
  
  try {
    for (let i = 0; i < plan.steps.length; i++) {
      if (abortController.signal.aborted) {
        throw new Error('Automation stopped by user');
      }
      
      const step = plan.steps[i];
      updateStepStatus(progressEl, i, 'active');
      
      // Show what we're doing
      addMessage(`🔄 Step ${i + 1}: ${step.description}...`, 'system');
      
      switch (step.action) {
        case 'navigate':
          // Create new tab or navigate existing one
          if (!targetTabId) {
            const tab = await chrome.tabs.create({ url: step.url, active: true });
            targetTabId = tab.id;
            await waitForTabLoad(targetTabId);
          } else {
            await chrome.tabs.update(targetTabId, { url: step.url });
            await waitForTabLoad(targetTabId);
          }
          break;
          
        case 'wait':
          if (step.seconds) {
            await sleep(step.seconds * 1000);
          } else if (step.selector) {
            await waitForElement(targetTabId, step.selector);
          }
          break;
          
        case 'click':
          await executeInTab(targetTabId, 'click', { selector: step.selector, text: step.text });
          await sleep(500); // Brief pause after click
          break;
          
        case 'type':
          await executeInTab(targetTabId, 'type', { selector: step.selector, text: step.text });
          break;
          
        case 'scroll':
          await executeInTab(targetTabId, 'scroll', { direction: step.direction, selector: step.selector });
          await sleep(300);
          break;
          
        case 'screenshot':
          let imageData;
          if (step.fullPage) {
            // Trigger full page capture via background script
            imageData = await new Promise((resolve) => {
              chrome.runtime.sendMessage({ 
                action: 'startFullPageCapture',
                tabId: targetTabId 
              }, (response) => {
                // Background script adds to queue directly, but we need preview
                resolve(response?.dataUrl || null);
              });
            });
          } else {
            imageData = await captureTab(targetTabId);
          }
          
          if (imageData) {
            capturedImages.push(imageData);
            addCaptureThumb(progressEl, imageData);
          }
          break;
      }
      
      updateStepStatus(progressEl, i, 'completed');
      await sleep(300); // Brief pause between steps
    }
    
    // Hide ghost cursor (only if we have a valid tab)
    if (targetTabId) {
      try {
        await executeInTab(targetTabId, 'hideGhostCursor', {});
      } catch (e) {}
    }
    
    // Success celebration with confetti!
    celebrateSuccess();
    addMessage(`🎉 Done! Captured ${capturedImages.length} screenshot${capturedImages.length !== 1 ? 's' : ''}. Your snaps are ready for AI analysis!`, 'agent');
    
    // Add captured images to snap queue
    if (capturedImages.length > 0) {
      await addToSnapQueue(capturedImages);
      addActionButtons();
    }
    
  } catch (error) {
    // Hide ghost cursor on error too
    if (targetTabId) {
      try {
        await executeInTab(targetTabId, 'hideGhostCursor', {});
      } catch (e) {}
    }
    
    // Mark current step as failed
    const activeStep = progressEl.querySelector('.step-item.active');
    if (activeStep) {
      activeStep.classList.remove('active');
      activeStep.classList.add('failed');
      activeStep.querySelector('.step-icon').textContent = '✗';
    }
    
    // Try to recover with AI retry
    if (retryCount < MAX_RETRIES && !error.message.includes('stopped by user')) {
      addMessage(`⚠️ Step failed: ${error.message}`, 'system');
      addMessage(`🤖 Let me try a different approach...`, 'agent');
      
      try {
        const fixedPlan = await askGeminiForFix(plan, error.message, targetTabId);
        if (fixedPlan && fixedPlan.steps && fixedPlan.steps.length > 0) {
          addMessage(`💡 Found alternative: ${fixedPlan.summary || 'Retrying with different selectors'}`, 'agent');
          isAgentRunning = false;
          abortController = null;
          return executePlan(fixedPlan, retryCount + 1);
        }
      } catch (retryError) {
        console.error('Retry failed:', retryError);
      }
    }
    
    // If we get here, we've exhausted retries
    addMessage(`❌ Automation failed: ${error.message}`, 'error');
    addMessage(`💬 Tip: Try being more specific, like "search for offers on Amazon.com" or describe what you see on screen.`, 'agent');
  } finally {
    isAgentRunning = false;
    abortController = null;
  }
}

function createProgressUI(steps) {
  const div = document.createElement('div');
  div.className = 'progress-container';
  div.innerHTML = `
    <div class="progress-title">
      <div class="spinner"></div>
      <span>Executing automation...</span>
    </div>
    <ul class="step-list">
      ${steps.map((step, i) => `
        <li class="step-item" data-index="${i}">
          <span class="step-icon">${i + 1}</span>
          <span>${step.description}</span>
        </li>
      `).join('')}
    </ul>
    <div class="captures-preview"></div>
  `;
  return div;
}

function updateStepStatus(progressEl, index, status) {
  const stepItem = progressEl.querySelector(`.step-item[data-index="${index}"]`);
  if (!stepItem) return;
  
  stepItem.classList.remove('active', 'completed', 'failed');
  stepItem.classList.add(status);
  
  const icon = stepItem.querySelector('.step-icon');
  if (status === 'completed') {
    icon.textContent = '✓';
  } else if (status === 'failed') {
    icon.textContent = '✗';
  }
  
  // Update progress title if all done
  if (status === 'completed' && index === currentSteps.length - 1) {
    const title = progressEl.querySelector('.progress-title');
    title.innerHTML = '<span>✅ Automation complete!</span>';
  }
}

let confettiStyleInjected = false;

function celebrateSuccess() {
  // Add confetti animation style once
  if (!confettiStyleInjected) {
    const style = document.createElement('style');
    style.id = 'confetti-style';
    style.textContent = `
      @keyframes confettiFall {
        0% { transform: translateY(0) rotate(0deg); opacity: 1; }
        100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
      }
      .snaptoai-confetti {
        position: fixed;
        pointer-events: none;
        z-index: 10000;
      }
    `;
    document.head.appendChild(style);
    confettiStyleInjected = true;
  }
  
  // Create container for confetti
  const container = document.createElement('div');
  container.className = 'snaptoai-confetti-container';
  document.body.appendChild(container);
  
  const colors = ['#8a2be2', '#9945ff', '#00d4ff', '#ff6b9d', '#ffd93d'];
  const confettiCount = 40;
  
  for (let i = 0; i < confettiCount; i++) {
    const confetti = document.createElement('div');
    confetti.className = 'snaptoai-confetti';
    const size = Math.random() * 8 + 4;
    const duration = Math.random() * 2 + 2;
    confetti.style.cssText = `
      width: ${size}px;
      height: ${size}px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      left: ${Math.random() * 100}%;
      top: -20px;
      border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
      animation: confettiFall ${duration}s ease-out forwards;
      transform: rotate(${Math.random() * 360}deg);
    `;
    container.appendChild(confetti);
  }
  
  // Clean up entire container after animation
  setTimeout(() => container.remove(), 4500);
}

function addCaptureThumb(progressEl, imageData) {
  const preview = progressEl.querySelector('.captures-preview');
  const img = document.createElement('img');
  img.className = 'capture-thumb';
  img.src = imageData;
  preview.appendChild(img);
}

function addActionButtons() {
  const div = document.createElement('div');
  div.className = 'action-buttons';
  div.innerHTML = `
    <button class="action-btn secondary" id="viewCapturesBtn">👁 View Captures</button>
    <button class="action-btn primary" id="analyzeBtn">✨ Analyze with AI</button>
  `;
  chatContainer.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  
  document.getElementById('viewCapturesBtn').addEventListener('click', () => {
    // Open popup to show captures
    window.close();
  });
  
  document.getElementById('analyzeBtn').addEventListener('click', () => {
    // Open AI chat with captures ready
    chrome.tabs.create({ url: chrome.runtime.getURL('ai-chat.html') });
    window.close();
  });
}

// Execute action in target tab via background script relay
async function executeInTab(tabId, action, params) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ 
      action: 'agentExecute',
      tabId,
      executeAction: action,
      params 
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.success) {
        resolve(response);
      } else {
        reject(new Error(response?.error || `Failed to ${action}`));
      }
    });
  });
}

// Wait for element to appear in tab
async function waitForElement(tabId, selector, timeout = 10000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const result = await executeInTab(tabId, 'checkElement', { selector });
      if (result.found) return true;
    } catch (e) {
      // Element not found yet
    }
    await sleep(500);
  }
  throw new Error(`Timeout waiting for element: ${selector}`);
}

// Wait for tab to finish loading
function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const checkTab = () => {
      chrome.tabs.get(tabId, (tab) => {
        if (tab.status === 'complete') {
          // Extra delay for dynamic content
          setTimeout(resolve, 1500);
        } else {
          setTimeout(checkTab, 200);
        }
      });
    };
    checkTab();
  });
}

// Capture screenshot of tab via background script
async function captureTab(tabId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ 
      action: 'agentCaptureTab',
      tabId 
    }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        console.error('Capture error:', chrome.runtime.lastError || response?.error);
        resolve(null);
      } else {
        resolve(response.dataUrl);
      }
    });
  });
}

// Add captures to snap queue via background script
async function addToSnapQueue(images) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ 
      action: 'agentAddSnaps',
      images 
    }, (response) => {
      console.log('[Agent] Added snaps to queue:', response?.count || 0);
      resolve();
    });
  });
}

// Get API key from storage
async function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['geminiApiKey'], (result) => {
      resolve(result.geminiApiKey || null);
    });
  });
}

// UI helpers
function addMessage(text, type) {
  const div = document.createElement('div');
  div.className = `message ${type}`;
  div.textContent = text;
  chatContainer.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function setInputEnabled(enabled) {
  inputField.disabled = !enabled;
  sendBtn.disabled = !enabled;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function handleQuickAction(action) {
  switch (action) {
    case 'stop':
      if (abortController) {
        abortController.abort();
        addMessage('⏹ Automation stopped.', 'system');
      }
      break;
    case 'retry':
      // Re-run the last plan
      if (currentSteps.length > 0) {
        executePlan({ steps: currentSteps });
      }
      break;
    case 'analyze':
      if (capturedImages.length > 0) {
        chrome.tabs.create({ url: chrome.runtime.getURL('ai-chat.html') });
        window.close();
      } else {
        addMessage('No captures yet. Run an automation first.', 'system');
      }
      break;
  }
}
