#!/usr/bin/env node
/**
 * PGlite proof for 20261105174853_shops_identity_check (Shops H4 part 1, audit ~/.lh-shots/audit-1105-shops.md;
 * owner rule 10-30 "once per account, ever"): the shop owner is checked like a Declutter seller (at listing), the
 * buyer like a Declutter buyer (at the first purchase), through Declutter's one gate, declutter_identity_gate.
 *
 *   node src/test/pglite/shopsIdentityCheck.pglite.mjs [--before]
 *
 * declutter_identity_gate is read from its newest migration copy; is_identity_verified, identity_is_verified and
 * is_server_context are prod's (as declutterIdentityGate.pglite.mjs); identity_check_exempt is the shape it has
 * while the identity_check switch is on for the member (prod: everyone, measured by the audit 2026-11-05): an
 * enrolled seed test account is exempt, is_seed alone is not. The shop tables carry only the columns the triggers
 * read. Writes run as the REAL authenticated role through SECURITY DEFINER stand-ins for shops_publish_item,
 * shops_admin_review_item, shops_update_item and shops_request_order (the triggers fire whichever RPC writes).
 * The migration is applied 3x (replay-safe). --before leaves it out: every RED check must FAIL.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const BEFORE = process.argv.includes("--before");
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${DIR}20261105174853_shops_identity_check.sql`, "utf8");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( statement, any dollar tag. */
function newestDefinition(name) {
  let found = null;
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(`${DIR}${f}`, "utf8");
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

let failures = 0;
let redFailures = 0;
let reds = 0;
const check = (name, ok, red = false) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${red ? "[RED] " : ""}${name}`);
  if (red) reds++;
  if (!ok) {
    failures++;
    if (red) redFailures++;
  }
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NEWBIE = U(1), VERIFIED = U(2), ADMIN = U(3), SEED_ENROLLED = U(4), SEED_ONLY = U(5), OWNER_V = U(6);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, idv_status text, stripe_identity_verified boolean NOT NULL DEFAULT false, is_seed boolean DEFAULT false);
CREATE TABLE public.shop_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL, status text NOT NULL);
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, status text NOT NULL DEFAULT 'awaiting_hold');
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
-- PROD (pg_get_functiondef, as declutterIdentityGate.pglite.mjs), verbatim.
CREATE OR REPLACE FUNCTION public.identity_is_verified(p_idv_status text, p_stripe_identity_verified boolean)
 RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_idv_status IS NOT DISTINCT FROM 'verified' AND p_stripe_identity_verified IS NOT NULL;
$function$;
CREATE OR REPLACE FUNCTION public.is_identity_verified(p_user_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((SELECT public.identity_is_verified(p.idv_status, p.stripe_identity_verified)
      FROM public.profiles p WHERE p.user_id = p_user_id), false);
$function$;
-- The identity_check switch ON for the member (prod: everyone): its NOT feature_enabled_for_user(...) arm is false.
CREATE OR REPLACE FUNCTION public.identity_check_exempt(p_user_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((SELECT p.is_seed IS TRUE AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id)
      FROM public.profiles p WHERE p.user_id = p_user_id), false);
$function$;
CREATE OR REPLACE FUNCTION public.is_server_context()
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NULL
     AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
$function$;
`);
await db.exec(newestDefinition("declutter_identity_gate").stmt);
await db.exec(`
-- The shop RPCs' writes, as SECURITY DEFINER stand-ins (the real RPCs are definers too; auth.uid() is the caller).
CREATE FUNCTION public.t_new_item(p_status text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO public.shop_items (owner_id, status) VALUES (auth.uid(), p_status) RETURNING id $$;
CREATE FUNCTION public.t_set_status(p_item uuid, p_to text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.shop_items SET status = p_to WHERE id = p_item $$;
CREATE FUNCTION public.t_request_order(p_seller uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO public.shop_orders (buyer_id, seller_id) VALUES (auth.uid(), p_seller) RETURNING id $$;
INSERT INTO public.profiles (user_id, idv_status, stripe_identity_verified, is_seed) VALUES
  ('${NEWBIE}', NULL, false, false), ('${VERIFIED}', 'verified', true, false), ('${ADMIN}', NULL, false, false),
  ('${SEED_ENROLLED}', NULL, false, true), ('${SEED_ONLY}', NULL, false, true), ('${OWNER_V}', 'verified', true, false);
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.test_accounts VALUES ('${SEED_ENROLLED}');
`);
if (!BEFORE) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);

async function as(uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid}'; SET request.jwt.claim.role = 'authenticated'; SET ROLE authenticated;`);
    return { rows: (await db.query(sql)).rows };
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub; RESET request.jwt.claim.role;`);
  }
}
const svc = async (sql) => (await db.query(sql)).rows;
const first = (r) => (r.rows?.[0] ? Object.values(r.rows[0])[0] : undefined);
const refusedWith = (r, code) => r.error?.includes(code) && r.code === "42501";

// --- the shop owner, at listing (draft -> live / pending_review)
const d1 = first(await as(NEWBIE, `SELECT public.t_new_item('draft')`));
check("an unverified member can save a draft (no listing yet)", typeof d1 === "string");
check("an unverified owner cannot publish an item live (identity_required_to_list)",
  refusedWith(await as(NEWBIE, `SELECT public.t_set_status('${d1}', 'live')`), "identity_required_to_list"), true);
check("nor into review (identity_required_to_list)",
  refusedWith(await as(NEWBIE, `SELECT public.t_set_status('${d1}', 'pending_review')`), "identity_required_to_list"), true);
check("an unverified owner cannot insert an item straight in live",
  refusedWith(await as(NEWBIE, `SELECT public.t_new_item('live')`), "identity_required_to_list"), true);
check("the refused publish left the item a draft", (await svc(`SELECT status FROM public.shop_items WHERE id = '${d1}'`))[0]?.status === "draft", true);
const v1 = first(await as(VERIFIED, `SELECT public.t_new_item('draft')`));
check("a member verified through Jobs or Declutter publishes without being asked again",
  !(await as(VERIFIED, `SELECT public.t_set_status('${v1}', 'live')`)).error);
const s1 = first(await as(SEED_ENROLLED, `SELECT public.t_new_item('draft')`));
check("an enrolled test account is exempt", !(await as(SEED_ENROLLED, `SELECT public.t_set_status('${s1}', 'live')`)).error);
const s2 = first(await as(SEED_ONLY, `SELECT public.t_new_item('draft')`));
check("is_seed alone (not enrolled) is not exempt",
  refusedWith(await as(SEED_ONLY, `SELECT public.t_set_status('${s2}', 'live')`), "identity_required_to_list"), true);
const a1 = first(await as(ADMIN, `SELECT public.t_new_item('draft')`));
check("an admin's own item is not judged", !(await as(ADMIN, `SELECT public.t_set_status('${a1}', 'live')`)).error);
// Someone else's item: an admin approving a held item (pending_review -> live) is not the owner acting.
await svc(`UPDATE public.shop_items SET status = 'pending_review' WHERE id = '${d1}'`);
check("an admin approving an unverified owner's held item is not judged (the actor is not the owner)",
  !(await as(ADMIN, `SELECT public.t_set_status('${d1}', 'live')`)).error);
check("a live item an edit sends to review (live -> pending_review) is not a new listing",
  !(await as(NEWBIE, `SELECT public.t_set_status('${d1}', 'pending_review')`)).error);
await svc(`UPDATE public.shop_items SET status = 'draft' WHERE id = '${d1}'`);
check("a server write (no member session) is not judged",
  (await svc(`UPDATE public.shop_items SET status = 'live' WHERE id = '${d1}' RETURNING id`)).length === 1);

// --- the buyer, at the first purchase (a shop_orders row for auth.uid() as its buyer)
check("an unverified member cannot ask for a shop order (identity_required_to_buy)",
  refusedWith(await as(NEWBIE, `SELECT public.t_request_order('${OWNER_V}')`), "identity_required_to_buy"), true);
check("no order row was left behind", Number((await svc(`SELECT count(*) AS n FROM public.shop_orders WHERE buyer_id = '${NEWBIE}'`))[0].n) === 0, true);
check("a verified buyer orders", typeof first(await as(VERIFIED, `SELECT public.t_request_order('${OWNER_V}')`)) === "string");
check("an enrolled test account orders", typeof first(await as(SEED_ENROLLED, `SELECT public.t_request_order('${OWNER_V}')`)) === "string");
check("is_seed alone cannot order",
  refusedWith(await as(SEED_ONLY, `SELECT public.t_request_order('${OWNER_V}')`), "identity_required_to_buy"), true);
check("an admin's own order is not judged", typeof first(await as(ADMIN, `SELECT public.t_request_order('${OWNER_V}')`)) === "string");
check("a server-written order is not judged",
  (await svc(`INSERT INTO public.shop_orders (buyer_id, seller_id) VALUES ('${NEWBIE}', '${OWNER_V}') RETURNING id`)).length === 1);
await svc(`DELETE FROM public.shop_orders WHERE buyer_id = '${NEWBIE}'`);
// Once verified, never asked again (once per account, ever).
await svc(`UPDATE public.profiles SET idv_status = 'verified', stripe_identity_verified = true WHERE user_id = '${NEWBIE}'`);
check("once the newbie verifies, they order and publish", typeof first(await as(NEWBIE, `SELECT public.t_request_order('${OWNER_V}')`)) === "string"
  && !(await as(NEWBIE, `SELECT public.t_set_status('${s2}', 'draft')`)).error);

// --- structure
if (!BEFORE) {
  const acl = await svc(`SELECT string_agg(p.proname || ':' || r.rolname, ',') AS w FROM pg_proc p
    CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('shop_identity_before_list', 'shop_identity_before_buy')
      AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')`);
  check("the trigger functions are not client-callable", acl[0]?.w === null);
  const trg = await svc(`SELECT string_agg(tgname, ',' ORDER BY tgname) AS t FROM pg_trigger WHERE NOT tgisinternal
    AND tgrelid IN ('public.shop_items'::regclass, 'public.shop_orders'::regclass)`);
  check("exactly one trigger on each table, after 3 runs", trg[0]?.t === "trg_shop_items_identity_before_list,trg_shop_orders_identity_before_buy");
}

console.log(`\n${failures} FAIL (${redFailures} of ${reds} RED checks failed)${BEFORE ? " (--before)" : ""}`);
if (BEFORE) process.exit(redFailures === reds && failures === redFailures ? 0 : 1);
process.exit(failures === 0 ? 0 : 1);
