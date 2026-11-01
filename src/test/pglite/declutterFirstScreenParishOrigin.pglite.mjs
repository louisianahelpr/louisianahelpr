#!/usr/bin/env node
/**
 * PGlite proof for 20261101092004 (B82): with no position on file, declutter_first_screen sorts from the same parish
 * point the browser measures from (the ZIP's parish, else the profile's parish; src/lib/parishCentroids.ts), and says
 * so in `near`, so Browse can show the capped answer before the full read (previewIsTopOfList).
 *
 *   node src/test/pglite/declutterFirstScreenParishOrigin.pglite.mjs                 # after (3x replay)
 *   MUTANT=<name> node src/test/pglite/declutterFirstScreenParishOrigin.pglite.mjs   # a planted defect: must FAIL
 *   NEW_MIGRATION=skip  (runs 20261031020705's definition instead: the before; must FAIL)
 *
 * World: declutterFirstScreen.pglite.mjs's (prod's policies and grants, 2026-10-30), with profiles.parish.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith(process.env.NEW_MIGRATION === "skip" ? "_declutter_drops_stopped_public.sql" : "_declutter_first_screen_zip_origin.sql"));
if (!THIS) throw new Error("migration not found");

const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The profile's parish ahead of the ZIP's, where the browser asks the ZIP first.
  rungOrder: ["ORDER BY (c.name = trim(regexp_replace(COALESCE(v_zip_parish, ''), '\\s+Parish\\s*$', '', 'i'))) DESC", "ORDER BY (c.name = trim(regexp_replace(COALESCE(v_zip_parish, ''), '\\s+Parish\\s*$', '', 'i'))) ASC"],
  // A centre that is not the browser's.
  point: ["('Lafayette', 30.2241, -92.0198)", "('Lafayette', 30.2240, -92.0198)"],
  // " Parish" kept: "St. Tammany Parish" finds no point.
  suffix: ["trim(regexp_replace(COALESCE(v_parish, ''), '\\s+Parish\\s*$', '', 'i'))", "trim(COALESCE(v_parish, ''))"],
  // The ZIP's parish read dropped from the answer.
  zipParish: ["THEN jsonb_build_object('zip', v_zip, 'parish', v_zip_parish) END", "THEN jsonb_build_object('zip', v_zip, 'parish', NULL) END"],
  // The parish point second-guesses a position on file.
  overrides: ["  IF NOT v_has_position THEN\n", "  IF true THEN\n"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
// The before: only 20261031020705's declutter_first_screen (the rest of that file needs tables this world leaves out).
if (process.env.NEW_MIGRATION === "skip") {
  mig = mig.slice(mig.indexOf("CREATE OR REPLACE FUNCTION public.declutter_first_screen"));
  const end = "GRANT EXECUTE ON FUNCTION public.declutter_first_screen(text[]) TO authenticated, service_role;";
  mig = mig.slice(0, mig.indexOf(end) + end.length);
}
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replaceAll(m[0], () => m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
const I = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ME = U(1), SELLER = U(2), OFF = U(3), NOWHERE = U(4), CROWD = U(5), MANY = U(6), PARISHONLY = U(7), UNKNOWNZIP = U(8), NOWHERE2 = U(9);
// src/lib/parishCentroids.ts (the test file pins the SQL copy to it).
const PT = { Lafayette: { lat: 30.2241, lng: -92.0198 }, "St. Tammany": { lat: 30.4218, lng: -89.9986 }, Caddo: { lat: 32.5776, lng: -93.8773 } };

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO authenticated, anon;
  CREATE TABLE public.switch_off (user_id uuid PRIMARY KEY);
  GRANT SELECT ON public.switch_off TO authenticated;
  CREATE FUNCTION public.feature_enabled_for(k text) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT NOT EXISTS (SELECT 1 FROM public.switch_off WHERE user_id = (SELECT auth.uid())) $$;
  CREATE FUNCTION public.feature_switches_for_me(p_keys text[]) RETURNS jsonb LANGUAGE sql STABLE AS
    $$ SELECT jsonb_build_object('declutter', public.feature_enabled_for('declutter')) $$;
  CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
  CREATE FUNCTION public.declutter_bundle_sellers(p uuid[]) RETURNS uuid[] LANGUAGE plpgsql STABLE AS $$
    BEGIN
      IF NOT public.feature_enabled_for('declutter') THEN RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501'; END IF;
      RETURN p;
    END $$;
  CREATE TABLE public.declutter_items (
    id uuid PRIMARY KEY, seller_id uuid, status text, title text, description text, category text, condition_stars int,
    delivery_size text, price_cents int, current_price_cents int, area_label text, area_lat numeric, area_lng numeric,
    created_at timestamptz DEFAULT now(), live_at timestamptz DEFAULT now(), porch_ok boolean DEFAULT true,
    accepts_offers boolean DEFAULT true, sale_mode text, last_price_drop_on date, drop_pct int, drops_stopped boolean DEFAULT false,
    is_seed boolean DEFAULT false, seller_hidden boolean DEFAULT false, floor_price_cents int
  );
  GRANT SELECT (id, seller_id, status, title, description, category, condition_stars, delivery_size, price_cents,
    current_price_cents, area_label, area_lat, area_lng, created_at, live_at, porch_ok, accepts_offers, sale_mode,
    last_price_drop_on, drop_pct, drops_stopped, is_seed, seller_hidden) ON public.declutter_items TO authenticated;
  ALTER TABLE public.declutter_items ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "declutter items: seller or switched-on members read live" ON public.declutter_items FOR SELECT TO authenticated USING (
    seller_id = (SELECT auth.uid())
    OR (status = ANY (ARRAY['live','reserved']) AND (SELECT public.feature_enabled_for('declutter')) AND NOT seller_hidden
        AND (NOT is_seed OR NOT (SELECT public.seed_hidden_in_discovery())))
  );
  CREATE TABLE public.declutter_item_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, storage_path text, position int);
  GRANT SELECT ON public.declutter_item_photos TO authenticated;
  ALTER TABLE public.declutter_item_photos ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "declutter photos: readable with their item" ON public.declutter_item_photos FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = declutter_item_photos.item_id));
  CREATE TABLE public.declutter_watchlist (user_id uuid, item_id uuid);
  GRANT SELECT ON public.declutter_watchlist TO authenticated;
  ALTER TABLE public.declutter_watchlist ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "declutter watchlist: member reads own" ON public.declutter_watchlist FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, latitude numeric, longitude numeric, zip_code text, parish text);
  GRANT SELECT ON public.profiles TO authenticated;
  ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
  INSERT INTO public.profiles VALUES ('${ME}', NULL, NULL, '70 501-x', 'Orleans'), ('${NOWHERE}', NULL, NULL, NULL, NULL),
    ('${CROWD}', 30.45, -91.15, '70501', 'Lafayette'), ('${PARISHONLY}', NULL, NULL, NULL, 'St. Tammany Parish'),
    ('${UNKNOWNZIP}', NULL, NULL, '99999', 'Caddo'), ('${NOWHERE2}', NULL, NULL, '99999', 'Nowhere');
  CREATE FUNCTION public.get_parish_for_zip(p_zip text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT CASE p_zip WHEN '70501' THEN 'Lafayette' END $$;
  INSERT INTO public.switch_off VALUES ('${OFF}');
  INSERT INTO public.declutter_items (id, seller_id, status, title, floor_price_cents, is_seed, seller_hidden) VALUES
    ('${I(1)}', '${SELLER}', 'live', 'real item', 5000, false, false),
    ('${I(2)}', '${SELLER}', 'live', 'seed item', 5000, true, false),
    ('${I(3)}', '${SELLER}', 'live', 'hidden seller', 5000, false, true),
    ('${I(4)}', '${SELLER}', 'draft', 'a draft', 5000, false, false);
  INSERT INTO public.declutter_item_photos (item_id, storage_path, position) VALUES
    ('${I(1)}', 'real.jpg', 0), ('${I(2)}', 'seed.jpg', 0), ('${I(3)}', 'hidden.jpg', 0);
  INSERT INTO public.declutter_watchlist VALUES ('${ME}', '${I(1)}'), ('${SELLER}', '${I(2)}');
`);

// Runs verbatim, three times: replay-safe.
for (let i = 0; i < 3; i++) await db.exec(mig);

// 30 others spread across the state, the newest farthest from Lafayette, so "newest first" and "nearest first" differ.
await db.exec(`
  INSERT INTO public.declutter_items (id, seller_id, status, title, area_lat, area_lng, live_at)
  SELECT ('33333333-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '${MANY}', 'live', 'many ' || n,
         29.5 + (n % 7) * 0.45, -93.5 + (n % 5) * 0.9, now() + (n || ' minutes')::interval
    FROM generate_series(1, 30) n;
  INSERT INTO public.declutter_item_photos (item_id, storage_path, position)
  SELECT id, title || '.jpg', 0 FROM public.declutter_items WHERE seller_id = '${MANY}';
`);

const call = async (uid) => {
  await db.exec(`SET test.uid = '${uid}'; SET ROLE authenticated;`);
  try {
    return (await db.query("SELECT public.declutter_first_screen(ARRAY['declutter']) AS v")).rows[0].v;
  } finally {
    await db.exec("RESET ROLE;");
  }
};
const rad = (d) => (d * Math.PI) / 180;
const milesFrom = (a) => (i) => {
  const b = { lat: Number(i.area_lat), lng: Number(i.area_lng) };
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(h)));
};
// The browser's own list for this member: the full read (newest first), then nearestFirst's stable sort from `from`.
const browserTop = async (uid, from) => {
  await db.exec(`SET test.uid = '${uid}'; SET ROLE authenticated;`);
  const full = (await db.query(`SELECT id, area_lat, area_lng FROM public.declutter_items WHERE status IN ('live','reserved') AND seller_id IS DISTINCT FROM '${uid}' ORDER BY live_at DESC`)).rows;
  await db.exec("RESET ROLE;");
  const m = milesFrom(from);
  return [...full].sort((x, y) => m(x) - m(y)).slice(0, 24).map((r) => r.id);
};
const ids = (a) => JSON.stringify((a?.items ?? []).map((i) => i.id));

// ZIP only (70501 -> Lafayette; the profile's parish says Orleans, but the ZIP comes first, as in the browser).
const zip = await call(ME);
check(zip.near?.lat === PT.Lafayette.lat && zip.near?.lng === PT.Lafayette.lng, `a ZIP on file: near is the ZIP's parish point (${JSON.stringify(zip.near)})`);
check(zip.more === true && zip.items.length === 24, "still capped at 24, with more");
check(ids(zip) === JSON.stringify(await browserTop(ME, PT.Lafayette)), "the 24 are exactly the top of the browser's list from that point");
check(zip.zip_parish?.zip === "70501" && zip.zip_parish?.parish === "Lafayette", "the ZIP's parish still comes back for the browser's ZIP lookup");

// No ZIP, a parish written "St. Tammany Parish".
const par = await call(PARISHONLY);
check(par.near?.lat === PT["St. Tammany"].lat && par.near?.lng === PT["St. Tammany"].lng, `a parish only: near is its point (${JSON.stringify(par.near)})`);
check(ids(par) === JSON.stringify(await browserTop(PARISHONLY, PT["St. Tammany"])), "and the top of the browser's list from it");
check(par.zip_parish === null, "no ZIP, no ZIP read");

// A ZIP the table can't place: the profile's parish, as the browser falls back.
const unk = await call(UNKNOWNZIP);
check(unk.near?.lat === PT.Caddo.lat && unk.near?.lng === PT.Caddo.lng, `an unknown ZIP falls back to the profile's parish (${JSON.stringify(unk.near)})`);
check(unk.zip_parish?.zip === "99999" && unk.zip_parish?.parish === null, "and says the ZIP has no parish");

// Neither known: newest first, near null, as before.
for (const [who, label] of [[NOWHERE, "nothing on file"], [NOWHERE2, "an unknown ZIP and an unknown parish"]]) {
  const a = await call(who);
  const at = a.items.map((i) => new Date(i.live_at).getTime());
  check(a.near === null && at.every((t, i) => i === 0 || at[i - 1] >= t), `${label}: near null, newest first`);
}

// A position on file is never second-guessed.
const pos = await call(CROWD);
check(pos.near?.lat === 30.45 && pos.near?.lng === -91.15, "a position on file is the point, not its parish");
check(ids(pos) === JSON.stringify(await browserTop(CROWD, { lat: 30.45, lng: -91.15 })), "and its order is unchanged");
check(pos.zip_parish === null, "a position on file needs no ZIP read");

const def = await db.query("SELECT p.prosecdef, p.provolatile FROM pg_proc p WHERE p.proname = 'declutter_first_screen'");
check(def.rows.length === 1 && def.rows[0].prosecdef === false && def.rows[0].provolatile === "s", "one definition, invoker and stable");
const priv = await db.query("SELECT has_function_privilege('anon', 'public.declutter_first_screen(text[])', 'EXECUTE') AS anon");
check(priv.rows[0].anon === false, "role anon cannot run it");

await db.close();
if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log("\nall passed");
