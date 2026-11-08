#!/usr/bin/env node
/**
 * PGlite proof for 20261108200421_shops_services_in_person.sql (shops audit 11-08 #3, Builder 5): an order with a
 * service, rental or at-home line is always 'in_person', so the porch ready-photo rule (refund + strike no_ready_photo)
 * can never reach it. Goods keep the shop's porch choice, and the mode still never moves after the order is paid.
 *
 *   node src/test/pglite/shopsServicesInPerson.pglite.mjs                     # ALL PASS (applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsServicesInPerson.pglite.mjs  # RED: the old freeze only
 *
 * The OLD freeze trigger is cut verbatim from its newest CREATE (20261018211820) and attached as on prod.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261108200421_shops_services_in_person.sql"), "utf8");

function cutFn(file, name) {
  const s = readFileSync(url(file), "utf8");
  const at = s.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (at < 0) throw new Error(`${name} not in ${file}`);
  const tag = /AS\s+(\$[a-zA-Z_]*\$)/.exec(s.slice(at));
  const bodyStart = at + tag.index + tag[0].length;
  const end = s.indexOf(tag[1], bodyStart) + tag[1].length;
  return `${s.slice(at, end)};`;
}

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [BUYER, OWNER, SHOP] = [1, 11, 91].map(id);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid, handover_mode text NOT NULL DEFAULT 'in_person');
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, shop_id uuid,
  status text NOT NULL DEFAULT 'awaiting_hold', handover_mode text NOT NULL DEFAULT 'in_person'
  CHECK (handover_mode IN ('porch', 'in_person')));
CREATE TABLE public.shop_order_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid REFERENCES public.shop_orders(id),
  kind text NOT NULL, at_buyer boolean NOT NULL DEFAULT false);
${cutFn("20261018211820_shops_handover_payout.sql", "shop_orders_handover_mode_frozen")}
CREATE TRIGGER trg_shop_orders_handover_mode BEFORE INSERT OR UPDATE OF handover_mode ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_handover_mode_frozen();
`;

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`PASS ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); }
};

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(`INSERT INTO public.shops VALUES ('${SHOP}', '${OWNER}', 'porch');`);
const q = async (sql) => (await db.query(sql)).rows;
// An unpaid porch order with a service line, written before the migration (the backfill's case).
const [{ id: early }] = await q(`INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id) VALUES ('${BUYER}', '${OWNER}', '${SHOP}') RETURNING id`);
await q(`INSERT INTO public.shop_order_lines (order_id, kind) VALUES ('${early}', 'service')`);

if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
}

async function order(lines) {
  const [{ id: oid }] = await q(`INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id) VALUES ('${BUYER}', '${OWNER}', '${SHOP}') RETURNING id`);
  for (const [kind, atBuyer] of lines) await q(`INSERT INTO public.shop_order_lines (order_id, kind, at_buyer) VALUES ('${oid}', '${kind}', ${atBuyer})`);
  return oid;
}
const mode = async (oid) => (await q(`SELECT handover_mode FROM public.shop_orders WHERE id = '${oid}'`))[0].handover_mode;

ok((await mode(await order([["made", false]]))) === "porch", "goods from a porch shop keep the porch handover");
ok((await mode(await order([["home_food", false], ["farm", false]]))) === "porch", "a goods-only basket keeps the porch handover");
ok((await mode(await order([["service", false]]))) === "in_person", "a service from a porch shop is in person (no ready photo, no photo strike)");
ok((await mode(await order([["service", true]]))) === "in_person", "at-home work is in person");
ok((await mode(await order([["rental", false]]))) === "in_person", "a rental is in person");
ok((await mode(await order([["made", false], ["service", false]]))) === "in_person", "a basket with any service line is in person");
ok((await mode(early)) === "in_person", "an unpaid porch service order written before the fix is moved too");

// The freeze still holds everywhere else.
const goods = await order([["made", false]]);
let err = null;
try { await q(`UPDATE public.shop_orders SET handover_mode = 'in_person' WHERE id = '${goods}'`); } catch (e) { err = e; }
ok(err && /handover_mode_frozen/.test(err.message), "a goods order's handover can never be moved");
const paid = await order([["made", false]]);
await q(`UPDATE public.shop_orders SET status = 'held' WHERE id = '${paid}'`);
await q(`INSERT INTO public.shop_order_lines (order_id, kind) VALUES ('${paid}', 'service')`);
ok((await mode(paid)) === "porch", "a paid order's handover never moves after the hold, even if a line is added");
const svc = await order([["service", false]]);
err = null;
try { await q(`UPDATE public.shop_orders SET handover_mode = 'porch' WHERE id = '${svc}'`); } catch (e) { err = e; }
ok(err && /handover_mode_frozen/.test(err.message), "a service order can never be moved back to porch");

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
