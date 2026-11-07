#!/usr/bin/env node
/**
 * PGlite proof for 20261107164311_shops_order_helpr_task.sql (Shops Helpr delivery: the shop card finds the order's
 * Helpr task, then reads the booked slot through helpr_task_view; Builder 5, 11-07).
 *   - the shop owner and the buyer get the task id; a stranger is refused (order_not_found), as is no sign-in;
 *   - a pickup order, and a Helpr order with no task yet, return NULL;
 *   - the shops switch off refuses an ordinary account (require_feature);
 *   - neither PUBLIC nor anon may call it.
 *
 *   node src/test/pglite/shopsOrderHelprTask.pglite.mjs                     # ALL PASS (applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsOrderHelprTask.pglite.mjs  # RED
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261107164311_shops_order_helpr_task.sql"), "utf8");

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [BUYER, SHOP_OWNER, STRANGER] = [1, 11, 31].map(id);
const [ORDER, ORDER_PICKUP, ORDER_NOTASK, ORDER_DECLUTTER_ID] = [91, 92, 93, 94].map(id);
const [TASK, TASK_OTHER_KIND] = [81, 82].map(id);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
-- As 20261012031120's require_feature: raises feature_disabled (42501) when the switch is off for the caller.
CREATE TABLE public.switch_off (k text);
CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.switch_off WHERE k = p_key) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.require_feature(text) TO authenticated;
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, source_kind text NOT NULL, source_id uuid NOT NULL, status text NOT NULL);
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, status text NOT NULL DEFAULT 'accepted',
  fulfillment text NOT NULL DEFAULT 'pickup');
REVOKE ALL ON TABLE public.helpr_tasks, public.shop_orders FROM PUBLIC, anon, authenticated;
`;

const db = new PGlite();
await db.exec("SET check_function_bodies = off;");
await db.exec(SCHEMA);
if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(MIGRATION);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};
async function as(uid, sql, role = "authenticated") {
  try {
    if (uid) await db.exec(`SET request.jwt.claim.sub = '${uid}';`);
    await db.exec(`SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const refused = (r, re) => !Array.isArray(r) && re.test(r.error);
const taskOf = (r) => (Array.isArray(r) ? r[0]?.t ?? null : `ERR ${r.error}`);
const call = (order) => `SELECT public.shops_order_helpr_task('${order}') AS t`;

await db.exec(`
INSERT INTO public.shop_orders (id, buyer_id, seller_id, fulfillment) VALUES
  ('${ORDER}', '${BUYER}', '${SHOP_OWNER}', 'helpr_delivers'),
  ('${ORDER_PICKUP}', '${BUYER}', '${SHOP_OWNER}', 'pickup'),
  ('${ORDER_NOTASK}', '${BUYER}', '${SHOP_OWNER}', 'helpr_delivers');
INSERT INTO public.helpr_tasks (id, source_kind, source_id, status) VALUES
  ('${TASK}', 'shop_delivery', '${ORDER}', 'accepted'),
  -- A Declutter task whose source id happens to equal a shop order's id is never returned.
  ('${TASK_OTHER_KIND}', 'declutter_delivery', '${ORDER_NOTASK}', 'accepted');
`);

ok(taskOf(await as(SHOP_OWNER, call(ORDER))) === TASK, "the shop owner gets the order's Helpr task");
ok(taskOf(await as(BUYER, call(ORDER))) === TASK, "the buyer gets the order's Helpr task");
ok(refused(await as(STRANGER, call(ORDER)), /order_not_found/), "a stranger is refused (order_not_found)");
ok(refused(await as(STRANGER, call(ORDER_DECLUTTER_ID)), /order_not_found/), "an order that does not exist: order_not_found");
ok(refused(await as(null, call(ORDER)), /not_authenticated/), "no sign-in is refused");
ok(taskOf(await as(SHOP_OWNER, call(ORDER_PICKUP))) === null, "a pickup order returns NULL");
ok(taskOf(await as(SHOP_OWNER, call(ORDER_NOTASK))) === null, "a Helpr order with no shop task yet returns NULL (not another kind's task)");
await db.exec(`INSERT INTO public.switch_off VALUES ('shops')`);
ok(refused(await as(BUYER, call(ORDER)), /feature_disabled/), "the shops switch off refuses an ordinary account");
await db.exec(`DELETE FROM public.switch_off`);
ok(refused(await as(BUYER, call(ORDER), "anon"), /permission denied/), "anon may not call it");
const acl = await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'shops_order_helpr_task'`);
const a = acl.rows[0]?.a ?? "";
ok(a.includes("authenticated=X") && !/(^|[{,])=X/.test(a) && !a.includes("anon="), `neither PUBLIC nor anon may call it (${a})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
