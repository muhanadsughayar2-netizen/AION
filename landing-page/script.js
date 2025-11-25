// ====== ROTATING MESSAGE SYSTEM ======
let currentMessageIndex = 0;
const messages = ['fast', 'secure', 'productivity', 'ai'];
const messageRotationInterval = 4000; // 4 seconds per message
let autoRotateTimer;

function showMessage(index) {
    currentMessageIndex = index;
    const message = messages[index];
    
    // Hide all messages
    document.querySelectorAll('.hero-tagline span').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.hero-description span').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.story-scene').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.dot').forEach(el => el.classList.remove('active'));
    
    // Show current message
    document.querySelector(`.message-${message}`).classList.remove('hidden');
    document.querySelector(`.desc-${message}`).classList.remove('hidden');
    document.querySelector(`.scene-${message}`).classList.add('active');
    document.querySelector(`[data-message="${message}"]`).classList.add('active');
    
    // Reset auto-rotate timer
    clearInterval(autoRotateTimer);
    autoRotateTimer = setInterval(() => {
        const nextIndex = (currentMessageIndex + 1) % messages.length;
        showMessage(nextIndex);
    }, messageRotationInterval);
}

// ====== INITIALIZE MESSAGE SYSTEM ======
function initializeMessageSystem() {
    // Set initial message
    showMessage(0);
    
    // Add click handlers to dots
    document.querySelectorAll('.message-dots .dot').forEach((dot, index) => {
        dot.addEventListener('click', () => showMessage(index));
    });
    
    // Auto-rotate messages
    autoRotateTimer = setInterval(() => {
        const nextIndex = (currentMessageIndex + 1) % messages.length;
        showMessage(nextIndex);
    }, messageRotationInterval);
}

// ====== LANGUAGE DETECTION & TRANSLATION ======
const DEFAULT_LANG = 'en';
let currentLang = DEFAULT_LANG;

function detectLanguage() {
    if (typeof supportedLanguages === 'undefined') {
        return DEFAULT_LANG;
    }
    
    const browserLang = navigator.language || navigator.userLanguage;
    const langCode = browserLang.split('-')[0];
    
    if (supportedLanguages[langCode]) {
        return langCode;
    }
    return DEFAULT_LANG;
}

function updateLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('selectedLanguage', lang);
    
    document.querySelectorAll('[id]').forEach(element => {
        const key = element.id;
        if (translations[lang] && translations[lang][key]) {
            element.textContent = translations[lang][key];
        }
    });
    
    document.documentElement.lang = lang;
}

function initializeLanguage() {
    const savedLang = localStorage.getItem('selectedLanguage');
    const lang = savedLang || detectLanguage();
    updateLanguage(lang);
}

// ====== LANGUAGE SWITCHER ======
function initializeLanguageSwitcher() {
    const langSwitch = document.getElementById('langSwitch');
    if (!langSwitch) return;
    
    if (typeof supportedLanguages === 'undefined') {
        return;
    }
    
    langSwitch.addEventListener('click', () => {
        const langs = Object.keys(supportedLanguages);
        const currentIndex = langs.indexOf(currentLang);
        const nextIndex = (currentIndex + 1) % langs.length;
        const nextLang = langs[nextIndex];
        
        updateLanguage(nextLang);
        langSwitch.textContent = supportedLanguages[nextLang];
    });
}

// ====== TASTE IT NOW DEMO ======
function initializeTasteDemo() {
    const tasteButton = document.getElementById('tasteButton');
    const tasteButtonBottom = document.getElementById('tasteButtonBottom');
    const tasteModal = document.getElementById('tasteModal');
    const tasteModalClose = document.getElementById('tasteModalClose');
    const step1 = document.getElementById('tasteStep1');
    const step2 = document.getElementById('tasteStep2');
    const step3 = document.getElementById('tasteStep3');
    const tasteCountdown = document.getElementById('tasteCountdown');
    const tasteCopyBtn = document.getElementById('tasteCopyBtn');
    const tasteCodeBlock = document.getElementById('tasteCodeBlock').querySelector('code');
    
    // Sample code snippets
    const sampleCodes = {
        dashboard: `export default function Dashboard() {
  return (
    <div className="grid grid-cols-3 gap-4 p-8">
      <div className="col-span-2 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg p-6">
        <h2 className="text-2xl font-bold text-white">Revenue</h2>
        <p className="text-4xl font-black text-white mt-2">$45,230</p>
      </div>
      <div className="bg-cyan-500 rounded-lg p-6">
        <h3 className="text-white font-bold">Users</h3>
        <p className="text-3xl text-white mt-2">12.5k</p>
      </div>
    </div>
  );
}`,
        login: `export default function LoginForm() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
      <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-8 w-96 shadow-2xl">
        <h1 className="text-3xl font-bold text-white mb-6">Welcome Back</h1>
        <input type="email" placeholder="Email" className="w-full px-4 py-2 rounded-lg mb-4 bg-white/20 text-white placeholder-white/60 border border-white/30" />
        <input type="password" placeholder="Password" className="w-full px-4 py-2 rounded-lg mb-6 bg-white/20 text-white placeholder-white/60 border border-white/30" />
        <button className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-bold py-2 rounded-lg hover:shadow-lg transition">Sign In</button>
      </div>
    </div>
  );
}`,
        hero: `export default function Hero() {
  return (
    <section className="min-h-screen flex items-center justify-center bg-gradient-to-r from-purple-900 via-black to-cyan-900 relative overflow-hidden">
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-20 left-10 w-72 h-72 bg-purple-500 rounded-full mix-blend-screen filter blur-3xl"></div>
        <div className="absolute bottom-10 right-10 w-72 h-72 bg-cyan-500 rounded-full mix-blend-screen filter blur-3xl"></div>
      </div>
      <div className="relative z-10 text-center max-w-2xl px-6">
        <h1 className="text-6xl font-black text-white mb-4">Build the Future</h1>
        <p className="text-xl text-gray-300 mb-8">Ship faster with AI-powered development tools</p>
        <button className="bg-gradient-to-r from-purple-500 to-cyan-500 text-white font-bold px-8 py-4 rounded-lg text-lg hover:shadow-2xl transition">Get Started Free</button>
      </div>
    </section>
  );
}`
    };
    
    function openModal() {
        tasteModal.classList.add('open');
        step1.classList.remove('hidden');
        step2.classList.add('hidden');
        step3.classList.add('hidden');
    }
    
    function closeModal() {
        tasteModal.classList.remove('open');
    }
    
    tasteButton?.addEventListener('click', openModal);
    tasteButtonBottom?.addEventListener('click', openModal);
    tasteModalClose?.addEventListener('click', closeModal);
    
    // Sample card clicks
    document.querySelectorAll('.taste-sample-card').forEach(card => {
        card.addEventListener('click', () => {
            const sample = card.dataset.sample;
            step1.classList.add('hidden');
            step2.classList.remove('hidden');
            step3.classList.add('hidden');
            
            // Countdown
            let count = 6;
            tasteCountdown.textContent = count;
            
            const countdownInterval = setInterval(() => {
                count--;
                tasteCountdown.textContent = count;
                
                if (count <= 0) {
                    clearInterval(countdownInterval);
                    step2.classList.add('hidden');
                    step3.classList.remove('hidden');
                    
                    // Show code
                    tasteCodeBlock.textContent = sampleCodes[sample] || sampleCodes.dashboard;
                    
                    // Confetti celebration
                    if (typeof confetti !== 'undefined') {
                        confetti({
                            particleCount: 100,
                            spread: 70,
                            origin: { y: 0.6 }
                        });
                    }
                }
            }, 1000);
        });
    });
    
    // Copy button
    tasteCopyBtn?.addEventListener('click', () => {
        navigator.clipboard.writeText(tasteCodeBlock.textContent).then(() => {
            tasteCopyBtn.textContent = '✓ Copied!';
            setTimeout(() => {
                tasteCopyBtn.textContent = 'Copy Code';
            }, 2000);
        });
    });
    
    // Modal close on background click
    tasteModal?.addEventListener('click', (e) => {
        if (e.target === tasteModal) {
            closeModal();
        }
    });
}

// ====== INITIALIZATION ======
document.addEventListener('DOMContentLoaded', () => {
    initializeLanguage();
    initializeLanguageSwitcher();
    initializeMessageSystem();
    initializeTasteDemo();
});
