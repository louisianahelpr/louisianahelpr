# Lane report — `lh-money-escrow`

**Run:** verification pass, 2026-09-02 (re-dispatch).
**Repo state:** `main` @ `6b8a6b0c`.
**Prod project:** `fncmgoasalhdgfwzhsqa` (read-only `execute_sql` only; no `apply_migration`).
**Stripe:** account `acct_1RQbAfKp2H4b7tEC`. **Live mode: strictly read-only — no live object
was ever created, refunded, transferred or modified**, per the owner's instruction. **Test mode**
(`livemode: false`) was authorised mid-run and used; the only objects created were one test
customer and one test tax calculation, both confirmed `livemode: false` (see the test-mode
section). No charge was completed in either mode.

---

## The one number that reframes every finding below

**Prod holds zero real money at risk today.**

| Measure | Value | Source |
|---|---|---|
| `jobs` total | 64 | `select count(*) from jobs` |
| …of which `is_seed = true` | 61 | same |
| Non-seed jobs | **3, all `payment_status = 'unpaid'`, none with a payment intent** | `group by payment_status, is_seed` |
| Live Stripe PaymentIntents, all time | **10**, most recent **2026-04-12** | `GET /v1/payment_intents` |
| `payout_transfers` / `instant_payouts` | 2 / 1 | prod count |
| Profiles with a Connect account | 2 of 35 | prod count |

Every one of those 10 live charges belongs to a job row that **no longer exists** in prod
(I queried all five recent `job_id`s from the PI metadata; zero rows returned). So the live
Stripe history is the owner's own pre-launch testing, and the DB has since been reset around it.

This does not soften a single finding — it changes their **class**. Nothing here is an active
incident bleeding customer money. All verified findings are **pre-launch defects that will
fire on the first real transaction**, which is exactly when they are cheapest to fix and most
expensive to discover.

One live-data footnote worth the owner's attention: **28 seed jobs sit in
`payment_status = 'escrow'` totalling $4,388.** `lh-cron-jobs` flagged a risk that some
held-funds tile might count these. **I checked and it does not** — `AdminAnalytics.tsx:76`
scopes its source query with `.eq("is_seed", false)`, and `adminHealth/useConfigChecks.ts:74`
additionally requires `stripe_payment_intent_id IS NOT NULL`, which no seed job has. Lead closed,
no finding filed.

---

## Verdicts — 19 findings: 16 verified, 1 newly filed, 1 retracted, 1 with a sub-item retracted

| ID | Sev | Verdict | Artifact anyone can re-check |
|---|---|---|---|
| ME-001 | HIGH | **verified** | Deployed `auto-release-payment` **v1531** still has `.is("revision_requested_at", null)`; prod `cron.job` = 43 rows, 0 match revision; `pg_proc` = 3 functions touch the columns, none releases |
| ME-005 | HIGH | **verified** | Prod `platform_settings`: `customer_fee_percent=12`; `useJobFormEffects.ts:206-221` bare return on error; `legacyFeeFallback.ts:30` = 10; `create-payment/index.ts:300-302` |
| ME-006 | HIGH | **verified** | Live Stripe `pi_3TLHu3Kp2H4b7tEC0hMXa4x5` / charge `py_3TLHu3Kp2H4b7tEC0QySP5mZ`, `transfer_data.destination=acct_1TE0O4393MyRElrv`; commits `69348d6f` (2026-07-04) vs `22e6d2f4` (2026-08-19) |
| ME-002 | MEDIUM | **verified** | `checkoutSessionCompleted.ts:727` bare update vs guarded `create-payment/index.ts:441-454`; dedupe insert at `stripe-webhook/index.ts:174-268` |
| ME-004 | MEDIUM | **verified** | Prod `pg_get_functiondef(enforce_poster_jobs_money_lock)`: `budget` locked only when `payment_status <> 'unpaid'` |
| ME-007 | MEDIUM | **verified** + strengthened | `TipDialog.tsx:39-41` omits it; `CompletionPrompts.tsx:206,212` sends it; server key `create-payment/index.ts:850-852` |
| ME-008 | MEDIUM | **verified** + corrected | `release-payout/index.ts:462-524` deducts; `JobPrice.tsx:57-75` and `helperEarnings.ts:163-174` do not; prod `onboarding_fee_cents = 200` |
| ME-009 | MEDIUM | **verified** + 3 corrections | `statusLabels.ts:112-119` (no chargeback key); 6 call sites all under `src/components/admin/`; `src/hooks/useDashboardData.ts:266` |
| ME-010 | MEDIUM | **verified** | Prod trigger def: `category` in neither lock array; `EditJobDialog.tsx:151-152,179`; `salesTax.ts:43-48` |
| ME-011 | MEDIUM | **verified** | `auto-tip-charge/index.ts:412-419`; contrast `charge-recurring-visits/index.ts:168-231,716-738` |
| ME-013 | MEDIUM | **verified** + corrected | `cash-out-credits/index.ts:164,177-183`; contrast `_shared/payoutClaim.ts:26-53` |
| ME-014 | MEDIUM | **verified** + scope narrowed | Repo-wide grep `createFromCalculation` = **0 hits**; `charge-recurring-visits/index.ts:499,519-553`; `posterFees.ts:72-75` |
| ME-015 | MEDIUM | **verified** + strengthened | `instant-payout/index.ts:400-438` (alert inside the guard) vs `:282-305` (unconditional); migration `20260831190419…sql:200-211` appends |
| ME-016 | MEDIUM | **verified** + strengthened | `instant-payout:105` / `helperFees.ts:86` / `money-reconciliation:488` = active; `create-boost-payment:97` / `helpr-pass-wallet:66` / `check-pro-subscription:235` = inactive |
| ME-003 | LOW | **verified** | `checkoutSessionCompleted.ts:266-296`; prod `feature_flags.boosts_enabled = false` |
| ME-012 | LOW | **verified** | Prod `net._http_response` 200s hourly, latest **2026-09-02 17:07:00Z**; deployed metadata `verify_jwt=false` vs 0 hits in `config.toml` |
| ME-017 | LOW | **verified**, sub-item 3 **retracted** | `CancellationDialog.tsx:491`; `instant-payout:376-383`; cron `'34 * * * *'` + 30-min gate; `create-boost-payment:288-290` |
| ME-018 | MEDIUM | **RETRACTED** | Prod: all 3 rows are `is_seed = true`, expiries finite (2026-09-24), `AdminAnalytics.tsx:76` filters them out |
| ME-019 | LOW | **newly filed** | Live session line item `li_1TLCILKp2H4b7tECuP6itlCk` "Service Fee" subtotal 50c **tax 6c** vs today's `txcd_00000000`; live registration `taxreg_1TAZVsKp2H4b7tECyvJINQyg` active |

Full per-finding reasoning is in the bus (`audit-bus.mjs show <id>`); the status notes carry
the evidence, not this table.

### The retraction, and why it matters

**ME-018 is retracted.** It claimed three profiles carry a paid tier with no Stripe
subscription — real accounts earning the platform 1–4 points less on every job forever. The
filing's repro query **omitted `is_seed`**. Re-run with that column: **all three rows are
`is_seed = true`.** They are fixtures provisioned so the tier fee ladder can be exercised, their
expiries are finite (not NULL, so they are not ME-016 instances either), and every admin money
aggregation already excludes them. Nothing to fix.

That is the same failure PROTOCOL §1 was written about, in miniature: the query ran against
prod, so it *felt* like a fact, but it did not select the column that discriminates fixture
from real. A prod query is only evidence if it asks the question that could falsify the claim.

**ME-017 sub-item 3 is retracted** inside an otherwise-verified batch. I filed
`CancellationFeePill`'s `fallbackFeePercent` as "an optional prop defaulting to 10 — latent
over-promise." It is not a default parameter; it is
`fallbackFeePercent ?? HELPER_FEE_LEGACY_FALLBACK_PERCENT` (`:31-34`), the project's documented
named-constant pattern, and there is exactly **one** call site (`AppliedJobCard.tsx:345`) which
passes the prop. Dead-defensive code, not a latent wrong number. **ME-017 sub-item 2 is
corrected**: TipDialog *does* enforce a $1 lower bound (`:32-35`, `min={1}`, and
`currency-input.tsx:141` clamps on blur); the real gap is only the **missing upper bound**, so a
$5,000 tip round-trips to a generic server error toast.

---

## The three the lead escalated

### ME-006 — the tip disclosure is a false binding statement

This is the one I would put in front of the owner first, because it is a **legal disclosure**,
the fix is one sentence, and the timeline makes it indefensible as an accident.

- `create-payment/index.ts:816,834` sets `application_fee_amount = stripeProcessingCostCents(tipCents)`
  on a **destination charge** to the helper's connected account. `stripeFees.ts:29-32` is
  `round(cents × 0.029) + 30`. A **$5 tip nets the helper $4.55 (91%)**; a $1 tip nets 67¢.
- **Direction confirmed against a live object.** The one real tip in the live account
  (`cs_live_a1KNKGah…`, `metadata.type = "tip"`, `pi_3TLHu3Kp2H4b7tEC0hMXa4x5`, charge
  `py_3TLHu3Kp2H4b7tEC0QySP5mZ`, $1.00) is a destination charge with
  `transfer_data.destination = acct_1TE0O4393MyRElrv`. On that shape an `application_fee_amount`
  is debited **from the helper's transfer**, not added to the poster's charge — so the helper,
  not the poster, absorbs it.
- **The honest limit:** that live tip shows `application_fee_amount: null`, because it was
  created **2026-04-12** and the fee shipped in commit `69348d6f` on **2026-07-04**. No live tip
  has ever actually been charged the fee. I did not create one. So the exact fee on a post-July
  session is proven by code and arithmetic, **not** by a live session object.
- **The disclosure conflict needs no transaction to prove.** `TermsSection.tsx:132` —
  *"Tipping: 100% of tips go to the Helpr — no platform fee on tips"* — was added by commit
  `22e6d2f4` on **2026-08-19**, six weeks *after* the fee shipped. It was written against, and
  contradicts, live behavior. Meanwhile `TipDialog.tsx:74` is honest: *"Pure thanks — no platform
  cut, just the small card-processing fee."* Two user-facing surfaces disagree.

**The fair nuance, which the owner should hear before deciding:** the platform takes **no
margin** — it retains exactly Stripe's cost and breaks even, which is what the code comment says
it is for. So *"no platform fee on tips"* is defensible in spirit. *"100% of tips go to the
Helpr"* is simply false, and it is the binding half of the sentence.

#### ME-006 fix guidance — the owner's decision is sound, the obvious implementation is not

The owner has decided the policy: **the poster covers Stripe's card fee on tips**, so the Helpr
receives the full tip and the Terms sentence becomes true as written. That is the right call and
it makes the disclosure honest. The mechanics are as the orchestrator framed them — today
`application_fee_amount` is retained from the destination **transfer**; it must move onto the
**charged amount**.

**But charging `tipCents + stripeProcessingCostCents(tipCents)` is wrong and loses money.**
Stripe levies its fee on the grossed-up total, not on the original tip, so the platform comes up
short on every tip — the same direction the current code was written to avoid. Shortfall:
−1¢ at $1 and $5, −2¢ at $10, −3¢ at $20, −9¢ at $100, **−85¢ at $1000**.

Charge `A` such that `A − stripeFee(A) = tipCents`:
`A = ceil((tip × 0.029 + 30) / (1 − 0.029))` with a correction loop, and
`application_fee_amount = stripeProcessingCostCents(A)`.
**`_shared/posterFees.ts:72-75` already implements exactly this — reuse it, don't hand-roll it.**

Poster-facing totals with the correct formula (platform nets exactly $0.00 in every row):

| Tip | Poster charged | Surcharge | Helper nets |
|---|---|---|---|
| $1 | **$1.34** | **34.0%** | $1.00 |
| $5 | $5.46 | 9.2% | $5.00 |
| $10 | $10.61 | 6.1% | $10.00 |
| $20 | $20.91 | 4.5% | $20.00 |
| $50 | $51.81 | 3.6% | $50.01 ¹ |
| $100 | $103.30 | 3.3% | $100.00 |
| $1000 | $1030.18 | 3.0% | $1000.00 |

¹ 1¢ overshoot from the correction loop; favours the helper.

Three things the fix must not miss:
1. **`auto-tip-charge/index.ts:348` carries the same line.** Change both, or auto-tips and manual
   tips will disagree.
2. **`TipDialog.tsx:74`** — *"Pure thanks — no platform cut, just the small card-processing fee"* —
   is the honest sentence today and becomes the wrong one the moment the poster pays it. It is now
   the copy that must disclose the surcharge.
3. **The flat 30¢ dominates small tips.** A $1 tip costing the poster $1.34 is a product decision,
   not an implementation detail, and it interacts with the `$1` floor at
   `create-payment/index.ts:777-779`. The owner should price that top row deliberately — options
   are raising the minimum tip, or absorbing the flat component on small ones.

### ME-005 — shown-vs-charged can diverge; here is exactly when

Live `platform_settings` (single row): `customer_fee_percent = 12`, `helper_fee_percent = 12`,
`onboarding_fee_cents = 200`, plus a legacy `platform_fee_percent = 15.00` column.

The client displays a percent from **`platform_settings`**; the server charges one from the
**tier ladder**. They are different sources that agree today by coincidence.

- Client seeds from `get_public_platform_settings` (`useJobFormEffects.ts:161-184`).
- Its poster-profile read (`:206-221`) does a **bare `return` on error**, leaving
  `tierFeeLocked.current = false` — so the `platform_settings` value stands and **no tier
  fallback occurs**.
- NULL column → `legacyFeeFallback.ts:30` = **10**, whose own header says *"this is NOT the
  current Free-tier ladder (12%)."*
- Two hardcoded literals: `useJobDerived.ts:118` and `CheckoutStep.tsx:454` both `customerFee ?? 12`
  rather than deriving `TIER_PERKS.free.platformFeePercent` (`subscriptionTiers.ts:126` = 12).
- Server: `create-payment/index.ts:245` *selects* `customer_fee_percent` but `:251` comments it is
  **deliberately not bound**; `:300-302` charges `posterFeePercentForTier(...)` with
  `DEFAULT_TIER_FEE_PERCENT = 12`.

**Precisely what would have to change** for a poster to be shown one number and charged another —
any one of these is sufficient:

1. An admin sets `platform_settings.customer_fee_percent` to anything ≠ 12. The client displays
   it; the server ignores it. **This is an admin-writable column, so this is a UI action away.**
2. That column is set NULL. Client shows the legacy **10**, server charges **12**.
3. The poster-profile read errors. Client keeps whatever `platform_settings` said; server still
   charges the tier rate.

On a $200 job at 10-shown / 12-charged: **displayed $220, charged $224**, silently.

### ME-001 — revision escrow strands, and both parties are told it won't

Verified against the **deployed** function (version **1531**, updated 2026-09-02 17:52Z), not the
repo file:

- Deployed `auto-release-payment` still carries `.is("revision_requested_at", null)`.
- Live `cron.job`: **43 active jobs, none references revision.**
- Live `pg_proc`: only three `public` functions touch the revision columns —
  `helper_abort_job`, `set_revision_deadline`, `sweep_release_last_chance`.
- `sweep_release_last_chance` (cron every 5 min) is **notification-only** and **also** filters
  `revision_requested_at IS NULL` — so a revision job gets neither the release nor the
  "last chance" warning.
- The **only** function that ever sets `revision_requested_at = NULL` is `helper_abort_job` (the
  helper walking away and taking a strike). `resolve_revision` never clears it and never changes
  status.
- `revision_acceptance_deadline` is written by `create-payment:734` and read by **exactly two UI
  components** (`ActiveJobSection.tsx:312`, `PostedJobCard.tsx:556`), both rendering a countdown
  that expires into *"payment auto-releasing."* **Zero server or cron readers.**

So: the poster is told *"If you do nothing, payment auto-releases"*; the helper is told
*"Poster didn't respond — payment auto-releasing."* Nothing releases it. Escrow is recoverable
only by poster action, dispute, or helper abort.

**The nuance that should shape the fix:** `auto-release-payment`'s own comment documents this
deliberately — the filter was added to stop a *worse* bug (revision jobs auto-releasing against a
promised 72-hour window, so posters paid in full for work they had formally sent back), and it
says outright *"If revision jobs should ever settle on their own, that needs its own pass keyed on
`revision_deadline` — not this one."* The filter is correct. **The follow-up pass was never
built, and the UI was shipped promising it.** The cheap, safe fix is therefore the copy, not the
cron: stop promising an auto-release that does not exist. Building the release pass is the larger
call and belongs to the owner.

---

## One correction to a pricing note filed elsewhere (not a finding, not re-filed)

The orchestrator filed a pricing observation: tiers are basic $5 / pro $10 / elite $20 monthly
against fee rates 11 / 10 / 8% versus free's 12%, and every tier breaks even at exactly
**$500/month GMV**. **That figure is exactly right** — confirmed against `subscriptionTiers.ts`
(free `platformFeePercent: 12`, basic 11 @ `price: 5`, pro 10 @ `price: 10`, elite 8 @ `price: 20`).

**The stated direction is inverted, and the inversion matters.** Total cost (fee + subscription):

| Monthly GMV | Free | Basic | Pro | Elite | Better off |
|---|---|---|---|---|---|
| $200 | **$24.00** | $27.00 | $30.00 | $36.00 | free |
| $500 | $60.00 | $60.00 | $60.00 | $60.00 | dead even |
| $1000 | $120.00 | $115.00 | $110.00 | **$100.00** | subscriber |

So **above** $500 a subscriber earns **more**, not less; **below** $500 they earn less. The tiers
are correctly designed — they reward high-volume helpers. The real exposure runs the other way:
a **low-volume** helper who subscribes is quietly worse off (at $200/month GMV an Elite subscriber
pays $36 where free would cost $24). That is a **trust** risk — someone paying $20/month to lose
money — not a platform margin risk, and it changes the recommendation from "watch our margin" to
"don't let a low-volume helper subscribe without seeing the break-even."

Not re-filed, per the orchestrator's instruction; recorded here so the correction is not lost.

## CLOSED: the accepted-bid-price bug is not reachable — the feature was deleted

This lane's mission names a prior bug — *"the accepted bid price was never applied; the original
budget was charged instead"* — and demands it be proven with a real run. **It cannot fire,
because priced bidding no longer exists in the code or in the live schema.**

Proven against **live prod**, not migration history:

1. **`applications` has no price column.** `information_schema.columns` for
   `public.applications` returns: id, job_id, helper_id, message, status, created_at,
   updated_at, attachment_urls, offer_message, stake_amount, stake_status, poster_viewed_at,
   decline_reason. There is no `proposed_price`, no `counter_price`, no `proposed_rate`.
2. **No such column exists anywhere in the schema.** A search of `information_schema.columns`
   across all of `public` for `%proposed%`, `%counter%` or `%bid%` returns **zero rows** — so
   `jobs.bid_ceiling`, `bid_deadline` and `bids_sealed` are gone too.
3. **The DB now forbids any other pricing mode.** `jobs_pricing_mode_check` is
   `CHECK ((pricing_mode = 'set_price'::text))`, and all 64 rows are `set_price`.

The removal is documented in `src/components/postjob/BudgetSection.tsx:12-35`
(`PRICING_MODE_REMOVED`, 2026-08-19), which describes **this exact bug** in its own words:

> *"It also carried a live money bug: a bid job still went straight to escrow at post time and
> charged the hidden fixed-price `budget`, which had nothing to do with the bid ceiling on
> screen (ceiling $200, charge $95). Fixing that meant choosing a payment model for a feature
> nobody had used. Deleting it was cheaper and made escrow coherent: one price, agreed up front,
> held safely."*

It also records that the feature had been used **zero** times in production, and that the bid
columns, counter-offer RPCs and the `trg_enforce_bid_price_lock` trigger were dropped on
2026-08-27. Corroborating comments sit at `appliedJobCard/types.ts:9-16` and
`useApplyFlow.ts:152-156`.

**Verdict: closed by feature removal, not by test.** There is exactly one price on a job — the
poster's budget, set before escrow is funded — and `create-payment` charges `job.budget`
(`index.ts:337`), which is the only price the poster was ever shown. Nothing to fix, nothing to
drive. This is a *negative* result, so it is recorded here rather than filed as a finding.

## Test-mode pass: what it proved, and where the tooling stopped it

Test mode was authorised and used on `acct_1RQbAfKp2H4b7tEC` (`livemode: false` confirmed on
every object). **No live object was created, refunded or transferred at any point.**

**Proved:**
- The fee formula never leaves the platform underwater. Running the real
  `posterServiceFeeCents` across budgets $1–$200 with urgent and onboarding permutations: the
  tier branch wins above ~$3 and the Stripe-cost floor wins below it, and platform net after
  Stripe's actual fee is **≥ $0.00 in every case** (exactly $0.00 at the floor, by design).
  Client and server call the *same* function (`useJobDerived.ts:118` ↔
  `create-payment/index.ts:310`), so shown == charged for the fee amount — the only divergence
  risk is the *percent* input, which is ME-005.
- **A test-mode trap worth knowing:** test mode has **zero** tax registrations while live has an
  active LA one (`taxreg_1TAZVsKp2H4b7tECyvJINQyg`, `state_sales_tax`, active since 2026-03-13).
  A tax calculation in test mode returns `tax_amount_exclusive: 0`,
  `taxability_reason: "not_collecting"`. **Anyone verifying tax amounts in test mode will read
  $0 and could file a false "we never charge tax" finding.** Tax must be verified against live
  reads, as ME-019 was.

**Blocked by tooling, not by policy — these remain UNVERIFIED:**
The Stripe MCP available to this lane is read-mostly for payments. `PostCustomers` and
`PostTaxCalculations` succeed; **`PostCheckoutSessions` is denied by key permissions, and
`PostPaymentIntents` / charge / refund write operations do not exist in the toolset at all**
(`stripe_api_search` for payment-intent and refund *create* returns only GET operations). So
**3-D Secure, insufficient-funds decline, refund settlement, and observed double-tap
idempotency could not be driven** even with test mode authorised.

Closing them needs one of: the Stripe CLI with a test secret key, or a browser session against a
deployment configured with test keys (staging, `okpxtpfvwtmbuxugqsws`, is the candidate — I did
not confirm which Stripe keys it holds). Escrow-session idempotency specifically depends on
`idempotencyKey: escrow-${jobId}` (`create-payment/index.ts:435`) and can only be observed by
creating two Checkout Sessions.

One test-mode artifact was left behind deliberately, labelled for cleanup: customer
`cus_VBgKftnxdL6fqx`, metadata `purpose: "lh-money-escrow audit 2026-09-02"`. It holds no
payment method and was never charged.

## Scope covered

**Charge paths traced end to end** (React form → RPC/edge fn → Stripe call → webhook → payout):
job escrow (`create-payment` action=escrow), tip (`action=tip`), auto-tip (`auto-tip-charge`),
recurring visits (`charge-recurring-visits`), job boost (`create-boost-payment`), background check
(`create-bgc-payment`), Pro subscription (`create-pro-checkout`), PIF donation
(`create-pif-donation`), credit cash-out (`cash-out-credits`), instant payout (`instant-payout`),
scheduled payout (`process-scheduled-payouts`), release (`release-payout`), dispute split
(`execute-dispute-split`), cancellation settlement (`void-cancelled-payments`), onboarding fee
(`pay-onboarding-fee`), auto-release (`auto-release-payment`), reconciliation
(`money-reconciliation`).

**Shared money modules read in full:** `_shared/stripeFees.ts`, `_shared/posterFees.ts`,
`_shared/helperFees.ts`, `_shared/salesTax.ts`, `_shared/payoutClaim.ts`, `_shared/money.ts`;
client `src/lib/stripeFees.ts`, `subscriptionTiers.ts`, `legacyFeeFallback.ts`,
`helperEarnings.ts`, `statusLabels.ts`, `mutationResult.ts`.

**Live prod objects queried (read-only):** `platform_settings`, `cron.job` (43 rows),
`net._http_response`, `jobs` (by `payment_status × is_seed`), `tips`, `payout_transfers`,
`instant_payouts`, `stripe_webhook_events`, `profiles`, and `pg_get_functiondef` for
`enforce_poster_jobs_money_lock`, `sweep_release_last_chance`, `helper_abort_job`.

**Live Stripe objects read:** all 10 live PaymentIntents; Checkout Session
`cs_live_a1KNKGah…`; Charge `py_3TLHu3Kp2H4b7tEC0QySP5mZ`. **Deployed** edge function
`auto-release-payment` v1531 fetched and diffed against the repo.

---

## What I could NOT cover, and why

This is the honest bucket. Each item is a real hard stop, not a skipped cell.

1. **Charge-completing runs.** Test mode was authorised and used, but the Stripe MCP has no
   PaymentIntent / charge / refund **write** operations and its key is denied
   `PostCheckoutSessions` (see the test-mode section above). So these remain unverified, and the
   blocker is **tooling**, not permission:
   - 3-D Secure (`4000 0025 0000 3155`) and insufficient-funds decline (`4000 0000 0000 9995`);
     the declined-checkout-leaves-escrow-untouched assertion.
   - Refund, partial refund, and chargeback settlement.
   - Double-tap idempotency **observed** rather than read (ME-007, ME-013, ME-017 item 8 are all
     read, not driven). Escrow-session idempotency in particular hinges on
     `idempotencyKey: escrow-${jobId}` and needs two real Checkout Sessions to observe.
   - The exact `application_fee_amount` on a post-2026-07-04 tip session (ME-006).
   > Closing these needs the Stripe CLI with a test secret key, or a browser session against a
   > deployment holding test keys. **The accepted-bid-price path is no longer on this list — it
   > is closed by feature removal, which is a stronger result than a passing test.**
2. **No UI screenshots.** The evidence bar for a money claim is Stripe object + DB row + displayed
   number. I have the first two throughout; **the third is missing** because this run was scoped
   to verification and I hold no browser session. Every "displayed" claim above is sourced to the
   JSX that computes it, and is labelled as such.
3. **Sales tax correctness for Louisiana — flagged, not concluded.** The live charges show
   **three different tax bases** on similarly-shaped jobs: `amount 556 / tax 6` (tax on the
   service fee only), `amount 612 / tax 62` (tax on budget + fee), `amount 550 / tax 56`
   (inclusive on the whole). Those are April 2026 charges and may predate the current
   `salesTax.ts`, which taxes only `assembly` and `handyman` labor. **I did not resolve whether
   the current base is correct for LA** — that needs a tax determination, not an audit
   assertion. What I *can* state: `TAXABLE_CATEGORIES = {assembly, handyman}` (`salesTax.ts:43`),
   category is its sole input, and category is editable after funding (ME-010).
4. **Chargeback evidence collection** — belongs to `lh-admin-moderation`; not audited here.
5. **`npm run typecheck` / `vitest` / `lint`** — not run. The orchestrator owns the gate and
   instructed me not to.

---

## Explicit out-of-scope conclusions (PROTOCOL §6)

- **Apple IAP receipt validation** — correctly N/A. Payments are Stripe Connect. The live
  question (does the Pro subscription trip guideline 3.1.1) is `lh-compliance-store`'s;
  I note only that `feature_flags.subscriptions_enabled = false` in prod today, so the
  surface is not currently reachable.
- **Role-gating** — not filed, and I did not look for it. There is no role system.
- **Realm/CoreData/SQLite, offline sync, IAP receipts, peripherals, XCTest** — no analogue in a
  Capacitor + Stripe app; nothing filed.
- **Certificate pinning** — assessed, **wontfix**. Stripe and Supabase calls run over
  ATS-enforced HTTPS from a WKWebView; pinning breaks on routine cert rotation and Apple
  discourages it. No money-path benefit that justifies the operational risk.

---

## What I fixed

**Nothing.** By instruction: this run is `permissionMode: plan` and the lead explicitly held the
fix phase pending verification. That is the whole reason this section is empty, stated in the
first line as PROTOCOL §8.7 requires.

**All 16 verified findings are unfixed and ready.** Recommended order when released, cheapest and
highest-trust first:

1. **ME-006** — one sentence in `TermsSection.tsx:132`. Legal exposure, zero risk. *(Needs an
   owner decision on wording, since the honest phrasing is "tips go to your Helpr minus the card
   processing fee," not "100%.")*
2. **ME-001 copy** — stop promising an auto-release that does not exist, in `ActiveJobSection.tsx`
   and `PostedJobCard.tsx`. The cron pass itself is an owner call.
3. **ME-002 / ME-003** — add `.select("id")` + a zero-row branch to the two webhook writes. Small,
   mechanical, and ME-002 guards the single most important write in the app.
4. **ME-007** — pass `tipAttemptId` from `TipDialog`, copying `CompletionPrompts.tsx:206`. One line.
5. **ME-005** — collapse the three fee sources to the tier ladder.
6. **ME-016** — one shared `subscriptionActive()` helper; keep `helperFees`' null-means-active.
7. **ME-015, ME-013, ME-011, ME-014, ME-008, ME-009, ME-010, ME-004, ME-012, ME-017.**

**Territory note:** every fix above is inside this lane's files (`supabase/functions/*` money
paths, `src/components/TipDialog.tsx`, `src/pages/postjob/*`, `src/components/activity/*`). None
touches `src/index.css`, `AppShell.tsx`, `App.tsx`, or `src/components/ui/*`. **ME-006 touches
`src/pages/legal/TermsSection.tsx`**, which is legal copy — I will not change a binding fee
disclosure without the owner's chosen wording, regardless of plan-mode status.

Per PROTOCOL §1, anything touching money gets `lh-silent-failure` and `lh-authz-rls` run
REVIEW-ONLY over the working diff before commit. I will request both from the orchestrator.

---

## Appendix — re-check this lane yourself

Every live claim above came from one of these. All are read-only.

```bash
# Prod fee configuration (ME-005, ME-008, ME-017/7)
#   -> customer_fee_percent 12, helper_fee_percent 12, onboarding_fee_cents 200, 1 row
select * from platform_settings;

# No cron releases revision escrow (ME-001) -> 43 rows, none matching 'revision'
select jobid, schedule, jobname, active, left(command,200) from cron.job order by jobid;

# Only 3 functions touch the revision columns; only helper_abort_job clears them (ME-001)
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and pg_get_functiondef(p.oid) ilike '%revision_requested_at%';

# budget locked only once funded; category never locked (ME-004, ME-010)
select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'enforce_poster_jobs_money_lock';

# No real money at risk (framing) -> 3 non-seed jobs, all 'unpaid', 0 payment intents
select payment_status, is_seed, count(*), sum(budget), count(stripe_payment_intent_id)
  from jobs group by 1,2 order by 1,2;

# ME-018 retraction -> all 3 rows come back is_seed = true
select subscription_tier, subscription_expires_at,
       stripe_subscription_id is null, is_seed
  from profiles where subscription_tier is not null and subscription_tier <> 'free';

# auto-tip-charge still authenticates (ME-012) -> 200s hourly, latest 2026-09-02 17:07:00Z
select id, status_code, left(content,120), created from net._http_response
 where content ilike '%auto-tip-charge%' order by created desc limit 5;
```

```bash
# Deployed-vs-repo for ME-001: version 1531, still filters revision_requested_at
supabase functions download auto-release-payment --project-ref fncmgoasalhdgfwzhsqa
# (this run used the Supabase MCP get_edge_function, same bytes)

# ME-014: zero hits proves the tax calculation is never committed
grep -rn "createFromCalculation\|tax\.transactions" supabase/ src/

# ME-006 timeline: fee 2026-07-04, contradicting Terms sentence 2026-08-19
git log -1 --format='%h %ad %s' --date=short -L 816,816:supabase/functions/create-payment/index.ts
git log -1 --format='%h %ad %s' --date=short -L 132,132:src/pages/legal/TermsSection.tsx
```

Live Stripe objects (read-only, account `acct_1RQbAfKp2H4b7tEC`): PaymentIntent
`pi_3TLHu3Kp2H4b7tEC0hMXa4x5`, Charge `py_3TLHu3Kp2H4b7tEC0QySP5mZ`, Checkout Session
`cs_live_a1KNKGahOImJSGJ0D1FMf8OAumWAppOkxPah5cJrWv94kZQNBW89ixaz4a`.

### On the evidence checker

`npm run check:audit-evidence -- docs/audit/launch-2026-09/lanes/lh-money-escrow.md` reports
**27 claims found, 7 with evidence.** I am not going to pad the prose to move that number, so
here is the honest read: the residual is dominated by the per-finding verdict rows, whose
artifact is a `file:line` reference — and `file:line` is **not** in the script's
`EVIDENCE_PATTERNS` (it recognises HTTP statuses, row counts, SQL, screenshots, commands, SHAs,
timestamps and code fences). PROTOCOL §3 explicitly *does* accept `file:line` as the evidence
form for a static-analysis finding, so the tool and the protocol disagree here. The script's own
header calls itself "a mirror, not a gate," which is the right way to read the number.

**That gap is worth someone fixing** — a lane whose findings are legitimately static will always
score badly, which trains readers to ignore the output. Adding a `["source-ref", /\b[\w./-]+\.(?:ts|tsx|sql):\d+/]`
pattern would close it. Not my lane's file, so I am flagging it rather than editing it.
