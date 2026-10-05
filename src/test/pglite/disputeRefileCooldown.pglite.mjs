#!/usr/bin/env node
/**
 * PGlite proof for 20261005062746_dispute_refile_cooldown (docs/OPEN.md Q1244).
 *
 *   node src/test/pglite/disputeRefileCooldown.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/disputeRefileCooldown.pglite.mjs # RED: the live body
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * rpc_open_dispute is run VERBATIM (the live body from 20260912023326 under
 * skip, the new one otherwise). open_dispute_as is a stub with the two shapes
 * this depends on: a NEW filing inserts an open disputes row, and a filing
 * while one is open appends to it (no new row). A withdrawal is what
 * rpc_withdraw_dispute writes: status 'withdrawn', decided_at = now().
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE body (expect FAILs)`);

function cut(file, name) {
  const sql = read(`../../../supabase/migrations/${file}`);
  const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const bodyStart = m.index + open.index + open[0].length;
  const close = sql.indexOf(open[1], bodyStart);
  return sql.slice(m.index, close + open[1].length) + ";";
}

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
  UPDATE public.jobs SET status = 'disputed' WHERE id = _job_id;
  RETURN _id;
END $f$;
INSERT INTO public.jobs VALUES ('${JOB}', '${POSTER}', '${HELPR}', 'in_progress');
`);
const LIVE = cut("20260912023326_system_open_dispute_on_undelivered_revision.sql", "rpc_open_dispute");
await db.exec(LIVE);
await db.exec(`REVOKE ALL ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) TO authenticated;`);
if (MODE !== "skip") {
  const NEW = read("../../../supabase/migrations/20261005062746_dispute_refile_cooldown.sql");
  for (let i = 0; i < 3; i++) await db.exec(NEW);
}

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who}', false); SET ROLE authenticated;`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const file = (who) => as(who, `SELECT public.rpc_open_dispute('${JOB}', 'the work was not done as agreed at all', '{}') AS id`);
const withdraw = async (ago = "0 minutes") => {
  await db.exec(`UPDATE public.disputes SET status = 'withdrawn', decided_at = now() - interval '${ago}' WHERE job_id = '${JOB}' AND status = 'open';
                 UPDATE public.jobs SET status = 'in_progress' WHERE id = '${JOB}';`);
};
const rows = async () => (await db.query(`SELECT count(*)::int n FROM public.disputes WHERE job_id = '${JOB}'`)).rows[0].n;

{
  const a = await file(POSTER);
  check("L1 the first filing lands", a.ok, a.ok ? "" : a.err);
  const again = await file(POSTER);
  check("L2 filing again while it is open appends (same id, no new row)", again.ok && again.rows[0].id === a.rows[0].id && (await rows()) === 1, again.ok ? `${await rows()} rows` : again.err);
  await withdraw();
  const loop = await file(POSTER);
  check("R1 re-filing right after withdrawing is refused with dispute_refile_cooldown", !loop.ok && /dispute_refile_cooldown/.test(loop.err), loop.ok ? `landed: ${await rows()} rows` : loop.err);
  check("R2 ...and no new disputes row was written", (await rows()) === 1, `${await rows()} rows`);
  const other = await file(HELPR);
  check("L3 the OTHER party may still file (their grievance is new)", other.ok, other.ok ? "" : other.err);
}
{
  await withdraw("11 minutes");
  const later = await file(HELPR);
  check("L4 after the 10-minute window the opener may file again", later.ok, later.ok ? "" : later.err);
  await db.exec(`UPDATE public.disputes SET status = 'withdrawn', decided_at = now() - interval '9 minutes' WHERE job_id = '${JOB}' AND status = 'open'; UPDATE public.jobs SET status = 'in_progress' WHERE id = '${JOB}';`);
  const inside = await file(HELPR);
  check("R3 at 9 minutes it is still refused", !inside.ok && /dispute_refile_cooldown/.test(inside.err), inside.ok ? "landed" : inside.err);
}
{
  const acl = (await db.query(`SELECT has_function_privilege('authenticated', 'public.rpc_open_dispute(uuid,text,text[])', 'EXECUTE') a, has_function_privilege('anon', 'public.rpc_open_dispute(uuid,text,text[])', 'EXECUTE') n`)).rows[0];
  check("L5 grants: authenticated yes, anon no", acl.a === true && acl.n === false, JSON.stringify(acl));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
