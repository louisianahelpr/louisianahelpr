/**
 * PGlite proof for 20261009223355_stuck_payment_needs_stripe_proof (owner
 * report 2026-10-09: "Stuck payment — webhook may be failing" for a checkout
 * the poster simply never finished).
 *
 *   node src/test/pglite/stuckPaymentNeedsStripeProof.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/stuckPaymentNeedsStripeProof.pglite.mjs   # RED: prod's body
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 *
 * THE BEFORE STATE IS PROD: detect_stuck_payments is 20261007043834's body
 * (md5(prosrc) 2828bff6f0ddc9fb15d2401b00a0f1d5 = live, read 2026-10-09);
 * cron_record_work (20260925231818, live md5 71d74025…) and
 * sweep_silent_cron_failures (20261004004835, live md5 79549cad…) are the real
 * recorder and found-vs-done detector, and the cron command is prod's
 * ('detect-stuck-payments': cron_record_work(detect_stuck_payments())). The
 * migration is then applied VERBATIM, three times.
 *
 * Proves, on the new body:
 *   1. FALSE POSITIVE GONE: an unpaid job whose session Stripe reports
 *      open/unpaid (the 2026-10-09 "Grass cutting" shape) raises no
 *      notification and no error_logs page, and counts as not_paid.
 *   2. TRUE POSITIVE KEPT: a job whose session Stripe reports complete/paid
 *      raises the same title, link, type and error_logs source as before, once
 *      per poster per day, with Stripe's evidence in the message and context.
 *   3. A stale answer, or one for a different (re-minted) session, is not
 *      trusted: awaiting_stripe.
 *   4. The found-vs-done rule: two runs where every candidate is not_paid file
 *      NOTHING (not_paid is a disposition); two runs where nothing has a
 *      Stripe answer DO file 'cron-silent' (a dead checker still pages).
 *   5. Seed: a paid seed checkout goes to the digest source, an unpaid one is
 *      not logged at all.
 * RED (NEW_MIGRATION=skip): prod's body alerts on the open/unpaid job.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const fnFrom = (sql, name) => {
  const i = sql.indexOf(`FUNCTION public.${name}(`);
  const start = sql.lastIndexOf("CREATE", i);
  const tag = /AS (\$[a-z_]*\$)/.exec(sql.slice(i))[1];
  const open = sql.indexOf(tag, i) + tag.length;
  return { sql: sql.slice(start, sql.indexOf(tag, open) + tag.length) + ";", body: sql.slice(open, sql.indexOf(tag, open)) };
};
const md5 = (s) => createHash("md5").update(s).digest("hex");
const THIS = read("20261009223355_stuck_payment_needs_stripe_proof.sql");
const PROD_DSP = fnFrom(read("20261007043834_error_log_readers_ignore_client_rows.sql"), "detect_stuck_payments");
const REC = fnFrom(read("20260925231818_cron_work_visibility.sql"), "cron_record_work");
const SWEEP = fnFrom(read("20261004004835_client_rows_cannot_mute_server_alerts.sql"), "sweep_silent_cron_failures");
const LIVE = {
  detect_stuck_payments: [PROD_DSP, "2828bff6f0ddc9fb15d2401b00a0f1d5"],
  cron_record_work: [REC, "71d740251b8c1d0efdc82607fc637d9e"],
  sweep_silent_cron_failures: [SWEEP, "79549cad13e7a1dcdbd3f952dd8abfb8"],
};
for (const [name, [def, want]] of Object.entries(LIVE)) {
  if (md5(def.body) !== want) throw new Error(`${name}: migration body md5 ${md5(def.body)} is not prod's ${want}`);
}
const SKIP = process.env.NEW_MIGRATION === "skip";

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
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, customer_id uuid,
  status text, payment_status text, stripe_session_id text, created_at timestamptz DEFAULT now(),
  cancelled_at timestamptz, updated_at timestamptz DEFAULT now(), is_seed boolean DEFAULT false);
CREATE TABLE public.notifications (id bigserial, user_id uuid, type text, title text, message text,
  link text, read boolean, job_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, email text, is_seed boolean DEFAULT false);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, note text);
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text,
  message text, url text, tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.defects (fn text, ref text, err text);
CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_err text, p_ctx jsonb) RETURNS void
  LANGUAGE sql AS $f$ INSERT INTO public.defects VALUES (p_fn, p_ref, p_err) $f$;
CREATE TABLE public.cron_run_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, jobname text NOT NULL,
  status_code int, body jsonb NOT NULL DEFAULT '{}'::jsonb, response_id bigint, occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX ON public.cron_run_log (response_id, occurred_at);
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, candidate_key text,
  disposition_keys text[] DEFAULT ARRAY[]::text[], min_streak int NOT NULL DEFAULT 2, note text NOT NULL DEFAULT '',
  expected_max_gap interval, registered_at timestamptz DEFAULT now(), work_visibility text, work_keys text[],
  max_idle interval, work_exempt_reason text);
-- prod's row, read 2026-10-09
INSERT INTO public.cron_work_expectations (jobname, candidate_key, disposition_keys, min_streak, note, expected_max_gap, work_visibility)
VALUES ('detect-stuck-payments', 'found', ARRAY['alerted','already_alerted','seed_logged','seed_already_logged'], 2,
        'prod note', interval '2 hours', 'candidates');
CREATE TABLE public.cron_http_requests (request_id bigint, jobname text, created_at timestamptz DEFAULT now());
CREATE SCHEMA net; CREATE TABLE net._http_response (id bigint, status_code int, content text, created timestamptz);
`);
await db.exec(REC.sql);
await db.exec(SWEEP.sql);
await db.exec(PROD_DSP.sql);
if (!SKIP) {
  for (let i = 0; i < 3; i++) await db.exec(THIS);
  check("migration applies 3x", true);
}
const CMD = "SELECT public.cron_record_work('detect-stuck-payments', to_jsonb(public.detect_stuck_payments()));";

const admin = "00000000-0000-0000-0000-00000000000a";
const ben = "9d5b8986-db09-4b89-95f0-be12f1d662af";
const seedPoster = "00000000-0000-0000-0000-0000000000b2";
const UNFINISHED = "bcf08d0b-47bd-46bf-971d-5d59f59f61ac";
const PAID = "1e16c281-e9fc-4d9a-9380-1ecefdac8932";
const SEED_PAID = "00000000-0000-0000-0000-0000000000c1";
const SEED_OPEN = "00000000-0000-0000-0000-0000000000c2";
const hasChecks = !SKIP;

const reset = async () => {
  await db.exec(`DELETE FROM public.notifications; DELETE FROM public.error_logs; DELETE FROM public.cron_run_log;
                 DELETE FROM public.defects; DELETE FROM public.profiles; DELETE FROM public.user_roles;
                 DELETE FROM public.test_accounts;`);
  if (hasChecks) await db.exec(`DELETE FROM public.stuck_payment_stripe_checks;`);
  await db.exec(`DELETE FROM public.jobs;`);
  await q(`INSERT INTO public.user_roles VALUES ($1, 'admin')`, [admin]);
  await q(`INSERT INTO public.profiles VALUES ($1,'Ben Lombas','b@x',false), ($2,'Seed','s@x',true)`, [ben, seedPoster]);
  // A TEST account is is_seed AND enrolled here (20261007033530).
  await q(`INSERT INTO public.test_accounts (user_id) VALUES ($1)`, [seedPoster]);
};
const addJob = (id, title, who, session, ageMin = 11) =>
  q(`INSERT INTO public.jobs (id, title, customer_id, status, payment_status, stripe_session_id, created_at, updated_at)
     VALUES ($1, $2, $3, 'open', 'unpaid', $4, now() - make_interval(mins => $5), now() - make_interval(mins => $5))`, [id, title, who, session, ageMin]);
const answer = (job, session, status, pay, moved, pi = null, agoMin = 3) => hasChecks
  ? q(`INSERT INTO public.stuck_payment_stripe_checks (job_id, stripe_session_id, session_status, payment_status, money_moved, payment_intent_id, checked_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() - make_interval(mins => $7))
       ON CONFLICT (job_id) DO UPDATE SET stripe_session_id = EXCLUDED.stripe_session_id, session_status = EXCLUDED.session_status,
         payment_status = EXCLUDED.payment_status, money_moved = EXCLUDED.money_moved, checked_at = EXCLUDED.checked_at`,
      [job, session, status, pay, moved, pi, agoMin])
  : Promise.resolve();
const stuckNotices = () => q(`SELECT message, link, type FROM public.notifications WHERE title = 'Stuck payment — webhook may be failing'`);
const pages = () => q(`SELECT tags, context FROM public.error_logs WHERE tags->>'source' = 'detect_stuck_payments'`);
const lastBody = async () => (await one(`SELECT body FROM public.cron_run_log ORDER BY id DESC LIMIT 1`)).body;
const twoRuns = async () => {
  for (let r = 0; r < 2; r++) {
    await db.exec(`UPDATE public.cron_run_log SET occurred_at = occurred_at - interval '20 minutes'`);
    await db.exec(CMD);
  }
  await q(`SELECT public.sweep_silent_cron_failures()`);
  return q(`SELECT tags->>'job' job, tags->>'rule' rule FROM public.error_logs WHERE tags->>'source' = 'cron-silent'`);
};

// ── 1. the 2026-10-09 false positive: open/unpaid ───────────────────────────
await reset();
await addJob(UNFINISHED, "Grass cutting", ben, "cs_live_b1zHlX4z");
await answer(UNFINISHED, "cs_live_b1zHlX4z", "open", "unpaid", false);
await db.exec(CMD);
check("an open/unpaid checkout (the 2026-10-09 job) pages nobody",
  (await stuckNotices()).length === 0 && (await pages()).length === 0,
  JSON.stringify({ notices: await stuckNotices(), body: await lastBody() }));
if (!SKIP) {
  const b = await lastBody();
  check("…and is counted not_paid, found 1", b.found === 1 && b.not_paid === 1 && b.alerted === 0, JSON.stringify(b));
  check("two runs of nothing-but-not_paid file NO silent-cron alert", (await twoRuns()).length === 0);
}

// expired is terminal: not trusted-by-age, never stuck
await reset();
await addJob(UNFINISHED, "Grass cutting", ben, "cs_live_b1zHlX4z", 70);
await answer(UNFINISHED, "cs_live_b1zHlX4z", "expired", "unpaid", false, null, 300);
await db.exec(CMD);
check("an expired/unpaid checkout, however old the answer, pages nobody", (await stuckNotices()).length === 0);

// complete + unpaid (an async bank payment settling) is not stuck either
await reset();
await addJob(UNFINISHED, "Grass cutting", ben, "cs_async");
await answer(UNFINISHED, "cs_async", "complete", "unpaid", false, "pi_async");
await db.exec(CMD);
check("complete/unpaid (async payment settling) pages nobody", (await stuckNotices()).length === 0);

// ── 2. the true positive: complete/paid ────────────────────────────────────
await reset();
await addJob(PAID, "Lawn service needed", ben, "cs_live_b1Dqmjkck");
await answer(PAID, "cs_live_b1Dqmjkck", "complete", "paid", true, "pi_3UOciYKp2H4b7tEC0P1HGQxH");
await db.exec(CMD);
{
  const n = await stuckNotices();
  const p = await pages();
  check("a complete/paid checkout still unpaid in the DB pages the admin (same title, type, link)",
    n.length === 1 && n[0].type === "system_alert" && n[0].link === `/admin?view=people&user=${ben}`, JSON.stringify(n));
  check("…and writes the same error_logs page source", p.length === 1 && p[0].tags.job_id === PAID, JSON.stringify(p));
  if (!SKIP) {
    check("…with Stripe's evidence in the message and context",
      /PAID in Stripe \(checkout complete\/paid\)/.test(n[0].message) && /by Ben Lombas/.test(n[0].message)
        && p[0].context.stripe_payment_intent === "pi_3UOciYKp2H4b7tEC0P1HGQxH",
      n[0].message);
    await db.exec(CMD);
    check("…once per job per day (second run: already_alerted)",
      (await stuckNotices()).length === 1 && (await lastBody()).already_alerted === 1);
    // A SECOND stuck job by the same poster is paged too (dedupe is per job).
    const PAID2 = "1e16c281-e9fc-4d9a-9380-1ecefdac8933";
    await addJob(PAID2, "Second paid job", ben, "cs_paid_two");
    await answer(PAID2, "cs_paid_two", "complete", "paid", true, "pi_two");
    await db.exec(CMD);
    check("…and a second paid job by the same poster still pages",
      (await pages()).some((r) => r.tags.job_id === PAID2) && (await lastBody()).alerted === 1, JSON.stringify(await lastBody()));
  }
}

if (!SKIP) {
  // ── 3. untrusted answers ───────────────────────────────────────────────────
  await reset();
  await addJob(UNFINISHED, "Grass cutting", ben, "cs_new_session");
  await answer(UNFINISHED, "cs_old_session", "complete", "paid", true);
  await db.exec(CMD);
  check("an answer about a different (re-minted) session is ignored: awaiting_stripe, no page",
    (await stuckNotices()).length === 0 && (await lastBody()).awaiting_stripe === 1, JSON.stringify(await lastBody()));

  await reset();
  await addJob(UNFINISHED, "Grass cutting", ben, "cs_live_b1zHlX4z", 120);
  await answer(UNFINISHED, "cs_live_b1zHlX4z", "open", "unpaid", false, null, 60);
  await db.exec(CMD);
  check("an open/unpaid answer older than 45 minutes is stale: awaiting_stripe",
    (await lastBody()).awaiting_stripe === 1 && (await lastBody()).not_paid === 0);

  // ── 4. a dead checker still pages through found-vs-done ────────────────────
  await reset();
  await addJob(UNFINISHED, "Grass cutting", ben, "cs_live_b1zHlX4z");
  const silent = await twoRuns();
  check("no Stripe answer for two runs files cron-silent for detect-stuck-payments",
    silent.some((r) => r.job === "detect-stuck-payments" && r.rule === "candidates"), JSON.stringify(silent));
  check("…and still sends no stuck-payment notice", (await stuckNotices()).length === 0);

  // An unanswered job is not hidden behind another job answered not_paid.
  await reset();
  await addJob(UNFINISHED, "Grass cutting", ben, "cs_live_b1zHlX4z");
  await answer(UNFINISHED, "cs_live_b1zHlX4z", "open", "unpaid", false);
  await addJob(PAID, "Lawn service needed", ben, "cs_unanswered", 50);
  await db.exec(CMD);
  const d = await q(`SELECT fn, ref FROM public.defects`);
  check("a job with no Stripe answer after 40 min is filed on its own, even when another is not_paid",
    d.length === 1 && d[0].fn === "detect_stuck_payments" && d[0].ref === PAID && (await lastBody()).not_paid === 1,
    JSON.stringify({ d, body: await lastBody() }));
  await reset();
  await addJob(PAID, "Lawn service needed", ben, "cs_unanswered", 20);
  await db.exec(CMD);
  check("…but not before the checker has had two runs (20 min old: no defect yet)", (await q(`SELECT 1 FROM public.defects`)).length === 0);

  // A checkout re-minted ("Finish paying") on an old job: the checker has
  // not answered the NEW session yet, which is not a defect until it has had
  // its two runs since the row changed.
  await reset();
  await addJob(UNFINISHED, "Old job, new checkout", ben, "cs_reminted", 180);
  await db.exec(`UPDATE public.jobs SET updated_at = now() - interval '5 minutes' WHERE id = '${UNFINISHED}'`);
  await answer(UNFINISHED, "cs_before_remint", "expired", "unpaid", false, null, 10);
  await db.exec(CMD);
  check("a just re-minted checkout on a 3 h old job files no defect", (await q(`SELECT 1 FROM public.defects`)).length === 0);

  // ── 4b. a PAID job is never crowded out of the 50-row window ──────────────
  await reset();
  for (let i = 0; i < 60; i++) {
    const id = `00000000-0000-0000-0001-${String(i).padStart(12, "0")}`;
    await addJob(id, `Unfinished ${i}`, ben, `cs_open_${i}`, 30 + i);
    await answer(id, `cs_open_${i}`, "open", "unpaid", false);
  }
  await addJob(PAID, "Lawn service needed", ben, "cs_paid_late", 15);
  await answer(PAID, "cs_paid_late", "complete", "paid", true, "pi_late");
  await db.exec(CMD);
  check("60 unfinished checkouts cannot hide one Stripe says was PAID",
    (await pages()).some((r) => r.tags.job_id === PAID) && (await lastBody()).alerted === 1, JSON.stringify(await lastBody()));

  // ── 5. seed ────────────────────────────────────────────────────────────────
  await reset();
  await addJob(SEED_PAID, "[E2E] paid", seedPoster, "cs_seed_paid");
  await addJob(SEED_OPEN, "[E2E] open", seedPoster, "cs_seed_open");
  await answer(SEED_PAID, "cs_seed_paid", "complete", "paid", true);
  await answer(SEED_OPEN, "cs_seed_open", "open", "unpaid", false);
  await db.exec(CMD);
  const seedRows = await q(`SELECT tags->>'job_id' j, message FROM public.error_logs WHERE tags->>'source' = 'detect_stuck_payments-seed'`);
  check("seed: only the PAID seed checkout reaches the digest, no admin notice",
    seedRows.length === 1 && seedRows[0].j === SEED_PAID && (await stuckNotices()).length === 0, JSON.stringify(seedRows));

  // is_seed WITHOUT a test_accounts row is a real person with a fixture inbox:
  // their live money pages like anyone's.
  await reset();
  await db.exec(`DELETE FROM public.test_accounts`);
  await addJob(SEED_PAID, "Real job, fixture inbox", seedPoster, "cs_fixture_paid");
  await answer(SEED_PAID, "cs_fixture_paid", "complete", "paid", true);
  await db.exec(CMD);
  check("is_seed alone (no test_accounts row) still pages", (await pages()).some((r) => r.tags.job_id === SEED_PAID));

  // ── grants ─────────────────────────────────────────────────────────────────
  const g = await one(`SELECT has_function_privilege('anon', 'public.detect_stuck_payments()', 'EXECUTE') a,
                              has_function_privilege('authenticated', 'public.detect_stuck_payments()', 'EXECUTE') u,
                              has_function_privilege('service_role', 'public.detect_stuck_payments()', 'EXECUTE') s,
                              has_table_privilege('anon', 'public.stuck_payment_stripe_checks', 'SELECT') ta,
                              has_table_privilege('authenticated', 'public.stuck_payment_stripe_checks', 'SELECT') tu,
                              has_table_privilege('service_role', 'public.stuck_payment_stripe_checks', 'INSERT') ts`);
  check("grants: service_role only", !g.a && !g.u && g.s && !g.ta && !g.tu && g.ts, JSON.stringify(g));
  const exp = await one(`SELECT disposition_keys FROM public.cron_work_expectations WHERE jobname = 'detect-stuck-payments'`);
  check("not_paid is a disposition; awaiting_stripe is not",
    exp.disposition_keys.includes("not_paid") && !exp.disposition_keys.includes("awaiting_stripe"), JSON.stringify(exp));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
