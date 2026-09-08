-- Two client-writable surfaces that should never have been client-writable.
--
-- ── 1. reviews: blind-period bypass and forged reviewee responses ───────────
--
-- `authenticated` (and `anon`) hold column-level INSERT on reviews.
-- feedback_visible_at, response_text, response_at and status. Each is a
-- one-request abuse through PostgREST:
--
--   (a) BLIND-PERIOD BYPASS. The double-blind hold exists so neither party can
--       read the other's review before writing their own.
--       set_review_visibility() deliberately SKIPS when feedback_visible_at
--       arrives pre-set (its comment calls that an "admin override or
--       backfill"), and enforce_review_validity() does not look at the column
--       at all. So a reviewer can insert with feedback_visible_at = now() and
--       be public immediately — exactly the retaliation window the hold closes.
--
--   (b) FORGED RESPONSE. response_text renders publicly as "Response from
--       {reviewee's name}" (src/pages/userProfile/ReviewsSection.tsx:258). The
--       legitimate writer is the respond_to_review RPC, called by the
--       REVIEWEE. Nothing stopped the REVIEWER supplying response_text in
--       their own INSERT — words in the reviewed person's mouth, under that
--       person's name, authored by their critic.
--
-- THE OBVIOUS FIX DOES NOT WORK, and the failure is silent. Revoking the
-- COLUMN-level INSERT privilege leaves the abuse fully working, because both
-- roles also hold TABLE-level INSERT on public.reviews — and a table-wide
-- grant covers every column. Column privileges are additive to table
-- privileges; you cannot subtract a column from a table grant. Measured: after
-- running both REVOKE ... (columns) statements inside a transaction, the exact
-- abuse insert below still SUCCEEDED.
--
-- The alternative — revoke table INSERT and re-grant an explicit column
-- allow-list — is a worse trade here: it silently breaks any writer whose
-- column set I failed to enumerate, and review submission is a path I cannot
-- afford to guess at.
--
-- So enforcement moves into enforce_review_validity(), the BEFORE INSERT
-- SECURITY DEFINER trigger that already guards this table. It is
-- grant-independent (covers authenticated AND anon), and it cannot break an
-- insert that names other columns. Admins keep the override the
-- set_review_visibility comment refers to.
--
-- Body below is the live definition verbatim plus the sanitising block.
CREATE OR REPLACE FUNCTION public.enforce_review_validity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job RECORD;
BEGIN
  IF NEW.reviewer_id = NEW.reviewee_id THEN
    RAISE EXCEPTION 'You cannot review yourself.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT customer_id, helper_id, status INTO v_job FROM public.jobs WHERE id = NEW.job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job % not found.', NEW.job_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_job.status <> 'completed' THEN
    RAISE EXCEPTION 'Reviews can only be left after the job is marked completed.'
      USING ERRCODE = 'check_violation', HINT = 'Current status: ' || v_job.status::text;
  END IF;
  IF NEW.reviewer_id NOT IN (v_job.customer_id, v_job.helper_id) THEN
    RAISE EXCEPTION 'Only the job poster or assigned helper can submit a review.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reviewer_id = v_job.customer_id AND NEW.reviewee_id <> v_job.helper_id THEN
    RAISE EXCEPTION 'Customer must review the assigned helper.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reviewer_id = v_job.helper_id AND NEW.reviewee_id <> v_job.customer_id THEN
    RAISE EXCEPTION 'Helper must review the customer who hired them.' USING ERRCODE = 'check_violation';
  END IF;

  -- ADDED 2026-09-04 — server owns these four columns on a client insert.
  -- auth.uid() IS NULL is the service_role/trigger path (backfills, seeds);
  -- an admin keeps the deliberate override. Everyone else gets them reset,
  -- whatever they sent:
  --   feedback_visible_at -> NULL so set_review_visibility() actually runs
  --     (it early-returns when the column arrives pre-set, which is precisely
  --     how a reviewer could publish instantly and read the reply first).
  --   response_text/at    -> NULL; the reviewee's reply belongs to
  --     respond_to_review(), not to the person being reviewed BY.
  --   status              -> the 'published' default.
  IF auth.uid() IS NOT NULL AND NOT has_role(auth.uid(), 'admin') THEN
    NEW.feedback_visible_at := NULL;
    NEW.response_text       := NULL;
    NEW.response_at         := NULL;
    NEW.status              := 'published';
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 2. jobs.boost_auto_extended: writable by a targeted helper ─────────────
--
-- prevent_job_field_escalation()'s poster_locked_always list carries
-- boosted_at and boost_expires_at but NOT boost_auto_extended. The poster has
-- their own trigger (enforce_poster_jobs_money_lock, which does lock all
-- three) and the assigned helper has the column whitelist — but a helper
-- holding a PENDING DIRECT OFFER is checked only here, and fell through.
-- Proven live in BEGIN..ROLLBACK: as role authenticated with sub = the offered
-- helper, `UPDATE jobs SET boost_auto_extended = false` SUCCEEDED on a job
-- with direct_offer_status='pending'.
--
-- Why it matters: boost_auto_extended is the once-only latch for
-- extend_boosts_with_no_applications() (hourly cron, grants a free +12h).
-- Re-arming it each cycle turns one $3 boost into indefinite featured
-- placement; setting it true denies a paying subscriber the extension they
-- were sold. Either direction is paid-placement integrity.
--
-- THE BODY BELOW IS THE LIVE DEFINITION VERBATIM (pg_get_functiondef), with
-- exactly one array entry added. It is reproduced in full rather than patched
-- from memory on purpose: a CREATE OR REPLACE assembled from a half-remembered
-- body is how a security check gets silently dropped — a first draft of this
-- migration lost the "may only assign the job to themselves" guard at the end
-- and would have shipped that regression with every test green.
CREATE OR REPLACE FUNCTION public.prevent_job_field_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  -- Tier 1 — no authenticated client writes these through ANY path. The only
  -- writers are rpc_decide_dispute (admin-only, exempt above) and the
  -- escrow/payout edge functions, which run as service_role and return at the
  -- auth.uid() IS NULL gate.
  locked_everyone CONSTANT text[] := ARRAY[
    'platform_fee_amount',
    'platform_fee_percent',
    'helper_fee_percent',
    'customer_fee_amount',
    'commission_tax_amount',
    'sales_tax_amount',
    'sales_tax_rate',
    'protection_fee',
    'urgent_fee',
    'payout_scheduled_at',
    'has_active_dispute'
  ];
  poster_locked_always CONSTANT text[] := ARRAY[
    'payment_status',
    'stripe_payment_intent_id',
    'stripe_session_id',
    'boosted_at',
    'boost_expires_at',
    -- ADDED 2026-09-04. Without it, a pending-direct-offer helper could clear
    -- or set the once-only auto-extension latch: clearing it re-arms a free
    -- +12h featured placement every hour off a single $3 boost; setting it
    -- denies a paying subscriber the extension they bought.
    'boost_auto_extended',
    'is_urgent',
    'is_seed',
    'customer_id'
  ];
  poster_locked_when_funded CONSTANT text[] := ARRAY[
    'budget',
    'urgent_fee',
    'payment_status',
    'stripe_payment_intent_id',
    'helper_id',
    'poster_completed_at'
  ];
  v_is_target boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF changed_col = ANY (locked_everyone) THEN
      RAISE EXCEPTION 'jobs.% is set by the platform, not by a client', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- The poster and the assigned helper have a column-lock trigger each
  -- (enforce_poster_jobs_money_lock / enforce_helper_jobs_column_whitelist).
  -- Leave them to those, so there is exactly one place to read per role.
  IF auth.uid() = OLD.customer_id OR auth.uid() = OLD.helper_id THEN
    RETURN NEW;
  END IF;

  -- The business-member branch used to sit here. Business accounts are gone,
  -- so the targeted helper is the only remaining third party with any UPDATE
  -- grant on a job row.
  v_is_target := OLD.offered_to_helper_id IS NOT NULL
                 AND auth.uid() = OLD.offered_to_helper_id;

  IF NOT v_is_target THEN
    -- No policy grants anyone else UPDATE on this row; RLS decides, as before.
    RETURN NEW;
  END IF;

  -- A deny-list rather than an allow-list, on purpose: the sibling BEFORE
  -- triggers (stamp_job_accepted_at, set_revision_deadline,
  -- track_revision_scope_creep) sort ahead of this one and legitimately mutate
  -- NEW, and their writes are indistinguishable from the client's here.
  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF changed_col = ANY (poster_locked_always) THEN
      RAISE EXCEPTION 'jobs.% is not writable from this seat', changed_col
        USING ERRCODE = '42501';
    END IF;
    IF OLD.payment_status IS DISTINCT FROM 'unpaid'
       AND changed_col = ANY (poster_locked_when_funded) THEN
      -- The one sanctioned write to helper_id: the targeted helper taking a
      -- still-open funded job (respond_to_direct_offer). Identical carve-out
      -- to the poster trigger's.
      IF changed_col = 'helper_id'
         AND OLD.helper_id IS NULL
         AND NEW.helper_id IS NOT NULL
         AND OLD.status = 'open' THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'jobs.% is not writable from this seat after escrow is funded', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- A targeted helper may TAKE the offer; they may not hand the job to
  -- somebody else.
  IF NEW.helper_id IS DISTINCT FROM OLD.helper_id
     AND NEW.helper_id IS NOT NULL
     AND NEW.helper_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'An offered Helpr may only assign the job to themselves'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;
