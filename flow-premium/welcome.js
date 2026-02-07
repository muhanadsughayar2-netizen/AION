// Welcome page - minimal JS (no animations needed for clean design)
// All styling and animations handled in CSS

// Unlock Pro button - CSP compliant (no inline handlers)
document.addEventListener('DOMContentLoaded', () => {
  const unlockBtn = document.getElementById('unlockProBtn');
  if (unlockBtn) {
    unlockBtn.addEventListener('click', () => {
      window.open('https://snaptoai.lemonsqueezy.com/buy/yearly', '_blank');
    });
  }
});
