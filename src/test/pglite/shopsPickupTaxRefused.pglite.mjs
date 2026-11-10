#!/usr/bin/env node
/**
 * PGlite proof for 20261110205854_shops_pickup_address_tax_refused (Q2146): a pickup address Stripe refuses is
 * stamped, the shop owner is told once per address, the stamp clears when the address changes, and the owner (only
 * the owner, only while the shops switch lets them in) reads that it was refused.
 *
 * The pickup address table and its row trigger are the real ones (20261018210400, the trigger's newest body
 * 20261103091013, the ZIP rule 20261106180540); shops and notifications are the columns these functions touch, and
 * the switch functions are the real ones (20261012031120).
 *
 *   node src/test/pglite/shopsPickupTaxRefused.pglite.mjs                 # ALL PASS (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsPickupTaxRefused.pglite.mjs   # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsPickupTaxRefused.pglite.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW = "20261110205854_shops_pickup_address_tax_refused.sql";
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW}`, "utf8");
const skip = process.env.NEW_MIGRATION === "skip";

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( before this migration, any dollar tag. */
function newestDefinition(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < NEW).sort()) {
    const sql = readFileSync(`${MIG_DIR}${f}`, "utf8");
    const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "gi");
    let m;
    while ((m = re.exec(sql))) {
      const as = /\bAS\s+(\$\w*\$)/g;
      as.lastIndex = m.index;
      const t = as.exec(sql);
      const end = sql.indexOf(t[1], t.index + t[0].length);
      found = { file: f, stmt: `${sql.slice(m.index, end + t[1].length)};` };
    }
  }
  if (!found) throw new Error(`no definition of ${name}`);
  return found;
}
/** A table exactly as its migration creates it (every CHECK). */
function cutTable(file, name) {
  const s = readFileSync(`${MIG_DIR}${file}`, "utf8");
  const at = s.indexOf(`CREATE TABLE IF NOT EXISTS public.${name} (`);
  if (at < 0) throw new Error(`${name} not in ${file}`);
  return s.slice(at, s.indexOf("\n);\n", at) + 4);
}

const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), OTHER = U(2), ORDINARY = U(3);
const SHOP = "0000000b-0000-4000-8000-0000000000cc", SHOP2 = "0000000b-0000-4000-8000-0000000000dd";

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT now(), note text);
-- Read by the newest feature_enabled_for_user (App Review accounts, per-switch members); empty here.
CREATE TABLE public.store_review_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.feature_switch_members (key text NOT NULL, user_id uuid NOT NULL);
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES auth.users(id));
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('system_alert', 'info', 'warning')), title text NOT NULL, message text NOT NULL, link text,
  created_at timestamptz NOT NULL DEFAULT now());
${cutTable("20261012031120_hidden_feature_switches.sql", "feature_switches")}
INSERT INTO public.feature_switches (key, audience, description) VALUES ('shops', 'testers', 'Shops');
INSERT INTO auth.users VALUES ('${OWNER}'), ('${OTHER}'), ('${ORDINARY}');
INSERT INTO public.test_accounts (user_id) VALUES ('${OWNER}'), ('${OTHER}');
INSERT INTO public.shops VALUES ('${SHOP}', '${OWNER}'), ('${SHOP2}', '${ORDINARY}');
`);
for (const name of ["feature_enabled_for_user", "feature_enabled_for", "require_feature"]) await db.exec(newestDefinition(name).stmt);
await db.exec(cutTable("20261018210400_shops_pickup_address.sql", "shop_pickup_addresses"));
await db.exec(newestDefinition("shop_pickup_addresses_owner_is_shop_owner").stmt);
await db.exec(`CREATE TRIGGER trg_shop_pickup_addresses_owner BEFORE INSERT OR UPDATE ON public.shop_pickup_addresses
  FOR EACH ROW EXECUTE FUNCTION public.shop_pickup_addresses_owner_is_shop_owner();
REVOKE ALL ON TABLE public.shop_pickup_addresses FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shop_pickup_addresses TO service_role;
INSERT INTO public.shop_pickup_addresses (shop_id, owner_id, line1, city, postal_code) VALUES
  ('${SHOP}', '${OWNER}', '12 Bayou Rd', 'Lafayette', '70501'), ('${SHOP2}', '${ORDINARY}', '9 Oak St', 'Erath', '70533');`);

if (!skip) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};
const svc = async (sql) => {
  try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; }
};
async function as(role, uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const notices = async () => one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${OWNER}'`));
const stamp = async () => (await svc(`SELECT tax_refused_at, tax_refused_reason FROM public.shop_pickup_addresses WHERE shop_id = '${SHOP}'`))?.[0] ?? {};
/** The copy of the address a checkout was taxed on (its updated_at, as shop-checkout reads it). */
const version = async () => one(await svc(`SELECT updated_at::text FROM public.shop_pickup_addresses WHERE shop_id = '${SHOP}'`));
const mark = async (reason, at) =>
  as("service_role", null, `SELECT public.shops_mark_pickup_address_refused('${SHOP}', '${at ?? await version()}'::timestamptz, '${reason}') AS sent`);
const clear = async (at) => as("service_role", null, `SELECT public.shops_clear_pickup_address_refused('${SHOP}', '${at ?? await version()}'::timestamptz) AS cleared`);

// --- 1. the first refusal stamps the address and tells the owner once, in plain words, pointing at My shop
const first = await mark("Unable to determine tax location");
ok(one(first) === true, `first refusal: a notice is sent (${JSON.stringify(first)})`);
const n1 = (await svc(`SELECT type, title, message, link FROM public.notifications WHERE user_id = '${OWNER}'`)) ?? [];
ok(Array.isArray(n1) && n1.length === 1 && n1[0].type === "system_alert" && n1[0].link === "/shops/mine"
  && /pickup address/.test(n1[0].message) && !/Stripe/.test(n1[0].message), `the owner gets one notice, no jargon, linking My shop (${JSON.stringify(n1)})`);
const s1 = await stamp();
ok(s1.tax_refused_at != null && s1.tax_refused_reason === "Unable to determine tax location", `the address is stamped with when and why (${JSON.stringify(s1)})`);

// --- 2. a second refusal of the same address sends nothing more
const second = await mark("again");
ok(one(second) === false && (await notices()) === 1, `second refusal: no second notice (${JSON.stringify(second)}, notices ${await notices()})`);

// --- 3. the owner reads it; another tester and a member the switch keeps out do not
const own = await as("authenticated", OWNER, `SELECT public.shops_my_pickup_address_problem() AS at`);
ok(Array.isArray(own) && own[0]?.at != null, `the owner reads that the address was refused (${JSON.stringify(own)})`);
const other = await as("authenticated", OTHER, `SELECT public.shops_my_pickup_address_problem() AS at`);
ok(Array.isArray(other) && other[0]?.at === null, `another member never reads someone else's (${JSON.stringify(other)})`);
const outside = await as("authenticated", ORDINARY, `SELECT public.shops_my_pickup_address_problem() AS at`);
ok(!Array.isArray(outside) && /feature_disabled/.test(outside.error), `a member the shops switch keeps out is refused (${JSON.stringify(outside)})`);

// --- 4. a save that keeps the address keeps the stamp; a new street clears it, and its first refusal tells again
await svc(`UPDATE public.shop_pickup_addresses SET city = 'Lafayette' WHERE shop_id = '${SHOP}'`);
ok((await stamp()).tax_refused_at != null, "the same address saved again keeps the stamp");
const before = await version();
await svc(`UPDATE public.shop_pickup_addresses SET line1 = '14 Bayou Rd' WHERE shop_id = '${SHOP}'`);
const cleared = await stamp();
ok(cleared.tax_refused_at === null && cleared.tax_refused_reason === null, `a new address clears the stamp (${JSON.stringify(cleared)})`);
const third = await mark("Unable to determine tax location");
ok(one(third) === true && (await notices()) === 2, `the new address's first refusal tells the owner again (notices ${await notices()})`);

// --- 4b. review 1: a refusal of the OLD copy (a checkout taxed before the save) never lands on the new address
await svc(`UPDATE public.shop_pickup_addresses SET tax_refused_at = NULL, tax_refused_reason = NULL WHERE shop_id = '${SHOP}'`);
const stale = await mark("old copy", before);
ok(one(stale) === false && (await stamp()).tax_refused_at === null && (await notices()) === 2,
  `a refusal of the address as it was before the save stamps nothing and tells no one (${JSON.stringify(stale)})`);

// --- 4c. review 2: Stripe later taxes the same copy, so the refusal was a one-off and the stamp goes
await mark("one-off");
const notOld = await clear(before);
ok(one(notOld) === false && (await stamp()).tax_refused_at != null, "a success on an older copy clears nothing");
const cleared2 = await clear();
ok(one(cleared2) === true && (await stamp()).tax_refused_at === null && (await stamp()).tax_refused_reason === null,
  `a success on the same copy clears the stamp (${JSON.stringify(cleared2)})`);
const again = await clear();
ok(one(again) === false, "nothing to clear: false");

// --- 5. the words are capped, a shop without an address is a quiet false
const long = await as("service_role", null, `SELECT public.shops_mark_pickup_address_refused('${SHOP}', '${await version()}'::timestamptz, repeat('x', 500))`);
ok(Array.isArray(long) && ((await stamp()).tax_refused_reason ?? "").length === 200, "a long refusal is cut to 200 characters");
const none = await as("service_role", null, `SELECT public.shops_mark_pickup_address_refused('0000000b-0000-4000-8000-0000000000ee', now(), 'x') AS sent`);
ok(one(none) === false, `a shop with no pickup address: false, nothing written (${JSON.stringify(none)})`);

// --- 6. grants: only the server stamps; members read, anon never
const memberMark = await as("authenticated", OWNER, `SELECT public.shops_mark_pickup_address_refused('${SHOP}', now(), 'x')`);
const memberClear = await as("authenticated", OWNER, `SELECT public.shops_clear_pickup_address_refused('${SHOP}', now())`);
ok(!Array.isArray(memberClear) && /permission denied/.test(memberClear.error), `a member cannot clear the stamp (${JSON.stringify(memberClear)})`);
ok(!Array.isArray(memberMark) && /permission denied/.test(memberMark.error), `a member cannot stamp or send the notice (${JSON.stringify(memberMark)})`);
for (const [fn, sig, want] of [["shops_mark_pickup_address_refused", "uuid, timestamptz, text", /^service_role=X/],
  ["shops_clear_pickup_address_refused", "uuid, timestamptz", /^service_role=X/], ["shops_my_pickup_address_problem", "", /authenticated=X/]]) {
  const acl = one(await svc(`SELECT array_to_string(proacl, ',') FROM pg_proc WHERE oid = to_regprocedure('public.${fn}(${sig})')`)) ?? "";
  ok(!skip && !/(^|,)anon=/.test(acl) && !/(^|,)=X/.test(acl) && acl.split(",").some((a) => want.test(a)), `${fn}: grants (${acl})`);
}
const memberRow = await as("authenticated", OWNER, `SELECT tax_refused_reason FROM public.shop_pickup_addresses`);
ok(!Array.isArray(memberRow) && /permission denied/.test(memberRow.error), "no member reads the table; the app never shows Stripe's words");
for (const fn of ["shops_mark_pickup_address_refused", "shops_clear_pickup_address_refused"]) {
  const authAcl = one(await svc(`SELECT array_to_string(proacl, ',') FROM pg_proc WHERE proname = '${fn}'`)) ?? "";
  ok(!skip && !/(^|,)authenticated=/.test(authAcl), `${fn}: never authenticated (${authAcl})`);
}

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
