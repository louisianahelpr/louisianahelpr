-- helper_credentials: make the trust columns server-owned, and make the
-- credential tier read the store that is actually reviewed.
--
-- WHAT WAS WRONG (proven against prod 2026-09-03, inside a transaction aborted
-- by RAISE so nothing committed, acting as the NON-ADMIN user
-- 437de07d-1bd7-46c8-a451-6b46aa3bcad5):
--
--     tier_before = 0
--     INSERT INTO helper_credentials(user_id, credential_type, status, verified_at)
--       VALUES (me,'trade_license','verified', now());
--     INSERT INTO helper_credentials(user_id, credential_type, status, verified_at)
--       VALUES (me,'insurance','verified', now());
--     tier_after  = 3
--
-- Two self-declared rows, no document, no admin, no review, and
-- get_user_credential_tier() returned the top tier — which is the gate
-- enforce_application_credential_tier() uses to decide who may apply to
-- licensed-trade jobs. The table had RLS enabled, but every policy only asked
-- "is this row yours?", never "may you say this about it", and `authenticated`
-- held a column-level INSERT/UPDATE grant covering `status`, `verified_at`,
-- `rejection_reason` and `vendor_check_id`. There was no trigger on the table
-- at all.
--
-- THE OTHER HALF OF THE SAME HOLE: the honest path could never satisfy that
-- gate. There is no client write path to helper_credentials anywhere in src/
-- for trade_license or insurance (the only writer is the stripe-webhook, and
-- only for background_check), and prod holds zero rows in the table.
-- Meanwhile a COMPLETE, correctly-secured review flow for exactly these two
-- credentials already exists on `profiles` and is in live use — 7 verified
-- licenses and 6 verified insurance certificates today:
--
--     CredentialsTab.tsx writes profiles.license_url / insurance_url
--       -> trg_auto_pending_credentials forces the status to 'pending' and
--          refuses to let a non-admin set it
--       -> get_pending_credentials() surfaces it in AdminCredentialQueue.tsx
--       -> review_credential() (admin-gated, audit-logged, notifies the user)
--          sets profiles.license_status / insurance_status = 'verified'
--       -> prevent_self_escalation() pins those columns against their owner
--
-- So the app had two credential stores: one reviewed and ignored, one
-- unreviewed and authoritative. The gate read the wrong one. This migration
-- reconciles onto the reviewed store rather than building a third.
--
-- REPLAY-SAFETY: every statement is CREATE OR REPLACE, DROP-then-CREATE, or an
-- idempotent REVOKE, and every object referenced (helper_credentials, the
-- profiles credential columns, has_role) is created by an EARLIER migration.
-- Applying this file repeatedly is a no-op.

-- ---------------------------------------------------------------------------
-- 1. The trust columns become server-owned.
-- ---------------------------------------------------------------------------
-- Mirrors prevent_self_escalation() on profiles: an end-user write may say
-- WHAT is being claimed, never WHETHER it was accepted. Bypassed for the three
-- writers that legitimately set a status:
--   * auth.uid() IS NULL       -- service_role (stripe-webhook) and cron
--   * has_role(..., 'admin')   -- an admin acting through the app
--   * app.trusted_ladder_write -- sync_credential_from_check(), which already
--                                 sets this flag before writing a vendor result
CREATE OR REPLACE FUNCTION public.enforce_credential_status_server_owned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A member may submit a credential for review. That is all a submission
    -- is: a claim plus a document. 'submitted' rather than the 'unverified'
    -- column default is what the reviewer queue and the profile's amber
    -- "Verification in progress" chip already look for.
    NEW.user_id          := auth.uid();
    NEW.status           := 'submitted';
    NEW.verified_at      := NULL;
    NEW.rejection_reason := NULL;
    NEW.vendor_check_id  := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE. A credential that has already been accepted is immutable to its
  -- owner: letting them edit the license number or push out the expiry of a
  -- row a reviewer already signed off would launder an unreviewed claim
  -- through a reviewed row.
  IF OLD.status = 'verified' THEN
    RETURN OLD;
  END IF;

  NEW.user_id          := OLD.user_id;
  NEW.status           := OLD.status;
  NEW.verified_at      := OLD.verified_at;
  NEW.rejection_reason := OLD.rejection_reason;
  NEW.vendor_check_id  := OLD.vendor_check_id;
  NEW.created_at       := OLD.created_at;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_credential_status_server_owned ON public.helper_credentials;
CREATE TRIGGER trg_credential_status_server_owned
  BEFORE INSERT OR UPDATE ON public.helper_credentials
  FOR EACH ROW EXECUTE FUNCTION public.enforce_credential_status_server_owned();

-- ---------------------------------------------------------------------------
-- 2. Belt and braces: take the grants away too.
-- ---------------------------------------------------------------------------
-- The trigger above is the load-bearing guard, but the same reasoning that put
-- a column GRANT in front of prevent_self_escalation() applies here: with the
-- grant gone PostgREST rejects the write with 42501 before a row is ever
-- built, so a future edit that weakens the trigger cannot silently re-open the
-- hole.
--
-- THE ORDER BELOW MATTERS AND IS NOT THE OBVIOUS ONE. A column-level REVOKE
-- against a role that holds the TABLE-level privilege does nothing — Postgres
-- keeps table-level and column-level grants as separate sets, and the
-- table-level one still implies every column. `helper_credentials` currently
-- holds table-level INSERT/UPDATE for authenticated, so
--     REVOKE INSERT (status) ON helper_credentials FROM authenticated;
-- would have emitted a warning and left the hole exactly as it was. The
-- table-level grant has to go FIRST, then the safe columns are granted back
-- one by one. This is the same shape the profiles migration used, which is why
-- profiles today has no table-level UPDATE and 91 explicit column grants.
REVOKE INSERT, UPDATE, DELETE ON public.helper_credentials FROM authenticated;

-- What a member may say: which credential this is and what document backs it.
GRANT INSERT (
  id, user_id, credential_type, license_number, license_state, trade_category,
  issuing_authority, document_url, expiration_date, created_at, updated_at
) ON public.helper_credentials TO authenticated;

-- Amending a submission that has not been accepted yet: re-upload a clearer
-- document, fix a mistyped license number. Not `user_id`, not `id`, not
-- `created_at`, and none of the trust columns.
GRANT UPDATE (
  credential_type, license_number, license_state, trade_category,
  issuing_authority, document_url, expiration_date, updated_at
) ON public.helper_credentials TO authenticated;

-- DELETE is granted back to nobody. It had a table-level grant but no DELETE
-- policy, so RLS has always denied it — a grant documenting an intent the
-- database does not honour. Deliberately NOT replaced with a policy: a member
-- who could delete a 'rejected' credential could erase their own rejection
-- history from the next reviewer.

-- anon has no business writing this table at all. RLS already denied it (every
-- policy tests auth.uid() = user_id, which is NULL for anon), but the grants
-- were there and said otherwise.
REVOKE INSERT, UPDATE, DELETE ON public.helper_credentials FROM anon;

-- ---------------------------------------------------------------------------
-- 2b. Give the admin back a way in — through the front door.
-- ---------------------------------------------------------------------------
-- The grant wall in step 2 is ROLE-based, and an admin's JWT carries the same
-- `authenticated` role as everybody else's. So step 2 locks admins out of this
-- table too, and the trigger's admin bypass never even runs — Postgres refuses
-- the column before a row is built. (The PGlite harness caught exactly this:
-- "an admin can still review" failed with "permission denied for table
-- helper_credentials" while every attacker assertion passed.)
--
-- That is the same problem review_credential() already solves for profiles,
-- and this is the same solution: a SECURITY DEFINER RPC that runs as the table
-- owner, checks the caller's role itself, and leaves an audit trail. Admins
-- never write the table directly; nothing in src/ does today either.
CREATE OR REPLACE FUNCTION public.review_helper_credential(
  _credential_id uuid,
  _decision text,
  _reason text DEFAULT NULL,
  _expires date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_type text;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins may review credentials';
  END IF;
  IF _decision NOT IN ('verified','rejected') THEN
    RAISE EXCEPTION 'Invalid decision';
  END IF;

  -- Same trusted-ladder handshake sync_credential_from_check() uses, so the
  -- step-1 trigger knows this is the server writing and not the member.
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  UPDATE public.helper_credentials
     SET status           = _decision,
         verified_at      = CASE WHEN _decision = 'verified' THEN now() ELSE NULL END,
         rejection_reason = CASE WHEN _decision = 'rejected' THEN _reason ELSE NULL END,
         expiration_date  = COALESCE(_expires, expiration_date),
         updated_at       = now()
   WHERE id = _credential_id
  RETURNING user_id, credential_type INTO v_user_id, v_type;

  -- A zero-row UPDATE reports no error. Without this the admin sees a success
  -- toast for a review that changed nothing.
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Credential % not found', _credential_id;
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    v_user_id,
    CASE WHEN _decision = 'verified' THEN 'Credential verified' ELSE 'Credential needs attention' END,
    CASE WHEN _decision = 'verified'
      THEN 'Your ' || replace(v_type, '_', ' ') || ' has been verified.'
      ELSE 'Your ' || replace(v_type, '_', ' ') || ' could not be verified'
           || COALESCE(': ' || _reason, '.') || ' Please re-upload a clearer document.'
    END,
    CASE WHEN _decision = 'verified' THEN 'success' ELSE 'warning' END,
    '/profile?tab=credentials'
  );

  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (
    auth.uid(),
    'credential_' || _decision,
    _credential_id::text,
    'helper_credential',
    jsonb_build_object('credential_type', v_type, 'reason', _reason, 'user_id', v_user_id::text)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.review_helper_credential(uuid, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_helper_credential(uuid, text, text, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2c. Credential expiry on the profiles store (VC-003).
-- ---------------------------------------------------------------------------
-- Step 3 below makes profiles.license_status / insurance_status AUTHORITATIVE
-- for the credential tier. Until now those columns recorded a decision and
-- nothing else: review_credential() wrote 'verified' plus a reviewed_at stamp,
-- and there was no expiry column anywhere in the schema. Promoting that store
-- as-is would mean a Certificate of Insurance verified once is verified
-- forever — and a COI is an ANNUAL policy, on an app whose whole premise is
-- sending a stranger into someone's home. CredentialsTab.tsx:360 already
-- concedes the gap in a comment.
--
-- WHAT NULL MEANS, AND WHY THE TWO HALVES DELIBERATELY DISAGREE
--
--   helper_credentials.expiration_date IS NULL  =>  does not expire.
--   profiles.license_expires_at        IS NULL  =>  NO credit; fails closed.
--
-- That asymmetry is deliberate, and it is about WHO wrote the NULL. In
-- helper_credentials the date is copied from a vendor result by
-- sync_credential_from_check(); a vendor that returns no expiry is genuinely
-- ASSERTING that this credential does not expire (a completed identity check
-- does not lapse). NULL there is an answer. In profiles the date is typed by
-- an admin reading a document, so NULL means nobody recorded one. That is an
-- ABSENCE, and treating an absence as "never expires" is precisely the defect
-- being fixed. An absence fails closed.
--
-- The obvious objection to failing closed is that it invents a state where the
-- profile shows a "Licensed" badge while the tier gate silently refuses the
-- helper. So that state is made UNREACHABLE rather than merely unlikely:
-- review_credential() below REFUSES to record 'verified' without an expiry, so
-- (status='verified' AND expires_at IS NULL) cannot be created from here on,
-- and the backfill closes the rows that predate the column. The invariant
-- holds from the moment this lands.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS license_expires_at   date,
  ADD COLUMN IF NOT EXISTS insurance_expires_at date;

-- Note the type: `date`, not a timestamp, despite the `_at` suffix the rest of
-- the license_*/insurance_* group uses. Credentials expire on a day printed on
-- a document, not at an instant, and helper_credentials.expiration_date is
-- already a `date` — matching it keeps the two branches of
-- get_user_credential_tier() directly comparable.
COMMENT ON COLUMN public.profiles.license_expires_at IS
  'Day the verified trade licence lapses, read off the document by the reviewing admin. NULL means no expiry was recorded, which grants NO credential tier (fails closed) — see review_credential().';
COMMENT ON COLUMN public.profiles.insurance_expires_at IS
  'Day the verified Certificate of Insurance lapses, read off the document by the reviewing admin. NULL means no expiry was recorded, which grants NO credential tier (fails closed) — see review_credential().';

-- Backfill every row already 'verified' that predates the column, so the
-- (verified, NULL) pair is empty the moment this lands rather than being
-- grandfathered in forever. Measured in prod 2026-09-03: 7 rows, and ALL of
-- them is_seed = true — there is not one real user holding a verified licence
-- or COI yet, so this invalidates nobody. A year from the review date (or from
-- deploy, for the four seed rows written directly that never carried a
-- reviewed_at at all) keeps the demo profiles' badges live and gives a real
-- date to re-review by instead of a silent forever.
--
-- Idempotent: the second run matches no rows.
UPDATE public.profiles
   SET license_expires_at = (COALESCE(license_reviewed_at, now()) + interval '1 year')::date
 WHERE license_status = 'verified' AND license_expires_at IS NULL;

UPDATE public.profiles
   SET insurance_expires_at = (COALESCE(insurance_reviewed_at, now()) + interval '1 year')::date
 WHERE insurance_status = 'verified' AND insurance_expires_at IS NULL;

-- A member must not write their own expiry, for the same reason they cannot
-- write their own status. prevent_self_escalation() pins the rest of this
-- group; the two new columns join it. Reproduced verbatim from prod with only
-- the two lines marked below added.
CREATE OR REPLACE FUNCTION public.prevent_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_billing_attempt boolean;
  v_attempted_tier text;
BEGIN
  IF auth.uid() IS NULL OR has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN
    RETURN NEW;
  END IF;

  v_billing_attempt :=
       NEW.subscription_tier                 IS DISTINCT FROM OLD.subscription_tier
    OR NEW.subscription_expires_at           IS DISTINCT FROM OLD.subscription_expires_at
    OR NEW.stripe_customer_id                IS DISTINCT FROM OLD.stripe_customer_id
    OR NEW.stripe_subscription_id            IS DISTINCT FROM OLD.stripe_subscription_id
    OR NEW.subscription_billing_cycle        IS DISTINCT FROM OLD.subscription_billing_cycle
    OR NEW.subscription_cancel_at_period_end IS DISTINCT FROM OLD.subscription_cancel_at_period_end;
  v_attempted_tier := NEW.subscription_tier;

  NEW.approval_status := OLD.approval_status;
  NEW.ban_status := OLD.ban_status;
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
  NEW.idv_attempt_count := OLD.idv_attempt_count;
  NEW.idv_confidence := OLD.idv_confidence;
  NEW.idv_failure_reason := OLD.idv_failure_reason;
  NEW.legacy_manual_review := OLD.legacy_manual_review;

  NEW.id_verification_status := OLD.id_verification_status;
  NEW.has_applied_before := OLD.has_applied_before;

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

  -- ADDED 20260903012612. An expiry the member can push out is not an expiry;
  -- with step 3 reading these to decide the credential tier, writing your own
  -- would be the profiles-side version of the helper_credentials self-grant.
  NEW.license_expires_at := OLD.license_expires_at;
  NEW.insurance_expires_at := OLD.insurance_expires_at;

  NEW.is_licensed := OLD.is_licensed;
  NEW.is_insured := OLD.is_insured;

  NEW.stripe_identity_verified := OLD.stripe_identity_verified;
  NEW.stripe_identity_verified_at := OLD.stripe_identity_verified_at;
  NEW.stripe_charges_enabled := OLD.stripe_charges_enabled;
  NEW.stripe_payouts_enabled := OLD.stripe_payouts_enabled;
  NEW.is_seed := OLD.is_seed;

  NEW.stripe_customer_id := OLD.stripe_customer_id;
  NEW.stripe_subscription_id := OLD.stripe_subscription_id;
  NEW.subscription_billing_cycle := OLD.subscription_billing_cycle;
  NEW.subscription_cancel_at_period_end := OLD.subscription_cancel_at_period_end;

  IF v_billing_attempt THEN
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.error_logs e
         WHERE e.tags->>'source' = 'rls-escalation-refused'
           AND e.tags->>'user_id' = auth.uid()::text
           AND e.created_at > now() - interval '1 hour'
      ) THEN
        INSERT INTO public.error_logs (severity, message, tags, context)
        VALUES (
          'warning',
          'Refused a non-admin write to the profiles billing columns',
          jsonb_build_object('source', 'rls-escalation-refused',
                             'area', 'security',
                             'user_id', auth.uid()::text),
          jsonb_build_object(
            'current_tier',   OLD.subscription_tier,
            'attempted_tier', v_attempted_tier,
            'row_user_id',    OLD.user_id::text));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2d. review_credential() records the expiry, and refuses to verify without one.
-- ---------------------------------------------------------------------------
-- DROP-then-CREATE, not CREATE OR REPLACE: adding a parameter makes a new
-- OVERLOAD rather than replacing the function, and leaving the old 4-argument
-- version resolvable would leave the exact bypass this section exists to close
-- — an admin, or a stale client bundle, could still call the 4-arg form and
-- write 'verified' with no expiry. The old signature has to go.
DROP FUNCTION IF EXISTS public.review_credential(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.review_credential(
  _user_id uuid,
  _credential text,
  _decision text,
  _reason text DEFAULT NULL::text,
  _expires date DEFAULT NULL::date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rows int;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins may review credentials';
  END IF;
  IF _credential NOT IN ('license','insurance') THEN
    RAISE EXCEPTION 'Invalid credential type';
  END IF;
  IF _decision NOT IN ('verified','rejected') THEN
    RAISE EXCEPTION 'Invalid decision';
  END IF;

  -- The invariant that lets get_user_credential_tier() fail closed on a NULL
  -- expiry without ever stranding an approved helper: you cannot approve
  -- without recording when it lapses. The date is printed on the document the
  -- admin is already looking at.
  IF _decision = 'verified' AND _expires IS NULL THEN
    RAISE EXCEPTION 'An expiry date is required to verify a credential';
  END IF;
  IF _decision = 'verified' AND _expires <= current_date THEN
    RAISE EXCEPTION 'That credential already expired on %', _expires;
  END IF;

  IF _credential = 'license' THEN
    UPDATE public.profiles
       SET license_status = _decision,
           license_reviewed_at = now(),
           license_reviewed_by = auth.uid(),
           license_expires_at = CASE WHEN _decision = 'verified' THEN _expires ELSE NULL END,
           license_rejection_reason = CASE WHEN _decision = 'rejected' THEN _reason ELSE NULL END
     WHERE user_id = _user_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  ELSE
    UPDATE public.profiles
       SET insurance_status = _decision,
           insurance_reviewed_at = now(),
           insurance_reviewed_by = auth.uid(),
           insurance_expires_at = CASE WHEN _decision = 'verified' THEN _expires ELSE NULL END,
           insurance_rejection_reason = CASE WHEN _decision = 'rejected' THEN _reason ELSE NULL END
     WHERE user_id = _user_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  END IF;

  -- A profile UPDATE matching zero rows returns no error (CLAUDE.md, "A null
  -- `error` does NOT mean the write happened"). Raise BEFORE the notification
  -- and the audit row, so a decision that changed nothing cannot produce a
  -- success toast, an email to the helper, and an audit entry claiming it
  -- happened. The original wrote all three unconditionally.
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'No profile found for user %', _user_id;
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    _user_id,
    CASE WHEN _credential = 'license'
      THEN CASE WHEN _decision = 'verified' THEN 'License verified' ELSE 'License needs attention' END
      ELSE CASE WHEN _decision = 'verified' THEN 'Insurance verified' ELSE 'Insurance needs attention' END
    END,
    CASE WHEN _decision = 'verified' THEN
      CASE WHEN _credential = 'license'
        THEN 'Your professional license has been verified. The Licensed badge is live on your profile until ' || to_char(_expires, 'FMMonth FMDD, YYYY') || '.'
        ELSE 'Your Certificate of Insurance has been verified. The Insured badge is live on your profile until ' || to_char(_expires, 'FMMonth FMDD, YYYY') || '.'
      END
    ELSE
      CASE WHEN _credential = 'license'
        THEN 'Your license could not be verified' || COALESCE(': ' || _reason, '.') || ' Please re-upload a clearer document.'
        ELSE 'Your insurance document could not be verified' || COALESCE(': ' || _reason, '.') || ' Please re-upload a clearer document.'
      END
    END,
    CASE WHEN _decision = 'verified' THEN 'success' ELSE 'warning' END,
    '/profile?tab=credentials'
  );

  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (
    auth.uid(),
    'credential_' || _decision,
    _user_id::text,
    'profile',
    jsonb_build_object('credential', _credential, 'reason', _reason, 'expires', _expires)
  );
END;
$function$;

-- Restore exactly the ACL the dropped 4-arg version carried, read from
-- pg_proc.proacl before the drop: postgres, service_role, authenticated —
-- never anon.
REVOKE ALL ON FUNCTION public.review_credential(uuid, text, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_credential(uuid, text, text, text, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The tier reads the reviewed store.
-- ---------------------------------------------------------------------------
-- Each tier now accepts EITHER an admin-reviewed profiles column (the path
-- that exists and is in use today) OR a verified helper_credentials row (the
-- vendor path, which after step 1 only the server can produce). Both sources
-- are server-owned, so neither can be self-granted.
--
-- Tier 3 = licensed AND insured/bonded, tier 2 = licensed, tier 1 = identity.
--
-- BOTH branches now honour expiry, with the NULL asymmetry set out in 2c: a
-- NULL on the vendor side means "does not expire", a NULL on the admin-reviewed
-- side means "nobody recorded one" and earns no credit.
CREATE OR REPLACE FUNCTION public.get_user_credential_tier(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH src AS (
    SELECT
      -- Admin-reviewed via review_credential(); pinned by prevent_self_escalation().
      -- A NULL expiry earns nothing here — see 2c.
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
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.user_id = p_user_id
          AND (p.stripe_identity_verified OR p.id_verification_status = 'verified')
      ) AS prof_identity,
      -- Vendor-verified via sync_credential_from_check(); after this migration
      -- an end user cannot write status='verified' here.
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
  'Credential tier 0-3 gating licensed-trade job applications (see '
  'enforce_application_credential_tier). Reads only server-owned sources: '
  'admin-reviewed profiles.license_status / insurance_status / '
  'id_verification_status, and vendor-verified helper_credentials rows. '
  'A member cannot write any of them.';
