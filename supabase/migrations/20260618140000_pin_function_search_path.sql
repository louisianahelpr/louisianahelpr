-- F-SEC-06: pin search_path on SECURITY DEFINER / mutable functions.
--
-- 18 public functions ship with a role-mutable search_path (Supabase advisor
-- WARN function_search_path_mutable). For a SECURITY DEFINER function this is a
-- privilege-escalation vector: the body runs as the owner but resolves
-- unqualified names against the *caller's* search_path, so a caller can shadow
-- public.foo with their own schema. Pin search_path = public so resolution is
-- frozen. Behavior-preserving: every one of these touches only public objects.
--
-- Replay-safe: guard each ALTER on the function existing (to_regprocedure(...)
-- IS NOT NULL) so a from-scratch rebuild that runs this before a later
-- migration (re)defines a function does not abort.

DO $$
DECLARE
  sig text;
  sigs text[] := ARRAY[
    'public.get_platform_impact_stats()',
    'public.get_time_credit_balance(uuid)',
    'public.insert_job_status_system_message()',
    'public.respond_to_review(uuid, text)',
    'public.record_job_view(uuid)',
    'public.get_job_view_counts(uuid[])',
    'public.counter_application_bid(uuid, numeric)',
    'public.respond_to_counter_offer(uuid, boolean)',
    'public.set_available_now(numeric)',
    'public.clear_available_now()',
    'public.apply_to_job(uuid, text, numeric)',
    'public.lock_applications_owner_columns()',
    'public.get_user_credential_tier(uuid)',
    'public.endorse_skill(uuid)',
    'public.sync_credential_from_check()',
    'public.get_fill_rate_stats(integer)',
    'public.auto_approve_milestone()',
    'public.get_neighbor_hire_count(uuid, numeric, numeric, numeric)'
  ];
BEGIN
  FOREACH sig IN ARRAY sigs LOOP
    IF to_regprocedure(sig) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public', sig);
    END IF;
  END LOOP;
END;
$$;
