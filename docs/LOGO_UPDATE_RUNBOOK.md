# Logo update runbook

When the Helpr logo changes, this is the complete checklist of every
place it lives — across the repo, native app icons, and external
services. Hitting all of these keeps branding consistent for users.

---

## Inputs Lexi must provide

Before cowork or anyone else can update anything, Lexi needs to share:

1. **`logo-1024.png`** — 1024×1024 PNG. **No alpha channel, no rounded
   corners.** Apple rejects icons with transparency or pre-rounded
   corners. iOS rounds corners automatically at render time.
2. **`logo-square-{96,256,512}.png`** (or just the 1024 — script can
   resize). Used for in-app navbar / web favicons.
3. **`logo-horizontal.svg` or `.png`** — wordmark version (used in
   email previews / marketing if needed).
4. **Brand color hex** — if it changed (currently `#7A8070` olivewood
   per `src/index.css`).

---

## Part 1 — Repo updates (cowork or Lexi)

### 1a. Replace source PNGs in `public/`

```bash
# Replace these with the new versions:
public/apple-touch-icon.png      # 1024×1024 source for iOS app icon (required)
public/favicon.ico               # multi-size .ico (16/32/48 sizes inside)
public/favicon-16.png            # browser tab favicon
public/favicon-32.png            # browser tab favicon
public/helpr-splash-icon.png     # web splash screen
public/helpr-wordmark.png        # EMAIL header logo - see 2d, do NOT skip
```

The iOS Icon Sync workflow uses `public/apple-touch-icon.png` as the
source of truth. You can manually generate `public/app-icon-1024.png`
too if `scripts/generate-ios-icons.mjs` runs locally.

### 1b. Replace UI logo assets in `src/assets/`

```bash
# 3 sizes × 3 formats = 9 files:
src/assets/helpr-logo-{96,256,1024}.{png,webp,avif}
src/assets/helpr-logo-64.png     # currently unreferenced by code (see note)
```

> **Set trimmed 2026-08-19.** This list used to name a 512 rung and
> `helpr-icon-96.{png,webp,avif}`. Neither was imported anywhere in `src/`,
> so Vite tree-shook them and they never reached a build — they existed only
> because this runbook kept telling people to regenerate them. Deleted:
> `helpr-logo-512.{png,webp,avif}` (448K) and `helpr-icon-96.png` (32K; the
> `.webp`/`.avif` this list promised had never existed at all). `index.html`
> already carried a comment noting `helpr-icon-96.png` was never imported.
> `helpr-logo-64.png` is kept but is also currently unreferenced — delete it
> too if nothing picks it up. Actual consumers today: `HelprMark.tsx` (96 +
> 256), `HelprSpinner.tsx` (96), `WelcomeScreen.tsx` (96),
> `scripts/build-app-icon.mjs` (1024).

Use `npm run images:avif` (per the existing script) to regenerate
WebP + AVIF from the new PNG sources.

### 1c. Trigger iOS Icon Sync workflow

Once `public/apple-touch-icon.png` is updated and pushed to `main`:

```
GitHub → Actions → "iOS Icon Sync" → Run workflow → branch main
```

This regenerates every iOS AppIcon size + commits the result. Cheap
(Linux runner, no Xcode, no signing).

### 1d. iOS Splash Screen (manual — workflow doesn't cover this)

The splash screen lives separately:

```
ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png
ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png
ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png
```

These need a 2732×2732 PNG (Apple's universal splash size). Replace
manually with the new branding, commit.

### 1e. Trigger iOS Beta build

After all the above lands on `main`:

```
GitHub → Actions → "iOS Beta (TestFlight)" → Run workflow
  → branch: main
  → build number: ≥ next-available (last successful was 2029)
```

The new build has the new icon. ~6–7 min to TestFlight.

---

## Part 2 — External services Lexi needs to update

These can't be automated — they need someone with the relevant
account credentials to log in and replace assets.

### 2a. App Store Connect

**Where:** https://appstoreconnect.apple.com/apps/6754470134

- **App Icon (1024×1024)** — App Information → App Icon. Upload the
  new 1024 PNG. Replaces what shows on the App Store listing page.
  Note: this is _separate_ from the bundled-in-the-IPA icon (which
  comes from the iOS Icon Sync workflow). Both need to match.
- **Screenshots** — only if the screenshots include the old logo
  visibly (splash, navbar). If yes, recapture in TestFlight then
  upload to: App Store → Version → iPhone Screenshots / iPad
  Screenshots.
- **App Preview video** — same rule (only re-shoot if it shows the
  old logo).
- **Subtitle / Description / Keywords** — usually no change unless
  the brand name changed.

### 2b. Apple Developer

**Where:** https://developer.apple.com/account/resources/identifiers

- **App ID `com.Helpr`** — no logo to update here.
- **Services ID `com.Helpr.signin`** — no logo (text-only).
- **Sign In with Apple** — the consent screen pulls branding from the
  bundled app icon, not a separate setting. Should auto-update once
  the new build ships.

### 2c. Stripe

**Where:** https://dashboard.stripe.com/settings/branding

- **Icon** — square logo (~256×256). Used on Checkout pages, Connect
  onboarding, hosted-invoice pages. Upload the new square logo.
- **Logo** — horizontal/wordmark version. Used on receipts and
  hosted-invoice headers. Upload the new horizontal logo.
- **Brand color** — if the brand color changed, update here too.
- **Verify on a test:** open any Stripe Connect onboarding link or
  hosted Checkout page after upload to confirm the new branding
  renders.

### 2d. Resend

**Where:** https://resend.com/domains

- **THERE IS A LOGO TO UPDATE — `public/helpr-wordmark.png`.** This
  section used to claim Helpr emails were text-branded with no image
  asset. That is false, and was false when written: **11 edge functions**
  embed `<img src="https://www.louisianahelpr.com/helpr-wordmark.png">`
  in their header — including `send-notification-email`,
  `admin-user-actions`, `send-business-invite-email` and
  `engagement-automations`.
- Because it is loaded by absolute URL from the deployed site (not
  imported, not hashed), it is invisible to any `src/` grep — which is
  exactly how this error survived. Replace the file at
  `public/helpr-wordmark.png`, keep the filename, and redeploy; every
  email picks it up with no function change.
- Skipping it leaves every transactional email showing the OLD wordmark
  after a rebrand, which is the single most visible place a stale logo
  can appear.

### 2e. Google Cloud Console (Google Sign In OAuth)

**Where:** https://console.cloud.google.com/apis/credentials/consent

- **App logo** — uploaded as part of the OAuth consent screen.
  Shown on the "Helpr wants to access your Google account" prompt.
  Format: square PNG, ~120×120 displayed. Upload the new logo.
- **App home page / privacy / TOS URLs** — verify these still point
  to https://www.louisianahelpr.com/* (no change needed unless URLs
  changed).

### 2f. Sign In with Apple consent screen

The Apple consent screen pulls branding from the App Store listing
icon — once that's updated (per 2a above), this updates automatically.

### 2g. Vercel project

**Where:** https://vercel.com/louisianahelprs-projects/louisianahelpr/settings/general

- **Project icon (avatar)** — cosmetic only (shown in the Vercel
  dashboard / shared deploy links). Optional but nice to keep
  consistent.

### 2h. Supabase project

**Where:** https://supabase.com/dashboard/project/fncmgoasalhdgfwzhsqa/settings/general

- **Project avatar** — cosmetic only (Studio dashboard view).
  Optional.
- **Auth email templates** — NOT used. Helpr's branded auth emails
  go through `auth-email-hook` which renders custom React Email
  templates, not Supabase's defaults. Nothing to update here.

### 2i. Sentry, PostHog, GitHub repo

All cosmetic-only (project icons in their respective dashboards).
Optional.

### 2j. Social handles + marketing assets

- Twitter / X profile picture
- Instagram profile picture
- Facebook page profile picture
- LinkedIn company page profile picture
- Slack workspace icon (if you have one)

If you have any of these, update them with the new logo.

### 2k. Gmail (Google Workspace) — sender avatar

**Where:** https://admin.google.com/ → Apps → Google Workspace →
Gmail → Brand visibility OR
https://myaccount.google.com → Personal info → Photo (per-account)

- The sender avatar that shows in Gmail's "from" field comes from
  the Google account associated with the sending email (or the
  Google Workspace org). For `noreply@louisianahelpr.com` emails,
  it'll be whatever avatar is set on that user account in Google
  Workspace.
- For team mailboxes (`hello@`, `support@`), update the avatar on
  each one separately.

---

## Part 3 — Things to verify (no action, just confirm)

After all updates land, verify these end-to-end:

1. **iPhone home screen icon** — tap-and-hold Helpr → confirms the
   new icon. (TestFlight install of new build.)
2. **Browser tab favicon** — open https://www.louisianahelpr.com → the
   tab should show the new favicon. Hard-refresh with Cmd+Shift+R if
   stale.
3. **App Store listing** — open https://apps.apple.com/app/id6754470134
   → confirm the new icon is the listing thumbnail.
4. **Stripe Checkout** — start any checkout flow → confirm new branding.
5. **Apple Sign In** — sign out, sign back in via Apple → confirm
   consent screen has the new icon.
6. **Google Sign In** — same: consent screen icon.

---

## Part 4 — Communication / launch coordination

If this is a meaningful rebrand (vs. small refinement):

- Post a one-line announcement in any active customer/helper Slack
  channels
- Send an admin broadcast (Admin → Broadcasts) since these now also
  push as notifications
- Update any pinned tweets / IG posts pointing at the old branding
- Update App Store screenshots if the logo is visible in them

Otherwise the rollout is silent — old icon vanishes, new icon
appears on next sync.
