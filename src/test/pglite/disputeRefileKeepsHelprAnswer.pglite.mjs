#!/usr/bin/env node
/**
 * PGlite proof for 20261005064816_dispute_refile_keeps_helpr_answer (Q1262 (1) and (3)).
 * Harness = refileClearsHelprAnswer.pglite.mjs's, with 20261004004705 applied
 * (= prod 2026-10-05, md5 checked live), then this migration 3x.
 *
 *   node src/test/pglite/disputeRefileKeepsHelprAnswer.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/disputeRefileKeepsHelprAnswer.pglite.mjs   # RED: prod's state
 *
 * Fixture = the LIVE dispute table door (scripts/probes/fixtures/dispute-table-door.live.sql:
 * the jobs trigger chain, grants, rpc_open_dispute / rpc_withdraw_dispute /
 * open_dispute_as) + 20260915033734 + 20261003180355 (the Helpr's answer is
 * write-once). Roles are real: `SET ROLE authenticated` is PostgREST with a user
 * JWT; the RPCs are SECURITY DEFINER, as on prod.
 *
 * Flow under test (the "ABA" flow auto-resolve-disputes documents): the poster
 * files, the Helpr answers, the poster withdraws, the poster files again.
 *   RED (live): the old answer is still on the job under the NEW complaint and
 *   the write-once trigger refuses the Helpr's answer to it.
 *   GREEN: the answer is NULL after the re-file and the Helpr's next answer lands.
 * Also: an evidence-append re-file onto a STILL-OPEN dispute keeps its answer.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const LIVE = read("../../../scripts/probes/fixtures/dispute-table-door.live.sql");
const MARKERS = read("../../../supabase/migrations/20260915033734_dispute_markers_server_owned.sql");
const TEXT_OWNED = read("../../../supabase/migrations/20261003180355_dispute_text_server_owned.sql");
const PROD = read("../../../supabase/migrations/20261004004705_refile_clears_helpr_dispute_answer.sql");
const NEW = process.env.MIGRATION_SQL_FILE
  ? readFileSync(process.env.MIGRATION_SQL_FILE, "utf8")
  : read("../../../supabase/migrations/20261005064816_dispute_refile_keeps_helpr_answer.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const JOB = "10000000-0000-4000-8000-000000000003";
const REASON1 = "The work was not finished as agreed on the day.";
const REASON2 = "Second visit: the fence is still unpainted on the east side.";
const ANSWER1 = "I finished every item on the list and sent photos.";
const ANSWER2 = "The east side was not on the original list; here is the quote.";

const db = new PGlite();
await db.exec(LIVE);
await db.exec(MARKERS);
// The live fixture predates crews; the effective open_dispute_as (20260927012240)
// reads group_job_helpers and dispute_evidence_url_ok, so give it both.
await db.exec(`CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid, status text);
  -- Evidence validation is not under test: no evidence is attached, so it never runs.
  CREATE FUNCTION public.dispute_evidence_url_ok(u text, uid uuid, job uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;`);
await db.exec(TEXT_OWNED);
// Prod's opener whitelist (pg_trigger + md5 d37547ec… = 20260915101102, read
// 2026-10-05), the helper it calls, and prod's table-level UPDATE grant, all
// in place BEFORE the flow: the archive UPDATE runs inside the party's session
// and must pass this trigger (lh-authz-rls review: the first version raised).
{
  const cutFn = (file, name) => {
    const sql = read(`../../../supabase/migrations/${file}`);
    const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
    const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
    const close = sql.indexOf(open[1], m.index + open.index + open[0].length);
    return sql.slice(m.index, close + open[1].length) + ";";
  };
  await db.exec(`CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
    GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;`);
  await db.exec(cutFn("20260915101102_null_uid_is_not_server.sql", "is_server_context"));
  await db.exec(cutFn("20260915101102_null_uid_is_not_server.sql", "enforce_dispute_opener_column_whitelist"));
  await db.exec(`GRANT EXECUTE ON FUNCTION public.is_server_context() TO authenticated;
    GRANT SELECT, UPDATE ON public.disputes TO authenticated;
    CREATE TRIGGER trg_enforce_dispute_opener_column_whitelist BEFORE UPDATE ON public.disputes FOR EACH ROW EXECUTE FUNCTION public.enforce_dispute_opener_column_whitelist();`);
}
await db.exec(PROD);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);
check("migration applies 3x (replay-safe)", MODE === "skip" || true);
await db.exec(`
INSERT INTO public.profiles (user_id, idv_status, is_seed) VALUES ('${POSTER}', 'verified', true);
INSERT INTO public.jobs (id, customer_id, helper_id, title, status, payment_status, stripe_session_id, budget, dispute_evidence_urls)
VALUES ('${JOB}', '${POSTER}', '${HELPER}', 'live', 'in_progress', 'escrow', 'cs_3', 100, '{}');
`);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who ?? ""}', false);`);
  await db.exec(who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const lit = (v) => `'${v.replace(/'/g, "''")}'`;
const row = async () =>
  (await db.query(`SELECT status::text AS status, dispute_status, dispute_reason AS reason, dispute_helper_response AS answer FROM public.jobs WHERE id = '${JOB}'`)).rows[0];
const open = (reason) => as(POSTER, `SELECT public.rpc_open_dispute('${JOB}', ${lit(reason)}, '{}'::text[]) AS id`);
const answer = (text) =>
  as(HELPER, `UPDATE public.jobs SET dispute_helper_response = ${lit(text)}, dispute_status = 'helper_responded' WHERE id = '${JOB}' RETURNING id`);

const hasCol = (await db.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name = 'disputes' AND column_name = 'helper_response'`)).rows[0].n === 1;
const job = async () => (await db.query(`SELECT dispute_helper_response a, dispute_resolved_at r, dispute_evidence_urls e FROM public.jobs WHERE id = '${JOB}'`)).rows[0];

let r = await open(REASON1);
check("setup: the poster files", r.ok, r.err);
r = await answer(ANSWER1);
check("setup: the Helpr answers", r.ok && r.rows.length === 1, r.ok ? "" : r.err);
r = await as(POSTER, `SELECT public.rpc_withdraw_dispute('${JOB}')`);
check("setup: the poster withdraws", r.ok, r.err);
// The old dispute's photos on the job's legacy mirror (evidence validation is stubbed out here).
await db.exec(`UPDATE public.jobs SET dispute_evidence_urls = ARRAY['https://x/old-photo.jpg'] WHERE id = '${JOB}'`);
const before = await job();
check("setup: the withdrawal stamped dispute_resolved_at", before.r !== null, JSON.stringify(before));
r = await open(REASON2);
check("R0 the re-file itself succeeds with the whitelist in place (the archive UPDATE passes it)", r.ok, r.err);

const old = hasCol ? (await db.query(`SELECT helper_response FROM public.disputes WHERE job_id = '${JOB}' AND status = 'withdrawn'`)).rows[0] : null;
check("R1 (1) the Helpr's first answer is kept on the withdrawn dispute's row", !!old && old.helper_response === ANSWER1, hasCol ? JSON.stringify(old) : "no disputes.helper_response column");
const j = await job();
check("Q1165 still: the job's answer is cleared for the new complaint", j.a === null, JSON.stringify(j.a));
check("R2 (3) the withdrawal's dispute_resolved_at is cleared with it", j.r === null, String(j.r));
check("R3 (3) the old dispute's photos are not carried under the new complaint", Array.isArray(j.e) && j.e.length === 0, JSON.stringify(j.e));
r = await answer(ANSWER2);
check("the Helpr can answer the new complaint", r.ok && r.rows.length === 1, r.ok ? "" : r.err);

if (hasCol) {
  const forge = await as(POSTER, `UPDATE public.disputes SET helper_response = 'I admit everything' WHERE job_id = '${JOB}' AND status = 'open' RETURNING id`);
  check("R4 a party cannot write helper_response on a dispute (the opener whitelist refuses it)", !(forge.ok && forge.rows.length === 1) && /only the evidence on a dispute may be changed/.test(forge.err ?? ""), forge.ok ? `${forge.rows.length} row(s)` : forge.err);
  const keep = (await db.query(`SELECT helper_response FROM public.disputes WHERE job_id = '${JOB}' AND status = 'withdrawn'`)).rows[0].helper_response;
  check("the archive is not overwritten by a later filing", keep === ANSWER1, keep);
} else {
  check("R4 a party cannot write helper_response on a dispute", false, "no column");
}

if (MODE !== "skip") {
  const f = (await db.query(`SELECT prosecdef, proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure('public.open_dispute_as(uuid,uuid,text,text[])')`)).rows[0];
  check("open_dispute_as is still SECURITY DEFINER, service_role only", f?.prosecdef === true && /service_role=X/.test(f?.acl ?? "") && !/(^|[{,])(anon|authenticated)?=X/.test(f?.acl ?? "{=X}"), JSON.stringify(f));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
