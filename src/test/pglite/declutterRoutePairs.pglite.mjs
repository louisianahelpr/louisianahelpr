#!/usr/bin/env node
/**
 * Q1930: declutter_route_pairs (20261104113516) returns the EXACT (origin, drop-off) pairs a buyer's delivery quote
 * from one seller passes to declutter_road_miles, so the routed miles declutter-checkout stores under that key are the
 * ones the quote reads. Runs NEW_FILE VERBATIM (3x) over the REAL helpr_task_distance_m, declutter_road_miles
 * (20261104105545, routed) and the quote's own measuring expressions (20261102030012: round(pl.lat, 2) / round(
 * p.pickup_lat, 2) to the unrounded d.lat/d.lng, read from the newest file that holds them).
 *
 *   node src/test/pglite/declutterRoutePairs.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterRoutePairs.pglite.mjs   # RED: no pairs function
 *   MIGRATION_PATH=<planted copy> node ...                                    # RED on a planted defect (e.g. round(.., 3))
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_route_pairs.sql"));
const ROUTED_FILE = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_road_miles_routed.sql"));
if (!NEW_FILE || !ROUTED_FILE) throw new Error("the Q1930 migrations are missing");
const RED = process.env.NEW_MIGRATION === "skip";

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

// The quote's two measuring expressions, read from the newest migration that measures with declutter_road_miles.
const QUOTE_PLACES = "public.declutter_road_miles(round(pl.lat, 2), round(pl.lng, 2), d.lat, d.lng)";
const QUOTE_LINES = "public.declutter_road_miles(round(p.pickup_lat, 2), round(p.pickup_lng, 2), d.lat, d.lng)";
const quoteFile = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql") && f < NEW_FILE && /declutter_delivery|declutter_seller_delivery/.test(f))
  .sort().reverse().find((f) => readFileSync(MIG_DIR + f, "utf8").includes("declutter_road_miles("));

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const quoteSql = readFileSync(MIG_DIR + quoteFile, "utf8");
check(`the quote (${quoteFile}) still measures places and lines with the expressions the pairs mirror`,
  quoteSql.includes(QUOTE_PLACES) && quoteSql.includes(QUOTE_LINES));

const B = "00000000-0000-0000-0000-0000000000b1", S = "00000000-0000-0000-0000-0000000000a1", S2 = "00000000-0000-0000-0000-0000000000a2";
const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.declutter_delivery_dropoffs (buyer_id uuid, seller_id uuid, lat numeric NOT NULL, lng numeric NOT NULL, geocoded_at timestamptz DEFAULT now());
CREATE TABLE public.declutter_porch_places (seller_id uuid, lat numeric(9,6) NOT NULL, lng numeric(9,6) NOT NULL);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid, status text);
CREATE TABLE public.declutter_item_private (item_id uuid PRIMARY KEY, pickup_lat numeric(9,6) NOT NULL, pickup_lng numeric(9,6) NOT NULL);`);
await db.exec(definitionBefore("helpr_task_distance_m", ROUTED_FILE));
await db.exec(definitionBefore("declutter_road_miles", ROUTED_FILE));
await db.exec(readFileSync(MIG_DIR + ROUTED_FILE, "utf8"));
// Seller S: no places; one in-cart line (Lafayette, 6 dp) and one PAID line (not in the cart any more).
// Seller S2: two porch places. Buyer's geocoded drop-offs (Baton Rouge), unrounded as the geocoder stored them.
await db.exec(`
INSERT INTO public.declutter_delivery_dropoffs (buyer_id, seller_id, lat, lng) VALUES ('${B}', '${S}', 30.451468, -91.187147), ('${B}', '${S2}', 30.451468, -91.187147);
INSERT INTO public.declutter_item_private VALUES ('00000000-0000-0000-0000-0000000000c1', 30.224123, -92.019876), ('00000000-0000-0000-0000-0000000000c2', 30.5, -92.5);
INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, status) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '${B}', '${S}', 'in_cart'), ('00000000-0000-0000-0000-0000000000c2', '${B}', '${S}', 'paid');
INSERT INTO public.declutter_porch_places VALUES ('${S2}', 30.111, -91.999), ('${S2}', 30.404, -91.004);`);

const pairs = async (seller) => {
  try {
    return (await db.query(`SELECT * FROM public.declutter_route_pairs($1, $2) ORDER BY o_lat`, [B, seller])).rows;
  } catch (e) {
    return { error: String(e.message) };
  }
};
if (RED) console.log("NEW_MIGRATION=skip: no pairs function (expect FAILs)");
else {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check("the migration applies 3x (replay-safe)", true);
}

let r = await pairs(S);
check("no places: only the in-cart line's point, rounded to 2 dp, to the unrounded drop-off",
  Array.isArray(r) && r.length === 1 && Number(r[0].o_lat) === 30.22 && Number(r[0].o_lng) === -92.02 && Number(r[0].d_lat) === 30.451468, JSON.stringify(r));
const r2 = await pairs(S2);
check("a seller with places: every place (rounded), never the lines", Array.isArray(r2) && r2.length === 2 && Number(r2[0].o_lat) === 30.11 && Number(r2[1].o_lng) === -91, JSON.stringify(r2));

// What the edge does: PostgREST hands numerics to the function as JSON numbers; it upserts them back unchanged.
const asJson = (rows) => JSON.parse(JSON.stringify((Array.isArray(rows) ? rows : []).map((p) => ({ o_lat: Number(p.o_lat), o_lng: Number(p.o_lng), d_lat: Number(p.d_lat), d_lng: Number(p.d_lng) }))));
const store = async (rows, miles) => {
  for (const p of asJson(rows)) {
    await db.query(`INSERT INTO public.declutter_route_miles (o_lat, o_lng, d_lat, d_lng, miles, minutes) VALUES ($1, $2, $3, $4, $5, 70)
      ON CONFLICT (o_lat, o_lng, d_lat, d_lng) DO UPDATE SET miles = excluded.miles, routed_at = now()`,
      [String(p.o_lat), String(p.o_lng), String(p.d_lat), String(p.d_lng), miles]);
  }
};
const quoteLines = async () => (await db.query(`SELECT max(${QUOTE_LINES}) AS m FROM public.declutter_cart_items c
  LEFT JOIN public.declutter_item_private p ON p.item_id = c.item_id
  JOIN public.declutter_delivery_dropoffs d ON d.buyer_id = c.buyer_id AND d.seller_id = c.seller_id
  WHERE c.buyer_id = '${B}' AND c.seller_id = '${S}' AND c.status = 'in_cart'`)).rows[0].m;
const quotePlaces = async () => (await db.query(`SELECT min(${QUOTE_PLACES}) AS m FROM public.declutter_porch_places pl
  JOIN public.declutter_delivery_dropoffs d ON d.buyer_id = '${B}' AND d.seller_id = pl.seller_id WHERE pl.seller_id = '${S2}'`)).rows[0].m;
const estLines = await quoteLines(), estPlaces = await quotePlaces();
await store(r, 61);
await store(r2, 40);
check("the quote's own line expression now reads the stored routed miles (61), not the estimate", (await quoteLines()) === 61, `got ${await quoteLines()}, estimate ${estLines}`);
check("the quote's own place expression reads the stored routed miles (40, the nearer place)", (await quotePlaces()) === 40, `got ${await quotePlaces()}, estimate ${estPlaces}`);
check("a pair routed within 180 days is not returned again (no repeat Apple call)", Array.isArray(await pairs(S)) && (await pairs(S)).length === 0);
await db.exec(`UPDATE public.declutter_route_miles SET routed_at = now() - interval '200 days' WHERE o_lat = 30.22`);
check("a stale routed pair (200 days) is returned again for re-routing", (await pairs(S)).length === 1);
// Failure memory (lead review 11-04): after an Apple miss no pairs are handed out until miss_until passes.
const outage = async (m) => { try { await db.query(`SELECT public.declutter_route_outage($1)`, [m]); return true; } catch { return false; } };
check("declutter_route_outage records a miss", await outage(10));
check("while routing is paused, no pairs are handed out (no quote asks Apple again)", Array.isArray(await pairs(S)) && (await pairs(S)).length === 0, JSON.stringify(await pairs(S)));
await db.exec(`UPDATE public.declutter_route_health SET miss_until = now() - interval '1 second'`).catch(() => {});
check("once the pause has passed, pairs are handed out again", (await pairs(S)).length === 1);
const h = await db.query(`SELECT misses FROM public.declutter_route_health`).catch(() => ({ rows: [] }));
await outage(10000);
const capped = await db.query(`SELECT miss_until <= now() + interval '60 minutes' AS ok, misses FROM public.declutter_route_health`).catch(() => ({ rows: [{}] }));
check("a pause is at most an hour and misses are counted", capped.rows[0]?.ok === true && capped.rows[0]?.misses === (h.rows[0]?.misses ?? 0) + 1, JSON.stringify(capped.rows));
// The shown price is never overwritten by an OLDER quote (two quotes answering out of order).
await db.query(`INSERT INTO auth.users (id) VALUES ($1), ($2) ON CONFLICT DO NOTHING`, [B, S]);
const rec = async (c, at) => { try { await db.query(`SELECT public.declutter_record_quote_shown($1, $2, $3, $4)`, [B, S, c, at]); return true; } catch { return false; } };
const shownNow = async () => (await db.query(`SELECT delivery_cents FROM public.declutter_delivery_quotes_shown WHERE buyer_id = $1 AND seller_id = $2`, [B, S]).catch(() => ({ rows: [] }))).rows[0]?.delivery_cents;
check("a shown price is recorded", (await rec(1800, "2026-11-04T12:00:00Z")) && (await shownNow()) === 1800, String(await shownNow()));
await rec(2400, "2026-11-04T12:00:05Z");
check("a newer quote's price replaces it", (await shownNow()) === 2400, String(await shownNow()));
await rec(1800, "2026-11-04T12:00:02Z");
check("an older quote answering late never overwrites the newer price", (await shownNow()) === 2400, String(await shownNow()));
if (!RED) {
  const acl = (await db.query(`SELECT has_function_privilege('authenticated', 'public.declutter_route_pairs(uuid,uuid)', 'EXECUTE') a,
    has_function_privilege('anon', 'public.declutter_route_pairs(uuid,uuid)', 'EXECUTE') b,
    has_function_privilege('service_role', 'public.declutter_route_pairs(uuid,uuid)', 'EXECUTE') s,
    has_function_privilege('authenticated', 'public.declutter_route_outage(integer)', 'EXECUTE') oa,
    has_function_privilege('anon', 'public.declutter_route_outage(integer)', 'EXECUTE') ob,
    has_table_privilege('authenticated', 'public.declutter_route_health', 'SELECT') ha,
    has_table_privilege('authenticated', 'public.declutter_delivery_quotes_shown', 'SELECT') qa,
    has_table_privilege('anon', 'public.declutter_delivery_quotes_shown', 'SELECT') qb,
    has_table_privilege('service_role', 'public.declutter_delivery_quotes_shown', 'INSERT') qs`)).rows[0];
  check("members and anon cannot execute it (it reads private pickup points); service_role can", !acl.a && !acl.b && acl.s, JSON.stringify(acl));
  check("members and anon cannot pause routing or read its health", !acl.oa && !acl.ob && !acl.ha, JSON.stringify(acl));
  check("members and anon cannot read the prices shown to buyers; service_role writes them", !acl.qa && !acl.qb && acl.qs, JSON.stringify(acl));
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
