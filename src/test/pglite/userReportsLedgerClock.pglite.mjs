/**
 * Q1424 PGlite proof: check_user_reports_reach_ledger's clock windows, on a
 * fixed clock (./lib/fixedClock.mjs, newest CREATE of the function):
 *   look-back   reports with created_at >  now - 25 h  (exactly 25 h old: out)
 *   settle      reports with created_at <= now - 10 min (exactly 10 min old: in)
 *   queued      a pending ledger row excuses a report only while
 *               queued_at > now - 2 h (exactly 2 h old: no longer excuses)
 *
 *   node src/test/pglite/userReportsLedgerClock.pglite.mjs
 *   USER_REPORTS_INCLUSIVE=1 node src/test/pglite/userReportsLedgerClock.pglite.mjs   # RED: each edge moved by one
 *
 * The ledger matching itself is proven by userReportsReachTheLedgerCheck.pglite.mjs;
 * here its helpers are stubs (every reporter real, titles verbatim).
 * pglite is loaded from ~/.lh-pglite (CLAUDE.md). Registered in
 * src/test/clockFunctionsProven.test.ts.
 */
import os from "node:os";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
await installClock(db);
await db.exec(`
SET TIME ZONE 'UTC';
CREATE TABLE public.reports (id uuid PRIMARY KEY, reporter_id uuid, reported_type text, reason text, created_at timestamptz);
CREATE TABLE public.ops_alert_ledger (source_kind text, source text, title text, first_seen timestamptz, last_seen timestamptz, sample_ref jsonb);
CREATE TABLE public.ops_alert_pending (source_kind text, source text, title text, seen_at timestamptz, queued_at timestamptz);
CREATE TABLE public.error_logs (id serial, severity text, message text, tags jsonb DEFAULT '{}'::jsonb, context jsonb, created_at timestamptz DEFAULT public._probe_now());
CREATE FUNCTION public.ops_alert_normalise(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT t $$;
CREATE FUNCTION public.user_report_title(rt text, rs text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'user report: ' || rt || ' ' || rs $$;
CREATE FUNCTION public.user_report_is_real(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
`);
const { file, stmt } = newestFunction("check_user_reports_reach_ledger");
let fixed = onFixedClock(stmt);
check(`every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
if (process.env.USER_REPORTS_INCLUSIVE) {
  console.log("USER_REPORTS_INCLUSIVE=1: each window edge moved by one (expect FAILs)");
  fixed = fixed
    .replace("r.created_at >  public._probe_now() - interval '25 hours'", "r.created_at >= public._probe_now() - interval '25 hours'")
    .replace("r.created_at <= public._probe_now() - interval '10 minutes'", "r.created_at <  public._probe_now() - interval '10 minutes'")
    .replace("p.queued_at > public._probe_now() - interval '2 hours'", "p.queued_at >= public._probe_now() - interval '2 hours'");
}
for (let i = 0; i < 3; i++) await db.exec(fixed); // replay-safe: applies 3x

const iso = (ms) => new Date(ms).toISOString();
const N = Date.UTC(2026, 10, 1, 12, 0, 0); // the fall-back day: 24 h of UTC, 25 of Central wall clock
await setClock(db, iso(N));
const H = 3_600_000;
const MIN = 60_000;
const REPORTER = "00000000-0000-0000-0000-000000000001";
const unrecorded = async (createdMs, pendingQueuedMs = null) => {
  await db.exec(`DELETE FROM public.reports; DELETE FROM public.ops_alert_pending; DELETE FROM public.error_logs;`);
  await q(`INSERT INTO public.reports VALUES ('00000000-0000-0000-0000-0000000000aa', $1, 'user', 'spam', $2)`, [REPORTER, iso(createdMs)]);
  if (pendingQueuedMs !== null) {
    await q(`INSERT INTO public.ops_alert_pending VALUES ('user-report', 'user-report', 'user report: user spam', $1, $2)`, [iso(createdMs), iso(pendingQueuedMs)]);
  }
  return (await q(`SELECT public.check_user_reports_reach_ledger() AS n`))[0].n;
};

check("a report exactly 25 h old is past the look-back (not counted)", (await unrecorded(N - 25 * H)) === 0);
check("a report 25 h - 1 ms old is counted", (await unrecorded(N - 25 * H + 1)) === 1);
check("a report exactly 10 min old has settled (counted)", (await unrecorded(N - 10 * MIN)) === 1);
check("a report 10 min - 1 ms old has not settled (not counted)", (await unrecorded(N - 10 * MIN + 1)) === 0);
check("a pending row queued exactly 2 h ago no longer excuses the report", (await unrecorded(N - 3 * H, N - 2 * H)) === 1);
check("a pending row queued 2 h - 1 ms ago still excuses it", (await unrecorded(N - 3 * H, N - 2 * H + 1)) === 0);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exitCode = failures ? 1 : 0;
