#!/usr/bin/env node
/**
 * PGlite proof for 20260924101636_jobs_start_time_required (ST-008).
 *
 *   node src/test/pglite/jobsStartTimeRequired.pglite.mjs
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). Prints
 * "OLD STATE RED" when a real non-flexible job with no start time is accepted
 * before the migration, then applies it 3x (replay-safe) and exits 1 unless:
 * that insert is refused; flexible, timed and non-recurring seed rows are
 * accepted; a seed recurring parent with no start time is refused; and the
 * existing seed rows (the live 216) validate.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const sql = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/20260924101636_jobs_start_time_required.sql", import.meta.url)), "utf8");
const db = new PGlite();
await db.exec(`create table public.jobs(id serial primary key, is_flexible_schedule boolean default false, start_time time, is_seed boolean not null default false, recurrence_days integer[]);`);

const tryInsert = async (cols) => {
  const keys = Object.keys(cols);
  try {
    await db.query(`insert into public.jobs(${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(cols));
    return "accepted";
  } catch (e) {
    return /jobs_start_time_required/.test(String(e.message)) ? "refused" : `error: ${e.message}`;
  }
};

const real = { is_flexible_schedule: false, start_time: null, is_seed: false };
const before = await tryInsert(real);
console.log(before === "accepted" ? "OLD STATE RED: real non-flexible job with no start time accepted" : `old state: ${before}`);
await db.exec(`delete from public.jobs; insert into public.jobs(is_flexible_schedule, start_time, is_seed) select false, null, true from generate_series(1,216);`);

for (let i = 0; i < 3; i++) await db.exec(sql);

const cases = [
  ["real, not flexible, no start time", real, "refused"],
  ["real, flexible flag NULL, no start time", { is_flexible_schedule: null, start_time: null, is_seed: false }, "refused"],
  ["real, flexible, no start time", { is_flexible_schedule: true, start_time: null, is_seed: false }, "accepted"],
  ["real, not flexible, 09:30", { is_flexible_schedule: false, start_time: "09:30", is_seed: false }, "accepted"],
  ["seed, not flexible, no start time", { is_flexible_schedule: false, start_time: null, is_seed: true }, "accepted"],
  ["seed recurring parent, no start time", { is_flexible_schedule: false, start_time: null, is_seed: true, recurrence_days: [1, 3] }, "refused"],
];
let bad = 0;
for (const [label, cols, want] of cases) {
  const got = await tryInsert(cols);
  console.log(`${got === want ? "ok  " : "FAIL"} ${label}: ${got} (want ${want})`);
  if (got !== want) bad++;
}
const { rows: [{ n }] } = await db.query(`select count(*)::int n from public.jobs where is_seed and start_time is null and not is_flexible_schedule`);
console.log(n >= 216 ? `ok   existing seed rows kept: ${n}` : `FAIL existing seed rows: ${n}`);
if (n < 216) bad++;
process.exit(bad ? 1 : 0);
