# Louisiana Helpr — Full-Surface Exhaustive Audit

**Paste this entire file as the task for a fresh session.** Repo:
`/Users/lexilombas/louisianahelpr`.

This is the **exhaustive** audit: every screen, every path into it, every popup,
every state, every persona, every breakpoint, every platform. It supersedes
`docs/audit/WALK_EVERY_SCREEN_PROMPT.md` (which references a script that no
longer exists) and complements `/audit` (static grading) and `/improve`.

---

## 0. Read first, in this order

1. `CLAUDE.md` — stack, shell rules, working rules.
2. `.claude/skills/lh-audit/SKILL.md` — **invoke via the `Skill` tool, name
   `lh-audit`.** It is the standard. §3 is the per-screen dimension checklist;
   do not restate it here, *apply* it.
3. `AGENTS.md` — brand voice, dialog rules, safe-area rules.
4. `docs/PLATFORM_CONVENTIONS.md` — casing, tokens, §7 lane split, §8 what
   headless Chromium genuinely cannot verify.
5. `docs/audit/COVERAGE_LEDGER.md` — the manifest you are here to fill.

### Contradictions already resolved — do not re-litigate

The repo's audit docs disagree with each other in five places. These are the
rulings for this audit:

| Conflict | Ruling |
|---|---|
| SKILL.md §1 "a large UNVERIFIED section is a GOOD outcome" vs §5 "UNVERIFIED is NOT an acceptable final state" | **§5 wins.** This audit ends with a 100%-filled manifest. UNVERIFIED is a blocker to close, not a result to file. |
| SKILL.md:521 "primary controls are glossy (`btn-grad-primary` / `variant="bark"`)" vs AGENTS.md "no gloss/glow" | **Glossy wins** for green/bark primary buttons and selected controls. AGENTS.md's "no gloss" applies to decorative surfaces, not primary CTAs. A flat primary button is a defect. |
| `.claude/commands/audit.md` "branch + PR, never commit to `main`" vs CLAUDE.md "commit directly to `main`" | **CLAUDE.md wins.** Commit direct to `main`. |
| `.claude/commands/audit.md` "apply migrations via MCP `apply_migration`" vs CLAUDE.md "**NEVER**" | **CLAUDE.md wins.** Never `apply_migration`. `execute_sql` for read-only checks is fine. Schema changes go through `npm run migration:new -- <slug>` and auto-deploy on merge. |
| `docs/TWO_ACCOUNT_E2E_TEST_PROMPT.md` "You cannot type passwords, that restriction is absolute" / `scripts/e2e/README.md` "Claude is not permitted to handle the keys" vs SKILL.md §5 "self-provision gated cells" | **Self-provision wins.** You have standing authorization for testing, including prod Supabase writes against clearly-marked test accounts. Mint your own sessions (§3 below). "I couldn't sign in" is not an acceptable reason for an unfilled cell. |

Also stale, do not trust: `docs/audit/WALK_EVERY_SCREEN_PROMPT.md:39-40` calls
`node scripts/test-signin-link.mjs` — **that file does not exist.** Use §3.

### Commit trailer

Per `CLAUDE.md`, end every commit message with:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## 1. Mission and stopping condition

**Mission:** operate every surface of this app until the coverage manifest is
100% filled, fix everything you find, and leave durable artifacts proving it.

### The real surface count — ~178, not 48

Previous audits undercounted badly by conflating "routes" with "screens." The
honest tally, each figure derived from source, not asserted:

| Group | Count | Derivation |
|---|---:|---|
| Rendering routes | 34 | `grep -oE 'path="[^"]+"' src/App.tsx` = 48 total, minus 14 redirects |
| Redirect-only routes | 14 | `grep -c "Navigate to=" src/App.tsx` |
| Profile tabs | 17 | `Tab` union, `src/pages/profile/types.ts:5` |
| Admin views | 24 | `type View`, `src/pages/Admin.tsx:45` |
| Activity tabs | 2 | `activityConstants.ts` (× 4 status filters each = 8 more states) |
| **Navigable subtotal** | **91** | |
| Overlay roots (dialog / sheet / drawer / popover / dropdown / hovercard) | **78** | `grep -roE "<(Dialog\|AlertDialog\|Sheet\|Drawer\|Popover\|DropdownMenu\|HoverCard)\s+open=" src --exclude-dir=ui` |
| Native OS prompt classes | 9 | §6 B10 |
| **Total auditable surfaces** | **~178** | |
| Edge functions (separate axis) | 63 | `ls supabase/functions \| grep -v _shared` |
| Transactional + marketing emails (separate axis) | see §6.5 | `supabase/functions/*email*`, `*digest*`, `*report*`, `*nag*`, `*blast*` |

`COVERAGE_LEDGER.md` currently tracks **134 units** — it is missing the entire
overlay axis. **Extend the ledger with an overlay section as the first task of
this audit.** An audit that reports "all routes walked" while 78 popups have
never been opened is exactly the substitution this ledger exists to prevent.

**You are done when — and only when — all of the following are true:**

- Every one of the **91 navigable surfaces** in §5 is `WALKED` in
  `docs/audit/COVERAGE_LEDGER.md`, with real evidence.
- Every one of the **78 overlay roots** in §6 has been *opened and operated*,
  and each has a ledger row.
- All **63 edge functions** have an observed HTTP status.
- Every finding is either **fixed and committed** or listed in the
  revertible-changes log (§9) — nothing is left merely described.
- `npm run typecheck` and `npx vitest run` are green, committed, and CI is green.

**Do not stop to ask whether to continue.** Per SKILL.md §5, that permission is
granted here, once, for the whole run. Do not ask "should I keep going / do the
authed surface / provision an account / move to the next page" — the answer is
always yes. If usage limits interrupt you, resume on your own when they lift;
the owner will not re-prompt.

The only two legitimate reasons to raise a pop-up (`AskUserQuestion`, with
clickable options — never prose):

1. A genuine hard blocker you cannot self-provision (a physical device you don't
   have, a real external secret). **Finish every other cell first.**
2. An open **product/design/legal judgment** where the correct output is
   genuinely the owner's call (a fee number that disagrees with itself, a
   marketing claim you cannot substantiate). Batch up to 4 per pop-up.

---

## 2. Method — the six non-negotiables, applied

SKILL.md §1 states these. Here is what each means *for this audit specifically*:

1. **Spider before grading.** §5 and §6 below are the enumeration. Re-derive
   them from source at the start (`src/App.tsx`, `src/pages/profile/types.ts`,
   `src/pages/Admin.tsx`, `ls supabase/functions`) and **fix this file** if the
   counts have drifted. Several existing docs are stale precisely because nobody
   did this.
2. **Never trust code over pixel.** Every visual dimension is verified with a
   screenshot in hand, at every breakpoint, in both themes. If you catch
   yourself reasoning from source about how something *renders*, stop and
   screenshot.
3. **Force every state.** Loading, empty, error, offline, permission-denied,
   long names, big numbers, zero rows, mid-network-flap. §7 is the state matrix.
   A component with 6 states of which you saw 1 is 17% audited.
4. **Fan out parallel graders.** Dispatch read-only agents on non-conflicting
   scopes concurrently — never serial page-by-page. Suggested lanes in §10.
5. **Report ALL findings first, then fix.** Build the complete severity-ranked
   worklist *before* the first code edit. Silent-patching as you go hides the
   pattern and makes coverage unprovable.
6. **"Configured" is not "working."** The highest-yield defect class here is the
   **silent no-op**: correctly-wired code that does nothing and logs nothing.
   For anything configured, scheduled, gated, or integrated, produce evidence of
   *execution* — an HTTP status, a DB row, a per-step workflow conclusion.

### The assertion rule

For every control you touch, record: **what you did → what you expected → what
observably changed** (DOM, pixels, network, or a database row).

**"Nothing changed" is a finding**, even with a clean console. A click that
lands is not a feature that works.

Cross-check anything that looks empty against the database before believing it.
A dropped Supabase `error` renders as "no data" in this codebase — that is a
documented repeat offender.

---

## 3. Setup and sign-in (you can do all of this yourself)

### Worktree

Work in an isolated git worktree **under `$HOME`, never `/tmp`** (e.g.
`~/.lh-audit-ws/tree`) — other sessions are active in the main checkout.

```bash
npm ci                       # BEFORE any build; skipping it lets build:ios exit 0 with vite missing
cp /Users/lexilombas/louisianahelpr/.env .env    # gitignored; without it the app white-screens
                                                 # with "supabaseUrl is required" (known, not a bug)
```

Note: the main checkout currently has ~14 staged deletions (dead-code removal).
Do not assume a clean tree; check `git status` before you start.

### Minting a session for any persona — no password, no owner needed

`.env` contains `SUPABASE_SERVICE_ROLE_KEY`. The working pattern is already
implemented in `scripts/audit-capture.mjs:80-119`; copy it:

1. `POST {VITE_SUPABASE_URL}/auth/v1/admin/generate_link` with
   `{ type: "magiclink", email }`, `apikey` + `Authorization: Bearer` = service key.
2. Follow the returned `action_link` with `redirect: "manual"`.
3. Parse `access_token` / `refresh_token` from the `Location` hash fragment.
4. Write `{access_token, refresh_token, token_type:"bearer", expires_in:3600,
   expires_at, user:{id}}` to `localStorage["sb-fncmgoasalhdgfwzhsqa-auth-token"]`
   via `context.addInitScript` (Playwright) or before first paint.

Project ref: `fncmgoasalhdgfwzhsqa`.

Or just shell out — `scripts/test-signin-link.mjs` wraps exactly this and
refuses any address outside the seeded test set:

```bash
node scripts/test-signin-link.mjs poster              # magic-link URL
node scripts/test-signin-link.mjs helper --session --json   # localStorage blob
```

### MANDATORY — dismiss the onboarding tour in the SAME init script

`OnboardingTour` (`src/components/OnboardingTour.tsx`, mounted by
`src/pages/Dashboard.tsx`) opens on `/dashboard` — where every signed-in pass
starts — 1.5s after load, in **every fresh browser context**: new Playwright
context, incognito window, cleared simulator, and *each of the three origins*
in the two-origin trick below. It is a Radix dialog that **blurs the page
behind it and intercepts clicks**. A harness that does not dismiss it
screenshots a blurred dashboard, measures the tour's layout, feeds axe the
tour's DOM, and files all of that as findings about the screen underneath. The
1.5s delay also makes it intermittent — a ~1500ms settle straddles the
boundary, so the same screen comes out clean on one run and blurred on the
next.

It is gated purely on `localStorage`, so seed the completed state **before
first paint**, right next to the session:

```js
await context.addInitScript(() => {
  try {
    localStorage.setItem(
      "helpr_onboarding",
      JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }),
    );
  } catch {}
});
```

Key `helpr_onboarding`, shape `{completed, currentStep, completedSteps}`;
`completed: true` is what suppresses it. If a screenshot looks softly blurred
or a click lands on nothing, check this before filing anything. The tour is
still in scope — audit it once, deliberately, in a context where the key is
*not* seeded.

### The personas — every flow is walked as each

| Persona | How to become it |
|---|---|
| **Signed-out visitor** | Fresh context, no session. |
| **Customer / poster** (Account A) | `helpr-audit-web-0824@mailinator.com` · `e977a30f-7065-4e75-8498-dba435ac2044` ("Audit Weblane") — 7 posted jobs across every state. |
| **Helper** (Account B) | `eli.test.helper@louisianahelpr.com` · `6bdc1f67-ae1f-46a0-8edf-4035629a6147` ("Audit Helper") — works A's jobs. Note: this account is `ban_status = 'temp_banned'` in prod, which is why its own public profile is correctly withheld. Reset it if that blocks a cell, and put it back. |
| **Admin** | Mint a session for a test account, then elevate via Supabase MCP `execute_sql`: `approval_status='approved'`, `is_admin=true` / `user_roles` row `role='admin'`. Admin **is in scope** — all 24 views. |
| **Account states** | Drive `/account-pending`, `/account-denied`, `/account-banned` by setting `approval_status` / `ban_status` on a test profile, then reverting. |
| **Unverified / half-onboarded** | Clear profile-completion fields to hit `/complete-profile` and the `ProtectedRoute` gates. |
| **Subscription lapsed** | Flip the subscription row to expired to force `ProUpgradeSheet` / paywall states. |

**Never touch a non-`is_seed` account.** Revert every state change you make.

### The two-origin trick — three simultaneous sessions, one dev server

The dev server is one process on three origins with **isolated storage**:

- `http://localhost:8080` → poster
- `http://127.0.0.1:8080` → helper
- `http://[::1]:8080` → guest

This is how you audit cross-account behaviour (message delivery, offer
accept/decline landing on the other side, arrival propagation) without ever
signing anything out.

### Stripe

Test card `4242 4242 4242 4242`. `scripts/e2e/stripe-sandbox-on.sh` flips edge
functions to test mode and creates a test webhook; `stripe-sandbox-off.sh`
restores live. **Confirm which mode you are in before any payment step**, and
restore live mode when you finish.

### Serve a real build, not the dev server

```bash
kill $(lsof -ti:4173) 2>/dev/null; sleep 2     # MANDATORY — playwright.config.ts:124 sets
                                              # reuseExistingServer, so a stale server means
                                              # you audit an old dist/
npm run build && npx vite preview --port 4173 --strictPort --host 127.0.0.1
```

Dev-mode HMR and unminified code change timing and hide real defects.

---

## 4. The axes — every surface is audited across all of these

Every cell in the manifest is `surface × persona × breakpoint × theme ×
platform × state`. Cutting any axis is cutting the audit.

### Breakpoints (all six, plus the rail transition)

`320` · `375` · `414` · `768` · `1024` · `1440`

Plus: the desktop-rail transition at **1023 / 1024 / 1025**, the width ladder at
1280 / 1536 / 1920, a short viewport (375×500), and landscape (812×375).

### Themes

Light **and** dark. Set via `data-theme` on `<html>` — **never**
`prefers-color-scheme` (that is how the sweep does it; CDP colour-scheme
emulation does not drive this app's theme).

Also run a `prefers-reduced-motion: reduce` pass — confirm animations degrade
rather than disappear or break layout.

### Platforms

1. **Chrome web** — all six breakpoints, both themes. **Finish 100% of Chrome
   before opening the simulator.** Enumerated HIGH findings from the Chrome pass
   must be *fixed*, not just listed, before you move on.
2. **iOS Simulator** — device `10492853-2555-4C57-8542-F555BCEA9865`, coordinate
   space 402×874 pt.
   ```bash
   npm run build:ios && npx cap sync ios
   ```
   then build the workspace `ios/App/App.xcworkspace`, scheme `App`, attach,
   launch. Drive it by controlling the Mac (AX tree + `cliclick` + keystrokes).
   **"I can't tap the simulator" is not a valid blocker.** The WKWebView surface
   is verified by running it, never inferred from the Chrome pass.
3. **Real device via TestFlight** — the final pass. This is the only surface
   where haptics, real push delivery, the real camera, real Face ID, and true
   Dynamic Type can be verified. Everything `docs/PLATFORM_CONVENTIONS.md` §8
   lists as unverifiable in headless Chromium (native `<select>`/date/time/file
   pickers, `::-webkit-search-cancel-button`, scrollbar chrome, autofill
   background, spellcheck underlines, `:autofill`) resolves here. If a build is
   not available to you, that is a legitimate §1-pop-up blocker — but only after
   every other cell is filled.

### Platform-split surfaces — audit BOTH branches

Nothing is gated on `VITE_CAPACITOR_BUILD` at the route layer; splits are
runtime via `Capacitor.isNativePlatform()`:

| Surface | Web | Native |
|---|---|---|
| `/` | marketing landing; `MarketingRedirect` bounces signed-in → `/dashboard` | `MarketingRedirect` is a **no-op**; `NativeRedirect` → `/dashboard` or `/browse` |
| `/jobs` | public marketing jobs page | redirects → `/browse` (`?job=` preserved) |
| `/browse` | optional no-account preview | the canonical guest home |
| `/help`, `/legal`, `/support`, 404 | `PublicLayout` marketing chrome | chrome swaps to `AppShell` |
| `/payment-success` | https return from Stripe | reached via `helpr:///payment-success` scheme bounce |

---

## 5. Manifest A — the 91 navigable surfaces
### (34 routes + 14 redirects + 17 profile tabs + 24 admin views + 2 activity tabs)

Source of truth is the `<Routes>` table in `src/App.tsx` (lines ~153-323); there
are no nested route files. **Re-derive before starting.**

### A1 — Rendering routes (34)

| # | Route | Component | Auth | Guard | Notes |
|---|---|---|---|---|---|
| 1 | `/` | `Index` | public | `RouteErrorBoundary` → `MarketingRedirect` → `PageTransition` | native branch renders `NativeRedirect` |
| 2 | `/login` | `Login` | public | own signed-in bounce | social auth sheet on native |
| 3 | `/signup` | `Signup` | public | | multi-step; business signup path |
| 4 | `/signup-pending` | `SignupPending` | public | | |
| 5 | `/complete-profile` | `CompleteProfile` | signed-in | `ProtectedRoute allowUnapproved` | checklist gate |
| 6 | `/account-pending` | `AccountPending` | public | | force via `approval_status` |
| 7 | `/account-denied` | `AccountDenied` | public | | force via `approval_status` |
| 8 | `/account-banned` | `AccountBanned` | public | | force via `ban_status` |
| 9 | `/forgot-password` | `ForgotPassword` | public | | incl. success state |
| 10 | `/reset-password` | `ResetPassword` | public | | needs a real recovery link |
| 11 | `/dashboard` | `Dashboard` | signed-in (pending OK) | `ProtectedRoute allowPending` | `DashboardRouteSkeleton` fallback |
| 12 | `/profile` | `Profile` | signed-in | `ProtectedRoute allowUnapproved` | 17 tabs → A3 |
| 13 | `/post-job` | `PostJob` | approved | `ProtectedRoute` | 5 entry paths, 3-step wizard |
| 14 | `/my-jobs` | `Activity` (`applied`) | pending OK | `ProtectedRoute allowPending` | |
| 15 | `/my-posts` | `Activity` (`posted`) | pending OK | `ProtectedRoute allowPending` | |
| 16 | `/payment-success` | `PaymentSuccess` | approved | `ProtectedRoute` | reach via real Stripe return |
| 17 | `/user/:userId` | `UserProfile` | approved | `ProtectedRoute` | see §5 params |
| 18 | `/admin` | `Admin` | **admin** | `ProtectedRoute` → `AdminRoute` | 24 views → A4; excluded from AASA |
| 19 | `/messages` | `Messages` | pending OK | `ProtectedRoute allowPending` | |
| 20 | `/support` | `Support` | public | deliberately not `MarketingRedirect` | |
| 21 | `/legal` | `Legal` | public | | tabs: terms/privacy/community |
| 22 | `/jobs` | `Jobs` | public | | authed users self-redirect to `/dashboard?quickApply=` |
| 23 | `/jobs/:id` | `JobDetail` | public preview | | signed-in users redirected |
| 24 | `/browse` | `DashboardGuest` | public | `GuestBrowseSkeleton` | native guest home |
| 25 | `/str-settings` | `StrSettings` | approved | `ProtectedRoute` | comment claiming "public" is stale |
| 26 | `/auto-tip` | `AutoTip` | approved | `ProtectedRoute` | |
| 27 | `/gift-card` | `PayItForward` | approved | `ProtectedRoute` | |
| 28 | `/home-history` | `HomeHistory` | approved | `ProtectedRoute` | |
| 29 | `/work-record` | `WorkRecord` | approved | `ProtectedRoute` | |
| 30 | `/help` | `HelpCenter` | public | | |
| 31 | `/wrapped` | `HelprWrapped` | approved | `ProtectedRoute` | |
| 32 | `/benefits` | `BenefitsPage` | approved | `ProtectedRoute` | |
| 33 | `/pets` | `PetProfiles` | approved | `ProtectedRoute` | |
| 34 | `*` | `NotFound` | public | `RouteErrorBoundary` only (no `PageTransition`) | drops the `app-shell` lock via `setNotFoundPathname()` |

### A2 — Redirect-only routes (14)

A redirect is walked when you have **observed the landing URL**, not when you
have read the `<Navigate>` element.

`/activity`→`/my-posts` · `/earnings`→`/profile?tab=earnings` ·
`/terms`→`/legal?tab=terms` · `/privacy`→`/legal?tab=privacy` ·
`/rules`→`/legal?tab=community` · `/data-rights`→`/profile?tab=legal` ·
`/schedule`→`/profile?tab=schedule` · `/availability`→`/profile?tab=availability` ·
`/saved-helpers`→`/profile?tab=saved_helpers` · `/pay-it-forward`→`/gift-card` ·
`/analytics`→`/profile?tab=earnings` · `/dashboard/post-login`→`/dashboard` ·
`/settings/profile`→`/profile` · `/settings`→`/profile`

`/data-rights` is published in the Privacy Policy and the App Store listing —
its destination is behind `ProtectedRoute allowUnapproved`, and
`isProfileGateAllowed()` specially permits `/profile?tab=legal` for
half-onboarded users. **Verify that exemption actually holds** for a
half-onboarded account; if it doesn't, a legally-published URL is broken.

### A3 — Profile tabs (17)

Source: `Tab` union in `src/pages/profile/types.ts`. `/profile?tab=<key>`:

`landing` · `profile` · `earnings` · `schedule` · `availability` · `payment` ·
`security` · `legal` · `reviews` · `referral` · `subscription` · `support` ·
`notifications` · `warnings` · `credentials` · `saved_helpers` · `accessibility`

`/profile` being walked does **not** cover any of these. For each: confirm
content loads rather than sitting on a skeleton, and that **edits persist across
a cold relaunch** (not just a re-render).

⚠️ `e2e/happy-path/auditRoutes.ts` still lists `posted_jobs` and
`completed_jobs`, which are **no longer in the union** — they silently fall back
to the landing tab. `accessibility` is in the union but **missing from the
catalog**. Fix the catalog as part of this audit.

### A4 — Admin views (24)

Source: `type View` in `src/pages/Admin.tsx:45`. `/admin?view=<key>`:

`home` · `analytics` · `people` · `jobs` · `settings` · `disputes` ·
`broadcasts` · `notifications` · `notiflogs` · `reports` · `support` ·
`referrals` · `subscriptions` · `fraud` · `audit` · `health` · `export` ·
`payouts` · `tiers` · `marketing` · `idvreview` · `credentials` · `exceptions` ·
`banreview`

⚠️ `scripts/audit-capture.mjs` still lists 27 admin views including
`parishtax`, `idv`, `geography`, `business_verify`, `business_accounts` — those
are **gone**. Re-derive the list and fix the script.

### A5 — Activity tabs (2)

`posted` (`/my-posts`) and `applied` (`/my-jobs`). Each has status filters and
per-status card states — **force them all**. A tab seen in one status is not a
walked tab. Known filters: `?filter=scheduled|waiting|completed|done`.

### Parameterised routes — where a real id comes from

| Route | Sample source |
|---|---|
| `/user/:userId` | `profiles.id` from Supabase, or any avatar link on the dashboard feed. Missing-case id: `10000000-0000-4000-8000-00000000dead`. Also audit a **blocked** user and a **temp_banned** user (correctly withheld). |
| `/jobs/:id` | Seeded ids `10000000-0000-4000-8000-00000000000{1..6}` (one per `job_status`), or prod seeds `5eed0827…` / `5eed0828…` / `5eed0829…`. Also `ShareJobButton` produces `/jobs/{id}?ref=share`. |

### Query-param sub-screens (audit as distinct surfaces)

`/dashboard?quickApply=<jobId>` · `/messages?jobId=&userId=` ·
`/browse?job=<id>` · `/legal?tab=` · plus every A3/A4 param.

### Deep links / universal links

AASA at `public/.well-known/apple-app-site-association`, appID
`P85MCK558V.com.Helpr`. Claimed: `/jobs`, `/jobs/*`, `/j/*`, `/user/*`, `/u/*`,
`/messages`, `/messages/*`, `/m/*`, `/legal`, `/legal/*`, `/post-job`,
`/post-job/*`. Excluded: `/admin/*`, `/api/*`, `/.well-known/*`, `/auth/*`.

Normalizer `src/lib/deepLinkRoute.ts`: hosts `louisianahelpr.com` /
`www.louisianahelpr.com`; `/u/:id`→`/user/:id`, `/j/:id`→`/jobs/:id`,
`/m/:id`→`/messages?jobId=:id`, `/legal/:tab`→`/legal?tab=:tab`,
`/post-job/*`→`/post-job`. Custom scheme `helpr://` accepted host-less for the
Stripe return.

**Audit each claimed pattern by actually opening the link on the device/sim**,
plus cold-launch routing (`NativeLaunchRouter`, `nativeLaunchRoute.ts`,
`nativeLaunchMutex.ts`) and resume (`RouteMemory.tsx`).

⚠️ `/j/:id`, `/u/:id`, `/m/:id`, `/legal/:tab` exist **only** as native
normalizations — they 404 in a web browser. Confirm that is intended.

### Known 404s and sitemap drift — verify and fix

- **`public/sitemap.xml` lists `/subscription`, which is not a registered
  route** — it renders NotFound. The real screen is `/profile?tab=subscription`.
  `src/lib/sitemap.test.ts` does not assert that every `<loc>` resolves, which
  is how it slipped through. **Fix both the sitemap and the test.**
- `TODO.md` F-SEO-01 says ~20 public pages are missing from the sitemap.
- Retired paths that now genuinely 404 (deleted in `2352466e`):
  `/how-it-works`, `/become-a-partner`, `/enterprise`, `/community`,
  `/parishes`, `/parish/:slug`, `/impact`, `/local-guide`, `/browse-jobs`,
  `/evacuation`, `/job-history`, `/accessibility`, `/family`,
  `/family/accept/:token`. Confirm nothing still links to them (in-app, in
  emails, in the App Store listing, in the sitemap).

---

## 6. Manifest B — every popup, overlay and non-route surface

**This is the part every previous audit skipped, and it is nearly as large as
the route surface itself: 78 overlay roots + 9 native prompt classes.** Each must be
*opened and operated*, at phone and desktop widths, in both themes. For each,
verify the SKILL.md §2 popup rules: `DialogHero` (eyebrow → title → optional
subtitle), the X at `right-4 top-4`, the `pr-10` lane preserved, `p-5` mobile /
`p-7` sm+, `onOpenAutoFocus` prevented when the first child is an input, and
**no re-added `max-h-[90vh] overflow-y-auto`** (base `DialogContent` already
caps `max-h-[88dvh]`).

### B1 — Global, mounted in `src/App.tsx`

| Component | Kind | Trigger |
|---|---|---|
| `PermissionRationaleDialog` | confirmation → gates every native prompt | `usePermissionRationale().request(kind, fn)` — camera/photos, location, notifications |
| `TermsReconsentDialog` | blocking legal consent | auto-opens when `terms_version_accepted < LATEST_TERMS_VERSION` |
| `AppLockGate` | full-screen overlay + Face ID | cold start with session, or resume past grace, when Profile→Security→App Lock is on |
| `OfflineBanner` | network banner | `useOnlineStatus` / `@capacitor/network` |
| `StrikeBanner` | warning banner | `ban_status` / `auto_suspended_until` non-null |
| `ui/sonner` | toast host | ~129 files call `toast()` |
| `ui/toaster` + `ui/toast` | legacy Radix toast | only 3 callers (`AdminHealth`, `EarningsTab`, `useHelperMilestones`) — **candidate for consolidation** |
| `SuccessMomentHost` / `SuccessMoment` | ~1.3s auto-dismiss overlay | `fireSuccessMoment()` — job posted / hired / completed |
| `ErrorBoundary`, `RouteErrorBoundary`, `SectionBoundary` | error fallbacks | render crash, lazy-chunk fetch failure |

### B2 — Dashboard / Browse / Jobs

`JobDetailDialog` (+ `JobDetailFooter`, `JobLocationPreview`, `JobStatTiles`) ·
`ApplyConfirmDialog` (+ `ApplyBody`, `ApplyEarningsBreakdown`) · `FilterSheet`
(popover when anchored, sheet fallback) · `SavedSearches` · `PhotoLightbox`
(single + grid + pinch-zoom) · `OnboardingTour` (multi-step spotlight) ·
`BirthdayPopup` · `PushNotificationPrompt` · `BroadcastBanner` (info / warning /
urgent / promo — force all four) · `DashboardStatusBanners` ·
`PayItForwardTeaser` · `NotificationPanel` (+ `NotificationTrigger`)

### B3 — Activity (the largest family)

`ActivityDialogs` (lazy host) · `JobBoostDialog` · `TipDialog` ·
`CancellationDialog` · `CompletionPrompts` · `NpsPrompt` ·
`ResponseDeadlineDialog` · `DisputeDialog` · `DisputeTimelineDialog` ·
`EditJobDialog` (+ nested AlertDialog) · `ReviewForm` · `AwardGateDialog` ·
`W9CollectionDialog` · `CompletionChoiceSheet` · `DeclineApplicantSheet` ·
inline "Withdraw Application?" sheet (`AppliedJobsTab.tsx:349-485`) ·
`ApplicantsPanel` (full-screen) · `PhotoProof` · `JobConfirmation` ·
`JobPetCareSheet` · `PetReportCard` · `SosShareButton` · `BrandConfirmDialog`
(shared, ~15 call sites) · `ActivitySectionedView` collapsibles ·
`BulkDismissBar` + `BulkDismissibleWrapper`

### B4 — Messages

`ChatHeader` dropdown + sheet + dialog · `MuteSheet` (1h / 8h / tomorrow /
forever) · `MessageActionSheet` (copy / edit / delete — **the 15-minute edit
window is a state to force**) · `ConversationList` per-row dropdown ·
`AttachSourceSheet` (Camera / Library / Files) · `ViolationDialog` (blocked
content) · `BlockUserDialog` · `ReportDialog` · `MessageAttachment` full-screen
viewer · `JumpToBottomButton`

### B5 — Profile

`DeleteAccountDialog` · `SecurityTab` inline change-email dialog + global
sign-out confirm + biometric App Lock toggle · `TwoFactorCard` `EnrollDialog` /
`DisableDialog` · `InstantPayoutDialog` (+ Face ID) · **`ProUpgradeSheet`
(paywall)** · `CancelSurveyDialog` · `PauseOfferDialog` · `EarningsExport`
(dialog + date-range popover) · `EarningsToolsMenu` · `ThresholdBanner` ·
`PayoutCelebration` · `HelperScheduleStrip` popover + dialog · the picker family
(`TimeRangeField`, `TimePickerSelect`, `TimePickerWheel`, `DateWheelPicker`,
`DatePickerField`) · info popovers (`ReviewsTab`, `SavedHelpersTab`,
`CareerMilestones`, `EarningsForecastCard`, `HelperStreakBadge`,
`HelperTierBadge`) · `ReferralSection` share sheet + Face ID cash-out ·
`IdentityHeader` share sheet · `CollapsedPolicy`

### B6 — Post Job

`IDVPromptDialog` (identity gate) · `RedirectingOverlay` (blocking checkout
redirect) · `CurrentLocationPill` (native geolocation) · `PhotoUpload` ·
`CategoryPicker` · `PetPicker` · `RecurringSchedulePicker` · `MaterialsPanel` ·
`DirectOfferBanner` · `OpenJobLimitNotice`

### B7 — Nav / shell

**`GateSheet`** (guest conversion paywall — signed-out user taps a locked tab or
the Post FAB) · `NavQuickMenu` (long-press a bottom-nav tab) · `sidePanelOpen` ·
`ui/sidebar` (sheet on mobile, tooltip on collapsed rail) ·
`PullToRefreshWrapper`

### B8 — Other user-facing

`UserProfile` dropdown (report / block / share) · `PetForm` (sheet +
full-screen + confirm) · `ShareJobButton` (native share → `navigator.share` →
clipboard fallback — **test all three fallback tiers**) · `calendarExport` (.ics
share) · `PaymentSuccess` share + inline SuccessMoment · `JobTracking` live
geolocation overlay · `HelperAvailability` · `SaveHelperButton` · `QuickReplies`

### B9 — Admin

`AdminCommandPalette` (**Cmd-K**, hand-rolled on `ui/dialog.tsx`, not cmdk) ·
`AdminUserDetailDialog` + all `userDetail/*` tabs · `BanDialog` ·
`DeleteUserDialog` · `DenyUserDialog` · `EditEmailDialog` ·
`FormalWarningDialog` · `ManualVerifyDialog` · `ResetPasswordDialog` ·
`ReuploadIdDialog` · `adminJobs/JobDetailDialog` · `RefundJobDialog` ·
`RemoveJobDialog` · `StatusOverrideDialog` · inline dialogs in `AdminBanReview`,
`AdminCredentialQueue`, `AdminExceptionQueue`, `AdminFraudDashboard`,
`AdminIDVReview`, `AdminReports`, `AdminUserNotes`, `AdminPayoutBatches`,
`AdminSettings`, `AdminBroadcasts`, `AdminDisputes`, `AdminMarketing` ·
`NotesIndicator` (**the app's only HoverCard**) · `AdminSidebar` /
`AdminTopBar` · `AdminAnalyticsDrilldowns`

**Destructive admin dialogs: verify they fail CLOSED.** A refund/ban/delete that
reports success without writing is the worst defect class in this app. Confirm
each with a SQL read afterward.

### B10 — Native OS prompts (iOS sim + device only)

| Prompt | Sources |
|---|---|
| Camera + Photo Library | `nativeCamera.ts` ← `RichMessageInput`, `PhotoProof`, `ReviewForm` |
| Geolocation | `useUserLocation`, `JobTracking`, `CurrentLocationPill`, `RichMessageInput` |
| Push permission | `nativePush.ts`, `pushPermissionNudge.ts` |
| Face ID / Touch ID | `biometricGate.ts` ← `AppLockGate`, `InstantPayoutDialog`, `ReferralSection`, `SecurityTab` |
| OS share sheet | `nativeShare.ts`, `ShareJobButton`, `calendarExport`, SOS, referral |
| Sign in with Apple / Google | `socialAuth.ts` ← `SocialAuthButtons` on `/login`, `/signup` |
| In-app browser | `openExternalUrl.ts` ← Stripe Connect / IDV / external links |
| Splash + status bar | `nativeInit.ts` — **`launchShowDuration: 0` once made the splash never render; re-verify by watching launch** |
| Keyboard inset | `useKeyboardInset.ts` — every text input on native |

**For each: audit the denied path, not just the granted one.** Deny the
permission and confirm the app degrades with honest copy rather than silently
doing nothing.

---

## 6.5 Manifest C — every email the system sends

Emails are a shipped, user-facing surface that no previous audit has covered.
They are also the surface with the least forgiving rendering environment in
software: Gmail strips `<head>` styles, Outlook ignores flexbox and grid, and
many clients block images by default.

Enumerate every sender in `supabase/functions/` — at minimum
`send-notification-email`, `process-email-queue`, `auth-email-hook`,
`send-account-status-email`, `send-marketing-blast`, `weekly-helper-report`,
`notify-email-change`, `payment-confirm-reminder`, `review-nag-cron`,
`daily-match-digest`, `expiring-jobs-push`, `email-tracking`, `contact-support`,
`complete-signup` — plus shared helpers in `supabase/functions/_shared/`.

For **each** email: trigger event · sending function · exact subject line ·
template `file:line` · recipient.

### Format checklist — run on every template

- **Multipart:** HTML *and* a plaintext alternative. HTML-only hurts
  deliverability and is unreadable to screen readers and text clients.
- **Table-based layout.** `div` + flex/grid silently collapses in Outlook.
- **Inline CSS.** Gmail strips `<style>` in `<head>` — anything styled there is
  unstyled in the largest client on earth.
- **~600px max-width container**, no fixed pixel widths that overflow on phones.
- **Images:** absolute URLs (never relative or localhost), `alt` on every one,
  and the email still makes sense with images blocked.
- **Dark mode:** `prefers-color-scheme` handling, or a palette that survives a
  client's forced inversion. Check that dark-mode inversion doesn't render text
  invisible.
- **Unsubscribe link** on every marketing/digest email (CAN-SPAM). Its absence
  on a non-transactional send is a 🔴 Blocker, not a nit.
- **Brand parity with the app:** the italic Bodoni "Helpr·LA" wordmark, bark /
  burnt-sienna palette. A default provider template is a defect.
- **Copy rules apply here too:** canonical nouns (job not task, Helpr/Helprs,
  poster, Membership, Gift Card), Title Case for subjects, sentence case for
  body.
- **No placeholders:** no lorem, no `TODO`, no unreplaced `{{variable}}`
  reaching a real inbox.
- **No wrong-environment URLs:** nothing pointing at localhost, staging, or a
  stale domain.

### Sending-path correctness

Which provider, key server-side only, retry/queue behaviour
(`email_send_log` / `process-email-queue`), and — the repeat offender — whether
a send failure can be **silently dropped**. Prove delivery by execution: send a
real one to a seeded test address and confirm the row reaches status `sent`.

### Render them, don't just read them

Extract each template's HTML and open it in a browser at 375 and 600px, in both
themes, and screenshot it. A template that has only ever been read has not been
audited — the same rule as every other surface.

---

## 7. State matrix — force these on every surface

| State | How to force |
|---|---|
| **Loading / skeleton** | Throttle to Slow 3G; confirm the skeleton matches the loaded layout (no jump). Route-level: `DashboardRouteSkeleton`, `GuestBrowseSkeleton`, `RouteSuspenseFallback`. |
| **Empty** | Delete/filter to zero rows. Primitives: `ui/EmptyState`, `empty-state/illustrations/*` (`EmptyInbox`, `EmptyJobs`, `EmptyNotifications`, `EmptyPosts`, `EmptyReviews`, `EmptySavedHelprs`), `ActivityEmptyState`, `MessagesEmptyThread`, `payItForward/EmptyState`, `ApplicantsStates`. |
| **Error** | Block the request in DevTools / return a 500. Primitives: `ui/ErrorState`, `ui/FieldError`, `ProfileSectionError`, `SectionBoundary`, `DashboardBlockedScreen`. |
| **Offline** | Toggle offline. `OfflineBanner` + `offlineBannerLayout` must shift `AppShell`/`Navbar` down without overlap. Note there is **no "back online" confirmation** — decide if that's a finding. |
| **Error-as-empty** | The signature bug: a dropped Supabase `error` renders as an innocent empty state. For every empty state you see, **query the DB to confirm it is genuinely empty.** |
| **Permission denied** | Deny camera / location / push / biometric and re-enter the flow. |
| **Long content** | 40-char unbroken string, very long title, long email, accented name (see `e2e/happy-path/seedData.ts`). |
| **Big numbers** | Large earnings, 4-digit job counts — check truncation and alignment. |
| **Stale-data race** | Two origins acting on the same job simultaneously. |
| **Realtime** | Every `postgres_changes` channel must have a user-scoped server-side `filter` and a unique `channelNonce()` name — a reused name silently drops the second subscription. |
| **Cold relaunch** | Every persisted setting must survive a full app restart, not just a re-render. |
| **Force-upgrade** | There is **no** update-required banner in the codebase (`updateRequired` / `minVersion` / `force_update` all return nothing). Flag as a gap. |

---

## 8. Cross-cutting checks (beyond per-screen dimensions)

Run SKILL.md §3 on every screen. These are *additional*, app-wide:

### Layout — measured, never eyeballed

At **1440** (rail present) and **375** (no rail), for every page, assert:

```js
document.documentElement.scrollWidth <= document.documentElement.clientWidth
```

plus: no element wider than the viewport, and the primary content column
centered in the **post-rail** area (visual center = `(rail_width + viewport)/2`,
not raw viewport center). Screenshot both.

- **The desktop rail inset is applied in exactly ONE layer, globally.** A page
  must never re-inset itself — no `paddingLeft: var(--desktop-sidebar-w)`, no
  `lg:pl-[248px]`, no extra flex spacer. Doing so shoves content right by a
  second rail width (the PostJob bug: content at x≈496 with a dead 250px
  gutter).
- **≥65% desktop fill** at 1440 (`e2e/visual-audit/desktop-fill.spec.ts`
  `MIN_FILL_PCT`). Blank gutters left and right at 1440/2xl is the tell.
- **Repeating items lay out as a grid on wide web, never a vertical stack.**
- Shell choice must agree with `DOCUMENT_SCROLL_ROUTES` in
  `src/hooks/useAppShellViewport.ts`.

### Chrome — exactly once, never zero, never twice

- **Back button sits to the LEFT of the title block, never stacked above it.
  Global, no exceptions.** Canonical: one `flex items-center gap-3` row —
  `<BackButton />` in a `shrink-0` wrapper first, then eyebrow/title/meta in
  `flex-1 min-w-0`, then actions in their own `shrink-0`. A
  `<div className="mb-2"><BackButton /></div>` above the title is a defect,
  every time.
- **The global top nav is REQUIRED on every non-focused screen.** Marketing nav
  on public pages; the `DashboardHeader` family (HelprMark left,
  `NotificationPanel` right) in-app. Only genuinely focused flows (auth screens,
  the post-a-job wizard) may omit it. A bespoke header instead of the shared one
  is a defect.
- Check the parent first: `Admin.tsx` already renders `<AdminSectionHeader>`, so
  a sub-view adding its own `<h2>` produces two stacked titles.

### Design system

- Colours **only** via `style={{ color: "hsl(var(--token))" }}` — never Tailwind
  colour utilities. A bare `text-burnt-sienna` produces **no styles at all**.
- `text-ds-*` only defines 9/10/11/13/15/17/20/24/32/40 — anything else is a
  no-op.
- **Green/bark primary buttons and selected controls must be glossy**
  (`btn-grad-primary` / `variant="bark"`), never flat. Exactly **one**
  unambiguous primary action per screen; two competing glossy CTAs is a
  hierarchy defect.
- Widths are **derived** from the canonical ladder, never guessed: single-column
  card lists `max-w-lg mx-auto`; wide pages
  `max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem]`.
- Interaction language is consistent **globally**, not per-page.
- Dock clearance: `calc(env(safe-area-inset-bottom,0px) + 96px + 1rem)`.
  **`pb-32` is 2px short — never use it.** `DashboardHeader` already applies
  `paddingTop: env(safe-area-inset-top)` (double-padding gotcha).

### Copy

- **Title Case** for screen titles, popup titles, and button labels; **sentence
  case** everywhere else (`docs/PLATFORM_CONVENTIONS.md`). ⚠️ The button-label
  sweep is explicitly **incomplete** — mixed button casing is known state, not a
  new finding.
- Titles are **one line, never two** — header `h1`/`h2` carry `truncate` +
  `min-w-0`. Exemption: `DashboardBlockedScreen`.
- Canonical nouns: **job** (not task), **Helpr / Helprs**, **poster**,
  **Membership**, **Gift Card**. There is **no bidding and no quotes**. The app
  is **never role-based** — every account can both post and work.
- ⚠️ `.text-display-eyebrow` is `display: none` (`src/index.css:1848`). The
  skill still mandates the eyebrow stack and calls a missing eyebrow a defect —
  **that guidance is stale.** Either restore the class or stop treating a
  missing eyebrow as a finding; decide and fix one way.
- `statusLabels.ts` casing is **test-enforced** — changing a label means
  updating `statusLabels.test.ts` in the same commit.

### Accessibility

- Run axe via the existing sweep, not by hand.
- Tap targets ≥44×44pt. Known offender: `components/ui/calendar.tsx` day cells
  at `h-9 w-9`.
- One `<h1>` per page, no skipped heading levels, landmarks present.
- Contrast AA in **both** themes (a 1.92:1 gradient failure sat green once
  because the sweep asserted nothing).
- `docs/qa/ACCESSIBILITY_AUDIT.md` is a manual device checklist with every box
  unchecked — **fill it during the TestFlight pass** (VoiceOver golden flows,
  Dynamic Type at max, Reduce Motion, deuteranopia) and sign it off.

### Money, trust and security (audit as you walk, don't defer)

- **Never drop the Supabase `error`** — `unwrap()` in a `queryFn`,
  explicit check elsewhere.
- **A null `error` does NOT mean the write happened.** UPDATE/DELETE matching
  zero rows returns `{data: [], error: null}`. Every money/trust/safety write
  needs `.select("id")` + `unwrapMutation()`.
- Confirm every payout path is idempotent and fails **closed**.
- Open items in `TODO.md` to verify or close: **F-MONEY-01** (retire
  `process-scheduled-payouts` — double-pay hazard, highest priority),
  **F-DISC-01** (street-address leak via `open_jobs_safe` /
  `get_ranked_open_jobs`), **F-SEC-08** (enable HaveIBeenPwned in Supabase
  Auth), **F-SEO-01** (regenerate sitemap).
- 🔴 hard bar: **exact lat/lng of open jobs must not reach anon.** Verify on
  every public surface (RPCs, views, REST).
- Report / Block / Dispute must be reachable and wired (App Store guideline
  1.2); in-app account deletion must work.

### Do NOT "fix" these (settled)

Privacy purpose strings · in-app account deletion · Sign in with Apple ·
destructive red · `prefers-reduced-motion` · safe-area insets · swipe-back ·
haptics · splash · pinch-zoom · input auto-zoom. **Never add
`maximum-scale=1`.** Social auth buttons stay stacked full-width. Business
signup stays off the consumer form. Auth screens are label-only (no
placeholders). The landing hero H1 **"Louisiana's Local Job Partner."** and its
subhead are locked — font, colour, and copy. Dead code is a **report**, not a
task.

---

## 9. Fix policy

**Fix everything you find.** Not "fix the highs and list the rest" — everything.

But fix in the right order, and keep judgment calls reversible:

1. **Enumerate the complete worklist first** (non-negotiable #5). No code edits
   until the worklist is done and severity-ranked (🔴 Blocker · 🟠 High ·
   🟡 Medium · 🟢 Low), each with `file:line` and a proposed fix.
2. **Then batch-fix**, highest severity first.
3. **Mechanical/objective fixes** (overflow, wrong token, missing `unwrap()`,
   flat primary button, back-button placement, missing top nav, broken link,
   silent no-op) — commit normally.
4. **Aesthetic or product-judgment changes** (restyling something that already
   works, rewording copy that isn't wrong, changing a layout you merely prefer)
   — still make them, but record each in a **Revertible Changes** table in the
   report: `commit SHA · file · what changed · why · how to revert`. The owner
   has a standing rule against unrequested visual changes and has been burned
   before; this table is what makes "fix everything" safe. One change per commit
   in this category so any single one can be reverted cleanly.

### Gates and committing

```bash
npm run typecheck        # tsc -b --noEmit — NOT `npx tsc --noEmit` (different program; cost 3 red commits)
npx vitest run           # REPO-WIDE, never scoped — scoped runs have broken main twice
```

Stagger gates if other sessions are running (don't run typecheck/vitest/eslint
concurrently with another lane). Commit **direct to `main`**, push, and
**confirm CI actually goes green** — the local gate does not cover Playwright,
and a prior change broke 6 E2E tests while typecheck/lint/vitest were all green.

Run the review agents (`code-reviewer`, `silent-failure-hunter`,
`security-auditor`) against the working diff before committing anything touching
money, auth, or the data model — there is no PR gate to catch it.

**Never update `COVERAGE_LEDGER.md` in the same commit as the change you are
claiming to have verified.** Separate commits, always.

---

## 10. Suggested parallel lanes

Dispatch these concurrently on non-conflicting scopes (non-negotiable #4). Route
lanes follow `docs/PLATFORM_CONVENTIONS.md` §7; shared `components/ui/*` belong
to nobody — announce before touching them.

| Lane | Scope |
|---|---|
| **A — money loop** | `/post-job`, `/my-posts`, `/my-jobs`, `/payment-success`, escrow, Stripe, payouts, disputes, B3 dialogs |
| **B — identity & account** | auth family, `/complete-profile`, account-state screens, all 17 profile tabs, B5 dialogs, biometric/App Lock |
| **C — public & operator** | `/`, `/browse`, `/jobs`, `/jobs/:id`, `/help`, `/legal`, `/support`, 404, sitemap, all 24 admin views, B9 dialogs |
| **D — messages & trust** | `/messages`, `/user/:userId`, report/block, content scanner, B4 dialogs |
| **E — edge functions** | all 63, OPTIONS + POST, status recorded |
| **F — visual sweep** | the automated capture + axe run (§11), feeding flagged cells back to A–D |

Migrations from parallel lanes carry the lane letter and a distinct minute
offset (A `:00`, B `:15`, C `:30`). Re-pull immediately before every commit.

---

## 11. Automation to run (a net, not a substitute)

```bash
# Full-surface capture — flags overflow, console errors, 5xx, blank pages, bad redirects
node scripts/audit-capture.mjs
#   ⚠️ FIRST: update DATE_DIR (line 23, hardcoded) and re-derive the stale route lists
#   Output: $HOME/lh-audit-shots/<DATE_DIR>/<viewport>/<sanitized>.png + report.json

# Screenshots + axe per screen, with a real gate
RUN_VISUAL_SWEEP=1 SWEEP_VARIANTS=all PLAYWRIGHT_WEB_SERVER=1 \
  npx playwright test --project=happy-path visual-audit-sweep
#   Output: /tmp/ui-review/<NNN>-<slug>-<variant>.png + a11y-report.json
#   Variants: phone-light 375x812 · phone-dark 375x812 · small-light 320x640 · desktop-light 1440x900

# Responsive sweep (6 screens x 4 widths)
npx playwright test e2e/visual-audit/responsive.spec.ts     # → /tmp/responsive-audit/

# Desktop fill regression guard (>=65% of a 1440 viewport)
npx playwright test e2e/visual-audit/desktop-fill.spec.ts

npm run test:e2e:happy
npm run deadcode && npm run deadcode:functions && npm run check:edge
```

**These prove rendering, not behaviour.** The Playwright suite runs Chromium
against a **mocked** Supabase (`e2e/happy-path/fixtures.ts`) — a green spec does
not prove the RPC exists, that RLS lets the row through, that the edge function
is deployed, or that money moved. Per the ledger, anything proven only this way
**can never exceed `PARTIAL`.**

Copy artifacts out of `/tmp` into a durable directory before finishing — `/tmp`
is shared and gets clobbered.

---

## 12. Evidence standard

A claim without a surviving artifact is not evidence.

**Counts:** a screenshot path · an HTTP status + the URL you issued · a SQL
result you actually ran · command output with the command shown · a commit SHA.

**Does not count:** "verified" · "confirmed working" · "looks correct" · "tests
pass" with no output · a migration file · a green CI badge with no named check ·
another agent's summary · reading the source.

Before filing, run:

```bash
npm run check:audit-evidence -- docs/audit/<YOUR-REPORT>.md
```

It reports claims found / with evidence / without, and **requires a section
whose heading literally starts with the word `UNVERIFIED`**. It is a mirror, not
a CI gate.

### Updating the ledger

`docs/audit/COVERAGE_LEDGER.md` columns:
`| Route | Component | Status | Last genuinely walked | Evidence |`

- Status: `WALKED` · `PARTIAL` · `NEVER WALKED`
- Timestamp: ISO date + method — `2026-08-30 · browser`
- Methods, spelled exactly: `browser` · `iOS sim` · `device` · `DB query` ·
  `curl` · `E2E` (mocked — never promotes past `PARTIAL`)
- **Downgrade freely.** If a row says `WALKED` and you cannot find the artifact
  it cites, set it back and say so. Removing a false pass is as valuable as
  adding a true one.
- Reconcile the ledger against the real route table first — it currently tracks
  `/subscription` and the two `/family` routes, **which no longer exist**, and
  its profile-tab list has 18 entries against a 17-value union.

---

## 13. Report shape

Write to `docs/audit/FULL-SURFACE-<YYYY-MM-DD>.md`.

**Lead with a plain-language completion overview** (SKILL.md §5) — above the
tables, graspable at a glance:

- **What was covered** — surfaces × personas × breakpoints × platforms.
- **Headline numbers** — findings by severity, how many fixed in-session.
- **What changed** — the fixes applied, file · one-line what.
- **Revertible changes** — the §9 table of judgment-call edits with SHAs.
- **Top things to look at next** — highest-leverage remaining items, ordered.
- **Release state** — typecheck / lint / build / vitest / Playwright / CI.
- **Suggestions & gaps** — pointer to the two required closing sections below.

Then, below it:

1. **Verified working** — only what you actually executed, each with its
   artifact.
2. **Defects** — ranked by user impact: steps · expectation · actual · evidence ·
   `file:line` · severity · fix · commit SHA.
3. **`UNVERIFIED — could not reach, and why`** — the heading must start with
   that word for the evidence checker. Per §0, this section should be **empty**
   at the end of this audit. Anything in it is a blocker you must go close, not
   a result you may file.
4. **The full coverage manifest** — every surface × dimension × platform, no
   blank cells.

Findings use stable IDs `F-<AREA>-NN` and severities 🔴 Blocker · 🟠 High ·
🟡 Medium · 🟢 Low.

### Required closing sections — do not omit either

**A. Suggestions — every one you have, no matter how big or small.**

The owner has explicitly asked for this. Do not self-censor on the grounds that
something is out of scope, too minor, too ambitious, or "not what was asked."
If you noticed it, write it down. Group as:

- **Big** — architectural or product-level: things worth a dedicated project
  (e.g. the Leaflet → Apple MapKit consolidation, splitting the 220 kB Activity
  chunk by tab, consolidating the two parallel toast systems down to one).
- **Medium** — worthwhile improvements that don't fit in this pass.
- **Small** — nits, polish, naming, a comment that lies, a slightly-off
  spacing token, a label you'd word differently.

For each: what you observed, why it matters, roughly what it would take, and
whether you already did it. Order within each group by leverage. A one-line
suggestion is fine — an omitted one is not.

**B. Gaps that need fixing.**

Distinct from defects (things that are broken) — these are things that are
*missing*: coverage the app doesn't have, states nobody built, tooling that
lies, docs that have drifted. Include at minimum an assessment of the ones this
prompt already names:

- No update-required / force-upgrade banner exists anywhere in the codebase.
- No "back online" confirmation after `OfflineBanner` clears.
- `scripts/test-signin-link.mjs` is referenced by a prompt but does not exist.
- `scripts/audit-capture.mjs` route lists and `DATE_DIR` are stale/hardcoded.
- `auditRoutes.ts` lists two dead profile tabs and omits `accessibility`.
- `sitemap.xml` lists a non-existent route; its test doesn't check resolution.
- `COVERAGE_LEDGER.md` tracks 134 units and omits the entire 78-overlay axis.
- `.text-display-eyebrow` is `display:none` while the standard still mandates it.
- SKILL.md §1 and §5 contradict each other on UNVERIFIED.
- SKILL.md and AGENTS.md contradict each other on gloss.
- `.claude/commands/audit.md` contradicts CLAUDE.md on branching and migrations.
- The commit trailer differs between CLAUDE.md and the walk prompt.
- `docs/qa/ACCESSIBILITY_AUDIT.md` has every box unchecked.
- Unit tests are **not** in CI (`npx vitest run` is local-only).
- Open `TODO.md` items: F-MONEY-01, F-DISC-01, F-SEC-08, F-SEO-01 and the
  deferred list.

Add every other gap you find. For each: what's missing, the risk of leaving it,
and the smallest fix that closes it.

---

## 14. Where to look hardest

These were all live in production while audits reported the app clean. None was
findable by reading code:

- The applicant vetting screen opened **a different person's** profile — wrong
  name, avatar, city, bio, and fabricated trust claims. No console error.
- The hired helper **could not message the poster** while en route. The backend
  allowed it; only the client blocked it, and a comment falsely claimed
  otherwise.
- Job-match notifications leaked the **full street address** to every matching
  helper — broadcast, and persisted in notification history.
- **Sort By did nothing** on the unfiltered Browse feed, but worked the moment
  any filter was applied.
- **Pull-to-refresh froze after one frame** — the handler ran, the indicator
  never moved.
- The splash screen **never rendered at all** (`launchShowDuration: 0` — a legal
  value; found by reading the plugin's own iOS source in `node_modules/`).
- The Sentry sourcemap upload **had never once run** — it gates on secrets that
  don't exist, so it skips and reports `success`. 400/400 green. Every
  production stack trace unreadable.
- `mapkit-token` returned **503 on every call** — the map was broken for every
  user, degrading silently.
- The CSP blocked `nominatim.openstreetmap.org`, the app's only geocoder, so
  every posted job got null coordinates and never appeared on the map. Both call
  sites swallow it with `catch { return null }`.
- The public **"Verified Helpr" ribbon** was driven by `!!id_document_url` — it
  meant a file had been uploaded, nothing more.
- A migration deployed **green** while making the repo un-rebuildable.

The pattern: **the code looks right, which IS the failure mode.** Operate the
app.
