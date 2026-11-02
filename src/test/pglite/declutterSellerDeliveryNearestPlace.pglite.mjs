#!/usr/bin/env node
/**
 * PGlite proof for 20261102030012_declutter_seller_delivery_nearest_place (Q2491, lead 2026-11-01): a seller with saved
 * pickup places has the seller-delivery range measured from their place NEAREST the drop-off; a seller with no places
 * is measured from the items' own points as before.
 *
 *   node src/test/pglite/declutterSellerDeliveryNearestPlace.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSellerDeliveryNearestPlace.pglite.mjs # RED: still the item address
 *   MUTANT=<name> node src/test/pglite/declutterSellerDeliveryNearestPlace.pglite.mjs      # a planted defect: must FAIL
 *
 * The function before this migration is its newest earlier CREATE (read from the migrations), and declutter_road_miles
 * and helpr_task_distance_m are the real ones. Stubbed, said so: the rules (free $0, $1-$50), the bundle targets ($10
 * a line) and the rate helper (the seller's rate). Supabase's default anon/authenticated EXECUTE grant on new functions
 * is emulated (ALTER DEFAULT PRIVILEGES), and the end state of the grants is checked.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261102030012_declutter_seller_delivery_nearest_place.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The farthest place decides instead of the nearest.
  farthestPlace: ["SELECT false, min(public.declutter_road_miles(round(pl.lat, 2)", "SELECT false, max(public.declutter_road_miles(round(pl.lat, 2)"],
  // Places are never consulted (the bug).
  ignorePlaces: ["v_has_places := EXISTS (SELECT 1 FROM public.declutter_porch_places pl WHERE pl.seller_id = p_seller);", "v_has_places := false;"],
  // Another seller's places count.
  anySeller: ["      FROM public.declutter_porch_places pl\n     WHERE pl.seller_id = p_seller;", "      FROM public.declutter_porch_places pl;"],
  // The exact point, not the rounded one (lets a buyer trilaterate a home).
  exactPoint: ["min(public.declutter_road_miles(round(pl.lat, 2), round(pl.lng, 2), d.lat, d.lng))", "min(public.declutter_road_miles(pl.lat, pl.lng, d.lat, d.lng))"],
};
const skip = process.env.NEW_MIGRATION === "skip";

function definitionBefore(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = rest.slice(0, end + tag[1].length) + ";";
    }
  }
  if (!last) throw new Error(`no definition of ${name} before ${before}`);
  return last;
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `88888888-0000-0000-0000-${String(n).padStart(12, "0")}`;
const BUYER = U(1), S_PLACES = U(2), S_FAR = U(3), S_NONE = U(4), S_OTHER = U(5);
// Lafayette (the buyer and one place) and Baton Rouge (~50 road miles away).
const LAF = [30.22, -92.02], BR = [30.45, -91.15];

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.declutter_seller_delivery (seller_id uuid PRIMARY KEY, enabled boolean NOT NULL, rate_cents integer NOT NULL,
  free_over_cents integer, radius_miles integer NOT NULL);
CREATE TABLE public.declutter_delivery_dropoffs (buyer_id uuid, seller_id uuid, address text, area_label text, lat numeric, lng numeric,
  geocoded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (buyer_id, seller_id));
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL);
CREATE TABLE public.declutter_item_no_seller_delivery (item_id uuid PRIMARY KEY);
CREATE TABLE public.declutter_item_private (item_id uuid PRIMARY KEY, pickup_lat numeric, pickup_lng numeric);
CREATE TABLE public.declutter_porch_places (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid NOT NULL,
  lat numeric(9,6) NOT NULL, lng numeric(9,6) NOT NULL);
CREATE FUNCTION public.declutter_seller_delivery_rules() RETURNS jsonb LANGUAGE sql AS $$
  SELECT '{"free_rate_cents":0,"rate_min_cents":100,"rate_max_cents":5000}'::jsonb $$;
CREATE FUNCTION public.declutter_bundle_targets(p_seller uuid, p_lines uuid[]) RETURNS TABLE (target_cents integer) LANGUAGE sql AS $$
  SELECT 1000 FROM unnest(p_lines) $$;
CREATE FUNCTION public.declutter_seller_delivery_rate_cents(r integer, f integer, i integer) RETURNS integer LANGUAGE sql AS $$ SELECT r $$;
`);
await db.exec(definitionBefore("helpr_task_distance_m", THIS));
await db.exec(definitionBefore("declutter_road_miles", THIS));
await db.exec(definitionBefore("declutter_seller_delivery_check", THIS));
await db.exec(`REVOKE ALL ON FUNCTION public.declutter_seller_delivery_check(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;`);

if (!skip) {
  let mig = readFileSync(MIG_DIR + THIS, "utf8");
  if (MUTANT) {
    const m = MUTANTS[MUTANT];
    if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
    mig = mig.replace(m[0], m[1]);
  }
  for (let k = 1; k <= 3; k++) {
    try { await db.exec(mig); check(true, `the migration applies (run ${k})`); } catch (e) { check(false, `the migration applies (run ${k}): ${e.message}`); }
  }
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
for (const s of [S_PLACES, S_FAR, S_NONE, S_OTHER]) {
  await q(`INSERT INTO public.declutter_seller_delivery VALUES ($1, true, 500, NULL, 10)`, [s]);
  await q(`INSERT INTO public.declutter_delivery_dropoffs (buyer_id, seller_id, address, area_label, lat, lng) VALUES ($1, $2, '1 Main St', 'Lafayette', 30.23, -92.03)`, [BUYER, s]);
}
// One cart line from a seller; the item's own point (or none).
const line = async (pt) => {
  const item = (await q(`SELECT gen_random_uuid() AS id`))[0].id;
  await q(`INSERT INTO public.declutter_item_private VALUES ($1, $2, $3)`, [item, pt?.[0] ?? null, pt?.[1] ?? null]);
  return (await q(`INSERT INTO public.declutter_cart_items (item_id) VALUES ($1) RETURNING id`, [item]))[0].id;
};
const place = (s, pt) => q(`INSERT INTO public.declutter_porch_places (seller_id, lat, lng) VALUES ($1, $2, $3)`, [s, pt[0], pt[1]]);
const verdict = async (s, lines) => (await q(`SELECT reason FROM public.declutter_seller_delivery_check($1, $2, $3::uuid[])`, [BUYER, s, lines]))[0]?.reason ?? "ok";

// S_PLACES: the listing's address is in Baton Rouge; places in Baton Rouge AND Lafayette.
await place(S_PLACES, BR); await place(S_PLACES, LAF);
const v1 = await verdict(S_PLACES, [await line(BR)]);
check(v1 === "ok", `[fix] item address 50 mi away, a saved place near the buyer: delivers (${v1})`);
// S_PLACES again: an item with no point of its own does not block a seller who has places.
const v2 = await verdict(S_PLACES, [await line(null)]);
check(v2 === "ok", `[fix] seller with places, item with no own point: delivers (${v2})`);
// S_FAR: the listing's address is near the buyer, but every saved place is in Baton Rouge.
await place(S_FAR, BR);
const v3 = await verdict(S_FAR, [await line(LAF)]);
check(v3 === "out_of_range", `[fix] item near, every saved place far: out of range (${v3})`);
// S_NONE: no saved places: the items' own points, as before.
const v4 = await verdict(S_NONE, [await line(LAF)]);
check(v4 === "ok", `no places, item near the buyer: delivers (${v4})`);
const v5 = await verdict(S_NONE, [await line(LAF), await line(BR)]);
check(v5 === "out_of_range", `no places, one item far: out of range, the farthest decides (${v5})`);
const v6 = await verdict(S_NONE, [await line(null)]);
check(v6 === "item_not_deliverable", `no places, an item with no point: not deliverable (${v6})`);
// S_OTHER has no places of its own; S_PLACES' Lafayette place is not theirs.
const v7 = await verdict(S_OTHER, [await line(BR)]);
check(v7 === "out_of_range", `[fix] another seller's places never count (${v7})`);
// The rounded point (~1 km), as the item points were: 30.224,-92.024 rounds to 30.22,-92.02.
await q(`UPDATE public.declutter_seller_delivery SET radius_miles = 1 WHERE seller_id = $1`, [S_OTHER]);
await place(S_OTHER, [30.224, -92.024]);
const miles = (await q(`SELECT public.declutter_road_miles(30.22, -92.02, 30.23, -92.03) AS r, public.declutter_road_miles(30.224, -92.024, 30.23, -92.03) AS e`))[0];
const v8 = await verdict(S_OTHER, [await line(BR)]);
check(miles.r === 2 && miles.e === 1 && v8 === "out_of_range",
  `[fix] measured from the place's ROUNDED point (${miles.r} mi), not the exact one (${miles.e} mi): out of range at 1 mi (${v8})`);

if (!skip) {
  const acl = (await q(`SELECT has_function_privilege('anon', 'public.declutter_seller_delivery_check(uuid, uuid, uuid[])', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.declutter_seller_delivery_check(uuid, uuid, uuid[])', 'EXECUTE') u,
    has_function_privilege('service_role', 'public.declutter_seller_delivery_check(uuid, uuid, uuid[])', 'EXECUTE') s`))[0];
  check(!acl.a && !acl.u && acl.s, `grants: anon ${acl.a}, authenticated ${acl.u}, service_role ${acl.s}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
