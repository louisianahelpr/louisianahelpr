#!/usr/bin/env node
/**
 * PGlite proof for 20260923121354_seed_subject_never_notifies_real (docs/OPEN.md Q137).
 *
 *   node src/test/pglite/seedNeverNotifiesReal.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/seedNeverNotifiesReal.pglite.mjs   # RED: live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the LIVE prod chain (pg_get_functiondef / pg_get_triggerdef,
 * read 2026-09-23 ~12:10Z, comments dropped, logic verbatim):
 *   jobs AFTER INSERT/UPDATE (the four live WHEN clauses)
 *     -> notify_helpers_on_job_post / notify_saved_searches_on_new_job
 *        -> INSERT notifications  -> BEFORE: suppress_exact_duplicate_notification,
 *                                            trg_notifications_fill_job_id
 *                                    AFTER:  fan_out_push_on_notification -> net.http_post(send-push-notification)
 *        -> net.http_post(send-notification-email)   (the email producer)
 *        -> match_digest_queue (digest-mode recipients)
 *   messages AFTER INSERT -> notify_message_recipient -> notifications
 *   sweep_daily_job_digest (cron) -> notifications
 * Stubs, not live: net.http_post records its calls; vault.decrypted_secrets is
 * a two-row table; get_user_credential_tier returns 0 (every fixture job is
 * credential_tier 0, so the live gate is a no-op here); log_cron_defect is a
 * no-op. seed_jobs_hidden_publicly() is the live body over a platform_settings
 * row that says FALSE, as prod does today.
 *
 * The email channel is proven at its input: the edge function
 * send-notification-email asks notification_crosses_seed_boundary() with the
 * body each SQL producer POSTs (user_id, link); this asserts that answer for
 * every recorded email POST.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const NEW = mig("20260923121354_seed_subject_never_notifies_real.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `11111111-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const SEED_HELPER = U(1);
const REAL_HELPER = U(2);
const SEED_POSTER = U(3);
const REAL_POSTER = U(4);
const SEED_DIGEST = U(5); // seed helper in digest mode
const REAL_DIGEST = U(6); // real helper in digest mode
const NO_PROFILE = U(7); // an account with no profiles row counts as REAL

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA net;
CREATE TABLE net.calls (id bigserial PRIMARY KEY, url text, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}'::jsonb, body jsonb DEFAULT '{}'::jsonb) RETURNS bigint
  LANGUAGE sql AS $$ INSERT INTO net.calls (url, body) VALUES (url, body) RETURNING id $$;
CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url', 'https://x.supabase.co'), ('service_role_key', 'k');

CREATE TYPE public.job_status AS ENUM ('open', 'in_progress', 'completed', 'cancelled');
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, parish text, approval_status text DEFAULT 'approved',
  ban_status text DEFAULT 'active', is_seed boolean DEFAULT false, latitude numeric, longitude numeric, email text);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, helper_id uuid,
  status public.job_status DEFAULT 'open', payment_status text, parish text, category text DEFAULT 'cleaning',
  title text, description text, budget numeric DEFAULT 100, is_seed boolean DEFAULT false,
  offered_to_helper_id uuid, direct_offer_status text, credential_tier integer DEFAULT 0, is_urgent boolean DEFAULT false,
  location text, latitude numeric, longitude numeric, created_at timestamptz DEFAULT now());
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helper_id uuid, job_id uuid);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text NOT NULL,
  message text NOT NULL, type text NOT NULL DEFAULT 'info', read boolean DEFAULT false, link text,
  created_at timestamptz NOT NULL DEFAULT now(), job_id uuid);
CREATE TABLE public.notification_dedupe_suppressions (user_id uuid, type text, title text, link text);
CREATE TABLE public.notification_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, recipient_email text,
  category text NOT NULL, channel text NOT NULL, status text NOT NULL, subject text, job_id uuid, error_message text,
  message_id text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.notification_preferences (user_id uuid UNIQUE, push_enabled boolean DEFAULT true,
  job_applications boolean DEFAULT true, job_updates boolean DEFAULT true, messages boolean DEFAULT true,
  payments boolean DEFAULT true, reviews boolean DEFAULT true, system_alerts boolean DEFAULT true,
  new_offers boolean DEFAULT true, transit_updates boolean DEFAULT true, work_status boolean DEFAULT true,
  financial_alerts boolean DEFAULT true, job_matches boolean DEFAULT true, match_digest_mode boolean DEFAULT false);
CREATE TABLE public.notification_type_pref_map (type text PRIMARY KEY, pref_column text);
INSERT INTO public.notification_type_pref_map VALUES ('application','job_applications'),('job_match','job_matches'),
  ('message','messages'),('info','work_status'),('job_updates','job_updates');
CREATE TABLE public.saved_searches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, name text, notify_enabled boolean DEFAULT true,
  category text, parish text, max_budget numeric, min_budget numeric, query text, location_keyword text, radius_miles numeric,
  last_notified_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.match_digest_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, job_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, job_id));
CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sender_id uuid, receiver_id uuid, content text,
  attachment_url text, flagged_hidden boolean DEFAULT false, job_id uuid);
CREATE TABLE public.platform_settings (feature_flags jsonb, updated_at timestamptz DEFAULT now());
INSERT INTO public.platform_settings VALUES ('{"seed_jobs_hidden_publicly": false}', now());

CREATE FUNCTION public.get_user_credential_tier(p_user_id uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.get_supabase_url() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'vault'
  AS $$ SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1; $$;
CREATE FUNCTION public.get_service_role_key() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'vault'
  AS $$ SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1; $$;
CREATE FUNCTION public.miles_between(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN NULL
  ELSE (2 * 3958.8 * asin(LEAST(1, sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
       + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))))::numeric END; $$;

-- live seed_jobs_hidden_publicly
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT s.feature_flags -> 'seed_jobs_hidden_publicly' = 'true'::jsonb FROM public.platform_settings s
                   ORDER BY s.updated_at DESC NULLS LAST LIMIT 1), false); $$;

-- live notification_job_id_from_link
CREATE FUNCTION public.notification_job_id_from_link(p_link text) RETURNS uuid LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path TO 'public', 'pg_temp' AS $$
  SELECT NULLIF(COALESCE(
      (regexp_match(p_link, '[?&]job=([0-9a-fA-F-]{36})'))[1],
      (regexp_match(p_link, '[?&]jobId=([0-9a-fA-F-]{36})'))[1],
      (regexp_match(p_link, '[?&]quickApply=([0-9a-fA-F-]{36})'))[1],
      (regexp_match(p_link, '^/jobs/([0-9a-fA-F-]{36})'))[1]), '')::uuid $$;

-- live notifications_fill_job_id
CREATE FUNCTION public.notifications_fill_job_id() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_job uuid;
BEGIN
  IF NEW.job_id IS NOT NULL OR NEW.link IS NULL THEN RETURN NEW; END IF;
  v_job := public.notification_job_id_from_link(NEW.link);
  IF v_job IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = v_job) THEN NEW.job_id := v_job; END IF;
  RETURN NEW;
END $function$;

-- live suppress_exact_duplicate_notification
CREATE FUNCTION public.suppress_exact_duplicate_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.type IS NOT DISTINCT FROM 'message' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = NEW.user_id AND n.created_at > now() - INTERVAL '10 minutes'
      AND n.type IS NOT DISTINCT FROM NEW.type AND n.title IS NOT DISTINCT FROM NEW.title
      AND n.message IS NOT DISTINCT FROM NEW.message AND n.link IS NOT DISTINCT FROM NEW.link) THEN
    INSERT INTO public.notification_dedupe_suppressions (user_id, type, title, link) VALUES (NEW.user_id, NEW.type, NEW.title, NEW.link);
    RETURN NULL;
  END IF;
  RETURN NEW;
END; $function$;

-- live fan_out_push_on_notification
CREATE FUNCTION public.fan_out_push_on_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE prefs public.notification_preferences; pref_col text; pref_value boolean; supabase_url text; service_role_key text;
BEGIN
  SELECT * INTO prefs FROM public.notification_preferences WHERE user_id = NEW.user_id;
  IF prefs.user_id IS NULL THEN
    INSERT INTO public.notification_preferences (user_id) VALUES (NEW.user_id) ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO prefs FROM public.notification_preferences WHERE user_id = NEW.user_id;
  END IF;
  IF prefs.user_id IS NOT NULL AND prefs.push_enabled IS NOT TRUE THEN RETURN NEW; END IF;
  SELECT pref_column INTO pref_col FROM public.notification_type_pref_map WHERE type = NEW.type;
  IF pref_col IS NULL THEN
    RAISE WARNING 'fan_out_push_on_notification: notification type % has no notification_type_pref_map row', NEW.type;
  ELSE
    EXECUTE format('SELECT ($1).%I', pref_col) INTO pref_value USING prefs;
    IF pref_value IS NOT TRUE THEN RETURN NEW; END IF;
  END IF;
  supabase_url := public.get_supabase_url();
  service_role_key := public.get_service_role_key();
  IF supabase_url IS NULL OR service_role_key IS NULL THEN RETURN NEW; END IF;
  PERFORM net.http_post(url := supabase_url || '/functions/v1/send-push-notification',
    headers := jsonb_build_object('Authorization', 'Bearer ' || service_role_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object('user_id', NEW.user_id, 'title', NEW.title, 'body', NEW.message, 'link', NEW.link, 'thread_id', NEW.type));
  RETURN NEW;
END; $function$;

CREATE TRIGGER suppress_exact_duplicate_notification BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION suppress_exact_duplicate_notification();
CREATE TRIGGER trg_notifications_fill_job_id BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION notifications_fill_job_id();
CREATE TRIGGER notifications_fan_out_to_push AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION fan_out_push_on_notification();

-- live notify_helpers_on_job_post
CREATE FUNCTION public.notify_helpers_on_job_post() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE helper_record RECORD; v_title TEXT; v_message TEXT; v_link TEXT;
BEGIN
  IF NEW.parish IS NULL OR NEW.status <> 'open' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]) THEN RETURN NEW; END IF;
  IF NEW.offered_to_helper_id IS NOT NULL AND COALESCE(NEW.direct_offer_status, 'pending') NOT IN ('declined', 'expired') THEN RETURN NEW; END IF;
  IF COALESCE(NEW.is_seed, false) AND public.seed_jobs_hidden_publicly() THEN RETURN NEW; END IF;
  v_title := 'New job in your parish';
  v_message := 'A new ' || COALESCE(NEW.category::text, 'job') || ' job just posted in ' || NEW.parish || ' Parish: "' || NEW.title || '"';
  v_link := '/dashboard?job=' || NEW.id::text;
  FOR helper_record IN
    WITH candidates AS (
      SELECT p2.user_id FROM public.profiles p2 WHERE p2.parish = NEW.parish
        AND (EXISTS (SELECT 1 FROM public.applications a WHERE a.helper_id = p2.user_id)
             OR EXISTS (SELECT 1 FROM public.jobs j2 WHERE j2.helper_id = p2.user_id)))
    SELECT DISTINCT c.user_id AS helper_id FROM candidates c
    JOIN public.profiles p ON p.user_id = c.user_id
    LEFT JOIN public.notification_preferences np ON np.user_id = c.user_id
    WHERE p.approval_status = 'approved' AND COALESCE(p.ban_status, 'active') = 'active' AND c.user_id <> NEW.customer_id
      AND COALESCE(np.job_matches, true) IS TRUE AND COALESCE(np.match_digest_mode, false) IS FALSE
      AND (COALESCE(NEW.credential_tier, 0) = 0 OR COALESCE(public.get_user_credential_tier(c.user_id), 0) >= NEW.credential_tier)
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (helper_record.helper_id, v_title, v_message, 'job_match', v_link, NEW.id);
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)),
      body := jsonb_build_object('user_id', helper_record.helper_id, 'title', v_title, 'message', v_message, 'type', 'job_match', 'link', v_link));
  END LOOP;
  RETURN NEW;
END; $function$;

-- live notify_saved_searches_on_new_job
CREATE FUNCTION public.notify_saved_searches_on_new_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE match_record RECORD; v_title TEXT; v_message TEXT; v_link TEXT; v_is_urgent BOOLEAN;
BEGIN
  IF NEW.status <> 'open' OR COALESCE(NEW.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]) THEN RETURN NEW; END IF;
  IF NEW.offered_to_helper_id IS NOT NULL AND COALESCE(NEW.direct_offer_status, 'pending') NOT IN ('declined', 'expired') THEN RETURN NEW; END IF;
  IF COALESCE(NEW.is_seed, false) AND public.seed_jobs_hidden_publicly() THEN RETURN NEW; END IF;
  v_is_urgent := COALESCE(NEW.is_urgent, false);
  v_title := 'New job matches your saved search';
  v_link  := '/dashboard?job=' || NEW.id::text;
  FOR match_record IN
    SELECT s.user_id, (ARRAY_AGG(s.name ORDER BY s.created_at DESC))[1] AS search_name, ARRAY_AGG(s.id) AS matched_search_ids,
      COALESCE(BOOL_OR(np.match_digest_mode), false) AS digest_mode
    FROM public.saved_searches s JOIN public.profiles p ON p.user_id = s.user_id
    LEFT JOIN public.notification_preferences np ON np.user_id = s.user_id
    WHERE s.notify_enabled = true AND p.approval_status = 'approved' AND COALESCE(p.ban_status, 'active') = 'active'
      AND s.user_id <> NEW.customer_id AND COALESCE(np.job_matches, true) IS TRUE
      AND (s.category IS NULL OR s.category = NEW.category::text) AND (s.parish IS NULL OR s.parish = NEW.parish)
      AND (s.max_budget IS NULL OR NEW.budget <= s.max_budget) AND (s.min_budget IS NULL OR NEW.budget >= s.min_budget)
      AND (s.query IS NULL OR btrim(s.query) = '' OR strpos(lower(NEW.title), lower(btrim(s.query))) > 0
           OR strpos(lower(COALESCE(NEW.description, '')), lower(btrim(s.query))) > 0)
      AND (s.location_keyword IS NULL OR s.location_keyword ~ '^nearby:' OR strpos(lower(COALESCE(NEW.location, '')), lower(s.location_keyword)) > 0)
      AND (s.radius_miles IS NULL
           OR (p.latitude IS NOT NULL AND p.longitude IS NOT NULL AND NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL
               AND public.miles_between(p.latitude, p.longitude, NEW.latitude, NEW.longitude) <= s.radius_miles)
           OR ((p.latitude IS NULL OR p.longitude IS NULL OR NEW.latitude IS NULL OR NEW.longitude IS NULL)
               AND p.parish IS NOT NULL AND NEW.parish IS NOT NULL AND p.parish = NEW.parish))
      AND (s.last_notified_at IS NULL OR s.last_notified_at < now() - interval '1 hour')
    GROUP BY s.user_id
  LOOP
    UPDATE public.saved_searches SET last_notified_at = now() WHERE id = ANY(match_record.matched_search_ids);
    IF match_record.digest_mode AND NOT v_is_urgent THEN
      INSERT INTO public.match_digest_queue (user_id, job_id) VALUES (match_record.user_id, NEW.id) ON CONFLICT (user_id, job_id) DO NOTHING;
    ELSE
      v_message := 'A new job matches "' || match_record.search_name || '": ' || NEW.title || ' ($' || NEW.budget || ')'
        || CASE WHEN v_is_urgent THEN ' · Urgent' ELSE '' END;
      INSERT INTO public.notifications (user_id, title, message, type, link) VALUES (match_record.user_id, v_title, v_message, 'job_match', v_link);
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)),
        body := jsonb_build_object('user_id', match_record.user_id, 'title', v_title, 'message', v_message, 'type', 'job_match', 'link', v_link));
    END IF;
  END LOOP;
  RETURN NEW;
END; $function$;

-- the four live WHEN clauses
CREATE TRIGGER trg_notify_helpers_funded_insert AFTER INSERT ON public.jobs FOR EACH ROW
  WHEN (((new.status = 'open'::job_status) AND (new.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]))))
  EXECUTE FUNCTION notify_helpers_on_job_post();
CREATE TRIGGER trg_notify_helpers_funded_update AFTER UPDATE ON public.jobs FOR EACH ROW
  WHEN (((new.status = 'open'::job_status) AND (new.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]))
    AND (NOT ((old.status = 'open'::job_status) AND (COALESCE(old.payment_status, ''::text) = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]))))))
  EXECUTE FUNCTION notify_helpers_on_job_post();
CREATE TRIGGER trg_notify_saved_searches_funded_insert AFTER INSERT ON public.jobs FOR EACH ROW
  WHEN (((new.status = 'open'::job_status) AND (new.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]))))
  EXECUTE FUNCTION notify_saved_searches_on_new_job();
CREATE TRIGGER trg_notify_saved_searches_funded_update AFTER UPDATE ON public.jobs FOR EACH ROW
  WHEN (((new.status = 'open'::job_status) AND (new.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]))
    AND (NOT ((old.status = 'open'::job_status) AND (COALESCE(old.payment_status, ''::text) = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]))))))
  EXECUTE FUNCTION notify_saved_searches_on_new_job();

-- live notify_message_recipient (preview/name logic trimmed to the insert it makes)
CREATE FUNCTION public.notify_message_recipient() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.sender_id IS NULL OR NEW.receiver_id IS NULL OR NEW.sender_id = NEW.receiver_id THEN RETURN NEW; END IF;
  IF NEW.flagged_hidden = true THEN RETURN NEW; END IF;
  INSERT INTO public.notifications (user_id, title, message, type, link, read)
  VALUES (NEW.receiver_id, 'Someone', left(COALESCE(NEW.content, ''), 80), 'message',
    '/messages?jobId=' || COALESCE(NEW.job_id::text, '') || '&userId=' || COALESCE(NEW.sender_id::text, ''), false);
  RETURN NEW;
END; $function$;
CREATE TRIGGER on_message_notify AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION notify_message_recipient();
`);

// sweep_daily_job_digest as live (20260911201653, verified equal to pg_get_functiondef 2026-09-23)
{
  const src = mig("20260911201653_job_match_notification_preference.sql");
  const start = src.indexOf("CREATE OR REPLACE FUNCTION public.sweep_daily_job_digest()");
  const end = src.indexOf("REVOKE ALL ON FUNCTION public.sweep_daily_job_digest()", start);
  await db.exec(src.slice(start, end));
}

if (!MODE) {
  for (let i = 1; i <= 3; i++) {
    await db.exec(NEW);
  }
  console.log("migration applied 3x (replay-safe)");
}

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const n = async (user, extra = "", params = []) =>
  Number((await q(`SELECT count(*)::int c FROM public.notifications WHERE user_id = $1 ${extra}`, [user, ...params]))[0].c);
const reset = async () => {
  await db.exec(`DELETE FROM public.notifications; DELETE FROM net.calls; DELETE FROM public.match_digest_queue;
                 DELETE FROM public.notification_logs; UPDATE public.saved_searches SET last_notified_at = NULL;`);
};

// Everyone in East Baton Rouge; the helpers have applied before (the live candidate rule).
await db.exec(`
INSERT INTO public.profiles (user_id, parish, is_seed) VALUES
  ('${SEED_HELPER}', 'East Baton Rouge', true), ('${REAL_HELPER}', 'East Baton Rouge', false),
  ('${SEED_POSTER}', 'East Baton Rouge', true), ('${REAL_POSTER}', 'East Baton Rouge', false),
  ('${SEED_DIGEST}', 'East Baton Rouge', true), ('${REAL_DIGEST}', 'East Baton Rouge', false);
INSERT INTO public.applications (helper_id) VALUES ('${SEED_HELPER}'), ('${REAL_HELPER}'), ('${SEED_DIGEST}'), ('${REAL_DIGEST}');
INSERT INTO public.notification_preferences (user_id, match_digest_mode) VALUES ('${SEED_DIGEST}', true), ('${REAL_DIGEST}', true);
INSERT INTO public.saved_searches (user_id, name, parish) VALUES
  ('${SEED_HELPER}', 'ebr', 'East Baton Rouge'), ('${REAL_HELPER}', 'ebr', 'East Baton Rouge'),
  ('${SEED_DIGEST}', 'ebr', 'East Baton Rouge'), ('${REAL_DIGEST}', 'ebr', 'East Baton Rouge');
`);

const emailCalls = async () => q(`SELECT body FROM net.calls WHERE url LIKE '%send-notification-email'`);
const pushCalls = async (user) =>
  Number((await q(`SELECT count(*)::int c FROM net.calls WHERE url LIKE '%send-push-notification' AND body->>'user_id' = $1`, [user]))[0].c);
const hasBoundary = MODE ? false : true;
const crosses = async (user, link) =>
  hasBoundary ? (await q(`SELECT public.notification_crosses_seed_boundary($1, NULL, $2) AS x`, [user, link]))[0].x : false;

// ── 1. A SEED job becomes visible (funded) — the Q100 incident ──
await reset();
{
  const [{ id }] = await q(`INSERT INTO public.jobs (customer_id, title, parish, is_seed, payment_status)
                            VALUES ($1, 'Q100 fixture', 'East Baton Rouge', true, 'pending') RETURNING id`, [SEED_POSTER]);
  await q(`UPDATE public.jobs SET payment_status = 'escrow' WHERE id = $1`, [id]);
  check("seed job: the seed helper is notified (parish match + saved search)", (await n(SEED_HELPER)) === 2, `rows=${await n(SEED_HELPER)}`);
  check("seed job: the REAL helper gets NO notification", (await n(REAL_HELPER)) === 0, `rows=${await n(REAL_HELPER)}`);
  check("seed job: the REAL helper gets NO push", (await pushCalls(REAL_HELPER)) === 0, `push=${await pushCalls(REAL_HELPER)}`);
  check("seed job: the seed helper IS pushed", (await pushCalls(SEED_HELPER)) === 2, `push=${await pushCalls(SEED_HELPER)}`);
  const qd = await q(`SELECT user_id FROM public.match_digest_queue`);
  check("seed job: digest queue holds the seed digest helper only",
    qd.length === 1 && qd[0].user_id === SEED_DIGEST, qd.map((r) => r.user_id).join(","));
  // Email: the SQL producers still POST; the email sender refuses by asking the boundary.
  const emails = await emailCalls();
  const toReal = emails.filter((e) => e.body.user_id === REAL_HELPER);
  const toSeed = emails.filter((e) => e.body.user_id === SEED_HELPER);
  check("seed job: every email POST to the REAL helper is refused by the sender's check",
    toReal.length > 0 && (await Promise.all(toReal.map((e) => crosses(e.body.user_id, e.body.link)))).every(Boolean),
    `posts=${toReal.length}`);
  check("seed job: email POSTs to the seed helper are allowed",
    toSeed.length > 0 && (await Promise.all(toSeed.map((e) => crosses(e.body.user_id, e.body.link)))).every((x) => x === false),
    `posts=${toSeed.length}`);
  const logs = Number((await q(`SELECT count(*)::int c FROM public.notification_logs WHERE status = 'suppressed_seed' AND user_id IN ($1, $2)`, [REAL_HELPER, REAL_DIGEST]))[0].c);
  check("seed job: each suppression is recorded in notification_logs", logs === 3, `logs=${logs}`);
}

// ── 2. A REAL job becomes visible — everyone is still told ──
await reset();
{
  const [{ id }] = await q(`INSERT INTO public.jobs (customer_id, title, parish, is_seed, payment_status)
                            VALUES ($1, 'Real job', 'East Baton Rouge', false, 'pending') RETURNING id`, [REAL_POSTER]);
  await q(`UPDATE public.jobs SET payment_status = 'escrow' WHERE id = $1`, [id]);
  check("real job: the real helper is notified (parish match + saved search)", (await n(REAL_HELPER)) === 2, `rows=${await n(REAL_HELPER)}`);
  check("real job: the seed helper is notified too", (await n(SEED_HELPER)) === 2, `rows=${await n(SEED_HELPER)}`);
  check("real job: the real helper is pushed", (await pushCalls(REAL_HELPER)) === 2, `push=${await pushCalls(REAL_HELPER)}`);
  const qd = (await q(`SELECT user_id FROM public.match_digest_queue ORDER BY user_id`)).map((r) => r.user_id);
  check("real job: both digest helpers are queued", qd.length === 2, qd.join(","));
  const emails = await emailCalls();
  const toReal = emails.filter((e) => e.body.user_id === REAL_HELPER);
  check("real job: email to the real helper is allowed",
    toReal.length > 0 && (await Promise.all(toReal.map((e) => crosses(e.body.user_id, e.body.link)))).every((x) => x === false),
    `posts=${toReal.length}`);
}

// ── 3. sweep_daily_job_digest ("New jobs in <parish>", link '/dashboard') ──
await reset();
{
  await db.exec(`DELETE FROM public.jobs;`);
  await q(`INSERT INTO public.jobs (customer_id, title, parish, is_seed, payment_status) VALUES ($1, 'seed only', 'East Baton Rouge', true, 'escrow')`, [SEED_POSTER]);
  await reset();
  await q(`SELECT public.sweep_daily_job_digest()`);
  check("digest sweep, only a seed job new: the REAL helper gets no 'New jobs in' row",
    (await n(REAL_HELPER, `AND title LIKE 'New jobs in%'`)) === 0, `rows=${await n(REAL_HELPER, `AND title LIKE 'New jobs in%'`)}`);
  check("digest sweep, only a seed job new: the seed helper does",
    (await n(SEED_HELPER, `AND title LIKE 'New jobs in%'`)) === 1, `rows=${await n(SEED_HELPER, `AND title LIKE 'New jobs in%'`)}`);
  await q(`INSERT INTO public.jobs (customer_id, title, parish, is_seed, payment_status, budget) VALUES ($1, 'real', 'East Baton Rouge', false, 'escrow', 50)`, [REAL_POSTER]);
  await reset();
  await q(`SELECT public.sweep_daily_job_digest()`);
  const msg = (await q(`SELECT message FROM public.notifications WHERE user_id = $1 AND title LIKE 'New jobs in%'`, [REAL_HELPER]))[0]?.message ?? "";
  check("digest sweep, one real + one seed job: the real helper is told of ONE job", /^1 new job /.test(msg), msg);
}

// ── 4. A seed ACTOR (message sender) ──
await reset();
{
  await q(`INSERT INTO public.messages (sender_id, receiver_id, content) VALUES ($1, $2, 'hi')`, [SEED_POSTER, REAL_HELPER]);
  check("seed sender -> real receiver (no job): no notification", (await n(REAL_HELPER)) === 0, `rows=${await n(REAL_HELPER)}`);
  await q(`INSERT INTO public.messages (sender_id, receiver_id, content) VALUES ($1, $2, 'hi')`, [SEED_POSTER, SEED_HELPER]);
  check("seed sender -> seed receiver: notified", (await n(SEED_HELPER)) === 1, `rows=${await n(SEED_HELPER)}`);
  await q(`INSERT INTO public.messages (sender_id, receiver_id, content) VALUES ($1, $2, 'hi')`, [REAL_POSTER, REAL_HELPER]);
  check("real sender -> real receiver: notified", (await n(REAL_HELPER)) === 1, `rows=${await n(REAL_HELPER)}`);
}

// ── 5. Direct producers + the boundary function's edges ──
await reset();
{
  await q(`INSERT INTO public.notifications (user_id, title, message, type, link) VALUES ($1, 'x', 'y', 'info', $2)`,
    [REAL_POSTER, `/post-job?offerTo=${SEED_HELPER}`]);
  check("saved-helper availability about a SEED helper -> real poster: dropped", (await n(REAL_POSTER)) === 0, `rows=${await n(REAL_POSTER)}`);
  await q(`INSERT INTO public.notifications (user_id, title, message, type, link) VALUES ($1, 'x', 'y', 'info', $2)`,
    [REAL_POSTER, `/post-job?offerTo=${REAL_HELPER}`]);
  check("saved-helper availability about a real helper -> real poster: kept", (await n(REAL_POSTER)) === 1, `rows=${await n(REAL_POSTER)}`);
  await q(`INSERT INTO public.notifications (user_id, title, message, type) VALUES ($1, 'Welcome', 'y', 'info')`, [NO_PROFILE]);
  check("a row with no seed subject is untouched (recipient with no profile)", (await n(NO_PROFILE)) === 1, `rows=${await n(NO_PROFILE)}`);
  const [{ id: seedJob }] = await q(`INSERT INTO public.jobs (customer_id, title, parish, is_seed) VALUES ($1, 's', 'X', true) RETURNING id`, [SEED_POSTER]);
  await q(`INSERT INTO public.notifications (user_id, title, message, type, job_id) VALUES ($1, 'x', 'y', 'job_updates', $2)`, [NO_PROFILE, seedJob]);
  check("an account with NO profiles row counts as real: seed job row dropped", (await n(NO_PROFILE)) === 1, `rows=${await n(NO_PROFILE)}`);
  if (hasBoundary) {
    const bad = (await q(`SELECT public.notification_crosses_seed_boundary($1, NULL, '/messages?userId=not-a-uuid-at-all-0000000000000000') AS x`, [REAL_POSTER]))[0].x;
    check("a malformed id in a link is ignored, never cast", bad === false, String(bad));
    const actor = (await q(`SELECT public.notification_crosses_seed_boundary($1, NULL, NULL, $2) AS x`, [REAL_POSTER, SEED_HELPER]))[0].x;
    check("an explicit seed actor (create-notification's caller) crosses", actor === true, String(actor));
    const self = (await q(`SELECT public.notification_crosses_seed_boundary($1, NULL, NULL, $1) AS x`, [REAL_POSTER]))[0].x;
    check("a real account notifying itself does not cross", self === false, String(self));
  } else {
    check("notification_crosses_seed_boundary exists", false, "absent in the live state");
  }
}

// ── Shape ──
{
  const fns = await q(`SELECT proname, prosecdef, coalesce(proacl::text, '') AS acl FROM pg_proc
                       WHERE proname IN ('notification_crosses_seed_boundary','notifications_seed_boundary','match_digest_queue_seed_boundary')`);
  for (const name of ["notification_crosses_seed_boundary", "notifications_seed_boundary", "match_digest_queue_seed_boundary"]) {
    const f = fns.find((x) => x.proname === name);
    check(`${name}: SECURITY DEFINER, no anon/authenticated/PUBLIC EXECUTE`,
      !!f && f.prosecdef && !/(^|[{,])=X|anon=|authenticated=/.test(f.acl), f?.acl ?? "missing");
  }
  const order = (await q(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.notifications'::regclass AND NOT tgisinternal
                          AND tgtype & 2 = 2 ORDER BY tgname`)).map((r) => r.tgname);
  check("the seed boundary runs AFTER fill_job_id (BEFORE triggers fire in name order)",
    order.indexOf("trg_notifications_seed_boundary") > order.indexOf("trg_notifications_fill_job_id")
      && order.indexOf("trg_notifications_fill_job_id") >= 0, order.join(","));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
