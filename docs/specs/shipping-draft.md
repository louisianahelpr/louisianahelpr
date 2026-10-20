# Shipping for Declutter and Shops (SPEC DRAFT, nothing built)

Status: spec complete, waiting on the owner's answers and a money review (lh-money-escrow, NOT yet run). Tracked as Q2239 in docs/OPEN.md.
Nothing gets built until both are done. Owner order 10-20 ~01:10Z: discounted USPS labels through
Shippo or EasyPost, the buyer pays shipping at checkout, the seller prints the label, tracking shows in
the app, a "shipped" handover with a buyer window after delivery, the seller is paid when the sale is
final, and a FREE 10-pack of poly mailers on request for active sellers (the owner pays for the bags
and their postage: the one stated exception to "we never absorb a fee").

Every price below was read from the source named beside it on **2026-10-20 between 02:19Z and 02:30Z**
(`date -u`). Figures I could not read from the provider's own page say so.

## Decisions needed from the owner (plain words; recommendation first)

1. **Which label company?**
   - A. EasyPost (recommended): no per-label fee up to 3,000 labels a month, cheaper extra insurance
     (1%, $1 minimum). We fund its prepaid balance from the bank (free); a card top-up costs 3.75%.
   - B. Shippo: first 30 labels a month free, then 7 cents a label; charges a card as labels are bought.
2. **The 5% + 70 cents buyer fee: should it also count the shipping cost?**
   - A. Yes (recommended): 5% of (items + shipping) + 70 cents. The card fee is then always covered.
     A $5 item with $7.33 shipping: the buyer fee goes from $0.95 to $1.32.
   - B. No, items only. Then on cheap items with heavier boxes (or any foreign card) the card fee is
     bigger than our fee, which breaks "we never absorb a fee".
3. **Where can items ship at first?**
   - A. Louisiana addresses only (recommended): one state's sales tax, local buyers, cheapest postage
     (every Louisiana-to-Louisiana parcel measured is USPS zone 1 to 4).
   - B. Anywhere in the US (other states' tax rules apply; ask the CPA first).
4. **How long does the buyer have after "delivered" to report a problem before the seller is paid?**
   - A. 2 days (48 hours) (recommended). "I got it" ends it early.
   - B. 3 days (what Mercari is reported to use).
5. **Lost or broken in the mail: who covers it?** (The buyer always gets their money back.)
   - A. The seller (recommended): the seller gets the USPS insurance payout (up to $100 is included
     free); anything above that, plus the label and card fee, is the seller's. Sellers can add extra
     insurance at listing, and the buyer pays for it in the shipping line.
   - B. Require extra insurance on every item over $100 (added to the buyer's shipping), seller covers
     the rest.
6. **Buyer cancels or the sale is refunded after the label was printed: who pays the label?**
   - A. Nobody, if the label is cancelled unused (USPS gives the money back); if the label was already
     used, whoever caused the refund pays it (seller backs out = seller; buyer's own choice = taken
     from the buyer's refund) (recommended).
   - B. Always the seller.
7. **Free mailers: how do they get sent?**
   - A. You keep a box of mailers; the app prints a postage label and lists requests in an admin queue;
     you drop them off (recommended). About $10-$11 per pack (10 bags + postage, measured below).
   - B. A supplier ships each pack (costs more, no tracking in the app).
   And: a monthly budget cap for mailers (suggest $100 a month = about 9 packs)?
8. **Which items can ship?** Recommended: only Declutter sizes "small" (fits a box up to 20 lb),
   never large or extra large; Shops items the maker marks shippable; cottage food never ships until
   the Health Department answers in writing.

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

## 4. Sales tax on shipping (flag for the CPA)
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
  taxable, and so is their shipping. CPA question CPA-S1: confirm both, and whether the platform
  collecting the shipping (we buy the label) changes who "the seller" of the transport is.
- Shops: items are taxable, so the shipping line is taxable at the DESTINATION (the tax memo's
  "delivered into Louisiana" sourcing). Stripe: tax code `txcd_92010001` (Shipping) on the shipping
  rate with `tax_behavior` set (docs.stripe.com/payments/during-payment/charge-shipping, read
  2026-10-20). Under Q2102's PaymentIntents tax flow the shipping goes into the Tax Calculation as the
  shipping cost with the buyer's address. CPA question CPA-S2: is the buyer fee on a shipped Shops order
  also sourced to the destination?
- CPA question CPA-S3: does collected shipping count toward the $100,000 marketplace-facilitator
  threshold (R.S. 47:340.1, "gross revenue for retail sales delivered into Louisiana")?
- Louisiana-only shipping at first (owner question 3) keeps this to one state.

## 5. Money analysis
### 5.1 The card fee can exceed our fee (finding)
Stripe: 2.9% + 30¢ for a domestic card, +1.5% for an international card (stripe.com/pricing, read
2026-10-20); the same constants are in `supabase/functions/_shared/stripeFees.ts`. Both checkouts are
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

### 5.2 Where every dollar goes
- Buyer pays: items + fee + shipping (+ tax on Shops). Shipping = the exact postage quoted
  + the provider's label fee (EasyPost $0) + optional insurance. Rate shown, rate charged, rate bought.
- **Buy the label at payment time, not later** (recommended design): the `checkout.session.completed`
  handler buys the exact rate the buyer paid for (the rate id frozen on the order). No rate drift, no
  "label costs more now" case, no surplus. The seller then just prints it. If the rate is gone
  (provider error), the order falls to "seller backs out" style handling with a full refund and NO
  strike (not the seller's fault), and the card fee is the platform's loss: OPEN RISK R1 for the money
  review (mitigation: re-quote and buy the cheapest same-service rate if it is not higher; otherwise
  refund).
- The shipping money sits in the platform's Stripe balance; the label is paid from the EasyPost wallet
  (ACH from the owner's bank). The two must be reconciled monthly (a report: shipping collected vs
  labels bought vs label refunds vs adjustments). It is never transferred to the seller.
- SQL refuses to record a label whose cost is above the order's collected shipping.

### 5.3 Refund cases (never us)
| Case | Buyer gets | Label | Card fee (Stripe keeps it) |
|---|---|---|---|
| Seller backs out / misses ship-by (row 60) | everything back | voided (refund to wallet in >= 15 days); if the void is rejected (label was scanned), the label cost is the seller's debt | seller's debt (row 60), seller strike |
| Buyer cancels before shipping (only where today's rules let the buyer cancel) | everything back minus the label if its void is rejected | voided | today's rule for that cancel |
| Lost in the mail (no delivery scan N days after the acceptance scan) | everything back, from the held money (seller not paid yet) | spent | owner question 5: recommended the seller, offset by the USPS claim payout, which goes to the seller |
| Damaged / not as described / empty box, reported in the window | everything back after review | spent; a return label (seller pays, from debt) if the admin wants the item back | seller's debt (as in row 60) |
| Buyer changes their mind after delivery | nothing (sales final, owner 10-20) | | |
- Timing gap: the buyer's refund leaves Stripe at once, but a voided label's money returns to the wallet
  15+ days later. That is a float, not a loss.
- USPS postage adjustments (seller under-declared weight or size, or a hazmat noncompliance fee of $50)
  arrive later from the provider. They become the seller's fee debt (existing debt rule).
  **OPEN RISK R2:** a debt is only recovered from FUTURE payouts; a seller who never sells again leaves
  it unpaid, which is the platform absorbing it. Mitigations for the money review: package presets
  with conservative weights, the seller confirms weight and size, and a seller with an unpaid shipping
  debt cannot ship again. The same gap exists today for card-fee debts.
- Claims: a label we bought is filed by us (EasyPost lists a "USPS Claims Program" on its pricing page,
  terms NOT read). The payout is passed to the seller. Whether USPS refunds the postage on a lost-parcel
  claim: NOT verified.

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
- Checkout: "Ship to me", a Louisiana address (verified by the provider before the rate quote), the
  service (Ground Advantage default, Priority option), the frozen rate shown as its own line. Constraint
  `total = items + premium + tax + delivery + shipping`.
- New handover `'ship'`: paid -> label_bought -> in_transit (first USPS scan) -> delivered -> final,
  or problem. Driven by the provider's tracking webhook (EasyPost `tracker.updated`, signature checked).
- "Delivered" starts the buyer window (owner question 4). "I got it" ends it early. No problem when it
  lapses = FINAL and the seller is paid through the existing declutter_payouts path. Never paid on the
  first scan.
- Never shipped: no acceptance scan by the ship-by date -> auto-cancel, buyer refunded, label voided,
  seller strike.

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
- Same provider, same order-level shipping columns, same label-at-payment, same tracking webhook. For a
  held Shops order the label is bought at CAPTURE (the maker accepted), not at checkout; a declined or
  expired hold buys nothing.
- The MAKER ships (maker-ships). Helpr delivery stays O4's later slice.
- Tax: the shipping line is taxable at the buyer's address (section 4), through Q2102's PaymentIntents
  tax flow; the pickup performance_location stays for pickup orders only.
- Cottage food (R.S. 40:4.9) never ships until the Louisiana Department of Health answers in writing
  (local-shops-prep.md lines 119-121 say LDH's position is NOT verified).
- Who pays a Shops refund's label: the same table as 5.3, the maker in place of the seller.

### 9.2 Feature switches
- `declutter_shipping` and `shops_shipping` in `feature_switches`, audience `testers` (never everyone
  without the owner's go). Every new RPC calls `require_feature`, every edge function `requireFeature`;
  the UI hides "Ship it" and "Ship to me" when off. A webhook for an order whose switch is off still
  processes (money already moved).
- `mailer_requests` switch, testers first.

### 9.3 Phased build (each phase: PGlite 3x, edge tests, lh-money-escrow + lh-authz-rls review, testers)
- **S0 (no code):** owner answers; money review of this spec; EasyPost account opened by the owner
  (credentials = owner step), ACH funding, test API key; one live rate quote from each provider for the
  same 2 lb Louisiana parcel to settle the rate comparison.
- **S1 data model:** `declutter_orders.handover` adds `'ship'`; new columns `shipping_cents`,
  `shipping_service`, `ship_rate_id`, `ship_to` (address, private: buyer + seller after payment only,
  RLS), `parcel` (weight oz, dims); new table `shipments` (order, provider ids, label url, tracking
  code, status, label_cost_cents, refund status, adjustments) written only by service-role functions;
  `total` constraint gains `+ shipping`; fee function per owner question 2; `shipping_events` log.
- **S2 checkout:** `ship-rates` edge function (address verify + rates, Louisiana only, small only,
  cached per order draft); `declutter-checkout` adds the shipping line (`NONTAXABLE` for Declutter casual
  sales; `txcd_92010001` for Shops); fee base change.
- **S3 label purchase:** on payment, buy the frozen rate; idempotent on the order id (a retried webhook
  never buys twice); failure path R1; label PDF in a private bucket; "Print label" UI.
- **S4 tracking webhook:** `easypost-webhook` (HMAC signature, replay-safe), status machine, ship-by
  sweep (cron) for never-shipped orders, lost-parcel sweep.
- **S5 handover and payout:** delivered -> window -> final -> payout via declutter_payouts; "I got it";
  "Report a problem" during the window.
- **S6 refunds, disputes and lost parcels:** the 5.3 table; label void; adjustments -> seller debt;
  admin claim filing screen.
- **S7 mailer requests:** request form (eligibility below), `mailer_requests` table, admin queue
  ("Mailer requests": approve, print label, mark sent), the owner-paid label, monthly cap.
- **S8 Shops:** maker-ships on the same pieces, label at capture, tax at destination.
- **S9 copy:** Terms (spec row 24, terms draft line 76), Help, the seller's "how to ship" page (free USPS
  Priority boxes exist for Priority labels only).

## 10. Mailer program
- Eligibility: ID-verified (`is_identity_verified`) + at least 1 completed sale + at least 1 live
  "Ship it" listing; 1 pack per seller per 30 days (max 4 a year); the monthly cap closes requests.
- Cost, measured: 10 x 13 in poly mailers, Uline S-21880 (colored), 100 per case at $30 (1 case) to $26
  (20+ cases) = **$0.26-$0.30 a bag** (uline.com product page, read 2026-10-20; a plain white mailer may
  be cheaper, not checked). 100 bags weigh 3.27-4 lb, so 10 bags plus one outer bag weigh about 6-7 oz:
  Ground Advantage commercial under 1 lb in Louisiana = **$7.33-$7.86**. Pack total about
  **$9.93-$10.86** (the earlier $6-8 estimate was wrong).
- The owner pays this (the stated exception). It is booked as a marketing cost, never charged to a seller.

## 11. Reviews
- lh-money-escrow: PENDING (not run; this lane could not spawn a reviewer). Must cover R1, R2, the fee
  base change, the label-at-payment design and the refund table before any build.
- lh-authz-rls: at S1 (ship_to address privacy, shipments writes).
- Mercari's 3-day window figure is from third-party blogs (vendoo, closo), not Mercari's help pages.
