#!/usr/bin/env node
/**
 * PGlite proof for 20261012203308_user_reports_reach_the_ledger_check (Q1717).
 *
 *   node src/test/pglite/userReportsReachTheLedgerCheck.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/userReportsReachTheLedgerCheck.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). The ledger WRITE path is prod's own code, cut
 * from its newest migrations (prosrc md5 equal to prod, 2026-10-12):
 * ops_alert_normalise, ops_alert_fingerprint, ops_alert_apply,
 * ops_alert_record, user_report_title, user_report_severity,
 * user_report_is_real, ops_alert_record_user_report. Only ops_alert_condition
 * (the verifier's close rules, not on this path) is stubbed. A report "reaches"
 * the ledger by the real ops_alert_record_user_report; the failure is planted
 * by skipping that call. On main nothing notices the planted failure.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW = readFileSync(`${MIG}20261012203308_user_reports_reach_the_ledger_check.sql`, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

/** A function as the newest migration before this one defines it. */
function newestFn(name) {
  let out = null;
  for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
    if (f >= "20261012203308") break;
    const sql = readFileSync(MIG + f, "utf8");
    const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
    if (!m) continue;
    const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
    const close = sql.indexOf(open[1], m.index + open.index + open[0].length);
    out = sql.slice(m.index, sql.indexOf(";", close) + 1);
  }
  if (!out) throw new Error(`no definition of ${name}`);
  return out;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const REAL = "00000000-0000-0000-0000-0000000000b1";
const TEST = "00000000-0000-0000-0000-0000000000b2";
const GONE = "00000000-0000-0000-0000-0000000000b3";
const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean);
  CREATE TABLE public.reports (id uuid PRIMARY KEY, reporter_id uuid, reported_type text, reported_id uuid,
    reason text, description text, status text DEFAULT 'pending', created_at timestamptz);
  CREATE TABLE public.ops_alert_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fingerprint text NOT NULL UNIQUE, source_kind text NOT NULL,
    source text NOT NULL, title text NOT NULL, severity text NOT NULL, sample text, sample_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
    first_seen timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now(), count bigint NOT NULL DEFAULT 1,
    status text NOT NULL DEFAULT 'open', verify_kind text NOT NULL DEFAULT 'manual', verify_ref text, verify_note text,
    verify_started_at timestamptz, closed_at timestamptz, closed_evidence text, reopen_count integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.ops_alert_pending (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_kind text NOT NULL,
    source text, title text, severity text, sample text, sample_ref jsonb, verify_kind text, verify_ref text,
    seen_at timestamptz NOT NULL, queued_at timestamptz NOT NULL DEFAULT clock_timestamp());
  CREATE TABLE public.error_logs (severity text, message text, tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
  CREATE FUNCTION public.ops_alert_condition(p_ref text, p_sample_ref jsonb, p_seen timestamptz, p_new boolean)
    RETURNS boolean LANGUAGE sql AS $$ SELECT NULL::boolean $$;
  INSERT INTO public.profiles VALUES ('${REAL}', false), ('${TEST}', true), ('${GONE}', true);
`);
for (const fn of ["ops_alert_normalise", "ops_alert_fingerprint", "ops_alert_apply", "ops_alert_record",
                  "user_report_title", "user_report_severity", "user_report_is_real", "ops_alert_record_user_report"]) {
  await db.exec(newestFn(fn));
}
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(NEW);

const OVERFLOW = "user reports: new-item cap reached (see the admin queues)";
async function report(n, reporter, type, reason, ago, how) {
  await db.exec(`INSERT INTO public.reports (id, reporter_id, reported_type, reason, created_at)
                 VALUES ('${id(n)}', ${reporter ? `'${reporter}'` : "NULL"}, '${type}', '${reason}', now() - interval '${ago}')`);
  if (how === "recorded") await db.exec(`SELECT public.ops_alert_record_user_report('${id(n)}')`);
  if (how === "overflow") {
    await db.exec(`SELECT public.ops_alert_record('user-report', 'user-report', '${OVERFLOW}', 'warning', 'capped',
                   jsonb_build_object('overflow', true, 'report_id', '${id(n)}'), 'sql_condition', 'user-report', now() - interval '${ago}')`);
  }
  if (how === "pending-fresh" || how === "pending-stuck") {
    await db.exec(`INSERT INTO public.ops_alert_pending (source_kind, source, title, severity, seen_at, queued_at)
                   VALUES ('user-report', 'user-report', public.user_report_title('${type}', '${reason}'), 'error',
                           now() - interval '${ago}', now() - interval '${how === "pending-fresh" ? "30 minutes" : "3 hours"}')`);
  }
}

// Reasons carry numbers so ops_alert_normalise really rewrites them.
await report(1, REAL, "user", "Spam 3x a day", "2 hours", "recorded");                 // reached its item
await report(2, REAL, "job", "Scam, asked for 40 upfront", "4 hours", "planted");     // its trigger failed
await report(3, REAL, "support", "Help with job 12", "2 hours", "pending-fresh");       // waiting in the queue
await report(4, REAL, "job", "Fraud 2", "3 hours", "pending-stuck");                    // stuck in the queue 3 h
await report(5, TEST, "job", "Scam 1", "2 hours", "planted");                           // a test account: not checked
await report(6, GONE, "job", "Scam 9", "2 hours", "planted");                           // a test account, since deleted
await db.exec(`UPDATE public.reports SET reporter_id = NULL WHERE id = '${id(6)}'`);
// A flood: enough new items from REAL in the hour before each capped report, so
// the cap refused reports 7 and 8 onto the overflow item, whose later bump
// moves its last_seen past report 7.
for (let k = 0; k < 5; k++) await report(20 + k, REAL, "user", `Flood A${k} item`, `${5 * 60 + 10 + k} minutes`, "recorded");
for (let k = 0; k < 5; k++) await report(30 + k, REAL, "user", `Flood B${k} item`, `${95 + k} minutes`, "recorded");
await report(7, REAL, "user", "Abuse 1", "5 hours", "overflow");
await report(8, REAL, "user", "Abuse 2", "90 minutes", "overflow");
await report(9, REAL, "job", "Fraud 7", "5 minutes", "planted");                        // too new to judge

const run = async () => {
  try {
    return (await db.query(`SELECT public.check_user_reports_reach_ledger() AS n`)).rows[0].n;
  } catch (e) {
    return e.message;
  }
};
const first = await run();
const rows = (await db.query(`SELECT severity, context FROM public.error_logs WHERE tags->>'source' = 'user-report-unrecorded'`)).rows;
const named = rows[0]?.context?.report_ids ?? [];
check("the two real reports that never reached the ledger are filed, in one row", first === 2 && rows.length === 1, `${first} / ${rows.length}`);
check("  the planted failure is named", named.includes(id(2)), JSON.stringify(named));
check("  a report stuck in the pending queue for 3 hours is named", named.includes(id(4)), JSON.stringify(named));
check("  a report recorded by the real write path is not named (normalised title matched)", rows.length === 1 && !named.includes(id(1)));
check("  a report waiting in the queue for 30 minutes is not named", rows.length === 1 && !named.includes(id(3)));
check("  a capped report is excused by the overflow item's LATER bump", rows.length === 1 && !named.includes(id(7)) && !named.includes(id(8)));
check("  ...but a report outside any flood is NOT excused by that overflow item (report 2)", named.includes(id(2)));
check("  a deleted test account's report (reporter set NULL) is not named", rows.length === 1 && !named.includes(id(6)));
check("  a test account's and a 5-minute-old report are not named", rows.length === 1 && !named.includes(id(5)) && !named.includes(id(9)));
check("  filed as an error (it reaches Slack and the ledger)", rows[0]?.severity === "error", rows[0]?.severity);
const second = await run();
check("a later run does not name the same reports again", second === 0 && (await db.query(`SELECT count(*)::int n FROM public.error_logs`)).rows[0].n === 1, String(second));

if (!MODE) {
  const priv = async (role) => (await db.query(`SELECT has_function_privilege('${role}', 'public.check_user_reports_reach_ledger()', 'EXECUTE') x`)).rows[0].x;
  check("service_role only", !(await priv("anon")) && !(await priv("authenticated")) && (await priv("service_role")));
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
