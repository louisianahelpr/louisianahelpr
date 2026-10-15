#!/usr/bin/env node
/**
 * PGlite proof for 20261015022636_job_payout_hold (docs/OPEN.md Q1491): a job
 * in public.job_payout_holds pays nobody (every payout claim on it is refused
 * by refuse_payout_claim_while_held) until an admin releases it.
 *
 *   node src/test/pglite/jobPayoutHold.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/jobPayoutHold.pglite.mjs   # RED: live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = prod's code: each function is its NEWEST definition in the
 * migrations before the one under test, checked by md5(prosrc) against the
 * values read live on 2026-10-15, or the proof refuses to run. In skip mode the
 * hold row is written to a stand-in table (the live database has none), which
 * is exactly the live behaviour: nothing reads it.
 * NOT modelled: RLS on the other tables, the money-audit trigger.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const UNDER_TEST = "20261015022636_job_payout_hold.sql";
const read = (f) => readFileSync(MIG_DIR + f, "utf8");
const FIXED = (process.env.NEW_MIGRATION ?? "") !== "skip";
if (!FIXED) console.log("NEW_MIGRATION=skip: running against the LIVE (unfixed) state (expect FAILs)");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const LIVE_MD5 = {
  is_server_context: "ebc78d554c09d9ebf387992e83d584c8",
  has_role: "3b6d045ac9c33d0e7097904c98294ac0",
  refuse_payout_claim_while_held: "a7b0c1958994ef1e9b426a72fc434092",
};
function newestStatement(name, files) {
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`, "gi");
  let found = null;
  for (const f of files) {
    const sql = read(f);
    for (const m of sql.matchAll(head)) {
      const tag = /AS\s+(\$\w*\$)/i.exec(sql.slice(m.index))[1];
      const open = sql.indexOf(tag, m.index);
      const close = sql.indexOf(tag, open + tag.length);
      found = { file: f, stmt: `${sql.slice(m.index, close + tag.length)};` };
    }
  }
  if (!found) throw new Error(`no migration defines public.${name}`);
  return found;
}
const before = readdirSync(MIG_DIR).filter((f) => /^\d{14}_.+\.sql$/.test(f) && f < UNDER_TEST).sort();

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const POSTER = "bbbbbbbb-0000-4000-8000-000000000001";
const HELPR = "bbbbbbbb-0000-4000-8000-000000000002";
const HELD = "dddddddd-0000-4000-8000-000000000001";
const OTHER = "dddddddd-0000-4000-8000-000000000002";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid);
CREATE TABLE public.payout_holds (helper_id uuid PRIMARY KEY, reason text);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE TABLE public.admin_audit_log (admin_id uuid, action text, target_id text, target_type text, details jsonb);
CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text, stripe_transfer_id text);
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.jobs VALUES ('${HELD}', '${POSTER}', '${HELPR}'), ('${OTHER}', '${POSTER}', '${HELPR}');
`);
const from = {};
for (const name of Object.keys(LIVE_MD5)) {
  const s = newestStatement(name, before);
  from[name] = s.file;
  await db.exec(s.stmt);
}
await db.exec(`CREATE TRIGGER refuse_payout_claim_while_held BEFORE INSERT ON public.payout_transfers FOR EACH ROW EXECUTE FUNCTION public.refuse_payout_claim_while_held();`);
let fixtureOk = true;
for (const [name, want] of Object.entries(LIVE_MD5)) {
  const got = (await db.query(`SELECT md5(prosrc) AS m FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace`, [name])).rows[0]?.m;
  if (got !== want) { fixtureOk = false; check(`fixture: public.${name} is prod's code`, false, `md5 ${got} != ${want} (${from[name]})`); }
}
if (!fixtureOk) { console.log("REFUSING TO RUN: the fixture is not prod's code"); process.exit(1); }
check("fixture: every function is prod's code (md5 of prosrc)", true, `${Object.keys(LIVE_MD5).length} functions`);

if (FIXED) for (let i = 0; i < 3; i++) await db.exec(read(UNDER_TEST));
else await db.exec(`CREATE TABLE public.job_payout_holds (job_id uuid PRIMARY KEY, reason text NOT NULL, held_at timestamptz DEFAULT now(), held_by uuid)`);

const run = async (sql) => { try { const r = await db.query(sql); return { ok: true, rows: r.rows }; } catch (e) { return { ok: false, err: e.message }; } };
async function as(uid, role, sql) {
  await db.exec(`SELECT set_config('request.uid', '${uid}', false), set_config('request.role', '${role}', false)`);
  if (role === "authenticated") await db.exec("SET ROLE authenticated");
  try { return await run(sql); } finally { await db.exec("RESET ROLE"); await db.exec(`SELECT set_config('request.uid', '', false), set_config('request.role', '', false)`); }
}
const claim = (job) => run(`INSERT INTO public.payout_transfers (job_id, helper_id, status) VALUES ('${job}', '${HELPR}', 'pending') RETURNING id`);

// The webhook's hold (stripe-webhook, service role).
await run(`INSERT INTO public.job_payout_holds (job_id, reason) VALUES ('${HELD}', 'Q1491: test')`);
{
  const r = await claim(HELD);
  check("H1 a payout claim on a held job is refused (payout_held)", !r.ok && /payout_held/.test(r.err), r.ok ? "claimed" : r.err);
  const r2 = await claim(OTHER);
  check("H2 the hold is per job: another job of the same Helpr still pays", r2.ok, r2.err ?? "");
  const r3 = await run(`INSERT INTO public.payout_transfers (job_id, helper_id, status, stripe_transfer_id) VALUES ('${HELD}', '${HELPR}', 'paid', 'tr_1')`);
  check("H3 control: recording an already-made transfer is not a claim and is not refused", r3.ok, r3.err ?? "");
}
if (FIXED) {
  const n = await as(HELPR, "authenticated", `SELECT public.admin_release_job_payout_hold('${HELD}') AS v`);
  check("H4 a non-admin cannot release the hold", !n.ok && /admin_only/.test(n.err), n.ok ? "released" : n.err);
  const sel = await as(HELPR, "authenticated", `SELECT count(*) FROM public.job_payout_holds`);
  check("H5 the hold table is server-only (no client SELECT)", !sel.ok && /permission denied/.test(sel.err), sel.ok ? "readable" : sel.err);
  const a = await as(ADMIN, "authenticated", `SELECT public.admin_release_job_payout_hold('${HELD}') AS v`);
  check("H6 an admin releases it, and the release is audited", a.ok && a.rows[0].v === true &&
    (await db.query(`SELECT count(*)::int AS n FROM public.admin_audit_log WHERE action = 'job_payout_hold_released' AND target_id = $1`, [HELD])).rows[0].n === 1,
    a.ok ? "" : a.err);
  const r = await claim(HELD);
  check("H7 once released, the job pays", r.ok, r.err ?? "");
  const again = await as(ADMIN, "authenticated", `SELECT public.admin_release_job_payout_hold('${HELD}') AS v`);
  check("H8 releasing a job with no hold says so (false) and writes no audit row", again.ok && again.rows[0].v === false, again.ok ? "" : again.err);
  // The SQL editor (a server context: no uid, role postgres) can release too,
  // audited with no admin id (lh-money-escrow review: an admin-only check left
  // an unaudited DELETE as ops' only way out).
  await run(`INSERT INTO public.job_payout_holds (job_id, reason) VALUES ('${OTHER}', 'Q1491: test 2')`);
  const sq = await run(`SELECT public.admin_release_job_payout_hold('${OTHER}') AS v`);
  const audit = (await db.query(`SELECT admin_id, details->>'released_by' AS by FROM public.admin_audit_log WHERE target_id = $1`, [OTHER])).rows;
  check("H9 the SQL editor releases a hold, audited as a server release", sq.ok && sq.rows[0].v === true && audit.length === 1 && audit[0].admin_id === null && /server/.test(audit[0].by),
    JSON.stringify({ sq: sq.ok ? sq.rows[0] : sq.err, audit }));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
