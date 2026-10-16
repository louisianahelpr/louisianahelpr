# Declutter moving-out mode — decision record

Owner ask (2026-10-16): a seller who is moving photographs each room; the
existing AI photo fill turns the photos into several draft listings at once
that the seller reviews and lists together; a "moving-out" banner groups them on
the seller's profile with a move-out date; unsold items can then go to
haul-away. OPEN.md item: `Q?declutter-moving-out` (filed on ready/outreach-spec).

Builds on docs/specs/declutter-auctions.md (every row there still applies to
each item). Haul-away (`Q?declutter-haul-away`, branch wip/declutter-haul-away)
and Helpr delivery (`Q?declutter-delivery-first`, wip/declutter-delivery) are
separate builds; this one only links to them. Neither branch existed on origin
when this was built (2026-10-16, `git ls-remote`), so the links go to posting an
ordinary Helpr job until they land.

## Built (lane declutter-moving-out, 2026-10-16)

| Layer | What |
|---|---|
| Switch | `declutter_moving_out`, created at `testers` by migration 20261016053625. Every new RPC requires it AND `declutter`; so does the room scan. |
| DB | `declutter_items.in_moving_sale boolean` groups the listings; the DATE is `declutter_item_private.move_out_on` (no client role can read that table; it already holds the pickup address). No new table: account deletion (cascade) and Download My Data (to_jsonb of both rows) already cover both. |
| RPC | `declutter_create_move_drafts(date, area, address, lat, lng, items jsonb)`: 1-15 drafts in one all-or-nothing call, each made by CALLING `declutter_create_item` (switch, ban, 3 strikes, under 18, $1,000 cap, lowest price, area-not-an-address, contact-leak trigger), then stamped with the date. Caps unfinished moving-sale drafts at 60. |
| RPC | `declutter_set_move_out_date(date or NULL)`: moves the date on the seller's own moving-sale items still in play (selling gates apply), or (NULL) ends the moving sale; sold/ended items keep theirs. |
| RPC | `declutter_my_move_out_date()`: the seller's own date. `declutter_seller_moving_sale(seller)`: what OTHER members get: the month only, kept until that month ends (nothing visible changes on the day itself), nothing for a hidden seller or a blocked pair. |
| RPC | `declutter_assert_can_scan_room()`: the selling gates, called by the edge function with the caller's own token before any AI spend. |
| Edge | `declutter-ai-draft` mode `room`: 1-4 room photos in the request body (never stored), the model lists at most 15 items (limit as built 2026-10-16), each through `sanitizeDraft` (fails closed on the banned check). Per-member 20 scans an hour on top of the function's 6 a minute. |
| Publish | No bulk publish on the server. The app lists the chosen drafts one at a time through the same three calls as one item (four confirmations, photo check, `declutter_publish_item`), so photos 3-12, payouts, pickup times and the admin review queue all apply per item. The photo checks are spaced 10.5 s apart to stay under the per-minute AI limit (an unchecked item would only wait for review). |
| Screens | `/declutter/move` (the flow), "Moving out?" entry on Declutter > My listings, moving-sale banner on `/user/:id` with the date and the items for sale now. |

## Defaults chosen by the lane (owner to confirm)

| # | Question | Default chosen | Why | Date |
|---|---|---|---|---|
| M1 | Price for room-scanned items | No price is guessed: the seller types one per item before saving ("What's it worth?", auctions row 80, is a later feature) | A made-up price is a claim we can't stand behind | 2026-10-16 — default chosen by lane, owner to confirm |
| M2 | Lowest price | Blank = the same as the price (no evening drops); the seller may fill it in | Safest: nothing drops unless the seller asks | 2026-10-16 — default chosen by lane, owner to confirm |
| M3 | Photos per item | Each item still needs 3-12 photos of its own (auctions row 31); room photos never count as item photos | A room shot doesn't show a buyer the item | 2026-10-16 — default chosen by lane, owner to confirm |
| M4 | Room photos | Sent once to the photo tool, never stored or shown; 1-4 per scan, cleaned of location data first | A home's interior is private; storing it adds nothing | 2026-10-16 — default chosen by lane, owner to confirm |
| M5 | Move-out date range | Today to 180 days out | Covers a lease's notice period; stops stale "moving sales" | 2026-10-16 — default chosen by lane, owner to confirm |
| M6 | Who sees the move-out date | Only the seller. Other members (both switches on) see "Moving out in <month>", never the date; it stays until the month is over, so a daily check cannot pin the day (re-review 1) | The owner asked for a date on the banner, but the lh-authz-rls review showed a $1 purchase gives a buyer the exact address; the address plus the exact day says when the home is empty. If the owner wants the exact date shown, that is a one-line change in declutter_seller_moving_sale | 2026-10-16 — default chosen by lane, owner to confirm |
| M7 | Draft limits | 15 items per save, 60 unfinished moving-sale drafts per seller | A full house; stops runaway rows | 2026-10-16 — default chosen by lane, owner to confirm |
| M8 | AI scan limit | 20 room scans an hour per member, plus the existing 6 AI calls a minute | The model costs money per call | 2026-10-16 — default chosen by lane, owner to confirm |
| M9 | Ending the sale | "End the moving sale" clears the date; items stay up as ordinary listings | Never takes anything down without the seller asking | 2026-10-16 — default chosen by lane, owner to confirm |
| M10 | After the move-out date | The banner stays through the move-out month, then disappears (never "Moved out", which would advertise an empty home); the items stay for sale; a "Haul away what's left" link goes to posting a Helpr job until haul-away (Q?declutter-haul-away) lands | Automatic take-downs or bookings are money/time decisions for the owner | 2026-10-16 — default chosen by lane, owner to confirm |
| M11 | Fees | None new: each item sells under the Declutter rules (seller keeps 100%, buyer fee F1) | Nothing about moving changes the money | 2026-10-16 — default chosen by lane, owner to confirm |
| M12 | Four tax confirmations | Asked once for the batch, recorded per item on the server (declutter_attest_item for each) | The same statements, said once for everything listed now. Whether one statement for a batch is legally enough is the owner's call (flagged by the review) | 2026-10-16 — default chosen by lane, owner to confirm |

## Reviews (2026-10-16, on 831f71870)

- lh-authz-rls: approve-with-nits. Fixed in this branch: (1-2) the date moved off the
  public listing row to the private half, other members get only a coarse label behind
  both switches; (3) setting a date takes the selling gates; (4) the 60-draft cap is
  serialised per seller (advisory lock); (5) the hourly room-scan count runs after the gates.
- lh-silent-failure: approve-with-nits. Fixed: a room answer with no list is
  `ai_unavailable`, not "nothing found"; the flagged-item note no longer promises a human
  review; photo-count and pickup-times read failures show an error (List waits for the
  saved times, so a failed read can't overwrite them); a partial save says how many saved;
  "0 items changed" is said as such; the banner count says "100+" past its read limit.
- lh-authz-rls re-review (217bbe0ac): changes-requested on one point, fixed: the label is
  now the month only, unchanged until the month ends. Accepted, with reasons: a member the
  seller blocked can still read in_moving_sale on listings they can already see (the items
  read policy has never checked blocks; that is a wider question than this feature, see
  Q?declutter-items-blocks); ending the sale needs the switches (every RPC of a hidden
  feature starts with require_feature, AGENT-BRIEF; with the switch off nothing shows the
  date or month, only the yes/no flag).
  Left as is: a lost response after a committed save can make duplicates on retry (no
  idempotency key; the seller can delete them; the save is all-or-nothing per batch).

## Proofs

- `node src/test/pglite/declutterMovingOut.pglite.mjs`: see the numbers in its
  header (measured 2026-10-16), applied 3x on slices 1-4 + cap + F1, red with
  the migration absent and on each planted defect.
- `src/test/declutterMovingOut.test.ts` pins the newest definitions (switches
  first, ban check, create through declutter_create_item, no bulk publish).
- `src/lib/declutter/moves.test.ts`, `src/test/declutterAiDraftSanitize.test.ts`
  (room answer and room photos).
