let selectedMode = 'snap';
let isCapturing = false;

document.addEventListener('DOMContentLoaded', async () => {
  updateQueueInfo();
  
  document.querySelectorAll('.option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedMode = btn.dataset.mode;
    });
  });
  
  document.getElementById('goBtn').addEventListener('click', startBatchCapture);
  document.getElementById('backBtn').addEventListener('click', () => window.close());
  
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'batchProgress') {
      updateProgress(request.current, request.total, request.status);
    } else if (request.action === 'batchComplete') {
      captureComplete(request.success, request.message);
    }
  });
});

async function updateQueueInfo() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getSnaps' });
    const count = response?.length || 0;
    document.getElementById('queueInfo').textContent = `Queue: ${count}/9`;
  } catch (e) {
    console.log('Queue info error:', e);
  }
}

function getUrls() {
  const urls = [];
  for (let i = 1; i <= 5; i++) {
    const input = document.getElementById(`url${i}`);
    const url = input.value.trim();
    if (url) {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        urls.push('https://' + url);
      } else {
        urls.push(url);
      }
    }
  }
  return urls;
}

function showStatus(message, type = '') {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = 'status visible ' + type;
}

function updateProgress(current, total, message) {
  const progressBar = document.getElementById('progressBar');
  const progressFill = document.getElementById('progressFill');
  
  progressBar.classList.add('visible');
  const percent = (current / total) * 100;
  progressFill.style.width = percent + '%';
  
  showStatus(message);
}

function captureComplete(success, message) {
  isCapturing = false;
  document.getElementById('goBtn').disabled = false;
  
  const progressBar = document.getElementById('progressBar');
  progressBar.classList.remove('visible');
  
  showStatus(message, success ? 'success' : 'error');
  updateQueueInfo();
  
  if (success) {
    setTimeout(() => window.close(), 2000);
  }
}

async function startBatchCapture() {
  if (isCapturing) return;
  
  const urls = getUrls();
  
  if (urls.length === 0) {
    showStatus('Please enter at least one URL', 'error');
    return;
  }
  
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getSnaps' });
    const currentCount = response?.length || 0;
    
    let neededSlots = urls.length;
    if (selectedMode === 'both') {
      neededSlots = urls.length * 2;
    }
    
    const availableSlots = 9 - currentCount;
    if (neededSlots > availableSlots) {
      showStatus(`Need ${neededSlots} slots but only ${availableSlots} available. Clear queue first.`, 'error');
      return;
    }
  } catch (e) {
    console.log('Queue check error:', e);
  }
  
  isCapturing = true;
  document.getElementById('goBtn').disabled = true;
  showStatus('Starting batch capture...');
  
  try {
    await chrome.runtime.sendMessage({
      action: 'startBatchCapture',
      urls: urls,
      mode: selectedMode
    });
  } catch (e) {
    captureComplete(false, 'Failed to start capture: ' + e.message);
  }
}
