#!/usr/bin/env node
/**
 * PGlite proof for 20261004004705_refile_clears_helpr_dispute_answer (Q1165).
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/refileClearsHelprAnswer.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/refileClearsHelprAnswer.pglite.mjs   # RED: live state
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
const NEW = read("../../../supabase/migrations/20261004004705_refile_clears_helpr_dispute_answer.sql");
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

// 1. File, answer.
let r = await open(REASON1);
check("poster files the first dispute", r.ok, r.err);
r = await answer(ANSWER1);
check("the Helpr answers it", r.ok && r.rows.length === 1, r.ok ? `${r.rows.length} row(s)` : r.err);
let j = await row();
check("setup: the answer is on file", j.answer === ANSWER1, JSON.stringify(j));

// 2. Re-filing onto the STILL-OPEN dispute (evidence append) leaves its answer.
r = await open(REASON1 + " (more detail)");
j = await row();
check("a re-file onto the still-open dispute keeps its answer", r.ok && j.answer === ANSWER1, r.err ?? JSON.stringify(j));

// 3. Withdraw, re-file.
r = await as(POSTER, `SELECT public.rpc_withdraw_dispute('${JOB}')`);
check("poster withdraws the dispute", r.ok, r.err);
r = await open(REASON2);
check("poster files a NEW dispute", r.ok, r.err);
j = await row();
check("the new dispute carries the NEW complaint", j.status === "disputed" && j.reason === REASON2, JSON.stringify(j));
check("Q1165: the withdrawn dispute's answer is gone (NULL) under the new complaint", j.answer === null, JSON.stringify(j.answer));
r = await answer(ANSWER2);
j = await row();
check("Q1165: the Helpr can answer the new complaint", r.ok && r.rows.length === 1 && j.answer === ANSWER2, r.ok ? JSON.stringify(j) : r.err);
r = await answer("rewriting my answer");
check("the answer is still write-once afterwards", !r.ok || r.rows.length !== 1, r.err);

// 4. The function itself.
if (MODE !== "skip") {
  const f = (await db.query(`SELECT prosecdef, proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure('public.open_dispute_as(uuid,uuid,text,text[])')`)).rows[0];
  check("open_dispute_as is still SECURITY DEFINER", f?.prosecdef === true, JSON.stringify(f));
  check("open_dispute_as not EXECUTE-able by PUBLIC/anon/authenticated", f && !/(^|[{,])(anon|authenticated)?=X/.test(f.acl ?? "{=X}"), f?.acl);
  check("open_dispute_as is EXECUTE-able by service_role", /service_role=X/.test(f?.acl ?? ""), f?.acl);
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
