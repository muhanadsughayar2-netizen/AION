// Language detection and management
const DEFAULT_LANG = 'en';
let currentLang = DEFAULT_LANG;

// Get user's browser language
function detectBrowserLanguage() {
    const browserLang = navigator.language.split('-')[0];
    const availableLangs = Object.keys(translations);
    
    if (availableLangs.includes(browserLang)) {
        return browserLang;
    }
    
    // Check for regional variants
    const regionVariant = navigator.language.replace('-', '_');
    if (availableLangs.includes(regionVariant)) {
        return regionVariant;
    }
    
    return DEFAULT_LANG;
}

// Initialize language
function initLanguage() {
    const savedLang = localStorage.getItem('snaptoai-lang');
    currentLang = savedLang || detectBrowserLanguage();
    updatePageLanguage();
}

// Update all text on page
function updatePageLanguage() {
    const lang = translations[currentLang] || translations[DEFAULT_LANG];
    
    // Update all elements with data-i18n
    document.querySelectorAll('[id]').forEach(el => {
        const key = el.id;
        if (lang[key]) {
            el.textContent = lang[key];
        }
    });
    
    // Save language preference
    localStorage.setItem('snaptoai-lang', currentLang);
    
    // Update HTML lang attribute
    document.documentElement.lang = currentLang;
}

// Build language switcher
function buildLanguageSwitcher() {
    const languageGrid = document.getElementById('languageGrid');
    const languages = {
        en: 'English',
        am: 'አማርኛ',
        ar: 'العربية',
        bg: 'Български',
        bn: 'বাংলা',
        ca: 'Català',
        cs: 'Čeština',
        da: 'Dansk',
        de: 'Deutsch',
        el: 'Ελληνικά',
        es: 'Español',
        et: 'Eesti',
        fi: 'Suomi',
        fil: 'Filipino',
        fr: 'Français',
        gu: 'ગુજરાતી',
        he: 'עברית',
        hi: 'हिन्दी',
        hr: 'Hrvatski',
        hu: 'Magyar',
        id: 'Bahasa Indonesia',
        it: 'Italiano',
        ja: '日本語',
        kn: 'ಕನ್ನಡ',
        ko: '한국어',
        lt: 'Lietuvių',
        lv: 'Latviešu',
        ml: 'മലയാളം',
        mr: 'मराठी',
        nb: 'Norsk',
        nl: 'Nederlands',
        or: 'ଓଡିଆ',
        pl: 'Polski',
        pt: 'Português',
        pt_BR: 'Português (BR)',
        pt_PT: 'Português (PT)',
        ro: 'Română',
        ru: 'Русский',
        sk: 'Slovenčina',
        sl: 'Slovenščina',
        sr: 'Српски',
        sv: 'Svenska',
        sw: 'Kiswahili',
        ta: 'தமிழ்',
        te: 'తెలుగు',
        th: 'ไทย',
        tr: 'Türkçe',
        uk: 'Українська',
        vi: 'Tiếng Việt',
        zh: '中文',
        zh_TW: '繁體中文',
        en_GB: 'English (UK)',
        en_US: 'English (US)',
        es_419: 'Español (LatAm)',
    };
    
    languageGrid.innerHTML = '';
    
    Object.keys(languages).forEach(langCode => {
        const btn = document.createElement('button');
        btn.className = 'language-btn';
        if (langCode === currentLang) {
            btn.classList.add('active');
        }
        btn.textContent = languages[langCode];
        btn.onclick = () => {
            currentLang = langCode;
            updatePageLanguage();
            document.querySelectorAll('.language-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        };
        languageGrid.appendChild(btn);
    });
}

// Language modal
function setupLanguageModal() {
    const langSwitch = document.getElementById('langSwitch');
    const languageModal = document.getElementById('languageModal');
    const closeModal = document.getElementById('closeModal');
    
    langSwitch.addEventListener('click', () => {
        languageModal.classList.add('active');
        buildLanguageSwitcher();
    });
    
    closeModal.addEventListener('click', () => {
        languageModal.classList.remove('active');
    });
    
    languageModal.addEventListener('click', (e) => {
        if (e.target === languageModal) {
            languageModal.classList.remove('active');
        }
    });
}

// FAQ Accordion
function setupFAQ() {
    const faqItems = document.querySelectorAll('.faq-item');
    
    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        
        question.addEventListener('click', () => {
            // Close other items
            faqItems.forEach(i => {
                if (i !== item) {
                    i.classList.remove('active');
                }
            });
            
            // Toggle current item
            item.classList.toggle('active');
        });
    });
}

// Smooth scroll
function setupSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (href && href.length > 1) {
                e.preventDefault();
                const target = document.querySelector(href);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth' });
                }
            }
        });
    });
}

// Scroll animations
function setupScrollAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);
    
    document.querySelectorAll('.feature-card, .step, .testimonial-card, .faq-item').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });
}

// CTA Button ripple effect
function setupCTAButtons() {
    document.querySelectorAll('.cta-button').forEach(btn => {
        btn.addEventListener('click', function(e) {
            // Check if this is an external link (Chrome Web Store)
            if (this.href && this.href.includes('chrome.google.com')) {
                // Just let the browser handle it naturally
                return;
            }
            
            const rect = this.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const ripple = document.createElement('span');
            ripple.style.position = 'absolute';
            ripple.style.left = x + 'px';
            ripple.style.top = y + 'px';
            ripple.style.width = '0px';
            ripple.style.height = '0px';
            ripple.style.background = 'rgba(255,255,255,0.5)';
            ripple.style.borderRadius = '50%';
            ripple.style.pointerEvents = 'none';
            ripple.style.animation = 'ripple 0.6s ease-out';
            
            this.style.position = 'relative';
            this.style.overflow = 'hidden';
            this.appendChild(ripple);
            
            setTimeout(() => ripple.remove(), 600);
        });
    });
}

// Add ripple animation
const style = document.createElement('style');
style.textContent = `
    @keyframes ripple {
        to {
            width: 300px;
            height: 300px;
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Copy to clipboard (for future features)
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        console.log('Copied to clipboard');
    });
}

// Taste It Now Demo
const SAMPLE_CODES = {
    dashboard: `export default function Dashboard() {
  return (
    <div className="min-h-screen bg-slate-900 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-8">
          Dashboard
        </h1>
        <div className="grid grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} 
              className="bg-slate-800 rounded-lg p-6 border border-cyan-500/20">
              <p className="text-cyan-400 text-sm font-semibold">
                Metric {i}
              </p>
              <p className="text-3xl font-bold text-white mt-2">
                $45,231
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}`,
    login: `export default function LoginScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen 
      bg-gradient-to-br from-purple-900 to-purple-700">
      <div className="w-full max-w-md p-8 bg-white/10 rounded-2xl 
        backdrop-blur-xl border border-white/20">
        <h2 className="text-3xl font-bold text-white mb-6">
          Sign In
        </h2>
        <input type="email" placeholder="Email" 
          className="w-full mb-4 px-4 py-3 rounded-lg 
          bg-white/10 border border-white/20 text-white" />
        <input type="password" placeholder="Password" 
          className="w-full mb-6 px-4 py-3 rounded-lg 
          bg-white/10 border border-white/20 text-white" />
        <button className="w-full py-3 bg-purple-500 
          rounded-lg font-bold text-white hover:bg-purple-600">
          Sign In
        </button>
      </div>
    </div>
  );
}`,
    hero: `export default function HeroSection() {
  return (
    <section className="min-h-screen bg-gradient-to-br 
      from-cyan-900 via-blue-900 to-slate-900 flex items-center">
      <div className="max-w-4xl mx-auto px-8 text-center">
        <h1 className="text-6xl font-black text-white mb-6">
          Convert Screenshots
          <span className="text-cyan-400"> to Code</span>
        </h1>
        <p className="text-xl text-slate-200 mb-8">
          Turn any screenshot into perfect React code instantly.
        </p>
        <button className="px-8 py-4 bg-cyan-500 text-slate-900 
          rounded-lg font-bold text-lg hover:bg-cyan-400 
          transition-all">
          Try It Now
        </button>
      </div>
    </section>
  );
}`
};

function setupTasteDemo() {
    const tasteButton = document.getElementById('tasteButton');
    const tasteModal = document.getElementById('tasteModal');
    const tasteModalClose = document.getElementById('tasteModalClose');
    const tasteStep1 = document.getElementById('tasteStep1');
    const tasteStep2 = document.getElementById('tasteStep2');
    const tasteStep3 = document.getElementById('tasteStep3');
    const sampleCards = document.querySelectorAll('.taste-sample-card');
    const tasteCopyBtn = document.getElementById('tasteCopyBtn');
    const tasteBuyBtn = document.getElementById('tasteBuyBtn');

    if (!tasteButton) return;

    tasteButton.addEventListener('click', () => {
        tasteModal.classList.add('active');
        resetTasteDemo();
    });

    tasteModalClose.addEventListener('click', () => {
        tasteModal.classList.remove('active');
    });

    tasteModal.addEventListener('click', (e) => {
        if (e.target === tasteModal) {
            tasteModal.classList.remove('active');
        }
    });

    sampleCards.forEach(card => {
        card.addEventListener('click', () => {
            const sample = card.dataset.sample;
            startCountdown(sample);
        });
    });

    tasteCopyBtn.addEventListener('click', () => {
        const codeBlock = document.getElementById('tasteCodeBlock');
        navigator.clipboard.writeText(codeBlock.textContent).then(() => {
            const original = tasteCopyBtn.textContent;
            tasteCopyBtn.textContent = '✓ Copied!';
            setTimeout(() => {
                tasteCopyBtn.textContent = original;
            }, 2000);
        });
    });

    tasteBuyBtn.addEventListener('click', () => {
        alert('Lifetime deal purchase coming soon! Thanks for your interest.');
    });

    function startCountdown(sample) {
        tasteStep1.classList.add('hidden');
        tasteStep2.classList.remove('hidden');
        tasteStep3.classList.add('hidden');

        let count = 5;
        const countdownEl = document.getElementById('tasteCountdown');
        countdownEl.textContent = count;

        const interval = setInterval(() => {
            count--;
            if (count > 0) {
                countdownEl.textContent = count;
            } else {
                clearInterval(interval);
                showCode(sample);
            }
        }, 1000);
    }

    function showCode(sample) {
        tasteStep2.classList.add('hidden');
        tasteStep3.classList.remove('hidden');

        const codeBlock = document.getElementById('tasteCodeBlock');
        codeBlock.textContent = SAMPLE_CODES[sample] || SAMPLE_CODES.dashboard;
    }

    function resetTasteDemo() {
        tasteStep1.classList.remove('hidden');
        tasteStep2.classList.add('hidden');
        tasteStep3.classList.add('hidden');
    }
}

// Initialize everything on page load
document.addEventListener('DOMContentLoaded', () => {
    initLanguage();
    setupLanguageModal();
    setupFAQ();
    setupSmoothScroll();
    setupScrollAnimations();
    setupCTAButtons();
    setupTasteDemo();
    
    // Add smooth page load
    document.body.style.opacity = '0';
    setTimeout(() => {
        document.body.style.transition = 'opacity 0.5s ease';
        document.body.style.opacity = '1';
    }, 100);
});

// Handle visibility change
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        // Refresh language if it changed
        const savedLang = localStorage.getItem('snaptoai-lang');
        if (savedLang && savedLang !== currentLang) {
            currentLang = savedLang;
            updatePageLanguage();
        }
    }
});
