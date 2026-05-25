// Reveal on scroll
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      io.unobserve(e.target);
    }
  });
}, { threshold: 0.08 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

// Fallback — ensure everything visible after 1s even if observer misses
setTimeout(() => {
  document.querySelectorAll('.reveal:not(.visible)').forEach(el => el.classList.add('visible'));
}, 1000);

// Legal modal
function openLegal(title, html) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('legalModal').classList.add('open');
}
function closeLegal() {
  document.getElementById('legalModal').classList.remove('open');
}
document.getElementById('legalModal').addEventListener('click', function(e) {
  if (e.target === this) closeLegal();
});

// Studio vertical tab switching
function selectVTab(clicked) {
  clicked.closest('.v-tabs').querySelectorAll('.v-tab').forEach(t => t.classList.remove('active'));
  clicked.classList.add('active');
}

// Admin link
document.getElementById('adminLink').addEventListener('click', (e) => {
  e.preventDefault();
  const pw = prompt('Owner password:');
  if (!pw) return;
  window.open('/admin-dashboard?password=' + encodeURIComponent(pw), '_blank');
});
