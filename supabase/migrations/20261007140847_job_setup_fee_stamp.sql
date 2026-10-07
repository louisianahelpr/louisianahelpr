-- Q1346 (lh-money-escrow review of Q1177, 2026-10-05): the $2 one-time
-- account setup fee is billed as a line item on a poster's FIRST escrow
-- checkout, but no jobs column recorded it, so Spent (src/lib/posterSpend.ts)
-- under-counted that job by $2 (and a cancelled first job, whose cancel refund
-- returns the whole capture less the service fee, came out $2 low the other
-- way). Owner's rule for Spent: everything that actually left the poster's
-- card counts.
--
-- jobs.onboarding_fee_amount: dollars of the setup fee the job's checkout
-- collected. Written ONLY by the payment webhook (settleOnboardingFee), and
-- only by the delivery that wins the once-per-account flip; a duplicate fee is
-- refunded there and never stamped. NULL on every other job (and on every job
-- before this column). Server-owned: added to prevent_job_field_escalation's
-- locked_everyone list (restated from the live pg_get_functiondef,
-- 2026-10-07, body equal to the newest migration 20260915101102, with only
-- that entry added), so no client seat can write it.
--
-- The same column is cleared on a client INSERT by enforce_jobs_insert_column_lock
-- (restated from live, body equal to 20261005060416, with that one line added).
--
-- REPLAY-SAFETY: ADD COLUMN IF NOT EXISTS; CREATE OR REPLACE of a function the
-- 2026-09 migrations define; the trigger itself is unchanged.

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS onboarding_fee_amount numeric(10,2);
COMMENT ON COLUMN public.jobs.onboarding_fee_amount IS
  'Q1346: the one-time account setup fee (dollars) this job''s checkout collected; stamped by the stripe-webhook (settleOnboardingFee) on the winning first-fee delivery only. Server-owned.';

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
  -- is_server_context() gate (a NULL uid alone no longer passes: anon has one).
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
    'has_active_dispute',
    -- ADDED 20261007140847 (Q1346): the one-time setup fee this job's checkout
    -- billed, stamped by the payment webhook. Spent reads it.
    'onboarding_fee_amount'
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
    'customer_id',
    -- ADDED 20260915074058 (VN-33(b) authz review). Arrival is attested by the
    -- server (mark_helper_arrival) and the poster, never by a third seat. A
    -- poster can re-open a direct offer on a hired job, and the offeree could
    -- then forge or clear these: stamp a near miss the poster then "confirms",
    -- or clear an arrival so report_helper_no_show strikes a Helpr who came.
    'helper_arrived_at',
    'helper_arrival_verified_at',
    'helper_arrival_near_miss_at',
    'helper_arrival_near_miss_ft',
    'poster_confirmed_arrival_at',
    'poster_confirmed_working_at'
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
  IF public.is_server_context() THEN
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

CREATE OR REPLACE FUNCTION public.enforce_jobs_insert_column_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- A server context and anyone not inserting their own job pass through
  -- untouched. Same gate as the UPDATE money lock.
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM NEW.customer_id THEN
    RETURN NEW;
  END IF;

  -- Escrow state is the webhook's to set, never the poster's.
  NEW.payment_status           := 'unpaid';
  NEW.stripe_payment_intent_id := NULL;
  NEW.stripe_session_id        := NULL;

  -- Paid placement is create-boost-payment's to grant.
  NEW.boosted_at               := NULL;
  NEW.boost_expires_at         := NULL;

  -- Fixture flag: still not the poster's to set — whatever they sent is
  -- discarded — but the answer is now DERIVED from the posting account
  -- rather than hardcoded false. A fixture account's jobs are fixture jobs;
  -- a real account's jobs cannot be hidden, because profiles.is_seed is
  -- itself locked by prevent_self_escalation.
  NEW.is_seed                  := EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = NEW.customer_id
       AND p.is_seed
  );

  -- A new job is open and unassigned. Assignment happens on UPDATE, through
  -- accept_application / the direct-offer flow; a direct offer at post time
  -- uses offered_to_helper_id, which is deliberately left writable.
  NEW.status                   := 'open';
  NEW.helper_id                := NULL;
  -- Q356: a series' standing helper is stamped from the hire, never posted.
  NEW.recurring_helper_id      := NULL;

  -- A brand-new job has lived through none of its own lifecycle. Every one
  -- of these can only be set legitimately by the corresponding server-side
  -- action AFTER a helper is actually hired (accept_application,
  -- mark_helper_arrival, the on-my-way/arrived RPCs, the completion RPCs) —
  -- none of that can have happened yet to a row that does not exist until
  -- this statement returns.
  NEW.helper_confirmed_at         := NULL;
  NEW.helper_on_the_way_at        := NULL;
  NEW.helper_arrived_at           := NULL;
  NEW.helper_arrival_verified_at  := NULL;
  NEW.helper_arrival_near_miss_at := NULL;
  NEW.helper_arrival_near_miss_ft := NULL;
  NEW.poster_confirmed_at         := NULL;
  NEW.helper_completed_at         := NULL;
  NEW.poster_completed_at         := NULL;
  NEW.payout_scheduled_at         := NULL;
  -- Q1346 (20261007140847): the setup fee a checkout collected is the
  -- payment webhook's to stamp, never the poster's.
  NEW.onboarding_fee_amount       := NULL;

  -- Q1189: the row's birth time is the database's. A poster-supplied value
  -- would forge the storage sweep's 90-day trust window (deleted_jobs_log
  -- is keyed on it) and the browse freshness score / early-access cutoff.
  -- The column default is now(), so a normal insert is unchanged.
  NEW.created_at                  := now();

  -- Q1253: the row's id is the database's too. A poster-chosen id could
  -- reuse one whose deleted_jobs_log row was pruned (the storage sweep's
  -- trust window is keyed on it) or collide on purpose with a known id. No
  -- client sends one (useJobSubmit's payload, every e2e REST post: measured
  -- 2026-10-04); the post reads the id back with .select("id").
  NEW.id                          := gen_random_uuid();

  -- Q1283: the direct-offer markers follow the offer, never the poster.
  IF NEW.offered_to_helper_id IS NULL THEN
    NEW.direct_offer_status     := NULL;
    NEW.direct_offer_expires_at := NULL;
  ELSE
    NEW.direct_offer_status     := 'pending';
    NEW.direct_offer_expires_at := LEAST(
      GREATEST(COALESCE(NEW.direct_offer_expires_at, now() + interval '24 hours'),
               now() + interval '1 hour'),
      now() + interval '48 hours');
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.prevent_job_field_escalation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_jobs_insert_column_lock() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_job_field_escalation() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_jobs_insert_column_lock() TO service_role;

-- Column-level SELECT for authenticated (20260915045110): a new jobs column is
-- unreadable until the grants are re-synced. Spent (SpentSection) reads it.
DO $g$
BEGIN
  IF to_regprocedure('public.sync_jobs_select_grants()') IS NOT NULL THEN
    PERFORM public.sync_jobs_select_grants();
  END IF;
END
$g$;
