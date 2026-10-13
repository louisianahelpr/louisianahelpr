/**
 * Q1424 PGlite proof: detect_suspicious_user_patterns counts a row 1 ms inside
 * each of its trailing windows and not a row AT the edge, on a fixed clock
 * (./lib/fixedClock.mjs, the newest CREATE). Each pattern is seeded one row short
 * of its threshold inside the window plus one row at the edge (not flagged),
 * then the edge row moved 1 ms inside (flagged). Thresholds as in the newest body, read 2026-10-13:
 *   burst_job_posting           10 jobs posted in the last 24 h
 *   multi_reporter_flag         3 distinct reporters of a user in the last 30 days
 *   rapid_cancellation_pattern  5 jobs cancelled < 2 h after posting, posted in the last 7 days
 *                               (and a cancel exactly 2 h after posting is not rapid)
 *   duplicate_content_posting   3 jobs with one title in the last 7 days
 *
 *   node src/test/pglite/suspiciousPatternsClock.pglite.mjs
 *   SUSPICIOUS_INCLUSIVE=1 node src/test/pglite/suspiciousPatternsClock.pglite.mjs   # RED: every `> now - x` made `>=`
 *
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
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, status text, title text, description text,
  parent_job_id uuid, created_at timestamptz, cancelled_at timestamptz);
CREATE TABLE public.reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid, reported_id uuid, reported_type text,
  status text, created_at timestamptz);
CREATE TABLE public.fraud_flags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, flag_type text, details text, resolved boolean);
CREATE FUNCTION public.log_cron_defect(text, text, text, jsonb) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
`);
const { file, stmt } = newestFunction("detect_suspicious_user_patterns");
let fixed = onFixedClock(stmt);
check(`detect_suspicious_user_patterns: every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
if (process.env.SUSPICIOUS_INCLUSIVE) {
  console.log("SUSPICIOUS_INCLUSIVE=1: every window made inclusive (expect FAILs)");
  fixed = fixed.replace(/created_at > public\._probe_now\(\) - INTERVAL/g, "created_at >= public._probe_now() - INTERVAL");
}
for (let i = 0; i < 3; i++) await db.exec(fixed); // replay-safe: applies 3x

const HOUR = 3_600_000, DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const iso = (ms) => new Date(ms).toISOString();
await setClock(db, iso(NOW));
const USER = "00000000-0000-0000-0000-0000000000c1";
const R = (k) => `00000000-0000-0000-0000-0000000000${String(10 + k)}`;

async function flags(seed) {
  await db.exec(`DELETE FROM public.jobs; DELETE FROM public.reports; DELETE FROM public.fraud_flags; DELETE FROM auth.users;`);
  await q(`INSERT INTO auth.users VALUES ($1)`, [USER]);
  await seed();
  await db.exec(`SELECT public.detect_suspicious_user_patterns()`);
  return (await q(`SELECT flag_type FROM public.fraud_flags`)).map((r) => r.flag_type);
}
const job = (createdMs, over = {}) =>
  q(`INSERT INTO public.jobs (customer_id, status, title, description, created_at, cancelled_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [USER, over.status ?? "open", over.title ?? `job ${Math.random()}`, null, iso(createdMs), over.cancelledMs ? iso(over.cancelledMs) : null]);

for (const [label, lastMs, want] of [["at the 24 h edge", NOW - DAY, false], ["1 ms inside", NOW - DAY + 1, true]]) {
  const got = await flags(async () => { for (let i = 0; i < 9; i++) await job(NOW - HOUR); await job(lastMs); });
  check(`burst_job_posting: 9 jobs + the 10th ${label}: ${want ? "flagged" : "not flagged"}`, got.includes("burst_job_posting") === want, got.join(","));
}
for (const [label, lastMs, want] of [["at the 30 d edge", NOW - 30 * DAY, false], ["1 ms inside", NOW - 30 * DAY + 1, true]]) {
  const got = await flags(async () => {
    for (let k = 0; k < 2; k++) await q(`INSERT INTO public.reports (reporter_id, reported_id, reported_type, created_at) VALUES ($1, $2, 'user', $3)`, [R(k), USER, iso(NOW - DAY)]);
    await q(`INSERT INTO public.reports (reporter_id, reported_id, reported_type, created_at) VALUES ($1, $2, 'user', $3)`, [R(2), USER, iso(lastMs)]);
  });
  check(`multi_reporter_flag: 2 reporters + the 3rd ${label}: ${want ? "flagged" : "not flagged"}`, got.includes("multi_reporter_flag") === want, got.join(","));
}
for (const [label, lastMs, want] of [["at the 7 d edge", NOW - 7 * DAY, false], ["1 ms inside", NOW - 7 * DAY + 1, true]]) {
  const got = await flags(async () => {
    for (let i = 0; i < 4; i++) await job(NOW - DAY, { status: "cancelled", cancelledMs: NOW - DAY + HOUR });
    await job(lastMs, { status: "cancelled", cancelledMs: lastMs + HOUR });
  });
  check(`rapid_cancellation_pattern: 4 + the 5th ${label}: ${want ? "flagged" : "not flagged"}`, got.includes("rapid_cancellation_pattern") === want, got.join(","));
}
{
  const got = await flags(async () => { for (let i = 0; i < 5; i++) await job(NOW - DAY, { status: "cancelled", cancelledMs: NOW - DAY + 2 * HOUR }); });
  check("rapid_cancellation_pattern: cancelled exactly 2 h after posting is not rapid", !got.includes("rapid_cancellation_pattern"), got.join(","));
}
for (const [label, lastMs, want] of [["at the 7 d edge", NOW - 7 * DAY, false], ["1 ms inside", NOW - 7 * DAY + 1, true]]) {
  const got = await flags(async () => { await job(NOW - DAY, { title: "Same title" }); await job(NOW - DAY, { title: "Same title" }); await job(lastMs, { title: "Same title" }); });
  check(`duplicate_content_posting: 2 + the 3rd same title ${label}: ${want ? "flagged" : "not flagged"}`, got.includes("duplicate_content_posting") === want, got.join(","));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exitCode = failures ? 1 : 0;
