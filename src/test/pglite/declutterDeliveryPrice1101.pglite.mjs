#!/usr/bin/env node
/**
 * PGlite proof for 20261101175628_declutter_delivery_price_6_plus_150 (owner 2026-11-01: Helpr delivery $6 + $1.50 a
 * mile, size add-ons unchanged). Applied 3 times on the two tables its CHECKs live on (orders, order deliveries) with
 * the old $10 floor in place, as prod has them.
 *
 *   node src/test/pglite/declutterDeliveryPrice1101.pglite.mjs                    # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterDeliveryPrice1101.pglite.mjs # RED: the old $10 + $2 price
 *   MIGRATION_PATH=<planted copy> node ...                                        # a mutant: must go RED
 *
 * declutter_delivery_compute is plpgsql: created here (bodies not checked: its tables are not built), its breakdown read from
 * the migration's text (600 / 150 * v_miles), since its tables are not built here; declutterDelivery.pglite.mjs runs it.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const FILE = new URL("../../../supabase/migrations/20261101175628_declutter_delivery_price_6_plus_150.sql", import.meta.url);
const OLD = new URL("../../../supabase/migrations/20261017055505_declutter_helpr_delivery.sql", import.meta.url);
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const skip = process.env.NEW_MIGRATION === "skip";
const sql = readFileSync(process.env.MIGRATION_PATH ?? FILE, "utf8");

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.declutter_orders (id serial PRIMARY KEY, handover text NOT NULL, delivery_cents integer NOT NULL DEFAULT 0,
    CONSTRAINT declutter_orders_delivery CHECK (delivery_cents >= 0 AND (handover <> 'delivery' OR delivery_cents >= 1000)
      AND (handover <> 'seller_delivery' OR (delivery_cents % 100 = 0 AND (delivery_cents = 0 OR delivery_cents BETWEEN 500 AND 15000)))));
  CREATE TABLE public.declutter_order_deliveries (order_id integer PRIMARY KEY, delivery_cents integer NOT NULL CHECK (delivery_cents >= 1000));
  -- The row type declutter_delivery_compute declares (its body is not run here).
  CREATE TABLE public.declutter_delivery_dropoffs (buyer_id uuid, seller_id uuid, address text, area_label text, lat numeric, lng numeric);
  INSERT INTO public.declutter_orders (handover, delivery_cents) VALUES ('delivery', 1200), ('seller_delivery', 500), ('porch', 0);
  INSERT INTO public.declutter_order_deliveries VALUES (1, 1200);
`);
if (skip) {
  const m = /CREATE OR REPLACE FUNCTION public\.declutter_delivery_price_cents[\s\S]*?\$fn\$;/.exec(readFileSync(OLD, "utf8"));
  await db.exec(m[0]);
} else {
  // declutter_delivery_compute's declarations name tables not built here: its body is not checked at create time
  // (check_function_bodies off, as pg_dump restores do); declutterDelivery.pglite.mjs runs it.
  await db.exec("SET check_function_bodies = off");
  for (let i = 0; i < 3; i++) await db.exec(sql);
}

let fails = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) fails++; };
const price = async (miles, sizes) => (await db.query(`SELECT public.declutter_delivery_price_cents($1, $2::text[]) AS c`, [miles, sizes])).rows[0].c;
const insertOk = async (q) => { try { await db.exec(q); return true; } catch { return false; } };

ok(await price(5, ["small"]) === 1350, "5 road miles, small: $13.50");
ok(await price(10, ["large"]) === 4100, "10 road miles, large: $41");
ok(await price(1, []) === 750, "1 mile (the floor), nothing large: $7.50");
ok(await price(0, null) === 750, "0 or no miles counts as 1");
ok(await price(3, ["xl", "large"]) === 600 + 450 + 6000, "add-ons per item: extra large +$40, large +$20");
ok(await insertOk(`INSERT INTO public.declutter_orders (handover, delivery_cents) VALUES ('delivery', 750)`), "an order at the new floor ($7.50) is allowed");
ok(!(await insertOk(`INSERT INTO public.declutter_orders (handover, delivery_cents) VALUES ('delivery', 749)`)), "an order under it is refused");
ok(!(await insertOk(`INSERT INTO public.declutter_orders (handover, delivery_cents) VALUES ('seller_delivery', 450)`)), "seller delivery's own $5-$150 rule is kept");
ok(await insertOk(`INSERT INTO public.declutter_order_deliveries VALUES (2, 750)`), "a frozen delivery at $7.50 is allowed");
ok(!(await insertOk(`INSERT INTO public.declutter_order_deliveries VALUES (3, 749)`)), "under it is refused");
const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'declutter_delivery_price_cents'`)).rows[0].a ?? "";
ok(!/(^|[{,])=X/.test(acl) && !/anon=X/.test(acl), `no EXECUTE for PUBLIC or anon (${acl})`);
const body = sql.slice(sql.indexOf("FUNCTION public.declutter_delivery_compute"));
ok(!skip && body.includes("600, 150 * v_miles, public.declutter_delivery_price_cents(v_miles, v_sizes) - 600 - 150 * v_miles,"), "the quote's breakdown: $6 base, $1.50 a mile, the rest is size");
const fn = (await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'declutter_delivery_compute'`)).rows[0].n;
ok(skip || fn === 1, "declutter_delivery_compute was created");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
