-- Follow-up to 20260825140000. Three defects in the money-write audit trail,
-- all found reviewing that fix:
--
-- 1. The audit insert could still abort the money write. Making admin_id
--    nullable removed ONE instance (23502) of a whole class — any future
--    constraint, bad payload, or disk condition inside this AFTER trigger
--    still rolls back the payout it was only supposed to observe. The whole
--    incident on 2026-08-25 (a real Stripe transfer with no ledger row, the
--    job stuck in payout_pending, a double-transfer waiting on the far side of
--    Stripe's ~24h idempotency window) was that class. A missing audit row is
--    recoverable from Stripe plus the ledger; a rolled-back transfer is money
--    out the door with no record. So the audit insert is now non-blocking and
--    fails loud in the logs instead.
--
-- 2. `actor` lied about who acted. It read
--    `CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'admin' END`, but a
--    non-NULL auth.uid() is not an admin: decline_job_offer,
--    report_helper_no_show, cancel_booked_job and the Elite shield are all
--    SECURITY DEFINER + GRANTed to `authenticated`, and they write user_bans
--    under an ORDINARY user's session. Each would have logged a regular user
--    as 'admin' and rendered their name in the audit screen's Admin column.
--    An audit log that asserts something false is worse than one that is
--    silent, so the role is now checked rather than assumed.
--
-- 3. Admin actions taken through a service-role edge function
--    (execute-dispute-split, create-payment's admin refund, release-payout's
--    force-release) have no auth.uid() inside Postgres, so they recorded as
--    'system' — losing the admin behind a disputed-money decision. Those rows
--    already carry `initiated_by_user_id`, so attribution now falls back to
--    the row itself. `banned_by` is deliberately NOT used the same way: the
--    reliability ladder sets it to the banned helper, and crediting them as
--    the actor would misattribute an automated ban to its own subject.
--
-- The raw session uid is kept in details->>'session_uid' so a reader can still
-- separate "an admin, in session" from "an admin, via a service-role function".
-- The row snapshots below are verbatim `to_jsonb(NEW/OLD)`, and one of the
-- audited tables holds a live credential: platform_settings.social_webhook_url
-- is a Slack webhook (written at src/components/admin/AdminSettings.tsx:176).
-- The app's own logger already refuses to record it, storing only
-- 'set'/'cleared' (:181) — the trigger was quietly undoing that care and
-- retaining the real URL forever, readable by every admin. Mask anything whose
-- key names a credential, on both sides of the snapshot.
CREATE OR REPLACE FUNCTION public.redact_audit_snapshot(p_row jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_row IS NULL THEN NULL
    -- jsonb_object_agg over zero keys returns NULL, which would erase the fact
    -- that a row existed at all; an empty row stays an empty object.
    ELSE COALESCE((
      SELECT jsonb_object_agg(
        key,
        CASE
          -- A null stays null rather than becoming the string "[redacted]" —
          -- "this credential was unset" is itself the fact being audited.
          WHEN key ~* '(secret|password|token|api_key|_key$|webhook)' AND value <> 'null'::jsonb
            THEN '"[redacted]"'::jsonb
          ELSE value
        END
      )
      FROM jsonb_each(p_row)
    ), '{}'::jsonb)
  END;
$$;

CREATE OR REPLACE FUNCTION public.audit_money_table_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target       text;
  v_row          jsonb;
  v_session_uid  uuid := auth.uid();
  v_row_actor    uuid;
  v_admin_id     uuid;
  v_actor        text;
BEGIN
  v_row := to_jsonb(COALESCE(NEW, OLD));

  -- Prefer the row's own id; fall back to the job it belongs to so a deleted
  -- row is still traceable to something.
  v_target := COALESCE(v_row ->> 'id', v_row ->> 'job_id', 'unknown');

  -- Only initiated_by_user_id — the column that means "the human who asked for
  -- this". Present on payout_transfers and payment_refunds; absent elsewhere,
  -- where this simply stays NULL.
  BEGIN
    v_row_actor := NULLIF(v_row ->> 'initiated_by_user_id', '')::uuid;
  EXCEPTION WHEN others THEN
    v_row_actor := NULL;
  END;

  v_admin_id := COALESCE(v_session_uid, v_row_actor);

  v_actor := CASE
    WHEN v_session_uid IS NOT NULL THEN
      CASE WHEN public.has_role(v_session_uid, 'admin'::app_role) THEN 'admin' ELSE 'user' END
    WHEN v_row_actor IS NOT NULL THEN 'admin'
    ELSE 'system'
  END;

  -- Non-blocking: this trigger observes money moving, it must never be the
  -- reason money fails to move. A dropped audit row is logged as a WARNING and
  -- is reconstructable from Stripe plus the ledger row itself.
  BEGIN
    INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
    VALUES (
      v_admin_id,
      TG_OP,                    -- INSERT / UPDATE / DELETE
      TG_TABLE_NAME,
      v_target,
      jsonb_build_object(
        'op', TG_OP,
        'actor', v_actor,
        'session_uid', v_session_uid,
        -- Both sides on an UPDATE so the log says what CHANGED, not just that
        -- something did. NULL on the side that does not exist for the operation.
        'old', CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN public.redact_audit_snapshot(to_jsonb(OLD)) ELSE NULL END,
        'new', CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN public.redact_audit_snapshot(to_jsonb(NEW)) ELSE NULL END
      )
    );
  EXCEPTION WHEN others THEN
    RAISE WARNING 'audit_money_table_change: audit insert failed on %.% (target %): % (%)',
      TG_TABLE_SCHEMA, TG_TABLE_NAME, v_target, SQLERRM, SQLSTATE;
  END;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- An admin may only file an audit row under their OWN id. Without this, the
-- now-nullable admin_id lets an admin insert a row that reads as a system
-- action — and non-repudiation is the entire point of this table. Service-role
-- writers (auth.uid() IS NULL) are deliberately unconstrained, which is how the
-- trigger above and the cron paths keep working.
CREATE OR REPLACE FUNCTION public.enforce_audit_log_self_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.admin_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'audit_log_actor_mismatch'
      USING ERRCODE = '42501',
            HINT = 'An audit row must be filed under the acting admin''s own id.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_self_attribution ON public.admin_audit_log;
CREATE TRIGGER trg_audit_log_self_attribution
  BEFORE INSERT ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.enforce_audit_log_self_attribution();
