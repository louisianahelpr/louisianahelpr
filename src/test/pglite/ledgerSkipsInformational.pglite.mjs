/**
 * PGlite proof for 20261102225216_ledger_skips_informational_sources (owner closed Q2545, 11-02): the newest
 * ops_alert_ledger_from_error_log, run as trg_error_logs_zz_ledger, records no ledger item for the notifications
 * sweeper's info receipt (source 'sweep_old_notifications'), and still records an ordinary error.
 *
 *   node src/test/pglite/ledgerSkipsInformational.pglite.mjs
 *   LEDGER_SKIP_REMOVED=1 node src/test/pglite/ledgerSkipsInformational.pglite.mjs   # RED: the skip taken out
 *
 * pglite is loaded from ~/.lh-pglite (CLAUDE.md). Named by src/test/informationalAlertsNeverReachTheLedger.test.ts.
 */
import os from "node:os";
import { newestFunction } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message text, severity text, tags jsonb, url text, created_at timestamptz DEFAULT now());
CREATE TABLE public.recorded (source_kind text, source text, title text, severity text);
CREATE FUNCTION public.error_log_is_seed(jsonb) RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(($1 ->> 'seed')::boolean, false) $$;
CREATE FUNCTION public.ops_alert_record(p_kind text, p_source text, p_title text, p_severity text, p_sample text, p_ref jsonb,
  p_a text, p_b text, p_at timestamptz) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.recorded VALUES (p_kind, p_source, p_title, p_severity) $$;
`);
const { file, stmt } = newestFunction("ops_alert_ledger_from_error_log");
check("the newest definition is this migration's", file === "20261102225216_ledger_skips_informational_sources.sql", file);
let sql = stmt;
if (process.env.LEDGER_SKIP_REMOVED) {
  console.log("LEDGER_SKIP_REMOVED=1: the sweeper's source taken out of the skip list (expect a FAIL)");
  sql = sql.replace("IF v_source IN ('ops-alert', 'ops-digest', 'sweep_old_notifications') THEN", "IF v_source IN ('ops-alert', 'ops-digest') THEN");
}
for (let i = 0; i < 3; i++) await db.exec(sql); // replay-safe: applies 3x
await db.exec(`CREATE TRIGGER trg_error_logs_zz_ledger AFTER INSERT ON public.error_logs FOR EACH ROW EXECUTE FUNCTION public.ops_alert_ledger_from_error_log();`);

const count = async () => (await db.query(`SELECT count(*)::int n FROM public.recorded`)).rows[0].n;
// The sweeper's exact write (20260510033134).
await db.exec(`INSERT INTO public.error_logs (message, severity, tags) VALUES ('sweep_old_notifications: deleted 4 rows (4 read, 0 unread)', 'info', jsonb_build_object('source', 'sweep_old_notifications'))`);
check("the sweeper's info receipt records no ledger item", (await count()) === 0, String(await count()));
const kept = (await db.query(`SELECT count(*)::int n FROM public.error_logs WHERE tags ->> 'source' = 'sweep_old_notifications'`)).rows[0].n;
check("the receipt itself is still in error_logs", kept === 1, String(kept));
await db.exec(`INSERT INTO public.error_logs (message, severity, tags) VALUES ('payout failed — x', 'error', jsonb_build_object('source', 'release-payout'))`);
const rows = (await db.query(`SELECT source, title FROM public.recorded`)).rows;
check("an ordinary error is still recorded", rows.length === 1 && rows[0].source === "release-payout" && rows[0].title === "payout failed", JSON.stringify(rows));

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
