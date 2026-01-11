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
  
  const systemPrompt = `You are a simple data gathering assistant. Your job is to navigate to pages and trigger SnapToAI's capture buttons.

Available actions:
- navigate: Go to a URL
- click: Click an element on the page (provide text to find)
- type: Type text into a field (provide selector and text)
- wait: Wait for page to load (provide seconds)
- snap: Take a viewport screenshot using SnapToAI's SNAP button
- fullpage: Take a full page screenshot using SnapToAI's FULL PAGE button
- scroll: Scroll the page (up, down, top, bottom)

Respond ONLY with a valid JSON object in this exact format:
{
  "steps": [
    {"action": "navigate", "url": "https://example.com", "description": "Go to website"},
    {"action": "wait", "seconds": 3, "description": "Wait for page to load"},
    {"action": "snap", "description": "Take a screenshot"}
  ],
  "summary": "Brief description of what this does"
}

RULES:
1. Always start with navigate to go to the URL
2. Always add a wait (2-3 seconds) after navigation for page to load
3. Use "snap" for quick viewport captures, "fullpage" for entire page captures
4. If user says "screenshot" or "snap", use the snap action
5. If user says "full page" or "capture whole page", use the fullpage action
6. For clicking buttons like "1y", "Max", use: {"action": "click", "text": "1y"}
7. Keep it simple - navigate, wait, capture. That's the core workflow.`;

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
        case 'snap':
          // SNAP: Capture viewport and add to queue
          addMessage(`📸 Triggering SNAP...`, 'system');
          
          // First check if queue has space
          const snapQueueCheck = await new Promise((resolve) => {
            chrome.storage.session.get(['snaps'], (result) => {
              resolve((result.snaps || []).length);
            });
          });
          
          if (snapQueueCheck >= 10) {
            addMessage(`⚠️ Queue full (10/10). Delete some images first.`, 'system');
            break;
          }
          
          // Make target tab active and focused
          await chrome.tabs.update(targetTabId, { active: true });
          await sleep(1000);
          
          // Capture the tab using agentCaptureTab (reliable tabId-based capture)
          const snapImageData = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ 
              action: 'agentCaptureTab',
              tabId: targetTabId 
            }, (response) => {
              resolve(response?.success ? response.dataUrl : null);
            });
          });
          
          if (snapImageData) {
            // Add to snap queue via agentAddSnaps
            await new Promise((resolve) => {
              chrome.runtime.sendMessage({ 
                action: 'agentAddSnaps',
                images: [snapImageData]
              }, resolve);
            });
            capturedImages.push('SNAP_CAPTURED');
            addMessage(`✅ SNAP captured! Added to queue.`, 'system');
          } else {
            addMessage(`⚠️ SNAP failed. Page may have restrictions.`, 'system');
          }
          break;
          
        case 'fullpage':
          // FULL PAGE: Use the agent full page capture
          addMessage(`📜 Triggering FULL PAGE capture...`, 'system');
          
          // Get current snap count to detect when full page is added
          const beforeCount = await new Promise((resolve) => {
            chrome.storage.session.get(['snaps'], (result) => {
              resolve((result.snaps || []).length);
            });
          });
          
          // Trigger full page capture for the specific tab (includes window focusing)
          const fullpageResult = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ 
              action: 'agentFullPageCapture',
              tabId: targetTabId 
            }, resolve);
          });
          
          if (fullpageResult?.success) {
            addMessage(`⏳ Full page capture in progress... please wait while page scrolls...`, 'system');
            
            // Poll for completion (max 90 seconds for long pages)
            let captured = false;
            for (let i = 0; i < 90 && !captured; i++) {
              await sleep(1000);
              const currentCount = await new Promise((resolve) => {
                chrome.storage.session.get(['snaps'], (result) => {
                  resolve((result.snaps || []).length);
                });
              });
              if (currentCount > beforeCount) {
                captured = true;
              }
            }
            
            if (captured) {
              capturedImages.push('FULLPAGE_CAPTURED');
              addMessage(`✅ FULL PAGE captured! Added to queue.`, 'system');
            } else {
              addMessage(`⚠️ FULL PAGE timed out. Try using SNAP instead.`, 'system');
            }
          } else {
            // Show specific error (queue full, already in progress, etc.)
            const errorMsg = fullpageResult?.error || 'Not available on this page';
            addMessage(`⚠️ FULL PAGE: ${errorMsg}`, 'system');
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
    
    // Count captures (they're already in the queue via SnapToAI buttons)
    const snapCount = capturedImages.filter(img => img === 'SNAP_CAPTURED').length;
    const fullpageCount = capturedImages.filter(img => img === 'FULLPAGE_CAPTURED').length;
    const totalCaptures = snapCount + fullpageCount;
    
    if (totalCaptures > 0) {
      addMessage(`🎉 Done! Captured ${totalCaptures} screenshot${totalCaptures !== 1 ? 's' : ''} (${snapCount} SNAP, ${fullpageCount} FULL PAGE). Check your SnapToAI queue!`, 'agent');
      addActionButtons();
    } else {
      addMessage(`✅ Automation complete! No captures were requested.`, 'agent');
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
