#!/usr/bin/env node
/**
 * PGlite proof for 20260923185634_early_access_holds_job_match_notifications
 * (docs/OPEN.md Q225).
 *
 *   node src/test/pglite/jobMatchEarlyAccess.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/jobMatchEarlyAccess.pglite.mjs   # RED: the state before
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the live notification chain as src/test/pglite/seedNeverNotifiesReal.pglite.mjs
 * builds it (fill_job_id, exact-duplicate suppression, push fan-out), plus the
 * REAL migration text for everything this change touches or reads:
 *   early_access_cutoff()              20260905221158 (newest)
 *   notifications seed boundary        20260923121354
 *   notify_helpers_on_job_post,
 *   notify_saved_searches_on_new_job   20260923172405 (newest before this change)
 * Stubs: net.http_post records its calls; vault is a two-row table; auth.uid()
 * reads request.jwt.claim.sub; cron.schedule records its calls.
 *
 * The window is the browse window: for each tier, now() - early_access_cutoff()
 * as that user equals early_access_delay_minutes(user).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const slice = (src, from, to) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error(`fixture slice not found: ${from}`);
  return src.slice(a, b);
};
const NEW = mig("20260923185634_early_access_holds_job_match_notifications.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state BEFORE the fix (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `22222222-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const POSTER = U(1);
const FREE = U(2); // no tier: waits 20 minutes
const ELITE = U(3); // sees new jobs at once
const PRO = U(4); // waits 10
const LAPSED = U(5); // elite with a stamped past expiry: waits 20
const MUTED_LATER = U(6); // free, turns matches off inside the window

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE SCHEMA net;
CREATE TABLE net.calls (id bigserial PRIMARY KEY, url text, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}'::jsonb, body jsonb DEFAULT '{}'::jsonb) RETURNS bigint
  LANGUAGE sql AS $$ INSERT INTO net.calls (url, body) VALUES (url, body) RETURNING id $$;
CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url', 'https://x.supabase.co'), ('service_role_key', 'k');
CREATE SCHEMA cron;
CREATE TABLE cron.scheduled (jobname text PRIMARY KEY, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.scheduled VALUES (p_name, p_schedule, p_command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING 1::bigint $$;
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, candidate_key text, expected_max_gap interval, note text);

CREATE TYPE public.job_status AS ENUM ('open', 'in_progress', 'completed', 'cancelled');
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, parish text, email_verified boolean DEFAULT true,
  ban_status text DEFAULT 'active', is_seed boolean DEFAULT false, latitude numeric, longitude numeric,
  subscription_tier text, subscription_expires_at timestamptz);
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
  job_matches boolean DEFAULT true, match_digest_mode boolean DEFAULT false);
CREATE TABLE public.notification_type_pref_map (type text PRIMARY KEY, pref_column text);
INSERT INTO public.notification_type_pref_map VALUES ('job_match','job_matches');
CREATE TABLE public.saved_searches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, name text, notify_enabled boolean DEFAULT true,
  category text, parish text, max_budget numeric, min_budget numeric, query text, location_keyword text, radius_miles numeric,
  last_notified_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.match_digest_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, job_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, job_id));
CREATE TABLE public.platform_settings (feature_flags jsonb, updated_at timestamptz DEFAULT now());
INSERT INTO public.platform_settings VALUES ('{"seed_jobs_hidden_publicly": false}', now());

CREATE FUNCTION public.get_user_credential_tier(p_user_id uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.miles_between(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::numeric $$;
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT s.feature_flags -> 'seed_jobs_hidden_publicly' = 'true'::jsonb FROM public.platform_settings s
                   ORDER BY s.updated_at DESC NULLS LAST LIMIT 1), false); $$;
CREATE FUNCTION public.notification_job_id_from_link(p_link text) RETURNS uuid LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path TO 'public', 'pg_temp' AS $$
  SELECT NULLIF(COALESCE(
      (regexp_match(p_link, '[?&]job=([0-9a-fA-F-]{36})'))[1],
      (regexp_match(p_link, '[?&]jobId=([0-9a-fA-F-]{36})'))[1],
      (regexp_match(p_link, '[?&]quickApply=([0-9a-fA-F-]{36})'))[1],
      (regexp_match(p_link, '^/jobs/([0-9a-fA-F-]{36})'))[1]), '')::uuid $$;
CREATE FUNCTION public.notifications_fill_job_id() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_job uuid;
BEGIN
  IF NEW.job_id IS NOT NULL OR NEW.link IS NULL THEN RETURN NEW; END IF;
  v_job := public.notification_job_id_from_link(NEW.link);
  IF v_job IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = v_job) THEN NEW.job_id := v_job; END IF;
  RETURN NEW;
END $function$;
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
CREATE FUNCTION public.fan_out_push_on_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM net.http_post(url := 'https://x.supabase.co/functions/v1/send-push-notification',
    body := jsonb_build_object('user_id', NEW.user_id, 'title', NEW.title, 'link', NEW.link));
  RETURN NEW;
END; $function$;
CREATE TRIGGER suppress_exact_duplicate_notification BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION suppress_exact_duplicate_notification();
CREATE TRIGGER trg_notifications_fill_job_id BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION notifications_fill_job_id();
CREATE TRIGGER notifications_fan_out_to_push AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION fan_out_push_on_notification();
`);

// Real migration text for everything the change reads or replaces.
await db.exec(slice(mig("20260905221158_early_access_cutoff_admits_plus.sql"),
  "CREATE OR REPLACE FUNCTION public.early_access_cutoff()", "$function$;") + "$function$;");
await db.exec(slice(mig("20260923121354_seed_subject_never_notifies_real.sql"),
  "CREATE OR REPLACE FUNCTION public.notification_crosses_seed_boundary(", "-- 2. match_digest_queue"));
{
  const src = mig("20260923172405_retire_approval_status_reads.sql");
  await db.exec(slice(src, "CREATE OR REPLACE FUNCTION public.notify_helpers_on_job_post()", "REVOKE ALL ON FUNCTION public.notify_helpers_on_job_post()"));
  await db.exec(slice(src, "CREATE OR REPLACE FUNCTION public.notify_saved_searches_on_new_job()", "REVOKE ALL ON FUNCTION public.notify_saved_searches_on_new_job()"));
}
// The live WHEN clauses (as seedNeverNotifiesReal.pglite.mjs records them).
await db.exec(`
CREATE TRIGGER trg_notify_helpers_funded_update AFTER UPDATE ON public.jobs FOR EACH ROW
  WHEN (((new.status = 'open'::job_status) AND (new.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]))
    AND (NOT ((old.status = 'open'::job_status) AND (COALESCE(old.payment_status, ''::text) = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]))))))
  EXECUTE FUNCTION notify_helpers_on_job_post();
CREATE TRIGGER trg_notify_saved_searches_funded_update AFTER UPDATE ON public.jobs FOR EACH ROW
  WHEN (((new.status = 'open'::job_status) AND (new.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]))
    AND (NOT ((old.status = 'open'::job_status) AND (COALESCE(old.payment_status, ''::text) = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]))))))
  EXECUTE FUNCTION notify_saved_searches_on_new_job();
`);

if (!MODE) {
  for (let i = 1; i <= 3; i++) await db.exec(NEW);
  console.log("migration applied 3x (replay-safe)");
}

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const count = async (sql, params = []) => Number((await q(sql, params))[0].c);
const inApp = (u) => count(`SELECT count(*)::int c FROM public.notifications WHERE user_id = $1 AND type = 'job_match'`, [u]);
const emails = (u) => count(`SELECT count(*)::int c FROM net.calls WHERE url LIKE '%send-notification-email' AND body->>'user_id' = $1`, [u]);
const pushes = (u) => count(`SELECT count(*)::int c FROM net.calls WHERE url LIKE '%send-push-notification' AND body->>'user_id' = $1`, [u]);
const release = async () => {
  if (MODE) return; // the function does not exist before the fix
  await q(`SELECT public.release_job_match_holds()`);
};
const reset = () => db.exec(`DELETE FROM public.notifications; DELETE FROM net.calls; UPDATE public.saved_searches SET last_notified_at = NULL;
  ${MODE ? "" : "DELETE FROM public.job_match_holds;"}`);

await db.exec(`
INSERT INTO auth.users (id) VALUES ('${POSTER}'), ('${FREE}'), ('${ELITE}'), ('${PRO}'), ('${LAPSED}'), ('${MUTED_LATER}');
INSERT INTO public.profiles (user_id, parish, subscription_tier, subscription_expires_at) VALUES
  ('${POSTER}', 'Orleans', NULL, NULL), ('${FREE}', 'Orleans', NULL, NULL), ('${ELITE}', 'Orleans', 'elite', NULL),
  ('${PRO}', 'Orleans', 'pro', now() + interval '30 days'), ('${LAPSED}', 'Orleans', 'elite', now() - interval '1 day'),
  ('${MUTED_LATER}', 'Orleans', NULL, NULL);
INSERT INTO public.applications (helper_id) VALUES ('${FREE}'), ('${ELITE}'), ('${PRO}'), ('${LAPSED}'), ('${MUTED_LATER}');
INSERT INTO public.saved_searches (user_id, name, parish) VALUES ('${FREE}', 'orleans', 'Orleans'), ('${ELITE}', 'orleans', 'Orleans');
`);

const newJob = async (extra = "") =>
  (await q(`INSERT INTO public.jobs (customer_id, parish, title, payment_status ${extra ? ", " + extra.split("=")[0] : ""})
            VALUES ($1, 'Orleans', 'Mow the lawn', NULL ${extra ? ", " + extra.split("=")[1] : ""}) RETURNING id`, [POSTER]))[0].id;
const fund = (id) => q(`UPDATE public.jobs SET payment_status = 'escrow' WHERE id = $1`, [id]);
const age = (id, mins) => q(`UPDATE public.jobs SET created_at = now() - make_interval(mins => $2) WHERE id = $1`, [id, mins]);

// ── The window is the browse window ──
if (!MODE) {
  for (const [u, want] of [[FREE, 20], [ELITE, 0], [PRO, 10], [LAPSED, 20], [U(99), 20]]) {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${u}', false)`);
    const r = (await q(`SELECT public.early_access_delay_minutes($1::uuid) AS d,
      round(extract(epoch FROM now() - public.early_access_cutoff()) / 60)::int AS browse`, [u]))[0];
    check(`delay for ${u.slice(-2)} = browse delay (${want} min)`, r.d === want && r.browse === want, `delay ${r.d}, browse ${r.browse}`);
  }
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false)`);
}

// ── 1. A job funded the minute it is posted ──
await reset();
const J1 = await newJob();
await fund(J1);
check("free member: no in-app row at funding", (await inApp(FREE)) === 0, `${await inApp(FREE)} rows`);
check("free member: no push at funding", (await pushes(FREE)) === 0, `${await pushes(FREE)} pushes`);
check("free member: no email at funding", (await emails(FREE)) === 0, `${await emails(FREE)} emails`);
check("lapsed elite: nothing at funding (expiry honoured)", (await inApp(LAPSED)) + (await emails(LAPSED)) === 0);
check("pro member: nothing at funding", (await inApp(PRO)) === 0);
check("elite member: parish + saved-search rows at funding", (await inApp(ELITE)) === 2, `${await inApp(ELITE)} rows`);
check("elite member: both emails at funding", (await emails(ELITE)) === 2, `${await emails(ELITE)} emails`);

await release();
check("release before any window opens delivers nothing new", (await inApp(FREE)) === 0 && (await inApp(PRO)) === 0);

await age(J1, 11);
await release();
check("11 min: pro delivered (in-app + email)", (await inApp(PRO)) === 1 && (await emails(PRO)) === 1,
  `${await inApp(PRO)} rows, ${await emails(PRO)} emails`);
check("11 min: free still held", (await inApp(FREE)) === 0);

await q(`UPDATE public.notification_preferences SET job_matches = false WHERE user_id = $1`, [MUTED_LATER]);
await q(`INSERT INTO public.notification_preferences (user_id, job_matches) VALUES ($1, false) ON CONFLICT (user_id) DO UPDATE SET job_matches = false`, [MUTED_LATER]);
await age(J1, 21);
await release();
check("21 min: free delivered, parish + saved search, each with its email",
  (await inApp(FREE)) === 2 && (await emails(FREE)) === 2, `${await inApp(FREE)} rows, ${await emails(FREE)} emails`);
check("21 min: free delivery pushed", (await pushes(FREE)) === 2, `${await pushes(FREE)} pushes`);
check("21 min: lapsed elite delivered", (await inApp(LAPSED)) === 1);
check("muted inside the window: never delivered", (await inApp(MUTED_LATER)) === 0);
if (!MODE) check("every hold released or dropped", (await count(`SELECT count(*)::int c FROM public.job_match_holds`)) === 0);
await release();
check("a second release sends nothing twice", (await inApp(FREE)) === 2 && (await emails(FREE)) === 2 && (await inApp(PRO)) === 1);

// ── 2. Hired inside the window: never announced ──
await reset();
const J2 = await newJob();
await fund(J2);
await q(`UPDATE public.jobs SET status = 'in_progress', helper_id = $2 WHERE id = $1`, [J2, ELITE]);
await age(J2, 25);
await release();
check("job taken before the window opened: free member never told", (await inApp(FREE)) === 0 && (await emails(FREE)) === 0);

// ── 3. A job funded long after it was posted is already public: immediate ──
await reset();
const J3 = await newJob();
await age(J3, 45);
await fund(J3);
check("funded 45 min after posting: free member told at once", (await inApp(FREE)) === 2 && (await emails(FREE)) === 2,
  `${await inApp(FREE)} rows, ${await emails(FREE)} emails`);

// ── 4. The edge producer (instant-job-match) inserts directly: the backstop holds it ──
await reset();
const J4 = await newJob();
await q(`UPDATE public.jobs SET payment_status = 'escrow', parish = NULL WHERE id = $1`, [J4]); // no parish: SQL producers stand down
await q(`INSERT INTO public.notifications (user_id, title, message, type, link, read)
         VALUES ($1, '🧹 Match for you', 'Mow the lawn in New Orleans · $100.', 'job_match', '/dashboard?quickApply=' || $2, false),
                ($3, '🧹 Match for you', 'Mow the lawn in New Orleans · $100.', 'job_match', '/dashboard?quickApply=' || $2, false)`,
  [FREE, J4, ELITE]);
check("edge insert: free member held (no row, no push)", (await inApp(FREE)) === 0 && (await pushes(FREE)) === 0);
check("edge insert: elite member delivered at once", (await inApp(ELITE)) === 1);
await age(J4, 21);
await release();
check("edge insert: free member delivered when the window opens, no email (the edge never emailed)",
  (await inApp(FREE)) === 1 && (await emails(FREE)) === 0 && (await pushes(FREE)) === 1);

// ── 5. Other types are untouched ──
await reset();
const J5 = await newJob();
await q(`INSERT INTO public.notifications (user_id, title, message, type, link) VALUES ($1, 't', 'm', 'info', '/dashboard?job=' || $2)`, [FREE, J5]);
check("a non-job_match row about a new job is never held", (await count(`SELECT count(*)::int c FROM public.notifications WHERE user_id = $1`, [FREE])) === 1);

// ── 6. Wiring ──
if (!MODE) {
  const cron = await q(`SELECT schedule, command FROM cron.scheduled WHERE jobname = 'release-job-match-holds'`);
  check("release cron scheduled every minute", cron[0]?.schedule === "* * * * *" && /release_job_match_holds\(\)/.test(cron[0]?.command ?? ""));
  check("release cron has a liveness expectation",
    (await count(`SELECT count(*)::int c FROM public.cron_work_expectations WHERE jobname = 'release-job-match-holds'`)) === 1);
  const acl = await q(`SELECT has_function_privilege('authenticated', 'public.deliver_job_match(uuid,uuid,text,text,text,boolean)', 'EXECUTE') a,
                              has_function_privilege('anon', 'public.release_job_match_holds()', 'EXECUTE') b,
                              has_function_privilege('authenticated', 'public.early_access_delay_minutes(uuid)', 'EXECUTE') c,
                              has_table_privilege('authenticated', 'public.job_match_holds', 'SELECT') d`);
  check("no client can call the new functions or read the holds", !acl[0].a && !acl[0].b && !acl[0].c && !acl[0].d);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
