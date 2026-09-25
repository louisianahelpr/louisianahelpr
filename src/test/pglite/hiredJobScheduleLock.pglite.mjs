#!/usr/bin/env node
/**
 * PGlite proof for 20260925160644_hired_job_schedule_lock (money audit
 * 2026-09-25, HIGH-2).
 *
 *   PGLITE_DIR=~/.lh-pglite-probe node src/test/pglite/hiredJobScheduleLock.pglite.mjs
 *
 * World: seriesWorld.mjs (the real jobs trigger chain from the newest
 * migrations before 20260925160644), plus 20260925052841.
 *
 * OLD STATE: the poster moves the date / start time of a hired one-off job, a
 * crew job, a recurring child visit and a CANCELLED job (each rows=1): that is
 * the late-fee dodge and the refund re-price. Printed as "OLD STATE RED".
 * NEW STATE (migration applied 3x): all four refused with schedule_locked; an
 * open unhired job is still editable; a definer/service path still writes.
 */
import { PGlite, readMigration, baseSchema, as, checker, refused, USERS } from "./seriesWorld.mjs";

const END = readMigration("20260925052841_recurring_series_end.sql");
const LOCK = readMigration("20260925160644_hired_job_schedule_lock.sql");
const { P, A, B } = USERS;
const { check, failures, fail } = checker();
const J = (n) => `b0000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

const SEED = `
  insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time)
  values ('${J(1)}', 'hired one-off', '${P}', '${A}', 'accepted', current_date + 1, '08:00'),
         ('${J(2)}', 'crew job', '${P}', null, 'open', current_date + 1, '08:00'),
         ('${J(4)}', 'cancelled job', '${P}', null, 'cancelled', current_date + 1, '08:00'),
         ('${J(5)}', 'open job', '${P}', null, 'open', current_date + 1, '08:00'),
         ('${J(6)}', 'series parent', '${P}', '${A}', 'accepted', current_date + 1, '08:00');
  insert into public.group_job_helpers (job_id, helper_id) values ('${J(2)}', '${B}');
`;
// The child visit is seeded after the migrations under test (052841's insert trigger).
const CHILD = `insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, parent_job_id)
  values ('${J(3)}', 'recurring visit', '${P}', '${A}', 'accepted', current_date + 2, '08:00', '${J(6)}')`;
const MOVES = [
  [J(1), "hired one-off"], [J(2), "crew job"], [J(3), "recurring visit"], [J(4), "cancelled job"],
];
const move = (db, id, col) => as(db, "authenticated", P,
  col === "date" ? `update public.jobs set date_needed = date_needed + 3 where id='${id}'`
                 : `update public.jobs set start_time = '20:00' where id='${id}'`);

{
  const db = new PGlite();
  await db.exec(baseSchema("20260925160644"));
  await db.exec(END);
  await db.exec(SEED);
  await db.exec(CHILD);
  const landed = [];
  for (const [id, name] of MOVES) {
    const r = await move(db, id, "date");
    if (r.ok && r.affected === 1) landed.push(name);
  }
  const red = landed.length === MOVES.length;
  console.log(`-- OLD STATE ${red ? "RED" : "NOT RED"}: the poster moved the date of: ${landed.join(", ")}`);
  if (!red) fail();
  await db.close();
}

const db = new PGlite();
await db.exec(baseSchema("20260925160644"));
await db.exec(END);
for (let i = 0; i < 3; i++) await db.exec(LOCK);
await db.exec(SEED);
await db.exec(CHILD);
check("migration applies 3x (replay-safe)", true);

for (const [id, name] of MOVES) {
  for (const col of ["date", "time"]) {
    const r = await move(db, id, col);
    check(`poster cannot move the ${col} of a ${name}`, refused(r, /schedule_locked/), r.err);
  }
}
let r = await as(db, "authenticated", A, `update public.jobs set date_needed = date_needed + 3 where id='${J(1)}'`);
check("the hired Helpr cannot move it either", !r.ok, r.err);
r = await move(db, J(5), "date");
check("an open, unhired job's date is still editable", r.ok && r.affected === 1, r.err);
r = await as(db, "authenticated", P, `update public.jobs set title = 'renamed' where id='${J(1)}'`);
check("an unrelated edit on a hired job still works", r.ok && r.affected === 1, r.err);
r = await as(db, "service_role", null, `update public.jobs set date_needed = date_needed + 1 where id='${J(1)}'`);
check("a server path is not client-locked", r.ok && r.affected === 1, r.err);
r = await as(db, "authenticated", A, `select has_function_privilege('anon', 'public.job_has_crew(uuid)', 'execute') as x`);
check("anon cannot execute job_has_crew", r.ok && r.rows[0].x === false, r.err);

await db.close();
console.log(failures() ? `\n${failures()} FAILED` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
