let _code = '';
let _codeVisible = false;

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
  document.getElementById('previewFrame').srcdoc = code;
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
