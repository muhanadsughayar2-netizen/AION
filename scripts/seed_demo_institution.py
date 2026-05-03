#!/usr/bin/env python3
"""Seed (or refresh) the SnapToAI "Demo School" institution end-to-end.

Run from the repo root:

    python scripts/seed_demo_institution.py

Optional flags:
    --admin-email you@example.com    Set/replace the primary admin email
    --reset                          Delete the demo institution first, then re-seed

The script is idempotent: running it twice will not duplicate the institution,
its admin member, or its two seeded invites. It connects to the database via
the standard DATABASE_URL environment variable that app.py uses.

What it creates:
  • Institution slug=`demo-school`, name "Demo School", bright-purple brand
    color (#a855f7), seat_limit=10, status=active.
  • Primary admin member (role=admin) for the provided / placeholder email.
  • One invite **code** (max_uses=5) — shown in walkthrough as a code to paste.
  • One invite **link** (max_uses=25) — shared as `/join/<code>`.

Both invite rows live in the same `institution_invites` table; the only
difference is how the walkthrough surfaces them.
"""

import argparse
import os
import sys
import uuid

import psycopg2

DEFAULT_ADMIN_EMAIL = "demo-admin@snaptoai.example"
SLUG = "demo-school"
NAME = "Demo School"
BRAND_COLOR = "#a855f7"
SEAT_LIMIT = 10
INVITE_CODE_FIXED = "demoschool-code-2026"
INVITE_LINK_FIXED = "demoschool-link-2026"


def connect():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("❌ DATABASE_URL is not set. Run inside the Replit environment.", file=sys.stderr)
        sys.exit(1)
    sslmode = "require" if "neon" in db_url or "amazonaws" in db_url else "disable"
    try:
        return psycopg2.connect(db_url, sslmode="require")
    except Exception:
        return psycopg2.connect(db_url, sslmode=sslmode)


def upsert_invite(cur, inst_id, code, max_uses, label):
    cur.execute("SELECT id FROM institution_invites WHERE code=%s", (code,))
    row = cur.fetchone()
    if row:
        cur.execute(
            """
            UPDATE institution_invites
               SET institution_id=%s, max_uses=%s, uses=0, expires_at=NULL
             WHERE id=%s
            """,
            (inst_id, max_uses, row[0]),
        )
        print(f"  • {label} refreshed (code={code}, max_uses={max_uses}, uses reset to 0)")
    else:
        cur.execute(
            """
            INSERT INTO institution_invites (institution_id, code, max_uses, uses, created_by, created_at)
            VALUES (%s, %s, %s, 0, 'seed-script', NOW())
            """,
            (inst_id, code, max_uses),
        )
        print(f"  • {label} created (code={code}, max_uses={max_uses})")


def main():
    parser = argparse.ArgumentParser(description="Seed the Demo School institution.")
    parser.add_argument("--admin-email", default=os.environ.get("DEMO_ADMIN_EMAIL", DEFAULT_ADMIN_EMAIL))
    parser.add_argument("--reset", action="store_true", help="Delete the demo institution first")
    args = parser.parse_args()

    admin_email = (args.admin_email or "").strip().lower()
    if not admin_email or "@" not in admin_email:
        print("❌ --admin-email must be a valid email address.", file=sys.stderr)
        sys.exit(1)
    if admin_email == DEFAULT_ADMIN_EMAIL:
        print(
            f"⚠️  Using placeholder admin email: {DEFAULT_ADMIN_EMAIL}\n"
            "   Re-run with --admin-email you@yourdomain.com to be able to actually sign in."
        )

    conn = connect()
    cur = conn.cursor()

    # Verify the institutions table exists; if not, ask the user to start the app once
    # so init_db() runs.
    cur.execute(
        "SELECT 1 FROM information_schema.tables WHERE table_name='institutions'"
    )
    if not cur.fetchone():
        print(
            "❌ The `institutions` table does not exist yet. Start the Landing Page\n"
            "   workflow once so app.py runs init_db(), then re-run this script.",
            file=sys.stderr,
        )
        sys.exit(1)

    if args.reset:
        # Mirror what the super-admin DELETE endpoint does so we don't leave
        # stale users.institution_id / 'institution'-plan subscription rows
        # pointing at the about-to-be-deleted demo institution.
        cur.execute("SELECT id FROM institutions WHERE slug=%s", (SLUG,))
        old = cur.fetchone()
        if old:
            old_id = old[0]
            cur.execute(
                "SELECT LOWER(email) FROM institution_members WHERE institution_id=%s",
                (old_id,),
            )
            old_emails = [r[0] for r in cur.fetchall() if r[0]]
            cur.execute("UPDATE users SET institution_id=NULL WHERE institution_id=%s", (old_id,))
            if old_emails:
                cur.execute(
                    """
                    UPDATE subscriptions
                       SET status='inactive', updated_at=NOW()
                     WHERE plan_type='institution' AND LOWER(email) = ANY(%s)
                    """,
                    (old_emails,),
                )
            cur.execute("DELETE FROM institutions WHERE id=%s", (old_id,))
            print(
                f"🗑  Deleted existing `{SLUG}` institution (id={old_id}); "
                f"unlinked {len(old_emails)} user(s) and inactivated their institution subscriptions."
            )
        else:
            print(f"🗑  No existing `{SLUG}` institution to delete.")

    # Upsert the institution row.
    cur.execute("SELECT id FROM institutions WHERE slug=%s", (SLUG,))
    row = cur.fetchone()
    if row:
        inst_id = row[0]
        cur.execute(
            """
            UPDATE institutions
               SET name=%s, brand_color=%s, primary_admin_email=%s, seat_limit=%s,
                   status='active', expires_at=NULL, updated_at=NOW()
             WHERE id=%s
            """,
            (NAME, BRAND_COLOR, admin_email, SEAT_LIMIT, inst_id),
        )
        print(f"✅ Updated institution `{SLUG}` (id={inst_id}).")
    else:
        cur.execute(
            """
            INSERT INTO institutions
                (slug, name, brand_color, primary_admin_email, seat_limit,
                 status, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, 'active', NOW(), NOW())
            RETURNING id
            """,
            (SLUG, NAME, BRAND_COLOR, admin_email, SEAT_LIMIT),
        )
        inst_id = cur.fetchone()[0]
        print(f"✅ Created institution `{SLUG}` (id={inst_id}).")

    # Ensure the admin is a member with role=admin.
    cur.execute(
        """
        INSERT INTO institution_members
            (institution_id, email, role, status, invited_by, joined_at)
        VALUES (%s, %s, 'admin', 'active', 'seed-script', NOW())
        ON CONFLICT (institution_id, email) DO UPDATE
            SET role='admin', status='active'
        """,
        (inst_id, admin_email),
    )
    print(f"✅ Ensured admin member: {admin_email}")

    # Pre-seed one invite code + one invite link.
    upsert_invite(cur, inst_id, INVITE_CODE_FIXED, max_uses=5, label="Invite CODE")
    upsert_invite(cur, inst_id, INVITE_LINK_FIXED, max_uses=25, label="Invite LINK")

    conn.commit()
    cur.close()
    conn.close()

    print()
    print("🎉 Demo School is ready.")
    print(f"   Admin panel:  /institution/{SLUG}/admin   (sign in as {admin_email})")
    print(f"   Invite code:  {INVITE_CODE_FIXED}")
    print(f"   Invite link:  /join/{INVITE_LINK_FIXED}")
    print()
    print("   Reset everything with:  python scripts/seed_demo_institution.py --reset")


if __name__ == "__main__":
    main()
