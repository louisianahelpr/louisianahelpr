# Declutter terms of use: owner-approved text, ready to publish

Status: **content approved by the owner 2026-10-22** (Q2308; every point answered, MASTER-LIST.md:365).
Not published yet: it goes live when it is added to the Terms tab (`TermsSection.tsx`). **No terms-version
bump and no re-accept pop-up** (owner, 2026-10-22, #14). Written from the current record only: the owner
rulings in the lead's master list (newest last), the Declutter launch handoff, the Declutter specs in
`docs/specs/declutter-*.md` and `~/.lh-wt/declutter-seller-delivery-spec.md`, the Declutter items in
`docs/OPEN.md`, and the code and migrations on `origin/main` @ 42c7557608 for every number. No lawyer
step (owner, 2026-10-21). Each number has a hidden note beside it (`<!-- ... -->`) saying where it was
read; the notes do not show when the page is published. Earlier versions are in git history.

## For the owner: your answers of 2026-10-22, as written into the text
<!-- all from MASTER-LIST.md:365 unless noted -->
- "Declutter is not an auction" is published now (section 1).
- The buyer always gets the full 24 hours after pickup to ask for a refund; "I got it" and the porch photo do not end it early (sections 7, 10).
- The seller can decline a refund request; the buyer can then report a problem and an admin decides. If the seller doesn't answer in 24 hours, an admin decides and the payout stays held. A full refund gives back everything except the card fee (the buyer's fee included), and the item goes back to the seller (section 10).
- A delivery pay raise: the buyer pays the raise plus its card fee, and the Helpr gets the whole raise (section 8).
- Kept: a Helpr who already picked up is paid for the trip on a seller-fault refund; free take-down with unaccepted offers; the extras' numbers; Helpr delivery at a set price plus raises (sections 3, 8, 15).
- Stripe Identity once, across Jobs and Declutter, asked at the first Declutter purchase or listing; the $2 setup fee once per account, whichever comes first (section 2).
- Taxes in general words, with no promises on the CPA points (section 20).
- On account deletion: strikes stay tied to the verified ID; finished sales stay visible to the other side as "Former member" (section 21).
- Seller delivery is in, and opens with launch (section 9). <!-- MASTER-LIST.md:363; seller-delivery spec "Owner answers 2026-10-22" -->

## For the owner: in the text, but not on `main` yet (they open with launch)
You ruled these, so they are in the terms. The app on `main` (42c7557608) does not do them yet:
- The buyer raising the delivery pay, the Helpr getting the whole raise, and the raise card-fee rules (Q1929, being built). <!-- docs/OPEN.md Q1929 -->
- Refund requests within 24 hours of pickup: the seller refunding, offering part or declining, an admin deciding on a decline or no answer, and the payout held until then (board 141, Declutter side). <!-- MASTER-LIST.md:321, :365 -->
- A seller's door "Picked up" becoming final 24 hours later unless the buyer reports a problem (Q2151 (a)); today it is final at once. <!-- docs/OPEN.md Q2151 -->
- Seller delivery (being built behind the `declutter_seller_delivery` switch). <!-- MASTER-LIST.md:347, :363 -->
- Stripe Identity at the first Declutter purchase or listing, and the setup fee at the first Declutter purchase or listing. Today no Declutter money path takes the setup fee. <!-- MASTER-LIST.md:365 #9; grep "onboarding" in supabase/functions/declutter-money and declutter-checkout: no match (2026-10-21) -->
- Rounding a delivery Helpr's pay down to the whole dollar (jobs payouts already do it). <!-- MASTER-LIST.md:348 -->
- Strike appeals and the storm pause. <!-- spec rows 39, 49; no appeal or pause function in supabase/migrations (grep, 2026-10-21) -->
- Not checked against `main` for this text: that strikes stay tied to the verified ID after a deletion, and that the other side sees "Former member" on a finished sale.

## Where this would sit in the app (suggestion, not a decision)
A new "Declutter" section in the **Terms** tab (`/legal`, anchor `declutter`), in the same card style as
"Payment, escrow & fees", with the strike rules also listed as one row in **Community Rules**. It points
to the existing sections instead of repeating them: Eligibility & accounts, Payouts & Stripe Connect,
Disclaimers & limitation of liability, Tax responsibilities, Community Rules, and Privacy. The main
Terms call the company "Helpr"; this draft says "Louisiana Helpr" or "we" so it is never confused with
a Helpr (a person doing the work).

---

# Declutter

*These Declutter terms are part of the Louisiana Helpr Terms of Service. Everything in the main Terms,
the Community Rules and the Privacy policy still applies to you in Declutter. Where this section says
something more specific about Declutter, this section wins for Declutter.*

### The short version
- Declutter is where Louisiana neighbors sell their own used household items to each other.
- Sellers set a price. Buyers can buy at that price or make a private offer. Prices drop 5% each evening until the item sells or reaches the seller's lowest price.
- Sellers pay no fee. Buyers pay a buyer's fee of 5% of the items + 70 cents, once per checkout.
- You need a saved card to buy or make an offer. After you buy, or your offer is accepted, you have 48 hours to check out and pay. <!-- read 2026-10-21: 20261014210518_declutter_slice3_offers_checkout.sql:487 -->
- Pick it up from the porch or at the seller's door, or have a Helpr or the seller deliver it.
- You always get 24 hours after pickup to ask for a refund. After that the sale is final.
- Breaking the rules earns a Declutter strike. 3 active strikes and you can't use Declutter until one expires (each lasts 1 year). Your jobs are not affected.
- Louisiana Helpr is the place where the sale happens. We are not the seller.

---

## 1. What Declutter is
Declutter is a section of Louisiana Helpr where members sell their own used household items to other
members. Each item has a price set by the seller. A buyer can buy it at that price or send the seller a
private offer, and the seller decides whether to accept.

Declutter is **not an auction.** There is no bidding, no countdown, and no "highest bid wins". An item
sells to the first buyer whose purchase or offer is accepted and who then pays.
<!-- spec rows 55-59; B2 (offers only); owner 2026-10-22 #1: publish now (MASTER-LIST.md:365) -->

You can get your item four ways:
- **Porch pickup** (the default): the seller leaves the item out (on a porch or another safe place) and you collect it.
- **Pickup at the seller's door**, for items the seller doesn't leave out (too big or too valuable).
- **Helpr delivery**: a Helpr picks it up and brings it to you (section 8).
- **Seller delivery**: the seller brings it to you, at a time you book, when the seller offers it (section 9).

Shipping is not offered.
<!-- spec rows 24, 101, 102; 20261017055504_declutter_porch_default.sql; seller delivery: MASTER-LIST.md:363, seller-delivery spec; shipping Q2259 paused (docs/OPEN.md) -->

Declutter also has extras: booking a Helpr to put an item together or hang it (Add a Helpr), a Helpr
haul-away for items that don't sell, moving-out tools and moving sales, a price hint, and Wanted posts
(section 15).

## 2. Who can buy and sell
To buy, make offers, post a Wanted request, deliver, or sell in Declutter you must:
- **Be 18 or older.** Members under 18 can't buy, make offers, post Wanted requests, deliver or sell. The buttons are greyed out and our server refuses the request too. <!-- spec row 53; B32; Wanted W4; B72b -->
- **Have a Louisiana Helpr account in good standing**: signed in, not banned, with fewer than 3 active Declutter strikes (section 12). <!-- B10; 20261014193955_declutter_foundation.sql:449 (>= 3 strikes refused) -->
- **Deal in items located in Louisiana.** Items and pickups are in Louisiana. Buyers may live anywhere. <!-- spec rows 5, 69 -->

Sellers must **set up payouts with Stripe before their first listing**, the same step Helprs take before
getting paid (see Terms, Payouts & Stripe Connect). <!-- spec row 23 -->

Buyers must have **a saved card** before making an offer or buying (section 6). <!-- spec row 36; B31 -->

**Verify your ID once.** Before your first Declutter purchase or your first listing, you verify your ID
with Stripe Identity (a photo ID and a selfie). You do it only once for all of Louisiana Helpr: if you
already did it for Jobs, you don't do it again. <!-- MASTER-LIST.md:365 #9 (owner 2026-10-22); MASTER-LIST.md:245 (Stripe Identity = photo ID + selfie) -->

**The one-time account setup fee** in the main Terms is charged once per account, whichever comes first:
your first Jobs payout, or your first Declutter purchase or listing. <!-- MASTER-LIST.md:365 #9 -->

## 3. Listing an item
**Only your own personal things.** You may list only household items you own and bought for your own
use. When you list, you confirm four things, and we keep your answers:
1. you bought the item for your own personal or household use,
2. you are not in the business of selling items like it,
3. you don't sell things often, and
4. you will keep the item yourself until you hand it over.

If you change the title, description or category of an unlisted item, you confirm these again before it
goes up. When you list several items at once (moving out, section 15), you confirm them once for the
batch, and we record them for each item. <!-- spec row 54; B18; src/components/declutter/declutterUi.tsx TAX_STATEMENTS; moving-out M12 (owner 2026-10-17) -->

**Photos.** Each listing needs at least 1 and at most 12 photos that you took of the actual item. The app
checks that they are real photos, not pictures from the internet, and removes location data from your
photos before they are posted. <!-- src/lib/declutter/photoRules.ts:9-10 (DECLUTTER_MIN_PHOTOS = 1, MAX = 12); 20261020040503 (owner 2026-10-20); B4, "Photos" note -->

**Be honest.** Your title, description, category, size and condition must describe the item accurately,
including any damage or missing parts. The listing is what the buyer relies on.

**AI help.** The app can draft your title, description, category, size and condition from your photos.
It is a suggestion only: **you must read and correct it before you post, and you are responsible for
every word of your listing**, whoever drafted it. Before a listing goes up, the app also checks the
photos and text for banned items (section 4). <!-- spec row 32; B19 -->

**Review by our team.** Your first 3 listings, and any listing the automatic check flags, wait for a
Louisiana Helpr admin to approve them. If an admin rejects a listing, you see the reason. We may also
remove any listing that breaks these terms. <!-- spec row 33; B8 -->

**Price.** You set a price and a lowest price you'll accept. The lowest price is private. Prices are
from $1 to $1,000 per item. If you don't want your price to drop, set your lowest price equal to your
price. <!-- read 2026-10-21: 20261014230342_declutter_price_cap_1000.sql:26 (100000 cents) and :66 (100..100000 cents); spec row 70; B3 -->

**Location.** You give your pickup address (kept private) and a public area name like "River Road area"
or "Metairie 70005". The area name can't contain your house number or street address. <!-- B7; "Area label" note (declutter_area_label_problem) -->

**Pickup times.** You set your usual weekly pickup times when you list. <!-- spec row 52; B6 -->

**Porch or door.** Porch pickup is on for every item unless you turn it off when you list (for an item
too big or too valuable to leave out). Then buyers pick it up at your door. You can't change this after
the item is listed. <!-- 20261017055504_declutter_porch_default.sql (porch_ok set only on a draft; trigger refuses a change after) -->

**Managing a live listing.** While it is for sale you can:
- change its price or its lowest price (never above the price it was first listed at);
- stop or restart the evening price drops;
- **pause** it: it is hidden from buyers, keeps its photos and watchers, and any open offers close (nothing is charged);
- **relist** a paused item: it goes back on sale.
<!-- 20261020064354_declutter_manage_listing.sql header -->

**Taking a listing down.** You can take your own listing down at any time before an offer is accepted or
someone buys it. Any open offers close and those buyers are told. Once you've accepted, backing out is a
strike (section 12).
<!-- B20, B36, B46; owner 2026-10-22 #6: keep free take-down (MASTER-LIST.md:365) -->

## 4. What you can't sell
These items are not allowed in Declutter:
- weapons, ammunition, and knives made as weapons;
- alcohol;
- prescription drugs and illegal drugs;
- vapes;
- any recalled product;
- cribs made before mid-2011;
- used car seats;
- counterfeits;
- adult items;
- live animals;
- vehicles and boats;
- real estate.

The app checks listings for these when you post, and flagged listings wait for an admin.
<!-- spec row 34 (owner decision) -->

## 5. Prices, offers and price drops
**Buy at the listed price.** You can buy an item at today's price. If the price has gone UP since you
looked (it shouldn't, prices only drop), we stop and show you the new price first. <!-- B28 -->

**Make an offer.** You can send the seller a private offer instead.
- Your offer must be **at least half of today's price** (and at least $1). <!-- src/lib/declutter/money.ts:33-34 (minOfferCents); spec row 58 -->
- The side whose turn it is has **48 hours** to accept, say no, or answer with a different price. Each new answer restarts the 48 hours, and either side can keep going back and forth. <!-- 20261014210518_declutter_slice3_offers_checkout.sql:657 (respond_by = now() + 48 hours); spec row 57; B25 -->
- If nobody answers in 48 hours, the offer simply expires. No strike.
- You can take your offer back at any time before it is accepted.
- You can have one open offer per item, and start at most 3 offers on the same item in 24 hours. <!-- B25, B27 -->
- Several buyers can make offers on the same item. **The first one accepted gets it**, and every other open offer on that item closes (those buyers are told; nobody is charged). <!-- spec row 57; B29 -->
- An offer below the seller's private lowest price still reaches the seller, and the seller decides. Every "no" looks the same to a buyer. <!-- B26 -->
- If an offer is accepted, you pay the accepted amount or today's price, whichever is lower. <!-- B28 -->

**Accepting is a promise.** When you buy, or an offer is accepted, the item is reserved for you and goes
in your cart. You then have 48 hours to check out and pay (section 6). <!-- read 2026-10-21: spec row 59; 20261014210518:487 -->

**Evening price drops.** Every evening (about 6 PM Louisiana time in summer, 5 PM in winter), the price
of each unsold item drops 5%, at most once a day. Items listed less than 12 hours earlier skip that
evening. Drops stop a little above the seller's private lowest price, at a point chosen at random, so
nobody can work out the seller's lowest price. People watching the item get a "price dropped" alert.
Open offers keep their amounts when the price drops.
<!-- 20261014210518:1257 (cron '7 23 * * *' UTC); 20261014224914_declutter_slice3b_payments.sql:422 (floor(price * 0.95)); B35; B42 (stop 2-8% above the floor, docs/specs/declutter-auctions.md:416) -->

This is not bidding. Buyers never compete in a timed bidding round.

## 6. Checkout and what buyers pay
**A saved card.** We need a saved card before you make an offer or buy. We charge it only when you check
out and pay, or automatically in a part of Louisiana Helpr where you turned on automatic charges (one
saved card is used across the app). <!-- spec row 36 (2026-10-18); 20261018160108_declutter_card_notice_one_wallet.sql -->

**48 hours to check out.** After you buy or your offer is accepted, you have 48 hours to check out:
choose how you'll get the item and pay. We remind you 24 hours and 2 hours before the deadline. If you
miss it, you get **1 Declutter strike** and the item goes back on sale.
<!-- read 2026-10-21: 20261014210518:487 (checkout_by = now() + 48 hours); spec row 13; B34 -->

**One checkout per seller.** Items you're buying from the same seller go into one checkout: one payment,
one pickup or delivery. <!-- spec row 38; B30 -->

**What you pay.**
- The item price, plus
- a **buyer's fee of 5% of the item total + 70 cents**, once per checkout. It already includes the card-processing cost. <!-- 20261015023613_declutter_buyer_fee_f1.sql:95 (round(items * 0.05) + 70); src/lib/declutter/money.ts:12-13; spec rows 20-21 (F1) -->
- For Helpr delivery, the delivery fee (section 8). There is no buyer's fee on the Helpr delivery fee. <!-- B62 -->
- For seller delivery, the seller's delivery rate (section 9). The buyer's fee is worked out on the items and the seller's delivery rate together. <!-- MASTER-LIST.md:363 ("buyer 5% fee on items+delivery"); seller-delivery spec ("the 70c fee is shared the same way") -->
- You see one total before you pay. Sales tax: none on sales by casual sellers (section 20).

**What sellers pay: nothing.** There is no seller fee. The seller receives 100% of the item price
(minus any card fee the seller owes from an earlier sale they cancelled, section 11). <!-- spec row 22; B43, B53 -->

Payment is processed by Stripe. Louisiana Helpr holds the money until the sale is final (section 10).

## 7. Pickup and handover
**Within 7 days of payment.** Every pickup and delivery happens within 7 days of paying. <!-- spec row 14; 20261018183715_declutter_handover_no_qr_no_code.sql:262 (paid_at + 7 days) -->

**The exact address only after you pay.** Before you pay, you see only the seller's area and the
distance in miles. Right after you pay, you get the exact pickup address. <!-- spec rows 27, 98; B56 -->

**Book a time.** After paying for a pickup, you book a 30-minute slot inside the seller's pickup times,
before the 7 days run out. Each of you may move the booking once. <!-- B49 -->

**Porch pickup.** The seller sets the item out, posts a photo of it, and may add a short note on where
exactly it is (up to 200 letters). You collect it and tap "I got it", or take a photo and tap "Picked up".
The seller can say how long the item stays out ("out all day" or "out until" a time). If you haven't
collected it by then, the seller may bring it in and it counts as you not showing up.
<!-- spec rows 26, 97, 99; 20261021023158_declutter_porch_note.sql:18 (1-200 letters) -->

**Pickup at the door.** You tap "I got it" when you have the item, or the seller taps "Picked up". The
app shows both of you short safety tips, and offers "Add a Helpr" to help carry it. <!-- spec row 25 (2026-10-18); 20261018183715 header -->

**If nobody taps.** If neither of you confirms, the handover counts as done 24 hours after the booked
time, unless a problem has been reported. A porch pickup counts as done this way only if the seller
posted the "set out" photo. <!-- spec row 28; 20261018183715:236 (slot_start + 24 hours), header item 5 -->

**A seller's "Picked up" at the door** becomes final 24 hours later unless you report a problem.
<!-- docs/OPEN.md Q2151 "OWNER DECIDED 2026-10-21" (a); not built yet -->

**You always get 24 hours.** However the pickup is confirmed ("I got it", the porch photo, the seller's
"Picked up", or the 24-hour rule), you have the full 24 hours after pickup to ask for a refund
(section 10). <!-- MASTER-LIST.md:365 #2 (owner 2026-10-22) -->

**Someone didn't show.** 15 minutes after the booked time, the side who is waiting gets a "They didn't
show" button. A buyer who misses a pickup may rebook once within the 7 days; a second miss cancels the
sale (section 11). A seller who doesn't show refunds the buyer in full (section 11).
<!-- spec rows 94, 95; 20261015042253_declutter_slice4_handover_payout.sql:1039 (slot_start + 15 minutes); B55 -->

**Report a problem.** Either of you can tap "Report a problem" on a sale (not as described, damaged,
didn't get it, someone didn't show, felt unsafe, or something else) until the sale is final. The money
stays held while Louisiana Helpr looks at both sides' photos and messages and decides.
<!-- spec rows 67, 96; B54; src/components/declutter/DeclutterHandoverViews.tsx PROBLEM_WORDS -->

## 8. Helpr delivery
**The price.** $10, plus $2 for each road mile from the pickup to your address, plus $20 for each large
item and $40 for each extra-large item (two people). There is no distance limit. Road miles are
estimated from the straight-line distance (times 1.3, rounded up to a whole mile, at least 1 mile).
<!-- read 2026-10-21: 20261017055505_declutter_helpr_delivery.sql:1431-1433 (1000 + 200 * miles + 2000 large / 4000 xl per item), :1450 (x 1.3, ceil, at least 1); spec rows 29, 30; B60; owner 2026-10-22 #8: keep the set price, no Helpr quotes (MASTER-LIST.md:365) -->

**When it's offered.** Delivery is offered when every item in the checkout is at one pickup address. You
type your drop-off address (any US address) and we work out the price on our side. <!-- B61, B62 -->

**How it works.** A Helpr takes the delivery and picks the pickup time, inside the seller's pickup times
and within the 7 days. The seller and you are told. The Helpr takes a photo at pickup and leaves the item
at your door with a photo. Then you tap "I got it", or the delivery counts as done 24 hours after the
drop-off. There is no code.
<!-- B63, B65 (2026-10-18); 20261018184535_declutter_delivery_no_dropoff_code.sql; 20261017055505:1305-1308 (delivered_at + 24 hours) -->

**If no Helpr takes it in 48 hours.** The whole delivery fee comes back to you, and the order becomes a
pickup at the seller's door (the 7-day clock keeps running).
<!-- spec row 40; B68; 20261017055505:1984 (open until paid_at + 48 hours, or 7 days - 2 hours if sooner) -->

**Raising the pay.** While you wait for a Helpr, you can raise the delivery pay to attract one:
- at least $5 each time, in whole dollars;
- at most $150 in raises in total for one delivery;
- not in the last hour of the 48 hours.

You pay the raise plus its card fee, and the Helpr gets the whole raise (no Helpr fee is taken from it).
If the raise is refunded, you get it back with its card fee, unless you cancel for your own reason. If
the seller's fault cancels a delivery you raised, the seller pays the card fee on your raise.
<!-- read 2026-10-22: MASTER-LIST.md:338 (owner 2026-10-21, Q1929 caps); :342 (seller-fault raise card fee); :365 #4 (buyer pays raise + card fee, Helpr gets the whole raise); not on main yet (docs/OPEN.md Q1929) -->

**Who can deliver.** A Helpr who is 18 or older, has set up payouts, is not banned, has fewer than 3
Declutter strikes, and is not the buyer or the seller. Large and extra-large items need a Helpr with a
truck (with a photo of it), and extra-large ones a second person too. <!-- B72b; spec row 41 -->

**What the Helpr is paid.** The delivery fee minus the same Helpr fee as jobs (5% of the pay + 70
cents), plus any raise in full. Helpr pay is paid in **whole dollars, rounded down**; Louisiana Helpr
keeps the leftover cents.
<!-- 20261017055505:314 (helpr_task_fee_cents = round(pay * 5%) + 70, never more than the pay); spec row 42; B59; rounding: MASTER-LIST.md:337 (owner 2026-10-21), not built for delivery yet (MASTER-LIST.md:348) -->

**Helpr strikes.** A Helpr who backs out less than 2 hours before the pickup, or doesn't pick up within 2
hours of the pickup time, gets a strike on the jobs strike ladder (not a Declutter strike), and the
delivery goes back up for other Helprs. 3 back-outs or misses in 7 days pause taking new deliveries.
<!-- B64, B66, B72, B77; 20261017055505:978 (>= 3 in 7 days) -->

**Damaged in delivery.** If the item is damaged on the way: you get everything back (the delivery fee
too), the seller is still paid, and the Helpr is not paid and gets a strike. Louisiana Helpr covers the
cost. <!-- spec row 43; B71 -->

**If the Helpr already picked up the item and the sale is then refunded for the seller's fault**, the
Helpr is paid for the trip from the payment, so the delivery fee is not refunded. <!-- B69; owner 2026-10-22 #5: keep (MASTER-LIST.md:365) -->

## 9. Seller delivery
Some sellers deliver themselves. When a seller offers it, you can choose it at checkout.

**The seller's side.** The seller turns on "I can deliver" and sets:
- **one flat delivery rate per order**, in whole dollars, from $5 to $150 (the same rate whatever the number of items);
- **how far they'll go**: 5, 10, 25 or 50 miles from their pickup address (10 unless they change it);
- **their delivery times**: weekly hours, in 1-hour slots, plus days off.

The seller can turn delivery off for an item that is too heavy. The seller keeps the whole delivery
rate; Louisiana Helpr takes no cut of it.

**Your side.** At checkout, seller delivery shows only when your address is within the seller's range
and a time is open. You book a 1-hour slot from 24 hours ahead up to 14 days out, and choose:
- **"Leave it at my door"**: the seller leaves it with a photo, and it is confirmed like a porch pickup; or
- **"Hand it to me"**: you meet at your door. If nobody is home, report a problem and an admin decides.

The seller sees your address only after you pay. Either of you can ask to move the time, to the
seller's open times, at most 3 times each. If it doesn't come, "It wasn't delivered" opens 15 minutes
after the booked hour ends.

**Cancelling.**
- **You** can cancel a paid seller delivery until 24 hours before the slot: you get everything back (items and the delivery rate) except the card fee. After that, use "Report a problem".
- **The seller** cancelling a paid delivery means a full refund to you, a Declutter strike for the seller, and the seller pays the card fee.
<!-- read 2026-10-22: MASTER-LIST.md:363 (owner pop-ups 2026-10-22); ~/.lh-wt/declutter-seller-delivery-spec.md "Seller side", "Buyer side", "Owner answers 2026-10-22"; not on main yet (switch declutter_seller_delivery) -->

## 10. When the seller gets paid, and when the sale is final
**Refunds within 24 hours of pickup.** After you have the item, you have the full 24 hours to ask for a
refund in the app. The seller can:
- **refund all of it**: you get everything back except the card fee (the buyer's fee included), and the item goes back to the seller;
- **offer to refund part of it**: a part refund is exactly the amount offered; or
- **decline**: you can then tap "Report a problem", and Louisiana Helpr decides.

If the seller doesn't answer within 24 hours, Louisiana Helpr decides, and the seller's payout stays held
until then. <!-- MASTER-LIST.md:321 (owner 2026-10-21 AM); :205 ("both now, with partials"); :365 #2, #3 (owner 2026-10-22); not built yet -->

**The seller is paid when the sale is final.** The seller's payout is held until the sale is final:
24 hours after pickup, with no refund asked and no problem reported (or once Louisiana Helpr has
decided). Then the item price, and any seller delivery rate, is sent to the seller's Stripe account,
and the bank timing follows Stripe's normal schedule (Terms, Payouts & Stripe Connect).
<!-- MASTER-LIST.md:321 ("seller payout HELD until final"); spec row 93; seller-delivery spec "Money" -->

**After that, the sale is final.** The item is yours **as is**. There are no returns after the sale is
final. <!-- spec row 15 -->

## 11. Refunds and fees
"The card fee" below is the fee Stripe keeps on your payment.

| What happened | What the buyer gets back | Strike |
|---|---|---|
| **Our mistake** (for example a duplicate charge, or a payment that reached an order that had already closed) | Everything | None |
| **Not as described** (a reported problem we decide for the buyer) | Everything. The card fee is charged to the seller and taken from their future Declutter payouts. | Seller |
| **Seller doesn't show up** at a booked pickup | Everything. The card fee is charged to the seller. | Seller |
| **The item is gone** after it sold | Everything | Seller |
| **Seller backs out, or blocks the buyer, after the buyer paid** | Everything. The card fee is charged to the seller. | Seller |
| **The seller can no longer sell** (banned, 3 strikes, under 18, or flagged as a business) when the buyer pays | Everything. The card fee is charged to the seller. | None |
| **Damaged in delivery** | Everything, the delivery fee too | Helpr (jobs ladder) |
| **No Helpr takes the delivery in 48 hours** | The delivery fee. The order becomes a pickup. | None |
| **A delivery falls through with less than 48 hours left** before the 7-day deadline | The delivery fee in full, and the rest minus the card fee. The item goes back on sale. | None |
| **Buyer never picks up** within the 7 days, or misses a pickup twice | The item price. The buyer's fee is kept. The seller can relist for free. | Buyer |
| **Buyer cancels**, or paid twice by restarting checkout | The payment minus the card fee | None |
| **Nobody's fault** (decided by Louisiana Helpr) | The payment minus the card fee | None |
| **Buyer misses the 48-hour checkout** | Nothing was charged | Buyer |
| **The buyer asks within 24 hours and the seller refunds all of it** | Everything except the card fee (the buyer's fee included). The item goes back to the seller. | None |
| **A part refund the seller offered** (section 10) | Exactly the amount offered | None |
| **Buyer cancels a paid seller delivery** at least 24 hours before the slot | Everything (items and the delivery rate) except the card fee | None |
| **Seller cancels a paid seller delivery** | Everything. The card fee is charged to the seller. | Seller |

<!-- reason -> policy: 20261017060455_declutter_seller_out_pays_fee.sql:55-69 (full_seller_pays_fee: seller_backed_out, seller_out, seller_no_show, not_as_described; keep_card_fee: buyer_cancelled, buyer_restarted_checkout, admin_no_fault; keep_buyer_fee: buyer_no_show, admin_buyer_fault; everything else, delivery_damage included, full_platform_absorbs); spec rows 18, 19, 60, 91, 92, 95, 100; B40, B51, B68, B76; part refund MASTER-LIST.md:321; full refund on request MASTER-LIST.md:365 #3; seller delivery MASTER-LIST.md:363 -->

## 12. Declutter strikes
Declutter keeps **one strike count** for each member, covering buying and selling together. It is
separate from job strikes: Declutter strikes never affect your jobs.

**Each strike lasts 1 year** from the day it is given. **3 active strikes lock you out of all of
Declutter** (buying, offers, selling, delivering, Wanted posts, watching items and asking questions)
until one of them expires. While you're locked out, your listings are hidden from others.
<!-- 20261014193955_declutter_foundation.sql:322 (expires_at = given_at + 1 year), :449 (>= 3 refused); spec rows 7, 16, 17; B10, B36; 20261017055505:680 (delivery); Wanted W4 -->

**Buyers get a strike for:**
- missing the 48-hour checkout;
- paying but not picking up within the 7 days.

**Sellers get a strike for:**
- not showing up at a booked pickup;
- the item being gone after it sold;
- backing out after accepting an offer or a purchase (before or after the buyer paid), or cancelling a paid seller delivery;
- an item that is not as described;
- blocking the buyer after the sale.

**Fake offers** (section 13) can get you removed from Declutter altogether.
<!-- strike reasons: 20261014193955_declutter_foundation.sql:279-286; spec rows 18, 19, 48; slice 3 review fixes (blocking the buyer) -->

You can see your count on the Declutter screen ("You have N of 3 strikes").

**Appeals.** You can appeal each strike once: write a note and, if you like, add a photo. An admin
reviews it and either removes the strike or keeps it. <!-- spec row 49; not built yet -->

## 13. Fair play
- **No offers on your own items.** Offers from someone who shares the seller's household, phone or card are flagged to an admin. **A member proven to have made fake offers is removed from Declutter.** <!-- spec row 48 -->
- **No fake activity** of any kind to push a price or find out a seller's lowest price.
- **No off-app payments.** Pay only through checkout. Asking for or arranging payment outside Louisiana Helpr is banned by the Terms (Prohibited conduct) and the Community Rules, and is handled exactly as it is for jobs. <!-- spec row 68 -->
- Everything in the Community Rules (respect, honesty, safety, reporting) applies here too.

## 14. Questions and messages
**Before you buy, ask on the item page.** Questions and answers show on the item page for everyone. The
asker is shown only as "a neighbor", never by name, the seller included. Questions, answers, titles and
descriptions can't contain phone numbers, emails, payment handles or other contact details; the app
refuses them. You can ask up to 20 questions a day.
<!-- spec row 35; B12 (20 a day); 20261021122157_declutter_item_questions.sql (Q2278, "Asked by a neighbor") -->

**Private messages open only after checkout**, between the buyer and seller of that sale.

If you and the seller have blocked each other (either way), you can't watch or ask about each other's
items. <!-- B17 -->

## 15. Extras
**Add a Helpr.** After you pay, you can book a Helpr to put the item together, hang it on the wall or set
it up at your place. It is an ordinary Helpr job: you set the price and pay for it separately, under the
normal job rules and fees. The seller isn't told. If the Declutter sale is refunded because the seller
failed, the Helpr job is cancelled with no cancellation fee and you get the card fee back; the seller
owes that card fee. <!-- docs/specs/declutter-add-a-helpr.md steps 1-4, A2-A4, A9, A10 (owner 2026-10-17) -->

**Haul-away.** If an item hasn't sold 14 days after it went up for sale (or it is off sale without
selling), you can book a Helpr to take it to a donation center, or the dump if donation won't take it.
One haul-away takes up to 10 items from one pickup address. It is an ordinary Helpr job: you pick the day
and the pay (the app suggests $15 for a small item, $35 large and $60 extra large, at least $40 a trip)
and pay like any job. Booking takes the items off sale. A paused item must be relisted before a
haul-away can take it. The Helpr sends a photo at drop-off.
<!-- 20261017070827_declutter_haul_away.sql:408 (14 days), :219 (more than 10 refused); src/lib/declutter/haulAway.ts:48-50; docs/specs/declutter-haul-away.md H1-H8, H13; paused: MASTER-LIST.md:345 (owner 2026-10-21) -->

**Moving out and moving sales.** If you're moving, you can photograph each room and the app drafts
listings for up to 15 items at a time; you check and price each one before it goes up (every rule above
still applies to each item). Your moving sale can show its name, its dates and your move-out date (up to
180 days away) on your profile, but never your address. The move-out date stops showing after it
passes. Room photos are used once to draft the listings and are never stored or shown.
<!-- docs/specs/declutter-moving-out.md M3-M7, M10, M12; M6 (owner 2026-10-17: exact date); 20261021030654_declutter_moving_sale_name.sql -->

**Price hint.** On a listing and when you sell, the app may show what similar items sold for nearby.
It is worked out only from real Declutter sales (same category and condition, within about 25 miles, in
the last year) and shows only when there are at least 11 such sales from at least 3 sellers and 3
buyers. It is a guide, not a promise. <!-- docs/specs/declutter-wanted-price-hint.md W9, W10, W11 -->

**Wanted posts.** You can post what you're looking for, with the most you'll pay (in whole dollars). A
post lasts 30 days. Other members see your post with your first name and last initial and about how
many miles away it is (never your address), and a seller can answer it with an offer on one of their
listings, at or under your price. You can make your post private. Limits: 5 new
posts a day and 10 open at once; a seller can answer 10 posts a day, and a post gets at most 5 answers a
day. <!-- declutter-wanted-price-hint.md W2, W7; 20261021031757_declutter_wanted_public_replies.sql items 1, 3, 5, 6 (owner 2026-10-21); owner 2026-10-22 #7: keep the extras' numbers (MASTER-LIST.md:365) -->

## 16. Safety at pickup
You meet other members at your own risk (Terms, Disclaimers & limitation of liability). Some
common-sense steps:
- Porch pickup means you never have to meet. Use it when you can.
- Use the booked time and the in-app steps ("I got it", "Picked up", "Report a problem").
- Never pay or take payment outside the app.
- Use "Report a problem" or the report button for anything that doesn't feel right.

## 17. Storms and other pauses
When severe weather or another emergency hits, we may pause Declutter for all of Louisiana or for chosen
parishes. During a pause the checkout and pickup clocks stop and no new strikes are given. When the
pause ends, the clocks pick up where they stopped. <!-- spec row 39; not built yet -->

## 18. If Declutter is turned off
We may turn Declutter off for everyone or for some members. If that happens, sales already agreed (an
accepted offer or a paid order) can still be paid for and handed over, nobody gets a strike for a sale
the shutdown interrupted, and nothing new can start. <!-- spec row 62; B44 -->

## 19. Our role: we are the venue, not the seller
Louisiana Helpr provides the place where members buy and sell. **Each sale is between the buyer and the
seller.** We do not own, inspect, store, test or guarantee any item, and we are not the seller. We hold
the payment through Stripe until the sale is final and then pay the seller. Our listing checks and admin
reviews look for banned items and rule-breaking; they are not a promise that an item is safe, genuine,
legal, working or as described.

Terms, Disclaimers & limitation of liability (including the limit on our liability and your promise to
indemnify us) applies to Declutter sales exactly as it does to jobs: read "job" there as including a
Declutter sale and a Declutter delivery.

## 20. Taxes
**Casual sellers: no sales tax.** Louisiana exempts "isolated or occasional sales" by someone who is not
in that business (La. R.S. 47:305(A)). That is why every seller confirms the four statements in section
3. Sales by casual sellers carry no sales tax. <!-- spec row 54 (1); "Sales tax research" -->

**Sellers who look like a business.** If a seller lists like a business (many or repeat listings, resale
stock), we may flag the account. Until our tax step is built, a flagged seller can't complete a Declutter
sale. <!-- spec row 54 (2); B33 -->

**Our own obligations.** We keep track of Louisiana Declutter sales as the law requires of a
marketplace, and we follow the tax rules that apply to us.

**Your own taxes.** Taxes on your own income from selling or delivering are your responsibility; see
Terms, Tax responsibilities. We don't give tax advice: ask a tax professional about your situation.
<!-- owner 2026-10-22 #10/#11: general tax wording, no promises on the CPA points (MASTER-LIST.md:365) -->

## 21. Privacy
- **Your location:** before a buyer pays, they see only your public area name and about how many miles away the item is (our map point is rounded to about 1 km). The exact address goes only to the buyer who paid, or to the Helpr who took the delivery. A delivery Helpr sees the drop-off address only after picking the item up. <!-- spec row 27; B7; "Exact addresses" note under B74 -->
- **Your photos:** the app removes location data from every photo. Listing photos are shown to other members, and anyone with a photo's web link can open it. Porch, delivery and problem photos are private to the two sides (and the Helpr), and our admins. <!-- B4; 20261017055502_declutter_handover_private_bucket.sql; B73 -->
- **Your questions:** other members, the seller included, never see who asked. <!-- 20261021122157 -->
- **AI help:** the photos and text of your listing, and room photos when moving out, are sent to our AI provider (Google Gemini, listed in the Privacy tab) to draft and check the listing. Room photos are never stored. <!-- B19; moving-out M4; supabase/functions/declutter-ai-draft/index.ts header -->
- **Your data:** "Download your data" includes your Declutter activity. See Privacy, Your rights. <!-- B9 -->
- **Deleting your account:** you can't delete your account while a Declutter sale or delivery is in progress. Once you delete it, your Declutter photos are removed. <!-- slice 3 review fixes (findActiveWork); B75; B4 -->
  Your Declutter strikes stay tied to your verified ID. Your finished sales stay visible to the other side, with you shown as "Former member". <!-- MASTER-LIST.md:365 #12 (owner 2026-10-22) -->
- **Emails:** Declutter emails you only about money (sold, receipts, refunds). Everything else comes as a push notification and in your in-app alerts. <!-- spec row 44; B74 -->

## 22. Reviews and watching items
After the handover, the buyer and seller can review each other with stars, a few quick tags and a
comment. Reviews are hidden until both of you have reviewed, or 14 days pass. Declutter reviews count
toward the same public star rating used for jobs.
You can tap the heart on any item to watch it and get an alert when its price drops.
<!-- spec rows 45, 46; B58 (14 days); 20261021023530_declutter_review_tags.sql (up to 4 tags); 20261015051301_declutter_shared_star_rating.sql -->
