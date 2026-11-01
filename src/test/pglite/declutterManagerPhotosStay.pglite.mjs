#!/usr/bin/env node
/**
 * PGlite proof for *_declutter_manager_photos_stay (manager mode, lead condition 1 on the phase 1 verdict): a photo a
 * manager uploaded to their own folder and attached to the seller's listing cannot be deleted by the manager, during
 * or after the grant; an unattached upload still can; the seller's own rule is unchanged.
 *
 *   npx tsx src/test/pglite/declutterManagerPhotosStay.pglite.mjs                 # the migration applied 3x
 *   NEW_MIGRATION=skip npx tsx src/test/pglite/declutterManagerPhotosStay.pglite.mjs   # RED: the policy before it
 *   PLANT=rls npx tsx ...    # the helper runs as the caller (SECURITY INVOKER): RED
 *
 * World: storage.objects with RLS on and a storage.foldername like Supabase's, the NEWEST real "Sellers delete own
 * unattached declutter photos" policy before this migration (SKIP) or this migration's, and declutter_item_photos
 * with RLS that lets only the seller read her rows (the manager reads none, as once the grant ends). Statements run
 * as role authenticated with request.jwt.claim.sub set, so the policies are what decides.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const FILE = FILES.find((f) => f.endsWith("_declutter_manager_photos_stay.sql"));
const SKIP = process.env.NEW_MIGRATION === "skip";
const PLANT = process.env.PLANT ?? "";
let FIX = readFileSync(DIR + FILE, "utf8");
if (PLANT === "rls") {
  if (!FIX.includes("STABLE\nSECURITY DEFINER")) throw new Error("PLANT=rls: not found");
  FIX = FIX.replace("STABLE\nSECURITY DEFINER", "STABLE\nSECURITY INVOKER");
  console.log("PLANT=rls: planted");
}
// The newest CREATE POLICY of the declutter delete policy in a migration BEFORE this one.
const POLICY = '"Sellers delete own unattached declutter photos"';
let OLD = "";
for (const f of FILES.filter((f) => f < FILE)) {
  const s = readFileSync(DIR + f, "utf8");
  const i = s.lastIndexOf(`CREATE POLICY ${POLICY}`);
  if (i >= 0) OLD = s.slice(i, s.indexOf(";", i) + 1);
}
if (!OLD) throw new Error("no earlier policy");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const K = U(1), M = U(2), ITEM = U(50);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema storage;
  create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create function storage.foldername(name text) returns text[] language sql immutable as $f$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $f$;
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create policy "read all" on storage.objects for select to authenticated using (true);
  grant usage on schema storage, auth, public to authenticated;
  grant select, delete on storage.objects to authenticated;
  create table public.declutter_item_photos (id uuid primary key default gen_random_uuid(), item_id uuid, seller_id uuid, storage_path text);
  alter table public.declutter_item_photos enable row level security;
  create policy "seller reads" on public.declutter_item_photos for select to authenticated using (seller_id = auth.uid());
  grant select on public.declutter_item_photos to authenticated;
  ${OLD}
`);
if (!SKIP) {
  for (let i = 0; i < 3; i++) await db.exec(FIX);
  console.log(`applied ${FILE} 3x`);
} else console.log("NEW_MIGRATION=skip: the policy before this migration (expect FAILs)");

const attached = `${M}/declutter/${ITEM}/a.jpg`, loose = `${M}/declutter/${ITEM}/b.jpg`, hers = `${K}/declutter/${ITEM}/c.jpg`, hersLoose = `${K}/declutter/${ITEM}/d.jpg`;
await db.exec(`
  insert into storage.objects (bucket_id, name, owner) values ('job-photos', '${attached}', '${M}'), ('job-photos', '${loose}', '${M}'),
    ('job-photos', '${hers}', '${K}'), ('job-photos', '${hersLoose}', '${K}');
  insert into public.declutter_item_photos (item_id, seller_id, storage_path) values ('${ITEM}', '${K}', '${attached}'), ('${ITEM}', '${K}', '${hers}');
`);
async function delAs(user, name) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;`);
  try {
    const r = await db.query(`delete from storage.objects where bucket_id = 'job-photos' and name = $1 returning id`, [name]);
    return r.rows.length;
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
const exists = async (name) => (await db.query(`select 1 from storage.objects where name = $1`, [name])).rows.length === 1;

check("P1 the manager cannot delete their upload that is on the seller's listing (they cannot read her photo rows)",
  (await delAs(M, attached)) === 0 && (await exists(attached)));
check("P2 the manager still deletes their own upload that no listing uses", (await delAs(M, loose)) === 1 && !(await exists(loose)));
check("P3 the seller cannot delete her attached photo (unchanged)", (await delAs(K, hers)) === 0 && (await exists(hers)));
check("P4 the seller deletes her unattached photo (unchanged)", (await delAs(K, hersLoose)) === 1);
check("P5 nobody deletes in another person's folder (the seller cannot delete the manager's file)", (await delAs(K, attached)) === 0 && (await exists(attached)));
await db.exec(`delete from public.declutter_item_photos where storage_path = '${attached}'`);
check("P6 once the seller takes it off the listing, the manager may delete their own file", (await delAs(M, attached)) === 1);
if (!SKIP) {
  const priv = (await db.query(`select has_function_privilege('anon', 'public.declutter_photo_object_attached(text)', 'EXECUTE') as a`)).rows[0];
  check("P7 anon does not run the helper", priv.a === false, JSON.stringify(priv));
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
