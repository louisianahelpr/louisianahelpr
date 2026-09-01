> # ⚠️ STALE — DO NOT FOLLOW THIS DOCUMENT
>
> **Everything below describes a feature that no longer exists.** Do not create
> the three Stripe Prices it asks for.
>
> The business/seat backend was dropped by migrations `20260828004538` and
> `20260828011811` (`businesses`, `business_members`, the seat ladder, the
> verification queue). There is no `create-business-seat-checkout` function and
> no `_shared/businessSeatTiers.ts` — the file this doc's premise ("everything
> on the Helpr side is already wired") depended on. The `business` subscription
> tier itself was retired on 2026-09-01: it is gone from `TIER_PERKS`,
> `TIER_FEE_PERCENT`, `TIER_DISPLAY_NAMES`, the early-access ladder and the
> `get_open_jobs_for_map` SQL, and a prod census that day found zero rows
> holding it.
>
> The six `STRIPE_PRICE_SEAT_*` edge secrets and the Crew/Team/Enterprise
> Products still live in the Stripe account. Nothing reads them. They are listed
> for the owner to archive; see the tier-retirement report.
>
> Kept only as a record of what was once planned.

# Annual seat Prices — setup steps

Everything on the Helpr side is already wired. The only thing missing is three
Stripe Price objects, which can only be created in Stripe. This is the whole
job; it should take a few minutes.

## What you're creating

Three **yearly recurring Prices**, against the **same three Products** the
existing monthly Prices already use. Do **not** create new Products — a new
Product would split reporting and break the "same plan, different cadence"
relationship.

| Tier | Existing monthly Price | New annual Price | Why that amount |
|---|---|---|---|
| Crew | `price_1TpvLSKp2H4b7tECkJALCpxj` — $20/mo | **$200.00 / year** | $20 × 10 — two months free |
| Team | `price_1TpvLdKp2H4b7tECODF3U9RJ` — $30/mo | **$300.00 / year** | $30 × 10 — two months free |
| Enterprise | `price_1TQKGaKp2H4b7tECp6ZNxarR` — $40/mo | **$400.00 / year** | $40 × 10 — two months free |

Starter is free and has no Price.

The pay-10-months-get-12 ratio is the same one the consumer tiers already use
(Pro is $10/mo or $100/yr), so the two pricing pages stay consistent. These
amounts are already displayed on `/for-business` under the Annual toggle — if
you create different amounts, update `annualPriceCents` to match or the page
will advertise a price Stripe doesn't charge.

## Steps in Stripe

1. Stripe Dashboard → **Product catalogue**.
2. Open the **Crew** product (the one holding `price_1TpvLSKp2H4b7tEC…`).
3. **Add another price** →
   - Type: **Recurring**
   - Billing period: **Yearly**
   - Amount: **$200.00 USD**
   - Leave it in the same currency and tax behaviour as the monthly Price.
4. Save, then copy the new Price ID (`price_…`).
5. Repeat for **Team** ($300.00) and **Enterprise** ($400.00).

Make them in **live** mode — the existing IDs above are live Prices.

## Then, either option (no code change needed for option A)

### A. Environment variables — nothing to deploy but the secrets

Set these on the Supabase project (Edge Functions → Secrets):

```
STRIPE_PRICE_SEAT_CREW_ANNUAL=price_...
STRIPE_PRICE_SEAT_TEAM_ANNUAL=price_...
STRIPE_PRICE_SEAT_ENTERPRISE_ANNUAL=price_...
```

The lazy getter in `supabase/functions/_shared/businessSeatTiers.ts` prefers the
env var, so annual checkout starts working as soon as these are set.

### B. Hardcode them

In `supabase/functions/_shared/businessSeatTiers.ts`, replace the three
`stripePriceIdAnnual: null` values with the new IDs, then redeploy:

```bash
supabase functions deploy create-business-seat-checkout --project-ref fncmgoasalhdgfwzhsqa
```

## How to confirm it worked

Until the Prices exist, requesting an annual checkout returns a deliberate hard
error rather than silently charging monthly:

> Annual billing isn't set up for the crew seat plan yet. Choose monthly, or set
> STRIPE_PRICE_SEAT_CREW_ANNUAL.

That message disappearing is the signal it's live. `ANNUAL_SEAT_PRICING_AVAILABLE()`
in the same module returns true once all three resolve.

## Why the checkout hard-errors instead of falling back

`create-business-seat-checkout` resolves the annual Price separately and never
falls back to the monthly ID. A fallback would charge $20 for what the UI just
offered as a $200/year plan and hand the customer a monthly subscription they
didn't choose. A blocked checkout is recoverable; a wrong charge is not.

## Related, already done

- The monthly/annual toggle on `/for-business` is live and presentational — the
  tier CTAs link to `/signup`, so it cannot start a checkout against a Price
  that doesn't exist yet.
- `create-business-seat-checkout` accepts an optional `interval` (`"month"`
  default, so existing callers are unchanged) and records it in the
  subscription metadata.
- Buying a seat plan now grants the fee and early-access tier it advertises —
  see `check-business-seat-subscription`.
