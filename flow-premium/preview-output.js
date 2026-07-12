let _code = '';
let _codeVisible = false;
let _blobUrl = null;

function hideLoader() {
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  setTimeout(() => { overlay.style.display = 'none'; }, 320);
}

// Fix generated HTML before preview:
// 1. Remove opacity:0 from .reveal rules — prevents blank pages when JS is slow
// 2. Inject a safety script that forces all .reveal elements visible after 600ms
function sanitizeForPreview(code) {
  const fixed = code.replace(
    /(<style[\s\S]*?>)([\s\S]*?)(<\/style>)/gi,
    (match, open, css, close) => {
      const safeCss = css.replace(
        /((?:^|[{}])\s*\.reveal\s*\{[^}]*?)opacity\s*:\s*0\s*;?/g,
        '$1'
      );
      return open + safeCss + close;
    }
  );

  const safetyScript = `\n<script>
(function(){
  function forceReveal(){
    document.querySelectorAll('.reveal').forEach(function(el){
      el.style.opacity='1';
      el.style.transform='none';
      el.classList.add('visible');
    });
  }
  if(window.IntersectionObserver){
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(e.isIntersecting){
          e.target.classList.add('visible');
          e.target.style.opacity='1';
          e.target.style.transform='none';
          io.unobserve(e.target);
        }
      });
    },{threshold:0.05,rootMargin:'0px 0px -20px 0px'});
    document.querySelectorAll('.reveal').forEach(function(el){io.observe(el);});
  }
  setTimeout(forceReveal,600);
  setTimeout(forceReveal,2000);
})();
<\/script>`;

  const bodyIdx = fixed.toLowerCase().lastIndexOf('</body>');
  if (bodyIdx !== -1) {
    return fixed.slice(0, bodyIdx) + safetyScript + '\n' + fixed.slice(bodyIdx);
  }
  return fixed + safetyScript;
}

// Load the site into the iframe via a blob URL.
// This is the same approach as "Open Standalone" and is the ONLY reliable
// method — the previous sandbox.html+postMessage approach had a fatal timing
// bug where Tailwind CDN initialised before the generated tailwind.config was
// injected, so all custom utility classes (bg-brand-black, text-accent, etc.)
// produced no CSS and the page appeared blank.
function loadPreview(code) {
  const frame = document.getElementById('previewFrame');
  if (!frame) return;

  const safeCode = sanitizeForPreview(code);

  // Revoke the previous blob URL so the browser can garbage-collect it
  if (_blobUrl) { try { URL.revokeObjectURL(_blobUrl); } catch (_) {} }

  const blob = new Blob([safeCode], { type: 'text/html' });
  _blobUrl = URL.createObjectURL(blob);
  frame.src = _blobUrl;
}

chrome.storage.local.get('snaptoai_built_code', (res) => {
  const code = res.snaptoai_built_code || '';
  if (!code) {
    hideLoader();
    document.getElementById('previewFrame').style.display = 'none';
    document.getElementById('emptyState').style.display = 'flex';
    document.getElementById('titleSub').textContent = '— nothing built yet';
    return;
  }
  _code = code;
  document.getElementById('titleSub').textContent = '— ready';
  document.getElementById('codePre').textContent = code;
  loadPreview(code);
  hideLoader();
});

document.getElementById('copyBtn').addEventListener('click', () => {
  if (!_code) return;
  navigator.clipboard.writeText(_code).then(() => {
    const btn = document.getElementById('copyBtn');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy Code'; }, 1800);
  });
});

document.getElementById('downloadBtn').addEventListener('click', () => {
  if (!_code) return;
  const blob = new Blob([_code], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'my-site.html';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  const btn = document.getElementById('downloadBtn');
  btn.textContent = '✓ Downloaded!';
  setTimeout(() => { btn.textContent = '⬇ Download Site'; }, 2000);
});

document.getElementById('newTabBtn').addEventListener('click', () => {
  if (!_code) return;
  const blob = new Blob([_code], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url });
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
  }
});

document.getElementById('codeViewBtn').addEventListener('click', () => {
  _codeVisible = !_codeVisible;
  document.getElementById('codePanel').style.display = _codeVisible ? 'block' : 'none';
  document.getElementById('previewFrame').style.display = _codeVisible ? 'none' : 'block';
  document.getElementById('codeViewBtn').textContent = _codeVisible ? '👁 View Preview' : '📄 View Code';
});
