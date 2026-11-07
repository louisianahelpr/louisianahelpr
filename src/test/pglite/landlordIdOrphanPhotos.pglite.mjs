#!/usr/bin/env node
/**
 * Q2202 PGlite proof for 20261107033253_landlord_id_orphan_photos: landlord_id_orphan_photos lists a landlord ID photo
 * that no review row names once it is a day old (the app died between the upload and rentals_submit_landlord_id), and
 * never a photo the review names, a fresh upload, another folder's object or another bucket's.
 *
 *   node src/test/pglite/landlordIdOrphanPhotos.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/landlordIdOrphanPhotos.pglite.mjs   # RED: no such read
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/landlordIdOrphanPhotos.pglite.mjs
 *
 * storage.objects and landlord_id_reviews are cut to the columns the read touches. pglite from ~/.lh-pglite.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SELF = readdirSync(MIG_DIR).find((f) => f.endsWith("_landlord_id_orphan_photos.sql"));
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${SELF}`, "utf8");

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
-- Supabase grants every new public function to these roles by default; the REVOKE must undo it.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, created_at timestamptz);
CREATE TABLE public.landlord_id_reviews (user_id uuid PRIMARY KEY, front_path text, back_path text);
`);
if (process.env.NEW_MIGRATION === "skip") console.log("NEW_MIGRATION=skip (expect FAILs)");
else for (let i = 0; i < 3; i++) await db.exec(MIGRATION); // replay-safe

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
await db.query(`INSERT INTO public.landlord_id_reviews VALUES ($1, $2, $3), ($4, NULL, NULL)`,
  [U1, `${U1}/landlord-id/1-front.jpg`, `${U1}/landlord-id/1-back.jpg`, U2]);
const old = "now() - interval '3 days'";
await db.exec(`INSERT INTO storage.objects (bucket_id, name, created_at) VALUES
  ('user-documents', '${U1}/landlord-id/1-front.jpg', ${old}),
  ('user-documents', '${U1}/landlord-id/1-back.jpg', ${old}),
  ('user-documents', '${U1}/landlord-id/0-front-crash.jpg', ${old}),
  ('user-documents', '${U2}/landlord-id/5-front.jpg', ${old}),
  ('user-documents', '${U3}/landlord-id/7-front.jpg', ${old}),
  ('user-documents', '${U3}/landlord-id/8-front-fresh.jpg', now() - interval '2 hours'),
  ('user-documents', '${U3}/ownership/deed.pdf', ${old}),
  ('rentals', '${U3}/landlord-id/9-front.jpg', ${old}),
  ('user-documents', '${U1}/landlord-id/1-front.jpg-other-user-ref', ${old}),
  ('user-documents', '${U2}/landlord-id/1-front-of-u1.jpg', ${old})`);
// U2's row names a U1 path: it must not shelter U1's object, nor make U2's own object named.
await db.query(`UPDATE public.landlord_id_reviews SET front_path = $2 WHERE user_id = $1`, [U2, `${U1}/landlord-id/0-front-crash.jpg`]);

const svc = async (sql) => {
  try {
    await db.exec(`SET ROLE service_role;`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE;`);
  }
};
const rows = await svc(`SELECT name FROM public.landlord_id_orphan_photos(24, 500)`);
const names = Array.isArray(rows) ? rows.map((r) => r.name).sort() : rows;
const expected = [
  `${U1}/landlord-id/0-front-crash.jpg`,
  `${U1}/landlord-id/1-front.jpg-other-user-ref`,
  `${U2}/landlord-id/1-front-of-u1.jpg`,
  `${U2}/landlord-id/5-front.jpg`,
  `${U3}/landlord-id/7-front.jpg`,
].sort();
ok(JSON.stringify(names) === JSON.stringify(expected), "lists exactly the day-old landlord-id photos no own review names", JSON.stringify(names));
ok(Array.isArray(names) && !names.includes(`${U1}/landlord-id/1-front.jpg`) && !names.includes(`${U1}/landlord-id/1-back.jpg`),
  "never a photo the landlord's own review names");
ok(Array.isArray(names) && !names.includes(`${U3}/landlord-id/8-front-fresh.jpg`), "never an upload under a day old (its submit may be on its way)");
ok(Array.isArray(names) && !names.some((n) => n.includes("/ownership/")), "never another folder's object");
ok(Array.isArray(names) && names.length === expected.length, "never another bucket's object");
const zero = await svc(`SELECT count(*)::int AS n FROM public.landlord_id_orphan_photos(0, 500)`);
ok(Array.isArray(zero) && zero[0].n === 0, "an age under an hour lists nothing (no same-minute sweep)", JSON.stringify(zero));
const capped = await svc(`SELECT count(*)::int AS n FROM public.landlord_id_orphan_photos(24, 2)`);
ok(Array.isArray(capped) && capped[0].n === 2, "the limit is honoured", JSON.stringify(capped));
const g = await svc(`SELECT has_function_privilege('authenticated', 'public.landlord_id_orphan_photos(integer, integer)', 'EXECUTE') AS member,
                           has_function_privilege('anon', 'public.landlord_id_orphan_photos(integer, integer)', 'EXECUTE') AS anon`);
ok(Array.isArray(g) && g[0].member === false && g[0].anon === false, "service_role only: members and signed-out callers cannot call it", JSON.stringify(g));

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
