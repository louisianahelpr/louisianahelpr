#!/usr/bin/env node
/**
 * PGlite proof for 20261109194234_declutter_sold_item_card (F061, UI audit 11-09; lead rule 11-09).
 *
 * The world is the Declutter slice chain (scripts/declutter/slice3Harness.mjs) plus prod's seller_hidden column and
 * a seed switch the proof can turn (as declutterShareCard.pglite.mjs), then 20261027194426 (the share card the new
 * file builds on), then the new migration 3 times (replay-safe). Covers:
 *   - anon and members read a SOLD or COMPLETED item's card: exactly { title, photo_id } (the cover);
 *   - NULL for live, reserved, withdrawn, removed, rejected, ended, sold_elsewhere, draft, a hidden seller's sold item,
 *     a test item while test data is hidden, Declutter switched off, a missing id and a NULL id;
 *   - the internal rule is not callable by anon or authenticated; the photo path stays service_role only, gives a sold
 *     item's COVER and nothing else of it, and still gives every photo of a live item.
 *
 *   node src/test/pglite/declutterSoldItemCard.pglite.mjs                      # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSoldItemCard.pglite.mjs   # RED: the migration absent
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, USERS } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE_FILE = "20261027194426_declutter_share_card.sql";
const NEW_FILE = "20261109194234_declutter_sold_item_card.sql";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, SELLER2 } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";

const db = new PGlite();
for (const sql of setupStatements({ times: 1 })) await db.exec(sql);
await db.exec(`
  ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS seller_hidden boolean NOT NULL DEFAULT false;
  CREATE TABLE IF NOT EXISTS public.proof_seed_switch (hidden boolean NOT NULL);
  INSERT INTO public.proof_seed_switch VALUES (false);
  CREATE OR REPLACE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public' AS $$ SELECT hidden FROM public.proof_seed_switch LIMIT 1 $$;
  GRANT EXECUTE ON FUNCTION public.seed_hidden_in_discovery() TO anon, authenticated, service_role;`);
// The item status CHECK as on prod (pg_get_constraintdef, measured 11-09), so every status below can be set.
await db.exec(`
  DO $$ DECLARE c text; BEGIN
    FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.declutter_items'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%status%' LOOP
      EXECUTE format('ALTER TABLE public.declutter_items DROP CONSTRAINT %I', c);
    END LOOP;
  END $$;
  ALTER TABLE public.declutter_items ADD CONSTRAINT proof_status_check CHECK (status = ANY (ARRAY['draft','pending_review',
    'live','paused','reserved','sold','completed','ended','withdrawn','rejected','removed','sold_elsewhere',
    'pending_seller_approval']));`);
await db.exec(readFileSync(`${MIG_DIR}${BASE_FILE}`, "utf8"));
// prod's reports table, in the columns the rule reads (information_schema, measured 11-09).
await db.exec(`CREATE TABLE IF NOT EXISTS public.reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid,
  reported_type text NOT NULL, reported_id uuid, reason text, description text, status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(), assigned_to uuid, reported_content text);`);

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
const refused = (r) => !Array.isArray(r) && /permission denied|does not exist/i.test(r?.error ?? "");

if (!skip) {
  const sql = readFileSync(`${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `88888888-0000-0000-0000-${String(n).padStart(12, "0")}`;
const P = (n) => `55555555-0000-0000-0000-${String(n).padStart(12, "0")}`;
const STATUS = { 1: "sold", 2: "completed", 3: "live", 4: "reserved", 5: "withdrawn", 6: "removed", 7: "rejected", 8: "ended", 9: "sold_elsewhere", 10: "draft", 11: "sold", 12: "sold" };
// seed-policy: not prod (throwaway PGlite only)
for (const n of Object.keys(STATUS).map(Number)) {
  await db.exec(liveItemSql({ id: I(n), seller: n % 2 ? SELLER : SELLER2, title: `Sold proof item ${n}`, price: 2500, floor: 100 }));
  await db.exec(`INSERT INTO public.declutter_item_photos (id, item_id, seller_id, storage_path, position) VALUES
    ('${P(n * 10)}', '${I(n)}', '${n % 2 ? SELLER : SELLER2}', '${n % 2 ? SELLER : SELLER2}/declutter/${I(n)}/cover.jpg', 0),
    ('${P(n * 10 + 1)}', '${I(n)}', '${n % 2 ? SELLER : SELLER2}', '${n % 2 ? SELLER : SELLER2}/declutter/${I(n)}/second.jpg', 1);`);
  if (STATUS[n] !== "live") await db.exec(`UPDATE public.declutter_items SET status = '${STATUS[n]}' WHERE id = '${I(n)}'`);
}
await db.exec(`UPDATE public.declutter_items SET seller_hidden = true WHERE id = '${I(11)}';
  UPDATE public.declutter_items SET is_seed = true WHERE id = '${I(12)}';`);

const card = async (role, n) => {
  const r = await as(role, `SELECT public.declutter_sold_item_card('${I(n)}') AS c`);
  return Array.isArray(r) ? r[0]?.c ?? null : r;
};

// 1. a sold or completed item: exactly the title and the cover photo id, for anon and members.
for (const [n, role] of [[1, "anon"], [2, "anon"], [1, "authenticated"]]) {
  const c = await card(role, n);
  ok(c && c.title === `Sold proof item ${n}` && c.photo_id === P(n * 10), `${role} reads a ${STATUS[n]} item's card (${JSON.stringify(c)})`);
  ok(c && Object.keys(c).sort().join(",") === "photo_id,title", `the ${STATUS[n]} card carries exactly title and photo_id`);
}
// 2. every other status, a hidden seller's sold item, a missing and a NULL id: the same NULL.
for (const n of [3, 4, 5, 6, 7, 8, 9, 10]) ok((await card("anon", n)) === null, `${STATUS[n]} item: NULL (shows nothing of the listing)`);
ok((await card("anon", 11)) === null, "a sold item whose seller is out (seller_hidden): NULL");
// lh-authz-rls 11-09: a sold item cannot be taken down, so any report hides it (open or closed).
await db.exec(`INSERT INTO public.reports (reported_type, reported_id, reason, status) VALUES ('declutter_item', '${I(2)}', 'scam', 'dismissed')`);
ok((await card("anon", 2)) === null, "a completed item that was reported (even dismissed): NULL");
ok(one(await as("service_role", `SELECT public.declutter_public_photo_path('${P(20)}')`)) === null, "a reported sold item's cover is not served");
await db.exec(`INSERT INTO public.reports (reported_type, reported_id, reason) VALUES ('job', '${I(1)}', 'other')`);
ok((await card("anon", 1))?.title === "Sold proof item 1", "a report of another kind with the same id does not hide it");
ok(one(await as("anon", `SELECT public.declutter_sold_item_card('${I(99)}')`)) === null, "no such item: NULL");
ok(one(await as("anon", `SELECT public.declutter_sold_item_card(NULL)`)) === null, "a NULL id: NULL");
// 3. the seed switch and the Declutter switch.
ok((await card("anon", 12))?.title === "Sold proof item 12", "a sold test item shows while test data is shown");
await db.exec(`UPDATE public.proof_seed_switch SET hidden = true`);
ok((await card("anon", 12)) === null, "a sold test item is NULL while test data is hidden");
await db.exec(`UPDATE public.proof_seed_switch SET hidden = false`);
await db.exec(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter'`);
ok((await card("anon", 1)) === null, "Declutter switched off: NULL");
await db.exec(`UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'declutter'`);
ok((await card("anon", 1))?.title === "Sold proof item 1", "switched back on: the sold card shows again");
// 4. grants: the internal rule is not callable by anon or members; the photo path stays service_role only.
ok(refused(await as("anon", `SELECT public.declutter_item_sold_visible('${I(1)}')`)), "anon cannot call the internal sold rule");
ok(refused(await as("authenticated", `SELECT public.declutter_item_sold_visible('${I(1)}')`)), "a member cannot call the internal sold rule");
ok(refused(await as("anon", `SELECT public.declutter_public_photo_path('${P(10)}')`)), "anon cannot read a photo path");
// 5. the photo path: a sold item's COVER only; every photo of a live item; nothing of a withdrawn one.
ok(one(await as("service_role", `SELECT public.declutter_public_photo_path('${P(10)}')`)) === `${SELLER}/declutter/${I(1)}/cover.jpg`, "a sold item's cover path is served");
ok(one(await as("service_role", `SELECT public.declutter_public_photo_path('${P(11)}')`)) === null, "a sold item's second photo is not");
ok(one(await as("service_role", `SELECT public.declutter_public_photo_path('${P(31)}')`)) === `${SELLER}/declutter/${I(3)}/second.jpg`, "a live item's every photo is still served");
ok(one(await as("service_role", `SELECT public.declutter_public_photo_path('${P(50)}')`)) === null, "a withdrawn item's cover is not served");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
