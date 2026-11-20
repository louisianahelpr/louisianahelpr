-- Gift guides: My Wish List + Share (owner 2026-11-20: "add something that they can add to their list and send their
-- list to someone").
--
-- public.gift_wish_lists: one row per shared or synced list. It holds the list's NAME (the visitor's own words, e.g.
-- "Mom's Christmas List", default 'My Wish List') and its ITEMS as refs only: [{"g": <guide slug>, "i": <item id>}].
-- No email, no address, no product data; the page finds each gift in its guide by the ref.
--   * Signed out: "Share my list" saves a SNAPSHOT (user_id NULL) and returns its code: /gift-guides/list/<code>.
--     Snapshots are never changed after they are made; gift_wish_list_prune deletes those older than 90 days (daily).
--   * Signed in: the account has ONE row (user_id UNIQUE); every save updates it and keeps its code, so the shared link
--     follows the list; gift_wish_list_new_link() gives the row a new code (the old link stops working).
--     ON DELETE CASCADE: deleting the account deletes its list.
--   * is_seed: true when a test account saved it (is_test_member), when the browser says it is a test browser
--     (p_test: src/lib/automatedBrowser.ts automationReason(), the same rule analytics use), or when the request comes
--     from a local dev origin (http://localhost, as tag_automated_analytics_event reads it).
--
-- Access is through server functions only (RLS on, no policy, no table privilege for anon/authenticated):
--   gift_wish_list_save(p_name, p_items, p_test) -> code   anon + authenticated. Validates every item ref, at most 100
--        items. The name: invisible and direction-changing characters are stripped, then 1..60 characters, and never a
--        link (http://, www., a domain such as evil.com, with or without a path) or a run of 7+ digits (a phone number), since it shows on our page.
--        Rate limited: signed out, 10 saves per address per 10 minutes and 2000 snapshots an hour overall (only
--        snapshots add rows, so only they count toward the overall cap); signed in, 60 saves per account per 10
--        minutes (a save only updates the account's one row). The address is the LAST x-forwarded-for entry (as
--        sponsor_log_visit); only an md5 of it with the date is kept, in gift_wish_list_hits, for a day.
--   gift_wish_list_get(p_code) -> {name, items, updated_at} | null   anon + authenticated (anyone with the link).
--   gift_wish_list_mine() -> {code, name, items} | null              authenticated: the caller's own list.
--   gift_wish_list_new_link() -> code | null                         authenticated: a new code for the caller's row.
--   gift_wish_list_prune() -> jsonb                                  service_role: the daily snapshot cleanup (cron).
-- No feature switch: the gift guides are public and signed out by design, and this is part of them (owner rule: ship on
-- for everyone). Security review 2026-11-20 (findings 1-8) applied.
-- MONEY: none. REPLAY-SAFE: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE, REVOKE/GRANT, cron.schedule by name.
-- Proof: src/test/pglite/giftWishLists.pglite.mjs (applied 3x).

CREATE TABLE IF NOT EXISTS public.gift_wish_lists (
  code text PRIMARY KEY CHECK (code ~ '^[a-z0-9]{12}$'),
  name text NOT NULL DEFAULT 'My Wish List' CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) <= 100),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.gift_wish_lists IS
  'Gift guides wish lists (owner 2026-11-20): a shared snapshot (user_id NULL, pruned after 90 days) or an account''s synced list. Name + item refs (guide slug, item id) only. Read/written only via the gift_wish_list_* functions.';
ALTER TABLE public.gift_wish_lists ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gift_wish_lists FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.gift_wish_lists TO service_role;
-- The daily prune's read: old snapshots only.
CREATE INDEX IF NOT EXISTS gift_wish_lists_snapshot_created ON public.gift_wish_lists (created_at) WHERE user_id IS NULL;

CREATE TABLE IF NOT EXISTS public.gift_wish_list_hits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket text NOT NULL,
  -- True for a signed-out snapshot (the only saves the overall hourly cap counts).
  snapshot boolean NOT NULL DEFAULT false,
  hit_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.gift_wish_list_hits IS
  'Rate limit for gift_wish_list_save: md5(address or account + date) per save, kept one day. No address is stored.';
CREATE INDEX IF NOT EXISTS gift_wish_list_hits_bucket_at ON public.gift_wish_list_hits (bucket, hit_at);
CREATE INDEX IF NOT EXISTS gift_wish_list_hits_at ON public.gift_wish_list_hits (hit_at);
ALTER TABLE public.gift_wish_list_hits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gift_wish_list_hits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.gift_wish_list_hits TO service_role;

-- Every public table keeps the unconfirmed-email gate (Q807; db-smoke): the two tables above.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- A new list code: 12 characters from a CSPRNG UUID (16^12).
CREATE OR REPLACE FUNCTION public.gift_wish_list_new_code()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path TO 'public'
AS $fn$
  SELECT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
$fn$;
REVOKE ALL ON FUNCTION public.gift_wish_list_new_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_wish_list_new_code() TO service_role;

CREATE OR REPLACE FUNCTION public.gift_wish_list_save(p_name text, p_items jsonb, p_test boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_name text;
  v_items jsonb;
  v_headers jsonb;
  v_addr text;
  v_origin text;
  v_bucket text;
  v_code text;
  v_seed boolean;
  v_try int := 0;
  -- Saves allowed per address (signed out) or per account (signed in) in 10 minutes.
  v_limit int;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
  END IF;
  -- Every element is exactly {"g": <guide slug>, "i": <item id>}; anything else refuses the whole save.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS t(e)
     WHERE jsonb_typeof(e) <> 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(e)) <> 2
        OR jsonb_typeof(e->'g') IS DISTINCT FROM 'string'
        OR jsonb_typeof(e->'i') IS DISTINCT FROM 'string'
        OR NOT COALESCE((e->>'g') ~ '^[a-z0-9-]{1,80}$', false)
        OR NOT COALESCE((e->>'i') ~ '^[a-z0-9]{1,16}$', false)
  ) THEN
    RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
  END IF;
  -- The name shows on our page: control, zero-width and direction-changing characters are stripped first.
  v_name := btrim(regexp_replace(COALESCE(p_name, ''), '[[:cntrl:]\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]', '', 'g'));
  v_name := COALESCE(NULLIF(v_name, ''), 'My Wish List');
  IF length(v_name) > 60
     OR v_name ~* '(https?:|www\.|\.[a-z]{2,}/|\m[a-z0-9-]+\.[a-z]{2,}\M)'
     OR regexp_replace(v_name, '[\s().+-]', '', 'g') ~ '[0-9]{7,}' THEN
    RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023';
  END IF;
  -- Each item id once (the first one wins), in the list's order.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('g', x.g, 'i', x.i) ORDER BY x.n), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT DISTINCT ON (e->>'i') e->>'g' AS g, e->>'i' AS i, n
        FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(e, n)
       ORDER BY e->>'i', n
    ) x;
  -- A shared snapshot holds at least one gift (an account's synced list may be empty).
  IF v_uid IS NULL AND jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'empty_list' USING ERRCODE = '22023';
  END IF;

  -- Rate limit (as sponsor_log_visit): the platform's address is the LAST x-forwarded-for entry.
  BEGIN
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    v_headers := NULL;
  END;
  v_addr := nullif(btrim(reverse(split_part(reverse(COALESCE(v_headers->>'x-forwarded-for', '')), ',', 1))), '');
  v_origin := lower(COALESCE(v_headers->>'origin', ''));
  v_bucket := md5('gift-wish:' || COALESCE('u:' || v_uid::text, 'a:' || v_addr, 'no-address') || ':' || current_date::text);
  DELETE FROM public.gift_wish_list_hits WHERE hit_at < now() - interval '1 day';
  v_limit := CASE WHEN v_uid IS NULL THEN 10 ELSE 60 END;
  IF (SELECT count(*) FROM public.gift_wish_list_hits WHERE bucket = v_bucket AND hit_at > now() - interval '10 minutes') >= v_limit THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;
  -- The overall cap counts snapshots only (a signed-in save adds no row).
  IF v_uid IS NULL AND (SELECT count(*) FROM public.gift_wish_list_hits WHERE snapshot AND hit_at > now() - interval '1 hour') >= 2000 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.gift_wish_list_hits (bucket, snapshot) VALUES (v_bucket, v_uid IS NULL);

  v_seed := COALESCE(p_test, false)
            OR v_origin ~ '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?$'
            OR (v_uid IS NOT NULL AND public.is_test_member(v_uid));
  LOOP
    v_try := v_try + 1;
    v_code := public.gift_wish_list_new_code();
    BEGIN
      IF v_uid IS NOT NULL THEN
        INSERT INTO public.gift_wish_lists AS w (code, name, items, user_id, is_seed)
        VALUES (v_code, v_name, v_items, v_uid, v_seed)
        ON CONFLICT (user_id) DO UPDATE
          SET name = EXCLUDED.name, items = EXCLUDED.items, is_seed = w.is_seed OR EXCLUDED.is_seed, updated_at = now()
        RETURNING w.code INTO v_code;
      ELSE
        INSERT INTO public.gift_wish_lists (code, name, items, user_id, is_seed)
        VALUES (v_code, v_name, v_items, NULL, v_seed);
      END IF;
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      -- A code collision (1 in 16^12): try another code, a few times.
      IF v_try >= 5 THEN RAISE; END IF;
    END;
  END LOOP;
END;
$fn$;
REVOKE ALL ON FUNCTION public.gift_wish_list_save(text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_wish_list_save(text, jsonb, boolean) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gift_wish_list_get(p_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT jsonb_build_object('name', w.name, 'items', w.items, 'updated_at', w.updated_at)
    FROM public.gift_wish_lists w
   WHERE w.code = lower(btrim(p_code))
$fn$;
REVOKE ALL ON FUNCTION public.gift_wish_list_get(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_wish_list_get(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gift_wish_list_mine()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT jsonb_build_object('code', w.code, 'name', w.name, 'items', w.items)
    FROM public.gift_wish_lists w
   WHERE w.user_id = (SELECT auth.uid())
     AND (SELECT auth.uid()) IS NOT NULL
$fn$;
REVOKE ALL ON FUNCTION public.gift_wish_list_mine() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_wish_list_mine() TO authenticated, service_role;

-- "Make a new link": the caller's own row gets a new code, so a link sent before stops working. NULL with no row.
CREATE OR REPLACE FUNCTION public.gift_wish_list_new_link()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_code text;
  v_try int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  LOOP
    v_try := v_try + 1;
    BEGIN
      UPDATE public.gift_wish_lists w SET code = public.gift_wish_list_new_code(), updated_at = now()
       WHERE w.user_id = v_uid
      RETURNING w.code INTO v_code;
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      IF v_try >= 5 THEN RAISE; END IF;
    END;
  END LOOP;
END;
$fn$;
REVOKE ALL ON FUNCTION public.gift_wish_list_new_link() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_wish_list_new_link() TO authenticated, service_role;

-- The daily cleanup: signed-out snapshots older than 90 days (a snapshot never changes after it is made, so its age is
-- its last use as a list). Accounts' lists are kept until the account is deleted.
CREATE OR REPLACE FUNCTION public.gift_wish_list_prune()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_n int;
BEGIN
  DELETE FROM public.gift_wish_lists w WHERE w.user_id IS NULL AND w.created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('pruned', v_n);
END;
$fn$;
REVOKE ALL ON FUNCTION public.gift_wish_list_prune() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_wish_list_prune() TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('gift-wish-list-prune', interval '2 days',
            'Gift guides wish lists: daily, deletes signed-out share snapshots older than 90 days.',
            'exempt',
            'Most days no snapshot is 90 days old, so a run that deletes nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('gift-wish-list-prune', '23 9 * * *',
      $c$SELECT public.cron_record_work('gift-wish-list-prune', to_jsonb(public.gift_wish_list_prune()));$c$);
  END IF;
END
$do$;

-- Q30 catch-up policy: the newest migration that seeds cron_catchup_policy restates the whole set.
-- 20261031152136's rows verbatim, plus gift-wish-list-prune (safe to catch up: an idempotent delete).
DO $do$
BEGIN
  IF to_regclass('public.cron_catchup_policy') IS NOT NULL THEN
    -- Restates the whole policy set (the guard reads the newest seeding migration).
INSERT INTO public.cron_catchup_policy (jobname, catch_up, max_late, reason) VALUES
  ('ops-daily-digest',                true,  interval '20 hours', 'Slack digest of the last 24h of ops alerts; writes only its own delivery receipt. A late digest is the Q30 case itself: 09-22 went 38h with none.'),
  ('sweep-daily-job-digest',          true,  interval '6 hours',  'In-app "New jobs in <parish>" digest; its own NOT EXISTS skips anyone digested in the last 23h, so it cannot double-send. Capped at 6h because a late run shifts the next day''s by that 23h dedupe.'),
  ('push-token-health',               true,  interval '20 hours', 'Monitor (Q82): counts push tokens and writes at most one error_logs row per UTC day. Read-only otherwise.'),
  ('marketing-token-health',          true,  interval '20 hours', 'Monitor: checks the Meta token and that the publish queue drains; reads and alerts only.'),
  ('money-reconciliation',            true,  interval '20 hours', 'STRICTLY READ-ONLY by design (header of supabase/functions/money-reconciliation/index.ts): selects and Stripe paymentIntents.retrieve only. Reports money drift, never moves money.'),
  ('detect-suspicious-user-patterns', true,  interval '20 hours', 'Inserts a fraud_flags row only when no unresolved flag of that type exists for the user; its windows are relative to now(). Re-running is idempotent.'),
  ('sweep-old-email-send-log',        true,  interval '20 hours', 'Age-based TTL delete: a late run deletes exactly what the next run would. Idempotent.'),
  ('sweep-old-notifications',         true,  interval '20 hours', 'Age-based TTL delete of old notifications. Idempotent.'),
  ('sweep-old-error-logs',            true,  interval '20 hours', 'Age-based TTL delete of old error_logs. Idempotent.'),
  ('prune-cron-run-details',          true,  interval '20 hours', 'Deletes cron.job_run_details older than 7 days; the catch-up reads only the latest slot. Idempotent.'),
  ('prune-cron-run-log',              true,  interval '20 hours', 'Age-based prune of cron_run_log. Idempotent.'),
  ('prune-edge-rate-limit-log',       true,  interval '20 hours', 'Age-based prune of the edge rate-limit log. Idempotent.'),
  ('cleanup-notifications',           true,  interval '20 hours', 'Deletes READ notifications older than 30 days (age-based). Idempotent.'),
  ('stalled-completion-reminder',     true,  interval '6 hours',  'User nudge with its own per-job ledger (first_sent_at / second_sent_at / escalated_at, upsert ignoreDuplicates): a stage is never sent twice. 6h cap keeps it inside daytime.'),
  ('review-nag-cron',                 true,  interval '6 hours',  'User nudge with its own dedupe count per user and job inside WINDOW_HOURS, failing closed (unreadable count = already nagged). 6h cap keeps it inside daytime.'),
  ('engagement-automations',          true,  interval '6 hours',  'Lifecycle emails spaced by last_drip_at / last_approval_email_at, which it stamps on send: a late run cannot send a step twice. 6h cap keeps it inside daytime.'),
  ('charge-recurring-visits',         false, interval '1 hour',   'CHARGES CARDS for recurring visits. Money is never auto-rerun: a person checks what the missed day should have charged.'),
  ('expire-subscriptions',            false, interval '1 hour',   'Ends paid entitlements (one-time passes, lapsed tiers). Changes what a paying user has; a person decides.'),
  ('subscription-reconciliation',     false, interval '1 hour',   'REPAIRS tier state from Stripe (its header: "why this one repairs"). An automated entitlement writer is not re-run blind; a person decides.'),
  ('cleanup-abandoned-accounts',      false, interval '1 hour',   'DELETES accounts. Destructive; never re-run automatically.'),
  ('weekly-helper-report',            true,  interval '6 hours',  'Q188: weekly in-app report now skips any helper who already has one from the last 6 days (supabase/functions/weekly-helper-report, tested in src/test/edge/weekly-helper-report.test.ts), so a late run cannot send twice. 6h cap keeps it inside daytime.'),
  ('cleanup-stripe-webhook-events',   true,  interval '20 hours', 'Q167: deletes stripe_webhook_events processed over 30 days ago; the window is relative to now(), so a late run deletes exactly what an on-time one would have.'),
  ('cleanup-observability-tables',    true,  interval '20 hours', 'Q167: deletes analytics_events over 90 days and error_logs over 30; relative windows, idempotent, so a late run is the same prune.'),
  ('prune-retention-tables',          true,  interval '20 hours', 'CJ-003/CS-003: age-based deletes (login_history, notification_logs, profile_views, job_views, rate logs, W-9s over 4 years); every window is relative to now(), so a late run deletes exactly what an on-time one would have.'),
  ('purge-old-seed-data',             true,  interval '20 hours', 'Q65: age-based purge of is_seed test jobs (never money, never a fixture id, never profiles) and seed notifications; the window is relative to now() and every run is bounded and recorded, so a late run is the same purge.'),
  ('unfilled-series-visit-reminders', false, interval '1 hour',   'Tells a poster an empty series visit is TOMORROW (20261012195747). The text is relative to the run''s own day, so a late run past midnight would name the wrong day; its own once-per-visit ledger already stops a double send. Not re-run late.'),
  ('declutter-price-drops',           false, interval '1 hour',   'Declutter evening price drop (20261014210518): once per Louisiana day; a missed evening is simply skipped and the next evening drops 5% as usual. Not re-run late: a late run past midnight would spend the NEXT day''s drop.'),
  ('listing-photo-purge', false, interval '1 hour', 'Homes listing photo purge (20261019071203): deletes taken-down listings'' photos through the Storage API. Deletion is never re-run late; the next daily run deletes whatever is due.'),
  ('rentals-rent-sweep', false, interval '1 hour', 'Homes rent tracker (20261019073106): writes due rent rows, late fees and reminders. Not re-run late: the next daily run writes every missed rent row and fee itself (idempotent, from the first due date); only a missed reminder is skipped.'),
  ('rentals-deposit-sweep', false, interval '1 hour', 'Homes deposit tracker (20261019082216): deposit-return reminders by stage. Not re-run late: the next daily run sends the stage that is due (once each).'),
  ('job-match-roundups',              true,  interval '6 hours',  'Sends one "more jobs near you" email per member whose matches waited; it claims the batch (waiting -> 0) before sending, so a late run sends only what is still waiting and never twice. Capped at 6h so a very late run does not land in the evening.'),
  ('declutter-haul-away',             false, interval '1 hour',   'Declutter haul-away sweep (20261027165903): the "Haul-away is open" notice (once per listing, by its mark), a declined card''s haul-away job to abandoned, and the put-back-on-sale of a haul-away that never went ahead after 7 days. Not re-run late: the next daily run does everything that was due.'),
  ('declutter-price-nudge',           false, interval '1 hour',   'Declutter "drop the price?" nudge (20261030141656): one notice per unsold listing per 14 days, by its own mark. Not re-run late: the next daily run sends whatever is due.'),
  ('declutter-move-reminders',        false, interval '1 hour',   'Moving-sale reminders (20261030221156): the day-before notice says "tomorrow", so a late run past midnight would name the wrong day; the day-after notice looks back 3 days, so the next daily run sends it. Once each, by its own mark. Not re-run late.'),
  ('declutter-free-still-available', false, interval '1 hour',  'Declutter free listing "still available?" notice (20261030232231): at most one per listing per 14 days, by its own told-at mark. A missed morning is simply picked up by the next daily run.'),
  ('new-member-daily-summary',       false, interval '1 hour',   'One admin notice naming who joined since the last run (20261031152136). Not re-run late: the queue keeps everyone not yet summarized, so the next day''s run names them.'),
  ('gift-wish-list-prune',           true,  interval '20 hours', 'Gift guides wish list snapshot cleanup (20261120062130): deletes signed-out snapshots older than 90 days; a late run deletes the same rows, a repeat finds none. Safe to catch up.')
    ON CONFLICT (jobname) DO UPDATE
      SET catch_up = EXCLUDED.catch_up, max_late = EXCLUDED.max_late,
          reason = EXCLUDED.reason, updated_at = now();
  END IF;
END
$do$;

-- Download My Data covers the wish list: export_my_data(uuid) RESTATED FROM THE NEWEST CREATE
-- (20261112081700_shops_export_rest.sql) verbatim, plus one gift_wish_lists block before RETURN (by user_id), and
-- the 60 s statement_timeout in its header (20261115014233; src/test/exportMyDataKeepsItsTimeout.test.ts).
DROP FUNCTION IF EXISTS public.export_my_data();
CREATE OR REPLACE FUNCTION public.export_my_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_uid     uuid := p_user_id;
  v_email   text;
  v_created timestamptz;
  v_out   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email), u.created_at INTO v_email, v_created FROM auth.users u WHERE u.id = v_uid;

  v_out := jsonb_build_object('exported_at', now(), 'user_id', v_uid, 'email', v_email);

  v_out := v_out || jsonb_build_object('profile', (SELECT to_jsonb(t) - 'insurance_reviewed_by' - 'license_reviewed_by' FROM public.profiles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('jobs', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.customer_id = v_uid OR public.user_may_see_job_address(t.id, v_uid)
          THEN CASE WHEN t.customer_id = v_uid OR t.offered_to_helper_id = v_uid THEN to_jsonb(t)
                 ELSE to_jsonb(t) - 'offered_to_helper_id' END - 'removed_by'
          ELSE jsonb_build_object(
                 'id', t.id, 'title', t.title, 'category', t.category, 'parish', t.parish,
                 'status', t.status, 'created_at', t.created_at, 'row_limited', true,
                 'offered_to_you', t.offered_to_helper_id IS NOT DISTINCT FROM v_uid,
                 'cancelled_by_you', t.cancelled_by IS NOT DISTINCT FROM v_uid,
                 'disputed_by_you', t.disputed_by IS NOT DISTINCT FROM v_uid,
                 'recurring_helper_is_you', t.recurring_helper_id IS NOT DISTINCT FROM v_uid)
        END), '[]'::jsonb) FROM public.jobs t
      WHERE t.customer_id = v_uid OR t.helper_id = v_uid OR t.recurring_helper_id = v_uid
        OR t.offered_to_helper_id = v_uid OR t.cancelled_by = v_uid OR t.disputed_by = v_uid
        OR t.id IN (SELECT g.job_id FROM public.group_job_helpers g WHERE g.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('applications', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) - 'flag_reason' - 'offer_message_withheld'
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'status', t.status,
          'offer_message', t.offer_message, 'offer_message_withheld', t.offer_message_withheld,
          'offer_message_flagged_hidden', t.offer_message_flagged_hidden, 'decline_reason', t.decline_reason, 'poster_viewed_at', t.poster_viewed_at,
          'closed_reason', t.closed_reason, 'created_at', t.created_at, 'updated_at', t.updated_at) END), '[]'::jsonb) FROM public.applications t
      WHERE t.helper_id = v_uid
        OR (t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid) AND NOT public.are_users_blocked(t.helper_id, v_uid))));
  v_out := v_out || jsonb_build_object('reviews', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.reviews t
      WHERE t.reviewer_id = v_uid
        OR (t.reviewee_id = v_uid AND t.status = 'published'
            AND t.feedback_visible_at IS NOT NULL AND t.feedback_visible_at <= now())));
  v_out := v_out || jsonb_build_object('messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'flag_reason'), '[]'::jsonb) FROM public.messages t
      WHERE t.sender_id = v_uid
        OR (t.receiver_id = v_uid AND NOT coalesce(t.flagged_hidden, false))));
  v_out := v_out || jsonb_build_object('message_reactions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.message_reactions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notifications', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_preferences', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_preferences t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_logs t
      WHERE t.user_id = v_uid OR (lower(t.recipient_email) = v_email AND t.user_id IS NULL AND t.created_at >= v_created)));
  v_out := v_out || jsonb_build_object('notification_dedupe_suppressions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_dedupe_suppressions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('push_tokens', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'token'), '[]'::jsonb) FROM public.push_tokens t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('push_subscriptions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'endpoint' - 'p256dh' - 'auth'), '[]'::jsonb) FROM public.push_subscriptions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_jobs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_jobs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_searches', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_searches t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_search_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_search_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('match_digest_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.match_digest_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('parish_match_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.parish_match_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_match_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_match_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('favorite_helpers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.favorite_helpers t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_availability', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_availability t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_credentials', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_credentials t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_verifications', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'changed_by'), '[]'::jsonb) FROM public.helper_verifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_checks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.verification_checks t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_w9_records', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_w9_records t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('instant_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.instant_payouts t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by' - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payout_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_cancellation_fee_shares', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'stripe_transfer_id' - 'status' - 'paid_at' - 'failure_reason' - 'failed_transfer_ids' END), '[]'::jsonb) FROM public.crew_cancellation_fee_shares t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  -- Q1390: a crew block fee is the member's money record. The member only:
  -- the ledger has no client read policy, and an export never gives a poster
  -- a row the app's own SELECT rules would not (Q739); the poster's side of
  -- it is the notification block_user_and_settle sends.
  v_out := v_out || jsonb_build_object('crew_block_fees', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.crew_block_fees t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('cancellation_fee_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.cancellation_fee_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payment_refunds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payment_refunds t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('chargeback_clawbacks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.chargeback_clawbacks t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tips', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tips t
      WHERE t.tipper_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tip_hold_redrives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tip_hold_redrives t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('gift_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'claim_token'), '[]'::jsonb) FROM public.gift_cards t
      WHERE t.donor_id = v_uid OR t.recipient_id = v_uid OR (lower(t.recipient_email) = v_email AND t.recipient_id IS NULL)));
  v_out := v_out || jsonb_build_object('referral_codes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_codes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referral_credits', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_credits t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referrals', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referrals t
      WHERE t.referrer_id = v_uid OR t.referred_id = v_uid));
  v_out := v_out || jsonb_build_object('reports', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.reports t
      WHERE t.reporter_id = v_uid));
  v_out := v_out || jsonb_build_object('user_blocks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_blocks t
      WHERE t.blocker_id = v_uid));
  v_out := v_out || jsonb_build_object('user_bans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'banned_by'), '[]'::jsonb) FROM public.user_bans t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_violations', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reported_by'), '[]'::jsonb) FROM public.user_violations t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_roles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_roles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('legal_acceptances', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.legal_acceptances t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('login_history', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.login_history t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_tracking t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_send_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_send_log t
      WHERE lower(t.recipient_email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('suppressed_emails', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.suppressed_emails t
      WHERE lower(t.email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('job_checkins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_checkins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_tracking t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('group_job_helpers', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t)
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'slot_no', t.slot_no, 'status', t.status,
          'share_cents', t.share_cents, 'poster_confirmed_arrival_at', t.poster_confirmed_arrival_at,
          'poster_confirmed_working_at', t.poster_confirmed_working_at,
          'poster_confirmed_completion_at', t.poster_confirmed_completion_at) END), '[]'::jsonb) FROM public.group_job_helpers t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_releases', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_releases t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_payments', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_payments t
      WHERE t.payer_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('job_revisions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_revisions t
      WHERE t.requested_by = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_completion_nudges', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_completion_nudges t
      WHERE t.resolved_by = v_uid));
  v_out := v_out || jsonb_build_object('disputes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.disputes t
      WHERE t.opener_id = v_uid
        OR t.agreed_poster_id = v_uid OR t.agreed_helper_id = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_views t
      WHERE t.viewer_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_views t
      WHERE t.viewer_user_id = v_uid));
  -- Q2752: the member's own Declutter item views (20261105163501), the same kind of row as profile_views.
  v_out := v_out || jsonb_build_object('declutter_item_views', (SELECT coalesce(jsonb_agg(jsonb_build_object('item_id', t.item_id, 'created_at', t.created_at) ORDER BY t.created_at), '[]'::jsonb) FROM public.declutter_item_views t
      WHERE t.viewer_id = v_uid));
  v_out := v_out || jsonb_build_object('pet_profiles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.pet_profiles t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('job_pets', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_pets t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_access_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_access_notes t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('str_calendar_connections', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.str_calendar_connections t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_archives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_archives t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_mutes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_mutes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_pins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_pins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('nps_responses', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.nps_responses t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('analytics_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.analytics_events t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'held_by' - 'denied_by'), '[]'::jsonb) FROM public.payout_holds t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('application_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.application_rate_log t
      WHERE t.applicant_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_search_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_search_rate_log t
      WHERE t.searcher_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_dispute_member_outcomes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.crew_dispute_member_outcomes t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_schedule_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_schedule_change_requests t
      WHERE t.requested_by = v_uid OR t.responder_id = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_requests t
      WHERE t.requested_by = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_answers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_answers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('series_date_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_date_offers t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('series_visit_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_visit_holds t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));

  -- Declutter (20261014200728, B9).
  v_out := v_out || jsonb_build_object('declutter_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_items t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_private', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'ai_flag_reason' - 'drop_stop_cents'), '[]'::jsonb) FROM public.declutter_item_private t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_item_photos t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_pickup_windows', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_pickup_windows t
      WHERE t.seller_id = v_uid));
  -- Remembered listing choices (20261030144112): the seller's own row.
  v_out := v_out || jsonb_build_object('declutter_seller_defaults', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_seller_defaults t
      WHERE t.member_id = v_uid));
  -- Porch days (20261029161347): the seller's own picked porch weekdays (one row per seller).
  v_out := v_out || jsonb_build_object('declutter_seller_porch_days', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_seller_porch_days t
      WHERE t.seller_id = v_uid));
  -- Meet spots (20261101194608): the seller's own saved public meeting places (seller_id = the member), without
  -- created_by (an admin's id on a public spot).
  v_out := v_out || jsonb_build_object('declutter_meetup_spots', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'created_by' ORDER BY t.created_at), '[]'::jsonb) FROM public.declutter_meetup_spots t
      WHERE t.seller_id = v_uid));
  -- Q2278 (lead ruling 2026-10-21): who asked is never shown to another member, the seller included. The asker's own
  -- questions keep asker_id; on the caller's items, others' questions come without it (the caller's answers stay theirs).
  v_out := v_out || jsonb_build_object('declutter_questions', (SELECT coalesce(jsonb_agg(
             CASE WHEN t.asker_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'asker_id' END), '[]'::jsonb) FROM public.declutter_questions t
      WHERE t.asker_id = v_uid OR t.item_id IN (SELECT i.id FROM public.declutter_items i WHERE i.seller_id = v_uid)));
  v_out := v_out || jsonb_build_object('declutter_watchlist', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_watchlist t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_tax_attestations', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_tax_attestations t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'removed_by' - 'appeal_decided_by'), '[]'::jsonb) FROM public.declutter_strikes t
      WHERE t.user_id = v_uid));
  -- Declutter slice 3 (20261014210518): offers (their current amount and
  -- status; the step history has no person column), orders and cart lines on
  -- either side of the trade; the saved card's brand + last 4 (the Stripe ids
  -- are ours, not the member's data, and are never shown to them, B31).
  -- Q2274: on the SELLER's side, an offer the buyer never took into a cart carries no buyer_id (an "I have this" answer to a
  -- Wanted post, or any offer the buyer made; declutter_my_offers returns no counterparty id either). The buyer's own
  -- rows are unchanged. Only the id is withheld: since the owner's 11-11 decision (F356) the seller IS shown the buyer's
  -- first name + last initial before a deal (offer card 20261111223500, notices 20261112003050); a Wanted reply stays unnamed.
  v_out := v_out || jsonb_build_object('declutter_offers', (SELECT coalesce(jsonb_agg(
             CASE WHEN t.seller_id = v_uid AND t.buyer_id IS DISTINCT FROM v_uid AND t.status <> 'accepted'
                  THEN to_jsonb(t) - 'buyer_id' ELSE to_jsonb(t) END), '[]'::jsonb) FROM public.declutter_offers t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_orders', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_checkout_session_id' - 'stripe_payment_intent_id'), '[]'::jsonb) FROM public.declutter_orders t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_cart_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_cart_items t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  -- The Free change (20261030064021): the member's asks for free items (as asker or giver) and their 30-day pause.
  v_out := v_out || jsonb_build_object('declutter_free_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_free_requests t
      WHERE t.requester_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_free_pauses', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_free_pauses t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_buyer_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_customer_id' - 'payment_method_id'), '[]'::jsonb) FROM public.declutter_buyer_cards t
      WHERE t.user_id = v_uid));

  -- Declutter slice 3b (20261014224914): a seller's card-fee debts (row 60).
  -- Refunds have no person column (they hang off an order, exported above);
  -- each section is scoped to the caller by its own column only.
  v_out := v_out || jsonb_build_object('declutter_seller_fee_debts', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'waived_by'), '[]'::jsonb) FROM public.declutter_seller_fee_debts t
      WHERE t.seller_id = v_uid));
  -- Shipping (Q2259 S5, 20261103202529): the buyer's own shipments: the address they gave, the service, the tracking
  -- number and scans. EasyPost handles, the per-order claim key, the worker's error text and retry clock, the label
  -- file path and what the label cost the platform are internal and stay out.
  v_out := v_out || jsonb_build_object('shipments', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'idempotency_key'
      - 'provider_rate_id' - 'provider_shipment_id' - 'last_error' - 'attempts' - 'next_attempt_at' - 'label_path'
      - 'label_cost_cents' ORDER BY t.created_at), '[]'::jsonb) FROM public.shipments t
      WHERE t.buyer_id = v_uid));

  -- Declutter slice 4 (20261015042253): bookings (either side), the problems
  -- the member reported (the deciding admin's id dropped), the seller's payouts
  -- (the Stripe transfer id is ours), and reviews: those the member wrote, and
  -- those about them once visible (row 45: both sides reviewed or 14 days),
  -- without the reviewer's id.
  v_out := v_out || jsonb_build_object('declutter_bookings', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_bookings t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_problems', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.declutter_problems t
      WHERE t.reporter_id = v_uid));
  -- Problems the OTHER side of the member's order reported about them (RLS
  -- already lets both sides read a problem). Without the reporter's private
  -- fields: who reported it (reporter_id), the reporter's photo paths, and
  -- which admin decided (decided_by, never exported).
  v_out := v_out || jsonb_build_object('declutter_problems_about_me', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by' - 'reporter_id' - 'photo_paths'), '[]'::jsonb) FROM public.declutter_problems t
      WHERE t.reporter_id IS DISTINCT FROM v_uid
        AND EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id
                     AND (o.buyer_id = v_uid OR o.seller_id = v_uid))));
  v_out := v_out || jsonb_build_object('declutter_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_transfer_id' - 'last_error'), '[]'::jsonb) FROM public.declutter_payouts t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_reviews', (SELECT coalesce(jsonb_agg(CASE WHEN t.reviewer_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'reviewer_id' END), '[]'::jsonb) FROM public.declutter_reviews t
      WHERE t.reviewer_id = v_uid
         OR (t.reviewee_id = v_uid AND EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id
               AND (o.handed_over_at <= now() - interval '14 days'
                    OR (SELECT count(*) FROM public.declutter_reviews r2 WHERE r2.order_id = t.order_id) = 2)))));

  -- "Suggest a category" (20261015051141, I1): the caller's own suggestions.
  -- reviewed_by (the staff reviewer) and admin_note (staff-only) are stripped.
  v_out := v_out || jsonb_build_object('category_suggestions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reviewed_by' - 'admin_note'), '[]'::jsonb) FROM public.category_suggestions t
      WHERE t.user_id = v_uid));

  -- Declutter wanted posts (20261016053541). The match ledger holds no person
  -- column; a seller's alerts are in 'notifications' above.
  v_out := v_out || jsonb_build_object('declutter_wanted', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_wanted t
      WHERE t.user_id = v_uid));

  -- Slice 5, Helpr delivery (20261017055505): the Helpr's vehicle, the
  -- deliveries the member made as the Helpr (area words only: the buyer's and
  -- the seller's exact addresses, points and ids, the drop-off code and the
  -- staff close note belong to them or to us, not the Helpr),
  -- the steps they took on any delivery, their delivery pay (the Stripe transfer
  -- id is ours), and the drop-off addresses they typed as a buyer.
  v_out := v_out || jsonb_build_object('helpr_vehicles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helpr_vehicles t
      WHERE t.user_id = v_uid));
  -- B52 (20261101025001): also the deliveries the member was released from (helpr_tasks.released_helpr_id, 20261101020052),
  -- each row once. A row the member is on: as before, without the released Helpr's id when it names someone else. A row
  -- the member was only RELEASED from (lead 10-31): only what is about their part (which delivery and item), never its
  -- status, times or anything set after they left, which is the next Helpr's progress. Their own steps, pay and
  -- strikes on it are in helpr_task_events (actor_id), helpr_task_payouts and their strikes.
  v_out := v_out || jsonb_build_object('helpr_tasks', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.helpr_id = v_uid
          THEN to_jsonb(t) - 'dropoff_code' - 'pickup_address' - 'pickup_lat' - 'pickup_lng'
             - 'dropoff_address' - 'dropoff_lat' - 'dropoff_lng' - 'customer_id' - 'pickup_contact_id' - 'close_note'
             - CASE WHEN t.released_helpr_id IS DISTINCT FROM v_uid THEN 'released_helpr_id' ELSE '' END
          ELSE jsonb_build_object('id', t.id, 'source_kind', t.source_kind, 'source_id', t.source_id, 'title', t.title,
                 'created_at', t.created_at, 'released_helpr_id', t.released_helpr_id, 'released_from_you', true)
        END), '[]'::jsonb) FROM public.helpr_tasks t
      WHERE t.helpr_id = v_uid OR t.released_helpr_id = v_uid));
  v_out := v_out || jsonb_build_object('helpr_task_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helpr_task_events t
      WHERE t.actor_id = v_uid));
  v_out := v_out || jsonb_build_object('helpr_task_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_transfer_id' - 'last_error'), '[]'::jsonb) FROM public.helpr_task_payouts t
      WHERE t.helpr_id = v_uid));
  -- Q2453 (20261028014848): tips on deliveries, the member's as the buyer who tipped or the Helpr tipped (both
  -- see the tip in the app, as job tips).
  v_out := v_out || jsonb_build_object('helpr_task_tips', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helpr_task_tips t
      WHERE t.tipper_id = v_uid OR t.helpr_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_delivery_dropoffs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_delivery_dropoffs t
      WHERE t.buyer_id = v_uid));
  -- Declutter seller delivery (20261027153244): the seller's setting, delivery windows, days off and the items
  -- they switched delivery off for; each delivery the member is a side of. The drop-off address and point are
  -- the BUYER's, so they leave a seller's copy (as declutter_delivery_dropoffs is never the seller's), and a
  -- seller's copy of a checkout that was never paid ('held' / 'released') carries only its order, status and
  -- time, nothing of the buyer's (lh-authz-rls review #1).
  v_out := v_out || jsonb_build_object('declutter_seller_delivery', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_seller_delivery t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_delivery_windows', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_delivery_windows t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_delivery_days_off', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_delivery_days_off t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_no_seller_delivery', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_item_no_seller_delivery t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_seller_deliveries', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.buyer_id = v_uid THEN to_jsonb(t)
             WHEN t.status IN ('held', 'released') THEN jsonb_build_object('order_id', t.order_id, 'status', t.status, 'created_at', t.created_at)
             ELSE to_jsonb(t) - 'dropoff_address' - 'dropoff_lat' - 'dropoff_lng' END), '[]'::jsonb) FROM public.declutter_seller_deliveries t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  -- Q2450 Helpr Guarantee (20261027200455): each request on a job the member posted or worked. Both sides see the
  -- whole request in the app (the note, photos, dates and answers), so both get it whole.
  v_out := v_out || jsonb_build_object('job_guarantee_claims', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_guarantee_claims t
      WHERE t.poster_id = v_uid OR t.helper_id = v_uid));
  -- Q2425 / Q2451 safe meetup spots (20261027204500): the buyer's own pick of a spot per seller (the seller never
  -- sees a pick before checkout, so a seller's export carries none), and the meeting spot of every order the member
  -- is a side of (a snapshot of the public place, never a home address; both sides see it on the order).
  v_out := v_out || jsonb_build_object('declutter_meetup_choices', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_meetup_choices t
      WHERE t.buyer_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_order_meetups', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_order_meetups t
      WHERE EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id AND v_uid IN (o.buyer_id, o.seller_id))));
  -- Q2427 bundle discounts (20261027211754): the seller's own "Buy 2+, get N% off" setting.
  v_out := v_out || jsonb_build_object('declutter_bundle_rules', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_bundle_rules t
      WHERE t.seller_id = v_uid));

  -- Shops slice 1 (20261017061155) and slice 2 (20261017061157): the
  -- member's own shop (who checked its registration and who hid it are staff
  -- ids, dropped; the hide reason is about them and stays), photo paths, the shops they follow, their items and item photos, the item
  -- review state (the AI and word-check reasons are staff-only, dropped; the
  -- admin's note stays), the confirmations they ticked, and the home-food
  -- yearly confirmations and counted sales. Opening hours (shop_hours) carry
  -- no person column and are public on the shop page, so they stay out, as
  -- every table without one does.
  v_out := v_out || jsonb_build_object('shops', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'sos_verified_by' - 'hidden_by'), '[]'::jsonb) FROM public.shops t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_photos t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_follows', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_follows t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_items t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_item_private', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'ai_flag_reason' - 'text_flag_reason'), '[]'::jsonb) FROM public.shop_item_private t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_item_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_item_photos t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_item_attestations', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_item_attestations t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_cottage_confirmations', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_cottage_confirmations t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_cottage_sales', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_cottage_sales t
      WHERE t.owner_id = v_uid));

  -- Rentals S1 (20261017205605): the caller's properties, units, tenancies
  -- (as landlord or tenant), maintenance requests and their photos.
  v_out := v_out || jsonb_build_object('rental_properties', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'ownership_reviewed_by'), '[]'::jsonb) FROM public.rental_properties t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('rental_units', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.rental_units t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('rental_tenancies', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'invite_token_sha256'), '[]'::jsonb) FROM public.rental_tenancies t
      WHERE t.landlord_id = v_uid OR t.tenant_id = v_uid));
  v_out := v_out || jsonb_build_object('maintenance_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.maintenance_requests t
      WHERE t.tenant_id = v_uid OR t.landlord_id = v_uid));
  v_out := v_out || jsonb_build_object('maintenance_request_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.maintenance_request_photos t
      WHERE t.tenant_id = v_uid));

  -- Shops M1 (20261018164442): the member's orders as buyer or as the shop
  -- (both sides were shown the whole order: lines, date, note, money), and
  -- the lines of those orders. The Stripe ids and the capture / hold-release
  -- error text are internal, dropped.
  v_out := v_out || jsonb_build_object('shop_orders', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_checkout_session_id' - 'stripe_payment_intent_id' - 'capture_last_error' - 'hold_release_last_error'), '[]'::jsonb) FROM public.shop_orders t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_order_lines', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_order_lines t
      WHERE t.order_id IN (SELECT o.id FROM public.shop_orders o WHERE o.buyer_id = v_uid OR o.seller_id = v_uid)));
  -- The member's Shops strikes (20261018164444; the staff member who removed
  -- one is dropped, as for declutter_strikes). That migration sorts AFTER this
  -- one, so the section is skipped until the table exists: Download My Data
  -- never fails with 42P01 in between (both reviews of the strikes change).
  IF to_regclass('public.shop_strikes') IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('shop_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'removed_by'), '[]'::jsonb) FROM public.shop_strikes t
      WHERE t.user_id = v_uid));
  END IF;
  -- Shops M1b part 2 (20261018210400): the member's own shop's private pickup
  -- address. The Stripe Tax location id and its mode are internal, dropped.
  -- Only the owner's own row: a buyer was shown the address on an accepted
  -- order, but it is the shop owner's personal data, not the buyer's.
  v_out := v_out || jsonb_build_object('shop_pickup_addresses', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_tax_location_id' - 'stripe_tax_location_mode'), '[]'::jsonb) FROM public.shop_pickup_addresses t
      WHERE t.owner_id = v_uid));
  -- Homes -> Rent listings (20261019043000): the member's own listings (every
  -- field they typed, incl. the wording-check result) and their photos.
  v_out := v_out || jsonb_build_object('rental_listings', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.rental_listings t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('rental_listing_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.rental_listing_photos t
      WHERE t.owner_id = v_uid));
  -- Q2082 (b): the Helpr's own Helpr-fault rulings (20261019015301), without
  -- the staff member who ruled (admin_id) or the poster's Stripe refund id
  -- (refund_ref, the other party's payment). The ruling's note IS theirs
  -- (why they were ruled at fault), so it is exported. The table exists from that
  -- migration on, which always runs first.
  v_out := v_out || jsonb_build_object('helpr_fault_rulings', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'admin_id' - 'refund_ref'), '[]'::jsonb) FROM public.job_helpr_fault_rulings t
    WHERE t.helper_id = v_uid));
  -- Landlord ID (20261019051407): the member's own ID review (status, dates,
  -- the admin's note). Which admin reviewed it (reviewed_by) is staff-only and
  -- dropped. The photo paths stay in the row: the export function signs every
  -- object still in the member's user-documents folder, so a photo not yet
  -- past retention comes as a signed link, never as bytes in this JSON.
  v_out := v_out || jsonb_build_object('landlord_id_reviews', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reviewed_by'), '[]'::jsonb) FROM public.landlord_id_reviews t
    WHERE t.user_id = v_uid));
  -- Homes rent tracker (20261019073106) and deposit tracker (20261019082216): the rent schedule, charges,
  -- payments and deposit of every tenancy the member is a side of (landlord or tenant). These tables are keyed
  -- by tenancy, not by a person. The landlord gets the tenant's forwarding address only once the tenancy has
  -- ended AND the tenant ended it or the lease end date passed (the same rule as rentals_deposit).
  v_out := v_out || jsonb_build_object('rental_rent_plans', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.rental_rent_plans t
    WHERE t.tenancy_id IN (SELECT tn.id FROM public.rental_tenancies tn WHERE tn.landlord_id = v_uid OR tn.tenant_id = v_uid)));
  v_out := v_out || jsonb_build_object('rental_rent_charges', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.rental_rent_charges t
    WHERE t.tenancy_id IN (SELECT tn.id FROM public.rental_tenancies tn WHERE tn.landlord_id = v_uid OR tn.tenant_id = v_uid)));
  v_out := v_out || jsonb_build_object('rental_rent_payments', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.rental_rent_payments t
    WHERE t.tenancy_id IN (SELECT tn.id FROM public.rental_tenancies tn WHERE tn.landlord_id = v_uid OR tn.tenant_id = v_uid)));
  v_out := v_out || jsonb_build_object('rental_deposits', (SELECT coalesce(jsonb_agg(
      CASE WHEN x.tenant_id = v_uid
                OR (x.status = 'ended' AND (x.ended_by = 'tenant' OR (x.lease_ends_on IS NOT NULL AND x.lease_ends_on <= public.shop_local_today())))
           THEN to_jsonb(t) ELSE to_jsonb(t) - 'forwarding_address' END), '[]'::jsonb)
      FROM public.rental_deposits t JOIN public.rental_tenancies x ON x.id = t.tenancy_id
    WHERE t.tenancy_id IN (SELECT tn.id FROM public.rental_tenancies tn WHERE tn.landlord_id = v_uid OR tn.tenant_id = v_uid)));
  -- Homes lease (20261019110137): every lease the member is a party to (landlord_id / tenant_id are kept on
  -- the lease, so a signed one is exported after its tenancy or the other account is gone). A draft's blanks
  -- go to the landlord only; the tenant gets the draft's status and their own change note.
  v_out := v_out || jsonb_build_object('rental_leases', (SELECT coalesce(jsonb_agg(
      CASE WHEN t.landlord_id = v_uid OR t.status <> 'draft' THEN to_jsonb(t)
           ELSE jsonb_build_object('tenancy_id', t.tenancy_id, 'status', t.status, 'change_request', t.change_request) END), '[]'::jsonb)
      FROM public.rental_leases t
    WHERE t.landlord_id = v_uid OR t.tenant_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_homes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_homes t
      WHERE t.user_id = v_uid));
  -- Board 143a (20261021030052): the member's own bank payout failures (user_id = the member).
  v_out := v_out || jsonb_build_object('payout_failures', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.payout_failures t
      WHERE t.user_id = v_uid));
  -- Board 141 (20261021102943): every refund request the member asked, was asked, or answered.
  v_out := v_out || jsonb_build_object('refund_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.refund_requests t
      WHERE t.requester_id = v_uid OR t.responder_id = v_uid OR t.answered_by = v_uid));
  -- SMS alerts (20261021193738): the member's text consent (number, opt-in and
  -- opt-out times and sources), every consent event, and every text considered
  -- for them (kind, status, reason, times; no phone or body is stored there).
  -- confirm_* and updated_at are left out for the same reason: they move
  -- only when a confirmation was really sent, which a number in use
  -- elsewhere never is (and confirm_code is a live secret).
  v_out := v_out || jsonb_build_object('sms_consent', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'confirm_code' - 'confirm_phone' - 'confirm_sent_at' - 'updated_at'), '[]'::jsonb) FROM public.sms_consent t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('sms_consent_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.sms_consent_events t
      WHERE t.user_id = v_uid));
  -- A confirmation row keeps only that one was considered: its status and
  -- reason would say whether the number is used on another account
  -- (lh-authz-rls review of the SMS slice).
  v_out := v_out || jsonb_build_object('sms_messages', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.kind = 'confirm' THEN jsonb_build_object('id', t.id, 'kind', t.kind, 'category', t.category, 'created_at', t.created_at)
             ELSE to_jsonb(t) END), '[]'::jsonb) FROM public.sms_messages t
      WHERE t.user_id = v_uid));
  -- Board 141, Declutter side (20261026155251): refund requests on the member's own sales, buyer or seller.
  v_out := v_out || jsonb_build_object('declutter_refund_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_refund_requests t
      WHERE EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id AND v_uid IN (o.buyer_id, o.seller_id))));
  -- Q2462 (20261028235249): the member's handover talks, buyer or seller, and every message in them (both people
  -- wrote to each other in the app; each sees the whole talk there).
  v_out := v_out || jsonb_build_object('declutter_handover_talks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_handover_talks t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_handover_talk_messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.declutter_handover_talk_messages t
      WHERE t.sender_id = v_uid OR t.talk_id IN (SELECT h.id FROM public.declutter_handover_talks h WHERE h.buyer_id = v_uid OR h.seller_id = v_uid)));
  -- D2-1 (20261030004216): the member's paid-order chats, buyer or seller of the order, and every message in them
  -- (each side sees the whole chat in the app), plus any message the member sent.
  v_out := v_out || jsonb_build_object('declutter_order_talks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_order_talks t
      WHERE EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id AND v_uid IN (o.buyer_id, o.seller_id))));
  v_out := v_out || jsonb_build_object('declutter_order_talk_messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.declutter_order_talk_messages t
      WHERE t.sender_id = v_uid OR t.talk_id IN (SELECT ot.id FROM public.declutter_order_talks ot JOIN public.declutter_orders o ON o.id = ot.order_id
                                                  WHERE v_uid IN (o.buyer_id, o.seller_id))));
  -- BUY-36 (the delivery chat): what the member wrote in a delivery's chat. (B36: this line sat inside the statement above.)
  v_out := v_out || jsonb_build_object('helpr_task_talk_messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.helpr_task_talk_messages t WHERE t.sender_id = v_uid));
  -- Q1866 (20261015091114, the 'quotes' switch): the member's quote requests as the poster, their own quotes as the
  -- quoter, the quotes on their requests WITHOUT the quoter's id or photos (another member's details), and every
  -- counter-offer on a quote the member is a side of.
  v_out := v_out || jsonb_build_object('job_quote_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_quote_requests t
      WHERE t.poster_id = v_uid));
  v_out := v_out || jsonb_build_object('job_quotes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_quotes t
      WHERE t.quoter_id = v_uid));
  v_out := v_out || jsonb_build_object('job_quotes_on_my_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'quoter_id' - 'photo_paths'), '[]'::jsonb) FROM public.job_quotes t
      WHERE t.quoter_id IS DISTINCT FROM v_uid AND t.request_id IN (SELECT r.id FROM public.job_quote_requests r WHERE r.poster_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_quote_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.job_quote_offers t
      WHERE t.quote_id IN (SELECT q.id FROM public.job_quotes q JOIN public.job_quote_requests r ON r.id = q.request_id WHERE q.quoter_id = v_uid OR r.poster_id = v_uid)));
  -- D-NEW14 (20261030164712): the seller's own pickup places with their addresses; the buyer's own pick; the place
  -- frozen on each order the member is a side of, its address and point to the seller only.
  v_out := v_out || jsonb_build_object('declutter_porch_places', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_porch_places t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_porch_place_choices', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_porch_place_choices t
      WHERE t.buyer_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_order_porch_places', (SELECT coalesce(jsonb_agg(
             CASE WHEN t.seller_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'address' - 'lat' - 'lng' - 'seller_id' - 'label' END), '[]'::jsonb) FROM public.declutter_order_porch_places t
      WHERE EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id AND v_uid IN (o.buyer_id, o.seller_id))));
  -- The half-finished job post on this account (OPS-3): the member's own words.
  v_out := v_out || jsonb_build_object('job_post_drafts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_post_drafts t
             WHERE t.user_id = v_uid));
  -- Where this account came from (OPS-5, 20261031220447): the two cleaned words of the link that brought the member,
  -- kept once at sign-up. The member's own row only (LEAD-EXPORT-SIGNUP-SOURCE).
  v_out := v_out || jsonb_build_object('member_signup_sources', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'source', t.source, 'campaign', t.campaign, 'recorded_at', t.recorded_at)), '[]'::jsonb) FROM public.member_signup_sources t
             WHERE t.user_id = v_uid));

  -- LEAD-PROFILE-LINK (20261101034834): the profile links this member used before, kept so old links still find them.
  v_out := v_out || jsonb_build_object('profile_handles_retired', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'handle', t.handle, 'retired_at', t.retired_at)), '[]'::jsonb) FROM public.profile_handles_retired t
             WHERE t.user_id = v_uid));

  -- Owner 11-05 share-profile H4 (20261105172514): the job after photos this member picked for their public page.
  -- Their own picks only (user_id = the member); the pick id, the job, the photo and when it was picked.
  v_out := v_out || jsonb_build_object('profile_job_photos', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', t.id, 'job_id', t.job_id, 'photo_path', t.photo_path, 'created_at', t.created_at)
             ORDER BY t.created_at, t.id), '[]'::jsonb) FROM public.profile_job_photos t
             WHERE t.user_id = v_uid));

  -- CMP-4 instant book (20261101063725, 20261101065105): the member's own auto-accept floors, and the jobs they said
  -- they can't make. Their own rows only (helper_id = the member).
  v_out := v_out || jsonb_build_object('instant_book_floors', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'category', t.category, 'floor_cents', t.floor_cents, 'created_at', t.created_at, 'updated_at', t.updated_at)
             ORDER BY t.category::text), '[]'::jsonb) FROM public.instant_book_floors t
             WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('instant_book_declines', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'job_id', t.job_id, 'reason', t.reason, 'declined_at', t.declined_at) ORDER BY t.declined_at), '[]'::jsonb)
             FROM public.instant_book_declines t
             WHERE t.helper_id = v_uid));

  -- Continue another day (20261101231015, LEAD-EXPORT-CONTINUE-DAY): the new days set or asked on the member's own
  -- jobs (as poster or Helpr) or by the member, and the record of each step.
  v_out := v_out || jsonb_build_object('job_continue_days', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.job_continue_days t
      WHERE t.proposed_by = v_uid OR t.decided_by = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_continue_events', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.job_continue_events t
      WHERE t.actor_id = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));

  -- Q2271: the handover row of each Declutter order the member is a side of (buyer or seller): times, the porch and
  -- pickup photo paths and the seller's "Where exactly?" note, which both sides already see on the order. The 4-digit
  -- handover code is left out (a one-time secret the seller must never read; the buyer sees it in the app while paid).
  v_out := v_out || jsonb_build_object('declutter_handovers', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'code' ORDER BY t.created_at), '[]'::jsonb) FROM public.declutter_handovers t
      WHERE EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id AND v_uid IN (o.buyer_id, o.seller_id))));
  -- Q2454: the seller's haul-away links and donation history, through their own items (both tables are keyed by item).
  v_out := v_out || jsonb_build_object('declutter_haul_aways', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.declutter_haul_aways t
      WHERE EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = t.item_id AND i.seller_id = v_uid)));
  v_out := v_out || jsonb_build_object('declutter_donations', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.chosen_at), '[]'::jsonb) FROM public.declutter_donations t
      WHERE EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = t.item_id AND i.seller_id = v_uid)));
  -- Q2245 (20261102072106): the Helpr's own card-fee debts from a lapsed series visit, without the refund's Stripe id.
  v_out := v_out || jsonb_build_object('helpr_card_fee_debts', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'refund_ref' ORDER BY t.created_at), '[]'::jsonb) FROM public.helpr_card_fee_debts t
      WHERE t.helper_id = v_uid));
  -- Q2199 (20261102074244): the member's own Customize choice (section order and hidden sections).
  v_out := v_out || jsonb_build_object('member_section_prefs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.member_section_prefs t
      WHERE t.user_id = v_uid));
  -- Declutter manager mode (20261101181005, 20261101230509): the member's own manager arrangements, as the seller
  -- or as the manager. grants, submissions and order shares: both sides read every column today (table-wide GRANT
  -- SELECT, RLS seller_id = auth.uid() OR manager_id = auth.uid()). actions and messages are service_role only today,
  -- but carry no private column (actions: the grant, the pair, what the manager did and on which item; messages: the
  -- pair and the ids of messages the member already gets in their own sections). No section carries an admin note,
  -- a moderation or review field, a Stripe id or error text. ended_by is always one of the two (the only writer,
  -- declutter_manager_end, stamps the caller, who must be a side). The manager payout carries only the columns a
  -- member may read (its GRANT SELECT list): no Stripe transfer id, error, review reason or internal ids.
  v_out := v_out || jsonb_build_object('declutter_manager_grants', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.declutter_manager_grants t
      WHERE t.seller_id = v_uid OR t.manager_id = v_uid OR t.ended_by = v_uid));
  v_out := v_out || jsonb_build_object('declutter_manager_actions', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.declutter_manager_actions t
      WHERE t.seller_id = v_uid OR t.manager_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_manager_messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.declutter_manager_messages t
      WHERE t.seller_id = v_uid OR t.manager_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_manager_submissions', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.submitted_at), '[]'::jsonb) FROM public.declutter_manager_submissions t
      WHERE t.seller_id = v_uid OR t.manager_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_order_manager_shares', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.locked_at), '[]'::jsonb) FROM public.declutter_order_manager_shares t
      WHERE t.seller_id = v_uid OR t.manager_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_manager_payouts', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'order_id', t.order_id, 'seller_id', t.seller_id, 'manager_id', t.manager_id, 'share_cents', t.share_cents,
        'amount_cents', t.amount_cents, 'status', t.status, 'created_at', t.created_at, 'executed_at', t.executed_at) ORDER BY t.created_at), '[]'::jsonb) FROM public.declutter_manager_payouts t
      WHERE t.seller_id = v_uid OR t.manager_id = v_uid));

  -- Bundle requests (Q2268, 20261104103528, exported by 20261104123305): the member's own bundle asks, as the buyer
  -- or the seller (both sides read every column today: GRANT SELECT, RLS buyer_id = auth.uid() OR seller_id =
  -- auth.uid()), and the items on each (no person column; keyed by the request): the asked price, the seller's
  -- answer per item and the cart line it made. No admin note, Stripe id or error text is on either table.
  v_out := v_out || jsonb_build_object('declutter_bundle_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.declutter_bundle_requests t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_bundle_request_items', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.request_id, t.item_id), '[]'::jsonb) FROM public.declutter_bundle_request_items t
      WHERE EXISTS (SELECT 1 FROM public.declutter_bundle_requests r WHERE r.id = t.request_id AND v_uid IN (r.buyer_id, r.seller_id))));
  -- Declutter trades (20261106163703): every trade offer the member is a side of, as the buyer or the seller.
  v_out := v_out || jsonb_build_object('declutter_swap_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.declutter_swap_offers t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  -- Homes messages (20261106182837): every Homes thread the member is a side of (the member who wrote in, or the
  -- listing's owner) and every message in it (each side reads the whole thread in the app). Fair housing (42 U.S.C.
  -- 3604(c); La. R.S. 51:2606): the app shows each side only the other's first name and no id, so the export does the
  -- same: a thread drops the other side's id and read/notice marks, and a message carries its side and 'mine', never
  -- a sender id.
  v_out := v_out || jsonb_build_object('home_talks', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.member_id = v_uid
             THEN to_jsonb(t) - 'owner_notified_at' - 'owner_read_at'
             ELSE to_jsonb(t) - 'member_id' - 'member_notified_at' - 'member_read_at' END
        ORDER BY t.created_at, t.id), '[]'::jsonb)
      FROM public.home_talks t
      WHERE t.member_id = v_uid OR t.listing_id IN (SELECT l.id FROM public.rental_listings l WHERE l.owner_id = v_uid)));
  v_out := v_out || jsonb_build_object('home_talk_messages', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'talk_id', t.talk_id, 'sender_side', t.sender_side, 'mine', t.sender_id IS NOT DISTINCT FROM v_uid,
        'body', t.body, 'created_at', t.created_at) ORDER BY t.created_at, t.id), '[]'::jsonb)
      FROM public.home_talk_messages t
      WHERE t.sender_id = v_uid
         OR t.talk_id IN (SELECT ht.id FROM public.home_talks ht JOIN public.rental_listings l ON l.id = ht.listing_id
                           WHERE ht.member_id = v_uid OR l.owner_id = v_uid)));
  -- Shops messages (20261105185006): every shop chat the member is a side of (the member who wrote to a shop, or the
  -- shop's owner) and every message in it (each side reads the whole chat in the app). As the app shows it, each side
  -- sees the other only by name, never an id: a chat drops the other side's id and read/notice marks, and a message
  -- carries its side and 'mine', never a sender id.
  v_out := v_out || jsonb_build_object('shop_talks', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.buyer_id = v_uid
             THEN to_jsonb(t) - 'shop_notified_at' - 'shop_read_at'
             ELSE to_jsonb(t) - 'buyer_id' - 'buyer_notified_at' - 'buyer_read_at' END
        ORDER BY t.created_at, t.id), '[]'::jsonb)
      FROM public.shop_talks t
      WHERE t.buyer_id = v_uid OR t.shop_id IN (SELECT s.id FROM public.shops s WHERE s.owner_id = v_uid)));
  v_out := v_out || jsonb_build_object('shop_talk_messages', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'talk_id', t.talk_id, 'sender_side', t.sender_side, 'mine', t.sender_id IS NOT DISTINCT FROM v_uid,
        'body', t.body, 'created_at', t.created_at) ORDER BY t.created_at, t.id), '[]'::jsonb)
      FROM public.shop_talk_messages t
      WHERE t.sender_id = v_uid
         OR t.talk_id IN (SELECT st.id FROM public.shop_talks st JOIN public.shops s ON s.id = st.shop_id
                           WHERE st.buyer_id = v_uid OR s.owner_id = v_uid)));
  -- Shops paperwork (Q1952, 20261110195956): the food permits / inflatable registrations the member's shop sent for
  -- the Permit on file badge, with the check's outcome and (on a turn-down only) its note, as the owner reads them
  -- in My shop (shops_my_permits). Never the admin who checked it (reviewed_by) or the shop and row ids. Skipped while the table
  -- does not exist yet (a tree without 20261110195956), as shop_strikes is, so the export never fails with 42P01.
  IF to_regclass('public.shop_permits') IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('shop_permits', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'kind', t.kind, 'expires_on', t.expires_on, 'status', t.status,
          'review_note', CASE WHEN t.status = 'rejected' THEN t.review_note END,
          'reviewed_at', t.reviewed_at, 'created_at', t.created_at, 'document_path', t.document_path)
          ORDER BY t.created_at, t.kind), '[]'::jsonb)
        FROM public.shop_permits t
        WHERE t.owner_id = v_uid));
  END IF;

  -- S014 (Shops audit 11-12): the Shops rows that were EXEMPT as "testers only, added later", before Shops opens.
  -- Shop reviews: every review the member wrote; reviews about them only once public to them (both sides wrote, or
  -- 14 days after the handover: the blind rule shop_review_public and declutter_reviews use), without the writer's id.
  v_out := v_out || jsonb_build_object('shop_reviews', (SELECT coalesce(jsonb_agg(CASE WHEN t.reviewer_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'reviewer_id' END
          ORDER BY t.created_at, t.id), '[]'::jsonb) FROM public.shop_reviews t
      WHERE t.reviewer_id = v_uid
         OR (t.reviewee_id = v_uid AND EXISTS (SELECT 1 FROM public.shop_orders o WHERE o.id = t.order_id
               AND (o.handed_over_at <= now() - interval '14 days'
                    OR (SELECT count(*) FROM public.shop_reviews r2 WHERE r2.order_id = t.order_id) = 2)))));
  -- Custom order requests: the member's own (as the buyer), and those sent to the member's shop without the buyer's id.
  v_out := v_out || jsonb_build_object('shop_custom_requests', (SELECT coalesce(jsonb_agg(CASE WHEN t.buyer_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'buyer_id' END
          ORDER BY t.created_at, t.id), '[]'::jsonb) FROM public.shop_custom_requests t
      WHERE t.shop_id IN (SELECT s.id FROM public.shops s WHERE s.owner_id = v_uid) OR t.buyer_id = v_uid));
  -- The buyer's own drop-off and service addresses (never the shop's copy: the shop only ever read them while accepted).
  v_out := v_out || jsonb_build_object('shop_order_delivery_addresses', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.order_id), '[]'::jsonb)
      FROM public.shop_order_delivery_addresses t WHERE t.buyer_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_order_service_addresses', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.order_id), '[]'::jsonb)
      FROM public.shop_order_service_addresses t WHERE t.buyer_id = v_uid));
  -- The seller's download files (name, type, size, path to their own file).
  v_out := v_out || jsonb_build_object('shop_item_files', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.id), '[]'::jsonb)
      FROM public.shop_item_files t WHERE t.owner_id = v_uid));
  -- Handover steps of the member's orders (ready, handed over, confirmed, problem time), without the problem note; the
  -- buyer who wrote a problem note gets it in its own section.
  v_out := v_out || jsonb_build_object('shop_handovers', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'problem_note' ORDER BY t.order_id), '[]'::jsonb)
      FROM public.shop_handovers t
      WHERE EXISTS (SELECT 1 FROM public.shop_orders o WHERE o.id = t.order_id AND v_uid IN (o.buyer_id, o.seller_id))));
  v_out := v_out || jsonb_build_object('shop_handover_problem_notes', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'order_id', t.order_id, 'problem_at', t.problem_at, 'problem_note', t.problem_note) ORDER BY t.order_id), '[]'::jsonb)
      FROM public.shop_handovers t
      WHERE t.problem_note IS NOT NULL AND EXISTS (SELECT 1 FROM public.shop_orders o WHERE o.id = t.order_id AND o.buyer_id = v_uid)));

  -- Gift guides wish list (20261120062130): the member's own synced list (its share code, name and gift refs).
  v_out := v_out || jsonb_build_object('gift_wish_lists', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'code', t.code, 'name', t.name, 'items', t.items, 'created_at', t.created_at, 'updated_at', t.updated_at) ORDER BY t.created_at), '[]'::jsonb)
      FROM public.gift_wish_lists t WHERE t.user_id = v_uid));

  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.export_my_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_data(uuid) TO service_role;
