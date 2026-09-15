// Probe: 20260915025607 (open_dispute_as refuses a HUMAN dispute on a
// completed job with 'job_already_completed'), in real Postgres. NOT a vitest
// test (pglite is not a dependency), so run by hand:
//
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
//   node scripts/probes/dispute-on-completed-job.probe.mjs
//
// The schema is prod-shaped from the LIVE definitions read on 2026-09-14:
// public.disputes (columns + disputes_one_open_per_job_idx), the jobs columns
// the body reads and writes, notifications, user_roles, fraud_flags,
// check_dispute_velocity verbatim, and open_dispute_as / rpc_open_dispute as
// created by 20260912023326 applied verbatim (its open_dispute_as body is
// md5-identical to prod's prosrc, cf6308e7b2397381d528f1063341b494).
// notify_ops_dispute_filed is a recording stub: the live one posts to pg_net,
// which PGlite does not have, and swallows every error anyway.
//
// 1. BEFORE, on the live shape: the hole must reproduce (a party opens a
//    dispute on a completed job, and re-freezes one through an open row).
// 2. The migration applied verbatim three times: every expectation holds, the
//    body minus the guard is still md5-identical to prod, the ACL is unchanged.
// 3. Deliberately broken copies, each on a fresh database: every one must FAIL
//    at least one expectation, or this probe cannot fail.
// 4. Skip path: on a database without the prerequisites it is a no-op.
// Exit 1 on any mismatch.
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import fs from "node:fs";
import crypto from "node:crypto";
const PRIOR = fs.readFileSync(new URL("../../supabase/migrations/20260912023326_system_open_dispute_on_undelivered_revision.sql", import.meta.url), "utf8");
const MIG = fs.readFileSync(new URL("../../supabase/migrations/20260915025607_block_disputes_on_completed_jobs.sql", import.meta.url), "utf8");
const LIVE_MD5 = "cf6308e7b2397381d528f1063341b494";
const LIVE_ACL = "{postgres=X/postgres,service_role=X/postgres}";

const POSTER = "76b07824-9b41-4741-a4c4-4f8de362f682";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const STRANGER = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const J_DONE = "5eed0a10-0000-4000-8000-000000000010";      // completed, no dispute
const J_DONE_ROW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";  // completed, stale OPEN disputes row
const J_LIVE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";      // in_progress
const J_REV = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";       // revision_requested (system sweep)
const J_SYS_DONE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";  // completed, system filing
const J_LIVE_ROW = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";  // accepted, stale OPEN disputes row
const REASON = "The work was not finished as agreed on the day.";

const SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TABLE public.jobs (
  id uuid primary key, customer_id uuid, helper_id uuid, title text, status text,
  disputed_by uuid, disputed_at timestamptz, dispute_reason text, dispute_status text,
  dispute_evidence_urls text[]
);
CREATE TABLE public.disputes (
  id uuid primary key default gen_random_uuid(), job_id uuid not null, opener_id uuid,
  reason text not null, evidence_urls text[] not null default '{}'::text[],
  status text not null default 'open', created_at timestamptz not null default now(),
  decided_at timestamptz, decided_by uuid, decision_text text
);
CREATE UNIQUE INDEX disputes_one_open_per_job_idx ON public.disputes USING btree (job_id) WHERE (status = 'open'::text);
CREATE TABLE public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null, title text not null, message text not null, type text not null, read boolean not null default false, link text, created_at timestamptz not null default now(), job_id uuid);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.fraud_flags (id uuid primary key default gen_random_uuid(), user_id uuid, job_id uuid, flag_type text, details text, resolved boolean default false, created_at timestamptz default now());
CREATE TABLE public.ops_pages (job_id uuid, refiled boolean);

CREATE OR REPLACE FUNCTION public.check_dispute_velocity(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT count(*) < 3
  FROM public.jobs
  WHERE disputed_by = p_user_id
    AND disputed_at > now() - interval '30 days';
$function$;

CREATE OR REPLACE FUNCTION public.notify_ops_dispute_filed(_job_id uuid, _job_title text, _reason text, _opener_id uuid, _refiled boolean DEFAULT false)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ BEGIN INSERT INTO public.ops_pages VALUES (_job_id, _refiled); END; $function$;

-- The shape 20260912023326 rewrites: it requires rpc_open_dispute to exist.
CREATE FUNCTION public.rpc_open_dispute(_job_id uuid, _reason text, _evidence_urls text[]) RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
`;

const FIXTURES = `
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.jobs (id, customer_id, helper_id, title, status) VALUES
  ('${J_DONE}', '${POSTER}', '${HELPER}', 'done job', 'completed'),
  ('${J_DONE_ROW}', '${POSTER}', '${HELPER}', 'done job with stale row', 'completed'),
  ('${J_LIVE}', '${POSTER}', '${HELPER}', 'live job', 'in_progress'),
  ('${J_REV}', '${POSTER}', '${HELPER}', 'revision job', 'revision_requested'),
  ('${J_SYS_DONE}', '${POSTER}', '${HELPER}', 'done job, system', 'completed'),
  ('${J_LIVE_ROW}', '${POSTER}', '${HELPER}', 'accepted job with stale row', 'accepted');
INSERT INTO public.disputes (job_id, opener_id, reason) VALUES
  ('${J_DONE_ROW}', '${POSTER}', 'an old dispute that was never closed'),
  ('${J_LIVE_ROW}', '${POSTER}', 'an old dispute that was never closed');
`;

async function as(db, who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(who === "service" ? "SET ROLE service_role" : who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}

const human = (db, who, job) => as(db, who, `SELECT public.rpc_open_dispute('${job}', '${REASON}', ARRAY['https://x/new.jpg']) AS id`);
const system = (db, job) => as(db, "service", `SELECT public.open_dispute_as('${job}', NULL, '${REASON}', '{}'::text[]) AS id`);

async function state(db, job) {
  const j = (await db.query(`SELECT status, disputed_by, dispute_status, coalesce(array_length(dispute_evidence_urls,1),0) AS ev FROM public.jobs WHERE id = '${job}'`)).rows[0];
  const d = (await db.query(`SELECT count(*)::int AS n, coalesce(sum(coalesce(array_length(evidence_urls,1),0)),0)::int AS ev FROM public.disputes WHERE job_id = '${job}'`)).rows[0];
  const n = (await db.query(`SELECT count(*)::int AS n FROM public.notifications WHERE link LIKE '%${job}'`)).rows[0].n;
  const p = (await db.query(`SELECT count(*)::int AS n FROM public.ops_pages WHERE job_id = '${job}'`)).rows[0].n;
  return { ...j, disputes: d.n, disputeEvidence: d.ev, notifications: n, pages: p };
}

// Expectations for the FIXED shape. Each returns a list of failures.
async function expectations(db) {
  const bad = [];
  const check = (cond, msg) => { if (!cond) bad.push(msg); };

  // A: a party on a completed job, no dispute row -> refused, nothing written.
  for (const who of [POSTER, HELPER]) {
    const before = await state(db, J_DONE);
    const r = await human(db, who, J_DONE);
    check(!r.ok && /job_already_completed/.test(r.err), `A ${who === POSTER ? "poster" : "helper"} on completed job: expected job_already_completed, got ${r.ok ? "success" : r.err}`);
    const after = await state(db, J_DONE);
    check(JSON.stringify(before) === JSON.stringify(after), `A completed job changed: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  }

  // B: a party on a completed job WITH a stale open row -> refused; no evidence
  // append, no re-freeze, no page.
  {
    const before = await state(db, J_DONE_ROW);
    const r = await human(db, HELPER, J_DONE_ROW);
    check(!r.ok && /job_already_completed/.test(r.err), `B stale-row completed job: expected job_already_completed, got ${r.ok ? "success" : r.err}`);
    const after = await state(db, J_DONE_ROW);
    check(after.status === "completed", `B completed job re-frozen to ${after.status}`);
    check(JSON.stringify(before) === JSON.stringify(after), `B completed job changed: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  }

  // C: a stranger on a completed job still gets the party refusal, not the state.
  {
    const r = await human(db, STRANGER, J_DONE);
    check(!r.ok && /not authorized for this job/.test(r.err), `C stranger on completed job: expected 'not authorized for this job', got ${r.ok ? "success" : r.err}`);
  }

  // D: an in-progress job still opens: row, disputed, counterparty + admin told, ops paged.
  {
    const r = await human(db, POSTER, J_LIVE);
    check(r.ok && r.rows[0].id, `D in_progress dispute refused: ${r.err}`);
    const s = await state(db, J_LIVE);
    check(s.status === "disputed" && s.disputes === 1 && s.disputed_by === POSTER && s.dispute_status === "open", `D in_progress not frozen: ${JSON.stringify(s)}`);
    const helperTold = (await db.query(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${HELPER}' AND link LIKE '%${J_LIVE}'`)).rows[0].n;
    const adminTold = (await db.query(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${ADMIN}' AND link = '/admin?view=disputes'`)).rows[0].n;
    check(helperTold === 1 && adminTold >= 1, `D expected helper + admin notified, got helper ${helperTold}, admin ${adminTold}`);
    check(s.pages === 1, `D expected one ops page, got ${s.pages}`);
  }

  // E: the existing-dispute re-freeze still works on a job that is not done.
  {
    const r = await human(db, HELPER, J_LIVE_ROW);
    check(r.ok, `E accepted job with stale row refused: ${r.err}`);
    const s = await state(db, J_LIVE_ROW);
    check(s.status === "disputed" && s.disputes === 1 && s.disputeEvidence === 1 && s.pages === 1, `E re-freeze on accepted job broken: ${JSON.stringify(s)}`);
  }

  // F: the system sweep's path is unchanged (revision_requested).
  {
    const r = await system(db, J_REV);
    check(r.ok, `F system filing on revision_requested refused: ${r.err}`);
    const s = await state(db, J_REV);
    check(s.status === "disputed" && s.disputes === 1 && s.disputed_by === null && s.notifications === 2, `F system filing broken: ${JSON.stringify(s)}`);
  }

  // G: the guard is HUMAN-only, as decided: a system filing is not refused by it.
  {
    const r = await system(db, J_SYS_DONE);
    check(r.ok || !/job_already_completed/.test(r.err), `G system filing hit the human guard: ${r.err}`);
  }

  // H: grants. The user door stays callable by a signed-in user; the body is
  // service-role only; the ACL is the live one.
  {
    const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE oid = 'public.open_dispute_as(uuid,uuid,text,text[])'::regprocedure`)).rows[0].a;
    check(acl === LIVE_ACL, `H open_dispute_as ACL ${acl}, live is ${LIVE_ACL}`);
    const direct = await as(db, STRANGER, `SELECT public.open_dispute_as('${J_LIVE}', '${STRANGER}', '${REASON}', '{}'::text[])`);
    check(!direct.ok && /permission denied/.test(direct.err), `H authenticated could call open_dispute_as directly: ${direct.ok ? "success" : direct.err}`);
  }

  // I: verbatim. Strip the guard block and the body is prod's, byte for byte.
  {
    const src = (await db.query(`SELECT prosrc FROM pg_proc WHERE oid = 'public.open_dispute_as(uuid,uuid,text,text[])'::regprocedure`)).rows[0].prosrc;
    const start = src.indexOf("\n  -- DONE IS FINAL (owner, 2026-09-14).");
    const endMarker = "      USING HINT = 'Once a job is marked done it is final.';\n  END IF;\n";
    const end = src.indexOf(endMarker);
    const stripped = start > -1 && end > -1 ? src.slice(0, start) + src.slice(end + endMarker.length) : src;
    const md5 = crypto.createHash("md5").update(stripped).digest("hex");
    check(start > -1 && end > -1, "I guard block not found in the deployed body");
    check(md5 === LIVE_MD5, `I body minus the guard is not prod's: md5 ${md5}, live ${LIVE_MD5}`);
  }
  return bad;
}

async function fresh(mig, times) {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(PRIOR);
  const priorMd5 = crypto.createHash("md5").update((await db.query(`SELECT prosrc FROM pg_proc WHERE oid = 'public.open_dispute_as(uuid,uuid,text,text[])'::regprocedure`)).rows[0].prosrc).digest("hex");
  if (priorMd5 !== LIVE_MD5) throw new Error(`prior shape is not prod's: ${priorMd5}`);
  for (let i = 0; i < times; i++) await db.exec(mig);
  await db.exec(FIXTURES);
  return db;
}

async function run(label, mig, times = 3) {
  const db = await fresh(mig, times);
  const bad = await expectations(db);
  await db.close();
  return { label, bad };
}

let fail = false;

// ── 1. BEFORE: the hole reproduces on the live shape ────────────────────────
{
  const db = await fresh("", 0);
  const a = await human(db, POSTER, J_DONE);
  const sa = await state(db, J_DONE);
  const b = await human(db, HELPER, J_DONE_ROW);
  const sb = await state(db, J_DONE_ROW);
  await db.close();
  const reproduced = a.ok && sa.status === "disputed" && sa.disputes === 1 && b.ok && sb.status === "disputed";
  console.log("== BEFORE (live shape)");
  console.log(`completed job, poster files: ${a.ok ? "ACCEPTED" : a.err} -> ${JSON.stringify(sa)}`);
  console.log(`completed job with stale row, helper files: ${b.ok ? "ACCEPTED" : b.err} -> ${JSON.stringify(sb)}`);
  if (!reproduced) { fail = true; console.log("FAIL: the hole did not reproduce on the live shape, so this probe proves nothing"); }
  else console.log("hole reproduced (red)");
}

// ── 2. AFTER: migration verbatim, three times ───────────────────────────────
{
  const r = await run("migration x3", MIG, 3);
  console.log("\n== AFTER (migration applied 3x)");
  if (r.bad.length) { fail = true; console.log("FAIL\n   " + r.bad.join("\n   ")); }
  else console.log("all expectations hold (green)");
}

// ── 3. Broken copies must each be caught ────────────────────────────────────
const mutate = (from, to) => {
  if (!MIG.includes(from)) throw new Error(`mutation anchor missing: ${from.slice(0, 60)}`);
  return MIG.replace(from, to);
};
// Anchored on the comment line above the guard: the header quotes the same IF,
// and a bare anchor mutates the comment instead of the code.
const GUARD_LEAD = "  -- 'completed' is unreachable for a person.\n";
const GUARD_IF = "  IF NOT _system AND _status = 'completed' THEN\n";
const GUARD_BLOCK = GUARD_LEAD + GUARD_IF + "    RAISE EXCEPTION 'job_already_completed'\n      USING HINT = 'Once a job is marked done it is final.';\n  END IF;\n";
const broken = [
  ["guard removed", mutate(GUARD_BLOCK, GUARD_LEAD)],
  ["guard applies to nobody (checks 'complete')", mutate(GUARD_LEAD + GUARD_IF, GUARD_LEAD + "  IF NOT _system AND _status = 'complete' THEN\n")],
  ["guard applies to the system too", mutate(GUARD_LEAD + GUARD_IF, GUARD_LEAD + "  IF _status = 'completed' THEN\n")],
  ["guard raises before the party check (leaks state to a stranger)",
    mutate(GUARD_BLOCK, GUARD_LEAD).replace("    RAISE EXCEPTION 'not authorized for this job';\n", "    NULL;\n  END IF;\n" + GUARD_IF + "    RAISE EXCEPTION 'job_already_completed';\n  END IF;\n  IF NOT _system AND _uid <> _customer AND _uid <> _helper THEN\n    RAISE EXCEPTION 'not authorized for this job';\n")],
  ["guard placed after the existing-dispute branch",
    mutate(GUARD_BLOCK, GUARD_LEAD).replace("  INSERT INTO public.disputes (job_id, opener_id, reason, evidence_urls)\n", GUARD_IF + "    RAISE EXCEPTION 'job_already_completed';\n  END IF;\n\n  INSERT INTO public.disputes (job_id, opener_id, reason, evidence_urls)\n")],
  ["open_dispute_as left authenticated-callable", mutate("FROM PUBLIC, anon, authenticated;", "FROM PUBLIC, anon;\n  GRANT EXECUTE ON FUNCTION public.open_dispute_as(uuid, uuid, text, text[]) TO authenticated;")],
];
console.log("\n== BROKEN COPIES (each must be caught)");
for (const [label, sql] of broken) {
  let r;
  try { r = await run(label, sql); } catch (e) { r = { bad: [`apply error: ${e.message}`] }; }
  if (r.bad.length === 0) { fail = true; console.log(`NOT CAUGHT: ${label}`); }
  else console.log(`caught: ${label}\n   ${r.bad.slice(0, 3).join("\n   ")}${r.bad.length > 3 ? `\n   (+${r.bad.length - 3} more)` : ""}`);
}

// ── 4. Skip path ────────────────────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  let ok = true;
  try { await db.exec(MIG); await db.exec(MIG); await db.exec(MIG); } catch (e) { ok = false; console.log("FAIL skip path:", e.message); }
  const made = (await db.query(`SELECT to_regprocedure('public.open_dispute_as(uuid,uuid,text,text[])') IS NOT NULL AS made`)).rows[0].made;
  await db.close();
  if (!ok || made) { fail = true; console.log("FAIL skip path: migration did not no-op on an empty database"); }
  else console.log("\nSKIP PATH: empty database, applied 3x, no-op (green)");
}

console.log(fail ? "\nPROBE FAILED" : "\nPROBE PASSED");
process.exit(fail ? 1 : 0);
