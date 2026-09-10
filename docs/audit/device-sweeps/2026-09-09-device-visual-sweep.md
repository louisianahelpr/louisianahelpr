# Device visual sweep — 2026-09-09

Repo `origin/main` @ `ef8665625`, isolated worktree `~/.lh-visual-ws/tree`.
Surfaces: iOS Simulator (iPhone 17 Pro, iOS 26.5, WKWebView) + Playwright
WebKit at 402x874. Screenshots under `~/.lh-visual-baseline/2026-09-09/`.
No code changed; nothing committed.

## 1. Verified working

| Check | Artifact |
|---|---|
| Branded splash actually renders on cold launch | `native/cold-01.png` — wrought-iron H on `#F1F2F4`; built bundle `capacitor.config.json` has `launchShowDuration: 500` (not the historical `0`) |
| Browse feed is complete — no silently dropped jobs | prod `open_jobs_browse` = 4 rows; app renders exactly 4 (`native/guest-landing.png`, `operate/filter.json`) |
| The one open job excluded from Browse is excluded correctly | prod query returned `credential_tier=1, tier_ok=false, early_ok=true` for job `69d296e3`; `pg_get_viewdef('open_jobs_browse')` gates that column to `my_credential_tier() >= credential_tier`. Not a defect |
| Category filter actually filters | `operate/filter.json`: no filter 4, Assembly 1, Cleaning 2, Pet Care 1, Painting 0 — all expected |
| Filter state persists across reload | `browse?cat=assembly` → 1 job before and after reload |
| Sort reorders | Highest pay → `$158, $114, $83, $52`, descending confirmed |
| Empty state is designed, with a recovery action | `operate/filter-empty.png` — "No jobs match your filters." + Clear Filters; single panel, **no nested card frame** |
| Pull-to-refresh tracks the finger and fires | `operate/ptr-final.json` — indicator top 169→183→187→188 across the drag (rubber-band damping visible), label "Release to refresh", new `open_jobs_browse` fetch, indicator cleared after settle. `operate/ptr-c-12.png` mid-drag |
| MapKit map renders — historical 503 is gone | `functions/v1/mapkit-token` → **200**; `mk-map-view` element 358x786; real `cdn.apple-mapkit.com` tiles 200 |
| Selected filter chips keep a real gradient | every `aria-pressed=true` chip has `radial-gradient(125% 125% at 32% 22%, rgb(100,110,73)…)`; every unpressed one is flat white. No `btn-grad-primary` loss |
| Reduce-Transparency rule survives minification in the **bundle** | `dist/assets/index-8-a40FbE.css` — the `@supports` block carries BOTH `-webkit-backdrop-filter:none` and `backdrop-filter:none`; per-theme opaque overrides present for `.liquid-glass`, `.glass-modal`, `.glass-nav` |
| Zero horizontal overflow, 14 routes at 402px | `results.json` — `scrollWidth == clientWidth == 402` on every route |
| Form validation names the missing field (no dead disabled button) | login empty submit → "Add your email address" / "Add your password"; support → "Please tell us your name" |
| Guest gate explains itself and preserves intent | `/my-jobs` → `/login?redirect=%2Fmy-jobs` + "That page needs an account. Log in and we'll take you straight back to it." |
| Landing CTAs, header nav, job-card tap, legal tabs, 404 | all changed route or content; `operate/operate.json` |
| No retired green brand asset anywhere | `app-icon-1024.png`, `apple-touch-icon.png`, `helpr-splash-icon.png`, `favicon-32.png` — 0% strongly-green pixels |
| No JS runtime errors on any guest route | only 404s for `_vercel/*` analytics scripts, absent from a local preview server by construction |
| Native and phone-web render the same | `native/nat-login.png` / `nat-legal.png` match the WebKit captures |

## 2. Defects

### D-1 — A build from a clean `main` checkout is bricked at launch by the force-update gate (MEDIUM, dev-loop only)

`origin/main` commits build **5906**; prod `platform_settings.min_supported_build`
is **7102**. So any iOS build produced outside fastlane — `npm run build:ios` +
xcodebuild, which is what every local dev pass and every agent device sweep
does — launches straight into the hard "Update Helpr to continue" wall and the
app is unusable.

* **Evidence:** `native/cold-30.png` — full-screen gate reading
  *"Installed build 5906 · requires 7102"*. `npm run build:ios` logged
  `Louisiana Helpr / com.Helpr / 1.0.4 (5906)`. Prod query:
  `min_supported_build = 7102, latest_build = 7102`.
* **Not user-facing.** `fastlane/Fastfile` calls `latest_testflight_build_number`
  then `increment_build_number`, so TestFlight and App Store builds get a fresh
  number and are unaffected (`fastlane/Fastfile:311,378`). Store users are fine.
* **Why it matters anyway:** it silently blocks this scheduled sweep and every
  local device check. I only got past it by patching `CFBundleVersion` to 7110
  in the installed bundle. A sweep that did not notice would have reported the
  app as "unreachable" or, worse, healthy.
* **Not fixed here, deliberately.** Another session has uncommitted
  `capacitor.config.ts` 7109 / `ios_app_metadata.yml` 7110 in the shared tree,
  which lands this fix. Editing release metadata a live lane is mid-run on is
  exactly what CLAUDE.md forbids.

### D-2 — Every browseable job is seed data (context, not a bug)

All 5 `status='open' AND payment_status='escrow'` rows are `is_seed=true`, and
`seed_jobs_hidden_publicly()` currently returns **false**. Flipping the launch
switch empties Browse to zero jobs, not "fewer". The empty state is designed
(D-1 table above), so it degrades gracefully — but the flip is all-or-nothing
against present inventory.

## 3. UNVERIFIED — could not reach, and why

* **Every authenticated surface** — Home, My Posts, My Jobs, Messages, Profile
  tabs, Post a Job, Activity, Settings, Earnings, admin. The sanctioned
  magic-link minter (`scripts/test-signin-link.mjs`, allowlisted to seeded test
  accounts, types no password) was **blocked by the session's permission
  classifier**. Creating an account by typing a password is prohibited to me
  outright. So no session was obtained, and none of the authed Part 1 or Part 2
  checks ran.
* **Pull-to-refresh on Home / My Posts / My Jobs / Messages** — authed only.
  Verified on the guest dashboard (`/browse` renders `DashboardGuest`, `src/App.tsx:325`), which uses the same `usePullToRefresh` hook.
* **Bottom nav (five destinations + "+")** — guest surface has no bottom nav.
* **Job-card row actions** (Share, Boost, Edit, Cancel, Applicants, Message)
  and the expand/collapse side-effect check — authed only.
* **Messages thread + composer** — authed only.
* **Post a Job full form walk** — redirects to `/login` for a guest.
* **Native tap/swipe operation** — the iOS Simulator MCP refuses to run in a
  scheduled session, and `idb` is not installed, so the device gave screenshots
  only. All interaction evidence is Playwright WebKit at 402x874 (touch drags
  via Chromium CDP, since Playwright's WebKit cannot synthesize touch
  sequences). CLAUDE.md treats phone-web and native as one surface.
* **Diff against a prior baseline** — `~/.lh-visual-baseline/` did not exist;
  this run establishes it.
* **Dark mode and Dynamic Type at max** — not exercised this run; budget.
* **The device UDID pinned in the task file** (`10492853-…`) no longer exists;
  no simulators existed at all. Created `LH-Sweep-17Pro`
  (`99293475-2E61-4D9C-80AF-03C69E1A046E`, iOS 26.5).
* **The seed-uuid prefix in the task file** (`5eed0827…`) matches zero rows;
  seed data is now flagged by `jobs.is_seed`.
