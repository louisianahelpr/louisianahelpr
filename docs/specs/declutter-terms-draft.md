# Declutter terms of use: DRAFT for the owner to read and approve

Status: DRAFT, not legal advice, not published anywhere. Written 2026-10-14 from the decision record
`docs/specs/declutter-auctions.md` on `origin/ready/declutter-3` @ 9d90c9977 (owner rows 1-62 and build
decisions B1-B38). Every rule below comes from that record. Where the record leaves something to a
lawyer, a CPA, the owner, or a slice that is not built yet, the text says so in a
**[OWNER/LAWYER TO CONFIRM]** note instead of inventing a rule. Each section ends with a small
*Source:* line so you can check it against the record; delete those lines before this goes live.

## For the owner: summary in 5 lines
1. Declutter lets adults in Louisiana sell their own used household items to each other at a set price, with private offers and an automatic 5% price drop each evening. There is no bidding and no auction.
2. Buyers pay the item price plus a 15% buyer's fee (at least $1, card costs included). Sellers pay nothing and keep 100% of the price. Nobody is ever charged automatically: the buyer pays at checkout within 48 hours.
3. Handover is in person only at launch (pickup at the seller's home, or porch pickup) within 7 days. The seller is paid when the buyer's QR code or 4-digit code is used, when the buyer taps "I got it", or 24 hours after the booked time if nobody reports a problem.
4. The buyer can refuse an item at handover if it is not as described (full refund, seller strike). Once the buyer confirms, the sale is final and the item is sold as is.
5. Breaking the rules earns Declutter strikes (one count for buying and selling, each lasting 1 year). 3 active strikes lock you out of all of Declutter until one expires. Jobs are never affected.

## Every [OWNER/LAWYER TO CONFIRM] item in this draft
1. **Auction law (lawyer + board).** That fixed price + private offers + slow daily price drops is outside Louisiana's auction law (La. R.S. 37:3103). The record lists this as an owner to-do: call the Louisiana Auctioneers Licensing Board. The terms say "this is not an auction"; a lawyer should approve that sentence. (Sections 1, 5)
2. ~~**Who counts as "in Louisiana"**~~ DECIDED (owner row 69, 2026-10-14): anyone may buy; the item and pickup stay in Louisiana. The record says Declutter covers "all of Louisiana" but does not say whether the BUYER must live in Louisiana, or only that the item and the handover are in Louisiana. (Section 2)
3. ~~**Per-item price limit**~~ DECIDED (owner row 70): $1,000 per item. $1 to $10,000 per item is a sanity cap the build agent chose (B3), not an owner number. (Section 3)
4. **Where price drops stop (owner, build mismatch).** Row 61 says drops stop at a random point slightly ABOVE the seller's lowest price, but the built price-drop job (B35) stops AT the lowest price. The draft follows row 61; the build must match before launch. (Section 5)
5. **Taking a listing down while offers are open (owner).** Row 19 says cancelling after bids is a strike (0 bids = free). In offers mode the build only gives a strike once the seller has ACCEPTED an offer; withdrawing with open, unanswered offers is free. The draft follows the build. (Sections 3, 11)
6. **Refund when the seller cancels while the buyer is paying, and when a payment lands late (owner).** Both are open in the record ("NOT fixed, for slice 3b"). (Section 10)
7. **Card fee on our-mistake refunds vs other refunds in Declutter (owner).** The record's general rule is: our mistake = full refund; every other refund keeps the card fee. Rows 18 and 60 cover two Declutter cases; the record says slice 3b still needs a reason code for each refund kind. (Section 10)
8. ~~**Disputes after handover**~~ DECIDED (owner row 67): "Report a problem" holds the money; Louisiana Helpr decides from both sides' photos and messages. The record says Declutter needs its own version of disputes (job disputes are job-only today), and it does not say who decides when the buyer and seller disagree (for example, each says the other missed the pickup, or a porch-pickup "problem" report). (Sections 7, 9, 10)
9. **Strike appeals are not built yet (owner).** Row 49 decides the rule; the record says appeals and the admin strike queue are still not built. (Section 11)
10. ~~**Off-app payments inside Declutter**~~ DECIDED (owner row 68): same rule as jobs. The main Terms already ban off-platform payments and the Community Rules make them an immediate-ban offense for jobs. The record does not say whether a Declutter off-app payment also earns a Declutter strike or follows the job rule as is. (Section 12)
11. **Storm pause is not built yet (owner).** Row 39 decides the rule; the record says the pause switch "doesn't exist yet". (Section 15)
12. **Switch turned off mid-sale (owner, build mismatch).** Row 62 says agreed sales may still finish with no strike, but the record notes a buyer whose access is switched off after an accept currently cannot check out and would be struck. (Section 16)
13. **"Not an escrow" wording (lawyer).** The record's Stripe note says not to call Declutter payments "escrow"; the main Terms use "escrow" for jobs. The draft avoids the word for Declutter. (Sections 8, 17)
14. **Sales tax (CPA / Louisiana Department of Revenue).** (a) whether the 15% buyer's fee is taxable on its own even when the item sale is exempt; (b) whether the existing jobs business already counts toward the $100,000 marketplace threshold; (c) whether Stripe Tax can file the marketplace return with every parish rate; (d) who decides a seller is "business-like" (not built yet). The record lists these as CPA/LDR questions "before statewide launch". (Section 18)
15. **Form 1099-K and Louisiana secondhand-dealer law (CPA/lawyer).** The main Terms promise a 1099-K when federal thresholds are met; the record does not say whether Declutter payouts count toward it. The record also flags that Louisiana's secondhand-dealer law (R.S. 37:1861) "may reach very frequent sellers". (Section 18)
16. **What happens to strikes and listings when an account is deleted (owner).** The record notes deleting an account removes the member's Declutter rows, strikes included. The draft does not promise anything either way. (Section 19)
17. **Privacy policy changes (owner).** The Privacy tab's "Google Gemini" line covers only the AI job builder; it needs to also cover Declutter listing photos and text. (Section 19)
18. **Recalled items and other banned-item duties (lawyer).** The record says reselling recalled products and pre-2011 cribs is illegal (CPSC). The banned list follows row 34; a lawyer should confirm the list is complete. (Section 4)
19. **Handover by QR / 4-digit code and porch photos are not built yet (owner).** Rows 25, 26 and 28 decide the rules; the record says the QR / handover code does not exist in the app yet (slice 4). Publish these terms only when that part ships. (Sections 7, 8)

## Where this would sit in the app (suggestion, not a decision)
A new "Declutter" section in the **Terms** tab (`/legal`, anchor `declutter`), in the same card style as
"Payment, escrow & fees", with the strike rules also listed as one row in **Community Rules → When trust
breaks**. It points to the existing sections instead of repeating them: Eligibility & accounts, Payouts &
Stripe Connect, Disclaimers & limitation of liability, Tax responsibilities, Community Rules (The basics;
strikes & bans), and Privacy (Your rights). The existing Terms call the company "Helpr"; this draft says
"Louisiana Helpr" or "we" so it never gets confused with a Helpr (a worker).

---

# Declutter

*These Declutter terms are part of the Louisiana Helpr Terms of Service. Everything in the main Terms,
the Community Rules and the Privacy policy still applies to you in Declutter. Where this section says
something more specific about Declutter, this section wins for Declutter.*

### The short version
- Declutter is where Louisiana neighbors sell their own used household items to each other.
- Sellers set a price. Buyers can buy at that price or make a private offer. Prices drop 5% each evening until the item sells or reaches the seller's lowest price.
- Sellers pay no fee. Buyers pay a 15% buyer's fee (at least $1) that already includes card costs.
- You are never charged automatically. If your offer is accepted, you have 48 hours to check out and pay.
- Handover is in person within 7 days. Check the item before you confirm: once you confirm, the sale is final.
- Breaking the rules earns a Declutter strike. 3 active strikes and you can't use Declutter until one expires (each lasts 1 year). Your jobs are not affected.
- Louisiana Helpr is the place where the sale happens. We are not the seller.

---

## 1. What Declutter is
Declutter is a section inside Louisiana Helpr where members sell their own used household items to
other members. Each item has a price set by the seller. A buyer can buy it at that price or send the
seller a private offer, and the seller decides whether to accept.

Declutter is **not an auction.** There is no bidding, no countdown, and no "highest bid wins". An item
sells to the first buyer whose purchase or offer the seller accepts and who then pays.
**[OWNER/LAWYER TO CONFIRM #1: a lawyer and the Louisiana Auctioneers Licensing Board should confirm this
format is outside La. R.S. 37:3103 before launch.]**

Handover is in person only. At launch you can choose **pickup at the seller's home** or **porch pickup**.
Delivery by a Helpr and shipping are not available yet.

*Source: rows 1, 2, 5, 24, 55, 56, 57; B2, B30; Legal findings.*

## 2. Who can buy and sell
To buy, make offers, or sell in Declutter you must:
- **Be 18 or older.** Members under 18 can't buy, make offers or sell; the buttons are greyed out and our server refuses the request too. This is the same rule as jobs.
- **Have a Louisiana Helpr account in good standing**, signed in, not banned, with fewer than 3 active Declutter strikes (see section 11).
- **Be dealing in items located in Louisiana.** Declutter covers all of Louisiana, nearest items first. Items and pickups must be in Louisiana; buyers may live anywhere.

Sellers must also **set up payouts with Stripe before their first listing**, the same step Helprs take before
getting paid (see Terms → Payouts & Stripe Connect).

Buyers must have **a saved card** before making an offer or buying (see section 6).

*Source: rows 5, 16, 23, 36, 53; B10, B32, B36.*

## 3. Listing an item
**Only your own personal things.** You may list only household items you own and bought for your own
personal use. When you list, you confirm four things, and we keep your answers:
1. you bought the item for personal use,
2. you are not in the business of selling items like it,
3. you don't sell often, and
4. you will keep the item yourself until handover.

If you change the title, description or category later, you confirm these again before the listing goes up.

**Photos.** Each listing needs at least 3 and at most 12 photos that you took of the actual item. The app
checks that they are real photos, not pictures from the internet. The app removes location data from your
photos before they are posted.

**Be honest.** Your title, description, category, size and condition (1 to 5 stars) must describe the item
accurately, including any damage or missing parts. Items are sold **as is** (see section 9), so the
description is what the buyer relies on.

**AI help.** The app can draft your title, description, category, size and condition from your photos. It is a
suggestion only: **you must read and correct it before you post, and you are responsible for every word of
your listing**, whoever drafted it. Before a listing goes up, the app also checks the photos and text for
banned items.

**Review by our team.** Your first 3 listings, and any listing the automatic check flags, wait for a Louisiana
Helpr admin to approve them. If an admin rejects a listing, you see the reason. We may also remove any
listing that breaks these terms.

**Price.** You set a price and a lowest price you'll accept (kept private). Prices are from $1 to $1,000 per
item. If you
don't want your price to drop, set your lowest price equal to your price.

**Location.** You give your pickup address (kept private) and a public area name like "River Road area" or
"Metairie 70005". The area name can't contain your house number or street address.

**Pickup times.** You set your usual weekly pickup times when you list.

**Taking a listing down.** You can take your own listing down at any time before you've accepted an offer
or someone has bought it. Once you've accepted, backing out is a strike (section 11).
**[OWNER/LAWYER TO CONFIRM #5: taking a listing down while offers are open but none accepted is free in the
build; confirm that is the rule.]**

*Source: rows 15, 23, 31, 32, 33, 37, 52, 54(1), 56; B3, B6, B7, B8, B18, B19, B20, "Area label" note, "Photos" note.*

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
**[OWNER/LAWYER TO CONFIRM #18: a lawyer should confirm this list is complete; the record notes reselling
recalled products and pre-2011 cribs is illegal under federal product-safety rules.]**

*Source: row 34; Legal findings (CPSC note).*

## 5. Prices, offers and price drops
**Buy at the listed price.** You can buy an item at today's price. If the price has gone UP since you looked
(it shouldn't, prices only drop), we stop and show you the new price first.

**Make an offer.** You can send the seller a private offer instead.
- Your offer must be **at least 50% of today's price.**
- The seller has **48 hours** to accept, say no, or answer with a different price. If they answer with a price, you have 48 hours to respond. Each new answer restarts the 48 hours, and either side can keep going back and forth.
- If the person whose turn it is doesn't answer in 48 hours, the offer simply expires. No strike.
- You can take your offer back at any time before it is accepted.
- You can have one open offer per item, and start at most 3 offers on the same item in 24 hours.
- Several buyers can make offers on the same item. **The first one the seller accepts gets it**, and every other open offer on that item closes (those buyers are told; nobody is charged).
- An offer below the seller's private lowest price still reaches the seller, and the seller decides. Every "no" looks the same to a buyer.
- If an offer is accepted, you pay the accepted amount or today's price, whichever is lower.

**Accepting is a promise.** When you buy, or when an offer is accepted, the item is reserved for you and goes
in your cart. You then have 48 hours to check out and pay (section 6).

**Automatic price drops.** Every evening (around 6 PM Louisiana time), the price of each unsold item drops
5%, at most once a day. Items listed less than 12 hours earlier skip that evening. Drops stop before the
seller's private lowest price, at a point slightly above it chosen at random, so nobody can work out the
seller's lowest price. People watching the item get a "price dropped" alert. Open offers keep their amounts
when the price drops.
**[OWNER/LAWYER TO CONFIRM #4: the built price-drop job currently stops AT the lowest price, not at a random
point above it (row 61). Fix the build or change this sentence.]**

This is not bidding. Buyers never compete in a timed bidding round.
**[OWNER/LAWYER TO CONFIRM #1 applies here too.]**

*Source: rows 36, 55-59, 61; B25-B29, B35.*

## 6. Checkout and what buyers pay
**You are never charged automatically.** We need a saved card before you make an offer or buy, but we never
charge it on our own. You pay only when you check out.

**48 hours to check out.** After you buy or your offer is accepted, you have 48 hours to check out: choose
pickup at the seller's home or porch pickup, book a pickup time, and pay. We remind you 24 hours and
2 hours before the deadline. If you miss it, you get **1 Declutter strike** and the item goes back on sale.

**One checkout per seller.** Items you're buying from the same seller go into one checkout: one payment, one
pickup time.

**What you pay.**
- The item price, plus
- a **15% buyer's fee** on the item total, or **$1, whichever is more** (the $1 minimum applies once per checkout, not per item).
- The buyer's fee already includes the card-processing cost. You see one total before you pay.
- Sales tax: none on sales by casual sellers (section 18).

**What sellers pay: nothing.** There is no seller fee. The seller receives 100% of the item price.

Payment is processed by Stripe. We hold the money until the handover (section 8).

*Source: rows 6, 7, 20, 21, 22, 36, 38, 44, 59; B30, B31, B33, B34.*

## 7. Pickup and handover
**Pickup within 7 days of payment.** When you check out, you pick a slot from the seller's usual pickup
times within the next 7 days. Either side may reschedule once.

**Exact address only after payment.** Before you pay, you see only the seller's area and the distance in
miles. After you pay, you get the exact pickup address.

**Pickup at the seller's home.** When you meet, the seller scans the QR code in your app (or types your
4-digit code). Or you can tap "I got it". Either one confirms the handover.

**Porch pickup.** The seller sets the item out and posts a photo of it on the porch. When you collect it, you
take a photo while you're at the address and tap "Picked up".

**If nobody confirms.** If neither confirmation happens, the handover counts as done 24 hours after the
booked pickup time, unless the buyer has reported a problem in the app before then.

**[OWNER/LAWYER TO CONFIRM #19: the QR / 4-digit code and porch-photo steps are not built yet; publish this
section when they ship.]** **[OWNER/LAWYER TO CONFIRM #8: who decides, and how, when buyer and seller
disagree about a pickup or a porch "problem" report.]**

*Source: rows 14, 24-28, 52; B30.*

## 8. When the seller gets paid
The seller is paid the full item price when the handover is confirmed: the buyer's QR code is scanned or
their 4-digit code is entered, the buyer taps "I got it" (or "Picked up" for porch pickup), or 24 hours pass
after the booked time with no problem reported. Payouts then follow the normal schedule in Terms →
Payouts & Stripe Connect.

Until then, Louisiana Helpr holds the buyer's payment through Stripe.
**[OWNER/LAWYER TO CONFIRM #13: the record advises not to call this "escrow" for Declutter.]**

*Source: rows 22, 25, 26, 28; B30, B38.*

## 9. Check the item before you confirm. After that, the sale is final.
**Check at handover.** Look the item over when you collect it.

**Not as described? Refuse it in the app.** If the item is not what the listing described, refuse it in the app
at handover. You get a **full refund** (item price and buyer's fee) and the seller gets a strike.

**Once you confirm, the sale is final.** When you confirm the handover, the seller is paid and the item is
yours **as is**. There are no returns after that.

**Problems after a sale.** If something goes wrong (a missed pickup, an item that wasn't on the porch, an item not as described), either of you can tap "Report a problem" on the sale. The money stays held while Louisiana Helpr looks at both sides' photos and messages and decides: a refund, payment to the seller, or a split, and whether anyone gets a strike.

*Source: rows 15, 19, 28.*

## 10. Refunds and fees
| What happened | What the buyer gets back | Strike |
|---|---|---|
| **Our mistake** (for example a duplicate charge, or a payment that reached an order that had already closed) | Everything | None |
| **Buyer refuses the item at handover** because it's not as described | Everything (item price + buyer's fee) | Seller |
| **Seller doesn't show up** at a booked pickup | Everything | Seller |
| **The item is gone** after it sold | Everything | Seller |
| **Seller backs out after the buyer paid** | Everything, including the card fee. The card fee Stripe kept is charged to the seller and taken from their future Declutter payouts. | Seller |
| **Buyer paid but never picked up** within 7 days | The item price. The 15% buyer's fee is kept. The seller can relist for free. | Buyer |
| **Buyer misses the 48-hour checkout** | Nothing was charged | Buyer |

**[OWNER/LAWYER TO CONFIRM #6: the refund when a seller cancels while the buyer is on the payment page, and when a
payment made before the deadline only reaches us after it (the record says the buyer is currently refunded AND
struck).]** **[OWNER/LAWYER TO CONFIRM #7: confirm that every Declutter refund not in this table keeps the card fee,
matching the platform-wide "never absorb a fee, except our mistakes" rule.]**

*Source: rows 15, 18, 19, 60; B30; owner decisions 2026-10-14 (refunds).*

## 11. Declutter strikes
Declutter keeps **one strike count** for each member, covering buying and selling together. It is separate
from job strikes: Declutter strikes never affect your jobs, and job strikes are handled under Community
Rules → When trust breaks.

**Each strike lasts 1 year** from the day it is given. **3 active strikes lock you out of all of Declutter**
(buying, offers, selling, watching items and asking questions) until one of them expires. While you're
locked out, your listings are hidden from others.

**Buyers get a strike for:**
- missing the 48-hour checkout;
- paying but not picking up within 7 days.

**Sellers get a strike for:**
- not showing up at a booked pickup;
- the item being gone after it sold;
- backing out after accepting an offer or a purchase (before or after the buyer paid);
- an item refused at handover as not as described;
- blocking the buyer after the sale.

**Fake offers** (section 12) can get you removed from Declutter altogether.

You can see your count on the Declutter screen ("You have N of 3 strikes").

**Appeals.** You can appeal each strike once: write a note and, if you like, add a photo. An admin reviews it
and either removes the strike or keeps it. **[OWNER/LAWYER TO CONFIRM #9: appeals are not built yet.]**

*Source: rows 7, 16, 17, 18, 19, 48, 49, 60; B14, B34, B36, slice 3 review fixes.*

## 12. Fair play
- **No offers on your own items.** Offers from someone who shares the seller's household, phone or card are flagged to an admin. **A member proven to have made fake offers is removed from Declutter.**
- **No self-dealing or fake activity** of any kind to push a price or test a seller's lowest price.
- **No off-app payments.** Pay only through checkout. Asking for or arranging payment outside Louisiana Helpr is already banned by the Terms (Prohibited conduct) and the Community Rules. On Declutter it is handled exactly as it is for jobs.
- Everything in Community Rules → The basics (respect, honesty, safety, reporting) applies here too.

*Source: rows 35, 48; B27; main Terms "Prohibited conduct"; Community Rules.*

## 13. Questions and messages
**Before you buy, ask in public.** Questions go on the item page, where everyone can see them along with your
name, and the seller answers there. Questions, answers, titles and descriptions can't contain phone numbers,
emails, payment handles or other contact details; the app refuses them. You can ask up to 20 questions a day.

**Private messages open only after checkout**, between the buyer and seller of that sale.

If you and the seller have blocked each other (either way), you can't watch or ask about each other's items.

*Source: row 35; B12, B17.*

## 14. Safety at pickup
You meet other members at your own risk (Terms → Disclaimers & limitation of liability). Some common-sense
steps:
- Use the booked time and the in-app confirmation (QR code, 4-digit code, "I got it" or "Picked up").
- Check the item before you confirm. Once you confirm, the sale is final.
- Never pay or take payment outside the app.
- Use the report button for anything suspicious.

*Source: rows 15, 25, 26, 28; main Terms; Community Rules → The basics.*

## 15. Storms and other pauses
When severe weather or another emergency hits, we may pause Declutter for all of Louisiana or for chosen
parishes. During a pause the checkout and pickup clocks stop and no new strikes are given. When the pause
ends, the clocks pick up where they stopped.
**[OWNER/LAWYER TO CONFIRM #11: the pause switch is not built yet.]**

*Source: row 39.*

## 16. If Declutter is paused or turned off
We may turn Declutter off for everyone or some members. If that happens, sales already agreed (an accepted
offer or a paid order) can still be paid for and handed over, nobody gets a strike for a sale the shutdown
interrupted, and nothing new can start.
**[OWNER/LAWYER TO CONFIRM #12: the build does not yet let a member whose access was turned off finish an accepted
sale; fix before rollout or change this sentence.]**

*Source: rows 50, 62; "Open after slice 3" note.*

## 17. Our role: we are the venue, not the seller
Louisiana Helpr provides the place where members buy and sell. **Each sale is between the buyer and the
seller.** We do not own, inspect, store, test or guarantee any item, and we are not the seller. We hold the
payment through Stripe until handover and pay the seller out. Our listing checks and admin reviews look for
banned items and rule-breaking; they are not a promise that an item is safe, genuine, legal, working or as
described.

Terms → Disclaimers & limitation of liability (including the limit on our liability and your promise to
indemnify us) applies to Declutter sales exactly as it does to jobs: read "job" there as including a
Declutter sale.

*Source: rows 1, 15, 33; B30, B38; main Terms "Disclaimers & limitation of liability".*

## 18. Taxes
**Casual sellers: generally no sales tax.** Louisiana exempts "isolated or occasional sales" by someone who
is not in that business (La. R.S. 47:305(A)). That is why every seller confirms the four statements in
section 3 when they list. Sales by casual sellers carry no sales tax.

**Sellers who look like a business.** If a seller lists like a business (many or repeat listings, resale stock),
we may flag the account. Flagged sellers' sales are taxed (state and parish) on the item and the buyer's
fee. Until that tax step is built, a flagged seller can't complete a Declutter sale.

**Our own obligations.** We track Louisiana Declutter sales each calendar year. If they pass $100,000, Louisiana
Helpr becomes responsible for collecting and filing the tax as a marketplace (La. R.S. 47:340.1).

Taxes on your own income from selling are your responsibility; see Terms → Tax responsibilities, and ask a
CPA about your situation.

**[OWNER/LAWYER TO CONFIRM #14: whether the buyer's fee is taxable on an exempt sale; whether the jobs business
already counts toward the $100,000 threshold; Stripe Tax parish filing; who decides "business-like".]**
**[OWNER/LAWYER TO CONFIRM #15: whether Declutter payouts count toward the Form 1099-K promised in Terms → Tax
responsibilities, and whether Louisiana's secondhand-dealer law reaches very frequent sellers.]**

*Source: row 54; B15, B33; Sales tax research; Legal findings ("Other checks").*

## 19. Privacy
- **Your location:** before a buyer pays, they see only your public area name and roughly how many miles away the item is (our map point is rounded to about 1 km). The exact address goes only to the buyer who paid.
- **Your photos:** the app removes location data from every photo. Listing photos are shown to other members, and anyone who has a photo's web link can open it.
- **Your questions:** public questions show your name.
- **AI help:** the photos and text you give the listing helper are sent to our AI provider to draft and check the listing. **[OWNER/LAWYER TO CONFIRM #17: update the Privacy tab's "Google Gemini" line to cover Declutter.]**
- **Your data:** "Download your data" includes your Declutter activity. See Privacy → Your rights.
- **Deleting your account:** you can't delete your account while a Declutter sale is in progress. Once you delete it, your Declutter photos are removed. **[OWNER/LAWYER TO CONFIRM #16: what happens to strikes and finished sales on deletion.]**
- **Emails:** Declutter sends you email only about money (sold, receipts, refunds). Everything else comes as a push notification and in your in-app alerts.

*Source: rows 27, 44; B4, B7, B9, B12, B19, "Area label" and "Photos" notes, slice 3 review fixes.*

## 20. Reviews and watching items
After a handover, the buyer and seller can review each other with the same star ratings used for jobs
(hidden until both have reviewed, or 14 days pass). You can tap the heart on any item to watch it and get an
alert when its price drops.

*Source: rows 45, 46.*
