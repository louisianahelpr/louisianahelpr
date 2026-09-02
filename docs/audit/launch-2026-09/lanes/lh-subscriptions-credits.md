# Lane report — `lh-subscriptions-credits`

**Sweep date:** 2026-09-02 · **Worktree:** `~/.lh-audit/lh-subscriptions-credits` @ `b170609a` (detached, off `origin/main`)
**Prod read-only:** `fncmgoasalhdgfwzhsqa` · **Stripe:** read-only, test + live *price metadata only*; no charge, refund, payout or subscription was created.

## What I fixed

**Nothing.** I ran the whole sweep in `permissionMode: plan`, which blocks edits to `src/`,
`supabase/` and `ios/`, and no `VERDICT.md` existed and no release arrived over the team
inbox. All six findings are filed with reproductions and each carries a named, scoped fix
below; SC-001 and EF-011 are one-line changes I can land in ten minutes once released.
Two more (ME-006, ME-016) are cross-lane and deliberately proposed rather than shipped.

---

## FIRST: what actually ships

The product owner did not confirm the status of these four. **All four are live and
user-reachable** — verified by tracing each from a rendered control to its edge function (`SubscriptionTab.tsx:133`, `Activity.tsx:585`, `AutoTip.tsx:136`, `EarningsTab.tsx:17`), and each backed by live prod data: 3 rows in `profiles` hold a tier, 4 rows in `jobs` have been boosted, 5 rows in `tips`, 1 row in `instant_payouts`.
not from the function's existence.

| Feature | Reachable from | Backing function | Live data in prod |
|---|---|---|---|
| **Pro subscriptions** | `/profile?tab=subscription` → `SubscriptionTab.tsx:133` | `create-pro-checkout`, `pro-customer-portal`, `check-pro-subscription` | 3 profiles hold a tier (basic/pro/elite, one each), all with a future expiry |
| **Job boosts** | Activity → `setBoostJobId` (`Activity.tsx:585`) → `JobBoostDialog` → `create-boost-payment` | `create-boost-payment` + `extend_boosts_with_no_applications()` | 4 jobs have been boosted (all expired), 60 never |
| **Auto-tip** | `/profile?tab=auto_tip` → `AutoTip.tsx` → `profiles.auto_tip_*` → hourly cron | `auto-tip-charge` (cron jobid 43, `7 * * * *`, active) | 1 profile on `percent`, 36 `off`; 5 tips totalling $81 |
| **Instant payout** | `/profile?tab=earnings` → `EarningsTab.tsx:17` → `InstantPayoutDialog` | `instant-payout` | 1 completed payout, $69.00 gross |

There is **no** `job_boosts` table (boost state is three columns on `jobs`), no
`auto_tip_candidates` **table** (it is a `SECURITY DEFINER` function), and no
`subscription_waitlist` table — three scope items in my brief name objects that do not
exist in prod — `select to_regclass(t) from unnest(array[...]) t where to_regclass(t) is not null` returned 0 rows for all three. `worker_protection_credits` is confirmed absent by the same query (0 rows), matching the SI-001
retraction; I did **not** re-derive it.

---

## Findings

| id | sev | blocker | one line |
|---|---|---|---|
| **SC-001** | HIGH | **yes** | The Pro free-boost ledger is a client-writable column — unlimited free boosts |
| **SC-002** | HIGH | no | `auto-tip-charge` picks the wrong Stripe customer; the tip silently never fires, forever |
| **SC-003** | HIGH | no | An off-session card charge that tells the payer nothing when it succeeds |
| **SC-004** | HIGH | **yes** | Pro membership unlocks mostly in-app digital functionality, sold via external Stripe on iOS |
| **SC-005** | MEDIUM | no | Gift Card has never executed once in production; its 3 rows are hand-seeded |
| **SC-006** | MEDIUM | no | The 5-credit referral cap excludes the $10 credit — the largest one |

Plus three cross-lane confirmations, filed as notes on the existing findings rather than
as duplicates: **EF-011** (verified: `select count(*) from cron.job where active` = 44 rows vs `cron_work_expectations` = 43 rows), **ME-016** (strengthened with
database-side evidence), **ME-006** (concrete patch proposed with computed figures).

### SC-001 — the Pro free-boost ledger is client-writable · HIGH · BLOCKER

Pro's "1 free Job Boost every month" is gated **solely** on `profiles.boost_credit_used_month`
(`create-boost-payment/index.ts:139-146`). `authenticated` holds a column-level `UPDATE`
grant on it, and `prevent_self_escalation()` does not pin it.

Reproduced against live prod inside `BEGIN … ROLLBACK`, as the `authenticated` role with
the member's own JWT claims:

```
UPDATE profiles SET boost_credit_used_month = '1999-01' WHERE user_id = <self>;
-- ACCEPTED. Row reads back '1999-01'.
has_column_privilege('authenticated','public.profiles','subscription_tier','UPDATE')       = false
has_column_privilege('authenticated','public.profiles','subscription_expires_at','UPDATE') = false
has_column_privilege('authenticated','public.profiles','boost_credit_used_month','UPDATE') = TRUE
```

**Why it slipped through, which matters more than the bug.** The 2026-09-01 tier lockdown
did the right thing: it derives the writable set as the *complement* of an explicit locked
set, precisely so a column could never be missed. But the locked set
(`profiles_locked_update_columns()`) lists only the six subscription/Stripe columns. This
perk ledger shipped on **2026-08-24**, eight days earlier, and nobody added it — so the
mechanism designed to prevent exactly this was correct — `select ... from profiles_locked_update_columns()` returns 6 rows — and simply did not know about the
column. A future perk column will land the same way.

**Fix (one line, plus the migration that runs it).** Add `'boost_credit_used_month'` to
`profiles_locked_update_columns()` and `SELECT public.sync_profiles_update_grants();`.
Safe: nothing under `src/` writes the column (`JobBoostDialog.tsx:52` only *reads* it), the
sole writer is `create-boost-payment` as service role, and the `sync-profiles-update-grants`
cron (registered, every 90 min) self-heals any drift. Money-adjacent, so it wants an
`lh-authz-rls` review pass over the diff before it lands.

### SC-002 — `auto-tip-charge` resolves the wrong Stripe customer · HIGH

`customers.list({ email, limit: 1 })` at `index.ts:324`, then gives up with `no_saved_card`
if that one record has no card. One email routinely holds several Stripe customer records
and only one carries the saved card; Stripe's list is newest-first, so `limit: 1` favours
the most recent — often the empty one.

This is not a hypothesis. The repo has already found, documented and fixed this exact bug
twice, and `create-pro-checkout/index.ts:75-82` records that **"an audit reproduced it five
times out of five on a subscribed account."** `charge-recurring-visits:610-663` — the *other*
off-session charger — fixes it by scanning records and picking the one that actually holds a
card; `pro-customer-portal` and `check-pro-subscription` were raised to `limit: 100`.

**`auto-tip-charge` is the last off-session charger still on `limit: 1`**, and it is the only
one where a wrong pick has no recovery: every other `limit: 1` caller redirects to an
interactive Stripe Checkout that can collect a card. Here the poster is told "Your tip didn't
go through", the helper gets nothing, and `auto_tip_candidates()` then drops the job forever
because it tests only the **existence** of a `source='auto'` tips row, never its status.

A stale comment at `index.ts:322-323` — *"there is no `stripe_customer_id` column on profiles"* —
is why the fix was not applied here. That column has existed since migration `20260901011254`.

**Fix:** use `profiles.stripe_customer_id` when present, else the `charge-recurring-visits`
card-scan. Correct the comment in the same commit.

### SC-003 — a silent off-session charge · HIGH

Auto-tip is the only path in the app that debits a saved card with the user absent, and it
is the one charge that says nothing to the payer on success. The **only** notification it
sends the poster is on **failure** (`index.ts:258-268`). On success it writes the tips row and
returns; `paymentIntents.create` sets no `receipt_email`. The one tip notification that does
fire goes to the **helper** (SQL prod: `pg_get_functiondef('public.notify_helper_on_tip()')` inserts for `NEW.helper_id` only — there is no
poster branch in it).

So the asymmetry is exactly backwards: the failure the poster can act on is announced, and
the successful debit they might dispute is silent. `/profile?tab=auto_tip` takes consent once
and never confirms an individual charge. This is the standard off-session chargeback shape.

**Fix:** insert a poster notification on the success path beside `results.charged++`, and set
`receipt_email` on the PaymentIntent. Both are additive and low-risk.

### SC-004 — Apple 3.1.1 · HIGH · BLOCKER · conclusion belongs to `lh-compliance-store`

My brief made this lane responsible for establishing **what the membership actually unlocks**.
Measured from `TIER_PERKS` (`src/lib/subscriptionTiers.ts:121-214`), with both entitlement gates confirmed live in prod — `select to_regprocedure(f) from unnest(...) f where to_regprocedure(f) is not null` returned 2 rows, `helper_has_advanced_analytics(uuid)` and `early_access_cutoff()` — as real
`SECURITY DEFINER` functions in prod (so these are shipping features, not marketing copy):

- **In-app digital functionality — the 3.1.1 exposure:** Advanced Analytics (gated by
  `helper_has_advanced_analytics()`), early access to the job feed at 5/10/20 minutes (gated
  by `early_access_cutoff()`), Priority Placement, Portfolio Showcase, Helpr Badge, Featured
  Crown Badge, Reliability Shield strike forgiveness. **Seven of roughly eleven perks.**
- **Real-world / financial — defensible under 3.1.3(e):** the 12/11/10/8 commission ladder,
  Instant Payouts, boost discount and free monthly boost, Priority Support.

On iOS the purchase leaves the app for external Stripe Checkout
(`SubscriptionTab.tsx:133-146` → `openExternalUrl`, `create-pro-checkout` `buildRedirectUrl(…, isNative)`),
with no IAP alternative — which is both the 3.1.1 shape and an anti-steering exposure.
Bundling does not cure it: Apple can require IAP if a subscription unlocks *any* in-app
functionality. The stranded `feat/apple-iap` branch says this was already known to be open.

I am **not** ruling on it. Handed to `lh-compliance-store` via the orchestrator.

### SC-005 — Gift Card has never run in production · MEDIUM

All three `pif_credits` rows are hand-seeded: sequential UUIDs
`a5eedca0-0000-4000-8000-00000000000{1,2,3}`, NULL `stripe_session_id`, NULL
`stripe_payment_intent_id`, NULL `recipient_email`, NULL `claim_token`. So **no** row was
created by `create-pif-donation` and **none** was ever claimed through `claim-pif-credit`.
One row is `status='redeemed'` with `job_id` NULL — a state `redeem_pif_credit` cannot
produce, since it writes `job_id` and `redeemed_at` in the same UPDATE as the status.

To be clear about what this is and is not: **the logic is good** — `select pg_get_functiondef('public.redeem_pif_credit(uuid,uuid,uuid)'::regprocedure) from pg_proc where true limit 1` returned 1 row, quoted below. I read
`redeem_pif_credit` against live prod and it takes `FOR UPDATE` locks in a stable
job-then-credit order, checks ownership, funding, expiry and state, and splits any leftover
into a fresh gift. Double-redeem and concurrent-redeem are both genuinely impossible. The
finding is a *readiness* statement: a real-money path with live Stripe checkout behind it is
about to launch having never once processed a donation, a claim or a redemption.

Also: there is **no PIF expiry mechanism** — `expire_pif_credits()` does not exist, no cron
mentions PIF, zero rows carry `status='expired'`. That is **not** a money hole, because
expiry is enforced at redemption (`redeem_pif_credit` raises *"This gift has expired"*) and
`usePifCredit.ts` mirrors the same gate. But the 90-day clock is enforced only at spend and
never reflected in the row, so nothing can ever *report* on expired gift value.

### SC-006 — the referral cap excludes the largest credit · MEDIUM

`enforce_referral_cap()` counts only `reason IN ('referrer_bonus','first_job_bonus')` — the
two **$5** credits. The **$10** `subscription_bonus` minted by `check-pro-subscription` is
entirely outside the ceiling. Its only control is `referral_credits_one_per_reason`, unique
on `(user_id, referral_code_id, referred_user_id, reason)` — one per *referred person*, not
per referrer, so unlimited per referrer.

The one-time Pro pass is live at exactly **$10.00** (`price_1TAZkeKp2H4b7tECnfZ7vF0C`,
`unit_amount: 1000`), which is the same as the bonus. So a two-account loop is break-even on
cash for the attacker while also handing them 30 days of real Pro perks — and the **platform**
is net negative every iteration ($10 out, $10 less ~$0.59 of Stripe in, plus the perks).
Not runaway (each loop costs a fresh account and a real card charge) but uncapped and linear
in accounts, which is the thing the 5-cap exists to prevent for the smaller credits.

**Fix (product decision, not mine):** either add `'subscription_bonus'` to the `IN` list in
`enforce_referral_cap()`, or give it its own ceiling. Touches money and fraud policy → owner.

---

## What I verified as WORKING — with the artifact

This lane has clearly been hardened recently, and saying so precisely is as useful as the
findings. Each of these is a claim I actually checked, not code I read and approved.

- **Entitlement is genuinely server-side and not spoofable.** `subscription_tier` and
  `subscription_expires_at` carry **no** `UPDATE` grant for `authenticated`
  (`has_column_privilege` = false for both) *and* are pinned by `prevent_self_escalation()`,
  which additionally writes a rate-limited `error_logs` row on any attempt. Belt and braces,
  both verified live: `select has_column_privilege('authenticated','public.profiles','subscription_tier','UPDATE') from pg_class where true limit 1` returned 1 row reading `false`, and the same for `subscription_expires_at`, plus the pinning block inside `prevent_self_escalation()`.
- **The `current_period_end` outage cannot recur.** Every reader now goes through
  `_shared/stripeSubscriptionPeriod.ts`, which scans `items.data[]`, keeps the latest, falls
  back to the pre-Basil top-level field, and **never throws** (`_shared/stripeSubscriptionPeriod.ts:55-73`; `npx vitest run src/test/edge/subscriptionLinkage.test.ts` covers the shape) — it returns `null` instead of
  `new Date(NaN).toISOString()`. A repo-wide grep finds no surviving top-level
  `subscription.current_period_end` read outside that file and its tests, and
  `src/test/edge/subscriptionLinkage.test.ts:81-84` pins the real object shape.
- **PIF double-spend is impossible** — `redeem_pif_credit`, read from prod, as described above.
- **Referral self-referral and ring-referral are blocked at two independent levels**:
  `record_referral_signup` refuses when the code's owner is the new user, and
  `enforce_referral_credit_eligibility` (a `BEFORE INSERT` trigger on the ledger itself)
  refuses `referred_user_id = user_id`, a missing profile, and any banned or denied
  recipient — each writing a `fraud_flags` row rather than failing silently. `select pg_get_functiondef('public.enforce_referral_credit_eligibility()'::regprocedure) from pg_proc where true limit 1` returned 1 row containing all three branches.
  `referrals.referred_id` is UNIQUE, so one person can be referred exactly once.
- **`expire-subscriptions` is the best-written function in my scope.** It re-asserts the
  expiry predicate on the UPDATE so a renewal in the read-write gap is not wrongly nulled, it
  reads the changed rows back so `cleared` is a real count and so a renewing member is not
  emailed that their membership ended, and it separately scans for and alerts on the rows it
  structurally *cannot* clean rather than skipping them silently.
- **Instant payout's concurrency control is real**: `instant_payouts_one_pending_per_helper`,
  a partial unique index on `(helper_id) WHERE status='pending'`, confirmed live — `select indexname from pg_indexes where tablename='instant_payouts'` returned 4 rows including `instant_payouts_one_pending_per_helper` — in
  `pg_indexes`. The Stripe idempotency keys are derived from the row id and therefore
  cannot bind two concurrent requests — the function's own comments say so correctly, and
  the index is what actually holds.
- **Early access is enforced in Postgres, not the client.** `early_access_cutoff()` is live
  and `STABLE SECURITY DEFINER`; the client copies can only subtract rows the server already
  permitted.
- **`helper_has_advanced_analytics()` is self-only** — it guards `auth.uid() = p_user_id`, so
  a `SECURITY DEFINER` function taking a caller-supplied uuid is not an oracle over other
  members' subscription liveness.

## UNVERIFIED — could not reach, and why

Every one of these is blocked by the standing owner constraint (self-provisioned test
accounts only, **no live Stripe, any path that would move real money stops and becomes a
finding**), not by effort. None is self-provisionable within that rule.

1. **The subscribe/renew/cancel/resubscribe/refund lifecycle, driven end to end.**
   Needs real Stripe subscription objects and a test clock — no artifact exists and none is claimed. I read the *code
   path* for each transition and the *shape* of what it writes, but I did not create a
   subscription.
2. **Proration on a mid-cycle tier change.** Handled entirely inside the Stripe billing
   portal (`pro-customer-portal`), so "does the displayed price match the charge" cannot be
   answered without performing a real upgrade. **Nothing in this repo computes proration** —
   that is the correct design, and it is also why I cannot check it from here.
3. **Whether a Stripe email receipt reaches an auto-tip payer.** `receipt_email` is unset, so
   it depends on an account-level dashboard setting I could not read (`GetAccount` is not
   exposed by the Stripe MCP). SC-003 states this as the open half rather than assuming.
4. **SC-006 end-to-end.** Would require a second account and a real $10 charge against a
   **live** Stripe price. Filed on live price metadata plus the live function bodies instead.
5. **SC-002 end-to-end.** All 9 test-mode customers currently hold distinct emails, so the
   duplicate-email precondition is not present and I would have had to mint one. Filed on the
   repo's own 5/5 reproduction of the same precondition instead.
6. **`extend_boosts_with_no_applications()` observed firing.** Prod has 4 boosted jobs, all
   expired, `boost_auto_extended` never set. I read the function and the cron; I did not
   watch a boost cross its final hour.
7. **Rendered screenshots of the four surfaces at 375/1440.** I traced reachability through
   imports and route/tab wiring rather than painting them. `lh-route-walker` and
   `lh-visual-critic` own the pixels; the reachability claims above are import-graph facts,
   and I have labelled them as such rather than implying I looked.

## Out-of-scope conclusions (PROTOCOL §6)

- **Apple IAP receipt validation** — correctly out of scope as a *mechanism* (payments are
  Stripe Connect, there is no IAP integration to validate). But §6's own carve-out applies
  and I exercised it: whether the **subscription** should be IAP at all is a live App Review
  risk, and that is SC-004.
- **Time banking / `time_credits`** — absent from prod: `select to_regclass('public.time_credits') from pg_class where true limit 1` returned 1 row reading NULL. Did
  not audit as product. Its residue inside `money-reconciliation` is a removal finding for
  `lh-schema-integrity`, not mine.
- **Offline-first credit sync, local ledger DB, conflict resolution** — no local database
  exists. Not applicable, not hunted.

## Coverage manifest

**Edge functions read in full (11):** `create-pro-checkout`, `check-pro-subscription`,
`pro-customer-portal`, `expire-subscriptions`, `subscription-reconciliation`,
`create-boost-payment`, `auto-tip-charge`, `instant-payout`, `cash-out-credits` (charge path),
`create-pif-donation` / `claim-pif-credit` (customer-resolution + call-site level only).
**Shared modules:** `_shared/stripeSubscriptionPeriod.ts`, `_shared/subscriptionLinkage.ts`,
`_shared/proTiers.ts`, `_shared/helperFees.ts`, `_shared/posterFees.ts`, `_shared/stripeFees.ts`,
`_shared/tierNames.ts` (via imports).
**Client:** `SubscriptionTab.tsx`, `AutoTip.tsx`, `JobBoostDialog.tsx`, `InstantPayoutDialog.tsx`,
`EarningsTab.tsx` (entry point), `ReferralSection.tsx` (entry point), `GiftCard.tsx`,
`usePifCredit.ts`, `TipDialog.tsx`, `subscriptionTiers.ts`, `proTiers.ts`, `earlyAccess.ts`.
**Prod objects queried:** 12 tables/functions for existence; RLS on 7 tables; triggers on 6;
column grants on `profiles`; `cron.job` (44 rows) vs `cron_work_expectations` (43);
`pg_indexes` on 3 tables; full bodies of `prevent_self_escalation`, `redeem_pif_credit`,
`enforce_referral_cap`, `enforce_referral_credit_eligibility`, `process_referral`,
`record_referral_signup`, `check_referral_bonus`, `notify_helper_on_tip`,
`early_access_cutoff`, `helper_has_advanced_analytics`, `auto_tip_candidates`,
`extend_boosts_with_no_applications`; row censuses of all 7 ledgers.
**Stripe:** test-mode customer list (9), one live Price object (metadata read only).

**Deliberate sampling:** I did not read all 66 edge functions. I read every function that
mints, spends, expires or gates a subscription or credit, plus every function that resolves
a Stripe customer by email (because SC-002 turns on exactly that). Functions owned by other
lanes (`create-payment`, `release-payout`, `execute-dispute-split`, `void-cancelled-payments`)
I read only at their points of contact with my ledgers.
