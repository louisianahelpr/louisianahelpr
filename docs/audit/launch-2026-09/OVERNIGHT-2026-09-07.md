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
- **Mark-as-read dead since 2026-08-30 (HIGH, sweep-poster, verified live).** The client wrote `{read, read_at}` on messages but the column-scoped `GRANT UPDATE (read)` (R11) was never widened when `read_at` was added, so every call was 42501 — the unread badge always came back. Client now writes `read` only (d7639cdc4); `read-at-stamp` lane (Opus) is adding a BEFORE UPDATE trigger that stamps `read_at` server-side so receipts work again. The error was reported at severity "warning" and never surfaced — nine days of 100% failure with no alarm.
- **Two RPCs re-run their masking ~100× per row (sweep-helper, measured live).** `(r.rec).*` expands per output column; `get_jobs_for_my_applications` = 1,135 ms for a helper with 26 applications vs 21 ms with the record in FROM. Under load the "Applied" bucket of My Jobs 500s (57014) — the same timeout class that stranded TC-008. `rpc-rec-star` lane (Opus) is fixing every function matching the pattern.
