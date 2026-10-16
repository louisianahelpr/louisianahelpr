# Declutter wanted posts + fair-price hint — decision record

Owner ask (2026-10-16): "Declutter wanted posts + a fair-price hint." Builds on Declutter slices 1-4
(docs/specs/declutter-auctions.md; this is that spec's approved-for-later row 76 "Wanted posts" and the
truthful half of row 87 "Good deal tags"). Migration `20261016053541_declutter_wanted_price_hint.sql`,
PGlite proof `src/test/pglite/declutterWantedPriceHint.pglite.mjs` (applied 3x).

The owner said not to ask permission: every open question below was answered with the safest sensible
default and is marked **default chosen by lane, owner to confirm**. The owner can overturn any row.

## What the owner asked for
- (a) A member posts what they are looking for (category, highest price, area/radius). Members with matching
  live listings nearby, and new listings that match later, get a notification ("Someone near you wants a crib
  under $80"). Respect notification preferences, rate limits, block lists, ban and under-18 gates; contact-leak
  filtering on the free text.
- (b) On a listing and in the sell flow: "Similar items sold for $X-$Y near you", computed server-side ONLY from
  our own completed Declutter sales (same category and condition, nearby), shown only when a minimum count of
  real sales exists, never invented, never seed rows, hidden otherwise (truthfulness rule, lh-marketing §3).

## Decisions (each: default chosen by lane, owner to confirm)
| # | Question | Default | When |
|---|----------|---------|------|
| W1 | Switches | Two hidden switches, created at **testers**: `declutter_wanted` and `declutter_price_hint`. Each also needs `declutter` (every RPC requires both; the alerts check both for the RECIPIENT, so a tester-only feature never reaches a non-tester). Going live is the owner's flip in Admin -> Settings. Default chosen by lane, owner to confirm. | 2026-10-16 |
| W2 | How long a wanted post lasts | 30 days, then it stops matching and reads "Expired"; the poster can close it any time. No renew button yet (post again). Default chosen by lane, owner to confirm. | 2026-10-16 |
| W3 | Who sees a wanted post | Only the poster. There is no public "wanted" board: other members only ever see the words inside an alert about their own listing (no name, no profile, no exact place). Fewer places for abuse; a board can be added later. Default chosen by lane, owner to confirm. | 2026-10-16 |
| W4 | Who may post / who gets alerts | Posting: both switches, signed in, not banned, fewer than 3 Declutter strikes, 18 or older (row 53: a wanted post is a buying intent). Alerts go only to members with both switches on, not banned or at 3 strikes, not under 18, with their "New offers" notification switch on (unset = on), and never across a block (either way). A post whose poster lost the switch, was banned, reached 3 strikes or is under 18 matches nothing. Test (seed) posts and listings only ever meet each other, so a test account never alerts, or uses up the alerts of, a real member. Default chosen by lane, owner to confirm. | 2026-10-16 |
| W5 | What counts as a match | Live listing, same category, every word of the post in the listing's title or description (English word endings: "cribs" finds "crib"), the listing's area point within the post's miles (5/10/25/50), not the poster's own listing, seller not hidden (banned, 3 strikes, under 18, flagged business-like). The SELLER is told when an offer at the buyer's highest price would clear their own hidden lowest price (only the seller ever learns that). The POSTER is told about a later listing only when its price today is at or under theirs. When posting, the poster sees current matches at or under their price on screen instead of an alert. Default chosen by lane, owner to confirm. | 2026-10-16 |
| W6 | Repeats | Each (post, listing) pair alerts each side at most once, ever: a listing that goes back on sale, or a matcher re-run, sends nothing new. A pair muted or over a cap is still recorded, so it never replays later (a missed alert is the cost; a flood is worse). A cap or ledger mark is spent only when a notification was really written. Default chosen by lane, owner to confirm. | 2026-10-16 |
| W7 | Rate limits | Highest price in whole dollars; 5 new posts per member per day; 10 open posts at most; a new post alerts at most 20 sellers (nearest first); a seller gets at most 5 wanted alerts a day and at most 1 a week from the same poster; a poster at most 10 match alerts a day. Default chosen by lane, owner to confirm. | 2026-10-16 |
| W8 | Free text | 3-60 characters of plain (ASCII) letters, digits, spaces and . , ' & ( ) / -; no web address; no phone number (7+ digits anywhere, or 4 number words in a row); at least one searchable word; then the same contact-leak filter as listings and questions (rejected, never hidden). Since W15 the words reach nobody but the poster. Default chosen by lane, owner to confirm. | 2026-10-16 |
| W9 | Which sales feed the hint | Only our own completed Declutter sales: line paid AND order handed over (sale final), handed over in the last 365 days, same category AND same condition stars, the sold listing's area point within 25 miles. Never a seed row (order, line, listing, or either person's profile), never a sale whose buyer or seller is now banned or at 3 strikes. The price is the item price agreed (not the buyer's fee). Default chosen by lane, owner to confirm. | 2026-10-16 |
| W10 | Minimum before showing | At least **11** such sales, counting **one sale per buyer-seller pair** (the latest), from at least **3 different sellers and 3 different buyers**; otherwise nothing is shown (no "not enough data" text either). 11 means neither end of the range can be one person's single sale (reviews 2026-10-16: at 5, both ends WERE single sales, so a private agreed price could be read off and one shill sale could set the top). The point is snapped to a ~7-mile grid so nobody can slide it to isolate one sale. Default chosen by lane, owner to confirm. | 2026-10-16 |
| W11 | The range shown | The 10th to 90th percentile sale price (nearest rank), rounded OUTWARD to $5, so at least 80% of the sales counted are inside it and "Most items like this sold for $X-$Y" is true. One price when both ends round the same. A line under it says what it is based on, with the count in tens only ("Based on 10+ Declutter sales of items in the same category and condition, within about 25 miles, in the last year."). Default chosen by lane, owner to confirm. | 2026-10-16 |
| W12 | Where the hint shows | On a listing (every viewer, from the listing's own category, condition and area point; it says "in this area") and in the sell flow (the pickup address once found, else the saved listing's area, else the member's known area; it says "near you"). Behind `declutter_price_hint`. Default chosen by lane, owner to confirm. | 2026-10-16 |
| W13 | Notification type | Wanted alerts are bell + push rows of type `new_offers` (the "New offers" switch Declutter offers already use). No email (spec row 44: email only for won/sold, receipts, refunds). Default chosen by lane, owner to confirm. | 2026-10-16 |
| W15 | What a seller's alert says | "Someone near you wants an item like your "<their own listing title>" for $<highest price> or less." The poster's own words are NEVER shown to anyone else (lh-trust-safety review 2026-10-16: echoing them let one account send an anonymous, targeted message to a chosen seller, who could neither block nor report it). The owner's sample wording ("Someone near you wants a crib under $80") is kept in spirit with the seller's own item named instead. Default chosen by lane, owner to confirm. | 2026-10-16 |
| W16 | When alerts are worked out | A listing that goes live is queued; the cron `declutter-wanted` (every 10 minutes) matches it and sends the alerts, so alert work never runs inside a publish, an admin approval or a refund (review: a reproduced deadlock, and a failing alert could have blocked a refund). A failure is logged as a cron defect and retried (12 tries). Alerts for a new listing therefore arrive up to ~10 minutes after it goes live. Posting a wanted item still tells matching sellers at once. Default chosen by lane, owner to confirm. | 2026-10-16 |
| W17 | Residual hint risk | Accepted: see the re-review note below (staged sales can reveal one sale's price at high cost). Default chosen by lane, owner to confirm. | 2026-10-16 |
| W14 | Where it lives in the app | A fifth view "Wanted" inside /declutter (beside Browse, My listings, Offers, Cart), shown only while `declutter_wanted` is on for the member. No new route. Default chosen by lane, owner to confirm. | 2026-10-16 |

## Reviews (2026-10-16, REVIEW-ONLY, on wip @4326e0ccc)
- lh-authz-rls: changes needed (deadlock between go-live paths, reproduced on Postgres 16) -> fixed by W16 (queue + cron, no
  cross-member locks). Should-fixes fixed: seed posts spending real sellers' caps (W4/W6), no per-post seller limit (W7),
  hint revealing single sale prices (W10/W11), poster who lost the switch kept alerting (W4). Notes kept: a banned member can
  still read the hint and their own posts (STABLE reads, Q281 covers writes only); the match ledger must never be exported
  (pinned by the PGlite proof).
- lh-trust-safety: changes needed -> fixed: free text echoed to sellers (W15), seed cap burn (W4/W6), hint minimum and
  pair rule (W10), "near you" on a listing page (W12), the blocked poster's list now matches Browse (blocks never hide a
  listing from the list; alerts still never cross a block), spaced/word/non-ASCII phone numbers refused in wanted text (W8).
  Not fixed here: the SHARED contact_leak_reason misses spaced digits, Unicode math digits and fullwidth letters in listings,
  questions and messages (filed in docs/OPEN.md as Q1881).
- lh-silent-failure: approve-with-notes -> fixed: matcher inside money transactions (W16), stamps without a written row (W6),
  Wanted list saying "nothing matches" when the item read failed or was past 500 (matches now come with the post), open posts
  listed first, toast/row copy no longer promise an alert that may not come, `wanted_area_unknown` has its own words, the
  sell-flow hint prefers the newest pickup point. Kept: expected refusals reach error_logs as errors (the existing Declutter
  pattern; filed as Q1882).

- lh-authz-rls RE-REVIEW (on f240d519b): changes-needed, all fixed before ready: the Q807 unconfirmed-email gate ran before the
  queue table existed (moved after the last CREATE TABLE); the cron command fed cron_record_work without to_jsonb (guard
  cronWorkVisibility); declutter_wanted_notify bypassed the live-profile seed rule (pairs now also compare both LIVE
  profiles' is_seed, an account marked test after it posted meets no real listing); a queue row out of tries blocked every
  later go-live (now dropped with a "gave up" defect, and a re-queue resets it); the highest price is whole dollars (cents
  were a free message channel). Residual, accepted and recorded (W17): an attacker who stages 10 of the 11 counted sales
  in one category/condition/cell can learn the 2nd-lowest price (one person's sale) at a cost of 3+ payout-ready sellers
  and thousands of dollars of their own fees. Not built: a test for the 20-sellers-per-post limit (it needs more distinct test sellers than the harness has).

## Layers (what was built)
- DB: `declutter_wanted` (poster reads own, RPC writes only), `declutter_wanted_matches` and `declutter_wanted_queue`
  (no client privilege), triggers: seed-from-poster, contact-leak, and "listing went live" -> queue; cron `declutter-wanted`.
- Server RPCs: `declutter_create_wanted`, `declutter_close_wanted`, `declutter_my_wanted`, `declutter_price_hint`;
  service-only helpers `declutter_wanted_pairs`, `declutter_wanted_record_match`, `declutter_wanted_match_item`,
  `declutter_wanted_sweep`, `declutter_wanted_notify`, `declutter_wanted_alert_block`, `declutter_miles`, `declutter_money_words`.
- Download My Data: `declutter_wanted` section (restated from 20261015084728's body).
- Client: `src/lib/declutter/wanted.ts`, the Wanted view, the price hint on the item page and the sell flow.
