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

    // Language suggestion messages in each language
    const suggestionMessages = {
        "ar": "هل تريد عرض هذه الصفحة بالعربية؟",
        "he": "האם לראות את הדף בעברית?",
        "fr": "Voulez-vous voir cette page en français ?",
        "de": "Möchten Sie diese Seite auf Deutsch sehen?",
        "es": "¿Quieres ver esta página en español?",
        "es_419": "¿Quieres ver esta página en español?",
        "it": "Vuoi vedere questa pagina in italiano?",
        "pt": "Deseja ver esta página em português?",
        "pt_BR": "Deseja ver esta página em português?",
        "pt_PT": "Deseja ver esta página em português?",
        "ja": "日本語でこのページを表示しますか？",
        "zh": "您想以中文查看此页面吗？",
        "zh_TW": "您想以中文查看此頁面嗎？",
        "nl": "Wil je deze pagina in het Nederlands zien?",
        "pl": "Czy chcesz zobaczyć tę stronę po polsku?",
        "ru": "Хотите просмотреть эту страницу на русском?",
        "tr": "Bu sayfayı Türkçe görmek ister misiniz?",
        "vi": "Bạn có muốn xem trang này bằng tiếng Việt?",
        "th": "ต้องการดูหน้านี้เป็นภาษาไทยไหม?",
        "ko": "이 페이지를 한국어로 보시겠습니까?",
        "hi": "क्या आप इस पेज को हिंदी में देखना चाहते हैं?",
        "bn": "আপনি কি এই পৃষ্ঠাটি বাংলায় দেখতে চান?",
        "id": "Ingin melihat halaman ini dalam Bahasa Indonesia?",
        "uk": "Бажаєте переглянути цю сторінку українською?",
        "sv": "Vill du se denna sida på svenska?",
        "da": "Vil du se denne side på dansk?",
        "fi": "Haluatko nähdä tämän sivun suomeksi?",
        "nb": "Vil du se denne siden på norsk?",
        "el": "Θέλετε να δείτε αυτή τη σελίδα στα ελληνικά;",
        "cs": "Chcete zobrazit tuto stránku česky?",
        "ro": "Doriți să vedeți această pagină în română?",
        "hu": "Szeretné ezt az oldalt magyarul látni?",
        "sk": "Chcete zobraziť túto stránku po slovensky?",
        "bg": "Искате ли да видите тази страница на български?",
        "hr": "Želite li vidjeti ovu stranicu na hrvatskom?",
        "sr": "Желите ли да видите ову страницу на српском?",
        "sl": "Ali želite videti to stran v slovenščini?",
        "lt": "Ar norite matyti šį puslapį lietuviškai?",
        "lv": "Vai vēlaties redzēt šo lapu latviski?",
        "et": "Kas soovite seda lehte näha eesti keeles?",
        "ca": "Vols veure aquesta pàgina en català?",
        "fil": "Gusto mo bang makita ang pahinang ito sa Filipino?",
        "sw": "Je, unataka kuona ukurasa huu kwa Kiswahili?",
        "am": "ይህን ገጽ በአማርኛ ማየት ይፈልጋሉ?",
        "gu": "શું તમે આ પેજ ગુજરાતીમાં જોવા માંગો છો?",
        "ta": "இந்தப் பக்கத்தை தமிழில் பார்க்க விரும்புகிறீர்களா?",
        "te": "ఈ పేజీని తెలుగులో చూడాలనుకుంటున్నారా?",
        "kn": "ಈ ಪುಟವನ್ನು ಕನ್ನಡದಲ್ಲಿ ನೋಡಲು ಬಯಸುತ್ತೀರಾ?",
        "ml": "ഈ പേജ് മലയാളത്തിൽ കാണാൻ ആഗ്രഹിക്കുന്നുണ്ടോ?",
        "mr": "हे पृष्ठ मराठीत पहायचे आहे का?",
        "or": "ଆପଣ ଏହି ପୃଷ୍ଠାକୁ ଓଡ଼ିଆରେ ଦେଖିବାକୁ ଚାହୁଁଛନ୍ତି?"
    };

    // Button text translations
    const yesButton = {
        "en": "Yes, switch",
        "ar": "نعم، تبديل",
        "he": "כן, החלף",
        "fr": "Oui, changer",
        "de": "Ja, wechseln",
        "es": "Sí, cambiar",
        "it": "Sì, cambia",
        "pt": "Sim, mudar",
        "ja": "はい、切り替える",
        "zh": "是的，切换",
        "ko": "예, 전환",
        "ru": "Да, переключить",
        "hi": "हाँ, बदलें",
        "default": "Yes, switch"
    };

    // Detect browser language and show suggestion banner
    function detectLanguageAndSuggest() {
        // Don't show if user already dismissed or chose a language
        if (localStorage.getItem('snaptoai_lang_preference')) {
            return;
        }

        // Get browser language
        const browserLang = navigator.language || navigator.userLanguage;
        
        // Map browser language to our supported languages
        let detectedLang = null;
        
        // Try exact match first (e.g., "pt-BR" -> "pt_BR")
        const normalizedBrowserLang = browserLang.replace('-', '_');
        if (languages[normalizedBrowserLang]) {
            detectedLang = normalizedBrowserLang;
        } else {
            // Try base language (e.g., "pt-BR" -> "pt")
            const baseLang = browserLang.split('-')[0].toLowerCase();
            if (languages[baseLang]) {
                detectedLang = baseLang;
            }
            // Special mappings
            if (baseLang === 'pt' && browserLang.includes('BR')) {
                detectedLang = 'pt_BR';
            } else if (baseLang === 'zh' && (browserLang.includes('TW') || browserLang.includes('Hant'))) {
                detectedLang = 'zh_TW';
            } else if (baseLang === 'es' && browserLang.includes('419')) {
                detectedLang = 'es_419';
            }
        }

        // Get current page language
        const currentPageLang = document.documentElement.lang || 'en';
        const normalizedCurrentLang = currentPageLang.replace('-', '_');

        // If detected language is different from current page and we support it
        if (detectedLang && detectedLang !== normalizedCurrentLang && detectedLang !== 'en' && languages[detectedLang]) {
            showLanguageSuggestionBanner(detectedLang);
        }
    }

    function showLanguageSuggestionBanner(suggestedLang) {
        // Create banner element
        const banner = document.createElement('div');
        banner.id = 'language-suggestion-banner';
        banner.className = 'language-suggestion-banner';
        
        const message = suggestionMessages[suggestedLang] || `View this page in ${languages[suggestedLang]}?`;
        const langName = languages[suggestedLang];
        
        banner.innerHTML = `
            <div class="banner-content">
                <span class="banner-message">${message}</span>
                <div class="banner-buttons">
                    <button class="banner-btn-yes" data-lang="${suggestedLang}">${langName}</button>
                    <button class="banner-btn-no">No thanks</button>
                </div>
            </div>
            <button class="banner-close" aria-label="Close">&times;</button>
        `;

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .language-suggestion-banner {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                background: linear-gradient(135deg, rgba(6, 182, 212, 0.95), rgba(59, 130, 246, 0.95));
                color: white;
                padding: 12px 20px;
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 15px;
                font-family: system-ui, -apple-system, sans-serif;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                animation: slideDown 0.3s ease-out;
            }
            @keyframes slideDown {
                from { transform: translateY(-100%); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
            .banner-content {
                display: flex;
                align-items: center;
                gap: 15px;
                flex-wrap: wrap;
                justify-content: center;
            }
            .banner-message {
                font-size: 15px;
                font-weight: 500;
            }
            .banner-buttons {
                display: flex;
                gap: 10px;
            }
            .banner-btn-yes {
                background: white;
                color: #0891b2;
                border: none;
                padding: 8px 18px;
                border-radius: 6px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
                font-size: 14px;
            }
            .banner-btn-yes:hover {
                background: #f0f9ff;
                transform: scale(1.05);
            }
            .banner-btn-no {
                background: transparent;
                color: white;
                border: 2px solid rgba(255,255,255,0.5);
                padding: 8px 18px;
                border-radius: 6px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
                font-size: 14px;
            }
            .banner-btn-no:hover {
                border-color: white;
                background: rgba(255,255,255,0.1);
            }
            .banner-close {
                background: transparent;
                border: none;
                color: white;
                font-size: 24px;
                cursor: pointer;
                padding: 0 5px;
                opacity: 0.7;
                transition: opacity 0.2s;
            }
            .banner-close:hover {
                opacity: 1;
            }
            @media (max-width: 600px) {
                .language-suggestion-banner {
                    padding: 10px 15px;
                }
                .banner-content {
                    flex-direction: column;
                    gap: 10px;
                }
                .banner-message {
                    font-size: 14px;
                    text-align: center;
                }
            }
        `;
        document.head.appendChild(style);
        document.body.prepend(banner);

        // Add body padding to prevent content overlap
        document.body.style.paddingTop = banner.offsetHeight + 'px';

        // Event listeners
        banner.querySelector('.banner-btn-yes').addEventListener('click', function() {
            const lang = this.dataset.lang;
            localStorage.setItem('snaptoai_lang_preference', lang);
            window.location.href = `/${lang}/`;
        });

        banner.querySelector('.banner-btn-no').addEventListener('click', function() {
            localStorage.setItem('snaptoai_lang_preference', 'dismissed');
            closeBanner();
        });

        banner.querySelector('.banner-close').addEventListener('click', function() {
            localStorage.setItem('snaptoai_lang_preference', 'dismissed');
            closeBanner();
        });

        function closeBanner() {
            banner.style.animation = 'slideUp 0.3s ease-out forwards';
            banner.style.cssText += `
                @keyframes slideUp {
                    to { transform: translateY(-100%); opacity: 0; }
                }
            `;
            setTimeout(() => {
                banner.remove();
                document.body.style.paddingTop = '0';
            }, 300);
        }
    }

    // Run language detection after a short delay (better UX)
    setTimeout(detectLanguageAndSuggest, 500);

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
                // Save preference
                localStorage.setItem('snaptoai_lang_preference', code);
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
