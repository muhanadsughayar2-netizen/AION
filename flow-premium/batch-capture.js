let isCapturing = false;
let activePresetId = null;

document.addEventListener('DOMContentLoaded', async () => {
  updateQueueInfo();
  loadPresets();
  setupModeToggles();
  
  document.getElementById('captureBtn').addEventListener('click', startBatchCapture);
  document.getElementById('backBtn').addEventListener('click', () => window.close());
  document.getElementById('savePresetBtn').addEventListener('click', savePreset);
  
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'batchProgress') {
      updateProgress(request.current, request.total, request.status);
    } else if (request.action === 'batchComplete') {
      captureComplete(request.success, request.message);
    }
  });
});

function setupModeToggles() {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = btn.dataset.index;
      const mode = btn.dataset.mode;
      const row = btn.closest('.url-row');
      row.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activePresetId = null;
      document.querySelectorAll('.preset-btn').forEach(p => p.classList.remove('active'));
    });
  });
}

async function updateQueueInfo() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getSnaps' });
    const count = response?.length || 0;
    document.getElementById('queueInfo').textContent = `Queue: ${count}/9`;
  } catch (e) {
    console.log('Queue info error:', e);
  }
}

function getUrlConfigs() {
  const configs = [];
  const inputs = document.querySelectorAll('.url-input');
  
  inputs.forEach((input, i) => {
    let url = input.value.trim();
    if (url) {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      const row = input.closest('.url-row');
      const activeMode = row.querySelector('.mode-btn.active');
      const mode = activeMode ? activeMode.dataset.mode : 'snap';
      configs.push({ url, mode });
    }
  });
  
  return configs;
}

function setUrlConfigs(configs) {
  const inputs = document.querySelectorAll('.url-input');
  const rows = document.querySelectorAll('.url-row');
  
  inputs.forEach((input, i) => {
    if (configs[i]) {
      input.value = configs[i].url;
      const row = rows[i];
      row.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.mode === configs[i].mode) {
          btn.classList.add('active');
        }
      });
    } else {
      input.value = '';
      const row = rows[i];
      row.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.mode === 'snap') {
          btn.classList.add('active');
        }
      });
    }
  });
}

function showStatus(message, type = 'info') {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = 'status ' + type;
}

function hideStatus() {
  const status = document.getElementById('status');
  status.className = 'status';
}

function updateProgress(current, total, message) {
  const progressBar = document.getElementById('progressBar');
  const progressFill = document.getElementById('progressFill');
  
  progressBar.classList.add('visible');
  const percent = (current / total) * 100;
  progressFill.style.width = percent + '%';
  
  showStatus(message, 'info');
}

function captureComplete(success, message) {
  isCapturing = false;
  document.getElementById('captureBtn').disabled = false;
  
  const progressBar = document.getElementById('progressBar');
  progressBar.classList.remove('visible');
  
  showStatus(message, success ? 'success' : 'error');
  updateQueueInfo();
  
  if (success) {
    setTimeout(() => window.close(), 2000);
  }
}

async function loadPresets() {
  try {
    const { batchPresets = [] } = await chrome.storage.sync.get(['batchPresets']);
    renderPresets(batchPresets);
  } catch (e) {
    console.log('Load presets error:', e);
  }
}

function renderPresets(presets) {
  const list = document.getElementById('presetList');
  
  if (presets.length === 0) {
    list.innerHTML = '<span class="no-presets">No saved presets yet</span>';
    return;
  }
  
  list.innerHTML = presets.map(p => `
    <div class="preset-btn ${activePresetId === p.id ? 'active' : ''}" data-id="${p.id}">
      <span class="preset-name">${p.name}</span>
      <button class="preset-delete" data-id="${p.id}" title="Delete">×</button>
    </div>
  `).join('');
  
  list.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (e.target.classList.contains('preset-delete')) return;
      loadPreset(btn.dataset.id);
    });
  });
  
  list.querySelectorAll('.preset-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deletePreset(btn.dataset.id);
    });
  });
}

async function loadPreset(id) {
  try {
    const { batchPresets = [] } = await chrome.storage.sync.get(['batchPresets']);
    const preset = batchPresets.find(p => p.id === id);
    if (preset) {
      setUrlConfigs(preset.items);
      document.getElementById('presetName').value = preset.name;
      activePresetId = id;
      document.querySelectorAll('.preset-btn').forEach(p => {
        p.classList.toggle('active', p.dataset.id === id);
      });
      showStatus(`Loaded: ${preset.name}`, 'success');
      setTimeout(hideStatus, 1500);
    }
  } catch (e) {
    console.log('Load preset error:', e);
  }
}

async function savePreset() {
  const name = document.getElementById('presetName').value.trim();
  if (!name) {
    showStatus('Enter a preset name', 'error');
    return;
  }
  
  const items = getUrlConfigs();
  if (items.length === 0) {
    showStatus('Enter at least one URL', 'error');
    return;
  }
  
  try {
    const { batchPresets = [] } = await chrome.storage.sync.get(['batchPresets']);
    
    if (activePresetId) {
      const idx = batchPresets.findIndex(p => p.id === activePresetId);
      if (idx >= 0) {
        batchPresets[idx] = { ...batchPresets[idx], name, items };
      }
    } else {
      if (batchPresets.length >= 10) {
        showStatus('Max 10 presets. Delete one first.', 'error');
        return;
      }
      const newPreset = {
        id: Date.now().toString(),
        name,
        items,
        createdAt: Date.now()
      };
      batchPresets.push(newPreset);
      activePresetId = newPreset.id;
    }
    
    await chrome.storage.sync.set({ batchPresets });
    renderPresets(batchPresets);
    showStatus(`Saved: ${name}`, 'success');
    setTimeout(hideStatus, 1500);
  } catch (e) {
    showStatus('Save failed: ' + e.message, 'error');
  }
}

async function deletePreset(id) {
  try {
    const { batchPresets = [] } = await chrome.storage.sync.get(['batchPresets']);
    const filtered = batchPresets.filter(p => p.id !== id);
    await chrome.storage.sync.set({ batchPresets: filtered });
    
    if (activePresetId === id) {
      activePresetId = null;
    }
    
    renderPresets(filtered);
    showStatus('Preset deleted', 'success');
    setTimeout(hideStatus, 1500);
  } catch (e) {
    showStatus('Delete failed: ' + e.message, 'error');
  }
}

async function startBatchCapture() {
  if (isCapturing) return;
  
  const configs = getUrlConfigs();
  
  if (configs.length === 0) {
    showStatus('Enter at least one URL', 'error');
    return;
  }
  
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getSnaps' });
    const currentCount = response?.length || 0;
    const neededSlots = configs.length;
    const availableSlots = 9 - currentCount;
    
    if (neededSlots > availableSlots) {
      showStatus(`Need ${neededSlots} slots but only ${availableSlots} available`, 'error');
      return;
    }
  } catch (e) {
    console.log('Queue check error:', e);
  }
  
  isCapturing = true;
  document.getElementById('captureBtn').disabled = true;
  showStatus('Starting batch capture...', 'info');
  
  try {
    await chrome.runtime.sendMessage({
      action: 'startBatchCapture',
      urlConfigs: configs
    });
  } catch (e) {
    captureComplete(false, 'Failed to start: ' + e.message);
  }
}
