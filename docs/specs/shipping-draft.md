# Shipping for Declutter and Shops (SPEC; S1 in progress)

Status: owner decided 2026-10-20; money review done (approve with fixes, folded into sections 5-9); S1 (data model + fee) landed; S2 restarted 2026-10-30 (owner: "restart shipping NOW"), database part on wip/b50-s2-db; tax questions S1-S3 answered in 4.1. Switch: `declutter_shipping` (lead 2026-10-30, replaces `shipping` in 9.2). Tracked as Q2259 in docs/OPEN.md.
Nothing gets built until both are done. Owner order 10-20 ~01:10Z: discounted USPS labels through
Shippo or EasyPost, the buyer pays shipping at checkout, the seller prints the label, tracking shows in
the app, a "shipped" handover with a buyer window after delivery, the seller is paid when the sale is
final, and a FREE 10-pack of poly mailers on request for active sellers (the owner pays for the bags
and their postage: the one stated exception to "we never absorb a fee").

Every price below was read from the source named beside it on **2026-10-20 between 02:19Z and 02:30Z**
(`date -u`). Figures I could not read from the provider's own page say so.

## Decided 2026-10-20 (owner pop-ups ~02:40Z, relayed by the lead)
1. **Provider: EasyPost**, funded from the bank (ACH, auto-reload; never a card top-up, which costs 3.75%).
2. **Buyer fee = 5% of (items + shipping) + 70 cents** on shipped orders (fee rule `f1_ship`); pickup,
   porch and delivery orders keep F1 on items only.
3. **Louisiana addresses only** (ZIP 700xx-714xx, checked server-side).
4. **Buyer window: 2 days (48 h) after "delivered"**; "I got it" ends it early (shown only after the
   delivered scan, review fix 10).
5. **Lost or broken in the mail = the seller.** The buyer gets everything back; the USPS insurance payout
   goes to the seller (after any debt on that order); the seller may add extra insurance at listing, paid
   by the buyer inside the shipping line.
6. **Spent label on a refund = whoever caused it**; an unused label is voided (money back to the wallet).
7. **Free mailers: PAUSED** ("launch that part later"): a later phase, out of v1; no admin queue now.
   Section 10 stays as the design for then.
8. **Small only**: Declutter size `small`; Shops items the maker marks shippable; cottage food never.

## Decided 2026-10-29 (owner, relayed by the lead 2026-10-30 ~00:40Z)
9. **Seller-paid shipping.** A seller may tick "I'll pay shipping" on a listing: the item shows "Free shipping",
   the buyer pays $0 shipping, and the label cost comes out of the seller's payout at label purchase. The buyer's fee
   is then F1 on items only (shipping_cents = 0 on the order), which already covers the card fee on every order
   (5.1: margin = 0.01955 I + 37.97c US, 0.0038 I + 36.92c international); the S2 PGlite fee sweep proves it for
   every items amount up to $20,000. The label is bought only when it fits inside the seller's payout for that
   order (a label dearer than the items is refused before buying, never a debt by surprise). Money: lh-money-escrow.
10. **Bundles ship on ONE label.** Several items from the same seller in one cart are one order and one parcel:
    weight = sum of the items' preset weights + the box, dimensions of the combined box (review fix 15 already said
    one parcel per order); never one label per item.
11. **Cheapest automatically.** Weight tiers, with "Under 4 oz ships cheapest" on the seller's form; USPS Cubic
    requested whenever the parcel qualifies (under 20 lb and up to 1 cubic foot: ship-rates always sends the box
    dimensions); USPS Connect Local only if EasyPost supports it (4.2: not found in any EasyPost doc; checked
    against the live carrier list once ship-rates can quote).
12. **Local first.** On the item page and at checkout, free porch pickup or a meetup is shown ABOVE shipping when the
    buyer is close enough; shipping is the fallback.
13. **At most 3 options, cheapest first and pre-selected; never air or overnight.** Filtered by carrier and service
    in ship-rates (server), never in the client. Owner's own test quote in the EasyPost dashboard (lead, 00:40Z):
    USPS Ground Advantage $6.15, UPS Ground $7.60, USPS Priority $8.01, FedEx/UPS air up to $107. So the allowed set
    is USPS Ground Advantage (incl. cubic), USPS Priority (the one faster option) and UPS Ground; Express, air and
    overnight services are dropped.
- Note: the EasyPost label fee is $0 for the first 3,000 labels a month; members pay only the postage, with no markup.

## 1. What exists today (read from origin/main e20c7a205)
- Declutter handover modes: `declutter_orders.handover IN ('pickup_home','porch','delivery')`
  (20261017055505). Spec row 24 says "Shipping NOT at launch"; terms draft line 76 says shipping is
  not available yet (both change when this ships).
- Money model: separate charges and transfers. `supabase/functions/declutter-checkout` opens one Stripe
  Checkout per order, card only (`payment_method_types: ["card"]`, line 266), no transfer_data, so the
  money stays on the platform until handover. Lines: items, "Buyer's fee (5% + 70¢)", optional "Helpr
  delivery", all `NONTAXABLE_TAX_CODE`. `total_cents = items + premium + tax + delivery` is a DB
  constraint.
- F1 fee: `declutter_buyer_fee_cents(items) = round(items*0.05)+70` (20261015023613). The base is ITEMS
  ONLY. Shops use the same function (20261018164442).
- Payout (row 93): the seller is paid when the handover is confirmed. Fee debts come out of any future
  payout (owner 10-20). Problems (row 96): "Report a problem" until the seller is paid; then final.
- Item size: `size IN ('small','large','xl')` (20261017055505 line 87). Categories are free slugs
  (furniture, appliances, electronics, kitchen, home_decor, tools, outdoor_garden, sports_outdoors,
  toys_games, baby_kids, clothing, books_media, other: `src/lib/declutter/categoryIcons.ts`).
- Banned items: `declutter-ai-draft/index.ts` `BANNED_RULE` (row 34 list), flags to an admin queue.
- Shops (`supabase/functions/shop-checkout`): a manual-capture card hold (line 362) captured when the
  maker accepts; Stripe Tax `automatic_tax`; Q2102 moves held orders to the PaymentIntents tax flow
  and taxes at the pickup address (performance_location). O4: delivery is a later slice.
- Feature switches: `feature_switches` + `feature_enabled_for(key)` (20261012031120); edge functions
  call `requireFeature`.

## 2. Provider choice: EasyPost (recommended) vs Shippo — measured
| | EasyPost | Shippo |
|---|---|---|
| Monthly fee | $0 ("Free Access", wallet carriers) [1] | $0 ("API Starter") [2] |
| Per-label fee | $0 for the first 3,000 labels/month [1]; $0.08 each after (EasyPost help-center Billing FAQ as quoted by search and costbench.com [3]; the help center blocks direct fetch, so NOT read first-hand) | first 30/month free, then $0.07 each [2] |
| How we pay | prepaid wallet; card top-up has a **3.75% fee**, ACH is free but takes a few days; auto-reload below a minimum [4] | the card on file is charged per label once a billing threshold is reached [5] (whether Shippo adds a card surcharge: NOT found) |
| Label refund (unused USPS) | request within 30 days of creation; at least 15 days to process; must have no USPS scan; postage AND EasyPost fees go back to the wallet [6] | request within 90 days; processed within 14 business days; rejected if scanned; refunds postage, insurance and the Shippo fee, shown on the next invoice [7] |
| Extra insurance | 1% of declared value, $1.00 minimum [1] | 1.25% of declared value (+ shipping cost, US) [2] |
| Address check | price not published on the pricing page [1]; a third-party page says 1 free per label then 1¢ (NOT verified) | 2¢ per US address [2] |
| Tracking | "Tracking API $0.01-$0.03 per shipment" [1] (whether trackers on EasyPost-bought labels are charged: NOT stated) | "2¢/track" [2] (whether it applies to Shippo-bought labels: NOT stated) |
| USPS rates | both resell USPS commercial rates; neither page gives a figure. NOT verified which is cheaper for the same parcel: build step S0 compares one live rate quote from each |

**Recommendation: EasyPost**, funded by ACH from the owner's bank with auto-reload. Reasons: zero
per-label fee at our volume (Shippo would charge 7¢ on every label after 30 a month), cheaper extra
insurance, a clear API refund rule that also returns EasyPost's own fees. The one trap (the 3.75%
card top-up fee) is avoided by funding with ACH; if a card top-up is ever used, that 3.75% is our
cost, so the build must never top up by card automatically. Every per-label, insurance or tracking
fee either provider charges goes into the buyer's shipping line, never absorbed.

Sources: [1] easypost.com/pricing; [2] goshippo.com/pricing/api; [3] support.easypost.com/hc/en-us/articles/360042414212-Billing-FAQs
(via search) and costbench.com/software/shipping-software/easypost ("Last verified Aug 29, 2026");
[4] easypost.com/blog/2023-10-04-take-a-first-look-at-the-new-easypost-billing-and-wallet-experience
("Credit cards ... come with a 3.75% processing fee"; "Users who pay via ACH get to skip the fee");
[5] support.goshippo.com/hc/en-us/articles/360003859092 (via search); [6] docs.easypost.com/docs/shipments/shipping-refund;
[7] docs.goshippo.com/billing-and-invoices/refunding-labels.md. All read 2026-10-20 02:19-02:30Z.

## 3. USPS prices (measured, Notice 123 effective October 4, 2026)
Source: pe.usps.com/text/dmm300/Notice123.htm, downloaded 2026-10-20 ~02:21Z and parsed (commercial
parcels table). Zones: postcalc.usps.com zone charts (effective October 1, 2026) for origins 701, 705,
708, 711, 712 to every Louisiana 3-digit ZIP (700-714): every pair is zone 1, 2 or 3, except 711
(Shreveport) to 700 = zone 4. So in-state prices are the zone 1-4 columns.

USPS Ground Advantage, Commercial (default service):
| Weight not over | Zone 1 | Zone 2 | Zone 3 | Zone 4 |
|---|---|---|---|---|
| 4 to 15.999 oz | $7.33 | $7.34 | $7.70 | $7.86 |
| 1 lb | 8.01 | 8.08 | 8.40 | 8.55 |
| 2 lb | 8.39 | 8.48 | 8.66 | 8.91 |
| 3 lb | 9.04 | 9.06 | 9.54 | 10.07 |
| 4 lb | 9.93 | 9.99 | 10.35 | 11.30 |
| 5 lb | 10.35 | 10.41 | 10.79 | 11.67 |

Priority Mail, Commercial (option): 1 lb $9.44 / 9.72 / 10.11 / 10.80; 2 lb 9.50 / 9.79 / 10.18 / 11.19;
3 lb 9.85 / 10.11 / 11.15 / 13.08; 5 lb 12.04 / 12.21 / 13.67 / 16.37 (zones 1-4). Flat Rate commercial:
envelope $11.97, padded envelope $12.84, small box $12.95, medium box $22.02.
For comparison, Ground Advantage RETAIL (the post-office counter) 1 lb is $10.05-$11.10 in zones 1-4.

Surcharges that can hit a seller after the fact (Notice 123, Ground Advantage commercial): over 1 cubic
foot = dimensional weight; longer than 22 in +$4.50, longer than 30 in +$10.00; over 2 cubic feet
+$21.00; tubes, cans, some liquids +$4.50; "Package Quality Noncompliance or Unmanifested Fee" $0.25;
"Dimension Noncompliance Fee" $3.00; **HAZMAT Noncompliance Fee $50.00**.

Included insurance (usps.com/ship/insurance-extra-services.htm, read 2026-10-20): Priority Mail and
Ground Advantage each include "up to $100 of insurance in the price" (needs a USPS Tracking barcode).
Claims: lost items within 60 days of mailing; damage "immediately, and no later than 60 days". Extra
USPS insurance (Notice 123): $0.01-50 $2.80; 50.01-100 $3.50; 100.01-200 $4.50; up to $600 $9.05; then
+$1.50 per $100. The provider's own insurance (EasyPost 1%, min $1) is cheaper above about $100.

Whether Shippo or EasyPost quote BELOW these commercial prices (for example cubic pricing) is NOT
verified; step S0 measures it with one live rate call each (a rate quote buys nothing).

## 4. Sales tax on shipping (answered in 4.1 from published law)
- Rule (Louisiana Department of Revenue, Revenue Information Bulletin 25-025, October 1, 2025,
  dam.ldr.la.gov/lawspolicies/RIB%2025-025.pdf, read 2026-10-20): "Transportation charges paid to a
  seller for the delivery of tangible personal property ... purchased from that seller are subject to
  Louisiana state and local sales and use taxes", "regardless of whether the charges are separately
  stated or included in the total price". Basis: "cost price" R.S. 47:301(3) and "sales price"
  R.S. 47:301(13) both include transportation charges. If the sale itself is exempt, its shipping is
  exempt too (RIB example 1). If the seller passes a third-party carrier's charge to the buyer, it is
  part of the sales price and taxable. A RIB is "not binding"; it states the Department's position.
- The older rule (Revenue Ruling 01-007, 2001: optional, separately stated delivery excluded) no
  longer matches; do not rely on it.
- Declutter: casual sales are exempt "isolated or occasional sales" (row 54, R.S. 47:305(A)), so their
  shipping is exempt too under the RIB's exempt-sale rule. A business-like seller (row 54 part 2) is
  taxable, and so is their shipping. Question S1 (answered in 4.1): confirm both, and whether the platform
  collecting the shipping (we buy the label) changes who "the seller" of the transport is.
- Shops: items are taxable, so the shipping line is taxable at the DESTINATION (the tax memo's
  "delivered into Louisiana" sourcing). Stripe: tax code `txcd_92010001` (Shipping) on the shipping
  rate with `tax_behavior` set (docs.stripe.com/payments/during-payment/charge-shipping, read
  2026-10-20). Under Q2102's PaymentIntents tax flow the shipping goes into the Tax Calculation as the
  shipping cost with the buyer's address. Question S2 (answered in 4.1): is the buyer fee on a shipped Shops order
  also sourced to the destination?
- Question S3 (answered in 4.1): does collected shipping count toward the $100,000 marketplace-facilitator
  threshold (R.S. 47:340.1, "gross revenue for retail sales delivered into Louisiana")?
- Louisiana-only shipping at first (owner question 3) keeps this to one state.

### 4.1 Answers to S1-S3 from published Louisiana law (B50, 2026-10-30; the owner has no accountant or lawyer)
Sources read this session (2026-10-30 ~00:15Z): RIB 25-025 (dam.ldr.la.gov/lawspolicies/RIB%2025-025.pdf, full
text, 3 pages); La. R.S. 47:340.1 (legis.la.gov/legis/Law.aspx?d=1186690). Quoted from this repo's earlier
verified reading (docs/specs/declutter-auctions.md line 158): R.S. 47:305(A). A RIB "does not have the force and
effect of law and is not binding on the public or the Department" (RIB 25-025, every page); it is the Department's
published position, and the only published guidance on this point.
- **S1 (shipping on a casual Declutter sale): not taxed. A business-like seller's shipping: taxed with the sale.**
  R.S. 47:305(A): "Isolated or occasional sales of tangible personal property or services by a person not engaged
  in such business shall be exempt from the sales and use tax levied by all taxing authorities." RIB 25-025,
  "Exempt and Excluded Transactions": "If the underlying transaction is excluded ... or exempt ..., the associated
  transportation charges are also excluded or exempt", because they are "part of the total cost price or sales
  price of the exempt transaction" (Example 1: an exempt $500 sale, its $50 delivery not taxable). Who buys the
  label does not change this: the RIB's "Third-Party Delivery Charges" says a carrier charge the seller "passes
  through ... to the purchaser" becomes "part of the sales price"; ours is passed through as part of the sale's
  price, so it takes the sale's status: exempt with an exempt sale, taxable with a taxable one. Build rule: the
  shipping line uses the same tax status as the items on that order (Declutter today: NONTAXABLE, as the items).
  When a seller fails the occasional-sale test (row 54 part 2), the shipping is taxed with the items.
- **S2 (buyer fee on a shipped Shops order): taxed where the items are taxed, at the buyer's address.** R.S.
  47:301(13) "sales price" includes transportation charges and "any services ... that are a part of the sale" (verified
  reading in docs/specs/declutter-auctions.md line 158); R.S.
  47:340.1(B) makes the facilitator "the dealer for each remote sale for delivery into Louisiana" and (E)(1)
  "responsible for the determination of taxability". The fee is charged on the same sale and delivered to the same
  address, so it follows the items: taxable on a taxable Shops order and sourced to the ship-to address with the
  shipping (Stripe Tax: fee and shipping both go into the PaymentIntents tax calculation with the buyer's address,
  Q2102). NOT read this session: the parish-level sourcing statute for in-state dealers; the code follows the
  delivery address, which is what Stripe Tax does for a shipped order.
- **S3 (does collected shipping count toward the $100,000): count it.** R.S. 47:340.1(C)(2): the threshold is
  "gross revenue for retail sales delivered into Louisiana"; (C)(3): "only remote sales that are retail sales, as
  defined in R.S. 47:301, shall be considered"; (A)(9): "'Remote sale' means a sale made by a remote seller or a
  sale facilitated by a marketplace facilitator" (so an in-state Declutter sale through the app is a remote sale
  here). The section does not define "gross revenue"; R.S. 47:301(13) puts transportation charges inside the
  sales price. So the shipping a buyer pays counts toward the $100,000 (counting it can only make the app register
  sooner, never collect too little). The app's revenue tracker must add shipping_cents to each order's total.

### 4.2 Rates and services (for S2 rates; read 2026-10-30 ~00:12Z)
- **USPS Cubic.** EasyPost's rate chart (easypost.com/usps-rate-chart, "USPS Commercial EasyPost Merchant Rate
  Charts", below USPS Commercial) lists Ground Advantage CUBIC, zones 1/2/3/4: 0.10 cu ft $6.19/6.19/6.50/6.66;
  0.20 $6.30/6.30/6.57/6.63; 0.30 $6.48/6.48/6.71/7.01; 0.40 $6.86/6.86/7.09/7.18; 0.50 $6.86/6.86/7.14/7.38; and
  Priority Mail CUBIC 0.10 $8.03/8.28/8.62/9.30 ... 0.50 $10.52/10.69/11.84/14.20. The page shows two dates
  (October 5, 2025 and October 25, 2026) and does not say which table each belongs to: NOT verified as current.
  Ground Advantage cubic applies to parcels "less than 20 pounds and up to 1 cubic foot" (easypost.com/ground-advantage).
  So a small dense box in Louisiana may be about $1 cheaper than the $7.33-$7.86 weight rate in section 3 (two
  different sources: section 3 is USPS Commercial from Notice 123, this chart is EasyPost's discounted rate; the live
  quote through ship-rates settles it). How EasyPost
  returns cubic rates (a separate service name, or automatically from the box dimensions) is NOT in its public docs
  ("Service levels are generated from live carrier metadata", docs.easypost.com/carriers/usps-wallet-guide): it is
  read from GET /v2/metadata/carriers with the first API key (S0). Build: ship-rates always sends the box
  dimensions, asks for every USPS rate EasyPost returns, and offers the cheapest of Ground Advantage (incl. cubic)
  as the default plus Priority as the faster option.
- **Helpr sends every shipping notice itself (lead design rule, 2026-10-30).** In-app, push, email and SMS go out
  from the tracking webhook (S6). The buyer's and seller's email and phone are NEVER sent to EasyPost: the
  to_address / from_address `email` and `phone` fields stay empty, so EasyPost's own customer emails and texts can
  never fire. If a carrier strictly requires a phone, the field carries Helpr's support number, never a member's.
  A guard on the EasyPost request builder (s2-rates) fails if either address object carries `email`, or a `phone`
  other than the support number.
- **USPS Connect Local: not available through EasyPost (as far as published).** USPS: "Use the Click-N-Ship
  application to easily print shipping labels"; drop off "at the Postal Service facility in the delivery ZIP Code
  area by critical entry time"; same-day "expected but not guaranteed and may not be available at all locations"
  (usps.com/business/connect/local.htm; no price on the page). No EasyPost page found names it (searches of
  easypost.com, docs.easypost.com and support.easypost.com, 2026-10-30). Not built; re-checked from the carrier
  metadata endpoint at S0. If it appears there, it becomes an option only when the seller's and buyer's ZIPs share a
  delivery unit.

## 5. Money analysis
### 5.1 The card fee can exceed our fee (finding)
Stripe: 2.9% + 30¢ for a domestic card, +1.5% for an international card (stripe.com/pricing, read
2026-10-20); the 2.9% + 30¢ card constants are in `supabase/functions/_shared/stripeFees.ts` (the
+1.5% international rate is in neither that file nor `src/lib/stripeFees.ts`). Both checkouts are
card only. The charge is USD, so Stripe's currency-conversion +1% does not apply.

With the fee on items only (I = items, S = shipping, cents):
- fee P = 0.05 I + 70; card = 0.029 (I + P + S) + 30
- margin = P - card = 0.01955 I + 37.97 - 0.029 S
- negative when **S > 0.674 I + $13.09** (domestic card)
- with an international card (4.4%): margin = 0.0038 I + 36.92 - 0.044 S, negative when
  **S > 0.0864 I + $8.39**, i.e. with ANY in-state Ground Advantage label on an item under about $13.

With shipping in the base (owner question 2, option A): P = 0.05 (I + S) + 70
- domestic margin = 0.01955 (I + S) + 37.97 > 0 for every order
- international margin = 0.0038 (I + S) + 36.92 > 0 for every order

Worked examples (computed with the real rounding, `round(x*0.029)+30`):
| Items | Shipping | Now: fee / card / margin | Option A: fee / card / margin | Intl card now / A |
|---|---|---|---|---|
| $5.00 | $7.33 (GA 15 oz z1) | 95 / 69 / +26¢ | 132 / 70 / +62¢ | +7¢ / +42¢ |
| $5.00 | $11.67 (GA 5 lb z4) | 95 / 81 / +14¢ | 153 / 83 / +70¢ | **-13¢** / +43¢ |
| $10.00 | $16.37 (Priority 5 lb z4) | 120 / 110 / +10¢ | 202 / 112 / +90¢ | **-31¢** / +47¢ |
| $5.00 | $20.00 | 95 / 105 / **-10¢** | 195 / 108 / +87¢ | **-49¢** / +46¢ |
| $25.00 | $13.08 (Priority 3 lb z4) | 195 / 146 / +49¢ | 260 / 148 / +112¢ | **-11¢** / +51¢ |

Shops with sales tax T on the charge (worst case: tax on the fee too, rate r): option A margin =
0.05X + 70 - 0.029(1 + r)(1.05X + 70) - 30, positive for any r below 64%. So option A also covers the
card fee on the tax. (Stripe Tax's own per-transaction price is an existing Shops cost, unchanged by
shipping except that a percentage-priced plan would also apply to the shipping amount: the money
review should confirm which Stripe Tax price the account is on.)

**Recommendation: option A** (`declutter_buyer_fee_cents(items + shipping)`), one function, same
rounding, so the rule "the fee always covers the card" holds for every shipped order.

### 5.2 Where every dollar goes (design after the money review)
- Buyer pays: items + fee (`f1_ship`) + shipping (+ tax on Shops). Shipping = the exact postage quoted
  + EasyPost's label fee ($0 under 3,000 a month) + optional extra insurance. Rate shown = rate charged =
  rate bought.
- **Hold, buy, capture (review fix 2).** A shipped Declutter order opens Checkout with
  `capture_method: manual` (a card hold, as Shops already does). On the hold: claim the label purchase
  (below), buy the frozen rate, THEN capture. If the label cannot be bought (rate gone, provider error,
  dearer than the held shipping), the hold is cancelled: a cancelled hold costs nothing, so no card fee
  is ever eaten. An empty EasyPost balance is a retry state that pages ops while the hold is valid, never
  a refund. The webhook needs a new "authorised" path (`declutterCheckout.ts:146` treats only `paid`).
- **One label per order, ever (review fixes 7 and 13).** A `shipments` row is written in the same
  transaction that records the hold, with `idempotency_key = '<kind>:<order id>'` (UNIQUE) and state
  `claimed`. A worker (in `declutter-money`, retried with backoff, give-up alert) creates the EasyPost
  shipment, stores its id BEFORE buying, and on any resume reads that shipment back first and uses its
  label if it has one; it re-quotes only when the provider confirms no label. The rate is compared with
  `shipping_cents` BEFORE the buy; after the buy the real cost is always recorded (never refused), and a
  cost above `shipping_cents` pages ops. A partial UNIQUE index allows at most one live (not voided)
  label per order. S0 proves whether EasyPost refuses a second buy of one shipment.
- **Test mode never buys real postage (review fix 8).** `stripeModeForParties` also picks the EasyPost
  key: a test-mode order uses the EasyPost TEST key only; `shipments.mode` records which mode bought it,
  and a CHECK ties a live label to a live order.
- The shipping money sits in the platform's Stripe balance; labels are paid from the EasyPost wallet
  (ACH). Reconciliation is PER ORDER: collected shipping = label + insurance + shipping refunded
  +/- void refunds +/- adjustments, with owner-paid mailer labels (later phase) tagged separately.
  EasyPost's dollar strings are parsed to cents exactly.

### 5.3 Refund cases (never us; decision 5 and 6)
Ship refund reasons join the refund CHECK with their own policy (review fix 3), and a
`declutter_shipping_reserved_cents(order)` (like `declutter_delivery_reserved_cents`) splits the
shipping part out of every refund. Every shipping-only refund counts in
`declutter_order_refunds_recorded_cents` (review fix 17).
| Reason | Buyer gets | Label | Card fee (Stripe keeps it) |
|---|---|---|---|
| Label could not be bought | hold cancelled, never charged | none | none (hold) |
| `seller_backed_out` / `ship_never_shipped` (no acceptance scan by ship-by) | everything back now | voided; a rejected void = seller debt | seller debt, strike |
| Buyer cancels (where today's rules allow) / admin buyer-fault | items + fee now; SHIPPING only when the void refund succeeds (review fix 5) | voided; rejected void = buyer keeps no shipping | today's rule for that cancel |
| `ship_lost` (no delivery scan N = 10 days after the acceptance scan; N to confirm at S4) | everything back | spent = seller debt | seller debt; USPS/EasyPost claim payout pays that order's debt first, the rest to the seller (review fix 16) |
| `ship_damaged` / not as described, reported in the 48 h window | everything back after admin check | spent = seller debt; a return label if the admin wants the item back = seller debt | seller debt |
| Admin no-fault | everything back | spent = seller debt (decision 6: a lost/broken parcel is the seller's) | as today |
| Buyer changes their mind after delivery | nothing (sales final) | | |
| Chargeback "not received" (review fix 12) | per Stripe | tracking as evidence | a lost dispute comes back by transfer reversal, then seller debt |
- Debts (review fix 4): `declutter_seller_fee_debts` today allows ONE debt per refund
  (`refund_id NOT NULL UNIQUE`, 20261014224914:141; inserts `ON CONFLICT (refund_id) DO NOTHING`) and
  cascades on seller delete. S6 changes the key to (`source_kind`, `source_ref`) UNIQUE, keeps the
  existing refund debts as `source_kind='refund_card_fee'`, adds `ship_label`, `ship_adjustment`,
  `ship_hazmat_fee`, `ship_void_rejected`; changes the seller FK so an open debt blocks deletion; tries a
  transfer reversal of that order's own payout before booking a debt (`_shared/chargebackClawback.ts`
  pattern; not verified for Declutter transfers); and a seller with an open shipping debt cannot ship
  again. This is NOT in S1 (S1 books no debts), so the `ON CONFLICT (refund_id)` callers stay valid.
- Postage adjustments and the $50 HAZMAT fee arrive later: `ship_adjustment` / `ship_hazmat_fee` debts.
- A voided label's money returns to the wallet 15+ days later: a float, not a loss.

## 6. Seller flow
- Listing: a "Ship it" option next to porch / pickup, only for size "small" (owner question 8). Package
  presets with conservative weights (Envelope up to 8 oz, Small box up to 1 lb, Medium box up to 3 lb,
  Large box up to 10 lb, Custom weight and dimensions up to 20 lb and 22 in long, so the length
  surcharges never apply) and a rate preview ("Ships for about $X in Louisiana"). The seller confirms
  "nothing on the USPS restricted list" (section 8).
- After the sale: the label is already bought (5.2); "Print label" opens the PDF / 4x6 label. Ship-by
  deadline 3 business days; missing it = seller backs out (row 60).
- Return address on the label: the seller's pickup address (the paid buyer already sees it, row 98).

## 7. Buyer flow, handover state and payout
- Checkout: "Ship to me", a Louisiana address (verified by EasyPost before the quote), Ground Advantage
  default, Priority option, the frozen rate as its own line. `total = items + premium + tax + delivery +
  shipping` (S1 constraint). The freeze trigger names `shipping_cents` (review fix 14).
- New handover `'ship'`. It joins `declutter_orders_handover_check` ONLY in the same migration that
  teaches every handover-generic path about it (review fix 1):
  - the auto-pay sweep and the no-booking sweep (20261018183715 lines 236 and 262) use
    `handover NOT IN ('delivery','ship')`;
  - the booking trigger `declutter_bookings_not_delivery` refuses `'ship'` too, and `declutter_book_pickup`,
    no-show, seller "Picked up", porch photo and confirm each state their ship behaviour (refuse);
  - a separate ship sweep pays only when `shipments.tracking_status = 'delivered'`,
    `delivered_at + 48 h <= now()` and no problem is open, locking the order and acting on
    `status='paid'` only;
  - a guard test lists every function that branches on `handover` and fails when a new value is not
    handled.
- "I got it" is shown only after the delivered scan (review fix 10). Return-to-sender,
  available-for-pickup and failure scans go to a problem state; "delivered" must match the buyer's ZIP.
- Payout on FINAL through the existing declutter_payouts path, never on the first scan.
- One parcel per order: weight = sum of the items' preset weights + the box (review fix 15).

## 8. Items that cannot ship (USPS rules) and how listings block them
Source: usps.com/ship/shipping-restrictions.htm (read 2026-10-20) and USPS PO-130-2021-2 (vapes).
- Never mailable domestically: air bags, ammunition, explosives (fireworks), gasoline, marijuana,
  strike-anywhere matches, liquid mercury.
- Vapes / e-cigarettes (ENDS) and cigarettes: nonmailable to consumers under the PACT Act
  (about.usps.com/management-instructions/po-130-2021-2-pact-act-and-posecca.pdf; already banned, row 34).
- Restricted, so **not allowed for "Ship it"** (Ground Advantage would carry some, but one $50 HAZMAT
  noncompliance fee wipes out a sale): aerosols and gases (spray paint, propane, fire extinguishers),
  perfume and nail polish (flammable), hand sanitizer, flammable glues, safety matches, poisons, dry ice,
  alcohol, live animals, and **used / damaged / defective electronics with lithium batteries** (USPS
  requires "Restricted Electronic Device" and "Surface Transportation Only" markings). Also excluded by
  our choice, NOT checked against USPS Publication 52: lighters, pesticides, pool chemicals. New-in-box small electronics: OPEN for the owner later; v1 says no to
  any item with a lithium battery being shipped, so a phone or laptop is pickup-only.
- How it is blocked: (1) a `ship_restricted` check added to the AI draft rule next to `BANNED_RULE`
  (flags the item as pickup-only rather than banned); (2) the seller ticks "nothing restricted" to turn
  "Ship it" on; (3) categories electronics and appliances default to pickup-only; (4) admin can turn
  shipping off on a listing. Restricted items still sell by pickup / porch / Helpr delivery.

## 9. Shops reuse, switches and the build plan
### 9.1 Shops
- Same provider, same `shipments` table (`shop_order_id`), same claim-then-buy worker, same tracking.
- Order of events (review fix 6): maker accepts -> claim + buy the label -> capture the hold. A failed
  label releases the hold; a capture lost after the label = void it; a label dearer than the held
  shipping = decline at no cost. Capture retries (up to 6 days, 20261018164442:888) never buy a second
  label (the idempotency key is per order).
- Ship orders are excluded from `shop_handover_sweep` (20261018211820 ~552) and the ready-photo clock,
  and finish only on delivered + 48 h; a late cancel once a label exists follows the 5.3 table with the
  maker as the seller (`shop_payouts_due` must not pay on it).
- Tax: shipping is taxable at the buyer's address (section 4) through Q2102's PaymentIntents tax flow
  with `txcd_92010001`. Known gap (review fix 9): with tax on the fee, an international card loses money
  above about $447 at 10% tax; S8 blocks non-US cards on shipped Shops orders or files it separately.
- The maker ships; cottage food never ships (decision 8).

### 9.2 Feature switch
- ONE switch `shipping` (lead 2026-10-20), created `off` in S2 together with its first `useFeature("shipping")` read (featureSwitchRegistry.test.ts requires every created switch to be read by the app; S1 has no reachable surface). Every new RPC calls
  `require_feature('shipping')`, every edge function `requireFeature`; the UI hides "Ship it" / "Ship to
  me" when off. A webhook for an order already held still processes (money already moved). The owner
  turns it to testers, never everyone without her go.

### 9.3 Phased build (each phase: PGlite 3x, edge tests, lh-money-escrow + lh-authz-rls review, testers)
- **S0 (owner):** open the EasyPost account (credentials), ACH funding, confirm "no card top-up" in the
  dashboard, test + live API keys into Supabase secrets; one live rate quote to settle what address
  checks, quotes and trackers cost on unpaid carts (review fix 11), and whether a second buy of one
  shipment is refused.
- **S1 data model + fee (this branch):** `declutter_orders.shipping_cents`
  (default 0), total CHECK + freeze trigger include it; fee rule `f1_ship` =
  `declutter_buyer_fee_cents_ship(items, shipping)` allowed only with shipping > 0, F1 only with
  shipping = 0; table `shipments` (service-role only: claim key, mode, rate, label cost, tracking,
  private ship-to and parcel); pure TS module `src/lib/shipping/policy.ts` (fee, Louisiana ZIP, small
  only, label budget check, idempotency key, who pays per refund reason) with vitest. NO `'ship'`
  handover yet and no EasyPost calls. lh-authz-rls review of S1 (972c5bb06, 2026-10-20): approve with
  fixes, all taken in the same migration: `shipments` joins the seed-table scan; the Louisiana and
  parcel CHECKs refuse MISSING keys (a NULL CHECK passes); `buyer_id` (SET NULL) + `is_seed` copied from
  the order at birth; a guard trigger freezes what the buyer paid for and the address, only lets the
  label state move forward (a bought label can never return to `claimed`), and redacts `ship_to` to its
  ZIP when the buyer or the order is deleted. PGlite 42/42, 41 red without the migration.
- **S2 checkout:** `'ship'` handover + the sweep/booking exclusions (fix 1) in one migration; `ship-rates`
  edge function (Louisiana, small, verify address, cache, rate-limit); manual-capture Checkout with the
  shipping line; fee rule trigger picks `f1_ship` for `'ship'`.
- **S3 label worker:** claim row in the hold transaction, buy-then-capture, resume-safe, mode-keyed.
- **S4 tracking webhook:** `easypost-webhook` (HMAC, replay-safe), status machine, ship-by and lost sweeps.
- **S5 handover and payout:** delivered -> 48 h -> final -> payout; "I got it" after delivered.
  Also: the buyer's own `shipments` rows (ship_to) join `export_my_data` (S1 marks `shipments.buyer_id`
  EXEMPT in src/test/helpers/dataExportInventory.ts until then).
- **S6 refunds, debts, claims, chargebacks:** the 5.3 table, the debt key change, transfer reversal.
- **S7 Shops** (9.1). **S8 copy** (Terms row 24, terms draft line 76, Help, "how to ship").
- **Later (paused by the owner):** the mailer program (section 10).

## 10. Mailer program (PAUSED by the owner 2026-10-20: a later phase)
- Eligibility: ID-verified (`is_identity_verified`) + at least 1 completed sale + at least 1 live
  "Ship it" listing; 1 pack per seller per 30 days (max 4 a year); the monthly cap closes requests.
- Cost, measured: 10 x 13 in poly mailers, Uline S-21880 (colored), 100 per case at $30 (1 case) to $26
  (20+ cases) = **$0.26-$0.30 a bag** (uline.com product page, read 2026-10-20; a plain white mailer may
  be cheaper, not checked). 100 bags weigh 3.27-4 lb, so 10 bags plus one outer bag weigh about 6-7 oz:
  Ground Advantage commercial under 1 lb in Louisiana = **$7.33-$7.86**. Pack total about
  **$9.93-$10.86** (the earlier $6-8 estimate was wrong).
- The owner pays this (the stated exception). It is booked as a marketing cost, never charged to a seller.

## 11. Money review result (lh-money-escrow, review only, of c7962d43e, 2026-10-20 ~02:38Z)
Verdict: **approve with fixes**. Findings 1-8 must be written into the design before S1 starts.
The reviewer read code only (no prod, Stripe or EasyPost calls) and recomputed the 5.1 math in node over
every fee base from $0 to $10,000: the formulas, both break-even points and all five table rows match the
real rounding; with option A the smallest margin is 38¢ (US card) and 37¢ (international card).
I spot-checked findings 1 and 4 and the stripeFees claim against the cited lines (all three confirmed).
These change the design above; where they conflict with sections 5-9, this section wins.

MUST-FIX before S1:
1. **Existing Declutter sweeps and bookings would catch `'ship'` orders.** The auto-pay and no-booking
   sweeps exclude only `handover <> 'delivery'` (20261018183715 lines 236, 262): a shipped order would be
   closed as `buyer_no_show` 7 days after payment, and `declutter_book_pickup` plus the
   `declutter_bookings_not_delivery` trigger (20261017055505 ~2000-2016) would let a buyer book a slot and
   trigger the 24 h auto-pay. Design: both loops use `handover NOT IN ('delivery','ship')`; the trigger
   refuses `'ship'`; a separate sweep pays only when the shipment is delivered, the window has passed and
   no problem is open; every handover-generic RPC lists its ship behaviour; a guard fails when a new
   handover value is not handled.
2. **R1 (label purchase fails after payment) as written makes the platform pay the card fee.** Design:
   ship orders use a MANUAL-CAPTURE checkout: authorise, buy the label, then capture; a failed label
   cancels the hold (a cancelled hold costs nothing, as Shops already relies on). This needs a new paid
   path (`declutterCheckout.ts:146` treats only `paid` as paid). An empty EasyPost balance is a retry
   state with an ops page while the hold is valid, never a refund. This replaces "label bought at
   payment" in 5.2.
3. **Existing refund policies would refund a spent label and debit only the card fee.** Design: a
   `declutter_shipping_reserved_cents(order)` like `declutter_delivery_reserved_cents`; ship refund reasons
   (`ship_lost`, `ship_never_shipped`, `ship_damaged`) each with its policy; the refund-amount CHECK and
   `declutter_record_refund` keep the label on buyer-fault and book it as the seller's debt on seller-fault
   and lost; the admin outcomes (no-fault, buyer-fault) get rows in the 5.3 table; Shops too.
4. **The debt table cannot hold a shipping debt.** `declutter_seller_fee_debts.refund_id` is
   `NOT NULL UNIQUE` (20261014224914 line 141), the insert is `ON CONFLICT (refund_id) DO NOTHING`, and the
   seller column cascades on delete. Design: `source_kind` + `source_ref` with UNIQUE on the pair; RESTRICT
   (or block account deletion while a debt is open); before booking a debt, try reversing that order's own
   Stripe transfer (pattern: `_shared/chargebackClawback.ts`; not verified for Declutter transfers); no new
   shipped sales while a shipping debt is open.
5. **Buyer-caused cancel: the refund cannot wait on a 15+ day void.** Design: buyer-fault = refund
   everything except shipping now, shipping only when the void refund succeeds; seller-fault = refund in
   full now, a rejected void becomes seller debt (needs 4).
6. **Shops sweeps and payouts would catch a ship mode.** `shop_handover_sweep` (20261018211820 ~552) and
   `shop_payouts_due` on a late cancel (20261019071055 ~872). Design: ship orders excluded from that sweep
   and the ready-photo clock, finished only on delivered + window; define a late cancel once a label
   exists; buy the label BEFORE capture (failed label = release the hold; capture lost after the label =
   void it); a label now dearer than the held shipping = decline at no cost.
7. **A retry could buy a second label.** Design: store the provider shipment id and claim the purchase in
   a committed row before buying; on resume read that shipment back first and use its label if any;
   compare rate vs `shipping_cents` BEFORE buying, always record the real cost after, page if higher. S0
   proves whether EasyPost refuses a second buy of the same shipment (not verified).
8. **Test-mode payments could buy real postage.** Design: `stripeModeForParties` also picks the EasyPost
   key; a test-mode order never touches the production EasyPost key; the label row records its mode.

SHOULD-FIX (into the build plan): (9) option A covers the card fee on tax for US cards only: an
international card on a Shops order with tax on the fee loses money above about $447 at 10% tax / $210 at
12% (lower if Stripe Tax is 0.5% of the charge, price not verified). This gap exists today; block non-US
cards on Shops or file it separately. (10) hide "I got it" until the delivered scan; return-to-sender,
pickup-at-post-office and failures go to a problem state; define the lost-parcel N. (11) S0 measures what
address checks, rate quotes and trackers cost on unpaid carts; cache and rate-limit if above $0. (12)
chargebacks ("item not received"): tracking as evidence; a loss comes back by transfer reversal, then
seller debt (the dispute handler today touches only `jobs`). (13) buy labels from a queue row written in
the same transaction as `paid`, retried by `declutter-money`, with a give-up alert. (14) the
amounts-frozen trigger and the checkout sum include `shipping_cents`; `ship_rate_id`, `ship_to`, `parcel`
freeze too. (15) one parcel per order, built from the items' preset weights plus the box. (16) a claim
payout pays that order's debt first, then the rest to the seller (say which balance funds it). (17)
shipping-only refunds count in `declutter_order_refunds_recorded_cents`, or later payouts fail.
NOTES: option A needs a new `fee_rule` value (frozen orders keep `f1`), the two premium CHECKs
(`declutter_orders_premium_rule`, `shop_orders_premium_rule`), `src/lib/declutter/money.ts` and the fee line
copy; reconciliation is per order, mailer labels tagged separately; "never top up by card" is an EasyPost
dashboard setting the owner confirms.

## 12. Other reviews and sources
- lh-authz-rls: at S1 (ship_to address privacy, shipments writes).
- Mercari's 3-day window figure is from third-party blogs (vendoo, closo), not Mercari's help pages.
