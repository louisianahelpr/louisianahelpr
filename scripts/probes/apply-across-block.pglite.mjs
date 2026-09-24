#!/usr/bin/env node
/**
 * PGlite proof for 20260924020956_applications_refuse_and_hide_across_block (Q341).
 *
 *   node scripts/probes/apply-across-block.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md):
 *   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
 *
 * FIXTURE. Poster P owns an open, funded, non-seed job, two hours old.
 *   B blocked P (B is blocker). Q was blocked BY P. H is unrelated.
 *
 *   RED-BEFORE (this migration with ONLY the C10 block and the policy's block
 *     clause cut out — derived, so the baseline is the exact inverse of the fix):
 *     B's application LANDS through a SECURITY DEFINER apply function (the
 *     apply_to_job shape, which bypasses RLS), and the poster's SELECT returns
 *     it — the Q341 prod state.
 *   AFTER (migration verbatim, applied 3x for replay-safety):
 *     - B (blocked the poster) is refused through the DEFINER path, with
 *       applicant_blocked;
 *     - Q (blocked by the poster) is refused through the plain INSERT path;
 *     - H still lands (a rule that refuses everything is not a fix);
 *     - a pre-existing cross-block row (seeded as a server context, like the
 *       one live row) is invisible to the poster, so the poster's count and
 *       list agree; the applicant still sees their own row.
 */
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import { readFileSync } from "node:fs";

const MIGRATION = readFileSync(
  new URL(
    "../../supabase/migrations/20260924020956_applications_refuse_and_hide_across_block.sql",
    import.meta.url,
  ).pathname,
  "utf8",
);

const C10 = /\n {2}-- C10 \(2026-09-24, Q341\)[\s\S]*?'applicant_blocked'[\s\S]*?END IF;\n/;
const POLICY_CLAUSE = /\n\s*AND NOT public\.are_users_blocked\(applications\.helper_id, \(SELECT auth\.uid\(\)\)\)/;
if (!C10.test(MIGRATION) || !POLICY_CLAUSE.test(MIGRATION)) {
  console.error("FAIL  could not locate C10 or the policy clause in the migration — the probe would be vacuous.");
  process.exit(2);
}
const BEFORE = MIGRATION.replace(C10, "\n").replace(POLICY_CLAUSE, "");
if (/applicant_blocked|are_users_blocked\(applications/.test(BEFORE.replace(/--.*$/gm, ""))) {
  console.error("FAIL  the excision left the fix behind — RED-BEFORE would be green.");
  process.exit(2);
}
for (const kept of ["cannot_apply_to_own_job", "job_not_open", "job_expired"]) {
  if (!BEFORE.includes(kept)) {
    console.error(`FAIL  the excision also removed ${kept}.`);
    process.exit(2);
  }
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const P = "11111111-1111-1111-1111-111111111111"; // poster
const B = "22222222-2222-2222-2222-222222222222"; // blocked the poster
const Q = "44444444-4444-4444-4444-444444444444"; // blocked BY the poster
const H = "55555555-5555-5555-5555-555555555555"; // unrelated helper
const X = "66666666-6666-6666-6666-666666666666"; // pre-existing cross-block applicant
const JOB = "33333333-3333-3333-3333-333333333333";

const SETUP = `
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; END $$;
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  GRANT USAGE ON SCHEMA auth TO authenticated, anon;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::json->>'sub','')::uuid $$;
  CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
    $$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::json->>'role','') $$;

  CREATE TYPE job_status AS ENUM ('open','accepted','in_progress','completed','cancelled');
  CREATE TYPE application_status AS ENUM ('pending','accepted','rejected','withdrawn');

  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid,
    status job_status NOT NULL DEFAULT 'open',
    payment_status text NOT NULL DEFAULT 'unpaid',
    offered_to_helper_id uuid,
    direct_offer_status text,
    created_at timestamptz NOT NULL DEFAULT now(),
    is_seed boolean NOT NULL DEFAULT false,
    date_needed date,
    expires_at timestamptz
  );
  CREATE TABLE public.applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES public.jobs(id),
    helper_id uuid NOT NULL,
    status application_status NOT NULL DEFAULT 'pending',
    message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (job_id, helper_id)
  );
  CREATE TABLE public.user_blocks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id uuid NOT NULL,
    blocked_id uuid NOT NULL,
    UNIQUE (blocker_id, blocked_id)
  );

  -- Live shapes (pg_get_functiondef on prod, 2026-09-24).
  CREATE OR REPLACE FUNCTION public.are_users_blocked(_user_a uuid, _user_b uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
      SELECT EXISTS (SELECT 1 FROM public.user_blocks
        WHERE (blocker_id = _user_a AND blocked_id = _user_b) OR (blocker_id = _user_b AND blocked_id = _user_a)) $$;
  CREATE OR REPLACE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS
    $$ SELECT auth.uid() IS NULL
          AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
          AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') $$;
  CREATE OR REPLACE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql STABLE AS
    $$ SELECT now() - make_interval(mins => 20) $$;
  CREATE OR REPLACE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE OR REPLACE FUNCTION public.job_is_funded(p_job_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
    $$ SELECT j.payment_status = 'escrow' FROM public.jobs j WHERE j.id = p_job_id $$;
  CREATE OR REPLACE FUNCTION public.get_job_customer_id(_job_id uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
    $$ SELECT customer_id FROM public.jobs WHERE id = _job_id $$;
  -- The apply_to_job shape that matters here: SECURITY DEFINER, so RLS never runs.
  CREATE OR REPLACE FUNCTION public.apply_to_job(p_job_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
    DECLARE v uuid; BEGIN
      INSERT INTO applications (job_id, helper_id, status) VALUES (p_job_id, auth.uid(), 'pending') RETURNING id INTO v;
      RETURN v; END $$;
  DO $$ DECLARE f text; BEGIN
    FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
         EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f); END LOOP; END $$;

  ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
  GRANT USAGE ON SCHEMA public TO authenticated;
  GRANT SELECT ON public.jobs TO authenticated;
  GRANT SELECT, INSERT ON public.applications TO authenticated;
  CREATE POLICY "Job owners can view their jobs" ON public.jobs FOR SELECT TO authenticated
    USING (customer_id = (SELECT auth.uid()));
  CREATE POLICY "Helpers can create applications" ON public.applications FOR INSERT TO authenticated
    WITH CHECK (((SELECT auth.uid()) = helper_id) AND (status = 'pending'::application_status)
                AND (NOT are_users_blocked(helper_id, get_job_customer_id(job_id))) AND job_is_funded(job_id));
  CREATE POLICY "Helpers can view their own applications" ON public.applications FOR SELECT TO authenticated
    USING ((SELECT auth.uid()) = helper_id);
  -- Live poster policy BEFORE this migration (pg_policies, 2026-09-24).
  CREATE POLICY "Job owners can view applications for their jobs" ON public.applications FOR SELECT TO authenticated
    USING ((SELECT auth.uid()) IN (SELECT jobs.customer_id FROM jobs WHERE jobs.id = applications.job_id));

  INSERT INTO public.jobs (id, customer_id, status, payment_status, created_at, date_needed)
  VALUES ('${JOB}', '${P}', 'open', 'escrow', now() - interval '2 hours', CURRENT_DATE + 3);
  INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${B}', '${P}'), ('${P}', '${Q}'), ('${X}', '${P}');
`;

const TRIGGER = `
  DROP TRIGGER IF EXISTS trg_application_job_state ON public.applications;
  CREATE TRIGGER trg_application_job_state BEFORE INSERT ON public.applications
    FOR EACH ROW EXECUTE FUNCTION public.enforce_application_job_state();
`;

/** The one pre-existing cross-block row, written as a server context (no JWT). */
const SEED_EXISTING = `INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${JOB}', '${X}', 'pending');`;

async function as(db, who, sql, params = []) {
  try {
    await db.exec("BEGIN");
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who, role: "authenticated" })]);
    await db.exec("SET LOCAL ROLE authenticated");
    const r = await db.query(sql, params);
    await db.exec("COMMIT");
    return { ok: true, rows: r.rows, err: null };
  } catch (e) {
    await db.exec("ROLLBACK").catch(() => {});
    return { ok: false, rows: [], err: String(e?.message ?? e) };
  }
}
const viaDefiner = (db, who) => as(db, who, `SELECT public.apply_to_job($1) AS id`, [JOB]);
const viaInsert = (db, who) =>
  as(db, who, `INSERT INTO public.applications (job_id, helper_id, status) VALUES ($1,$2,'pending') RETURNING id`, [JOB, who]);
const posterCount = async (db) =>
  (await as(db, P, `SELECT count(*)::int AS n FROM public.applications WHERE job_id = $1`, [JOB])).rows[0]?.n;
const posterList = async (db) =>
  (await as(db, P, `SELECT helper_id FROM public.applications WHERE job_id = $1 ORDER BY helper_id`, [JOB])).rows.map((r) => r.helper_id);

// ── RED-BEFORE ──────────────────────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec(SETUP);
  await db.exec(BEFORE);
  await db.exec(TRIGGER);
  const b = await viaDefiner(db, B);
  check("RED-BEFORE an applicant who BLOCKED the poster applies via the DEFINER path and LANDS", b.ok, b.err ?? "landed");
  const seen = await posterList(db);
  check("RED-BEFORE the poster's SELECT returns that blocked applicant", seen.includes(B), JSON.stringify(seen));
  await db.close();
}

// ── AFTER, migration applied 3x ─────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec(SETUP);
  await db.exec(SEED_EXISTING); // before the fix, as the live row was
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(MIGRATION);
      check(`AFTER migration apply #${i} succeeds (replay-safe)`, true);
    } catch (e) {
      check(`AFTER migration apply #${i} succeeds (replay-safe)`, false, String(e?.message ?? e));
    }
  }
  await db.exec(TRIGGER);

  const b = await viaDefiner(db, B);
  check("AFTER applicant who blocked the poster is REFUSED via the DEFINER path", !b.ok, b.err ?? "LANDED");
  check("AFTER the refusal is applicant_blocked", /applicant_blocked/.test(b.err ?? ""), b.err ?? "");
  const q = await viaInsert(db, Q);
  check("AFTER applicant the poster blocked is REFUSED via plain INSERT", !q.ok, q.err ?? "LANDED");
  check("AFTER that refusal is applicant_blocked too", /applicant_blocked/.test(q.err ?? ""), q.err ?? "");
  const qd = await viaDefiner(db, Q);
  check("AFTER applicant the poster blocked is REFUSED via the DEFINER path", !qd.ok, qd.err ?? "LANDED");
  const h = await viaDefiner(db, H);
  check("AFTER an unrelated helper still LANDS", h.ok, h.err ?? "landed");

  const list = await posterList(db);
  const n = await posterCount(db);
  check("AFTER the poster sees only the unrelated helper", JSON.stringify(list) === JSON.stringify([H]), JSON.stringify(list));
  check("AFTER the poster's count agrees with the list (1)", n === 1, `count ${n}`);
  const own = await as(db, X, `SELECT helper_id FROM public.applications WHERE helper_id = $1`, [X]);
  check("AFTER the pre-existing cross-block applicant still sees their own row", own.rows.length === 1, JSON.stringify(own.rows));
  const total = (await db.query(`SELECT count(*)::int AS n FROM public.applications`)).rows[0].n;
  check("AFTER no row was deleted (X and H exist)", total === 2, `${total} rows`);
  await db.close();
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
