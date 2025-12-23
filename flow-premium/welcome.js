// Generate floating particles
document.addEventListener('DOMContentLoaded', function() {
  const particlesContainer = document.getElementById('particles');
  const particleTypes = ['⭐', '✨', '🌟'];
  
  for (let i = 0; i < 20; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.textContent = particleTypes[Math.floor(Math.random() * particleTypes.length)];
    particle.style.left = Math.random() * 100 + '%';
    particle.style.top = Math.random() * 100 + '%';
    particle.style.fontSize = (16 + Math.random() * 16) + 'px';
    particle.style.animationDelay = Math.random() * 5 + 's';
    particle.style.animationDuration = (4 + Math.random() * 4) + 's';
    particlesContainer.appendChild(particle);
  }
});

// Close button handler
document.addEventListener('DOMContentLoaded', function() {
  const ctaButton = document.getElementById('ctaButton');
  if (ctaButton) {
    ctaButton.addEventListener('click', function() {
      window.close();
    });
  }
});
