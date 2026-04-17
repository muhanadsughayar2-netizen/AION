// SnapToAI first-run guided tour
// Self-contained: exposes window.startSnapToAITour() and auto-runs on first
// popup open if chrome.storage.local.snaptoai_tour_completed is unset.

(function () {
  const TOUR_FLAG = 'snaptoai_tour_completed';

  // Steps point at real elements in popup.html. If a target isn't on screen
  // (e.g. the queue is hidden when empty), the step gracefully centers itself.
  const STEPS = [
    {
      target: null,
      title: 'Welcome to SnapToAI 📸',
      body: 'Capture multiple screenshots and chat with AI about them. Quick 30-second tour — let\'s go.'
    },
    {
      target: '#snapButton',
      title: 'Snap the screen',
      body: 'One click captures the visible area and adds it to your queue. You can stack up to 10 screenshots.'
    },
    {
      target: '#snipButton',
      title: 'Snip a region',
      body: 'Drag a box around just the part of the screen you want. Only the cropped area is saved.'
    },
    {
      target: '#fullPageButton',
      title: 'Full-page capture',
      body: 'Captures and stitches the whole page — even content below the fold — into one tall image.'
    },
    {
      target: '#directAiButton',
      title: 'Ask AI about it',
      body: 'Send your screenshots straight to ChatGPT, Claude, Grok, or chat in-app with Gemini for vision, image, music & video.'
    },
    {
      target: '#aiManageLink',
      title: 'Modes & settings',
      body: 'Switch between Vision, Image, Music, and Video modes here. Plug in your free Gemini key from Google AI Studio.'
    },
    {
      target: '#signInHeaderBtn',
      title: 'Sign in (optional)',
      body: 'Sign in with Google to sync your account and unlock 10 free AI prompts to try things out — no card needed.',
      altTarget: '#userAvatarContainer'  // shown instead if already signed in
    },
    {
      target: null,
      title: "You're all set! 🎉",
      body: 'Pro tip: right-click anywhere on a webpage to open the SnapToAI wand menu — capture, ask AI about an image, or explain selected text.'
    }
  ];

  let currentIdx = 0;
  let overlay = null;
  let spotlight = null;
  let tooltip = null;
  let resizeHandler = null;
  // Lifecycle bookkeeping so manual + auto-start can never race or leak.
  let tourState = 'idle';        // 'idle' | 'pending' | 'running' | 'completed'
  let pendingStartTimer = null;
  let authObserver = null;

  function buildScaffold() {
    overlay = document.createElement('div');
    overlay.className = 'tour-overlay';
    overlay.id = 'snaptoaiTourOverlay';

    spotlight = document.createElement('div');
    spotlight.className = 'tour-spotlight';
    spotlight.style.display = 'none';
    overlay.appendChild(spotlight);

    tooltip = document.createElement('div');
    tooltip.className = 'tour-tooltip';
    overlay.appendChild(tooltip);

    document.body.appendChild(overlay);
  }

  function clearPendingStart() {
    if (pendingStartTimer) { clearTimeout(pendingStartTimer); pendingStartTimer = null; }
    if (authObserver) { authObserver.disconnect(); authObserver = null; }
  }

  function teardown(markCompleted) {
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
    }
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = spotlight = tooltip = null;
    tourState = markCompleted ? 'completed' : 'idle';
    if (markCompleted) {
      try { chrome.storage.local.set({ [TOUR_FLAG]: true }); } catch (e) {}
    }
  }

  function resolveTarget(step) {
    if (!step.target) return null;
    let el = document.querySelector(step.target);
    if ((!el || el.offsetParent === null) && step.altTarget) {
      el = document.querySelector(step.altTarget);
    }
    if (!el || el.offsetParent === null) return null;
    return el;
  }

  function positionStep(step) {
    if (!overlay) return;
    const target = resolveTarget(step);
    const isLast = currentIdx === STEPS.length - 1;

    // Build tooltip content fresh each step
    const dots = STEPS.map((_, i) =>
      `<span class="${i === currentIdx ? 'active' : ''}"></span>`).join('');
    tooltip.innerHTML = `
      <div class="tour-tooltip-arrow"></div>
      <div class="tour-tooltip-title">${step.title}</div>
      <div class="tour-tooltip-body">${step.body}</div>
      <div class="tour-tooltip-footer">
        <div class="tour-progress">${dots}</div>
        <div class="tour-tooltip-buttons">
          ${!isLast ? `<button class="tour-btn tour-btn-skip" data-action="skip">Skip</button>` : ''}
          <button class="tour-btn tour-btn-next" data-action="next">${isLast ? 'Got it!' : 'Next →'}</button>
        </div>
      </div>
    `;
    tooltip.querySelectorAll('[data-action]').forEach(b => {
      b.addEventListener('click', () => {
        const a = b.getAttribute('data-action');
        if (a === 'skip') { teardown(true); return; }
        if (a === 'next') { goNext(); return; }
      });
    });

    if (!target) {
      // Centered (welcome / final step)
      spotlight.style.display = 'none';
      tooltip.classList.add('tour-center');
      tooltip.removeAttribute('data-pos');
      tooltip.style.left = '';
      tooltip.style.top = '';
      const arrow = tooltip.querySelector('.tour-tooltip-arrow');
      if (arrow) arrow.style.display = 'none';
      return;
    }

    // Position spotlight over the target
    const rect = target.getBoundingClientRect();
    const pad = 6;
    spotlight.style.display = 'block';
    spotlight.style.left = `${rect.left - pad}px`;
    spotlight.style.top = `${rect.top - pad}px`;
    spotlight.style.width = `${rect.width + pad * 2}px`;
    spotlight.style.height = `${rect.height + pad * 2}px`;

    // Position tooltip below if target is in upper half, above otherwise
    tooltip.classList.remove('tour-center');
    const arrow = tooltip.querySelector('.tour-tooltip-arrow');
    if (arrow) arrow.style.display = '';

    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const tooltipW = 270;
    const tooltipH = tooltip.offsetHeight || 140;
    const gap = 16;

    let pos = 'bottom';
    let top, left;
    if (rect.bottom + tooltipH + gap < viewportH - 10) {
      pos = 'bottom';
      top = rect.bottom + gap;
    } else if (rect.top - tooltipH - gap > 10) {
      pos = 'top';
      top = rect.top - tooltipH - gap;
    } else {
      pos = 'bottom';
      top = Math.max(10, viewportH - tooltipH - 10);
    }
    left = rect.left + rect.width / 2 - tooltipW / 2;
    left = Math.max(10, Math.min(left, viewportW - tooltipW - 10));

    tooltip.setAttribute('data-pos', pos);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function goNext() {
    currentIdx++;
    if (currentIdx >= STEPS.length) {
      teardown(true);
      return;
    }
    positionStep(STEPS[currentIdx]);
  }

  function start() {
    // Cancel any pending auto-start so it can't fire again on top of us.
    clearPendingStart();
    if (tourState === 'running') return;
    if (document.getElementById('snaptoaiTourOverlay')) return;
    tourState = 'running';
    currentIdx = 0;
    buildScaffold();
    positionStep(STEPS[currentIdx]);
    resizeHandler = () => positionStep(STEPS[currentIdx]);
    window.addEventListener('resize', resizeHandler);
  }

  // Public API: manually start the tour (e.g. from "Take the tour" link)
  window.startSnapToAITour = start;

  // Auto-start on first popup open (after a short delay so the popup has
  // settled and any auth overlay is visible/dismissable).
  function tryAutoStart() {
    // Re-check the completion flag right before starting, in case the user
    // already manually ran + skipped the tour during the delay.
    try {
      chrome.storage.local.get(TOUR_FLAG, (res) => {
        if (tourState !== 'pending') return;       // user already started/finished
        if (res && res[TOUR_FLAG]) { tourState = 'completed'; return; }
        start();
      });
    } catch (e) {
      if (tourState === 'pending') start();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    try {
      chrome.storage.local.get(TOUR_FLAG, (res) => {
        if (res && res[TOUR_FLAG]) { tourState = 'completed'; return; }
        tourState = 'pending';
        pendingStartTimer = setTimeout(() => {
          pendingStartTimer = null;
          if (tourState !== 'pending') return;
          const authOverlay = document.getElementById('authOverlay');
          if (authOverlay && authOverlay.style.display !== 'none') {
            authObserver = new MutationObserver(() => {
              if (tourState !== 'pending') { clearPendingStart(); return; }
              if (authOverlay.style.display === 'none') {
                clearPendingStart();
                pendingStartTimer = setTimeout(() => {
                  pendingStartTimer = null;
                  if (tourState === 'pending') tryAutoStart();
                }, 400);
              }
            });
            authObserver.observe(authOverlay, { attributes: true, attributeFilter: ['style'] });
          } else {
            tryAutoStart();
          }
        }, 600);
      });
    } catch (e) {
      console.log('[SnapToAI Tour] init error:', e.message);
    }
  });
})();
