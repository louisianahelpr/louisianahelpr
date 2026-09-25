#!/usr/bin/env node
/**
 * PGlite proof for 20260925053412_saved_search_alerts_wait_for_early_access (V-008).
 *
 *   node src/test/pglite/savedSearchAlertsWaitForEarlyAccess.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/savedSearchAlertsWaitForEarlyAccess.pglite.mjs  # RED: the previous definitions
 *
 * The previous state is each function's newest definition from BEFORE the new
 * migration, parsed out of supabase/migrations (notify_saved_searches_on_new_job
 * from 20260924220318, early_access_cutoff from 20260905221158): the bodies
 * live on prod on 2026-09-25. GREEN applies the new migration 3x on top of that
 * (replay-safety). Minimal fixture: only the columns the functions read.
 * net.http_post records calls; vault is a two-row table; auth.uid() reads
 * request.jwt.claim.sub. "Time passing" is simulated by moving jobs.created_at
 * back, which is exactly the input visible_at is computed from.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20260925053412_saved_search_alerts_wait_for_early_access.sql";
const RED = process.env.NEW_MIGRATION === "skip";
if (RED) console.log("NEW_MIGRATION=skip: running the PREVIOUS definitions (expect FAILs)");

/** The newest `CREATE OR REPLACE FUNCTION public.<name>(` statement in migrations before `before`. */
function previousDefinition(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
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

const POSTER = "22222222-0000-0000-0000-000000000000";
const U = {
  free: "22222222-0000-0000-0000-000000000001",
  basic: "22222222-0000-0000-0000-000000000002",
  pro: "22222222-0000-0000-0000-000000000003",
  plus: "22222222-0000-0000-0000-000000000004",
  elite: "22222222-0000-0000-0000-000000000005",
  lapsed: "22222222-0000-0000-0000-000000000006",
  digest: "22222222-0000-0000-0000-000000000007",
};
const TIER = { free: null, basic: "basic", pro: "pro", plus: "plus", elite: "elite", lapsed: "plus", digest: null };

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
CREATE TABLE public.notifications (user_id uuid, title text, message text, type text, link text);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), status text, payment_status text,
  offered_to_helper_id uuid, direct_offer_status text, is_seed boolean DEFAULT false, is_urgent boolean, customer_id uuid, category text, parish text,
  budget numeric, title text, description text, location text, latitude float8, longitude float8);
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, expected_max_gap interval, note text);
CREATE TABLE public.error_logs (severity text CHECK (severity IN ('info','warning','error','fatal')), message text, tags jsonb);
`);
await db.exec(`INSERT INTO auth.users VALUES ('${POSTER}')`);
for (const [k, id] of Object.entries(U)) {
  await db.query(`INSERT INTO auth.users VALUES ($1)`, [id]);
  await db.query(
    `INSERT INTO public.profiles VALUES ($1, true, 'active', null, null, 'Orleans', $2, $3)`,
    [id, TIER[k], k === "lapsed" ? new Date(Date.now() - 86400000).toISOString() : null],
  );
  await db.query(`INSERT INTO public.notification_preferences VALUES ($1, true, $2)`, [id, k === "digest"]);
  await db.query(`INSERT INTO public.saved_searches (user_id, name, notify_enabled) VALUES ($1, 'all', true)`, [id]);
}

await db.exec(previousDefinition("early_access_cutoff", NEW_FILE).text);
await db.exec(previousDefinition("notify_saved_searches_on_new_job", NEW_FILE).text);
if (!RED) {
  const sql = readFileSync(MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  console.log("applied the new migration 3x");
}
await db.exec(`CREATE TRIGGER t AFTER INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_saved_searches_on_new_job();`);

const q = async (s, p = []) => (await db.query(s, p)).rows;
const has = async (sig) => (await q(`SELECT to_regprocedure($1) IS NOT NULL AS ok`, [sig]))[0].ok;
const sweep = async () => ((await has("public.sweep_saved_search_alert_queue()"))
  ? (await q(`SELECT public.sweep_saved_search_alert_queue() AS n`))[0].n
  : null);
const notified = async (id) => (await q(`SELECT count(*)::int n FROM public.notifications WHERE user_id = $1`, [id]))[0].n;
const ageJob = (jobId, minutes) =>
  db.query(`UPDATE public.jobs SET created_at = now() - make_interval(mins => $2) WHERE id = $1`, [jobId, minutes]);
const postJob = async (title, urgent = false) =>
  (await q(`INSERT INTO public.jobs (status, payment_status, customer_id, category, parish, budget, title, is_urgent)
            VALUES ('open','escrow',$1,'cleaning','Orleans',50,$2,$3) RETURNING id`, [POSTER, title, urgent]))[0].id;

// ── 1. at INSERT only the tier whose delay is 0 is told ─────────────────────
const job1 = await postJob("Pressure wash a driveway");
for (const k of ["free", "basic", "pro", "plus", "lapsed"]) {
  check(`${k}: no alert at INSERT (job not yet in their feed)`, (await notified(U[k])) === 0, `notified ${await notified(U[k])}`);
}
check("elite: alerted at INSERT (delay 0 — in their feed now)", (await notified(U.elite)) === 1, `notified ${await notified(U.elite)}`);
check("digest-mode user: queued for the daily digest, as before",
  (await q(`SELECT count(*)::int n FROM public.match_digest_queue WHERE user_id = $1`, [U.digest]))[0].n === 1);
const queued = RED ? [] : await q(`SELECT user_id, round(extract(epoch FROM notify_at - j.created_at) / 60)::int AS delay
                                     FROM public.saved_search_alert_queue qq JOIN public.jobs j ON j.id = qq.job_id ORDER BY 2`);
const delayOf = (id) => queued.find((r) => r.user_id === id)?.delay;
check("queue: notify_at = created_at + (20 - tier minutes) for each waiting user",
  delayOf(U.plus) === 5 && delayOf(U.pro) === 10 && delayOf(U.basic) === 15 && delayOf(U.free) === 20 && delayOf(U.lapsed) === 20,
  JSON.stringify(queued.map((r) => [Object.keys(U).find((k) => U[k] === r.user_id), r.delay])));

// ── 2. the sweep sends exactly the ones now visible, once ──────────────────
check("sweep exists", (await sweep()) !== null);
await ageJob(job1, 11); // plus (5) and pro (10) are visible, basic (15), free/lapsed (20) not
await sweep();
await sweep(); // a second run finds nothing new: no double send
check("t+11m: plus and pro alerted exactly once", (await notified(U.plus)) === 1 && (await notified(U.pro)) === 1,
  `plus ${await notified(U.plus)} pro ${await notified(U.pro)}`);
check("t+11m: basic, free, lapsed still waiting", (await notified(U.basic)) + (await notified(U.free)) + (await notified(U.lapsed)) === 0);
await ageJob(job1, 21);
await sweep();
check("t+21m: basic, free, lapsed alerted once each",
  (await notified(U.basic)) === 1 && (await notified(U.free)) === 1 && (await notified(U.lapsed)) === 1);
check("queue drained", RED ? false : (await q(`SELECT count(*)::int n FROM public.saved_search_alert_queue`))[0].n === 0);
const msg = await q(`SELECT title, message, type, link FROM public.notifications WHERE user_id = $1`, [U.free]);
check("deferred alert has the same content as an immediate one",
  msg[0]?.title === "New job matches your saved search" && msg[0]?.message === 'A new job matches "all": Pressure wash a driveway ($50)'
    && msg[0]?.type === "job_match" && msg[0]?.link === `/home?job=${job1}`, JSON.stringify(msg[0]));
const emails = (await q(`SELECT count(*)::int n FROM net.calls WHERE body->>'type' = 'job_match'`))[0].n;
check("one email per in-app alert", emails === 6, `emails ${emails}`);
const stamps = (await q(`SELECT count(*)::int n FROM public.saved_searches WHERE last_notified_at IS NOT NULL`))[0].n;
check("ST-011: throttle stamped for the 6 notified users, not the digest user", stamps === 6, `stamped ${stamps}`);

// ── 3. a job that stops being open before notify_at is never alerted ───────
await db.exec(`UPDATE public.saved_searches SET last_notified_at = NULL`);
const job2 = await postJob("Hang a ceiling fan");
await db.query(`UPDATE public.jobs SET status = 'accepted' WHERE id = $1`, [job2]);
await ageJob(job2, 25);
await sweep();
const about2 = (await q(`SELECT count(*)::int n FROM public.notifications WHERE link = $1`, [`/home?job=${job2}`]))[0].n;
check("job hired before visible: waiting users never alerted (elite was, at INSERT)", about2 === 1, `alerts ${about2}`);
check("its queue rows are gone", RED ? false : (await q(`SELECT count(*)::int n FROM public.saved_search_alert_queue`))[0].n === 0);
const stamped2 = (await q(`SELECT count(*)::int n FROM public.saved_searches WHERE last_notified_at IS NOT NULL`))[0].n;
check("ST-011: a dropped alert spends no throttle (only elite stamped)", stamped2 === 1, `stamped ${stamped2}`);

// ── 4. deleted job cascades; throttle spent meanwhile drops the alert ──────
await db.exec(`UPDATE public.saved_searches SET last_notified_at = NULL`);
const job3 = await postJob("Mow a lawn");
if (!RED) {
  await db.query(`DELETE FROM public.jobs WHERE id = $1`, [job3]);
  check("job deleted before visible: queue rows cascade away",
    (await q(`SELECT count(*)::int n FROM public.saved_search_alert_queue WHERE job_id = $1`, [job3]))[0].n === 0);
} else check("job deleted before visible: queue rows cascade away", false, "no queue");
const job4 = await postJob("Clean gutters");
await db.query(`UPDATE public.saved_searches SET last_notified_at = now() - interval '5 minutes' WHERE user_id = $1`, [U.free]);
await ageJob(job4, 21);
await sweep();
const free4 = (await q(`SELECT count(*)::int n FROM public.notifications WHERE user_id = $1 AND link = $2`, [U.free, `/home?job=${job4}`]))[0].n;
check("ST-011: a search notified within the hour is not alerted again when its row comes due", free4 === 0, `alerts ${free4}`);

// ── 4b. one send that raises is logged; the rest of the run still sends ────
await db.exec(`UPDATE public.saved_searches SET last_notified_at = NULL`);
const job5 = await postJob("Paint a fence");
await db.exec(`CREATE OR REPLACE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE plpgsql AS $$
  BEGIN
    IF body->>'user_id' = '${U.basic}' THEN RAISE EXCEPTION 'simulated pg_net failure'; END IF;
    INSERT INTO net.calls VALUES (body); RETURN 1;
  END $$;`);
await ageJob(job5, 21);
const sent5 = await sweep();
const got5 = async (k) => (await q(`SELECT count(*)::int n FROM public.notifications WHERE user_id = $1 AND link = $2`, [U[k], `/home?job=${job5}`]))[0].n;
check("a raising send: every other waiting user is still alerted in the same run",
  sent5 === 4 && (await got5("free")) === 1 && (await got5("pro")) === 1 && (await got5("plus")) === 1 && (await got5("lapsed")) === 1,
  `sent ${sent5}`);
check("a raising send: its notification and throttle stamp roll back, not the run's",
  (await got5("basic")) === 0
    && (await q(`SELECT count(*)::int n FROM public.saved_searches WHERE user_id = $1 AND last_notified_at IS NOT NULL`, [U.basic]))[0].n === 0);
const logged5 = await q(`SELECT severity, tags->>'source' AS src FROM public.error_logs`);
check("a raising send is logged to error_logs once", logged5.length === 1 && logged5[0].src === "saved-search-alert-queue" && logged5[0].severity === "error",
  JSON.stringify(logged5));
check("a raising send does not stay queued to raise every minute",
  RED ? false : (await q(`SELECT count(*)::int n FROM public.saved_search_alert_queue`))[0].n === 0);
await db.exec(`CREATE OR REPLACE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls VALUES (body); SELECT 1::bigint $$;`);

// ── 5. the feed and the alert delay agree for every tier ───────────────────
if (!RED) {
  let mismatches = 0;
  for (const [k, id] of Object.entries(U)) {
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [id]);
    for (let m = 0; m <= 25; m++) {
      const [r] = await q(`SELECT (now() - make_interval(mins => $2)) <= public.early_access_cutoff() AS feed,
                                  public.early_access_visible_at($1, now() - make_interval(mins => $2)) <= now() AS alert`, [id, m]);
      if (r.feed !== r.alert) { mismatches++; console.log(`   mismatch ${k} at ${m}m: feed ${r.feed} alert ${r.alert}`); }
    }
  }
  check("parity: created_at <= early_access_cutoff() iff early_access_visible_at() <= now(), every tier, 0..25 min", mismatches === 0);
  await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  const anonCut = (await q(`SELECT round(extract(epoch FROM now() - public.early_access_cutoff()) / 60)::int AS m`))[0].m;
  check("anonymous caller: cutoff is the full 20 minutes", anonCut === 20, `${anonCut}`);
} else check("parity: feed and alert delay agree", false, "no early_access_visible_at");

// ── 6. authz: nothing new is reachable by a client role ────────────────────
if (!RED) {
  const [g] = await q(`SELECT
      has_table_privilege('anon', 'public.saved_search_alert_queue', 'SELECT') OR has_table_privilege('authenticated', 'public.saved_search_alert_queue', 'SELECT')
        OR has_table_privilege('authenticated', 'public.saved_search_alert_queue', 'INSERT') AS table_open,
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.saved_search_alert_queue'::regclass) AS rls,
      has_function_privilege('authenticated', 'public.deliver_saved_search_alert(uuid,uuid,text,uuid[])', 'EXECUTE')
        OR has_function_privilege('anon', 'public.deliver_saved_search_alert(uuid,uuid,text,uuid[])', 'EXECUTE') AS deliver_open,
      has_function_privilege('authenticated', 'public.sweep_saved_search_alert_queue()', 'EXECUTE') AS sweep_open,
      has_function_privilege('authenticated', 'public.early_access_delay_minutes(uuid)', 'EXECUTE')
        OR has_function_privilege('anon', 'public.early_access_delay_minutes(uuid)', 'EXECUTE') AS ladder_open,
      has_function_privilege('anon', 'public.early_access_visible_at(uuid,timestamptz)', 'EXECUTE') AS visible_open,
      (SELECT count(*)::int FROM public.cron_work_expectations WHERE jobname = 'saved-search-alert-queue') AS liveness`);
  check("queue: RLS on, no client table privilege", g.rls === true && g.table_open === false, JSON.stringify(g));
  check("deliver / sweep / ladder / visible_at: no client EXECUTE",
    !g.deliver_open && !g.sweep_open && !g.ladder_open && !g.visible_open);
  check("liveness row registered once", g.liveness === 1);
} else check("authz on new objects", false, "no new objects");

console.log(failures ? `\n${failures} FAIL` : "\nall PASS");
process.exit(failures ? 1 : 0);
