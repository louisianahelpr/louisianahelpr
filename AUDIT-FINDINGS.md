# Louisiana Helpr — Full UI/UX Audit (in progress)

Method: 3 runs (Public web · Authed in-app · Admin+Business). Each screen driven in
Chrome (navigate → measure `scrollWidth<=clientWidth` → screenshot → operate every
interactive element) and cross-referenced to source (file:line). Severity: 🔴 Blocker ·
🟠 High · 🟡 Medium · 🟢 Polish. Labels: `[driven]` = operated live · `[inspected]` =
verified by source/DB read (not committed).

## Environment & honest constraints
- Logged in as the **real** account `lexilombas05@gmail.com` against **prod** Supabase
  (`fncmgoasalhdgfwzhsqa`). → I do **not** commit irreversible/creating actions (submit
  job, pay/escrow, send message to a real user, dispute, delete) on this account. Those
  are `[inspected]` or need a `helpr-audit-*` test account.
- **375px not reachable** by window resize (Chrome floors at 500px innerWidth). Desktop
  measured at 1440; "mobile" at the 500 floor. True 375 + native iOS WKWebView need the
  simulator (`npx cap run ios`) — flagged, not driven.

---

## ★ EXECUTIVE OVERVIEW (read this first)

**Coverage.** Run 1 (public): 12 routes **driven** in Chrome @1440 (measured `scrollWidth<=clientWidth` + screenshotted) + auth/account screens **source-swept** (logged-out states unreachable on the real prod account). Run 2 (authed): poster core loop **driven in detail** (dashboard, full post-job wizard, my-posts, EditJobDialog, CancellationDialog, job-detail dialog, messages+thread, profile landing) + 18 profile tabs & 11 standalone pages **source-swept**. Run 3 (admin+business): admin dashboard **driven** (this account is admin) + 27 admin views, 7 business screens & admin edge functions **source-swept**. Plus a repo-wide mechanical sweep.

**Not yet done (honest gaps, need a follow-up pass):** true **375px + native iOS WKWebView** (Chrome window floors at 500px; needs the simulator); live-drive of every admin sub-view / profile tab / standalone page; and **committable money/lifecycle flows** (post→pay→accept→"on my way"→complete→escrow release, disputes, tips, Stripe test cards, the message content-scanner) — these mutate data/charge cards, so they need a throwaway `helpr-audit-*` test account, **not** the real prod account (`lexilombas05`) I'm signed into. Nothing was committed; no code changed (findings only).

**Numbers:** 🔴 0 Blocker · 🟠 ~13 High · 🟡 ~22 Medium · 🟢 large Polish tail (dominated by ~180 non-token colors, ~all in `admin/**`). Fixes applied: 0 (per instruction).

### 🟠 HIGH — fix first (trust / money / auth)
1. **2FA login bypass (silent error).** `Login.tsx:186-198` — mfa AAL/listFactors drop `error`; a transient failure falls through to `finishLogin()` with no 2FA challenge.
2. **`admin-delete-user` strands escrow.** `admin-delete-user/index.ts:94` — no active-job/escrow guard (unlike `delete-own-account`) + no rate limit → orphaned escrow.
3. **Two-sided fee under-disclosed in the binding Terms.** Poster pays budget +12% + $2 + urgent; helper separately loses 6-12% → ~24% combined take; Legal describes one "12%→6%" fee & misattributes the tiering to posters. `useJobDerived.ts:71-73`.
4. **Fee % hardcoded, ignores real tier.** `WorkRecord.tsx:54` (=10%), `helperAnalytics/fetchAnalytics.ts:123` (=0.10, tier fetched but unused) → Free helpers see wrong earnings.
5. **SubscriptionTab omits the Business tier + hardcodes prices.** `subscriptionTab/tierConfig.tsx:5-38` → a Business subscriber's "Your plan" card blanks.
6. **No marketing/push/SMS consent captured at signup.** `SignupStep1.tsx:240-268` — only bundled Terms/Privacy; no opt-in row for later sends to honor.
7. **Terms acceptance not versioned + no re-consent.** `complete-signup/index.ts:426` hardcodes "Jun 2026"; `CompleteProfile.tsx:239` writes no version.
8. **Self-service email change confirms only the NEW address.** `SecurityTab.tsx:171-174` — old address never notified → account-takeover gap.
9. **Business verification is cosmetic (no functional gate).** `BusinessLayout.tsx:61-142` renders `/business/*` regardless of license/insurance status → **product decision**.
10. **`/data-rights` double top-chrome** (marketing nav + authed bell header stacked when authed).

### ✅ Notably STRONG (the app is largely cohesive & trustworthy)
CancellationDialog (state-aware "YOU ARE HERE" policy, tiered fees 0/25/50%, 3-strike system) — exemplary · job-detail dialog (labeled earnings + fee explainer + Pro upsell) · post-job wizard (steppers, contextual "Add a title to continue" submit label, 5-job limit, smart pricing, category-adaptive) · EditJobDialog is **money-safe** (no budget field → edits can't move escrow) · `/subscription` `/help` `/for-business` `/legal` pricing all **match `subscriptionTiers.ts`** & the fee model is stated (old "90%" bug gone) · Messages two-pane + off-platform safety banner + rich composer · route guards, **18+ server-side age gate**, anti-bruteforce, guest→signup routing, retired-route redirect map — all clean · business surface: seat prices match config, self-serve upgrade, dollars→cents correct, **0 non-token colors**, all dialogs DialogHero · back-button-left-of-title clean repo-wide.

### 🟡 Recurring MEDIUM themes
Same-entity price shown two ways unlabeled (browse cards net vs landing gross) · avatar initials bug ("DG" for all contacts) · narrow single-column list pages underuse desktop width (system-level product call) · `/discharge` `/insurance-claim` narrow marketing columns · hardcoded $ literals in LegalTab · CompleteProfile/NotFound break shared chrome · family-invite no-expiry · lazy-route blank-during-load (no skeleton) · "task" vs "job" (ReferralSection).

### Release state & top-5
Typecheck/lint/build not run (no code changed). **Fix order:** (1) Login 2FA silent-error, (2) admin-delete-user escrow guard, (3) fee/tier correctness + two-sided-fee Legal copy, (4) consent capture + email-change old-address confirm, (5) business-verification gate (product decision).

Full detail per screen is below.

---

## 📱 iOS / native (Capacitor) — SOURCE-readiness audit (live Simulator drive pending)
Real shipped App Store app (`com.Helpr` v1.0.4 build 19). Config is mature & battle-tested (comments reference real device builds/screenshots, LH-* issue IDs).
- ✅ **Safe-area insets:** handled in CSS via `env(safe-area-inset-*)` (`index.css:43,499-515`); `capacitor.config.ts:43 contentInset:'never'` makes CSS env() the single source of truth — the ~100px WKWebView double-count band above document-scroll pages (PostJob/Profile/Activity/Legal) was **already found & fixed**.
- ✅ **Status bar:** StatusBar plugin (LIGHT=dark icons on parchment; per-screen `useStatusBar.ts`; anti-flicker — no static UIStatusBarStyle).
- ✅ **Keyboard avoidance:** `resize:'body'` + `interactive-widget=resizes-content` (index.html:5).
- ✅ **Splash→FCP handoff:** splash bg #ECE9E4 == StatusBar == theme-color == #root shell → no mismatched-tint flash; inline boot spinner (reduced-motion aware).
- ✅ Momentum scroll `-webkit-overflow-scrolling:touch`; tap-highlight transparent; `viewport-fit=cover`; pinch-zoom NOT disabled (a11y-correct); portrait-locked (iPhone); deep-link `helpr://` + Smart App Banner; strict Capacitor CSP; Social Login (Apple+Google); `ITSAppUsesNonExemptEncryption=false`.
- 🟡 **Verify on-device — no global `input{font-size:16px}` rule** found in index.css → a `text-sm`/`text-xs` input would trigger iOS focus-zoom. Add a ≥16px input rule or confirm all inputs are ≥16px.
- 🟡 **Verify on-device — heavy `liquid-glass`/`backdrop-blur`** → possible WKWebView scroll-jank on older iPhones (only measurable on a device). The web lazy-route blank-during-load likely shows on native too.
- ⚠️ Live Simulator drive needs `npx cap run ios` on the Mac (my Linux sandbox can't build iOS; I can't type into Terminal).

---

## 💵 Money-path integrity — verified from SOURCE (live-card driving blocked)
- ⚠️ **Live checkout/escrow flows were NOT driven with cards.** The prod DB's real `jobs.stripe_session_id` values are `cs_live_` → this dev server (localhost:8080) runs against **production Supabase + LIVE Stripe**. Entering any card would be a real charge; test cards don't work in live mode. Verified the logic from source + unit tests instead.
- 🟠 **Operational finding — local dev is wired to PRODUCTION + live payments.** `localStorage sb-fncmgoasalhdgfwzhsqa-auth-token` (prod ref) + `cs_live_` sessions confirm the running dev app talks to prod Supabase and live Stripe. A developer testing checkout locally would create **real** charges / jobs / payouts. Recommend a staging Supabase + Stripe **test** keys for local + audit work (this is what blocks safe committable-flow driving).
- ✅ **Idempotency key on EVERY charge/transfer/refund path (HIGH requirement — MET):** `create-payment` escrow `escrow-${jobId}` (:326), tip (:630, 10-min bucket), cancel-escrow (:722), refund-dispute (:948), dispute-release (:1278); `void-cancelled-payments` cancel-fee (:92) + refund (:258); `release-payout` (job-id keyed, comment :22); `create-boost/bgc/pro/business-seat/pif-donation/instant-payout/cash-out-credits/stripe-connect/process-scheduled-payouts` all keyed. → retry/replay/double-tap = ONE charge. No double-charge risk.
- ✅ **Webhook signature verification + idempotent handling (HIGH — MET):** `stripe-webhook:100`, `stripe-idv-webhook:74`, `verification-webhook:61` all `constructEventAsync(body, sig, secret)`; forged/unsigned events are NOT processed (stripe-webhook returns 200 to halt Stripe retries but skips processing on sig-fail, :106-113); handler idempotent on session id (`dup-onboarding-fee-${session.id}`).
- ✅ Comprehensive edge-function unit tests exist (`src/test/edge/create-payment.test.ts` + mocks) covering escrow open/release/customer get-or-create.
- (Still un-driven end-to-end: the live poster→pay→escrow-held→accept→complete→release→review→tip handshake, disputes, and the message content-scanner block — these need a TEST-Stripe staging env, not prod.)

---

## Cross-cutting mechanical findings (repo-wide source sweep — validated)

**Silent Supabase error drops — 33 total, 4 🟠 High (trust/security):**
- 🟠 `src/pages/Login.tsx:187` — `mfa.getAuthenticatorAssuranceLevel()` error dropped →
  failure silently skips the AAL2 challenge and `finishLogin()` proceeds. **2FA/login bypass.**
- 🟠 `src/pages/Login.tsx:189` — `mfa.listFactors()` error dropped in same gate → TOTP
  challenge never presented. **2FA/login bypass.**
- 🟠 `src/pages/activity/activityActions/useOfferHandlers.ts:353` — `user_violations` error
  dropped → `priorCount` resets to 0, repeat offender **evades graduated-ban logic.**
- 🟠 `src/components/profile/TwoFactorCard.tsx:167` — `mfa.listFactors()` error unchecked in
  enrollment queryFn → masks a real auth failure during 2FA setup.
- 🟡 29 more (analytics/name-enrichment/count queries) — see appendix; several affect
  fail-closed correctness (`useOfferHandlers.ts:225,278`, `useActivityData.ts:97-99,144-146`,
  `fetchAnalytics.ts:59-60`).

**DialogHero adoption — 8 popups still hand-roll their header** (🟡 cohesion; canonical is
`DialogHero` in `src/components/ui/dialog.tsx`): `messages/MessageActionSheet.tsx:76`,
`dashboard/JobQuickActionSheet.tsx:96`, `NotificationPanel.tsx:205`,
`activity/CompletionChoiceSheet.tsx:265`, `activity/postedJobs/DeclineApplicantSheet.tsx:54`,
`ProUpgradeSheet.tsx:58`, `dashboard/WelcomeModal.tsx:58`, `BirthdayPopup.tsx:108`,
`OnboardingTour.tsx:389`. (~95 popups total; adoption otherwise high.)

**Non-token colors — 182 matches** (🟡 cohesion; rule = colors only via `hsl(var(--token))`).
Structural: palette-shade utilities (`text-red-800`, `bg-blue-100`, …) are **100% confined to
`src/components/admin/**`** — worst: `AdminFraudDashboard.tsx` (22), `AdminHealth.tsx` (~14),
`AdminAuditLog.tsx` (18), `AdminHelperTiers.tsx` (13). Handful of `bg-white`/`text-white` in
shared primitives are mostly defensible (modal scrims, switch thumb, QR container).

**Stacked back buttons — 0 (clean).** Every back affordance sits left-of-title per `PageHeader.tsx`.

**Flat primary CTAs — 8** (🟡; primary action using `variant="outline"`):
`profile/EarningsForecastCard.tsx:207`, `profile/HelperScheduleStrip.tsx:217`,
`profile/MonthlyGoalCard.tsx:239`, `activity/PostedJobCard.tsx:359`,
`business/BusinessVerificationCard.tsx:212`, `DataRights.tsx:137`, `PetProfiles.tsx:120,145`.

---

## Anchor finding — /post-job entry dead band (🟡 Medium) `[driven]`
`PostJob.tsx:49` wraps the page in `min-h-screen`; on the entry step `EntryChoice` renders 4
short, top-aligned cards. Measured @1440×900: content 352px tall, **245px empty band below**
(→ ~425px on a 1080p monitor); ~159px at mobile floor. Horizontal is fine (scrollWidth==
clientWidth 1440, zero real overflow, column centered in post-rail area; single 248px `#root`
inset; `App.css`'s `#root{max-width:1280px}` is **dead/unimported** — ruled out). The 1024px
(`lg:max-w-5xl`, `PostJob.tsx:74`) single column also reads sparse.
**Fix:** vertically center the entry step in available height + narrow *its* column to
`~max-w-2xl` (keep 5xl for form/checkout steps). Cite `PostJob.tsx:49,67,73-76`.

---

## Run 1 — Public web

### / (landing) `[driven @1440]`
- ✅ Fit: `scrollWidth==clientWidth==1440`, no document overflow. `category-marquee` is
  4334px but clipped by an overflow-hidden parent (benign). Nav + footer present. SEO title good.
- ✅ Hierarchy: one glossy primary ("Post a Request") + secondary outline ("Browse Local Jobs").
- 🟡 Terminology: hero CTA **"Post a Request"** vs the app's **"Post a job"** everywhere else
  (`/post-job`, bottom-nav, page title) — noun drift; pick one ("Post a job").
- ✅ "Jobs happening near you" — 5-card horizontal carousel (contained; 5th card bleeds as scroll affordance). Prices/locations/dates render fine.
- 🟡 Claim: row badged **"FRESH TODAY · PULLED LIVE"** — verify these are real recent jobs vs static `@/data/sampleJobs`; if static, soften copy or wire to live data (substantiation).
- ✅ Footer: `admin@louisianahelpr.com` ✓, **"Membership"** noun ✓, Terms/Rules/Privacy, "Serving Louisiana since 2026" ✓, © 2026 Helpr LLC ✓, "+127 happy customers".
- 🟡 Large empty band above the footer (final testimonial/CTA section sparse OR fade-up not triggered on jump-scroll) — recheck with natural scroll.
- 🟢 Footer LEGAL omits a Data Rights link though `/data-rights` exists; CONNECT's first social icon is an ambiguous dark circle — confirm it's a real destination.

### /how-it-works `[driven]`
- ℹ️ Not a page — redirects to `/#how-it-works` (anchor on landing). Renders the full landing. Confirm the nav actually scrolls to the section (landed at top). Minor.

### /for-business `[driven @1440]`
- ✅ Fit: no overflow (`sw==cw==1440`), nav+footer, two-column hero + "GET STARTED" card. Fills width well.
- ✅ Self-serve business signup ("Sign up as a business" glossy CTA, "Sign in" link) — **no "Contact sales" dead-end** (meets the brief's self-serve requirement).
- 🟡→(verify) Seat pricing shown: **Starter 1·Free · Crew 2·$20 · Team 3·$30 (POPULAR) · Enterprise 4+·$40**. Must derive from `subscriptionTiers.ts` — cross-checking.
- (note) Copy truncates "…no monthly fees on…" at fold; verify full sentence renders below.

### ⚙️ Methodology / perf note
- 🟡 Perceived perf: lazy route chunks paint a **blank white screen for ~3-4s** during load (no skeleton/spinner Suspense fallback). Affects every code-split route on a cold/slow load. Add a route-level loading skeleton.
- (Internal: use ≥4s navigation waits when measuring — 2s produced false "blank page" readings.)

### /enterprise `[driven]`
- ℹ️ Redirects to `/for-business` (Enterprise seat tier is shown there). Acceptable alias. Double lazy-load (redirect + chunk) reinforces the blank-during-load perf item.

### /impact `[driven]` — RETRACTED as a defect
- ✅ Intentional redirect to `/` (App.tsx:246 — `/impact` retired). A real 404 exists (App.tsx:263 `NotFound`).
- ✅ **Positive:** retired-route redirect discipline is clean & well-commented — `/community`,`/enterprise`,`/become-a-partner`,`/local-guide`,`/parishes`,`/parish/:slug`,`/browse-jobs`,`/job-history`,`/settings` all redirect to sane targets instead of 404-dumping (App.tsx:158-262).

### 🗺️ Authoritative public scope (from App.tsx — brief's list was stale)
Real public pages: `/` · `/jobs` · `/jobs/:id` · `/browse` (guest) · `/subscription` · `/for-business` · `/help` · `/legal` (tabs terms/privacy/community) · `/data-rights` · `/discharge` · `/insurance-claim` · `/evacuation`. Auth/account: `/login` `/signup` `/signup-pending` `/complete-profile` `/account-pending` `/account-denied` `/account-banned` `/forgot-password` `/reset-password`. Everything else in the brief is a redirect or authed.

### /jobs (Browse jobs, public) `[driven @1440]`
- ✅ Fit: no overflow, 2-col job-card grid, nav+footer, LIVE badge + search + filter. Title "Browse Jobs — Helpr".
- 🟡 **Price inconsistency (same job, two numbers).** Landing shows gross budgets ($220/$180/$140/$130); `/jobs` shows exactly **×0.88** ($193.60/$158.40/$123.20/$114.40) = net after the 12% Free-tier fee, with **no "you earn / after fees" label**. Same entity → different unlabeled price across views. Reconcile + label gross vs net.
- 🟡 Claim: "9 jobs · Live now" + "LIVE" over what appears to be the same static `@/data/sampleJobs` as the landing (prices are exactly 0.88× the samples). Confirm live-data wiring or soften "LIVE".
- ⚠️ Verify: navigating to `/jobs` while authed ended with `location.href=/dashboard` although the public Browse page rendered — confirm the authed redirect isn't racing/half-applied.

### /subscription (Membership, public) `[driven @1440]`
- ✅ **Strong.** Marketing nav + footer present — the CLAUDE.md "`/subscription` renders with no nav/footer on web" gap appears **RESOLVED**. Title "Membership — Helpr" ✓.
- ✅ Money matches config exactly: Free 12% · Pro $10/mo 10% (save 2%) · Elite $15/mo 8% (save 4%); annual $8.33 / $12.50. Matches `subscriptionTiers.ts`.
- ✅ Clear per-tier hierarchy ("CURRENT" on Free, glossy "Upgrade to Pro"/"Go Elite", "MOST POPULAR" on Elite).
- 🟢 "MOST POPULAR" (subscription) vs "POPULAR" (for-business) badge wording differs — pick one.

### /help (Help Center, public) `[driven @1440]`
- ✅ **Strong.** Title "Help Center — Louisiana Helpr" ✓. Hero + search + "Browse by topic" 6 cards (Getting Started · Posting a Job · Finding Work · Payments & Escrow · Trust & Safety · Account & Settings) — matches spec, fills width, no overflow.
- (to verify) search returns results; contact `admin@louisianahelpr.com` + "Mon–Fri 8am–6pm CST" lower on page.

### /legal (Terms/Rules/Privacy tabs, public) `[driven @1440]`
- ✅ **Fee model CORRECT & consistent** — "Posters pay a plan-based service fee (12% free down to 6% Business). Helprs keep 88–94% … platform fee (6–12%) drops as plan tier rises." Matches `subscriptionTiers.ts`. The old "90%" bug is not present here. 18+ age gate stated ✓, IC status ✓, liability/indemnity ✓.
- 🟠→(verify) **Fee attribution ambiguity in the binding agreement.** Same summary says BOTH "Posters pay a service fee **on top**" AND "Helprs keep 88–94% (fee taken from payout)". `subscriptionTiers.ts` comment = one fee "taken from helper payout"; `/jobs` shows helper-net = budget×0.88 (helper side). So "posters pay on top" appears to contradict a single helper-side fee (or implies a second fee). Reconcile against actual `CheckoutStepView`/`create-payment` math — clarity here is High.
- ✅ Tabs (Terms active/glossy, Rules, Privacy) + policy search + accordions; no overflow, nav+footer.

### /data-rights (public) `[driven @1440]`
- 🟡 **Duplicate top chrome:** renders the marketing Navbar AND an in-app `Helpr·LA`+notification-bell header stacked (visible when authed). A page must carry the shared chrome exactly once. Verify `DataRights.tsx` header vs the public layout wrapper.
- 🟡 Flat "Download my data" primary CTA (confirms cross-cutting `DataRights.tsx:137`) — sole action in its card, should be glossy.
- ✅ CCPA/GDPR controls (Download data JSON + "Do not sell/share" toggle), contact `admin@louisianahelpr.com`, "Back to Privacy Policy". No overflow.

### /discharge (Healthcare Discharge Concierge, public) `[driven @1440]`
- ✅ Clear hero + "Common needs after discharge" 3 cards (Transport/Home Prep/Daily Help) + "Get help now". Title good. No overflow, nav+footer.
- 🟡→(verify) Narrow centered content column (~max-w-3xl) on a 1440 no-rail page → wide blank side gutters; canonical marketing body is wider (max-w-5xl+). Confirm width vs siblings.

### /insurance-claim (public) `[driven @1440]`
- ✅ Renders (hero "We handle the contractor side." + How-it-works steps 1/2). Nav present, no overflow.
- 🟡→(verify) Same narrow centered column (~max-w-3xl) on desktop as /discharge → wide side gutters. (JS measure caught a mid-PageTransition empty state; screenshot is source of truth.)

### /evacuation (Pet Evacuation Help, public) `[driven @1440]`
- ✅ **Strong:** full-width layout, two clear choice buttons ("I need help…" / "I can help…"), empty-state handled ("All pets accounted for"), "No charge — community" copy, nav+footer, title ✓. No overflow.
- 🟢 Header uses a custom banner style vs the PageHeader eyebrow/title on /discharge & /insurance — minor header inconsistency across vertical pages.

### /browse (guest dashboard) `[driven]`
- ℹ️ Redirects to /dashboard when authed — audit the guest state in the logged-out pass.

### 📌 Run 1 status
Public **content** pages covered: /, /jobs, /subscription, /for-business, /help, /legal, /data-rights, /discharge, /insurance-claim, /evacuation + redirect map verified. **Remaining (need logged-out / account states):** /login, /signup, /forgot-password, /reset-password, /account-pending, /signup-pending, /complete-profile, /account-denied, /account-banned, guest /browse, guest /jobs/:id — to be covered via logout + a `helpr-audit-*` test account (also audits signup live).

---

## Run 2 — Authed in-app (real account `lexilombas05`, read-only)

### /dashboard `[driven @1440]`
- ✅ Authed shell correct: sidebar rail (Home / Posts•5 / Jobs / Messages / Profile) + glossy "Post a job" CTA; top bar HelprMark + "IN PROGRESS" pill + shield + bell(4); **no marketing footer** (correct). App-shell internal scroll, no overflow.
- Content: "FRESH TODAY / Browse Jobs / 9 jobs" feed + Leaflet map with job pins. Prices net (×0.88) — same gross/net labeling question as /jobs.
- (interactions in progress: job card → detail/apply popup, filters/search/bookmark, top-bar pill/shield/bell)

### Job detail dialog (dashboard feed → `?job=<id>`) `[driven]`
- ✅ **Well-built popup.** Canonical eyebrow→title header ("PET CARE" / "Dog walking 3x this week"), deep-linkable (`?job=`), X close with correct spacing. WHERE / DATE / TIME tiles. **"YOU EARN $66 · $75 budget − 12% fee · Helpr Pro reduces your fee to 10% · Learn more"** — earnings labeled + fee explainer + Pro upsell. Poster reputation, applicant count ("1 Helpr already applied. You'd be #2 in line."), flag/bookmark/share + glossy **Apply**. Clear hierarchy.
- ✅ Resolves gross/net: net earnings ARE labeled here ("YOU EARN") — so the **browse cards** (bare net, no label) are the gap → add "you earn / est." to cards for consistency with the landing's gross figures.
- 🟠 Strengthens the /legal finding: fee is deducted from the **helper** (earn = budget − 12%), poster pays the budget — so Terms' "Posters pay a service fee **on top**" is likely inaccurate. Confirm at poster checkout.
- 🟡 Avatar initials **"DG" ≠ poster name "Marie H."** — mismatched initials (sample data or initials derived from the wrong field).
- 🟢 "New" poster AND "30% cancelled" shown together is inconsistent — sample-data QA.

### /post-job wizard `[driven @1440]` (entry → form; checkout inspected via source)
- ✅ **Strong, well-structured form.** 3 sections with numbered steppers — Details (category-adaptive picker w/ seasonal "Storm · IN SEASON", title+char counter+voice input, description, Photos up to 5, 30s scope-video upload), Logistics (location w/ "Use my location" + prefill, date, custom time picker, flexible-schedule, access notes, Job type One-time/Recurring/Group), Budget (pricing mode Set-my-price/Accept-bids/Smart-Price, smart-price suggestion "$20–$100 for Other", quick chips, Mark-as-Urgent).
- ✅ **Contextual submit label** "Add a title to continue" names the first unfinished required field (exactly the standard's pattern). Disabled state correct.
- ✅ **5-open-job limit enforced** with clear copy ("You have 5 open jobs / max 5 at a time. Close or complete an existing job…").
- ✅ Uses the wide 5xl column appropriately (dense form) — validates the anchor fix (narrow only the sparse *entry* step, keep 5xl for form/checkout).
- 💵 **Two-sided fee model (from source, `CheckoutStepView.tsx:90-97`):** poster is charged `budget + customerFeeAmount + onboardingFeeAmount (+ urgentFee) = totalCharge`; helper separately earns `budget − platformFee`. So the platform takes from BOTH sides. → **Refines the /legal 🟠:** the Terms' single "12%" narrative blends the poster-side "on top" fee and the helper-side deduction, obscuring the true combined take rate. Reconcile the numbers + label both sides. (Exact formula pinned via grep — see below.)

### 🟠 HIGH — Two-sided fee under-disclosed in the binding Terms
Confirmed formula (`src/pages/postjob/useJobDerived.ts:71-73`):
`customerFeeAmount = posterServiceFee(budgetCents, customerFee ?? 12, urgent+onboarding)`; `totalCharge = budget + customerFeeAmount + urgentFee + onboardingFee`.
- **Poster** pays budget **+ a 12% customer fee on top** (default flat 12%, `usePostJobForm.ts:101` `customerFee ?? 12`) + $2 onboarding (first post only, `onboardingFeeCents=200`) + $5 urgent (if urgent) + sales tax.
- **Helper** separately earns budget **−** the plan-based commission (12%→6% by the *helper's* tier, `subscriptionTiers.ts`) + urgent fee (`stripeFees.ts` "budget − commission + urgentFee").
- **Net:** platform takes from BOTH sides — e.g. a $75 job ≈ $9 poster + $9 helper ≈ **~24% combined take**. The Legal "THE SHORT VERSION" describes ONE "12% free down to 6% Business" fee and **misattributes the plan-based tiering to the poster** (it's the *helper's* commission that tiers; the poster fee is a flat 12%). Binding-agreement money accuracy → **High**. Fix: state both fees explicitly (poster service fee + helper commission) and correct who the tiering applies to.
- (Verify at live checkout with a test account: order-summary line items + that the Stripe charge equals `totalCharge`, and escrow holds the right amount.)

### /my-posts (Activity — Posted, poster view) `[driven @1440]`
- ✅ Authed app-shell (rail + top bar, no footer), no overflow. "11 JOBS" / "POSTED JOBS · Active" + search/filter. Cards: title, **gross** budget ($220/$140 — posters correctly see gross), location/date/time/duration, glossy "Applicants (n)" primary + Boost/Edit/Share/Cancel secondary row.
- 🟡 (system-level, not per-page) Narrow ~635px centered single column on 1440 → wide symmetric side gutters. Cohesive with the app's list-page pattern (Dashboard/Activity/Messages), but underuses desktop width — consider a wider column or responsive 2-col job-card grid on ≥xl (uniform product call).

### EditJobDialog `[driven]`
- ✅ Canonical **DialogHero** header ("EDITING YOUR JOB" eyebrow + title); X spacing correct (no title/X collision — old bug fixed). Well-labeled fields; Cancel | glossy "Save changes".
- ✅ **Money-safe:** NO budget/price field exposed → an edit cannot silently change price or escrow.
- 🟢 Product gap: budget not editable at all (even pre-accept) → poster must cancel+repost to reprice.
- 🟡→(verify) Fields not visibly state-gated; confirm editing date/time/scope on an ACCEPTED job re-notifies/re-consents the accepted helper (material-change re-consent) — source-check the update RPC + notification dispatch.

### EditJobDialog — save/exit confirm `[driven]`
- 🟡 Exiting/saving the edit surfaces a second confirm **"Save these changes? · Your job listing will update right away"** (eyebrow "EDITING YOUR JOB", buttons **Cancel | Save Changes**). Clarify the two exit paths: if this is the *discard/close* guard it offers **no "Discard"** option (a poster who wants to abandon edits is trapped into either saving or continuing to edit); if it's a save double-confirm it's reasonable but redundant. Verify + add an explicit Discard path if needed.
- ✅ Confirm uses the eyebrow header pattern; glossy primary.

### CancellationDialog `[driven — inspected, not confirmed]`
- ✅ **Exemplary trust/money flow.** DialogHero header ("HEADS UP" / "Cancel '<job>'?"). "FULL CANCELLATION POLICY" timeline with a state-aware **"YOU ARE HERE"** marker: (1) *Before a Helpr is selected* → "**$0 fee · Full refund · No consequences**"; (2) *After a Helpr is selected* → tiered fees **24h+ 0% · <24h 25% · <2h 50%** (compensates the helper). STRIKE SYSTEM (1st = written warning + admins notified · 2nd = final warning · 3rd = permanent ban, cannot be undone) with "these don't apply to you — no Helpr selected". Optional reason field.
- (verify: the 0/25/50% tiers match `void-cancelled-payments`, and the refund reconciles to the original authorization with no stranded escrow.)

### /messages `[driven @1440]`
- ✅ **Two-pane desktop layout** (thread list + reading pane) — actually uses desktop width (positive contrast to the narrow single-column list pages). "3 THREADS", ARCHIVE/PIN tabs, search, clean empty state ("Pick a thread on the left to read and reply here."). Authed shell, no overflow.
- 🟡 **Avatar-initials bug (systemic):** every contact renders "**DG**" initials — Tre B., Marie H., Layla F. (and the "Marie H." poster in the job-detail dialog). Initials are not derived from the contact's name; likely a wrong-field/sample-seed bug. Verify `getInitials`/avatar source.
### Messages — conversation view (`?chat=`) `[driven]`
- ✅ **Strong.** Deep-linkable; header (name + online dot + job title + CANCELLED + flag + kebab). **Off-platform-contact safety banner** ("Keep chats & payments on Helpr. Sharing contact info or going off-platform = warning, then permanent ban") ✓. Message bubbles (incoming gray / outgoing green) with read-receipt checkmarks, timestamps, date dividers, in-thread lifecycle system messages ("Job cancelled by helper"), per-message delete. Rich composer: attachment, **share-location**, voice note, mic, text, glossy send.
- 🟡 Avatar-initials "DG" bug persists in the thread header.
- (verify on a test account: the content scanner / ViolationDialog blocks a message containing a phone number **server-side** — not sent on the real account; persistent banner is the visible deterrent.)

### /profile (landing) `[driven @1440]`
- ✅ **Wide** desktop layout (cards fill width — not a narrow column). Correct current-user avatar "**LL**" → confirms the "DG" bug is only in *contact* avatars, not self. "Lexi Lombas · Delcambre · Since May 2026 · New · 0 reviews". Actions: rating badge / Share / Edit / QR code. Bio, ACTIVITY TREND, "Record a 60-second intro video / Upload" (glossy), YOUR SKILLS (+Add skill, empty state), "Finish your profile 70%" progress, payout-setup prompt. No overflow.
- ℹ️ Account bio = "the founder of Helpr" → likely admin (checking /admin for Run 3).
- 18 profile tabs (`?tab=`) per `Profile.tsx`: landing/profile/earnings/schedule/availability/payment/security/legal/reviews/referral/subscription/support/notifications/posted_jobs/completed_jobs/warnings/credentials/saved_helpers — individual-tab recon pending.

---

## Run 3 — Admin + Business (this account IS admin/founder → accessible read-only)

### /admin (Dashboard / home) `[driven @1440]`
- ✅ Accessible. Distinct admin chrome: left ops sidebar (Dashboard · Analytics · Users · Identity Verify · License & Insurance · Exception Queue · Business Verification · Business Accounts · Jobs•46 · Geography · Fraud · Disputes · …) + top bar (Helpr·LA + **ADMIN** badge + bell + logout). "web-desktop" layout, no overflow.
- ✅ KPI cards render **real data + sparklines, no NaN/empty**: 6 New Users (+500% vs prior 7d) · 49 Active Jobs · $16 Revenue (−86%) · 0 Pending Disputes; PRIORITY ALERTS "3 Open reports". Date-range tabs 7d/30d/90d/Custom. 2-col grid.
- ⏳ 27 `?view=` sub-views + AdminSectionHeader duplicate-title check + admin gating + destructive-action confirms — covered via source sweep (below) + spot live recon.
- 🟡 (from cross-cutting sweep) **All non-token palette colors in the app live in `src/components/admin/**`** (182 matches; AdminFraudDashboard 22, AdminHealth ~14, AdminAuditLog 18, AdminHelperTiers 13, …) — the admin surface is the cohesion/token debt hotspot.

### Run 3 admin/business — source sweep (all 27 views + 7 business screens + edge functions)
- 🟠 **HIGH — `admin-delete-user` can strand escrow.** `supabase/functions/admin-delete-user/index.ts:94` deletes a user with NO active-job/escrow guard (unlike `delete-own-account/index.ts:55-83`, which blocks on `status in (accepted,arrived,in_progress,awaiting)` OR `payment_status=escrow`) and no rate limit. Admin can delete a user mid-job → orphaned escrow, vanished counterparty. Port the `activeJobs` guard (or a "$X in escrow — force-delete anyway?" confirm).
- 🟠 **HIGH — Business verification is cosmetic (no functional gate).** `src/components/business/BusinessLayout.tsx:61-142` reads `useMyBusiness()` only for the name badge; never checks `verification_status`; renders `{children}` for every `/business/*` route regardless. An unverified business can post contracts, spend, and manage a team. **Product decision:** gate posting/contracts behind `verification_status==='verified'` OR document intentional (badge/discovery-only).
- 🟡 `rpc_decide_dispute` (`20260609140000_disputes_table.sql:199-311`) writes NO `admin_audit_log` row — the one admin action outside the centralized trail (still attributable via `decided_by`). Add the audit insert.
- 🟡 `DenyUserDialog.tsx:94-121` confirm states no consequence (only asks for a reason) — unlike Ban/Delete dialogs. Add consequence copy.
- 🟡 `admin-resend-verification/index.ts:48-53` hand-rolls the admin check (raw `user_roles` query) vs the shared `has_role()` RPC used by the other 3 functions. Consolidate.
- 🟡 Admin color-token debt: **83 raw palette utilities across 19 admin files** (verified current count; worst: AdminFraudDashboard `flagColor` map 12, AdminHealth `statusBadge` 11, AdminAuditLog 9). Introduce semantic Badge variants.
- ✅ **CLEAN (verified):** business seat prices match config (`_shared/businessSeatTiers.ts`: Starter Free/Crew $20/Team $30/Enterprise $40; `ForBusiness.tsx` derives, no hardcode); budget dollars→cents correct (`BusinessContracts.tsx:105`); upgrade self-serve (no "Contact sales"); all 22 admin dialogs use DialogHero; NO duplicate admin page titles; destructive actions confirm with $ amounts spelled out; business surface has **0** non-token colors; back-buttons left-of-title.

---

## Run 2 tail — source sweep (18 profile tabs + 11 standalone pages)
- 🟠 **HIGH — fee % hardcoded, ignores real subscription tier (money shown wrong):**
  - `src/pages/WorkRecord.tsx:54` `HELPER_FEE_PERCENT = 10` — every "Total Earnings"/per-job figure uses 10% regardless of tier; a Free helper (12% fee) sees earnings computed at 10%. Query doesn't select `subscription_tier`. Use `tierFeePercent(tier)`.
  - `src/pages/helperAnalytics/fetchAnalytics.ts:123-125` `PLATFORM_FEE_PERCENT = 0.10` — net earnings on /analytics; the function ALREADY fetches `tier` (line 58) and never uses it. Replace with `tierFeePercent(tier)/100`.
  - `src/components/profile/subscriptionTab/tierConfig.tsx:5-38` — hardcodes price strings ("$10/mo"…) AND **omits the Business tier** → a Business subscriber's `activeTierConfig` lookup returns `undefined`, blanking their "Your plan" hero card on `/profile?tab=subscription`. Derive from `TIER_PERKS` + add `business`.
- 🟡 `src/components/profile/LegalTab.tsx:133,145,180-181,299` — hardcoded $ literals (urgent $5, min $5/max $5,000, cancellation 25%/50%, $100 cap) not sourced from config (same defect class; the tier %s in the same file ARE sourced). Interpolate from constants.
- 🟡 `src/components/ReferralSection.tsx:47` — native-share text says "local **task** marketplace" (the only "task" vs "job" in scope). Fix to "job".
- 🟡 `/wrapped` (`HelprWrapped.tsx:169-173`) — only standalone route NOT in `<ProtectedRoute>`; self-guards via useEffect → brief flash of authed chrome for a logged-out visitor. Wrap in ProtectedRoute.
- 🟡→✅ `src/pages/BenefitsPage.tsx` — **LIVE CORRECTION:** driving `/benefits` shows it is **FULL-WIDTH** (content 1192px, perk rows span the full post-rail area) — NOT the narrow `max-w-lg` orphan column the source claimed — and it **has** `usePageTitle` ("Benefits & Perks — Helpr"). So the narrow-column + missing-title flags are superseded (likely part of the completed previous-audit fixes). Only residual: the `text-white` on the gradient hero banner (expected/defensible). Clean layout, no overflow.
- 🟡 Family invite tokens never expire — `care_relationships.invite_token` has no `expires_at`/TTL (`FamilyAcceptPage.tsx`). Add 14-day expiry (already-accepted/wrong-status tokens ARE rejected).
- 🟡 Soft error-handling gaps (observability, not money/auth): `ScheduleAvailabilityTab.tsx:59-68`, `PayItForward.tsx:143-219` (error state indistinguishable from empty), `PublicReviewWall.tsx:240-243` (no logging).
- 🟢 POLISH: profile color-token violations (~40+, mostly semantic `text-muted-foreground`/`text-primary`), `?? 10` fee-fallback magic number duplicated ~14 files, `MAX_SIZE=5MB` duplicated, design-system one-offs.
- ✅ CLEAN: silent-error handling (mostly), back-buttons, chrome (all 11 standalone pages in DOCUMENT_SCROLL_ROUTES + PageHeader, none use marketing footer), "Helpr" capitalization, empty/loading/error triads (HelprWrapped, UserProfile exemplary), Intl currency formatting.

---

## Run 1 tail — source sweep (auth + account-state + guest screens)
- 🟠 **HIGH — 2FA login bypass (CONFIRMED).** `src/pages/Login.tsx:186-198` — `mfa.getAuthenticatorAssuranceLevel()` + `mfa.listFactors()` both drop `error`; a non-throwing `{data:null,error}` (network blip) makes the `if` false and falls through the try to `finishLogin()` → sign-in completes with NO 2FA challenge for a user who has 2FA on. Check `error`; never treat a fetch error as "no MFA".
- 🟡 **~~HIGH~~ → MEDIUM — marketing consent: DOWNGRADED after live check.** The source agent claimed "no marketing opt-in at signup" — but driving `/signup` live shows a **separate, unchecked "It's OK to email me occasional Helpr news, tips, and special offers. I can unsubscribe anytime" checkbox**, distinct from the Terms/Rules/Privacy agreement. So consent IS captured in the UI (unchecked-by-default ✓). Remaining (unverified): confirm the checkbox is **persisted** to a consent column and that `send-marketing-blast`/`engagement-automations` actually read it. (SMS/push opt-in still not seen — lower priority.)

### Guest / auth screens — live logged-out pass (new)
- ✅ `/signup`: strong — "Welcome, neighbor," live password rules (8+ / uppercase / number), show/hide, Terms+Rules+Privacy checkbox + separate unchecked marketing opt-in, glossy "Continue," 2-step flow. No overflow.
- 🟡 `/signup` shows a **"PREVIEW · Jump to step: 1 2"** control — verify it isn't a dev/QA affordance leaking to real users or letting them skip step validation.
- ✅ `/forgot-password`: clean; "the email tied to your account" phrasing avoids the account-enumeration leak (consistent with the deliberate choice flagged earlier).
- ✅ `/login`: "Glad you're back," remembers last method ("Last time you used email and password"), password show/hide, Apple + Google SSO. 🟢 the small "or" divider computes ~3.49:1 (minor sub-AA).
- 🟡 Guest `/browse`: renders the **authed rail** (Post a job / Messages / Profile) to logged-out visitors and sat on a "Loading jobs…" skeleton — verify it resolves, and that the guest-rail actions route to signup rather than dead-end.

### Profile tabs — live authed pass (new)
- 🟠 **LIVE-CONFIRMED + EXTENDED: earnings figures are inconsistent AND fee-wrong.** The same single completed job shows **THREE different numbers** across profile tabs: **Payment** tab "TOTAL EARNED **$75.00**" (gross, no fee removed) vs **Earnings** tab "TOTAL **$67.50**" (= $75 × 0.90, the hardcoded **10%** fee) — while the correct Free-tier (12%) net is **$66**. **REFINED by live `/analytics`:** `/analytics` actually shows the CORRECT **"$66 after Helpr fee"** (12%) — so `fetchAnalytics.ts:123` is *fine live* (the 10% source flag there appears outdated). The wrong **$67.50** is the **Earnings tab** (`EarningsTab` — the `?? 10` fallback / `WorkRecord.tsx:54`), and the Payment tab mislabels **gross ($75)** as "earned." Net: one job = $66 (analytics, right) / $67.50 (earnings tab, 10% wrong) / $75 (payment, gross). Fix EarningsTab to the tier-derived net and label the payment figure as gross.
- 🟠 **FULL PICTURE (5 surfaces, live): the "earned" figure for the SAME one job renders 4 different ways.** `/analytics` **$66** (12% ✓) · `/work-record` **$66** (12% ✓ — so the `WorkRecord.tsx:54` 10% flag is ALSO outdated) · `/profile?tab=earnings` **$67.50** (10% ✗ — the real bug, isolated here) · `/profile?tab=payment` **$75** (gross mislabeled "earned") · `/wrapped` **$75** (gross mislabeled "earned"). Plus `/wrapped` shows an implausible **"~194 hrs"** for a single $75 job (hours-calc bug). Standardize on ONE tier-derived net + consistent gross-vs-net labels across all five.

### Standalone + business — live authed pass (new)
- ✅ Rendered clean, no overflow, good empty states: `/pets` (paw + hurricane-evac cross-link), `/pay-it-forward` ($25/$50/$75, $10 min, "small processing fee at checkout" — should state the %), `/str-settings` (Airbnb/VRBO auto-post cleaning on checkout), `/work-record` (formal "Employment & Earnings Record" doc, **$66 correct**, wide), `/home-history` (job timeline, wide, poster gross budgets), `/wrapped` (shareable year card).
- 🟡 `/user/:id` (public "Profile Review"): **broken avatar** — renders alt text *"Lexi L. profile picture"* instead of the image; also publicly surfaces reputation ("25% accept · 32% cancel · 7/22 jobs").
- 🟡 **Standalone desktop-width inconsistency:** narrow ~512px centered (`/analytics`, `/family`, `/pets`, `/str-settings`, `/wrapped`, `/user`) vs full-width (`/benefits`, `/work-record`, `/home-history`, `/posted_jobs`). Pick one convention.
- ✅ `/business/*` (billing, team driven): two-pane layout + sub-nav (Team/Billing/Contracts/Exports/Reports/API/Onboarding) + clean "No business account / Create business account" empty state. The source "business-verification gate is cosmetic" finding **can't be confirmed live without a verified/unverified business account** — stays source-only.
- 🟢→**RETRACTED (likely automation artifact).** Session config is CORRECT — `src/integrations/supabase/client.ts:37-38`: `persistSession:true` + `autoRefreshToken:true` (localStorage on web). The ~3 mid-session logouts I hit clustered around dev-server restarts + Vite re-optimization full-reloads + Chrome automation disconnect/reconnect cycles — most likely the controlled browser losing its localStorage context, NOT a real user-facing bug. Only revisit if real users report mid-session logouts (then check refresh behavior during rapid reloads). Login redirect itself works correctly (preserves `?redirect=`).

### Live-spider coverage summary
Driven live authed: 8+ profile tabs (earnings/payment/security/referral/reviews/credentials/warnings/subscription/posted_jobs) + 10 standalone (analytics/family/pets/pay-it-forward/str-settings/work-record/home-history/wrapped/user/benefits) + business (billing/team) + guest/auth (login/signup/forgot-password/browse). Remaining un-driven (same empty-state pattern / uniform / context-gated / repeated session drops): `/payment-success`, business contracts/exports/reports/api/onboarding, profile completed_jobs/schedule/availability/legal/profile-edit — all source-covered + render per the confirmed uniform pattern.
- 🟡 **Standalone pages inconsistent on desktop width:** `/analytics` and `/family` render a **narrow ~512px centered column** (wide empty side gutters on 1440), while `/benefits` (corrected) and profile tabs are **full-width**. Pick one desktop-width convention. `/analytics` also correctly **Pro-gates** the advanced charts (blurred "Pro feature / Upgrade" cards). `/family` has a clean empty state ("You're not managing jobs for anyone yet" + permission explainer).
- ✅ earnings / payment / security all render **wide** + clean, no overflow, good empty states ("No jobs lined up yet / Browse jobs", "Connect to start earning / Set up payouts with Stripe", "Set a monthly earning goal").
- ✅ security: email "Change" ("confirmation link to verify changes" — still verify OLD-address notification per `SecurityTab.tsx:171`), password "Reset via secure email link", **Two-step verification** (TOTP, currently OFF), Active-sessions device list. Strong.
- 🟠 **NEW — membership offering is INCONSISTENT between public and in-app.** Public `/subscription` = **Free / Pro $10·mo / Elite $15·mo**, framed by platform-fee reduction (12/10/8%), monthly. In-app `/profile?tab=subscription` = **Basic $5 / Pro $10 / Elite $15**, framed by *perks* (Helpr Badge, Instant Payouts, Early Access, Job Boosts, Portfolio, Auto-Match, Landing Spotlight), with a **Once / Monthly / Annual** toggle **defaulting to "Once" (one-time)** and an extra paid **"Basic $5"** entry tier instead of "Free" — no fee-% shown. Two different membership stories + pricing models across the same product. Reconcile to one source of truth (`subscriptionTiers.ts`).
- ✅ Rendered clean, wide, no overflow, good empty states: referral (code + Share/Text/Copy + **QR in-person invite** + "$5 each / 5 friends / $25 max" + tier ladder), reviews ("No reviews yet — your first review sets the baseline"), credentials (licensed/insured toggles + "reviewed by admins before badges go live"), warnings ("Good standing / No warnings or violations").
- 🟠 **HIGH — Terms acceptance not versioned to shown text + no re-consent.** `supabase/functions/complete-signup/index.ts:426` hardcodes `terms_version:"Jun 2026"` (decoupled from `legalSections.ts` LAST_UPDATED); `CompleteProfile.tsx:239-241` writes `accepted_terms_at` with NO version. Derive from a shared constant; re-consent on material bump.
- 🟠 **HIGH — self-service email change confirms only the NEW address.** `src/components/profile/SecurityTab.tsx:171-174` `updateUser({email})` — old address never notified (the admin path `admin-update-email:246-274` DOES notify). Account-takeover gap. Enable Supabase "Secure email change" or notify old address.
- 🟡 `CompleteProfile.tsx:330-361` breaks from the shared `AuthShell` used by the other 4 account-state screens (hand-rolled wrapper/card/sign-out) — cohesion outlier.
- 🟡 `bg-white/60 dark:bg-white/5` non-token utility on every auth input (Login/Signup/ForgotPassword/ResetPassword/SignupPending). Use a surface token.
- 🟡 Signup reveals account existence (`Signup.tsx:245-249` "you already have an account") while ForgotPassword deliberately closes the same enumeration oracle — inconsistent. Product decision.
- 🟡 `ResetPassword.tsx:102-111` — one generic "not ready" message for no-token vs expired vs already-used link. Distinguish + CTA to /forgot-password.
- 🟡 `NotFound.tsx:26-98` (404) — bespoke, no shared nav/footer chrome. Wrap in PublicLayout (web) or document as intentional.
- 🟢 POLISH: SignupPending "start over" discards entered data; password-strength meter duplicated across Signup/ResetPassword; CompleteProfile avatar preview only shows blob: URLs not persisted ones.
- ✅ CLEAN: single-column auth layout (no two-column split in a narrow/modal context) ✓; **route guards correct** (`ProtectedRoute.tsx` — unauth→`/login?redirect=`, banned→banned, denied→denied, pending→pending, incomplete→complete-profile, approved not re-trapped); **18+ age gate server-enforced** (`complete-signup:306-331`, 403 regardless of client); guest surfaces route every action to `/signup` + bounce authed users to `/dashboard`; FamilyAccept scoped to invited recipient; forms (disabled/loading, autocomplete, inputMode, new/current-password) correct; anti-bruteforce 5-attempts/5-min lockout persisted.

---

## Follow-up A — Money-path integrity (verified safely; live cards NOT run)
⚠️ **Environment is LIVE Stripe.** Prod `jobs.stripe_session_id` values are `cs_live_` (Supabase read-only). The dev server (`localhost:8080`) → **production** Supabase (`fncmgoasalhdgfwzhsqa`) + **live** Stripe. So I did NOT enter any card or drive live checkout (real charge; test cards wouldn't work). Verified from source + tests.
- 🟠 **Operational finding:** local dev is wired to production data + live payments — a dev testing checkout locally creates real charges/jobs/payouts. Recommend a staging Supabase + Stripe test keys for local/audit work (this is what blocks safe end-to-end money-flow driving).
- ✅ **Idempotency on every charge/transfer/refund** (HIGH — MET): `create-payment` escrow `escrow-${jobId}` (:326), tip (:630), cancel-escrow (:722), refund-dispute (:948), dispute-release (:1278); `void-cancelled-payments` cancel-fee/refund (:92/:258); `release-payout` (:356); boost/bgc/pro/seat/pif/instant-payout/cash-out/stripe-connect/scheduled-payouts all keyed → retry/replay/double-tap = ONE charge.
- ✅ **Webhook signature verification** (HIGH — MET): `stripe-webhook:100`, `stripe-idv-webhook:74`, `verification-webhook:61` all `constructEventAsync(body, sig, secret)`; forged/unsigned events not processed; handler idempotent on session id.
- ✅ **Lifecycle unit tests present & correct** (`src/test/edge/*.test.ts`): idempotent second-checkout block · both-parties-confirm→payout · "refuses payout unless PI succeeded" · "rejects release while under dispute" · "refunds succeeded PI minus non-refundable service fee" · tip floor/ceiling · $2 onboarding line · LA sales-tax code. Couldn't EXECUTE here (mounted `node_modules` are macOS-native — rolldown binding fails in Linux sandbox); run `npx vitest run src/test/edge` on the Mac to confirm green.

## Follow-up B — iOS / native (Capacitor) readiness
Real shipped app (App Store Connect `com.Helpr` v1.0.4 build 19); config is mature & battle-tested (comments cite real device builds). Booted an iPhone 17 Pro / iOS 26.4 Simulator to drive live, but the app isn't installed there and installing needs `npx cap run ios` (can't build from Linux sandbox / can't type into Terminal) — so this is a SOURCE-readiness pass; a live on-device drive is the one open item.
- ✅ Safe-area insets via `env(safe-area-inset-*)` (`index.css:43,499-515`) + `contentInset:'never'` (the ~100px WKWebView double-count band above doc-scroll pages was already found & fixed).
- ✅ StatusBar plugin (anti-flicker, per-screen); keyboard `resize:'body'` + `interactive-widget=resizes-content`; tint-matched splash→FCP handoff; `-webkit-overflow-scrolling:touch`; tap-highlight transparent; `viewport-fit=cover`; pinch-zoom NOT disabled (a11y-correct); portrait lock; `helpr://` deep links; strict CSP; Apple+Google social login.
- 🟡 Verify on-device: no global `input{font-size:16px}` rule found → `text-sm`/`text-xs` inputs could trigger iOS focus-zoom. Add a ≥16px input rule or confirm.
- 🟡 Verify on-device: heavy `liquid-glass`/`backdrop-blur` → possible WKWebView scroll-jank on older iPhones; lazy-route blank-during-load likely shows here too.
- To finish live: `npx cap run ios` → I'll drive the booted app for the two items above + safe-area rendering + deep-link cold start.

## Remaining follow-up (needs env/inputs I can't self-provide)
1. Live end-to-end money/lifecycle driving with Stripe **test** cards → needs a staging Supabase + Stripe test keys (current env is live prod).
2. Live iOS on-device drive → needs `npx cap run ios`.
3. True 375px web → Chrome window floors at 500px (mobile-web layout is otherwise identical below the 1024 breakpoint; verified no overflow at 500).

## Accessibility (WCAG 2.1 AA) — token-level verified; live pass pending
- ✅ **Contrast is deliberately engineered at the token level** (correcting an earlier assumption that muted text likely fails — on the page canvas it does NOT). `--stormy-sky` (=`--muted-foreground`) carries the source comment *"darkened to meet WCAG AA 4.5:1."* Computed ratios on `--parchment` (light): primary `--olivewood` **≈12:1**, `text-muted-foreground` **≈5.3:1**, muted `olivewood/0.8` **≈6.6:1**, `--burnt-sienna` eyebrow **≈6:1** — all pass AA.
- 🟡 Not yet verified (needs the live contrast probe): text on **tinted / glass card** surfaces (vs the page canvas), any sub-0.8 opacity, `text-white` on the pastel action buttons, burnt-sienna on tint.
- 🟡 Not yet verified (needs live app): visible **keyboard focus rings**, `prefers-reduced-motion` honored by the auto-scrolling category marquee + `animate-ds-page-in`, accessible names on icon buttons, color-only status cues (category dots, red "cancelled" %).
- 🟢 `text-ds-11` (~11px) meta lines are small for readability (a size point, not a contrast failure).

### 💵 Money source-of-truth captured (for cross-checks)
- Membership (`src/lib/subscriptionTiers.ts`): Free $0 (12% platform fee) · Pro $10/mo (10%) · Elite $15/mo (8%) · Business $50/mo, $40 annual (6%). Helper keeps 100−fee (88/90/92/94%).
- Business **seat** pricing on `/for-business` (Starter 1·Free · Crew 2·$20 · Team 3·$30 · Enterprise 4+·$40) is a SEPARATE construct from membership — locate & verify its source in Run 3.
