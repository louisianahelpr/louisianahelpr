#!/usr/bin/env node
/**
 * PGlite proof for 20260925154842_jobs_dispute_evidence_append_only (Q398).
 *
 *   node src/test/pglite/jobsDisputeEvidenceAppendOnly.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/jobsDisputeEvidenceAppendOnly.pglite.mjs   # RED: live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the LIVE jobs trigger chain, policies and grants
 * (scripts/probes/fixtures/dispute-table-door.live.sql, read from prod
 * 2026-09-14: status matrix, helper whitelist, poster money lock, field
 * escalation, cancellation, insert column lock, dispute deadline,
 * has_active_dispute, and the dispute RPCs), plus
 * enforce_dispute_markers_server_owned (20260915033734) and the NEWEST
 * public.dispute_evidence_url_ok (20260922172945) with its grants
 * (20260915071502). Roles are real: `SET ROLE authenticated` is PostgREST with
 * a user JWT, `service_role` an edge function, and the RPCs are SECURITY
 * DEFINER owned by the superuser, as on prod.
 *
 * The migration is applied 3x, then:
 *   - a party appending anything that is not their own
 *     `<uid>/disputes/<this job>/<file>` is refused: an upper-case `DISPUTES`
 *     folder (mutable under 20260925141905), a non-disputes proof path, a
 *     legacy signed URL of one, the other party's upload, another job's
 *     folder, a foreign host;
 *   - removing or replacing evidence already filed is refused;
 *   - a client INSERT cannot plant evidence on a new job;
 *   - a legit append (path or legacy signed URL, poster or Helpr) lands, and
 *     so do unrelated edits, a no-op rewrite, rpc_open_dispute's mirror and
 *     the service role.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const LIVE = read("../../../scripts/probes/fixtures/dispute-table-door.live.sql");
const MARKERS = read("../../../supabase/migrations/20260915033734_dispute_markers_server_owned.sql");
const VALIDATOR = read("../../../supabase/migrations/20260922172945_widen_dispute_evidence_url_ok_to_paths.sql");
const NEW = read("../../../supabase/migrations/20260925154842_jobs_dispute_evidence_append_only.sql");
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
const D = "10000000-0000-4000-8000-000000000005"; // disputed, open, poster filed
const LIVEJOB = "10000000-0000-4000-8000-000000000003"; // in_progress: rpc_open_dispute
const OTHER_JOB = "10000000-0000-4000-8000-0000000000ff";
const NEWJOB = "20000000-0000-4000-8000-000000000001";
const HOST = "https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/sign/proof-photos/";
const REASON = "The work was not finished as agreed on the day.";

const db = new PGlite();
await db.exec(LIVE);
await db.exec(MARKERS);
await db.exec(VALIDATOR);
// Grants as shipped by 20260915071502 (the newest GRANT/REVOKE on it).
await db.exec(`REVOKE ALL ON FUNCTION public.dispute_evidence_url_ok(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispute_evidence_url_ok(text, uuid, uuid) TO authenticated, service_role;`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);
await db.exec(`
INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');
INSERT INTO public.profiles (user_id, idv_status, is_seed) VALUES ('${POSTER}', 'verified', true);
INSERT INTO public.jobs (id, customer_id, helper_id, title, status, payment_status, stripe_session_id, budget, disputed_at, disputed_by, dispute_status, dispute_deadline, dispute_reason, dispute_evidence_urls) VALUES
  ('${D}',       '${POSTER}', '${HELPER}', 'poster filed', 'disputed',    'escrow', 'cs_5', 100, now() - interval '1 hour', '${POSTER}', 'open', now() + interval '71 hours', '${REASON}', ARRAY['${POSTER}/disputes/${D}/filed.jpg']),
  ('${LIVEJOB}', '${POSTER}', '${HELPER}', 'live',         'in_progress', 'escrow', 'cs_3', 100, NULL, NULL, NULL, NULL, NULL, '{}');
INSERT INTO public.disputes (job_id, opener_id, reason) VALUES ('${D}', '${POSTER}', '${REASON}');
`);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(who === "service" ? "SET ROLE service_role" : who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const evidence = async (job) => (await db.query(`SELECT dispute_evidence_urls AS e FROM public.jobs WHERE id = '${job}'`)).rows[0].e;
const q = (arr) => `ARRAY[${arr.map((s) => `'${s}'`).join(",")}]::text[]`;
// A PostgREST PATCH with .select("id"): the client sends the WHOLE array.
const setEvidence = (who, job, arr) => as(who, `UPDATE public.jobs SET dispute_evidence_urls = ${q(arr)} WHERE id = '${job}' RETURNING id`);
const landed = (r) => r.ok && r.rows.length === 1;

const refused = async (label, who, job, arr) => {
  const before = JSON.stringify(await evidence(job));
  const r = await setEvidence(who, job, arr);
  const after = JSON.stringify(await evidence(job));
  check(label, !landed(r) && before === after, r.ok ? `landed ${r.rows.length} row(s): ${after}` : r.err);
};
const lands = async (label, who, job, arr) => {
  const r = await setEvidence(who, job, arr);
  check(label, landed(r) && JSON.stringify(await evidence(job)) === JSON.stringify(arr), r.ok ? `${r.rows.length} row(s)` : r.err);
};

const FILED = `${POSTER}/disputes/${D}/filed.jpg`;

// ── Out-of-contract appends are refused (RED on live: every one lands) ──────
await refused("R1 poster appends an upper-case DISPUTES path (mutable folder)", POSTER, D, [FILED, `${POSTER}/DISPUTES/${D}/swap.jpg`]);
await refused("R2 poster appends a non-disputes proof path", POSTER, D, [FILED, `${POSTER}/${D}/before.jpg`]);
await refused("R3 poster appends a legacy signed URL of a non-disputes path", POSTER, D, [FILED, `${HOST}${POSTER}/${D}/before.jpg?token=t`]);
await refused("R4 poster appends the Helpr's upload as their own", POSTER, D, [FILED, `${HELPER}/disputes/${D}/theirs.jpg`]);
await refused("R5 poster appends their upload for another job", POSTER, D, [FILED, `${POSTER}/disputes/${OTHER_JOB}/x.jpg`]);
await refused("R6 Helpr appends a foreign host", HELPER, D, [FILED, "https://attacker.example/x.png"]);
await refused("R7 Helpr removes the poster's filed evidence", HELPER, D, []);
await refused("R8 poster replaces filed evidence with a fresh upload", POSTER, D, [`${POSTER}/disputes/${D}/replacement.jpg`]);
await refused("R9 admin session appends an unvalidated URL (no admin exemption)", ADMIN, D, [FILED, "https://attacker.example/x.png"]);
{
  const r = await as(POSTER, `INSERT INTO public.jobs (id, customer_id, title, status, budget, dispute_evidence_urls)
    VALUES ('${NEWJOB}', '${POSTER}', 'born with evidence', 'open', 100, ${q([`${POSTER}/DISPUTES/${NEWJOB}/planted.jpg`])}) RETURNING id`);
  const e = r.ok ? await evidence(NEWJOB) : null;
  check("R10 poster INSERT cannot plant evidence (cleared to {})", landed(r) && Array.isArray(e) && e.length === 0, r.ok ? JSON.stringify(e) : r.err);
}

// ── Legit writes keep working ───────────────────────────────────────────────
const P1 = `${POSTER}/disputes/${D}/more.jpg`;
const H1 = `${HELPER}/disputes/${D}/helper-side.jpg`;
const P2 = `${HOST}${POSTER}/disputes/${D}/legacy.jpg?token=eyJhbGci`;
await lands("L1 poster appends own disputes path", POSTER, D, [FILED, P1]);
await lands("L2 Helpr appends own disputes path (helper whitelist allows the column)", HELPER, D, [FILED, P1, H1]);
await lands("L3 poster appends a legacy signed URL of own disputes path", POSTER, D, [FILED, P1, H1, P2]);
await lands("L4 no-op rewrite of the same array", HELPER, D, [FILED, P1, H1, P2]);
{
  const r = await as(POSTER, `UPDATE public.jobs SET title = 'renamed' WHERE id = '${D}' RETURNING id`);
  check("L5 poster's unrelated edit", landed(r), r.ok ? "" : r.err);
  const r2 = await as(ADMIN, `UPDATE public.jobs SET title = 'admin renamed' WHERE id = '${D}' RETURNING id`);
  check("L6 admin's unrelated edit", landed(r2), r2.ok ? "" : r2.err);
}
{
  const path = `${POSTER}/disputes/${LIVEJOB}/1.jpg`;
  const r = await as(POSTER, `SELECT public.rpc_open_dispute('${LIVEJOB}', '${REASON}', ${q([path])}) AS id`);
  const e = await evidence(LIVEJOB);
  check("L7 rpc_open_dispute mirrors evidence onto jobs (SECURITY DEFINER)", r.ok && JSON.stringify(e) === JSON.stringify([path]), r.ok ? JSON.stringify(e) : r.err);
}
await lands("L8 service role rewrites the array (purge / migration tooling)", "service", D, ["anything"]);

// ── The function itself ────────────────────────────────────────────────────
if (MODE !== "skip") {
  const f = (await db.query(`SELECT prosecdef, proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure('public.enforce_jobs_dispute_evidence_append_only()')`)).rows[0];
  check("F1 trigger function is NOT SECURITY DEFINER (current_user is the caller)", f && f.prosecdef === false, JSON.stringify(f));
  check("F2 trigger function not EXECUTE-able by PUBLIC/anon/authenticated", f && !/(^|[{,])(anon|authenticated)?=X/.test(f.acl ?? "{=X}"), f?.acl);
  const t = (await db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'trg_jobs_dispute_evidence_append_only' AND NOT tgisinternal`)).rows[0].n;
  check("F3 exactly one trigger after 3 applies", t === 1, `n=${t}`);
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
