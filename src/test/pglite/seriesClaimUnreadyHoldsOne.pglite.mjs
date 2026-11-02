#!/usr/bin/env node
/**
 * PGlite proof for 20261102230059_series_claim_unready_holds_one.sql (Q2247).
 *
 *   node src/test/pglite/seriesClaimUnreadyHoldsOne.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/seriesClaimUnreadyHoldsOne.pglite.mjs # RED: the live definition only
 *   PLANT=nocap node src/test/pglite/seriesClaimUnreadyHoldsOne.pglite.mjs        # planted: the cap never fires
 *   PLANT=nocount node src/test/pglite/seriesClaimUnreadyHoldsOne.pglite.mjs      # planted: holds from earlier calls not counted
 *
 * Owner 2026-10-21: a Helpr whose setup is unfinished holds only the next 1 series date. claim_series_dates walks
 * the asked dates earliest first; an unready claimer gets the first date it can hold and every later one is answered
 * needs_setup (with `missing`), a second call holds nothing more, a ready claimer still holds every date, and a date
 * the unready claimer did not get stays free for another offered Helpr.
 *
 * World: the real claim_series_dates (the newest definition, or the live one = 20261021061341's, md5(prosrc)
 * f519242aa17dd1b4e3b21d10361ddd5c on prod 2026-11-02) and the real series_visit_dates. Stubbed, and said so:
 * auth.uid() (the JWT claim), is_caller_banned (false), is_series_party (true), are_users_blocked (false),
 * member_display_name, and helper_accept_block_reason / helper_accept_missing, which read a `ready` column here so
 * each Helpr's readiness is set by the test (the real helpers read ID and payout state; not under test).
 * Only future dates with no visit row are asked, so no jobs trigger is involved.
 *
 * pglite is not a dependency (CLAUDE.md): PGLITE_DIR (default ~/.lh-pglite).
 */
import { PGlite, readMigration, newestFunctionSql, as, checker } from "./seriesWorld.mjs";

const NEW = "20261102230059_series_claim_unready_holds_one.sql";
const MODE = process.env.NEW_MIGRATION ?? "";
const PLANT = process.env.PLANT ?? "";
const LIVE = newestFunctionSql("claim_series_dates", NEW.slice(0, 14));
let FIX = readMigration(NEW);
if (PLANT === "nocap") FIX = FIX.replace("v_held_future + cardinality(v_claimed) >= 1 THEN", "false THEN");
if (PLANT === "nocount") FIX = FIX.replace("v_held_future + cardinality(v_claimed) >= 1 THEN", "cardinality(v_claimed) >= 1 THEN");
if (MODE) console.log(`NEW_MIGRATION=${MODE}: the live definition only (expect FAILs)`);
if (PLANT) console.log(`PLANT=${PLANT} (expect FAILs)`);
const { check, failures } = checker();

const P = "11111111-1111-1111-1111-111111111111"; // poster
const U = "22222222-2222-2222-2222-222222222222"; // offered, setup unfinished
const R = "33333333-3333-3333-3333-333333333333"; // offered, ready
const S = "c0000000-0000-0000-0000-000000002247";

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  insert into auth.users values ('${P}'), ('${U}'), ('${R}');
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth to authenticated, anon, service_role;
  grant usage on schema public to authenticated, anon, service_role;
  create type public.job_status as enum ('open','accepted','in_progress','completed','cancelled');
  create table public.jobs (id uuid primary key, title text, customer_id uuid, helper_id uuid, recurring_helper_id uuid,
    recurrence_days smallint[], recurrence_weeks smallint, parent_job_id uuid references public.jobs(id),
    date_needed date, start_time time, series_ended_on date, status public.job_status not null default 'open',
    helper_confirmed_at timestamptz);
  create table public.profiles (user_id uuid primary key, full_name text, ready boolean not null default true);
  insert into public.profiles (user_id, full_name, ready) values ('${P}', 'Pat Poster', true), ('${U}', 'Una Unready', false), ('${R}', 'Ray Ready', true);
  create table public.applications (job_id uuid, helper_id uuid, status text, message text, unique (job_id, helper_id));
  create table public.notifications (id serial primary key, user_id uuid not null, job_id uuid,
    title text not null, message text not null, type text, link text);
  create table public.series_visit_holds (parent_job_id uuid not null references public.jobs(id), visit_date date not null,
    helper_id uuid not null, id uuid not null default gen_random_uuid(), claimed_at timestamptz not null default now(),
    primary key (parent_job_id, visit_date));
  create table public.series_date_offers (parent_job_id uuid not null, helper_id uuid not null, unique (parent_job_id, helper_id));
  create table public.recurring_visit_releases (parent_job_id uuid not null, helper_id uuid not null, visit_date date not null,
    unique (parent_job_id, visit_date));
  create function public.is_caller_banned() returns boolean language sql stable as $f$ select false $f$;
  create function public.is_series_party(uuid) returns boolean language sql stable as $f$ select true $f$;
  create function public.are_users_blocked(uuid, uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.member_display_name(text, text) returns text language sql immutable as $f$ select coalesce($1, $2) $f$;
  create function public.helper_accept_block_reason(uuid) returns text language sql stable as
    $f$ select case when p.ready then null else 'payout_setup' end from public.profiles p where p.user_id = $1 $f$;
  create function public.helper_accept_missing(uuid) returns text[] language sql stable as
    $f$ select case when p.ready then array[]::text[] else array['payout_setup'] end from public.profiles p where p.user_id = $1 $f$;
  ${newestFunctionSql("series_visit_dates").sql}
  ${LIVE.sql}
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(FIX);
check("the migration applies 3x (replay-safe)", true);

// A daily series (every weekday 0-6) that started 3 days ago, offered to U and R. Dates 7+ days out are fundable
// and have no visit row, so each is a hold.
const day = (n) => `((now() AT TIME ZONE 'America/Chicago')::date + ${n})`;
await db.exec(`
  insert into public.jobs (id, title, customer_id, recurrence_days, recurrence_weeks, date_needed, status)
  values ('${S}', 'Walk the dog', '${P}', array[0,1,2,3,4,5,6]::smallint[], 4, ${day(-3)}, 'accepted');
  insert into public.series_date_offers values ('${S}', '${U}'), ('${S}', '${R}');`);

const claim = async (who, days) => {
  const r = await as(db, "authenticated", who,
    `select public.claim_series_dates('${S}', array[${days.map(day).join(", ")}]::date[]) as v`);
  if (!r.ok) return { err: r.err };
  return r.rows[0].v;
};
const held = async (who) => Number((await db.query(
  `select count(*)::int as n from public.series_visit_holds where parent_job_id = '${S}' and helper_id = '${who}'`)).rows[0].n);
const iso = async (n) => (await db.query(`select ${day(n)}::text as d`)).rows[0].d;

// Asked latest first: the date held is still the earliest one.
let r = await claim(U, [10, 8, 9]);
check("an unready Helpr's call answers (no error)", !r.err, r.err);
check("an unready Helpr holds exactly 1 of 3 dates", r.claimed?.length === 1 && (await held(U)) === 1, JSON.stringify(r));
check("the date held is the earliest one asked", r.claimed?.[0] === (await iso(8)), JSON.stringify(r.claimed));
check("the other 2 are answered needs_setup, naming what is missing",
  r.needs_setup?.length === 2 && JSON.stringify(r.missing) === '["payout_setup"]', JSON.stringify(r));

r = await claim(U, [11]);
check("a second call by the same unready Helpr holds nothing more", r.claimed?.length === 0 && r.needs_setup?.length === 1 && (await held(U)) === 1, JSON.stringify(r));

r = await claim(U, [8]);
check("asking again for the date already held is already_yours, not needs_setup", r.already_yours?.length === 1 && r.needs_setup?.length === 0, JSON.stringify(r));

r = await claim(R, [8, 9, 10, 11]);
check("the dates the unready Helpr did not get stay free: a ready Helpr takes 9, 10, 11", r.claimed?.length === 3 && r.taken?.length === 1, JSON.stringify(r));
check("a ready Helpr is not capped (3 holds)", (await held(R)) === 3);

await db.exec(`update public.profiles set ready = true where user_id = '${U}'`);
r = await claim(U, [12, 13]);
check("once setup is finished, the same Helpr holds every date again", r.claimed?.length === 2 && (await held(U)) === 3, JSON.stringify(r));

await db.close();
if (failures()) { console.log(`\n${failures()} FAILED`); process.exit(1); }
console.log("\nALL CHECKS PASSED");
