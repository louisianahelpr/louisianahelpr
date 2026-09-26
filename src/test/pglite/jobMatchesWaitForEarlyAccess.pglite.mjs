#!/usr/bin/env node
/**
 * PGlite proof for Q392 (PR #1810), both halves:
 *   20260926193006_q392_instant_job_matches_wait_for_early_access (instant)
 *   20260926195608_q392_parish_matches_block_gate_ledger          (parish, MQ29)
 *
 *   node src/test/pglite/jobMatchesWaitForEarlyAccess.pglite.mjs                             # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/jobMatchesWaitForEarlyAccess.pglite.mjs          # RED: main before the parish half
 *   NEW_MIGRATION=skip-instant node src/test/pglite/jobMatchesWaitForEarlyAccess.pglite.mjs  # RED: main before either half
 *
 * The base is main's migrations before the instant file: 20260926041132
 * (the parish queue, deliver_parish_match_alert, the queue-only
 * notify_helpers_on_job_post and the sweep that sends it) applied verbatim,
 * then each function's newest definition from before the instant file
 * (early_access_* from 20260925053412, sweep_daily_job_digest from
 * 20260924220318). The instant file is then applied 3x, then the parish file
 * 3x (replay-safety). skip leaves out the parish file, so every parish
 * blocks / gate / ledger / never-twice check fails on main's parish
 * definitions; skip-instant also leaves out the instant file, so every
 * instant check fails for want of enqueue_instant_job_match (instant-job-match
 * used to insert its notifications directly). Minimal fixture: only the
 * columns the functions read, and both of prod's fan-out triggers (funded
 * insert; update into open+funded, which is how a reopened job re-fires).
 * "Time passing" is simulated by moving jobs.created_at back, which is
 * exactly the input visible_at reads.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20260926193006_q392_instant_job_matches_wait_for_early_access.sql";
const PARISH_FILE = "20260926041132_parish_match_alerts_wait_for_early_access.sql";
const LEDGER_FILE = "20260926195608_q392_parish_matches_block_gate_ledger.sql";
/** RED: main before the instant half (no ledger table, no enqueue). */
const RED = process.env.NEW_MIGRATION === "skip-instant";
/** PARISH_RED: main before the parish half (the instant half applied). */
const PARISH_RED = RED || process.env.NEW_MIGRATION === "skip";
if (PARISH_RED) console.log(`NEW_MIGRATION=${process.env.NEW_MIGRATION}: running the PREVIOUS definitions (expect FAILs)`);

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
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, expected_max_gap interval, note text, work_visibility text, work_exempt_reason text);
CREATE TABLE public.error_logs (severity text CHECK (severity IN ('info','warning','error','fatal')), message text, tags jsonb);
CREATE TABLE public.cron_defects (fn text, subject text, err text);
CREATE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.cron_defects VALUES (a, b, c) $$;
CREATE TABLE public.saved_search_alert_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid, search_name text, matched_search_ids uuid[]);
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

// Main's parish path first, verbatim (its table, deliver, queue-only fan-out,
// sweep); then each function's newest definition before the new file.
await db.exec(readFileSync(MIG_DIR + PARISH_FILE, "utf8"));
for (const fn of ["early_access_delay_minutes", "early_access_visible_at", "notify_helpers_on_job_post", "deliver_parish_match_alert",
  "sweep_saved_search_alert_queue", "sweep_daily_job_digest"]) {
  await db.exec(previousDefinition(fn, NEW_FILE).text);
}
for (const [file, skip] of [[NEW_FILE, RED], [LEDGER_FILE, PARISH_RED]]) {
  if (skip) continue;
  const sql = readFileSync(MIG_DIR + file, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  console.log(`applied ${file} 3x`);
}
// Prod's two fan-out triggers (trg_notify_helpers_funded_insert / _update).
await db.exec(`
CREATE TRIGGER t AFTER INSERT ON public.jobs FOR EACH ROW
  WHEN (NEW.status = 'open' AND NEW.payment_status IN ('escrow','payout_pending','released'))
  EXECUTE FUNCTION public.notify_helpers_on_job_post();
CREATE TRIGGER tu AFTER UPDATE ON public.jobs FOR EACH ROW
  WHEN (NEW.status = 'open' AND NEW.payment_status IN ('escrow','payout_pending','released')
        AND NOT (OLD.status = 'open' AND COALESCE(OLD.payment_status, '') IN ('escrow','payout_pending','released')))
  EXECUTE FUNCTION public.notify_helpers_on_job_post();`);

const q = async (s, p = []) => (await db.query(s, p)).rows;
const has = async (sig) => (await q(`SELECT to_regprocedure($1) IS NOT NULL AS ok`, [sig]))[0].ok;
const HAS_ENQUEUE = await has("public.enqueue_instant_job_match(uuid, jsonb)");
const HAS_SWEEP = await has("public.sweep_job_match_queue()");
const sweep = async () => (HAS_SWEEP ? (await q(`SELECT public.sweep_job_match_queue() AS n`))[0].n : null);
/** Main's every-minute saved-search sweep, which also sends the parish queue. */
const parishSweep = async () => (await q(`SELECT public.sweep_saved_search_alert_queue() AS n`))[0].n;
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


// ── 6. the parish fan-out: queue-only (Q225 / V-008), one ledger (Q392) ───
/** job_match_queue rows for a job as "user:source:status", sorted ([] before the instant half). */
const ledger = async (jobId) => RED ? [] : (await q(`SELECT user_id, source, status FROM public.job_match_queue WHERE job_id = $1`, [jobId]))
  .map((r) => `${name(r.user_id)}:${r.source}:${r.status}`).sort();
const parishQueued = async (jobId) =>
  (await q(`SELECT user_id FROM public.parish_match_alert_queue WHERE job_id = $1`, [jobId])).map((r) => name(r.user_id)).sort();
for (const k of ["free", "pro", "elite"]) await db.query(`INSERT INTO public.applications VALUES ($1, null)`, [U[k]]);
await db.exec(`DELETE FROM net.calls`);
const job8 = await postJob("Clean gutters", { parish: "Orleans" });
const queued8 = await parishQueued(job8);
check("parish: the fan-out only queues (nobody told inside the funding write)",
  (await q(`SELECT count(*)::int n FROM public.notifications WHERE job_id = $1`, [job8]))[0].n === 0
    && JSON.stringify(queued8) === JSON.stringify(["elite", "free", "pro"]), JSON.stringify(queued8));
await parishSweep();
check("parish sweep at t+0: elite told, free and pro still waiting",
  (await notifiedAbout(U.elite, job8)) === 1 && (await notifiedAbout(U.free, job8)) + (await notifiedAbout(U.pro, job8)) === 0);
const eliteRow8 = RED ? null : (await q(`SELECT source, status, title, link, send_email FROM public.job_match_queue WHERE user_id = $1 AND job_id = $2`, [U.elite, job8]))[0];
check("parish: the send wrote a source='parish', status='sent' ledger row with its copy",
  eliteRow8?.source === "parish" && eliteRow8?.status === "sent" && eliteRow8?.title === "New job in your parish"
    && eliteRow8?.link === `/home?job=${job8}` && eliteRow8?.send_email === true, JSON.stringify(eliteRow8));
const r8 = await enqueue(job8, [U.elite, U.free, U.pro]);
check("instant match after the parish send: elite's slot is taken (already), elite not told twice",
  r8?.already === 1 && r8?.queued === 2 && (await notifiedAbout(U.elite, job8)) === 1, JSON.stringify(r8));
await ageJob(job8, 21);
await parishSweep();
await sweep();
check("t+21m, both sweeps: free and pro told exactly once each",
  (await notifiedAbout(U.free, job8)) === 1 && (await notifiedAbout(U.pro, job8)) === 1);
const freeRow8 = (await q(`SELECT title FROM public.notifications WHERE user_id = $1 AND job_id = $2`, [U.free, job8]))[0];
check("never twice, either source: free's instant row came first, so the parish send stood down and the instant copy went",
  freeRow8?.title === "🧹 Match for you", JSON.stringify(freeRow8));
const states8 = await ledger(job8);
check("ledger for the job: elite parish/sent, free and pro instant/sent (one row each)",
  JSON.stringify(states8) === JSON.stringify(["elite:parish:sent", "free:instant:sent", "pro:instant:sent"]), JSON.stringify(states8));
const mails = (await q(`SELECT count(*)::int n FROM net.calls WHERE body->>'type' = 'job_match'`))[0].n;
check("parish: one email per parish notification (1, elite), none for the instant copy", mails === 1, `emails ${mails}`);
const job9 = await postJob("Rewire a shed", { parish: "Orleans", tier: 2 });
await ageJob(job9, 25);
await parishSweep();
const who9 = (await q(`SELECT user_id FROM public.notifications WHERE job_id = $1`, [job9])).map((r) => name(r.user_id)).sort();
check("parish: credential-gated job reaches only the tier-2 user", JSON.stringify(who9) === JSON.stringify(["pro"]), JSON.stringify(who9));

// ── 6b. parish: blocks both ways, the ledger across a reopen ───────────────
// The poster blocked 'blocked' (fixture); 'plus' blocks the poster here.
for (const k of ["blocked", "plus"]) await db.query(`INSERT INTO public.applications VALUES ($1, null)`, [U[k]]);
await db.query(`INSERT INTO public.user_blocks VALUES ($1, $2)`, [U.plus, POSTER]);
const jobB = await postJob("Pressure wash a patio", { parish: "Orleans" });
const queuedB = await parishQueued(jobB);
check("parish fan-out: neither side of a block is queued (poster blocked them / they blocked the poster)",
  !queuedB.includes("blocked") && !queuedB.includes("plus") && queuedB.includes("free"), JSON.stringify(queuedB));
await db.query(`INSERT INTO public.parish_match_alert_queue (user_id, job_id, notify_at) VALUES ($1, $3, now()), ($2, $3, now()) ON CONFLICT DO NOTHING`,
  [U.blocked, U.plus, jobB]);
await ageJob(jobB, 25);
await parishSweep();
check("parish deliver: a queued row across a block, either way, is refused",
  (await notifiedAbout(U.blocked, jobB)) + (await notifiedAbout(U.plus, jobB)) === 0 && (await notifiedAbout(U.free, jobB)) === 1,
  `blocked ${await notifiedAbout(U.blocked, jobB)} plus ${await notifiedAbout(U.plus, jobB)} free ${await notifiedAbout(U.free, jobB)}`);
await db.query(`DELETE FROM public.user_blocks WHERE blocker_id = $1`, [U.plus]);
await db.exec(`DELETE FROM public.applications WHERE helper_id IN ('${U.blocked}', '${U.plus}')`);

const jobL = await postJob("Paint a shed", { parish: "Orleans" });
await db.query(`INSERT INTO public.user_blocks VALUES ($1, $2)`, [U.free, POSTER]);
await ageJob(jobL, 25);
await parishSweep();
check("parish deliver: a block added after the row was queued stops the send", (await notifiedAbout(U.free, jobL)) === 0);
await db.query(`DELETE FROM public.user_blocks WHERE blocker_id = $1`, [U.free]);

const jobR = await postJob("Haul brush", { parish: "Orleans" });
await ageJob(jobR, 25);
await parishSweep();
const toldR = await Promise.all(["elite", "free", "pro"].map((k) => notifiedAbout(U[k], jobR)));
check("reopen setup: elite, free and pro each told once", JSON.stringify(toldR) === "[1,1,1]", JSON.stringify(toldR));
await db.query(`DELETE FROM public.notifications WHERE job_id = $1`, [jobR]);
await db.query(`UPDATE public.jobs SET status = 'accepted' WHERE id = $1`, [jobR]);
await db.query(`UPDATE public.jobs SET status = 'open' WHERE id = $1`, [jobR]);
const requeuedR = await parishQueued(jobR);
check("reopen after the users deleted the notification: the fan-out re-queues nobody (the ledger decides)",
  requeuedR.length === 0, JSON.stringify(requeuedR));
await db.query(`INSERT INTO public.parish_match_alert_queue (user_id, job_id, notify_at) VALUES ($1, $2, now()) ON CONFLICT DO NOTHING`, [U.free, jobR]);
await parishSweep();
check("reopen: a stray queued parish row is refused at send, nobody told twice",
  (await notifiedAbout(U.elite, jobR)) + (await notifiedAbout(U.free, jobR)) + (await notifiedAbout(U.pro, jobR)) === 0);

const jobI = await postJob("Sweep a garage", { parish: "Orleans" });
await db.exec(`DELETE FROM public.parish_match_alert_queue WHERE job_id = '${jobI}'`);
await enqueue(jobI, [U.free]);
await ageJob(jobI, 25);
const direct = (await q(`SELECT public.deliver_parish_match_alert($1, $2) AS ok`, [U.free, jobI]))[0].ok;
check("parish deliver refuses when an instant row already holds the (user, job) slot",
  direct === false && (await notifiedAbout(U.free, jobI)) === 0, `returned ${direct}`);
const ledgerI = await ledger(jobI);
check("... and writes no second ledger row", JSON.stringify(ledgerI) === JSON.stringify(["free:instant:queued"]), JSON.stringify(ledgerI));
await sweep();

// ── 7. an instant send that raises is logged and dropped; the rest still send
const job10 = await postJob("Paint a fence");
await enqueue(job10, [U.free, U.pro]);
await db.exec(`CREATE FUNCTION public.raise_for_free() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF NEW.user_id = '${U.free}' THEN RAISE EXCEPTION 'simulated insert failure'; END IF;
    RETURN NEW;
  END $$;
  CREATE TRIGGER raise_for_free BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.raise_for_free();`);
await ageJob(job10, 21);
await sweep();
check("a raising send: the other waiting user is still told", (await notifiedAbout(U.pro, job10)) === 1 && (await notifiedAbout(U.free, job10)) === 0);
const logged = await q(`SELECT tags->>'source' AS src FROM public.error_logs WHERE tags->>'job_id' = $1`, [job10]);
check("a raising send: logged once to error_logs, row dropped (not retried every minute)",
  logged.length === 1 && logged[0].src === "job-match-queue"
    && (RED ? false : (await q(`SELECT status FROM public.job_match_queue WHERE job_id = $1 AND user_id = $2`, [job10, U.free]))[0]?.status === "dropped"),
  JSON.stringify(logged));
await sweep();
check("a raising send: not retried on the next run",
  (await q(`SELECT count(*)::int n FROM public.error_logs WHERE tags->>'job_id' = $1`, [job10]))[0].n === 1 && logged.length === 1);
await db.exec(`DROP TRIGGER raise_for_free ON public.notifications; DROP FUNCTION public.raise_for_free();`);

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

// ── 9b. the ledger, blocks both ways, the link refusal ────────────────────
// A deleted notification is not a licence to send again: the ledger decides.
const job11 = await postJob("Wash a car");
await enqueue(job11, [U.elite]);
check("instant: elite told at funding", (await notifiedAbout(U.elite, job11)) === 1);
await db.query(`DELETE FROM public.notifications WHERE job_id = $1`, [job11]);
await enqueue(job11, [U.elite]);
await sweep();
check("notification deleted, then re-triggered: elite not told twice (the ledger decides)", (await notifiedAbout(U.elite, job11)) === 0);
// The poster blocked 'blocked' (section 3); here the recipient blocks the poster.
await db.query(`INSERT INTO public.user_blocks VALUES ($1, $2)`, [U.plus, POSTER]);
const job13 = await postJob("Trim hedges");
await ageJob(job13, 25);
await enqueue(job13, [U.plus]);
await sweep();
check("instant: a recipient who blocked the poster is not told", (await notifiedAbout(U.plus, job13)) === 0);
await db.query(`DELETE FROM public.user_blocks WHERE blocker_id = $1`, [U.plus]);
// The digest re-check covers the recipient, not only the job.
if (await has("public.job_match_digest_rows(uuid[])")) {
  const live2 = await postJob("Open, but recipient muted since");
  await ageJob(live2, 60);
  const qid = (await q(`INSERT INTO public.match_digest_queue (user_id, job_id) VALUES ($1, $2) RETURNING id`, [U.muted, live2]))[0].id;
  const v = (await q(`SELECT send FROM public.job_match_digest_rows($1::uuid[])`, [[qid]]))[0];
  check("digest rows: a recipient who turned Job Matches off is drained unsent", v?.send === false, JSON.stringify(v));
}
// Only in-app paths are queued.
if (HAS_ENQUEUE) {
  const job12 = await postJob("Link check");
  let refused = 0;
  for (const link of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)"]) {
    try {
      await q(`SELECT public.enqueue_instant_job_match($1, $2::jsonb)`, [job12, JSON.stringify([{ user_id: U.elite, title: "t", message: "m", link }])]);
    } catch { refused++; }
  }
  check("enqueue refuses every non-in-app link", refused === 4, `refused ${refused}/4`);
} else check("enqueue refuses every non-in-app link", false, "no enqueue_instant_job_match");


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
