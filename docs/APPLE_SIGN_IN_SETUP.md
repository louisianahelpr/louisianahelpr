# Apple Sign In setup — finishing checklist

Started 2026-05-05. Web sign-in code is already wired (`AppleSignInButton`
calls `supabase.auth.signInWithOAuth({ provider: 'apple' })`). Need to
complete the Apple-side configuration + paste credentials into Supabase.

## Current state

| Item | Status |
|---|---|
| App ID `com.Helpr` has Sign In with Apple capability | ✅ Lexi enabled |
| Sign In with Apple key created | ✅ Key ID `Y754ZY5DQ2`, `.p8` downloaded to work Mac |
| Services ID `com.Helpr.signin` created | ⚠️ Save blocked by domain validation |
| Domain verification file deployed | ❌ Not yet |
| JWT generated | ❌ Not yet (needs `.p8` + Services ID saved) |
| Supabase Apple provider enabled | ❌ Not yet |

## Known IDs

- **Team ID:** `P85MCK558V` (from "Helpr, Limited Liability Company")
- **Key ID:** `Y754ZY5DQ2` (matches filename `AuthKey_Y754ZY5DQ2.p8`)
- **Services ID:** `com.Helpr.signin` (this is what Supabase calls "Client ID")
- **Supabase callback URL:** `https://fncmgoasalhdgfwzhsqa.supabase.co/auth/v1/callback`

## Steps remaining (do in order)

### 1. Domain verification — unblocks Services ID save

1. developer.apple.com → **Identifiers** → click into `com.Helpr.signin`
2. Find the **Sign In with Apple** row → click **Configure**
3. In the panel:
   - Primary App ID: `com.Helpr`
   - Domains: `louisianahelpr.com` and `www.louisianahelpr.com` (one per line)
4. Look for a **Download** button/link near the Domains section. Apple gives you a file named `apple-developer-domain-association.txt` with a public token inside.
5. Save that file's contents to:
   ```
   public/.well-known/apple-developer-domain-association.txt
   ```
6. Commit + push. Vercel deploys in ~30 sec.
7. Verify reachable:
   - `https://louisianahelpr.com/.well-known/apple-developer-domain-association.txt`
   - `https://www.louisianahelpr.com/.well-known/apple-developer-domain-association.txt`
8. Back in Apple, click **Verify** next to each domain → both should turn green
9. Save the Services ID configuration

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
- Key ID: `Y754ZY5DQ2`
- Services ID: `com.Helpr.signin`
- Private Key: paste the full contents of `~/Downloads/AuthKey_Y754ZY5DQ2.p8` (work Mac) including BEGIN/END lines
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
- Should land on `/dashboard` (or `/complete-profile` if first-time user)

If the test fails with a Supabase auth error, the most common causes:
- JWT `iss` doesn't match the Apple Team ID — regenerate
- Services ID typo in the JWT `sub` — regenerate
- Services ID domain isn't verified yet — re-verify in Apple
- JWT expired (only happens after 180 days) — regenerate

## After Apple sign-in works

- Set a calendar reminder for ~5 months out to regenerate the JWT
- Pair the iOS native Apple Sign In wiring with the next iOS rebuild
  (uses Apple's `ASAuthorization` framework via a Capacitor plugin —
  separate from the web flow we just enabled)

## Reference

- Apple developer domain verification: needed only once per domain pair, per Services ID
- The `.p8` file is single-download — Apple does NOT let you re-download
- Multiple Sign In with Apple keys per team are allowed (max ~2 active)
- JWTs expire at 180 days max — Apple's hard cap
