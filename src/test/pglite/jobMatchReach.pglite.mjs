#!/usr/bin/env node
/**
 * PGlite proof for 20261020172454_job_match_reach (board 184: "Sent to N
 * Helprs near <town>").
 *
 *   node src/test/pglite/jobMatchReach.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/jobMatchReach.pglite.mjs   # RED: no reach read exists
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 *
 * Fixture: the two queues with prod's columns and checks (information_schema
 * and pg_constraint read 2026-10-20: status in queued/sent/digested/dropped,
 * settled_at NULL iff queued, UNIQUE (user_id, job_id) on BOTH; RLS on, no
 * policy, service_role only), a jobs table cut to the columns used, and a
 * STAND-IN job_announceable_to(jobs, uuid) reduced to its first gate
 * (status = 'open'): the real one is the sender's own gate and is called, not
 * restated, so only "closed job => nobody waiting" is modelled here.
 * Roles are real: `SET ROLE authenticated` with a uid is a PostgREST request
 * with a user JWT. The migration is applied 3x, then:
 *   - the poster reads reached = 'sent' only (digested and dropped never count);
 *   - waiting = queued + parish-queue members with no settled ledger row
 *     (a retryable 'error:' drop still waits; a final drop does not);
 *   - a job no longer open has nobody waiting;
 *   - another member, an ownerless job and a missing id all read ZERO ROWS;
 *   - anon is refused EXECUTE (permission denied, not "does not exist").
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(new URL("../../../supabase/migrations/20261020172454_job_match_reach.sql", import.meta.url).pathname, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running without the migration (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "bbbbbbbb-0000-4000-8000-000000000001";
const JOB = "11111111-0000-4000-8000-000000000001";
const ORPHAN = "11111111-0000-4000-8000-000000000002";
const HIRED = "11111111-0000-4000-8000-000000000003";
const H = (n) => `cccccccc-0000-4000-8000-00000000000${n}`;

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, status text NOT NULL DEFAULT 'open');
CREATE FUNCTION public.job_announceable_to(p_job public.jobs, p_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT p_user_id IS NOT NULL AND p_job.status = 'open' $$;
CREATE TABLE public.job_match_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source = ANY (ARRAY['instant','parish'])),
  status text NOT NULL DEFAULT 'queued' CHECK (status = ANY (ARRAY['queued','sent','digested','dropped'])),
  drop_reason text, settled_at timestamptz,
  CONSTRAINT job_match_queue_settled_iff_not_queued CHECK ((status = 'queued') = (settled_at IS NULL)),
  CONSTRAINT job_match_queue_user_job_unique UNIQUE (user_id, job_id)
);
CREATE TABLE public.parish_match_alert_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, job_id uuid NOT NULL,
  CONSTRAINT parish_match_alert_queue_user_job_unique UNIQUE (user_id, job_id)
);
ALTER TABLE public.job_match_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parish_match_alert_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_match_queue, public.parish_match_alert_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.job_match_queue, public.parish_match_alert_queue TO service_role;
GRANT SELECT ON TABLE public.jobs TO authenticated;

INSERT INTO public.jobs (id, customer_id, status) VALUES ('${JOB}', '${POSTER}', 'open'), ('${ORPHAN}', NULL, 'open'), ('${HIRED}', '${POSTER}', 'accepted');
INSERT INTO public.job_match_queue (user_id, job_id, source, status, drop_reason, settled_at) VALUES
  ('${H(1)}', '${JOB}', 'instant', 'sent', NULL, now()),
  ('${H(2)}', '${JOB}', 'parish', 'sent', NULL, now()),
  ('${H(3)}', '${JOB}', 'parish', 'digested', NULL, now()),
  ('${H(4)}', '${JOB}', 'parish', 'dropped', 'blocked', now()),
  ('${H(7)}', '${JOB}', 'instant', 'dropped', 'error: timeout', now()),
  ('${H(5)}', '${JOB}', 'instant', 'queued', NULL, NULL),
  ('${H(1)}', '${ORPHAN}', 'instant', 'sent', NULL, now()),
  ('${H(1)}', '${HIRED}', 'instant', 'sent', NULL, now());
-- Parish queue: H6 waits; H2 was already told; H5 is queued in both; H4's
-- drop is final (never waits); H7's drop is a retryable error (still waits).
INSERT INTO public.parish_match_alert_queue (user_id, job_id) VALUES
  ('${H(6)}', '${JOB}'), ('${H(2)}', '${JOB}'), ('${H(5)}', '${JOB}'), ('${H(4)}', '${JOB}'), ('${H(7)}', '${JOB}'),
  ('${H(6)}', '${HIRED}');
`);
// Prod's pg_default_acl hands EXECUTE on every new function to anon and
// authenticated (MEMORY, measured); model it so the migration's REVOKE is tested.
await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;");
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

async function as(who, sql) {
  const role = who ? "authenticated" : "anon";
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who ?? ""}', false);`);
  await db.exec(`SET ROLE ${role}`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const CALL = (id) => `SELECT reached, waiting FROM public.get_job_match_reach('${id}')`;

{
  const r = await as(POSTER, CALL(JOB));
  check("R1 the poster reads reached = 'sent' only (2): digested and dropped never count",
    r.ok && r.rows.length === 1 && r.rows[0].reached === 2, r.ok ? JSON.stringify(r.rows) : r.err);
  check("R2 waiting = H5 (queued), H6 (parish), H7 (retryable error drop) = 3; H4's final drop and H2 (told) excluded",
    r.ok && r.rows[0]?.waiting === 3, r.ok ? JSON.stringify(r.rows) : r.err);
  const h = await as(POSTER, CALL(HIRED));
  check("R3 a job no longer open has nobody waiting (still shows who was told)",
    h.ok && h.rows.length === 1 && h.rows[0].reached === 1 && h.rows[0].waiting === 0, h.ok ? JSON.stringify(h.rows) : h.err);
}
{
  const r = await as(OTHER, CALL(JOB));
  check("R4 another member reads zero rows for the poster's job", r.ok && r.rows.length === 0, r.ok ? JSON.stringify(r.rows) : r.err);
  const r2 = await as(POSTER, CALL(ORPHAN));
  check("R5 an ownerless job (deleted poster) reads zero rows", r2.ok && r2.rows.length === 0, r2.ok ? JSON.stringify(r2.rows) : r2.err);
  const r3 = await as(POSTER, CALL("99999999-0000-4000-8000-000000000009"));
  check("R6 a missing job id reads zero rows, not an error", r3.ok && r3.rows.length === 0, r3.ok ? JSON.stringify(r3.rows) : r3.err);
  const r4 = await as(null, CALL(JOB));
  check("R7 anon is refused EXECUTE (permission denied, not a missing function)", !r4.ok && /permission denied for function/.test(r4.err), r4.ok ? "read rows" : r4.err);
}
if (MODE !== "skip") {
  const f = (await db.query(`SELECT prosecdef, provolatile, proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure('public.get_job_match_reach(uuid)')`)).rows[0];
  check("F1 SECURITY DEFINER, STABLE, EXECUTE for authenticated only (no anon, no PUBLIC, no service_role)",
    f && f.prosecdef === true && f.provolatile === "s" && /authenticated=X/.test(f.acl) && !/service_role=X/.test(f.acl)
      && !/(^|[{,])(anon)?=X/.test(f.acl), JSON.stringify(f));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
