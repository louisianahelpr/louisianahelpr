/**
 * PGlite proof for 20261103203658_connect_record_only_rows_never_page (Q2368, lead 11-03): the newest
 * notify_slack_on_error_log and ops_alert_ledger_from_error_log, run as the real error_logs triggers, neither post nor
 * record a ledger item for stripe-connect's record-only rows (tags.kind 'connect-reset' / 'connect-dead-account-close'
 * written by the server), while an ordinary server error still does both, and a CLIENT row claiming the same kind
 * gets no special treatment (it was already skipped for being a client row).
 *
 *   node src/test/pglite/connectRecordOnlyRowsNeverPage.pglite.mjs
 *   RECORD_ONLY_REMOVED=1 node src/test/pglite/connectRecordOnlyRowsNeverPage.pglite.mjs   # RED: the early returns taken out
 *
 * pglite is loaded from ~/.lh-pglite (CLAUDE.md). Named by src/test/connectRecordOnlyRowsNeverPage.test.ts.
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
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA net; CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url', 'https://x'), ('service_role_key', 'k');
CREATE TABLE public.posted (body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO public.posted VALUES (body) RETURNING 1::bigint $$;
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message text, severity text, tags jsonb, url text, context jsonb, user_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.recorded (source text, title text, severity text);
CREATE FUNCTION public.error_log_is_seed(jsonb) RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(($1 ->> 'seed')::boolean, false) $$;
CREATE FUNCTION public.ops_alert_record(p_kind text, p_source text, p_title text, p_severity text, p_sample text, p_ref jsonb,
  p_a text, p_b text, p_at timestamptz) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.recorded VALUES (p_source, p_title, p_severity) $$;
`);

const MIGRATION = "20261103203658_connect_record_only_rows_never_page.sql";
const fns = ["error_log_is_record_only", "notify_slack_on_error_log", "ops_alert_ledger_from_error_log"].map((n) => ({ n, ...newestFunction(n) }));
for (const f of fns) check(`the newest ${f.n} is this migration's`, f.file === MIGRATION, f.file);
for (let i = 0; i < 3; i++) {
  for (const f of fns) {
    let sql = f.stmt;
    if (process.env.RECORD_ONLY_REMOVED && f.n !== "error_log_is_record_only") {
      sql = sql.replace(/IF public\.error_log_is_record_only\((NEW\.tags|v_tags)\) THEN\s*RETURN (NEW|NULL);\s*END IF;/, "").replace("AND NOT public.error_log_is_record_only(e.tags)", "");
    }
    await db.exec(sql); // replay-safe: applies 3x
  }
}
if (process.env.RECORD_ONLY_REMOVED) console.log("RECORD_ONLY_REMOVED=1: both early returns taken out (expect FAILs)");
await db.exec(`
CREATE TRIGGER trg_error_logs_slack AFTER INSERT ON public.error_logs FOR EACH ROW EXECUTE FUNCTION public.notify_slack_on_error_log();
CREATE TRIGGER trg_error_logs_zz_ledger AFTER INSERT ON public.error_logs FOR EACH ROW EXECUTE FUNCTION public.ops_alert_ledger_from_error_log();
`);
const n = async (t) => (await db.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n;

// stamp_error_log_origin sets tags.origin; the service role's rows read 'server'.
for (const kind of ["connect-reset", "connect-dead-account-close"]) {
  await db.exec(`INSERT INTO public.error_logs (message, severity, tags) VALUES ('stripe-connect ${kind}', 'info',
    jsonb_build_object('source', 'stripe-connect', 'kind', '${kind}', 'origin', 'server'))`);
}
check("the two record-only kinds post nothing to Slack", (await n("posted")) === 0, String(await n("posted")));
check("the two record-only kinds record no ledger item", (await n("recorded")) === 0, String(await n("recorded")));
check("both rows stay in error_logs", (await n("error_logs")) === 2, String(await n("error_logs")));

// The stale-clear row (another stripe-connect kind) is unchanged: it still posts and records.
await db.exec(`INSERT INTO public.error_logs (message, severity, tags) VALUES ('stripe-connect cleared unusable payout account acct_x', 'info',
  jsonb_build_object('source', 'stripe-connect', 'kind', 'stale-clear', 'origin', 'server'))`);
check("another stripe-connect kind still records a ledger item", (await n("recorded")) === 1, String(await n("recorded")));
check("another stripe-connect kind still posts", (await n("posted")) === 1, String(await n("posted")));

await db.exec(`INSERT INTO public.error_logs (message, severity, tags) VALUES ('payout failed — x', 'error', jsonb_build_object('source', 'release-payout', 'origin', 'server'))`);
check("an ordinary server error still posts and records", (await n("posted")) === 2 && (await n("recorded")) === 2);

const fn = (await db.query(`SELECT public.error_log_is_record_only('{"source":"stripe-connect","kind":"connect-reset","origin":"client"}'::jsonb) a,
  public.error_log_is_record_only('{"source":"other","kind":"connect-reset","origin":"server"}'::jsonb) b,
  public.error_log_is_record_only('[1]'::jsonb) c`)).rows[0];
check("a client row, another source or a non-object never reads record-only", fn.a === false && fn.b === false && fn.c === false, JSON.stringify(fn));

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
