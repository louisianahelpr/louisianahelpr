-- The Supabase PERFORMANCE advisor's exact baseline (scripts/ci/performance-advisor-baseline.json,
-- Q1321) holds unindexed_foreign_keys at zero; get_advisors (performance) on prod read 26 on
-- 2026-11-04 ~02:58Z (Q1816, nightly-red #3743 db-drift-detect). pg_constraint read the same
-- minute (contype 'f' in public with no index whose leading columns are the key) gives the same 26.
-- Without a covering index, deleting the referenced row (a member's account, a cart line, a
-- manager grant, a payout, a message) scans the whole referencing table.
-- table.column -> referenced table (the migration that added the key):
--   declutter_bundle_request_items.line_id         -> declutter_cart_items       (20261104103528)
--   declutter_free_requests.seller_id              -> auth.users                 (20261030064021)
--   declutter_manager_actions.manager_id           -> auth.users                 (20261101181005)
--   declutter_manager_actions.seller_id            -> auth.users                 (20261101181005)
--   declutter_manager_grants.ended_by              -> auth.users                 (20261101181005)
--   declutter_manager_messages.grant_id            -> declutter_manager_grants   (20261101181005)
--   declutter_manager_messages.manager_id          -> auth.users                 (20261101181005)
--   declutter_manager_messages.seller_id           -> auth.users                 (20261101181005)
--   declutter_manager_payouts.grant_id             -> declutter_manager_grants   (20261101230509)
--   declutter_manager_payouts.manager_id           -> auth.users                 (20261101230509)
--   declutter_manager_payouts.seller_id            -> auth.users                 (20261101230509)
--   declutter_manager_payouts.seller_payout_id     -> declutter_payouts          (20261101230509)
--   declutter_manager_submissions.grant_id         -> declutter_manager_grants   (20261101181005)
--   declutter_manager_submissions.manager_id       -> auth.users                 (20261101181005)
--   declutter_offers.voided_by_line                -> declutter_cart_items       (20261101030040)
--   declutter_order_manager_shares.grant_id        -> declutter_manager_grants   (20261101230509)
--   declutter_order_manager_shares.manager_id      -> auth.users                 (20261101230509)
--   declutter_order_manager_shares.seller_id       -> auth.users                 (20261101230509)
--   helpr_card_fee_debts.job_id                    -> jobs                       (20261102072106)
--   helpr_tasks.released_helpr_id                  -> auth.users                 (20261101020052)
--   instant_book_declines.helper_id                -> auth.users                 (20261101065105)
--   job_continue_days.decided_by                   -> auth.users                 (20261101231015)
--   job_continue_days.proposed_by                  -> auth.users                 (20261101231015)
--   job_continue_events.actor_id                   -> auth.users                 (20261101231015)
--   job_continue_events.continue_id                -> job_continue_days          (20261101231015)
--   unread_message_reminder_sends.message_id       -> messages                   (20261101183017)
-- One plain CREATE INDEX IF NOT EXISTS per column, written out (not built in a loop, so the
-- baseline guard can read each one). They start out unused, so the baseline names all 26 in
-- unused_index in this same change (precedent: 20261029144850).
--
-- REPLAY-SAFETY: every table comes from an EARLIER migration (listed above); CREATE INDEX IF NOT
-- EXISTS makes a second and third run a no-op. No policy, grant, column or function changes.

CREATE INDEX IF NOT EXISTS declutter_bundle_request_items_line_id_idx ON public.declutter_bundle_request_items (line_id);
CREATE INDEX IF NOT EXISTS declutter_free_requests_seller_id_idx ON public.declutter_free_requests (seller_id);
CREATE INDEX IF NOT EXISTS declutter_manager_actions_manager_id_idx ON public.declutter_manager_actions (manager_id);
CREATE INDEX IF NOT EXISTS declutter_manager_actions_seller_id_idx ON public.declutter_manager_actions (seller_id);
CREATE INDEX IF NOT EXISTS declutter_manager_grants_ended_by_idx ON public.declutter_manager_grants (ended_by);
CREATE INDEX IF NOT EXISTS declutter_manager_messages_grant_id_idx ON public.declutter_manager_messages (grant_id);
CREATE INDEX IF NOT EXISTS declutter_manager_messages_manager_id_idx ON public.declutter_manager_messages (manager_id);
CREATE INDEX IF NOT EXISTS declutter_manager_messages_seller_id_idx ON public.declutter_manager_messages (seller_id);
CREATE INDEX IF NOT EXISTS declutter_manager_payouts_grant_id_idx ON public.declutter_manager_payouts (grant_id);
CREATE INDEX IF NOT EXISTS declutter_manager_payouts_manager_id_idx ON public.declutter_manager_payouts (manager_id);
CREATE INDEX IF NOT EXISTS declutter_manager_payouts_seller_id_idx ON public.declutter_manager_payouts (seller_id);
CREATE INDEX IF NOT EXISTS declutter_manager_payouts_seller_payout_id_idx ON public.declutter_manager_payouts (seller_payout_id);
CREATE INDEX IF NOT EXISTS declutter_manager_submissions_grant_id_idx ON public.declutter_manager_submissions (grant_id);
CREATE INDEX IF NOT EXISTS declutter_manager_submissions_manager_id_idx ON public.declutter_manager_submissions (manager_id);
CREATE INDEX IF NOT EXISTS declutter_offers_voided_by_line_idx ON public.declutter_offers (voided_by_line);
CREATE INDEX IF NOT EXISTS declutter_order_manager_shares_grant_id_idx ON public.declutter_order_manager_shares (grant_id);
CREATE INDEX IF NOT EXISTS declutter_order_manager_shares_manager_id_idx ON public.declutter_order_manager_shares (manager_id);
CREATE INDEX IF NOT EXISTS declutter_order_manager_shares_seller_id_idx ON public.declutter_order_manager_shares (seller_id);
CREATE INDEX IF NOT EXISTS helpr_card_fee_debts_job_id_idx ON public.helpr_card_fee_debts (job_id);
CREATE INDEX IF NOT EXISTS helpr_tasks_released_helpr_id_idx ON public.helpr_tasks (released_helpr_id);
CREATE INDEX IF NOT EXISTS instant_book_declines_helper_id_idx ON public.instant_book_declines (helper_id);
CREATE INDEX IF NOT EXISTS job_continue_days_decided_by_idx ON public.job_continue_days (decided_by);
CREATE INDEX IF NOT EXISTS job_continue_days_proposed_by_idx ON public.job_continue_days (proposed_by);
CREATE INDEX IF NOT EXISTS job_continue_events_actor_id_idx ON public.job_continue_events (actor_id);
CREATE INDEX IF NOT EXISTS job_continue_events_continue_id_idx ON public.job_continue_events (continue_id);
CREATE INDEX IF NOT EXISTS unread_message_reminder_sends_message_id_idx ON public.unread_message_reminder_sends (message_id);
