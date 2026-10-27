#!/usr/bin/env node
/**
 * PGlite proof for 20261027194426_declutter_share_card (Q2426, owner 2026-10-27: share a Declutter item to
 * Facebook with a link card).
 *
 * The world is the Declutter slice chain (scripts/declutter/slice3Harness.mjs) plus prod's seller_hidden column
 * (20261021142959, stubbed in its shape: boolean NOT NULL DEFAULT false) and a seed switch the proof can turn.
 * The migration is applied 3 times (replay-safe). Covers: anon reads the card of a live or reserved item (title,
 * price now, town, cover photo id) and NOTHING else (no seller id, description, floor, pickup address, storage
 * path); NULL for a sold, withdrawn, draft, hidden-seller, test-while-hidden item, a missing id, and when the
 * Declutter switch is off; the photo-path helper is service_role only and follows the same rule; a free item's
 * card says price 0.
 *
 *   node src/test/pglite/declutterShareCard.pglite.mjs                      # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterShareCard.pglite.mjs   # RED: the migration absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterShareCard.pglite.mjs
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, USERS } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261027194426_declutter_share_card.sql";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, SELLER2, BUYER } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";

const db = new PGlite();
for (const sql of setupStatements({ times: 1 })) await db.exec(sql);
// Prod's shape for what the slice chain lacks: the seller_hidden column (20261021142959) and a seed switch
// this proof can turn (prod's seed_hidden_in_discovery asks seed_jobs_hidden_publicly(); here a one-row flag).
await db.exec(`
  ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS seller_hidden boolean NOT NULL DEFAULT false;
  CREATE TABLE IF NOT EXISTS public.proof_seed_switch (hidden boolean NOT NULL);
  INSERT INTO public.proof_seed_switch VALUES (false);
  CREATE OR REPLACE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public' AS $$ SELECT hidden FROM public.proof_seed_switch LIMIT 1 $$;
  GRANT EXECUTE ON FUNCTION public.seed_hidden_in_discovery() TO anon, authenticated, service_role;`);

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const run = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
async function as(role, sql) {
  try {
    await db.exec(`SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE;`);
  }
}
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const refused = (r) => !Array.isArray(r) && /permission denied/i.test(r?.error ?? "");

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `77777777-0000-0000-0000-${String(n).padStart(12, "0")}`;
const P = (n) => `66666666-0000-0000-0000-${String(n).padStart(12, "0")}`;
// seed-policy: not prod (throwaway PGlite only)
for (const [n, seller, price] of [[1, SELLER, 2500], [2, SELLER, 4000], [3, SELLER2, 1250], [4, SELLER, 3000], [5, SELLER, 3000], [6, SELLER, 3000], [7, SELLER, 3000], [8, SELLER2, 100]]) {
  await db.exec(liveItemSql({ id: I(n), seller, title: `Card item ${n}`, price, floor: Math.min(price, 100) }));
}
await db.exec(`
  INSERT INTO public.declutter_item_photos (id, item_id, seller_id, storage_path, position) VALUES
    ('${P(1)}', '${I(1)}', '${SELLER}', '${SELLER}/declutter/${I(1)}/cover.jpg', 0),
    ('${P(2)}', '${I(1)}', '${SELLER}', '${SELLER}/declutter/${I(1)}/second.jpg', 1),
    ('${P(4)}', '${I(4)}', '${SELLER}', '${SELLER}/declutter/${I(4)}/a.jpg', 0);
  UPDATE public.declutter_items SET status = 'reserved' WHERE id = '${I(2)}';
  UPDATE public.declutter_items SET status = 'sold' WHERE id = '${I(4)}';
  UPDATE public.declutter_items SET status = 'withdrawn' WHERE id = '${I(5)}';
  UPDATE public.declutter_items SET status = 'draft' WHERE id = '${I(6)}';
  UPDATE public.declutter_items SET seller_hidden = true WHERE id = '${I(7)}';
  UPDATE public.declutter_items SET is_seed = true WHERE id = '${I(8)}';`);

const card = async (role, n) => {
  const r = await as(role, `SELECT public.declutter_public_item_card('${I(n)}') AS c`);
  return Array.isArray(r) ? r[0]?.c ?? null : r;
};

// 1. anon reads a live item's card: exactly the four fields, the cover (position 0) photo.
{
  const c = await card("anon", 1);
  ok(c && c.title === "Card item 1" && c.price_cents === 2500 && c.area_label === "Mid-City, Baton Rouge" && c.photo_id === P(1),
    `anon reads a live item's card: title, price, town, cover photo id (${JSON.stringify(c)})`);
  ok(c && Object.keys(c).sort().join(",") === "area_label,photo_id,price_cents,title", "the card carries exactly title, price_cents, area_label, photo_id");
  const text = JSON.stringify(c ?? {});
  ok(!text.includes(SELLER) && !text.includes("Example St") && !text.includes("Solid.") && !text.includes("declutter/"),
    "the card never carries the seller id, pickup address, description or a storage path");
}
// 2. reserved still shows; a card with no photo says photo_id null.
{
  const c = await card("anon", 2);
  ok(c && c.title === "Card item 2" && c.photo_id === null, "a reserved item still previews; no photo is photo_id null");
  const signedIn = await card("authenticated", 3);
  ok(signedIn && signedIn.price_cents === 1250, "a signed-in member reads the same card");
}
// 3. every item the page would not sell is the same NULL.
for (const [n, why] of [[4, "sold"], [5, "withdrawn"], [6, "a draft"], [7, "a hidden seller's"]]) {
  ok((await card("anon", n)) === null, `${why} item: NULL`);
}
ok(one(await as("anon", `SELECT public.declutter_public_item_card('${I(99)}')`)) === null, "no such item: NULL");
ok(one(await as("anon", `SELECT public.declutter_public_item_card(NULL)`)) === null, "a NULL id: NULL");
// 4. the seed switch: a test item previews only while test data is shown.
ok((await card("anon", 8))?.title === "Card item 8", "a test item previews while the seed switch shows test data");
await db.exec(`UPDATE public.proof_seed_switch SET hidden = true`);
ok((await card("anon", 8)) === null, "a test item is NULL while the seed switch hides test data");
ok((await card("anon", 1))?.title === "Card item 1", "a real item still previews while test data is hidden");
await db.exec(`UPDATE public.proof_seed_switch SET hidden = false`);
// 5. the photo path: service_role only, same rule.
{
  const svcPath = one(await as("service_role", `SELECT public.declutter_public_photo_path('${P(1)}')`));
  ok(svcPath === `${SELLER}/declutter/${I(1)}/cover.jpg`, `service_role gets a visible item's photo path (${svcPath})`);
  ok(one(await as("service_role", `SELECT public.declutter_public_photo_path('${P(4)}')`)) === null, "a sold item's photo path: NULL");
  ok(refused(await as("anon", `SELECT public.declutter_public_photo_path('${P(1)}')`)), "anon may not call the photo path helper");
  ok(refused(await as("authenticated", `SELECT public.declutter_public_photo_path('${P(1)}')`)), "a member may not call the photo path helper");
  ok(refused(await as("anon", `SELECT public.declutter_item_link_visible('${I(1)}')`)), "anon may not call the visibility helper");
  ok(refused(await as("anon", `SELECT * FROM public.declutter_items`)), "anon still has no table read of declutter_items");
}
// 6. Declutter switched off: nothing previews, no photo is served.
await db.exec(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter'`);
ok((await card("anon", 1)) === null, "Declutter off: the card is NULL");
ok(one(await as("service_role", `SELECT public.declutter_public_photo_path('${P(1)}')`)) === null, "Declutter off: no photo path");
await db.exec(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter'`);
// 7. a free item (the Free section's $0 price; the slice chain's CHECK predates it, so the row is written past it).
{
  const r = await run(`ALTER TABLE public.declutter_items DROP CONSTRAINT IF EXISTS declutter_items_price_cents_check;
    ALTER TABLE public.declutter_items DROP CONSTRAINT IF EXISTS declutter_items_current_price_cents_check;
    UPDATE public.declutter_items SET price_cents = 0, current_price_cents = 0 WHERE id = '${I(3)}'`);
  ok(!r?.error, `a free item is written${r?.error ? `: ${r.error}` : ""}`);
  ok((await card("anon", 3))?.price_cents === 0, "a free item's card says price 0 (the card prints Free)");
}
// 8. ACLs as written.
{
  const acl = await as("service_role", `SELECT p.proname, p.proacl::text AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('declutter_public_item_card', 'declutter_public_photo_path', 'declutter_item_link_visible') ORDER BY 1`);
  const byName = Object.fromEntries((Array.isArray(acl) ? acl : []).map((r) => [r.proname, r.acl ?? ""]));
  ok(/anon=X/.test(byName.declutter_public_item_card ?? "") && !/(^|[{,])=X/.test(byName.declutter_public_item_card ?? ""),
    `the card: anon may execute, PUBLIC may not (${byName.declutter_public_item_card})`);
  for (const n of ["declutter_public_photo_path", "declutter_item_link_visible"]) {
    ok(!/anon=|authenticated=|(^|[{,])=X/.test(byName[n] ?? "anon="), `${n}: service_role only (${byName[n]})`);
  }
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
