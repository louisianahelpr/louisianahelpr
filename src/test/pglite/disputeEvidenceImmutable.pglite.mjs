#!/usr/bin/env node
/**
 * PGlite proof for 20260925141905_dispute_evidence_immutable_to_parties.
 *
 *   node src/test/pglite/disputeEvidenceImmutable.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/disputeEvidenceImmutable.pglite.mjs   # RED: live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the LIVE proof-photos policies and helpers (pg_policies,
 * pg_get_functiondef of storage.foldername and is_party_to_job_folder,
 * 2026-09-25), RLS on storage.objects. The migration is applied 3x, then as
 * an authenticated party:
 *   - their own dispute evidence `<uid>/disputes/<job>/<file>` cannot be
 *     deleted or overwritten (RED on live: both work);
 *   - the other party cannot touch it either;
 *   - a non-dispute object cannot be renamed INTO a disputes path;
 *   - their own before/after proof photos (`<uid>/…` and `<jobId>/…`) can
 *     still be updated and deleted (the e2e teardown's path);
 *   - uploading evidence and reading it back still work;
 *   - the service role (account purge, orphan sweep) can still delete it.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(
  new URL("../../../supabase/migrations/20260925141905_dispute_evidence_immutable_to_parties.sql", import.meta.url).pathname,
  "utf8",
);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

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
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin','customer','helper');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE OR REPLACE FUNCTION public.has_role(_uid uuid, _role public.app_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = _role) $$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid,
  proof_before_urls text[], proof_after_urls text[]);
GRANT SELECT ON public.jobs TO authenticated;
INSERT INTO public.jobs VALUES ('${JOB}', '${POSTER}', '${HELPR}', '{}', '{}');

CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text,
  name text, owner uuid, UNIQUE (bucket_id, name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;

-- Live storage.foldername (pg_get_functiondef 2026-09-25).
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

-- Live is_party_to_job_folder (pg_get_functiondef 2026-09-25).
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

-- The five live proof-photos policies (pg_policies 2026-09-25).
CREATE POLICY "Job participants can view proof photos" ON storage.objects FOR SELECT TO public
  USING ((bucket_id = 'proof-photos'::text) AND (has_role(auth.uid(), 'admin'::app_role)
    OR ((auth.uid())::text = (storage.foldername(name))[1])
    OR (EXISTS ( SELECT 1 FROM jobs WHERE (((jobs.customer_id = auth.uid()) OR (jobs.helper_id = auth.uid()))
      AND ((objects.name = ANY (jobs.proof_before_urls)) OR (objects.name = ANY (jobs.proof_after_urls))))))));
CREATE POLICY "Users can delete their own proof photos" ON storage.objects FOR DELETE TO authenticated
  USING ((bucket_id = 'proof-photos'::text) AND (((auth.uid())::text = (storage.foldername(name))[1]) OR is_party_to_job_folder(name)));
CREATE POLICY "Users can read proof photos for their jobs" ON storage.objects FOR SELECT TO authenticated
  USING ((bucket_id = 'proof-photos'::text) AND (((auth.uid())::text = (storage.foldername(name))[1]) OR is_party_to_job_folder(name)));
CREATE POLICY "Users can update their own proof photos" ON storage.objects FOR UPDATE TO authenticated
  USING ((bucket_id = 'proof-photos'::text) AND (((auth.uid())::text = (storage.foldername(name))[1]) OR is_party_to_job_folder(name)));
CREATE POLICY "Users can upload proof photos to own folder" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'proof-photos'::text) AND (((auth.uid())::text = (storage.foldername(name))[1]) OR is_party_to_job_folder(name)));
`);

if (!MODE) {
  for (let i = 0; i < 3; i++) await db.exec(NEW);
  check("applies 3x", true);
}

const EVIDENCE = `${HELPR}/disputes/${JOB}/1758800000000-a.jpg`;
const OWN_PROOF = `${HELPR}/before-1758800000000.jpg`;
const JOB_PROOF = `${JOB}/after-1758800000000.jpg`;

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

// Seed the objects (as the table owner, as an upload would leave them).
await db.exec(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES
  ('proof-photos', '${EVIDENCE}', '${HELPR}'),
  ('proof-photos', '${OWN_PROOF}', '${HELPR}'),
  ('proof-photos', '${JOB_PROOF}', '${HELPR}');`);

const del = (name) => `DELETE FROM storage.objects WHERE bucket_id='proof-photos' AND name='${name}'`;
const upd = (name) => `UPDATE storage.objects SET owner = owner WHERE bucket_id='proof-photos' AND name='${name}'`;

check("the filer cannot delete their dispute evidence", (await as(HELPR, del(EVIDENCE))).n === 0);
check("the filer cannot overwrite their dispute evidence", (await as(HELPR, upd(EVIDENCE))).n === 0);
check("the other party cannot delete it", (await as(POSTER, del(EVIDENCE))).n === 0);
const moved = await as(HELPR, `UPDATE storage.objects SET name='${HELPR}/disputes/${JOB}/swapped.jpg'
  WHERE bucket_id='proof-photos' AND name='${OWN_PROOF}'`);
check("a proof photo cannot be renamed into a disputes path", !!moved.err || moved.n === 0, moved.err ?? `n=${moved.n}`);

check("own before/after proof photo can still be updated", (await as(HELPR, upd(OWN_PROOF))).n === 1);
check("own before/after proof photo can still be deleted", (await as(HELPR, del(OWN_PROOF))).n === 1);
check("a party can still delete a <jobId>/ proof photo (e2e teardown path)", (await as(HELPR, del(JOB_PROOF))).n === 1);

const up = await as(HELPR, `INSERT INTO storage.objects (bucket_id, name, owner)
  VALUES ('proof-photos', '${HELPR}/disputes/${JOB}/1758800000001-b.jpg', '${HELPR}')`);
check("uploading new evidence still works", up.n === 1, up.err ?? "");
check("the filer can still read their evidence", (await as(HELPR,
  `SELECT 1 FROM storage.objects WHERE bucket_id='proof-photos' AND name='${EVIDENCE}'`)).rows.length === 1);
check("the service role can still delete it (purge, orphan sweep)", (await asService(del(EVIDENCE))).n === 1);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
