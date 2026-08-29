# Task: walk every screen of Louisiana Helpr and report what does not work

Paste this whole file as the task for a fresh session.

Repo: `/Users/lexilombas/louisianahelpr`. Read `CLAUDE.md` first, then
`.claude/skills/lh-audit/SKILL.md` — especially non-negotiable #2 (never trust
code over pixel) and #6 ("configured" is not "working" — prove behaviour by
execution).

## Why this task exists

`docs/audit/COVERAGE_LEDGER.md` currently reads **0 WALKED / 27 PARTIAL / 107
NEVER WALKED** out of 134 tracked units. Zero units in this app have a durable
artifact proving they work against real, production-shaped data.

Every serious bug found on 2026-08-27 was found by *operating* the app, and was
invisible to 1,949 passing tests and twelve green CI checks:

- The applicant vetting screen opened **a different person's** profile — wrong
  name, avatar, city, bio, and fabricated trust claims ("You've worked together
  10 times"). No console error, no failed request.
- The hired helper **could not message the poster**, even while en route to the
  job. The backend permitted it; only the client blocked it, and a comment
  falsely claimed the backend enforced the same rule.
- Job-match notifications leaked the **full street address** to every helper who
  matched the category — broadcast, and persisted in notification history.
- **Sort By did nothing** on the unfiltered Browse feed, while working correctly
  the moment a filter was applied.
- Pull-to-refresh **froze after one frame** — the handler ran, the indicator
  never moved.
- The splash screen **never rendered at all** (`launchShowDuration: 0`).

Reading the source found none of these. Operating the app found all of them in
minutes. That is the entire point of this task.

## You can sign in — no password required

```bash
node scripts/test-signin-link.mjs poster   # Account A (Audit Weblane)
node scripts/test-signin-link.mjs helper   # Account B (Audit Helper)
```

Prints a magic-link URL. Open it in the simulator or a browser; the session
persists. **Never type a password** — this script exists so you don't have to,
and it refuses any address that is not a seeded test account.

## Setup

Isolated git worktree under `$HOME` (e.g. `~/.lh-walk-ws/tree`), NOT `/tmp` and
NOT the shared main checkout (other sessions are active there). Copy `.env` from
the main checkout — it is gitignored, and without it the app white-screens with
"supabaseUrl is required" (a known non-regression, not a bug). Run `npm ci`
BEFORE `npm run build:ios` — without it `vite` is missing, the build script
still exits 0, and the Xcode build fails confusingly later.

Simulator: `mcp__Claude_Code_iOS_Simulator__control`, device
`10492853-2555-4C57-8542-F555BCEA9865`, coordinate space 402x874 points. Build
with `npm run build:ios && npx cap sync ios`, then
`mcp__Claude_Code_iOS_Simulator__build` (workspace
`/Users/lexilombas/louisianahelpr/ios/App/App.xcworkspace`, scheme `App`), then
`control` → `attach`, then `launch`.

Browser (for desktop-web-only surfaces): `mcp__Claude_Browser__*` against a
real build (`npm run build && npm run preview`), not the dev server — dev-mode
HMR and unminified code change timing.

Prod has seeded data across every lifecycle state: job uuids prefixed
`5eed0827…`, `5eed0828…`, `5eed0829…`. Browse has 18 funded open jobs spread
across 11 categories, 8 parishes, $45–$400, with 17 carrying coordinates — so
sort, distance, map and filters all have something real to act on.

## The method — assert the RESULT, never the tap

For every control you touch, record: **what you did → what you expected → what
observably changed** (DOM, screen, network, or a database row). **"Nothing
changed" is a finding**, even with a clean console. A click that lands is not a
feature that works.

Cross-check anything that looks empty against the database before believing it.
A dropped Supabase `error` renders as "no data" here — that is a documented
repeat offender in this codebase.

## Scope — work down the ledger

`docs/audit/COVERAGE_LEDGER.md` lists all 134 units. Work through them, and
update each row **only on real evidence**, in a **separate commit** from any fix
(never mark something verified in the same edit that changed it).

Prioritise in this order:

1. **The money path**, end to end, both accounts: post a job → fund escrow →
   applicants → award → confirm → on the way → arrived → working → complete →
   approve → payout. Use Account A as poster and Account B as helper, switching
   between simulator and browser so you can see both sides of the same job.
2. **Cross-account behaviour** — this has NEVER been tested. Message delivery
   between accounts, accept/decline landing on the helper's side, arrival
   confirmation propagating to the poster, notifications actually arriving.
3. **The five bottom-nav destinations** and every control on each.
4. **All 18 Profile tabs** — open each, confirm content loads rather than
   sitting on a skeleton, and that edits persist across a cold relaunch.
5. **Post a Job** — all five entry paths, the full form, every validation gate.
6. **Browse** — sort, distance, map, saved searches, every filter. Note that
   recommendation scoring weights skill above location, and `profiles.skills`
   became fillable again on 2026-08-27, so test with the field both empty and
   populated: they take different code paths.
7. **Edge functions** — 63 of them, none walked. At minimum confirm each is
   deployed and answers (an HTTP status is evidence; reading the source is not).

## What counts as a defect

- A control that does nothing, or needs two taps before responding.
- A filter that does not filter, a sort that does not reorder, a toggle that
  does not persist across a reload.
- A "save" that reports success without writing — re-open the screen and check.
- An error rendering as an innocent empty state.
- A step or button that can never be reached at all.
- Anything visually wrong: doubled card frames, content resizing after open,
  clipped text, retired brand assets, controls not optically centred.

## Rules

Fix only what is unambiguous and mechanical. **REPORT** anything that is a
design or product judgement — the owner has a standing rule against unrequested
visual changes and has been burned by it. Never fabricate a session; if a flow
is genuinely unreachable, say so plainly rather than working around it.

Gate every commit with `npm run typecheck` and `npx vitest run` **repo-wide**
(scoped runs have broken main twice — hard rule). Commit direct to main, trailer
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`, push, and confirm CI
actually goes green — the local gate does not cover Playwright, and a prior
change broke 6 E2E tests while typecheck/lint/vitest were all green.

## Report shape — three buckets, always

1. **Verified working** — only what you actually executed, each with its
   artifact (HTTP status, row count, screenshot path, command output, commit
   SHA).
2. **Defects** — same evidence bar, ranked by user impact, each with steps,
   expectation, actual, and evidence.
3. **UNVERIFIED — could not reach, and why** — every unit in scope you did not
   actually run, one line each with the reason.

Bucket 3 is **mandatory and is a good outcome**. A long UNVERIFIED section is
honest; a short bucket 1 with thin evidence is not. If your only basis for a
claim is reading the source, it belongs in bucket 3.

Run `npm run check:audit-evidence -- <your report file>` before submitting — it
prints claims found / with evidence / without.
