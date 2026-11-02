#!/usr/bin/env node
/**
 * PGlite proof for 20261102102402_poster_continue_day_goes_to_the_helpr (Jobs audit 1102b row 20, Q2606).
 *
 *   node src/test/pglite/posterContinueDayAsksTheHelpr.pglite.mjs              # the migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/posterContinueDayAsksTheHelpr.pglite.mjs   # RED: the chain before it
 *   PLANT=<name> node src/test/pglite/posterContinueDayAsksTheHelpr.pglite.mjs # a planted defect (expect FAILs):
 *     poster_sets      the poster's pick is set at once again
 *     poster_answers   the poster may answer (confirm) their own pick
 *     helpr_own        the Helpr may answer their own pick
 *
 * World: jobContinueDay.pglite.mjs's (seriesWorld.mjs + the continue-day migration 20261101231015, the real
 * completion triggers), then this migration. Stubbed as there: auth.uid()/auth.role(), has_role, are_users_blocked.
 */
import { PGlite, readMigration, baseSchema, newestFunctionSql, as, checker, refused, USERS } from "./seriesWorld.mjs";

const CHAIN_FILE = "20261101231015_job_continue_another_day.sql";
const FIX_FILE = "20261102102402_poster_continue_day_goes_to_the_helpr.sql";
const BEFORE = CHAIN_FILE.slice(0, 14);
const MODE = process.env.NEW_MIGRATION ?? "";
const PLANT = process.env.PLANT ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: the chain before the fix (expect FAILs)`);
if (PLANT) console.log(`PLANT=${PLANT}: a planted defect (expect FAILs)`);
const { P, A, X } = USERS; // P posts, A is the hired Helpr, X a stranger
const { check, failures } = checker();
const J = (n) => `e0000000-0000-0000-0000-0000000002${String(n).padStart(2, "0")}`;
const fn = (n) => newestFunctionSql(n, BEFORE).sql;

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
// is_caller_banned, as of this migration, also reads the under-13 lock (prod column).
await db.exec(baseSchema(BEFORE).replace("auto_suspended_until timestamptz);", "auto_suspended_until timestamptz, under_13_blocked_at timestamptz);"));
await db.exec(`
  alter table public.jobs
    add column if not exists poster_completed_at timestamptz, add column if not exists payout_scheduled_at timestamptz,
    add column if not exists poster_confirmed_arrival_at timestamptz, add column if not exists helper_arrival_verified_at timestamptz,
    add column if not exists helper_arrived_at timestamptz, add column if not exists poster_confirmed_working_at timestamptz,
    add column if not exists proof_before_urls text[], add column if not exists proof_after_urls text[];
  create function public.sell_for_me_listings_sent(uuid) returns boolean language sql stable as $f$ select true $f$;
  -- Stub of member_display_name (20261021131322 shape: "First L."); the notices take its first word.
  create or replace function public.member_display_name(p_full_name text, p_fallback text) returns text language sql immutable as
    $f$ select coalesce(nullif(split_part(btrim(p_full_name), ' ', 1), '') || coalesce(' ' || left(nullif(split_part(btrim(p_full_name), ' ', 2), ''), 1) || '.', ''), p_fallback) $f$;
  update public.profiles set full_name = 'Dana Poster' where user_id = '${P}';
  update public.profiles set full_name = 'Yusef Helpr' where user_id = '${A}';
`);
for (const n of ["enforce_job_completion_server_owned", "enforce_helper_completion_gates", "enforce_completion_on_live_job", "rpc_helper_mark_done"]) {
  await db.exec(fn(n));
}
await db.exec(`
  create trigger trg_helper_completion_gates before update of helper_completed_at, status on public.jobs
    for each row execute function public.enforce_helper_completion_gates();
  create trigger zz_jobs_completion_server_owned before insert or update of status, helper_completed_at on public.jobs
    for each row execute function public.enforce_job_completion_server_owned();
  create trigger trg_completion_on_live_job before update of helper_completed_at on public.jobs
    for each row execute function public.enforce_completion_on_live_job();
`);
// The continue-day feature as it shipped (20261101231015), then this fix.
await db.exec(readMigration(CHAIN_FILE));
let mig = readMigration(FIX_FILE);
const plant = (from, to) => {
  if (!mig.includes(from)) throw new Error(`plant ${PLANT}: anchor not found`);
  mig = mig.replace(from, to);
};
if (PLANT === "poster_sets") plant("  v_status := 'proposed';", "  v_status := CASE WHEN v_poster THEN 'set' ELSE 'proposed' END;");
if (PLANT === "poster_answers") plant("  IF v_answerer IS NULL OR v_uid IS DISTINCT FROM v_answerer THEN", "  IF v_uid IS DISTINCT FROM v_job.customer_id AND v_uid IS DISTINCT FROM v_answerer THEN");
if (PLANT === "helpr_own") plant("  IF v_answerer IS NULL OR v_uid IS DISTINCT FROM v_answerer THEN", "  IF v_uid IS DISTINCT FROM v_job.helper_id AND v_uid IS DISTINCT FROM v_answerer THEN");
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied 3x

// Jobs, all $40, Helpr A hired, money held, under way since yesterday:
//  1 A marked done 5 h ago (Yusef's case)   2 not marked done   3 not marked done   4 not marked done
await db.exec(`
  insert into public.jobs (id, title, budget, customer_id, helper_id, status, payment_status, date_needed, start_time,
                           helper_confirmed_at, poster_confirmed_arrival_at, helper_arrived_at, proof_before_urls, proof_after_urls,
                           helper_completed_at, require_photo_proof)
  values ('${J(1)}', 'Clean out the garage', 40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 1, '10:00',
          now() - interval '3 days', now() - interval '30 hours', now() - interval '30 hours', '{b.jpg}', '{a.jpg}', now() - interval '5 hours', true),
         ('${J(2)}', 'Paint the fence', 40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 1, '10:00',
          now() - interval '3 days', now() - interval '30 hours', now() - interval '30 hours', '{b.jpg}', '{a.jpg}', null, true),
         ('${J(3)}', 'Move a couch', 40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 1, '10:00',
          now() - interval '3 days', now() - interval '30 hours', now() - interval '30 hours', '{b.jpg}', '{a.jpg}', null, true);
`);
const DAY = (await q(`select ((now() at time zone 'America/Chicago')::date + 3)::text as d`))[0].d;
const call = (uid, sql) => as(db, "authenticated", uid, sql);
const propose = (uid, job, time = "09:00") =>
  call(uid, `select public.propose_job_continue_day('${job}', '${DAY}'::date, '${time}'::time, null) as r`);
const answer = (uid, id, accept) => call(uid, `select public.answer_job_continue_day('${id}', ${accept}) as r`);
const active = async (job) => (await q(`select * from public.job_continue_days where job_id = $1 and status in ('proposed','set')`, [job]))[0] ?? null;
const jobRow = async (job) => (await q(`select * from public.jobs where id = $1`, [job]))[0];
const notes = async (uid, job) => (await q(`select title, message, link from public.notifications where user_id = $1 and job_id = $2 order by id`, [uid, job]));

// 1. The poster picks a day on Yusef's job: it is a proposal, his done stays until he agrees.
const p1 = await propose(P, J(1));
check("RED the poster's day is a proposal, not set at once", p1.ok && p1.rows[0]?.r?.status === "proposed", p1.err ?? JSON.stringify(p1.rows?.[0]));
check("RED ...the Helpr's earlier done is NOT cleared by a proposal", !!(await jobRow(J(1))).helper_completed_at);
const yNotes = await notes(A, J(1));
check("RED ...Yusef is asked to accept or decline, in server-built words",
  yNotes.some((n) => n.title === "New day to finish" && /^Dana asked to finish "Clean out the garage" on \w{3} \d+\/\d+ at 9 AM\. Next: accept or decline the new day\.$/.test(n.message) && n.link === `/jobs?job=${J(1)}`),
  JSON.stringify(yNotes.map((n) => n.message)));
const row1 = await active(J(1));
const own = await answer(P, row1?.id, true);
check("RED the poster cannot accept their own day", refused(own, /not_authorized/), own.err ?? "ran");
const stranger = await answer(X, row1?.id, true);
check("a stranger cannot answer it", refused(stranger, /not_authorized/), stranger.err ?? "ran");
const acc = await answer(A, row1?.id, true);
check("RED the Helpr accepts the poster's day", acc.ok && acc.rows[0]?.r?.status === "set", acc.err);
check("...it is set, and the earlier done is cleared then (the approval clock stops)",
  (await active(J(1)))?.status === "set" && (await jobRow(J(1))).helper_completed_at === null && !!(await active(J(1)))?.cleared_done_at);
const dNotes = await notes(P, J(1));
check("RED ...the poster is told Yusef accepted, linked to their post",
  dNotes.some((n) => n.title === "New day accepted" && /^Yusef accepted \w{3} \d+\/\d+ at 9 AM to finish "Clean out the garage"\.$/.test(n.message) && n.link === `/posts?job=${J(1)}`),
  JSON.stringify(dNotes.map((n) => n.message)));
const again = await answer(A, row1?.id, true);
check("a second tap changes nothing (replay)", again.ok && again.rows[0]?.r?.changed === false, again.err);

// 2. The Helpr declines a poster's day: closed, the poster told.
await propose(P, J(2), "13:30");
const row2 = await active(J(2));
const dec = await answer(A, row2?.id, false);
check("RED the Helpr declines the poster's day", dec.ok && dec.rows[0]?.r?.status === "declined" && (await active(J(2))) === null, dec.err);
check("RED ...the poster is told Yusef can't make it",
  (await notes(P, J(2))).some((n) => n.title === "New day declined" && /^Yusef can't make \w{3} \d+\/\d+ at 1:30 PM for "Paint the fence"\. Message them to agree on what's next\.$/.test(n.message)));

// 3. The Helpr's own pick is unchanged: the poster confirms it; the Helpr cannot.
const p3 = await propose(A, J(3), "15:00");
check("the Helpr's day is still a proposal", p3.ok && p3.rows[0]?.r?.status === "proposed", p3.err);
const row3 = await active(J(3));
const helprOwn = await answer(A, row3?.id, true);
check("the Helpr cannot accept their own day", refused(helprOwn, /not_authorized/), helprOwn.err ?? "ran");
const posterOk = await answer(P, row3?.id, true);
check("the poster confirms the Helpr's day", posterOk.ok && posterOk.rows[0]?.r?.status === "set", posterOk.err);
check("...and Yusef is told, as before", (await notes(A, J(3))).some((n) => n.title === "Another day confirmed"));

// 4. A row whose proposer is gone (proposed_by NULL): the poster answers, as before.
await db.exec(`update public.job_continue_days set status = 'replaced' where job_id = '${J(2)}' and status in ('proposed','set')`);
await db.exec(`insert into public.job_continue_days (job_id, proposed_by, new_date, new_start_time, status) values ('${J(2)}', null, '${DAY}', '16:00', 'proposed')`);
const orphan = await active(J(2));
const orphanHelpr = await answer(A, orphan?.id, true);
check("a proposer-less row: the Helpr cannot answer it", refused(orphanHelpr, /not_authorized/), orphanHelpr.err ?? "ran");
const orphanPoster = await answer(P, orphan?.id, true);
check("...the poster can", orphanPoster.ok && orphanPoster.rows[0]?.r?.status === "set", orphanPoster.err);

// 5. Grants: anon refused, as before.
const anon = await as(db, "anon", null, `select public.answer_job_continue_day('${row1?.id}', true)`);
check("anon cannot answer at all", refused(anon, /permission denied|not_authenticated/), anon.err ?? "ran");

console.log(failures() ? `\n${failures()} FAILED` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
