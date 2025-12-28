from flask import Flask, send_from_directory, request, redirect, Response, jsonify, stream_with_context
import os
import mimetypes
import requests
from collections import defaultdict
import time

# Disable automatic static folder - we'll handle all routing manually
app = Flask(__name__, static_folder=None)
app.url_map.strict_slashes = False

# CORS helper for all responses
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Extension-ID'
    return response

# ===== GEMINI PROXY CONFIG =====
# CRITICAL: NEVER CHANGE THIS MODEL - Gemini 3 Flash is the ONLY approved model
# Using any other model (gemini-2.0, gemini-pro, etc.) will cause cost spikes
GEMINI_MODEL = 'gemini-3-flash-preview'  # DO NOT CHANGE - User requirement
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = 5
rate_limit_data = defaultdict(lambda: {'count': 0, 'window_start': 0})

def check_rate_limit(user_id):
    now = time.time()
    user_key = user_id or 'anonymous'
    data = rate_limit_data[user_key]
    
    if now - data['window_start'] > RATE_LIMIT_WINDOW:
        data['count'] = 0
        data['window_start'] = now
    
    if data['count'] >= RATE_LIMIT_MAX:
        return False
    
    data['count'] += 1
    return True

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

# ===== GEMINI PROXY ENDPOINTS =====
@app.route('/premium-chat', methods=['POST', 'OPTIONS'])
def premium_chat():
    """Proxy to Gemini API for AI chat"""
    if request.method == 'OPTIONS':
        return add_cors_headers(Response('', status=200))
    
    if not GEMINI_API_KEY:
        return add_cors_headers(jsonify({'error': 'Server not configured'})), 500
    
    data = request.get_json()
    user_id = data.get('userId', 'anonymous')
    
    if not check_rate_limit(user_id):
        resp = jsonify({'error': 'Rate limit exceeded. Please wait.'})
        return add_cors_headers(resp), 429
    
    contents = data.get('contents', [])
    system_prompt = data.get('systemPrompt')
    
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}'
    
    try:
        request_body = {
            'contents': contents,
            'generationConfig': {
                'maxOutputTokens': 2048,
                'temperature': 0.7,
                'topP': 0.95,
                'topK': 40
            }
        }
        
        if system_prompt:
            request_body['systemInstruction'] = {'parts': [{'text': system_prompt}]}
        
        response = requests.post(url, json=request_body, timeout=60)
        result = response.json()
        
        return add_cors_headers(jsonify(result))
    except Exception as e:
        print(f'[SnapToAI Proxy] Error: {e}')
        return add_cors_headers(jsonify({'error': 'AI Server busy. Try again.'})), 500

@app.route('/premium-chat-stream', methods=['POST', 'OPTIONS'])
def premium_chat_stream():
    """Streaming proxy to Gemini API for AI chat"""
    if request.method == 'OPTIONS':
        return add_cors_headers(Response('', status=200))
    
    if not GEMINI_API_KEY:
        return add_cors_headers(jsonify({'error': 'Server not configured'})), 500
    
    data = request.get_json()
    user_id = data.get('userId', 'anonymous')
    
    if not check_rate_limit(user_id):
        resp = jsonify({'error': 'Rate limit exceeded. Please wait.'})
        return add_cors_headers(resp), 429
    
    contents = data.get('contents', [])
    system_prompt = data.get('systemPrompt')
    
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:streamGenerateContent?key={GEMINI_API_KEY}&alt=sse'
    
    try:
        request_body = {
            'contents': contents,
            'generationConfig': {
                'maxOutputTokens': 2048,
                'temperature': 0.7,
                'topP': 0.95,
                'topK': 40
            }
        }
        
        if system_prompt:
            request_body['systemInstruction'] = {'parts': [{'text': system_prompt}]}
        
        def generate():
            with requests.post(url, json=request_body, stream=True, timeout=120) as r:
                for chunk in r.iter_content(chunk_size=1024):
                    if chunk:
                        yield chunk
        
        response = Response(stream_with_context(generate()), mimetype='text/event-stream')
        response.headers['Cache-Control'] = 'no-cache'
        response.headers['Connection'] = 'keep-alive'
        return add_cors_headers(response)
    except Exception as e:
        print(f'[SnapToAI Proxy] Stream Error: {e}')
        return add_cors_headers(jsonify({'error': 'AI Server busy. Try again.'})), 500

@app.route('/verify-license', methods=['POST', 'OPTIONS'])
def verify_license():
    """Verify Gumroad license key"""
    if request.method == 'OPTIONS':
        return add_cors_headers(Response('', status=200))
    
    data = request.get_json()
    license_key = data.get('licenseKey', '')
    
    if not license_key or len(license_key) < 8:
        return add_cors_headers(jsonify({'success': False, 'error': 'Invalid license key format'})), 400
    
    try:
        gumroad_product_id = os.environ.get('GUMROAD_PRODUCT_ID', 'YOUR_PRODUCT_ID')
        response = requests.post('https://api.gumroad.com/v2/licenses/verify', data={
            'product_id': gumroad_product_id,
            'license_key': license_key
        }, timeout=30)
        
        result = response.json()
        
        if result.get('success'):
            resp = jsonify({
                'success': True,
                'email': result.get('purchase', {}).get('email'),
                'uses': result.get('uses')
            })
            return add_cors_headers(resp)
        else:
            resp = jsonify({'success': False, 'error': result.get('message', 'Invalid license')})
            return add_cors_headers(resp), 400
    except Exception as e:
        print(f'[SnapToAI] License verification error: {e}')
        return add_cors_headers(jsonify({'success': False, 'error': 'Verification failed. Try again.'})), 500

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
