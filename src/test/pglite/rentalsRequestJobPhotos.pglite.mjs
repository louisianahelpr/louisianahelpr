#!/usr/bin/env node
/**
 * Q2058 PGlite proof for 20261106215556_rentals_request_job_photos: the tenant (and the landlord) of a repair
 * request read the Helpr's before/after photos of its FUNDED job, and the tenant may sign exactly those storage
 * objects, nothing else in the job's folder (dispute evidence lives there too). The tenant's access lasts while the
 * request's tenancy is active and for 90 days after it ends (owner, 11-06); the landlord's does not end.
 *
 *   node src/test/pglite/rentalsRequestJobPhotos.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/rentalsRequestJobPhotos.pglite.mjs   # RED: no read, no policy
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/rentalsRequestJobPhotos.pglite.mjs
 *
 * The jobs / group_job_helpers / maintenance_requests tables are cut to the columns these functions read; the
 * Homes switch is a stub table. pglite is loaded from ~/.lh-pglite (CLAUDE.md).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261106215556_rentals_request_job_photos.sql`, "utf8");

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
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA auth, storage, public TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON storage.objects TO authenticated;

CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, status text, payment_status text,
  proof_before_urls text[], proof_after_urls text[]);
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid, proof_before_urls text[], proof_after_urls text[]);
CREATE TABLE public.rental_tenancies (id uuid PRIMARY KEY, tenant_id uuid, status text, ended_at timestamptz);
CREATE TABLE public.maintenance_requests (id uuid PRIMARY KEY, tenant_id uuid, landlord_id uuid, job_id uuid, tenancy_id uuid);
CREATE TABLE public.switch_off (user_id uuid);
CREATE FUNCTION public.feature_enabled_for_user(k text, u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT k = 'rentals' AND u IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.switch_off s WHERE s.user_id = u) $$;
CREATE FUNCTION public.require_feature(k text) RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF NOT public.feature_enabled_for_user(k, auth.uid()) THEN RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501'; END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.feature_enabled_for_user(text, uuid), public.require_feature(text) TO authenticated;

-- The job parties' existing read (20260925154606, crew branch left out): unchanged by this migration.
CREATE FUNCTION public.is_party_to_job_folder(object_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id::text = (storage.foldername(object_name))[1]
                  AND (j.customer_id = auth.uid() OR j.helper_id = auth.uid())) $$;
GRANT EXECUTE ON FUNCTION public.is_party_to_job_folder(text) TO authenticated;
CREATE POLICY "Users can read proof photos for their jobs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'proof-photos' AND (((select auth.uid()))::text = (storage.foldername(name))[1] OR public.is_party_to_job_folder(name)));
`);
if (process.env.NEW_MIGRATION === "skip") console.log("NEW_MIGRATION=skip (expect FAILs)");
else for (let i = 0; i < 3; i++) await db.exec(MIGRATION); // replay-safe

const TENANT = "11111111-1111-4111-8111-111111111111";
const LANDLORD = "22222222-2222-4222-8222-222222222222";
const HELPR = "33333333-3333-4333-8333-333333333333";
const CREW = "44444444-4444-4444-8444-444444444444";
const STRANGER = "55555555-5555-4555-8555-555555555555";
const OTHER_TENANT = "66666666-6666-4666-8666-666666666666";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_JOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UNPAID_JOB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REQ = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const UNPAID_REQ = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OTHER_REQ = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const B1 = `${JOB}/${HELPR}/before-1.jpg`;
const A1 = `${JOB}/${HELPR}/after-1.jpg`;
const CB = `${JOB}/${CREW}/before-crew.jpg`;
const CA = `${JOB}/${CREW}/after-crew.jpg`;
const EVIDENCE = `${JOB}/${LANDLORD}/dispute-evidence.jpg`;
const FOREIGN = `${OTHER_JOB}/${HELPR}/before-other.jpg`;
const UNPAID_PHOTO = `${UNPAID_JOB}/${HELPR}/before-unpaid.jpg`;

const svc = async (sql, params) => (await db.query(sql, params)).rows;
await svc(`INSERT INTO public.jobs VALUES ($1, $2, $3, 'completed', 'released', $4, $5)`,
  [JOB, LANDLORD, HELPR, [B1, FOREIGN, "https://evil.example/x.jpg", `${JOB}/../${OTHER_JOB}/x.jpg`, ""], [A1]]);
await svc(`INSERT INTO public.jobs VALUES ($1, $2, $3, 'completed', 'released', $4, '{}')`, [OTHER_JOB, STRANGER, HELPR, [FOREIGN]]);
await svc(`INSERT INTO public.jobs VALUES ($1, $2, $3, 'open', 'unpaid', $4, '{}')`, [UNPAID_JOB, LANDLORD, HELPR, [UNPAID_PHOTO]]);
await svc(`INSERT INTO public.group_job_helpers VALUES ($1, $2, $3, $4)`, [JOB, CREW, [CB], [CA]]);
const TENANCY = "99999999-9999-4999-8999-999999999991";
const OTHER_TENANCY = "99999999-9999-4999-8999-999999999992";
await svc(`INSERT INTO public.rental_tenancies VALUES ($1, $2, 'active', NULL), ($3, $4, 'active', NULL)`, [TENANCY, TENANT, OTHER_TENANCY, OTHER_TENANT]);
await svc(`INSERT INTO public.maintenance_requests VALUES ($1, $2, $3, $4, $11), ($5, $2, $3, $6, $11), ($7, $8, $9, $10, $12)`,
  [REQ, TENANT, LANDLORD, JOB, UNPAID_REQ, UNPAID_JOB, OTHER_REQ, OTHER_TENANT, STRANGER, OTHER_JOB, TENANCY, OTHER_TENANCY]);
for (const name of [B1, A1, CB, CA, EVIDENCE, FOREIGN, UNPAID_PHOTO]) await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('proof-photos', $1)`, [name]);
// The same name in another bucket: the tenant's policy is for proof-photos only.
await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('user-documents', $1)`, [B1]);

async function as(role, uid, sql, params) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE ${role};`);
    return (await db.query(sql, params)).rows;
  } catch (e) {
    return { error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const photos = (uid, req = REQ, role = "authenticated") => as(role, uid, `SELECT kind, photo_path FROM public.rentals_request_job_photos($1)`, [req]);
const signable = async (uid) => {
  const r = await as("authenticated", uid, `SELECT name FROM storage.objects ORDER BY name`);
  return Array.isArray(r) ? r.map((x) => x.name) : r;
};
const show = (r) => JSON.stringify(Array.isArray(r) ? r.map((x) => `${x.kind}:${x.photo_path.split("/").pop()}`) : r);
const want = [`before:${B1}`, `before:${CB}`, `after:${A1}`, `after:${CA}`].sort();
const got = (r) => (Array.isArray(r) ? r.map((x) => `${x.kind}:${x.photo_path}`).sort() : r);

// The read.
{
  const t = await photos(TENANT);
  ok(JSON.stringify(got(t)) === JSON.stringify(want), "the tenant reads the funded job's before/after photos, the crew's included", show(t));
  const l = await photos(LANDLORD);
  ok(JSON.stringify(got(l)) === JSON.stringify(want), "the landlord reads the same photos", show(l));
  ok(Array.isArray(t) && !t.some((x) => /evil|\.\.|other/.test(x.photo_path)),
    "never a URL, a '..' path, or a path under another job's id", show(t));
  const s = await photos(STRANGER);
  ok(Array.isArray(s) && s.length === 0, "someone else's request: nothing", show(s));
  const o = await photos(OTHER_TENANT);
  ok(Array.isArray(o) && o.length === 0, "the tenant of another request: nothing", show(o));
  const u = await photos(TENANT, UNPAID_REQ);
  ok(Array.isArray(u) && u.length === 0, "a job that was never paid: nothing", show(u));
  await svc(`UPDATE public.jobs SET status = 'cancelled' WHERE id = $1`, [JOB]);
  const c = await photos(TENANT);
  ok(Array.isArray(c) && c.length === 0, "a cancelled job: nothing", show(c));
  await svc(`UPDATE public.jobs SET status = 'completed' WHERE id = $1`, [JOB]);
  await svc(`INSERT INTO public.switch_off VALUES ($1)`, [TENANT]);
  const off = await photos(TENANT);
  ok(!Array.isArray(off) && /feature_disabled/.test(off.error), "the Homes switch off: refused (feature_disabled)", show(off));
  await svc(`DELETE FROM public.switch_off`);
  const anon = await photos(null, REQ, "anon");
  ok(!Array.isArray(anon) && /permission denied/.test(anon.error), "a signed-out caller is refused (EXECUTE revoked from anon)", show(anon));
  const inner = await as("authenticated", TENANT, `SELECT * FROM public.rentals_request_photo_rows($1)`, [REQ]);
  ok(!Array.isArray(inner) && /permission denied/.test(inner.error), "the internal photo list is not callable by a member", show(inner));
}

// The storage read (signing a URL needs SELECT on the object).
{
  const t = await signable(TENANT);
  ok(JSON.stringify(t) === JSON.stringify([A1, B1, CA, CB].sort()), "the tenant can sign exactly the four listed proof-photos objects (not the same name in another bucket)", JSON.stringify(t));
  ok(Array.isArray(t) && !t.includes(EVIDENCE), "not the dispute evidence in the same job folder");
  ok(Array.isArray(t) && !t.includes(FOREIGN) && !t.includes(UNPAID_PHOTO), "not another job's photo, nor the unpaid job's");
  const l = await signable(LANDLORD);
  ok(Array.isArray(l) && l.includes(EVIDENCE) && l.includes(B1) && l.includes(UNPAID_PHOTO), "the landlord keeps the job party's read (unchanged)", JSON.stringify(l?.length));
  const s = await signable(STRANGER);
  ok(Array.isArray(s) && !s.includes(B1) && !s.includes(A1), "a stranger signs none of this job's photos", JSON.stringify(s));
  await svc(`INSERT INTO public.switch_off VALUES ($1)`, [TENANT]);
  const off = await signable(TENANT);
  ok(Array.isArray(off) && off.length === 0, "the Homes switch off: the tenant signs nothing", JSON.stringify(off));
  await svc(`DELETE FROM public.switch_off`);
  await svc(`UPDATE public.jobs SET payment_status = 'unpaid' WHERE id = $1`, [JOB]);
  const unfunded = await signable(TENANT);
  ok(Array.isArray(unfunded) && unfunded.length === 0, "once the job is not funded, the tenant signs nothing", JSON.stringify(unfunded));
}

// The tenant's window (owner, 11-06): the tenancy active, or ended less than 90 days ago. The landlord keeps access.
{
  await svc(`UPDATE public.jobs SET payment_status = 'released' WHERE id = $1`, [JOB]);
  const end = (agoMs) => svc(`UPDATE public.rental_tenancies SET status = 'ended', ended_at = now() - make_interval(secs => $2::double precision / 1000) WHERE id = $1`, [TENANCY, agoMs]);
  const D = 24 * 3_600_000;
  const n = async (uid) => { const r = await photos(uid); return Array.isArray(r) ? r.length : r; };
  const s = async (uid) => { const r = await signable(uid); return Array.isArray(r) ? r.filter((x) => x.startsWith(JOB)).length : r; };
  ok(await n(TENANT) === 4 && await s(TENANT) === 4, "tenancy active: the tenant reads and signs the photos");
  await end(89 * D);
  ok(await n(TENANT) === 4 && await s(TENANT) === 4, "tenancy ended 89 days ago: still inside the window");
  await end(90 * D + 60_000);
  ok(await n(TENANT) === 0, "tenancy ended over 90 days ago: the tenant reads nothing", String(await n(TENANT)));
  ok(await s(TENANT) === 0, "and signs nothing", String(await s(TENANT)));
  ok(await n(LANDLORD) === 4 && (await signable(LANDLORD)).includes(B1), "the landlord keeps access after the window");
  await svc(`UPDATE public.rental_tenancies SET status = 'active', ended_at = NULL WHERE id = $1`, [TENANCY]);
  await svc(`UPDATE public.maintenance_requests SET tenancy_id = NULL WHERE id = $1`, [REQ]);
  ok(await n(TENANT) === 0 && await s(TENANT) === 0, "a request whose tenancy is gone (deleted): the tenant reads and signs nothing");
  await svc(`UPDATE public.maintenance_requests SET tenancy_id = $2 WHERE id = $1`, [REQ, TENANCY]);
  await svc(`UPDATE public.rental_tenancies SET tenant_id = $2 WHERE id = $1`, [TENANCY, OTHER_TENANT]);
  ok(await n(TENANT) === 0, "a tenancy that is now someone else's: nothing");
  await svc(`UPDATE public.rental_tenancies SET tenant_id = $2 WHERE id = $1`, [TENANCY, TENANT]);
  const inner = await as("authenticated", TENANT, `SELECT public.rentals_request_tenant_window_open($1, $2)`, [REQ, TENANT]);
  ok(!Array.isArray(inner) && /permission denied/.test(inner.error), "the window check is not callable by a member", JSON.stringify(inner));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
