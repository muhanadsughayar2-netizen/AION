from flask import Flask, send_from_directory, request, redirect, Response
import os
import mimetypes

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

def serve_file(filepath):
    """Read file from disk and serve directly to bypass caching"""
    try:
        mime_type, _ = mimetypes.guess_type(filepath)
        
        # Binary files (images, etc.) need binary mode
        binary_extensions = {'.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg', '.woff', '.woff2', '.ttf', '.eot'}
        is_binary = any(filepath.lower().endswith(ext) for ext in binary_extensions)
        
        if is_binary:
            with open(filepath, 'rb') as f:
                content = f.read()
        else:
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
        
        response = Response(content, mimetype=mime_type or 'text/html')
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response
    except FileNotFoundError:
        return serve_file(os.path.join(BASE_DIR, 'index.html'))

@app.after_request
def add_headers(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@app.route('/health')
def health():
    """Health check endpoint for deployment"""
    return Response("OK", status=200, mimetype='text/plain')

@app.route('/')
def index():
    """Serve English landing page (default) - read directly from disk"""
    return serve_file(os.path.join(BASE_DIR, 'index.html'))

@app.route('/<lang_code>')
def language_page(lang_code):
    """Serve language-specific page"""
    if lang_code in SUPPORTED_LANGUAGES:
        lang_file = os.path.join(BASE_DIR, lang_code, 'index.html')
        if os.path.exists(lang_file):
            return serve_file(lang_file)
    # Check if it's a static file
    file_path = os.path.join(BASE_DIR, lang_code)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return serve_file(file_path)
    # Fallback to English
    return serve_file(os.path.join(BASE_DIR, 'index.html'))

@app.route('/<lang_code>/<path:subpath>')
def language_assets(lang_code, subpath):
    """Serve static assets for language pages"""
    if lang_code in SUPPORTED_LANGUAGES:
        lang_file = os.path.join(BASE_DIR, lang_code, subpath)
        if os.path.exists(lang_file):
            return serve_file(lang_file)
    # Fallback to root static folder
    root_file = os.path.join(BASE_DIR, subpath)
    if os.path.exists(root_file):
        return serve_file(root_file)
    return Response("Not found", status=404)

@app.route('/sitemap.xml')
def sitemap():
    """Serve XML sitemap for SEO"""
    filepath = os.path.join(BASE_DIR, 'sitemap.xml')
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    response = Response(content, mimetype='application/xml')
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@app.route('/robots.txt')
def robots():
    """Serve robots.txt for search engine crawling"""
    filepath = os.path.join(BASE_DIR, 'robots.txt')
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    response = Response(content, mimetype='text/plain')
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@app.errorhandler(404)
def not_found(e):
    return serve_file(os.path.join(BASE_DIR, 'index.html'))

if __name__ == '__main__':
    print('✅ Landing page live at: 0.0.0.0:5000')
    print('🌍 54 languages available:')
    print('   /       → English (default)')
    print('   /ar     → Arabic')
    print('   /es     → Spanish')
    print('   /fr     → French')
    print('   ... and 50 more!')
    app.run(host='0.0.0.0', port=5000, debug=False)
