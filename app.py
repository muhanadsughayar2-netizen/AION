from flask import Flask, send_from_directory, request, redirect, Response, jsonify
import html as html_escape_module
import os
import mimetypes
import psycopg2
from datetime import datetime, timedelta
import requests
import json
import time
import base64
import uuid
try:
    import google.generativeai as genai
except Exception:
    genai = None

# Disable automatic static folder - we'll handle all routing manually
app = Flask(__name__, static_folder=None)

# Database connection - Use Supabase (external) if available, otherwise Replit DB
def get_db():
    # Prefer Supabase for production reliability
    db_url = os.environ.get('DATABASE_URL')
    if not db_url:
        raise Exception("No database URL set")
    try:
        return psycopg2.connect(db_url, sslmode='require')
    except Exception:
        return psycopg2.connect(db_url, sslmode='disable')

# Initialize database table for trial tracking
def init_db():
    try:
        replit_url = os.environ.get('DATABASE_URL')
        db_url = replit_url
        print(f'🔍 DATABASE_URL exists: {bool(replit_url)}')
        print(f'🔍 Using: {"Replit DB" if replit_url else "None"}')
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
        cur.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                name TEXT,
                picture TEXT,
                device_id TEXT,
                first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                capture_count INTEGER DEFAULT 0
            )
        ''')
        cur.execute('''
            CREATE TABLE IF NOT EXISTS user_activity (
                id SERIAL PRIMARY KEY,
                email TEXT,
                action TEXT,
                details TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        ''')
        cur.execute('''
            CREATE TABLE IF NOT EXISTS subscriptions (
                id SERIAL PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                whop_user_id TEXT,
                whop_membership_id TEXT,
                plan_type VARCHAR(20),
                status VARCHAR(20) DEFAULT 'inactive',
                trial_start BIGINT,
                trial_end BIGINT,
                subscription_start TIMESTAMP,
                subscription_end TIMESTAMP,
                last_verified TIMESTAMP DEFAULT NOW(),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        ''')
        cur.execute('''
            CREATE TABLE IF NOT EXISTS free_prompts (
                id SERIAL PRIMARY KEY,
                identifier TEXT UNIQUE NOT NULL,
                usage_count INTEGER DEFAULT 0,
                last_used TIMESTAMP DEFAULT NOW(),
                created_at TIMESTAMP DEFAULT NOW()
            )
        ''')
        cur.execute('''
            CREATE TABLE IF NOT EXISTS video_jobs (
                id SERIAL PRIMARY KEY,
                operation_id TEXT UNIQUE NOT NULL,
                email TEXT,
                prompt TEXT,
                model_used VARCHAR(50),
                status VARCHAR(20) DEFAULT 'processing',
                video_url TEXT,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                completed_at TIMESTAMP
            )
        ''')
        print('✅ users, user_activity, subscriptions, free_prompts, video_jobs tables ready')
        # Add columns if missing (for existing tables)
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT FALSE')
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS browser_language VARCHAR(10)')
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS extension_version VARCHAR(20)')
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS last_active BIGINT')
        cur.execute('ALTER TABLE user_trials ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0')
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

if genai and os.environ.get('GEMINI_API_KEY'):
    try:
        genai.configure(api_key=os.environ.get('GEMINI_API_KEY'))
    except Exception as e:
        print(f'⚠️ Gemini SDK init failed: {e}')

@app.route('/api/check-video-support', methods=['POST', 'OPTIONS'])
def check_video_support():
    if request.method == 'OPTIONS':
        response = Response()
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
        return response

    if not genai:
        return jsonify({
            "status": "error",
            "videoSupported": False,
            "error": "google-generativeai is not installed"
        }), 500

    data = request.get_json(silent=True) or {}
    user_key = data.get('apiKey', '')
    server_key = os.environ.get('GOOGLE_API_KEY', '') or os.environ.get('GEMINI_API_KEY', '')
    check_key = user_key or server_key

    if not check_key:
        return jsonify({
            "status": "error",
            "videoSupported": False,
            "error": "No API key available"
        }), 500
    try:
        list_url = f'https://generativelanguage.googleapis.com/v1beta/models?key={check_key}'
        resp = requests.get(list_url, timeout=10)
        if not resp.ok:
            return jsonify({
                "status": "error",
                "videoSupported": False,
                "error": f"Failed to list models: {resp.status_code}"
            }), resp.status_code
        models_data = resp.json().get('models', [])
        video_models = [
            {
                "name": m.get('name', ''),
                "displayName": m.get('displayName', ''),
                "description": m.get('description', '')
            }
            for m in models_data
            if 'veo' in m.get('name', '').lower()
        ]
        return jsonify({
            "status": "success",
            "videoSupported": len(video_models) > 0,
            "availableModels": video_models,
            "usingServerKey": not user_key,
            "message": "Video models found" if video_models else "No video models found for this key"
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "videoSupported": False,
            "error": str(e)
        }), 500

OWNER_EMAILS_SET = {
    'muhanadsughayar2@gmail.com',
    'muhanadsughayar@gmail.com',
    'muhanadsughayar1@gmail.com',
    'jospeh@smartconnects.com'
}

VIDEO_DAILY_LIMIT_FREE = 2
VIDEO_DAILY_LIMIT_PAID = 10
VIDEO_COOLDOWN_SECONDS = 300

def verify_google_token(token):
    try:
        resp = requests.get(
            f'https://oauth2.googleapis.com/tokeninfo?access_token={token}',
            timeout=5
        )
        if resp.ok:
            data = resp.json()
            return data.get('email', '').lower()
        return None
    except Exception:
        return None

def get_verified_email(req):
    auth_header = req.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        token = auth_header[7:]
        verified_email = verify_google_token(token)
        if verified_email:
            return verified_email
    token_param = req.args.get('token', '')
    if token_param:
        verified_email = verify_google_token(token_param)
        if verified_email:
            return verified_email
    return None

def get_user_video_stats(email):
    try:
        conn = get_db()
        cur = conn.cursor()
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        cur.execute(
            "SELECT COUNT(*) FROM video_jobs WHERE email = %s AND created_at >= %s",
            (email, today_start)
        )
        daily_count = cur.fetchone()[0]
        cur.execute(
            "SELECT MAX(created_at) FROM video_jobs WHERE email = %s",
            (email,)
        )
        last_job_row = cur.fetchone()
        last_job_time = last_job_row[0] if last_job_row and last_job_row[0] else None
        cur.close()
        conn.close()
        return daily_count, last_job_time
    except Exception as e:
        print(f'[Video] Stats error: {e}')
        return 0, None

def check_user_subscription(email):
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            "SELECT status, plan_type FROM subscriptions WHERE email = %s",
            (email,)
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row and row[0] in ('active', 'subscribed'):
            return True, row[1]
        return False, None
    except Exception:
        return False, None

@app.route('/api/generate-video', methods=['POST', 'OPTIONS'])
def generate_video():
    if request.method == 'OPTIONS':
        response = Response()
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
        return response
    video_api_key = os.environ.get('GOOGLE_API_KEY') or os.environ.get('GEMINI_API_KEY')
    if not video_api_key:
        return jsonify({"error": "Video generation not configured"}), 500

    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing request body"}), 400

    prompt = data.get('prompt', '').strip()
    image_base64 = data.get('image', '')

    if not prompt:
        return jsonify({"error": "Prompt is required"}), 400

    email = get_verified_email(request)
    if not email:
        return jsonify({"error": "Authentication required. Please sign in with Google."}), 401

    is_owner = email in OWNER_EMAILS_SET
    is_subscribed, plan_type = check_user_subscription(email) if not is_owner else (True, 'owner')

    if not is_owner:
        daily_count, last_job_time = get_user_video_stats(email)
        daily_limit = VIDEO_DAILY_LIMIT_PAID if is_subscribed else VIDEO_DAILY_LIMIT_FREE

        if daily_count >= daily_limit:
            return jsonify({
                "error": f"Daily limit reached ({daily_limit} videos/day). {'Upgrade for more!' if not is_subscribed else 'Try again tomorrow.'}",
                "limitReached": True
            }), 429

        if last_job_time:
            elapsed = (datetime.utcnow() - last_job_time).total_seconds()
            if elapsed < VIDEO_COOLDOWN_SECONDS:
                remaining = int(VIDEO_COOLDOWN_SECONDS - elapsed)
                return jsonify({
                    "error": f"Please wait {remaining} seconds before generating another video.",
                    "cooldown": remaining
                }), 429

    model_name = 'veo-3.1-generate-preview' if is_subscribed else 'veo-2.0-generate-001'

    try:
        url = f'https://generativelanguage.googleapis.com/v1beta/models/{model_name}:predictLongRunning?key={video_api_key}'

        request_body = {
            "instances": [{
                "prompt": prompt
            }],
            "parameters": {
                "aspectRatio": "16:9",
                "sampleCount": 1,
                "durationSeconds": 8,
                "personGeneration": "allow_all"
            }
        }

        if image_base64:
            clean_b64 = image_base64.split(',')[1] if ',' in image_base64 else image_base64
            request_body["instances"][0]["image"] = {
                "bytesBase64Encoded": clean_b64
            }

        resp = requests.post(url, json=request_body, timeout=30)
        resp_data = resp.json()

        if not resp.ok:
            error_msg = resp_data.get('error', {}).get('message', f'API error {resp.status_code}')
            print(f'[Video] API error: {error_msg}')
            return jsonify({"error": error_msg}), resp.status_code

        operation_name = resp_data.get('name', '')
        if not operation_name:
            return jsonify({"error": "No operation ID returned from API"}), 500

        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO video_jobs (operation_id, email, prompt, model_used, status)
                   VALUES (%s, %s, %s, %s, 'processing')""",
                (operation_name, email, prompt[:500], model_name)
            )
            conn.commit()
            cur.close()
            conn.close()
        except Exception as db_err:
            print(f'[Video] DB insert error: {db_err}')

        return jsonify({
            "operationId": operation_name,
            "model": model_name,
            "status": "processing"
        })

    except requests.exceptions.Timeout:
        return jsonify({"error": "Request timed out. Please try again."}), 504
    except Exception as e:
        print(f'[Video] Generation error: {e}')
        return jsonify({"error": str(e)}), 500

@app.route('/api/video-status/<path:operation_id>', methods=['GET', 'OPTIONS'])
def video_status(operation_id):
    if request.method == 'OPTIONS':
        response = Response()
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
        return response
    video_api_key = os.environ.get('GOOGLE_API_KEY') or os.environ.get('GEMINI_API_KEY')
    if not video_api_key:
        return jsonify({"error": "Not configured"}), 500

    email = get_verified_email(request)
    if not email:
        return jsonify({"error": "Authentication required"}), 401

    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT email FROM video_jobs WHERE operation_id = %s", (operation_id,))
        job_row = cur.fetchone()
        cur.close()
        conn.close()
        if job_row and job_row[0] and job_row[0].lower() != email:
            return jsonify({"error": "Access denied"}), 403
    except Exception:
        pass

    try:
        url = f'https://generativelanguage.googleapis.com/v1beta/{operation_id}?key={video_api_key}'

        resp = requests.get(url, timeout=15)
        resp_data = resp.json()

        if not resp.ok:
            error_msg = resp_data.get('error', {}).get('message', f'Status check failed ({resp.status_code})')
            return jsonify({"status": "error", "error": error_msg}), resp.status_code

        done = resp_data.get('done', False)

        if not done:
            metadata = resp_data.get('metadata', {})
            return jsonify({
                "status": "processing",
                "progress": metadata.get('percentComplete', 0)
            })

        response = resp_data.get('response', {})
        videos = response.get('generateVideoResponse', {}).get('generatedSamples', [])

        if not videos:
            error_info = resp_data.get('error', {})
            error_msg = error_info.get('message', 'Video generation failed — no output returned.')
            try:
                conn = get_db()
                cur = conn.cursor()
                cur.execute(
                    "UPDATE video_jobs SET status='failed', error_message=%s, completed_at=NOW() WHERE operation_id=%s",
                    (error_msg, operation_id)
                )
                conn.commit()
                cur.close()
                conn.close()
            except Exception:
                pass
            return jsonify({"status": "error", "error": error_msg})

        video_uri = videos[0].get('video', {}).get('uri', '')

        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute(
                "UPDATE video_jobs SET status='completed', video_url=%s, completed_at=NOW() WHERE operation_id=%s",
                (video_uri, operation_id)
            )
            conn.commit()
            cur.close()
            conn.close()
        except Exception:
            pass

        safe_op_id = operation_id.replace('/', '__')
        proxy_url = f'/api/video-download/{safe_op_id}'

        return jsonify({
            "status": "completed",
            "videoUrl": proxy_url
        })

    except Exception as e:
        print(f'[Video] Status check error: {e}')
        return jsonify({"status": "error", "error": str(e)}), 500

@app.route('/api/video-download/<path:safe_op_id>', methods=['GET'])
def video_download(safe_op_id):
    operation_id = safe_op_id.replace('__', '/')

    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            "SELECT video_url, email FROM video_jobs WHERE operation_id = %s AND status = 'completed'",
            (operation_id,)
        )
        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row or not row[0]:
            return jsonify({"error": "Video not found"}), 404

        job_email = row[1].lower() if row[1] else ''
        caller_email = get_verified_email(request)
        if not caller_email:
            return jsonify({"error": "Authentication required"}), 401
        if job_email and caller_email != job_email:
            return jsonify({"error": "Access denied"}), 403

        video_uri = row[0]
        api_key = os.environ.get('GOOGLE_API_KEY') or os.environ.get('GEMINI_API_KEY')
        if api_key:
            separator = '&' if '?' in video_uri else '?'
            authenticated_url = f'{video_uri}{separator}key={api_key}'
        else:
            authenticated_url = video_uri

        video_resp = requests.get(authenticated_url, timeout=30, stream=True)
        if not video_resp.ok:
            return jsonify({"error": "Failed to fetch video"}), 502

        content_type = video_resp.headers.get('Content-Type', 'video/mp4')

        return Response(
            video_resp.iter_content(chunk_size=8192),
            content_type=content_type,
            headers={
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=3600'
            }
        )
    except Exception as e:
        print(f'[Video] Download proxy error: {e}')
        return jsonify({"error": "Failed to download video"}), 500


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
    origin = request.headers.get('Origin', '')
    if origin.startswith('chrome-extension://'):
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    return response

@app.route('/health')
def health():
    """Health check endpoint for deployment"""
    return Response("OK", status=200, mimetype='text/plain')

@app.errorhandler(500)
def handle_500(e):
    print(f'❌ 500 error: {e}')
    return Response("Internal Server Error", status=500, mimetype='text/plain')

@app.route('/api/db-status')
def db_status():
    """Check database status - useful for debugging production"""
    replit_url = os.environ.get('DATABASE_URL')
    db_url = replit_url
    
    result = {
        'has_replit_url': bool(replit_url),
        'using': 'replit' if replit_url else 'none',
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


@app.route('/api/auth/register', methods=['POST', 'OPTIONS'])
def auth_register():
    if request.method == 'OPTIONS':
        response = Response()
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return response

    if not ensure_db():
        response = jsonify({'error': 'Database not available'})
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 503

    try:
        data = request.get_json(silent=True)
        if not data:
            response = jsonify({'success': False, 'error': 'Invalid request body'})
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response, 400

        name = str(data.get('name', ''))[:200]
        email = str(data.get('email', ''))[:200].strip().lower()
        picture = str(data.get('picture', ''))[:500]
        device_id = str(data.get('deviceId', ''))[:100]

        if not email or '@' not in email:
            response = jsonify({'success': False, 'error': 'Valid email is required'})
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response, 400

        conn = get_db()
        cur = conn.cursor()
        cur.execute('''
            INSERT INTO users (email, name, picture, device_id, first_seen, last_seen)
            VALUES (%s, %s, %s, %s, NOW(), NOW())
            ON CONFLICT (email) DO UPDATE SET
                name = EXCLUDED.name,
                picture = EXCLUDED.picture,
                device_id = COALESCE(EXCLUDED.device_id, users.device_id),
                last_seen = NOW()
            RETURNING id
        ''', (email, name, picture, device_id))
        user_id = cur.fetchone()[0]
        conn.commit()
        cur.close()
        conn.close()

        response = jsonify({'success': True, 'userId': user_id})
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
    except Exception as e:
        print(f'❌ auth/register error: {e}')
        response = jsonify({'success': False, 'error': 'Registration failed'})
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 500


@app.route('/api/auth/activity', methods=['POST', 'OPTIONS'])
def auth_activity():
    if request.method == 'OPTIONS':
        response = Response()
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return response

    if not ensure_db():
        response = jsonify({'error': 'Database not available'})
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 503

    try:
        data = request.get_json(silent=True)
        if not data:
            response = jsonify({'success': False, 'error': 'Invalid request body'})
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response, 400

        email = str(data.get('email', ''))[:200].strip().lower()
        action = str(data.get('action', ''))[:100]
        details = str(data.get('details', ''))[:500]

        valid_actions = ['capture_snap', 'capture_snip', 'capture_fullpage', 'ai_chat', 'review_prompt_shown', 'review_clicked']
        if not email or '@' not in email or not action:
            response = jsonify({'success': False, 'error': 'Valid email and action are required'})
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response, 400

        if action not in valid_actions:
            response = jsonify({'success': False, 'error': 'Invalid action'})
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response, 400

        conn = get_db()
        cur = conn.cursor()
        cur.execute('''
            INSERT INTO user_activity (email, action, details, created_at)
            VALUES (%s, %s, %s, NOW())
        ''', (email, action, details))

        if action in ('capture_snap', 'capture_snip', 'capture_fullpage'):
            cur.execute('''
                UPDATE users SET capture_count = capture_count + 1, last_seen = NOW()
                WHERE email = %s
            ''', (email,))

        conn.commit()
        cur.close()
        conn.close()

        response = jsonify({'success': True})
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
    except Exception as e:
        print(f'❌ auth/activity error: {e}')
        response = jsonify({'success': False, 'error': 'Activity logging failed'})
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 500


@app.route('/api/admin/users')
def admin_users():
    password = request.args.get('password', '')
    if password != ADMIN_PASSWORD and not verify_admin_session():
        return jsonify({'error': 'Unauthorized'}), 401

    if not ensure_db():
        return jsonify({'error': 'Database not available'}), 503

    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('''
            SELECT u.id, u.email, u.name, u.picture, u.device_id, u.first_seen, u.last_seen, u.capture_count,
                   s.status, s.plan_type, s.trial_start, s.trial_end, s.subscription_start, s.subscription_end
            FROM users u
            LEFT JOIN subscriptions s ON LOWER(u.email) = LOWER(s.email)
            ORDER BY u.last_seen DESC LIMIT 500
        ''')
        rows = cur.fetchall()
        cur.close()
        conn.close()

        now_ms = int(datetime.utcnow().timestamp() * 1000)
        users_list = []
        for row in rows:
            sub_status = row[8] or 'none'
            plan_type = row[9]
            trial_start = row[10]
            trial_end = row[11]
            trial_days_left = None
            if trial_start and trial_end:
                trial_days_left = max(0, int((trial_end - now_ms) / 86400000))
            users_list.append({
                'id': row[0],
                'email': row[1],
                'name': row[2],
                'picture': row[3],
                'deviceId': row[4],
                'firstSeen': row[5].isoformat() if row[5] else None,
                'lastSeen': row[6].isoformat() if row[6] else None,
                'captureCount': row[7] or 0,
                'subscriptionStatus': sub_status,
                'planType': plan_type,
                'trialDaysLeft': trial_days_left,
                'subscriptionStart': row[12].isoformat() if row[12] else None,
                'subscriptionEnd': row[13].isoformat() if row[13] else None
            })

        return jsonify({'success': True, 'users': users_list, 'total': len(users_list)})
    except Exception as e:
        print(f'❌ admin/users error: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/activity')
def admin_activity():
    password = request.args.get('password', '')
    if password != ADMIN_PASSWORD and not verify_admin_session():
        return jsonify({'error': 'Unauthorized'}), 401

    if not ensure_db():
        return jsonify({'error': 'Database not available'}), 503

    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('''
            SELECT id, email, action, details, created_at
            FROM user_activity ORDER BY created_at DESC LIMIT 200
        ''')
        rows = cur.fetchall()
        cur.close()
        conn.close()

        activity_list = []
        for row in rows:
            activity_list.append({
                'id': row[0],
                'email': row[1],
                'action': row[2],
                'details': row[3],
                'createdAt': row[4].isoformat() if row[4] else None
            })

        return jsonify({'success': True, 'activity': activity_list, 'total': len(activity_list)})
    except Exception as e:
        print(f'❌ admin/activity error: {e}')
        return jsonify({'error': str(e)}), 500

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

        cur.execute('''
            SELECT id, email, name, picture, device_id, first_seen, last_seen, capture_count
            FROM users ORDER BY last_seen DESC LIMIT 500
        ''')
        registered_users_rows = cur.fetchall()

        cur.execute('''
            SELECT id, email, action, details, created_at
            FROM user_activity ORDER BY created_at DESC LIMIT 50
        ''')
        recent_activity_rows = cur.fetchall()
        
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
'''

        html += f'''
    <div style="background: linear-gradient(135deg, rgba(0, 212, 255, 0.15), rgba(0, 150, 200, 0.08)); border: 1px solid rgba(0, 212, 255, 0.3); border-radius: 12px; padding: 20px; margin: 30px 0;">
        <h2 style="color: #00d4ff; margin: 0 0 5px 0;">👥 Registered Users</h2>
        <p style="color: #888; font-size: 12px; margin: 0 0 15px 0;">Users who signed in with Google — {len(registered_users_rows)} total</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
                <th style="background: #16213e; color: #00d4ff; padding: 12px 8px; text-align: left;">#</th>
                <th style="background: #16213e; color: #00d4ff; padding: 12px 8px; text-align: left;">Photo</th>
                <th style="background: #16213e; color: #00d4ff; padding: 12px 8px; text-align: left;">Name</th>
                <th style="background: #16213e; color: #00d4ff; padding: 12px 8px; text-align: left;">Email</th>
                <th style="background: #16213e; color: #00d4ff; padding: 12px 8px; text-align: left;">Captures</th>
                <th style="background: #16213e; color: #00d4ff; padding: 12px 8px; text-align: left;">First Seen</th>
                <th style="background: #16213e; color: #00d4ff; padding: 12px 8px; text-align: left;">Last Seen</th>
            </tr>
'''

        for idx, urow in enumerate(registered_users_rows, 1):
            u_id = urow[0]
            u_email = html_escape_module.escape(str(urow[1] or '-'))
            u_name = html_escape_module.escape(str(urow[2] or '-'))
            u_picture = html_escape_module.escape(str(urow[3] or ''))
            u_device = html_escape_module.escape(str(urow[4] or '-'))
            u_first = urow[5].strftime('%Y-%m-%d %H:%M') if urow[5] else '-'
            u_last = urow[6].strftime('%Y-%m-%d %H:%M') if urow[6] else '-'
            u_captures = urow[7] or 0
            photo_html = f'<img src="{u_picture}" style="width:28px;height:28px;border-radius:50%;border:1px solid #333;" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">' if u_picture else '<div style="width:28px;height:28px;border-radius:50%;background:#333;display:inline-block;"></div>'
            html += f'''
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid #222;">{idx}</td>
                <td style="padding: 8px; border-bottom: 1px solid #222;">{photo_html}</td>
                <td style="padding: 8px; border-bottom: 1px solid #222; color: #e0e0e0;">{u_name}</td>
                <td style="padding: 8px; border-bottom: 1px solid #222; color: #888; font-size: 12px;">{u_email}</td>
                <td style="padding: 8px; border-bottom: 1px solid #222; color: #00ff88; font-weight: bold;">{u_captures}</td>
                <td style="padding: 8px; border-bottom: 1px solid #222; color: #888; font-size: 11px;">{u_first}</td>
                <td style="padding: 8px; border-bottom: 1px solid #222; color: #888; font-size: 11px;">{u_last}</td>
            </tr>
'''

        html += '''
        </table>
    </div>
'''

        action_colors = {
            'capture_snap': '#00ff88',
            'capture_snip': '#06b6d4',
            'capture_fullpage': '#a855f7',
            'ai_chat': '#ffd700',
            'review_prompt_shown': '#f97316',
            'review_clicked': '#22c55e',
        }

        html += f'''
    <div style="background: linear-gradient(135deg, rgba(249, 115, 22, 0.15), rgba(200, 80, 10, 0.08)); border: 1px solid rgba(249, 115, 22, 0.3); border-radius: 12px; padding: 20px; margin: 30px 0;">
        <h2 style="color: #f97316; margin: 0 0 5px 0;">📋 Recent Activity</h2>
        <p style="color: #888; font-size: 12px; margin: 0 0 15px 0;">Last 50 user actions</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
                <th style="background: #16213e; color: #f97316; padding: 12px 8px; text-align: left;">#</th>
                <th style="background: #16213e; color: #f97316; padding: 12px 8px; text-align: left;">Email</th>
                <th style="background: #16213e; color: #f97316; padding: 12px 8px; text-align: left;">Action</th>
                <th style="background: #16213e; color: #f97316; padding: 12px 8px; text-align: left;">Details</th>
                <th style="background: #16213e; color: #f97316; padding: 12px 8px; text-align: left;">Timestamp</th>
            </tr>
'''

        for aidx, arow in enumerate(recent_activity_rows, 1):
            a_email = html_escape_module.escape(str(arow[1] or '-'))
            a_action = html_escape_module.escape(str(arow[2] or '-'))
            a_details = html_escape_module.escape(str(arow[3] or '-'))
            a_time = arow[4].strftime('%Y-%m-%d %H:%M:%S') if arow[4] else '-'
            a_color = action_colors.get(a_action, '#888')
            html += f'''
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid #222;">{aidx}</td>
                <td style="padding: 8px; border-bottom: 1px solid #222; color: #888; font-size: 12px;">{a_email}</td>
                <td style="padding: 8px; border-bottom: 1px solid #222;"><span style="color: {a_color}; font-weight: bold; font-size: 12px;">{a_action}</span></td>
                <td style="padding: 8px; border-bottom: 1px solid #222; color: #666; font-size: 11px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{a_details}</td>
                <td style="padding: 8px; border-bottom: 1px solid #222; color: #888; font-size: 11px;">{a_time}</td>
            </tr>
'''

        html += '''
        </table>
    </div>
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

def _get_plan_id(env_key, fallback):
    """Get plan ID from env var, stripping URL prefixes if accidentally set as full URLs."""
    val = os.environ.get(env_key, '') or fallback
    if 'whop.com/checkout/' in val:
        val = val.rstrip('/').split('/')[-1]
    return val if val.startswith('plan_') else fallback

def _check_whop_api_for_email(email):
    """Direct Whop API check - finds active membership by email.
    Returns dict with plan_type and membership_id if found, None otherwise."""
    whop_api_key = os.environ.get('WHOP_API_KEY', '')
    if not whop_api_key:
        return None
    try:
        resp = requests.get(
            'https://api.whop.com/api/v2/memberships',
            headers={'Authorization': f'Bearer {whop_api_key}'},
            params={'email': email, 'valid': 'true'},
            timeout=8
        )
        if resp.status_code != 200:
            print(f'Whop API check failed: status {resp.status_code}')
            return None
        data = resp.json()
        memberships = data.get('data', [])
        if not memberships:
            return None
        m = memberships[0]
        plan_id = m.get('plan_id', '') or m.get('plan', {}).get('id', '')
        monthly_plan_id = _get_plan_id('MONTHLY_PLAN_ID', 'plan_hmWCOg7IaSal9')
        yearly_plan_id = _get_plan_id('YEARLY_PLAN_ID', 'plan_XSjtJu7RnYLW8')
        plan_type = 'monthly' if plan_id == monthly_plan_id else ('yearly' if plan_id == yearly_plan_id else 'unknown')
        membership_id = m.get('id', '')
        print(f'Whop API: found active membership for {email}, plan={plan_type}, id={membership_id}')
        return {'plan_type': plan_type, 'membership_id': membership_id}
    except Exception as e:
        print(f'Whop API check error: {e}')
        return None


@app.route('/api/subscription/status', methods=['POST', 'OPTIONS'])
def subscription_status():
    if request.method == 'OPTIONS':
        response = Response()
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return response

    if not ensure_db():
        response = jsonify({'error': 'Database not available'})
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 503

    try:
        data = request.get_json(silent=True)
        if not data:
            response = jsonify({'success': False, 'error': 'Invalid request'})
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response, 400

        email = str(data.get('email', '')).strip().lower()[:200]
        device_id = str(data.get('deviceId', ''))[:100]

        if not email or '@' not in email:
            response = jsonify({'success': False, 'error': 'Valid email required'})
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response, 400

        conn = get_db()
        cur = conn.cursor()
        now_ms = int(datetime.utcnow().timestamp() * 1000)

        cur.execute('SELECT plan_type, status, trial_start, trial_end, subscription_end FROM subscriptions WHERE email = %s', (email,))
        sub_row = cur.fetchone()

        if sub_row:
            plan_type = sub_row[0]
            status = sub_row[1]
            trial_start = sub_row[2]
            trial_end = sub_row[3]
            subscription_end = sub_row[4]

            cur.execute('UPDATE subscriptions SET last_verified = NOW(), updated_at = NOW() WHERE email = %s', (email,))
            conn.commit()

            if status == 'active':
                cur.close()
                conn.close()
                result = {'success': True, 'canUseAI': True, 'status': 'subscribed', 'planType': plan_type, 'daysRemaining': None}
                response = jsonify(result)
                response.headers['Access-Control-Allow-Origin'] = '*'
                return response

            if status == 'canceled' and subscription_end:
                if subscription_end > datetime.utcnow():
                    cur.close()
                    conn.close()
                    result = {'success': True, 'canUseAI': True, 'status': 'subscribed', 'planType': plan_type, 'daysRemaining': None}
                    response = jsonify(result)
                    response.headers['Access-Control-Allow-Origin'] = '*'
                    return response
                else:
                    cur.close()
                    conn.close()
                    result = {'success': True, 'canUseAI': False, 'status': 'subscription_expired', 'planType': None, 'daysRemaining': 0}
                    response = jsonify(result)
                    response.headers['Access-Control-Allow-Origin'] = '*'
                    return response

            if status == 'expired':
                was_subscriber = True
            else:
                was_subscriber = False
        else:
            was_subscriber = False

        whop_result = _check_whop_api_for_email(email)
        if whop_result:
            cur.execute('''
                INSERT INTO subscriptions (email, whop_membership_id, plan_type, status, subscription_start, updated_at, last_verified)
                VALUES (%s, %s, %s, 'active', NOW(), NOW(), NOW())
                ON CONFLICT (email) DO UPDATE SET
                    whop_membership_id = COALESCE(EXCLUDED.whop_membership_id, subscriptions.whop_membership_id),
                    plan_type = EXCLUDED.plan_type,
                    status = 'active',
                    subscription_start = COALESCE(subscriptions.subscription_start, NOW()),
                    subscription_end = NULL,
                    updated_at = NOW(),
                    last_verified = NOW()
            ''', (email, whop_result.get('membership_id', ''), whop_result.get('plan_type', 'unknown')))
            conn.commit()
            cur.close()
            conn.close()
            result = {'success': True, 'canUseAI': True, 'status': 'subscribed', 'planType': whop_result.get('plan_type', 'unknown'), 'daysRemaining': None}
            response = jsonify(result)
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response

        if sub_row:
            if was_subscriber:
                cur.close()
                conn.close()
                result = {'success': True, 'canUseAI': False, 'status': 'subscription_expired', 'planType': None, 'daysRemaining': 0}
                response = jsonify(result)
                response.headers['Access-Control-Allow-Origin'] = '*'
                return response

            if trial_start and trial_end:
                days_remaining = max(0, int((trial_end - now_ms) / 86400000))
                can_use = days_remaining > 0
                cur.close()
                conn.close()
                result = {'success': True, 'canUseAI': can_use, 'status': 'trial' if can_use else 'trial_expired', 'planType': 'trial' if can_use else None, 'daysRemaining': days_remaining}
                response = jsonify(result)
                response.headers['Access-Control-Allow-Origin'] = '*'
                return response

        trial_start = now_ms
        trial_end = now_ms + (TRIAL_DAYS * 86400000)

        cur.execute('SELECT trial_start_date FROM device_trials WHERE device_id = %s', (device_id,)) if device_id else None
        device_row = cur.fetchone() if device_id else None
        if device_row:
            trial_start = min(trial_start, device_row[0])
            trial_end = trial_start + (TRIAL_DAYS * 86400000)

        ip_address = request.headers.get('X-Forwarded-For', request.remote_addr)
        if ip_address and ',' in ip_address:
            ip_address = ip_address.split(',')[0].strip()
        if ip_address and ip_address not in ['127.0.0.1', 'localhost', '']:
            cur.execute('SELECT trial_start_date FROM ip_trials WHERE ip_address = %s', (ip_address,))
            ip_row = cur.fetchone()
            if ip_row:
                trial_start = min(trial_start, ip_row[0])
                trial_end = trial_start + (TRIAL_DAYS * 86400000)

        cur.execute('''
            INSERT INTO subscriptions (email, status, trial_start, trial_end, created_at, updated_at, last_verified)
            VALUES (%s, 'trial', %s, %s, NOW(), NOW(), NOW())
            ON CONFLICT (email) DO UPDATE SET
                trial_start = COALESCE(LEAST(subscriptions.trial_start, EXCLUDED.trial_start), EXCLUDED.trial_start),
                trial_end = COALESCE(LEAST(subscriptions.trial_start, EXCLUDED.trial_start), EXCLUDED.trial_start) + %s,
                last_verified = NOW(),
                updated_at = NOW()
            WHERE subscriptions.status NOT IN ('active')
        ''', (email, trial_start, trial_end, TRIAL_DAYS * 86400000))
        conn.commit()

        days_remaining = max(0, int((trial_end - now_ms) / 86400000))
        can_use = days_remaining > 0

        cur.close()
        conn.close()

        result = {'success': True, 'canUseAI': can_use, 'status': 'trial' if can_use else 'trial_expired', 'planType': 'trial' if can_use else None, 'daysRemaining': days_remaining}
        response = jsonify(result)
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

    except Exception as e:
        print(f'Subscription status error: {e}')
        response = jsonify({'error': 'Server error'})
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 500


@app.route('/api/whop/webhook', methods=['POST'])
def whop_webhook():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'error': 'Invalid payload'}), 400

        action = data.get('action', '') or data.get('event', '')
        resource = data.get('data', {})

        whop_api_key = os.environ.get('WHOP_API_KEY', '')
        membership_id = resource.get('id', '') or resource.get('membership_id', '') or data.get('membership_id', '')

        verified_email = None
        is_verified = False

        if whop_api_key and membership_id:
            try:
                verify_resp = requests.get(
                    f'https://api.whop.com/api/v2/memberships/{membership_id}',
                    headers={'Authorization': f'Bearer {whop_api_key}'},
                    timeout=5
                )
                if verify_resp.status_code == 200:
                    verified_data = verify_resp.json()
                    verified_email = verified_data.get('email', '').strip().lower()
                    if verified_email:
                        is_verified = True
                        print(f'Whop webhook: membership {membership_id} VERIFIED, email={verified_email}')
                    else:
                        print(f'Whop webhook: membership verified but no email in response')
                else:
                    print(f'Whop webhook: membership verification failed (status {verify_resp.status_code})')
            except Exception as ve:
                print(f'Whop webhook: API verification error: {ve}')

        if not is_verified:
            payload_email = resource.get('email', '').strip().lower()
            if not payload_email:
                metadata = resource.get('metadata', {})
                payload_email = metadata.get('email', '').strip().lower() if metadata else ''
            if not payload_email:
                user_data = resource.get('user', {})
                payload_email = user_data.get('email', '').strip().lower() if user_data else ''

            if payload_email:
                print(f'Whop webhook: UNVERIFIED request for {payload_email}, logging only (no DB update)')
                return jsonify({'received': True, 'warning': 'unverified, no action taken'}), 200
            else:
                print(f'Whop webhook: no email and no verification, ignoring')
                return jsonify({'received': True, 'warning': 'no email found'}), 200

        email = verified_email
        print(f'Whop webhook processing: action={action}, verified_email={email}')

        whop_user_id = resource.get('user_id', '') or resource.get('user', {}).get('id', '')
        membership_id = resource.get('id', '') or resource.get('membership_id', '')
        plan = resource.get('plan_id', '') or resource.get('plan', {}).get('id', '')

        plan_type = 'unknown'
        monthly_plan_id = _get_plan_id('MONTHLY_PLAN_ID', 'plan_hmWCOg7IaSal9')
        yearly_plan_id = _get_plan_id('YEARLY_PLAN_ID', 'plan_XSjtJu7RnYLW8')
        if plan == monthly_plan_id:
            plan_type = 'monthly'
        elif plan == yearly_plan_id:
            plan_type = 'yearly'

        print(f'Whop webhook: action={action}, email={email}, membership={membership_id}, plan={plan_type}')

        if not email:
            print('Whop webhook: no email found in payload')
            return jsonify({'received': True, 'warning': 'no email'}), 200

        if not ensure_db():
            return jsonify({'error': 'Database not available'}), 503

        conn = get_db()
        cur = conn.cursor()

        if action in ['membership.went_valid', 'membership.renewed', 'payment.succeeded', 'membership_activated', 'payment_succeeded']:
            cur.execute('''
                INSERT INTO subscriptions (email, whop_user_id, whop_membership_id, plan_type, status, subscription_start, updated_at, last_verified)
                VALUES (%s, %s, %s, %s, 'active', NOW(), NOW(), NOW())
                ON CONFLICT (email) DO UPDATE SET
                    whop_user_id = COALESCE(EXCLUDED.whop_user_id, subscriptions.whop_user_id),
                    whop_membership_id = COALESCE(EXCLUDED.whop_membership_id, subscriptions.whop_membership_id),
                    plan_type = EXCLUDED.plan_type,
                    status = 'active',
                    subscription_start = COALESCE(subscriptions.subscription_start, NOW()),
                    subscription_end = NULL,
                    updated_at = NOW(),
                    last_verified = NOW()
            ''', (email, whop_user_id, membership_id, plan_type))

        elif action in ['membership.went_invalid', 'membership.expired', 'membership_deactivated']:
            cur.execute('''
                UPDATE subscriptions SET status = 'expired', subscription_end = NOW(), updated_at = NOW()
                WHERE email = %s
            ''', (email,))

        elif action in ['membership.canceled', 'membership_cancel_at_period_end_changed']:
            cancel_at = resource.get('canceled_at') or resource.get('current_period_end')
            if cancel_at:
                try:
                    from datetime import timezone as tz
                    cancel_dt = datetime.fromtimestamp(int(cancel_at), tz=tz.utc) if str(cancel_at).isdigit() else datetime.fromisoformat(str(cancel_at).replace('Z', '+00:00'))
                except Exception:
                    cancel_dt = None
            else:
                cancel_dt = None

            if cancel_dt:
                cur.execute('''
                    UPDATE subscriptions SET status = 'canceled', subscription_end = %s, updated_at = NOW()
                    WHERE email = %s
                ''', (cancel_dt, email))
            else:
                cur.execute('''
                    UPDATE subscriptions SET status = 'canceled', subscription_end = NOW() + interval '30 days', updated_at = NOW()
                    WHERE email = %s
                ''', (email,))

        conn.commit()
        cur.close()
        conn.close()

        return jsonify({'received': True, 'action': action}), 200

    except Exception as e:
        print(f'Whop webhook error: {e}')
        return jsonify({'error': 'Server error'}), 500


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

import time as _time

FREE_PROMPT_LIMIT = 5
GEMINI_FREE_KEYS = [
    'AIzaSyAgCoj-jLBBy2xzGhed_NWPuIloi26Broo',
    'AIzaSyAQhtFAP2ywJ-QSQ-gOsf5ehTJ0qCOdMF8',
    'AIzaSyCtVNsJKHKvK0EdDwDTqCaLdFWLz6yj41Q',
]
_free_key_index = 0
_rate_limit_cache = {}

@app.route('/api/ai/proxy', methods=['POST', 'OPTIONS'])
def ai_proxy():
    if request.method == 'OPTIONS':
        response = Response()
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return response

    if not GEMINI_FREE_KEYS:
        r = jsonify({'error': 'AI proxy not configured', 'remaining': 0})
        r.headers['Access-Control-Allow-Origin'] = '*'
        return r, 503

    data = request.get_json(silent=True)
    if not data:
        r = jsonify({'error': 'Invalid request'})
        r.headers['Access-Control-Allow-Origin'] = '*'
        return r, 400

    identifier = str(data.get('email') or data.get('deviceId') or '')[:200].strip().lower()
    if not identifier:
        r = jsonify({'error': 'Email or device ID required'})
        r.headers['Access-Control-Allow-Origin'] = '*'
        return r, 400

    now = _time.time()
    cache_key = identifier
    if cache_key in _rate_limit_cache:
        timestamps = [t for t in _rate_limit_cache[cache_key] if now - t < 60]
        if len(timestamps) >= 3:
            r = jsonify({'error': 'Rate limit exceeded. Wait a moment.', 'remaining': -1})
            r.headers['Access-Control-Allow-Origin'] = '*'
            return r, 429
        timestamps.append(now)
        _rate_limit_cache[cache_key] = timestamps
    else:
        _rate_limit_cache[cache_key] = [now]

    if not ensure_db():
        r = jsonify({'error': 'Database unavailable'})
        r.headers['Access-Control-Allow-Origin'] = '*'
        return r, 503

    conn = None
    cur = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('''
            INSERT INTO free_prompts (identifier, usage_count, last_used)
            VALUES (%s, 0, NOW())
            ON CONFLICT (identifier) DO NOTHING
        ''', (identifier,))
        conn.commit()

        cur.execute('SELECT usage_count, last_used FROM free_prompts WHERE identifier = %s', (identifier,))
        row = cur.fetchone()
        usage_count = row[0] if row else 0
        last_used = row[1] if row else None

        from datetime import datetime, timezone
        now_utc = datetime.now(timezone.utc)
        if last_used:
            if hasattr(last_used, 'date'):
                last_date = last_used.date()
            else:
                last_date = None
            if last_date and last_date < now_utc.date():
                cur.execute('UPDATE free_prompts SET usage_count = 0, last_used = NOW() WHERE identifier = %s', (identifier,))
                conn.commit()
                usage_count = 0

        if usage_count >= FREE_PROMPT_LIMIT:
            r = jsonify({'error': 'limit_reached', 'remaining': 0, 'limit': FREE_PROMPT_LIMIT})
            r.headers['Access-Control-Allow-Origin'] = '*'
            return r, 403

        prompt = str(data.get('prompt', ''))[:2000]
        image_data = str(data.get('imageData', ''))
        if len(image_data) > 5 * 1024 * 1024:
            r = jsonify({'error': 'Image too large'})
            r.headers['Access-Control-Allow-Origin'] = '*'
            return r, 400

        import requests as http_requests
        parts = [{'text': prompt}] if prompt else [{'text': 'Describe this image'}]
        if image_data:
            img_mime = 'image/png'
            if image_data.startswith('data:'):
                header_end = image_data.find(',')
                if header_end > 0:
                    header = image_data[:header_end]
                    if 'image/jpeg' in header:
                        img_mime = 'image/jpeg'
                    elif 'image/webp' in header:
                        img_mime = 'image/webp'
                    elif 'image/gif' in header:
                        img_mime = 'image/gif'
                    image_data = image_data[header_end + 1:]
            parts.append({'inline_data': {'mime_type': img_mime, 'data': image_data}})

        gemini_body = {
            'contents': [{'role': 'user', 'parts': parts}],
            'generationConfig': {'maxOutputTokens': 1024, 'temperature': 0.3}
        }

        global _free_key_index
        gemini_data = None
        last_error = 'All keys exhausted'
        for attempt in range(len(GEMINI_FREE_KEYS)):
            key_idx = (_free_key_index + attempt) % len(GEMINI_FREE_KEYS)
            try_key = GEMINI_FREE_KEYS[key_idx]
            try:
                gemini_resp = http_requests.post(
                    f'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={try_key}',
                    json=gemini_body,
                    timeout=30
                )
                resp_data = gemini_resp.json()
                if 'error' in resp_data:
                    err_msg = resp_data['error'].get('message', '').lower()
                    if 'quota' in err_msg or 'rate' in err_msg or 'resource' in err_msg or 'exhausted' in err_msg:
                        last_error = resp_data['error'].get('message', 'AI error')
                        continue
                    last_error = resp_data['error'].get('message', 'AI error')
                    gemini_data = resp_data
                    break
                gemini_data = resp_data
                _free_key_index = (key_idx + 1) % len(GEMINI_FREE_KEYS)
                break
            except Exception as ke:
                last_error = str(ke)
                continue

        if gemini_data is None or 'error' in gemini_data:
            err = gemini_data['error'].get('message', last_error) if gemini_data and 'error' in gemini_data else last_error
            r = jsonify({'error': err, 'remaining': FREE_PROMPT_LIMIT - usage_count})
            r.headers['Access-Control-Allow-Origin'] = '*'
            return r, 502

        cur.execute('''
            UPDATE free_prompts SET usage_count = usage_count + 1, last_used = NOW()
            WHERE identifier = %s
        ''', (identifier,))
        conn.commit()

        new_count = usage_count + 1
        remaining = FREE_PROMPT_LIMIT - new_count

        ai_text = ''
        if gemini_data.get('candidates') and gemini_data['candidates'][0].get('content', {}).get('parts'):
            ai_text = gemini_data['candidates'][0]['content']['parts'][0].get('text', '')

        r = jsonify({
            'response': ai_text,
            'remaining': remaining,
            'used': new_count,
            'limit': FREE_PROMPT_LIMIT
        })
        r.headers['Access-Control-Allow-Origin'] = '*'
        return r

    except Exception as e:
        print(f'❌ ai/proxy error: {e}')
        r = jsonify({'error': 'Proxy request failed'})
        r.headers['Access-Control-Allow-Origin'] = '*'
        return r, 500
    finally:
        if cur:
            try: cur.close()
            except: pass
        if conn:
            try: conn.close()
            except: pass


if __name__ == '__main__':
    print('✅ Landing page live at: 0.0.0.0:5000')
    print('🌍 54 languages available:')
    print('   /       → English (default)')
    print('   /ar     → Arabic')
    print('   /es     → Spanish')
    print('   /fr     → French')
    print('   ... and 50 more!')
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
