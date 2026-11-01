-- Instant book OFF for everyone (owner order 11-01, through the lead: "jobs can be hours away"; she will revisit).
--
-- A hidden switch 'instant_book', created OFF (audience 'off': nobody, admins and testers included). Going back on is
-- an admin's flip in Admin -> Settings, never a migration. The three member-facing entry points refuse first thing
-- with require_feature('instant_book') (42501 feature_disabled): booking a Helpr (rpc_instant_book), the poster's
-- candidate list (instant_book_candidates) and a Helpr setting a floor (rpc_set_instant_book_floor). Each is restated
-- verbatim from its newest definition (20261101065105 / 20261101063725) with that one PERFORM added.
--
-- Left running on purpose, so nothing in flight is stranded: the Helpr's decline (rpc_instant_book_decline), the
-- reads (rpc_my_instant_bookings, rpc_my_instant_book_floors), the server-only sweeps and refunds
-- (instant_book_end_if_unhireable, instant_book_captured_not_hired, instant_book_refund_finished,
-- instant_book_payment_failed) and the tables. Replay-safe: CREATE OR REPLACE and ON CONFLICT DO NOTHING.

INSERT INTO public.feature_switches (key, audience, description) VALUES ('instant_book', 'off', 'Instant book: a poster books one of up to 3 Helprs who set a price floor, without applications, and the Helpr has 2 hours to decline. Off = nobody can book, see the Book now list or set a floor. Bookings already made can still be declined and refunded.') ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.rpc_instant_book(p_job_id uuid, p_helper_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Chicago'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_reason text;
  v_until timestamptz := now() + interval '2 hours';
  v_poster_name text;
  v_helper_name text;
BEGIN
  -- Instant book is OFF for everyone (owner 11-01): refused for every account until an admin turns it back on.
  PERFORM public.require_feature('instant_book');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Lock the job: serializes against an apply/hire, a cancel, another booking.
  SELECT j.id, j.customer_id, j.title, j.budget, j.date_needed INTO v_job
    FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_reason := public.instant_book_block_reason(p_job_id, p_helper_id);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'instant_book_unavailable' USING ERRCODE = '22023',
      DETAIL = CASE WHEN v_reason = 'not_eligible' THEN 'helpr' ELSE v_reason END;
  END IF;

  UPDATE public.jobs
     SET offered_to_helper_id = p_helper_id,
         direct_offer_status = 'pending',
         direct_offer_expires_at = NULL,
         instant_booked_at = now(),
         instant_decline_until = v_until
   WHERE id = p_job_id;

  SELECT public.member_display_name(full_name, 'A neighbor') INTO v_poster_name FROM public.profiles WHERE user_id = v_uid;
  SELECT public.member_display_name(full_name, 'Your Helpr') INTO v_helper_name FROM public.profiles WHERE user_id = p_helper_id;
  INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES
    (p_helper_id, 'You''re booked',
     v_poster_name || ' booked you for "' || v_job.title || '" on ' || to_char(v_job.date_needed, 'FMMon FMDD')
       || ' for $' || replace(to_char(v_job.budget, 'FM999999990.00'), '.00', '') || '. Can''t make it? Decline by ' || to_char(v_until, 'FMHH12:MI AM')
       || ' and nothing is charged.',
     'new_offers', '/jobs?job=' || p_job_id::text, p_job_id),
    (v_uid, 'Booked',
     v_helper_name || ' is booked for "' || v_job.title || '". They have until ' || to_char(v_until, 'FMHH12:MI AM')
       || ' to say if they can''t make it. Your card is charged after that.',
     'job_updates', '/posts?job=' || p_job_id::text, p_job_id);

  RETURN jsonb_build_object('action', 'booked', 'decline_until', v_until);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rpc_instant_book(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_instant_book(uuid, uuid) TO authenticated;

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
  -- Instant book is OFF for everyone (owner 11-01): refused for every account until an admin turns it back on.
  PERFORM public.require_feature('instant_book');
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
  -- Instant book is OFF for everyone (owner 11-01): refused for every account until an admin turns it back on.
  PERFORM public.require_feature('instant_book');
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
                 WHERE r.reviewee_id = f.helper_id AND r.status = 'published'
                   AND NOT public.is_test_member(r.reviewer_id)) AS rating,
               (SELECT count(*)::int FROM public.reviews r
                 WHERE r.reviewee_id = f.helper_id AND r.status = 'published'
                   AND NOT public.is_test_member(r.reviewer_id)) AS review_count
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
