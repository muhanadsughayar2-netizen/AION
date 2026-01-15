from flask import Flask, send_from_directory, request, redirect, Response, jsonify
import os
import mimetypes
import psycopg2
from datetime import datetime, date
import time

# Rate limiting: track requests per IP
rate_limit_cache = {}  # {ip: [(timestamp, count)]}
RATE_LIMIT_WINDOW = 60  # 1 minute
RATE_LIMIT_MAX = 30  # max 30 requests per minute per IP

def check_rate_limit(ip):
    now = time.time()
    if ip not in rate_limit_cache:
        rate_limit_cache[ip] = []
    # Clean old entries
    rate_limit_cache[ip] = [(t, c) for t, c in rate_limit_cache[ip] if now - t < RATE_LIMIT_WINDOW]
    # Count recent requests
    total = sum(c for _, c in rate_limit_cache[ip])
    if total >= RATE_LIMIT_MAX:
        return False
    rate_limit_cache[ip].append((now, 1))
    return True

# Disable automatic static folder - we'll handle all routing manually
app = Flask(__name__, static_folder=None)

# Database connection
def get_db():
    return psycopg2.connect(os.environ.get('DATABASE_URL'))

# Initialize database table for trial tracking
def init_db():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('''
            CREATE TABLE IF NOT EXISTS user_trials (
                user_hash VARCHAR(64) PRIMARY KEY,
                trial_start_date BIGINT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                credits_used_today INT DEFAULT 0,
                credits_date DATE DEFAULT CURRENT_DATE
            )
        ''')
        conn.commit()
        cur.close()
        conn.close()
        print('✅ Database initialized')
    except Exception as e:
        print(f'Database init error: {e}')

# Initialize on startup
init_db()
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

# ============================================
# TRIAL TRACKING API
# ============================================

TRIAL_DAYS = 30
FREE_TIER_DAILY_CREDITS = 20

@app.route('/api/trial', methods=['POST', 'OPTIONS'])
def get_or_create_trial():
    """Get or create trial for a user based on their hashed identifier"""
    if request.method == 'OPTIONS':
        response = Response()
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return response
    
    # Rate limiting
    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    if not check_rate_limit(client_ip):
        response = jsonify({'error': 'Too many requests'})
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 429
    
    try:
        data = request.get_json()
        user_hash = data.get('userHash')
        
        if not user_hash or len(user_hash) < 16:
            return jsonify({'error': 'Invalid user hash'}), 400
        
        conn = get_db()
        cur = conn.cursor()
        
        # Check if user exists
        cur.execute('SELECT trial_start_date, credits_used_today, credits_date FROM user_trials WHERE user_hash = %s', (user_hash,))
        row = cur.fetchone()
        
        today = date.today()
        now_ms = int(datetime.now().timestamp() * 1000)
        
        if row:
            # User exists - return their original trial start date
            trial_start = row[0]
            credits_used = row[1] or 0
            credits_date_db = row[2]
            
            # Reset credits if new day
            if credits_date_db != today:
                credits_used = 0
                cur.execute('UPDATE user_trials SET credits_used_today = 0, credits_date = %s WHERE user_hash = %s', (today, user_hash))
                conn.commit()
        else:
            # New user - create trial record with current timestamp
            trial_start = now_ms
            credits_used = 0
            cur.execute(
                'INSERT INTO user_trials (user_hash, trial_start_date, credits_used_today, credits_date) VALUES (%s, %s, %s, %s)',
                (user_hash, trial_start, 0, today)
            )
            conn.commit()
        
        cur.close()
        conn.close()
        
        # Calculate trial status
        days_elapsed = (now_ms - trial_start) / (1000 * 60 * 60 * 24)
        trial_active = days_elapsed < TRIAL_DAYS
        days_remaining = max(0, TRIAL_DAYS - int(days_elapsed))
        
        response = jsonify({
            'success': True,
            'trialStartDate': trial_start,
            'trialActive': trial_active,
            'daysRemaining': days_remaining,
            'creditsUsedToday': credits_used,
            'creditsLimit': FREE_TIER_DAILY_CREDITS
        })
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
        
    except Exception as e:
        print(f'Trial API error: {e}')
        response = jsonify({'error': 'Server error'})
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 500

@app.route('/api/use-credit', methods=['POST', 'OPTIONS'])
def use_credit():
    """Use one AI credit - checks trial/limits before allowing"""
    if request.method == 'OPTIONS':
        response = Response()
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return response
    
    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    if not check_rate_limit(client_ip):
        response = jsonify({'error': 'Too many requests'})
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 429
    
    try:
        data = request.get_json()
        user_hash = data.get('userHash')
        
        if not user_hash or len(user_hash) < 16:
            return jsonify({'error': 'Invalid user hash'}), 400
        
        conn = get_db()
        cur = conn.cursor()
        
        cur.execute('SELECT trial_start_date, credits_used_today, credits_date FROM user_trials WHERE user_hash = %s', (user_hash,))
        row = cur.fetchone()
        
        if not row:
            cur.close()
            conn.close()
            response = jsonify({'allowed': False, 'reason': 'not_registered'})
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response
        
        trial_start = row[0]
        credits_used = row[1] or 0
        credits_date_db = row[2]
        today = date.today()
        now_ms = int(datetime.now().timestamp() * 1000)
        
        # Reset credits if new day
        if credits_date_db != today:
            credits_used = 0
            cur.execute('UPDATE user_trials SET credits_used_today = 0, credits_date = %s WHERE user_hash = %s', (today, user_hash))
            conn.commit()
        
        # Check trial status
        days_elapsed = (now_ms - trial_start) / (1000 * 60 * 60 * 24)
        trial_active = days_elapsed < TRIAL_DAYS
        
        # If trial active, allow unlimited
        if trial_active:
            response = jsonify({
                'allowed': True,
                'trialActive': True,
                'daysRemaining': max(0, TRIAL_DAYS - int(days_elapsed))
            })
            response.headers['Access-Control-Allow-Origin'] = '*'
            cur.close()
            conn.close()
            return response
        
        # Trial expired - check daily credits
        if credits_used >= FREE_TIER_DAILY_CREDITS:
            response = jsonify({
                'allowed': False,
                'reason': 'daily_limit',
                'creditsUsed': credits_used,
                'creditsLimit': FREE_TIER_DAILY_CREDITS
            })
            response.headers['Access-Control-Allow-Origin'] = '*'
            cur.close()
            conn.close()
            return response
        
        # Use one credit
        credits_used += 1
        cur.execute('UPDATE user_trials SET credits_used_today = %s WHERE user_hash = %s', (credits_used, user_hash))
        conn.commit()
        cur.close()
        conn.close()
        
        response = jsonify({
            'allowed': True,
            'trialActive': False,
            'creditsUsed': credits_used,
            'creditsRemaining': FREE_TIER_DAILY_CREDITS - credits_used
        })
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
        
    except Exception as e:
        print(f'Use credit API error: {e}')
        response = jsonify({'error': 'Server error'})
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 500

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
