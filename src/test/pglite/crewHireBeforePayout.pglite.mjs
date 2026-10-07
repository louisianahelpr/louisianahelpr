#!/usr/bin/env node
/**
 * PGlite proof for 20261007011530_crew_hire_before_payout_setup (owner,
 * 2026-10-06: "you can offer job to anyone, they would set it up after
 * accepting. this is not an exception, it's the rule"; "should also be set this
 * way for recurring").
 *
 *   node src/test/pglite/crewHireBeforePayout.pglite.mjs            # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/crewHireBeforePayout.pglite.mjs   # RED: prod before it
 *
 * World: seriesWorld.mjs (the real jobs trigger chain), plus every function on
 * the path at its newest CREATE before this migration (read from the tree, not
 * retyped) and prod's trigger names/timing for jobs_award_gate,
 * group_job_helpers_award_gate and the two profiles setup triggers. Stubbed,
 * and said so: is_series_party (true: party rules are not under test),
 * direct_accept_block_reason / complete_direct_offer_accept (the direct-offer
 * branch of complete_pending_accepts_on_setup is not exercised).
 *
 * [fix] checks FAIL on the before state; [keep] checks pass in both.
 */
import { PGlite, baseSchema, newestFunctionSql, readMigration, USERS, as as asRole, checker } from "./seriesWorld.mjs";

const THIS = "20261007011530_crew_hire_before_payout_setup.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const { check: checkNamed, failures } = checker();
const check = (ok, name) => checkNamed(name, ok);
const { P: POSTER, A: UNREADY, B: READY, C: UNREADY2, X: UNREADY3 } = USERS; // UNREADY2/3: the recurring half's unready Helprs

const PATH = [
  "identity_is_verified", "helper_accept_missing", "helper_accept_block_reason", "helper_award_block_reason",
  "job_payment_is_funded", "series_visit_dates", "complete_job_accept", "complete_pending_accepts_on_setup",
  "enforce_helper_award_gate", "group_member_slot", "rpc_group_member_confirm", "enforce_group_roster_award_gate",
  "claim_series_dates", "series_release_dates", "job_offer_cutoff",
];

const db = new PGlite();
await db.exec(baseSchema(THIS));
await db.exec(`
  alter table public.profiles add column stripe_account_id text, add column stripe_payouts_enabled boolean,
    add column is_seed boolean default false, add column idv_status text, add column stripe_identity_verified boolean;
  alter table public.jobs add column series_ended_on date;
  alter table public.applications add column updated_at timestamptz default now(); -- prod has it (complete_job_accept writes it)
  alter table public.group_job_helpers add column slot_no int, add column share_cents int,
    add column helper_confirmed_at timestamptz;
  grant all on public.group_job_helpers to service_role;
  create table public.job_accept_pending (job_id uuid primary key references public.jobs(id) on delete cascade,
    helper_id uuid not null, requested_at timestamptz not null default now());
  create table public.series_visit_holds (parent_job_id uuid, visit_date date, helper_id uuid,
    unique (parent_job_id, visit_date));
  create table public.series_date_offers (parent_job_id uuid, helper_id uuid);
  create function public.is_series_party(uuid) returns boolean language sql stable as $f$ select true $f$;
  create function public.direct_accept_block_reason(uuid, uuid) returns text language sql stable as $f$ select 'stub'::text $f$;
  create function public.complete_direct_offer_accept(uuid, uuid) returns text language sql as $f$ select null::text $f$;
  ${PATH.map((n) => newestFunctionSql(n, THIS).sql).join("\n")}
  create trigger jobs_award_gate before insert or update on public.jobs
    for each row execute function public.enforce_helper_award_gate();
  create trigger group_job_helpers_award_gate before insert on public.group_job_helpers
    for each row execute function public.enforce_group_roster_award_gate();
  create trigger trg_profiles_complete_pending_accepts after update of stripe_account_id, stripe_payouts_enabled,
    stripe_identity_verified, idv_status on public.profiles
    for each row execute function public.complete_pending_accepts_on_setup();
  -- READY: payouts and Stripe ID done. UNREADY: nothing set up.
  update public.profiles set stripe_account_id = 'acct_ready', stripe_payouts_enabled = true, idv_status = 'verified'
   where user_id = '${READY}';
  update public.profiles set idv_status = 'verified' where user_id in ('${UNREADY}', '${UNREADY2}', '${UNREADY3}');
`);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(readMigration(THIS));

const q = async (sql) => (await db.query(sql)).rows;
const as = async (uid, sql) => {
  const r = await asRole(db, "authenticated", uid, sql);
  return r.ok ? { ok: true, rows: r.rows } : { ok: false, err: r.err };
};
const day = (await q(`select ((now() at time zone 'America/Chicago')::date + 3)::text d,
  extract(dow from (now() at time zone 'America/Chicago')::date + 3)::int dow`))[0];

// ---- crew ---------------------------------------------------------------
const crew = (await q(`insert into public.jobs (customer_id, title, status, payment_status, is_group_job, helpers_needed, date_needed, start_time)
  values ('${POSTER}', 'Crew', 'open', 'escrow', true, 2, '${day.d}', '09:00') returning id`))[0].id;
// accept_group_application's roster INSERT runs inside a SECURITY DEFINER RPC
// (table owner's privileges) under the poster's JWT: same here.
const definer = async (uid, sql) => {
  try {
    await db.exec(`set request.jwt.claim.sub = '${uid}'; set request.jwt.claim.role = 'authenticated';`);
    const out = await db.query(sql);
    return { ok: true, rows: out.rows };
  } catch (e) {
    return { ok: false, err: String(e.message).split("\n")[0] };
  } finally {
    await db.exec("reset request.jwt.claim.sub; reset request.jwt.claim.role;");
  }
};
const hireAs = (helper, slot) => definer(POSTER, `insert into public.group_job_helpers (job_id, helper_id, slot_no, share_cents)
  values ('${crew}', '${helper}', ${slot}, 500) returning id`);
const h1 = await hireAs(UNREADY, 1);
check(h1.ok, `[fix] C1: a crew hire of a Helpr with no payout account lands (${h1.ok ? "ok" : h1.err})`);
const h2 = await hireAs(READY, 2);
check(h2.ok, `[keep] C2: a crew hire of a ready Helpr lands (${h2.ok ? "ok" : h2.err})`);
const unfunded = (await q(`insert into public.jobs (customer_id, status, payment_status, is_group_job, helpers_needed)
  values ('${POSTER}', 'open', 'pending', true, 2) returning id`))[0].id;
const h3 = await definer(POSTER, `insert into public.group_job_helpers (job_id, helper_id, slot_no) values ('${unfunded}', '${READY}', 1)`);
check(!h3.ok && /not funded/.test(h3.err), `[keep] C3: a hire on an unfunded crew is still refused (${h3.err ?? "landed"})`);

if (h1.ok) {
  const c = await as(UNREADY, `select public.rpc_group_member_confirm('${crew}') r`);
  const slot = (await q(`select helper_confirmed_at from public.group_job_helpers where job_id='${crew}' and helper_id='${UNREADY}'`))[0];
  check(c.ok && c.rows[0].r.action === "pending_setup" && slot.helper_confirmed_at === null,
    `[fix] C4: the unready member's Confirm is recorded, not stamped (${JSON.stringify(c.rows?.[0] ?? c.err)})`);
  await q(`update public.profiles set stripe_account_id = 'acct_new' where user_id = '${UNREADY}'`);
  let s = (await q(`select helper_confirmed_at from public.group_job_helpers where job_id='${crew}' and helper_id='${UNREADY}'`))[0];
  check(s.helper_confirmed_at === null, `[fix] C5: an account with payouts not yet enabled completes nothing`);
  await q(`update public.profiles set stripe_payouts_enabled = true where user_id = '${UNREADY}'`);
  s = (await q(`select helper_confirmed_at from public.group_job_helpers where job_id='${crew}' and helper_id='${UNREADY}'`))[0];
  const left = (await q(`select count(*)::int n from public.crew_confirm_pending`))[0].n;
  const notes = (await q(`select user_id, title from public.notifications where job_id='${crew}' order by id`));
  check(s.helper_confirmed_at !== null && left === 0
    && notes.some((n) => n.user_id === UNREADY && n.title === "You're all set")
    && notes.some((n) => n.user_id === POSTER && /confirmed their spot/.test(n.title)),
    `[fix] C6: payouts ready -> the Confirm completes, the record clears, Helpr and poster are told (${JSON.stringify(notes)})`);
} else {
  check(false, "[fix] C4-C6: not reached (the hire was refused)");
}
const c7 = await as(READY, `select public.rpc_group_member_confirm('${crew}') r`);
check(c7.ok && typeof c7.rows[0].r.helper_confirmed_at === "string",
  `[keep] C7: a ready member's Confirm stamps at once (${JSON.stringify(c7.rows?.[0] ?? c7.err)})`);
const c8 = await as(UNREADY, `update public.group_job_helpers set helper_confirmed_at = now() where job_id = '${crew}'`);
check(!c8.ok || (await q(`select count(*)::int n from public.crew_confirm_pending`))[0].n === 0,
  `[keep] C8: the pending table is not a client door (${c8.ok ? "no rows" : c8.err})`);
if (!SKIP) {
  const t = await as(UNREADY, `select * from public.crew_confirm_pending`);
  check(!t.ok, `[fix] C9: clients cannot read crew_confirm_pending (${t.ok ? "readable" : t.err})`);
}

// ---- recurring: picking up a vacated, funded visit ----------------------
const parent = (await q(`insert into public.jobs (customer_id, helper_id, status, payment_status, date_needed, start_time,
  recurrence_days, recurrence_weeks, recurring_helper_id, helper_confirmed_at)
  values ('${POSTER}', '${READY}', 'accepted', 'escrow', '${day.d}', '09:00', array[${day.dow}]::smallint[], 4, '${READY}', now())
  returning id`))[0].id;
await db.exec(`set session_replication_role = replica`);
const visitFor = async (offset) => (await q(`insert into public.jobs (customer_id, parent_job_id, status, payment_status, date_needed, start_time)
  values ('${POSTER}', '${parent}', 'open', 'escrow', '${day.d}'::date + ${offset}, '09:00') returning id`))[0].id;
const v1 = await visitFor(7);
const v2 = await visitFor(14);
await db.exec(`set session_replication_role = origin`);
await q(`insert into public.series_date_offers values ('${parent}', '${UNREADY2}'), ('${parent}', '${READY}')`);
await q(`insert into public.recurring_visit_releases (parent_job_id, helper_id, visit_date) values ('${parent}', '${POSTER}', '${day.d}'::date + 7), ('${parent}', '${POSTER}', '${day.d}'::date + 14)`);
const visit = async (id) => (await q(`select status::text, helper_id, helper_confirmed_at is not null as confirmed from public.jobs where id='${id}'`))[0];

const v3 = await (async () => { await db.exec(`set session_replication_role = replica`); const id = await visitFor(21); await db.exec(`set session_replication_role = origin`); return id; })();
await q(`insert into public.series_date_offers values ('${parent}', '${UNREADY3}')`);
await q(`insert into public.recurring_visit_releases (parent_job_id, helper_id, visit_date) values ('${parent}', '${POSTER}', '${day.d}'::date + 21)`);
const r1 = await as(UNREADY2, `select public.claim_series_dates('${parent}', array['${day.d}'::date + 7]) r`);
let v = await visit(v1);
check(r1.ok && v.helper_id === UNREADY2 && v.status === "accepted" && v.confirmed === false
  && (r1.rows[0].r.pending_setup ?? []).length === 1,
  `[fix] R1: an unready Helpr picks up a vacated visit: theirs, unconfirmed, pending setup (${JSON.stringify(r1.rows?.[0] ?? r1.err)}; ${JSON.stringify(v)})`);
if (r1.ok) {
  await q(`update public.profiles set stripe_account_id = 'acct_new2', stripe_payouts_enabled = true where user_id = '${UNREADY2}'`);
  v = await visit(v1);
  const poster = await q(`select title from public.notifications where job_id='${v1}' and user_id='${POSTER}'`);
  const logs = await q(`select message, context->>'err' err from public.error_logs`);
  check(v.confirmed === true && poster.length === 1 && logs.length === 0,
    `[fix] R2: payouts ready -> the picked-up visit's accept completes and the poster is told (${JSON.stringify(v)}; ${JSON.stringify(poster)}; logs ${JSON.stringify(logs)})`);
} else {
  check(false, "[fix] R2: not reached (the claim was refused)");
}
const r3 = await as(READY, `select public.claim_series_dates('${parent}', array['${day.d}'::date + 14]) r`);
v = await visit(v2);
check(r3.ok && v.helper_id === READY && v.confirmed === true && (r3.rows[0].r.pending_setup ?? []).length === 0,
  `[keep] R3: a ready Helpr's pick-up books and confirms in one write (${JSON.stringify(r3.rows?.[0] ?? r3.err)}; ${JSON.stringify(v)})`);

// R4 (lh-money-escrow review, MEDIUM): an unconfirmed pick-up that is reopened
// (declined, expired, swept) gives the date back, so another Helpr can take it.
const r4 = await as(UNREADY3, `select public.claim_series_dates('${parent}', array['${day.d}'::date + 21]) r`);
const dl = (await q(`select response_deadline = public.job_offer_cutoff('${day.d}'::date + 21, time '09:00') as at_start from public.jobs where id='${v3}'`))[0];
check(r4.ok && (r4.rows[0].r.pending_setup ?? []).length === 1 && dl.at_start === true,
  `[fix] R4: the pending pick-up's answer-by time is the offer cutoff before the visit's start (${JSON.stringify(r4.rows?.[0] ?? r4.err)}; ${JSON.stringify(dl)})`);
await q(`update public.jobs set helper_id = null, status = 'open', response_deadline = null where id = '${v3}'`);
const hold = (await q(`select count(*)::int n from public.series_visit_holds where parent_job_id='${parent}' and visit_date='${day.d}'::date + 21`))[0].n;
const r5 = await as(READY, `select public.claim_series_dates('${parent}', array['${day.d}'::date + 21]) r`);
v = await visit(v3);
check(hold === 0 && r5.ok && (r5.rows[0].r.claimed ?? []).length === 1 && v.helper_id === READY && v.confirmed === true,
  `[fix] R5: reopened unconfirmed, the date is released and another Helpr takes it (hold ${hold}; ${JSON.stringify(r5.rows?.[0] ?? r5.err)}; ${JSON.stringify(v)})`);

console.log(failures() ? `\n${failures()} FAILED${SKIP ? " (expected on the before state: the [fix] checks)" : ""}` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
