-- Saved-gift price alerts (owner approved in a pop-up, 2026-11-21: "Saved-list price alerts — opt-in email when a
-- saved gift drops in price, plus a reminder before Dec 15").
--
-- WHAT THIS ADDS (every layer is named in supabase/functions/_shared/giftPriceAlerts.ts):
--   * public.gift_price_alerts: one row per email address that opted in on the gift planner's lists. It holds the
--     saved gifts (items: [{href, name, guide}] as sent; the sender adds price (the first guide price it sees), seen (the
--     price on its last run) and alerted (the price the last drop email named)),
--     when consent was given, when the address unsubscribed, when the before-Dec-15 reminder went out, and is_seed.
--     RLS on and NO client privilege: nobody reads or writes a row from the app; only the function below writes, and
--     only the service role (the sender, the unsubscribe handler) reads.
--   * public.gift_price_alert_subscribe(email, items, consent): the only way in, for anon and signed-in callers (the
--     gift guides work signed out). It refuses without the consent box, checks the address, keeps only well-formed
--     items (https link, a name, at most 60), and rate limits like the Secret
--     Santa drawer: 5 sign-ups per network address in a rolling hour (an IPv6 address counts by its /64), 3 per email
--     address in a rolling day, and a storage brake past 5000 in an hour. Only an md5 of the bucket is kept, a day.
--     A price the caller sends is IGNORED (lh-silent-failure review: a typed or forged "was" price would make a false
--     "price drop" claim); the starting price is always the guide's own, from the feed. Emails show only gifts that are
--     in the guides' price feed, under the feed's own name (lh-authz-rls review: no caller text or link is ever mailed).
--     Signing up again replaces the list (keeping, for a gift still on it, the sender's price, seen and alerted marks,
--     so the same drop is never mailed twice) and records the new consent.
--     An address that UNSUBSCRIBED is not turned back on by a signed-out request (anyone can type anyone's address):
--     only a signed-in member whose confirmed login email is that address can, or the Resubscribe button on the
--     unsubscribe page (which carries the signed link from that inbox). Any other caller gets {items: 0,
--     was_unsubscribed: true} with its rate-limit hits KEPT (not an error that rolls them back), so asking costs a try.
--   * is_seed: decided by the ADDRESS only (a seed profile's address, a fixture inbox, a reserved test domain), never
--     by who is signed in (lh-authz-rls review: a test account must not be able to silence a real address). The
--     sender never mails a seed row outside its own test mode, and process-email-queue suppresses test recipients.
--   * send_claimed_at: stamped with the claim, cleared once the email is queued; the sender reports a claim left
--     unqueued for 2 hours (a run killed between claim and enqueue), as come-back-emails does.
--   * cron job gift-price-alerts: twice a day (15:29 and 21:29 UTC; 9:29 AM and 3:29 PM in Louisiana in winter)
--     calls the gift-price-alerts edge function, which compares each subscription with the live price feed and sends
--     at most one digest per address per run, and the reminder from Dec 10 (caught up through Dec 14).
--   * cleanup: gift_price_alerts_expire() (hourly with the rate-limit hits) deletes subscriptions on Jan 31 after
--     their season, so an address is not kept for a year after the holidays it asked about.
--
-- MONEY: none. AUTHZ: one new table with no client privilege, one SECURITY DEFINER function for anon and
-- authenticated (validated, rate limited), two service-role functions. No feature switch: the owner's rule is that
-- features ship on for everyone, and this one is opt-in by its own checkbox.
-- REPLAY-SAFE: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE, grants restated by role name, cron.schedule by
-- name (replaces), ON CONFLICT on the liveness rows. Proof: src/test/pglite/giftPriceAlerts.pglite.mjs (applied 3x).

CREATE TABLE IF NOT EXISTS public.gift_price_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'),
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 60 AND pg_column_size(items) <= 65536),
  consent_at timestamptz NOT NULL,
  unsubscribed_at timestamptz,
  reminder_sent_at timestamptz,
  last_alert_at timestamptz,
  send_claimed_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.gift_price_alerts IS
  'Saved-gift price alerts (owner 2026-11-21): one row per opted-in email address: the saved gifts with the price when saved, consent, unsubscribe and reminder stamps, is_seed. Written only by gift_price_alert_subscribe; read by the gift-price-alerts sender and email-unsubscribe (service role). No client privilege.';
-- A table made by an earlier draft of this migration gets the column too (replay-safe).
ALTER TABLE public.gift_price_alerts ADD COLUMN IF NOT EXISTS send_claimed_at timestamptz;
CREATE INDEX IF NOT EXISTS gift_price_alerts_active_idx ON public.gift_price_alerts (created_at) WHERE unsubscribed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.gift_price_alert_hits (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  bucket text NOT NULL,
  hit_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gift_price_alert_hits_bucket_idx ON public.gift_price_alert_hits (bucket, hit_at);
CREATE INDEX IF NOT EXISTS gift_price_alert_hits_at_idx ON public.gift_price_alert_hits (hit_at);

ALTER TABLE public.gift_price_alerts ENABLE ROW LEVEL SECURITY;
-- No policy on purpose: no client role is granted anything.
REVOKE ALL ON TABLE public.gift_price_alerts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.gift_price_alerts TO service_role;
ALTER TABLE public.gift_price_alert_hits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gift_price_alert_hits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.gift_price_alert_hits TO service_role;

-- Every public table keeps the unconfirmed-email gate (Q807; db-smoke).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- ── The opt-in ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- p_items: [{href, name, guide?}] from the planner's lists (a price in them is ignored). Returns {items: <how many were
-- kept>}, or {items: 0, was_unsubscribed: true} for an unsubscribed address the caller does not own.
CREATE OR REPLACE FUNCTION public.gift_price_alert_subscribe(p_email text, p_items jsonb, p_consent boolean)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_uid uuid := (SELECT auth.uid());
  v_headers jsonb;
  v_addr text;
  v_bucket text;
  v_email_bucket text;
  v_hour_total integer;
  v_items jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_el jsonb;
  v_href text;
  v_name text;
  v_guide text;
  v_old public.gift_price_alerts%ROWTYPE;
  v_seed boolean;
  v_own_address boolean := false;
  v_exists boolean;
BEGIN
  IF p_consent IS NOT TRUE THEN
    RAISE EXCEPTION 'no_consent' USING ERRCODE = '22023';
  END IF;
  IF length(v_email) < 3 OR length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'bad_email' USING ERRCODE = '22023';
  END IF;

  -- Rate limit (a refused or invalid request rolls back with its hit; only saved sign-ups count).
  BEGIN
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    v_headers := NULL;  -- no headers (a direct SQL call): the address bucket is 'no-address'
  END;
  v_addr := nullif(btrim(reverse(split_part(reverse(COALESCE(v_headers->>'x-forwarded-for', '')), ',', 1))), '');
  IF v_addr LIKE '%:%' THEN
    BEGIN
      v_addr := 'v6net:' || host(network(set_masklen(v_addr::inet, 64)));
    EXCEPTION WHEN others THEN
      v_addr := v_addr;  -- not a valid address: its own bucket
    END;
  END IF;
  v_bucket := md5('gift-price-alert:' || COALESCE(v_addr, 'no-address'));
  v_email_bucket := md5('gift-price-alert-email:' || v_email);
  DELETE FROM public.gift_price_alert_hits WHERE hit_at < now() - interval '1 day';
  SELECT count(*) INTO v_hour_total FROM public.gift_price_alert_hits WHERE hit_at > now() - interval '1 hour' AND bucket <> v_email_bucket;
  IF (SELECT count(*) FROM public.gift_price_alert_hits WHERE bucket = v_bucket AND hit_at > now() - interval '1 hour') >= 5
     OR (SELECT count(*) FROM public.gift_price_alert_hits WHERE bucket = v_email_bucket AND hit_at > now() - interval '1 day') >= 3
     OR v_hour_total >= 5000 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.gift_price_alert_hits (bucket) VALUES (v_bucket), (v_email_bucket);

  -- The items: well-formed ones only, each link once, at most 60.
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'no_items' USING ERRCODE = '22023';
  END IF;
  FOR v_el IN SELECT e FROM jsonb_array_elements(p_items) AS t(e) LIMIT 200 LOOP
    EXIT WHEN jsonb_array_length(v_items) >= 60;
    CONTINUE WHEN jsonb_typeof(v_el) <> 'object';
    v_href := v_el->>'href';
    CONTINUE WHEN v_href IS NULL OR length(v_href) > 500 OR v_href !~ '^https://[^[:space:]<>"]+$' OR v_href = ANY (v_seen);
    v_name := btrim(regexp_replace(COALESCE(v_el->>'name', ''), '[\u0001-\u001F\u007F-\u009F­؜᠎​-‏‪-‮⁠-⁩﻿]', '', 'g'));
    CONTINUE WHEN length(v_name) = 0;
    v_name := left(v_name, 120);
    v_guide := v_el->>'guide';
    IF v_guide IS NOT NULL AND v_guide !~ '^[a-z0-9-]{1,60}$' THEN
      v_guide := NULL;
    END IF;
    v_seen := v_seen || v_href;
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('href', v_href, 'name', v_name, 'guide', v_guide)));
  END LOOP;
  IF jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'no_items' USING ERRCODE = '22023';
  END IF;

  -- Test data, by the address only: a seed profile's address, a fixture inbox, a reserved test domain.
  v_seed := EXISTS (SELECT 1 FROM public.profiles p WHERE lower(p.email) = v_email AND p.is_seed IS TRUE)
    OR COALESCE(public.is_fixture_email(v_email), false)
    OR v_email ~ '@([a-z0-9-]+\.)*(example\.(com|net|org)|[a-z0-9-]+\.(test|example|invalid|localhost)|test|example|invalid|localhost)$';

  SELECT * INTO v_old FROM public.gift_price_alerts WHERE email = v_email FOR UPDATE;
  v_exists := FOUND;
  IF v_exists AND v_old.unsubscribed_at IS NOT NULL THEN
    -- Only the address's own signed-in owner turns an unsubscribed address back on.
    IF v_uid IS NOT NULL THEN
      SELECT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_uid AND lower(u.email) = v_email AND u.email_confirmed_at IS NOT NULL)
        INTO v_own_address;
    END IF;
    IF NOT v_own_address THEN
      -- Not an error: an error would roll back this request's rate-limit hits and make asking free.
      RETURN jsonb_build_object('items', 0, 'was_unsubscribed', true);
    END IF;
  END IF;
  IF v_exists THEN
    -- Keep, for a gift still on the list, the sender's marks (price, seen, alerted): never the same drop twice.
    SELECT COALESCE(jsonb_agg(n.e || COALESCE(jsonb_strip_nulls(jsonb_build_object('price', o.e->'price', 'seen', o.e->'seen', 'alerted', o.e->'alerted')), '{}'::jsonb) ORDER BY n.ord), '[]'::jsonb)
      INTO v_items
      FROM jsonb_array_elements(v_items) WITH ORDINALITY AS n(e, ord)
      LEFT JOIN LATERAL (
        SELECT x AS e FROM jsonb_array_elements(v_old.items) AS y(x) WHERE x->>'href' = n.e->>'href' LIMIT 1
      ) o ON true;
    UPDATE public.gift_price_alerts
       SET items = v_items, consent_at = now(), unsubscribed_at = NULL, is_seed = v_seed, updated_at = now()
     WHERE id = v_old.id;
  ELSE
    INSERT INTO public.gift_price_alerts (email, items, consent_at, is_seed) VALUES (v_email, v_items, now(), v_seed);
  END IF;
  RETURN jsonb_build_object('items', jsonb_array_length(v_items));
END;
$fn$;
REVOKE ALL ON FUNCTION public.gift_price_alert_subscribe(text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_price_alert_subscribe(text, jsonb, boolean) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.gift_price_alert_subscribe(text, jsonb, boolean) IS
  'Saved-gift price alerts: opt in an email address for its saved gifts (consent required, address and items checked, any price ignored, rate limited per network address and per email). An unsubscribed address turns back on only for its signed-in owner. anon + authenticated.';

-- ── Cleanup: the season's subscriptions after Jan 31, and day-old rate-limit hits ────────────────────────────────
CREATE OR REPLACE FUNCTION public.gift_price_alerts_expire()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_rows integer;
  v_hits integer;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
BEGIN
  -- A subscription made in season Y (Feb 1 of Y .. Jan 31 of Y+1) is deleted from Feb 1 of Y+1.
  DELETE FROM public.gift_price_alerts
   WHERE (created_at AT TIME ZONE 'America/Chicago')::date
         < make_date(extract(year FROM v_today)::int - CASE WHEN extract(month FROM v_today) = 1 THEN 1 ELSE 0 END, 2, 1);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  DELETE FROM public.gift_price_alert_hits WHERE hit_at < now() - interval '1 day';
  GET DIAGNOSTICS v_hits = ROW_COUNT;
  RETURN jsonb_build_object('subscriptions', v_rows, 'hits', v_hits);
END;
$fn$;
REVOKE ALL ON FUNCTION public.gift_price_alerts_expire() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_price_alerts_expire() TO service_role;

-- ── Schedules + liveness registry ─────────────────────────────────────────────────────────────────────────────────
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('gift-price-alerts', interval '20 hours',
            'Owner 2026-11-21: twice a day (15:29 and 21:29 UTC) emails each opted-in address one digest of its saved gifts that dropped at least $5 or 10% since saved (or since the last drop email), and the before-Dec-15 reminder from Dec 10. 20 hours: the overnight gap 21:29 -> 15:29 is 18 hours.',
            'exempt',
            'No drop and no reminder due is the healthy state on most runs, so a run that sends nothing is not a silent failure. A run that cannot read the price feed or the subscriptions, or cannot queue an email, answers 500 through cronResult.'),
           ('gift-price-alerts-expire', interval '3 hours',
            'Saved-gift price alerts: hourly, deletes subscriptions after Jan 31 of their season and day-old rate-limit hits.',
            'exempt',
            'Most hours nothing has expired, so a run that deletes nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('gift-price-alerts', '29 15,21 * * *', $c$SELECT public.cron_http_tag(q.request_id, 'gift-price-alerts')
  FROM (
      SELECT net.http_post(timeout_milliseconds := 120000,
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/gift-price-alerts',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{}'::jsonb
      )
) AS q(request_id);$c$);
    PERFORM cron.schedule('gift-price-alerts-expire', '47 * * * *',
      $c$SELECT public.cron_record_work('gift-price-alerts-expire', to_jsonb(public.gift_price_alerts_expire()));$c$);
  END IF;
END
$do$;
