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
      body: 'Quick tour: Capture → Select → Edit → Send. Takes about 30 seconds.',
      welcome: true
    },
    {
      target: '#snapButton',
      title: 'Capture fast',
      body: 'Tap SNAP to grab the visible part of the page. Your queue holds up to 9 screenshots.'
    },
    {
      target: '#snipButton',
      title: 'Snip or full page',
      body: 'Use SNIP to drag-select only what you need. FULL PAGE captures the whole scrolling page as one image.',
      altTarget: '#fullPageButton'
    },
    {
      target: '#thumbnails',
      title: 'Stack, select, stitch',
      body: 'Screenshots stack in your queue (demo shown below). Select any set and stitch them into ONE combined image.',
      demo: 'unselected'
    },
    {
      target: '#thumbnails',
      title: 'Edit each screenshot',
      body: 'Click any thumbnail to open Snap Editor — crop, annotate, add stickers, then save.',
      demo: 'unselected'
    },
    {
      target: '#directAiButton',
      title: 'Send to AI your way',
      body: 'Pick the shots you want (see the checkmarks below), then hit Ask AI for built-in chat — or copy and paste into ChatGPT, Claude, or Grok.',
      demo: 'selected'
    },
    {
      // Dynamic: spotlight the sign-in button if signed out, else the
      // settings link. Picked at runtime in resolveTarget().
      target: 'DYNAMIC_SIGNIN_OR_SETTINGS',
      title: 'Sign in with Google',
      body: 'Sign in to sync your account, save your API key, and unlock 20 AI prompts per day. No card needed.'
    },
    {
      target: '#aiManageLink',
      title: 'Settings — your control panel ⚙',
      body: 'Settings is where you paste your free Gemini key, switch models, toggle Vision, and watch your daily quota. Here\'s what it looks like:',
      extra: 'settings'
    },
    {
      target: '#aiManageLink',
      title: 'Generate, don\'t just analyze ✨',
      body: 'Switch modes to create — not just chat:',
      extra: 'modes'
    },
    {
      target: '#aiManageLink',
      title: 'About the cost 💳',
      body: 'Image, Music & Video need your own Gemini key on a paid Google tier. You pay Google directly — we never charge for usage. Your $300 Google free credit covers a lot.'
    },
    {
      target: null,
      title: "You're all set! 🎉",
      body: 'Pro tip: right-click any page for the SnapToAI wand menu — capture, analyze, and send faster.'
    }
  ];

  let currentIdx = 0;
  let overlay = null;
  let spotlight = null;
  let tooltip = null;
  let resizeHandler = null;
  // Snapshot of #thumbnails innerHTML so we can restore real queue after demo
  let thumbnailsBackup = null;
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
    restoreThumbnails();
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = spotlight = tooltip = null;
    tourState = markCompleted ? 'completed' : 'idle';
    if (markCompleted) {
      try { chrome.storage.local.set({ [TOUR_FLAG]: true }); } catch (e) {}
    }
  }

  // Inject 3 fake thumbnails into #thumbnails so users SEE what stitching/
  // editing/sending looks like even when their real queue is empty.
  // Skipped (no-op) if the user already has real screenshots queued.
  function injectDemoThumbnails(mode) {
    const container = document.querySelector('#thumbnails');
    if (!container) return;
    // If real thumbnails are already present, leave them alone.
    if (container.querySelector('.thumbnail')) return;
    if (thumbnailsBackup === null) thumbnailsBackup = container.innerHTML;

    const selected = mode === 'selected';
    container.innerHTML = '';
    for (let i = 1; i <= 3; i++) {
      const t = document.createElement('div');
      const isSel = selected && i <= 2;   // first 2 selected when mode='selected'
      t.className = `tour-demo-thumb tour-demo-thumb--${i}${isSel ? ' tour-demo-selected' : ''}`;
      // Mock-screenshot styling: fake browser bar + content lines so the
      // demo reads as "this is a screenshot of a webpage" not just a tile.
      t.innerHTML = `
        <div class="tour-demo-thumb-inner">
          <div class="tour-demo-thumb-bar">
            <span></span><span></span><span></span>
          </div>
          <div class="tour-demo-thumb-lines">
            <div></div><div></div><div></div>
          </div>
        </div>
        ${isSel ? '<div class="tour-demo-check">✓</div>' : ''}
        <div class="tour-demo-num">${i}</div>
      `;
      container.appendChild(t);
    }
  }

  // Inline visual demos rendered inside the tooltip body for steps that
  // need to SHOW a feature (Settings panel, Image/Music/Video modes).
  function renderExtra(kind) {
    if (kind === 'settings') {
      return `
        <div class="tour-demo-settings">
          <div class="tour-demo-settings-row">
            <span class="tour-demo-settings-label">🔑 Gemini API Key</span>
            <span class="tour-demo-settings-pill tour-demo-settings-pill--ok">●●● set</span>
          </div>
          <div class="tour-demo-settings-row">
            <span class="tour-demo-settings-label">👁 Vision</span>
            <span class="tour-demo-settings-toggle"></span>
          </div>
          <div class="tour-demo-settings-row">
            <span class="tour-demo-settings-label">⚡ Daily prompts</span>
            <span class="tour-demo-settings-pill">17 / 20 left</span>
          </div>
          <div class="tour-demo-settings-row">
            <span class="tour-demo-settings-label">🧠 Model</span>
            <span class="tour-demo-settings-pill">Gemini 2.5 Flash</span>
          </div>
        </div>`;
    }
    if (kind === 'modes') {
      return `
        <div class="tour-demo-modes">
          <div class="tour-demo-mode-card tour-demo-mode-card--image">
            <div class="tour-demo-mode-emoji">🎨</div>
            <div class="tour-demo-mode-label">Image</div>
            <div class="tour-demo-mode-sub">Nano Banana</div>
          </div>
          <div class="tour-demo-mode-card tour-demo-mode-card--music">
            <div class="tour-demo-mode-emoji">🎵</div>
            <div class="tour-demo-mode-label">Music</div>
            <div class="tour-demo-mode-sub">Lyria · Song Studio</div>
          </div>
          <div class="tour-demo-mode-card tour-demo-mode-card--video">
            <div class="tour-demo-mode-emoji">🎬</div>
            <div class="tour-demo-mode-label">Video</div>
            <div class="tour-demo-mode-sub">Veo 3.1 · multi-clip</div>
          </div>
        </div>`;
    }
    return '';
  }

  function restoreThumbnails() {
    if (thumbnailsBackup === null) return;
    const container = document.querySelector('#thumbnails');
    if (container) container.innerHTML = thumbnailsBackup;
    thumbnailsBackup = null;
  }

  function resolveTarget(step) {
    if (!step.target) return null;
    // Dynamic: pick sign-in button when signed out, settings link when signed in
    if (step.target === 'DYNAMIC_SIGNIN_OR_SETTINGS') {
      const signIn = document.querySelector('#signInHeaderBtn');
      const avatar = document.querySelector('#userAvatarContainer');
      const signedIn = avatar && avatar.offsetParent !== null;
      const signInVisible = signIn && signIn.offsetParent !== null;
      if (!signedIn && signInVisible) return signIn;
      const settings = document.querySelector('#aiManageLink');
      if (settings && settings.offsetParent !== null) return settings;
      return null;
    }
    let el = document.querySelector(step.target);
    if ((!el || el.offsetParent === null) && step.altTarget) {
      el = document.querySelector(step.altTarget);
    }
    if (!el || el.offsetParent === null) return null;
    return el;
  }

  // Area of overlap between two rects (0 if none).
  function overlapArea(a, b) {
    const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return w * h;
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
      ${step.extra ? renderExtra(step.extra) : ''}
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

    // Welcome step: clear overlay (no blur over capture row), pin to top
    overlay.classList.toggle('tour-overlay--clear', !!step.welcome);
    tooltip.classList.toggle('tour-welcome', !!step.welcome);

    // Demo thumbnails: inject for steps that need them, restore otherwise
    if (step.demo) {
      injectDemoThumbnails(step.demo);
    } else {
      restoreThumbnails();
    }

    if (step.welcome) {
      // Top-anchored welcome so users can SEE the capture row beneath it.
      // Adaptive: if the welcome card would overlap the capture row, scoot
      // it up by reducing top to keep clearance above the row.
      spotlight.style.display = 'none';
      tooltip.classList.remove('tour-center');
      tooltip.removeAttribute('data-pos');
      tooltip.style.left = '50%';
      tooltip.style.transform = 'translateX(-50%)';
      const arrow = tooltip.querySelector('.tour-tooltip-arrow');
      if (arrow) arrow.style.display = 'none';

      // Measure tooltip height with current content
      tooltip.style.top = '-9999px';
      const measuredH = tooltip.getBoundingClientRect().height;

      // Find the capture row (snap/snip/full/ai buttons share parent)
      const captureBtn = document.querySelector('#snapButton');
      let top = 12;
      if (captureBtn && captureBtn.offsetParent !== null) {
        const rowRect = captureBtn.getBoundingClientRect();
        const minClearance = 8;
        // If welcome at top:12 would overlap the capture row, push it up
        // (negative top isn't allowed) — instead, shrink top to whatever
        // keeps bottom above the row, but not below 6px.
        const maxTopToAvoidRow = rowRect.top - measuredH - minClearance;
        if (12 + measuredH > rowRect.top - minClearance) {
          top = Math.max(6, maxTopToAvoidRow);
        }
      }
      tooltip.style.top = `${top}px`;
      return;
    }

    if (!target) {
      // Centered (final step only — welcome is handled above)
      spotlight.style.display = 'none';
      tooltip.classList.add('tour-center');
      tooltip.removeAttribute('data-pos');
      tooltip.style.left = '';
      tooltip.style.top = '';
      tooltip.style.transform = '';
      const arrow = tooltip.querySelector('.tour-tooltip-arrow');
      if (arrow) arrow.style.display = 'none';
      return;
    }

    // Targeted step: spotlight + arrow tooltip
    tooltip.classList.remove('tour-center');
    tooltip.style.transform = '';
    const arrow = tooltip.querySelector('.tour-tooltip-arrow');
    if (arrow) arrow.style.display = '';

    const rect = target.getBoundingClientRect();
    const pad = 6;
    spotlight.style.display = 'block';
    spotlight.style.left = `${rect.left - pad}px`;
    spotlight.style.top = `${rect.top - pad}px`;
    spotlight.style.width = `${rect.width + pad * 2}px`;
    spotlight.style.height = `${rect.height + pad * 2}px`;

    const spotRect = {
      left: rect.left - pad,
      top: rect.top - pad,
      right: rect.right + pad,
      bottom: rect.bottom + pad
    };

    // Measure tooltip with current content (responsive width)
    // Briefly position offscreen to get true measurements
    tooltip.style.left = '-9999px';
    tooltip.style.top = '0px';
    const tooltipRect = tooltip.getBoundingClientRect();
    const tooltipW = tooltipRect.width;
    const tooltipH = tooltipRect.height;

    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const margin = 10;
    const gap = 14;

    // Try positions in order: bottom, top, right, left. Pick first that fits
    // viewport AND does not overlap the spotlight rect.
    const targetCenterX = rect.left + rect.width / 2;
    const targetCenterY = rect.top + rect.height / 2;
    const candidates = [
      { pos: 'bottom', top: spotRect.bottom + gap, left: targetCenterX - tooltipW / 2 },
      { pos: 'top',    top: spotRect.top - tooltipH - gap, left: targetCenterX - tooltipW / 2 },
      { pos: 'right',  top: targetCenterY - tooltipH / 2, left: spotRect.right + gap },
      { pos: 'left',   top: targetCenterY - tooltipH / 2, left: spotRect.left - tooltipW - gap }
    ];

    let chosen = null;
    let bestFallback = null;
    let bestFallbackOverlap = Infinity;
    for (const c of candidates) {
      const left = Math.max(margin, Math.min(c.left, viewportW - tooltipW - margin));
      const top = Math.max(margin, Math.min(c.top, viewportH - tooltipH - margin));
      const fits = top >= margin && left >= margin
        && top + tooltipH <= viewportH - margin
        && left + tooltipW <= viewportW - margin;
      const ovl = overlapArea(
        { left, top, right: left + tooltipW, bottom: top + tooltipH },
        spotRect
      );
      if (fits && ovl === 0) { chosen = { ...c, left, top }; break; }
      // Track candidate with smallest overlap as fallback
      if (fits && ovl < bestFallbackOverlap) {
        bestFallback = { ...c, left, top };
        bestFallbackOverlap = ovl;
      }
    }
    if (!chosen) {
      // Use the lowest-overlap candidate that fits, if any
      if (bestFallback) {
        chosen = bestFallback;
      } else {
        // Last resort — clamped bottom (truly no room anywhere)
        const left = Math.max(margin, Math.min(targetCenterX - tooltipW / 2, viewportW - tooltipW - margin));
        const top = Math.min(spotRect.bottom + gap, viewportH - tooltipH - margin);
        chosen = { pos: 'bottom', left, top };
      }
    }

    tooltip.setAttribute('data-pos', chosen.pos);
    tooltip.style.left = `${chosen.left}px`;
    tooltip.style.top = `${chosen.top}px`;

    // Arrow alignment — point at target center, clamped within tooltip bounds
    const ARROW_INSET = 14;
    if (chosen.pos === 'top' || chosen.pos === 'bottom') {
      let ax = targetCenterX - chosen.left;
      ax = Math.max(ARROW_INSET, Math.min(ax, tooltipW - ARROW_INSET));
      tooltip.style.setProperty('--tour-arrow-x', `${ax}px`);
      tooltip.style.removeProperty('--tour-arrow-y');
    } else {
      let ay = targetCenterY - chosen.top;
      ay = Math.max(ARROW_INSET, Math.min(ay, tooltipH - ARROW_INSET));
      tooltip.style.setProperty('--tour-arrow-y', `${ay}px`);
      tooltip.style.removeProperty('--tour-arrow-x');
    }
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
