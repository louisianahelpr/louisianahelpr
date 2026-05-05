-- Helper verification history table — captures every change to verification-
-- related fields on `profiles` so admins can audit who changed what when.
-- Purely additive: no existing flow reads from this table; the trigger only
-- writes to it. Closes the "add helper_verifications history table for audit"
-- TODO line item without touching legacy_manual_review (separate deprecation).
--
-- Tracked fields (any change inserts one row per field):
--   approval_status      — primary lifecycle (pending/approved/denied/banned)
--   idv_status           — Stripe Identity outcome (not_started/processing/verified/failed)
--   idv_confidence       — Stripe Identity confidence score
--   idv_failure_reason   — Stripe Identity failure reason
--   idv_session_id       — Stripe Identity session id (useful for x-ref)
--   legacy_manual_review — manual-review override flag (will deprecate later)
--
-- changed_by:
--   auth.uid() at trigger fire time. NULL when invoked by a service_role
--   call (cron jobs, edge functions running as service role) — exactly the
--   right behavior: system-initiated changes correctly show as "no human".
--   For admin actions, AdminUsers/AdminIDVQueue calls run as the admin user
--   so auth.uid() returns the admin's id.

CREATE TABLE IF NOT EXISTS public.helper_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  field text NOT NULL,
  old_value text,
  new_value text
);

-- Read pattern: admin pulls history for a single user, ordered newest-first.
CREATE INDEX IF NOT EXISTS idx_helper_verifications_user_changed
  ON public.helper_verifications (user_id, changed_at DESC);

-- Cross-cut by field for analytics ("what fraction of IDV sessions failed last week").
CREATE INDEX IF NOT EXISTS idx_helper_verifications_field_changed
  ON public.helper_verifications (field, changed_at DESC);

ALTER TABLE public.helper_verifications ENABLE ROW LEVEL SECURITY;

-- Admins read everything for moderation queues and incident triage.
CREATE POLICY "Admins read all verification history"
  ON public.helper_verifications FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Users read their own history (transparency: "why was I denied?").
CREATE POLICY "Users read their own verification history"
  ON public.helper_verifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies from authed clients — writes happen only
-- via the SECURITY DEFINER trigger below, which runs with elevated privilege
-- and bypasses RLS.

-- ──────────────────────────────────────────────────────────────────────────────
-- Trigger function
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_verification_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    INSERT INTO public.helper_verifications (user_id, changed_by, field, old_value, new_value)
    VALUES (NEW.user_id, v_actor, 'approval_status', OLD.approval_status, NEW.approval_status);
  END IF;

  IF NEW.idv_status IS DISTINCT FROM OLD.idv_status THEN
    INSERT INTO public.helper_verifications (user_id, changed_by, field, old_value, new_value)
    VALUES (NEW.user_id, v_actor, 'idv_status', OLD.idv_status, NEW.idv_status);
  END IF;

  IF NEW.idv_confidence IS DISTINCT FROM OLD.idv_confidence THEN
    INSERT INTO public.helper_verifications (user_id, changed_by, field, old_value, new_value)
    VALUES (NEW.user_id, v_actor, 'idv_confidence', OLD.idv_confidence::text, NEW.idv_confidence::text);
  END IF;

  IF NEW.idv_failure_reason IS DISTINCT FROM OLD.idv_failure_reason THEN
    INSERT INTO public.helper_verifications (user_id, changed_by, field, old_value, new_value)
    VALUES (NEW.user_id, v_actor, 'idv_failure_reason', OLD.idv_failure_reason, NEW.idv_failure_reason);
  END IF;

  IF NEW.idv_session_id IS DISTINCT FROM OLD.idv_session_id THEN
    INSERT INTO public.helper_verifications (user_id, changed_by, field, old_value, new_value)
    VALUES (NEW.user_id, v_actor, 'idv_session_id', OLD.idv_session_id, NEW.idv_session_id);
  END IF;

  IF NEW.legacy_manual_review IS DISTINCT FROM OLD.legacy_manual_review THEN
    INSERT INTO public.helper_verifications (user_id, changed_by, field, old_value, new_value)
    VALUES (NEW.user_id, v_actor, 'legacy_manual_review', OLD.legacy_manual_review::text, NEW.legacy_manual_review::text);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_verification_history ON public.profiles;
CREATE TRIGGER profiles_verification_history
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.log_verification_change();

COMMENT ON TABLE public.helper_verifications IS
  'Audit log of changes to verification-related profile fields. Written by AFTER UPDATE trigger on profiles. Read by admins for moderation queues and by users for self-transparency.';
