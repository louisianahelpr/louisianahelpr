# CI/CD + App Store Optimization (ASO)

Operational runbook for Helpr's release pipeline and App Store listing.
Code changes ship via Lovable's preview/publish flow — this doc covers the
**iOS native build**, **TestFlight delivery**, and **App Store metadata**
steps that live outside the codebase.

---

## 1. GitHub Actions — iOS build + TestFlight

Helpr is a Capacitor web-wrapper, so the only thing we actually build in CI
is the iOS app shell pointing at the published web URL. Web changes don't
require a new TestFlight build; they ship the moment the site is republished.

### When to cut a new TestFlight build
- Capacitor plugin added/removed (`@capacitor/push-notifications`, etc.)
- Native config change (`capacitor.config.ts`, `Info.plist`, entitlements)
- App icon / splash screen update
- App Store metadata change that requires a binary version bump

### Recommended workflow file
Create `.github/workflows/ios-testflight.yml` in your forked git repo
(this Lovable-managed project does **not** include a `.github/` directory —
add it once you mirror the repo to GitHub):

```yaml
name: iOS TestFlight

on:
  workflow_dispatch:
  push:
    tags: ["ios-v*"]

jobs:
  build:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run build
      - run: bunx cap sync ios
      - name: Import code-signing cert
        uses: apple-actions/import-codesign-certs@v3
        with:
          p12-file-base64: ${{ secrets.APPLE_CERT_P12_BASE64 }}
          p12-password: ${{ secrets.APPLE_CERT_PASSWORD }}
      - name: Download provisioning profile
        uses: apple-actions/download-provisioning-profiles@v3
        with:
          bundle-id: com.Helpr
          issuer-id: ${{ secrets.APPSTORE_ISSUER_ID }}
          api-key-id: ${{ secrets.APPSTORE_KEY_ID }}
          api-private-key: ${{ secrets.APPSTORE_PRIVATE_KEY }}
      - name: Archive + upload
        run: |
          cd ios/App
          xcodebuild -workspace App.xcworkspace -scheme App \
            -configuration Release -archivePath build/App.xcarchive archive
          xcodebuild -exportArchive -archivePath build/App.xcarchive \
            -exportPath build -exportOptionsPlist ExportOptions.plist
          xcrun altool --upload-app -f build/App.ipa -t ios \
            --apiKey ${{ secrets.APPSTORE_KEY_ID }} \
            --apiIssuer ${{ secrets.APPSTORE_ISSUER_ID }}
```

### Required GitHub secrets
| Secret | Where to get it |
|---|---|
| `APPLE_CERT_P12_BASE64` | Keychain → export Apple Distribution cert as `.p12`, then `base64` it |
| `APPLE_CERT_PASSWORD` | Password you set when exporting the `.p12` |
| `APPSTORE_ISSUER_ID` | App Store Connect → Users → Keys → Issuer ID |
| `APPSTORE_KEY_ID` | App Store Connect → Users → Keys → your key's ID |
| `APPSTORE_PRIVATE_KEY` | Contents of the `.p8` file you downloaded once |

> Manual fallback: open `ios/App/App.xcworkspace` in Xcode, hit
> **Product → Archive → Distribute App → App Store Connect**. Same result,
> no CI required for the first few releases.

---

## 2. Feature flags

We're keeping feature flags **lightweight and DB-driven** rather than wiring
LaunchDarkly/Statsig. `platform_settings` already gates a few experiments
(`hybrid_idv_enabled`, `idv_auto_approve_threshold`). For new flags:

1. Add a boolean column to `platform_settings` via migration.
2. Read it from the client through `get_public_platform_settings()`
   (already exposes safe fields).
3. Toggle from Admin → Settings.

Avoid hard-coded `if (FEATURE_X)` in components — always reach through the
settings hook so admins can flip without a redeploy.

---

## 3. Internationalization (i18n)

Helpr is **English-only / Louisiana-only at v1.0**. No i18n library is
installed. When we add Spanish (next likely target):

- Add `react-i18next` + `i18next-browser-languagedetector`.
- Move user-facing strings into `src/locales/en/common.json`,
  `src/locales/es/common.json`.
- Wrap `<App />` with `I18nextProvider`.

Do **not** add i18n machinery before we have an actual second locale —
it bloats the bundle and slows iteration.

---

## 4. App Store Optimization (ASO)

### App name + subtitle (App Store Connect)
- **App Name** (30 char max): `Helpr — Louisiana Gigs`
- **Subtitle** (30 char max): `Trusted local help, fast`

### Keywords (100 char max, comma-separated, no spaces)
```
louisiana,gig,helper,handyman,lawncare,errand,cleaning,nola,baton,rouge,parish,task,jobs,local,helpr
```
Keep it lowercase, no plurals (Apple normalizes), no duplicates of words
already in the app name or category.

### Promotional text (170 char max — editable without a new build)
> Need a hand around the house or yard? Helpr connects you with trusted
> Louisiana neighbors for lawn care, cleaning, errands, and more. Geaux Helpr.

### Description (4000 char max)
Lead with the strongest single sentence, then bullets, then a "How it works"
section. Apple shows only the first ~3 lines before the "more" tap, so make
those count. Template:

```
Helpr is the Louisiana-only marketplace for getting things done. Post a
job in seconds — lawn care, cleaning, moving, errands, handyman work — and
get matched with verified local helpers in your parish, often within the hour.

Why locals choose Helpr:
• Verified, reviewed Louisiana helpers
• Secure escrow payments — funds release only after the job is done
• Transparent 10/10 platform fee — no surprises
• Real-time job tracking and in-app messaging
• Tip your helper directly through the app

How it works:
1. Post your job — describe what you need, set a budget
2. Get matched — local helpers apply within minutes
3. Pay securely — funds held in escrow until you confirm
4. Review — help build the trusted Louisiana community

[continue with categories, safety blurb, support contact, etc.]
```

### Screenshots (6.7" iPhone, required)
Five-screenshot story arc:

1. **Hook** — hero: "Trusted local help, in your parish."
2. **Post** — job-post screen with friendly mock content.
3. **Match** — applicants list, verified badges visible.
4. **Track** — real-time job status / map.
5. **Trust** — review summary, "Tax what you keep" badge, escrow icon.

All screenshots: light theme, large legible captions, no UI chrome glare,
include a single visible parish name (e.g. "East Baton Rouge") for local
credibility.

### App Preview video (optional, 15–30s)
Record a single hero flow: post → match → mark complete → review.
Captions baked in; no audio narration required.

### Categories
- Primary: **Lifestyle**
- Secondary: **Business** (helpers running side hustles)

### Age Rating
**4+** — no objectionable content, no UGC moderation gaps that could push us
into 17+. Make sure the App Store Connect questionnaire matches:
- No user-generated content visible to all users (job posts and helper
  profiles are gated behind sign-up).
- No unrestricted web access.
- 18+ requirement is enforced in-app, but Apple still rates the listing on
  what the average user can see.

### Privacy Nutrition Label
Mirror what's in `/privacy`. Required disclosures:
- **Contact Info** — name, email, phone (linked to user, used for app
  functionality + analytics).
- **Location** — coarse + precise (linked to user, used for app functionality).
- **Identifiers** — device ID (used for analytics + crash reporting).
- **Usage Data** — product interaction (analytics).
- **Diagnostics** — crash data, performance data.

Do **not** check "Tracking" — Helpr does not share data with third-party
ad networks.

---

## 5. Release checklist

Before tagging a new TestFlight build:

- [ ] Bump `version` in `capacitor.config.ts` and Xcode build settings
- [ ] Confirm `npm audit` passes with no high/critical
- [ ] Smoke-test signup → post job → apply → accept → complete on a test device
- [ ] Confirm Stripe webhook fires end-to-end on the test environment
- [ ] Run accessibility audit (Xcode Accessibility Inspector, VoiceOver pass)
- [ ] Update App Store screenshots if any major UI changed
- [ ] Update "What's New" copy in App Store Connect
- [ ] Submit to internal TestFlight group for 24h before external rollout
