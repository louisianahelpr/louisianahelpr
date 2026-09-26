#!/usr/bin/env node
/**
 * PGlite proof for 20260926041132_parish_match_alerts_wait_for_early_access
 * (Q225 / V-008, the parish job-match half).
 *
 *   node src/test/pglite/parishMatchAlertsWaitForEarlyAccess.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/parishMatchAlertsWaitForEarlyAccess.pglite.mjs  # RED: the previous fan-out
 *
 * Base: the V-008 saved-search migration (20260925053412, live on prod) plus
 * notify_helpers_on_job_post's newest definition from BEFORE the new migration
 * (20260924220318, live on prod 2026-09-26, measured: it sent 'New job in your
 * parish' to a free account at the instant of funding). GREEN applies the new
 * migration 3x (replay-safety). "Time passing" = moving jobs.created_at back.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE_FILE = "20260925053412_saved_search_alerts_wait_for_early_access.sql";
const NEW_FILE = "20260926041132_parish_match_alerts_wait_for_early_access.sql";
const RED = process.env.NEW_MIGRATION === "skip";
if (RED) console.log("NEW_MIGRATION=skip: running the PREVIOUS fan-out (expect FAILs)");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( in migrations sorting before `before`, any dollar tag. */
function previousDefinition(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = { file: f, text: rest.slice(0, end + tag[1].length) + ";" };
    }
  }
  if (!last) throw new Error(`no previous definition of ${name}`);
  return last;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "33333333-0000-0000-0000-000000000000";
const U = {
  free: "33333333-0000-0000-0000-000000000001",
  basic: "33333333-0000-0000-0000-000000000002",
  pro: "33333333-0000-0000-0000-000000000003",
  plus: "33333333-0000-0000-0000-000000000004",
  elite: "33333333-0000-0000-0000-000000000005",
  capped: "33333333-0000-0000-0000-000000000006",
  digestLater: "33333333-0000-0000-0000-000000000007",
};
const TIER = { free: null, basic: "basic", pro: "pro", plus: "plus", elite: "elite", capped: null, digestLater: null };
const name = (id) => Object.keys(U).find((k) => U[k] === id);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA net; CREATE SCHEMA vault; CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE net.calls (body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls VALUES (body); SELECT 1::bigint $$;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url','http://x'),('service_role_key','k');
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.miles_between(a float8,b float8,c float8,d float8) RETURNS float8 LANGUAGE sql AS $$ SELECT 0::float8 $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, email_verified boolean, ban_status text, latitude float8, longitude float8, parish text,
  subscription_tier text, subscription_expires_at timestamptz);
CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, job_matches boolean, match_digest_mode boolean);
CREATE TABLE public.saved_searches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, name text, created_at timestamptz DEFAULT now(),
  notify_enabled boolean, category text, parish text, max_budget numeric, min_budget numeric, query text, location_keyword text, radius_miles numeric, last_notified_at timestamptz);
CREATE TABLE public.match_digest_queue (user_id uuid, job_id uuid, UNIQUE (user_id, job_id));
CREATE TABLE public.notifications (user_id uuid, title text, message text, type text, link text, job_id uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), status text, payment_status text,
  offered_to_helper_id uuid, direct_offer_status text, is_seed boolean DEFAULT false, is_urgent boolean, customer_id uuid, helper_id uuid, category text, parish text,
  budget numeric, title text, description text, location text, latitude float8, longitude float8, credential_tier integer NOT NULL DEFAULT 0);
CREATE TABLE public.applications (helper_id uuid);
CREATE TABLE public.cred (user_id uuid PRIMARY KEY, tier integer);
CREATE FUNCTION public.get_user_credential_tier(p_user_id uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT tier FROM public.cred WHERE user_id = p_user_id $$;
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, expected_max_gap interval, note text);
CREATE TABLE public.error_logs (severity text CHECK (severity IN ('info','warning','error','fatal')), message text, tags jsonb);
`);
await db.exec(`INSERT INTO auth.users VALUES ('${POSTER}')`);
await db.query(`INSERT INTO public.profiles VALUES ($1, true, 'active', null, null, 'Orleans', null, null)`, [POSTER]);
for (const [k, id] of Object.entries(U)) {
  await db.query(`INSERT INTO auth.users VALUES ($1)`, [id]);
  await db.query(`INSERT INTO public.profiles VALUES ($1, true, 'active', null, null, 'Orleans', $2, null)`, [id, TIER[k]]);
  await db.query(`INSERT INTO public.notification_preferences VALUES ($1, true, false)`, [id]);
  await db.query(`INSERT INTO public.applications VALUES ($1)`, [id]); // a parish candidate: has applied before
}

// Base: the live V-008 migration, then the live (previous) fan-out.
await db.exec(readFileSync(MIG_DIR + BASE_FILE, "utf8"));
await db.exec(previousDefinition("notify_helpers_on_job_post", NEW_FILE).text);
if (!RED) {
  const sql = readFileSync(MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  console.log("applied the new migration 3x");
}
await db.exec(`CREATE TRIGGER t AFTER INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_helpers_on_job_post();`);

const q = async (s, p = []) => (await db.query(s, p)).rows;
const sweep = async () => (await q(`SELECT public.sweep_saved_search_alert_queue() AS n`))[0].n;
const parishFor = async (id, jobId) =>
  (await q(`SELECT count(*)::int n FROM public.notifications WHERE user_id = $1 AND job_id = $2 AND title = 'New job in your parish'`, [id, jobId]))[0].n;
const ageJob = (jobId, minutes) =>
  db.query(`UPDATE public.jobs SET created_at = now() - make_interval(mins => $2) WHERE id = $1`, [jobId, minutes]);
const postJob = async (title) =>
  (await q(`INSERT INTO public.jobs (status, payment_status, customer_id, category, parish, budget, title)
            VALUES ('open','escrow',$1,'cleaning','Orleans',50,$2) RETURNING id`, [POSTER, title]))[0].id;
const queueOpen = async () => (await q(`SELECT to_regclass('public.parish_match_alert_queue') IS NOT NULL AS ok`))[0].ok;

// ── 1. nobody is told at funding ───────────────────────────────────────────
const job1 = await postJob("Pressure wash a driveway");
for (const k of ["free", "basic", "pro", "plus", "elite"]) {
  const n = await parishFor(U[k], job1);
  check(`${k}: no parish alert at funding (it runs inside the funding write; free sees the job 20 min later)`, n === 0, `notified ${n}`);
}
const queued = (await queueOpen())
  ? await q(`SELECT user_id, round(extract(epoch FROM notify_at - j.created_at) / 60)::int AS delay
               FROM public.parish_match_alert_queue qq JOIN public.jobs j ON j.id = qq.job_id WHERE qq.job_id = $1`, [job1])
  : [];
const delayOf = (id) => queued.find((r) => r.user_id === id)?.delay;
check("queue: notify_at = created_at + early-access delay per tier",
  delayOf(U.elite) === 0 && delayOf(U.plus) === 5 && delayOf(U.pro) === 10 && delayOf(U.basic) === 15 && delayOf(U.free) === 20,
  JSON.stringify(queued.map((r) => [name(r.user_id), r.delay])));

// ── 2. the sweep sends each one when it becomes visible, once ──────────────
await sweep();
check("elite: alerted by the first sweep", (await parishFor(U.elite, job1)) === 1);
check("free: still waiting after the first sweep", (await parishFor(U.free, job1)) === 0);
await ageJob(job1, 11);
await sweep(); await sweep();
check("t+11m: plus and pro alerted exactly once", (await parishFor(U.plus, job1)) === 1 && (await parishFor(U.pro, job1)) === 1);
check("t+11m: basic and free still waiting", (await parishFor(U.basic, job1)) + (await parishFor(U.free, job1)) === 0);
await ageJob(job1, 21);
await sweep(); await sweep();
check("t+21m: basic and free alerted exactly once", (await parishFor(U.basic, job1)) === 1 && (await parishFor(U.free, job1)) === 1);
const msg = (await q(`SELECT title, message, type, link, job_id FROM public.notifications WHERE user_id = $1 AND job_id = $2`, [U.free, job1]))[0];
check("same content as the immediate alert, and it carries its job",
  msg?.message === 'A new cleaning job just posted in Orleans Parish: "Pressure wash a driveway"' && msg?.type === "job_match"
    && msg?.link === `/home?job=${job1}` && msg?.job_id === job1, JSON.stringify(msg));
const mail = (await q(`SELECT body FROM net.calls WHERE body->>'user_id' = $1 AND body->>'link' = $2`, [U.free, `/home?job=${job1}`])).map((r) => r.body);
check("one email with the in-app alert, naming the job", mail.length === 1 && mail[0].job_id === job1, JSON.stringify(mail));
check("queue drained", (await queueOpen()) && (await q(`SELECT count(*)::int n FROM public.parish_match_alert_queue`))[0].n === 0);

// ── 3. send-time re-checks ─────────────────────────────────────────────────
const job2 = await postJob("Hang a ceiling fan");
await db.query(`UPDATE public.jobs SET status = 'accepted' WHERE id = $1`, [job2]);
await ageJob(job2, 25);
await sweep();
const about2 = (await q(`SELECT count(*)::int n FROM public.notifications WHERE job_id = $1`, [job2]))[0].n;
check("job hired before it became visible: nobody alerted, elite included", about2 === 0, `alerts ${about2}`);

const job3 = await postJob("Clean gutters");
// A saved-search alert for this job reached free first: N-007 once per job.
await db.query(`INSERT INTO public.notifications (user_id, title, type, link, job_id) VALUES ($1, 'New job matches your saved search', 'job_match', $2, $3)`,
  [U.free, `/home?job=${job3}`, job3]);
// capped: already at the hourly job-match cap.
for (let i = 0; i < 10; i++) {
  await db.query(`INSERT INTO public.notifications (user_id, title, type, created_at) VALUES ($1, 'x', 'job_match', now() - interval '10 minutes')`, [U.capped]);
}
// digestLater: switched to the daily digest while waiting.
await db.query(`UPDATE public.notification_preferences SET match_digest_mode = true WHERE user_id = $1`, [U.digestLater]);
await ageJob(job3, 21);
await sweep();
check("already told about this job by a saved search: no second job_match", (await parishFor(U.free, job3)) === 0);
check("hourly cap reached while waiting: not sent", (await parishFor(U.capped, job3)) === 0);
check("switched to digest while waiting: not sent", (await parishFor(U.digestLater, job3)) === 0);
check("everyone else is sent", (await parishFor(U.basic, job3)) === 1 && (await parishFor(U.elite, job3)) === 1);

// ── 4. authz: nothing new is reachable by a client role ────────────────────
if (await queueOpen()) {
  const [g] = await q(`SELECT
      has_table_privilege('anon', 'public.parish_match_alert_queue', 'SELECT') OR has_table_privilege('authenticated', 'public.parish_match_alert_queue', 'SELECT')
        OR has_table_privilege('authenticated', 'public.parish_match_alert_queue', 'INSERT') AS table_open,
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.parish_match_alert_queue'::regclass) AS rls,
      has_function_privilege('authenticated', 'public.deliver_parish_match_alert(uuid,uuid)', 'EXECUTE')
        OR has_function_privilege('anon', 'public.deliver_parish_match_alert(uuid,uuid)', 'EXECUTE') AS deliver_open,
      has_function_privilege('authenticated', 'public.notify_helpers_on_job_post()', 'EXECUTE') AS fanout_open`);
  check("queue: RLS on, no client table privilege", g.rls === true && g.table_open === false, JSON.stringify(g));
  check("deliver / fan-out: no client EXECUTE", !g.deliver_open && !g.fanout_open, JSON.stringify(g));
} else check("authz on new objects", false, "no parish queue");

console.log(failures ? `\n${failures} FAIL` : "\nall PASS");
process.exit(failures ? 1 : 0);
