// Welcome page - CSP compliant event handlers
document.addEventListener('DOMContentLoaded', () => {
  // Pro subscribe button
  const proBtn = document.getElementById('proSubscribeBtn');
  if (proBtn) {
    proBtn.addEventListener('click', () => {
      window.open('https://gumroad.com/l/YOUR_YEARLY_LINK', '_blank');
    });
  }
});
