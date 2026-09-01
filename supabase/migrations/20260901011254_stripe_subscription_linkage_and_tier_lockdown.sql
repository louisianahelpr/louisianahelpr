-- Link a profile to the Stripe subscription paying for it, say the true thing
-- about renewal, and put a privilege wall in front of the tier columns.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
--
-- Until 2026-09-01 the database held NO reference to Stripe for a membership.
-- `profiles.subscription_tier` and `subscription_expires_at` were the entire
-- record, and the join back to Stripe was the customer's EMAIL — a column with
-- no unique constraint that a person can hold on several Stripe customers at
-- once (check-pro-subscription lists up to 100 for one address, precisely
-- because `limit: 1` was downgrading paying members).
--
-- That is why the `current_period_end` outage was invisible from our own data.
-- Stripe removed that property from the Subscription object in API version
-- 2025-03-31.basil; every subscription grant read `undefined`, threw
-- `RangeError` on `new Date(NaN).toISOString()`, 500-ed the webhook and let
-- Stripe give up. Cards were charged and tiers were never granted — for the
-- entire life of the pinned API version. Nothing in this schema could have
-- answered "does every paid tier correspond to a live Stripe subscription, and
-- vice versa?", so nothing did.
--
-- Four columns fix that, and one of them (`subscription_billing_cycle`) also
-- fixes a truthfulness defect the Membership card had been shipping: it printed
-- "Renews {date}" for a 30-day one-time pass that LAPSES and for a cancelled
-- subscription that ENDS, because nothing in the schema recorded which of the
-- three it was. SubscriptionTab.tsx says so in its own comment.
--
-- ── WHY THESE COLUMNS AND NOT A SIDE TABLE ──────────────────────────────────
--
-- `profiles.stripe_account_id` (Connect) already lives here, pinned by
-- prevent_self_escalation, and the reconciler wants one row per member in one
-- read. A side table would add a join to every check for no privacy gain — see
-- the exposure analysis below, which is what actually settles it.
--
-- ── PRIVACY: WHO CAN READ A STRIPE CUSTOMER ID ──────────────────────────────
--
-- A Stripe customer id is not a secret but it is an identifier, so this was
-- checked rather than assumed. `profiles` has exactly three surviving SELECT
-- policies (the broad "Anyone can view approved profiles" / "Profiles are
-- viewable by everyone" were both dropped, 20260312230618 / 20260312230949):
--
--   "Users can view their own profile"    USING (auth.uid() = user_id)
--   "Admins can view all profiles"        USING (has_role(auth.uid(),'admin'))
--   "Service role can view all profiles"  USING (true)  TO service_role
--
-- So no member can read another member's row at all, and the cross-member read
-- path is `get_safe_profiles()` — a SECURITY DEFINER function with an EXPLICIT
-- RETURNS TABLE column list (20260831213259). It does not `SELECT *`, so a new
-- column cannot leak into it by accident; adding one there is a deliberate act.
-- Same for `get_public_profile_stats`. Nothing else on `profiles` is exposed
-- to anon.
--
-- The residual exposure is the owner reading their OWN customer id through a
-- `select("*")`, which is their own identifier and the same string Stripe shows
-- them in the billing portal. Accepted.
--
-- ── REPLAY-SAFETY ───────────────────────────────────────────────────────────
-- Every statement is IF NOT EXISTS / OR REPLACE / DROP-then-CREATE, and nothing
-- here depends on an object a later migration defines. Applied three times in a
-- row against a prod-shaped PGlite schema with assertions; see the report.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The linkage columns
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id                text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id            text,
  ADD COLUMN IF NOT EXISTS subscription_billing_cycle        text,
  ADD COLUMN IF NOT EXISTS subscription_cancel_at_period_end boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.stripe_customer_id IS
  'Stripe Customer that paid for the current membership. Written only by the service role (stripe-webhook, subscription-reconciliation). Deliberately NOT cleared when a subscription ends: the customer record survives cancellation and is the durable handle for reconciling a later resubscribe.';

COMMENT ON COLUMN public.profiles.stripe_subscription_id IS
  'Stripe Subscription granting the current tier. NULL for a one-time pass (which has no subscription object at all) and NULL once the subscription is cancelled or deleted. The join key subscription-reconciliation prefers over email.';

COMMENT ON COLUMN public.profiles.subscription_billing_cycle IS
  'How the current tier was bought: monthly | annual | one_time. NULL means unknown (a row granted before 2026-09-01, or a manual grant) and the UI must then say neither "renews" nor "expires" — see SubscriptionTab.tsx. This is what stops a 30-day pass being advertised as auto-renewing.';

COMMENT ON COLUMN public.profiles.subscription_cancel_at_period_end IS
  'True when Stripe reports the subscription will not renew at the end of the paid period. The tier is still valid until subscription_expires_at — this only changes what the card SAYS ("Ends" rather than "Renews").';

-- Lookup indexes for the reconciler, which resolves both directions
-- (profile -> Stripe and Stripe -> profile). Partial: the vast majority of
-- rows are free accounts holding NULL, and there is no reason to index them.
--
-- NOT UNIQUE, deliberately. A unique index here would be a constraint the
-- STRIPE WEBHOOK can violate, and a webhook that 500s is the exact failure this
-- migration exists to make detectable: card charged, tier never granted,
-- Stripe retries and gives up. Two profiles carrying one subscription id is
-- real drift and worth knowing about — so it is a FINDING in
-- subscription-reconciliation, not a write that fails at 2am.
CREATE INDEX IF NOT EXISTS profiles_stripe_customer_id_idx
  ON public.profiles (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_stripe_subscription_id_idx
  ON public.profiles (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- Same reasoning applies to a CHECK on subscription_billing_cycle. It is NOT
-- added: the only writers are three service-role code paths that normalise
-- through a whitelist, so a CHECK could never fire in normal operation — and
-- the one situation where it COULD fire is a careless future writer inside the
-- webhook, where the cost of a rejected write is a lost entitlement on a
-- captured payment. An unexpected value is reported by the reconciler instead.

-- Finding rows the sweep must look at: a tier that will never lapse.
CREATE INDEX IF NOT EXISTS profiles_tier_without_expiry_idx
  ON public.profiles (user_id)
  WHERE subscription_tier IS NOT NULL AND subscription_expires_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Belt: column-level UPDATE privilege on the billing group
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Today the ONLY thing standing between a member and `subscription_tier =
-- 'elite'` is the BEFORE UPDATE trigger `tr_prevent_self_escalation`, which
-- pins the column back to OLD. It works — a PATCH really does come back with
-- the old value — but it answers **200**. The attempt succeeds as far as HTTP
-- is concerned, silently reverts, and leaves nothing behind. You cannot alert
-- on it, count it, or find it after the fact.
--
-- `businesses` was given belt-and-braces for exactly this
-- (20260818071500 = column GRANT, 20260818090000 = trigger). This is the same
-- treatment for the profiles billing group, and after it a self-escalation
-- attempt is a hard `42501 permission denied for column subscription_tier`
-- instead of a quiet no-op.
--
-- WHY REVOKE-THEN-REGRANT AND NOT `REVOKE UPDATE (col)`. Because the latter is
-- a NO-OP and deploys green — 20260818070000 shipped exactly that against
-- `businesses` and changed nothing, because column-level REVOKE only removes
-- entries from pg_attribute.attacl and the privilege was coming from a
-- TABLE-level grant in pg_class.relacl. Verified there, after that migration
-- had "succeeded", that has_column_privilege() was still true. The only
-- construct that works is to drop the table grant and re-grant the complement.
--
-- WHY THIS CANNOT BREAK THE APP. Verified before writing: nothing under `src/`
-- writes any of these four columns. `grep -rn "subscription_tier" src/` returns
-- reads, type declarations, admin filters and tests only — never an
-- `.update({ subscription_tier … })`. Every writer is service role
-- (stripe-webhook, check-pro-subscription, expire-subscriptions,
-- subscription-reconciliation), and service_role's grants are untouched.
--
-- WHY NOT A HAND-TYPED COLUMN LIST. 20260818090000 chose a trigger over grants
-- on `businesses` specifically to avoid enumerating the writable column set —
-- "miss one and the settings page starts failing at runtime". That objection is
-- real and `profiles` is far wider than `businesses` was, so the list is not
-- typed at all: it is DERIVED from the catalog, as the complement of an
-- explicit locked set. Nothing can be missed today.
--
-- And a column added by a LATER migration would come up with no grant, which is
-- the same outage by a slower route — eight migrations altered `profiles` in
-- August alone. So the derivation lives in a function, `sync_profiles_update_grants()`,
-- which any future migration adding a profiles column should call, and which a
-- cron re-runs so a forgotten call self-heals instead of becoming a 42501 in
-- production. The cron does the catalog READ every time and the DDL only when
-- it finds a gap — `GRANT` takes an ACCESS EXCLUSIVE lock and running one
-- unconditionally against a table this hot, on a schedule, would be its own
-- outage.

-- The locked set, in one place. To lock another profiles column, add it here
-- and re-run the sync — do not hand-write GRANT statements elsewhere.
CREATE OR REPLACE FUNCTION public.profiles_locked_update_columns()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'subscription_tier',
    'subscription_expires_at',
    'stripe_customer_id',
    'stripe_subscription_id',
    'subscription_billing_cycle',
    'subscription_cancel_at_period_end'
  ]::text[];
$$;

REVOKE ALL ON FUNCTION public.profiles_locked_update_columns() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.profiles_locked_update_columns() IS
  'Single source of truth for which public.profiles columns authenticated may NOT update. Consumed by sync_profiles_update_grants().';

-- Returns jsonb {repaired, granted_columns, locked_columns} so a caller (and
-- the cron) can see whether it actually had to do anything.
CREATE OR REPLACE FUNCTION public.sync_profiles_update_grants()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_locked    text[] := public.profiles_locked_update_columns();
  v_writable  text[];
  v_needs_fix boolean := false;
  v_col       text;
BEGIN
  -- Every non-system, non-locked column of public.profiles.
  SELECT array_agg(a.attname::text ORDER BY a.attnum)
    INTO v_writable
    FROM pg_attribute a
   WHERE a.attrelid = 'public.profiles'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND NOT (a.attname::text = ANY (v_locked));

  IF v_writable IS NULL OR array_length(v_writable, 1) IS NULL THEN
    -- Nothing to grant. Should be impossible; refuse to proceed rather than
    -- revoke UPDATE and grant nothing back.
    RETURN jsonb_build_object('repaired', false, 'reason', 'no writable columns resolved');
  END IF;

  -- Drift test, cheap and lock-free: any locked column still updatable, or any
  -- writable column that is not.
  IF has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
     OR has_table_privilege('anon', 'public.profiles', 'UPDATE') THEN
    v_needs_fix := true;
  ELSE
    FOREACH v_col IN ARRAY v_locked LOOP
      IF has_column_privilege('authenticated', 'public.profiles', v_col, 'UPDATE') THEN
        v_needs_fix := true;
      END IF;
    END LOOP;
    IF NOT v_needs_fix THEN
      FOREACH v_col IN ARRAY v_writable LOOP
        IF NOT has_column_privilege('authenticated', 'public.profiles', v_col, 'UPDATE') THEN
          v_needs_fix := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;
  END IF;

  IF NOT v_needs_fix THEN
    RETURN jsonb_build_object('repaired', false,
                              'locked_columns', to_jsonb(v_locked),
                              'granted_columns', array_length(v_writable, 1));
  END IF;

  -- anon loses UPDATE outright and gets nothing back: the surviving UPDATE
  -- policies both require auth.uid(), which anon does not have, so the grant
  -- was reachable-but-useless. service_role is untouched — it is what every
  -- Stripe writer authenticates as.
  REVOKE UPDATE ON public.profiles FROM authenticated, anon;
  EXECUTE format(
    'GRANT UPDATE (%s) ON public.profiles TO authenticated',
    (SELECT string_agg(quote_ident(c), ', ') FROM unnest(v_writable) AS c)
  );

  RETURN jsonb_build_object('repaired', true,
                            'locked_columns', to_jsonb(v_locked),
                            'granted_columns', array_length(v_writable, 1));
END;
$fn$;

REVOKE ALL ON FUNCTION public.sync_profiles_update_grants() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.sync_profiles_update_grants() IS
  'Re-derives authenticated''s column-level UPDATE grants on public.profiles as the complement of profiles_locked_update_columns(). Idempotent and DDL-free when already correct. CALL THIS from any future migration that adds a column to profiles; the sync-profiles-update-grants cron is the safety net, not the mechanism.';

SELECT public.sync_profiles_update_grants();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Braces: the trigger, extended to the new columns — and made auditable
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CAREFUL — DO NOT REINTRODUCE THE RECURSION. 20260621120000 had to strip the
-- column pins out of the "Users can update their own safe fields" POLICY
-- because its WITH CHECK compared each privileged column against a subquery
-- `SELECT … FROM public.profiles`. Evaluating a same-table subquery inside a
-- WITH CHECK re-enters profiles' RLS and Postgres raises "infinite recursion
-- detected in policy for relation profiles" — every authenticated profile
-- UPDATE 500-ed, surfacing as the "new row violates row-level security policy"
-- toast on the complete-profile step.
--
-- Neither layer added here can bring that back:
--   * a column GRANT is a privilege in the catalog, not a policy, and is
--     evaluated before RLS — it cannot re-enter anything;
--   * a BEFORE UPDATE trigger sees OLD/NEW directly. This one adds no SELECT
--     against public.profiles (the audit INSERT targets error_logs), so it
--     still never re-enters profiles' RLS.
-- The policy itself is left exactly as 20260621120000 wrote it. Untouched.
--
-- Body below is 20260827193414's verbatim, plus the four new pins and the
-- audit block. Every existing pin is preserved character-for-character.

CREATE OR REPLACE FUNCTION public.prevent_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_billing_attempt boolean;
  -- Captured BEFORE the pins below overwrite NEW. Logging NEW.subscription_tier
  -- from the audit block at the bottom records the value that was pinned back,
  -- i.e. the tier they already had — an audit row that cannot tell you what was
  -- attempted. (Caught by the PGlite harness, which asserted the attempted tier
  -- and got null.)
  v_attempted_tier text;
BEGIN
  IF auth.uid() IS NULL OR has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Did this write actually try to move the billing group? Computed BEFORE the
  -- pins below overwrite NEW, and only over that group: the other ~40 pins
  -- routinely receive a full-row payload from a client that is simply echoing
  -- what it read, and logging those would bury the one that matters.
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

  NEW.is_licensed := OLD.is_licensed;
  NEW.is_insured := OLD.is_insured;

  -- The acceptance gate's own inputs (migration 20260827191647).
  NEW.stripe_identity_verified := OLD.stripe_identity_verified;
  NEW.stripe_identity_verified_at := OLD.stripe_identity_verified_at;
  NEW.stripe_charges_enabled := OLD.stripe_charges_enabled;
  NEW.stripe_payouts_enabled := OLD.stripe_payouts_enabled;
  NEW.is_seed := OLD.is_seed;

  -- The Stripe linkage. Server-owned for the same reason the tier is: these
  -- are what the reconciler trusts to decide whether a tier was paid for, so a
  -- member who could write them could forge the evidence of their own
  -- subscription.
  NEW.stripe_customer_id := OLD.stripe_customer_id;
  NEW.stripe_subscription_id := OLD.stripe_subscription_id;
  NEW.subscription_billing_cycle := OLD.subscription_billing_cycle;
  NEW.subscription_cancel_at_period_end := OLD.subscription_cancel_at_period_end;

  -- Leave a trace. With the column GRANT above in place PostgREST now rejects
  -- these writes with 42501 before the trigger is ever reached, so this branch
  -- should be unreachable from the app — which is exactly why it is worth
  -- keeping: if it ever fires, the privilege wall has a hole in it, and that is
  -- the thing you want to be told about.
  --
  -- Rate-limited to one row per user per hour so an attacker cannot turn the
  -- audit trail into a write amplifier, and wrapped so that NO failure here can
  -- ever fail a member's profile UPDATE. An audit log that can break the app it
  -- audits gets removed the first time it does.
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

-- Trigger functions are invoked by the row-change machinery and need no
-- EXECUTE grant; revoking only removes the /rest/v1/rpc surface. Matches
-- 20260818090000 and the posture set by 20260505190000.
REVOKE ALL ON FUNCTION public.prevent_self_escalation() FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Cron expectations: expire-subscriptions, and a liveness rule that can
--    actually see a job that stopped running
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `expire-subscriptions` runs daily at 08:09 UTC and had NO row in
-- cron_work_expectations, so a run that stopped happening was invisible.
--
-- But the existing mechanism cannot express "it stopped running" at all. Its
-- predicate is "candidates were found AND none were dispositioned", which is
-- evaluated over runs that DID happen — a job that never fires produces no
-- rows, and no rows means no streak means silence. That is the right design for
-- what it was built for (a cron whose correct output is usually zero must not
-- page for zero) and it is the wrong shape for liveness. So liveness is added
-- as a separate, opt-in assertion rather than bent out of the existing one.

ALTER TABLE public.cron_work_expectations
  ADD COLUMN IF NOT EXISTS expected_max_gap interval NULL;

COMMENT ON COLUMN public.cron_work_expectations.expected_max_gap IS
  'Longest silence tolerated between two recorded runs of this job before it is treated as dead. NULL disables the liveness check. Set it to the schedule interval plus real slack — a daily job at 08:09 should not page because one run slipped 40 minutes.';

-- expire-subscriptions. `found` is a NEW key added to its body by this change;
-- the function previously reported only `cleared`, and `cleared` alone is
-- exactly the expectation the header of 20260829020000 warns against — this
-- cron's correct output is zero on almost every day of its life, so
-- "cleared = 0" must never be suspicious on its own. The suspicious sentence is
-- "found N expired subscriptions and cleared none of them", which is the same
-- shape as the payment-confirm-reminder bug.
--
-- `unexpirable` is NOT a disposition key. It counts rows the sweep structurally
-- cannot clean (a tier with no expiry); counting it as work done would let a
-- run report "found 3, cleared 0, unexpirable 3" and look healthy.
INSERT INTO public.cron_work_expectations
  (jobname, candidate_key, disposition_keys, min_streak, note, expected_max_gap)
VALUES
  ('expire-subscriptions', 'found', ARRAY['cleared'], 2,
   'found>0 with cleared=0 means expired memberships were identified and none were revoked — paid perks retained for free. Zero-candidate days are invisible to this rule by construction, which is the point: this cron correctly does nothing most days. Liveness is asserted separately via expected_max_gap.',
   interval '30 hours'),
  ('subscription-reconciliation', 'profiles_scanned', ARRAY['findings_total','repaired'], 2,
   'Scanning profiles and producing neither a finding nor a repair for two consecutive runs is fine and common; this rule only fires if the scan itself reports rows and every outcome key is absent, which means the check loop stopped executing.',
   interval '30 hours')
ON CONFLICT (jobname) DO UPDATE
  SET candidate_key    = EXCLUDED.candidate_key,
      disposition_keys = EXCLUDED.disposition_keys,
      min_streak       = EXCLUDED.min_streak,
      note             = EXCLUDED.note,
      expected_max_gap = EXCLUDED.expected_max_gap;

-- Give money-reconciliation the same liveness assertion while we are here: it
-- is the other daily money cron and it has the same blind spot. Its
-- work-expectation columns are left alone (it has none, deliberately — a
-- reconciler that finds nothing is the desired outcome).
INSERT INTO public.cron_work_expectations
  (jobname, candidate_key, disposition_keys, min_streak, note, expected_max_gap)
VALUES
  ('money-reconciliation', 'scanned', ARRAY[]::text[], 2,
   'Liveness only. disposition_keys is empty and candidate_key names an object, not a number, so the silent-work rule can never fire for this job — `l.body ? candidate_key` passes but the numeric cast yields 0 candidates and the suspicious predicate requires candidates > 0.',
   interval '30 hours')
ON CONFLICT (jobname) DO UPDATE
  SET expected_max_gap = EXCLUDED.expected_max_gap;

-- ── The liveness sweep ──────────────────────────────────────────────────────
-- Separate function rather than more branches inside sweep_silent_cron_failures:
-- that one is about the CONTENT of runs that happened, this is about runs that
-- did not. Keeping them apart means neither can break the other, and this file
-- does not have to restate 130 lines of detection logic it is not changing.
CREATE OR REPLACE FUNCTION public.sweep_dead_crons()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_flagged int := 0;
  v_names   text[] := ARRAY[]::text[];
  r         record;
BEGIN
  FOR r IN
    SELECT c.jobname,
           c.expected_max_gap,
           max(l.occurred_at) AS last_run
      FROM public.cron_work_expectations c
      JOIN public.cron_run_log l ON l.jobname = c.jobname
     WHERE c.expected_max_gap IS NOT NULL
     GROUP BY c.jobname, c.expected_max_gap
    -- The JOIN is what makes a never-yet-recorded job invisible: with zero
    -- rows there is no way to tell "deployed five minutes ago" from "dead for
    -- a month", and guessing wrong in the alarming direction is how a detector
    -- gets muted. It becomes eligible the moment it reports once.
    HAVING max(l.occurred_at) < now() - c.expected_max_gap
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.error_logs e
       WHERE e.tags->>'source' = 'cron-dead'
         AND e.tags->>'job' = r.jobname
         AND e.created_at > date_trunc('day', now())
    ) THEN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        'error',
        format('Dead cron: %s has not reported a run since %s (tolerance %s)',
               r.jobname, r.last_run, r.expected_max_gap),
        jsonb_build_object('source', 'cron-dead', 'area', 'cron', 'job', r.jobname),
        jsonb_build_object('last_run', r.last_run,
                           'expected_max_gap', r.expected_max_gap::text));
      v_flagged := v_flagged + 1;
      v_names := v_names || r.jobname;
    END IF;
  END LOOP;

  IF v_flagged > 0 THEN
    BEGIN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/slack-ops-alert',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
          'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'title', format('%s cron(s) have stopped running', v_flagged),
          'message', format('Affected: %s. No run recorded within the configured tolerance. See error_logs (tags.source = cron-dead).',
                            array_to_string(v_names, ', ')),
          'severity', 'error'));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object('flagged', v_flagged, 'jobs', to_jsonb(v_names));
END;
$fn$;

REVOKE ALL ON FUNCTION public.sweep_dead_crons() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.sweep_dead_crons() IS
  'Flags configured crons that have stopped reporting runs entirely. Complement to sweep_silent_cron_failures(), which only inspects runs that DID happen.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Schedules
-- ═══════════════════════════════════════════════════════════════════════════
--
-- pg_cron may not be installed on a from-scratch rebuild, so the whole block is
-- skipped rather than erroring (same guard as 20260831190419). cron.schedule
-- upserts by jobname, so replaying this file is a no-op.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping schedules';
    RETURN;
  END IF;

  -- SQL-only sweeps produce no http_response to attribute, so they do not need
  -- a unique minute from 20260829010000's stagger map. :53 is free.
  BEGIN PERFORM cron.unschedule('sweep-dead-crons'); EXCEPTION WHEN OTHERS THEN NULL; END;
  PERFORM cron.schedule('sweep-dead-crons', '53 * * * *',
    $cron$SELECT public.sweep_dead_crons();$cron$);

  -- Grant self-heal. Ten-minutely because the window it closes is "a migration
  -- added a profiles column and the client starts writing it" — a day-long lag
  -- would be an outage, not a safety net. The function is a catalog read unless
  -- it finds drift, so this is cheap and takes no lock on the common path.
  BEGIN PERFORM cron.unschedule('sync-profiles-update-grants'); EXCEPTION WHEN OTHERS THEN NULL; END;
  PERFORM cron.schedule('sync-profiles-update-grants', '4-59/10 * * * *',
    $cron$SELECT public.sync_profiles_update_grants();$cron$);

  -- The Stripe drift check. 08:24 UTC: after expire-subscriptions (08:09), so
  -- it audits the state that sweep has already produced rather than racing it,
  -- and on a free minute (08:20 is money-reconciliation).
  BEGIN PERFORM cron.unschedule('subscription-reconciliation'); EXCEPTION WHEN OTHERS THEN NULL; END;
  PERFORM cron.schedule('subscription-reconciliation', '24 8 * * *',
    $cron$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/subscription-reconciliation',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{}'::jsonb
      );
    $cron$);
END;
$$;
