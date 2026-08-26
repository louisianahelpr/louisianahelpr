-- F-4 + F-1: the dispute flag nobody set, and the unfunded job everybody saw.
--
-- F-4  jobs.has_active_dispute was dead weight. rpc_open_dispute set
--      status='disputed' + dispute_status='open' and NOTHING ever wrote the
--      flag (verified live: zero triggers on public.disputes, and the only
--      functions naming the column were can_review_job, which READS it, and
--      prevent_job_field_escalation, which forbids clients writing it).
--      Consequences: can_review_job's "(has_active_dispute = false OR
--      dispute_resolved_at IS NOT NULL)" clause was a constant TRUE, and
--      money-reconciliation's dispute_flag_without_row check keyed on
--      has_active_dispute = true, so it could never fire.
--
--      Fixed by DERIVING the flag in a BEFORE trigger rather than patching
--      each of the eight paths that open or close a dispute. A derived flag
--      cannot be set-without-clear: every writer, client or service_role,
--      gets the same answer, and a path added later is covered for free.
--
--      Trigger name matters. prevent_job_field_escalation lists
--      has_active_dispute in its locked_everyone deny-list, and BEFORE
--      triggers fire in name order, so this one must sort AFTER
--      trg_prevent_job_field_escalation ('s' > 'p') for its NEW mutation to
--      land past that check. It also sorts after trg_set_dispute_deadline
--      and trg_stamp_recurring_series_helper, so it reads their writes.
--
-- F-1  A declined or abandoned checkout leaves status='open',
--      payment_status='unpaid', and all THREE browse surfaces served it:
--      get_ranked_open_jobs (granted to anon), get_open_jobs_for_map, and
--      the open_jobs_browse view. Each excluded only 'abandoned' — the state
--      void-cancelled-payments assigns ~an hour later — so helpers could
--      apply to an unfunded job in the meantime (nothing gates the
--      applications INSERT policy on funding).
--
--      Fixed by requiring a funded payment_status. 'escrow' is the only
--      funded state an open job actually reaches: the Stripe path
--      (checkoutSessionCompleted), the recurring path
--      (charge-recurring-visits) and the no-Stripe Pay-It-Forward path
--      (redeem_pif_credit) all write exactly 'escrow'. 'payout_pending' and
--      'released' are included so a future reopen of a settled job is not
--      silently swallowed. Nothing legitimately shows an open job before
--      escrow: the poster's own surfaces read public.jobs directly (my-posts),
--      and JobDetail's read of open_jobs_browse is guest-only — a signed-in
--      poster is redirected before the query runs.

-- ─────────────────────────────────────────────────────────────────────────
-- F-4: derive has_active_dispute
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_has_active_dispute()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Terminal dispute states, from every resolution path that exists today:
  --   rpc_decide_dispute        → 'resolved'
  --   rpc_withdraw_dispute      → 'resolved'
  --   auto-resolve-disputes     → 'auto_resolved'
  --   chargeDisputeClosed       → 'resolved' / 'auto_resolved'
  -- Anything else that is set at all ('open' from rpc_open_dispute,
  -- 'escalated' from helper_abort_job, 'stripe_chargeback' from
  -- chargeDisputeCreated, 'reversal_hold' from transferReversed) is live and
  -- freezes escrow, so it counts as active. status='disputed' with a NULL
  -- dispute_status counts too, so a half-written row still reads as frozen.
  NEW.has_active_dispute :=
        COALESCE(NEW.dispute_status IS DISTINCT FROM 'resolved'
                 AND NEW.dispute_status IS DISTINCT FROM 'auto_resolved', true)
    AND (NEW.status = 'disputed' OR NEW.dispute_status IS NOT NULL);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_has_active_dispute ON public.jobs;
CREATE TRIGGER trg_sync_has_active_dispute
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.sync_has_active_dispute();

-- Backfill. Runs as the migration role (auth.uid() IS NULL), so
-- prevent_job_field_escalation returns early and the new trigger computes the
-- value. update_jobs_updated_at is parked for the duration: this is a derived
-- column catching up, not a real edit, and can_review_job's 30-day window and
-- the dashboards' sort both read updated_at. The WHERE clause keeps a re-run
-- a no-op.
ALTER TABLE public.jobs DISABLE TRIGGER update_jobs_updated_at;

UPDATE public.jobs
   SET has_active_dispute = (
         COALESCE(dispute_status IS DISTINCT FROM 'resolved'
                  AND dispute_status IS DISTINCT FROM 'auto_resolved', true)
         AND (status = 'disputed' OR dispute_status IS NOT NULL))
 WHERE has_active_dispute IS DISTINCT FROM (
         COALESCE(dispute_status IS DISTINCT FROM 'resolved'
                  AND dispute_status IS DISTINCT FROM 'auto_resolved', true)
         AND (status = 'disputed' OR dispute_status IS NOT NULL));

ALTER TABLE public.jobs ENABLE TRIGGER update_jobs_updated_at;

-- ─────────────────────────────────────────────────────────────────────────
-- F-1: unfunded jobs are not discoverable
-- ─────────────────────────────────────────────────────────────────────────

-- CREATE OR REPLACE VIEW preserves the existing grants and RLS posture; the
-- column list is unchanged so PostgREST selects keep working.
CREATE OR REPLACE VIEW public.open_jobs_browse AS
 SELECT id,
    title,
    description,
    category,
    budget,
    date_needed,
        CASE
            WHEN offered_to_helper_id = auth.uid() THEN location
            ELSE public.mask_job_location(location)
        END AS location,
    is_urgent,
    urgent_fee,
    is_flexible_schedule,
    is_recurring,
    is_group_job,
    helpers_needed,
    estimated_hours,
    start_time,
    photos,
    special_requirements,
    status,
    created_at,
    updated_at,
    boosted_at,
    boost_expires_at,
    expires_at,
    recurrence_interval,
    recurrence_end_date,
    parent_job_id,
    payment_status,
    customer_id,
    offered_to_helper_id,
    direct_offer_status,
    direct_offer_expires_at,
    (( SELECT count(*) AS count
           FROM public.applications a
          WHERE a.job_id = jobs.id))::integer AS applicant_count,
    pricing_mode
   FROM public.jobs
  WHERE status = 'open'::job_status
    -- F-1: escrow must exist before a helper can see the job.
    AND payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    AND (offered_to_helper_id IS NULL OR (direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])) OR offered_to_helper_id = auth.uid());

-- CREATE OR REPLACE (not DROP + CREATE) on both functions below: the
-- signatures are unchanged, so the existing ACLs — including the PUBLIC and
-- anon EXECUTE grants on get_ranked_open_jobs that the guest /jobs feed
-- depends on — carry over untouched. SECURITY DEFINER + search_path are
-- restated verbatim.
CREATE OR REPLACE FUNCTION public.get_ranked_open_jobs(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_include_seed boolean DEFAULT true)
 RETURNS TABLE(id uuid, title text, description text, category job_category, budget numeric, date_needed date, start_time time without time zone, location text, parish text, is_urgent boolean, urgent_fee numeric, is_flexible_schedule boolean, is_recurring boolean, recurrence_interval text, is_group_job boolean, helpers_needed integer, estimated_hours numeric, photos text[], special_requirements text, created_at timestamp with time zone, expires_at timestamp with time zone, boosted_at timestamp with time zone, boost_expires_at timestamp with time zone, parish_match boolean, rank_score numeric, pricing_mode text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH viewer_parishes AS (
    SELECT parish FROM public.helper_preferred_parishes
    WHERE helper_id = (SELECT auth.uid())
    UNION
    SELECT parish FROM public.profiles
    WHERE user_id = (SELECT auth.uid())
      AND parish IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.helper_preferred_parishes
        WHERE helper_id = (SELECT auth.uid())
      )
  ),
  scored AS (
    SELECT
      j.id, j.title, j.description, j.category, j.budget, j.date_needed,
      j.start_time, j.location, j.parish, j.is_urgent, j.urgent_fee,
      j.is_flexible_schedule, j.is_recurring, j.recurrence_interval,
      j.is_group_job, j.helpers_needed, j.estimated_hours, j.photos,
      j.special_requirements, j.created_at, j.expires_at, j.boosted_at,
      j.boost_expires_at, j.pricing_mode,
      (j.parish IS NOT NULL AND j.parish IN (SELECT parish FROM viewer_parishes)) AS parish_match,
      (
        CASE WHEN j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now() THEN 1000 ELSE 0 END
        + CASE WHEN j.parish IS NOT NULL AND j.parish IN (SELECT parish FROM viewer_parishes) THEN 500 ELSE 0 END
        + CASE WHEN j.is_urgent THEN 100 ELSE 0 END
        + GREATEST(0, 50 - EXTRACT(EPOCH FROM (now() - j.created_at)) / 3600.0)::numeric
      )::numeric AS rank_score
    FROM public.jobs j
    WHERE j.status = 'open'
      AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
      -- Hide jobs under a live direct offer — mirrors open_jobs_browse.
      AND (
        j.offered_to_helper_id IS NULL
        OR j.direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
      -- F-1: escrow must exist before a helper can see the job. This
      -- supersedes the old `payment_status IS DISTINCT FROM 'abandoned'`
      -- test, which only caught rows void-cancelled-payments had already
      -- swept ~an hour after a declined checkout — and served the
      -- still-'unpaid' row to helpers for the whole hour in between.
      AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
      -- Fixture rows, gated by the caller. Default true = unchanged behaviour.
      AND (p_include_seed OR NOT j.is_seed)
  )
  SELECT id, title, description, category, budget, date_needed, start_time,
    public.mask_job_location(location) AS location, parish, is_urgent, urgent_fee,
    is_flexible_schedule, is_recurring, recurrence_interval, is_group_job,
    helpers_needed, estimated_hours, photos, special_requirements, created_at,
    expires_at, boosted_at, boost_expires_at, parish_match, rank_score, pricing_mode
  FROM scored
  ORDER BY rank_score DESC, created_at DESC
  LIMIT p_limit OFFSET p_offset;
$function$;

CREATE OR REPLACE FUNCTION public.get_open_jobs_for_map()
 RETURNS TABLE(id uuid, title text, category text, budget numeric, is_urgent boolean, latitude numeric, longitude numeric, parish text, created_at timestamp with time zone, location text, date_needed date, start_time time without time zone, urgent_fee numeric, is_group_job boolean, helpers_needed integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH viewer AS (
    SELECT
      CASE
        WHEN p.subscription_expires_at IS NULL OR p.subscription_expires_at <= now()
          THEN NULL
        ELSE p.subscription_tier
      END AS tier
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
  ),
  delay AS (
    -- Mirror of earlyAccessDelayMs(): (20 - earned) minutes.
    SELECT make_interval(mins => 20 - COALESCE((
      SELECT CASE
        WHEN tier IN ('elite', 'business') THEN 20
        WHEN tier = 'pro' THEN 10
        WHEN tier = 'basic' THEN 5
        ELSE 0
      END FROM viewer
    ), 0)) AS d
  )
  SELECT
    j.id,
    j.title,
    j.category,
    j.budget,
    COALESCE(j.is_urgent, false) AS is_urgent,
    -- 2 decimal places ≈ 1.1km at Louisiana latitudes. The pin lands in
    -- the right neighborhood, never on the doorstep, and can't be
    -- reverse-engineered to the source coords.
    ROUND(j.latitude, 2) AS latitude,
    ROUND(j.longitude, 2) AS longitude,
    j.parish,
    j.created_at,
    -- City, State only — same masker the public /jobs board uses. The popup
    -- prints the city and falls back to the parish when this is empty.
    public.mask_job_location(j.location) AS location,
    j.date_needed,
    j.start_time,
    j.urgent_fee,
    COALESCE(j.is_group_job, false) AS is_group_job,
    j.helpers_needed
  FROM public.jobs j
  CROSS JOIN delay
  WHERE j.status = 'open'
    -- F-1: same funded gate as get_ranked_open_jobs and open_jobs_browse, so
    -- the map cannot pin a job the list refuses to show.
    AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    AND j.latitude IS NOT NULL
    AND j.longitude IS NOT NULL
    AND (j.expires_at IS NULL OR j.expires_at > NOW())
    -- Hide jobs whose needed date has already passed — matches the
    -- client-side filter in useDashboardFilters.ts and the SQL filter in
    -- get_ranked_open_jobs, so list + map + /jobs page all agree on
    -- which posts are "still open for browse."
    AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
    -- Same visibility rule as get_public_open_jobs: a job with a pending
    -- direct offer is private to its targeted helper; it reappears once
    -- the offer resolves (declined/expired).
    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')
    -- The paid perk, enforced here rather than trusted to the client.
    AND j.created_at <= now() - delay.d
  ORDER BY j.boosted_at DESC NULLS LAST, j.created_at DESC
  LIMIT 100;
$function$;

-- The 5-open-job cap counted rows void-cancelled-payments had already written
-- off as 'abandoned'. Those are invisible to helpers and can never be funded,
-- so a poster whose checkout was declined was locked out of a slot by a job
-- that no longer exists in any meaningful sense. Only 'abandoned' is excused:
-- still-'unpaid' rows keep consuming the cap, so the cap continues to bound
-- how many jobs a poster can create without paying.
CREATE OR REPLACE FUNCTION public.enforce_open_job_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  open_count integer;
BEGIN
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
