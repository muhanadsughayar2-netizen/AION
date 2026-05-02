(function () {
  'use strict';

  var labels = { light: 'Light', dark: 'Dark', auto: 'Auto (matches system)' };
  var nextOf = { light: 'dark', dark: 'auto', auto: 'light' };

  function wire() {
    var btn = document.getElementById('themeCycleBtn');
    if (!btn || !window.SnapToAITheme) return false;
    if (btn.__snapWired) return true;
    btn.__snapWired = true;

    function refresh() {
      var pref = window.SnapToAITheme.get();
      btn.title = 'Theme: ' + labels[pref] + ' — click for ' + labels[nextOf[pref]];
      btn.setAttribute('aria-label',
        'Theme: ' + labels[pref] + '. Click to switch to ' + labels[nextOf[pref]] + '.');
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
