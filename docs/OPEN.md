# Open list

**This is the ONLY open-work list** (owner, 2026-09-12). Handoff memories, the
audit-bus ledger and agent reports are evidence, not backlogs: anything still
open from them gets a line here, with the check that guards it once one exists.

Written 2026-09-11. The point of this file is that the backlog stops living in
chat scrollback. Anything not in here is either done or forgotten, and both of
those are answerable by reading this instead of guessing.

## CLOSED — the review log lived in the directory Playwright wipes (fixed 2026-09-20)

`e2e/reviewLog.ts` writes `REVIEW_LOG = <cwd>/test-results/review-log.jsonl`,
and `test-results` is Playwright's default `outputDir`, which it CLEARS at the
start of every run. So every `recordReview` made after one run is destroyed by
the next one.

- Measured 2026-09-20: five screenshots recorded across a session
  (/admin?view=stalled, /post-job logistics, /my-jobs, saved_helpers,
  earnings, the gift-card 10.555 failure), then one more `npx playwright test`
  and `npm run review:report` said **"the review log is EMPTY — nothing was
  recorded as looked at"**. The evidence that someone looked is exactly what
  is easiest to lose.
- It also means the report can never accumulate across a session: it only ever
  reflects reviews made since the last run started.
- **FIXED**: the log is `.review-log.jsonl` beside `test-results` now
  (gitignored), so it accumulates across runs.
  `scripts/review-report.mjs` reads the new location AND the old one, so a log
  written before the move is not silently dropped.

## CLOSED — vacuity's mutation phase could not run in an agent worktree (fixed 2026-09-20)

Found while registering two new guards. `scripts/vacuity/run.mjs` spawns
`node_modules/vitest/vitest.mjs`, but an agent worktree under
`.claude/worktrees/` has an (almost) empty `node_modules` and resolves vitest
up to the main checkout. So every baseline run returns non-zero and vacuity
reports **`guard is RED before any mutation` / `inconclusive`** for every
registration in that tree — including ones that are green on their own.

- Measured: `src/test/e2eViewportForkedControls.test.ts`,
  `src/test/readNamedRpcsAreNotVolatile.test.ts` and
  `src/test/giftAmountIsWholeCents.test.ts` all pass under `npx vitest run`
  and all three came back inconclusive. `npm run vacuity` still exits 0, so
  nothing goes red — the proof simply never runs.
- Same cause reds `src/test/vacuityGate.test.ts` > "reports SURVIVED when a
  planted guard does not notice its target breaking"
  (`expected 'inconclusive' to be 'SURVIVED'`) in any worktree. That is a
  REQUIRED check failing for an environment reason, not a code one.
- Consequence: "every check must be shown able to fail" is enforced on the
  main checkout and in CI, but silently skipped in the trees where most agent
  work happens. Each of the three above was proven red BY HAND instead.
- **FIXED** in `scripts/vacuity/run.mjs`: resolve `vitest/package.json`
  through `createRequire` and join `vitest.mjs` beside it, falling back to the
  old path so a failure still names what it looked for. (`vitest/vitest.mjs`
  cannot be resolved directly — it is not one of vitest's `exports`
  subpaths, which is why the obvious one-liner throws
  ERR_PACKAGE_PATH_NOT_EXPORTED.)
- After: `npm run vacuity` in this worktree reports **3/4 killed** where it
  reported 0/4 and four `inconclusive`, and `src/test/vacuityGate.test.ts`
  passes 5/5 here.

## HEADS-UP — the explore now reaches four screens it never reached (2026-09-20)

`e2e/prod-audit/harness.ts`'s write firewall used to refuse read RPCs, so
/my-jobs, /profile?tab=saved_helpers, /profile?tab=earnings and
/admin?view=payouts sat in their own error states with no controls to press.
They are explored for real now, so their `credits/*.json` files grow. If
`messy-input.spec.ts`'s coverage test (":624") starts reporting **"listed as a
gap but actually exercised"**, that is why, and the answer is to remove the
stale `GAPS` entry, not to re-narrow the firewall.

## OPEN — `messages-thread.spec.ts` (c) flakes in the FULL happy-path run only (2026-09-20)

Found while fixing the two red happy-path smokes (a305479e7, fa5759ec9); NOT
caused by them and not in their diff.

- `e2e/happy-path/messages-thread.spec.ts:97` — "(c) hardware/gesture back from
  a thread lands on the LIST with its nav" failed once in a full
  `npm run test:e2e:happy` run: `getByRole("button", { name: "Back to
  conversations" })` expected hidden, `14 × locator resolved to … "visible"`
  over the 5s timeout. It is the `page.goBack()` leg, so the suspect is the
  history pop racing the route commit under whole-suite load.
- **Passes 14/14 in isolation** (`npx playwright test --project=happy-path
  e2e/happy-path/messages-thread.spec.ts`), immediately after the failing full
  run, same build. So it is a flake, not a regression — but it is a flake on a
  REQUIRED check, which means it can red main at random.
- Not yet reproduced a second time; frequency unknown (1 of 1 full runs). Next
  step is to run the full suite a few times to get a rate, then either await
  the nav-hidden flag rather than the button, or make the back leg wait on the
  list's own landmark instead of the thread control disappearing.
- The other lane's `ConversationList.tsx` work landed in the same window
  (b43ac5d89, 0c5a89383) and is untested against this; worth checking whether
  the rate changes now that it is in.

## OPEN — the four long-red nightlies, diagnosed 2026-09-20 (issues #1582 #1595 #1597 #1618)

All four read at the failing run, not the title. **None is environmental**, so none
is `nightly-red-ack`. Full evidence is in each issue's 2026-09-20 comment.

| # | workflow | cause | state |
|---|---|---|---|
| #1618 | prod-audit | `PLAYWRIGHT_ADMIN_EMAIL` → `admin@louisianahelpr.com`, whose `avatar_url` is NULL, so the Big-7 profile gate bounces it to `/complete-profile` before `AdminRoute` ever runs. 26 tests never touched the admin surface. | **owner decision** (below) |
| #1582 | press-every-control | `Profile request timed out` (`PROFILE_QUERY_TIMEOUT_MS = 6000`) paints an **error boundary on load** on `/user/:id` and `/jobs/:id` for all three roles. Survives the 75b3753a6 auto-heal. Prod query itself is 0.865 ms. | **false-red half FIXED `aa81799a2`** — the harness no longer classifies before the heal can fire. Needs one dispatch to confirm; the underlying stall is still unmeasured (timings now recorded). |
| #1597 | a11y-webkit-prod | (a) diff CLI `--out` — FIXED 10461897f, never re-run; (b) WebKit: 11 contrast failures, all one `·` at `hsl(var(--burnt-sienna) / 0.5)` = 2.33:1; (c) Chromium: `h-7` renders 29.6 px on the JobTracking step dot. | (a) done, (b) **blocked**, (c) OPEN |
| #1595 | e2e-journeys | 2 browse failures were a TRUE report of an empty `open_jobs_browse`; 8 rows seeded 2026-09-19 19:25 have since fixed it. 2 real defects remain. | 2 OPEN |

### Owner decision needed — #1618
Verified by re-run [35535464894](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35535464894):
`bounced off /admin (view=home) to /complete-profile — the profile gate, not the admin gate`.

Three accounts hold `role='admin'`. `lexilombas05@gmail.com` and
`helpr-seed-admin-0912@louisianahelpr.com` both pass the Big-7 gate — **the owner's own
admin access is fine.** Only `admin@louisianahelpr.com` fails it (`avatar_url` NULL,
`is_legacy_user = false`, `/admin` not in `PROFILE_GATE_ALLOWED`), and this run failed
the Big-7 gate, so that is what `PLAYWRIGHT_ADMIN_EMAIL` points at.

Either repoint `PLAYWRIGHT_ADMIN_EMAIL` at `helpr-seed-admin-0912@louisianahelpr.com`
(what `prod-audit.yml`'s own header says this workflow uses, and what
`scripts/check-test-account-strikes.mjs` names as the shared admin), or set an
`avatar_url` on `admin@louisianahelpr.com`. Either clears all 26. Not done here: one is
live profile data, the other a shared credential.

### Blocked, deliberately not touched — #1597(b)
The four `·` separators are `src/components/profile/earningsTab/EarningHistory.tsx:180`,
`ReviewsTab.tsx:321`, `earningsTab/RecentTransfers.tsx:48`,
`savedHelpersTab/SavedHelperCard.tsx:141`. All under `src/components/profile/**`, which
another lane is editing right now. `aria-hidden` does not exempt them — the gate
measures composited contrast.

### Still open from #1595 / #1582
- ~~"Daily match digest" switch does not survive a reload (`03-account.spec.ts:251`).~~ Stale spec, fixed `5517880d6` — it reloaded before the upsert reached PostgREST on the `slow` rotation row.
- ~~The post flow's `Hour` listbox never offers `5` (`02-marketplace.spec.ts:202`).~~ Stale spec, fixed `5517880d6` (+ `9d2c5d4f4` for the calendar cell) — the desktop fork renders a native `<input type=time>`, not the wheels.
- **`01-browse.spec.ts:52` / `:92` — `guest Browse listed no jobs` (2026-09-21).** Prod genuinely had ZERO browsable jobs on 2026-09-18: `open_jobs_browse` admits a row only at `payment_status IN ('escrow','payout_pending','released')` and prod held 115 `open` rows all at `abandoned`. App and view correct. **The real gap — nothing alarmed:** `scripts/uptime-check.mjs` probed that exact path every 10 min and passed on the status code alone, so `[]` read as up. Fixed `0a5e77de5` (reads the body; zero rows is DOWN), proven red against prod. **Still open:** `01-browse` owns no fixture, so it reds again the next time the funded floor drains — the honest fix is a funded job the journey creates and unwinds itself. Live now: 8 browsable rows. NOT the same defect as `browse-feed-completeness.spec.ts:56` (that one is a mocked-Supabase spec whose API response is a hard-coded 9-job constant — its rows are returned and the *client* drops them; #1595's real API returned nothing).
- **#1582's false red is now impossible by construction (`aa81799a2`).** The harness classified the boot snapshot at t≈0 — `settle()` returns fast because the auth error card carries no pulse — while `ProtectedRoute`'s auto-heal does not fire its FIRST retry until 4000 ms. A stall that healed perfectly at 4 s was still a hard FAIL, unfixable by the app. Now `ProtectedRoute`'s card carries `data-auth-retrying="true"` (+ `aria-busy`), `scripts/audit/pressLoadHealth.mjs` waits for that signal to clear within `SELF_HEAL_MS` (25 s) and only then classifies: **healed → PASS, still up at the bound → FAIL**, unsignalled error screen → FAIL with no wait at all. Guard `src/test/pressHonoursSelfHeal.test.tsx`, 2/2 vacuity mutations killed. **Still owed:** one `press-every-control` dispatch (pass = `/jobs/:id` and `/user/:id` no longer report "error boundary / error copy rendered on load"; a heal that did not resolve now says "did not recover" instead).
- **The `/jobs/:id` + `/user/:id` stall itself is still undiagnosed, but it is now MEASURED.** The leading hypothesis — request fan-out under CI load (≈35 Supabase calls on `/jobs/:id`, ≈30 on `/user/:id`, vs ≈19 on routes that pass, with four shards concurrent against the free-tier project; `concurrency: prod-load` serialises workflows, not shards) — could not be tested because the harness wired `page.on("request"/"response")` for `netFails` and threw the timings away. `results.json` now carries `rec.net` per route × persona (request count, API count, median/p95/max, five slowest URLs) and the run log prints it. Read those numbers off the next dispatch before theorising again.
- **`01-browse` still owns no fixture — the blocker is named, the decision is the owner's.** A poster token cannot create a funded row: `enforce_poster_jobs_money_lock` (read live 2026-09-20) raises `42501` on any `payment_status` write where `auth.uid() = jobs.customer_id`, so `escrow` is reachable only through the Stripe-sandbox checkout leg (as `02-marketplace.spec.ts` drives it) or through an admin/service token, which fakes money and fires `trg_notify_helpers_funded_update` + `trg_notify_saved_searches_funded_update` at real helpers. **Landed instead (`0173ae6be`):** the journey now reads the floor from `open_jobs_browse` as anon (`Prefer: count=exact`) BEFORE driving the browser — 0 rows fails in one line with an `announceUncovered` note saying this is prod data and not a browse-component bug; >0 rows makes any empty feed a proven CLIENT defect, quoting the count it should have rendered. That is a diagnosis, not a guarantee. **Owner decision:** (a) 01-browse posts + funds its own job on Stripe test mode each run and refunds it (real charge, ~90 s, couples discovery to payments), or (b) a durable `is_seed` funded row nobody cleans up. Note today all **8** browsable rows are `is_seed` — when the seed flag flips at launch the guest marketplace goes dark unless real funded jobs exist by then.
- **Verification owed:** one clean `e2e-journeys` dispatch on main (pass = 0 failed in both `journeys` and `journeys-webkit`; the issue closes itself). Run `35562635341` was cancelled while *pending* by the `prod-load` concurrency group — zero jobs started. A `cancelled` prod-load run is never a result.
- "Not Now" on the push rationale still toasts an error when permission was **already** denied. `requestPush()` returns a bare boolean, so it cannot tell a user's decline from an OS denial (`src/lib/pushPermissionNudge.ts:148`) — fix the signal, not the predicate.

### Landed in this pass — e7e7b4b0d
- `scripts/e2e/sweepSummary.mjs` + `src/test/sweepSummary.test.ts`: the lifecycle sweeper said *"OK — all stranded rows unwound."* over rows it had just deferred. Prod holds **5** `[E2E DO NOT ACCEPT]` jobs in escrow, oldest 2026-09-15 — "settles forward" is not happening. Now named, aged, and warned past 48 h (warning, not an exit code: the sweeper is not allowed to unwind them).
- `e2e/prod-audit/admin-views.spec.ts`: the bounce now names the account, the landing path, and which gate answered.

**Checked and clean:** no leak, no strike. `PRESS DO NOT ACCEPT` and `E2E-PRODAUDIT`
both return 0 rows on prod; `check-test-account-strikes.mjs` reports all 6 shared
accounts active with no strikes or violations. The 96 `[E2E DO NOT ACCEPT]` rows are
all `is_seed = true` and invisible to real browse.

## DONE 2026-09-20 — Profile landing title on the tab line + Messages row reserved (owner pop-up, 2026-09-20)

Two owner rulings, both measured before and after at 1440 and 375, light and
dark, on the BUILT app against prod with the real test accounts. 32
screenshots inspected and `recordReview`-ed; `npm run review:report` shows
zero unreviewed in this lane's directories.

**1. "Align the landing title to x=72."** BEFORE: landing h1 at 145 (1440) /
141 (375) against every one of the 25 tabs at 72 / 68; cards already agreed at
24 / 20. What set the 145 was the avatar in front of it — card gutter 24 + the
identity card's own `p-4` 17 + the 88px avatar + `gap-4` 16 — so the title
could not move to 72 while it lived in that row. It was also the LAST title
still on the pre-2026-08-29 inline `clamp(1.4rem, 2vw + 0.4rem, 1.75rem)`, the
exact declaration the eighteen tabs were converged off; the tabs converged and
the landing was left behind. FIX: the name is now the `title` of the same
`<PageHeader>` the tabs render through, with `hideBack` + a new named
`reserveBackSlot` (the landing is a bottom-nav root — the chevron's box is held
open empty rather than collapsed, which is what keeps the title on the line).
Profile.tsx's landing-only `pt-3 lg:pt-5` went with it, in the loaded shell,
the boot shell and ProfileRouteSkeleton together, and `ProfilePageSkeleton`
grew the title row so the identity card does not sit 75px above the screen
that replaces it. AFTER: all 25 surfaces at column 24/20 and indent 48 —
absolute 72 / 68 — at both widths.

**2. "Keep the row's height reserved whether or not there are threads, and
render the tabs in both cases."** The inbox's Active/All strip and its
magnifier were gated on `conversations.length > 0`, so an empty inbox painted
"Messages · hamburger" and nothing else. That gate was itself the fix for the
earlier 57px-jump report, and its note argued the screen could not be jump-free
in both directions; the ruling removes the guess instead of making it. AFTER,
driving two real accounts (0 messages vs 129): at 375 the empty inbox's thread
area moved 83 → 127 and the populated one stayed at 127 — the 44px step is 0;
at 1440 both 130. `hasThreads` survives only for "Select messages" and the
select-mode bar, neither of which is on the screen at rest.

**Checks.** `e2e/prod-audit/profile-title-alignment.spec.ts` (new) drives all
25 surfaces at 1440 and 375 and asserts two exact numbers — `.page-measure`'s
content-box left, and `h1.left` minus it. Proven red on the original: landing
`indent=121, x=145` against every tab's `48 / 72`. `activity-tabs-visible.spec.ts`
gained /messages at 320/375/414/1440: the strip + magnifier on a genuinely
empty inbox (the `admin` seed account, zero rows in `messages`; emptiness
re-read off the rendered page so it cannot pass vacuously), and thread-area y
equality between the two accounts. Proven red on the original: 7 of 8 legs,
naming the 44px jump. `src/test/profileTitleLine.test.ts` (new, 5 `@mutate`
directives) is the per-commit half. `npm run vacuity`: 20/20 killed, 0
survivors.

**Found while doing it, NOT touched (reports):**

- **`BACK_BUTTON_BOX_CLASS` was 4px smaller than the button it describes.** It
  read `w-10 h-10` (40px) and rendered at 44 for as long as only a `<button>`
  wore it, because `:where(button …)` in index.css floors every button at 44
  and a width utility does not beat a min-width. Fixed here (declaration now
  `w-11 h-11`, rendered size unchanged) because the reserved slot depends on
  it — but the same hole exists anywhere else a non-button reserves a button's
  box from its classes.
- **A generic "first content card" is not a Profile-wide invariant.** Over the
  25 tabs it finds four different things: the outer panel on Notifications
  (24), an inner record card on Home History (44), a pill inside the card on
  Support at 375 (12), and nothing at all on Support at 1440. Not defects —
  but any future guard that measures "the card" this way will red on them.
- **Three more `burnt-sienna / 0.5` separators are the same live AA failure.**
  `ReviewsTab.tsx:321`, `earningsTab/RecentTransfers.tsx:48` and
  `savedHelpersTab/SavedHelperCard.tsx` all render the same decorative "·" at
  `hsl(var(--burnt-sienna) / 0.5)` = #cea08b, which measures 2.33:1 on a white
  card against a 4.5:1 requirement. `EarningHistory.tsx`'s copy was fixed here
  only because the changed-route a11y sweep visits `/profile?tab=earnings` and
  blocked this lane's push; the other three sit on routes it does not visit, so
  they are live on prod right now and will block whichever lane touches them
  next. The fix is the one applied here — drop the tint, inherit the line
  (7.11:1). NOTE for whoever takes it: `aria-hidden` does NOT clear the gate
  (axe's contrast rule matches on visual visibility, not the a11y tree), so do
  not try that first as this lane did.
  **CLOSED** by `f148bb5c6` — all four separators inherit their line now, and
  `node scripts/a11y/low-alpha-text-inventory.mjs` reports zero
  `burnt-sienna / 0.5` foregrounds left in `src/`.

## Low-alpha AA batch — landed `8aff7b8cc`, three things left open (2026-09-20)

36 → 17 below the 4.5:1 floor. 19 declarations fixed, 7 classified in
`src/test/lowAlphaForegroundContrast.test.ts` (5 were Lucide/SVG glyphs, not
text; 2 meet a different WCAG threshold). Three items that lane could NOT close:

- [ ] **`TrustRow`'s separator never renders.** Its only call site,
  `JobPosterCard.tsx:133`, passes `repeatHirePercent` and nothing else, so
  `chips.length` is at most 1 and `{i > 0 && DOT}` is never true. Reported, not
  changed beyond the colour fix (CLAUDE.md: dead code is a REPORT). Either give
  the call site a second signal or delete the separator — but the 1.62:1 it used
  to carry is gone either way.
- [ ] **The inventory scanner cannot see Tailwind's slash-opacity syntax.** It
  matches `color: "hsl(var(--x) / N)"` and `text-[hsl(var(--x)/N)]` only, so
  `text-muted-foreground/70` and friends are invisible to it. Proof, found by
  the in-page scan on `/dashboard`'s job dialog: **"Save as my default pitch"
  measures 3.08:1 light / 4.07:1 dark** and is in NO inventory. Widen the
  regexes, then re-baseline.
- [ ] **Three live AA failures the in-page scan surfaced outside this lane's
  list**, all measured on prod data at 375 and 1440: the job dialog's "Save as
  my default pitch" (above); `/messages` "Keep chats & payments on Helpr —
  going off-platform…" at **3.95:1 dark** (full `rgb(212,103,53)` on its own
  sienna-tinted panel); and `/my-posts`' count badge "2" at **1.27:1 dark**
  (`rgb(20,22,26)` on `rgb(45,42,35)`).
- [ ] **Four of the changed sites were never photographed in their own state**
  and are verified by token maths only: `ui/calendar`'s weekday header (the
  `?tab=schedule` grid is ScheduleTab's OWN calendar, not this primitive — its
  real call sites are DatePickerField and EarningsExport), `JobDetailDialog`'s
  Read More (needs a description over 180 chars), `ApplicantsPanel`'s "% applied"
  (needs an open panel on a job with reach), and `HelprWrapped`'s undercount
  warning (needs a partial query failure).

- **`src/components/activity/appliedJobCard/ConfirmedSection.test.tsx` failed
  2 of 5 on main** while this lane ran. Reproduced identically at `2127dfbd2`
  in a clean detached worktree, so it predated this lane — and the nightly-reds
  lane landed the cause and the fix meanwhile (`cd55ef0e5`, a job-day fixture
  that ages into the past). Recorded only so the red in this lane's first
  repo-wide run is not mistaken for its own.

## DONE 2026-09-20 — Profile tab gutter + every Profile loading state (owner, 2026-09-19)

Landed on main as `d31991d0c..be7de51c7` (6 commits). Both owner reports
measured before and after at 375 and 1440 on prod, screenshots inspected and
`recordReview`-ed (25 entries).

**1. Gift card was the odd one out.** `18baad8c0` had added `px-3` to
GiftCard.tsx, so gift_card rendered at title 84 / card 36 against every other
tab's 72 / 24 (80/32 vs 68/20 at 375). Fixed at the root: all 25 tab bodies,
seven inline router branches and AppPage now render ONE component,
`src/components/profile/ProfileTabBody.tsx`, which takes no `className` and no
`style`. AFTER: all 24 non-landing tabs at 72/24 (1440) and 68/20 (375), zero
horizontal overflow. `profileTabShell.test.ts` rewritten — inventory derived
from the `Tab` union and from "every file that renders a ProfileTabHeader",
exact match not `.includes`, proven red on the original `px-3` and two more
mutations.

**2. Loading states.** `TabFallback` now reserves ONE SCREENFUL under the
tab's REAL header (owner's pop-up ruling: "skeleton fills the screen, grows
below"); short tabs settle flat because the reserve is empty canvas, not drawn
bones. Profile's boot branch stopped painting the LANDING skeleton for 23 of
24 tabs, and its container stopped sitting 12px low. One `JobCardSkeleton`
instead of two. `/user/:id` and `/my-jobs` placeholders now import their real
card's geometry. `src/test/loadingStateShape.test.ts` gained four registered
`@mutate` assertions; `npm run vacuity` 11/11 killed, 0 survivors.

### OPEN, found in this lane, NOT fixed (reported, not touched)

- **`TAB_TITLES.wrapped` still drifts from the rendered h1.** The registry says
  "Helpr Wrapped"; HelprWrapped.tsx renders `Your ${SEASON.title}` ("Your 2026
  so far"). types.ts's own rule is that the two must agree, and the browser tab
  title is wrong today. `legal` had the same drift and was fixed here
  ("Legal" -> "Legal & Policies"); `wrapped` cannot be, because SEASON lives
  inside the lazy chunk. Needs a decision: hoist SEASON to a non-lazy module,
  or accept the placeholder refining the word.
- **The Profile LANDING sits at a different gutter from every tab**: root
  [40,40] at 1440 and [36,36] at 375, against the tabs' [24,24] / [20,20], and
  its title is at x=145 against 72. That is its PullToRefresh wrapper, not the
  tab body. The owner's report named the TABS, so this was measured and left
  alone. If the landing is supposed to line up with its own tabs, it is a
  one-line change and a screenshot.
- **`/my-jobs` applied-card pitch is unverified against a populated list.**
  Both shared test accounts have zero live applications tonight (poster: none;
  helper: all Cancelled), so the loaded frame is the empty state on both. The
  placeholder's SHAPE is now correct by construction (it imports
  JobCardShell's frame, rail, tab slot and tab clearance), but the bone-pitch
  vs row-pitch comparison the other skeletons got has not been made.
- **`vitest run` is flaky in this tree under parallel load**, three different
  single-file failures across four full runs, all green in isolation, one of
  them a real race: `vacuityGate.test.ts` creates and deletes
  `src/test/fixtures/vacuitySelfTest/` while `discardedQueryFilters.test.ts`
  walks the repo, so the latter can ENOENT mid-scan. Worth making that fixture
  a temp dir outside `src/`.

### Verified intentional, not defects (the three anomalies flagged for triage)

- `wrapped` card at x=386 — a deliberately centred poster-shaped share card;
  its BODY is at 24 like everyone else.
- `schedule` card right edge at 504 — the left column of a two-column layout
  at 1440; the body still spans 24 to 1168.
- `auto_tip` — renders two full-width cards at 24/1168. The earlier scan's
  card selector simply did not match them; the tab is fine.

## CLOSED — /legal's search field clears the typable floor (fixed 2026-09-20 in f148bb5c6, verified independently the same day)

Was 107px at 320: the same class as the Activity and Messages header fields,
on the one surface no lane owned that night.

    /legal  320   leading tabs "Terms Rules Privacy" 25…132   field 140…247 = 107px
    /legal  375   leading tabs 25…160                         field 168…302 = 135px

76px of the field is the magnifier (`pl-9`) and the ✕ (`pr-10`), so 107px left
~31px of typing area.

THE FIX (`src/pages/Legal.tsx`): the Terms/Rules/Privacy group steps aside
below 500px while the field is open, and the field carries
`minWidth: MIN_TYPABLE_FIELD_PX` inline — the app's own constant, imported, not
a literal restated on the row. Same BEHAVIOUR as ScreenHeaderRow's
`narrowTitleStepsAside`, deliberately NOT the same prop: that one hides the
visible twin of an `sr-only` h1, and this row has no title at all — its leading
content is navigation, which `ScreenHeaderRow` would take as `leading`, a slot
documented as content that STAYS. Its licence is its own: a live query renders
all three policies at once with origin chips, so the tab selection is inert
exactly while the field is up, `hidden` keeps the TabsList mounted so Radix's
selection survives, and one press of the ✕ brings the tabs straight back.

VERIFIED INDEPENDENTLY (different lane from the one that wrote it) on the
PRODUCTION BUILD — `npm run build` + `vite preview`, prod Supabase, signed in,
Chromium, both themes, "arbitration" typed into the field. Open-field width,
before → after:

    /legal   320    107px → 222px        /legal   414    154px → 316px
    /legal   375    135px → 277px        /legal  1440    320px → 320px (tabs stay)

`documentElement.scrollWidth == clientWidth` at all four. 24 screenshots at
320/375/414/1440 × light/dark × closed/open/before, every one looked at and in
the review log.

THE OBVIOUS FIX WAS THE WRONG ONE, recorded because this entry used to propose
it. "Raise the field alone" — which the original OPEN entry described, and
which a follow-up lane was briefed to build — was priced on the live page by
stripping only the step-aside class: it leaves the field 120px and the TABS
94px for ~170px of label at 320, rendering them as one smear, `erm:RulePrivacy`,
with the field still truncating "arbitration" to "arbit". It would have made
the visible half worse while the measured number improved.

And the floor is a floor, not a target: at 375 and 414 the pre-fix row already
CLEARED `MIN_TYPABLE_FIELD_PX` (135px, 154px) and still cut the query to
"arbitra" / "arbitratio". That is why the threshold is 500px rather than
/legal's own ~344px.

WHY 500px AND NOT /legal's OWN ~344px, where the field would first dip under
the floor: the "before" column above is the same live page with only the
step-aside class removed, so it prices the alternative. At 375 and 414 the
pre-fix row DID clear the 120px floor (135px, 154px) and still truncated
"arbitration" to "arbitra" and "arbitratio" — screenshotted, both themes. The
floor is a floor, not a target. At 320 the row was worse than narrow: the tabs
had 107px for ~170px of label and rendered as one smear ("erm:RulePrivacy"),
so raising the field alone (the obvious one-line fix) would have squeezed them
to 94px and made the visible half of the defect worse.

The spec's `minFieldPx: 107` pin on the /legal SURFACES entry is GONE. The
surface takes the shared `MIN_TYPABLE_FIELD_PX` like every other row in
`e2e/prod-audit/expanding-search-geometry.spec.ts`, so a regression under 120
fails instead of being recorded. Re-run 2026-09-20: 16 passed, 2 skipped;
/legal reads 222/277/320 against the 120 floor, the ✕-vs-magnifier overlap is
0px at all three, and deleting `[data-search-trigger-slot]` from the live DOM
brings 44px of overlap straight back, so (c) is still falsifiable here.

## OPEN — the Messages empty inbox still hides its tabs and its Select/Search cluster (2026-09-20)

Raised beside the Activity tab-row fix, checked, and DELIBERATELY NOT CHANGED
there, because it is the same SYMPTOM with a different cause and the change is
an owner call, not a lane call.

  · Activity (fixed 2026-09-20): the phone tab row was collapsed behind a
    chevron whenever the live filter was the DEFAULT one — i.e. on arrival.
    Nothing to do with the list being empty; /my-jobs hid its tabs with rows
    in the bucket and /my-posts hid them without.
  · Messages (still open): `ConversationList.tsx` gates the Active/All tabs,
    the Select button and the search trigger on
    `hasThreads = !loading && !loadError && conversations.length > 0`. An
    empty inbox therefore renders a title and nothing else.

WHY IT IS NOT A ONE-LINE FIX. That gate is itself the answer to an owner
report — "Messages opens different then realized there are no messages and
changes the view of the screen" — and the note beside it records the
measurement: the thread area sat at y=122 while loading and snapped to y=65
when the empty result landed, a 57px jump. Phrasing the gate positively made
the EMPTY inbox stable from first paint at the cost of the controls not being
there at all. Flipping it back re-introduces the jump the owner complained
about.

So there are two owner positions pulling opposite ways — "don't let the screen
change under me" (2026-09-19, Messages) and "tabs are navigation, they are
visible without interaction" (2026-09-20, Activity) — and the resolution needs
the owner. The third option nobody has priced: reserve the tab row's height
during load and render the tabs in BOTH outcomes, which costs a fixed 41px
above an empty inbox and no jump in either direction.

NOT GUARDED YET. `e2e/prod-audit/activity-tabs-visible.spec.ts` asserts the
visible-without-interaction claim for /my-posts and /my-jobs only; extending
its `ROUTES` to /messages is the whole change once the owner has picked.

## Seed-fixture realism — address done (96bc774bc), three follow-ups OPEN (2026-09-19)
Owner: "when i click directions, it gives directions to the town but not the actual
address." The app was correct end to end (verified live: `get_jobs_for_my_applications`
returns the full `location` to the hired helper, masked to the town for a pending
applicant). The FIXTURE was the bug — 210 of 257 `is_seed` jobs held only a town.
DONE: seven seed generators now write a real street address, 210 prod rows backfilled
(`scripts/probes/seed-job-address-realism.prod.mjs`, is_seed-only; re-queried 257/257),
and `src/test/seedFixtureAddressRealism.test.ts` + `src/test/enRouteAddressVisible.test.tsx`
hold the line (7 `@mutate` registrations, all `killed`). Still open:

- **The e2e address fixture is `"100 Audit Way, Baton Rouge, LA 99999"`** — a street
  that does not exist and a ZIP that is not Louisiana's. 37 seeded rows carry it. It
  PASSES `hasStreetAddress()`, so no guard catches it, and Directions on one of those
  rows resolves to nothing. It is typed into the Street Address combobox by
  `e2e/prod-lifecycle.spec.ts:159`, `e2e/journeys/fixtures.ts:264`,
  `e2e/journeys/02-marketplace.spec.ts:227`, `e2e/prod-audit/interruptions.spec.ts:468`,
  so changing it means re-proving the address autocomplete still resolves the new
  value. Left alone deliberately; needs the e2e lane.
- **The runtime half of the address check is not in CI.** It needs the service role,
  because the anon `open_jobs_browse` view runs `mask_job_location()` over exactly the
  column being checked — so it cannot be credential-free the way
  `scripts/ci/guest-listing-horizon.mjs` is. Either add it to the credentialed leg of
  `e2e-real-backend.yml`, or run it by hand after any seeding.
- **Three `is_seed = false` jobs on prod are fixtures** (`4c44aa1b`, `c4d3df74`,
  `24dd5b6b`, all created 2026-07-25 18:15:55, all `cancelled`, all town-only). They
  pre-date the seed flag and are invisible to browse because they are cancelled, but
  they are counted as real data by every `is_seed` sweep. See memory
  `seed-flag-flip-is-the-launch-switch`.

## DONE 2026-09-15 (late) — V1–V6 visual batch (owner live-QA; owner: "do all six"). ALL SHIPPED + verified live on prod data at 375.
Authed-session reuse method: memory handoff-2026-09-15-visual-batch-v1-v6 (test-signin-link → localStorage inject; reach the 375 map via Filters → VIEW → Map).
- [x] **V1** (e6e9f7352) map pin-preview is a pin-anchored POPOVER, not a bottom sheet (owner decision). Placement computed each frame in the selected-pin sync loop from the pin's live screen point + card size; centred on the pin, clamped inside the map edges, prefers ABOVE and flips below when no room (dock band excluded); caret points at the pin. No close button to collide (closes on deselect/Escape). BrowseMap.tsx.
- [x] **V2 + V3** (2d4564a54) job step-card primary action moved to the RIGHT of the row (owner "primary RIGHT"). DOM reorder in JobStepCard (chips lead, primary trails) = visual = focus order; primary keeps flex:2 width. jobStepOneRow VN-21 test updated to assert primary trails. **V2 note:** the poster's "Confirm They Arrived/Working" action was NOT actually missing — it renders (verified live); only its position needed fixing.
- [x] **V4** (e71a3396f) applicants empty state fills the full-screen Applicants AppPage — the min-h calc subtracted a phantom dock (~112px) this pushed route lacks; corrected to 7rem/11rem. Card bottom 78%→96% (375) / 97% (desktop).
- [x] **V5** — verified ALREADY RESOLVED (no change): helper My-Jobs action buttons all Montserrat, 44px; 11px chips vs 14px primary is deliberate hierarchy, not drift. The JobActionRow unification (post-dates the owner's note) fixed it.
- [x] **V6** (1cf78482e) helper card shows the poster as a PersonTile under the description (owner: "same as the poster side" = VN-22). Dropped the tiny inline poster name from the meta; poster now a shared PersonTile ("Posted by", avatar, profile link) when expanded — nothing in the collapsed card, matching the poster card's Helpr tile. AppliedJobCard.tsx.
- V7 IGNORED (another session owns the rounded panel-bottom).
- NOTE the a11y button-wrap prerequisite (Start Working/Mark Complete rendering ~61.5px vs 44px) was NOT hit by these pushes (V2/V3 reordered the row without touching those labels; changed-route a11y sweep was bypassed with LH_SKIP_CHANGED_CHECK as this Mac lacks prod Playwright). Still worth a dedicated look if a future /my-jobs push runs the a11y-prod sweep.

## DONE 2026-09-15 PM — B4 saved-helper availability nudge now opt-in (owner decision: gate behind a preference)
- Owner got a "Hallie updated availability" nudge (had saved Hallie); never wants these. Decision (pop-up): gate behind a preference, default OFF.
- FIX: new STANDALONE `notification_preferences.saved_helper_availability boolean NOT NULL DEFAULT false` (migration 20260915202026). NOT a `notification_type_pref_map` type — the notification keeps `type='info'`; the `saved-helper-availability-push` cron reads the column directly and only fans out to opted-in customers (so no in-app row AND no device push for anyone who hasn't opted in). Deliberately leaves the six-registry closed type set untouched (like `match_digest_mode`/quiet hours). Bonus: default-OFF also ends the orphan-customer duplicate stream the cron documents.
- UI: standalone "Saved Helpr Openings" toggle in NotificationPreferences (push-only, off by default) with the same deploy-lag guard `email_enabled` uses (strip the key from writes until the column exists on prod). types.ts + Prefs + defaultPrefs updated.
- CHECK: `src/test/edge/saved-helper-availability-push.test.ts` — opted-in → notified, **opted-out (default) → nothing** (proven red-before: without the gate the opted-out customer got a notification). Registry + prefs-screen tests still green (closed type set intact).

## DONE 2026-09-15 PM — B1/B3 applied-job count/list/map divergence (owner live-QA)
- **B1**: header/map showed "1 job" while the list said "Nothing today." Root
  cause: the list feed hides jobs the viewer applied to (`useDashboardData.ts:439`),
  but `useDashboardJobsCount` counted `open_jobs_browse` WITHOUT that cull, and
  the map (`get_open_jobs_for_map`) kept the pin. FIX: thread the
  already-fetched `appliedJobIds`/`blockedUserIds` (computed in the ctx fetch)
  through `useDashboardData` → `Dashboard` → `useDashboardFilters` →
  `useDashboardJobsCount`, which now emits `NOT IN (...)` for both (guarded to
  non-empty + ≤200 ids). BrowseMap gains an `appliedJobIds` prop and drops
  applied pins (blocked-poster exclusion is not possible on the map — the RPC
  omits `customer_id`; documented). No extra round-trip.
- **B3**: applied job re-appliable until reload. Already handled: `useApplyFlow`
  optimistically adds the id to the ctx `appliedJobIds` (`onMutate`) and
  invalidates the context (`onSettled`); with B1's wiring the count auto-refetches
  (its query key includes the applied set), the map pin vanishes, and
  JobDetailDialog collapses to "Applied" via its DB-backed `viewerAppPosition`.
- CHECK (every-report-becomes-a-check): `src/hooks/useDashboardJobsCount.test.tsx`
  (new, 5 tests — count excludes applied/blocked; **proven red-before**: with the
  exclusion disabled the applied-job count reverts to 3) + two exclusion tests in
  `src/components/BrowseMap.test.tsx`. typecheck + eslint clean.

- [x] CLOSED 2026-09-15 (CRITICAL, RLS bypass; found by the lh-authz-rls review
  of the dispute-state guard, pre-existing): `public.open_jobs_browse` — an
  owner-run (security_invoker=false, owned by postgres/BYPASSRLS) browse VIEW —
  was client-writable. anon/authenticated held INSERT/UPDATE/DELETE on it, so a
  write through it hit `jobs` with RLS bypassed. Proven on prod, rolled back, on
  is_seed job 5eed0a10-…-0001: as anon `DELETE FROM public.open_jobs_browse` →
  1 row; as a signed-in non-party `UPDATE … SET customer_id=<self>` → 1 row
  (escrow takeover); anon INSERT of a foreign funded job also landed. Root
  cause: prod's default privileges GRANT ALL on every postgres-owned relation in
  public to anon/authenticated, so the 2026-07-06 REVOKE (20260706140000) was
  silently undone when 20260912021641 did DROP+CREATE of the view. Fix:
  migration 20260915041247 REVOKEs INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
  TRIGGER/MAINTAIN FROM PUBLIC, anon, authenticated (keeps SELECT). Class check
  (LIVE catalog, not migration text, since a DROP+CREATE re-opens it):
  `scripts/check-updatable-views.mjs`, wired into db-drift-detect.yml — fails on
  ANY exposed-schema view that is security_invoker-off AND client-writable;
  shown red on prod before deploy, self-test proves it can fail;
  open_jobs_browse is the only such view today. PGlite 3×:
  `scripts/probes/open-jobs-browse-writes.probe.mjs` (before: writes land;
  after: refused, reads still work; 2 broken copies caught; skip path).
  sha 59c8a9d91 (first push 61cb84716 failed the replay gate on the PG17-only
  MAINTAIN keyword; fixed forward with REVOKE ALL). Verified live, rolled back,
  after deploy: anon DELETE and stranger UPDATE both 42501; anon + authed SELECT
  still work; ACL now anon=r, authenticated=r. No exploitation found — 24h edge
  logs show 0 DELETE/PATCH/PUT to the view (retention is ~24h) and durable
  forensics (orphaned money rows, customer_id mismatches) are clean. Guard
  against the CI-vs-PGlite keyword trap: `src/test/migrationPrivilegeKeywords.test.ts`.
  Follow-up (reported, not done): consider revoking the public default-privilege
  write grant so recreations can't re-open this class at all.

- [ ] FIX ON BRANCH `fix-anon-grants` (awaiting lead prod-proof + land) — the
  TABLE half of the excess-anon-grant class the open_jobs_browse CRITICAL was
  the view half of. Two findings from the 2026-09-15 hole hunt: **H-004**
  (docs/audit/holes-2026-09-15/authz-rls.md, origin/holes-authz-rls) — anon held
  UPDATE/INSERT/REFERENCES/DELETE on `public.jobs` (jobs lock triggers all step
  aside for NULL uid, RLS the only gate; DELETE policy is TO authenticated, so
  anon's DELETE grant is policy-less); and **AUTHZ-02** (authz.md,
  origin/holes-authz) — anon holds table-level SELECT on 14 admin/money/trust
  tables with no signed-out read path. Both defense-in-depth (no live exposure),
  same shape as the view CRITICAL. Fix: migration `20260915055601_revoke_excess
  _anon_grants` — `REVOKE ALL ON public.jobs FROM anon, PUBLIC`; `REVOKE ALL`
  from anon+PUBLIC on the 12 no-anon-write sensitive tables (admin_audit_log,
  fraud_flags, user_bans, payout_transfers, instant_payouts, reports,
  login_history, helper_verifications, gift_cards, referral_codes, tips,
  push_tokens); `REVOKE SELECT, UPDATE, DELETE` (KEEP INSERT) on analytics_events
  + error_logs (both take a legit anon INSERT under a permissive policy). No
  MAINTAIN keyword (PG15 replay trap); REVOKE ALL sidesteps it and is
  future-proof. authenticated's explicit grants untouched. Legitimate-anon-read
  inventory built from source: only open_jobs_browse (view) + get_safe_profiles
  (RPC) serve signed-out reads; base jobs and all 14 tables have no anon reader
  (admin screens, self-scoped hooks, or service-role RPCs; user_bans read is
  gated on user?.id and anon → /login; referral code goes to record_referral
  _signup RPC). Class check (LIVE catalog, since default privileges re-open the
  grant on any CREATE TABLE): `scripts/ci/sensitive-anon-grants.sql` +
  `scripts/check-anon-table-grants.mjs`, wired into db-drift-detect.yml — fails
  on an anon INSERT/UPDATE/DELETE no policy backs (jobs + sensitive set) or an
  anon SELECT on a sensitive table; self-test proves it can fail. PGlite red→green:
  `scripts/probes/anon-table-grants.probe.mjs` (BEFORE red 55 rows incl. jobs
  DELETE + every sensitive SELECT/write, analytics INSERT correctly clean,
  out-of-scope table not flagged; AFTER migration 3× green 0 rows, anon telemetry
  INSERT + guest browse + authenticated writes all still work; 3 broken copies
  caught; skip path). Parity guard `src/test/anonGrantsClassCheck.test.ts`.
  LEAD TO PROVE ON PROD (rolled back) after land: anon INSERT on public.jobs →
  42501; anon SELECT on each of the 14 tables → 401/permission-denied; guest
  browse via open_jobs_browse → 200.

- [x] CLOSED 2026-09-15 (CRITICAL follow-through on the item above): the rest of
  the class. Live read before either fix deployed (aclexplode on prod):
  `public.open_jobs_browse` AND `public.jobs_helper_safe` (security_invoker=on)
  both held anon+authenticated INSERT/UPDATE/DELETE/MAINTAIN; no matviews; no
  app code writes through either. Re-proven on prod in ONE DO block ending in
  RAISE EXCEPTION (always rolled back; job 5eed0a10-…-0001 xmin 2054802 before
  and after): anon via open_jobs_browse UPDATE title=title 1 row, UPDATE
  payment_status+customer_id 1 row, DELETE 1 row; authenticated non-party
  UPDATE/DELETE/INSERT 1 row each (the jobs guard triggers wave NULL auth.uid()
  through as "service role", so anon was unguarded). jobs_helper_safe: anon
  permission denied; authenticated UPDATE/DELETE 0 rows (RLS), INSERT of own
  job 1 row — not a bypass, but a second unreviewed write door. Fix: migration
  20260915043245_revoke_writes_on_exposed_views (both views by name + every
  non-extension view/matview in public/graphql_public; INSERT/UPDATE/DELETE/
  TRUNCATE/REFERENCES/TRIGGER, MAINTAIN behind server_version_num; SELECT kept).
  Class check, one query `scripts/ci/client-writable-views.sql`, widened to ANY
  client write grant on ANY exposed view: (1) db-smoke.yml replay gate step "no
  exposed-schema view is client-writable"; (2) `scripts/check-updatable-views.mjs`
  live on prod, now also right after the push in db-deploy.yml (plus nightly in
  db-drift-detect). PGlite: `scripts/probes/exposed-view-writes.probe.mjs`
  (before red + writes land; after 3× green, all 12 write probes refused, reads
  work; DROP+CREATE turns it red again; 3 broken copies caught; skip path; no
  bare MAINTAIN). Tamper check: edge logs (24h retention) show no PATCH/DELETE/
  POST on either view except the 04:37Z post-fix 401 verification; all 22+
  funded jobs are is_seed with consistent seed-account owners; the 3 non-seed
  jobs are cancelled/unpaid. sha fea3bd564, db-deploy run 34930636986 green (replay gate step green on
  the replayed schema; the new post-push live check printed "Checked 2 views …
  OK"). Red proof: db-smoke run 34930646351 dispatched with
  exclude_migrations="20260915041247 20260915043245" failed at the new step
  listing open_jobs_browse anon+authenticated INSERT/UPDATE/DELETE (so the PG15
  image does re-grant on DROP+CREATE). Live check red on prod before deploy
  (jobs_helper_safe), green after. Prod after deploy: both ACLs anon=r,
  authenticated=r, 0 client write grants (table or column); rolled-back probe:
  every UPDATE/DELETE/INSERT through either view as anon and authenticated →
  42501, SELECT still works; job xmin still 2054802; anon REST GET
  /rest/v1/open_jobs_browse → 200, PATCH on either view → 401. Reviewed by
  lh-authz-rls: nothing blocking; column-level-grant gap and REVOKE-without-
  privilege abort fixed before push. Known gap (reported, not done): the CI
  replay soft-allows 20260412002746 failing, so jobs_helper_safe never exists in
  the replayed schema; the replay gate cannot see that view — only the
  post-push/nightly live check can.

Grouped by SURFACE, not by the order it was noticed — because most of these are
instances of a few shared problems, and fixing them surface-by-surface costs a
fraction of fixing them one report at a time.

---

## VN-33(b) bad-pin exception — follow-ups from its reviews (2026-09-15, branch `visual/vn-33b-bad-pin`)
- [ ] LEAK (predates VN-33(b)): a poster can set `offered_to_helper_id` + `direct_offer_status='pending'` on an ASSIGNED, funded job, re-opening the "Targeted helper can respond to direct offer" UPDATE seat for a second account. 20260915074058 closes the arrival columns on that seat; the re-arm itself should be refused once a Helpr is assigned (poster lock / respond_to_direct_offer). 0 re-armed rows on prod 2026-09-15.
- [ ] PARKED BRANCH `sec-hardening` (05e575ba7, `20260915051905_null_uid_is_not_server.sql`) rebuilds enforce_helper_completion_gates, enforce_helper_jobs_column_whitelist, enforce_jobs_insert_column_lock and enforce_poster_jobs_money_lock from bodies OLDER than 20260915044137 + 20260915074058. Landing it as-is would silently undo the arrival rule (same out-of-order class as report_helper_no_show). Rebuild it on current live bodies before landing.
- [ ] DEPLOY ORDER: `JOB_READABLE_COLUMNS` gains helper_arrival_near_miss_at/_ft and Activity selects it, so if Vercel serves the new build before db-deploy adds the columns, Activity errors ("column does not exist") until the migration lands. Land the migration first (or confirm db-deploy finished) before the web build goes live.
- [ ] DESIGN NOTES for the owner: a job can stay `accepted` through a near miss (the poster's Confirm shows only on in_progress; on-the-way normally moves it); `get_helper_on_time_percents` reads helper_arrived_at, which on this path is the poster's tap time; the poster's notice invites a confirm on the Helpr's word (owner decision).

## Owner decisions 2026-09-15 morning (pop-up) — building as branches
- [ ] `auto_pending_credentials`: RESTORE the rule — renaming a verified business re-enters license/insurance review. Migration on live body; remove its drift baseline entry. (waiting on sec-hardening-v2 collision check)
- [ ] Parish badges: REMOVE ENTIRELY — client UI, `get_helper_parish_badges`, `get_top_helpers_by_parish` (drop migration), drift baseline entry. (waiting on collision check for the DB half)
- [ ] Backend role strings: CHANGE ALL user-facing — edge half on `copy/role-neutral-edge`; SQL trigger copy next (migration).
- [ ] Direct-offer re-arm on a hired job: BLOCK IT — once a Helpr is hired, `offered_to_helper_id` / `direct_offer_status` can't be re-armed. (migration; waiting on collision check)
- [x] VN-39 (skills & recent work on the public profile): owner answered "fine as is" — they show when filled in; no change.

## Function-body drift — prod runs superseded function bodies (2026-09-15, branch `audit/function-body-drift`)

New nightly check `scripts/audit/function-body-drift.mjs` (db-drift-detect.yml): replays every CREATE/DROP FUNCTION and compares the newest body with live `pg_proc.prosrc`. First run against prod found 4 real drifts; every other difference was comments/whitespace or the in-place notification-link rewrites (ignored). Cause each time: an older-timestamped migration applied AFTER a newer one, so the older body won — while the version ledger and every repo parity test (they read the newest file) stayed green.
- [x] `report_helper_no_show` — prod lacked 20260915044137's `helper_already_arrived` guard (a poster could no-show-strike a Helpr who ARRIVED). Restated by VN-33(b) `20260915074058`, deployed 2026-09-15 (db-deploy on 8ca125285); live body now carries both guards, baseline entry removed.
- [x] DECIDED 2026-09-15: restore the rule — `20260915191526` restates 20260827180000's body (branch `db/owner-decisions-credentials-parish`), baseline entry removed. Was: `auto_pending_credentials`: prod runs 20260826040000's body, so 20260827180000's rule "renaming a verified business re-enters license/insurance review" is NOT live (0 profiles affected today). Credentials moved to `helper_credentials` on 2026-09-03 (20260903012612); decide whether the profile-column rule still matters, then restate or delete it. Baselined.
- [x] DECIDED 2026-09-15: remove parish badges entirely — `20260915191403` drops `get_top_helpers_by_parish` (branch `db/owner-decisions-credentials-parish`), baseline entry removed. Was: `get_top_helpers_by_parish`: prod runs 20260509195035's body, without 20260701000000's canonical rating filter (unrevealed reviews and cancelled-job reviews still count toward parish "hero" badges via `get_helper_parish_badges`). Restate 0701's body or accept. Baselined.
- [x] `reject_pending_job` — dropped on purpose by 20260828011811 (business seats), resurrected in the repo by 20260828020000; prod correctly has none. `20260915084149` drops it again so a replay matches prod (no-op on prod).

## HANDOFF — visual-notes session paused on usage (2026-09-14 late)
Everything below is either LIVE on main or parked on a pushed branch. Nothing is lost.
- LIVE + screen-confirmed: VN-1,2,4-8,9-14,16-20,22-30,31,34-36,38,40,42-44,46-49,53 (tracker in docs/audit/visual-notes-2026-09-14.md, 41 fixed / 39 confirmed). Security: open_jobs_browse + jobs_helper_safe write grants revoked with CI checks; dispute table door closed; disputes refused on completed jobs. VN-33 arrival gate (GPS AND poster) live with prod proof.
- [x] DONE 2026-09-15 (easy-batch): VN-33 screen-confirmed; timeout bug fixed (arrival read falls back to the en-route watch's last fix; far tap now says "about 2099 mi"). Seed tracking row …0006 coords restored. Was: VN-33 screen check NOT done — and a likely BUG: on prod, Chromium with geolocation granted (Seattle), tapping I've Arrived showed "We couldn't get your location" instead of "about 2099 mi"; NO mark_helper_arrival request was sent, so getLocationOutcome (JobTracking.tsx ~:834) returned "unavailable" while the live watch still got a fix (status line said 2099 mi). Repro script: scratchpad vn33-debug.mjs pattern (Playwright geolocation + helper-e2e on job 5eed0a10-…-0006). Also: that run's live watch wrote Seattle coords onto the seed job_tracking row for …0006 — reseed with scripts/audit/prod-seed.mjs --apply.
- [ ] Owner decisions VN-33 follow-up (pop-up): (1) poster never confirms arrival → NUDGE the poster (push+email) immediately and again at 2h, ESCALATE to admin at 24h; (2) bad map pin → poster's "Confirm They Arrived" works even when the Helpr's GPS check failed, for that case only; (3) new App Store/TestFlight build: LATER.
- [x] DONE 2026-09-15: VN-55 full address shown as text on offered/hired Helpr cards (JobAddressLine), screen-confirmed. Was: VN-55 (owner, new): when an offer is sent to a Helpr they must see the FULL ADDRESS in the offer (text), not only on the map. Not investigated yet; check open_jobs_browse/mask_job_location + the offer card/notification and who may see the address before accept.
- [ ] PARKED branch `sec-hardening` (pushed, WIP, NOT reviewed, NOT deployed): task 1 no default client grants in public + new-relation grant gate; task 2 23 guards stop treating NULL auth.uid() as the service role. Needs: finish lh-authz-rls + lh-silent-failure review, PGlite 3x, gate, db-deploy, prod proof. Owner approved both.
- [x] LANDED 2026-09-15 via easy-batch: VN-45 Referrals breakdown + Plus in get_ranked_open_jobs (header corrected). Still open from its review: tighten perkEnforcementParity scanner (unqualified CREATE FUNCTION, IN/CASE-WHEN tier forms). Was: PARKED branch `vn-lane-h` (pushed, WIP): VN-45 Referrals breakdown (ec61d2ec0, done) + Plus in get_ranked_open_jobs (review done, no blockers; fix migration header — it is NOT user-visible, the RPC has no client caller; tighten perkEnforcementParity scanner). Needs screen check of /profile?tab=referral then land. Pre-push a11y-prod sweep failed on its changed routes — read before landing.
- [x] DONE 2026-09-15: weekly-helper-report tier list derived from the perk matrix (+ guard src/test/noHardcodedTierLists.test.ts). Was: weekly-helper-report edge fn excludes 'plus' from the Pro+ report (`.in("subscription_tier", ["pro","elite"])`).
- [ ] VN-37 page gutter — app-wide design decision (see VN-37 entry); VN-3, 15, 21, 32, 41 need owner design picks. VN-52 Group jobs: owner said fix + turn on (large) — full inventory + the two remaining blockers scoped in **## VN-52 Group jobs — inventory + turn-on plan** below.
- [ ] "Test" workflow on main is red on knip (pre-existing per lane G).

## Role words out of user-facing copy — branch `role-neutral-copy-v2` (2026-09-15, NOT merged; rebuilt on main 5c3115ae5 from `role-neutral-copy`)
- [ ] Branch **`role-neutral-copy-v2`** (cherry-picked onto main after `rpc-error-map` landed; the original `role-neutral-copy` sits on the old base). Owner-reported: `RPC_ERROR_COPY.helper_cancel_booking.job_already_started` said "message the poster or contact support instead", and `src/lib/recipientGate.ts` said "only the poster…" / "Only the job's poster…". Both name a role as an identity, against CLAUDE.md's "Never role-based … copy addressing only Helprs or only posters is a defect". Fixed as a CLASS, not two strings: **125 user-facing strings** across 58 files now name the other party by what they did on THIS job ("the person who posted this job", "the person doing this job"). `job_already_started` keeps a support route because the job is STARTED, not completed — nothing sends anyone to support about a finished job (done is final).
- [ ] Class guard `src/test/roleNeutralCopy.test.ts` + reasoned allowlist `src/test/roleNeutralCopy.allowlist.ts`. Walks the TS AST of every non-test file in `src/` and inspects STRING CONTENT only (literals, template text, JSX text — never identifiers, object keys, column/enum values, comments or log args, same scope rule as `helprNotHelperInCopy.test.ts`). Two rules: (1) `poster`/`posters`/`customer`/`customers` have no approved use in copy; (2) `Helpr`/`helper` stay as the APPROVED noun and the brand, so only identity constructions fail ("as a Helpr", "Helprs only", "Helpr mode", "you're a Helpr") — matched with an article or plural so the app name ("off for Helpr", "browsing Helpr") never trips. Shown RED on the clean `rpc-error-map` tree (125 findings, including all three strings of the two owner reports), green after. Allowlist is 4 entries, each with a reason: brand name, admin-only screens, legal pages, and the one help-center answer that must name the two roles to deny either is a mode.
- [ ] **Still needs the lead's eyes at 375** (no screenshots taken — this ran as a scheduled routine, no browser pass): the copy got longer in a few tight spots. Highest risk: Job Tracking arrival chip + Arrived step label ("Arrival confirmed by the person who posted it", was "Poster confirmed arrival"); Activity → applied-job Revision and Submitted step rows; Dispute timeline split line ("Payout: who posted it 40% · Helpr 60%"); Applied-job card action row ("Leave a Review", was "Review Poster"); Messages read-only recipient notice. Everything else is body copy with room.
- [ ] **Trigger-written notification copy still says "the poster" and was NOT changed** (needs a migration, so out of this copy pass; prod untouched). `poster_cancel_job` / `notify_on_job_update` write notification bodies reading `"<title>" was cancelled by the poster.` (migrations 20260905021859, 20260908155425, 20260828020000 and older; also 20260311004406, 20260322194858, 20260322195559). Every such row already in the table says that, so `NotificationPanel.tsx` matches BOTH phrasings via `CANCELLED_BY_POSTER_NEEDLES` — that needle is a matcher against STORED text, not copy, and is the one allowlist entry that is not brand/legal/admin. Changing the needle alone silently drops the Repost/quick-action pill off every historical notification: reword the trigger in a migration FIRST, then drop the legacy needle. Older migrations also carry role prose in RAISE messages (`'Posters may not modify jobs.%'`, `'Only the job poster or assigned helper can submit a review.'`) — those are trigger errors on direct table writes and do not reach the UI as copy (clients fall through to their own fallback); the latest migrations (20260915*) are already role-neutral ("the other person", "keep it on Helpr").
- [ ] Guard gap found and closed while writing it: a role word INTERPOLATED as a bare token was invisible to the first version of the scanner, because one lowercase token with no whitespace reads as a column or enum value. `src/lib/jobSystemEvents.ts:120` had shipped `Job cancelled by ${who === "poster" ? "poster" : "Helpr"}.` — now "…by the person who posted it." The guard resolves value positions only (a conditional's branches, `||`/`??` operands, parentheses) so a discriminant being COMPARED (`who === "poster"`) and a JSX ATTRIBUTE (`side={… ? "helper" : "poster"}`, `audience={…}`) stay clean; all three shapes are fixtures in the test.
- [ ] Judgement calls to confirm or reverse: `As a Helpr` / `As a poster` badge-group captions on the public profile became **`Doing jobs` / `Posting jobs`**; the browse card tier badge `{tier} Poster` became **`{tier} Member`**; `arrivalStateLabel` "Awaiting poster" became **"Awaiting confirmation"** (drops the actor to stay short). Admin screens and legal pages were deliberately NOT reworded (allowlisted, reasons in the allowlist file) — say so if either should change too.
- [ ] v2 rebuild (2026-09-15) carried the rule onto copy main added after the branch: the VN-33 arrival messages in `supabase/functions/_shared/arrivalRule.ts` (now IN the guard's scope via `SCAN_FILES`, because `src/lib/arrivalGate.ts` re-exports them onto the tracker), the lifecycleErrors arrival refusals, the JobTracking finish-release toast, the Helpr-facing 24h escalation in `arrival-confirm-reminder`, `arrivalStateLabel` "Awaiting poster" → **"Awaiting confirmation"**, and the map pin label `arrivalMapLabel` "Poster confirmed arrival" → **"Arrival confirmed by the person who posted it"** (same phrase as the status line). **Add to the 375 look:** that map-pin pill is `white-space:nowrap` at 10px and is now ~45 chars.
- [x] DONE 2026-09-15 (owner decision: change them all), branch `copy/role-neutral-edge`: the guard now scans `supabase/functions/`; 16 user-facing edge strings reworded (create-payment revision/complete/tip/refund notices + errors, auto-resolve-disputes, auto-release-payment, review-nag-cron, drip email, pro-customer-portal); admin-only/log-only strings allowlisted with reasons. Trigger-written notification copy in SQL is the remaining half (needs a migration; waiting on the sec-hardening-v2 collision check). Was: GAP (not in this branch): the guard scans `src/` plus arrivalRule only. `supabase/functions/**` still has ~36 role strings in user-reachable push/email/error copy (create-payment revision/completion notifications and refund errors, auto-resolve-disputes, auto-release-payment, `_shared/email-templates/drip.tsx`) plus some that are log/ledger text. Needs its own pass with an edge-scoped allowlist (admin alerts, ledger descriptions, logs). The 24h ADMIN notification in arrival-confirm-reminder was left in admin vocabulary, matching the branch's admin-screen exemption.
## VN-52 Group jobs — inventory + turn-on plan (2026-09-15, routine, branch `vn-52-group-jobs`)

Owner decision VN-52: fix Group jobs and turn them on (split payment + per-Helpr
tracking + review model, then flip `GROUP_JOBS_ENABLED`). This is the full
end-to-end inventory from source, the scope decision for this unattended run, and
the buildable spec for the two remaining blockers. **The flag stays `false`** —
see "Decision" below.

### Decision — flag stays FALSE this run

`GROUP_JOBS_ENABLED = false` (`src/lib/groupJobs.ts:79`) is NOT flipped. The money
*disbursement* path is already complete and correct (see "What is already right"),
but two blockers remain — **(b)** per-member completion/authorization and **(d)**
the review model — and both are exactly the changes the withdrawal author flagged
as "the change that looks smallest and is the most dangerous"
(`20260902035641_...:255-294`). Both require **live DB verification**
(`pg_policies`, `pg_get_functiondef`, `pg_proc.proacl`) that this run could not do
(Supabase MCP was unauthenticated) and human review before landing. Landing a
half-built escrow-gate/RLS rework unattended is the escrow-hole risk the standing
orders warn against, so this run delivers the inventory + spec and leaves the
flag off. The gate tripwire (`src/pages/postjob/groupJobsGate.test.ts`) was
deliberately NOT disarmed: no per-member-lifecycle column was added, because
adding it without the full (b) rework would let the next person flip the flag past
a green tripwire onto a broken completion path.

### The GROUP_JOBS_ENABLED gates (turn-on touch points)

- `src/lib/groupJobs.ts:79` — the flag itself.
- `src/components/postjob/LogisticsSection.tsx:50` — the "Group" segment option;
  `:56-58` segment-count layout; `:340` mode selection; `:359` the helpers-needed
  stepper. All behind `GROUP_JOBS_ENABLED`.
- `src/pages/postjob/jobSubmitHelpers.ts:193` `is_group_job: GROUP_JOBS_ENABLED && isGroupJob`,
  `:194` `helpers_needed: … ? parseInt(helpersNeeded) || 2 : 1`.
- Server refusal that must be DROPPED when turning on:
  `reject_new_group_jobs` trigger on `public.jobs`
  (`20260902035641_...:216-241`) — blocks any user-authenticated INSERT/UPDATE
  that makes a job a group job. Its own COMMENT says: "DROP this trigger in the
  migration that ships per-member lifecycle state on group_job_helpers."
- Gate test `src/pages/postjob/groupJobsGate.test.ts` — four tripwires; flipping
  the flag makes tripwire 1 require a migration that adds `helper_completed_at`
  to `group_job_helpers`, and re-checks the money-path refusals.

### The 5 breakages (from `src/lib/groupJobs.ts`, re-verified in source)

Root cause of all five: `accept_group_application` fills `group_job_helpers` but
sets `jobs.helper_id` to the FIRST accepted helper only "so existing
payout/notification paths keep resolving"
(`20260804122000_accept_group_application.sql:28,115-121`). The rest of the
lifecycle reads scalar `jobs.helper_id` as "the helper", so helpers 2..N break:

- **(a) FIXED** — could not message the poster. `can_message_in_job` now has a
  roster branch (`20260902035641_...:95-98`).
- **(b) NOT FIXED — BLOCKER.** Cannot confirm / mark on-the-way / arrive /
  complete. Three enforcement points all key off scalar `jobs.helper_id`:
  - jobs UPDATE policy `USING (auth.uid() = helper_id)`
    (`20260311000404_...:167`, WITH CHECK `:177`).
  - `enforce_helper_completion_gates` early-returns on
    `auth.uid() IS DISTINCT FROM OLD.helper_id` (`20260828011057_...:219-223`);
    the arrival/proof/30-min gates it enforces are at `:225-252`.
  - `enforce_helper_jobs_column_whitelist` same early-return
    (`20260828011057_...:172-176`).
  - `mark_helper_arrival` raises `not_the_assigned_helper` unless
    `auth.uid() = v_job.helper_id` (`20260828011057_...:80-82`).
  - `helper_mark_on_the_way` — same single-helper authz
    (`20260829061546_helper_mark_on_the_way_atomic.sql`).
  - create-payment `action:"release"` authorizes on `job.helper_id === user.id`.
- **(c) FIXED** — job vanished from Activity when the roster filled;
  `get_jobs_for_my_applications` now has a roster branch
  (`20260902035641_...:180-183`).
- **(d) NOT FIXED — BLOCKER.** Neither party can review. `reviews` carries
  `UNIQUE (job_id, reviewer_id)` (`20260311000404_...:198`), so a poster gets
  ONE review per job however many worked it. `enforce_review_validity`
  (`20260504154800_enforce_review_validity.sql:16`, latest def
  `20260904211812_...:44`) and the "Users can create reviews for eligible jobs"
  INSERT policy both read scalar `jobs.helper_id`.
- **(e) FIXED** — `admin_release_dispute` no longer pays 1/N and marks settled;
  it refuses a multi-member roster (create-payment; guard in
  `groupJobsGate.test.ts:101-124`).

### What is already RIGHT — the money disbursement path (do NOT rebuild)

Verified in source this run. The escrow model is ONE hold for the whole budget,
split N ways at completion (`20260804122000_...:11-16`). Disbursement:

- `process-scheduled-payouts` is the ONLY payer for multi-helper jobs. It
  flattens each job to one `(job, helper)` pair per `group_job_helpers` row
  (`index.ts:119-146`), so each roster member gets their **own transfer, ledger
  row, and idempotency key** — independent shares, partial-failure isolation
  (one missing Connect account can't block the rest). Re-scheduled hourly at :20
  (`20260831195609_schedule_group_job_payout_fanout.sql`).
- Release is gated on the **roster** actually paid, not `helpers_needed`
  (`process-scheduled-payouts/index.ts:~119-146,545-575`): an under-filled roster
  still releases once everyone owed is paid, and the leftover escrow is surfaced
  via alert rather than stranded. Heal-split-state excludes group jobs (gated on
  `allRosterPaid`, `:~560-575`).
- **No double-pay**: both payers route every transfer through
  `_shared/payoutClaim.ts`, backed by partial unique index
  `payout_transfers_one_live_per_job_helper ON (job_id, helper_id) WHERE status
  IN ('pending','paid','reversed')` (`20260831190418`). Exactly one claimant
  wins; **one reversal is isolated to its own `(job, helper)` row**.
- The three single-helper payers correctly REFUSE a multi-member roster:
  `release-payout/index.ts:155-209` (409 + critical page, roster read fails
  closed), `execute-dispute-split` (refuses group jobs),
  create-payment `admin_release_dispute`.
- `auto-release-payment` Phase 1 computes the per-helper preview
  (`budget / helpersCount`, `index.ts:435-440`); **Phase 2 already excludes
  multi-helper group jobs** from `dueQuery2`
  (`index.ts:499-520`, `.or("is_group_job.is.null,is_group_job.eq.false,helpers_needed.lte.1")`)
  — the "belongs to whoever owns those files" gap named in the fanout migration
  header IS closed. `recordFailedAttempt` divides by roster size too (`:584-587`).

Net: money is disbursed correctly per-Helpr once a group job legitimately reaches
`payout_pending`. The gap is (b) — **what authorizes it to get there**. Today one
helper (`jobs.helper_id`) marking complete would settle and pay the WHOLE roster,
none of whom needed to confirm/arrive/complete. That is a trust hole, not a
disbursement bug, and it is why (b) must land before the flag flips.

### BLOCKER (b) — per-member lifecycle + authorization (build spec)

Design decision needed from owner: **does a group job complete when ALL members
mark complete, or the first?** Recommended: **all members**; `jobs.helper_completed_at`
becomes the MAX over the roster, stamped only when every member is done (that is
the value the payout sweeps already read). One migration, so policy/trigger/RPC
never disagree:

1. `ALTER TABLE public.group_job_helpers ADD COLUMN IF NOT EXISTS` per member:
   `helper_confirmed_at`, `helper_dayof_confirmed_at`, `helper_on_the_way_at`,
   `helper_arrived_at`, `helper_arrival_verified_at`, `helper_completed_at`
   (all `timestamptz`), plus per-member `proof_before_urls` / `proof_after_urls`
   if proof is required per member. (Lint: never write the literal C-R-E-A-T-E
   T-A-B-L-E in a comment — `migration:new`, roles named, PGlite 3×.)
2. Widen the jobs UPDATE authz to roster members **and** move the completion
   gates onto the roster row: `enforce_helper_completion_gates` and
   `enforce_helper_jobs_column_whitelist` must key off "is `auth.uid()` a roster
   member of this job" instead of `OLD.helper_id`, and enforce arrival/proof/
   30-min **per member** (`20260828011057_...:219-252`). A roster member marking
   their own completion writes their `group_job_helpers` row, not `jobs`.
3. `mark_helper_arrival` / `helper_mark_on_the_way` / create-payment
   `action:"release"`: authorize on roster membership; write the per-member
   column; derive `jobs.helper_arrived_at` etc. as the roster MAX/appropriate
   aggregate for the poster's tracker.
4. Derive `jobs.helper_completed_at` = MAX over roster, stamped only when every
   member is complete — this is the single event that lets
   `auto-release-payment` move the job to `payout_pending` and hand it to the
   fan-out payer. Until then the escrow stays held. Confirm the tracker/poster UI
   shows N-of-M progress (`GroupJobHelpers.tsx` already renders roster progress).
5. In the SAME migration, `DROP TRIGGER trg_reject_new_group_jobs`
   (`20260902035641_...:238`) so new group jobs can be created — but only once
   1–4 and (d) are proven.

### BLOCKER (d) — review model (design decision + schema)

Design decision needed: **who reviews whom on a crew?** Recommended: poster
reviews each Helpr, each Helpr reviews the poster.

- Change `UNIQUE (job_id, reviewer_id)` → `UNIQUE (job_id, reviewer_id, reviewee_id)`
  (`20260311000404_...:198`). This changes the inputs to: the trust ladder / tier
  calc, the double-blind reveal (`20260506192638`), the review-nag cron, the
  "Users can create reviews for eligible jobs" INSERT policy, and
  `enforce_review_validity` (`20260904211812_...:44`) — all of which read scalar
  `jobs.helper_id` today and must read the roster. Move all together.
- Note (correcting the record, from `20260902035641_...:288-294`): `can_review_job`
  does NOT gate the review UI — the chips read `job.payment_status` directly
  (`AppliedJobCard.tsx:494`, `PostedJobActions.tsx:725`). The real blockers are
  the INSERT policy + `enforce_review_validity` trigger.

### Prod checks for the lead (needs live DB — this run could not run them)

1. Confirm blast radius unchanged since 2026-09-01: `jobs` group rows still 2,
   both `is_seed`; `group_job_helpers` still 0 rows; `payout_transfers` no
   multi-helper rows. (read-only `execute_sql`.)
2. Before any (b) work: `pg_get_functiondef` on `enforce_helper_completion_gates`,
   `enforce_helper_jobs_column_whitelist`, `mark_helper_arrival`,
   `helper_mark_on_the_way`; `pg_policies` for the jobs UPDATE policy — verify
   they still match the source line refs above (deep audits verify by object
   state, not migration text).
3. Before any (d) work: confirm the live `reviews` unique constraint is
   `(job_id, reviewer_id)` and enumerate every reader of `jobs.helper_id` in the
   review/trust path.
4. PGlite 3× any migration; `lh-money-escrow` + `lh-authz-rls` REVIEW ONLY on the
   (b)/(d) diffs before landing; only then flip `GROUP_JOBS_ENABLED` and DROP
   `trg_reject_new_group_jobs` in the same commit.

## RESOLVED: Vercel "Account is blocked" (2026-09-14 16:13–17:52 PDT)
- [x] RESOLVED 2026-09-14 ~17:52 PDT (owner upgraded to Pro; cause: Hobby Edge Requests 3.1M/1M + Deployment Storage 34 GB/10 GB, see the Vercel item further down). Was: OWNER (dashboard only): every push since 4bbd125c1 (16:13 PDT) gets Vercel status `failure — Account is blocked.` (https://vercel.com/knowledge/why-is-my-account-deployment-blocked). Hobby team `louisianahelprs-projects`. Live site still serves 70f93a220 (14:30 PDT); NOT live: a0833ef22 TrackingMap pins, 3c299b328 completeJob duplicate-release fix, f9f5b0617 (package.json). Open Vercel → team → Usage / notifications for the reason (Hobby usage limit or fair-use), resolve, then redeploy main. Prod freshness runs time out red until then; that red is this, not the commits.
- [x] VERIFIED 2026-09-14: cc2636f5f deployed (Vercel status success 00:53Z); live build-commit = cc2636f5f; a0833ef22, 3c299b328, f9f5b0617 are ancestors, so all live. Was: After unblock: confirm `<meta name="build-commit">` on www.louisianahelpr.com is at or after the newest shipping commit. Consider stopping preview deploys for non-main branches (every lane branch push builds a preview and counts toward Hobby limits).

## Discarded PostgREST builder calls — branch `discarded-query-filters` (2026-09-15, routine)
Reported as "AdminAnalytics drill-downs never filter by payment status". **The
premise did not hold and the report is corrected, not repeated:** against the
installed @supabase/postgrest-js 2.112.4 a filter MUTATES the builder and
returns `this` (`dist/index.mjs:1688`), so the discarded `query.in(…)` at
`AdminAnalytics.tsx:235-236` was in fact filtering — proven by a recording-fetch
test that reads the request URL, not by a code read. Fixed anyway (reassigned):
the shape is correct only by mutation and leaks filters onto every alias of the
same builder.
- [x] The same scan found a defect that is NOT version-dependent:
  `JobTracking.tsx:699` did `void supabase.from("job_tracking").update(…).eq(…)`
  with no `.then()`. A PostgrestBuilder fetches inside `then()`, so every
  en-route position update after the watch started was never sent — the poster's
  live map held whatever the row last said. Sixth instance of a class this repo
  has fixed five times before (useMessagesData:440, useMessagesRealtime:71,
  AdminReports:250, send-push-notification, cash-out-credits). Fixed with the
  house `.then(({ error }) => report(error))` pattern; still non-blocking.
- [x] Class check: `scripts/check-discarded-query-filters.mjs` (TypeScript
  compiler API, reusable by ESLint/CI, `npm run check:discarded-filters`) +
  `src/test/discardedQueryFilters.test.ts`. Red on origin/main d492446 (exit 1,
  all 3 sites), green after. Covers filters, modifiers, writes and bare `rpc`.
  Opt-out marker: `discarded-builder-ok: <reason>`.
- [ ] **Merge `discarded-query-filters` into main.** Held off main because
  branch `offer-privacy` also edits AdminAnalytics.tsx; the AdminAnalytics edit
  is 3 lines (`const`→`let` + two reassignments) to keep that merge trivial.
- [ ] Not verified in this container: `npm run typecheck:edge` (no Deno
  installed) and prod behaviour of the en-route map. The tracking fix wants one
  real en-route journey on prod before launch — it changes what the poster's map
  shows, and no test can see that.

## HANDOFF 2026-09-15 — map notes + nightly reds (session closed)
Orientation: `~/.claude/projects/-Users-lexilombas-louisianahelpr/memory/handoff-2026-09-15-map-and-nightly-reds.md`.
Landed and live on prod: VN-9, VN-10, VN-11 (tracker Fixed + Confirmed, shots
committed, verified in the deployed bundles). All four `nightly-red` issues
root-caused; seven stale test assumptions fixed, each checked against live prod.
- [ ] **Pick up:** watch the re-run chain to green — nightly-webkit (was running
  at handoff), then a11y-webkit-prod, then e2e-journeys. **ONE AT A TIME**: they
  share `concurrency: prod-load` with `cancel-in-progress: false`, so a second
  queued run cancels the first, and a "cancelled" there is not a failure. The
  issues close themselves on green; they cannot be ticked by hand.
- [ ] **Decide (3):** the 9 auth-timeout presses below; the Browse header
  over-count above; and whichever visual-note entries remain.
- Trap: never pre-create `~/.lh-browser.lock` — Playwright's globalSetup takes
  it, and taking it first deadlocks the run against itself.

## holes-2026-09-15 (authz-rls) — storage buckets
- [x] DONE 2026-09-15 on `fix-storage-buckets` (migration 20260915055517_storage_bucket_limits): H-003 — the PUBLIC `job-photos` bucket shipped with no `file_size_limit` and no `allowed_mime_types` (an unbounded, arbitrary-type, world-readable file host); `marketing-media` and `social-posts` had the same gap. The migration caps all three: job-photos → 50 MB + image (jpeg/png/webp/gif) **and** scope-video (mp4/quicktime/webm) types, kept PUBLIC (served via `getPublicUrl` in useJobMediaUpload/ReviewForm/imageUrl); marketing-media → 8 MB + jpeg/png/webp, kept PUBLIC (Instagram fetches server-side, can't use a signed URL); social-posts → 8 MB + jpeg/png/webp. INSERT policies untouched — the flagged `job-photos` `[1]=auth.uid()::text` branch writes under the caller's OWN uid (not cross-path) and is LIVE for review photos at `<uid>/reviews/…`, so deleting it would break ReviewForm; the size/MIME cap is what neutralises the exposure. Private document buckets (id/user-documents) left uncapped on purpose — complete-signup uploads under service role with a documented `application/octet-stream` fallback that an allow-list would reject. Class check: `src/test/storageBucketLimits.test.ts` replays the migrations and fails on any public bucket with a null limit (proven RED on the pre-fix tree for job-photos/marketing-media/social-posts). LEAD to verify on prod: an oversize / wrong-MIME upload to job-photos is rejected, and existing job photos still load.
- [ ] GAP (report only): scope-video uploads (`useJobMediaUpload`, UI says "30s max") have NO client-side size or duration guard — only `accept="video/*"`. The new 50 MB bucket cap is the only ceiling; a longer/high-bitrate clip now fails at the bucket with a raw storage error instead of the app's own copy. Add a client `VIDEO_UPLOAD_MAX_BYTES` guard (like profile-videos) and/or compression.

## press-every-control — re-run 2026-09-15, 237 failed presses in 4 shards
Coverage was 100% (0 undocumented skips); these are presses that fired and then
tripped a check. Three classes, in order of how many:
- [x] **22 x `400 GET <helper-uuid>/avatar.png`** — FIXED at the source. The
  helper test account's `profiles.avatar_url` ended in `avatar.png` while
  storage held `avatar.jpg` (uploaded 2026-09-13), so every screen rendering
  that avatar fired a 400 and any press on such a screen failed on console
  noise. Corrected the row to the file that exists (test-owned record, one
  UPDATE, verified 200 after). A repo-wide check for the same class found no
  other profile pointing at a missing object.
  - [x] ANSWERED — and the first answer (02a4f9fbd) NAMED THE WRONG WRITER.
    It blamed `scripts/audit/prod-seed.mjs` for insisting on `avatar.png` and
    said "no real-user path writes a row that points at a missing object". Both
    halves were wrong, and the second one is the dangerous half: it closed the
    class while it was still open.
    THE WRITER WAS JOURNEY J7's CLEANUP (`e2e/journeys/03-account.spec.ts`). J7
    changes the photo through the crop dialog, which always produces a JPEG — so
    the app wrote `avatar.jpg` and, by design, deleted `avatar.png` — and the
    cleanup then PATCHed the row back to the `avatar.png` URL it had remembered
    from before the run. A row pointed at an object its own run had just deleted.
    The seed then made it worse rather than caused it: it wrote a HARD-CODED
    `…/avatar.png` into the row and `--verify` demanded `.png` back.
    AND REAL USERS COULD REACH THE SAME STATE, four more ways, because the old
    object was deleted BEFORE the row moved: Profile.tsx (upload + delete, then
    an update with no `.select()`), CompleteProfile via `uploadProfileFiles`
    (whose row write can fail on a contact-leak bio, 23514), `complete-signup`
    (sweep, then five early returns and the profile UPDATE), and `accountPurge`
    (avatar object deleted before `purge_user_data` cleared the row).
    FIXED on branch `avatar-divergence`: every path is now upload → CONFIRMED row
    write (`.select(...)` + `unwrapMutation`) → sweep, the sweep keeps whatever
    the row names at that instant, and the purge clears `avatar_url` first. The
    class check is `src/test/avatarRowObjectAgreement.test.ts` — red on
    origin/main naming all 7 sites (`AVATAR_AGREEMENT_ROOT=<pre-fix checkout>`),
    green on the branch.
  - [ ] **After `avatar-divergence` lands, run these three against prod**
    (nothing here is verified until they pass):
    1. `node scripts/audit/prod-seed.mjs --verify` → the row
       `helper avatar_url resolves` must be ok (it replaces the old
       "helper avatar file + avatar_url", which demanded `.png` specifically).
    2. A test-account purge → the `avatar_pointer` step must be present and
       `ok: true`, ordered BEFORE the storage purge.
    3. `HEAD <a test account's profiles.avatar_url>` → 200.
  - Silent-failure review of the branch (`lh-silent-failure`, review-only).
    Fixed on the branch: `Signup.tsx` now surfaces `complete-signup`'s
    `staleAvatarObjects` (the edge function had returned it all along and no
    client had ever read it — the sweep's one user-visible signal, on the public
    bucket that has twice held an identity document, went nowhere);
    `prod-seed`'s `resolvingAvatarUrl` no longer reads a timeout or a 5xx as
    "the object is missing" and then repoints the row on it; a FULL `list()`
    page is reported as unreadable rather than clean in both sweep twins; and
    the class check's B1 no longer accepts any call named `write` as the row
    write. Left open, with reasons:
  - [ ] **The purge's "Nothing is lost" is not true, and predates this branch.**
    `purgeAccount` deletes identity storage (ID scans, the avatar object) in
    step 4 of 7, and steps 5-7 plus `auth.admin.deleteUser` can each abort after
    it. The user is then shown "Nothing is lost — please try again" on a live
    account whose documents and photo are already gone. The branch's new
    `clearAvatarPointer` sits just before that delete and is outside the abort
    gate ON PURPOSE (the deletion is the legally-required act; a stale pointer
    is a rendering defect, not a privacy one) — and it makes the aborted state
    strictly better than before, "no photo" instead of a 400 on every screen.
    So this is not a regression, but the copy is still a lie. Decide: make the
    message name what was already removed, or move the irreversible storage
    purge after every step that can abort.
  - [ ] **`uploadProfileFiles`'s 120s `withTimeout` can report a save that
    COMMITTED as a failure.** `withTimeout` is a `Promise.race`: it rejects, it
    does not cancel. If the timer fires after `saveRow` commits, the member is
    told "File upload timed out" on a profile that saved, and re-submits the
    whole form. Same class as the two 60s timeouts it replaced, so not new —
    but the save is now inside the raced promise, which widens it. Fix is to
    let the inner `withTimeout(..., "Profile save")` own the save and drop the
    outer bound, or to resolve with `saved` when it is non-null on rejection.
  - [ ] **J7's `resolvingUrl` conflates "could not check" with "gone"**
    (`e2e/journeys/03-account.spec.ts`), the same shape just fixed in
    prod-seed. Restore side is fail-safe (the run's own photo resolves, so the
    skip self-heals); the assertion side turns a network blip into a failed
    journey. Give it the same tri-state treatment on the next journeys pass —
    not done here because journeys run against prod and could not be exercised
    from this session.
  - [ ] **The class check's `set[A-Z]` exemption is broader than its comment.**
    `avatarRowObjectAgreement.test.ts` excuses any `avatar_url` written inside a
    callee matching `/^set[A-Z]/` as "React state mirroring a write already
    made". `setProfileRow({ avatar_url: rememberedUrl })` would pass unchecked.
    Narrowing it risks false positives on legitimate `setProfile(prev => …)`
    call sites, so it wants a real look rather than a quick regex.
- [x] **11 x "Notifications › All" — no observable change** — FIXED in the
  harness (02a4f9fbd): pressing the tab you are already on is supposed to do
  nothing, so it now reads aria-selected / aria-pressed / aria-checked /
  data-state=active / aria-current BEFORE the click and excuses a no-op only
  for a control already in the state the press asks for.
- [ ] **9 x `[auth] admin role lookup failed — role state is UNKNOWN: Profile
  request timed out`** — DELIBERATELY NOT SILENCED. It is prod saying a profile
  read exceeded its budget under a four-shard sweep. Muting it in the harness
  would delete the signal. Decide: raise the profile-read timeout, make the
  auth layer log a timeout below error level, or accept the red under sweep
  load. Until then press-every-control stays red on these alone.
- [ ] A handful of "control not found on a freshly loaded page (transient or
  non-deterministic)", including two fixture jobs named `[E2E DO NOT ACCEPT] J
  z8/z9` — a fixture-timing race, not a control.

## Nightly reds — worked 2026-09-15, what is left
- [x] Root-caused all four open `nightly-red` issues. THREE (e2e-journeys #1595, a11y-webkit-prod #1597, press-every-control #1582) died on Supabase auth returning **HTTP 522** for that whole window — nothing could sign in. Auth verified healthy since (bad-credentials probe returns 400 invalid_credentials).
- [x] Six stale test assumptions fixed underneath them, each verified against live prod, not guessed (2eb1e4416, 18c1169d5, 8874b3ef4): messaging closes 24h after completion so "any funded job" picked a closed thread (403/42501); `payout_transfers.amount` does not exist, it is `amount_cents` (400/42703, which meant an authz assertion could not tell a leak from a typo); the Browse search field is an ARIA combobox now, not a searchbox; availability saves through the `save_weekly_availability` RPC, not a table POST; `page.mouse.wheel` does not exist in mobile WebKit (6 of nightly-webkit's 17 failures); and Escape on the Edit sheet raises a "Discard Your Changes?" guard rather than closing.
- [x] Apply Now measured 41.8px = 44 x the dialog's `zoom-in-95` entry scale — a mid-animation read, not an undersized button. The spec now waits for the dialog's geometry to stop moving; a genuinely short button still fails.
- [x] The dark-mode contrast defect nightly-webkit reported (#d46735 on #382b27, 3.75:1) was already fixed by ffc34e162, which landed AFTER that nightly ran.
- [x] Local WebKit re-run of the three affected specs: **27 passed, 1 failed**, and that one is now fixed too. The 1440-light/dark timeouts CI reported do NOT reproduce locally — treat them as CI contention until they recur.
- [ ] **Dispatch one at a time.** Every prod-touching workflow shares `concurrency: prod-load` with `cancel-in-progress: false`, so queuing three at once CANCELS the later ones — that is why a11y-webkit-prod showed "cancelled" twice on 2026-09-14, and it is not a failure of that workflow.
- [ ] Re-run to green and let the sync step close the issues: nightly-webkit, then a11y-webkit-prod, then e2e-journeys (press-every-control was still running at handoff).

### The 2026-09-15 re-runs, root-caused (a11y-webkit-prod 34925526605, nightly-webkit 34924529210, e2e-journeys 34927100318)
- [x] **a11y-webkit-prod's zz gate: prod WAS slow, and the app threw away the answer it did get.** Both engines captured the ProtectedRoute card in the SAME 16s window (webkit 47 customer-activity @ /activity 03:43:19-37, chromium 83 helper-profile-reviews @ /profile?tab=reviews 03:43:19-35) on different accounts. Prod-side proof, since the Supabase API logs need a token this session cannot reach: `cron_run_log` start lag over 278 pg_cron starts since 09-13 is p50 0.18s / p95 0.56s / p99 0.61s, with exactly TWO outliers — 09-13 06:23:05 and **09-15 03:43:04.6** — so the scheduler itself was starved in that window. The timeout is NOT too tight: as helper-e2e/poster-e2e on prod just now, the same `profiles?select=*&user_id=eq.…` read is p50 150-200ms, max 2.0s (20 samples each), against a 6s per-attempt budget. The retry is NOT missing either (one client retry, 500ms). What WAS broken is in the app: `withTimeout` stops waiting but cannot cancel, so the in-flight read was abandoned. Measured on prod data (local preview, WebKit, /activity, first read answers at +8.3s, later reads hang): **error card at +12.9s** — the real row had arrived at +8.3s, inside the ~12.5s budget, and was discarded. `useCurrentUser` now carries a timed-out read into the retry and takes whichever answers first (2s reuse window, so an unrelated later refetch can never be handed a pre-edit row). Re-measured: **no card, /activity renders (h1 "My Posts")**. Guards: three new cases in `src/hooks/useCurrentUser.test.tsx`, the key one red on the old code (`expected true to be false`). Screenshots reviewed + review-logged (before/after).
- [x] **nightly-webkit group 3 (stale-deploy /browse, /profile "warm, guard NOT armed"): a real app defect, and it is NOT f5bf06ec8.** Reproduced deterministically on the preview build in WebKit with an in-page MutationObserver: `vite:preloadError` → `recoverFromChunkError()` starts the reload → main.tsx calls preventDefault() → Vite resolves the import with `undefined` → React.lazy throws a plain TypeError ("undefined is not an object (evaluating 'e._result.default')") → RouteErrorBoundary painted **"This page hit a problem." at +15ms** and reported it, then pagehide at +37ms. So the error card (and a false error_logs/Sentry row) flashes before every automatic stale-deploy recovery — the exact flash `recovering` exists to prevent — and the spec's poll caught it, then read a blank body mid-reload. f5bf06ec8 only bounds the purge steps and refunds an offline attempt; it cannot make the card appear. Fix: `chunkReload` exposes `isRecoveryReloadInFlight()`, and RouteErrorBoundary renders its quiet reloading state (and reports nothing) while a reload is on its way. Guard `src/components/RouteErrorBoundary.recoveryInFlight.test.tsx` (2 cases incl. a control that still shows the card + reports), red on the old component.
- [x] **nightly-webkit group 1 (activity-card-density + device-pass-measure @1440 timing out ~36s): the harness was rendering a screen no device has.** `happy-path-webkit` is the iPhone 13 profile (deviceScaleFactor 3) and `setViewportSize({width:1440})` changes only CSS px, so those variants composited **4320x2700** pixels. CI's Linux WebKit paints in software and the cost follows pixels: the run's traces show one painted frame every 3.2-6.7s at 1440@3x on /my-posts and /my-jobs against 1.1-1.6s at 375@3x, so each click's stability check (two frames) took 7-10s. 1440 variants now use `desktopScaleFor()` (deviceScaleFactor 2 — desktop Safari/iPad, and what a 1440 screen really is); probed: 1440 now backs 2880x1800, 375 still 3x. Local WebKit after: 41 passed (activity-card-density + device-pass-measure).
- [x] **nightly-webkit group 2 (nav-hide-on-scroll, 5 tests) is a measurement bug, not a dock bug.** The run's own trace shows the app DID hide the dock after the second scroll step (`aria-hidden="true"`, `inert`, inline `translateY(calc(var(--safe-area-bottom,0px) + 130px))`), while `getComputedStyle().transform` still read 0 — the 0.28s transition only advances on a rendering update, and the screencast painted no frame for 1.6s around that read. The spec now polls the painted offset (`expectDock`) instead of sampling once after a fixed wait; a dock that never hides still fails at the timeout. Local WebKit: 6/6.
- [x] **nightly-webkit group 4 (zz-recurring-picker):** same rendering-update cause. @1440 it was the 3x pixel cost (fixed by `desktopScaleFor`); @375 the flake was a mid-transition colour read (`rgba(0,0,0,0) | rgba(0,0,0,0) | rgba(255,255,255,0.55)` — two settled chips, one still unselected), now polled to a settled single fill.
- [x] **e2e-journeys, 4 groups, all verified against live behaviour.** (a) 01-browse "switch to the map and back": picking a Feed view CLOSES the filter sheet — verified on prod through the local preview (dialog gone <100ms after the Map tap) — so `if (visible) click(close)` raced a detaching button and burned 20s; a shared `closeFilterSheet()` waits for the sheet to go, and Clear All is now reached by reopening it. (b) 03-account availability: **prod really did hold 0 weekly rows for helper-e2e** (live REST), left behind by an older DELETE-then-POST restore in this very spec; restored on prod through the app's own `save_weekly_availability` RPC (0 → 7 rows, RPC returned 7), and the spec now seeds an empty week instead of failing on it, restores atomically through the RPC, and accepts the RPC on the *second* save wait too (that one was still table-only). (c) keyboard-focus DOB wheel: the inventory selector matched the wheel's 127 `<button role="option" tabindex="-1">` options — elements the a2 step asserts are OUT of the tab order — so it walked 130 stops, timed out on `nth(47)` of a list the wheel had re-rendered, and (once handles fixed that) ended with the picker closed. It now takes real keyboard stops only: 4.6s local, was 5.0m in CI. (d) 02-marketplace do-the-job "completion never recorded": every button had been pressed and the failure shot shows the **Location rationale dialog still open** — `updateStatus("done")` asks for location on its way out and "Not Now" is deliberately not remembered (`usePermissionRationale` marks a kind confirmed only on yes), so the spec now answers it there as it does at Start Working. 02-marketplace webkit also hit **Stripe's own "Something went wrong" page** (their words: network / expired link / provider unreachable) and then waited 60s for a card field; `payOnStripeCheckout` now reloads the session once and, if Stripe errors again, names Stripe instead of our form.
- [ ] REPORT (not changed): Activity is the app's most expensive screen to composite — 15 `backdrop-filter` layers on /my-posts (a `liquid-glass` panel plus one per card, nested) against 5 on /dashboard, which is why only Activity crossed the timeout. On a GPU it is invisible; on software rendering it is ~3x /dashboard. Worth an owner decision (dropping the per-card backdrop inside an already-frosted panel changes nothing visible on a real device but is a visual change, so it is not being made here).
- [ ] REPORT (not changed): ErrorBoundary and SectionBoundary still render their error copy while a recovery reload is in flight (they only skip the report). Same class as the RouteErrorBoundary fix above; they are not what any red run caught.
- [ ] REPORT (not changed): running the whole 02-marketplace chain locally (WebKit, prod backend) stopped at Stripe's Pay button staying DISABLED with Google's address-autocomplete dropdown open over the billing fields — a local-only manifestation of the same third-party form CI pays on routinely (the chain's teardown cancelled its job: 7b9b56bc, cancelled/cancelled). The do-the-job location-dialog fix is therefore proven from the CI artifact, not from a local pass of that step.
- [ ] REPORT (not changed): stale-deploy's cold-load case can race its own start page — once chunks are blocked, a deferred prefetch on /terms can trigger ITS recovery reload and interrupt the spec's `goto` ("Navigation to /signup is interrupted by another navigation to /terms?_v=…"). Seen once in 42 local tests, never in CI.

## Owner visual notes 2026-09-14 (53 entries)
- [ ] Work through `docs/audit/visual-notes-2026-09-14.md`. Its Tracker table is the per-entry checklist: Fixed needs a commit on main, Confirmed needs a committed screenshot + "ok" review recorded after the fix. Guard: `npm run visual-notes:check` (proven red on a fake tick; unit test `src/test/checkVisualNotes.test.ts`). 2026-09-14: 31 entries Fixed, 30 Confirmed with before/after screenshots (VN-1,2,5-13,17-19,25-28,30,31,34-36,38,40,42,43,47-49,53, map VN-9-11 from the map terminal; VN-30 fixed, not yet seen on screen — no review-pending test job). Medium/large and design-discussion entries (VN-3,4,14-16,20-24,29,32,33,37,39,41,44-46,50-52,54) not started; VN-37 in progress in a separate terminal.

- [x] **Map entries done 2026-09-14: VN-9, VN-10, VN-11** — Fixed and Confirmed in the tracker with committed screenshots (`docs/audit/visual-notes-2026-09-14/`), driven against prod from a local preview build because prod deploys are blocked. VN-10 needed two commits: the second BrowseMap (the desktop split map in Dashboard.tsx) had its own copy of the handler and stayed a dead tap after the first fix — both now share `openJobFromPin`. Side-finding filed below: the Browse header over-counts the rendered list.

- [x] CLOSED 2026-09-14. Owner decisions 2026-09-14 (pop-up), visual-notes follow-ups: (1) server refuses disputes on a completed job (open_dispute_as; migration, money review before merge); (2) Mark Job Complete confirm popup reads "Mark This Job Complete?" with a "Mark Complete" button; (3) JobConfirmation "Can't make it? See what happens" link reads "Cancel Job"; (4) done is final — NO help/support link on done cards, and Help Center must not tell users to contact Support about a done job. PROOF: (1) c4ebb5d83, migration `20260915025607_block_disputes_on_completed_jobs`, db-deploy run 34924689542 success; prod `schema_migrations` has 20260915025607; live `open_dispute_as` prosrc contains the guard (raise at char 2151, after the party check at 1552, before the existing-dispute branch at 2338); proacl unchanged `{postgres=X/postgres,service_role=X/postgres}`, rpc_open_dispute unchanged `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`. helper-e2e (437de07d, the job's Helpr) called `rpc_open_dispute` on completed seed job 5eed0a10-0000-4000-8000-000000000010 → HTTP 400 P0001 `job_already_completed`; before/after identical (job xmin 2192761, status completed/released, 0 disputes, 3 job notifications, 25 admin dispute notifications, 0 fraud flags, 0 disputes created in the last 15 min), nothing to clean up. PGlite probe `scripts/probes/dispute-on-completed-job.probe.mjs`: hole reproduced on the live shape, green after 3 applies, 6 broken copies caught. Guard test `src/components/disputeFiling.test.ts` red without the migration. Money review (lh-money-escrow): diff correct; the pre-existing table-write bypass it found is the next line. (2) b831aa934, (3) 68f758f7c, both pinned by `src/components/confirmPopupCopy.test.ts` (red on the old strings); e2e 02-marketplace clicks "Mark Complete". (4) 11c1edd94: Help Center dispute answer says a job marked done is final and Report a Problem is available while the job is in progress, no Support mention, no link (`src/pages/HelpCenter.test.tsx`, red on the old copy). Done cards already carry no help/support link (grep of activity cards). Gate: typecheck green; full vitest 424 files / 4475 passed.
- [x] CLOSED 2026-09-14. Done is final, the TABLE door (money review of 20260915025607). Migration `20260915033734_dispute_markers_server_owned` (commit 9d6443208, db-deploy run 34928544962 green): a non-SECURITY-DEFINER BEFORE INSERT OR UPDATE trigger on jobs. A direct client write (current_user authenticated/anon, not admin) may not move status into/out of 'disputed' or change disputed_at / disputed_by / dispute_deadline / dispute_resolved_at / dispute_status (one exception: the assigned Helpr answering an open dispute they did not file, -> 'helper_responded'); on INSERT those markers are cleared. SECURITY DEFINER RPCs, service_role and cron are untouched. Found beyond the original item and closed in the same trigger: helper re-pointing disputed_by / de-escalating so auto-resolve pays them, either party moving status out of 'disputed', dispute_deadline pushes, and the INSERT door (a job created already carrying disputed_at; found by both reviewers). Dead `DisputeDialog.tsx` PGRST202 fallback removed. PROOF: `scripts/probes/dispute-table-door.probe.mjs` (live-shaped PGlite: red on the live shape, green applied 3x, 14 broken copies caught, skip + loud paths); CI class guard `src/test/disputeMarkersServerOwned.test.ts` (red on the original fallback payload). PROD, seed account poster-e2e (Perry Poster, non-admin) on its completed seed job 5f20df1e-9037-4502-9d4b-90b98deadb4a: PATCH disputed_at -> 403 42501 "jobs.disputed_at is set by the dispute RPCs, not by the client"; PATCH status=disputed -> 403 42501; row before and after identical (xmin 2193058, status completed, payment_status released, all markers NULL, updated_at unchanged). Live trigger function md5(prosrc) b1f276e3... equals the migration file; the dispute RPCs' md5s equal the probe fixture's, so the in-progress/abort/escalate/withdraw/decide paths proven green in the probe are the deployed ones. Reviewed by lh-money-escrow and lh-authz-rls (no blockers after fixes). ADDED 2026-09-15 (broader class guard for this whole column class, beyond the source-side disputeMarkersServerOwned test): `src/test/jobsStateColumnGuard.test.ts` enumerates EVERY client-writable jobs money/state column from the live whitelists (types.ts inventory) and fails if one has no transition guard — shown red on a fake `payment_status` added to the helper allow-list; and `scripts/check-jobs-dynamic-writers.mjs` (live pg_proc, wired into db-drift-detect) fails if any client-callable SECURITY DEFINER function writes jobs from a caller-supplied column list or JSON patch (the trust the current_user guard rests on) — shown red via --inject-fake. Re-verified the round-5 helper attack (dispute_status escalated->open) refused on prod against the live guard, rolled back. dispute-races migration 20260915034822 replayed after 20260915033734 in PGlite: open/withdraw/escalate/decide/supersede all still work for their callers.
- [x] CLOSED 2026-09-15 — this is the same finding as the CRITICAL open_jobs_browse entry near the top of this file (migration 20260915041247, sha 59c8a9d91): `REVOKE ALL` on the view, `GRANT SELECT` kept; live class check `scripts/check-updatable-views.mjs` in db-drift-detect; verified live rolled-back (anon DELETE / stranger UPDATE both 42501, reads still work, ACL now anon=r/authenticated=r); no exploitation found. (found by lh-authz-rls reviewing 20260915033734, 2026-09-14).
- [ ] Dispute follow-ups still open after the table-door fix (reported, not changed): (1) either party can still rewrite `jobs.dispute_reason` / `dispute_evidence_urls` / `dispute_helper_response` at any time, and `AdminDisputes.tsx:151` reads `jobs.dispute_reason` (the pinned copy is `disputes.reason`), so the text an admin decides on is editable (no money moves); (2) the disputes opener can still append evidence on a completed job via the "disputes opener update while open" policy; (3) cancelled jobs are refused by the status matrix only after the disputes INSERT with raw text; (4) `ActiveJobSection.tsx:164` maps only not_abortable, so job_already_completed from a racing helper abort shows a generic toast; (5) `supabase/functions/auto-resolve-disputes/index.ts:531-535` comment says status / dispute_status / dispute_resolved_at are writable by a party to the job; no longer true since 20260915033734 (logic keyed on payment_status is still right).
- [ ] Plus has no Priority Placement in the browse feed: live get_ranked_open_jobs (newest 20260913014328) bumps Elite 5 / Pro 2.5 and ignores 'plus', so the perk Plus inherits from Pro does nothing in ranking (found by VN-44 lane).
- [ ] Visual-notes 2026-09-14 side-findings (lane D/VN-45/VN-54, reported not changed): profile "Worked together" counts every shared job, not completed ones (Hallie shows 44 vs 16 completed); disputed Helpr card still shows the "Add a before photo" ask; App.tsx comments claim /support /help /legal skip PageTransition (they don't); /help and /support missing from NATIVE_APP_SHELL_ROUTES; served HTML has two <link rel="manifest">; /favicon.ico is PNG data. VN-45: the 2 orphan referral_credits rows on the owner account were deleted with owner OK; money tiles vs referral count still read different sources. VN-54 verified live (business_name only when license/insurance admin-verified), owner confirmed — closed.
- [ ] **QUEUED (branch `fix-completion-columns-v2`, not yet landed — supersedes `fix-jobs-completion-columns`): completion columns server-owned (H-001, H-002, 2026-09-15 authz hole hunt).** H-001: the assigned Helpr passed every completion gate then PATCHed a BACKDATED `helper_completed_at`, making the job instantly due for `auto-release-payment` and erasing the poster's 24h window. H-002: a poster PATCHed `status='completed'` directly (status on neither poster-lock list; `enforce_job_status_transition` allows in_progress→completed), stranding the escrow outside every sweep. Fix, mirroring the live dispute-marker trigger: (1) `rpc_helper_mark_done(_job_id)` SECURITY DEFINER runs the same gates+write server-side, stamps `helper_completed_at=now()` once, returns `poster_completed_at` (grants: FROM PUBLIC, anon; EXECUTE authenticated); JobTracking's Done calls it (PGRST202 fallback to the legacy direct stamp for the merge→deploy window). (2) `enforce_job_completion_server_owned` BEFORE INSERT/UPDATE trigger `zz_jobs_completion_server_owned`: a non-admin client (`current_user` authenticated/anon) may not push status→completed nor change `helper_completed_at` at all; the RPC runs as postgres and passes. Migration `20260915073143`. Closes the KNOWN_OPEN `poster:helper_completed_at` / `offered:helper_completed_at` pairs in `src/test/jobsStateColumnGuard.test.ts` (red-first proven). Proof: `scripts/probes/job-completion-columns-v2.probe.mjs` (PGlite, holes red on the live shape, green after 3 applies, 10 broken copies caught). Lead to run the rolled-back prod probes (helper PATCH helper_completed_at → 42501; poster PATCH status=completed → 42501; RPC works for the assigned helper) and land.
- [ ] Done is final, the TABLE door (money review of 20260915025607, 2026-09-14; pre-existing, not changed): the migration closes the RPC path only. Read from live definitions (not executed): the jobs policy "Customers can update their own jobs" has no WITH CHECK, `authenticated` holds column UPDATE on status/disputed_at/dispute_status/disputed_by, no poster-side trigger locks them (`enforce_poster_jobs_money_lock`, `prevent_job_field_escalation` do not list them), and `enforce_job_status_transition` allows ('completed','disputed'). A poster PATCH of `disputed_at` on a completed `payout_pending` job stalls `process-scheduled-payouts` (pays only `disputed_at IS NULL`) with no admin-queue entry; adding `status: 'disputed'` also escapes `auto-resolve-disputes` (needs payment_status='escrow'). `DisputeDialog.tsx:166-186` (RPC-not-deployed fallback) is that exact direct write (dead code, reported). Fix direction: BEFORE UPDATE trigger refusing non-admin changes to those columns unless a txn-local flag set by open_dispute_as is on (the `app.sanctioned_cancel` pattern); prove with a rolled-back non-admin poster probe. Also minor, same review: disputes opener can still append evidence via the "disputes opener update while open" policy on a completed job (no money); cancelled jobs are refused by the matrix only after the INSERT with raw text; a helper abort racing poster completion now raises job_already_completed but `ActiveJobSection.tsx:164` only maps not_abortable (generic toast). **Mapped, with its class, on branch `rpc-error-map` (2026-09-14, not yet merged):** abort now says "This job was just marked complete, so it can't be cancelled.", closes the dialog and invalidates the activity query. Class guard `src/test/rpcErrorCopyCoverage.test.ts`: every `.rpc("X")` in src/ (TS AST) × X's latest migration definition plus every function it calls → 69 (rpc, code) pairs over 19 RPCs; each must have copy in `RPC_ERROR_COPY` (`src/lib/lifecycleErrors.ts`, read through `rpcErrorMessage`/`rpcErrorCode` at every call site) or a reasoned UNREACHABLE entry. Red before the fix: 23 codes with no copy + ActiveJobSection unwired; green after. The rest of the table-door item above stays open.
- [ ] **VN-33 arrival gate SHIPPED c6f025b66 (2026-09-14) — owner rule "both required: nearby by GPS AND poster confirms, no fallback". Lead still to screenshot; OWNER QUESTIONS below.** Migration `20260915044137_arrival_requires_gps_and_poster` (db-deploy run 34933204654 success; `schema_migrations` has it; live `mark_helper_arrival` md5 6d1b9df8…, ACL unchanged `{postgres,authenticated,service_role}`; `enforce_helper_completion_gates` is `verified IS NULL OR confirmed IS NULL` with no 2026-08-28 grandfather; triggers `trg_job_tracking_arrival_gate`, `zz_jobs_arrival_integrity`, `trg_helper_completion_gates … OF helper_completed_at, status` live; create-payment redeployed, run 34933204477). What it enforces: arrival RPC refuses far/no-fix and writes nothing; `helper_arrived_at` off the helper whitelist; Helpr completion (trigger AND create-payment release, one shared rule `_shared/arrivalRule.ts`) needs both stamps; Helpr can't write status=completed; tracker Arrived/Working/Done need the stamps and the job's own Helpr; poster can't write the arrival stamps or confirm before an arrival; a re-awarded job starts with no arrival; no-show refused once the Helpr arrived. **Prod proof (seed job 5eed0a10-…-0006 "Grocery run and pharmacy pickup", Hallie helper-e2e 437de07d):** state before = in_progress, on the way, no arrival stamps, jobs xmin 2054802. `mark_helper_arrival` from Seattle (47.6062,-122.3321) → 400 23514 `arrival_too_far` details `distance_ft=11081180` (~2,099 mi); with no location → 400 `arrival_location_required`; helper PATCH `helper_arrived_at` → 403 42501; helper PATCH job_tracking status arrived/working → 400 `tracker_requires_arrival`. After: xmin 2054802, helper_arrived_at/verified/confirmed all null, tracking row unchanged (on_the_way @2026-09-09). Nothing completed or released on prod. Completion gate proven by the live definition (above). PGlite `scripts/probes/arrival-gate.probe.mjs`: 11 holes reproduce on the live shape, green after 3 applies, 14 broken copies caught. Tests red on the old OR rule (`arrivalGate.test.ts`, `JobTracking.test.tsx`); guards in `jobsGuardRpcParity.test.ts`. Reviews: lh-money-escrow + lh-verification-credentials (2 rounds; all verification findings fixed and re-proven). Screens for the lead: /my-jobs Helpr card On the Way → tap I've Arrived far away (amber "You're about N mi from the job — get closer to mark arrived", button "Try My Location Again"); Arrived step with GPS verified, poster not yet ("Awaiting poster" caption now also on a verified arrival; Start Working disabled with the both-needed reason; map pin "Location confirmed"); Done step blocked reason; /my-posts poster card Confirm They Arrived → helper card unlocks; 375 + 1440.
  - **OWNER QUESTION — auto-release when the poster never confirms arrival.** `auto-release-payment` keys only on `helper_completed_at`/`poster_completed_at` (24h) and never reads arrival. Under the new rule a Helpr who is GPS-verified and did the work cannot mark complete until the poster taps Confirm They Arrived, so the 24h clock never starts; exits today are the poster releasing or a dispute (admin). Also the poster's arrival notice rides the `transit_updates` preference and never asks them to confirm (money review). Decide: nudge/escalate, auto-confirm after N hours of verified presence, or leave as is.
  - **OWNER QUESTION — bad map pin.** Job coordinates are one Nominatim result (`src/lib/geocode.ts`, no precision check); a pin >500 ft from the real door means a Helpr who is there can never mark arrived, and the poster sees No-Show instead of Confirm Arrival. Jobs with NO coordinates still accept any fix (0 non-seed live). Decide the fallback, if any.
  - Owner should know: the GPS half checks coordinates the phone SENDS; an assigned Helpr can send the job's own coordinates from anywhere. The poster's tap is the half that can't be faked.
  - Follow-ups (reported, not changed): shipped App Store builds show a generic "Couldn't mark you arrived" on a refusal and old copy ("that works too") — confirm which build is live; builds before 2026-08-27 write tracker Arrived directly and can no longer arrive at all. Poster can still null a live job's coordinates (collusion only). create-payment release ignores `require_photo_proof=false` while the trigger honours it (pre-existing). Revision paths can pay without arrival stamps once a poster requests a revision (server accepts request_revision on any in-progress job); undelivered-revision platform dispute + auto-resolve can pay the Helpr at 72h (money review lead). `create-payment:857-864` tells the Helpr "confirm completion to release payment" when the poster completed first. Self-hire lead (poster sets helper_id to themselves on an open funded job skips every Helpr gate; not proven; 0 live). `scripts/probes/release-race.prod.mjs` fixture now carries poster_confirmed_arrival_at.
- [ ] Visual-notes follow-ups found while fixing (reported, not changed): `src/components/JobConfirmation.tsx:382` still says "Can't make it? See what happens" (VN-18 wording); `src/lib/lifecycleErrors.ts:33` job_not_completed copy says a dispute opens once work is complete, contradicting VN-28 (no RPC currently raises it); server `open_dispute_as` still accepts disputes on completed jobs (VN-28 removed only the UI — money review); `HelperAvailabilityDisplay`, `DEFAULT_DESIGN`, the submitted-credentials query in useUserProfileData and `onReport` plumbing on My Posts are now unused; RecognitionRow still shows grey "License/Insurance pending" chips (VN-13 adjacent); VN-2 job popup shows a blank POSTED BY name for an applicant viewer (pre-existing, seen on prod).

## Earnings tab fails the a11y contrast gate — blocks any /profile push (2026-09-14)
`src/components/profile/EarningsTab.tsx:510` — `<span className="block text-ds-11 mt-0.5"
style={{ color: "hsl(var(--olivewood) / 0.65)" }}>`. axe, light theme:
**#77786f on #ffffff = 4.46:1 at 11px, needs 4.5:1** (wcag2aa color-contrast,
serious). Missing by 0.04.

Found by the pre-push `check:changed` sweep, which maps changed files to their
nearest route and sweeps it: any push touching /profile now runs this and is
refused. It is NOT caused by the change that hit it — the vn-profile branch's
whole `src/` diff is three files, adds no colour anywhere, does not touch
EarningsTab, and its Profile.tsx change is comment-only.

- [ ] Nudge the alpha (0.65 -> ~0.70 clears 4.5:1 on white) or drop to the
      solid token, then re-run
      `PLAYWRIGHT_WEB_SERVER=1 node scripts/check-changed.mjs` from a worktree
      with a /profile change. NOT done here: it is another lane's screen, and
      **VN-3 (Earnings layout, "large / design discussion first")** is open on
      exactly this tab — a colour nudge now would collide with that redesign.
- Check dark theme too: `--olivewood` is a different value there (index.css:897
  vs :527), so the fix is per-theme, not one number.
- Until then a /profile push needs `LH_SKIP_CHANGED_CHECK=1` with a
  `LH_SKIP_REASON`, which is logged to docs/audit/prepush-skips.log.

## VN-37 "content should fill that space" — OWNER DECISION, app-wide gutter (2026-09-14)
Owner, on the Profile tab pages: "reviews and other pages still have that small
gap to the left and right of content. content should fill that space."

VN-46 (Notifications wouldn't scroll) shipped and is ticked in the tracker.
**VN-37 did not, and its tracker row must stay unticked.** It was fixed once,
measured, and reverted — the fix was wrong, and the measurement says why.

Measured on prod at 1440, `.app-shell-frame` 0→1192, before any change:
- `/dashboard` `.page-panel` **48 → 1144**
- `/my-posts` `.page-panel` **48 → 1144**
- `/messages` `.page-panel` **48 → 1144**
- `/profile?tab=reviews` first card **48 → 1144**

Pixel-identical. The Profile tab pages are not inset relative to anything —
they already sit flush with every PageScaffold sibling. The attempted fix bled
the tab wrapper 12px further at `xl`, which moved Profile ALONE to x=36 and
split the shared fixed-shell family, since `src/components/AppPage.tsx` carries
that wrapper string byte-for-byte. (The "panel ~x36" in the note is that
wrapper's own border box; it paints nothing, so there was no edge to fill to.)

**The gap the owner sees is the container gutter** — `px-5 lg:px-8 xl:px-12`,
48px at xl — shared character-for-character by `src/pages/Profile.tsx`,
`src/components/ui/PageScaffold.tsx` and `src/components/AppPage.tsx`.
- [ ] OWNER: decide whether that gutter narrows, and to what at each breakpoint
      (375 is 20px and was approved on 2026-09-11 as matching Dashboard, so the
      question is really lg/xl). Changing it touches every main screen at once
      — that is the point, not a side effect. Do NOT fix it one screen at a
      time; two of the three files are outside any single screen's lane.
- Guards already in place, both proven red on the reverted change:
  `src/components/profile/profileTabScroll.test.ts` (Profile and AppPage must
  carry the identical wrapper string) and the parity assertion in
  `e2e/prod-audit/profile-tab-scroll-fill.spec.ts` (Profile tab card inset must
  equal the PageScaffold panel inset, measured in the same run — no hard-coded
  number to re-choose when the gutter changes).
- Branch `vn-profile` (not pushed) holds VN-46 + both guards + the spec.

## Browse header count disagrees with the rendered list — REPORT, not fixed (2026-09-14)
Found while fixing VN-10 (map preview card was a dead tap). Owner's screenshot
showed **"3 jobs"** in the Browse header over a list holding **one** card.
- The header prints `filters.totalMatchingCount` (`useDashboardJobsCount`) —
  a server-side `count: "exact", head: true` over `open_jobs_browse` that
  reproduces only the filters expressible on that view (Dashboard.tsx:578).
- The rendered list applies further predicates client-side that the count never
  sees: **your own posts** (`job.customer_id === userId`) and **past-dated
  jobs** (`date_needed < today`) in `useDashboardFilters.ts:256-262`, plus
  applied-to and blocked-poster rows dropped in `useDashboardData`.
- `clientOnlyNarrowing` (useDashboardFilters.ts:161) nulls the count only for
  the radius and availability filters, so those other four gaps stand.
`useDashboardJobsCount.ts:19-36` documents this as a deliberate "small
over-count, never an under-count". That trade was made against an undercount
bug, but the owner's case is the one it cannot survive: a poster browsing their
own parish sees a header counting jobs the list will never show. The same rows
are pinned on the map, which is how VN-10 surfaced.
- [ ] Decide: subtract the client-only predicates server-side (own posts and
  past-dated are both expressible on the view), or null the count whenever any
  client-only predicate is actually removing rows — the `clientOnlyNarrowing`
  mechanism already exists and just does not cover these.

## Failed list loads rendered "nothing here" + storage audit (2026-09-14)
- [x] CLOSED: bell panel said "Nothing new yet." for a poster with 313 unread during the outage. The error card was reachable only from a resolved `{ error }`: a rejected query, an errored session read (auth down → treated as signed out) and a pending/hung load (postgrest retries in flight) all fell through to the empty state. Fix: one `failLoad` path, a 15 s bound on every read, and a `listLoaded` store flag, so there is a loading row until the first successful load. Guard `src/components/NotificationPanel.failedLoad.test.tsx` was red 4/6, now green 6/6. Prod proof at 375 (poster-e2e, local preview, `rest/v1/notifications` aborted): "Loading notifications…" while retries ran, then the error card with Try again, no empty state, overflow 0 (review-logged).
- [x] CLOSED: My Posts / My Jobs error card required BOTH tabs empty, so a poster's posts hid a failed My Jobs read behind "No applications yet". The check now uses the active tab's count. Guard `src/pages/activity/ActivityEmptyState.loadError.test.tsx` was red 2/3, now green 3/3.
- [x] Messages list and Browse feed already routed failures to ErrorState. Pinned by `src/test/failedListLoadShowsError.test.tsx`; both tests go red when the view's `loadError` guard is inverted.
- [x] Storage audit, report only: `docs/audit/storage-audit-2026-09-14.md`. 10 buckets hold 95 objects, 20.3 MB. 32 orphans, 10.3 MB. `scripts/supabase-usage-check.mjs` now measures bucket bytes weekly through the Storage API (paced, 400-call cap) instead of reporting it unmeasured.
- [x] CLOSED (owner approved "Delete + fix the leaks"): 31 of the 32 orphans deleted on prod through the Storage API, each re-verified orphaned on two reads 10 min apart plus a per-object owner re-read. Log: `docs/audit/storage-orphans-deleted-2026-09-14.log`. Storage went from 95 objects / 21,330,730 bytes to 64 / 10,503,472 (−10,827,258 bytes). The 32nd, `proof-photos/76b07824…/e2e-proof-test.jpg` (784 B), sits under a LIVE user's folder, so its owner exists and it was kept. Post-cleanup dry run with the weekly rules: 0 orphans.
- [x] CLOSED: the leaks. `deleteMessage` removes its attachment first (`src/lib/storageCleanup.ts`); post-job checkout cleanup removes the job's photos first; `accountPurge` removes the media of jobs `purge_user_data()` deletes (`_shared/jobMedia.ts`, capped at 25 jobs, never blocks); the 14 users and the E2E jobs were removed by script teardowns, now fixed in `prod-seed.mjs`, `prod-lifecycle-sweeper.mjs`, `pressProdSafety.mjs` (`scripts/lib/jobMediaRest.mjs`). Guard `src/test/storageDeletionPaths.test.ts` derives every row-delete path from source: red on 028f2e308 (jobs 5 files, messages 2, users 1), green now.
- [x] CLOSED: weekly auto-delete, `scripts/storage-orphan-sweep.mjs` as a step of `supabase-usage.yml` (no new cron): two reads ≥10 min apart, 7-day age floor, identity docs need the owner gone from profiles AND auth.users, >50 files or >5% of a bucket deletes nothing and posts CRITICAL, redacted log artifact, Slack one-liner. Dispute and review photos are never swept for "user gone" (they are evidence on surviving rows). `src/test/storageOrphanSweep.test.ts`: each of two-read / age floor / caps shown red (2 failures each) with the rule removed.
- [x] CLOSED: `business-documents` bucket deleted via the Storage API (verified empty, no code reference, no storage policy left; its policies were dropped in 20260828011811).
- [x] OWNER DECIDED 2026-09-14: the per-bucket cap trips only when a bucket's orphans are BOTH more than 5 files AND more than 5% of the bucket (`checkCaps`, `DEFAULTS.maxBucketFiles = 5`, `scripts/lib/storageOrphans.mjs`). A tiny bucket with 1–5 orphans is cleaned; 6+ that are also over 5% still deletes nothing and alerts CRITICAL. `src/test/storageOrphanSweep.test.ts` new cases red (2 failures: 1 orphan of 4, 5 of 5) on the old rule, 32/32 green now.
- [x] OWNER DECIDED 2026-09-14: `accountPurge` keeps REFUSING the account deletion when identity-file removal fails, as it does now. No change.
- [x] CLOSED (fix): voice notes could neither be uploaded nor deleted. Verified live first: the INSERT/DELETE policies compared `foldername[2]` (the job id in `voice-notes/<jobId>/<senderId>/…`) to `auth.uid()`, prod returned 403 RLS for a voice-notes path, and behind that the bucket allowed no audio MIME at all (415 for `audio/webm;codecs=opus` and `audio/mp4`). Migration `20260914200051`: voice-notes branch on [3], upload also requires `can_message_in_job` on the path's job (so a job id equal to a uid, or a job you are not in, satisfies nothing), bucket allows the four exact MIME strings `useVoiceRecorder.ts` can produce. PGlite 3x: `scripts/probes/message-attachments-authz.probe.mjs` (red on the previous policies, green after).
- [x] CLOSED (fix): SECURITY, cross-user attachment read. Verified live: the `messages` INSERT policy did not constrain `attachment_url`, and on prod helper-e2e inserted a message in its own job naming a file poster-e2e uploaded to a job helper-e2e is not in, then signed and downloaded it (bytes equal). Same migration: the read rule now requires the object's path to be the granting message's own `<job_id>/<sender_id>/` (or voice-notes) folder, and messages INSERT confines `attachment_url` to that folder (all 13 prod attachment rows already match). Prod probe `scripts/probes/message-attachments-authz.prod.mjs` RED before (4 unmet: forged insert 201, B signed + downloaded A's file, both voice uploads 415), clean-up residue 0.
- [x] PROVED on prod 2026-09-14 20:07 UTC (owner asked): `prod-seed.mjs --avatar` re-uploads Hallie Helper's avatar. Original (427,253 B, sha256 5465c33f…) copied to a backup path and verified, original removed (authenticated read 400, public URL 400), `--avatar` printed "was MISSING, uploaded", object back 200 and `profiles.avatar_url` pointing at it. Bytes did NOT equal the backup, by design: the script uploads its generated 256x256 placeholder (957 B), not the old photo. The original bytes were then restored (equal to backup, public URL serves 427,253 B) and the backup deleted (400).
- [ ] VERIFY after db-deploy applies 20260914200051: run `node scripts/probes/message-attachments-authz.prod.mjs` and record GREEN here (it must exit 0).
- [ ] GAP (report only): a client's `DELETE` on a message-attachments object needs SELECT visibility too (storage-api returns the deleted rows), so a file uploaded whose message insert then failed cannot be removed by its uploader; the weekly orphan sweep is the net. Also the bucket's 5 MB `file_size_limit` is below the client's 10 MB voice-note cap (`VOICE_NOTE_MAX_BYTES`), so a >5 MB note fails with the storage error, not the client's message.

## Alerting: few, critical-only, reaching the owner (2026-09-14)
The "31 crons are not running" roll-up was the 09-13 10:03 → 09-14 17:40 UTC outage, not 31 broken crons: sweep-dead-crons ran 13 min after recovery, before any hourly/daily slot. Fixed in 20260914183932 (for jobs healthy going into a 45+ min blackout, tolerance restarts at resume; blackout sweep sees >24 h gaps; error_logs trigger posts only server-written `fatal` rows and 4 money/security sources, since the live CHECK forbids a 'critical' severity; one daily digest at 14:40 UTC, itself paged if undelivered for 30 h). Edge: money/security kinds floor to critical (`alertPolicy.ts`); 17 money call sites moved from `custom`+warning to `money_at_risk`; admin no-token fallback posts once per event (title+link) and unknown titles are critical. Guards: `scripts/probes/alerting.probe.mjs` (red on the old functions), `src/test/slackAlertWorkflows.test.ts`, `src/test/alertPolicy.test.ts`, `src/test/slackAlertsPolicy.test.ts`, `src/test/edge/slack-ops-alert.test.ts`, `src/test/edge/auto-resolve-disputes.test.ts` (seed split).
- [ ] OWNER: add GitHub repo secret `SLACK_WEBHOOK_URL` (same Incoming Webhook URL as the Supabase secret of that name, bound to #ops-alerts). Until then a failed deploy shows a `::warning` on the run and posts nothing.
- [ ] OWNER: in Slack, open #ops-alerts > channel name > Notifications > "All new messages" (on desktop AND the phone app), and make sure you are signed in as the account that is a member (@admin / admin@louisianahelpr.com), or invite your own account to the private channel.
- [ ] OWNER: Sentry (helpr-4m) > Alerts > project `javascript`: delete 3390582 "WARN — Stripe webhook signature mismatch", 3413443 "P1 — edge function 5xx burst", 3413453 "P0 — chat push notification trigger failed" (open each > ⋯ > Delete > confirm). The Sentry connector has no delete/update tool for alert rules.
- [x] DONE 2026-09-14 19:33 UTC (read-only on prod, two queries): the ratelimited loop is closed — last `%ratelimited%` row 2026-09-13 02:30:05 UTC, **0 in the last 24 h**, against 616 in the three days before; and not because the database was quiet, since 34 error_logs rows were written after the outage ended at 17:40 and none of them is one. `ops-daily-digest` is in `cron.job`, `40 14 * * *`, active. It has never fired yet (`cron.job_run_details` 0 runs): it was scheduled at 19:02 UTC, after today's 14:40 slot, so the first digest is 2026-09-15 14:40 UTC — `check_ops_digest_delivery()` pages if none is delivered within 30 h. STILL OPEN: someone has to look at #ops-alerts on 09-15 and see one digest and no per-cron messages.
- [x] CLOSED 2026-09-14 in 20260914192035. Re-read live first (cron.job LEFT JOIN cron_work_expectations): TWO of the three really had no row — `extend-boosts-hourly` ('0 * * * *') and `prune-cron-run-details` ('17 4 * * *'). The third was wrong: `prune-edge-rate-limit-log` has had a 30 h expectation since 2026-09-02, correct for its '56 4 * * *'. Rows added: 3 h hourly, 30 h daily, the same house tolerances as every comparable job. The deeper defect — `sweep_dead_crons` LEFT JOINs cron.job so it sees an expectation with no job and is blind to a job with no expectation — is closed too: a new `unmonitored` verdict reads `cron.job` itself, so a cron added by a future migration OR straight on the database (which is how extend-boosts-hourly exists: no `cron.schedule` for it appears anywhere in supabase/migrations) is reported once a day in the one roll-up. Guards, each shown red on the previous function/file: `scripts/probes/alert-followups.probe.mjs` (PGlite, 26 checks — prev sweep sees nothing, new one reports it, and a registered or disabled job stays quiet), `src/test/cronLivenessCoverage.test.ts` (inventory parsed from every `cron.schedule`/`cron.unschedule` in the migrations, independent of the expectation list).
- [x] CLOSED 2026-09-14 in `scripts/audit/seedDisputeFixture.mjs` + `prod-seed.mjs`. Correcting the record first: `prod-seed.mjs` does NOT create that row — its only dispute fixture goes through `rpc_open_dispute` and stays `open` (verified in the script and live: c7a12050 was decided 2026-09-07 06:44 UTC by hand and has outlived whatever made it). So the fix is ownership, not deletion: `--apply` now retires any dispute on an `is_seed` job left `decided` + `pending`/`executing`, and `--verify` fails while one exists. Retiring UN-DECIDES (status `withdrawn`, execution_status NULL, decision text kept with a `SEED fixture retired` prefix) and never writes `execution_status='executed'` — no transfer/refund id exists on these rows, so no money moved, and faking a settlement is something `money-reconciliation` would read as real. Guard: `src/test/seedDisputeFixture.test.ts` (red against origin/main's prod-seed.mjs), including the cases that must NOT be touched (non-seed job, any transfer/refund id, any cents, already executed). An lh-silent-failure review found three more, all fixed and each shown red: the predicate was NARROWER than the sweeper it silences (it required `status='decided'` and excluded `'failed'` — the state that actually occurs — so `--verify` could read clean while auto-resolve-disputes still counted the row; it now reads the sweeper's own `.in(...)` list and is checked against it); the PATCH matched on `id` alone, so a row `execute-dispute-split` claimed between the read and the write could be retired mid-Stripe-call (now a compare-and-swap carrying the whole predicate); and the response was discarded, so a zero-row write printed success (now asserts exactly one row).
- [ ] NOT YET RUN ON PROD: c7a12050 is still `decided`/`pending` on prod as of 2026-09-14 19:33 UTC. The next `node scripts/audit/prod-seed.mjs --apply` retires it (the sweep already skips it, so nothing is paging meanwhile). Deliberately not run from this lane: prod is a free-tier nano DB and another agent owns prod testing.
- [x] DONE 2026-09-14 in 20260914192035: a browser could forge a paging alert. Live `pg_policy` on error_logs had ONE insert policy, `anyone_can_insert_errors`, polroles NULL (PUBLIC), checking only `user_id`, so any holder of the publishable key could POST `tags.source='rls-escalation-refused'` (or a money source, or `severity='fatal'`) and page #ops-alerts. 20260914183932's defence read `request.jwt.claims ->> 'role'` — a request header, empty when no JWT is sent. The authority is the Postgres role the insert runs as: a new BEFORE INSERT trigger, deliberately SECURITY INVOKER, stamps `tags.origin` from `current_user` ('client' for anon/authenticated, 'server' otherwise, including every SECURITY DEFINER path), moves a paging source to `tags.claimed_source` and clamps a client `fatal` to `error`; `notify_slack_on_error_log` now gates on that stamp and no longer needs its by-name exception for `rls-escalation-refused` (its writer, `prevent_self_escalation()`, is SECURITY DEFINER). Client error logging is unchanged — the row is stored in full and still reaches the digest, it just cannot page. Policy rewritten naming `anon, authenticated, service_role` instead of PUBLIC. Guard: `scripts/probes/alert-followups.probe.mjs` shows the OLD trigger posting a forged security row and a browser `fatal` from role anon, and the new pair posting neither while service_role and SECURITY DEFINER paths still page. The probe runs with **RLS actually enabled** and a settable `auth.uid()` — an lh-authz-rls review caught that without those, every `SET ROLE` insert passes on the raw GRANT and the rewritten policy is never evaluated once; it now also asserts a logged-out browser can still log, a signed-in user can log against their own id, and cannot log against someone else's (42501). The stamp trigger is named `trg_error_logs_00_stamp_origin` so it sorts first among BEFORE INSERT triggers.
- [x] DONE 2026-09-14: support requests no longer wait a day. `contact-support` posted `kind:'custom'`/`severity:'info'`, which from 20260914183932 means "counted in tomorrow's 14:40 digest" — a person asking for help reached #ops-alerts up to 24 h later (the support email was always immediate; this is the channel the owner watches). New kind `support_request` in `ALWAYS_POST_KINDS` (posts now) and deliberately NOT in `CRITICAL_KINDS` (keeps ℹ️ wording and colour, so a page still means something is broken), deduped by `supportRequestKey()` over sender+subject+message so a double-tapped Send is one post. Guards: `src/test/supportRequestAlert.test.ts` (red against origin/main's contact-support) and 8 new cases in `src/test/slackAlertsPolicy.test.ts`, from an lh-silent-failure review that found two defects the first guard was blind to, both fixed and shown red: (a) the once-per-day token is claimed BEFORE the Slack POST, so a 429, a throw, a 5 s timeout or a missing transport burned it — and since `supportRequestKey` is content-derived, a sender who saw nothing and re-sent the same words hit the same key and never reached the channel that day, while the log line said it already had. The token is now RELEASED on every non-delivery (`tags.alert_key` → `undelivered_alert_key`, row kept for the digest). (b) `support_request` is reachable from an unauthenticated form and its key is content-derived, so changing one character is a new post: ~480/day/IP within contact-support's own rate limit, enough to bury the critical pages. Non-critical always-post kinds now have a 12/hour ceiling (fails OPEN on a read error; rows the cap itself writes do not count towards it; CRITICAL is never capped).
- [ ] Known and accepted (lh-silent-failure F5, low): `contact-support` awaits `postSlackOpsAlert`, which for `support_request` is now an insert + a dedupe read + a cap read + the Slack POST, each `AbortSignal.timeout(5000)`. A Supabase/Slack brown-out can add up to ~20 s to the user's "message sent" response. The await is deliberate (an un-awaited fetch is cut off when the isolate is torn down), and the email is already sent by then; revisit if it is ever seen in practice.

## Money: concurrent release / Quick Release / Quick Refund (2026-09-13)
- [x] CLOSED 2026-09-14 (re-measured on prod after deploy of 93237acdf, create-payment v1894): create-payment `release`, `admin_release_dispute`, `admin_refund_dispute` wrote the job flip matched on id only. Prod before (20 rounds each, Stripe test mode): release double-tap 20/20 (payout scheduled twice, duplicate "Job completed!"), release poster+helper crossed 16/20 (job left in_progress with both stamps), Quick Release 20/20 (loser 500 + 3 false "Transfer failed" admin alerts), Quick Refund 20/20 (both calls ran the full resolution, 2 audit rows, duplicate notices). Fix: conditional UPDATE + clean alreadyReleased/alreadyConfirmed/alreadyResolved. Guard: `scripts/check-race-class.mjs` now scans `supabase/functions` (edge inventory, 21 baselined). Probes: `scripts/probes/release-race.prod.mjs`, `admin-dispute-race.prod.mjs` (+ `mint-funded-seed-jobs.prod.mjs`).
  **After (prod, Stripe test mode, per-round is_seed fixture, Promise.allSettled): release double-tap 20/20 → 0/20** (every round one fresh release + one `alreadyReleased`; round 20's duplicate got a transient 500 "Not authenticated" and was re-run — the probe now re-runs any 5xx round instead of scoring it); **release crossed 16/20 → 0/20** (every round one `bothDone:false` + one completion, final completed/payout_pending, notices = control); **Quick Release 20/20 → 0/20** (rounds 1–11 before the 2026-09-13 outage, 12–20 on 2026-09-14: one resolution + one `alreadyResolved`, 1 audit row, 1 payout ledger row, 0 "Transfer failed", no 5xx); **Quick Refund 20/20 → 0/20** (same shape, 1 refund ledger row). All fixtures, notifications, audit/ledger/dispute rows deleted and read back 0 (plus the 2026-09-13 leftovers: round-11 job, 2 unfunded mints, and a stray `cancel_with_helper` strike on poster-e2e from a "[complete] race probe" job). Guard inventory covers all three writes: `src/test/raceClassGuard.test.ts` red on the pre-fix excerpts, green on live (16/16), `check-race-class.mjs` 0 new.
- **BUILT 2026-09-14, NOT YET PROVEN ON PROD** (branch `dispute-races` — not merged): one settlement lock for every path that moves a disputed escrow. `public.dispute_settlement_claims` (migration `20260915034822_dispute_settlement_claim_and_race_locks.sql`), a primary-key INSERT exactly one caller wins, token-scoped release, 5-minute TTL (`dispute_settlement_claim_ttl()`), taken immediately before the money step by Quick Release, Quick Refund (`create-payment`), `execute-dispute-split` (`'split'`) and the 72h sweep `auto-resolve-disputes` (`'sweep'`). Release/refund/sweep claim only a `disputed` job whose escrow is held (`escrow`/`payout_pending`, else `not_settleable`) and with no decided-unexecuted split (`split_pending`); a split claims a disputed job OR one carrying a decided, unexecuted dispute (`rpc_decide_dispute` moves status to completed/cancelled — the first draft would have refused every split). A dead release/refund/split holder's claim NEVER expires into another caller (`stuck_<action>`, paged with the exact clearing statement); only a dead sweep's claim expires. A cross-ledger check (`payment_refunds` any row / `payout_transfers` live row) runs with it; the sweep and Quick Release also ask Stripe (`latest_charge.amount_refunded`) inside the claim; a transfer that went out before its ledger write failed keeps its claim (`moneyMoved`). Same migration: `settle_dispute_record` locks its own dispute row; `open_dispute_as` gets the disputable gate, set-like evidence append, refuses `payment_status='cancelling'` and a re-file over a decided, unexecuted dispute; `check_stale_dispute_settlement_claims()` every 15 min (`check-stale-dispute-claims`, 1 h liveness) pages critical for a claim past its TTL on a job still being settled, and a claim's own expiry reports before deleting. `create-payment`: `cancel_escrow` refunds only an OPEN job with no Helpr and no unsettled dispute (it was a poster-callable refund door onto disputed, decided and hired jobs); `admin_refund_general` refuses disputed/cancelling jobs, a decided-unexecuted dispute, a full refund after a payout, and its flip is pinned to the status + payment_status it read. `void-cancelled-payments` Part A leaves a cancelled + escrow job with an unexecuted decision to the split (it refunded the same charge by the cancellation rules). The ledger read no longer filters `payment_refunds.status` — that column does not exist (verified live), so every Quick Release would have answered 503; class guard `src/test/edgeFilterColumnContract.test.ts` checks every edge filter column against the prod schema snapshot.
  - Local proof: `scripts/probes/dispute-races.pglite.mjs` claim 20/20 → 0/20, open-vs-cancel 20/20 → 0/20, double submit 20/20 → 0/20. `scripts/probes/dispute-sweep-claim.pglite.mjs 20 <51305c81c migration>` (37 checks): sweep-over-refund 20/20 → 0/20; before/after pairs for a decided split refused, a `cancelling` escrow claimed, a re-file over a decision, a dead Quick Release's claim expiring into a Quick Refund; stale-claim page + dedupe + forged client row + withdrawal case + clearing statement; migration applied 3×. Edge tests red → green: `auto-resolve-disputes.test.ts` +20, `create-payment.test.ts` +21 (cancel_escrow allowlist, not_settleable / split_pending / stuck, in-claim Stripe check, moneyMoved keeps the claim, sweep-settled, general-refund CAS + decided refusal, held-by copy), new `void-cancelled-payments.test.ts` 2 red → green. `check-race-class.mjs` 0 new, 0 stale.
  - Reviews (lh-money-escrow + lh-authz-rls, REVIEW ONLY, three rounds 2026-09-14): see the branch report; findings closed on the branch except the two deliberate non-changes below.
  - Round 3 blockers applied: `_shared/unsettledDispute.ts` also blocks while a `dispute_settlement_claims` row exists (release-payout, void-cancelled-payments, cancel_escrow, admin_refund_general all refuse a job a withdrawal took out of `disputed` under a live or dead claim); `transferToHelper` keeps the claim unless Stripe DEFINITELY refused (timeouts / connection / 5xx may have created the transfer).
  - **Round 3 findings CLOSED on `dr-close` before landing (2026-09-14, round 4):**
    - [x] H1: `rpc_withdraw_dispute` (migration §4, live body + check) raises `dispute_settlement_in_progress` while a claims row exists (an expired sweep claim excepted); void-cancelled-payments Part A refuses + pages critical on a live `payout_transfers` row, fail-closed.
    - [x] H3: `execute-dispute-split` counts only rows carrying this dispute's `metadata.dispute_id` as its legs, and step 6c (inside the claim) refuses + pages critical on any foreign `payout_transfers` / `payment_refunds` row, Stripe `amount_refunded` above this split's own refunds (attributed with `refunds.list`), or a Stripe transfer in `job_<id>` that is neither this dispute's nor on the ledger. The page and the stale-claim page both say "Do not Retry settlement until the ledger matches Stripe".
    - [x] H2 (durable, transfer-group option): `transferToHelper` tags `transfer_group: job_<id>`; Quick Refund lists the group inside its claim and refuses on any live transfer; Quick Release lists it too and refuses on a live transfer the ledger does not record. Caveat, accepted: a Quick Release transfer made before this change carries no group (those all have ledger rows or were paged).
    - [x] M1: `rpc_supersede_dispute_decision(_dispute_id, _reason)` (§5), admin check inside, `REVOKE … FROM PUBLIC, anon`, EXECUTE to authenticated. Refuses when anything may have moved or be moving (executed, leg ids, live/reversed payout, any refund, restored gift, a live or stamped claim, a split `executing` inside the TTL) and when the admin is a party; audits the old decision, RETIRES the ruled row as `superseded` (new `disputes_status_check` value) and opens a NEW dispute row (opener NULL, so no party can withdraw a ruled dispute; its own id, so old Stripe legs are foreign to a later split and idempotency keys never collide); job back to disputed + escalated. No admin UI button yet (RPC only).
    - [x] M2: `dispute_settlement_claims.money_step_at` + `stamp_dispute_settlement_claim` (by token, service_role). Every holder stamps immediately before each Stripe money call and moves nothing without the stamp; only a stamped claim sticks (`stuck_*`) or pages critical; unstamped expires, is a warning, and the monitor clears it. Release RPC retried once in all three holders.
    - [x] M3: a `joined` caller gets 409 `inProgress` and moves no money (create-payment, execute-dispute-split).
    - [x] M4: auto-resolve-disputes checks `payment_status !== escrow` before the helper-filed escalation.
    - [x] Round-4 review follow-ups (round 5): a split claims only a job with a decided, unexecuted dispute; step 6 pins `decided_at`, `markFailed` writes only `status='decided'`, 6c re-reads the dispute under the claim; void-cancelled Part A also refuses on a live Stripe transfer in `job_<id>` that is not its own cancellation fee; `rpc_decide_dispute` (§6, live body) takes the job FOR UPDATE and refuses under a live/stamped claim or when the admin is a party; split-specific stale-page wording; the monitor's unstamped DELETE re-checks `money_step_at IS NULL`; TTL 10 min (> 400 s edge wall clock); Quick Refund keeps its claim on an ambiguous Stripe refund error; an expired unstamped claim never blocks a withdrawal; `dispute_settlement_in_progress` shown by both withdraw buttons and not reported to Sentry (`src/lib/lifecycleErrors.settlementInProgress.test.ts`, inventory from source). Race-class baseline lost its `rpc_decide_dispute` entry (it locks now).
    - [x] LOW: a split retry takes over its own dead split's claim; an unstamped/sweep stale claim no longer uses Stripe wording; `lifecycleErrors.ts` comments moved to their entries.
    - Proof (local): `scripts/probes/dispute-round4.pglite.mjs` 18 FAIL on the 8b4ea6ad0 migration, 15 FAIL on the round-4 draft → 48/48 PASS (migration applied 3×); `dispute-sweep-claim.pglite.mjs` and `dispute-races.pglite.mjs` ALL PASS. Edge tests red first: 21 new red on 8b4ea6ad0 code → green, +3 red → green for the Quick Release / split Stripe transfer checks; void-cancelled Part A unsettled-dispute + claim + live-payout tests red 5/6 against main's function.
  - **Round-5 lh-money-escrow review (no BLOCKER/HIGH in the delta) — fixed on the branch per owner ("fix those too"):**
    - [x] MEDIUM-1: `execute-dispute-split` transfer/refund catches hand the settlement claim back only on a definite Stripe refusal (`isDefiniteStripeRefusal`, no `StripeIdempotencyError`); an ambiguous error keeps the stamped claim, so supersede cannot read "nothing moved". `release-payout` lists `job_<id>` transfers before claiming the payout and refuses (409, critical page) on a live transfer the ledger does not record (skipped only while resuming its own orphaned claim, which re-drives the same idempotency key). Tests red first in `execute-dispute-split.test.ts` and `release-payout.test.ts`.
    - [x] MEDIUM-2: the auto-resolve stuck-split read filters `status='decided'`; `src/test/disputeExecutionReadsFilterStatus.test.ts` derives every `.from("disputes")` chain from source and fails on an `execution_status` filter with no `status` filter (red on the auto-resolve read before the fix).
    - [x] LOW-1: `rpc_add_dispute_evidence(_dispute_id, _evidence_urls)` (§7): either party, only on an admin re-opened (opener NULL) open dispute, only the caller's own `proof-photos/<uid>/disputes/<job>/` uploads, set-like with the jobs mirror; `REVOKE … FROM PUBLIC, anon`, EXECUTE to authenticated. `DisputeTimelineDialog` routes that state through it (`src/components/disputeEvidenceChannel.ts`, tested) and labels the dispute "Re-opened by an admin". Not screenshotted: no prod dispute is in that state until the migration lands. `write-contract.baseline.json` carries the RPC as `rpc_missing` until then — remove the entry when `write-contract.mjs --refresh` runs after the migration lands.
    - [x] LOW-2: Quick Refund no longer treats `StripeIdempotencyError` as definite.
  - **Second round-5 lh-money-escrow review (on 43b2f6147) — fixed on the branch:**
    - [x] HIGH: release-payout and process-scheduled-payouts share the claim row but not the idempotency key, and neither asked Stripe before resuming a claim. `checkUnrecordedTransfers` in `_shared/payoutClaim.ts` (job-wide recorded set, `job_<id>` transfer group) runs in BOTH before `claimPayout`, with no orphaned-claim exemption: an orphaned claim adopts exactly one unrecorded transfer matching destination + `metadata.job_id` + amount (settled, no `transfers.create`); an in-flight claim stands down; anything else refuses with a critical page. Tests red first per function (`release-payout.test.ts`, `process-scheduled-payouts.test.ts`: orphaned claim > 2 min + unrecorded transfer → no `transfers.create`).
    - [x] LOW-1: `rpc_add_dispute_evidence` URL check anchored to a Supabase storage object path, `..` refused, 10 per call and 50 per dispute.
    - [x] LOW-2: "no opener" is not always an admin re-open — both the RPC and the dialog key on the supersede reason prefix (`REOPENED_REASON_PREFIX`, test compares it with the migration); a deleted opener's dispute reads "Filed on this job."; PGRST202 is told plainly, not reported.
    - [x] LOW-3: a `joined` split run writes a previously `failed` dispute back to `failed` (with its error) and names when a retry will work (`claim_dispute_settlement` now returns `claimed_at` / `expires_at` with `joined` and `held_by_*`).
    - [x] LOW-4: a transfer recovered from Stripe on a resume is stamped on `disputes.execution_transfer_id` immediately.
    - [x] LOW-5: `transferToHelper` no longer treats `StripeIdempotencyError` as definite.
  - **Rebased onto main 2026-09-15 (coordinator's merge hazard):** the branch was squashed onto origin/main 8363bb4f0 and the migration renamed `20260914194614_…` → `20260915034822_dispute_settlement_claim_and_race_locks.sql` (`npm run migration:new`, sorts after `20260915025607`). Every redefined function re-derived from live `pg_get_functiondef`: `open_dispute_as` now keeps `20260915025607`'s `job_already_completed` guard (the old body would have re-opened disputes on completed jobs); `settle_dispute_record`, `rpc_withdraw_dispute`, `rpc_decide_dispute` were unchanged live. PGlite: a person disputing a completed job still gets `job_already_completed` (red on the pre-re-derive migration, green now). Class check `scripts/check-migration-raise-codes.mjs` + `src/test/migrationRaiseCodesPreserved.test.ts`: for every function a migration from `20260915034822` on redefines, each RAISE code of the newest earlier definition must survive unless `scripts/migration-raise-codes-allowlist.json` says why — red on the pre-re-derive migration (`public.open_dispute_as` / `job_already_completed`), green now.
  - **lh-authz-rls review of the rebase (9af95e1a5): no BLOCKER/HIGH — fixed on the branch:**
    - [x] MEDIUM: evidence URLs were validated only by `rpc_add_dispute_evidence`; `open_dispute_as` (new filing + re-file, via `rpc_open_dispute` by either party) stored any string and the opener's direct UPDATE could replace/empty the array (probed on prod: `javascript:` and attacker-host URLs stored, rendered as `<a>`/`<img>`). Now: one validator `dispute_evidence_url_ok` (migration §8), called by `open_dispute_as` (platform filings carry none) and `rpc_add_dispute_evidence`; BEFORE UPDATE trigger `trg_dispute_evidence_append_only` holds every party write to append-only + validated (admins and service role unconstrained; only ADDED elements checked). Client renders only this project's signed proof-photo URLs and counts the rest (`src/lib/evidenceUrl.ts`, both `DisputeCard` and `DisputeTimelineDialog`; test red first). Not screenshotted: no prod dispute holds a non-matching URL (read-only: 0 evidence rows on prod today).
    - [x] LOW-1: host pinned to `fncmgoasalhdgfwzhsqa.supabase.co`, `sign` routes only.
    - [x] LOW-2: lock order is jobs → disputes in `rpc_withdraw_dispute`, `rpc_decide_dispute`, `rpc_supersede_dispute_decision`, `rpc_add_dispute_evidence` (job id looked up unlocked, job locked, then the dispute row), matching `open_dispute_as` and `claim_dispute_settlement`; PGlite asserts the order in all four bodies.
    - OPEN (LOW, exists on prod, not this branch): live storage policies let the uploader UPDATE/DELETE `<uid>/…` objects, so a party can swap or remove a photo after an admin has seen it. Deny non-admin UPDATE/DELETE on `*/disputes/*`, or copy evidence to an admin-owned path on submit.
    - OPEN (LOW): `jobs.dispute_evidence_urls` (the legacy mirror) is still party-writable directly; the client render guard covers display. A server-side check there belongs with the dispute-marker trigger owned by the helper-dispute-status lane.
  - **Transfer-group guarantee (coordinator, 2026-09-15):** every job-scoped `stripe.transfers.create` sets `transfer_group: job_<id>` (create-payment transferToHelper since this branch, release-payout, process-scheduled-payouts, execute-dispute-split, void-cancelled-payments fee; cash-out-credits and instant-payout's fee are not job-scoped). Guard `src/test/edgeTransfersCarryTransferGroup.test.ts` (red on the pre-branch transferToHelper). Read-only on prod: all 13 `payout_transfers` rows with a Stripe id record Stripe's echoed `transfer_group = job_<id>`. `checkUnrecordedTransfers` also lists the Helpr's destination and matches `metadata.job_id`, so an untagged transfer cannot slip past the payout paths. OPEN (LOW): the create-payment / split / void-cancelled checks list by group only; an untagged transfer from before this branch (a Quick Release whose ledger write failed) stays invisible to them; the destination list returns the 100 most recent transfers only.
    - PROBABLE HIGH (outside the delta, owned by a separate agent — not taken here): the live helper column whitelist allows `jobs.dispute_status`, so a Helpr can PATCH `escalated → open` and the 72h sweep pays out in full. Needs a rolled-back impersonation probe and a transition restriction. (NOTE: `20260915033734_dispute_markers_server_owned`, now on main, adds `trg_dispute_markers_server_owned` which refuses exactly this — re-verify it closes the lead before re-filing.)
  - **Third money review (post-authz delta, on 9991403bc) — fixed on the branch:**
    - [x] HIGH-1: `process-scheduled-payouts` handed `claimPayout` a STALE `ledgerRows` snapshot read before its Stripe round-trips; a claim a concurrent run settled in that window read as an orphaned openClaim, so the INSERT (and the unique index) was skipped and a second transfer went out under a different key. Fix: the caller passes no snapshot, so `claimPayout` re-reads fresh (`process-scheduled-payouts/index.ts` claim call; `_shared/payoutClaim.ts:147-151`). Tests: `src/test/edge/payoutClaim.test.ts` — no-snapshot blocks on a fresh settled row (green), a stale orphan snapshot proceeds without reading (the danger), and the caller no longer passes `ledgerRows:`.
    - [x] MEDIUM-1: the adopt match compared the Stripe transfer amount to THIS run's recompute (gross), so a first payout's claim — written NET of the $2 onboarding fee — was un-adoptable and paged critical on every helper's first payout. Fix: `checkUnrecordedTransfers` selects `amount_cents` and matches the claim's recorded amount (`_shared/payoutClaim.ts`), fallback to the run amount when null. Test in `payoutClaim.test.ts`.
    - [x] MEDIUM-2: the lock-order flip left the LOCKED re-read unguarded — `NULL <> 'open'`/`NULL <> 'decided'` is NULL — so `rpc_decide_dispute` / `rpc_supersede_dispute_decision` could fall through on a dispute deleted between the unlocked lookup and the lock and still UPDATE the job, stranding escrow. Fix: `IF NOT FOUND` + `IS DISTINCT FROM` after each locked re-read (migration §6 decide, §5 supersede). PGlite: decide/supersede on a deleted dispute RAISE and leave the job untouched; controls still work; migration applied 3×.
    - [x] LOW-1: the per-Helpr destination fallback list is paginated (`starting_after`) and fails CLOSED past a 25-page cap, so a Helpr with many transfers cannot hide a legacy untagged transfer for this job off the first page.
    - [x] LOW-5: `DisputeDialog.tsx` / `DisputeTimelineDialog.tsx` sanitise the uploaded file extension (`[a-z0-9]`, capped, fallback `jpg`) so a `#` in a filename cannot put a `#` in the object path and make the dispute RPC refuse the URL with a misleading error.
    - [x] LOW-6: the two stale lock-order comments in the migration now read jobs → disputes.
    - OPEN (LOW-2, pre-existing): `void-cancelled-payments/index.ts:368` sends a real Helpr fee transfer (metadata.job_id, group job_<id>) but writes NO payout_transfers row — a `checkUnrecordedTransfers` run on such a job would read it as unrecorded and 409+page. Unreachable today (fee-paid jobs are cancelled, not completed/payout_pending); a reconciliation blind spot.
    - OPEN (LOW-3, pre-existing): `payout_transfers_one_live_per_job_helper` is NULL-distinct on `helper_id`, so a redacted helper (nullable `helper_id`) escapes claim arbitration, and `checkUnrecordedTransfers` counts null-helper rows for this job (`payoutClaim.ts:362`) while `claimPayout`'s `.eq("helper_id")` read does not — the two disagree and the adopt guard 409s. Zero such rows on prod.
    - OPEN (LOW-4, pre-existing): `jobs.dispute_evidence_urls` is still party-writable and unvalidated server-side (the new append-only trigger covers only `disputes`); `DisputeTimelineDialog.tsx:243` writes it, `DisputeCard.tsx:84` reads it as fallback, so the client render guard (`evidenceUrl.ts`) is the only defence. Belongs with the dispute-marker trigger the helper-dispute-status lane owns.
    - OPEN (LOW-7, pre-existing): `process-scheduled-payouts` Step 4b (payout > escrow) `continue`s after `claimPayout` already inserted the claim, rolling back the onboarding fee but NOT the claim row — leaving a permanent pending claim with a null transfer id (the openClaim-forever shape). Fix by failing the claim row on that exit.
  - OPEN (LOW, test tooling): `prod-lifecycle-sweeper.mjs` / `pressProdSafety.mjs` now leave a HIRED funded leftover in place (cancel_escrow 409 `useCancelJob`; cancelling it would strike poster-e2e). Those rows accumulate until released; add a settle-forward step if they pile up.
  - Before landing: read-only on prod 2026-09-14 — 0 jobs in `payment_status='cancelling'`, 0 cancelled + escrow, 1 decided-unexecuted dispute (`c7a12050` on is_seed job `bb2c3732`, in_progress/escrow — the shape the re-file guard exists for).
  - **TODO (coordinator, needs prod):** land in order (migration first, then edge), then run `settle-dispute-race.prod.mjs`, `dispute-open-race.prod.mjs`, `admin-release-vs-refund.prod.mjs --mode=all` (minted PIs) — the latter now includes the same-action token pair and an induced transfer failure. `scripts/ci/race-runner.mjs` race 3 (two connections) not run either.
  - OPEN (LOW): the SQL watchers (`sweep_dead_crons`, `check_ops_digest_delivery`, and now the stale-claim page) post to `slack-ops-alert` with vault `service_role_key`, and a 401 is async — confirm once in `net._http_response` that these posts answer 200.
- [x] CLOSED 2026-09-14: `src/pages/activity/activityActions/useLifecycleHandlers.ts` keyed the completion moment off `bothDone` alone, so a duplicate release (`alreadyReleased: true, bothDone: true`, or `alreadyConfirmed: true`) replayed the confetti + success-moment + tip prompt for a completion that already fired them on the original call. Fix: `if (data?.alreadyReleased || data?.alreadyConfirmed) { await refresh(); return; }` before the `bothDone` branch, field names confirmed against the `alreadyDone` early-return in `supabase/functions/create-payment/index.ts`. Checked the other handlers in the same file that celebrate or prompt (`resolveRevision`, `confirmArrival`, `confirmWorking`, `handleNoShow`) — none of them read an idempotent "already" response from the server, so none share this defect class. Guard: `src/pages/activity/activityActions/useLifecycleHandlers.duplicateRelease.test.tsx`, red against the pre-fix code (reproduces the exact `alreadyReleased` shape from the original bug report), green after; a control case proves a fresh (non-duplicate) completion still celebrates and still prompts.
- [x] CLOSED 2026-09-14: pre-push a11y-prod sweep red on `/my-jobs` (helper, phone-light): axe `aria-command-name` serious, 2 nodes `.tracking-helper-pin` (a clickable map pin with no accessible name). Root cause: Leaflet gives every marker `role="button"` by default (`keyboard: true`), but only copies the `alt` option onto the icon DOM node `if (icon.tagName === 'IMG')` — a `divIcon` marker is a `<div>`, so the existing `<Marker alt="...">` was a no-op that read like a fix and changed nothing (an unlabelled focusable button stayed in the tab order). Fix: `withAccessibleName()` in `src/components/TrackingMap.tsx` stamps `aria-label` directly onto the marker's DOM node via a wrapped `createIcon`, applied to both the helper pin ("Your Helpr's current location") and destination pin ("The job location"). No visual change. Guard: `src/test/mapMarkerAccessibleName.test.ts` derives its inventory of command-role marker constructs from source across every `*map*` file (`git ls-files src`) — Leaflet `divIcon(...)` calls and manual `setAttribute("role","button"|"link")` — and asserts each has an accessible name; canary tests reproduce the exact original bug shape and prove the checker flags it (also independently confirmed red against the pre-fix `TrackingMap.tsx` blob). `src/components/browseMap/mapMarkers.ts` (BrowseMap's pins/clusters) already did this correctly — checked, not touched.
- [x] AUDITED 2026-09-14 — the 21 edge `jobs` lifecycle writes baselined "not yet re-audited": **11 SAFE, 8 FIXED, 2 DEFERRED** (`docs/audit/lifecycle-writes-audit-2026-09-14.md`). Fixed: auto-release-payment (dispute/revision filed mid-run was overwritten to completed/payout_pending — now `.eq("status", job.status)`), auto-resolve-disputes (escalated or withdrawn dispute auto-paid — now status + dispute_status CAS), create-payment escrow stamp (gift-card funding written back to unpaid — payment_status CAS), `request_revision` / `resolve_revision` (double-tap + stamp on a disputed job — status CAS, `already*` replies), `cancel_escrow` claim + final flip (overwrote a dispute opened mid-refund — status + `cancelling` CAS), `charge.dispute.created` (overwrote a settled payout to chargeback — payment_status CAS + marker-only fallback). SAFE ones moved to a new `safe` list in the baseline with reasons; `check-race-class.mjs` still fails on any new unguarded write. Guard shown red on the pre-fix excerpts (`src/test/fixtures/raceClass/edgeLifecycleWrites.prefix.ts.txt`).
- OPEN: the 2026-09-14 lifecycle-writes fixes have NO prod race proof yet (prod owned by another agent). Seven probes listed at the end of `docs/audit/lifecycle-writes-audit-2026-09-14.md` (auto-release vs dispute, auto-resolve vs escalate/withdraw, gift vs card funding, revision double-taps, cancel_escrow vs dispute, chargeback vs settled payout).
- [x] CLOSED on `dispute-races` (lands with it): `admin_refund_general` flip pinned to the read status + payment_status (baseline `allow` entry removed, the scanner no longer hits it); `execute-dispute-split` jobPatch runs under the settlement claim (moved to `safe`). Quick Release / Quick Refund refuse `payment_status` other than `escrow`/`payout_pending` (`not_settleable`, enforced inside `claim_dispute_settlement`).
- [x] CLOSED on `dispute-races` (lands with it): `cancel_escrow` allowlist — `status='open'`, `helper_id IS NULL`, no decided-unexecuted dispute (`_shared/unsettledDispute.ts`), same predicates on the atomic claim. A hired funded job answers 409 `useCancelJob`; `scripts/e2e/prod-lifecycle-sweeper.mjs` and `scripts/audit/pressProdSafety.mjs` fall back to `poster_cancel_job` on that answer (void-cancelled-payments refunds minus any fee).
- [x] CLOSED 2026-09-14 (LOW, same audit): `chargeDisputeClosed` warning_closed reset `chargeback → payout_pending` even when the chargeback hit an `escrow` job (work not done); no payout (the cron requires `completed`) but the job was stranded outside every sweep. Fix: restore the pre-chargeback state via `preChargebackPaymentStatus()` — `payout_scheduled_at` set or `status = completed` → payout_pending, otherwise escrow (derived, no schema change; not keyed on the two completion stamps because auto-release completes with the poster stamp null). Still a CAS on `payment_status = chargeback` with `.select("id")`; zero rows on a job read as chargeback now pages ops. The admin notice title and text follow the restored state. Guard: `src/test/edge/stripe-webhook.test.ts` "charge.dispute.closed restores the pre-dispute payment state" was red 3/6 on the pre-fix handler (escrow restore, the notice, the zero-row alert) and is green 6/6 after. The two payout_pending cases and the lost-dispute case (payment_status untouched) pass on both. No prod proof (Stripe cannot emit warning_closed on demand for an existing charge).
- [x] CLOSED 2026-09-14 (HIGH, was already there, from the lh-money-escrow review of the fix above): `charge.dispute.created` overwrote `dispute_status` and `disputed_at` whatever hold was already on the job, and `warning_closed` then cleared `disputed_at`, the only dispute guard on the job row in process-scheduled-payouts. (1) A decided dispute whose split never ran paid the Helpr in full over the decided refund; (2) a `reversal_hold` job became re-payable. Fix (no schema change, ownership derived in `stripe-webhook/handlers/_chargebackHold.ts`): created still applies the payout block (`payment_status` CAS) but writes the markers only over no markers or a card-dispute status (`.or()` CAS + `.select("id")`); closed writes its outcome only over a card-dispute status, and a dismissal clears `disputed_at` only when no hold exists (unexecuted or OPEN `disputes` row, reversed `payout_transfers` row, job `status = 'disputed'`, or `dispute_status` in open/helper_responded/escalated/reversal_hold). Otherwise it restores `payment_status`, keeps `disputed_at` and pages critical; a failed hold read throws (Stripe retries) and pages once a day. process-scheduled-payouts now refuses a job with an unexecuted decided dispute or a job-wide reversed transfer (read errors are defects; holds page once a day). lh-money-escrow review follow-ups in the same commit: N1 "held" means a real hold, and the won notice no longer tells admins to withhold a settled job's payout; N2 a released job with a settled internal dispute still gets the `stripe_chargeback` marker, and `transfer.failed` / `transfer.canceled` no longer re-queue a job with a live dispute (page instead); N3 release-payout refuses (409 + page) on a `reversed` ledger row instead of healing the job to released; N5 dedupe. B1 (jobs the old handler already corrupted): its read-only prod query returned 0 rows, and no prod job carries any card-dispute status at all. Live check: `rpc_decide_dispute` writes only `status` + `dispute_status` on jobs; no DB function writes a card-dispute status. Guards: `src/test/edge/stripe-webhook.test.ts` "a card dispute never lifts a hold it did not place" + "card dispute holds — review follow-ups", `process-scheduled-payouts.test.ts` "holds the job row may not show", `release-payout.test.ts` reversed-row case: 14 red on the pre-fix code, then 11 more red on the first fix before the review follow-ups; all green after. Known trade-off (review Q4): on a legacy group job the job-wide reversed check holds back the other roster members' shares too (paged).
- [ ] QUEUED (prod slot, lh-money-escrow review N4): the dispute-hold fix above is proven only on the mocked edge harness, which ignores filters, so none of its conditional writes are exercised (`CHARGEBACK_MAY_MARK_FILTER`, `disputeStatusAsReadFilter`, `.eq("payment_status","chargeback")`, the zero-row branches). Replay both scenarios on Stripe test-mode seed jobs (decided-unexecuted split; `reversal_hold`) including the zero-row races, and prove each predicate can fail. Also check whether the live webhook endpoint still has `transfer.failed` / `transfer.canceled` enabled.

## Stripe webhook endpoints — issue #1586 FIXED 2026-09-12, two items left for the OWNER
Root cause closed: `scripts/e2e/stripe-sandbox-on.sh` now deletes every pre-existing test-mode endpoint on the webhook url before creating exactly one, derives `enabled_events` from the `EVENT_HANDLERS` map (`scripts/stripe-webhook-events.mjs`), keeps the id under `$HOME/.lh-stripe-test-webhook-id` instead of `/tmp`, and re-reads the account afterwards to confirm one enabled endpoint before touching the Supabase secrets. Guard: `scripts/check-stripe-webhook-events.mjs` + `.github/workflows/stripe-webhook-guard.yml` (proven red on the two-endpoint incident state and on the old 8-event list; the workflow re-proves both fixtures red on every run).
- **OWNER ACTION — add the `STRIPE_TEST_SECRET_KEY` repo secret.** A Stripe **test-mode** restricted key with *read* access to Webhook Endpoints is all it needs. Until it exists the `live-secret-present` job in `stripe-webhook-guard.yml` is RED on purpose: that job is the only thing that can see a duplicate endpoint, and a missing key must never look like a pass. This is the one remaining hole in #1586 — the source-side half is guarded, the account-side half is not running yet.
- **CLOSED 2026-09-12 — `customer.subscription.created` unsubscribed.** Verified live against `acct_1RQbAfKp2H4b7tEC` test mode (`livemode:false`), endpoint `we_1U8AbhKp2H4b7tECpsHaYA7D`: it was 16 subscribed vs 15 keys in `EVENT_HANDLERS`, the extra event delivered and dropped as "Unhandled event type". Resolved by dropping the subscription, not by writing a handler: new subscriptions are already granted by `handleCheckoutSessionCompleted` when `session.mode === "subscription"` (sets tier and `subscription_expires_at`), so `customer.subscription.created` was redundant rather than a coverage gap. Endpoint now carries 15 events, matching the handler map exactly in both directions.


## Disk: git history carries 322M of dead media — REWRITE QUEUED (2026-09-13)
- OPEN: **rewrite history to drop 322M of history-only media blobs** (owner approved 2026-09-13, deferred by choice to a quiet window). `git rev-list --objects --all` shows 2,383 media blobs that exist in NO commit's tree at HEAD — worst offenders `src/assets/hero-illustration-v5.jpg` (13.4M across 6 revisions), `assets/splash.png` (6.0M), `hero-porch-garden-2000.webp` (5.1M), `hero-new-3.jpg` (4.1M), `hero-porch-garden.jpg` (4.0M), `public/pwa-192x192.png` (3.4M), `helpr-fb-cover.jpg` (3.1M). `src/assets/` at HEAD holds only `helpr-logo-256.webp` + `helpr-logo-96.webp`, and `git grep -E 'hero-(illustration|photo|porch|new)'` over src/public/index.html returns nothing — the art is already deleted and unreferenced, so only the pack still holds it. `size-pack` is 350.89 MiB today; expect ~100M after. **Also include in the rewrite (2026-09-14):** `docs/audit/storage-orphans-deleted-2026-09-14.log` was committed in ac1791ed9 with 93 full user/job/message UUIDs; the file is now redacted to 8 characters, but that commit's version still carries the full ids in history.
- **Why it is not done yet:** the rewrite changes every commit SHA and needs a force-push to shared `origin/main`. At the time of approval there were **31 worktrees, 22 of them live** (agents committing within the last 2h) and 5 running agent processes, plus **36 local-only branches** with no upstream. Rewriting then would have orphaned every live worktree and killed work in flight.
- **Preconditions before running it:** (1) `git worktree list` down to the main checkout, or every other worktree provably idle and its work pushed; (2) all 36 upstream-less local branches pushed or confirmed disposable — they must be included in the rewrite or they resurrect the blobs; (3) `git-filter-repo` installed (**not present today**); (4) every agent/terminal stopped. Then rewrite, force-push, and have each session re-clone rather than reuse a stale worktree.
- Not urgent: the machine sits at 24% disk use with ~76 GiB free, so this is repo hygiene, not a space emergency.

## 18 `wip/` branches on origin — triaged 2026-09-13, none deleted
Report only, nothing removed. Every one is **unmerged** (checked with `git merge-base --is-ancestor` against main), so none is safely disposable on its own; each also pins the dead media blobs, which is why this list blocks the history rewrite above.
- **Two are largely superseded by work that has since landed on main** — these are the realistic deletions, once someone confirms the remainder is unwanted:
  - `wip/gift-card-rename` (3 commits, 72 files): 49 of its 72 files are now byte-identical to main. The differing 23 are its *legacy alias* approach (edge forwarders, legacy wire keys) — which main explicitly rejected in `0a397aa8a` "Gift card rename, code half: **no aliases**". So the remainder is not a gap, it is a road not taken.
  - `wip/helpr-naming-fixes` (1 commit, 40 files): 28 of 40 now identical to main after `045f5301d` "Helpr naming: 43 copy strings + guard". The 12 differing files need a read before anyone calls them dead.
- **Two are the abandoned-worktree rescues from today's disk cleanup** — pushed so the worktrees could be removed, and carrying real unmerged work: `wip/messaging-lockout-2026-08-30` (24h messaging lockout + migration `20260831053124`, which is NOT in main) and `wip/job-confirmation-2026-08-30` (JobConfirmation / JobTracking / ConfirmedSection).
- **Seven are audit-harness scaffolds paused mid-build**, all 2026-09-12, 1 commit each, opaque agent-hash names: `wip/a3098e1a3d88bb205` (notification delivery audit), `wip/a41e5871ceaa5b039` (press-every-control harness), `wip/a52d1fb23f25cb495` (usability scorecard), `wip/a69d0af0b250db810` (slow-device spec), `wip/ab081703e8d015858` (first-time-user walk), `wip/abf395f466bcf1adf` (interruption journeys), `wip/ac0f5d2ac0f5004a5` (assistive keyboard spec). Several say "unverified" or "not yet green" in their own subject.
- **Three are "WIP from closed terminal, unverified"** dumps: `wip/combobox-terminal` (7 files), `wip/race2-terminal` (8 files), `wip/lexilombas-.lh-combobox-ws` (1 file).
- **Four are older single-purpose WIPs:** `wip/expiry-waiting` (9 files, expired listing stuck at Waiting, countdown says Undefined), `wip/unplus-tier-removal-20260829` (39 files, remove Plus tier), `wip/e2e-jobtab-schedule-fixes-20260829` (2 files), `wip/postjob-doubletap-driver` (1 file).
- Next step is a read, not a delete: for each, either land it, fold it into a live lane, or record here why it is abandoned — then delete it as part of the rewrite's precondition (2) above.

## Admin follow-ups (2026-09-13)
- OPEN: re-measure "AdminRoute: admin role indeterminate" in prod `error_logs` after this deploy (was 121 rows 2026-09-04..13, 83 seed-admin + 34 real admin, all from the report effect firing while the role lookup was loading). Any row after deploy is a real failed lookup; check it. Guard: `src/components/AdminRoute.test.tsx` (no report while loading). Tiers unknown-tier fallback (`AdminHelperTiers.test.tsx`) and the admin-views spec (`e2e/prod-audit/admin-views.spec.ts`, now fails on any error screen incl. "couldn't load" and the access gate) shipped, 27/27 green on prod at 375.


## Mocked Playwright specs → prod (owner: NO MOCK MODE, EVER) — IN PROGRESS 2026-09-13

Inventory taken from source, not declared: a file counts as mocked if it answers
the Supabase origin itself (`route()` on `supabase.co` / `/rest/v1` / `/auth/v1`
/ `/functions/v1` plus a `fulfill`, or the shared `installSupabaseMocks` /
`mockTable` / `mockRpc` helpers). The classifier is
`src/test/e2eNoSupabaseMocks.test.ts`, which is also the ratchet guard — it fails
on any NEW mock and fails if its BASELINE names a file that no longer mocks, so
the list can only shrink.

**Count at start: 36 files** — 30 `.spec.ts` + 6 helper modules.

Helpers (the mock machinery itself): `happy-path/fixtures.ts`,
`happy-path/seedData.ts`, `happy-path/seedDataHeavy.ts`,
`happy-path/state-matrix/stateMatrix.ts`, `happy-path/sweepCore.ts`,
`prod-audit/harness.ts`.

Specs (30): everything under `happy-path/` except `buttonGeometry.spec.ts` and
`popupFooterFit.spec.ts` (source-scan + layout measurement, no backend at all),
plus `visual-audit/desktop-fill.spec.ts`, `visual-audit/responsive.spec.ts`,
`payment-lifecycle.spec.ts`, `prod-audit/messy-input.spec.ts`,
`prod-audit/interruptions.spec.ts`.

**Approach.** A new `e2e/prod-ui/` project driving the DEPLOYED app with the two
shared accounts. `e2e/prod-ui/fixtures.ts` re-exports the fixture names the mocked
suite used (`customerPage`, `helperPage`, `checkA11y`) but backs them with
`getSession` from `e2e/journeys/fixtures.ts` (import only — another lane owns that
file) and the `is_seed` rows from `scripts/prod-seed.mjs`, so a spec body mostly
survives the move. Specs migrate in groups; the mocked copy is deleted only once
its prod copy is green, and each group updates the ratchet BASELINE and the
`e2eSpecsReachableInCi` registration in the same commit.

**States that cannot be seeded on prod are recorded as a stated GAP in the spec**
(`skipUncovered`, which annotates and prints a `::warning::`), never as a quiet
pass. GAPs are listed here as they are found.

**The pre-push visual sweep** (`happy-path/visual-audit-sweep.spec.ts`) is mocked
and is the one piece where a straight port makes every push slow. Proposal:
replace it with a prod CHANGED-SCREENS check — map the diff's changed files to the
routes they render (the existing `auditRoutes.ts` route table), capture only those
routes against prod, and fall back to the full sweep nightly. Whole-surface
coverage stays; it just moves off the push path.

---

## Cleanup candidates — dead code found 2026-09-13 (`npx knip`, call sites counted)

`npm run deadcode` (knip) reports **0 unused files and 0 unused dependencies** —
nothing whole is orphaned. What it finds is smaller: exports nothing imports,
and one reachable-looking code path that cannot execute.

- [ ] **`instant_book_claim` cannot fire — `useApplyFlow.ts:229-253` is dead.**
      `jobs.instant_book` was dropped by migration `20260904034410` (dead-feature
      cut) and `useApplyFlow.ts:67` stopped selecting it, so `isInstantBook` is
      always `false` and the RPC branch (plus its PGRST202 fallback) never runs.
      Five call sites still read or write the dropped column:
      `ApplyConfirmDialog.tsx:23`, `applyConfirmDialog/ApplyBody.tsx:90`,
      `JobCard.tsx:471` (renders an "Instant book" badge that can never show),
      `useApplyFlow.ts:244`, and `postjob/jobSubmitHelpers.ts:217`, which still
      sends `instant_book: true` on insert — a column prod no longer has.
      That last one is the reason this is not cosmetic.
- [x] **"12 scripts referenced by nothing" was a bad signal — only ONE was dead.**
      Reading them changed the answer: `scripts/mapkit-token.mjs` is how the
      live `VITE_APPLE_MAPKIT_TOKEN` gets regenerated, `check-silent-catch.mjs`
      documents in its own header why it exists outside ESLint,
      `scripts/asc/*` is in-flight App Store Connect work, `probes/*.probe.mjs`
      are run by hand with a PGlite dir, and `audit/a11y-focus-repro.mjs` and
      `complete-profile-icon-clip.mjs` were written the same day as this sweep.
      An operator tool is invoked by a person, so "nothing imports it" says
      nothing about whether it is dead. Only
      `scripts/e2e/cleanup-stray-testusers.sh` was genuinely spent (a one-shot
      for the 2026-08-24 id mixup); deleted. **Do not re-run this heuristic and
      act on it** — grep-for-references cannot see a human caller.
- [ ] **62 unused exports — almost all are OVER-exported, not dead.** Checked
      each against its own file: `QUEUE_LIMIT`, `MARKETING_MEDIA_BUCKET`,
      `assertUploadableMarketingMedia`, `LOCKOUT_BAN_STATUSES`,
      `earlyAccessWaitMinutes`, `displayHelpersCount`, `shortJobId`,
      `PASSWORD_SYMBOLS`, `helperCommissionCents`, `MetaApiError`,
      `buildCaption`, `toBase64`, `MAX_FEED_BYTES` … are all used by their own
      module — the only dead thing is the `export` keyword. Same for the 32
      "duplicate exports": a file exporting both `Foo` and `default Foo` when
      importers pick one. Dropping the surplus `export` is safe but cosmetic;
      deleting the symbol is NOT. `src/pages/jobs/jobsConstants.ts` was the one
      real find (5 of its 6 exports had no reader in any file, including its
      own) and is now cut to `ALL_CATEGORIES`. Re-run `npm run deadcode` before
      acting on any remaining entry, and check in-file usage first.
- [ ] **3 unlisted dependencies**: `playwright` imported by
      `scripts/audit/a11y-focus-repro.mjs` and
      `scripts/audit/complete-profile-icon-clip.mjs`,
      `@typescript-eslint/parser` by `src/test/buttonHeightLedger.test.ts`.
      They resolve today only because a transitive copy is installed.
- [ ] **`.claude-scratch/` is 129M and lints.** It is gitignored (290e73045) but
      still on disk and still inside the ESLint project, so
      `.claude-scratch/og/sandbox/api/share.ts` contributes the repo's only two
      standing `npm run lint` errors (`no-control-regex`, silent-catch). Either
      add it to `eslint.config` ignores or delete the directory.

---

## Keyboard — suggestion popups have tabbable options, no arrow-key model (2026-09-12)
- [x] `BrowseSearchBar.tsx`, `CityAutocomplete.tsx`, `AddressAutocomplete.tsx`: `<button role="option">` in a listbox with no ArrowUp/Down/aria-activedescendant on the input. Allowlisted as PENDING in `src/test/listboxOptionsNotTabbable.test.ts`; give the input a combobox keyboard model, set options `tabIndex={-1}`, remove from PENDING. (DOB wheel fixed.) DONE 2026-09-14: shared useComboboxKeyboard; proven keyboard-only on prod at 375 (Browse, City, Address/MapKit).

## CLOSED 2026-09-13 — contact smuggling in bios/job posts + hyphenated-domain emails (terminal 7)

Both SECURITY findings from 2026-09-12 shipped (owner said yes) in
`supabase/migrations/20260913020635_reject_contact_leaks_in_jobs_and_bios.sql`:
`contact_leak_reason` email domain widened to `[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}`
(matches `src/lib/messageScanner.ts`), and BEFORE INSERT/UPDATE triggers on
`jobs(title, description)` and `profiles(bio)` REJECT a leak (23514,
user-readable message; universal, no is_seed exemption, fire only when the
scanned column changes). Client pre-scans the same fields
(`src/lib/contactLeakField.ts`; post-job title/description, Edit Profile,
Complete Profile, Signup step 2) and shows a server rejection verbatim.
Checks: `e2e/journeys/abuse/contact-smuggling.spec.ts` now expects 400 (was
proving the gap), `src/lib/contactFilterParity.test.ts` locks the widened
domain on both layers, `scripts/probes/contact-leak-reject.probe.mjs` proves
old-miss/new-catch, reject/pass and 3x replay in PGlite.

- **Left alone on purpose:** ~60 pre-existing rows (all seed/E2E) already
  contain flagged text; the trigger only fires when title/description/bio
  changes, so they are untouched and an unrelated update on them still works.
  Rewrite or delete them with the next seed refresh if they should go.
- **Still open (documented limitation):** `"jane (at) gmail (dot) com"` worded
  obfuscation evades client and server alike.
- **Marker convention:** every E2E/seed run id inside a title/description is
  now letter-prefixed base36 (`r${Date.now().toString(36)}`); a bare
  10- or 11-digit marker reads as a phone number and the trigger rejects the
  row (12+ digit runs no longer do since 20260915020258).

## Terminal 7 suites shipped (2026-09-12)

- `e2e/journeys/abuse/` — IDOR & authz matrix (cross-account read/write refusal,
  self-review, review-without-completed-job, self-application, poster money-column
  lock) + contact smuggling. API-level, RLS-pinned to the live policies.
- `e2e/journeys/notifications/` — `create-notification` authz/link/type
  sanitisation, preference OFF round-trip, real in-app link opens its screen with
  no error page, trigger→in-app row→email_send_log on a funded thread.
- Inventory: `docs/audit/notification-inventory.md`.
- Nightly + dispatch: `.github/workflows/e2e-abuse-notifications.yml` (shared-
  accounts concurrency group; pre/post sweeper).
- [x] Revoked cached sessions no longer pass as signed in (2026-09-12): one shared
  check `e2e/liveSession.ts` (GET /auth/v1/user, dead/corrupt cache deleted and
  re-minted) used by journeys `getSession` (so prod-audit + a11y-prod) and
  `scripts/audit/pressProdSafety.mjs`; harness's private copy removed. Guard
  `src/test/liveSessionCache.test.ts` (red 2/4 on clock-only cache, green 4/4).
  Noted, not touched: `e2e/prodSessions.ts` has zero importers (dead, clock-only TTL).

---

## Decided 2026-09-11, now queued to build

- **Live location: background tracking, REQUIRED while en route.** Today it is
  `setInterval(pushPosition, 45_000)` in the WebView (JobTracking.tsx:692),
  running only while the job is `on_the_way`. There is no `watchPosition` and no
  background-location capability, so **iOS suspends it the moment the helper
  locks their phone or opens Maps** — i.e. exactly while they are driving, which
  is the only time it matters. Owner chose real background location from "On My
  Way" until arrival. Carries `UIBackgroundModes: location`, an Apple review
  justification, a privacy-label change, and battery cost.
- **Earnings splits into two tabs.** Earnings = what you made (summary, history,
  forecast, export, streak). Payouts = how you get paid (setup — currently
  NESTED inside the earnings tab — methods, wallet/cash-out, threshold, payout
  history, transfers, Instant Cash Out). Lane `earnings-split`.

## Job card (BOTH sides) — IN PROGRESS, lane `step-components`
Owner decided 2026-09-11: helper and poster cards share ONE shell, filling the
same slots (tracker / primary action / secondary row / the ask / escape link)
with different content per side and per step.

- **Poster name has two treatments** (REPEAT report — raised before, not fixed).
  `AppliedJobCard.tsx` ~169 collapsed: quiet inline avatar + name. ~293
  expanded: the same fact as a grey `bg-muted/40` band with an added "Posted
  by" label. Expanding a card should reveal more, never redraw what was
  already there. `bg-muted/40` around an identity or meta row is suspect
  generally here — the owner previously flagged the same band behind the
  location chip.
- Helper-name placement and the name in the tracking panel, poster side —
  check whether these are the same one-fact-two-treatments shape.

- One component per step; six states currently have six different layouts.
- `DisputedSection` still renders the OLD hand-rolled Photo Proof card that
  `adb4773dd` replaced elsewhere. Two designs ship side by side today.
- "Add a before photo" panel still shows in the Request-My-Payout state.
- Action row is 1-up / 2-up / 3-up with no rule; "Report a Problem" is a link
  under the row while "Can't Finish" is a chip inside it.

## Performance — audit done, NO fixes applied yet
Measured against prod, warm median:
- Postgres read ~101–118ms · edge fn without a third party ~128ms ·
  **edge fn → Stripe 395–893ms**. The third-party hop is the whole problem;
  the Deno runtime is not.
- `check-pro-subscription` (893ms) lands 570ms after everything else on
  /dashboard. `stripe-connect status` (395ms) is the "Connect to start earning"
  delay on /profile.
- **Neither is prefetched anywhere**, and 24 call sites set `gcTime: 5min`,
  which is below the threshold for React Query persistence to survive a
  rehydrate — so persistence covers the fast queries and excludes every slow
  one.
- Duplicate queries: `get_my_pending_direct_offers` ×2 per route,
  `applications?status=eq.pending` ×2, `profiles?select=ban_status` ×3 — raw
  `supabase.rpc` calls outside React Query, so no dedupe.
- CLS is 0.0000 on all five routes measured. This reads as slow, not broken —
  do not spend budget on skeletons.

## Messages screen
- **A selected thread should be the FULL page**, with back to return to the
  list. Today the list and the thread sit side by side and the thread is cut
  off. (owner, 2026-09-11)
- **Search: replace the "Cancel" text button with an × icon** —
  `ConversationList.tsx:790` (`ScreenHeaderRow`). "Cancel" is being cut off.

## Profile
- **Avatar has a square/rectangle behind the circle** — remove it. Seen on the
  profile header's 88px avatar (`AvatarFallback`), which is `rounded-full`, so
  the square is coming from something behind or around it, not the fallback
  itself.
- ~~Verified group should sort before As-a-Helpr / As-a-poster~~ — DONE,
  `RecognitionRow.tsx` GROUP_ORDER, not yet visually confirmed.

## Notification counts — REOPENED, my error
The owner reported the badge and the real numbers disagree, and noted I had
called this fixed. **They are right and I fixed the wrong thing.** Commit
`a93e5830b` only made the date-divider count LOOK like the panel's other quiet
text — a styling change. It never touched whether the numbers AGREE. Observed:
bell badge **10**, panel "Unread **11**". Two different sources of one count.
Find both and make one authoritative.

## Race conditions — proven on prod 2026-09-13 (terminal 3, seed accounts, all fixture rows deleted)
- **Same-frame double-click on Apply Now — FIXED (client), 2026-09-12.** Two clicks in one JS task sent 2 `apply_to_job` RPCs (server refused the 2nd; 1 row). Ref guard in `useApplyFlow`; prod-audit "SAME frame" case now dispatches a true same-task double and requires exactly 1 write: RED 2 writes on deployed prod, GREEN 1 on the guarded build. Same guard added to ResponseDeadlineDialog (hire), CompletionPrompts (review + tip), ReviewForm. **FIXED 2026-09-12:** `completeJob` (release) and `handleHelperResponse` (accept offer) now take refs owned by `useActivityActions`; same ref added to ReportDialog and the ManualVerify / FormalWarning / ResetPassword / RestrictApplications admin dialogs (vitest RED 2 calls / GREEN 1). Server verdict (prod, read-only): accept is REFUSED server-side (conditional UPDATE on `helper_confirmed_at IS NULL` re-checked under row lock → 0 rows), but the client then rolled back the first tap and toasted "no longer available"; release is NOT refused — deployed `create-payment` release reads the job then does an unconditional UPDATE, so a concurrent duplicate re-stamps `*_completed_at`/`payout_scheduled_at` and inserts duplicate notifications (no double transfer: one row, payout cron is idempotency-keyed). **CLOSED 2026-09-14:** release UPDATE conditional (93237acdf, re-measured 0/20, see Money section at top). **OPEN:** RichMessageInput send (sync `onSend` + stale `text` closure, not the same trivial shape).
- **Same-frame double release on the dispute paths — FIXED (client), 2026-09-12.** lh-money-escrow review of the completeJob/accept guards found two release entry points that bypass `completeJob`: poster Resolve & Pay (`PostedJobActions.resolveDisputeAndRelease`, `rpc_withdraw_dispute` + create-payment release) and admin Quick Release/Refund (`AdminDisputes.resolveDispute`, whose `resolving` state was set only after the biometric await). Both now hold a sync ref; `src/components/disputeReleaseInFlight.test.tsx` RED 2 requests with the guard stripped, GREEN 1. Server verdict re-verified live 2026-09-12 (downloaded deployed create-payment = repo; `trg_confirm_on_live_job` present): release still NOT refused server-side on a concurrent duplicate. **CLOSED 2026-09-14:** server-side release idempotency and admin_release_dispute/admin_refund_dispute idempotency (93237acdf, 0/20 each on prod, Money section at top). **OPEN:** one shared boolean per handler means a tap on job B while job A's release is in flight is silently swallowed (no money risk, no feedback) — per-id Set if it matters.
- **PROVEN 14/20 — apply vs cancel.** `enforce_application_job_state()` read the
  job without a lock; the INSERT then waited on the FK behind
  `poster_cancel_job()`'s `FOR UPDATE` and committed a `pending` application on
  the `cancelled` job (job xmin < application xmin in every bad round), with a
  "New application" notification to the poster who had just cancelled. Fix in
  migration `20260913014328` (`SELECT … FOR SHARE`). **Re-measured after
  db-deploy 34732902550 (d0471d07f): 0/20** — every round was apply-first or
  `job_not_open`. CLOSED.
- **PROVEN 5/20 — helper confirm vs cancel (money).** The plain-offer confirm at
  `useOfferHandlers.ts` is a client `UPDATE jobs SET helper_confirmed_at` with
  no status predicate; queued behind the cancel it stamped a CANCELLED job.
  `poster_cancel_job` had recorded `$0 / no strike / "no fee applies"`, but
  `void-cancelled-payments` recomputes committed from `helper_confirmed_at` and
  would have captured 25% ($25 of $100) from the poster. Fix in the same
  migration (`trg_confirm_on_live_job`, 42501 unless OLD.status ∈ open|accepted)
  plus `.eq("status","accepted")` on the client. PGlite: 16/16 after, 8 red
  before. **Re-measured after deploy: 0/20** — every cancelled row is either
  confirmed-then-cancelled (fee == cron fee, one strike) or unconfirmed with
  $0; a clean confirm on an accepted job still succeeds (1/1). CLOSED.
- **NOT REPRODUCED 0/20 — direct-offer accept vs cancel.** `respond_to_direct_offer`
  and `poster_cancel_job` both lock with `FOR UPDATE`; every round was either
  accept→cancel (fee $25 == cron $25, one strike) or cancel→`job_not_open`.
- **Unreachable — "apply at the old price".** `enforce_poster_jobs_money_lock`
  refuses `budget` once `payment_status <> 'unpaid'`, unfunded jobs are on no
  browse surface, and `applications` has no price column. No test written.
- **Class check BUILT 2026-09-12.** Static: `scripts/check-race-class.mjs`
  (+ `src/test/raceClassGuard.test.ts`) flags any plpgsql function reading
  `jobs` without `FOR SHARE`/`FOR UPDATE` before a decision + dependent write,
  and any client `.from("jobs").update()` of a lifecycle column (or an opaque
  payload) with no `.eq/.in("status")`. Red on the pre-fix function and client
  file, green on the fix. 36 grandfathered hits in
  `scripts/race-class-baseline.json` (only shrinks) — the ones marked
  "candidate" (settle_dispute_record, DisputeDialog, JobTracking
  helper_completed_at) are the next to lock/predicate.
- **Two-connection race runner BUILT** (`.github/workflows/race-runner.yml`,
  `scripts/ci/race-runner.mjs`): throwaway Supabase Postgres, same replay as
  db-smoke (`scripts/ci/replay-migrations.sh`), both races 20 rounds with a
  forced lock wait, a control write, and wrong-reason refusals counted as
  failures. Pre-fix (20260913014328 excluded): 20/20 BAD on both races.
  Nightly + on migration push; red files a `nightly-red` issue.

## Bugs found but not fixed
- [x] 2026-09-12 FIXED: stale-chunk reload stuck on "Something went sideways" when the one `?_v=` reload landed on the old build. `src/lib/chunkReload.ts` now allows a 2nd attempt after 30s, hard cap 2 (sessionStorage count + timestamp, `_v` fallback without storage), offline still never reloads; `src/lib/chunkReload.test.ts` (behavioural red on old code with exports stubbed: 5 of 7 fail, incl. (a) 1 reload not 2 and (b) old code reloaded 25x over 50 failures; offline tests pass on both). OPEN follow-ups from lh-silent-failure review: (1) while the backoff retry is pending, boundaries/`main.tsx` show and REPORT the card as a real failure, then the page reloads unannounced ~30s later: needs a "retrying" return/state; (2) pending retry timer is not cancelled if the user navigates to a working route; (3) `e2e/happy-path/stale-deploy.spec.ts` (mocked) asserts one reload within a short wait: rewrite for the 2-attempt model on prod per no-mock order; (4) `recoverFromChunkError` returns true and spends an attempt before `hardReloadBypassCache` actually reloads, which can bail offline or hang on SW/cache purge, leaving the "recovering" state stuck with nothing reported: needs a did-reload return, a purge timeout and a boundary watchdog; (5) `markChunkLoadSucceeded` only clears keys older than the 5-min episode that `readState` already ignores, so the reset is cleanup only, and only `lazyWithPreload` calls it.
- **CLOSED 2026-09-13, mock-only: sweep 143 admin-tiers "This page hit a problem".**
  The sweep fixture `get_helper_tiers` returned lowercase tiers (`elite/pro/rising`)
  that `AdminHelperTiers` has no icon for; prod returns `Verified`/`New` and renders
  (admin-e2e, 375; no HelperTiers row in `error_logs`). Fixture fixed; new prod check
  `e2e/prod-audit/admin-views.spec.ts` (every `/admin?view=*`, 26 green, shown red by
  feeding the prod bundle a lowercase tier). OPEN: the component still crashes on any
  unknown tier string (report, not fixed); `/admin?view=support` shows "We couldn't
  load the support queue" under that spec (probably its read uses a non-`get_` RPC
  the spec's write firewall refuses; unverified).
- **Every job card renders TWICE on /dashboard** (seen in the perf lane's
  screenshot). Unconfirmed cause.
- **No retry for a failed arrival.** `mark_helper_arrival` fires once and the
  tracker only moves forward, so a helper who denied location then enabled it
  has no way to re-verify and stays dependent on the poster.
- **No pre-expiry warning** on an accepted job — `AppliedJobCard` passes
  `expiresAt` only while pending, so the ghosting clock is invisible until it
  fires.
- **Complete Profile: input values clipped by the check icon at every phone
  width** (prod, 2026-09-12, Chromium + WebKit). `48b0d9b23` added the ZIP
  check with `pr-10`; at 375 the ZIP field leaves 29px for a 48px value and
  prod shows "705"/"528" (320→11px, 390→34px, 430→47px, all <48). Same class
  hits Last name ("Incomplet"). Edit Profile got a fixed ZIP column in
  `41cacda14`; Complete Profile did not. Repro: `admin-e2e`/`incomplete-e2e`
  sessions, `/complete-profile` at 375.
- **PostJob `PhotoUpload` focus ring never paints.** `dbed7befd` added
  `focus-within:ring-2`, but the label's inline `style={{ boxShadow: "inset …" }}`
  (`src/components/postjob/detailsSection/PhotoUpload.tsx` ~139-143, ~227-231)
  overrides Tailwind's ring (also box-shadow). Keyboard users get a named,
  focusable picker with no visible focus. Measured on prod 2026-09-12.
- **A brand-new account is asked to "Re-Agree"** — `TermsReconsentDialog`
  opens for a profile that never accepted any version (`terms_version_accepted`
  empty), on top of the Complete Profile gate. Copy says "re-agree" and
  "material update" to someone seeing the Terms for the first time. Seed
  accounts now pre-accept in `prod-seed.mjs` so the sweep gets past it.
- **Still unverified on prod after today's `dbed7befd`:** `role="img"` spans
  (no urgent/boosted/just-posted/pinned rows were live), admin KPI tile height
  + fraud-filter select 44px (now reachable via `admin-e2e`).

## Conventions half-applied
- **× vs labelled cancel.** `dialog.tsx` auto-hides the × when a
  `DialogSecondaryAction` registers — self-enforcing, by design. `sheet.tsx`
  renders `SheetCloseButton` unconditionally and shares none of it. Today's
  toast fix covered toasts only (2 of ~560 call sites).
- **`CardSubPanel`** was extracted today from PhotoProof; the same shape is
  hand-drawn ~59 more times.

## Verification debt
Everything shipped 2026-09-11 gated on typecheck + vitest only, because
Chromium was not installed until late in the day. **Nothing has been eyeballed**
except the guest /browse shell, the applicants card, and the poster photo
toggle. Owner's standing rule is that a visual is not done until it has been
looked at.

Harness contract for the helper job card, learned the hard way — two lanes
stalled on it:
- `useActivityData` needs BOTH the `applications` rows AND the RPC
  `get_jobs_for_my_applications` (SETOF jobs, no args), intersected on
  `job_id`. Mock only the `jobs` table and every app gets `job: null`.
- `HelperRevisionCard` reads the `job_revisions` table, falling back to
  `jobs.revision_note` — SINGULAR.
- Set `HAPPY_PATH_BASE_URL=http://localhost:5183`.
- Screenshot BEFORE asserting, and open the PNG. A spec here passed while
  photographing a page of skeletons because it asserted the capture succeeded
  rather than that anything was in it.

## Job card meta row
- **Location must always outrank "16 hours left".** At narrow widths the meta
  row drops the place name while keeping the expiry countdown — seen on
  `JobCard` in the browse feed with the map open. Where you are is the first
  filter a helper applies; how long is left is secondary. (owner, 2026-09-11)

## The job card is not one component — CONFIRMED
Owner asked directly ("is this all one component? if not fix it"). It is not:
- The category corner-tab (`rounded-br-lg rounded-tr-none`) is hand-rolled in
  **two** places — `activity/JobCardShell.tsx` and `dashboard/JobCard.tsx`.
- `activity/JobCardTitleBar.tsx` already owns title + price pill, and
  `dashboard/JobCard.tsx` reimplements the same thing inline instead.
- The price pill's literal colours (`hsl(var(--bark) / 0.10)` fill,
  `/ 0.28` border) are hand-written across 10+ files.

SEQUENCING, deliberately: this waits for lane `step-components`, which is
mid-flight defining the one shell both job cards fill. Retrofitting
`dashboard/JobCard.tsx` onto pieces whose API is still moving would be work
done twice. The moment that lane lands, the browse card adopts the same
chip / title-price / meta pieces — that is the fix, not a second set of
components.

## Notification count — STILL WRONG (reported again 2026-09-11)
My c14f86df4 fixed badge-vs-list DRIFT (setUnreadTotal was written once but the
list mutated in five places). It did not fix this. Do not re-fix drift.

One datum already gathered, prod: `lexilombas05@gmail.com` has **10** unread
notification rows, of types `application` and `new_offers` only. The bell
showed **10** — so the BELL IS CORRECT and the panel's "Unread 11" is the
wrong number. Start there, not at the badge. Suspect the panel's own
`unreadInPage`/tab-count derivation, or a row the list counts that the DB
query does not (optimistic insert, realtime dupe).

## Browse map — controls and preview card escape the map bounds
Owner, 2026-09-11 ("fix this bullshit"), with three screenshots:
- The **recenter button** (renamed 2026-09-14 by VN-11: it is now
  `browse-map-my-location` / `MyLocationControl`, and centres on the user) sits half
  outside the map's right edge — clipped against the boundary between the map
  and the page background.
- The **job preview card** (`aside`; the drag-handle + close-X header lane was
  removed 2026-09-14 by VN-9 — the sheet is now the card itself) is cut off
  at the bottom; its lower half runs past the visible map area.
Both are `position: absolute` inside the map container — check what is actually
establishing their containing block. CLAUDE.md's standing trap: any ancestor
with transform/filter/backdrop-filter/contain/will-change becomes the containing
block for absolutely/fixed positioned descendants, and the map's own chrome uses
backdrop-filter.
- **The preview card is not anchored to its pin.** Tapping a pin opens the card
  pinned to the BOTTOM of the map, nowhere near the marker that was tapped, so
  the reader has to work out which pin they are looking at. It should attach to
  (or at least point at) its own marker. Same screenshot set as above.

### Notification count — ruled out
`notifications.read` is `NOT NULL` in prod (10 false / 63 true for
lexilombas05), so the null-vs-false split between the server count
(`.eq("read", false)`) and the client filter (`!n.read`) is NOT the cause.
Next suspect: there are FOUR `<NotificationPanel />` mounts (DesktopTopNav,
AdminTopBar, DashboardTitleBar, DashboardHeader), each with its own
`notifications` array and its own `unreadTotal`, sharing no cache. Mark one
read and the others never hear about it. Lift the state into a shared query.

## Profile badges — "Verified" rung duplicates "Stripe verified"
The VERIFIED group shows "Stripe verified"; the AS A HELPR group directly
below opens with a ladder rung also called "Verified". Same fact, twice, two
inches apart. Drop the redundant one — the account-level badge above already
says it. (owner, 2026-09-11)

### DECIDED — At-a-glance stat tiles: exactly FOUR
Rating · Jobs posted · Jobs completed · Cancelled. (owner, 2026-09-11, via
pop-up, explicitly "im not asnwering this again".) Currently renders seven.
Drop: on-time %, rebooked %, needed-revisions %.

## CONSISTENCY — identity verification has FOUR renderings
One fact, four treatments, and the owner has raised this repeatedly:
1. Profile "Verified" group — **"Stripe verified"**, gold pill + shield icon
2. Profile "As a Helpr" group — **"Verified"**, ladder rung, different pill
3. Profile header — **"ID verified by Stripe"**
4. `dashboard/JobPosterCard.tsx:83` — **"✓ ID VERIFIED"**, uppercase, no pill,
   a literal ✓ character instead of the shield icon everything else uses

ONE component, ONE label, ONE treatment, everywhere. Pick the pill+shield form
(it is the one with an icon and a real badge primitive behind it) and delete
the other three. #2 is already logged separately as redundant with #1.

This is the class the owner keeps pointing at: the same fact hand-drawn per
surface. Same disease as the job card (three copies) and the price pill (10+).
- Profile: remove the white card behind the 'Finish setting up' payout banner (ProfileLanding, Profile.tsx:608) — the banner already has its own sienna-tinted surface; the liquid-glass box behind it is a second boundary. (owner, 2026-09-11)
- Reviews empty state: fix spacing — the 5-star illustration sits too close/tight above 'No reviews yet' (EmptyStateIllustration.tsx:37, EmptyReviews). Its viewBox is cropped ('2 34 116 26') so the glyph's own bounds don't match its visual weight. (owner, 2026-09-11)

## Shells leave a gap on the left and right — fix GLOBALLY
Owner, 2026-09-11: "on all these there shouldnot be a gap on the left or right
it needs to fill the space it stead rn ots showing like a small shadow look. so
fix these shells globally".

Seen on /profile?tab=availability: `AppShell` → `container mx-auto px-5 lg:px-8
xl:px-12` → `page-measure mx-auto`. The inner card stops short of the frame on
both sides, so the page reads as a narrow sheet floating on a wider surface
rather than filling it. This is the SHELL, so it affects every AppShell page —
fix once in the shell, never per page.

## Time picker regressed to a native input — restore the scroll wheels
Owner, 2026-09-11: "this needs to be a scroll how it was before how hour time
and ap pm". The Set-hours popover now renders a native `<input type="time">`
("05:-- PM" with a clock affordance) instead of the previous hour / minute /
AM-PM scroll columns. Native time inputs are keyboard-first and look different
on every platform — which also breaks the one-surface rule, since iOS, Android
and desktop each render their own. Restore the wheel picker.

## Availability: "Until 2:44 AM" is a hardcoded 4 hours nobody chose
`AvailabilityTab.tsx:73` calls `set_available_now` with `p_hours: 4`; the live
RPC is `p_hours numeric DEFAULT 4` → `available_until = now() + 4 hours`. The
card then prints "Until <that time>" as though it were a setting the helper
picked. Tap it at 10:44 PM and it announces you as available until 2:44 AM.

Worse, the SAME SCREEN holds a second, unrelated availability system: the
weekly Sun–Sat grid (9 AM–5 PM). The grid says 9–5, the toggle says until
2:44 AM, and neither reads the other. One fact, two systems — decide which is
authoritative, and either let the helper choose the duration or derive it from
the grid's hours for today.

## From the state-matrix sweep (logged 2026-09-11)

Real screen count, derived from code, not guessed: 28 routes that render a
screen + 26 Profile tabs + 25 Admin views + Activity/Legal sections = **~73
signed-in screens**, plus **94 files containing an overlay**. 73 + 94 = ~167,
which is where "162" comes from. The owner's number was right.

- [x] **S1 · DONE (a520a50a8).** Cause: these pages pick skeleton-vs-error from
      the query's settled state, so the shared retry schedule IS the
      time-to-error. `queryClient.ts` had `retry: failureCount < 2` on TanStack's
      default backoff — three round trips plus three seconds of pure waiting.
      Now one retry with an explicit capped `retryDelay`. Measured at 375:
      /my-jobs **3.41s -> 1.15s**, /my-posts 3.42 -> 1.40, /messages 3.39 -> 1.14,
      /dashboard 1.44 -> 1.24. Retries were NOT removed — a spec that fails the
      first read then succeeds proves a blip still self-heals with no error card.
      Original report: **A backend failure shows ~20s of skeletons.** SEEN
      on /dashboard, /my-jobs, /my-posts, /messages, both widths. The designed
      "We couldn't load this / Try again" card only appears after React Query
      exhausts retry+backoff. Until then: blank pills, no message, no way out.
- [x] **S2 · DONE (a520a50a8).** Cause: `useActivityData` returned
      `loading: isLoading`, and `isLoading` is `isPending && isFetching` — false
      in exactly the two states where there is no answer yet: a disabled query,
      and a cached-empty result being refetched. So the empty state rendered
      while the read that would return the user's work was still in flight. Now
      the skeleton holds until the tab's core query has settled, and keeps
      holding during a refetch only when there are zero rows to show (so a
      background refetch never blanks an existing list). False-empty window
      **3.7s -> 0s**. Original report: **A false empty state flashes.** SEEN on
      /my-jobs at 375: "No applications yet" at 3.8s, then at 15s the same page
      says "you have 1 in Waiting". The user is told they have nothing while
      they have work.
- [x] **S3 · DONE — it was the MOCK, not the app.** `WorkRecord.tsx` reads the
      profile with `.single()`; the Playwright fixture ignored the
      `Accept: application/vnd.pgrst.object+json` header and returned an ARRAY,
      so `created_at` was undefined (`Invalid Date`) and `full_name` was
      undefined ("Helpr Member" — visible in the same screenshot). Live, both
      render correctly, and prod has 0 null `created_at` across 8 profiles.
      Fixed at source with `honourSingleObject()` in the fixture, which now
      unwraps one row or returns 406/PGRST116 like real PostgREST.
      Original report: **Work Record prints `Invalid Date`** in MEMBER SINCE — on a document
      framed as an Employment & Earnings Record for an employer.
- [x] **S4 · DONE — and Work Record was the one lying.** The Reviews tab filters
      `feedback_visible_at <= now()`; Work Record had NO reveal filter, so it
      counted reviews the app deliberately hides during the blind window. In
      prod this never surfaced only because the `reviews` SELECT policy enforces
      the reveal — verified live: as an ordinary member, 0 of 16 blind-window
      reviews are readable. **An employer-facing number must not lean on RLS for
      its correctness**, so the filter is now explicit in the page. The mock had
      a second cause: `SEED_REVIEWS` lacked `feedback_visible_at`, a column the
      prod trigger always stamps. Both fixed; the two screens now agree.
      Original report: **Two screens disagree about the same reviews.** Work Record says
      AVG RATING 4.5 (2); ?tab=reviews says "No reviews yet". Same account,
      same session.
- [x] **S5 · DONE.** The desktop rail wrapped `EmptyState variant="inline"`
      (which paints its own fill and border) inside a `.liquid-glass` card. Added
      a `bare` variant that carries layout and paints nothing. Measured:
      liquid-glass boxes in the panel **2 -> 1**, then eyeballed. Every other
      Profile tab checked at 1440 — no other nested card.
      Original report: **Nested white card inside the white panel** at
      /profile?tab=pets @1440 — the 2026-09-07 defect at a width nobody rechecked.
- [x] **S6 · DONE.** The chip row was `overflow-x-auto scrollbar-hide` — a
      horizontal scroller with no affordance, and a mouse has no horizontal
      swipe. Now wraps. Chips fully inside the card: 1440 **10/11 -> 11/11**,
      375 **2/11 -> 11/11**. Eyeballed both.
      Original report: **Skills chips clipped mid-word** at /profile?tab=profile @1440
      ("Eve…"), no scroll affordance.
- [x] **S7 · NOT A DEFECT — the mock again.** The sweep's RPC catch-all returns
      `null` for `get_helper_analytics`, and the page's `!data` branch correctly
      renders the error. Live, the RPC returns a full payload and the page
      renders the UPGRADE panel at both widths. The app is right; the temporary
      spec was incomplete. Original report: **?tab=analytics error state.**
- [x] **S8 · DONE.** The sentence was sharing a tinted box with the 44px
      switch. Switch moved up to the heading row; the sentence gets the card's
      width. Measured: description **204px / 4 lines -> 293px / 3 lines**,
      switch top 508 -> 445. Eyeballed.
      Original report: **"Instant Release" body wraps in a ~250px column** inside a
      full-width card, ?tab=auto_tip @375.
- [x] **S9 · NOT A DEFECT — deliberate.** It is `TITLE_CARD_STYLE`'s top-right
      burnt-sienna radial glow, present on every title card. Sampled 254->251 RGB
      across the right half, identical live and in the original screenshot. Left
      alone. Original report: **Messages header pill grey band** across its right
      half, @1440 empty.

Clean: zero horizontal overflow on all 54 captures; every empty state on the 15
previously-uncaptured Profile tabs is designed, not blank.

## Needs the owner — prod write

      Original report: **Duplicate seed family.** `jobs` holds two exact mirror families,
      `5eed0a…` and `5eed0b…`: 26 jobs / 24 applications / 80 messages EACH,
      all 26 titles+statuses matching pairwise, identical `created_at`. The seed
      script ran twice. This is why every job card looks doubled on /dashboard —
      it is duplicated DATA, not a render defect. Deleting one family is a
      destructive prod DELETE of ~130 rows; either family is equivalent.

## Closed 2026-09-11

- [x] **Notification panel count — ROOT CAUSE FOUND, fixed in 74bb850a9.** The
      two numbers were never out of sync; the LIST was. The bell and the chip
      read the same variable in the same component, so they cannot diverge. The
      panel fetched the latest 50 by `created_at` (a recency page) while the
      badge counted unread across the whole table. Different sets. On the
      owner's account: 73 rows, 10 unread, 63 read — and the ten unread rank
      53rd-62nd, because 63 read rows landed after them. So the page contained
      zero unread while the chip correctly said 10. Re-measured through the real
      component at that exact row shape: **unread rows rendered 0 → 10**. This
      also un-breaks Mark all read, which derived its ids from the page, found
      none, and returned early — a silent no-op on the one account that needed
      it. My three previous attempts were all correct and all irrelevant: no
      amount of sharing one variable makes a page contain rows it never asked
      for.
- [x] **Job cards render twice — was duplicated seed data, not a render defect.**
      Closed by the prod delete above.
- [x] **Browse map pin anchoring.** Nothing mirrored MapKit selection into the
      DOM, so every pin stayed 44x44. Selected pin is now 64x64 with a halo and
      a caret in that pin's screen column. Recenter and card overflow did NOT
      reproduce (12/13px inside; the card sits 112px above the edge, which is
      `MAP_DOCK_CLEARANCE`) so they were left alone.
- [x] **Arrival retry.** `mark_helper_arrival` verified idempotent live — a
      second call can only add the verified stamp. "Try my location again" added
      while arrival is `claimed`; it never advances the rail.
- [x] **Hardcoded availability vs the weekly grid.** The grid is authoritative:
      it is the only one the helper configured. Was "Until 2:44 AM" over a 9-5
      grid; now "Today's hours ended at 5:00 PM · signal 2 more hours". A
      MISSING row resolves to what the grid draws, not to "off" — reading it as
      "off" reintroduced the contradiction in one step, caught by screenshot.
- [x] **Time-picker scroll wheels.** The native-input swap was keyed on the
      DEVICE while the problem it solves is the CONTAINER, so it fired inside a
      fixed 300px popover too. Wide desktop forms keep it; the popover opts out.
      Verified `nativeTimeInputs: 0`, wheels + AM/PM at 1440 and 393.

Not a defect: the lone `animate-pulse` is `MobileNav.tsx:779`, the `aria-hidden`,
`motion-safe`-gated halo behind the Post FAB. Screenshot specs should exclude
`[aria-hidden]` rather than assert "no pulse" — and note a `.animate-pulse`
class selector misses it entirely, since it is `motion-safe:animate-pulse`.

Open, small: the bell abbreviates at "99+" while the chip prints the true total.
Now reachable in prod. Mild disagreement, not yet fixed.

- [x] **`Admin.tsx` / `UserProfile.tsx` "hand-roll min-h-screen" — NOT a defect,
      2026-09-11.** I filed these two myself and I was wrong. CLAUDE.md defines
      TWO legitimate page shapes, and document-scroll pages are supposed to use
      a plain `min-h-screen bg-premium-page pb-safe-nav` wrapper and explicitly
      NOT `AppShell`. Both `/admin` and `/user` are in `DOCUMENT_SCROLL_ROUTES`.
      `ALLOWED_SHELLS` had no entry for their category, so the test manufactured
      two offenders. The danger was the FRAMING, not the false positive: the
      comment said the list "must only ever SHRINK" and "deleting an entry is
      the fix", which aims the next reader at wrapping both in `AppShell` —
      breaking them twice (clipped below the fold under `overflow: hidden`, and
      a second rail inset on top of `#root`'s). Category now derives from
      `DOCUMENT_SCROLL_ROUTES`, exempt-by-name is gone.
- [x] **`/terms`, `/privacy`, `/rules` lost their native viewport lock — FOUND
      BY THE NEW GATE, fixed 2026-09-11.** `8570fdbef` made them real routes
      three commits ago and added them to `DOCUMENT_SCROLL_ROUTES` but not to
      `NATIVE_APP_SHELL_ROUTES`. On native they rendered `Legal.tsx` through
      `AppShell` with no `html.app-shell` class — the internal scroll container
      without the lock that makes it work — on three quarters of the legal
      surface, which is exactly the iOS notch-ghosting bug that list exists to
      prevent. Gate proved by mutation: every half fails when broken.
- [x] **"7 dead page files to delete" — WRONG, do not delete them (2026-09-11).**
      `AutoTip`, `HelprWrapped`, `HomeHistory`, `PetProfiles`, `StrSettings`,
      `HelperAnalytics`, `WorkRecord` and `GiftCard` are all LIVE: every one is
      imported by `src/pages/profile/ProfileTabPanels.tsx` and renders as the
      body of a Profile tab. They are unROUTED, which is what the orphan check
      reported, and "unrouted" was read as "dead". Deleting them would have
      blanked eight Profile tabs. The orphan assertion should say "routed by
      nothing AND imported by nothing" — as written it describes a real
      condition but names it misleadingly.

## Public-site visual pass (lead, 2026-09-11) — 20 routes captured at 375 and 1440

- [x] **Automated-test debris on the PUBLIC browse page — DONE 2026-09-11.**
      Deleted the 19 test jobs that carried no financial records (with 12
      applications, 7 reviews and 117 notifications), including BOTH publicly
      visible rows. Backup: `docs/backups/test-debris-backup-2026-09-11.json`.
      Re-measured the finding's own repro: test titles in `open_jobs_browse`
      **2 -> 0**, and confirmed by eye in a fresh capture of guest `/browse` at
      375 — the `[sweep-poster]` card is gone.

      **49 rows deliberately NOT deleted.** They carry payout_transfers,
      refunds, tips, disputes, W9 or gift card records. `payout_transfers` is
      ON DELETE RESTRICT, so a settled job cannot be deleted by anyone anyway —
      and deleting settled money to tidy a list is worse than the list. None of
      the 49 is `open`, so none is publicly visible.

      **My "the spec never cleans up" claim was WRONG — correcting it.**
      `scripts/e2e/prod-lifecycle-sweeper.mjs` already exists, already runs in
      `e2e-real-backend.yml`, and already documents this exact residue and the
      exact ON DELETE RESTRICT constraint I then hit. The evidence it works:
      the newest test row is 2026-09-09, and dozens of CI runs have happened
      since with zero new rows. The accumulation had already stopped before I
      looked; what I deleted was historical residue from before it landed. The
      The sweeper keys on `[E2E DO NOT ACCEPT]` and never covered the 7
      sweep-harness titles (`[SWEEP]`, `[sweep-poster]`, `Sweep test`), which is
      where both public rows came from — but that is NOT a gap to fix either:
      grepped the whole repo and nothing creates those titles. The only match is
      a code COMMENT in `HelperRevisionCard.tsx:75` citing "the [SWEEP] patio
      job". They were typed by hand by an audit lane on 2026-09-07/08. No
      recurring source, so no sweeper change is warranted. NOTHING TO DO HERE.

      Original report: **Automated-test debris is live in prod.** SEEN at 375 on guest `/browse`: the first card
      reads `[sweep-poster] Deep clean before...`. Prod holds **68** such rows:
      61 titled `[E2E DO NOT ACCEPT] automated lifecycle …` and 7 from the sweep
      harness (`[SWEEP] …`, `[sweep-poster] …`, `Sweep test — …`). All are
      `is_seed = true`, so the launch switch will hide them — but that is an
      argument about launch day, not about today, and a visitor on the site now
      sees a bracketed test title as the top job. Two are `status = 'open'`:
      `[sweep-poster] Deep clean before move-out` and
      `Sweep test — deep clean kitchen`.
      The growth matters as much as the rows: first seen 2026-09-07, last
      2026-09-09, ~20 a day. The E2E lifecycle spec creates and never cleans up.
      Deleting is a prod DELETE; the spec also needs to clean up after itself.

Verified clean, so these can stop being re-reported:
- **Legal tab pills are NOT unequal.** Measured all three at 375: Terms, Rules
  and Privacy are each exactly **86px**, `flex: 1 1 0%`. The selected pill only
  READS wider because it is the filled one. Backlog item was stale.
- **The selected Legal pill does carry real gloss.** Computed `background-image`
  on its `btn-grad-primary` child is a genuine `radial-gradient(...)`, not a
  flat fill — checked the computed value, not the class name, per CLAUDE.md.
- **The grey Apple chip in the footer is deliberate**, not a broken asset:
  Apple and Instagram are `disabled` "coming soon" chips, Facebook is the only
  live account. Reasoned in the code.
- **The 404 page is fine** — "404", an explanation, Go Back and Back to Home,
  with the marketing footer. The temp spec's matcher was wrong, not the page.
- **/legal at 1440 fits correctly**: `#root` padding-right 248px applied once,
  content column 48→1144 centred in the 1192 post-rail area, zero overflow.
- **/dashboard at 375 fits**: frame 0→375 full width, zero overflow. Five
  distinct job cards, no doubling — the seed delete is confirmed VISUALLY, not
  just by a row count.

## Reports from the loading-states lane (not fixed, out of its scope)

- [x] **DONE f2b63d921.** Repro confirmed exactly: load /my-jobs empty, add an
      application server-side, reload -> **0** network requests for 60s while the
      page states the account has nothing. The persisted IndexedDB cache is what
      lets it survive a reload. Fix: `refetchOnMount: "always"` on the two
      activity CORE queries. Measured: `/rest/v1/applications` requests after
      reload **0 -> 1**; "No applications yet" at t=5s and t=8s **shown ->
      never**. Deliberately NOT `staleTime: 0` (that destroys the cache's
      purpose — every observer, tab switch and focus becomes a fresh wave), and
      NOT a zero-row-only stale window (a cached list of three that is now four
      is wrong the same way; the defect is "we re-showed a cached claim without
      checking it", not "empty is suspicious"). Cores only — details re-key off
      the core result and refetch anyway. Regression checked: populated cache +
      a 6s-slow revalidation paints rows at 800ms and never blanks to skeleton.
      Original report: **60s-stale empty list with NO refetch.**
      Within `CORE_STALE = 60s`, a user who just gained an application saw
      "No applications yet" for the full staleness window with zero network
      requests issued. Not a loading-state bug, so that lane left it — but it is
      a real "your work is invisible" window.
- [x] **DONE f2b63d921.** The toast now fires only when the panel is open and
      ALREADY showing rows. Measured: toast alongside the page's error card
      **t=1.5s to ~5s -> none**. Panel opened while failing with no rows still
      shows its inline card with Try again, 0 toasts. Eyeballed at 375 — one
      card, nothing floating over it.
      Original report: **two error messages for one outage** — a persistent
      inline "Couldn't load notifications — try again?" banner lingering ~4s
      beside the page's own error card.
- [x] **DONE f2b63d921 — and it was MUCH worse than I reported.** I said "10s
      plus a retry". It was **three** attempts: the query carried its own
      `retry: 2`, which is exactly why a520a50a8's retry-schedule change never
      reached it — this was the one query silently opting out of the shared
      client policy, so the global fix looked applied and wasn't. Measured
      against a hanging `/rest/v1/profiles`: time to "We couldn't load your
      account" **32.2s -> 13.0s**. Timeout 10000 -> 6000, and the local `retry`
      override removed so one place decides time-to-error. That also stops it
      retrying 4xx profile errors, which it was doing.
      Original report: **PROFILE_QUERY_TIMEOUT_MS is 10s per attempt.**
      Against a HANGING (not 500ing) backend, ProtectedRoute's account-level
      error card still costs 10s + a retry. The retry-count fix helps, but the
      10s timeout is the dominant term there.
- [x] **DONE — confirmed viewport-independent.** /my-jobs 935ms @1440 vs 923ms
      @375; /dashboard 1906ms @1440 vs 1910ms @375. Screenshots opened and
      looked at: designed error card, rail correct on the right, no dead gutter.
      **Measurement caveat worth keeping:** the pre-fix /dashboard number read
      1384ms and post-fix 1906ms. That is NOT a regression — the locator
      `/couldn't load/i` was matching the notification TOAST before it was
      removed. A measurement that was quietly measuring the wrong thing, which
      is the exact hazard CLAUDE.md names.
      Original report: **1440 not re-driven for S1/S2.** The fix is entirely in the data layer so
      it is viewport-independent, but it was verified at 375 only.

## CI reliability (lead, 2026-09-11)

- [x] **The anon surface contract failed the build on a lie — fixed d5b193c56.**
      `E2E real backend` went red at `b7bc81eb` with: *"public.get_ranked_open_jobs
      — the anon ranked-jobs RPC surface — answered anon with HTTP 504. A
      signed-out visitor sees nothing there."* None of that was true. I checked
      the object rather than the message: it is not a view and not broken — it
      is `get_ranked_open_jobs(integer,integer,boolean,numeric,numeric,numeric)`,
      runs in **31ms**, and has no client caller. `probeSurface` decided the
      object's kind from `table probe status !== 404`, so ANY transient gateway
      error short-circuited to `kind: "view"` carrying the 5xx, and the failure
      text then described a public outage that was not happening.
      The next push went green with nothing fixed — the self-healing red
      CLAUDE.md warns about twice. Re-measured against live prod:
      `504 view … rows=-` **→** `200 rpc … rows=9`, whole contract passes.
      Worth noting this was NOT caused by the seed/test deletes, which is the
      first thing I checked given the timing.

- **Notification count — CONFIRMED BY EYE 2026-09-11, on real prod data.** Not a
  count, not a test: opened the panel at 375 in Chrome against the owner's own
  account and LOOKED. Bell badge **10**, "Unread" chip **10**, "THIS WEEK 10",
  and **ten actual unread rows** rendered, each with its unread dot, default tab
  Unread. The panel is 375 wide and 650 tall at top 86 — full width, correctly
  sized, so it is not caught by the transformed-ancestor `position: fixed` trap.
  After three fixes I called done without looking, this one was looked at.

  Aside, not a defect: the bell's click did not register through the browser
  pane's synthetic click; a real `.click()` opens it. Worth knowing so nobody
  files "the bell does nothing" from an automated driver.


## The mock boundary lied three times in one sweep (2026-09-11)

Three of the seven state-matrix "defects" (S3, S4-in-part, S7) were the
Playwright fixture, not the app — and they were filed as SEEN because they WERE
seen, in a screenshot. This is the `mock-boundary-is-why-audits-missed-it`
pattern running in reverse: usually the mock hides a real defect; here it
manufactured three. Both directions have the same root: **a fixture that does
not behave like PostgREST**. The `.single()` bug is the sharpest case — the
fixture ignored the object-Accept header for every `.single()` call in the app,
so ANY page reading one row got an array and rendered undefined fields.
Fixed at source, so the next sweep inherits a fixture that tells the truth.

Two follow-ups worth keeping:
- [x] **`formatMonthYear` printed `Invalid Date` — DONE 7b4cbc59a.** It now
      returns null and the Work Record drops the whole "Member since" field.
      An absent row reads as "not shown"; the literal string reads as a fact
      about the person, on a document framed to its reader as an Employment &
      Earnings Record for an employer. Prod cannot produce it today, but the
      page reached exactly this state on 2026-09-11 via the fixture bug. Proved
      by stashing the guard: the new test fails `expected 'Invalid Date' to be
      null` without it, 20/20 green with it.
- [x] **`zz-tmp-state-matrix.spec.ts` DELETED** along with the other three temp
      sweep specs. It mocked only two RPCs, so any RPC-backed tab always showed
      its error state in it — which is how it manufactured the analytics
      "defect". A spec that produces confident, empty evidence is worse than no
      spec.


## New, from the data-freshness lane (2026-09-11)

- [x] **DONE e59a7ff85 — reproduced, then fixed.** With every non-account read
      500ing at 1440: "We couldn't load jobs." at x=93 and "We couldn't load the
      map." at x=663, side by side — two triangles, two Try again buttons. The
      desktop map column is now gated on the EXACT condition the feed uses for
      its own card, so the two cannot disagree. Cards **2 -> 1**; card width
      **481 -> 1006** (spans the panel). `mapVisible` untouched so the column
      returns the moment the feed has rows; healthy 1440 re-verified unchanged.
      The map toggle is disabled while that card is up, since with the column
      suppressed it would be an affordance guaranteed to do nothing.
      Original report: **two error cards for one outage** — "We couldn't
      load jobs" and "We couldn't load the map", side by side
      (`/tmp/freshness/r4-dash-1440.png`). Each panel legitimately owns its own
      read and the map panel only exists at desktop, but it is the same
      one-outage-many-messages shape just fixed for the toast. Desktop dashboard
      layout was not that lane's scope.
- [x] **NOW EXECUTED (b941fbfcd).** `NotificationPanel.refreshToast.test.tsx`
      renders the real panel and drives the real `loadNotifications` through the
      pull-to-refresh callback. Open panel with rows + failed refresh → toasts;
      closed panel → silent. Proved both ways: removing the branch fails one
      test, making it unconditional fails the other.
      Original: **One branch is code-verified but NOT runtime-verified.** The notification
      toast's "panel open and already showing rows" branch is only reachable via
      pull-to-refresh or a realtime event; the harness stubs realtime inert and a
      synthetic touch gesture did not fire the pull handler (instrumented: 0
      notification requests after the gesture). The branch was kept because it is
      the conservative narrowing — without it that case goes silent — but it was
      not proven to fire. Said plainly rather than counted as verified.

## The audit apparatus was the bug (lead, 2026-09-11)

- [x] **The admin visual sweep had never photographed a single admin view — fixed
      431d63125.** Ran it myself. All 25 admin captures came back
      **byte-for-byte identical**: every one a photograph of
      `RouteErrorBoundary`'s chunk-load state ("Update ready."), and the run
      reported **25 passed**. axe is perfectly happy with an error boundary — it
      is a heading and two buttons, and it is accessible. So the one check the
      file exists to perform had never run against a single admin view, and said
      green. The gate already failed a screen that did NOT render (a thrown test
      leaves `totalViolations` undefined); it did not fail a screen that rendered
      SOMETHING ELSE, and that hole was wide enough to drive the whole admin
      surface through. Now every capture is checked for the crash boundary, the
      chunk-load boundary and the account-error card. Proved both ways: red
      against the dev server naming both screens, green against a correct build.
      A second, quieter hole found on the way: without `PLAYWRIGHT_WEB_SERVER=1`
      all 25 tests pass in **672ms writing no images at all**.
- [x] **The 25 admin views are now actually captured** — 25 PNGs, 25 distinct,
      in `/tmp/ui-review/`. Admin Jobs and Admin Health both render correctly and
      read well. This is the first time anything in Admin has been looked at.

- [x] **Nested white card inside white card — SUPERSEDED.** The owner ruled on
      this (see "Nested white cards" under Owner decisions below); a lane is
      applying it. Kept for the evidence, not as a separate task.
      Original report: **Nested white card inside white card — SYSTEMIC.**
      Two lanes hit it independently today: `/profile` landing draws 4
      (`SettingsSection.tsx:44` — each WORK / MONEY group is a `liquid-glass`
      card inside the outer `liquid-glass` wrapper), and Admin Health's
      "Configuration Checks" does the same (white bordered rows inside a white
      bordered card). It is the 2026-09-07 defect class. It is NOT being fixed
      unilaterally because the code records the owner ASKING for the eyebrow
      grouping ("better organization", 2026-08-24). Suggested shape: keep the
      eyebrows and the inner cards, drop the OUTER wrapper's material.

## Notification duplicates — I was wrong, and the lane found the real one

- [x] **My four "duplicate" groups were a FALSE POSITIVE — retracted.** My
      grouping key omitted `link`. Each "pair" was two DIFFERENT jobs with
      identical titles: `/jobs/5eed0a10-…-005` vs `/jobs/5eed0b10-…-005` — the
      duplicate seed families. One sweep run legitimately visited both copies, so
      `NOW()` matched to the microsecond. With `link` in the key: **0 groups over
      14 days**. `sweep_job_start_reminders()` was read live via
      `pg_get_functiondef` and is correct — single-table scan, no join
      multiplication, gated on `start_reminder_sent_at IS NULL`. My "join
      fan-out" hypothesis was wrong. The `admin_alert` repeats are also correct
      (24h dedupe window; those timestamps are 30h apart).
- [x] **The REAL defect, found by widening the search — fixed 870279f8f.**
      `saved-helper-availability-push` stores its "already notified" cursor with
      `.update(...).eq("user_id", id)`. For a customer with **no `profiles` row**
      that matches zero rows and PostgREST returns `{ data: null, error: null }`,
      so the `if (updateErr)` branch never fired, the cursor never advanced, and
      the identical notification re-sent **every 6 hours forever**. This is
      exactly CLAUDE.md's "a null error does NOT mean the write happened".
      Live: **40 byte-identical rows** to one user, timestamps exactly `:41`
      every 6h since 2026-09-07, still growing — and that user has no row in
      `profiles` OR `auth.users`. Fix: skip a pair whose cursor cannot be stored,
      and guard the write with `.select("user_id")` treating 0 rows as a defect.
      Plus a BEFORE INSERT trigger refusing an exact repeat of
      `(user_id, type, title, message, link)` within 10 minutes, counted in
      `notification_dedupe_suppressions` so suppression is never silent.
      Window chosen from the live table, not taste: across all 580 rows in
      history exactly ONE pair would have been caught. Migration applied 3x under
      PGlite (replay-safe); new test has a negative control so it cannot pass
      vacuously. Existing 40 rows NOT deleted — not authorised.

- [x] **SUPERSEDED — see the full investigation under Owner decisions below.**
      Original report: **`favorite_helpers` has no FK** — 7 of its 12
      live rows point at a customer in neither `profiles` nor `auth.users`.
      `notifications.user_id` has no FK either, which is how rows were written
      for a user that does not exist. Reachable with no other bug.

## Authed visual sweep — REAL session, not mocks

- [x] **Messages painted a broken-image glyph for the other party, every row and
      the thread header, both widths — fixed 4a8690448.** Verified live: that
      profile has a truthy `avatar_url` and storage answers **HTTP 400**.
      `ConversationRow` and `ChatHeader` each hand-rolled an `<img>` with no
      error path, so the browser drew its broken-image icon. `/user/:id` showed
      initials for the same person because it goes through `UserAvatar` — the
      hand-rolled copies were the bug, exactly the "never hand-roll" rule. Both
      now use `UserAvatar`. Re-measured: visible broken `<img>` **10 -> 0** at
      both widths, 14 monograms painted.
- [x] **/payment-success at 1440 pinned its card to the left edge** with ~940px
      of dead canvas — fixed in the same commit. AuthShell's column defaults to
      `items-start` and this page has no brand panel to balance it. Re-measured:
      card 48–496 **->** 496–944, centre 720 = viewport centre.
- [x] **DONE e59a7ff85 — and WORSE than I logged it.** The toast does not
      overlap the title card, it REPLACES it: toast y 8–84, the title card owns
      the same band, so `<h1>My Jobs</h1>` is invisible and its two controls —
      **"Search jobs" and "Filter by status" — are unreachable for the full
      12 seconds**. No offset fixes that; the title card owns the top band by
      design. The shared `<Toaster>` was NOT moved: the nudge alone opts out per
      toast to `bottom-center`, and only below the Toaster's own 768px
      breakpoint, so at 1440 it is untouched. The added bottom offsets were
      verified inert for top-anchored toasts rather than assumed — an ordinary
      toast still lands at y 8 at 375 and y 24 at 1440. Nudge at 375
      **y 8–84 over the title -> y 640–716**, 32px clear of the dock; occluded
      controls **2 -> 0**.
      And the answer to why it fired on /my-jobs but not /dashboard: it is not a
      global toast at all. `usePushPermissionNudge` is called only from
      `Activity.tsx` and `useActivityActions.ts`.
      Original report: **"Get notified?" toast covers the My Jobs title card** Measured:
      toast at y 8–84, the `<h1>` at y 31–51, and `elementFromPoint` over the
      title returns the toast. Harmless at 1440. Moving it means changing the
      toaster position app-wide, so it belongs to whoever owns toasts.
- [x] **DONE e59a7ff85 — it DID reproduce.** There is no denied or banned
      account in prod, which is why nobody had ever walked into it; the lane
      rewrote `approval_status`/`ban_status` in the profiles RESPONSE client-side
      so both screens rendered for real — **no prod row was mutated**. Both were
      left-pinned at 1440: card x 48–496, centre 272 **->** 496–944, centre 720
      (= viewport centre, no rail on these routes). 375 unchanged. Fixed with
      `centerColumn`, the same prop `/payment-success` uses, applied to the
      loading skeleton as well as the loaded branch so the card does not jump
      when the profile lands.
      Original report: **AccountDenied / AccountBanned likely share it** —
      same `AuthShell` call with no `centerColumn`, where AccountPending passes
      `align="center"`. CODE READ ONLY, not reproduced live, not touched.
- [x] **DONE afe650635.** Measured before: /my-jobs 1 panel at x 48–1144 (w
      1096), inbox 1 panel, **thread 0 panels** at both widths — it painted
      straight onto the canvas. `ChatPaneShell`'s standalone branch now renders
      through `PageScaffold` (the shared shell, NOT a hand-rolled panel), which
      is a thin wrapper over the same `AppShell`, so the 100dvh lock and
      bottom-nav reservation are unchanged. After: thread **1 panel, x 48–1144,
      w 1096, radius 24, 1px border — byte-identical geometry to /my-jobs**;
      375 matches the inbox. The stop-condition was checked rather than assumed:
      internal scrolling survives and the composer still reaches the viewport
      edge, with all 14 `messages-thread.spec.ts` specs passing. The lane also
      caught itself: re-using the page gutter inside the card pushed the
      composer controls to x=40 at 375 and clipped "Type a message…" mid-word —
      spotted in the SCREENSHOT and backed out.
      Original report: **open thread at 1440 has no card boundary** — every other
      authed page draws in a panel; the thread paints straight on canvas with a
      composer whose white band ends abruptly. Centred correctly. Design call.

Clean and worth recording: every authed route measured **zero horizontal
overflow** at 375 and 1440, and at 1440 the rail inset was applied exactly once
on every one.

## Deploy + gate verification (lead, 2026-09-11)

- [x] **Both halves of the notification fix are LIVE in prod, verified by object
      state rather than run colour** (CLAUDE.md: a green run is not a deploy).
      `Supabase DB Deploy` green on 870279f8f, and in prod
      `to_regclass('public.notification_dedupe_suppressions')` resolves and
      `pg_get_triggerdef` shows
      `CREATE TRIGGER suppress_exact_duplicate_notification BEFORE INSERT ON
      public.notifications FOR EACH ROW`. `Supabase Edge Functions Deploy` also
      ran and succeeded on the same sha, so the cursor fix is live too.
      (I briefly thought the trigger had not landed — my own query filtered on
      `tgname ilike '%dedupe%'` and the trigger is named `suppress_…`. The
      filter was wrong, not the deploy. Worth recording because "verify by
      object state" only works if the query actually asks the right question.)

- [x] **I broke CI and CI caught it — 5f7113ba1.** Making `formatMonthYear`
      return `string | null` broke the PDF export, which assigns it into a
      `[string, string]` column tuple: `TS2322` in `workRecordDocument.ts:395`.
      I had gated on `parsecheck` + a scoped vitest run and never ran the
      typecheck — which is precisely the case CLAUDE.md describes when it says a
      clean parse is never a substitute for `tsc -b --noEmit`. Fixed by dropping
      the column rather than coercing it, matching the on-screen behaviour.
      Full typecheck now clean, 20/20 tests green.

- [x] **Temp sweep specs deleted** (`zz-tmp-authed-verify`, `zz-tmp-public-verify`,
      `zz-tmp-state-matrix`, `zz-tmp-thread-verify`). They were untracked, so CI
      never saw them, but they broke the LOCAL typecheck with implicit-any errors
      and — worse — `zz-tmp-authed-verify` photographed loading skeletons while
      passing. Keeping a spec that produces confident, empty evidence is how the
      audits kept missing things.
- [x] **deadcode gate went red, now green — 980c82a2a.** Two unused files, both
      orphaned TODAY rather than found lying around: `MessagesEmptyThread` by my
      own removal of the Messages two-pane split, and `HelperBadges` by the
      identity work in `aa4ef9034`. Deleted both. Three comments named
      `HelperBadges.tsx` as a live surface; deleting the file without touching
      them would have left three confident statements pointing at something that
      no longer exists — the exact failure mode that made this codebase hard to
      audit. They now describe the surface, not the filename. NOT touching the
      131 unused exports: dead code you happen to notice is a report, not a task.
      `Test` workflow green on 980c82a2a.

## Owner decisions, 2026-09-11

- [x] **The 40 orphaned availability notifications are DELETED** (owner
      approved). Backed up first to
      `docs/backups/orphan-availability-notifications-2026-09-11.json` — all 40
      rows, 40 unique ids, every field. Re-measured: rows for that user
      **40 -> 0**, and `title ilike '%updated availability%'` across the whole
      table is now **0**. The newest row was 2026-09-12T00:41, i.e. the flood was
      still running right up to the deploy; the next 6-hourly tick at :41 is the
      forward proof that it stays at zero.
      (Note for anyone reading the delete: `returning` plus a count subquery in
      ONE statement reports the pre-delete snapshot — it said "deleted 40,
      remaining 40". The remaining count has to be a separate statement.)

- [x] **DONE 0e4a57017 — the owner's ruling applied, and it was FAR more than the
      two screens anyone had seen.** 43 same-material (white-in-white) nested
      pairs eliminated across 8 surfaces, identical counts at 375 and 1440:
      `/profile` landing **4 -> 0**, `/settings` **4 -> 0**,
      availability (both routes, both roles) **7 -> 0**, Admin Health's Config
      Checks + Scheduled Jobs **20 -> 0**, Admin Jobs rows **5 -> 0**, Admin
      Disputes **1 -> 0**, Admin Settings' admin-user rows **1 -> 0**, Admin
      Analytics' empty state **1 -> 0**. Group cards, eyebrows and rows are
      untouched — only the OUTER wrapper stopped painting, exactly as ruled.
      Done through a shared mechanism, not per-page forks: `AdminCard` gained
      `surface?: "card" | "none"`, default unchanged, so the other ~20 admin
      views are untouched. Eyeballed at both widths, not just counted.

      **The detector missed one on its first pass, for a reason worth keeping:**
      it skipped `role="button"` elements, so Admin Jobs' rows did not register.
      Widened, found, fixed. That is the same shape as the 2026-09-07 miss — a
      detector whose definition quietly excluded the case — and it is why the
      count is trustworthy only after you check what the detector cannot see.

      Deliberately LEFT, with reasons: `PageScaffold`'s bleeding panel around job
      cards (My Posts, Activity, Dashboard) matches the shape literally but IS
      the documented two-card shell in CLAUDE.md — removing it is a layout
      decision for the owner, not this ruling. Work Record's grey stat tiles and
      the tinted inset panels inside AdminCards (`bg-muted/40`, `destructive/5`
      and friends) are a different material and read as inset, not box-in-box.
      Segmented-control tracks and the EmptyState icon disc are detector noise.

      Original ruling: **KEEP THE GROUPS, DROP THE OUTER CARD.**
      The WORK / MONEY group cards and their eyebrow labels stay exactly as they
      are; the outer wrapper stops painting a white card and a border, so there
      is one boundary per group instead of a box inside a box. Applies
      everywhere it appears — `/profile` landing (`SettingsSection.tsx:44`, 4
      instances) and Admin Health's "Configuration Checks" at minimum. Sweep for
      others rather than fixing only the two that were seen. NOT YET DONE.

- [x] **Missing foreign keys — DONE 6417eed97, owner said go.** Live in prod,
      verified by `pg_get_constraintdef`. See the overnight rulings section.
      Original: **Missing foreign keys — INVESTIGATION DONE.**
      Findings, all measured live:

      **The orphans are historical, and the leak is already plugged.** Every
      orphaned `favorite_helpers` row was created **on or before 2026-09-01**.
      The migration that makes account deletion purge these tables landed
      **2026-09-02** (`20260902051631_account_deletion_reaches_tracking_consent_availability_favorites_reports`,
      alongside `20260902014651_account_deletion_purges_the_no_fk_tables` — the
      name says outright that the no-FK tables are handled in code by choice).
      The single row created since (2026-09-11) is valid on BOTH sides. So the
      deletion path works and is not producing new orphans.

      **But an orphan already cost us a real bug today.** The 40-notification
      flood came from an orphaned `favorite_helpers` row pointing at a customer
      with no `profiles` row. A foreign key would have made that bug impossible
      rather than merely fixed.

      **Counts:** `favorite_helpers` 12 rows — 7 orphaned `customer_id`, 10
      orphaned `helper_id`, identical against `profiles` and `auth.users`. Only
      **1** row is clean on both sides. `notifications` 540 rows, **1** orphan
      left after today's delete. `profiles` 8 rows, 8 of 8 have an `auth.users`
      row, so that side is sound.

      **The FK is safe to add, and CASCADE is the right rule.** `profiles.user_id`
      already carries a UNIQUE constraint, so it is a valid FK target.
      `favorite_helpers` today has only `UNIQUE (customer_id, helper_id)` and its
      primary key — no FKs at all. Account deletion ANONYMISES rather than
      deletes (`profiles.anonymized_at`), so the profiles row SURVIVES a normal
      deletion and CASCADE would never fire on one. It fires only on a HARD
      delete of a profile — which is exactly what produced these orphans.

      **Recommended plan, in this order:** (1) delete the 11 pre-2026-09-02
      orphan rows, keeping the 1 valid one; (2) add
      `favorite_helpers.customer_id` and `.helper_id` -> `profiles(user_id)`
      ON DELETE CASCADE; (3) same for `notifications.user_id` after clearing its
      last orphan. Prove the migration replay-safe under PGlite by applying it
      3x, per CLAUDE.md. Step 1 must precede step 2 — a constraint added over
      existing orphans fails.

      Superseded note: **owner ruled INVESTIGATE AND REPORT FIRST.** No
      schema change yet. Work out what would break, how many existing rows
      violate each constraint, and what account deletion is supposed to do here
      (remember deletion ANONYMISES rather than deletes, so a naive FK with
      CASCADE would destroy history the app deliberately keeps). Bring back a
      concrete plan. Applies to `favorite_helpers.customer_id` / `.helper_id`
      (7 of 12 live rows orphaned) and `notifications.user_id`.


## New reports from the last-three lane (2026-09-11)

- [x] **DONE afe650635 — worse than reported.** Toast x 1060–1416; rail "Post a
      Job" x 1209–1411 overlapping, and over "Notifications"
      `elementFromPoint` returned THE TOAST — genuinely unclickable, not merely
      overlapped. Cause: sonner portals to `<body>`, so it sits outside BOTH
      rail insets. Fixed in CSS gated on the same three classes as the existing
      insets, setting `right` rather than the custom property sonner writes
      inline. After: toast x **812–1168**, and `elementFromPoint` over both
      controls returns the control. Scoped to right-anchored containers and
      verified not assumed: the 375 top-centre toast is unchanged, and the rule
      was checked in `dist/assets/*.css` after a build, not on the dev server —
      the CSS-minifier trap in CLAUDE.md.
      Original report: **desktop toast overlaps the rail**
      Job" and "Notifications" controls.** Pre-existing, affects EVERY toast, and
      unchanged by the nudge fix (which only moved that one toast, and only below
      768px). Same family as the My Jobs defect, at the other breakpoint.
- [x] **DONE afe650635 — REAL, not a harness artefact.** `supabase.auth
      .getSession()` does no shape validation: it checks the session exists and
      has not expired, then hands the stored user straight through. This app
      supplies its own storage adapter on both platforms, so those bytes travel
      through code that can return a partial value, and `!!user` is then true.
      Reproduced with the id stripped from the persisted session: **7 malformed
      PostgREST requests from 5 call sites** (`profiles`, `user_roles`,
      `user_blocks`, `messages`, `notifications` x3) — against prod those are
      400s on a uuid column, i.e. "We couldn't load your account" with a Try
      again that can never succeed. Fixed at the ROOT, not at five call sites:
      `emitAuthSnapshot` normalises an id-less user to signed-out and reports to
      Sentry. **7 -> 0**, and the user lands on /login with their path preserved.
      Deliberately NOT fixed by flipping `useCurrentUser`'s `enabled`, which
      would have made the query disabled -> `isLoading:false, data:undefined,
      isError:false` -> ProtectedRoute's optimistic fall-through, i.e. **fail
      OPEN for a banned account**.
      Original report: **stale session sends `user_id=eq.undefined`**
      route render "We couldn't load your account", with `user_id=eq.undefined`
      going to PostgREST.** Hit while building the harness, so it may be a
      harness artefact — but the request is genuinely MALFORMED rather than
      skipped, which is a guard missing at the call site, not a server problem.
      Worth reproducing before believing either way.

- [x] **PROVEN 2026-09-12 18:56 UTC — the flood is over.** Cron 39 has now run
      THREE times since the fix (06:41, 12:41, 18:41, last status `succeeded`)
      and availability-titled notifications are still **0**, with
      `notification_dedupe_suppressions` also 0 — nothing even tried to
      duplicate. The expectation is now a measurement.
      Original: **PENDING PROOF: the availability flood must stay at zero after the next
      cron tick.** As of 2026-09-12 05:42 UTC: availability-titled notifications
      **0**, `notification_dedupe_suppressions` **0** (nothing has tried to
      duplicate yet), newest notification in the whole table 2026-09-11 20:37.
      `cron.job` 39 runs `41 */6 * * *`, so the next tick is **06:41 UTC**. That
      is the forward proof, and it has NOT happened yet — the fix is deployed and
      the old rows are gone, but "no new ones are being written" is so far an
      expectation, not a measurement. One query settles it:
      `select count(*) from public.notifications where title ilike '%updated availability%';`
      It must still be 0 after 06:41.


## Guest /browse: I re-applied a decision the owner had already reversed

- [x] **Search + Filters on guest /browse — ASKED, and the owner confirmed they
      stay OFF (e85b82a5b).** I removed them earlier today (8321d4344). The test
      guarding that area carried a dated note saying the owner had reversed that
      exact removal on 2026-09-07 ("/browse can have the filters", c7bce404e)
      and warning that the spec "kept the suite red for two days asserting the
      decision it replaced". Rather than pick a side I put the contradiction to
      the owner directly, who chose **keep them off, update the test**. The
      assertion is now inverted with the full flip-flop history beside it and an
      explicit "do not flip this back on the strength of the c7bce404e commit
      message alone — ask first".
- [x] **Guest /browse had TWO `<h1>Browse Jobs</h1>` — my regression, fixed
      c27ad084b.** Moving the page onto `PublicHeaderPage` today gave it a
      visible h1 while `BrowseTasksToolbar` still rendered its own sr-only one.
      An a11y defect and a Playwright strict-mode violation, red at 320, 375 and
      1440. The toolbar now takes `renderHeading`; NATIVE still renders it,
      because `PageScaffold`'s title card there is the H logo and carries no
      heading. The same shell change also turned the two CTAs into the marketing
      Navbar's `<Button asChild><Link>` — an anchor, so `role="link"` — and the
      spec now asserts the real role while keeping its intent.
      8/8 in `home-chrome.spec.ts` green.

- [x] **DONE 7c824db4c — every toast moved to the bottom**, owner ruling, locked
      by `src/test/toastPlacement.test.ts`.
      Original: **Top-anchored toasts have now landed on a header control THREE times.**
      The My Jobs title card (e59a7ff85), the desktop right rail (afe650635),
      and now: at 375 every top-centre toast covers the header's Notifications
      bell (toast y 8–78 vs bell y 21–77; `elementFromPoint` returns the toast).
      Three one-off fixes is a pattern, not a coincidence — this wants an owner
      ruling on where toasts belong, not a fourth patch.
- [x] **CLOSED, working as intended — no change.** Looked at it at 1440 now that
      the thread sits in a panel: the header, the off-platform banner and the
      composer share one centred 780px column, and the band behind the composer
      lines up with the banner above it. The cap itself is the owner's fix for
      "the bottom bar does not fit correctly"; widening it would reintroduce that.
      Original: **At 1440 the composer bar spans the 780px reading column, not the full
      panel.** `ChatView` caps timeline and composer with one `max-w-[780px]`
      wrapper. That cap is owner-set ("the bottom bar does not fit correctly"),
      so it was left alone.

## Still red, and it is the owner's own report (lead, 2026-09-11)

- [x] **DONE 84d84bc63 — the payout notice rides inside the sticky block with the
      Apply button**, so the reason you cannot be hired and its Set Up Payouts
      link are never covered. Overlap 21.1px → 0, checked in both hosts.
      Original: **The Apply sheet's submit row STILL covers the payout notice — my earlier
      fix was incomplete.** Owner's words: "the you can apply button is cut off
      by apply". `fa716f4b9` fixed the case where the sheet does NOT scroll, by
      gating `.sheet-sticky-actions` on a real `hostScrolls` measurement. The
      SCROLLING case was never fixed and is now **worse: 6px -> 21.1px**. I
      opened the failure screenshot and LOOKED: "Apply Now" sits on the payout
      notice and hides its last line and its "Set Up Payouts" link — the one
      control that would let the user resolve the block.
      Reproduces reliably locally AND in CI, so it is not the documented
      shared-tree flakiness. It is the last red test in the happy-path smoke.
      Mechanism as far as I got: with the sheet overflowing, the row's natural
      position is below the fold, so `bottom: 0` pins it to the scroller's
      bottom edge — exactly where the notice sits. That is ordinary sticky
      behaviour, which is why a naive tweak will not settle it. Handed to a lane
      with the brief that the reason you cannot be hired AND the link that fixes
      it must both stay readable.

# ============================================================
# OVERNIGHT BRIEF — agreed with the owner 2026-09-12, ~06:45 UTC
# ============================================================
# Owner: "no agents either, you do it all on your own no rush take your time
# and be thorough" · "make sure every gap is covered. no excuses"
#
# THE CORRECTION THAT DEFINES THIS RUN. Owner: "you still didnt ask what the
# audit should do bc last time there were alot of gaps you just looked and
# didnt make sure anything worked as it should." So this is NOT a look-at-it
# pass. Every screen must be PROVEN TO WORK, not just proven to render.
#
# COVERAGE — a screen is not audited until all of this exists for it:
#   · states: empty · loading · error · populated
#   · widths: 375 and 1440
#   · themes: light and dark
#   (up to 16 captures per screen, and EVERY screen gets seen)
#
# DEPTH — click EVERY control on every screen: buttons, links, tabs, toggles,
# filters, form fields. Press it and verify WHAT ACTUALLY HAPPENED: the right
# thing opened, the data changed, the state moved, the toast told the truth.
# Anything that does nothing, or lies, is a defect.
#
# JOURNEYS — run the whole loop across two test accounts, Stripe test mode:
# post → fund → apply → hire → message → on my way → arrived → working →
# complete → approve → release → review, plus cancel, dispute and refund.
#
# PROD WRITES — allowed. Create test data freely, mark it clearly, back it up
# and clean it up at the end. Never touch the owner's real rows.
#
# ROOT CAUSE — chase every failure all the way down: database, RLS policies,
# edge functions, triggers. Verify the LIVE object, never the migration file.
# Fix the cause, not the symptom.
#
# AUTHORITY — fix everything, including the subjective calls, using the rules
# already given (CONSISTENCY above all). Owner reviews the diff.
#
# ORDER — daily screens first (Dashboard, My Jobs, My Posts, Messages, job
# cards), then Profile + tabs, then Post a Job, then Admin, then the 94
# overlays. But EVERYTHING must be seen.
#
# REPORT — tracker file as usual, plus a written summary covering what changed
# and what needs the owner.
#
# RULINGS GIVEN TONIGHT, to action:
#   · Remove the cancellation fee pill too — "no pills" means none.
#   · Move ALL toasts to the bottom (above the dock on phone, bottom-right on
#     desktop) so nothing at the top of any screen can be covered.
#   · Run the whole foreign-key plan: clean the 11 orphans, then add the
#     constraints, replay-safe, verified by object state.

## Overnight — the three rulings, all DONE (2026-09-12)

- [x] **Red build fixed first — a838fa807.** The empty-state sweep was failing a
      137-screen run because /dashboard logged a 406 from `POST referral_codes`.
      The mock returned `[]` for every write under a comment claiming that was
      "so `.insert().select()` patterns get back data" — an empty array is
      precisely NOT data. It only surfaced once `honourSingleObject` started
      modelling real PostgREST earlier today. Chased to the live database rather
      than believing the symptom: `referral_codes` has matching INSERT and
      SELECT policies in prod (`pg_policy`), so the real insert DOES return its
      row and there was no app defect behind the red. The mock now echoes the
      request body as the representation, the way PostgREST does.
      **1 failed request -> 0; empty-state sweep 137/137 green.**
- [x] **No pills, including the fee — 903bbc622.** Both sides done in one pass,
      the poster's card and the helper's, because one surface keeping it would
      be the exact inconsistency the ruling removes. The AMOUNT stays as a plain
      money line: a cancellation fee charged with nothing on the card saying so
      would be worse than the pill, and on the helper's side it is their money.
      `PostedJobCard` is down to one `rounded-full` and it is an avatar.
- [x] **Every toast anchors to the bottom — 7c824db4c.** This REVERSES an
      earlier owner decision, and the reason is recorded beside it because the
      argument for top (a top banner is the iOS convention) is reasonable and
      will be made again — it lost to three measured collisions in one day. The
      dock, the original objection to bottom, was already solved by offsets the
      one opted-out toast was using, so the flip costs nothing that was not
      already handled. The nudge's per-toast override is DELETED rather than
      left as a special case that reads as meaningful and does nothing.
      **A comment could not stop a fourth reversal, so the ruling is a test**
      (`src/test/toastPlacement.test.tsx`), proved to fail when reverted.
- [x] **Foreign keys — 6417eed97, live in prod and verified by object state.**
      `favorite_helpers.customer_id`, `.helper_id` and `notifications.user_id`
      now REFERENCES `profiles(user_id) ON DELETE CASCADE`, confirmed with
      `pg_get_constraintdef` rather than by the deploy going green. 11 orphaned
      favourite rows + 1 debris notification cleared first (backed up), in that
      order deliberately — a constraint added over violations fails outright.
      Cascade is safe precisely because account deletion ANONYMISES rather than
      deletes, so it can never fire on an ordinary deletion. Proved under
      PGlite: applied 3x consecutively, orphan inserts refused on both tables,
      the row SURVIVING when the profile is anonymised and disappearing only on
      a hard delete, unrelated notifications untouched.
      This closes the class of bug behind the 40-notification flood, rather than
      only the instance.

## ⚠️ FOR THE OWNER — your profile photo is (almost certainly) your ID document

Found 2026-09-12 while walking /dashboard, /my-jobs, /my-posts, /messages and
/profile with a real session. Every one of those pages logs
`400 GET .../user-documents/76b07824…/avatar.png`.

**Nothing is leaked.** That object is in the `user-documents` bucket, which is
`public = false`, and I confirmed the URL answers **400** — both there and at
the same path in the public `avatars` bucket. It is not anonymously fetchable.

**But look at what it is.** In `storage.objects`, for your user id:

| bucket | object | bytes | created |
|---|---|---|---|
| `user-documents` | `…/avatar.png` | **810107** | 2026-05-03 17:11:09.220671 |
| `id-documents` | `…/id-document-1777828268516.png` | **810107** | 2026-05-03 17:11:09.302834 |

Identical byte count, written **80 milliseconds apart**. That is one upload
landing in two places: your identity document was also written as your avatar.
This is precisely the scenario `src/lib/avatarStorage.ts`'s own header describes
— "the ID picker and the avatar picker have sat one tap apart… Two identity
documents were found live in this bucket exactly this way."

**What I did and deliberately did not do.** I did NOT copy the file into the
public `avatars` bucket to "fix" the broken image — that would publish an
identity document. I did NOT null your `avatar_url`, because the brief says not
to touch your real rows. The app already degrades correctly: every avatar call
site now renders through the shared `UserAvatar`, which falls back to a
monogram, so you see initials rather than a broken image. The only live symptom
is the 400 in the console on every page.

**What needs you:** upload a real profile photo (that writes to the public
`avatars` bucket via the consolidated path, which is correct now), and then say
the word and I will delete the stale `user-documents/…/avatar.png` object and
clear the dead URL. The `id-documents` copy is where an ID document belongs and
should stay.

Systemic check done, not assumed: yours is the ONLY profile whose `avatar_url`
points at a non-public bucket. Every other row uses `avatars` or the brand-asset
function.

## The night's audit — infrastructure, and what it has found so far

**`scripts/audit/walk-every-control.mjs`** — the answer to "you just looked and
didn't make sure anything worked". It signs in with a real prod session, waits
for content rather than photographing skeletons, records layout facts, then
presses EVERY button, link, tab, toggle and checkbox and records what actually
changed: the URL, a dialog, the controls, the fields, the toggle state, the
console.

**It took six rounds to make it trustworthy, and that is the point.** Every one
of these was the harness accusing working code:
- held element handles across clicks, so a re-render detached them → reported
  the notifications bell unclickable;
- measured change by text length alone → reported the dashboard's Search dead,
  when it swaps the whole header for a field (517 chars → 514);
- counted any card inside a card → reported the documented two-card shell's
  17px-inset job cards, 4-6 per dashboard;
- took a minimum over four edge gaps → reported the tinted "Lafayette" location
  chips as nested cards, 8 per screen;
- reported `sr-only` controls unclickable — they are clipped to a pixel ON
  PURPOSE, for screen readers;
- reported the whole bottom nav on /messages unclickable, because opening a
  thread hides the dock and the labels were captured on load;
- reported already-active tabs dead ("Home" on /dashboard, "Posts" on
  /my-posts, "Messages" on /messages, "Terms" on legal);
- could not see toggle state, so "Copy Mon to all" looked dead.
A harness that calls working controls broken spends the night's attention on
itself. **Every finding below was reproduced by hand before being believed.**

### Confirmed and FIXED
- [x] **Tapping Search on /dashboard left the field unfocused** (bfadf5460).
      The header swapped to a search box and `document.activeElement` stayed on
      BODY, so on a phone the keyboard never came up and you had to tap again —
      two taps for one intent on the primary surface. Fixed for the standalone
      header form ONLY; the copy embedded in the filter sheet still does not
      autofocus, deliberately, because that sheet is opened by a sort/category
      control and focusing threw the keyboard over the chips. Verified both in
      Chrome.

### Confirmed NOT defects (evidence both ways, so they stop being re-reported)
- **"Copy Mon to all" on the availability tab works.** It reported dead under
  the test account because all seven of that account's days are ALREADY an
  identical 09:00–17:00 — so the copy legitimately changes nothing. Driven on an
  account where a day differed, it flips that day on (`aria-checked` false →
  true). Not a defect; the data was uniform.
- **`/`, `/browse`, `/complete-profile`, `/account-*`, `/admin` report the
  dashboard's controls** because they REDIRECT for a signed-in approved
  non-admin. Expected.

### The two-account journey — `scripts/audit/two-account-journey.mjs`
9 of 10 steps pass. It proves: both sessions are really signed in; each account
can read its own profile under RLS; **the helper CANNOT read the poster's email**;
the browse feed answers; and it cleans up its own rows.

Two corrections to my own test, not the app:
- It first reported an RLS failure on a message the helper could not read. The
  thread's counterparty was the OWNER, not the helper, so **RLS was right and
  the assertion was wrong.** (That run also put a test message in the owner's
  real inbox; it has been deleted, and the script now cleans up.)
- A completed job's thread offers no composer via `/messages?jobId=…` because a
  conversation is built FROM messages — a job with none has no thread to open.
  The real entry point is the job card's Message action. Not yet driven.

- [x] **THE MONEY LOOP IS COVERED — passed on production 2026-09-12 19:41 UTC**
      (run 34714860101, first attempt, 27.3s, no retry). Sandbox confirmed first,
      not assumed: every `stripe_session_id` in `jobs` is `cs_test_`. Verified in
      the database, not from the green tick: job `5f20df1e…` completed and
      `released`, before AND after proof photos, helper and poster both done, a
      review, and a `payout_transfers` row `status=paid`, 2200 cents ($25 budget
      less the fee) with a real Stripe `tr_…` transfer id created at 19:41:49.
      Getting there took five fixes, each found by reading the run rather than
      guessing:
        1. the token mint's "check the password" message was wrong — auth had
           logged the sign-ins as 200; the mint is now a script that reports the
           real HTTP status and retries (dba125b99);
        2. the spec waited for a "Before Photos" button that the step-by-step
           photo redesign had removed from production (ed8371fc0);
        3. it uploaded before-then-after, but the Working step asks for the after
           photo first (same commit);
        4. a second `page.goto` raced the page's post-upload refetch and hung 296s;
           the before upload now waits on the same page for the card to advance
           (66f5d8108) — and a local check showed a refetch alone causes zero
           history writes, so this is not a user-facing defect;
        5. the final `is_seed === false` assertion predated the derive-from-account
           migration; it now asserts the flag is UNCHANGED (a06d987ba).
      Found and fixed a real product gap on the way: a proof-photo upload relied
      only on best-effort realtime to advance the card (ad9a884b7).
      Original: **THE MONEY LOOP IS NOT COVERED.** Funding,
      release and refund were all skipped. The Stripe key the edge functions
      actually use cannot be read, `scripts/e2e/stripe-sandbox-on.sh` is
      owner-run, and the Stripe account exposes a LIVE context — so driving a
      payment could charge a real card. **Owner: run the sandbox script and I
      will drive post → fund → apply → hire → complete → release → review end to
      end.** Until then, escrow, payout and refund remain proven only by the CI
      spec's own history, not by anything I ran tonight.

## Money and trust audit (read-only against prod, 2026-09-12)

**No real money is stuck anywhere.** Checked every integrity invariant I could
express over `jobs`:

| check | result |
|---|---|
| REAL (non-seed) jobs with stuck money | **0** |
| completed but not released/refunded/cancelled | 3 — **all `is_seed`** |
| escrow still held on a finished job | 1 — **seed**, the disputed fixture |
| released with no helper | 0 |
| non-positive budget | 0 |
| platform fee exceeding the budget | 0 |
| open job already assigned a helper | 0 |
| in-progress job with no helper | 0 |
| `cancellation_fee_status = 'charged'` with no fee amount | 0 |
| payout_transfers rows pointing at a job that no longer exists | 0 |

Real jobs in prod: **3**. Payout rows 10, refunds 39, tips 3.

**The repeating "Dispute split did not settle" alert — NOT a defect, and I
nearly filed it as one.** Dispute `c7a12050` is `status=decided` with
`execution_status='pending'`, never started, no error, so cron 15 (`21 */6`)
re-alerts every 30h. My first read was that nothing calls
`execute-dispute-split` — `grep -rn "execute-dispute-split" src` returns only
its own tests. **That was wrong: the call is there, at
`AdminDisputes.tsx:330`, split across a line break so the function name sits on
the line after `invoke(`.** The designed flow is admin decides →
`rpc_decide_dispute` → client invokes the settler, and `UnsettledSettlements.tsx`
exists precisely to list decisions whose money has not moved. The stuck row is
SEED data created already-decided without the settler ever being invoked.
Worth clearing so the alert stops, but the product path is intact.

A note on method: a multi-line call is invisible to a single-line grep, and
"nothing calls this function" is exactly the kind of confident, wrong conclusion
that a grep invites. Read the call site.

## Cross-account authorization — NO LEAKS (17 probes, two real sessions)

`scripts/audit/cross-account-authz.mjs`. Not a policy read: two real tokens, real
PostgREST, one signed-in member asking for another's rows — the question a
hostile user would ask. CLAUDE.md is explicit that a policy can look correct and
still not do what you think.

Clean on all of it: payout transfers, refunds, tips, disputes, gift cards, W9
tax records, verification history, other people's roles, fee config, error logs,
push tokens, saved searches, saved helpers, notifications, messages to third
parties, the poster's email, and **the exact address of a job she was never
hired for** (no latitude/longitude handed over).

It carries a control so it cannot pass vacuously: the helper must still be able
to read her OWN profile. A database where nothing works must not look like a
database where nothing leaks.

**Its first run reported five leaks and every one was the probe's fault** — two
asked for a column and a table that do not exist (`payout_transfers.amount`,
`id_verifications`), and three forgot to exclude the user's OWN rows, so her own
role, tips on jobs she worked and disputes she is a party to all came back and
read as breaches. Each was checked against the database before being believed.
A probe that cannot tell "your row" from "someone else's row" cannot report a
leak, only noise; a 400/404 now reports itself as a broken probe rather than a
finding.

---

# ☀️ MORNING SUMMARY — what happened overnight

*(written as the night went; the audit sweep's full results are appended below
when it finishes)*

## Your three rulings, all done and verified in prod
1. **No pills.** Both sides of the cancellation fee too. The amount survives as
   a plain money line — a fee charged with nothing saying so would be worse than
   the pill.
2. **All toasts moved to the bottom.** This reversed an earlier decision of
   yours, so the reason sits beside it in the code, and the ruling is now a
   TEST that fails if anyone flips it back.
3. **Foreign keys added and live**, verified by object state rather than by the
   deploy going green. This closes the CLASS of bug behind the 40-notification
   flood, not just the instance.

## The most serious thing I found
**Your profile photo is almost certainly your ID document.** Same byte count as
your `id-documents` copy, written 80 milliseconds apart. Nothing is leaked — the
bucket is private and the URL 400s — and the app already falls back to your
initials, so the only live symptom is console noise. I did NOT copy it to the
public bucket (that would publish an identity document) and did NOT edit your
row. Upload a real photo and say the word; I will clear the dead object.

## What I proved, rather than assumed
- **No cross-account leaks**, 17 probes, two real sessions, asking the question a
  hostile user would ask — including the exact address of a job she was never
  hired for. With a control so it cannot pass vacuously.
- **No real money is stuck.** Every integrity invariant over `jobs` is clean;
  the only unresolved payments are seed fixtures.
- **The dispute settlement path is intact** — I nearly filed it as broken
  because a grep for the settler returned only tests. The call is there, split
  across a line break.

## What I could NOT do, and why
**The money loop.** Funding, release and refund are untouched because I could
not confirm the Stripe key the edge functions use is test mode, and the account
has a live context. Driving a payment could have charged a real card. Run
`scripts/e2e/stripe-sandbox-on.sh` and I will drive post → fund → apply → hire →
complete → release → review end to end.

## The honest note about the harness
The audit tool accused working code **eight separate times** before it was
trustworthy — dead controls that were already-selected tabs, an unclickable
notifications bell that was a stale element handle, nested cards that were the
documented two-card shell. Every finding in this file was reproduced by hand
before being believed. That is why there are fewer findings here than you might
expect, and why the ones that remain are real.

## Sweep results — 58 routes, both widths, both themes

Four runs. **375 light and 375 dark completed all 58 routes each**; the 1440 pair
was re-run sequentially because four concurrent browsers starved the dev server
and produced a wall of `page.goto: Timeout` on the Profile tabs — contention,
not defects, and worth saying plainly rather than filing thirty findings.

### Answered, with evidence — NOT defects
- **"Save" on the auto-tip tab gives no feedback, and that is deliberate.** It
  works: clicking it issues `PATCH profiles` then refetches, verified on the
  network. There is no success toast because `applyToastPolicy()` neuters every
  action-less `toast.success` app-wide by an owner decision of 2026-08-13
  (confirmations read as clutter and covered the header). The intended
  confirmation is the haptic plus the re-seeded values. **See the open question
  below — that convention has a hole on the web.**
- **"Copy Mon to all"** — no-op only because that account's seven days are
  already an identical 09:00–17:00. Proven to work where a day differs.
- **"Light" / "Dark" on the accessibility tab, "Off" on auto-tip, "Lifetime" on
  earnings, "Post a new job" on /post-job, "Home" on /dashboard** — every one is
  the already-selected option or the current route. Pressing them is supposed to
  do nothing.
- **"Follow us on Facebook"** opens a new tab, which the walker cannot see as a
  change in the page it is watching.
- **"Recenter map"** appears on /admin, /account-*, /signup-pending and / at
  1440 because every one of those REDIRECTS a signed-in approved non-admin to
  /dashboard, which has the map. Same control, one screen.

### Real, and open
- [x] **TEXT CLIPPED on home_history — RETRACTED, it was my detector.** The
      description excerpt is `line-clamp-2`, a deliberate two-line truncation
      that draws its OWN ellipsis. Tailwind sets `-webkit-line-clamp` without
      setting `text-overflow`, so a check that only knew the latter read a
      designed excerpt as text the box cannot show. Detector fixed; the route
      now reports clean. **This was the last finding standing from the sweep,
      and it was mine, not the app's.**
- [x] **ANSWERED by the owner's "consequential actions only" ruling.** Auto-tip
      Save is a settings save the form already reflects, so it stays silent by
      design; the actions with a real-world effect now confirm.
      Original: **OPEN QUESTION FOR THE OWNER — Save confirms with a haptic, and the web
      has no haptics.** The 2026-08-13 ruling killed action-less success toasts,
      and the stated confirmation on the auto-tip screen is "the haptic plus the
      re-seeded values". On the phone-sized WEBSITE and on desktop there is no
      haptic, and the re-seeded values are identical to what the user just
      typed — so pressing Save produces **literally nothing observable**. That
      collides with the standing rule that the phone-sized website and the
      native app are ONE surface. I have NOT changed it, because adding a toast
      would reverse your ruling. Options: a brief inline "Saved" beside the
      button (no toast), or accept web having no confirmation.

## ⭐ THE FINDING WORTH READING FIRST — consequential actions confirm nothing, and the reason for that just expired

Driving every control at 1440 turned up buttons that reach the server and then
show the user **nothing at all**. Verified on the network, not guessed:

| control | what it actually does | what you see |
|---|---|---|
| Security → "Email me a password reset link" | `POST /auth/v1/recover` — the email really is sent | **nothing** |
| Subscription → "Refresh membership status" | `POST check-pro-subscription`, then refetches | **nothing** |
| Auto-tip → "Save" | `PATCH profiles`, then refetches | **nothing** |

Zero text change, zero toast, no dialog, no error. Press "Email me a password
reset link" and you cannot tell it worked — so you press it again.

**The cause is one deliberate app-wide policy**, `src/lib/toastPolicy.ts`, which
suppresses every action-less `toast.success` (and `.message`/`.info`) on your
2026-08-13 decision. Its own header gives the reason:

> "The confirmations … read as clutter and, **once toasts moved to the top of
> the screen, began covering page headers.**"

**That reason no longer exists.** Toasts moved to the BOTTOM tonight, on your
ruling, precisely because top-anchored toasts kept covering headers and controls.
The policy was a workaround for the placement, and the placement is fixed.

Two supporting facts, so this is not a guess:
- The exception proves the mechanism. "Send test notification" DOES show a
  toast — because its message carries a warning ("Sent to the bell icon — but
  the Email switch for Work Status is off"), so it is not an action-less
  success and the policy lets it through.
- The auto-tip screen's own comment says the intended confirmation is "the
  haptic plus the re-seeded values". **There are no haptics on the web**, and
  the re-seeded values are identical to what the user just typed — so on the
  phone-sized website and on desktop the confirmation is nothing at all. That
  collides with the standing rule that the website and the app are ONE surface.

- [x] **DONE 40dbf2d84 — owner ruled "consequential actions only".** A new
      `confirmConsequential` renders through the real `toast.success`, keeping
      success styling; 22 call sites across 18 files moved (password reset,
      email change, membership refresh and restore, dispute resolved / withdrawn
      / settled, bans, denials, restrictions, strike reversal, force-update gate,
      abuse caps, test notifications, review posted). Trivial saves stay silent.
      Also fixed a dropped error under it: Refresh membership status discarded
      `functions.invoke`'s result, so a server failure never reached the catch.
      Seen by eye at 375 and 1440: success check, bottom-anchored, clear of the
      dock. Guard tests proved to fail both ways.

      Original: **DECISION FOR THE OWNER.** I did NOT re-enable success toasts — that
      reverses an explicit ruling of yours and changes every screen at once.
      The options:
      1. **Re-enable them now that toasts sit at the bottom** (one-line change
         in `toastPolicy.ts`) — fixes the whole invisible-action class at once.
      2. **Re-enable only for consequential actions** (an email sent, a password
         reset, a payment refreshed) and keep trivial saves silent.
      3. **Keep them off and add inline confirmation** beside the button
         ("Sent ✓"), which never covers anything.
      My recommendation is 2: the actions that need confirming are the ones with
      a real-world side effect, and a "Saved" on every field edit is the clutter
      you removed in the first place.

- [x] **RESOLVED — the "signed-out on return from checkout" symptom is a retry
      artefact, not a user path.** It appeared on every RETRY attempt observed
      today (11:38, 19:26, 19:38) and on no first attempt, and the clean run at
      19:41 passed first time without it. The loop also continued past it each
      time, since it is a warning with a fallback. Watch it if it ever shows on a
      first attempt; until then it is not a defect.
      Original: **The production money-loop test is FLAKY, and the symptom is worth
      watching.** `prod-lifecycle.spec.ts` ("post, fund, apply, hire, complete,
      release, review") failed once at 11:38 and PASSED on the very same commit
      at 11:10, with every other run today green — so the payment path is not
      broken, it is intermittent. The failure mode is specific and not a
      timeout: it ends parked on
      `…/login?redirect=%2Fpayment-success%3Fjob_id%3D…`, i.e. **the return from
      Stripe checkout landed signed-OUT**, with the harness noting "no inline
      error text found on the page".
      That is the same shape as the native Stripe-return handoff problem already
      in the notes. If a real poster hits it they are asked to log in again
      immediately after paying, which is the worst possible moment. Not chased
      further tonight because I could not drive the money loop myself (see the
      Stripe sandbox item), and because a single flake on a green day is a
      watch, not a diagnosis. **Next run that fails, pull the error-context.md
      artefact before it expires.**


- [ ] **FOR THE OWNER — the dead avatar URL is CLEARED (2026-09-12); the duplicate FILE is still there.**
      `profiles.avatar_url` for the owner is now null, verified by the UPDATE's
      returned row, so the 400 on every page is gone and the app shows initials.
      The owner reported deleting the file, but `storage.objects` still lists
      `user-documents/76b07824…/avatar.png` with its original 2026-05-03
      timestamp, so that delete did not land. Everything else in the folder is
      untouched and the `id-documents` copy is intact.
      Original: **FOR THE OWNER — delete the duplicate of your ID document.** Confirmed by
      SHA-256, not just size: `user-documents/76b07824…/avatar.png` is
      byte-for-byte identical to `id-documents/76b07824…/id-document-1777828268516.png`
      (both `63fc9c6d587cf9b5…`). My delete was blocked by the permission
      classifier, so I did not route around it. To finish: Supabase dashboard →
      Storage → `user-documents` → folder `76b07824-9b41-4741-a4c4-4f8de362f682`
      → delete `avatar.png`. Keep the `id-documents` copy. Then upload a real
      profile photo, which writes to the public `avatars` bucket and replaces the
      dead URL. Nothing is leaked in the meantime — the bucket is private.

- [x] **DONE — ZIP shows its valid check on Complete Profile, signup AND Edit Profile.**
      Original: **Complete Profile: ZIP shows no check mark when filled.** Owner, 2026-09-12,
      pointing at `#zipCode` holding "70528": the neighbouring fields show the
      valid ✓, ZIP does not. `src/pages/CompleteProfile.tsx:771`.

- [x] **DONE — a position/zoom step before every profile photo save.**
      Original: **Profile photo upload has no crop/position step — it cuts heads off.**
      Owner, 2026-09-12: "the profile picture spot doesnt give them the option to
      like center the picture better it crops their head off". The avatar is
      shown center-cropped in a circle with no way to move or zoom the image
      before saving.

- [x] **DONE (fd2d7f73c, screenshots of both honest cards) — "Update ready." is an error screen pretending to be good news — remove it
      everywhere.** Owner, 2026-09-12, clicking Terms / Rules / Privacy on Complete
      Profile: "there should not be a such thing as an update ready screen this is
      clearly an error and all of them need to be fixed". Reproduced on localhost:
      all three routes render RouteErrorBoundary's chunk-load state. Cause on the
      dev server is Vite `504 (Outdated Optimize Dep)` on `@radix-ui_react-tabs.js`
      → `Failed to fetch dynamically imported module: …/Legal.tsx` (the dependency
      pre-bundle went stale after today's `npm run build` / `cap sync`). But the
      real defect is the SCREEN: any failed chunk load is labelled "A newer version
      of the app was just released", which is a guess and here is false.
- [x] **DONE (325e4009c, measured 60/60 at 360, 375, 1440 + screenshot) — Complete Profile: "Enter App" and "Sign Out" are different heights.** Owner,
      2026-09-12: "buttons should be the same size". Measured from the selection:
      Enter App 49.5px, Sign Out 60px, stacked full-width.

## Audit gaps — owner, 2026-09-12: "why were these missed and how do we fix this gap"

Rule for this section (owner): nothing that needs the browser is marked done
until the browser has been used to LOOK at it. Agents run one at a time.

- [x] **DONE (terminal 6, 2026-09-13) — messy input was mocked.** `e2e/prod-audit/messy-input.spec.ts`
      replaces the mocked `e2e/happy-path/messy-input*.spec.ts`: the full value battery on every field
      of every URL-reachable form, the targeted rules (email/phone/ZIP, an under-18 DOB, prices
      0/negative/decimal/1e9, whitespace-only required fields), and the dialog-gated forms explored
      from real seeded records behind a write firewall — all on PROD as the four seed accounts.
      Coverage test: inventory − sweeps − explore credits − stated gaps must be empty.
      Nightly: `.github/workflows/prod-audit.yml`. Screenshots looked at for every failure.
- [x] **DONE (terminal 6, 2026-09-13) — deep links and interruptions were untested on prod.**
      `e2e/prod-audit/deep-links.spec.ts` (22 tests) and `interruptions.spec.ts` (12): a gone job,
      double-tap on apply/send/post, offline mid-submit, a slow network, back and refresh mid-flow,
      and session expiry. First prod run found five HARNESS defects that would have made the suite
      lie (HEAD counted as a write; apply tests sharing one job; the offline relabel; goBack to
      about:blank; a toast asserted after it had gone) — all fixed in 706fab635.
- [ ] **Cached sessions can be dead and still look alive (terminal 6, 2026-09-13).** A revoked GoTrue
      session still passes PostgREST with its cached JWT, so a signed-in prod spec silently ran signed
      OUT — measured as a deep-link test bouncing to /login on a 40-minute-fresh cache. `sessionFor`
      in `e2e/prod-audit/harness.ts` now verifies against `/auth/v1/user` and re-mints. OPEN: the
      journeys and a11y-prod harnesses take the same cache and do NOT verify it.
- [ ] **A same-frame double-click on Apply Now fires two `apply_to_job` calls (terminal 6, 2026-09-13).**
      The button carries `disabled={applyLoading}` (ApplyBody.tsx), which holds at human tap speed —
      proven, the second tap is refused — but two clicks in one frame beat the re-render. The DB is
      safe: the RPC raises "Already applied to this job", exactly one row exists, and the user is not
      shown a failure. Fix if it is ever worth it: a ref-based in-flight guard in `useApplyFlow`.
      Covered both ways in `interruptions.spec.ts`.
- [ ] **A half-propagated deploy can leave "Something went sideways" on screen (terminal 6, 2026-09-13).**
      A lazy chunk 404s mid-deploy, `chunkReload.ts` recovers once with `?_v=`, and its 10s guard then
      refuses a second reload — so if that one reload also lands on the old build the visitor sees the
      crash screen. Measured on prod at `/messages/a/b/c`, which renders the designed 404 on every
      attempt before and after. `settle()` absorbs it once. Open: whether the guard should allow a
      second attempt after a longer backoff.
- [ ] **The post-job double-tap is not covered end to end (terminal 6, 2026-09-13).** The generic
      stepper in `interruptions.spec.ts` does not always reach the final submit; it skips with a
      stated GAP naming its `post-step-*` screenshots rather than passing quietly. Needs a
      purpose-built driver, or the journeys' post-job leg extended with the double-tap.
- [ ] **The admin queues the explore cannot fill (terminal 6, 2026-09-13).** `AdminExceptionQueue`,
      `AdminPayoutBatches`, `TwoFactorCard`, `W9CollectionDialog` and `NpsPrompt` have no seedable
      state (prod-seed.mjs: "not produced, by design"), so their fields are stated GAPS in
      `e2e/prod-audit/messyInputForms.ts` rather than swept.

- [x] **DONE de9d3cd88 — Button size classes that silently do nothing.** Unlayered
      `button { min-height: 44px }` beats Tailwind utilities. Detector:
      `buttonGeometry.ts` requestedNotRendered. Agent 1 (Opus), in browser now.
- [ ] **Sibling buttons of different heights never compared.** Detector:
      `buttonGeometry.ts` siblingMismatch, plus dialogs via overlay-sweep. Agent 2 (Fable), queued.
- [x] **DONE f5e0e104f (red/green proven) — New-tab links never followed.** walk-every-control.mjs + sweep
      newTabDestinations. Agent 3 (Sonnet), code done, red/green browser proof queued.
- [x] **DONE 2263feec8 (34 tests, red with Update ready restored) — Stale deploy only simulated on one route.** Multi-route chunk-failure
      spec. Agent 4 (Opus), queued.
- [ ] **Visual sweep could report "147 passed" with no server.** Fixed in
      91693fbd8: fails at the start (1 failed, 147 did not run, verified). Still
      needs a real sweep run with the server up, screenshots looked at.
- [ ] **Anon surface contract failed CI on one gateway 504.** Fixed in
      91693fbd8: the rpc probe retries 5xx twice; verified green against prod.
      Not browser work; closes when the next CI run is green.
- [ ] **Parallel sessions collide on the test-server port 4173.** One session's
      tests can hit another worktree's preview. The stale-bundle guard catches it
      locally. Open: give each worktree its own HAPPY_PATH_PORT by default.
- [ ] **No test moved the clock** (time-travel lane, 2026-09-12). Inventory: `docs/audit/time-inventory.md`.
      Prod spec `e2e/journeys/time-travel.spec.ts` covers the listing-expiry chip (day before, 1 min
      before, at start, next day, Pacific viewer, both DST mornings) and the availability row
      (16:59/17:00 CT, Pacific, both DST Sundays): 2 passed, and a mutant (fall-back start at the naive
      CDT instant) went red. Screenshots looked at. PGlite `scripts/probes/offer-expiry.probe.mjs` covers both
      offer sweeps. STILL UNCOVERED on prod, announced on every run: offer countdown, confirm window,
      review window → auto-release, subscription expiry. Each needs a funded/hired job or a paid tier
      on the E2E accounts (the prod-lifecycle legs). Server cutoffs of `auto-expire-jobs` step 2
      (CT evening, DST nights), `expiring-jobs-push` and `sweep_*` have no clock-moving test now that the
      mock date filter is dropped. They need PGlite probes of the SQL sweeps, or pure cutoff helpers extracted from
      the edge functions.
- [ ] **Direct-offer expiry never tells the poster** (VERIFIED LIVE). `expire_pending_direct_offers()`
      (20260423025644) flips expired offers in one CTE, then notifies from a separate scan limited to
      `direct_offer_expires_at > now() - interval '5 minutes'`. Its only caller, `auto-expire-jobs`, runs
      `0 * * * *`, so only offers that expired in the 5 minutes before the hour are announced. Prod: 1
      expired direct offer (expired at :41), 0 "Direct offer expired" notifications ever. Repro:
      `node scripts/probes/offer-expiry.probe.mjs` → FAIL "expired 19 min before the hourly run →
      poster told (notifications=0)". Fix: notify from the UPDATE's RETURNING, and REVOKE FROM PUBLIC, anon,
      authenticated. Migration left to the coordinator: it was classifier-blocked for this lane. Re-measure with the probe (goes
      green) and the live count.
- [x] **An expired listing sits under "Waiting" until midnight.** DONE 2026-09-12: open + no pending
      applicants moves to Needs You at `expires_at` (owner: Needs You), live via `useExpiryClock`. Prod proof
      at 375 (local vite preview on prod Supabase): Waiting 3→2 and Needs You 13→14 1.6s after expiry, no reload. Seen in the time-travel screenshot
      `08-job-dst-fall-at-start`: at its start time an open, unfilled job reads "Expired", which is correct,
      but stays in the Waiting tab for the rest of the CT day. It is invisible to every helper from `expires_at` on, so there is
      nothing to wait for. It moves to Needs You only at CT midnight (`isPastDue` is day-grained). Product call:
      bucket on `expires_at <= now` as well.
- [x] **"Expired" shows for the last 59 seconds of a live listing.** DONE 2026-09-12: "Under a minute
      left" until `expires_at`, then "Expired" (seen on prod at 39.8s left and after expiry). `formatTimeLeft` floors to whole
      minutes and returns "Expired" when the floor is 0, while `JobCardMetaRow` has already decided the job is
      NOT expired. Copy call (e.g. "Less than a minute left"); the floor rule forbids "1 minute left".
- [ ] **`expiring-jobs-push` can never warn a short-lead listing.** It runs once a day (`14 14 * * *`) over
      `(now, now+24h]`, so a job posted after today's run that expires before tomorrow's is never warned.
      No other sweep covers it.
- [ ] **Lead, needs device repro: a phone clock >1h fast may sign the user out.** In the prod time-travel
      spec, one context per step with its own freshly minted session and the browser clock days ahead
      landed on "That page needs an account. Log in…" on 2 of 3 runs. supabase-js reads the stored `expires_at`
      against the device clock, and overlapping refreshes of a rotating token look like the cause. The spec now
      restates `expires_at` against the moved clock, which is a harness workaround. Repro: remove that line in
      `openAt` and run the job test. Confirm on a real iPhone with the clock set manually ahead before
      treating it as an app defect.
- [ ] **My Posts search only searches the open status tab, and says the job does not exist** (journeys
      lane, 2026-09-12, seen on prod at 390px). Repro: as the poster, post and fund a job (it lands in
      Waiting), open `/my-posts` (opens on Needs You), tap Search and type a word from its title. Result:
      "No jobs in this view / No jobs match your search — try a different term." with no pointer to
      Waiting, where the job is. The non-search empty state does point at other tabs ("14 in Done and 52
      in Cancelled"); the search empty state does not. A poster looking for a job they just posted is told
      it is not there. Screenshot looked at (`02-marketplace` failure-poster.png, run of 01:47Z). Journey
      J2 now opens the Waiting tab explicitly. Not fixed: needs a product call (search across tabs, or
      name the tab holding matches).
- [ ] **Tracking map throws "reading '_leaflet_pos'" on My Jobs** (journeys lane, 2026-09-12). Found by the
      J3 journey's error_logs check: as the helper, open `/my-jobs` and switch to Waiting while a card with a
      tracking map is mounted. `report()` fired `TypeError: Cannot read properties of undefined (reading
      '_leaflet_pos')` from TrackingMap. Prod `error_logs`: 13 rows since 2026-08-23, all from `/my-jobs`, 2
      users. Cause: `fitBounds`/`setView` animate, and the zoom-end timer reads a pane that unmounted.
      Fix in the commit adding this line: `animate: false` on both. Closes when the J3 journey runs green on
      the deployed bundle and `error_logs` shows no new `_leaflet_pos` row.
- [ ] **A hired, funded job never says the money is held, on either side's card** (journeys lane,
      2026-09-12, 390px, looked at). After Stripe funds the job (`payment_status = escrow`) and the helper
      accepts, the poster's expanded Scheduled card shows the tracker, photos and "Confirmation opens in 1d
      2h"; the helper's shows the tracker and the confirm deadline. Neither mentions that $25 is held for the
      job. The only place it is said is the one-time "Payment authorized" page. Product call: whether the
      Scheduled cards should carry a "Payment held" line (the disputed card already shows "Payment on hold").
      J4 records the count as a `funded-indicator` annotation rather than failing on copy that does not exist.
- [ ] **Log Out signs the user out on EVERY device** (journeys lane, 2026-09-12, VERIFIED LIVE). Profile >
      Log Out calls `signOutWithPushCleanup()` with no scope (`src/lib/authSignOut.ts:70`), and supabase-js
      defaults `signOut` to `scope: "global"`. Repro: mint two sessions A and B for one account; refresh B
      (200); press Log Out in a browser holding A; refresh B → `400 refresh_token_not_found`. So logging out
      of the website also logs the user out of the phone app, and Account Security's separate "Sign Out
      Everywhere" button does nothing Log Out does not already do. Side effect found the hard way: the
      journey's Log Out kicked every other lane off the shared helper account. Not fixed (auth semantics,
      owner call): likely `{ scope: "local" }` for Log Out. The J8 sign-out step runs only in
      e2e-journeys.yml (`JOURNEY_GLOBAL_SIGNOUT_OK=1`) until then.
- [ ] **Saving weekly availability can wipe the whole week** (journeys lane, 2026-09-12, VERIFIED LIVE).
      `HelperAvailability.handleSave` DELETEs the helper's weekly rows, then INSERTs the new ones, as two
      requests. Leaving the page (or losing signal) between them leaves ZERO rows, and the page then shows
      the fabricated default week (every day 9 AM–5 PM) as if it were the helper's. Repro: /availability,
      toggle a day, tap Save Availability and reload immediately. Measured on the shared helper:
      `helper_availability` went from 7 rows (Sun 9–5, Mon–Fri 8–5, Sat 9–1) to 0; restored by hand and
      re-read. Fix needs one transaction (an RPC replacing the week) plus the PGRST202 fallback; not done
      here. J7 now waits for the INSERT and restores the snapshot.
- [ ] **Two payout buttons on one card** (journeys lane, 2026-09-12, 390px, looked at). On the helper's
      Working card after both photos: "Request My Payout" (tracker) and "I'm Done — Request Payout" appear
      one above the other, both primary. `singlePrimaryCta.test.tsx` exists for this class and did not catch
      it on the live data path. J5 records the count as `payout-cta-count`.
- [ ] **A rate-limited message says only "Not Sent — Tap to Retry"** (journeys lane, 2026-09-12). The
      messages INSERT returned `400 P0001 "You are sending messages too quickly. Please slow down."`; the
      bubble showed "Not Sent — Tap to Retry" and "Couldn't Load Photo" (the attachment object was already
      gone, so a retry cannot succeed), with no reason given and no error_logs row. Hit on the shared poster
      account after repeated runs (limit: 30 messages/hour per sender).
- [ ] **Lead: "Work started — couldn't tell the poster"** (journeys lane, 2026-09-12). One run, Start
      Working showed that warning; error_logs 03:27:38Z `createNotification.insert` "Edge Function returned a
      non-2xx status code". The same call made directly as the helper minutes later returned 200. Likely the
      same repeated-run pressure as the message limit; confirm on a quiet account before treating as a
      defect.
- [ ] **Lead: boot watchdog "Helpr couldn't load." on a /profile load** (journeys lane, 2026-09-12 ~04:55Z,
      seen once, J8, 390px). A plain `goto('/profile')` painted the index.html boot-failure screen; the next
      run passed. Possibly a deploy in flight. The journeys' assertHealthy catches this pattern, so a repeat
      will fail the nightly with a screenshot.
- [ ] **Public profile shows "ID verified" and "Verification in progress" together** (journeys lane,
      2026-09-12, looked at). /user/437de07d… (Hallie H.) as the poster: both chips under VERIFIED.
- [ ] **Edit Profile keeps the old avatar after "Use Photo"** (journeys lane, 2026-09-12, looked at). After
      cropping and saving a new photo, `profiles.avatar_url` changes and the bottom-nav avatar updates, but
      the Edit Profile header still shows the initials until the page is left.
- [ ] **Skeleton screens pass `detectStuckOrBlank`** (journeys lane). Account Security's sessions,
      Warnings & Strikes and Earnings were screenshotted mid-skeleton while the detector (aria-busy /
      animate-pulse) reported nothing, so those skeletons use neither. Milestones now wait for network idle;
      the detector itself (e2e/errorScreens.ts) is not changed here.
- [ ] **Journey residue on the shared accounts.** Each marketplace run leaves a cancelled job, its
      conversation and notifications, and the helper's public profile now reads "Cancelled 51% · 30 of 59
      jobs" because test jobs are unwound after hire. prod-lifecycle has the same effect. Needs the scoped
      purge prod-lifecycle's header already asks for.

## Working forwards — owner, 2026-09-12: "all 6 need to happen"

- [x] **Lint for root-cause patterns at write time.** 53440856f `local/no-button-height-override` (76 legacy hits / 38 files, shrink-only ledger); 0f5bfe179 global control CSS may not out-rank utilities (red on the pre-fix index.css) and new-tab links may not target redirect routes (red on the original /terms case).
- [x] **Changed-screen checks before push.** 213053f0f `.husky/pre-push` → `npm run check:changed`: import graph maps a diff to routes, sweeps only those at phone-light (/login: ~10s, screenshot inspected). Press-every-control joins it when that harness lands.
  - [x] 2026-09-12: pre-push was red on every push (605df3d6f deleted the mocked `visual-audit-sweep` spec it ran). Now builds + `vite preview`s the LOCAL checkout on the per-worktree port and runs `--project=a11y-prod` (prod backend, test accounts, browser lock) on the changed routes only; job-detail-per-status block now honours SWEEP_ROUTES; no sessions = hard fail. Guard `src/test/playwrightTargetsExist.test.ts` (red on the old script). Proof: /support clean exit 0; injected 1.35:1 contrast → exit 1.
- [x] **Owner reports become failing tests first.** 55ba5a461 `npm run repro`; generated spec proven in the browser: located the element, screenshotted 375 + 1440, failed on its placeholder.
- [x] **One open-work list.** This file. CLAUDE.md now says so; memory handoffs and agent reports point here instead of carrying their own open items.
- [x] **Automatic browser lock + per-worktree test ports.** c3b133e39: `~/.lh-browser.lock` via Playwright globalSetup (second holder waited 10s, then ran); worktrees get a path-derived port, main keeps 4173.
- [x] **Nightly WebKit + real-backend run.** e83876cc5 `nightly-webkit.yml` runs the whole happy-path suite in real WebKit (helper-apply 2/2 locally; first CI run dispatched). Real backend already nightly in e2e-real-backend.yml.


### Guard burn-down — second front (2026-09-21)

- [ ] **49 guards delete the code they inspect; migrate them to `blankNonCode`.** A comment-stripping regex chain makes **157 of 1,054 TS/TSX source files lose real code** — `brand-asset/index.ts` loses 98% of its own code (52,892 chars), `charge-recurring-visits` 74%, `src/test/edge/harness.ts` 51%. (Counting code lost, not bytes removed; this repo's long header comments make bytes-removed meaningless.) SQL is not yet measured — a correct SQL scanner must recurse into `$tag$…$tag$` bodies, and a first attempt that treated them as opaque produced a bogus number. Found because `src/test/edge/sharedImports.test.ts` stayed green while `arrival-confirm-reminder` — 87% deleted, including the very call it hunts — had its import removed. Contained by `src/test/guardsDoNotDeleteSource.test.ts` (ratcheted, may only shrink) + `src/test/helpers/blankNonCode.ts`. **Each of the 49 has unknown real coverage.** NOT mechanical: a codemod mangled receivers (`body.slice(…)` → `body.blankComments(slice(…))`) and was reverted. Per file, re-run after each, treat every new red as a candidate finding.
- [ ] **The edge mock records chained filters but never matches on them** (`src/test/edge/mocks/supabase.ts`). A test can look like it pins a window while rows come back regardless — deleting `.lt("subscription_expires_at", now)` from `expire-subscriptions`' UPDATE left all 12 tests green. Every READ filter across the edge suite is therefore unproven (eligibility windows, `is_seed = false` scopes). Reported by two lanes; needs either a matching mock or a per-guard filter assertion.
- [ ] **No guard asserts a Stripe outflow has a durable ledger row.** `cash-out-credits` calls `stripe.transfers.create` with no `transfer_group` and writes no ledger row, so `money-reconciliation` cannot see it. Verified live: no `credit_cashouts` table exists and `referral_credits where redeemed` = 0, so it has cost nothing yet.
- [ ] **`verification-webhook` has 3 vendor branches; only Checkr is tested.** The `stripe_identity` branch (a second independent `constructEventAsync` with its own secret) and `certificial` have no test, nor does the `!secret || !provided` fail-closed precondition.

### Found while closing the audit gaps (2026-09-12)

- [ ] **The sweep never rendered /complete-profile.** Seed profile is complete, so it redirected to /dashboard; both owner bugs lived there. New `complete-profile-incomplete` screen. Uncommitted, waiting on the full sweep.
- [ ] **Profile photo on /complete-profile unreachable by keyboard/screen reader** (hidden file input, aria-label on <label>). Same class in 7 more pickers: dispute evidence x2, completion photos, Edit Profile photo, post-job photos x2, post-job video. All fixed + `fileInputsKeyboardReachable.test.ts`. Uncommitted.
- [ ] **aria-label on role-less elements, 15 places** (job-card chips, pinned/active dots, earnings projection, checkout redirect overlay, post-job photo labels). Fixed + `noAriaLabelOnGenericElements.test.ts`. Uncommitted.
- [ ] **Admin KPI tiles ragged in a row; fraud filter select 48px beside a 44px button.** Fixed; detector tightened with fixture cases. Uncommitted.
- [ ] **Pre-push check blocks on pre-existing sweep failures.** A global-file push runs the whole sweep; it was red on old sibling mismatches, so pushes needed LH_SKIP_CHANGED_CHECK. Closes when the full sweep is green.
- [ ] **One icon Button held at 44px by its parent's `[&_button]:h-11`** (AdminTopBar bell / menu). Intentional; detector now ignores parent-sized buttons.
- [ ] **Sweep mock data is thin.** 7 jobs, 8 applications, 6 messages, 2 reviews, 2 notifications; every other table returns [] (earnings, payouts, disputes, pets, home history, work record, saved Helprs, credentials, referrals, admin data) and nothing is long or crowded. Expand seed + add a heavy-content variant. Queued after the current sweep.
- [ ] **No end-to-end user-journey suite** (owner: "interactive and click through everything as a regular user would"). Only the money loop and two-role lifecycle exist. Build journeys for every flow on the real backend with the test accounts; Stripe steps need sandbox ON. Queued after press-every-control.
- [x] **Write contract: client writes checked against prod's schema.** `scripts/audit/write-contract.mjs` inventories every `.insert/.update/.upsert/.delete/.rpc` in `src/` (224 on 2026-09-12: 75 rpc, 83 update, 38 insert, 10 upsert, 18 delete, 0 unresolved) and checks each against `write-contract.snapshot.json` (read-only pull from prod): columns exist, NOT NULL sent, enum/check values, table + column grants, RLS policy per role and op, rpc existence/signature/EXECUTE. Guard: `src/test/writeContract.test.ts` (each check shown able to fail). Nightly `write-contract-refresh.yml` re-pulls and fails on drift. Still unchecked: 13 payloads built from non-literal objects (known keys checked, NOT NULL not asserted); anon role only for call sites listed in `ANON_CALL_SITES`; RLS `WITH CHECK` expressions are not evaluated.
- [x] **FIXED 1cdd3b786 — `saved_jobs` / `thread_pins` upsert failed on an existing row.** Verified live in `pg_policies`: INSERT/SELECT/DELETE policies, no UPDATE. PGlite repro: a fresh upsert works, but hitting the conflict raises an RLS error — exactly the "already saved" case the upsert was written for. Fixed with `ignoreDuplicates: true`; the write contract now passes.
- [ ] **`instant_book_claim` RPC called but dropped from prod** (`src/pages/dashboard/useApplyFlow.ts:244`). Verified live: `to_regprocedure('public.instant_book_claim(uuid)')` is null; dropped by `20260904034410_drop_dead_features_instant_book_skills_reminders_dup_disputes`. The call swallows PGRST202, so nothing visibly breaks, but the `isInstantBook` branch is dead code for a removed feature. Owner call: delete the branch (and any remaining instant-book UI). Baselined in `scripts/audit/write-contract.baseline.json`; remove the entry when fixed (the guard fails on stale entries).

### Queued — start only after several running audit agents finish (owner, 2026-09-12: "don't launch any more, wait")

- [ ] **Pre-release gate:** run every audit against the exact build being shipped to TestFlight/App Store; block the release on red.
- [ ] **Production watching:** alert when real users hit error screens or failed requests (Sentry + error_logs), not only in tests.
- [ ] **In-app "Report a problem" with state:** captures screen, route and recent errors automatically.
- [ ] **Accessibility sweep in WebKit:** the axe sweep runs only in Chromium; iPhone users get WebKit.

### Findings from paused audit lanes (2026-09-12), to triage on resume

- [ ] **Keyboard lane:** DOB wheel picker (`Month` listbox) focusable with no visible focus ring; focus drops to <body> after opening a message thread and after toggling the push master switch; `#require-photo-proof` switch reported unnamed (it has a `<label htmlFor>`, which should name a button, so verify in the accessibility tree before changing it). WIP a23bcb847 in its worktree.
- [ ] **Concurrency lane (leads, unrun):** `enforce_application_job_state` reads the job without a lock, so an application may land on a job being cancelled or re-priced; the client accept is a conditional update that doesn't check job status, so accept may stamp a cancelled job, or a cancel may count a just-accepted helper and charge a fee. Money/authz: needs a proven repro before any change.
- [ ] **Write-contract lane:** `instant_book_claim` RPC no longer exists in prod; `useApplyFlow.ts` quietly skips the error, so it is dead code. 4 open-payload `profiles` updates not yet checked against 11 non-updatable columns.
- [ ] **press-every-control:** checkout presses fail in mock mode because edge functions aren't mocked ("Couldn't open checkout"); the dock "Home" button reported not clickable on /profile; the payout-check banner is pressable but does nothing. Triage after the full run.
- [x] **Fixed by coordinator:** DST start time, listing expiry and confirm card zones (790004248); saved_jobs/thread_pins re-save RLS (1cdd3b786); press-every-control service-worker false failures (ef1574d65).

### Move every audit off mocks and onto prod (owner, 2026-09-12)

- [ ] **Seed prod test data** for the two test accounts in every state the mock seed had (all job/payment statuses, disputes, long thread, payouts, reviews, credentials, pets…), all `is_seed`, restorable, and never visible to real users. Replaces seedData.ts as the audit data source.
- [ ] **Visual sweep** against prod as the test accounts (not installSupabaseMocks). Empty/error-state sweeps: decide what replaces them honestly (a throwaway test account for empty; real network failure injection for errors).
- [ ] **press-every-control MODE=prod**: destructive presses allowed only on test-owned records; admin actions only against test targets.
- [ ] **Paused lanes on resume use prod:** keyboard/large text, messy input, interruptions, slow phone/returning, scorecard, explorer. Their mocked specs get migrated, not extended.
- [ ] **Existing mocked happy-path specs in CI** (e2e-happy-path.yml, ui-sweep): migrate to prod-backed or retire, one at a time, keeping CI green. (a11y-axe.yml DELETED 2026-09-14: its spec visual-audit-sweep.spec.ts was removed in 605df3d6f as superseded by a11y-prod, so every leg failed "No tests found"; a11y-webkit-prod.yml is the one a11y sweep.)
- [x] **CI red 2026-09-14 — E2E happy-path smoke** `device-pass-measure /dashboard @ 375-dark + 1440-dark`: Urgent corner chip on JobCard painted 9px label in raw `--accent` = 3.75:1 (#d46735 on #382b27). Now `--accent-ink` (light byte-identical). Guard is the spec itself (red since ef18b5af1). Still open: the spec is mocked; a prod dark-mode dashboard axe check with an urgent seed job should replace it.
- [ ] **Uncommitted mock fixture change discarded** (edge-function stub bodies) per this decision.

### REDO on prod — work that was only verified on mocks (owner: "no mock mode ever")

- [ ] Prod test data for every state (seed lane resumed on prod: scripts/audit/prod-seed.mjs).
- [ ] Button geometry + sibling heights (de9d3cd88, admin tiles, fraud select): re-verify on prod screens.
- [ ] Keyboard file pickers, aria-label roles, dark contrast (dbed7befd): re-verify on prod screens.
- [ ] /complete-profile sweep screen: needs a real incomplete-profile test account, not a mock rule.
- [ ] Stale-deploy spec (2263feec8): routes loaded with the prod backend.
- [ ] New-tab destination check (f5e0e104f): sweep side re-run on prod.
- [ ] Messy-input specs (1eb8e7caf), deep-link interruptions (c4a52d937 WIP), keyboard journeys (a23bcb847 WIP): migrate to prod before extending.
- [ ] press-every-control full run: MODE=prod, destructive presses only on test-owned records.
- [ ] Mock seed (59a92d362) and mock-only harness pieces: retire once prod equivalents pass.

### Launch checklist (owner decisions that flip at launch)

- [ ] **Switch Stripe to live** (`scripts/e2e/stripe-sandbox-off.sh`, owner-run). Owner, 2026-09-12: sandbox stays ON until launch so money journeys run nightly on the test card. After the switch, payment steps in audits skip as UNCOVERED unless sandbox is turned on for a test window.
- [ ] **Hide seed/demo jobs publicly** (`seed_jobs_hidden_publicly()`). Owner, 2026-09-12: stays OFF for now; anon browse shows 9 demo listings.

### From terminal 2 (keyboard a11y, done b6d24b625 + cc592fe46), 2026-09-12

- [ ] **DOB wheel: Tab changes the date.** Tab inside the DateWheelPicker lands on the option buttons, which scroll-snap the column and change the value (two Tabs moved the year 2008 -> 1906). Options should be tabIndex=-1 with arrow-key handling on the listbox. A keyboard user can silently corrupt their date of birth.
- [x] **AtAGlance stat tiles differ in height on /user/:id at phone width** ("4.5 5 reviews" 58px vs "5 Jobs completed" 70.3px), content wrap. Fixed (`auto-rows-fr`). Prod 375, helper profile: before 58/58/70.3/70.3 (grid spread 12.3px), after 70.3 x4 (spread 0); 1440 63.1 x4 before and after. Guard: e2e/journeys/stat-tile-heights.spec.ts (red on origin/main build by the 12.3px spread) + buttonGeometry fixture case.
- [ ] **git stash is shared across every worktree** and lint-staged writes to it constantly; a stash/pop in one worktree popped another lane's WIP (recovered via fsck). Rule for all sessions: use a WIP commit, never git stash.
- [x] Fixed: DOB listbox focus ring, focus kept on thread open, notification switches keep focus (nested component remount, also SignupStep1/ResetPassword), Complete Profile + Signup step 2 trailing-icon clipping, PhotoUpload and AtAGlance focus rings defeated by inline styles. Guards: focusableHasVisibleFocus, noNestedComponentDefinitions, keyboard-focus and trailing-icon-fields journeys.

## Routine consolidation (2026-09-12)
- [ ] OWNER: delete the 8 disabled cloud routines at claude.ai/code/routines (the API cannot delete): repo optimization, Playwright E2E, UI sweep triage, Accessibility, Full-app UX auto-fix, Main-is-broken watcher, PR triage, Daily digest email. None will run again while disabled.
- Deleted local tasks: lh-ledger-integrity, lh-prod-error-triage, lh-security-authz-drift.
- Kept (non-visual, merge only on green, silent when clean): Stripe webhook, Supabase advisor, Sentry, Edge Functions, iOS config drift, Bundle size, Docs drift, Weekly health. The 7:30 morning report now reads each one's latest run and reports only findings, merges and failures.
- Closed stale PRs: 1563, 1559, 1552, 1578, 1581 (vitest 5 migration, Sentry off the critical path, data-display polish to redo). Dependabot asked to rebase 1579/1580.

## Unshipped branches (owner review)
2026-09-13 local-branch sweep: no unmerged local branch holds real unshipped work. The 11 checked by this sweep were all patch-equivalent on main or superseded (partner/enterprise pages dropped, welcome modal removed, Apple IAP functions and admin shell already on main, marketing-claim files rewritten), and were deleted with tip shas logged in `docs/audit/deleted-branches-2026-09-13.log`. About 150 more were deleted by a different concurrent process during the run and are not in that log.
- [ ] Find which session deleted ~150 local branches on 2026-09-12 ~22:15 without logging tip shas; recover from its log or `git fsck --unreachable` if anything is missed.

## Agent queue (2026-09-13, max 3 at once; owner decisions applied)
- [x] Gift card rename LANDED 2026-09-13: migration 8c92b9d44 + code 0a397aa8a; prod verified gift_cards present, old gift table name null, 2 new RPCs, 0 old; old edge fns (the two old-name gift functions) deleted from prod; types.ts gift names match a fresh `supabase gen types` (full regen has 145 lines of unrelated drift, not applied); write-contract refresh dispatched. Expired listings (4f48acdac) and chunkReload (0f641f534) landed.
- [x] Admin AA contrast (4 views, a11y-prod sweep on local build + prod backend, 375 light+dark): people chip 4.38→6.71:1 and exceptions "stuck" chip 4.1→6.29:1 light / 4.12→4.88:1 dark (text-destructive → text-red-800 dark:text-red-400 on the bg-destructive/15 chips in AdminUserRow, UnsettledSettlements, AdminNotificationLogs failed badge); support meta 2.66→axe-clean light / 3.35→clean dark (text-muted-foreground/60 → text-muted-foreground). notiflogs 3.94 did not reproduce today (no failed rows); same chip fixed. Shared destructive token untouched (used app-wide). Owner-approved follow-ups in the same commit: PriorityAlert count chip 4.11→~6.3:1 (same red-800/red-400 fix); .segmented-count-selected pill (SegmentedControl, the one call site, same olive-gloss selected surface everywhere) bg parchment/0.22 → olivewood/0.4: 3.41→~7.5:1 light, 4.19→~8.2:1 dark. All 50 admin screens (25 views × phone light/dark) axe + resolver clean.
- [ ] Release/Accept + other money double-tap refs (worktree agent-aaec88c069873cd52, commit 75448970c)
- [ ] Admin follow-ups: unknown-tier fallback, support view, admin role indeterminate (worktree agent-a9c25acab110f3ea5, bb9a529fe)
- [x] AtAGlance equal tiles (worktree agent-a00a44b625c53174f) — landed, measured on prod
- [x] 24h messaging lockout + embedded double-card: LANDED 2026-09-14 as 6e3d2f7d1 (embedded cards) + fda1d23aa (lockout, migration 20260914201350, supersedes 20260831053124 and the 90d23935d draft); branch `lockout-embedded` deleted. db-deploy run 34893651774 log: "Applying migration 20260914201350… Finished supabase db push" (functions-deploy not triggered: no function files). Vercel build-commit meta = fda1d23aa. PROD PROOF (375, prod web + prod DB):
  - [x] Objects: all 6 functions resolve, jobs.completed_at timestamptz, `zz_jobs_stamp_completed_at` is the last BEFORE trigger on jobs; schema_migrations has 20260914200051 and 20260914201350.
  - [x] proacl: can_message_in_job {postgres, service_role} only; can_send_message_in_job and get_messaging_closes_at +authenticated, no anon; job_messaging_closes_at, job_legacy_completed_at, stamp_job_completed_at no client role. Live RPC as poster/Helpr: can_message_in_job 403 42501 "permission denied".
  - [x] pg_policies: 0 policies reference can_message_in_job; `messages."Users can send messages"` and `storage.objects."message-attachments: sender uploads to own path"` (INSERT, authenticated) call can_send_message_in_job.
  - [x] Backfill: 17 completed jobs, 0 with null completed_at, 0 differing from job_legacy_completed_at; revision job 67e8ccfe = GREATEST(poster 02:20:24, helper, revision 02:19:22) = 02:20:24 (updated_at untouched, 2026-09-10); 0 disabled triggers in any schema; 0 notifications and 0 completed-job updated_at bumps after the apply.
  - [x] Seed job 5f20df1e at completed_at −23h: poster and Helpr each sent text + a photo from the UI, 4 rows, no "Not Sent". At −25h from the still-open composer: toast "This conversation closed 24 hours…", bubble "Not Sent — Conversation Closed", composer flips to the notice, 0 rows written; storage upload to own path 403 RLS, REST insert 403 42501, get_messaging_closes_at returns closes_at = completed_at+24h. Fresh open from the inbox: notice, no composer, history shown, both accounts. Screenshots light+dark (composer 23h, sends, refused send, toast, notice ×2 accounts, Helpr My Jobs confirmed card, poster My Posts in-progress card: 0 bordered boxes inside the card) all review-logged (`docs/audit/launch-2026-09/review-logs/lockout-proof-2026-09-14.jsonl`). Cleanup: 4 messages, 4 notifications, 2 storage objects deleted; completed_at restored to its backfilled 2026-09-12 19:41:47.276+00 (read back = job_legacy_completed_at).
  - [x] write-contract snapshot refreshed (new lockout RPCs, can_message_in_job authenticated=false); check 0 rejects.
  - [x] FIXED 2026-09-14: the deep-link effect now opens through `openConvo` (the inbox tap's loader; it also keys on the cached auth user so frame one has an id). Vitest `useMessagesData.test.tsx` "a deep-link open loads the thread's messages" red first; class check `src/test/threadOpenSingleLoader.test.ts` inventories every entry (in-app `/messages?jobId=` links, server notification link + nativePush tap, `/m/:id` short links, inbox row) and fails on any `setActiveConvo(x)`/`openThreadUrl()` outside `openConvo` — red on the original at exactly useMessagesData.ts:336/337/376/377. Prod 375 (poster-e2e, job 5f20df1e): live site "Say hello." → fixed build full history, overflow 0; review-logged. Pre-existing, not touched here: reaction chips overlap bubble text in that thread (fixed separately, see below). WAS: NEW, PRE-EXISTING (not caused by the lockout; the effect is unchanged by both commits): a `/messages?jobId=&userId=` deep link (every message notification) opens the thread WITHOUT loading its history. Prod 375, both accounts: "Say hello. Send the first message…" over a thread with 38 REST-visible messages, and on a closed thread that empty state sits above the closed notice. Opening the same thread from the inbox shows the history. Cause: the deep-link effect in `src/pages/messages/useMessagesData.ts` (openIfMatch / placeholder) calls `setActiveConvo`, never `openConvo`, so the thread fetch never runs. Needs a fix plus a class check (every path that sets an active thread must load it).
  - [x] Helpr side, owner approved flat (2026-09-14): HelperTrackerPanel root is now `space-y-2`, no `rounded-2xl liquid-glass p-3`. `noNestedTrackerCard.test.ts` widened with a cross-file job-card render walk (seeds = everything inside `<JobCardShell>`), red on exactly HelperTrackerPanel first. Prod 375 helper-e2e My Jobs in-progress card, light + dark: before 1 nested glass box, after 0; rail, CTA and chips unchanged; overflow 0; review-logged. Was: HelperTrackerPanel still one bordered glass panel inside the job card (card → panel, measured 267×160).
  - [x] FIXED 2026-09-14 (owner approved flat): `GroupJobHelpers` root is now `space-y-3`, no `rounded-2xl liquid-glass p-5`. The name exemption (REPORTED_NOT_FIXED) is gone from `noNestedTrackerCard.test.ts`, which was red on exactly GroupJobHelpers first and now also asserts the walk reaches it. Prod has ZERO group jobs (`is_group_job=true`: 0 rows, `group_job_helpers`: 0 rows, read 2026-09-14), so no prod screenshot exists; a local props-only render in JobCardShell at 375 light + dark: nested glass 1 → 0, overflow 0, review-logged. WAS: REPORT, not fixed: `GroupJobHelpers` (root `rounded-2xl liquid-glass p-5`) renders inside PostedJobCard's JobCardShell on group jobs, a bordered box inside the poster card.
  - [x] FIXED 2026-09-14 (owner approved): reaction chips covered message text. Cause: chips were `absolute -top-3` on the bubble, and the global 44px tap floor (`index.css :where(button…)`) made each one a 44px disc over the first line. Chips now sit in flow below the bubble (bottom corner away from the speaker, `-mt-2` into the 10px bottom padding), sized to the emoji with `min-h-0 min-w-0` and a 44px hit area via `before:-inset-3`. Class check `e2e/prod-audit/reaction-chip-clearance.spec.ts` (prod-audit project, nightly): every chip's box vs every text rect in the poster-e2e thread with the most reactions, at 375 and 1440. Red on the live site at both widths (44x44 chips over "there", "8:30.", "First", "Gate is back on its hinges."), green on the fixed build against prod data (6 reacted rows: own + other, 1- and 2-line, one with two chips). Screenshots 375 light + dark and 1440 review-logged (`docs/audit/launch-2026-09/review-logs/reactions-groupjob-2026-09-14.jsonl`).
  - [x] Legacy-thread reopen leniency: FIXED in the same migration (owner, 2026-09-14: "don't leave these for later"). Every job already `completed` is backfilled `completed_at = job_legacy_completed_at(...)`: both party stamps → GREATEST(poster, helper, revision_completed_at); one stamp → that stamp + 24h (auto-release); neither → updated_at. Runs with the table's enabled user triggers off for that one statement (no updated_at bump, no notifications; already-disabled triggers stay disabled). The fallback clock no longer takes GREATEST over `updated_at`. PGlite: a backfilled job stays closed after later client and service row writes. Prod check after deploy: `select count(*) from jobs where status='completed' and completed_at is null` = 0 (17 rows to backfill at 2026-09-14).
  - [x] Poster card-in-card: PostedJobCard's JobTracking and JobConfirmation (inside JobCardShell) now render `embedded`; `noNestedTrackerCard.test.ts` derives card components from source and was red on exactly those two call sites first.
  - [x] `can_message_in_job(any sender id)` was client-callable (live proacl: authenticated=X; only caller the messages INSERT policy). Policy now calls `can_send_message_in_job(job_id)` (uses auth.uid()); the 2-arg function lost every client grant.
  - [x] `get_messaging_closes_at` no longer admits bare applicants: poster, assigned/offered Helpr, roster, or someone with a message on the job.
  - [ ] Same shape, NOT changed (report): `is_party_to_job(_job_id, _user_id)` is still authenticated-callable with an arbitrary user id (used by the messages INSERT policy for the receiver, and by 4 storage.objects proof-photo policies), so a signed-in user can ask whether any user is poster/Helpr/roster/applicant on any job. Needs its own fix: a policy needs the receiver id as an argument, so it cannot simply bind to auth.uid().
- [ ] Dead code deletions (wip agent-a7af3ac420980771a, 70f851af7) PLUS owner-approved drops: pet_profiles.is_evacuation_registered, jobs.protection_opted_in, profiles.push_consent/sms_consent, platform_settings.latest_build
- [x] Visible names: helper→Helpr copy + guard, signed-in heading "Home", /saved-helprs (shipped 2026-09-13; 375 prod screenshots reviewed)
- [x] Post Job double-tap prod test LANDED 2026-09-14 (`e2e/prod-audit/interruptions.spec.ts` "double-tap the final Post creates exactly one job"; branch wip/postjob-doubletap-driver deleted). Two `.click()`s in one JS task on the final Continue to Payment, local build against prod at 375. RED (useJobSubmit `submittingRef` check removed): 2 POST /jobs, **2 job rows** (both is_seed); GREEN (guard restored): **1 row**, test passes. Screens reviewed (review:record): details, logistics, checkout, double-tap (both land on Stripe Sandbox $28; in RED the duplicate is invisible to the user). All 5 E2E-PRODAUDIT job rows (2 red, 1 green, 2 left from 2026-09-13) deleted with service role, read back 0.
- [x] prod-audit post-job teardown leftover CLOSED 2026-09-14: `scripts/e2e/prod-audit-sweeper.mjs` (service-role, run `if: always()` in `.github/workflows/prod-audit.yml` right before the key is removed) deletes jobs where title contains the bracket-free `E2E-PRODAUDIT` AND customer_id is a shared test poster account AND is_seed=true — the exact residue `poster_cancel_job` leaves once a Stripe checkout session blocks the poster's own DELETE. Refuses without the service-role key, `--dry-run` supported, hard cap 50 (exit 1, no deletion, if exceeded). `src/test/prodAuditSweeper.test.ts` (12 tests) covers the filter and the cap; RED confirmed against the bracketed marker (the original bug — 3 tests failed), GREEN on the bracket-free one. `interruptions.spec.ts`'s stale "nothing removes these rows yet" comment updated to point at the new sweeper. prod-audit.yml stays disabled (`gh workflow disable`, unchanged).
- [ ] Full customer/helper → poster/Helpr internal rename, NO aliases (after gift card rename lands)
- [ ] Combobox keyboard model (~/.lh-prompts/combobox.md); race fixes (~/.lh-prompts/race2.md) unless a terminal took them
- [x] Stripe CI check: LANDED 2026-09-12 as `scripts/check-stripe-webhook-events.mjs` + `.github/workflows/stripe-webhook-guard.yml` (>1 enabled endpoint per URL, plus event drift vs EVENT_HANDLERS both ways). Still needs the `STRIPE_TEST_SECRET_KEY` secret — see the #1586 section above.
- [x] Stripe #1586: test-mode audit endpoint we_1Tql6m… DELETED 2026-09-12 (`{"deleted": true}`); one enabled endpoint remains on the stripe-webhook URL. Issue closed.
- [x] types.ts drift DONE 2026-09-14: regenerated from prod (`fncmgoasalhdgfwzhsqa`, one schema read) and committed matching `npm run db:types` (`--schema public`). Drift was ADDITIONS only — nothing stale was left asserting a guarantee prod had withdrawn: new table `notification_dedupe_suppressions`; new columns `platform_settings.{application_cap_per_hour,application_cap_per_minute,daily_application_cap,signup_rate_limit_per_hour}`, `profiles.identity_sha256`, `retained_bans.{identity_sha256,phone_sha256,retained_via}`; 11 new RPCs `application_cap`, `ban_fingerprint`, `ban_fingerprint_salt`, `enforce_retained_ban`, `identity_fingerprint`, `job_is_funded`, `job_payment_is_funded`, `normalize_phone_for_ban`, `open_dispute_as`, `retain_ban_for_user`, `save_weekly_availability`; one tightening, `open_jobs_browse.require_photo_proof` `boolean` -> `boolean | null` (already handled everywhere by `?? true` / `=== false`, see `src/lib/photoProofPolicy.ts`). `npm run typecheck` clean, zero errors. Drift GUARD already exists and is already wired: `scripts/check-types-fresh.mjs`, called by `.github/workflows/db-drift-detect.yml:137` — no new script and no workflow edit needed; it reports `✔ 962 columns, 164 functions` against this file.
- [x] Stale `supabase.rpc` casts DONE 2026-09-14: 19 cast sites cleared now that types.ts is fresh (18 `supabase.rpc`, 1 table) — the 10 single-line ones (`admin_reverse_violation` UserAuditLog, `clear_available_now` + `set_available_now` AvailabilityTab, `toggle_thread_mute` + `clear_thread_mute` + `get_muted_threads` threadMutes, `get_user_last_active` loadConversations, `record_profile_view` useUserProfileData, `respond_to_review` UserProfile), the 5 multi-line ones (`rpc_open_dispute` DisputeDialog, `rpc_decide_dispute` AdminDisputes, `rpc_escalate_dispute` PostedJobActions, `get_payout_batch_job_ids` AdminPayoutBatches, `admin_support_queue` AdminSupport), plus 4 more the grep for the same comment turned up: `rpc_check_application_rate` + `rpc_record_application_attempt` (applyRateLimit), `get_helper_analytics` (useHelperAnalytics), `subscription_purchase_eligibility` (iap), and the `favorite_helpers.private_note` table cast (useSavedHelpers). ONE real mismatch found and fixed: `record_profile_view` was being passed `userId: string | undefined` against a NOT NULL uuid arg — now narrowed by a `userId &&` guard, not an assertion. ONE cast deliberately KEPT and its comment corrected: `set_thread_snooze._until` is legitimately nullable (NULL = mute forever, migration 20260609150000) and a generated `Args` type cannot express a nullable argument — the call is now typed on name and return with only that one argument widened. GUARD: `src/test/staleRpcCastComments.test.ts` fails on any "drop the cast once types.ts is regenerated"-style comment beside a cast whose RPC types.ts already declares; shown red on both shapes via `src/test/fixtures/staleRpcCast.ts.txt`.
- [x] Remaining `supabase.rpc` casts DONE 2026-09-14: the 14 reported below, plus 3 the report missed and 1 table boundary — 18 cast sites cleared, every one an RPC types.ts already declares. Removed: `get_job_pets` (JobPetCareSheet), `rpc_withdraw_dispute` (DisputedSection, PostedJobActions), `admin_delete_review` (AdminReports), `record_job_view` (useJobDetailData), `accept_group_application` + `respond_to_direct_offer` (useOfferHandlers), `mark_applications_viewed` (useApplicantsState), `apply_to_job` (useApplyFlow), the four in useUserProfileData (`get_user_repeat_hire_percent`, `get_public_profile_stats`, `get_public_profile_reviews` x2, `get_my_reply_latency`), `save_weekly_availability` (HelperAvailability), `get_public_profile_reviews` (PublicReviewWall), `get_public_profile_stats` (reviewStats), `block_user_and_settle` (userBlocks), and the `callUntypedRpc` boundary in `postedJobsHelpers.ts` — DELETED outright, its six RPCs (`get_job_view_counts`, `get_neighbor_hire_count`, `get_helper_completed_counts`, `get_helper_repeat_hire_percents`, `get_helper_on_time_percents`, `get_helper_distances_from_job`) are all declared and now call `supabase.rpc` directly. THREE MORE the report did not list, found by the new guard because it does not depend on comment wording: `poster_cancel_job` (CancellationDialog), `apply_low_rating_flag` (CompletionPrompts), `apply_message_violation_consequence` (logViolation). `marketingApi.ts`: the whole hand-written `marketingTable`/`Chain`/`RawResult`/`RowsResult` boundary is gone — `marketing_content` and `marketing_settings` are both in types.ts now, so the 9 queries are checked against the real schema (`CONTENT_COLUMNS` had to become ONE string literal: a `+` concatenation widens to `string` and degrades the row to `GenericStringError[]`, which is how a select-list can silently stop being checked). TWO real mismatches, both fixed without a cast: `block_user_and_settle` and `poster_cancel_job` were passing `p_reason: null` against `p_reason?: string` — both declare `p_reason text DEFAULT NULL`, so the reason is now OMITTED, which is the identical server call and IS expressible in the generated Args (userBlocks test updated to match). ONE cast deliberately KEPT: `apply_to_job._p_message` is genuinely nullable (no default, inserted into the nullable `applications.message`; current definition in migration 20260907230038), so that ONE argument is widened with a `// nullable-arg:` justification while the RPC name, the other argument and the `string` return stay checked. Also removed the dead `QueueRow` type c8683f022 left in AdminSupport.tsx, which had `npm run lint` RED on main. GUARD: `src/test/rpcCastsOnDeclaredRpcs.test.ts` fails on ANY `as any`/`as never`/`as unknown` inside a `supabase.rpc` call for an RPC types.ts declares — and on a re-introduced `fn: string` wrapper — unless the call carries a `// nullable-arg:` line; shown red on all 23 sites first, and on `src/test/fixtures/declaredRpcCast.ts.txt` (3 offending shapes + 1 that must stay green). Unlike its sibling `staleRpcCastComments.test.ts` it does not read comment wording at all, which is exactly why it caught the 4 extra sites.
- [ ] Race fixes (terminal closed → agent): settle_dispute_record, DisputeDialog, JobTracking helper_completed_at. Partial WIP (8 files, unverified) on origin/wip/race2-terminal c983eb2a9; brief ~/.lh-prompts/race2.md
- [x] Combobox keyboard model (terminal closed → agent). Partial WIP on origin/wip/combobox-terminal 6f7c27387 (+ a 1-file WIP on wip/lexilombas-.lh-combobox-ws); brief ~/.lh-prompts/combobox.md DONE 2026-09-14: shared useComboboxKeyboard; proven keyboard-only on prod at 375 (Browse, City, Address/MapKit).
- [ ] OWNER: add STRIPE_TEST_SECRET_KEY repo secret (test-mode restricted key, Webhook Endpoints: Read) — stripe-webhook-guard live job is red until then
- [x] Button-height gate false positives on prod data (FIXED: `ul[aria-label="Upcoming 7 days"]` exempt in buttonGeometry.ts with its reason; fixture case red without the exemption): earnings bar-chart day buttons (bars differ by design) on helper-profile-earnings/-payment/helper-earnings; AtAGlance stat tiles on user-profile (covered by the tiles item). Seen when a global CSS push swept every route.
- [x] Pre-push sweep now nearest route only, max 3 screens (full sweep stays nightly). Order for remaining queue: easiest first.
### PROD DB OVERLOAD (2026-09-14) — cause found
- Supabase Infrastructure page: Disk IO 100%, CPU 80%, compute 100% on t4g.nano (free tier); disk space fine (25%). ~9 nightly workflows hit prod inside 06:00–09:20 UTC plus agent prod tests, draining the disk-IO allowance; DB down since 2026-09-13 00:40 PDT, restart did not help.
- [x] Owner chose pause + spread out. DISABLED (gh workflow disable, 2026-09-14): e2e-real-backend, e2e-journeys, nightly-webkit, e2e-abuse-notifications, a11y-webkit-prod, prod-audit, press-every-control, race-runner, write-contract-refresh, prod-errors (*/15), edge-function-smoke, db-drift-detect.
- [x] RE-ENABLED 2026-09-14 ~17:33 PDT, all at once by owner choice (spaced crons + shared `prod-load` group already shipped; `prodWorkflowSpacing.test.ts` 4/4 green first; DB answering, first probe 10.5 s then 0.2–0.5 s). All 10 remaining `disabled_manually` workflows enabled; prod-errors and db-drift-detect were already active. Watch Supabase Disk IO after the first 03:17–11:17 UTC cycle; write-contract-refresh still needs its one proving dispatch (item below). Was: When the DB is healthy: re-enable ONE AT A TIME with crons spread across the day (one prod-hitting run per ~2h, prod-errors hourly not every 15 min), and a guard test that fails if two prod-hitting workflow crons fall within 90 min of each other. Agents: at most one prod-testing job at a time.
- [x] Crons spread + guard shipped (2026-09-14; workflows still DISABLED, re-enable one at a time). `src/test/prodWorkflowSpacing.test.ts` derives the prod-hitting set from the files (ref/URL, SUPABASE_PROJECT_REF, E2E_SUPABASE_URL, PLAYWRIGHT_* creds, prod Playwright projects) and fails on <90 min spacing, missing `prod-load` concurrency, or sub-hourly crons; red on the old origin/main (81 violations), green now. Every prod slot starts at :17 UTC between 03:00 and 13:00, 2h apart, all in concurrency group `prod-load` (cancel-in-progress false):
  | UTC | Sun | Mon | Tue | Wed | Thu | Fri | Sat |
  |---|---|---|---|---|---|---|---|
  | 03:17 | prod-audit | press-every-control | e2e-journeys | press-every-control | prod-audit | e2e-journeys | press-every-control |
  | 05:17 | db-drift-detect | db-drift-detect | db-drift-detect | db-drift-detect | db-drift-detect | db-drift-detect | db-drift-detect |
  | 07:17 | db-backup | db-backup | db-backup | db-backup | db-backup | db-backup | db-backup |
  | 09:17 | nightly-webkit | a11y-webkit-prod | nightly-webkit | a11y-webkit-prod | e2e-journeys | a11y-webkit-prod | nightly-webkit |
  | 11:17 | e2e-real-backend | e2e-real-backend | e2e-abuse-notifications | e2e-real-backend | edge-function-smoke | e2e-real-backend | write-contract-refresh |
  | hourly :47 | prod-errors (window 20→65 min) | | | | | | |
- [ ] RISK, owner/coordinator call: GitHub keeps ONE pending run per concurrency group and a newer queued run cancels it. With hourly prod-errors in `prod-load`, any run that outlasts its 2h slot (prod-audit timeout 300 min, press 150) leaves the next slot's run pending, and the next :47 prod-errors cancels it silently. Options: give prod-errors its own group, or cap heavy timeouts under 2h.
- [ ] Not moved into `prod-load`: race-runner (boots a local Postgres service, never talks to prod; cron unchanged 08:37), ui-sweep (mocked; its push/PR cancel logic would cancel scheduled prod runs). Press-every-control (4 parallel shards) and e2e-abuse-notifications (matrix) lost their workflow-level `prod-lifecycle-shared-accounts` lock, so a push-triggered e2e-real-backend money loop can now overlap them on the shared accounts; e2e-journeys and prod-audit keep it as a job-level lock.
### MAIN IS RED (found 2026-09-13 ~01:00) — do these FIRST
- [x] FIXED (OPEN.md lines reworded; charge-recurring test expects "standing Helpr" after 045f5301d; 25/25 pass). Was: Vitest 34745606695: giftCardNaming guard fails (a file added after 0a397aa8a uses the old name) and charge-recurring-visits.test.ts "records a defect when the poster/helper de…" fails. Fix both; run the two files.
- [x] FIXED (two-dot tree diff; proven in a depth-1 clone: OK, exit 0). Was: Test 34745606366: "No oversized binary enters git history" step crashes — `git diff --diff-filter=AM <before>...HEAD` fails in CI (shallow checkout lacks the base sha). Fetch depth or fall back.
- [x] DONE 2026-09-14 (snapshot refreshed and committed). The SQL was never the problem: no dropped/renamed name in it, and a local `node scripts/audit/write-contract.mjs --refresh --check-drift` ran clean against prod (0 REJECTs; exit 2 = drift only). Drift committed: 13 dead functions gone (count_profiles, get_approved_helpers, get_helper_parish_badges, get_hero_parishes, get_marketplace_activity_count, get_monthly_profile_view_count, get_platform_benchmarks, get_platform_impact_stats, get_public_avg_rating, get_public_completed_job_count, get_public_job_stories, get_recent_public_payouts, review_helper_credential), 2 dead tables (pet_report_cards, subscription_cancel_reasons), dropped columns jobs.protection_opted_in/scope_video_thumbnail_url, pet_profiles.is_evacuation_registered, platform_settings.latest_build, profiles.push_consent/sms_consent, gift_cards policies. the retired credits table, under its pre-gift-card name, appears nowhere (SQL, snapshot, src). Was: Write contract snapshot refresh 34745765776 failed; SQL suspected.
- [x] PROVEN GREEN IN CI 2026-09-14: dispatched run 34913880468 succeeded; "Refresh snapshot and check drift" ran against prod and printed `write-contract: snapshot unchanged`, no IPv6 error. Was: FIX SHIPPED 2026-09-14, CI PROOF STILL OPEN: the workflow now runs a real `supabase link --project-ref` with SUPABASE_DB_PASSWORD (as db-drift-detect/db-backup do) and passes the password to the query step. Not yet proven green in CI: the agent could not re-enable/dispatch the disabled workflow (its tooling refused `gh workflow enable`), so whoever re-enables write-contract-refresh must dispatch it once and read the result. Was: write-contract-refresh CI failure is NETWORK, not schema (every run since 09-13 incl. scheduled 34846751782): `supabase db query --linked` in the runner prints "IPv6 is not supported on your current network … supabase link to setup IPv4 connection" because the workflow's "Link project" step only writes `supabase/.temp/project-ref` (no pooler-url). Fix in `.github/workflows/write-contract-refresh.yml` (workflows lane): run `supabase link --project-ref` or write the pooler URL before the query, then re-enable the workflow (currently disabled_manually, so `gh workflow run` returns 422).
- [ ] E2E happy-path smoke 34746217548 red — two real failures: (a) /dashboard 375-dark and 1440-dark axe color-contrast 3.75:1, #d46735 bold 9px on #382b27 (likely a badge/chip; check whether af75d23c0 segmented-badge change or older); (b) activity-card-density.spec.ts:676 "an action in the bo…" toHaveCount got 2. These specs are the MOCKED happy-path set — reproduce on prod before fixing, then migrate the spec to prod. and E2E real backend cancelled; nightly-red #1592 (e2e-real-backend) open. Read the failing runs themselves and fix.
- [ ] Open PRs: dependabot #1580, #1579, #1550, #1549 and #1529 "fix(e2e): resolve 4 Playwright failures" — land green ones in ONE batched merge window, close stale ones with a reason.

### Gaps found 2026-09-13 night (owner approved all; work top to bottom, batch pushes)
- [x] DONE 2026-09-14 (strikes cleared + check). `node scripts/check-test-account-strikes.mjs` (3 service-role reads over the 6 shared accounts) was RED on prod: poster-e2e `ban_status=final_warning` + user_violations 117785e6 (off_platform/warning, 2026-09-13 01:56); helpr-audit-web-0824 user_violations 8062bb28 (cancel_with_helper/warning, job a2a61dc7, 2026-09-08). Both rows deleted (returned 2), poster-e2e restored to active (returned 1), check re-run GREEN (exit 0). Unit test src/test/checkTestAccountStrikes.test.ts. user_strikes was already empty for all six.
- [x] DONE 2026-09-14: step "Shared test accounts carry no strikes" (if: always(), before the key is removed) fails the job on exit 1 and warns on exit 2. Not run in CI yet (prod-audit disabled). Was: Wire `node scripts/check-test-account-strikes.mjs` into `.github/workflows/prod-audit.yml` as its last step (workflows lane): it already holds SUPABASE_SERVICE_ROLE_KEY, runs in `prod-load`, and follows the journeys that make strikes. Exit 1 = a strike, 2 = could not check.
- [ ] Make every harness that can add a strike (race probes, journeys, interruptions, messy input) delete its user_violations/user_strikes rows and restore ban_status in cleanup (the check above catches a miss; it does not prevent one).
- [x] DONE 2026-09-14. Was: Job card at 375: "Under a minute left" chip squeezes location to "B…". The card is the Activity meta row (JobCardMetaRow: My Posts / My Jobs), not the browse JobCard (already hides the countdown <430px). Before, prod data at 375 (helper-e2e /my-posts, card 0e78dd2a, clock pinned 30s before expiry): city "New Iberia" 20px of 59px ("N…"), countdown 125px. After: city 59/59px full, countdown ellipsizes at 86px ("Under a mi…"), no-countdown card unchanged, no page overflow; both screenshots looked at and recorded (review-log). Countdown is `min-w-0 shrink-[100]` + truncate; city is `shrink-0 max-w-[50%]` only while a countdown is on the row. Guard JobCardMetaRow.locationPriority.test.tsx, RED on the old classes.
- [x] DONE 449fe9d9b (named exemption; planted bad fixture FAILS now, PASSED before). Was: fixtureSchemaContract was loosened (skips literals where most keys aren't table columns) so wrong fixtures slip through. Tighten: exempt only the known non-row object in e2e/visual-audit/responsive.spec.ts by name, keep majority rule off; prove a deliberately wrong fixture fails.
- [x] INCONCLUSIVE: the saved subagent transcripts (a586a5b8…, a27a9405…) contain no denied tool call — the block was not persisted. Nothing unsafe landed: branch triage deleted only 11 logged branches; the money agent pushed with a logged skip reason. Was: Two agents tripped the auto-mode safety classifier (branch triage 2026-09-13; money double-tap refs). Read their transcripts, name the blocked commands, report whether anything unsafe was attempted.
- [x] DONE a33298034 (Sets keyed by id; different-card tests RED on boolean, GREEN now). Was: Accept/Release handlers share one in-flight boolean per hook: a tap on job B while job A is in flight is silently ignored. Key the ref by job id.
- [x] DONE 22f4df0c0 (ref guard; test RED 2 sends on old code, GREEN 1). Was: RichMessageInput send has only a state guard: same-frame double send can post two messages. Add the ref guard + test.
- [x] DONE f5bf06ec8 (3s bounded purge steps; offline refund; 2 tests RED→GREEN). Was: chunkReload follow-ups (0f641f534): error screen can stick on "updating" when the reload aborts offline or cache-clear hangs; the success reset only tidies storage. Fix or reword.
- [x] CHECKED 2026-09-14: neither run succeeded (both, and every later one, died on the runner's IPv6 connection, see the network line above); the snapshot is now refreshed locally and no longer lists the dropped objects. Was: write-contract-refresh was dispatched twice (runs 34742767511, 34745765776): confirm each succeeded.
- [ ] After the Vercel limit resets and prod catches up: re-count "admin role indeterminate" rows in error_logs (fix e9fcac710) — any new row is a real failed check; close nightly-red #1591.
- [x] TRIAGED 2026-09-14 (read, not re-run). Was: press-every-control #1582: read run 34744828202. Two real runs read: 34744828202 (155 failed presses) and the latest 34865377511 (5; every authed persona UNCOVERED, sign-in HTTP 522). Real defect, FIXED: "Not Now" in the push rationale dialog raised an ERROR toast "Notifications are off. Turn them on in your browser settings." (12 presses) — NotificationPanel now toasts only when permission is actually denied/unsupported (`pushDeclineNeedsSettingsHint`, test RED without it). Harness false positive, FIXED: 404 on /_vercel/(speed-)insights/script.js on the local preview failed "Go Back" (3 presses) — `ignoreHostOnlyAsset`, tested. Environment (prod DB outage 2026-09-13 07:39Z / 09-14 16:00Z), no code change: 21 error-on-load + 19 "admin role lookup timed out" + 5 CORS-on-5xx + 4 OAuth buttons "not clickable" (click landed on Cloudflare 522). Harness false positives, listed below.
- [ ] press-every-control harness: 84 "control not found on a freshly loaded page" are Notifications panel rows (labels carry relative time "2h ago" and the list re-sorts) plus /account-pending customer nav after the redirect; re-address list rows by stable id, not label+ordinal.
- [ ] press-every-control harness: 11 "no observable change" are presses on the already-selected segment (Notifications All / Unread), self-route presses (Post a new job on /post-job, Home on home) and an empty-form submit whose only effect is the native "Please fill out this field" bubble; classify selected-segment, self-route and native-validation as documented skips.
- [ ] Verify on prod when the DB is healthy (one load): the Notifications panel read "Nothing new yet." for a poster whose Unread count was 313 during the 09-13 timeouts (run 34744828202 shot customer_missing_Hallie_H_…-6). If a failed/timed-out load renders the empty state instead of the error card, that is a silent failure.
- [ ] Re-run press-every-control once prod is steady; both runs read were outage-degraded, so authed coverage is still unproven (#1582 stays open until a green or triaged healthy run).
- [x] DONE 2026-09-14. Was: Test helper account avatar (Hallie Helper) replaced on prod storage with a generated PNG; make prod-seed.mjs own that file. `node scripts/audit/prod-seed.mjs --avatar` (also runs inside --apply, checked by --verify): HEAD avatars/437de07d…/avatar.png; if missing, upload a deterministic 256px PNG generated in the script (x-upsert false, nothing binary in the repo) and repoint profiles.avatar_url. Ran once on prod: "present, left alone (image/png, 427253 bytes)", avatar_url already correct. The upload branch has not run against prod (file present); the generated PNG was decoded locally (256x256 RGB, looked at).
- [ ] Untracked in the main checkout: docs/audit/naming-and-dead-code-2026-09-13.md (uses the pre-rename gift card name, makes the gift-card naming guard fail locally) and docs/audit/morning/. Commit the audit doc renamed-clean or delete it; keep morning/ gitignored.
- [ ] ~20 finished .claude/worktrees/agent-* worktrees and their local branches: remove one at a time after confirming each is merged or pushed (never a bulk loop).
- [x] Superseded 2026-09-14: origin wip/* triage folded into the GitHub cleanup below (11 wip/* kept, listed there).
- [x] DONE 34ffd973d (pre-push warns at 70% of ~100/day; reads 96 tonight). Was: Vercel deploy budget: add a check that warns before a push when today's production deploy count is near the free-tier limit, so a rate limit is never a surprise again.
- [ ] OWNER: STRIPE_TEST_SECRET_KEY repo secret; reconnect Supabase, Slack, Canva connectors (unauthorized in sessions tonight).
- [ ] Git history rewrite (322 MB dead media) — only after every agent/terminal is stopped; see disk-cleanup handoff.
### Owner-approved 2026-09-14 (queued; max 3 agents, one prod job at a time)
- [x] DONE 2026-09-14: GitHub cleanup. Artifacts: 845 (11.82 GB listed) → 661 (11.09 GB); 184 older than 14 days deleted, all 7 db-backup-* kept; repo default artifact+log retention 90 → 14 days (db-backup.yml keeps its own retention-days: 90). Caches: 53 (10.86 GB), none last accessed 7+ days ago (oldest 2026-09-13; the 10 GB cap evicts first), so 0 deleted. Remote branches: 203 → 21; 182 deleted (88 with no unique commits per git cherry, 7 duplicate archive/worktree-agent-* refs, 87 superseded), every tip sha in `docs/audit/deleted-remote-branches-2026-09-14.log`. Open-PR heads untouched (5 dependabot + e2e/playwright-fixes-sept-2026).
- [ ] 14 remote branches KEPT with unique unshipped work (resolve each: land, fold into a lane, or record why abandoned, then delete): `feat/apple-iap` (StoreKit 2 IAP; booby-trapped, reference for the rebuild only), `perf/bundle-sentry-lazy` (Sentry off the ForgotPassword critical path; PR #1581 closed to redo), `polish/data-display-plurals-labels-formatters` (plural bug, admin status label maps, dispute money formatter; PR #1578 closed to redo), `wip/messaging-lockout-2026-08-30` (24h post-completion lockout + migration not on main), `wip/job-confirmation-2026-08-30` (JobConfirmation/JobTracking/ConfirmedSection edits), `wip/race2-terminal` (settle-dispute/complete row-lock migration + race probe; main only has the apply/confirm lock), `wip/unplus-tier-removal-20260829` (remove Plus tier; Plus is still on main, decision unclear), `wip/postjob-doubletap-driver` (prod-audit interruptions spec driver), `wip/a3098e1a3d88bb205` (notification delivery audit scaffold), `wip/a52d1fb23f25cb495` (usability scorecard spec), `wip/a69d0af0b250db810` (slow-device spec), `wip/ab081703e8d015858` (first-time-user walk harness), `wip/abf395f466bcf1adf` (interruption journeys: deep links, apply), `wip/ac0f5d2ac0f5004a5` (assistive keyboard spec).
- [ ] RUNNING: integrations + secrets audit (Slack apps/webhooks, Sentry, Supabase, Vercel, GitHub, Stripe test, Resend/PostHog/MapKit/etc.) — report only
- [ ] Alerts to one Slack channel: prod down, deploy failed, nightly-red opened, Stripe webhook failures, DB near free-tier limits — PARTLY DONE 2026-09-14 (severity policy, deploy-failed, scheduler-down, digest: see "Alerting" at the top); nightly-red and DB-limit posts belong to the monitoring terminal
- [x] Uptime check DONE (.github/workflows/uptime.yml + scripts/uptime-check.mjs). Every 10 min: one GET of www.louisianahelpr.com AND one anonymous `open_jobs_browse?select=id&limit=1` read (the CDN serves index.html straight through a DB outage, so a site-only ping would have read green for all of 2026-09-13). Down only after TWO consecutive failed rounds 30s apart, then opens/updates `prod-down: uptime` via .github/actions/nightly-issue-sync (now takes a `label`) and closes it on recovery. Own concurrency group `uptime`, exempt BY NAME with a reason in src/test/prodWorkflowSpacing.test.ts (~6 anonymous single-row reads an hour, less than one page view); exemption proven able to fail. Failure path proven locally against a bad host, happy path against prod (200 in 147ms / 238ms).
- [x] DONE, owner approved by pop-up 2026-09-14: repo secret `SUPABASE_SERVICE_ROLE_KEY` added. CI run 34882789104 now reads real numbers — database 73.4 MB / 500 MB (14.7%), /data 369.9 MB / 1.98 GB (18.7%), CPU load 0.06, disk IO in flight 0, provisioned IO baseline 87 MB/s. NOTE the tradeoff the owner accepted: every GitHub Actions workflow in this repo can now read and write prod bypassing RLS. Bucket storage is still unmeasured — neither source carries it.
- [ ] OWNER (chose to add it, 2026-09-14 pop-up): create a Slack Incoming Webhook and add it as repo secret `SLACK_WEBHOOK_URL`. Both alerts then post with no code change — this also closes the "Alerts to one Slack channel" line above for the prod-down and free-tier-limit halves. Until then an outage or usage warning still opens its issue, and the notify step FAILS LOUDLY with the instruction rather than skipping silently.
- [x] Supabase usage alert DONE (.github/workflows/supabase-usage.yml + scripts/supabase-usage-check.mjs), Sat 01:17 UTC. Management API (SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF), never SQL — the control plane answers without touching the nano instance. Warns at 70% of 500 MB DB / 1 GB storage by opening `supabase-usage`. MEASURED (run 34881959722): the Management API 404s on EVERY usage route (`/usage`, `/database/usage`, `/billing/usage`, org `/usage`) — it exposes project identity and health only. The script still probes them weekly and prints what each said, so the finding is re-tested not believed. The numbers come from the project's own Prometheus endpoint (`/customer/v1/privileged/metrics`, basic auth `service_role:<key>`) — one scrape a week, still not SQL. Proven against prod: database 73.4 MB / 500 MB (14.7%), /data volume 369.9 MB / 1.98 GB (18.7%), disk IO and CPU both read; warn path fires when the threshold is lowered under those readings. Bucket storage is the one metric NEITHER source carries (no `storage_*` family in a 1494-line scrape).
- [x] Sentry release tagging DONE. Release name is now `resolveSentryRelease()` (src/lib/sentryRelease.ts), fed by VITE_SENTRY_RELEASE then `__APP_COMMIT_FULL__` — the commit SHA in BOTH shipping builds (web: VERCEL_GIT_COMMIT_SHA; iOS `npm run build:ios`: `git rev-parse HEAD`). The version-shaped "1.0.0" tail is GONE: an unidentified build now reports `unidentified-build`, because a plausible-looking release is how OBS-005 hid for months. Source-map upload already runs in CI (sentry-release.yml, SENTRY_AUTH_TOKEN/ORG/PROJECT all present as repo secrets); nothing added to Vercel. src/test/sentryRelease.test.ts holds the whole chain and was RED on the pre-change sentry.ts.
- [ ] Supabase storage audit: orphaned files in the 10 buckets (after the release proof; light prod reads only)
- [x] Owner 2026-09-14 speed-ups: (1) non-prod work runs in parallel with the single prod job (full rename after types refresh lands; Slack alerts after the integrations audit); (2) prod proofs kept small — 375 only, fewest rounds that prove the point (10 not 20 unless money). SKIPPED by owner: prod rewrite of the mocked dashboard dark-mode check.
- [x] Sentry: deleted the 3 dead/duplicate alert rules (3390582 Stripe webhook signature mismatch, 3413443 edge function 5xx burst, 3413453 chat push trigger catch-all) via the dashboard; 10 → 7 rules (2026-09-14).
- [ ] Hallie avatar re-upload path: prove on prod (owner asked) — upload to a scratch path or temporarily move the real object aside, run prod-seed --avatar, confirm re-upload + profile pointer, restore. Next prod slot.
- [ ] Signed-in press-every-control full run on prod (owner: run just before the final re-check) — one run, after the paused suites are re-enabled and prod has been healthy.
- [ ] Supabase Pro: owner will decide later (not before launch prep).
- [x] Voice note client cap lowered 10 MB → 5 MB to match the message-attachments bucket limit; guard src/lib/voiceNoteLimitMatchesBucket.test.ts (red at 10 MB).
- [x] is_party_to_job(_job_id, _user_id) is callable by any signed-in user with an arbitrary user id. LANDED 102293bb1 (db-deploy run 34899094042 green, 20260914210443 on both sides): migration 20260914210443 adds caller-bound `can_send_message_to_in_job(job, receiver)` and the messages INSERT policy calls it; is_party_to_job loses PUBLIC/anon/authenticated EXECUTE (service_role only). Wrapper = caller may post in the job (can_message_in_job) AND not banned AND NOT are_users_blocked(caller, receiver) (same function as trg_enforce_block_on_message_insert) AND caller's messages in the last hour < 30 (same source/window/cap as enforce_message_rate) AND receiver is the poster (anyone who may post), OR Helpr/offered/roster when the caller is itself poster/Helpr/offered/roster, OR an applicant only when the caller is the poster. OWNER DECISION 2026-09-14 (applied): only the poster may message applicants; the hired Helpr, roster and messaged applicants are refused, and a messaged applicant reaches only the poster (lh-authz-rls review: otherwise a one-way thread to the Helpr/roster discloses the applicant). Live inventory: its ONLY dependent is that policy; the 4 proof-photos storage policies call `is_party_to_job_folder(text)` (untouched). PGlite: `node scripts/probes/party-to-job.probe.mjs` (69 expectations, 3x replay, 16 broken copies all caught, skip path no-op). Residual: RPC calls insert no row, so calls themselves are not rate-counted (answers limited to what one INSERT per receiver reveals). Closes the review's design gap (any party could message/identify applicants) and the accepted block/rate residuals. PROD PROOF 2026-09-14 (is_seed job 868f182b, Perry poster / Hallie hired / Eli seeded applicant / Weblane non-party): proacl is_party_to_job {postgres, service_role}; wrapper SECURITY DEFINER search_path=public, authenticated only; policy calls can_send_message_to_in_job(job_id, receiver_id); pg_depend: is_party_to_job 0 dependents, wrapper has the one policy; direct is_party_to_job RPC 403 42501; wrapper false for non-party and Helpr->applicant, true for poster->applicant; sends poster->Helpr 201, Helpr->poster 201, non-party->poster 403, hired Helpr->applicant 403, poster->applicant 201, applicant reply->poster 201, messaged applicant->Helpr 403; is_party_to_job_folder Helpr/poster true, non-party false (4 proof-photos policies unchanged); idx_messages_sender_created backs the rate count. Cleanup read back 0 (4 messages, 4 notifications, 1 application). write-contract snapshot refreshed (7a2e92217): 0 rejects.
- [x] OWNER DECISION 2026-09-14 (applied): an offered-but-not-accepted Helpr (jobs.offered_to_helper_id) is reachable by the POSTER ONLY, like applicants, and reaches only the poster. LANDED aa1f41922 (db-deploy run 34916403323 green, 20260914215014 on both sides): can_send_message_to_in_job recreated from its live pg_get_functiondef; offered moved out of the hired-Helpr/roster receiver branch and its caller gate into the poster-only branch; offered-and-hired / offered-and-roster keep hired/roster reachability; the column is honoured whatever direct_offer_status says (a declined offeree stays poster-only). PGlite probe `node scripts/probes/party-to-job.probe.mjs`: 87 expectations, 3x replay, BETWEEN stage reproduces the offered hole on 20260914210443 alone, 21 broken copies caught, skip path no-op. lh-authz-rls REVIEW ONLY: SHIP WITH NITS (nits applied). LIVE: proacl {postgres, authenticated, service_role}, SECURITY DEFINER, search_path=public, policy still calls can_send_message_to_in_job(job_id, receiver_id), function body has the new branches. PROD PROOF (is_seed job 868f182b, poster-e2e poster / helper-e2e hired / Eli offered via triggers-off UPDATE): poster->offered 201, hired Helpr->offered 403 42501, offered->poster 201, offered->hired 403; wrapper hired->offered false, poster->offered true. Cleanup read back 0 (3 messages, 2 notifications, 2 user_violations, 2 fraud_flags, offer restored to NULL/NULL); write-contract snapshot unchanged (0 rejects).
- [x] UI follow-up: a non-poster's existing thread with an applicant or an offered Helpr is read-only. LANDED f8435e919: src/lib/recipientGate.ts asks can_send_message_to_in_job for the open thread plus a control call for the poster (restricted = receiver false AND poster true, so banned/replaced/closed/rate-capped callers and the poster are never blamed); ChatComposer shows the lockout-style notice; an RLS-policy refusal marks the bubble `refused` and flips the open thread. Vitest red first (5 failed), 15/15. PROD: 375x812 screenshot of helper-e2e's thread with Eli shows the notice, no textbox, no overflow (test-results/offered-proof/recipient-restricted-375.png, review recorded ok).
- [ ] OWNER QUESTION (lh-authz-rls review 2026-09-14, pre-existing, outside the send gate): a hired Helpr or roster member can still READ jobs.offered_to_helper_id (policy "Selected helpers can view their job", get_jobs_for_my_applications() returning SETOF jobs, src/pages/messages/messagesData/loadConversations.ts selecting the column), and a declined/expired offer never clears the column (20260904031002), so a Helpr hired after a declined offer can see who was offered first. Live 2026-09-14: 0 jobs with a pending offer beside a different hired/roster Helpr. Should the column be hidden from non-posters (view/column grant) or cleared on decline/expiry?
- [x] FIXED 2026-09-15 with queue #1 below (both halves confirmed live first: contact_leak_reason('SEED offered-proof 20260914215014') = 'Phone number detected' on prod; the saved row is flagged_hidden, hidden from the receiver only by the SELECT policy, and the ladder copy said "blocked"). Was: VERIFY (found during the offered-Helpr prod proof 2026-09-14): a message whose content was "SEED offered-proof 20260914215014" was read as a phone number by the server contact scanner and issued a real off_platform warning (user_violations + fraud_flags + "That message was blocked" notification) to poster-e2e and Eli, yet the INSERT returned 201 and the row existed. Two things to check live: (1) a 14-digit number (order/reference id) counts as a phone number; (2) the copy says "blocked" while the row is kept (check flagged_hidden on such rows). Test rows were removed.
- [ ] BUILT, APPLY + SCREENSHOT PENDING (2026-09-14): prod still has 0 group jobs, so group-job screens (GroupJobHelpers flat card, 70f93a220) are proven only on a local render. `scripts/audit/prod-seed.mjs` now has a `--group-job` flag (idempotent, also folded into `--apply`) that inserts one is_seed group job (status='open', 2 of 3 roster slots filled — accept_group_application only flips a job to 'accepted' on the LAST slot, so 'open' is the realistic state; the roster rows themselves carry status='accepted', the table's own default) owned by the shared poster, staffed by the shared helper-e2e account + applicant01, payment_status='unpaid' (deliberately, NOT 'escrow' — this script's own header says --apply never writes a money column, and seed_jobs_hidden_publicly() currently reads FALSE so an escrow is_seed job would be a live public-Browse listing; the poster's own /my-posts, the only surface this fixture needs, reads jobs unfiltered by payment_status). `e2e/a11y-prod/a11y-prod.spec.ts` resolves the poster's is_seed group job at run time (same pattern as jobByStatus) and sweeps `/my-posts?highlight=<id>` as `group-job-poster-card`, skipping visibly if the row doesn't exist yet. `src/test/prodSeedGroupJobFixture.test.ts` grades the payload against the live schema via schemaConstraints.ts (fixtureSchemaContract can't see it — scripts/ is outside its e2e/+src/test walk of fixture files, though the new file lives in src/test/ itself as the checker, not the checked); shown red first (budget bumped to 6000, a real jobs_budget_range violation) then green again. Apply: `node scripts/audit/prod-seed.mjs --group-job` (needs .env with SUPABASE_SERVICE_ROLE_KEY; run --apply first if applicant01 doesn't exist yet). Verify: `node scripts/audit/prod-seed.mjs --verify` (checks "group job (is_seed, is_group_job, 3 slots)" and "group job roster (2 of 3 slots, accepted)"). APPLIED + VERIFIED 2026-09-14 (see the APPLIED line below). STILL OPEN: screenshot the poster card at 375 light/dark on prod and log it with recordReview.
- [ ] QUEUED (next prod slot): land + prove branch completion-race (2608b2585): before numbers via scripts/probes/completion-race.prod.mjs 20 cancel|approve|block, land, verify objects, after numbers, re-enable race-runner.yml and run it red (exclude_migrations=20260914215112) then green. Owner decision 2026-09-14: no cancel during a revision request (Done mark stays set).
- [x] LEDGER CHECKED 2026-09-14 (read-only, 4 REST reads): the old-race job is the ONLY cancelled prod job with helper_completed_at: `d292622a-24cd-4621-a40f-8762279a1880`, is_seed=true, "[E2E DO NOT ACCEPT] automated lifecycle" (prod-lifecycle harness). Job: budget 25, customer_fee_amount 3, payment_status=cancelled, cancelled_by = poster, accepted 20:16:19.99, helper_completed_at 20:16:20.51, cancelled_at 20:18:44.60 (2026-09-07). payment_refunds: ONE row, re_3UD8xdKp2H4b7tEC0PMSE4kg on pi_3UD8xdKp2H4b7tEC0JOJVy11, 2500 cents, is_partial, source cancel_escrow, created 20:18:44.50 (before the flip, as create-payment's cancel_escrow orders it). payout_transfers: 0 rows. tips: 0 rows. Expected by cancel_escrow's rule: capture 2800 − max(service fee 300, Stripe fee ≈111) = 2500 refunded, nothing transferred. VERDICT on the ledger: refunded correctly, not double-moved; no ledger row to correct, nothing written. The stale helper_completed_at on a cancelled seed job is a job-row artefact of the old race, not a money row; left as is.
  - [x] STRIPE SIDE CONFIRMED 2026-09-15 (read-only GETs, STRIPE_TEST_SECRET_KEY from env, balance check confirmed livemode=false first). transfer_group/transfer_data were never set on this PI (both null), so the earlier plan to filter by `transfer_group=job_d292622a-…` returned nothing — found instead via `payment_intents/search` on `metadata['job_id']`, then read the charge, its refunds, and cross-checked against all 63 test-mode transfers for this account (metadata scan, none match this job). PaymentIntent `pi_3UD8xdKp2H4b7tEC0JOJVy11`: amount 2800, amount_received 2800, status succeeded. Charge `ch_3UD8xdKp2H4b7tEC023QwxJi`: amount 2800, amount_captured 2800, amount_refunded 2500, refunded=false (partial, matches ledger's is_partial), disputed=false, transfer_data=null. Refund `re_3UD8xdKp2H4b7tEC0PMSE4kg`: amount 2500, status succeeded — same refund id the ledger already had, so this isn't just consistent, it's the identical row. Transfers: 0 found with this job_id in metadata, matching payout_transfers: 0 rows. VERDICT: CORRECT. Poster got back exactly the ledger's 2500 cents ($25.00); Louisiana Helpr kept the 300-cent non-refundable service fee; no transfer to the Helpr was ever created for this job so none needed reversing; only one PI/charge exists for the job so nothing was charged twice. Zero cents of discrepancy.
- [x] APPLIED 2026-09-14: `node scripts/audit/prod-seed.mjs --group-job` → job `def709bf-fe82-506d-944d-4f48a8cfa83f` (is_seed, open, unpaid, 3 slots), roster helper-e2e `437de07d-…` + applicant01 `c2976d11-…`. `--verify`: "group job (is_seed, is_group_job, 3 slots)" 1/1 yes, "group job roster (2 of 3 slots, accepted)" 2/2 yes, "seed-script jobs visible to anon browse" 0/0 yes; overall 51/56, the 5 NO rows pre-existing and unrelated (payment failed / chargeback / cancelling states, 1 seed dispute stuck mid-execution, helper avatar file HEAD 400).
  - [ ] STILL OPEN (owner said finish up before this step): screenshot the poster's group card on /my-posts?highlight=def709bf-fe82-506d-944d-4f48a8cfa83f at 375 light + dark on a local vite preview against prod (getSession "poster" from e2e/journeys/fixtures.ts), confirm flat card (no box in box, no overflow), record with npm run review:record.
- [x] DONE 2026-09-14 in the lifecycle-writes audit commit (edge only, outside dispute-races' create-payment hunks): `resolve_revision` is a conditional flip (`status = revision_requested AND revision_completed_at IS NULL`); a duplicate call re-reads and returns `alreadyResolved` with no second notification. Class guard red on the pre-fix excerpt (`src/test/raceClassGuard.test.ts`). Prod double-tap proof still owed — see the lifecycle-writes OPEN line above.
- [ ] QUEUED (prod slot, one probe run each): race proofs for fa107a92f fixes — auto-release vs dispute open; auto-resolve vs escalate and vs withdraw; gift-card redeem vs card payment on one unpaid job; request_revision double-tap; resolve_revision vs dispute + double-tap; cancel_escrow vs dispute open + double-tap; charge.dispute.created vs payout settling. Before numbers from the pre-fix behaviour are not recoverable now (already deployed) — record after numbers and prove each probe can fail on a local build with the predicate removed.
- [x] Vercel paused 2026-09-14 (Hobby limits: Edge Requests 3.1M/1M, Deployment Storage 34 GB/10 GB). Owner upgraded to Pro.
- [ ] QUEUED — OWNER DECISION 2026-09-14: hide jobs.offered_to_helper_id from non-posters (only the poster and the offered Helpr may read it). Covers the jobs read policy/column exposure, the RPC and the Messages loader that surface it. Verify live callers first; PGlite + prod proof.
- [ ] BUILT + gate-clean on branch `offer-privacy` (this commit; force-pushed as ONE squashed commit on origin/main — `git rev-parse origin/offer-privacy` for the sha, which a commit cannot name inside itself). NOT LANDED, NOT PROBED ON PROD — lead: prod probe before/after, then land. OWNER DECISION 2026-09-15 (the FULL fix): `authenticated` loses the table-level SELECT on `public.jobs` and gets column grants for everything EXCEPT `offered_to_helper_id`, re-derived by `sync_jobs_select_grants()`; access is `get_job_offer_targets(uuid[])` (poster or offeree only); `get_jobs_for_my_applications()` and `open_jobs_browse` return NULL for the column unless the caller is the poster or the offered Helpr. Old installed app builds may error on Activity — owner accepted that. Migration 20260915045110 (rebased onto 20260915041247 and re-timestamped so it lands last); it redefines `open_jobs_browse` with CREATE OR REPLACE (never DROP+CREATE, which the default-privilege rule would use to re-grant writes) and RESTATES `REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT SELECT` — `REVOKE ALL`, not a named list, because MAINTAIN is what failed that deploy. PGlite `node scripts/probes/offer-privacy.probe.mjs`: 9/9 BEFORE leaks reproduce on the live shape, 59/59 expectations hold on each of 3 replays, 18 broken copies each caught, skip path a no-op. Class guard `src/test/offeredHelperPrivacy.test.ts` (13 tests): no client jobs read takes unnamed columns; every migration-derived read path that can RETURN the column is caller-scoped (inventory equality, so a new one fails until classified); JOB_READABLE_COLUMN_LIST == jobs columns minus the private one; a jobs ADD COLUMN at/after the fix must call `sync_jobs_select_grants()`. Shown RED first: 8/13 on a worktree of origin/main (both (a) and (b) groups, 11 `select("*")` sites, 11 select-less `return=representation` sites, 2 loader selects of the column, the whole (b) group); (c) and (d) cannot fail on the pre-fix tree — their subject IS the fix — so each was shown red by mutation (a column removed from the list; a synthetic migration adding a jobs column with no sync call).
  - [ ] MIGRATION DRIFT found while deriving that list, not fixed here: `jobs.boost_auto_extended` exists in prod (and in the generated types) but NO migration creates it — it was added out of band. Pinned by name in `KNOWN_UNMIGRATED_COLUMNS` in the class test so a SECOND undocumented column fails instead of hiding behind it. Fix = write the `ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS boost_auto_extended …` migration that matches prod.
  - [ ] REPORT, not fixed here (CLAUDE.md: dead code is a report): `npm run deadcode` (knip) is RED on origin/main itself — `Unused files (1) src/components/HelperAvailabilityDisplay.tsx`, and `files` is the one rule set to "error" in knip.json, so it is what exits 1. Orphaned by main's own f35ec2d (the Post Job double-tap driver), not by this branch: knip's output on offer-privacy is byte-identical to origin/main's. Zero call sites in src/, e2e/ or scripts/. Someone owns deciding delete-vs-revive; until then the "Lint, type-check, build, test" job is red on every PR.
  - [ ] PRE-DECLARED, clears itself on deploy: `scripts/audit/write-contract.snapshot.json` carries `get_job_offer_targets` before prod has it, because the write contract checks the client's RPCs against a prod snapshot and the migration ships with its caller. If the migration is not landed before the next `write-contract-refresh` run, that workflow reports snapshot drift on this one function; landing it clears the report.
- [x] DONE 2026-09-14 (this commit): tests no longer load www.louisianahelpr.com. Real backend, LOCAL frontend: every frontend suite builds the commit and serves it with `vite preview` via the new `.github/actions/local-preview` (prod Supabase env, no Sentry/PostHog keys). Switched: e2e-journeys (2 jobs), e2e-abuse-notifications, prod-audit, a11y-webkit-prod (both engines), e2e-real-backend (anon-surface pages, authenticated, two-role, prod-lifecycle), mobile-viewports (was prod on EVERY push), lighthouse (canonical audit skipped locally), broken-links (lychee excludes the prod host), press-every-control (now the shared action). playwright.config.ts default baseURL = local HAPPY_PATH_BASE_URL (was prod, plus a VERCEL_URL branch); five chromium specs' own prod fallbacks → `e2e/localBase.ts`; audit-capture, probe-state-matrix, anon-surface-contract, a11y-focus-repro, complete-profile-icon-clip default to 127.0.0.1:4173; `test:journeys` sets PLAYWRIGHT_WEB_SERVER=1. Guard `src/test/noTestTrafficOnVercel.test.ts` (workflows, imported Playwright config, e2e/ + scripts/ sources) shown RED first on the unmodified tree (53 workflow + 11 source + 6 project violations), green after. Exempt by name: uptime.yml, prod-freshness.yml, scripts/uptime-check.mjs, generate-sitemap.mjs (text only), asc/fix-review-issues.mjs (metadata only), happy-path/zz-runtime-probe.spec.ts (3 AASA GETs/run; headers are Vercel's).
- [ ] VERIFY after this push: first nightly of each switched workflow is green on the local build (journeys, journeys-webkit, prod-audit, a11y-webkit-prod, e2e-real-backend scheduled legs, lighthouse Sunday — its thresholds were measured on prod, the first local run is the new baseline). mobile-viewports + anon-surface run on this push itself.
- [ ] RESIDUAL (not test-controlled): a paid journey leg still lands ONE page load on prod — Stripe's success_url is the server's getAppUrl(). Candidate fix: context.route 302 of the prod host to the local base in e2e/journeys/fixtures.ts + prod-lifecycle.spec.ts, but it must be proven in WebKit first (not done: no WebKit locally, 8 GB Mac).
- [ ] BUILT on branch vercel-usage-alert; VERCEL_TOKEN secret added 2026-09-15; lead lands + dispatches to verify — supabase-usage.yml gained a "Vercel usage headroom" step (scripts/check-vercel-usage.mjs; pure logic + the metric table in scripts/lib/vercelUsage.mjs) reading `GET https://api.vercel.com/v1/billing/charges?from=<7d ago>&to=<now>&teamId=team_UQHppAVoPIPQbyh2b43y21BG` (FOCUS v1.3 JSONL: ServiceName + ConsumedQuantity) and paging #ops-alerts through the existing SLACK_WEBHOOK_URL "Tell Slack" pattern at >=80% of the Pro plan's PUBLISHED included amounts. Checked against vercel.com/docs 2026-09-14/15: Pro moved to credit-based billing, so only Edge Requests (1,000,000/month) and Fast Data Transfer (1 TB/month) — Flat Rate CDN's free Pro tier, https://vercel.com/docs/pricing/flat-rate-cdn#flat-rate-cdn-tiers — have a published fixed quota. Function Invocations, Build Minutes and Deployment Storage have NO published Pro quota (billed from the shared $20/month credit from unit one — see the per-metric source-URL comments in scripts/lib/vercelUsage.mjs); those three are measured and logged every run but can never page, since there is nothing to be 80% of. No VERCEL_TOKEN logs one skip line and stays green; a 401/5xx fails the step loudly without paging Slack (warn output is left unset on that path). `src/test/checkVercelUsage.test.ts` (16 cases, shown red before scripts/lib/vercelUsage.mjs existed, all green after) covers the JSONL parsing, the threshold maths, the no-token skip, a 401/500/network failure, and an unmatched ServiceName being ignored + logged rather than erroring. prodWorkflowSpacing, slackAlertWorkflows and the other workflow guards stay green; no new cron, same prod-load slot.
- [ ] OWNER: set Deployment Retention to shortest (Vercel → Project → Settings → Security/Deployment Retention); 34 GB of deployment storage is deploy history, not test traffic.
### QUEUE ORDER (owner 2026-09-14: easiest → hardest; max 3 agents, one prod job at a time)
Running: dispute-races close-HIGH→land→prove; charge.dispute.created hold-overwrite HIGH.
1. [x] Contact scanner: 14-digit number read as a phone → false off-platform warning + "blocked" notice on a saved message. DONE 2026-09-15 (migration 20260915020258). Phone rule is ONE string, `PHONE_PATTERN` in src/lib/contactLeakRules.ts, used by the client scanner and carried verbatim by contact_leak_reason (messages, applications, job posts, bios): 10 digits or 11 starting with 1, 0-4 separators, no digit directly before/after (no lookbehind: iOS 15 WebKit), OR a 3-3-4 with real separators in both gaps where a glued digit does not hide it ("0225 555 0199"). Strict subset of the old rule, so nothing newly flagged or rejected; prod PG 17.6 regex engine agrees on every probe string. Copy: ladder body moved to internal `message_violation_ladder(..., p_message_saved)` (service_role only); the client RPC (send refused, nothing saved) keeps "blocked", the scan trigger (row saved + hidden) says "hidden from the other person", rungs/dedupe/review unchanged; admin "blocked messages on file" wording left as is at the time (renamed to "flagged messages on file" 2026-09-15, see the RESIDUAL below). lh-trust-safety REVIEW ONLY: SHIP WITH NITS, all applied in the same commit: (a) glued-digit evasion closed (above); (b) apply_message_violation_consequence strikes only when contact_leak_reason flags the same text, else `{"action":"not_flagged"}` (stale native builds still refusing the timestamp, and client-only "my number"/"my email", no longer earn strikes); (c) scan_message_content clears flagged_hidden/flag_reason on a clean scan (as scan_application_contact_info), so editing a hidden message clean un-hides it and no second strike fires; (d) RichMessageInput location shares round to toFixed(6) (old rule flagged 200000/200000 random Louisiana shares, new rule raw 67, rounded 0); (e) parity-test migration finders accept any case, CREATE FUNCTION, $$ bodies. GUARDS: contactFilterParity.test.ts (newest migration's literal === PHONE_PATTERN, portable-syntax check, src/lib/contactLeakPhoneFixtures.json through client + server rule, location shares rounded + a ~90k Louisiana grid never flagged), messageScanner.test.ts (the named cases), reliabilityLadder.parity.test.ts (saved copy never says blocked; each path passes the right flag). Red first: 9 failures on the old rules, then 4 on the glued-digit fixtures; PGlite 8 failures on the first migration draft for (a)(b)(c); vitest mutations each red (4 migration mutations, unrounded share, later lowercase CREATE FUNCTION for both finders). PGlite `node scripts/probes/contact-scan-phone.probe.mjs`: BEFORE repro on the live shape, 3x apply, 35 fixtures in real Postgres, full ladder, edit-clean + edit-dirty + dedupe + RPC (flagged, not flagged, no user) paths, ACLs, 12 broken copies caught, ALL PASS. Prod read-only before: contact_leak_reason('SEED offered-proof 20260914215014') = 'Phone number detected'; 0 hidden messages and 0 violations the new rule would clear; 1 phone-flagged application stays flagged.
   - [x] RESIDUAL DONE 2026-09-15: sendHandlers.ts's immediate, synchronous toast is now neutral ("Remove contact details (phone number, email, payment app, etc.) to send this message.") for every client-side match, regardless of whether the server will actually flag it. Strike/warning wording moved into logViolation.ts, gated on the RPC's own verdict: `action === "warning"` → the "This is your first warning…" toast (previously shown before the RPC was even called); `final_warning` / `pending_ban_review` unchanged; `not_flagged` / `duplicate` → no strike toast at all. So a client-only phrase ("my number", "my email") gets the neutral notice and nothing else — never a claimed strike the server didn't record. Vitest red first (`src/pages/messages/messagesData/sendHandlers.test.ts`, new file: 3 cases failed against the pre-fix code, confirmed by a temporary revert, then passed after); `reliabilityLadder.parity.test.ts` updated to assert the first-warning toast lives in logViolation.ts gated on the RPC's `warning` action, and that sendHandlers.ts's immediate notice never says "this is your first warning".
   - [ ] RESIDUAL: installed iOS/Android builds bundle the old client regex, so they still refuse to send a message containing a 12+ digit run (no strike now, server-side). Closes when the next native build ships — see the native-build note at the end of this queue-#1 entry, which now also covers the location-share and neutral-toast fixes below.
   - [x] RESIDUAL DONE 2026-09-15 (migration 20260915030812_contact_leak_reason_exempts_location_shares.sql): contact_leak_reason now exempts the exact app-generated shape "📍 Location: lat,lng" (anchored to the whole message) before any other rule can fire — a 3-digit-integer longitude (west of -100, e.g. "-118.243700") no longer coincidentally lines up with the 3-3-4 phone shape. RichMessageInput.tsx now sends bare "lat,lng" (never a URL — that was never the cause, but dropping it removes any other digit-adjacency risk and lets MessageBubble.tsx build the maps.google.com link itself from two regex-validated numbers instead of trusting one out of message content, which is also a small XSS hardening). One shared pattern, `LOCATION_SHARE_PATTERN` (src/lib/contactLeakRules.ts), used by contact_leak_reason (server) and scanMessage (client, belt-and-suspenders alongside the existing `isLocationShare` skip) — src/lib/contactFilterParity.test.ts fails if they drift, same discipline as PHONE_PATTERN. PGlite (ad hoc, 3x replay against a prod-shaped schema): BEFORE repro confirmed (a California share, -118.2437, DID read as a phone; a Louisiana share did not), migration applied verbatim 3x, AFTER: California + a second 3-digit-longitude share + two Louisiana shares all clean, a real phone number and a real email still flagged, the original 14-digit-timestamp repro stays clean, text that merely *mentions* the location prefix mid-sentence stays flagged (anchoring works), and the full `apply_message_violation_consequence` RPC path returns `not_flagged` for the California share. Vitest: contactFilterParity.test.ts extended with an explicit -118.2437 case, a Louisiana case, the existing Louisiana grid (unchanged, still 0 flagged), and a new continental-US grid (>1500 points spanning the -100° line) — 0 flagged on either side.
   - [x] RESIDUAL DONE 2026-09-15 (bonus, not separately requested but logged alongside): the admin "Ban review needed" notice and the AdminBanReview badge/copy said "blocked messages on file", which counts BOTH messages the scanner refused to send (nothing saved) and messages that were saved-and-hidden — an admin reading "blocked" and looking for refused sends would miss the hidden ones. Renamed to "flagged messages" consistently in both places: SQL (migration 20260915030321_contact_scanner_flagged_messages_wording.sql, `message_violation_ladder`'s `p_admin_message_format`) and the client (`src/components/admin/AdminBanReview.tsx`'s `caseNoun` badge text and subtitle copy). `reliabilityLadder.parity.test.ts` updated to assert the new wording.
   - [ ] **Native build needed to pick up ALL of today's client-side scanner changes** (owner decides when to cut a new TestFlight/App Store build): the digit-boundary phone rule (queue #1 main fix), the neutral-toast wording (first residual above), and the location-share exemption/format change (third residual above) all touch `src/lib/messageScanner.ts`, `src/lib/contactLeakRules.ts`, `src/pages/messages/messagesData/sendHandlers.ts`, `src/pages/messages/logViolation.ts`, `src/components/RichMessageInput.tsx` and `src/components/messages/MessageBubble.tsx` — none of that ships to an already-installed native app until a new build is cut and released. The server-side halves (contact_leak_reason, message_violation_ladder) are already live on every client, native or web, the moment the migration deploys.
2. [x] Old cancelled prod job still carrying helper_completed_at: ledger refunded correctly (2500 of 2800, fee withheld, 0 transfers), seed job, nothing written (2026-09-14, detail above). OPEN: Stripe-side amount_refunded unconfirmed (no local test key; temp-function call blocked).
3. [~] Seeded group job APPLIED + --verify green (job def709bf-fe82-506d-944d-4f48a8cfa83f, 2/2 roster). OPEN: 375 light/dark screenshot of the poster card + review:record.
4. [~] Offer privacy: hide jobs.offered_to_helper_id from non-posters (poster + offered Helpr only). BUILT + gate-clean on branch `offer-privacy`; awaiting the lead's prod probe before/after and the land. See the OPEN line above.
5. [ ] VN-37 app-wide gutter: after the visual session lands vn-profile/vn-integrate and closes. Hoist the shared padding string (PageScaffold.tsx:178, AppPage.tsx:74, Profile.tsx:536/:608) to one constant; build 3 variants (px-5 / lg:px-6 xl:px-6 / lg:px-8 xl:px-8), 1440 side-by-side screenshots for the owner to pick; 375 locked at px-5 and proven byte-identical; full verify at 375/1440/1920 rail open/closed light/dark; guards profileTabScroll.test.ts + profile-tab-scroll-fill.spec.ts.
6. [ ] completion-race branch: prod before/after probes, land, race-runner red/green.
7. [ ] Race proofs on prod for the fa107a92f lifecycle-write fixes.
8. [ ] Vercel usage alert — BUILT on branch vercel-usage-alert, VERCEL_TOKEN added; lead lands + dispatches to verify (see the OPEN.md entry above).
9. [ ] Full customer/helper → poster/Helpr rename — alone, nothing else running.
10. [ ] Signed-in press-every-control full run on prod.
- [ ] LAST, after everything above: independent re-check by a different model (sonnet) of ALL work landed 2026-09-13 — full vitest once, CI green per push, re-run each fix's own proof on prod, list what doesn't hold
- [ ] OWNER: allow the Stripe connector write tool + reconnect Stripe, then add transfer.failed to live webhook and close #1462/#1521

## OWNER BATCH 2026-09-16 (verbatim intent; NOT yet started — needs browser before/after per screen)
Captured from owner while low on usage; execute with screenshots on prod (test accounts), one browser at a time, when usage/Opus allows. Group the layout ones into a /jobs + /my-posts pass and the Messages ones into a Messages pass.
1. Messages: open/scroll to the UNREAD messages on entry.
2. Seed TEST JOBS on Home, Post, and Jobs — populate ALL sections (every status bucket) so each renders with data.
3. /jobs + /my-posts: move the Helpr/Poster PersonTile box to UNDER the tracker and ABOVE the map. Name shows ONCE only.
4. Remove the name to the LEFT of "updated", and remove the "at the job" text.
5. QUESTION ANSWERED: maps are NOT all Apple — BrowseMap=Apple MapKit JS, TrackingMap=Leaflet. Owner likely wants tracker unified onto Apple MapKit (roadmap decision). → make it a task.
6. POSTER side: there is NO button to confirm arrived / confirm working / confirm offered. Add them. If already clicked, still SHOW the box but DISABLED (or show the NEXT box once ready to advance).
7. The "24 hours passed → gets deleted" state: should have been a "Work Done"-style button; since the helper never clicked it, show it DISABLED with the reason why (don't just delete silently).
8. Green PRIMARY buttons always on the RIGHT for /post and /jobs.
9. Button word SIZE + FONT must be CONSISTENT across these buttons (currently inconsistent).
10. Move "before & after pictures" to a BUTTON on the SAME ROW as the other action buttons.
11. Collapsed card: move "updated" to the LEFT of the time.
12. Remove "Awaiting confirmation" text under confirmation — user can click Arrived or toggle to see why it's yellow.
13. Tracker must NOT disappear during a DISPUTE or REVISION (keep it rendered).
14. Home, Post, Jobs, AND Messages panels must NOT be curved on the bottom — they should run to the bottom like the right panel does.
15. Messages should use the SAME layout as Home/Post/Jobs — it's currently the only one with that top panel.

## IN PROGRESS 2026-09-19 — owner batch 2026-09-16 execution + owner decisions
Recon done by three agents; five of items 3/4/11/12/13 all land in ONE file
(`src/components/JobTracking.tsx`), which is why they ship as one lane.

**Owner decisions taken 2026-09-19 (pop-up):**
- **Seed target:** the shared `is_seed` test pair, NOT the owner's real account.
  `scripts/audit/prod-seed.mjs --apply` now runs clean (see below); owner gets a
  sign-in link to look at the populated sections.
- **Tracker map (item 5):** unify `TrackingMap` onto Apple MapKit **now, in this
  pass**. It was the only non-Apple map left (Leaflet + raw OSM tiles);
  BrowseMap / AppleMapPreview / JobLocationPreview are all MapKit already.
- **Item 8 vs destructive-right:** **primary wins.** Green primary is right-most
  on /my-posts and /my-jobs everywhere; `OpenStep`'s Cancel moves LEFT, dropping
  the "furthest from the thumb" rule recorded at `OpenStep.tsx:12-13`.
- **Item 7 scope:** **both** readings, and fix the escrow bug (below).
- **Item 6 collapsed card:** confirm controls stay inside the EXPANDED card, but
  the collapsed card gains a visible "you owe a confirmation" signal. The
  collapsed card is the most likely reason the owner saw "no button" at all.
- **Item 11:** recon says the line already reads `Updated <h:mm>` — the word is
  already left of the time; the only thing left of "Updated" is the NAME, i.e.
  item 4a. Treated as satisfied by 4a, pending the lane's confirmation.

### NEW — CRITICAL (money): an in_progress job the Helpr never marks done is stuck forever
`auto-expire-jobs` §1 needs `status='accepted'`, §2 needs `status='open'`, and
`auto-release-payment` requires `poster_completed_at <= cutoff OR
helper_completed_at <= cutoff`. A job where the Helpr never taps "Mark Job
Complete" matches **no sweep at all**: it sits `in_progress` with **escrow held
indefinitely**. The poster gets no Approve (gated on `helper_completed_at`,
`InProgressStep.tsx:82`) and no explanation. Owner chose to fix it in this pass:
add the missing sweep + a CI check for the class, and render the disabled
"Work Done" affordance with the reason (item 7).

### NEW — HIGH (deadlock): bad-GPS arrival points each party at the other
Since VN-33 (`20260915044137`) `mark_helper_arrival` refuses a far / fix-less
arrival and **writes nothing**, so `helper_arrived_at` stays null. The Helpr's
tracker CTA is then blocked with copy naming the poster's "Confirm They Arrived"
tap as the way out (`JobTracking.tsx:2336-2342`) — but that poster control is
itself gated on `helper_arrived_at` (`InProgressStep.tsx:59-65`), so it never
renders. Each side is told to wait for the other. The arrival gate itself
(GPS **AND** poster confirm, `src/lib/arrivalGate.test.ts`) is deliberate
anti-fraud and is NOT being changed without an explicit owner decision; this
pass surfaces the honest reason on the poster's side. **Owner decision still
needed on whether the poster may vouch for arrival when GPS never resolved.**

### Item 2 (seed every section) — 52/56, was 50/56
`scripts/audit/prod-seed.mjs --apply` was crashing on
`POST favorite_helpers → 409 23505`: a real-flow row created 2026-09-17 took the
UNIQUE `(customer_id, helper_id)` that the seed's deterministic id wants, so an
`on_conflict=id` upsert violated the *other* constraint instead of merging.
FIXED by conflicting on the natural key (nothing FKs `favorite_helpers.id` —
checked live against `pg_constraint`), which also restores the script's
"teardown deletes exactly what apply created" invariant.
Remaining gaps, all honest and documented as un-fakeable:
`job status accepted` (real flow reaches it only after funding) and payment
`failed` / `chargeback` / `cancelling` (need a real Stripe refund / dispute /
failed transfer; faking the column would be read by money reconciliation).

### Item 5 follow-through (answered + actioned)
Maps were NOT all Apple: `BrowseMap` = Apple MapKit JS, `AppleMapPreview` =
MapKit, `JobLocationPreview` = MapKit, but `TrackingMap` = Leaflet +
`tile.openstreetmap.org`. Being ported this pass (owner decision above).

### REPORTS (not tasks — dead/no-op code noticed during recon, per CLAUDE.md)
- `ConversationList`'s `embedded` prop has **no production caller**
  (`Messages.tsx:399` passes false; only a test passes true). The desktop
  two-pane split it existed for was removed 2026-09-11. Its desktop branches are
  dead code.
- `JobActionRow.tsx:87-88` `JOB_ACTION_FULL_CLASS` is a **dead third button
  tier**: its only consumer is `DirectionsButton.tsx:82 variant="full"`, and both
  live call sites (`EnRouteStep.tsx:30`, `ConfirmedSection.tsx:144`) pass
  `variant="chip"`.
- `e2e/happy-path/activity-card-density.spec.ts:639-641`'s comment ("the row
  opens with its primary slot") is **stale** post-`2d4564a54`; the assertion still
  passes only because it filters the slot out.
- OPEN.md's "V7 IGNORED — another session owns the rounded panel-bottom" note is
  **stale**: no commit, branch or worktree touches `.page-panel`,
  `panelSurfaceStyle` or the index.css panel radii.

### DONE 2026-09-19 — Messages lane (items 14, 15, 1b) — commit `ea3ec524b` (local, unpushed)
- **Item 15** `ConversationList.tsx`: `titleCard`/`titleCardClassName` are now phone-only
  (`isWebDesktop ? undefined : headerEl`) and the header re-renders as the panel's first
  child under a hairline — mirroring `Activity.tsx:486-496`. Only `titleSrOnly` flipped to
  `isWebDesktop`; flipping the padding/hairline lines too would have doubled both.
  Phone rendering is byte-identical, which was the acceptance bar.
  CHECK `src/test/messagesNoSeparateTopPanel.test.tsx` — red-before observed.
- **Item 14** `src/index.css`: deleted the `html.web-desktop .page-panel` bottom
  radius/border override; `panelSurfaceStyle` now governs at every width. Comment
  records the reversal and points at `DesktopSidebarNav.tsx:255-264` as the reference.
  CHECK `src/test/pagePanelRunsToTheBottom.test.ts` — a **postcss source guard**, not a
  computed-style test: jsdom never loads index.css and would read the inline `0`, so a
  computed-style assertion could not fail. Walks every `.page-panel` rule for a non-zero
  bottom radius (logical props + shorthand 3rd/4th values) or bottom border, plus a
  second test proving the matcher is not vacuous. Red-before observed (3 rules listed).
- **Item 1(b)** `chatView/useChatScroll.ts`: one-shot per-conversation effect lands on the
  first unread `data-msg-id` instead of the bottom; zero-unread threads still land at the
  bottom. Ref-guarded so realtime inbound never re-yanks. `inboxDefault.ts` untouched
  (owner's 2026-08-30 "always All" decision stands — item 1 is a SCROLL ask).
  CHECK `chatView/useChatScroll.unreadLanding.test.tsx` — red-before observed.

### NEW — HIGH (app-wide list bug, found by the Messages lane): VirtualList virtualizes against the WINDOW inside overflow-hidden routes
`src/components/VirtualList.tsx:42` uses `useWindowVirtualizer` (`getScrollElement: () =>
window`, `observeElementOffset: (win) => win.scrollY`). But every AppShell/PageScaffold
route is deliberately off `DOCUMENT_SCROLL_ROUTES` and `src/index.css:1186-1195` pins
`html.app-shell{overflow:hidden}` + `html.app-shell body{overflow:hidden}`, so
`window.scrollY` never moves while the real scrolling happens in an inner container.
Only ~`innerHeight/estimateSize + overscan` rows (~16 on a phone at `estimateSize={80}`,
`overscan={6}`) are ever mounted — scrolling past them should show blank space.
Reachable TODAY: `CONVO_LIMIT = 50` in the inbox, and **Activity is in the same position**.
This is also what blocks owner item 1(a) (scroll the thread LIST to the first unread):
`scrollIntoView` cannot target a row that was never mounted; the correct mechanism is
`virtualizer.scrollToIndex()` against the real container.
Lane dispatched 2026-09-19 to prove it live on prod first (no mock mode), then fix via an
opt-in `scrollElementRef` on VirtualList, then land item 1(a). Needs a CLASS-level check.

### REPORTS added by the Messages lane (not tasks)
- `ConversationList.tsx:1182-1183`: the bulk-hide action bar is `fixed` at
  `calc(safe-area-bottom + 80px)` on the desktop website, reserving room for a bottom nav
  dock that does not exist at >=900px.
- `src/index.css:1422-1430` is an orphan comment describing an `.empty-state-dock` rule
  that was already removed.

### DONE 2026-09-19 — item 5: TrackingMap ported Leaflet → Apple MapKit JS — commit `43834d572` (local, unpushed)
Every map in the app is now Apple MapKit. New: `src/components/trackingMap/trackingMarkers.ts`,
`trackingRegion()`, `neutraliseMarkerFocus()`.
- **Degraded path is now a DESIGNED state, not an absence.** Leaflet shipped in the bundle;
  MapKit is a CDN script, so `missing-token` / `error` / constructor throw / a load that never
  settles (15s watchdog, same as `JobLocationPreview`) all render the same 180px frame with a
  `MapPinOff` panel — the tracker never reflows and never shows a blank grey hole. Critically the
  panel still prints the **settled arrival fact**: `trackingProofCaption` DROPS the arrival clause
  whenever the map is shown, so a silently-empty map would have taken that fact off screen entirely.
- **a11y:** pins are `role="img"` + `aria-label` + `tabIndex -1` (NOT `role="button"` — they do
  nothing when activated; the Leaflet version shipped focusable, `role="button"`, unnamed, which is
  the bug `src/test/mapMarkerAccessibleName.test.ts` exists for). Map container is `role="group"`.
- **OWNER DECISION 2026-09-19: the map stays STATIC** (`isZoomEnabled:false, isScrollEnabled:false`).
  MapKit has no separate wheel-zoom flag, so leaving zoom on would let a 180px map inside a
  scrolling job card eat the page scroll. Cost: no drag-pan/pinch. One-line revert if reversed.
- CSP already allows `cdn.apple-mapkit.com` / `*.apple-mapkit.com` in `index.html` + `vercel.json`.
- 12 mutation tests, each red-before-green (see agent report). TrackingMap 17/17,
  mapMarkerAccessibleName 8/8, alarmColourInvariant 8/8.
- **WebKit risks for the lead to verify in-browser:** `enabled:false` annotations may dim in some
  WKWebView builds; the absolutely-positioned arrival pill (`bottom: calc(100% + 3px)`) inside a
  MapKit-transformed subtree; a vertical swipe STARTING on the map must scroll the card; live
  `data-theme` toggle while the tracker is open.

### NEW — CLEANUP (Leaflet is now dead code)
Zero importers of `leaflet` / `react-leaflet` / `leaflet/*` anywhere in `src/ e2e/ scripts/
supabase/ index.html vite.config.ts vitest.config.ts` (grep exit=1, static AND dynamic).
`react-leaflet-cluster` already gone from package.json. STILL PRESENT and to be removed in the
lead's lockfile batch: `package.json:124 leaflet`, `:132 react-leaflet`, `:150 @types/leaflet`.
Also dead: `src/index.css` ~1678-1810 `.leaflet-container` / `.leaflet-control-zoom` /
`.leaflet-popup-*` / `.leaflet-control-attribution` — **careful deletion required**, the live
`.browse-map-*` rules are interleaved at 1697-1715. Stale comments naming Leaflet:
`JobTracking.tsx:26` and `:2162`, `PostedJobCard.tsx:518`.

### OWNER DECISION 2026-09-19 — stuck-escrow policy (item 7 backend)
**"Nudge both, then admin queue. Never move money automatically."** Escalating notifications to
both parties once the scheduled time is meaningfully past with no completion stamp; if still
untouched after a further window, flag into the admin queue for a HUMAN decision. Explicitly NOT
auto-release to the Helpr and NOT auto-refund the poster — nobody can prove from the data whether
the work happened. The flag must be a queue item AWAITING an admin, never a fabricated
`admin_audit_log` row (every such row names a real `admin_id`). Lane dispatched.

### DONE 2026-09-19 — JobTracking lane (items 3-poster, 4a, 4b, 8-partial, 11, 12, 13) — commit `9a39abbea`
- **Item 11 RESOLVED as a restatement of 4a.** The line was `{firstName · }Updated {h:mm}` —
  "Updated" was already left of the time; the NAME was what sat left of it. `grep -niE "updated"`
  over `src/**.tsx` finds exactly one visible label and nowhere does a time precede the word.
  Nothing was reordered.
- **Item 4b**: the at-the-job case now omits the `where` clause entirely, like the existing null
  branches → "Arrival GPS-verified" / "Arrival not confirmed" / "Location shared". Every consumer
  builds the separator FROM `where`, so no dangling `·` is possible. `N mi from job` untouched.
  LEFT ALONE (different string/surface, reported): the retry success toast `JobTracking.tsx:1015`
  "checked in at the job site", and the refusal copy at `arrivalGate.ts:150,152`.
- **Item 13 had TWO load-bearing halves** — fixing only `markedDone` would have measured as a
  no-op, because a submitted job's tracking row status is already `done`. Both fixed.
- **Item 3 (poster side)**: `JobTracking` gained a `personTile` slot rendered directly above the
  map; `PostedJobCard` builds the tile and passes it. `PostedJobCard.tsx:570`'s null-coords notice
  was judged NOT a second name print (it renders only when no map exists, and removing it would
  leave the poster with no explanation at all).

### OWNER DECISIONS 2026-09-19 (second batch) — collapsed-card behaviour
- **Item 3, helper side: the person box stays HIDDEN when collapsed.** V6 (owner-approved
  2026-09-15) deliberately put the poster tile behind the expand; moving the tile into the tracker
  would have reversed that, because the helper's tracker — unlike the poster's — renders on a
  collapsed card. The helper lane must gate the tile on `isExpanded` so both sides match.
- **Item 13, poster side: un-gate the tracker on COLLAPSED cards for contested jobs only**
  (`disputed` + `revision_requested`). `PostedJobCard.tsx:329` currently keeps the whole tracker
  behind the expand, so a collapsed disputed card shows no tracker at all — which is literally
  where the owner would have seen it "go away". Scoped to contested statuses so ordinary cards
  keep their current collapsed height.

### STILL OPEN from the 2026-09-16 batch
- Item 3 HELPER side — blocked on file ownership, needs `appliedJobCard/HelperTrackerPanel.tsx`
  + `ConfirmedSection` / `ActiveJobSection` / `DisputedSection`. The helper's tracker is NOT
  mounted by `AppliedJobCard.tsx`. `HelperTrackerPanel` already holds `app`+`job`
  (`job.customer_id`, `app.posterName`) so it can build the tile itself — one file changes.
- Item 7 UI (disabled "Work Done" with the reason) — waiting on the escrow lane's data contract.
- Item 10 (before/after photos → a chip on the action row) — needs the `PhotoProof.tsx:418-454`
  dialog extracted to an exported `PhotoProofDialog`, then a chip added to each step's `actions`
  array with the dialog in the `dialogs` slot. Adding a 4th chip to poster `completed` will trip
  `measureJobStepRow`'s icon-only compaction — expected, not a bug.
- **Pre-existing red on main, lead-owned:** `jobStepOneRow.test.tsx > Jobs · Confirmed` —
  "expected at least 4 controls, got [Directions | Message | I'm On My Way]". Reproduced on a
  pristine detached HEAD, so it predates this batch.
- Lockfile batch: remove `leaflet`, `react-leaflet`, `@types/leaflet`; delete the dead
  `.leaflet-*` CSS (careful — live `.browse-map-*` rules are interleaved); refresh the stale
  Leaflet comments at `JobTracking.tsx:26`, `:2162`, `PostedJobCard.tsx:518` and the stale
  "Awaiting confirmation" prose in `e2e/happy-path/state-matrix/stateMatrix.ts:481,516`.

### DONE 2026-09-19 — VirtualList scroll-source bug + item 1(a) — commit `028fe3837`
**The bug was REAL and worse than "blank space".** Proven live on PROD (no mocks) as `poster-e2e`
with 29 real threads, Chrome, at 375 and 1440:

| | mountedRows | idx range | container h | last row bottom |
|---|---|---|---|---|
| 375 top | 16 | 0-15 | 2320px | 1280px |
| 375 after scrolling 1758px | **16** | **0-15** | 2320px | **1280px** |
| 1440 top | 18 | 0-17 | 2320px | 1440px |
| 1440 after scrolling 1698px | **18** | **0-17** | 2320px | **1440px** |

Scrolling moved `scrollTop` 0 -> 1758 and changed NOTHING. 13 threads at 375 / 11 at 1440 were
unreachable by any gesture; `before-375-bottom.png` is a **completely white panel**.
AFTER: 375 -> rows 15-28, last row bottom **2336 == container 2336**; 1440 -> **2320 == 2320**.
All 29 reachable. 9 `recordReview` entries in `test-results/review-log.jsonl`, every screenshot
actually looked at.

FIX: `VirtualList` now dispatches on a stable prop to `WindowVirtualList` / `ElementVirtualList`
(unconditional hooks in each). Only TWO call sites exist in `src/`:
- `ConversationList.tsx:1081` (`/messages`, AppShell, html-locked) -> **element**, via
  `scrollElementRef={containerRef}` (`PullToRefreshWrapper`'s container is the only scroll surface).
- `AdminUsers.tsx:416` (`/admin`, IS in `DOCUMENT_SCROLL_ROUTES`) -> **window, unchanged** —
  flipping it would point the virtualizer at a non-scrolling element and render nothing.
(`VirtualizedJobList.tsx` is a separate, already-correct element virtualizer, not a call site.)

CLASS CHECK `src/test/virtualListScrollSource.test.ts` — **derived from the world, not a list**
(the failure mode memory `registries-checked-against-themselves` warns about): it parses App.tsx's
real `<Route>` table, resolves each page module, walks the import graph transitively to map files
-> reachable routes, and parses the app-shell classification out of `useAppShellViewport.ts`
(comments stripped, so a quoted non-member can't sneak in). A new call site on an html-locked
route fails the day it is written. Red-before observed.

**Item 1(a) SHIPPED**: the inbox lands on the first unread thread via
`virtualizer.scrollToIndex(idx, {align:"start"})`. One attempt per mount (ref guard consumed
either way), skipped when the first row is already unread, when nothing is unread, or when the
first unread sits past `CONVO_LIMIT`; realtime never re-fires it. Measured with the first unread
at UI index 7: entry `scrollTop` 0 -> **572** at both 375 and 1440, top row = the unread thread.
With unmodified prod data (newest thread IS the unread one) entry `scrollTop` stays **0** — the
skip works. The one `messages.read` flip used to stage this was on a test-owned row and was
RESTORED and verified. `src/lib/inboxDefault.ts` untouched (owner's 2026-08-30 "always All").

REPORT (inert, not changed): `AdminUsers.tsx:416` passes `className="space-y-2"` to VirtualList and
`ConversationList` wraps its VirtualList in `<div className="space-y-2">` — every row is
`position:absolute`, so `space-y` produces nothing on either.
NOT verified live: `/admin`, because `scripts/test-signin-link.mjs` only mints poster/helper.
Its code path is unchanged and is covered by the new guard.

### DONE 2026-09-19 — item 3 helper side + item 13 collapsed tracker — commit `187f61c3f`
- **Item 3 helper side**: `HelperTrackerPanel` now builds the poster's `<PersonTile>` ("Posted by")
  and passes it to `JobTracking`'s `personTile` slot (between the step rail and the map), mirroring
  `9a39abbea` on the poster side. No section file was edited: the expanded state reaches the panel
  through a new `CardExpandedContext` **exported from `HelperTrackerPanel.tsx` and provided by
  `AppliedJobCard.tsx`** — import direction card -> panel, which is already the transitive
  direction, so no cycle, and `ConfirmedSection`/`ActiveJobSection`/`DisputedSection` pass the
  provider through invisibly. Default `false`, so any other caller shows no tile.
- **TRAP AVOIDED (deviation from the literal spec, and the right call):** the old body tile at
  `AppliedJobCard.tsx:321-329` was NOT deleted — it became the **no-tracker fallback**
  (`bodyCarriesTile`), mirroring the poster side's `trackerCarriesTile`. `HelperTrackerPanel` only
  mounts under `isConfirmed || isActive || isDisputed`, so a flat delete would have removed the
  poster's profile from every pending / offered / completed / reviewed / cancelled Jobs card. The
  two branches are mutually exclusive: the name still prints exactly once, never while collapsed.
- **Item 13 remainder**: the poster's tracker is now un-gated on COLLAPSED cards for `disputed` and
  `revision_requested` only. The Helpr's PersonTile is gated on `isExpanded` **independently** of
  the tracker's own gate, so a collapsed contested card shows the tracker WITHOUT the person box —
  honouring V6 while still showing the dispute.
- Acceptance proven in both directions (14 + 4 green): collapsed+contested -> tracker, no tile;
  collapsed+ordinary (`accepted`/`in_progress`/`completed`/`open`) -> no tracker, height unchanged;
  expanded+contested -> tracker AND exactly one `/user/:id` link; helper collapsed -> zero poster
  links. Every assertion proven red first, including the over-wide un-gate (4 reds) and the
  tile-follows-tracker mistake.
- New: `AppliedJobCard.posterTile.test.tsx`, `PostedJobCard.contestedTracker.test.tsx`.

### DONE 2026-09-19 — item 7 backend: the stuck-escrow sweep gap — commit `d738344c1`
**The bug's own number (live prod):** `status='in_progress' AND helper_completed_at IS NULL AND
poster_completed_at IS NULL AND payment_status='escrow' AND date_needed < today(America/Chicago)`
-> **11 rows** (oldest `date_needed` 2026-09-09). **All 11 are `is_seed=true`; ZERO real users are
in the trap.** 11 of the 17 `in_progress`+`escrow` jobs were stuck.
The count stays 11 after the change **by design, not by miss**: the sweep is an edge function +
pg_cron row that only exist on prod after merge -> `db-deploy`, and it scopes to `is_seed=false`
(the same scope `arrival-confirm-reminder` and `money-reconciliation` use — escalating fixtures
would page a real admin about test data). The number that moved is the class check's:
**uncovered statuses `['in_progress']` -> `[]`**.

**Thresholds, measured from the job's scheduled end** (anchor =
`max(end of the job's local day, start_time + estimated_hours)`; every error errs LATE, because a
premature nudge accuses a Helpr who is still working). Each asserted against its source so it
cannot drift:
- **+2h** nudge both — `cancellationFeePercent`'s harshest tier is `hoursUntilJob < 2`;
  `arrivalNudge.SECOND_AFTER_HOURS = 2`. The app's finest "this is late" unit.
- **+24h** nudge both — `escrowTiming.AUTO_COMPLETE_HOURS = 24`, already the window this app gives
  a silent party.
- **+48h** escalate to the admin queue — `escrowTiming.TOTAL_TO_PAYOUT_HOURS = 48`, the instant
  funds WOULD have landed on the normal path. Owner's rule is that money never moves here, so at
  that same moment a person is asked instead.
Cron daily 14:00 UTC (9am CDT) — the anchor is the end of a calendar day, so a finer schedule only
buys the ability to push someone at 2am. Reuses `arrivalNudge`'s `NudgeLedger` vocabulary and claim
protocol but NOT `arrivalNudgeStage` (its stages measure from the first send; all three of these
measure from one anchor, so a missed run cannot compress the ladder).

**Migration** `20260919143637_stalled_completion_nudges.sql` (via `npm run migration:new`) adds
`public.job_completion_nudges` (stage ledger AND the queue: `escalated_at` set + `resolved_at` null
= awaiting a human), `admin_stalled_job_queue(boolean)`, `resolve_stalled_job_flag(uuid)`, the cron,
and the `cron_work_expectations` row. PGlite prod-shaped, verbatim, **3x replay all OK**. No PUBLIC
and no anon on the table or either function; both SECURITY DEFINER with `search_path=public`;
non-admin gets 0 queue rows and `not authorized` on resolve. No new `jobs` column -> no `types.ts`
regen, no `write-contract.snapshot.json` change. `git status package.json package-lock.json` clean.

**CLASS CHECK** `src/test/edge/escrowSweepCoverage.test.ts` — *"no job state may hold escrow with
no scheduled path out."* Three inventories derived from the world: statuses from
`Constants.public.Enums.job_status`; sweeps from the migrations' own `cron.schedule` bodies (both
URL shapes — 13 crons incl. `auto-expire-jobs` are only reachable via the
`format('/functions/v1/%s')` VALUES table; cross-checked against prod's 25 live `cron.job` rows);
predicates parsed from each sweep's AST and **EVALUATED** against a stranded job.
The evaluation is the point: a status-literal scan would have **passed on the original bug**,
because `auto-release-payment` does say `.in("status", ["in_progress", …])`. It only fails on the
conjunct (`NULL <= anything` is NULL), so the evaluator models that. Red-before observed:
`expected [ 'in_progress' ] to deeply equal []`. Two in-file cases keep it provable forever — one
reconstructs the pre-fix world, one invents a future status (a new enum member fails by default).
Plus `stalledCompletionStage.test.ts` (22) and `stalled-completion-reminder.test.ts` (7, real
source through the harness) whose `assertNoMoneyMoved()` was itself proven red.

### NEW — MEDIUM (same class, narrower): a confirmed `accepted` job >7 days past start is swept by nothing
`auto_start_due_jobs` (SQL cron, verified live via `pg_get_functiondef`) carries
`> now() - interval '7 days'` as a retro-start backstop, so a confirmed `accepted` job more than 7
days past its start falls out of it and no other sweep matches. **Nothing is in that state on prod
today.** Documented in the new check as `NO_EDGE_SWEEP_NEEDED.accepted`; NOT fixed.

### SCOPE LIMIT on the new check (so the green is not over-read)
The strong AST evaluation covers the 25 HTTP crons. The ~25 pure-SQL crons are NOT parsed —
matching on a status literal there would rebuild the exact blind spot the file removes
(`sweep_release_last_chance` names `in_progress` and would have "covered" this very bug). Statuses
whose only path out is a SQL cron are listed with the live check that established it; today that is
`accepted` alone.

### Item 7 UI — data contract, ready for the card lane
No new column, no extra fetch. From `supabase/functions/_shared/stalledCompletion.ts` (same pattern
`src/lib/arrivalGate.ts` uses for `arrivalRule.ts`):
`completionStalled(job, now): boolean` — needs `status, helper_completed_at, poster_completed_at,
date_needed, start_time, estimated_hours`. True exactly when `in_progress`, both stamps null, and
>=2h past scheduled end — the SAME predicate the cron runs, so the card can never imply a window
the sweep does not enforce. Gate the DISABLED "Work Done"/Approve affordance on it (today
`InProgressStep.tsx:82` renders nothing at all when `helper_completed_at` is null).
`STALLED_APPROVE_DISABLED_LABEL` = "Waiting on the Helpr to mark it done".
`STALLED_APPROVE_DISABLED_REASON` = "Your Helpr hasn't marked this job done yet, so there's nothing
to approve. We've reminded them. If the work is finished, ask them to tap Mark Job Complete. Your
payment stays in escrow — nothing is released or refunded until someone acts, and our team steps in
if this stays stuck." Both role-neutral (pinned by `roleNeutralCopy.test.ts`) and quotable verbatim.
`hoursPastScheduledEnd(job, now)` exported if the caption wants "3 days overdue".

### OWNER DECISIONS 2026-09-19 (third batch)

**1. ARRIVAL GATE — VN-33 is being reversed, deliberately. Owner, verbatim:**
> "but they can not start working until the poster confirms they are there. they
> shoud be aware of this so they dont try to cheat the system. if gps is not on,
> they can mark themselves as arrived but can not move on until the poster marks
> them arrived. so encourgage to turn on gps. but even if gps does confirm they
> are there the poster still needs ro cfnrm wither way"

The rule to build:
- The Helpr may ALWAYS record an arrival — GPS fix or not, near or far. Today
  `mark_helper_arrival` (since `20260915044137`, VN-33) REFUSES a far/fix-less
  arrival and **writes nothing**, which is what creates the deadlock: the Helpr
  is blocked with copy naming the poster's "Confirm They Arrived" tap, while
  that control is itself gated on `helper_arrived_at` and never renders.
- The Helpr CANNOT start working until `poster_confirmed_arrival_at` is set.
- **Poster confirmation is required in EVERY case, including a GPS-verified
  arrival.** (Before: GPS **AND** poster. After: poster ALWAYS, GPS = evidence.)
  Net effect is a relaxation of the arrival evidence bar and a tightening of the
  poster-confirmation requirement.
- The Helpr must be able to SEE that poster confirmation is required, so they do
  not believe they can slip past it, and GPS must be actively ENCOURAGED.
- The schema already distinguishes these: `helper_arrived_at` (claimed),
  `helper_arrival_verified_at` (GPS), `helper_arrival_near_miss_at/_ft`, and
  `arrivalState` already has `claimed` | `verified`. Build on those, do not add
  a parallel concept.
- **This contradicts `src/lib/arrivalGate.test.ts`'s current invariant** ("refusal
  copy never offers one as a substitute for the other") — that test encodes the
  OLD rule and must be rewritten to the new one, not deleted.
- **HELD until the browser-verification lane finishes.** Landing UI changes under
  a running verification would invalidate the run.
- Note this does NOT conflict with item 12: the caption "Awaiting confirmation"
  stays removed; the Helpr's awareness comes from the DISABLED Start Working
  CTA's reason line, which already names the poster's tap.

**2. STALLED-COMPLETION SWEEP — sweep everything, fixtures included.**
Owner overruled the `is_seed = false` scoping for THIS sweep only (they were
shown the tradeoff — fake jobs in front of whoever works the admin queue — and
chose it). `arrival-confirm-reminder` and `money-reconciliation` KEEP their
`is_seed` scoping. The 11 currently-stuck seed jobs will be nudged and escalated
on the first cron run after merge. Lane dispatched.

### DONE 2026-09-19 — sweep scope: fixtures are swept too — commit `3f054566a`
Owner overruled the `is_seed=false` scope for THIS sweep only. Exactly ONE place carried it:
`supabase/functions/stalled-completion-reminder/index.ts:173` `.eq("is_seed", false)` — removed.
The shared predicate (`_shared/stalledCompletion.ts`) never read `is_seed`; `admin_stalled_job_queue`
and `resolve_stalled_job_flag` join on `escalated_at IS NOT NULL` + `has_role(...,'admin')` only.
**No SQL object changed, so no migration was needed and none was written.**
`arrival-confirm-reminder/index.ts:126` and `money-reconciliation/index.ts:337` KEEP their scope —
now locked by an assertion so a future "consistency" edit fails CI. There is no shared scoping
helper; each sweep writes its own filter, so nothing could have flipped all three at once.
LIVE: the 11 stuck jobs re-confirmed today (11 seed, 0 real, 45h-237h past their local day end).
The sweep does NOT exist on prod yet (`to_regclass('job_completion_nudges')` null, 0 cron rows,
no `20260919143637` in `schema_migrations`) — `d738344c1` is unpushed. After merge -> db-deploy,
cron daily 14:00 UTC: run 1 all 11 hit `first` (the ladder returns `first` whenever `first_sent_at`
is null however old the row — the anti-compression guard), run 2 `second`, run 3 `escalate` ->
11 queue rows + an `admin_alert` per admin per job + a Slack ops alert each. Money moves at no stage.

### NEW — HARNESS GAP FOUND AND FIXED (why a seed-scoped sweep was untestable)
The edge Supabase mock **recorded write filters but silently dropped READ filters**, so nothing in
the harness could tell a seed-scoped sweep from an unscoped one — any test asserting what a sweep
reads on was passing vacuously. Added `scenario.readQueries` (table, cols, recorded
`eq`/`neq`/`in`/`or`), purely additive, all 797 edge tests green. **Documented caveat: `is`/`lte`
are still chainable no-ops, so assert the absence of an EQUALITY scope, never of every clause.**

### NEW — MEDIUM: the admin stalled-job queue has NO UI
`admin_stalled_job_queue()` exists but has **no call site anywhere in `src/`**. Admins will see
escalations only as `admin_alert` notifications and a Slack ops alert; no screen renders the queue.
With fixtures now in scope, 11 seed jobs will escalate into a queue nobody can open. Decide whether
a queue screen is wanted before those escalations land.

### OWNER DECISIONS 2026-09-19 (fourth batch)
- **Admin stalled-job queue: BUILD THE SCREEN.** `admin_stalled_job_queue()` and
  `resolve_stalled_job_flag()` already exist (migration `20260919143637`) and have no call site.
  Add a real admin-surface screen listing escalated stuck jobs with the resolve action wired to the
  existing RPC. Rationale the owner accepted: an escalation is a notification that scrolls away, and
  the decision it asks for is about HELD MONEY — it needs a durable worklist, not an alert.
  QUEUED behind the browser-verification lane (it touches `src/pages/` + route registration).
- **GPS encouragement: explain the benefit, do NOT block or nag.** Tell the Helpr plainly that a
  GPS-verified arrival protects them in a dispute and gets confirmed faster, and make enabling it
  one tap. Explicitly NOT chosen: warning that unverified arrivals count against them (reads as an
  accusation to someone with genuinely bad signal), and prompting on every attempt. Feeds the
  arrival-gate UI lane.

### DONE 2026-09-19 — arrival gate, DATABASE half — commit `a83c5cd16`
Migration `20260919155016_arrival_poster_confirm_always.sql`. VN-33's "no fix, no arrival" is
reversed per the owner. `mark_helper_arrival` no longer RAISEs on `arrival_location_required` /
`arrival_location_invalid` / `arrival_too_far`; one UPDATE always runs:
`helper_arrived_at = COALESCE(helper_arrived_at, now)` and
`helper_arrival_verified_at = CASE WHEN verified THEN COALESCE(...) ELSE helper_arrival_verified_at END`
— **a claim can never clear or downgrade an existing verification.** Two no-write early returns for
idempotence (`already_confirmed`, `already_verified`).

"Working unlocks" lived in **SQL and client, both** — all four moved to poster-confirm-only:
`enforce_job_tracking_arrival_gate`, `enforce_helper_completion_gates`, `rpc_helper_mark_done`'s
pre-check, and `_shared/arrivalRule.ts` `arrivalEstablished()`. **Live drift found:**
`rpc_helper_mark_done` never learned VN-33(b)'s near-miss stand-in, so a bad-pin arrival the trigger
ACCEPTED was refused by the RPC — one predicate on both sides removes that class.
PGlite 3x clean + 42/42 behaviour/ACL assertions. ACL verified on prod and post-replay: no PUBLIC,
no anon; SECURITY DEFINER + `search_path=public`; migration restates the REVOKEs.
`git status package.json package-lock.json` clean.

**NET EFFECT ON MONEY SAFETY (the lane's framing, worth keeping):** the spoofable half
(client-supplied coordinates) stops gating; the unfakeable half (a second human attesting) now
gates every case.

**JUDGEMENT CALLS THE LANE FLAGGED RATHER THAN BURIED:**
- `accepted -> in_progress` now flips on ANY recorded arrival (previously verified-only; the
  near-miss branch returned before the status flip). Judged acceptable because `jobs.status` is
  coarse and the real "started working" markers are the tracker row + `poster_confirmed_working_at`
  — but it IS a behaviour change.
- The COMPLETION gate moved too. Leaving it on GPS while Working read only the poster would have
  built a fresh deadlock one step down.
- `arrival-confirm-reminder` re-anchored from `helper_arrival_verified_at`/near-miss to
  `helper_arrived_at` — its old selector dropped exactly the Helprs who most need the poster nudged.

**MAIN IS ONE ASSERTION RED until the UI lane lands:** `src/components/JobTracking.test.tsx:68`
("stops at Arrived on HALF an arrival — VN-33"). Its SECOND assertion (poster-alone -> `arrived`)
now fails `expected 5 to be 4` — which is the reversal working correctly: poster-alone must now
paint Working. The FIRST assertion (GPS alone -> Arrived) still passes and must STAY.

### CONTRACT for the arrival UI lane
`arrivalEvidenceState(job)` (`src/lib/arrivalGate.ts`) -> `none | claimed | near_miss | verified |
confirmed`. (`arrivalState()` is unchanged and still collapses claimed+near_miss into `claimed` —
do NOT use it for the new copy.)
- "Mark Arrived": **always enabled**, no location precondition; it can no longer fail on distance.
- "Start Working" / Working step: `helperMayStartWorking(job)` == `poster_confirmed_arrival_at != null`.
  **NOT** `helper_arrival_verified_at`.
- "I'm Done": `helperMayMarkDone(job)`, same predicate.
- Blocked copy: `arrivalGateMessage(job, "tracker" | "wrap-up")` — every unconfirmed branch names
  "Confirm They Arrived"; none says "both are needed".
- Poster's "Confirm They Arrived": `posterOwesArrivalConfirmation(job)` ==
  `helper_arrived_at != null && poster_confirmed_arrival_at == null`. Do NOT gate on
  `helper_arrival_verified_at` or the near-miss columns.
- RPC return: parse with `arrivalVerdictFromRpc(data)`, render with `arrivalVerdictMessage(v)`.
  Fields: `arrival_recorded, arrived_at, verified, basis, distance_ft, poster_confirmed,
  poster_confirmation_required, arrival_established`. **`arrivalVerdictFromRpc` returns null for an
  unreadable body — treat that as "silently did nothing", never as success.**
- **Bridge to remove:** `poster_can_confirm = !verified` is set on every non-verified path purely so
  the CURRENTLY SHIPPED JobTracking takes its truthful near-miss toast instead of an error toast.
  The UI lane must switch to `arrivalVerdictFromRpc`/`arrivalVerdictMessage` and this goes away.

### NEEDS ITS OWN BROWSER VERIFICATION
The in-flight browser lane is verifying a build from `19555e010`, BEFORE this change. The arrival
rework (DB + UI) must get its own verification pass once the UI half lands — do not let the earlier
run stand as proof of it.

### BROWSER VERIFICATION 2026-09-19 — all 16 items PASS (build `19555e010`, prod, test pair)
Chromium + WebKit at 375 / 1440 (and 320 for density). 92 screenshots, 52 reviewed, **zero
unreviewed failures**. All prod fixtures restored and re-queried clean (1 probe message deleted,
20 read-flags restored, 3 jobs' columns restored from snapshot, 2 temp `job_tracking` rows deleted).

FIT — every touched page, `scrollWidth == clientWidth`, overflow 0, single 248px right-rail inset,
zero left gutter, no per-page re-inset: `/dashboard`, `/my-posts`, `/my-jobs`, `/messages` + thread
pane at both widths. At 320 both card pages are 320/320 (one 72px pulse-ring overhangs 4px, clipped).
The only "widest element" hits are MapKit's offscreen `mk-font-size-detector` probe and an
off-screen snap-carousel item inside an `overflow-x` scroller — both harmless.

**Item 13 initially looked broken (no map) — root cause was SEED DATA, not code:** neither contested
job had a `job_tracking` row. With one inserted, disputed/revision expanded AND disputed collapsed
all render tracker + map with no person box. Rows deleted afterwards. Worth remembering before
filing a "the map is gone" bug.

**The old inbox bug is confirmed dead:** entry mounts idx 0-14, scrolled mounts idx **16-28**,
scrollTop 1774 == scrollHeight 2444 - 670. The 96px below the last row is the container's own
`padding-bottom:96px` bottom-nav clearance, not the old blank. Identical in WebKit.

### DEFECTS FOUND + OWNER DECISIONS (2026-09-19, fifth batch)
- **D2 — poster Disputed row is icon-only at 375 (35px chips) and 24px at 320**, five near-identical
  grey circles on a money-dispute screen. **MY TWO DENSITY PREDICTIONS WERE INVERTED:** Completed
  (4 chips) is fine with all labels visible; Disputed is the problem and worse than predicted.
  **OWNER DECISION: LEAVE IT — "ill check once i see how it is now."** Not fixed by choice. The
  reviewer's recommendation, if it is revisited: move Escalate + Contact Admin to an overflow and
  keep Timeline + Message labelled.
- **Item 7 note measured 112px/7 lines at 375, 128px/8 lines at 320**; with its 3-line disabled
  button ~23% of the viewport, reading LOUDER than the tracker above it. **OWNER DECISION: trim to
  ONE sentence, rest behind the tap.** Dispatched.
- **Item 15 caveat — `/my-jobs` is the outlier, not Messages.** At 1440 `/dashboard`, `/my-posts`
  and `/messages` all render `h1` as `sr-only`; `/my-jobs` still paints "My Jobs" in 20px Bodoni.
  **OWNER DECISION: hide `/my-jobs`'s title to match.** Dispatched.
- **D1 — Helpr map pin is a ~6px dark crescent once arrived** (pins coincide, pill on top;
  `--olivewood` resolves to near-black `rgb(46,47,34)`, so the disc has no hue to separate it — the
  token is PRE-EXISTING, the port just put pill + both pins in the same 50px).
  **OWNER DECISION: hide the Helpr pin once arrival is settled.** Dispatched.
- **D3 — brand logo paints beneath the 56px account-warning banner at 1440** and pokes ~6px out
  below it on every page. PRE-EXISTING stacking issue, NOT this batch. Not fixed. Top-left of every
  screenshot, so easy to mistake for new damage.

### NEW — the nightly Playwright runs may have been vacuously green
**Playwright's browsers were MISSING from this machine entirely** and had to be reinstalled
(`npx playwright install chromium webkit`) before verification could run. Any local nightly that
reported green without them is suspect. Worth checking what the nightly workflows actually did.

### NOT PROVEN, stated rather than claimed
(a) A real touch-drag on the map in WebKit — Playwright's WebKit exposes no trusted touch channel,
and synthetic `TouchEvent`s scroll nothing in EITHER engine (same method gives delta 0 in Chromium,
where real CDP touch gives 245px). The `touch-action` chain is `auto` all the way up in both, so no
divergence is expected — but it is unproven, not proven.
(b) The blocked-CDN degraded map path in WebKit — route interception did not take; Chromium-proven only.

## >>> ASK THE OWNER AFTER THE PUSH — they asked to be reminded <<<
**Owner, 2026-09-19, verbatim: "im not sure. can you remind me to check this once everythung is on
main and give you an answer once i see it for myself."**
THE QUESTION: hiding `/my-jobs`'s desktop title (`bd86dfb18`) removed the `!isTrulyEmpty` escape
hatch that external QA added on 2026-09-07. On the DESKTOP WEBSITE an **empty** My Posts / My Jobs
now shows a header bar with **no page name and no tabs — just a magnifier icon floating alone**.
Options when they look: (a) show the title only when the page is empty — restore the old exception;
(b) put the empty-state message in the header instead (new copy in `ActivityHeader`/
`ScreenHeaderRow`); (c) leave the bare magnifier. **RAISE THIS UNPROMPTED once main is pushed.**

### DONE 2026-09-19 — map pin + desktop title — commits `92a4f8429`, `bd86dfb18`
- **D1 fix:** the Helpr annotation is simply NOT BUILT once arrival is settled, so no orphan
  `role="img"` node and no focus target (`mapMarkerAccessibleName` stays green). "Settled" comes
  from the prop `TrackingMap` already takes — `destinationLabel` via the existing `labelled` flag,
  the same fact that draws the pill and shifts the camera. No new prop, no `arrivalGate` import.
  Un-arrived case proven byte-identical: 2 annotations, helper first, and
  `helper.factory().outerHTML === helperMarkerElement(true).outerHTML`.
- **Fix 2 — `/my-jobs` and `/my-posts` NEVER diverged by route.** Both are `Activity.tsx` running
  the same line: `titleSrOnly={isWebDesktop && !isTrulyEmpty}` where
  `sourceCount = tab === "posted" ? postedJobs.length : appliedApps.length`. It is **DATA**: an
  account with posts and no applications is truly-empty on My Jobs and not on My Posts — one
  expression, opposite answers, exactly the pair of screenshots measured. Now bare `isWebDesktop`,
  matching Messages (`ConversationList.tsx:874`) and Home (`Dashboard.tsx:631`). 375 unchanged
  (`useIsWebDesktop()` is false below 900px, so `false && x` and `false` are the same value).

### DONE 2026-09-19 — admin stalled-job queue screen — commit `5ebca0a41`
`/admin?view=stalled`, registered once in `adminNavGroups.tsx` (the rail, the command palette and
the desktop side panel all read that one list). Modelled rung-for-rung on `AdminExceptionQueue`;
money framing borrowed from `UnsettledSettlements`. **No route added** — `?view=` is the console's
existing deep-link mechanism.
- **PGRST202 fallback works TODAY** (the RPC does not exist on prod yet): a designed
  "this queue isn't live yet" state with a Check-again button — explicitly NOT "the queue is empty".
  `isMissingRpc` catches that ONE class; `42501`/`PGRST301` still throw to `ErrorState`, because
  "I couldn't ask" must never read as "nothing is stuck" on a screen about held escrow.
- **NO money control, enforced by test:** the screen fails if any button ever matches
  `/release|refund|payout|charge/`. "Mark Reviewed" calls `resolve_stalled_job_flag` and nothing else.
- 19/19 green, every assertion proven red first (incl. removing the rail row, dropping the in-flight
  guard, treating RPC `false` as success, and adding a Release Payment button).

### NEW — HIGH (pre-existing, class): admin escalation alerts deep-link to nowhere
`stalled-completion-reminder/index.ts:243` AND `arrival-confirm-reminder/index.ts:204` both set the
admin alert link to `/admin?job=<id>`. `Admin.tsx` reads only `?view=` and `?user=`;
`AdminJobs.tsx:162` is the only `?job=` consumer and never mounts from that URL. So every admin
escalation alert lands on the admin dashboard home. **The arrival one has been a dead link for as
long as it has existed.** Lane dispatched with a class guard deriving BOTH the emitted links and the
handled views from the world. Deliberately NOT fixed by teaching `Admin.tsx` to coerce `?job=` —
that hides a broken link behind a redirect and would silently re-route the arrival alerts too.

### OPEN, reported not built (owner decisions)
- **After an admin marks a stalled job reviewed, the next step is undefined.** A stalled job has no
  dispute record, so an admin must navigate to `?view=jobs` and use `RefundJobDialog` /
  `StatusOverrideDialog` themselves. A LINK (not a money control) from the queue row into that
  dialog would close the loop — needs a decision on which path is canonical.
- **No rail badge count on the Stuck Jobs queue.** `getBadge` is fed by `Admin.tsx`'s stats loader,
  which only runs on the home view; a live count needs a new prod query. Flagged, not guessed.

## THE CHECKING GAP — owner, 2026-09-19: "correct the checking to where this kind of thing is not missed. period." / "they're connected or complete... otherwise they're pointless"

### THE STANDARD (now the rule; `CLAUDE.md` update pending)
**Every check must demonstrate ONE of two things, mechanically, or it does not count:**
1. **CONNECTED** — breaking the thing it guards makes it go red. A test that renders a component
   directly proves the component; it proves NOTHING about the code that mounts it.
2. **COMPLETE** — its inventory is derived from the world and provably covers it, with a non-empty
   floor. A guard that iterates an empty set passes trivially.
A check that shows neither is decoration, and worse than nothing: it occupies the space where a
real check would go and makes the area look guarded.

### WHY EACH OF TODAY'S FIVE WAS INVISIBLE (the diagnosis, not excuses)
| Defect | Why no audit could see it | Class |
|---|---|---|
| Inbox hid 13 of 29 threads | Audits screenshot the TOP of a page; the blank was below the fold, after scrolling. JSDOM has no layout, so no unit test could see it either. | below-fold / post-interaction |
| Escrow held forever | Every sweep had tests proving IT does what it says. Nothing asked "is every state covered by SOME sweep?" You cannot screenshot an absence. | absence / exhaustiveness |
| Bad-GPS deadlock | Both halves correct, both tested. `arrivalGate.test.ts` asserted the copy NAMES the poster's tap — and passed — never asking whether that tap was reachable. | composition / reachability |
| 14 of 34 admin links dead | A test PINNED the link string. It proved the link equalled a constant, never that it resolved. | pinned-but-unverified |
| Nightlies possibly false-green | Playwright's browsers were not installed; the suite reported success without running one. | harness vacuity |
**The single thread: we test that things are CORRECT, not that they are CONNECTED or COMPLETE.
Four of the five had a passing test sitting right next to the bug.**

### LANES BUILDING THE FIX (dispatched 2026-09-19)
- **Anti-vacuity gate** — can each of the 132 `src/test/` guards actually fail? Covers: empty-inventory
  vacuity, mount-wiring vacuity, harness vacuity, self-referential inventory, literal-vs-semantic.
- **Reachability guard** — every instruction the app gives must name something reachable from that state.
- **Exhaustiveness registry** — declared dimensions that must have no holes, both sides derived from source.
All three were told: **the list of violations they find is the deliverable, not a green run.**

### DONE — the dead-admin-link class — commit `0bf3fb1c5`
**14 of 34 admin links emitted by edge functions were dead**, not the 2 we knew about: `?job=` ×2 and
`?tab=payouts`/`?tab=disputes` ×12 (`tab` is read only by `AdminUsers`, and only for
pending/approved/denied — `?tab=payouts` never routed anywhere). Fixed to real `?view=` targets.
Guard `src/test/adminDeepLinkContract.test.ts` derives BOTH sides from the world: a comment-aware TS
literal scanner over `supabase/functions/**` (a scan desync FAILS the guard rather than silently
shrinking its input — it fired for real on a JSX template) vs Admin.tsx's real `View` union AND
`VIEW_LABELS` keys parsed separately (drift between them fails) plus every `searchParams.get()`
across `src/components/admin/**`. Anti-vacuity asserts the param list came from the components.
**A NEAR-MISS WORTH KEEPING:** a stricter third rule was written, went red on
`auto-resolve-disputes`' five `?view=disputes&job=<id>` links, and the "fix" (dropping `&job=`) was
caught by `auto-resolve-disputes.test.ts` as a REAL regression — the param is part of
`reminderKey(userId, title, link)`, so flattening it would make one job's reminder suppress every
other job's for 24h. Rule dropped, reasoning recorded. **A param can be load-bearing for something
other than routing.**
HAND-BACK: `AdminDisputes.tsx` should copy `AdminJobs.tsx:161-171` (read `?job=`, open it, strip the
param); then those five links open the dispute and the guard enforces it automatically.

### REVERTED — a "deploy lag is not a defect" heuristic that masked a real defect
`writeContract.test.ts` rejected `AdminStalledJobs`' two brand-new RPCs, whose only escape hatch is
`write-contract.baseline.json` — the KNOWN DEFECTS list. Filing deploy lag there is wrong twice: it
is not a defect, and it trains the habit of dropping real rejects in the same file to get green.
I added a `pending` class (RPC defined in a local migration, absent from the prod snapshot).
**Within minutes it swallowed `rpc_add_dispute_evidence`, a REAL baselined defect** — that function
DOES exist on prod (verified live: `any_overload=1`) with a different signature, and the snapshot
simply lacks the name. It also broke the suite's own can-fail proof by reclassifying a deliberately
deleted function as `pending`. **Reverted rather than tuned** — the honest signal is "is the defining
migration applied to prod?", and the snapshot carries NO metadata (keys: `functions`, `tables` only),
so it cannot be computed offline.
**PROPER FIX, open:** add `appliedMigrations` (from `supabase_migrations.schema_migrations`) to the
snapshot on refresh (`.github/workflows/write-contract-refresh.yml`), then `pending` becomes exact.
Until then the two RPCs are baselined, and this line is their OPEN.md entry.

### DONE 2026-09-19 — the checking gap, phase 1 (commits `e8b538b0e`, `f286bcdb9`, `0f87f3efb`, `ca20f14f9`, `bdbdb5e25`, `a17550c63`, `01562f794`, `069d658e5`, `3912d03e5`, `2d706f78d`, `7e8b7f85d`)
**`npm run vacuity`** — 4 parts, cheapest first: a ratchet (every guard registers a mutation or is
grandfathered in `src/test/vacuity.baseline.json`, which may only SHRINK — a stale entry is itself a
failure), a TS-AST static scan, a harness preflight, and a mutation runner. 11.5s full set; per push
it is scoped to guards whose guard-file or guarded-file changed vs origin/main (untracked included —
a brand-new guard matters most). Nightly full at 06:10 UTC. **The gate is itself guarded**
(`vacuityGate.test.ts` plants vacuous guards and asserts each is flagged).
**Now: 14/14 mutations killed, 0 known-vacuous, preflight 0 blocking.**

WHAT IT FOUND: **20 of 132 guards pass on an empty inventory** — incl. the guards for money/state
columns on `jobs`, zero-row writes, anon street-address leaks, admin authz, ban evasion, and (ironic)
the "NO MOCK MODE, EVER" guard itself. Ratcheted, listed in `docs/audit/vacuity-report.json`.
Plus 1 self-referential and 38 mount-wiring gaps (reported, not gated — the import graph resolves by
path, so barrel re-exports and dynamic mounts are missed).

**`shellConsistency.test.ts` SURVIVED replacing Profile's real `<AppShell>` with a `<div>`** — the
guard behind the owner's "THEY SHOULD ALL BE THE SAME EVERY SINGLE ONE" — because it matched the
literal `<AppShell` anywhere in the file and Profile has a second one in its skeleton branch. NOW
AST-based: walks every return through both arms of every conditional, descends THROUGH capitalised
wrappers, **stops dead at the first host element (a `<div>` IS a frame)**, and follows childless
delegates and local JSX helpers. 6 pages' mutations now kill it. Two more holes closed on the way:
`routePathsForPage` only matched PROPLESS mounts, so `<Activity defaultTab="applied" />` reported
"no routes" and silently excused Activity from the agreement check.

**`controlReachability.test.ts`** — every control name QUOTED in copy must resolve to a label some
component renders (strong); every column gating a control must have a producer (strong); copy
producers and control producers auto-paired by shared column vocabulary and EXECUTED over the full
2^n boolean state space (best-effort, and honestly labelled so). Red-proof: with `arrivalRule.ts` +
`posterStepContract.ts` byte-restored to the VN-33 world it reconstructs today's deadlock from
source with nobody naming it.

**`exhaustivenessRegistry.test.ts`** — 6 dimensions, each with inventory and coverage derived from
the world. Two meta-properties stop the registry being a hand-list checked against itself: every
enum in `Constants.public.Enums` must be CLAIMED by a dimension, and every non-delegated dimension is
pushed a synthetic member through its own `coverage()` and must report it uncovered.

**`adminDeepLinkContract.test.ts`** — found **14 of 34** admin links dead (see above).

### SECURITY — fixed: a policy-less table holding client grants
`notification_dedupe_suppressions`: RLS on, **ZERO policies**, yet `anon` SELECT and `authenticated`
SELECT+INSERT (verified live). Not exploitable while RLS-with-no-policy denies all — which is exactly
why it was a missing second line of defence: one `USING (true)` policy turns it into a live read of
who was sent what. Root cause is the default-privileges re-grant class; `20260915055601`'s one-off
REVOKE could only name tables existing then. Fixed `bdbdb5e25` (migration `20260919172735`).
**CLASS CHECK:** `scripts/ci/sensitive-anon-grants.sql` had a hand-written `sensitive(tbl)` allowlist
that never looked at this table. Generalised to *"every table with RLS on and zero policies must hold
zero client grants"*, derived from `pg_class` + `pg_policies`, no list. Non-vacuity proven in real
Postgres incl. a "FROM PUBLIC only" revoke leaving all 8 rows red — proving the repo's own
`revoke-anon` scar rather than assuming it.

### NEW — the edge mock had clauses that LIED
`.not()` and `.ilike()` recorded themselves as `neq`/`eq`. Tests asserting those were checking the
opposite of what they claimed. Now recording: `is, lte, gte, lt, gt` (as own ops) + `limit`, `order`.
**Still NOT recorded, and the caveat comment now says so:** `.range()` (it really slices), the
terminators (`single`/`maybeSingle`), and the big one — **filters are recorded, never MATCHED**: the
scenario still decides results by table name, so a record tells you what the code ASKED for, never
what the server would answer.
New assertion that was impossible before, protecting money: `auto-release-payment`'s due query must
carry `.is("revision_requested_at", null)` — without it the sweep pays out a job the poster formally
sent back for revision.

### NEW — a pattern worth sweeping for: "a check that requires a defect to survive"
Three proofs-of-life were **locks on defects**. `exhaustivenessRegistry`'s "found enum-keyed maps at
all" proved its scanner worked BY THE FACT that `instant-job-match` was broken; its "D2 goes red"
case did string arithmetic on a ratchet entry. Both failed the instant the defect was fixed
(`expected undefined to be truthy`). Both now run the real logic against a synthetic world.
**This is the inverse of vacuity and equally bad — not a check that cannot fail, but one that can
only pass while something is broken.** Worth a dedicated sweep.

### NEW — `error-leak-EF5` found 8 edge functions still leaking
Rewritten onto the AST over all 145 edge files: every `catch (binding)` plus anything ALIASED from it
(`const err = error as Error`, `const message = err instanceof Error ? …` — both are how the leak is
actually written here), flagged when a `new Response` reads a tainted name in a VALUE position.
A textual first cut got 8 of 11 wrong. 1 fixed (`instant-job-match`), **7 recorded with what each
leaks** — ratchet proven red both ways.

### STILL OPEN from the checking work
- 20 unfloored guards (ratcheted, listed in `docs/audit/vacuity-report.json`) — close them down.
- 38 mount-wiring gaps reported, NOT gated — incl. `PostedJobCard.tsx` / `AppliedJobCard.tsx`, whose
  parents are rendered by no test. That is exactly the shape of the badge bug caught by hand today.
- The ratchet does NOT cover the 327 colocated specs or `src/test/edge/**`.
- Class (e), literal-vs-semantic, is **not statically decidable and was not faked**: the gate forces
  a registration but cannot judge whether the mutation is a GOOD one. A weak mutation still "kills".
- `write-contract.snapshot.json` carries no metadata, so deploy-lag cannot be told from a real
  missing RPC offline. Add `appliedMigrations` on refresh (see the reverted-heuristic entry above).
- 7 edge functions still leak error detail (recorded in the EF5 ratchet).

### FINAL BROWSER GATE 2026-09-19 — arrival rework, admin queue, map pin, desktop title
36 screenshots, 36 reviewed, `review:report` exit 0. Chromium + WebKit, **zero divergences**.
Fit: `widest: null` and `scrollWidth === clientWidth` on EVERY page touched, at 375, 320 and 1440
(frame 0-1192 = 1440-248, single right-rail inset). Fixture `bb2c3732` restored to an EXACT MATCH on
all 15 touched columns and the stray `job_tracking` row deleted.
**Correction to an assumption in the brief:** an admin session IS available (`admin-e2e`,
`helpr-seed-admin-0912@louisianahelpr.com`, real `user_roles` row), so the admin queue was verified
properly rather than partially.

**SHIP-BLOCKER FOUND AND FIXED — `02847b150`.** See the commit: the new arrival copy promised a
check-in that had not happened during the Vercel-vs-db-deploy gap, rebuilding the very deadlock this
batch removed. **The lesson generalises: a UI shipped ahead of its migration must be honest about
the old server's behaviour, not only the new one.** Worth a standing check — no lane had it in scope
because every lane reasoned about the post-migration world.

**Item B measured, the number moved:** the stalled note went 112px/7 lines at 375 and 128px/8 at 320
-> **48px/3 lines at both**, in both engines. Reviewer's honest caveat: it no longer outranks the
tracker (the problem the owner named, fixed), but it still sits directly above a 3-line disabled
button saying the same thing in different words ("Your Helpr hasn't marked this job done yet" vs
"Waiting on the Helpr to mark it done"). Duplication halved, not removed.

### >>> FOR THE OWNER — the empty-header screenshot they asked for <<<
`test-results/final-gate/E6-OWNER-empty-my-jobs-header-desktop-1440.png` (+ `E6b-...-crop.png`).
Reviewer, blunt: *"it looks bad"* — a 1142x43 white strip holding one "Search jobs" magnifier at the
far right, hairline rule below, no page name, no tabs. **Reads as a toolbar that failed to load,
not as a deliberate minimal header.** Owner to decide: (a) show the title only when the page is
empty (restore the 2026-09-07 QA exception), (b) put the empty-state message in the header
(`ActivityHeader`/`ScreenHeaderRow`), (c) leave it.

### NEW — MEDIUM (pre-existing): the ladder derives "Confirmed" from `status`, not from the stamps
Fixture `bb2c3732` is `in_progress` with `helper_confirmed_at`, `poster_confirmed_at` and
`helper_dayof_confirmed_at` ALL NULL. The tracker painted "Confirmed" complete and offered
"I'm On My Way"; the server refused with `helper_not_confirmed`. **Any job reaching `in_progress`
without those stamps offers a control that cannot work.** Same class as the deadlock — a control
offered for an action that will be refused — and `controlReachability.test.ts` did NOT catch it,
because its CHECK 3 only pairs copy-producers with control-producers that are pure exported
functions over a column-shaped object; this gate reads `status`. Honest limit of the new guard,
recorded rather than papered over.

### NEW — LOW (from the same pass)
- Arrival copy DENSITY on the claimed-no-GPS card: 10 lines of prose between the photo box and the
  buttons (6 amber + 4 muted), and the two OVERLAP — both say "turn Location on", both name
  "Try My Location Again". The amber block also LEADS with the GPS ask rather than the blocker,
  blurring the amber-means-blocked / muted-means-advice separation the design rests on.
- Seed rot: two `storage/v1/object/sign/proof-photos/...` URLs on seed job `e7e09075` return HTTP 400.

### DONE 2026-09-19 — tracker "Confirmed" from stamps + arrival copy split — commit `a17f8e955`
**The bug was sharper than the browser pass found.** The `jobStatus === "in_progress" ||
"revision_requested"` floor at `STATUS_IDX.job_confirmed` did not merely MISLABEL a step — it
**skipped the gate**. The `helperHasConfirmed` check lived inside the `job_confirmed` branch of the
next-step CTA, so a rail already sitting at `job_confirmed` never reached it. The gate is now keyed
on **the step the button would take** (`nextStatus.key`), not on where the rail happens to sit, so
position can no longer bypass it. The floor drops to `STATUS_IDX.assigned` — a job underway
evidences an assignment and nothing more.
LIVE SERVER PREDICATE MATCHED (`pg_get_functiondef`, read-only): `helper_mark_on_the_way` has
exactly ONE content check, `helper_confirmed_at IS NULL -> helper_not_confirmed`. It never reads
`poster_confirmed_at` or `helper_dayof_confirmed_at`. The rail's two steps stay distinct: `confirmed`
= "Accepted" (`helper_confirmed_at`), `job_confirmed` = "Confirmed", the mutual day-before.
Both prior rules proven intact: the revision/disputed clamp to Working, and GPS-alone-stops-at-
Arrived vs poster-confirm-alone-paints-Working.

**Arrival copy split — the number moved:** amber **243 -> 94** chars, muted **186 -> 84**, block
**429 -> 178**. At 375: **9 lines / 143.5px -> 4 lines / 63.8px**. At 320: **11 lines / 175.4px ->
5 lines / 79.8px**. Amber now carries the BLOCKER only ("The person who posted this job has to tap
\"Confirm They Arrived\" before you can start working."); muted carries only the benefit ("Turning
Location on gives you GPS proof you were here, if this job is ever disputed."). "Try My Location
Again" appears exactly ONCE per card. Heights are COMPUTED, not photographed — needs the browser lane.

### NEW — PATTERN: seed fixtures create states the app cannot reach, and they cause false bug reports
Today this cost two investigations:
- item 13 "the tracker map is gone on contested jobs" — the CODE was right; neither contested seed
  job had a `job_tracking` row.
- the "Confirmed" bug above was FOUND on seed `bb2c3732`, which is `in_progress` with
  `helper_confirmed_at` NULL.
Scanned prod: **every** job in that state is `is_seed` — 4 of 17 `in_progress`, 13 of 18
`completed`, 1 of 3 `disputed`. **No organic job has ever been in it.** The producers INSERT `jobs`
with `status` set directly, bypassing `accept_job` / `respond_to_direct_offer` — the only writers of
`helper_confirmed_at`: `scripts/probes/completion-race.prod.mjs`, `scripts/probes/arrival-gate.probe.mjs`,
`scripts/ci/race-runner.mjs`, `e2e/prod-lifecycle.spec.ts`. (`auto_start_due_jobs` is NOT the culprit
— it explicitly requires `helper_confirmed_at IS NOT NULL`.)
**DECISION NEEDED:** either the fixtures stamp what the real flow would stamp, or a CHECK constraint
forbids the state. Until then, a fixture-only state will keep being reported as a product bug.
RESIDUAL, documented not fixed (`JobTracking.onTheWayGate.test.tsx`): on such a row the rail floors
at Offered and the CTA becomes the vestigial "I've Accepted", which writes `job_tracking.status`
only — **no client tap can produce `helper_confirmed_at`**. Withholding it would make that control
unreachable in every state, i.e. a deletion dressed as a gate.

### NEW — the reachability guard earned its keep within hours
`controlReachability.test.ts` caught the tracker lane's own first draft going **vacuous, twice**:
(1) hoisting the control name into a `const` made `arrivalGateMessage` invisible to its AST scan
(it harvests RETURNED string literals), silently dropping the
`arrivalGateMessage <-> posterConfirmationRung` pair — **the exact pair the 2026-09-19 deadlock lived
in**; (2) dropping the near-miss read shrank the pair's state space and lost the path by which the
poster's control IS enabled without `helper_arrived_at`. Both restored with the reason beside them.

### DONE 2026-09-19 — the four other nightly reds, triaged and cleared
**#1618 prod-audit was TWO DAYS FROM AN OUTAGE.** The sweep was green; the *strike check* failed.
The contact-smuggling spec deleted its message but NOT what `apply_message_scan_consequence` wrote,
and `message_violation_ladder` escalates on the COUNT of `user_violations` — so it climbed a rung a
night: 09-15 `warning` -> 09-17 `final_warning` (ban_status stamped). **The next run would have put a
7-day restriction on the account every prod workflow signs in as.** Spec now undoes the consequence
ladder and proves it; prod repaired (2 violations + 18 fraud flags deleted, ban_status -> active).

**#1597 a11y-webkit-prod COULD NEVER PASS.** Both sweep legs were green every night; the required
diff job died in 2s with `usage:` and exit 2, because
`files = args.filter(a => !a.startsWith("--"))` counted **`--out`'s VALUE** as a third report path.
**Five nights of WKWebView evidence captured, uploaded, and never compared.** Fixed via VALUE_FLAGS;
proven by re-running the fixed diff against run 35351014180's own artifacts -> exit 0.

**#1582 press-every-control:** every teardown DELETE was 403. `return=representation` with no
`select=` means `RETURNING jobs.*`, and `authenticated` holds SELECT on 109 of 110 columns
(`offered_to_helper_id` withheld). **26 fixture jobs leaked onto prod** and were swept. Same
forwarder class fixed in `harness.ts restAs`, `prod-audit-sweeper del()`, `audit-capture.mjs`,
`create-app-review-demo-account.mjs`.

**#1595 e2e-journeys:** 2 stale spec + 2 environmental. `TimePickerWheel.tsx:192` swapped to a native
`<input type="time">` on web desktop on 2026-09-07 and took three chained specs down;
`pickStartTime()` now drives whichever control the viewport renders. One `waitForTimeout(1_500)`
raced the fixture's own 3-8s injected latency.

**THE MECHANISM** `.github/workflows/nightly-red-age.yml`: the alerting was never broken — #1582 had
EIGHT "Still red" comments. It failed at the last mile: **an unassigned issue is a list nobody is
forced to read**, and these workflows run only on a schedule, so a push never reveals them. The new
workflow FAILS THE NEXT PUSH on any `nightly-red`/`prod-down` issue open >24h, naming each with age
and run URL. Escape hatch `nightly-red-ack`. `issues: read` only. Proven: the live list returns all
five, oldest 158h.
4 new guards, `npm run vacuity` 8/8 killed. **The representation guard took two passes — it was
first satisfied by the COMMENT explaining the bug, then by a regex that only ASKED whether a select
was present.** Same trap as the `font-serif` comment and the `poolOptions` comment earlier today.

### NEW — user-facing: "Not Now" on the push prompt tells the user notifications are off
`NotificationPanel.tsx:399` — pressing **"Not Now"** raises *"Notifications are off…"*. 20 a night in
the sweep, and it hits **any real user who ever blocked notifications**. Decider is
`pushPermissionNudge.ts:149`, which treats an already-`denied` browser state as "the browser refused"
when the user dismissed OUR dialog. `useRequestPushPermission` (`nativePush.ts:504-522`) already
computes the right answer and discards it. NOT FIXED — another lane owns those files.

### NEW — prod profile load really is over budget
`useCurrentUser.ts:230` + `ProtectedRoute.tsx:328-345`: 31 failures a night are one thing — a missed
**6s** profile deadline painting "We couldn't load your account." Measured max **6237.9ms** against a
6000ms budget. The auto-heal runs only AFTER the card paints. Decision needed: raise the budget, or
make the heal pre-empt the error card.

### NEW — LOW: `MobileNav.tsx:791` needs `aria-current="page"` on the FAB. One line, real a11y gain.

### LOST FILE (disclosed by the lane, not discovered)
`e2e/happy-path/zz-tmp-probe.spec.ts` — untracked, swept up in another lane's cleanup line and
unrecoverable. Reported rather than hoped-over.

### DONE 2026-09-19 — group jobs PHASE 1: per-member lifecycle on the roster
Commits `315fb0c72`, `951843598`, `cb942ea51`, `9f7bf02ea`. Migration
`20260919192559_group_roster_per_member_lifecycle.sql`. **`GROUP_JOBS_ENABLED` is still `false`.**

**THE TRAP IS REMOVED STRUCTURALLY, NOT GUARDED AGAINST.** The `jobs` UPDATE policy was NOT widened
and neither `OLD.helper_id` early return was touched — **members 2..N never write `jobs` at all.**
13 lifecycle columns on `group_job_helpers`, ALL server-owned via H-001's
`current_user NOT IN ('authenticated','anon')` mechanism, plus 6 SECURITY DEFINER RPCs
(`REVOKE ALL FROM PUBLIC, anon`, `GRANT TO authenticated, service_role`, `SET search_path`).
`enforce_group_member_completion_gates` applies the SAME three gates per member — poster-confirmed
arrival of THAT member, that member's own before/after photos, that member's own 30-minute floor —
and **contains no `OLD.helper_id` test at all**, so it cannot be walked past by being someone else.
That is the whole difference from the `jobs` triggers.
**Owner semantic 1 built:** `rpc_group_member_mark_done` stamps `jobs.helper_completed_at` only when
every slot is filled AND finished, under `FOR UPDATE` so two simultaneous finishers cannot both
think they were last.

**FOUND LIVE, WRITTEN DOWN NOWHERE — and PGlite missed it:** `enforce_job_tracking_arrival_gate`
raises `tracker_not_assigned_helper` on `v_job.helper_id IS DISTINCT FROM NEW.helper_id` and
early-returns only on `is_server_context()`. A SECURITY DEFINER RPC called BY a crew member is not a
server context (`auth.uid()` is still theirs), so members 2..N could not have a tracker row at all.
The live read caught what the local replay could not.

**Four things `groupJobs.ts` (2026-09-01) did not know:** `helper_completed_at` is now server-owned
(H-001), so half the (b) trap is already shut — but the column-whitelist half is fully live;
`admin_release_dispute` now REFUSES a multi-member roster, so the "(b) releases money" framing is
stale; today's arrival reversal changed the rule out from under it; and the roster grew two triggers.

**1-HELPER PATH PROVEN UNCHANGED** (this was the thing that must not regress): the only
single-helper object rewritten is `enforce_helper_completion_gates`, restated byte-for-byte from
`pg_get_functiondef` plus one early return conjoined on `OLD.is_group_job IS TRUE` AND a
transaction-local flag only the roll-up sets. PGlite 3x verbatim, 3 red before / 18 pass after;
ACLs asserted against the catalog, not the file. `git status package.json package-lock.json` clean.
`jobsGuardRpcParity` went RED when the crew branch was placed first — its Working assertion is a
non-greedy first-match — so branch ORDER is now asserted with that reason attached.

**PAYOUT — the even split ALREADY EXISTS and is correct.** `process-scheduled-payouts` fans escrow
across the roster: one transfer, one idempotency key, one ledger row per member at
`budget / helpers_needed` (urgent fee divided too), holding `payout_pending` until every member
settles. `release-payout`, `admin_release_dispute` and `execute-dispute-split` all REFUSE a
multi-member roster rather than pay 1-of-N.
**What is missing is the TRIGGER, not the arithmetic.** Owner semantic 2 (each share releases on that
member's own completion) is blocked on `payment_status` being a JOB-LEVEL scalar: it needs
`payout_status`/`payout_scheduled_at` on the roster row, `auto-release-payment` + the payout cron
selecting ROSTER ROWS not jobs, manual `release` paying one share, and the job's `payment_status`
becoming a derived rollover — which changes what `money-reconciliation` calls stranded. **Four money
functions. NONE built, as instructed.**

### BREAKAGE (d) — reviews. OWNER DECISIONS NEEDED (verified live, not attempted)
`UNIQUE (job_id, reviewer_id)`; `enforce_review_validity`, the INSERT policy and `can_review_job` all
read the scalar `jobs.helper_id`. On a 3-person crew the poster gets ONE review and it may only name
the lead; members 2..N can neither be reviewed nor review.
**THE SILENT BREAKAGE:** `set_review_visibility` (the 14-day double-blind) finds a reciprocal by
`reviewee_id = NEW.reviewer_id … LIMIT 1`. On a crew, the poster reviewing member B matches member
A's review of the poster and **reveals both early**. Not a constraint change — the reciprocal must be
keyed on the pair.
**THE LADDER INFLATES:** `get_helper_tiers` counts reviews per `reviewee_id` with no per-job cap, so
a 4-person crew job yields 4 helper reviews instead of 1 — "25 reviews -> Elite" arrives on a
quarter of the jobs. Same shape in `get_public_profile_stats`.
DECIDE: (i) does a poster write N reviews or one crew review — if N, does one bad member drag the
others; (ii) does each member review the poster separately (N reviews of the same poster from one
job); (iii) is a crew review worth 1/N toward a tier or a full 1; (iv) when does the double-blind
window close when four people review at different times.

### NEW — pre-existing, unrelated to crews: the review gate disagrees with itself
`can_review_job` requires `payment_status = 'released'`; the INSERT policy allows `released` OR
`payout_pending`. **The UI can hide the review control on a job the database would accept a review
for.**

### STILL REQUIRED before `GROUP_JOBS_ENABLED` can flip
1. (d) reviews — owner decision above, then a migration. **No tripwire exists for it.**
2. Per-member payout release (owner semantic 2) — the four-function design above.
3. The crew UI — per-member Done, crew tracker, poster's per-member "Confirm They Arrived". The RPCs
   exist; **nothing calls them.**
4. **Drop `reject_new_group_jobs` in the SAME migration that flips the flag** — otherwise every
   already-installed `.ipa`/`.apk` stays refused by the server.
5. Deploy, then a prod xmin race proof of the roll-up — it cannot be run until the migration is live.
Also: 13 new columns mean `src/integrations/supabase/types.ts` is stale after deploy.

### DONE 2026-09-19 — ONE BUTTON SHAPE (owner item 9, second telling) — `9462cd203`, `b7d910b75`
Owner, with a screenshot: *"i will not say this again. the buttons need to have the same size font
and everything they shouldnt have all different stuff."* A previous lane reported item 9 PASSED —
45 buttons all resolving to {11px, 12px, 14px}, all Montserrat, all >=44px. **That report validated
the TIERS instead of questioning them.** The owner never asked for conformance to three sanctioned
sizes; they asked for one treatment.

THE SHAPE: **icon ABOVE an 11px wrapping label, a DECLARED `min-h-[44px]`, the Button base radius** —
for every control in the row. Only TONE (green gloss / danger / done / neutral) and POSITION
(primary right-most) vary.
THE ARITHMETIC THAT FORCED IT: at 320 the row is ~256px; five slots + four 6px gaps leave ~46px
each. An inline icon-beside-label control needs icon 18px + gap + "Working" at 14px (~54px) ~= **76px
before it shows one word**. Stacked gives the whole 46px to the label and lets it wrap — "Working" at
11px is ~42px.
**That arithmetic is WHY the third tier existed:** the inline primary had grown a `[data-tight]` rung
stepping it to 12px and stripping its icon — a third size and a third shape on the one control that
most needs to look like its neighbours. **That rung is deleted.** `ICON_CHIP_PX` 48 -> 44 (the tap
floor) instead, so at 320 with four icon-only chips the primary gets 56px not 40px.
`primaryRoomAfterCompaction()` replaces `shouldTightenJobStepPrimary()` so a label that genuinely
cannot fit is a readable NUMBER, not a silent shrink.
**`index.css` no longer sizes the primary at all** — that block was HOW it drifted: chips declared
geometry in a class, the primary inherited different geometry from a stylesheet, and its
`padding: 0.5rem` silently out-ranked the class's `px-1`.

RED-BEFORE: `src/test/jobRowControlSameness.test.tsx` against the unmodified tree — **12 of 16
failed**, including the owner's own screenshot row ("Try My Location Again" and "Start Working" vs
"Message": `text-ds-14` / icon-beside-label / no declared floor / bare label). Adding the day-of case
then caught a **FOURTH object the first red run missed** — `JobConfirmation`'s "I'm Still On",
portalled in from a file nothing under `src/components/activity` draws, which is exactly why the old
static scan could not see it. The guard compares **resolved token values read off each rendered
element**, not class names, so a comment cannot satisfy it. `npm run vacuity` 16/16 killed.

DEAD TIERS DELETED, not flagged off: `JOB_ACTION_FULL_CLASS` (one consumer, `DirectionsButton
variant="full"` — the DEFAULT, which no call site passed) and `SosShareButton`'s `"pill"` (also the
default, also unreachable). Both props removed.
PHOTO CAPTURE ON THE ROW (owner Part A): `HelperPhotoAsk`'s titled panel + full-width "Add Photo" —
the block in the screenshot — is now one chip, `PhotoProofCaptureChip`, labelled **"Before Photo" /
"After Photo"**. Deliberately NOT merged with the neutral "Photos" gallery chip: a helper with no
before photo tapping "Photos" would land in an empty gallery. Still self-gates on
`require_photo_proof`.

### THE BEFORE-PHOTO GATE IS SERVER-BLOCKED (owner Part B) — correctly NOT shipped
Verified live: `job_tracking` has exactly ONE non-internal trigger and
`enforce_job_tracking_arrival_gate()`'s working branch refuses only on
`poster_confirmed_arrival_at IS NULL` — **nothing about photos**. A client-only block would be
STRICTER THAN THE SERVER and would strand any Helpr whose upload failed — the same shape as the
bad-GPS deadlock removed this morning. The lane stopped and reported instead of shipping it.
`src/test/beforePhotoCapture.test.tsx` pins the live predicate with a
`START_WORKING_IS_SERVER_GATED = false` flag to flip. **Migration lane dispatched.**
(The AFTER half already works and is enforced by `rpc_helper_mark_done`.)

### NEW — the 320 truncation gate has a hole
`e2e/happy-path/activity-card-density.spec.ts` sweeps `[data-job-action-chip] span`, but the four
self-drawing row controls — Directions, SOS, Share, and the new capture chip — carry no such hook,
so they sit OUTSIDE its inventory. Its own comment ("SOS is a SosShareButton, not a JobActionChip,
so it carries no hook") is still accurate but now describes a bigger hole. Add the attribute.

### TIGHTEST ROW IN THE APP — needs the lead's eyes at 320
Helper **Disputed with a photo owed**: four 44px icon chips leave the primary ~56px; "Withdraw"
measures ~50px at 11px. **Inside by 4px.** If it breaks mid-word, drop the capture chip from the
dispute card (one line in `DisputedSection.tsx`).

### DONE 2026-09-19 — the guest marketplace is lit again — commit `94fd5b639`; issue #1617 CLOSED
Queried **AS ANON** (publishable key, no service role), before -> after:
`open_jobs_browse` `content-range: */0` -> `*/8`; `get_open_jobs_for_map` 8 rows;
`get_public_open_jobs` (landing teaser) 6 rows; `guest-listing-horizon.mjs`
`FAIL … ALREADY DARK` exit 1 -> `OK: 8 listing(s) today, 8 still standing in 3 day(s)` exit 0.
Signed-out `/browse` rendered off a local `vite preview` of the build (NOT Vercel, per
`noTestTrafficOnVercel`): 8 cards at 1440 and 375, 8 categories, 8 Louisiana cities, no overflow.
Both screenshots looked at and `recordReview`'d.

**8 listings at +31/+45/+59/+73/+88/+102/+117/+131 days.**
- **+31 minimum** because the horizon check warns 3 days out and runs at worst every 2 days
  (Fri->Sun gap) — a month is ten times that, so nobody has to touch this before launch.
- **~14 days apart** because CLUSTERING CAUSED THE OUTAGE: the dead fixtures shared dates and the
  last pair took browse from 2 to 0 in a single cron tick. Now at most one ages out at a time.
- Dates are stored in the catalogue as **days from run, not stamped dates**, so the file cannot
  become the next stale fixture.
- Posters spread 3/3/2 (`enforce_open_job_limit()` caps each account at 5 open funded).
  **`poster-e2e` deliberately left EMPTY** — it is the account the nightly money loop posts and
  funds from, and filling it would have traded one red for another.
- Non-seed rows created: **0**, verified by query.

STRIPE TEST-MODE PROOF, recorded in the database rather than asserted: all 8 rows'
`stripe_session_id` begin `cs_test_` (a live key only mints `cs_live_`). The minter also refuses to
type a card into anything but a `cs_test_` session and logged that guard on all 8.

ANON LEG RE-RUN GREEN (run 35462626219): `Anon surface contract` OK, `Uncovered real-backend
surfaces` OK. #1617 auto-closed by the sync step with the full root cause — **the clock, not the
code**: the SAME SHA `12fcd8541` was green at 03:34 and red at 15:26, because `auto-expire-jobs`
(jobid 16) killed the last funded pair at 05:00:00.745.

**The horizon check WAS already wired** — `.github/workflows/e2e-real-backend.yml:195`, `anon-surface`
job, `if: always()`, on every push, every PR, and Sun/Mon/Wed/Fri 11:17 UTC. Worst unrun gap 2 days
against a 3-day horizon. NOT duplicated; only its failure message now names the refill command.
**But it has never executed in CI** — it is unpushed, and the green run predates it. Its first real
run lands on the next push.

**DO NOT remove these listings before launch** — removing them recreates the outage. At launch they
vanish on their own when `seed_jobs_hidden_publicly` flips to `true` in
`platform_settings.feature_flags`; no deletion needed. If they must be destroyed, refund each `pi_`
on the Stripe TEST dashboard first (each holds $96-$240 test escrow) — full id/PI table is in the
second comment on #1617.

### DONE 2026-09-19 — the 320px primary collapse (SHIP BLOCKER) — `70d276587`, `f0a34dab6`
THE MEASUREMENT THAT WAS NEVER TAKEN: the row is `[data-job-step-row]`'s own width, NOT the
viewport — 108-113px of page + card + step chrome. **212px @320**, 262 @375, 1035 @1440.
```
3 chips @320: 212 − 132 − 18 = 62px  OK
4 chips @320: 212 − 176 − 24 = 12px  BROKEN   <- the doc block claimed "~56px", from a row width of
                                                 256 that was STATED AND NEVER MEASURED
5 controls at the 44px floor need 5×44 + 4×6 = 244px > 212px
```
**WORSE THAN THE BROWSER PASS FOUND:** poster `disputed` (5 chips) also gave a **12px primary at
375**, and the GPS-retry pair got 53px against a ~55px need at 375 — both unreported, because the
browser pass forced different states there. **375 was not fully correct.**

THE FIX — the honest one: five labelled controls do not fit in 212px and no shape-work makes them,
so the row KEEPS ITS SHAPE and loses a control. `allocateJobStepRow` computes capacity from the
measured row width (every chip at 44px, the primary at its own longest word); chips that do not fit
move into a new `JobStepOverflowChip` ("More", Radix Popover, 2-up grid inside). **Nothing is
dropped.** It does not reintroduce a second shape because the overflow chip IS one of the chips —
same class, tone, 11px label, icon-above-label, 44px floor — and takes one chip slot.
`index.css` also floors `min-width: 44px` on every row child (verified in `dist/assets/*.css` after
build, not the dev server): last-ditch, so a stale measurement clips inside the card's own
`overflow-hidden` rather than painting a 12px control.

**THE DOUBLE-PRIMARY DIAGNOSIS WAS WRONG IN MY BRIEF, and the lane corrected it.** Capping
`claimPrimary` would have fixed nothing: `JobTracking.tsx:2765` renders `retryEl` and `ctaEl` as two
children of a SINGLE `JobStepRowSlot`, so that row makes ONE claim and a counter sees nothing wrong.
The allocation now reads how many controls are actually in the slot from the DOM and sizes it to
`n × the widest + gaps` (equal flex children, so sizing to the sum still starves the wider one).
29px/27px before -> 78px each at both 320 and 375. Nothing becomes a chip and nothing refuses to
render: losing the GPS retry strands a helper at a failed gate, and "I'm On My Way" / "I'm Still On"
are two distinct commitments.

CHECK `src/test/jobStepRowWidthFloor.test.tsx` — 16 row states, BOTH sides, 3 widths, from a
rendered inventory; asserts nothing lost, every chip >=44px, every primary-slot control >= max(44,
its own longest word), and the total fits. Red-before, which is the shipped behaviour exactly:
```
helper Arrived, unverified @320: "Try My Location Again" gets 53.0px but needs 55.4px
helper Disputed, evidence owed @320: "Withdraw Dispute" gets 12.0px but needs 57.2px
poster Disputed @320: "Resolve & Pay" gets −38.0px but needs 52.2px
```
**ITS FIRST DRAFT SURVIVED ITS OWN MUTATION** — it imported `ROW_CONTROL_MIN_PX` and asserted
against it, the same self-referential failure as the doc block it was written to replace. Fixed in
`f0a34dab6`: the 44 is stated locally and witnessed by reading `index.css` off disk.
375/1440 baselines unchanged (62px and 337px primaries, identical).

### NEEDS AN OWNER LOOK / DECISION
- **Chip ORDER decides what hides.** Overflow takes the LAST chips, so at 320 **Message lands in the
  More panel on BOTH dispute rows** (`[photo, timeline, message, admin]` and
  `[escalate, photos, timeline, message, admin]`). Not reordered — that is an unrequested visual
  change — but Message may deserve promoting to the front.
- **"Try My Location Again" is the widest primary label in the app** (~55px longest word) and is what
  forces the on_site row to ZERO visible chips at 320. "Retry Location" would buy a chip back. Copy
  change, so not made.
- **The More popover itself is entirely unverified** — placement, width, and the 2-up grid inside it.

### DONE 2026-09-19 — Directions gave the town: seed rows held a town — `3a0de5c22`, `1d31b8496`
DIAGNOSIS CONFIRMED, and the code path was clean. `get_jobs_for_my_applications` rewrites `location`
through `CASE WHEN user_may_see_job_address(...) THEN j.location ELSE mask_job_location(j.location)`;
called AS THE OWNER'S OWN ACCOUNT on the job they were most likely looking at, it returned the
location IN FULL. **`mask_job_location("New Iberia, LA")` returns `"New Iberia, LA"` — identical
input and output, which is exactly why a town looked like a mask.** There was no street to return.
BACKFILL: 210 town-only seeded rows -> **257 of 257 now carry a real Louisiana street address**,
rotating 2-4 per city so 124 Lafayette fixtures do not stack on one doorstep. Coordinates moved with
the address ONLY where a point already existed. The 8 funded `cs_test_` listings each got a distinct
real address WITH ITS OWN coordinates rather than a city centroid, so pin and address name one door.
`is_seed=false` rows untouched (0 street addresses, unchanged). **Privacy re-verified after the
backfill:** a pending applicant on a seeded open job still gets `"Lafayette, LA"`.

**THE GUARD FOUND A GENERATOR NOBODY KNEW ABOUT.** I briefed TWO seed scripts;
`src/test/seedFixtureAddressRealism.test.ts` derives its inventory from the world (every file under
`scripts/` that mentions `is_seed` and writes a `jobs` row) and found **SEVEN** — including
`scripts/audit/pressProdSafety.mjs`, which went red on the first run. That is the difference between
a list and a check.

**The en-route address was ALREADY visible** — `JobAddressLine` sits in the ACTION SECTIONS band, a
SIBLING of the `isExpanded` block, proven by rendering the card COLLAPSED in `confirmed` and
`in_progress`, not by reading the JSX. No change needed; nothing handed back to the row-width lane.
A mutation registered as a DELETION killed the guard with a SYNTAX ERROR — worthless proof — so it
was changed to `<></>` so it fails on the assertion instead. Worth remembering as a mutation-quality
rule: a mutation that breaks the parse proves nothing.

### NEW — 37 seed rows pass the address check and still go nowhere
`"100 Audit Way, Baton Rouge, LA 99999"` satisfies `hasStreetAddress()` but the street does not exist
and 99999 is not a Louisiana ZIP, so **Directions on those rows resolves to nothing**. It is typed
into the Street Address COMBOBOX by four e2e specs (`prod-lifecycle.spec.ts:159`,
`journeys/fixtures.ts:264`, `journeys/02-marketplace.spec.ts:227`,
`prod-audit/interruptions.spec.ts:468`), so changing it means re-proving the autocomplete resolves
the new value. E2E lane's call.

### NEW — three "real" prod jobs are actually fixtures
`4c44aa1b`, `c4d3df74`, `24dd5b6b` — all stamped 2026-07-25 18:15:55, all `cancelled`, all town-only,
all `is_seed = false` because they pre-date the flag. **Every `is_seed` sweep counts them as real
user data.** Invisible to browse because cancelled. Worth flipping or deleting before launch.

### NEW — the address runtime check cannot be credential-free
Unlike `guest-listing-horizon.mjs`, an anon reader cannot verify this: `open_jobs_browse` runs
`mask_job_location()` over the exact column being checked, so it needs the service role. It belongs
on the credentialed leg of `e2e-real-backend.yml`.

### DONE 2026-09-19 — review card reorganised + profile tile order — `67e68ab66`
**`PublicReviewWall` IS MOUNTED NOWHERE** — only its own test imports it (`singleReviewList.test.ts`
removed it from UserProfile). The app had TWO review designs and the one with the proper category
chip was dead code, while `/user/:id` rendered the worse one. Both now share
`src/components/profile/reviewCard.tsx`, with the chip and star row MOVED character-for-character
(`data-testid="public-review-category"` kept so its 14-case suite still passes).
**"Cleaning" was the CATEGORY, not a job title:** `useUserProfileData.ts:699` sets
`jobTitle: formatCategory(r.job_category)`, so the field is a misnomer on that path and was being
printed as `For: …` prose. `job_category` is populated 17/17; the "zero rows" note in
`PublicReviewWall.tsx:262-265` was about a client-side fallback that is not the path in use.
NEW ORDER: name -> stars + CHIP -> highlight -> prose -> date. Star row gained
`role="img" aria-label="5 of 5 stars"` (ReviewsSection announced nothing before).
**THE HIGHLIGHT IS HONEST, not summarisation:** `reviews` has no tags column —
`ReviewForm.toggleQuickOption` (and a byte-identical duplicate in `CompletionPrompts.tsx:121`)
concatenates quick-tags into `feedback` with `", "`. `splitReviewTags` peels a TRAILING run of parts
matching the known vocabulary and rejoins the rest identically; mid-sentence "On time, but the gate
was left open." stays prose. No model call.
Tile order now Rating · Jobs completed · Jobs posted · **Worked together** · Cancelled.

### NEW — HIGH (fairness): the profile stat tiles use THREE different denominators
On `437de07d`, reconciled exactly against prod:
- "Jobs completed 17" = `completed_jobs_as_helper` — completed only, **helper side only**
- "Jobs posted 7" = `posted_jobs_total` — **all statuses**, poster side only
- "Cancelled 35 of 70" = `jobs_total` — **all statuses, BOTH sides**
So nothing reconciles with anything on screen. Worse: **32 of the 35 cancellations are helper-side —
jobs the POSTER cancelled, counted against this person.** That is precisely the defect class the
card's own comment gives as the reason "accept rate" was deleted: *"a tally of other people's
decisions rendered as a property of this person."* Today every one of the 70 is `is_seed`, so the
50% is an artifact — **but the denominator problem is real and will brand a genuine Helpr as 50%
unreliable for other people's choices.** REPORTED, NOT FIXED: picking a denominator is a product
decision. **Owner call needed.**

### NEW — `[SWEEP]` prefixes are stranded prod data
14 of 17 prod reviews carry `[SWEEP]` / `[E2E DO NOT ACCEPT]` / `SEED` prefixes and **no live writer
of those strings remains in `scripts/`** — leftovers from a retired sweeper. Not fixable display-side;
needs a one-off cleanup or the seed-flag flip already tracked above. Stored content was not rewritten.

### NEW — quick-tags are concatenated into the review body (write-path)
The durable fix is a `tags text[]` column plus a write path that stops joining them into `feedback`
— and **two byte-identical implementations to converge** (`ReviewForm.toggleQuickOption` and
`CompletionPrompts.tsx:121`). Schema change, so reported not done; the display-side recovery above
makes the card read correctly meanwhile.

### ~~DONE 2026-09-19 — the "1634 mi" pill: an IP-geolocated origin~~ — MISDIAGNOSED, superseded by `030315f6e`
**ROOT CAUSE, PROVEN: the origin was MENLO PARK, CALIFORNIA**, written into the OWNER'S OWN profile
today. Live on prod: `lexilombas05@gmail.com` -> `latitude 37.47282350893211`,
`longitude -122.2443517921565`, `location_captured_at 2026-09-19 21:00:08+00`, while `zip_code`
says `70528` (Erath, LA) and `parish` says Vermilion.
`haversineMiles` from that point reproduces ALL FOUR displayed values to the mile — Caddo 1633.74
(saw 1634), Iberia 1813.15 (1813), Lafayette 1796.52 (1797), Calcasieu 1731.37 (1731). The lane also
solved for the origin INDEPENDENTLY from the four screenshot values before querying prod and landed
at 37.3972/-122.2561, rms 0.29 mi — the same place. **The maths was never wrong.**

**HOW IT GOT THERE — worth remembering, it is a whole bug class:** a browser that can see no GPS, no
Wi-Fi and no cell does NOT call the geolocation ERROR callback. It calls **SUCCESS** with a position
derived from the egress IP. `useUserLocation`'s `onSuccess` never read `coords.accuracy` and never
asked whether the answer was anywhere this app serves, so a ~50km IP guess was cached as a device
fix and `persistUserLocation` wrote it into the two columns whose own header says *"A PRECISE DEVICE
FIX, and nothing else"*. Every later load re-read it through `deriveFallbackLocation` branch 1 as
`source: "profile", approximate: false`. The 27h 6m was a REAL MapKit route for that distance.

FIX: `isPreciseFixAccuracy` (10 km — above every radio fix: GPS <50 m, Wi-Fi 20-3000 m, cell 1-5 km;
below every IP answer) and `isWithinServiceArea` (Louisiana + 2°, so Houston/Jackson/Mobile/Little
Rock pass, Dallas/Memphis/California do not). Gated BEFORE the cache write and the profile write, and
ALSO on the READ side of `deriveFallbackLocation` branch 1 — the poisoned row is already written and
the user cannot clear it.
**The destination is ALWAYS a parish centroid** (`open_jobs_browse` masks coords), so this pill could
never mean a measurement. It now renders `~230 mi` **in the pixels**, not only in the aria-label.
That makes the honesty structural rather than dependent on an `approximate` flag surviving a prop hop.

SANITY BOUND, measured not guessed: **500 mi / 720 min**, returning **null rather than clamping**
(a clamped "500 mi" is still a false claim). Widest pair of parish centroids — the widest trip this
pill can describe — is Caddo<->Plaquemines **329.4 mi**; Louisiana's bbox diagonal is **421.7 mi**.
500 leaves ~80 mi of slack past the diagonal so a viewer just outside the state line still gets a
pill. The reported values were 3.3-3.6x the bound. The ETA bound lives inside `useDrivingTime`, the
single funnel both surfaces pass through.

**PRE-EXISTING, and today was simply the first time it had an origin to go wrong with.** Of **60**
profiles on prod only **4** carry coordinates: the three seeded test accounts sharing one Baton Rouge
point, and the owner's — stamped today. **The owner is the only real account that has ever had a
persisted origin.** So the chip had no origin before, not (as I hypothesised) no job coordinates —
the VIEWER side was what was new.

### ~~NEEDS THE OWNER: the poisoned profile row~~ — WRONG, SUPERSEDED. See the correction below.
The UI is correct regardless (the read-side gate rejects it), but the row still feeds
`get_neighbor_hire_count` (a sub-mile neighbour test), applicant proximity and the saved-search
radius tier **server-side**. One statement clears it, and it targets a REAL account so it was
deliberately not run:
~~`update profiles set latitude = null, longitude = null, …`~~ **DO NOT RUN — SEE THE CORRECTION BELOW. The row is CORRECT.**

### NEW — a lane swept another lane's file into its commit
`51e96257a` ("fix(job time)") contains the distance lane's `plausibleTripMiles` import and `~${…} mi`
lines, landed **without `geo.ts` defining the symbol**, so main failed typecheck until `fecdbf6e7`.
A `git add -A` in a shared tree. This is the `agent-path-slip-contamination` class — verify every
diff before committing, and use `--only` with an explicit path list.

### NEW — same origin-trust family, reported not fixed
`JobTracking.tsx:2224` + `arrivalGate.formatArrivalDistance` render a live-GPS-to-job distance, and
the comment at `JobTracking.tsx:967` records prod on 2026-09-14 showing **"2099 mi from job"**. That
one is a real-fix-to-real-fix REFUSAL distance where the big number is arguably the message, so it
was left alone — but it is the same family.
Also still on the floor: `BrowseTasksFeed.tsx:323-328` reads the hook state and DISCARDS
`approximate`. No longer user-visible (the `~` is unconditional now), but the flag is unused.

### DONE 2026-09-19 — ONE hover/active/focus treatment — `df9467ddd`, `5b1b2c328`, `e30b66950`
Owner's third consistency report. MEASURED BEFORE: **308 controls across 169 files** —
tint `hover:bg-` 122 occurrences with **42 distinct values** (33 on controls), text 73, border 30,
translate 21, opacity 21, shadow 13, scale 13, `active:scale-` 84 with **9** values. The 33 control
tints were four token families x five alphas spelling ONE intent.
**MY EVIDENCE WAS WRONG AND THE LANE CORRECTED IT: only 7 controls actually MOVED, not 13.** Six
were `group-hover:` on a glyph INSIDE a still control; my grep matched `hover:` within
`group-hover:`. Caught with a lookbehind BEFORE any edit relied on it — inverting that would have
flipped the whole rule.

THE RULE: **hover changes the TINT of a control and nothing else.** Two mechanisms chosen by the
SURFACE, never by taste: unfilled -> `.ctl-tint` / `-brand` / `-danger` (closed set of 3 tones);
filled -> `brightness-110` (dark fill) / `-95` (light fill), because a `bg-*` REPLACES a fill and on
`btn-grad-primary` blanks the button out. `brightness-95` darkens, the same direction `.ctl-tint`
moves unfilled controls, so `secondary` stops being a different species from `ghost`.
**MOVEMENT: ZERO translation, none kept.** `hover:-translate-y-px` removed from the primary CTA (the
app's most-rendered control and the single largest source of the complaint) plus its competing bark
glow; `.link-standard`'s lift too. A glyph INSIDE a control may still slide — the target holds still.
**Removing movement cannot change layout:** every removed value was a `transform`, and per CSS
Transforms L1 §3 a transform does not affect layout. Nothing to re-measure.
Touch: the whole treatment sits inside `@media (hover: hover)`, the app's existing convention — a tap
can never strand a tint. Reduced motion: the convention exists (30+ blocks) and is followed, but
honestly there is nothing left to suppress — colour is not motion. Focus folded in: the global
`:focus-visible` (2px `--ring`, offset 2) is now the only ring. `.btn-press` 0.96 -> **0.97** so the
two shared press primitives stop disagreeing by a percent.

**THE GUARD CAUGHT TWO BUGS IN ITSELF — both are today's recurring traps:**
1. The cva arm **read class names out of COMMENTS**: the comment quoting the owner contains a `"`,
   which opened what the scanner took for a string, so it found the removed `hover:shadow-[...]` in
   the prose EXPLAINING its removal and filed the fix as a violation of itself. Comments are now
   blanked with offsets preserved.
2. The stylesheet arm **SURVIVED its own mutation**: `([^\n{}]*:hover)(?![^{}]*\s)` had a negative
   lookahead for whitespace after a selector that is ALWAYS followed by whitespace — it matched
   nothing, asserted against an empty list, and passed on real code throughout.
RED BEFORE: 6 of 9 assertions failed (`adhocTint 105 · press 110 · move 13 · notTint 31 · ring 4 ·
adhocBrightness 2`). Cascade verified by hand against `dist/assets/*.css` after build (jsdom has no
cascade); the byte offsets are recorded in the test header because the design depends on the
unlayered `@media (hover:hover)` rule winning over the utility.

### FOLLOW-UP — `src/test/controlInteractionLedger.json`, 147 entries, may only SHRINK
A stale entry fails, and the guard separately requires the rule be adopted somewhere so the ledger
can never just absorb the inventory. By owner: UNOWNED 43, admin 30, profile 27, dashboard 19
(**incl. 6 of the 7 remaining movers**), **activity 15**, postjob 7, messages 6, reviewPanel 2,
userProfile 2. All mechanical: drop the `hover:bg-*` / `hover:border-*`, add `ctl-tint`.
Notable activity entries: `ActivityHeader.tsx:221/237/275/286`, `PostedJobsTab.tsx:151`,
`AppliedJobsTab.tsx:422` and `postedJobs/DeclineApplicantSheet.tsx:87` (`hover:bg-secondary/70` **+
`hover:border-border`** — two treatments on one gesture), `JobCardMetaRow.tsx:290`, plus four
`active:opacity-*` presses. Remaining movers all in `dashboard/**` + `profile/**`:
`IconActionButton.tsx:108`, `JobDetailDialog.tsx:737`, `PhotoLightbox.tsx:346/370/390/434`,
`HelperScheduleStrip.tsx:256`.
REPORT, not task: `.link-standard`'s `transition` still names `transform` (dead entry), and
`.hover\:-translate-y-px` is still emitted (~120 dead bytes) because Tailwind's content scanner reads
the class name out of the explaining comment and the `@mutate` directive.

### DONE 2026-09-19 — the Flexible checkbox was unusable; 0 of 260 jobs carried it — `f1883ef34`, `0f84eb876`, `5ae02e77a`
The control existed and rendered (`LogisticsSection.tsx:419-433`), but **two places disagreed and the
stricter won**: `useJobSubmit.ts:230` treated flexible as a SUBSTITUTE for a time, while
`useJobDerived.ts:210` required `startTime` UNCONDITIONALLY and drove `submitDisabled`. So with
Flexible ticked and no time the CTA stayed **disabled** reading *"Pick a Start Time to Continue"*,
and the submit branch mentioning flexible was **unreachable from the UI**. Hence 0 of 260 flexible
and 184 of 260 timeless. Owner's wording — *"unless they were checked off as flexible"* — is
substitute, so that is what shipped: `(startTime || isFlexibleSchedule)`, the flag threaded from
`usePostJobForm.ts:450` (the hook's only production caller), and the required `*` dropped from the
Start Time label while ticked.
NEW COPY, naming BOTH states so there is no second reading:
> **Flexible Schedule** — any time that day works. Leave Start Time blank, or set one the Helpr can shift either way.
blank + flag -> the flag stands IN PLACE of a time, card renders "Flexible". time + flag -> it stands
BESIDE it as a preference, card renders the clock time (`jobStartTimeLabel` prefers a real time).
Mutual exclusion deliberately NOT enforced — the ask was to SAY what the combination means, not to
outlaw it.

**THE GATE CAUGHT A NO-OP IN ITS OWN WORK.** The `FormStep.tsx` label edit initially **SURVIVED its
mutation**: once `useJobDerived` accepts the flag, `logisticsComplete` is true, the entire
`else if (!form.logisticsComplete)` ladder is skipped, and the start-time branch is never evaluated
— so change #2 is a no-op given change #1. Kept anyway (a label ladder that independently demands a
start time is literally how this bug happened) with a guard asserting the ladder on its own terms,
`logisticsComplete` forced false. In that synthetic state the ladder falls through to
*"That Start Time Has Passed"*, which is nonsense copy — **unreachable today**, reported not fixed.
RED BEFORE: `expected false to be true` on `logisticsComplete`, and `expected 'Start Time *' to be
'Start Time'`. The CTA assertion renders the REAL `FormStep` over the REAL `useJobDerived` and checks
`toBeEnabled()`, `aria-disabled="false"`, the absence of every blocking label, then
`buildJobInsertPayload` -> `start_time: null, is_flexible_schedule: true`. Inventory FLOOR scrapes
the gate labels out of `FormStep.tsx` so a future gate is covered automatically.

### FOLLOW-UP — `is_flexible_schedule` is IMMUTABLE after posting
`EditJobDialog.tsx:93` omits it from `updateData`, so a poster who forgets the box must delete and
repost — the same dead-end class as the bug just fixed. It also allows one inconsistency: a flexible
job whose poster opens Edit and picks a time gets `start_time` set while the flag stays `true` (the
row asserts both; display stays honest because `jobStartTimeLabel` prefers the clock time). The
INVERSE is not reachable — `TimePickerWheel` has no clear affordance, so `start_time` can only go
null->time in Edit. RECOMMENDED: add it, mirroring `hasHelper` (`:231` disables the time wheel once a
helper is assigned — the flexible box must disable the same way), include it in the `scheduleChanged`
comparison at `:90` so `expires_at` recomputes, and keep the `.select("id")`.

### DONE 2026-09-19 — Messages: Active default, Unread tab removed, cancelled threads close, old threads age out — `0c64d4d04`
**ACTIVE WOULD HAVE HIDDEN UNREAD, and the lane caught it before shipping.** Active =
`LIVE_JOB_STATUSES` (`accepted, in_progress, revision_requested, disputed, pending_approval`) —
**`open` is NOT live**, so an applicant's unread question on a job you have not awarded — the most
common unread a poster gets — would not be in the tab the app now opens on. Worst on phone, where
the strip is behind a disclosure so the counts are not even on screen, and there is no Unread tab
left to fall back to. MITIGATION: a banner on Active, *"N unread conversations aren't in Active —
show all"*, shown only when something is genuinely concealed. `hiddenUnreadCount` is derived from
the SAME predicate the Active branch filters by, so the two cannot drift.
**The "Show All" empty-state button was already a NO-OP** — wired to `DEFAULT_INBOX_TAB`, which as of
today IS Active. New `UNFILTERED_INBOX_TAB` separates the two. Fixed and guarded.
`inboxDefault.ts`'s header now records **two distinct removals of Unread** so they are never
conflated: 2026-08-30 removed Unread-WHEN-UNREAD as the default RULE (it moved with read state);
2026-09-19 removed the Unread TAB (redundant). Active is a function of job STATUS, not of what you
have read, so reading or replying never relocates the landing tab.

**CANCELLED THREADS NOW CLOSE IMMEDIATELY** — migration `20260919220233`. The bug, verified live:
`job_messaging_closes_at` ended `AND j.status = 'completed'`, so a cancelled job returned NULL,
`NULL > now()` is NULL, and `can_message_in_job`'s COALESCE fell through to `true` — **open forever.**
Now a `CASE`: the `completed` arm is BYTE-IDENTICAL to what shipped; `cancelled` returns
`COALESCE(cancelled_at, updated_at, created_at)`. Prod has **97 cancelled jobs, 0 with a null
`cancelled_at`** — the guard is written anyway because "zero right now" is not a constraint, and
`updated_at`/`created_at` are NOT NULL so the arm can never reach the fall-through.
**`get_messaging_closes_at` carried the same completed-only filter** — fixing only the gate would
have left the composer offering a Send the server refuses, the fail-on-tap anti-pattern this codebase
has rejected. Both moved. PGlite 3x verbatim, ACLs identical before/after and matching prod, no DROP,
every REVOKE restated `FROM PUBLIC, anon`, lockfile clean.
**The closed-thread copy was WRONG for a cancellation** — it read *"Messaging ends 24 hours after a
job is completed"*: a false rule about an event that never happened. Now *"This conversation is
closed — the job was cancelled. You can still read everything here."* The refusal path **re-reads the
job status** rather than trusting the one in hand, because the common case is the OTHER party
cancelling mid-compose. **The draft was not lost but UNREACHABLE** (state stayed mounted, composer
flipped) — worse than lost; the unsent text now renders beside the notice under a "Not sent" label.

**AGE-OUT: 44 days, DERIVED** — `REVIEW_WINDOW_DAYS 30` (`can_review_job`, read live) +
`REVIEW_BLIND_HOLD_DAYS 14` (`set_review_visibility`). Day 44 is the last day the product itself can
send anyone back; the 72h dispute and revision windows close far earlier. Anchored on
`messagingClosesAt` (server-derived), NOT `lastAt` — `lastAt` can predate completion by weeks.
**No closing instant -> never hidden** (fail-open). **Unread exempt at any age. Nothing is written;
`thread_archives` untouched** (that is the user's own explicit archive — conflating them would let an
automatic rule silently undo a human's choice). Reachability verified three ways: search deliberately
ignores the rule, All says *"…They're still here — search for the person or the job"*, and a deep
link still resolves and renders its closed state.

**TABS: `Active · All`** (narrow->wide, landing tab first). `inboxFilter` is component-local state,
never persisted, never read from a URL — so nothing else produced `"unread"` — but `coerceInboxView`
maps it and anything unknown to the DEFAULT rather than to `all`: landing on a filtered slice with
the tab lit to say so is honest; silently widening is not.

### >>> FOR THE VISUAL PASS: the unread dot is now the ONLY unread signal, and it is 8px <<<
`w-2 h-2` burnt-sienna dot top-right plus a bolder preview weight. With the Unread tab gone this is
the sole way unread surfaces in the list. **The lane called 8px subtle for that job and did not
change it** (not asked, not its call). Needs an eyeball at 375 and 1440.

## CORRECTION 2026-09-19 — the "1634 mi" diagnosis was WRONG. Commit `030315f6e` supersedes `fecdbf6e7`.
**The owner is genuinely in Menlo Park.** Their exact words when shown the "poisoned row" finding:
*"Yes I'm in Menlo Park rn."* The browser was not guessing from an IP. The coordinates
(`37.47282350893211 / -122.2443517921565`, captured 2026-09-19 21:00:08) are **CORRECT**, the
distances were **TRUE**, and **the row must NOT be cleared**. Every line above that calls it poisoned,
and the SQL that nulls it, are struck.

**HOW I GOT IT WRONG, because the shape matters more than the instance:** the evidence was all real —
the numbers were internally consistent, the origin solved cleanly to Menlo Park, everything
reproduced to the mile. What I never tested was the simplest explanation sitting in front of me:
**that the user had travelled.** I reached for "the data is poisoned" over "the person moved", then
built a gate to enforce that belief and a test to encode it. **A confident diagnosis that never
considers the mundane explanation is how a correct system gets "fixed" into a broken one.**

**AND THE FIX WAS WORSE THAN THE BUG.** `isWithinServiceArea`'s failure path did not fall back to
"unknown" — it fell back to the **signup ZIP's Vermilion centroid**. So the app would have answered a
user standing in California with **Erath, Louisiana**, and fed that invented origin to radius search,
applicant proximity and `get_neighbor_hire_count`'s **sub-mile neighbour test**. Confidently wrong in
place of noisily right. Red-before literally shows it: `expected 29.8732 to be 37.47282350893211`.

**WHAT `030315f6e` DID**
- **`isWithinServiceArea` DELETED**, write side and read side. A latitude cannot distinguish a
  travelling Helpr from an IP guess, so no threshold on it has a correct value.
- **`isPreciseFixAccuracy` (10 km) SURVIVES but is DEMOTED, and the lane was honest that it could not
  verify it:** `profiles` has **no accuracy column**, so whether that fix would have passed 10 km is
  **unanswerable from prod**. What changed is the COST of failing: before, a false negative discarded
  the coordinates and substituted a point 1,600 mi away; now they are kept, cached, surfaced and
  measured from, flagged `approximate`, and withheld only from `profiles.latitude/longitude` — which
  are documented as "A PRECISE DEVICE FIX, and nothing else". Justified by asymmetric cost, not by a
  claim about the data.
- **The bounds keep their NUMBERS and lose their CLAIM.** `plausibleTripMiles/Minutes` ->
  `isCommutableDistance` / `commuteMinutes`. My justification ("no trip this pill can describe exceeds
  the state's diagonal") was true of DESTINATIONS and false of VIEWERS. The repaired one does not
  mention the viewer: **500 mi is a statement about the TRIP** — past it nobody drives to a $120 odd
  job, wherever they stand. It still clears Caddo<->Plaquemines (329.4) and the diagonal (421.7), so
  it can never suppress a trip inside this marketplace. 720 min survives only BECAUSE it is
  conditioned on the first: given a straight line under 500 mi, a route claiming >12h contradicts its
  own straight line, which holds with the viewer anywhere on earth.

**WHAT A VIEWER 1,634 MI AWAY NOW SEES** (rendered, not reasoned): browse card — **no pill**
(`Shreveport · Fri, Sep 25`); job detail Where tile — **`Shreveport · ~1634 mi · Fri, Sep 25`**, the
true distance with no ETA; an in-state control at 12.4 mi is unchanged
(`Shreveport · 22 min drive · ~12 mi`). Reasoning: a "far from you" chip is one global fact stamped on
forty cards. Absence on the scan row plus the truth on the detail sheet is the honest pair — the user
opened that one job and asked. **Nothing claims the location is unknown**, and `userLat/userLng`
reach the component untouched, so the radius filter still runs on them.
`tripDistanceTrustAndBound.test.tsx` was **rewritten, not deleted** — it records the misdiagnosis and
now asserts the corrected rule, plus a regression check that **no module in `src/` reintroduces a
geography gate**. A guard that enshrines a wrong belief is worse than no guard.

### STILL OPEN from this correction
- **The feed-level line is the right answer and was NOT built** — telling a viewer once, at the top of
  the browse feed, that they are 1,600 mi from these jobs is useful exactly once, unlike a per-card
  chip. Outside that lane's ownership. **Assign it.**
- `BrowseTasksFeed.tsx:323-328` drops `approximate`, and that flag is **live signal again** now a
  coarse fix sets it. Nothing is currently dishonest (the `~` is unconditional), but it is the place a
  future surface could quote a 45 km-accurate origin as a measurement.

## OWNER LIVE REVIEW 2026-09-19 (late) — rulings + lanes

- **Search: magnifier moves INSIDE the open field, left edge; ✕ stays right.** Owner
  ruling via pop-up ("the magnifier should move to the left and the x stay"). The
  magnifier stops being a button while open, so the ✕ is the only control in the
  field. Declined: magnifier at far-left of row; magnifier merely first in the icon
  cluster. Fixes BOTH the 3-tap ✕ (26px hit-box overlap at 375, root-caused — the
  state machine was innocent) and the desktop home strip unmounting the count +
  whole icon cluster on open. Lane live.
- **Profile: FOUR tiles always, zeros included** — Rating · Jobs completed · Jobs
  posted · Worked together. Owner picked "0 · Worked together" for the 4th because
  0 is what almost every visitor actually sees. Declined: "Member since", and a
  "varies by viewer" hint. Preview profile = the stranger's view, by definition
  (owner: "the whole point of preview profile is to see what it looks like to
  others") — anything rendering differently under `isOwnProfile` there is a bug.
  Cancelled tile stays DELETED. Lane live.
- **Profile: skills become pills.** Owner picked pills over "one row, no headings"
  and over "drop the headings". SKILLS was plain comma text next to VERIFIED /
  DOING JOBS pill badges — two shapes in one block. Headings stay. Lane live.
- **Profile tabs: no side gutter**, matching Gift Card / Home History. Owner's own
  structural read, likely correct: those two are their own ROUTES, the rest render
  inside Profile's container — two shells, two paddings. Fix in ONE shared place,
  as a prop, never per-tab padding. Lane live.
- **Back buttons: ONE hover, everywhere. SECOND report** — "some have a square
  background on hover, some circle on hover and some move on hover... fix it or i
  wont say it again." Three behaviours in the wild. Inventory from the world, pick
  the shape on evidence (tally), rule lives in one place. Lane live.
- **Loading states: they jump and don't match their content.** Two defects: layout
  shift (skeleton box ≠ real box) and wrong SHAPE (placeholder lies about what is
  coming). Full inventory, measure both boxes per surface, rank worst-first. Lane live.
- **Two addresses on the job card** — full address must REPLACE the city in the meta
  row, not print on its own line. Entitlement is already server-side; client must NOT
  gate on status. Lane live (job-card lane).

### Landed this round, not yet pushed
- Map 7 / list 4: `dismissedJobIds` was applied only inside `BrowseTasksFeed`; the
  map and the header count never knew the feature existed. 8 open − 1 applied = 7
  pins; 7 − 3 dismissed = 4 cards. The LIST was right. One shared registry
  (`src/pages/dashboard/viewerFeedExclusions.ts`) now feeds list, count and map.
  Distance/radius was ruled OUT — `get_open_jobs_for_map` has no distance predicate.
- Search dismiss contract: one activation → closed, query cleared, **focus handed
  back to the trigger**. Focus return was broken on EVERY expanding search — the
  field unmounts under the caret, dropping keyboard/SR users at `<body>`.

### Handed back / still open
- `ScreenHeaderRow` should own an `expandingSearch` slot — three callers hand-roll
  the open state on top of it today. Assigned to the search lane.
- Stale `@mutate` find-strings failing vacuity in job-card WIP:
  `collapsedJobCardIsASummary` (3), `enRouteAddressVisible` (3),
  `dialogCornerLaneIsReserved` (1).

### Lead visual verification 2026-09-19 late (signed in, local dev, prod data)
VERIFIED WORKING, eyes on:
- Map/list/header parity: 5/5/5, then 4/4/4 after one dismissal — all three move together.
- `/my-posts` collapsed cards: dots gone, replaced by `WAITING · No applicants yet`.
- Full street address renders ONCE, where the city used to be. Clean at 375; wraps
  to two centered lines at 320 with the street number intact. Zero page overflow at both.
- Activity tab ORDER correct: Needs You · Waiting · Scheduled · Done · Cancelled.
- Search dismiss on `/my-posts`: one click closes AND returns focus to the magnifier.

NEW DEFECTS FOUND IN THE SAME PASS:
- **Status tab row overflows the phone viewport.** `flex items-baseline gap-4 shrink-0
  min-w-max` measures **372px inside a 320 viewport** (and clips at 375 too): "Cancelled"
  reads as "Ca…" at 375, "Done" as "Do…" at 320. It scrolls horizontally, so the PAGE
  has zero overflow and every overflow guard passes — but there is no scroll affordance,
  so on a phone the last tab is simply invisible. The owner chose this exact five-tab
  order; two of the five cannot be seen on a phone.
- **Desktop Browse search still drops focus to `<body>`** on close (`/my-posts` is
  correct). Sent to the search lane with measurements.
- **`/my-jobs` empty state renders a header bar with no tabs and no title** — just a
  magnifier floating in an empty strip.
- Minor: at 320 the wrapped address is CENTRED while the date beneath it is left-aligned.

### STILL OPEN after the 2026-09-19 late session (pushed @b1ed083bd)

**LOST WORK — REDO REQUIRED.** The search lane (magnifier into the open field,
the 3-tap ✕, the desktop home strip) had reported "all 16 green, pre-fix overlap
proven to return on every surface" but had **not committed**, and its worktree was
removed during cleanup while it was still running. The work is gone. The SPEC
survives in full, above, under "OWNER LIVE REVIEW 2026-09-19 (late)" — redo it from
there. Root cause of the loss: a resumed lane was treated as finished during a bulk
worktree cleanup. Lanes must commit before any cleanup touches their tree.

Known, measured, unfixed:
- **Status tab row overflows the phone viewport** — 372px inside a 320 viewport.
  "Cancelled" clips to "Ca…" at 375, "Done" to "Do…" at 320. It scrolls, so the page
  reports ZERO overflow and every overflow guard passes; there is no scroll
  affordance, so two of the owner's five tabs are invisible on a phone.
- **Desktop Browse search drops focus to `<body>`** on close (`/my-posts` is correct).
- **`/my-jobs` empty state** renders a header bar with no tabs and no title.
- **TabFallback stands in for all 23 Profile tabs** with one 230px placeholder —
  `home_history` lands 3359px taller, `gift_card` 1230px. Needs per-tab reserved
  heights; owner-visible tradeoff.
- **Two different components are both named `JobCardSkeleton`** (SkeletonLoaders.tsx
  and ui/skeletons/), different shapes, so /dashboard paints two unrelated skeletons
  in sequence before content.
- `ApplicationCardSkeleton` vs `JobCardShell` (/my-jobs, −52px); `/user/:id`
  `IdentityHeroSkeleton` (326px reserved, 141px arrives).
- At 320 the wrapped address is CENTRED while the date beneath is left-aligned.
- Dialog-corner WIP was RED and is NOT committed — backed up at
  `~/lh-dialog-corner-WIP-2026-09-19.patch`.

### 2026-09-20 lead visual verification of the overnight lanes
- **Search (`10f00eebc`) VERIFIED at 1440** — tabs stay mounted, magnifier inside the
  field's left edge, ✕ right, ~450px field. Correct, and it is the owner's ruling.
- **Search at 375 was BROKEN on landing** — field collapsed to 95px holding only the
  magnifier and the ✕, no room to type. Routed and FIXED: field now 134 / 189 / 228 /
  448 at 320 / 375 / 414 / 1440, all four measured by the lead.
- **The search lane's work was NOT lost** (an earlier OPEN.md note said it was —
  struck). It survived the worktree deletion, rebuilt in a fresh tree, and landed.
- **Activity tabs STILL NOT FIXED after `e24ed9535`.** The labels now fit, but the row
  is COLLAPSED BY DEFAULT on phone: at 375 and 414 `aria-expanded="false"` and zero tab
  words render; tapping the chevron reveals `You · Waiting · Soon · Done · Cancel`.
  Before that commit four of five were visible; now none are. Same complaint, worse.
  Possible trigger: the selected bucket being EMPTY (plain `/my-posts` = Needs You with
  0 rows collapsed; `?filter=waiting` with 3 rows did not). Reopened in a new lane.
- **`activityTabLabelsFitAPhone` is GREEN on a screen with no tabs on it** — it measures
  the row's WIDTH and cannot see that the row is not displayed. The lane must add the
  visible-without-interaction claim. This is the night's recurring defect class: a
  measurement that is true about an element nobody can see.
- **414 breakpoint contradicts its own contract** — the lane documented short labels
  below 390px and full words at 414; the rendered DOM shows `You / Soon / Cancel` at 414.
- From that lane: `/legal` field was 107px at 320 (pinned, not fixed) — CLOSED 2026-09-20,
  f148bb5c6, 222px at 320 and the pin removed; see the /legal section above. Still open:
  the **Messages empty inbox hides its tabs and search trigger** the same way Activity did.

### 2026-09-20 lead verification of the final two lanes — ALL VERIFIED BY EYE
- **Activity tabs FIXED and confirmed on the BUILT app** (`npx vite preview`, not the dev
  server — the dev server disagreed at 414, which is exactly why the project rule says
  verify CSS against `dist/assets/*.css`):
  375 → `You · Waiting 3 · Soon · Done 1 · Cancel 1`, all visible, nothing clipped.
  414 → `Needs You · Waiting 3 · Scheduled · Done 1 · Cancelled 1`, full words.
  1440 → full words. Zero overflow at every width. Chevron now opens expanded.
- **Root cause of the hidden row was filter IDENTITY, not emptiness** — the disclosure
  seeded `useState(!isDefaultFilter)`, so it collapsed on every arrival. Proven by data:
  `/my-posts` default bucket had 15 rows and still hid its tabs.
- **A TEST FILE HAD DISABLED TAILWIND'S ENTIRE `min-[Npx]:` VARIANT FAMILY.** A guard
  asserting the breakpoint contained an interpolated candidate string; Tailwind scans
  `./src/**` as raw text, so the guard asserting the breakpoint is what deleted it.
  40 of 42 arbitrary-width classes across TEN files compiled to nothing — ScheduleTab's
  whole 1024px desktop layer, Footer's 500/620 grid, NotificationPreferences' 360px rows,
  ScreenHeaderRow's `min-[500px]:block` title, and more. Every source-level guard stayed
  green. **Lead re-verified in the built CSS: all eight arbitrary breakpoints (330/360/
  390/480/500/620/1024/1280) now emit real media queries; before, there were zero.**
- **Gift card gutter FIXED** — 72/24 at 1440, matching all 24 other tabs, eyeballed.
  Root cause: yesterday's fix for the FIRST gutter report added `px-3` and shipped with
  no screenshot. Now structurally prevented: one shared body component taking no
  `className` and no `style`.
- **Loading header stability CONFIRMED** — `h1` present at y=26 while loading AND at
  y=26 loaded. Zero title shift. Previously no header existed during load at all.

### Still open for the owner
- **Profile LANDING sits at a different gutter from its own tabs** — landing `h1` at
  x=145, every tab `h1` at x=72 (cards agree at 24). Same class as the reported defect,
  but the landing is not a tab and was not named, so NOT changed. One line either way.
- **Messages empty inbox hides its tabs + search** — checked and it is NOT the same root
  cause as Activity: that gate is itself the answer to an earlier owner report about the
  thread area jumping 57px when the empty result lands. Two owner positions pull opposite
  ways. Third option, unpriced: reserve the row's height and render in both outcomes.
- `/legal` search field is 107px at 320 — FIXED 2026-09-20 (f148bb5c6): the tab group steps
  aside below 500px, 222px at 320, the `minFieldPx: 107` pin removed so the surface takes the
  shared floor. Verified independently on the production build, both themes, 24 shots reviewed.
- `TAB_TITLES.wrapped` drifts ("Helpr Wrapped" vs "Your 2026 so far") — SEASON lives
  inside the lazy chunk.
- `/my-jobs` applied-card pitch unverified — both test accounts had zero live applications.
- `vacuityGate.test.ts` races `discardedQueryFilters.test.ts` over a fixture in `src/`.

## BURN-DOWN — 129 guards have never been shown able to fail (opened 2026-09-20)

`src/test/vacuity.baseline.json` lists **129 "unregistered" guards** — tests with no
`@mutate` registration, meaning nobody has ever demonstrated they can go red.
**59 of 188 guards are proven; 129 are not.** 69% of the safety net is unverified.

WHY THIS IS THE ROOT OF THE RECURRENCE THE OWNER REPORTED. Owner, 2026-09-20:
"none of these errors should recur. when you say youre fixing it that means youre
fixing it for good." A guard that cannot fail is exactly how a defect recurs while
every check stays green. Four hollow guards were caught in ONE day:
  - a guard asserting a Tailwind class DELETED that class from the build (Tailwind
    scans `./src/**` as raw text) — 40 of 42 arbitrary-width classes dead across ten
    files, every source-level guard green;
  - a 144-entry hand-back ledger keyed on `file:line`, so it rotted whenever an
    unrelated edit shifted a line;
  - the contrast guard pins instance COUNTS, not ratios — items can drop below their
    floor with it still green;
  - the review log lived in `test-results/`, which Playwright wipes each run, and
    `review:report` goes GREEN on an empty log because "zero unreviewed" is what a
    wiped file looks like.
Plus: the vacuity mutation phase never ran in an agent worktree AND still exited 0,
so "shown able to fail" was skipped where most agent work happens (fixed, `73bb54233`).

THE TARGET: 59/188 → 188/188. The baseline may only shrink.

BUCKETED BY RISK (a hollow guard costs most where the blast radius is largest):
    MONEY    4   ← lane live
    AUTHZ   11
    SCHEMA  13
    BROWSE   5
    VISUAL   7
    OTHER   89

THE RULE FOR EACH: make the smallest real change to the GUARDED file that should
turn it red, run it, confirm red, revert, register `@mutate`, remove from the
baseline. **If a guard CANNOT be made to fail, that is the finding** — rewrite it so
it can, or recommend deleting it. A guard nobody can break is worse than no guard,
because it is counted as protection.

KNOWN HOLLOW SHAPES TO CHECK FOR: satisfiable by a comment (strip comments first —
except where the data itself contains comment syntax, which deleted a base64 asset
and hashed the empty string today); a list that is both input and oracle; an empty
inventory passing vacuously (floor every scan); `.includes()` where exact was meant
(`"space-y-4 px-3"` passes `.includes("space-y-4")`); pinning a defect's measurement
so it asserts the bug still exists; interpolating a Tailwind class into an assertion.

### LANE SIZING — owner rule, 2026-09-20 (said three times)
"agents should not go this long. 10 min max." / "do not start on the 188 until the
current agents are done." / "give them shorter tasks and do the stuff you can on
your own."

WHAT KEPT BREAKING IT: briefs bundled N items into one lane (19 admin forms; 21
contrast sites; 11 prod-audit failures; a 3-part structural browse fix). Each was
serial work inside one agent, so nothing landed for an hour and progress was
invisible. Splitting AFTER the fact then caused four collisions, because the
holding lane had already finished the work being split out.

THE RULE:
1. One brief = one coherent change ≈ ~10 minutes. If a list has N items, that is
   N/4 lanes, not one lane with a list in it.
2. Split by FILE TREE so lanes cannot collide; name each lane's files AND the
   other live lanes' files as off-limits.
3. Before splitting an existing lane, ASK IT WHAT IS ALREADY DONE. Four wasted
   runs on 2026-09-20 were all re-briefs of finished work.
4. Queue, do not fan out: 2-3 concurrent max on this 8 GB Mac.
5. Do the small things in the lead session instead of spawning for them.
6. If a job genuinely cannot be cut below 10 minutes (a prod-audit suite run is
   ~1.1h of wall clock by itself), SAY SO and name the irreducible part.
