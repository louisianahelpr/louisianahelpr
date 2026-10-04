-- Q1253 (docs/OPEN.md): jobs.id was client-chosen on a poster's INSERT.
--
-- A mailinator account could insert a job with an id it picked, e.g. one
-- whose deleted_jobs_log row was pruned. Q1189 (20261004165404) closed the
-- created_at half; this closes the id half the same way: the client-INSERT
-- branch of enforce_jobs_insert_column_lock resets NEW.id to a fresh
-- gen_random_uuid(). Measured first (2026-10-04): no client payload carries
-- id (src/pages/post-job/jobSubmitHelpers.ts buildJobPayload; the e2e REST
-- posts), and the post flow reads the new id back with .select("id"), so
-- nothing the app does changes. Server inserts (service_role, definer RPCs
-- outside the poster's own-row branch) keep the id they set.
--
-- Restated from its newest definition, 20261004165404 (md5(prosrc) live
-- 175e0eb46c681b2211139fbb7ee65a87 = that file), plus the one assignment.
-- Replay-safe: CREATE OR REPLACE; the trigger is unchanged.

CREATE OR REPLACE FUNCTION public.enforce_jobs_insert_column_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_jobs_insert_column_lock() FROM PUBLIC, anon, authenticated;
