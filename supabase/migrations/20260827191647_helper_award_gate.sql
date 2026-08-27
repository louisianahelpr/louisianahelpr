-- A helper may not be AWARDED work until Stripe can pay them AND Stripe has
-- finished verifying who they are.
--
-- OWNER'S DECISION (2026-08-27): "At acceptance on payout ready and full stripe
-- id bc we are verifying this is the person doing the job but also want their
-- payment info set up." Browsing and APPLYING stay free — the gate sits at the
-- moment a job actually becomes theirs.
--
-- WHY SERVER-SIDE. The only two gates that existed lived in the browser: a
-- Stripe Connect status probe and an `idv_status = 'verified'` check in
-- useOfferHandlers. `idv_status` is the unreviewed upload/admin flag that
-- commit 47eef666 already established means nothing — the owner confirmed
-- nobody looks at those uploads, and 6 prod profiles carry idv_status
-- 'verified' while only 1 has a Stripe account at all. A trust-and-safety
-- control that lives only in the client is not a control. This migration is the
-- real one; the client mirrors it so the blocked state can explain itself.
--
-- WHERE THE ENFORCEMENT SITS. One BEFORE trigger on `jobs`, not four edited RPC
-- bodies. Every door that awards work ends at the same two columns:
--
--   accept_application            → jobs.helper_id := <applicant>
--   accept_group_application      → jobs.helper_id + group_job_helpers INSERT
--   respond_to_direct_offer       → jobs.helper_id + helper_confirmed_at := me
--   instant_book_claim            → jobs.helper_id + helper_confirmed_at := me
--   useOfferHandlers raw UPDATE   → jobs.helper_confirmed_at := now()
--
-- The last one is a plain client `.update()` with no RPC to edit, so per-RPC
-- guards would have left it open. A trigger closes all five at once and cannot
-- be forgotten by the next path someone adds.
--
-- WHO IS EXEMPT, AND WHY. The trigger only judges writes carrying a real
-- end-user session (`auth.uid() IS NOT NULL`). Service-role callers — the
-- expiry cron, payout jobs, admin-user-actions, seeding — are deliberately
-- untouched: none of them is a helper taking a job, and failing them would
-- break unrelated machinery. Seed fixtures (`profiles.is_seed`) are exempt too,
-- since they have no real Stripe account.
--
-- LIVE-DATA WARNING, stated plainly. Today ZERO profiles pass this gate: 23
-- profiles, 2 with a Stripe account, 0 with stripe_identity_verified (which
-- defaults FALSE with no backfill). Until `account.updated` webhooks repopulate
-- it, no helper can be awarded a job. The owner accepted that bar knowingly and
-- the app is pre-launch. It also makes the BLOCKED experience the surface that
-- matters, which is why the reasons below are two distinct codes rather than
-- one boolean: "you have no payout account" and "Stripe hasn't finished
-- verifying you" need different instructions.
--
-- REPLAY-SAFETY: additive columns with IF NOT EXISTS; CREATE OR REPLACE for
-- functions; DROP TRIGGER IF EXISTS before CREATE TRIGGER; the roster trigger
-- is guarded on to_regclass; get_safe_profiles is DROP + CREATE because the
-- RETURNS TABLE shape changes.

-- ── 1. Cache the payout-readiness half of the verdict ───────────────────────
-- `stripe_identity_verified` already implies charges+payouts enabled (see
-- _shared/stripeIdentity.ts), so on its own it cannot tell "no payout account
-- yet" apart from "identity still outstanding". These two columns, written by
-- the same account.updated webhook that already carries the whole account
-- object, are what let the blocked state say something useful. Zero extra
-- Stripe API calls.
-- REPLAY-ORDER GUARD. This migration reads
-- profiles.stripe_identity_verified, but the migration that ADDS that column
-- (20260901010000_stripe_identity_verified_cache.sql) sorts AFTER this one by
-- timestamp. Prod was fine only because that column happened to be applied
-- already; a from-scratch replay ran this first and died with
-- "column p.stripe_identity_verified does not exist", which is what reddened
-- DB Smoke on d7d03b59 and would have reddened the Supabase Preview check on
-- every future migration PR.
--
-- Both statements are `if not exists` and are byte-identical to the ones in
-- the later migration, so whichever runs first creates the columns and the
-- other is a no-op. Renaming this file instead would have desynced prod's
-- schema_migrations ledger from the filenames, which CLAUDE.md forbids.
alter table public.profiles
  add column if not exists stripe_identity_verified boolean not null default false;

alter table public.profiles
  add column if not exists stripe_identity_verified_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_payouts_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.stripe_payouts_enabled IS
  'Mirror of Stripe Connect account.payouts_enabled, cached by the account.updated webhook. Payout READINESS only — it does NOT mean identity was verified (Stripe enables payouts during a grace window and enforces identity later); profiles.stripe_identity_verified is that verdict.';

COMMENT ON COLUMN public.profiles.stripe_charges_enabled IS
  'Mirror of Stripe Connect account.charges_enabled, cached by the account.updated webhook.';

-- ── 2. The single definition of "may this helper be awarded work?" ──────────
-- NULL when they may. Otherwise a stable code the client turns into copy.
-- Order matters: payout setup is the earlier, more actionable failure, so it is
-- reported first when both are missing.
CREATE OR REPLACE FUNCTION public.helper_award_block_reason(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_acct     text;
  v_payouts  boolean;
  v_identity boolean;
  v_seed     boolean;
  v_paused   boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'helper_unknown';
  END IF;

  SELECT p.stripe_account_id, p.stripe_payouts_enabled, p.stripe_identity_verified, p.is_seed
    INTO v_acct, v_payouts, v_identity, v_seed
  FROM public.profiles p
  WHERE p.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN 'helper_unknown';
  END IF;

  -- Fixture data must stay usable; seeded helpers have no real Stripe account.
  IF v_seed IS TRUE THEN
    RETURN NULL;
  END IF;

  IF v_acct IS NULL OR v_payouts IS NOT TRUE THEN
    RETURN 'helper_payout_setup_incomplete';
  END IF;

  -- Operator kill switch — the same flag the client honours
  -- (feature_flags.idv_requirement_paused, Admin → Settings) so a Stripe
  -- Identity outage cannot freeze the whole marketplace. Fails CLOSED: a
  -- missing row or missing key leaves the identity requirement in force.
  SELECT COALESCE((s.feature_flags ->> 'idv_requirement_paused')::boolean, false)
    INTO v_paused
  FROM public.platform_settings s
  LIMIT 1;

  IF v_identity IS NOT TRUE AND COALESCE(v_paused, false) IS NOT TRUE THEN
    RETURN 'helper_identity_unverified';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.helper_award_block_reason(uuid) IS
  'NULL when this helper may be awarded a job; otherwise helper_payout_setup_incomplete / helper_identity_unverified / helper_unknown. The single source of truth for the acceptance gate — enforced by trigger jobs_award_gate and mirrored by the client for copy.';

REVOKE ALL ON FUNCTION public.helper_award_block_reason(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helper_award_block_reason(uuid) TO authenticated, service_role;

-- ── 3. Enforce it on every door that awards work ───────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_helper_award_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reason   text;
  v_awarding boolean;
BEGIN
  -- Only real end-user sessions are judged; see the header for why.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- The two transitions that mean "this job is now theirs". A re-save that
  -- leaves both columns as they were is not an award and must not be blocked —
  -- otherwise an already-hired helper whose Stripe state later lapsed could not
  -- have their job completed, cancelled or reassigned.
  v_awarding :=
    (NEW.helper_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.helper_id IS DISTINCT FROM NEW.helper_id))
    OR (NEW.helper_confirmed_at IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.helper_confirmed_at IS NULL));

  IF NOT v_awarding THEN
    RETURN NEW;
  END IF;

  v_reason := public.helper_award_block_reason(NEW.helper_id);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%', v_reason;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_award_gate ON public.jobs;
CREATE TRIGGER jobs_award_gate
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_helper_award_gate();

-- Group jobs staff through the roster table as well as jobs.helper_id, and only
-- the FIRST accepted helper ever lands on jobs.helper_id — so slots 2..N would
-- otherwise walk straight past the trigger above.
CREATE OR REPLACE FUNCTION public.enforce_group_roster_award_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reason text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  v_reason := public.helper_award_block_reason(NEW.helper_id);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%', v_reason;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.group_job_helpers') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS group_job_helpers_award_gate ON public.group_job_helpers;
    CREATE TRIGGER group_job_helpers_award_gate
      BEFORE INSERT ON public.group_job_helpers
      FOR EACH ROW
      EXECUTE FUNCTION public.enforce_group_roster_award_gate();
  END IF;
END $$;

-- ── 4. Tell the poster, on the applicant card, before they tap Hire ────────
-- Two changes to get_safe_profiles:
--
--  (a) `is_id_verified` was still `(p.idv_status = 'verified')` — the exact
--      unreviewed flag commit 47eef666 removed from every other user-visible
--      "ID verified" claim. It survived because it lives in SQL rather than in
--      a component, and it feeds the poster badge on the dashboard. Repointed
--      at the Stripe verdict so the claim is honest everywhere.
--
--  (b) `is_payout_ready` is new. It is what lets the applicant card tell
--      "identity still pending" apart from "hasn't set up payouts at all", and
--      it is the same fact the trigger enforces — so the card can no longer
--      offer a Hire the server will refuse.
--
-- Neither field is sensitive: both are coarse booleans about a helper who chose
-- to apply for the reader's job, and the reader is deciding whether to let this
-- person into their home.
DROP FUNCTION IF EXISTS public.get_safe_profiles(uuid[]);

CREATE FUNCTION public.get_safe_profiles(user_ids uuid[])
RETURNS TABLE(
  user_id uuid, full_name text, avatar_url text, bio text, location text,
  skills text, hourly_rate numeric, role text, subscription_tier text,
  portfolio_urls text[], created_at timestamptz,
  is_id_verified boolean, is_payout_ready boolean, profile_id uuid,
  is_licensed boolean, license_status text,
  is_insured boolean, insurance_status text,
  business_name text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    p.user_id, p.full_name, p.avatar_url, p.bio, p.location,
    p.skills, p.hourly_rate,
    (
      SELECT CASE WHEN ur.role = 'admin'::app_role THEN 'admin' ELSE 'member' END
      FROM public.user_roles ur WHERE ur.user_id = p.user_id
      ORDER BY CASE ur.role WHEN 'admin'::app_role THEN 1 ELSE 2 END LIMIT 1
    ) AS role,
    p.subscription_tier, p.portfolio_urls, p.created_at,
    -- Stripe's verdict, not the unreviewed upload flag.
    p.stripe_identity_verified AS is_id_verified,
    (p.stripe_account_id IS NOT NULL AND p.stripe_payouts_enabled) AS is_payout_ready,
    p.id AS profile_id,
    p.is_licensed, p.license_status,
    p.is_insured, p.insurance_status,
    -- Never emit an unvetted business name. The badge is the trust signal
    -- and the name is part of it, so the two go public together or not at all.
    CASE
      WHEN (p.is_licensed AND p.license_status = 'verified')
        OR (p.is_insured AND p.insurance_status = 'verified')
      THEN p.business_name
    END AS business_name
  FROM public.profiles p
  WHERE (p.user_id = ANY(user_ids) OR p.id = ANY(user_ids))
    AND p.approval_status = 'approved'
    AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'));
$function$;

REVOKE ALL ON FUNCTION public.get_safe_profiles(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_safe_profiles(uuid[]) TO anon, authenticated, service_role;

-- ── 5. Make the gate's inputs unforgeable ──────────────────────────────────
-- A gate a helper can write themselves is not a gate. `prevent_self_escalation`
-- pins every server-owned column back to its OLD value for a non-admin writer,
-- and profiles is client-updatable under RLS for one's own row — but FOUR of the
-- five columns this gate reads were never on that list:
--
--   stripe_identity_verified / _at   added 2026-08-27 by the badge commit and
--                                    never pinned — so a helper could already
--                                    have forged the "ID verified by Stripe"
--                                    badge with a single profiles UPDATE, and
--                                    would now be able to forge the gate too.
--   stripe_charges_enabled           added above.
--   stripe_payouts_enabled           added above.
--   is_seed                          added 2026-08-25 for fixtures; it is the
--                                    gate's exemption, so self-setting it would
--                                    walk straight through.
--
-- (`stripe_account_id` was already pinned.) Replaced wholesale rather than
-- patched so the pinned set stays readable in one place; every prior line is
-- reproduced verbatim from the live definition.
CREATE OR REPLACE FUNCTION public.prevent_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  -- A server-owned ladder running inside a SECURITY DEFINER RPC: SECURITY
  -- DEFINER does not change auth.uid(), so without this the RPC's own
  -- consequence writes are reverted.
  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN
    RETURN NEW;
  END IF;

  NEW.approval_status := OLD.approval_status;
  NEW.ban_status := OLD.ban_status;
  -- profiles.role removed; role escalation prevention is on user_roles
  NEW.stripe_account_id := OLD.stripe_account_id;
  NEW.subscription_tier := OLD.subscription_tier;
  NEW.subscription_expires_at := OLD.subscription_expires_at;
  NEW.denial_reason := OLD.denial_reason;
  NEW.denial_email_count := OLD.denial_email_count;
  NEW.last_denial_email_at := OLD.last_denial_email_at;
  NEW.approval_email_count := OLD.approval_email_count;
  NEW.last_approval_email_at := OLD.last_approval_email_at;
  NEW.drip_step := OLD.drip_step;
  NEW.last_drip_at := OLD.last_drip_at;

  NEW.idv_status := OLD.idv_status;
  NEW.idv_session_id := OLD.idv_session_id;
  NEW.idv_attempted_at := OLD.idv_attempted_at;
  NEW.idv_confidence := OLD.idv_confidence;
  NEW.idv_failure_reason := OLD.idv_failure_reason;
  NEW.legacy_manual_review := OLD.legacy_manual_review;

  -- SEC-003: the two later-added IDV/apply columns.
  NEW.id_verification_status := OLD.id_verification_status;
  NEW.has_applied_before := OLD.has_applied_before;

  -- SEC-004: forgeable trust / onboarding-gate columns.
  NEW.background_check_status := OLD.background_check_status;
  NEW.is_legacy_user := OLD.is_legacy_user;

  NEW.onboarding_fee_paid := OLD.onboarding_fee_paid;
  NEW.onboarding_fee_charged_at := OLD.onboarding_fee_charged_at;
  NEW.email_verified := OLD.email_verified;
  NEW.verification_email_count := OLD.verification_email_count;
  NEW.last_verification_email_at := OLD.last_verification_email_at;

  NEW.application_count := OLD.application_count;
  NEW.auto_suspended_until := OLD.auto_suspended_until;

  NEW.license_status := OLD.license_status;
  NEW.insurance_status := OLD.insurance_status;
  NEW.license_reviewed_at := OLD.license_reviewed_at;
  NEW.insurance_reviewed_at := OLD.insurance_reviewed_at;
  NEW.license_reviewed_by := OLD.license_reviewed_by;
  NEW.insurance_reviewed_by := OLD.insurance_reviewed_by;
  NEW.license_rejection_reason := OLD.license_rejection_reason;
  NEW.insurance_rejection_reason := OLD.insurance_rejection_reason;

  -- Defense in depth: the credential BOOLEANS are derived from the document
  -- URL by trg_auto_pending_credentials, which runs immediately after this.
  NEW.is_licensed := OLD.is_licensed;
  NEW.is_insured := OLD.is_insured;

  -- The acceptance gate's own inputs. Stripe-owned facts, written only by the
  -- account.updated webhook (service role, auth.uid() NULL, so exempt above).
  NEW.stripe_identity_verified := OLD.stripe_identity_verified;
  NEW.stripe_identity_verified_at := OLD.stripe_identity_verified_at;
  NEW.stripe_charges_enabled := OLD.stripe_charges_enabled;
  NEW.stripe_payouts_enabled := OLD.stripe_payouts_enabled;
  -- The gate's exemption for fixture data — never self-settable.
  NEW.is_seed := OLD.is_seed;

  RETURN NEW;
END;
$function$;
