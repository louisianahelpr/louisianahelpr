#!/usr/bin/env node
/**
 * PGlite proof for 20261106223244_shops_helpr_delivery_quote.sql (Builder 5, 11-06, Shops Helpr delivery slice 2):
 * the Helpr delivery price a buyer is shown before ordering.
 *   - Declutter's $6 + $1.50/mi (declutter_delivery_price_cents, '{small}') for the road miles from the shop's
 *     private pickup point to the drop-off (declutter_road_miles), the same figure shop_set_order_helpr_delivery
 *     freezes (20261106194913);
 *   - an unrouted pair is named back to the service edge (route) so Apple can route it; once a routed row is stored
 *     under that exact key, the routed miles price it and no route is asked; a routing pause asks none;
 *   - the same refusals as the order: no Helpr delivery / no point, outside Louisiana, past 50 miles;
 *   - members and anon cannot call it.
 *
 *   node src/test/pglite/shopsHelprDeliveryQuote.pglite.mjs                     # ALL PASS (applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsHelprDeliveryQuote.pglite.mjs  # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsHelprDeliveryQuote.pglite.mjs
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261106223244_shops_helpr_delivery_quote.sql"), "utf8");

/** The newest CREATE of a function in one older migration, verbatim (any dollar tag). */
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
const [OWNER, OFF_OWNER, SHOP, OFF_SHOP, BUYER] = [11, 12, 91, 92, 1].map(id);
// The shop's point (Lafayette) and drop-offs.
const [PLAT, PLNG] = [30.22412, -92.01987];
const NEAR = [30.2400, -92.0600];
const FAR = [29.9511, -90.0715]; // New Orleans: well past 50 miles
const TEXAS = [29.7604, -95.3698];

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid UNIQUE, helpr_delivery boolean NOT NULL DEFAULT false);
CREATE TABLE public.shop_pickup_addresses (shop_id uuid PRIMARY KEY, owner_id uuid NOT NULL, line1 text NOT NULL,
  line2 text, city text NOT NULL, postal_code text NOT NULL, lat numeric, lng numeric, point_at timestamptz);
CREATE TABLE public.declutter_route_miles (o_lat numeric NOT NULL, o_lng numeric NOT NULL, d_lat numeric NOT NULL,
  d_lng numeric NOT NULL, miles integer NOT NULL, minutes integer, source text NOT NULL DEFAULT 'apple',
  routed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (o_lat, o_lng, d_lat, d_lng));
CREATE TABLE public.declutter_route_health (id boolean PRIMARY KEY DEFAULT true, miss_until timestamptz,
  misses integer NOT NULL DEFAULT 0, last_miss_at timestamptz);
${cutFn("20261017055505_declutter_helpr_delivery.sql", "helpr_task_distance_m")}
${cutFn("20261104105545_declutter_road_miles_routed.sql", "declutter_road_miles")}
${cutFn("20261101175628_declutter_delivery_price_6_plus_150.sql", "declutter_delivery_price_cents")}
`;

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log(`PASS ${msg}`);
  else { failures++; console.log(`FAIL ${msg}`); }
};
async function refuses(db, sql, params, code) {
  try {
    await db.query(sql, params);
    return false;
  } catch (e) {
    return String(e.message).includes(code);
  }
}

const db = new PGlite();
await db.exec(SCHEMA);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
}
await db.exec(`
  INSERT INTO public.shops VALUES ('${SHOP}', '${OWNER}', true), ('${OFF_SHOP}', '${OFF_OWNER}', false);
  INSERT INTO public.shop_pickup_addresses VALUES
    ('${SHOP}', '${OWNER}', '705 W University Ave', NULL, 'Lafayette', '70506', ${PLAT}, ${PLNG}, now()),
    ('${OFF_SHOP}', '${OFF_OWNER}', '1 Main St', NULL, 'Lafayette', '70501', ${PLAT}, ${PLNG}, now());
`);

const quote = async (shop, [lat, lng]) => {
  try {
    return (await db.query("SELECT public.shop_helpr_delivery_quote($1, $2, $3) AS q", [shop, lat, lng])).rows[0].q;
  } catch (e) {
    return { error: String(e.message) };
  }
};
const estimate = async ([lat, lng]) =>
  (await db.query("SELECT greatest(1, public.declutter_road_miles($1, $2, $3, $4)) AS m", [PLAT, PLNG, lat, lng])).rows[0].m;

// 1. Declutter's price for the estimated road miles, and the pair named back for routing.
const est = await estimate(NEAR);
const q1 = await quote(SHOP, NEAR);
ok(q1?.delivery_miles === est, `quote miles = declutter_road_miles estimate (${q1?.delivery_miles} vs ${est})`);
ok(q1?.delivery_cents === 600 + 150 * est, `quote price = $6 + $1.50/mi (${q1?.delivery_cents})`);
ok(q1?.route && Number(q1.route.o_lat) === PLAT && Number(q1.route.o_lng) === PLNG
   && Number(q1.route.d_lat) === NEAR[0] && Number(q1.route.d_lng) === NEAR[1], "an unrouted pair is named for routing (exact key)");

// 2. A routed row under that exact key prices it; no route asked again.
await db.query("INSERT INTO public.declutter_route_miles (o_lat, o_lng, d_lat, d_lng, miles) VALUES ($1, $2, $3, $4, $5)",
  [q1?.route?.o_lat ?? 0, q1?.route?.o_lng ?? 0, q1?.route?.d_lat ?? 0, q1?.route?.d_lng ?? 0, est + 2]);
const q2 = await quote(SHOP, NEAR);
ok(q2?.delivery_miles === est + 2, `routed miles price the quote (${q2?.delivery_miles})`);
ok(q2?.delivery_cents === 600 + 150 * (est + 2), `routed price (${q2?.delivery_cents})`);
ok(q2 && q2.route === null, "a routed pair is not asked again");

// 3. A routing pause asks none; the estimate answers.
const other = [30.2000, -92.0300];
await db.exec("INSERT INTO public.declutter_route_health (id, miss_until) VALUES (true, now() + interval '10 minutes')");
const q3 = await quote(SHOP, other);
ok(q3?.delivery_miles === (await estimate(other)) && q3.route === null, "while routing is paused the estimate answers, no route asked");
await db.exec("UPDATE public.declutter_route_health SET miss_until = now() - interval '1 minute'");
const q3b = await quote(SHOP, other);
ok(q3b?.route !== null && q3b?.route !== undefined, "after the pause the pair is named again");

// 4. The order's refusals, in its words.
ok((await quote(OFF_SHOP, NEAR))?.error?.includes("shop_no_helpr_delivery"), "a shop without Helpr delivery refuses");
await db.exec(`UPDATE public.shop_pickup_addresses SET lat = NULL, lng = NULL, point_at = NULL WHERE shop_id = '${OFF_SHOP}';
               UPDATE public.shops SET helpr_delivery = true WHERE id = '${OFF_SHOP}'`);
ok((await quote(OFF_SHOP, NEAR))?.error?.includes("shop_no_helpr_delivery"), "a shop with no pickup point refuses");
ok((await quote(SHOP, FAR))?.error?.includes("delivery_too_far"), "past 50 road miles refuses");
ok((await quote(SHOP, TEXAS))?.error?.includes("delivery_outside_louisiana"), "outside Louisiana refuses");
ok((await quote(id(999), NEAR))?.error?.includes("shop_no_helpr_delivery"), "an unknown shop refuses");

// 5. Service role only.
for (const role of ["authenticated", "anon"]) {
  await db.exec(`SET ROLE ${role}`);
  ok(await refuses(db, "SELECT public.shop_helpr_delivery_quote($1, $2, $3)", [SHOP, NEAR[0], NEAR[1]], "permission denied"),
    `${role} cannot call shop_helpr_delivery_quote`);
  await db.exec("RESET ROLE");
}
await db.exec("SET ROLE service_role");
ok(!(await refuses(db, "SELECT public.shop_helpr_delivery_quote($1, $2, $3)", [SHOP, NEAR[0], NEAR[1]], "permission denied")),
  "service_role can call it");
await db.exec("RESET ROLE");

console.log(failures === 0 ? "ALL PASS" : `${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
