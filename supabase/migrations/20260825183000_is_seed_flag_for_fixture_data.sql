-- is_seed — mark fixture/test rows so admin aggregates can exclude them.
--
-- WHY: the 2026-08-25 audit measured production and found it is mostly a test
-- database — 54 of 58 `jobs` and 20 of 23 `profiles` are fixtures or clearly
-- marked audit accounts. Every admin money figure counts them: "Payments
-- Collected", "Platform Profit", the revenue sparklines, the subscriber
-- distribution, the analytics funnels, and — the one that actually matters —
-- the quarterly TAX RESERVE estimate, which is an IRS-facing number the owner
-- is invited to act on.
--
-- A one-time purge would fix today and rot the moment anything is seeded
-- again. A flag keeps the numbers trustworthy permanently, and keeps the
-- fixtures usable for demos and for the audit accounts that need real rows to
-- exercise the app. Nothing is deleted by this migration.
--
-- Backfill is PREDICATE-BASED, never a hardcoded id list: live data was moving
-- while the audit ran (58 jobs at one read, 61 at another), so an enumerated
-- list would have been stale before it merged.

ALTER TABLE public.jobs     ADD COLUMN IF NOT EXISTS is_seed boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_seed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.jobs.is_seed IS
  'Fixture/demo/audit row. Excluded from admin aggregates. Never set by a client — see enforce_poster_jobs_money_lock.locked_always.';
COMMENT ON COLUMN public.profiles.is_seed IS
  'Fixture/demo/audit account. Excluded from admin aggregates. Never set by a client — see prevent_self_escalation.';

-- ── Backfill: accounts ────────────────────────────────────────────────────
-- mailinator = the audit accounts the standing test authorization creates.
-- @helpr.test = the demo cast (Camille, Tre, Marie, Eli, Layla, Dana).
-- eli.test.*  = the seeded helper used by the payout fixtures.
-- The owner's own three accounts (gmail / admin@ / privaterelay) are NOT
-- fixtures and stay counted.
UPDATE public.profiles
   SET is_seed = true
 WHERE is_seed = false
   AND (email ILIKE '%@mailinator.com'
     OR email ILIKE '%@helpr.test'
     OR email ILIKE 'eli.test.%');

-- ── Backfill: jobs ────────────────────────────────────────────────────────
-- Three independent signals, OR'd, each COALESCE'd because `col IN (subquery)`
-- yields NULL (not false) on a NULL column — an unassigned job would otherwise
-- fall through the predicate silently. That NULL propagation is exactly what
-- made two audit counts disagree before this was written.
UPDATE public.jobs j
   SET is_seed = true
 WHERE j.is_seed = false
   AND (
        j.id::text LIKE 'a5eed000%'          -- seeded fixture uuids
     OR j.id::text LIKE 'b0b00001%'          -- second fixture batch
     OR j.title LIKE 'AUDIT%'                -- rows created by audit passes
     OR COALESCE(j.customer_id IN (SELECT user_id FROM public.profiles WHERE is_seed), false)
     OR COALESCE(j.helper_id   IN (SELECT user_id FROM public.profiles WHERE is_seed), false)
   );

-- Partial indexes: every admin aggregate filters `is_seed = false`, so index
-- only the rows those queries actually scan.
CREATE INDEX IF NOT EXISTS idx_jobs_not_seed     ON public.jobs     (created_at) WHERE is_seed = false;
CREATE INDEX IF NOT EXISTS idx_profiles_not_seed ON public.profiles (created_at) WHERE is_seed = false;

-- ── Make the flag unforgeable ─────────────────────────────────────────────
-- Without this a user could flag THEMSELVES (or their own job) as seed and
-- vanish from admin reporting — a small but real integrity hole in a column
-- whose whole purpose is to make the money numbers trustworthy.

-- profiles: force-reset on any non-admin self-update, same as every other
-- trust column. Body is the deployed function verbatim plus one line.
CREATE OR REPLACE FUNCTION public.prevent_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR has_role(auth.uid(), 'admin') THEN
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

  -- Reporting integrity: a user must not be able to exclude themselves from
  -- the admin numbers by flagging their own account as fixture data.
  NEW.is_seed := OLD.is_seed;

  RETURN NEW;
END;
$$;

-- jobs: add is_seed to the ALWAYS-locked set. That array's own comment states
-- the contract — "Enumerated (not derived) so a new column defaults to
-- lockable only when added here" — so this is the sanctioned hook, not a
-- workaround. Body is the deployed function verbatim plus one array entry.
CREATE OR REPLACE FUNCTION public.enforce_poster_jobs_money_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed_col text;
  -- Never writable by the poster, funded or not (R3). Escrow state and the
  -- paid-placement columns are set by edge functions running as service_role
  -- (auth.uid() IS NULL), which returns early below.
  locked_always CONSTANT text[] := ARRAY[
    'payment_status',
    'stripe_payment_intent_id',
    'boosted_at',
    'boost_expires_at',
    'is_urgent',
    -- Reporting integrity: a poster must not be able to hide a job from the
    -- admin money figures by marking it fixture data.
    'is_seed'
  ];
  -- Money / fee / payment / assignment columns a poster must never mutate on a
  -- FUNDED job. Enumerated (not derived) so a new column defaults to lockable
  -- only when added here — safer than an allow-list that fails open.
  locked_when_funded CONSTANT text[] := ARRAY[
    'budget',
    'urgent_fee',
    'platform_fee_amount',
    'platform_fee_percent',
    'helper_fee_percent',
    'customer_fee_amount',
    'commission_tax_amount',
    'sales_tax_amount',
    'protection_fee',
    'payment_status',
    'stripe_payment_intent_id',
    'helper_id',
    'poster_completed_at'
    -- NOTE: cancellation_fee / cancellation_fee_status are deliberately NOT
    -- locked — CancellationDialog writes them client-side for BOTH parties when
    -- a funded job is cancelled (mirrors the helper whitelist which permits
    -- them). Locking them here would break the poster's cancel flow.
  ];
BEGIN
  -- Only constrain the poster acting on their own job. Everyone else
  -- (service role: uid NULL; assigned helper; admin) passes through — their
  -- access is governed by RLS / the helper whitelist as before.
  IF auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM OLD.customer_id THEN
    RETURN NEW;
  END IF;

  -- Ownership is immutable to the poster, funded or not.
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'Posters may not reassign jobs.customer_id'
      USING ERRCODE = '42501';
  END IF;

  -- ALWAYS-LOCKED set (R3) — checked before the funded gate.
  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF changed_col = ANY (locked_always) THEN
      RAISE EXCEPTION 'Posters may not modify jobs.%', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- The money lock only applies once escrow exists.
  IF OLD.payment_status IS DISTINCT FROM 'unpaid' THEN
    FOR changed_col IN
      SELECT n.key
      FROM jsonb_each(to_jsonb(NEW)) AS n
      JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
      WHERE n.value IS DISTINCT FROM o.value
    LOOP
      IF changed_col = ANY (locked_when_funded) THEN
        -- The one sanctioned poster write to helper_id: hiring the FIRST
        -- helper on a still-open funded job (accept_application runs with the
        -- poster's uid). Escrow-at-post means every legitimate hire happens
        -- exactly here. NULL → NOT NULL only; a funded job that already has a
        -- helper can never be reassigned by the poster.
        IF changed_col = 'helper_id'
           AND OLD.helper_id IS NULL
           AND NEW.helper_id IS NOT NULL
           AND OLD.status = 'open' THEN
          CONTINUE;
        END IF;
        RAISE EXCEPTION 'Posters may not modify jobs.% after escrow is funded', changed_col
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;
