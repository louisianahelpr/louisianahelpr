-- App Review sees no seed or test data, like an ordinary member (lead 2026-11-01).
--
-- The App Review demo account is a test account (test_accounts + is_seed
-- profile) so its own data stays isolated: Stripe TEST mode, out of stats,
-- alerts and reminders, and its posts hidden from real members. But the seed
-- visibility helpers also WAIVE hiding for any is_seed test account, so App
-- Review was shown other test data: on 2026-11-01 open_jobs_browse gave the
-- reviewer 4 open jobs, 3 of them test jobs ("[E2E DO NOT ACCEPT] ...",
-- "SEED Deep clean a kitchen", "Prod audit funded fixture"), where a guest saw 1.
--
-- A public.store_review_accounts member (20261101154236) now gets no waiver:
-- for them each helper answers exactly as for an ordinary member. Nothing else
-- changes: their own rows stay is_seed (hidden from real members), and every
-- reader keeps its owner exception (seller_id / customer_id / reviewer_id /
-- p.user_id = auth.uid()), so the reviewer still sees its own posts.
--
-- Restated from the newest CREATE of each (20261007033530_seed_switch_hides_test_profiles.sql)
-- with only the store_review_accounts clause added. Grants restated as there.
-- seed_review_hidden calls seed_hidden_from_caller, so it follows unchanged.
-- Replay-safe: CREATE OR REPLACE; grants by role name.

CREATE OR REPLACE FUNCTION public.seed_hidden_for(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- TRUE = the launch switch hides test (is_seed) rows from this user. False
  -- while the switch is off and for a test account, except a store review
  -- account (App Review), which is hidden from like the public. A NULL user
  -- (anon, a server call with no JWT) is hidden from, like the public.
  SELECT public.seed_jobs_hidden_publicly()
     AND (
       EXISTS (SELECT 1 FROM public.store_review_accounts r WHERE r.user_id = p_user_id)
       OR NOT EXISTS (
         SELECT 1 FROM public.profiles me
          WHERE me.user_id = p_user_id AND me.is_seed IS TRUE
            AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = me.user_id)
       )
     );
$function$;

-- No client may call it: it would answer "is this uuid a test account".
REVOKE ALL ON FUNCTION public.seed_hidden_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_hidden_for(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.seed_hidden_in_discovery()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Discovery hides test rows from admins too (the owner browses as an admin
  -- and must see what the public sees); only a test account keeps them, and
  -- not a store review account (App Review sees what the public sees).
  -- (seed_hidden_for's body for the caller, written out so the switch is
  -- asked directly: showSeedJobs.parity.test.ts allows one `via` hop.)
  SELECT public.seed_jobs_hidden_publicly()
     AND (
       EXISTS (SELECT 1 FROM public.store_review_accounts r WHERE r.user_id = (SELECT auth.uid()))
       OR NOT EXISTS (
         SELECT 1 FROM public.profiles me
          WHERE me.user_id = (SELECT auth.uid()) AND me.is_seed IS TRUE
            AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = me.user_id)
       )
     );
$function$;

REVOKE ALL ON FUNCTION public.seed_hidden_in_discovery() FROM PUBLIC, anon, authenticated;
-- anon and authenticated NEED it: open_jobs_browse (security_invoker = false)
-- reads tables as its owner, but Postgres checks EXECUTE on a function a view
-- calls against the CALLER. It answers only "does the switch hide test rows from ME".
GRANT EXECUTE ON FUNCTION public.seed_hidden_in_discovery() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.seed_hidden_from_caller()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- A KNOWN counterpart (profile row, stats, review): hidden like discovery,
  -- except from an admin. A store review account gets neither waiver.
  SELECT public.seed_jobs_hidden_publicly()
     AND (
       EXISTS (SELECT 1 FROM public.store_review_accounts r WHERE r.user_id = (SELECT auth.uid()))
       OR (
         NOT EXISTS (
           SELECT 1 FROM public.profiles me
            WHERE me.user_id = (SELECT auth.uid()) AND me.is_seed IS TRUE
              AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = me.user_id)
         )
         AND NOT COALESCE(public.has_role((SELECT auth.uid()), 'admin'::app_role), false)
       )
     );
$function$;

REVOKE ALL ON FUNCTION public.seed_hidden_from_caller() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_hidden_from_caller() TO service_role;
