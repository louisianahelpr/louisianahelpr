#!/usr/bin/env node
/**
 * PGlite proof for 20261012185742_ban_actions_atomic_and_remaining_strikes
 * (docs/OPEN.md Q1494, Q1496).
 *
 *   node src/test/pglite/banActionsAtomic.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/banActionsAtomic.pglite.mjs   # RED: live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = prod's code: every function is its NEWEST definition in the
 * migrations before the one under test, checked by md5(prosrc) against the
 * values read live on 2026-10-12 (LIVE_MD5), or the proof refuses to run.
 * Triggers as live: trg_refuse_unban_during_ban_review (BEFORE UPDATE OF
 * ban_status ON profiles), auto_restrict_repeat_violators_tg (AFTER INSERT ON
 * user_violations), trg_reject_self_issued_ban (BEFORE INSERT ON user_bans).
 * NOT modelled, and said so: RLS, the statement-level
 * refuse_unconfirmed_email_write trigger (a server context passes it), the
 * money-audit trigger on user_bans, and the job settlement a confirmed
 * PERMANENT ban runs (no case below confirms one).
 *
 * "A review opened mid-call" is a concurrent transaction committing an open
 * ban_settlement_queue row after the caller's check; in READ COMMITTED the
 * next statement sees it. It is modelled by a test-only BEFORE trigger that
 * inserts that row at the chosen write (GUC test.open_review_at).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const UNDER_TEST = "20261012185742_ban_actions_atomic_and_remaining_strikes.sql";
const read = (f) => readFileSync(MIG_DIR + f, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
const FIXED = MODE !== "skip";
if (!FIXED) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

/** md5(prosrc) on prod, read 2026-10-12. */
const LIVE_MD5 = {
  is_server_context: "ebc78d554c09d9ebf387992e83d584c8",
  has_role: "dae5cfc5a8d92461a428f6702e4e65af",
  ban_standing_rank: "8a85ce1ecb251aa34920246a010433b6",
  refuse_unban_during_ban_review: "a5b1a3d2fda8040c0db4013b4b92e8de",
  lift_ban_settlement_review: "4907f31caa436d106ff783faad881eaf",
  admin_confirm_ban_settlement: "ba07ce170150a1d09e3277454ae38cba",
  auto_restrict_repeat_violators: "e90076926b79e3b996343ba902202615",
  reject_self_issued_ban: "9cad54aee384a4c4917e7bef4751364d",
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

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const NOT_ADMIN = "aaaaaaaa-0000-4000-8000-000000000002";
const T = (n) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`;
const V = (n) => `eeeeeeee-0000-4000-8000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, email text, ban_status text DEFAULT 'active', auto_suspended_until timestamptz);
CREATE TABLE public.user_bans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, ban_type text NOT NULL DEFAULT 'temporary',
  reason text NOT NULL, banned_by uuid NOT NULL, expires_at timestamptz, created_at timestamptz DEFAULT now(), is_active boolean DEFAULT true);
CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, violation_type text NOT NULL,
  description text, job_id uuid, reported_by uuid, action_taken text NOT NULL DEFAULT 'warning', created_at timestamptz DEFAULT now());
CREATE TABLE public.ban_settlement_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, matched_on text NOT NULL,
  review_state text NOT NULL DEFAULT 'open', original_ban_status text, original_expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz, decided_by uuid, alerted_at timestamptz, deferred_ban_status text, deferred_suspended_until timestamptz, deferred_at timestamptz);
CREATE TABLE public.admin_audit_log (admin_id uuid, action text, target_id text, target_type text, details jsonb);
CREATE TABLE public.notifications (user_id uuid, type text, title text, message text, link text, read boolean);
CREATE TABLE public.ban_evasion_matches (user_id uuid, matched_on text, cleared_at timestamptz, resolved boolean);
CREATE TABLE public.payout_holds (helper_id uuid, held_by uuid, denied_by uuid, reason text);
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
`);

const NAMES = Object.keys(LIVE_MD5);
const from = {};
for (const name of NAMES) {
  const s = newestStatement(name, before);
  from[name] = s.file;
  await db.exec(s.stmt);
}
await db.exec(`
CREATE TRIGGER trg_refuse_unban_during_ban_review BEFORE UPDATE OF ban_status ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.refuse_unban_during_ban_review();
CREATE TRIGGER auto_restrict_repeat_violators_tg AFTER INSERT ON public.user_violations FOR EACH ROW EXECUTE FUNCTION public.auto_restrict_repeat_violators();
CREATE TRIGGER trg_reject_self_issued_ban BEFORE INSERT OR UPDATE OF banned_by, user_id ON public.user_bans FOR EACH ROW EXECUTE FUNCTION public.reject_self_issued_ban();
-- Test-only: a review that a concurrent transaction commits mid-call.
CREATE FUNCTION public.zz_test_open_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('test.open_review_at', true) = TG_TABLE_NAME THEN
    PERFORM set_config('test.open_review_at', '', true);
    INSERT INTO public.ban_settlement_queue (user_id, matched_on) VALUES (NEW.user_id, 'card');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER aa_test_open_review BEFORE UPDATE OF ban_status ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.zz_test_open_review();
CREATE TRIGGER aa_test_open_review BEFORE INSERT ON public.user_bans FOR EACH ROW EXECUTE FUNCTION public.zz_test_open_review();
`);

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

if (FIXED) for (let i = 0; i < 3; i++) await db.exec(read(UNDER_TEST));

/** A server-context statement (service role, no JWT): the edge function's client. */
async function server(sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '', false), set_config('request.role', 'service_role', false);`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
}
async function asAdmin(sql) {
  await db.exec(`SELECT set_config('request.uid', '${ADMIN}', false), set_config('request.role', 'authenticated', false);`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec(`SELECT set_config('request.uid', '', false), set_config('request.role', 'service_role', false);`); }
}
const count = async (table, user) => Number((await db.query(`SELECT count(*)::int AS n FROM public.${table} WHERE user_id = $1`, [user])).rows[0].n);
const status = async (user) => (await db.query(`SELECT ban_status, auto_suspended_until FROM public.profiles WHERE user_id = $1`, [user])).rows[0];
const addUser = (u, st = "active", until = null) =>
  db.query(`INSERT INTO public.profiles (user_id, full_name, email, ban_status, auto_suspended_until) VALUES ($1, 'T', 't@x.test', $2, $3)`, [u, st, until]);

// ── Q1494: the admin action is one transaction ──────────────────────────────
// The OLD flow (BanDialog / confirm_message_ban): check, then three separate
// requests. A review opened between the check and the writes:
{
  const u = T(1);
  await addUser(u, "temp_banned", new Date(Date.now() + 86400e3).toISOString());
  const open = await server(`SELECT count(*)::int AS n FROM public.ban_settlement_queue WHERE user_id = '${u}' AND review_state = 'open'`);
  check("Q1494 old flow: the up-front check finds no review", open.ok && open.rows[0].n === 0);
  await db.exec(`INSERT INTO public.ban_settlement_queue (user_id, matched_on) VALUES ('${u}', 'card')`); // opens mid-call
  await server(`INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by) VALUES ('${u}', 'permanent', 'x', '${ADMIN}')`);
  await server(`INSERT INTO public.user_violations (user_id, violation_type, description, action_taken, reported_by) VALUES ('${u}', 'admin_action', 'x', 'permanent_ban', '${ADMIN}')`);
  const r = await server(`UPDATE public.profiles SET ban_status = 'permanently_banned', auto_suspended_until = NULL WHERE user_id = '${u}'`);
  check("Q1494 old flow: the status write is refused (ban_review_open) ...", !r.ok && /ban_review_open/.test(r.err), r.err ?? "applied");
  check("Q1494 old flow: ... and leaves the ban row and the strike behind (the defect this item fixes)",
    (await count("user_bans", u)) === 1 && (await count("user_violations", u)) === 1, "documents the separate-request shape");
}

if (FIXED) {
  const call = (u, action, until = "NULL", admin = ADMIN, strike = "true") =>
    server(`SELECT public.admin_apply_account_action('${u}', '${admin}', '${action}', 'Spam', ${until}, ${strike}) AS v`);

  {
    const u = T(2);
    await addUser(u, "temp_banned", new Date(Date.now() + 86400e3).toISOString());
    await db.exec(`SELECT set_config('test.open_review_at', 'profiles', false)`);
    const r = await call(u, "permanent");
    await db.exec(`SELECT set_config('test.open_review_at', '', false)`);
    check("B1 a review opened mid-call refuses the whole action (ban_review_open)", !r.ok && /ban_review_open/.test(r.err), r.err ?? "applied");
    check("B2 ... and NOTHING is written: no ban row, no strike, no review row, standing unchanged",
      (await count("user_bans", u)) === 0 && (await count("user_violations", u)) === 0 &&
        (await count("ban_settlement_queue", u)) === 0 && (await status(u)).ban_status === "temp_banned",
      JSON.stringify({ bans: await count("user_bans", u), strikes: await count("user_violations", u), st: await status(u) }));
  }
  {
    const u = T(3);
    await addUser(u, "temp_banned", new Date(Date.now() + 86400e3).toISOString());
    await db.exec(`INSERT INTO public.ban_settlement_queue (user_id, matched_on) VALUES ('${u}', 'card')`);
    const r = await call(u, "permanent");
    check("B3 an open review refuses up front, nothing written", !r.ok && /ban_review_open/.test(r.err) &&
      (await count("user_bans", u)) === 0 && (await count("user_violations", u)) === 0, r.err ?? "applied");
  }
  {
    const u = T(4);
    await addUser(u);
    const r = await call(u, "permanent");
    const st = await status(u);
    check("B4 a permanent ban applies the standing, one ban row, one strike and an audit row",
      r.ok && st.ban_status === "permanently_banned" && st.auto_suspended_until === null &&
        (await count("user_bans", u)) === 1 && (await count("user_violations", u)) === 1 &&
        Number((await db.query(`SELECT count(*)::int AS n FROM public.admin_audit_log WHERE target_id = $1 AND action = 'set_ban_status'`, [u])).rows[0].n) === 1,
      JSON.stringify(r.ok ? r.rows[0].v : r.err));
    const again = await call(u, "permanent");
    check("B5 a second permanent ban writes no second ban row and reports no change",
      again.ok && again.rows[0].v.ban_row_written === false && again.rows[0].v.state_changed === false && (await count("user_bans", u)) === 1,
      JSON.stringify(again.ok ? again.rows[0].v : again.err));
  }
  {
    const u = T(5);
    await addUser(u);
    const until = `'${new Date(Date.now() + 7 * 86400e3).toISOString()}'::timestamptz`;
    const r = await call(u, "temporary", until);
    const st = await status(u);
    check("B6 a temporary ban writes the same end to the profile as to the ban row",
      r.ok && st.ban_status === "temp_banned" &&
        (await db.query(`SELECT count(*)::int AS n FROM public.user_bans WHERE user_id = $1 AND expires_at = $2::timestamptz`, [u, st.auto_suspended_until])).rows[0].n === 1,
      JSON.stringify(r.ok ? r.rows[0].v : r.err));
    const bad = await call(T(5), "temporary", "now() - interval '1 day'");
    check("B7 a temporary ban with a past end is refused", !bad.ok && /invalid_suspension_end/.test(bad.err), bad.err ?? "applied");
  }
  {
    const u = T(6);
    await addUser(u);
    const r = await call(u, "warning");
    const v = (await db.query(`SELECT violation_type, action_taken FROM public.user_violations WHERE user_id = $1`, [u])).rows;
    check("B8 a warning sets final_warning and records an admin_warning strike (the ladder skips it)",
      r.ok && (await status(u)).ban_status === "final_warning" && v.length === 1 && v[0].violation_type === "admin_warning" && v[0].action_taken === "warning",
      JSON.stringify({ r: r.ok ? r.rows[0].v : r.err, v }));
  }
  {
    const r = await call(T(6), "warning", "NULL", NOT_ADMIN);
    check("B9 a non-admin p_admin_id is refused", !r.ok && /admin_only/.test(r.err), r.err ?? "applied");
    const s = await server(`SELECT public.admin_apply_account_action('${ADMIN}', '${ADMIN}', 'warning', 'x', NULL, true)`);
    check("B10 an action against your own account is refused", !s.ok && /self_action/.test(s.err), s.err ?? "applied");
  }
  {
    const u = T(7);
    await addUser(u, "active");
    await db.exec("BEGIN");
    await db.exec(`SELECT set_config('request.uid', '', true), set_config('request.role', 'service_role', true)`);
    await db.query(`SELECT public.admin_apply_account_action('${u}', '${ADMIN}', 'warning', 'x', NULL, true)`);
    const flag = (await db.query(`SELECT COALESCE(current_setting('app.trusted_ladder_write', true), '') AS f`)).rows[0].f;
    await db.exec("COMMIT");
    check("B11 the strike's ladder flag does not outlive the call (later writes are not ladder writes)", flag !== "on", `flag=${flag}`);
  }
  {
    // admin-user-actions' formal_warning strikes: no ban row, the third suspends.
    const u = T(8);
    await addUser(u);
    const until = `'${new Date(Date.now() + 7 * 86400e3).toISOString()}'::timestamptz`;
    const r1 = await call(u, "formal_warning");
    const s1 = (await status(u)).ban_status;
    const r3 = await call(u, "suspension", until);
    const st = await status(u);
    const v = (await db.query(`SELECT violation_type, action_taken FROM public.user_violations WHERE user_id = $1 ORDER BY created_at`, [u])).rows;
    check("B13 formal-warning strikes: 'warned', then a 7-day suspension with its end, admin_warning strikes and no ban row",
      r1.ok && r3.ok && s1 === "warned" && st.ban_status === "temp_banned" && st.auto_suspended_until !== null &&
        (await count("user_bans", u)) === 0 && v.length === 2 && v.every((x) => x.violation_type === "admin_warning") &&
        v[1].action_taken === "suspension",
      JSON.stringify({ s1, st, v, e: r1.err ?? r3.err }));
    const u2 = T(9);
    await addUser(u2, "banned");
    await db.exec(`SELECT set_config('test.open_review_at', 'profiles', false)`);
    const r = await call(u2, "suspension", until);
    await db.exec(`SELECT set_config('test.open_review_at', '', false)`);
    check("B14 a strike whose standing a mid-call review refuses leaves no strike behind",
      !r.ok && /ban_review_open/.test(r.err) && (await count("user_violations", u2)) === 0, r.err ?? "applied");
  }
  {
    const f = (await db.query(`SELECT prosecdef, proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure('public.admin_apply_account_action(uuid,uuid,text,text,timestamptz,boolean)')`)).rows[0];
    check("B12 admin_apply_account_action is SECURITY DEFINER and service_role only",
      f && f.prosecdef && /service_role=X/.test(f.acl) && !/(^|[{,])(anon|authenticated)?=X/.test(f.acl), JSON.stringify(f));
  }
}

// ── Q1496: a lift applies the rung the REMAINING strikes reach ─────────────
// An account under review (banned) earns two ladder strikes: the second is a
// 7-day suspension, deferred. The admin reverses ONE of them and lifts.
async function twoStrikeReview(u) {
  await addUser(u, "banned");
  await db.exec(`INSERT INTO public.ban_settlement_queue (user_id, matched_on, created_at, original_ban_status) VALUES ('${u}', 'card', now() - interval '1 hour', 'banned')`);
  for (let i = 0; i < 2; i++) {
    const r = await server(`INSERT INTO public.user_violations (user_id, violation_type, description) VALUES ('${u}', 'message_flagged', 'strike ${i + 1}')`);
    if (!r.ok) throw new Error(r.err);
  }
  const q = (await db.query(`SELECT deferred_ban_status FROM public.ban_settlement_queue WHERE user_id = $1`, [u])).rows[0];
  return q.deferred_ban_status;
}
{
  const u = T(10);
  const deferred = await twoStrikeReview(u);
  check("R0 the second strike's 7-day suspension was deferred onto the open review", deferred === "temp_banned", String(deferred));
  await db.exec(`DELETE FROM public.user_violations WHERE id = (SELECT id FROM public.user_violations WHERE user_id = '${u}' ORDER BY created_at DESC LIMIT 1)`);
  const r = await server(`SELECT public.lift_ban_settlement_review('${u}', '${ADMIN}', 'active') AS v`);
  const st = await status(u);
  check("R1 one of two strikes reversed: the lift applies the one-strike rung, not the two-strike suspension",
    r.ok && st.ban_status !== "temp_banned", JSON.stringify({ r: r.ok ? r.rows[0].v : r.err, st }));
}
{
  const u = T(11);
  await twoStrikeReview(u);
  const r = await server(`SELECT public.lift_ban_settlement_review('${u}', '${ADMIN}', 'active') AS v`);
  const st = await status(u);
  check("R2 control: both strikes stand, the lift keeps the 7-day suspension they earned",
    r.ok && st.ban_status === "temp_banned" && new Date(st.auto_suspended_until) > new Date(Date.now() + 6 * 86400e3),
    JSON.stringify({ r: r.ok ? r.rows[0].v : r.err, st }));
}
{
  const u = T(12);
  await twoStrikeReview(u);
  await db.exec(`DELETE FROM public.user_violations WHERE user_id = '${u}'`);
  const r = await server(`SELECT public.lift_ban_settlement_review('${u}', '${ADMIN}', 'active') AS v`);
  check("R3 every strike reversed: the lift applies the admin's choice", r.ok && (await status(u)).ban_status === "active", JSON.stringify(r.ok ? r.rows[0].v : r.err));
}
// Confirm: a retained temporary judgment, extended by a deferred 30-day rung
// that took THREE strikes; one of them is reversed.
{
  const u = T(13);
  const soon = new Date(Date.now() + 86400e3).toISOString();
  const later = new Date(Date.now() + 30 * 86400e3).toISOString();
  await addUser(u, "temp_banned", soon);
  await db.exec(`INSERT INTO public.ban_settlement_queue (user_id, matched_on, created_at, original_ban_status, original_expires_at, deferred_ban_status, deferred_suspended_until)
    VALUES ('${u}', 'card', now() - interval '1 hour', 'temp_banned', '${soon}', 'temp_banned', '${later}')`);
  if (FIXED) {
    // Rungs as the trigger records them: the final warning was earned on
    // strike 1; the 30-day extension was counted on strikes 1, 2 and 3.
    await db.exec(`UPDATE public.ban_settlement_queue SET deferred_rungs = jsonb_build_array(
      jsonb_build_object('ban_status', 'final_warning', 'suspended_until', NULL, 'basis', jsonb_build_array('${V(1)}')),
      jsonb_build_object('ban_status', 'temp_banned', 'suspended_until', '${later}', 'basis', jsonb_build_array('${V(1)}', '${V(2)}', '${V(3)}'))) WHERE user_id = '${u}'`);
  }
  // Strikes 1 and 2 stand; strike 3 was reversed (deleted).
  for (let i = 1; i <= 2; i++) await db.exec(`INSERT INTO public.user_violations (id, user_id, violation_type, description, created_at) VALUES ('${V(i)}', '${u}', 'admin_action', 'remaining ${i}', now())`);
  const r = await asAdmin(`SELECT public.admin_confirm_ban_settlement('${u}') AS v`);
  const st = await status(u);
  check("R4 confirm: two of three strikes remain, the 30-day extension they no longer reach is not applied",
    r.ok && st.ban_status === "temp_banned" && new Date(st.auto_suspended_until).getTime() === new Date(soon).getTime(),
    JSON.stringify({ r: r.ok ? r.rows[0].v : r.err, st }));
}

// lh-money-escrow review of the first cut: a since-review count of EVERY
// strike kept a rung whose own strikes were gone. A strike from BEFORE the
// review that the ladder counted toward the rung is reversed: the rung goes.
{
  const u = T(14);
  await addUser(u, "banned");
  await server(`INSERT INTO public.user_violations (user_id, violation_type, description, created_at) VALUES ('${u}', 'message_flagged', 'before the review', now() - interval '2 hours')`);
  await db.exec(`INSERT INTO public.ban_settlement_queue (user_id, matched_on, created_at, original_ban_status) VALUES ('${u}', 'card', now() - interval '1 hour', 'banned')`);
  await server(`INSERT INTO public.user_violations (user_id, violation_type, description) VALUES ('${u}', 'message_flagged', 'during the review')`);
  const q = (await db.query(`SELECT deferred_ban_status FROM public.ban_settlement_queue WHERE user_id = $1`, [u])).rows[0];
  await db.exec(`DELETE FROM public.user_violations WHERE user_id = '${u}' AND description = 'before the review'`);
  await db.exec(`INSERT INTO public.user_violations (user_id, violation_type, description) VALUES ('${u}', 'no_show', 'an unrelated later strike')`);
  const r = await server(`SELECT public.lift_ban_settlement_review('${u}', '${ADMIN}', 'active') AS v`);
  check("R5 the pre-review strike the 7-day rung was counted on is reversed: the rung goes, though another strike now stands",
    q.deferred_ban_status === "temp_banned" && r.ok && (await status(u)).ban_status !== "temp_banned",
    JSON.stringify({ deferred: q.deferred_ban_status, r: r.ok ? r.rows[0].v : r.err, st: await status(u) }));
}

// Re-review: reversing an UNRELATED strike (another ladder's, counted for
// nothing here) leaves a rung whose own strikes all stand.
{
  const u = T(17);
  await addUser(u, "banned");
  await server(`INSERT INTO public.user_violations (user_id, violation_type, description, created_at) VALUES ('${u}', 'no_show', 'an old no-show', now() - interval '60 days')`);
  await db.exec(`INSERT INTO public.ban_settlement_queue (user_id, matched_on, created_at, original_ban_status) VALUES ('${u}', 'card', now() - interval '1 hour', 'banned')`);
  for (let i = 0; i < 2; i++) await server(`INSERT INTO public.user_violations (user_id, violation_type, description) VALUES ('${u}', 'message_flagged', 'strike ${i + 1}')`);
  await db.exec(`DELETE FROM public.user_violations WHERE user_id = '${u}' AND violation_type = 'no_show'`);
  const r = await server(`SELECT public.lift_ban_settlement_review('${u}', '${ADMIN}', 'active') AS v`);
  check("R6 control: an unrelated older no-show is reversed; the 7-day rung its two own strikes earned still applies",
    r.ok && (await status(u)).ban_status === "temp_banned", JSON.stringify({ r: r.ok ? r.rows[0].v : r.err, st: await status(u) }));
}

if (FIXED) {
  // A warning out of a ban ends a CONFIRMED review as set_ban_status did: the
  // review's Q1324 payout hold and card/bank match are cleared.
  const u = T(15);
  await addUser(u, "banned");
  await db.exec(`INSERT INTO public.ban_settlement_queue (user_id, matched_on, review_state, created_at, original_ban_status) VALUES ('${u}', 'card', 'confirmed', now() - interval '1 hour', 'banned')`);
  await db.exec(`INSERT INTO public.payout_holds (helper_id, held_by, denied_by, reason) VALUES ('${u}', NULL, NULL, 'Q1324: ban review')`);
  await db.exec(`INSERT INTO public.ban_evasion_matches (user_id, matched_on, cleared_at, resolved) VALUES ('${u}', 'card', NULL, false)`);
  const r = await server(`SELECT public.admin_apply_account_action('${u}', '${ADMIN}', 'warning', 'second chance', NULL, true) AS v`);
  const left = {
    st: (await status(u)).ban_status,
    review: (await db.query(`SELECT review_state FROM public.ban_settlement_queue WHERE user_id = $1`, [u])).rows[0].review_state,
    holds: (await db.query(`SELECT count(*)::int AS n FROM public.payout_holds WHERE helper_id = $1`, [u])).rows[0].n,
    match: (await db.query(`SELECT cleared_at IS NOT NULL AS c FROM public.ban_evasion_matches WHERE user_id = $1`, [u])).rows[0].c,
  };
  check("B15 a warning out of a ban lifts the confirmed review: hold released, match cleared, final warning applied",
    r.ok && left.st === "final_warning" && left.review === "lifted" && left.holds === 0 && left.match === true,
    JSON.stringify({ left, e: r.err }));
  // The ban row is written before the standing (trg_retain_ban_on_ban reads it).
  const u2 = T(16);
  await addUser(u2);
  await db.exec(`CREATE TABLE IF NOT EXISTS public.zz_seen (user_id uuid, bans int)`);
  await db.exec(`CREATE OR REPLACE FUNCTION public.zz_count_bans() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO public.zz_seen SELECT NEW.user_id, count(*) FROM public.user_bans b WHERE b.user_id = NEW.user_id AND b.is_active; RETURN NEW; END $$`);
  await db.exec(`CREATE TRIGGER zz_count_bans AFTER UPDATE OF ban_status ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.zz_count_bans()`);
  await server(`SELECT public.admin_apply_account_action('${u2}', '${ADMIN}', 'permanent', 'x', NULL, true)`);
  const seen = (await db.query(`SELECT bans FROM public.zz_seen WHERE user_id = $1`, [u2])).rows;
  check("B16 the ban row exists when the standing is written (the retained-ban trigger reads it)", seen.length === 1 && seen[0].bans === 1, JSON.stringify(seen));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
