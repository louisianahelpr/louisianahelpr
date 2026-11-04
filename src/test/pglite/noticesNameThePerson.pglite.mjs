#!/usr/bin/env node
/**
 * PGlite proof for 20261104050109_notices_name_the_person.sql (Q2331, owner 2026-11-03: "first name + last
 * initial"): the poster's crew notice from expire_unanswered_offers reads "Bea T. didn't answer in time for ..."
 * and series_release_dates' gave-up notice "Bea T. gave up <dates> on ...". The role words stay only for a blank
 * name; the neutral holder_ineligible line still names nobody; a "%" in a name is text, not a format spec.
 *
 *   node src/test/pglite/noticesNameThePerson.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/noticesNameThePerson.pglite.mjs # RED: the live definitions only
 *   PLANT=scrub node src/test/pglite/noticesNameThePerson.pglite.mjs        # RED: the scrub without the series matches
 *
 * World: the live bodies are the newest earlier migrations (20261103023713 and 20261102070659), which match
 * prod md5(prosrc) 9c2647e1... and b1fc50b6... (read-only pg_proc check, 2026-11-03).
 */
import { PGlite, readMigration, baseSchema, newestFunctionSql, checker, USERS } from "./seriesWorld.mjs";

let FIX = readMigration("20261104050109_notices_name_the_person.sql");
// PLANT=scrub: the new names, but the departed-member scrub without the series-party matches (expect the scrub FAIL).
if (process.env.PLANT === "scrub") FIX = FIX.replace(/\n\s*-- Q2331 review \(lh-authz-rls[\s\S]*?OLD\.user_id\)\)/, ")");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: the live definitions only (expect FAILs)`);
const { check, failures } = checker();
const BEFORE = "20261104050109";
const NAME_FN = newestFunctionSql("member_display_name", BEFORE).sql;

// ── 1. expire_unanswered_offers: a crew spot whose offer ran out ─────────────────────────────────────────
{
  const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
  const BEA = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
  const NONAME = "5a5a5a5a-0000-4000-8000-000000000009";
  const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const db = new PGlite();
  await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, status text, title text, payment_status text,
  date_needed date, start_time time, response_deadline timestamptz, helper_confirmed_at timestamptz, is_seed boolean DEFAULT true,
  is_group_job boolean DEFAULT false, helpers_needed int DEFAULT 1);
CREATE TABLE public.applications (id uuid PRIMARY KEY, job_id uuid, helper_id uuid, status text, closed_reason text);
CREATE TABLE public.profiles (user_id uuid, full_name text, is_seed boolean DEFAULT true);
CREATE TABLE public.job_accept_pending (job_id uuid, helper_id uuid);
CREATE TABLE public.group_job_helpers (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, job_id uuid, helper_id uuid, helper_confirmed_at timestamptz, response_deadline timestamptz);
CREATE TABLE public.notifications (user_id uuid, title text, message text, type text, link text, job_id uuid);
CREATE TABLE public.error_logs (severity text, message text, tags jsonb, context jsonb);
CREATE TABLE public.strikes (helper_id uuid, job_id uuid, why text);
CREATE FUNCTION public.helper_accept_block_reason(u uuid) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.apply_job_denial_consequence(p_helper uuid, p_job uuid, p_description text) RETURNS jsonb LANGUAGE sql AS $$ INSERT INTO public.strikes VALUES (p_helper, p_job, p_description) RETURNING jsonb_build_object('action', 'warning') $$;
INSERT INTO public.profiles (user_id, full_name) VALUES ('${POSTER}', 'Pat Poster'), ('${BEA}', 'Bea 100% Thibodeaux'), ('${NONAME}', '   ');
`);
  await db.exec(NAME_FN);
  await db.exec(newestFunctionSql("job_offer_cutoff", BEFORE).sql);
  await db.exec(newestFunctionSql("expire_unanswered_offers", BEFORE).sql);
  if (!MODE) for (let i = 0; i < 3; i++) await db.exec(FIX);
  check("expire_unanswered_offers: the migration applies 3x", true);
  const CT = "(now() AT TIME ZONE 'America/Chicago')";
  const crew = (n, who) => `
    INSERT INTO public.jobs (id, customer_id, status, title, payment_status, date_needed, start_time, is_group_job, helpers_needed)
    VALUES ('${id(n)}', '${POSTER}', 'open', 'Crew ${n}', 'escrow', ${CT}::date + 3, '09:00', true, 2);
    INSERT INTO public.group_job_helpers (job_id, helper_id, response_deadline) VALUES ('${id(n)}', '${who}', now() - interval '1 minute');
    INSERT INTO public.applications (id, job_id, helper_id, status) VALUES ('${id(100 + n)}', '${id(n)}', '${who}', 'accepted');`;
  await db.exec(crew(1, BEA) + crew(2, NONAME));
  await db.exec(`SELECT public.expire_unanswered_offers();`);
  const msg = async (n) => (await db.query(`SELECT message FROM public.notifications WHERE job_id = '${id(n)}' AND user_id = '${POSTER}'`)).rows[0]?.message ?? "";
  const m1 = await msg(1);
  check("the crew notice names the Helpr: \"Bea T. didn't answer in time\"",
    m1 === `Bea T. didn't answer in time for "Crew 1". Their spot is open to everyone again, so you can pick somebody else.`, m1);
  const m2 = await msg(2);
  check("a blank name keeps the role words", m2.startsWith(`A Helpr you picked didn't answer in time for "Crew 2".`), m2);
  if (!MODE) {
    const acl = (await db.query(`SELECT proacl::text a FROM pg_proc WHERE proname = 'expire_unanswered_offers'`)).rows[0].a ?? "";
    check("expire_unanswered_offers grants: service_role only", /service_role=X/.test(acl) && !/(^|[{,])(=|anon=|authenticated=)/.test(acl), acl);
  }
  await db.close();
}

// ── 2. series_release_dates: dates a Helpr gave up ────────────────────────────────────────────────────────
{
  const { P, A } = USERS;
  const S = "c0000000-0000-0000-0000-000000002331";
  const db = new PGlite();
  await db.exec(baseSchema("20260927012804"));
  for (const f of ["20260927012804_recurring_series_end.sql", "20260927012805_hired_job_schedule_lock.sql", "20260927012806_recurring_split_days.sql"]) await db.exec(readMigration(f));
  await db.exec(NAME_FN);
  await db.exec(newestFunctionSql("series_release_dates", BEFORE).sql);
  // The Q2330 departed-member scrub as live (20261103022806): its trigger fires at purge step 4e.
  await db.exec(`alter table public.profiles add column if not exists anonymized_at timestamptz;
    create table if not exists public.user_roles (user_id uuid, role text);`);
  await db.exec(readMigration("20261103022806_departed_member_name_leaves_notifications.sql"));
  await db.exec(`update public.profiles set full_name = 'Bea Thibodeaux' where user_id = '${A}';`);
  if (!MODE) for (let i = 0; i < 3; i++) await db.exec(FIX);
  check("series_release_dates: the migration applies 3x", true);
  await db.exec(`insert into public.jobs (id, customer_id, title, status) values ('${S}', '${P}', 'Mow the yard', 'accepted') on conflict do nothing;`).catch(() => {});
  const d = (n) => `(now() AT TIME ZONE 'America/Chicago')::date + ${n}`;
  const release = async (who, n, reason) => {
    await db.exec(`delete from public.notifications;`);
    await db.exec(`insert into public.series_visit_holds (parent_job_id, visit_date, helper_id) values ('${S}', ${d(n)}, '${who}') on conflict do nothing;`);
    await db.query(`select public.series_release_dates('${S}', '${who}', array[${d(n)}]::date[], '${reason}', 'Mow the yard', '${P}')`);
    return (await db.query(`select message from public.notifications where user_id = '${P}'`)).rows.map((x) => x.message);
  };
  let r = await release(A, 6, "given_up");
  check("the gave-up notice names the Helpr: \"Bea T. gave up <date>\"",
    r.length === 1 && /^Bea T\. gave up \S+ \S+ \d+ on "Mow the yard"\. Another Helpr on the series can pick it up, or you can offer it to someone new\. A date nobody takes isn't charged, or most of it comes back to your card if you already paid for it\.$/.test(r[0]),
    JSON.stringify(r));
  r = await release(A, 7, "holder_ineligible");
  check("the neutral line (holder_ineligible) still names nobody",
    r.length === 1 && /^\S+ \S+ \d+ on "Mow the yard" is open again\. Another Helpr on the series can pick it up, or you can offer it to someone new\./.test(r[0]) && !/Bea|gave up/.test(r[0]), JSON.stringify(r));
  await db.exec(`update public.profiles set full_name = '50%s Off' where user_id = '${A}';`);
  r = await release(A, 8, "left_series");
  check("a % in a name is text, not a format spec", r.length === 1 && /^50%s O\. gave up \S+ \S+ \d+ on "Mow the yard"\./.test(r[0]), JSON.stringify(r));
  await db.exec(`update public.profiles set full_name = null where user_id = '${A}';`);
  r = await release(A, 9, "visit_cancelled");
  check("a blank name keeps \"A Helpr gave up\"", r.length === 1 && /^A Helpr gave up \S+ \S+ \d+ on "Mow the yard"\./.test(r[0]), JSON.stringify(r));
  // Review blocker (lh-authz-rls, 11-03): a series_date_offers Helpr who deletes her account leaves the
  // poster's "Bea T. gave up <date>" bell; she is a party to the parent only through the series tables.
  await db.exec(`update public.profiles set full_name = 'Bea Thibodeaux' where user_id = '${A}';
    insert into public.series_date_offers (parent_job_id, helper_id) values ('${S}', '${A}') on conflict do nothing;`);
  r = await release(A, 10, "given_up");
  check("(scrub) before the purge the poster's bell names her", r.length === 1 && /^Bea T\. gave up /.test(r[0]), JSON.stringify(r));
  await db.exec(`update public.profiles set full_name = null, anonymized_at = now() where user_id = '${A}';`);
  const after = (await db.query(`select message from public.notifications where user_id = '${P}'`)).rows.map((x) => x.message);
  check("(scrub) deleting a series_date_offers Helpr rewrites the gave-up notice to \"A former member gave up\"",
    after.length === 1 && /^A former member gave up \S+ \S+ \d+ on "Mow the yard"\./.test(after[0]) && !/Bea/.test(after[0]), JSON.stringify(after));
  await db.close();
}

if (failures()) { console.log(`\n${failures()} FAILED`); process.exit(1); }
console.log("\nALL CHECKS PASSED");
