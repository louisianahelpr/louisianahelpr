#!/usr/bin/env node
/**
 * PGlite proof for 20260919192559_group_roster_per_member_lifecycle.
 *
 *   node src/test/pglite/groupRosterLifecycle.pglite.mjs
 *   node src/test/pglite/groupRosterLifecycle.pglite.mjs --replay   # apply 3x
 *
 * pglite is not a dependency (CLAUDE.md):
 *   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
 *
 * ── WHAT THIS PROVES ────────────────────────────────────────────────────────
 *
 * RED-BEFORE, on the prod-shaped schema WITHOUT the migration:
 *   R1  `group_job_helpers` cannot hold a second arrival or a second
 *       completion — there are no per-member lifecycle columns at all.
 *   R2  THE TRAP. Widen the `jobs` UPDATE policy to the roster (the obvious
 *       "fix") and crew member #2 marks the JOB complete with no confirmed
 *       arrival and no proof photos, because `enforce_helper_completion_gates`
 *       early-returns on `auth.uid() IS DISTINCT FROM OLD.helper_id`.
 *   R3  `enforce_job_tracking_arrival_gate` refuses crew member #2 a tracker
 *       row at all — a SECURITY DEFINER RPC called by them is not a server
 *       context, so the membership test still reads `jobs.helper_id`.
 *
 * AFTER, with the migration applied:
 *   A1..A18 — the per-member lifecycle, its gates applied per member, the
 *   server-owned lock, the roll-up, the roster-aware tracker gate, and the
 *   UNCHANGED single-helper path.
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
    "../../../supabase/migrations/20260919192559_group_roster_per_member_lifecycle.sql",
    import.meta.url,
  ).pathname,
  "utf8",
);

const REPLAY = process.argv.includes("--replay");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "00000000-0000-0000-0000-0000000000p0".replace("p", "9");
const LEAD = "11111111-1111-1111-1111-111111111111";
const M2 = "22222222-2222-2222-2222-222222222222";
const OUTSIDER = "33333333-3333-3333-3333-333333333333";
const GJOB = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SJOB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

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
  require_photo_proof boolean DEFAULT true,
  proof_before_urls text[],
  proof_after_urls text[],
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

-- ── enforce_helper_completion_gates, VERBATIM FROM PROD (pre-migration) ─────
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

-- ── enforce_job_tracking_arrival_gate, VERBATIM FROM PROD (pre-migration) ───
-- The reason this probe grew a second red: a SECURITY DEFINER RPC called by a
-- crew member is NOT a server context, so this gate refused every tracker row
-- for members 2..N.
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

const FIXTURE = `
DELETE FROM public.group_job_helpers;
DELETE FROM public.jobs;
INSERT INTO public.jobs (id, customer_id, helper_id, title, status, is_group_job, helpers_needed, budget, latitude, longitude, require_photo_proof)
VALUES ('${GJOB}', '${POSTER}', '${LEAD}', 'Move a piano', 'accepted', true, 2, 200, 30.45, -91.18, true);
INSERT INTO public.jobs (id, customer_id, helper_id, title, status, is_group_job, helpers_needed, budget, latitude, longitude, require_photo_proof)
VALUES ('${SJOB}', '${POSTER}', '${LEAD}', 'Mow a lawn', 'in_progress', false, 1, 80, 30.45, -91.18, true);
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

// ════════════════════════════════════════════════════════════════════════════
//  RED-BEFORE
// ════════════════════════════════════════════════════════════════════════════
await db.exec(SETUP);
await db.exec(FIXTURE);

console.log("\n── RED-BEFORE (prod schema, migration NOT applied) ──────────────");

const preCols = await one(
  `SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema='public' AND table_name='group_job_helpers'
      AND column_name IN ('helper_completed_at','helper_arrived_at','poster_confirmed_arrival_at')`,
);
check(
  "R1 roster cannot hold per-member lifecycle state",
  preCols.n === 0,
  `${preCols.n}/3 lifecycle columns present — the schema cannot represent N arrivals or N completions`,
);

// THE TRAP: widen the jobs UPDATE reach to the roster and let member 2 complete.
const trap = await asUser(
  M2,
  `UPDATE public.jobs SET helper_completed_at = now() WHERE id = '${GJOB}';`,
);
const trapped = await one(`SELECT helper_completed_at FROM public.jobs WHERE id='${GJOB}'`);
check(
  "R2 THE TRAP: crew member #2 completes the JOB with no arrival and no photos",
  trap.ok && trapped.helper_completed_at !== null,
  trap.ok
    ? "enforce_helper_completion_gates early-returned on auth.uid() IS DISTINCT FROM OLD.helper_id"
    : `unexpectedly refused: ${trap.error}`,
);

// R3 — the live tracker gate refuses every crew member who is not helper_id.
const trackRed = await asUser(
  M2,
  `INSERT INTO public.job_tracking (job_id, helper_id, status) VALUES ('${GJOB}', '${M2}', 'on_the_way');`,
);
check(
  "R3 the tracker gate refuses crew member #2 — a definer RPC is not a server context",
  !trackRed.ok && /tracker_not_assigned_helper/.test(trackRed.error),
  trackRed.error ?? "accepted — model is wrong",
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
    console.log(`\napply #${i}: FAILED — ${e.message ?? e}`);
    failures++;
  }
}
await db.exec(FIXTURE);

console.log("\n── AFTER (migration applied) ────────────────────────────────────");

const postCols = await one(
  `SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema='public' AND table_name='group_job_helpers'
      AND column_name IN ('helper_confirmed_at','helper_on_the_way_at','helper_arrived_at',
        'helper_arrival_verified_at','helper_completed_at','poster_confirmed_arrival_at',
        'proof_before_urls','proof_after_urls')`,
);
check("A1 roster holds per-member lifecycle state", postCols.n === 8, `${postCols.n}/8 columns`);

// A2 — a non-member is refused by every RPC.
const outsider = await asUser(OUTSIDER, `SELECT public.rpc_group_member_mark_done('${GJOB}');`);
check(
  "A2 a non-member cannot act on the crew",
  !outsider.ok && /not_on_this_crew/.test(outsider.error),
  outsider.error ?? "accepted!",
);

// A3 — member 2 records their own confirm / on-the-way / arrival.
const c2 = await asUser(M2, `SELECT public.rpc_group_member_confirm('${GJOB}');`);
const o2 = await asUser(M2, `SELECT public.rpc_group_member_on_the_way('${GJOB}', 30.45, -91.18);`);
const a2 = await asUser(M2, `SELECT public.rpc_group_member_mark_arrival('${GJOB}', 30.45, -91.18);`);
const row2 = await one(
  `SELECT helper_confirmed_at, helper_on_the_way_at, helper_arrived_at, helper_arrival_verified_at
     FROM public.group_job_helpers WHERE job_id='${GJOB}' AND helper_id='${M2}'`,
);
check(
  "A3 member #2 records confirm + on-the-way + arrival on their OWN row",
  c2.ok && o2.ok && a2.ok &&
    row2.helper_confirmed_at && row2.helper_on_the_way_at &&
    row2.helper_arrived_at && row2.helper_arrival_verified_at,
  [c2.error, o2.error, a2.error].filter(Boolean).join(" | ") || "GPS within 500ft verified",
);

// A4 — arrival is recorded even with NO location (2026-09-19 rule), unverified.
const cL = await asUser(LEAD, `SELECT public.rpc_group_member_confirm('${GJOB}');`);
const aL = await asUser(LEAD, `SELECT public.rpc_group_member_mark_arrival('${GJOB}');`);
const rowL = await one(
  `SELECT helper_arrived_at, helper_arrival_verified_at FROM public.group_job_helpers
    WHERE job_id='${GJOB}' AND helper_id='${LEAD}'`,
);
check(
  "A4 a fix-less arrival is RECORDED, not refused, and stays unverified",
  cL.ok && aL.ok && rowL.helper_arrived_at !== null && rowL.helper_arrival_verified_at === null,
  aL.error ?? "",
);

// A5 — GATE 1, per member: no poster confirmation → refused, for BOTH members.
const g1a = await asUser(M2, `SELECT public.rpc_group_member_mark_done('${GJOB}');`);
const g1b = await asUser(LEAD, `SELECT public.rpc_group_member_mark_done('${GJOB}');`);
check(
  "A5 GATE per member: no confirmed arrival refuses member #2 AND the lead",
  !g1a.ok && /completion_requires_confirmed_arrival/.test(g1a.error) &&
    !g1b.ok && /completion_requires_confirmed_arrival/.test(g1b.error),
  `${g1a.error ?? "m2 accepted!"} / ${g1b.error ?? "lead accepted!"}`,
);

// A6 — only the poster may confirm, and only an arrival that exists.
const badConfirm = await asUser(
  M2,
  `SELECT public.rpc_poster_confirm_member_arrival('${GJOB}', '${M2}');`,
);
const okConfirm2 = await asUser(
  POSTER,
  `SELECT public.rpc_poster_confirm_member_arrival('${GJOB}', '${M2}');`,
);
check(
  "A6 only the poster confirms a member's arrival",
  !badConfirm.ok && /not_the_poster/.test(badConfirm.error) && okConfirm2.ok,
  `${badConfirm.error ?? "helper confirmed themselves!"} / ${okConfirm2.error ?? "poster ok"}`,
);

// A7 — GATE 2, per member: proof photos are member #2's own, not the job's.
await db.exec(
  `UPDATE public.jobs SET proof_before_urls=ARRAY['a'], proof_after_urls=ARRAY['b'] WHERE id='${GJOB}';`,
);
const g2 = await asUser(M2, `SELECT public.rpc_group_member_mark_done('${GJOB}');`);
check(
  "A7 GATE per member: the JOB's proof photos do not discharge member #2's",
  !g2.ok && /completion_requires_proof_photos/.test(g2.error),
  g2.error ?? "accepted on someone else's photos!",
);

// A8 — GATE 3: the 30-minute floor, from the member's own clock.
const proof = await asUser(
  M2,
  `SELECT public.rpc_group_member_set_proof('${GJOB}', ARRAY['before.jpg'], ARRAY['after.jpg']);`,
);
const g3 = await asUser(M2, `SELECT public.rpc_group_member_mark_done('${GJOB}');`);
check(
  "A8 GATE per member: the 30-minute floor runs off the member's own arrival",
  proof.ok && !g3.ok && /completion_min_work_time/.test(g3.error),
  g3.error ?? "accepted inside 30 minutes!",
);

// A9 — all three satisfied: member #2 is done; the JOB is NOT, the lead is still out.
await db.exec(
  `UPDATE public.group_job_helpers
      SET helper_arrived_at = now() - interval '2 hours',
          poster_confirmed_working_at = now() - interval '2 hours'
    WHERE job_id='${GJOB}' AND helper_id='${M2}';`,
);
const done2 = await asUser(M2, `SELECT public.rpc_group_member_mark_done('${GJOB}');`);
const jobAfter2 = await one(`SELECT helper_completed_at FROM public.jobs WHERE id='${GJOB}'`);
check(
  "A9 member #2 completes their own part; the JOB does not complete yet",
  done2.ok && jobAfter2.helper_completed_at === null,
  done2.error ?? (jobAfter2.helper_completed_at ? "job completed on 1 of 2 — owner semantic 1 violated!" : "1 of 2 done, job still open"),
);

// A10 — the LAST member closes the job (owner semantic 1).
await db.exec(
  `UPDATE public.group_job_helpers
      SET helper_arrived_at = now() - interval '2 hours',
          poster_confirmed_working_at = now() - interval '2 hours',
          poster_confirmed_arrival_at = now() - interval '2 hours',
          proof_before_urls = ARRAY['b.jpg'], proof_after_urls = ARRAY['a.jpg']
    WHERE job_id='${GJOB}' AND helper_id='${LEAD}';`,
);
const doneL = await asUser(LEAD, `SELECT public.rpc_group_member_mark_done('${GJOB}');`);
const jobAfterL = await one(`SELECT helper_completed_at FROM public.jobs WHERE id='${GJOB}'`);
check(
  "A10 the LAST member's Done rolls the job up to complete",
  doneL.ok && jobAfterL.helper_completed_at !== null,
  doneL.error ?? "",
);

// A11 — the server-owned lock: a direct client PATCH cannot stamp a member.
await db.exec(FIXTURE);
const patch = await asUser(
  M2,
  `UPDATE public.group_job_helpers SET helper_completed_at = now()
    WHERE job_id='${GJOB}' AND helper_id='${M2}';`,
);
const posterPatch = await asUser(
  POSTER,
  `UPDATE public.group_job_helpers SET poster_confirmed_arrival_at = now()
    WHERE job_id='${GJOB}' AND helper_id='${M2}';`,
);
check(
  "A11 lifecycle columns are server-owned: no client PATCH, helper or poster",
  !patch.ok && /stamped by the server/.test(patch.error) &&
    !posterPatch.ok && /stamped by the server/.test(posterPatch.error),
  `${patch.error ?? "helper patched!"} / ${posterPatch.error ?? "poster patched!"}`,
);

// ── THE ONE THAT MUST NOT REGRESS ───────────────────────────────────────────
// A12 — the single-helper path still refuses a completion with no confirmed
// arrival, and the group carve-out cannot be reached from it.
const s1 = await asUser(
  LEAD,
  `SELECT set_config('app.group_rollup_rpc','1',false);
   UPDATE public.jobs SET helper_completed_at = now() WHERE id='${SJOB}';`,
);
check(
  "A12 1-HELPER PATH UNCHANGED: still refused, and the carve-out needs is_group_job",
  !s1.ok && /completion_requires_confirmed_arrival/.test(s1.error),
  s1.error ?? "a single-helper job completed with the group flag set — REGRESSION",
);

// A13 — and the single-helper path still SUCCEEDS once its own gates are met.
await db.exec(
  `UPDATE public.jobs
      SET poster_confirmed_arrival_at = now() - interval '2 hours',
          poster_confirmed_working_at = now() - interval '2 hours',
          helper_arrived_at = now() - interval '2 hours',
          proof_before_urls = ARRAY['b.jpg'], proof_after_urls = ARRAY['a.jpg']
    WHERE id='${SJOB}';`,
);
const s2 = await asUser(LEAD, `UPDATE public.jobs SET helper_completed_at = now() WHERE id='${SJOB}';`);
const sJob = await one(`SELECT helper_completed_at FROM public.jobs WHERE id='${SJOB}'`);
check(
  "A13 1-HELPER PATH UNCHANGED: still completes when its own gates are met",
  s2.ok && sJob.helper_completed_at !== null,
  s2.error ?? "",
);

// A14 — EXECUTE is revoked from anon; the trigger functions take none at all.
const acl = await db.query(`
  SELECT p.proname,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public'
     AND p.proname LIKE ANY (ARRAY['rpc_group_member%','rpc_poster_confirm_member%','group_member_slot','enforce_group_member%'])
   ORDER BY 1`);
const anonAny = acl.rows.filter((r) => r.anon_x).map((r) => r.proname);
const triggerLeak = acl.rows.filter((r) => r.proname.startsWith("enforce_") && r.auth_x).map((r) => r.proname);
const rpcMissing = acl.rows.filter((r) => !r.proname.startsWith("enforce_") && !r.auth_x).map((r) => r.proname);
check(
  "A14 EXECUTE: anon holds none, trigger fns hold none, RPCs hold authenticated",
  anonAny.length === 0 && triggerLeak.length === 0 && rpcMissing.length === 0,
  `anon=[${anonAny}] triggers_to_authenticated=[${triggerLeak}] rpcs_missing=[${rpcMissing}]`,
);

// A15 — anon lost its default INSERT/UPDATE/DELETE on the roster table.
const tacl = await one(`
  SELECT has_table_privilege('anon','public.group_job_helpers','INSERT') AS i,
         has_table_privilege('anon','public.group_job_helpers','UPDATE') AS u,
         has_table_privilege('anon','public.group_job_helpers','DELETE') AS d,
         has_table_privilege('authenticated','public.group_job_helpers','UPDATE') AS au`);
check(
  "A15 anon holds no write grant on the roster; authenticated is untouched",
  !tacl.i && !tacl.u && !tacl.d && tacl.au,
  `anon i/u/d=${tacl.i}/${tacl.u}/${tacl.d} authenticated update=${tacl.au}`,
);

// A16 — the tracker gate is now roster-aware, and reads the MEMBER'S stamps.
await db.exec(FIXTURE);
const cM = await asUser(M2, `SELECT public.rpc_group_member_confirm('${GJOB}');`);
const oM = await asUser(M2, `SELECT public.rpc_group_member_on_the_way('${GJOB}', 30.45, -91.18);`);
const trackRow = await one(
  `SELECT status FROM public.job_tracking WHERE job_id='${GJOB}' AND helper_id='${M2}'`,
);
const workTooSoon = await asUser(
  M2,
  `UPDATE public.job_tracking SET status='working' WHERE job_id='${GJOB}' AND helper_id='${M2}';`,
);
check(
  "A16 crew member #2 gets a tracker row; 'working' still needs the poster's confirmation OF THEM",
  cM.ok && oM.ok && trackRow?.status === "on_the_way" &&
    !workTooSoon.ok && /tracker_requires_arrival/.test(workTooSoon.error),
  [cM.error, oM.error, workTooSoon.error ?? "working accepted with no poster confirm!"]
    .filter(Boolean).join(" | "),
);

// A17 — a stranger still cannot write a crew job's tracker.
const trackOutsider = await asUser(
  OUTSIDER,
  `INSERT INTO public.job_tracking (job_id, helper_id, status) VALUES ('${GJOB}', '${OUTSIDER}', 'on_the_way');`,
);
check(
  "A17 a non-member still cannot write the crew's tracker",
  !trackOutsider.ok && /tracker_not_assigned_helper/.test(trackOutsider.error),
  trackOutsider.error ?? "accepted!",
);

// A18 — 1-HELPER TRACKER PATH UNCHANGED: 'working' still needs the job's own
// poster confirmation, and a non-helper is still refused.
await db.exec(
  `UPDATE public.jobs SET poster_confirmed_arrival_at = NULL, helper_arrived_at = NULL WHERE id='${SJOB}';`,
);
const sTrack = await asUser(
  LEAD,
  `INSERT INTO public.job_tracking (job_id, helper_id, status) VALUES ('${SJOB}', '${LEAD}', 'working');`,
);
const sTrackOther = await asUser(
  M2,
  `INSERT INTO public.job_tracking (job_id, helper_id, status) VALUES ('${SJOB}', '${M2}', 'on_the_way');`,
);
check(
  "A18 1-HELPER TRACKER PATH UNCHANGED: working gated, non-helper refused",
  !sTrack.ok && /tracker_requires_arrival/.test(sTrack.error) &&
    !sTrackOther.ok && /tracker_not_assigned_helper/.test(sTrackOther.error),
  `${sTrack.error ?? "working accepted!"} / ${sTrackOther.error ?? "stranger accepted!"}`,
);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
