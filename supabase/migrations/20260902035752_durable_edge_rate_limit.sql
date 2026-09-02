-- Make `_shared/rate-limit.ts` an actual rate limit.
--
-- ── What was there ─────────────────────────────────────────────────────────
--
-- Two independent defects, either one of which alone reduces the limiter to
-- decoration. It had both, and its own doc comment said "Simple IP-based rate
-- limiter using Supabase" while making no database call of any kind.
--
--   1. THE KEY WAS SUPPLIED BY THE CALLER.
--      `req.headers.get("x-forwarded-for")?.split(",")[0]` takes the FIRST hop
--      of an append-only header. Proxies APPEND, so the first element is
--      whatever the client sent; only the last element is written by the
--      platform's own edge. A caller sending `X-Forwarded-For: <random>` got a
--      fresh empty bucket on every single request. The limit was opt-in.
--
--   2. THE STORE WAS A PER-ISOLATE `Map`.
--      `globalThis.__rateLimitStore` lives in one edge isolate. Supabase runs
--      many concurrently and recycles them constantly, so counters were split
--      across isolates and erased on every cold start. Even against a caller
--      who did not touch the header, the ceiling was "per isolate, until the
--      next cold start" — which is not a ceiling.
--
-- Eighteen user-facing endpoints import it (the figure usually quoted is
-- seventeen; `admin-user-actions` is the one it misses), including `create-payment`,
-- `instant-payout`, `cash-out-credits`, `create-bgc-payment` and
-- `stripe-idv-start` — every one of which spends money, or Stripe quota, or
-- Gemini quota per call.
--
-- ── What replaces it ───────────────────────────────────────────────────────
--
-- A durable, server-derived, shared-store limiter: this table plus the
-- `rate_limit_hit` RPC below, called by the edge module over PostgREST with
-- the service-role key.
--
-- IDENTITY. The module keys on the JWT `sub` when the request carries one, and
-- on a server-derived IP otherwise. `sub` is the right primary key precisely
-- because it is NOT caller-controlled the way a header is: for the 33 of 36
-- functions that run with `verify_jwt = true`, the Supabase gateway has already
-- validated the signature before the handler is reached, so the claim is the
-- platform's word and not the caller's.
--
-- Three of the rate-limited functions do run with `verify_jwt = false`
-- (`create-payment`, `complete-signup`, `contact-support`), where a caller
-- could mint an unsigned token and rotate `sub` to escape its own bucket. That
-- is why every hit is ALSO counted against a second, deliberately wider window
-- keyed on the IP — see `p_ip_max` below. Rotating subjects escapes the narrow
-- window and lands in the wide one.
--
-- WHY TWO WINDOWS AND NOT ONE COMBINED KEY. A single `ip+sub` key is escapable
-- by rotating `sub`; a single `ip` key puts everyone behind one NAT or one
-- mis-derived proxy address into the same bucket, which on `create-payment`
-- means one office (or one bad IP read) takes down checkout for everyone. Two
-- windows separate "this account is hammering" from "this address is
-- hammering" and let the second be an order of magnitude looser, so it is a
-- backstop against abuse rather than a shared ceiling on normal use.
--
-- ── Replay-safety ──────────────────────────────────────────────────────────
-- IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS throughout. Nothing here
-- references an object defined by a later migration. `cron_work_expectations`
-- (20260829020000) and `error_logs` both predate this file; the expectation
-- upsert is guarded on the table existing so a from-scratch replay in a
-- different order still applies.

-- ── 1. The hit log ─────────────────────────────────────────────────────────
--
-- One row per rate-limited call. Deliberately a log of individual hits rather
-- than a counter column: a rolling window needs to know WHEN each hit landed
-- to compute `Retry-After`, and an UPDATE-a-counter design has to pick a fixed
-- window boundary, which lets a caller spend 2x the budget across the seam.
-- Same shape as `application_rate_log` (20260609130000) and
-- `profile_search_rate_log` (20260830105419), which are the two rate limits in
-- this project that actually work.
CREATE TABLE IF NOT EXISTS public.edge_rate_limit_log (
  id         bigserial PRIMARY KEY,
  -- The caller's `keyPrefix` — one bucket per endpoint, so a user spending
  -- their create-payment budget still has their instant-payout budget.
  bucket     text        NOT NULL,
  -- 'u:<uuid>' when the request carried a JWT subject, else NULL.
  -- Deliberately NOT a FK to auth.users: an unverified token on a
  -- verify_jwt=false function can name a subject that does not exist, and a FK
  -- would turn that into an exception on the security path instead of a
  -- counted hit.
  subject    text        NULL,
  -- Server-derived remote address (last x-forwarded-for hop). NULL only if the
  -- platform sent no address header at all.
  ip         text        NULL,
  -- The RAW `x-forwarded-for`, kept so the derivation above is auditable.
  -- Taking the last hop is correct for an append-only header, but exactly HOW
  -- MANY hops Supabase's edge puts in front of a function is a platform detail
  -- and not a documented contract. If it ever changes so that the last hop is a
  -- proxy rather than the peer, every anonymous caller collapses into one
  -- bucket and `contact-support` starts 429ing the world — a failure that is
  -- otherwise indistinguishable from a real flood. One `SELECT DISTINCT ip,
  -- forwarded_for` answers it. Truncated because it is diagnostic, not data.
  forwarded_for text     NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.edge_rate_limit_log IS
  'Rolling-window hit log for _shared/rate-limit.ts. Written only by rate_limit_hit(); pruned daily by prune-edge-rate-limit-log.';

-- The two windows the RPC counts. Both are (key, time) so the count is an
-- index-only range scan.
CREATE INDEX IF NOT EXISTS edge_rate_limit_log_subject_idx
  ON public.edge_rate_limit_log (bucket, subject, created_at DESC)
  WHERE subject IS NOT NULL;
CREATE INDEX IF NOT EXISTS edge_rate_limit_log_ip_idx
  ON public.edge_rate_limit_log (bucket, ip, created_at DESC)
  WHERE ip IS NOT NULL;
-- Prune scans by age alone.
CREATE INDEX IF NOT EXISTS edge_rate_limit_log_created_idx
  ON public.edge_rate_limit_log (created_at);

ALTER TABLE public.edge_rate_limit_log ENABLE ROW LEVEL SECURITY;

-- No policy for anon or authenticated at all. The only writer is the
-- SECURITY DEFINER function below and the only reader is an operator holding
-- the service-role key: these rows are an abuse trail carrying IP addresses,
-- and there is no product surface that needs them.
REVOKE ALL ON public.edge_rate_limit_log FROM anon, authenticated;

-- ── 2. The check ───────────────────────────────────────────────────────────
--
-- Records the hit and answers both windows in ONE round trip. That matters: it
-- sits in front of `create-payment`, so its cost is on the critical path of
-- every checkout.
--
-- FAIL-OPEN IS THE CALLER'S JOB, NOT THIS FUNCTION'S. This function either
-- answers or raises; the edge module treats a failure to reach it as "allowed"
-- and falls back to the in-memory limiter. That is deliberate and is written
-- down in the module: every one of these endpoints does real database work
-- immediately after this check, so a database that cannot answer this query
-- cannot serve the request either — failing closed here would convert a
-- transient blip into a 429 storm on the money paths and protect nothing.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  p_bucket         text,
  p_subject        text,
  p_ip             text,
  p_window_seconds int,
  p_max            int,
  p_ip_max         int,
  p_forwarded_for  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_since       timestamptz;
  v_id_count    int := 0;
  v_ip_count    int := 0;
  v_oldest      timestamptz;
  v_allowed     boolean;
  v_binding     text;
  v_retry_after int;
BEGIN
  -- A bucket is mandatory; everything else may legitimately be absent.
  IF p_bucket IS NULL OR btrim(p_bucket) = '' THEN
    RAISE EXCEPTION 'rate_limit_hit: p_bucket is required';
  END IF;

  -- Clamp rather than trust. These come from a caller-side options object, and
  -- a zero or negative window would make `created_at >= now() - 0` count only
  -- the row we just inserted, i.e. silently disable the limit.
  p_window_seconds := greatest(coalesce(p_window_seconds, 60), 1);
  p_max            := greatest(coalesce(p_max, 1), 1);
  p_ip_max         := greatest(coalesce(p_ip_max, p_max), p_max);

  v_since := now() - make_interval(secs => p_window_seconds);

  -- Record FIRST, then count — including the row just written. Counting before
  -- inserting would let `p_max` concurrent requests each see `p_max - 1` and
  -- all pass. Insert-then-count makes the row we are grading part of the
  -- count, so the Nth caller sees N.
  --
  -- A REFUSED REQUEST IS STILL RECORDED, and that is a deliberate change from
  -- the module this replaces. The old in-memory version returned before
  -- pushing its timestamp, so hammering was free: a caller could sit exactly at
  -- the cap forever and every rejected attempt cost them nothing. Counting the
  -- refusals makes the window a penalty box — keep hammering and you stay
  -- blocked, back off for one window and you are clear — and it is also what
  -- makes this table a complete abuse trail rather than a record of only the
  -- requests that got through.
  --
  -- This is safe here only because no client of any of the eighteen importers
  -- auto-retries a 429: react-query's `retry` predicate returns false for any
  -- 4xx (src/lib/queryClient.ts) and mutations are configured with no retries
  -- at all, so nothing in the app can drive itself into the penalty box. If a
  -- future caller ever adds blind retry-on-429, it will hold itself out, and
  -- this comment is where to start reading.
  INSERT INTO public.edge_rate_limit_log (bucket, subject, ip, forwarded_for)
  VALUES (p_bucket, nullif(btrim(coalesce(p_subject, '')), ''),
                    nullif(btrim(coalesce(p_ip, '')), ''),
                    left(nullif(btrim(coalesce(p_forwarded_for, '')), ''), 200));

  -- Narrow window: the subject when we have one, the address when we do not.
  IF p_subject IS NOT NULL AND btrim(p_subject) <> '' THEN
    SELECT count(*) INTO v_id_count
      FROM public.edge_rate_limit_log l
     WHERE l.bucket = p_bucket
       AND l.subject = btrim(p_subject)
       AND l.created_at >= v_since;
  ELSIF p_ip IS NOT NULL AND btrim(p_ip) <> '' THEN
    SELECT count(*) INTO v_id_count
      FROM public.edge_rate_limit_log l
     WHERE l.bucket = p_bucket
       AND l.ip = btrim(p_ip)
       AND l.created_at >= v_since;
  ELSE
    -- No subject and no address. Nothing to attribute the hit to, so there is
    -- no honest window to enforce — allow, and say so in the answer rather
    -- than pretending a limit applied.
    RETURN jsonb_build_object('allowed', true, 'remaining', p_max,
                              'retry_after', 0, 'binding', 'none');
  END IF;

  -- Wide window: always the address, when we have one. This is what a caller
  -- rotating an unverified `sub` runs into.
  IF p_ip IS NOT NULL AND btrim(p_ip) <> '' THEN
    SELECT count(*) INTO v_ip_count
      FROM public.edge_rate_limit_log l
     WHERE l.bucket = p_bucket
       AND l.ip = btrim(p_ip)
       AND l.created_at >= v_since;
  END IF;

  v_allowed := (v_id_count <= p_max) AND (v_ip_count <= p_ip_max);

  IF v_allowed THEN
    RETURN jsonb_build_object(
      'allowed',     true,
      'remaining',   greatest(p_max - v_id_count, 0),
      'retry_after', 0,
      'binding',     'none');
  END IF;

  -- Which window tripped decides which one to time the retry against, and it
  -- is worth reporting: a `subject` trip is one account misbehaving, an `ip`
  -- trip is either subject rotation or a shared address, and those want
  -- different responses from whoever reads the logs.
  v_binding := CASE WHEN v_id_count > p_max THEN 'subject' ELSE 'ip' END;

  -- Retry-After is the moment the OLDEST hit in the binding window falls out of
  -- it — the first instant the caller is under the cap again. A fixed
  -- `windowSeconds` would over-state the wait for a caller who spent their
  -- budget early in the window.
  IF v_binding = 'subject' AND p_subject IS NOT NULL AND btrim(p_subject) <> '' THEN
    SELECT min(l.created_at) INTO v_oldest
      FROM public.edge_rate_limit_log l
     WHERE l.bucket = p_bucket
       AND l.subject = btrim(p_subject)
       AND l.created_at >= v_since;
  ELSE
    SELECT min(l.created_at) INTO v_oldest
      FROM public.edge_rate_limit_log l
     WHERE l.bucket = p_bucket
       AND l.ip = btrim(p_ip)
       AND l.created_at >= v_since;
  END IF;

  v_retry_after := greatest(
    ceil(extract(epoch FROM (coalesce(v_oldest, now())
                             + make_interval(secs => p_window_seconds) - now())))::int,
    1);

  RETURN jsonb_build_object(
    'allowed',     false,
    'remaining',   0,
    'retry_after', v_retry_after,
    'binding',     v_binding);
END;
$fn$;

COMMENT ON FUNCTION public.rate_limit_hit(text, text, text, int, int, int, text) IS
  'Records one rate-limit hit and grades it against a narrow (subject-or-ip) and a wide (ip) rolling window. Called only by supabase/functions/_shared/rate-limit.ts with the service-role key.';

-- Service-role only. This function WRITES on every call and takes its subject
-- and address as plain arguments, so anything that can execute it can both
-- forge an attribution and inflate someone else's counter. The edge module is
-- the only legitimate caller and it holds the service key.
REVOKE ALL ON FUNCTION public.rate_limit_hit(text, text, text, int, int, int, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rate_limit_hit(text, text, text, int, int, int, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, text, text, int, int, int, text) TO service_role;

-- ── 3. Pruning ─────────────────────────────────────────────────────────────
--
-- The widest window any importer configures is 15 minutes (`contact-support`).
-- A day of retention leaves the rows useful for answering "who was hammering
-- us last night" long after they stop affecting any decision, and bounds the
-- table without a second thought.
CREATE OR REPLACE FUNCTION public.prune_edge_rate_limit_log()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_deleted int := 0;
BEGIN
  DELETE FROM public.edge_rate_limit_log
   WHERE created_at < now() - interval '1 day';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('deleted', v_deleted);
END;
$fn$;

REVOKE ALL ON FUNCTION public.prune_edge_rate_limit_log() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_edge_rate_limit_log() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_edge_rate_limit_log() TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping prune-edge-rate-limit-log';
    RETURN;
  END IF;

  PERFORM cron.unschedule('prune-edge-rate-limit-log')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-edge-rate-limit-log');

  -- 04:56. Off every minute claimed by 20260829010000's minute map, off the
  -- :47/:53/:57 sweep slots, and deliberately NOT 04:52 — `prune-cron-run-log`
  -- already owns that minute (20260829020000), and two DELETEs starting in the
  -- same second is exactly the co-firing that map exists to prevent.
  PERFORM cron.schedule(
    'prune-edge-rate-limit-log',
    '56 4 * * *',
    $cron$SELECT public.prune_edge_rate_limit_log();$cron$
  );
END;
$$;

-- Liveness, on the same terms as every other cron (20260901030926). Guarded on
-- the table existing so migration order cannot break a from-scratch replay.
DO $$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.cron_work_expectations (jobname, expected_max_gap)
  VALUES ('prune-edge-rate-limit-log', interval '30 hours')
  ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
END;
$$;
