-- CMP-4, slice 1 of 3: instant book with the POSTER's price (owner 2026-10-29;
-- lead 2026-10-30 09:50, answers Q1-Q3 in ~/.lh-shots/b103-handoff).
--
-- The whole feature, so each slice is read against it:
--   1. (this file) A Helpr sets a private auto-accept FLOOR per category, at
--      most 3 categories. A poster with a funded job asks for up to 3 Helprs
--      who would take it at the poster's own price, best first. The floor is
--      never returned to anyone but its owner, and is never on any client
--      readable table (RLS on, no policy, no grant).
--   2. (next) "Book <First L.> now": the poster's job, already funded and
--      captured, is handed to that Helpr through the direct-offer completion,
--      stamped instant_booked_at and instant_decline_until = now() + 2 h.
--   3. (next) The Helpr may decline inside the 2 h: the poster is refunded in
--      full INCLUDING the fee (create-payment, a Helpr-side action), the job
--      goes back to open for applications, no strike and no fee ladder.
--
-- Who qualifies for a job (instant_book_block_reason; NULL = qualifies):
--   - the job: open, nobody hired or offered, not a crew or a child visit,
--     funded (job_payment_is_listed), dated, not past its offer cutoff;
--   - the Helpr: a floor for the job's category, at or below the job's price
--     (budget, in cents); free that day (helper_availability: a specific_date
--     row overrides the weekly day_of_week row; one marked unavailable blocks
--     the day; no row for the day = not free); 3 or more REAL completed jobs
--     (not is_seed, poster not a test account); payout and ID ready
--     (helper_accept_block_reason); no block either way; not banned, not
--     shadowbanned; not the poster; test and real accounts never mixed.
--
-- On for everyone, with no feature switch (owner rule "ship on for everyone";
-- lead 2026-11-01). PGlite proof: src/test/pglite/instantBookFloors.pglite.mjs.

CREATE TABLE IF NOT EXISTS public.instant_book_floors (
  helper_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category    public.job_category NOT NULL,
  floor_cents integer NOT NULL CHECK (floor_cents BETWEEN 1000 AND 100000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (helper_id, category)
);
ALTER TABLE public.instant_book_floors ENABLE ROW LEVEL SECURITY;
-- No policy: nobody reads or writes the table directly, the owner included.
-- The floor reaches the owner only through rpc_my_instant_book_floors.
REVOKE ALL ON TABLE public.instant_book_floors FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.instant_book_floors TO service_role;

COMMENT ON TABLE public.instant_book_floors IS
  'CMP-4: a Helpr''s private auto-accept floor per category (at most 3). Never returned to anyone but its owner.';

-- The owner's own floors.
CREATE OR REPLACE FUNCTION public.rpc_my_instant_book_floors()
 RETURNS TABLE(category text, floor_cents integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT f.category::text, f.floor_cents
      FROM public.instant_book_floors f
     WHERE f.helper_id = auth.uid()
     ORDER BY f.category::text;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rpc_my_instant_book_floors() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_my_instant_book_floors() TO authenticated;

-- Set (or change) one floor. p_floor_cents NULL removes the category.
CREATE OR REPLACE FUNCTION public.rpc_set_instant_book_floor(p_category text, p_floor_cents integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_cat public.job_category;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_cat := p_category::public.job_category;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = '22023';
  END;
  IF v_cat IS NULL THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = '22023';
  END IF;

  IF p_floor_cents IS NULL THEN
    DELETE FROM public.instant_book_floors WHERE helper_id = v_uid AND category = v_cat;
    RETURN;
  END IF;
  IF p_floor_cents < 1000 OR p_floor_cents > 100000 THEN
    RAISE EXCEPTION 'floor_out_of_range' USING ERRCODE = '22023';
  END IF;

  -- At most 3 categories. The owner's rows are locked first, so two parallel
  -- adds cannot both see 2 and make 4.
  PERFORM 1 FROM public.profiles WHERE user_id = v_uid FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.instant_book_floors WHERE helper_id = v_uid AND category = v_cat)
     AND (SELECT count(*) FROM public.instant_book_floors WHERE helper_id = v_uid) >= 3 THEN
    RAISE EXCEPTION 'too_many_categories' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.instant_book_floors (helper_id, category, floor_cents)
  VALUES (v_uid, v_cat, p_floor_cents)
  ON CONFLICT (helper_id, category) DO UPDATE
    SET floor_cents = EXCLUDED.floor_cents, updated_at = now();
END;
$fn$;
REVOKE ALL ON FUNCTION public.rpc_set_instant_book_floor(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_set_instant_book_floor(text, integer) TO authenticated;

-- Is p_helper free on p_day? A specific_date row overrides the weekly row.
CREATE OR REPLACE FUNCTION public.instant_book_helper_free_on(p_helper uuid, p_day date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM public.helper_availability a
                         WHERE a.helper_id = p_helper AND a.specific_date = p_day)
             THEN NOT EXISTS (SELECT 1 FROM public.helper_availability a
                               WHERE a.helper_id = p_helper AND a.specific_date = p_day
                                 AND a.is_available IS NOT TRUE)
           ELSE EXISTS (SELECT 1 FROM public.helper_availability a
                         WHERE a.helper_id = p_helper AND a.specific_date IS NULL
                           AND a.day_of_week = extract(dow FROM p_day)::int
                           AND a.is_available IS TRUE)
         END;
$fn$;
REVOKE ALL ON FUNCTION public.instant_book_helper_free_on(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instant_book_helper_free_on(uuid, date) TO service_role;

-- Completed jobs that count: real jobs for real posters.
CREATE OR REPLACE FUNCTION public.instant_book_real_jobs_done(p_helper uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT count(*)::int
    FROM public.jobs j
   WHERE j.helper_id = p_helper
     AND j.status = 'completed'
     AND j.is_seed IS NOT TRUE
     AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = j.customer_id);
$fn$;
REVOKE ALL ON FUNCTION public.instant_book_real_jobs_done(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instant_book_real_jobs_done(uuid) TO service_role;

-- Why p_helper can't be instant-booked on p_job_id (NULL = they can). Server
-- only: its answer would tell a caller whether a price clears a floor.
CREATE OR REPLACE FUNCTION public.instant_book_block_reason(p_job_id uuid, p_helper uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Chicago'
AS $fn$
DECLARE
  v_job record;
  v_profile record;
  v_floor integer;
BEGIN
  SELECT j.status::text AS status, j.helper_id, j.customer_id, j.offered_to_helper_id, j.direct_offer_status,
         j.parent_job_id, COALESCE(j.is_group_job, false) AS is_group_job, j.is_seed, j.category, j.budget,
         j.date_needed, j.start_time, j.expires_at, j.payment_status, COALESCE(j.credential_tier, 0) AS credential_tier
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RETURN 'job_not_found';
  END IF;
  IF v_job.status IS DISTINCT FROM 'open' OR v_job.helper_id IS NOT NULL
     OR (v_job.offered_to_helper_id IS NOT NULL AND v_job.direct_offer_status = 'pending')
     OR v_job.parent_job_id IS NOT NULL OR v_job.is_group_job THEN
    RETURN 'job_not_open';
  END IF;
  IF NOT public.job_payment_is_listed(v_job.payment_status::text) THEN
    RETURN 'job_not_funded';
  END IF;
  IF v_job.date_needed IS NULL THEN
    RETURN 'job_has_no_date';
  END IF;
  IF public.job_offer_cutoff(v_job.date_needed, v_job.start_time) <= now()
     OR (v_job.expires_at IS NOT NULL AND v_job.expires_at <= now()) THEN
    RETURN 'job_date_has_passed';
  END IF;

  IF p_helper IS NULL OR p_helper = v_job.customer_id THEN
    RETURN 'not_eligible';
  END IF;
  -- Test and real never mix: a real job only to real Helprs, a test job only to test accounts.
  IF COALESCE(v_job.is_seed, false) THEN
    IF NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_helper) THEN
      RETURN 'not_eligible';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_helper) THEN
    RETURN 'not_eligible';
  END IF;

  SELECT f.floor_cents INTO v_floor
    FROM public.instant_book_floors f
   WHERE f.helper_id = p_helper AND f.category = v_job.category;
  IF v_floor IS NULL OR round(v_job.budget * 100) < v_floor THEN
    RETURN 'not_eligible';
  END IF;

  IF public.are_users_blocked(p_helper, v_job.customer_id) THEN
    RETURN 'not_eligible';
  END IF;
  SELECT p.ban_status, p.auto_suspended_until INTO v_profile FROM public.profiles p WHERE p.user_id = p_helper;
  IF NOT FOUND THEN
    RETURN 'not_eligible';
  END IF;
  IF v_profile.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
     AND (v_profile.ban_status <> 'temp_banned' OR v_profile.auto_suspended_until IS NULL
          OR v_profile.auto_suspended_until > now()) THEN
    RETURN 'not_eligible';
  END IF;
  IF public.is_helper_shadowbanned(p_helper) THEN
    RETURN 'not_eligible';
  END IF;
  IF v_job.credential_tier > 0
     AND COALESCE(public.get_user_credential_tier(p_helper), 0) < v_job.credential_tier THEN
    RETURN 'not_eligible';
  END IF;
  IF public.helper_accept_block_reason(p_helper) IS NOT NULL THEN
    RETURN 'not_eligible';
  END IF;
  IF public.instant_book_real_jobs_done(p_helper) < 3 THEN
    RETURN 'not_eligible';
  END IF;
  IF NOT public.instant_book_helper_free_on(p_helper, v_job.date_needed) THEN
    RETURN 'not_eligible';
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.instant_book_block_reason(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instant_book_block_reason(uuid, uuid) TO service_role;

-- The poster's list: up to 3 Helprs who would take this job at its price,
-- best first (rating, then real jobs done). Never a floor, never a price.
CREATE OR REPLACE FUNCTION public.instant_book_candidates(p_job_id uuid)
 RETURNS TABLE(helper_id uuid, display_name text, avatar_url text, jobs_done integer, rating numeric, review_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_customer uuid;
  v_category public.job_category;
  v_reason text;
BEGIN
  SELECT j.customer_id, j.category INTO v_customer, v_category FROM public.jobs j WHERE j.id = p_job_id;
  IF NOT FOUND OR v_uid IS NULL OR v_customer IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- The job's own state, judged once with no Helpr (NULL helper is 'not_eligible' only after the job checks).
  v_reason := public.instant_book_block_reason(p_job_id, NULL);
  IF v_reason IS DISTINCT FROM 'not_eligible' THEN
    RETURN;  -- the job can't be instant-booked now: an empty list, never an error the app must word
  END IF;

  RETURN QUERY
    SELECT c.helper_id, c.display_name, c.avatar_url, c.jobs_done, c.rating, c.review_count
      FROM (
        SELECT f.helper_id,
               public.member_display_name(p.full_name) AS display_name,
               p.avatar_url,
               public.instant_book_real_jobs_done(f.helper_id) AS jobs_done,
               (SELECT round(avg(r.rating)::numeric, 1) FROM public.reviews r
                 WHERE r.reviewee_id = f.helper_id AND r.status = 'published') AS rating,
               (SELECT count(*)::int FROM public.reviews r
                 WHERE r.reviewee_id = f.helper_id AND r.status = 'published') AS review_count
          FROM public.instant_book_floors f
          JOIN public.profiles p ON p.user_id = f.helper_id
         WHERE f.category = v_category
           AND public.instant_book_block_reason(p_job_id, f.helper_id) IS NULL
      ) c
     ORDER BY c.rating DESC NULLS LAST, c.jobs_done DESC, c.helper_id
     LIMIT 3;
END;
$fn$;
REVOKE ALL ON FUNCTION public.instant_book_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.instant_book_candidates(uuid) TO authenticated;
