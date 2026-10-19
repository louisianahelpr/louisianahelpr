# Declutter consignment ("Sell it for me", v2): DRAFT spec, nothing built

Status: DRAFT for the lead's review, then the owner's answers, then a full money review
(lh-money-escrow + lh-authz-rls) BEFORE any code. Tracked in [docs/OPEN.md](../OPEN.md) as Q2235.

Owner order (2026-10-19 ~21Z, relayed by the lead): on top of v1 (a flat, in-person Declutter Help job, and
local businesses with "Request a quote · Coming soon"), a Helpr can also TAKE the items (the Helpr picks
them up, or the seller drops them off) and then list and sell them. Owner decisions already made:

| # | Decision | Source |
|---|---|---|
| C1 | The Helpr is paid by COMMISSION PER SALE (consignment). Nothing is paid upfront. | owner 2026-10-19 |
| C2 | When an item sells, the buyer pays through Helpr and the app splits it automatically: the seller's share and the Helpr's cut. The Helpr sets the %, shown before booking. This is on top of the normal Declutter fees. We never absorb a fee, and amounts are exact cents. | owner 2026-10-19 |
| C3 | UNSOLD items: the seller chooses at booking: returned after X weeks, donated, or hauled away (through Haul-away). | owner 2026-10-19 |
| (row 71) | "Declutter it for me": book a Helpr who comes over, photographs and lists the items for the owner, and hands them over at pickup. v1 built the in-person version; this spec is the version where the Helpr holds the items. | declutter-auctions.md row 71, 2026-10-14 |

Everything below that is not in that table is the lane's PROPOSAL, marked "proposed", for the owner to
confirm or change (the questions are at the end).

## 1. Who owns what
- **The seller owns the items AND the listing (proposed).** Each listing is the seller's Declutter
  item (`declutter_items.seller_id` = the seller), so every rule that reads the seller still works:
  under 18, ban, 3 strikes, payout setup, the INFORM Act checks, tax attestations and the facilitator
  count. The Helpr never gets the seller's account (v1's promise stays).
- **The Helpr holds the items and runs the sale (proposed).** A new row ties the item to a consignment
  (`declutter_consignments`, below). On a consigned item the Helpr may: take and add photos, edit the
  title, description and condition, set the price inside the band the seller agreed, answer questions,
  accept offers at or above the seller's lowest price, and do the handover. The seller can see all of
  it and can pause or end the consignment, under the agreement's rules.
- **Why not list it under the Helpr's account:** the seller would vanish from the sale, the Helpr would
  look like a business reselling goods (Louisiana secondhand-dealer law, R.S. 37:1861, is already an
  open lawyer question in declutter-terms-draft.md #15), and the Helpr's sales would count as their
  own income for the 1099-K. Keeping the seller as the owner avoids all three.
- The pickup address shown to buyers is the HELPR's pickup place (where the item now is), not the
  seller's home. The seller's address is only for the Helpr's pickup trip, shown only to the booked
  Helpr (the address-access rules Declutter already has).

## 2. The consignment agreement (both accept before anything moves)
One agreement per booking, shown to both on one screen and accepted by both (a timestamped
acceptance row per side, like the lease signatures in Homes). Its parts:

| Part | What | Who sets it |
|---|---|---|
| Items | A list, each with photos and a condition (the Declutter condition stars), a title, and the seller's lowest price | The seller (or the Helpr during the pickup visit, then the seller approves it) |
| Commission % | One % for the whole agreement, whole numbers only (proposed: 10% to 50%) | The Helpr sets it on their offer; shown to the seller BEFORE booking |
| Price band | Asking price and the seller's lowest price per item; the Helpr may sell anywhere in the band | The seller |
| Timeframe | How long the Helpr may try to sell (proposed: 2, 4 or 8 weeks) | Agreed at booking |
| Unsold choice | Returned to the seller after the timeframe, donated, or hauled away through Haul-away | The seller, at booking (C3) |
| Getting the items there | Helpr picks up (a date and a time window) or the seller drops off (the Helpr's address shown after booking) | Agreed at booking |
| Damage and loss | What happens if an item is damaged, lost or stolen while the Helpr holds it (section 6) | Fixed terms, not negotiable (proposed) |
| Ending early | Either side can end it; items not yet sold go back as the unsold choice says, minus nothing (proposed) | Fixed terms |

Changes after acceptance (adding an item, lowering a price, extending the time) are a new version of
the agreement that both accept; a sale always uses the version in force when the buyer paid.

## 3. Handover to the Helpr, and by the Helpr
- **Intake (seller to Helpr):** at pickup or drop-off, the Helpr photographs every item (the same
  photo checks as Declutter handover: no location data) and confirms the list in the app. The seller
  confirms too. That pair of confirmations starts the timeframe and is the condition record for
  damage claims. An item the Helpr refuses at intake (broken, banned, not as listed) comes off the
  agreement on the spot.
- **Sale (Helpr to buyer):** the normal Declutter handover (pickup times, porch pickup, the buyer's
  check at handover), with the HELPR as the person handing over. The buyer's "not as described" refusal
  works the same; who takes the strike is section 7.
- **Unsold, at the end:** returned (the Helpr brings them back in a window the seller books, or the
  seller collects; both confirm with photos), donated (the Helpr uploads a donation receipt photo), or
  hauled away (a Haul-away job is booked for the items, the seller's choice and the seller's cost, as
  Haul-away already works).

## 4. Money: the split (declutter-money)
The buyer's side does not change: item price + the buyer fee (`declutter_buyer_fee_cents`: 5% of the
items + 70c) + sales tax where it applies, one Stripe charge, `transfer_group declutter_order_<id>`.

At handover, today one payout row is written for the seller: item price minus their card-fee debt
(`declutter_consume_fee_debt`). For a consigned item it becomes TWO payout rows from the same order
(proposed):

| Row | Amount (exact cents, computed in SQL at handover under the order lock) |
|---|---|
| Helpr's cut | `floor(item_price_cents * commission_pct / 100)` minus the HELPR's own fee debt, if any |
| Seller's share | `item_price_cents - helpr_cut_cents` minus the SELLER's card-fee debt |

- Rounding: the Helpr's cut rounds DOWN and the seller gets the remainder, so the two always add up to
  the item price exactly (no cent created or lost). A CHECK on the rows: seller share + Helpr cut = item
  price.
- Fees on top: the buyer fee is ours as today. Whether the Helpr's cut also pays Helpr's flat job fee
  (5% + 70c, as delivery Helprs do, B59) is an owner question (question 2 below). "We never absorb a fee":
  every Stripe fee is already inside the buyer fee or booked as a fee debt, so the split itself adds
  no Stripe cost (transfers between our balance and Connect accounts are free).
- Each row is its own Stripe transfer from the order's own charge (`source_transaction`), reconciled
  in the order's transfer group by `metadata.payout_id`, idempotency keys
  `declutter-payout-<row id>` (seller, unchanged) and `declutter-consign-payout-<row id>` (Helpr).
  The existing payout rules apply to BOTH: payout holds, open ban reviews, no Connect account yet
  (skipped, paid later), test and real accounts never mixed, a charge that is not "whole" moves nothing.
- One side can be paid while the other waits (for example the Helpr has no payout account yet): each
  row is independent.

### Refunds and chargebacks after a split
- **Before handover (most refunds):** nothing has been split, so a refund is exactly today's Declutter
  refund; nobody's share exists yet.
- **After handover, refund decided by an admin (dispute row 67):** the refund comes from our balance
  first (as today), then each side's share is clawed back IN PROPORTION to what each received
  (proposed), as a fee debt against that person's future Declutter payouts (`declutter_seller_fee_debts`
  extended to Helprs, or a twin table), never by reversing a transfer silently. Where the fault is
  clearly one side's (the Helpr lost a part; the seller hid a defect), the admin books it all to that
  side.
- **Chargeback after the split:** the same: the disputed amount plus Stripe's dispute fee become
  fee debt, split by the admin's fault decision (default: in proportion). Whether we also use Stripe
  transfer reversals (pulling money back from the Connect accounts at once) is an owner question (question 5);
  today Declutter never reverses a transfer.
- A debt that is never repaid (the person stops selling) stays on their account; whether it blocks
  payouts from Jobs too is an owner question (question 6).

## 5. Tax forms (1099) and thresholds
- **Seller:** their share is a sale of their own goods, counted toward their Form 1099-K totals the same
  way plain Declutter sales are (that itself is still lawyer question #15 in declutter-terms-draft.md).
- **Helpr:** the commission is payment for a SERVICE. If Stripe Connect Express files 1099-Ks, the
  commission transfers count toward the Helpr's 1099-K like job payouts do (federal threshold for the
  year as Stripe applies it). A CPA must confirm this is not a 1099-NEC case (we, not the seller, pay the
  Helpr out of the buyer's charge). Proposed: treat it exactly like job payouts until the CPA says
  otherwise.
- **Louisiana facilitator count:** the item price counts once (the sale), not twice; the commission is a
  split of that sale, not a second sale. `facilitator_threshold_check` must not add the Helpr's row.
- **Sales tax:** is the commission a taxable service on its own? Proposed: no tax is added to the split
  (the buyer's tax, if any, is on the sale); CPA question.
- **INFORM Act:** a Helpr who consigns a lot may cross the $20,000 / 200-sale "high-volume seller"
  line even though the goods are not theirs; lawyer question.

## 6. Damage, loss and theft while the Helpr holds items
Proposed: the Helpr is responsible from intake to sale or return. An item damaged, lost or stolen in
their care is paid to the seller at the seller's LOWEST price, as a debt the Helpr owes (taken from the
Helpr's future payouts, Jobs and Declutter) plus a strike. Louisiana Helpr does not insure or absorb it
(never-absorb rule; compare row 43, where WE absorb delivery damage: the owner may want the same here,
question 7). Intake photos are the evidence; a disagreement goes to the existing disputes screen.

## 7. Strikes (one Declutter count, 3 = out, each expires after a year: rows 7, 16, 17)
| Event | Strike to | Proposed |
|---|---|---|
| Helpr no-show at a booked intake pickup | Helpr | 1 strike; the booking ends |
| Seller no-show at intake | Seller | 1 strike |
| Item not as described AT INTAKE | nobody | The Helpr refuses it at intake; no strike |
| Buyer refuses at sale handover, not as described | The Helpr if their listing misdescribed the photographed item; the seller if a hidden defect | Admin decides when unclear |
| Helpr no-show at a buyer's pickup | Helpr | 1 strike (as a seller no-show, row 19) |
| Item lost, damaged or stolen in the Helpr's care | Helpr | 1 strike + the debt (section 6) |
| Unsold items not returned / donated / hauled by the deadline | Helpr | 1 strike; after 7 more days, treated as lost |
| Seller doesn't collect returned items | Seller | Proposed: after 14 days the Helpr may donate them, no strike |
A Helpr at 3 strikes cannot take new consignments and their live consigned listings pause; items they
hold must still be returned (the return flow stays open to them).

## 8. Layers (for the build, once approved)
| Layer | What |
|---|---|
| DB | `declutter_consignments` (seller, helpr, status, commission_pct CHECK 1..90, timeframe, unsold_choice CHECK, intake mode, version), `declutter_consignment_items` (item_id UNIQUE, condition at intake, intake photos), acceptance rows per side per version, a second payout table or a `party` column on payout rows, Helpr fee debts. RLS on, no client write privilege; everything through RPCs. |
| RPCs | offer / accept / amend / end a consignment, intake confirm, Helpr edits on a consigned item, return / donate confirm; each `require_feature('declutter')` + a new switch `declutter_consignment` (testers), scoped to `auth.uid()`, anon revoked. |
| Money | declutter-money step 2 learns the Helpr row; handover writes both rows; refunds and chargebacks book debts per section 4. Full lh-money-escrow review. |
| Client | The Sell it for me sheet gets a third choice ("A Helpr takes it and sells it for you"); a consignment screen for each side; Helpr tools on a consigned item. |
| Proof | PGlite: the split always adds up (fuzzed prices and %), double handover pays once, refunds after a split book the right debts, a stranger cannot read or act on a consignment, the switch refuses. |

## 9. Questions for the owner (to file through owner-needed once the lead approves; tracked as Q2235)
1. Commission limits: is 10% to 50% right, or a fixed menu (20 / 30 / 40%)?
2. Does the Helpr's commission ALSO pay Helpr's normal job fee (5% + 70c, like delivery Helprs), or is
   the buyer fee our whole cut on a consigned sale?
3. Timeframes: 2, 4 or 8 weeks, or let them pick any number of weeks?
4. Who pays for returning unsold items: included in the commission (Helpr's cost), or a fee the seller
   pays at booking?
5. After a split, a refund or chargeback: keep today's rule (book it as a debt against future payouts),
   or also pull the money back from their bank account right away (Stripe transfer reversal)?
6. An unpaid consignment debt: block only Declutter payouts, or Jobs payouts too?
7. Damage or loss while the Helpr holds an item: the Helpr pays the seller (our proposal), or Louisiana
   Helpr covers it like delivery damage (row 43)?
8. Can a business (a Shops shop in "Declutter and estate sale services") take consignments the same way,
   or only individual Helprs?
9. Should the Helpr need a verified ID and a minimum rating or number of completed jobs before they can
   take other people's things?

CPA / lawyer questions (no owner answer needed, but blocking launch): the Helpr's 1099 treatment
(section 5), whether the commission is taxable, INFORM Act volume for Helprs, and secondhand-dealer law
for frequent consignors (R.S. 37:1861).
