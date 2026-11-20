
- 2026-11-18 ~8:50 AM (owner, pop-up): gift guides affiliate disclosure moves to the bottom of /gift-guides (small muted line), not the top. Owner chose this after being told FTC 16 CFR Part 255 guidance says bottom-only notices are unlikely to be seen and affiliate programs can drop non-compliant sites. Gift guides page goes public (no ?preview=1); each guide gets a #hash link for Pinterest pins.

## ID check + $2 setup fee (UPDATED 2026-11-20, owner pop-up; supersedes the 10-22 / 10-30 / 11-12 Declutter rows)
- 2026-11-20 (owner, pop-up): NO ID check and NO $2 setup fee anywhere in Declutter.
  - Declutter seller: no ID before the first payout; no $2 taken from payouts; no card fee at the first listing.
  - Declutter buyer: no ID and no $2 at the first purchase (offer, counter, bundle ask, trade, checkout).
  - Free item claimer: no ID and no $2 when the giver picks them.
  - KEPT exactly as before: Helprs (ID at hire or first payout, $2 from the first payout) and delivery Helprs (ID when taking a delivery, $2 from the first delivery payout).
  - 2026-11-20: the job poster's ID check moves from posting to sending an offer (hire, direct offer, instant book, crew seat, series dates, booking a quote); anyone can post with no ID step; $2 still with the first job payment. A Helpr gets the job's street address only once the poster is ID-verified AND the Helpr has accepted the offer. PR #4823, migration 20261120205350_poster_id_at_offer_not_post.
  - 2026-11-20: no ID check for Shops, sellers or buyers (matches Declutter). Shops keeps its $2 setup fee, which is not tied to the ID step. PR #4823, migration 20261120203904_shops_no_id_check.
  - Members who already paid a Declutter $2: no automatic refund (prod 2026-11-20: 0 such members found).
  - Shipped by PR fix/declutter-no-id-1120 (migration 20261120184430_declutter_no_id_no_setup_fee; guard src/test/declutterNoIdNoSetupFee.test.ts).
