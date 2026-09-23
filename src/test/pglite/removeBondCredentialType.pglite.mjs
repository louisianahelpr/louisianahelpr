#!/usr/bin/env node
/**
 * PGlite proof for Q141 (docs/OPEN.md): 20260923130457 removes the 'bond'
 * credential type.
 *
 *   node src/test/pglite/removeBondCredentialType.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/removeBondCredentialType.pglite.mjs   # RED: live (pre-fix) state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture: helper_credentials with its live CHECKs and FKs (pg_constraint,
 * 2026-09-23), the profiles columns the two functions read, storage.objects,
 * and the pre-fix get_user_credential_tier / helper_credential_document_ok
 * taken VERBATIM from their newest definition BEFORE 20260923130457. Then:
 *   1. a bond row owned by a NON-seed account -> the migration refuses, and
 *      rolls back whole (row, CHECKs and functions unchanged);
 *   2. with only the seed bond row (the prod shape) -> applies 3x;
 *   3. behaviour afterwards: no bond rows, a bond INSERT refused, the bond-only
 *      CHECK gone, a bond document refused by the helper, the tier unchanged
 *      for license + insurance, and the grants as live.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const ROOT = new URL("../../../", import.meta.url).pathname;
const FIX = "20260923130457_remove_bond_credential_type.sql";
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the pre-fix state (expect FAILs)`);

const before = readdirSync(`${ROOT}supabase/migrations`).filter((f) => f.endsWith(".sql") && f < FIX).sort();
/** The newest pre-fix `CREATE [OR REPLACE] FUNCTION public.<name>(` statement, verbatim, any dollar tag. */
function preFix(name) {
  let found = null;
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`, "gi");
  for (const f of before) {
    const sql = readFileSync(`${ROOT}supabase/migrations/${f}`, "utf8");
    for (const m of sql.matchAll(head)) {
      const lineStart = sql.lastIndexOf("\n", m.index) + 1;
      if (/--/.test(sql.slice(lineStart, m.index))) continue;
      const rest = sql.slice(m.index);
      const tag = rest.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/);
      if (!tag) continue;
      const close = rest.indexOf(tag[1], tag.index + tag[0].length);
      found = rest.slice(0, close + tag[1].length) + ";";
    }
  }
  if (!found) throw new Error(`no pre-fix migration defines public.${name}`);
  return found;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const SEED = "11111111-0000-4000-8000-000000000001";
const REAL = "11111111-0000-4000-8000-000000000002";
const LIC_INS = "11111111-0000-4000-8000-000000000003";
const LIC_ONLY = "11111111-0000-4000-8000-000000000004";

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.objects (bucket_id text, name text, PRIMARY KEY (bucket_id, name));
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL,
  is_seed boolean NOT NULL DEFAULT false,
  license_status text, license_expires_at date,
  insurance_status text, insurance_expires_at date,
  stripe_identity_verified boolean DEFAULT false,
  id_verification_status text, idv_status text
);
-- Live constraints (pg_constraint, 2026-09-23).
CREATE TABLE public.helper_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  credential_type text NOT NULL,
  status text NOT NULL DEFAULT 'unverified',
  document_url text,
  expiration_date date,
  rejection_reason text,
  CONSTRAINT helper_credentials_credential_type_check
    CHECK (credential_type = ANY (ARRAY['identity'::text, 'background_check'::text, 'trade_license'::text, 'insurance'::text, 'bond'::text])),
  CONSTRAINT helper_credentials_status_check
    CHECK (status = ANY (ARRAY['unverified'::text, 'submitted'::text, 'verified'::text, 'expired'::text, 'rejected'::text])),
  CONSTRAINT helper_credentials_pending_bond_needs_document
    CHECK (((credential_type <> 'bond'::text) OR (status <> ALL (ARRAY['unverified'::text, 'submitted'::text])) OR (NULLIF(btrim(document_url), ''::text) IS NOT NULL)))
);
CREATE TABLE public.verification_checks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), credential_id uuid REFERENCES public.helper_credentials(id) ON DELETE CASCADE);
CREATE TABLE public.verification_exceptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), credential_id uuid REFERENCES public.helper_credentials(id));
`);
await db.exec(preFix("helper_credential_document_ok"));
await db.exec(preFix("get_user_credential_tier"));
// Live pg_proc.proacl (2026-09-23).
await db.exec(`
REVOKE ALL ON FUNCTION public.helper_credential_document_ok(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helper_credential_document_ok(uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.get_user_credential_tier(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_credential_tier(uuid) TO authenticated, service_role;
`);

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => Object.values((await q(sql, params))[0] ?? {})[0];
const bondRows = () => one(`SELECT count(*)::int FROM public.helper_credentials WHERE credential_type = 'bond'`);
const hasCon = (n) => one(`SELECT count(*)::int FROM pg_constraint WHERE conname = $1`, [n]);
const fnHasBond = (sig) => one(`SELECT prosrc ~ '''bond''' FROM pg_proc WHERE oid = $1::regprocedure`, [sig]);
const acl = (sig) => one(`SELECT proacl::text FROM pg_proc WHERE oid = $1::regprocedure`, [sig]);

await q(`INSERT INTO public.profiles (user_id, is_seed) VALUES ($1, true), ($2, false)`, [SEED, REAL]);
await q(`INSERT INTO public.helper_credentials (user_id, credential_type, status, rejection_reason) VALUES ($1, 'bond', 'rejected', 'SEED: x')`, [SEED]);
const aclBefore = { tier: await acl("public.get_user_credential_tier(uuid)"), ok: await acl("public.helper_credential_document_ok(uuid,text,text)") };

const fix = readFileSync(`${ROOT}supabase/migrations/${FIX}`, "utf8");
if (MODE !== "skip") {
  // 1. A real account's bond row stops the migration, atomically.
  await q(`INSERT INTO public.helper_credentials (user_id, credential_type, status, rejection_reason) VALUES ($1, 'bond', 'rejected', 'x')`, [REAL]);
  let err = null;
  try { await db.exec(fix); } catch (e) { err = e; }
  check("a NON-seed bond row -> the migration refuses", !!err && /Q141: 1 bond credential row/.test(err.message), err?.message ?? "applied");
  check("   ... and rolls back whole: both bond rows, the bond CHECK and the old functions remain",
    (await bondRows()) === 2 && (await hasCon("helper_credentials_pending_bond_needs_document")) === 1 &&
      (await fnHasBond("public.get_user_credential_tier(uuid)")) === true);
  await q(`DELETE FROM public.helper_credentials WHERE user_id = $1`, [REAL]);

  // 2. The prod shape (one seed bond row): applies, 3x.
  for (let i = 1; i <= 3; i++) {
    try { await db.exec(fix); check(`migration applies (pass ${i}/3)`, true); }
    catch (e) { check(`migration applies (pass ${i}/3)`, false, e.message); }
  }
}

// 3. Behaviour.
check("no bond rows remain", (await bondRows()) === 0, `${await bondRows()} rows`);
{
  let err = null;
  try { await q(`INSERT INTO public.helper_credentials (user_id, credential_type, status, rejection_reason) VALUES ($1, 'bond', 'rejected', 'x')`, [SEED]); }
  catch (e) { err = e; }
  check("a bond INSERT is refused by the type CHECK", err?.code === "23514" && /credential_type_check/.test(err.message), err?.message ?? "accepted");
  if (!err) await q(`DELETE FROM public.helper_credentials WHERE credential_type = 'bond'`);
}
check("helper_credentials_pending_bond_needs_document is gone", (await hasCon("helper_credentials_pending_bond_needs_document")) === 0);
check("the type CHECK still exists", (await hasCon("helper_credentials_credential_type_check")) === 1);
check("no public function body names 'bond'",
  (await one(`SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosrc ~ '''bond'''`)) === 0);

const bondPath = `${LIC_INS}/credentials/bond-1790000000000.pdf`;
const licPath = `${LIC_INS}/credentials/trade_license-1790000000000.pdf`;
await q(`INSERT INTO storage.objects VALUES ('user-documents', $1), ('user-documents', $2)`, [bondPath, licPath]);
check("helper_credential_document_ok refuses an uploaded bond document",
  (await one(`SELECT public.helper_credential_document_ok($1, 'bond', $2)`, [LIC_INS, bondPath])) === false);
check("helper_credential_document_ok still accepts an uploaded trade_license document",
  (await one(`SELECT public.helper_credential_document_ok($1, 'trade_license', $2)`, [LIC_INS, licPath])) === true);

await q(`INSERT INTO public.helper_credentials (user_id, credential_type, status) VALUES ($1, 'trade_license', 'verified'), ($1, 'insurance', 'verified'), ($2, 'trade_license', 'verified')`, [LIC_INS, LIC_ONLY]);
check("tier: verified license + verified insurance = 3", (await one(`SELECT public.get_user_credential_tier($1)`, [LIC_INS])) === 3);
check("tier: verified license only = 2", (await one(`SELECT public.get_user_credential_tier($1)`, [LIC_ONLY])) === 2);

check("grants unchanged: get_user_credential_tier", (await acl("public.get_user_credential_tier(uuid)")) === aclBefore.tier, `${aclBefore.tier} -> ${await acl("public.get_user_credential_tier(uuid)")}`);
check("grants unchanged: helper_credential_document_ok", (await acl("public.helper_credential_document_ok(uuid,text,text)")) === aclBefore.ok, `${aclBefore.ok} -> ${await acl("public.helper_credential_document_ok(uuid,text,text)")}`);
check("helper_credential_document_ok is not executable by authenticated or anon",
  !/(^|[{,])(authenticated|anon)=/.test(await acl("public.helper_credential_document_ok(uuid,text,text)")));
check("search_path pinned on both functions",
  (await one(`SELECT count(*)::int FROM pg_proc WHERE proname IN ('get_user_credential_tier','helper_credential_document_ok') AND proconfig @> ARRAY['search_path=public']`)) === 2);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
