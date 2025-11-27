// SEO-optimized script for multi-language pages
// Each language has its own URL: /en/, /ar/, /es/, etc.

document.addEventListener('DOMContentLoaded', function() {
    // Language modal handling
    const langSwitch = document.getElementById('langSwitch');
    const languageModal = document.getElementById('languageModal');
    const closeModal = document.getElementById('closeModal');
    const languageGrid = document.getElementById('languageGrid');

    // All supported languages
    const languages = {
        "en": "English",
        "ar": "العربية",
        "he": "עברית",
        "fr": "Français",
        "de": "Deutsch",
        "es": "Español",
        "es_419": "Español (Latinoamérica)",
        "it": "Italiano",
        "pt": "Português",
        "pt_BR": "Português (Brasil)",
        "pt_PT": "Português (Portugal)",
        "ja": "日本語",
        "zh": "中文",
        "zh_TW": "繁體中文",
        "nl": "Nederlands",
        "pl": "Polski",
        "ru": "Русский",
        "tr": "Türkçe",
        "vi": "Tiếng Việt",
        "th": "ไทย",
        "ko": "한국어",
        "hi": "हिन्दी",
        "bn": "বাংলা",
        "gu": "ગુજરાતી",
        "ta": "தமிழ்",
        "te": "తెలుగు",
        "kn": "ಕನ್ನಡ",
        "ml": "മലയാളം",
        "mr": "मराठी",
        "or": "ଓଡ଼ିଆ",
        "bg": "Български",
        "cs": "Čeština",
        "da": "Dansk",
        "el": "Ελληνικά",
        "et": "Eesti",
        "fi": "Suomi",
        "hu": "Magyar",
        "id": "Bahasa Indonesia",
        "lt": "Lietuvių",
        "lv": "Latviešu",
        "nb": "Norsk",
        "ro": "Română",
        "sk": "Slovenčina",
        "sl": "Slovenščina",
        "sr": "Српски",
        "sv": "Svenska",
        "uk": "Українська",
        "hr": "Hrvatski",
        "ca": "Català",
        "sw": "Kiswahili",
        "fil": "Filipino",
        "en_GB": "English (UK)",
        "en_US": "English (US)",
        "am": "አማርኛ"
    };

    // Populate language grid
    if (languageGrid) {
        for (const [code, name] of Object.entries(languages)) {
            const button = document.createElement('button');
            button.className = 'language-option';
            button.textContent = name;
            
            // Highlight current language
            if (code === currentLang) {
                button.classList.add('active');
            }
            
            button.addEventListener('click', function() {
                // Navigate to the language-specific URL
                const url = code === 'en' ? '/' : `/${code}/`;
                window.location.href = url;
            });
            
            languageGrid.appendChild(button);
        }
    }

    // Open language modal
    if (langSwitch) {
        langSwitch.addEventListener('click', function() {
            languageModal.classList.add('show');
        });
    }

    // Close modal
    if (closeModal) {
        closeModal.addEventListener('click', function() {
            languageModal.classList.remove('show');
        });
    }

    // Close modal on outside click
    if (languageModal) {
        languageModal.addEventListener('click', function(e) {
            if (e.target === languageModal) {
                languageModal.classList.remove('show');
            }
        });
    }

    // FAQ toggle functionality
    const faqQuestions = document.querySelectorAll('.faq-question');
    faqQuestions.forEach(question => {
        question.addEventListener('click', function() {
            const answer = this.nextElementSibling;
            const toggle = this.querySelector('.faq-toggle');
            
            if (answer.style.maxHeight) {
                answer.style.maxHeight = null;
                toggle.textContent = '+';
            } else {
                answer.style.maxHeight = answer.scrollHeight + 'px';
                toggle.textContent = '−';
            }
        });
    });
});
