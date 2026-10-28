-- Named accounts a 'testers' switch is also on for (owner 2026-10-28, pop-up via the lead: "open declutter for
-- lexilombas05@gmail and ben lombas. we will be testing it today"; picked "Per-person list": real money through
-- live Stripe, not test accounts).
--
-- Why not test_accounts: a test account pays through Stripe TEST mode (supabase/functions/_shared/stripeMode.ts),
-- and a job or sale pairing a test account with a real one is refused (mixed_parties). Why not admin: an admin sees
-- the whole Admin area. A member on this list sees a 'testers' switch's feature exactly as a tester does, and
-- nothing else changes for them: Stripe mode, admin rights and every other switch stay as they were.
--
-- feature_enabled_for_user is the one decision point (feature_enabled_for, require_feature, feature_switches_for_me
-- and the edge functions' requireFeature all go through it), so the list reaches the app, the RPCs and the edge
-- functions at once. 'off' stays off for everyone on the list; 'everyone' is unchanged.
--
-- No client role reads or writes the list: RLS on with no policy, service_role only (as feature_switches).
-- A member's rows go with their account (ON DELETE CASCADE). It holds no member data beyond the enrolment itself.
-- Replay-safe: IF NOT EXISTS / OR REPLACE / ON CONFLICT DO NOTHING.

CREATE TABLE IF NOT EXISTS public.feature_switch_members (
  key text NOT NULL REFERENCES public.feature_switches(key) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, user_id)
);

CREATE INDEX IF NOT EXISTS feature_switch_members_user_id_idx ON public.feature_switch_members (user_id);

ALTER TABLE public.feature_switch_members ENABLE ROW LEVEL SECURITY;
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
REVOKE ALL ON TABLE public.feature_switch_members FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.feature_switch_members TO service_role;

COMMENT ON TABLE public.feature_switch_members IS
  'Named accounts a testers-audience switch is also on for (owner 2026-10-28). Read only by '
  'feature_enabled_for_user(); service_role only. Unlike test_accounts it changes nothing about Stripe mode.';

CREATE OR REPLACE FUNCTION public.feature_enabled_for_user(p_key text, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT CASE s.audience
             WHEN 'everyone' THEN true
             WHEN 'testers' THEN
               COALESCE(public.has_role(p_user_id, 'admin'::app_role), false)
               OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_user_id)
               OR EXISTS (SELECT 1 FROM public.feature_switch_members m WHERE m.key = s.key AND m.user_id = p_user_id)
             ELSE false
           END
      FROM public.feature_switches s
     WHERE s.key = p_key
       AND p_user_id IS NOT NULL
  ), false);
$function$;

REVOKE ALL ON FUNCTION public.feature_enabled_for_user(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feature_enabled_for_user(text, uuid) TO service_role;

COMMENT ON FUNCTION public.feature_enabled_for_user(text, uuid) IS
  'Hidden feature switch decision for a named user (service_role only: edge functions pass '
  'their verified caller). testers = admins, test_accounts and feature_switch_members for that key. '
  'Missing key, unknown audience or null user -> false.';

-- Today's enrolment: every Declutter switch for the owner and Ben Lombas. Matched by e-mail so a database without
-- these accounts (PGlite, a fresh project) inserts nothing.
INSERT INTO public.feature_switch_members (key, user_id, note)
SELECT s.key, u.id, 'owner 2026-10-28: Declutter test with real payments'
  FROM public.feature_switches s
  CROSS JOIN auth.users u
 WHERE s.key LIKE 'declutter%'
   AND lower(u.email) IN ('lexilombas05@gmail.com', 'rentsdue01@yahoo.com')
ON CONFLICT DO NOTHING;
