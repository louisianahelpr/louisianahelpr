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
| DB | `declutter_items.move_out_on date` (NULL = an ordinary listing). No new table: account deletion (seller_id cascade) and Download My Data (to_jsonb of each row) already cover it. |
| RPC | `declutter_create_move_drafts(date, area, address, lat, lng, items jsonb)`: 1-15 drafts in one all-or-nothing call, each made by CALLING `declutter_create_item` (switch, ban, 3 strikes, under 18, $1,000 cap, lowest price, area-not-an-address, contact-leak trigger), then stamped with the date. Caps unfinished moving-sale drafts at 60. |
| RPC | `declutter_set_move_out_date(date or NULL)`: moves the date on the seller's own moving-sale items still in play, or (NULL) ends the moving sale; sold/ended items keep theirs. |
| RPC | `declutter_assert_can_scan_room()`: the selling gates, called by the edge function with the caller's own token before any AI spend. |
| Edge | `declutter-ai-draft` mode `room`: 1-4 room photos in the request body (never stored), the model lists up to 15 items, each through `sanitizeDraft` (fails closed on the banned check). Per-member 20 scans an hour on top of the function's 6 a minute. |
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
| M6 | Who sees the move-out date | Any member Declutter is on for, on the seller's profile and banner (area only, never the address) | The owner asked for the date on the banner. RISK: it tells people when a home may be empty; the owner may prefer "Moving soon" with no date | 2026-10-16 — default chosen by lane, owner to confirm |
| M7 | Draft limits | 15 items per save, 60 unfinished moving-sale drafts per seller | A full house; stops runaway rows | 2026-10-16 — default chosen by lane, owner to confirm |
| M8 | AI scan limit | 20 room scans an hour per member, plus the existing 6 AI calls a minute | The model costs money per call | 2026-10-16 — default chosen by lane, owner to confirm |
| M9 | Ending the sale | "End the moving sale" clears the date; items stay up as ordinary listings | Never takes anything down without the seller asking | 2026-10-16 — default chosen by lane, owner to confirm |
| M10 | After the move-out date | Nothing automatic: the banner says "Moved out" and the items stay for sale until the seller ends it; a "Haul away what's left" link goes to posting a Helpr job until haul-away (Q?declutter-haul-away) lands | Automatic take-downs or bookings are money/time decisions for the owner | 2026-10-16 — default chosen by lane, owner to confirm |
| M11 | Fees | None new: each item sells under the Declutter rules (seller keeps 100%, buyer fee F1) | Nothing about moving changes the money | 2026-10-16 — default chosen by lane, owner to confirm |
| M12 | Four tax confirmations | Asked once for the batch, recorded per item on the server (declutter_attest_item for each) | The same statements, said once for everything listed now | 2026-10-16 — default chosen by lane, owner to confirm |

## Proofs

- `node src/test/pglite/declutterMovingOut.pglite.mjs`: 55 PASS with the
  migration applied 3x on slices 1-4 + cap + F1; `NEW_MIGRATION=skip` 52 FAIL;
  7 planted defects each caught (gates removed, cap removed, 180-day limit
  removed, date RPC unscoped to the seller, anon not revoked, scan gate without
  the member check, batch limit raised).
- `src/test/declutterMovingOut.test.ts` pins the newest definitions (switches
  first, ban check, create through declutter_create_item, no bulk publish).
- `src/lib/declutter/moves.test.ts`, `src/test/declutterAiDraftSanitize.test.ts`
  (room answer and room photos).
