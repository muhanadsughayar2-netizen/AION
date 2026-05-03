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

  var lastBrandColor = null;
  var lastResolved = null;
  var listeners = [];

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](lastResolved); } catch (e) {}
    }
  }

  function apply(brandColor) {
    var root = document.documentElement;
    if (!brandColor) {
      lastBrandColor = null;
      lastResolved = null;
      if (root) {
        for (var i = 0; i < ACCENT_VARS.length; i++) root.style.removeProperty(ACCENT_VARS[i]);
      }
      notify();
      return null;
    }
    lastBrandColor = brandColor;
    var theme = (window.SnapToAITheme && window.SnapToAITheme.getResolved)
      ? window.SnapToAITheme.getResolved()
      : (root && root.getAttribute('data-theme')) || 'dark';
    var r = resolveBranding(brandColor, theme === 'light' ? 'light' : 'dark');
    if (!r) {
      lastResolved = null;
      notify();
      return null;
    }
    lastResolved = r;
    if (root) {
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
    notify();
    return r;
  }

  // Re-evaluate against the new theme whenever it changes.
  try {
    if (window.SnapToAITheme && window.SnapToAITheme.onChange) {
      window.SnapToAITheme.onChange(function () {
        if (lastBrandColor) apply(lastBrandColor);
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
