#!/usr/bin/env node
/**
 * PGlite proof for 20261102071347_pin_promotions_undo_on_profile_insert (Q2160).
 *
 *   node src/test/pglite/profileInsertPinsUndoRecord.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/profileInsertPinsUndoRecord.pglite.mjs   # RED: main's policy
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/profileInsertPinsUndoRecord.pglite.mjs
 *
 * The gap: authenticated holds table INSERT on profiles, and the 'Users can
 * insert their own profile' WITH CHECK did not name
 * promotions_before_unsubscribe (the unsubscribe link's undo record). Q2159's
 * triggers clear the record on UPDATE only, so a forged record arriving by
 * INSERT would survive until a Resubscribe restored it.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * The schema is prod's shape for every column the policy reads (defaults as
 * in prod). Supabase's default grants are emulated: ALL on new tables and
 * EXECUTE on new functions to anon and authenticated, so the policy is the
 * only thing refusing an insert. Main's policy is loaded from its newest
 * definition (20260923172405) before this migration, as on prod.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const THIS = process.env.MIGRATION_PATH
  ? readFileSync(process.env.MIGRATION_PATH, "utf8")
  : MIG("20261102071347_pin_promotions_undo_on_profile_insert.sql");
const skip = process.env.NEW_MIGRATION === "skip";

// Main's policy: the DROP .. CREATE .. COMMENT block of its newest definition.
const prev = MIG("20260923172405_retire_approval_status_reads.sql");
const from = prev.indexOf('DROP POLICY IF EXISTS "Users can insert their own profile"');
const commentAt = prev.indexOf('COMMENT ON POLICY "Users can insert their own profile"', from);
const MAIN_POLICY = prev.slice(from, prev.indexOf(";", commentAt) + 1);

let failures = 0;
let passes = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (ok) passes++;
  else failures++;
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL,
  full_name text,
  marketing_consent boolean NOT NULL DEFAULT false,
  promotions_before_unsubscribe jsonb,
  ban_status text DEFAULT 'active',
  idv_status text,
  subscription_tier text,
  stripe_account_id text,
  onboarding_fee_paid boolean NOT NULL DEFAULT false,
  email_verified boolean NOT NULL DEFAULT false,
  legacy_manual_review boolean NOT NULL DEFAULT false,
  license_status text NOT NULL DEFAULT 'none',
  insurance_status text NOT NULL DEFAULT 'none',
  license_expires_at timestamptz,
  insurance_expires_at timestamptz,
  is_licensed boolean NOT NULL DEFAULT false,
  is_insured boolean NOT NULL DEFAULT false,
  background_check_status text NOT NULL DEFAULT 'none',
  stripe_identity_verified boolean NOT NULL DEFAULT false,
  apple_original_transaction_id text,
  is_seed boolean NOT NULL DEFAULT false);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
`);
await db.exec(MAIN_POLICY);

for (let i = 0; i < 3; i++) {
  if (skip) break;
  let err = null;
  try { await db.exec(THIS); } catch (e) { err = e.message; }
  check(`the migration applies (run ${i + 1} of 3)`, !err, err ?? "");
}

let n = 0;
const nextId = () => `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
async function as(role, uid, sql, params = []) {
  await db.exec(`SET ROLE ${role}`);
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ""]);
  try {
    return { rows: (await db.query(sql, params)).rows, error: null };
  } catch (e) {
    return { rows: [], error: e.message, code: e.code };
  } finally {
    await db.exec(`RESET ROLE`);
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
}
const count = async (id) => (await db.query(`SELECT count(*)::int AS c FROM public.profiles WHERE user_id = $1`, [id])).rows[0].c;
const FORGED = JSON.stringify({ marketing_consent: true, email_promotions: true });

{
  const id = nextId();
  const r = await as("authenticated", id, `INSERT INTO public.profiles (user_id, full_name) VALUES ($1, 'Pat')`, [id]);
  check("a member's own plain profile INSERT is still accepted", !r.error && (await count(id)) === 1, r.error ?? "");
}
{
  const id = nextId();
  const r = await as("authenticated", id,
    `INSERT INTO public.profiles (user_id, full_name, promotions_before_unsubscribe) VALUES ($1, 'Pat', $2::jsonb)`, [id, FORGED]);
  check("a member's own INSERT carrying an undo record is refused by RLS",
    r.code === "42501" && (await count(id)) === 0, r.error ?? "inserted");
}
{
  const id = nextId();
  const r = await as("authenticated", id,
    `INSERT INTO public.profiles (user_id, full_name, promotions_before_unsubscribe) VALUES ($1, 'Pat', 'null'::jsonb)`, [id]);
  check("a JSON null record (not SQL NULL) is refused too", r.code === "42501" && (await count(id)) === 0, r.error ?? "inserted");
}
{
  const id = nextId();
  const r = await as("authenticated", id,
    `INSERT INTO public.profiles (user_id, full_name, marketing_consent) VALUES ($1, 'Pat', true)`, [id]);
  check("consent given at sign-up (no record) is still accepted", !r.error && (await count(id)) === 1, r.error ?? "");
}
for (const [col, val] of [["is_seed", "true"], ["idv_status", "'verified'"], ["onboarding_fee_paid", "true"],
  ["stripe_identity_verified", "true"], ["ban_status", "'banned'"], ["apple_original_transaction_id", "'tx'"]]) {
  const id = nextId();
  const r = await as("authenticated", id, `INSERT INTO public.profiles (user_id, ${col}) VALUES ($1, ${val})`, [id]);
  check(`the old pin on ${col} is kept`, r.code === "42501" && (await count(id)) === 0, r.error ?? "inserted");
}
{
  const id = nextId();
  const other = nextId();
  const r = await as("authenticated", id, `INSERT INTO public.profiles (user_id) VALUES ($1)`, [other]);
  check("another member's profile is refused", r.code === "42501" && (await count(other)) === 0, r.error ?? "inserted");
}
{
  const id = nextId();
  const r = await as("anon", null, `INSERT INTO public.profiles (user_id) VALUES ($1)`, [id]);
  check("anon (holding Supabase's default table grant) is refused", !!r.error && (await count(id)) === 0, r.error ?? "inserted");
}
{
  const id = nextId();
  const r = await as("service_role", null,
    `INSERT INTO public.profiles (user_id, promotions_before_unsubscribe) VALUES ($1, $2::jsonb)`, [id, FORGED]);
  check("the server (service role) is unaffected", !r.error && (await count(id)) === 1, r.error ?? "");
}
{
  const pols = (await db.query(`SELECT polname, polpermissive, pg_get_expr(polwithcheck, polrelid) AS chk,
                                       ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY (polroles))::text[] AS roles
                                  FROM pg_policy WHERE polrelid = 'public.profiles'::regclass AND polcmd IN ('a', '*')`)).rows;
  check("exactly one INSERT policy on profiles, and it pins the record",
    pols.length === 1 && /promotions_before_unsubscribe IS NULL/.test(pols[0].chk), JSON.stringify(pols.map((p) => p.polname)));
  check("the INSERT policy is for authenticated only", pols.length === 1 && JSON.stringify(pols[0].roles) === '["authenticated"]',
    JSON.stringify(pols.map((p) => p.roles)));
}

console.log(`\n${failures ? "FAILED" : "ALL PASS"}: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
