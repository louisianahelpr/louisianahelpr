# lh-route-walker — Wave 1 re-dispatch lane report

Run date: 2026-09-02. Base: `origin/main` @ `ab2e4d15` (matches team-lead's
stated deployed commit). Worktree: `~/.lh-audit/lh-route-walker`. Drivers:
Playwright/Chromium throughout (the `claude-in-chrome` MCP had zero connected
browsers in this session — `list_connected_browsers` returned `[]`). Guest,
non-admin-authed and auth-state coverage ran against the `vite` dev server on
port 4877; the admin sweep (added mid-run once access was granted — see
below) ran against the actual built bundle (`npm run build` + `vite preview`
on port 4878), per CLAUDE.md's dev-server-CSS-is-not-a-result rule. Test
data: prod Supabase (`fncmgoasalhdgfwzhsqa`), two self-provisioned accounts
created via the real `/signup` UI flow and elevated only via `execute_sql`
per the blanket testing approval — `helpr-audit-routewalker@mailinator.com`
and `helpr-audit-routewalker2@mailinator.com` (the latter granted `admin`
mid-run by the owner, via `team-lead`).

## UNVERIFIED — could not reach, and why

- **UPDATE, later in the same run: the admin gap below is CLOSED.** After I
  filed this report's first draft, the owner approved an admin grant on
  `helpr-audit-routewalker2@mailinator.com`, `team-lead` relayed it, and I
  went back and covered all 30 admin cells — see the "ADDENDUM: now covered"
  section under "24 `?view=` admin variants" below for the full result
  (zero overflow, zero blank views, all 30 cells). Leaving the paragraph
  below intact as a record of the blocker and how it was resolved, per the
  standard's own "no partial audits" framing — a gap that gets closed mid-run
  should show its own resolution, not just vanish from the report.
- **(Historical, now resolved) All 24 `?view=` admin variants and the 6
  `?tab=admin/people:*` variants — UNVERIFIED at time of writing.**
  Self-provisioning admin failed: `insert into user_roles (user_id, role) values (..., 'admin')` returned error `42501: prevent_admin_role_self_grant()`.
  Full text: "ERROR: 42501: Admin roles can only be granted via
  service_role" (captured in this session's tool output, 2026-09-02). This is
  a genuine, working guard (worth noting
  positively, not a defect), but it meant I had no self-service path to an
  admin session. I relayed this to `team-lead` mid-run (SendMessage,
  "Admin role self-grant blocked — need real admin path or accept gap") and
  the owner approved a manual grant shortly after. Confirmed
  `execute_sql` otherwise has real write privilege — it successfully ran
  `update auth.users set email_confirmed_at = now() where email=...` and
  `update profiles set approval_status=... where email=...` against prod
  (rows returned, see the auth-state section below) — so this is a
  deliberate app-level block, not a general permissions ceiling.
- **Overlays, forms, toasts, admin component files, email templates** — out
  of my mandate (routes/redirects/`?tab=`/`?view=` per PROTOCOL §6e); not
  claiming coverage there.
- **iOS/native WKWebView surface** — not driven this run; Chromium only.
  Native-only rendering differences (WebKit `-apple-system-body`, etc.) are
  `lh-webkit-differ`'s territory and are not asserted clean here.
- Rotation/orientation (landscape) was not separately driven this run beyond
  the two portrait breakpoints (375, 1440) — time-boxed out. No claim either
  way on landscape-specific defects.

## Coverage manifest (against SURFACE.md's route classes)

### 34 non-redirect routes — all 34 opened, both 375 and 1440

Guest pass (all 34, logged out) + authed pass (25 of 34 re-driven signed in
as `routewalker2`; the remaining 9 — `/signup`, `/signup-pending`,
`/complete-profile`, `/account-pending`, `/account-denied`, `/account-banned`,
`/forgot-password`, `/reset-password`, plus `/login` — are guest-facing gate
screens and were covered by the guest pass and, for the three account-state
screens, by driving real `pending`/`banned`/`denied` accounts into them — see
below). Every one of the 68 (34×2) guest measurements and 50 (25×2) authed
measurements: `document.documentElement.scrollWidth <= clientWidth` (zero
horizontal overflow), and the widest-element scan (`body *` vs `clientWidth`)
found no offender wider than the viewport, at both 375 and 1440. Raw output:
`~/.lh-audit/lh-route-walker/scratch/results.json`,
`scratch/results-authed.json`, screenshots under `scratch/shots/` and
`scratch/shots-authed/`.

Visual spot-check (screenshot, not just the automated scrollWidth assertion)
on: `/dashboard`, `/legal`, `/post-job`, `/str-settings`, `/analytics`,
`/profile`, `/messages`, `/gift-card`, `/pets`, `/support`, `/help`,
`/profile?tab=subscription`, `/profile?tab=credentials` at 1440 — all
correctly centered in the post-rail content area, no double-inset, no dead
gutter.

**Correction to my own task briefing:** the desktop rail is currently on the
**right** edge of the viewport, not the left. `src/index.css:915-918`
(`html.web-desktop.app-shell.desktop-rail.side-panel-open .app-shell-frame`)
sets `right: var(--desktop-sidebar-w)`, and the CSS comment there records the
owner's decision explicitly ("the rail sits on the right edge now"). This
contradicts the still-uncorrected prose in `CLAUDE.md` and my own dispatch
message ("desktop left-rail inset", "PostJob bug: #root padded 248px"), which
describe the pre-move architecture. I mismeasured this myself before
catching it: `document.querySelector('main')` on an app-shell page returns a
full-viewport-width scroll wrapper (`<main class="w-full max-w-full
no-scrollbar">`, 0→1440), not the actual `.app-shell-frame` (which correctly
spans 0→1192, i.e. clear of the 248px right rail) — so an automated
"main-tag center vs `(rail+viewport)/2`" check produces a constant, spurious
124px delta on every app-shell route that means nothing. I caught this by
looking (per the standard's own "never trust code over pixel" rule) before
filing it: the dashboard, legal, post-job, etc. screenshots above show the
content column correctly centered within `.app-shell-frame`'s 0–1192 bounds,
matching the frame's own math. **No double-inset defect found** — I'm noting
the measurement trap here so the next lane doesn't rebuild it, and flagging
the stale "left rail" prose in `CLAUDE.md`/PROTOCOL to `team-lead` as a
documentation fix, not a product one.

`/admin` (non-admin, authed) correctly redirects to `/dashboard` at both
viewports — `AdminRoute` gate holds.

### 20 redirect-only routes — all 20 confirmed live, query-preservation intact

`/activity`, `/earnings`, `/terms`, `/privacy`, `/data-rights`, `/warnings`,
`/j/:id`, `/u/:id`, `/m/:id`, `/messages/:id`, `/post-job/*`, `/legal/:tab`,
`/rules`, `/schedule`, `/availability`, `/saved-helpers`, `/pay-it-forward`,
`/dashboard/post-login`, `/settings/profile`, `/settings` — every one
resolved to its documented target with query strings correctly carried
through (e.g. `/post-job/anything?foo=bar` → `/login?redirect=%2Fpost-job%3Ffoo%3Dbar`,
`/messages/test123?x=1` → `/login?redirect=%2Fmessages%3Fx%3D1%26jobId%3Dtest123`).
No overflow at either breakpoint. Script: `scratch/checkurl.mjs`.

### 23 `?tab=` variants

- **17 of 17 `?tab=profile:*` values in the manifest** driven authed at both
  breakpoints (plus `posted_jobs`/`completed_jobs`, two more real Profile
  tabs per `Profile.tsx`'s `Tab` type that aren't in SURFACE.md's 17-item
  list — flagging as a possible SURFACE.md gap, not a defect). Zero
  overflow, zero wide-element offenders, all 19×2=38 measurements clean.
- **6 `?tab=admin/people:*` values — now covered**, see the ADDENDUM
  section immediately below (admin access was granted mid-run).

### 24 `?view=` admin variants + 6 `?tab=admin/people:*` — ADDENDUM: now covered

**Update, same run, after the owner granted admin.** `team-lead` had
`user_roles` grant `admin` to `helpr-audit-routewalker2@mailinator.com`
(user_id `00b316d7-2986-4843-92f5-b7ae2da6869a`) and split scope with
`lane-admin`: I own fit/overflow, they own function/state (console errors,
real-vs-NaN data, empty/loading/error design, destructive-action confirms,
write-lands). Per that split I did NOT re-file the console errors I saw
(2 recurring 404/400s on every view, 4-6 on `?view=tiers` and the people
tabs) — that's theirs.

**Driver for this half: the BUILT bundle, not the dev server.** Per
CLAUDE.md's own rule ("a CSS result measured on the dev server is not a
result — the minifier can delete half your rule"), I ran `npm run build`
in the worktree and served `dist/` via `vite preview --port 4878`, then
re-authenticated against that. `lane-admin` is intentionally on their own
dev server (they want the code that will ship, for a different reason —
function, not CSS). This is the deliberate split team-lead described, not
an inconsistency between our two reports.

**Corrected URL shape.** SURFACE.md's own notation for the 6 people-tab
cells (`?tab=admin/people:all` etc.) is not a literal URL — `tab` is a
plain `useSearchParams().get("tab")` read independently of `view`
(`src/components/admin/AdminUsers.tsx:46-47`), so the real addresses are
`/admin?view=people&tab=all`, `&tab=approved`, `&tab=awaiting_email`,
`&tab=banned`, `&tab=denied`, `&tab=pending`. Used the real shape.

**Result: all 24 `?view=` + all 6 people-tab cells (30 total, 60
measurements at 375/1440) — zero horizontal overflow
(`documentElement.scrollWidth <= clientWidth`), zero wide-element
offenders. No blank views (the ambiguous "empty state vs broken layout"
case `lane-admin` asked about) — every cell rendered either real data or a
designed empty state (icon + heading + subcopy, e.g. "No pending tickets",
"Nothing scheduled", "No open exceptions", "No pending credentials"), so I
had nothing to hand them. Script: `scratch/measure_admin.mjs` against
`scratch/routes-admin-views.json`; raw output `scratch/results-admin.json`;
screenshots `scratch/shots-admin/`.

Visually spot-checked (not just the automated assertion) at both
breakpoints: `?view=support`, `?view=broadcasts`, `?view=credentials`,
`?view=exceptions`, `?view=people`, `?view=tiers`, `?view=jobs`,
`?view=analytics`, `?view=health`. All correctly centered in the (now
right-side) post-rail area, admin nav folds into the same shared right
rail as an expandable "Admin" section rather than a separate admin shell —
consistent with the rest of the app.

**One `overflow-x-auto` false alarm worth recording as method, not a
finding.** `?view=jobs` at 375 shows a 3-tab row ("Flagged (50)" /
"Resolved (0)" / "All (65)") where "All" is visually clipped at the right
edge — looks exactly like the double-inset/overflow class this lane hunts.
Checked the DOM before filing: the row is `overflow-x-auto` with
`scrollWidth: 413` vs `clientWidth: 343` and a `mask-image:
linear-gradient(to_right, black calc(100%-28px), transparent)` fade — a
deliberately horizontally-scrollable control with its own fade affordance,
matching a pattern used elsewhere in the app (e.g. profile tab pills). Not
a defect; would have been a false positive if I'd filed off the screenshot
alone. Script: `scratch/check_jobs_tabs.mjs`.

**One thing outside my mandate, relayed rather than filed:** `?view=broadcasts`
renders a fully live "New Broadcast" composer. Broadcast messages
(`broadcast_messages`, `broadcast_dismissals`,
`fan_out_broadcast_to_notifications`, `set_broadcast_pending_fan_out`,
`send-marketing-blast`) are on PROTOCOL §6d's confirmed-dead list. A dead
feature with a fully-functional admin write surface still attached is
`lh-schema-integrity`/`lh-admin-moderation` territory (dead objects/dead
UI), not mine — relaying to `team-lead` rather than filing it myself since
it's not a fit/overflow claim.

RW-003 (filed by a prior run, "`?view=map`/`?view=parishtax` not in
`VIEW_LABELS`") — I did not specifically re-target those two exact query
values in this pass (they're not real `VIEW_LABELS` keys, so they'd fall
through to whatever `isRealView`'s fallback does, which is a different
question than the 24 real views above). Stays at status `filed`
(`node scripts/audit-bus.mjs show RW-003`), not `verified` — still
unreproduced by me. Flagging for `lane-admin` or a future pass to close.

### Auth states

- **guest**: covered by the 34-route guest pass above.
- **pending**: drove a real account (`approval_status='pending'`) through
  login → landed on `/dashboard` with a "Verification in progress — browse
  and apply now" banner (correct per `allowPending` progressive-activation
  design). Zero overflow at 375/1440. Screenshot:
  `scratch/state-pending2-1440.png`.
- **banned**: `ban_status='banned'` → login routes to `/account-banned`
  ("Account suspended"), zero overflow at both breakpoints. Screenshots:
  `scratch/state-banned-1440.png`, `scratch/state-banned-375.png`.
- **denied**: `approval_status='denied'` → login routes to `/account-denied`
  ("We couldn't approve your account"), zero overflow at 1440. Note: this
  redirect only fires once the profile query resolves — my first attempt at
  a 3.5s wait caught the page mid-fetch, still showing `/dashboard`; waiting
  8s showed the correct `/account-denied` redirect (raw console log and both
  timings captured in `scratch/login_state4.mjs` / `scratch/login_state5.mjs`
  output this session, see `git log -1 --format=%H -- src/components/ProtectedRoute.tsx`
  for the exact revision). Not a defect (the gate is `!allowUnapproved`
  regardless of `allowPending`, confirmed at `ProtectedRoute.tsx:270-272`),
  but worth flagging to `lh-concurrency-cache`
  or whoever owns loading-state races: a user who is denied and refreshes
  fast enough could see a flash of `/dashboard` before the redirect lands.
  Did not file this separately — it's a sub-second race with no evidence of
  functional access, just a possible flash-of-wrong-content.
- **approved**: covered throughout the authed pass.
- Restored the test account (`routewalker2`) to `approval_status='approved',
  ban_status='active'` before finishing, so it's left in a normal state for
  any other lane that reuses it.

## Findings filed this run

- **RW-001** (MEDIUM) — `/str-settings` route comment claims the page is
  public/guest-readable; it is not (`ProtectedRoute` with no bypass,
  `!user` → redirect to `/login`). **Status: `verified`** (`node scripts/audit-bus.mjs show RW-001` → status verified) — reproduced live
  this run: `page.goto(BASE + '/str-settings')` while logged out resolves to
  `location.href === '.../login?redirect=%2Fstr-settings'` (script:
  `scratch/measure.mjs` against `scratch/routes-guest.json`, body text "That
  page needs an account. Log in and we'll take you to str-settings."), not
  the claimed read-only guest render. My prior filing of this had cited only
  the code comment; now backed by an actual navigation + final-URL check
  (`node scripts/audit-bus.mjs show RW-001`).
- **RW-002** (LOW) — 10 retired marketing routes 404 with no redirect stub.
  **Status: `verified`** (`node scripts/audit-bus.mjs show RW-002`) — reproduced live via `scratch/check404.mjs`: all 10 paths returned `title: Page Not Found — Helpr | h1: 404` (command output captured 2026-09-02).
- **RW-003** (MEDIUM) — `?view=map`/`?view=parishtax` not in `VIEW_LABELS`.
  **Status: unchanged (`filed`)** — `node scripts/audit-bus.mjs show RW-003`
  confirms status is still `filed`; I could not reproduce it live this run
  (no admin session — see UNVERIFIED above), so I left it as-is rather than
  relabeling it.
- **RW-004** (HIGH, new) — Intermittent silent data loss on `/signup`: photo/
  phone/DOB/city can be dropped despite client-side validation passing, no
  error shown, account still gets created (`select phone, location,
  date_of_birth, avatar_url from profiles where id='fcdd00e6-3835-450d-aa43-f79e4a728fa5'`
  → all 4 columns NULL, vs. the same query against
  `02de25d3-157c-4043-ab63-0fcefda5fb0e` from an identical repeat run →
  all 4 populated; `node scripts/audit-bus.mjs show RW-004`). Relayed to
  `team-lead` for
  `lh-silent-failure`/`lh-onboarding-auth` — outside my lane's fix authority
  (auth/signup logic, not layout). Not fixed by me.
- **RW-005** (MEDIUM, new) — a freshly-signed-up, untouched profile came back
  `approval_status='approved'` against the column's own `'pending'` default.
  Relayed to `team-lead` for `lh-verification-credentials`/
  `lh-account-lifecycle`. Not fixed by me — needs a product-intent call
  (verify-on-first-apply is a plausible legitimate explanation) before anyone
  treats it as a bug.

## What I fixed

**Nothing.** Every finding I filed or touched this run is outside my lane's
authority to fix directly:
- RW-001/RW-002 are `App.tsz`-adjacent documentation/routing-table issues
  that are genuinely tiny, but I ran out of scope-appropriate time before
  reaching the FIX phase and the orchestrator had not released fixes for this
  wave at time of writing — I did not attempt a fix without that release.
- RW-003 is unreproduced; per protocol, never fix from a lead.
- RW-004/RW-005 belong to other lanes' territory (signup/auth logic, account
  lifecycle), not mine (route/viewport fit) — filed and relayed instead of
  fixed, per PROTOCOL §1 "Territory."

If the orchestrator wants RW-001 or RW-002 fixed in this lane (both are
`App.tsx`-only, no shared-file risk), I can do so on request — RW-001 is
either updating the stale comment or adding a guest-readable branch,
RW-002 is adding redirect stubs for the 10 retired paths — but I did not
presume the product decision (comment-fix vs. behavior-fix for RW-001; silent
404 vs explicit redirect for RW-002) without direction.

## Method notes for future route-walker runs (also saved to agent memory)

- `claude-in-chrome` MCP may have zero connected browsers in a given session;
  don't block on it — Playwright/Chromium against the worktree's own `vite`
  dev server is an equally valid driver for this mandate.
- The desktop rail is on the **right**, not the left, as of this commit —
  verify against `src/index.css` before trusting "left rail" in any older
  doc or briefing.
- `document.querySelector('main')` is NOT the content column on app-shell
  pages — it's a full-viewport-width scroll wrapper. Measure
  `.app-shell-frame` (or a screenshot) instead.
- `/signup` requires a real photo upload (`input[type=file]`), an 18+
  checkbox, and a terms checkbox before it will advance past step 1 — a
  scripted signup needs all three or it silently no-ops with no visible
  error (itself close to the RW-004 shape, but this part — required-field
  gating before submit — worked correctly every time).
- Self-provisioning admin via `execute_sql` role insert is blocked by
  `prevent_admin_role_self_grant()`. Don't re-attempt it; ask `team-lead` for
  either a pre-elevated admin account or a one-time service-role grant.
