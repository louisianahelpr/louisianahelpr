-- Q2390 packet 2 (withdraw_job_quote, switch_quote_request_to_set_price,
-- get_quotes_for_request): "not found" answers HTTP 404, not 500.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500, so a quote or request that is missing (or not the caller's) read as a
-- server failure (retried by shouldRetryQuery, counted in alerts). RAISE ...
-- USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-02, md5 equal
-- to the newest migration copy):
--   withdraw_job_quote                 81803c3dcebd1ad1e1d22e9bd874b329  967 chars (20261015091114)
--   switch_quote_request_to_set_price  860be573a17d0e8759ea67767129ac1d 1104 chars (20261015091114)
--   get_quotes_for_request             12f8bd53298d9e7c91da036db0cf974d 1283 chars (20261021131322)
-- The ONLY change is each ERRCODE 'P0002' -> 'PT404' (two lines in
-- withdraw_job_quote, one in each of the others). Messages (unknown_quote,
-- unknown_request) are unchanged, so the app's copy (lifecycleErrors, keyed on
-- the message) is unchanged. CREATE OR REPLACE keeps the grants; they are
-- restated as on prod (proacl: postgres, authenticated, service_role).

CREATE OR REPLACE FUNCTION public.withdraw_job_quote(p_quote_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid    uuid;
  v_req_id uuid;
  v_q      public.job_quotes%ROWTYPE;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT q.request_id INTO v_req_id FROM public.job_quotes q WHERE q.id = p_quote_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_quote' USING ERRCODE = 'PT404';
  END IF;
  PERFORM 1 FROM public.job_quote_requests WHERE id = v_req_id FOR UPDATE;
  SELECT * INTO v_q FROM public.job_quotes WHERE id = p_quote_id FOR UPDATE;
  IF v_q.quoter_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'unknown_quote' USING ERRCODE = 'PT404';
  END IF;
  IF v_q.status <> 'pending' THEN
    RAISE EXCEPTION 'quote_closed' USING ERRCODE = '55000';
  END IF;
  UPDATE public.job_quotes SET status = 'withdrawn', updated_at = now() WHERE id = p_quote_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.withdraw_job_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_job_quote(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.switch_quote_request_to_set_price(p_request_id uuid, p_budget numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_req public.job_quote_requests%ROWTYPE;
  v_job uuid;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_budget IS NULL OR p_budget <> round(p_budget) THEN
    RAISE EXCEPTION 'invalid_budget' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_req FROM public.job_quote_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.poster_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'PT404';
  END IF;
  IF v_req.status <> 'open' THEN
    RAISE EXCEPTION 'request_closed' USING ERRCODE = '55000';
  END IF;

  v_job := public.quote_insert_job(v_req, p_budget, NULL);
  UPDATE public.job_quotes SET status = 'closed', updated_at = now()
   WHERE request_id = p_request_id AND status = 'pending';
  UPDATE public.job_quote_requests SET status = 'closed', job_id = v_job, updated_at = now()
   WHERE id = p_request_id;
  RETURN v_job;
END;
$function$;

REVOKE ALL ON FUNCTION public.switch_quote_request_to_set_price(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.switch_quote_request_to_set_price(uuid, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_quotes_for_request(p_request_id uuid)
 RETURNS TABLE(id uuid, quoter_id uuid, quoter_name text, quoter_avatar_url text, price_cents integer, note text, available_note text, photo_paths text[], last_offer_side text, respond_until timestamp with time zone, status text, offers jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  IF NOT EXISTS (SELECT 1 FROM public.job_quote_requests r WHERE r.id = p_request_id AND r.poster_id = v_uid) THEN
    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'PT404';
  END IF;
  RETURN QUERY
    SELECT q.id, q.quoter_id, public.display_name_for_viewer(p.full_name, q.quoter_id)::text, p.avatar_url::text, q.price_cents,
           q.note, q.available_note, q.photo_paths, q.last_offer_side, q.respond_until,
           public.quote_display_status(q.status, q.respond_until),
           COALESCE((SELECT jsonb_agg(jsonb_build_object('by', o.by_side, 'price_cents', o.price_cents,
                                                         'note', o.note, 'at', o.created_at)
                                      ORDER BY o.created_at)
                       FROM public.job_quote_offers o WHERE o.quote_id = q.id), '[]'::jsonb),
           q.created_at
      FROM public.job_quotes q
      LEFT JOIN public.profiles p ON p.user_id = q.quoter_id
     WHERE q.request_id = p_request_id
       AND q.quoter_id IS NOT NULL
       AND NOT public.are_users_blocked(v_uid, q.quoter_id)
     ORDER BY q.price_cents, q.created_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_quotes_for_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quotes_for_request(uuid) TO authenticated, service_role;
