// Probe: 20260915033734 (a direct client write may not touch the dispute
// markers on jobs), in real Postgres. NOT a vitest test (pglite is not a
// dependency), so run by hand:
//
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
//   node scripts/probes/dispute-table-door.probe.mjs
//
// Schema: scripts/probes/fixtures/dispute-table-door.live.sql, generated
// read-only from LIVE prod on 2026-09-14: every jobs column, the live jobs
// SELECT/UPDATE policies and table grants verbatim, and verbatim bodies of the
// lock triggers (status matrix, helper whitelist, poster money lock, field
// escalation, cancellation, insert column lock, dispute deadline,
// has_active_dispute), the jobs INSERT policy, and every
// dispute RPC (open_dispute_as with 20260915025607's guard, rpc_open_dispute,
// helper_abort_job, rpc_escalate_dispute, rpc_withdraw_dispute,
// rpc_decide_dispute). md5(prosrc) of each is in that file's header.
//
// Roles are real: `SET ROLE authenticated` is PostgREST with a user JWT,
// `SET ROLE service_role` is an edge function, and the dispute RPCs are
// SECURITY DEFINER owned by the superuser, exactly as on prod.
//
// 1. BEFORE, on the live shape: the table door must be open (a poster stamps
//    disputed_at / flips status on a completed payout_pending job, a helper
//    re-points disputed_by, de-escalates, moves status out of 'disputed').
//    The expectations below must FAIL there.
// 2. The migration applied verbatim three times: every expectation holds.
// 3. Deliberately broken copies, each on a fresh database: every one must FAIL
//    at least one expectation, or this probe cannot fail.
// 4. Skip path: on a database without public.jobs it is a no-op; on a jobs
//    table missing a marker column it fails loudly instead of shipping no lock.
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
const MIG = fs.readFileSync(new URL("../../supabase/migrations/20260915033734_dispute_markers_server_owned.sql", import.meta.url), "utf8");

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const ADMIN = "22222222-2222-4222-8222-222222222222";

const J = {
  DONE: "10000000-0000-4000-8000-000000000001",       // completed, payout_pending, funded
  DONE_H: "10000000-0000-4000-8000-000000000002",     // completed, payout_pending (helper attacks)
  LIVE: "10000000-0000-4000-8000-000000000003",       // in_progress, escrow: rpc_open_dispute
  ABORT: "10000000-0000-4000-8000-000000000004",      // in_progress, work started: helper_abort_job
  D_POSTER: "10000000-0000-4000-8000-000000000005",   // disputed, open, poster filed
  D_HELPER: "10000000-0000-4000-8000-000000000006",   // disputed, open, helper filed
  D_ESC: "10000000-0000-4000-8000-000000000007",      // disputed, escalated, poster filed
  D_ADMIN: "10000000-0000-4000-8000-000000000008",    // disputed, open: admin direct close
  D_SVC: "10000000-0000-4000-8000-000000000009",      // disputed, open, helper filed: service escalates
  DONE_SVC: "10000000-0000-4000-8000-00000000000a",   // completed, payout_pending: service chargeback hold
  ACCEPTED: "10000000-0000-4000-8000-00000000000b",   // accepted: helper starts work
  D_WITHDRAW: "10000000-0000-4000-8000-00000000000c", // disputed, open, poster filed: poster withdraws
};
const REASON = "The work was not finished as agreed on the day.";
const J_NEW_POSTER = "20000000-0000-4000-8000-000000000001";
const J_NEW_SERVICE = "20000000-0000-4000-8000-000000000002";
// A PostgREST POST /jobs carrying every marker, as the poster would send it.
const INSERT_WITH_MARKERS = (id, title) => `INSERT INTO public.jobs (id, customer_id, title, status, budget, disputed_at, disputed_by, dispute_status, dispute_deadline, dispute_resolved_at)
  VALUES ('${id}', '${POSTER}', '${title}', 'open', 100, now(), '${POSTER}', 'open', now() + interval '999 days', now()) RETURNING id`;

const FIXTURES = `
INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');
INSERT INTO public.profiles (user_id, idv_status, is_seed) VALUES ('${POSTER}', 'verified', true);
INSERT INTO public.jobs (id, customer_id, helper_id, title, status, payment_status, stripe_session_id, budget, payout_scheduled_at, poster_completed_at, helper_arrived_at, disputed_at, disputed_by, dispute_status, dispute_deadline, dispute_reason) VALUES
  ('${J.DONE}',       '${POSTER}', '${HELPER}', 'done',            'completed',   'payout_pending', 'cs_1', 100, now() - interval '1 hour', now() - interval '2 hours', now() - interval '1 day', NULL, NULL, NULL, NULL, NULL),
  ('${J.DONE_H}',     '${POSTER}', '${HELPER}', 'done (helper)',   'completed',   'payout_pending', 'cs_2', 100, now() - interval '1 hour', now() - interval '2 hours', now() - interval '1 day', NULL, NULL, NULL, NULL, NULL),
  ('${J.LIVE}',       '${POSTER}', '${HELPER}', 'live',            'in_progress', 'escrow',         'cs_3', 100, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('${J.ABORT}',      '${POSTER}', '${HELPER}', 'abort',           'in_progress', 'escrow',         'cs_4', 100, NULL, NULL, now() - interval '1 hour', NULL, NULL, NULL, NULL, NULL),
  ('${J.D_POSTER}',   '${POSTER}', '${HELPER}', 'poster filed',    'disputed',    'escrow',         'cs_5', 100, NULL, NULL, NULL, now() - interval '1 hour', '${POSTER}', 'open', now() + interval '71 hours', '${REASON}'),
  ('${J.D_HELPER}',   '${POSTER}', '${HELPER}', 'helper filed',    'disputed',    'escrow',         'cs_6', 100, NULL, NULL, NULL, now() - interval '1 hour', '${HELPER}', 'open', now() + interval '71 hours', '${REASON}'),
  ('${J.D_ESC}',      '${POSTER}', '${HELPER}', 'escalated',       'disputed',    'escrow',         'cs_7', 100, NULL, NULL, NULL, now() - interval '1 hour', '${POSTER}', 'escalated', now() + interval '71 hours', '${REASON}'),
  ('${J.D_ADMIN}',    '${POSTER}', '${HELPER}', 'admin closes',    'disputed',    'escrow',         'cs_8', 100, NULL, NULL, NULL, now() - interval '1 hour', '${POSTER}', 'open', now() + interval '71 hours', '${REASON}'),
  ('${J.D_SVC}',      '${POSTER}', '${HELPER}', 'service escal.',  'disputed',    'escrow',         'cs_9', 100, NULL, NULL, NULL, now() - interval '80 hours', '${HELPER}', 'open', now() - interval '8 hours', '${REASON}'),
  ('${J.DONE_SVC}',   '${POSTER}', '${HELPER}', 'chargeback',      'completed',   'payout_pending', 'cs_a', 100, now() - interval '1 hour', now() - interval '2 hours', now() - interval '1 day', NULL, NULL, NULL, NULL, NULL),
  ('${J.ACCEPTED}',   '${POSTER}', '${HELPER}', 'accepted',        'accepted',    'escrow',         'cs_b', 100, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('${J.D_WITHDRAW}', '${POSTER}', '${HELPER}', 'poster withdraws','disputed',    'escrow',         'cs_c', 100, NULL, NULL, NULL, now() - interval '1 hour', '${POSTER}', 'open', now() + interval '71 hours', '${REASON}');
INSERT INTO public.disputes (job_id, opener_id, reason) VALUES
  ('${J.D_POSTER}', '${POSTER}', '${REASON}'),
  ('${J.D_HELPER}', '${HELPER}', '${REASON}'),
  ('${J.D_ESC}', '${POSTER}', '${REASON}'),
  ('${J.D_ADMIN}', '${POSTER}', '${REASON}'),
  ('${J.D_SVC}', '${HELPER}', '${REASON}'),
  ('${J.D_WITHDRAW}', '${POSTER}', '${REASON}');
`;

async function as(db, who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(who === "service" ? "SET ROLE service_role" : who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message, code: e.code }; }
  finally { await db.exec("RESET ROLE"); }
}

// A PostgREST PATCH with `.select("id")`: the RLS-visible UPDATE, RETURNING id.
const patch = (db, who, job, set) => as(db, who, `UPDATE public.jobs SET ${set} WHERE id = '${job}' RETURNING id`);
const row = async (db, job) => (await db.query(`SELECT to_jsonb(j) - 'updated_at' AS r FROM public.jobs j WHERE id = '${job}'`)).rows[0].r;
const landed = (r) => r.ok && r.rows.length === 1;

// Expectations for the FIXED shape. Each returns a list of failures.
async function expectations(db) {
  const bad = [];
  const check = (cond, msg) => { if (!cond) bad.push(msg); };

  // ── The door: every direct marker write is refused AND leaves the row as it was.
  const refused = async (label, who, job, set) => {
    const before = await row(db, job);
    const r = await patch(db, who, job, set);
    const after = await row(db, job);
    check(!r.ok && r.code === "42501" && /not by the client/.test(r.err), `${label}: expected 42501 refusal, got ${r.ok ? `success (${r.rows.length} row)` : `${r.code} ${r.err}`}`);
    check(JSON.stringify(before) === JSON.stringify(after), `${label}: row changed`);
  };
  await refused("A1 poster stamps disputed_at on completed payout_pending job", POSTER, J.DONE, "disputed_at = now()");
  await refused("A2 poster flips completed job to disputed", POSTER, J.DONE, "status = 'disputed'");
  await refused("A3 poster sets dispute_status on completed job", POSTER, J.DONE, "dispute_status = 'open'");
  await refused("A4 poster stamps disputed_by on completed job", POSTER, J.DONE, `disputed_by = '${POSTER}'`);
  await refused("A5 helper stamps disputed_at on completed job", HELPER, J.DONE_H, "disputed_at = now()");
  await refused("A6 helper flips completed job to disputed", HELPER, J.DONE_H, "status = 'disputed', disputed_at = now(), dispute_status = 'open'");
  await refused("B1 helper re-points disputed_by on own dispute at the poster", HELPER, J.D_HELPER, `disputed_by = '${POSTER}'`);
  await refused("B2 helper de-escalates (escalated -> helper_responded)", HELPER, J.D_ESC, "dispute_status = 'helper_responded'");
  await refused("B3 helper sets dispute_status resolved", HELPER, J.D_POSTER, "dispute_status = 'resolved'");
  await refused("B4 poster pushes dispute_deadline out", POSTER, J.D_POSTER, "dispute_deadline = now() + interval '365 days'");
  await refused("B5 poster stamps dispute_resolved_at", POSTER, J.D_POSTER, "dispute_resolved_at = now()");
  await refused("B6 poster moves status out of disputed (-> in_progress)", POSTER, J.D_HELPER, "status = 'in_progress'");
  await refused("B7 helper moves status out of disputed (-> completed)", HELPER, J.D_POSTER, "status = 'completed'");
  await refused("B8 poster writes helper_responded (not the helper)", POSTER, J.D_HELPER, "dispute_status = 'helper_responded'");
  await refused("B9 helper clears disputed_at on a live dispute", HELPER, J.D_POSTER, "disputed_at = NULL");
  await refused("B10 helper 'responds' to the dispute they filed themselves", HELPER, J.D_HELPER, "dispute_status = 'helper_responded'");

  // ── The INSERT door: a new job cannot be born carrying a dispute marker.
  {
    const r = await as(db, POSTER, INSERT_WITH_MARKERS(J_NEW_POSTER, "poster born-disputed"));
    const s = r.ok ? await row(db, J_NEW_POSTER) : null;
    check(landed(r), `I1 poster job insert refused (should land, markers cleared): ${r.ok ? `${r.rows.length} rows` : r.err}`);
    check(s && s.disputed_at === null && s.disputed_by === null && s.dispute_status === null && s.dispute_deadline === null && s.dispute_resolved_at === null && s.status === "open" && s.has_active_dispute === false,
      `I1 poster insert kept a dispute marker: ${s && JSON.stringify({ disputed_at: s.disputed_at, disputed_by: s.disputed_by, dispute_status: s.dispute_status, dispute_deadline: s.dispute_deadline, dispute_resolved_at: s.dispute_resolved_at, status: s.status })}`);
    const r2 = await as(db, "service", INSERT_WITH_MARKERS(J_NEW_SERVICE, "service seed"));
    const s2 = r2.ok ? await row(db, J_NEW_SERVICE) : null;
    check(landed(r2) && s2.disputed_at !== null && s2.dispute_status === "open", `I2 service-role insert lost its markers (seed minting): ${r2.ok ? JSON.stringify({ disputed_at: s2?.disputed_at, dispute_status: s2?.dispute_status }) : r2.err}`);
  }

  // ── Writes that must keep working.
  {
    // DisputedSection.tsx: the assigned Helpr answers an open dispute.
    const r = await patch(db, HELPER, J.D_POSTER, "dispute_helper_response = 'I finished it, photos attached.', dispute_status = 'helper_responded'");
    const s = await row(db, J.D_POSTER);
    check(landed(r) && s.dispute_status === "helper_responded" && s.status === "disputed", `C1 helper response refused: ${r.ok ? `${r.rows.length} rows` : r.err}`);
    // ...and on an escalated one only the response text (the client drops the status there).
    const r2 = await patch(db, HELPER, J.D_ESC, "dispute_helper_response = 'Adding my side for the admin.'");
    check(landed(r2), `C2 helper response text on escalated dispute refused: ${r2.ok ? `${r2.rows.length} rows` : r2.err}`);
  }
  {
    // Unrelated client writes on the same rows are untouched by the lock.
    const r = await patch(db, POSTER, J.DONE, "title = 'renamed after completion'");
    check(landed(r), `C3 poster non-dispute write on completed job refused: ${r.ok ? `${r.rows.length} rows` : r.err}`);
    const r2 = await patch(db, HELPER, J.ACCEPTED, "status = 'in_progress'");
    check(landed(r2), `C4 helper accepted -> in_progress (JobTracking) refused: ${r2.ok ? `${r2.rows.length} rows` : r2.err}`);
    const r3 = await patch(db, POSTER, J.DONE, "dispute_evidence_urls = ARRAY['https://x/e.jpg']");
    check(landed(r3), `C5 poster dispute_evidence_urls write refused (not a marker): ${r3.ok ? `${r3.rows.length} rows` : r3.err}`);
  }
  {
    // rpc_open_dispute on an in-progress job: the normal dispute path.
    const r = await as(db, POSTER, `SELECT public.rpc_open_dispute('${J.LIVE}', '${REASON}', ARRAY['https://x/1.jpg']) AS id`);
    const s = await row(db, J.LIVE);
    check(r.ok && r.rows[0].id, `D1 rpc_open_dispute on in_progress refused: ${r.err}`);
    check(s.status === "disputed" && s.disputed_by === POSTER && s.disputed_at && s.dispute_status === "open" && s.dispute_deadline && s.has_active_dispute === true,
      `D1 in_progress not frozen: ${JSON.stringify({ status: s.status, disputed_by: s.disputed_by, disputed_at: s.disputed_at, dispute_status: s.dispute_status, deadline: s.dispute_deadline, active: s.has_active_dispute })}`);
  }
  {
    // rpc_open_dispute on a completed job is still refused by 20260915025607.
    const r = await as(db, POSTER, `SELECT public.rpc_open_dispute('${J.DONE}', '${REASON}', '{}'::text[]) AS id`);
    check(!r.ok && /job_already_completed/.test(r.err), `D2 rpc_open_dispute on completed: expected job_already_completed, got ${r.ok ? "success" : r.err}`);
  }
  {
    // helper_abort_job with work started: opens the dispute, then escalates it.
    const r = await as(db, HELPER, `SELECT public.helper_abort_job('${J.ABORT}', 'My truck broke down halfway through.') AS res`);
    const s = await row(db, J.ABORT);
    check(r.ok && r.rows[0].res.outcome === "disputed", `D3 helper_abort_job refused: ${r.ok ? JSON.stringify(r.rows[0].res) : r.err}`);
    check(s.status === "disputed" && s.dispute_status === "escalated" && s.disputed_by === HELPER, `D3 abort did not escalate: ${s.status}/${s.dispute_status}/${s.disputed_by}`);
  }
  {
    // rpc_escalate_dispute: the poster escalates a helper-filed dispute.
    const r = await as(db, POSTER, `SELECT public.rpc_escalate_dispute('${J.D_HELPER}') AS id`);
    const s = await row(db, J.D_HELPER);
    check(r.ok && s.dispute_status === "escalated", `D4 rpc_escalate_dispute refused: ${r.ok ? s.dispute_status : r.err}`);
  }
  {
    // rpc_withdraw_dispute: the opener withdraws; status leaves 'disputed'.
    const r = await as(db, POSTER, `SELECT public.rpc_withdraw_dispute('${J.D_WITHDRAW}')`);
    const s = await row(db, J.D_WITHDRAW);
    check(r.ok && s.status === "in_progress" && s.dispute_status === "resolved" && s.dispute_resolved_at, `D5 rpc_withdraw_dispute refused: ${r.ok ? `${s.status}/${s.dispute_status}` : r.err}`);
  }
  {
    // rpc_decide_dispute: an admin resolves the escalated dispute.
    const id = (await db.query(`SELECT id FROM public.disputes WHERE job_id = '${J.D_ESC}' AND status = 'open'`)).rows[0].id;
    const r = await as(db, ADMIN, `SELECT public.rpc_decide_dispute('${id}', 'Helpr did the work; release in full.', '{"poster":0,"helper":1}'::jsonb)`);
    const s = await row(db, J.D_ESC);
    check(r.ok && s.status === "completed" && s.dispute_status === "resolved" && s.dispute_resolved_at, `D6 rpc_decide_dispute refused: ${r.ok ? `${s.status}/${s.dispute_status}` : r.err}`);
  }
  {
    // AdminDisputes.tsx legacy fallback: an admin session closes a dispute directly.
    const r = await patch(db, ADMIN, J.D_ADMIN, "status = 'completed', dispute_resolved_at = now()");
    check(landed(r), `D7 admin direct dispute close refused: ${r.ok ? `${r.rows.length} rows` : r.err}`);
  }
  {
    // Service role: auto-resolve-disputes escalates a helper-filed dispute;
    // chargeDisputeCreated / transferReversed stamp a hold on a completed job.
    const r = await patch(db, "service", J.D_SVC, "dispute_status = 'escalated'");
    check(landed(r), `D8 service-role escalate refused: ${r.ok ? `${r.rows.length} rows` : r.err}`);
    const r2 = await patch(db, "service", J.DONE_SVC, "dispute_status = 'stripe_chargeback', disputed_at = now()");
    check(landed(r2), `D9 service-role chargeback hold refused: ${r2.ok ? `${r2.rows.length} rows` : r2.err}`);
    const r3 = await patch(db, "service", J.D_SVC, "status = 'completed', dispute_status = 'auto_resolved', dispute_resolved_at = now()");
    check(landed(r3), `D10 service-role auto-resolve settle refused: ${r3.ok ? `${r3.rows.length} rows` : r3.err}`);
  }
  {
    // The function: a trigger function nobody can call, and NOT security definer.
    const f = (await db.query(`SELECT prosecdef, proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure('public.enforce_dispute_markers_server_owned()')`)).rows[0];
    check(f && f.prosecdef === false, `E1 enforce_dispute_markers_server_owned must not be SECURITY DEFINER: ${JSON.stringify(f)}`);
    check(f && !/(^|[{,])(anon|authenticated)?=X/.test(f.acl ?? "{=X}"), `E2 enforce_dispute_markers_server_owned still callable: ${f?.acl}`);
  }
  return bad;
}

async function fresh(mig, times) {
  const db = new PGlite();
  await db.exec(LIVE);
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

// ── 1. BEFORE: the table door is open on the live shape ─────────────────────
{
  const db = await fresh("", 0);
  const show = async (label, who, job, set) => {
    const before = await row(db, job);
    const r = await patch(db, who, job, set);
    const after = await row(db, job);
    const moved = ["status", "payment_status", "disputed_at", "disputed_by", "dispute_status", "dispute_deadline"].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    console.log(`${landed(r) ? "LANDED " : "refused"} ${label}${landed(r) ? ` (changed: ${moved.join(", ")})` : `: ${r.err}`}`);
    return landed(r);
  };
  console.log("== BEFORE (live shape, no migration)");
  const hits = [
    await show("poster PATCH disputed_at on completed payout_pending job", POSTER, J.DONE, "disputed_at = now()"),
    await show("poster PATCH status=disputed on completed job", POSTER, J.DONE_H, "status = 'disputed'"),
    await show("helper PATCH disputed_by=poster on own dispute", HELPER, J.D_HELPER, `disputed_by = '${POSTER}'`),
    await show("helper PATCH escalated -> helper_responded", HELPER, J.D_ESC, "dispute_status = 'helper_responded'"),
    await show("poster PATCH status disputed -> in_progress", POSTER, J.D_POSTER, "status = 'in_progress'"),
  ];
  {
    const r = await as(db, POSTER, INSERT_WITH_MARKERS(J_NEW_POSTER, "born-disputed"));
    const s = r.ok ? await row(db, J_NEW_POSTER) : null;
    const kept = !!(s && s.disputed_at);
    console.log(`${kept ? "LANDED " : "refused"} poster POST /jobs with disputed_at set${kept ? ` (disputed_at=${s.disputed_at}, has_active_dispute=${s.has_active_dispute})` : `: ${r.err ?? "markers cleared"}`}`);
    hits.push(kept);
  }
  await db.close();
  const r = await run("live shape", "", 0);
  console.log(`expectations on the live shape: ${r.bad.length} failing`);
  if (!hits.every(Boolean) || r.bad.length === 0) { fail = true; console.log("FAIL: the hole did not reproduce on the live shape, so this probe proves nothing"); }
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
const mutate = (from, to, src = MIG) => {
  if (!src.includes(from)) throw new Error(`mutation anchor missing: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};
const broken = [
  ["trigger never created", mutate("  CREATE TRIGGER trg_dispute_markers_server_owned\n    BEFORE INSERT OR UPDATE OF status, disputed_at, disputed_by, dispute_status, dispute_deadline, dispute_resolved_at\n    ON public.jobs\n    FOR EACH ROW\n    EXECUTE FUNCTION public.enforce_dispute_markers_server_owned();\n", "  NULL;\n")],
  ["trigger on UPDATE only (the INSERT door)", mutate("BEFORE INSERT OR UPDATE OF status,", "BEFORE UPDATE OF status,")],
  ["INSERT branch does not clear the markers", mutate("    NEW.disputed_at         := NULL;\n", "")],
  ["carve-out lets the filer answer their own dispute", mutate("       AND OLD.disputed_by IS DISTINCT FROM OLD.helper_id THEN", "       THEN")],
  ["function made SECURITY DEFINER (current_user is always the owner)", mutate(" LANGUAGE plpgsql\n SET search_path TO 'public'\nAS $function$\nDECLARE\n  v_uid uuid;", " LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\nDECLARE\n  v_uid uuid;")],
  ["gate on auth.uid() instead of current_user (blocks the RPCs)", mutate("  IF current_user::text NOT IN ('authenticated', 'anon') THEN", "  IF auth.uid() IS NULL THEN")],
  ["no helper-response carve-out", mutate("    IF NEW.dispute_status = 'helper_responded'\n", "    IF false AND NEW.dispute_status = 'helper_responded'\n")],
  ["carve-out lets the helper write any dispute_status", mutate("       AND COALESCE(OLD.dispute_status, 'open') = 'open'\n", "")],
  ["admin exemption removed", mutate("    IF public.has_role(v_uid, 'admin'::app_role) THEN", "    IF false THEN")],
  ["status locked only INTO disputed, not out", mutate("'disputed' IN (NEW.status::text, OLD.status::text)", "NEW.status::text = 'disputed'")],
  ["disputed_by missing from UPDATE OF", mutate("OR UPDATE OF status, disputed_at, disputed_by,", "OR UPDATE OF status, disputed_at,")],
  ["dispute_deadline check removed", mutate("  IF NEW.dispute_deadline IS DISTINCT FROM OLD.dispute_deadline THEN", "  IF false THEN")],
  ["trigger function left callable by authenticated", mutate("FROM PUBLIC, anon, authenticated;", "FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public.enforce_dispute_markers_server_owned() TO authenticated;")],
];
console.log("\n== BROKEN COPIES (each must be caught)");
for (const [label, sql] of broken) {
  let r;
  try { r = await run(label, sql); } catch (e) { r = { bad: [`apply error: ${e.message}`] }; }
  if (r.bad.length === 0) { fail = true; console.log(`NOT CAUGHT: ${label}`); }
  else console.log(`caught: ${label}\n   ${r.bad.slice(0, 2).join("\n   ")}${r.bad.length > 2 ? `\n   (+${r.bad.length - 2} more)` : ""}`);
}

// ── 4. Skip path ────────────────────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  let ok = true;
  try { await db.exec(MIG); await db.exec(MIG); await db.exec(MIG); } catch (e) { ok = false; console.log("FAIL skip path:", e.message); }
  const trig = (await db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'trg_dispute_markers_server_owned'`)).rows[0].n;
  await db.close();
  if (!ok || trig !== 0) { fail = true; console.log("FAIL skip path: migration did not no-op on a database without public.jobs"); }
  else console.log("\nSKIP PATH: no public.jobs, applied 3x, no trigger, no error (green)");
}
{
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE public.jobs (id uuid, status text, disputed_at timestamptz, disputed_by uuid, dispute_status text, dispute_deadline timestamptz);");
  let err = null;
  try { await db.exec(MIG); } catch (e) { err = e.message; }
  await db.close();
  if (!err || !/expected 6 jobs columns, found 5/.test(err)) { fail = true; console.log(`FAIL loud path: a jobs table missing dispute_resolved_at did not fail the migration (${err ?? "no error"})`); }
  else console.log("LOUD PATH: jobs missing a marker column fails the migration (green)");
}

console.log(fail ? "\nPROBE FAILED" : "\nPROBE PASSED");
process.exit(fail ? 1 : 0);
