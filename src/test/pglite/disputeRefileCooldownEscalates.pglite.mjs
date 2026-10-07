#!/usr/bin/env node
/**
 * PGlite proof for 20261007040226_dispute_refile_cooldown_escalates (docs/OPEN.md Q1330).
 *
 *   node src/test/pglite/disputeRefileCooldownEscalates.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/disputeRefileCooldownEscalates.pglite.mjs # RED: the live body (20261005062746)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * rpc_open_dispute runs VERBATIM; open_dispute_as is the same stub as
 * disputeRefileCooldown.pglite.mjs (a NEW filing inserts an open row, a
 * filing while one is open appends). A withdrawal is what
 * rpc_withdraw_dispute writes: status 'withdrawn', decided_at.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE body (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPR = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const JOB = "20000000-0000-4000-8000-000000000001";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, status text);
CREATE TABLE public.disputes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, opener_id uuid, status text DEFAULT 'open',
  reason text, decided_at timestamptz, created_at timestamptz DEFAULT now());
CREATE FUNCTION public.open_dispute_as(_job_id uuid, _opener_id uuid, _reason text, _evidence_urls text[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE _id uuid;
BEGIN
  PERFORM 1 FROM public.jobs WHERE id = _job_id FOR UPDATE;
  SELECT id INTO _id FROM public.disputes WHERE job_id = _job_id AND status = 'open' LIMIT 1;
  IF _id IS NOT NULL THEN RETURN _id; END IF;
  INSERT INTO public.disputes (job_id, opener_id, reason) VALUES (_job_id, _opener_id, _reason) RETURNING id INTO _id;
  RETURN _id;
END $f$;
INSERT INTO public.jobs VALUES ('${JOB}', '${POSTER}', '${HELPR}', 'in_progress');
`);
await db.exec(read("../../../supabase/migrations/20261005062746_dispute_refile_cooldown.sql"));
if (MODE !== "skip") {
  const NEW = read("../../../supabase/migrations/20261007040226_dispute_refile_cooldown_escalates.sql");
  for (let i = 0; i < 3; i++) await db.exec(NEW);
}

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who}', false); SET ROLE authenticated;`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const file = (who) => as(who, `SELECT public.rpc_open_dispute('${JOB}', 'the work was not done as agreed at all', '{}') AS id`);
/**
 * Withdraw the open dispute `ago` ago; every EARLIER withdrawal by the opener
 * is pushed 3 days further back first, so the newest one is the one aged.
 */
const withdrawAged = async (who, ago) => {
  await db.exec(`UPDATE public.disputes SET decided_at = decided_at - interval '3 days' WHERE job_id = '${JOB}' AND opener_id = '${who}' AND status = 'withdrawn';
                 UPDATE public.disputes SET status = 'withdrawn', decided_at = now() - interval '${ago}' WHERE job_id = '${JOB}' AND status = 'open';`);
};
/** Re-age only the newest withdrawal (the one not pushed back). */
const setNewestAge = async (who, ago) => {
  await db.exec(`UPDATE public.disputes SET decided_at = now() - interval '${ago}'
                  WHERE id = (SELECT id FROM public.disputes WHERE job_id = '${JOB}' AND opener_id = '${who}' AND status = 'withdrawn' ORDER BY decided_at DESC LIMIT 1);`);
};
const refused = (r) => !r.ok && /dispute_refile_cooldown/.test(r.err);

// 1st withdrawal: 10 minutes.
{
  const a = await file(POSTER);
  check("L1 the first filing lands", a.ok, a.ok ? "" : a.err);
  await withdrawAged(POSTER, "9 minutes");
  check("R1 after the 1st withdrawal, 9 minutes later is refused", refused(await file(POSTER)));
  await setNewestAge(POSTER, "11 minutes");
  const b = await file(POSTER);
  check("L2 after the 1st withdrawal, 11 minutes later files", b.ok, b.ok ? "" : b.err);
}
// 2nd withdrawal: 1 hour.
{
  await withdrawAged(POSTER, "11 minutes");
  check("R2 after the 2nd withdrawal, 11 minutes later is REFUSED (was allowed by the flat 10 min)", refused(await file(POSTER)));
  await setNewestAge(POSTER, "59 minutes");
  check("R3 after the 2nd withdrawal, 59 minutes later is still refused", refused(await file(POSTER)));
  await setNewestAge(POSTER, "61 minutes");
  const c = await file(POSTER);
  check("L3 after the 2nd withdrawal, 61 minutes later files", c.ok, c.ok ? "" : c.err);
}
// 3rd withdrawal and later: 24 hours.
{
  await withdrawAged(POSTER, "61 minutes");
  check("R4 after the 3rd withdrawal, 61 minutes later is REFUSED", refused(await file(POSTER)));
  await setNewestAge(POSTER, "23 hours");
  check("R5 after the 3rd withdrawal, 23 hours later is still refused", refused(await file(POSTER)));
  await setNewestAge(POSTER, "25 hours");
  const d = await file(POSTER);
  check("L4 after the 3rd withdrawal, 25 hours later files", d.ok, d.ok ? "" : d.err);
  const append = await file(HELPR);
  check("L5 the other party's filing while one is open appends (never refused)", append.ok && append.rows[0].id === d.rows?.[0]?.id, append.ok ? "" : append.err);
}
{
  const r = await db.query(`SELECT has_function_privilege('authenticated', 'public.rpc_open_dispute(uuid,text,text[])', 'EXECUTE') a,
                                   has_function_privilege('anon', 'public.rpc_open_dispute(uuid,text,text[])', 'EXECUTE') n`);
  check("L6 grants: authenticated yes, anon no", r.rows[0].a === true && r.rows[0].n === false, JSON.stringify(r.rows[0]));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
