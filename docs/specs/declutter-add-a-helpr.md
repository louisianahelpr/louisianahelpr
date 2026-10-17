# Declutter "Add a Helpr" — decision record

Owner ask (2026-10-16): when buying a Declutter item, a one-tap add-on books a Helpr for assembly,
wall-mounting or setup at the buyer's place. It becomes a normal Helpr job (the existing jobs flow,
escrow, categories assembly / handyman) linked to the Declutter order. Approved earlier as row 72
("Sold it? Get help") of [declutter-auctions.md](declutter-auctions.md).

Built behind Declutter's own switch `declutter` AND the hidden switch `declutter_add_helpr`
(created `testers`, migration 20261017073146_declutter_add_a_helpr): either one off refuses. Going live is the owner's flip in Admin -> Settings.

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
| Server RPCs | `declutter_setup_helpr(order)` (STABLE, the buyer's pre-fill + linked jobs), `declutter_link_setup_job(order, job)` (VOLATILE, true = linked). Both `require_feature('declutter')` then `require_feature('declutter_add_helpr')` first, anon revoked, scoped to `auth.uid()`. The link also refuses a banned caller (`account_restricted`) and a job in any state but never-paid (`job_already_funded`, an allowlist of unpaid / abandoned / failed: the link is written before checkout, so only the job just posted from the order links), answers yes first for a job already linked to this order (Post a Job links again before retrying a payment hand-off whose answer was lost, when a gift card may have funded it), and neither offers nor links on an order whose seller can no longer sell (`declutter_seller_out`) (lh-money-escrow review of 4f45a073f, LOWs 2-4; PGlite H19-H21, red on the 4f45a073f SQL). Post a Job never keeps a draft for a setup job (a draft cannot carry its order). |
| Client | `src/lib/declutter/setupHelpr.ts`; Post a Job (`usePostJobForm`, `useJobFormEffects`, `useJobSubmit`); `DeclutterAddHelpr.tsx` on the paid order card; a checkout note in `DeclutterTradeViews.tsx`. |
| Money | None new. The Declutter payment and the job payment are separate; each keeps its own fees, refunds and payouts. |
| Proof | `src/test/pglite/declutterAddAHelpr.pglite.mjs` (measured 2026-10-17: 24/24 applied 3x, including P1-P6 on the real Declutter schema with Helpr delivery 20261017052705 applied; 0/24 and exit 1 with `NEW_MIGRATION=skip`; H15-H17 red on the a98e0049d6 SQL; it exits 1 before any check if it would load a migration that is on neither main nor the Declutter stack); guard `src/test/declutterAddAHelpr.test.ts`; unit tests `src/lib/declutter/setupHelpr.test.ts`. |

## Helpr delivery and the shared task module
Helpr delivery (slice 5, 20261017052705) built the shared `helpr_tasks` module: a Helpr picks an item
up at one address and takes it to another, paid out of the Declutter order's own charge. Add a Helpr is
NOT one of its sources (A11): the Helpr works at the buyer's place (no pickup, no drop-off), and the
owner asked for "a normal Helpr job (the existing jobs flow, escrow, ...)". So it has no task, payout or
photo code of its own: the job's escrow, fees, payout and disputes are the jobs ones, and
`declutter_order_jobs` only links the job to the order. A delivery order is offered the add-on like a
pickup order; it has no seller booking (the Helpr picks the pickup time), so the job date starts blank
(proof P3).

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
| A10 | Declutter refund later | **OWNER DECIDED (2026-10-17 morning pop-up Q1):** when the order is refunded because the SELLER failed (refund reason seller_no_show, not_as_described, seller_backed_out or seller_out: the `full_seller_pays_fee` policy), the buyer pays nothing: the Helpr setup job is cancelled with NO cancellation fee and the card fee returned, and the seller owes that card fee (a Declutter seller fee debt, like the banned-seller rule). Any other refund keeps today's rule: the buyer cancels under the normal job rules. **BUILT (20261017073146):** the trigger `trg_declutter_refund_cancels_setup_jobs` (AFTER INSERT on `declutter_refunds` WHEN the policy is `full_seller_pays_fee`) runs `declutter_apply_seller_fault`, which cancels each linked setup job that is still live and whose money is at rest (never paid, or in escrow) (open, accepted, in progress, change requested; not one the Helpr marked done; a crew job is logged for an admin) with fee 0, not late, no strike, marks it (`declutter_order_jobs.seller_fault_refund_id`) and tells the buyer and the Helpr in the words of what the seller did (no "the poster cancelled" back-out email); it never blocks the refund write, and each job's failure is logged on its own. EXCEPTION (lh-authz-rls review, 2026-10-17): a seller NO-SHOW is the one reason the buyer asserts alone, so on `seller_no_show` a job whose Helpr is committed (hired and confirmed) is NOT cancelled: it is logged, and an admin applies A10 by hand with `declutter_admin_apply_seller_fault(refund, true)` after checking (admin or server only, idempotent, audited). A done, disputed or mid-cancel job, and a crew job, are logged for an admin. NOTE FOR THE OWNER: a buyer's no-show report alone (no rebuttal) still cancels an UNCOMMITTED setup job, refunds it in full and bills the seller its card fee, as the order refund itself already does on that same report (slice 4); Q?addhelpr-debt-cap asks whether to wait for an admin first. The link survives the order (a seller who deletes their account keeps the marker). `void-cancelled-payments` reads that marker: no cancellation fee, the card fee returned (only a first job's one-time $2 account setup fee is kept, LEAD DECISION 2026-10-17: the owner's 10-13 rule, never refunded once onboarding is done), then `declutter_setup_job_fee_debt` adds the card fee Stripe kept to the seller's debt for that refund, once. A committed Helpr's withheld late-cancel fee is paged to ops (Q?addhelpr-helpr-fee asks whether the seller owes it). Still open: Q?addhelpr-refund (telling the buyer about a linked job on every OTHER refund; the switch stays testers-only until it is), Q?addhelpr-debt-cap, Q?addhelpr-reapply-sweep, Q?addhelpr-unbilled, Q?addhelpr-prod-chain. | 2026-10-17, owner |
| A11 | Is it a source of the shared Helpr task module (`helpr_tasks`, slice 5)? | No. It stays an ordinary Helpr job through Post a Job and the job checkout. The task module carries an item from a pickup address to a drop-off address and pays the Helpr out of the Declutter order's charge; on-site assembly has neither address, and the job is paid separately by the buyer (A4), so joining the module would need a new payment path the owner did not ask for. | 2026-10-16, default chosen by lane, owner to confirm |

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
