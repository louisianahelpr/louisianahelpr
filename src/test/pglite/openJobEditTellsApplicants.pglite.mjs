#!/usr/bin/env node
/**
 * PGlite proof for 20261021111723_open_job_edit_tells_applicants.sql (board 66/172 slice 4).
 *
 *   node src/test/pglite/openJobEditTellsApplicants.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/openJobEditTellsApplicants.pglite.mjs # RED: without it
 */
import { PGlite, readMigration, baseSchema, as, checker, refused, USERS } from "./seriesWorld.mjs";

const FIX = readMigration("20261021111723_open_job_edit_tells_applicants.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: no edit notices or category lock (expect FAILs)`);
const { P, A, B, C } = USERS;
const { check, failures } = checker();
const J = (n) => `c0000000-0000-0000-0000-0000000005${String(n).padStart(2, "0")}`;

const db = new PGlite();
await db.exec(baseSchema("20261021111723"));
await db.exec(`
  alter table public.jobs add column if not exists last_edit_notice_at timestamptz;
  insert into public.jobs (id, title, description, category, customer_id, status, date_needed, start_time, location)
  values ('${J(1)}', 'Mow two lawns', 'Front and back', 'yard_work', '${P}', 'open', current_date + 5, '09:00', '12 Oak St, Lafayette, LA 70508'),
         ('${J(2)}', 'Paint a fence', 'Cedar', 'painting', '${P}', 'open', current_date + 6, '10:00', '1 Elm St, Lafayette, LA 70508');
  insert into public.applications (job_id, helper_id, status) values
    ('${J(1)}', '${A}', 'pending'), ('${J(1)}', '${B}', 'pending'), ('${J(1)}', '${C}', 'rejected');
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(FIX);
const notes = async () => (await db.query(`select user_id, message, link from public.notifications where title = 'A job you applied to changed' order by id`)).rows;

let r = await as(db, "authenticated", P, `update public.jobs set start_time = '14:00', location = '9 Pine St, Lafayette, LA 70508' where id = '${J(1)}'`);
check("the poster's edit lands", r.ok, r.err);
let n = await notes();
check("each PENDING applicant is told once, naming what changed", n.length === 2 && n.every((x) => /changed the date and time and the place\./.test(x.message)) && n.map((x) => x.user_id).sort().join() === [A, B].sort().join(), JSON.stringify(n));
check("the notice links to the job page", n.every((x) => x.link === `/jobs/${J(1)}`), JSON.stringify(n));
r = await as(db, "authenticated", P, `update public.jobs set title = 'Mow three lawns' where id = '${J(1)}'`);
check("a second edit within the hour sends nothing more", r.ok && (await notes()).length === 2, r.err);
r = await as(db, "authenticated", P, `update public.jobs set last_edit_notice_at = null where id = '${J(1)}'`);
check("the hour cannot be reset by the poster", (await db.query(`select last_edit_notice_at is not null as set from public.jobs where id='${J(1)}'`)).rows[0].set === true, r.err);
r = await as(db, "authenticated", P, `update public.jobs set category = 'cleaning' where id = '${J(1)}'`);
check("the category is locked once people have applied", refused(r, /category_locked_after_applications/), r.ok ? "landed" : r.err);
r = await as(db, "authenticated", P, `update public.jobs set category = 'cleaning' where id = '${J(2)}'`);
check("a job nobody applied to can still change category", r.ok, r.err);
r = await as(db, "service_role", null, `update public.jobs set start_time = '16:00' where id = '${J(2)}'`);
check("a server write is not an edit notice", r.ok && (await notes()).length === 2, r.err);

// lh-authz-rls F1: a client cannot set the hour on INSERT (a far-future stamp would silence every notice).
const J3 = J(3);
r = await as(db, "authenticated", P, `insert into public.jobs (id, title, description, category, customer_id, status, date_needed, start_time, location, last_edit_notice_at)
  values ('${J3}', 'Wash a car', 'Sedan', 'cleaning', '${P}', 'open', current_date + 7, '08:00', '5 Ash St, Lafayette, LA 70508', '2999-01-01')`);
check("a client insert lands", r.ok, r.err);
check("a client-sent hour is cleared on insert", (await db.query(`select last_edit_notice_at from public.jobs where id='${J3}'`)).rows[0]?.last_edit_notice_at === null, r.err);
// F4: an edit nobody hears does not use the hour.
r = await as(db, "authenticated", P, `update public.jobs set title = 'Wash two cars' where id = '${J3}'`);
check("an edit with no applicants leaves the hour unused", r.ok && (await db.query(`select last_edit_notice_at from public.jobs where id='${J3}'`)).rows[0].last_edit_notice_at === null, r.err);
await db.exec(`insert into public.applications (job_id, helper_id, status) values ('${J3}', '${A}', 'pending'), ('${J3}', '${B}', 'pending')`);
// F3: a blocked applicant is not told.
await db.exec(`insert into public.user_blocks (a, b) values ('${B}', '${P}')`);
const before3 = (await notes()).length;
r = await as(db, "authenticated", P, `update public.jobs set location = '6 Ash St, Lafayette, LA 70508' where id = '${J3}'`);
const after3 = (await notes()).slice(before3);
check("the next edit tells the applicant who arrived later", r.ok && after3.some((x) => x.user_id === A), JSON.stringify(after3));
check("an applicant blocked with the poster is not told", !after3.some((x) => x.user_id === B), JSON.stringify(after3));
// F1 clamp: a future stamp (however it got there) never suppresses.
await db.exec(`update public.jobs set last_edit_notice_at = '2999-01-01' where id = '${J3}'`);
const before4 = (await notes()).length;
r = await as(db, "authenticated", P, `update public.jobs set description = 'Sedan and a truck' where id = '${J3}'`);
check("a future stamp does not silence the next notice", r.ok && (await notes()).length > before4, r.err);
await db.close();
if (failures()) { console.log(`\n${failures()} FAILED`); process.exit(1); }
console.log("\nALL CHECKS PASSED");
