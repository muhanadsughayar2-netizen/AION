#!/usr/bin/env python3
"""
Generate 54 language-specific HTML pages for SEO optimization
Each language gets its own folder with pre-rendered content and hreflang tags
"""

import os
import re
import json

# All supported languages with their display names and RTL status
LANGUAGES = {
    "en": {"name": "English", "rtl": False},
    "ar": {"name": "العربية", "rtl": True},
    "he": {"name": "עברית", "rtl": True},
    "fr": {"name": "Français", "rtl": False},
    "de": {"name": "Deutsch", "rtl": False},
    "es": {"name": "Español", "rtl": False},
    "es_419": {"name": "Español (Latinoamérica)", "rtl": False},
    "it": {"name": "Italiano", "rtl": False},
    "pt": {"name": "Português", "rtl": False},
    "pt_BR": {"name": "Português (Brasil)", "rtl": False},
    "pt_PT": {"name": "Português (Portugal)", "rtl": False},
    "ja": {"name": "日本語", "rtl": False},
    "zh": {"name": "中文", "rtl": False},
    "zh_TW": {"name": "繁體中文", "rtl": False},
    "nl": {"name": "Nederlands", "rtl": False},
    "pl": {"name": "Polski", "rtl": False},
    "ru": {"name": "Русский", "rtl": False},
    "tr": {"name": "Türkçe", "rtl": False},
    "vi": {"name": "Tiếng Việt", "rtl": False},
    "th": {"name": "ไทย", "rtl": False},
    "ko": {"name": "한국어", "rtl": False},
    "hi": {"name": "हिन्दी", "rtl": False},
    "bn": {"name": "বাংলা", "rtl": False},
    "gu": {"name": "ગુજરાતી", "rtl": False},
    "ta": {"name": "தமிழ்", "rtl": False},
    "te": {"name": "తెలుగు", "rtl": False},
    "kn": {"name": "ಕನ್ನಡ", "rtl": False},
    "ml": {"name": "മലയാളം", "rtl": False},
    "mr": {"name": "मराठी", "rtl": False},
    "or": {"name": "ଓଡ଼ିଆ", "rtl": False},
    "bg": {"name": "Български", "rtl": False},
    "cs": {"name": "Čeština", "rtl": False},
    "da": {"name": "Dansk", "rtl": False},
    "el": {"name": "Ελληνικά", "rtl": False},
    "et": {"name": "Eesti", "rtl": False},
    "fi": {"name": "Suomi", "rtl": False},
    "hu": {"name": "Magyar", "rtl": False},
    "id": {"name": "Bahasa Indonesia", "rtl": False},
    "lt": {"name": "Lietuvių", "rtl": False},
    "lv": {"name": "Latviešu", "rtl": False},
    "nb": {"name": "Norsk", "rtl": False},
    "ro": {"name": "Română", "rtl": False},
    "sk": {"name": "Slovenčina", "rtl": False},
    "sl": {"name": "Slovenščina", "rtl": False},
    "sr": {"name": "Српски", "rtl": False},
    "sv": {"name": "Svenska", "rtl": False},
    "uk": {"name": "Українська", "rtl": False},
    "hr": {"name": "Hrvatski", "rtl": False},
    "ca": {"name": "Català", "rtl": False},
    "sw": {"name": "Kiswahili", "rtl": False},
    "fil": {"name": "Filipino", "rtl": False},
    "en_GB": {"name": "English (UK)", "rtl": False},
    "en_US": {"name": "English (US)", "rtl": False},
    "am": {"name": "አማርኛ", "rtl": False},
}

def parse_translations():
    """Parse translations.js and extract all translations"""
    with open('landing-page/translations.js', 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Extract JavaScript object
    content = content.replace('const translations = ', '')
    content = content.rstrip(';').strip()
    
    # Parse as JSON (JavaScript object literals are mostly valid JSON)
    try:
        translations = json.loads(content)
    except:
        # Fallback: eval-like parsing for JavaScript
        translations = {}
        # Extract each language block
        pattern = r'"([a-z_A-Z]+)":\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}'
        for match in re.finditer(pattern, content, re.DOTALL):
            lang_code = match.group(1)
            lang_content = match.group(2)
            translations[lang_code] = {}
            # Extract key-value pairs
            kv_pattern = r'"([^"]+)":\s*"([^"]*)"'
            for kv_match in re.finditer(kv_pattern, lang_content):
                key = kv_match.group(1)
                value = kv_match.group(2)
                translations[lang_code][key] = value
    
    return translations

def generate_hreflang_tags(base_url="https://snaptoai.com"):
    """Generate hreflang link tags for all languages"""
    tags = []
    for lang_code in LANGUAGES.keys():
        # Convert underscore to hyphen for hreflang
        hreflang = lang_code.replace('_', '-').lower()
        if lang_code == "en":
            url = f"{base_url}/"
            tags.append(f'    <link rel="alternate" hreflang="{hreflang}" href="{url}">')
            tags.append(f'    <link rel="alternate" hreflang="x-default" href="{url}">')
        else:
            url = f"{base_url}/{lang_code}/"
            tags.append(f'    <link rel="alternate" hreflang="{hreflang}" href="{url}">')
    return '\n'.join(tags)

def generate_schema_markup(lang_code):
    """Generate JSON-LD Schema markup for rich snippets"""
    current_url = "https://snaptoai.com/" if lang_code == "en" else f"https://snaptoai.com/{lang_code}/"
    
    schema = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "SoftwareApplication",
                "@id": "https://snaptoai.com",
                "name": "SnapToAI",
                "alternateName": "Snap To AI",
                "description": "Free Chrome extension - Convert screenshots to AI context instantly. Unlimited screenshots, 55+ languages, batch upload to ChatGPT, Claude, Grok",
                "url": "https://snaptoai.com",
                "applicationCategory": "Utility",
                "operatingSystem": "Web, Chrome, Chromium",
                "image": "https://snaptoai.com/favicon.ico",
                "author": {
                    "@type": "Organization",
                    "name": "SnapToAI",
                    "url": "https://snaptoai.com"
                },
                "offers": {
                    "@type": "Offer",
                    "price": "0",
                    "priceCurrency": "USD",
                    "availability": "https://schema.org/InStock"
                },
                "downloadUrl": "https://chrome.google.com/webstore/detail/snaptoai",
                "featureList": [
                    "Unlimited screenshots",
                    "55+ languages",
                    "Batch export",
                    "AI integration",
                    "Privacy-first"
                ]
            },
            {
                "@type": "FAQPage",
                "mainEntity": [
                    {
                        "@type": "Question",
                        "name": "Is SnapToAI really free?",
                        "acceptedAnswer": {
                            "@type": "Answer",
                            "text": "Yes! SnapToAI is currently free during Early Access. All Pro features including AI Vision and Magic Agents are unlocked for everyone."
                        }
                    },
                    {
                        "@type": "Question",
                        "name": "How does SnapToAI work?",
                        "acceptedAnswer": {
                            "@type": "Answer",
                            "text": "Simply click the camera button to capture screenshots, then use Select All → Copy → Paste to send all screenshots as one stacked image to ChatGPT, Claude, Grok, or Gemini."
                        }
                    },
                    {
                        "@type": "Question",
                        "name": "What AI platforms does SnapToAI support?",
                        "acceptedAnswer": {
                            "@type": "Answer",
                            "text": "SnapToAI works with ChatGPT, Claude, Grok, Gemini, and any AI platform that accepts image uploads. One-click upload to all of them."
                        }
                    },
                    {
                        "@type": "Question",
                        "name": "Is my data private with SnapToAI?",
                        "acceptedAnswer": {
                            "@type": "Answer",
                            "text": "Absolutely! SnapToAI is 100% client-side. Your screenshots never leave your browser. No servers, no tracking, no data collection."
                        }
                    },
                    {
                        "@type": "Question",
                        "name": "How many screenshots can I capture?",
                        "acceptedAnswer": {
                            "@type": "Answer",
                            "text": "Unlimited! Capture as many screenshots as you need. SnapToAI stacks up to 9 screenshots into one image for easy AI upload."
                        }
                    }
                ]
            },
            {
                "@type": "WebPage",
                "@id": current_url,
                "url": current_url,
                "name": "SnapToAI - Screenshots to AI in One Click",
                "description": "Capture screenshots, analyze with AI Vision, automate with Magic Agents. Free Early Access. 55+ languages.",
                "isPartOf": {
                    "@id": "https://snaptoai.com"
                }
            }
        ]
    }
    
    return json.dumps(schema, ensure_ascii=False, indent=2)

def generate_html_for_language(lang_code, translations, hreflang_tags):
    """Generate HTML file for a specific language"""
    
    lang_data = LANGUAGES.get(lang_code, {"name": lang_code, "rtl": False})
    trans = translations.get(lang_code, translations.get('en', {}))
    en_trans = translations.get('en', {})
    
    # Get translations with English fallback
    def t(key, default=""):
        return trans.get(key, en_trans.get(key, default))
    
    # Determine RTL
    dir_attr = 'dir="rtl"' if lang_data["rtl"] else ""
    
    # Asset path (relative to language folder, or root for English)
    asset_prefix = "../" if lang_code != "en" else ""
    
    # Generate meta description in the language
    meta_desc = t("subtitle", "Convert screenshots to AI context in one click")
    
    # Generate Schema markup
    schema_markup = generate_schema_markup(lang_code)
    
    current_url = "https://snaptoai.com/" if lang_code == "en" else f"https://snaptoai.com/{lang_code}/"
    
    html = f'''<!DOCTYPE html>
<html lang="{lang_code.replace('_', '-')}" {dir_attr}>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SnapToAI - {t("tagline", "Screenshots to AI in One Click")}</title>
    <meta name="description" content="{meta_desc}">
    <meta name="theme-color" content="#0f172a">
    <link rel="icon" type="image/x-icon" href="{asset_prefix}favicon.ico">
    <link rel="canonical" href="https://snaptoai.com{'/' + lang_code + '/' if lang_code != 'en' else '/'}">
{hreflang_tags}
    <meta property="og:title" content="SnapToAI – Screenshots to AI in One Click" />
    <meta property="og:description" content="Capture, analyze with AI Vision, and automate with Magic Agents. Free early access." />
    <meta property="og:image" content="https://snaptoai.com/og-image.jpg" />
    <meta property="og:url" content="{current_url}" />
    <meta property="og:type" content="website" />
    <meta property="twitter:card" content="summary_large_image" />
    <meta property="twitter:title" content="SnapToAI – Screenshots to AI in One Click" />
    <meta property="twitter:description" content="Capture, analyze with AI Vision, and automate with Magic Agents. Free early access." />
    <meta property="twitter:image" content="https://snaptoai.com/og-image.jpg" />
    <script type="application/ld+json">
{schema_markup}
    </script>
    <link rel="stylesheet" href="{asset_prefix}style.css">
    <link rel="stylesheet" href="{asset_prefix}ai-testimonials.css">
</head>
<body>
    <!-- Navigation -->
    <nav class="navbar">
        <div class="nav-container">
            <div class="logo-wrapper">
                <div class="logo-icon">📸</div>
                <span class="logo-text">Snap<span class="logo-highlight">ToAI</span></span>
                <div class="logo-free">
                    <span style="font-size: 0.7rem;">EARLY ACCESS</span>
                </div>
            </div>
            <div class="nav-links">
                <button class="lang-switch" id="langSwitch" title="Change Language">{lang_data["name"]}</button>
            </div>
        </div>
    </nav>

    <!-- Hero Section -->
    <section class="hero">
        <div class="hero-content">
            <div class="animated-logo">
                <span class="logo-word word-1">Snap</span>
                <span class="logo-word word-2">To</span>
                <span class="logo-word word-3">AI</span>
            </div>

            <h1 class="main-tagline" id="tagline">{t("tagline", "Screenshots to AI in One Click")}</h1>
            <p class="main-subtitle" id="subtitle">{t("subtitle", "Select All → Copy → Paste. All 9 screenshots drop as ONE stacked image.")}</p>

            <a href="https://chrome.google.com/webstore/detail/snaptoai" target="_blank" class="cta-button">
                <span class="cta-text" id="downloadBtn">{t("downloadBtn", "Add to Chrome – Free Forever")}</span>
            </a>
            
            <p class="hero-proof" id="heroProof">{t("heroProof", "Trusted by 10,000+ developers, designers, and researchers worldwide.")}</p>

            <div class="browser-bar">
                <span class="browser-bar-label" id="alsoAvailable">{t("alsoAvailable", "Also available on:")}</span>
                <div class="browser-buttons">
                    <a href="https://microsoftedge.microsoft.com/addons" target="_blank" class="browser-btn" title="Edge">
                        <span class="browser-btn-icon edge-icon">E</span>
                        <span class="browser-btn-name">Edge</span>
                    </a>
                    <a href="https://chrome.google.com/webstore/detail/snaptoai" target="_blank" class="browser-btn" title="Brave">
                        <span class="browser-btn-icon brave-icon">B</span>
                        <span class="browser-btn-name">Brave</span>
                    </a>
                    <a href="https://addons.opera.com" target="_blank" class="browser-btn" title="Opera">
                        <span class="browser-btn-icon opera-icon">O</span>
                        <span class="browser-btn-name">Opera</span>
                    </a>
                    <a href="https://chrome.google.com/webstore/detail/snaptoai" target="_blank" class="browser-btn" title="Vivaldi">
                        <span class="browser-btn-icon vivaldi-icon">V</span>
                        <span class="browser-btn-name">Vivaldi</span>
                    </a>
                </div>
            </div>

            <div class="quick-stats">
                <div class="stat-item">
                    <span class="stat-number">55+</span>
                    <span class="stat-label" id="statLanguages">{t("statLanguages", "Languages")}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number">∞</span>
                    <span class="stat-label" id="statScreenshots">{t("statScreenshots", "Unlimited Screenshots")}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number">2s</span>
                    <span class="stat-label" id="statSpeed">{t("statSpeed", "Lightning Fast")}</span>
                </div>
            </div>
        </div>

        <div class="hero-visual">
            <div class="workflow-container">
                <div class="workflow-card big-card">
                    <div class="big-number">1</div>
                    <div class="big-icon">📸</div>
                    <h3 class="big-title" id="card1">{t("card1", "Snap")}</h3>
                    <p class="big-description" id="card1Desc">{t("card1Desc", "Press the camera button. It takes images automatically.")}</p>
                </div>
                
                <div class="big-arrow">↓</div>
                
                <div class="workflow-card big-card">
                    <div class="big-number">3</div>
                    <div class="big-icon">📤</div>
                    <h3 class="big-title" id="card3">{t("card3", "Send to AI")}</h3>
                    <p class="big-description" id="card3Desc">{t("card3Desc", "Bulk upload one file with all 9 screenshots to ChatGPT, Claude, Grok, Gemini")}</p>
                </div>
                
                <div class="big-arrow">↓</div>
                
                <div class="workflow-card big-card success-card">
                    <div class="big-number">4</div>
                    <div class="big-icon">⚡</div>
                    <h3 class="big-title" id="card4">{t("card4", "Result: AI Works Better")}</h3>
                    <p class="big-description" id="card4Desc">{t("card4Desc", "9x faster. 10x more accurate. 100% game-changing.")}</p>
                </div>
            </div>
        </div>
    </section>

    <!-- AI Superpowers Section -->
    <section class="ai-superpowers-section">
        <div class="ai-superpowers-container">
            <h2 class="section-title">More Than Screenshots</h2>
            <p class="ai-superpowers-subtitle">SnapToAI is a full AI productivity suite built into your browser</p>
            
            <div class="superpowers-grid">
                <div class="superpower-card superpower-vision">
                    <div class="superpower-glow"></div>
                    <div class="superpower-icon-wrap">
                        <span class="superpower-icon">👁️</span>
                        <span class="superpower-badge-new">PRO</span>
                    </div>
                    <h3 class="superpower-title">AI Vision Analysis</h3>
                    <p class="superpower-desc">Snap any screen and let Gemini AI analyze it instantly. Get code explanations, bug detection, UI feedback, data extraction — all from a screenshot. Like having a senior developer looking over your shoulder.</p>
                    <div class="superpower-features">
                        <span class="sp-feat">Code Review</span>
                        <span class="sp-feat">Bug Detection</span>
                        <span class="sp-feat">Data Extraction</span>
                        <span class="sp-feat">UI Analysis</span>
                    </div>
                </div>

                <div class="superpower-card superpower-agents">
                    <div class="superpower-glow"></div>
                    <div class="superpower-icon-wrap">
                        <span class="superpower-icon">🤖</span>
                        <span class="superpower-badge-new">NEW</span>
                    </div>
                    <h3 class="superpower-title">Magic Agents</h3>
                    <p class="superpower-desc">Create your own AI agents that automate any workflow. Navigate pages, click buttons, capture screenshots — all hands-free. Build custom agents for stock tracking, news scanning, site auditing, or any repetitive task you can imagine.</p>
                    <div class="superpower-features">
                        <span class="sp-feat">Build Your Own</span>
                        <span class="sp-feat">Fully Custom</span>
                        <span class="sp-feat">Automate Anything</span>
                        <span class="sp-feat">Hands-Free</span>
                    </div>
                </div>

                <div class="superpower-card superpower-credit">
                    <div class="superpower-glow"></div>
                    <div class="superpower-icon-wrap">
                        <span class="superpower-icon">💎</span>
                        <span class="superpower-badge-free">FREE</span>
                    </div>
                    <h3 class="superpower-title">$300 Free AI Credit</h3>
                    <p class="superpower-desc">Google gives every new user $300 in free API credit. That means thousands of AI analyses completely free. We show you exactly how to set it up in 2 minutes — no credit card required to start.</p>
                    <div class="superpower-features">
                        <span class="sp-feat">$300 Credit</span>
                        <span class="sp-feat">2-Min Setup</span>
                        <span class="sp-feat">No Card Needed</span>
                        <span class="sp-feat">Thousands of Uses</span>
                    </div>
                </div>
            </div>

            <div class="superpowers-cta">
                <p class="superpowers-cta-text">All Pro features unlocked during Early Access — no payment required</p>
                <a href="https://chrome.google.com/webstore/detail/snaptoai" target="_blank" class="cta-button cta-small">
                    <span class="cta-text">Get Started Free</span>
                </a>
            </div>
        </div>
    </section>

    <!-- How It Works -->
    <section class="how-it-works">
        <h2 class="section-title" id="howTitle">{t("howTitle", "How It Works")}</h2>
        <p class="workflow-subtitle" id="workflowSubtitle">{t("workflowSubtitle", "Snap → Pack → Send to AI")}</p>
        
        <div class="steps-container">
            <div class="step step-1">
                <div class="step-glow"></div>
                <div class="step-icon-large">📸</div>
                <div class="step-number">1</div>
                <div class="step-label" id="step1">{t("step1", "Snap Everything")}</div>
                <p id="step1Desc">{t("step1Desc", "Click the button. Capture anything. Auto-collected in real-time.")}</p>
            </div>

            <div class="step-arrow animated-arrow">→</div>

            <div class="step step-2">
                <div class="step-glow"></div>
                <div class="step-icon-large">📦</div>
                <div class="step-number">2</div>
                <div class="step-label" id="step2">{t("step2", "Pack Into ONE")}</div>
                <p id="step2Desc">{t("step2Desc", "Select All → Copy → Paste into ChatGPT/Claude as ONE file. Done.")}</p>
            </div>

            <div class="step-arrow animated-arrow">→</div>

            <div class="step step-3">
                <div class="step-glow"></div>
                <div class="step-icon-large">🚀</div>
                <div class="step-number">3</div>
                <div class="step-label" id="step3">{t("step3", "Feed ANY AI")}</div>
                <p id="step3Desc">{t("step3Desc", "ChatGPT, Claude, Grok, Gemini—one click uploads to whatever AI you use.")}</p>
            </div>
        </div>
    </section>

    <!-- What the AIs Say Section -->
    <section class="ai-testimonials-section">
        <div class="ai-testimonials-container">
            <h2 class="ai-testimonials-title" id="aiTestimonialsTitle">{t("aiTestimonialsTitle", "This is what the AIs actually say when you give them the full context")}</h2>
            
            <div class="ai-testimonials-grid">
                <div class="ai-card">
                    <img src="{asset_prefix}chatgpt-logo.png" alt="ChatGPT" class="ai-logo">
                    <p class="ai-quote" id="aiQuote1">"{t("aiQuote1", "Thanks for the complete, well-structured screenshots — I can now answer accurately on the first try.")}"</p>
                </div>

                <div class="ai-card">
                    <img src="{asset_prefix}claude-logo.png" alt="Claude" class="ai-logo">
                    <p class="ai-quote" id="aiQuote2">"{t("aiQuote2", "Perfect! Having all 9 screenshots in one clean file removes any ambiguity.")}"</p>
                </div>

                <div class="ai-card">
                    <img src="{asset_prefix}grok-logo.png" alt="Grok" class="ai-logo">
                    <p class="ai-quote" id="aiQuote3">"{t("aiQuote3", "Finally someone who knows how to feed me context properly. Zero hallucination risk.")}"</p>
                </div>

                <div class="ai-card">
                    <img src="{asset_prefix}gemini-logo.png" alt="Gemini" class="ai-logo">
                    <p class="ai-quote" id="aiQuote4">"{t("aiQuote4", "Excellent structured input. I can now analyze the full page with 100% confidence.")}"</p>
                </div>
            </div>

            <p class="ai-cta" id="aiCTA">{t("aiCTA", "Install SnapToAI → Stop wasting time uploading. Get AI answers that actually matter.")}</p>
        </div>
    </section>

    <!-- The Advantage Section -->
    <section class="advantage-section">
        <div class="advantage-content">
            <h2 class="section-title" id="advantageTitle">{t("advantageTitle", "Your Competitive Edge")}</h2>
            <p class="advantage-intro" id="advantageIntro">{t("advantageIntro", "9x faster. 10x more accurate. 100% game-changing.")}</p>
            <div class="advantage-grid">
                <div class="advantage-item advantage-highlight-1">
                    <div class="advantage-glow"></div>
                    <div class="advantage-icon">⚡</div>
                    <h3 id="advantage1">{t("advantage1", "9x Faster Results")}</h3>
                    <p id="problemItem1Desc">{t("problemItem1Desc", "9 screenshots stacked = 9x more context in one paste. AI sees everything instantly.")}</p>
                    <div class="advantage-badge" id="badge1">{t("badge1", "9x SPEED")}</div>
                </div>
                <div class="advantage-item advantage-highlight-2">
                    <div class="advantage-glow"></div>
                    <div class="advantage-icon">🎯</div>
                    <h3 id="advantage2">{t("advantage2", "100% Accuracy")}</h3>
                    <p id="problemItem2Desc">{t("problemItem2Desc", "All context in one file = zero ambiguity. AI understands exactly what you need.")}</p>
                    <div class="advantage-badge" id="badge2">{t("badge2", "PERFECT ACCURACY")}</div>
                </div>
                <div class="advantage-item advantage-highlight-3">
                    <div class="advantage-glow"></div>
                    <div class="advantage-icon">🚀</div>
                    <h3 id="advantage3">{t("advantage3", "10x Preparation Speed")}</h3>
                    <p id="problemItem3Desc">{t("problemItem3Desc", "Select All → Copy → Done. What used to take 10 minutes now takes 60 seconds.")}</p>
                    <div class="advantage-badge" id="badge3">{t("badge3", "10x FASTER PREP")}</div>
                </div>
                <div class="advantage-item advantage-highlight-4">
                    <div class="advantage-glow"></div>
                    <div class="advantage-icon">♾️</div>
                    <h3 id="advantage4">{t("advantage4", "Scale to 90+ Images")}</h3>
                    <p id="problemItem4Desc">{t("problemItem4Desc", "Upload 90 screenshots in one shot. No file size limits. Pure power.")}</p>
                    <div class="advantage-badge" id="badge4">{t("badge4", "UNLIMITED SCALE")}</div>
                </div>
            </div>
        </div>
    </section>

    <!-- FAQ Section -->
    <section class="faq">
        <h2 class="section-title" id="faqTitle">{t("faqTitle", "Frequently Asked")}</h2>
        
        <div class="faq-container">
            <div class="faq-item">
                <button class="faq-question">
                    <span>{t("faqQ1", "How much speed do I actually save?")}</span>
                    <span class="faq-toggle">+</span>
                </button>
                <div class="faq-answer">
                    <span>{t("faqA1", "Most users report 5-10 minutes saved per session.")}</span>
                </div>
            </div>

            <div class="faq-item">
                <button class="faq-question">
                    <span>{t("faqQ2", "Is my privacy actually protected?")}</span>
                    <span class="faq-toggle">+</span>
                </button>
                <div class="faq-answer">
                    <span>{t("faqA2", "100% yes. SnapToAI is completely client-side.")}</span>
                </div>
            </div>

            <div class="faq-item">
                <button class="faq-question">
                    <span>{t("faqQ3", "Which AI platforms does it work with?")}</span>
                    <span class="faq-toggle">+</span>
                </button>
                <div class="faq-answer">
                    <span>{t("faqA3", "ChatGPT, Claude, Grok, Gemini, and any AI platform with file upload.")}</span>
                </div>
            </div>

            <div class="faq-item">
                <button class="faq-question">
                    <span>{t("faqQ4", "How many browsers does it support?")}</span>
                    <span class="faq-toggle">+</span>
                </button>
                <div class="faq-answer">
                    <span>{t("faqA4", "All Chromium-based browsers: Chrome, Edge, Brave, Opera, Vivaldi.")}</span>
                </div>
            </div>

            <div class="faq-item">
                <button class="faq-question">
                    <span>{t("faqQ6", "What file formats and sizes are supported?")}</span>
                    <span class="faq-toggle">+</span>
                </button>
                <div class="faq-answer">
                    <span>{t("faqA6", "PNG, JPG, WebP up to 10MB each.")}</span>
                </div>
            </div>
        </div>
    </section>

    <!-- Language Selector Modal -->
    <div class="language-modal" id="languageModal">
        <div class="language-modal-content">
            <button class="close-modal" id="closeModal">&times;</button>
            <h3 id="selectLanguageTitle">{t("selectLanguageTitle", "Select Your Language")}</h3>
            <div class="language-grid" id="languageGrid"></div>
        </div>
    </div>

    <!-- Footer -->
    <footer class="footer">
        <div class="footer-container">
            <div class="footer-section">
                <h4 id="footerProductTitle">{t("footerProductTitle", "Product")}</h4>
                <ul>
                    <li><a href="#">{t("footerFeatures", "Features")}</a></li>
                    <li><a href="#">{t("footerPricing", "Pricing")}</a></li>
                    <li><a href="#">{t("footerRoadmap", "Roadmap")}</a></li>
                    <li><a href="#">{t("footerSupport", "Support")}</a></li>
                </ul>
            </div>

            <div class="footer-section">
                <h4 id="footerCompanyTitle">{t("footerCompanyTitle", "Company")}</h4>
                <ul>
                    <li><a href="#">{t("footerAbout", "About")}</a></li>
                    <li><a href="#">{t("footerBlog", "Blog")}</a></li>
                    <li><a href="#">{t("footerCommunity", "Community")}</a></li>
                    <li><a href="#">{t("footerContact", "Contact")}</a></li>
                </ul>
            </div>

            <div class="footer-section">
                <h4 id="footerLegalTitle">{t("footerLegalTitle", "Legal")}</h4>
                <ul>
                    <li><a href="#">{t("footerPrivacy", "Privacy Policy")}</a></li>
                    <li><a href="#">{t("footerTerms", "Terms of Service")}</a></li>
                    <li><a href="#">{t("footerCookie", "Cookie Policy")}</a></li>
                    <li><a href="#">{t("footerDisclosure", "Disclosure")}</a></li>
                </ul>
            </div>

            <div class="footer-section">
                <h4 id="footerConnectTitle">{t("footerConnectTitle", "Connect")}</h4>
                <ul>
                    <li><a href="#">{t("footerTwitter", "Twitter/X")}</a></li>
                    <li><a href="#">{t("footerDiscord", "Discord")}</a></li>
                    <li><a href="#">{t("footerGitHub", "GitHub")}</a></li>
                    <li><a href="#">{t("footerLinkedIn", "LinkedIn")}</a></li>
                </ul>
            </div>
        </div>

        <div class="footer-bottom">
            <p id="footerText">{t("footerText", "© 2025 SnapToAI. Built with precision for speed.")}</p>
            <p id="footerLanguages">{t("footerLanguages", "Available in 55 languages")}</p>
        </div>
    </footer>

    <script src="{asset_prefix}translations.js"></script>
    <script>
        const currentLang = "{lang_code}";
        const languageLinks = {json.dumps({k: ("/" if k == "en" else f"/{k}/") for k in LANGUAGES.keys()})};
    </script>
    <script src="{asset_prefix}script-seo.js"></script>
</body>
</html>'''
    
    return html

def main():
    print("🚀 Generating 54 language-specific HTML pages for SEO...")
    
    # Parse translations
    print("📖 Parsing translations.js...")
    translations = parse_translations()
    print(f"   Found {len(translations)} languages")
    
    # Generate hreflang tags
    hreflang_tags = generate_hreflang_tags()
    
    # Create language folders and HTML files
    base_dir = "landing-page"
    
    for lang_code, lang_info in LANGUAGES.items():
        if lang_code == "en":
            # English is the default, save directly to landing-page/index.html
            html = generate_html_for_language(lang_code, translations, hreflang_tags)
            filepath = os.path.join(base_dir, "index.html")
        else:
            # Other languages go in their own folder
            lang_dir = os.path.join(base_dir, lang_code)
            os.makedirs(lang_dir, exist_ok=True)
            html = generate_html_for_language(lang_code, translations, hreflang_tags)
            filepath = os.path.join(lang_dir, "index.html")
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(html)
        
        print(f"   ✅ {lang_code}: {lang_info['name']}")
    
    print(f"\n🎉 Generated {len(LANGUAGES)} language pages!")
    print("📁 Structure:")
    print("   /index.html          → English (default)")
    print("   /ar/index.html       → Arabic")
    print("   /es/index.html       → Spanish")
    print("   /fr/index.html       → French")
    print("   ... (one folder per language)")

if __name__ == "__main__":
    main()
