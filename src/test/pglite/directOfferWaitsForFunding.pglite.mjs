#!/usr/bin/env node
/**
 * PGlite proof for 20261018024631_direct_offer_waits_for_funding (owner,
 * 2026-10-17: "The job shouldn't post until the money is paid").
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/directOfferWaitsForFunding.pglite.mjs
 *   NEW_MIGRATION=skip ... runs the same checks on the pre-fix functions (RED).
 *
 * The functions under test are read from the migrations, never retyped: the
 * pre-fix world loads the newest definitions BEFORE the fix (and the live
 * trigger, AFTER INSERT OR UPDATE OF offered_to_helper_id); the fix then runs
 * verbatim on top, 3x for replay safety. Stubbed, and said so:
 * user_may_see_job_address (false), mask_job_location (city only) and
 * helper_accept_block_reason (NULL); job_payment_is_funded and
 * job_offer_cutoff are the real ones.
 */
import { PGlite, readMigration, newestFunctionSql, as, checker, USERS } from "./seriesWorld.mjs";

const FIX_FILE = "20261018024631_direct_offer_waits_for_funding.sql";
const FIX_VERSION = FIX_FILE.slice(0, 14);
const SKIP = process.env.NEW_MIGRATION === "skip";
const { P, A, B } = USERS;
const { check, failures } = checker();

const pre = ["job_payment_is_funded", "job_offer_cutoff", "notify_helper_on_direct_offer", "get_my_pending_direct_offers", "expire_pending_direct_offers", "enforce_hire_columns_rpc_only"]
  .map((n) => newestFunctionSql(n, FIX_VERSION).sql).join("\n");

const WORLD = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to authenticated, anon, service_role;
  create type public.job_status as enum ('open','accepted','in_progress','completed','cancelled','revision_requested','disputed','pending_approval');
  create table public.profiles (user_id uuid primary key, full_name text);
  insert into public.profiles values ('${P}', 'Sam Smith'), ('${A}', 'Lexi Lombas'), ('${B}', 'Bo');
  create table public.notifications (id serial primary key, user_id uuid, title text, message text, type text, link text, job_id uuid);
  create table public.jobs (id uuid primary key default gen_random_uuid(), title text, budget numeric default 80,
    customer_id uuid, helper_id uuid, status public.job_status not null default 'open', location text default '1 Main St, Lafayette, LA',
    latitude numeric default 30.1234, longitude numeric default -92.1234, payment_status text default 'unpaid',
    offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz,
    response_deadline timestamptz, recurring_helper_id uuid, date_needed date, start_time time, created_at timestamptz not null default now());
  create table public.job_accept_pending (job_id uuid, helper_id uuid);
  create function public.user_may_see_job_address(uuid, uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.mask_job_location(text) returns text language sql immutable as $f$ select 'Lafayette, LA' $f$;
  create function public.helper_accept_block_reason(uuid) returns text language sql stable as $f$ select null::text $f$;
  grant select on public.jobs to authenticated; grant all on public.jobs, public.notifications to service_role;
  grant usage on sequence public.notifications_id_seq to service_role;
  ${pre}
  create trigger trg_hire_columns_rpc_only before update on public.jobs for each row execute function public.enforce_hire_columns_rpc_only();
  create trigger trg_notify_helper_on_direct_offer after insert or update of offered_to_helper_id on public.jobs
    for each row execute function public.notify_helper_on_direct_offer();
  grant execute on function public.get_my_pending_direct_offers() to authenticated;
`;

const db = new PGlite();
await db.exec(WORLD);
if (!SKIP) {
  for (let i = 0; i < 3; i++) await db.exec(readMigration(FIX_FILE));
  check("the fix applies 3x (replay-safe)", true);
} else {
  console.log("-- NEW_MIGRATION=skip: checking the PRE-FIX functions (expect FAIL lines)");
}

const q = async (sql) => (await db.query(sql)).rows;
const offerNotices = async (j) => (await q(`select user_id from public.notifications where job_id = '${j}' and title = 'You got a direct job offer!'`));
const newOffer = async (ps, windowMin = 120, ageMin = 0) => (await q(`
  insert into public.jobs (title, customer_id, payment_status, offered_to_helper_id, direct_offer_status, direct_offer_expires_at, created_at)
  values ('Mow & weed eat', '${P}', '${ps}', '${A}', 'pending', now() - interval '${ageMin} minutes' + interval '${windowMin} minutes', now() - interval '${ageMin} minutes')
  returning id`))[0].id;
const fund = async (j, to = "escrow") => as(db, "service_role", null, `update public.jobs set payment_status = '${to}' where id = '${j}'`);
const myOffers = async (uid) => (await as(db, "authenticated", uid, `select id from public.get_my_pending_direct_offers()`)).rows.map((r) => r.id);

// 1. A bank checkout completed, the money has not arrived: payment_status 'unpaid'.
const j1 = await newOffer("unpaid", 120, 0);
check("(1) an UNPAID direct offer tells the offered Helpr nothing at insert", (await offerNotices(j1)).length === 0, `${(await offerNotices(j1)).length} notices`);
check("(2) get_my_pending_direct_offers does not list an UNPAID offer", !(await myOffers(A)).includes(j1));

// 3. Its 2-hour window ran out while the bank settled: the sweep leaves it alone.
const j2 = await newOffer("unpaid", 120, 180);
const swept = (await as(db, "service_role", null, `select public.expire_pending_direct_offers() as n`)).rows[0].n;
const j2row = (await q(`select direct_offer_status from public.jobs where id = '${j2}'`))[0];
const posterTold = (await q(`select count(*)::int as n from public.notifications where user_id = '${P}' and title = 'Direct offer expired'`))[0].n;
check("(3) the expiry sweep does not lapse an UNPAID offer", j2row.direct_offer_status === "pending", `status ${j2row.direct_offer_status}, swept ${swept}`);
check("(3) nor tell the poster an unpaid job 'is now open to everyone'", posterTold === 0, `${posterTold} notices`);

// 4. The money arrives (paymentIntentSucceeded, service_role): the notice goes out now, once.
const f1 = await fund(j1);
check("funding by the server is not refused", f1.ok, f1.err);
check("(1) the notice fires when the job is funded", (await offerNotices(j1)).length === 1, `${(await offerNotices(j1)).length} notices`);
check("(1) ...to the offered Helpr", (await offerNotices(j1))[0]?.user_id === A);
await fund(j1, "payout_pending");
await as(db, "service_role", null, `update public.jobs set payment_status = 'payout_pending' where id = '${j1}'`);
check("(1) exactly once: a later funded-to-funded update sends no second notice", (await offerNotices(j1)).length === 1, `${(await offerNotices(j1)).length} notices`);
check("(2) the funded offer is listed for the offered Helpr", (await myOffers(A)).includes(j1));
check("(2) and not for anyone else", !(await myOffers(B)).includes(j1));

// 5. The late-funded offer's window restarts at funding (poster picked 2 h).
const f2 = await fund(j2);
const left = (await q(`select extract(epoch from direct_offer_expires_at - now())/60 as m from public.jobs where id = '${j2}'`))[0].m;
check("(4) a late-funded offer gets the poster's whole window from funding", Number(left) > 115 && Number(left) <= 121, `${Number(left).toFixed(1)} min left; fund ok=${f2.ok}`);
check("(1) and its Helpr is told at funding", (await offerNotices(j2)).length === 1);
const swept2 = (await as(db, "service_role", null, `select public.expire_pending_direct_offers() as n`)).rows[0].n;
check("(4) the sweep right after funding does not lapse it", Number(swept2) === 0, `swept ${swept2}`);

// 6. A window shorter than the floor is floored at 55 minutes.
const j3 = await newOffer("unpaid", 10, 0);
await fund(j3);
const left3 = (await q(`select extract(epoch from direct_offer_expires_at - now())/60 as m from public.jobs where id = '${j3}'`))[0].m;
check("(4) the restarted window is floored at 55 minutes", Number(left3) > 54 && Number(left3) <= 56, `${Number(left3).toFixed(1)} min`);

// 7. Funded at insert (a gift that covers it all): notified at insert, once.
const j4 = await newOffer("escrow", 120, 0);
check("(1) an offer funded at insert notifies at insert", (await offerNotices(j4)).length === 1);
await fund(j4, "payout_pending");
check("(1) ...and never again", (await offerNotices(j4)).length === 1);

// 8. A funded offer whose window ran out still lapses, and the poster is told.
const j5 = await newOffer("escrow", 60, 120);
const swept3 = (await as(db, "service_role", null, `select public.expire_pending_direct_offers() as n`)).rows[0].n;
const j5row = (await q(`select direct_offer_status from public.jobs where id = '${j5}'`))[0];
check("a FUNDED offer past its window still expires", j5row.direct_offer_status === "expired", `status ${j5row.direct_offer_status}, swept ${swept3}`);

// 9. A plain (non-offer) job funding notifies no one from this trigger.
const j6 = (await q(`insert into public.jobs (title, customer_id) values ('Plain', '${P}') returning id`))[0].id;
await fund(j6);
check("a job with no offer sends no direct-offer notice when funded", (await offerNotices(j6)).length === 0);

// 10. A client cannot move the window itself (the lock still holds for authenticated).
await db.exec(`grant update on public.jobs to authenticated`);
const cl = await as(db, "authenticated", P, `update public.jobs set direct_offer_expires_at = now() + interval '9 days' where id = '${j1}'`);
check("a client's write of direct_offer_expires_at is still refused", !cl.ok && /hire_requires_rpc/.test(cl.err), cl.err);

// 11. Review #2: a cancel claim put back (cancel_escrow putCancelClaimBack:
//     escrow -> cancelling -> escrow) is the same money. No second notice, and
//     the window already running is not pushed out again.
const j7 = await newOffer("unpaid", 120, 0);
await fund(j7);
await as(db, "service_role", null, `update public.jobs set direct_offer_expires_at = now() + interval '7 minutes' where id = '${j7}'`);
const before7 = (await q(`select direct_offer_expires_at::text as t from public.jobs where id = '${j7}'`))[0].t;
await fund(j7, "cancelling");
await fund(j7, "escrow");
const after7 = (await q(`select direct_offer_expires_at::text as t from public.jobs where id = '${j7}'`))[0].t;
check("(review #2) escrow -> cancelling -> escrow sends no second notice", (await offerNotices(j7)).length === 1, `${(await offerNotices(j7)).length} notices`);
check("(review #2) ...and does not restart the offer's window", before7 === after7, `${before7} -> ${after7}`);

// 12. A bounced bank payment retried by card (failed -> escrow) is the first
//     arrival of money: notified once.
const j8 = await newOffer("failed", 120, 0);
await fund(j8);
check("(review #2) failed -> escrow is the money arriving: one notice", (await offerNotices(j8)).length === 1, `${(await offerNotices(j8)).length} notices`);

// 13. Review #3: money that lands after the job's start cutoff tells no one,
//     and the restarted window never runs past the cutoff.
const j9 = (await q(`insert into public.jobs (title, customer_id, payment_status, offered_to_helper_id, direct_offer_status, direct_offer_expires_at, date_needed)
  values ('Late', '${P}', 'unpaid', '${A}', 'pending', now() + interval '2 hours', (now() at time zone 'America/Chicago')::date - 2) returning id`))[0].id;
await fund(j9);
check("(review #3) money arriving after the start cutoff sends no offer notice", (await offerNotices(j9)).length === 0, `${(await offerNotices(j9)).length} notices`);
await as(db, "service_role", null, `select public.expire_pending_direct_offers()`);
const j9row = (await q(`select direct_offer_status from public.jobs where id = '${j9}'`))[0];
const j9told = (await q(`select count(*)::int as n from public.notifications where link = '/posts?job=${j9}'`))[0].n;
check("(delta #3) the late-funded offer lapses at the sweep...", j9row.direct_offer_status === "expired", j9row.direct_offer_status);
check("(delta #3) ...without telling the poster it is 'now open to everyone'", j9told === 0, `${j9told} notices`);
const j10 = (await q(`insert into public.jobs (title, customer_id, payment_status, offered_to_helper_id, direct_offer_status, direct_offer_expires_at, date_needed, start_time)
  values ('Soon', '${P}', 'unpaid', '${A}', 'pending', now() + interval '2 hours',
    ((now() + interval '30 minutes') at time zone 'America/Chicago')::date,
    ((now() + interval '30 minutes') at time zone 'America/Chicago')::time) returning id`))[0].id;
await fund(j10);
const left10 = (await q(`select extract(epoch from direct_offer_expires_at - now())/60 as m from public.jobs where id = '${j10}'`))[0].m;
check("(review #3) a job starting in 30 min is told at funding", (await offerNotices(j10)).length === 1);
check("(review #3) ...and its window ends at the start cutoff, not 2 h out", Number(left10) > 28 && Number(left10) <= 31, `${Number(left10).toFixed(1)} min`);

// 14. Review #4: a job that is not open (cancelled) tells no one when money lands.
const j11 = (await q(`insert into public.jobs (title, customer_id, status, payment_status, offered_to_helper_id, direct_offer_status, direct_offer_expires_at)
  values ('Gone', '${P}', 'cancelled', 'unpaid', '${A}', 'pending', now() + interval '2 hours') returning id`))[0].id;
await fund(j11);
check("(review #4) a cancelled job's offer is never announced", (await offerNotices(j11)).length === 0, `${(await offerNotices(j11)).length} notices`);

await db.close();
console.log(failures() === 0 ? "ALL PASS" : `${failures()} FAIL`);
process.exit(failures() === 0 ? 0 : 1);
