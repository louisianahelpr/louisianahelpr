-- Nobody could be hired. Two gates, one question, two different columns.
--
-- Found by an external end-to-end review, 2026-09-06, with a real click:
-- Applicants -> Hire -> Send Offer returned 400 P0001 helper_identity_unverified
-- on a helper who had COMPLETED the app's own ID check. Measured against prod
-- the same day:
--
--     idv_status = 'verified'                             13
--     stripe_identity_verified IS TRUE                      4
--     verified by the app's check but NOT hirable          10
--
-- Ten of thirteen people who finished identity verification could not be hired,
-- and the marketplace's core transaction could not complete for them.
--
-- ── The two verdicts ────────────────────────────────────────────────────────
--
--   idv_status                 written by stripe-idv-webhook. STRIPE IDENTITY:
--                              the government-ID photo + selfie check the app
--                              actually puts in front of people. This is the
--                              one a user can complete.
--   stripe_identity_verified   written by the account.updated webhook and
--                              stripe-connect `status`, from
--                              stripeIdentityVerified(account). STRIPE CONNECT:
--                              a verdict about the payout account.
--
-- Everything else in the app already reads the first one. The jobs INSERT
-- policy gates posting on `idv_status = 'verified'` (20260829033542). The
-- `is_id_verified` flag behind the green "ID verified by Stripe" badge on the
-- applicant card is `(p.idv_status = 'verified')` (20260901022522). Only
-- helper_award_block_reason() read the second — so the badge said verified, the
-- Hire button dropped its warning, and the server refused the hire anyway.
--
-- ── Why the union, and why this is not a weakening ──────────────────────────
--
-- _shared/stripeIdentity.ts is careful and correct about what it computes, and
-- its strictness is kept: it deliberately counts `eventually_due` as blocking
-- because a US individual account still owing `individual.ssn_last_4` has had,
-- at most, a KEYED name/DOB/address match run against it — and that module says
-- in as many words that a keyed match "is not a checked identity".
--
-- Stripe Identity IS a checked identity: a document and a live selfie. So
-- admitting `idv_status = 'verified'` admits people who passed the STRONGER
-- check. The bug was never that the Connect rule is too strict; it is that a
-- rule written to back a BADGE about a payout account was doing duty as the
-- gate on hiring, where the question is "do we know who this person is".
--
-- Note also the ordering inside the function: payout readiness is already
-- required one step earlier (`stripe_payouts_enabled`). The identity step was
-- then demanding Connect's identity verdict ON TOP of enabled payouts, which is
-- how a helper ended up held by a field Stripe was not yet demanding of them.
--
-- UNION, not replacement. Measured before writing this: 1 profile carries
-- `stripe_identity_verified` WITHOUT `idv_status = 'verified'`. Dropping the
-- old branch would have made that person unhirable — trading ten broken
-- accounts for one. Nobody who passes today stops passing.
--
-- ── Second effect, same root cause ──────────────────────────────────────────
--
-- get_user_credential_tier() awarded tier 1 on
-- `stripe_identity_verified OR id_verification_status = 'verified'` — the
-- Connect verdict and a legacy column, with the live one absent. 4 profiles are
-- idv-verified and still tier 0, permanently hidden from every credential-gated
-- job. Same union applied. `id_verification_status` is KEPT: 8 rows carry it
-- alongside idv_status and it costs nothing to honour.
--
-- Not addressed here, deliberately: four columns still track this one fact
-- (idv_status, stripe_identity_verified, id_verification_status,
-- stripe_identity_verified_at). Collapsing them is a data-model change with its
-- own backfill and blast radius; this migration makes the gates agree, which is
-- what unblocks the marketplace. The consolidation is filed separately.

-- ── 1. The hiring gate ──────────────────────────────────────────────────────
-- Body carried over verbatim from the live definition (read from
-- pg_get_functiondef 2026-09-06) except for the identity test, so that the
-- seed-data escape, the payout check, the operator kill switch and their
-- fail-closed semantics are all preserved exactly.
CREATE OR REPLACE FUNCTION public.helper_award_block_reason(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_acct     text;
  v_payouts  boolean;
  v_identity boolean;
  v_idv      text;
  v_seed     boolean;
  v_paused   boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'helper_unknown';
  END IF;

  SELECT p.stripe_account_id, p.stripe_payouts_enabled, p.stripe_identity_verified,
         p.idv_status, p.is_seed
    INTO v_acct, v_payouts, v_identity, v_idv, v_seed
  FROM public.profiles p
  WHERE p.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN 'helper_unknown';
  END IF;

  -- Fixture data stays usable — but ONLY while it is actually fixture-shaped.
  -- A profile holding a real Connect account is judged on Stripe's answer no
  -- matter what its seed flag says.
  IF v_seed IS TRUE AND v_acct IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_acct IS NULL OR v_payouts IS NOT TRUE THEN
    RETURN 'helper_payout_setup_incomplete';
  END IF;

  -- Operator kill switch — the same flag the client honours
  -- (feature_flags.idv_requirement_paused, Admin -> Settings) so a Stripe
  -- Identity outage cannot freeze the whole marketplace. Fails CLOSED: a
  -- missing row or missing key leaves the identity requirement in force.
  SELECT COALESCE((s.feature_flags ->> 'idv_requirement_paused')::boolean, false)
    INTO v_paused
  FROM public.platform_settings s
  LIMIT 1;

  -- EITHER verdict clears this. See the header: idv_status is the check a user
  -- can actually complete, and it is the stronger of the two.
  IF v_identity IS NOT TRUE
     AND v_idv IS DISTINCT FROM 'verified'
     AND COALESCE(v_paused, false) IS NOT TRUE THEN
    RETURN 'helper_identity_unverified';
  END IF;

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.helper_award_block_reason(uuid) IS
  'Why this helper cannot be awarded a job, or NULL if they can. Identity is satisfied by EITHER Stripe Identity (profiles.idv_status = ''verified'', the check the app puts in front of users) OR the Stripe Connect identity verdict (profiles.stripe_identity_verified). Reading only the latter made 10 of 13 ID-verified users unhirable while the UI showed them a green verified badge.';

-- ── 2. The credential tier ──────────────────────────────────────────────────
-- Carried over verbatim except `prof_identity`.
CREATE OR REPLACE FUNCTION public.get_user_credential_tier(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET "TimeZone" TO 'America/Chicago'
AS $function$
  WITH src AS (
    SELECT
      -- Admin-reviewed via review_credential(); pinned by prevent_self_escalation().
      -- A NULL expiry earns nothing here.
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.user_id = p_user_id
          AND p.license_status = 'verified'
          AND p.license_expires_at IS NOT NULL
          AND p.license_expires_at > current_date
      ) AS prof_licensed,
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.user_id = p_user_id
          AND p.insurance_status = 'verified'
          AND p.insurance_expires_at IS NOT NULL
          AND p.insurance_expires_at > current_date
      ) AS prof_insured,
      -- idv_status added 2026-09-06: without it a helper who completed Stripe
      -- Identity stayed tier 0 and was hidden from every credential-gated job.
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.user_id = p_user_id
          AND (p.stripe_identity_verified
               OR p.id_verification_status = 'verified'
               OR p.idv_status = 'verified')
      ) AS prof_identity,
      -- Vendor-verified via sync_credential_from_check().
      EXISTS (
        SELECT 1 FROM helper_credentials hc
        WHERE hc.user_id = p_user_id
          AND hc.credential_type = 'trade_license'
          AND hc.status = 'verified'
          AND (hc.expiration_date IS NULL OR hc.expiration_date > now())
      ) AS cred_licensed,
      EXISTS (
        SELECT 1 FROM helper_credentials hc
        WHERE hc.user_id = p_user_id
          AND hc.credential_type IN ('insurance','bond')
          AND hc.status = 'verified'
          AND (hc.expiration_date IS NULL OR hc.expiration_date > now())
      ) AS cred_insured,
      EXISTS (
        SELECT 1 FROM helper_credentials hc
        WHERE hc.user_id = p_user_id
          AND hc.credential_type = 'identity'
          AND hc.status = 'verified'
      ) AS cred_identity
  )
  SELECT CASE
    WHEN (prof_licensed OR cred_licensed) AND (prof_insured OR cred_insured) THEN 3
    WHEN (prof_licensed OR cred_licensed)                                    THEN 2
    WHEN (prof_identity OR cred_identity)                                    THEN 1
    ELSE 0
  END
  FROM src;
$function$;

COMMENT ON FUNCTION public.get_user_credential_tier(uuid) IS
  'Credential tier 0-3. Tier 1 (identity) is satisfied by Stripe Connect''s verdict, the legacy id_verification_status, OR Stripe Identity (idv_status) — the last was missing, leaving genuinely ID-verified helpers at tier 0 and hidden from credential-gated jobs.';

-- Grants are NOT inherited by CREATE OR REPLACE, but Supabase's
-- ALTER DEFAULT PRIVILEGES grants EXECUTE on every new public function to anon,
-- authenticated AND service_role individually. REVOKE ... FROM PUBLIC does not
-- touch those, so name the roles explicitly — see CLAUDE.md.
REVOKE ALL ON FUNCTION public.helper_award_block_reason(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helper_award_block_reason(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_user_credential_tier(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_credential_tier(uuid) TO authenticated, service_role;
