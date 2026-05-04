// SnapToAI — Branding-aware theming helper (v2.7.1)
// Bridges institution brand color with Light/Dark theme so that:
//   - A too-dark brand color is lightened against dark mode
//   - A too-bright brand color is darkened against light mode
//   - Foreground (text/icon on top of accent) flips for AA contrast
//   - Soft / border / glow accent variants are recomputed in lockstep
// Loaded after theme.js on every surface that applies institution branding.
(function () {
  'use strict';

  function hexToRgb(hex) {
    if (!hex) return null;
    var s = String(hex).trim().replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16)
    };
  }
  function clamp(n) { return Math.max(0, Math.min(255, Math.round(n))); }
  function rgbToHex(c) {
    var to2 = function (n) {
      var s = clamp(n).toString(16);
      return s.length < 2 ? '0' + s : s;
    };
    return '#' + to2(c.r) + to2(c.g) + to2(c.b);
  }
  function relLuminance(c) {
    var f = function (v) {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function mix(a, b, t) {
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
  }
  function lighten(c, t) { return mix(c, { r: 255, g: 255, b: 255 }, t); }
  function darken(c, t) { return mix(c, { r: 0, g: 0, b: 0 }, t); }
  function rgba(c, a) {
    return 'rgba(' + clamp(c.r) + ',' + clamp(c.g) + ',' + clamp(c.b) + ',' + a + ')';
  }
  function contrast(L1, L2) {
    var hi = Math.max(L1, L2), lo = Math.min(L1, L2);
    return (hi + 0.05) / (lo + 0.05);
  }

  // Compute a theme-appropriate accent. Targets:
  //   dark theme  → contrast vs near-black bg ≥ ~4.5
  //   light theme → contrast vs white bg     ≥ ~3.5
  function adaptAccent(rgb, theme) {
    var out = { r: rgb.r, g: rgb.g, b: rgb.b };
    var iter = 0;
    if (theme === 'dark') {
      var bgDark = { r: 10, g: 10, b: 10 };
      var Lbg = relLuminance(bgDark);
      while (contrast(relLuminance(out), Lbg) < 4.5 && iter < 10) {
        out = lighten(out, 0.22);
        iter++;
      }
    } else {
      var Lw = 1;
      while (contrast(relLuminance(out), Lw) < 3.5 && iter < 12) {
        out = darken(out, 0.16);
        iter++;
      }
    }
    return out;
  }

  function resolveBranding(brandColor, theme) {
    var rgb = hexToRgb(brandColor);
    if (!rgb) return null;
    var accent = adaptAccent(rgb, theme);
    var accent2 = theme === 'dark' ? darken(accent, 0.12) : darken(accent, 0.14);
    var accentL = relLuminance(accent);
    // Foreground that sits on top of `accent` — pick whichever has more contrast.
    var contrastWhite = contrast(accentL, 1);
    var contrastBlack = contrast(accentL, 0);
    var fg = contrastBlack >= contrastWhite ? '#000000' : '#ffffff';
    return {
      raw: brandColor,
      accent: rgbToHex(accent),
      accent2: rgbToHex(accent2),
      accentSoft: rgba(accent, 0.10),
      accentSoft2: rgba(accent, theme === 'dark' ? 0.18 : 0.16),
      accentBorder: rgba(accent, theme === 'dark' ? 0.40 : 0.45),
      accentGlow: rgba(accent, theme === 'dark' ? 0.50 : 0.35),
      accentFg: fg,
      rawCss: brandColor
    };
  }

  var ACCENT_VARS = [
    '--st-accent', '--st-accent-2', '--st-accent-soft', '--st-accent-soft-2',
    '--st-accent-border', '--st-accent-glow', '--st-text-on-accent',
    '--accent', '--st-brand-raw'
  ];

  // Task #40 — full 8-slot palette CSS vars. When the institution sets any
  // of these, branding.js overrides the matching theme.css default on
  // :root so existing extension HTML/CSS that already reads these vars
  // automatically picks up the institution color — no per-element rewiring
  // needed for the bg / text / border slots.
  var PALETTE_VARS = [
    // pageBg → page-level backgrounds (popup, side panel, ai-chat shell)
    '--st-bg-deep', '--st-bg-app', '--st-bg-app-2', '--st-bg-rail',
    // cardBg → cards, modals, surfaces
    '--st-bg-elevated', '--st-bg-surface', '--st-bg-card', '--st-bg-input',
    // textPrimary / textMuted
    '--st-text-primary', '--st-text-secondary', '--st-text-tertiary', '--st-text-muted',
    // borders
    '--st-border-default', '--st-border-strong', '--st-border-subtle',
    // new explicit zone vars
    '--st-brand-header', '--st-brand-highlight',
    // Task #41 — slot 9: text selection / "canyon blue"
    '--st-selection-bg', '--st-selection-fg'
  ];

  var lastBrandColor = null;
  var lastResolved = null;
  var lastPalette = null;
  var listeners = [];

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](lastResolved); } catch (e) {}
    }
  }

  // Accept either a brand-color string (legacy single-color callers) OR an
  // object { brand, pageBg, cardBg, textPrimary, textMuted, headerColor,
  // highlightColor, borderColor }. Each palette slot is optional — anything
  // missing falls back to the theme.css default (i.e. the existing dark UI).
  function apply(input) {
    var root = document.documentElement;
    var brandColor = null;
    var palette = null;
    if (input && typeof input === 'object') {
      brandColor = input.brand || input.brandColor || null;
      palette = input;
    } else if (typeof input === 'string') {
      brandColor = input;
    }

    if (!brandColor && !palette) {
      lastBrandColor = null; lastResolved = null; lastPalette = null;
      if (root) {
        for (var i = 0; i < ACCENT_VARS.length; i++) root.style.removeProperty(ACCENT_VARS[i]);
        for (var j = 0; j < PALETTE_VARS.length; j++) root.style.removeProperty(PALETTE_VARS[j]);
      }
      notify();
      return null;
    }

    lastBrandColor = brandColor;
    lastPalette = palette;
    var theme = (window.SnapToAITheme && window.SnapToAITheme.getResolved)
      ? window.SnapToAITheme.getResolved()
      : (root && root.getAttribute('data-theme')) || 'dark';
    var r = brandColor ? resolveBranding(brandColor, theme === 'light' ? 'light' : 'dark') : null;
    lastResolved = r;
    if (root) {
      // Reset the palette vars first so a previously-applied palette doesn't
      // leak into a new institution that customized fewer slots.
      for (var k = 0; k < PALETTE_VARS.length; k++) root.style.removeProperty(PALETTE_VARS[k]);

      if (r) {
        root.style.setProperty('--st-accent', r.accent);
        root.style.setProperty('--st-accent-2', r.accent2);
        root.style.setProperty('--st-accent-soft', r.accentSoft);
        root.style.setProperty('--st-accent-soft-2', r.accentSoft2);
        root.style.setProperty('--st-accent-border', r.accentBorder);
        root.style.setProperty('--st-accent-glow', r.accentGlow);
        root.style.setProperty('--st-text-on-accent', r.accentFg);
        root.style.setProperty('--accent', r.accent);
        root.style.setProperty('--st-brand-raw', r.rawCss);
      }

      if (palette) {
        // Map each optional palette slot to the matching CSS var(s). Skip
        // any slot the admin didn't set so theme.css defaults apply.
        if (palette.pageBg) {
          root.style.setProperty('--st-bg-deep', palette.pageBg);
          root.style.setProperty('--st-bg-app', palette.pageBg);
          root.style.setProperty('--st-bg-app-2', palette.pageBg);
          root.style.setProperty('--st-bg-rail', palette.pageBg);
        }
        if (palette.cardBg) {
          root.style.setProperty('--st-bg-elevated', palette.cardBg);
          root.style.setProperty('--st-bg-surface', palette.cardBg);
          root.style.setProperty('--st-bg-card', palette.cardBg);
          root.style.setProperty('--st-bg-input', palette.cardBg);
        }
        if (palette.textPrimary) {
          root.style.setProperty('--st-text-primary', palette.textPrimary);
        }
        if (palette.textMuted) {
          root.style.setProperty('--st-text-secondary', palette.textMuted);
          root.style.setProperty('--st-text-tertiary', palette.textMuted);
          root.style.setProperty('--st-text-muted', palette.textMuted);
        }
        if (palette.borderColor) {
          root.style.setProperty('--st-border-default', palette.borderColor);
          root.style.setProperty('--st-border-strong', palette.borderColor);
          root.style.setProperty('--st-border-subtle', palette.borderColor);
        }
        if (palette.headerColor) {
          root.style.setProperty('--st-brand-header', palette.headerColor);
        }
        if (palette.highlightColor) {
          root.style.setProperty('--st-brand-highlight', palette.highlightColor);
        }
        if (palette.selectionColor) {
          root.style.setProperty('--st-selection-bg', palette.selectionColor);
          // Auto-pick readable text color over the selection background.
          var selRgb = hexToRgb(palette.selectionColor);
          var selFg = (selRgb && (selRgb.r * 299 + selRgb.g * 587 + selRgb.b * 114) / 1000 > 150) ? '#000' : '#fff';
          root.style.setProperty('--st-selection-fg', selFg);
        }
      }

      // Task #40 (fix) — many surfaces in popup.css / sidebar.css / ai-chat
      // hardcode their background/color (e.g. body uses a fixed gradient,
      // .status-row uses rgba(10,10,20,.95), .auth-overlay uses a dark
      // gradient, body has color:#fff). Setting CSS variables alone can't
      // override those hardcoded rules, so we ALSO inject a <style> block
      // with high-specificity !important overrides that pin the major
      // visible surfaces to the palette colors when the institution sets
      // pageBg / cardBg / textPrimary. Removed when no palette is active.
      injectPaletteOverrides(palette, r, brandColor);
    }
    notify();
    return r;
  }

  function injectPaletteOverrides(palette, resolved, brandColorHex) {
    var STYLE_ID = 'snaptoai-palette-overrides';
    var existing = document.getElementById(STYLE_ID);
    var hasPalette = palette && (palette.pageBg || palette.cardBg ||
      palette.textPrimary || palette.textMuted || palette.headerColor ||
      palette.highlightColor || palette.borderColor || palette.selectionColor);
    var hasBrand = !!(resolved && brandColorHex);
    if (!hasPalette && !hasBrand) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }
    var rules = [];

    // Brand-tinted overrides for the ~100 hardcoded `rgba(0, 217, 255, X)`
    // cyan references in popup.css / sidebar.css / ai-chat. The institution's
    // brand color now drives every hover/active/focus/glow/ring/spinner state
    // instead of cyan flashing through. Derive 6 alpha tints from brand RGB.
    if (hasBrand) {
      var brgb = hexToRgb(brandColorHex) || hexToRgb(resolved.accent);
      if (brgb) {
        var t08 = rgba(brgb, 0.08), t12 = rgba(brgb, 0.12), t15 = rgba(brgb, 0.15);
        var t20 = rgba(brgb, 0.20), t30 = rgba(brgb, 0.30), t50 = rgba(brgb, 0.50);
        var solid = resolved.accent, solid2 = resolved.accent2;

        // Pill-style header buttons (sign in / sidebar / status pill).
        rules.push('.sign-in-header-btn, .open-sidebar-btn, .status-pill, .ai-status-pill { background: ' + t08 + ' !important; border-color: ' + t20 + ' !important; color: ' + solid + ' !important; }');
        rules.push('.sign-in-header-btn:hover, .open-sidebar-btn:hover, .status-pill:hover { background: ' + t15 + ' !important; border-color: ' + t30 + ' !important; }');

        // Main orb / hero buttons (SNAP / SNIP / FULL PAGE) — the cyan
        // ring + glow that flashed through ITIHAD bank's brand. NOTE:
        // popup.html uses `.hero-action-btn` for these, NOT `.orb` — the
        // earlier `.orb` selector never matched anything in the live UI.
        // We tint .hero-action-btn here and explicitly EXCLUDE `.ai-btn`
        // (the Ask AI star) so it can be driven by the highlightColor
        // slot below — that lets admin keep the star visually distinct
        // from the regular capture buttons.
        // SOLID-FILL bank style: hero buttons get a strong brand fill and
        // the icon flips to the contrast color (white on orange / black on
        // pale brands) — `resolved.accentFg` already handles luminance.
        var heroSel = '.hero-action-btn:not(.ai-btn)';
        var fg = resolved.accentFg || '#ffffff';
        rules.push(heroSel + ' { background: ' + solid + ' !important; border-color: ' + solid + ' !important; color: ' + fg + ' !important; }');
        rules.push(heroSel + ':hover { background: ' + solid2 + ' !important; border-color: ' + solid2 + ' !important; box-shadow: 0 4px 18px ' + t50 + ' !important; transform: scale(1.05); }');
        rules.push(heroSel + ' svg { color: ' + fg + ' !important; }');
        rules.push(heroSel + ' svg path, ' + heroSel + ' svg circle, ' + heroSel + ' svg rect, ' + heroSel + ' svg line, ' + heroSel + ' svg polygon { stroke: ' + fg + ' !important; }');
        // Labels above the hero buttons — default to text-primary if the
        // admin set it (so "all text white" actually means all text white),
        // otherwise fall back to the brand color accent.
        var labelColor = palette.textPrimary || solid;
        rules.push('.hero-action-label:not(.ai-label) { color: ' + labelColor + ' !important; }');
        // Legacy .orb selectors (other surfaces still use them).
        rules.push('.orb { background: ' + t08 + ' !important; border-color: ' + t30 + ' !important; }');
        rules.push('.orb:hover { background: ' + t15 + ' !important; border-color: ' + t50 + ' !important; box-shadow: 0 4px 14px ' + t20 + ' !important; }');
        rules.push('.orb:active { background: ' + t20 + ' !important; }');
        rules.push('.orb-label { color: ' + labelColor + ' !important; }');
        rules.push('.orb-inner, .orb svg { color: ' + solid + ' !important; }');
        rules.push('.orb svg path, .orb svg circle, .orb svg rect { stroke: ' + solid + ' !important; }');
        // Solid-fill action buttons: Select All / Send to AI / Copy /
        // Delete — orange bg, white text/svg, hover deepens to accent2.
        rules.push('.select-all-btn, .action-btn, .ai-action-btn, .footer-btn { background: ' + solid + ' !important; border-color: ' + solid + ' !important; color: ' + fg + ' !important; }');
        rules.push('.select-all-btn:hover, .action-btn:hover, .ai-action-btn:hover, .footer-btn:hover { background: ' + solid2 + ' !important; border-color: ' + solid2 + ' !important; box-shadow: 0 4px 12px ' + t50 + ' !important; }');
        rules.push('.select-all-btn svg, .action-btn svg, .ai-action-btn svg, .footer-btn svg { color: ' + fg + ' !important; fill: ' + fg + ' !important; }');

        // Primary CTA gradient buttons (was hardcoded #00e8ff → #00c8e8).
        var grad = 'linear-gradient(135deg, ' + solid + ' 0%, ' + solid2 + ' 100%)';
        rules.push('.send-to-ai-btn, .primary-btn, .cta-btn, .unlock-btn, .ai-send-btn { background: ' + grad + ' !important; border: none !important; color: #fff !important; box-shadow: 0 4px 15px ' + t30 + ' !important; }');

        // Focus / outline ring across all interactive elements.
        rules.push('button:focus-visible, a:focus-visible, [role="button"]:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid ' + solid + ' !important; outline-offset: 2px !important; box-shadow: 0 0 0 3px ' + t20 + ' !important; }');

        // Loading spinners (the cyan rotating ring).
        rules.push('.spinner, .loader, .loading-ring { border-color: ' + t20 + ' !important; border-top-color: ' + solid + ' !important; }');

        // Inline link-style accent text.
        rules.push('a, .accent-text, [data-accent] { color: ' + solid + ' !important; }');

        // Snapshot card selection highlight (was cyan border).
        rules.push('.snapshot.selected, .snap-card.selected, [data-selected="true"] { border-color: ' + solid + ' !important; box-shadow: 0 0 0 2px ' + t30 + ' !important; }');

        // Thumbnail strip — the "1, 2, 3, 4, 5" number badges and the
        // top-left selection checkboxes were the last visible cyan spots.
        rules.push('.thumbnail { border-color: ' + t20 + ' !important; }');
        rules.push('.thumbnail:hover { border-color: ' + solid + ' !important; box-shadow: 0 0 10px ' + t30 + ' !important; }');
        rules.push('.thumbnail.selected { border-color: ' + solid + ' !important; box-shadow: 0 0 12px ' + t50 + ' !important; }');
        rules.push('.thumbnail-number { background: ' + rgba(brgb, 0.9) + ' !important; color: ' + resolved.accentFg + ' !important; }');
        rules.push('.thumbnail-checkbox { border-color: ' + rgba(brgb, 0.5) + ' !important; }');
        rules.push('.thumbnail-checkbox:hover { background: ' + t20 + ' !important; border-color: ' + solid + ' !important; }');
        rules.push('.thumbnail-checkbox.checked { background: ' + solid + ' !important; border-color: ' + solid + ' !important; }');
        rules.push('.thumbnail-checkbox.checked::after { color: ' + resolved.accentFg + ' !important; }');
        rules.push('.capture-type-badge.type-snap { background: ' + rgba(brgb, 0.9) + ' !important; color: ' + resolved.accentFg + ' !important; }');
      }
    }

    if (palette.pageBg) {
      // Kill the dark body gradient + auth overlay so the page truly
      // becomes the picked color (works for popup, sidebar, ai-chat).
      rules.push('html, body { background: ' + palette.pageBg + ' !important; background-image: none !important; }');
      rules.push('.auth-overlay, #authOverlay { background: ' + palette.pageBg + ' !important; background-image: none !important; }');
    }
    if (palette.cardBg) {
      // Only paint actual CARD-like surfaces with cardBg — NOT .container
      // (which is the whole popup wrapper) and NOT .orb (which keeps its
      // brand-tinted look). Add a soft shadow so cards look elevated on
      // the page background instead of flat gray boxes.
      rules.push('.card, .panel, .modal, .modal-content, .action-row, .snapshot-list, .footer-actions, .status-row { background: ' + palette.cardBg + ' !important; background-image: none !important; border-radius: 14px; box-shadow: 0 2px 10px rgba(0,0,0,0.06); }');
    }
    if (palette.headerColor) {
      // Headers across surfaces (popup .header, ai-chat .header).
      rules.push('.header, .top-bar, .app-header { background: ' + palette.headerColor + ' !important; background-image: none !important; }');
    }
    if (palette.textPrimary) {
      // Force ALL body text to text-primary (with !important so popup.css
      // hardcodes don't win). Excludes elements that have their own
      // intentional accent color: hero/orb/ai labels (driven by brand
      // / highlight slots above), badges, pills, and links.
      rules.push('html, body, .container, p, label, h1, h2, h3, h4, h5, h6, div, span, li, td, dd, dt, .ai-status-row, #aiStatusText, .status-text, .footer-hint, .prompt-counter, .free-prompt-counter, .ai-manage-link, .review-text { color: ' + palette.textPrimary + ' !important; }');
      // Re-assert the accent overrides AFTER the broad rule so they win.
      // (The selectors with brand/highlight/fg colors below get appended
      // later in the stylesheet, but our broad rule uses tag selectors
      // with low specificity so class-based rules naturally override.)
    }
    if (palette.textMuted) {
      rules.push('.muted, .hint, .subtitle, .timestamp, ::placeholder, [data-muted] { color: ' + palette.textMuted + ' !important; }');
    }
    if (palette.borderColor) {
      rules.push('.card, .panel, .modal-content, input, select, textarea { border-color: ' + palette.borderColor + ' !important; }');
    }
    if (palette.highlightColor) {
      rules.push('.badge-premium, .badge-pro, .ask-ai-badge, .highlight-pill, [data-highlight] { background: ' + palette.highlightColor + ' !important; }');
      // Task #41 — route the Ask AI star (the gold/yellow ⭐ orb) through
      // highlightColor so admins can recolor it. Build an alpha tint of
      // the highlight color so the soft glow matches.
      var hRgb = hexToRgb(palette.highlightColor);
      if (hRgb) {
        var h08 = rgba(hRgb, 0.08), h15 = rgba(hRgb, 0.15);
        var h25 = rgba(hRgb, 0.25), h35 = rgba(hRgb, 0.35), h50 = rgba(hRgb, 0.50);
        rules.push('.ai-btn { background: ' + h08 + ' !important; border-color: ' + h35 + ' !important; color: ' + palette.highlightColor + ' !important; box-shadow: 0 0 18px ' + h15 + ', 0 0 40px ' + h08 + ' !important; }');
        rules.push('.ai-btn:hover { background: ' + h25 + ' !important; border-color: ' + h50 + ' !important; box-shadow: 0 0 28px ' + h35 + ', 0 0 50px ' + h15 + ' !important; }');
        rules.push('.ai-btn svg, .ai-btn svg polygon, .ai-btn svg path { color: ' + palette.highlightColor + ' !important; stroke: ' + palette.highlightColor + ' !important; }');
        rules.push('.ai-label { color: ' + palette.highlightColor + ' !important; }');
      }
    }
    // Task #41 — slot 9: kill the default browser "canyon blue" highlight
    // (Chrome's #2563eb / #3b82f6) and replace with the institution color
    // EVERYWHERE in the popup, side panel, and AI chat. Also drives the
    // checkbox / radio / range / progress accent so those native widgets
    // pick up the brand color too.
    if (palette.selectionColor) {
      var selRgb2 = hexToRgb(palette.selectionColor);
      var selFg2 = (selRgb2 && (selRgb2.r * 299 + selRgb2.g * 587 + selRgb2.b * 114) / 1000 > 150) ? '#000' : '#fff';
      rules.push('::selection { background: ' + palette.selectionColor + ' !important; color: ' + selFg2 + ' !important; }');
      rules.push('::-moz-selection { background: ' + palette.selectionColor + ' !important; color: ' + selFg2 + ' !important; }');
      rules.push('html, body, input, textarea, select, button { accent-color: ' + palette.selectionColor + '; }');
    }
    var css = rules.join('\n');
    if (existing) {
      existing.textContent = css;
    } else {
      var styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      styleEl.textContent = css;
      (document.head || document.documentElement).appendChild(styleEl);
    }
  }

  // Re-evaluate against the new theme whenever it changes. Re-pass the
  // last palette so all 8 slots survive a Light↔Dark flip.
  try {
    if (window.SnapToAITheme && window.SnapToAITheme.onChange) {
      window.SnapToAITheme.onChange(function () {
        if (lastPalette) apply(lastPalette);
        else if (lastBrandColor) apply(lastBrandColor);
      });
    }
  } catch (e) {}

  window.SnapToAIBranding = {
    apply: apply,
    clear: function () { return apply(null); },
    current: function () { return lastResolved; },
    resolve: resolveBranding,
    onChange: function (cb) { if (typeof cb === 'function') listeners.push(cb); }
  };
})();
