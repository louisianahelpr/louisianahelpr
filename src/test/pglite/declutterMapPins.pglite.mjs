#!/usr/bin/env node
/**
 * PGlite proof for 20261028151144_declutter_map_pins (owner 2026-10-28: Declutter map pins are a rough area,
 * moved within about half a mile; the seller's house is never shown).
 *
 *   npx tsx src/test/pglite/declutterMapPins.pglite.mjs [--replay] [--plant-exact | --plant-pickup-anchor]
 *
 * The switch, role and seed helpers are loaded from their EFFECTIVE definitions before this migration; the
 * migration is applied (3x with --replay) and every check must PASS. Two planted defects show the PRIVACY checks can
 * fail: --plant-exact returns the exact pickup point as the pin; --plant-pickup-anchor is the first draft's design
 * (the offset anchored on the exact pickup point, so the pin moves with the house: lh-authz-rls review findings 1-2).
 *
 * PRIVACY:
 *   P1 no pin is the exact pickup point                                                  (fails under --plant-exact)
 *   P2 every pin is within 300 m of the item's PUBLIC area point                          (fails under --plant-exact)
 *   P3 moving the exact pickup point inside its area cell (another geocode of the same address) does not move the
 *      pin: the pin carries nothing about the house beyond the public cell     (fails under both plants)
 *   P4 house to pin: never over 0.65 mi (the owner's "within about half a mile"); the median is printed
 * Kept:
 *   K1 an ordinary member gets pins for exactly Browse's items: live + reserved; not a draft, a hidden seller's,
 *      a test listing, or their own
 *   K2 stable: a second read gives the same pins; a replay of the migration keeps the salt, so the same pins
 *   K3 two listings from one seller in one cell share one pin
 *   K4 the offsets point every way (all four quadrants among the 200)
 *   K5 the switch off for this member (testers only): the RPC refuses with feature_disabled (42501)
 *   K6 a signed-out caller (anon) cannot run it; a member cannot read the salt table
 *   K7 a test account sees a test listing's pin (the journeys keep working)
 *   K8 no salt row: the RPC refuses instead of falling back to an unsalted offset
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const REPLAY = process.argv.includes("--replay");
const PLANT = process.argv.includes("--plant-exact");
const PLANT_ANCHOR = process.argv.includes("--plant-pickup-anchor");

const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261028151144_declutter_map_pins.sql";
let MIGRATION = readFileSync(DIR + THIS, "utf8");
if (PLANT) {
  const from = /SELECT m\.id,\s*round\([\s\S]*?FROM moved m;/;
  if (!from.test(MIGRATION)) throw new Error("--plant-exact: the pin SELECT was not found");
  MIGRATION = MIGRATION.replace(from, "SELECT m.id, (SELECT p.pickup_lat FROM public.declutter_item_private p WHERE p.item_id = m.id), (SELECT p.pickup_lng FROM public.declutter_item_private p WHERE p.item_id = m.id) FROM moved m;");
}
if (PLANT_ANCHOR) {
  const from = "SELECT i.id, i.seller_id, i.area_lat, i.area_lng\n        FROM public.declutter_items i\n";
  if (!MIGRATION.includes(from)) throw new Error("--plant-pickup-anchor: the visible CTE was not found");
  MIGRATION = MIGRATION.replace(from, "SELECT i.id, i.seller_id, p.pickup_lat AS area_lat, p.pickup_lng AS area_lng\n        FROM public.declutter_items i JOIN public.declutter_item_private p ON p.item_id = i.id\n");
}

const DEFS = effectiveDefs(DIR, { before: THIS });
function fnStmt(name) {
  const d = DEFS.get(name);
  if (!d) throw new Error(`no migration before ${THIS} defines ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  return `${d.stmt.slice(0, end + open[1].length)};`;
}

let failures = 0;
let privacyFailures = 0;
const check = (name, ok, detail = "", privacy = false) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) {
    failures++;
    if (privacy) privacyFailures++;
  }
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MEMBER = U(1), SELLER = U(2), SELLER2 = U(3), HIDDEN_SELLER = U(4), TEST_SELLER = U(5), TESTER = U(6);
const A = U(101), B = U(102), DRAFT = U(103), HIDDEN = U(104), SEED = U(105), OWN = U(106), RESERVED = U(107);
// Exact pickup points (Baton Rouge); A and B are one seller's two listings from one address.
const HOUSE = { lat: 30.451234, lng: -91.187654 };
const HOUSE2 = { lat: 30.412345, lng: -91.123456 };

const item = (id, seller, status, p, extra = {}) =>
  `('${id}', '${seller}', '${status}', ${extra.hidden ? "true" : "false"}, ${extra.seed ? "true" : "false"}, now(), ${p.lat}, ${p.lng})`;
const many = Array.from({ length: 200 }, (_, k) => ({
  id: U(1000 + k),
  seller: U(5000 + k),
  lat: 29.9 + (k % 20) * 0.031 + k * 0.000137,
  lng: -91.9 + Math.floor(k / 20) * 0.047 + k * 0.000211,
}));

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
CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text NOT NULL, description text);
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid NOT NULL, status text NOT NULL,
  seller_hidden boolean NOT NULL DEFAULT false, is_seed boolean NOT NULL DEFAULT false, live_at timestamptz,
  area_lat numeric(5,2), area_lng numeric(6,2));
CREATE TABLE public.declutter_item_private (item_id uuid PRIMARY KEY REFERENCES public.declutter_items(id), seller_id uuid,
  pickup_lat numeric(9,6) NOT NULL, pickup_lng numeric(9,6) NOT NULL);
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
${fnStmt("is_server_context")}
${fnStmt("has_role")}
${fnStmt("feature_enabled_for_user")}
${fnStmt("feature_enabled_for")}
${fnStmt("require_feature")}
${fnStmt("seed_jobs_hidden_publicly")}
${fnStmt("seed_hidden_in_discovery")}

INSERT INTO public.platform_settings (feature_flags) VALUES ('{"seed_jobs_hidden_publicly": true}');
INSERT INTO public.feature_switches VALUES ('declutter', 'everyone', 'proof');
INSERT INTO public.profiles (user_id, is_seed) VALUES ('${MEMBER}', false), ('${TEST_SELLER}', true), ('${TESTER}', true);
INSERT INTO public.test_accounts VALUES ('${TEST_SELLER}'), ('${TESTER}');
CREATE TEMP TABLE fixture (id uuid, seller uuid, status text, hidden boolean, seed boolean, live_at timestamptz, lat numeric, lng numeric);
INSERT INTO fixture VALUES
  ${item(A, SELLER, "live", HOUSE)},
  ${item(B, SELLER, "live", HOUSE)},
  ${item(DRAFT, SELLER, "draft", HOUSE)},
  ${item(HIDDEN, HIDDEN_SELLER, "live", HOUSE2, { hidden: true })},
  ${item(SEED, TEST_SELLER, "live", HOUSE2, { seed: true })},
  ${item(OWN, MEMBER, "live", HOUSE2)},
  ${item(RESERVED, SELLER2, "reserved", HOUSE2)},
  ${many.map((m) => item(m.id, m.seller, "live", m)).join(",\n  ")};
INSERT INTO public.declutter_items (id, seller_id, status, seller_hidden, is_seed, live_at, area_lat, area_lng)
  SELECT id, seller, status, hidden, seed, live_at, round(lat, 2), round(lng, 2) FROM fixture;
INSERT INTO public.declutter_item_private (item_id, seller_id, pickup_lat, pickup_lng) SELECT id, seller, lat, lng FROM fixture;
`;

const db = new PGlite();
await db.exec(SCHEMA);
const exact = new Map((await db.query("SELECT id, lat::float8 AS lat, lng::float8 AS lng FROM fixture")).rows.map((r) => [r.id, r]));

async function as(uid, sql, role = "authenticated") {
  await db.exec(`SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  try {
    return { rows: (await db.query(sql)).rows, error: null };
  } catch (e) {
    return { rows: [], error: e };
  } finally {
    await db.exec("RESET ROLE;");
  }
}
const pins = async (uid) => {
  const r = await as(uid, "SELECT item_id, pin_lat::float8 AS lat, pin_lng::float8 AS lng FROM public.declutter_map_pins()");
  if (r.error) throw r.error;
  return new Map(r.rows.map((p) => [p.item_id, p]));
};
const MI = 1609.344;
function metres(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

await db.exec(MIGRATION);
const first = await pins(MEMBER);
if (REPLAY) {
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
}
console.log(`${PLANT ? "PLANTED (pins = exact pickup point)" : `AFTER (applied ${REPLAY ? 3 : 1}x)`}`);
const got = await pins(MEMBER);

const ids = [...got.keys()];
const expectIds = [A, B, RESERVED, ...many.map((m) => m.id)];
check("K1 an ordinary member gets pins for exactly Browse's items (live + reserved; no draft, hidden seller, test listing or own)",
  ids.length === expectIds.length && expectIds.every((id) => got.has(id)), `got ${ids.length}, want ${expectIds.length}; draft ${got.has(DRAFT)} hidden ${got.has(HIDDEN)} seed ${got.has(SEED)} own ${got.has(OWN)}`);

const areaOf = (id) => ({ lat: Math.round(exact.get(id).lat * 100) / 100, lng: Math.round(exact.get(id).lng * 100) / 100 });
const onTheHouse = ids.filter((id) => metres(exact.get(id), got.get(id)) < 1);
check("P1 no pin is the exact pickup point", onTheHouse.length === 0, `${onTheHouse.length} pins sit on the pickup point`, true);
const fromArea = Math.max(...ids.map((id) => metres(areaOf(id), got.get(id))));
check("P2 every pin is within 300 m of its public area point", fromArea <= 308, `max ${fromArea.toFixed(0)} m`, true);
const house = ids.map((id) => metres(exact.get(id), got.get(id)) / MI).sort((x, y) => x - y);
console.log(`      house to pin: median ${house[house.length >> 1].toFixed(2)} mi, max ${house[house.length - 1].toFixed(2)} mi (${house.length} pins)`);
check("P4 house to pin never over 0.65 mi", house[house.length - 1] <= 0.65, `max ${house[house.length - 1].toFixed(2)} mi`, true);
// P3: the same addresses geocoded a little differently, each still inside its own 2-decimal cell.
const moveIds = many.slice(0, 40).map((m) => m.id);
await db.exec(`UPDATE public.declutter_item_private SET pickup_lat = pickup_lat + CASE WHEN round(pickup_lat, 2) = round(pickup_lat + 0.0012, 2) THEN 0.0012 ELSE -0.0012 END,
  pickup_lng = pickup_lng + CASE WHEN round(pickup_lng, 2) = round(pickup_lng + 0.0012, 2) THEN 0.0012 ELSE -0.0012 END
  WHERE item_id IN (${moveIds.map((id) => `'${id}'`).join(",")})`);
const moved = await pins(MEMBER);
const shifted = moveIds.filter((id) => moved.get(id).lat !== got.get(id).lat || moved.get(id).lng !== got.get(id).lng);
check("P3 another geocode of the same address (same cell) leaves the pin where it was", shifted.length === 0, `${shifted.length} of ${moveIds.length} pins moved with the house`, true);
await db.exec(`UPDATE public.declutter_item_private p SET pickup_lat = f.lat, pickup_lng = f.lng FROM fixture f WHERE f.id = p.item_id`);

const second = await pins(MEMBER);
const same = (x, y) => x.size === y.size && [...x].every(([id, p]) => y.get(id)?.lat === p.lat && y.get(id)?.lng === p.lng);
check("K2 stable: the same pins on a second read, and after the migration is replayed (the salt is kept)", same(got, second) && same(got, first));
check("K3 one seller's two listings from one cell share one pin", got.get(A).lat === got.get(B).lat && got.get(A).lng === got.get(B).lng);
const quads = new Set(many.map((m) => `${Math.sign(got.get(m.id).lat - areaOf(m.id).lat)}${Math.sign(got.get(m.id).lng - areaOf(m.id).lng)}`));
check("K4 the offsets point every way (all four quadrants)", ["11", "1-1", "-11", "-1-1"].every((q) => quads.has(q)), [...quads].join(" "));

const tester = await pins(TESTER);
check("K7 a test account sees a test listing's pin", tester.has(SEED));

const anon = await as(null, "SELECT * FROM public.declutter_map_pins()", "anon");
check("K6a a signed-out caller cannot run it", /permission denied/i.test(String(anon.error?.message)), String(anon.error?.message));
const salt = await as(MEMBER, "SELECT salt FROM public.declutter_pin_secret");
check("K6b a member cannot read the salt", /permission denied/i.test(String(salt.error?.message)), String(salt.error?.message));

await db.exec("UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter'");
const off = await as(MEMBER, "SELECT * FROM public.declutter_map_pins()");
check("K5 switch on for testers only: an ordinary member is refused with feature_disabled (42501)",
  /feature_disabled/.test(String(off.error?.message)) && off.error?.code === "42501", `${off.error?.code} ${off.error?.message}`);
await db.exec("UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'declutter'");

await db.exec("DELETE FROM public.declutter_pin_secret");
const noSalt = await as(MEMBER, "SELECT * FROM public.declutter_map_pins()");
check("K8 no salt row: the RPC refuses (never an unsalted offset)", /declutter_pin_secret_missing/.test(String(noSalt.error?.message)), String(noSalt.error?.message));

if (PLANT || PLANT_ANCHOR) {
  // Exact point: P1, P2 and P3 fail (P4 can pass: the house is 0 mi from itself). Pickup anchor: P3 fails at least.
  const want = PLANT ? 3 : 1;
  console.log(`\n${privacyFailures} privacy check(s) failed with the defect planted (want at least ${want})`);
  process.exit(privacyFailures >= want ? 0 : 1);
}
console.log(`\n${failures} failure(s)`);
process.exit(failures ? 1 : 0);
