-- Quotes: the 5-open-request cap counts only requests still collecting quotes
-- (quotes_close_at > now()). 20261015091114 counted every status = 'open' row,
-- and nothing moves a lapsed request out of 'open', so a poster whose requests
-- had lapsed was refused 'too_many_open_requests' forever (sentry review on
-- PR #3173). Same body as 20261015091114 otherwise. Replay-safe: CREATE OR
-- REPLACE, grants restated. Proof: src/test/pglite/jobQuotes.pglite.mjs
-- ("open-request cap ignores lapsed requests"), red on 20261015091114 alone.

CREATE OR REPLACE FUNCTION public.create_quote_request(
  p_title text,
  p_description text,
  p_category text,
  p_date_needed date,
  p_start_time time DEFAULT NULL,
  p_estimated_hours numeric DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_parish text DEFAULT NULL,
  p_window_hours integer DEFAULT 48
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_id  uuid;
  v_window integer := COALESCE(p_window_hours, 48);
  v_start  timestamptz;
  v_close  timestamptz;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_window NOT IN (24, 48, 72) THEN
    RAISE EXCEPTION 'invalid_window' USING ERRCODE = '22023', DETAIL = 'Pick 24 hours, 48 hours or 3 days.';
  END IF;
  IF p_date_needed IS NULL THEN
    RAISE EXCEPTION 'invalid_date' USING ERRCODE = '22023';
  END IF;
  -- The same start rule as a posted job (refuse_short_notice_job: 2 hours'
  -- notice, the listing closes at the start): the window never runs past the
  -- point where the job could still be booked.
  v_start := (p_date_needed + COALESCE(p_start_time, '23:59'::time)) AT TIME ZONE 'America/Chicago';
  v_close := LEAST(now() + make_interval(hours => v_window), v_start - interval '2 hours');
  IF v_close <= now() + interval '1 hour' THEN
    RAISE EXCEPTION 'job_start_too_soon' USING ERRCODE = '22023',
      HINT = 'Quotes need time: pick a later date, or set your own price.';
  END IF;

  -- One caller at a time: the open-request cap below is read-then-write.
  PERFORM pg_advisory_xact_lock(hashtext('create_quote_request'), hashtext(v_uid::text));
  IF (SELECT count(*) FROM public.job_quote_requests r
       WHERE r.poster_id = v_uid AND r.status = 'open'
         -- Only requests still collecting quotes count: nothing moves a lapsed
         -- request out of 'open', so counting it would lock a poster out. A lapsed
         -- request can still be answered and booked from quotes already in; the
         -- cap limits what strangers can see and quote on (sentry + lh-authz-rls
         -- review on PR #3173).
         AND r.quotes_close_at > now()) >= 5 THEN
    RAISE EXCEPTION 'too_many_open_requests' USING ERRCODE = '54000',
      DETAIL = 'You can ask for quotes on up to 5 jobs at a time.';
  END IF;

  INSERT INTO public.job_quote_requests (
    poster_id, title, description, category, date_needed, start_time, estimated_hours,
    location, latitude, longitude, parish, window_hours, quotes_close_at, is_seed)
  VALUES (
    v_uid, btrim(p_title), btrim(p_description), COALESCE(NULLIF(p_category, ''), 'other')::public.job_category,
    p_date_needed, p_start_time, p_estimated_hours,
    NULLIF(btrim(p_location), ''), p_latitude, p_longitude, NULLIF(btrim(p_parish), ''),
    v_window, v_close,
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = v_uid AND p.is_seed))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_quote_request(text, text, text, date, time, numeric, text, numeric, numeric, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_quote_request(text, text, text, date, time, numeric, text, numeric, numeric, text, integer) TO authenticated, service_role;
