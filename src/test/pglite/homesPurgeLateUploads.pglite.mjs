#!/usr/bin/env node
/**
 * Q2223 PGlite proof for 20261107034330_rentals_purge_sweeps_late_uploads: an upload that committed while an admin
 * take-down ran (so the take-down's storage.objects scan never saw it) is queued by the next rentals_photo_purge_due
 * run, due 30 days after the take-down but never in the run that queued it, and purged on a later run.
 *
 *   node src/test/pglite/homesPurgeLateUploads.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/homesPurgeLateUploads.pglite.mjs   # RED: the late upload is never queued
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/homesPurgeLateUploads.pglite.mjs
 *
 * The queue table is created from its own DDL in 20261019071203; rentals_photo_path_listing and the previous
 * rentals_photo_purge_due come from 20261019071203 too; the other tables are cut to the columns the function reads.
 * pglite is loaded from ~/.lh-pglite (CLAUDE.md).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SELF = readdirSync(MIG_DIR).find((f) => f.endsWith("_rentals_purge_sweeps_late_uploads.sql"));
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${SELF}`, "utf8");
const PRIVATE = readFileSync(`${MIG_DIR}20261019071203_rentals_listing_photos_private.sql`, "utf8");

/** The statement in PRIVATE that starts at `head` and ends at the first `;` after `endTag` (or the first `;`). */
function cut(head, endTag) {
  const at = PRIVATE.indexOf(head);
  if (at < 0) throw new Error(`not found in 20261019071203: ${head}`);
  const from = endTag ? PRIVATE.indexOf(endTag, PRIVATE.indexOf(endTag, at) + endTag.length) : at;
  return PRIVATE.slice(at, PRIVATE.indexOf(";", from) + 1);
}

let failures = 0;
const ok = (cond, name, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures++;
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA public, storage TO anon, authenticated, service_role;
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.rental_properties (id uuid PRIMARY KEY, owner_id uuid NOT NULL, listings_taken_down_at timestamptz,
  listings_taken_down_reason text);
CREATE TABLE public.rental_listings (id uuid PRIMARY KEY, property_id uuid NOT NULL, owner_id uuid NOT NULL,
  status text NOT NULL, removed_by_admin boolean NOT NULL DEFAULT false, removed_from_status text);
CREATE TABLE public.rental_listing_photos (listing_id uuid, storage_path text);
`);
await db.exec(cut("CREATE TABLE IF NOT EXISTS public.rental_photo_purge_queue"));
await db.exec(cut("CREATE OR REPLACE FUNCTION public.rentals_photo_path_listing", "$fn$"));
await db.exec(cut("CREATE OR REPLACE FUNCTION public.rentals_photo_purge_due", "$fn$"));
await db.exec(`REVOKE ALL ON FUNCTION public.rentals_photo_purge_due(integer) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.rentals_photo_purge_due(integer) TO service_role;`);
if (process.env.NEW_MIGRATION === "skip") console.log("NEW_MIGRATION=skip (expect FAILs)");
else for (let i = 0; i < 3; i++) await db.exec(MIGRATION); // replay-safe

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PROP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROP_OLD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROP_LIVE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const L_DOWN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // taken down 2 days ago
const L_OLD = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; // taken down 40 days ago
const L_LIVE = "ffffffff-ffff-4fff-8fff-ffffffffffff"; // never taken down
const path = (l, f, who = OWNER) => `${who}/rental-listings/${l}/${f}.jpg`;
const svc = async (sql, params) => (await db.query(sql, params)).rows;
const put = (p) => svc(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('listing-photos', $1, $2)`, [p, p.split("/")[0]]);
const entry = async (p) => (await svc(`SELECT due_at, claimed_at, reason FROM public.rental_photo_purge_queue WHERE bucket_id = 'listing-photos' AND storage_path = $1`, [p]))[0];
const due = async () => (await svc(`SELECT bucket_id, storage_path FROM public.rentals_photo_purge_due(500)`)).map((r) => r.storage_path);

await svc(`INSERT INTO public.rental_properties VALUES ($1, $4, now() - interval '2 days', 'spam'), ($2, $4, now() - interval '40 days', 'spam'), ($3, $4, NULL, NULL)`,
  [PROP, PROP_OLD, PROP_LIVE, OWNER]);
await svc(`INSERT INTO public.rental_listings VALUES ($1, $2, $5, 'removed', true, 'live'), ($3, $4, $5, 'removed', true, 'paused'), ($6, $7, $5, 'live', false, NULL)`,
  [L_DOWN, PROP, L_OLD, PROP_OLD, OWNER, L_LIVE, PROP_LIVE]);
// What the take-down scanned and queued (due 30 days after it), then what committed after its scan.
await put(path(L_DOWN, "seen"));
await svc(`INSERT INTO public.rental_photo_purge_queue (bucket_id, storage_path, due_at, reason) VALUES ('listing-photos', $1, now() + interval '28 days', 'take-down')`, [path(L_DOWN, "seen")]);
await put(path(L_DOWN, "late"));
await put(path(L_OLD, "late"));
await put(path(L_DOWN, "foreign", OTHER));
await put(path(L_LIVE, "live"));
await svc(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('job-photos', $1, $2)`, [path(L_DOWN, "jobbucket"), OWNER]);
await svc(`INSERT INTO public.rental_photo_purge_queue (bucket_id, storage_path, due_at, reason) VALUES ('job-photos', 'legacy/x.jpg', now() - interval '1 hour', 'legacy public listing photo')`);

{
  const out = await due();
  const late = await entry(path(L_DOWN, "late"));
  ok(late != null, "an upload that committed after the take-down's scan is queued by the next purge run", JSON.stringify(late));
  const days = late ? (new Date(late.due_at) - Date.now()) / 86400000 : NaN;
  ok(days > 27.5 && days < 28.5, "due 30 days after the take-down, like the take-down's own entries", `in ${days.toFixed(2)} days`);
  ok(late?.claimed_at == null && /late upload during take-down of listing/.test(late?.reason ?? ""), "unclaimed, with its reason", JSON.stringify(late));
  const old = await entry(path(L_OLD, "late"));
  const oldDays = old ? (new Date(old.due_at) - Date.now()) / 86400000 : NaN;
  ok(old != null && oldDays > 0.9 && oldDays < 1.1, "one under a take-down older than 30 days is due tomorrow, not at once", `in ${oldDays.toFixed(2)} days`);
  ok(!out.includes(path(L_OLD, "late")) && !out.includes(path(L_DOWN, "late")), "and the run that queued it never hands it out", JSON.stringify(out));
  ok(out.includes("legacy/x.jpg"), "a due job-photos entry is still handed out in the same run", JSON.stringify(out));
  ok((await entry(path(L_DOWN, "foreign", OTHER))) == null, "an object under the listing's id but another member's folder is not queued");
  ok((await entry(path(L_LIVE, "live"))) == null, "a listing that was never taken down: nothing queued");
  ok((await svc(`SELECT 1 FROM public.rental_photo_purge_queue WHERE bucket_id = 'job-photos' AND storage_path = $1`, [path(L_DOWN, "jobbucket")])).length === 0,
    "a job-photos object is not swept by this step");
  const seen = await entry(path(L_DOWN, "seen"));
  ok(seen && /^take-down$/.test(seen.reason), "the take-down's own entry is kept as it was", JSON.stringify(seen));
}
{
  // A day later (the late entry committed long ago): it is handed out once due.
  await svc(`UPDATE public.rental_photo_purge_queue SET due_at = now() - interval '1 minute' WHERE storage_path = $1`, [path(L_OLD, "late")]);
  const out = await due();
  ok(out.includes(path(L_OLD, "late")), "once due it is claimed and handed to the purge cron", JSON.stringify(out));
  const again = await entry(path(L_OLD, "late"));
  ok(again?.claimed_at != null, "its claim is kept on the next run (not re-queued over it)", JSON.stringify(again));
  await due();
  const kept = await entry(path(L_OLD, "late"));
  ok(kept?.claimed_at != null && String(kept.claimed_at) === String(again.claimed_at), "a later run leaves the claimed entry alone", JSON.stringify(kept));
}
{
  // A lift restores the listing: its late object is dropped and not re-queued.
  await svc(`UPDATE public.rental_listings SET removed_by_admin = false, status = 'paused' WHERE id = $1`, [L_DOWN]);
  await svc(`UPDATE public.rental_properties SET listings_taken_down_at = NULL WHERE id = $1`, [PROP]);
  await put(path(L_DOWN, "afterlift"));
  await due();
  ok((await entry(path(L_DOWN, "late"))) == null && (await entry(path(L_DOWN, "afterlift"))) == null,
    "after a lift the listing's objects are dropped from the queue and none is queued again");
}
{
  const g = await svc(`SELECT has_function_privilege('authenticated', 'public.rentals_photo_purge_due(integer)', 'EXECUTE') AS a,
                              has_function_privilege('anon', 'public.rentals_photo_purge_due(integer)', 'EXECUTE') AS b,
                              has_function_privilege('service_role', 'public.rentals_photo_purge_due(integer)', 'EXECUTE') AS c`);
  ok(g[0].a === false && g[0].b === false && g[0].c === true, "the purge stays server-only", JSON.stringify(g));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
