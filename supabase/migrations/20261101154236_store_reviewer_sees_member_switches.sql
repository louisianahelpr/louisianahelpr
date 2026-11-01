-- App Review sees only what ordinary members see (lead 2026-11-01, App Store submission).
--
-- The App Review demo account (apple-reviewer@louisianahelpr.com) is in
-- public.test_accounts, which keeps its data isolated (Stripe TEST mode,
-- excluded from stats, alerts and reminders). But feature_enabled_for_user()
-- also treats every test_accounts row as a tester, so App Review was shown
-- every testers-only switch (quotes, declutter_shipping, refund_requests,
-- suggest_category, ...): unfinished features no member sees, a 2.1 risk.
--
-- public.store_review_accounts names accounts that keep test_accounts'
-- isolation but get ONLY switches open to everyone: for them a 'testers'
-- switch is off, whatever admin role, test_accounts or feature_switch_members
-- row they have. Every switch read (useFeature via feature_switches_for_me /
-- feature_enabled_for, require_feature in RPCs, requireFeature in edge
-- functions) goes through feature_enabled_for_user, so this one change covers
-- the client and both server halves.
--
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT DO NOTHING;
-- grants restated by role name. The enrolment matches by e-mail, so a database
-- without the account (PGlite, a fresh project) inserts nothing.

CREATE TABLE IF NOT EXISTS public.store_review_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.store_review_accounts ENABLE ROW LEVEL SECURITY;
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
REVOKE ALL ON TABLE public.store_review_accounts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.store_review_accounts TO service_role;

COMMENT ON TABLE public.store_review_accounts IS
  'App Store / Play review accounts (lead 2026-11-01): they keep test_accounts isolation but '
  'feature_enabled_for_user() gives them only switches open to everyone. service_role only.';

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
               NOT EXISTS (SELECT 1 FROM public.store_review_accounts r WHERE r.user_id = p_user_id)
               AND (
                 COALESCE(public.has_role(p_user_id, 'admin'::app_role), false)
                 OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_user_id)
                 OR EXISTS (SELECT 1 FROM public.feature_switch_members m WHERE m.key = s.key AND m.user_id = p_user_id)
               )
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
  'their verified caller). testers = admins, test_accounts and feature_switch_members for that key, '
  'except store_review_accounts, which get only switches open to everyone. '
  'Missing key, unknown audience or null user -> false.';

INSERT INTO public.store_review_accounts (user_id, note)
SELECT u.id, 'lead 2026-11-01: App Review sees only what members see'
  FROM auth.users u
 WHERE lower(u.email) = 'apple-reviewer@louisianahelpr.com'
ON CONFLICT (user_id) DO NOTHING;
