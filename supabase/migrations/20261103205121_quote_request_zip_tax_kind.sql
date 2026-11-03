-- Q2083 (b), quote-request bookings: a job booked from quotes carries the job
-- ZIP and the poster's taxed-kind answer, as a posted job does.
--
-- What was broken. Q2083 (b) prices a taxable job's sales tax at the JOB
-- ADDRESS (create-payment calls Stripe tax.calculations at jobs.zip_code, and
-- a taxable job with no Louisiana ZIP gets no checkout). Post a Job writes
-- jobs.zip_code and jobs.tax_kind. A job booked from quotes is inserted by
-- quote_insert_job from the job_quote_requests row, and that table had
-- neither column (measured on prod information_schema, B62 2026-11-03), so a
-- quote-booked Auto Repair or Appliance Repair job would be refused at
-- checkout, and a quote-booked "fixes an item" job would never be taxed.
-- Today the 'quotes' switch is testers-only and prod has 0 quote-booked jobs.
--
-- Change:
--   1. job_quote_requests gets zip_code and tax_kind (tax_kind with the same
--      CHECK as jobs_tax_kind_valid, 20261102152453).
--   2. create_quote_request takes p_zip_code and p_tax_kind (13 arguments).
--      The 11-argument version is DROPPED first, so there is exactly one
--      create_quote_request and PostgREST never sees two overloads; an older
--      app that sends the 11 named arguments still resolves to the new one
--      (the two new ones have defaults) and is refused 'invalid_zip' (it
--      sent no ZIP), never a 500. The ZIP is required and must be a
--      Louisiana ZIP (700xx-714xx, the same rule as
--      supabase/functions/_shared/jobTaxAddress.ts); a ZIP+4 is cut to its
--      five digits, as Post a Job does (jobSubmitHelpers). tax_kind is
--      stored NULL when the category already taxes the labor
--      (is_job_labor_taxable(category, NULL): Auto Repair, Appliance Repair),
--      as Post a Job's form clears it; a value outside the four kinds is
--      refused 'invalid_tax_kind'. Both refusals are 22023 (PostgREST: 400).
--      The rest of the body is prod's (md5 f0051ef282572e766e03516d48956894,
--      read 2026-11-03 2:5x PM CST), unchanged.
--   3. quote_insert_job also copies zip_code and tax_kind onto the job. Its
--      body is otherwise prod's (md5 e0b4adf28f505ba18142821a8f46e902).
--      enforce_jobs_insert_column_lock names neither column (B62, measured),
--      so this SECURITY DEFINER insert of both is not column-locked.
--      book_accepted_quote and switch_quote_request_to_set_price only call
--      quote_insert_job and are not restated.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, the CHECK added only when missing,
-- DROP FUNCTION IF EXISTS on the old signature, CREATE OR REPLACE, grants
-- restated. Proof: src/test/pglite/quoteRequestZipTaxKind.pglite.mjs (applied
-- 3x; --before leaves this file out and the checks fail). Guard:
-- src/test/quoteRequestZipTaxKind.test.ts.

ALTER TABLE public.job_quote_requests ADD COLUMN IF NOT EXISTS zip_code text;
ALTER TABLE public.job_quote_requests ADD COLUMN IF NOT EXISTS tax_kind text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.job_quote_requests'::regclass AND conname = 'job_quote_requests_tax_kind_valid'
  ) THEN
    ALTER TABLE public.job_quote_requests
      ADD CONSTRAINT job_quote_requests_tax_kind_valid CHECK (tax_kind IS NULL OR tax_kind IN ('item_repair', 'fabric_cleaning', 'clothes_cleaning', 'clothing_alterations'));
  END IF;
END $$;

COMMENT ON COLUMN public.job_quote_requests.zip_code IS
  'The job site''s 5-digit Louisiana ZIP (Q2083 b). quote_insert_job copies it to jobs.zip_code, where the checkout prices sales tax.';
COMMENT ON COLUMN public.job_quote_requests.tax_kind IS
  'The poster''s taxed-kind answer, as jobs.tax_kind (Q2083, owner Option 1); NULL = none, and always NULL for a category that taxes the labor itself. quote_insert_job copies it to jobs.tax_kind.';

DROP FUNCTION IF EXISTS public.create_quote_request(text, text, text, date, time, numeric, text, numeric, numeric, text, integer);

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
  p_window_hours integer DEFAULT 48,
  p_zip_code text DEFAULT NULL,
  p_tax_kind text DEFAULT NULL
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
  v_category public.job_category;
  v_zip text := left(regexp_replace(COALESCE(p_zip_code, ''), '\D', '', 'g'), 5);
  v_tax_kind text := NULLIF(btrim(COALESCE(p_tax_kind, '')), '');
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
  -- Q2083 (b): the job ZIP prices the sales tax at checkout, so it is
  -- required and Louisiana's (700xx-714xx, as _shared/jobTaxAddress.ts).
  IF v_zip !~ '^(70[0-9]|71[0-4])[0-9]{2}$' THEN
    RAISE EXCEPTION 'invalid_zip' USING ERRCODE = '22023', DETAIL = 'Add the job''s Louisiana ZIP code.';
  END IF;
  IF v_tax_kind IS NOT NULL
     AND v_tax_kind <> ALL (ARRAY['item_repair', 'fabric_cleaning', 'clothes_cleaning', 'clothing_alterations']) THEN
    RAISE EXCEPTION 'invalid_tax_kind' USING ERRCODE = '22023';
  END IF;
  v_category := COALESCE(NULLIF(p_category, ''), 'other')::public.job_category;
  -- A category that taxes the labor itself carries no taxed-kind answer (Post
  -- a Job's form clears it for Auto Repair and Appliance Repair).
  IF public.is_job_labor_taxable(v_category, NULL) THEN
    v_tax_kind := NULL;
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
    location, latitude, longitude, parish, window_hours, quotes_close_at, is_seed,
    zip_code, tax_kind)
  VALUES (
    v_uid, btrim(p_title), btrim(p_description), v_category,
    p_date_needed, p_start_time, p_estimated_hours,
    NULLIF(btrim(p_location), ''), p_latitude, p_longitude, NULLIF(btrim(p_parish), ''),
    v_window, v_close,
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = v_uid AND p.is_seed),
    v_zip, v_tax_kind)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_quote_request(text, text, text, date, time, numeric, text, numeric, numeric, text, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_quote_request(text, text, text, date, time, numeric, text, numeric, numeric, text, integer, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.quote_insert_job(p_req public.job_quote_requests, p_budget numeric, p_offer_to uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_job uuid;
BEGIN
  -- direct_offer_expires_at: the longest the jobs INSERT column lock allows
  -- (48 h), so the quoter's offer outlives a checkout the poster finishes late
  -- (lh-money-escrow review of 96ba87037, should-fix 2). NULL when unoffered.
  -- zip_code and tax_kind (Q2083 b): the checkout prices the job's sales tax
  -- at its ZIP, from its category or tax_kind, as for a posted job.
  INSERT INTO public.jobs (customer_id, title, description, category, date_needed, start_time,
                           estimated_hours, location, latitude, longitude, parish, budget,
                           offered_to_helper_id, direct_offer_expires_at, zip_code, tax_kind)
  VALUES (p_req.poster_id, p_req.title, p_req.description, p_req.category, p_req.date_needed,
          p_req.start_time, p_req.estimated_hours, p_req.location, p_req.latitude,
          p_req.longitude, p_req.parish, p_budget, p_offer_to,
          CASE WHEN p_offer_to IS NULL THEN NULL ELSE now() + interval '48 hours' END,
          p_req.zip_code, p_req.tax_kind)
  RETURNING id INTO v_job;
  RETURN v_job;
END;
$fn$;

REVOKE ALL ON FUNCTION public.quote_insert_job(public.job_quote_requests, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quote_insert_job(public.job_quote_requests, numeric, uuid) TO service_role;
