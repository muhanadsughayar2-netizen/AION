from flask import Flask, send_from_directory, make_response, request, redirect
import os

app = Flask(__name__, static_folder='landing-page', static_url_path='')

# Supported languages
SUPPORTED_LANGUAGES = [
    "en", "ar", "he", "fr", "de", "es", "it", "pt", "pt_BR", "pt_PT",
    "ja", "zh", "zh_TW", "nl", "pl", "ru", "tr", "vi", "th", "ko",
    "hi", "bn", "gu", "ta", "te", "kn", "ml", "mr", "or", "bg",
    "cs", "da", "el", "et", "fi", "hu", "id", "lt", "lv", "nb",
    "ro", "sk", "sl", "sr", "sv", "uk", "hr", "ca", "sw", "fil",
    "en_GB", "en_US", "am"
]

@app.after_request
def add_no_cache_headers(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

def get_preferred_language():
    """Get the user's preferred language from Accept-Language header"""
    accept_lang = request.headers.get('Accept-Language', '')
    
    # Parse Accept-Language header
    languages = []
    for lang in accept_lang.split(','):
        parts = lang.strip().split(';')
        lang_code = parts[0].strip()
        # Convert browser format to our format (e.g., en-US -> en_US)
        lang_code = lang_code.replace('-', '_')
        languages.append(lang_code)
    
    # Try to find a matching supported language
    for lang in languages:
        # Exact match
        if lang in SUPPORTED_LANGUAGES:
            return lang
        # Try base language (e.g., en_US -> en)
        base_lang = lang.split('_')[0]
        if base_lang in SUPPORTED_LANGUAGES:
            return base_lang
    
    return 'en'  # Default to English

@app.route('/')
def index():
    """Serve English landing page (default)"""
    return send_from_directory('landing-page', 'index.html')

@app.route('/auto/')
def auto_redirect():
    """Auto-redirect to user's preferred language"""
    preferred_lang = get_preferred_language()
    if preferred_lang == 'en':
        return redirect('/')
    return redirect(f'/{preferred_lang}/')

@app.route('/<lang_code>/')
def language_page(lang_code):
    """Serve language-specific landing page"""
    if lang_code in SUPPORTED_LANGUAGES:
        lang_file = os.path.join('landing-page', lang_code, 'index.html')
        if os.path.exists(lang_file):
            return send_from_directory(os.path.join('landing-page', lang_code), 'index.html')
    # Fallback to English
    return send_from_directory('landing-page', 'index.html')

@app.route('/<lang_code>/<path:path>')
def language_static(lang_code, path):
    """Serve static files for language pages (CSS, JS, images)"""
    # First try to serve from language folder
    if lang_code in SUPPORTED_LANGUAGES:
        lang_path = os.path.join('landing-page', lang_code, path)
        if os.path.exists(lang_path):
            return send_from_directory(os.path.join('landing-page', lang_code), path)
    # Fallback to main landing-page folder
    return send_from_directory('landing-page', path)

@app.route('/<path:path>')
def serve_file(path):
    """Serve static files from landing-page folder"""
    return send_from_directory('landing-page', path)

@app.errorhandler(404)
def not_found(e):
    return send_from_directory('landing-page', 'index.html')

if __name__ == '__main__':
    print('✅ Landing page live at: 0.0.0.0:5000')
    print('🌍 54 languages available:')
    print('   /       → English (default)')
    print('   /ar/    → Arabic')
    print('   /es/    → Spanish')
    print('   /fr/    → French')
    print('   ... and 50 more!')
    app.run(host='0.0.0.0', port=5000, debug=False)
