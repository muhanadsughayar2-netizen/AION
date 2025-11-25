// Carousel rotation
let currentSlide = 0;
const slides = document.querySelectorAll('.carousel-slide');
const INTERVAL = 6000;
let timer;

function nextSlide() {
    slides[currentSlide].classList.remove('active');
    currentSlide = (currentSlide + 1) % slides.length;
    slides[currentSlide].classList.add('active');
}

function startCarousel() {
    timer = setInterval(nextSlide, INTERVAL);
}

// Demo modal
function initDemo() {
    const demoBtn = document.getElementById('demoBtn');
    const modal = document.getElementById('demoModal');
    const closeModal = document.getElementById('closeModal');
    const copyBtn = document.getElementById('copyBtn');
    const code = document.querySelector('#codeBox code');

    const codes = {
        dashboard: `export default function Dashboard() {
  return (
    <div className="grid grid-cols-3 gap-4 p-6">
      <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg p-6 text-white">
        <p className="text-sm">Revenue</p>
        <p className="text-3xl font-bold">$45,230</p>
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

    demoBtn?.addEventListener('click', () => {
        modal.classList.add('open');
        showStep('step1');
    });

    closeModal?.addEventListener('click', () => modal.classList.remove('open'));

    document.querySelectorAll('.opt').forEach(btn => {
        btn.addEventListener('click', () => {
            showStep('step2');
            let count = 6;
            const countDown = document.getElementById('countDown');
            countDown.textContent = count;

            const timer = setInterval(() => {
                count--;
                countDown.textContent = count;
                if (count <= 0) {
                    clearInterval(timer);
                    const type = btn.dataset.type || 'dashboard';
                    code.textContent = codes[type] || codes.dashboard;
                    showStep('step3');
                    if (typeof confetti !== 'undefined') {
                        confetti({ particleCount: 100, spread: 70 });
                    }
                }
            }, 1000);
        });
    });

    copyBtn?.addEventListener('click', () => {
        navigator.clipboard.writeText(code.textContent).then(() => {
            copyBtn.textContent = '✓ Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
        });
    });

    modal?.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('open');
    });
}

function showStep(stepId) {
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    document.getElementById(stepId)?.classList.add('active');
}

// Language
let currentLang = 'en';

function updateLang(lang) {
    currentLang = lang;
    localStorage.setItem('lang', lang);
    document.querySelectorAll('[id]').forEach(el => {
        if (translations[lang] && translations[lang][el.id]) {
            el.textContent = translations[lang][el.id];
        }
    });
}

function initLang() {
    const saved = localStorage.getItem('lang');
    const lang = saved || navigator.language.split('-')[0];
    updateLang(lang || 'en');
}

function initLangSwitch() {
    const btn = document.getElementById('langSwitch');
    if (!btn || typeof supportedLanguages === 'undefined') return;
    
    btn.addEventListener('click', () => {
        const langs = Object.keys(supportedLanguages);
        const idx = langs.indexOf(currentLang);
        updateLang(langs[(idx + 1) % langs.length]);
    });
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    startCarousel();
    initDemo();
    initLang();
    initLangSwitch();
});
