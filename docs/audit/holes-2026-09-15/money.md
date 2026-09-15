# Hole hunt — MONEY & ESCROW — 2026-09-15

Lens: every money path (escrow hold, release, payout, refund, dispute split,
sweeps, tips, gift cards, subscriptions, referral/worker-protection credits,
platform fee & tax). Read-only code audit + catalog reasoning; no mutating prod
probes were run (findings marked PROVEN were established from code/config I read
directly, PLAUSIBLE from reasoning over the read code).

## Bottom line

This surface is exceptionally hardened — the escrow lifecycle (`create-payment`
escrow/release/tip/cancel), `release-payout`, `process-scheduled-payouts`,
`auto-release-payment`, `void-cancelled-payments`, the Stripe webhook money
handlers, and the gift-card/PIF and referral-credit grant paths are all carrying
explicit `.select("id")` zero-row guards, compare-and-swap claims, source-transaction
caps, and idempotency keys, mostly with a comment naming the incident that put
them there. Three genuinely open money defects survive, all filed below. Every
"looks broken but isn't" is listed under Coverage so the next auditor doesn't
re-walk it.

## Coverage (swept this run)

- **create-payment** (2451 lines): escrow pricing/fees/tax line items, release
  (completion gates + conditional write), tip, cancel_escrow, admin_release_dispute,
  admin_refund_dispute — read. Escrow/release/tip: hardened. (cancel_escrow status
  gate + admin_refund_general flip are already OPEN in docs/OPEN.md / dispute-races.)
- **release-payout** (1038 lines): full read. The most-hardened function in the
  repo (claim-before-Stripe, source_transaction cap, dispute/reversal/gift guards,
  onboarding-fee CAS, flip-to-released zero-row page). No new hole.
- **auto-release-payment** (744 lines): schedules only (CAS on status+payment_status);
  no transfer. Safe.
- **process-scheduled-payouts, void-cancelled-payments, auto-tip-charge,
  charge-recurring-visits, calculate-tax**: full read (sub-agent, Opus). Hardened
  except calculate-tax (Finding 3).
- **instant-payout, cash-out-credits, helpr-pass-wallet, claim-gift-card,
  create-gift-card-checkout**: full read (sub-agent, Opus). Hardened except
  cash-out-credits (Finding 1).
- **create-boost-payment**: ownership + status gated, server-computed price,
  free-boost monthly-credit CAS. Safe.
- **verify-apple-iap**: user_id-scoped, zero-row guarded, originalTransactionId
  claim, idempotent re-grant. Safe.
- **check-pro-subscription** referral-bonus mint: unique-index arbiter + dedupe.
  Safe.
- **stripe-webhook/handlers/checkoutSessionCompleted**: escrow-funding /
  subscription / tip / boost / bgc / gift-card-mint / gift-difference — all
  fail-closed with `.select("id")` + throw-to-retry. Safe EXCEPT the sibling
  `chargeRefunded` handler (Finding 2).
- **_shared fee math** (stripeFees, helperFees, posterFees, cancellationFee):
  cents/dollars and flat-vs-marginal treatment correct.
- **referral_credits / gift_cards RLS**: client INSERT/UPDATE refused (RLS on,
  SELECT-only + service_role-UPDATE policies; self-insert = 403, re-confirmed in
  money-reconciliation:709). `profiles.stripe_account_id` pinned to OLD by the
  profile-escalation trigger (not client-writable) — payout destination cannot be
  redirected.

Not swept (owned elsewhere / already open, per the task's known list): the
`dispute-races` branch area (execute-dispute-split, admin_refund_dispute/general
flips, dispute settlement races, payout-claim double-transfer, evidence on
re-opened disputes) — deferred to that branch as instructed.

---

## Findings (most severe first)

### HM-1 — cash-out-credits: Stripe idempotency key is bound to a MUTABLE credit set, so a retry after an ambiguous transfer failure can double-pay
- **id:** HM-1
- **severity:** MED
- **status:** PLAUSIBLE (code logic proven by read; the trigger is a real-but-uncommon lost-response race)
- **where:** `supabase/functions/cash-out-credits/index.ts:164` (idempotency key) with the rollback at `:181` and the claim at `:78-83`
- **repro (who → what → bad result):**
  1. Helper has one unredeemed referral credit A ($5). Calls cash-out. Line 78-83
     atomically flips A → `redeemed=true` and the key becomes
     `cashout-sha256("A")` (line 164).
  2. `stripe.transfers.create` (line 168) reaches Stripe and the transfer
     **succeeds**, but the response is lost (SDK network retries exhausted → throw).
     The `catch` runs `rollbackClaim("transfer-failed")` (line 181), flipping A back
     to `redeemed=false`. The $5 for A has already left the platform balance.
  3. Before the helper retries, a new referral credit B ($5) accrues (a referral
     completes).
  4. Helper retries. The claim now grabs **both** A and B; the key becomes
     `cashout-sha256("A,B")` — a *different* key. Stripe does not dedupe, and sends
     a fresh $10 transfer.
  5. Net: credit A is paid twice; the platform is out the overlapping amount.
- **impact:** Silent platform-fund loss. Unlike `instant-payout` (which keys its
  idempotency on a persisted `instant_payouts.id`) and `release-payout` (which
  writes a `payout_transfers` claim row), cash-out-credits writes **no ledger
  row at all** — the only dedupe is the Stripe key, and there is no
  `payout_transfers` record, so money-reconciliation cannot see the double-outflow
  (`referral_credits`/`gift_cards` are explicitly not reconciled — this file's own
  comment at money-reconciliation:706-711). Bounded per-incident to the overlapping
  credit value; referral credits are $5–$10 each.
- **fix:** Mint a stable per-attempt claim id (e.g. a `cashout_batches` row / UUID
  created at claim time, or reuse the sorted credit set only as the *claim* key and
  never re-derive it on retry) and key the Stripe transfer on **that**, so a retry
  after a lost response replays the original transfer regardless of which credits
  are unredeemed now — mirroring instant-payout's persisted-record pattern. Also
  write a payout ledger row for cash-outs so reconciliation can see them.
- **class-check:** grep every `stripe.(transfers|payouts|refunds).create` /
  `paymentIntents.create` in `supabase/functions` and assert each idempotency key
  is derived from a **persisted, immutable** row id (claim/record/job id), never
  from a live/mutable query result set. cash-out-credits is the one that fails today.

### HM-2 — charge.refunded flips ANY fully-refunded job to `refunded` with no check for an already-settled payout — a Dashboard refund on a released job leaves the helper paid and the platform out the full budget, silently and unreconciled
- **id:** HM-2
- **severity:** MED
- **status:** PLAUSIBLE (handler logic proven by read; trigger is an operator-issued full refund on a paid job)
- **where:** `supabase/functions/stripe-webhook/handlers/chargeRefunded.ts:33-59`
- **repro (who → what → bad result):**
  1. A job completes; the helper is paid via the separate-charges-and-transfers
     path (`release-payout` sends `stripe.transfers.create`, job goes
     `payment_status='released'` with a settled `payout_transfers` row). Money has
     left the platform balance to the helper.
  2. An operator (support handling an unhappy poster) issues a **full refund** of
     the original escrow charge from the Stripe Dashboard.
  3. `charge.refunded` fires. `isFullRefund` is true, so the handler looks the job
     up by PI and unconditionally `UPDATE jobs SET payment_status='refunded'`
     (lines 49-52) — **no precondition on the current state, no check for a settled
     `payout_transfers` row, and no reversal of the helper's transfer.**
  4. Poster is refunded the full budget from the platform balance; the helper keeps
     the payout. Platform eats ≈ the payout amount.
- **impact:** Silent platform-fund loss of up to the full job budget, per event.
  It is **undetected**: money-reconciliation treats `payment_status='refunded'` as
  "settled" (money-reconciliation:391) and never asserts that a refunded job lacks a
  non-reversed `payout_transfers` row — so the double-outflow surfaces nowhere. This
  is the one money↔state divergence in the webhook that pages *no one*; every sibling
  branch in `checkoutSessionCompleted` and the chargeback handlers alert on exactly
  this class. (Distinct from the closed `charge.dispute.*` chargeback work: that
  handles disputes/chargebacks with a reversal_hold; a plain `charge.refunded` has no
  such path.)
- **fix:** Before flipping to `refunded`, read the job's `payment_status` and any
  live `payout_transfers` row. If the job is already `released`/`payout_pending` or
  has a non-reversed transfer, do **not** silently mark it refunded — page ops
  (`postSlackOpsAlert`, `money_at_risk`/critical) that a helper payout needs a
  manual transfer reversal, and add a money-reconciliation check for
  `refunded_with_live_payout` (payment_status='refunded' AND a non-reversed
  payout_transfers row exists). Also add the house-standard `.select("id")` +
  zero-row guard to the flip.
- **class-check:** money-reconciliation check `refunded_with_live_payout`, proven
  red on a seed job set to `refunded` while carrying a `paid` payout_transfers row.

### HM-3 — calculate-tax is unauthenticated and calls a metered/billable Stripe Tax API on every request, with no rate limit
- **id:** HM-3
- **severity:** MED
- **status:** PROVEN (config + handler read directly)
- **where:** `supabase/functions/calculate-tax/index.ts:36-66` (handler goes from
  the `OPTIONS` check straight to `await req.json()` with **no Authorization check**),
  `supabase/config.toml:11-12` (`[functions.calculate-tax] verify_jwt = false`).
  Billable call: `stripe.tax.calculations.create(...)` at index.ts:66.
- **repro (who → what → bad result):** any anonymous actor → POSTs
  `{budget: 500, category: "assembly", zip: "70112"}` (any labor-taxable category
  passes the `isLaborTaxable` gate at line 60, and a real ZIP passes line 55) in a
  loop → each request creates a **Stripe Tax Calculation object**, a metered/billable
  Stripe Tax API call. Unbounded, unauthenticated, unrated → the platform's Stripe
  Tax bill is driven up by anyone on the internet.
- **impact:** Platform cost amplification / abuse. No user funds at risk and no
  mis-billing of a poster (create-payment owns the real charge with its own
  `automatic_tax`). The `config.toml` comment (lines 4-10) *acknowledges* the
  endpoint is unauthenticated and "creates a Stripe Tax Calculation object on every
  request," but reasons only about **information disclosure** ("the worst a caller
  can do is learn the sales tax… public information") — it never accounts for the
  per-calculation billing cost each call incurs.
- **fix:** Put calculate-tax behind the same app-JWT gate the other client-facing
  functions use (or a short per-IP rate limit before the Stripe call). A cached
  parish/rate table for the common case would remove the Stripe call entirely for
  most requests.
- **class-check:** a config guard that fails CI if any `verify_jwt = false` function
  makes a billable third-party API call without an in-handler auth or rate-limit
  gate (inventory the `verify_jwt=false` set against the functions that call
  `stripe.*.create`).

---

## Also checked — closed / minor (not filed as findings)

- Double-pay across process-scheduled-payouts vs release-payout: closed by the
  `payout_transfers_one_live_per_job_helper` partial-unique claim (20260831190418);
  loser gets 23505 before Stripe.
- Raised-budget attack on payout: HARD CAP against captured PI amount + gift
  applied cents + `source_transaction` (release-payout:746-787).
- Group-job overpay: `accept_group_application` re-counts roster under FOR UPDATE;
  per-helper share = budget/helpers_needed.
- void-cancelled-payments: escrow-only CAS flips, `payment_refunds` + transfer_group
  dedupe past the 24h idempotency window, cancellation fee recomputed server-side.
- auto-tip / recurring-visits: consent-gated, server-computed amounts, pre-claim
  rows + idempotency keys; recurring cross-day unknown-outcome residual is detected
  and paged, not auto-recovered.
- verify-apple-iap, check-pro-subscription referral bonus, redeem/restore gift RPCs:
  zero-row guarded and idempotent.
- LOW/informational: process-scheduled-payouts onboarding-fee cross-run rollback is
  a one-round under-collection that self-heals (no double-deduct, no helper loss);
  void-cancelled-payments:574 `paymentIntents.capture` has no idempotency key but is
  safe (duplicate capture errors and self-heals via the succeeded branch).
