#!/usr/bin/env node
/**
 * PGlite proof for 20261012030525_team_messages_pass_blocks (Q1591(b), owner
 * pop-up 2026-10-11: "Team messages get through").
 *
 *   node src/test/pglite/teamMessagesPassBlocks.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/teamMessagesPassBlocks.pglite.mjs   # RED: live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = prod's code, checked by md5(prosrc) against the values read live
 * on 2026-10-11 (LIVE_MD5), or the proof refuses to run:
 *   - is_server_context, are_users_blocked, has_role: verbatim from
 *     pg_get_functiondef;
 *   - enforce_block_on_message_insert: its NEWEST definition in the migrations
 *     before the one under test (= live);
 *   - admin_send_team_message, send_team_reply: from
 *     20261011161100_team_thread_direct_messages.sql (= live).
 * The messages table carries the columns those read, the job-xor-team CHECK,
 * and the live BEFORE INSERT block trigger. NOT modelled, and said so: RLS
 * policies and column grants (authenticated has no INSERT on
 * team_thread_user_id on prod), so the direct-INSERT cases below test the
 * trigger alone, the stricter test of the bypass's scope.
 *
 * Roles are real: `SET ROLE authenticated` with a uid is a PostgREST request
 * with a user JWT. auth.uid()/auth.role() read request.uid/request.role.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const UNDER_TEST = "20261012030525_team_messages_pass_blocks.sql";
const TEAM_MIG = "20261011161100_team_thread_direct_messages.sql";
const read = (f) => readFileSync(MIG_DIR + f, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

/** md5(prosrc) on prod, read 2026-10-11. */
const LIVE_MD5 = {
  is_server_context: "ebc78d554c09d9ebf387992e83d584c8",
  are_users_blocked: "a0731c1a984038d3fab1f3b770188e36",
  has_role: "dae5cfc5a8d92461a428f6702e4e65af",
  enforce_block_on_message_insert: "9fbca85d805d91c3dd56f5a2699f0609",
  admin_send_team_message: "699cd9200bb951c629398b7f7b32ef74",
  send_team_reply: "d40b5a8c89d5f10bf4f40709fa9f264f",
};

/** The newest `CREATE [OR REPLACE] FUNCTION public.<name>(` statement in `files`, any dollar tag. */
function newestStatement(name, files) {
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
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
const USER = "bbbbbbbb-0000-4000-8000-000000000001"; // the thread's user
const STRANGER = "cccccccc-0000-4000-8000-000000000001"; // an ordinary member, no admin role
const JOB = "dddddddd-0000-4000-8000-000000000001";

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
-- Policies and column grants are not modelled (see the header).
GRANT SELECT, INSERT ON public.messages TO authenticated;

CREATE OR REPLACE FUNCTION public.is_server_context()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NULL
     AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
$function$;

CREATE OR REPLACE FUNCTION public.are_users_blocked(_user_a uuid, _user_b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN COALESCE(auth.uid() IN (_user_a, _user_b), false)
      OR public.is_server_context()
      OR pg_trigger_depth() > 0
    THEN EXISTS (
      SELECT 1 FROM public.user_blocks
      WHERE (blocker_id = _user_a AND blocked_id = _user_b)
         OR (blocker_id = _user_b AND blocked_id = _user_a)
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$function$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role), public.are_users_blocked(uuid, uuid) TO authenticated;

INSERT INTO auth.users (id, email) VALUES
  ('${ADMIN}', 'admin@x.test'), ('${ADMIN2}', 'admin2@x.test'), ('${USER}', 'user@x.test'), ('${STRANGER}', 'stranger@x.test');
INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ADMIN2}', 'admin');
`);

// The live (pre-migration) block gate and the two Team writers.
const gate = newestStatement("enforce_block_on_message_insert", before);
await db.exec(gate.stmt);
await db.exec(`CREATE TRIGGER trg_enforce_block_on_message_insert BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION enforce_block_on_message_insert();`);
for (const fn of ["admin_send_team_message", "send_team_reply"]) {
  await db.exec(newestStatement(fn, [TEAM_MIG]).stmt);
}
await db.exec(`GRANT EXECUTE ON FUNCTION public.admin_send_team_message(uuid, text, uuid), public.send_team_reply(text, uuid) TO authenticated;`);

const md5 = async (name) =>
  (await db.query(`SELECT md5(prosrc) AS m FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace`, [name])).rows[0]?.m;
let fixtureOk = true;
for (const [name, want] of Object.entries(LIVE_MD5)) {
  const got = await md5(name);
  if (got !== want) {
    fixtureOk = false;
    check(`fixture: public.${name} is prod's code`, false, `md5 ${got} != live ${want}${name === "enforce_block_on_message_insert" ? ` (read from ${gate.file})` : ""}`);
  }
}
if (!fixtureOk) {
  console.log("REFUSING TO RUN: the fixture is not prod's code");
  process.exit(1);
}
check("fixture: every function is prod's code (md5 of prosrc)", true, `${Object.keys(LIVE_MD5).length} functions; block gate from ${gate.file}`);

if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(read(UNDER_TEST));

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who}', false), set_config('request.role', 'authenticated', false);`);
  await db.exec("SET ROLE authenticated");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const block = (a, b) => db.exec(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${a}', '${b}')`);
const unblockAll = () => db.exec("DELETE FROM public.user_blocks");
const refused = (r) => !r.ok && /can't message this user/.test(r.err);
const show = (r) => (r.ok ? "delivered" : r.err);

// ── RED on live: a block stops the Team thread both ways ───────────────────
{
  // Staff opened the thread before any block (so the reply below has an admin to go to).
  const r = await as(ADMIN, `SELECT id FROM public.admin_send_team_message('${USER}', 'Welcome', NULL)`);
  check("T0 no block: the admin's Team message is delivered", r.ok, show(r));
}
await block(USER, ADMIN); // the user blocked the admin's personal account
{
  const r = await as(ADMIN, `SELECT id FROM public.admin_send_team_message('${USER}', 'Hi from the team', NULL)`);
  check("T1 the admin's Team message reaches a user who blocked the admin's account", r.ok, show(r));
  const r2 = await as(USER, `SELECT id FROM public.send_team_reply('Thanks, team', NULL)`);
  check("T2 that user can reply in the Team thread", r2.ok, show(r2));
  const to = (await db.query(`SELECT receiver_id::text AS r FROM public.messages WHERE sender_id = '${USER}' AND team_thread_user_id = '${USER}'`)).rows;
  check("T3 the reply goes to the admin, in the user's own thread", to.length === 1 && to[0].r === ADMIN, JSON.stringify(to));
}
await unblockAll();
await block(ADMIN, USER); // the other direction: the admin's personal account blocked the user
{
  const r = await as(ADMIN, `SELECT id FROM public.admin_send_team_message('${USER}', 'Following up', NULL)`);
  check("T4 a block in the other direction (admin blocked the user) does not stop the Team message", r.ok, show(r));
  const r2 = await as(USER, `SELECT id FROM public.send_team_reply('Got it', NULL)`);
  check("T5 ...nor the user's reply", r2.ok, show(r2));
}

// ── The bypass stays scoped: personal messages stay blocked ────────────────
await unblockAll();
await block(USER, ADMIN);
{
  const r = await as(USER, `INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES ('${JOB}', '${USER}', '${ADMIN}', 'about the job') RETURNING id`);
  check("S1 a personal (job) message from the user to the blocked admin is still refused", refused(r), show(r));
  const r2 = await as(ADMIN, `INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES ('${JOB}', '${ADMIN}', '${USER}', 'about the job') RETURNING id`);
  check("S2 a personal (job) message from the admin to the user who blocked them is still refused", refused(r2), show(r2));
}
await unblockAll();
await block(USER, STRANGER);
{
  const r = await as(STRANGER, `INSERT INTO public.messages (team_thread_user_id, sender_id, receiver_id, content) VALUES ('${USER}', '${STRANGER}', '${USER}', 'pretending to be staff') RETURNING id`);
  check("S3 a non-staff member writing a Team-shaped row to someone who blocked them is refused", refused(r), show(r));
  const r2 = await as(STRANGER, `SELECT id FROM public.admin_send_team_message('${USER}', 'hi', NULL)`);
  check("S4 a non-staff member cannot use the staff writer at all", !r2.ok && /admin_only/.test(r2.err), show(r2));
  const r3 = await as(USER, `INSERT INTO public.messages (team_thread_user_id, sender_id, receiver_id, content) VALUES ('${USER}', '${USER}', '${STRANGER}', 'my thread, to a non-admin') RETURNING id`);
  check("S5 the thread's user writing a Team-shaped row to a NON-admin they blocked is refused", refused(r3), show(r3));
}
await unblockAll();
await block(USER, ADMIN);
{
  const r = await as(USER, `INSERT INTO public.messages (team_thread_user_id, sender_id, receiver_id, content) VALUES ('${USER}', '${ADMIN}', '${USER}', 'forged as the admin') RETURNING id`);
  check("S6 a Team row whose sender is not the caller is refused (no forging the staff side)", refused(r), show(r));
  const r2 = await as(STRANGER, `INSERT INTO public.messages (team_thread_user_id, sender_id, receiver_id, content) VALUES ('${STRANGER}', '${STRANGER}', '${USER}', 'x') RETURNING id`);
  check("S7 unrelated: no block between the stranger and the user, the trigger lets an ordinary row through", r2.ok, show(r2));
}
await unblockAll();
{
  await block(USER, ADMIN2);
  const r = await as(ADMIN2, `INSERT INTO public.messages (team_thread_user_id, sender_id, receiver_id, content) VALUES ('${STRANGER}', '${ADMIN2}', '${USER}', 'wrong thread') RETURNING id`);
  check("S8 a staff row whose receiver is not the thread's user is still block-tested", refused(r), show(r));
}

// ── The function itself ─────────────────────────────────────────────────────
if (MODE !== "skip") {
  const f = (await db.query(`SELECT prosecdef, proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure('public.enforce_block_on_message_insert()')`)).rows[0];
  check("F1 the gate stays SECURITY INVOKER and is not EXECUTE-able by PUBLIC/anon/authenticated",
    f && f.prosecdef === false && f.acl !== null && !/(^|[{,])(anon|authenticated)?=X/.test(f.acl), JSON.stringify(f));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
