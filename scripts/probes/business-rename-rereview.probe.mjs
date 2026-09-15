#!/usr/bin/env node
/**
 * Probe for 20260915191526: renaming a verified business re-enters review.
 *
 * BEFORE = prod shape: 20260826040000's auto_pending_credentials body (what
 * prod runs, md5 482f4e…) under the live WHEN trigger. AFTER = the migration
 * applied 3x. Then broken copies of the migration must each be caught.
 * Needs @electric-sql/pglite in ~/.lh-pglite-probe (or PGLITE_DIR).
 */
import fs from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const body = (file) => {
  const s = read(file);
  const i = s.indexOf("CREATE OR REPLACE FUNCTION public.auto_pending_credentials()");
  const j = s.indexOf("$function$;", s.indexOf("AS $function$", i) + 13) + "$function$;".length;
  return s.slice(i, j);
};
const LIVE = body("../../supabase/migrations/20260826040000_cancellation_ladder_and_job_field_lock.sql");
const MIG = read("../../supabase/migrations/20260915191526_restore_business_rename_rereview.sql");

const U = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const BASE = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE FUNCTION public.has_role(u uuid, r text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = u AND role = r) $$;
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY, business_name text,
  license_url text, is_licensed boolean DEFAULT false, license_status text DEFAULT 'none',
  license_reviewed_at timestamptz, license_reviewed_by uuid, license_rejection_reason text,
  insurance_url text, is_insured boolean DEFAULT false, insurance_status text DEFAULT 'none',
  insurance_reviewed_at timestamptz, insurance_reviewed_by uuid, insurance_rejection_reason text
);
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
${LIVE}
CREATE TRIGGER trg_auto_pending_credentials BEFORE UPDATE ON public.profiles FOR EACH ROW
  WHEN ((old.license_url IS DISTINCT FROM new.license_url) OR (old.insurance_url IS DISTINCT FROM new.insurance_url) OR (old.business_name IS DISTINCT FROM new.business_name))
  EXECUTE FUNCTION auto_pending_credentials();
`;
const as = async (db, uid, sql) => { await db.exec(`SELECT set_config('request.uid', '${uid ?? ""}', false)`); return db.query(sql); };
const reset = (db) => db.exec(`SELECT set_config('request.uid', '', false); DELETE FROM public.profiles;
  INSERT INTO public.profiles (user_id, business_name, license_url, is_licensed, license_status, license_reviewed_at, license_reviewed_by, insurance_url, is_insured, insurance_status)
  VALUES ('${U}', 'Acme Plumbing LLC', 'https://x/license.pdf', true, 'verified', now(), '${ADMIN}', 'https://x/ins.pdf', true, 'verified');`);
const row = async (db) => (await db.query(`SELECT * FROM public.profiles WHERE user_id = '${U}'`)).rows[0];

async function expectations(db) {
  const bad = [];
  const check = (c, m) => { if (!c) bad.push(m); };
  // A. The owner renames a verified business -> both badges back to pending, review stamps cleared.
  await reset(db);
  await as(db, U, `UPDATE public.profiles SET business_name = 'Totally Different Co' WHERE user_id = '${U}'`);
  let r = await row(db);
  check(r.license_status === "pending" && r.insurance_status === "pending" && r.license_reviewed_at === null && r.license_reviewed_by === null,
    `A owner rename: license ${r.license_status} insurance ${r.insurance_status} reviewed_at ${r.license_reviewed_at}`);
  // B. An admin renaming keeps the verified badge.
  await reset(db);
  await as(db, ADMIN, `UPDATE public.profiles SET business_name = 'Acme Plumbing, LLC' WHERE user_id = '${U}'`);
  r = await row(db);
  check(r.license_status === "verified" && r.insurance_status === "verified", `B admin rename: license ${r.license_status} insurance ${r.insurance_status}`);
  // C. A rename while nothing is verified changes nothing.
  await reset(db);
  await db.exec(`UPDATE public.profiles SET license_status = 'rejected', insurance_status = 'none' WHERE user_id = '${U}'`);
  await as(db, U, `UPDATE public.profiles SET business_name = 'New Name' WHERE user_id = '${U}'`);
  r = await row(db);
  check(r.license_status === "rejected" && r.insurance_status === "none", `C non-verified rename: license ${r.license_status} insurance ${r.insurance_status}`);
  // D. The document rules are unchanged: a new license upload by the owner -> pending.
  await reset(db);
  await as(db, U, `UPDATE public.profiles SET license_url = 'https://x/new.pdf' WHERE user_id = '${U}'`);
  r = await row(db);
  check(r.license_status === "pending" && r.insurance_status === "verified", `D doc swap: license ${r.license_status} insurance ${r.insurance_status}`);
  // E. A server write (no uid) renaming is not an admin: re-review.
  await reset(db);
  await as(db, null, `UPDATE public.profiles SET business_name = 'Server Rename' WHERE user_id = '${U}'`);
  r = await row(db);
  check(r.license_status === "pending", `E server rename: license ${r.license_status}`);
  // F. Clearing the document and renaming in one UPDATE: 'none', not 'pending'.
  await reset(db);
  await as(db, U, `UPDATE public.profiles SET business_name = 'Gone Co', license_url = NULL WHERE user_id = '${U}'`);
  r = await row(db);
  check(r.license_status === "none" && r.is_licensed === false, `F doc cleared + rename: license ${r.license_status} is_licensed ${r.is_licensed}`);
  // G. The purge_user_data shape (server, no uid): name and both documents nulled -> both 'none'.
  await reset(db);
  await as(db, null, `UPDATE public.profiles SET business_name = NULL, license_url = NULL, insurance_url = NULL WHERE user_id = '${U}'`);
  r = await row(db);
  check(r.license_status === "none" && r.insurance_status === "none", `G purge-shaped write: license ${r.license_status} insurance ${r.insurance_status}`);
  return bad;
}

async function fresh(migs) {
  const db = new PGlite();
  await db.exec(BASE);
  for (const m of migs) await db.exec(m);
  return db;
}

let fail = false;
{
  const db = await fresh([]);
  await reset(db);
  await as(db, U, `UPDATE public.profiles SET business_name = 'Totally Different Co' WHERE user_id = '${U}'`);
  const r = await row(db);
  const gap = r.license_status === "verified";
  console.log("== BEFORE (prod body 20260826040000)");
  console.log(`${gap ? "GAP   " : "closed"} a verified Helpr renames their business and keeps the verified badge (license ${r.license_status})`);
  if (!gap) { fail = true; console.log("FAIL: the gap did not reproduce"); }
  await db.close();
}
{
  let bad;
  try { const db = await fresh([MIG, MIG, MIG]); bad = await expectations(db); await db.close(); } catch (e) { bad = [`apply error: ${e.message}`]; }
  console.log("\n== AFTER (migration applied 3x)");
  if (bad.length) { fail = true; console.log("FAIL\n   " + bad.join("\n   ")); } else console.log("all expectations hold (green)");
}
const mutate = (from, to) => { if (!MIG.includes(from)) throw new Error(`anchor missing: ${from.slice(0, 50)}`); return MIG.replace(from, to); };
const broken = [
  ["no rename rule", mutate("IF NEW.business_name IS DISTINCT FROM OLD.business_name AND NOT is_admin_writer THEN", "IF false THEN")],
  ["admins re-reviewed too", mutate("IF NEW.business_name IS DISTINCT FROM OLD.business_name AND NOT is_admin_writer THEN", "IF NEW.business_name IS DISTINCT FROM OLD.business_name THEN")],
  ["insurance ignored", mutate("    IF OLD.insurance_status = 'verified' AND NEW.insurance_status = 'verified' THEN\n      NEW.insurance_status := 'pending';", "    IF false THEN\n      NEW.insurance_status := 'pending';")],
  ["any status re-reviewed", mutate("    IF OLD.license_status = 'verified' AND NEW.license_status = 'verified' THEN", "    IF true THEN")],
  ["OLD-only check (20260827180000 as written)", mutate("    IF OLD.license_status = 'verified' AND NEW.license_status = 'verified' THEN", "    IF OLD.license_status = 'verified' THEN")],
];
console.log("\n== BROKEN COPIES (each must be caught)");
for (const [label, sql] of broken) {
  let bad;
  try { const db = await fresh([sql]); bad = await expectations(db); await db.close(); } catch (e) { bad = [`apply error: ${e.message}`]; }
  if (!bad.length) { fail = true; console.log(`NOT CAUGHT: ${label}`); } else console.log(`caught: ${label}\n   ${bad[0]}`);
}
console.log(fail ? "\nPROBE FAILED" : "\nPROBE PASSED");
process.exit(fail ? 1 : 0);
