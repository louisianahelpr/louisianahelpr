# Overnight run — owner asleep from 2026-09-08 ~00:40 PT

Standing instruction (owner, verbatim): "Finish this out autonomously. If you need
anything you can do it yourself. If you have questions hold off until morning but do
not stop bc you are waiting on me always find something to do to finish the full
thing. Orchestrate the right model per lane."

## Decisions already given — do not re-ask
- Take-home stays FLOORED on cards; charge screens exact; the dispute split column is 2dp.
- ONE reputation, overall star only (sub-criteria dropped).
- Two fonts: Bodoni headings, Montserrat everything else. Wordmark stays Montserrat.
  Italics removed everywhere outside Bodoni headings.
- Identity verification ALWAYS required; the pause flag is deleted.
- Application cap = 100/day; per-minute/per-hour and signup caps stay OFF.
  GoTrue's 30/hour/IP platform limit stays as is.
- Ban reach = email + phone + verified-identity fingerprint. Refusal message is PLAIN
  to the user ("can't be created, contact support"); FULL detail to admins.
- Test accounts and fixture jobs STAY in prod (still testing).
- Launch switch stays OFF (seed jobs visible) until the owner says.
- Resend webhook secret: not rotated, owner's call.
- Admin credit-mint: not built.

## Not done, why

### AdminUsers.loadProfiles — narrow `select("*")` and add a page size (lh-perf-deps)
Scoped follow-up, deliberately NOT done in the perf pass. `src/components/admin/AdminUsers.tsx:156`
does `supabase.from("profiles").select("*")` with no column list and no limit.

Measured cost today: **8 rows / 23 KB**. It is a linear-growth risk at ~2.9 KB per
profile row, not a current bottleneck — nothing is on fire.

Both halves of the obvious fix are unsafe as a drive-by:

- **Narrowing the select** without narrowing the type ships a lie. `Profile` is
  `Database["public"]["Tables"]["profiles"]["Row"]` (`adminUserHelpers.tsx:12`), so
  TypeScript would keep asserting every column is present while the runtime object
  no longer has them. `AdminUserDetailDialog` would render `undefined` with no error
  and no type failure.
- **A page size** is worse. `getTabCounts(profiles, isUnseen)` derives all six tab
  counts from the full in-memory array (`AdminUsers.tsx:252`), so paginating makes
  every tab count silently wrong — a fix that reads correctly in review and is untrue
  on screen.

Doing it properly = thread a narrowed row type through ~8 files and move the tab
counts server-side (a count RPC or a view). That is its own pass with its own
verification, not a perf drive-by.

### /admin?view=people API fan-out — premise withdrawn (lh-perf-deps)
Not a latency fix and was not attempted. A throttled request/response timeline shows
the page is JS-gated, not API-gated: content @ 4867 ms, last JS response @ 3975 ms
(zero JS after content), and the 49-call fan-out is not even ISSUED until 4817 ms —
after content is on screen. Collapsing it into one RPC cannot move content time.
Unthrottled it looks the opposite (queries leave at 638 ms), which is how the premise
arose; always trace throttled.

The wasted-work half of it WAS fixed (`08f2c02eb`): `loadStats` ran its 20 queries on
every admin view, not just home.

## Questions to hold for morning
Anything that would change product behaviour in a way the owner has not already
decided. Write them here rather than stopping.

## Rules for every lane tonight
- LOOK AT IT: screenshot, then look. Measure second.
- Re-measure the finding's own number after the fix; a diff is not a fix.
- `git commit --only <paths>`, never `git add -A`; rebase --autostash; push.
- Never `git stash pop` in the shared tree.
- Shots go to the lane's own dir, never the shared scratchpad.
- The lead owns `npm run typecheck` / `vitest`; lanes use `node scripts/parsecheck.mjs`.

## Ban evasion — closed 01:10 (ban-evasion, Opus)
- Reach = email + phone + verified Stripe Identity (no IP/device — parity test refuses them). User sees only "This account can't be created. Contact support at admin@louisianahelpr.com." (403, `retained_ban`); admins get the full record via `enforce_retained_ban` itself, one flag per attempt burst. Fraud console headline no longer "Unknown" for refused signups.
- BUG FOUND AND FIXED (lead, verified live): a pardon never released the fingerprint — `retained_bans` was built for deletion and inherited "never release"; a lifted user was re-banned at the next enforcement point. Now a trigger releases on `banned → active` from all three writers (sweep, admin dismissal, direct UPDATE); deletion-retained rows untouched; stranded rows released by the migration. PGlite 69/69; live 1→0 rows, re-check `banned:false`.
- Self-issued bans refused server-side (22023 with hint); 0 legitimate ones existed.
- Commits ededec184, 1b52588b2; db-deploy green; prod restored (0 retained, 0 flags, 0 banned, 0 fixtures).
- Process: this lane's live ban test used the shared admin account and stalled four lanes for ~9 min — lifted by the lead; fixture users only from here (lane memory saved).

### FOR THE OWNER — identity fingerprint backfill (one command)
Already-verified accounts carry no identity fingerprint (it is captured at verification time). Three qualify — lexilombas05@gmail.com and the two 0902 e2e accounts — and `profiles.idv_session_id` is stored, so `scripts/backfill-identity-fingerprints.mjs` can compute them (hash in-DB via `identity_fingerprint`, salt never leaves Postgres; dry-run by default, `--apply` writes). Not run: it needs `STRIPE_SECRET_KEY` locally (edge secret only) and one of the three rows is your own account. Run: `STRIPE_SECRET_KEY=… node scripts/backfill-identity-fingerprints.mjs` (dry run), then `--apply`.

## Guest sweep — closed 01:25 (sweep-guest, Fable)
22 routes × 375/1440 × light/dark (88 shots, ~/.lh-sweep/guest/shots), every control operated, WebKit A/B on all 11 reachable routes. Baseline: zero horizontal overflow everywhere, only Montserrat + Bodoni loaded, WebKit identical, `--user-text-scale=1`.
Fixed + re-measured: SignupPending lost the marketing Navbar/Footer (`noWebChrome`, 5f9b179fe); 404 wordmark → shared HelprMark (ef608c7a8); selected browse category chip gets the gradient AND the row scrolls to it (was flat tint at x=730 in a 375 viewport, c26d1f88d); guest job preview no longer reserves the apply step's height (552→380 @375, d382b76b6).
Report-only (owner calls): filter band header is sans-bold while every other sheet title is Bodoni italic; toast bodies are Bodoni italic (sonner.tsx:95) so a two-sentence error reads as serif body copy; two page-title sizes (AuthShell 24px vs PageHeader 22.4/24.8); /help vs /legal section cards use two vocabularies; map pin sheet covers the " Maps / Legal" attribution at 375 (MapKit terms); /browse at 1440 has ~600px of empty white under 4 cards with no "that's every open job" line. Dead node: NotFound.tsx:89 eyebrow hidden by index.css. Stale comment DashboardGuest.tsx:512-523.

## Stale prod config (S-006, no code change)
`platform_settings.feature_flags` still carries `boosts_enabled`, `referrals_enabled`, `subscriptions_enabled`, `ai_helpr_assistant` = false, last touched 2026-05-02. Nothing in src/ or supabase/functions reads any of them (only `idv_requirement_paused` and `seed_jobs_hidden_publicly` are live). Subscriptions ARE sellable. Left in place — deleting keys from the live row is an owner call; one `update platform_settings set feature_flags = feature_flags - 'boosts_enabled' - …` clears it.

## TC-008 — split payout state, CLOSED 01:40 (money-tc008, Opus)
- What happened: the nightly money loop's `release-payout` sent Stripe transfer `tr_3UDDZQKp2H4b7tEC13IlnQEy` ($22.00) and then its post-transfer `jobs.update(... released)` failed. Real error (function_logs): **57014 "canceling statement due to statement timeout"** — the project was saturated 01:10–01:19Z (a 57014 every ~15 s in postgres_logs) and PostgREST's `authenticator` role carries an 8 s statement/lock timeout. The UPDATE itself is 22 ms.
- Why it stayed broken: the duplicate-transfer check returned 409 forever, so the admin Release button and auto-release Phase 2 could never heal it. Split state was reachable only by hand SQL.
- Reconciled live: job `0021b7d3…` `payout_pending → released` by the function's own guarded UPDATE (1 row); amounts agree three ways ($25 budget, 12% = $3.00 / $22.00; ledger row; Stripe).
- Fix `506045e97`: post-transfer flip retries on transient codes only (57014/55P03/40001/40P01, 400/1500/4000 ms) and fails loudly first-try on zero-row or any other code; a settled transfer now HEALS the flip and returns 200 `already_paid:true` (Stripe never reached, no second transfer). 38/38 edge tests incl. the new retry/no-retry cases. Deployed bundle fingerprinted (run 34176869465).
- Proven: money loop re-run 34176932229 ALL GREEN — transfer `tr_3UDDteKp2H4b7tEC0bXrRKfK` sent AND job flipped in one invocation.
- Also fixed there: `e2e-real-backend.yml` queued dispatches were silently evicted by any push to main (one pending run per concurrency group); schedule/dispatch runs now salt the group with `run_id`. Survived a push while queued on its first outing.
- Follow-up in flight: `process-scheduled-payouts/index.ts:843` has the identical unretried flip — being ported now.
- Follow-up DONE `0aff308a2`: the flip now lives in `_shared/releaseFlip.ts` and both `release-payout` and `process-scheduled-payouts` import it (both local copies of RELEASABLE_PAYMENT_STATES deleted). The cron's dead end was worse — it logged "Payout already exists; skipping" and recorded a HEALTHY result over a stranded job; it now heals single-helper jobs (`healed:true`) and deliberately refuses group jobs (one roster row cannot prove all N are paid). 17/17 + 498 edge tests; deploy 34177465841; loop re-run 34177741446 green (`tr_3UDE87Kp2H4b7tEC0jiGBcct`, flipped in-call). Harness note: `src/test/edge/harness.ts` mocks every `_shared/*` import by default — a new shared guard is silently a double unless passed through, as releaseFlip now is.

## Poster sweep — interim (sweep-poster, still running)
Five fixes pushed and re-measured: My Posts search-miss CTA → "Clear search" (6fc5496a4); applicant list held a skeleton until ranking signals land instead of badging an unverified helper "Recommended" for a second (355d9661c); unbroken tokens in descriptions wrap (8bafa7d39); City field no longer truncates "Baton R" at 375 (f41f556d3/228a81ea7); AI Job Builder's raw `AI service error (503): [{…` toast → human retry copy (2b766fda7, upstream 503s 1 in 4).
Leads routed: push-permission toast covering modal headers → sweep-dialogs; Applicants panel 3-hop waterfall (~7 s skeleton) → perf follow-up list; **test rows leaking into the budget hint** ("Jobs like this pay $25–$25 · Based on 15 completed jobs" = 15 E2E jobs) → `seed-derivation` lane (Opus) in flight: jobs.is_seed derived from the account at insert, backfill, RPC excludes seed, spec assertion updated.
Owner calls: `formatPrice` floors gross budgets to whole dollars while CurrencyInput accepts cents ($4,999.99 renders "$5,000" on cards; checkout is to the cent) — keep the floor or show cents? IDV gate fires only at "Continue to Payment", after the whole form is filled — move it earlier?

## Dialogs sweep — interim (sweep-dialogs, still running)
- **VD-001 (80a3f01b4): TermsReconsentDialog could NEVER open** — eligibility read `!profile.ban_status`, but the column defaults to `'active'` on every row, so re-consent to updated Terms never fired for anyone. Fixed; the stripped Terms/Privacy body restored.
- f6aafee84: NavQuickMenu centring/clamp + keyboard focus; popover collisionPadding; date-picker name.
- Reported: guest /browse JobCards on DashboardGuest are click-only divs (no role/tabIndex/aria-label, no Link wrapper — Jobs.tsx wraps the same variant in a Link) so keyboard/VoiceOver users cannot reach any job pre-signup; guest feed shows skeletons ~5–6 s vs ~1 s signed in (perf follow-up).

## Two more launch-grade defects found by the sweeps, lanes in flight
- **Mark-as-read dead since 2026-08-30 (HIGH, sweep-poster, verified live).** The client wrote `{read, read_at}` on messages but the column-scoped `GRANT UPDATE (read)` (R11) was never widened when `read_at` was added, so every call was 42501 — the unread badge always came back. Client now writes `read` only (d7639cdc4); CLOSED `5bf791616` + `50e531eb5` (db-deploy 34179135124, 34179344891): a BEFORE UPDATE trigger stamps `read_at` when `read` flips false→true — column privileges check the SET list, not what a trigger assigns, so the client never names the column and a receiver cannot backdate their own receipt. Live: `{read}` → read_at stamped; `{read, read_at}` still 42501. The lane caught its own first version reverting a service_role backfill (true→true update) and fixed it in the second migration. **Why it ran nine days unnoticed:** the ONE row error_logs holds for it (2026-09-02) reads `[object Object]` — the report() bug fixed today. Six more `[object Object]` rows came from PaymentSuccess tonight even though the live bundle carries the fix; the fall-through now names the object's constructor and keys (`4173983a3`).
- **Two RPCs re-run their masking ~100× per row (sweep-helper, measured live).** `(r.rec).*` expands per output column; `get_jobs_for_my_applications` = 1,135 ms for a helper with 26 applications vs 21 ms with the record in FROM. Under load the "Applied" bucket of My Jobs 500s (57014) — the same timeout class that stranded TC-008. CLOSED `e0e2542c1` (migration 20260908020801, db-deploy 34179154822): exactly the two functions matched; jobs has 108 columns and 887/8.8 = 100.8× — the ratio IS the column count. Prod after: **887 ms → 8.8 ms**, 18,688 → 391 buffers, zero-row symmetric difference between old and new forms on live data (masked branch covered), grants byte-identical. `get_my_pending_direct_offers` had zero live rows so it was A/B'd on a synthetic 26 (974 → 10 ms). Lesson: the planner inlines the single-row lateral into the target list, so it vanishes from EXPLAIN — nothing to blame, the time hides in the Nested Loop.

## The Test workflow was red on every push since the silent-catch rule landed

`d8cc1c7e6` made `local/no-silent-catch` an error and built its 68-file ledger
from `src/`; `npm run lint` is `eslint .`, which also covers `api/`, `e2e/` and
`docs/`. Seven catches there had no justification, so **every `Test` run since
01:59Z failed at the ESLint step** — the vitest and db-deploy workflows stayed
green, which is what everyone was looking at. Fixed in `3168dec6f` (each catch
now states its reason inside the block). Also `bbfa816fa`: the seed-flag parity
test's second walker lacked the `.gen.ts` guard its sibling had, so the full
suite failed ENOENT in a clean worktree while the file passed alone.

Clean-worktree gate at `bbfa816fa`: typecheck 0, vitest 329/329 files,
3733 tests. Lint clean at `3168dec6f` (one pre-existing warning in
`scripts/state-review.mjs:408`, unused disable directive — report only).

## Seed-derivation CLOSED — `is_seed` now follows the posting account (`bf9ba7330`)

The Post-a-Job hint read "$25–$25 · based on 15 completed jobs" because
`enforce_jobs_insert_column_lock` hard-set `NEW.is_seed := false`, so a fixture
account's jobs could never be fixture jobs and the nightly money loop's rows
became market data. The lock now derives the flag from `profiles.is_seed`
(still discards the client's value — proven live both directions with a
rolled-back probe). `get_category_price_stats` excludes seed in both queries.

| measured on prod | before | after |
|---|---|---|
| `get_category_price_stats('cleaning')` | 16 jobs, p25=p50=p75=$25 | no row → static fallback |
| jobs `is_seed` | 9 | 73 |
| `[E2E DO NOT ACCEPT]` jobs unflagged | 57 | 0 |

Helper-side lock deliberately untouched: a seed helper on a real poster's job
is a real job. PGlite 14/14 incl. the baseline defect reproduced. Also fixed
the "$25–$25" rendering when min==max (`BudgetSection.tsx`) and the E2E
assertion that had become unsatisfiable.

**OWNER CALL — the 9 stranded `payout_pending` E2E jobs** ($25 × 9, Stripe
test mode, ids c647cec2 62880ba5 a80011e6 448a6898 b2ef542a f9801cc6 69af9cb0
0e723972 1f105d38): they are now `is_seed=true`, so `auto-release-payment`
skips them — which is exactly what the seed exclusion exists for (one such job
once produced 83 HTTP 500s and saturated the money alarm). My recommendation:
**leave them**. If you want them cleared, the sanctioned route is one manual
`auto-release-payment?include_seed=1` invocation; no code change.

## New verified-live leads from the sweeps, now in fix lanes

- **Decided-but-unsettled dispute reachable by money** (sweep-admin, job
  `bb2c3732`, dispute `c7a12050` 50/50, `execution_status='pending'`):
  `rpc_decide_dispute` writes `status='completed'` + `dispute_status='resolved'`
  at decision time, so `get_payout_batches()` offered "Bulk Approve $571.20 for
  12 jobs" containing $158.40 (88%) of a job the decision gives 50% of, and
  release-payout's guard would not block it → double-settle on "Retry
  settlement". Dialog was cancelled, nothing moved. → `money-review-2` (Opus).
- **A helper-opened dispute cannot be withdrawn by anyone but admin**
  (sweep-helper, job `67e8ccfe`): no Withdraw control on the helper side, and
  the RPC itself 403s (42501 "Helpers may not modify jobs.dispute_resolved_at",
  the SECURITY DEFINER UPDATE trips the helper column lock); it also resets
  `status='in_progress'` unconditionally, which would strand a post-approval
  payout. Dispute left open as the repro. → `dispute-withdraw` (Opus).
- **Admin self-ban** locked the seeded admin out of the console tonight
  (`user_bans.banned_by = user_id`); and an "Arrival confirmed" EMAIL to the
  E2E helper FAILED `preference_row_ensure_failed`. → `admin-self-ban` (Opus).
- Report-only: `/admin` renders two `<main>` landmarks (App shell +
  `Admin.tsx:523`) — file is under sweep-admin's uncommitted edits.

## Admin sweep CLOSED (`1c990f06f`) — 25 views × 375/1440 × light/dark = 100 shots

Zero horizontal overflow on every capture, no NaN/undefined/[object Object],
every destructive dialog names amount and party and cancels clean. Nine fixes
pushed (job-report "View Profile" went to `/user/<job-id>`; decided-unsettled
dispute card still offered Decide/Quick Release/Quick Refund; "Users with
codes 41" on 8 profiles; Dashboard vs Analytics "Payments Collected" differed
by the customer-fee sum; audit-log trigger rows read only "op: UPDATE"; Stripe
transfer id never rendered at 375; three 375 wrap defects). Shots in
`~/.lh-sweep/admin/shots/`.

Not reached (need populated states the classifier will not let a lane seed):
pending accounts, pending credentials, IDV review, open exceptions, ban
review, fraud flags, support tickets, broadcasts, expired subscriptions — all
shot EMPTY only. The payout-batch "Hold" button never registered a Playwright
click across two passes — **worth one manual tap**.

**Owner calls (report-only, product):**
- Seed handling is inconsistent across the console: Dashboard/Analytics
  exclude `is_seed`, Subscriptions/Payouts/Disputes/Tiers/Users include it, so
  "0 Active Subscriptions" sits one click from "Active Subs 1". Suggest a
  "Demo" badge on seed rows where they are included.
- The seed dispute (no PaymentIntent) is permanently unsettleable and sits in
  the Exception Queue as "$180 stuck" with a Retry that cannot succeed — no
  dismiss / manual-settle path.
- "Payments Collected" counts escrow rows with NO `stripe_payment_intent_id`
  ($5,359.99 of SQL-inserted test jobs counted as collected).
- Low: Delete Account confirm is one click, no typed confirmation; Manually
  Verify offered on an already-verified user; "Emails sent 0/3" beside "31
  TOTAL"; bulk-approve sticky bar covers the last card's amount at 375;
  Flagged queue is 3/5 cancelled jobs flagged for "date passed".
- `disputeSplitPreview.ts` poster column: net > gross (gross from budget, net
  from capture) → `split-preview` lane (Opus).
- "Finish paying" on a declined/abandoned checkout 500s forever in
  create-payment (session id kept in 'abandoned'/'failed', guard refuses) →
  `finish-paying` lane (Opus). sweep-helper's `88d2a40d1` already makes the
  'failed' state render honestly instead of as a healthy "Posted" card.

## Poster sweep CLOSED — 526 shots, 11 fixes on main

Every poster screen at 375/1440 × light/dark, zero overflow on all cells;
checkout reached Stripe and matched the breakdown to the cent ($95.20; Pro
$95.50 incl. $2 setup). Fixes: `6fc5496a4` `355d9661c` `8bafa7d39`
`f41f556d3`+`228a81ea7` `2b766fda7` `d7639cdc4` (read receipts, HIGH)
`c25e4b028` `22a6257af` `b00a419d0` (Escalate was one tap, irreversible, no
confirm) `2a0053892`. Shots in `~/.lh-sweep/poster/shots/`.

Dispatched to `poster-leads` (Fable): shared `UnderlineTabs` overlap at 375;
push-nudge toast covering sheet headers / rail CTA; raw job UUID as support
subject + "Checking your session…" over a usable form; attach-menu copy
("photos and PDFs only") contradicting its own items.

**Owner calls (report-only):** `formatPrice` shows "$5,000" on the card and
"$4,999.99" on payment-success for the same job (whole-dollar rounding of
gross budgets — same family as the floored take-home you already ruled on);
notifications print full names ("Hallie Helper marked the job complete")
where the UI says "Hallie H."; copy addresses helpers only on the Reviews
("the poster's words") and Analytics ("Apply for a job and finish one") tabs —
a role-copy defect by the house rule; IDV gate only fires at Continue to
Payment after the whole form; Applicants panel is a 3-hop ~7 s waterfall.
Not reached: keyboard-open cells, tip/gift-card checkout submits, real
Release Payment, post-job photo/video upload, offline.

## Three money/trust leads CLOSED with numbers

**Decided-but-unsettled dispute could be paid (`317e4c83a`, db-deploy 34181429326).**
There were THREE doors, not two: `get_payout_batches`, release-payout's guard,
and `get_payout_batch_job_ids` — the one Bulk Approve actually turns into
per-job release calls; fixing the display alone would have paid the job
anyway. Both SQL functions gain a `NOT EXISTS` on decided-unexecuted disputes;
`_shared/unsettledDispute.ts` is a fail-closed check in release-payout (a
read error blocks; only "no disputes table" is tolerated). Measured at one
instant on prod with old and new predicates side by side: 11 jobs/$410.40 →
10/$252.00, the excluded row being the $158.40 (88%) of a job decided 50/50.
Live: release-payout on `bb2c3732` as the test admin → **409**. PGlite 12/12
×3. process-scheduled-payouts and auto-release-payment need no change —
their selection filters already exclude this state (checked, not assumed).

**Helper-opened dispute had no exit (`806df5b68`, db-deploy 34181716251).**
`rpc_withdraw_dispute`'s UPDATE tripped `enforce_helper_jobs_column_whitelist`
on `dispute_resolved_at` (42501, live-reproduced as Hallie) — the fourth
instance of the shape `jobsGuardRpcParity.test.ts` exists for. Fix is a
transaction-local GUC bypass set inside the RPC after the opener check (the
`app.arrival_rpc` precedent), NOT a wider whitelist (that would let any helper
stamp their own job resolved with a PATCH). Status is now restored by
derivation (`poster_completed_at`/`payout_scheduled_at`/`payout_pending` →
`completed`, else `in_progress`) — verified against every non-terminal prod
job — instead of the unconditional `in_progress` that would have stranded a
post-approval payout. Helper card gains Withdraw + confirm. PGlite 45/45 ×3
incl. baseline repro; live on `67e8ccfe`: disputed → **completed**,
payout_pending preserved, `dispute_resolved_at` stamped 02:59:17Z.

**Admin self-ban (`6efc163dd`, `70f04f028`) + failed email (`0b74ed9d0`).**
The server half was already live from another lane
(`trg_reject_self_issued_ban`, proven: self-insert → 22023); tonight's
self-bans in `admin_audit_log` are all `[LIVE AUDIT TEST]`/`[FIXTURE]` rows
from before it landed. Still missing: the client control, and the WARNING
tier, which writes no `user_bans` row (only `profiles.ban_status`) and so was
never covered — now refused in BanDialog. The `preference_row_ensure_failed`
email was NOT a grant/RLS problem (service_role has INSERT, verified) but
PostgREST's PGRST002 schema-cache reload window after a migration, with no
retry on our side — **"A schema-cache reload cost a live user their email,
permanently"** — now retried.

## The usage wall (03:02Z) and what I landed afterwards

Every lane hit the session limit within a minute of each other at 03:02Z.
Final reports had arrived from admin-self-ban and money-review-2; the
others died mid-sentence. State at the moment of death, then what I did:

**Landed by the lanes before the wall:** `1dd9059be` (money-review-2 — the
unsettled-dispute gate now has 8 harness tests, incl. the two cases the
live 409 could never reach: `execution_status` NULL blocks, 42703 fails
closed, 42P01 tolerated); `04904056f` (finish-paying — the re-mint's own
double-tap: `expire()` is not idempotent); `617577fcf` (tsconfig include
for `_shared/unsettledDispute.ts`, which had CI red on TS6307).

**Landed by me after the wall:**
- `72e98ba58` — main was RED at `617577fcf` on two repo-wide guards the
  withdraw lane's scoped run never saw: `rpc_withdraw_dispute` discovered
  as an open-job selector (it reads `disputes.status`, a precondition), and
  "Keep It Open" rejected by the popup grammar. Both declared with reasons,
  the shape the registries already hold. This is exactly the
  "verify repo-wide" rule; the lane closed on a green scoped run.
- `c20afc416` — split-preview's finished-but-uncommitted fix: the admin
  dispute card printed `$31.90 refunded` under `$30.00 gross` because the
  two columns used different bases. Each column now reconciles
  (gross − deduction = net) at every slider position; 10 new parity cases.
  **Eyeballed after the reset** (split-eyeball lane, real `DisputeCard`
  mounted through a throwaway Vite entry, deleted after): at 375 and 1440,
  light and dark, the card reads `$33.00 gross / $31.90 refunded /
  −$1.10 Stripe keeps` and `$30.00 / $26.40 / −$3.60 commission (12%)`
  at 50/50, and reconciles by eye at 0/100 and 100/0; net is the
  emphasised line; zero overflow. Shots in
  `~/.lh-audit/split-eyeball/shots/`. One nit for you: the zero side
  prints `−$0.00 Stripe keeps` — a minus on nothing. Left as is because
  four aligned rows per column may be deliberate.
- **Test-admin grant REVOKED** (03:05Z-ish, after admin-self-ban's tests
  went 17/17). Verified live: `user_roles` holds `admin` for exactly the
  two owner accounts and nothing else.

**Died with nothing on disk (re-run these):**
- `poster-leads` (Fable): UnderlineTabs overlap on My Posts at 375, toast
  placement, support subject shows a UUID, attach-menu copy. Had built a
  Playwright driver, no findings filed.
- `sweep-helper`: was at "the poster cancels after hire" — helper-side
  cancel-after-hire state unswept.
- `sweep-dialogs`: helper is unbanned; helper-side dialog survey not
  started.
- `sweep-poster`'s checklist script (fonts/touch-targets/gloss/box-in-box
  per route) never ran.

**money-review-2's design note, reported not done:** `rpc_decide_dispute`
writes `status='completed'` / `dispute_status='resolved'` at DECISION time,
before any money moves; everything shipped tonight is a filter around that.
The clean shape is decision → `disputes` only, `execute-dispute-split` owns
the job transition. It touches AdminDisputes' Decided bucket, two
notifications and `admin_release_dispute` — its own task, state machine
drawn first.

**Still uncommitted in the shared tree, unclaimed by any lane:**
`capacitor.config.ts`, `deno.lock`, `fastlane/README.md`,
`fastlane/ios_app_metadata.yml`, `ios/App/App.xcodeproj/project.pbxproj`,
`ios/App/App/Info.plist`. Left alone.

## Poster leads, re-run after the reset (CLOSED — `0c90334dc`, `51c25da6d`, `a3970e3aa`)

- **My Posts fifth tab** was on screen for no one: five labels measure
  ~382–407px in a ~333px column, the scroller's 4px inset hid "Cancelled"
  entirely, and `/my-posts?filter=cancelled` selected a tab 50px
  off-screen. Scroller now bleeds to the card edge so the fifth label
  peeks, and the selected tab scrolls itself into view. After: Cancelled
  at x 262–334 when selected. **Owner call:** at rest the peek is a sliver
  of "C" — two rows vs a fade mask is yours.
- **Toast vs dock: not reproducible.** Sonner is top-anchored on phone;
  a fired toast sits at y 8–78, the dock at 748–812. No change.
- **Support subject** pre-filled `Dispute on job <uuid>`, clipped
  mid-token. Both producers now use `supportSubject.ts` →
  `Dispute on "Assemble a crib…" (job #3f2a9c1e)`, short id kept so
  support can find the row.
- **Attach sheet** — no role bleed; the footer said "photos and PDFs
  only" directly under Location and Voice note. Now "Photos and PDFs up
  to 5MB."
- Reported, untouched: the attach popover is translucent enough to read
  the thread through it; quick-reply chips clip at its edge with no fade.

Shots: `~/.lh-audit/poster-leads-2/shots/`. Typecheck 0, scoped vitest
141 files green.

## Helper-side surveys, re-run after the reset (CLOSED — `b7a80daa5`, `6772b9505`)

**A. Poster cancels after hire, seen from the helper.** Activity Cancelled
card, notification, its View destination, job detail, Earnings all say
something true (shots A18–A24, light + dark). One fix: the helper's
cancel notification offered a **"Repost"** pill — a poster-only action on
a job they never owned — now "View", landing on the Cancelled bucket.
Messages thread was NOT forceable: no thread exists until an offer is
accepted and the helper fixture has no Stripe payout account.

**B. Every helper-side dialog/sheet** (edit/withdraw application, job
detail, report, profile, delete, log out, messages empty + menu, edit
profile, filters): all PASS at 375 in both themes, zero overflow. One fix:
Edit Profile's ZIP field clipped its fifth digit (scrollWidth 83 in an
80px box) — padding restored.

**Owner calls from this pass:**
- **Duplicate cancel notification** — `poster_cancel_job` inserts one and
  `notify_on_job_update` (trigger) inserts a second, same timestamp,
  confirmed live. Needs a migration.
- **A strike for cancelling a PENDING offer** — the offer was never
  accepted, the dialog says "After a Helpr is selected", and a
  `user_violations` row + `ban_status` escalation were still written.
  Ladder or copy is wrong; money/trust, untouched. (Test rows restored.)
- Helper's Cancelled card is minimal ("Job was cancelled") — name the
  canceller / any fee?
- Outer Edit/Withdraw stay visible while the inline application editor
  is open.
- Both sweep accounts carry an `avatar_url` that 400s → Edit Profile
  shows the "couldn't load your photo" state. Null the two URLs.
- Accept-then-cancel needs a helper fixture with a Stripe payout account.

Shots: `~/.lh-audit/sweep-helper-2/shots/` (51).

## CI after the reset

Main was red on three consecutive pushes for three different reasons,
all mine to catch: two repo-wide registries the withdraw lane never ran
(`72e98ba58`), the admin card spec my scoped run skipped (`5b5b88a19`),
and then a THIRD walker losing the `.gen.ts` race. That race is now
fixed at the source (`5c8fadfbb`): the edge harness writes its temp
modules to a git-ignored `.lh-edge-gen/` at the repo root, outside every
scanner, with its specifiers absolutised. Full suite 330/330, typecheck 0.
