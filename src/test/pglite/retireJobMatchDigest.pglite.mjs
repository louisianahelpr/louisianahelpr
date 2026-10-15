#!/usr/bin/env node
/**
 * Q1657: the job-match digest is retired. Runs
 * 20261015065619_retire_job_match_digest.sql VERBATIM (3x) over the
 * definitions it replaces (taken from the migrations before it), the catch-up
 * policy it restates (20261012214444, run verbatim first) and a stand-in
 * cron.job, then drives the saved-search path: fund a job -> the trigger
 * notify_saved_searches_on_new_job queues -> deliver_saved_search_alert sends.
 *
 *   node src/test/pglite/retireJobMatchDigest.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/retireJobMatchDigest.pglite.mjs   # RED: the previous definitions
 *
 * The member below has match_digest_mode = true underneath the hold trigger
 * (an old row, or a write that slipped past it): before the migration their
 * match goes to match_digest_queue, which nothing reads any more once the
 * daily-match-digest cron is gone, so they are never told. After it, they get
 * the same alert as everyone else.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261015065619_retire_job_match_digest.sql";
const POLICY_FILE = "20261012214444_unfilled_series_reminder_catchup_policy.sql";
const RED = process.env.NEW_MIGRATION === "skip";
if (RED) console.log("NEW_MIGRATION=skip: running the PREVIOUS definitions (expect FAILs)");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( in migrations sorting before `before`. */
function definitionBefore(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = rest.slice(0, end + tag[1].length) + ";";
    }
  }
  if (!last) throw new Error(`no definition of ${name} before ${before}`);
  return last;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "66666666-0000-0000-0000-000000000000";
const DIGEST = "66666666-0000-0000-0000-000000000001"; // match_digest_mode left true
const PLAIN = "66666666-0000-0000-0000-000000000002";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA net; CREATE SCHEMA vault; CREATE SCHEMA cron;
CREATE TABLE net.calls (body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls VALUES (body); SELECT 1::bigint $$;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url','http://x'),('service_role_key','k');
CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = job_name;
  IF NOT FOUND THEN RAISE EXCEPTION 'could not find valid entry for job ''%''', job_name; END IF;
  RETURN true;
END $$;
INSERT INTO cron.job (jobname, schedule, command) VALUES
  ('daily-match-digest', '12 13 * * *', 'SELECT 1'),
  ('sweep-daily-job-digest', '56 13 * * *', 'SELECT 1'),
  ('ops-daily-digest', '40 14 * * *', 'SELECT 1');
CREATE TABLE public.cron_catchup_policy (jobname text PRIMARY KEY, catch_up boolean NOT NULL, max_late interval NOT NULL, reason text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, expected_max_gap interval, note text);
INSERT INTO public.cron_work_expectations VALUES
  ('daily-match-digest', interval '30 hours', 'x'), ('sweep-daily-job-digest', interval '30 hours', 'x'), ('ops-daily-digest', interval '30 hours', 'x');
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.get_user_credential_tier(p_user_id uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.early_access_delay_minutes(p_user_id uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.miles_between(a float8, b float8, c float8, d float8) RETURNS float8 LANGUAGE sql AS $$ SELECT 0::float8 $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, email_verified boolean, ban_status text, parish text, latitude float8, longitude float8,
  is_seed boolean DEFAULT false);
CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, job_matches boolean, match_digest_mode boolean NOT NULL DEFAULT false);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text, job_id uuid,
  read boolean DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), status text, payment_status text,
  parent_job_id uuid, offered_to_helper_id uuid, direct_offer_status text, is_seed boolean DEFAULT false, customer_id uuid, helper_id uuid,
  category text, parish text, title text, description text, location text, latitude float8, longitude float8, budget numeric DEFAULT 50,
  is_urgent boolean DEFAULT false, credential_tier integer NOT NULL DEFAULT 0);
CREATE TABLE public.saved_searches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, name text, created_at timestamptz DEFAULT now(),
  notify_enabled boolean, category text, parish text, max_budget numeric, min_budget numeric, query text, location_keyword text, radius_miles numeric,
  last_notified_at timestamptz);
CREATE TABLE public.saved_search_alert_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid, notify_at timestamptz,
  search_name text, matched_search_ids uuid[], UNIQUE (user_id, job_id));
CREATE TABLE public.match_digest_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid, UNIQUE (user_id, job_id));
`);
await db.exec(readFileSync(MIG_DIR + POLICY_FILE, "utf8"));
for (const fn of ["early_access_visible_at", "job_announceable_to", "notify_saved_searches_on_new_job", "deliver_saved_search_alert",
  "job_match_digest_rows"]) {
  // check_function_bodies off: job_announceable_to (read only by the dropped
  // job_match_digest_rows) names columns and helpers this fixture leaves out.
  await db.exec(`SET check_function_bodies = off; ${definitionBefore(fn, NEW_FILE)} SET check_function_bodies = on;`);
}
const q = async (s, p = []) => (await db.query(s, p)).rows;
const policyBefore = (await q(`SELECT count(*)::int n FROM public.cron_catchup_policy`))[0].n;

if (!RED) {
  const sql = readFileSync(MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check("migration applies 3x", true);
}

// ── 1. the cron and its bookkeeping are gone; nothing else is touched ─────
const jobs = (await q(`SELECT jobname FROM cron.job ORDER BY 1`)).map((r) => r.jobname);
check("daily-match-digest is unscheduled; the other two digests stay",
  JSON.stringify(jobs) === JSON.stringify(["ops-daily-digest", "sweep-daily-job-digest"]), jobs.join(","));
const policy = (await q(`SELECT jobname FROM public.cron_catchup_policy`)).map((r) => r.jobname);
check("its catch-up policy row is gone, every other row stays",
  !policy.includes("daily-match-digest") && policy.length === policyBefore - 1 && policy.includes("sweep-daily-job-digest"),
  `${policyBefore} -> ${policy.length}`);
const expect = (await q(`SELECT jobname FROM public.cron_work_expectations ORDER BY 1`)).map((r) => r.jobname);
check("its work expectation is gone (sweep_dead_crons would page 'unscheduled')",
  JSON.stringify(expect) === JSON.stringify(["ops-daily-digest", "sweep-daily-job-digest"]), expect.join(","));
const rowsFn = (await q(`SELECT to_regprocedure('public.job_match_digest_rows(uuid[])') IS NULL AS gone`))[0].gone;
check("job_match_digest_rows is dropped", rowsFn === true);

// ── 2. a member left in digest mode is told like everyone else ────────────
for (const id of [POSTER, DIGEST, PLAIN]) await q(`INSERT INTO public.profiles VALUES ($1, true, 'active', 'Acadia', null, null)`, [id]);
await q(`INSERT INTO public.notification_preferences VALUES ($1, true, true), ($2, true, false)`, [DIGEST, PLAIN]);
await q(`INSERT INTO public.saved_searches (user_id, name, notify_enabled) VALUES ($1, 'all', true), ($2, 'all', true)`, [DIGEST, PLAIN]);
await db.exec(`CREATE TRIGGER t AFTER INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_saved_searches_on_new_job();`);
const fund = async (title) => (await q(
  `INSERT INTO public.jobs (status, payment_status, customer_id, category, parish, title, created_at)
   VALUES ('open','escrow',$1,'cleaning','Acadia',$2, now() - interval '1 day') RETURNING id`, [POSTER, title]))[0].id;
const j1 = await fund("first");
const queued = async (u) => (await q(`SELECT count(*)::int n FROM public.saved_search_alert_queue WHERE user_id = $1`, [u]))[0].n;
const parked = async (u) => (await q(`SELECT count(*)::int n FROM public.match_digest_queue WHERE user_id = $1`, [u]))[0].n;
check("the digest-mode member's match is queued for the alert sweep, not parked in the digest queue",
  (await queued(DIGEST)) === 1 && (await parked(DIGEST)) === 0, `alert ${await queued(DIGEST)}, digest ${await parked(DIGEST)}`);
check("an ordinary member's match is queued too", (await queued(PLAIN)) === 1);

const deliver = async (u, j) => {
  const ids = (await q(`SELECT array_agg(id) a FROM public.saved_searches WHERE user_id = $1`, [u]))[0].a;
  return (await q(`SELECT public.deliver_saved_search_alert($1, $2, 'all', $3::uuid[]) AS ok`, [u, j, ids]))[0].ok;
};
// Push it past the queue (as the sweep would) to the sender, digest flag still on.
const sent = await deliver(DIGEST, j1);
const told = (await q(`SELECT count(*)::int n FROM public.notifications WHERE user_id = $1`, [DIGEST]))[0].n;
check("deliver_saved_search_alert sends to the digest-mode member instead of diverting", sent === true && told === 1, `sent ${sent}, notifications ${told}`);
check("and nothing was parked in the digest queue on the way", (await parked(DIGEST)) === 0);

// ── 3. the hourly throttle now binds every match (ST-011) ─────────────────
await deliver(PLAIN, j1);
await fund("second, minutes later");
check("a second match inside the hour is throttled for both members (no digest exemption)",
  (await queued(DIGEST)) === 1 && (await queued(PLAIN)) === 1 && (await parked(DIGEST)) === 0,
  `digest-mode ${await queued(DIGEST)}/${await parked(DIGEST)}, plain ${await queued(PLAIN)}`);

// ── 4. privileges: still service-only ────────────────────────────────────
if (!RED) {
  const acl = (await q(`SELECT
      has_function_privilege('anon', 'public.deliver_saved_search_alert(uuid,uuid,text,uuid[])', 'EXECUTE') a1,
      has_function_privilege('authenticated', 'public.deliver_saved_search_alert(uuid,uuid,text,uuid[])', 'EXECUTE') a2,
      has_function_privilege('anon', 'public.notify_saved_searches_on_new_job()', 'EXECUTE') a3,
      has_function_privilege('authenticated', 'public.notify_saved_searches_on_new_job()', 'EXECUTE') a4,
      has_function_privilege('service_role', 'public.deliver_saved_search_alert(uuid,uuid,text,uuid[])', 'EXECUTE') s1`))[0];
  check("neither function is callable by anon or authenticated; service_role keeps EXECUTE",
    !acl.a1 && !acl.a2 && !acl.a3 && !acl.a4 && acl.s1, JSON.stringify(acl));
}

console.log(failures ? `\n${failures} FAIL` : "\nall PASS");
process.exit(failures ? 1 : 0);
