-- Abandoned-checkout nudge (lead, 2026-10-25, Builder A item 2).
--
-- A poster who opens checkout for a new job and walks away gets nothing today:
-- stripe-webhook's checkout.session.expired handler releases the job's session
-- hold and, for a still-'unpaid' job, says nothing (checkoutSessionExpired.ts:
-- "the poster walked away"). Now that expiry (50-60 minutes after the checkout
-- opened, create-payment's expires_at) sends ONE "Finish posting your job"
-- notice, in the app and by email, linking back to the form with the job
-- filled in.
--
--   1. public.job_checkout_nudges: one row per job ever nudged. Server-only:
--      RLS on, no policy, and nothing granted to anon or authenticated.
--   3. public.claim_checkout_nudge(job, poster, session, owner_approved): the
--      ONE door. It answers 'switch_off' (the switch is off for the poster),
--      'not_nudgeable' (no such job of this poster, or it is not an open,
--      never-paid job: unpaid, abandoned or failed), 'duplicate' (nudged
--      before) or 'claimed' (the row is written; send the notice now). The
--      claim is written BEFORE the notice, and the primary key makes a
--      re-delivered expiry, two sessions of one job, two webhook workers or a
--      second backfill call answer 'duplicate'. service_role only.
--   2. The hidden switch checkout_nudge, created 'testers' (AGENT-BRIEF "How
--      to ship a hidden feature"): the webhook asks
--      feature_enabled_for_user('checkout_nudge', poster) and does nothing
--      when it is off. Going live is the owner's flip in Admin -> Settings.
--      The one exception is the checkout-nudge-backfill edge function
--      (service role only, p_owner_approved): it sends the same nudge for ONE
--      named job the owner approved, switch or not; the claim makes it once.
--
-- Test and seed accounts: the notification's seed boundary trigger drops a
-- seed job's row, and send-notification-email refuses test recipients, a
-- suppressed address and a member whose job-update emails are off.
--
-- Replay-safe: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT DO
-- NOTHING, REVOKE.
-- Proof: src/test/pglite/checkoutNudge.pglite.mjs (3x).

CREATE TABLE IF NOT EXISTS public.job_checkout_nudges (
  job_id uuid PRIMARY KEY REFERENCES public.jobs (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  stripe_session_id text,
  notification_id uuid,
  emailed boolean,
  email_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.job_checkout_nudges IS
  'One row per job whose abandoned checkout sent the "Finish posting your job" notice (stripe-webhook checkoutSessionExpired). Claimed before the notice is written, so a job is nudged at most once. Server-only.';

ALTER TABLE public.job_checkout_nudges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_checkout_nudges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.job_checkout_nudges TO service_role;

CREATE INDEX IF NOT EXISTS job_checkout_nudges_user_idx ON public.job_checkout_nudges (user_id);

INSERT INTO public.feature_switches (key, audience, description)
VALUES ('checkout_nudge', 'testers',
        'Abandoned-checkout nudge: one "Finish posting your job" notice (in the app and by email) when a new job''s checkout expires unpaid.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.claim_checkout_nudge(
  p_job_id uuid, p_user_id uuid, p_session_id text, p_owner_approved boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF p_job_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_args' USING ERRCODE = '22023';
  END IF;
  -- The hidden switch, decided for this poster, unless the owner approved
  -- this one job (checkout-nudge-backfill).
  IF NOT coalesce(p_owner_approved, false)
     AND NOT public.feature_enabled_for_user('checkout_nudge', p_user_id) THEN
    RETURN 'switch_off';
  END IF;
  -- Only the poster's own open job that was never paid: "finish posting"
  -- must be true when it lands.
  IF NOT EXISTS (
    SELECT 1 FROM public.jobs j
     WHERE j.id = p_job_id
       AND j.customer_id = p_user_id
       AND j.status = 'open'
       AND coalesce(j.payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'failed')
  ) THEN
    RETURN 'not_nudgeable';
  END IF;
  INSERT INTO public.job_checkout_nudges (job_id, user_id, stripe_session_id)
  VALUES (p_job_id, p_user_id, p_session_id)
  ON CONFLICT (job_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;
  RETURN 'claimed';
END;
$fn$;
REVOKE ALL ON FUNCTION public.claim_checkout_nudge(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_checkout_nudge(uuid, uuid, text, boolean) TO service_role;

COMMENT ON FUNCTION public.claim_checkout_nudge(uuid, uuid, text, boolean) IS
  'Abandoned-checkout nudge: claims ONE job for the "Finish posting your job" notice. Answers switch_off, not_nudgeable, duplicate or claimed (row written; send now). p_owner_approved skips the checkout_nudge switch (checkout-nudge-backfill, one owner-approved job). service_role only.';
