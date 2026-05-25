let _code = '';
let _codeVisible = false;
let _previewBlobUrl = null;

// Fix generated HTML before preview:
// 1. Remove opacity:0 from .reveal rules — prevents blank pages when JS is slow
// 2. Inject a safety script that forces all .reveal elements visible after 600ms
function sanitizeForPreview(code) {
  // Step 1: strip opacity:0 from .reveal rules — but ONLY inside <style> blocks
  // so we never accidentally mutate JS strings, comments, or multi-selector rules
  // that happen to contain ".reveal { opacity:0 }" as text.
  const fixed = code.replace(
    /(<style[\s\S]*?>)([\s\S]*?)(<\/style>)/gi,
    (match, open, css, close) => {
      // Within this style block, remove opacity:0/opacity: 0 only from rules
      // whose selector is SOLELY .reveal (not ".foo, .reveal" etc.)
      const safeCss = css.replace(
        /((?:^|[{}])\s*\.reveal\s*\{[^}]*?)opacity\s*:\s*0\s*;?/g,
        '$1'
      );
      return open + safeCss + close;
    }
  );

  // Step 2: safety script — forces all .reveal elements visible at 600ms + 2s.
  // Runs IntersectionObserver first for smooth animation, then falls back hard.
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

  // Inject before the LAST </body> in the document (avoids false matches in
  // inline JS strings that happen to contain the text "</body>").
  const bodyIdx = fixed.toLowerCase().lastIndexOf('</body>');
  if (bodyIdx !== -1) {
    return fixed.slice(0, bodyIdx) + safetyScript + '\n' + fixed.slice(bodyIdx);
  }
  return fixed + safetyScript;
}

function loadPreview(code) {
  // Revoke any previous blob to avoid memory leaks
  if (_previewBlobUrl) {
    URL.revokeObjectURL(_previewBlobUrl);
    _previewBlobUrl = null;
  }
  // Sanitize first — fixes opacity:0 blank-page bug in generated HTML
  const safeCode = sanitizeForPreview(code);
  // Use a blob URL as iframe src instead of srcdoc.
  // This runs the built HTML outside the extension's CSP context so
  // Google Fonts and inline scripts work correctly.
  const blob = new Blob([safeCode], { type: 'text/html' });
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
  window.open(url, '_blank');
});

document.getElementById('codeViewBtn').addEventListener('click', () => {
  _codeVisible = !_codeVisible;
  document.getElementById('codePanel').style.display = _codeVisible ? 'block' : 'none';
  document.getElementById('previewFrame').style.display = _codeVisible ? 'none' : 'block';
  document.getElementById('codeViewBtn').textContent = _codeVisible ? '👁 View Preview' : '📄 View Code';
});
