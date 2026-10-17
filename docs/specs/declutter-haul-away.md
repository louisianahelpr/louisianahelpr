# Declutter haul-away — decision record

Owner ask (2026-10-16): "Declutter haul-away for unsold items: after N days a listing hasn't sold, the
seller gets one tap to book a Helpr to take the item(s) to donation or the dump. It becomes a normal
Helpr job prefilled from the listing(s), with a proof photo at drop-off." Approved earlier as row 73 of
[declutter-auctions.md](declutter-auctions.md) ("After the 3rd relist, one tap to have a Helpr haul it to
donation or post it as a free giveaway"). The giveaway half is not built here.

Built by lane declutter-haul-away (migration `20261017070827_declutter_haul_away.sql`), behind the hidden
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
   `none`. My listings shows `paying` with no buttons; for a never-paid job it offers "Finish booking" / "Put
   back on sale", which first delete that job with the poster's own DELETE policy (refused while a checkout
   is live), then re-book or undo. The job row is deleted first, and only a confirmed delete lets go of its
   photos (a refused delete keeps the job and its photos; the files of a deleted job are cleared by the weekly
   storage orphan sweep, since the photo DELETE policy needs the job row). A job left `failed` (declined card,
   `job_stuck`) is never tried. The card at the top offers only items that can go on a new job as they stand
   (eligible, or unpaid with the old job gone or cancelled), the same rule the server applies. Nothing on the
   server writes `public.jobs`.
5. **Post a Job**: a haul-away is never saved as a draft (a draft cannot carry its items, so a job posted
   again from it would be paid with no link); the link is made again before every retry of the payment
   hand-off; a lost link answer is asked once more; and when the booking fails after the job was created
   (link refused, or create-payment refused), the job is deleted and its items are put back how they were.
   The re-link before a retry is answered as success when every item is already linked to that job (it may
   have been funded meanwhile, by a gift card), and a re-link refusal never deletes the job or its photos.
   When the retried payment hand-off is refused, Post a Job first reads the job: a job a gift card paid for
   inside the lost first call is a success (the seller goes to the payment-success page), never a "Couldn't
   start payment"; and the cleanup of an unpaid job touches its photos only once the job is confirmed to be one
   its poster may delete (open, unpaid with no checkout, or abandoned). This is the shared Post a Job path, so
   it holds for every job, not only a haul-away (Q?gift-paid-retry-photos).
6. Known residual (Q?declutter-haul-away-nudge): a never-paid job left `failed` (declined card) after its
   checkout ran out cannot be deleted by its poster under today's jobs DELETE policy, so its items stay off
   sale and My listings says so; the planned sweep moves such a job to `abandoned`.
7. Undo puts an item back on sale only if it still has the 3-12 photos a listing needs (taking it down
   meanwhile removed them; then it stays off sale).
8. **A full refund puts the items back on sale (owner, 2026-10-17).** When a haul-away job that is over
   (completed, disputed, or cancelled) is refunded in full (`payment_status` becomes `refunded`), its items go
   back on sale automatically, by the same rule as undo: each returns to the status it had before (an item that
   was already off sale stays off sale; `live` only with 3-12 photos), the link goes, and the seller gets one
   "Back on sale" notice per item put back, saying to take it down if it is gone (a Helpr may really have taken
   it). A Stripe partial refund never sets `refunded` (a dispute split that leaves the Helpr $0 after rounding does, and counts as a full refund here); a live job (open, accepted, in progress) marked refunded is left
   alone until it is closed; a chargeback is not a refund. The refund itself never waits on this: if putting the
   items back fails, the failure is logged for ops and the items stay as they were, and the hold rule then reads
   that job as holding nothing, so the seller's own "Put back on sale" works.

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
| H11 | Is it a source of the shared Helpr task module (`helpr_tasks`, Helpr delivery slice 5)? | **No**: an ordinary Helpr job (Post a Job, the job checkout, escrow, the normal payout, before/after photos) | The owner asked for "a normal Helpr job prefilled from the listing(s), with a proof photo at drop-off". The task module pays the Helpr out of a Declutter order's charge, and a haul-away has no order (the seller pays separately, H5), so joining it would need a new payment path; its drop-off also needs a geocoded point, a door photo within 200 m of it and the customer's 4-digit code, and here the Helpr picks the donation center or dump (H7) and the seller is not there | 2026-10-16 (default chosen by lane, owner to confirm) |
| H12 | A finished haul-away job is later refunded in full: what happens to its items? | **Back on sale automatically** (each to the status it had before, with the photos a listing needs), and the seller is told | Owner decided (morning pop-up Q3: "items go BACK ON SALE automatically") | 2026-10-17 (owner) |

## Server (migration 20261017070827)
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
- `trg_declutter_haul_away_job_refunded` (AFTER UPDATE OF payment_status, status ON jobs, only when the job is
  `refunded` and completed/disputed/cancelled) runs `declutter_haul_away_job_refunded()` (service-only): the
  undo above for every item linked to that job, inside its own sub-block whose failure goes to
  `log_cron_defect`, so the money write that fired it always lands. The hold rule reads a refunded completed or
  disputed job as `none` (the fallback for that logged failure).
- Helpr delivery (slice 5) landed first with its own `helpr_tasks` module; haul-away does not use it (H11), and
  nothing here assumes there is only one kind of link.

## Proof
- PGlite (measured 2026-10-17, on main plus the Declutter stack: slices 1-4, F1, lane J's refund hand-settle and
  private handover bucket, porch default and Helpr delivery 20261016053945): 83 checks, migration applied 3x, RED
  77/83 (exit 1) with `NEW_MIGRATION=skip`; the pre-fix migration RED 2/83 (the funded-job re-link and the
  `job_stuck` hold); earlier planted defects (lenient hold rule, unknown status = none, restore with 0 photos) each
  caught: `src/test/pglite/declutterHaulAway.pglite.mjs`. It refuses to run (exit 2) when supabase/migrations holds a
  file on neither origin/main nor the stack ref. Includes the reviewers' probes P1-P5, the re-link checks F and the seller's own
  job DELETE under RLS firing ON DELETE SET NULL.
- Full refund (H12, measured 2026-10-17 on the Declutter stack 7b5aaba3d incl. 20261017060455): 109 checks, RED
  99/109 with `NEW_MIGRATION=skip`; the migration before this change (a6b60cd85) RED 11/109; a planted copy with no
  trigger RED 9/109, one with no hold-rule line RED 2/109, one whose sub-block catches nothing RED 4/109 (the
  refund write itself failed). Section G of the proof.
- Gift-paid retry (Q?gift-paid-retry-photos): `src/pages/post-job/haulAwayRelinkNoCleanup.test.tsx` 7/7, RED 3/7
  on the pre-fix useJobSubmit.ts.
- Fast guards: `src/test/declutterHaulAway.test.ts` (newest definitions), `src/lib/declutter/haulAway.test.ts`,
  `src/components/declutter/declutterHaulAway.test.tsx`, `src/pages/post-job/useHaulAwayPrefill.test.tsx`,
  `src/pages/post-job/haulAwayRelinkNoCleanup.test.tsx`.

## Not built in this slice
- A bell/push to the seller on the day haul-away opens, and a sweep that puts items back on sale when a
  haul-away was abandoned for days (Q?declutter-haul-away-nudge in docs/OPEN.md).
- Row 73's "post it as a free giveaway" choice.
