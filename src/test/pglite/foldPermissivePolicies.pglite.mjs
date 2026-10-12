#!/usr/bin/env node
/**
 * PGlite proof for 20261012193325_fold_redundant_permissive_policies (Q1321):
 * folding the overlapping permissive policies on job_pets and
 * verification_exceptions changes NOTHING about who may read or write.
 *
 *   node src/test/pglite/foldPermissivePolicies.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite.
 *
 * Fixture = the LIVE policies, verbatim from pg_policies (read 2026-10-12;
 * job_pets' were last altered by 20260823160000, verification_exceptions' by
 * 20260701100000's ALTER POLICY and 20260826200000). The proof runs a full
 * permission matrix (every actor x SELECT / INSERT / UPDATE / DELETE) on the
 * live policies, applies the migration 3x, runs the same matrix and requires
 * it to be IDENTICAL, then counts the overlaps the advisor reports.
 * NOT modelled: RLS on jobs / pet_profiles (both states read them through the
 * same subqueries), column grants.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/20261012193325_fold_redundant_permissive_policies.sql", import.meta.url).pathname;

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const POSTER = "bbbbbbbb-0000-4000-8000-000000000001";
const HELPER = "bbbbbbbb-0000-4000-8000-000000000002";
const STRANGER = "bbbbbbbb-0000-4000-8000-000000000003";
const JOB = "dddddddd-0000-4000-8000-000000000001";
const OTHER_JOB = "dddddddd-0000-4000-8000-000000000002";
const PET = "eeeeeeee-0000-4000-8000-000000000001"; // the poster's pet
const STRANGERS_PET = "eeeeeeee-0000-4000-8000-000000000002";
const NOBODY = "bbbbbbbb-0000-4000-8000-000000000004"; // party to no job at all

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid);
CREATE TABLE public.pet_profiles (id uuid PRIMARY KEY, owner_id uuid);
CREATE TABLE public.job_pets (job_id uuid, pet_id uuid);
CREATE TABLE public.verification_exceptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, exception_type text NOT NULL DEFAULT 'other', notes text);
GRANT SELECT ON public.jobs, public.pet_profiles, public.user_roles TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_pets, public.verification_exceptions TO anon, authenticated;
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.jobs VALUES ('${JOB}', '${POSTER}', '${HELPER}'), ('${OTHER_JOB}', '${STRANGER}', NULL);
INSERT INTO public.pet_profiles VALUES ('${PET}', '${POSTER}'), ('${STRANGERS_PET}', '${STRANGER}');
ALTER TABLE public.job_pets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_exceptions ENABLE ROW LEVEL SECURITY;

-- LIVE policies, verbatim from pg_policies 2026-10-12.
CREATE POLICY "Assigned helper reads the pets on their job" ON public.job_pets FOR SELECT TO public
  USING ((EXISTS ( SELECT 1 FROM jobs j WHERE ((j.id = job_pets.job_id) AND (j.helper_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "Poster manages the pets on their job" ON public.job_pets FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM jobs j WHERE ((j.id = job_pets.job_id) AND (j.customer_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK (((EXISTS ( SELECT 1 FROM jobs j WHERE ((j.id = job_pets.job_id) AND (j.customer_id = ( SELECT auth.uid() AS uid))))) AND (EXISTS ( SELECT 1 FROM pet_profiles p WHERE ((p.id = job_pets.pet_id) AND (p.owner_id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY "Admins can manage verification exceptions" ON public.verification_exceptions FOR ALL TO authenticated
  USING (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role)) WITH CHECK (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY "Admins manage exceptions" ON public.verification_exceptions FOR ALL TO public
  USING ((( SELECT auth.role() AS role) = 'service_role'::text));
CREATE POLICY "Users see own exceptions" ON public.verification_exceptions FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));
`);

async function as(role, uid, jwtRole, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${uid}', false), set_config('request.role', '${jwtRole}', false);`);
  await db.exec("SAVEPOINT op");
  await db.exec(`SET ROLE ${role}`);
  try { const r = await db.query(sql); return /^\s*SELECT\b|\bRETURNING\b/i.test(sql) ? r.rows.length : (r.affectedRows ?? 0); }
  catch (e) { await db.exec("ROLLBACK TO SAVEPOINT op"); return `ERR ${e.message.split("\n")[0]}`; }
  finally { await db.exec("RESET ROLE"); }
}

const ACTORS = [
  ["poster", "authenticated", POSTER, "authenticated"],
  ["assigned helper", "authenticated", HELPER, "authenticated"],
  ["the other job's poster", "authenticated", STRANGER, "authenticated"],
  ["an account party to no job", "authenticated", NOBODY, "authenticated"],
  ["admin", "authenticated", ADMIN, "authenticated"],
  ["anon", "anon", "", "anon"],
  ["service-role JWT on a non-bypass role", "authenticated", "", "service_role"],
];

/** Every actor x command on both tables, run against fresh rows each time (inside a rolled-back transaction). */
async function matrix() {
  const out = {};
  for (const [name, role, uid, jwt] of ACTORS) {
    const ops = {
      "job_pets SELECT": `SELECT 1 FROM public.job_pets`,
      "job_pets INSERT own pet": `INSERT INTO public.job_pets VALUES ('${JOB}', '${PET}')`,
      "job_pets INSERT someone else's pet": `INSERT INTO public.job_pets VALUES ('${JOB}', '${STRANGERS_PET}')`,
      "job_pets INSERT on another's job": `INSERT INTO public.job_pets VALUES ('${OTHER_JOB}', '${STRANGERS_PET}')`,
      "job_pets UPDATE": `UPDATE public.job_pets SET pet_id = pet_id`,
      "job_pets UPDATE to someone else's pet": `UPDATE public.job_pets SET pet_id = '${STRANGERS_PET}'`,
      "job_pets DELETE": `DELETE FROM public.job_pets`,
      "job_pets SELECT ... RETURNING via INSERT": `INSERT INTO public.job_pets VALUES ('${JOB}', '${PET}') RETURNING job_id`,
      "job_pets UPDATE RETURNING": `UPDATE public.job_pets SET pet_id = pet_id RETURNING job_id`,
      "job_pets DELETE RETURNING": `DELETE FROM public.job_pets RETURNING job_id`,
      "job_pets move this job's row to the other job": `UPDATE public.job_pets SET job_id = '${OTHER_JOB}' WHERE job_id = '${JOB}'`,
      "job_pets move the other job's row to this job": `UPDATE public.job_pets SET job_id = '${JOB}' WHERE job_id = '${OTHER_JOB}'`,
      "verification_exceptions SELECT": `SELECT 1 FROM public.verification_exceptions`,
      "verification_exceptions INSERT": `INSERT INTO public.verification_exceptions (user_id) VALUES ('${POSTER}')`,
      "verification_exceptions UPDATE": `UPDATE public.verification_exceptions SET notes = 'x'`,
      "verification_exceptions DELETE": `DELETE FROM public.verification_exceptions`,
    };
    for (const [op, sql] of Object.entries(ops)) {
      await db.exec("BEGIN");
      await db.exec(`INSERT INTO public.job_pets VALUES ('${JOB}', '${PET}'), ('${OTHER_JOB}', '${STRANGERS_PET}');
        INSERT INTO public.verification_exceptions (user_id) VALUES ('${POSTER}'), ('${STRANGER}');`);
      out[`${name} | ${op}`] = await as(role, uid, jwt, sql);
      await db.exec("ROLLBACK");
    }
  }
  return out;
}

const overlaps = async () =>
  (await db.query(`
    SELECT tablename, c AS cmd, count(*)::int AS n FROM (
      SELECT tablename, unnest(CASE WHEN cmd = 'ALL' THEN ARRAY['SELECT','INSERT','UPDATE','DELETE'] ELSE ARRAY[cmd] END) AS c
        FROM pg_policies WHERE tablename IN ('job_pets', 'verification_exceptions') AND permissive = 'PERMISSIVE'
         AND (roles @> ARRAY['public']::name[] OR roles @> ARRAY['authenticated']::name[])) x
     GROUP BY 1, 2 HAVING count(*) > 1 ORDER BY 1, 2`)).rows.map((r) => `${r.tablename} ${r.cmd} x${r.n}`);

const before = await matrix();
const overlapBefore = await overlaps();
check("fixture: the live policies overlap (what the advisor reports)", overlapBefore.length === 5, overlapBefore.join("; "));
check("fixture: the matrix is not trivial (some actor is admitted, some refused)",
  Object.values(before).some((v) => v === 1) && Object.values(before).some((v) => v === 0 || String(v).startsWith("ERR")), "");

// lh-authz-rls review: the SELECT cells must actually count rows (PGlite
// reports affectedRows 0 for a SELECT), or the rewritten read policy is untested.
check("fixture: SELECT cells count rows (poster 1, assigned helper 1, an unrelated account 0)",
  before["poster | job_pets SELECT"] === 1 && before["assigned helper | job_pets SELECT"] === 1 && before["an account party to no job | job_pets SELECT"] === 0,
  JSON.stringify([before["poster | job_pets SELECT"], before["assigned helper | job_pets SELECT"], before["an account party to no job | job_pets SELECT"]]));

for (let i = 0; i < 3; i++) await db.exec(readFileSync(MIG, "utf8"));

const after = await matrix();
// The one actor whose outcome may change is synthetic: a NON-bypass role whose
// JWT says service_role. PostgREST always SETs ROLE to the JWT's own role, and
// service_role has BYPASSRLS, so on prod a service_role request never reaches
// a policy; this actor is kept in the matrix to show exactly what the dropped
// policy did, and that nothing real depended on it.
const SYNTHETIC = "service-role JWT on a non-bypass role";
const changed = Object.keys(before).filter((k) => String(before[k]) !== String(after[k]));
const real = changed.filter((k) => !k.startsWith(SYNTHETIC));
check(`every real actor's outcome is unchanged (${Object.keys(before).filter((k) => !k.startsWith(SYNTHETIC)).length} actor x command cases)`, real.length === 0,
  real.map((k) => `${k}: ${before[k]} -> ${after[k]}`).join("; "));
check("the dropped policy admitted only the synthetic service-role-JWT actor, on verification_exceptions writes",
  changed.length > 0 && changed.every((k) => k.startsWith(`${SYNTHETIC} | verification_exceptions`)), changed.join("; "));
const overlapAfter = await overlaps();
check("only the admin-or-own SELECT overlap on verification_exceptions remains", overlapAfter.join("; ") === "verification_exceptions SELECT x2", overlapAfter.join("; "));

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
