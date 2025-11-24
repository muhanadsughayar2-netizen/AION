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
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth' });
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

// Initialize everything on page load
document.addEventListener('DOMContentLoaded', () => {
    initLanguage();
    setupLanguageModal();
    setupFAQ();
    setupSmoothScroll();
    setupScrollAnimations();
    setupCTAButtons();
    
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
