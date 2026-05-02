from flask import Flask, send_from_directory, request, redirect, Response, jsonify
import html as html_escape_module
import os
import re
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
        cur.execute('ALTER TABLE user_activity ADD COLUMN IF NOT EXISTS device_id TEXT')
        # Lightweight aggregate so we can show a single "total captures across
        # ALL users (signed-in + anonymous)" headline number on the dashboard
        # without scanning user_activity every time.
        cur.execute('''
            CREATE TABLE IF NOT EXISTS anon_capture_stats (
                device_id TEXT PRIMARY KEY,
                capture_count INTEGER DEFAULT 0,
                first_seen TIMESTAMP DEFAULT NOW(),
                last_seen TIMESTAMP DEFAULT NOW()
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

        # === INSTITUTIONS (white-label multi-tenant) ===
        cur.execute('''
            CREATE TABLE IF NOT EXISTS institutions (
                id SERIAL PRIMARY KEY,
                slug VARCHAR(60) UNIQUE NOT NULL,
                name TEXT NOT NULL,
                logo_url TEXT,
                brand_color VARCHAR(20) DEFAULT '#00d9ff',
                primary_admin_email TEXT,
                seat_limit INTEGER DEFAULT 50,
                expires_at TIMESTAMP,
                status VARCHAR(20) DEFAULT 'active',
                allowed_domains TEXT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        ''')
        cur.execute('''
            CREATE TABLE IF NOT EXISTS institution_members (
                id SERIAL PRIMARY KEY,
                institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
                email TEXT NOT NULL,
                role VARCHAR(20) DEFAULT 'member',
                status VARCHAR(20) DEFAULT 'active',
                invited_by TEXT,
                joined_at TIMESTAMP DEFAULT NOW(),
                last_seen TIMESTAMP,
                UNIQUE (institution_id, email)
            )
        ''')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_inst_members_email ON institution_members(LOWER(email))')
        cur.execute('''
            CREATE TABLE IF NOT EXISTS institution_invites (
                id SERIAL PRIMARY KEY,
                institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
                code VARCHAR(64) UNIQUE NOT NULL,
                email TEXT,
                max_uses INTEGER DEFAULT 0,
                uses INTEGER DEFAULT 0,
                expires_at TIMESTAMP,
                created_by TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        ''')
        cur.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS institution_id INTEGER')
        print('✅ institutions, institution_members, institution_invites tables ready')

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
    'joseph@smartconnects.com'
}

VIDEO_DAILY_LIMIT_FREE = 2
VIDEO_DAILY_LIMIT_PAID = 10
VIDEO_COOLDOWN_SECONDS = 300

# ============================================
# INSTITUTIONS (white-label multi-tenant) helpers
# ============================================

INSTITUTION_LOGO_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'institution-logos')
ALLOWED_LOGO_EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.svg'}
PUBLIC_DOMAINS = {'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
                  'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
                  'mail.com', 'gmx.com', 'yandex.com', 'msn.com', 'qq.com', '163.com'}

def _slugify(s):
    s = (s or '').strip().lower()
    out = []
    for ch in s:
        if ch.isalnum():
            out.append(ch)
        elif ch in ' -_':
            out.append('-')
    slug = ''.join(out).strip('-')
    while '--' in slug:
        slug = slug.replace('--', '-')
    return slug[:60] or ('inst-' + uuid.uuid4().hex[:8])

def _norm_email(s):
    return (s or '').strip().lower()[:200]

def _gen_invite_code():
    return uuid.uuid4().hex[:24]

def _gen_admin_token(slug, email):
    """Token an institution admin can use to access /institution/<slug>/admin."""
    payload = f"{slug}|{_norm_email(email)}|{ADMIN_SESSION_SECRET}"
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()

def _verify_admin_token(slug, email, token):
    if not (slug and email and token):
        return False
    return token == _gen_admin_token(slug, email)

def _institution_active(row):
    """row = (status, expires_at) — true iff active and not expired."""
    if not row:
        return False
    status = row[0]
    expires_at = row[1] if len(row) > 1 else None
    if status != 'active':
        return False
    if expires_at and expires_at < datetime.utcnow():
        return False
    return True

def _seats_used(cur, institution_id):
    cur.execute("SELECT COUNT(*) FROM institution_members WHERE institution_id=%s AND status='active'", (institution_id,))
    r = cur.fetchone()
    return int(r[0]) if r else 0

def _domain_of(email):
    e = _norm_email(email)
    if '@' not in e:
        return ''
    return e.split('@', 1)[1]

def _resolve_institution_for_email(cur, email):
    """Return (institution_id, branding_dict) if this email is/should-be an institution member.
    Order: explicit member row -> domain match -> None.
    Inserts a member row on first domain match. NEVER consumes a public-email domain.
    """
    email = _norm_email(email)
    if not email or '@' not in email:
        return None, None
    cur.execute("""
        SELECT m.institution_id, m.status, i.status, i.expires_at, i.slug, i.name, i.logo_url, i.brand_color, m.role
        FROM institution_members m JOIN institutions i ON i.id = m.institution_id
        WHERE LOWER(m.email) = %s LIMIT 1
    """, (email,))
    row = cur.fetchone()
    if row:
        if row[1] == 'active' and _institution_active((row[2], row[3])):
            return row[0], {
                'institutionId': row[0],
                'slug': row[4],
                'name': row[5],
                'logoUrl': row[6],
                'brandColor': row[7] or '#00d9ff',
                'role': row[8] or 'member'
            }
        return None, None

    domain = _domain_of(email)
    if not domain or domain in PUBLIC_DOMAINS:
        return None, None
    cur.execute("""
        SELECT id, slug, name, logo_url, brand_color, allowed_domains, status, expires_at, seat_limit
        FROM institutions WHERE allowed_domains IS NOT NULL AND allowed_domains <> ''
    """)
    for r in cur.fetchall():
        inst_id, slug, name, logo_url, brand_color, allowed, status, expires_at, seat_limit = r
        if not _institution_active((status, expires_at)):
            continue
        domains = [d.strip().lower() for d in (allowed or '').split(',') if d.strip()]
        if domain in domains:
            if seat_limit and _seats_used(cur, inst_id) >= seat_limit:
                continue
            cur.execute("""
                INSERT INTO institution_members (institution_id, email, role, status, invited_by, joined_at)
                VALUES (%s, %s, 'member', 'active', 'domain-auto', NOW())
                ON CONFLICT (institution_id, email) DO UPDATE SET status='active'
            """, (inst_id, email))
            return inst_id, {
                'institutionId': inst_id,
                'slug': slug,
                'name': name,
                'logoUrl': logo_url,
                'brandColor': brand_color or '#00d9ff',
                'role': 'member'
            }
    return None, None

def _apply_institution_membership(cur, email, institution_id):
    """Mark this user as an institution subscriber. Idempotent."""
    email = _norm_email(email)
    cur.execute("UPDATE users SET institution_id=%s WHERE LOWER(email)=%s", (institution_id, email))
    cur.execute("""
        INSERT INTO subscriptions (email, plan_type, status, subscription_start, last_verified, created_at, updated_at)
        VALUES (%s, 'institution', 'active', NOW(), NOW(), NOW(), NOW())
        ON CONFLICT (email) DO UPDATE SET
            plan_type = CASE WHEN subscriptions.plan_type IN ('monthly','yearly') AND subscriptions.status='active'
                              THEN subscriptions.plan_type ELSE 'institution' END,
            status = 'active',
            subscription_end = NULL,
            last_verified = NOW(),
            updated_at = NOW()
    """, (email,))

def _get_institution_branding_for_email(cur, email):
    """Return branding dict if this email is an active member of an active institution, else None."""
    email = _norm_email(email)
    if not email:
        return None
    cur.execute("""
        SELECT i.id, i.slug, i.name, i.logo_url, i.brand_color, i.status, i.expires_at, m.status, m.role
        FROM institution_members m JOIN institutions i ON i.id = m.institution_id
        WHERE LOWER(m.email) = %s LIMIT 1
    """, (email,))
    r = cur.fetchone()
    if not r:
        return None
    if r[7] != 'active':
        return None
    if not _institution_active((r[5], r[6])):
        return None
    return {
        'institutionId': r[0],
        'slug': r[1],
        'name': r[2],
        'logoUrl': r[3],
        'brandColor': r[4] or '#00d9ff',
        'role': r[8] or 'member'
    }

def _institution_by_slug(cur, slug):
    cur.execute("""
        SELECT id, slug, name, logo_url, brand_color, primary_admin_email, seat_limit,
               expires_at, status, allowed_domains, notes, created_at
        FROM institutions WHERE slug=%s
    """, (slug,))
    return cur.fetchone()

def _is_inst_admin(cur, slug, email):
    """True iff email is the primary admin OR a member with role='admin' for this slug."""
    email = _norm_email(email)
    if not email:
        return False
    cur.execute("SELECT id, primary_admin_email FROM institutions WHERE slug=%s", (slug,))
    r = cur.fetchone()
    if not r:
        return False
    if _norm_email(r[1]) == email:
        return True
    cur.execute("""
        SELECT 1 FROM institution_members
        WHERE institution_id=%s AND LOWER(email)=%s AND role='admin' AND status='active' LIMIT 1
    """, (r[0], email))
    return cur.fetchone() is not None

def _cors(resp, methods='GET, POST, OPTIONS'):
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Allow-Methods'] = methods
    resp.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    return resp

def _options(methods='GET, POST, OPTIONS'):
    return _cors(Response(), methods)

def verify_google_token(token):
    """Verify a Google OAuth token. Tries the id_token endpoint first (because
    Google Identity Services / gsi/client returns JWT id tokens), then falls
    back to access_token (used by chrome.identity.getAuthToken). When verifying
    an id_token, also enforce that the audience matches our GOOGLE_CLIENT_ID
    so that tokens minted for another app cannot be replayed against us."""
    if not token:
        return None
    # 1) Try id_token verification (gsi/client / web sign-in)
    try:
        resp = requests.get(
            'https://oauth2.googleapis.com/tokeninfo',
            params={'id_token': token},
            timeout=5
        )
        if resp.ok:
            data = resp.json()
            email = (data.get('email') or '').lower()
            if email and data.get('email_verified') in (True, 'true', '1', 1):
                aud = data.get('aud') or ''
                if not GOOGLE_CLIENT_ID or aud == GOOGLE_CLIENT_ID:
                    return email
    except Exception:
        pass
    # 2) Fall back to access_token verification (chrome.identity)
    try:
        resp = requests.get(
            'https://oauth2.googleapis.com/tokeninfo',
            params={'access_token': token},
            timeout=5
        )
        if resp.ok:
            data = resp.json()
            return (data.get('email') or '').lower() or None
    except Exception:
        pass
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
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
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
        invite_code = str(data.get('inviteCode', '') or '')[:64].strip()

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

        # Institutions: if an invite code was supplied, redeem it FIRST so the
        # subsequent resolve picks up the new member row.
        invite_result = None
        if invite_code:
            try:
                cur.execute("""
                    SELECT inv.id, inv.institution_id, inv.max_uses, inv.uses, i.status, i.expires_at, i.seat_limit
                    FROM institution_invites inv JOIN institutions i ON i.id = inv.institution_id
                    WHERE inv.code=%s
                """, (invite_code,))
                ir = cur.fetchone()
                if ir and _institution_active((ir[4], ir[5])):
                    inv_id, inst_id_inv, max_uses, uses, _s, _e, seat_limit = ir
                    if max_uses and uses >= max_uses:
                        invite_result = 'invite_exhausted'
                    elif seat_limit and _seats_used(cur, inst_id_inv) >= seat_limit:
                        invite_result = 'seat_limit'
                    else:
                        res = _add_member(cur, inst_id_inv, email, f'invite-code:{invite_code[:8]}')
                        if res == 'added':
                            cur.execute("UPDATE institution_invites SET uses=uses+1 WHERE id=%s", (inv_id,))
                        invite_result = res
                else:
                    invite_result = 'invalid_code'
            except Exception as inv_err:
                print(f'⚠️ invite-code redeem error: {inv_err}')
                invite_result = 'error'

        # Institutions: bind to inst on first sign-in if pre-invited or domain match
        branding = None
        try:
            inst_id, branding_resolved = _resolve_institution_for_email(cur, email)
            if inst_id:
                _apply_institution_membership(cur, email, inst_id)
                branding = branding_resolved
        except Exception as inst_err:
            print(f'⚠️ institution resolve error: {inst_err}')

        conn.commit()
        cur.close()
        conn.close()

        payload = {'success': True, 'userId': user_id}
        if branding:
            payload['branding'] = branding
        if invite_result is not None:
            payload['inviteResult'] = invite_result
        response = jsonify(payload)
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
        device_id = str(data.get('deviceId', ''))[:100].strip()
        action = str(data.get('action', ''))[:100]
        details = str(data.get('details', ''))[:500]

        valid_actions = ['capture_snap', 'capture_snip', 'capture_fullpage', 'ai_chat', 'review_prompt_shown', 'review_clicked']
        if not action:
            response = jsonify({'success': False, 'error': 'action is required'})
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response, 400
        # Allow anonymous logging: must have either a valid email OR a device id.
        has_valid_email = bool(email) and '@' in email
        if not has_valid_email and not device_id:
            response = jsonify({'success': False, 'error': 'Either email or deviceId is required'})
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response, 400

        if action not in valid_actions:
            response = jsonify({'success': False, 'error': 'Invalid action'})
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response, 400

        conn = get_db()
        cur = conn.cursor()
        # Email column can legitimately be empty for anonymous events.
        cur.execute('''
            INSERT INTO user_activity (email, action, details, device_id, created_at)
            VALUES (%s, %s, %s, %s, NOW())
        ''', (email if has_valid_email else None, action, details, device_id or None))

        if action in ('capture_snap', 'capture_snip', 'capture_fullpage'):
            if has_valid_email:
                # Signed-in: count against the user record only — never the
                # anonymous bucket — so the dashboard total isn't double-counted.
                cur.execute('''
                    UPDATE users SET capture_count = capture_count + 1, last_seen = NOW()
                    WHERE email = %s
                ''', (email,))
            elif device_id:
                # Truly anonymous: count against the device bucket.
                cur.execute('''
                    INSERT INTO anon_capture_stats (device_id, capture_count, first_seen, last_seen)
                    VALUES (%s, 1, NOW(), NOW())
                    ON CONFLICT (device_id) DO UPDATE
                    SET capture_count = anon_capture_stats.capture_count + 1,
                        last_seen = NOW()
                ''', (device_id,))

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
    """Enhanced admin panel - requires valid session cookie or ?password= param"""
    pw_param = request.args.get('password', '')
    if pw_param != ADMIN_PASSWORD and not verify_admin_session():
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

        # Total captures across ALL users — signed-in (users.capture_count)
        # plus anonymous (anon_capture_stats.capture_count). This is the
        # headline metric that confirms the extension is reporting activity.
        cur.execute('SELECT COALESCE(SUM(capture_count),0) FROM users')
        total_signed_in_captures = cur.fetchone()[0] or 0
        cur.execute('SELECT COALESCE(SUM(capture_count),0), COUNT(*) FROM anon_capture_stats')
        anon_row = cur.fetchone()
        total_anon_captures = anon_row[0] or 0
        anon_devices = anon_row[1] or 0
        total_captures_all = total_signed_in_captures + total_anon_captures
        # Captures recorded in the last 24h (from the activity log) — useful
        # to confirm tracking is alive RIGHT NOW.
        cur.execute('''
            SELECT COUNT(*) FROM user_activity
            WHERE action IN ('capture_snap','capture_snip','capture_fullpage')
              AND created_at > NOW() - INTERVAL '24 hours'
        ''')
        captures_last_24h = cur.fetchone()[0] or 0
        
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
            
            if trial_start is None:
                days_elapsed = 999
                days_remaining = 0
            else:
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
            <div class="stat-number" style="color: #ffa500;">{total_captures_all}</div>
            <div class="stat-label">📸 Total Captures<br><span style="font-size:10px;color:#666;">{total_signed_in_captures} signed-in · {total_anon_captures} anonymous</span></div>
        </div>
        <div class="stat-box">
            <div class="stat-number" style="color: #00ff88;">{captures_last_24h}</div>
            <div class="stat-label">⚡ Captures (24h)<br><span style="font-size:10px;color:#666;">{anon_devices} anon devices total</span></div>
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
        <input type="hidden" name="password" value="{ADMIN_PASSWORD}">
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

    <div id="institutions-section" style="background: linear-gradient(135deg, rgba(168, 85, 247, 0.15), rgba(124, 58, 237, 0.08)); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 12px; padding: 20px; margin: 30px 0;">
        <h2 style="color: #a855f7; margin: 0 0 5px 0;">🏛️ Institutions (White-Label Licenses)</h2>
        <p style="color: #888; font-size: 12px; margin: 0 0 15px 0;">Sell branded multi-seat licenses to companies & schools. Members get full pro access automatically.</p>

        <div style="background: rgba(0,0,0,0.25); border-radius: 10px; padding: 15px; margin-bottom: 20px;">
            <h3 style="color: #c084fc; margin: 0 0 10px 0; font-size: 14px;">+ Create new institution</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                <input id="inst-name" placeholder="Display name (e.g. Acme Corp)" style="background: #0f0f1a; border: 1px solid #333; color: #fff; padding: 8px 12px; border-radius: 6px;">
                <input id="inst-slug" placeholder="Slug (e.g. acme)" style="background: #0f0f1a; border: 1px solid #333; color: #fff; padding: 8px 12px; border-radius: 6px;">
                <input id="inst-admin" placeholder="Primary admin email" style="background: #0f0f1a; border: 1px solid #333; color: #fff; padding: 8px 12px; border-radius: 6px;">
                <input id="inst-seats" type="number" value="50" placeholder="Seat limit" style="background: #0f0f1a; border: 1px solid #333; color: #fff; padding: 8px 12px; border-radius: 6px;">
                <input id="inst-color" type="color" value="#00d9ff" style="background: #0f0f1a; border: 1px solid #333; padding: 4px; border-radius: 6px; height: 36px;">
                <input id="inst-expires" type="date" style="background: #0f0f1a; border: 1px solid #333; color: #fff; padding: 8px 12px; border-radius: 6px;">
                <input id="inst-domains" placeholder="Allowed domains (comma-sep, e.g. acme.com)" style="background: #0f0f1a; border: 1px solid #333; color: #fff; padding: 8px 12px; border-radius: 6px; grid-column: span 2;">
                <button onclick="createInstitution()" style="background: linear-gradient(135deg, #a855f7, #7c3aed); color: #fff; border: none; padding: 8px 20px; border-radius: 6px; cursor: pointer; font-weight: bold;">Create Institution</button>
            </div>
            <div id="inst-create-msg" style="color: #00ff88; font-size: 12px; margin-top: 8px;"></div>
        </div>

        <div id="inst-list">Loading institutions...</div>
    </div>

    <script>
    const ADMIN_PW = ''' + json.dumps(password) + ''';
    async function loadInstitutions() {
      try {
        const r = await fetch('/api/admin/institutions/list?password=' + encodeURIComponent(ADMIN_PW));
        const d = await r.json();
        if (!d.success) { document.getElementById('inst-list').innerHTML = '<div style="color:#ff4757;">Error: ' + (d.error || 'unknown') + '</div>'; return; }
        if (d.institutions.length === 0) { document.getElementById('inst-list').innerHTML = '<div style="color:#888; padding: 20px; text-align: center;">No institutions yet. Create your first one above ↑</div>'; return; }
        let html = '<table style="width: 100%; border-collapse: collapse; font-size: 13px;"><tr>' +
          '<th style="background: #16213e; color: #c084fc; padding: 10px 8px; text-align: left;">Logo</th>' +
          '<th style="background: #16213e; color: #c084fc; padding: 10px 8px; text-align: left;">Name / Slug</th>' +
          '<th style="background: #16213e; color: #c084fc; padding: 10px 8px; text-align: left;">Primary Admin</th>' +
          '<th style="background: #16213e; color: #c084fc; padding: 10px 8px; text-align: left;">Seats</th>' +
          '<th style="background: #16213e; color: #c084fc; padding: 10px 8px; text-align: left;">Status</th>' +
          '<th style="background: #16213e; color: #c084fc; padding: 10px 8px; text-align: left;">Expires</th>' +
          '<th style="background: #16213e; color: #c084fc; padding: 10px 8px; text-align: left;">Actions</th></tr>';
        for (const inst of d.institutions) {
          const logoHtml = inst.logoUrl ? '<img src="' + inst.logoUrl + '" style="height: 32px; max-width: 80px; object-fit: contain; background: #fff; border-radius: 4px; padding: 2px;">' : '<span style="color:#666;">(none)</span>';
          html += '<tr style="border-bottom: 1px solid #222;">' +
            '<td style="padding: 8px;">' + logoHtml + '</td>' +
            '<td style="padding: 8px;"><strong style="color:' + (inst.brandColor || '#a855f7') + ';">' + inst.name + '</strong><br><span style="color:#888; font-size: 11px;">' + inst.slug + '</span></td>' +
            '<td style="padding: 8px; color:#ccc; font-size: 12px;">' + (inst.primaryAdminEmail || '<span style="color:#666;">—</span>') + '</td>' +
            '<td style="padding: 8px;">' + inst.seatsUsed + ' / ' + inst.seatLimit + '</td>' +
            '<td style="padding: 8px;"><span style="padding: 3px 8px; border-radius: 4px; font-size: 11px; background: ' + (inst.status === 'active' ? '#00ff8820' : '#ff475720') + '; color: ' + (inst.status === 'active' ? '#00ff88' : '#ff4757') + ';">' + inst.status + '</span></td>' +
            '<td style="padding: 8px; color:#ccc; font-size: 12px;">' + (inst.expiresAt ? new Date(inst.expiresAt).toLocaleDateString() : 'never') + '</td>' +
            '<td style="padding: 8px;">' +
              '<button onclick="copyAdminLink(\\'' + inst.slug + '\\')" style="background: #06b6d4; color: #000; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; margin-right: 4px;" title="Copy admin URL with token">📋 Admin URL</button>' +
              '<a href="/institution/' + inst.slug + '/admin?token=' + (inst.adminToken || '') + '" target="_blank" style="background: #a855f7; color: #fff; padding: 5px 10px; border-radius: 4px; text-decoration: none; font-size: 11px; margin-right: 4px;">Open</a>' +
              '<label style="background: #333; color: #fff; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; margin-right: 4px;">📤 Logo<input type="file" accept="image/*" style="display:none;" onchange="uploadLogo(' + inst.id + ', this)"></label>' +
              '<button onclick="toggleStatus(' + inst.id + ', \\'' + (inst.status === 'active' ? 'suspended' : 'active') + '\\')" style="background: #f97316; color: #fff; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; margin-right: 4px;">' + (inst.status === 'active' ? '⏸ Suspend' : '▶ Activate') + '</button>' +
              '<button onclick="deleteInstitution(' + inst.id + ', \\'' + inst.name.replace(/\\'/g, "\\\\'") + '\\')" style="background: #ff4757; color: #fff; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;">🗑</button>' +
            '</td></tr>';
        }
        html += '</table>';
        document.getElementById('inst-list').innerHTML = html;
      } catch (e) {
        document.getElementById('inst-list').innerHTML = '<div style="color:#ff4757;">Failed to load: ' + e.message + '</div>';
      }
    }
    async function createInstitution() {
      const body = {
        name: document.getElementById('inst-name').value,
        slug: document.getElementById('inst-slug').value,
        primaryAdminEmail: document.getElementById('inst-admin').value,
        seatLimit: parseInt(document.getElementById('inst-seats').value, 10) || 50,
        brandColor: document.getElementById('inst-color').value,
        expiresAt: document.getElementById('inst-expires').value || null,
        allowedDomains: document.getElementById('inst-domains').value
      };
      if (!body.name) { alert('Name is required'); return; }
      const r = await fetch('/api/admin/institutions/create?password=' + encodeURIComponent(ADMIN_PW), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const d = await r.json();
      const msg = document.getElementById('inst-create-msg');
      if (d.success) {
        msg.style.color = '#00ff88';
        msg.textContent = '✓ Created "' + d.institution.name + '" (slug: ' + d.institution.slug + '). Loading...';
        document.getElementById('inst-name').value = '';
        document.getElementById('inst-slug').value = '';
        document.getElementById('inst-admin').value = '';
        document.getElementById('inst-domains').value = '';
        loadInstitutions();
      } else {
        msg.style.color = '#ff4757';
        msg.textContent = '✗ ' + (d.error || 'Failed');
      }
    }
    async function uploadLogo(instId, fileInput) {
      const file = fileInput.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('logo', file);
      const r = await fetch('/api/admin/institutions/' + instId + '/logo?password=' + encodeURIComponent(ADMIN_PW), { method: 'POST', body: fd });
      const d = await r.json();
      if (d.success) { alert('Logo uploaded'); loadInstitutions(); } else { alert('Upload failed: ' + (d.error || 'unknown')); }
    }
    async function toggleStatus(instId, newStatus) {
      const r = await fetch('/api/admin/institutions/' + instId + '/update?password=' + encodeURIComponent(ADMIN_PW), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus })
      });
      const d = await r.json();
      if (d.success) loadInstitutions(); else alert('Failed: ' + (d.error || 'unknown'));
    }
    async function deleteInstitution(instId, name) {
      if (!confirm('Delete institution "' + name + '"? This will revoke access for all members and CANNOT be undone.')) return;
      const r = await fetch('/api/admin/institutions/' + instId + '?password=' + encodeURIComponent(ADMIN_PW), { method: 'DELETE' });
      const d = await r.json();
      if (d.success) loadInstitutions(); else alert('Failed: ' + (d.error || 'unknown'));
    }
    function copyAdminLink(slug) {
      // Find the institution row to grab its token from the Open button href
      const link = document.querySelector('a[href*="/institution/' + slug + '/admin"]');
      if (!link) { alert('Token not found'); return; }
      const url = window.location.origin + link.getAttribute('href');
      navigator.clipboard.writeText(url).then(() => alert('Admin URL copied to clipboard:\\n\\n' + url + '\\n\\nGive this to the institution admin.'));
    }
    loadInstitutions();
    </script>
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


@app.route('/api/branding', methods=['POST', 'GET', 'OPTIONS'])
def api_branding():
    """Dedicated branding fetch — returns the institution branding dict for an email,
    or {branding: null} if none. Lightweight; safe to poll from the extension UI."""
    if request.method == 'OPTIONS':
        return _options('GET, POST, OPTIONS')
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    email = ''
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        email = _norm_email(data.get('email', ''))
    else:
        email = _norm_email(request.args.get('email', ''))
    if not email or '@' not in email:
        return _cors(jsonify({'success': False, 'error': 'Valid email required'})), 400
    try:
        conn = get_db(); cur = conn.cursor()
        b = _get_institution_branding_for_email(cur, email)
        cur.close(); conn.close()
        return _cors(jsonify({'success': True, 'branding': b}))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500

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

        # Owner override — these emails always get full pro access, no DB/Whop check needed
        if email in OWNER_EMAILS_SET:
            result = {'success': True, 'canUseAI': True, 'status': 'subscribed', 'planType': 'owner', 'daysRemaining': None}
            response = jsonify(result)
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response

        conn = get_db()
        cur = conn.cursor()
        now_ms = int(datetime.utcnow().timestamp() * 1000)

        # Institutions: full pro access for active members of an active institution
        inst_branding = None
        try:
            inst_branding = _get_institution_branding_for_email(cur, email)
            if not inst_branding:
                # First-time visitor: maybe their domain matches an institution
                inst_id_new, branding_new = _resolve_institution_for_email(cur, email)
                if inst_id_new:
                    _apply_institution_membership(cur, email, inst_id_new)
                    conn.commit()
                    inst_branding = branding_new
            if inst_branding:
                cur.execute("UPDATE institution_members SET last_seen=NOW() WHERE LOWER(email)=%s", (email,))
                conn.commit()
                cur.close()
                conn.close()
                result = {
                    'success': True,
                    'canUseAI': True,
                    'status': 'subscribed',
                    'planType': 'institution',
                    'daysRemaining': None,
                    'branding': inst_branding
                }
                response = jsonify(result)
                response.headers['Access-Control-Allow-Origin'] = '*'
                return response
        except Exception as inst_err:
            print(f'⚠️ institution status check error: {inst_err}')

        # Defensive demotion: if a stale row says plan_type='institution', status='active'
        # but the institution check above did NOT yield a branding (institution is now
        # suspended, expired, or member was removed), we MUST NOT report subscribed.
        # Clear the stale row so Whop / trial / paywall can take over correctly.
        cur.execute('SELECT plan_type, status FROM subscriptions WHERE email = %s', (email,))
        pre = cur.fetchone()
        if pre and pre[0] == 'institution' and pre[1] == 'active' and not inst_branding:
            # Capture the (now-stale) institution branding BEFORE we null the FK,
            # so the extension can show "{InstitutionName} license ended".
            former_branding = None
            try:
                cur.execute("""
                    SELECT i.name, i.brand_color, i.logo_url, i.slug
                    FROM users u JOIN institutions i ON i.id = u.institution_id
                    WHERE LOWER(u.email)=%s
                """, (email,))
                fb = cur.fetchone()
                if fb:
                    former_branding = {
                        'name': fb[0],
                        'brandColor': fb[1] or '#00d9ff',
                        'logoUrl': fb[2],
                        'slug': fb[3],
                    }
            except Exception:
                former_branding = None
            cur.execute("""
                UPDATE subscriptions
                SET status='expired', plan_type='institution_expired', updated_at=NOW()
                WHERE email=%s AND plan_type='institution' AND status='active'
            """, (email,))
            cur.execute("UPDATE users SET institution_id=NULL WHERE LOWER(email)=%s", (email,))
            conn.commit()
            cur.close(); conn.close()
            result = {
                'success': True, 'canUseAI': False, 'status': 'institution_expired',
                'planType': None, 'daysRemaining': 0,
                'institutionName': (former_branding or {}).get('name'),
                'branding': former_branding,
            }
            response = jsonify(result)
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response

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

@app.route('/static/<path:filename>')
def static_files(filename):
    """Serve files from the static/ directory (videos, images, etc.)."""
    static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')
    file_path = os.path.join(static_dir, filename)
    if not os.path.exists(file_path) or not os.path.isfile(file_path):
        return Response("Not found", status=404)
    resp = send_from_directory(static_dir, filename, conditional=True)
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Cache-Control'] = 'public, max-age=86400'
    return resp

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
GEMINI_OWNER_KEY = os.environ.get('GEMINI_OWNER_KEY', '')
_rate_limit_cache = {}

import hashlib as _hashlib
_OWNER_KEY_FINGERPRINT = _hashlib.sha256(GEMINI_OWNER_KEY.encode('utf-8')).hexdigest() if GEMINI_OWNER_KEY else ''

@app.route('/api/owner-key-fingerprint', methods=['GET', 'OPTIONS'])
def owner_key_fingerprint():
    if request.method == 'OPTIONS':
        r = Response()
        r.headers['Access-Control-Allow-Origin'] = '*'
        r.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
        return r
    r = jsonify({'fingerprints': [_OWNER_KEY_FINGERPRINT] if _OWNER_KEY_FINGERPRINT else []})
    r.headers['Access-Control-Allow-Origin'] = '*'
    r.headers['Cache-Control'] = 'public, max-age=3600'
    return r

@app.route('/api/ai/proxy', methods=['POST', 'OPTIONS'])
def ai_proxy():
    if request.method == 'OPTIONS':
        response = Response()
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return response

    if not GEMINI_OWNER_KEY:
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
        from datetime import datetime, timezone
        now_utc = datetime.now(timezone.utc)
        today_str = now_utc.strftime('%Y-%m-%d')

        cur.execute('''
            INSERT INTO free_prompts (identifier, usage_count, last_used)
            VALUES (%s, 0, NOW())
            ON CONFLICT (identifier) DO UPDATE SET
                usage_count = CASE WHEN free_prompts.last_used::date < %s::date THEN 0 ELSE free_prompts.usage_count END,
                last_used = CASE WHEN free_prompts.last_used::date < %s::date THEN NOW() ELSE free_prompts.last_used END
            RETURNING usage_count
        ''', (identifier, today_str, today_str))
        row = cur.fetchone()
        conn.commit()
        usage_count = row[0] if row else 0

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
            'systemInstruction': {'parts': [{'text': 'You are a helpful assistant. Always respond in natural human language. NEVER output raw JSON, bounding boxes, coordinates, box_2d data, or machine-readable detection formats. Always respond in plain, readable text.'}]},
            'generationConfig': {'maxOutputTokens': 1024, 'temperature': 0.3}
        }

        gemini_resp = http_requests.post(
            f'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_OWNER_KEY}',
            json=gemini_body,
            timeout=30
        )
        gemini_data = gemini_resp.json()

        if 'error' in gemini_data:
            err = gemini_data['error'].get('message', 'AI error')
            err_lower = err.lower()
            if 'quota' in err_lower or 'exhausted' in err_lower or 'rate' in err_lower:
                r = jsonify({'error': 'busy', 'message': 'Our free AI is busy right now. Please try again in a minute!', 'remaining': FREE_PROMPT_LIMIT - usage_count})
            else:
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


# ============================================
# INSTITUTIONS — super-admin CRUD endpoints
# ============================================

def _institution_to_dict(cur, row):
    """row from _institution_by_slug or list query (id, slug, name, logo_url, brand_color,
       primary_admin_email, seat_limit, expires_at, status, allowed_domains, notes, created_at)."""
    inst_id = row[0]
    slug = row[1]
    seats_used = _seats_used(cur, inst_id)
    admin_token = _gen_admin_token(slug, row[5] or '') if row[5] else ''
    return {
        'id': inst_id,
        'slug': slug,
        'name': row[2],
        'logoUrl': row[3],
        'brandColor': row[4],
        'primaryAdminEmail': row[5],
        'seatLimit': row[6],
        'seatsUsed': seats_used,
        'expiresAt': row[7].isoformat() if row[7] else None,
        'status': row[8],
        'allowedDomains': row[9],
        'notes': row[10],
        'createdAt': row[11].isoformat() if row[11] else None,
        'adminToken': admin_token
    }

def _require_super_admin():
    pw = request.args.get('password', '')
    return pw == ADMIN_PASSWORD or verify_admin_session()

@app.route('/api/admin/institutions/create', methods=['POST', 'OPTIONS'])
def api_admin_inst_create():
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    if not _require_super_admin():
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    data = request.get_json(silent=True) or {}
    name = str(data.get('name', '')).strip()[:200]
    if not name:
        return _cors(jsonify({'success': False, 'error': 'Name is required'})), 400
    slug = _slugify(data.get('slug') or name)
    primary_admin_email = _norm_email(data.get('primaryAdminEmail', ''))
    seat_limit = int(data.get('seatLimit') or 50)
    brand_color = str(data.get('brandColor') or '#00d9ff')[:20]
    if not re.match(r'^#[0-9a-fA-F]{3,8}$', brand_color):
        return _cors(jsonify({'success': False, 'error': 'brandColor must be a hex color like #00d9ff'})), 400
    allowed_domains = str(data.get('allowedDomains') or '')[:500]
    notes = str(data.get('notes') or '')[:1000]
    expires_at = None
    raw_exp = (data.get('expiresAt') or '').strip()
    if raw_exp:
        try:
            expires_at = datetime.strptime(raw_exp[:10], '%Y-%m-%d')
        except Exception:
            expires_at = None
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("SELECT 1 FROM institutions WHERE slug=%s", (slug,))
        if cur.fetchone():
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': f'Slug "{slug}" already exists'})), 400
        cur.execute("""
            INSERT INTO institutions (slug, name, brand_color, primary_admin_email, seat_limit,
                                      expires_at, status, allowed_domains, notes, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,'active',%s,%s,NOW(),NOW())
            RETURNING id
        """, (slug, name, brand_color, primary_admin_email or None, seat_limit,
              expires_at, allowed_domains or None, notes or None))
        inst_id = cur.fetchone()[0]
        # Pre-add the primary admin as a member with role='admin' so paywall bypass works
        if primary_admin_email:
            cur.execute("""
                INSERT INTO institution_members (institution_id, email, role, status, invited_by, joined_at)
                VALUES (%s,%s,'admin','active','super-admin',NOW())
                ON CONFLICT (institution_id, email) DO UPDATE SET role='admin', status='active'
            """, (inst_id, primary_admin_email))
        conn.commit()
        row = _institution_by_slug(cur, slug)
        result = _institution_to_dict(cur, row)
        cur.close(); conn.close()
        return _cors(jsonify({'success': True, 'institution': result}))
    except Exception as e:
        print(f'❌ inst create: {e}')
        return _cors(jsonify({'success': False, 'error': str(e)})), 500

@app.route('/api/admin/institutions/list', methods=['GET', 'OPTIONS'])
def api_admin_inst_list():
    if request.method == 'OPTIONS':
        return _options('GET, OPTIONS')
    if not _require_super_admin():
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("""
            SELECT id, slug, name, logo_url, brand_color, primary_admin_email, seat_limit,
                   expires_at, status, allowed_domains, notes, created_at
            FROM institutions ORDER BY created_at DESC
        """)
        rows = cur.fetchall()
        institutions = [_institution_to_dict(cur, r) for r in rows]
        cur.close(); conn.close()
        return _cors(jsonify({'success': True, 'institutions': institutions, 'total': len(institutions)}))
    except Exception as e:
        print(f'❌ inst list: {e}')
        return _cors(jsonify({'success': False, 'error': str(e)})), 500

@app.route('/api/admin/institutions/<int:inst_id>/update', methods=['POST', 'OPTIONS'])
def api_admin_inst_update(inst_id):
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    if not _require_super_admin():
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    data = request.get_json(silent=True) or {}
    fields = []
    values = []
    if 'name' in data:
        fields.append('name=%s'); values.append(str(data['name']).strip()[:200])
    if 'brandColor' in data:
        bc = str(data['brandColor'])[:20]
        if not re.match(r'^#[0-9a-fA-F]{3,8}$', bc):
            return _cors(jsonify({'success': False, 'error': 'brandColor must be a hex color like #00d9ff'})), 400
        fields.append('brand_color=%s'); values.append(bc)
    if 'primaryAdminEmail' in data:
        fields.append('primary_admin_email=%s'); values.append(_norm_email(data['primaryAdminEmail']) or None)
    if 'seatLimit' in data:
        fields.append('seat_limit=%s'); values.append(int(data['seatLimit'] or 50))
    if 'allowedDomains' in data:
        fields.append('allowed_domains=%s'); values.append(str(data['allowedDomains'] or '')[:500] or None)
    if 'notes' in data:
        fields.append('notes=%s'); values.append(str(data['notes'] or '')[:1000] or None)
    if 'status' in data and data['status'] in ('active', 'suspended', 'expired'):
        fields.append('status=%s'); values.append(data['status'])
    if 'expiresAt' in data:
        v = (data.get('expiresAt') or '').strip()
        try:
            fields.append('expires_at=%s'); values.append(datetime.strptime(v[:10], '%Y-%m-%d') if v else None)
        except Exception:
            fields.append('expires_at=%s'); values.append(None)
    if not fields:
        return _cors(jsonify({'success': False, 'error': 'Nothing to update'})), 400
    fields.append('updated_at=NOW()')
    try:
        conn = get_db(); cur = conn.cursor()
        values.append(inst_id)
        cur.execute(f"UPDATE institutions SET {', '.join(fields)} WHERE id=%s", values)
        # If we just changed primary admin, ensure they're an admin member
        if 'primaryAdminEmail' in data:
            new_email = _norm_email(data['primaryAdminEmail'])
            if new_email:
                cur.execute("""
                    INSERT INTO institution_members (institution_id, email, role, status, invited_by, joined_at)
                    VALUES (%s,%s,'admin','active','super-admin',NOW())
                    ON CONFLICT (institution_id, email) DO UPDATE SET role='admin', status='active'
                """, (inst_id, new_email))
        # If suspended, also revoke all member subscriptions
        if data.get('status') == 'suspended':
            cur.execute("""
                UPDATE subscriptions SET status='inactive', updated_at=NOW()
                WHERE plan_type='institution' AND LOWER(email) IN (
                    SELECT LOWER(email) FROM institution_members WHERE institution_id=%s
                )
            """, (inst_id,))
        conn.commit()
        cur.close(); conn.close()
        return _cors(jsonify({'success': True}))
    except Exception as e:
        print(f'❌ inst update: {e}')
        return _cors(jsonify({'success': False, 'error': str(e)})), 500

@app.route('/api/admin/institutions/<int:inst_id>', methods=['DELETE', 'OPTIONS'])
def api_admin_inst_delete(inst_id):
    if request.method == 'OPTIONS':
        return _options('DELETE, OPTIONS')
    if not _require_super_admin():
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    try:
        conn = get_db(); cur = conn.cursor()
        # Revoke any institution-plan subs for members
        cur.execute("""
            UPDATE subscriptions SET status='inactive', plan_type='unknown', updated_at=NOW()
            WHERE plan_type='institution' AND LOWER(email) IN (
                SELECT LOWER(email) FROM institution_members WHERE institution_id=%s
            )
        """, (inst_id,))
        cur.execute("UPDATE users SET institution_id=NULL WHERE institution_id=%s", (inst_id,))
        cur.execute("DELETE FROM institutions WHERE id=%s", (inst_id,))  # CASCADE drops members + invites
        conn.commit()
        cur.close(); conn.close()
        return _cors(jsonify({'success': True}))
    except Exception as e:
        print(f'❌ inst delete: {e}')
        return _cors(jsonify({'success': False, 'error': str(e)})), 500

@app.route('/api/admin/institutions/<int:inst_id>/logo', methods=['POST', 'OPTIONS'])
def api_admin_inst_logo(inst_id):
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    if not _require_super_admin():
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    f = request.files.get('logo')
    if not f or not f.filename:
        return _cors(jsonify({'success': False, 'error': 'No file uploaded (field name: logo)'})), 400
    ext = ''
    if '.' in f.filename:
        ext = '.' + f.filename.rsplit('.', 1)[1].lower()
    if ext not in ALLOWED_LOGO_EXTS:
        return _cors(jsonify({'success': False, 'error': f'Unsupported extension {ext}. Allowed: {sorted(ALLOWED_LOGO_EXTS)}'})), 400
    # Server-side size cap (2 MB) — read into memory once, validate, then write
    blob = f.read(2 * 1024 * 1024 + 1)
    if not blob:
        return _cors(jsonify({'success': False, 'error': 'Empty file'})), 400
    if len(blob) > 2 * 1024 * 1024:
        return _cors(jsonify({'success': False, 'error': 'Logo too large (max 2 MB)'})), 400
    # Magic-byte sniff: must match the claimed extension family
    head = blob[:12]
    is_png = head.startswith(b'\x89PNG\r\n\x1a\n')
    is_jpg = head.startswith(b'\xff\xd8\xff')
    is_gif = head.startswith(b'GIF87a') or head.startswith(b'GIF89a')
    is_webp = head[:4] == b'RIFF' and head[8:12] == b'WEBP'
    is_svg = b'<svg' in blob[:512].lower() or blob.lstrip()[:5].lower().startswith(b'<?xml')
    valid_for_ext = (
        (ext == '.png' and is_png) or
        (ext in ('.jpg', '.jpeg') and is_jpg) or
        (ext == '.gif' and is_gif) or
        (ext == '.webp' and is_webp) or
        (ext == '.svg' and is_svg)
    )
    if not valid_for_ext:
        return _cors(jsonify({'success': False, 'error': f'File contents do not match extension {ext}'})), 400
    try:
        os.makedirs(INSTITUTION_LOGO_DIR, exist_ok=True)
        conn = get_db(); cur = conn.cursor()
        cur.execute("SELECT slug FROM institutions WHERE id=%s", (inst_id,))
        r = cur.fetchone()
        if not r:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Institution not found'})), 404
        slug = r[0]
        # Remove old logos for this slug
        for old in os.listdir(INSTITUTION_LOGO_DIR):
            if old.startswith(slug + '.'):
                try: os.remove(os.path.join(INSTITUTION_LOGO_DIR, old))
                except Exception: pass
        target = os.path.join(INSTITUTION_LOGO_DIR, slug + ext)
        with open(target, 'wb') as out:
            out.write(blob)
        # cache-bust the URL so updates propagate immediately to extensions
        logo_url = f'/static/institution-logos/{slug}{ext}?v={int(time.time())}'
        cur.execute("UPDATE institutions SET logo_url=%s, updated_at=NOW() WHERE id=%s", (logo_url, inst_id))
        conn.commit()
        cur.close(); conn.close()
        return _cors(jsonify({'success': True, 'logoUrl': logo_url}))
    except Exception as e:
        print(f'❌ inst logo: {e}')
        return _cors(jsonify({'success': False, 'error': str(e)})), 500


# ============================================
# INSTITUTIONS — institution-admin dashboard + APIs
# ============================================

INST_ADMIN_COOKIE_PREFIX = 'inst_admin_session_'

def _verify_inst_admin(slug):
    """True iff caller is super-admin OR holds a valid inst-admin SESSION COOKIE
    for this slug. The cookie is only ever issued by the Google sign-in flow
    (POST /api/institution/<slug>/admin-login), so URL tokens / bare emails
    can no longer authorize the dashboard. This guarantees that the inst-admin
    has proven possession of the Google account (including any 2FA) before they
    can manage members, branding, or invites."""
    if _require_super_admin():
        return True, None
    cookie = request.cookies.get(INST_ADMIN_COOKIE_PREFIX + slug, '')
    if cookie and '|' in cookie:
        e, t = cookie.split('|', 1)
        if _verify_admin_token(slug, e, t):
            try:
                conn = get_db(); cur = conn.cursor()
                is_admin = _is_inst_admin(cur, slug, e)
                cur.close(); conn.close()
                if is_admin:
                    return True, _norm_email(e)
            except Exception:
                pass
    return False, None

@app.route('/api/institution/<slug>/admin-login', methods=['POST', 'OPTIONS'])
def api_inst_admin_google_login(slug):
    """Verify a Google ID token and, if the email is an admin of this institution,
    set the inst-admin session cookie. This is the PRIMARY auth path for the
    institution-admin dashboard — the URL token remains as a one-time bootstrap."""
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    data = request.get_json(silent=True) or {}
    id_token = (data.get('idToken') or data.get('credential') or '').strip()
    if not id_token:
        return _cors(jsonify({'success': False, 'error': 'idToken required'})), 400
    email = verify_google_token(id_token)
    if not email:
        return _cors(jsonify({'success': False, 'error': 'Invalid Google token'})), 401
    email = _norm_email(email)
    try:
        conn = get_db(); cur = conn.cursor()
        is_admin = _is_inst_admin(cur, slug, email)
        cur.close(); conn.close()
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500
    if not is_admin:
        return _cors(jsonify({'success': False, 'error': 'You are not an admin of this institution'})), 403
    resp = _cors(jsonify({'success': True, 'email': email}))
    cookie_value = f"{email}|{_gen_admin_token(slug, email)}"
    resp.set_cookie(INST_ADMIN_COOKIE_PREFIX + slug, cookie_value, httponly=True, samesite='Lax', max_age=86400 * 30)
    return resp


@app.route('/institution/<slug>/admin', methods=['GET'])
def institution_admin_page(slug):
    if not ensure_db():
        return Response("Database not available", status=503)
    ok, admin_email = _verify_inst_admin(slug)
    if not ok:
        # Render a Google Sign-In gate so the admin can authenticate with their Google identity
        try:
            conn = get_db(); cur = conn.cursor()
            row = _institution_by_slug(cur, slug)
            cur.close(); conn.close()
        except Exception:
            row = None
        if not row:
            return Response("Institution not found", status=404)
        inst_name = html_escape_module.escape(row[2])
        # CSS-context: only allow validated hex colors. html-escape is NOT enough.
        _raw = row[4] or '#00d9ff'
        inst_color = _raw if re.match(r'^#[0-9a-fA-F]{3,8}$', str(_raw)) else '#00d9ff'
        client_id = html_escape_module.escape(GOOGLE_CLIENT_ID or '')
        slug_safe = html_escape_module.escape(slug)
        gate = f'''<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>{inst_name} — Admin Sign-In</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://accounts.google.com/gsi/client" async defer></script>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f1a; color: #fff; min-height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center; padding: 24px; }}
  .card {{ max-width: 440px; background: rgba(255,255,255,0.04); border: 1px solid {inst_color}55; border-radius: 18px; padding: 36px; text-align: center; }}
  h1 {{ color: {inst_color}; margin: 0 0 8px 0; font-size: 22px; }}
  p {{ color: #ccc; line-height: 1.5; font-size: 14px; }}
  #g-btn {{ display: flex; justify-content: center; margin: 24px 0 8px; }}
  .err {{ color: #ff4757; font-size: 13px; margin-top: 12px; min-height: 18px; }}
</style></head>
<body><div class="card">
  <h1>{inst_name}</h1>
  <p>Sign in with your <strong>institution admin email</strong> to manage members, invites and branding.</p>
  <div id="g-btn"></div>
  <div class="err" id="err"></div>
</div>
<script>
const SLUG = {json.dumps(slug)};
function onGoogle(resp) {{
  fetch('/api/institution/' + SLUG + '/admin-login', {{
    method: 'POST', headers: {{'Content-Type':'application/json'}},
    body: JSON.stringify({{idToken: resp.credential}})
  }}).then(r => r.json()).then(d => {{
    if (d.success) location.reload();
    else document.getElementById('err').textContent = d.error || 'Sign-in failed';
  }}).catch(e => document.getElementById('err').textContent = String(e));
}}
window.addEventListener('load', () => {{
  if (!window.google || !{json.dumps(bool(client_id))}) {{
    document.getElementById('err').textContent = 'Google Sign-In is not configured. Contact SnapToAI support.';
    return;
  }}
  google.accounts.id.initialize({{ client_id: {json.dumps(client_id)}, callback: onGoogle }});
  google.accounts.id.renderButton(document.getElementById('g-btn'), {{ theme: 'filled_black', size: 'large', width: 320 }});
}});
</script></body></html>'''
        resp = Response(gate, mimetype='text/html', status=401)
        resp.headers['Cache-Control'] = 'no-store'
        return resp
    try:
        conn = get_db(); cur = conn.cursor()
        row = _institution_by_slug(cur, slug)
        if not row:
            cur.close(); conn.close()
            return Response("Institution not found", status=404)
        info = _institution_to_dict(cur, row)
        cur.close(); conn.close()
    except Exception as e:
        return Response(f"Error: {e}", status=500)

    name = html_escape_module.escape(info['name'])
    # Defense-in-depth: even though all write paths now validate brandColor
    # against ^#[0-9a-fA-F]{3,8}$, sanitize at render time so any legacy/bad
    # row in the DB cannot break out of CSS context.
    _bc_raw = info['brandColor'] or '#00d9ff'
    if not re.match(r'^#[0-9a-fA-F]{3,8}$', str(_bc_raw)):
        _bc_raw = '#00d9ff'
    info['brandColor'] = _bc_raw
    logo_url = info['logoUrl'] or ''
    brand_color = info['brandColor'] or '#00d9ff'
    seat_limit = info['seatLimit']
    seats_used = info['seatsUsed']
    expires = info['expiresAt'] or 'never'
    domains = html_escape_module.escape(info['allowedDomains'] or '(none)')
    status = info['status']

    cookie_value = ''
    set_cookie = False
    if admin_email:
        cookie_value = f"{admin_email}|{_gen_admin_token(slug, admin_email)}"
        set_cookie = True

    page = f'''<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>{name} — SnapToAI Admin</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * {{ box-sizing: border-box; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f1a; color: #e0e0e0; padding: 24px; margin: 0; }}
  .header {{ display: flex; align-items: center; gap: 16px; padding: 20px; background: linear-gradient(135deg, {brand_color}22, transparent); border: 1px solid {brand_color}55; border-radius: 14px; margin-bottom: 24px; }}
  .header img {{ height: 56px; max-width: 200px; object-fit: contain; background: #fff; border-radius: 8px; padding: 6px; }}
  h1 {{ color: {brand_color}; margin: 0; font-size: 24px; }}
  .subtitle {{ color: #888; margin: 4px 0 0 0; font-size: 13px; }}
  .stats {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 24px; }}
  .card {{ background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 12px; padding: 18px; }}
  .card-num {{ font-size: 28px; font-weight: bold; color: {brand_color}; }}
  .card-label {{ font-size: 11px; color: #888; text-transform: uppercase; margin-top: 4px; }}
  .section {{ background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 12px; padding: 20px; margin-bottom: 20px; }}
  .section h2 {{ color: {brand_color}; margin: 0 0 12px 0; font-size: 16px; }}
  input, select, textarea {{ background: #0f0f1a; border: 1px solid #333; color: #fff; padding: 8px 12px; border-radius: 6px; font-family: inherit; font-size: 13px; }}
  textarea {{ width: 100%; min-height: 100px; resize: vertical; }}
  button {{ background: {brand_color}; color: #000; border: none; padding: 8px 18px; border-radius: 6px; cursor: pointer; font-weight: bold; }}
  button.secondary {{ background: #333; color: #fff; }}
  button.danger {{ background: #ff4757; color: #fff; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 10px; }}
  th {{ background: #16213e; color: {brand_color}; padding: 10px 8px; text-align: left; }}
  td {{ padding: 8px; border-bottom: 1px solid #222; }}
  .badge {{ padding: 3px 8px; border-radius: 4px; font-size: 11px; }}
  .badge-active {{ background: #00ff8820; color: #00ff88; }}
  .badge-suspended {{ background: #ff475720; color: #ff4757; }}
  .badge-pending {{ background: #ffa50020; color: #ffa500; }}
  .row {{ display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }}
  .grow {{ flex: 1; min-width: 180px; }}
  .invite-link {{ font-family: monospace; font-size: 11px; background: #0f0f1a; padding: 6px 8px; border-radius: 4px; color: #ccc; word-break: break-all; }}
</style></head>
<body>
  <div class="header">
    {('<img src="' + html_escape_module.escape(logo_url) + '" alt="logo">') if logo_url else ''}
    <div>
      <h1>{name}</h1>
      <p class="subtitle">SnapToAI Institution Admin · slug: <code>{html_escape_module.escape(slug)}</code> · status: <strong>{status}</strong> · expires: {expires}</p>
    </div>
  </div>

  <div class="stats">
    <div class="card"><div class="card-num" id="stat-seats">{seats_used} / {seat_limit}</div><div class="card-label">Seats Used</div></div>
    <div class="card"><div class="card-num" id="stat-active">—</div><div class="card-label">Active Members</div></div>
    <div class="card"><div class="card-num" id="stat-suspended">—</div><div class="card-label">Suspended</div></div>
    <div class="card"><div class="card-num" id="stat-pending">—</div><div class="card-label">Pre-Invited</div></div>
    <div class="card"><div class="card-num" id="stat-domains" style="font-size:14px;">{domains}</div><div class="card-label">Auto-Join Domains</div></div>
  </div>

  <div class="section">
    <h2>✉️ Invite users</h2>
    <div class="row">
      <input id="invite-email" class="grow" placeholder="user@example.com" type="email">
      <button onclick="inviteOne()">Invite by Email</button>
    </div>
    <div style="margin-top: 14px;">
      <label style="font-size: 12px; color: #888;">Bulk invite — upload a CSV file <em>or</em> paste emails below:</label>
      <input id="invite-csv-file" type="file" accept=".csv,text/csv,text/plain" style="margin: 6px 0; font-size: 12px;">
      <textarea id="invite-csv" placeholder="alice@example.com&#10;bob@example.com,carol@example.com"></textarea>
      <button onclick="inviteBulk()" style="margin-top: 8px;">Bulk Invite</button>
      <span id="bulk-msg" style="margin-left: 10px; color: #00ff88; font-size: 12px;"></span>
    </div>
    <div style="margin-top: 14px;">
      <button class="secondary" onclick="createLink()">+ Generate Invite Link</button>
      <span id="link-msg" style="margin-left: 10px; color: #00ff88; font-size: 12px;"></span>
    </div>
    <div id="links-list" style="margin-top: 12px;"></div>
  </div>

  <div class="section">
    <h2>🌐 Auto-join domains</h2>
    <p style="font-size: 12px; color: #888; margin: 0 0 10px 0;">Anyone signing in with an email at one of these domains is automatically added as a member (public domains like gmail.com are blocked).</p>
    <div class="row">
      <input id="domains-input" class="grow" placeholder="acme.com, eng.acme.com" value="{domains if domains != '(none)' else ''}">
      <button onclick="saveDomains()">Save Domains</button>
      <span id="domains-msg" style="color: #00ff88; font-size: 12px;"></span>
    </div>
  </div>

  <div class="section">
    <h2>🎨 Branding</h2>
    <div class="row" style="align-items: flex-start;">
      <div class="grow">
        <label style="font-size: 12px; color: #888; display: block; margin-bottom: 4px;">Brand color (hex):</label>
        <input id="brand-color-input" type="text" value="{html_escape_module.escape(brand_color)}" style="width: 140px;">
        <span style="display: inline-block; width: 24px; height: 24px; border-radius: 4px; vertical-align: middle; margin-left: 8px; background: {brand_color}; border: 1px solid #333;"></span>
        <button onclick="saveColor()" style="margin-left: 12px;">Save Color</button>
        <span id="color-msg" style="color: #00ff88; font-size: 12px; margin-left: 8px;"></span>
      </div>
      <div style="min-width: 240px;">
        <label style="font-size: 12px; color: #888; display: block; margin-bottom: 4px;">Logo (PNG/JPG/SVG/WebP, max 2MB):</label>
        <input id="logo-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" style="font-size: 12px;">
        <button onclick="uploadLogo()" style="margin-top: 6px;">Upload Logo</button>
        <span id="logo-msg" style="color: #00ff88; font-size: 12px; margin-left: 8px;"></span>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>👥 Members</h2>
    <div id="members-list">Loading...</div>
  </div>

<script>
const SLUG = {json.dumps(slug)};
const API_BASE = '/api/institution/' + SLUG;

async function load() {{
  const r = await fetch(API_BASE + '/members');
  const d = await r.json();
  if (!d.success) {{ document.getElementById('members-list').innerHTML = 'Error: ' + (d.error||''); return; }}
  let active=0, suspended=0, pending=0;
  for (const m of d.members) {{
    if (m.status === 'active') active++;
    else if (m.status === 'suspended') suspended++;
    else pending++;
  }}
  document.getElementById('stat-active').textContent = active;
  document.getElementById('stat-suspended').textContent = suspended;
  document.getElementById('stat-pending').textContent = pending;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}})[c]);
  let html = '<table><tr><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th>Last Seen</th><th>Actions</th></tr>';
  for (const m of d.members) {{
    const badgeClass = m.status === 'active' ? 'badge-active' : (m.status === 'suspended' ? 'badge-suspended' : 'badge-pending');
    const mid = parseInt(m.id, 10) || 0;
    html += '<tr>' +
      '<td>' + esc(m.email) + '</td>' +
      '<td>' + esc(m.role) + '</td>' +
      '<td><span class="badge ' + badgeClass + '">' + esc(m.status) + '</span></td>' +
      '<td>' + (m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : '—') + '</td>' +
      '<td>' + (m.lastSeen ? new Date(m.lastSeen).toLocaleDateString() : '—') + '</td>' +
      '<td>' +
        (m.status === 'active'
          ? '<button class="danger" onclick="suspend(' + mid + ')">Suspend</button> '
          : '<button onclick="reactivate(' + mid + ')">Reactivate</button> ') +
        '<button class="secondary" onclick="removeMember(' + mid + ', ' + JSON.stringify(String(m.email||'')) + ')">Remove</button>' +
      '</td></tr>';
  }}
  html += '</table>';
  document.getElementById('members-list').innerHTML = html;

  // Load invite links
  const lr = await fetch(API_BASE + '/invite-links');
  const ld = await lr.json();
  let lhtml = '';
  if (ld.success && ld.links.length) {{
    lhtml = '<div style="margin-top: 8px; font-size: 12px; color: #888;">Active invite links (anyone with the URL can join):</div>';
    for (const lk of ld.links) {{
      const code = String(lk.code||'').replace(/[^a-zA-Z0-9_-]/g, '');
      const url = window.location.origin + '/join/' + code;
      const lid = parseInt(lk.id, 10) || 0;
      const uses = parseInt(lk.uses, 10) || 0;
      const maxUses = lk.maxUses ? (parseInt(lk.maxUses, 10) || 0) : 0;
      lhtml += '<div style="margin-top: 6px; display: flex; gap: 8px; align-items: center;">' +
        '<span class="invite-link grow">' + esc(url) + '</span>' +
        '<span style="color: #888; font-size: 11px;">uses: ' + uses + (maxUses ? '/' + maxUses : '') + '</span>' +
        '<button class="secondary" onclick="copyLink(' + JSON.stringify(url) + ')">Copy</button>' +
        '<button class="danger" onclick="deleteLink(' + lid + ')">Revoke</button>' +
      '</div>';
    }}
  }}
  document.getElementById('links-list').innerHTML = lhtml;
}}

async function inviteOne() {{
  const email = document.getElementById('invite-email').value.trim();
  if (!email) return;
  const r = await fetch(API_BASE + '/invite', {{method: 'POST', headers: {{'Content-Type':'application/json'}}, body: JSON.stringify({{email}})}});
  const d = await r.json();
  if (d.success) {{ document.getElementById('invite-email').value=''; load(); }} else alert('Failed: ' + (d.error||''));
}}
async function inviteBulk() {{
  const text = document.getElementById('invite-csv').value;
  const file = document.getElementById('invite-csv-file') ? document.getElementById('invite-csv-file').files[0] : null;
  const msg = document.getElementById('bulk-msg');
  let resp;
  if (file) {{
    const fd = new FormData(); fd.append('file', file);
    resp = await fetch(API_BASE + '/invite-bulk', {{method:'POST', body: fd}});
  }} else {{
    if (!text.trim()) return;
    resp = await fetch(API_BASE + '/invite-bulk', {{method:'POST', headers:{{'Content-Type':'application/json'}}, body: JSON.stringify({{csv: text}})}});
  }}
  const d = await resp.json();
  if (d.success) {{
    msg.style.color='#00ff88';
    msg.textContent = '✓ Added ' + d.added + ' · already: ' + (d.alreadyMember||0) + ' · invalid: ' + (d.invalidEmail||0) + ' · no seats: ' + (d.noSeats||0);
    document.getElementById('invite-csv').value='';
    if (document.getElementById('invite-csv-file')) document.getElementById('invite-csv-file').value='';
    load();
  }} else {{ msg.style.color='#ff4757'; msg.textContent = '✗ ' + (d.error||''); }}
}}
async function saveDomains() {{
  const v = document.getElementById('domains-input').value;
  const msg = document.getElementById('domains-msg');
  msg.textContent = 'Saving...';
  const r = await fetch(API_BASE + '/domains', {{method:'POST', headers:{{'Content-Type':'application/json'}}, body: JSON.stringify({{allowedDomains: v}})}});
  const d = await r.json();
  if (d.success) {{ msg.style.color='#00ff88'; msg.textContent = '✓ Saved'; document.getElementById('stat-domains').textContent = d.allowedDomains || '(none)'; }}
  else {{ msg.style.color='#ff4757'; msg.textContent = '✗ ' + (d.error||''); }}
}}
async function saveColor() {{
  const v = document.getElementById('brand-color-input').value.trim();
  const msg = document.getElementById('color-msg');
  msg.textContent = 'Saving...';
  const r = await fetch(API_BASE + '/branding', {{method:'POST', headers:{{'Content-Type':'application/json'}}, body: JSON.stringify({{brandColor: v}})}});
  const d = await r.json();
  if (d.success) {{ msg.style.color='#00ff88'; msg.textContent = '✓ Saved (members refresh to see it)'; }}
  else {{ msg.style.color='#ff4757'; msg.textContent = '✗ ' + (d.error||''); }}
}}
async function uploadLogo() {{
  const f = document.getElementById('logo-file').files[0];
  const msg = document.getElementById('logo-msg');
  if (!f) {{ msg.style.color='#ff4757'; msg.textContent='Pick a file first'; return; }}
  msg.style.color='#888'; msg.textContent='Uploading...';
  const fd = new FormData(); fd.append('logo', f);
  const r = await fetch(API_BASE + '/branding/logo', {{method:'POST', body: fd}});
  const d = await r.json();
  if (d.success) {{ msg.style.color='#00ff88'; msg.textContent = '✓ Uploaded'; setTimeout(()=>location.reload(), 800); }}
  else {{ msg.style.color='#ff4757'; msg.textContent = '✗ ' + (d.error||''); }}
}}
async function createLink() {{
  const r = await fetch(API_BASE + '/invite-link', {{method:'POST', headers:{{'Content-Type':'application/json'}}, body: JSON.stringify({{}})}});
  const d = await r.json();
  const msg = document.getElementById('link-msg');
  if (d.success) {{ msg.style.color='#00ff88'; msg.textContent = '✓ Created'; load(); }}
  else {{ msg.style.color='#ff4757'; msg.textContent = '✗ ' + (d.error||''); }}
}}
async function deleteLink(id) {{ if (!confirm('Revoke this invite link?')) return;
  const r = await fetch(API_BASE + '/invite-link/' + id, {{method:'DELETE'}}); const d = await r.json();
  if (d.success) load(); else alert('Failed');
}}
async function suspend(id) {{
  const r = await fetch(API_BASE + '/members/' + id + '/suspend', {{method:'POST'}});
  const d = await r.json(); if (d.success) load(); else alert(d.error||'Failed');
}}
async function reactivate(id) {{
  const r = await fetch(API_BASE + '/members/' + id + '/reactivate', {{method:'POST'}});
  const d = await r.json(); if (d.success) load(); else alert(d.error||'Failed');
}}
async function removeMember(id, email) {{
  if (!confirm('Remove ' + email + ' from the institution? They lose pro access immediately.')) return;
  const r = await fetch(API_BASE + '/members/' + id, {{method:'DELETE'}});
  const d = await r.json(); if (d.success) load(); else alert(d.error||'Failed');
}}
function copyLink(url) {{ navigator.clipboard.writeText(url).then(()=>alert('Copied: '+url)); }}

load();
</script>
</body></html>'''
    resp = Response(page, mimetype='text/html')
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    if set_cookie:
        resp.set_cookie(INST_ADMIN_COOKIE_PREFIX + slug, cookie_value, httponly=True, samesite='Lax', max_age=86400 * 30)
    return resp


@app.route('/api/institution/<slug>/members', methods=['GET', 'OPTIONS'])
def api_inst_members(slug):
    if request.method == 'OPTIONS':
        return _options('GET, OPTIONS')
    ok, _ = _verify_inst_admin(slug)
    if not ok:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("SELECT id FROM institutions WHERE slug=%s", (slug,))
        r = cur.fetchone()
        if not r:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Not found'})), 404
        inst_id = r[0]
        cur.execute("""
            SELECT id, email, role, status, invited_by, joined_at, last_seen
            FROM institution_members WHERE institution_id=%s ORDER BY joined_at DESC
        """, (inst_id,))
        members = [{
            'id': row[0], 'email': row[1], 'role': row[2], 'status': row[3],
            'invitedBy': row[4],
            'joinedAt': row[5].isoformat() if row[5] else None,
            'lastSeen': row[6].isoformat() if row[6] else None
        } for row in cur.fetchall()]
        cur.close(); conn.close()
        return _cors(jsonify({'success': True, 'members': members, 'total': len(members)}))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500

_EMAIL_RE = re.compile(r'^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$')

def _add_member(cur, inst_id, email, invited_by, role='member'):
    """Returns 'added', 'already', or 'invalid'."""
    email = _norm_email(email)
    if not email or not _EMAIL_RE.match(email):
        return 'invalid'
    cur.execute("""
        INSERT INTO institution_members (institution_id, email, role, status, invited_by, joined_at)
        VALUES (%s,%s,%s,'active',%s,NOW())
        ON CONFLICT (institution_id, email) DO UPDATE SET status='active'
        RETURNING (xmax = 0) AS inserted
    """, (inst_id, email, role, invited_by or 'inst-admin'))
    row = cur.fetchone()
    is_new = bool(row and row[0])
    # Activate paywall bypass for already-registered users
    cur.execute("""
        UPDATE subscriptions SET plan_type=CASE WHEN plan_type IN ('monthly','yearly') AND status='active' THEN plan_type ELSE 'institution' END,
                                  status='active', subscription_end=NULL, last_verified=NOW(), updated_at=NOW()
        WHERE LOWER(email)=%s
    """, (email,))
    cur.execute("""
        INSERT INTO subscriptions (email, plan_type, status, subscription_start, last_verified, created_at, updated_at)
        VALUES (%s,'institution','active',NOW(),NOW(),NOW(),NOW())
        ON CONFLICT (email) DO NOTHING
    """, (email,))
    cur.execute("UPDATE users SET institution_id=%s WHERE LOWER(email)=%s", (inst_id, email))
    return 'added' if is_new else 'already'

@app.route('/api/institution/<slug>/invite', methods=['POST', 'OPTIONS'])
def api_inst_invite(slug):
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    ok, admin_email = _verify_inst_admin(slug)
    if not ok:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    data = request.get_json(silent=True) or {}
    email = _norm_email(data.get('email', ''))
    if not email or '@' not in email:
        return _cors(jsonify({'success': False, 'error': 'Valid email required'})), 400
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("SELECT id, seat_limit FROM institutions WHERE slug=%s", (slug,))
        r = cur.fetchone()
        if not r:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Not found'})), 404
        inst_id, seat_limit = r[0], r[1]
        if seat_limit and _seats_used(cur, inst_id) >= seat_limit:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Seat limit reached. Increase the limit or remove inactive members.'})), 400
        result = _add_member(cur, inst_id, email, admin_email or 'inst-admin')
        conn.commit()
        cur.close(); conn.close()
        if result == 'invalid':
            return _cors(jsonify({'success': False, 'error': 'Invalid email format'})), 400
        return _cors(jsonify({'success': True, 'result': result}))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500

@app.route('/api/institution/<slug>/invite-bulk', methods=['POST', 'OPTIONS'])
def api_inst_invite_bulk(slug):
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    ok, admin_email = _verify_inst_admin(slug)
    if not ok:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    raw = ''
    upload = request.files.get('file') or request.files.get('csv')
    if upload and upload.filename:
        try:
            raw = upload.read(200 * 1024).decode('utf-8', errors='ignore')
        except Exception as e:
            return _cors(jsonify({'success': False, 'error': f'Could not read CSV file: {e}'})), 400
    else:
        data = request.get_json(silent=True) or {}
        raw = str(data.get('csv', ''))[:50000]
    if not raw.strip():
        return _cors(jsonify({'success': False, 'error': 'csv empty'})), 400
    parts = []
    for line in raw.replace('\r', '\n').split('\n'):
        for tok in line.split(','):
            t = tok.strip().strip('"').strip("'")
            if t:
                parts.append(t)
    seen = set()
    candidates = []
    invalid_format = []
    for p in parts:
        e = _norm_email(p)
        if not e or not _EMAIL_RE.match(e):
            invalid_format.append(p[:120])
            continue
        if e not in seen:
            seen.add(e)
            candidates.append(e)
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("SELECT id, seat_limit FROM institutions WHERE slug=%s", (slug,))
        r = cur.fetchone()
        if not r:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Not found'})), 404
        inst_id, seat_limit = r[0], r[1]
        added = 0
        already_member = 0
        invalid_email = len(invalid_format)
        no_seats = 0
        for e in candidates:
            if seat_limit and _seats_used(cur, inst_id) >= seat_limit:
                no_seats += 1
                continue
            res = _add_member(cur, inst_id, e, admin_email or 'csv-bulk')
            if res == 'added':
                added += 1
            elif res == 'already':
                already_member += 1
            else:
                invalid_email += 1
        conn.commit()
        cur.close(); conn.close()
        skipped = already_member + invalid_email + no_seats
        return _cors(jsonify({
            'success': True,
            'added': added,
            'alreadyMember': already_member,
            'invalidEmail': invalid_email,
            'noSeats': no_seats,
            'skipped': skipped,
            'total': len(candidates) + len(invalid_format),
            'invalidSamples': invalid_format[:5]
        }))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500

@app.route('/api/institution/<slug>/domains', methods=['POST', 'OPTIONS'])
def api_inst_set_domains(slug):
    """Institution-admin endpoint to set the auto-join allowed_domains list.
    Public-email domains (gmail/outlook/etc.) are stripped server-side."""
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    ok, _ = _verify_inst_admin(slug)
    if not ok:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    data = request.get_json(silent=True) or {}
    raw = str(data.get('allowedDomains') or '')[:500]
    cleaned = []
    for d in raw.replace(';', ',').replace(' ', ',').split(','):
        d = d.strip().lower().lstrip('@')
        if not d or d in PUBLIC_DOMAINS:
            continue
        if '.' not in d or len(d) > 100:
            continue
        if d not in cleaned:
            cleaned.append(d)
    final = ','.join(cleaned)
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("UPDATE institutions SET allowed_domains=%s, updated_at=NOW() WHERE slug=%s", (final or None, slug))
        conn.commit()
        cur.close(); conn.close()
        return _cors(jsonify({'success': True, 'allowedDomains': final}))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500


@app.route('/api/institution/<slug>/branding', methods=['POST', 'OPTIONS'])
def api_inst_set_branding(slug):
    """Institution-admin endpoint to update brand color (and other text fields).
    Logo upload uses the dedicated /branding/logo endpoint below."""
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    ok, _ = _verify_inst_admin(slug)
    if not ok:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    data = request.get_json(silent=True) or {}
    color = str(data.get('brandColor') or '').strip()[:20]
    if color and not re.match(r'^#[0-9a-fA-F]{3,8}$', color):
        return _cors(jsonify({'success': False, 'error': 'brandColor must be a hex color like #00d9ff'})), 400
    try:
        conn = get_db(); cur = conn.cursor()
        if color:
            cur.execute("UPDATE institutions SET brand_color=%s, updated_at=NOW() WHERE slug=%s", (color, slug))
        conn.commit()
        cur.close(); conn.close()
        return _cors(jsonify({'success': True, 'brandColor': color}))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500


@app.route('/api/institution/<slug>/branding/logo', methods=['POST', 'OPTIONS'])
def api_inst_upload_logo(slug):
    """Institution-admin endpoint to upload a logo (delegates to the same
    validation used by the super-admin logo endpoint)."""
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    ok, _ = _verify_inst_admin(slug)
    if not ok:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    f = request.files.get('logo')
    if not f or not f.filename:
        return _cors(jsonify({'success': False, 'error': 'No file uploaded (field name: logo)'})), 400
    ext = ''
    if '.' in f.filename:
        ext = '.' + f.filename.rsplit('.', 1)[1].lower()
    if ext not in ALLOWED_LOGO_EXTS:
        return _cors(jsonify({'success': False, 'error': f'Unsupported extension {ext}. Allowed: {sorted(ALLOWED_LOGO_EXTS)}'})), 400
    blob = f.read(2 * 1024 * 1024 + 1)
    if not blob:
        return _cors(jsonify({'success': False, 'error': 'Empty file'})), 400
    if len(blob) > 2 * 1024 * 1024:
        return _cors(jsonify({'success': False, 'error': 'Logo too large (max 2 MB)'})), 400
    head = blob[:12]
    is_png = head.startswith(b'\x89PNG\r\n\x1a\n')
    is_jpg = head.startswith(b'\xff\xd8\xff')
    is_gif = head.startswith(b'GIF87a') or head.startswith(b'GIF89a')
    is_webp = head[:4] == b'RIFF' and head[8:12] == b'WEBP'
    is_svg = b'<svg' in blob[:512].lower() or blob.lstrip()[:5].lower().startswith(b'<?xml')
    valid_for_ext = (
        (ext == '.png' and is_png) or
        (ext in ('.jpg', '.jpeg') and is_jpg) or
        (ext == '.gif' and is_gif) or
        (ext == '.webp' and is_webp) or
        (ext == '.svg' and is_svg)
    )
    if not valid_for_ext:
        return _cors(jsonify({'success': False, 'error': f'File contents do not match extension {ext}'})), 400
    try:
        os.makedirs(INSTITUTION_LOGO_DIR, exist_ok=True)
        for old in os.listdir(INSTITUTION_LOGO_DIR):
            if old.startswith(slug + '.'):
                try: os.remove(os.path.join(INSTITUTION_LOGO_DIR, old))
                except Exception: pass
        target = os.path.join(INSTITUTION_LOGO_DIR, slug + ext)
        with open(target, 'wb') as out:
            out.write(blob)
        logo_url = f'/static/institution-logos/{slug}{ext}?v={int(time.time())}'
        conn = get_db(); cur = conn.cursor()
        cur.execute("UPDATE institutions SET logo_url=%s, updated_at=NOW() WHERE slug=%s", (logo_url, slug))
        conn.commit()
        cur.close(); conn.close()
        return _cors(jsonify({'success': True, 'logoUrl': logo_url}))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500


@app.route('/api/institution/<slug>/invite-link', methods=['POST', 'OPTIONS'])
def api_inst_invite_link(slug):
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    ok, admin_email = _verify_inst_admin(slug)
    if not ok:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    data = request.get_json(silent=True) or {}
    max_uses = int(data.get('maxUses') or 0)
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("SELECT id FROM institutions WHERE slug=%s", (slug,))
        r = cur.fetchone()
        if not r:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Not found'})), 404
        code = _gen_invite_code()
        cur.execute("""
            INSERT INTO institution_invites (institution_id, code, max_uses, uses, created_by, created_at)
            VALUES (%s, %s, %s, 0, %s, NOW())
        """, (r[0], code, max_uses, admin_email or 'inst-admin'))
        conn.commit()
        cur.close(); conn.close()
        return _cors(jsonify({'success': True, 'code': code, 'url': f'/join/{code}'}))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500

@app.route('/api/institution/<slug>/invite-links', methods=['GET', 'OPTIONS'])
def api_inst_invite_links_list(slug):
    if request.method == 'OPTIONS':
        return _options('GET, OPTIONS')
    ok, _ = _verify_inst_admin(slug)
    if not ok:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("SELECT id FROM institutions WHERE slug=%s", (slug,))
        r = cur.fetchone()
        if not r:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Not found'})), 404
        cur.execute("""
            SELECT id, code, max_uses, uses, created_at, created_by
            FROM institution_invites WHERE institution_id=%s ORDER BY created_at DESC
        """, (r[0],))
        links = [{'id': row[0], 'code': row[1], 'maxUses': row[2], 'uses': row[3],
                  'createdAt': row[4].isoformat() if row[4] else None, 'createdBy': row[5]}
                 for row in cur.fetchall()]
        cur.close(); conn.close()
        return _cors(jsonify({'success': True, 'links': links}))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500

@app.route('/api/institution/<slug>/invite-link/<int:link_id>', methods=['DELETE', 'OPTIONS'])
def api_inst_invite_link_delete(slug, link_id):
    if request.method == 'OPTIONS':
        return _options('DELETE, OPTIONS')
    ok, _ = _verify_inst_admin(slug)
    if not ok:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("""
            DELETE FROM institution_invites WHERE id=%s
              AND institution_id=(SELECT id FROM institutions WHERE slug=%s)
        """, (link_id, slug))
        conn.commit()
        cur.close(); conn.close()
        return _cors(jsonify({'success': True}))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500

@app.route('/api/institution/<slug>/members/<int:member_id>/suspend', methods=['POST', 'OPTIONS'])
def api_inst_member_suspend(slug, member_id):
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    ok, _ = _verify_inst_admin(slug)
    if not ok:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("""
            UPDATE institution_members SET status='suspended'
            WHERE id=%s AND institution_id=(SELECT id FROM institutions WHERE slug=%s)
            RETURNING email
        """, (member_id, slug))
        r = cur.fetchone()
        if r:
            cur.execute("UPDATE subscriptions SET status='inactive', updated_at=NOW() WHERE LOWER(email)=%s AND plan_type='institution'", (_norm_email(r[0]),))
        conn.commit()
        cur.close(); conn.close()
        return _cors(jsonify({'success': True}))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500

@app.route('/api/institution/<slug>/members/<int:member_id>/reactivate', methods=['POST', 'OPTIONS'])
def api_inst_member_reactivate(slug, member_id):
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    ok, _ = _verify_inst_admin(slug)
    if not ok:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("""
            UPDATE institution_members SET status='active'
            WHERE id=%s AND institution_id=(SELECT id FROM institutions WHERE slug=%s)
            RETURNING email
        """, (member_id, slug))
        r = cur.fetchone()
        if r:
            cur.execute("UPDATE subscriptions SET status='active', updated_at=NOW() WHERE LOWER(email)=%s AND plan_type='institution'", (_norm_email(r[0]),))
        conn.commit()
        cur.close(); conn.close()
        return _cors(jsonify({'success': True}))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500

@app.route('/api/institution/<slug>/members/<int:member_id>', methods=['DELETE', 'OPTIONS'])
def api_inst_member_delete(slug, member_id):
    if request.method == 'OPTIONS':
        return _options('DELETE, OPTIONS')
    ok, _ = _verify_inst_admin(slug)
    if not ok:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("""
            DELETE FROM institution_members
            WHERE id=%s AND institution_id=(SELECT id FROM institutions WHERE slug=%s)
            RETURNING email, institution_id
        """, (member_id, slug))
        r = cur.fetchone()
        if r:
            cur.execute("UPDATE subscriptions SET status='inactive', plan_type='unknown', updated_at=NOW() WHERE LOWER(email)=%s AND plan_type='institution'", (_norm_email(r[0]),))
            cur.execute("UPDATE users SET institution_id=NULL WHERE LOWER(email)=%s AND institution_id=%s", (_norm_email(r[0]), r[1]))
        conn.commit()
        cur.close(); conn.close()
        return _cors(jsonify({'success': True}))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500


# ============================================
# INSTITUTIONS — public invite landing
# ============================================

@app.route('/join/<code>', methods=['GET'])
def institution_join_page(code):
    if not ensure_db():
        return Response("Database not available", status=503)
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("""
            SELECT i.id, i.slug, i.name, i.logo_url, i.brand_color, i.status, i.expires_at, i.seat_limit,
                   inv.uses, inv.max_uses
            FROM institution_invites inv JOIN institutions i ON i.id = inv.institution_id
            WHERE inv.code=%s
        """, (code,))
        r = cur.fetchone()
        cur.close(); conn.close()
    except Exception as e:
        return Response(f"Error: {e}", status=500)
    if not r:
        return Response("Invite link not found or expired.", status=404)
    inst_id, slug, name, logo_url, brand_color, status, expires_at, seat_limit, uses, max_uses = r
    if not _institution_active((status, expires_at)):
        return Response(f"This invite is no longer active. Contact {html_escape_module.escape(name)}.", status=410)
    if max_uses and uses >= max_uses:
        return Response("This invite link has reached its usage limit.", status=410)
    safe_name = html_escape_module.escape(name)
    # CSS-context: enforce strict hex regex; fall back to default if anything else.
    _raw_color = brand_color or '#00d9ff'
    safe_color = _raw_color if re.match(r'^#[0-9a-fA-F]{3,8}$', str(_raw_color)) else '#00d9ff'
    logo_html = f'<img src="{html_escape_module.escape(logo_url)}" alt="logo" style="height:80px; max-width:240px; object-fit:contain; background:#fff; border-radius:12px; padding:8px; margin-bottom:24px;">' if logo_url else ''
    page = f'''<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Join {safe_name} on SnapToAI</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #0f0f1a 0%, #1a0f2e 100%); color: #fff; min-height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center; padding: 24px; }}
  .card {{ max-width: 520px; background: rgba(255,255,255,0.04); border: 1px solid {safe_color}55; border-radius: 20px; padding: 40px; text-align: center; backdrop-filter: blur(20px); }}
  h1 {{ color: {safe_color}; margin: 0 0 8px 0; font-size: 28px; }}
  p {{ color: #ccc; line-height: 1.6; }}
  input {{ width: 100%; background: #0f0f1a; border: 1px solid #333; color: #fff; padding: 12px 16px; border-radius: 10px; font-size: 15px; margin: 16px 0; box-sizing: border-box; }}
  button {{ background: {safe_color}; color: #000; border: none; padding: 14px 28px; border-radius: 10px; cursor: pointer; font-weight: bold; font-size: 15px; width: 100%; }}
  .step {{ background: rgba(0,0,0,0.3); border-radius: 10px; padding: 16px; margin: 16px 0; text-align: left; font-size: 14px; color: #ccc; }}
  .step strong {{ color: {safe_color}; }}
  a {{ color: {safe_color}; }}
  #msg {{ margin-top: 12px; font-size: 13px; min-height: 18px; }}
</style>
<script src="https://accounts.google.com/gsi/client" async defer></script>
</head>
<body>
<div class="card">
  {logo_html}
  <h1>You're invited to {safe_name}</h1>
  <p>Sign in with Google to claim your free SnapToAI Pro seat — included with your {safe_name} membership.</p>
  <div id="g-btn" style="display:flex; justify-content:center; margin: 24px 0 8px;"></div>
  <div id="msg"></div>
  <div class="step">
    <strong>Next step:</strong> After signing in, install the SnapToAI Chrome extension and sign in with the same Google account — your branded Pro license unlocks automatically.
    <br><br>
    <a id="install-link" href="https://chromewebstore.google.com/detail/snaptoai" target="_blank">→ Install SnapToAI from Chrome Web Store</a>
  </div>
</div>
<script>
const INVITE_CODE = {json.dumps(code)};
const GOOGLE_CLIENT = {json.dumps(GOOGLE_CLIENT_ID or '')};
function onGoogle(resp) {{
  const msg = document.getElementById('msg');
  msg.style.color = '#888'; msg.textContent = 'Reserving your seat...';
  fetch('/api/institution/join', {{method:'POST', headers:{{'Content-Type':'application/json'}}, body: JSON.stringify({{code: INVITE_CODE, idToken: resp.credential}})}})
    .then(r => r.json()).then(d => {{
      if (d.success) {{
        msg.style.color = '#00ff88';
        msg.textContent = '✓ Seat reserved for ' + (d.email || 'your Google account') + '. Install the extension and sign in with the same Google account.';
      }} else if (d.error === 'seat_limit') {{
        msg.style.color = '#ff4757';
        msg.textContent = '✗ This institution has hit its seat limit. Please contact your admin.';
      }} else {{
        msg.style.color = '#ff4757';
        msg.textContent = '✗ ' + (d.error || 'Could not reserve seat');
      }}
    }}).catch(e => {{ msg.style.color = '#ff4757'; msg.textContent = '✗ ' + e; }});
}}
window.addEventListener('load', () => {{
  if (!window.google || !GOOGLE_CLIENT) {{
    document.getElementById('msg').style.color = '#ff4757';
    document.getElementById('msg').textContent = 'Google Sign-In is not configured. Contact your institution admin.';
    return;
  }}
  google.accounts.id.initialize({{ client_id: GOOGLE_CLIENT, callback: onGoogle }});
  google.accounts.id.renderButton(document.getElementById('g-btn'), {{ theme: 'filled_black', size: 'large', width: 320 }});
}});
</script>
</body></html>'''
    resp = Response(page, mimetype='text/html')
    resp.headers['Cache-Control'] = 'no-store'
    return resp

@app.route('/api/institution/join', methods=['POST', 'OPTIONS'])
def api_institution_join():
    """Public invite-link redemption. Accepts EITHER a Google idToken (preferred,
    real-identity flow) OR a plain email (legacy fallback for tests)."""
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    data = request.get_json(silent=True) or {}
    code = str(data.get('code', '')).strip()[:64]
    id_token = (data.get('idToken') or data.get('credential') or '').strip()
    email = ''
    if id_token:
        verified = verify_google_token(id_token)
        if not verified:
            return _cors(jsonify({'success': False, 'error': 'Invalid Google token'})), 401
        email = _norm_email(verified)
    else:
        email = _norm_email(data.get('email', ''))
    if not code or not email or '@' not in email:
        return _cors(jsonify({'success': False, 'error': 'code and valid email required'})), 400
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("""
            SELECT inv.id, inv.institution_id, inv.uses, inv.max_uses,
                   i.status, i.expires_at, i.seat_limit
            FROM institution_invites inv JOIN institutions i ON i.id = inv.institution_id
            WHERE inv.code=%s
        """, (code,))
        r = cur.fetchone()
        if not r:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Invalid invite link'})), 404
        inv_id, inst_id, uses, max_uses, status, expires_at, seat_limit = r
        if not _institution_active((status, expires_at)):
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Invite no longer active'})), 410
        if max_uses and uses >= max_uses:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'invite_exhausted'})), 410
        if seat_limit and _seats_used(cur, inst_id) >= seat_limit:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'seat_limit'})), 400
        result = _add_member(cur, inst_id, email, f'invite-link:{code[:8]}')
        if result == 'invalid':
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Invalid email format'})), 400
        # Only burn an invite-link use when we actually added a NEW seat
        if result == 'added':
            cur.execute("UPDATE institution_invites SET uses=uses+1 WHERE id=%s", (inv_id,))
        conn.commit()
        cur.close(); conn.close()
        return _cors(jsonify({'success': True, 'result': result}))
    except Exception as e:
        print(f'❌ inst join: {e}')
        return _cors(jsonify({'success': False, 'error': str(e)})), 500


if __name__ == '__main__':
    print('✅ Landing page live at: 0.0.0.0:5000')
    print('🌍 54 languages available:')
    print('   /       → English (default)')
    print('   /ar     → Arabic')
    print('   /es     → Spanish')
    print('   /fr     → French')
    print('   ... and 50 more!')
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
