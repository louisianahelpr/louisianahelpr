# Apple Sign In setup — finishing checklist

Started 2026-05-05. **Verified working end-to-end 2026-05-05.**
First-time sign-in lands on `/complete-profile` (SPA new-user onboarding
handler caught the freshly-minted Apple user); returning users land on
`/dashboard`. Full chain healthy: Apple → Supabase callback at
`fncmgoasalhdgfwzhsqa.supabase.co/auth/v1/callback` →
`www.louisianahelpr.com` → SPA session.

## Current state

| Item | Status |
|---|---|
| App ID `com.Helpr` has Sign In with Apple capability | ✅ |
| Sign In with Apple key created (`AuthKey_67WQZ3F8Q5.p8`) | ✅ |
| Services ID `com.Helpr.signin` saved | ✅ |
| Domains registered on Services ID + Supabase callback | ✅ |
| OAuth client_secret JWT generated | ✅ |
| Supabase Apple provider enabled + credentials pasted | ✅ |
| End-to-end web sign-in test | ✅ — landed on `/complete-profile` for first-time user |

## Known IDs (current — supersedes any earlier-doc references)

- **Team ID:** `P85MCK558V` (from "Helpr, Limited Liability Company")
- **Key ID:** `67WQZ3F8Q5` (matches filename `AuthKey_67WQZ3F8Q5.p8`)
  - The original `Y754ZY5DQ2` was revoked because its `.p8` was lost.
    Apple does not let you re-download the `.p8`; revoke + re-issue is
    the only path. Back the new one up to 1Password + iCloud Keychain.
- **Services ID:** `com.Helpr.signin` (Supabase calls this "Client ID")
- **Supabase callback URL:** `https://fncmgoasalhdgfwzhsqa.supabase.co/auth/v1/callback`
- **Supabase Site URL:** `https://www.louisianahelpr.com` (was a Vercel
  preview URL — fixed during the verification run)

## Setup steps (runbook for the next JWT-rotation window in ~5 months)

### 1. Services ID configuration

1. developer.apple.com → **Identifiers** → click into `com.Helpr.signin`
2. Find the **Sign In with Apple** row → click **Configure**
3. In the panel:
   - Primary App ID: `com.Helpr`
   - Domains: `louisianahelpr.com` and `www.louisianahelpr.com` (one per line)
   - Return URLs: the Supabase callback
     `https://fncmgoasalhdgfwzhsqa.supabase.co/auth/v1/callback`
4. Save the Services ID configuration.

> **Note (changed since this doc was first written):** Apple's UI no
> longer surfaces a `Download apple-developer-domain-association.txt`
> button. The `public/.well-known/...` deploy step is **obsolete for
> new accounts** — Apple validates domains at sign-in time via the
> redirect URI match. We saved with all 3 URLs without a verification
> round-trip.

### 2. Generate the OAuth client_secret JWT

Supabase requires a pre-signed JWT (not the raw `.p8`). The Apple key signs
this JWT, valid for up to 180 days; you'll regenerate it twice a year.

**Use the JWT generator already committed:**

URL: `https://www.louisianahelpr.com/tools/apple-jwt.html`

Local fallback if the URL is blocked:
- File location: `public/tools/apple-jwt.html`
- Open via `file:///Users/lexilombas/Developer/louisianahelpr/public/tools/apple-jwt.html` in any browser
- Runs entirely client-side (Web Crypto API) — `.p8` never leaves the browser

Inputs:
- Team ID: `P85MCK558V`
- Key ID: `67WQZ3F8Q5`
- Services ID: `com.Helpr.signin`
- Private Key: paste the full contents of `~/Downloads/AuthKey_67WQZ3F8Q5.p8` including BEGIN/END lines
- Expires in: `180` days

Click **Generate JWT** → copy the output.

### 3. Paste into Supabase

Studio → Authentication → Providers → **Apple**:

| Field | Value |
|---|---|
| Enable | ON |
| Client ID (Services ID) | `com.Helpr.signin` |
| Secret Key (for OAuth) | the JWT from step 2 |
| Skip nonce checks | OFF |
| Allow users without an email | OFF |

Save.

### 4. Test on production

- Visit `https://www.louisianahelpr.com/login` (incognito)
- Click "Continue with Apple"
- Complete Apple's flow with a test Apple ID
- **First-time users land on `/complete-profile`** (SPA onboarding
  handler — confirmed during the 2026-05-05 verification run)
- **Returning users land on `/dashboard`**

If the test fails with a Supabase auth error, the most common causes:
- JWT `iss` doesn't match the Apple Team ID — regenerate
- Services ID typo in the JWT `sub` — regenerate
- Services ID domain isn't verified yet — re-verify in Apple
- JWT expired (only happens after 180 days) — regenerate

## After Apple sign-in works ← we're here

- Set a calendar reminder for **~2026-11-02** (180 days from
  2026-05-05) to regenerate the JWT
- Pair the iOS native Apple Sign In wiring with the next iOS rebuild
  (uses Apple's `ASAuthorization` framework via a Capacitor plugin —
  separate from the web flow we just enabled)

## Reference

- Apple developer domain verification: needed only once per domain pair, per Services ID
- The `.p8` file is single-download — Apple does NOT let you re-download
- Multiple Sign In with Apple keys per team are allowed (max ~2 active)
- JWTs expire at 180 days max — Apple's hard cap

## Done — 2026-05-05

All Apple-side + Supabase-side configuration completed and verified
end-to-end. The current values are now reflected in the **Known IDs**
section at the top of this doc; the **Setup steps** below are a
runbook for the next JWT rotation. Calendar reminder: JWT expires
~Nov 1 2026 (180 days from generation) — regenerate via
`https://www.louisianahelpr.com/tools/apple-jwt.html` before then.
