/* Standalone permission helper page. Lives at chrome-extension://<id>/mic-permission.html
   Chrome treats this URL as a real, persistent origin — so once the user grants
   the mic here, ALL extension pages (the popup included) inherit the grant. */
(function () {
  'use strict';
  const btn = document.getElementById('enableBtn');
  const status = document.getElementById('status');

  function setStatus(msg, kind) {
    status.textContent = msg || '';
    status.className = 'status ' + (kind || '');
  }

  async function maybeAlreadyGranted() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return false;
      const r = await navigator.permissions.query({ name: 'microphone' });
      return r.state === 'granted';
    } catch (_) { return false; }
  }

  async function enable() {
    btn.disabled = true;
    setStatus('Asking Chrome for permission…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // We don't actually need to keep the stream — we just needed the grant.
      stream.getTracks().forEach(t => t.stop());
      setStatus('All set! You can close this tab and go back to Snap. 🎉', 'ok');
      btn.textContent = 'Microphone enabled ✓';
      // Try to auto-close after a moment (works if this tab was opened by us)
      setTimeout(() => { try { window.close(); } catch (_) {} }, 1800);
    } catch (err) {
      btn.disabled = false;
      const name = (err && err.name) || '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setStatus('Chrome blocked the request. Click the camera/mic icon in your address bar and choose "Always allow".', 'err');
      } else if (name === 'NotFoundError') {
        setStatus('No microphone found on this device.', 'err');
      } else {
        setStatus('Couldn\'t enable mic: ' + (err.message || name || 'unknown error'), 'err');
      }
    }
  }

  btn.addEventListener('click', enable);

  // If already granted, just say so and offer to close.
  maybeAlreadyGranted().then((granted) => {
    if (granted) {
      setStatus('Microphone is already enabled — you\'re good to go!', 'ok');
      btn.textContent = 'Close this tab';
      btn.addEventListener('click', () => { try { window.close(); } catch (_) {} }, { once: true });
    }
  });
})();
