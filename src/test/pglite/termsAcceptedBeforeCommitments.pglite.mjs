#!/usr/bin/env node
/**
 * PGlite proof for 20261108154435_terms_accepted_before_commitments.
 *
 *   node src/test/pglite/termsAcceptedBeforeCommitments.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/termsAcceptedBeforeCommitments.pglite.mjs   # RED: no check
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 *
 * Fixture: profiles (user_id, terms_version_accepted) and the eight guarded
 * tables with prod's names and the application_status enum; prod's default
 * ACL (new functions executable by anon/authenticated) so a forgotten REVOKE
 * shows. auth.uid() reads request.jwt.claim.sub, as on prod. The migration is
 * applied 3x (replay-safe). Members: CURRENT ("Oct 2026"), NEWER ("Nov 2026"),
 * STALE ("Sep 2026"), NEVER (''), NOPROFILE (no row).
 *
 *   T1 STALE / NEVER / NOPROFILE are refused 'terms_not_accepted' (42501) on
 *      every guarded INSERT (RED without the migration);
 *   T2 CURRENT and NEWER insert on every guarded table;
 *   T3 a hire through a SECURITY DEFINER RPC (status -> 'accepted') is refused
 *      for a STALE poster, allowed for CURRENT; rejecting is never refused;
 *   T4 no caller (service role / cron, auth.uid() NULL) is never refused;
 *   T5 accepting the Terms itself (UPDATE profiles) works for STALE, and the
 *      same insert then succeeds (the app's retry);
 *   T6 reads are never refused: a STALE member can SELECT;
 *   T7 anon and authenticated cannot EXECUTE terms_accepted_is_current /
 *      current_terms_version / require_current_terms; service_role can call
 *      terms_accepted_is_current; every new function pins search_path
 *      public, pg_temp;
 *   R1 exactly one of each trigger after 3x replay.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(
  new URL("../../../supabase/migrations/20261108154435_terms_accepted_before_commitments.sql", import.meta.url).pathname,
  "utf8",
);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running without the migration (expect FAILs)`);

const TABLES = {
  jobs: "customer_id",
  applications: "helper_id",
  declutter_items: "seller_id",
  declutter_offers: "buyer_id",
  declutter_swap_offers: "buyer_id",
  declutter_orders: "buyer_id",
  shop_orders: "buyer_id",
  instant_payouts: "helper_id",
};

const db = new PGlite();
await db.exec(`
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.application_status AS ENUM ('pending', 'accepted', 'rejected');
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, terms_version_accepted text DEFAULT '', terms_accepted_at timestamptz);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
`);
for (const [t, col] of Object.entries(TABLES)) {
  const extra = t === "applications" ? ", status public.application_status NOT NULL DEFAULT 'pending'" : "";
  await db.exec(`CREATE TABLE public.${t} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ${col} uuid${extra});
    GRANT SELECT, INSERT, UPDATE ON public.${t} TO authenticated, service_role;`);
}
// The hire, as accept_application writes it: a SECURITY DEFINER RPC run by the poster.
await db.exec(`
CREATE FUNCTION public.hire_stub(p_id uuid, p_status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
BEGIN UPDATE public.applications SET status = p_status::public.application_status WHERE id = p_id; END $$;
GRANT EXECUTE ON FUNCTION public.hire_stub(uuid, text) TO authenticated;`);

const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const CURRENT = U(1), NEWER = U(2), STALE = U(3), NEVER = U(4), NOPROFILE = U(5);
await db.exec(`INSERT INTO public.profiles (user_id, terms_version_accepted) VALUES
  ('${CURRENT}', 'Oct 2026'), ('${NEWER}', 'Nov 2026'), ('${STALE}', 'Sep 2026'), ('${NEVER}', '');`);

if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

let fails = 0;
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) fails++;
};
async function as(role, uid, sql, params) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE ${role};`);
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec("RESET ROLE; RESET request.jwt.claim.sub;");
  }
}
const refused = (r) => r.error === "terms_not_accepted" && r.code === "42501";
const insert = (uid, t) => as("authenticated", uid, `INSERT INTO public.${t} (${TABLES[t]}) VALUES ($1) RETURNING id`, [uid]);

// T1
for (const [name, uid] of [["STALE", STALE], ["NEVER", NEVER], ["NOPROFILE", NOPROFILE]]) {
  for (const t of Object.keys(TABLES)) {
    const r = await insert(uid, t);
    check(refused(r), `T1 ${name} INSERT ${t} refused terms_not_accepted (got ${r.error ?? "inserted"})`);
  }
}
// T2
for (const [name, uid] of [["CURRENT", CURRENT], ["NEWER", NEWER]]) {
  for (const t of Object.keys(TABLES)) {
    const r = await insert(uid, t);
    check(!r.error && r.rows.length === 1, `T2 ${name} INSERT ${t} allowed${r.error ? ` (${r.error})` : ""}`);
  }
}
// T3
const appId = (await db.query(`INSERT INTO public.applications (helper_id) VALUES ('${NEWER}') RETURNING id`)).rows[0].id;
const staleHire = await as("authenticated", STALE, "SELECT public.hire_stub($1, 'accepted')", [appId]);
check(refused(staleHire), `T3 STALE poster's hire (status -> accepted in a definer RPC) refused (got ${staleHire.error ?? "hired"})`);
const st1 = (await db.query("SELECT status::text s FROM public.applications WHERE id = $1", [appId])).rows[0].s;
check(st1 === "pending", `T3 the refused hire left the application pending (${st1})`);
const staleReject = await as("authenticated", STALE, "SELECT public.hire_stub($1, 'rejected')", [appId]);
check(!staleReject.error, `T3 STALE poster may still reject (${staleReject.error ?? "ok"})`);
await db.query("UPDATE public.applications SET status = 'pending' WHERE id = $1", [appId]);
const goodHire = await as("authenticated", CURRENT, "SELECT public.hire_stub($1, 'accepted')", [appId]);
check(!goodHire.error, `T3 CURRENT poster's hire allowed (${goodHire.error ?? "ok"})`);
const noteEdit = await as("authenticated", STALE, "UPDATE public.applications SET helper_id = helper_id WHERE id = $1 RETURNING id", [appId]);
check(!noteEdit.error, `T3 an UPDATE that does not change status to accepted is not checked (${noteEdit.error ?? "ok"})`);
// T4
for (const t of Object.keys(TABLES)) {
  const r = await as("service_role", null, `INSERT INTO public.${t} (${TABLES[t]}) VALUES ($1) RETURNING id`, [STALE]);
  check(!r.error, `T4 no caller (service role) INSERT ${t} not refused${r.error ? ` (${r.error})` : ""}`);
}
// T6
const read = await as("authenticated", STALE, "SELECT count(*)::int n FROM public.jobs");
check(!read.error, `T6 a STALE member can read (${read.error ?? "ok"})`);
// T5
const acc = await as("authenticated", STALE, "UPDATE public.profiles SET terms_version_accepted = 'Oct 2026' WHERE user_id = $1 RETURNING user_id", [STALE]);
check(!acc.error && acc.rows.length === 1, `T5 STALE can accept the Terms (${acc.error ?? "ok"})`);
const retry = await insert(STALE, "jobs");
check(!retry.error, `T5 the same job INSERT succeeds after accepting (the app's retry) (${retry.error ?? "ok"})`);
// T7
for (const role of ["anon", "authenticated"]) {
  for (const call of ["public.terms_accepted_is_current($1)", "public.current_terms_version()"]) {
    const r = await as(role, CURRENT, `SELECT ${call} v`, call.includes("$1") ? [CURRENT] : undefined);
    check(/permission denied/.test(r.error ?? ""), `T7 ${role} cannot EXECUTE ${call} (${r.error ?? "allowed"})`);
  }
}
const svc = await as("service_role", null, "SELECT public.terms_accepted_is_current($1) a, public.terms_accepted_is_current($2) b", [CURRENT, NEVER]);
check(svc.rows?.[0]?.a === true && svc.rows?.[0]?.b === false, `T7 service_role reads terms_accepted_is_current (current=true, never=false) (${svc.error ?? JSON.stringify(svc.rows?.[0])})`);
const acl = await db.query(`SELECT p.proname, p.proconfig, coalesce(p.proacl::text, '') acl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN ('current_terms_version','terms_version_rank','terms_accepted_is_current','require_current_terms')`);
check(acl.rows.length === 4, `T7 four functions exist (${acl.rows.length})`);
for (const r of acl.rows) {
  check(/anon=/.test(r.acl) === false && /authenticated=/.test(r.acl) === false, `T7 ${r.proname} grants nothing to anon/authenticated (${r.acl})`);
  check(JSON.stringify(r.proconfig ?? []).includes("search_path=public, pg_temp"), `T7 ${r.proname} pins search_path public, pg_temp (${JSON.stringify(r.proconfig)})`);
}
// R1
const trg = await db.query(`SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname LIKE 'tr_require_current_terms%'`);
check(trg.rows.length === Object.keys(TABLES).length + 1, `R1 ${Object.keys(TABLES).length + 1} triggers after 3x replay (${trg.rows.length})`);

console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
