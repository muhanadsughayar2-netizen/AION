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
                branding_locked BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        ''')
        # Backfill for installs predating branding_locked.
        cur.execute("ALTER TABLE institutions ADD COLUMN IF NOT EXISTS branding_locked BOOLEAN DEFAULT FALSE")
        # Optional light-mode logo variant (Task #20). Falls back to logo_url
        # when NULL so existing single-logo institutions keep working untouched.
        cur.execute("ALTER TABLE institutions ADD COLUMN IF NOT EXISTS logo_url_light TEXT")
        # Task #27 — institution-shared Gemini/Vertex key.
        # gemini_key_encrypted holds a Fernet ciphertext (never plaintext); gemini_key_hint
        # stores the last 4 visible chars for the masked admin preview. key_policy controls
        # who wins when both an institution key and a member BYOK key exist:
        #   'institution-only'        — members can't override; BYOK input is hidden
        #   'prefer-institution-key'  — institution key wins, BYOK is a fallback
        #   'prefer-user-key'         — member BYOK wins, institution key is the fallback
        # billing_behavior controls the SnapToAI free-prompt meter when the institution
        # key is the one actually used:
        #   'count-against-snaptoai-quota' — default; still decrements free_prompts
        #   'bypass-snaptoai-quota'        — institution pays Google directly, no metering
        cur.execute("ALTER TABLE institutions ADD COLUMN IF NOT EXISTS gemini_key_encrypted TEXT")
        cur.execute("ALTER TABLE institutions ADD COLUMN IF NOT EXISTS gemini_key_hint VARCHAR(20)")
        cur.execute("ALTER TABLE institutions ADD COLUMN IF NOT EXISTS key_policy VARCHAR(30) DEFAULT 'prefer-user-key'")
        cur.execute("ALTER TABLE institutions ADD COLUMN IF NOT EXISTS billing_behavior VARCHAR(30) DEFAULT 'count-against-snaptoai-quota'")
        cur.execute("ALTER TABLE institutions ADD COLUMN IF NOT EXISTS key_set_at TIMESTAMP")
        cur.execute("ALTER TABLE institutions ADD COLUMN IF NOT EXISTS key_last_rotated_at TIMESTAMP")
        cur.execute("ALTER TABLE institutions ADD COLUMN IF NOT EXISTS key_last_used_at TIMESTAMP")
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
        # Per-member access expiry — admin can grant 1-month / 3-month / etc.
        # access. NULL = no expiry (lifetime, until removed/suspended).
        cur.execute("ALTER TABLE institution_members ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP")
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
        # Task #37 — admin accountability audit log. Records who did what
        # inside an institution (invites, suspends, key rotations, branding
        # edits, policy changes, etc.) so admins can answer "who suspended
        # Alice last week?" without digging through server logs.
        cur.execute('''
            CREATE TABLE IF NOT EXISTS institution_audit_log (
                id SERIAL PRIMARY KEY,
                institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
                actor_email TEXT,
                action VARCHAR(60) NOT NULL,
                target TEXT,
                meta JSONB,
                created_at TIMESTAMP DEFAULT NOW()
            )
        ''')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_inst_audit_inst_time ON institution_audit_log(institution_id, created_at DESC)')
        print('✅ institutions, institution_members, institution_invites, institution_audit_log tables ready')

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

# --- Magic-link sign-in for institution admins ----------------------------
# Short-lived (15 min), single-use HMAC tokens that an authorized institution
# admin can request by email when Google Sign-In is unavailable. Single-use is
# enforced via an in-process set of consumed tokens (sufficient for our single
# Flask worker; tokens also auto-expire by signature so a worker restart at
# worst lets a not-yet-expired token be used twice within its 15-min window).
import hmac
import threading as _threading_for_magic
import urllib.parse
_MAGIC_LINK_TTL_SECONDS = 15 * 60
_USED_MAGIC_TOKENS = {}  # token_sig -> exp_ts
_USED_MAGIC_LOCK = _threading_for_magic.Lock()

def _gen_magic_link_token(slug, email, exp_ts):
    payload = f"magic|{slug}|{_norm_email(email)}|{int(exp_ts)}|{ADMIN_SESSION_SECRET}"
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()

def _verify_magic_link_token(slug, email, exp_ts, token):
    try:
        exp_ts = int(exp_ts)
    except (TypeError, ValueError):
        return False, 'Bad link'
    if not (slug and email and token):
        return False, 'Bad link'
    now = int(time.time())
    if exp_ts < now:
        return False, 'This sign-in link has expired. Please request a new one.'
    expected = _gen_magic_link_token(slug, email, exp_ts)
    if not hmac.compare_digest(expected, token):
        return False, 'Bad link'
    sig_key = f"{slug}|{_norm_email(email)}|{exp_ts}|{token}"
    with _USED_MAGIC_LOCK:
        # Opportunistic GC of expired entries
        if len(_USED_MAGIC_TOKENS) > 256:
            for k in [k for k, v in _USED_MAGIC_TOKENS.items() if v < now]:
                _USED_MAGIC_TOKENS.pop(k, None)
        if sig_key in _USED_MAGIC_TOKENS:
            return False, 'This sign-in link has already been used. Please request a new one.'
        _USED_MAGIC_TOKENS[sig_key] = exp_ts
    return True, None

def _send_inst_admin_email(to_email, subject, body_text):
    """Send a plain-text email via SMTP env vars. Returns (ok, error_message).
    Required env vars: SMTP_HOST. Optional: SMTP_PORT (default 587),
    SMTP_USER, SMTP_PASSWORD, SMTP_FROM (default SMTP_USER), SMTP_USE_TLS
    (default '1'). If SMTP_HOST is missing, returns (False, friendly_msg)."""
    host = os.environ.get('SMTP_HOST', '').strip()
    if not host:
        return False, ("Email delivery isn't set up on this server. "
                       "Ask the super-admin to send you a sign-in link.")
    try:
        import smtplib
        from email.message import EmailMessage
        port = int(os.environ.get('SMTP_PORT', '587'))
        user = os.environ.get('SMTP_USER', '').strip()
        pw = os.environ.get('SMTP_PASSWORD', '')
        sender = os.environ.get('SMTP_FROM', '').strip() or user or 'no-reply@snaptoai.com'
        use_tls = os.environ.get('SMTP_USE_TLS', '1') not in ('0', 'false', 'False', '')
        msg = EmailMessage()
        msg['Subject'] = subject
        msg['From'] = sender
        msg['To'] = to_email
        msg.set_content(body_text)
        with smtplib.SMTP(host, port, timeout=15) as s:
            s.ehlo()
            if use_tls:
                s.starttls()
                s.ehlo()
            if user:
                s.login(user, pw)
            s.send_message(msg)
        return True, None
    except Exception as e:
        print(f'❌ admin magic-link email send to {to_email}: {type(e).__name__}: {e}')
        return False, ("We couldn't send the email right now — "
                       "please try again in a moment, or ask the super-admin for help.")

def _send_html_email(to_email, subject, html_body, text_body):
    """Send a multipart (text + HTML) email via the same SMTP env vars as
    `_send_inst_admin_email`. Returns (ok, error_message). Required env vars:
    SMTP_HOST. Optional: SMTP_PORT (587), SMTP_USER, SMTP_PASS (or
    SMTP_PASSWORD), SMTP_FROM, SMTP_USE_TLS ('1')."""
    host = os.environ.get('SMTP_HOST', '').strip()
    if not host:
        return False, "Email delivery isn't set up on this server (SMTP_HOST is missing)."
    try:
        import smtplib
        from email.message import EmailMessage
        port = int(os.environ.get('SMTP_PORT', '587'))
        user = os.environ.get('SMTP_USER', '').strip()
        pw = os.environ.get('SMTP_PASS', '') or os.environ.get('SMTP_PASSWORD', '')
        sender = os.environ.get('SMTP_FROM', '').strip() or user or 'no-reply@snaptoai.com'
        use_tls = os.environ.get('SMTP_USE_TLS', '1') not in ('0', 'false', 'False', '')
        msg = EmailMessage()
        msg['Subject'] = subject
        msg['From'] = sender
        msg['To'] = to_email
        msg.set_content(text_body)
        msg.add_alternative(html_body, subtype='html')
        with smtplib.SMTP(host, port, timeout=15) as s:
            s.ehlo()
            if use_tls:
                s.starttls()
                s.ehlo()
            if user:
                s.login(user, pw)
            s.send_message(msg)
        return True, None
    except Exception as e:
        print(f'❌ welcome email send to {to_email}: {type(e).__name__}: {e}')
        return False, f'{type(e).__name__}: {e}'


SNAPTOAI_STORE_URL = 'https://chromewebstore.google.com/detail/snaptoai'


def _send_welcome_email(email, inst_name, brand_color=None, logo_url=None):
    """Send a branded welcome email to a newly-added institution member.
    Returns (ok, error_message). If SMTP isn't configured, returns
    (False, friendly_msg) without raising — callers can keep going."""
    safe_color = brand_color if (brand_color and re.match(r'^#[0-9a-fA-F]{3,8}$', str(brand_color))) else '#00d9ff'
    name_for_subject = inst_name or 'your team'
    safe_name = html_escape_module.escape(name_for_subject)
    safe_email = html_escape_module.escape(email)
    install_url = SNAPTOAI_STORE_URL
    logo_html = ''
    if logo_url:
        full_logo = logo_url
        if full_logo.startswith('/'):
            base = (os.environ.get('PUBLIC_BASE_URL') or os.environ.get('REPLIT_DEV_DOMAIN') or '').strip()
            if base and not base.startswith('http'):
                base = 'https://' + base
            full_logo = (base.rstrip('/') + full_logo) if base else full_logo
        logo_html = f'<img src="{html_escape_module.escape(full_logo)}" alt="" style="max-height:60px;max-width:200px;display:block;margin:0 auto 18px;background:#fff;border-radius:6px;padding:6px;">'
    subject = f'You have been added to {name_for_subject} on SnapToAI'
    html_body = f'''<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#222;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;border-top:4px solid {safe_color};box-shadow:0 1px 3px rgba(0,0,0,0.06);">
{logo_html}
<h1 style="color:{safe_color};margin:0 0 12px;font-size:22px;">Welcome to {safe_name} on SnapToAI</h1>
<p style="font-size:15px;line-height:1.5;margin:0 0 16px;">Your administrator has added you to <strong>{safe_name}</strong>. Your branded SnapToAI license is ready — you just need to install the Chrome extension and sign in.</p>
<ol style="font-size:15px;line-height:1.7;padding-left:20px;margin:0 0 20px;">
  <li>Install the SnapToAI Chrome extension: <a href="{install_url}" style="color:{safe_color};">{install_url}</a></li>
  <li>Sign in with Google using <strong>this exact email address</strong>:<br><code style="background:#f0f0f5;padding:3px 8px;border-radius:4px;display:inline-block;margin-top:4px;">{safe_email}</code></li>
  <li>Your license unlocks automatically — no code or invite link needed.</li>
</ol>
<p style="text-align:center;margin:24px 0;"><a href="{install_url}" style="background:{safe_color};color:#000;text-decoration:none;font-weight:bold;padding:12px 26px;border-radius:8px;display:inline-block;">Install the extension</a></p>
<p style="font-size:13px;color:#777;border-top:1px solid #eee;padding-top:14px;margin:0;">Important: sign in with <strong>{safe_email}</strong>. Using a different email means SnapToAI will not be able to apply your {safe_name} license.</p>
</div></body></html>'''
    text_body = (
        f'Welcome to {name_for_subject} on SnapToAI\n\n'
        f'Your administrator has added you to {name_for_subject}. Your branded SnapToAI license is ready.\n\n'
        f'1. Install the SnapToAI Chrome extension:\n   {install_url}\n'
        f'2. Sign in with Google using THIS exact email: {email}\n'
        f'3. Your license unlocks automatically — no code needed.\n\n'
        f'Important: if you sign in with a different email, the {name_for_subject} license will not apply.\n'
    )
    return _send_html_email(email, subject, html_body, text_body)


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
    """Resolve institution membership for an email. Returns a tuple
    (institution_id, branding_dict, outcome) where outcome is one of:
      'matched_active'   — bound, branding included
      'member_inactive'  — explicit member row exists but is suspended
      'seat_limit'       — domain match found but the institution is full
      'none'             — no match
    """
    email = _norm_email(email)
    if not email or '@' not in email:
        return None, None, 'none'
    # Deterministic ordering: prefer an active member row in an active
    # institution over any suspended/removed/expired row. Without this,
    # Postgres can return a stale inactive row first when an email exists
    # in multiple institution_members rows (historical or moved-between-orgs).
    cur.execute("""
        SELECT m.institution_id, m.status, i.status, i.expires_at, i.slug, i.name, i.logo_url, i.brand_color, m.role, i.logo_url_light, m.expires_at
        FROM institution_members m JOIN institutions i ON i.id = m.institution_id
        WHERE LOWER(m.email) = %s
        ORDER BY
          CASE WHEN m.status='active' THEN 0 ELSE 1 END,
          CASE WHEN i.status='active' THEN 0 ELSE 1 END,
          CASE WHEN m.expires_at IS NULL OR m.expires_at > NOW() THEN 0 ELSE 1 END,
          m.joined_at DESC NULLS LAST
        LIMIT 1
    """, (email,))
    row = cur.fetchone()
    if row:
        member_expired = bool(row[10] and row[10] < datetime.now())
        if row[1] == 'active' and _institution_active((row[2], row[3])) and not member_expired:
            return row[0], {
                'institutionId': row[0], 'slug': row[4], 'name': row[5],
                'logoUrl': row[6], 'logoUrlLight': row[9],
                'brandColor': row[7] or '#00d9ff',
                'role': row[8] or 'member',
                'expiresAt': row[10].isoformat() if row[10] else None
            }, 'matched_active'
        return None, None, 'member_inactive'

    domain = _domain_of(email)
    if not domain or domain in PUBLIC_DOMAINS:
        return None, None, 'none'
    cur.execute("""
        SELECT id, slug, name, logo_url, brand_color, allowed_domains, status, expires_at, seat_limit, logo_url_light
        FROM institutions WHERE allowed_domains IS NOT NULL AND allowed_domains <> ''
    """)
    seat_full_match = False
    for r in cur.fetchall():
        inst_id, slug, name, logo_url, brand_color, allowed, status, expires_at, seat_limit, logo_url_light = r
        if not _institution_active((status, expires_at)):
            continue
        domains = [d.strip().lower() for d in (allowed or '').split(',') if d.strip()]
        if domain not in domains:
            continue
        if seat_limit and _seats_used(cur, inst_id) >= seat_limit:
            seat_full_match = True
            continue
        cur.execute("""
            INSERT INTO institution_members (institution_id, email, role, status, invited_by, joined_at)
            VALUES (%s, %s, 'member', 'active', 'domain-auto', NOW())
            ON CONFLICT (institution_id, email) DO UPDATE SET status='active'
        """, (inst_id, email))
        return inst_id, {
            'institutionId': inst_id, 'slug': slug, 'name': name,
            'logoUrl': logo_url, 'logoUrlLight': logo_url_light,
            'brandColor': brand_color or '#00d9ff',
            'role': 'member'
        }, 'matched_active'
    return (None, None, 'seat_limit') if seat_full_match else (None, None, 'none')

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
    """Return branding dict if this email is an active member of an active institution, else None.

    Task #27: includes key-policy metadata (`hasInstitutionKey`, `keyPolicy`,
    `billingBehavior`, `keyHint`) so the extension UI can hide/disable the BYOK
    field when the institution mandates its own key. Plaintext key is NEVER returned."""
    email = _norm_email(email)
    if not email:
        return None
    # Deterministic ordering: prefer an active row in an active institution
    # so a stale suspended/removed row never wins the lookup.
    cur.execute("""
        SELECT i.id, i.slug, i.name, i.logo_url, i.brand_color, i.status, i.expires_at,
               m.status, m.role, i.logo_url_light,
               i.gemini_key_encrypted, i.gemini_key_hint, i.key_policy, i.billing_behavior,
               m.expires_at
        FROM institution_members m JOIN institutions i ON i.id = m.institution_id
        WHERE LOWER(m.email) = %s
        ORDER BY
          CASE WHEN m.status='active' THEN 0 ELSE 1 END,
          CASE WHEN i.status='active' THEN 0 ELSE 1 END,
          CASE WHEN m.expires_at IS NULL OR m.expires_at > NOW() THEN 0 ELSE 1 END,
          m.joined_at DESC NULLS LAST
        LIMIT 1
    """, (email,))
    r = cur.fetchone()
    if not r:
        return None
    if r[7] != 'active':
        return None
    if not _institution_active((r[5], r[6])):
        return None
    # Per-member expiry — must be enforced on every entitlement path. Without
    # this an expired member keeps branding + the institution Gemini key.
    if r[14] and r[14] < datetime.now():
        return None
    print(f'🏛️  institution match: email={email} inst_id={r[0]} slug={r[1]} role={r[8]} key_policy={r[12]}')
    return {
        'institutionId': r[0],
        'slug': r[1],
        'name': r[2],
        'logoUrl': r[3],
        'logoUrlLight': r[9],
        'brandColor': r[4] or '#00d9ff',
        'role': r[8] or 'member',
        'hasInstitutionKey': bool(r[10]),
        'keyHint': r[11] or '',
        'keyPolicy': r[12] or 'prefer-user-key',
        'billingBehavior': r[13] or 'count-against-snaptoai-quota',
        'expiresAt': r[14].isoformat() if r[14] else None
    }


# ============================================
# Task #27 — Institution Gemini key encryption + resolution
# ============================================
# We use Fernet (AES-128-CBC + HMAC-SHA256) with a key derived via PBKDF2 from
# INSTITUTION_KEY_ENCRYPTION_SECRET (preferred) or GEMINI_OWNER_KEY (fallback).
# Plaintext keys are NEVER stored, NEVER logged, NEVER returned via any API.
# Rotating the encryption secret invalidates existing institution keys; admins
# would need to re-paste them. Document this in deploy notes.

_FERNET_INSTANCE = None

def _get_fernet():
    global _FERNET_INSTANCE
    if _FERNET_INSTANCE is not None:
        return _FERNET_INSTANCE
    secret = os.environ.get('INSTITUTION_KEY_ENCRYPTION_SECRET') or os.environ.get('GEMINI_OWNER_KEY') or ''
    if not secret:
        return None
    try:
        from cryptography.fernet import Fernet
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
        salt = b'snaptoai-institution-key-v1'
        kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=200_000)
        key_bytes = base64.urlsafe_b64encode(kdf.derive(secret.encode('utf-8')))
        _FERNET_INSTANCE = Fernet(key_bytes)
        return _FERNET_INSTANCE
    except Exception as e:
        print(f'⚠️ Fernet init failed: {e}')
        return None

def _encrypt_inst_key(plaintext):
    f = _get_fernet()
    if not f:
        raise RuntimeError('Encryption not configured: set INSTITUTION_KEY_ENCRYPTION_SECRET')
    return f.encrypt(plaintext.encode('utf-8')).decode('utf-8')

def _decrypt_inst_key(ciphertext):
    if not ciphertext:
        return None
    f = _get_fernet()
    if not f:
        return None
    try:
        from cryptography.fernet import InvalidToken
        return f.decrypt(ciphertext.encode('utf-8')).decode('utf-8')
    except Exception:
        return None

def _resolve_institution_key_for_email(cur, email):
    """Return (plaintext_key, policy, billing, inst_id, inst_name) for a member's
    institution, or None if no active institution / no key configured. Plaintext
    is materialized only inside this server process and only at call time."""
    email = _norm_email(email)
    if not email:
        return None
    cur.execute("""
        SELECT i.id, i.name, i.gemini_key_encrypted, i.key_policy, i.billing_behavior,
               i.status, i.expires_at, m.status, m.expires_at
        FROM institution_members m JOIN institutions i ON i.id = m.institution_id
        WHERE LOWER(m.email) = %s
        ORDER BY
          CASE WHEN m.status='active' THEN 0 ELSE 1 END,
          CASE WHEN i.status='active' THEN 0 ELSE 1 END,
          CASE WHEN m.expires_at IS NULL OR m.expires_at > NOW() THEN 0 ELSE 1 END,
          m.joined_at DESC NULLS LAST
        LIMIT 1
    """, (email,))
    r = cur.fetchone()
    if not r:
        return None
    if r[7] != 'active' or not _institution_active((r[5], r[6])):
        return None
    # Per-member expiry — must block key resolution too. Without this an
    # expired member would keep using the institution's Gemini key.
    if r[8] and r[8] < datetime.now():
        return None
    if not r[2]:
        # Institution exists but no key set — return tuple with None key so the
        # caller can still honor 'institution-only' policy by failing closed.
        return (None, r[3] or 'prefer-user-key', r[4] or 'count-against-snaptoai-quota', r[0], r[1])
    plaintext = _decrypt_inst_key(r[2])
    return (plaintext, r[3] or 'prefer-user-key', r[4] or 'count-against-snaptoai-quota', r[0], r[1])

def _test_gemini_key(api_key):
    """Lightweight connectivity check: list models. Returns (ok, message)."""
    if not api_key or len(api_key) < 10:
        return False, 'Key too short'
    try:
        resp = requests.get(
            f'https://generativelanguage.googleapis.com/v1beta/models?key={api_key}',
            timeout=10
        )
        if resp.status_code == 200:
            return True, 'Key is valid'
        try:
            err = resp.json().get('error', {}).get('message', '')
        except Exception:
            err = resp.text[:200]
        return False, err or f'HTTP {resp.status_code}'
    except Exception as e:
        return False, str(e)

def _is_invalid_key_error(err_text):
    """Detect Google API responses that indicate a bad/revoked key."""
    if not err_text:
        return False
    s = str(err_text).lower()
    return ('api key not valid' in s or 'api_key_invalid' in s or
            'invalid api key' in s or 'permission denied' in s and 'key' in s)

def _institution_by_slug(cur, slug):
    cur.execute("""
        SELECT id, slug, name, logo_url, brand_color, primary_admin_email, seat_limit,
               expires_at, status, allowed_domains, notes, created_at, branding_locked, logo_url_light,
               gemini_key_encrypted, gemini_key_hint, key_policy, billing_behavior,
               key_set_at, key_last_rotated_at, key_last_used_at
        FROM institutions WHERE slug=%s
    """, (slug,))
    return cur.fetchone()

def _is_branding_locked(cur, slug):
    """True iff super-admin has set branding_locked=TRUE for this institution."""
    cur.execute("SELECT COALESCE(branding_locked, FALSE) FROM institutions WHERE slug=%s", (slug,))
    r = cur.fetchone()
    return bool(r and r[0])

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
        WHERE institution_id=%s AND LOWER(email)=%s AND role='admin' AND status='active'
          AND (expires_at IS NULL OR expires_at > NOW())
        LIMIT 1
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
        # NOTE: `inviteCode` is intentionally ignored — invite links were retired
        # in favor of email-only institution onboarding. Members are bound to
        # their institution via the email allowlist (see `_resolve_institution_for_email`).

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

        # Institutions: bind to inst on first sign-in if pre-invited or domain match.
        # If a domain auto-join match was found but seats are full, surface a
        # deterministic 403 to the extension instead of silently onboarding.
        branding = None
        try:
            inst_id, branding_resolved, outcome = _resolve_institution_for_email(cur, email)
            if inst_id:
                _apply_institution_membership(cur, email, inst_id)
                branding = branding_resolved
            elif outcome == 'seat_limit':
                conn.commit(); cur.close(); conn.close()
                response = jsonify({
                    'success': False, 'userId': user_id,
                    'error': 'seat_limit',
                    'message': 'Your organization\'s seat license is full. Please ask your admin to free up a seat or expand the plan.',
                })
                response.headers['Access-Control-Allow-Origin'] = '*'
                return response, 403
        except Exception as inst_err:
            print(f'⚠️ institution resolve error: {inst_err}')

        conn.commit()
        cur.close()
        conn.close()

        payload = {'success': True, 'userId': user_id}
        if branding:
            payload['branding'] = branding
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
        h1 {{ color: #00d9ff; margin-bottom: 5px; }}
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
        .filters button {{ background: #00d9ff; color: #000; border: none; padding: 8px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; }}
        .filters button:hover {{ background: #00b8d4; }}
        table {{ width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; }}
        th {{ background: #16213e; color: #00d9ff; padding: 12px 8px; text-align: left; position: sticky; top: 0; }}
        td {{ padding: 10px 8px; border-bottom: 1px solid #222; }}
        tr:hover {{ background: #1a1a2e; }}
        .badge {{ padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }}
        .badge-active {{ background: #00ff8820; color: #00ff88; }}
        .badge-expired {{ background: #ff475720; color: #ff4757; }}
        .badge-paid {{ background: #ffd70020; color: #ffd700; }}
        .usage-bar {{ background: #333; border-radius: 4px; height: 6px; width: 60px; display: inline-block; }}
        .usage-fill {{ background: #00d9ff; height: 100%; border-radius: 4px; }}
        .hash {{ font-family: monospace; font-size: 12px; color: #888; }}
        .export-btn {{ background: #333; color: #fff; border: none; padding: 8px 15px; border-radius: 6px; cursor: pointer; margin-left: auto; }}
    </style>
</head>
<body>
    <h1>📊 SnapToAI Admin Dashboard</h1>
    <p class="subtitle">Real-time user analytics and trial management</p>
    
    <div class="stats">
        <div class="stat-box">
            <div class="stat-number" style="color: #00d9ff;">{total_users}</div>
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
            <td style="font-size: 11px;"><span style="color: #00d9ff;">{location_str}</span><br><span style="color:#a855f7;font-size:10px;">{r['ip']}</span><br><span style="color:#666;font-size:10px;">{r['timezone']}</span></td>
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
    <div style="background: linear-gradient(135deg, rgba(0, 217, 255, 0.15), rgba(0, 184, 212, 0.08)); border: 1px solid rgba(0, 217, 255, 0.3); border-radius: 12px; padding: 20px; margin: 30px 0;">
        <h2 style="color: #00d9ff; margin: 0 0 5px 0;">👥 Registered Users</h2>
        <p style="color: #888; font-size: 12px; margin: 0 0 15px 0;">Users who signed in with Google — {len(registered_users_rows)} total</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
                <th style="background: #16213e; color: #00d9ff; padding: 12px 8px; text-align: left;">#</th>
                <th style="background: #16213e; color: #00d9ff; padding: 12px 8px; text-align: left;">Photo</th>
                <th style="background: #16213e; color: #00d9ff; padding: 12px 8px; text-align: left;">Name</th>
                <th style="background: #16213e; color: #00d9ff; padding: 12px 8px; text-align: left;">Email</th>
                <th style="background: #16213e; color: #00d9ff; padding: 12px 8px; text-align: left;">Captures</th>
                <th style="background: #16213e; color: #00d9ff; padding: 12px 8px; text-align: left;">First Seen</th>
                <th style="background: #16213e; color: #00d9ff; padding: 12px 8px; text-align: left;">Last Seen</th>
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
                <input id="inst-seats" type="number" min="0" value="50" placeholder="Seat limit (0 = unlimited)" title="Set to 0 (or check Unlimited) for an unlimited seat license" style="background: #0f0f1a; border: 1px solid #333; color: #fff; padding: 8px 12px; border-radius: 6px;">
                <label style="color:#888; font-size: 12px; margin-left: 4px;"><input id="inst-seats-unlimited" type="checkbox" onchange="document.getElementById('inst-seats').disabled=this.checked; if(this.checked) document.getElementById('inst-seats').value='';"> Unlimited</label>
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
            '<td style="padding: 8px;">' + inst.seatsUsed + ' / ' + (inst.seatLimit == null ? '∞' : inst.seatLimit) + '</td>' +
            '<td style="padding: 8px;"><span style="padding: 3px 8px; border-radius: 4px; font-size: 11px; background: ' + (inst.status === 'active' ? '#00ff8820' : '#ff475720') + '; color: ' + (inst.status === 'active' ? '#00ff88' : '#ff4757') + ';">' + inst.status + '</span></td>' +
            '<td style="padding: 8px; color:#ccc; font-size: 12px;">' + (inst.expiresAt ? new Date(inst.expiresAt).toLocaleDateString() : 'never') + '</td>' +
            '<td style="padding: 8px;">' +
              '<button onclick="copyAdminLink(\\'' + inst.slug + '\\')" style="background: #06b6d4; color: #000; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; margin-right: 4px;" title="Copy admin URL (admin signs in with Google)">📋 Admin URL</button>' +
              '<a href="/institution/' + inst.slug + '/admin?password=' + encodeURIComponent(ADMIN_PW) + '" target="_blank" style="background: #a855f7; color: #fff; padding: 5px 10px; border-radius: 4px; text-decoration: none; font-size: 11px; margin-right: 4px;" title="One-click entry as super-admin (no Google sign-in required)">→ Enter admin dashboard</a>' +
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
      const unlimited = document.getElementById('inst-seats-unlimited').checked;
      const rawSeats = document.getElementById('inst-seats').value;
      let seatLimit;
      if (unlimited || rawSeats === '' || rawSeats === '0') {
        seatLimit = 0;
      } else {
        const parsed = parseInt(rawSeats, 10);
        seatLimit = Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
      }
      const body = {
        name: document.getElementById('inst-name').value,
        slug: document.getElementById('inst-slug').value,
        primaryAdminEmail: document.getElementById('inst-admin').value,
        seatLimit: seatLimit,
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
      const url = window.location.origin + '/institution/' + slug + '/admin';
      navigator.clipboard.writeText(url).then(() => alert('Admin URL copied to clipboard:\\n\\n' + url + '\\n\\nThe primary-admin email signs in with Google to access the dashboard.'));
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
    """Authenticated branding fetch — returns the caller's institution branding only.
    Requires a Bearer Google token; the email being looked up MUST match the verified
    identity. This prevents arbitrary email enumeration of institution membership."""
    if request.method == 'OPTIONS':
        return _options('GET, POST, OPTIONS')
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    verified_email = get_verified_email(request)
    if not verified_email:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        requested = _norm_email(data.get('email', '')) or verified_email
    else:
        requested = _norm_email(request.args.get('email', '')) or verified_email
    if requested != verified_email:
        return _cors(jsonify({'success': False, 'error': 'Forbidden'})), 403
    try:
        conn = get_db(); cur = conn.cursor()
        b = _get_institution_branding_for_email(cur, verified_email)
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

        # ---------------------------------------------------------------
        # Institution entitlement (centralized).
        # Order:
        #   1. Active member of active institution  → subscribed (with branding)
        #   2. Domain auto-bind matches a fresh new institution → subscribed
        #   3. Has ANY institution membership/FK but check (1) failed
        #      (institution suspended/expired, or member suspended/removed)
        #      → institution_expired (with the former branding so the extension
        #        can show "{Institution} license ended"). Cleans up FK + sub row.
        # ---------------------------------------------------------------
        inst_branding = None
        try:
            inst_branding = _get_institution_branding_for_email(cur, email)
            if not inst_branding:
                # 2. Fresh visitor: maybe their domain matches an active institution
                inst_id_new, branding_new, _outcome_new = _resolve_institution_for_email(cur, email)
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

        # 3. No active branding. Detect ANY former institution affiliation
        #    (member row in any state, OR users.institution_id still set, OR
        #    a stale subscriptions row pointing at an institution plan). This
        #    catches every suspension path:
        #      - super-admin suspends institution (i.status='suspended')
        #      - super-admin sets expires_at in past
        #      - inst-admin suspends/removes member (m.status='suspended'/'removed')
        #      - admin update flips subscriptions.status='inactive'
        former_branding = None
        try:
            # Prefer member row (works even after FK was nulled).
            cur.execute("""
                SELECT i.name, i.brand_color, i.logo_url, i.slug, i.logo_url_light
                FROM institution_members m JOIN institutions i ON i.id = m.institution_id
                WHERE LOWER(m.email) = %s
                ORDER BY m.joined_at DESC NULLS LAST
                LIMIT 1
            """, (email,))
            fb = cur.fetchone()
            if not fb:
                # Maybe member row was hard-deleted; fall back to users FK.
                cur.execute("""
                    SELECT i.name, i.brand_color, i.logo_url, i.slug, i.logo_url_light
                    FROM users u JOIN institutions i ON i.id = u.institution_id
                    WHERE LOWER(u.email)=%s
                """, (email,))
                fb = cur.fetchone()
            if not fb:
                # Maybe even the FK is gone but the subscriptions row still
                # marks them as a former institution user.
                cur.execute("""
                    SELECT plan_type FROM subscriptions
                    WHERE email=%s AND plan_type IN ('institution','institution_expired')
                """, (email,))
                if cur.fetchone():
                    fb = ('Your institution', '#00d9ff', None, None, None)
            if fb:
                former_branding = {
                    'name': fb[0],
                    'brandColor': fb[1] or '#00d9ff',
                    'logoUrl': fb[2],
                    'logoUrlLight': fb[4] if len(fb) > 4 else None,
                    'slug': fb[3],
                }
        except Exception as fb_err:
            print(f'⚠️ former-branding lookup error: {fb_err}')
            former_branding = None

        if former_branding:
            # If the user also has an active personal paid sub, that takes
            # precedence — fall through to the normal subscription path below.
            cur.execute("SELECT plan_type, status, subscription_end FROM subscriptions WHERE email=%s", (email,))
            _sr = cur.fetchone()
            has_personal_active = bool(
                _sr and _sr[0] in ('monthly', 'yearly') and (
                    _sr[1] == 'active' or
                    (_sr[1] == 'canceled' and _sr[2] and _sr[2] > datetime.utcnow())
                )
            )
            if not has_personal_active and _check_whop_api_for_email(email):
                has_personal_active = True

            if not has_personal_active:
                cur.execute("""
                    UPDATE subscriptions
                    SET status='expired', plan_type='institution_expired', updated_at=NOW()
                    WHERE email=%s AND plan_type IN ('institution','institution_expired')
                """, (email,))
                cur.execute("UPDATE users SET institution_id=NULL WHERE LOWER(email)=%s", (email,))
                conn.commit()
                cur.close(); conn.close()
                response = jsonify({
                    'success': True, 'canUseAI': False, 'status': 'institution_expired',
                    'planType': None, 'daysRemaining': 0,
                    'institutionName': former_branding.get('name'),
                    'branding': former_branding,
                })
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

    if not GEMINI_OWNER_KEY:
        # Owner key missing is OK *only* if this caller's institution provides
        # one — checked further down. We can't know yet, so defer the 503 until
        # after institution lookup.
        pass

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

        # ---------- Task #27: institution-key resolution ----------
        # Decide which Gemini key the proxy will use, and whether this call
        # should count against the SnapToAI free-prompt meter.
        # SECURITY: when an institution would be involved, the caller must
        # prove ownership of the email via a Google OAuth token — otherwise
        # any client could spoof an institution member's email to consume the
        # institution's key/quota.
        inst_resolution = None
        if '@' in identifier:
            try:
                inst_resolution = _resolve_institution_key_for_email(cur, identifier)
            except Exception as ire:
                print(f'⚠️ inst key resolve error: {ire}')
                inst_resolution = None

        if inst_resolution:
            supplied_token = (str(data.get('accessToken') or data.get('idToken') or '')).strip()
            verified_email = verify_google_token(supplied_token) if supplied_token else None
            if not verified_email or verified_email.lower() != identifier.lower():
                r = jsonify({
                    'error': 'institution_key_invalid',
                    'message': 'Sign-in required to use your institution\'s AI key. Please re-authenticate in the extension.',
                    'remaining': 0
                })
                r.headers['Access-Control-Allow-Origin'] = '*'
                return r, 401

        inst_key_plain = None
        inst_policy = 'prefer-user-key'
        inst_billing = 'count-against-snaptoai-quota'
        inst_id_for_audit = None
        inst_name_for_err = None
        if inst_resolution:
            inst_key_plain, inst_policy, inst_billing, inst_id_for_audit, inst_name_for_err = inst_resolution

        # institution-only policy with no usable key → fail closed (no fallback).
        if inst_resolution and inst_policy == 'institution-only' and not inst_key_plain:
            r = jsonify({
                'error': 'institution_key_invalid',
                'message': f'Your organization ({inst_name_for_err}) requires its own AI key, but it is not configured. Contact your institution admin.',
                'remaining': 0
            })
            r.headers['Access-Control-Allow-Origin'] = '*'
            return r, 502

        # Pick the active key. Per task scope, BYOK is client-side only — the
        # proxy never receives a user's personal key — so when policy permits
        # either, we use the institution key if present; otherwise fall back to
        # the SnapToAI owner key. (prefer-user-key just means the *client*
        # routes BYOK calls direct; if the client falls through to the proxy,
        # use whatever the institution provides, else owner key.)
        active_key = inst_key_plain or GEMINI_OWNER_KEY
        used_institution_key = bool(inst_key_plain)

        if not active_key:
            r = jsonify({'error': 'AI proxy not configured', 'remaining': 0})
            r.headers['Access-Control-Allow-Origin'] = '*'
            return r, 503

        # Skip SnapToAI metering when the institution explicitly bypasses it.
        skip_meter = used_institution_key and inst_billing == 'bypass-snaptoai-quota'

        if skip_meter:
            usage_count = 0  # for response-shape compatibility
        else:
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
            f'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={active_key}',
            json=gemini_body,
            timeout=30
        )
        gemini_data = gemini_resp.json()

        if 'error' in gemini_data:
            err = gemini_data['error'].get('message', 'AI error')
            err_lower = err.lower()
            # When the *institution* key is the one that failed authentication,
            # surface a distinct error code so the extension can point the
            # member at their admin instead of suggesting BYOK or retry.
            if used_institution_key and _is_invalid_key_error(err):
                r = jsonify({
                    'error': 'institution_key_invalid',
                    'message': f'Your organization ({inst_name_for_err})\'s AI key was rejected by Google. Contact your institution admin.',
                    'remaining': 0
                })
                r.headers['Access-Control-Allow-Origin'] = '*'
                return r, 502
            if 'quota' in err_lower or 'exhausted' in err_lower or 'rate' in err_lower:
                r = jsonify({'error': 'busy', 'message': 'Our free AI is busy right now. Please try again in a minute!', 'remaining': max(0, FREE_PROMPT_LIMIT - usage_count)})
            else:
                r = jsonify({'error': err, 'remaining': max(0, FREE_PROMPT_LIMIT - usage_count)})
            r.headers['Access-Control-Allow-Origin'] = '*'
            return r, 502

        if not skip_meter:
            cur.execute('''
                UPDATE free_prompts SET usage_count = usage_count + 1, last_used = NOW()
                WHERE identifier = %s
            ''', (identifier,))
            conn.commit()
            new_count = usage_count + 1
            remaining = FREE_PROMPT_LIMIT - new_count
        else:
            new_count = 0
            remaining = FREE_PROMPT_LIMIT  # bypass — no metering applied

        # Audit: record successful institution-key use.
        if used_institution_key and inst_id_for_audit:
            try:
                cur.execute("UPDATE institutions SET key_last_used_at=NOW() WHERE id=%s", (inst_id_for_audit,))
                conn.commit()
            except Exception:
                pass

        ai_text = ''
        if gemini_data.get('candidates') and gemini_data['candidates'][0].get('content', {}).get('parts'):
            ai_text = gemini_data['candidates'][0]['content']['parts'][0].get('text', '')

        r = jsonify({
            'response': ai_text,
            'remaining': remaining,
            'used': new_count,
            'limit': FREE_PROMPT_LIMIT,
            'usedInstitutionKey': used_institution_key,
            'metered': not skip_meter
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
       primary_admin_email, seat_limit, expires_at, status, allowed_domains, notes,
       created_at, branding_locked, logo_url_light)."""
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
        'brandingLocked': bool(row[12]) if len(row) > 12 else False,
        'logoUrlLight': row[13] if len(row) > 13 else None,
        'adminToken': admin_token,
        # Task #27 — institution-shared Gemini key admin metadata.
        # NEVER expose plaintext / ciphertext. Only hint + flags + audit timestamps.
        'hasGeminiKey': bool(row[14]) if len(row) > 14 else False,
        'geminiKeyHint': (row[15] if len(row) > 15 else None) or '',
        'keyPolicy': (row[16] if len(row) > 16 else None) or 'prefer-user-key',
        'billingBehavior': (row[17] if len(row) > 17 else None) or 'count-against-snaptoai-quota',
        'keySetAt': row[18].isoformat() if (len(row) > 18 and row[18]) else None,
        'keyLastRotatedAt': row[19].isoformat() if (len(row) > 19 and row[19]) else None,
        'keyLastUsedAt': row[20].isoformat() if (len(row) > 20 and row[20]) else None,
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
    # seatLimit: None / "" / 0 / "unlimited" → NULL (unlimited).
    raw_seats = data.get('seatLimit', 50)
    if raw_seats in (None, '', 0, '0', 'unlimited'):
        seat_limit = None
    else:
        try:
            sl = int(raw_seats)
            seat_limit = None if sl <= 0 else sl
        except (TypeError, ValueError):
            seat_limit = 50
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
                   expires_at, status, allowed_domains, notes, created_at, branding_locked, logo_url_light
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
        raw_seats = data['seatLimit']
        if raw_seats in (None, '', 0, '0', 'unlimited'):
            fields.append('seat_limit=%s'); values.append(None)
        else:
            try:
                sl = int(raw_seats)
                fields.append('seat_limit=%s'); values.append(None if sl <= 0 else sl)
            except (TypeError, ValueError):
                fields.append('seat_limit=%s'); values.append(50)
    if 'allowedDomains' in data:
        fields.append('allowed_domains=%s'); values.append(str(data['allowedDomains'] or '')[:500] or None)
    if 'notes' in data:
        fields.append('notes=%s'); values.append(str(data['notes'] or '')[:1000] or None)
    if 'status' in data and data['status'] in ('active', 'suspended', 'expired'):
        fields.append('status=%s'); values.append(data['status'])
    if 'brandingLocked' in data:
        fields.append('branding_locked=%s'); values.append(bool(data['brandingLocked']))
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

@app.route('/api/admin/institutions', methods=['GET', 'POST', 'OPTIONS'])
def api_admin_institutions_root():
    """GET → list, POST → create."""
    if request.method == 'OPTIONS':
        return _options('GET, POST, OPTIONS')
    if request.method == 'GET':
        return api_admin_inst_list()
    return api_admin_inst_create()

@app.route('/api/admin/institutions/<int:inst_id>', methods=['PATCH', 'OPTIONS'])
def api_admin_inst_patch(inst_id):
    """PATCH alias of POST /<id>/update."""
    if request.method == 'OPTIONS':
        return _options('PATCH, DELETE, OPTIONS')
    return api_admin_inst_update(inst_id)

@app.route('/api/admin/institutions/<int:inst_id>/suspend', methods=['POST', 'OPTIONS'])
def api_admin_inst_suspend(inst_id):
    """Suspend an institution and deactivate member institution-plan subs."""
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    if not _require_super_admin():
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("UPDATE institutions SET status='suspended', updated_at=NOW() WHERE id=%s", (inst_id,))
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
        print(f'❌ inst suspend: {e}')
        return _cors(jsonify({'success': False, 'error': str(e)})), 500

@app.route('/api/admin/institutions/<int:inst_id>/members', methods=['GET', 'OPTIONS'])
def api_admin_inst_members(inst_id):
    """List members of one institution (super-admin)."""
    if request.method == 'OPTIONS':
        return _options('GET, OPTIONS')
    if not _require_super_admin():
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("SELECT slug, name FROM institutions WHERE id=%s", (inst_id,))
        ir = cur.fetchone()
        if not ir:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Institution not found'})), 404
        cur.execute("""
            SELECT email, role, status, invited_by, joined_at, last_seen
            FROM institution_members
            WHERE institution_id=%s
            ORDER BY joined_at DESC
        """, (inst_id,))
        members = [{
            'email': r[0],
            'role': r[1],
            'status': r[2],
            'invitedBy': r[3],
            'joinedAt': r[4].isoformat() if r[4] else None,
            'lastSeen': r[5].isoformat() if r[5] else None,
        } for r in cur.fetchall()]
        cur.close(); conn.close()
        return _cors(jsonify({
            'success': True,
            'institution': {'id': inst_id, 'slug': ir[0], 'name': ir[1]},
            'members': members,
            'total': len(members),
        }))
    except Exception as e:
        print(f'❌ inst members (super-admin): {e}')
        return _cors(jsonify({'success': False, 'error': str(e)})), 500

def _logo_variant_meta(req):
    """Resolve which logo column/file-suffix this request targets.
    Returns (column_name, filename_suffix, response_key)."""
    raw = (req.form.get('variant') if req.form else None) or req.args.get('variant') or ''
    if str(raw).strip().lower() == 'light':
        return 'logo_url_light', '-light', 'logoUrlLight'
    return 'logo_url', '', 'logoUrl'

@app.route('/api/admin/institutions/<int:inst_id>/logo', methods=['POST', 'DELETE', 'OPTIONS'])
def api_admin_inst_logo(inst_id):
    if request.method == 'OPTIONS':
        return _options('POST, DELETE, OPTIONS')
    if not _require_super_admin():
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    column, suffix, resp_key = _logo_variant_meta(request)
    try:
        os.makedirs(INSTITUTION_LOGO_DIR, exist_ok=True)
        conn = get_db(); cur = conn.cursor()
        cur.execute("SELECT slug FROM institutions WHERE id=%s", (inst_id,))
        r = cur.fetchone()
        if not r:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Institution not found'})), 404
        slug = r[0]
        # DELETE clears just this variant.
        if request.method == 'DELETE':
            for old in os.listdir(INSTITUTION_LOGO_DIR):
                base, _, _e = old.rpartition('.')
                if suffix:
                    if old.startswith(slug + suffix + '.'):
                        try: os.remove(os.path.join(INSTITUTION_LOGO_DIR, old))
                        except Exception: pass
                else:
                    if base == slug:
                        try: os.remove(os.path.join(INSTITUTION_LOGO_DIR, old))
                        except Exception: pass
            cur.execute(f"UPDATE institutions SET {column}=NULL, updated_at=NOW() WHERE id=%s", (inst_id,))
            conn.commit()
            cur.close(); conn.close()
            return _cors(jsonify({'success': True, resp_key: None}))
        f = request.files.get('logo')
        if not f or not f.filename:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'No file uploaded (field name: logo)'})), 400
        ext = ''
        if '.' in f.filename:
            ext = '.' + f.filename.rsplit('.', 1)[1].lower()
        if ext not in ALLOWED_LOGO_EXTS:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': f'Unsupported extension {ext}. Allowed: {sorted(ALLOWED_LOGO_EXTS)}'})), 400
        # Server-side size cap (2 MB) — read into memory once, validate, then write
        blob = f.read(2 * 1024 * 1024 + 1)
        if not blob:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Empty file'})), 400
        if len(blob) > 2 * 1024 * 1024:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Logo too large (max 2 MB)'})), 400
        # Magic-byte sniff: must match the claimed extension family
        head = blob[:12]
        is_png = head.startswith(b'\x89PNG\r\n\x1a\n')
        is_jpg = head.startswith(b'\xff\xd8\xff')
        is_webp = head[:4] == b'RIFF' and head[8:12] == b'WEBP'
        is_svg = b'<svg' in blob[:512].lower() or blob.lstrip()[:5].lower().startswith(b'<?xml')
        valid_for_ext = (
            (ext == '.png' and is_png) or
            (ext in ('.jpg', '.jpeg') and is_jpg) or
            (ext == '.webp' and is_webp) or
            (ext == '.svg' and is_svg)
        )
        if not valid_for_ext:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': f'File contents do not match extension {ext}'})), 400
        # Remove old files of THIS variant only — don't clobber the other variant.
        for old in os.listdir(INSTITUTION_LOGO_DIR):
            base, _, _e = old.rpartition('.')
            if suffix:
                if old.startswith(slug + suffix + '.'):
                    try: os.remove(os.path.join(INSTITUTION_LOGO_DIR, old))
                    except Exception: pass
            else:
                if base == slug:
                    try: os.remove(os.path.join(INSTITUTION_LOGO_DIR, old))
                    except Exception: pass
        target = os.path.join(INSTITUTION_LOGO_DIR, slug + suffix + ext)
        with open(target, 'wb') as out:
            out.write(blob)
        # cache-bust the URL so updates propagate immediately to extensions
        logo_url = f'/static/institution-logos/{slug}{suffix}{ext}?v={int(time.time())}'
        cur.execute(f"UPDATE institutions SET {column}=%s, updated_at=NOW() WHERE id=%s", (logo_url, inst_id))
        conn.commit()
        cur.close(); conn.close()
        return _cors(jsonify({'success': True, resp_key: logo_url}))
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


@app.route('/api/institution/<slug>/admin-logout', methods=['POST', 'OPTIONS'])
def api_inst_admin_logout(slug):
    """Clear the inst-admin session cookie for this slug. Idempotent — safe to
    call even when no cookie is set; always returns success so the dashboard
    can redirect to the sign-in gate."""
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    resp = _cors(jsonify({'success': True, 'redirect': f'/institution/{slug}/admin'}))
    resp.delete_cookie(INST_ADMIN_COOKIE_PREFIX + slug, samesite='Lax')
    return resp


@app.route('/api/institution/<slug>/admin-magic-link', methods=['POST', 'OPTIONS'])
def api_inst_admin_magic_link_request(slug):
    """Email a one-time sign-in link to an authorized institution admin.
    Verifies the email is an admin for this slug (`_is_inst_admin`); if not,
    returns the same generic success message to avoid leaking which emails
    are admins. Sends a short-lived (15 min) signed link via SMTP."""
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    data = request.get_json(silent=True) or {}
    email = _norm_email(data.get('email', ''))
    generic_ok = ('If that email is an admin for this institution, '
                  'a sign-in link is on its way (check spam too). The link expires in 15 minutes.')
    if not email or '@' not in email:
        return _cors(jsonify({'success': False, 'error': 'Enter a valid email address.'})), 400
    try:
        conn = get_db(); cur = conn.cursor()
        is_admin = _is_inst_admin(cur, slug, email)
        row = _institution_by_slug(cur, slug)
        cur.close(); conn.close()
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500
    if not row:
        return _cors(jsonify({'success': False, 'error': 'Institution not found'})), 404
    if not is_admin:
        # Don't reveal admin membership; same generic message as success.
        return _cors(jsonify({'success': True, 'message': generic_ok}))
    inst_name = row[2]
    exp_ts = int(time.time()) + _MAGIC_LINK_TTL_SECONDS
    token = _gen_magic_link_token(slug, email, exp_ts)
    # Build the magic-link base from a trusted, configured value (APP_BASE_URL)
    # to defeat host-header poisoning attacks against bearer-token URLs.
    # Only fall back to request.host_url when APP_BASE_URL is not set.
    base = (os.environ.get('APP_BASE_URL', '').strip() or (request.host_url or '')).rstrip('/')
    link = (f"{base}/institution/{slug}/admin/magic-login?"
            f"email={urllib.parse.quote(email)}&exp={exp_ts}&token={token}")
    body = (
        f"Hi,\n\n"
        f"You requested a sign-in link for the {inst_name} admin dashboard on SnapToAI.\n\n"
        f"Click this link to sign in (valid for 15 minutes, one-time use):\n\n"
        f"{link}\n\n"
        f"If you didn't request this, you can ignore this email — your account is safe.\n"
    )
    sent, err = _send_inst_admin_email(email,
                                       f"{inst_name} — your SnapToAI admin sign-in link",
                                       body)
    if not sent:
        return _cors(jsonify({'success': False, 'error': err or 'Could not send email.'})), 503
    return _cors(jsonify({'success': True, 'message': generic_ok}))


@app.route('/institution/<slug>/admin/magic-login', methods=['GET'])
def institution_admin_magic_login(slug):
    """Verify a magic-link token and, if valid, set the inst-admin session
    cookie and redirect to the dashboard. Re-checks `_is_inst_admin` so a
    revoked admin can't reuse an old link before it expires."""
    if not ensure_db():
        return Response("Database not available", status=503)
    email = _norm_email(request.args.get('email', ''))
    exp_raw = request.args.get('exp', '')
    token = (request.args.get('token') or '').strip()
    ok, err = _verify_magic_link_token(slug, email, exp_raw, token)
    def _fail(msg, status=400):
        body = (f"<!DOCTYPE html><html><head><meta charset='UTF-8'>"
                f"<title>Sign-in link problem</title>"
                f"<style>body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"
                f"background:#0f0f1a;color:#fff;min-height:100vh;margin:0;display:flex;align-items:center;"
                f"justify-content:center;padding:24px;}}.card{{max-width:440px;background:rgba(255,255,255,0.04);"
                f"border:1px solid #ff475755;border-radius:18px;padding:36px;text-align:center;}}"
                f"a{{color:#00d9ff;}}</style></head><body><div class='card'>"
                f"<h2 style='color:#ff4757;margin-top:0;'>Sign-in link problem</h2>"
                f"<p>{html_escape_module.escape(msg)}</p>"
                f"<p><a href='/institution/{html_escape_module.escape(slug)}/admin'>Back to sign-in</a></p>"
                f"</div></body></html>")
        return Response(body, mimetype='text/html', status=status)
    if not ok:
        return _fail(err or 'This sign-in link is invalid.', status=400)
    try:
        conn = get_db(); cur = conn.cursor()
        is_admin = _is_inst_admin(cur, slug, email)
        cur.close(); conn.close()
    except Exception as e:
        return _fail(f'Server error: {e}', status=500)
    if not is_admin:
        return _fail('This email is no longer an admin for this institution.', status=403)
    resp = redirect(f'/institution/{slug}/admin')
    cookie_value = f"{email}|{_gen_admin_token(slug, email)}"
    resp.set_cookie(INST_ADMIN_COOKIE_PREFIX + slug, cookie_value,
                    httponly=True, samesite='Lax', max_age=86400 * 30)
    return resp


@app.route('/institution/<slug>/admin', methods=['GET'])
def institution_admin_page(slug):
    if not ensure_db():
        return Response("Database not available", status=503)
    ok, admin_email = _verify_inst_admin(slug)
    # Super-admin one-click entry: when the caller is the super-admin but has
    # no inst-admin cookie yet, identify them as the institution's primary
    # admin email and drop the inst-admin session cookie below.
    if ok and not admin_email and _require_super_admin():
        try:
            conn = get_db(); cur = conn.cursor()
            r0 = _institution_by_slug(cur, slug)
            cur.close(); conn.close()
            if r0 and r0[5]:
                admin_email = _norm_email(r0[5])
        except Exception:
            pass
    if not ok:
        # Render a sign-in gate offering BOTH Google Sign-In and an emailed
        # one-time link, so admins are not dead-ended when Google is
        # misconfigured or refuses their email.
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
        client_id = GOOGLE_CLIENT_ID or ''
        has_google = bool(client_id)
        google_block = ('<div id="g-btn"></div>'
                        '<div class="hint" id="g-empty" style="display:none;">'
                        'Google Sign-In is not configured for this server. '
                        'Use the email sign-in link below instead.</div>') if has_google else (
                        '<div class="hint">Google Sign-In is not configured for this server. '
                        'Use the email sign-in link below to access the dashboard.</div>')
        gate = f'''<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>{inst_name} — Admin Sign-In</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://accounts.google.com/gsi/client" async defer></script>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f1a; color: #fff; min-height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center; padding: 24px; }}
  .card {{ max-width: 460px; width: 100%; background: rgba(255,255,255,0.04); border: 1px solid {inst_color}55; border-radius: 18px; padding: 36px; text-align: center; }}
  h1 {{ color: {inst_color}; margin: 0 0 8px 0; font-size: 22px; }}
  p {{ color: #ccc; line-height: 1.5; font-size: 14px; }}
  #g-btn {{ display: flex; justify-content: center; margin: 20px 0 4px; }}
  .divider {{ display: flex; align-items: center; gap: 10px; color: #666; font-size: 11px; margin: 18px 0 14px; text-transform: uppercase; letter-spacing: 0.08em; }}
  .divider::before, .divider::after {{ content: ''; flex: 1; height: 1px; background: #333; }}
  .ml-form {{ display: flex; flex-direction: column; gap: 10px; text-align: left; }}
  .ml-form label {{ font-size: 12px; color: #aaa; }}
  .ml-form input {{ background: #0f0f1a; border: 1px solid #333; color: #fff; padding: 10px 12px; border-radius: 8px; font-size: 14px; }}
  .ml-form button {{ background: {inst_color}; color: #000; border: none; padding: 10px 14px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 14px; }}
  .ml-form button[disabled] {{ opacity: 0.6; cursor: progress; }}
  .hint {{ color: #888; font-size: 12px; margin-top: 8px; line-height: 1.45; }}
  .err {{ color: #ff4757; font-size: 13px; margin-top: 12px; min-height: 18px; }}
  .ok {{ color: #00ff88; font-size: 13px; margin-top: 12px; min-height: 18px; }}
</style></head>
<body><div class="card">
  <h1>{inst_name}</h1>
  <p>Sign in as an <strong>institution admin</strong> to manage members, invites, and branding. Choose either option below.</p>
  {google_block}
  <div class="divider">or</div>
  <form class="ml-form" onsubmit="event.preventDefault(); requestMagic();">
    <label for="ml-email">Email me a one-time sign-in link</label>
    <input id="ml-email" type="email" placeholder="admin@yourschool.edu" autocomplete="email" required>
    <button type="submit" id="ml-btn">Email me a sign-in link</button>
    <div class="hint">We'll send a single-use link valid for 15 minutes. Only authorized admin emails for this institution can request it.</div>
  </form>
  <div class="ok" id="ok"></div>
  <div class="err" id="err"></div>
</div>
<script>
const SLUG = {json.dumps(slug)};
const HAS_GOOGLE = {json.dumps(has_google)};
const GOOGLE_CLIENT_ID = {json.dumps(client_id)};
function onGoogle(resp) {{
  fetch('/api/institution/' + SLUG + '/admin-login', {{
    method: 'POST', headers: {{'Content-Type':'application/json'}},
    body: JSON.stringify({{idToken: resp.credential}})
  }}).then(r => r.json()).then(d => {{
    if (d.success) location.reload();
    else document.getElementById('err').textContent = d.error || 'Sign-in failed';
  }}).catch(e => document.getElementById('err').textContent = String(e));
}}
async function requestMagic() {{
  const email = (document.getElementById('ml-email').value || '').trim();
  const okEl = document.getElementById('ok');
  const errEl = document.getElementById('err');
  const btn = document.getElementById('ml-btn');
  okEl.textContent = ''; errEl.textContent = '';
  if (!email) {{ errEl.textContent = 'Enter your admin email.'; return; }}
  btn.disabled = true;
  try {{
    const r = await fetch('/api/institution/' + SLUG + '/admin-magic-link', {{
      method: 'POST', headers: {{'Content-Type':'application/json'}},
      body: JSON.stringify({{email}})
    }});
    const d = await r.json();
    if (d.success) okEl.textContent = d.message || 'Check your email for a sign-in link.';
    else errEl.textContent = d.error || 'Could not send sign-in link.';
  }} catch (e) {{
    errEl.textContent = String(e);
  }} finally {{ btn.disabled = false; }}
}}
window.addEventListener('load', () => {{
  if (!HAS_GOOGLE) return;
  if (!window.google) {{
    const el = document.getElementById('g-empty');
    if (el) {{ el.style.display = 'block'; el.textContent = 'Google Sign-In could not load. Use the email sign-in link below instead.'; }}
    return;
  }}
  google.accounts.id.initialize({{ client_id: GOOGLE_CLIENT_ID, callback: onGoogle }});
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
    seat_limit_display = '∞' if seat_limit in (None, 0) else seat_limit
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
  /* Shared design-system tokens (mirror of flow-premium/theme.css) so this
     server-rendered surface uses the same vocabulary as the extension. */
  :root {{
    --st-accent: {brand_color};
    --st-bg-app: #0f0f1a;
    --st-bg-surface: #1a1a2e;
    --st-bg-elevated: #16213e;
    --st-border-default: #2a2a4a;
    --st-text-secondary: #888;
    --st-radius-sm: 6px;
    --st-radius-md: 8px;
    --st-radius-lg: 12px;
    --st-focus-ring: 0 0 0 3px {brand_color}26, 0 0 0 1px {brand_color};
  }}
  :where(button, [role="button"], a, input, select, textarea, summary, [tabindex]):focus-visible {{
    outline: none; box-shadow: var(--st-focus-ring); border-radius: var(--st-radius-sm);
  }}
  @media (prefers-reduced-motion: reduce) {{
    *, *::before, *::after {{ animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }}
  }}
  .stats {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 24px; }}
  .card {{ background: var(--st-bg-surface); border: 1px solid var(--st-border-default); border-radius: var(--st-radius-lg); padding: 18px; }}
  .card-num {{ font-size: 28px; font-weight: bold; color: var(--st-accent); }}
  .card-label {{ font-size: 11px; color: var(--st-text-secondary); text-transform: uppercase; margin-top: 4px; }}
  .section {{ background: var(--st-bg-surface); border: 1px solid var(--st-border-default); border-radius: var(--st-radius-lg); padding: 20px; margin-bottom: 20px; }}
  .section h2 {{ color: var(--st-accent); margin: 0 0 12px 0; font-size: 16px; }}
  input, select, textarea {{ background: var(--st-bg-app); border: 1px solid #333; color: #fff; padding: 8px 12px; border-radius: var(--st-radius-sm); font-family: inherit; font-size: 13px; }}
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
    <div style="flex: 1;">
      <h1>{name}</h1>
      <p class="subtitle">SnapToAI Institution Admin · slug: <code>{html_escape_module.escape(slug)}</code> · status: <strong style="color: {'#00ff88' if status == 'active' else '#ff4757'};">{status}</strong> · expires: {expires}{(' · signed in as <strong>' + html_escape_module.escape(admin_email) + '</strong>') if admin_email else ''}</p>
    </div>
    <button class="secondary" id="signout-btn" onclick="signOut()" title="Clear this device's admin session">Sign out</button>
  </div>
  {('<div style="background: #ff475715; border: 1px solid #ff4757; border-radius: 12px; padding: 16px 20px; margin-bottom: 20px; color: #ffb3bb;"><strong style="color:#ff4757;">⚠ This institution is currently ' + html_escape_module.escape(status) + '.</strong><br><span style="font-size:13px;">Members cannot sign in to the extension and existing members lose institution access until SnapToAI re-activates this institution. Please contact <a href="mailto:support@snaptoai.com" style="color:#ff8a95;">support@snaptoai.com</a>.</span></div>') if status != 'active' else ''}
  <div id="seat-warning" style="display:none; background: #ffa50015; border: 1px solid #ffa500; border-radius: 12px; padding: 12px 16px; margin-bottom: 16px; color: #ffd089; font-size: 13px;"></div>

  <div class="stats">
    <div class="card"><div class="card-num" id="stat-seats">{seats_used} / {seat_limit_display}</div><div class="card-label">Seats Used</div></div>
    <div class="card"><div class="card-num" id="stat-active">—</div><div class="card-label">Active Members</div></div>
    <div class="card"><div class="card-num" id="stat-suspended">—</div><div class="card-label">Suspended</div></div>
    <div class="card"><div class="card-num" id="stat-pending">—</div><div class="card-label">Awaiting first sign-in</div></div>
    <div class="card"><div class="card-num" id="stat-domains" style="font-size:14px;">{domains}</div><div class="card-label">Auto-Join Domains</div></div>
  </div>

  <div class="section">
    <h2>✉️ Add members by email</h2>
    <p style="font-size: 12px; color: #aaa; margin: 0 0 12px 0; line-height: 1.5;">
      Members are auto-enrolled the moment they sign in to the SnapToAI extension with this email address — they don't need a link or code. Just add their email here and tell them to install the extension and sign in with Google.
    </p>
    <div class="row">
      <input id="invite-email" class="grow" placeholder="user@example.com" type="email">
      <select id="invite-duration" title="How long this member's access lasts" style="min-width: 150px;">
        <option value="">No expiry (lifetime)</option>
        <option value="30">1 month (30 days)</option>
        <option value="90">3 months (90 days)</option>
        <option value="180">6 months (180 days)</option>
        <option value="365">1 year (365 days)</option>
        <option value="custom">Custom date…</option>
      </select>
      <input id="invite-custom-date" type="date" style="display:none; min-width: 150px;">
      <button onclick="inviteOne()">Add Member</button>
    </div>
    <div style="margin-top: 8px;">
      <label style="font-size: 12px; color: #ccc; cursor: pointer;">
        <input type="checkbox" id="invite-send-welcome" checked style="vertical-align: middle; margin-right: 4px;">
        Send welcome email (branded — install link + sign-in instructions)
      </label>
    </div>
    <p style="font-size: 11px; color: #777; margin: 8px 0 0 0;">Tip: when access ends the member is automatically blocked from institution features. You can extend or shorten any member's expiry from the table below.</p>
    <div style="margin-top: 14px;">
      <label style="font-size: 12px; color: #888;">Bulk add — upload a CSV file <em>or</em> paste emails below:</label>
      <input id="invite-csv-file" type="file" accept=".csv,text/csv,text/plain" style="margin: 6px 0; font-size: 12px;">
      <textarea id="invite-csv" placeholder="alice@example.com&#10;bob@example.com,carol@example.com"></textarea>
      <div class="row" style="margin-top: 6px;">
        <label style="font-size: 12px; color: #888;">Access duration for everyone in this batch:</label>
        <select id="bulk-duration" title="Applies to every email in the batch">
          <option value="">No expiry (lifetime)</option>
          <option value="30">1 month (30 days)</option>
          <option value="90">3 months (90 days)</option>
          <option value="180">6 months (180 days)</option>
          <option value="365">1 year (365 days)</option>
          <option value="custom">Custom date…</option>
        </select>
        <input id="bulk-custom-date" type="date" style="display:none;">
      </div>
      <button onclick="inviteBulk()" style="margin-top: 8px;">Bulk Add</button>
      <label style="font-size: 12px; color: #ccc; margin-left: 12px; cursor: pointer;">
        <input type="checkbox" id="bulk-send-welcome" checked style="vertical-align: middle; margin-right: 4px;">
        Send welcome email to each new member
      </label>
      <span id="bulk-msg" style="margin-left: 10px; color: #00ff88; font-size: 12px;"></span>
    </div>
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
    <h2>🎨 Branding{(' <span style="font-size: 11px; color: #ffa500; margin-left: 8px;">🔒 Locked by SnapToAI — contact support to change</span>') if info.get('brandingLocked') else ''}</h2>
    <div class="row" style="align-items: flex-start;">
      <div class="grow">
        <label style="font-size: 12px; color: #888; display: block; margin-bottom: 4px;">Brand color (hex):</label>
        <input id="brand-color-input" type="text" value="{html_escape_module.escape(brand_color)}" style="width: 140px;" {'disabled' if info.get('brandingLocked') else ''}>
        <input id="brand-color-picker" type="color" value="{html_escape_module.escape(brand_color)}" style="width: 38px; height: 36px; padding: 2px; vertical-align: middle; margin-left: 6px; border: 1px solid #333; border-radius: 6px; background: #0f0f1a; cursor: pointer;" {'disabled' if info.get('brandingLocked') else ''} title="Pick a color">
        <button onclick="saveColor()" style="margin-left: 12px;" {'disabled' if info.get('brandingLocked') else ''}>Save Color</button>
        <span id="color-msg" style="color: #00ff88; font-size: 12px; margin-left: 8px;"></span>
        <p style="font-size: 11px; color: #666; margin: 8px 0 0 0; max-width: 540px;">Members see this color in the extension. SnapToAI auto-adjusts it slightly so it stays readable in both Light and Dark mode — the previews below show what they'll actually see.</p>
      </div>
      <div style="min-width: 240px;">
        <label style="font-size: 12px; color: #888; display: block; margin-bottom: 4px;">Logo (PNG/JPG/SVG/WebP, max 2MB):</label>
        <div id="logo-preview-wrap" style="margin-bottom:6px;{'' if info.get('logoUrl') else 'display:none;'}"><img id="logo-preview-img" src="{html_escape_module.escape(info.get('logoUrl') or '')}" alt="" style="max-height:36px;max-width:160px;background:#fff;padding:4px;border-radius:4px;"></div>
        <input id="logo-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" style="font-size: 12px;" onchange="uploadLogo()" {'disabled' if info.get('brandingLocked') else ''}>
        <button onclick="uploadLogo()" style="margin-top: 6px;" {'disabled' if info.get('brandingLocked') else ''}>Save Logo</button>
        <button id="logo-clear-btn" class="danger" onclick="clearLogo('default')" style="margin-top: 6px;{'' if info.get('logoUrl') else 'display:none;'}" {'disabled' if info.get('brandingLocked') else ''}>Clear</button>
        <span id="logo-msg" style="color: #00ff88; font-size: 12px; margin-left: 8px;"></span>
      </div>
      <div style="min-width: 240px;">
        <label style="font-size: 12px; color: #888; display: block; margin-bottom: 4px;">Light-mode logo <span style="color:#666;">(optional — used when viewers are in Light mode)</span>:</label>
        <div id="logo-light-preview-wrap" style="margin-bottom:6px;{'' if info.get('logoUrlLight') else 'display:none;'}"><img id="logo-light-preview-img" src="{html_escape_module.escape(info.get('logoUrlLight') or '')}" alt="" style="max-height:36px;max-width:160px;background:#1a1a2a;padding:4px;border-radius:4px;"></div>
        <input id="logo-file-light" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" style="font-size: 12px;" onchange="uploadLogoLight()" {'disabled' if info.get('brandingLocked') else ''}>
        <button onclick="uploadLogoLight()" style="margin-top: 6px;" {'disabled' if info.get('brandingLocked') else ''}>Save Light Logo</button>
        <button id="logo-light-clear-btn" class="danger" onclick="clearLogo('light')" style="margin-top: 6px;{'' if info.get('logoUrlLight') else 'display:none;'}" {'disabled' if info.get('brandingLocked') else ''}>Clear</button>
        <span id="logo-light-msg" style="color: #00ff88; font-size: 12px; margin-left: 8px;"></span>
      </div>
    </div>

    <!-- Theme preview + contrast warnings (Task #19) -->
    <div id="brand-preview-wrap" style="margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; max-width: 760px;">
      <div class="brand-preview" data-mode="light" style="border: 1px solid #2a2a3a; border-radius: 10px; overflow: hidden; background: #0f0f1a;">
        <div style="padding: 6px 10px; font-size: 10px; letter-spacing: 1px; color: #888; text-transform: uppercase; background: #1a1a25; border-bottom: 1px solid #2a2a3a; display: flex; justify-content: space-between; align-items: center;">
          <span>☀ Light mode preview</span>
          <span class="bp-badge" data-mode="light" style="font-size: 10px; padding: 2px 7px; border-radius: 999px; background: #00ff88; color: #000; font-weight: 700;">OK</span>
        </div>
        <div class="bp-canvas" data-mode="light" style="padding: 14px; background: #ffffff; color: #1a1a1a; min-height: 96px;">
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <button class="bp-btn" data-mode="light" type="button" disabled style="border: none; padding: 7px 14px; border-radius: 7px; font-weight: 700; font-size: 12px; cursor: default;">Action</button>
            <span class="bp-link" data-mode="light" style="font-size: 13px; font-weight: 600;">Accent text</span>
            <span class="bp-chip" data-mode="light" style="display: inline-block; width: 18px; height: 18px; border-radius: 4px; border: 1px solid rgba(0,0,0,0.15);" title="Adapted accent"></span>
          </div>
          <div style="margin-top: 8px; font-size: 11px; color: #555;">Picked <code class="bp-raw" data-mode="light">—</code> → rendered <code class="bp-rendered" data-mode="light">—</code></div>
        </div>
      </div>
      <div class="brand-preview" data-mode="dark" style="border: 1px solid #2a2a3a; border-radius: 10px; overflow: hidden; background: #0f0f1a;">
        <div style="padding: 6px 10px; font-size: 10px; letter-spacing: 1px; color: #888; text-transform: uppercase; background: #1a1a25; border-bottom: 1px solid #2a2a3a; display: flex; justify-content: space-between; align-items: center;">
          <span>🌙 Dark mode preview</span>
          <span class="bp-badge" data-mode="dark" style="font-size: 10px; padding: 2px 7px; border-radius: 999px; background: #00ff88; color: #000; font-weight: 700;">OK</span>
        </div>
        <div class="bp-canvas" data-mode="dark" style="padding: 14px; background: #0a0a0a; color: #e8e8e8; min-height: 96px;">
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <button class="bp-btn" data-mode="dark" type="button" disabled style="border: none; padding: 7px 14px; border-radius: 7px; font-weight: 700; font-size: 12px; cursor: default;">Action</button>
            <span class="bp-link" data-mode="dark" style="font-size: 13px; font-weight: 600;">Accent text</span>
            <span class="bp-chip" data-mode="dark" style="display: inline-block; width: 18px; height: 18px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.15);" title="Adapted accent"></span>
          </div>
          <div style="margin-top: 8px; font-size: 11px; color: #aaa;">Picked <code class="bp-raw" data-mode="dark">—</code> → rendered <code class="bp-rendered" data-mode="dark">—</code></div>
        </div>
      </div>
    </div>
    <div id="brand-warning" style="display: none; margin-top: 10px; padding: 10px 12px; border-radius: 8px; font-size: 12px; background: rgba(255,165,0,0.10); border: 1px solid rgba(255,165,0,0.40); color: #ffb454; max-width: 760px;"></div>
  </div>

  <div class="section" id="gemini-key-section">
    <h2>🔑 Agentic AI / API key</h2>
    <p style="color: var(--st-text-secondary); font-size: 12px; margin: 0 0 14px 0; max-width: 720px;">
      Provide a Google Gemini / Vertex API key for your members. The key is encrypted at rest, never sent to the extension, and used transparently by every active member of this institution. Plaintext is shown only at the moment you paste it.
    </p>
    <div id="gk-status" style="margin-bottom: 12px; padding: 10px 12px; border-radius: 8px; background: #16213e; font-size: 13px;">Loading…</div>
    <div style="display: grid; grid-template-columns: 1fr auto auto; gap: 8px; max-width: 720px; align-items: center;">
      <input id="gk-input" type="password" placeholder="Paste Gemini/Vertex API key (e.g. AIza…)" autocomplete="off" spellcheck="false" style="font-family: ui-monospace, monospace;">
      <button id="gk-save" type="button">Save key</button>
      <button id="gk-test-input" type="button" style="background: transparent; color: var(--st-accent); border: 1px solid var(--st-accent);">Test</button>
    </div>
    <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
      <button id="gk-test-stored" type="button" style="background: transparent; color: var(--st-accent); border: 1px solid var(--st-accent);">Test stored key</button>
      <button id="gk-remove" type="button" style="background: transparent; color: #ff6b6b; border: 1px solid #ff6b6b;">Remove key</button>
    </div>
    <div id="gk-msg" style="margin-top: 10px; font-size: 12px; min-height: 16px;"></div>

    <h3 style="color: var(--st-accent); font-size: 13px; margin: 22px 0 8px 0;">Key policy</h3>
    <p style="color: var(--st-text-secondary); font-size: 11px; margin: 0 0 8px 0; max-width: 720px;">
      Controls what happens when a member also has their own personal Gemini key in the extension.
    </p>
    <select id="gk-policy" style="background: #0f0f1a; color: #fff; border: 1px solid #333; border-radius: 6px; padding: 8px 10px; min-width: 320px;">
      <option value="prefer-user-key">Prefer member's personal key (institution key as fallback)</option>
      <option value="prefer-institution-key">Prefer institution key (member's key as fallback)</option>
      <option value="institution-only">Institution key only (hide member BYOK input)</option>
    </select>

    <h3 style="color: var(--st-accent); font-size: 13px; margin: 18px 0 8px 0;">Billing behavior</h3>
    <p style="color: var(--st-text-secondary); font-size: 11px; margin: 0 0 8px 0; max-width: 720px;">
      Controls whether AI calls made with the institution key still count against members' SnapToAI free-prompt quota.
    </p>
    <select id="gk-billing" style="background: #0f0f1a; color: #fff; border: 1px solid #333; border-radius: 6px; padding: 8px 10px; min-width: 320px;">
      <option value="count-against-snaptoai-quota">Count against SnapToAI free-prompt quota</option>
      <option value="bypass-snaptoai-quota">Bypass — institution pays Google directly, no metering</option>
    </select>

    <div style="margin-top: 14px;">
      <button id="gk-save-policy" type="button">Save policy &amp; billing</button>
      <span id="gk-policy-msg" style="margin-left: 12px; font-size: 12px;"></span>
    </div>

    <div id="gk-audit" style="margin-top: 18px; padding: 10px 12px; border-radius: 8px; background: #0f0f1a; border: 1px solid #2a2a4a; font-size: 11px; color: #aaa; line-height: 1.7;"></div>
  </div>

  <div class="section">
    <h2>📜 Activity log <span style="font-size: 11px; color: #888; font-weight: normal; margin-left: 8px;">(who did what, last 100 events)</span></h2>
    <div class="row" style="margin-bottom: 10px; gap: 8px;">
      <input id="activity-search" class="grow" placeholder="🔍 Search by actor, action, or target email…" style="min-width: 220px;" oninput="renderActivity()">
      <select id="activity-filter" onchange="renderActivity()" style="min-width: 180px;" title="Filter by action type">
        <option value="">All actions</option>
        <option value="member.">Members</option>
        <option value="branding.">Branding</option>
        <option value="domains.">Domains</option>
        <option value="gemini_key.">Gemini key</option>
      </select>
      <button class="secondary" onclick="loadActivity()" title="Refresh">↻ Refresh</button>
      <a href="/api/institution/{html_escape_module.escape(slug)}/activity/export.csv" class="secondary" style="background:#333; color:#fff; padding:8px 14px; border-radius:6px; text-decoration:none; font-size:12px; font-weight:bold;" title="Download activity log as CSV">⬇ Export CSV</a>
    </div>
    <div id="activity-list" style="font-size: 13px; color: #888;">Loading…</div>
  </div>

  <div class="section">
    <h2>👥 Members</h2>
    <div class="row" style="margin-bottom: 10px; gap: 8px;">
      <input id="members-search" class="grow" placeholder="🔍 Search by email…" style="min-width: 220px;" oninput="renderMembers()">
      <select id="members-filter" onchange="renderMembers()" style="min-width: 160px;" title="Filter by status">
        <option value="">All members</option>
        <option value="active">Active only</option>
        <option value="suspended">Suspended only</option>
        <option value="pending">Not signed in yet</option>
        <option value="expired">Expired</option>
      </select>
      <a href="/api/institution/{html_escape_module.escape(slug)}/members/export.csv" class="secondary" style="background:#333; color:#fff; padding:8px 14px; border-radius:6px; text-decoration:none; font-size:12px; font-weight:bold;" title="Download all members as CSV">⬇ Export CSV</a>
    </div>
    <div id="members-summary" style="font-size: 11px; color: #888; margin-bottom: 6px;"></div>
    <div id="members-list">Loading...</div>
  </div>

<script>
const SLUG = {json.dumps(slug)};
const API_BASE = '/api/institution/' + SLUG;

let MEMBERS_CACHE = [];
const INST_NAME = {json.dumps(info['name'])};
const STORE_URL = 'https://chromewebstore.google.com/detail/snaptoai';

async function load() {{
  const r = await fetch(API_BASE + '/members');
  const d = await r.json();
  if (!d.success) {{ document.getElementById('members-list').innerHTML = 'Error: ' + (d.error||''); return; }}
  MEMBERS_CACHE = d.members || [];
  let active=0, suspended=0, pending=0;
  for (const m of MEMBERS_CACHE) {{
    if (m.status === 'active') active++;
    else if (m.status === 'suspended') suspended++;
    // "Awaiting first sign-in" = anyone the admin added by email who hasn't
    // signed in to the extension yet (last_seen is still NULL).
    if (!m.lastSeen) pending++;
  }}
  document.getElementById('stat-active').textContent = active;
  document.getElementById('stat-suspended').textContent = suspended;
  document.getElementById('stat-pending').textContent = pending;

  // Seat-limit pressure warning. The header card shows raw "used / limit"
  // but a banner makes the threshold impossible to miss.
  const seatTxt = document.getElementById('stat-seats').textContent || '';
  const m_ = seatTxt.match(/(\d+)\s*\/\s*(\d+)/);
  const warn = document.getElementById('seat-warning');
  if (m_ && warn) {{
    const used = parseInt(m_[1],10), cap = parseInt(m_[2],10);
    if (cap > 0 && used / cap >= 0.8) {{
      warn.style.display = 'block';
      warn.textContent = (used >= cap)
        ? '⚠ All ' + cap + ' seats are in use. New members can\\'t auto-join — remove inactive members or contact SnapToAI to raise the cap.'
        : '⚠ ' + used + ' of ' + cap + ' seats used (' + Math.round(used/cap*100) + '%). Plan ahead before you hit the cap.';
    }} else if (warn) {{ warn.style.display = 'none'; }}
  }}

  renderMembers();
}}

function renderMembers() {{
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}})[c]);
  const q = (document.getElementById('members-search')?.value || '').trim().toLowerCase();
  const f = document.getElementById('members-filter')?.value || '';
  const filtered = MEMBERS_CACHE.filter(m => {{
    if (q && !(String(m.email||'').toLowerCase().includes(q))) return false;
    if (f === 'active') return m.status === 'active' && !m.expired;
    if (f === 'suspended') return m.status === 'suspended';
    if (f === 'pending') return !m.lastSeen;
    if (f === 'expired') return !!m.expired;
    return true;
  }});
  const sum = document.getElementById('members-summary');
  if (sum) sum.textContent = (q || f)
    ? 'Showing ' + filtered.length + ' of ' + MEMBERS_CACHE.length + ' members'
    : MEMBERS_CACHE.length + ' member' + (MEMBERS_CACHE.length === 1 ? '' : 's');
  if (!filtered.length) {{
    document.getElementById('members-list').innerHTML = '<div style="padding:24px; text-align:center; color:#888; font-size:13px;">No members match this filter.</div>';
    return;
  }}
  let html = '<table><tr><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th>Last Seen</th><th>Access Until</th><th>Actions</th></tr>';
  for (const m of filtered) {{
    const badgeClass = m.status === 'active' ? 'badge-active' : (m.status === 'suspended' ? 'badge-suspended' : 'badge-pending');
    const mid = parseInt(m.id, 10) || 0;
    let expiryCell = '<span style="color:#888;">Never</span>';
    if (m.expiresAt) {{
      const dt = new Date(m.expiresAt);
      const dateStr = dt.toLocaleDateString();
      if (m.expired) {{
        expiryCell = '<span style="color:#ff4757;" title="Expired — member is blocked">⏱ Expired ' + dateStr + '</span>';
      }} else {{
        const daysLeft = Math.ceil((dt.getTime() - Date.now()) / 86400000);
        const tone = daysLeft <= 7 ? '#ffa500' : '#e0e0e0';
        expiryCell = '<span style="color:' + tone + ';" title="' + daysLeft + ' day(s) remaining">' + dateStr + '</span>';
      }}
    }}
    const pendingPill = !m.lastSeen
      ? ' <span class="badge badge-pending" style="margin-left:6px;" title="This member has not signed in to the extension yet">Not signed in yet</span>'
      : '';
    html += '<tr>' +
      '<td>' + esc(m.email) + pendingPill + '</td>' +
      '<td>' + esc(m.role) + '</td>' +
      '<td><span class="badge ' + badgeClass + '">' + esc(m.status) + '</span></td>' +
      '<td>' + (m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : '—') + '</td>' +
      '<td>' + (m.lastSeen ? new Date(m.lastSeen).toLocaleDateString() : '—') + '</td>' +
      '<td>' + expiryCell + '</td>' +
      '<td>' +
        (m.status === 'active'
          ? '<button class="danger" onclick="suspend(' + mid + ')">Suspend</button> '
          : '<button onclick="reactivate(' + mid + ')">Reactivate</button> ') +
        '<button class="secondary" onclick="editExpiry(' + mid + ', ' + JSON.stringify(String(m.email||'')) + ', ' + JSON.stringify(m.expiresAt || '') + ')" title="Change access duration">Set Expiry</button> ' +
        '<button class="secondary" onclick="copyWelcome(' + JSON.stringify(String(m.email||'')) + ')" title="Copy a ready-to-send welcome message for this member">📋 Copy welcome</button> ' +
        '<button class="secondary" onclick="resendWelcome(' + mid + ', ' + JSON.stringify(String(m.email||'')) + ')" title="Send the branded welcome email to this member again">✉️ Resend email</button> ' +
        '<button class="secondary" onclick="removeMember(' + mid + ', ' + JSON.stringify(String(m.email||'')) + ')">Remove</button>' +
      '</td></tr>';
  }}
  html += '</table>';
  document.getElementById('members-list').innerHTML = html;
}}

async function copyWelcome(email) {{
  const msg = 'Hi! You have been added to ' + INST_NAME + ' on SnapToAI.\\n\\n' +
    '1. Install the SnapToAI Chrome extension: ' + STORE_URL + '\\n' +
    '2. Sign in with Google using this email: ' + email + '\\n' +
    '3. Your branded license unlocks automatically — no code needed.\\n\\n' +
    'Questions? Reply to this email.';
  try {{
    await navigator.clipboard.writeText(msg);
    alert('✓ Welcome message copied to clipboard. Paste it into an email to ' + email + '.');
  }} catch (e) {{
    prompt('Copy this welcome message:', msg);
  }}
}}

async function signOut() {{
  const btn = document.getElementById('signout-btn');
  if (btn) {{ btn.disabled = true; btn.textContent = 'Signing out…'; }}
  try {{
    const r = await fetch(API_BASE + '/admin-logout', {{method: 'POST', headers: {{'Content-Type':'application/json'}}}});
    const d = await r.json().catch(() => ({{}}));
    window.location.href = (d && d.redirect) ? d.redirect : ('/institution/' + SLUG + '/admin');
  }} catch (e) {{
    window.location.href = '/institution/' + SLUG + '/admin';
  }}
}}

// Read access-duration choice from a paired <select> + <input type=date>.
// Returns {{durationDays, expiresAt}} suitable for posting to invite endpoints.
function _readDurationFields(selectId, dateId) {{
  const sel = document.getElementById(selectId);
  const dateInput = document.getElementById(dateId);
  if (!sel) return {{}};
  const v = (sel.value || '').trim();
  if (!v) return {{}};
  if (v === 'custom') {{
    const d = (dateInput && dateInput.value || '').trim();
    if (!d) {{ alert('Pick a custom expiry date or choose another option.'); throw new Error('no-date'); }}
    return {{ expiresAt: d }};
  }}
  return {{ durationDays: parseInt(v, 10) || 0 }};
}}

// Toggle the custom-date input visibility based on the duration <select>.
function _wireDurationToggle(selectId, dateId) {{
  const sel = document.getElementById(selectId);
  const dateInput = document.getElementById(dateId);
  if (!sel || !dateInput) return;
  sel.addEventListener('change', () => {{
    dateInput.style.display = sel.value === 'custom' ? '' : 'none';
    if (sel.value === 'custom' && !dateInput.value) {{
      // Default the picker one month out for convenience.
      const d = new Date(); d.setDate(d.getDate() + 30);
      dateInput.value = d.toISOString().slice(0, 10);
    }}
  }});
}}
document.addEventListener('DOMContentLoaded', () => {{
  _wireDurationToggle('invite-duration', 'invite-custom-date');
  _wireDurationToggle('bulk-duration', 'bulk-custom-date');
}});

async function inviteOne() {{
  const email = document.getElementById('invite-email').value.trim();
  if (!email) return;
  let extra;
  try {{ extra = _readDurationFields('invite-duration', 'invite-custom-date'); }} catch (_) {{ return; }}
  const sw = document.getElementById('invite-send-welcome');
  const sendWelcome = sw ? !!sw.checked : true;
  const body = Object.assign({{email, sendWelcome}}, extra);
  const r = await fetch(API_BASE + '/invite', {{method: 'POST', headers: {{'Content-Type':'application/json'}}, body: JSON.stringify(body)}});
  const d = await r.json();
  if (d.success) {{
    document.getElementById('invite-email').value='';
    const sel = document.getElementById('invite-duration'); if (sel) sel.value = '';
    const dt = document.getElementById('invite-custom-date'); if (dt) {{ dt.value = ''; dt.style.display = 'none'; }}
    if (sendWelcome && d.result === 'added' && !d.emailSent) {{
      alert('Member added, but the welcome email could not be sent: ' + (d.emailError || 'unknown error') + '\\n\\nUse the Resend email button on the row, or check SMTP env vars (SMTP_HOST/PORT/USER/PASS/FROM).');
    }}
    load();
  }} else alert('Failed: ' + (d.error||''));
}}
async function inviteBulk() {{
  const text = document.getElementById('invite-csv').value;
  const file = document.getElementById('invite-csv-file') ? document.getElementById('invite-csv-file').files[0] : null;
  const msg = document.getElementById('bulk-msg');
  let extra;
  try {{ extra = _readDurationFields('bulk-duration', 'bulk-custom-date'); }} catch (_) {{ return; }}
  const sw = document.getElementById('bulk-send-welcome');
  const sendWelcome = sw ? !!sw.checked : true;
  let resp;
  if (file) {{
    const fd = new FormData(); fd.append('file', file);
    if (extra.expiresAt) fd.append('expiresAt', extra.expiresAt);
    if (extra.durationDays) fd.append('durationDays', String(extra.durationDays));
    fd.append('sendWelcome', sendWelcome ? '1' : '0');
    resp = await fetch(API_BASE + '/invite-bulk', {{method:'POST', body: fd}});
  }} else {{
    if (!text.trim()) return;
    const body = Object.assign({{csv: text, sendWelcome}}, extra);
    resp = await fetch(API_BASE + '/invite-bulk', {{method:'POST', headers:{{'Content-Type':'application/json'}}, body: JSON.stringify(body)}});
  }}
  const d = await resp.json();
  if (d.success) {{
    msg.style.color='#00ff88';
    let summary = '✓ Added ' + d.added + ' · already: ' + (d.alreadyMember||0) + ' · invalid: ' + (d.invalidEmail||0) + ' · no seats: ' + (d.noSeats||0);
    if (sendWelcome && d.added > 0) {{
      summary += ' · emails sent: ' + (d.emailsSent||0);
      if (d.emailsFailed) summary += ' · email failed: ' + d.emailsFailed;
    }}
    msg.textContent = summary;
    if (sendWelcome && d.emailsFailed) {{
      alert('Some welcome emails failed to send: ' + (d.emailError || 'unknown error') + '\\n\\nCheck SMTP env vars (SMTP_HOST/PORT/USER/PASS/FROM) or use Resend per row.');
    }}
    document.getElementById('invite-csv').value='';
    if (document.getElementById('invite-csv-file')) document.getElementById('invite-csv-file').value='';
    load();
  }} else {{ msg.style.color='#ff4757'; msg.textContent = '✗ ' + (d.error||''); }}
}}
async function resendWelcome(memberId, email) {{
  if (!confirm('Send the branded welcome email to ' + email + ' again?')) return;
  try {{
    const r = await fetch(API_BASE + '/members/' + memberId + '/resend-welcome', {{method:'POST', headers:{{'Content-Type':'application/json'}}, body: '{{}}'}});
    const d = await r.json();
    if (d.success) {{
      alert('✓ Welcome email sent to ' + email);
    }} else {{
      alert('✗ Could not send: ' + (d.error || 'unknown error') + '\\n\\nIf SMTP is not configured, set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM environment variables.');
    }}
  }} catch (e) {{
    alert('✗ Network error: ' + e);
  }}
}}

async function editExpiry(memberId, email, currentExpiry) {{
  const currentDate = currentExpiry ? new Date(currentExpiry).toISOString().slice(0, 10) : '';
  const prompt1 = 'Set access expiry for ' + email + '\\n\\n' +
    'Type a number of days (e.g. 30, 90, 365), or a date (YYYY-MM-DD), or leave empty for no expiry.\\n' +
    (currentDate ? 'Current expiry: ' + currentDate : 'Currently: no expiry');
  const v = window.prompt(prompt1, currentDate);
  if (v === null) return;
  const trimmed = (v || '').trim();
  let body = {{}};
  if (!trimmed) {{
    // Empty = clear expiry.
    body = {{ durationDays: 0 }};
  }} else if (/^\\d+$/.test(trimmed)) {{
    body = {{ durationDays: parseInt(trimmed, 10) }};
  }} else {{
    body = {{ expiresAt: trimmed }};
  }}
  const r = await fetch(API_BASE + '/members/' + memberId + '/expiry', {{
    method: 'PUT', headers: {{'Content-Type':'application/json'}},
    body: JSON.stringify(body)
  }});
  const d = await r.json();
  if (d.success) load(); else alert('Failed: ' + (d.error || 'Unknown error'));
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

// ---------- Brand color preview + warnings (Task #19) ----------
// Mirrors the math in flow-premium/branding.js so the admin sees the
// exact accent the extension will render after Light/Dark adaptation.
function bpHexToRgb(hex) {{
  if (!hex) return null;
  let s = String(hex).trim().replace('#', '');
  if (s.length === 3) s = s[0]+s[0]+s[1]+s[1]+s[2]+s[2];
  if (!/^[0-9a-fA-F]{{6}}$/.test(s)) return null;
  return {{ r: parseInt(s.slice(0,2),16), g: parseInt(s.slice(2,4),16), b: parseInt(s.slice(4,6),16) }};
}}
function bpClamp(n) {{ return Math.max(0, Math.min(255, Math.round(n))); }}
function bpRgbToHex(c) {{
  const to2 = (n) => {{ const s = bpClamp(n).toString(16); return s.length < 2 ? '0'+s : s; }};
  return '#' + to2(c.r) + to2(c.g) + to2(c.b);
}}
function bpRelLum(c) {{
  const f = (v) => {{ v = v/255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }};
  return 0.2126*f(c.r) + 0.7152*f(c.g) + 0.0722*f(c.b);
}}
function bpMix(a, b, t) {{ return {{ r:a.r+(b.r-a.r)*t, g:a.g+(b.g-a.g)*t, b:a.b+(b.b-a.b)*t }}; }}
function bpLighten(c, t) {{ return bpMix(c, {{r:255,g:255,b:255}}, t); }}
function bpDarken(c, t)  {{ return bpMix(c, {{r:0,g:0,b:0}}, t); }}
function bpContrast(L1, L2) {{ const hi=Math.max(L1,L2), lo=Math.min(L1,L2); return (hi+0.05)/(lo+0.05); }}
function bpAdapt(rgb, theme) {{
  let out = {{ r:rgb.r, g:rgb.g, b:rgb.b }}, iter = 0;
  if (theme === 'dark') {{
    const Lbg = bpRelLum({{r:10,g:10,b:10}});
    while (bpContrast(bpRelLum(out), Lbg) < 4.5 && iter < 10) {{ out = bpLighten(out, 0.22); iter++; }}
  }} else {{
    while (bpContrast(bpRelLum(out), 1) < 3.5 && iter < 12) {{ out = bpDarken(out, 0.16); iter++; }}
  }}
  return {{ rgb: out, iterations: iter }};
}}
function bpFg(rgb) {{
  const L = bpRelLum(rgb);
  return bpContrast(L, 0) >= bpContrast(L, 1) ? '#000000' : '#ffffff';
}}
function bpColorDistance(a, b) {{
  // Quick perceptual-ish distance — enough to flag "drifted noticeably".
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt(dr*dr + dg*dg + db*db);
}}

function updateBrandPreview() {{
  const rawInput = document.getElementById('brand-color-input');
  const picker = document.getElementById('brand-color-picker');
  const wrap = document.getElementById('brand-preview-wrap');
  const warnEl = document.getElementById('brand-warning');
  if (!rawInput || !wrap) return;
  const raw = rawInput.value.trim();
  const rgb = bpHexToRgb(raw);
  if (!rgb) {{
    // Invalid hex — reset previews to a neutral state so the admin
    // doesn't see a stale swatch from the last valid input.
    ['light','dark'].forEach((mode) => {{
      const btn = wrap.querySelector('.bp-btn[data-mode="'+mode+'"]');
      const link = wrap.querySelector('.bp-link[data-mode="'+mode+'"]');
      const chip = wrap.querySelector('.bp-chip[data-mode="'+mode+'"]');
      const badge = wrap.querySelector('.bp-badge[data-mode="'+mode+'"]');
      const rawCode = wrap.querySelector('.bp-raw[data-mode="'+mode+'"]');
      const renderedCode = wrap.querySelector('.bp-rendered[data-mode="'+mode+'"]');
      const neutral = mode === 'light' ? '#cccccc' : '#444444';
      const neutralFg = mode === 'light' ? '#666' : '#aaa';
      if (btn) {{ btn.style.background = neutral; btn.style.color = neutralFg; }}
      if (link) {{ link.style.color = neutralFg; }}
      if (chip) {{ chip.style.background = neutral; }}
      if (badge) {{ badge.textContent = '—'; badge.style.background = '#555'; badge.style.color = '#fff'; }}
      if (rawCode) {{ rawCode.textContent = '—'; rawCode.style.color = neutralFg; }}
      if (renderedCode) {{ renderedCode.textContent = '—'; renderedCode.style.color = neutralFg; }}
    }});
    if (warnEl) {{
      warnEl.style.display = 'block';
      warnEl.textContent = 'Enter a valid hex color (e.g. #00d9ff or #0c9) to see the preview.';
    }}
    return;
  }}
  // Keep the native picker in sync (it only accepts 6-digit hex).
  if (picker && picker.value.toLowerCase() !== bpRgbToHex(rgb).toLowerCase()) {{
    try {{ picker.value = bpRgbToHex(rgb); }} catch (e) {{}}
  }}
  const messages = [];
  ['light', 'dark'].forEach((mode) => {{
    const result = bpAdapt(rgb, mode);
    const renderedHex = bpRgbToHex(result.rgb);
    const rawHex = bpRgbToHex(rgb);
    const fg = bpFg(result.rgb);
    const bg = mode === 'light' ? {{r:255,g:255,b:255}} : {{r:10,g:10,b:10}};
    const rawContrast = bpContrast(bpRelLum(rgb), bpRelLum(bg));
    const drift = bpColorDistance(rgb, result.rgb);

    const btn = wrap.querySelector('.bp-btn[data-mode="'+mode+'"]');
    const link = wrap.querySelector('.bp-link[data-mode="'+mode+'"]');
    const chip = wrap.querySelector('.bp-chip[data-mode="'+mode+'"]');
    const badge = wrap.querySelector('.bp-badge[data-mode="'+mode+'"]');
    const rawCode = wrap.querySelector('.bp-raw[data-mode="'+mode+'"]');
    const renderedCode = wrap.querySelector('.bp-rendered[data-mode="'+mode+'"]');

    if (btn) {{ btn.style.background = renderedHex; btn.style.color = fg; }}
    if (link) {{ link.style.color = renderedHex; }}
    if (chip) {{ chip.style.background = renderedHex; }}
    if (rawCode) {{ rawCode.textContent = rawHex; rawCode.style.color = rawHex; }}
    if (renderedCode) {{ renderedCode.textContent = renderedHex; renderedCode.style.color = renderedHex; }}

    // Status badge: OK / Adjusted / Drifted (drift > ~60 = visibly different)
    let label = 'OK', bgc = '#00ff88', fgc = '#000';
    if (drift > 90) {{ label = 'Heavily adjusted'; bgc = '#ffa500'; fgc = '#000'; }}
    else if (drift > 35) {{ label = 'Adjusted'; bgc = '#ffd166'; fgc = '#000'; }}
    if (badge) {{ badge.textContent = label; badge.style.background = bgc; badge.style.color = fgc; }}

    if (rawContrast < 3 || drift > 90) {{
      const labelMode = mode === 'light' ? 'Light mode' : 'Dark mode';
      const bgLabel = mode === 'light' ? 'white' : 'near-black';
      messages.push(labelMode + ': contrast vs ' + bgLabel + ' is only ' + rawContrast.toFixed(1) + ':1 — SnapToAI ' + (mode === 'light' ? 'darkened' : 'lightened') + ' it to ' + renderedHex + ' so members can read it. Pick a ' + (mode === 'light' ? 'darker' : 'lighter') + ' shade for an exact match.');
    }}
  }});
  if (warnEl) {{
    if (messages.length) {{
      warnEl.style.display = 'block';
      warnEl.innerHTML = '<strong>⚠ Heads-up:</strong><br>' + messages.map(m => '• ' + m).join('<br>');
    }} else {{
      warnEl.style.display = 'none';
      warnEl.textContent = '';
    }}
  }}
}}

(function bpInit() {{
  const txt = document.getElementById('brand-color-input');
  const pick = document.getElementById('brand-color-picker');
  if (txt) txt.addEventListener('input', updateBrandPreview);
  if (pick) pick.addEventListener('input', () => {{
    if (txt && !txt.disabled) {{ txt.value = pick.value; }}
    updateBrandPreview();
  }});
  // First paint
  try {{ updateBrandPreview(); }} catch (e) {{ console.log('[brand preview]', e); }}
}})();
// Auto-uploads on file pick AND works as a click handler on the Save
// button. Re-entrancy guard via _logoUploading prevents the change-event
// + button-click double-fire from running two parallel uploads.
//
// Task #36: After save, swap the preview image INLINE instead of full-page
// reloading. The previous reload cleared the file input + the success
// message in under a second and made users (correctly) think their file
// disappeared into nowhere. Now the new logo appears immediately right
// above the picker, the success banner stays put, and the user can see
// what they uploaded.
function _swapLogoPreview(wrapId, imgId, clearBtnId, newUrl) {{
  const wrap = document.getElementById(wrapId);
  const img  = document.getElementById(imgId);
  const clr  = document.getElementById(clearBtnId);
  if (img && newUrl) {{
    // cache-buster — same filename / new bytes would otherwise show the old image
    img.src = newUrl + (newUrl.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now();
  }}
  if (wrap) wrap.style.display = newUrl ? '' : 'none';
  if (clr)  clr.style.display  = newUrl ? '' : 'none';
}}
function _bigSavedBanner(msgEl, label) {{
  if (!msgEl) return;
  msgEl.style.color = '#00ff88';
  msgEl.style.fontWeight = '700';
  msgEl.textContent = '✓ ' + label + ' saved! Preview updated above ↑';
}}
let _logoUploading = false;
async function uploadLogo() {{
  if (_logoUploading) return;
  const input = document.getElementById('logo-file');
  const f = input && input.files && input.files[0];
  const msg = document.getElementById('logo-msg');
  if (!f) {{ msg.style.color='#ff4757'; msg.textContent='Pick a file first'; return; }}
  _logoUploading = true;
  msg.style.color='#888'; msg.textContent='Saving...';
  try {{
    const fd = new FormData(); fd.append('logo', f);
    const r = await fetch(API_BASE + '/branding/logo', {{method:'POST', body: fd}});
    const d = await r.json();
    if (d.success) {{
      _swapLogoPreview('logo-preview-wrap', 'logo-preview-img', 'logo-clear-btn', d.logoUrl || '');
      _bigSavedBanner(msg, 'Logo');
      // Clear the file input so picking a different file later doesn't
      // confuse the user with the old filename hanging around.
      try {{ input.value = ''; }} catch (_) {{}}
    }}
    else {{ msg.style.color='#ff4757'; msg.textContent = '✗ ' + (d.error||''); }}
  }} catch (e) {{
    msg.style.color='#ff4757'; msg.textContent = '✗ ' + (e.message || 'upload failed');
  }} finally {{
    _logoUploading = false;
  }}
}}
let _logoLightUploading = false;
async function uploadLogoLight() {{
  if (_logoLightUploading) return;
  const input = document.getElementById('logo-file-light');
  const f = input && input.files && input.files[0];
  const msg = document.getElementById('logo-light-msg');
  if (!f) {{ msg.style.color='#ff4757'; msg.textContent='Pick a file first'; return; }}
  _logoLightUploading = true;
  msg.style.color='#888'; msg.textContent='Saving...';
  try {{
    const fd = new FormData(); fd.append('logo', f); fd.append('variant', 'light');
    const r = await fetch(API_BASE + '/branding/logo', {{method:'POST', body: fd}});
    const d = await r.json();
    if (d.success) {{
      _swapLogoPreview('logo-light-preview-wrap', 'logo-light-preview-img', 'logo-light-clear-btn', d.logoUrlLight || '');
      _bigSavedBanner(msg, 'Light-mode logo');
      try {{ input.value = ''; }} catch (_) {{}}
    }}
    else {{ msg.style.color='#ff4757'; msg.textContent = '✗ ' + (d.error||''); }}
  }} catch (e) {{
    msg.style.color='#ff4757'; msg.textContent = '✗ ' + (e.message || 'upload failed');
  }} finally {{
    _logoLightUploading = false;
  }}
}}
async function clearLogo(which) {{
  const isLight = which === 'light';
  const msg = document.getElementById(isLight ? 'logo-light-msg' : 'logo-msg');
  if (!confirm('Remove the ' + (isLight ? 'Light-mode logo' : 'logo') + '?')) return;
  msg.style.color='#888'; msg.textContent='Clearing...';
  const url = API_BASE + '/branding/logo' + (isLight ? '?variant=light' : '');
  const r = await fetch(url, {{method:'DELETE'}});
  const d = await r.json();
  if (d.success) {{
    if (isLight) _swapLogoPreview('logo-light-preview-wrap', 'logo-light-preview-img', 'logo-light-clear-btn', '');
    else         _swapLogoPreview('logo-preview-wrap', 'logo-preview-img', 'logo-clear-btn', '');
    msg.style.color='#00ff88'; msg.textContent='✓ Cleared';
  }}
  else {{ msg.style.color='#ff4757'; msg.textContent = '✗ ' + (d.error||''); }}
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

// ---------- Task #27: institution Gemini key admin ----------
function fmtTs(s) {{
  if (!s) return 'never';
  try {{ return new Date(s).toLocaleString(); }} catch(e) {{ return s; }}
}}
async function loadGeminiKey() {{
  const r = await fetch(API_BASE + '/gemini-key');
  const d = await r.json();
  const status = document.getElementById('gk-status');
  const audit = document.getElementById('gk-audit');
  if (!d.success) {{ status.textContent = 'Error: ' + (d.error||''); return; }}
  if (d.hasKey) {{
    status.style.background = '#0d3b1f';
    status.innerHTML = '✓ Institution key is configured · masked: <code style="font-family: ui-monospace, monospace;">••••••••' + (d.keyHint||'').replace(/[<>&]/g,'') + '</code>';
  }} else {{
    status.style.background = '#3b1f1f';
    status.innerHTML = '⚠ No institution key set. Members fall back to their personal key or the SnapToAI shared key.';
  }}
  document.getElementById('gk-policy').value = d.keyPolicy || 'prefer-user-key';
  document.getElementById('gk-billing').value = d.billingBehavior || 'count-against-snaptoai-quota';
  audit.innerHTML =
    '<div>🔧 Key first set: <strong>' + fmtTs(d.keySetAt) + '</strong></div>' +
    '<div>♻️ Last rotated: <strong>' + fmtTs(d.keyLastRotatedAt) + '</strong></div>' +
    '<div>✨ Last successfully used: <strong>' + fmtTs(d.keyLastUsedAt) + '</strong></div>';
}}
function gkMsg(text, ok) {{
  const el = document.getElementById('gk-msg');
  el.style.color = ok ? '#00ff88' : '#ff4757';
  el.textContent = text;
}}
async function gkSave() {{
  const key = document.getElementById('gk-input').value.trim();
  if (!key) {{ gkMsg('Paste a key first', false); return; }}
  gkMsg('Saving…', true);
  const r = await fetch(API_BASE + '/gemini-key', {{method:'POST', headers:{{'Content-Type':'application/json'}}, body: JSON.stringify({{key}})}});
  const d = await r.json();
  if (d.success) {{
    gkMsg('✓ Saved (encrypted at rest, never returned in plaintext)', true);
    document.getElementById('gk-input').value = '';
    loadGeminiKey();
  }} else {{ gkMsg('✗ ' + (d.error||'Save failed'), false); }}
}}
async function gkTestInput() {{
  const key = document.getElementById('gk-input').value.trim();
  if (!key) {{ gkMsg('Paste a key in the input first', false); return; }}
  gkMsg('Testing…', true);
  const r = await fetch(API_BASE + '/gemini-key/test', {{method:'POST', headers:{{'Content-Type':'application/json'}}, body: JSON.stringify({{key}})}});
  const d = await r.json();
  gkMsg((d.ok ? '✓ ' : '✗ ') + (d.message||''), !!d.ok);
}}
async function gkTestStored() {{
  gkMsg('Testing stored key…', true);
  const r = await fetch(API_BASE + '/gemini-key/test', {{method:'POST', headers:{{'Content-Type':'application/json'}}, body: JSON.stringify({{stored: true}})}});
  const d = await r.json();
  gkMsg((d.ok ? '✓ ' : '✗ ') + (d.message||''), !!d.ok);
}}
async function gkRemove() {{
  if (!confirm('Remove the institution Gemini key? Members will fall back to their personal key or the SnapToAI shared key (depending on policy).')) return;
  const r = await fetch(API_BASE + '/gemini-key', {{method:'DELETE'}});
  const d = await r.json();
  if (d.success) {{ gkMsg('✓ Removed', true); loadGeminiKey(); }} else {{ gkMsg('✗ ' + (d.error||''), false); }}
}}
async function gkSavePolicy() {{
  const policy = document.getElementById('gk-policy').value;
  const billing = document.getElementById('gk-billing').value;
  const msg = document.getElementById('gk-policy-msg');
  msg.textContent = 'Saving…';
  const r = await fetch(API_BASE + '/gemini-key/policy', {{method:'PUT', headers:{{'Content-Type':'application/json'}}, body: JSON.stringify({{keyPolicy: policy, billingBehavior: billing}})}});
  const d = await r.json();
  if (d.success) {{ msg.style.color = '#00ff88'; msg.textContent = '✓ Saved'; loadGeminiKey(); }}
  else {{ msg.style.color = '#ff4757'; msg.textContent = '✗ ' + (d.error||''); }}
}}
document.getElementById('gk-save').addEventListener('click', gkSave);
document.getElementById('gk-test-input').addEventListener('click', gkTestInput);
document.getElementById('gk-test-stored').addEventListener('click', gkTestStored);
document.getElementById('gk-remove').addEventListener('click', gkRemove);
document.getElementById('gk-save-policy').addEventListener('click', gkSavePolicy);
loadGeminiKey();

// ---------- Task #37 — Activity log ----------
let ACTIVITY_CACHE = [];
const ACTION_LABELS = {{
  'member.invite': '✉️ Invited member',
  'member.invite_bulk': '📥 Bulk invite',
  'member.suspend': '⛔ Suspended member',
  'member.reactivate': '✅ Reactivated member',
  'member.delete': '🗑 Removed member',
  'member.expiry_change': '⏱ Changed expiry',
  'domains.set': '🌐 Updated auto-join domains',
  'branding.color': '🎨 Changed brand color',
  'branding.logo_upload': '🖼 Uploaded logo',
  'branding.logo_delete': '🖼 Removed logo',
  'gemini_key.set': '🔑 Set Gemini key',
  'gemini_key.rotate': '🔄 Rotated Gemini key',
  'gemini_key.delete': '🔓 Removed Gemini key',
  'gemini_key.policy': '⚙️ Changed key policy'
}};
async function loadActivity() {{
  const el = document.getElementById('activity-list');
  if (!el) return;
  el.textContent = 'Loading…';
  try {{
    const r = await fetch(API_BASE + '/activity?limit=100');
    const d = await r.json();
    if (!d.success) {{ el.textContent = 'Error: ' + (d.error || ''); return; }}
    ACTIVITY_CACHE = d.events || [];
    renderActivity();
  }} catch (e) {{ el.textContent = 'Error: ' + e; }}
}}
function _fmtRelative(iso) {{
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  const diff = Math.floor((Date.now() - t) / 1000);
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  if (diff < 86400*7) return Math.floor(diff/86400) + 'd ago';
  return new Date(iso).toLocaleDateString();
}}
function renderActivity() {{
  const el = document.getElementById('activity-list');
  if (!el) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}})[c]);
  const q = (document.getElementById('activity-search')?.value || '').trim().toLowerCase();
  const f = document.getElementById('activity-filter')?.value || '';
  const filtered = ACTIVITY_CACHE.filter(ev => {{
    if (f && !(String(ev.action||'').startsWith(f))) return false;
    if (q) {{
      const hay = (ev.actor + ' ' + ev.action + ' ' + ev.target + ' ' + JSON.stringify(ev.meta||{{}})).toLowerCase();
      if (!hay.includes(q)) return false;
    }}
    return true;
  }});
  if (!filtered.length) {{
    el.innerHTML = '<div style="padding:18px; text-align:center; color:#888;">No activity yet. Admin actions (invites, suspends, branding edits, key rotations…) will appear here.</div>';
    return;
  }}
  let html = '<table><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr>';
  for (const ev of filtered) {{
    const when = ev.createdAt ? new Date(ev.createdAt).toLocaleString() : '—';
    const rel = _fmtRelative(ev.createdAt);
    const label = ACTION_LABELS[ev.action] || ev.action;
    let detail = '';
    const meta = ev.meta || {{}};
    const bits = [];
    if (meta.expiresAt) bits.push('expires: ' + new Date(meta.expiresAt).toLocaleDateString());
    if (meta.expiresAt === null && ev.action === 'member.expiry_change') bits.push('expiry cleared');
    if (meta.added != null) bits.push('added: ' + meta.added);
    if (meta.alreadyMember) bits.push('already: ' + meta.alreadyMember);
    if (meta.invalidEmail) bits.push('invalid: ' + meta.invalidEmail);
    if (meta.noSeats) bits.push('no seats: ' + meta.noSeats);
    if (meta.brandColor) bits.push('color: ' + meta.brandColor);
    if (meta.allowedDomains) bits.push('domains: ' + meta.allowedDomains);
    if (meta.allowedDomains === null) bits.push('domains: (cleared)');
    if (meta.keyHint) bits.push('key …' + meta.keyHint);
    if (meta.keyPolicy) bits.push('policy: ' + meta.keyPolicy);
    if (meta.billingBehavior) bits.push('billing: ' + meta.billingBehavior);
    if (meta.variant) bits.push('variant: ' + meta.variant);
    if (meta.result) bits.push(meta.result);
    detail = bits.map(esc).join(' · ');
    html += '<tr>' +
      '<td title="' + esc(when) + '">' + esc(rel) + '</td>' +
      '<td>' + esc(ev.actor || '—') + '</td>' +
      '<td>' + esc(label) + '</td>' +
      '<td>' + esc(ev.target || '—') + '</td>' +
      '<td style="color:#aaa; font-size:12px;">' + detail + '</td>' +
      '</tr>';
  }}
  html += '</table>';
  html += '<div style="margin-top:6px; font-size:11px; color:#666;">Showing ' + filtered.length + ' of ' + ACTIVITY_CACHE.length + ' events.</div>';
  el.innerHTML = html;
}}
loadActivity();

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
            SELECT id, email, role, status, invited_by, joined_at, last_seen, expires_at
            FROM institution_members WHERE institution_id=%s ORDER BY joined_at DESC
        """, (inst_id,))
        now_dt = datetime.now()
        members = [{
            'id': row[0], 'email': row[1], 'role': row[2], 'status': row[3],
            'invitedBy': row[4],
            'joinedAt': row[5].isoformat() if row[5] else None,
            'lastSeen': row[6].isoformat() if row[6] else None,
            'expiresAt': row[7].isoformat() if row[7] else None,
            'expired': bool(row[7] and row[7] < now_dt)
        } for row in cur.fetchall()]
        cur.close(); conn.close()
        return _cors(jsonify({'success': True, 'members': members, 'total': len(members)}))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500

_EMAIL_RE = re.compile(r'^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$')


def _log_inst_action(cur, inst_id, actor, action, target=None, meta=None):
    """Task #37 — record an admin action against an institution.

    Best-effort: any failure is swallowed so an audit-log glitch never breaks
    the underlying admin operation. `meta` should be a small JSON-serializable
    dict (we coerce non-serializable values to strings)."""
    try:
        if not inst_id or not action:
            return
        meta_json = None
        if meta is not None:
            try:
                meta_json = json.dumps(meta, default=str)[:4000]
            except Exception:
                meta_json = json.dumps({'_unserializable': str(meta)[:500]})
        cur.execute(
            "INSERT INTO institution_audit_log (institution_id, actor_email, action, target, meta) "
            "VALUES (%s,%s,%s,%s,%s::jsonb)",
            (inst_id, (actor or 'unknown')[:200], action[:60],
             (target or '')[:300] if target else None, meta_json)
        )
    except Exception as _audit_err:
        print(f'⚠ audit log insert failed: {_audit_err}')


def _add_member(cur, inst_id, email, invited_by, role='member', expires_at=None):
    """Returns 'added', 'already', or 'invalid'.
    `expires_at` is a `datetime` (or None for no expiry). When set, the member's
    institution access is revoked once the date passes — the resolve function
    treats them as inactive, and their subscription row's `subscription_end`
    is mirrored so the existing paywall logic also cuts them off.
    """
    email = _norm_email(email)
    if not email or not _EMAIL_RE.match(email):
        return 'invalid'
    # On conflict, refresh the expiry but PRESERVE a 'suspended' status so
    # bulk re-add doesn't silently un-suspend a member the admin previously
    # blocked. Use the explicit Reactivate button for that.
    cur.execute("""
        INSERT INTO institution_members (institution_id, email, role, status, invited_by, joined_at, expires_at)
        VALUES (%s,%s,%s,'active',%s,NOW(),%s)
        ON CONFLICT (institution_id, email) DO UPDATE
            SET status = CASE WHEN institution_members.status = 'suspended'
                              THEN 'suspended' ELSE 'active' END,
                expires_at = EXCLUDED.expires_at
        RETURNING (xmax = 0) AS inserted
    """, (inst_id, email, role, invited_by or 'inst-admin', expires_at))
    row = cur.fetchone()
    is_new = bool(row and row[0])
    # Mirror the member expiry onto the subscription row so the existing
    # paywall logic naturally cuts them off (NULL = no expiry).
    cur.execute("""
        UPDATE subscriptions SET plan_type=CASE WHEN plan_type IN ('monthly','yearly') AND status='active' THEN plan_type ELSE 'institution' END,
                                  status='active', subscription_end=%s, last_verified=NOW(), updated_at=NOW()
        WHERE LOWER(email)=%s
    """, (expires_at, email))
    cur.execute("""
        INSERT INTO subscriptions (email, plan_type, status, subscription_start, subscription_end, last_verified, created_at, updated_at)
        VALUES (%s,'institution','active',NOW(),%s,NOW(),NOW(),NOW())
        ON CONFLICT (email) DO NOTHING
    """, (email, expires_at))
    cur.execute("UPDATE users SET institution_id=%s WHERE LOWER(email)=%s", (inst_id, email))
    return 'added' if is_new else 'already'


def _parse_expiry_input(data):
    """Parse `expiresAt` (ISO8601 date/datetime) or `durationDays` (positive int)
    from a request payload. Returns a `datetime` or None. Raises ValueError on
    malformed input."""
    if not data:
        return None
    raw = data.get('expiresAt')
    if raw:
        s = str(raw).strip()
        if not s:
            return None
        try:
            # Accept date-only ('YYYY-MM-DD') and full ISO8601 datetimes.
            if len(s) == 10 and s[4] == '-' and s[7] == '-':
                return datetime.strptime(s, '%Y-%m-%d')
            return datetime.fromisoformat(s.replace('Z', '+00:00')).replace(tzinfo=None)
        except Exception:
            raise ValueError('expiresAt must be YYYY-MM-DD or ISO8601 datetime')
    days = data.get('durationDays')
    if days in (None, '', 0, '0'):
        return None
    try:
        n = int(days)
    except Exception:
        raise ValueError('durationDays must be an integer')
    if n <= 0:
        return None
    if n > 3650:
        raise ValueError('durationDays cannot exceed 3650 (10 years)')
    return datetime.now() + timedelta(days=n)

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
        expires_at = _parse_expiry_input(data)
    except ValueError as ve:
        return _cors(jsonify({'success': False, 'error': str(ve)})), 400
    send_welcome = data.get('sendWelcome', True)
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("SELECT id, seat_limit, name, brand_color, logo_url FROM institutions WHERE slug=%s", (slug,))
        r = cur.fetchone()
        if not r:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Not found'})), 404
        inst_id, seat_limit, inst_name, brand_color, logo_url = r[0], r[1], r[2], r[3], r[4]
        if seat_limit and _seats_used(cur, inst_id) >= seat_limit:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Seat limit reached. Increase the limit or remove inactive members.'})), 400
        result = _add_member(cur, inst_id, email, admin_email or 'inst-admin', expires_at=expires_at)
        if result in ('added', 'already'):
            _log_inst_action(cur, inst_id, admin_email or 'inst-admin',
                             'member.invite', email,
                             {'result': result,
                              'expiresAt': expires_at.isoformat() if expires_at else None,
                              'sendWelcome': bool(send_welcome)})
        conn.commit()
        cur.close(); conn.close()
        if result == 'invalid':
            return _cors(jsonify({'success': False, 'error': 'Invalid email format'})), 400
        email_sent = False
        email_error = None
        if send_welcome and result == 'added':
            email_sent, email_error = _send_welcome_email(email, inst_name, brand_color, logo_url)
        return _cors(jsonify({
            'success': True, 'result': result,
            'expiresAt': expires_at.isoformat() if expires_at else None,
            'emailSent': email_sent,
            'emailError': email_error if (send_welcome and result == 'added' and not email_sent) else None
        }))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500


@app.route('/api/institution/<slug>/members/<int:member_id>/resend-welcome', methods=['POST', 'OPTIONS'])
def api_inst_member_resend_welcome(slug, member_id):
    """Resend the branded welcome email to an existing institution member."""
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
            SELECT m.email, i.name, i.brand_color, i.logo_url
              FROM institution_members m JOIN institutions i ON i.id = m.institution_id
              WHERE m.id=%s AND i.slug=%s
        """, (member_id, slug))
        row = cur.fetchone()
        cur.close(); conn.close()
        if not row:
            return _cors(jsonify({'success': False, 'error': 'Member not found'})), 404
        email, inst_name, brand_color, logo_url = row
        ok_send, err = _send_welcome_email(email, inst_name, brand_color, logo_url)
        if not ok_send:
            return _cors(jsonify({'success': False, 'error': err or 'Email send failed'})), 502
        return _cors(jsonify({'success': True, 'email': email}))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500


@app.route('/api/institution/<slug>/members/<int:member_id>/expiry', methods=['PUT', 'OPTIONS'])
def api_inst_member_set_expiry(slug, member_id):
    """Update an existing member's access expiry. Body accepts `expiresAt`
    (ISO date/datetime) or `durationDays` (positive int). Pass either as null/0
    to clear expiry (lifetime access). Mirrors expiry into subscriptions table."""
    if request.method == 'OPTIONS':
        return _options('PUT, OPTIONS')
    ok, admin_email = _verify_inst_admin(slug)
    if not ok:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    data = request.get_json(silent=True) or {}
    try:
        expires_at = _parse_expiry_input(data)
    except ValueError as ve:
        return _cors(jsonify({'success': False, 'error': str(ve)})), 400
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("""
            UPDATE institution_members SET expires_at=%s
              WHERE id=%s AND institution_id=(SELECT id FROM institutions WHERE slug=%s)
            RETURNING email
        """, (expires_at, member_id, slug))
        row = cur.fetchone()
        if not row:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Member not found'})), 404
        email = row[0]
        # Mirror onto subscriptions so the existing paywall logic respects it.
        cur.execute("""
            UPDATE subscriptions SET subscription_end=%s, last_verified=NOW(), updated_at=NOW()
              WHERE LOWER(email)=%s
        """, (expires_at, _norm_email(email)))
        cur.execute("SELECT id FROM institutions WHERE slug=%s", (slug,))
        _r = cur.fetchone()
        if _r:
            _log_inst_action(cur, _r[0], admin_email or 'inst-admin',
                             'member.expiry_change', email,
                             {'expiresAt': expires_at.isoformat() if expires_at else None,
                              'memberId': member_id})
        conn.commit()
        cur.close(); conn.close()
        return _cors(jsonify({
            'success': True,
            'expiresAt': expires_at.isoformat() if expires_at else None
        }))
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
    expiry_input = {}
    upload = request.files.get('file') or request.files.get('csv')
    if upload and upload.filename:
        try:
            raw = upload.read(200 * 1024).decode('utf-8', errors='ignore')
        except Exception as e:
            return _cors(jsonify({'success': False, 'error': f'Could not read CSV file: {e}'})), 400
        # Form fields ride alongside the file upload.
        expiry_input = {
            'expiresAt': request.form.get('expiresAt'),
            'durationDays': request.form.get('durationDays')
        }
    else:
        data = request.get_json(silent=True) or {}
        raw = str(data.get('csv', ''))[:50000]
        expiry_input = data
    try:
        bulk_expires_at = _parse_expiry_input(expiry_input)
    except ValueError as ve:
        return _cors(jsonify({'success': False, 'error': str(ve)})), 400
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
    # Toggle defaults to ON. Normalize for both content types: form field for
    # multipart and JSON key for application/json. Strings like "false"/"0"
    # must NOT be coerced to True via bool().
    def _truthy(v, default=True):
        if v is None:
            return default
        if isinstance(v, bool):
            return v
        return str(v).strip().lower() not in ('0', 'false', 'no', 'off', '')
    if upload and upload.filename:
        send_welcome = _truthy(request.form.get('sendWelcome'))
    else:
        send_welcome = _truthy(expiry_input.get('sendWelcome') if isinstance(expiry_input, dict) else None)
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("SELECT id, seat_limit, name, brand_color, logo_url FROM institutions WHERE slug=%s", (slug,))
        r = cur.fetchone()
        if not r:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Not found'})), 404
        inst_id, seat_limit, inst_name, brand_color, logo_url = r[0], r[1], r[2], r[3], r[4]
        added = 0
        already_member = 0
        invalid_email = len(invalid_format)
        no_seats = 0
        newly_added_emails = []
        for e in candidates:
            if seat_limit and _seats_used(cur, inst_id) >= seat_limit:
                no_seats += 1
                continue
            res = _add_member(cur, inst_id, e, admin_email or 'csv-bulk', expires_at=bulk_expires_at)
            if res == 'added':
                added += 1
                newly_added_emails.append(e)
            elif res == 'already':
                already_member += 1
            else:
                invalid_email += 1
        _log_inst_action(cur, inst_id, admin_email or 'inst-admin',
                         'member.invite_bulk', None,
                         {'added': added, 'alreadyMember': already_member,
                          'invalidEmail': invalid_email, 'noSeats': no_seats,
                          'total': len(candidates) + len(invalid_format),
                          'expiresAt': bulk_expires_at.isoformat() if bulk_expires_at else None,
                          'sendWelcome': bool(send_welcome)})
        conn.commit()
        cur.close(); conn.close()
        emails_sent = 0
        emails_failed = 0
        last_email_error = None
        if send_welcome and newly_added_emails:
            for e in newly_added_emails:
                ok_send, err = _send_welcome_email(e, inst_name, brand_color, logo_url)
                if ok_send:
                    emails_sent += 1
                else:
                    emails_failed += 1
                    last_email_error = err
        skipped = already_member + invalid_email + no_seats
        return _cors(jsonify({
            'success': True,
            'added': added,
            'alreadyMember': already_member,
            'invalidEmail': invalid_email,
            'noSeats': no_seats,
            'skipped': skipped,
            'total': len(candidates) + len(invalid_format),
            'invalidSamples': invalid_format[:5],
            'emailsSent': emails_sent,
            'emailsFailed': emails_failed,
            'emailError': last_email_error if emails_failed else None
        }))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500

@app.route('/api/institution/<slug>/domains', methods=['POST', 'OPTIONS'])
def api_inst_set_domains(slug):
    """Institution-admin endpoint to set the auto-join allowed_domains list.
    Public-email domains (gmail/outlook/etc.) are stripped server-side."""
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    ok, admin_email = _verify_inst_admin(slug)
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
        cur.execute("UPDATE institutions SET allowed_domains=%s, updated_at=NOW() WHERE slug=%s RETURNING id", (final or None, slug))
        _r = cur.fetchone()
        if _r:
            _log_inst_action(cur, _r[0], admin_email or 'inst-admin',
                             'domains.set', None,
                             {'allowedDomains': final or None})
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
    ok, admin_email = _verify_inst_admin(slug)
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
        if _is_branding_locked(cur, slug):
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Branding is locked by your account manager. Contact SnapToAI support.'})), 403
        if color:
            cur.execute("UPDATE institutions SET brand_color=%s, updated_at=NOW() WHERE slug=%s RETURNING id", (color, slug))
            _r = cur.fetchone()
            if _r:
                _log_inst_action(cur, _r[0], admin_email or 'inst-admin',
                                 'branding.color', None, {'brandColor': color})
        conn.commit()
        cur.close(); conn.close()
        return _cors(jsonify({'success': True, 'brandColor': color}))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500


# ============================================
# Task #27 — Institution Gemini key admin endpoints.
# All four require an authenticated institution admin (cookie session) or
# super-admin. The plaintext key is accepted ONLY on POST and never returned.
# ============================================

@app.route('/api/institution/<slug>/gemini-key', methods=['GET', 'POST', 'DELETE', 'OPTIONS'])
def api_inst_gemini_key(slug):
    if request.method == 'OPTIONS':
        return _options('GET, POST, DELETE, OPTIONS')
    ok, admin_email = _verify_inst_admin(slug)
    if not ok:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("""
            SELECT id, gemini_key_encrypted, gemini_key_hint, key_policy, billing_behavior,
                   key_set_at, key_last_rotated_at, key_last_used_at
            FROM institutions WHERE slug=%s
        """, (slug,))
        row = cur.fetchone()
        if not row:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Not found'})), 404
        inst_id = row[0]

        if request.method == 'GET':
            cur.close(); conn.close()
            return _cors(jsonify({
                'success': True,
                'hasKey': bool(row[1]),
                'keyHint': row[2] or '',
                'keyPolicy': row[3] or 'prefer-user-key',
                'billingBehavior': row[4] or 'count-against-snaptoai-quota',
                'keySetAt': row[5].isoformat() if row[5] else None,
                'keyLastRotatedAt': row[6].isoformat() if row[6] else None,
                'keyLastUsedAt': row[7].isoformat() if row[7] else None,
            }))

        if request.method == 'DELETE':
            cur.execute("""
                UPDATE institutions
                SET gemini_key_encrypted=NULL, gemini_key_hint=NULL,
                    key_last_rotated_at=NOW(), updated_at=NOW()
                WHERE id=%s
            """, (inst_id,))
            _log_inst_action(cur, inst_id, admin_email or 'inst-admin',
                             'gemini_key.delete', None, {'previousHint': row[2] or ''})
            conn.commit()
            cur.close(); conn.close()
            return _cors(jsonify({'success': True}))

        # POST — set or rotate the key.
        data = request.get_json(silent=True) or {}
        key = str(data.get('key') or '').strip()
        skip_test = bool(data.get('skipTest'))
        if len(key) < 10 or len(key) > 200:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Key looks invalid (must be 10–200 chars)'})), 400
        # Task #27 — verify the key works against Google BEFORE persisting, so a
        # bad key can't silently break every member in `institution-only` mode.
        # Admin can pass {skipTest: true} to override (e.g., temporary outage).
        if not skip_test:
            ok_test, test_msg = _test_gemini_key(key)
            if not ok_test:
                cur.close(); conn.close()
                return _cors(jsonify({
                    'success': False,
                    'error': f'Google rejected this key: {test_msg}. Pass skipTest=true to save anyway.'
                })), 400
        try:
            encrypted = _encrypt_inst_key(key)
        except RuntimeError as enc_err:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': str(enc_err)})), 500
        hint = key[-4:] if len(key) >= 4 else ''
        was_already_set = bool(row[1])
        if was_already_set:
            cur.execute("""
                UPDATE institutions
                SET gemini_key_encrypted=%s, gemini_key_hint=%s,
                    key_last_rotated_at=NOW(), updated_at=NOW()
                WHERE id=%s
            """, (encrypted, hint, inst_id))
        else:
            cur.execute("""
                UPDATE institutions
                SET gemini_key_encrypted=%s, gemini_key_hint=%s,
                    key_set_at=NOW(), key_last_rotated_at=NOW(), updated_at=NOW()
                WHERE id=%s
            """, (encrypted, hint, inst_id))
        _log_inst_action(cur, inst_id, admin_email or 'inst-admin',
                         'gemini_key.rotate' if was_already_set else 'gemini_key.set',
                         None,
                         {'keyHint': hint, 'skipTest': bool(skip_test)})
        conn.commit()
        cur.close(); conn.close()
        return _cors(jsonify({'success': True, 'rotated': was_already_set, 'keyHint': hint}))
    except Exception as e:
        print(f'❌ inst gemini-key: {e}')
        return _cors(jsonify({'success': False, 'error': str(e)})), 500


@app.route('/api/institution/<slug>/gemini-key/test', methods=['POST', 'OPTIONS'])
def api_inst_gemini_key_test(slug):
    """Test connectivity. Body: {key: '...'} to test a pasted key BEFORE saving,
    or {stored: true} to test the currently saved (encrypted) key."""
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    ok, _ = _verify_inst_admin(slug)
    if not ok:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    data = request.get_json(silent=True) or {}
    key = ''
    if data.get('stored'):
        try:
            conn = get_db(); cur = conn.cursor()
            cur.execute("SELECT gemini_key_encrypted FROM institutions WHERE slug=%s", (slug,))
            r = cur.fetchone()
            cur.close(); conn.close()
            if not r or not r[0]:
                return _cors(jsonify({'success': True, 'ok': False, 'message': 'No stored key'}))
            key = _decrypt_inst_key(r[0]) or ''
            if not key:
                return _cors(jsonify({'success': True, 'ok': False, 'message': 'Stored key could not be decrypted (encryption secret may have changed). Re-paste the key.'}))
        except Exception as e:
            return _cors(jsonify({'success': False, 'error': str(e)})), 500
    else:
        key = str(data.get('key') or '').strip()
        if not key:
            return _cors(jsonify({'success': False, 'error': 'key or stored=true required'})), 400
    ok_test, msg = _test_gemini_key(key)
    return _cors(jsonify({'success': True, 'ok': ok_test, 'message': msg}))


@app.route('/api/institution/<slug>/gemini-key/policy', methods=['PUT', 'OPTIONS'])
def api_inst_gemini_key_policy(slug):
    """Update key_policy + billing_behavior."""
    if request.method == 'OPTIONS':
        return _options('PUT, OPTIONS')
    ok, admin_email = _verify_inst_admin(slug)
    if not ok:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    data = request.get_json(silent=True) or {}
    policy = str(data.get('keyPolicy') or '').strip()
    billing = str(data.get('billingBehavior') or '').strip()
    if policy not in ('institution-only', 'prefer-institution-key', 'prefer-user-key'):
        return _cors(jsonify({'success': False, 'error': 'Invalid keyPolicy'})), 400
    if billing not in ('bypass-snaptoai-quota', 'count-against-snaptoai-quota'):
        return _cors(jsonify({'success': False, 'error': 'Invalid billingBehavior'})), 400
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("""
            UPDATE institutions SET key_policy=%s, billing_behavior=%s, updated_at=NOW()
            WHERE slug=%s RETURNING id
        """, (policy, billing, slug))
        _r = cur.fetchone()
        if _r:
            _log_inst_action(cur, _r[0], admin_email or 'inst-admin',
                             'gemini_key.policy', None,
                             {'keyPolicy': policy, 'billingBehavior': billing})
        conn.commit()
        cur.close(); conn.close()
        return _cors(jsonify({'success': True, 'keyPolicy': policy, 'billingBehavior': billing}))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500


@app.route('/api/institution/<slug>/branding/logo', methods=['POST', 'DELETE', 'OPTIONS'])
def api_inst_upload_logo(slug):
    """Institution-admin logo upload. Blocked when branding_locked=TRUE.
    Pass form/query field ``variant=light`` to target the optional Light-mode
    logo variant instead of the default (dark-surface) logo. DELETE clears
    just that variant."""
    if request.method == 'OPTIONS':
        return _options('POST, DELETE, OPTIONS')
    ok, admin_email = _verify_inst_admin(slug)
    if not ok:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    _lc = get_db(); _lcur = _lc.cursor()
    locked = _is_branding_locked(_lcur, slug)
    _lcur.close(); _lc.close()
    if locked:
        return _cors(jsonify({'success': False, 'error': 'Branding is locked by your account manager. Contact SnapToAI support.'})), 403
    column, suffix, resp_key = _logo_variant_meta(request)
    try:
        os.makedirs(INSTITUTION_LOGO_DIR, exist_ok=True)
        # DELETE clears just this variant.
        if request.method == 'DELETE':
            for old in os.listdir(INSTITUTION_LOGO_DIR):
                base, _, _e = old.rpartition('.')
                if suffix:
                    if old.startswith(slug + suffix + '.'):
                        try: os.remove(os.path.join(INSTITUTION_LOGO_DIR, old))
                        except Exception: pass
                else:
                    if base == slug:
                        try: os.remove(os.path.join(INSTITUTION_LOGO_DIR, old))
                        except Exception: pass
            conn = get_db(); cur = conn.cursor()
            cur.execute(f"UPDATE institutions SET {column}=NULL, updated_at=NOW() WHERE slug=%s RETURNING id", (slug,))
            _r = cur.fetchone()
            if _r:
                _log_inst_action(cur, _r[0], admin_email or 'inst-admin',
                                 'branding.logo_delete', None,
                                 {'variant': suffix or 'default', 'column': column})
            conn.commit()
            cur.close(); conn.close()
            return _cors(jsonify({'success': True, resp_key: None}))
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
        # Remove old files of THIS variant only — don't clobber the other variant.
        for old in os.listdir(INSTITUTION_LOGO_DIR):
            base, _, _e = old.rpartition('.')
            if suffix:
                if old.startswith(slug + suffix + '.'):
                    try: os.remove(os.path.join(INSTITUTION_LOGO_DIR, old))
                    except Exception: pass
            else:
                if base == slug:
                    try: os.remove(os.path.join(INSTITUTION_LOGO_DIR, old))
                    except Exception: pass
        target = os.path.join(INSTITUTION_LOGO_DIR, slug + suffix + ext)
        with open(target, 'wb') as out:
            out.write(blob)
        logo_url = f'/static/institution-logos/{slug}{suffix}{ext}?v={int(time.time())}'
        conn = get_db(); cur = conn.cursor()
        cur.execute(f"UPDATE institutions SET {column}=%s, updated_at=NOW() WHERE slug=%s RETURNING id", (logo_url, slug))
        _r = cur.fetchone()
        if _r:
            _log_inst_action(cur, _r[0], admin_email or 'inst-admin',
                             'branding.logo_upload', None,
                             {'variant': suffix or 'default', 'column': column,
                              'ext': ext, 'bytes': len(blob)})
        conn.commit()
        cur.close(); conn.close()
        return _cors(jsonify({'success': True, resp_key: logo_url}))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500


# Invite links were retired in favor of email-only institution onboarding.
# These endpoints return a friendly 410 so any cached admin UI from older
# extension/dashboard versions surfaces a clear message instead of crashing.
_INVITE_RETIRED_MSG = 'Invite links have been retired — add members by email instead. They are auto-enrolled when they sign in to the extension.'

@app.route('/api/institution/<slug>/invite-link', methods=['POST', 'OPTIONS'])
def api_inst_invite_link(slug):
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    return _cors(jsonify({'success': False, 'error': 'invite_links_retired', 'message': _INVITE_RETIRED_MSG})), 410

@app.route('/api/institution/<slug>/invite-links', methods=['GET', 'OPTIONS'])
def api_inst_invite_links_list(slug):
    if request.method == 'OPTIONS':
        return _options('GET, OPTIONS')
    return _cors(jsonify({'success': False, 'error': 'invite_links_retired', 'links': [], 'message': _INVITE_RETIRED_MSG})), 410

@app.route('/api/institution/<slug>/invite-link/<int:link_id>', methods=['DELETE', 'OPTIONS'])
def api_inst_invite_link_delete(slug, link_id):
    if request.method == 'OPTIONS':
        return _options('DELETE, OPTIONS')
    return _cors(jsonify({'success': False, 'error': 'invite_links_retired', 'message': _INVITE_RETIRED_MSG})), 410

@app.route('/api/institution/<slug>/members/export.csv', methods=['GET'])
def api_inst_members_export_csv(slug):
    """Admin-only CSV export of the full member roster. Mirrors the columns
    shown in the dashboard table so admins can keep an offline backup or
    re-import elsewhere."""
    ok, _ = _verify_inst_admin(slug)
    if not ok:
        return Response('Unauthorized', status=401)
    if not ensure_db():
        return Response('Database not available', status=503)
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("""
            SELECT m.email, m.role, m.status, m.joined_at, m.last_seen, m.expires_at, m.invited_by
            FROM institution_members m
            JOIN institutions i ON i.id = m.institution_id
            WHERE i.slug=%s
            ORDER BY m.joined_at DESC NULLS LAST, m.email ASC
        """, (slug,))
        rows = cur.fetchall()
        cur.close(); conn.close()
        import io, csv
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(['email', 'role', 'status', 'joined_at', 'last_seen', 'expires_at', 'expired', 'invited_by'])
        now = datetime.now()
        for r in rows:
            email, role, status, joined, seen, exp, invited = r
            expired = bool(exp and exp < now)
            w.writerow([
                email or '', role or '', status or '',
                joined.isoformat() if joined else '',
                seen.isoformat() if seen else '',
                exp.isoformat() if exp else '',
                'yes' if expired else '',
                invited or ''
            ])
        resp = Response(buf.getvalue(), mimetype='text/csv')
        resp.headers['Content-Disposition'] = f'attachment; filename="{slug}-members-{datetime.now().strftime("%Y%m%d")}.csv"'
        resp.headers['Cache-Control'] = 'no-store'
        return resp
    except Exception as e:
        return Response(f'Error: {e}', status=500)


@app.route('/api/institution/<slug>/activity', methods=['GET', 'OPTIONS'])
def api_inst_activity(slug):
    """Task #37 — return the most recent ~100 admin audit-log entries for
    this institution. Admin-only. Powers the Activity section of the
    institution dashboard."""
    if request.method == 'OPTIONS':
        return _options('GET, OPTIONS')
    ok, _ = _verify_inst_admin(slug)
    if not ok:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    try:
        try:
            limit = int(request.args.get('limit', '100'))
        except Exception:
            limit = 100
        limit = max(1, min(500, limit))
        conn = get_db(); cur = conn.cursor()
        cur.execute("SELECT id FROM institutions WHERE slug=%s", (slug,))
        r = cur.fetchone()
        if not r:
            cur.close(); conn.close()
            return _cors(jsonify({'success': False, 'error': 'Not found'})), 404
        inst_id = r[0]
        cur.execute("""
            SELECT id, actor_email, action, target, meta, created_at
            FROM institution_audit_log
            WHERE institution_id=%s
            ORDER BY created_at DESC, id DESC
            LIMIT %s
        """, (inst_id, limit))
        events = []
        for row in cur.fetchall():
            meta = row[4]
            # JSONB returns dict already in psycopg2; coerce string just in case.
            if isinstance(meta, str):
                try: meta = json.loads(meta)
                except Exception: meta = {'raw': meta}
            events.append({
                'id': row[0],
                'actor': row[1] or '',
                'action': row[2] or '',
                'target': row[3] or '',
                'meta': meta or {},
                'createdAt': row[5].isoformat() if row[5] else None,
            })
        cur.close(); conn.close()
        return _cors(jsonify({'success': True, 'events': events, 'total': len(events)}))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500


@app.route('/api/institution/<slug>/activity/export.csv', methods=['GET'])
def api_inst_activity_export_csv(slug):
    """Task #37 — admin-only CSV export of the audit log so admins can keep
    an offline accountability record (or send to compliance)."""
    ok, _ = _verify_inst_admin(slug)
    if not ok:
        return Response('Unauthorized', status=401)
    if not ensure_db():
        return Response('Database not available', status=503)
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("""
            SELECT a.created_at, a.actor_email, a.action, a.target, a.meta
            FROM institution_audit_log a
            JOIN institutions i ON i.id = a.institution_id
            WHERE i.slug=%s
            ORDER BY a.created_at DESC, a.id DESC
        """, (slug,))
        rows = cur.fetchall()
        cur.close(); conn.close()
        import io, csv
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(['timestamp', 'actor_email', 'action', 'target', 'meta_json'])
        for created_at, actor, action, target, meta in rows:
            if isinstance(meta, (dict, list)):
                meta_str = json.dumps(meta, default=str)
            elif meta is None:
                meta_str = ''
            else:
                meta_str = str(meta)
            w.writerow([
                created_at.isoformat() if created_at else '',
                actor or '', action or '', target or '', meta_str
            ])
        resp = Response(buf.getvalue(), mimetype='text/csv')
        resp.headers['Content-Disposition'] = f'attachment; filename="{slug}-activity-{datetime.now().strftime("%Y%m%d")}.csv"'
        return resp
    except Exception as e:
        return Response(f'Error: {e}', status=500)


@app.route('/api/institution/<slug>/members/<int:member_id>/suspend', methods=['POST', 'OPTIONS'])
def api_inst_member_suspend(slug, member_id):
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    ok, admin_email = _verify_inst_admin(slug)
    if not ok:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("""
            UPDATE institution_members SET status='suspended'
            WHERE id=%s AND institution_id=(SELECT id FROM institutions WHERE slug=%s)
            RETURNING email, institution_id
        """, (member_id, slug))
        r = cur.fetchone()
        if r:
            cur.execute("UPDATE subscriptions SET status='inactive', updated_at=NOW() WHERE LOWER(email)=%s AND plan_type='institution'", (_norm_email(r[0]),))
            _log_inst_action(cur, r[1], admin_email or 'inst-admin',
                             'member.suspend', r[0], {'memberId': member_id})
        conn.commit()
        cur.close(); conn.close()
        return _cors(jsonify({'success': True}))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500

@app.route('/api/institution/<slug>/members/<int:member_id>/reactivate', methods=['POST', 'OPTIONS'])
def api_inst_member_reactivate(slug, member_id):
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    ok, admin_email = _verify_inst_admin(slug)
    if not ok:
        return _cors(jsonify({'success': False, 'error': 'Unauthorized'})), 401
    if not ensure_db():
        return _cors(jsonify({'success': False, 'error': 'Database not available'})), 503
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("""
            UPDATE institution_members SET status='active'
            WHERE id=%s AND institution_id=(SELECT id FROM institutions WHERE slug=%s)
            RETURNING email, institution_id
        """, (member_id, slug))
        r = cur.fetchone()
        if r:
            cur.execute("UPDATE subscriptions SET status='active', updated_at=NOW() WHERE LOWER(email)=%s AND plan_type='institution'", (_norm_email(r[0]),))
            _log_inst_action(cur, r[1], admin_email or 'inst-admin',
                             'member.reactivate', r[0], {'memberId': member_id})
        conn.commit()
        cur.close(); conn.close()
        return _cors(jsonify({'success': True}))
    except Exception as e:
        return _cors(jsonify({'success': False, 'error': str(e)})), 500

@app.route('/api/institution/<slug>/members/<int:member_id>', methods=['DELETE', 'OPTIONS'])
def api_inst_member_delete(slug, member_id):
    if request.method == 'OPTIONS':
        return _options('DELETE, OPTIONS')
    ok, admin_email = _verify_inst_admin(slug)
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
            _log_inst_action(cur, r[1], admin_email or 'inst-admin',
                             'member.delete', r[0], {'memberId': member_id})
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
    """Invite links were retired in favor of email-only institution onboarding.
    Any old shared `/join/<code>` URL now lands on a friendly branded page
    explaining the new flow — no scary 404, no 'no longer active' wall."""
    # We deliberately ignore the code value: regardless of whether it is
    # historically valid, expired, or unknown, the user-facing answer is the
    # same — invites are now email-based, ask your admin to add your email.
    safe_color = '#00d9ff'
    page = f'''<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Join your institution on SnapToAI</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #0f0f1a 0%, #1a0f2e 100%); color: #fff; min-height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center; padding: 24px; }}
  .card {{ max-width: 540px; background: rgba(255,255,255,0.04); border: 1px solid {safe_color}55; border-radius: 20px; padding: 40px; text-align: center; backdrop-filter: blur(20px); }}
  h1 {{ color: {safe_color}; margin: 0 0 12px 0; font-size: 26px; }}
  p {{ color: #ccc; line-height: 1.6; }}
  .step {{ background: rgba(0,0,0,0.3); border-radius: 10px; padding: 16px; margin: 18px 0 8px; text-align: left; font-size: 14px; color: #ccc; }}
  .step strong {{ color: {safe_color}; }}
  a.cta {{ display: inline-block; margin-top: 14px; background: {safe_color}; color: #000; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: bold; }}
  a {{ color: {safe_color}; }}
</style></head>
<body>
<div class="card">
  <div style="font-size: 44px; margin-bottom: 8px;">📸</div>
  <h1>Invite links have been retired</h1>
  <p>SnapToAI institutions now use email-only onboarding — no codes, no extra hops.</p>
  <div class="step">
    <strong>How to join:</strong>
    <ol style="margin: 10px 0 0 0; padding-left: 22px; line-height: 1.7;">
      <li>Ask your admin to add your email to the institution.</li>
      <li>Install the SnapToAI Chrome extension.</li>
      <li>Sign in with Google using that same email — your branded license unlocks automatically.</li>
    </ol>
  </div>
  <a class="cta" href="https://chromewebstore.google.com/detail/snaptoai" target="_blank" rel="noopener">→ Install SnapToAI</a>
  <p style="margin-top: 18px; font-size: 12px; color: #888;">Need help? Contact your institution admin or <a href="mailto:support@snaptoai.com">support@snaptoai.com</a>.</p>
</div>
</body></html>'''
    resp = Response(page, mimetype='text/html')
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/api/institution/join', methods=['POST', 'OPTIONS'])
def api_institution_join():
    """Retired. Invite links are no longer redeemable; institution membership
    is granted via the admin email allowlist + Google sign-in on the extension."""
    if request.method == 'OPTIONS':
        return _options('POST, OPTIONS')
    return _cors(jsonify({'success': False, 'error': 'invite_links_retired', 'message': _INVITE_RETIRED_MSG})), 410


if __name__ == '__main__':
    print('✅ Landing page live at: 0.0.0.0:5000')
    print('🌍 54 languages available:')
    print('   /       → English (default)')
    print('   /ar     → Arabic')
    print('   /es     → Spanish')
    print('   /fr     → French')
    print('   ... and 50 more!')
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
