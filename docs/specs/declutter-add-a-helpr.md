# Declutter "Add a Helpr" — decision record

Owner ask (2026-10-16): when buying a Declutter item, a one-tap add-on books a Helpr for assembly,
wall-mounting or setup at the buyer's place. It becomes a normal Helpr job (the existing jobs flow,
escrow, categories assembly / handyman) linked to the Declutter order. Approved earlier as row 72
("Sold it? Get help") of [declutter-auctions.md](declutter-auctions.md).

Built behind the hidden switch `declutter_add_helpr` (created `testers`, migration
20261016053527_declutter_add_a_helpr). Going live is the owner's flip in Admin -> Settings.

## How it works
1. Checkout (the cart's pay step) says: "Need it put together or hung on the wall? Once you pay, one
   tap books a Helpr to come to your place."
2. After paying, the buyer's paid order card shows "Need a hand with it?" with three one-tap choices:
   Put it together (category assembly), Hang it on the wall (handyman), Set it up (handyman).
3. A tap opens Post a Job pre-filled (`/post-job?declutterOrder=<order>&help=<kind>`): title,
   description naming the items, category, and the pickup day as the job date. The buyer sets the
   price and the address and pays through the normal job checkout. Nothing about job money changes.
4. Right after the job is created, `declutter_link_setup_job` links it to the order (like an STR
   turnover, 20261007145950). Once the job is paid, the order card lists it with its status and a
   link to the job.

## Layers
| Layer | What |
|---|---|
| DB | `declutter_order_jobs` (job_id PK -> jobs ON DELETE CASCADE, order_id -> declutter_orders ON DELETE CASCADE, `purpose` CHECK ('setup')). No client privilege. Many jobs per order, one order per job. Any category links (the pre-fill picks assembly or handyman; a re-picked category still links). |
| Server RPCs | `declutter_setup_helpr(order)` (STABLE, the buyer's pre-fill + linked jobs), `declutter_link_setup_job(order, job)` (VOLATILE, true = linked). Both `require_feature('declutter_add_helpr')` first, anon revoked, scoped to `auth.uid()`. |
| Client | `src/lib/declutter/setupHelpr.ts`; Post a Job (`usePostJobForm`, `useJobFormEffects`, `useJobSubmit`); `DeclutterAddHelpr.tsx` on the paid order card; a checkout note in `DeclutterTradeViews.tsx`. |
| Money | None new. The Declutter payment and the job payment are separate; each keeps its own fees, refunds and payouts. |
| Proof | `src/test/pglite/declutterAddAHelpr.pglite.mjs` (measured 2026-10-16: 14/14 applied 3x, 0/14 with `--before`); guard `src/test/declutterAddAHelpr.test.ts`; unit tests `src/lib/declutter/setupHelpr.test.ts`. |

## Merging with Helpr delivery
The delivery lane's "Helpr job tied to an order" can reuse `declutter_order_jobs` by adding
`'delivery'` to the `purpose` CHECK (one row per job either way). Not coordinated live: no
`wip/declutter-delivery` branch existed on origin when this was built (checked 2026-10-16 05:30Z).

## Defaults (default chosen by lane, owner to confirm)
| # | Question | Default chosen | When |
|---|----------|----------------|------|
| A1 | Where the one tap lives | On the paid order card right after paying (Stripe returns to the cart, where the card is); the checkout step only says it is coming. A tick box before paying was not built: the job is paid separately, so a pre-pay tick could not bind anything without changing the Declutter payment (a new money path). | 2026-10-16, default chosen by lane, owner to confirm |
| A2 | Price | The buyer sets it on Post a Job, like any job (the usual price guide applies). No fixed add-on price. | 2026-10-16, default chosen by lane, owner to confirm |
| A3 | Fees | The normal job fees and the normal Helpr commission; nothing extra, no discount. | 2026-10-16, default chosen by lane, owner to confirm |
| A4 | Who pays | The buyer, through the normal job checkout. The seller pays nothing. | 2026-10-16, default chosen by lane, owner to confirm |
| A5 | Timing | Job date pre-filled with the booked pickup day (Louisiana day) when it is today or later; otherwise blank for the buyer to pick. The server offers it while the order is paid and for 30 days after the handover; in practice the order card itself drops off the cart 30 days after the cart line was created (declutter_my_cart), which comes first. | 2026-10-16, default chosen by lane, owner to confirm |
| A6 | Categories | Put it together -> assembly; Hang it on the wall -> handyman; Set it up -> handyman. | 2026-10-16, default chosen by lane, owner to confirm |
| A7 | More than one | A buyer may book more than one Helpr job for one order (e.g. assemble AND mount); Post a Job warns when one is already booked. | 2026-10-16, default chosen by lane, owner to confirm |
| A8 | Address | The buyer's own address, typed on Post a Job (the city pre-fills from their profile as on every post). The seller's address is never used. | 2026-10-16, default chosen by lane, owner to confirm |
| A9 | Seller sees it | No. The link is the buyer's; the seller is not told a Helpr was booked. | 2026-10-16, default chosen by lane, owner to confirm |
| A10 | Declutter refund later | The Helpr job is not cancelled automatically if the Declutter order is refunded; the buyer cancels it under the normal job rules (any normal cancellation fee applies). A refunded order's card goes away, so no reminder is shown yet. | 2026-10-16, default chosen by lane, owner to confirm |

## Reviews (2026-10-16, REVIEW-ONLY, at f1ca5bab7)
- lh-money-escrow: approve-with-notes. No new money path. Fixed: the orphan-job cascade is now proven as the
  buyer (authenticated, prod-shaped DELETE policy, H11); the checkout note says the Helpr is priced and paid separately;
  an expired or refunded order's panel shows nothing instead of an error.
- lh-authz-rls: approve-with-notes. No IDOR, no leak, link race safe. Fixed: the 30-day window fails closed on missing
  dates (H14, red on the old code).
- lh-silent-failure: approve-with-notes. Fixed: the category gate on linking is gone (a re-picked category lost the link
  silently and hid the "already booked" warning; H6 now proves it links), and a failed link tells the buyer ("Your job
  posted, but it isn't showing on your Declutter purchase"). The panel's other errors show a retry.
- Kept as built (notes, not defects): the pre-fill can overwrite what the buyer typed in the first moment on a slow
  network (the STR turnover pre-fill works the same way); a draft resumed later from a plain Post a Job is not linked;
  the offer stays visible while a problem report is open on the order.
