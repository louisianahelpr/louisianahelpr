#!/usr/bin/env node
/**
 * PGlite proof for declutter_first_screen (one read for /declutter's first screen).
 *
 *   node src/test/pglite/declutterFirstScreen.pglite.mjs                 # after (3x replay)
 *   MUTANT=<name> node src/test/pglite/declutterFirstScreen.pglite.mjs   # a planted defect: must FAIL
 *
 * World: declutter_items, declutter_item_photos and declutter_watchlist with the SELECT policies and column grants
 * read from prod on 2026-10-30, run as role authenticated with auth.uid() from a setting. Stubbed, and said so:
 * feature_switches_for_me and feature_enabled_for (a table of switches per user), seed_hidden_in_discovery (true), and
 * declutter_bundle_sellers (raises when the switch is off, as prod's require_feature does).
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_first_screen.sql"));
if (!THIS) throw new Error("migration not found");

const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // Runs as the owner: the row policies stop deciding, so seed and hidden items and floors of others leak.
  definer: ["SECURITY INVOKER", "SECURITY DEFINER"],
  // Names a private column.
  floor: ["i.porch_ok, i.accepts_offers,", "i.porch_ok, i.accepts_offers, i.floor_price_cents,"],
  // Asks about bundles with the switch off, which raises.
  bundle: ["WHEN COALESCE(v_switches ->> 'declutter', 'false') = 'true' AND COALESCE(cardinality(v_sellers), 0) > 0", "WHEN true"],
  // Open to signed-out visitors.
  grant: ["REVOKE ALL ON FUNCTION public.declutter_first_screen(text[]) FROM PUBLIC, anon;", ""],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replaceAll(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
const I = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ME = U(1), SELLER = U(2), OFF = U(3);

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
    accepts_offers boolean DEFAULT true, sale_mode text, last_price_drop_on date, drop_pct int,
    is_seed boolean DEFAULT false, seller_hidden boolean DEFAULT false, floor_price_cents int
  );
  GRANT SELECT (id, seller_id, status, title, description, category, condition_stars, delivery_size, price_cents,
    current_price_cents, area_label, area_lat, area_lng, created_at, live_at, porch_ok, accepts_offers, sale_mode,
    last_price_drop_on, drop_pct, is_seed, seller_hidden) ON public.declutter_items TO authenticated;
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

const call = async (uid, role = "authenticated") => {
  await db.exec(`SET test.uid = '${uid ?? ""}'; SET ROLE ${role};`);
  try {
    const r = await db.query("SELECT public.declutter_first_screen(ARRAY['declutter']) AS v");
    return { value: r.rows[0].v };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec("RESET ROLE;");
  }
};

const me = await call(ME);
check(!me.error, `a member's read works${me.error ? `: ${me.error}` : ""}`);
const titles = (me.value?.items ?? []).map((i) => i.title);
check(titles.length === 1 && titles[0] === "real item", `only the real live item comes back (${titles.join(", ")})`);
check(!JSON.stringify(me.value ?? {}).includes("floor_price_cents"), "no floor column in the answer");
check(!JSON.stringify(me.value ?? {}).includes("is_seed"), "no seed flag in the answer");
check((me.value?.photos ?? []).length === 1 && me.value.photos[0].storage_path === "real.jpg", "only the real item's photo");
check(JSON.stringify(me.value?.watching) === JSON.stringify([I(1)]), "only my own watchlist");
check(JSON.stringify(me.value?.bundle_sellers) === JSON.stringify([SELLER]), "bundle sellers asked for what is listed");
check(me.value?.switches?.declutter === true, "the switches come back");

const off = await call(OFF);
check(!off.error, `the switch off is an answer, not an error${off.error ? `: ${off.error}` : ""}`);
check((off.value?.items ?? []).length === 0, "the switch off shows no items");
check(off.value?.switches?.declutter === false, "and says the switch is off");

const out = await call(null);
check(!!out.error && out.error.includes("not_authenticated"), "signed out with a token-less session is refused");
const priv = await db.query(
  "SELECT has_function_privilege('anon', 'public.declutter_first_screen(text[])', 'EXECUTE') AS anon, has_function_privilege('authenticated', 'public.declutter_first_screen(text[])', 'EXECUTE') AS member",
);
check(priv.rows[0].anon === false, "role anon cannot run it");
check(priv.rows[0].member === true, "a member can");

const def = await db.query("SELECT p.prosecdef, p.provolatile FROM pg_proc p WHERE p.proname = 'declutter_first_screen'");
check(def.rows.length === 1 && def.rows[0].prosecdef === false && def.rows[0].provolatile === "s", "one definition, invoker and stable");

await db.close();
if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log("\nall passed");
