#!/usr/bin/env node
/**
 * PGlite proof for 20261123090717_proof_photos_attached_are_immutable (SEC-1123-01).
 *
 *   node src/test/pglite/proofPhotosAttachedAreImmutable.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/proofPhotosAttachedAreImmutable.pglite.mjs   # RED: prod's policies
 *
 * Fixture = disputeEvidenceImmutable.pglite.mjs's live-shaped proof-photos helpers, then 20260925141905 verbatim
 * (prod's UPDATE/DELETE policies, matching pg_policies read 2026-11-23), plus job_revisions. The new migration is
 * applied 3x, then, as each party with RLS on:
 *   - the poster cannot delete or overwrite the Helpr's attached after-photo, and the Helpr cannot touch the
 *     poster's attached revision photo (RED on prod: all four work);
 *   - the uploader cannot delete or overwrite their own photo once a job names it (path, or inside an old full URL);
 *   - the other party cannot delete an UNATTACHED object they did not upload;
 *   - the uploader can still delete their own unattached object (the e2e teardown: detach, then delete);
 *   - an object cannot be renamed onto an attached path; uploads, reads and the service role are unchanged.
 * pglite is not a dependency (CLAUDE.md): ~/.lh-pglite (override with PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const PRIOR = mig("20260925141905_dispute_evidence_immutable_to_parties.sql");
const NEW = mig("20261123090717_proof_photos_attached_are_immutable.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against prod's (unfixed) policies (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "11111111-0000-0000-0000-000000000001";
const HELPR = "11111111-0000-0000-0000-000000000002";
const JOB = "22222222-0000-0000-0000-000000000001";

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid,
  proof_before_urls text[], proof_after_urls text[]);
CREATE TABLE public.job_revisions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, photos text[] DEFAULT '{}'::text[]);
CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid,
  proof_before_urls text[], proof_after_urls text[]);
-- Neither table is readable by the caller here: the attached check must not depend on what the caller can see.
INSERT INTO public.jobs VALUES ('${JOB}', '${POSTER}', '${HELPR}', '{}', '{}');

CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text,
  name text, owner uuid, UNIQUE (bucket_id, name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;

-- Live storage.foldername.
CREATE OR REPLACE FUNCTION storage.foldername(name text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
    _parts text[];
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$function$;

-- Live is_party_to_job_folder (unchanged since 20260831171658; prod 2026-11-23).
CREATE OR REPLACE FUNCTION public.is_party_to_job_folder(object_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id::text = (storage.foldername(object_name))[1]
      AND (j.customer_id = auth.uid() OR j.helper_id = auth.uid())
  );
$function$;

CREATE POLICY "Users can read proof photos for their jobs" ON storage.objects FOR SELECT TO authenticated
  USING ((bucket_id = 'proof-photos'::text) AND (((auth.uid())::text = (storage.foldername(name))[1]) OR is_party_to_job_folder(name)));
CREATE POLICY "Users can upload proof photos to own folder" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'proof-photos'::text) AND (((auth.uid())::text = (storage.foldername(name))[1]) OR is_party_to_job_folder(name)));
`);
await db.exec(PRIOR);
if (!MODE) {
  for (let i = 0; i < 3; i++) await db.exec(NEW);
  check("applies 3x", true);
}

/** Run `sql` as `uid` (authenticated), inside a transaction that is rolled back; returns rows affected or the error. */
async function as(uid, sql) {
  await db.exec("BEGIN");
  try {
    await db.exec(`SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', true);`);
    const res = await db.query(sql);
    return { n: res.affectedRows ?? res.rows.length, rows: res.rows };
  } catch (e) {
    return { err: String(e.message ?? e) };
  } finally {
    await db.exec("ROLLBACK");
  }
}
async function asService(sql) {
  await db.exec("BEGIN");
  try {
    await db.exec(`SET LOCAL ROLE service_role;`);
    const res = await db.query(sql);
    return { n: res.affectedRows ?? 0 };
  } finally {
    await db.exec("ROLLBACK");
  }
}

const AFTER = `${JOB}/after-1763900000000-a.jpg`; // the Helpr's, attached by path
const BEFORE_URL = `${JOB}/before-1763900000000-b.jpg`; // the Helpr's, attached inside an old full URL
const REVISION = `${JOB}/revisions/1763900000000-c.jpg`; // the poster's, attached on a revision row
const LOOSE_HELPR = `${JOB}/after-1763900000001-d.jpg`; // the Helpr's, not attached (yet)
const LOOSE_POSTER = `${JOB}/revisions/1763900000001-e.jpg`; // the poster's, not attached
const CREW = `${JOB}/after-1763900000003-g.jpg`; // attached on a crew member's roster row (group_job_helpers)
await db.exec(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES
  ('proof-photos', '${AFTER}', '${HELPR}'), ('proof-photos', '${BEFORE_URL}', '${HELPR}'),
  ('proof-photos', '${REVISION}', '${POSTER}'), ('proof-photos', '${LOOSE_HELPR}', '${HELPR}'),
  ('proof-photos', '${LOOSE_POSTER}', '${POSTER}');
  UPDATE public.jobs SET proof_after_urls = ARRAY['${AFTER}'],
    proof_before_urls = ARRAY['https://example.supabase.co/storage/v1/object/sign/proof-photos/${BEFORE_URL}?token=x']
   WHERE id = '${JOB}';
  INSERT INTO public.job_revisions (job_id, photos) VALUES ('${JOB}', ARRAY['${REVISION}']);
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('proof-photos', '${CREW}', '${HELPR}');
  INSERT INTO public.group_job_helpers (job_id, helper_id, proof_after_urls) VALUES ('${JOB}', '${HELPR}', ARRAY['${CREW}']);`);

const del = (name) => `DELETE FROM storage.objects WHERE bucket_id='proof-photos' AND name='${name}'`;
const upd = (name) => `UPDATE storage.objects SET owner = owner WHERE bucket_id='proof-photos' AND name='${name}'`;
const n = async (uid, sql) => { const r = await as(uid, sql); return r.err ? `err: ${r.err}` : r.n; };
const zero = async (name, uid, sql) => { const v = await n(uid, sql); check(name, v === 0, `got ${v}`); };
const one = async (name, uid, sql) => { const v = await n(uid, sql); check(name, v === 1, `got ${v}`); };

await zero("the poster cannot delete the Helpr's attached after-photo", POSTER, del(AFTER));
await zero("the poster cannot overwrite the Helpr's attached after-photo", POSTER, upd(AFTER));
await zero("the Helpr cannot delete the poster's attached revision photo", HELPR, del(REVISION));
await zero("the Helpr cannot overwrite the poster's attached revision photo", HELPR, upd(REVISION));
await zero("the uploader cannot delete their own attached photo", HELPR, del(AFTER));
await zero("the uploader cannot overwrite their own attached photo", HELPR, upd(AFTER));
await zero("a photo attached inside an old full URL is locked too", HELPR, del(BEFORE_URL));
await zero("a crew member's attached proof (group_job_helpers) is locked too", HELPR, del(CREW));
await zero("the poster cannot delete the Helpr's unattached upload", POSTER, del(LOOSE_HELPR));
await zero("the Helpr cannot delete the poster's unattached upload", HELPR, del(LOOSE_POSTER));
await one("the uploader can still delete their own unattached photo (e2e teardown)", HELPR, del(LOOSE_HELPR));
await one("the uploader can still update their own unattached photo", POSTER, upd(LOOSE_POSTER));
const onto = await as(POSTER, `UPDATE storage.objects SET name='${REVISION}x' WHERE bucket_id='proof-photos' AND name='${LOOSE_POSTER}'`);
check("the uploader can rename their own unattached photo to a free path", !onto.err && onto.n === 1, onto.err ?? `n=${onto.n}`);
const up = await as(HELPR, `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('proof-photos', '${JOB}/after-1763900000002-f.jpg', '${HELPR}')`);
check("uploading a proof photo still works", up.n === 1, up.err ?? "");
check("the poster can still read the Helpr's after-photo",
  (await as(POSTER, `SELECT 1 FROM storage.objects WHERE bucket_id='proof-photos' AND name='${AFTER}'`)).rows?.length === 1);
check("the service role can still delete an attached photo (purge, orphan sweep)", (await asService(del(AFTER))).n === 1);
if (!MODE) {
  const g = (await db.query(`SELECT has_function_privilege('anon', 'public.proof_photo_object_attached(text)', 'EXECUTE') AS a,
    has_function_privilege('authenticated', 'public.proof_photo_object_attached(text)', 'EXECUTE') AS u`)).rows[0];
  check("proof_photo_object_attached: callable by authenticated (the policy runs as the caller), not anon", g && !g.a && g.u, JSON.stringify(g));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
