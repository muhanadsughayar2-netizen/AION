from flask import Flask, send_from_directory, request, redirect, Response, jsonify
import os
import mimetypes
import psycopg2
from datetime import datetime
import requests

# Disable automatic static folder - we'll handle all routing manually
app = Flask(__name__, static_folder=None)

# Database connection - Use Supabase (external) if available, otherwise Replit DB
def get_db():
    # Prefer Supabase for production reliability
    db_url = os.environ.get('SUPABASE_DATABASE_URL') or os.environ.get('DATABASE_URL')
    if not db_url:
        raise Exception("No database URL set")
    return psycopg2.connect(db_url, sslmode='require')

# Initialize database table for trial tracking
def init_db():
    try:
        supabase_url = os.environ.get('SUPABASE_DATABASE_URL')
        replit_url = os.environ.get('DATABASE_URL')
        db_url = supabase_url or replit_url
        print(f'🔍 SUPABASE_DATABASE_URL exists: {bool(supabase_url)}')
        print(f'🔍 DATABASE_URL exists: {bool(replit_url)}')
        print(f'🔍 Using: {"Supabase" if supabase_url else "Replit DB" if replit_url else "None"}')
        if not db_url:
            print('❌ No database URL set in environment')
            return False
        conn = get_db()
        cur = conn.cursor()
        cur.execute('''
            CREATE TABLE IF NOT EXISTS user_trials (
                user_hash VARCHAR(64) PRIMARY KEY,
                trial_start_date BIGINT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_paid BOOLEAN DEFAULT FALSE,
                browser_language VARCHAR(10),
                extension_version VARCHAR(20),
                last_active BIGINT,
                usage_count INTEGER DEFAULT 0
            )
        ''')
        # IP-based trial tracking table - prevents trial abuse by tracking per IP
        cur.execute('''
            CREATE TABLE IF NOT EXISTS ip_trials (
                ip_address VARCHAR(45) PRIMARY KEY,
                trial_start_date BIGINT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_active BIGINT,
                api_key_count INTEGER DEFAULT 1
            )
        ''')
        # Device-based trial tracking table - most reliable, persists across IP changes
        print('📦 Creating device_trials table if not exists...')
        cur.execute('''
            CREATE TABLE IF NOT EXISTS device_trials (
                device_id VARCHAR(60) PRIMARY KEY,
                trial_start_date BIGINT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_active BIGINT,
                api_key_count INTEGER DEFAULT 1
            )
        ''')
        print('✅ device_trials table ready')
        # Add columns if missing (for existing tables)
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT FALSE')
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS browser_language VARCHAR(10)')
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS extension_version VARCHAR(20)')
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS last_active BIGINT')
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0')
        # Whop subscription columns
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS license_key VARCHAR(64)')
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS plan_type VARCHAR(20)')
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS subscription_expires BIGINT')
        # IP tracking and user data
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45)')
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS country VARCHAR(50)')
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS city VARCHAR(100)')
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS timezone VARCHAR(50)')
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS user_agent TEXT')
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS screen_resolution VARCHAR(20)')
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS platform VARCHAR(30)')
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS device_type VARCHAR(20)')
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS device_id VARCHAR(60)')
        conn.commit()
        
        # === MIGRATION: Seed ip_trials from existing user_trials ===
        # Get earliest trial_start_date for each IP from user_trials
        # Use DO UPDATE to always use the EARLIEST date (anti-cheat fix)
        cur.execute('''
            INSERT INTO ip_trials (ip_address, trial_start_date, last_active, api_key_count)
            SELECT 
                ip_address,
                MIN(trial_start_date) as trial_start_date,
                MAX(last_active) as last_active,
                COUNT(*) as api_key_count
            FROM user_trials 
            WHERE ip_address IS NOT NULL 
              AND ip_address != '' 
              AND ip_address != '127.0.0.1'
            GROUP BY ip_address
            ON CONFLICT (ip_address) DO UPDATE SET
                trial_start_date = LEAST(ip_trials.trial_start_date, EXCLUDED.trial_start_date),
                api_key_count = GREATEST(ip_trials.api_key_count, EXCLUDED.api_key_count)
        ''')
        migrated_count = cur.rowcount
        if migrated_count > 0:
            print(f'📦 Migrated {migrated_count} IP addresses to ip_trials table')
        conn.commit()
        
        # === AUTO-FIX: Sync all user_trials to use their IP's earliest trial date ===
        cur.execute('''
            UPDATE user_trials ut
            SET trial_start_date = ip.trial_start_date
            FROM ip_trials ip
            WHERE ut.ip_address = ip.ip_address
              AND ut.trial_start_date > ip.trial_start_date
        ''')
        fixed_count = cur.rowcount
        if fixed_count > 0:
            print(f'🔧 Auto-fixed {fixed_count} users to use their IP earliest trial date')
        conn.commit()
        
        cur.close()
        conn.close()
        print('✅ Database initialized successfully')
        return True
    except Exception as e:
        print(f'❌ Database init error: {type(e).__name__}: {e}')
        return False

db_ready = False

def ensure_db():
    global db_ready
    if not db_ready:
        print('🔄 Initializing database...')
        db_ready = init_db()
        if db_ready:
            print('✅ Database initialized successfully!')
        else:
            print('❌ Database initialization failed')
    return db_ready

@app.before_request
def lazy_init_db():
    try:
        if not db_ready and request.path.startswith('/api/'):
            ensure_db()
    except Exception as e:
        print(f'❌ lazy_init_db error: {e}')

app.url_map.strict_slashes = False

@app.before_request
def redirect_www():
    """Redirect www.snaptoai.com to snaptoai.com"""
    try:
        if request.host.startswith('www.'):
            return redirect(request.url.replace('www.', '', 1), code=301)
    except Exception:
        pass

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

# Cache for index.html - warmed by background thread after startup
_index_html_cache = None
def get_index_html():
    global _index_html_cache
    if _index_html_cache is None:
        try:
            with open(os.path.join(BASE_DIR, 'index.html'), 'r', encoding='utf-8') as f:
                _index_html_cache = f.read()
        except Exception as e:
            print(f'⚠️ Could not load index.html: {e}')
            _index_html_cache = '<html><body><h1>SnapToAI</h1></body></html>'
    return _index_html_cache

try:
    get_index_html()
    print('✅ index.html loaded into memory')
except Exception as e:
    print(f'⚠️ Could not pre-load index.html: {e}')

def serve_file(filepath):
    """Read file from disk and serve directly to bypass caching"""
    try:
        mime_type, _ = mimetypes.guess_type(filepath)
        
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
        fallback = os.path.join(BASE_DIR, 'index.html')
        if filepath != fallback and os.path.exists(fallback):
            return serve_file(fallback)
        return Response("OK", status=200, mimetype='text/plain')
    except Exception as e:
        print(f'❌ serve_file error: {e}')
        return Response("OK", status=200, mimetype='text/plain')

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

@app.errorhandler(500)
def handle_500(e):
    return Response("OK", status=200, mimetype='text/plain')

@app.route('/api/db-status')
def db_status():
    """Check database status - useful for debugging production"""
    supabase_url = os.environ.get('SUPABASE_DATABASE_URL')
    replit_url = os.environ.get('DATABASE_URL')
    db_url = supabase_url or replit_url
    
    result = {
        'has_supabase_url': bool(supabase_url),
        'has_replit_url': bool(replit_url),
        'using': 'supabase' if supabase_url else 'replit' if replit_url else 'none',
        'db_ready': db_ready,
    }
    
    if db_url:
        try:
            conn = psycopg2.connect(db_url, sslmode='require')
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM user_trials")
            row = cur.fetchone()
            count = row[0] if row else 0
            cur.close()
            conn.close()
            result['connected'] = True
            result['user_count'] = count
        except Exception as e:
            result['connected'] = False
            result['error'] = str(e)
    
    return jsonify(result)

@app.route('/api/ls-status')
def ls_status():
    """Check if Whop API key is configured"""
    has_key = bool(os.environ.get('WHOP_API_KEY'))
    return jsonify({
        'configured': has_key,
        'provider': 'Whop',
        'endpoints': {
            'validate': '/api/verify-license',
            'trial': '/api/trial'
        }
    })

# ============================================
# WHOP LICENSE VERIFICATION
# ============================================

@app.route('/api/verify-license', methods=['POST', 'OPTIONS'])
def verify_license():
    """Verify a Whop license key and mark user as paid"""
    if request.method == 'OPTIONS':
        response = Response('', status=200)
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return response
    
    data = request.get_json() or {}
    license_key = data.get('licenseKey', '').strip()
    user_hash = data.get('userHash', '').strip()
    device_id = data.get('deviceId', '').strip()
    
    if not license_key or not user_hash:
        resp = jsonify({'success': False, 'error': 'Missing license key or user hash'})
        resp.headers['Access-Control-Allow-Origin'] = '*'
        return resp, 400
    
    whop_api_key = os.environ.get('WHOP_API_KEY')
    if not whop_api_key:
        print('❌ WHOP_API_KEY not set in environment')
        resp = jsonify({'success': False, 'error': 'Server configuration error'})
        resp.headers['Access-Control-Allow-Origin'] = '*'
        return resp, 500
    
    try:
        whop_response = requests.post(
            f'https://api.whop.com/api/v2/memberships/{license_key}/validate_license',
            json={
                'metadata': {
                    'device_id': device_id or user_hash[:16]
                }
            },
            headers={
                'Authorization': f'Bearer {whop_api_key}',
                'Content-Type': 'application/json'
            },
            timeout=10
        )
        
        print(f'🔍 Whop response status: {whop_response.status_code}')
        whop_data = whop_response.json()
        print(f'🔍 Whop response: valid={whop_data.get("valid")}, status={whop_data.get("status")}')
        
        if whop_response.status_code not in [200, 201] or not whop_data.get('valid'):
            error_msg = whop_data.get('message', 'Invalid or inactive license key')
            resp = jsonify({'success': False, 'error': error_msg})
            resp.headers['Access-Control-Allow-Origin'] = '*'
            return resp, 400
        
        membership_status = whop_data.get('status', '')
        if membership_status not in ['active', 'trialing', 'completed']:
            resp = jsonify({'success': False, 'error': f'Membership status: {membership_status}. Please check your subscription.'})
            resp.headers['Access-Control-Allow-Origin'] = '*'
            return resp, 400
        
        plan_name = (whop_data.get('plan', '') or '').lower()
        product_name = (whop_data.get('product', '') or '').lower()
        expires_at = whop_data.get('expires_at')
        
        if 'year' in plan_name or 'annual' in plan_name or 'year' in product_name:
            plan_type = 'yearly'
            expires_ms = (expires_at * 1000) if expires_at else int(datetime.now().timestamp() * 1000) + (365 * 24 * 60 * 60 * 1000)
        else:
            plan_type = 'monthly'
            expires_ms = (expires_at * 1000) if expires_at else int(datetime.now().timestamp() * 1000) + (30 * 24 * 60 * 60 * 1000)
        
        if not ensure_db():
            return jsonify({'success': False, 'error': 'Database unavailable'}), 503
        
        conn = get_db()
        cur = conn.cursor()
        
        cur.execute('''
            UPDATE user_trials 
            SET is_paid = TRUE, 
                license_key = %s, 
                plan_type = %s, 
                subscription_expires = %s
            WHERE user_hash = %s
        ''', (license_key[:64], plan_type, expires_ms, user_hash))
        
        if cur.rowcount == 0:
            now_ms = int(datetime.utcnow().timestamp() * 1000)
            cur.execute('''
                INSERT INTO user_trials (user_hash, trial_start_date, is_paid, license_key, plan_type, subscription_expires)
                VALUES (%s, %s, TRUE, %s, %s, %s)
            ''', (user_hash, now_ms, license_key[:64], plan_type, expires_ms))
        
        conn.commit()
        cur.close()
        conn.close()
        
        result = {
            'success': True,
            'isPaid': True,
            'planType': plan_type,
            'expiresAt': expires_ms,
            'licenseStatus': membership_status
        }
        print(f'✅ Whop license verified for user {user_hash[:8]}... Plan: {plan_type}')
        
        response = jsonify(result)
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
        
    except requests.exceptions.Timeout:
        resp = jsonify({'success': False, 'error': 'Whop verification timed out'})
        resp.headers['Access-Control-Allow-Origin'] = '*'
        return resp, 504
    except Exception as e:
        print(f'❌ License verification error: {type(e).__name__}: {e}')
        resp = jsonify({'success': False, 'error': 'Verification failed'})
        resp.headers['Access-Control-Allow-Origin'] = '*'
        return resp, 500

# ============================================
# ADMIN PANEL (Session-Based Authentication)
# ============================================

import hashlib
import secrets

ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'snaptoai2024')
ADMIN_SESSION_SECRET = os.environ.get('ADMIN_SESSION_SECRET', 'sn4pt0a1_s3cr3t_k3y_2024_pr0d')

def generate_admin_token(password):
    """Generate a secure session token"""
    return hashlib.sha256(f"{password}{ADMIN_SESSION_SECRET}".encode()).hexdigest()

def verify_admin_session():
    """Check if request has valid admin session"""
    token = request.cookies.get('admin_session')
    if not token:
        return False
    expected_token = generate_admin_token(ADMIN_PASSWORD)
    return token == expected_token

@app.route('/admin-login', methods=['POST'])
def admin_login():
    """Handle admin login - only accepts POST from the website"""
    # Check referrer to ensure request comes from our site
    referrer = request.headers.get('Referer', '')
    allowed_origins = ['snaptoai.com', 'localhost', '127.0.0.1', '.replit.dev', '.repl.co']
    
    # Require valid referrer - block requests without referrer or from unknown origins
    if not referrer:
        return jsonify({'success': False, 'error': 'Direct access not allowed'}), 403
    
    is_valid_referrer = any(origin in referrer for origin in allowed_origins)
    if not is_valid_referrer:
        return jsonify({'success': False, 'error': 'Invalid request origin'}), 403
    
    data = request.get_json() or {}
    password = data.get('password', '')
    
    if password != ADMIN_PASSWORD:
        return jsonify({'success': False, 'error': 'Invalid password'}), 401
    
    # Generate session token and set cookie
    token = generate_admin_token(password)
    response = jsonify({'success': True, 'redirect': '/admin-dashboard'})
    response.set_cookie('admin_session', token, httponly=True, secure=True, samesite='Strict', max_age=3600)
    return response

@app.route('/admin-logout')
def admin_logout():
    """Clear admin session"""
    response = redirect('/')
    response.delete_cookie('admin_session')
    return response

@app.route('/admin/<path:anything>')
def block_direct_admin_access(anything):
    """Block direct URL access to admin - must login through website"""
    return Response("Access denied. Admin access is only available through the website.", status=403)

@app.route('/admin-dashboard')
def admin_panel():
    """Enhanced admin panel - requires valid session cookie"""
    if not verify_admin_session():
        return Response("Access denied. Please login through the website.", status=403)
    
    password = ADMIN_PASSWORD  # For filter links
    
    if not ensure_db():
        return Response("Database not available", status=503)
    
    # Get filter parameters
    filter_status = request.args.get('status', 'all')
    filter_lang = request.args.get('lang', '')
    sort_by = request.args.get('sort', 'created_desc')
    search = request.args.get('search', '')
    
    try:
        conn = get_db()
        cur = conn.cursor()
        
        # Build query with all new fields including subscription data
        query = '''
            SELECT user_hash, trial_start_date, is_paid, created_at, 
                   browser_language, extension_version, last_active, usage_count,
                   plan_type, subscription_expires, ip_address, country, city, 
                   timezone, device_type, screen_resolution, platform
            FROM user_trials 
        '''
        
        # Apply sorting
        if sort_by == 'created_desc':
            query += ' ORDER BY created_at DESC'
        elif sort_by == 'created_asc':
            query += ' ORDER BY created_at ASC'
        elif sort_by == 'usage_desc':
            query += ' ORDER BY usage_count DESC NULLS LAST'
        elif sort_by == 'active_desc':
            query += ' ORDER BY last_active DESC NULLS LAST'
        else:
            query += ' ORDER BY created_at DESC'
        
        query += ' LIMIT 500'
        
        cur.execute(query)
        rows = cur.fetchall()
        
        # Also fetch ip_trials data for anti-cheat display
        cur.execute('''
            SELECT ip_address, trial_start_date, last_active, api_key_count
            FROM ip_trials 
            ORDER BY trial_start_date DESC
            LIMIT 100
        ''')
        ip_trials_rows = cur.fetchall()
        
        # Get ip_trials stats
        cur.execute('SELECT COUNT(*), SUM(api_key_count), MAX(api_key_count) FROM ip_trials')
        ip_stats = cur.fetchone()
        total_ips = ip_stats[0] if ip_stats and ip_stats[0] else 0
        total_api_keys_tracked = ip_stats[1] if ip_stats and ip_stats[1] else 0
        max_keys_per_ip = ip_stats[2] if ip_stats and ip_stats[2] else 0
        
        cur.close()
        conn.close()
        
        now_ms = int(datetime.utcnow().timestamp() * 1000)
        
        # Process and filter rows
        processed_rows = []
        total_users = 0
        active_users = 0
        expired_users = 0
        paid_users = 0
        total_usage = 0
        languages = set()
        
        for row in rows:
            user_hash = row[0]
            trial_start = row[1]
            is_paid = row[2] if row[2] else False
            created_at = row[3]
            browser_lang = row[4] or 'Unknown'
            ext_version = row[5] or '-'
            last_active = row[6]
            usage_count = row[7] or 0
            plan_type = row[8] or '-'
            sub_expires = row[9]
            ip_addr = row[10] or '-'
            country = row[11] or '-'
            city = row[12] or '-'
            tz = row[13] or '-'
            device = row[14] or '-'
            screen = row[15] or '-'
            plat = row[16] or '-'
            
            days_elapsed = (now_ms - trial_start) / (1000 * 60 * 60 * 24)
            days_remaining = max(0, 30 - int(days_elapsed))
            
            if is_paid:
                status = 'paid'
                paid_users += 1
            elif days_elapsed < 30:
                status = 'active'
                active_users += 1
            else:
                status = 'expired'
                expired_users += 1
            
            total_users += 1
            total_usage += usage_count
            if browser_lang and browser_lang != 'Unknown':
                languages.add(browser_lang)
            
            # Apply filters
            if filter_status != 'all' and status != filter_status:
                continue
            if filter_lang and browser_lang != filter_lang:
                continue
            if search and search.lower() not in user_hash.lower():
                continue
            
            processed_rows.append({
                'hash': user_hash[:16] + '...',
                'full_hash': user_hash,
                'created': created_at.strftime('%Y-%m-%d %H:%M') if created_at else '-',
                'start': datetime.fromtimestamp(trial_start / 1000).strftime('%Y-%m-%d'),
                'days': days_remaining,
                'status': status,
                'lang': browser_lang,
                'version': ext_version,
                'last_active': datetime.fromtimestamp(last_active / 1000).strftime('%Y-%m-%d %H:%M') if last_active else '-',
                'usage': usage_count,
                'plan_type': plan_type.upper() if plan_type != '-' else '-',
                'sub_expires': datetime.fromtimestamp(sub_expires / 1000).strftime('%Y-%m-%d') if sub_expires else '-',
                'ip': ip_addr,
                'country': country,
                'city': city,
                'timezone': tz,
                'device': device,
                'screen': screen,
                'platform': plat
            })
        
        # Build enhanced HTML
        html = f'''
<!DOCTYPE html>
<html>
<head>
    <title>SnapToAI Admin Dashboard</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * {{ box-sizing: border-box; }}
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f1a; color: #e0e0e0; padding: 20px; margin: 0; }}
        h1 {{ color: #00d4ff; margin-bottom: 5px; }}
        .subtitle {{ color: #666; margin-bottom: 20px; }}
        .stats {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin: 20px 0; }}
        .stat-box {{ background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 20px; border-radius: 12px; text-align: center; border: 1px solid #2a2a4a; }}
        .stat-number {{ font-size: 32px; font-weight: bold; }}
        .stat-label {{ font-size: 12px; color: #888; margin-top: 5px; text-transform: uppercase; }}
        .active {{ color: #00ff88; }}
        .expired {{ color: #ff4757; }}
        .paid {{ color: #ffd700; }}
        .filters {{ background: #1a1a2e; padding: 15px; border-radius: 10px; margin: 20px 0; display: flex; flex-wrap: wrap; gap: 15px; align-items: center; }}
        .filters label {{ color: #888; font-size: 12px; text-transform: uppercase; }}
        .filters select, .filters input {{ background: #0f0f1a; border: 1px solid #333; color: #fff; padding: 8px 12px; border-radius: 6px; }}
        .filters button {{ background: #00d4ff; color: #000; border: none; padding: 8px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; }}
        .filters button:hover {{ background: #00b8e6; }}
        table {{ width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; }}
        th {{ background: #16213e; color: #00d4ff; padding: 12px 8px; text-align: left; position: sticky; top: 0; }}
        td {{ padding: 10px 8px; border-bottom: 1px solid #222; }}
        tr:hover {{ background: #1a1a2e; }}
        .badge {{ padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }}
        .badge-active {{ background: #00ff8820; color: #00ff88; }}
        .badge-expired {{ background: #ff475720; color: #ff4757; }}
        .badge-paid {{ background: #ffd70020; color: #ffd700; }}
        .usage-bar {{ background: #333; border-radius: 4px; height: 6px; width: 60px; display: inline-block; }}
        .usage-fill {{ background: #00d4ff; height: 100%; border-radius: 4px; }}
        .hash {{ font-family: monospace; font-size: 12px; color: #888; }}
        .export-btn {{ background: #333; color: #fff; border: none; padding: 8px 15px; border-radius: 6px; cursor: pointer; margin-left: auto; }}
    </style>
</head>
<body>
    <h1>📊 SnapToAI Admin Dashboard</h1>
    <p class="subtitle">Real-time user analytics and trial management</p>
    
    <div class="stats">
        <div class="stat-box">
            <div class="stat-number" style="color: #00d4ff;">{total_users}</div>
            <div class="stat-label">Total Users</div>
        </div>
        <div class="stat-box">
            <div class="stat-number active">{active_users}</div>
            <div class="stat-label">Active Trials</div>
        </div>
        <div class="stat-box">
            <div class="stat-number expired">{expired_users}</div>
            <div class="stat-label">Expired</div>
        </div>
        <div class="stat-box">
            <div class="stat-number paid">{paid_users}</div>
            <div class="stat-label">Paid Users</div>
        </div>
        <div class="stat-box">
            <div class="stat-number" style="color: #a855f7;">{total_usage}</div>
            <div class="stat-label">Total AI Uses</div>
        </div>
        <div class="stat-box">
            <div class="stat-number" style="color: #f97316;">{len(languages)}</div>
            <div class="stat-label">Countries</div>
        </div>
    </div>
    
    <!-- Anti-Cheat IP Tracking Stats -->
    <div style="background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(139, 92, 246, 0.1)); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 12px; padding: 20px; margin: 20px 0;">
        <h3 style="margin: 0 0 15px 0; color: #a855f7;">🛡️ Anti-Cheat IP Tracking</h3>
        <div class="stats" style="margin: 0;">
            <div class="stat-box">
                <div class="stat-number" style="color: #a855f7;">{total_ips}</div>
                <div class="stat-label">Unique IPs</div>
            </div>
            <div class="stat-box">
                <div class="stat-number" style="color: #06b6d4;">{total_api_keys_tracked}</div>
                <div class="stat-label">API Keys Tracked</div>
            </div>
            <div class="stat-box">
                <div class="stat-number" style="color: {"#ef4444" if max_keys_per_ip > 2 else "#22c55e"};">{max_keys_per_ip}</div>
                <div class="stat-label">Max Keys/IP</div>
            </div>
        </div>
        <p style="color: #888; font-size: 12px; margin: 10px 0 0 0;">Trial countdown is now tied to IP address. Users cannot reset trials by creating new API keys.</p>
        <button onclick="fixTrialDates()" id="fix-btn" style="margin-top: 15px; padding: 10px 20px; background: linear-gradient(135deg, #a855f7, #7c3aed); border: none; border-radius: 8px; color: white; font-weight: 600; cursor: pointer; transition: all 0.3s;">
            🔧 Sync Trial Dates (Fix Anti-Cheat)
        </button>
        <span id="fix-result" style="margin-left: 10px; color: #22c55e;"></span>
        <script>
        async function fixTrialDates() {{
            var btn = document.getElementById('fix-btn');
            var result = document.getElementById('fix-result');
            btn.disabled = true;
            btn.textContent = '⏳ Syncing...';
            try {{
                var resp = await fetch('/api/fix-trial-dates');
                var data = await resp.json();
                if (data.success) {{
                    result.style.color = '#22c55e';
                    result.textContent = '✅ ' + data.message;
                    setTimeout(function() {{ location.reload(); }}, 2000);
                }} else {{
                    result.style.color = '#ef4444';
                    result.textContent = '❌ ' + (data.error || 'Failed');
                }}
            }} catch (e) {{
                result.style.color = '#ef4444';
                result.textContent = '❌ Error: ' + e.message;
            }}
            btn.disabled = false;
            btn.textContent = '🔧 Sync Trial Dates (Fix Anti-Cheat)';
        }}
        </script>
    </div>
    
    <form class="filters" method="GET" action="/admin-dashboard">
        <div>
            <label>Status</label><br>
            <select name="status">
                <option value="all" {"selected" if filter_status == "all" else ""}>All</option>
                <option value="active" {"selected" if filter_status == "active" else ""}>Active</option>
                <option value="expired" {"selected" if filter_status == "expired" else ""}>Expired</option>
                <option value="paid" {"selected" if filter_status == "paid" else ""}>Paid</option>
            </select>
        </div>
        <div>
            <label>Language</label><br>
            <select name="lang">
                <option value="">All Languages</option>
                {"".join(f'<option value="{l}" {"selected" if filter_lang == l else ""}>{l}</option>' for l in sorted(languages))}
            </select>
        </div>
        <div>
            <label>Sort By</label><br>
            <select name="sort">
                <option value="created_desc" {"selected" if sort_by == "created_desc" else ""}>Newest First</option>
                <option value="created_asc" {"selected" if sort_by == "created_asc" else ""}>Oldest First</option>
                <option value="usage_desc" {"selected" if sort_by == "usage_desc" else ""}>Most Active</option>
                <option value="active_desc" {"selected" if sort_by == "active_desc" else ""}>Recently Active</option>
            </select>
        </div>
        <div>
            <label>Search Hash</label><br>
            <input type="text" name="search" value="{search}" placeholder="Search...">
        </div>
        <button type="submit">Apply Filters</button>
        <a href="/admin-dashboard" style="color: #888; text-decoration: none; margin-left: 10px;">Reset</a>
        <a href="/admin-logout" style="color: #ff4757; text-decoration: none; margin-left: 20px;">Logout</a>
    </form>
    
    <p style="color: #666;">Showing {len(processed_rows)} of {total_users} users</p>
    
    <table>
        <tr>
            <th>#</th>
            <th>User Hash</th>
            <th>Location</th>
            <th>Device</th>
            <th>Status</th>
            <th>Days Left</th>
            <th>Plan</th>
            <th>AI Uses</th>
            <th>Registered</th>
            <th>Last Active</th>
        </tr>
'''
        
        max_usage = max((r['usage'] for r in processed_rows), default=1) or 1
        
        for i, r in enumerate(processed_rows, 1):
            badge_class = f"badge-{r['status']}"
            status_text = r['status'].upper()
            usage_pct = min(100, (r['usage'] / max_usage) * 100)
            plan_display = f'<span style="color: #ffd700;">{r["plan_type"]}</span>' if r['plan_type'] != '-' else '-'
            
            # Build location string with IP
            location_str = f"{r['city']}, {r['country']}" if r['city'] != '-' and r['country'] != '-' else (r['country'] if r['country'] != '-' else '-')
            # Build device info
            device_str = f"{r['device']}"
            if r['platform'] != '-':
                device_str += f"<br><span style='color:#666;font-size:10px;'>{r['platform']}</span>"
            if r['screen'] != '-':
                device_str += f"<br><span style='color:#666;font-size:10px;'>{r['screen']}</span>"
            
            html += f'''
        <tr>
            <td>{i}</td>
            <td class="hash" title="{r['full_hash']}">{r['hash']}</td>
            <td style="font-size: 11px;"><span style="color: #00d4ff;">{location_str}</span><br><span style="color:#a855f7;font-size:10px;">{r['ip']}</span><br><span style="color:#666;font-size:10px;">{r['timezone']}</span></td>
            <td style="font-size: 11px;">{device_str}</td>
            <td><span class="badge {badge_class}">{status_text}</span></td>
            <td>{r['days']}</td>
            <td>{plan_display}</td>
            <td>
                {r['usage']}
                <div class="usage-bar"><div class="usage-fill" style="width: {usage_pct}%"></div></div>
            </td>
            <td style="color: #888; font-size: 11px;">{r['created']}</td>
            <td style="color: #888; font-size: 11px;">{r['last_active']}</td>
        </tr>
'''
        
        html += '''
    </table>
    <p style="margin-top: 30px; color: #444;">Data refreshes on page reload. Max 500 users shown.</p>
</body>
</html>
'''
        return Response(html, mimetype='text/html')
        
    except Exception as e:
        print(f'Admin panel error: {e}')
        return Response(f"Error loading data: {e}", status=500)

# ============================================
# TRIAL TRACKING API (Simple: 30 days per API key)
# ============================================

TRIAL_DAYS = 30

# Fix endpoint to sync user_trials with ip_trials dates
@app.route('/api/fix-trial-dates')
def fix_trial_dates():
    """Fix user_trials trial_start_date to match ip_trials (anti-cheat sync)"""
    if not ensure_db():
        return jsonify({'error': 'Database not available'}), 503
    
    try:
        conn = get_db()
        cur = conn.cursor()
        
        # Update all user_trials to use their IP's trial_start_date from ip_trials
        cur.execute('''
            UPDATE user_trials ut
            SET trial_start_date = ip.trial_start_date
            FROM ip_trials ip
            WHERE ut.ip_address = ip.ip_address
              AND ut.trial_start_date > ip.trial_start_date
        ''')
        fixed_count = cur.rowcount
        
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'fixed_records': fixed_count,
            'message': f'Fixed {fixed_count} user_trials records to use IP-based trial dates'
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Debug endpoint to check ip_trials data
@app.route('/api/debug-ip-trials')
def debug_ip_trials():
    """Debug endpoint to check ip_trials table"""
    if not ensure_db():
        return jsonify({'error': 'Database not available'}), 503
    
    try:
        conn = get_db()
        cur = conn.cursor()
        
        # Get all ip_trials records
        cur.execute('SELECT ip_address, trial_start_date, last_active, api_key_count FROM ip_trials ORDER BY trial_start_date DESC LIMIT 20')
        ip_rows = cur.fetchall()
        
        # Get all user_trials IPs for comparison
        cur.execute('SELECT DISTINCT ip_address FROM user_trials WHERE ip_address IS NOT NULL LIMIT 20')
        user_ips = cur.fetchall()
        
        cur.close()
        conn.close()
        
        now_ms = int(datetime.utcnow().timestamp() * 1000)
        
        ip_trials_data = []
        for row in ip_rows:
            days_elapsed = (now_ms - row[1]) / (1000 * 60 * 60 * 24)
            ip_trials_data.append({
                'ip': row[0],
                'trial_start': datetime.fromtimestamp(row[1] / 1000).strftime('%Y-%m-%d %H:%M'),
                'days_elapsed': int(days_elapsed),
                'days_remaining': max(0, 30 - int(days_elapsed)),
                'api_key_count': row[3]
            })
        
        return jsonify({
            'ip_trials': ip_trials_data,
            'user_trials_ips': [r[0] for r in user_ips],
            'total_ip_trials': len(ip_rows)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/trial', methods=['POST', 'OPTIONS'])
def get_or_create_trial():
    """Simple trial tracking: API key hash → 30 day countdown.
    Same API key = same trial. New API key = new 30 days."""
    if request.method == 'OPTIONS':
        response = Response()
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return response
    
    # Ensure database is ready
    if not ensure_db():
        response = jsonify({'error': 'Database not available'})
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 503
    
    try:
        data = request.get_json()
        user_hash = data.get('userHash')
        browser_language = data.get('browserLanguage', '')[:10] if data.get('browserLanguage') else None
        extension_version = data.get('extensionVersion', '')[:20] if data.get('extensionVersion') else None
        
        # Get additional user data from extension
        screen_resolution = data.get('screenResolution', '')[:20] if data.get('screenResolution') else None
        timezone = data.get('timezone', '')[:50] if data.get('timezone') else None
        platform = data.get('platform', '')[:30] if data.get('platform') else None
        
        # Get device ID (most reliable trial tracking - persists across IP changes)
        device_id = data.get('deviceId', '')[:60] if data.get('deviceId') else None
        
        # Get IP address (handle proxies)
        ip_address = request.headers.get('X-Forwarded-For', request.remote_addr)
        if ip_address and ',' in ip_address:
            ip_address = ip_address.split(',')[0].strip()  # First IP is the client
        
        # Get user agent from headers
        user_agent = request.headers.get('User-Agent', '')[:500]
        
        # Determine device type from user agent
        device_type = 'Desktop'
        ua_lower = user_agent.lower()
        if 'mobile' in ua_lower or 'android' in ua_lower or 'iphone' in ua_lower:
            device_type = 'Mobile'
        elif 'tablet' in ua_lower or 'ipad' in ua_lower:
            device_type = 'Tablet'
        
        # Get location from IP (using free API, non-blocking)
        country = None
        city = None
        try:
            if ip_address and ip_address not in ['127.0.0.1', 'localhost']:
                geo_resp = requests.get(f'http://ip-api.com/json/{ip_address}?fields=country,city', timeout=2)
                if geo_resp.status_code == 200:
                    geo_data = geo_resp.json()
                    country = geo_data.get('country', '')[:50]
                    city = geo_data.get('city', '')[:100]
        except:
            pass  # Don't fail if geolocation fails
        
        if not user_hash or len(user_hash) < 16:
            response = jsonify({'error': 'Invalid user hash'})
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response, 400
        
        conn = get_db()
        cur = conn.cursor()
        
        now_ms = int(datetime.utcnow().timestamp() * 1000)
        
        # === DEVICE-BASED TRIAL TRACKING (most reliable) ===
        # Device ID persists across IP changes - this is the PRIMARY source of truth
        device_trial_start = now_ms  # Default to now if new device
        device_is_new = False
        
        if device_id and device_id.startswith('dev_'):
            # Check if this device already has a trial record
            cur.execute('SELECT trial_start_date, api_key_count FROM device_trials WHERE device_id = %s', (device_id,))
            device_row = cur.fetchone()
            
            if device_row:
                # Device exists - use its original trial start date (most reliable anti-cheat!)
                device_trial_start = device_row[0]
                device_api_key_count = device_row[1] or 1
                print(f'🔒 DEVICE TRACKING: Device {device_id[:20]}... found, using trial_start from {datetime.fromtimestamp(device_trial_start/1000).strftime("%Y-%m-%d %H:%M")} (api_key_count: {device_api_key_count})')
                # Update last_active
                cur.execute('UPDATE device_trials SET last_active = %s WHERE device_id = %s', (now_ms, device_id))
            else:
                # New device - create trial record
                device_is_new = True
                print(f'🆕 NEW DEVICE: {device_id[:20]}... - creating new device_trials record')
                cur.execute('''
                    INSERT INTO device_trials (device_id, trial_start_date, last_active, api_key_count)
                    VALUES (%s, %s, %s, 1)
                ''', (device_id, now_ms, now_ms))
                device_trial_start = now_ms
        
        # === IP-BASED TRIAL TRACKING (fallback for older extensions without device ID) ===
        ip_trial_start = now_ms  # Default to now if new IP
        ip_is_new = False  # Track if this is a brand new IP (don't double-count api_key_count)
        
        if ip_address and ip_address not in ['127.0.0.1', 'localhost', '']:
            # Check if this IP already has a trial record
            cur.execute('SELECT trial_start_date, api_key_count FROM ip_trials WHERE ip_address = %s', (ip_address,))
            ip_row = cur.fetchone()
            
            if ip_row:
                # IP exists - use its original trial start date (prevents cheating!)
                ip_trial_start = ip_row[0]
                api_key_count = ip_row[1] or 1
                print(f'🛡️ ANTI-CHEAT: IP {ip_address} found in ip_trials, using trial_start from {datetime.fromtimestamp(ip_trial_start/1000).strftime("%Y-%m-%d %H:%M")} (api_key_count: {api_key_count})')
                # Update last_active
                cur.execute('UPDATE ip_trials SET last_active = %s WHERE ip_address = %s', (now_ms, ip_address))
            else:
                # New IP - create trial record with count=1 (first API key)
                ip_is_new = True
                print(f'🆕 NEW IP: {ip_address} - creating new ip_trials record with trial_start = NOW')
                cur.execute('''
                    INSERT INTO ip_trials (ip_address, trial_start_date, last_active, api_key_count)
                    VALUES (%s, %s, %s, 1)
                ''', (ip_address, now_ms, now_ms))
                ip_trial_start = now_ms
        
        # Now handle user_trials (for subscription tracking and analytics)
        cur.execute('SELECT trial_start_date, is_paid, usage_count FROM user_trials WHERE user_hash = %s', (user_hash,))
        row = cur.fetchone()
        
        if row:
            # Existing user - keep their ORIGINAL trial_start_date (don't change if IP changes)
            original_trial_start = row[0]  # Keep their original date!
            is_paid = row[1] if row[1] else False
            usage_count = (row[2] or 0) + 1
            
            # Use the EARLIEST of: their original date, device date, OR IP date (anti-cheat)
            effective_trial_start = min(original_trial_start, device_trial_start, ip_trial_start)
            
            cur.execute('''
                UPDATE user_trials 
                SET last_active = %s, usage_count = %s, 
                    trial_start_date = %s,
                    browser_language = COALESCE(browser_language, %s),
                    extension_version = COALESCE(%s, extension_version),
                    ip_address = COALESCE(%s, ip_address),
                    country = COALESCE(%s, country),
                    city = COALESCE(%s, city),
                    timezone = COALESCE(%s, timezone),
                    user_agent = COALESCE(%s, user_agent),
                    screen_resolution = COALESCE(%s, screen_resolution),
                    platform = COALESCE(%s, platform),
                    device_type = COALESCE(%s, device_type),
                    device_id = COALESCE(%s, device_id)
                WHERE user_hash = %s
            ''', (now_ms, usage_count, effective_trial_start, browser_language, extension_version, ip_address, 
                  country, city, timezone, user_agent, screen_resolution, platform, device_type, device_id, user_hash))
            
            # Don't increment api_key_count for existing users - they're not new API keys
        else:
            # New user (new API key) - use EARLIEST trial start date from device, IP, or now
            is_paid = False
            usage_count = 1
            
            # Use the earliest available trial start date
            effective_trial_start = min(device_trial_start, ip_trial_start)
            
            cur.execute('''
                INSERT INTO user_trials 
                (user_hash, trial_start_date, is_paid, browser_language, extension_version, last_active, usage_count, 
                 ip_address, country, city, timezone, user_agent, screen_resolution, platform, device_type, device_id) 
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ''', (user_hash, effective_trial_start, False, browser_language, extension_version, now_ms, 1, 
                  ip_address, country, city, timezone, user_agent, screen_resolution, platform, device_type, device_id))
            
            # Increment api_key_count for device (only if device already existed - new API key on existing device)
            if device_id and device_id.startswith('dev_') and not device_is_new:
                cur.execute('UPDATE device_trials SET api_key_count = api_key_count + 1 WHERE device_id = %s', (device_id,))
            
            # Increment api_key_count for IP (only if IP already existed - new API key on existing IP)
            # Don't increment for brand new IPs since we already set count=1 during INSERT
            if ip_address and ip_address not in ['127.0.0.1', 'localhost', ''] and not ip_is_new:
                cur.execute('UPDATE ip_trials SET api_key_count = api_key_count + 1 WHERE ip_address = %s', (ip_address,))
        
        conn.commit()
        cur.close()
        conn.close()
        
        # Calculate trial status based on effective_trial_start (earliest of device, IP, or API key)
        days_elapsed = (now_ms - effective_trial_start) / (1000 * 60 * 60 * 24)
        days_remaining = max(0, TRIAL_DAYS - int(days_elapsed))
        is_expired = days_elapsed >= TRIAL_DAYS
        
        # Simple response
        result = {
            'success': True,
            'trialStartDate': effective_trial_start,
            'daysRemaining': days_remaining,
            'expired': is_expired and not is_paid,
            'isPaid': is_paid,
            'canUseAI': (not is_expired) or is_paid
        }
        
        response = jsonify(result)
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
        
    except Exception as e:
        print(f'Trial API error: {e}')
        response = jsonify({'error': 'Server error'})
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 500

@app.route('/')
def index():
    """Serve landing page - instant OK for health checks, full page for browsers"""
    ua = request.headers.get('User-Agent', '')
    accept = request.headers.get('Accept', '')
    is_health_check = (
        not ua or
        'python-requests' in ua.lower() or
        'kube-probe' in ua.lower() or
        'googlehc' in ua.lower() or
        ('text/html' not in accept and 'application/json' not in accept and '*/*' not in accept)
    )
    if is_health_check and not accept:
        return Response('OK', mimetype='text/plain', status=200)
    response = Response(get_index_html(), mimetype='text/html')
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    return response

@app.route('/<lang_code>')
def language_page(lang_code):
    """Serve language-specific page"""
    # Only handle known language codes - let other routes handle everything else
    if lang_code in SUPPORTED_LANGUAGES:
        lang_file = os.path.join(BASE_DIR, lang_code, 'index.html')
        if os.path.exists(lang_file):
            return serve_file(lang_file)
        return serve_file(os.path.join(BASE_DIR, 'index.html'))
    
    # Check if it's a static file (like style.css)
    file_path = os.path.join(BASE_DIR, lang_code)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return serve_file(file_path)
    
    # Not a language or static file - return 404 to let other routes handle
    return Response("Not found", status=404)

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

@app.route('/privacy-policy')
def privacy_policy_route():
    mime_type = 'text/html'
    try:
        with open('templates/privacy-policy.html', 'r', encoding='utf-8') as f:
            content = f.read()
        response = Response(content, mimetype=mime_type)
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        return response
    except FileNotFoundError:
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
