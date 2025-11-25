// ===== CAROUSEL SYSTEM =====
let currentMessageIndex = 0;
const MESSAGE_INTERVAL = 5000;
let carouselTimer;

function rotateCarousel() {
    // Hide all messages and image sets
    document.querySelectorAll('.carousel-message').forEach(msg => msg.classList.remove('active'));
    document.querySelectorAll('.left-images .images-set').forEach(set => set.classList.remove('active'));
    document.querySelectorAll('.right-images .images-set').forEach(set => set.classList.remove('active'));
    
    // Show current message and images
    document.querySelectorAll('.carousel-message')[currentMessageIndex].classList.add('active');
    document.querySelectorAll('.left-images .images-set')[currentMessageIndex].classList.add('active');
    document.querySelectorAll('.right-images .images-set')[currentMessageIndex].classList.add('active');
    
    // Move to next
    currentMessageIndex = (currentMessageIndex + 1) % 4;
    
    // Schedule next rotation
    carouselTimer = setTimeout(rotateCarousel, MESSAGE_INTERVAL);
}

function initializeCarousel() {
    // Show first message and images
    document.querySelectorAll('.carousel-message')[0].classList.add('active');
    document.querySelectorAll('.left-images .images-set')[0].classList.add('active');
    document.querySelectorAll('.right-images .images-set')[0].classList.add('active');
    
    // Start rotation
    carouselTimer = setTimeout(rotateCarousel, MESSAGE_INTERVAL);
}

// ===== LANGUAGE SYSTEM =====
const DEFAULT_LANG = 'en';
let currentLang = DEFAULT_LANG;

function detectLanguage() {
    if (typeof supportedLanguages === 'undefined') return DEFAULT_LANG;
    const browserLang = navigator.language || navigator.userLanguage;
    const langCode = browserLang.split('-')[0];
    return supportedLanguages[langCode] ? langCode : DEFAULT_LANG;
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

function initializeLanguageSwitcher() {
    const langSwitch = document.getElementById('langSwitch');
    if (!langSwitch || typeof supportedLanguages === 'undefined') return;
    
    langSwitch.addEventListener('click', () => {
        const langs = Object.keys(supportedLanguages);
        const currentIndex = langs.indexOf(currentLang);
        const nextIndex = (currentIndex + 1) % langs.length;
        updateLanguage(langs[nextIndex]);
    });
}

// ===== DEMO MODAL =====
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
    
    const sampleCodes = {
        dashboard: `export default function Dashboard() {
  return (
    <div className="grid grid-cols-3 gap-4 p-8">
      <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg p-6">
        <h2 className="text-2xl font-bold text-white">Revenue</h2>
        <p className="text-4xl font-black text-white mt-2">$45,230</p>
      </div>
    </div>
  );
}`,
        login: `export default function LoginForm() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="bg-white/10 rounded-2xl p-8 w-96">
        <h1 className="text-3xl font-bold text-white mb-6">Welcome</h1>
        <button className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-bold py-2 rounded-lg">Sign In</button>
      </div>
    </div>
  );
}`,
        hero: `export default function Hero() {
  return (
    <section className="min-h-screen bg-gradient-to-r from-purple-900 to-cyan-900 flex items-center justify-center">
      <h1 className="text-6xl font-black text-white">Build the Future</h1>
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
    
    document.querySelectorAll('.taste-sample-card').forEach(card => {
        card.addEventListener('click', () => {
            const sample = card.dataset.sample;
            step1.classList.add('hidden');
            step2.classList.remove('hidden');
            
            let count = 6;
            tasteCountdown.textContent = count;
            
            const interval = setInterval(() => {
                count--;
                tasteCountdown.textContent = count;
                if (count <= 0) {
                    clearInterval(interval);
                    step2.classList.add('hidden');
                    step3.classList.remove('hidden');
                    tasteCodeBlock.textContent = sampleCodes[sample] || sampleCodes.dashboard;
                    if (typeof confetti !== 'undefined') {
                        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
                    }
                }
            }, 1000);
        });
    });
    
    tasteCopyBtn?.addEventListener('click', () => {
        navigator.clipboard.writeText(tasteCodeBlock.textContent).then(() => {
            tasteCopyBtn.textContent = '✓ Copied!';
            setTimeout(() => { tasteCopyBtn.textContent = 'Copy Code'; }, 2000);
        });
    });
    
    tasteModal?.addEventListener('click', (e) => {
        if (e.target === tasteModal) closeModal();
    });
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
    initializeLanguage();
    initializeLanguageSwitcher();
    initializeCarousel();
    initializeTasteDemo();
});
