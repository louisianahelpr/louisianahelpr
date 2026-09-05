# Taxable jobs are collecting $0 sales tax — and it is not the code

**Filed 2026-09-04.** Verified read-only against prod (`fncmgoasalhdgfwzhsqa`)
and against the shipped edge-function source. **Needs one owner action in the
Stripe Dashboard; there is nothing to fix in this repo.**

## What was observed

Every job in a taxable category carries `sales_tax_amount = 0` and
`sales_tax_rate = 0`. Not a legacy artefact — **three of them were created on
2026-09-04**, through real Checkout Sessions, and are sitting in `escrow`:

| created_at (UTC) | category | budget | tax | payment_status |
|---|---|---|---|---|
| 2026-09-04 20:13 | handyman | $95 | 0 | escrow |
| 2026-09-04 16:09 | handyman | $65 | 0 | escrow |
| 2026-09-04 15:46 | handyman | $120 | 0 | escrow |

So the first hypothesis — "these predate the 2026-08-23 decision to tax
handyman" — is **false**, and can be retired.

## Why it is not the integration

Each of these was checked against the shipped source, not recalled:

- `_shared/salesTax.ts:44` — `TAXABLE_CATEGORIES = {assembly, handyman}`. Both
  observed categories are in it.
- `create-payment/index.ts:191, :425` — `automatic_tax: { enabled: true }` on
  the Checkout Session. We ARE asking Stripe to compute tax.
- `create-payment/index.ts:340` — the labor line ships
  `tax_code: laborTaxable ? "txcd_20030000" : "txcd_00000000"`, so a taxable
  job sends a genuinely taxable code, not the exempt one.
- `create-payment/index.ts:176, :422` — `customer_update: { address: "auto" }`,
  so Checkout collects and persists the billing address. **This rules out the
  other common cause of a zero:** Stripe Tax cannot locate a sale without a
  customer address, and it has one.
- `stripe-webhook/handlers/checkoutSessionCompleted.ts:717-747` — the stored
  rate is *derived*: `tax / budget`. Budget is non-zero on all three rows, and
  the branch writes a number whenever Stripe supplies one. A stored rate of 0
  therefore means **Stripe returned a tax of 0**, not that we failed to write it.

That last point is what makes this conclusive rather than circumstantial. The
zero is Stripe's answer, not our default.

## The remaining explanation

Stripe Tax computes tax **only in jurisdictions where the account holds an
active registration.** With `automatic_tax` enabled, a taxable tax code, and a
located customer, an account with no Louisiana registration returns exactly
what is observed: `$0`, with no error and no warning anywhere.

**Owner action:** Stripe Dashboard → **Tax → Registrations** → confirm whether
Louisiana is listed and active. This could not be checked from here — the
Stripe MCP connection's token has expired and needs re-authorisation.

## Why this matters more than the dollar amounts

Nothing in the product records whether tax collection is actually live, so the
failure is silent in both directions:

1. **The earnings export contradicts the ledger.** `is_category_taxable()`
   labels each row `Taxable` / `Exempt` from the CATEGORY
   (`20260830221407_fix_earnings_export_category_cast.sql:56`), independent of
   what was collected. An accountant reading that export sees rows marked
   **Taxable carrying $0 tax**, with nothing on the page explaining the gap.
2. **The 2026-08-23 decision has had no effect.** The owner's instruction was
   "just add the tax for handyman so we are covered either way" — deliberately
   erring toward over-collecting. If there is no registration, handyman was
   added to `TAXABLE_CATEGORIES`, the code has been correct ever since, and the
   collected amount never changed. The decision reads as implemented and is not.

## Not a recommendation to register

Whether to register for Louisiana sales tax is a tax question with real
consequences either way — collected tax must be remitted, and registering
creates filing obligations. That is a call for the owner and their CPA. This
document only establishes that **the app is asking correctly and Stripe is
answering zero**, so the answer lies in the Stripe account rather than in code.

## If registration IS active

Then this is a genuine Stripe-side defect and the next step is a single Tax
Calculation preview in the Dashboard for a $100 `txcd_20030000` line to a
Louisiana address. That distinguishes a bad tax code from a bad location in one
step. Nothing further should be changed in this repo before that.
