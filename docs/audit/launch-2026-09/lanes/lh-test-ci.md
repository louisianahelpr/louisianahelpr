# lh-test-ci — the safety net itself

Scope: whether critical journeys are covered, whether CI actually runs what it
claims, and whether the guards are enabled and blocking. Worked in
`~/.lh-audit/lh-test-ci` off `origin/main` (b170609a at start).

## What I fixed

- **TC-002** (`e2e/happy-path/apply-single-sheet.spec.ts`) — the spec asserted
  `JobDetailDialog` sits at `top-[7vh]`. Commit `a46d6bdc` (today, 12:29 PT)
  intentionally re-centered the dialog per the owner ("yes it was my call but
  I don't like it"), and the spec was never updated. Result: E2E happy-path
  smoke has been RED on **every** push to main since — 7 failures + 2
  cancelled out of 9 runs, 0 successes. Fixed by removing the stale
  positional assertion and updating the spec's own comment to describe
  current behavior; the real regression guard in that test (the sheet must
  not move BETWEEN steps) is untouched. Verified with
  `npx playwright test --project=happy-path e2e/happy-path/apply-single-sheet.spec.ts`
  against a local build+preview.

## What I found and could NOT fix (outside lane territory — relayed to team-lead)

- **TC-003** (`src/components/dashboard/JobDetailDialog.tsx`) — fixing TC-002
  unmasked a real, live regression the stale assertion was hiding: the sheet's
  top edge moves 66px between the detail step and the apply step (measured:
  detailRect.top=185, applyRect.top=118.6, live Playwright run against
  local build+preview). This reproduces exactly the "opens small then gets
  bigger" bug the owner complained about before 2026-08-31. The component's
  own comment at `JobDetailDialog.tsx:331-333` claims "the panel now reserves
  its poster row and note field from the first frame (see `min-h` below)" —
  but `grep -n min-h` on the file returns nothing. The fix the comment
  describes isn't in the code, likely dropped by `a46d6bdc`. Filed and
  messaged to team-lead for routing to whichever lane owns that dialog.
  Did NOT weaken the spec's own anchor-consistency assertion to force green —
  it now correctly fails against a real bug, and CI staying red on this spec
  until TC-003 lands is the correct state, not a regression I introduced.
- **TC-004** — E2E critical-journey coverage gap, see below.

## CI actually executes what it claims (§6b/6c mandate: prove by execution)

Checked `gh workflow list --all` (26 workflows) — **none `disabled_manually`**.
Checked every workflow file's `on:` block against actual `gh run list`
history, not just the trigger text:

- **`Test` workflow's `${{ runner.temp }}`-in-job-env bug (team-lead's brief)
  is CONFIRMED FIXED**, not still open. `runner.temp` now appears only inside
  a step's `with:` (valid); job-level env uses `$RUNNER_TEMP` via
  `$GITHUB_ENV`, with the fix's own comment explaining why (`test.yml:62-71`).
  Verified against run history: 4 real failures 19:46–20:02 today were a
  genuine lint error (`useState` unused import), not the runner.temp
  validation error; every run from 20:20 onward is a normal pass/fail on
  real content. `gh run view <id> --log-failed` on the pre-fix runs would
  have shown 0 steps/0s if the runner.temp bug were still live — it doesn't.
- **`E2E happy-path smoke`** — see TC-002/TC-003 above. Both `push` and
  `pull_request` triggers present and correctly firing (confirmed via
  `gh run list`, real runs on both `push` events from direct-to-main commits
  and on the PRs that do occasionally get opened, e.g. #1526, #1522).
- **`Supabase DB Drift Detector`** (`check-types-fresh.mjs` gate) — read the
  actual step logic, not just its presence: the `precheck` step **fails
  hard** (not skip) when secrets are missing, with an explicit comment
  explaining why ("a skipped drift check reports as a clean drift check").
  This is the correct shape and is NOT vacuous. Confirmed 5 consecutive real
  `success` runs via `gh run list`.
- **`Lighthouse CI`** — trigger is `pull_request` (path-filtered) + weekly
  cron + `workflow_dispatch`. **No `push: branches: [main]` trigger.** This
  repo commits directly to main for the large majority of changes (`gh pr
  list` shows real PRs are occasional, not the norm — dependabot PRs plus a
  handful of human ones like #1526, #1522, #1516 out of dozens of direct
  pushes). A perf regression landing via direct push gets no Lighthouse
  signal until the following Sunday's cron. This is the SAME failure shape
  CLAUDE.md documents for migration-guard/migration-lint/db-smoke
  ("PR-only in a direct-to-main repo = dormant"), just not yet fixed here.
  Owned by `lh-perf-deps` per PROTOCOL §6b — flagging for that lane via
  team-lead rather than fixing (outside my territory and not a CI-mechanism
  bug, a trigger-design gap).
- **New guard scripts added today** (`check-claude-md.mjs`,
  `check-surface-owners.mjs`, `check-dead-links.mjs`, `check-agent-refs.mjs`,
  `check-types-fresh.mjs`, `check-vercel-config.mjs`) — read all six.
  All are correctly wired (via `lint-staged` on their trigger files, or via
  `db-drift-detect.yml` for `check-types-fresh.mjs`) and, notably, are
  explicitly self-aware of the exact failure modes this brief warns about:
  `check-surface-owners.mjs` derives its surface list mechanically from
  `src/App.tsx` route paths (not from its own OWNERS table, so a new route
  with no entry fails the build — confirmed by reading the derivation code
  at line 156, not just the doc comment); `check-dead-links.mjs` resolves a
  known-good/known-bad self-test before trusting its own link results and
  refuses to report if the self-test fails; `check-claude-md.mjs` and
  `check-agent-refs.mjs` document, in their own header comments, the exact
  two prior incidents (stale AppDelegate claim, nonexistent
  `code-reviewer`/`lh-orchestrator` names) that motivated them. None of the
  six can go vacuous by the "registry checked against itself" pattern.
  `check-dead-edge-functions.mjs` is the one exception worth naming: it's a
  real script but wired ONLY as an npm script (`deadcode:functions`), not
  into any automated gate — manual-only by design, not a defect, but worth
  recording since it means dead edge functions from the removed-features
  list (B2B, time banking, etc.) aren't caught automatically.
- **Flakiness** — checked the last GREEN E2E run before the regression
  (33672653882, 19:19:55) for any test that needed its retry to pass:
  clean, zero retries. `playwright.config.ts:76` sets `retries: 1` on CI,
  which is a real risk (a flaky-but-retry-passing test reports green with no
  visible signal) but I found no live instance of it being exercised in the
  runs I checked. Not filing this as a finding absent an actual case.

## Critical-journey coverage (mapped to specs, gaps filed as TC-004)

| Journey | Coverage |
|---|---|
| Signup / login (incl. social) | `customer-post-job.spec.ts`, `helper-apply.spec.ts` touch login as setup; no dedicated signup/social-login spec |
| Profile completion | Incidental only (`empty-state-sweep.spec.ts`) |
| Post a job | `customer-post-job.spec.ts` — dedicated, good |
| Browse and filter | `browse-feed-completeness.spec.ts`, `guest-feed-progressive.spec.ts` — good |
| Apply | `helper-apply.spec.ts`, `apply-single-sheet.spec.ts`, `apply-dialog-fit.spec.ts` — good |
| Accept a bid | Incidental only (`apply-dialog-fit.spec.ts`) |
| Pay into escrow | 10 specs touch payment/escrow state, mostly as fixture setup rather than a driven checkout — UI-level Stripe test-card flow is `lh-money-escrow`'s territory, not re-audited here |
| Complete | Incidental (`activity-card-density.spec.ts`, `earnings-length.spec.ts`, `overlay-sweep.spec.ts`) |
| Release payout | `earnings-length.spec.ts`, `earnings-views.spec.ts`, `helper-apply.spec.ts` — UI-adjacent; edge-function level is well covered (`release-payout.test.ts`) |
| Refund | **ZERO E2E specs** — TC-004 |
| Dispute | Incidental (`activity-card-density.spec.ts`, `overlay-sweep.spec.ts`); RPC-level logic well covered (`execute-dispute-split.test.ts`, `auto-resolve-disputes.test.ts`) |
| Review | 6 specs touch it incidentally, no dedicated flow spec |
| Message | `messages-thread.spec.ts` — dedicated, good |
| Ban enforcement | Incidental only (`overlay-sweep.spec.ts`) |
| Account deletion | **ZERO E2E specs** — TC-004 |

Unit coverage on money/authz helpers — all three named files exist and are
real: `src/lib/subscriptionTiers.test.ts`, `src/test/mutationRowGuard.test.ts`,
`src/test/migrationVersions.test.ts`. `src/test/edge/` has 27 files covering
the money/webhook edge functions in depth (`auto-release-payment`,
`auto-resolve-disputes`, `execute-dispute-split`, `release-payout`,
`stripe-webhook`, `verification-webhook`, `create-payment`, etc.) — the gap is
specifically E2E (UI-driven), not business logic.

**Sampled assertion quality** (per brief: "do the tests assert the right
thing, not just count files") — `apply-single-sheet.spec.ts` was the sample
that mattered here: before my fix it WAS asserting something real (well
worded, well-documented invariant), just against a value the product had
since deliberately changed. That's a different failure mode than the
"reads a class name instead of computed style" pattern CLAUDE.md warns about,
and worth distinguishing: a spec can be well-written and still go stale the
moment the product changes out from under it, which argues for keeping specs'
"why" comments as detailed as this one's — that detail is exactly what let me
tell in under a minute that the test was stale rather than the app broken.

## Route-change verification (team-lead's ask)

Checked `src/App.tsx` against `e2e/` for the three route changes named in the
brief (seven routes → Profile tabs, `/jobs/:id` signed-in only,
`/pay-it-forward` deleted): confirmed all three are live in `App.tsx` (lines
191/246/255/318-320 redirect to `/profile?tab=*`; `/jobs/:id` wrapped in
`ProtectedRoute`; no `/pay-it-forward` route, comment at :326 explains it's
the `/gift-card` route now). Grepped all e2e specs for bare-path references
to the old routes (`/schedule`, `/availability`, `/saved-helpers`,
`/earnings`, `/warnings`, `/data-rights`, `/pay-it-forward`, direct
`/jobs/:id` navigation) — zero hits. Specs were updated correctly; this is
also exactly what `scripts/check-dead-links.mjs` (new today) exists to catch
going forward, and its own header comment names this same route change as
its origin story.

## Findings filed

- **TC-002** (MEDIUM, blocker flag) — stale E2E assertion redenning CI since
  a46d6bdc. **FIXED** in this worktree, verified via live Playwright run.
- **TC-003** (MEDIUM) — real JobDetailDialog anchor-jump regression uncovered
  by the TC-002 fix. **NOT FIXED** — outside lane territory (dashboard
  component, not CI/test infra). Filed + relayed to team-lead for routing.
- **TC-004** (MEDIUM) — refund and account-deletion have zero E2E coverage;
  accept-bid/ban/profile-completion are each covered incidentally only.
  **NOT FIXED** — this is new-spec-authorship work belonging to
  `lh-e2e-journeys`'s territory per PROTOCOL §6b, not a CI-mechanism defect;
  relayed via team-lead rather than writing new specs myself.
- (Pre-existing) **TC-001** — the vitest `ReactDOM.createPortal` flake filed
  by `main` before this lane started. Investigated the isolation-leak
  question the brief asked about: `vitest.config.ts` uses `pool: "threads"`
  with default isolation, capped at half-cores specifically to avoid the
  documented I/O-starvation flake shape — but a hard `TypeError` on
  `ReactDOM.createPortal` (a shape mismatch, not a timeout) is more
  consistent with a **shared, symlinked `node_modules` being mutated
  concurrently** by another lane's `npm install` (dependabot PRs for
  React-adjacent packages were open in this exact window — `gh pr list`
  shows #1519/#1513/#1512 touching `framer-motion` and a
  production-minor-patch group) than with a genuine module-resolution
  regression in this repo's own code. Did not reproduce it directly (my
  worktree's `node_modules` is a fresh symlink to the same shared tree, so
  reproducing it here would just add more contention, not isolate the cause)
  — recording the hypothesis for whoever picks this up next rather than
  guessing further under this lane's effort budget.

## Coverage manifest

- `gh workflow list --all` — 26/26 workflows read, all `active`.
- All 25 `.github/workflows/*.yml` trigger blocks read directly (not
  inferred from names).
- `gh run list --branch main --limit 100` cross-referenced against triggers
  for `Test`, `E2E happy-path smoke`, `Supabase DB Drift Detector`.
- 6 new guard scripts (`check-claude-md.mjs`, `check-surface-owners.mjs`,
  `check-dead-links.mjs`, `check-agent-refs.mjs`, `check-types-fresh.mjs`,
  `check-vercel-config.mjs`) read in full or in relevant part; wiring
  verified against `package.json`'s `lint-staged` block and the workflow
  files, not assumed from filenames.
- All 24 `e2e/happy-path/*.spec.ts` + 2 `e2e/visual-audit/*.spec.ts` file
  names enumerated; content grepped for critical-journey terms; one spec
  (`apply-single-sheet.spec.ts`) read in full and driven live.
- `src/test/edge/` (27 files) and the three named unit-test files enumerated
  and confirmed to exist.
### UNVERIFIED

- Did not run the full `vitest run` or `npm run typecheck`
  gate — CLAUDE.md's standing rule is that only ONE lane runs the shared
  gate at a time and I did not confirm the gate was free during this pass;
  deferred rather than risk a contended false-negative I'd have to explain
  away. Did not independently reproduce TC-001 (see above — reproducing it
  in a second symlinked worktree adds contention rather than isolating
  cause). Did not audit `Sentry Release`, `A11y (axe)`, `Bundle Size Check`,
  `Mobile viewport spot-check`, `Prod freshness`, `Sitemap drift`,
  `Migration Timestamp Guard`, `Supabase Migration Lint`, `DB Smoke`,
  `Broken Link Check`, `Security Audit`, `CodeQL`, `UI sweep`,
  `Schedule Heartbeat`, or the iOS workflows in the same depth as the ones
  above — each is owned by a named lane per PROTOCOL §6b and I sampled
  rather than re-covering their full depth; spot-checked their trigger
  blocks only (all confirmed to have a `push`/`schedule` trigger, none
  found `disabled_manually`, no further gaps noted beyond what's filed).
