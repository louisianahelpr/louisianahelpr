# Two-account end-to-end test — session prompt

Hand this whole file to a fresh session. It is written to be pasted as the task.

**Why this exists.** Audits of this app have repeatedly reported it clean while
real breakage sat in production. Every one of those misses had the same cause:
the audit *read the code* or looked at a screen instead of *operating* the app,
and when it could not operate the app (no data, no session) it quietly
substituted reading and reported that as verification. The bugs that keep
reaching the owner are all of one kind — **a control that runs and accomplishes
nothing**. A tap that lands is not a feature that works.

---

## The two accounts

Both are seeded and `is_seed = true`. Between them they cover every lifecycle
state on both sides of a job.

| | Account A | Account B |
|---|---|---|
| Name | Audit Weblane | Audit Helper |
| Email | `helpr-audit-web-0824@mailinator.com` | `eli.test.helper@louisianahelpr.com` |
| user_id | `e977a30f-7065-4e75-8498-dba435ac2044` | `6bdc1f67-ae1f-46a0-8edf-4035629a6147` |
| Posts | 7 jobs, every state | is the helper on A's jobs |
| Works | 6 jobs, every state | posts the jobs A works |

Seed rows use uuid prefix `5eed0828…`. Account A's posted jobs are
`5eed0828-0000-…`, the jobs it works are `5eed0828-0002-…`, applications are
`5eed0828-0001-…` (on A's posts) and `5eed0828-0003-…` (A's own).

States present: open/unfunded, open/funded with applicants, awarded, day-of
confirmed, on-the-way, arrived + working, work-done-awaiting-approval,
completed/released, cancelled.

## Signing in — you can do this yourself, without a password

**No password is ever typed, by anyone.** Sessions are minted programmatically
through the Supabase admin API, so the "Claude can't type passwords" constraint
and the standing authorization to self-provision test sessions
(`.claude/skills/lh-audit/SKILL.md` §5) are both satisfied at once: there is
nothing to type.

```bash
node scripts/test-signin-link.mjs poster   # Account A (Audit Weblane)
node scripts/test-signin-link.mjs helper   # Account B (Audit Helper)
```

The script prints a magic-link URL (and the exact `localStorage` blob, with
`--json`). Open the link in the simulator or a browser and the session
persists. It refuses any address that is not one of the two seeded test
accounts above, so it cannot be pointed at a real user.

Under the hood — the same pattern `scripts/audit-capture.mjs` uses, if you need
to inline it in a Playwright harness instead:

1. `POST {VITE_SUPABASE_URL}/auth/v1/admin/generate_link` with
   `{ type: "magiclink", email }`, `apikey` + `Authorization: Bearer` set to
   `SUPABASE_SERVICE_ROLE_KEY` from `.env`.
2. Follow the returned `action_link` with `redirect: "manual"`.
3. Parse `access_token` / `refresh_token` out of the `Location` hash fragment.
4. Write `{access_token, refresh_token, token_type:"bearer", expires_in:3600,
   expires_at, user:{id}}` to
   `localStorage["sb-fncmgoasalhdgfwzhsqa-auth-token"]` before first paint
   (`context.addInitScript` in Playwright).

Still absolute: **never fabricate a session and never present code-reading as
testing.** If a side genuinely cannot be reached even after minting, say so
plainly in the report — that silent substitution is the failure this document
exists to end.

Best arrangement: **iOS Simulator signed into Account A, and a browser signed
into Account B.** One session then drives both sides of the same job and
watches each action land on the other. Mint both links yourself; the owner does
not need to be involved.

---

## Method

Work in an isolated git worktree under `$HOME` (e.g. `~/.lh-e2e-ws/tree`), NOT
`/tmp` and NOT the shared main checkout. Copy `.env` from the main checkout (it
is gitignored; without it the app white-screens with "supabaseUrl is required" —
a known non-regression, not a bug). Run `npm ci` **before** `npm run build:ios`,
or `vite` is missing, the script still exits 0, and the Xcode build fails
confusingly later.

Simulator: `mcp__Claude_Code_iOS_Simulator__control`, device
`10492853-2555-4C57-8542-F555BCEA9865`, 402×874 points. Build with
`npm run build:ios && npx cap sync ios`, then
`mcp__Claude_Code_iOS_Simulator__build` (workspace
`ios/App/App.xcworkspace`, scheme `App`), then `attach`, then `launch`.

Browser: `mcp__Claude_Browser__*` at 375px against a production build
(`npm run build && npm run preview`) — not the dev server, whose timing differs.

**Verify against the database.** Read-only Supabase MCP `execute_sql`, project
`fncmgoasalhdgfwzhsqa`. After any action that should write, confirm the row
actually changed. A UI that says "saved" is not evidence.

---

## The one rule

**For every interaction: record what you did → what you expected → what
observably changed.** If nothing changed, that is a finding, even with a clean
console and no failed request.

Do not report "clicked X, no errors." Report "clicked X; expected the list to
drop to 3 rows; it stayed at 8; no console error; no network request fired."

---

## What to walk, both sides

### Poster side (Account A)
1. **Post a Job** end to end — every entry path (Start Fresh, Repost, Template, Offer to a Saved Helpr, AI Builder). Walk the whole form. At each gate confirm it *names the missing field* rather than presenting a dead disabled button. Stop before real payment; note where you stopped.
2. **My Posts** — each tab (Needs You / Scheduled / Waiting / Done). Expand and collapse a card. Every action in the row: Share, Boost, Edit, Cancel, Applicants, Message. For each: the action fired AND the card's expanded state did not change as a side effect.
3. **Applicants panel** — open it on a job with applicants. Sort. Open an applicant. Accept one, decline another (Account B should see both). Confirm the reach readout renders.
4. **Live tracker** — on an awarded job, confirm the lit step matches the database, and that the progress bar agrees with the lit step.
5. **Confirm arrival** on the in-progress job; check Account B's view updates.
6. **Approve** completed work; confirm payout state changes in the DB.

### Helper side (Account B, or A's My Jobs)
1. **Browse** — filters, sort, category, distance, urgent toggle, saved searches, map/list. Each must actually change the list.
2. **Apply** to an open job; confirm it appears on the poster's Applicants panel.
3. **My Jobs** — every state. Mark on-the-way, mark arrived (this now hits a server-side geofence RPC — confirm the *server* decided, and that a too-far result still records a claim and offers the poster-vouch route rather than dead-ending).
4. **Complete** a job; confirm the gate behaves and the poster sees it.
5. **Directions button** — present on confirmed/travelling states, absent once arrived.

### Both
- **Messages** — open a thread, send a message from one account, confirm it arrives on the other. Mute, block, report.
- **Pull-to-refresh** on every list. Use `touch_path` with eased points, NOT `swipe`. Screenshot **mid-drag** — the frozen-indicator class of bug is invisible at the endpoints.
- **Profile** — every tab loads; Edit Profile saves and persists across a cold relaunch; Preview matches what a stranger sees.
- **Notifications** — panel opens, counts are right, Mark All Read works.
- Every empty state, loading state and error state you can force.

---

## Known traps — do not report these as bugs

- `job_checkins` and `job_tracking` are intentionally empty on seed data. A tracker step depending on them will look wrong *because unseeded*, not because broken. Distinguish the two.
- The app runs on a **test-mode Stripe key** deliberately — real charges are not expected.
- `.env` missing in a fresh worktree white-screens the app. Copy it.
- Background checks are disabled by a feature flag (`BGC_PURCHASE_ENABLED = false`).
- Some CI "cancelled" results are concurrency supersedes from parallel pushes, not failures.

## Reporting

Rank by severity. Every finding carries: exact steps, expectation, actual
result, and evidence (screenshot, DB row, console/network capture). A finding
without evidence is a guess.

Also list **what you exercised and confirmed working**, so coverage is legible
and the negatives are trustworthy. And list plainly **what you could not reach
and why** — an honest gap is worth more than a fabricated pass.

Fix only what is unambiguous and mechanical. Anything touching money, auth,
trust or visual design → report, do not guess (the owner has a standing rule
against unrequested visual changes). Gate any commit with `npm run typecheck`
and `npx vitest run` repo-wide, commit direct to main with trailer
`Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`, push, and confirm CI
goes green — the local gate does not cover Playwright.
