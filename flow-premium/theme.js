// SnapToAI — Theme controller (Light / Dark / Auto)
// Loaded synchronously in <head> of every extension page so the theme
// attribute is set on <html> BEFORE first paint (no FOUC). Reconciles
// with chrome.storage.local.snaptoaiSettings.theme asynchronously and
// reacts to cross-surface changes + OS prefers-color-scheme changes.
(function () {
  'use strict';

  var STORAGE_KEY = 'snaptoaiSettings';
  var CACHE_KEY = 'snaptoai_theme_cache';
  var VALID = { light: 1, dark: 1, auto: 1 };

  function getCachedTheme() {
    try {
      var v = localStorage.getItem(CACHE_KEY);
      if (v && VALID[v]) return v;
    } catch (e) {}
    // No cache yet (fresh install or first time on this surface).
    // Treat as 'auto' so the FIRST paint already honors the user's OS
    // preference instead of always flashing dark on light systems.
    return 'auto';
  }

  function resolveTheme(theme) {
    if (theme === 'auto') {
      try {
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      } catch (e) { return 'dark'; }
    }
    return theme === 'light' ? 'light' : 'dark';
  }

  var current = getCachedTheme();
  var listeners = [];

  function applyTheme(theme) {
    var resolved = resolveTheme(theme);
    var root = document.documentElement;
    if (root) {
      root.setAttribute('data-theme', resolved);
      root.setAttribute('data-theme-pref', theme);
    }
    try { localStorage.setItem(CACHE_KEY, theme); } catch (e) {}
    try {
      for (var i = 0; i < listeners.length; i++) listeners[i](theme, resolved);
    } catch (e) {}
  }

  // Apply immediately so the first paint matches user choice.
  applyTheme(current);

  // After DOM ready, re-apply once more in case <html> wasn't there yet.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { applyTheme(current); });
  }

  // Async reconcile with chrome.storage.local
  function syncFromStorage() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
      chrome.storage.local.get([STORAGE_KEY], function (res) {
        var settings = res && res[STORAGE_KEY];
        var stored;
        var needsPersist = false;
        if (settings && settings.theme && VALID[settings.theme]) {
          stored = settings.theme;
        } else if (!settings) {
          // Fresh install — no settings at all → default to auto.
          stored = 'auto';
        } else {
          // Existing user without theme key (legacy upgrade fallback if
          // the SW migration hasn't run yet) → keep dark (no regression)
          // AND persist so subsequent first-paints have no flash.
          stored = 'dark';
          needsPersist = true;
        }
        if (stored !== current) {
          current = stored;
          applyTheme(current);
        } else {
          // Even when no visual change, ensure cache is seeded so the
          // next surface load has the right value at first paint.
          try { localStorage.setItem(CACHE_KEY, stored); } catch (e) {}
        }
        if (needsPersist) {
          try {
            chrome.storage.local.set({
              snaptoaiSettings: Object.assign({}, settings, { theme: 'dark' })
            });
          } catch (e) {}
        }
      });
    } catch (e) {}
  }
  syncFromStorage();

  // Cross-surface live updates
  try {
    if (chrome && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'local' && changes[STORAGE_KEY]) {
          var nv = changes[STORAGE_KEY].newValue;
          var theme = nv && nv.theme;
          if (theme && VALID[theme] && theme !== current) {
            current = theme;
            applyTheme(current);
          }
        }
      });
    }
  } catch (e) {}

  // OS prefers-color-scheme listener (only matters in auto)
  try {
    var mql = window.matchMedia('(prefers-color-scheme: light)');
    var onPrefChange = function () { if (current === 'auto') applyTheme('auto'); };
    if (mql.addEventListener) mql.addEventListener('change', onPrefChange);
    else if (mql.addListener) mql.addListener(onPrefChange);
  } catch (e) {}

  // Public API used by header cycle buttons + options page
  window.SnapToAITheme = {
    get: function () { return current; },
    getResolved: function () { return resolveTheme(current); },
    set: function (theme) {
      if (!VALID[theme]) return;
      current = theme;
      applyTheme(current);
      try {
        if (chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get([STORAGE_KEY], function (res) {
            var settings = (res && res[STORAGE_KEY]) || {};
            settings.theme = theme;
            chrome.storage.local.set({ snaptoaiSettings: settings });
          });
        }
      } catch (e) {}
    },
    cycle: function () {
      var order = ['light', 'dark', 'auto'];
      var idx = order.indexOf(current);
      if (idx < 0) idx = 1;
      var next = order[(idx + 1) % order.length];
      this.set(next);
      return next;
    },
    onChange: function (cb) {
      if (typeof cb === 'function') listeners.push(cb);
    }
  };
})();
