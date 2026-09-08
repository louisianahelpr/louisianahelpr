-- Two BEFORE-INSERT triggers on `jobs` disagreed about what "open" means,
-- and the disagreement was exploitable.
--
-- `enforce_open_job_limit` runs first (alphabetically 'e' < 't') and reads
-- the CLIENT-SUPPLIED `NEW.status` to decide whether to count this insert
-- against the 5-open-job cap — it skips counting whenever status isn't
-- literally 'open'. `enforce_jobs_insert_column_lock` runs after it and
-- unconditionally forces `NEW.status := 'open'` for any self-insert. So an
-- authenticated poster could insert with `status: 'in_progress'` (or
-- 'completed', or anything but 'open'), the cap trigger would see the
-- pre-reset value and wave it through uncounted, and the lock trigger would
-- then rewrite the row to 'open' anyway — landing an uncapped sixth, seventh,
-- Nth open job. Reproduced by three independent audit lanes against prod,
-- rolled back each time.
--
-- The lock is otherwise correct and this migration does not touch it — the
-- fix belongs in the cap check, and it has to preserve the one legitimate
-- reason the short-circuit exists: `charge-recurring-visits` inserts a
-- child occurrence directly into `status = 'accepted'` as service_role
-- (auth.uid() IS NULL), and that insert genuinely should not compete for the
-- POSTER's 5-open-job budget the way a fresh post does. The fix narrows the
-- skip to exactly that case — no authenticated caller inserting as their own
-- customer_id can skip the count, regardless of what status they send,
-- because the lock guarantees their row lands as 'open' either way.
--
-- Second, separate hole closed here: `enforce_jobs_insert_column_lock`
-- resets 8 money/lifecycle columns but not the lifecycle TIMESTAMPS
-- (helper_confirmed_at, helper_on_the_way_at, helper_arrived_at,
-- helper_arrival_verified_at, poster_confirmed_at, helper_completed_at,
-- poster_completed_at, payout_scheduled_at). A poster could insert a job
-- with `helper_completed_at` and `poster_completed_at` already set,
-- `helper_id` naming a real (uncooperative or unaware) helper — the lock
-- nulls `helper_id`, but the timestamps survive the INSERT. Once that helper
-- is later legitimately hired through the normal accept flow, both
-- timestamps are already in place, and `auto-release-payment`'s own due
-- query (`poster_completed_at <= cutoff OR helper_completed_at <= cutoff`)
-- matches immediately — releasing full escrow to a helper who was just
-- hired and has done no work. Reproduced on prod, rolled back.

CREATE OR REPLACE FUNCTION public.enforce_open_job_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  open_count integer;
BEGIN
  -- Skip counting ONLY for a non-self insert (service_role recurring-series
  -- creation, or an admin/impersonation path where the caller is not the
  -- job's own customer_id). A self-insert always gets counted, no matter
  -- what status it names, because trg_jobs_insert_column_lock forces every
  -- self-inserted row to 'open' regardless — so the cap must judge the value
  -- the row will actually land as, not the value the client sent.
  IF NEW.status IS DISTINCT FROM 'open'
     AND NOT (auth.uid() IS NOT NULL AND auth.uid() = NEW.customer_id) THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO open_count
  FROM public.jobs
  WHERE customer_id = NEW.customer_id
    AND status = 'open'
    AND payment_status IS DISTINCT FROM 'abandoned';

  IF open_count >= 5 THEN
    RAISE EXCEPTION 'You can have a maximum of 5 open jobs at a time. Please wait for existing jobs to be accepted or close them first.';
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
  -- Service role (uid NULL) and anyone not inserting their own job pass
  -- through untouched. Same gate as the UPDATE money lock.
  IF auth.uid() IS NULL
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

  -- Fixture flag: a poster must not be able to hide a job from the admin
  -- money figures by marking it seed data.
  NEW.is_seed                  := false;

  -- A new job is open and unassigned. Assignment happens on UPDATE, through
  -- accept_application / the direct-offer flow; a direct offer at post time
  -- uses offered_to_helper_id, which is deliberately left writable.
  NEW.status                   := 'open';
  NEW.helper_id                := NULL;

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
  NEW.poster_confirmed_at         := NULL;
  NEW.helper_completed_at         := NULL;
  NEW.poster_completed_at         := NULL;
  NEW.payout_scheduled_at         := NULL;

  RETURN NEW;
END;
$function$;
