from flask import Flask, send_from_directory, request, redirect
import os

# Disable automatic static folder - we'll handle all routing manually
app = Flask(__name__, static_folder=None)
app.url_map.strict_slashes = False

# Handle www redirect
@app.before_request
def redirect_www():
    """Redirect www.snaptoai.com to snaptoai.com"""
    if request.host.startswith('www.'):
        return redirect(request.url.replace('www.', '', 1), code=301)

# Supported languages
SUPPORTED_LANGUAGES = {
    "en", "ar", "he", "fr", "de", "es", "es_419", "it", "pt", "pt_BR", "pt_PT",
    "ja", "zh", "zh_TW", "nl", "pl", "ru", "tr", "vi", "th", "ko",
    "hi", "bn", "gu", "ta", "te", "kn", "ml", "mr", "or", "bg",
    "cs", "da", "el", "et", "fi", "hu", "id", "lt", "lv", "nb",
    "ro", "sk", "sl", "sr", "sv", "uk", "hr", "ca", "sw", "fil",
    "en_GB", "en_US", "am"
}

BASE_DIR = 'landing-page'

@app.after_request
def add_headers(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@app.route('/')
def index():
    """Serve English landing page (default)"""
    return send_from_directory(BASE_DIR, 'index.html')

@app.route('/<lang_code>')
def language_page(lang_code):
    """Serve language-specific page"""
    if lang_code in SUPPORTED_LANGUAGES:
        lang_file = os.path.join(BASE_DIR, lang_code, 'index.html')
        if os.path.exists(lang_file):
            return send_from_directory(os.path.join(BASE_DIR, lang_code), 'index.html')
    # Check if it's a static file
    file_path = os.path.join(BASE_DIR, lang_code)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return send_from_directory(BASE_DIR, lang_code)
    # Fallback to English
    return send_from_directory(BASE_DIR, 'index.html')

@app.route('/<lang_code>/<path:subpath>')
def language_assets(lang_code, subpath):
    """Serve static assets for language pages"""
    if lang_code in SUPPORTED_LANGUAGES:
        # Try language folder first
        lang_file = os.path.join(BASE_DIR, lang_code, subpath)
        if os.path.exists(lang_file):
            return send_from_directory(os.path.join(BASE_DIR, lang_code), subpath)
    # Fallback to root static folder
    return send_from_directory(BASE_DIR, subpath)

@app.route('/sitemap.xml')
def sitemap():
    """Serve XML sitemap for SEO"""
    response = send_from_directory(BASE_DIR, 'sitemap.xml')
    response.headers['Content-Type'] = 'application/xml'
    return response

@app.route('/robots.txt')
def robots():
    """Serve robots.txt for search engine crawling"""
    response = send_from_directory(BASE_DIR, 'robots.txt')
    response.headers['Content-Type'] = 'text/plain'
    return response

@app.errorhandler(404)
def not_found(e):
    return send_from_directory(BASE_DIR, 'index.html')

if __name__ == '__main__':
    print('✅ Landing page live at: 0.0.0.0:5000')
    print('🌍 54 languages available:')
    print('   /       → English (default)')
    print('   /ar     → Arabic')
    print('   /es     → Spanish')
    print('   /fr     → French')
    print('   ... and 50 more!')
    app.run(host='0.0.0.0', port=5000, debug=False)
