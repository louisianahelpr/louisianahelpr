#!/usr/bin/env node
/**
 * PGlite proof for 20261008190546_job_start_two_hours_notice (owner pop-up
 * 2026-10-08: a new job needs at least 2 hours' notice; job 28f8cff5 was posted
 * at 1:37 PM for 2:00 PM and listed "34 minutes left" at 2:03).
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/jobTwoHoursNotice.pglite.mjs
 *
 * OLD STATE (no trigger): a signed-in poster inserts a job 30 minutes out.
 * NEW STATE: refused (job_start_too_soon); 3 hours out is taken with expires_at
 * capped at the start; a test (is_seed) poster and a server-context insert are
 * not judged; applied 3x.
 */
import { PGlite, readMigration, baseSchema, as, checker, refused, USERS } from "./seriesWorld.mjs";

const FIX = readMigration("20261008190546_job_start_two_hours_notice.sql");
const { P, A } = USERS;
const { check, failures, fail } = checker();
const AT = (offset) => `((now() at time zone 'America/Chicago') + interval '${offset}')`;
const insert = (title, offset, expiresOffset = "1 day") => `insert into public.jobs (title, customer_id, status, date_needed, start_time, expires_at)
  values ('${title}', '${P}', 'open', (${AT(offset)})::date, date_trunc('minute', ${AT(offset)})::time, now() + interval '${expiresOffset}') returning expires_at, ((date_needed + start_time) at time zone 'America/Chicago') as starts_at`;

{
  const db = new PGlite();
  await db.exec(baseSchema("20261008190546"));
  await db.exec(`grant insert, select on public.jobs to authenticated; alter table public.profiles add column if not exists is_seed boolean default false;`);
  const r = await as(db, "authenticated", P, insert("old", "30 minutes"));
  console.log(`-- OLD STATE ${r.ok ? "RED" : "NOT RED"}: a post 30 minutes out ${r.ok ? "taken" : "refused"}`);
  if (!r.ok) fail();
  await db.close();
}

const db = new PGlite();
await db.exec(baseSchema("20261008190546"));
await db.exec(`grant insert, select on public.jobs to authenticated;`);
// prod has profiles.is_seed (the world's minimal profiles table does not).
await db.exec(`alter table public.profiles add column if not exists is_seed boolean default false;`);
for (let i = 0; i < 3; i++) await db.exec(FIX);
check("applies 3x (replay-safe)", true);

let r = await as(db, "authenticated", P, insert("soon", "30 minutes"));
check("a poster's job 30 minutes out is refused: job_start_too_soon", refused(r, /job_start_too_soon/), r.err);
r = await as(db, "authenticated", P, insert("edge", "119 minutes"));
check("1 h 59 m out is refused", refused(r, /job_start_too_soon/), r.err);
r = await as(db, "authenticated", P, insert("ok", "3 hours"));
check("3 hours out is taken", r.ok, r.err);
check("and its listing closes AT the start, not a day later", r.ok && new Date(r.rows[0].expires_at).getTime() === new Date(r.rows[0].starts_at).getTime(), JSON.stringify(r.rows?.[0]));

await db.exec(`update public.profiles set is_seed = true where user_id = '${A}';`);
r = await as(db, "authenticated", A, insert("seed", "4 minutes").replace(`'${P}'`, `'${A}'`));
check("a test (is_seed) poster is not judged (the nightly journeys post minutes out)", r.ok, r.err);
r = await as(db, "service_role", null, insert("server", "4 minutes"));
check("a server-context insert is not judged", r.ok, r.err);

await db.close();
if (failures()) process.exit(1);
console.log("ALL CHECKS PASSED");
