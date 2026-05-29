-- Restore explicit EXECUTE on every public.<rpc>(...) called directly
-- from React client code via supabase.rpc("<rpc>"). Same regression shape
-- as PR #355 (has_role) and PR #358 (jobs RLS helpers) — the originating
-- CREATE FUNCTION migrations relied on the default PUBLIC EXECUTE that a
-- Supabase advisor pass later stripped in production. This migration
-- inoculates every remaining client-callable RPC against the same trap.
--
-- Detected live, 2026-05-29: signed-in dashboard renders ErrorState
-- across BrowseTasks + Activity + Messages + Profile (stats/reviews) even
-- after PR #355 + #358 were applied to prod. Root cause traced to
-- get_safe_profiles being the high-reach culprit (15 client call sites
-- across reviews, message thread author hydration, helper profile cards).
--
-- All grants are to `authenticated` only — every call site is reached
-- post-auth (Signup.tsx calls process_referral + get_pending_invite_for_email
-- *after* the new account is created, so the JWT role is already
-- `authenticated`). Granting to `anon` would widen the exposure surface
-- without unlocking a real call site.
--
-- Source: docs/rls-grant-audit-2026-05-28.md (PR #361) — bulk-fix body
-- proposed by the RLS audit pass, with one-to-one fidelity to the
-- audit's recommendations.
--
-- Idempotent and replay-safe: every grant guarded by to_regprocedure so
-- a from-scratch rebuild that runs this before the originating CREATE
-- statements is a harmless skip rather than an aborting error. Re-runs
-- after the grants are in place are no-ops.

DO $$
BEGIN
  -- High-reach: every signed-in profile/review/message surface.
  IF to_regprocedure('public.get_safe_profiles(uuid[])') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_safe_profiles(uuid[]) TO authenticated;
  END IF;

  -- High-reach: blocked-user safety check; silent failure = security regression.
  IF to_regprocedure('public.are_users_blocked(uuid, uuid)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.are_users_blocked(uuid, uuid) TO authenticated;
  END IF;

  -- Profile-edit ZIP→parish autofill.
  IF to_regprocedure('public.get_parish_for_zip(text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_parish_for_zip(text) TO authenticated;
  END IF;

  -- Post-job "helpers active in your parish" social proof.
  IF to_regprocedure('public.get_parish_activity(integer)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_parish_activity(integer) TO authenticated;
  END IF;

  -- Business profile verification-status card.
  IF to_regprocedure('public.get_my_business_verification()') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_my_business_verification() TO authenticated;
  END IF;

  -- Signup: auto-accept pending business invite for the new user's email.
  IF to_regprocedure('public.get_pending_invite_for_email(text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_pending_invite_for_email(text) TO authenticated;
  END IF;

  -- Signup: apply a referral code.
  IF to_regprocedure('public.process_referral(text, uuid)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.process_referral(text, uuid) TO authenticated;
  END IF;

  -- Helper-only: CSV earnings export.
  IF to_regprocedure('public.get_helper_earnings_export(uuid, date, date)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_helper_earnings_export(uuid, date, date) TO authenticated;
  END IF;

  -- Admin review queues — body already gates on has_role(auth.uid(),'admin').
  IF to_regprocedure('public.get_pending_business_verifications()') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_pending_business_verifications() TO authenticated;
  END IF;

  IF to_regprocedure('public.get_pending_credentials()') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_pending_credentials() TO authenticated;
  END IF;

  IF to_regprocedure('public.review_business_verification(uuid, text, text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.review_business_verification(uuid, text, text) TO authenticated;
  END IF;

  IF to_regprocedure('public.review_credential(uuid, text, text, text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.review_credential(uuid, text, text, text) TO authenticated;
  END IF;
END $$;
