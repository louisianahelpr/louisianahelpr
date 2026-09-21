#!/usr/bin/env node
/**
 * PGlite proof for 20260921190002_refuse_self_application.
 *
 *   node scripts/probes/self-application-gate.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md):
 *   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
 *
 * WHAT IT PROVES. One open, funded, non-seed job, two hours old, owned by P.
 * As `authenticated` holding P's own sub, P inserts an application to it.
 *
 *   RED-BEFORE (this migration's body with ONLY the C3 block cut out — so the
 *     baseline is exactly the inverse of the fix, not a hand-copied guess):
 *     the self-application LANDS. Matches the live prod reproduction recorded
 *     in the migration header (self_app_id=78d3652a…, self_err=[NO ERROR]).
 *   AFTER (migration applied verbatim): the insert is refused with
 *     `cannot_apply_to_own_job`, and a genuine third-party application by H
 *     still lands. A rule that refuses everything is not a fix.
 *
 * Also applies the migration 3x consecutively (CLAUDE.md replay-safety) and
 * re-runs both assertions after the third apply.
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
  new URL("../../supabase/migrations/20260921190002_refuse_self_application.sql", import.meta.url).pathname,
  "utf8",
);

// The pre-fix body: the shipped migration with the C3 block removed. Derived,
// not transcribed, so RED-BEFORE cannot silently drift away from the fix.
const C3 = /\n {2}-- C3 \(2026-09-21\)[\s\S]*?cannot_apply_to_own_job[\s\S]*?END IF;\n/;
if (!C3.test(MIGRATION)) {
  console.error("FAIL  could not locate the C3 block in the migration — the probe would be vacuous.");
  process.exit(2);
}
const BEFORE = MIGRATION.replace(C3, "\n");
for (const kept of ["job_has_no_owner", "job_not_open", "job_in_early_access_window", "job_expired"]) {
  if (!BEFORE.includes(kept)) {
    console.error(`FAIL  the C3 excision also removed ${kept} — RED-BEFORE is not the real prior body.`);
    process.exit(2);
  }
}
if (BEFORE.includes("cannot_apply_to_own_job")) {
  console.error("FAIL  the C3 excision left the new guard behind — RED-BEFORE would be green.");
  process.exit(2);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const P = "11111111-1111-1111-1111-111111111111"; // poster (owns the job)
const H = "22222222-2222-2222-2222-222222222222"; // genuine third-party helper
const JOB = "33333333-3333-3333-3333-333333333333";

const SETUP = `
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  -- nullif twice: a transaction-local GUC reverts to '' (not NULL), and
  -- ''::json throws 22P02 rather than answering "no session".
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::json->>'sub','')::uuid $$;
  CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
    $$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::json->>'role','') $$;

  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='job_status') THEN
    CREATE TYPE job_status AS ENUM ('open','accepted','in_progress','completed','cancelled'); END IF; END $$;
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='application_status') THEN
    CREATE TYPE application_status AS ENUM ('pending','accepted','rejected','withdrawn'); END IF; END $$;

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

  -- Live helper functions this trigger calls, in their live shapes.
  CREATE OR REPLACE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS
    $$ SELECT auth.uid() IS NULL
          AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
          AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') $$;
  CREATE OR REPLACE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql STABLE AS
    $$ SELECT now() - make_interval(mins => 20) $$;
  CREATE OR REPLACE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE OR REPLACE FUNCTION public.job_payment_is_funded(p text) RETURNS boolean LANGUAGE sql IMMUTABLE AS
    $$ SELECT COALESCE(p,'') = ANY (ARRAY['escrow','payout_pending','released']) $$;
  CREATE OR REPLACE FUNCTION public.job_is_funded(p_job_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
    $$ SELECT public.job_payment_is_funded(j.payment_status) FROM public.jobs j WHERE j.id = p_job_id $$;
  CREATE OR REPLACE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE OR REPLACE FUNCTION public.get_job_customer_id(p_job_id uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
    $$ SELECT j.customer_id FROM public.jobs j WHERE j.id = p_job_id $$;
  -- Postgres grants EXECUTE on a new function to PUBLIC; Supabase does not.
  -- Seed the ACL shape so the baseline is not a false green.
  DO $$ DECLARE f text; BEGIN
    FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
         EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f); END LOOP; END $$;

  ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
  GRANT SELECT ON public.jobs TO authenticated;
  GRANT SELECT, INSERT ON public.applications TO authenticated;
  CREATE POLICY "Job owners can view their jobs" ON public.jobs FOR SELECT TO authenticated
    USING (customer_id = (SELECT auth.uid()));
  -- Verbatim from prod pg_policies (2026-09-21): note it never names customer_id.
  CREATE POLICY "Helpers can create applications" ON public.applications FOR INSERT TO authenticated
    WITH CHECK (((SELECT auth.uid()) = helper_id) AND (status = 'pending'::application_status)
                AND (NOT are_users_blocked(helper_id, get_job_customer_id(job_id))) AND job_is_funded(job_id));
  CREATE POLICY "Helpers can view their own applications" ON public.applications FOR SELECT TO authenticated
    USING ((SELECT auth.uid()) = helper_id);

  -- The fixture: open, FUNDED, non-seed, two hours old (so C5 early access is
  -- already past), needed in three days. Every other gate is satisfied, so the
  -- only thing that can refuse the insert is the identity rule.
  INSERT INTO public.jobs (id, customer_id, status, payment_status, created_at, date_needed)
  VALUES ('${JOB}', '${P}', 'open', 'escrow', now() - interval '2 hours', CURRENT_DATE + 3);
`;

const TRIGGER = `
  DROP TRIGGER IF EXISTS trg_application_job_state ON public.applications;
  CREATE TRIGGER trg_application_job_state BEFORE INSERT ON public.applications
    FOR EACH ROW EXECUTE FUNCTION public.enforce_application_job_state();
`;

/** Insert an application as `who`, in its own transaction, returning the outcome. */
async function applyAs(db, who, message) {
  try {
    await db.exec("BEGIN");
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: who, role: "authenticated" }),
    ]);
    await db.exec("SET LOCAL ROLE authenticated");
    const r = await db.query(
      `INSERT INTO public.applications (job_id, helper_id, status, message) VALUES ($1,$2,'pending',$3) RETURNING id`,
      [JOB, who, message],
    );
    await db.exec("COMMIT");
    return { landed: true, id: r.rows[0].id, err: null };
  } catch (e) {
    // A failed statement aborts the block; roll it back rather than RESET ROLE
    // into an aborted transaction (25P02 presents as a harness explosion).
    await db.exec("ROLLBACK").catch(() => {});
    return { landed: false, id: null, err: String(e?.message ?? e) };
  }
}

const landedRows = async (db) => (await db.query(`SELECT helper_id FROM public.applications`)).rows.length;

// ── RED-BEFORE: the same body with C3 excised ───────────────────────────────
{
  const db = new PGlite();
  await db.exec(SETUP);
  await db.exec(BEFORE);
  await db.exec(TRIGGER);
  const self = await applyAs(db, P, "self apply");
  check("RED-BEFORE the poster's application to their OWN job LANDS", self.landed, self.err ?? `id ${self.id}`);
  check("RED-BEFORE the row is durable", (await landedRows(db)) === 1, `${await landedRows(db)} row(s)`);
  await db.close();
}

// ── AFTER: the migration as shipped, applied 3x for replay-safety ───────────
{
  const db = new PGlite();
  await db.exec(SETUP);
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(MIGRATION);
      check(`AFTER migration apply #${i} succeeds (replay-safe)`, true);
    } catch (e) {
      check(`AFTER migration apply #${i} succeeds (replay-safe)`, false, String(e?.message ?? e));
    }
  }
  await db.exec(TRIGGER);

  const self = await applyAs(db, P, "self apply");
  check("AFTER the poster CANNOT apply to their own job", !self.landed, self.err ?? `LANDED id ${self.id}`);
  check(
    "AFTER the refusal names the rule (cannot_apply_to_own_job)",
    /cannot_apply_to_own_job/.test(self.err ?? ""),
    self.err ?? "no error",
  );

  const third = await applyAs(db, H, "third party apply");
  check("AFTER a genuine third-party application still LANDS", third.landed, third.err ?? `id ${third.id}`);

  const rows = (await db.query(`SELECT helper_id FROM public.applications ORDER BY created_at`)).rows;
  check("AFTER exactly one row exists, and it is the third party's", rows.length === 1 && rows[0].helper_id === H,
    JSON.stringify(rows));
  await db.close();
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
