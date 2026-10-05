#!/usr/bin/env node
/**
 * PGlite proof for 20261005070322_launch_notify_signups (docs/OPEN.md Q1313).
 *
 *   node src/test/pglite/launchNotifySignups.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/launchNotifySignups.pglite.mjs # RED: no table, no RPC (live today)
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Prod-shaped fixture, measured 2026-10-05 (read-only): has_role(uuid,
 * app_role) and is_seed_email(text) exist live (to_regprocedure), app_role is
 * admin/customer/helper; has_role's body and the auth.uid() stub are the
 * applications fixture's (scripts/probes/fixtures/applications.live.sql);
 * is_seed_email is 20260923052520's verbatim. Roles are real: anon,
 * authenticated (request.uid set) and service_role, as PostgREST runs them.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const NEW = read("../../../supabase/migrations/20261005070322_launch_notify_signups.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the live (unbuilt) state (expect FAILs)`);

let failures = 0;
let passes = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
  else passes++;
};

const ADMIN = "a0000000-0000-4000-8000-000000000001";
const USER = "a0000000-0000-4000-8000-000000000002";
const SEED = "a0000000-0000-4000-8000-000000000003";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$function$;
CREATE OR REPLACE FUNCTION public.is_seed_email(p_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u JOIN public.profiles p ON p.user_id = u.id
     WHERE lower(u.email) = lower(btrim(p_email)) AND p.is_seed IS TRUE)
$fn$;
REVOKE ALL ON FUNCTION public.is_seed_email(text) FROM PUBLIC, anon, authenticated;
INSERT INTO auth.users VALUES ('${ADMIN}', 'admin@example.com'), ('${USER}', 'Member@Example.com'), ('${SEED}', 'helpr-e2e-poster-0902@mailinator.com');
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.profiles VALUES ('${ADMIN}', false), ('${USER}', false), ('${SEED}', true);
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

async function as(who, sql) {
  const uid = who && who !== "anon" && who !== "service" ? who : "";
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${uid}', false);`);
  await db.exec(who === "service" ? "SET ROLE service_role" : uid ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const rows = async () => (await db.query(`SELECT email, user_id, source, consent_version, is_seed, unsubscribed_at, unsubscribe_token FROM public.launch_notify_signups ORDER BY created_at, email`).catch(() => ({ rows: [] }))).rows;

// ── J: a guest can join, and only through the RPC ──
{
  const r = await as("anon", `SELECT public.join_launch_notify('  Guest@Example.com ', 'browse_empty') AS r`);
  check("J1 a guest's join answers ok", r.ok && r.rows[0]?.r?.ok === true, r.ok ? "" : r.err);
  const all = await rows();
  check("J2 the guest's email is stored once, no account, consent recorded", all.length === 1 && all[0].email === "Guest@Example.com" && all[0].user_id === null && all[0].consent_version === "launch-notify-v1" && all[0].source === "browse_empty", JSON.stringify(all));
  const again = await as("anon", `SELECT public.join_launch_notify('guest@example.com', 'browse_empty') AS r`);
  check("J3 joining again (other case) answers the SAME ok and adds no row", again.ok && again.rows[0]?.r?.ok === true && (await rows()).length === 1, again.ok ? "" : again.err);
  const bad = await as("anon", `SELECT public.join_launch_notify('not-an-email', 'browse_empty') AS r`);
  check("J4 a malformed address is refused with a sentence", !bad.ok && /valid email/.test(bad.err), bad.ok ? "accepted" : bad.err);
  const blank = await as("anon", `SELECT public.join_launch_notify(NULL, 'browse_empty') AS r`);
  check("J5 a guest with no email is refused", !blank.ok, blank.ok ? "accepted" : "");
  const src = await as("anon", `SELECT public.join_launch_notify('src@example.com', 'anything') AS r`);
  check("J6 an unknown source is stored as browse_empty", src.ok && (await rows()).some((x) => x.email === "src@example.com" && x.source === "browse_empty"));
}

// ── S: a signed-in member joins with their account email ──
{
  const r = await as(USER, `SELECT public.join_launch_notify(NULL, 'home_empty') AS r`);
  check("S1 a signed-in member with no email typed joins with their account email", r.ok && (await rows()).some((x) => x.email === "Member@Example.com" && x.user_id === USER && x.source === "home_empty"), r.ok ? "" : r.err);
  const other = await as(USER, `SELECT public.join_launch_notify('friend@example.com', 'home_empty') AS r`);
  check("S2 a member typing someone else's email adds a row NOT tied to their account", other.ok && (await rows()).some((x) => x.email === "friend@example.com" && x.user_id === null));
  const seed = await as(SEED, `SELECT public.join_launch_notify(NULL, 'home_empty') AS r`);
  check("S3 a test account's address is marked is_seed", seed.ok && (await rows()).some((x) => x.email === "helpr-e2e-poster-0902@mailinator.com" && x.is_seed === true));
}

// ── P: nobody but an admin can read or change the list ──
{
  const a = await as("anon", `SELECT count(*) FROM public.launch_notify_signups`);
  check("P1 anon cannot read the list", !a.ok, a.ok ? "read it" : "");
  const u = await as(USER, `SELECT count(*)::int AS n FROM public.launch_notify_signups`);
  check("P2 a signed-in non-admin reads zero rows", u.ok && u.rows[0].n === 0, u.ok ? `n=${u.rows[0].n}` : u.err);
  const ins = await as("anon", `INSERT INTO public.launch_notify_signups (email, consent_version) VALUES ('x@example.com', 'v')`);
  check("P3 anon cannot INSERT directly (the RPC is the only door)", !ins.ok);
  const insU = await as(USER, `INSERT INTO public.launch_notify_signups (email, consent_version) VALUES ('y@example.com', 'v')`);
  check("P4 a signed-in user cannot INSERT directly", !insU.ok);
  const upd = await as(USER, `UPDATE public.launch_notify_signups SET unsubscribed_at = now()`);
  check("P5 a signed-in user cannot UPDATE", !upd.ok);
  const del = await as(USER, `DELETE FROM public.launch_notify_signups RETURNING id`);
  check("P6 a signed-in non-admin deletes nothing", del.ok && del.rows.length === 0, del.ok ? `deleted ${del.rows.length}` : del.err);
  const adm = await as(ADMIN, `SELECT count(*)::int AS n FROM public.launch_notify_signups`);
  check("P7 an admin reads the whole list", adm.ok && adm.rows[0].n === (await rows()).length && adm.rows[0].n > 0, adm.ok ? `n=${adm.rows[0].n}` : adm.err);
  const admDel = await as(ADMIN, `DELETE FROM public.launch_notify_signups WHERE is_seed RETURNING id`);
  check("P8 an admin can delete test rows", admDel.ok && admDel.rows.length === 1, admDel.ok ? `deleted ${admDel.rows.length}` : admDel.err);
  const fnAcl = await db.query(`SELECT has_function_privilege('anon', 'public.join_launch_notify(text,text)', 'EXECUTE') AS j, has_function_privilege('anon', 'public.leave_launch_notify(uuid)', 'EXECUTE') AS l`).catch(() => ({ rows: [{}] }));
  check("P9 anon may EXECUTE join and leave", fnAcl.rows[0].j === true && fnAcl.rows[0].l === true);
}

// ── L: leaving by token ──
{
  const before = (await rows()).find((x) => x.email === "Guest@Example.com");
  const r = await as("anon", `SELECT public.leave_launch_notify('${before?.unsubscribe_token ?? "00000000-0000-4000-8000-000000000000"}') AS r`);
  const after = (await rows()).find((x) => x.email === "Guest@Example.com");
  check("L1 the unsubscribe token stops the address", r.ok && after?.unsubscribed_at != null, r.ok ? "" : r.err);
  const bogus = await as("anon", `SELECT public.leave_launch_notify(gen_random_uuid()) AS r`);
  check("L2 an unknown token answers the same ok and changes nothing", bogus.ok && bogus.rows[0]?.r?.ok === true && (await rows()).filter((x) => x.unsubscribed_at != null).length === 1);
}

// ── R: the per-minute cap ──
{
  let refused = null;
  for (let i = 0; i < 40 && !refused; i++) {
    const r = await as("anon", `SELECT public.join_launch_notify('flood${i}@example.com', 'browse_empty') AS r`);
    if (!r.ok) refused = { i, err: r.err };
  }
  const n = (await rows()).length;
  check("R1 a flood stops at 30 new rows a minute, with a sentence", refused !== null && /try again in a minute/.test(refused.err) && n <= 30, refused ? `refused at #${refused.i}, rows=${n}` : `never refused, rows=${n}`);
}

// No sender: nothing in the migration fires on insert.
{
  const trg = await db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = to_regclass('public.launch_notify_signups') AND NOT tgisinternal`).catch(() => ({ rows: [{ n: -1 }] }));
  check("N1 no trigger on the table (nothing is sent on join)", trg.rows[0].n === 0 && MODE !== "skip", `triggers=${trg.rows[0].n}`);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
