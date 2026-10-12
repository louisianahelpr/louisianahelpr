#!/usr/bin/env node
/**
 * PGlite proof for 20261012184600_scope_policy_helpers_to_caller (Q1328):
 * has_role, user_may_see_job_address and group_member_slot answer a signed-in
 * caller only about themselves (plus the narrow arms the migration lists), and
 * the one SQL caller that asked about someone else (send_team_reply) still works.
 *
 *   node src/test/pglite/policyHelpersScopedToCaller.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/policyHelpersScopedToCaller.pglite.mjs   # RED: live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = prod's code: every function is its NEWEST definition in the
 * migrations before the one under test, checked by md5(prosrc) against the
 * values read live on 2026-10-12 (LIVE_MD5), or the proof refuses to run.
 * Tables carry only the columns those functions read. NOT modelled, and said
 * so: RLS policies and column grants (the token swap below is the direct
 * /rest/v1/rpc call the item is about, which RLS does not touch).
 *
 * Roles are real: `SET ROLE authenticated` with a uid is a PostgREST request
 * with a user JWT; auth.uid()/auth.role() read request.uid/request.role.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const UNDER_TEST = "20261012184600_scope_policy_helpers_to_caller.sql";
const read = (f) => readFileSync(MIG_DIR + f, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

/** md5(prosrc) on prod, read 2026-10-12. */
const LIVE_MD5 = {
  is_server_context: "ebc78d554c09d9ebf387992e83d584c8",
  are_users_blocked: "a0731c1a984038d3fab1f3b770188e36",
  has_role: "dae5cfc5a8d92461a428f6702e4e65af",
  user_may_see_job_address: "e0e10808b215e7d671ab257c785b6c1f",
  group_member_slot: "01e7b175963da9ccd283cf1a7062c8a9",
  enforce_block_on_message_insert: "9d38a237121b89be40ee6724e76816f0",
  admin_send_team_message: "699cd9200bb951c629398b7f7b32ef74",
  send_team_reply: "d40b5a8c89d5f10bf4f40709fa9f264f",
};

/** The newest `CREATE [OR REPLACE] FUNCTION [public.]<name>(` statement in `files`, any dollar tag. */
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

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001"; // holds the admin role
const ADMIN2 = "aaaaaaaa-0000-4000-8000-000000000002"; // a second admin
const POSTER = "bbbbbbbb-0000-4000-8000-000000000001"; // posts the jobs
const HELPER = "bbbbbbbb-0000-4000-8000-000000000002"; // hired on JOB
const MEMBER = "bbbbbbbb-0000-4000-8000-000000000003"; // on CREW's roster
const MEMBER2 = "bbbbbbbb-0000-4000-8000-000000000004"; // also on CREW's roster
const STRANGER = "cccccccc-0000-4000-8000-000000000001"; // an ordinary account, party to nothing
const JOB = "dddddddd-0000-4000-8000-000000000001";
const CREW = "dddddddd-0000-4000-8000-000000000002";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE TABLE public.user_blocks (blocker_id uuid NOT NULL, blocked_id uuid NOT NULL);
CREATE TABLE public.admin_audit_log (admin_id uuid, action text, target_id text, target_type text, details jsonb);
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, offered_to_helper_id uuid,
  direct_offer_status text, direct_offer_expires_at timestamptz
);
CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL, helper_id uuid NOT NULL);
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text);
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid,
  team_thread_user_id uuid,
  sender_id uuid,
  receiver_id uuid,
  content text NOT NULL,
  client_id uuid,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT messages_job_xor_team_thread CHECK ((job_id IS NULL) <> (team_thread_user_id IS NULL))
);
GRANT SELECT, INSERT ON public.messages TO authenticated;

INSERT INTO auth.users (id, email) VALUES
  ('${ADMIN}', 'a@x.test'), ('${ADMIN2}', 'a2@x.test'), ('${POSTER}', 'p@x.test'), ('${HELPER}', 'h@x.test'),
  ('${MEMBER}', 'm@x.test'), ('${MEMBER2}', 'm2@x.test'), ('${STRANGER}', 's@x.test');
INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ADMIN2}', 'admin');
INSERT INTO public.jobs (id, customer_id, helper_id) VALUES ('${JOB}', '${POSTER}', '${HELPER}'), ('${CREW}', '${POSTER}', NULL);
INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('${CREW}', '${MEMBER}'), ('${CREW}', '${MEMBER2}');
`);

const NAMES = Object.keys(LIVE_MD5);
const from = {};
for (const name of NAMES) {
  const s = newestStatement(name, before);
  from[name] = s.file;
  await db.exec(s.stmt);
}
await db.exec(`CREATE TRIGGER trg_enforce_block_on_message_insert BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION enforce_block_on_message_insert();`);
await db.exec(`
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role), public.user_may_see_job_address(uuid, uuid), public.group_member_slot(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role), public.user_may_see_job_address(uuid, uuid), public.group_member_slot(uuid, uuid),
  public.are_users_blocked(uuid, uuid), public.admin_send_team_message(uuid, text, uuid), public.send_team_reply(text, uuid) TO authenticated, service_role;`);

const md5 = async (name) =>
  (await db.query(`SELECT md5(prosrc) AS m FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace`, [name])).rows[0]?.m;
let fixtureOk = true;
for (const [name, want] of Object.entries(LIVE_MD5)) {
  const got = await md5(name);
  if (got !== want) {
    fixtureOk = false;
    check(`fixture: public.${name} is prod's code`, false, `md5 ${got} != live ${want} (read from ${from[name]})`);
  }
}
if (!fixtureOk) {
  console.log("REFUSING TO RUN: the fixture is not prod's code");
  process.exit(1);
}
check("fixture: every function is prod's code (md5 of prosrc)", true, `${NAMES.length} functions`);

if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(read(UNDER_TEST));

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who}', false), set_config('request.role', 'authenticated', false);`);
  await db.exec("SET ROLE authenticated");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
async function server(sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '', false), set_config('request.role', 'service_role', false);`);
  await db.exec("SET ROLE service_role");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const one = (r) => (r.ok ? r.rows[0]?.v : { err: r.err });

// ── has_role ────────────────────────────────────────────────────────────────
{
  const r = await as(STRANGER, `SELECT public.has_role('${ADMIN}', 'admin') AS v`);
  check("R1 a stranger calling has_role about an admin's id gets false (token swap)", one(r) === false, JSON.stringify(one(r)));
  const r2 = await as(ADMIN, `SELECT public.has_role('${ADMIN}', 'admin') AS v`);
  check("R2 an admin asking about themselves gets true (every admin policy)", one(r2) === true, JSON.stringify(one(r2)));
  const r3 = await as(STRANGER, `SELECT public.has_role('${STRANGER}', 'admin') AS v`);
  check("R3 a member asking about themselves gets false", one(r3) === false, JSON.stringify(one(r3)));
  const r4 = await as(ADMIN, `SELECT public.has_role('${ADMIN2}', 'admin') AS v`);
  check("R4 an admin asking about another admin still gets true", one(r4) === true, JSON.stringify(one(r4)));
  const r5 = await server(`SELECT public.has_role('${ADMIN}', 'admin') AS v`);
  check("R5 a server context (service role, edge functions) still gets true", one(r5) === true, JSON.stringify(one(r5)));
  const r6 = await as(STRANGER, `SELECT public.has_role(NULL, 'admin') AS v`);
  check("R6 has_role(NULL, ...) stays false", one(r6) === false, JSON.stringify(one(r6)));
  // lh-authz-rls review of 82f75a18b (LOW): with no uid and no server context the
  // self arm must be false, not NULL (an `IF NOT has_role(...)` would pass NULL).
  const r7 = await as("", `SELECT public.has_role('${ADMIN}', 'admin') AS v, public.user_may_see_job_address('${JOB}', '${HELPER}') AS w`);
  check("R7 no uid, not a server: false, never NULL", r7.ok && r7.rows[0].v === false && r7.rows[0].w === false, JSON.stringify(r7.ok ? r7.rows[0] : r7.err));
}

// ── user_may_see_job_address ────────────────────────────────────────────────
{
  const r = await as(STRANGER, `SELECT public.user_may_see_job_address('${JOB}', '${HELPER}') AS v`);
  check("A1 a stranger asking whether another id is hired on a job gets false (token swap)", one(r) === false, JSON.stringify(one(r)));
  const r2 = await as(HELPER, `SELECT public.user_may_see_job_address('${JOB}', '${HELPER}') AS v`);
  check("A2 the hired Helpr asking about themselves gets true (jobs SELECT policy)", one(r2) === true, JSON.stringify(one(r2)));
  const r3 = await as(STRANGER, `SELECT public.user_may_see_job_address('${CREW}', '${MEMBER}') AS v`);
  check("A3 a stranger asking whether another id is on a crew gets false", one(r3) === false, JSON.stringify(one(r3)));
  const r4 = await server(`SELECT public.user_may_see_job_address('${JOB}', '${HELPER}') AS v`);
  check("A4 a server context (export_my_data, service role) still gets true", one(r4) === true, JSON.stringify(one(r4)));
}

// ── group_member_slot ───────────────────────────────────────────────────────
{
  const r = await as(STRANGER, `SELECT public.group_member_slot('${CREW}', '${MEMBER}') AS v`);
  check("G1 a stranger gets no crew slot for another id (token swap)", one(r) === null, JSON.stringify(one(r)));
  const r2 = await as(MEMBER2, `SELECT public.group_member_slot('${CREW}', '${MEMBER}') AS v`);
  check("G2 a crew member gets no slot for a co-member (RLS shows a member only their own row)", one(r2) === null, JSON.stringify(one(r2)));
  const r3 = await as(MEMBER, `SELECT public.group_member_slot('${CREW}', '${MEMBER}') AS v`);
  check("G3 a member gets their own slot (member RPCs, reviews policy)", typeof one(r3) === "string", JSON.stringify(one(r3)));
  const r4 = await as(POSTER, `SELECT public.group_member_slot('${CREW}', '${MEMBER}') AS v`);
  check("G4 the job's poster gets a member's slot (rpc_poster_confirm_member_arrival, reviews policy)", typeof one(r4) === "string", JSON.stringify(one(r4)));
  const r5 = await server(`SELECT public.group_member_slot('${CREW}', '${MEMBER}') AS v`);
  check("G5 a server context still gets the slot", typeof one(r5) === "string", JSON.stringify(one(r5)));
}

// ── The SQL callers that pass another person's id still work ───────────────
{
  const r = await as(ADMIN, `SELECT id FROM public.admin_send_team_message('${STRANGER}', 'Welcome', NULL)`);
  check("C1 staff opens a Team thread", r.ok, r.ok ? "" : r.err);
  await db.exec(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${STRANGER}', '${ADMIN}')`);
  const r2 = await as(STRANGER, `SELECT receiver_id::text AS v FROM public.send_team_reply('Thanks, team', NULL)`);
  check("C2 the member's Team reply finds the admin (send_team_reply asks about the sender) and passes the block gate (trigger asks about the receiver)",
    r2.ok && r2.rows[0]?.v === ADMIN, r2.ok ? r2.rows[0]?.v : r2.err);
  const r3 = await as(STRANGER, `INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES ('${JOB}', '${STRANGER}', '${ADMIN}', 'personal') RETURNING id`);
  check("C3 a personal message to the blocked admin is still refused", !r3.ok && /can't message this user/.test(r3.err), r3.ok ? "delivered" : r3.err);
}

// ── Grants unchanged ────────────────────────────────────────────────────────
if (MODE !== "skip") {
  const rows = (await db.query(`SELECT proname, prosecdef, proacl::text AS acl FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace AND proname IN ('has_role','user_may_see_job_address','group_member_slot','send_team_reply')`)).rows;
  check("F1 all four stay SECURITY DEFINER, EXECUTE for authenticated, none for anon/PUBLIC",
    rows.length === 4 && rows.every((x) => x.prosecdef && /authenticated=X/.test(x.acl) && !/(^|[{,])(anon)?=X/.test(x.acl)), JSON.stringify(rows));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
