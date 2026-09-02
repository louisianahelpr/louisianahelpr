# Lane report — `lh-compliance-store`

App Store / Play review risk + legal compliance. Swept 2026-09-02 in an isolated
worktree at `origin/main` (`b170609a`), which is **newer** than local `main`
(14:18 vs 12:19) and already carries all nine Info.plist purpose strings.

## What I fixed

**Nothing — by design.** This lane ran in `permissionMode: plan` for the whole
sweep and was never released to a FIX phase. Every finding below is filed with
reproduction steps. Separately, and more importantly: **none of the nine findings
is a code defect this lane should fix unilaterally.** Six need a decision or an
action outside the repo (App Store Connect labels, a Supabase secret, legal-copy
authorship); one is a correction to `PROTOCOL.md` itself; one belongs to
`lh-account-lifecycle`/`lh-schema-integrity` territory (a deletion migration);
one is a two-line Info.plist string edit that is safe but should ride with the
next metadata sync rather than land alone. Named per-finding in the table.

## Headline

- **No launch blocker found in this lane.** 0 blockers, 6 MEDIUM, 4 LOW (one of
  which I filed and immediately retracted myself).
- **The two launch-blocking questions I was asked both resolve YES (safe to
  ship).** Guest preview is sufficient; the gift card does not require IAP.
- **The lead's question — is any OTHER purpose string missing? — is answered
  NO, exhaustively**, by a scan of every statically-referenced permission API
  across the app, its 16 linked plugins, and all 13 transitive SPM checkouts.

---

## 1. Verified working (artifact per claim)

| Claim | Artifact |
|---|---|
| `/legal` and all three tabs are reachable **signed-out**, HTTP 200 | `~/lh-audit-shots/compliance/legal-{privacy,terms,community}.png`; titles "Privacy Policy — Helpr", "Terms of Service — Helpr", "Community Rules — Helpr"; route is registered outside `ProtectedRoute` at `src/App.tsx:235` |
| **Guest preview is sufficient for App Review** — and is broader than briefed | `~/lh-audit-shots/compliance/guest-jobs-queryparam.png`: signed-out, `/jobs?job=<id>` opens a read-only dialog with title, description, price ($77), category, city, date/time and a "Sign up to apply" CTA. **The `/jobs` browse feed itself is also fully public** — three real jobs with price/city/date render before any login |
| `/jobs/:id` gates gracefully and preserves the destination | Redirects to `/login?redirect=%2Fjobs%2F34ccf004-…` with human copy "That page needs an account." (`~/lh-audit-shots/compliance/guest-jobs-pathparam.png`) |
| **Sign in with Apple is present and rendered FIRST**, before Google (guideline 4.8) | `~/lh-audit-shots/compliance/login.png` — "OR / Apple / Google"; `src/components/auth/SocialAuthButtons.tsx:74,78` renders Apple first by HIG intent |
| **No other required purpose string is missing** | Scan of all 16 linked plugins + all 13 transitive SPM checkouts in `/private/tmp/nb-dd/SourcePackages/checkouts`. Only three reference permission APIs: `ion-ios-geolocation` → `requestAlwaysAuthorization` + `requestWhenInUseAuthorization` (**both declared** — this is the true root cause of the build-7101 ITMS-90683, a transitive lib, not app code); `ion-ios-camera` → `AVCaptureDevice`/`PHPhotoLibrary`/`UIImagePickerController` (**all three declared**); `GoogleSignIn-iOS` → `LAContext` (**`NSFaceIDUsageDescription` declared**). No Contacts, EventKit, Speech, AVAudioSession, ATT, Bluetooth, Motion or HealthKit anywhere |
| The privacy manifest actually **ships** (not just present on disk) | `PrivacyInfo.xcprivacy` is in the Resources build phase — `ios/App/App.xcodeproj/project.pbxproj:167` |
| **In-app account deletion is discoverable and real** | 2 taps from the dashboard (Profile → "Delete Account" in `profileLanding/SettingsSection.tsx:136-149`), then a 2-step confirm with type-to-confirm. Server-side: `delete-own-account` → shared `_shared/accountPurge.ts`; `auth.admin.deleteUser` is called with no `shouldSoftDelete` → **hard delete**, account not recoverable. Storage is purged and **re-listed to verify** (`accountPurge.ts:452-468`). Blocked only by held escrow/active job, with actionable 409 copy |
| Deletion anonymisation matches the brief exactly | `20260901033011_account_deletion_retention_policy.sql` — `jobs.customer_id`/`location`/`latitude`/`longitude` nulled, `description` → `'[removed at account deletion]'`, `status` untouched; `reviews.reviewer_id` + `disputes.opener_id` SET NULL |
| **`/support` delivers end to end** (not merely "configured") | Submitted a clearly-marked audit test as a guest: `POST .../functions/v1/contact-support` → **HTTP 200**, success state "Message sent" rendered (`~/lh-audit-shots/compliance/support-after-submit.png`). A 200 is real proof here: the function returns **500** if `RESEND_API_KEY` is missing (`:265-273`) or if the Resend send throws (`:296-305`), so it cannot fake success. No `reports` row appeared — **correct by design**, the insert is guarded by `if (userId)` because `reports.reporter_id` is NOT NULL and I was a guest |
| Consent is captured with a version and re-consent is enforced | `complete-signup/index.ts:583-592` writes `legal_acceptances` (`terms_version`, `privacy_version`, ip, user agent) — **18 rows live in prod**. `preserve_first_consent()` exists in prod and pins `accepted_terms_at` immutably. `TermsReconsentDialog.tsx:24-76` blocks on a version bump |
| 18+ age gate is enforced **server-side**, fails closed | `supabase/functions/complete-signup/index.ts:436` rejects a DOB under 18 ("You must be at least 18 years old to use Helpr."), and `:440-442` rejects when `ageAttested !== true` — so a direct API call omitting both is refused, not defaulted |
| Marketing opt-out is honoured on the **send** path, not just captured | `send-marketing-blast/index.ts:233` `.eq("marketing_consent", true)` + `:344-376` drops `email_promotions === false`; `engagement-automations/index.ts:413,639` the same. Transactional mail deliberately carries **no** List-Unsubscribe (`:478-479`) |
| Independent-contractor classification is disclosed | `TermsSection.tsx:54` and `:282-291` (Economic Reality Test); echoed in `CommunitySection.tsx:65,377,387` |
| Permission prompts are contextual — none on cold launch | Every one of the nine is behind a user tap, with a pre-prompt rationale (`usePermissionRationale.ts`) for camera/photos/location/notifications. Push: `requestPermissions()` only at `nativePush.ts:470`, reachable solely via an explicit "Enable" tap after the user has posted or applied |
| No IDFA / ATT / advertising identifier anywhere | Zero hits across `src/` and `ios/`; `NSPrivacyTracking = false` |

## 2. Defects (all filed to the bus)

| ID | Sev | What | Whose fix |
|---|---|---|---|
| **CS-001** | MEDIUM | **Sentry Session Replay records 10% of all prod sessions and 100% of error sessions with `blockAllMedia: false`** (images captured; text masked) — and **no legal page mentions session replay or screen recording at all**. `sentry.ts:217-218,260-261`; `grep -rniE 'session replay\|screen record\|recording' src/pages/legal/` → zero | Owner — legal copy + an App Store Connect label answer |
| **CS-002** | MEDIUM | Privacy policy omits two real processors: **Apple MapKit JS** (gets typed address text + lat/lng) and **Resend** (gets every email address + notification bodies). `PrivacySection.tsx:103-118` names only Supabase, Stripe, Apple/Google, PostHog, Sentry | Owner — legal copy |
| **CS-003** | MEDIUM | **`helper_w9_records` survives account deletion.** Live prod: no FK to `auth.users` (only `job_id`), `purge_user_data()` never references it, columns include `typed_signature` (legal name) + `ip`. **0 rows today**, so no live exposure — but the path is open | `lh-account-lifecycle` / `lh-schema-integrity` — needs a deletion migration |
| **CS-004** | MEDIUM | `PrivacyInfo.xcprivacy` declares **ProductInteraction and CrashData as `Linked: false`**, but PostHog `identifyUser(id, {email})` (`main.tsx:212,218`) and Sentry `setUser({id, email})` (`sentry.ts:348`) both attach identity | Owner — manifest + ASC labels |
| **CS-005** | LOW | `NSContactsUsageDescription` declared for an API the app **cannot** call — no contacts plugin, no `CNContactStore` in any plugin or transitive dep. Dead `"contacts"` rationale branch too | Safe Info.plist removal; ride with next metadata sync |
| **CS-006** | LOW | `NSFaceIDUsageDescription` says Face ID is for "cashing out your earnings" only, but the same gate unlocks the whole app (`AppLockGate.tsx:152`) and gates admin ban/delete/email-change | Copy edit, same sync |
| **CS-007** | MEDIUM | **CAN-SPAM §7704(a)(5)**: commercial email ships with no physical postal address — an **explicitly owner-accepted risk** (`send-marketing-blast/index.ts:124-128`, decision 2026-08-31). **Current exposure zero: 0 of 39 prod profiles have `marketing_consent = true`.** Fix is one secret | Owner — `HELPR_POSTAL_ADDRESS` |
| **CS-008** | LOW | **`PROTOCOL.md` §6d is wrong**: it lists broadcast/marketing-blast as a REMOVED feature. All four objects exist in live prod and the feature is fully wired (`AdminMarketing.tsx:68`, `BroadcastBanner.tsx`). A lane trusting §6d would file false removal findings or delete a live feature | Orchestrator — edit PROTOCOL |
| **CS-009** | LOW | `UIBackgroundModes: remote-notification` declared with no `didReceiveRemoteNotification:fetchCompletionHandler:` in AppDelegate or the plugin. Near-universal for push apps; low risk | Note only |
| **CS-010** | — | **RETRACTED BY ME.** See below | — |

### CS-010 — the lead I disproved before it became a false blocker

It looked like a second ITMS-90683: `@capgo/capacitor-social-login` **is** linked
(`Package.swift:30,53`) and **does** call `ATTrackingManager.requestTrackingAuthorization`
(`FacebookProvider.swift:177`), while `NSUserTrackingUsageDescription` is absent
everywhere. Two facts kill it:

1. That call sits inside `#if canImport(FBSDKLoginKit)` (line 19, closed 229) and
   the Facebook SDK is **disabled** — commented out of the plugin's own
   `Package.swift` deps. The compiled `#else` stub (230-265) has a `requestTracking`
   that never touches ATT.
2. Only a bare `import AppTrackingTransparency` survives — and an unused import
   does **not** auto-link the framework. **Proof:** I built two iOS dylibs
   (`swiftc -target arm64-apple-ios15.0`), identical but for that import;
   `otool -L` output is byte-identical and `AppTrackingTransparency.framework`
   appears in neither.

## 3. UNVERIFIED — could not reach, and why

| Cell | Why |
|---|---|
| **App Store Connect privacy nutrition labels vs observed behaviour** | The declared labels live **only in the ASC web UI and are not version-controlled** — no `privacy_details.json`, no fastlane privacy plugin, nothing in `docs/`. `PrivacyInfo.xcprivacy` is the only in-repo comparison point, and I diffed against it (CS-004). Pulling the live ASC answers needs ASC credentials I do not hold. **This is the single largest gap in the lane** |
| Screenshots / age rating / support-URL reachability in ASC | Same reason — ASC-side state. `support_url.txt` = `https://louisianahelpr.com/support`; the **apex** (no `www`) is subject to the deliberately-staged apex-redirect work (PROTOCOL §6 "do not complete"), so I did not test the apex form |
| Deletion of a **real** account end to end | Requires destroying an account; the lane is plan-mode and read-only. Verified by reading the shared purge implementation + the three deletion migrations instead |
| iOS Simulator / WKWebView pass | Not reached in budget; all live verification was Playwright Chromium against production. Nothing in this lane's findings is WebKit-sensitive |
| PostHog/Sentry payloads on the wire | Read from init + call sites, not captured in flight. `lh-observability` owns the payload lane |

## 4. Reasoned conclusions I was asked for

### The gift card / Pay It Forward IAP question — **Stripe is correct; IAP is not required.**

Apple 3.1.1 requires IAP for digital content consumed in-app, and 3.1.3(e)/3.1.5(a)
exempt **real-world services**. The gift card is a stored-value instrument
redeemable **exclusively for real-world labour**, and that constraint is enforced
server-side, not by UI:

- `redeem_pif_credit(uuid, uuid, uuid)` is invoked in `create-payment/index.ts:148`
  **only against a `jobId`**, in the escrow path; `pif_credits` carries a `job_id`
  column and the RPC is `revoke`d from `public, anon, authenticated`.
- **It cannot buy a subscription.** `create-pro-checkout` contains zero credit or
  PIF redemption logic (verified by grep — no matches).
- $10–$500, purchased through Stripe hosted checkout.

This is the same shape as an Uber/DoorDash/Instacart gift card, none of which use
IAP. **The mitigation to state to a reviewer is exactly the server-side binding:
credit is spendable only against a job.** Keep it that way — the moment a credit
can pay for a subscription or any digital-only entitlement, 3.1.1 attaches.

Two caveats: `/gift-card` is behind `ProtectedRoute` — verified live, it redirects
to `/login?redirect=%2Fgift-card` (`~/lh-audit-shots/compliance/gift-card.png`,
route at `src/App.tsx:325`) — so a reviewer needs the test account to see it; and
prod holds 3 `pif_credits` rows, none claimed (live `execute_sql`, 2026-09-02), so
the feature has never run for real.

**The real 3.1.1 risk is Pro subscriptions, not gift cards** — a recurring digital
entitlement. My conclusion there depends on what Pro actually unlocks, which is
`lh-subscriptions-credits`' finding to establish. If Pro only confers marketplace
advantages over real-world jobs (more applications, boosts, lower fees) it stays
in the services carve-out; if it unlocks digital-only functionality, IAP attaches.
Relayed to the orchestrator.

### Is the guest preview enough for App Review? — **Yes.**

Apple's concern is a reviewer facing a login wall with nothing to evaluate. That
is not this app: the entire `/jobs` browse feed renders real jobs (title, price,
parish, date) to a signed-out visitor, and `/jobs?job=<id>` opens a full read-only
detail dialog ending in "Sign up to apply". `/legal` is fully public. So the brief's
premise — that the query-param path is the *sole* guest preview — understates it;
the browse list itself is public and is the stronger asset. Not a launch blocker.

### Out-of-scope items, concluded rather than skipped (PROTOCOL §6)

- **Certificate pinning — wontfix.** WKWebView on ATS-enforced HTTPS to
  Supabase/Stripe; pinning breaks on routine cert rotation and Apple discourages it.
- **Jailbreak/root detection — wontfix.** Consumer labour marketplace; the money
  path is server-authorised through Stripe, so RASP buys nothing here.
- **Apple IAP receipt validation — N/A.** No IAP surface exists; see the gift-card
  conclusion above for why that is the right posture.

## 5. Coverage manifest — what I actually opened

Live (Playwright, production, signed-out): `/legal?tab=privacy`, `?tab=terms`,
`?tab=community`, `/jobs?job=<id>`, `/jobs/<id>`, `/login`, `/gift-card`,
`/support` (+ a real submission). Screenshots for all eight in
`~/lh-audit-shots/compliance/`.

Live prod SQL (`fncmgoasalhdgfwzhsqa`, read-only): object existence for
`helper_w9_records`, `broadcast_messages`, `broadcast_dismissals`,
`legal_acceptances`, `pif_credits`, `suppressed_emails`, `purge_user_data`,
`fan_out_broadcast_to_notifications`, `preserve_first_consent`; column lists and
row counts for `helper_w9_records` (0), `broadcast_messages` (0), `pif_credits` (3),
`legal_acceptances` (18), `profiles` (39, `marketing_consent` = 0), `reports`.

Source: `ios/App/App/Info.plist`, `AppDelegate.swift`, `PrivacyInfo.xcprivacy`,
`App.xcodeproj/project.pbxproj`, `CapApp-SPM/Package.swift`, all 16 plugin iOS
sources, all 13 transitive SPM checkouts, `src/pages/legal/*`, `src/App.tsx`,
`src/lib/{sentry,posthog,analytics,socialAuth,nativePush,biometricGate}.ts`,
`src/hooks/usePermissionRationale.ts`, `src/components/auth/SocialAuthButtons.tsx`,
`src/components/profile/LegalTab.tsx`, `profileLanding/SettingsSection.tsx`,
`DeleteAccountDialog.tsx`, `GiftCard.tsx`, `supabase/functions/{contact-support,
delete-own-account,admin-delete-user,cleanup-abandoned-accounts,send-marketing-blast,
engagement-automations,create-payment,create-pro-checkout}`,
`_shared/{accountPurge,resend,legalVersions}.ts`, and the three deletion migrations.

Build experiment: `swiftc`/`otool -L` A/B on `import AppTrackingTransparency`
(iPhoneOS26.5 SDK) — the disproof behind CS-010.
