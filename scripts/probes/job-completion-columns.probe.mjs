// Probe: 20260915055245 (a direct client write may not pick the value of
// jobs.helper_completed_at, nor push a job into 'completed'), in real Postgres.
// NOT a vitest test (pglite is not a dependency), so run by hand:
//
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
//   node scripts/probes/job-completion-columns.probe.mjs
//
// Schema: the shared prod-shaped fixture
// scripts/probes/fixtures/dispute-table-door.live.sql (generated read-only from
// LIVE prod 2026-09-14: every jobs column, the live jobs SELECT/UPDATE/INSERT
// policies and table grants verbatim, and verbatim bodies of the lock triggers
// — status matrix, helper whitelist, poster money lock, field escalation,
// cancellation, insert column lock), PLUS the LATEST enforce_helper_completion_gates
// (its "status door" for the assigned Helpr, both-arrival requirement, photo and
// 30-minute gates) extracted verbatim from
// supabase/migrations/20260915044137_arrival_requires_gps_and_poster.sql and
// installed on top, so the Helpr faces the SAME completion guards as prod — more
// than the fixture alone. On that shape the two holes still open:
//   H-001: the Helpr passes every gate, then PATCHes a BACKDATED
//          helper_completed_at and the job is instantly due for auto-release.
//   H-002: the poster PATCHes status='completed' and strands the escrow.
//
// Roles are real: `SET ROLE authenticated` is PostgREST with a user JWT,
// `SET ROLE service_role` is an edge function, the dispute/decision RPCs are
// SECURITY DEFINER owned by the superuser (postgres), exactly as on prod.
//
// 1. BEFORE, on the live shape + gates: the completion door must be open (a
//    Helpr backdates helper_completed_at; a poster flips status to completed).
//    The expectations below must FAIL there.
// 2. The migration applied verbatim three times: every expectation holds.
// 3. Deliberately broken copies, each on a fresh database: every one must FAIL
//    at least one expectation, or this probe cannot fail.
// 4. Skip path: on a database without public.jobs it is a no-op; on a jobs
//    table missing a completion column it fails loudly instead of shipping no lock.
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

const LIVE = fs.readFileSync(new URL("./fixtures/dispute-table-door.live.sql", import.meta.url), "utf8");
const MIG = fs.readFileSync(new URL("../../supabase/migrations/20260915055245_job_completion_columns_server_owned.sql", import.meta.url), "utf8");

// The LATEST enforce_helper_completion_gates + its trigger, extracted verbatim
// from 20260915044137 (the fixture predates it). This is the guard the Helpr
// faces on prod today; H-001 lives on top of it.
const MIG44137 = fs.readFileSync(new URL("../../supabase/migrations/20260915044137_arrival_requires_gps_and_poster.sql", import.meta.url), "utf8");
function sliceBlock(src, startAnchor, endAnchor, label) {
  const a = src.indexOf(startAnchor);
  const b = src.indexOf(endAnchor);
  if (a < 0 || b < 0) throw new Error(`could not extract ${label} (anchor missing)`);
  return src.slice(a, b + endAnchor.length) + "\n";
}
const GATES = sliceBlock(
  MIG44137,
  "CREATE OR REPLACE FUNCTION public.enforce_helper_completion_gates()",
  "EXECUTE FUNCTION public.enforce_helper_completion_gates();",
  "enforce_helper_completion_gates",
);

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const OFFERED = "33333333-3333-4333-8333-333333333333";
const ADMIN = "22222222-2222-4222-8222-222222222222";

const J = {
  BACKDATE: "10000000-0000-4000-8000-000000000001",  // in_progress escrow, arrival done: Helpr backdates
  LEGIT: "10000000-0000-4000-8000-000000000002",     // in_progress escrow, arrival done: Helpr's real Done (clamp)
  STATUS_P: "10000000-0000-4000-8000-000000000003",  // in_progress escrow: poster flips to completed (H-002)
  STATUS_H: "10000000-0000-4000-8000-000000000004",  // in_progress escrow, arrival done: helper flips to completed
  ALREADY: "10000000-0000-4000-8000-000000000005",   // in_progress escrow, helper_completed_at set: change it
  POSTER_CLEAR: "10000000-0000-4000-8000-000000000006", // in_progress escrow, helper_completed_at set: poster clears
  OFFER: "10000000-0000-4000-8000-000000000007",     // open, direct offer pending to OFFERED
  SVC_STATUS: "10000000-0000-4000-8000-000000000008", // in_progress escrow: service completes
  SVC_HCA: "10000000-0000-4000-8000-000000000009",   // in_progress escrow: service backdates helper_completed_at
  ADMIN_STATUS: "10000000-0000-4000-8000-00000000000a", // in_progress escrow: admin completes
  ACCEPTED: "10000000-0000-4000-8000-00000000000b",  // accepted escrow: helper -> in_progress (JobTracking)
  TITLE: "10000000-0000-4000-8000-00000000000c",     // in_progress escrow: poster renames (unrelated write)
  WITHDRAW: "10000000-0000-4000-8000-00000000000d",  // disputed (was completed): opener withdraws via definer RPC
};

// Arrival established (both stamps, arrived over 30 min ago), photos on both
// sides, so a completion write clears every gate and only the VALUE / status is
// in question.
const READY = (id, hca) => `('${id}', '${POSTER}', '${HELPER}', 'ready', 'in_progress', 'escrow', 'cs_${id.slice(-1)}', 100,
  now() - interval '90 minutes', now() - interval '90 minutes', now() - interval '90 minutes', now() - interval '90 minutes',
  ARRAY['https://x/b.jpg'], ARRAY['https://x/a.jpg'], true, ${hca})`;

const FIXTURES = `
INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');
INSERT INTO public.profiles (user_id, idv_status, is_seed) VALUES ('${POSTER}', 'verified', true);
INSERT INTO public.jobs (id, customer_id, helper_id, title, status, payment_status, stripe_session_id, budget,
  helper_arrived_at, helper_arrival_verified_at, poster_confirmed_arrival_at, poster_confirmed_working_at,
  proof_before_urls, proof_after_urls, require_photo_proof, helper_completed_at) VALUES
  ${READY(J.BACKDATE, "NULL")},
  ${READY(J.LEGIT, "NULL")},
  ${READY(J.STATUS_H, "NULL")},
  ${READY(J.ALREADY, "now() - interval '1 hour'")},
  ${READY(J.POSTER_CLEAR, "now() - interval '1 hour'")},
  ${READY(J.SVC_HCA, "NULL")};
INSERT INTO public.jobs (id, customer_id, helper_id, title, status, payment_status, stripe_session_id, budget) VALUES
  ('${J.STATUS_P}',     '${POSTER}', '${HELPER}', 'poster completes', 'in_progress', 'escrow', 'cs_p', 100),
  ('${J.SVC_STATUS}',   '${POSTER}', '${HELPER}', 'service completes', 'in_progress', 'escrow', 'cs_s', 100),
  ('${J.ADMIN_STATUS}', '${POSTER}', '${HELPER}', 'admin completes',  'in_progress', 'escrow', 'cs_ad', 100),
  ('${J.ACCEPTED}',     '${POSTER}', '${HELPER}', 'accepted',         'accepted',    'escrow', 'cs_ac', 100),
  ('${J.TITLE}',        '${POSTER}', '${HELPER}', 'rename me',        'in_progress', 'escrow', 'cs_t', 100);
INSERT INTO public.jobs (id, customer_id, helper_id, title, status, payment_status, budget, offered_to_helper_id, direct_offer_status) VALUES
  ('${J.OFFER}', '${POSTER}', NULL, 'open offer', 'open', 'unpaid', 100, '${OFFERED}', 'pending');
-- A job that was completed, then disputed. The opener (poster) withdrawing the
-- dispute restores it to 'completed' through a SECURITY DEFINER RPC.
INSERT INTO public.jobs (id, customer_id, helper_id, title, status, payment_status, budget, poster_completed_at, payout_scheduled_at, disputed_at, disputed_by, dispute_status) VALUES
  ('${J.WITHDRAW}', '${POSTER}', '${HELPER}', 'withdraw restores completed', 'disputed', 'payout_pending', 100, now() - interval '2 hours', now() - interval '1 hour', now() - interval '30 minutes', '${POSTER}', 'open');
INSERT INTO public.disputes (job_id, opener_id, reason, status) VALUES
  ('${J.WITHDRAW}', '${POSTER}', 'The work was not finished as agreed.', 'open');
`;

async function as(db, who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(who === "service" ? "SET ROLE service_role" : who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message, code: e.code }; }
  finally { await db.exec("RESET ROLE"); }
}

const patch = (db, who, job, set) => as(db, who, `UPDATE public.jobs SET ${set} WHERE id = '${job}' RETURNING id`);
const row = async (db, job) => (await db.query(`SELECT to_jsonb(j) - 'updated_at' AS r FROM public.jobs j WHERE id = '${job}'`)).rows[0].r;
const ageSeconds = async (db, job) =>
  Number((await db.query(`SELECT extract(epoch FROM (now() - helper_completed_at))::float8 AS a FROM public.jobs WHERE id = '${job}'`)).rows[0].a);
const landed = (r) => r.ok && r.rows.length === 1;

async function expectations(db) {
  const bad = [];
  const check = (cond, msg) => { if (!cond) bad.push(msg); };

  const refused = async (label, who, job, set, re = /not by the client|is stamped by the server/) => {
    const before = await row(db, job);
    const r = await patch(db, who, job, set);
    const after = await row(db, job);
    check(!r.ok && r.code === "42501" && re.test(r.err), `${label}: expected 42501 refusal matching ${re}, got ${r.ok ? `success (${r.rows.length} row)` : `${r.code} ${r.err}`}`);
    check(JSON.stringify(before) === JSON.stringify(after), `${label}: row changed`);
  };

  // ── H-001. The Helpr's Done is KEPT but the value is the server clock. ──────
  {
    const r = await patch(db, HELPER, J.BACKDATE, "helper_completed_at = now() - interval '25 hours'");
    check(landed(r), `A1 Helpr Done refused (must land): ${r.ok ? `${r.rows.length} rows` : r.err}`);
    const age = await ageSeconds(db, J.BACKDATE);
    check(Number.isFinite(age) && age < 300, `A1 helper_completed_at was NOT clamped to now(): stored age ${Math.round(age)}s (backdated value survived)`);
  }
  {
    // The real Done sends its own now(); same result — accepted, server-stamped.
    const r = await patch(db, HELPER, J.LEGIT, "helper_completed_at = now()");
    check(landed(r), `A2 Helpr real Done refused (must land): ${r.ok ? `${r.rows.length} rows` : r.err}`);
    const age = await ageSeconds(db, J.LEGIT);
    check(Number.isFinite(age) && age < 300, `A2 real Done not stamped near now(): age ${Math.round(age)}s`);
  }
  // A change to an already-set stamp, and a poster / offered-Helpr write, refused.
  await refused("A3 Helpr re-backdates an already-set helper_completed_at", HELPER, J.ALREADY, "helper_completed_at = now() - interval '25 hours'");
  await refused("A4 poster CLEARS helper_completed_at (defeats auto-release from the other side)", POSTER, J.POSTER_CLEAR, "helper_completed_at = NULL");
  await refused("A5 offered Helpr stamps helper_completed_at on an open job", OFFERED, J.OFFER, "helper_completed_at = now()");

  // ── H-002. A client may not push a job INTO 'completed'. ────────────────────
  await refused("B1 poster PATCHes status = completed (strands escrow)", POSTER, J.STATUS_P, "status = 'completed'", /status -> completed/);
  // The Helpr is already stopped by the completion gates' status door; either
  // way it is a 42501 refusal, and the row is unchanged.
  await refused("B2 helper PATCHes status = completed", HELPER, J.STATUS_H, "status = 'completed'", /status -> completed|helper_cannot_complete_by_status/);

  // ── Writes that MUST keep working. ──────────────────────────────────────────
  {
    const r = await patch(db, "service", J.SVC_STATUS, "status = 'completed', payment_status = 'payout_pending'");
    const s = await row(db, J.SVC_STATUS);
    check(landed(r) && s.status === "completed", `C1 service-role completion refused: ${r.ok ? JSON.stringify({ status: s.status }) : r.err}`);
  }
  {
    // Service (auto-release, backfills) may write helper_completed_at freely —
    // not clamped, not refused.
    const r = await patch(db, "service", J.SVC_HCA, "helper_completed_at = now() - interval '25 hours'");
    const age = await ageSeconds(db, J.SVC_HCA);
    check(landed(r) && age > 80000, `C2 service-role helper_completed_at was clamped/refused (should be honoured): landed=${landed(r)} age=${Math.round(age)}s ${r.err ?? ""}`);
  }
  {
    const r = await patch(db, ADMIN, J.ADMIN_STATUS, "status = 'completed', payment_status = 'payout_pending'");
    const s = await row(db, J.ADMIN_STATUS);
    check(landed(r) && s.status === "completed", `C3 admin completion refused: ${r.ok ? JSON.stringify({ status: s.status }) : r.err}`);
  }
  {
    const r = await patch(db, HELPER, J.ACCEPTED, "status = 'in_progress'");
    check(landed(r), `C4 helper accepted -> in_progress (JobTracking) refused: ${r.ok ? `${r.rows.length} rows` : r.err}`);
  }
  {
    const r = await patch(db, POSTER, J.TITLE, "title = 'renamed'");
    check(landed(r), `C5 poster unrelated write refused: ${r.ok ? `${r.rows.length} rows` : r.err}`);
  }
  {
    // A SECURITY DEFINER RPC invoked by a user restores a previously-completed
    // job to 'completed'. current_user is postgres INSIDE the RPC, so the guard
    // lets it through — this is the whole reason the gate keys on current_user
    // and not auth.uid() (which is still the user here, and would be refused).
    const r = await as(db, POSTER, `SELECT public.rpc_withdraw_dispute('${J.WITHDRAW}')`);
    const s = await row(db, J.WITHDRAW);
    check(r.ok && s.status === "completed" && s.dispute_status === "resolved", `C6 rpc_withdraw_dispute (definer restores completed) refused: ${r.ok ? `${s.status}/${s.dispute_status}` : r.err}`);
  }

  // ── The function itself: trigger-only, NOT security definer. ────────────────
  {
    const f = (await db.query(`SELECT prosecdef, proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure('public.enforce_job_completion_server_owned()')`)).rows[0];
    check(f && f.prosecdef === false, `E1 enforce_job_completion_server_owned must not be SECURITY DEFINER: ${JSON.stringify(f)}`);
    check(f && !/(^|[{,])(anon|authenticated)?=X/.test(f.acl ?? "{=X}"), `E2 enforce_job_completion_server_owned still callable by a client: ${f?.acl}`);
  }
  return bad;
}

async function fresh(mig, times) {
  const db = new PGlite();
  await db.exec(LIVE);
  await db.exec(GATES);
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

// ── 1. BEFORE: the completion door is open on the live shape + gates ─────────
{
  const db = await fresh("", 0);
  const show = async (label, who, job, set) => {
    const before = await row(db, job);
    const r = await patch(db, who, job, set);
    const after = await row(db, job);
    const moved = ["status", "helper_completed_at"].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    console.log(`${landed(r) ? "LANDED " : "refused"} ${label}${landed(r) ? ` (changed: ${moved.join(", ")})` : `: ${r.err}`}`);
    return landed(r);
  };
  console.log("== BEFORE (live shape + latest completion gates, no migration)");
  const hits = [
    await show("Helpr PATCH backdated helper_completed_at (passes every gate)", HELPER, J.BACKDATE, "helper_completed_at = now() - interval '25 hours'"),
    await show("poster PATCH status = completed on in_progress escrow job", POSTER, J.STATUS_P, "status = 'completed'"),
  ];
  const backdatedAge = await ageSeconds(db, J.BACKDATE);
  console.log(`   backdated helper_completed_at age on the live shape: ${Math.round(backdatedAge / 3600)}h (instantly due for auto-release)`);
  await db.close();
  const r = await run("live shape", "", 0);
  console.log(`expectations on the live shape: ${r.bad.length} failing`);
  if (!hits.every(Boolean) || backdatedAge < 80000 || r.bad.length === 0) {
    fail = true;
    console.log("FAIL: the holes did not reproduce on the live shape, so this probe proves nothing");
  } else console.log("holes reproduced (red)");
}

// ── 2. AFTER: migration verbatim, three times ───────────────────────────────
{
  const r = await run("migration x3", MIG, 3);
  console.log("\n== AFTER (migration applied 3x)");
  if (r.bad.length) { fail = true; console.log("FAIL\n   " + r.bad.join("\n   ")); }
  else console.log("all expectations hold (green)");
}

// ── 3. Broken copies must each be caught ────────────────────────────────────
const mutate = (from, to, src = MIG) => {
  if (!src.includes(from)) throw new Error(`mutation anchor missing: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};
const broken = [
  ["trigger never created", mutate("  CREATE TRIGGER zz_jobs_completion_server_owned\n    BEFORE INSERT OR UPDATE OF status, helper_completed_at\n    ON public.jobs\n    FOR EACH ROW\n    EXECUTE FUNCTION public.enforce_job_completion_server_owned();\n", "  NULL;\n")],
  ["helper_completed_at not clamped (value validated, not overwritten)", mutate("      NEW.helper_completed_at := now();", "      NULL;")],
  ["clamp carve-out widened to any caller (poster can stamp)", mutate("       AND v_uid = OLD.helper_id THEN", "       THEN")],
  ["status -> completed check removed", mutate("  IF NEW.status::text = 'completed'\n     AND OLD.status::text IS DISTINCT FROM 'completed' THEN", "  IF false THEN")],
  ["helper_completed_at change check removed", mutate("  IF NEW.helper_completed_at IS DISTINCT FROM OLD.helper_completed_at THEN", "  IF false THEN")],
  ["function made SECURITY DEFINER (current_user is always the owner)", mutate(" LANGUAGE plpgsql\n SET search_path TO 'public'\nAS $function$\nDECLARE\n  v_uid uuid;", " LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\nDECLARE\n  v_uid uuid;")],
  ["gate on auth.uid() instead of current_user (blocks the service/RPC paths)", mutate("  IF current_user::text NOT IN ('authenticated', 'anon') THEN", "  IF auth.uid() IS NULL THEN")],
  ["admin exemption removed", mutate("    IF public.has_role(v_uid, 'admin'::app_role) THEN", "    IF false THEN")],
  ["trigger on UPDATE only misses helper_completed_at column", mutate("    BEFORE INSERT OR UPDATE OF status, helper_completed_at", "    BEFORE INSERT OR UPDATE OF status")],
  ["trigger function left callable by authenticated", mutate("FROM PUBLIC, anon, authenticated;", "FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public.enforce_job_completion_server_owned() TO authenticated;")],
];
console.log("\n== BROKEN COPIES (each must be caught)");
for (const [label, sql] of broken) {
  let r;
  try { r = await run(label, sql); } catch (e) { r = { bad: [`apply error: ${e.message}`] }; }
  if (r.bad.length === 0) { fail = true; console.log(`NOT CAUGHT: ${label}`); }
  else console.log(`caught: ${label}\n   ${r.bad.slice(0, 2).join("\n   ")}${r.bad.length > 2 ? `\n   (+${r.bad.length - 2} more)` : ""}`);
}

// ── 4. Skip path (no public.jobs) ───────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  let ok = true;
  try { await db.exec(MIG); await db.exec(MIG); await db.exec(MIG); } catch (e) { ok = false; console.log("FAIL skip path:", e.message); }
  const trig = (await db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'zz_jobs_completion_server_owned'`)).rows[0].n;
  await db.close();
  if (!ok || trig !== 0) { fail = true; console.log("FAIL skip path: migration did not no-op on a database without public.jobs"); }
  else console.log("\nSKIP PATH: no public.jobs, applied 3x, no trigger, no error (green)");
}
// ── 4b. Loud path: a jobs table missing a completion column fails the deploy ─
{
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE public.jobs (id uuid, status text, helper_id uuid);");
  let err = null;
  try { await db.exec(MIG); } catch (e) { err = e.message; }
  await db.close();
  if (!err || !/expected 3 jobs columns, found 2/.test(err)) { fail = true; console.log(`FAIL loud path: a jobs table missing helper_completed_at did not fail the migration (${err ?? "no error"})`); }
  else console.log("LOUD PATH: jobs missing a completion column fails the migration (green)");
}

console.log(fail ? "\nPROBE FAILED" : "\nPROBE PASSED");
process.exit(fail ? 1 : 0);
