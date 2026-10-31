#!/usr/bin/env node
/**
 * PGlite proof for declutter_items.drops_stopped (POST-DROPFLAG).
 *
 *   node src/test/pglite/declutterDropsStoppedPublic.pglite.mjs                 # after (3x replay)
 *   MUTANT=<name> node src/test/pglite/declutterDropsStoppedPublic.pglite.mjs   # a planted defect: must FAIL
 *
 * World: declutter_items and declutter_item_private cut down to what the two restated functions read, with the row
 * policy read from prod on 2026-10-30, run as role authenticated with auth.uid() from a setting. Stubbed, and said so:
 * require_feature, is_caller_banned, declutter_assert_member (returns the caller), feature_switches_for_me,
 * get_parish_for_zip and declutter_bundle_sellers.
 */
import os from "node:os";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_drops_stopped_public.sql"));
if (!THIS) throw new Error("migration not found");

const MIRROR = `  UPDATE public.declutter_items
     SET drops_stopped = NOT p_on
   WHERE id = p_item_id;
`;
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The stop never reaches the buyer: the original bug.
  mirror: [MIRROR, ""],
  // The flag says the opposite.
  inverted: ["     SET drops_stopped = NOT p_on\n   WHERE id = p_item_id;", "     SET drops_stopped = p_on\n   WHERE id = p_item_id;"],
  // Mirrors onto every listing, not this one.
  everyRow: ["     SET drops_stopped = NOT p_on\n   WHERE id = p_item_id;", "     SET drops_stopped = NOT p_on;"],
  // The listing already stopped on prod keeps showing the banner.
  backfill: ["   SET drops_stopped = p.drops_stopped\n", "   SET drops_stopped = false\n"],
  // Browse's first read does not answer it.
  firstScreen: ["i.drop_pct, i.drops_stopped,", "i.drop_pct,"],
  // The private table's stop leaks into the answer.
  leak: ["i.drop_pct, i.drops_stopped,", "i.drop_pct, i.drops_stopped, (SELECT p.drop_stop_cents FROM public.declutter_item_private p WHERE p.item_id = i.id) AS drop_stop_cents,"],
  // Signed-out visitors may call the seller's action.
  revoke: ["REVOKE ALL ON FUNCTION public.declutter_set_listing_drops(uuid, boolean) FROM PUBLIC, anon;", ""],
  // Lets anyone change any listing's flag.
  owner: ["WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE", "WHERE id = p_item_id FOR UPDATE"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
const pristine = mig;
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replaceAll(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
const I = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), OTHER = U(2);

// The restates are prod's text plus only the lines this change adds: the md5 of pg_get_functiondef read 2026-10-30.
const defOf = (name) => {
  const m = pristine.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`));
  if (!m) throw new Error(`${name} not found`);
  return m[0].replace(/\$function\$;$/, "$function$\n");
};
const md5 = (s) => createHash("md5").update(s).digest("hex");
const dropsBefore = defOf("declutter_set_listing_drops").replace(
  `  -- The buyer-readable copy (POST-DROPFLAG). In this same transaction: raising above rolls both back.\n${MIRROR}`, "");
check(md5(dropsBefore) === "691f02d2e2c7d5d32e3528fad044a6a6", `set_listing_drops is prod's text plus the mirror (${md5(dropsBefore)})`);
const screenBefore = defOf("declutter_first_screen").replace("i.drop_pct, i.drops_stopped,", "i.drop_pct,");
check(md5(screenBefore) === "743e7aee8f90196246de056a9acdfa44", `first_screen is prod's text plus the column (${md5(screenBefore)})`);

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA auth TO authenticated, anon;
  GRANT USAGE ON SCHEMA public TO authenticated, anon;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE FUNCTION public.require_feature(text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE FUNCTION public.declutter_assert_member(boolean) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT auth.uid() $$;
  CREATE FUNCTION public.feature_switches_for_me(text[]) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"declutter": false}'::jsonb $$;
  CREATE FUNCTION public.get_parish_for_zip(text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
  CREATE FUNCTION public.declutter_bundle_sellers(uuid[]) RETURNS uuid[] LANGUAGE sql STABLE AS $$ SELECT '{}'::uuid[] $$;
  CREATE TABLE public.declutter_items (
    id uuid PRIMARY KEY, seller_id uuid, status text, title text, description text, category text, condition_stars int,
    delivery_size text, price_cents int, current_price_cents int DEFAULT 5000, area_label text, area_lat numeric, area_lng numeric,
    created_at timestamptz DEFAULT now(), live_at timestamptz DEFAULT now(), porch_ok boolean DEFAULT true,
    accepts_offers boolean DEFAULT true, sale_mode text, last_price_drop_on date, drop_pct int
  );
  GRANT SELECT ON public.declutter_items TO authenticated;
  ALTER TABLE public.declutter_items ENABLE ROW LEVEL SECURITY;
  CREATE POLICY read_listings ON public.declutter_items FOR SELECT TO authenticated USING (true);
  CREATE TABLE public.declutter_item_private (
    item_id uuid PRIMARY KEY, floor_price_cents int DEFAULT 1000, drop_stop_cents int, drops_stopped boolean NOT NULL DEFAULT false,
    updated_at timestamptz
  );
  ALTER TABLE public.declutter_item_private ENABLE ROW LEVEL SECURITY;
  CREATE TABLE public.declutter_item_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, storage_path text, position int);
  CREATE TABLE public.declutter_watchlist (user_id uuid, item_id uuid);
  GRANT SELECT ON public.declutter_item_photos, public.declutter_watchlist TO authenticated;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, latitude numeric, longitude numeric, zip_code text);
  GRANT SELECT ON public.profiles TO authenticated;
  INSERT INTO public.declutter_items (id, seller_id, status, title) VALUES
    ('${I(1)}', '${SELLER}', 'live', 'stopped before this change'),
    ('${I(2)}', '${SELLER}', 'live', 'still dropping'),
    ('${I(3)}', '${SELLER}', 'sold', 'already sold');
  INSERT INTO public.declutter_item_private (item_id, drop_stop_cents, drops_stopped) VALUES
    ('${I(1)}', 5000, true), ('${I(2)}', NULL, false), ('${I(3)}', NULL, false);
`);

// Runs verbatim, three times: replay-safe.
for (let i = 0; i < 3; i++) await db.exec(mig);

const flag = async (n) => (await db.query(`SELECT drops_stopped AS v FROM public.declutter_items WHERE id = '${I(n)}'`)).rows[0].v;
const priv = async (n) => (await db.query(`SELECT drops_stopped AS v FROM public.declutter_item_private WHERE item_id = '${I(n)}'`)).rows[0].v;
const as = async (uid, role, sql) => {
  await db.exec(`SET test.uid = '${uid ?? ""}'; SET ROLE ${role};`);
  try {
    return { rows: (await db.query(sql)).rows };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec("RESET ROLE;");
  }
};
const setDrops = (uid, n, on) => as(uid, "authenticated", `SELECT public.declutter_set_listing_drops('${I(n)}', ${on})`);

check(await flag(1) === true, "the listing already stopped is backfilled");
check(await flag(2) === false, "a listing still dropping is not");

let r = await setDrops(SELLER, 2, false);
check(!r.error, `the seller stops drops${r.error ? `: ${r.error}` : ""}`);
check(await flag(2) === true && await priv(2) === true, "both tables say stopped");
check(await flag(1) === true, "the seller's other listing is untouched by the stop");

// A replay after a seller's change keeps that change.
await db.exec(mig);
check(await flag(2) === true, "a replay keeps the seller's later stop");

r = await setDrops(SELLER, 2, true);
check(!r.error, `the seller turns drops back on${r.error ? `: ${r.error}` : ""}`);
check(await flag(2) === false && await priv(2) === false, "both tables say dropping");
check(await flag(1) === true, "the seller's other listing is untouched by the restart");

r = await setDrops(OTHER, 2, false);
check(/item_not_found/.test(r.error ?? ""), `another member is refused (${r.error ?? "no error"})`);
check(await flag(2) === false, "another member changed nothing");

r = await setDrops(SELLER, 3, false);
check(/item_not_editable/.test(r.error ?? ""), `a sold listing is refused (${r.error ?? "no error"})`);
check(await flag(3) === false && await priv(3) === false, "a refused call changed neither table");

r = await as(OTHER, "authenticated", `SELECT drops_stopped FROM public.declutter_items WHERE id = '${I(1)}'`);
check(r.rows?.[0]?.drops_stopped === true, `a buyer reads the flag (${r.error ?? "ok"})`);
r = await as(OTHER, "authenticated", `UPDATE public.declutter_items SET drops_stopped = false WHERE id = '${I(1)}'`);
check(/permission denied/.test(r.error ?? ""), "a member cannot write the flag directly");
r = await as(OTHER, "authenticated", `SELECT drop_stop_cents FROM public.declutter_item_private WHERE item_id = '${I(1)}'`);
check(/permission denied/.test(r.error ?? ""), "the stop itself stays unreadable");
r = await as(null, "anon", `SELECT drops_stopped FROM public.declutter_items WHERE id = '${I(1)}'`);
check(/permission denied/.test(r.error ?? ""), "a signed-out visitor gets no grant on the column");
r = await as(null, "anon", `SELECT public.declutter_set_listing_drops('${I(1)}', true)`);
check(/permission denied/.test(r.error ?? ""), "a signed-out visitor cannot call the seller's action");

r = await as(OTHER, "authenticated", "SELECT public.declutter_first_screen(ARRAY['declutter']) AS v");
check(!r.error, `Browse's first read works${r.error ? `: ${r.error}` : ""}`);
const items = r.rows?.[0]?.v?.items ?? [];
check(items.find((i) => i.id === I(1))?.drops_stopped === true, "first_screen says the stopped listing is stopped");
check(items.find((i) => i.id === I(2))?.drops_stopped === false, "first_screen says the other is not");
check(!JSON.stringify(r.rows?.[0]?.v ?? {}).includes("drop_stop_cents"), "first_screen names no stop");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
