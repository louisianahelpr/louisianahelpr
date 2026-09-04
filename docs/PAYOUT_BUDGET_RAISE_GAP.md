# A poster can raise `budget` while checkout is open, and one payout path has no cap

**Status:** open · **Found:** 2026-09-04 · **Severity:** HIGH
**Exploitable today:** no — production holds only seed/test data and no real
money has moved. **Exploitable the day real users arrive:** yes.

## The window

`enforce_poster_jobs_money_lock` blocks a poster from changing `budget` — but
only once `OLD.payment_status IS DISTINCT FROM 'unpaid'`.

`'unpaid'` is not the moneyless state. It is the **money-in-flight** state.
`create-payment` stamps `stripe_session_id` and deliberately leaves
`payment_status = 'unpaid'` while the Stripe Checkout Session is open; only the
webhook flips it to `escrow` (`checkoutSessionCompleted.ts:695` — *"Mark as
escrow only after confirmed checkout"*).

So the lock is open across exactly the window where a session exists with a
**frozen amount**. The poster can raise `budget` after the price is fixed.

Verified against live prod (`enforce_poster_jobs_money_lock` definition queried
directly): the trigger gates on `'unpaid'` and does cover `budget`. Verified by
the auditing agent with a rolled-back impersonation as a non-admin poster:
`UPDATE jobs SET budget = 5000` succeeded at `payment_status='unpaid'` with a
session set, and was refused at `'escrow'`.

Only `budget` is exposed. `urgent_fee`, `customer_fee_amount` and
`payment_status` are all blocked in the same window.

Nothing downstream re-checks: the webhook never compares `session.amount_total`
to `budget` — its only budget read derives the tax rate — and payouts compute
straight from `budget`.

## The codebase already knows

Both `release-payout:561-574` and `execute-dispute-split:548-556` carry an
explicit HARD CAP naming this precise cause:

> `budget` is writable by the poster under RLS while payment_status is still
> 'unpaid', and the Checkout Session freezes its amount at creation — so a poster
> could pay a $10 session, then raise budget, and this function would transfer
> the raised figure out of the PLATFORM balance.

So this is a known hazard that two of three payout paths defend against.

## The third path

Grepped against the deployed functions:

| function | `HARD CAP` | `exceeds captured` | `escrowAmountReceivedCents` | `source_transaction` |
|---|---|---|---|---|
| `release-payout` | 1 | 3 | 6 | 2 |
| `execute-dispute-split` | 1 | 1 | 0 | 4 |
| **`process-scheduled-payouts`** | **0** | **0** | **0** | 3 |

`process-scheduled-payouts` is the cron that pays every job on the normal
schedule — the path most jobs take — and it has no cap.

## Two outcomes, and the second is the bad one

**Card-funded job.** `source_transaction` is the only remaining guard, and it
holds: Stripe refuses to draw more than that specific charge contains, so the
transfer throws. The harm is a **wedged job** — the helper did the work and is
never paid — not a loss. (Not fired against Stripe to prove it; this rests on
documented Stripe behaviour plus the repo's own assertion at
`execute-dispute-split:429`.)

**Gift-card / PIF-funded job.** Both guards vanish.
`release-payout:341` skips the whole PaymentIntent block when `pifRow` exists, so
`escrowAmountReceivedCents` stays `null` — and the cap at `:574` is written
`if (escrowAmountReceivedCents !== null && …)`, so it is a **no-op**. Its own
comment says so: *"Skipped only for PIF-credit-funded jobs, which have no Stripe
charge."* And `source_transaction` is deliberately omitted for the same reason —
there is no charge to draw from. The transfer then draws **uncapped from the
platform balance**.

### The traced sequence

1. Budget $20. Poster redeems a $10 gift credit.
2. `redeem_pif_credit` takes the `needs_payment` branch — reserves the credit,
   **leaves the job `unpaid`**.
3. `create-payment` opens a $10 difference session.
4. Poster raises `budget` to $5,000. *(Proven allowed above.)*
5. Poster pays the $10.
6. Webhook flips the credit to `redeemed` and the job to `escrow`.
7. At payout: `isPifFunded = true` → no cap, no `source_transaction`.
8. **~$4,400 transferred out of the platform balance against $20 collected.**

The fully-settled PIF branch is safe: `redeem_pif_credit` locks the job
`FOR UPDATE` and sets `escrow` in the same transaction. The exposure is
specifically the **partial** branch, where a credit covers only part of the
budget and a difference session is opened.

## Fixes, smallest first

1. **Narrow the lock.** Gate `budget` on `stripe_session_id IS NULL` rather than
   on `payment_status <> 'unpaid'`. Once a session exists the amount is frozen,
   so the budget must be too. This closes the window itself rather than catching
   its consequences, and it is one predicate.
2. **Port the existing cap to `process-scheduled-payouts`.** The code is already
   written — `execute-dispute-split:556` computes
   `escrowValueCents = capturedCents + giftAppliedCents`, which is exactly the
   figure that makes the cap meaningful for a PIF-funded job instead of a no-op.
3. **Use the same `capturedCents + giftAppliedCents` form in `release-payout`**,
   so its cap stops being skipped on the PIF path.

(1) alone would close the reported route. (2) and (3) are defence in depth, and
this repo's own comment argues for exactly that: *"Two independent guards,
because either alone is a single point of failure."*

## Note on the first probe

The auditing agent's first run reported `urgent_fee` and `customer_fee_amount` as
also writable. That run used the owner's account, which is `is_admin = true` and
bypasses `prevent_job_field_escalation`. Re-run as a genuine non-admin, both are
blocked. Only `budget` is exposed. Recorded because the retraction is the useful
part: an admin-account probe cannot establish what a user can do.
