#!/usr/bin/env node
/**
 * PGlite proof for 20261004185940_job_revisions_party_columns (docs/OPEN.md Q1231).
 *
 *   node src/test/pglite/jobRevisionPartyColumns.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/jobRevisionPartyColumns.pglite.mjs # RED: the live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = public.job_revisions as LIVE on 2026-10-04: columns, defaults,
 * NOT NULLs, the status CHECK, RLS on, table ACL anon=arwdxm and
 * authenticated=arwdxm (MAINTAIN not modelled) and its one policy verbatim
 * ("Job parties can manage revisions", FOR ALL TO authenticated). jobs is
 * reduced to id, customer_id, helper_id, with authenticated's column SELECT,
 * its table-level UPDATE, the live "Users can view their own jobs" policy and
 * the two live UPDATE policies (a FOR SHARE read is checked against them), so a trigger that reads
 * the job through the caller's RLS sees what it would on prod.
 * `SET ROLE authenticated` with request.uid set is PostgREST with a user JWT.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const NEW = read("../../../supabase/migrations/20261004185940_job_revisions_party_columns.sql");
const CHECK = read("../../../scripts/ci/client-insert-columns.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPR = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const STRANGER = "f6cc3ebb-9478-473c-8eb8-62b406f0734f";
const JOB = "10000000-0000-4000-8000-000000000001";
const OLD_DAY = "2020-01-01T00:00:00Z";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid);
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
GRANT SELECT (id, customer_id, helper_id) ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;
CREATE POLICY "Users can view their own jobs" ON public.jobs FOR SELECT TO authenticated
  USING (((( SELECT auth.uid() AS uid) = customer_id) OR (( SELECT auth.uid() AS uid) = helper_id)));
-- Live: authenticated holds table-level UPDATE on jobs (relacl awdxm), which a
-- FOR SHARE read needs, and these two UPDATE policies (verbatim), which RLS
-- applies to a locking read.
GRANT UPDATE ON public.jobs TO authenticated;
CREATE POLICY "Customers can update their own jobs" ON public.jobs FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = customer_id));
CREATE POLICY "Helpers can update their assigned jobs" ON public.jobs FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = helper_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = helper_id));

CREATE TABLE public.job_revisions (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.jobs (id) ON DELETE CASCADE,
  requested_by uuid,
  status text DEFAULT 'pending'::text NOT NULL CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'resolved'::text]))),
  description text NOT NULL,
  photos text[] DEFAULT '{}'::text[],
  helper_response text,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.job_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON public.job_revisions TO anon, authenticated;
GRANT ALL ON public.job_revisions TO service_role;
CREATE POLICY "Job parties can manage revisions" ON public.job_revisions FOR ALL TO authenticated
  USING (((( SELECT auth.uid() AS uid) = requested_by) OR (( SELECT auth.uid() AS uid) IN ( SELECT jobs.customer_id FROM jobs WHERE (jobs.id = job_revisions.job_id))) OR (( SELECT auth.uid() AS uid) IN ( SELECT jobs.helper_id FROM jobs WHERE (jobs.id = job_revisions.job_id)))))
  WITH CHECK (((( SELECT auth.uid() AS uid) = requested_by) OR (( SELECT auth.uid() AS uid) IN ( SELECT jobs.customer_id FROM jobs WHERE (jobs.id = job_revisions.job_id))) OR (( SELECT auth.uid() AS uid) IN ( SELECT jobs.helper_id FROM jobs WHERE (jobs.id = job_revisions.job_id)))));

-- The other declared tables of the class check, so only job_revisions rows are under test.
CREATE TABLE public.messages (id uuid); CREATE TABLE public.applications (id uuid);

INSERT INTO public.jobs VALUES ('${JOB}', '${POSTER}', '${HELPR}');
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(who === "service" ? "SET ROLE service_role" : who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const row = async (id) => (await db.query(`SELECT * FROM public.job_revisions WHERE id = '${id}'`)).rows[0];
const count = async () => (await db.query(`SELECT count(*)::int AS n FROM public.job_revisions`)).rows[0].n;

// ── the product path: the poster files, the Helpr acknowledges ────────────
let rev;
{
  const r = await as(POSTER, `INSERT INTO public.job_revisions (job_id, requested_by, description, photos, status)
                              VALUES ('${JOB}', '${POSTER}', 'Edge the walk too', ARRAY['${JOB}/revisions/a.jpg'], 'pending') RETURNING id`);
  check("L1 the poster files a revision request (CompletionChoiceSheet's payload)", r.ok && r.rows.length === 1, r.ok ? "" : r.err);
  rev = r.ok ? r.rows[0].id : null;
  const a = await as(HELPR, `UPDATE public.job_revisions SET status = 'accepted' WHERE id = '${rev}' RETURNING id`);
  check("L2 the Helpr acknowledges it (HelperRevisionCard's payload)", a.ok && a.rows.length === 1, a.ok ? `${a.rows.length} row(s)` : a.err);
}

// ── forgery and rewrites (RED on live: each lands) ────────────────────────
{
  const before = await count();
  const r = await as(HELPR, `INSERT INTO public.job_revisions (job_id, requested_by, description, status) VALUES ('${JOB}', '${POSTER}', 'Poster says: pay me double', 'pending') RETURNING id`);
  check("R1 the Helpr cannot file a request in the poster's name", !r.ok && (await count()) === before, r.ok ? "landed as the poster" : r.err);
  const d = await as(HELPR, `UPDATE public.job_revisions SET description = 'Nothing needed, all good' WHERE id = '${rev}' RETURNING id`);
  check("R2 the Helpr cannot rewrite the poster's description", !(d.ok && d.rows.length) && (await row(rev)).description === "Edge the walk too", d.ok ? `${d.rows.length} row(s)` : d.err);
  const p = await as(HELPR, `UPDATE public.job_revisions SET photos = '{}' WHERE id = '${rev}' RETURNING id`);
  check("R3 the Helpr cannot strip the poster's evidence photos", !(p.ok && p.rows.length) && (await row(rev)).photos.length === 1, p.ok ? `${p.rows.length} row(s)` : p.err);
  const rb = await as(HELPR, `UPDATE public.job_revisions SET requested_by = '${HELPR}' WHERE id = '${rev}' RETURNING id`);
  check("R4 nobody re-points requested_by", !(rb.ok && rb.rows.length) && (await row(rev)).requested_by === POSTER, rb.ok ? `${rb.rows.length} row(s)` : rb.err);
  const ps = await as(POSTER, `UPDATE public.job_revisions SET status = 'pending' WHERE id = '${rev}' RETURNING id`);
  check("R5 the poster cannot answer for the Helpr (status)", !(ps.ok && ps.rows.length) && (await row(rev)).status === "accepted", ps.ok ? `${ps.rows.length} row(s)` : ps.err);
  const fake = await as(POSTER, `INSERT INTO public.job_revisions (job_id, requested_by, description, status)
                                 VALUES ('${JOB}', '${HELPR}', 'second ask', 'accepted') RETURNING requested_by, status, helper_response, created_at`);
  const f = fake.ok ? fake.rows[0] : null;
  check("R6 a poster insert is pinned: requested_by = the caller, born pending",
    f && f.requested_by === POSTER && f.status === "pending" && f.helper_response === null,
    fake.ok ? JSON.stringify(f) : fake.err);
  const ans = await as(POSTER, `INSERT INTO public.job_revisions (job_id, description, helper_response, created_at)
                                VALUES ('${JOB}', 'third ask', 'Helpr agreed', '${OLD_DAY}') RETURNING id`);
  check("R6b a poster cannot insert the Helpr's answer or a backdated created_at", !ans.ok, ans.ok ? "landed" : ans.err);
  const s = await as(STRANGER, `INSERT INTO public.job_revisions (job_id, requested_by, description) VALUES ('${JOB}', '${STRANGER}', 'x') RETURNING id`);
  check("R7 a stranger cannot file one on someone else's job (live: the policy admits requested_by = self)", !s.ok, s.ok ? "landed" : s.err);
  const an = await as(null, `INSERT INTO public.job_revisions (job_id, description) VALUES ('${JOB}', 'x') RETURNING id`);
  check("R8 anon holds no INSERT", !an.ok && /permission denied/i.test(an.err), an.ok ? "landed" : an.err);
}

// ── no client deletes a request; an answer moves once, from pending ───────
// Each case on its own server-written row, so a RED run's landed write never
// changes what the next case starts from.
const fresh = async (status) => (await db.query(
  `INSERT INTO public.job_revisions (job_id, requested_by, description, status) VALUES ('${JOB}', '${POSTER}', 'case row', '${status}') RETURNING id`)).rows[0].id;
{
  const r1 = await fresh("pending");
  const d = await as(HELPR, `DELETE FROM public.job_revisions WHERE id = '${r1}' RETURNING id`);
  check("R9 the Helpr cannot delete the poster's request (was Q1276)", !(d.ok && d.rows.length) && (await row(r1)) !== undefined, d.ok ? `${d.rows.length} row(s)` : d.err);
  const r2 = await fresh("pending");
  const dp = await as(POSTER, `DELETE FROM public.job_revisions WHERE id = '${r2}' RETURNING id`);
  check("R10 no client deletes one at all (the poster neither)", !(dp.ok && dp.rows.length) && (await row(r2)) !== undefined, dp.ok ? `${dp.rows.length} row(s)` : dp.err);
  const r3 = await fresh("accepted");
  const back = await as(HELPR, `UPDATE public.job_revisions SET status = 'pending' WHERE id = '${r3}' RETURNING id`);
  check("R11 an answered request is not re-opened by the Helpr", !(back.ok && back.rows.length) && (await row(r3))?.status === "accepted", back.ok ? `${back.rows.length} row(s)` : back.err);
  const r4 = await fresh("accepted");
  const res = await as(HELPR, `UPDATE public.job_revisions SET status = 'resolved' WHERE id = '${r4}' RETURNING id`);
  check("R12 ...nor re-answered", !(res.ok && res.rows.length) && (await row(r4))?.status === "accepted", res.ok ? `${res.rows.length} row(s)` : res.err);
}

// ── the server still writes anything ──────────────────────────────────────
{
  const s = await as("service", `UPDATE public.job_revisions SET status = 'resolved', resolved_at = now(), helper_response = 'done' WHERE id = '${rev}' RETURNING id`);
  check("L3 service_role still writes any column", s.ok && s.rows.length === 1, s.ok ? "" : s.err);
}

// ── the class check ───────────────────────────────────────────────────────
{
  const rows = (await db.query(CHECK.replace(/;\s*$/, ""))).rows.filter((r) => r.table === "job_revisions");
  check("C1 scripts/ci/client-insert-columns.sql is clean for job_revisions", rows.length === 0, rows.map((r) => `${r.role}: ${r.what}`).join("; ") || "0 rows");
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
