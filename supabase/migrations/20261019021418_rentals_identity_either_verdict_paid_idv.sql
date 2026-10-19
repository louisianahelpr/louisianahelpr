-- Rentals identity gate: EITHER verdict, in ONE helper; and the ledger for the
-- ID check a landlord pays for themselves.
--
-- THE BUG (owner hit it 2026-10-19). rentals_create_property and
-- rentals_invite_tenant refused with identity_not_verified unless
-- profiles.idv_status = 'verified' (Stripe Identity). No screen has launched
-- Stripe Identity since 2026-10-01 (20261001222911; the upload card in
-- ProfileEditForm was removed), so no landlord could ever pass — including the
-- owner, whose profile carries the Stripe Connect identity verdict
-- (stripe_identity_verified = true, the "Stripe ID verified" badge) next to a
-- legacy idv_status = 'pending'.
--
-- OWNER DECISION (2026-10-19 pop-up): "BOTH WAYS, BUT THEY HAVE TO PAY FOR
-- THEIR OWN ID".
--   1. Identity is satisfied by EITHER Stripe Identity (idv_status =
--      'verified') OR the Stripe Connect identity verdict
--      (stripe_identity_verified), the rule helper_award_block_reason and
--      src/lib/awardGate.ts isIdentityVerified already use (20260907013734).
--      It lives in ONE helper, public.is_identity_verified(uuid) (a lookup
--      over the existing verdict predicate identity_is_verified(text, boolean)),
--      and every
--      rentals RPC that raises identity_not_verified calls it
--      (src/test/rentalsIdentityGateUsesHelper.test.ts fails on one that reads
--      idv_status itself).
--   2. A landlord with neither pays for a Stripe Identity check (cost + card
--      fee, _shared/idvFee.ts). public.idv_fee_payments is the ledger: one
--      webhook-confirmed payment buys one VerificationSession
--      (stripe-idv-start creates it only from a 'paid' row).
--
-- Replay-safe: CREATE OR REPLACE / IF NOT EXISTS / DROP POLICY IF EXISTS.

-- ---------------------------------------------------------------------------
-- 1. The rule.
CREATE OR REPLACE FUNCTION public.is_identity_verified(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- The verdict itself is THE predicate public.identity_is_verified(text, boolean)
  -- (20260907062224 / 20260923123701), which get_safe_profiles and the shop
  -- badge already read; this only looks the user's two columns up.
  SELECT COALESCE((
    SELECT public.identity_is_verified(p.idv_status, p.stripe_identity_verified)
      FROM public.profiles p
     WHERE p.user_id = p_user_id
  ), false);
$fn$;
COMMENT ON FUNCTION public.is_identity_verified(uuid) IS
  'THE identity rule for rentals gates: Stripe Identity (profiles.idv_status = ''verified'') OR the Stripe Connect identity verdict (profiles.stripe_identity_verified). Same rule as helper_award_block_reason and src/lib/awardGate.ts isIdentityVerified. Owner 2026-10-19: "BOTH WAYS".';
-- Called only from SECURITY DEFINER RPCs (they run as the owner); no client
-- needs to ask it about an arbitrary user id.
REVOKE ALL ON FUNCTION public.is_identity_verified(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_identity_verified(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The two rentals gates, unchanged except the identity line.
CREATE OR REPLACE FUNCTION public.rentals_create_property(p_label text, p_street_address text, p_city text, p_zip_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  IF NOT public.is_identity_verified(v_uid) THEN
    RAISE EXCEPTION 'identity_not_verified' USING ERRCODE = '42501';
  END IF;
  -- Serialize the cap per owner (a parallel burst cannot pass the count together).
  PERFORM pg_advisory_xact_lock(hashtext('rentals_property:' || v_uid::text));
  IF (SELECT count(*) FROM public.rental_properties WHERE owner_id = v_uid) >= 50 THEN
    RAISE EXCEPTION 'too_many_properties' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.rental_properties (owner_id, label, street_address, city, zip_code)
  VALUES (v_uid, btrim(p_label), btrim(p_street_address), btrim(p_city), btrim(p_zip_code))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_create_property(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_create_property(text, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_invite_tenant(p_unit_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_prop uuid;
  v_status text;
  v_token text;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT u.property_id, p.ownership_status INTO v_prop, v_status
    FROM public.rental_units u JOIN public.rental_properties p ON p.id = u.property_id
   WHERE u.id = p_unit_id AND p.owner_id = v_uid
   FOR UPDATE OF p;  -- serializes the open-invite cap below
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unit_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Q5 holds for as long as they invite, not only at creation (review #8).
  IF NOT public.is_identity_verified(v_uid) THEN
    RAISE EXCEPTION 'identity_not_verified' USING ERRCODE = '42501';
  END IF;
  IF v_status <> 'approved' THEN
    RAISE EXCEPTION 'ownership_not_approved' USING ERRCODE = '42501';
  END IF;
  -- Open invites per unit are capped so a link cannot be farmed.
  IF (SELECT count(*) FROM public.rental_tenancies
       WHERE unit_id = p_unit_id AND status = 'invited' AND invite_expires_at > now()) >= 10 THEN
    RAISE EXCEPTION 'too_many_open_invites' USING ERRCODE = '22023';
  END IF;
  -- Two v4 UUIDs (gen_random_uuid draws from the CSPRNG): 244 random bits.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.rental_tenancies (unit_id, property_id, landlord_id, invite_token_sha256, invite_expires_at)
  VALUES (p_unit_id, v_prop, v_uid, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), now() + interval '14 days');
  RETURN v_token;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_invite_tenant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_invite_tenant(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The paid ID check ledger. Written ONLY by service_role (stripe-idv-start
--    creates the row with the Checkout; stripe-webhook marks it paid;
--    stripe-idv-start / stripe-idv-webhook move it on). The owner reads their
--    own rows so Homes can say "payment received, start your ID check".
--
--    awaiting_payment -> paid            checkout.session.completed (payment_status = 'paid')
--    paid             -> starting        stripe-idv-start CLAIMED it (only the claimer calls Stripe)
--    starting         -> session_started stripe-idv-start created THE one VerificationSession
--    starting         -> refunded        stripe-idv-start could not create it (our mistake: full refund)
--    paid             -> refunded        stripe-webhook: paid while already verified / already holding a check
--    session_started  -> used            stripe-idv-webhook: the check completed (verified, or failed: pay again)
CREATE TABLE IF NOT EXISTS public.idv_fee_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_checkout_session_id text NOT NULL,
  stripe_payment_intent_id text,
  amount_cents integer NOT NULL,
  stripe_livemode boolean NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_payment',
  stripe_verification_session_id text,
  stripe_refund_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idv_fee_payments_checkout_session_key UNIQUE (stripe_checkout_session_id),
  CONSTRAINT idv_fee_payments_verification_session_key UNIQUE (stripe_verification_session_id),
  CONSTRAINT idv_fee_payments_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT idv_fee_payments_status_check CHECK (status IN ('awaiting_payment', 'paid', 'starting', 'session_started', 'used', 'refunded')),
  CONSTRAINT idv_fee_payments_session_needs_paid CHECK (stripe_verification_session_id IS NULL OR status IN ('session_started', 'used', 'refunded'))
);
COMMENT ON TABLE public.idv_fee_payments IS
  'One row per Stripe Checkout a user opened to pay for their own Stripe Identity check (owner 2026-10-19: "they have to pay for their own ID"). One paid row buys exactly one VerificationSession. service_role writes only.';

-- Covers the user_id foreign key and stripe-idv-start's "my newest live row" read.
CREATE INDEX IF NOT EXISTS idv_fee_payments_user_created_idx
  ON public.idv_fee_payments (user_id, created_at DESC);

ALTER TABLE public.idv_fee_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS idv_fee_payments_select_own ON public.idv_fee_payments;
CREATE POLICY idv_fee_payments_select_own ON public.idv_fee_payments
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON TABLE public.idv_fee_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.idv_fee_payments TO authenticated;
GRANT ALL ON TABLE public.idv_fee_payments TO service_role;

-- Q807: every public table carries the unconfirmed-email statement gate.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
