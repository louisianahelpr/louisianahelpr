#!/usr/bin/env node
/**
 * PGlite proof for 20261030000822_reply_speed_bucket (Q2478, owner decision 2b, 2026-10-29).
 *
 *   node src/test/pglite/replySpeedBucket.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/replySpeedBucket.pglite.mjs   # RED: no get_reply_speed exists
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 *
 * Fixture: the columns the function reads, with prod's shapes (information_schema, 2026-10-29):
 * public.messages (job_id NULLable, receiver_id NULLable, is_system NOT NULL, team_thread_user_id),
 * public.jobs.customer_id NULLable (an ownerless job), public.profiles' public-gate columns.
 * seed_hidden_from_caller() is stubbed to TRUE (a non-admin, non-tester caller: seeds hidden), which is
 * what prod's definition (md5(prosrc) befd711c50498bbaefe57dd7fd711cae) answers for an ordinary member
 * while the seed switch hides seeds. Prod's default ACL (EXECUTE to anon/authenticated on every new
 * function) is modelled so the migration's REVOKE is what is tested. The migration is applied 3x.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(new URL("../../../supabase/migrations/20261030000822_reply_speed_bucket.sql", import.meta.url).pathname, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running without the migration (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const id = (p, n) => `${p}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const VIEWER = id("a", 1);
const FAST = id("b", 1); // answers posters in ~10 min
const SLOW = id("b", 2); // ~3 h
const DAY = id("b", 3); // ~12 h
const GHOST = id("b", 4); // never answers (all threads > 24h old)
const FEW = id("b", 5); // only 4 answered threads: under the floor
const OWNJOB = id("b", 6); // fast only on threads of jobs they POSTED, and in the team thread
const SEED = id("b", 7); // fast, but a hidden seed profile
const BANNED = id("b", 8); // fast, but banned
const SELFOPEN = id("b", 9); // fast, but every thread was opened by them (never answering a poster)
const POSTER = (n) => id("c", n);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE NOT NULL,
  email_verified boolean NOT NULL DEFAULT true, ban_status text, is_seed boolean DEFAULT false
);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, title text);
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, sender_id uuid NOT NULL, receiver_id uuid,
  content text NOT NULL DEFAULT 'x', created_at timestamptz NOT NULL DEFAULT now(),
  is_system boolean NOT NULL DEFAULT false, team_thread_user_id uuid
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles, public.messages, public.jobs FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.seed_hidden_from_caller() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT true $$;
`);
await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;");

const members = [VIEWER, FAST, SLOW, DAY, GHOST, FEW, OWNJOB, SEED, BANNED, SELFOPEN];
for (const m of members) {
  await db.query(
    "INSERT INTO public.profiles (user_id, is_seed, ban_status) VALUES ($1, $2, $3)",
    [m, m === SEED, m === BANNED ? "permanently_banned" : null],
  );
}
let jobN = 0;
/** One job thread: the poster writes first `daysAgo` days back, the member answers after `mins` (null = never). */
async function thread(member, mins, { daysAgo = 3, posterOpens = true, memberIsPoster = false, extra = [] } = {}) {
  jobN++;
  const poster = POSTER(jobN);
  const jobId = id("d", jobN);
  await db.query("INSERT INTO public.jobs (id, customer_id) VALUES ($1, $2)", [jobId, memberIsPoster ? member : poster]);
  const t0 = `now() - interval '${daysAgo} days'`;
  const [first, second] = posterOpens ? [poster, member] : [member, poster];
  await db.exec(`INSERT INTO public.messages (job_id, sender_id, receiver_id, created_at) VALUES ('${jobId}', '${first}', '${second}', ${t0})`);
  // A lifecycle system message right after, "from" the member: never a reply.
  await db.exec(`INSERT INTO public.messages (job_id, sender_id, receiver_id, created_at, is_system) VALUES ('${jobId}', '${member}', '${poster}', ${t0} + interval '1 minute', true)`);
  if (mins !== null) {
    await db.exec(`INSERT INTO public.messages (job_id, sender_id, receiver_id, created_at) VALUES ('${jobId}', '${second}', '${first}', ${t0} + interval '${mins} minutes')`);
  }
  for (const e of extra) await db.exec(e.replace(/\$JOB/g, jobId).replace(/\$POSTER/g, poster).replace(/\$T0/g, t0));
}
for (let i = 0; i < 6; i++) await thread(FAST, 10);
await thread(FAST, 60 * 30); // one very slow night does not move a median
for (let i = 0; i < 6; i++) await thread(SLOW, 180);
for (let i = 0; i < 6; i++) await thread(DAY, 720);
for (let i = 0; i < 6; i++) await thread(GHOST, null);
// GHOST also has fresh unanswered threads (< 24 h): not counted yet, and they must not make it faster.
for (let i = 0; i < 6; i++) await thread(GHOST, null, { daysAgo: 0.1 });
for (let i = 0; i < 4; i++) await thread(FEW, 5);
for (let i = 0; i < 6; i++) await thread(OWNJOB, 5, { memberIsPoster: true });
for (let i = 0; i < 6; i++) await db.exec(`INSERT INTO public.messages (job_id, sender_id, receiver_id, team_thread_user_id, created_at) VALUES (NULL, '${POSTER(900 + i)}', '${OWNJOB}', '${OWNJOB}', now() - interval '2 days'), (NULL, '${OWNJOB}', '${POSTER(900 + i)}', '${OWNJOB}', now() - interval '2 days' + interval '1 minute')`);
for (let i = 0; i < 6; i++) await thread(SEED, 5);
for (let i = 0; i < 6; i++) await thread(BANNED, 5);
for (let i = 0; i < 6; i++) await thread(SELFOPEN, 5, { posterOpens: false });
// An ownerless job (poster deleted their account): customer_id NULL, never counted, never an error.
await db.exec(`INSERT INTO public.jobs (id, customer_id) VALUES ('${id("e", 1)}', NULL)`);
await db.exec(`INSERT INTO public.messages (job_id, sender_id, receiver_id, created_at) VALUES ('${id("e", 1)}', '${FAST}', NULL, now() - interval '3 days')`);

if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

async function as(who, sql, params = []) {
  const role = who === "service" ? "service_role" : who ? "authenticated" : "anon";
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(`SET ROLE ${role}`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}

const CALL = "SELECT user_id::text AS u, reply_bucket AS b FROM public.get_reply_speed($1::uuid[])";
const r = await as(VIEWER, CALL, [members]);
const by = Object.fromEntries(r.ok ? r.rows.map((x) => [x.u, x.b]) : []);
check("R0 a signed-in member can call it", r.ok, r.ok ? `${r.rows.length} rows` : r.err);
check("R1 median ~10 min -> under_1h (one slow night does not move it)", by[FAST] === "under_1h", String(by[FAST]));
check("R2 median ~3 h -> few_hours", by[SLOW] === "few_hours", String(by[SLOW]));
check("R3 median ~12 h -> within_day", by[DAY] === "within_day", String(by[DAY]));
check("R4 never answers -> NULL (slower than a day is not published), fresh unanswered threads do not count as fast", GHOST in by && by[GHOST] === null, String(by[GHOST]));
check("R5 4 answered threads, under the floor of 5 -> NULL", FEW in by && by[FEW] === null, String(by[FEW]));
check("R6 own jobs and the team thread are not replies to a poster -> NULL", OWNJOB in by && by[OWNJOB] === null, String(by[OWNJOB]));
check("R7 a hidden seed profile is not returned at all", !(SEED in by), JSON.stringify(Object.keys(by).length));
check("R8 a banned member is not returned at all", !(BANNED in by));
check("R9 threads the member opened measure no answering -> NULL", SELFOPEN in by && by[SELFOPEN] === null, String(by[SELFOPEN]));
check("R10 only the bucket leaves: the result has exactly two columns (user_id, reply_bucket)",
  r.ok && r.rows.length > 0 && Object.keys(r.rows[0]).length === 2);
{
  const n = await as(VIEWER, CALL, [null]);
  check("N1 a NULL list returns no rows (never everyone)", n.ok && n.rows.length === 0, n.ok ? `${n.rows.length}` : n.err);
  const big = Array.from({ length: 150 }, (_, i) => (i === 120 ? FAST : id("f", i)));
  const b = await as(VIEWER, CALL, [big]);
  check("N2 at most 100 ids are read: a member at position 121 is not returned", b.ok && !b.rows.some((x) => x.u === FAST), b.ok ? `${b.rows.length}` : b.err);
}
{
  const a = await as(null, CALL, [members]);
  check("A1 anon has no EXECUTE", !a.ok && /permission denied|does not exist/.test(a.err), a.ok ? "read rows" : a.err);
  const s = await as("service", CALL, [members]);
  check("A2 a call with no signed-in user (auth.uid() NULL) returns nothing", s.ok && s.rows.length === 0, s.ok ? `${s.rows.length}` : s.err);
  const t = await as(VIEWER, "SELECT count(*) FROM public.messages");
  check("A3 the caller still cannot read messages directly", !t.ok && /permission denied/.test(t.err), t.ok ? "read rows" : t.err);
}
if (MODE !== "skip") {
  const f = (await db.query(`SELECT prosecdef, provolatile, proacl::text AS acl, proconfig::text AS cfg FROM pg_proc WHERE oid = to_regprocedure('public.get_reply_speed(uuid[])')`)).rows[0];
  check("F1 SECURITY DEFINER, STABLE, search_path pinned, EXECUTE for authenticated + service_role only (no anon, no PUBLIC)",
    f && f.prosecdef === true && f.provolatile === "s" && /search_path=public/.test(f.cfg ?? "")
      && /authenticated=X/.test(f.acl) && /service_role=X/.test(f.acl) && !/(^|[{,])(anon)?=X/.test(f.acl), JSON.stringify(f));
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
