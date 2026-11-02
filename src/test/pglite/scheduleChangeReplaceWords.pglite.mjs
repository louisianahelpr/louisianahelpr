#!/usr/bin/env node
/**
 * PGlite proof for 20261102061755_schedule_change_replace_words_your_own.sql (Q2297).
 *
 *   node src/test/pglite/scheduleChangeReplaceWords.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/scheduleChangeReplaceWords.pglite.mjs # RED: the live definition only
 *   PLANT=all node src/test/pglite/scheduleChangeReplaceWords.pglite.mjs          # planted: always "your"
 *   PLANT=after node src/test/pglite/scheduleChangeReplaceWords.pglite.mjs        # planted: counted after the UPDATE
 *   PLANT=anon node src/test/pglite/scheduleChangeReplaceWords.pglite.mjs         # planted: Supabase's default anon grant
 *
 * The poster asks to move a job; the Helpr answers with "Suggest another time" (a new request that replaces the
 * poster's). The poster is told "This replaces your earlier request." A person who asks again (replacing their own
 * request) still tells the other side "This replaces their earlier request." A first request says neither.
 * World: the live definition (20261021102943_refund_requests.sql section 6b, md5(prosrc) b9c00fe7 on prod,
 * read 2026-11-02) over the schedule-change chain.
 */
import { PGlite, readMigration, baseSchema, as, checker, refused, USERS } from "./seriesWorld.mjs";

const PRIOR = [
  "20260927012804_recurring_series_end.sql",
  "20260927012805_hired_job_schedule_lock.sql",
  "20260927012806_recurring_split_days.sql",
  "20260927012807_job_schedule_change_requests.sql",
  "20261002060514_schedule_change_refuses_helpr_clash.sql",
  "20261004004707_schedule_change_accept_rechecks_clash.sql",
  "20261005064336_schedule_clash_declines_with_notice.sql",
  "20261008183640_schedule_change_lead_time_and_expiry_notice.sql",
  "20261015015604_schedule_change_uses_booking_rule.sql",
].map(readMigration);
// The live definition: only its request_job_schedule_change (the rest of that file is the refund flow).
const refundFile = readMigration("20261021102943_refund_requests.sql");
const at = refundFile.indexOf("CREATE OR REPLACE FUNCTION public.request_job_schedule_change");
const LIVE = refundFile.slice(at, refundFile.indexOf("$fn$;", refundFile.indexOf("AS $fn$", at)) + 5);
let FIX = readMigration("20261102061755_schedule_change_replace_words_your_own.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
const PLANT = process.env.PLANT ?? "";
if (PLANT === "all") FIX = FIX.replace("WHEN v_replaced_theirs > 0 THEN", "WHEN true THEN");
if (PLANT === "after") {
  // Count after the UPDATE has closed the rows: nothing is pending any more, so "your" is never chosen.
  const count = FIX.slice(FIX.indexOf("  SELECT count(*) INTO v_replaced_theirs"), FIX.indexOf("  UPDATE public.job_schedule_change_requests r"));
  FIX = FIX.replace(count, "").replace("  GET DIAGNOSTICS v_replaced = ROW_COUNT;\n", "  GET DIAGNOSTICS v_replaced = ROW_COUNT;\n" + count);
}
if (PLANT === "anon") FIX = FIX.replace("FROM PUBLIC, anon;", "FROM PUBLIC;");
if (MODE) console.log(`NEW_MIGRATION=${MODE}: the live definition only (expect FAILs)`);
if (PLANT) console.log(`PLANT=${PLANT} (expect FAILs)`);
const { P, A } = USERS;
const { check, failures } = checker();
const J = (n) => `c0000000-0000-0000-0000-0000000097${String(n).padStart(2, "0")}`;

const db = new PGlite();
await db.exec(baseSchema("20260927012804"));
for (const m of PRIOR) await db.exec(m);
await db.exec(`
  create table if not exists public.refund_requests (id uuid primary key default gen_random_uuid(), job_id uuid, status text,
    responder_id uuid, answer_by timestamptz);
  alter table public.group_job_helpers add column if not exists helper_completed_at timestamptz;
`);
await db.exec(LIVE);
// Supabase grants EXECUTE on every new public function to anon by default; the migration must take it back by name.
await db.exec(`grant execute on function public.request_job_schedule_change(uuid, date, time) to anon;`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(FIX);
await db.exec(`
  insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at)
  values ('${J(1)}', 'Mow two lawns', '${P}', '${A}', 'accepted', current_date + 5, '09:00', now()),
         ('${J(2)}', 'Paint', '${P}', '${A}', 'accepted', current_date + 6, '10:00', now());
`);
const ask = (uid, job, days) => as(db, "authenticated", uid, `select public.request_job_schedule_change('${job}', current_date + ${days}, '14:00') as v`);
const notices = async (job, to) =>
  (await db.query(`select message from public.notifications where job_id='${job}' and user_id='${to}' and title='New date or time requested' order by message`)).rows.map((r) => r.message);

// The poster asks; the Helpr suggests another time (replaces the poster's request).
let r = await ask(P, J(1), 8);
check("the poster's first request is made", r.ok, r.err);
check("a first request says nothing about replacing", (await notices(J(1), A)).every((m) => !/replaces/.test(m)), JSON.stringify(await notices(J(1), A)));
r = await ask(A, J(1), 9);
check("the Helpr's suggestion is made and replaces one request", r.ok && r.rows[0].v.replaced === 1, r.err ?? JSON.stringify(r.rows?.[0]));
const toPoster = await notices(J(1), P);
check("the poster is told it replaces THEIR OWN request: 'your earlier request'",
  toPoster.length === 1 && /This replaces your earlier request\.$/.test(toPoster[0]), JSON.stringify(toPoster));

// The same person asks again (replacing their own request): the other side reads "their".
r = await ask(P, J(2), 8);
r = await ask(P, J(2), 10);
check("the poster's second request replaces their first", r.ok && r.rows[0].v.replaced === 1, r.err ?? JSON.stringify(r.rows?.[0]));
const toHelpr = await notices(J(2), A);
check("the Helpr reads 'their earlier request' on the poster's repeat ask",
  toHelpr.length === 2 && toHelpr.some((m) => /This replaces their earlier request\.$/.test(m)) && !toHelpr.some((m) => /your earlier/.test(m)), JSON.stringify(toHelpr));
check("anon cannot call it", refused(await as(db, "anon", null, `select public.request_job_schedule_change('${J(1)}', current_date + 11, '14:00')`), /permission denied/));

await db.close();
if (failures()) { console.log(`\n${failures()} FAILED`); process.exit(1); }
console.log("\nALL CHECKS PASSED");
