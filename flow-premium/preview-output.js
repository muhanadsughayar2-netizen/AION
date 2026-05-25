let _code = '';
let _codeVisible = false;
let _previewBlobUrl = null;

// Fix generated HTML before preview:
// 1. Remove opacity:0 from .reveal rules — prevents blank pages when JS is slow
// 2. Inject a safety script that forces all .reveal elements visible after 600ms
function sanitizeForPreview(code) {
  // Step 1: strip opacity:0 / opacity: 0 from any .reveal CSS rule
  // Handles both `.reveal { ... opacity:0; ... }` and `.reveal { opacity: 0; ... }`
  let fixed = code.replace(
    /(\.reveal\s*\{[^}]*?)opacity\s*:\s*0\s*;?([^}]*?\})/g,
    '$1$2'
  );

  // Step 2: inject a safety script before </body> that:
  //   a) triggers IntersectionObserver on any .reveal elements (correct pattern)
  //   b) hard-forces opacity:1 after 600ms as a failsafe
  const safetyScript = `
<script>
(function(){
  // Ensure .reveal elements are never permanently invisible
  function forceReveal(){
    document.querySelectorAll('.reveal').forEach(function(el){
      el.style.opacity='1';
      el.style.transform='none';
      el.classList.add('visible');
    });
  }
  // Try IntersectionObserver first (smooth animations)
  if(window.IntersectionObserver){
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(e.isIntersecting){e.target.classList.add('visible');e.target.style.opacity='1';e.target.style.transform='none';io.unobserve(e.target);}
      });
    },{threshold:0.05,rootMargin:'0px 0px -20px 0px'});
    document.querySelectorAll('.reveal').forEach(function(el){io.observe(el);});
  }
  // Hard fallback after 600ms — no .reveal element stays hidden
  setTimeout(forceReveal, 600);
  // Second fallback after 2s for any that loaded late
  setTimeout(forceReveal, 2000);
})();
</script>`;

  // Insert before </body>, or append if </body> not found
  if (fixed.toLowerCase().includes('</body>')) {
    fixed = fixed.replace(/<\/body>/i, safetyScript + '\n</body>');
  } else {
    fixed += safetyScript;
  }

  return fixed;
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
