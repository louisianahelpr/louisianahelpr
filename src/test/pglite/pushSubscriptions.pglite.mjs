#!/usr/bin/env node
/**
 * PGlite proof for the web push store (push_subscriptions + register_push_subscription + the export section).
 *
 *   node src/test/pglite/pushSubscriptions.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/pushSubscriptions.pglite.mjs  # RED: without the migration
 *   MIGRATION_PATH=<planted copy> node ...                                # RED on a planted defect
 *
 * World: roles, auth.users, auth.uid() from request.jwt.claim.sub, the Q807 gate (prod's
 * attach_unconfirmed_email_gate() verbatim, with refuse_unconfirmed_email_write() reading a test setting),
 * then the migration applied 3x. Checks:
 *   1. Replay-safe (3 applies), RLS on, anon has nothing, authenticated may only SELECT, both RPCs are
 *      EXECUTE for authenticated + service_role and not anon.
 *   2. A member registers a subscription; reads only their own rows; cannot insert/update directly;
 *      cannot delete any row directly; unregister_push_subscription removes only their own.
 *   3. The same endpoint registered by a second member is TAKEN OVER (one row, the newest member).
 *   4. Bad input is refused (http endpoint, short keys, nulls, signed out).
 *   5. Q807: an unconfirmed caller cannot register.
 *   6. export_my_data: the section is the caller's own rows without endpoint/p256dh/auth, and the body is
 *      20261029223949's VERBATIM plus that one section.
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = "20261029223949_export_my_data_seller_porch_days.sql";
const NEW_FILE = readdirSync(MIG_DIR).find((f) => /_web_push_subscriptions\.sql$/.test(f));
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

let pass = 0;
let fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? `  (${detail})` : ""}`);
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz DEFAULT now());
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
-- Q807, as prod defines the attach (2026-10-29 pg_get_functiondef); the refusal reads a test setting.
CREATE OR REPLACE FUNCTION public.refuse_unconfirmed_email_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $f$
BEGIN
  IF current_setting('test.unconfirmed', true) = 'on' THEN
    RAISE EXCEPTION 'email_unconfirmed' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END $f$;
CREATE OR REPLACE FUNCTION public.attach_unconfirmed_email_gate() RETURNS integer LANGUAGE plpgsql SET search_path TO '' AS $f$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT c.oid, c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
       AND c.relname NOT IN ('analytics_events', 'error_logs')
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'zz_refuse_unconfirmed_email_write')
  LOOP
    EXECUTE format('CREATE TRIGGER zz_refuse_unconfirmed_email_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_unconfirmed_email_write()', r.relname);
    n := n + 1;
  END LOOP;
  RETURN n;
END $f$;`);

const ME = "00000000-0000-0000-0000-0000000000aa";
const OTHER = "00000000-0000-0000-0000-0000000000bb";
await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${ME}', 'me@example.com'), ('${OTHER}', 'other@example.com');`);

// The base export_my_data (newest before this migration) so the verbatim comparison has a reference.
function exportCreate(sql, label) {
  const create = /CREATE OR REPLACE FUNCTION public\.export_my_data\(p_user_id uuid\)[\s\S]*?\bAS (\$\w*\$)/.exec(sql);
  if (!create) throw new Error(`${label}: no export_my_data(uuid) definition`);
  const end = sql.indexOf(create[1], create.index + create[0].length);
  return `${sql.slice(create.index, end + create[1].length)};`;
}
const defOf = async () => (await db.query(`SELECT pg_get_functiondef('public.export_my_data(uuid)'::regprocedure) AS d`)).rows[0].d;
await db.exec(exportCreate(readFileSync(`${MIG_DIR}${BASE}`, "utf8"), BASE));
const oldDef = await defOf();

if (!skip) {
  ok(!!NEW_FILE, "the migration file exists", "no *_web_push_subscriptions.sql");
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    try {
      await db.exec(sql);
      ok(true, `the migration applies (run ${i + 1} of 3)`);
    } catch (e) {
      ok(false, `the migration applies (run ${i + 1} of 3)`, e.message);
    }
  }
}

const q = async (sql) => (await db.query(sql)).rows;
const tryAs = async (role, uid, sql) => {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  try {
    await db.exec(`SET ROLE ${role};`);
    const r = await db.query(sql);
    return { rows: r.rows, affected: r.affectedRows };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec("RESET ROLE;");
  }
};
const P256 = "B" + "A".repeat(86);
const AUTH = "A".repeat(22);
const reg = (endpoint, p256 = P256, auth = AUTH) =>
  `SELECT public.register_push_subscription('${endpoint}', '${p256}', '${auth}', 'UA') AS id`;

// 1. Shape and ACL.
const meta = (
  await q(`SELECT
    (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.push_subscriptions')) AS rls,
    has_table_privilege('anon', 'public.push_subscriptions', 'SELECT') AS anon_sel,
    has_table_privilege('authenticated', 'public.push_subscriptions', 'SELECT') AS auth_sel,
    has_table_privilege('authenticated', 'public.push_subscriptions', 'DELETE') AS auth_del,
    has_table_privilege('authenticated', 'public.push_subscriptions', 'INSERT') AS auth_ins,
    has_table_privilege('authenticated', 'public.push_subscriptions', 'UPDATE') AS auth_upd,
    to_regprocedure('public.register_push_subscription(text,text,text,text)') IS NOT NULL AS has_rpc`).catch(() => [{}])
)[0];
ok(meta.rls === true, "RLS is on", JSON.stringify(meta));
ok(meta.anon_sel === false && meta.auth_sel === true && meta.auth_del === false && meta.auth_ins === false && meta.auth_upd === false,
  "anon has nothing; authenticated may only SELECT", JSON.stringify(meta));
if (meta.has_rpc) {
  const acl = (await q(`SELECT
    has_function_privilege('anon', 'public.register_push_subscription(text,text,text,text)', 'EXECUTE') AS anon,
    has_function_privilege('authenticated', 'public.register_push_subscription(text,text,text,text)', 'EXECUTE') AS auth,
    has_function_privilege('service_role', 'public.register_push_subscription(text,text,text,text)', 'EXECUTE') AS svc`))[0];
  ok(!acl.anon && acl.auth && acl.svc, "register_push_subscription: EXECUTE for authenticated and service_role, not anon", JSON.stringify(acl));
} else ok(false, "register_push_subscription exists");
if (meta.has_rpc) {
  const acl = (await q(`SELECT
    to_regprocedure('public.unregister_push_subscription(text)') IS NOT NULL AS has,
    to_regprocedure('public.unregister_push_subscription(text)') IS NOT NULL
      AND has_function_privilege('anon', 'public.unregister_push_subscription(text)', 'EXECUTE') AS anon,
    to_regprocedure('public.unregister_push_subscription(text)') IS NOT NULL
      AND has_function_privilege('authenticated', 'public.unregister_push_subscription(text)', 'EXECUTE') AS auth`))[0];
  ok(acl.has && !acl.anon && acl.auth, "unregister_push_subscription: EXECUTE for authenticated, not anon", JSON.stringify(acl));
} else ok(false, "unregister_push_subscription exists");
const trig = (await q(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = to_regclass('public.push_subscriptions') AND tgname = 'zz_refuse_unconfirmed_email_write'`).catch(() => [{ n: 0 }]))[0].n;
ok(trig === 1, "Q807: the unconfirmed-email gate is attached to push_subscriptions");

// 2. Own rows.
const r1 = await tryAs("authenticated", ME, reg("https://fcm.googleapis.com/fcm/send/me-1"));
ok(!r1.error && !!r1.rows?.[0]?.id, "a member registers their browser", r1.error);
await tryAs("authenticated", OTHER, reg("https://web.push.apple.com/other-1"));
const mine = await tryAs("authenticated", ME, "SELECT user_id, endpoint FROM public.push_subscriptions");
ok(!mine.error && mine.rows.length === 1 && mine.rows[0].user_id === ME, "a member reads only their own rows", JSON.stringify(mine));
const ins = await tryAs("authenticated", ME, `INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ('${OTHER}', 'https://x.example/evil', '${P256}', '${AUTH}')`);
ok(!!ins.error, "a member cannot insert directly (not even as someone else)", JSON.stringify(ins));
const upd = await tryAs("authenticated", ME, `UPDATE public.push_subscriptions SET user_id = '${ME}'`);
ok(!!upd.error, "a member cannot update directly (no stealing another member's row)", JSON.stringify(upd));
// No direct delete at all (a bare DELETE is the widest a client could try).
const before = (await q(`SELECT count(*)::int AS n FROM public.push_subscriptions`).catch(() => [{ n: -1 }]))[0].n;
const bare = await tryAs("authenticated", ME, `DELETE FROM public.push_subscriptions`);
const after = (await q(`SELECT count(*)::int AS n FROM public.push_subscriptions`).catch(() => [{ n: -1 }]))[0].n;
ok(!!bare.error && before > 0 && after === before, "a member cannot delete directly", JSON.stringify({ bare, before, after }));
// The RPC never removes another member's row, even naming its endpoint.
const steal = await tryAs("authenticated", ME, `SELECT public.unregister_push_subscription('https://web.push.apple.com/other-1') AS n`);
const otherStill = (await q(`SELECT count(*)::int AS n FROM public.push_subscriptions WHERE user_id = '${OTHER}'`).catch(() => [{ n: -1 }]))[0].n;
ok(!steal.error && otherStill === 1, "unregister_push_subscription cannot remove another member's row", JSON.stringify({ steal, otherStill }));

// 3. Takeover.
const r2 = await tryAs("authenticated", OTHER, reg("https://fcm.googleapis.com/fcm/send/me-1"));
const rows = await q(`SELECT user_id FROM public.push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/me-1'`).catch(() => []);
ok(!r2.error && rows.length === 1 && rows[0].user_id === OTHER, "the same browser signed in as another member is taken over (one row, the newest member)", JSON.stringify({ r2, rows }));

// 4. Bad input.
for (const [label, sql] of [
  ["an http endpoint", reg("http://insecure.example/1")],
  ["a short p256dh", reg("https://x.example/2", "BAAA")],
  ["a short auth", reg("https://x.example/3", P256, "AA")],
  ["a null endpoint", `SELECT public.register_push_subscription(NULL, '${P256}', '${AUTH}', NULL)`],
]) {
  const r = await tryAs("authenticated", ME, sql);
  ok(/invalid_subscription/.test(r.error ?? ""), `refused: ${label}`, r.error ?? "accepted");
}
const signedOut = await tryAs("authenticated", null, reg("https://x.example/4"));
ok(/not_signed_in/.test(signedOut.error ?? ""), "refused: signed out", signedOut.error ?? "accepted");
const anon = await tryAs("anon", null, reg("https://x.example/5"));
ok(/permission denied/.test(anon.error ?? ""), "refused: anon cannot execute", anon.error ?? "accepted");

// 5. Q807.
await db.exec(`SELECT set_config('test.unconfirmed', 'on', false);`);
const unc = await tryAs("authenticated", ME, reg("https://x.example/6"));
await db.exec(`SELECT set_config('test.unconfirmed', 'off', false);`);
ok(/email_unconfirmed/.test(unc.error ?? ""), "Q807: an unconfirmed caller cannot register", unc.error ?? "accepted");

// Own delete works.
const del = await tryAs("authenticated", OTHER, `SELECT public.unregister_push_subscription('https://fcm.googleapis.com/fcm/send/me-1') AS n`);
const anonUnreg = await tryAs("anon", null, `SELECT public.unregister_push_subscription('https://web.push.apple.com/other-1') AS n`);
ok(!!anonUnreg.error, "refused: anon cannot unregister", anonUnreg.error ?? "accepted");
const gone = (await q(`SELECT count(*)::int AS n FROM public.push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/me-1'`).catch(() => [{ n: -1 }]))[0].n;
ok(!del.error && gone === 0, "unregister_push_subscription removes the caller's own row (sign-out)", del.error);

// 6. Export.
const def = await defOf();
const SECTION = `  v_out := v_out || jsonb_build_object('push_subscriptions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'endpoint' - 'p256dh' - 'auth'), '[]'::jsonb) FROM public.push_subscriptions t
      WHERE t.user_id = v_uid));
`;
ok(def.includes(SECTION), "export_my_data has the push_subscriptions section, the caller's rows, secrets stripped");
ok(def.replace(SECTION, "") === oldDef, "and is otherwise 20261029223949's body verbatim");
const acl2 = (await q(`SELECT has_function_privilege('authenticated', 'public.export_my_data(uuid)', 'EXECUTE') AS auth,
  has_function_privilege('anon', 'public.export_my_data(uuid)', 'EXECUTE') AS anon,
  has_function_privilege('service_role', 'public.export_my_data(uuid)', 'EXECUTE') AS svc`))[0];
ok(acl2.svc && !acl2.auth && !acl2.anon, "export_my_data is still EXECUTE for service_role only", JSON.stringify(acl2));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
