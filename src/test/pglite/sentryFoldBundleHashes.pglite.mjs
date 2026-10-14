#!/usr/bin/env node
/**
 * PGlite proof for 20261014184909_sentry_alerts_fold_bundle_hashes: one Sentry
 * error is one ops_alert_ledger row, whatever bundle hash its culprit named.
 *
 *   node src/test/pglite/sentryFoldBundleHashes.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/sentryFoldBundleHashes.pglite.mjs   # RED (copies stay)
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). The table has prod's ops_alert_ledger columns
 * (information_schema, 2026-10-14). The fixture is the shape measured on prod
 * that day: one error under several hashed sources, a closed and an open copy,
 * a non-bundle culprit, and a non-sentry row. Applies the migration 3x and
 * proves:
 *   - copies fold into ONE row per (normalised source, title): counts summed,
 *     first/last seen widened, worst severity kept, open wins over closed;
 *   - each row's fingerprint is ops_alert_apply's own md5(kind|source|title),
 *     so the next sync's upsert lands on it;
 *   - public.ops_alert_sentry_source answers what scripts/lib/sentryLedgerSync.mjs
 *     sentryCulpritKey answers, for every source;
 *   - a non-sentry row and a non-bundle culprit are untouched; a re-run is a no-op,
 *     and the normaliser is idempotent (a lower-case word is a name, not a hash);
 *   - a 'verifying' copy merged with an open one is open (no verification running);
 *   - anon and authenticated cannot execute the function.
 * The run on the 58 real prod rows (read-only dump, 2026-10-14) gave 58 -> 34
 * rows, 40 -> 19 open, 251 occurrences before and after, 0 mismatches.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { sentryCulpritKey } = await import(new URL("../../../scripts/lib/sentryLedgerSync.mjs", import.meta.url).pathname);
const MIG = readFileSync(new URL("../../../supabase/migrations/20261014184909_sentry_alerts_fold_bundle_hashes.sql", import.meta.url).pathname, "utf8");

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.ops_alert_ledger (
    id uuid primary key default gen_random_uuid(), fingerprint text unique not null, source_kind text not null,
    source text not null, title text not null, severity text not null, sample text, sample_ref jsonb not null default '{}',
    first_seen timestamptz not null, last_seen timestamptz not null, count bigint not null default 1,
    status text not null, verify_kind text, verify_ref text, verify_note text, verify_started_at timestamptz,
    closed_at timestamptz, closed_evidence text, reopen_count int not null default 0, updated_at timestamptz);`);
const rows = [
  // [kind, source, title, severity, status, count, first_seen, last_seen]
  ["sentry", "sentry:cu(assets/app-shared-DUoNbpYC)", "error: permission denied for table profiles", "error", "open", 1, "2026-10-09T01:38:12Z", "2026-10-09T01:38:12Z"],
  ["sentry", "sentry:cu(assets/app-shared-D-Rq5FZy)", "error: permission denied for table profiles", "error", "open", 1, "2026-10-09T02:47:13Z", "2026-10-09T02:47:13Z"],
  ["sentry", "sentry:bu(assets/app-shared-B0ccjbe2)", "error: permission denied for table profiles", "error", "open", 6, "2026-10-10T02:51:57Z", "2026-10-10T14:39:00Z"],
  ["sentry", "sentry:Ku(assets/app-shared-CkIDj-oG)", "error: permission denied for table profiles", "warning", "open", 4, "2026-10-13T23:01:36Z", "2026-10-13T23:01:36Z"],
  ["sentry", "sentry:Qu(assets/app-shared-DggPq6Hw)", "error: zip # resolved to no louisiana parish", "error", "closed", 5, "2026-09-28T00:40:48Z", "2026-09-28T00:40:48Z"],
  ["sentry", "sentry:Rd(assets/app-shared-DUoNbpYC)", "error: zip # resolved to no louisiana parish", "error", "closed", 5, "2026-10-09T02:07:27Z", "2026-10-09T02:07:27Z"],
  ["sentry", "sentry:?(assets/supabase-B9flpjD6)", "functionshttperror: edge function returned a non-#xx status code", "error", "open", 6, "2026-10-09T02:48:32Z", "2026-10-09T13:39:40Z"],
  ["sentry", "sentry:f.<anonymous>(assets/supabase-B9flpjD6)", "functionshttperror: edge function returned a non-#xx status code", "fatal", "closed", 7, "2026-10-09T13:39:40Z", "2026-10-12T04:19:46Z"],
  ["sentry", "sentry:sendDataToNative(iabjs://navigation_performance_logger_android)", "error: error invoking postmessage: java object is gone", "error", "closed", 5, "2026-10-09T18:03:38Z", "2026-10-09T18:03:38Z"],
  ["sentry", "sentry:a(assets/notify-Ab12Cd34)", "error: a verifying copy must not hide an open one", "error", "verifying", 1, "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z"],
  ["sentry", "sentry:b(assets/notify-Zz99Yy88)", "error: a verifying copy must not hide an open one", "error", "open", 1, "2026-10-02T00:00:00Z", "2026-10-02T00:00:00Z"],
  ["error_logs", "cu(assets/app-shared-DUoNbpYC)", "not a sentry row", "error", "open", 2, "2026-10-09T00:00:00Z", "2026-10-09T00:00:00Z"],
];
for (const [kind, source, title, sev, status, count, first, last] of rows) {
  await db.query(
    `INSERT INTO public.ops_alert_ledger (fingerprint, source_kind, source, title, severity, status, count, first_seen, last_seen, closed_at, verify_started_at)
     VALUES (md5($1 || '|' || $2 || '|' || $3), $1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $5 = 'closed' THEN $8::timestamptz + interval '1 hour' END,
             CASE WHEN $5 = 'verifying' THEN $8::timestamptz END)`,
    [kind, source, title, sev, status, count, first, last]);
}
const total = async () => (await db.query(`SELECT count(*)::int n, sum(count)::int c FROM public.ops_alert_ledger WHERE source_kind = 'sentry'`)).rows[0];
const before = await total();

if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(MIG);

const after = await total();
check(after.c === before.c, `occurrences kept: ${before.c} -> ${after.c}`);
check(after.n === 5, `11 sentry rows fold to 5 (one per error): got ${after.n}`);
const ver = (await db.query(`SELECT status, verify_started_at FROM public.ops_alert_ledger WHERE title LIKE 'error: a verifying copy%'`)).rows;
check(ver.length === 1 && ver[0].status === "open" && ver[0].verify_started_at === null, `a verifying copy merged with an open one is open, no verification running: ${JSON.stringify(ver)}`);
const profiles = (await db.query(`SELECT * FROM public.ops_alert_ledger WHERE title = 'error: permission denied for table profiles'`)).rows;
check(profiles.length === 1, `"permission denied for table profiles" is one row: ${profiles.length}`);
if (profiles[0]) {
  const p = profiles[0];
  check(p.source === "sentry:assets/app-shared", `its source is the bundle name: ${p.source}`);
  check(Number(p.count) === 12 && p.status === "open" && p.severity === "error", `count 12, open, worst severity error: ${p.count}/${p.status}/${p.severity}`);
  check(new Date(p.first_seen).toISOString() === "2026-10-09T01:38:12.000Z" && new Date(p.last_seen).toISOString() === "2026-10-13T23:01:36.000Z", "first/last seen widened");
}
const http = (await db.query(`SELECT status, severity, count FROM public.ops_alert_ledger WHERE title LIKE 'functionshttperror%'`)).rows;
check(http.length === 1 && http[0].status === "open" && http[0].severity === "fatal", `httperror: one row, open wins, fatal kept: ${JSON.stringify(http)}`);
const zip = (await db.query(`SELECT status, closed_at FROM public.ops_alert_ledger WHERE title LIKE 'error: zip%'`)).rows;
check(zip.length === 1 && zip[0].status === "closed" && zip[0].closed_at, `two closed copies stay closed: ${JSON.stringify(zip)}`);
const badFp = (await db.query(`SELECT count(*)::int n FROM public.ops_alert_ledger WHERE fingerprint <> md5(source_kind || '|' || source || '|' || title)`)).rows[0].n;
check(badFp === 0, `every fingerprint is md5(kind|source|title): ${badFp} off`);
const other = (await db.query(`SELECT source FROM public.ops_alert_ledger WHERE source_kind = 'error_logs'`)).rows[0].source;
check(other === "cu(assets/app-shared-DUoNbpYC)", "a non-sentry row is untouched");
const native = (await db.query(`SELECT count(*)::int n FROM public.ops_alert_ledger WHERE source = 'sentry:sendDataToNative(iabjs://navigation_performance_logger_android)'`)).rows[0].n;
check(native === 1, "a culprit that is not a hashed bundle keeps its source");

if (process.env.NEW_MIGRATION !== "skip") {
  let mism = 0;
  for (const [, source] of rows.filter((r) => r[0] === "sentry").concat([["sentry", "sentry:"], ["sentry", "sentry:x(assets/tiktok-provider-AbCdEf12)"], ["sentry", "sentry:assets/tiktok-provider"], ["sentry", "sentry:/assets/app-shared-CkIDj-oG.js"], ["sentry", "sentry:x(assets/a/b/c-AbCdEf12.mjs)"], ["sentry", "sentry:fn(assets/no-hash)"]])) {
    const sql = (await db.query(`SELECT public.ops_alert_sentry_source($1) v`, [source])).rows[0].v;
    const js = `sentry:${sentryCulpritKey(source.slice("sentry:".length))}`.slice(0, 120);
    if (sql !== js) { mism++; console.log(`  mismatch ${source}: sql=${sql} js=${js}`); }
  }
  check(mism === 0, `SQL twin == JS sentryCulpritKey on every source (${mism} mismatches)`);
  const idem = (await db.query(`SELECT count(*)::int n FROM unnest($1::text[]) s WHERE public.ops_alert_sentry_source(public.ops_alert_sentry_source(s)) IS DISTINCT FROM public.ops_alert_sentry_source(s)`,
    [[...rows.map((r) => r[1]), "sentry:x(assets/tiktok-provider-AbCdEf12)", "sentry:assets/tiktok-provider"]])).rows[0].n;
  check(idem === 0, `the SQL twin is idempotent (assets/tiktok-provider stays whole): ${idem} sources change twice`);
  const acl = (await db.query(`SELECT has_function_privilege('anon', 'public.ops_alert_sentry_source(text)', 'EXECUTE') a, has_function_privilege('authenticated', 'public.ops_alert_sentry_source(text)', 'EXECUTE') b`)).rows[0];
  check(!acl.a && !acl.b, "anon and authenticated cannot execute ops_alert_sentry_source");
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
