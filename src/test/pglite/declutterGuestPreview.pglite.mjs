#!/usr/bin/env node
/**
 * PGlite proof for public.declutter_guest_preview() (Q2705, lead 11-07).
 *
 *   node src/test/pglite/declutterGuestPreview.pglite.mjs                 # after (3x replay)
 *   MUTANT=<name> node src/test/pglite/declutterGuestPreview.pglite.mjs   # a planted defect: must FAIL
 *   GUEST_PREVIEW=skip node ...                                           # before: the function does not exist
 *
 * World: declutter_items, declutter_item_photos and feature_switches cut down to the columns the guest read policy
 * and the function name, with RLS on. The guest read policies and grants are run VERBATIM from
 * 20261031060656_declutter_guest_read.sql (their only definition), then this migration. Run as role anon.
 * The claim: the preview is exactly the top 24 of what a guest's REST list read returns (same rows, same order, the
 * card columns and drop columns only), the photo rows fetchPhotos returns for them, `more` true exactly when the list
 * goes on, and nothing a guest cannot already read.
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
let THIS = mig("_declutter_guest_preview.sql");

const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // Runs as the owner: anon's row policies stop deciding, so hidden, seed and switched-off listings leak.
  definer: ["SECURITY INVOKER", "SECURITY DEFINER"],
  // Members (and anyone) may call it too.
  grant: ["GRANT EXECUTE ON FUNCTION public.declutter_guest_preview() TO anon, service_role;", "GRANT EXECUTE ON FUNCTION public.declutter_guest_preview() TO anon, authenticated, service_role;"],
  revoke: ["REVOKE ALL ON FUNCTION public.declutter_guest_preview() FROM PUBLIC, anon, authenticated;", ""],
  // Not the top of the REST read's list: oldest first, or another cap.
  order: ["jsonb_agg(to_jsonb(t) ORDER BY t.live_at DESC)", "jsonb_agg(to_jsonb(t) ORDER BY t.live_at)"],
  innerOrder: ["    SELECT * FROM ranked ORDER BY live_at DESC LIMIT 24", "    SELECT * FROM ranked ORDER BY live_at LIMIT 24"],
  cap: ["    SELECT * FROM ranked ORDER BY live_at DESC LIMIT 24", "    SELECT * FROM ranked ORDER BY live_at DESC LIMIT 25"],
  // `more` wrong at the edge: 24 readable listings would say more follow.
  more: ["'more', (SELECT count(*) FROM ranked) > 24", "'more', (SELECT count(*) FROM ranked) >= 24"],
  // The bytes come back: descriptions in the preview.
  description: ["SELECT i.id, i.seller_id, i.status, i.title, i.category,", "SELECT i.id, i.seller_id, i.status, i.title, i.description, i.category,"],
  // The drop tag's columns missing (a second round for them).
  drops: [", i.sale_mode, i.last_price_drop_on, i.drop_pct, i.drops_stopped", ""],
  // Photo rows not by position (a card's cover is its first).
  photoOrder: ["                       ORDER BY p.position)", "                       ORDER BY p.position DESC)"],
};
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !THIS.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  THIS = THIS.replaceAll(m[0], m[1]);
}
const SKIP = process.env.GUEST_PREVIEW === "skip";

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

// 26 readable listings (n = 1..26, newer as n grows; every 5th reserved), and four a guest must never see, NEWER than
// all of them so a leak would land inside the top 24.
const day = (n) => new Date(Date.UTC(2026, 9, 1) + n * 3600_000).toISOString();
const add = async (n, status, hidden = false, seed = false) => {
  await db.query(
    `INSERT INTO public.declutter_items (id, seller_id, status, title, description, live_at, seller_hidden, is_seed, pickup_address,
       area_lat, area_lng, sale_mode, last_price_drop_on, drop_pct, price_cents, current_price_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '1 Secret St', 30.22, -92.02, 'drops', '2026-11-01', 10, 2000, 1800)`,
    [I(n), S(n), status, `item ${n}`, `A long description of item ${n}`, day(n), hidden, seed],
  );
  await db.query(`INSERT INTO public.declutter_item_photos (item_id, storage_path, position) VALUES ($1, $2, 1), ($1, $3, 0)`, [I(n), `u/${n}b.jpg`, `u/${n}a.jpg`]);
};
for (let n = 1; n <= 26; n++) await add(n, n % 5 === 0 ? "reserved" : "live");
await add(91, "live", true);   // hidden seller
await add(92, "live", false, true); // test data
await add(93, "sold");
await add(94, "draft");

const asAnon = async (sql) => {
  await db.exec("SET ROLE anon");
  try { return await db.query(sql); } finally { await db.exec("RESET ROLE"); }
};
const CARD_COLS = "id, seller_id, status, title, category, condition_stars, delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng, created_at, live_at, porch_ok, accepts_offers, sale_mode, last_price_drop_on, drop_pct, drops_stopped";
// fetchLiveItems' read (its order and filter) with the card and drop columns, and fetchPhotos' read, as anon.
const restRead = async () => {
  const list = (await asAnon(`SELECT ${CARD_COLS} FROM public.declutter_items WHERE status IN ('live','reserved') ORDER BY live_at DESC LIMIT 500`)).rows;
  return { list };
};
const restPhotos = async (idList) => {
  const ids = idList.map((id) => `'${id}'`).join(",") || "NULL";
  return (await asAnon(`SELECT id, item_id, storage_path, position FROM public.declutter_item_photos WHERE item_id IN (${ids}) ORDER BY position`)).rows;
};
const preview = async () => {
  try {
    return (await asAnon("SELECT public.declutter_guest_preview() AS a")).rows[0].a;
  } catch (e) {
    return { error: String(e.message ?? e) };
  }
};
// jsonb sorts keys: compare each row with its keys sorted, numbers, dates and times as values.
const norm = (rows) => JSON.parse(JSON.stringify(rows)).map((r) => {
  const v = { ...r, area_lat: Number(r.area_lat), area_lng: Number(r.area_lng), created_at: new Date(r.created_at).toISOString(), live_at: new Date(r.live_at).toISOString(), last_price_drop_on: r.last_price_drop_on ? String(r.last_price_drop_on).slice(0, 10) : null };
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]));
});
const ids = (rows) => rows.map((r) => r.id);
const photoKey = (p) => `${p.item_id}|${p.storage_path}|${p.position}`;

// --- Declutter open to everyone, 26 readable listings.
await db.exec("INSERT INTO public.feature_switches VALUES ('declutter', 'everyone')");
{
  const rest = await restRead();
  const a = await preview();
  check(!a.error, `anon can call it${a.error ? ` (${a.error})` : ""}`);
  check(rest.list.length === 26, `the REST read a guest makes sees the 26 readable listings (${rest.list.length})`);
  const top = rest.list.slice(0, 24);
  check(JSON.stringify(ids(a.items ?? [])) === JSON.stringify(ids(top)), "the preview is the REST list's top 24, in its order (newest first)");
  // Dates come back as text from jsonb and as Date from a row: compare by value.
  const fix = (rows) => norm(rows).map((r) => ({ ...r, last_price_drop_on: r.last_price_drop_on ? new Date(r.last_price_drop_on).toISOString().slice(0, 10) : null }));
  check(JSON.stringify(fix(a.items ?? [])) === JSON.stringify(fix(top)), "each preview row equals the REST row's card and drop columns, column for column");
  check((a.items ?? []).every((r) => !("description" in r)), "no description in the preview (the bytes the full list carries)");
  check(a.more === true, "more: the list goes on past the preview");
  const photos = await restPhotos(ids(top));
  check(JSON.stringify((a.photos ?? []).map(photoKey).sort()) === JSON.stringify(photos.map(photoKey).sort()), "its photo rows equal fetchPhotos' rows for those 24 items");
  check((a.photos ?? []).every((p, i, all) => i === 0 || all[i - 1].position <= p.position), "photo rows come by position, as fetchPhotos orders them");
  const leaked = JSON.stringify(a);
  check(![91, 92, 93, 94].some((n) => leaked.includes(I(n))), "a hidden seller's, a test, a sold and a draft listing never appear, nor their photos");
  check(!leaked.includes("Secret St"), "no pickup address");
}

// --- Exactly 24 readable listings: the preview is the whole list, and says so.
await db.exec(`UPDATE public.declutter_items SET status = 'sold' WHERE id IN ('${I(1)}', '${I(2)}')`);
{
  const rest = await restRead();
  const a = await preview();
  check(rest.list.length === 24 && (a.items ?? []).length === 24 && a.more === false, `24 readable: all 24 and more false (${(a.items ?? []).length}, ${a.more})`);
}

// --- Declutter for testers only: a guest reads nothing, the same as the REST reads.
await db.exec("UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter'");
{
  const rest = await restRead();
  const a = await preview();
  check(rest.list.length === 0 && (a.items ?? ["x"]).length === 0 && (a.photos ?? ["x"]).length === 0 && a.more === false, "switched to testers: no listing, no photo and more false, as the REST reads");
}

// --- Who may call it, and how it runs.
{
  const r = (await db.query(`SELECT p.prosecdef, p.provolatile,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
      has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_x
    FROM pg_proc p WHERE p.proname = 'declutter_guest_preview'`)).rows[0];
  check(!!r, "the function exists");
  check(r && r.prosecdef === false, "SECURITY INVOKER: anon's own row policies decide");
  check(r && r.provolatile === "s", "STABLE: a read, never a write");
  check(r && r.anon_x === true && r.svc_x === true, "anon and service_role may call it");
  check(r && r.auth_x === false, "a member may not (a member has declutter_first_screen)");
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
