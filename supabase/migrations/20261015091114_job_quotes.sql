-- Quotes on jobs, slice 1 (owner decisions Q1-Q8, docs/specs/louisiana-hub-roadmap.md
-- "Quotes on jobs + Shops rate cards", decided 2026-10-14).
--
--   Q1  Per job the poster picks "Set my price" (today's flow) or "Get quotes".
--       With quotes the poster may counter a quote, or switch to setting their
--       own price (switch_quote_request_to_set_price).
--   Q4  The quote window is 24 h / 48 h / 3 days, default 48 h (window_hours).
--   Q5  Quotes are PRIVATE: only the poster sees them. Not an auction: a quoter
--       never sees another quoter's price, a count, or a rank. RLS (below) and
--       every RPC enforce it.
--   Q6  Counters go back and forth; each side has 48 h to accept / decline /
--       counter (respond_until). Only the side that did NOT make the last offer
--       may answer it.
--   Q7  A quote = total price + a short note (what's included, materials) +
--       when they can do it; optional photos of past work (photo_paths).
--   Q8  An agreed quote becomes a NORMAL job at that price: book_accepted_quote
--       inserts the jobs row AS THE POSTER (so every jobs INSERT trigger runs
--       exactly as for a posted job: column lock -> payment_status 'unpaid',
--       status 'open', direct-offer markers, budget range, contact filter,
--       open-job limit, ban gate), offered to the quoter as a direct offer.
--       The poster then pays through the SAME create-payment 'escrow' action as
--       any job; the flat 5% + $0.70 comes out of the Helpr's pay there. There
--       is no second payment path, and nothing here funds a job.
--   Q2  (partial) The request stays open for any member to quote. Inviting
--       specific businesses from Shops waits for Shops: the hook is
--       job_quote_requests.invited_only (CHECKed false today) plus a future
--       invites table; see docs/OPEN.md Q?quotes-shop-invites.
--   Q3  Rate-card estimates wait for Shops (docs/OPEN.md Q?quotes-rate-cards).
--
-- Never role-based: every account can ask for quotes and every account can
-- quote. Under-18 and banned callers are refused in each RPC (as apply_to_job
-- and suggest_category do), unconfirmed emails by the Q807 statement gate on
-- the new tables, contact details by contact_leak_reason() on every free-text
-- field. Each client RPC also names is_caller_banned() in its own body: that
-- is what the live ban-gate coverage check (scripts/ci/ban-gate-coverage.sql)
-- reads, so a helper call alone would read as ungated.
--
-- Behind the hidden switch 'quotes', created OFF: every RPC starts with
-- require_feature('quotes').
--
-- REVIEW FREEZE (iOS 1.0.4 in review): new tables and RPCs only. No existing
-- grant, column, or function is narrowed or restated here.
--
-- Replay-safe: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF
-- EXISTS before CREATE POLICY / TRIGGER, ON CONFLICT DO NOTHING, grants restated.

-- ---------------------------------------------------------------------------
-- 1. Tables

CREATE TABLE IF NOT EXISTS public.job_quote_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable + SET NULL: an account deletion anonymises (a job can outlive its poster).
  poster_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title           text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 120),
  description     text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 10 AND 4000),
  category        public.job_category NOT NULL DEFAULT 'other',
  date_needed     date NOT NULL,
  start_time      time,
  estimated_hours numeric CHECK (estimated_hours IS NULL OR (estimated_hours > 0 AND estimated_hours <= 24)),
  -- The full address: the poster's own; quoters only ever get mask_job_location().
  location        text CHECK (location IS NULL OR char_length(location) <= 300),
  latitude        numeric,
  longitude       numeric,
  parish          text CHECK (parish IS NULL OR char_length(parish) <= 60),
  window_hours    integer NOT NULL DEFAULT 48 CHECK (window_hours IN (24, 48, 72)),
  quotes_close_at timestamptz NOT NULL,
  -- open: taking quotes / counters. agreed: a quote was accepted (job_id set once
  -- the poster books it). closed: the poster switched to setting their own price.
  -- cancelled: the poster withdrew the request.
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'agreed', 'closed', 'cancelled')),
  -- Q2 hook (Shops): true will mean "only invited businesses may quote". Always
  -- false in slice 1; the CHECK keeps it so until the invites slice widens it.
  invited_only    boolean NOT NULL DEFAULT false CHECK (invited_only = false),
  job_id          uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  is_seed         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_quote_requests_open_idx
  ON public.job_quote_requests (quotes_close_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS job_quote_requests_poster_idx
  ON public.job_quote_requests (poster_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.job_quotes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     uuid NOT NULL REFERENCES public.job_quote_requests(id) ON DELETE CASCADE,
  quoter_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The offer currently on the table (the quote, or the latest counter). Whole
  -- dollars in cents, inside the jobs budget range ($10-$1,000, jobs_budget_range).
  price_cents    integer NOT NULL CHECK (price_cents BETWEEN 1000 AND 100000 AND price_cents % 100 = 0),
  note           text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 500),
  available_note text NOT NULL CHECK (char_length(btrim(available_note)) BETWEEN 1 AND 120),
  -- Optional photos of past work: storage paths under the quoter's own folder.
  photo_paths    text[] NOT NULL DEFAULT '{}' CHECK (cardinality(photo_paths) <= 4),
  last_offer_side  text NOT NULL DEFAULT 'quoter' CHECK (last_offer_side IN ('quoter', 'poster')),
  respond_until     timestamptz NOT NULL,
  offer_count    integer NOT NULL DEFAULT 1 CHECK (offer_count BETWEEN 1 AND 20),
  -- pending: on the table. accepted: agreed (the request is 'agreed').
  -- declined / withdrawn: ended by a side. closed: another quote won, or the
  -- request was cancelled / switched to a set price. An unanswered pending
  -- quote past respond_until READS as 'expired' (quote_display_status) and can no
  -- longer be accepted or countered.
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'closed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- One quote per member per request; they negotiate inside it. Partial: a deleted
-- account's anonymised row (quoter_id NULL) never blocks anything.
CREATE UNIQUE INDEX IF NOT EXISTS job_quotes_one_per_quoter
  ON public.job_quotes (request_id, quoter_id) WHERE quoter_id IS NOT NULL;
-- At most ONE accepted quote per request, whatever races (the accept RPC also
-- locks the request row; this is the backstop).
CREATE UNIQUE INDEX IF NOT EXISTS job_quotes_one_accepted
  ON public.job_quotes (request_id) WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS job_quotes_quoter_idx
  ON public.job_quotes (quoter_id, created_at DESC);

-- The back-and-forth, oldest first. No person column: by_side says which party.
CREATE TABLE IF NOT EXISTS public.job_quote_offers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id    uuid NOT NULL REFERENCES public.job_quotes(id) ON DELETE CASCADE,
  by_side     text NOT NULL CHECK (by_side IN ('quoter', 'poster')),
  price_cents integer NOT NULL CHECK (price_cents BETWEEN 1000 AND 100000),
  note        text CHECK (note IS NULL OR char_length(note) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_quote_offers_quote_idx
  ON public.job_quote_offers (quote_id, created_at);

-- ---------------------------------------------------------------------------
-- 2. RLS (Q5). Reads only; every write goes through the definer RPCs below.
--    A request is visible to its poster. A quote (and its offers) is visible to
--    the request's poster and to the quoter who wrote it, never to another
--    quoter. Slice 1 adds nothing to the realtime publication; if a later slice
--    does, these policies are what it delivers by.

ALTER TABLE public.job_quote_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_quote_offers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.job_quote_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.job_quotes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.job_quote_offers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.job_quote_requests TO authenticated;
GRANT SELECT ON TABLE public.job_quotes TO authenticated;
GRANT SELECT ON TABLE public.job_quote_offers TO authenticated;
GRANT ALL ON TABLE public.job_quote_requests TO service_role;
GRANT ALL ON TABLE public.job_quotes TO service_role;
GRANT ALL ON TABLE public.job_quote_offers TO service_role;

DROP POLICY IF EXISTS job_quote_requests_poster_reads ON public.job_quote_requests;
CREATE POLICY job_quote_requests_poster_reads ON public.job_quote_requests
  FOR SELECT TO authenticated
  USING (poster_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS job_quotes_parties_read ON public.job_quotes;
CREATE POLICY job_quotes_parties_read ON public.job_quotes
  FOR SELECT TO authenticated
  USING (
    quoter_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM public.job_quote_requests r
                WHERE r.id = job_quotes.request_id
                  AND r.poster_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS job_quote_offers_parties_read ON public.job_quote_offers;
CREATE POLICY job_quote_offers_parties_read ON public.job_quote_offers
  FOR SELECT TO authenticated
  -- Visible exactly when its quote is: the sub-select runs under job_quotes'
  -- own policy above (a JOIN to job_quote_requests here would hide the
  -- quoter's own offers, since a quoter cannot read the request row).
  USING (
    EXISTS (SELECT 1 FROM public.job_quotes q WHERE q.id = job_quote_offers.quote_id)
  );

-- ---------------------------------------------------------------------------
-- 3. The switch (created OFF; an admin flips it in Settings).

INSERT INTO public.feature_switches (key, audience, description)
VALUES ('quotes', 'off',
        'Quotes on jobs: Get quotes on Post a Job, the quote form, counters, and booking an '
        'agreed quote as a normal paid job. Gates every job quote RPC.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Contact filter on every free-text field (same rule as jobs and Declutter).

CREATE OR REPLACE FUNCTION public.reject_contact_leak_in_quote()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_reason text;
  v_where  text;
BEGIN
  IF TG_TABLE_NAME = 'job_quote_requests' THEN
    v_reason := public.contact_leak_reason(NEW.title); v_where := 'title';
    IF v_reason IS NULL THEN
      v_reason := public.contact_leak_reason(NEW.description); v_where := 'description';
    END IF;
  ELSIF TG_TABLE_NAME = 'job_quotes' THEN
    v_reason := public.contact_leak_reason(NEW.note); v_where := 'note';
    IF v_reason IS NULL THEN
      v_reason := public.contact_leak_reason(NEW.available_note); v_where := 'availability';
    END IF;
  ELSIF TG_TABLE_NAME = 'job_quote_offers' THEN
    v_reason := public.contact_leak_reason(NEW.note); v_where := 'note';
  END IF;
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = v_reason || ' in the ' || v_where || '. Keep contact details and payment off the quote; messages and payment happen in the app.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.reject_contact_leak_in_quote() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_reject_contact_leak_in_quote_request ON public.job_quote_requests;
CREATE TRIGGER trg_reject_contact_leak_in_quote_request
  BEFORE INSERT OR UPDATE OF title, description ON public.job_quote_requests
  FOR EACH ROW EXECUTE FUNCTION public.reject_contact_leak_in_quote();
DROP TRIGGER IF EXISTS trg_reject_contact_leak_in_quote ON public.job_quotes;
CREATE TRIGGER trg_reject_contact_leak_in_quote
  BEFORE INSERT OR UPDATE OF note, available_note ON public.job_quotes
  FOR EACH ROW EXECUTE FUNCTION public.reject_contact_leak_in_quote();
DROP TRIGGER IF EXISTS trg_reject_contact_leak_in_quote_offer ON public.job_quote_offers;
CREATE TRIGGER trg_reject_contact_leak_in_quote_offer
  BEFORE INSERT ON public.job_quote_offers
  FOR EACH ROW EXECUTE FUNCTION public.reject_contact_leak_in_quote();

-- ---------------------------------------------------------------------------
-- 4b. Account deletion anonymises (a job can outlive its poster). The FKs are
--     ON DELETE SET NULL; the referential UPDATE fires these triggers, which
--     drop the deleted poster's address and coordinates, stop an open request
--     taking quotes, and withdraw a deleted quoter's pending quotes. This keeps
--     purge_user_data() untouched (no restatement of a shared function here).

CREATE OR REPLACE FUNCTION public.quote_request_follows_poster_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF OLD.poster_id IS NOT NULL AND NEW.poster_id IS NULL THEN
    NEW.location := NULL;
    NEW.latitude := NULL;
    NEW.longitude := NULL;
    -- An agreed request that already has its job keeps its link (the job, and
    -- any money on it, follows the account-deletion flow for jobs).
    IF NEW.status = 'open' OR (NEW.status = 'agreed' AND NEW.job_id IS NULL) THEN
      NEW.status := 'cancelled';
      UPDATE public.job_quotes SET status = 'closed', updated_at = now()
       WHERE request_id = NEW.id AND status IN ('pending', 'accepted');
    END IF;
    -- The deleted poster's own counter-offer notes go.
    UPDATE public.job_quote_offers o SET note = NULL
      FROM public.job_quotes q
     WHERE q.request_id = NEW.id AND o.quote_id = q.id AND o.by_side = 'poster';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.quote_request_follows_poster_deletion() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.quote_follows_quoter_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF OLD.quoter_id IS NOT NULL AND NEW.quoter_id IS NULL THEN
    IF NEW.status = 'pending' THEN
      NEW.status := 'withdrawn';
    END IF;
    -- The deleted quoter's own words and photos go; the price stays (it is the
    -- poster's record of what was offered).
    NEW.note := 'Removed';
    NEW.available_note := 'Removed';
    NEW.photo_paths := '{}';
    -- ...and their words in the back-and-forth (lh-authz-rls re-review, SF5).
    UPDATE public.job_quote_offers SET note = NULL
     WHERE quote_id = NEW.id AND by_side = 'quoter';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.quote_follows_quoter_deletion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_quote_request_poster_deleted ON public.job_quote_requests;
CREATE TRIGGER trg_quote_request_poster_deleted
  BEFORE UPDATE OF poster_id ON public.job_quote_requests
  FOR EACH ROW EXECUTE FUNCTION public.quote_request_follows_poster_deletion();
DROP TRIGGER IF EXISTS trg_quote_quoter_deleted ON public.job_quotes;
CREATE TRIGGER trg_quote_quoter_deleted
  BEFORE UPDATE OF quoter_id ON public.job_quotes
  FOR EACH ROW EXECUTE FUNCTION public.quote_follows_quoter_deletion();

-- ---------------------------------------------------------------------------
-- 5. Internal helpers (no client EXECUTE).

-- Refuse a caller who may not take part: signed out, banned, or under 18.
CREATE OR REPLACE FUNCTION public.quote_require_member()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF public.member_under_18(v_uid) THEN
    RAISE EXCEPTION 'under_18'
      USING ERRCODE = '42501', HINT = 'You must be 18 or older to post or quote on jobs.';
  END IF;
  RETURN v_uid;
END;
$fn$;
REVOKE ALL ON FUNCTION public.quote_require_member() FROM PUBLIC, anon, authenticated;

-- What a quote reads as right now: an unanswered pending offer past its 48 h is 'expired'.
CREATE OR REPLACE FUNCTION public.quote_display_status(p_status text, p_respond_until timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN p_status = 'pending' AND p_respond_until <= now() THEN 'expired' ELSE p_status END;
$fn$;
REVOKE ALL ON FUNCTION public.quote_display_status(text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quote_display_status(text, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.quote_notify(p_user uuid, p_title text, p_message text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_user IS NULL THEN
    RETURN;
  END IF;
  -- The link names the actor (the signed-in member who quoted, countered,
  -- declined or accepted: every caller is that member's own RPC), so the
  -- seed boundary (notification_crosses_seed_boundary reads ?user=<uuid>)
  -- drops a row a seed account's action would send to a real person (Q137).
  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (p_user, p_title, p_message, 'new_offers',
          CASE WHEN (SELECT auth.uid()) IS NULL THEN '/quotes'
               ELSE '/quotes?user=' || (SELECT auth.uid())::text END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.quote_notify(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Poster: ask for quotes (Q1, Q4).

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
       WHERE r.poster_id = v_uid AND r.status = 'open') >= 5 THEN
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

-- ---------------------------------------------------------------------------
-- 7. Quoters: open requests (Q2 partial, Q5). The caller's OWN quote status
--    only; never another quoter's price, a count, or a rank. Location masked.

CREATE OR REPLACE FUNCTION public.list_open_quote_requests()
RETURNS TABLE(
  id uuid, title text, description text, category text, date_needed date, start_time time,
  estimated_hours numeric, location text, latitude numeric, longitude numeric, parish text,
  quotes_close_at timestamptz, created_at timestamptz, my_quote_id uuid, my_quote_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  RETURN QUERY
    SELECT r.id, r.title, r.description, r.category::text, r.date_needed, r.start_time,
           r.estimated_hours, public.mask_job_location(r.location),
           round(r.latitude, 2), round(r.longitude, 2), r.parish,
           r.quotes_close_at, r.created_at,
           q.id, public.quote_display_status(q.status, q.respond_until)
      FROM public.job_quote_requests r
      LEFT JOIN public.job_quotes q ON q.request_id = r.id AND q.quoter_id = v_uid
     WHERE r.status = 'open'
       AND r.quotes_close_at > now()
       AND r.invited_only = false
       AND r.poster_id IS NOT NULL
       AND r.poster_id <> v_uid
       AND NOT public.are_users_blocked(r.poster_id, v_uid)
       AND (NOT r.is_seed OR NOT public.seed_hidden_in_discovery())
       -- Same rule as open_jobs_browse: a poster under ban review is hidden.
       AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue b
                        WHERE b.user_id = r.poster_id AND b.review_state = 'open')
     ORDER BY r.created_at DESC
     LIMIT 200;
END;
$fn$;
REVOKE ALL ON FUNCTION public.list_open_quote_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_open_quote_requests() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Quoter: send a quote (Q7).

CREATE OR REPLACE FUNCTION public.submit_job_quote(
  p_request_id uuid,
  p_price_cents integer,
  p_note text,
  p_available_note text,
  p_photo_paths text[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_req public.job_quote_requests%ROWTYPE;
  v_id  uuid;
  v_photos text[] := COALESCE(p_photo_paths, '{}');
  v_path text;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  FOREACH v_path IN ARRAY v_photos LOOP
    -- Only the quoter's own quotes folder: account deletion erases exactly
    -- job-photos/<uid>/quotes/ (purgeBuckets.ts IDENTITY_SUBFOLDERS), so a
    -- path anywhere else would outlive the purge (lh-silent-failure review).
    IF v_path IS NULL OR v_path NOT LIKE v_uid::text || '/quotes/%' OR v_path LIKE '%..%' THEN
      RAISE EXCEPTION 'invalid_photo' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Per-quoter serialization: the daily cap below is read-then-write.
  PERFORM pg_advisory_xact_lock(hashtext('submit_job_quote'), hashtext(v_uid::text));
  IF (SELECT count(*) FROM public.job_quotes q
       WHERE q.quoter_id = v_uid AND q.created_at > now() - interval '24 hours') >= 20 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;

  -- FOR SHARE composes with the poster's FOR UPDATE in accept / switch /
  -- cancel: a quote cannot land on a request being closed in the same instant.
  SELECT * INTO v_req FROM public.job_quote_requests WHERE id = p_request_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'P0002';
  END IF;
  IF v_req.poster_id IS NULL OR v_req.poster_id = v_uid THEN
    RAISE EXCEPTION 'cannot_quote_own_request' USING ERRCODE = '42501';
  END IF;
  IF v_req.status <> 'open' OR v_req.quotes_close_at <= now() OR v_req.invited_only THEN
    RAISE EXCEPTION 'quotes_closed' USING ERRCODE = '55000';
  END IF;
  IF public.are_users_blocked(v_req.poster_id, v_uid) THEN
    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.job_quotes q WHERE q.request_id = p_request_id AND q.quoter_id = v_uid) THEN
    RAISE EXCEPTION 'already_quoted' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.job_quotes (request_id, quoter_id, price_cents, note, available_note,
                                 photo_paths, last_offer_side, respond_until)
  VALUES (p_request_id, v_uid, p_price_cents, btrim(p_note), btrim(p_available_note),
          v_photos, 'quoter', now() + interval '48 hours')
  RETURNING id INTO v_id;
  INSERT INTO public.job_quote_offers (quote_id, by_side, price_cents, note)
  VALUES (v_id, 'quoter', p_price_cents, btrim(p_note));

  PERFORM public.quote_notify(v_req.poster_id, 'New quote',
    'You got a quote of $' || (p_price_cents / 100) || ' for "' || v_req.title || '".');
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.submit_job_quote(uuid, integer, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_job_quote(uuid, integer, text, text, text[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Either side: counter, accept or decline the offer on the table (Q6).
--    Only the side that did NOT make the last offer may answer it, and only
--    inside its 48 h. Lock order everywhere: request row, then quote row.

CREATE OR REPLACE FUNCTION public.respond_to_job_quote(
  p_quote_id uuid,
  p_action text,
  p_price_cents integer DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid    uuid;
  v_req_id uuid;
  v_req    public.job_quote_requests%ROWTYPE;
  v_q      public.job_quotes%ROWTYPE;
  v_side   text;
  v_other  uuid;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('accept', 'decline', 'counter') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;

  SELECT q.request_id INTO v_req_id FROM public.job_quotes q WHERE q.id = p_quote_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_quote' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_req FROM public.job_quote_requests WHERE id = v_req_id FOR UPDATE;
  SELECT * INTO v_q FROM public.job_quotes WHERE id = p_quote_id FOR UPDATE;

  IF v_uid = v_req.poster_id THEN
    v_side := 'poster'; v_other := v_q.quoter_id;
  ELSIF v_uid = v_q.quoter_id THEN
    v_side := 'quoter'; v_other := v_req.poster_id;
  ELSE
    -- Q5: a stranger learns nothing, not even that the quote exists.
    RAISE EXCEPTION 'unknown_quote' USING ERRCODE = 'P0002';
  END IF;
  IF v_other IS NULL OR public.are_users_blocked(v_req.poster_id, v_q.quoter_id) THEN
    RAISE EXCEPTION 'quote_unavailable' USING ERRCODE = '55000';
  END IF;
  IF v_req.status <> 'open' OR v_q.status <> 'pending' THEN
    RAISE EXCEPTION 'quote_closed' USING ERRCODE = '55000';
  END IF;
  IF v_q.respond_until <= now() THEN
    RAISE EXCEPTION 'quote_expired' USING ERRCODE = '55000';
  END IF;
  -- Past the posted-job start rule (2 hours' notice) the agreed job could never
  -- be booked, so nothing may be agreed or countered any more (decline still may).
  IF p_action <> 'decline' AND ((v_req.date_needed + COALESCE(v_req.start_time, '23:59'::time)) AT TIME ZONE 'America/Chicago')
       - interval '2 hours' <= now() THEN
    RAISE EXCEPTION 'job_start_too_soon' USING ERRCODE = '22023',
      HINT = 'This job starts too soon to agree a price now.';
  END IF;
  IF v_q.last_offer_side = v_side THEN
    RAISE EXCEPTION 'not_your_turn' USING ERRCODE = '55000',
      DETAIL = 'Waiting for the other side to answer your last offer.';
  END IF;

  IF p_action = 'decline' THEN
    UPDATE public.job_quotes SET status = 'declined', updated_at = now() WHERE id = p_quote_id;
    PERFORM public.quote_notify(v_other, 'Quote declined',
      'Your offer on "' || v_req.title || '" was declined.');
    RETURN 'declined';
  END IF;

  IF p_action = 'counter' THEN
    IF p_price_cents IS NULL THEN
      RAISE EXCEPTION 'price_required' USING ERRCODE = '22023';
    END IF;
    UPDATE public.job_quotes
       SET price_cents = p_price_cents, last_offer_side = v_side,
           respond_until = now() + interval '48 hours', offer_count = offer_count + 1,
           updated_at = now()
     WHERE id = p_quote_id;
    INSERT INTO public.job_quote_offers (quote_id, by_side, price_cents, note)
    VALUES (p_quote_id, v_side, p_price_cents, NULLIF(btrim(p_note), ''));
    PERFORM public.quote_notify(v_other, 'New counter-offer',
      'You got a counter-offer of $' || (p_price_cents / 100) || ' on "' || v_req.title || '".');
    RETURN 'countered';
  END IF;

  -- accept: this quote wins at the price on the table; every other quote on the
  -- request closes. The request row is locked FOR UPDATE above, so two accepts
  -- (or an accept racing a switch / cancel) serialize and the second sees
  -- status <> 'open'. job_quotes_one_accepted is the backstop.
  UPDATE public.job_quotes SET status = 'accepted', updated_at = now() WHERE id = p_quote_id;
  UPDATE public.job_quotes SET status = 'closed', updated_at = now()
   WHERE request_id = v_req.id AND id <> p_quote_id AND status = 'pending';
  UPDATE public.job_quote_requests SET status = 'agreed', updated_at = now() WHERE id = v_req.id;
  PERFORM public.quote_notify(v_other, 'Quote accepted',
    CASE WHEN v_side = 'poster'
         THEN 'Your quote of $' || (v_q.price_cents / 100) || ' for "' || v_req.title || '" was accepted. It is booked once the poster pays.'
         ELSE 'Your offer of $' || (v_q.price_cents / 100) || ' for "' || v_req.title || '" was accepted. Pay to book it.' END);
  RETURN 'accepted';
END;
$fn$;
REVOKE ALL ON FUNCTION public.respond_to_job_quote(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_job_quote(uuid, text, integer, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Poster: turn the agreed quote into a normal job (Q8). Inserted AS THE
--     POSTER so the jobs INSERT triggers treat it exactly like a posted job
--     (payment_status forced 'unpaid', status 'open', the direct offer to the
--     quoter stamped pending). Idempotent: a second call returns the same job.
--     The client then calls create-payment { action: 'escrow', jobId }, the
--     one payment path. Nothing is funded here.

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
  INSERT INTO public.jobs (customer_id, title, description, category, date_needed, start_time,
                           estimated_hours, location, latitude, longitude, parish, budget,
                           offered_to_helper_id, direct_offer_expires_at)
  VALUES (p_req.poster_id, p_req.title, p_req.description, p_req.category, p_req.date_needed,
          p_req.start_time, p_req.estimated_hours, p_req.location, p_req.latitude,
          p_req.longitude, p_req.parish, p_budget, p_offer_to,
          CASE WHEN p_offer_to IS NULL THEN NULL ELSE now() + interval '48 hours' END)
  RETURNING id INTO v_job;
  RETURN v_job;
END;
$fn$;
REVOKE ALL ON FUNCTION public.quote_insert_job(public.job_quote_requests, numeric, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.book_accepted_quote(p_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_req public.job_quote_requests%ROWTYPE;
  v_q   public.job_quotes%ROWTYPE;
  v_job uuid;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_req FROM public.job_quote_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.poster_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'P0002';
  END IF;
  IF v_req.status <> 'agreed' THEN
    RAISE EXCEPTION 'no_agreed_quote' USING ERRCODE = '55000';
  END IF;
  IF v_req.job_id IS NOT NULL THEN
    RETURN v_req.job_id;
  END IF;
  SELECT * INTO v_q FROM public.job_quotes
   WHERE request_id = p_request_id AND status = 'accepted' FOR UPDATE;
  IF NOT FOUND OR v_q.quoter_id IS NULL THEN
    RAISE EXCEPTION 'no_agreed_quote' USING ERRCODE = '55000';
  END IF;
  IF public.are_users_blocked(v_uid, v_q.quoter_id) THEN
    RAISE EXCEPTION 'quote_unavailable' USING ERRCODE = '55000';
  END IF;

  -- Whole dollars: job_quotes CHECKs price_cents % 100 = 0.
  v_job := public.quote_insert_job(v_req, (v_q.price_cents / 100)::numeric, v_q.quoter_id);
  UPDATE public.job_quote_requests SET job_id = v_job, updated_at = now() WHERE id = p_request_id;
  RETURN v_job;
END;
$fn$;
REVOKE ALL ON FUNCTION public.book_accepted_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_accepted_quote(uuid) TO authenticated, service_role;

-- The agreed price and what was priced stay fixed on the booked job (lh-money-
-- escrow review of 96ba87037, must-fix 1 and should-fix 3). The poster's own
-- money lock only covers budget once a checkout exists, and the details only
-- once a Helpr is hired, so without this a poster could book at $220 and lower
-- the budget before paying: create-payment charges jobs.budget. Applies only to
-- jobs booked from an agreed quote (no existing job is affected), and only to
-- client writes (server paths keep working). 'cancelled' too: cancelling an
-- agreed request leaves its unpaid job (still a direct offer to the quoter at
-- the agreed price), and the lock must not lift with the request (lh-authz-rls
-- review, must-fix 2). A request switched to the poster's own price is
-- 'closed' and its job is the poster's to edit like any posted job.
-- Pre-hire only (OLD.helper_id IS NULL): from the hire on, the jobs locks
-- locked_when_booked / locked_when_funded and their RPC carve-outs (schedule
-- change Q407, detail change Q1499) govern, as for every job (lh-money-escrow
-- re-review of ebe408060, M1).
CREATE OR REPLACE FUNCTION public.lock_quote_booked_job_terms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  IF (NEW.budget, NEW.title, NEW.description, NEW.category, NEW.date_needed, NEW.start_time,
      NEW.estimated_hours, NEW.location, NEW.latitude, NEW.longitude)
     IS DISTINCT FROM
     (OLD.budget, OLD.title, OLD.description, OLD.category, OLD.date_needed, OLD.start_time,
      OLD.estimated_hours, OLD.location, OLD.latitude, OLD.longitude)
     AND OLD.helper_id IS NULL
     AND EXISTS (SELECT 1 FROM public.job_quote_requests r
                  WHERE r.job_id = OLD.id AND r.status IN ('agreed', 'cancelled')) THEN
    RAISE EXCEPTION 'quote_terms_locked' USING ERRCODE = '42501',
      HINT = 'This job was booked from an agreed quote; its price and details are what was agreed.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.lock_quote_booked_job_terms() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lock_quote_booked_job_terms ON public.jobs;
CREATE TRIGGER trg_lock_quote_booked_job_terms
  BEFORE UPDATE OF budget, title, description, category, date_needed, start_time,
                   estimated_hours, location, latitude, longitude ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.lock_quote_booked_job_terms();

-- ---------------------------------------------------------------------------
-- 11. Poster: switch to setting my own price (Q1). Closes every quote and
--     posts the job at the poster's price, open to everyone (today's flow from
--     here on: pay through create-payment, then applicants).

CREATE OR REPLACE FUNCTION public.switch_quote_request_to_set_price(p_request_id uuid, p_budget numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
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
    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'P0002';
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
$fn$;
REVOKE ALL ON FUNCTION public.switch_quote_request_to_set_price(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.switch_quote_request_to_set_price(uuid, numeric) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12. Poster cancels a request; quoter withdraws a quote.

CREATE OR REPLACE FUNCTION public.cancel_quote_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_req public.job_quote_requests%ROWTYPE;
  v_job_status text;
  v_pay text;
  v_session text;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_req FROM public.job_quote_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.poster_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'P0002';
  END IF;
  -- An 'agreed' request may be cancelled too while its job was never funded
  -- (not booked yet, booking refused for a passed start, or checkout never
  -- finished), so neither side is stuck (lh-money-escrow review of 96ba87037,
  -- should-fix 4). A funded job is cancelled through the job's own cancel flow.
  IF v_req.status = 'agreed' THEN
    -- FOR SHARE: a payment landing on the job in the same instant waits. The
    -- unpaid job itself stays (a pending direct offer to the quoter, its price
    -- and details still locked by trg_lock_quote_booked_job_terms); the poster
    -- deletes it like any unpaid post.
    IF v_req.job_id IS NOT NULL THEN
      SELECT j.status::text, j.payment_status, j.stripe_session_id INTO v_job_status, v_pay, v_session
        FROM public.jobs j WHERE j.id = v_req.job_id FOR SHARE;
      -- 'unpaid' with a Checkout Session is a live checkout the poster may still
      -- finish (lh-money-escrow re-review of ebe408060, S2): refused too.
      IF FOUND AND v_job_status <> 'cancelled'
         AND COALESCE(v_pay, 'unpaid') NOT IN ('unpaid', 'abandoned', 'failed') THEN
        RAISE EXCEPTION 'request_booked' USING ERRCODE = '55000',
          HINT = 'This job is paid for; cancel it from the job instead.';
      END IF;
      IF FOUND AND v_job_status <> 'cancelled' AND v_session IS NOT NULL THEN
        RAISE EXCEPTION 'checkout_open' USING ERRCODE = '55000',
          HINT = 'A checkout is open for this job. Finish it, or try again once it expires.';
      END IF;
    END IF;
  ELSIF v_req.status <> 'open' THEN
    RAISE EXCEPTION 'request_closed' USING ERRCODE = '55000';
  END IF;
  UPDATE public.job_quotes SET status = 'closed', updated_at = now()
   WHERE request_id = p_request_id AND status IN ('pending', 'accepted');
  UPDATE public.job_quote_requests SET status = 'cancelled', updated_at = now() WHERE id = p_request_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.cancel_quote_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_quote_request(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.withdraw_job_quote(p_quote_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
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
    RAISE EXCEPTION 'unknown_quote' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.job_quote_requests WHERE id = v_req_id FOR UPDATE;
  SELECT * INTO v_q FROM public.job_quotes WHERE id = p_quote_id FOR UPDATE;
  IF v_q.quoter_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'unknown_quote' USING ERRCODE = 'P0002';
  END IF;
  IF v_q.status <> 'pending' THEN
    RAISE EXCEPTION 'quote_closed' USING ERRCODE = '55000';
  END IF;
  UPDATE public.job_quotes SET status = 'withdrawn', updated_at = now() WHERE id = p_quote_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.withdraw_job_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_job_quote(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 13. Readers.

-- The poster's requests, with how many quotes each has (the poster's own data).
CREATE OR REPLACE FUNCTION public.get_my_quote_requests()
RETURNS TABLE(
  id uuid, title text, category text, date_needed date, parish text, window_hours integer,
  quotes_close_at timestamptz, status text, job_id uuid, quote_count bigint, created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  RETURN QUERY
    SELECT r.id, r.title, r.category::text, r.date_needed, r.parish, r.window_hours,
           r.quotes_close_at, r.status, r.job_id,
           (SELECT count(*) FROM public.job_quotes q WHERE q.request_id = r.id AND q.quoter_id IS NOT NULL),
           r.created_at
      FROM public.job_quote_requests r
     WHERE r.poster_id = v_uid
     ORDER BY r.created_at DESC
     LIMIT 100;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_my_quote_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_quote_requests() TO authenticated, service_role;

-- Every quote on ONE of the caller's requests (poster only, Q5), with the
-- back-and-forth. Cheapest first is the poster's own view; quoters never see it.
CREATE OR REPLACE FUNCTION public.get_quotes_for_request(p_request_id uuid)
RETURNS TABLE(
  id uuid, quoter_id uuid, quoter_name text, quoter_avatar_url text, price_cents integer,
  note text, available_note text, photo_paths text[], last_offer_side text, respond_until timestamptz,
  status text, offers jsonb, created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  IF NOT EXISTS (SELECT 1 FROM public.job_quote_requests r WHERE r.id = p_request_id AND r.poster_id = v_uid) THEN
    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
    SELECT q.id, q.quoter_id, p.full_name::text, p.avatar_url::text, q.price_cents,
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
$fn$;
REVOKE ALL ON FUNCTION public.get_quotes_for_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quotes_for_request(uuid) TO authenticated, service_role;

-- The caller's own quotes as a quoter: their price, whose turn, the request's
-- public details. Never another quoter's anything.
CREATE OR REPLACE FUNCTION public.get_my_job_quotes()
RETURNS TABLE(
  id uuid, request_id uuid, title text, parish text, date_needed date, price_cents integer,
  note text, available_note text, last_offer_side text, respond_until timestamptz, status text,
  job_id uuid, offers jsonb, created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  RETURN QUERY
    SELECT q.id, q.request_id, r.title, r.parish, r.date_needed, q.price_cents, q.note,
           q.available_note, q.last_offer_side, q.respond_until,
           public.quote_display_status(q.status, q.respond_until),
           CASE WHEN q.status = 'accepted' THEN r.job_id ELSE NULL END,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('by', o.by_side, 'price_cents', o.price_cents,
                                                         'note', o.note, 'at', o.created_at)
                                      ORDER BY o.created_at)
                       FROM public.job_quote_offers o WHERE o.quote_id = q.id), '[]'::jsonb),
           q.created_at
      FROM public.job_quotes q
      JOIN public.job_quote_requests r ON r.id = q.request_id
     WHERE q.quoter_id = v_uid
     ORDER BY q.updated_at DESC
     LIMIT 100;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_my_job_quotes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_job_quotes() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 14. Q807: every public table carries the unconfirmed-email statement gate.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
