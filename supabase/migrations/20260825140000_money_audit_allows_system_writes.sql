-- The money-write audit trail (20260823230000) could abort the money write.
--
-- `audit_money_table_change` stamps `admin_id := auth.uid()` and
-- `admin_audit_log.admin_id` was NOT NULL. auth.uid() is NULL for every
-- service-role / pg_cron write, so the audit INSERT raised 23502 and — being a
-- plain AFTER trigger — rolled the whole statement back. Every AUTOMATED write
-- to the four audited money tables failed:
--
--   * payout_transfers — proven live 2026-08-25: release-payout sent a real
--     Stripe transfer (tr_3U8BRxKp2H4b7tEC0Q7wzv1C), then could not write the
--     ledger row. That row is also what the duplicate-transfer check reads, so
--     the job stayed `payout_pending`, auto-release re-picked it every 30 min,
--     and once the `release-payout-<job_id>` Stripe idempotency key aged out of
--     its ~24h window the retry would have sent a SECOND real transfer.
--   * user_bans — the reliability ladder's cron path
--     (expire_unanswered_offers -> apply_job_denial_consequence) could not
--     record a temp/permanent ban.
--   * payment_refunds, platform_settings — same shape.
--
-- Fix: an automated actor is a legitimate actor with no admin behind it, so
-- admin_id becomes nullable and NULL now means "system". The details payload
-- carries an explicit `actor` so a reader never has to infer it from a blank
-- column.
ALTER TABLE public.admin_audit_log ALTER COLUMN admin_id DROP NOT NULL;

COMMENT ON COLUMN public.admin_audit_log.admin_id IS
  'The admin who performed the action. NULL means an automated/system write '
  '(pg_cron or a service-role edge function), where no admin is behind it — '
  'see details->>''actor''.';

CREATE OR REPLACE FUNCTION public.audit_money_table_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target text;
BEGIN
  -- Prefer the row's own id; fall back to the job it belongs to so a deleted
  -- row is still traceable to something.
  v_target := COALESCE(
    (to_jsonb(COALESCE(NEW, OLD)) ->> 'id'),
    (to_jsonb(COALESCE(NEW, OLD)) ->> 'job_id'),
    'unknown'
  );

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(),               -- NULL for cron / service-role writes = system
    TG_OP,                    -- INSERT / UPDATE / DELETE
    TG_TABLE_NAME,
    v_target,
    jsonb_build_object(
      'op', TG_OP,
      -- Name the actor explicitly so "system" is a stated fact in the trail,
      -- not something a reader has to infer from a blank admin_id.
      'actor', CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'admin' END,
      -- Both sides on an UPDATE so the log says what CHANGED, not just that
      -- something did. NULL on the side that does not exist for the operation.
      'old', CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
      'new', CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
    )
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;
