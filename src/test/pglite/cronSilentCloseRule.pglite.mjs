/**
 * PGlite proof for 20260926035556_cron_silent_close_rule (CJ-007, Q452 (b)).
 *
 *   node src/test/pglite/cronSilentCloseRule.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite.
 *
 * Proves: applies 3x; the probe gives cron-silent 'idle' and 'unrecorded'
 * items a close rule and leaves 'candidates' (and an unknown row) on NULL;
 * 'unrecorded' is still failing while the active job skips cron_record_work
 * and clears when it is wrapped, paused or unscheduled; 'idle' clears on one
 * run after the report that did work, or when the job is no longer registered
 * idle, is still failing while every run since did nothing, and is NULL with
 * no run since; an open 'manual' (error_logs default) or 'companions' item is
 * re-pointed, a candidates or closed one is not;
 * anon/authenticated cannot execute the helpers. RED: the previous
 * ops_alert_condition (20260925155922) returns NULL for every one of them, so
 * those items could never close on their own.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const NEW = read("20260926035556_cron_silent_close_rule.sql");
const PREV_FILE = read("20260925155922_admin_queue_alerts_close_themselves.sql");
const PREV = PREV_FILE.slice(PREV_FILE.indexOf("CREATE OR REPLACE FUNCTION public.ops_alert_condition("),
  PREV_FILE.indexOf("$function$;", PREV_FILE.indexOf("CREATE OR REPLACE FUNCTION public.ops_alert_condition(")) + "$function$;".length);

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
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text,
  message text, tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.cron_run_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, jobname text NOT NULL,
  status_code int, body jsonb NOT NULL DEFAULT '{}'::jsonb, response_id bigint, occurred_at timestamptz NOT NULL);
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, work_visibility text,
  work_keys text[], max_idle interval);
CREATE TABLE public.ops_alert_ledger (id bigserial PRIMARY KEY, source_kind text, source text, title text,
  sample_ref jsonb, status text DEFAULT 'open', verify_kind text, verify_ref text, updated_at timestamptz);
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigint PRIMARY KEY, jobname text, command text, active boolean DEFAULT true);
-- The other branches of the dispatcher call these; stand-ins so an ELSIF that
-- happens to be evaluated cannot raise.
CREATE FUNCTION public.admin_alert_ref(p jsonb) RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{}'::jsonb $f$;
CREATE FUNCTION public.admin_alert_close_rule(p text) RETURNS text LANGUAGE sql AS $f$ SELECT NULL::text $f$;
`);

// ── fixture ─────────────────────────────────────────────────────────────────
await db.exec(`
INSERT INTO cron.job VALUES
  (1, 'bare-sql',     'SELECT public.f();', true),
  (2, 'wrapped-sql',  'SELECT public.cron_record_work(''wrapped-sql'', to_jsonb(public.f()));', true),
  (3, 'paused-sql',   'SELECT public.f();', false),
  (4, NULL,           'SELECT public.g();', true);
INSERT INTO public.cron_work_expectations VALUES
  ('idle-still',   'idle', ARRAY['result'], interval '1 day'),
  ('idle-worked',  'idle', ARRAY['result'], interval '1 day'),
  ('idle-quiet',   'idle', ARRAY['result'], interval '1 day'),
  ('idle-exempted','exempt', NULL, NULL);
`);
const since = (await one(`SELECT (now() - interval '2 hours') AS t`)).t;
await q(`INSERT INTO public.cron_run_log (jobname, body, occurred_at) VALUES
  ('idle-still',  '{"fn":"idle-still","result":0}',  now() - interval '1 hour'),
  ('idle-still',  '{"fn":"idle-still","result":0}',  now() - interval '30 minutes'),
  ('idle-still',  '{"fn":"idle-still","result":9}',  now() - interval '5 hours'),
  ('idle-worked', '{"fn":"idle-worked","result":0}', now() - interval '1 hour'),
  ('idle-worked', '{"fn":"idle-worked","result":3}', now() - interval '30 minutes'),
  ('idle-quiet',  '{"fn":"idle-quiet","result":0}',  now() - interval '5 hours')`);
const file = async (job, rule) =>
  (await one(`INSERT INTO public.error_logs (severity, message, tags) VALUES ('error', $1,
               jsonb_build_object('source','cron-silent','area','cron','job',$2::text,'rule',$3::text)) RETURNING id`,
             [`${rule} ${job}`, job, rule])).id;
const ref = (id, job) => JSON.stringify({ error_log_id: id, job });
const ids = {};
for (const [job, rule] of [["bare-sql", "unrecorded"], ["wrapped-sql", "unrecorded"], ["paused-sql", "unrecorded"],
  ["jobid 4", "unrecorded"], ["gone-sql", "unrecorded"], ["idle-still", "idle"], ["idle-worked", "idle"],
  ["idle-quiet", "idle"], ["idle-exempted", "idle"], ["cand-job", "candidates"]])
  ids[job] = await file(job, rule);
// A non-cron-silent row the ref could point at.
ids.other = (await one(`INSERT INTO public.error_logs (severity, message, tags) VALUES ('error','x','{"source":"db-saturation","rule":"idle"}') RETURNING id`)).id;

const cond = async (job, probe = false, idKey = job) =>
  (await one(`SELECT public.ops_alert_condition('cron-silent', $1::jsonb, $2::timestamptz, $3) AS v`,
             [ref(ids[idKey], job), since, probe])).v;

// ── RED: the previous dispatcher on the same items ──────────────────────────
await db.exec(PREV);
const prev = [];
for (const job of ["bare-sql", "idle-still", "idle-worked"]) prev.push(await cond(job, true), await cond(job, false));
check("RED: the previous ops_alert_condition has no cron-silent rule (probe and verdict all NULL)",
  prev.every((v) => v === null), JSON.stringify(prev));

// ── apply 3x ────────────────────────────────────────────────────────────────
await db.exec(`INSERT INTO public.ops_alert_ledger (source_kind, source, title, sample_ref, status, verify_kind) VALUES
  ('error_logs','cron-silent','idle old',      '${ref(ids["idle-still"], "idle-still")}', 'open',   'manual'),
  ('error_logs','cron-silent','unrec hand',    '${ref(ids["gone-sql"], "gone-sql")}',     'open',   'companions'),
  ('error_logs','cron-silent','cand old',      '${ref(ids["cand-job"], "cand-job")}',     'open',   'manual'),
  ('error_logs','cron-silent','closed unrec',  '${ref(ids["bare-sql"], "bare-sql")}',     'closed', 'manual')`);
let applied = 0;
for (let i = 0; i < 3; i++) {
  try { await db.exec(NEW); applied++; } catch (e) { console.log(`apply ${i + 1}: ${e.message}`); }
}
check("the migration applies 3x", applied === 3, `${applied}/3`);

// ── probe ───────────────────────────────────────────────────────────────────
check("probe: idle and unrecorded items get a close rule",
  (await cond("bare-sql", true)) === true && (await cond("idle-still", true)) === true);
check("probe: a candidates item gets no close rule (NULL)", (await cond("cand-job", true)) === null);
check("probe: a ref to a non-cron-silent row is NULL", (await cond("bare-sql", true, "other")) === null);
check("probe: no job in the ref is NULL",
  (await one(`SELECT public.ops_alert_condition('cron-silent', $1::jsonb, now(), true) AS v`,
             [JSON.stringify({ error_log_id: ids["bare-sql"] })])).v === null);

// ── unrecorded ──────────────────────────────────────────────────────────────
check("unrecorded: an active job still skipping cron_record_work is still failing", (await cond("bare-sql")) === true);
check("unrecorded: 'jobid <n>' names resolve like the sweep files them", (await cond("jobid 4")) === true);
check("unrecorded: a wrapped job clears", (await cond("wrapped-sql")) === false);
check("unrecorded: a paused job clears", (await cond("paused-sql")) === false);
check("unrecorded: an unscheduled job clears", (await cond("gone-sql")) === false);
await db.exec(`UPDATE cron.job SET command = 'SELECT public.cron_record_work(''bare-sql'', to_jsonb(public.f()));' WHERE jobid = 1`);
check("unrecorded: wrapping the job flips it to cleared", (await cond("bare-sql")) === false);

// ── idle ────────────────────────────────────────────────────────────────────
check("idle: every run since the report did nothing = still failing", (await cond("idle-still")) === true);
check("idle: one run since the report that did work = cleared", (await cond("idle-worked")) === false);
check("idle: no run since the report = cannot tell (NULL)", (await cond("idle-quiet")) === null);
check("idle: no longer registered idle = cleared", (await cond("idle-exempted")) === false);

// ── re-point ────────────────────────────────────────────────────────────────
const led = Object.fromEntries((await q(`SELECT title, verify_kind, verify_ref FROM public.ops_alert_ledger`)).map((r) => [r.title, r]));
check("an open idle item on 'manual' (the error_logs default) is re-pointed to sql_condition / cron-silent",
  led["idle old"].verify_kind === "sql_condition" && led["idle old"].verify_ref === "cron-silent");
check("an open unrecorded item on 'companions' is re-pointed too", led["unrec hand"].verify_kind === "sql_condition");
check("a candidates item stays on manual", led["cand old"].verify_kind === "manual");
check("a closed item is not touched", led["closed unrec"].verify_kind === "manual");

// ── ACL ─────────────────────────────────────────────────────────────────────
for (const sig of ["public.cron_silent_rule(jsonb)", "public.cron_silent_still_failing(text, text, timestamptz)",
  "public.ops_alert_condition(text, jsonb, timestamptz, boolean)"]) {
  const a = await one(`SELECT has_function_privilege('anon', $1, 'EXECUTE') anon,
                              has_function_privilege('authenticated', $1, 'EXECUTE') auth`, [sig]);
  check(`anon/authenticated cannot execute ${sig}`, !a.anon && !a.auth);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
