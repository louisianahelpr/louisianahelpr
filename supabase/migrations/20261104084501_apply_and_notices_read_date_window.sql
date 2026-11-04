-- Q2408 "Any time this week", part 4 (lead re-review 11-04): the apply gate and the notices measure a window job
-- from its LAST day.
--
-- A window job stays listed until the start on its window's last day (20261104073000/074500/080753), but these
-- functions still closed it at its FIRST day's start (job_offer_cutoff(date_needed, start_time)):
--   - enforce_application_job_state (applications trigger): job_date_has_passed from the first day's start, so a
--     listed window job could not be applied to; with the 2-hour notice measured from the last day, that happened
--     right at posting;
--   - job_announceable_to: new-job and saved-search notices stopped after the first day;
--   - get_public_open_jobs: the landing teaser dropped it after the first day;
--   - public_profile_by_handle: the poster's "Open jobs" on their public profile dropped it after the first day;
--   - expire_pending_direct_offers: a direct offer that lapsed after the first day's start told the poster nothing
--     ("The job is now open to everyone." was skipped although the job was still listed).
-- Each is its NEWEST definition (enforce_application_job_state: 20261012185633; job_announceable_to,
-- get_public_open_jobs and expire_pending_direct_offers: 20261027185146; public_profile_by_handle: 20261103224601)
-- with only those cutoffs reading COALESCE(date_window_end, date_needed) (and date_window_end added to the SELECT ...
-- INTO / RETURNING lists that feed them). A one-day job (NULL end) is judged exactly as before. The hire checks
-- (direct_accept_block_reason, accept_application, the crew seat, the series claim) stay on date_needed (lead
-- decision 11-04: a hire gate): booking a day keeps that day's cutoff.
-- Same signatures and return types (CREATE OR REPLACE); grants restated exactly as their newest statement
-- (enforce_application_job_state, job_announceable_to, get_public_open_jobs: 20261012185633;
-- expire_pending_direct_offers: 20261018024631; public_profile_by_handle: 20261103224601).
-- REPLAY-SAFETY: jobs.date_window_end is added by 20261104073000, which runs first.

CREATE OR REPLACE FUNCTION public.enforce_application_job_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
DECLARE
  v_job RECORD;
BEGIN
  -- Service-role writers run with no JWT. Same gate as the credential tier
  -- trigger beside this one: a cron spawning the next recurring visit, or an
  -- admin tool, is not a helper tapping Apply.
  --
  -- This early return is safe only because RLS excludes NULL-uid callers
  -- before the trigger fires: the sole INSERT policy on `applications` is
  -- TO authenticated with WITH CHECK (auth.uid() = helper_id), which is
  -- NULL -> false for an anon or sub-less token. If that policy is ever
  -- loosened, this line becomes a bypass.
  -- 20260915051905: no longer rests on that. An anon caller (NULL uid, role
  -- anon) is judged like any other client; only a server context passes.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- FOR SHARE (added 2026-09-13): block behind any in-flight UPDATE of this
  -- job — poster_cancel_job's FOR UPDATE, accept_application, a status PATCH —
  -- and read the status THAT transaction committed, not the one before it.
  -- Without the lock, 14 of 20 applications fired alongside a cancel landed on
  -- the cancelled job (the FK's KEY SHARE made the INSERT wait, but only after
  -- this SELECT had already said 'open').
  SELECT j.status,
         j.customer_id,
         j.offered_to_helper_id,
         j.direct_offer_status,
         j.created_at,
         j.is_seed,
         j.date_needed,
         j.date_window_end,
         j.start_time,
         j.expires_at,
         j.parent_job_id
    INTO v_job
    FROM public.jobs j
   WHERE j.id = NEW.job_id
   FOR SHARE;

  -- No row is the FK's problem, not ours; let it raise its own error.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- C2. A job outlives the person who posted it: account deletion anonymises
  -- rather than deletes and deliberately preserves `status`, so an ownerless
  -- job stays 'open' forever. Until now this was refused only because the
  -- notification trigger downstream could not address a NULL poster — a
  -- protection that would evaporate the moment that path was made
  -- null-tolerant, and which meanwhile showed the helper a raw NOT NULL
  -- constraint violation.
  IF v_job.customer_id IS NULL THEN
    RAISE EXCEPTION 'job_has_no_owner'
      USING ERRCODE = '42501',
            HINT = 'The person who posted this job has closed their account.';
  END IF;

  -- C3 (2026-09-21). You cannot apply to your own post. See the header: the
  -- INSERT policy never named customer_id, no constraint covered it, and the
  -- only enforcement lived inside the apply_to_job RPC — which the client's
  -- own PGRST202 fallback, and any direct PostgREST call, goes around.
  --
  -- Deliberately BEFORE the status/early-access/date checks: whatever else is
  -- wrong with the job, this is the reason the person can act on.
  --
  -- Compared against NEW.helper_id rather than auth.uid() so it holds for the
  -- SECURITY DEFINER paths too (apply_to_job, respond_to_direct_offer), where
  -- a row could be written for a helper_id other than the caller. A poster who
  -- direct-offers a job to themselves is refused here as well, which is
  -- correct: the row that offer would create is still a self-application.
  IF v_job.customer_id = NEW.helper_id THEN
    RAISE EXCEPTION 'cannot_apply_to_own_job'
      USING ERRCODE = '42501',
            HINT = 'You posted this job, so you cannot also apply to it.';
  END IF;

  -- C10 (2026-09-24, Q341). No application across a block, in either
  -- direction. The INSERT policy already said so, but apply_to_job is SECURITY
  -- DEFINER and never reaches the policy; this trigger is on every path. The
  -- code does not say who blocked whom — the helper gets the same sentence
  -- either way.
  IF public.are_users_blocked(NEW.helper_id, v_job.customer_id) THEN
    RAISE EXCEPTION 'applicant_blocked'
      USING ERRCODE = '42501',
            HINT = 'This job is not available to you.';
  END IF;

  -- C11 (20260927012806, money review MEDIUM-1). claim_series_dates hands a
  -- VACATED series visit (still funded) to the Helpr who claimed its date: it
  -- books the visit, then records their accepted application. By then the
  -- visit is no longer 'open' and it may still be in its Early Access window,
  -- so the discovery checks below (C1, C4-C9) do not describe that write. The
  -- claim sets app.series_claim_rpc only around that one INSERT, after its
  -- own checks (the claimer is on the series, not banned, not blocked, not
  -- the poster); C3 and C10 above still run on it.
  IF current_setting('app.series_claim_rpc', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- C12 (authz review HIGH). A series VISIT is never applied to. A visit a
  -- Helpr gave up is 'open' with no helper and still funded, but it belongs
  -- to the series: it goes only to a Helpr already on the series, through
  -- claim_series_dates (C11 above). No discovery surface lists it
  -- (20260927015010), and this refuses the direct INSERT and apply_to_job.
  IF v_job.parent_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'series_visit_not_open'
      USING ERRCODE = '42501',
            HINT = 'This visit is part of a series.';
  END IF;

  -- C1. Every discovery surface requires status = 'open'.
  -- Q1409: and a booked crew's re-listed free spot (crew_spots_open), the
  -- same rule every browse surface lists it by.
  IF v_job.status <> 'open'
     AND NOT (v_job.status = 'accepted' AND COALESCE(public.crew_spots_open(NEW.job_id), 0) > 0) THEN
    RAISE EXCEPTION 'job_not_open'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer accepting applications.';
  END IF;

  -- C4. A job under a live direct offer is private to the helper it was
  -- offered to. The feed withholds it; so must the write path.
  IF v_job.offered_to_helper_id IS NOT NULL
     AND v_job.direct_offer_status = 'pending'
     AND v_job.offered_to_helper_id IS DISTINCT FROM NEW.helper_id THEN
    RAISE EXCEPTION 'job_reserved_for_another_helper'
      USING ERRCODE = '42501',
            HINT = 'This job has been offered directly to someone else.';
  END IF;

  -- C5. The Early Access perk. The targeted helper of a direct offer keeps the
  -- same escape hatch the four surfaces give them, so a person who was invited
  -- to a job can always answer it immediately.
  IF v_job.created_at > public.early_access_cutoff()
     AND v_job.offered_to_helper_id IS DISTINCT FROM NEW.helper_id THEN
    RAISE EXCEPTION 'job_in_early_access_window'
      USING ERRCODE = '42501',
            HINT = 'This job is in its Early Access window. Pro and Elite members can apply first.';
  END IF;

  -- C6. Fixture rows, on the shared switch — so when the flag is flipped at
  -- launch the seed jobs go quiet in the feed AND stop accruing real
  -- applications, instead of only the former.
  -- Q552: a test account may still apply to a test job (the nightly journeys);
  -- keyed on the applicant's profiles.is_seed, which no member can set.
  IF COALESCE(v_job.is_seed, false) AND public.seed_hidden_for(NEW.helper_id) THEN
    RAISE EXCEPTION 'job_not_available'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer available.';
  END IF;

  -- C13 (Q1411, owner 2026-10-05). The poster is under an open ban settlement
  -- review: the post is hidden from browse and takes no new application.
  -- The same neutral words as C6: the applicant learns nothing about why.
  IF EXISTS (SELECT 1 FROM public.ban_settlement_queue q
              WHERE q.user_id = v_job.customer_id AND q.review_state = 'open') THEN
    RAISE EXCEPTION 'job_not_available'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer available.';
  END IF;

  -- C8. The listing closes at the start (owner-approved lifecycle contract,
  -- docs/JOB-LIFECYCLE.md; Q1401): job_offer_cutoff is the start, or the end
  -- of a date-only job's day, in Louisiana. Every browse surface
  -- (open_jobs_browse, get_ranked_open_jobs, get_open_jobs_for_map,
  -- get_public_open_jobs) lists a job by the same instant. It used to be the
  -- day (`date_needed < CURRENT_DATE`), so a 9 AM job took applications at
  -- 4 PM that day that its poster could no longer hire from.
  IF v_job.date_needed IS NOT NULL
     -- Q2408: a window job takes applications until the start on the window's LAST day.
     AND public.job_offer_cutoff(COALESCE(v_job.date_window_end, v_job.date_needed), v_job.start_time) <= now() THEN
    RAISE EXCEPTION 'job_date_has_passed'
      USING ERRCODE = '42501',
            HINT = 'This job has already started, so it takes no new applications.';
  END IF;

  -- C9. Likewise an expired one. This is filtered on only ONE surface today
  -- (get_open_jobs_for_map), so enforcing it here is deliberately stricter
  -- than any feed currently implies — confirmed with the owner before shipping.
  IF v_job.expires_at IS NOT NULL AND v_job.expires_at <= now() THEN
    RAISE EXCEPTION 'job_expired'
      USING ERRCODE = '42501',
            HINT = 'This job posting has expired.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_application_job_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_application_job_state() TO service_role;

CREATE OR REPLACE FUNCTION public.job_announceable_to(p_job jobs, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- open_jobs_browse's WHERE for a recipient who is neither the poster nor
  -- the offered helper, with get_user_credential_tier(recipient) in place of
  -- my_credential_tier(). The early-access clock is NOT here: a caller that
  -- may queue asks early_access_visible_at() itself.
  SELECT COALESCE(
        p_user_id IS NOT NULL
    AND p_job.status = 'open'
    -- A series visit is re-offered only inside its series (20260927015010).
    AND p_job.parent_job_id IS NULL
    AND p_job.customer_id IS NOT NULL
    AND p_job.customer_id <> p_user_id
    AND COALESCE(p_job.payment_status, '') = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
    AND (p_job.offered_to_helper_id IS NULL
         OR COALESCE(p_job.direct_offer_status, 'pending') IN ('declined', 'expired'))
    AND (NOT COALESCE(p_job.is_seed, false) OR NOT public.seed_jobs_hidden_publicly())
    AND (COALESCE(p_job.credential_tier, 0) = 0
         OR COALESCE(public.get_user_credential_tier(p_user_id), 0) >= p_job.credential_tier)
    -- Q1401: never announce a listing that has closed (its start passed).
    -- Q2408: a window job is announceable until the start on the window's LAST day.
    AND (p_job.date_needed IS NULL OR public.job_offer_cutoff(COALESCE(p_job.date_window_end, p_job.date_needed), p_job.start_time) > now())
    -- Q1411: not while the poster is under an open ban settlement review.
    AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = p_job.customer_id AND q.review_state = 'open'),
    false);
$function$;

REVOKE ALL ON FUNCTION public.job_announceable_to(public.jobs, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_announceable_to(public.jobs, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_public_open_jobs(p_limit integer DEFAULT 6)
 RETURNS TABLE(id uuid, title text, category text, location text, budget numeric, date_needed date, is_urgent boolean, is_boosted boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
  SELECT j.id, j.title, j.category::text,
         public.mask_job_location(j.location) AS location,
         j.budget, j.date_needed, j.is_urgent,
         (j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now()) AS is_boosted
  FROM public.jobs j
  WHERE (j.status = 'open' OR (j.status = 'accepted' AND j.is_group_job IS TRUE AND public.crew_spots_open(j.id) > 0))
    -- A series visit is re-offered only inside its series (20260927015010).
    AND j.parent_job_id IS NULL
    -- Ownership. Mirrors open_jobs_browse (20260902152714).
    AND j.customer_id IS NOT NULL
    -- Funding. Mirrors open_jobs_browse / get_ranked_open_jobs /
    -- get_open_jobs_for_map.
    AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
    -- Credentials, on the shared rule. A signed-out visitor is tier 0.
    AND (
      COALESCE(j.credential_tier, 0) = 0
      OR COALESCE((SELECT public.get_user_credential_tier((SELECT auth.uid()))), 0) >= j.credential_tier
    )
    -- The seed switch. Same expression the other three surfaces use.
    AND (NOT j.is_seed OR NOT public.seed_jobs_hidden_publicly())
    AND j.date_needed IS NOT NULL
    -- Q2408: a window job stays on the landing teaser until its window's LAST day.
    AND public.job_offer_cutoff(COALESCE(j.date_window_end, j.date_needed), j.start_time) > now()
    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')
    -- BD-002: Early Access, on the SAME shared authority the other three
    -- discovery surfaces use. No offered_to_helper_id escape hatch here: the
    -- line above already withholds every job under a live direct offer.
    AND j.created_at <= public.early_access_cutoff()
    -- Q1411: not while the poster is under an open ban settlement review.
    AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = j.customer_id AND q.review_state = 'open')
  ORDER BY
    (j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now()) DESC,
    j.created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 6), 1);
$function$;

REVOKE ALL ON FUNCTION public.get_public_open_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_open_jobs(integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.expire_pending_direct_offers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.jobs
       SET direct_offer_status = 'expired'
     WHERE direct_offer_status = 'pending'
       AND direct_offer_expires_at IS NOT NULL
       AND direct_offer_expires_at < now()
       -- Q1891: only an offer on a job still open lapses into "open to
       -- everyone". A cancelled job's offer is retired by the cancel itself.
       AND status::text = 'open'
       -- An unfunded offer was never shown to anyone, so it cannot lapse; its
       -- window starts when the money arrives (owner, 2026-10-17).
       AND public.job_payment_is_listed(payment_status)
    RETURNING id, customer_id, title, date_needed, date_window_end, start_time
  ), notified AS (
    INSERT INTO public.notifications (user_id, title, message, type, link)
    SELECT customer_id,
           'Direct offer expired',
           'Your offer for "' || title || '" was not accepted in time. The job is now open to everyone.',
           'job_updates',
           '/posts?job=' || id::text
      FROM expired
     WHERE customer_id IS NOT NULL
       -- Past the start cutoff the job is not "open to everyone" in any
       -- useful sense (money that landed late, delta review #3): it lapses
       -- quietly.
       AND (date_needed IS NULL
            OR public.job_offer_cutoff(COALESCE(date_window_end, date_needed), start_time) > now())
    RETURNING 1
  ), told AS (
    -- Q1185 (re-review should-fix C): a Helpr who said yes while their setup
    -- was unfinished hears the offer lapsed, with no strike, as a regular
    -- offer's Helpr does (expire_unanswered_offers). The statement's snapshot
    -- still holds the pending rows trg_jobs_clear_accept_pending removes.
    -- Setup can be done and the accept still not complete (the job's date
    -- passed, a block): the copy says which (final review #3).
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    SELECT p.helper_id,
           'You lost a job offer',
           CASE WHEN public.helper_accept_block_reason(p.helper_id) IS NOT NULL
                THEN 'The direct offer for "' || COALESCE(e.title, 'a job')
                       || '" expired before your payout setup and Stripe ID were done, so it went back to everyone. No strike. Finish both so you can accept the next offer.'
                ELSE 'The direct offer for "' || COALESCE(e.title, 'a job')
                       || '" expired before your accept could be completed, so it went back to everyone. No strike.'
           END,
           'expired',
           '/jobs?job=' || e.id::text,
           e.id
      FROM expired e
      JOIN public.job_accept_pending p ON p.job_id = e.id
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM expired;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_pending_direct_offers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_pending_direct_offers() TO service_role;

CREATE OR REPLACE FUNCTION public.public_profile_by_handle(p_handle text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET "TimeZone" TO 'America/Chicago'
AS $function$
DECLARE
  v_handle text := lower(btrim(coalesce(p_handle, '')));
  v_p record;
  v_stats jsonb;
  v_listings jsonb;
  v_jobs jsonb;
  v_reviews jsonb;
  v_categories jsonb;
  v_done integer;
  v_wanted jsonb;
  v_declutter boolean;
  v_wanted_on boolean;
BEGIN
  IF v_handle = '' OR length(v_handle) > 30 THEN
    RETURN NULL;
  END IF;

  SELECT p.user_id, p.full_name, p.avatar_url, p.created_at, p.handle INTO v_p
    FROM public.profiles p
   WHERE p.handle = v_handle
      OR (p.handle IS NOT NULL
          AND p.user_id = (SELECT r.user_id FROM public.profile_handles_retired r
                            WHERE r.handle = v_handle AND r.user_id IS NOT NULL))
   ORDER BY (p.handle = v_handle) DESC
   LIMIT 1;
  IF v_p.user_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- Review 2026-11-01: banned in any form, restricted (out of Declutter), deleted, unverified,
  -- seed, test or under 18 -> no page.
  IF NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.user_id = v_p.user_id
                    AND p.email_verified
                    AND p.ban_status IS DISTINCT FROM 'banned'
                    AND p.ban_status IS DISTINCT FROM 'temp_banned'
                    AND p.ban_status IS DISTINCT FROM 'permanently_banned'
                    AND p.is_seed IS NOT TRUE
                    AND p.anonymized_at IS NULL)
     OR public.declutter_member_out(v_p.user_id)
     OR COALESCE(public.member_under_18(v_p.user_id), true)
     OR public.is_test_member(v_p.user_id) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
           'review_count', s.review_count,
           'avg_rating', s.avg_rating,
           'completed_jobs_as_helper', s.completed_jobs_as_helper,
           'completed_jobs_total', s.completed_jobs_total,
           'posted_jobs_total', s.posted_jobs_total,
           'on_time_rate', s.on_time_rate,
           'repeat_hire_percent', s.repeat_hire_percent,
           'is_id_verified', s.is_id_verified,
           'is_background_checked', s.is_background_checked)
    INTO v_stats
    FROM public.get_public_profile_stats(ARRAY[v_p.user_id]) s
   WHERE s.user_id = v_p.user_id
   LIMIT 1;

  v_declutter := public.declutter_open_to_guests();
  -- Wanted posts only while their own switch is open to everyone too (it is testers-only until then).
  v_wanted_on := v_declutter AND EXISTS (SELECT 1 FROM public.feature_switches s
                                          WHERE s.key = 'declutter_wanted' AND s.audience = 'everyone');

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'live_at' DESC), '[]'::jsonb) INTO v_listings
    FROM (
      SELECT jsonb_build_object(
               'id', i.id,
               'title', i.title,
               'price_cents', i.current_price_cents,
               'area_label', i.area_label,
               'live_at', coalesce(i.live_at, i.created_at),
               'photo_id', (SELECT ph.id FROM public.declutter_item_photos ph
                             WHERE ph.item_id = i.id ORDER BY ph.position LIMIT 1)) AS x
        FROM public.declutter_items i
       WHERE v_declutter
         AND i.seller_id = v_p.user_id
         AND i.status = 'live'
         AND NOT i.seller_hidden
         AND i.is_seed IS NOT TRUE
         AND NOT public.declutter_seller_out(v_p.user_id)
       ORDER BY coalesce(i.live_at, i.created_at) DESC
       LIMIT 24
    ) l;

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'date_needed'), '[]'::jsonb) INTO v_jobs
    FROM (
      SELECT jsonb_build_object(
               'id', j.id,
               'title', j.title,
               'category', j.category::text,
               'town', public.mask_job_location(j.location),
               'budget', j.budget,
               'date_needed', j.date_needed) AS x
        FROM public.jobs j
       WHERE j.customer_id = v_p.user_id
         AND j.status = 'open'
         AND j.parent_job_id IS NULL
         AND j.is_seed IS NOT TRUE
         AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
         AND COALESCE(j.credential_tier, 0) = 0
         AND j.date_needed IS NOT NULL
         AND public.job_offer_cutoff(COALESCE(j.date_window_end, j.date_needed), j.start_time) > now()
         AND (j.expires_at IS NULL OR j.expires_at > now())
         AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status IS DISTINCT FROM 'pending')
         AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q
                          WHERE q.user_id = j.customer_id AND q.review_state = 'open')
       ORDER BY j.date_needed
       LIMIT 24
    ) o;

  SELECT count(*)::integer,
         coalesce(jsonb_agg(DISTINCT j.category::text) FILTER (WHERE j.category IS NOT NULL), '[]'::jsonb)
    INTO v_done, v_categories
    FROM public.jobs j
   WHERE j.helper_id = v_p.user_id
     AND j.status = 'completed'
     AND j.is_seed IS NOT TRUE
     AND NOT public.is_test_member(j.customer_id);

  -- Re-review 2026-11-01: the list is read here, not through get_public_profile_reviews, whose seed rule reads the
  -- caller (seed_hidden_from_caller), so test reviews showed to an admin, to test accounts, and to everyone while
  -- the seed switch is off. Same rules as the stats' review count (get_public_profile_stats.visible_reviews):
  -- published and visible, not on a cancelled or seed job, not from or about a test member; for every caller.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'rating', r.rating,
           'feedback', r.feedback,
           'created_at', r.created_at,
           'reviewer_name', public.member_display_name(r.reviewer_full_name),
           'job_category', r.job_category,
           'response_text', r.response_text,
           'response_at', r.response_at) ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO v_reviews
    FROM (
      SELECT rv.rating, public.review_text(rv.feedback, rv.tags) AS feedback, rv.created_at, rv.response_text, rv.response_at, j.category::text AS job_category,
             -- The reviewer's public name only under the same rules as a page of their own (review 2026-11-01):
             -- verified, never banned in any form, not out of Declutter, not deleted, not under 18; else "A neighbor".
             (SELECT rp.full_name FROM public.profiles rp
               WHERE rp.user_id = rv.reviewer_id
                 AND rp.email_verified
                 AND rp.ban_status IS DISTINCT FROM 'banned'
                 AND rp.ban_status IS DISTINCT FROM 'temp_banned'
                 AND rp.ban_status IS DISTINCT FROM 'permanently_banned'
                 AND rp.anonymized_at IS NULL
                 AND NOT public.declutter_member_out(rp.user_id)
                 AND NOT COALESCE(public.member_under_18(rp.user_id), true)
               LIMIT 1) AS reviewer_full_name
        FROM public.reviews rv
        JOIN public.jobs j ON j.id = rv.job_id
       WHERE rv.reviewee_id = v_p.user_id
         AND rv.status = 'published'
         AND rv.feedback_visible_at IS NOT NULL
         AND rv.feedback_visible_at <= now()
         AND j.status <> 'cancelled'
         AND j.is_seed IS NOT TRUE
         AND NOT public.is_test_member(rv.reviewer_id)
         AND NOT public.is_test_member(rv.reviewee_id)
       ORDER BY rv.created_at DESC
       LIMIT 10
    ) r;

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb) INTO v_wanted
    FROM (
      SELECT jsonb_build_object(
               'id', w.id,
               'what', w.what,
               'category', w.category,
               'max_price_cents', w.max_price_cents,
               'created_at', w.created_at) AS x
        FROM public.declutter_wanted w
       WHERE v_wanted_on
         AND w.user_id = v_p.user_id
         AND w.status = 'open'
         AND w.public
         AND w.removed_at IS NULL
         AND w.expires_at > now()
         AND w.is_seed IS NOT TRUE
         -- The same poster rules as the Wanted browse (20261030225143).
         AND NOT public.declutter_member_out(w.user_id)
         AND NOT public.member_under_18(w.user_id)
         AND NOT public.declutter_seller_hidden(w.user_id)
       ORDER BY w.created_at DESC
       LIMIT 24
    ) wq;

  RETURN jsonb_build_object(
    'handle', v_p.handle,
    'name', public.member_display_name(v_p.full_name),
    'photo_url', v_p.avatar_url,
    'member_since', v_p.created_at,
    'stats', coalesce(v_stats, '{}'::jsonb),
    'listings', v_listings,
    'jobs', v_jobs,
    'helpr', jsonb_build_object('jobs_done', v_done, 'categories', v_categories, 'reviews', v_reviews),
    'wanted', v_wanted);
END;
$function$;

REVOKE ALL ON FUNCTION public.public_profile_by_handle(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_profile_by_handle(text) TO anon, authenticated, service_role;
