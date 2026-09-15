// Probe: 20260915074058 (VN-33b — the poster's "Confirm They Arrived" counts when
// the job pin is wrong: a Helpr refused as >500ft but <=1 mile is recorded as a
// near miss, and the poster's confirmation then establishes the arrival).
// NOT a vitest test; run by hand like arrival-gate.probe.mjs:
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
//   node scripts/probes/arrival-bad-pin.probe.mjs
// Base = the live shape used by arrival-gate.probe.mjs + 20260915044137 (live
// on prod, md5-checked). 1: BEFORE shows the gap (a 1,500 ft Helpr is refused
// and the poster cannot confirm). 2: the migration x3, every expectation holds.
// 3: broken copies are each caught. Exit 1 on any mismatch.
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
const GATE = read("../../supabase/migrations/20260915044137_arrival_requires_gps_and_poster.sql");
const MIG = read("../../supabase/migrations/20260915074058_arrival_bad_pin_poster_confirm.sql");

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
const HELPER2 = "33333333-3333-4333-8333-333333333333";
const JOB_LAT = 29.9296, JOB_LNG = -90.0989;
const MISS = [29.9337, -90.0989];      // ~1,490 ft north of the pin
const TWO_MI = [29.9586, -90.0989];    // ~2 miles
const PHOTOS = "ARRAY['https://x/before.jpg'], ARRAY['https://x/after.jpg']";
const J = {
  MISS: "40000000-0000-4000-8000-000000000001",     // on the way; Helpr ~1,490 ft away
  FARMILE: "40000000-0000-4000-8000-000000000002",  // on the way; Helpr ~2 mi away
  NONE: "40000000-0000-4000-8000-000000000003",     // no near miss: poster confirm refused
  STALE: "40000000-0000-4000-8000-000000000004",    // near miss 13h ago
  DONE: "40000000-0000-4000-8000-000000000005",     // near miss + poster confirmed 2h ago, photos
  MISSONLY: "40000000-0000-4000-8000-000000000006", // near miss, poster has not confirmed, photos
  REASSIGN: "40000000-0000-4000-8000-000000000007", // near miss, then reopened + re-awarded
};
const FIXTURES = `
INSERT INTO public.profiles (user_id, idv_status, is_seed) VALUES ('${POSTER}', 'verified', true);
INSERT INTO public.jobs (id, customer_id, helper_id, title, status, payment_status, stripe_session_id, budget, latitude, longitude, helper_confirmed_at, helper_on_the_way_at, proof_before_urls, proof_after_urls, require_photo_proof, is_seed) VALUES
  ('${J.MISS}',     '${POSTER}', '${HELPER}', 'miss',     'in_progress', 'escrow', 'cs_1', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '1 day', now() - interval '1 hour', NULL, NULL, true, true),
  ('${J.FARMILE}',  '${POSTER}', '${HELPER}', 'far mile', 'in_progress', 'escrow', 'cs_2', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '1 day', now() - interval '1 hour', NULL, NULL, true, true),
  ('${J.NONE}',     '${POSTER}', '${HELPER}', 'none',     'in_progress', 'escrow', 'cs_3', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '1 day', now() - interval '1 hour', NULL, NULL, true, true),
  ('${J.STALE}',    '${POSTER}', '${HELPER}', 'stale',    'in_progress', 'escrow', 'cs_4', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '1 day', now() - interval '14 hours', NULL, NULL, true, true),
  ('${J.DONE}',     '${POSTER}', '${HELPER}', 'done',     'in_progress', 'escrow', 'cs_5', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '1 day', now() - interval '4 hours', ${PHOTOS}, true, true),
  ('${J.MISSONLY}', '${POSTER}', '${HELPER}', 'miss only','in_progress', 'escrow', 'cs_6', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '1 day', now() - interval '4 hours', ${PHOTOS}, true, true),
  ('${J.REASSIGN}', '${POSTER}', '${HELPER}', 'reassign', 'in_progress', 'escrow', 'cs_7', 100, ${JOB_LAT}, ${JOB_LNG}, now() - interval '1 day', now() - interval '4 hours', NULL, NULL, true, true);
INSERT INTO public.job_tracking (job_id, helper_id, status) VALUES
  ('${J.MISS}', '${HELPER}', 'on_the_way'), ('${J.MISSONLY}', '${HELPER}', 'on_the_way');
`;
// Server-side setup of near-miss rows (service role, bypasses the locks) — only
// possible once the columns exist, i.e. after the migration.
const AFTER_FIXTURES = `
UPDATE public.jobs SET helper_arrival_near_miss_at = now() - interval '13 hours', helper_arrival_near_miss_ft = 1400 WHERE id = '${J.STALE}';
UPDATE public.jobs SET helper_arrival_near_miss_at = now() - interval '3 hours', helper_arrival_near_miss_ft = 1400, helper_arrived_at = now() - interval '2 hours', poster_confirmed_arrival_at = now() - interval '2 hours', poster_confirmed_working_at = now() - interval '2 hours' WHERE id = '${J.DONE}';
UPDATE public.jobs SET helper_arrival_near_miss_at = now() - interval '3 hours', helper_arrival_near_miss_ft = 1400, poster_confirmed_working_at = now() - interval '2 hours' WHERE id = '${J.MISSONLY}';
UPDATE public.jobs SET helper_arrival_near_miss_at = now() - interval '1 hour', helper_arrival_near_miss_ft = 1400 WHERE id = '${J.REASSIGN}';
`;

async function as(db, who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(who === "service" ? "SET ROLE service_role" : who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message, code: e.code, detail: e.detail }; }
  finally { await db.exec("RESET ROLE"); }
}
const arrive = (db, job, c) => as(db, HELPER, `SELECT public.mark_helper_arrival('${job}', ${c ? c[0] : "NULL"}, ${c ? c[1] : "NULL"}) AS v`);
const row = async (db, job) => (await db.query(`SELECT to_jsonb(j) AS r FROM public.jobs j WHERE id = '${job}'`)).rows[0].r;
const confirm = (db, job) => as(db, POSTER, `UPDATE public.jobs SET poster_confirmed_arrival_at = now() WHERE id = '${job}' RETURNING id`);
const complete = (db, job) => as(db, HELPER, `UPDATE public.jobs SET helper_completed_at = now() WHERE id = '${job}' RETURNING id`);
const track = (db, job, s) => as(db, HELPER, `UPDATE public.job_tracking SET status = '${s}' WHERE job_id = '${job}' RETURNING id`);
const landed = (r) => r.ok && r.rows.length === 1;

async function expectations(db) {
  const bad = [];
  const check = (c, m) => { if (!c) bad.push(m); };

  // A. ~1,490 ft: a near miss is recorded, NO arrival stamp, the poster is told.
  {
    const nBefore = (await db.query(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${POSTER}'`)).rows[0].n;
    const r = await arrive(db, J.MISS, MISS);
    const j = await row(db, J.MISS);
    const v = r.ok ? r.rows[0].v : null;
    check(r.ok && v.verified === false && v.poster_can_confirm === true && v.reason === "arrival_too_far" && v.distance_ft > 1300 && v.distance_ft < 1700,
      `A near miss verdict: ${r.ok ? JSON.stringify(v) : r.err}`);
    check(j.helper_arrival_near_miss_at && j.helper_arrived_at === null && j.helper_arrival_verified_at === null,
      `A near miss stamps: near_miss ${j.helper_arrival_near_miss_at} arrived ${j.helper_arrived_at} verified ${j.helper_arrival_verified_at}`);
    const nAfter = (await db.query(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${POSTER}'`)).rows[0].n;
    check(nAfter === nBefore + 1, `A poster notified once: ${nBefore} -> ${nAfter}`);
    await arrive(db, J.MISS, MISS);
    const nRetry = (await db.query(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${POSTER}'`)).rows[0].n;
    check(nRetry === nAfter, `A retry within 30 min re-notified the poster: ${nAfter} -> ${nRetry}`);
  }
  // B. ~2 miles: refused exactly as before, nothing written.
  {
    const b = await row(db, J.FARMILE);
    const r = await arrive(db, J.FARMILE, TWO_MI);
    const a = await row(db, J.FARMILE);
    check(!r.ok && /arrival_too_far/.test(r.err), `B 2 mi: expected arrival_too_far raise, got ${r.ok ? JSON.stringify(r.rows[0].v) : r.err}`);
    check(a.helper_arrival_near_miss_at === null && JSON.stringify(a) === JSON.stringify(b), `B 2 mi wrote the row`);
  }
  // C. Neither party can write the near-miss columns directly.
  {
    const h = await as(db, HELPER, `UPDATE public.jobs SET helper_arrival_near_miss_at = now() WHERE id = '${J.NONE}' RETURNING id`);
    check(!h.ok && h.code === "42501", `C helper PATCH near_miss: expected 42501, got ${h.ok ? "success" : h.code + " " + h.err}`);
    const p = await as(db, POSTER, `UPDATE public.jobs SET helper_arrival_near_miss_at = now() WHERE id = '${J.NONE}' RETURNING id`);
    check(!p.ok && p.code === "42501", `C poster PATCH near_miss: expected 42501, got ${p.ok ? "success" : p.code + " " + p.err}`);
  }
  // D. The poster confirms the near miss: arrival established, GPS still NULL.
  {
    const w0 = await track(db, J.MISS, "working");
    check(!w0.ok && /tracker_requires_arrival/.test(w0.err), `D0 tracker working on a near miss alone: expected refusal, got ${w0.ok ? "success" : w0.err}`);
    const c = await confirm(db, J.MISS);
    const j = await row(db, J.MISS);
    check(landed(c), `D poster confirm near miss refused: ${c.err}`);
    check(j.helper_arrived_at && j.poster_confirmed_arrival_at && j.helper_arrival_verified_at === null, `D stamps after confirm: ${JSON.stringify({ a: j.helper_arrived_at, p: j.poster_confirmed_arrival_at, v: j.helper_arrival_verified_at })}`);
    const again = await arrive(db, J.MISS, TWO_MI);
    check(again.ok && again.rows[0].v.arrival_established === true, `D retry after confirm: ${again.ok ? JSON.stringify(again.rows[0].v) : again.err}`);
    const t = await track(db, J.MISS, "arrived");
    check(landed(t), `D tracker arrived after confirm refused: ${t.err}`);
    const w = await track(db, J.MISS, "working");
    check(landed(w), `D tracker working after confirm refused: ${w.err}`);
  }
  // E. Poster confirm with no near miss and no arrival: still refused.
  {
    const c = await confirm(db, J.NONE);
    check(!c.ok && /arrival_confirm_before_arrival/.test(c.err), `E confirm with nothing: expected refusal, got ${c.ok ? "success" : c.err}`);
  }
  // F. A near miss older than 12h does not open the door.
  {
    const c = await confirm(db, J.STALE);
    check(!c.ok && /arrival_confirm_before_arrival/.test(c.err), `F stale near miss: expected refusal, got ${c.ok ? "success" : c.err}`);
  }
  // G. Completion: near miss + poster -> allowed; near miss alone -> refused.
  {
    const only = await complete(db, J.MISSONLY);
    check(!only.ok && /completion_requires_confirmed_arrival/.test(only.err), `G1 near miss without poster: expected refusal, got ${only.ok ? "success" : only.err}`);
    const done = await complete(db, J.DONE);
    check(landed(done), `G2 near miss + poster confirmed: expected completion, got ${done.ok ? done.rows.length + " rows" : done.err}`);
  }
  // H. A change of Helpr clears the near miss.
  {
    await db.exec(`RESET ROLE; SELECT set_config('request.uid', '', false); UPDATE public.jobs SET status = 'open', helper_id = NULL WHERE id = '${J.REASSIGN}'; UPDATE public.jobs SET status = 'accepted', helper_id = '${HELPER2}' WHERE id = '${J.REASSIGN}'`);
    const j = await row(db, J.REASSIGN);
    check(j.helper_arrival_near_miss_at === null && j.helper_arrival_near_miss_ft === null, `H near miss survived reassignment: ${j.helper_arrival_near_miss_at}`);
  }
  // I. Grants unchanged.
  {
    const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE oid = 'public.mark_helper_arrival(uuid,numeric,numeric)'::regprocedure`)).rows[0].a;
    check(acl === LIVE_ARRIVAL_ACL, `I mark_helper_arrival ACL ${acl}`);
  }
  return bad;
}

async function fresh(migs) {
  const db = new PGlite();
  await db.exec(LIVE_BASE);
  await db.exec(MARKERS);
  await db.exec(EXTRA);
  await db.exec(GATE);
  await db.exec(FIXTURES);
  for (const m of migs) await db.exec(m);
  if (migs.length) await db.exec(`RESET ROLE; SELECT set_config('request.uid', '', false); ${AFTER_FIXTURES}`);
  return db;
}

let fail = false;
{
  const db = await fresh([]);
  console.log("== BEFORE (live: 20260915044137)");
  const r = await arrive(db, J.MISS, MISS);
  const gapRefused = !r.ok && /arrival_too_far/.test(r.err);
  const c = await confirm(db, J.MISS);
  const gapConfirm = !c.ok && /arrival_confirm_before_arrival/.test(c.err);
  console.log(`${gapRefused ? "GAP   " : "open  "} a Helpr 1,490 ft from a wrong pin is refused`);
  console.log(`${gapConfirm ? "GAP   " : "open  "} the poster cannot confirm that Helpr's arrival`);
  if (!gapRefused || !gapConfirm) { fail = true; console.log("FAIL: the gap did not reproduce"); }
  await db.close();
}
{
  let bad;
  try { const db = await fresh([MIG, MIG, MIG]); bad = await expectations(db); await db.close(); } catch (e) { bad = [`apply error: ${e.message}`]; }
  console.log("\n== AFTER (migration applied 3x)");
  if (bad.length) { fail = true; console.log("FAIL\n   " + bad.join("\n   ")); } else console.log("all expectations hold (green)");
}
const mutate = (from, to) => { if (!MIG.includes(from)) throw new Error(`anchor missing: ${from.slice(0, 50)}`); return MIG.replace(from, to); };
const broken = [
  ["near-miss radius unbounded", mutate("IF NOT v_verified AND v_dist <= 5280 THEN", "IF NOT v_verified THEN")],
  ["poster confirm ignores the 12h window", mutate("AND OLD.helper_arrival_near_miss_at > now() - interval '12 hours' THEN", "THEN")],
  ["completion accepts a near miss without the poster", mutate("       OR OLD.poster_confirmed_arrival_at IS NULL THEN", "       AND OLD.poster_confirmed_arrival_at IS NULL THEN")],
  ["poster may write the near miss", mutate("    'helper_arrival_near_miss_at',\n    'helper_arrival_near_miss_ft'\n  ];", "    'helper_arrival_near_miss_ft'\n  ];")],
  ["near miss not cleared on reassignment", mutate("    NEW.helper_arrival_near_miss_at := NULL;\n    NEW.helper_arrival_near_miss_ft := NULL;\n  END IF;", "  END IF;")],
  ["tracker working on a near miss alone", mutate("     AND ((v_job.helper_arrival_verified_at IS NULL AND v_job.helper_arrival_near_miss_at IS NULL)\n          OR v_job.poster_confirmed_arrival_at IS NULL) THEN", "     AND (v_job.helper_arrival_verified_at IS NULL AND v_job.helper_arrival_near_miss_at IS NULL) THEN")],
  ["near miss stamps an arrival", mutate("         SET helper_arrival_near_miss_at = v_now,", "         SET helper_arrived_at = v_now, helper_arrival_near_miss_at = v_now,")],
];
console.log("\n== BROKEN COPIES (each must be caught)");
for (const [label, sql] of broken) {
  let bad;
  try { const db = await fresh([sql]); bad = await expectations(db); await db.close(); } catch (e) { bad = [`apply error: ${e.message}`]; }
  if (!bad.length) { fail = true; console.log(`NOT CAUGHT: ${label}`); } else console.log(`caught: ${label}\n   ${bad[0]}`);
}
console.log(fail ? "\nPROBE FAILED" : "\nPROBE PASSED");
process.exit(fail ? 1 : 0);
