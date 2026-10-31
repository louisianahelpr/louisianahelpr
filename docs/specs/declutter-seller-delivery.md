# Declutter: the seller delivers, the buyer picks a date and time

Owner request, 2026-10-21 night: "Let a seller in declutter say if they would deliver and if so what's their rate
and let the buyer choose a time and date for delivery. So when they check out they can choose delivery by poster,
helpr, porch pick up, safe place etc. ... let the buyer choose a date and time from their schedule."

The owner answered every open choice on 2026-10-22 (relayed by the lead, binding); they are written in below. Every
number is ONE value in `declutter_seller_delivery_rules()` (migration 20261027153244); the app reads it from the
server, and `src/lib/declutter/sellerDelivery.ts` mirrors it (pinned by `src/test/declutterSellerDelivery.test.ts`).

Switch: `declutter_seller_delivery`, created OFF. It opens WITH the Declutter launch (owner 2026-10-22), flipped with
it in Admin -> Settings.

## Seller side
- "I can deliver" (off by default), with:
  - one flat rate per order, whole dollars, $5 to $150 (one rate per order even with several items);
  - a distance limit of 5, 10, 25 or 50 miles from the item's pickup address, 10 by default;
  - weekly delivery windows (several a day) and days off.
- Slots are 1 hour, bookable from 24 hours ahead to 14 days out, one delivery per slot.
- Per item, delivery can be switched off (on by default).

## Buyer side (checkout)
Choices, in order, each only when available: "Porch pickup" (porch or another safe place; BUY-14), pickup at the seller's home, the seller delivers,
Helpr delivery.
- The seller delivers: shows the rate; the buyer enters the delivery address (geocoded on the server), picks a day
  and time from the seller's open slots, and chooses "Leave it at my door" (the seller leaves it with a photo; it
  confirms like porch) or "Hand it to me" (meet at the door). Hidden when the seller doesn't deliver, an item is
  switched off, or a stored address is out of range; "No delivery times open" when no slot is open in the 14 days.
- The slot is held while the payment page is open (35 minutes; the page lives 31) and becomes the booking when the
  payment lands. A slot taken meanwhile: "That delivery time was just taken. Pick another time."
- Pickup at the seller's home keeps no time picker at checkout (it books its pickup time after payment, as today).

## Money
- The rate is part of the one order payment. The buyer's fee is 5% of (items + rate) + 70c, once, the same rule
  shipped orders use, so the card fee on the rate is covered. The seller keeps the whole rate; Louisiana Helpr takes
  no cut of it.
- The seller is paid items + rate together: when the buyer taps "I got it", or 24 hours after the seller's mark
  ("Delivered" with a photo when left at the door; "Handed over" when handed to the buyer) unless a problem is
  reported. Exact cents (the whole-dollar rule covers Helpr payouts only).
- Refunds:
  - the seller cancels, or the delivery doesn't happen ("It wasn't delivered", from 15 minutes after the hour ends):
    everything back, delivery included; the seller gets a strike and pays the card fee;
  - the buyer cancels for their own reason until 24 hours before the slot: everything back (items + rate) except
    the card fee; no strike; the slot frees and the items go back on sale. After that, Report a problem only;
  - "Hand it to me" and nobody answers: Report a problem; Louisiana Helpr decides;
  - the rate is never refunded on its own.
- A payment that lands after its held time went to someone else (rare: the hold had run out) keeps the sale; the
  buyer picks a new time. No money moves on its own. While the buyer re-picks, a seller cancel is Report a problem.

## After payment
- The buyer's address reaches the seller only after payment. The seller's home address is not given to a buyer the
  seller delivers to.
- Both sides see the booked time and the buyer's door choice (the buyer can change it until the seller marks it, and
  the seller can message the buyer about it); reminders 24 h and 1 h before.
- Either side asks for a new time from the seller's open times, the other accepts; up to 3 asks per side.
- Messages stay in the app.
