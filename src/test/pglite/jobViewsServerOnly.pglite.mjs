#!/usr/bin/env node
/**
 * PGlite proof for 20261004185317_job_views_server_only (docs/OPEN.md Q1230).
 *
 *   node src/test/pglite/jobViewsServerOnly.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/jobViewsServerOnly.pglite.mjs # RED: the live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = public.job_views as LIVE on 2026-10-04: columns, defaults,
 * UNIQUE (job_id, viewer_id), RLS on, table ACL anon=arwdxm and
 * authenticated=arwdxm (MAINTAIN not modelled), its two policies verbatim
 * (both TO public), and the two definer RPCs verbatim:
 *   record_job_view      md5(prosrc) 8aa7a2ba447807fcd0ddde73e620213d
 *   get_job_view_counts  md5(prosrc) c700ec908cfee7d3ce98a0854be60aa6
 * jobs carries only id and customer_id. `SET ROLE authenticated` with
 * request.uid set is PostgREST with a user JWT; the RPCs are owned by the
 * superuser, as on prod.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(new URL("../../../supabase/migrations/20261004185317_job_views_server_only.sql", import.meta.url).pathname, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const V1 = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const V2 = "f6cc3ebb-9478-473c-8eb8-62b406f0734f";
const JOB = "10000000-0000-4000-8000-000000000001";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid);
GRANT SELECT ON public.jobs TO anon, authenticated, service_role;

CREATE TABLE public.job_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.jobs (id) ON DELETE CASCADE,
  viewer_id uuid,
  first_viewed_at timestamptz DEFAULT now(),
  CONSTRAINT job_views_job_id_viewer_id_key UNIQUE (job_id, viewer_id)
);
ALTER TABLE public.job_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_views FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON public.job_views TO anon, authenticated;
GRANT ALL ON public.job_views TO service_role;
CREATE POLICY "Helpers insert own views" ON public.job_views FOR INSERT TO public WITH CHECK ((( SELECT auth.uid() AS uid) = viewer_id));
CREATE POLICY "Posters read views on own jobs" ON public.job_views FOR SELECT TO public
  USING ((EXISTS ( SELECT 1 FROM jobs WHERE ((jobs.id = job_views.job_id) AND (jobs.customer_id = ( SELECT auth.uid() AS uid))))));

CREATE FUNCTION public.record_job_view(p_job_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO job_views (job_id, viewer_id)
  VALUES (p_job_id, auth.uid())
  ON CONFLICT (job_id, viewer_id) DO NOTHING;
  IF FOUND THEN RETURN 'inserted'; ELSE RETURN 'already_seen'; END IF;
END;
$function$;
CREATE FUNCTION public.get_job_view_counts(p_job_ids uuid[])
 RETURNS TABLE(job_id uuid, view_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jv.job_id, COUNT(DISTINCT jv.viewer_id)::bigint
  FROM job_views jv
  WHERE jv.job_id = ANY(p_job_ids)
  GROUP BY jv.job_id;
$function$;
REVOKE EXECUTE ON FUNCTION public.record_job_view(uuid), public.get_job_view_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_job_view(uuid), public.get_job_view_counts(uuid[]) TO authenticated, service_role;

INSERT INTO public.jobs VALUES ('${JOB}', '${POSTER}');
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(who === "service" ? "SET ROLE service_role" : who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}

// ── the product path: two Helprs view the job, the poster reads a count ───
{
  const a = await as(V1, `SELECT public.record_job_view('${JOB}') AS r`);
  const b = await as(V2, `SELECT public.record_job_view('${JOB}') AS r`);
  check("L1 record_job_view (definer) still records each viewer", a.ok && b.ok && a.rows[0].r === "inserted" && b.rows[0].r === "inserted", a.ok ? (b.ok ? "" : b.err) : a.err);
  const again = await as(V1, `SELECT public.record_job_view('${JOB}') AS r`);
  check("L2 ...once per viewer", again.ok && again.rows[0].r === "already_seen", again.ok ? again.rows[0].r : again.err);
  const c = await as(POSTER, `SELECT view_count::int AS n FROM public.get_job_view_counts(ARRAY['${JOB}']::uuid[])`);
  check("L3 the poster still gets the count (get_job_view_counts, definer)", c.ok && c.rows[0]?.n === 2, c.ok ? JSON.stringify(c.rows) : c.err);
}

// ── the leak: the poster's direct read of the rows (RED on live: 2 viewer ids) ──
{
  const r = await as(POSTER, `SELECT viewer_id FROM public.job_views WHERE job_id = '${JOB}'`);
  check("R1 the poster cannot read who viewed their job", !r.ok && /permission denied/i.test(r.err), r.ok ? `read ${r.rows.length} viewer id(s)` : r.err);
  const v = await as(V1, `SELECT viewer_id FROM public.job_views`);
  check("R2 a viewer cannot read the table either", !v.ok && /permission denied/i.test(v.err), v.ok ? `read ${v.rows.length} row(s)` : v.err);
  const ins = await as(V2, `INSERT INTO public.job_views (job_id, viewer_id) VALUES ('${JOB}', '${V2}') ON CONFLICT DO NOTHING RETURNING id`);
  check("R3 a client cannot write a view row directly", !ins.ok && /permission denied/i.test(ins.err), ins.ok ? "landed" : ins.err);
  const anon = await as(null, `SELECT count(*) FROM public.job_views`);
  check("R4 anon cannot read the table", !anon.ok && /permission denied/i.test(anon.err), anon.ok ? JSON.stringify(anon.rows) : anon.err);
  const pol = (await db.query(`SELECT count(*)::int AS n FROM pg_policy WHERE polrelid = 'public.job_views'::regclass`)).rows[0].n;
  check("R5 no policy is left on the table", pol === 0, `${pol} policies`);
}
// ── server roles keep working ─────────────────────────────────────────────
{
  const s = await as("service", `SELECT count(*)::int AS n FROM public.job_views`);
  check("L4 service_role (retention prune, purge, export) still reads the table", s.ok && s.rows[0].n === 2, s.ok ? JSON.stringify(s.rows) : s.err);
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
