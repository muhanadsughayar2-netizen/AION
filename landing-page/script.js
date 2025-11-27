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
            document.getElementById('languageModal').classList.remove('active');
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

// Taste It Now Demo - Real Generated Code from Live Examples
const SAMPLE_CODES = {
    dashboard: `import { TrendingUp, Users, ShoppingCart } from 'lucide-react';

export default function Dashboard() {
  const metrics = [
    { title: 'Total Revenue', value: '$45,231.89', change: '+12.5%', icon: ShoppingCart },
    { title: 'Active Users', value: '2,847', change: '+8.2%', icon: Users },
    { title: 'Growth Rate', value: '23.5%', change: '+4.3%', icon: TrendingUp }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-white mb-2">
            Dashboard
          </h1>
          <p className="text-slate-400">
            Real-time metrics and analytics
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {metrics.map((metric, idx) => {
            const Icon = metric.icon;
            return (
              <div key={idx} className="bg-slate-800/50 rounded-lg p-6 border border-cyan-500/20 hover:border-cyan-500/50 transition-all">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-slate-400 text-sm font-medium">
                    {metric.title}
                  </span>
                  <Icon className="w-5 h-5 text-cyan-400" />
                </div>
                <p className="text-3xl font-bold text-white mb-2">
                  {metric.value}
                </p>
                <p className="text-green-400 text-xs font-semibold">
                  {metric.change}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}`,
    login: `export default function LoginScreen() {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white/10 backdrop-blur-xl rounded-2xl border border-white/20 p-8 shadow-2xl">
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-white mb-2">
              Welcome Back
            </h2>
            <p className="text-white/60 text-sm">
              Sign in to your account to continue
            </p>
          </div>

          <form className="space-y-4">
            <input 
              type="email" 
              placeholder="Email address" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/50 focus:outline-none focus:border-white/50 transition-all"
            />
            <input 
              type="password" 
              placeholder="Password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/50 focus:outline-none focus:border-white/50 transition-all"
            />
            <button className="w-full py-3 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-lg font-bold text-white hover:shadow-lg transition-all transform hover:scale-105">
              Sign In
            </button>
          </form>

          <p className="text-center text-white/60 text-sm mt-6">
            Don't have an account? <a href="#" className="text-purple-400 hover:text-purple-300">Sign up</a>
          </p>
        </div>
      </div>
    </div>
  );
}`,
    hero: `export default function HeroSection() {
  return (
    <section className="relative min-h-screen bg-gradient-to-br from-cyan-900 via-blue-900 to-slate-900 flex items-center justify-center overflow-hidden p-4">
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-20 left-10 w-72 h-72 bg-cyan-500 rounded-full mix-blend-multiply filter blur-3xl animate-blob"></div>
        <div className="absolute top-40 right-10 w-72 h-72 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000"></div>
      </div>

      <div className="relative z-10 max-w-4xl mx-auto text-center">
        <h1 className="text-6xl md:text-7xl font-black text-white mb-6 leading-tight">
          Convert Screenshots
          <span className="block text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400">
            to Code
          </span>
        </h1>
        
        <p className="text-xl md:text-2xl text-slate-200 mb-8 max-w-2xl mx-auto">
          Turn any screenshot into perfect React + Tailwind code instantly. 
          Powered by advanced AI vision models.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button className="px-8 py-4 bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-900 rounded-lg font-bold text-lg hover:shadow-2xl transition-all transform hover:scale-105">
            Start For Free
          </button>
          <button className="px-8 py-4 border-2 border-cyan-400 text-cyan-400 rounded-lg font-bold text-lg hover:bg-cyan-400/10 transition-all">
            Watch Demo
          </button>
        </div>
      </div>
    </section>
  );
}`
};

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
