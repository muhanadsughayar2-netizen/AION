// ===== CAROUSEL ROTATION =====
let currentSlide = 0;
const slides = document.querySelectorAll('.carousel-slide');
const ROTATE_INTERVAL = 6000;
let rotationTimer;

function rotateSlide() {
    slides.forEach(s => s.classList.remove('active'));
    currentSlide = (currentSlide + 1) % slides.length;
    slides[currentSlide].classList.add('active');
}

function startRotation() {
    slides[0].classList.add('active');
    rotationTimer = setInterval(rotateSlide, ROTATE_INTERVAL);
}

// ===== DEMO MODAL =====
function initDemo() {
    const tasteBtn = document.getElementById('tasteButton');
    const modal = document.getElementById('tasteModal');
    const closeBtn = document.getElementById('tasteModalClose');
    const copyBtn = document.getElementById('copyBtn');
    const codeBlock = document.getElementById('codeBlock').querySelector('code');
    
    const sampleCodes = {
        dashboard: `export default function Dashboard() {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg p-6">
        <h2 className="text-white font-bold">Revenue</h2>
        <p className="text-4xl text-white font-black">$45,230</p>
      </div>
    </div>
  );
}`,
        login: `export default function LoginForm() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
      <form className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 w-96">
        <h1 className="text-white text-3xl font-bold mb-6">Welcome</h1>
        <button className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-bold py-2 rounded-lg">Sign In</button>
      </form>
    </div>
  );
}`,
        hero: `export default function Hero() {
  return (
    <section className="min-h-screen flex items-center justify-center bg-gradient-to-r from-purple-900 via-black to-cyan-900">
      <h1 className="text-6xl font-black text-white">Build the Future</h1>
    </section>
  );
}`
    };

    tasteBtn?.addEventListener('click', () => {
        modal.classList.add('open');
        document.getElementById('demoStep1').classList.remove('hidden');
        document.getElementById('demoStep2').classList.add('hidden');
        document.getElementById('demoStep3').classList.add('hidden');
    });

    closeBtn?.addEventListener('click', () => {
        modal.classList.remove('open');
    });

    document.querySelectorAll('.demo-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const sample = btn.textContent.toLowerCase();
            document.getElementById('demoStep1').classList.add('hidden');
            document.getElementById('demoStep2').classList.remove('hidden');

            let count = 6;
            const countdown = document.getElementById('countdown');
            countdown.textContent = count;

            const timer = setInterval(() => {
                count--;
                countdown.textContent = count;
                if (count <= 0) {
                    clearInterval(timer);
                    document.getElementById('demoStep2').classList.add('hidden');
                    document.getElementById('demoStep3').classList.remove('hidden');
                    
                    const sampleKey = sample.includes('dashboard') ? 'dashboard' : 
                                     sample.includes('login') ? 'login' : 'hero';
                    codeBlock.textContent = sampleCodes[sampleKey];
                    
                    if (typeof confetti !== 'undefined') {
                        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
                    }
                }
            }, 1000);
        });
    });

    copyBtn?.addEventListener('click', () => {
        navigator.clipboard.writeText(codeBlock.textContent).then(() => {
            copyBtn.textContent = '✓ Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy Code'; }, 2000);
        });
    });

    modal?.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('open');
    });
}

// ===== LANGUAGE =====
const DEFAULT_LANG = 'en';
let currentLang = DEFAULT_LANG;

function updateLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('selectedLanguage', lang);
    document.querySelectorAll('[id]').forEach(el => {
        if (translations[lang] && translations[lang][el.id]) {
            el.textContent = translations[lang][el.id];
        }
    });
}

function initLanguage() {
    const saved = localStorage.getItem('selectedLanguage');
    const lang = saved || navigator.language.split('-')[0];
    updateLanguage(lang || DEFAULT_LANG);
}

function initLangSwitch() {
    const btn = document.getElementById('langSwitch');
    if (!btn || typeof supportedLanguages === 'undefined') return;
    btn.addEventListener('click', () => {
        const langs = Object.keys(supportedLanguages);
        const idx = langs.indexOf(currentLang);
        const next = langs[(idx + 1) % langs.length];
        updateLanguage(next);
    });
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
    initLanguage();
    initLangSwitch();
    startRotation();
    initDemo();
});
