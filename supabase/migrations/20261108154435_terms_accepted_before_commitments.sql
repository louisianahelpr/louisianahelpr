-- The server refuses a money or commitment action from a member who has not
-- accepted the current Terms of Service (owner-approved, 2026-11-08).
--
-- Until now only the app asked: TermsReconsentMount opens the re-agree dialog
-- when profiles.terms_version_accepted is behind LATEST_TERMS_VERSION
-- (src/lib/consent.ts). Nothing on the server checked, so an old app build, a
-- closed dialog chunk or a direct API call could post a job, hire, list, buy
-- or cash out on Terms the member never agreed to.
--
-- What this adds:
--   * public.current_terms_version(): the server's copy of the live Terms
--     version. It must equal LATEST_TERMS_VERSION and LEGAL_TERMS_VERSION;
--     src/test/termsAcceptedBeforeCommitments.test.ts fails when they differ,
--     so a Terms bump redefines this function in the same change.
--   * public.terms_accepted_is_current(user): true when the member's accepted
--     version is the current one or NEWER (the same rule as the app's
--     termsAcceptanceIsCurrent; the 20261017115618 trigger keeps the
--     newer one). For the edge functions, which write as the service role and
--     so have no auth.uid(): granted to service_role only
--     (supabase/functions/_shared/requireCurrentTerms.ts).
--   * tr_require_current_terms, BEFORE INSERT on the tables a commitment
--     creates (a job, an application, a Declutter listing, offer, swap offer
--     or order, a shop order, an instant payout) and BEFORE UPDATE on
--     applications when one becomes 'accepted' (a hire, in accept_application
--     and accept_group_application). It reads the ACTING member, auth.uid(),
--     so it covers a direct table write and every SECURITY DEFINER RPC alike.
--     It raises 'terms_not_accepted' (42501, PostgREST answers 403); the app
--     catches that (src/lib/termsGate.ts), opens the re-agree dialog and
--     sends the same request again once the member agrees.
--
-- Not blocked: no caller (auth.uid() NULL: cron, webhooks, edge functions
-- writing as the service role, which check for themselves); every read;
-- sign-in; accepting the Terms (an UPDATE of profiles, not a guarded table);
-- account deletion and every cancel, decline or withdraw (none INSERTs into
-- these tables or makes an application 'accepted').
--
-- Measured on prod 2026-11-08 (read-only): 283 active confirmed members hold
-- "Oct 2026" (the current version) and are unaffected. 5 active confirmed
-- accounts hold '' (never accepted: signups that never finished, one a test
-- account); they see the dialog before their first commitment.

-- STABLE, not IMMUTABLE: an IMMUTABLE call can be folded into a cached plan
-- and keep answering the old version after a bump redefines it.
CREATE OR REPLACE FUNCTION public.current_terms_version()
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO public, pg_temp
AS $fn$
  SELECT 'Oct 2026'::text
$fn$;

REVOKE ALL ON FUNCTION public.current_terms_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_terms_version() TO service_role;

-- "Oct 2026" -> 202610; NULL for anything that is not "Mon YYYY" (the same
-- ranking as the 20261017115618 trigger and src/lib/consent.ts).
CREATE OR REPLACE FUNCTION public.terms_version_rank(p_version text)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path TO public, pg_temp
AS $fn$
  SELECT CASE
    WHEN m IS NULL OR array_position(ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], m[1]) IS NULL THEN NULL
    ELSE m[2]::int * 100 + array_position(ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], m[1])
  END
  FROM (SELECT regexp_match(btrim(coalesce(p_version, '')), '^([A-Z][a-z]{2}) ([0-9]{4})$') AS m) r
$fn$;

REVOKE ALL ON FUNCTION public.terms_version_rank(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.terms_version_rank(text) TO service_role;

CREATE OR REPLACE FUNCTION public.terms_accepted_is_current(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $fn$
  SELECT coalesce((
    SELECT p.terms_version_accepted = public.current_terms_version()
        OR coalesce(public.terms_version_rank(p.terms_version_accepted) >= public.terms_version_rank(public.current_terms_version()), false)
      FROM public.profiles p
     WHERE p.user_id = p_user_id
  ), false)
$fn$;

REVOKE ALL ON FUNCTION public.terms_accepted_is_current(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.terms_accepted_is_current(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.require_current_terms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- A trusted server write (cron, webhooks, service-role edge writes) has no member to check. A bare NULL uid is
  -- not one: anon has a NULL uid too (20260915101102), and falls through to the check, which is false for NULL.
  IF v_uid IS NULL AND public.is_server_context() THEN
    RETURN NEW;
  END IF;
  IF NOT public.terms_accepted_is_current(v_uid) THEN
    RAISE EXCEPTION 'terms_not_accepted'
      USING ERRCODE = '42501',
            DETAIL = public.current_terms_version(),
            HINT = 'Agree to the current Terms of Service, then try again.';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.require_current_terms() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_require_current_terms ON public.jobs;
CREATE TRIGGER tr_require_current_terms
  BEFORE INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.require_current_terms();

DROP TRIGGER IF EXISTS tr_require_current_terms ON public.applications;
CREATE TRIGGER tr_require_current_terms
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.require_current_terms();

DROP TRIGGER IF EXISTS tr_require_current_terms_on_hire ON public.applications;
CREATE TRIGGER tr_require_current_terms_on_hire
  BEFORE UPDATE OF status ON public.applications
  FOR EACH ROW
  WHEN (NEW.status::text = 'accepted' AND OLD.status::text IS DISTINCT FROM 'accepted')
  EXECUTE FUNCTION public.require_current_terms();

DROP TRIGGER IF EXISTS tr_require_current_terms ON public.declutter_items;
CREATE TRIGGER tr_require_current_terms
  BEFORE INSERT ON public.declutter_items
  FOR EACH ROW EXECUTE FUNCTION public.require_current_terms();

DROP TRIGGER IF EXISTS tr_require_current_terms ON public.declutter_offers;
CREATE TRIGGER tr_require_current_terms
  BEFORE INSERT ON public.declutter_offers
  FOR EACH ROW EXECUTE FUNCTION public.require_current_terms();

DROP TRIGGER IF EXISTS tr_require_current_terms ON public.declutter_swap_offers;
CREATE TRIGGER tr_require_current_terms
  BEFORE INSERT ON public.declutter_swap_offers
  FOR EACH ROW EXECUTE FUNCTION public.require_current_terms();

DROP TRIGGER IF EXISTS tr_require_current_terms ON public.declutter_orders;
CREATE TRIGGER tr_require_current_terms
  BEFORE INSERT ON public.declutter_orders
  FOR EACH ROW EXECUTE FUNCTION public.require_current_terms();

DROP TRIGGER IF EXISTS tr_require_current_terms ON public.shop_orders;
CREATE TRIGGER tr_require_current_terms
  BEFORE INSERT ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.require_current_terms();

DROP TRIGGER IF EXISTS tr_require_current_terms ON public.instant_payouts;
CREATE TRIGGER tr_require_current_terms
  BEFORE INSERT ON public.instant_payouts
  FOR EACH ROW EXECUTE FUNCTION public.require_current_terms();
