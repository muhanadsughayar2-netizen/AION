# Demo Institution Walkthrough — "Demo School"

This guide walks the SnapToAI owner through the full institution sign-up loop
end-to-end against a seeded **Demo School** institution: open the admin panel,
copy an invite code, paste it into the Chrome extension, sign in with Google,
and watch the popup re-skin itself with Demo School's branding.

> The same Chrome extension is used by every institution — there is **no
> custom build per school**. Branding is pushed from the server through the
> existing `/api/subscription/status` response and cached in
> `chrome.storage.local.snaptoai_branding`.

---

## 0. Seed (or reset) the demo institution

From the repo root:

```bash
python scripts/seed_demo_institution.py --admin-email you@yourdomain.com
```

The script is idempotent — running it twice will not duplicate the institution
or its invites. To start over completely:

```bash
python scripts/seed_demo_institution.py --reset --admin-email you@yourdomain.com
```

If you skip `--admin-email`, a placeholder (`demo-admin@snaptoai.example`) is
used; you will not be able to sign in to the admin panel until you re-run with
a real email you control.

What gets seeded:

| Field                | Value                          |
| -------------------- | ------------------------------ |
| Slug                 | `demo-school`                  |
| Display name         | Demo School                    |
| Brand color          | `#a855f7` (bright purple)      |
| Seat limit           | 10                             |
| Status               | active (no expiry)             |
| Primary admin email  | whatever you passed in         |
| Pre-seeded invite **code** | `demoschool-code-2026` (max 5 uses) |
| Pre-seeded invite **link** | `/join/demoschool-link-2026` (max 25 uses) |

---

## 1. Open the admin panel and sign in

1. Make sure the Landing Page workflow is running.
2. Visit **`/institution/demo-school/admin`** on your dev/preview URL.
3. You will see a Demo School-branded sign-in card. Click **Sign in with
   Google** and choose the same email you passed to `--admin-email`.
4. After sign-in the page reloads into the full dashboard with four tabs:
   **Members**, **Seats**, **Invites**, and **Branding**.

If sign-in is rejected with "You are not an admin of this institution",
re-run the seed script with the correct `--admin-email` and try again.

---

## 2. Find / copy an invite code

Two pre-seeded invites are already there, so you can test joining
immediately without first having to create one:

- **Invite code (paste-into-extension flow)** — `demoschool-code-2026`
  Find it in the **Invites** tab of the admin dashboard.
- **Invite link (one-click flow)** — `https://<your-host>/join/demoschool-link-2026`
  Click the **Copy link** button next to it in the dashboard.

You can also generate fresh ones from the Invites tab — that exercises
`POST /api/institution/demo-school/invite-link`.

---

## 3. Load the extension and join as a member

1. In Chrome, go to `chrome://extensions`, enable **Developer mode**, click
   **Load unpacked**, and pick the `flow-premium/` folder from this repo.
2. Click the SnapToAI icon → the welcome screen opens. (If it doesn't,
   right-click the icon and choose **Show welcome page**.)
3. Click the **"I have an invite code"** toggle, paste
   `demoschool-code-2026`, and hit **Save**. The pill should read
   *"Saved. Sign in with Google to join."*
4. Open the popup → click **Continue with Google** → sign in with a
   *different* Google account than the admin (so it actually consumes a seat).

What happens under the hood: the popup posts the invite code to
`/api/auth/register`, the server resolves the institution, marks the user
as a member, and returns the Demo School branding in the next
`/api/subscription/status` call.

### The three ways users can join

| Method               | When to use                               | Where it's wired                    |
| -------------------- | ----------------------------------------- | ----------------------------------- |
| **Invite code**      | Paste into extension welcome screen       | `flow-premium/welcome.js` → `snaptoai_pending_invite` → `/api/auth/register` |
| **Invite link** (`/join/<code>`) | Share a URL; one-click Google sign-in     | `app.py` `institution_join_page` → `/api/institution/join` |
| **Auto-join domain** | Anyone whose email matches `allowedDomains` joins automatically on first sign-in | `_resolve_institution_for_email` in `app.py` |

The Demo School seed leaves `allowed_domains` empty so auto-join doesn't
kick in by accident — to test that path, set a domain in the Branding tab
and sign in with a matching email.

---

## 4. Confirm the re-skin worked

Open the SnapToAI popup (and/or sidebar) again after sign-in. You should see:

- Buttons, focus rings, and accent badges all turn **purple** (`#a855f7`),
  adapted for whichever theme (Light/Dark) you're in. The adaptation is
  handled by `flow-premium/branding.js` (`SnapToAIBranding.apply`).
- The header / welcome string says **"Welcome to Demo School"** instead of
  the default SnapToAI brand mark.
- The cyan "AI" accents in headings switch to the same purple.

If colors don't change immediately, wait a few seconds (the popup re-checks
subscription state on open) or close and reopen the popup. The branding is
cached in `chrome.storage.local.snaptoai_branding`.

---

## 5. Confirm the new member appears in the admin dashboard

Back in `/institution/demo-school/admin`:

1. Reload the page.
2. The **Members** tab should now list the Google account you used in
   step 3 with role `member` and status `active`.
3. The **Seats** counter at the top of the dashboard should show
   `2 / 10` (the admin counts as 1, the new member as 1).
4. The Invites tab should show the **uses** counter on the invite code
   you used incremented from 0 → 1.

If everything above checks out, the full sign-up loop is verified end-to-end.

---

## Troubleshooting

| Symptom                                                | Fix |
| ------------------------------------------------------ | --- |
| Admin sign-in page says Google Sign-In is not configured | Make sure `GOOGLE_CLIENT_ID` is set in the environment. |
| Invite code rejected as `invalid_code`                 | Re-run the seed script; the code may have been deleted. |
| Re-skin doesn't appear                                 | Sign out + sign back in to force a fresh `/api/subscription/status` call. |
| Need a clean slate                                     | `python scripts/seed_demo_institution.py --reset --admin-email you@yourdomain.com` |
