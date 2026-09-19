#!/usr/bin/env node
/**
 * PGlite proof for 20260919195158_before_photo_gates_working_step.
 *
 *   node src/test/pglite/beforePhotoWorkingGate.pglite.mjs
 *   node src/test/pglite/beforePhotoWorkingGate.pglite.mjs --replay   # apply 3x
 *
 * pglite is not a dependency (CLAUDE.md):
 *   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
 *
 * ── WHAT THIS PROVES ────────────────────────────────────────────────────────
 *
 * OWNER, 2026-09-19: "if a before photo is required they can't press the
 * working button until its done and same for a completed job for an after
 * photo." The AFTER half was already enforced by
 * `enforce_helper_completion_gates()`; the BEFORE half had no server rule at
 * all, which is why the client block waited for this migration rather than
 * shipping ahead of it.
 *
 * RED-BEFORE, on the prod-shaped schema with the LIVE (prod, 2026-09-19)
 * trigger body and WITHOUT the migration:
 *   R1  a Helpr with a confirmed arrival and NO before photo walks straight to
 *       `job_tracking.status = 'working'`. No error, row written.
 *   R2  the same on a crew job, for a roster member. (The roster migration is
 *       applied first here — it is merged and deploys before this one — so the
 *       crew branch exists to be tested at all.)
 *   R3  the trigger body contains no photo predicate of any kind.
 *
 * AFTER, with the migration applied:
 *   A1   a missing before photo refuses 'working' with `tracker_requires_before_photo`
 *        — a DISTINCT code from the arrival gate, because a different person's
 *        control clears it.
 *   A2   the HINT names the control that clears it.
 *   A3   ADDING THE PHOTO CLEARS IT: the same write succeeds.
 *   A4   a job the poster marked `require_photo_proof = false` is UNAFFECTED.
 *   A5   the ARRIVAL gate still fires first when both are unmet — the client's
 *        reason chain resolves the same way round.
 *   A6   the AFTER photo is NOT required to start working (only to finish).
 *   A7   'arrived' is untouched: no photo is owed to check in.
 *   A8   position pings (same status) still bypass the whole gate.
 *   A9   the service role is still unconstrained.
 *   A10  a non-assigned Helpr is still refused on authorization, not photos.
 *   A11  CREW: a roster member with no job-level before photo is refused.
 *   A12  CREW: the crew's before photo clears the step for the crew.
 *   A13  'done' is untouched here — completion's photo rule belongs to
 *        `enforce_helper_completion_gates()`, which still refuses a completion
 *        with no AFTER photo.
 *   A14  EXECUTE is still revoked from PUBLIC/anon/authenticated after the
 *        CREATE OR REPLACE (prod's default privileges have re-granted before).
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

const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
// The roster migration deploys BEFORE this one and this one is built on its
// body, so the replay applies both in order — rebuilding from prod's pre-roster
// definition would silently revert the crew branch.
const ROSTER = read("../../../supabase/migrations/20260919192559_group_roster_per_member_lifecycle.sql");
const MIGRATION = read("../../../supabase/migrations/20260919195158_before_photo_gates_working_step.sql");

const REPLAY = process.argv.includes("--replay");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "00000000-0000-0000-0000-000000000090";
const LEAD = "11111111-1111-1111-1111-111111111111";
const M2 = "22222222-2222-2222-2222-222222222222";
const OUTSIDER = "33333333-3333-3333-3333-333333333333";
const GJOB = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SJOB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const NJOB = "cccccccc-cccc-cccc-cccc-cccccccccccc"; // require_photo_proof = false

// ── The prod-shaped slice these objects live in ─────────────────────────────
const SETUP = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_server_context() RETURNS boolean
LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT auth.uid() IS NULL
     AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
$$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='job_status') THEN
  CREATE TYPE job_status AS ENUM ('open','pending_approval','accepted','in_progress','revision_requested','completed','cancelled','disputed');
END IF; END $$;

-- jobs: prod's column types for the three this migration reads.
--   require_photo_proof  boolean NOT NULL DEFAULT true
--   proof_before_urls    text[] DEFAULT '{}'  (nullable)
--   proof_after_urls     text[] DEFAULT '{}'  (nullable)
CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid,
  helper_id uuid,
  title text,
  status job_status NOT NULL DEFAULT 'open',
  is_group_job boolean DEFAULT false,
  helpers_needed integer DEFAULT 1,
  budget numeric,
  latitude double precision,
  longitude double precision,
  require_photo_proof boolean NOT NULL DEFAULT true,
  proof_before_urls text[] DEFAULT '{}',
  proof_after_urls text[] DEFAULT '{}',
  helper_confirmed_at timestamptz,
  helper_dayof_confirmed_at timestamptz,
  helper_on_the_way_at timestamptz,
  helper_arrived_at timestamptz,
  helper_arrival_verified_at timestamptz,
  helper_arrival_near_miss_at timestamptz,
  helper_arrival_near_miss_ft integer,
  poster_confirmed_arrival_at timestamptz,
  poster_confirmed_working_at timestamptz,
  poster_completed_at timestamptz,
  helper_completed_at timestamptz,
  payment_status text DEFAULT 'escrow'
);

CREATE TABLE IF NOT EXISTS public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid,
  status text NOT NULL DEFAULT 'accepted',
  joined_at timestamptz DEFAULT now(),
  UNIQUE (job_id, helper_id)
);

CREATE TABLE IF NOT EXISTS public.job_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid, helper_id uuid, status text,
  latitude double precision, longitude double precision,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, title text, message text, type text, link text,
  created_at timestamptz DEFAULT now()
);

-- prod's default privileges hand the client roles everything.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

-- ── enforce_helper_completion_gates, VERBATIM FROM PROD ────────────────────
-- Present so A13 can show the AFTER-photo half is untouched and still bites.
CREATE OR REPLACE FUNCTION public.enforce_helper_completion_gates()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM OLD.helper_id
     OR auth.uid() = OLD.customer_id THEN
    RETURN NEW;
  END IF;

  IF NEW.status::text = 'completed'
     AND OLD.status::text IS DISTINCT FROM 'completed'
     AND COALESCE(current_setting('app.dispute_withdraw_rpc', true), '') <> '1' THEN
    RAISE EXCEPTION 'helper_cannot_complete_by_status' USING ERRCODE = '42501';
  END IF;

  IF NEW.helper_completed_at IS NOT NULL AND OLD.helper_completed_at IS NULL THEN
    IF OLD.poster_confirmed_arrival_at IS NULL THEN
      RAISE EXCEPTION 'completion_requires_confirmed_arrival' USING ERRCODE = '23514';
    END IF;
    IF COALESCE(NEW.require_photo_proof, true)
       AND (COALESCE(array_length(NEW.proof_before_urls, 1), 0) = 0
            OR COALESCE(array_length(NEW.proof_after_urls, 1), 0) = 0) THEN
      RAISE EXCEPTION 'completion_requires_proof_photos' USING ERRCODE = '23514';
    END IF;
    IF COALESCE(OLD.poster_confirmed_working_at, OLD.helper_arrived_at) IS NOT NULL
       AND now() - COALESCE(OLD.poster_confirmed_working_at, OLD.helper_arrived_at) < interval '30 minutes' THEN
      RAISE EXCEPTION 'completion_min_work_time' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_helper_completion_gates ON public.jobs;
CREATE TRIGGER trg_helper_completion_gates
  BEFORE UPDATE OF helper_completed_at, status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_helper_completion_gates();

-- ── enforce_job_tracking_arrival_gate, VERBATIM FROM PROD 2026-09-19 ───────
-- Copied out of pg_get_functiondef() on fncmgoasalhdgfwzhsqa. The 'working'
-- branch reads the poster's stamp and NOTHING about photos — that absence is
-- the red below.
CREATE OR REPLACE FUNCTION public.enforce_job_tracking_arrival_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_job public.jobs;
BEGIN
  IF public.is_server_context() THEN RETURN NEW; END IF;
  SELECT * INTO v_job FROM public.jobs WHERE id = NEW.job_id FOR SHARE;
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_job.helper_id IS DISTINCT FROM NEW.helper_id THEN
    RAISE EXCEPTION 'tracker_not_assigned_helper' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('arrived', 'working', 'done') THEN RETURN NEW; END IF;
  IF NEW.status = 'arrived' AND v_job.helper_arrived_at IS NULL THEN
    RAISE EXCEPTION 'tracker_requires_arrival' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'working' AND v_job.helper_completed_at IS NULL
     AND v_job.poster_confirmed_arrival_at IS NULL THEN
    RAISE EXCEPTION 'tracker_requires_arrival' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'done' AND v_job.helper_completed_at IS NULL
     AND v_job.poster_completed_at IS NULL AND v_job.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'tracker_requires_completion' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_job_tracking_arrival_gate ON public.job_tracking;
CREATE TRIGGER trg_job_tracking_arrival_gate
  BEFORE INSERT OR UPDATE ON public.job_tracking
  FOR EACH ROW EXECUTE FUNCTION public.enforce_job_tracking_arrival_gate();
`;

/**
 * Every job starts ARRIVED AND CONFIRMED with NO photos — so the only thing
 * that can refuse 'working' below is the photo rule, never a leftover arrival.
 */
const FIXTURE = `
DELETE FROM public.job_tracking;
DELETE FROM public.group_job_helpers;
DELETE FROM public.jobs;
INSERT INTO public.jobs (id, customer_id, helper_id, title, status, is_group_job, helpers_needed, budget,
                         require_photo_proof, proof_before_urls, proof_after_urls,
                         helper_arrived_at, poster_confirmed_arrival_at)
VALUES
  ('${SJOB}', '${POSTER}', '${LEAD}', 'Mow a lawn',   'in_progress', false, 1,  80, true,  '{}', '{}', now(), now()),
  ('${GJOB}', '${POSTER}', '${LEAD}', 'Move a piano', 'in_progress', true,  2, 200, true,  '{}', '{}', now(), now()),
  ('${NJOB}', '${POSTER}', '${LEAD}', 'Quick errand', 'in_progress', false, 1,  40, false, '{}', '{}', now(), now());
INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('${GJOB}', '${LEAD}'), ('${GJOB}', '${M2}');
`;

const db = new PGlite();

/** Run `sql` as an end-user session for `uid`, then reset to the owner role. */
async function asUser(uid, sql) {
  await db.exec(`SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${uid}', false);
    SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
  try {
    return { ok: true, res: await db.exec(sql) };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE;
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claim.role', '', false);`);
  }
}

const one = async (sql) => (await db.query(sql)).rows[0];
const startWorking = (uid, job) =>
  asUser(uid, `INSERT INTO public.job_tracking (job_id, helper_id, status) VALUES ('${job}', '${uid}', 'working');`);

// ════════════════════════════════════════════════════════════════════════════
//  RED-BEFORE
// ════════════════════════════════════════════════════════════════════════════
await db.exec(SETUP);
// The roster migration is merged and deploys first; apply it before the red so
// the crew branch exists and R2 is a real red rather than a missing feature.
await db.exec(ROSTER);
await db.exec(FIXTURE);
await db.exec(
  `UPDATE public.group_job_helpers SET helper_arrived_at = now(), poster_confirmed_arrival_at = now() WHERE job_id = '${GJOB}';`,
);

console.log("\n── RED-BEFORE (prod trigger body + roster migration, THIS migration NOT applied) ──");

const r1 = await startWorking(LEAD, SJOB);
const r1row = await one(`SELECT status FROM public.job_tracking WHERE job_id='${SJOB}'`);
check(
  "R1 a Helpr with NO before photo starts working — nothing refuses it",
  r1.ok && r1row?.status === "working",
  r1.ok ? "accepted: require_photo_proof=true, proof_before_urls='{}'" : `unexpectedly refused: ${r1.error}`,
);

const r2 = await startWorking(M2, GJOB);
check(
  "R2 same on a crew job, for a roster member",
  r2.ok,
  r2.ok ? "accepted with no before photo" : `unexpectedly refused: ${r2.error}`,
);

const preBody = await one(
  `SELECT pg_get_functiondef('public.enforce_job_tracking_arrival_gate()'::regprocedure) AS def`,
);
check(
  "R3 the trigger body holds no photo predicate at all",
  !/proof_before_urls|require_photo_proof|before_photo/.test(preBody.def),
  "no mention of proof_before_urls / require_photo_proof anywhere in the gate",
);

// ════════════════════════════════════════════════════════════════════════════
//  APPLY (3x when --replay)
// ════════════════════════════════════════════════════════════════════════════
const applications = REPLAY ? 3 : 1;
for (let i = 1; i <= applications; i++) {
  try {
    await db.exec(MIGRATION);
    console.log(`\napply #${i}: OK`);
  } catch (e) {
    console.error(`\napply #${i}: FAILED — ${e.message ?? e}`);
    process.exit(1);
  }
}

await db.exec(FIXTURE);
await db.exec(
  `UPDATE public.group_job_helpers SET helper_arrived_at = now(), poster_confirmed_arrival_at = now() WHERE job_id = '${GJOB}';`,
);

console.log("\n── AFTER (migration applied) ────────────────────────────────────");

// A1 / A2 — the refusal and the sentence that gets out of it.
const a1 = await startWorking(LEAD, SJOB);
check(
  "A1 'working' is refused with a DISTINCT code when the before photo is missing",
  !a1.ok && /tracker_requires_before_photo/.test(a1.error) && !/tracker_requires_arrival/.test(a1.error),
  a1.error ?? "accepted!",
);

const a2 = await db
  .query(
    `DO $$ BEGIN
       INSERT INTO public.job_tracking (job_id, helper_id, status) VALUES ('${SJOB}', '${LEAD}', 'working');
     END $$;`,
  )
  .catch((e) => e);
const hint = await one(
  `SELECT pg_get_functiondef('public.enforce_job_tracking_arrival_gate()'::regprocedure) AS def`,
);
check(
  "A2 the HINT names the control that clears it",
  /tracker_requires_before_photo'[^;]*HINT = 'Tap Before Photo/.test(hint.def),
  "HINT: Tap Before Photo on this job and add one before you start working.",
);
void a2;

// A3 — ADDING THE PHOTO CLEARS IT.
await db.exec(`UPDATE public.jobs SET proof_before_urls = ARRAY['before.jpg'] WHERE id='${SJOB}';`);
const a3 = await startWorking(LEAD, SJOB);
check(
  "A3 adding the before photo clears it — the same write succeeds",
  a3.ok,
  a3.error ?? "accepted",
);

// A4 — a job that needs no photos is unaffected (requiredProof().before = false).
const a4 = await startWorking(LEAD, NJOB);
check(
  "A4 require_photo_proof = false is UNAFFECTED",
  a4.ok,
  a4.error ?? "accepted, as photoProofPolicy says it must be",
);

// A5 — arrival still fires FIRST when both are unmet.
await db.exec(
  `DELETE FROM public.job_tracking;
   UPDATE public.jobs SET proof_before_urls = '{}', poster_confirmed_arrival_at = NULL WHERE id='${SJOB}';`,
);
const a5 = await startWorking(LEAD, SJOB);
check(
  "A5 the ARRIVAL gate still fires first when both are unmet",
  !a5.ok && /tracker_requires_arrival/.test(a5.error),
  a5.error ?? "accepted!",
);
await db.exec(`UPDATE public.jobs SET poster_confirmed_arrival_at = now() WHERE id='${SJOB}';`);

// A6 — the AFTER photo is NOT required to START.
await db.exec(
  `UPDATE public.jobs SET proof_before_urls = ARRAY['before.jpg'], proof_after_urls = '{}' WHERE id='${SJOB}';`,
);
const a6 = await startWorking(LEAD, SJOB);
check(
  "A6 the AFTER photo is NOT required to start working",
  a6.ok,
  a6.error ?? "accepted with proof_after_urls empty",
);

// A7 — 'arrived' owes no photo.
await db.exec(`DELETE FROM public.job_tracking; UPDATE public.jobs SET proof_before_urls='{}' WHERE id='${SJOB}';`);
const a7 = await asUser(
  LEAD,
  `INSERT INTO public.job_tracking (job_id, helper_id, status) VALUES ('${SJOB}', '${LEAD}', 'arrived');`,
);
check("A7 'arrived' is untouched — no photo is owed to check in", a7.ok, a7.error ?? "accepted");

// A8 — position pings (same status) still bypass the gate entirely.
const a8 = await asUser(
  LEAD,
  `UPDATE public.job_tracking SET latitude = 30.45, longitude = -91.18, updated_at = now()
    WHERE job_id = '${SJOB}' AND helper_id = '${LEAD}';`,
);
check("A8 position pings (same status) still bypass the gate", a8.ok, a8.error ?? "accepted");

// A9 — the service role is still unconstrained.
let a9;
try {
  await db.exec(
    `DELETE FROM public.job_tracking;
     INSERT INTO public.job_tracking (job_id, helper_id, status) VALUES ('${SJOB}', '${LEAD}', 'working');`,
  );
  a9 = { ok: true };
} catch (e) {
  a9 = { ok: false, error: String(e.message ?? e) };
}
check("A9 the server context is still unconstrained", a9.ok, a9.error ?? "accepted");

// A10 — a stranger is still refused on AUTHORIZATION, not photos.
await db.exec(`DELETE FROM public.job_tracking;`);
const a10 = await startWorking(OUTSIDER, SJOB);
check(
  "A10 a non-assigned Helpr is still refused on authorization, not photos",
  !a10.ok && /tracker_not_assigned_helper/.test(a10.error),
  a10.error ?? "accepted!",
);

// A11 / A12 — the crew branch.
const a11 = await startWorking(M2, GJOB);
check(
  "A11 CREW: a roster member with no job-level before photo is refused",
  !a11.ok && /tracker_requires_before_photo/.test(a11.error),
  a11.error ?? "accepted!",
);
await db.exec(`UPDATE public.jobs SET proof_before_urls = ARRAY['before.jpg'] WHERE id='${GJOB}';`);
const a12 = await startWorking(M2, GJOB);
check(
  "A12 CREW: the crew's before photo clears the step (proof_before_urls is job-level)",
  a12.ok,
  a12.error ?? "accepted",
);

// A13 — completion's photo rule is UNTOUCHED and still bites on the AFTER photo.
await db.exec(
  `UPDATE public.jobs SET proof_before_urls = ARRAY['before.jpg'], proof_after_urls = '{}',
     poster_confirmed_working_at = now() - interval '2 hours', helper_arrived_at = now() - interval '2 hours'
   WHERE id='${SJOB}';`,
);
const a13 = await asUser(LEAD, `UPDATE public.jobs SET helper_completed_at = now() WHERE id='${SJOB}';`);
check(
  "A13 completion still refuses a missing AFTER photo — that half is untouched",
  !a13.ok && /completion_requires_proof_photos/.test(a13.error),
  a13.error ?? "accepted!",
);

// A14 — EXECUTE stays revoked after the CREATE OR REPLACE.
const acl = await one(
  `SELECT COALESCE(array_to_string(proacl, ','), '(default: owner only)') AS acl
     FROM pg_proc WHERE oid = 'public.enforce_job_tracking_arrival_gate()'::regprocedure`,
);
check(
  "A14 no client EXECUTE on the trigger function after the replace",
  !/(^|,)(anon|authenticated)=/.test(acl.acl) && !/(^|,)=X/.test(acl.acl),
  `proacl = ${acl.acl}`,
);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
