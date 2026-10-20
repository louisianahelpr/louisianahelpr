#!/usr/bin/env node
/**
 * PGlite proof for 20261020033623_declutter_items_seed_boundary (Cowork design
 * audit 2026-10-20, D1: the owner saw test sellers' fixtures on Declutter Browse).
 *
 *   npx tsx src/test/pglite/declutterSeedBoundary.pglite.mjs [--replay] [--before]
 *
 * The items read policy is loaded from the NEWEST statement before this
 * migration; seed_jobs_hidden_publicly and seed_hidden_in_discovery from their
 * EFFECTIVE definitions. --before leaves the migration out and the RED checks
 * must FAIL; without it the migration is applied (3x with --replay) and every
 * check must PASS. Reads run under the REAL authenticated role with RLS on,
 * both on declutter_items and through the photos policy (EXISTS over items).
 *
 * Switch ON:
 *   R1 a real member does not see a test seller's live item (Browse)        RED before
 *   R2 an admin (the owner) does not see it either                          RED before
 *   R3 a real member cannot read its photos                                 RED before
 *   R4 a real member cannot open it by id (the item page)                   RED before
 * Kept (green before and after):
 *   K1 a real member still sees a real seller's live item and its photo
 *   K2 the test seller still sees their own item
 *   K3 another test account still sees the test item (the journeys)
 * Switch OFF:
 *   K4 a real member sees the test item (today's behaviour with the switch off)
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { effectiveDefs, migrationFiles } from "../helpers/effectiveFunctionDefs.ts";
import { blankSqlComments } from "../helpers/blankNonCode.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261020033623_declutter_items_seed_boundary.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const POLICY = "declutter items: seller or switched-on members read live";

const DEFS = effectiveDefs(DIR, { before: THIS });
function fnStmt(name) {
  const d = DEFS.get(name);
  if (!d) throw new Error(`no migration before ${THIS} defines ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  return `${d.stmt.slice(0, end + open[1].length)};`;
}
/** The newest CREATE POLICY "<POLICY>" before this migration, raw text. */
function policyBefore() {
  let found = null;
  for (const f of migrationFiles(DIR)) {
    if (f >= THIS) break;
    const raw = readFileSync(DIR + f, "utf8");
    const re = new RegExp(`CREATE\\s+POLICY\\s+"${POLICY}"[\\s\\S]*?;`, "gi");
    for (const m of blankSqlComments(raw).matchAll(re)) found = raw.slice(m.index, m.index + m[0].length);
  }
  if (!found) throw new Error("no items read policy before this migration");
  return found;
}

let failures = 0;
let redFailures = 0;
const check = (name, ok, detail = "", red = false) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) {
    failures++;
    if (red) redFailures++;
  }
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const REAL = U(1), SEED_SELLER = U(2), SEED_OTHER = U(3), ADMIN = U(4), REAL_SELLER = U(5);
const SEED_ITEM = U(101), REAL_ITEM = U(102);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.platform_settings (id int PRIMARY KEY DEFAULT 1, feature_flags jsonb NOT NULL DEFAULT '{}', updated_at timestamptz DEFAULT now());
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE TABLE public.profiles (id uuid DEFAULT gen_random_uuid(), user_id uuid PRIMARY KEY, is_seed boolean DEFAULT false);
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid NOT NULL, status text NOT NULL, title text, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.declutter_item_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid REFERENCES public.declutter_items(id), storage_path text);
ALTER TABLE public.declutter_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.declutter_item_photos ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT SELECT ON public.declutter_items, public.declutter_item_photos TO authenticated;
-- The 'declutter' switch on for everyone; no banned seller (their own proofs).
CREATE FUNCTION public.feature_enabled_for(text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.declutter_seller_hidden(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
${fnStmt("is_server_context")}
${fnStmt("has_role")}
${fnStmt("seed_jobs_hidden_publicly")}
${fnStmt("seed_hidden_in_discovery")}
-- Live 2026-10-20 (pg_policies qual): the photos policy.
CREATE POLICY "declutter photos: readable with their item" ON public.declutter_item_photos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = declutter_item_photos.item_id));
${policyBefore()}

INSERT INTO public.platform_settings (feature_flags) VALUES ('{"seed_jobs_hidden_publicly": true}');
INSERT INTO public.profiles (user_id, is_seed) VALUES ('${REAL}', false), ('${SEED_SELLER}', true), ('${SEED_OTHER}', true), ('${ADMIN}', false), ('${REAL_SELLER}', false);
INSERT INTO public.test_accounts VALUES ('${SEED_SELLER}'), ('${SEED_OTHER}');
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.declutter_items VALUES
  ('${SEED_ITEM}', '${SEED_SELLER}', 'live', 'Fixture rocking chair [E2E-PRODAUDIT]', true),
  ('${REAL_ITEM}', '${REAL_SELLER}', 'live', 'Oak dresser', false);
INSERT INTO public.declutter_item_photos (item_id, storage_path) VALUES ('${SEED_ITEM}', 's.jpg'), ('${REAL_ITEM}', 'r.jpg');
`;

const db = new PGlite();
await db.exec(SCHEMA);
if (!BEFORE) for (let i = 0; i < (REPLAY ? 3 : 1); i++) await db.exec(MIGRATION);

async function as(uid, sql) {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    return (await db.query(sql)).rows;
  } finally {
    await db.exec("RESET ROLE;");
  }
}
const browse = (uid) => as(uid, "SELECT id FROM public.declutter_items WHERE status IN ('live','reserved')").then((r) => r.map((x) => x.id));
const photos = (uid) => as(uid, "SELECT item_id FROM public.declutter_item_photos").then((r) => r.map((x) => x.item_id));

console.log(`${BEFORE ? "BEFORE (migration left out)" : `AFTER (applied ${REPLAY ? 3 : 1}x)`}`);
check("R1 a real member does not see a test seller's live item", !(await browse(REAL)).includes(SEED_ITEM), "", true);
check("R2 an admin does not see it either", !(await browse(ADMIN)).includes(SEED_ITEM), "", true);
check("R3 a real member cannot read its photos", !(await photos(REAL)).includes(SEED_ITEM), "", true);
check("R4 a real member cannot open it by id", (await as(REAL, `SELECT id FROM public.declutter_items WHERE id = '${SEED_ITEM}'`)).length === 0, "", true);
check("K1 a real member sees a real seller's item and its photo", (await browse(REAL)).includes(REAL_ITEM) && (await photos(REAL)).includes(REAL_ITEM));
check("K2 the test seller sees their own item", (await browse(SEED_SELLER)).includes(SEED_ITEM));
check("K3 another test account sees the test item", (await browse(SEED_OTHER)).includes(SEED_ITEM));
await db.exec(`UPDATE public.platform_settings SET feature_flags = '{"seed_jobs_hidden_publicly": false}'`);
check("K4 switch off: a real member sees the test item", (await browse(REAL)).includes(SEED_ITEM));

if (BEFORE) {
  const expectedRed = 4;
  console.log(`\n${redFailures}/${expectedRed} RED checks failed before the migration (want ${expectedRed}); ${failures - redFailures} kept checks failed (want 0)`);
  process.exit(redFailures === expectedRed && failures === redFailures ? 0 : 1);
}
console.log(`\n${failures} failure(s)`);
process.exit(failures ? 1 : 0);
