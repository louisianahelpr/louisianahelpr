-- Six foreign keys had no covering index (Supabase performance advisor,
-- unindexed_foreign_keys, read 2026-10-25 16:52Z; db-drift-detect run
-- 40112202504 failed on "unindexed_foreign_keys: 6 finding(s), a class the
-- baseline does not name"). Without an index, deleting or re-keying the
-- referenced profile scans the whole referencing table, and the nightly drift
-- check stays red. Each index covers exactly the FK's one column:
--   disputes.agreed_helper_id            (disputes_agreed_helper_id_fkey)
--   disputes.agreed_poster_id            (disputes_agreed_poster_id_fkey)
--   job_approval_escalations.resolved_by (job_approval_escalations_resolved_by_fkey)
--   provider_payments.payer_id           (provider_payments_payer_id_fkey)
--   provider_payouts.payee_user_id       (provider_payouts_payee_user_id_fkey)
--   support_replies.admin_id             (support_replies_admin_id_fkey)
-- Indexes only: no data, policy or grant changes. They start out unused, so
-- scripts/ci/performance-advisor-baseline.json names them in unused_index in
-- the same change.
--
-- REPLAY-SAFETY: every statement is CREATE INDEX IF NOT EXISTS behind a
-- to_regclass guard on its table (and a column check), so a from-scratch
-- rebuild that has not created a table yet, or a replay, is a no-op.

DO $do$
DECLARE
  spec text[];
  specs text[][] := ARRAY[
    ARRAY['disputes',                 'agreed_helper_id', 'disputes_agreed_helper_id_idx'],
    ARRAY['disputes',                 'agreed_poster_id', 'disputes_agreed_poster_id_idx'],
    ARRAY['job_approval_escalations', 'resolved_by',      'job_approval_escalations_resolved_by_idx'],
    ARRAY['provider_payments',        'payer_id',         'provider_payments_payer_id_idx'],
    ARRAY['provider_payouts',         'payee_user_id',    'provider_payouts_payee_user_id_idx'],
    ARRAY['support_replies',          'admin_id',         'support_replies_admin_id_idx']
  ];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY specs LOOP
    IF to_regclass('public.' || spec[1]) IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM pg_attribute
          WHERE attrelid = to_regclass('public.' || spec[1])
            AND attname = spec[2] AND NOT attisdropped
       ) THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%I)', spec[3], spec[1], spec[2]);
    END IF;
  END LOOP;
END
$do$;
