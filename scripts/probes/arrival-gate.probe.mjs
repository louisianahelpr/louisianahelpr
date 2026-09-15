// Probe: 20260915044137 (VN-33 — arrival needs the server's GPS check AND the
// poster's confirmation), in real Postgres. NOT a vitest test (pglite is not a
// dependency), so run by hand:
//
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
//   node scripts/probes/arrival-gate.probe.mjs
//
// PROD SHAPE. fixtures/dispute-table-door.live.sql (generated from LIVE prod on
// 2026-09-14: the jobs table, its RLS, eight of its BEFORE triggers verbatim,
// enforce_helper_jobs_column_whitelist verbatim — md5 75de6087…), plus
// 20260915033734 (deployed; the dispute-marker trigger live on jobs), plus the
// two live bodies this migration replaces, taken from the migrations that
// created them and CHECKED against live md5(prosrc) read the same day:
//   mark_helper_arrival              3c4bdda67b58f1f7faa56880bd4a56ea (20260828011057)
//   enforce_helper_completion_gates  c988ef9309994b2f39fe39d37f5bb182 (20260912021641)
// plus job_tracking with its live columns and its three live RLS policies.
//
// 1. BEFORE, on the live shape: the holes must reproduce — a far arrival and a
//    no-fix arrival both write helper_arrived_at, a plain PATCH writes it, the
//    tracker can be moved to Working with no arrival, completion passes with
//    ONLY the GPS stamp and with ONLY the poster's confirmation, a helper's
//    direct status=completed lands, a stranger can write another job's
//    tracker, a re-awarded job hands the next helper the previous arrival, and
//    the poster can write the GPS stamp (the last four from the VN-33
//    lh-verification-credentials review).
// 2. The migration applied verbatim three times: every expectation holds.
// 3. Deliberately broken copies, each on a fresh database: every one must FAIL
//    at least one expectation, or this probe cannot fail.
// Exit 1 on any mismatch.
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const LIVE_BASE = read("./fixtures/dispute-table-door.live.sql");
const MARKERS = read("../../supabase/migrations/20260915033734_dispute_markers_server_owned.sql");
const MIG = read("../../supabase/migrations/20260915044137_arrival_requires_gps_and_poster.sql");

const extract = (file, re) => {
  const m = read(file).match(re);
  if (!m) throw new Error(`could not extract live body from ${file}`);
  return m[0];
};
const LIVE_ARRIVAL = extract(
  "../../supabase/migrations/20260828011057_verified_arrival_gate.sql",
  /CREATE OR REPLACE FUNCTION public\.mark_helper_arrival\([\s\S]*?\n\$\$;/,
);
const LIVE_NO_SHOW = extract(
  "../../supabase/migrations/20260831183302_no_show_ladder_uses_shared_review_rung.sql",
  /CREATE OR REPLACE FUNCTION public\.report_helper_no_show\(p_job_id uuid\)[\s\S]*?\n\$function\$;/,
);
const LIVE_GATES = extract(
  "../../supabase/migrations/20260912021641_require_photo_proof_per_job.sql",
  /CREATE OR REPLACE FUNCTION public\.enforce_helper_completion_gates\(\)[\s\S]*?\n\$function\$;/,
);
const LIVE_MD5 = {
  mark_helper_arrival: "3c4bdda67b58f1f7faa56880bd4a56ea",
  enforce_helper_completion_gates: "c988ef9309994b2f39fe39d37f5bb182",
  enforce_helper_jobs_column_whitelist: "75de6087f63b61837a3f134bd5adc11b",
  enforce_poster_jobs_money_lock: "3727688fcc4e055f35cb105e52f1ee08",
  report_helper_no_show: "4c902d5c610fbcdd0132d052e0bd85b9",
};
const LIVE_ARRIVAL_ACL = "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}";

const EXTRA = `
${LIVE_ARRIVAL}
REVOKE ALL ON FUNCTION public.mark_helper_arrival(uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_helper_arrival(uuid, numeric, numeric) TO authenticated, service_role;
${LIVE_GATES}
CREATE TRIGGER trg_helper_completion_gates BEFORE UPDATE OF helper_completed_at ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_helper_completion_gates();

-- report_helper_no_show, verbatim, over two stubs: the violation table and
-- the shared ladder core (the strike itself is not under test, only whether
-- the report is refused and what it leaves on the job row).
CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid, violation_type text, reported_by uuid);
CREATE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text, p_job_id uuid, p_prior_count int, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean, p_suspension_days int, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
 RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.user_violations (user_id, job_id, violation_type) VALUES (p_user, p_job_id, p_violation_type); RETURN '{}'::jsonb; END $$;
${LIVE_NO_SHOW}
REVOKE ALL ON FUNCTION public.report_helper_no_show(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_helper_no_show(uuid) TO authenticated, service_role;

CREATE TABLE public.job_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL, helper_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'assigned',
  latitude numeric, longitude numeric, eta_minutes integer,
  updated_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now()
);
ALTER TABLE public.job_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Helpers can insert tracking" ON public.job_tracking FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = helper_id));
CREATE POLICY "Helpers can update their tracking" ON public.job_tracking FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = helper_id));
CREATE POLICY "Job participants can view tracking" ON public.job_tracking FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) IN ( SELECT jobs.customer_id FROM jobs WHERE (jobs.id = job_tracking.job_id))) OR (( SELECT auth.uid() AS uid) = helper_id)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_tracking TO authenticated;
GRANT ALL ON public.job_tracking TO service_role;
`;

const POSTER = "76b07824-9b41-4741-a4c4-4f8de362f682";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const STRANGER = "11111111-1111-4111-8111-111111111111";   // another Helpr, not on these jobs
const HELPER2 = "33333333-3333-4333-8333-333333333333";    // the next Helpr after a reopen
const JOB_LAT = 29.9296, JOB_LNG = -90.0989;             // New Orleans (the seed job's own site)
const FAR = [47.6062, -122.3321];                         // Seattle, ~2,100 mi
const NEAR = [29.92965, -90.09895];                       // ~20 ft from the pin
const PHOTOS = "ARRAY['https://x/before.jpg'], ARRAY['https://x/after.jpg']";

const J = {
  FAR: "30000000-0000-4000-8000-000000000001",       // in_progress, on the way, no arrival
  NOFIX: "30000000-0000-4000-8000-000000000002",     // in_progress, on the way, no arrival
  PATCH: "30000000-0000-4000-8000-000000000003",     // in_progress, on the way, no arrival
  NEAR: "30000000-0000-4000-8000-000000000004",      // ACCEPTED, no arrival: RPC transitions it
  GPS_ONLY: "30000000-0000-4000-8000-000000000005",  // verified, poster has not confirmed
  POSTER_ONLY: "30000000-0000-4000-8000-000000000006", // claimed + poster confirmed, no GPS
  BOTH: "30000000-0000-4000-8000-000000000007",      // verified + poster confirmed
  NONE: "30000000-0000-4000-8000-000000000008",      // nothing
  LEGACY: "30000000-0000-4000-8000-000000000009",    // bare claim from before 2026-08-28
  TRACK: "30000000-0000-4000-8000-00000000000a",     // tracker lane: verified, poster not yet
  STATUS: "30000000-0000-4000-8000-00000000000b",    // nothing: helper writes status=completed
  OTHER: "30000000-0000-4000-8000-00000000000c",     // STRANGER's job (re-point target)
  REASSIGN: "30000000-0000-4000-8000-00000000000d",  // both stamps, then reopened + re-awarded
  NOSHOW: "30000000-0000-4000-8000-00000000000e",    // both stamps, start passed: poster reports no-show
  POSTER_DONE: "30000000-0000-4000-8000-00000000000f", // poster completed, no arrival: helper writes status
};

const FIXTURES = `
INSERT INTO public.profiles (user_id, idv_status, is_seed) VALUES ('${POSTER}', 'verified', true);
INSERT INTO public.jobs (id, customer_id, helper_id, title, status, payment_status, stripe_session_id, budget, latitude, longitude, helper_confirmed_at, helper_on_the_way_at, helper_arrived_at, helper_arrival_verified_at, poster_confirmed_arrival_at, poster_confirmed_working_at, proof_before_urls, proof_after_urls, require_photo_proof, is_seed) VALUES
  ('${J.FAR}',         '${POSTER}', '${HELPER}', 'far',         'in_progress', 'escrow', 'cs_1', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '1 day', now() - interval '1 hour', NULL, NULL, NULL, NULL, NULL, NULL, true, true),
  ('${J.NOFIX}',       '${POSTER}', '${HELPER}', 'no fix',      'in_progress', 'escrow', 'cs_2', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '1 day', now() - interval '1 hour', NULL, NULL, NULL, NULL, NULL, NULL, true, true),
  ('${J.PATCH}',       '${POSTER}', '${HELPER}', 'patch',       'in_progress', 'escrow', 'cs_3', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '1 day', now() - interval '1 hour', NULL, NULL, NULL, NULL, NULL, NULL, true, true),
  ('${J.NEAR}',        '${POSTER}', '${HELPER}', 'near',        'accepted',    'escrow', 'cs_4', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '1 day', NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, true),
  ('${J.GPS_ONLY}',    '${POSTER}', '${HELPER}', 'gps only',    'in_progress', 'escrow', 'cs_5', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '1 day', now() - interval '3 hours', now() - interval '2 hours', now() - interval '2 hours', NULL, now() - interval '2 hours', ${PHOTOS}, true, true),
  ('${J.POSTER_ONLY}', '${POSTER}', '${HELPER}', 'poster only', 'in_progress', 'escrow', 'cs_6', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '1 day', now() - interval '3 hours', now() - interval '2 hours', NULL, now() - interval '2 hours', now() - interval '2 hours', ${PHOTOS}, true, true),
  ('${J.BOTH}',        '${POSTER}', '${HELPER}', 'both',        'in_progress', 'escrow', 'cs_7', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '1 day', now() - interval '3 hours', now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours', ${PHOTOS}, true, true),
  ('${J.NONE}',        '${POSTER}', '${HELPER}', 'none',        'in_progress', 'escrow', 'cs_8', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '1 day', now() - interval '3 hours', NULL, NULL, NULL, now() - interval '2 hours', ${PHOTOS}, true, true),
  ('${J.LEGACY}',      '${POSTER}', '${HELPER}', 'legacy',      'in_progress', 'escrow', 'cs_9', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '30 days', NULL, timestamptz '2026-08-20 12:00:00+00', NULL, NULL, NULL, ${PHOTOS}, true, true),
  ('${J.TRACK}',       '${POSTER}', '${HELPER}', 'tracker',     'in_progress', 'escrow', 'cs_a', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '1 day', now() - interval '1 hour', NULL, NULL, NULL, NULL, NULL, NULL, true, true),
  ('${J.STATUS}',      '${POSTER}', '${HELPER}', 'status',      'in_progress', 'escrow', 'cs_b', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '1 day', now() - interval '3 hours', NULL, NULL, NULL, now() - interval '2 hours', ${PHOTOS}, true, true),
  ('${J.OTHER}',       '${POSTER}', '${STRANGER}', 'other',     'in_progress', 'escrow', 'cs_c', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '1 day', now() - interval '1 hour', NULL, NULL, NULL, NULL, NULL, NULL, true, true),
  ('${J.REASSIGN}',    '${POSTER}', '${HELPER}', 'reassign',    'in_progress', 'escrow', 'cs_d', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '1 day', now() - interval '3 hours', now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours', ${PHOTOS}, true, true),
  ('${J.NOSHOW}',      '${POSTER}', '${HELPER}', 'no-show',     'in_progress', 'escrow', 'cs_e', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '2 days', now() - interval '3 hours', now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours', NULL, NULL, NULL, true, true),
  ('${J.POSTER_DONE}', '${POSTER}', '${HELPER}', 'poster done', 'in_progress', 'escrow', 'cs_f', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '2 days', NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, true);
UPDATE public.jobs SET date_needed = current_date - 1 WHERE id IN ('${J.NOSHOW}', '${J.NONE}');
UPDATE public.jobs SET poster_completed_at = now() - interval '1 hour' WHERE id = '${J.POSTER_DONE}';
INSERT INTO public.job_tracking (job_id, helper_id, status, latitude, longitude) VALUES
  ('${J.FAR}', '${HELPER}', 'on_the_way', ${FAR[0]}, ${FAR[1]}),
  ('${J.TRACK}', '${HELPER}', 'on_the_way', ${NEAR[0]}, ${NEAR[1]});
`;

async function as(db, who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(who === "service" ? "SET ROLE service_role" : who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message, code: e.code, detail: e.detail }; }
  finally { await db.exec("RESET ROLE"); }
}

const arrive = (db, job, coords) =>
  as(db, HELPER, `SELECT public.mark_helper_arrival('${job}', ${coords ? coords[0] : "NULL"}, ${coords ? coords[1] : "NULL"}) AS v`);
const snap = async (db, job) =>
  (await db.query(`SELECT xmin::text AS xmin, status::text AS status, helper_arrived_at, helper_arrival_verified_at, poster_confirmed_arrival_at, helper_completed_at FROM public.jobs WHERE id = '${job}'`)).rows[0];
const complete = (db, job) =>
  as(db, HELPER, `UPDATE public.jobs SET helper_completed_at = now() WHERE id = '${job}' RETURNING id`);
const track = (db, job, status) =>
  as(db, HELPER, `UPDATE public.job_tracking SET status = '${status}' WHERE job_id = '${job}' RETURNING id`);
const landed = (r) => r.ok && r.rows.length === 1;

async function expectations(db) {
  const bad = [];
  const check = (cond, msg) => { if (!cond) bad.push(msg); };

  // Rebuilt from live: the bodies the migration replaced were the live ones.
  // (Checked on the fixture before the migration runs; see fresh().)

  // A. FAR arrival (~2,100 mi): refused, distance reported, NOTHING written.
  {
    const before = await snap(db, J.FAR);
    const r = await arrive(db, J.FAR, FAR);
    const after = await snap(db, J.FAR);
    check(!r.ok && /arrival_too_far/.test(r.err), `A far arrival: expected arrival_too_far, got ${r.ok ? `success ${JSON.stringify(r.rows[0]?.v)}` : r.err}`);
    const ft = Number((r.detail ?? "").match(/distance_ft=(\d+)/)?.[1]);
    check(ft > 10_000_000 && ft < 12_000_000, `A far arrival: expected DETAIL distance_ft≈11 million ft (~2,100 mi), got '${r.detail}'`);
    check(before.xmin === after.xmin && after.helper_arrived_at === null && after.helper_arrival_verified_at === null,
      `A far arrival wrote the row: xmin ${before.xmin} -> ${after.xmin}, helper_arrived_at ${after.helper_arrived_at}`);
  }

  // B. NO FIX: refused, nothing written.
  {
    const before = await snap(db, J.NOFIX);
    const r = await arrive(db, J.NOFIX, null);
    const after = await snap(db, J.NOFIX);
    check(!r.ok && /arrival_location_required/.test(r.err), `B no-fix arrival: expected arrival_location_required, got ${r.ok ? "success" : r.err}`);
    check(before.xmin === after.xmin && after.helper_arrived_at === null, `B no-fix arrival wrote the row (helper_arrived_at ${after.helper_arrived_at})`);
  }

  // C. The table door: a helper PATCH of helper_arrived_at is refused.
  {
    const before = await snap(db, J.PATCH);
    const r = await as(db, HELPER, `UPDATE public.jobs SET helper_arrived_at = now() WHERE id = '${J.PATCH}' RETURNING id`);
    const after = await snap(db, J.PATCH);
    check(!r.ok && r.code === "42501", `C helper PATCH helper_arrived_at: expected 42501, got ${r.ok ? `success (${r.rows.length} row)` : `${r.code} ${r.err}`}`);
    check(before.xmin === after.xmin, `C helper PATCH changed the row`);
  }

  // D. NEAR arrival (~20 ft) on an accepted job: works, both stamps together,
  //    status moves to in_progress. A second call from far away is a no-op.
  {
    const r = await arrive(db, J.NEAR, NEAR);
    const s = await snap(db, J.NEAR);
    check(r.ok && r.rows[0].v.verified === true, `D near arrival refused: ${r.ok ? JSON.stringify(r.rows[0].v) : r.err}`);
    check(s.helper_arrived_at && s.helper_arrival_verified_at && s.status === "in_progress", `D near arrival did not stamp both + in_progress: ${JSON.stringify(s)}`);
    const again = await arrive(db, J.NEAR, FAR);
    const s2 = await snap(db, J.NEAR);
    check(again.ok && again.rows[0].v.verified === true, `D2 repeat call after verification refused: ${again.err}`);
    check(s2.xmin === s.xmin, `D2 repeat call rewrote the row`);
  }

  // E. COMPLETION by the helper.
  {
    const gps = await complete(db, J.GPS_ONLY);
    check(!gps.ok && /completion_requires_confirmed_arrival/.test(gps.err), `E1 completion with ONLY GPS: expected refusal, got ${gps.ok ? "success" : gps.err}`);
    const poster = await complete(db, J.POSTER_ONLY);
    check(!poster.ok && /completion_requires_confirmed_arrival/.test(poster.err), `E2 completion with ONLY the poster's confirmation: expected refusal, got ${poster.ok ? "success" : poster.err}`);
    const none = await complete(db, J.NONE);
    check(!none.ok && /completion_requires_confirmed_arrival/.test(none.err), `E3 completion with neither: expected refusal, got ${none.ok ? "success" : none.err}`);
    const legacy = await complete(db, J.LEGACY);
    check(!legacy.ok && /completion_requires_confirmed_arrival/.test(legacy.err), `E4 pre-2026-08-28 bare claim: expected refusal (no grandfather), got ${legacy.ok ? "success" : legacy.err}`);
    const both = await complete(db, J.BOTH);
    check(landed(both), `E5 completion with BOTH: expected success, got ${both.ok ? `${both.rows.length} rows` : both.err}`);
    // The other gates are untouched: both stamps but no photos is still refused.
    await db.exec(`UPDATE public.jobs SET proof_after_urls = NULL WHERE id = '${J.GPS_ONLY}'`);
    await as(db, POSTER, `UPDATE public.jobs SET poster_confirmed_arrival_at = now() WHERE id = '${J.GPS_ONLY}' RETURNING id`);
    const nophotos = await complete(db, J.GPS_ONLY);
    check(!nophotos.ok && /completion_requires_proof_photos/.test(nophotos.err), `E6 both stamps, no after photo: expected completion_requires_proof_photos, got ${nophotos.ok ? "success" : nophotos.err}`);
  }

  // F. The poster's confirmation is still writable by the poster.
  {
    const r = await as(db, POSTER, `UPDATE public.jobs SET poster_confirmed_arrival_at = now() WHERE id = '${J.POSTER_ONLY}' AND poster_confirmed_arrival_at IS NOT NULL RETURNING id`);
    check(r.ok, `F poster confirmation write errored: ${r.err}`);
  }

  // G. THE TRACKER cannot lead the arrival.
  {
    const arrivedNoArrival = await track(db, J.FAR, "arrived");
    check(!arrivedNoArrival.ok && /tracker_requires_arrival/.test(arrivedNoArrival.err), `G1 tracker -> arrived with no arrival: expected refusal, got ${arrivedNoArrival.ok ? "success" : arrivedNoArrival.err}`);
    const workingNoArrival = await track(db, J.FAR, "working");
    check(!workingNoArrival.ok && /tracker_requires_arrival/.test(workingNoArrival.err), `G2 tracker -> working with no arrival: expected refusal, got ${workingNoArrival.ok ? "success" : workingNoArrival.err}`);
    const ping = await as(db, HELPER, `UPDATE public.job_tracking SET latitude = 1, longitude = 1 WHERE job_id = '${J.FAR}' RETURNING id`);
    check(landed(ping), `G3 position ping refused: ${ping.err}`);
    const insertWorking = await as(db, HELPER, `INSERT INTO public.job_tracking (job_id, helper_id, status) VALUES ('${J.NONE}', '${HELPER}', 'working') RETURNING id`);
    check(!insertWorking.ok && /tracker_requires_arrival/.test(insertWorking.err), `G4 INSERT a tracking row straight at working: expected refusal, got ${insertWorking.ok ? "success" : insertWorking.err}`);
    // Real arrival, then working before the poster confirms, then after.
    const a = await arrive(db, J.TRACK, NEAR);
    check(a.ok, `G5 near arrival on tracker job refused: ${a.err}`);
    const arrived = await track(db, J.TRACK, "arrived");
    check(landed(arrived), `G6 tracker -> arrived after a real arrival refused: ${arrived.err}`);
    const early = await track(db, J.TRACK, "working");
    check(!early.ok && /tracker_requires_arrival/.test(early.err), `G7 tracker -> working with GPS only: expected refusal, got ${early.ok ? "success" : early.err}`);
    await as(db, POSTER, `UPDATE public.jobs SET poster_confirmed_arrival_at = now() WHERE id = '${J.TRACK}' RETURNING id`);
    const working = await track(db, J.TRACK, "working");
    check(landed(working), `G8 tracker -> working with both refused: ${working.err}`);
    const done = await track(db, J.TRACK, "done");
    check(!done.ok && /tracker_requires_completion/.test(done.err), `G9 tracker -> done with no completion: expected refusal, got ${done.ok ? "success" : done.err}`);
  }

  // I. The status door: the assigned helper writing status = 'completed'
  //    directly is a completion, and gets the same arrival gate.
  {
    const before = await snap(db, J.STATUS);
    const r = await as(db, HELPER, `UPDATE public.jobs SET status = 'completed' WHERE id = '${J.STATUS}' RETURNING id`);
    const after = await snap(db, J.STATUS);
    check(!r.ok && /helper_cannot_complete_by_status/.test(r.err), `I1 helper status=completed with neither stamp: expected refusal, got ${r.ok ? `success (${r.rows.length} row)` : r.err}`);
    check(before.xmin === after.xmin && after.status === "in_progress", `I1 status write changed the row: ${JSON.stringify(after)}`);
    const done = await as(db, HELPER, `UPDATE public.jobs SET status = 'completed' WHERE id = '${J.POSTER_DONE}' RETURNING id`);
    check(!done.ok && /helper_cannot_complete_by_status/.test(done.err), `I2 helper status=completed on a poster-completed job with no arrival: expected refusal, got ${done.ok ? `success (${done.rows.length} row)` : done.err}`);
  }

  // J. The tracker belongs to the job's assigned helper.
  {
    const stranger = await as(db, STRANGER, `INSERT INTO public.job_tracking (job_id, helper_id, status, latitude, longitude) VALUES ('${J.TRACK}', '${STRANGER}', 'on_the_way', 1, 1) RETURNING id`);
    check(!stranger.ok && /tracker_not_assigned_helper/.test(stranger.err), `J1 stranger inserts a tracking row on someone else's job: expected refusal, got ${stranger.ok ? "success" : stranger.err}`);
    const repoint = await as(db, HELPER, `UPDATE public.job_tracking SET job_id = '${J.OTHER}' WHERE job_id = '${J.TRACK}' RETURNING id`);
    check(!repoint.ok && /tracker_not_assigned_helper/.test(repoint.err), `J2 helper re-points their tracking row at another Helpr's job: expected refusal, got ${repoint.ok ? `success (${repoint.rows.length} row)` : repoint.err}`);
  }

  // K. Reopen + re-award: the next helper starts with no arrival, and the
  //    previous helper's tracking row can no longer move on the poster's map.
  {
    await db.exec(`INSERT INTO public.job_tracking (job_id, helper_id, status, latitude, longitude) VALUES ('${J.REASSIGN}', '${HELPER}', 'working', ${NEAR[0]}, ${NEAR[1]})`);
    // report_helper_no_show's write, as the platform (uid NULL).
    await db.exec(`RESET ROLE; SELECT set_config('request.uid', '', false); UPDATE public.jobs SET status = 'open', helper_id = NULL WHERE id = '${J.REASSIGN}'`);
    const reopened = await snap(db, J.REASSIGN);
    check(!reopened.helper_arrived_at && !reopened.helper_arrival_verified_at && !reopened.poster_confirmed_arrival_at,
      `K1 reopened job kept the previous helper's arrival: ${JSON.stringify(reopened)}`);
    await db.exec(`UPDATE public.jobs SET status = 'accepted', helper_id = '${HELPER2}' WHERE id = '${J.REASSIGN}'`);
    const r = await as(db, HELPER2, `SELECT public.mark_helper_arrival('${J.REASSIGN}', NULL, NULL) AS v`);
    check(!r.ok && /arrival_location_required/.test(r.err), `K2 next helper with no location: expected arrival_location_required, got ${r.ok ? JSON.stringify(r.rows[0].v) : r.err}`);
    const stalePing = await as(db, HELPER, `UPDATE public.job_tracking SET latitude = 10, longitude = 10 WHERE job_id = '${J.REASSIGN}' RETURNING id`);
    check(!stalePing.ok && /tracker_not_assigned_helper/.test(stalePing.err), `K3 former helper's position ping after reassignment: expected refusal, got ${stalePing.ok ? `success (${stalePing.rows.length} row)` : stalePing.err}`);
  }

  // M. No no-show report once the helper has arrived — and the arrival
  //    evidence stays on the row.
  {
    const r = await as(db, POSTER, `SELECT public.report_helper_no_show('${J.NOSHOW}') AS v`);
    const s = await snap(db, J.NOSHOW);
    check(!r.ok && /helper_already_arrived/.test(r.err), `M1 no-show after a verified, confirmed arrival: expected helper_already_arrived, got ${r.ok ? JSON.stringify(r.rows[0].v) : r.err}`);
    check(s.status === "in_progress" && !!s.helper_arrival_verified_at && !!s.poster_confirmed_arrival_at, `M2 the no-show attempt changed the job: ${JSON.stringify(s)}`);
    const strikes = (await db.query(`SELECT count(*)::int AS n FROM public.user_violations WHERE job_id = '${J.NOSHOW}'`)).rows[0].n;
    check(strikes === 0, `M3 a no-show strike was recorded against a helper who arrived (${strikes})`);
    // A genuine no-show (no arrival) still works.
    const real = await as(db, POSTER, `SELECT public.report_helper_no_show('${J.NONE}') AS v`);
    check(real.ok, `M4 a no-show with no arrival was refused: ${real.err}`);
  }

  // L. The poster cannot write the GPS half, nor confirm an arrival that
  //    has not happened.
  {
    const forge = await as(db, POSTER, `UPDATE public.jobs SET helper_arrival_verified_at = now() WHERE id = '${J.NONE}' RETURNING id`);
    check(!forge.ok && forge.code === "42501", `L1 poster writes helper_arrival_verified_at: expected 42501, got ${forge.ok ? `success (${forge.rows.length} row)` : `${forge.code} ${forge.err}`}`);
    const claim = await as(db, POSTER, `UPDATE public.jobs SET helper_arrived_at = now() WHERE id = '${J.NONE}' RETURNING id`);
    check(!claim.ok && claim.code === "42501", `L1b poster writes helper_arrived_at: expected 42501, got ${claim.ok ? `success (${claim.rows.length} row)` : `${claim.code} ${claim.err}`}`);
    const early = await as(db, POSTER, `UPDATE public.jobs SET poster_confirmed_arrival_at = now() WHERE id = '${J.FAR}' RETURNING id`);
    check(!early.ok && /arrival_confirm_before_arrival/.test(early.err), `L2 poster confirms before any arrival: expected refusal, got ${early.ok ? `success (${early.rows.length} row)` : early.err}`);
  }

  // H. Grants: the RPC keeps its live ACL; anon cannot call it; the new
  //    trigger function is not callable by a client role.
  {
    const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE oid = 'public.mark_helper_arrival(uuid,numeric,numeric)'::regprocedure`)).rows[0].a;
    check(acl === LIVE_ARRIVAL_ACL, `H1 mark_helper_arrival ACL ${acl}, live is ${LIVE_ARRIVAL_ACL}`);
    const anon = await as(db, null, `SELECT public.mark_helper_arrival('${J.PATCH}', ${NEAR[0]}, ${NEAR[1]})`);
    check(!anon.ok && /permission denied/.test(anon.err), `H2 anon could call mark_helper_arrival: ${anon.ok ? "success" : anon.err}`);
    const f = (await db.query(`SELECT proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure('public.enforce_job_tracking_arrival_gate()')`)).rows[0];
    check(f && !/(^|[{,])(anon|authenticated)?=X/.test(f.acl ?? "{=X}"), `H3 enforce_job_tracking_arrival_gate callable by a client role: ${f?.acl}`);
  }
  return bad;
}

async function fresh(mig, times) {
  const db = new PGlite();
  await db.exec(LIVE_BASE);
  await db.exec(MARKERS);
  await db.exec(EXTRA);
  // The bodies in play before the migration are the LIVE ones.
  const md5 = (await db.query(`SELECT proname, md5(prosrc) AS m FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1)`, [Object.keys(LIVE_MD5)])).rows;
  for (const { proname, m } of md5) {
    if (m !== LIVE_MD5[proname]) throw new Error(`fixture ${proname} md5 ${m} is not the live ${LIVE_MD5[proname]}`);
  }
  if (md5.length !== Object.keys(LIVE_MD5).length) throw new Error(`expected ${Object.keys(LIVE_MD5).length} live bodies, found ${md5.length}`);
  for (let i = 0; i < times; i++) await db.exec(mig);
  await db.exec(FIXTURES);
  return db;
}

async function run(label, mig, times = 3) {
  const db = await fresh(mig, times);
  const bad = await expectations(db);
  await db.close();
  return { label, bad };
}

let fail = false;

// ── 1. BEFORE: the holes, on the live shape ─────────────────────────────────
{
  const db = await fresh("", 0);
  console.log("== BEFORE (live shape, no migration)");
  const hits = [];
  const show = (label, hole, extra = "") => { console.log(`${hole ? "HOLE   " : "closed "} ${label}${extra}`); hits.push(hole); };
  {
    const b = await snap(db, J.FAR);
    const r = await arrive(db, J.FAR, FAR);
    const a = await snap(db, J.FAR);
    show("far arrival (~2,100 mi) writes helper_arrived_at", r.ok && !!a.helper_arrived_at, ` (verdict ${JSON.stringify(r.rows?.[0]?.v)}, xmin ${b.xmin} -> ${a.xmin})`);
  }
  {
    const r = await arrive(db, J.NOFIX, null);
    const a = await snap(db, J.NOFIX);
    show("no-fix arrival writes helper_arrived_at", r.ok && !!a.helper_arrived_at);
  }
  {
    const r = await as(db, HELPER, `UPDATE public.jobs SET helper_arrived_at = now() WHERE id = '${J.PATCH}' RETURNING id`);
    show("helper PATCH helper_arrived_at lands", landed(r));
  }
  show("completion with ONLY GPS lands", landed(await complete(db, J.GPS_ONLY)));
  show("completion with ONLY the poster's confirmation lands", landed(await complete(db, J.POSTER_ONLY)));
  show("tracker -> working with no arrival lands", landed(await track(db, J.TRACK, "working")));
  show("helper status=completed with neither stamp lands", landed(await as(db, HELPER, `UPDATE public.jobs SET status = 'completed' WHERE id = '${J.STATUS}' RETURNING id`)));
  show("stranger inserts a tracking row on someone else's job", landed(await as(db, STRANGER, `INSERT INTO public.job_tracking (job_id, helper_id, status) VALUES ('${J.TRACK}', '${STRANGER}', 'on_the_way') RETURNING id`)));
  {
    await db.exec(`RESET ROLE; SELECT set_config('request.uid', '', false); UPDATE public.jobs SET status = 'open', helper_id = NULL WHERE id = '${J.REASSIGN}'; UPDATE public.jobs SET status = 'accepted', helper_id = '${HELPER2}' WHERE id = '${J.REASSIGN}'`);
    const inherited = await snap(db, J.REASSIGN);
    // Live RPC has no early return, so the inheritance shows on the row: the
    // next helper already carries BOTH halves of an arrival they never made.
    show("next helper after a reopen inherits the previous helper's GPS + poster confirmation", !!inherited.helper_arrival_verified_at && !!inherited.poster_confirmed_arrival_at);
  }
  show("poster reports a no-show on a helper who arrived (strike + stamps gone)", (await as(db, POSTER, `SELECT public.report_helper_no_show('${J.NOSHOW}') AS v`)).ok);
  show("poster writes helper_arrival_verified_at", landed(await as(db, POSTER, `UPDATE public.jobs SET helper_arrival_verified_at = now() WHERE id = '${J.NONE}' RETURNING id`)));
  await db.close();
  const r = await run("live shape", "", 0);
  console.log(`expectations on the live shape: ${r.bad.length} failing`);
  if (!hits.every(Boolean) || r.bad.length === 0) { fail = true; console.log("FAIL: the holes did not reproduce on the live shape, so this probe proves nothing"); }
  else console.log("holes reproduced (red)");
}

// ── 2. AFTER: migration verbatim, three times ───────────────────────────────
{
  const r = await run("migration x3", MIG, 3);
  console.log("\n== AFTER (migration applied 3x)");
  if (r.bad.length) { fail = true; console.log("FAIL\n   " + r.bad.join("\n   ")); }
  else console.log("all expectations hold (green)");
}

// ── 3. Broken copies must each be caught ────────────────────────────────────
const mutate = (from, to, src = MIG) => {
  if (!src.includes(from)) throw new Error(`mutation anchor missing: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};
const broken = [
  ["far arrival not refused", mutate("    IF NOT v_verified THEN\n", "    IF false THEN\n")],
  ["no-fix arrival not refused", mutate("  IF p_lat IS NULL OR p_lng IS NULL THEN\n", "  IF false THEN\n")],
  ["completion gate back to OR (either one unlocks)", mutate("    IF OLD.helper_arrival_verified_at IS NULL\n       OR OLD.poster_confirmed_arrival_at IS NULL THEN", "    IF OLD.helper_arrival_verified_at IS NULL\n       AND OLD.poster_confirmed_arrival_at IS NULL THEN")],
  ["helper_arrived_at left on the helper whitelist", mutate("    'helper_on_the_way_at',\n", "    'helper_on_the_way_at',\n    'helper_arrived_at',\n")],
  ["tracker trigger never created", mutate("    CREATE TRIGGER trg_job_tracking_arrival_gate\n      BEFORE INSERT OR UPDATE ON public.job_tracking\n      FOR EACH ROW EXECUTE FUNCTION public.enforce_job_tracking_arrival_gate();\n", "    NULL;\n")],
  ["tracker lets working through on GPS only", mutate("     AND (v_job.helper_arrival_verified_at IS NULL OR v_job.poster_confirmed_arrival_at IS NULL) THEN", "     AND v_job.helper_arrival_verified_at IS NULL THEN")],
  ["helper status=completed not refused", mutate("  IF NEW.status::text = 'completed'\n", "  IF false AND NEW.status::text = 'completed'\n")],
  ["position pings skip the helper check", mutate("  IF v_job.helper_id IS DISTINCT FROM NEW.helper_id THEN\n", "  IF TG_OP = 'INSERT' AND v_job.helper_id IS DISTINCT FROM NEW.helper_id THEN\n")],
  ["no-show allowed after arrival", mutate("  IF v_arrived_at IS NOT NULL OR v_helper_completed_at IS NOT NULL THEN\n", "  IF false THEN\n")],
  ["tracker does not check the row's helper", mutate("  IF v_job.helper_id IS DISTINCT FROM NEW.helper_id THEN\n", "  IF false THEN\n")],
  ["arrival not reset on reassignment", mutate("    NEW.helper_arrival_verified_at := NULL;\n", "")],
  ["poster may write the GPS stamp", mutate("    'helper_arrived_at',\n    'helper_arrival_verified_at'\n  ];", "    'helper_arrived_at'\n  ];")],
  ["poster may confirm before arrival", mutate("     AND NEW.helper_arrived_at IS NULL THEN\n", "     AND false THEN\n")],
  ["RPC grants widened to anon", mutate("REVOKE ALL ON FUNCTION public.mark_helper_arrival(uuid, numeric, numeric) FROM PUBLIC, anon;", "GRANT EXECUTE ON FUNCTION public.mark_helper_arrival(uuid, numeric, numeric) TO anon;")],
];
console.log("\n== BROKEN COPIES (each must be caught)");
for (const [label, sql] of broken) {
  let r;
  try { r = await run(label, sql); } catch (e) { r = { bad: [`apply error: ${e.message}`] }; }
  if (r.bad.length === 0) { fail = true; console.log(`NOT CAUGHT: ${label}`); }
  else console.log(`caught: ${label}\n   ${r.bad.slice(0, 2).join("\n   ")}${r.bad.length > 2 ? `\n   (+${r.bad.length - 2} more)` : ""}`);
}

console.log(fail ? "\nPROBE FAILED" : "\nPROBE PASSED");
process.exit(fail ? 1 : 0);
