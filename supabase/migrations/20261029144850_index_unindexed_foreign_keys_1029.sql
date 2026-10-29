-- The Supabase PERFORMANCE advisor's exact baseline (scripts/ci/performance-advisor-baseline.json,
-- Q1321) went red in db-drift-detect run 40748951301 (2026-10-28, nightly-red #3743):
-- "unindexed_foreign_keys: 8 finding(s), a class the baseline does not name". The baseline holds
-- this class at zero. Read live on prod 2026-10-29 ~14:45Z (pg_constraint contype 'f' in public
-- with no index whose leading columns are the key): 9 now, the 8 from that run plus
-- declutter_handover_talks.opened_by from 20261028235249, deployed since.
--
-- Without a covering index, deleting the referenced row (a member's account, a meetup spot, a
-- donation partner) scans the whole referencing table. confrelid read the same minute:
--   job_guarantee_claims.helper_id           -> auth.users                (20261027200455)
--   job_guarantee_claims.poster_id           -> auth.users                (20261027200455)
--   declutter_meetup_spots.created_by        -> auth.users                (20261027204500)
--   declutter_meetup_choices.seller_id       -> auth.users                (20261027204500)
--   declutter_meetup_choices.spot_id         -> declutter_meetup_spots    (20261027204500)
--   declutter_order_meetups.spot_id          -> declutter_meetup_spots    (20261027204500)
--   declutter_donation_partners.created_by   -> auth.users                (20261027222743)
--   declutter_donations.partner_id           -> declutter_donation_partners (20261027222743)
--   declutter_handover_talks.opened_by       -> auth.users                (20261028235249)
-- One plain CREATE INDEX IF NOT EXISTS per column, written out (not built in a loop, so the
-- baseline guard can read each one). They start out unused, so the baseline names all nine in
-- unused_index in this same change (precedent: 20261026002027).
--
-- REPLAY-SAFETY: every table comes from an EARLIER migration (listed above); CREATE INDEX IF NOT
-- EXISTS makes a second and third run a no-op. No policy, grant, column or function changes.

CREATE INDEX IF NOT EXISTS job_guarantee_claims_helper_id_idx ON public.job_guarantee_claims (helper_id);
CREATE INDEX IF NOT EXISTS job_guarantee_claims_poster_id_idx ON public.job_guarantee_claims (poster_id);
CREATE INDEX IF NOT EXISTS declutter_meetup_spots_created_by_idx ON public.declutter_meetup_spots (created_by);
CREATE INDEX IF NOT EXISTS declutter_meetup_choices_seller_id_idx ON public.declutter_meetup_choices (seller_id);
CREATE INDEX IF NOT EXISTS declutter_meetup_choices_spot_id_idx ON public.declutter_meetup_choices (spot_id);
CREATE INDEX IF NOT EXISTS declutter_order_meetups_spot_id_idx ON public.declutter_order_meetups (spot_id);
CREATE INDEX IF NOT EXISTS declutter_donation_partners_created_by_idx ON public.declutter_donation_partners (created_by);
CREATE INDEX IF NOT EXISTS declutter_donations_partner_id_idx ON public.declutter_donations (partner_id);
CREATE INDEX IF NOT EXISTS declutter_handover_talks_opened_by_idx ON public.declutter_handover_talks (opened_by);
