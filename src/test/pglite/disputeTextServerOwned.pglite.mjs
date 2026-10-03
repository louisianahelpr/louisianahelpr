#!/usr/bin/env node
/**
 * PGlite proof for 20261003180355_dispute_text_server_owned (Q966).
 *
 *   node src/test/pglite/disputeTextServerOwned.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/disputeTextServerOwned.pglite.mjs   # RED: live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the LIVE jobs trigger chain, policies and grants
 * (scripts/probes/fixtures/dispute-table-door.live.sql: status matrix, helper
 * whitelist, poster money lock, field escalation, cancellation, insert column
 * lock, dispute deadline, has_active_dispute, and the dispute RPCs), plus the
 * live enforce_dispute_markers_server_owned (20260915033734). Roles are real:
 * `SET ROLE authenticated` is PostgREST with a user JWT, `service_role` an
 * edge function, and the RPCs are SECURITY DEFINER owned by the superuser, as
 * on prod.
 *
 * The migration is applied 3x, then:
 *   - neither party can write jobs.dispute_reason (rewrite, blank, plant on a
 *     job with no dispute, or smuggle it beside the Helpr's one allowed
 *     dispute_status write), and an INSERT cannot plant it;
 *   - the poster cannot overwrite or blank the Helpr's response, nor write it on
 *     a disputed job with no helper_id (crew job / deleted Helpr: the NULL
 *     must refuse, not skip), and the Helpr cannot rewrite it once on file,
 *     answer a dispute they filed, or answer on a job that is not disputed;
 *     an INSERT cannot plant it;
 *   - the 20260915033734 locks still hold (status into 'disputed',
 *     disputed_at);
 *   - the legit writes land: the Helpr's first answer (open and escalated),
 *     rpc_open_dispute filing the reason, an admin edit, the service role,
 *     a poster's unrelated edit and a no-op rewrite.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const LIVE = read("../../../scripts/probes/fixtures/dispute-table-door.live.sql");
const MARKERS = read("../../../supabase/migrations/20260915033734_dispute_markers_server_owned.sql");
const NEW = read("../../../supabase/migrations/20261003180355_dispute_text_server_owned.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const PF = "10000000-0000-4000-8000-000000000005"; // disputed, open, poster filed, no response yet
const ANSWERED = "10000000-0000-4000-8000-000000000006"; // disputed, helper_responded, response on file
const HF = "10000000-0000-4000-8000-000000000007"; // disputed, open, HELPR filed
const ESC = "10000000-0000-4000-8000-000000000008"; // disputed, escalated, poster filed, no response
const DONE = "10000000-0000-4000-8000-000000000009"; // completed, payout_pending, no dispute
const CREW = "10000000-0000-4000-8000-00000000000a"; // disputed, open, poster filed, helper_id NULL (crew job / deleted Helpr)
const LIVEJOB = "10000000-0000-4000-8000-000000000003"; // in_progress: rpc_open_dispute
const NEWJOB = "20000000-0000-4000-8000-000000000001";
const REASON = "The work was not finished as agreed on the day.";
const ANSWER = "I finished every item on the list and sent photos.";

const db = new PGlite();
await db.exec(LIVE);
await db.exec(MARKERS);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);
await db.exec(`
INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');
INSERT INTO public.profiles (user_id, idv_status, is_seed) VALUES ('${POSTER}', 'verified', true);
INSERT INTO public.jobs (id, customer_id, helper_id, title, status, payment_status, stripe_session_id, budget, disputed_at, disputed_by, dispute_status, dispute_deadline, dispute_reason, dispute_helper_response, dispute_evidence_urls) VALUES
  ('${PF}',       '${POSTER}', '${HELPER}', 'poster filed',   'disputed',    'escrow',         'cs_5', 100, now() - interval '1 hour', '${POSTER}', 'open',             now() + interval '71 hours', '${REASON}', NULL,        '{}'),
  ('${ANSWERED}', '${POSTER}', '${HELPER}', 'answered',       'disputed',    'escrow',         'cs_6', 100, now() - interval '2 hour', '${POSTER}', 'helper_responded', now() + interval '70 hours', '${REASON}', '${ANSWER}', '{}'),
  ('${HF}',       '${POSTER}', '${HELPER}', 'helper filed',   'disputed',    'escrow',         'cs_7', 100, now() - interval '1 hour', '${HELPER}', 'open',             now() + interval '71 hours', 'Poster never paid the extra hour.', NULL, '{}'),
  ('${ESC}',      '${POSTER}', '${HELPER}', 'escalated',      'disputed',    'escrow',         'cs_8', 100, now() - interval '1 hour', '${POSTER}', 'escalated',        now() + interval '71 hours', '${REASON}', NULL,        '{}'),
  ('${DONE}',     '${POSTER}', '${HELPER}', 'done',           'completed',   'payout_pending', 'cs_9', 100, NULL, NULL, NULL, NULL, NULL, NULL, '{}'),
  ('${CREW}',     '${POSTER}', NULL,        'helperless',     'disputed',    'escrow',         'cs_a', 100, now() - interval '1 hour', '${POSTER}', 'open',             now() + interval '71 hours', '${REASON}', NULL,        '{}'),
  ('${LIVEJOB}',  '${POSTER}', '${HELPER}', 'live',           'in_progress', 'escrow',         'cs_3', 100, NULL, NULL, NULL, NULL, NULL, NULL, '{}');
INSERT INTO public.disputes (job_id, opener_id, reason) VALUES ('${PF}', '${POSTER}', '${REASON}');
`);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(who === "service" ? "SET ROLE service_role" : who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const row = async (job) =>
  (await db.query(`SELECT status::text AS status, disputed_at, dispute_status, dispute_reason AS reason, dispute_helper_response AS answer FROM public.jobs WHERE id = '${job}'`)).rows[0];
const lit = (v) => (v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`);
// A PostgREST PATCH with .select("id").
const patch = (who, job, set) => as(who, `UPDATE public.jobs SET ${set} WHERE id = '${job}' RETURNING id`);
const landed = (r) => r.ok && r.rows.length === 1;

const refused = async (label, who, job, set) => {
  const before = JSON.stringify(await row(job));
  const r = await patch(who, job, set);
  const after = JSON.stringify(await row(job));
  check(label, !landed(r) && before === after, r.ok ? `landed ${r.rows.length} row(s): ${after}` : r.err);
};
const lands = async (label, who, job, set, expect) => {
  const r = await patch(who, job, set);
  const now = await row(job);
  const ok = landed(r) && Object.entries(expect).every(([k, v]) => now[k] === v);
  check(label, ok, r.ok ? `${r.rows.length} row(s): ${JSON.stringify(now)}` : r.err);
};

// ── dispute_reason: no party writes it (RED on live: every one lands) ───────
await refused("R1 poster rewrites the complaint they filed", POSTER, PF, `dispute_reason = 'Actually it was fine.'`);
await refused("R2 Helpr rewrites the poster's complaint", HELPER, PF, `dispute_reason = 'No complaint.'`);
await refused("R3 Helpr blanks the poster's complaint", HELPER, PF, `dispute_reason = NULL`);
await refused("R4 poster plants a complaint on a completed job with no dispute", POSTER, DONE, `dispute_reason = 'planted'`);
await refused(
  "R5 Helpr smuggles a new reason beside the one allowed dispute_status write",
  HELPER, PF, `dispute_helper_response = ${lit(ANSWER)}, dispute_status = 'helper_responded', dispute_reason = 'rewritten'`,
);

// ── dispute_helper_response: only the Helpr's first answer ─────────────────
await refused("R6 poster overwrites the Helpr's answer", POSTER, ANSWERED, `dispute_helper_response = 'I admit it.'`);
await refused("R7 poster blanks the Helpr's answer", POSTER, ANSWERED, `dispute_helper_response = NULL`);
await refused("R8 Helpr rewrites their answer after it is on file", HELPER, ANSWERED, `dispute_helper_response = 'a different story'`);
await refused("R9 Helpr 'answers' a dispute they filed", HELPER, HF, `dispute_helper_response = 'my own complaint again'`);
await refused("R10 Helpr writes an answer on a job that is not disputed", HELPER, DONE, `dispute_helper_response = 'pre-emptive'`);
await refused("R11 poster writes the Helpr's answer before the Helpr does", POSTER, ESC, `dispute_helper_response = 'Helpr agrees to a full refund.'`);
// lh-authz-rls review 2026-10-03: with helper_id NULL, `v_uid = OLD.helper_id`
// is NULL, so `IF NOT (...)` was NULL and skipped the RAISE (fail-open).
await refused("R13 poster writes the crew's answer on a helperless disputed job", POSTER, CREW, `dispute_helper_response = 'The crew agrees to a full refund.'`);
{
  const r = await as(POSTER, `INSERT INTO public.jobs (id, customer_id, title, status, budget, dispute_reason, dispute_helper_response)
    VALUES ('${NEWJOB}', '${POSTER}', 'born with a dispute record', 'open', 100, 'planted reason', 'planted answer') RETURNING id`);
  const j = r.ok ? await row(NEWJOB) : null;
  check("R12 poster INSERT cannot plant either text (both cleared)", landed(r) && j?.reason === null && j?.answer === null, r.ok ? JSON.stringify(j) : r.err);
}

// ── 20260915033734's locks still hold ──────────────────────────────────────
await refused("S1 poster moves a completed job into 'disputed'", POSTER, DONE, `status = 'disputed'`);
await refused("S2 poster stamps disputed_at on a completed job", POSTER, DONE, `disputed_at = now()`);

// ── Legit writes keep working ───────────────────────────────────────────────
await lands(
  "L1 Helpr answers an open poster-filed dispute (DisputedSection payload)",
  HELPER, PF, `dispute_helper_response = ${lit(ANSWER)}, dispute_status = 'helper_responded'`,
  { answer: ANSWER, dispute_status: "helper_responded", reason: REASON },
);
await lands(
  "L2 Helpr answers an escalated dispute (response only; status stays escalated)",
  HELPER, ESC, `dispute_helper_response = ${lit(ANSWER)}`,
  { answer: ANSWER, dispute_status: "escalated" },
);
await lands("L3 poster's unrelated edit on a disputed job", POSTER, PF, `title = 'renamed'`, { reason: REASON });
await lands("L4 no-op rewrite of the same reason", POSTER, PF, `dispute_reason = ${lit(REASON)}`, { reason: REASON });
await lands("L5 admin edits the reason (admin exempt)", ADMIN, PF, `dispute_reason = 'admin note'`, { reason: "admin note" });
await lands("L6 admin clears the Helpr's answer (admin exempt)", ADMIN, ANSWERED, `dispute_helper_response = NULL`, { answer: null });
await lands(
  "L7 service role rewrites the reason (auto-resolve-disputes)",
  "service", PF, `dispute_reason = '[AUTO-RESOLVED] Original: x'`, { reason: "[AUTO-RESOLVED] Original: x" },
);
{
  const r = await as(POSTER, `SELECT public.rpc_open_dispute('${LIVEJOB}', ${lit(REASON)}, '{}'::text[]) AS id`);
  const j = await row(LIVEJOB);
  check("L8 rpc_open_dispute files the reason (SECURITY DEFINER)", r.ok && j.reason === REASON && j.status === "disputed", r.ok ? JSON.stringify(j) : r.err);
}

// ── The function and trigger themselves ─────────────────────────────────────
if (MODE !== "skip") {
  const f = (await db.query(`SELECT prosecdef, proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure('public.enforce_dispute_markers_server_owned()')`)).rows[0];
  check("F1 trigger function is NOT SECURITY DEFINER (current_user is the caller)", f && f.prosecdef === false, JSON.stringify(f));
  check("F2 trigger function not EXECUTE-able by PUBLIC/anon/authenticated", f && !/(^|[{,])(anon|authenticated)?=X/.test(f.acl ?? "{=X}"), f?.acl);
  const t = (await db.query(`SELECT count(*)::int AS n, max(pg_get_triggerdef(oid)) AS def FROM pg_trigger WHERE tgname = 'trg_dispute_markers_server_owned' AND NOT tgisinternal`)).rows[0];
  check("F3 exactly one trigger after 3 applies", t.n === 1, `n=${t.n}`);
  check("F4 the trigger fires on an UPDATE naming only dispute_reason or dispute_helper_response",
    /UPDATE OF [^O]*\bdispute_reason\b/.test(t.def) && /UPDATE OF [^O]*\bdispute_helper_response\b/.test(t.def), t.def);
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
