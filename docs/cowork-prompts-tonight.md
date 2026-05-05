# Cowork prompts — tonight (2026-05-05)

Two prompts to run in cowork **in order**. Wait for prompt 1 to finish (Apple
sign-in tested working) before sending prompt 2.

---

## PROMPT 1 — Apple Sign In setup (run first)

Copy everything between the `===PROMPT 1 START===` and `===PROMPT 1 END===`
markers and paste as a single message into cowork.

===PROMPT 1 START===

# Apple Sign In setup for louisianahelpr.com — finishing tonight

I've gotten partway through configuring Sign In with Apple for my marketplace (Supabase backend). Need to complete the Apple-side setup, generate a JWT, and paste credentials into Supabase. Full state and step-by-step instructions are committed at `docs/APPLE_SIGN_IN_SETUP.md` in the repo at `/Users/lexilombas/Developer/louisianahelpr` — please open that file first and follow it.

Quick recap so you have context without re-reading the whole doc:

**Known IDs (all already set up):**
- Team ID: `P85MCK558V`
- Sign In with Apple Key ID: `Y754ZY5DQ2`
- Services ID: `com.Helpr.signin`
- Supabase callback URL: `https://fncmgoasalhdgfwzhsqa.supabase.co/auth/v1/callback`
- The `.p8` private key file: `~/Downloads/AuthKey_Y754ZY5DQ2.p8` (on this Mac — I downloaded it at work today, may need to AirDrop/iCloud-Drive it from work Mac if it's not here yet)

**What's blocking right now:**
Apple's Services ID `com.Helpr.signin` won't save because the Domains field shows "one or more domains are invalid" — Apple requires uploading a verification file before the domains validate.

**Steps you need to do (in order):**

1. **Find the `.p8` file.** Check `~/Downloads/AuthKey_Y754ZY5DQ2.p8` on this Mac. If not there, I might have it on my work Mac — let me know and I'll AirDrop it over. We need its contents for step 5.

2. **Get Apple's domain verification file:**
   - Open Chrome → developer.apple.com → sign in (I'll do 2FA when prompted)
   - Navigate to: Identifiers → click into `com.Helpr.signin` → check "Sign In with Apple" → click "Configure"
   - Primary App ID: `com.Helpr` (already set)
   - Domains: `louisianahelpr.com` and `www.louisianahelpr.com` (one per line, no `https://`)
   - Look for a small "Download" link/button near the Domains section — it gives you a file `apple-developer-domain-association.txt` containing a public token
   - Save the file's contents

3. **Deploy the verification file to my domain:**
   - In the repo at `/Users/lexilombas/Developer/louisianahelpr`, create `public/.well-known/apple-developer-domain-association.txt` with the contents from step 2
   - `git add` it, commit with message "chore: apple domain verification token", push to main
   - Wait ~30 sec for Vercel to deploy
   - Verify reachable at:
     - `https://louisianahelpr.com/.well-known/apple-developer-domain-association.txt`
     - `https://www.louisianahelpr.com/.well-known/apple-developer-domain-association.txt`
   - Should return HTTP 200 with the token contents

4. **Verify domains in Apple:**
   - Back in Apple's Services ID config, click "Verify" next to each domain
   - Wait for green checkmarks
   - Click Save on the Services ID

5. **Generate the JWT:**
   - Open Chrome → `https://www.louisianahelpr.com/tools/apple-jwt.html`
   - Fill in:
     - Team ID: `P85MCK558V`
     - Key ID: `Y754ZY5DQ2`
     - Services ID: `com.Helpr.signin`
     - Private Key: paste the entire contents of `~/Downloads/AuthKey_Y754ZY5DQ2.p8` (open in TextEdit first if needed)
     - Expires in: 180
   - Click "Generate JWT" → click "Copy to clipboard"

6. **Paste into Supabase:**
   - Open Supabase Studio → project `Louisiana Helpr` → Authentication → Providers → Apple
   - Toggle Enable
   - Client ID (Services ID): `com.Helpr.signin`
   - Secret Key (for OAuth): paste the JWT from step 5
   - Skip nonce checks: OFF
   - Allow users without an email: OFF
   - Save

7. **Test it works:**
   - Open `https://www.louisianahelpr.com/login` in incognito
   - Click "Continue with Apple"
   - Complete Apple's auth flow with my Apple ID
   - Should land on `/dashboard` (or `/complete-profile` if first time)
   - If it errors, paste the exact error here

**Don't:**
- Don't paste the `.p8` file contents into chat anywhere. Use only the in-browser tool at `/tools/apple-jwt.html` — it runs locally and the key never leaves the browser.
- Don't email the `.p8` to anyone.
- Don't skip step 4's Verify click — JWT signing succeeds regardless of domain verification, but Apple's OAuth server rejects the JWT at runtime if the Services ID isn't fully saved with verified domains.

When all 7 steps are done and the test in step 7 lands a logged-in user on /dashboard, report back: "Apple sign-in working" plus any incidental observations. If you hit any blocker, paste the exact UI text or error and I'll help unblock.

===PROMPT 1 END===

---

## PROMPT 2 — Account cleanup (run AFTER prompt 1 succeeds)

Wait until cowork confirms Apple sign-in is working (test in step 7 of
prompt 1) before sending this. Otherwise cowork might accidentally revoke
the SIA key they just configured.

===PROMPT 2 START===

# Apple Developer account cleanup (after Sign In with Apple setup is verified working)

Now that Apple sign-in is set up and tested working at `www.louisianahelpr.com/login`, please do an inventory of the Apple Developer account and recommend cleanup. **Do NOT revoke or delete anything yet — just inventory and recommend.** I'll confirm each item before you revoke.

**Scope:**

Inventory everything in `https://developer.apple.com/account/resources/`:

1. **Identifiers** (App IDs, Services IDs, etc.) — list every one with: identifier string, type, capabilities, last-modified date
2. **Certificates** — list every one with: type (development/distribution/APNs), expiration date, common name
3. **Profiles** (provisioning profiles) — list with name, app ID, status (active/expired/invalid)
4. **Keys** — list every key with: name, Key ID, configured services, created date

**Known to KEEP (do not flag these):**

- App ID: `com.Helpr` (production iOS app, build 17 in App Store)
- Services ID: `com.Helpr.signin` (Sign In with Apple — just configured)
- Key ID `Y754ZY5DQ2` (Sign In with Apple key — just created)
- Key ID `B38QR4VAKC` (App Store Connect API key — used by CI Fastlane deploys; revoking breaks GitHub Actions)
- Whatever current iOS Distribution certificate is signing build 17 (need to check Xcode/CI to confirm which one)

**For each remaining item, classify as:**

- **Safe to revoke** — clearly old, expired, or for an app that's no longer maintained (note the reason)
- **In use — keep** — actively referenced in code, CI secrets, or recent build records
- **Uncertain — needs user review** — can't tell from inventory alone (e.g., APNs keys that might be active push integrations)

**For APNs keys specifically:** the iOS app at `com.Helpr` may be using one of these keys for push notifications. Don't classify any APNs key as "safe to revoke" unless you've confirmed which one is actively configured in the push backend (check the codebase under `supabase/functions/` for any `APN_KEY_ID` or similar env var references; also check `/Users/lexilombas/Developer/louisianahelpr/.github/workflows/` for any APNs secrets in CI configs). If you can't confirm, mark as "uncertain."

**Output format:**

Give me a tidy markdown table per category (Identifiers, Certificates, Profiles, Keys) with columns:

| Name/ID | Type | Created/Expires | Classification | Reason |

Then a short summary: "X items safe to revoke, Y in use, Z uncertain."

I'll review the table, confirm which "safe to revoke" items I want gone, and you can revoke those after I greenlight each one (or in a single batch if I bulk-approve).

**Strictly do not:**
- Revoke anything before I greenlight
- Delete the App ID `com.Helpr`
- Revoke any active distribution certificate without confirming a replacement exists first
- Revoke the App Store Connect API key (Fastlane breaks)

===PROMPT 2 END===
