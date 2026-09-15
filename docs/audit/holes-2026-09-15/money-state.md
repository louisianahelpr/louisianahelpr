# Hole hunt — LENS: money-state (2026-09-15)

Scope: every way money moves, plus the job state machine
(`jobs.status` × `jobs.payment_status` × `jobs.dispute_status`).

Method: inventory from source (`supabase/functions`, `supabase/migrations`),
12 anon-role prod requests, 3 Stripe test-mode GETs, 1 executed node harness.
No writes to prod, no sign-ups, no mock mode.

---

## 1. Coverage

### 1a. Stripe calls in `supabase/functions` — inventory from source

Taken by grepping `stripe\.[A-Za-z.]+\(` across every `.ts` under
`supabase/functions`. 96 call sites, 27 functions. `✓` = read in full.

| Function | Stripe surface | Read |
|---|---|---|
| `create-payment` | checkout.sessions create/expire/retrieve, customers create/list, paymentIntents.retrieve, refunds create/list, transfers.create | ✓ (escrow, cancel_escrow, admin_refund_general, admin_refund_dispute, tip, release dispatch) |
| `release-payout` | accounts.retrieve, checkout.sessions.retrieve, paymentIntents.retrieve, transfers.create | ✓ |
| `process-scheduled-payouts` | checkout.sessions.retrieve, paymentIntents.retrieve, transfers.create | ✓ |
| `auto-release-payment` | checkout.sessions.retrieve, paymentIntents.retrieve | ✓ (payout_pending flip) |
| `void-cancelled-payments` | checkout.sessions.retrieve, paymentIntents cancel/capture/retrieve, refunds.create, transfers create/list | ✓ (cancellation fee + Part A/B) |
| `execute-dispute-split` | accounts.retrieve, checkout.sessions.retrieve, paymentIntents.retrieve, refunds create/list, transfers create/list/retrieve | ✓ (transfer-leg recovery, refund heal) |
| `auto-resolve-disputes` | checkout.sessions.retrieve, paymentIntents.retrieve | partial (payout_pending flip only) |
| `instant-payout` | accounts.retrieve, balance.retrieve, payouts.create, transfers.create | ✓ |
| `cash-out-credits` | transfers.create | ✓ |
| `auto-tip-charge` | customers.list, paymentMethods.list, paymentIntents.create | ✓ |
| `charge-recurring-visits` | customers.list, paymentMethods.list, paymentIntents.create, refunds.create, tax.calculations.create | ✓ (charge + both refund sites) |
| `calculate-tax` | tax.calculations.create | ✓ |
| `create-boost-payment` | checkout.sessions.create, customers.list | ✓ (paid + both free paths) |
| `create-gift-card-checkout` | checkout.sessions.create, customers.list | ✓ (idempotency key only) |
| `create-bgc-payment` | checkout.sessions.create, customers.list | ✓ (idempotency key only) |
| `create-pro-checkout` | checkout.sessions.create, customers.list, subscriptions.list | ✓ |
| `pay-onboarding-fee` | checkout.sessions.create, customers.list | ✓ (idempotency key only) |
| `pro-customer-portal` | billingPortal.sessions.create, customers.list, subscriptions.list | not read |
| `check-pro-subscription` | customers.list, subscriptions.list | ✓ |
| `subscription-reconciliation` | customers.retrieve, prices.retrieve, subscriptions.list | not read |
| `expire-subscriptions` | (DB only) | not read |
| `stripe-connect` | accounts create/retrieve/update/del, accountLinks, external accounts | not read (authz lens) |
| `stripe-payouts` | accounts.retrieve, balance.retrieve, payouts.list | not read (read-only surface) |
| `stripe-idv-start` / `stripe-idv-webhook` | identity.verificationSessions | not read (verification lens) |
| `verify-apple-iap` + `_shared/appleAppStore.ts` | App Store Server API | ✓ |
| `apple-app-store-notifications` | App Store Server Notifications | not read |
| `money-reconciliation` | (DB only — makes zero Stripe calls) | ✓ (check list) |
| `stripe-webhook` (17 handlers) | see below | ✓ for 9 of 17 |

Webhook handlers read in full: `checkoutSessionCompleted`, `chargeRefunded`,
`chargeDisputeCreated`, `transferCreated`, `transferReversed` (partial),
`paymentIntentPaymentFailed`, `customerSubscriptionUpdated`, `index.ts`
(signature + idempotency), `_chargebackHold` (via callers).
Not read: `chargeDisputeClosed`, `checkoutSessionExpired`,
`customerSubscriptionDeleted`, `paymentIntentSucceeded`, `settleOnboardingFee`,
`transferCanceled`, `transferFailed`, `accountUpdated`.

### 1b. DB functions / triggers that move money or job state

Inventory: every `CREATE OR REPLACE FUNCTION` in a migration that mentions
`payment_status`, plus the gift-card and group-job RPCs. Read in full:

- `enforce_poster_jobs_money_lock` (latest: `20260905215201`) — the poster
  column lock. `locked_always` and `locked_when_funded` transcribed.
- `enforce_helper_jobs_column_whitelist` (latest: `20260908024937`) — located,
  not transcribed.
- `redeem_gift_card`, `restore_gift_card_for_job` (latest: `20260913051340`) — ✓
- `accept_group_application` (latest def: `20260804122000`) — ✓
- `reject_new_group_jobs` (`20260902035641`) — ✓
- `prevent_job_field_escalation` (latest: `20260904211812`) — located, not
  transcribed (scanned for `helpers_needed`; absent).
- Not read: `rpc_decide_dispute`, `settle_dispute_record`,
  `rpc_withdraw_dispute`, `auto_tip_candidates`, `get_payout_batches`,
  `report_helper_no_show`, `sweep_release_last_chance`, `purge_user_data`.

### 1c. Live probes (12 prod requests, 3 Stripe GETs, all read-only)

| Probe | Result |
|---|---|
| anon `GET /rest/v1/{payout_transfers,instant_payouts,tips,gift_cards,referral_credits}?select=id&limit=1` | `200 []` — RLS blocks all five |
| anon `GET /rest/v1/{payment_refunds,disputes}` | `401 42501` — no grant at all |
| anon `POST /rpc/redeem_gift_card`, `/rpc/restore_gift_card_for_job` (dead UUID) | `401 42501 permission denied for function` — revoke holds |
| anon `POST /rpc/redeem_pif_credit`, `/rpc/restore_pif_credit_for_job` | `404 PGRST202` — the retired names are genuinely gone; the 2026-09-13 clean break landed |
| unauthenticated `POST /functions/v1/calculate-tax` (no apikey, no bearer) | `200 {"taxCents":null,"reason":"no_address"}` → **MS-5** |
| Stripe `GET /v1/transfers?limit=10` | 10 payout transfers, every one `transfer_group=group_pi_*`, **not** `job_*` → **MS-1** |
| Stripe `GET /v1/transfers?transfer_group=job_b091568f-…` | `0 transfers` → **MS-1** |
| Stripe `GET /v1/transfers/tr_3UF7frKp2H4b7tEC1OirnSeI` | `metadata.job_id=b091568f-…`, `transfer_group=group_pi_3UF7fr…`, `source_transaction=ch_3UF7fr…` → **MS-1** |

### 1d. Swept and found clean (no finding)

- Escrow re-mint (`create-payment:136-266`): prior-session expiry, Stripe as the
  last word on money-in-flight, `stampSession` CAS on both `stripe_session_id`
  and the re-mintable status set.
- `cancel_escrow`: atomic claim `.in(["escrow","cancelling"])` pinned to the
  status read; non-refundable floor is `max(service fee, real balance-transaction
  fee)`, so the platform never loses to Stripe fees on any payment method.
- `claim-gift-card` / `redeem_gift_card`: stable lock order (job then credit),
  ownership + funding + expiry checks, atomic `is("recipient_id", null)` claim,
  leftover re-minted rather than lost, fail-closed on every read error.
- `cash-out-credits`: claim-first (`update redeemed=true … eq(redeemed,false)
  .select()`), rollback on every bail, idempotency key hashed from the exact
  claimed credit set. No double-spend.
- `instant-payout`: entitlement enforced server-side for quote *and* execute,
  amount derived from the live Stripe `instant_available` balance (never stored),
  `instant_payouts_one_pending_per_helper` partial unique index, both terminal
  writes guarded with `.select()` + zero-row alert.
- `auto-tip-charge`: unique partial index on `(job_id) WHERE source='auto'`,
  row written before the charge, idempotency key on the tips row id.
- `_shared/payoutClaim.ts`: claim row inserted before `transfers.create`,
  `payout_transfers_one_live_per_job_helper` makes the claim atomic, idempotency
  key salted by failed-attempt count, open claims resumed on the *same* key.
- `accept_group_application`: `FOR UPDATE` on the job, capacity re-counted inside
  the lock, `UNIQUE(job_id, helper_id)`. Roster cannot be over-filled.
- Idempotency keys vs. amounts: all 32 key sites enumerated. Every key that can
  see two different amounts carries the varying part
  (`gift-card:${user}:${email}:${amountCents}`, `…-seq${refundSeq}`,
  `recurring-visit-refund:${intent.id}`, `-r${failedCount}`,
  `-after-${previousSessionId}`). No key reused across different amounts.
- Client-supplied amounts: boost, BGC, onboarding and pro prices all come from
  `_shared/productPrices.ts` / `proTiers.ts`; escrow reads `jobs.*` server-side;
  currency is the literal `"usd"` at every site. Nothing is taken from the body.
- Webhook signature + idempotency (`stripe-webhook/index.ts`): comma-separated
  multi-secret verification, dedupe row inserted before dispatch and rolled back
  (with a zero-row alert) when a handler throws.
- Webhook ordering: `transferCreated` (R8) and `paymentIntentPaymentFailed` (R9)
  both carry `.in()/.or()` state preconditions; `chargeDisputeCreated` is a
  compare-and-set on the payment state it was decided from. The one sibling with
  no precondition is **MS-3**.
- Subscription entitlement: only `subscription.status === "active"` grants;
  `incomplete` (payment not yet succeeded) grants nothing.
- `calculate-tax` computes a *preview* only — `create-payment` still owns the
  real `automatic_tax`, so MS-5 is a cost hole, not a mis-billing hole.

### 1e. Gaps in this sweep (visible on purpose)

- 8 of 17 webhook handlers not read (listed in 1a).
- `pro-customer-portal`, `subscription-reconciliation`, `expire-subscriptions`,
  `stripe-payouts`, `apple-app-store-notifications` not read — the Apple
  notification handler in particular is where an Apple **refund** should revoke a
  tier, and MS-4 is only half-assessed without it.
- `auto_tip_candidates` and `get_payout_batches` not read, so no opinion on where
  the auto-tip amount is bounded.
- No authenticated prod probe: the prompt allows only the anon role, so every
  poster/Helpr-token claim in MS-2, MS-3, MS-6, MS-7 rests on source, not on a
  live 403/200.
- `execute-dispute-split` fee arithmetic was read for the transfer/refund
  recovery legs only, not for the split maths itself.

---

## 2. Findings, most severe first

### MS-1 — HIGH — **PROVEN** — Every "did we already transfer?" guard that lists by `transfer_group: job_<id>` finds nothing, because Stripe discards that group whenever `source_transaction` is set

**Where**
- `supabase/functions/release-payout/index.ts:844-845` (sends both
  `source_transaction` and `transfer_group: job_${job.id}`)
- `supabase/functions/process-scheduled-payouts/index.ts:757-759`
- `supabase/functions/execute-dispute-split/index.ts:673-683` (the recovery
  lookup), `:976` (the create)
- `supabase/functions/void-cancelled-payments/index.ts:320-349` (the dedupe
  lookup), `:356` + `:360-363` (the create, which also sets `source_transaction`)
- On branch `dispute-races`: `src/test/edgeTransfersCarryTransferGroup.test.ts`
  is the guard that asserts this family is sound.

**Repro (live, test mode, 2026-09-15)**

1. A real release-payout transfer exists for job `b091568f-227a-4f40-b01c-0ac792857f8c`:
   `GET /v1/transfers/tr_3UF7frKp2H4b7tEC1OirnSeI` →
   `metadata.job_id = b091568f-…`, `source_transaction = ch_3UF7frKp2H4b7tEC1gMXV38w`,
   **`transfer_group = group_pi_3UF7frKp2H4b7tEC1fhquTQN`**.
2. Run exactly what the code runs:
   `GET /v1/transfers?transfer_group=job_b091568f-227a-4f40-b01c-0ac792857f8c` →
   **0 transfers.**
3. All 10 most recent transfers on the account show the same shape:
   `transfer_group=group_pi_*`, never `job_*`.

Stripe assigns a transfer created with `source_transaction` the *charge's*
transfer group (`group_pi_<pi>`), and the `transfer_group` the caller asked for
is silently dropped — no error, no warning. `release-payout:915` then records
`metadata.transfer_group = transfer.transfer_group`, i.e. the real
`group_pi_*` value, which is why nothing has ever contradicted the assumption.

**Impact**

Each of these checks exists because the Stripe idempotency key stops protecting
anything after its ~24h replay window, and each is the *only* thing standing
between a re-run and a second real transfer:

- `void-cancelled-payments` Part A: the lookup is documented as "ask Stripe what
  actually exists rather than trusting the key". It returns nothing for **every**
  fee transfer (not just the pre-2026-09 ones the code's CAVEAT admits to,
  because the create also passes `source_transaction`), so the branch falls
  through and sends. The loop re-selects a job forever when the terminal status
  flip matches zero rows → a second real cancellation-fee transfer to the helper.
- `execute-dispute-split:673-683`: the transfer-leg recovery has a second source
  (`dispute.execution_transfer_id`), so it degrades rather than fails outright —
  but its *primary* source is dead.
- The `dispute-races` branch generalises this pattern to Quick Release / Quick
  Refund in `create-payment` and to `_shared/payoutClaim.ts`, and ships a static
  test asserting the parameter is *sent*. Sending it is not the property that
  matters; it is exactly the false confidence this finding is about.

**Fix direction**

Stop listing by `transfer_group`. List by `destination` + filter on
`metadata.job_id` (the payout-claim fallback already does this and is the only
member of the family that survives), or store the returned
`transfer.transfer_group` at create time and list by *that*. Either way, assert
the value Stripe returned rather than the value that was sent.

**CLASS check**

Replace `edgeTransfersCarryTransferGroup.test.ts`'s "was it sent?" assertion with
a round-trip one, and add a nightly prod-read check: for every
`payout_transfers` row with a `stripe_transfer_id`, fetch the transfer and assert
`transfer.transfer_group === 'job_' + job_id`. That fails red on the first
existing row, and it catches every future guard built on a request field Stripe
is free to override. Generalised: **no money guard may key on a request
parameter that was never read back from the provider's response.**

---

### MS-2 — HIGH — PLAUSIBLE — `admin_refund_general` refunds a job that has already paid its Helpr, with no state precondition and no transfer reversal

**Where** `supabase/functions/create-payment/index.ts:1849-1966`

**Repro**

1. Job funded → completed → `release-payout` transfers the Helpr's take
   (`payout_transfers.status = 'paid'`, `jobs.payment_status = 'released'`).
2. Support hits "Refund" in the admin panel (or any admin calls
   `create-payment` with `{action:"admin_refund_general", jobId}`).
3. Line 1862-1864 reads the job with `select("*")` and checks **only**
   `has_role(admin)` — it never looks at `payment_status`. The escrow-era gates
   that every sibling path carries (`cancel_escrow`'s
   `.in(["escrow","cancelling"])` claim, `release-payout`'s
   `payment_status !== 'payout_pending' → 409`) are absent here.
4. A full refund is issued against the escrow PaymentIntent, then lines 1957-1968
   set `status='cancelled', payment_status='refunded'`.

Nothing anywhere in `supabase/functions` calls
`stripe.transfers.createReversal` — grepped, zero hits. The Helpr keeps the
transfer.

**Impact** The platform pays out the budget twice: once to the Helpr (never
clawed back) and once back to the poster. On a $200 job that is ~$376 of platform
loss against $224 of escrow. The `released` state — the only record that the
Helpr was paid — is overwritten, and `money-reconciliation`'s
`released_without_payout_transfer` check (`money-reconciliation/index.ts:247-249`,
fired on `payment_status === 'released'`) stops applying, so the divergence is
invisible to the nightly reconciler too. The same hole reaches the platform's own
Stripe Dashboard: a full dashboard refund on a released job's PI lands in MS-3.

**Fix direction** Gate on state before refunding, the way `cancel_escrow` does:
a claiming `UPDATE … .in("payment_status", ["escrow","cancelling","payout_pending"])
.select("id")`, and for a job already `released`, require an explicit
`reverse_transfer: true` that actually issues
`stripe.transfers.createReversal(transferId, { amount })` and writes the
`payout_transfers` row to `reversed` before the refund.

**CLASS check** Enumerate from source every `stripe.refunds.create` call site in
`supabase/functions` and assert each is preceded by a `payment_status`
precondition in the same function, with an explicit allow-list. Add a
`money-reconciliation` check that is the mirror of `releasedNoTransfer`:
**any job whose `payment_status` is `refunded`/`cancelled` while a
`payout_transfers` row for it is `paid` or `pending`-with-an-id is CRITICAL.**
That check catches MS-2 and MS-3 and every future path that refunds over a
settled payout. Show it red by pointing it at a fixture job in exactly that
state.

---

### MS-3 — HIGH — PLAUSIBLE — `charge.refunded` writes `payment_status='refunded'` over any state, including `released` — the one sibling handler the R8/R9 precondition pass missed

**Where** `supabase/functions/stripe-webhook/handlers/chargeRefunded.ts:49-52`

```ts
const { error: updateErr } = await supabase
  .from("jobs")
  .update({ payment_status: "refunded" })
  .eq("id", refundedJob.id);          // ← no .in(), no .or(), no .select()
```

**Repro** Any full refund on a job's escrow PaymentIntent — from the Stripe
Dashboard, from MS-2, or from an `execute-dispute-split` 100%-poster settlement —
emits `charge.refunded` with `amount_refunded >= amount`. The handler looks the
job up by `stripe_payment_intent_id` and flips it to `refunded` regardless of
whether it is `escrow`, `payout_pending`, `released`, `chargeback` or already
`cancelled`.

**Impact** Two distinct losses.
(a) It erases `released` — see MS-2's impact; this is the write that makes the
double payout un-detectable.
(b) It walks `chargeback` back to `refunded`. `chargeDisputeCreated` sets
`chargeback` specifically to block payouts (`_chargebackHold.ts`), and the
*money* is still withheld by Stripe; a `refunded` job no longer reads as
chargeback-held to a human triaging the queue.

This is a precondition gap, not an oversight of principle: the identical fix was
applied to `transferCreated.ts:79-83` as R8 ("a job that has since been refunded
or cancelled must never be flipped back to released by a redelivered
transfer.created") and to `paymentIntentPaymentFailed.ts:59-64` as R9. The
refund handler was left out of that pass, and it is the one that writes a
*terminal* status.

**Fix direction** Same shape as its siblings:

```ts
.update({ payment_status: "refunded" })
.eq("id", refundedJob.id)
.in("payment_status", ["escrow", "payout_pending", "cancelling", "refunded"])
.select("id")
```

and, on zero rows over a `released`/`chargeback` job, `postSlackOpsAlert` with
`severity: "critical"` rather than silently succeeding — a full refund landing on
a released job is precisely the event ops must see.

**CLASS check** A source-derived test over `supabase/functions/stripe-webhook/handlers/`:
every `.from("jobs").update({ … payment_status … })` must carry either an
`.in("payment_status", …)` or an `.or("payment_status…")` in the same chain, and
must `.select(` its rows. Inventory from the handler directory, minus the
asserted set, must be empty. Show it red by deleting the `.in()` from
`transferCreated.ts`.

---

### MS-4 — HIGH — PLAUSIBLE — Apple IAP accepts a SANDBOX transaction in production, so a free StoreKit-sandbox purchase grants a real paid tier

**Where**
- `supabase/functions/_shared/appleAppStore.ts:193-222` (`fetchAppleTransaction`)
- `supabase/functions/_shared/appleAppStore.ts:106-117` (`AppleTransaction` — no
  `environment` field)
- `supabase/functions/verify-apple-iap/index.ts:89-99, 151-165` (the grant)

**Repro**

1. `fetchAppleTransaction` probes `PROD_BASE` first, then, **on a 404, falls
   through to `SANDBOX_BASE`** (`:198-220`). `APPLE_IAP_ENVIRONMENT` only
   reverses the order; it never restricts.
2. The only assertion made on the decoded JWS payload is
   `tx.bundleId !== cfg.bundleId` (`:210`). Apple's
   `JWSTransactionDecodedPayload` carries an `environment` field
   (`"Sandbox" | "Production"`); this interface does not declare it and no code
   reads it.
3. `verify-apple-iap` then checks only `revocationDate` (`:94`) and
   `PRODUCT_TIER_MAP` (`:90`), and grants `subscription_tier` +
   `subscription_expires_at` with `subscription_source: "apple"` (`:151-165`).

A sandbox purchase is free, and sandbox transactions carry the same
`bundleId` and the same `com.helpr.elite.annual`-shaped `productId`. Anyone with
a TestFlight build or a sandbox Apple ID can obtain a real `transactionId`, then
call `verify-apple-iap` from an ordinary production account (`src/lib/iap.ts:122`
is the client path) and be granted Elite.

The IAP stack is live, not hypothetical: `cordova-plugin-purchase ^13.18.0` is in
`package.json:117` and `src/lib/iap.ts` invokes the function.

**Impact** Free paid membership. Beyond the subscription revenue, tier is the
input to `TIER_FEE_PERCENT` (Elite 8% vs free 12% commission — so every job that
account works pays the platform less) and it is the gate
`profileHasPerk(…, "instantPayout")` reads in `instant-payout/index.ts:114-127`,
the one the 2026-08-31 audit already had to close once.

**Marked PLAUSIBLE, not PROVEN**, because it cannot be exercised without an Apple
sandbox account, and because `apple-app-store-notifications` was not read — if
that handler happens to reject sandbox notifications, renewals would lapse after
the first period, which narrows but does not close the hole (the initial grant
still lands).

**Fix direction** Record which base answered, or read `environment` off the
decoded payload, and refuse a `Sandbox` transaction unless
`APPLE_IAP_ENVIRONMENT === "sandbox"`. Persist the environment next to
`apple_original_transaction_id` so a sandbox grant is identifiable after the
fact.

**CLASS check** A test that drives `fetchAppleTransaction` with a stubbed fetch
returning 404-then-200-from-sandbox and asserts the caller refuses in production
config. Generalised: **every external entitlement source must record which
environment issued it, and a test must assert that a non-production issuer grants
nothing in production** — the same check covers the Stripe live/test split, which
is relevant while `stripe-sandbox-off.sh` is still a launch-day step.

---

### MS-5 — HIGH — **PROVEN** — `calculate-tax` is fully unauthenticated and unthrottled, and spends money at Stripe on every request

**Where**
- `supabase/config.toml:11-12` — `[functions.calculate-tax] verify_jwt = false`
- `supabase/functions/calculate-tax/index.ts:35-66` — no `Authorization` check,
  no `checkRateLimit` import, no key check beyond `STRIPE_SECRET_KEY`
- `:66-82` — `stripe.tax.calculations.create(...)` on every request that carries
  a `zip`

**Repro (live prod, 2026-09-15)**

```
curl -X POST "$VITE_SUPABASE_URL/functions/v1/calculate-tax" \
     -H 'Content-Type: application/json' \
     -d '{"budget":10,"category":"cleaning"}'
→ HTTP 200  {"taxCents":null,"reason":"no_address"}
```

No `apikey` header, no `Authorization` header, no session. (This body was chosen
deliberately: the `zip` guard at `:51` returns before any Stripe call, so the
probe proves reachability without creating a billable object. Adding
`"zip":"70001"` is what reaches `tax.calculations.create`.)

**Impact** Anyone on the internet can drive unbounded Stripe Tax calculations on
the platform's account. Stripe Tax calculations are billed per call, so this is
attacker-controlled spend with no ceiling, plus one outbound Stripe API call per
inbound request as a DoS amplifier against the account's own rate limits.
Every other money-adjacent function in the repo calls `checkRateLimit`
(`create-payment` 10/min, `instant-payout` 10/min, `cash-out-credits` 5/min,
`claim-gift-card` 10/min); this one does not. It is a *preview* endpoint, so it
cannot mis-bill a poster — the cost falls entirely on the platform.

**Fix direction** `verify_jwt = false` is defensible (the quote runs before
sign-in on the Post-a-Task form), but the throttle is not optional: add
`checkRateLimit({ windowMs: 60_000, maxRequests: 10, keyPrefix: "calculate-tax" })`
as the first statement, and consider caching by `(zip, budgetCents, category)`
since the answer is a pure function of those three.

**CLASS check** A source-derived test: enumerate every entry in
`supabase/config.toml` with `verify_jwt = false`, and assert each corresponding
`index.ts` either reads an `Authorization` header / verifies a provider
signature, **or** calls `checkRateLimit`. Current `verify_jwt = false` set —
`calculate-tax`, `create-payment`, `process-email-queue`, `stripe-webhook`,
`apple-app-store-notifications`, `email-tracking` and the rest — must be covered
with an explicit, reasoned exemption list. Show it red by deleting
`create-payment`'s rate-limit call.

---

### MS-6 — MEDIUM — **PROVEN** (executed node harness) — An admin partial refund of exactly the budget silently becomes a full refund of the whole capture *and* cancels the job

**Where** `create-payment/index.ts:1868-1872` and `:1902-1909` / `:1957-1968`

```ts
const totalCents    = Math.round(Number(job.budget || 0) * 100);   // budget ONLY
const requestedCents = typeof amountCents === "number" ? Math.round(amountCents) : null;
const isPartial = requestedCents !== null && requestedCents > 0 && requestedCents < totalCents;
if (requestedCents !== null && (requestedCents <= 0 || requestedCents > totalCents)) { throw … }
…
...(isPartial ? { amount: requestedCents } : {})   // no `amount` ⇒ Stripe refunds EVERYTHING
```

**Repro (executed)** The three expressions above, transcribed verbatim into a
node harness and run against `job.budget = 100`:

| `amountCents` | `isPartial` | amount sent to Stripe |
|---|---|---|
| `9999` | `true` | `9999` |
| `10000` | **`false`** | **FULL CAPTURE (no `amount` param)** |
| `10001` | — | rejected: `Invalid partial amount` |

So `requestedCents === totalCents` is the one value that is neither refused nor
treated as partial: it falls through to the full-refund branch. `totalCents` is
the **budget alone**, while the capture is budget + poster service fee + urgent
fee + sales tax — so on a $100 job with a 12% poster fee, an admin asking to
refund $100.00 causes Stripe to refund ~$112 **and** lines 1957-1968 to set
`status='cancelled', payment_status='refunded'` on a job the admin meant to
leave intact. There is no value an admin can pass that refunds exactly the
budget as a partial.

**Impact** Over-refund of the service fee and tax the platform has already paid
Stripe for, plus an unintended job cancellation and customer notification. Small
per event; systematic, and it lands on the one code path used when a human is
already trying to make a customer whole.

**Fix direction** Compute `totalCents` from the actual capture
(`pi.amount_received`, which this branch already retrieves at `:1884`), not from
`job.budget`, and make the partial test `requestedCents < capturedCents` with
`>` — not `>=` — as the rejection bound. Or require an explicit
`full: true` flag rather than inferring a full refund from the absence of one.

**CLASS check** A boundary test over every branch in `create-payment` that
infers "full vs partial" from a comparison: feed it `n-1`, `n`, `n+1` for the
threshold and assert the refund amount sent to Stripe matches what was asked for
at every point. Show it red by running it against the current code at `n`.

---

### MS-7 — MEDIUM — PLAUSIBLE — `jobs.helpers_needed` is in neither column lock, so a poster can multiply the group payout after the roster is full

**Where**
- `supabase/migrations/20260905215201_allow_no_show_rpc_to_unassign_helper.sql:53-76`
  — `enforce_poster_jobs_money_lock`; `locked_always` and `locked_when_funded`
  transcribed in full. `helpers_needed` appears in neither. Nor does it appear in
  `prevent_job_field_escalation` (`20260904211812`) — grepped all migrations:
  `helpers_needed` is never named in a guard, only in DDL and in read RPCs.
- `supabase/functions/process-scheduled-payouts/index.ts:307-310`:
  `const helpersCount = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;`
  `const perHelperBudget = job.budget / helpersCount;`

**Repro** Group job funded for `helpers_needed = 4`, budget $400, roster filled
with 4 Helprs. Poster PATCHes `jobs` setting `helpers_needed = 1` — an ordinary
poster UPDATE on their own row, touching no locked column. Job completes. The
cron builds `payoutTargets` from the **roster** (`:294`, 4 entries) but computes
the share from **`helpers_needed`** (`:308`, now 1), so each of the 4 is paid
`400/1` minus commission. ~$1,408 leaves the platform against $400 of escrow.
The only guard in that loop is the under-fill alert at `:268`
(`distinctRoster.size < helpers_needed`), which does not fire when the roster is
*larger* than `helpers_needed`; the release gate then counts paid against roster
size, so the job closes cleanly as `released`.

**Reachability today** Blocked, but only by `reject_new_group_jobs`
(`20260902035641`), which refuses a user-authenticated INSERT/UPDATE that makes a
job a group job. That trigger's own `COMMENT` says **"DROP this trigger in the
migration that ships per-member lifecycle state on `group_job_helpers`"** — it is
explicitly temporary, and prod is documented as holding 0 group jobs. So this is
a live unguarded column sitting behind a trigger scheduled for removal, not a
closed hole. `release-payout` refuses multi-helper rosters outright
(`:151-198`); the cron is the fan-out path and has no such refusal.

**Fix direction** Add `helpers_needed` (and `is_group_job`) to
`locked_when_funded`. Independently, make the cron derive the divisor from
`max(rosterSize, helpers_needed)` so no roster can ever be paid more than the
escrow, and alert on over-fill the way it already alerts on under-fill.

**CLASS check** A test that derives, from the source of
`release-payout` / `process-scheduled-payouts` / `execute-dispute-split`, every
`jobs` column read while computing a payout amount, and asserts each one appears
in `enforce_poster_jobs_money_lock`'s `locked_when_funded` array (parsed from the
latest migration that defines it). `budget`, `urgent_fee`, `helper_fee_percent`
pass today; `helpers_needed` fails. That is the whole class: **a column that
divides or multiplies a payout must be immutable once the job is funded.**

---

## 3. One-line index

| id | severity | status | title |
|---|---|---|---|
| MS-1 | HIGH | PROVEN | `transfer_group: job_<id>` is discarded by Stripe when `source_transaction` is set; every duplicate-transfer guard listing by it fails open |
| MS-2 | HIGH | PLAUSIBLE | `admin_refund_general` refunds an already-released job with no state gate and no transfer reversal — double payout |
| MS-3 | HIGH | PLAUSIBLE | `charge.refunded` overwrites `released`/`chargeback` with `refunded`; no state precondition, unlike its R8/R9 siblings |
| MS-4 | HIGH | PLAUSIBLE | Apple IAP accepts sandbox transactions in production — a free purchase grants a real paid tier |
| MS-5 | HIGH | PROVEN | `calculate-tax` is unauthenticated and unthrottled, and bills Stripe per request |
| MS-6 | MEDIUM | PROVEN | Admin partial refund of exactly the budget becomes a full refund of the whole capture + a job cancellation |
| MS-7 | MEDIUM | PLAUSIBLE | `jobs.helpers_needed` is unlocked; lowering it after the roster fills multiplies the group payout |
