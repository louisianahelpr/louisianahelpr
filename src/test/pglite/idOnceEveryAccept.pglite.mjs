#!/usr/bin/env node
/**
 * PGlite proof for 20261020043346_id_once_gates_every_accept (owner,
 * 2026-10-20: a Helpr's ID is "required but only once they are offered and
 * accept a job"; checked once by the ONE helper, helper_accept_block_reason).
 *
 *   node src/test/pglite/idOnceEveryAccept.pglite.mjs                       # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/idOnceEveryAccept.pglite.mjs    # RED: prod before it
 *
 * World: seriesWorld.mjs (the real jobs trigger chain), plus every function on
 * the paths at its newest CREATE before this migration, read from the tree
 * (md5(prosrc) of the five bodies this migration replaces measured equal to
 * prod 2026-10-20 ~04:40Z), and prod's trigger names/timing for
 * jobs_award_gate and the two profiles setup triggers. Stubbed, and said so:
 * is_series_party (true: party rules are not under test) and
 * direct_accept_block_reason (NULL: the offer's own refusals are not under
 * test; complete_direct_offer_accept is judged on the ID alone).
 *
 * Every Helpr below has payouts READY; only the ID differs:
 *   A = no ID (unverified), B = Stripe Identity verified, C = Connect verified.
 * [fix] checks FAIL on the before state; [keep] checks pass in both.
 */
import { PGlite, baseSchema, newestFunctionSql, readMigration, USERS, as as asRole, checker } from "./seriesWorld.mjs";

const THIS = "20261020043346_id_once_gates_every_accept.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const { check: checkNamed, failures } = checker();
const check = (ok, name) => checkNamed(name, ok);
const { P: POSTER, A: NOID, B: IDV, C: CONNECT, X: FIXTURE } = USERS;

const PATH = [
  "identity_is_verified", "helper_accept_missing", "helper_accept_block_reason", "helper_award_block_reason",
  "job_payment_is_funded", "series_visit_dates", "complete_job_accept", "complete_pending_accepts_on_setup",
  "enforce_helper_award_gate", "group_member_slot", "rpc_group_member_confirm",
  "complete_pending_crew_confirms_on_setup", "accept_job_offer", "claim_series_dates", "complete_direct_offer_accept",
];

const db = new PGlite();
await db.exec(baseSchema(THIS));
await db.exec(`
  alter table public.profiles add column stripe_account_id text, add column stripe_payouts_enabled boolean,
    add column is_seed boolean default false, add column idv_status text, add column stripe_identity_verified boolean;
  alter table public.jobs add column series_ended_on date;
  alter table public.applications add column updated_at timestamptz default now();
  alter table public.group_job_helpers add column slot_no int, add column share_cents int,
    add column helper_confirmed_at timestamptz;
  grant all on public.group_job_helpers to service_role;
  create table public.job_accept_pending (job_id uuid primary key references public.jobs(id) on delete cascade,
    helper_id uuid not null, requested_at timestamptz not null default now());
  create table public.crew_confirm_pending (slot_id uuid primary key references public.group_job_helpers(id) on delete cascade,
    job_id uuid not null, helper_id uuid not null, requested_at timestamptz not null default now());
  create table public.series_visit_holds (parent_job_id uuid, visit_date date, helper_id uuid,
    unique (parent_job_id, visit_date));
  create table public.series_date_offers (parent_job_id uuid, helper_id uuid);
  create table public.test_accounts (user_id uuid primary key, enrolled_at timestamptz not null default now(), note text);
  create function public.is_series_party(uuid) returns boolean language sql stable as $f$ select true $f$;
  create function public.direct_accept_block_reason(uuid, uuid) returns text language sql stable as $f$ select null::text $f$;
  ${PATH.map((n) => newestFunctionSql(n, THIS).sql).join("\n")}
  create trigger jobs_award_gate before insert or update on public.jobs
    for each row execute function public.enforce_helper_award_gate();
  create trigger trg_profiles_complete_pending_accepts after update of stripe_account_id, stripe_payouts_enabled,
    stripe_identity_verified, idv_status on public.profiles
    for each row execute function public.complete_pending_accepts_on_setup();
  -- prod's timing and column list (pg_get_triggerdef 2026-10-20)
  create trigger trg_profiles_complete_pending_crew_confirms after update of stripe_account_id, stripe_payouts_enabled
    on public.profiles for each row execute function public.complete_pending_crew_confirms_on_setup();
  update public.profiles set stripe_account_id = 'acct_' || left(user_id::text, 1), stripe_payouts_enabled = true;
  update public.profiles set idv_status = 'verified' where user_id = '${IDV}';
  update public.profiles set stripe_identity_verified = true where user_id = '${CONNECT}';
  -- FIXTURE: an is_seed profile (any fixture-shaped signup email sets it) with no Stripe account.
  update public.profiles set is_seed = true, stripe_account_id = null, stripe_payouts_enabled = null where user_id = '${FIXTURE}';
`);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(readMigration(THIS));

const q = async (sql) => (await db.query(sql)).rows;
const as = async (uid, sql) => {
  const r = await asRole(db, "authenticated", uid, sql);
  return r.ok ? { ok: true, rows: r.rows } : { ok: false, err: r.err };
};
const day = (n) => `((now() at time zone 'America/Chicago')::date + ${n})`;

// ---- the one helper itself (the rule every path below reads) ----------------
const verdicts = (await q(`select public.helper_accept_block_reason('${NOID}') a, public.helper_accept_block_reason('${IDV}') b,
  public.helper_accept_block_reason('${CONNECT}') c`))[0];
check(verdicts.a === "helper_identity_unverified" && verdicts.b === null && verdicts.c === null,
  `[keep] H1: the helper refuses no-ID, passes either verdict (${JSON.stringify(verdicts)})`);

// ---- the test-account carve-out (lh-authz-rls review #1) --------------------
const fx = (await q(`select public.helper_accept_block_reason('${FIXTURE}') r`))[0].r;
check(fx === "helper_payout_setup_incomplete",
  `[fix] H2: an is_seed profile NOT enrolled in test_accounts is judged like anyone (${JSON.stringify(fx)})`);
await q(`insert into public.test_accounts (user_id) values ('${FIXTURE}')`);
const fx2 = (await q(`select public.helper_accept_block_reason('${FIXTURE}') r`))[0].r;
check(fx2 === null, `[keep] H3: an enrolled test account keeps its fixture carve-out (${JSON.stringify(fx2)})`);

// ---- single job: accept_job_offer (the reference path, already gated) -------
const single = async (helper) => (await q(`insert into public.jobs (customer_id, title, status, helper_id, payment_status)
  values ('${POSTER}', 'Single', 'accepted', '${helper}', 'escrow') returning id`))[0].id;
for (const [who, uid, ok] of [["unverified", NOID, false], ["Identity-verified", IDV, true], ["Connect-verified", CONNECT, true]]) {
  const j = await single(uid);
  const r = await as(uid, `select public.accept_job_offer('${j}') r`);
  const row = (await q(`select helper_confirmed_at from public.jobs where id='${j}'`))[0];
  const booked = row.helper_confirmed_at !== null;
  check(r.ok && booked === ok && (ok || r.rows[0].r.state === "pending_setup"),
    `[keep] S1: accept_job_offer, ${who}: ${ok ? "booked" : "recorded, not booked"} (${JSON.stringify(r.rows?.[0] ?? r.err)})`);
}

// ---- crew: rpc_group_member_confirm + completion on setup -------------------
const crew = (await q(`insert into public.jobs (customer_id, title, status, payment_status, is_group_job, helpers_needed, date_needed, start_time)
  values ('${POSTER}', 'Crew', 'accepted', 'escrow', true, 3, ${day(3)}, '09:00') returning id`))[0].id;
// The poster's crew hire is an OFFER and stays ungated: the roster row lands for anyone.
await q(`insert into public.group_job_helpers (job_id, helper_id, slot_no, share_cents) values
  ('${crew}', '${NOID}', 0, 500), ('${crew}', '${IDV}', 1, 500), ('${crew}', '${CONNECT}', 2, 500)`);
const slot = async (uid) => (await q(`select helper_confirmed_at from public.group_job_helpers where job_id='${crew}' and helper_id='${uid}'`))[0];
const c1 = await as(NOID, `select public.rpc_group_member_confirm('${crew}') r`);
check(c1.ok && c1.rows[0].r.action === "pending_setup" && (await slot(NOID)).helper_confirmed_at === null,
  `[fix] C1: an unverified member's Accept My Spot does NOT book them (${JSON.stringify(c1.rows?.[0] ?? c1.err)})`);
check(c1.ok && JSON.stringify(c1.rows[0].r.missing) === JSON.stringify(["stripe_id"]),
  `[fix] C2: the answer names the ID as what is missing, the accept path's helper_accept_missing (${JSON.stringify(c1.rows?.[0]?.r?.missing)})`);
for (const [who, uid] of [["Identity-verified", IDV], ["Connect-verified", CONNECT]]) {
  const r = await as(uid, `select public.rpc_group_member_confirm('${crew}') r`);
  check(r.ok && typeof r.rows[0].r.helper_confirmed_at === "string" && (await slot(uid)).helper_confirmed_at !== null,
    `[keep] C3: a ${who} member is booked at once (${JSON.stringify(r.rows?.[0] ?? r.err)})`);
}
// Payout state changing alone completes nothing for the unverified member.
await q(`update public.profiles set stripe_payouts_enabled = true where user_id = '${NOID}'`);
check((await slot(NOID)).helper_confirmed_at === null,
  `[fix] C4: a payout-column write never completes an unverified member's recorded Confirm`);
// The ID landing completes it (the trigger fires on the identity columns now).
await q(`update public.profiles set idv_status = 'verified' where user_id = '${NOID}'`);
const left = (await q(`select count(*)::int n from public.crew_confirm_pending`))[0].n;
check((await slot(NOID)).helper_confirmed_at !== null && left === 0,
  `[fix] C5: the ID verified -> the recorded Confirm completes by itself, and the record clears (pending=${left})`);
await q(`update public.profiles set idv_status = null where user_id = '${NOID}'`);

// ---- series: claim_series_dates ---------------------------------------------
const dow = (await q(`select extract(dow from ${day(10)})::int d`))[0].d;
const series = (await q(`insert into public.jobs (customer_id, title, status, helper_id, recurring_helper_id, helper_confirmed_at,
    payment_status, date_needed, start_time, recurrence_days, recurrence_weeks)
  values ('${POSTER}', 'Series', 'accepted', '${IDV}', '${IDV}', now(), 'escrow', ${day(3)}, '09:00', array[${dow}]::smallint[], 6) returning id`))[0].id;
await q(`insert into public.series_date_offers values ('${series}', '${NOID}'), ('${series}', '${CONNECT}')`);
// A vacated visit (open, nobody on it, funded) on day+10: taking it books on the spot.
const visit = (await q(`insert into public.jobs (customer_id, title, status, payment_status, parent_job_id, date_needed, start_time)
  values ('${POSTER}', 'Series', 'open', 'escrow', '${series}', ${day(10)}, '09:00') returning id`))[0].id;
const v1 = await as(NOID, `select public.claim_series_dates('${series}', array[${day(10)}]) r`);
const vRow = async () => (await q(`select helper_id, helper_confirmed_at from public.jobs where id='${visit}'`))[0];
check(v1.ok && (await vRow()).helper_id === null,
  `[fix] V1: an unverified Helpr taking a vacated visit is not booked, and the claim answers instead of aborting (${JSON.stringify(v1.rows?.[0] ?? v1.err)})`);
check(v1.ok && JSON.stringify(v1.rows[0].r.needs_setup?.length) === "1" && JSON.stringify(v1.rows[0].r.missing) === JSON.stringify(["stripe_id"]),
  `[fix] V2: that date is answered needs_setup, naming the ID (${JSON.stringify(v1.rows?.[0]?.r)})`);
const v3 = await as(CONNECT, `select public.claim_series_dates('${series}', array[${day(10)}]) r`);
const vr = await vRow();
check(v3.ok && vr.helper_id === CONNECT && vr.helper_confirmed_at !== null,
  `[keep] V3: a Connect-verified Helpr takes the vacated visit and is booked (${JSON.stringify(v3.rows?.[0] ?? v3.err)})`);
// A future date with no visit row yet is accept-first: the hold records the yes, the answer names the ID.
const v4 = await as(NOID, `select public.claim_series_dates('${series}', array[${day(17)}]) r`);
const hold = (await q(`select helper_id from public.series_visit_holds where parent_job_id='${series}' and visit_date=${day(17)}`))[0];
check(v4.ok && hold?.helper_id === NOID,
  `[keep] V4: a future date stays accept-first: the unverified Helpr's hold is recorded (${JSON.stringify(v4.rows?.[0] ?? v4.err)})`);
check(v4.ok && JSON.stringify(v4.rows[0].r.missing) === JSON.stringify(["stripe_id"]),
  `[fix] V5: and the claim's answer names the ID, so the app asks for it (${JSON.stringify(v4.rows?.[0]?.r)})`);
const v6 = await as(IDV, `select public.claim_series_dates('${series}', array[${day(24)}]) r`);
check(v6.ok && JSON.stringify(v6.rows[0].r.missing ?? []) === "[]" && JSON.stringify(v6.rows[0].r.claimed?.length) === "1",
  `[keep] V6: a verified Helpr's claim names nothing missing (${JSON.stringify(v6.rows?.[0] ?? v6.err)})`);

// ---- direct offer completion (server context: postgres, no JWT) -------------
const direct = async (helper) => (await q(`insert into public.jobs (customer_id, title, status, payment_status, offered_to_helper_id, direct_offer_status)
  values ('${POSTER}', 'Direct', 'open', 'escrow', '${helper}', 'pending') returning id`))[0].id;
const d1 = await direct(NOID);
let r1;
try { r1 = (await q(`select public.complete_direct_offer_accept('${d1}', '${NOID}') r`))[0].r; } catch (e) { r1 = `threw: ${e.message}`; }
const d1row = (await q(`select helper_id, helper_confirmed_at from public.jobs where id='${d1}'`))[0];
check(r1 === null && d1row.helper_id === null,
  `[fix] D1: complete_direct_offer_accept itself refuses an unverified Helpr in server context (${JSON.stringify(r1)}, helper=${d1row.helper_id})`);
const d2 = await direct(IDV);
let r2;
try { r2 = (await q(`select public.complete_direct_offer_accept('${d2}', '${IDV}') r`))[0].r; } catch (e) { r2 = `threw: ${e.message}`; }
const d2row = (await q(`select helper_id, helper_confirmed_at from public.jobs where id='${d2}'`))[0];
check(r2?.action === "accepted" && d2row.helper_id === IDV && d2row.helper_confirmed_at !== null,
  `[keep] D2: a verified Helpr's direct offer completes (${JSON.stringify(r2)})`);

// ---- grants restated (REVOKE FROM PUBLIC, anon) ------------------------------
if (!SKIP) {
  const acl = await q(`select p.proname, coalesce(array_to_string(p.proacl, ','), '') acl from pg_proc p
    where p.proname in ('rpc_group_member_confirm','complete_pending_crew_confirms_on_setup','claim_series_dates','complete_direct_offer_accept','helper_accept_missing')`);
  const noAnon = acl.every((a) => !/(^|,)anon=/.test(a.acl) && !/(^|,)=X/.test(a.acl));
  const clientOk = acl.filter((a) => /authenticated=X/.test(a.acl)).map((a) => a.proname).sort().join(",") === "claim_series_dates,rpc_group_member_confirm";
  check(noAnon && clientOk, `[fix] G1: no anon/PUBLIC execute; only the two client RPCs are callable by authenticated (${JSON.stringify(acl)})`);
}

console.log(failures() ? `\n${failures()} FAILED${SKIP ? " (expected on the before state: the [fix] checks)" : ""}` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
