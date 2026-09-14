# Edge `jobs` lifecycle writes with no status predicate — audit 2026-09-14

Scope: the 21 `edge:` entries baselined in `scripts/race-class-baseline.json` on 2026-09-12
as "not yet re-audited" (open item in `docs/OPEN.md`). Each write was read in context and
classified against the live prod schema (read-only: `pg_get_functiondef` for
`enforce_job_status_transition`, `open_dispute_as`, `rpc_escalate_dispute`,
`rpc_withdraw_dispute`, `redeem_gift_card`, `set_revision_deadline`, and the trigger list on
`public.jobs`). No race probe was run against prod for this audit (prod is owned by another
agent); the UNSAFE verdicts are from code + live function definitions, and every fix that
needs a prod race proof is listed at the end.

Result: **11 SAFE, 8 FIXED, 2 DEFERRED** (fix pending in the `dispute-races` branch).

Facts the verdicts lean on (live, prod `fncmgoasalhdgfwzhsqa`):

- `enforce_job_status_transition` runs for service-role writes (only a signed-in admin
  bypasses it) and allows `disputed → completed`, `revision_requested → completed`,
  `disputed → cancelled`, `in_progress → disputed`. It does NOT fire on a same-status write.
- `open_dispute_as` and `rpc_escalate_dispute` change `status` / `dispute_status` and leave
  `payment_status = 'escrow'`; `rpc_withdraw_dispute` restores the pre-dispute status with
  `payment_status` untouched.
- `redeem_gift_card` locks the job, requires `payment_status = 'unpaid'`, and sets `escrow`
  without touching `stripe_session_id`.
- The scanner only reads `.eq/.in("status", …)` as a predicate, so a compare-and-set on
  `payment_status` still shows as a hit. Those go to the new `safe` list with their reason.

## The 21

| # | Location (pre-audit line) | Write | Verdict | Reason or fix |
|---|---|---|---|---|
| 1 | `_shared/releaseFlip.ts:79` | `payment_status: released` + commission | SAFE | CAS `.in(payment_status, [payout_pending, released])` + `.select(id)`; zero rows reported, not retried; never writes `status`. Opaque only via the `...extraFields` spread. |
| 2 | `auto-release-payment/index.ts:384` | `status: completed, payment_status: payout_pending` | **FIXED** | Guard was `payment_status = escrow` only. A dispute (`in_progress → disputed`) or revision request (`→ revision_requested`) during the Stripe round-trips kept escrow, so the cron wrote completed/payout_pending over it and the payout cron would pay the Helpr on a disputed job. Now also `.eq("status", job.status)`. |
| 3 | `auto-resolve-disputes/index.ts:386` | `status: completed, payment_status: payout_pending, dispute_status: auto_resolved` | **FIXED** | Guard was `payment_status = escrow` only. `rpc_withdraw_dispute` (status restored) and `rpc_escalate_dispute` (`dispute_status = escalated`, status still disputed) both keep escrow, so an escalated dispute was auto-paid to the Helpr. Now `.eq("status", "disputed")` + `dispute_status` and `disputed_by` equal to the values read (`.is(null)` when null) + `dispute_deadline <= now` (a withdraw + re-file inside the window gets a fresh deadline, so the ABA case no longer matches). |
| 4 | `create-payment/index.ts:254` (escrow `stampSession`) | `stripe_session_id`, `payment_status: unpaid` | **FIXED** (now in `safe`) | CAS on `stripe_session_id` could not see `redeem_gift_card` funding the job (unpaid → escrow, session id untouched); a card tap racing a gift tap wrote the funded job back to `unpaid` with a live Checkout URL (double-funding). Now also `.or(payment_status is null / in (unpaid, abandoned, failed))`; zero rows falls into the existing re-check, which fails the request. |
| 5 | `create-payment/index.ts:910` (`request_revision`) | `status: revision_requested` | **FIXED** | The transition trigger blocks cross-state writes, but not same-status: a double-tap re-stamped `revision_requested_at`/note and sent a second "Revision requested". Now `.eq("status", "in_progress")`; zero rows re-reads and returns `{success, alreadyRequested}` without a notification, else a clear error. |
| 6 | `create-payment/index.ts:948` (`resolve_revision`) | `revision_completed_at`, `revision_acceptance_deadline` | **FIXED** | Matched on id only: queued behind the undelivered-revision cron or a poster dispute it stamped a 72h acceptance deadline on a disputed job and told the poster "payment auto-releases". Now `.eq("status", "revision_requested").is("revision_completed_at", null)` (null exactly while a delivery is owed — `set_revision_deadline` clears it per request); zero rows re-reads → `alreadyResolved` or error. |
| 7 | `create-payment/index.ts:1120` (`cancel_escrow` claim) | `payment_status: cancelling` | **FIXED** | Already a CAS on `payment_status IN (escrow, cancelling)`; pinned to the status just read (`.eq("status", job.status)`) so #8 can carry the same predicate and a moved job is refused before the refund. |
| 8 | `create-payment/index.ts:1245` (`cancel_escrow` final flip) | `status: cancelled, payment_status: cancelled` | **FIXED** | Matched on id only after the Stripe refund: a dispute opened meanwhile (`disputed → cancelled` is allowed) was overwritten, leaving an open dispute on a refunded job; a chargeback marker likewise. Now `.eq("status", job.status).eq("payment_status", "cancelling")`. Zero rows re-reads: `cancelled/cancelled` is a concurrent retry of the same cancel (success); our `cancelling` claim still held but status moved (a dispute opened mid-refund) forces cancelled on the claim alone (`.eq(payment_status, cancelling)`, key `payment_status+status` in `safe`) and pages ops, because the refund is out and a job left `disputed` would let Quick Release pay the Helpr; anything else is the CRITICAL 500, now also paged to Slack. |
| 9 | `create-payment/index.ts:1844` (`admin_refund_general`) | `status: cancelled, payment_status: refunded` | DEFERRED (UNSAFE) | Id-only flip; a concurrent Quick Release on a disputed job is overwritten. **Fix pending in dispute-races branch** (not edited). Baseline key unchanged (`payment_status+status#2`). |
| 10 | `execute-dispute-split/index.ts:1243` | `payment_status` (+ fee columns) | DEFERRED | CAS `.in(payment_status, [escrow, payout_pending, released, refunded])`, never `status`; the resume states let a release and a refund overlap. **Fix pending in dispute-races branch** (settlement claim; not edited). |
| 11 | `stripe-webhook/handlers/chargeDisputeClosed.ts:147` | `payment_status: payout_pending` | SAFE (race class) | warning_closed unblock is a CAS `.eq(payment_status, chargeback)` + `.select(id)`; the other write is markers only; event-id dedupe. **Not safe as logic** (lh-money-escrow review): it hard-codes `payout_pending` and clears `disputed_at` whatever the pre-chargeback state was — see "Found in passing". |
| 12 | `stripe-webhook/handlers/chargeDisputeCreated.ts:79` | `payment_status: chargeback` (conditional spread) + markers | **FIXED** (now in `safe`) | Decided from a read, written on id only: a payout that settled in between (payout_pending → released) became `chargeback`, hiding a paid Helpr, and a later warning_closed walked it back to payout_pending; a `cancel_escrow` mid-refund was stomped too. Now the block is a CAS `.in(payment_status, [payout_pending, escrow])` + `.select(id)`; zero rows falls to a marker-only write (`dispute_status`, `disputed_at`). |
| 13 | `stripe-webhook/handlers/chargeRefunded.ts:50` | `payment_status: refunded` | SAFE | Only on Stripe's own FULL-refund confirmation, per-event dedupe; `refunded` is ground truth for the charge and overwriting any prior state only stops further money movement. No `status` write. |
| 14 | `stripe-webhook/handlers/checkoutSessionCompleted.ts:817` | `stripe_payment_intent_id`, `payment_status: escrow` (+ tax) | SAFE | Records a captured checkout (Stripe ground truth), per-event dedupe; it must win over local state or captured money loses its only record. A job cancelled while paying lands cancelled+escrow, which void-cancelled-payments refunds; two completable sessions are prevented by create-payment's expire + Stripe check. No `status` write. It also overwrites `stripe_payment_intent_id` on id alone, so an earlier PI id is protected only by that upstream check. |
| 15 | `stripe-webhook/handlers/paymentIntentPaymentFailed.ts:61` | `payment_status: failed` | SAFE | CAS `.or(payment_status is null, eq unpaid)` + `.select(id)`; a stale event on a funded job matches zero rows. |
| 16 | `stripe-webhook/handlers/transferCanceled.ts:61` | `payment_status: payout_pending` | SAFE | CAS `.eq(payment_status, released)` behind the ledger flip for that transfer id. |
| 17 | `stripe-webhook/handlers/transferCreated.ts:80` | `payment_status: released` | SAFE | Ledger CAS (`pending|paid → paid`) gates it, then CAS `.in(payment_status, [payout_pending, escrow, released])` + `.select(id)`. |
| 18 | `stripe-webhook/handlers/transferFailed.ts:64` | `payment_status: payout_pending` | SAFE | CAS `.eq(payment_status, released)` after the ledger row is marked failed. |
| 19 | `stripe-webhook/handlers/transferReversed.ts:67` | `payment_status: payout_pending` + reversal_hold markers | SAFE | CAS `.eq(payment_status, released)`. |
| 20 | `void-cancelled-payments/index.ts:218` (`settleCancelledJob`) | `payment_status` (+ `cancellation_fee_status`) | SAFE | CAS `.eq(payment_status, escrow)` + `.select(id)` with a loud zero-row path, on rows at `status = cancelled`, which has no outgoing transition. |
| 21 | `void-cancelled-payments/index.ts:464` (`markAbandoned`) | `payment_status: abandoned` | SAFE | CAS `.eq(payment_status, unpaid)` + `.select(id)`. |

Rows 16, 18, 19 (transferCanceled / Failed / Reversed) carry no `.select("id")`: a zero-row
match there is benign (the job already left `released`) but silent.

## lh-money-escrow review (REVIEW ONLY, 2026-09-14)

1. should-fix, **addressed**: `cancel_escrow` final flip with a status pin turned "dispute opened
   mid-refund" into a console-only 500 leaving `disputed` + `cancelling` on a refunded job —
   Quick Release (status-only gate) could then pay the Helpr. Now forced to cancelled on the
   claim and paged; every other zero-row outcome is paged too.
2. note: auto-release-payment status pin cannot permanently skip a row (all three reads select
   `status`; every transition it makes is allowed).
3. note, **addressed**: auto-resolve-disputes ABA (withdraw + re-file inside the window) — claim
   now pins `dispute_deadline <= now` and `disputed_by`.
4. note: stampSession predicate is correct for the partial-gift path (job stays `unpaid`).
5. should-fix (pre-existing, not this diff): chargeDisputeClosed warning_closed restores a
   hard-coded `payout_pending` — logged in OPEN.md.
6. minor, **addressed**: a failed re-read in `request_revision`/`resolve_revision` now returns
   the generic retry message; chargeDisputeCreated's markers-only log line corrected.
7. note: `safe` and `allow` are exact-key lists enforced only by the stale check, and a key is
   coarse (`file::columns`): replacing an audited write with an unguarded one of the same shape
   in the same file keeps the key green. Same limitation as the existing baseline.

## The guard after this audit

- `scripts/race-class-baseline.json` now has two lists. `allow` (grandfathered, not yet
  re-audited) holds only #9 and #10 among edge hits. `safe` holds the 14 edge hits that stay
  visible to the scanner but were audited: the 11 SAFE rows, #4 and #12 (fixes that are
  `payment_status` compare-and-sets the scanner cannot read), and #8's claim-only fallback flip.
  #2, #3, #5, #6, #7 and #8's primary flip no longer match at all.
- `scripts/check-race-class.mjs` `compare()` accepts a hit in either list; both are exact keys
  and both fail when stale, so a NEW unguarded write in any of these files is still red.
- `src/test/raceClassGuard.test.ts`: the pre-fix excerpts
  (`src/test/fixtures/raceClass/edgeLifecycleWrites.prefix.ts.txt`, from `a0833ef22`) produce
  all 8 fixed keys; the live files produce none of the status-predicate ones; the
  `payment_status` CAS fixes are pinned by source; dropping any `safe` entry turns the check red.

## Needs a prod race proof (not run — prod owned by another agent)

1. **auto-release-payment** vs `open_dispute_as` on an `in_progress` escrow job with
   `helper_completed_at` > 24h (expect: dispute wins, job stays disputed, no payout_pending).
2. **auto-resolve-disputes** vs `rpc_escalate_dispute`, and vs `rpc_withdraw_dispute`, on an
   expired poster-filed dispute (expect: escalation/withdrawal wins, no auto_resolved flip).
3. **create-payment `escrow`** gift-card tap vs card tap on the same unpaid job (expect: job
   stays escrow, card request fails with no URL).
4. **`request_revision`** double-tap (expect: one notification, second call `alreadyRequested`).
5. **`resolve_revision`** vs poster dispute (expect: no acceptance deadline on the disputed
   job), and double-tap (one notification).
6. **`cancel_escrow`** vs `open_dispute_as` (expect: either refused before refund, or refund +
   loud CRITICAL; never a silent cancelled-over-disputed), and double-tap (one 200 + one 409/200,
   one refund).
7. **`charge.dispute.created`** replayed against a job flipped payout_pending → released in the
   window (Stripe test-mode event; expect: job stays released, markers set).

## Found in passing (not this class; not fixed here)

- `create-payment` `cancel_escrow` never checks `job.status`: any poster can call it on an
  `in_progress` or `disputed` escrow job and get a refund with no reliability ladder. It has no
  client caller. Logged in `docs/OPEN.md`.
- `chargeDisputeClosed` warning_closed unblocks `chargeback → payout_pending` even when the
  chargeback arrived while the job was still `escrow` (work not done). process-scheduled-payouts
  requires `status = completed`, so no money moves, but the job is stranded outside every sweep.
  Logged in `docs/OPEN.md`.
- `checkoutSessionCompleted`'s `metadata.repay === "true"` branch is dead: no path mints a
  session with `repay` (the `repay_escrow` action was removed). Report only.
