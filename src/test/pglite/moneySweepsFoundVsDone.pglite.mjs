/**
 * PGlite proof for 20260926040817_money_sweeps_found_vs_done (CJ-007, Q436 (c)).
 *
 *   node src/test/pglite/moneySweepsFoundVsDone.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite.
 *
 * Proves: applies 3x; sweep_release_last_chance and detect_stuck_payments
 * return {found, ...dispositions, failed} and count every path (sent, already
 * alerted, seed logged, seed already logged, raised); each run goes through
 * its real cron command (cron_record_work, 20260925231818) into cron_run_log;
 * and the real sweep_silent_cron_failures files a 'cron-silent' / 'candidates'
 * row for each job after two consecutive runs where every row raised, and
 * none while they work. RED: the previous bodies (integer results) on the
 * same failing fixture give the detector nothing to read, so it files nothing.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const fnFrom = (sql, name) => {
  const i = sql.indexOf(`FUNCTION public.${name}(`);
  const start = sql.lastIndexOf("CREATE", i);
  const tag = /AS (\$[a-z_]*\$)/.exec(sql.slice(i))[1];
  const open = sql.indexOf(tag, i) + tag.length;
  return sql.slice(start, sql.indexOf(tag, open) + tag.length) + ";";
};
const NEW = read("20260926040817_money_sweeps_found_vs_done.sql");
const VIS = read("20260925231818_cron_work_visibility.sql");
const OLD_REL = fnFrom(read("20260924220318_rename_tab_addresses.sql"), "sweep_release_last_chance");
const OLD_DSP = fnFrom(read("20260923052520_seed_alerts_go_to_the_digest.sql"), "detect_stuck_payments");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, customer_id uuid,
  status text, payment_status text, poster_completed_at timestamptz, revision_requested_at timestamptz,
  helper_completed_at timestamptz, release_last_chance_notif_sent_at timestamptz,
  stripe_session_id text, created_at timestamptz DEFAULT now(), cancelled_at timestamptz,
  updated_at timestamptz DEFAULT now(), is_seed boolean DEFAULT false);
CREATE TABLE public.notifications (id bigserial, user_id uuid, type text, title text, message text,
  link text, read boolean, job_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, email text, is_seed boolean DEFAULT false);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text,
  message text, url text, tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.defects (fn text, ref text, err text);
-- Stand-in for log_cron_defect; _defect_raises makes its PER-ROW call raise
-- (ref <> 'run'), so the error escapes the inner handler and reaches the outer
-- handler of sweep_release_last_chance. The outer handler's own call (ref
-- 'run') still records, as the real function never raises.
CREATE TABLE public._defect_raises (on_ boolean); INSERT INTO public._defect_raises VALUES (false);
CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_err text, p_ctx jsonb) RETURNS void
  LANGUAGE plpgsql AS $f$
BEGIN
  IF (SELECT on_ FROM public._defect_raises) AND p_ref <> 'run' THEN RAISE EXCEPTION 'log_cron_defect itself failed'; END IF;
  INSERT INTO public.defects VALUES (p_fn, p_ref, p_err);
END $f$;
-- The monitoring tables as 20260925231818 leaves them.
CREATE TABLE public.cron_run_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, jobname text NOT NULL,
  status_code int, body jsonb NOT NULL DEFAULT '{}'::jsonb, response_id bigint, occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX ON public.cron_run_log (response_id, occurred_at);
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, candidate_key text,
  disposition_keys text[] DEFAULT ARRAY[]::text[], min_streak int NOT NULL DEFAULT 2, note text NOT NULL DEFAULT '',
  expected_max_gap interval, work_visibility text, work_keys text[], max_idle interval, work_exempt_reason text);
INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, work_visibility, work_exempt_reason) VALUES
  ('sweep-release-last-chance', interval '1 hour', 'exempt', 'placeholder reason long enough for the check constraint'),
  ('detect-stuck-payments',     interval '2 hours', 'exempt', 'placeholder reason long enough for the check constraint');
CREATE TABLE public.cron_http_requests (request_id bigint, jobname text, created_at timestamptz DEFAULT now());
CREATE SCHEMA net; CREATE TABLE net._http_response (id bigint, status_code int, content text, created timestamptz);
CREATE TABLE net.posts (body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint
  LANGUAGE sql AS $f$ INSERT INTO net.posts VALUES (body) RETURNING 1::bigint $f$;
CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
-- A switch that makes every notification insert raise.
CREATE TABLE public._break (on_ boolean, only_like text); INSERT INTO public._break VALUES (false, NULL);
CREATE FUNCTION public._maybe_break() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF (SELECT on_ FROM public._break)
     AND ((SELECT only_like FROM public._break) IS NULL OR NEW.message LIKE (SELECT only_like FROM public._break)) THEN
    RAISE EXCEPTION 'notifications write failed';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER _break BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public._maybe_break();
-- A switch that makes the seed path's error_logs write raise.
CREATE TABLE public._break_seed (on_ boolean); INSERT INTO public._break_seed VALUES (false);
CREATE FUNCTION public._maybe_break_seed() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF (SELECT on_ FROM public._break_seed) AND NEW.tags ->> 'source' = 'detect_stuck_payments-seed' THEN
    RAISE EXCEPTION 'error_logs write failed';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER _break_seed BEFORE INSERT ON public.error_logs FOR EACH ROW EXECUTE FUNCTION public._maybe_break_seed();
`);
// The real recorder and detector from 20260925231818.
await db.exec(fnFrom(VIS, "cron_record_work"));
await db.exec(fnFrom(VIS, "sweep_silent_cron_failures"));
const CMD = {
  rel: "SELECT public.cron_record_work('sweep-release-last-chance', to_jsonb(public.sweep_release_last_chance()));",
  dsp: "SELECT public.cron_record_work('detect-stuck-payments', to_jsonb(public.detect_stuck_payments()));",
};

// ── fixture ─────────────────────────────────────────────────────────────────
const admin = "00000000-0000-0000-0000-00000000000a";
const poster = "00000000-0000-0000-0000-0000000000b1";
const seedPoster = "00000000-0000-0000-0000-0000000000b2";
const poster2 = "00000000-0000-0000-0000-0000000000b3";
const reset = async () => {
  await db.exec(`DELETE FROM public.jobs; DELETE FROM public.notifications; DELETE FROM public.error_logs;
                 DELETE FROM public.cron_run_log; DELETE FROM public.defects; DELETE FROM net.posts;
                 DELETE FROM public.profiles; DELETE FROM public.user_roles;`);
  await q(`INSERT INTO public.user_roles VALUES ($1, 'admin')`, [admin]);
  await q(`INSERT INTO public.profiles VALUES ($1,'Poster','p@x',false), ($2,'Seed','s@x',true), ($3,'Poster2','p2@x',false)`,
    [poster, seedPoster, poster2]);
  // Two escrow jobs in their last 2 hours before auto-release.
  for (let i = 0; i < 2; i++)
    await q(`INSERT INTO public.jobs (title, customer_id, status, payment_status, helper_completed_at)
             VALUES ('escrow ' || $1::text, $2, 'in_progress', 'escrow', now() - interval '23 hours')`, [i, poster]);
  // Stuck checkouts: a real one, a real one already alerted today, a seed one.
  await q(`INSERT INTO public.jobs (title, customer_id, status, payment_status, stripe_session_id, created_at)
           VALUES ('stuck real', $1, 'open', 'unpaid', 'cs_1', now() - interval '1 hour'),
                  ('stuck again', $2, 'open', 'unpaid', 'cs_2', now() - interval '1 hour'),
                  ('stuck seed', $3, 'open', 'unpaid', 'cs_3', now() - interval '1 hour')`, [poster, poster2, seedPoster]);
  await q(`INSERT INTO public.notifications (user_id, type, title, link, read)
           VALUES ($1, 'system_alert', 'Stuck payment — webhook may be failing', '/admin?view=people&user=' || $2::text, false)`,
          [admin, poster2]);
};
const body = async (job) => (await one(`SELECT body FROM public.cron_run_log WHERE jobname = $1 ORDER BY id DESC LIMIT 1`, [job])).body;
const silent = async () => (await q(`SELECT tags->>'job' job, tags->>'rule' rule FROM public.error_logs WHERE tags->>'source' = 'cron-silent' ORDER BY 1`));
const failingRuns = async () => {
  await db.exec(`UPDATE public._break SET on_ = true`);
  for (let run = 0; run < 2; run++) {
    await db.exec(`UPDATE public.cron_run_log SET occurred_at = occurred_at - interval '20 minutes'`);
    await db.exec(CMD.rel); await db.exec(CMD.dsp);
  }
  await db.exec(`UPDATE public._break SET on_ = false`);
};

// ── RED: previous bodies ────────────────────────────────────────────────────
await db.exec(OLD_REL); await db.exec(OLD_DSP);
await db.exec(`UPDATE public.cron_work_expectations SET candidate_key = 'found',
  disposition_keys = CASE jobname WHEN 'sweep-release-last-chance' THEN ARRAY['pushed']
                     ELSE ARRAY['alerted','already_alerted','seed_logged','seed_already_logged'] END`);
await reset();
await failingRuns();
const oldBody = await body("detect-stuck-payments");
await q(`SELECT public.sweep_silent_cron_failures()`);
check("RED: previous bodies record only a bare count, and the detector files nothing",
  JSON.stringify(oldBody) === JSON.stringify({ fn: "detect-stuck-payments", result: 0 }) && (await silent()).length === 0,
  `${JSON.stringify(oldBody)}; filed ${JSON.stringify(await silent())}`);
await db.exec(`UPDATE public.cron_work_expectations SET candidate_key = NULL, disposition_keys = ARRAY[]::text[]`);

// ── apply 3x ────────────────────────────────────────────────────────────────
let applied = 0;
for (let i = 0; i < 3; i++) {
  try { await db.exec(NEW); applied++; } catch (e) { console.log(`apply ${i + 1}: ${e.message}`); }
}
check("the migration applies 3x", applied === 3, `${applied}/3`);
const reg = Object.fromEntries((await q(`SELECT jobname, candidate_key k, disposition_keys d, work_visibility v, expected_max_gap::text g FROM public.cron_work_expectations`)).map((r) => [r.jobname, r]));
check("both jobs registered as candidates with their keys, liveness gap kept",
  reg["sweep-release-last-chance"].v === "candidates" && reg["sweep-release-last-chance"].k === "found"
  && JSON.stringify(reg["sweep-release-last-chance"].d) === '["pushed"]' && reg["sweep-release-last-chance"].g === "01:00:00"
  && reg["detect-stuck-payments"].v === "candidates" && reg["detect-stuck-payments"].d.length === 4);

// ── healthy run: every path counted, nothing filed ──────────────────────────
await reset();
await db.exec(CMD.rel); await db.exec(CMD.dsp);
const rel = await body("sweep-release-last-chance");
const dsp = await body("detect-stuck-payments");
check("release: {found 2, pushed 2, failed 0} recorded via its cron command",
  rel.found === 2 && rel.pushed === 2 && rel.failed === 0 && rel.fn === "sweep-release-last-chance", JSON.stringify(rel));
check("detect: real alerted 1, already alerted 1, seed logged 1, found 3, flagged 2",
  dsp.found === 3 && dsp.alerted === 1 && dsp.already_alerted === 1 && dsp.seed_logged === 1
  && dsp.seed_already_logged === 0 && dsp.failed === 0 && dsp.flagged === 2, JSON.stringify(dsp));
await db.exec(`UPDATE public.jobs SET release_last_chance_notif_sent_at = NULL`);
await db.exec(CMD.dsp);
const dsp2 = await body("detect-stuck-payments");
check("detect again: now 2 already alerted and 1 seed already logged",
  dsp2.found === 3 && dsp2.already_alerted === 2 && dsp2.seed_already_logged === 1 && dsp2.alerted === 0, JSON.stringify(dsp2));
await db.exec(`UPDATE public.cron_run_log SET occurred_at = occurred_at - interval '20 minutes'`);
await db.exec(CMD.rel);
await q(`SELECT public.sweep_silent_cron_failures()`);
check("healthy runs file nothing", (await silent()).length === 0, JSON.stringify(await silent()));

// ── broken: every row raises, two runs running ──────────────────────────────
await reset();
await failingRuns();
const relB = await body("sweep-release-last-chance");
const dspB = await body("detect-stuck-payments");
check("release, all failing: {found 2, pushed 0, failed 2}", relB.found === 2 && relB.pushed === 0 && relB.failed === 2, JSON.stringify(relB));
check("detect, all failing: seed still logged, the real one raised: found 3, alerted 0, failed 1",
  dspB.found === 3 && dspB.alerted === 0 && dspB.failed === 1, JSON.stringify(dspB));
await q(`SELECT public.sweep_silent_cron_failures()`);
const filed = await silent();
check("the detector files release-last-chance after two runs that found and pushed none",
  filed.some((r) => r.job === "sweep-release-last-chance" && r.rule === "candidates"), JSON.stringify(filed));

// A detect run where EVERY row raised: only the real stuck job is left in the
// window (the rule alone cannot see a failure while any other row is handled;
// the per-row filing below covers that).
await reset();
await db.exec(`DELETE FROM public.jobs WHERE title <> 'stuck real'`);
await failingRuns();
await q(`SELECT public.sweep_silent_cron_failures()`);
check("the detector files detect-stuck-payments after two runs where every stuck job failed to alert",
  (await silent()).some((r) => r.job === "detect-stuck-payments" && r.rule === "candidates"), JSON.stringify(await silent()));

// ── partial failure: a real row fails while others are handled ─────────────
await reset();
await db.exec(`UPDATE public._break SET on_ = true`);
await db.exec(CMD.dsp);
await db.exec(`UPDATE public._break SET on_ = false`);
const part = await body("detect-stuck-payments");
const partDefects = await q(`SELECT fn, ref FROM public.defects ORDER BY fn`);
check("partial failure: the run is not suspicious to the rule (another row was handled)",
  part.found === 3 && part.failed === 1 && part.already_alerted + part.seed_logged > 0, JSON.stringify(part));
check("partial failure: the failed real row is filed through log_cron_defect as detect_stuck_payments",
  partDefects.length === 1 && partDefects[0].fn === "detect_stuck_payments", JSON.stringify(partDefects));

// ── a failing SEED row files under the -seed source, never the paging one ──
await reset();
await db.exec(`UPDATE public._break_seed SET on_ = true`);
await db.exec(CMD.dsp);
await db.exec(`UPDATE public._break_seed SET on_ = false`);
const seedFail = await body("detect-stuck-payments");
const seedDefects = await q(`SELECT fn FROM public.defects ORDER BY fn`);
check("seed row failure: counted failed, filed as detect_stuck_payments-seed only",
  seedFail.failed === 1 && seedDefects.length === 1 && seedDefects[0].fn === "detect_stuck_payments-seed",
  `${JSON.stringify(seedFail)} ${JSON.stringify(seedDefects)}`);

// ── release outer handler: a rolled-back run reports pushed 0 ──────────────
await reset();
await db.exec(`UPDATE public._break SET on_ = true, only_like = '%escrow 1%'`);
await db.exec(`UPDATE public._defect_raises SET on_ = true`);
const outer = (await one(`SELECT public.sweep_release_last_chance() AS r`)).r;
await db.exec(`UPDATE public._defect_raises SET on_ = false`);
await db.exec(`UPDATE public._break SET on_ = false, only_like = NULL`);
const kept = await one(`SELECT (SELECT count(*)::int FROM public.notifications WHERE title = 'Last chance to review') n,
                               (SELECT count(*)::int FROM public.jobs WHERE release_last_chance_notif_sent_at IS NOT NULL) sent`);
check("release outer handler: everything rolled back, so pushed 0 (found and failed kept, scan_failed 1)",
  outer.pushed === 0 && outer.scan_failed === 1 && outer.found === 2 && kept.n === 0 && kept.sent === 0,
  `${JSON.stringify(outer)} ${JSON.stringify(kept)}`);

// ── ACL ─────────────────────────────────────────────────────────────────────
for (const sig of ["public.sweep_release_last_chance()", "public.detect_stuck_payments()"]) {
  const a = await one(`SELECT has_function_privilege('anon', $1, 'EXECUTE') anon,
                              has_function_privilege('authenticated', $1, 'EXECUTE') auth,
                              pg_get_function_result($1::regprocedure) rt`, [sig]);
  check(`${sig}: returns jsonb; anon/authenticated cannot execute`, a.rt === "jsonb" && !a.anon && !a.auth, a.rt);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
