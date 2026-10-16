# Declutter haul-away — decision record

Owner ask (2026-10-16): "Declutter haul-away for unsold items: after N days a listing hasn't sold, the
seller gets one tap to book a Helpr to take the item(s) to donation or the dump. It becomes a normal
Helpr job prefilled from the listing(s), with a proof photo at drop-off." Approved earlier as row 73 of
[declutter-auctions.md](declutter-auctions.md) ("After the 3rd relist, one tap to have a Helpr haul it to
donation or post it as a free giveaway"). The giveaway half is not built here.

Built by lane declutter-haul-away (migration `20261016053639_declutter_haul_away.sql`), behind the hidden
switch `declutter_haul_away`, created for **testers** only (Declutter's own switch must be on too).

## How it works
1. **My listings** (Declutter tab) shows a card when listings haven't sold: "N items haven't sold ... Book a
   haul-away". Under each listing a line says when haul-away opens ("In 3 days ..."), that it is booked
   ("See the job"), or that an earlier one was never paid ("Finish booking" / "Put back on sale").
2. The tap opens **Post a Job** at `/post-job?haulAway=<ids>`, filled in from the listing(s): category
   Moving, title ("Haul away: Oak rocking chair" or "Haul away 3 items"), a description listing each item
   with its size, the suggested pay, the pickup address, the listing photos (up to 5), and **before/after
   photos ON** (the existing photo-proof gate, `require_photo_proof`): the Helpr's "after" photo is the
   proof at drop-off. The seller can change anything, then pays through the **normal job checkout**.
3. Right after the job row is created (before payment), `declutter_link_haul_away` links the items to it
   and takes them **off sale** (`ended`), closing their open offers (buyers are told, nothing charged), so
   nobody buys an item a Helpr is about to haul. If the server refuses (a buyer got one meanwhile, a Helpr is
   already booked), the unpaid job is removed and the seller is told why. Nothing is paid.
4. **Money in flight never loses its link** (lh-money-escrow BLOCK + lh-authz-rls + lh-silent-failure reviews,
   2026-10-16). One fail-closed rule (`declutter_haul_job_hold`) says what a linked job still holds:
   `none` (deleted, or cancelled with no money kept), `job_open` (open, never paid, no checkout: could still be
   paid later), `paying` (a Stripe checkout that can still complete: create-payment stamps
   `stripe_session_id`, only the expiry clears it, up to an hour later), `hauled` (completed), and `booked`
   (anything else, including cancelling, chargeback and any unknown value). A link is moved or undone ONLY at
   `none`. My listings shows `paying` with no buttons; for a never-paid job it offers "Book it again" / "Put
   back on sale", which first delete that job with the poster's own DELETE policy (refused while a checkout
   is live), then re-book or undo. Nothing on the server writes `public.jobs`.
5. **Post a Job**: a haul-away is never saved as a draft (a draft cannot carry its items, so a job posted
   again from it would be paid with no link); the link is made again before every retry of the payment
   hand-off; a lost link answer is asked once more; and when the booking fails after the job was created
   (link refused, or create-payment refused), the job is deleted and its items are put back how they were.
6. Known residual (Q?declutter-haul-away-nudge): a never-paid job left `failed` (declined card) after its
   checkout ran out cannot be deleted by its poster under today's jobs DELETE policy, so its items stay off
   sale and My listings says so; the planned sweep moves such a job to `abandoned`.
7. Undo puts an item back on sale only if it still has the 3-12 photos a listing needs (taking it down
   meanwhile removed them; then it stays off sale).

No new money path: the job, escrow, fees, payout, cancellation and disputes are the ordinary job ones.

## Defaults chosen by the lane, owner to confirm
| # | Question | Default | Why | When |
|---|----------|---------|-----|------|
| H1 | After how many days unsold? (the "N") | **14 days** after the listing went up for sale; an item already off sale without selling (`ended`) qualifies at once | Launch mode is offers with daily price drops and no end time (B13), so row 73's "after the 3rd relist" never happens; 14 days gives the price drops two weeks to work | 2026-10-16 (default chosen by lane, owner to confirm) |
| H2 | How many items in one haul-away? | Up to **10**, all at the **same pickup address** | One trip, one address; a job has one location | 2026-10-16 (default chosen by lane, owner to confirm) |
| H3 | What happens to the listing? | Off sale (`ended`) as soon as the job is posted, before payment; open offers closed with a notice | Nobody can buy an item a Helpr is about to take away; undo is one tap while unpaid | 2026-10-16 (default chosen by lane, owner to confirm) |
| H4 | Price | Suggested pay **$15 small / $35 large / $60 extra large per item, at least $40 a trip** (capped at the job maximum); the seller can change it like any job | A Helpr drives, loads and drops off; dump fees vary by parish | 2026-10-16 (default chosen by lane, owner to confirm) |
| H5 | Fees and who pays | The **seller** pays, as the job's poster: the normal job checkout and fees, the Helpr's normal commission and payout. No Declutter buyer's fee | It is an ordinary Helpr job; no new money path | 2026-10-16 (default chosen by lane, owner to confirm) |
| H6 | Dump / drop-off fee | The job text says "Any drop-off or dump fee is part of the pay" | The Helpr knows before accepting; nothing is reimbursed outside the job | 2026-10-16 (default chosen by lane, owner to confirm) |
| H7 | Where items go | Donation first; the dump only if donation won't take it. The Helpr picks the place | Plain and safe; no partner list exists | 2026-10-16 (default chosen by lane, owner to confirm) |
| H8 | Proof at drop-off | Before/after photos required (the existing gate): before = loaded at pickup, after = at drop-off | Reuses the job flow's proof; no new photo store | 2026-10-16 (default chosen by lane, owner to confirm) |
| H9 | Category | Moving | "haul" already maps to moving in the job builder (src/lib/categoryFromTitle.ts) | 2026-10-16 (default chosen by lane, owner to confirm) |
| H10 | Donation receipt | Not handled by the app; the seller can ask the Helpr in messages | No tax advice in the app | 2026-10-16 (default chosen by lane, owner to confirm) |

## Server (migration 20261016053639)
- `declutter_haul_aways` (item → job, `ON DELETE SET NULL` on the job; the item's prior status). No person
  column, no client privilege.
- `declutter_haul_job_hold(job)` (service-only, fail-closed, locks the job FOR UPDATE); the state read restates
  the same rule inline (a guard keeps them identical).
- `declutter_haul_away_state(ids)` (read), `declutter_link_haul_away(ids, job)`,
  `declutter_cancel_haul_away(item, job?)`: SECURITY DEFINER, `require_feature('declutter')` and
  `require_feature('declutter_haul_away')` first, banned callers refused on writes, `REVOKE ... FROM PUBLIC,
  anon`. The link takes only the caller's open, never-paid job (FOR UPDATE, so two links to one job run one
  at a time) and each item (FOR UPDATE, id order; then the old job; then the link row, the same order a job
  DELETE's SET NULL takes) and re-checks every rule under the locks. `pickup_group` is salted with the
  seller's id.
- Kept minimal so Helpr delivery (slice 5, Q?declutter-delivery-first, built in another lane) can add its own
  item ↔ job link beside it; nothing here assumes there is only one kind.

## Proof
- PGlite (measured 2026-10-16): 72 checks, migration applied 3x, RED 66/72 with the migration skipped; three planted defects
  (lenient hold rule, unknown status = none, restore with 0 photos) each caught:
  `src/test/pglite/declutterHaulAway.pglite.mjs`. Includes the reviewers' probes P1-P5 and the seller's own
  job DELETE under RLS firing ON DELETE SET NULL.
- Fast guards: `src/test/declutterHaulAway.test.ts` (newest definitions), `src/lib/declutter/haulAway.test.ts`,
  `src/components/declutter/declutterHaulAway.test.tsx`, `src/pages/post-job/useHaulAwayPrefill.test.tsx`.

## Not built in this slice
- A bell/push to the seller on the day haul-away opens, and a sweep that puts items back on sale when a
  haul-away was abandoned for days (Q?declutter-haul-away-nudge in docs/OPEN.md).
- Row 73's "post it as a free giveaway" choice.
