# Shipping for Declutter and Shops (DRAFT, partial, nothing built)

Status: PARTIAL DRAFT, saved early because the lead session restarted (2026-10-20). Owner order
10-20 ~01:10Z (memory): discounted USPS labels (Shippo or EasyPost), the buyer pays shipping at
checkout, the seller prints a label, tracking shows in the app; plus a FREE 10-pack of poly mailers
for active sellers (the owner pays bags and postage, an explicit exception to the never-absorb rule).
Nothing gets built until the owner answers the questions below and a money review passes.

Marked **[UNVERIFIED]** = from memory, not checked against the provider's live pricing page yet.
The next session must check every one before the owner sees this.

## 1. What exists today (read from origin/main e20c7a205)
- Declutter handover modes: `declutter_orders.handover IN ('pickup_home','porch','delivery')`
  (20261017055505). Spec row 24 says "Shipping NOT at launch"; terms draft line 76 says shipping is
  not available yet (both need updating when this ships).
- Money model: separate charges and transfers. Checkout (`supabase/functions/declutter-checkout`)
  opens one Stripe Checkout page per order, with no transfer_data, so the money stays on the platform
  until handover. Line items: "Declutter items", "Buyer's fee (5% + 70¢)", optional "Helpr delivery",
  all with `NONTAXABLE_TAX_CODE`. `total_cents = items + premium + tax + delivery` is a DB constraint.
- F1 fee: `declutter_buyer_fee_cents(items) = round(items*0.05)+70`. The base is the ITEMS ONLY
  (Helpr delivery is not in the base). The card cost is paid out of this fee.
- Payout: row 93. The seller is paid the moment the handover is confirmed ("I got it", porch photo,
  door "Picked up", or the 24 h auto-pay). `declutter_payouts` holds items, debt and amount; fee debts
  come out of ANY future payout (owner 10-20).
- Problems: "Report a problem" any time until the seller is paid (row 96); after that the sale is
  final. Owner 10-20: Declutter sales are FINAL once picked up; refunds only before pickup.
- Shops (`supabase/functions/shop-checkout`): a card HOLD captured when the maker accepts, Stripe Tax
  `automatic_tax` on, a pickup performance location per line, the same F1 buyer fee, the shop paid at
  handover. O4: delivery is "a later slice". Cottage food shipping is an open question for LDH
  (local-shops-prep.md L119-121).
- Feature switches: `feature_enabled_for(key)` (20261012031120); edge functions use `requireFeature`.

## 2. Provider choice (Shippo vs EasyPost) [UNVERIFIED, verify before the owner sees it]
| | Shippo | EasyPost |
|---|---|---|
| Monthly fee | Free starter plan [UNVERIFIED] | Free tier [UNVERIFIED] |
| Per-label fee | about $0.05/label on the API plan [UNVERIFIED] | free up to ~3,000 labels/mo, then about $0.08 [UNVERIFIED] |
| USPS discounted rates | Yes (commercial, Ground Advantage + Priority) | Yes (commercial) |
| Unused label refund | USPS labels refundable within ~30 days via API; credit takes days to weeks [UNVERIFIED] | Same USPS rule via API [UNVERIFIED] |
| Tracking webhooks | track_updated | tracker.updated |
| Test mode | Test API key, free test labels | Test API key, free test labels |
Leaning: **EasyPost** if its free tier is confirmed (no per-label fee at our volume); otherwise
Shippo. Any per-label fee is added to the buyer's shipping line (never absorbed).
Funding: the platform holds ONE provider account (a wallet funded by the owner's card or ACH). The
buyer's shipping money lands in the platform's Stripe balance and is never transferred to the seller.

## 3. Seller flow (draft)
- At listing: a "Ship it" toggle next to porch/pickup, with package presets (Small envelope up to 8 oz,
  Small box up to 1 lb, Medium box up to 3 lb, Large box up to 10 lb, plus custom weight/dims) and a
  rate preview ("Ships for about $X–$Y in Louisiana") from a live rate call.
- After the sale: a "Print label" button. The label is bought from the rate the buyer paid; there is
  a PDF / 4x6 option and a QR code where the provider supports it. A ship-by deadline applies
  (proposed 3 business days; a missed deadline = the seller-backs-out rule, row 60).
- The return address is the seller's pickup address (the paid buyer already sees it, row 98).

## 4. Buyer checkout (draft)
- The buyer picks "Ship to me" and enters an address. The live rate (USPS Ground Advantage by default,
  Priority as an option) is frozen on the order as `shipping_cents`, and Checkout gets its own
  "Shipping (USPS …)" line. Constraint: `total = items + premium + tax + delivery + shipping`.
- Card cost on shipping: with F1 on items only, the card fee on a big shipping line can exceed the
  fee for cheap items (it goes negative when shipping > 0.674 × items + $13.09). Proposal: put
  shipping in the F1 base (`5% of (items+shipping) + 70¢`), which always covers the card fee
  (margin = 1.955% × (items+shipping) + 37.97¢ > 0). OWNER QUESTION 2.
- Sales tax: Declutter casual sales are exempt (row 54), so there's no tax on shipping either. Shops:
  a shipped order is taxed at the DESTINATION (not the pickup location), and the shipping line goes
  through Stripe Tax with the shipping tax code. Whether Louisiana taxes separately stated shipping
  charges by common carrier is unclear to me, so it's **flagged for the CPA**. Out-of-state
  destinations raise other-state facilitator questions, also for the CPA. Proposal: Louisiana
  addresses only at first.

## 5. Money flow (draft rules)
- Collected `shipping_cents` = the exact quoted rate (+ any per-label fee). Label cost must be
  ≤ collected: SQL refuses to record a label above it.
- The label costs more at purchase (the rate changed or expired): the seller sees the difference
  first and can (a) pay it from this sale's payout or (b) pick a cheaper service. Never the platform.
- A USPS postage adjustment later (weight or size under-declared) = the seller's fee debt, taken from
  future payouts (existing debt rule).
- Unused or voided label: refunded to the platform's provider wallet. If the sale is then refunded,
  the buyer gets the shipping back too.
- Re-label (the seller's mistake, lost label): the seller pays for the new label from the payout.
- Surplus (label cheaper than collected): avoided by buying the same rate. Any leftover = OWNER Q.

## 6. Handover state for shipped orders (draft)
New handover `'ship'`, with states paid → label_bought → in_transit → delivered → final (or problem).
- Tracking "delivered" starts a buyer window (proposed 48 h; Mercari uses 3 days) for "Report a
  problem" (not as described, damaged, empty box, wrong item). "I got it" ends the window early.
  When the window lapses with no problem, the sale is FINAL and the seller is paid.
- Before shipping: a full refund is allowed (the seller backs out: row 60 rules, card fee to the
  seller as debt). After delivery + the window: final, matching the owner's rule.
- Lost (no delivery scan within N days of the label scan): buyer refund from the held money (the
  seller isn't paid yet); the platform files the USPS included-insurance claim (about $100 on Ground
  Advantage/Priority [UNVERIFIED]) and passes it to the seller. Who loses above that = OWNER Q.
- Never shipped (no acceptance scan by the ship-by date): auto-cancel, buyer refunded, label voided.

## 7. Payout timing
The seller is paid when the shipped order becomes FINAL (delivered + the window, or "I got it"), via
the existing declutter_payouts path. Not on the label scan.

## 8. Mailer program (draft)
- Eligibility: ID-verified (`is_identity_verified`) + at least 1 completed sale + at least 1 live
  "Ship it" listing; 1 pack per seller per 30 days (max 4/yr); a monthly owner budget cap that
  closes requests.
- Address: the seller's saved address, confirmed in the request form.
- Fulfilment (recommended): the owner keeps a stock of mailers, the app buys a postage label through
  the same provider (the owner pays: the explicit exception), and an admin "Mailer requests" queue
  lets her print and drop it off. The alternative (a supplier drop-ship, e.g. an online order per
  seller) costs more per pack and has no tracking in-app.
- Cost estimate [UNVERIFIED]: 10 bags about $1.50–$2 in bulk + about $4.50–$5.50 Ground Advantage
  for one padded envelope ≈ **$6–8 per pack**.
- Tip for sellers: USPS gives free Priority Mail boxes (Priority labels only).

## 9. Still to write (next session)
Shops reuse (O4 delivery slice; maker-ships; cottage food excluded until LDH answers), prohibited
items (USPS hazmat: lithium batteries loose or damaged, aerosols, perfume by air, flammables; merge
with row 34 banned list + AI flag), feature switch (`declutter_shipping`, `shops_shipping`, testers
first), phased build plan, verify every [UNVERIFIED] figure, final OWNER QUESTIONS list.

## 10. Owner questions (draft)
1. Provider: EasyPost (recommended if free at our volume) or Shippo?
2. Card fee on shipping: put shipping inside the 5% + 70¢ fee base? (recommended, otherwise we'd pay
   the card fee on big shipping lines)
3. Ship only to Louisiana addresses at first? (recommended: one state's tax, stays local)
4. Buyer's window after "delivered" before the sale is final: 48 h (recommended) or 3 days?
5. Lost package worth more than USPS insurance: the seller bears it, or offer paid extra insurance?
6. Mailers: you keep stock and ship with an app label (recommended), or a supplier ships them?
   Monthly budget cap?
