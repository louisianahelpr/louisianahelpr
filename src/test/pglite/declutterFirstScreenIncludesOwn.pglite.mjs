#!/usr/bin/env node
/**
 * PGlite proof for 20261116152258 (owner 2026-11-16, "my declutter page shows nothing"): declutter_first_screen now
 * answers the caller's own live listings too, so Browse's first answer (and the whole list it hands over when it all
 * fits) holds them; seed and hidden-seller rows stay out exactly as before.
 *
 *   node src/test/pglite/declutterFirstScreenIncludesOwn.pglite.mjs                 # after (3x replay)
 *   MUTANT=<name> node src/test/pglite/declutterFirstScreenIncludesOwn.pglite.mjs   # a planted defect: must FAIL
 *   NEW_MIGRATION=skip  (runs 20261108195151's definition instead: the before; must FAIL)
 *
 * World: declutterFirstScreenParishOrigin.pglite.mjs's (prod's policies and grants, 2026-10-30).
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith(process.env.NEW_MIGRATION === "skip" ? "_declutter_trades_fixes.sql" : "_declutter_first_screen_includes_own.sql"));
if (!THIS) throw new Error("migration not found");

const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The caller's own listings left out again (the bug).
  own: ["WHERE i.status IN ('live', 'reserved')\n", "WHERE i.status IN ('live', 'reserved') AND i.seller_id IS DISTINCT FROM v_me\n"],
  // Every row of the caller's, drafts too.
  drafts: ["WHERE i.status IN ('live', 'reserved')\n", "WHERE (i.status IN ('live', 'reserved') OR i.seller_id = v_me)\n"],
  // Runs as the owner: the row policies stop deciding, so seed and hidden items leak.
  definer: [" STABLE\n", " STABLE SECURITY DEFINER\n"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
// The before: only 20261108195151's declutter_first_screen (the rest of that file needs tables this world leaves out).
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
    accepts_offers boolean DEFAULT true, accepts_trades boolean DEFAULT false, sale_mode text, last_price_drop_on date, drop_pct int, drops_stopped boolean DEFAULT false,
    is_seed boolean DEFAULT false, seller_hidden boolean DEFAULT false, floor_price_cents int
  );
  GRANT SELECT (id, seller_id, status, title, description, category, condition_stars, delivery_size, price_cents,
    current_price_cents, area_label, area_lat, area_lng, created_at, live_at, porch_ok, accepts_offers, accepts_trades, sale_mode,
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
  const full = (await db.query(`SELECT id, area_lat, area_lng FROM public.declutter_items WHERE status IN ('live','reserved') ORDER BY live_at DESC`)).rows;
  await db.exec("RESET ROLE;");
  const m = milesFrom(from);
  return [...full].sort((x, y) => m(x) - m(y)).slice(0, 24).map((r) => r.id);
};
const ids = (a) => JSON.stringify((a?.items ?? []).map((i) => i.id));

// The caller's own: one live right beside CROWD's position, one reserved, one draft.
await db.exec(`
  INSERT INTO public.declutter_items (id, seller_id, status, title, area_lat, area_lng, live_at) VALUES
    ('44444444-0000-0000-0000-000000000001', '${CROWD}', 'live', 'my own, right here', 30.45, -91.15, now()),
    ('44444444-0000-0000-0000-000000000002', '${CROWD}', 'reserved', 'my own, reserved', 30.45, -91.15, now() - interval '1 minute'),
    ('44444444-0000-0000-0000-000000000003', '${CROWD}', 'draft', 'my own draft', 30.45, -91.15, now());
  INSERT INTO public.declutter_item_photos (item_id, storage_path, position) VALUES ('44444444-0000-0000-0000-000000000001', 'mine.jpg', 0);
`);
const pos = await call(CROWD);
const titles = pos.items.map((i) => i.title);
check(titles.includes("my own, right here"), `my own live listing comes back (${titles.slice(0, 3).join(", ")})`);
check(titles.includes("my own, reserved"), "and my own reserved one");
check(!titles.includes("my own draft"), "never my draft");
check(pos.photos.some((p) => p.storage_path === "mine.jpg"), "with its photo");
check(pos.items.length === 24 && pos.more === true, "still capped at 24, with more");
check(ids(pos) === JSON.stringify(await browserTop(CROWD, { lat: 30.45, lng: -91.15 })), "the 24 are exactly the top of the browser's list (own included)");
// Someone else sees CROWD's live listing as before, and still no seed or hidden rows.
const zip = await call(ME);
const zipTitles = zip.items.map((i) => i.title);
check(!zipTitles.includes("seed item") && !zipTitles.includes("hidden seller"), "seed and hidden-seller rows stay out");
check(ids(zip) === JSON.stringify(await browserTop(ME, PT.Lafayette)), "another member's answer is the top of their list");
// The only-seller case (prod 2026-11-16): a seller whose listings are all there is sees them, not an empty answer.
await db.exec(`DELETE FROM public.declutter_items WHERE seller_id <> '${CROWD}'`);
const alone = await call(CROWD);
check(alone.items.length === 2 && alone.more === false, `the only seller sees their 2 live/reserved listings (${alone.items.length})`);

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
