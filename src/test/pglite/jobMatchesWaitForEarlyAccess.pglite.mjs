#!/usr/bin/env node
/**
 * PGlite proof for 20260925231704_job_matches_wait_for_early_access (Q392).
 *
 *   node src/test/pglite/jobMatchesWaitForEarlyAccess.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/jobMatchesWaitForEarlyAccess.pglite.mjs  # RED: the previous definitions
 *
 * The previous state is each function's newest definition from BEFORE the new
 * migration, parsed out of supabase/migrations (notify_helpers_on_job_post and
 * sweep_daily_job_digest from 20260924220318; early_access_delay_minutes and
 * early_access_visible_at from 20260925053412). There was no SQL instant-match
 * path before: instant-job-match inserted its notifications directly, so on
 * RED every instant check fails for want of enqueue_instant_job_match. GREEN
 * applies the new migration 3x on top (replay-safety). Minimal fixture: only
 * the columns the functions read. "Time passing" is simulated by moving
 * jobs.created_at back, which is exactly the input visible_at reads.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20260925231704_job_matches_wait_for_early_access.sql";
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

const POSTER = "33333333-0000-0000-0000-000000000000";
const U = {
  free: "33333333-0000-0000-0000-000000000001",
  basic: "33333333-0000-0000-0000-000000000002",
  pro: "33333333-0000-0000-0000-000000000003",
  plus: "33333333-0000-0000-0000-000000000004",
  elite: "33333333-0000-0000-0000-000000000005",
  lapsed: "33333333-0000-0000-0000-000000000006",
  digest: "33333333-0000-0000-0000-000000000007",
  muted: "33333333-0000-0000-0000-000000000008",
  blocked: "33333333-0000-0000-0000-000000000009",
  banned: "33333333-0000-0000-0000-00000000000a",
};
const TIER = { free: null, basic: "basic", pro: "pro", plus: "plus", elite: "elite", lapsed: "plus" };
const name = (id) => Object.keys(U).find((k) => U[k] === id) ?? id;

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
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, email_verified boolean, ban_status text, parish text,
  subscription_tier text, subscription_expires_at timestamptz, is_seed boolean DEFAULT false);
CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, job_matches boolean, match_digest_mode boolean);
CREATE TABLE public.match_digest_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid, created_at timestamptz DEFAULT now(), UNIQUE (user_id, job_id));
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text,
  job_id uuid, read boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), status text, payment_status text,
  offered_to_helper_id uuid, direct_offer_status text, is_seed boolean DEFAULT false, is_urgent boolean, customer_id uuid, helper_id uuid,
  category text, parish text, budget numeric, title text, description text, location text, credential_tier integer NOT NULL DEFAULT 0);
CREATE TABLE public.applications (helper_id uuid, job_id uuid);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.cred (user_id uuid PRIMARY KEY, tier integer);
CREATE FUNCTION public.get_user_credential_tier(p_user_id uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT tier FROM public.cred WHERE user_id = p_user_id $$;
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, expected_max_gap interval, note text);
CREATE TABLE public.error_logs (severity text CHECK (severity IN ('info','warning','error','fatal')), message text, tags jsonb);
CREATE TABLE public.cron_defects (fn text, subject text, err text);
CREATE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.cron_defects VALUES (a, b, c) $$;
`);
await db.query(`INSERT INTO auth.users VALUES ($1)`, [POSTER]);
await db.query(`INSERT INTO public.profiles (user_id, email_verified, ban_status, parish) VALUES ($1, true, 'active', 'Orleans')`, [POSTER]);
for (const [k, id] of Object.entries(U)) {
  await db.query(`INSERT INTO auth.users VALUES ($1)`, [id]);
  await db.query(
    `INSERT INTO public.profiles (user_id, email_verified, ban_status, parish, subscription_tier, subscription_expires_at) VALUES ($1, true, $2, 'Orleans', $3, $4)`,
    [id, k === "banned" ? "banned" : "active", TIER[k] ?? null, k === "lapsed" ? new Date(Date.now() - 86400000).toISOString() : null],
  );
  await db.query(`INSERT INTO public.notification_preferences VALUES ($1, $2, $3)`, [id, k !== "muted", k === "digest"]);
}
await db.query(`INSERT INTO public.user_blocks VALUES ($1, $2)`, [POSTER, U.blocked]);

for (const fn of ["early_access_delay_minutes", "early_access_visible_at", "notify_helpers_on_job_post", "sweep_daily_job_digest"]) {
  await db.exec(previousDefinition(fn, NEW_FILE).text);
}
if (!RED) {
  const sql = readFileSync(MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  console.log("applied the new migration 3x");
}
await db.exec(`CREATE TRIGGER t AFTER INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_helpers_on_job_post();`);

const q = async (s, p = []) => (await db.query(s, p)).rows;
const has = async (sig) => (await q(`SELECT to_regprocedure($1) IS NOT NULL AS ok`, [sig]))[0].ok;
const HAS_ENQUEUE = await has("public.enqueue_instant_job_match(uuid, jsonb)");
const HAS_SWEEP = await has("public.sweep_job_match_queue()");
const sweep = async () => (HAS_SWEEP ? (await q(`SELECT public.sweep_job_match_queue() AS n`))[0].n : null);
const notifiedAbout = async (id, jobId) =>
  (await q(`SELECT count(*)::int n FROM public.notifications WHERE user_id = $1 AND job_id = $2`, [id, jobId]))[0].n;
const ageJob = (jobId, minutes) =>
  db.query(`UPDATE public.jobs SET created_at = now() - make_interval(mins => $2) WHERE id = $1`, [jobId, minutes]);
const postJob = async (title, { parish = null, urgent = false, tier = 0, paid = "escrow" } = {}) =>
  (await q(`INSERT INTO public.jobs (status, payment_status, customer_id, category, parish, budget, title, is_urgent, credential_tier)
            VALUES ('open',$5,$1,'cleaning',$2,50,$3,$4,$6) RETURNING id`, [POSTER, parish, title, urgent, paid, tier]))[0].id;
/** What the edge function sends: scored matches in rank order, with the copy it built. */
const matchesFor = (jobId, ids) =>
  JSON.stringify(ids.map((id) => ({
    user_id: id, title: "🧹 Match for you", message: "Pressure wash in Orleans · $50. Tap to review and apply.", link: `/home?quickApply=${jobId}`,
  })));
const enqueue = async (jobId, ids) =>
  HAS_ENQUEUE ? (await q(`SELECT public.enqueue_instant_job_match($1, $2::jsonb) AS r`, [jobId, matchesFor(jobId, ids)]))[0].r : null;

// ── 1. instant match: only users the job is visible to are told now ───────
const everyone = Object.values(U);
const job1 = await postJob("Pressure wash a driveway");
const r1 = await enqueue(job1, everyone);
check("enqueue_instant_job_match exists (the edge function's only write path)", r1 !== null);
check("elite (0 min delay): told at funding", (await notifiedAbout(U.elite, job1)) === 1);
for (const k of ["free", "basic", "pro", "plus", "lapsed"]) {
  check(`${k}: NOT told at funding (job not yet in their feed)`, (await notifiedAbout(U[k], job1)) === 0);
}
check("enqueue reports every candidate the gate admits, one sent now", r1?.eligible === 10 && r1?.queued === 10 && r1?.sent_now === 1, JSON.stringify(r1));
const n1 = (await q(`SELECT title, message, type, link, job_id FROM public.notifications WHERE user_id = $1`, [U.elite]))[0];
check("the notification is the edge function's copy, type job_match, carrying job_id",
  n1?.title === "🧹 Match for you" && n1?.type === "job_match" && n1?.link === `/home?quickApply=${job1}` && n1?.job_id === job1, JSON.stringify(n1));

// ── 2. re-trigger: nobody is told twice ────────────────────────────────────
const before2 = (await q(`SELECT count(*)::int n FROM public.notifications`))[0].n;
const r2 = await enqueue(job1, everyone);
const r2b = await enqueue(job1, everyone);
const after2 = (await q(`SELECT count(*)::int n FROM public.notifications`))[0].n;
check("re-trigger x2: zero new rows queued, zero new notifications", r2?.queued === 0 && r2b?.queued === 0 && r2?.already === 10 && after2 === before2,
  `r2 ${JSON.stringify(r2)} notifications ${before2}->${after2}`);

// ── 3. the sweep sends each user when the job reaches their feed, once ────
await ageJob(job1, 11);
await sweep();
await sweep();
check("t+11m: plus (5) and pro (10) told exactly once", (await notifiedAbout(U.plus, job1)) === 1 && (await notifiedAbout(U.pro, job1)) === 1);
check("t+11m: basic, free, lapsed still waiting",
  (await notifiedAbout(U.basic, job1)) + (await notifiedAbout(U.free, job1)) + (await notifiedAbout(U.lapsed, job1)) === 0);
await ageJob(job1, 21);
await sweep();
check("t+21m: basic, free, lapsed told once each",
  (await notifiedAbout(U.basic, job1)) === 1 && (await notifiedAbout(U.free, job1)) === 1 && (await notifiedAbout(U.lapsed, job1)) === 1);
check("digest user: routed to the daily digest at send time, no ping",
  (await notifiedAbout(U.digest, job1)) === 0
    && (await q(`SELECT count(*)::int n FROM public.match_digest_queue WHERE user_id = $1 AND job_id = $2`, [U.digest, job1]))[0].n === 1);
check("muted, blocked and banned users: never told",
  (await notifiedAbout(U.muted, job1)) + (await notifiedAbout(U.blocked, job1)) + (await notifiedAbout(U.banned, job1)) === 0);
const states1 = RED ? [] : await q(`SELECT status, count(*)::int n FROM public.job_match_queue WHERE job_id = $1 GROUP BY 1 ORDER BY 1`, [job1]);
check("every row settled and kept (the dedupe ledger): 6 sent, 1 digested, 3 dropped",
  JSON.stringify(states1) === JSON.stringify([{ status: "digested", n: 1 }, { status: "dropped", n: 3 }, { status: "sent", n: 6 }]), JSON.stringify(states1));
await enqueue(job1, everyone);
await sweep();
check("a re-trigger after everything settled: still one notification per user",
  (await q(`SELECT max(c)::int m FROM (SELECT count(*) c FROM public.notifications WHERE job_id = $1 GROUP BY user_id) x`, [job1]))[0].m === 1);

// ── 4. the browse gate, per recipient ──────────────────────────────────────
await db.query(`INSERT INTO public.cred VALUES ($1, 2), ($2, 1)`, [U.pro, U.plus]);
const job2 = await postJob("Rewire a panel", { tier: 2 });
await ageJob(job2, 25);
const r4 = await enqueue(job2, [U.free, U.plus, U.pro]);
const who4 = (await q(`SELECT user_id FROM public.notifications WHERE job_id = $1`, [job2])).map((r) => name(r.user_id));
check("credential_tier 2 job: only the tier-2 user is queued and told (open_jobs_browse gate)",
  r4?.eligible === 1 && who4.length === 1 && who4[0] === "pro", `${JSON.stringify(r4)} told ${JSON.stringify(who4)}`);

const job3 = await postJob("Fix a porch step");
await db.query(`UPDATE public.jobs SET customer_id = NULL WHERE id = $1`, [job3]);
await ageJob(job3, 25);
const r5 = await enqueue(job3, everyone);
check("ownerless job (poster deleted): nobody queued or told",
  r5?.eligible === 0 && (await q(`SELECT count(*)::int n FROM public.notifications WHERE job_id = $1`, [job3]))[0].n === 0, JSON.stringify(r5));

const job4 = await postJob("Mow a lawn");
await enqueue(job4, [U.free, U.basic]);
await db.query(`UPDATE public.jobs SET customer_id = NULL WHERE id = $1`, [job4]);
await ageJob(job4, 25);
await sweep();
check("poster deletes their account while matches wait: they are dropped unsent",
  (await q(`SELECT count(*)::int n FROM public.notifications WHERE job_id = $1`, [job4]))[0].n === 0
    && (RED ? false : (await q(`SELECT count(*)::int n FROM public.job_match_queue WHERE job_id = $1 AND status = 'dropped'`, [job4]))[0].n === 2));

const job5 = await postJob("Hang a ceiling fan");
await enqueue(job5, [U.free]);
await db.query(`UPDATE public.jobs SET status = 'accepted' WHERE id = $1`, [job5]);
await ageJob(job5, 25);
await sweep();
check("job hired before the free user's turn: never told", (await notifiedAbout(U.free, job5)) === 0);

const job6 = await postJob("Unpaid job", { paid: "pending" });
await ageJob(job6, 25);
const r6 = await enqueue(job6, everyone);
check("unfunded job: nobody queued", r6?.eligible === 0, JSON.stringify(r6));

// ── 5. top 20, counted over re-triggers ────────────────────────────────────
const many = [];
for (let i = 0; i < 25; i++) {
  const id = `44444444-0000-0000-0000-${String(i).padStart(12, "0")}`;
  many.push(id);
  await db.query(`INSERT INTO auth.users VALUES ($1)`, [id]);
  await db.query(`INSERT INTO public.profiles (user_id, email_verified, ban_status, parish) VALUES ($1, true, 'active', 'Orleans')`, [id]);
}
const job7 = await postJob("Move a couch");
const r7 = await enqueue(job7, many);
const r7b = await enqueue(job7, many);
check("25 eligible matches: the top 20 are queued; a re-trigger reaches nobody past them",
  r7?.queued === 20 && r7b?.queued === 0 && r7b?.already === 20
    && (RED ? false : (await q(`SELECT count(*)::int n FROM public.job_match_queue WHERE job_id = $1`, [job7]))[0].n === 20),
  `${JSON.stringify(r7)} ${JSON.stringify(r7b)}`);

// ── 6. the parish fan-out waits for early access too ───────────────────────
for (const k of ["free", "pro", "elite"]) await db.query(`INSERT INTO public.applications VALUES ($1, null)`, [U[k]]);
await db.exec(`DELETE FROM net.calls`);
const job8 = await postJob("Clean gutters", { parish: "Orleans" });
check("parish: elite told inline at funding", (await notifiedAbout(U.elite, job8)) === 1);
check("parish: free and pro NOT told at funding", (await notifiedAbout(U.free, job8)) + (await notifiedAbout(U.pro, job8)) === 0);
await enqueue(job8, [U.elite, U.free, U.pro]);
check("instant match after the parish fan-out: elite is not told twice", (await notifiedAbout(U.elite, job8)) === 1);
await ageJob(job8, 21);
await sweep();
check("parish: free and pro told once each when the job reaches their feed",
  (await notifiedAbout(U.free, job8)) === 1 && (await notifiedAbout(U.pro, job8)) === 1);
const parishRow = (await q(`SELECT title FROM public.notifications WHERE user_id = $1 AND job_id = $2`, [U.free, job8]))[0];
check("parish: the queued row keeps the parish copy", parishRow?.title === "New job in your parish", JSON.stringify(parishRow));
const mails = (await q(`SELECT count(*)::int n FROM net.calls WHERE body->>'type' = 'job_match'`))[0].n;
check("parish: one email per parish notification (3), none for the instant copy", mails === 3, `emails ${mails}`);
const job9 = await postJob("Rewire a shed", { parish: "Orleans", tier: 2 });
await ageJob(job9, 25);
await sweep();
const who9 = (await q(`SELECT user_id FROM public.notifications WHERE job_id = $1`, [job9])).map((r) => name(r.user_id)).sort();
check("parish: credential-gated job reaches only the tier-2 user", JSON.stringify(who9) === JSON.stringify(["pro"]), JSON.stringify(who9));

// ── 7. a send that raises is logged and dropped; the rest still send ──────
const job10 = await postJob("Paint a fence", { parish: "Orleans" });
await db.exec(`CREATE OR REPLACE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE plpgsql AS $$
  BEGIN
    IF body->>'user_id' = '${U.free}' THEN RAISE EXCEPTION 'simulated pg_net failure'; END IF;
    INSERT INTO net.calls VALUES (body); RETURN 1;
  END $$;`);
await ageJob(job10, 21);
await sweep();
check("a raising send: the other waiting user is still told", (await notifiedAbout(U.pro, job10)) === 1 && (await notifiedAbout(U.free, job10)) === 0);
const logged = await q(`SELECT tags->>'source' AS src FROM public.error_logs`);
check("a raising send: logged once to error_logs, row dropped (not retried every minute)",
  logged.length === 1 && logged[0].src === "job-match-queue"
    && (RED ? false : (await q(`SELECT status FROM public.job_match_queue WHERE job_id = $1 AND user_id = $2`, [job10, U.free]))[0]?.status === "dropped"),
  JSON.stringify(logged));
await db.exec(`CREATE OR REPLACE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls VALUES (body); SELECT 1::bigint $$;`);

// ── 8. the daily parish digest counts only what the recipient can see ─────
await db.exec(`DELETE FROM public.notifications; UPDATE public.jobs SET status = 'accepted';`);
const seen = await postJob("Visible job", { parish: "Orleans" });
await ageJob(seen, 60);
await postJob("Unfunded job", { parish: "Orleans", paid: "pending" });
const orphan = await postJob("Ownerless job", { parish: "Orleans" });
await db.query(`UPDATE public.jobs SET customer_id = NULL, created_at = now() - interval '60 minutes' WHERE id = $1`, [orphan]);
await postJob("Fresh job", { parish: "Orleans" }); // 0 minutes old: visible to elite only
await db.exec(`DELETE FROM public.notifications`);
await q(`SELECT public.sweep_daily_job_digest()`);
const digestMsg = async (id) => (await q(`SELECT message FROM public.notifications WHERE user_id = $1 AND title LIKE 'New jobs in%'`, [id]))[0]?.message ?? "";
check("parish digest, free user: counts only the funded, owned, visible job (1)", (await digestMsg(U.free)).startsWith("1 new job "), await digestMsg(U.free));
check("parish digest, elite user: the fresh job counts too (2)", (await digestMsg(U.elite)).startsWith("2 new jobs "), await digestMsg(U.elite));

// ── 9. daily-match-digest re-checks its rows at digest time ────────────────
if (await has("public.job_match_digest_rows(uuid[])")) {
  await db.exec(`DELETE FROM public.match_digest_queue`);
  const hired = await postJob("Hired since queued");
  await ageJob(hired, 60);
  await db.query(`UPDATE public.jobs SET status = 'accepted' WHERE id = $1`, [hired]);
  const live = await postJob("Still open");
  await ageJob(live, 60);
  const fresh = await postJob("Too new for free");
  const ids = [];
  for (const j of [hired, live, fresh]) {
    ids.push((await q(`INSERT INTO public.match_digest_queue (user_id, job_id) VALUES ($1, $2) RETURNING id`, [U.free, j]))[0].id);
  }
  const rows = await q(`SELECT id, send FROM public.job_match_digest_rows($1::uuid[])`, [ids]);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r.send]));
  check("digest rows: hired job drained unsent, open job sent, too-new job kept queued",
    byId[ids[0]] === false && byId[ids[1]] === true && !(ids[2] in byId), JSON.stringify(byId));
} else check("job_match_digest_rows exists", false);

// ── 10. authz: nothing new is reachable by a client role ───────────────────
if (!RED) {
  const [g] = await q(`SELECT
      has_table_privilege('anon', 'public.job_match_queue', 'SELECT') OR has_table_privilege('authenticated', 'public.job_match_queue', 'SELECT')
        OR has_table_privilege('authenticated', 'public.job_match_queue', 'INSERT') AS table_open,
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.job_match_queue'::regclass) AS rls,
      has_function_privilege('authenticated', 'public.enqueue_instant_job_match(uuid,jsonb)', 'EXECUTE')
        OR has_function_privilege('anon', 'public.enqueue_instant_job_match(uuid,jsonb)', 'EXECUTE') AS enqueue_open,
      has_function_privilege('service_role', 'public.enqueue_instant_job_match(uuid,jsonb)', 'EXECUTE') AS enqueue_service,
      has_function_privilege('authenticated', 'public.deliver_job_match(uuid)', 'EXECUTE') AS deliver_open,
      has_function_privilege('authenticated', 'public.sweep_job_match_queue()', 'EXECUTE') AS sweep_open,
      has_function_privilege('authenticated', 'public.job_announceable_to(public.jobs,uuid)', 'EXECUTE')
        OR has_function_privilege('anon', 'public.job_announceable_to(public.jobs,uuid)', 'EXECUTE') AS gate_open,
      has_function_privilege('authenticated', 'public.job_match_digest_rows(uuid[])', 'EXECUTE') AS digest_open,
      (SELECT count(*)::int FROM public.cron_work_expectations WHERE jobname = 'job-match-queue') AS liveness`);
  check("queue: RLS on, no client table privilege", g.rls === true && g.table_open === false, JSON.stringify(g));
  check("enqueue / deliver / sweep / gate / digest rows: no client EXECUTE; service_role may enqueue",
    !g.enqueue_open && !g.deliver_open && !g.sweep_open && !g.gate_open && !g.digest_open && g.enqueue_service, JSON.stringify(g));
  check("liveness row registered once", g.liveness === 1);
} else check("authz on new objects", false, "no new objects");

console.log(failures ? `\n${failures} FAIL` : "\nall PASS");
process.exit(failures ? 1 : 0);
