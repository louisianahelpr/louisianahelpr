#!/usr/bin/env node
/**
 * PGlite proof for public.declutter_guest_first_screen() (Q2705 option B).
 *
 *   node src/test/pglite/declutterGuestFirstScreen.pglite.mjs                 # after (3x replay)
 *   MUTANT=<name> node src/test/pglite/declutterGuestFirstScreen.pglite.mjs   # a planted defect: must FAIL
 *   GUEST_FIRST_SCREEN=skip node ...                                          # before: the function does not exist
 *
 * World: declutter_items, declutter_item_photos and feature_switches cut down to the columns the guest read policy
 * and the function name, with RLS on. The guest read policies and grants are run VERBATIM from
 * 20261031060656_declutter_guest_read.sql (their only definition), then this migration. Run as role anon.
 * The claim: the one read returns exactly what a guest's two REST reads return (fetchLiveItems' list, fetchPhotos'
 * rows for it), and nothing a guest cannot already read.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const mig = (suffix) => {
  const f = readdirSync(MIG_DIR).find((n) => n.endsWith(suffix));
  if (!f) throw new Error(`migration *${suffix} not found`);
  return readFileSync(MIG_DIR + f, "utf8");
};
const GUEST_READ = mig("_declutter_guest_read.sql");
let THIS = mig("_declutter_guest_first_screen.sql");

const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // Runs as the owner: anon's row policies stop deciding, so hidden, seed and switched-off listings leak.
  definer: ["SECURITY INVOKER", "SECURITY DEFINER"],
  // Members (and anyone) may call it too.
  grant: ["GRANT EXECUTE ON FUNCTION public.declutter_guest_first_screen() TO anon, service_role;", "GRANT EXECUTE ON FUNCTION public.declutter_guest_first_screen() TO anon, authenticated, service_role;"],
  revoke: ["REVOKE ALL ON FUNCTION public.declutter_guest_first_screen() FROM PUBLIC, anon, authenticated;", ""],
  // Not the REST read's list: not newest first, or another cap. (Dropping the CTE's own ORDER BY, or the photo rows'
  // item filter, changes nothing below the 500 cap: the photo policy already limits rows to readable items. Not
  // planted, said so.)
  order: ["jsonb_agg(to_jsonb(t) ORDER BY t.live_at DESC)", "jsonb_agg(to_jsonb(t) ORDER BY t.live_at)"],
  cap: ["LIMIT 500", "LIMIT 2"],
  // Photo rows not by position (fetchPhotos orders them; a card's cover is its first).
  photoOrder: ["                       ORDER BY p.position)", "                       ORDER BY p.position DESC)"],
};
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !THIS.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  THIS = THIS.replaceAll(m[0], m[1]);
}
const SKIP = process.env.GUEST_FIRST_SCREEN === "skip";

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const I = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;
const S = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text NOT NULL);
  CREATE TABLE public.declutter_items (
    id uuid PRIMARY KEY, seller_id uuid, status text NOT NULL, title text, description text, category text,
    condition_stars int, delivery_size text, price_cents int, current_price_cents int, area_label text,
    area_lat numeric(5,2), area_lng numeric(6,2), created_at timestamptz DEFAULT now(), live_at timestamptz,
    porch_ok boolean DEFAULT true, accepts_offers boolean DEFAULT true, drops_stopped boolean DEFAULT false,
    handovers text[], sale_mode text, last_price_drop_on date, drop_pct int,
    seller_hidden boolean NOT NULL DEFAULT false, is_seed boolean NOT NULL DEFAULT false,
    pickup_address text
  );
  CREATE TABLE public.declutter_item_photos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid REFERENCES public.declutter_items(id),
    storage_path text, position int, created_at timestamptz DEFAULT now()
  );
  ALTER TABLE public.declutter_items ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.declutter_item_photos ENABLE ROW LEVEL SECURITY;
`);
await db.exec(GUEST_READ);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(THIS); // replay-safe

// Four readable listings (newest first: 4, 3, 2, 1), and four a guest must never see.
const items = [
  [1, "live", "2026-11-01", false, false], [2, "reserved", "2026-11-02", false, false],
  [3, "live", "2026-11-03", false, false], [4, "live", "2026-11-04", false, false],
  [5, "live", "2026-11-05", true, false],   // hidden seller
  [6, "live", "2026-11-06", false, true],   // test data
  [7, "sold", "2026-11-07", false, false],  // not for sale
  [8, "draft", "2026-11-08", false, false], // not listed
];
for (const [n, status, live, hidden, seed] of items) {
  await db.query(
    `INSERT INTO public.declutter_items (id, seller_id, status, title, live_at, seller_hidden, is_seed, pickup_address, area_lat, area_lng)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '1 Secret St', 30.22, -92.02)`,
    [I(n), S(n), status, `item ${n}`, live, hidden, seed],
  );
  await db.query(`INSERT INTO public.declutter_item_photos (item_id, storage_path, position) VALUES ($1, $2, 1), ($1, $3, 0)`, [I(n), `u/${n}b.jpg`, `u/${n}a.jpg`]);
}

const asAnon = async (sql) => {
  await db.exec("SET ROLE anon");
  try { return await db.query(sql); } finally { await db.exec("RESET ROLE"); }
};
const ITEM_COLS = "id, seller_id, status, title, description, category, condition_stars, delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng, created_at, live_at, porch_ok, accepts_offers";
// The two REST reads a guest's page makes today (fetchLiveItems, fetchPhotos), as anon.
const restRead = async () => {
  const list = (await asAnon(`SELECT ${ITEM_COLS} FROM public.declutter_items WHERE status IN ('live','reserved') ORDER BY live_at DESC LIMIT 500`)).rows;
  const ids = list.map((r) => `'${r.id}'`).join(",") || "NULL";
  const photos = (await asAnon(`SELECT id, item_id, storage_path, position FROM public.declutter_item_photos WHERE item_id IN (${ids}) ORDER BY position`)).rows;
  return { list, photos };
};
const oneRead = async () => {
  try {
    return (await asAnon("SELECT public.declutter_guest_first_screen() AS a")).rows[0].a;
  } catch (e) {
    return { error: String(e.message ?? e) };
  }
};
// jsonb sorts keys: compare each row with its keys sorted, numbers and times as values.
const norm = (rows) => JSON.parse(JSON.stringify(rows)).map((r) => { const v = { ...r, area_lat: Number(r.area_lat), area_lng: Number(r.area_lng), created_at: new Date(r.created_at).toISOString(), live_at: new Date(r.live_at).toISOString() }; return Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])); });
const ids = (rows) => rows.map((r) => r.id);

// --- Declutter open to everyone.
await db.exec("INSERT INTO public.feature_switches VALUES ('declutter', 'everyone')");
{
  const rest = await restRead();
  const a = await oneRead();
  check(!a.error, `anon can call it${a.error ? ` (${a.error})` : ""}`);
  check(rest.list.length === 4, `the REST read a guest makes sees the 4 readable listings (${rest.list.length})`);
  check(JSON.stringify(ids(a.items ?? [])) === JSON.stringify([I(4), I(3), I(2), I(1)]), "the one read's list is the readable listings, newest first");
  check(JSON.stringify(norm(a.items ?? [])) === JSON.stringify(norm(rest.list)), "the one read's list equals fetchLiveItems' rows, column for column");
  const photoKey = (p) => `${p.item_id}|${p.storage_path}|${p.position}`;
  check(JSON.stringify((a.photos ?? []).map(photoKey).sort()) === JSON.stringify(rest.photos.map(photoKey).sort()), "its photo rows equal fetchPhotos' rows for that list");
  check((a.photos ?? []).every((p, i, all) => i === 0 || all[i - 1].position <= p.position), "photo rows come by position, as fetchPhotos orders them");
  const leaked = JSON.stringify(a);
  check(![5, 6, 7, 8].some((n) => leaked.includes(I(n))), "a hidden seller's, a test, a sold and a draft listing never appear, nor their photos");
  check(!leaked.includes("Secret St"), "no pickup address");
}

// --- Declutter for testers only: a guest reads nothing, the same as the REST reads.
await db.exec("UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter'");
{
  const rest = await restRead();
  const a = await oneRead();
  check(rest.list.length === 0 && (a.items ?? ["x"]).length === 0 && (a.photos ?? ["x"]).length === 0, "switched to testers: no listing and no photo, as the REST reads");
}

// --- Who may call it, and how it runs.
{
  const r = (await db.query(`SELECT p.prosecdef, p.provolatile,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
      has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_x
    FROM pg_proc p WHERE p.proname = 'declutter_guest_first_screen'`)).rows[0];
  check(!!r, "the function exists");
  check(r && r.prosecdef === false, "SECURITY INVOKER: anon's own row policies decide");
  check(r && r.provolatile === "s", "STABLE: a read, never a write");
  check(r && r.anon_x === true && r.svc_x === true, "anon and service_role may call it");
  check(r && r.auth_x === false, "a member may not (a member has declutter_first_screen)");
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
