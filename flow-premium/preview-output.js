let _code = '';
let _codeVisible = false;
let _previewBlobUrl = null;

function loadPreview(code) {
  // Revoke any previous blob to avoid memory leaks
  if (_previewBlobUrl) {
    URL.revokeObjectURL(_previewBlobUrl);
    _previewBlobUrl = null;
  }
  // Use a blob URL as iframe src instead of srcdoc.
  // This runs the built HTML outside the extension's CSP context so
  // Google Fonts and inline scripts work correctly.
  const blob = new Blob([code], { type: 'text/html' });
  _previewBlobUrl = URL.createObjectURL(blob);
  document.getElementById('previewFrame').src = _previewBlobUrl;
}

chrome.storage.local.get('snaptoai_built_code', (res) => {
  const code = res.snaptoai_built_code || '';
  if (!code) {
    document.getElementById('previewFrame').style.display = 'none';
    document.getElementById('emptyState').style.display = 'flex';
    document.getElementById('titleSub').textContent = '— nothing built yet';
    return;
  }
  _code = code;
  document.getElementById('titleSub').textContent = '— ready';
  document.getElementById('codePre').textContent = code;
  loadPreview(code);
});

document.getElementById('copyBtn').addEventListener('click', () => {
  if (!_code) return;
  navigator.clipboard.writeText(_code).then(() => {
    const btn = document.getElementById('copyBtn');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy Code'; }, 1800);
  });
});

document.getElementById('newTabBtn').addEventListener('click', () => {
  if (!_code) return;
  const blob = new Blob([_code], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
});

document.getElementById('codeViewBtn').addEventListener('click', () => {
  _codeVisible = !_codeVisible;
  document.getElementById('codePanel').style.display = _codeVisible ? 'block' : 'none';
  document.getElementById('previewFrame').style.display = _codeVisible ? 'none' : 'block';
  document.getElementById('codeViewBtn').textContent = _codeVisible ? '👁 View Preview' : '📄 View Code';
});
