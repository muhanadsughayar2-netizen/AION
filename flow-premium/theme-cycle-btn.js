(function () {
  'use strict';

  var labels = { light: 'Light', dark: 'Dark', auto: 'Auto' };
  var nextLabels = { light: 'Light', dark: 'Dark', auto: 'Auto (matches system)' };
  var nextOf = { light: 'dark', dark: 'auto', auto: 'light' };

  function wire() {
    var btn = document.getElementById('themeCycleBtn');
    if (!btn || !window.SnapToAITheme) return false;
    if (btn.__snapWired) return true;
    btn.__snapWired = true;

    function refresh() {
      var pref = window.SnapToAITheme.get();
      var resolved = window.SnapToAITheme.getResolved();
      var prefLabel = labels[pref];
      // When in Auto, surface the OS-resolved appearance so the user can
      // tell Auto apart from a fixed Light/Dark choice that happens to
      // look the same right now.
      var current = pref === 'auto'
        ? prefLabel + ' (currently ' + labels[resolved] + ')'
        : prefLabel;
      btn.title = 'Theme: ' + current + ' — click for ' + nextLabels[nextOf[pref]];
      btn.setAttribute('aria-label',
        'Theme: ' + current + '. Click to switch to ' + nextLabels[nextOf[pref]] + '.');
    }

    btn.addEventListener('click', function () {
      window.SnapToAITheme.cycle();
      refresh();
    });
    window.SnapToAITheme.onChange(refresh);
    refresh();
    return true;
  }

  if (!wire()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', wire);
    } else {
      setTimeout(wire, 0);
    }
  }
})();
