#!/usr/bin/env node
/**
 * PGlite proof for 20261027200455_helpr_guarantee (owner 2026-10-27, "Redo first, then refund").
 *
 *   node src/test/pglite/helprGuarantee.pglite.mjs                     # the migration applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/helprGuarantee.pglite.mjs  # RED: the chain on main
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/helprGuarantee.pglite.mjs
 *
 * World: seriesWorld.mjs (the real jobs column locks and ban gate) plus the refund-request proof's dispute world,
 * with the NEWEST definitions of open_dispute_as, check_dispute_velocity, enforce_job_status_transition,
 * enforce_dispute_markers_server_owned, enforce_job_completion_server_owned, enforce_dispute_opener_column_whitelist,
 * dispute_evidence_url_ok, job_legacy_completed_at, refuse_payout_claim_while_held and job_messaging_closes_at read
 * from the migrations. Section 0 checks each against PROD's body (md5 of pg_proc.prosrc, read-only
 * `supabase db query --linked` on fncmgoasalhdgfwzhsqa, 2026-10-27). Stubbed, and said so: has_role (no admins),
 * are_users_blocked (seriesWorld), payout_waits_on_identity (false: identity_check is off), notify_ops_dispute_filed
 * (Slack is not under test), log_cron_defect (records), the payout_transfers table (prod's columns that the hold
 * trigger reads).
 *
 * Covers: the hold (no payout claim while a claim is open, including 'escalating'); the payout claims once closed;
 * who may do what; the 48 h window, already-paid, crew, open dispute, note and photo rules; one claim per job; the
 * fix date (today..+3, Louisiana time); Helpr can't fix / no answer / fix not done / poster still not right each
 * become ONE platform dispute through open_dispute_as, filed by the sweep in server context (a second sweep files
 * nothing more); poster silence closes and pays; a job that moved on closes the claim; the chat stays open while a
 * claim is open; RLS; ACLs.
 */
import { readFileSync } from "node:fs";
import { PGlite, baseSchema, newestFunctionSql, as, checker, USERS } from "./seriesWorld.mjs";

const NEW_FILE = "20261027200455_helpr_guarantee.sql";
const BEFORE = NEW_FILE.slice(0, 14);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running the chain on main (expect FAILs)`);
const { P, A, B, X } = USERS; // P posts, A is the hired Helpr, B a crew Helpr, X a stranger
const { check, failures } = checker();
const J = (n) => `e0000000-0000-0000-0000-0000000001${String(n).padStart(2, "0")}`;
const fn = (n) => newestFunctionSql(n, BEFORE).sql;
const server = (db, sql) => as(db, "postgres", null, sql);
const service = (db, sql) => as(db, "service_role", null, sql);
const poster = (db, sql) => as(db, "authenticated", P, sql);
const helpr = (db, sql) => as(db, "authenticated", A, sql);
const stranger = (db, sql) => as(db, "authenticated", X, sql);
const val = (r) => (r.ok && r.rows[0] ? Object.values(r.rows[0])[0] : undefined);

// Prod's bodies (md5 of pg_proc.prosrc, read-only, 2026-10-27).
const PROD_MD5 = {
  open_dispute_as: "2134e23238d679784693ade937d49435",
  check_dispute_velocity: "9e58986743277fee05d05d1af68beb31",
  enforce_job_status_transition: "cc3678a6d920dc3550f353124d4f518b",
  enforce_dispute_markers_server_owned: "922c7ffb248184db3ed2a70c3809b275",
  enforce_job_completion_server_owned: "866b9f98eaf9e9d69a612027ea1fca07",
  enforce_dispute_opener_column_whitelist: "6728815064ec0399e82122ec5d7cf6a0",
  dispute_evidence_url_ok: "3f20721461fa151e7826ca7399a8e931",
  job_legacy_completed_at: "c8f0e50498eed1eac1b56401a515c14a",
  is_caller_banned: "59f8c80b0695a931e3e1278802be667a",
  refuse_payout_claim_while_held: "92924d38d08d784ddd8bde73f161c2e6",
  job_messaging_closes_at: "400867c9e4d43fab05e647f3f31628bc",
};

const db = new PGlite();
// Prod's profiles carry under_13_blocked_at (20261022002144), which the newest is_caller_banned reads.
const base = baseSchema(BEFORE).replace("auto_suspended_until timestamptz);", "auto_suspended_until timestamptz, under_13_blocked_at timestamptz);");
if (base === baseSchema(BEFORE)) throw new Error("seriesWorld's profiles table changed: add under_13_blocked_at another way");
await db.exec(base);
await db.exec(`
  alter table public.jobs
    add column if not exists disputed_by uuid, add column if not exists disputed_at timestamptz,
    add column if not exists dispute_status text, add column if not exists dispute_reason text,
    add column if not exists dispute_helper_response text, add column if not exists dispute_resolved_at timestamptz,
    add column if not exists dispute_evidence_urls text[] default '{}', add column if not exists dispute_deadline timestamptz,
    add column if not exists poster_completed_at timestamptz, add column if not exists payout_scheduled_at timestamptz,
    add column if not exists completed_at timestamptz, add column if not exists revision_completed_at timestamptz,
    add column if not exists poster_confirmed_arrival_at timestamptz, add column if not exists helper_arrival_verified_at timestamptz,
    add column if not exists helper_arrived_at timestamptz, add column if not exists poster_confirmed_working_at timestamptz,
    add column if not exists proof_before_urls text[], add column if not exists proof_after_urls text[];
  create table public.disputes (
    id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id) on delete cascade,
    opener_id uuid references auth.users(id) on delete set null, reason text not null,
    evidence_urls text[] not null default '{}', status text not null default 'open'
      check (status in ('open','decided','withdrawn','superseded')),
    created_at timestamptz not null default now(), decided_at timestamptz,
    decided_by uuid references auth.users(id) on delete set null, decision_text text, payout_split jsonb,
    execution_status text, execution_started_at timestamptz, executed_at timestamptz, execution_transfer_id text,
    execution_refund_id text, execution_helper_cents integer, execution_refund_cents integer, execution_error text, helper_response text);
  create unique index disputes_one_open_per_job_idx on public.disputes (job_id) where status = 'open';
  alter table public.disputes enable row level security;
  grant select, update on public.disputes to authenticated;
  grant all on public.disputes to service_role;
  create table public.fraud_flags (id serial primary key, user_id uuid, job_id uuid, flag_type text, details text, resolved boolean default false);
  create table public.user_roles (user_id uuid, role public.app_role);
  create function public.notify_ops_dispute_filed(uuid, text, text, uuid, boolean) returns void language sql as $f$ select $f$;
  create table public.messages (id uuid primary key default gen_random_uuid(), job_id uuid, sender_id uuid not null,
    receiver_id uuid, content text not null, read boolean default false, is_system boolean default false,
    created_at timestamptz default now());
  grant all on public.messages to service_role;
  create table public.payout_holds (helper_id uuid primary key, reason text not null, held_by uuid, held_at timestamptz default now());
  create table public.ban_settlement_queue (id uuid primary key default gen_random_uuid(), user_id uuid not null,
    review_state text not null default 'open');
  create table public.job_payout_holds (job_id uuid primary key references public.jobs(id) on delete cascade, reason text not null,
    held_at timestamptz not null default now(), held_by uuid);
  create function public.payout_waits_on_identity(uuid) returns boolean language sql stable as $f$ select false $f$;
  create table public.payout_transfers (id uuid primary key default gen_random_uuid(), job_id uuid references public.jobs(id),
    helper_id uuid, status text not null default 'pending', stripe_transfer_id text, amount_cents integer);
  grant all on public.payout_transfers to service_role;
  create table public.cron_defects_seen (fn text, ref text, msg text);
  create function public.log_cron_defect(p_fn text, p_ref text, p_msg text, p_ctx jsonb) returns void language sql
    as $f$ insert into public.cron_defects_seen values (p_fn, p_ref, p_msg) $f$;
`);
for (const n of [
  "check_dispute_velocity", "open_dispute_as", "enforce_job_status_transition", "enforce_dispute_markers_server_owned",
  "enforce_job_completion_server_owned", "enforce_dispute_opener_column_whitelist", "dispute_evidence_url_ok",
  "job_legacy_completed_at", "refuse_payout_claim_while_held", "job_messaging_closes_at",
]) await db.exec(fn(n));
await db.exec(`
  create trigger trg_enforce_job_status_transition before update of status on public.jobs
    for each row execute function public.enforce_job_status_transition();
  create trigger trg_dispute_markers_server_owned before insert or update of status, disputed_at, disputed_by, dispute_status,
    dispute_deadline, dispute_resolved_at, dispute_reason, dispute_helper_response on public.jobs
    for each row execute function public.enforce_dispute_markers_server_owned();
  create trigger zz_jobs_completion_server_owned before insert or update of status, helper_completed_at on public.jobs
    for each row execute function public.enforce_job_completion_server_owned();
  create trigger trg_enforce_dispute_opener_column_whitelist before update on public.disputes
    for each row execute function public.enforce_dispute_opener_column_whitelist();
  create trigger trg_ban_gate_disputes_insert before insert on public.disputes
    for each row execute function public.enforce_ban_gate();
  create trigger trg_refuse_payout_claim_while_held before insert on public.payout_transfers
    for each row execute function public.refuse_payout_claim_while_held();
`);

// 0. The bodies under test are prod's.
for (const [name, md5] of Object.entries(PROD_MD5)) {
  const got = val(await server(db, `select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                     where n.nspname = 'public' and p.proname = '${name}'`));
  check(`the world's ${name} is prod's body`, got === md5, `${String(got).slice(0, 8)} vs ${md5.slice(0, 8)}`);
}

if (MODE !== "skip") {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 1; i <= 3; i++) {
    let err = null;
    try { await db.exec(sql); } catch (e) { err = String(e.message ?? e); }
    check(`the migration applies (run ${i} of 3)`, !err, err ?? "");
  }
}

// Fixture jobs (written 2026-10-27): all $40, one Helpr (A), done 1 hour ago, the payout waiting (payout_pending), unless said.
//  1 fixed + confirmed   2 poster silent after "fixed"   3 Helpr can't fix   4 Helpr no answer   5 fix not done
//  6 poster still not right   7 done 49 h ago   8 already paid out   9 crew job   10 a dispute already open
//  11 moves on (admin refund) while the claim is open   12 photos   13 a chargeback inquiry comes and goes
const jobs = [
  [1, "1 hour"], [2, "1 hour"], [3, "1 hour"], [4, "1 hour"], [5, "1 hour"], [6, "1 hour"], [7, "49 hours"],
  [8, "1 hour"], [9, "1 hour"], [10, "1 hour"], [11, "1 hour"], [12, "1 hour"], [13, "1 hour"],
];
for (const [n, ago] of jobs) {
  const group = n === 9;
  const r = await server(db, `insert into public.jobs (id, title, budget, customer_id, helper_id, status, payment_status, date_needed,
      is_group_job, helpers_needed, helper_completed_at, poster_completed_at, completed_at, payout_scheduled_at)
    values ('${J(n)}', 'Hang shelves ${n}', 40, '${P}', ${group ? "null" : `'${A}'`}, 'completed', '${n === 8 ? "released" : "payout_pending"}',
      current_date - 1, ${group}, ${group ? 2 : 1}, now() - interval '${ago}', now() - interval '${ago}', now() - interval '${ago}',
      now() - interval '${ago}' + interval '72 hours')`);
  if (!r.ok) check(`job ${n} inserted`, false, r.err);
}
await server(db, `insert into public.group_job_helpers (job_id, helper_id) values ('${J(9)}', '${A}'), ('${J(9)}', '${B}')`);
await server(db, `insert into public.disputes (job_id, opener_id, reason) values ('${J(10)}', '${P}', 'An earlier problem with the job')`);

const NOTE = "Two of the shelves are crooked and a bracket is loose.";
const open = (who, n, note = NOTE, photos = "'{}'::text[]") => who(db, `select public.rpc_guarantee_open('${J(n)}', '${note.replace(/'/g, "''")}', ${photos})`);
const claimOf = async (n) => (await server(db, `select * from public.job_guarantee_claims where job_id = '${J(n)}'`)).rows?.[0];
const payoutClaim = (n) => service(db, `insert into public.payout_transfers (job_id, helper_id, amount_cents) values ('${J(n)}', '${A}', 3500) returning id`);
const tomorrow = `((now() at time zone 'America/Chicago')::date + 1)`;

// 1. Open, the hold, fix, confirm, paid.
{
  check("a stranger cannot open a claim", !(await open(stranger, 1)).ok && /guarantee_not_your_job/.test((await open(stranger, 1)).err));
  check("the Helpr cannot open a claim on their own job", /guarantee_not_your_job/.test((await open(helpr, 1)).err ?? ""));
  check("a one-line note is refused", /guarantee_needs_note/.test((await open(poster, 1, "bad")).err ?? ""));
  const r = await open(poster, 1);
  check("the poster opens a claim within 48 h", r.ok, r.err);
  check("one claim per job: a second is refused", /guarantee_already_used/.test((await open(poster, 1)).err ?? ""));
  const pay = await payoutClaim(1);
  check("while the claim is open the payout claim is refused (payout_held)", !pay.ok && /payout_held/.test(pay.err), pay.err);
  const c = await claimOf(1);
  check("the claim waits on the Helpr, answer due in 48 h", c?.status === "awaiting_helpr" && new Date(c.helpr_answer_by) > new Date(Date.now() + 47 * 3600e3));
  const told = await server(db, `select count(*)::int from public.notifications where user_id = '${A}' and job_id = '${J(1)}'`);
  check("the Helpr is told", val(told) === 1);
  const chat = await server(db, `select count(*)::int from public.messages where job_id = '${J(1)}' and is_system and receiver_id = '${A}'`);
  check("no system row in the job's chat (the bell is the notice; an RPC's messages insert could trip the message-rate cap, Q1169)", val(chat) === 0);
  check("the chat stays open while the claim is open", val(await server(db, `select public.job_messaging_closes_at('${J(1)}')`)) === null);
  check("the poster cannot answer for the Helpr", /guarantee_not_yours/.test((await poster(db, `select public.rpc_guarantee_helpr_answer('${c.id}', true, ${tomorrow})`)).err ?? ""));
  check("a fix date 4 days out is refused",
    /guarantee_bad_fix_date/.test((await helpr(db, `select public.rpc_guarantee_helpr_answer('${c.id}', true, ((now() at time zone 'America/Chicago')::date + 4))`)).err ?? ""));
  check("a fix date in the past is refused",
    /guarantee_bad_fix_date/.test((await helpr(db, `select public.rpc_guarantee_helpr_answer('${c.id}', true, ((now() at time zone 'America/Chicago')::date - 1))`)).err ?? ""));
  const acc = await helpr(db, `select public.rpc_guarantee_helpr_answer('${c.id}', true, ${tomorrow})`);
  check("the Helpr accepts a fix for tomorrow", val(acc) === "fix_scheduled", acc.err);
  check("still held while the fix is scheduled", !(await payoutClaim(1)).ok);
  check("the poster cannot mark it fixed", /guarantee_not_yours/.test((await poster(db, `select public.rpc_guarantee_mark_fixed('${c.id}')`)).err ?? ""));
  check("the Helpr marks it fixed", val(await helpr(db, `select public.rpc_guarantee_mark_fixed('${c.id}')`)) === "fixed");
  check("still held while the poster looks", !(await payoutClaim(1)).ok);
  check("the Helpr cannot confirm their own fix", /guarantee_not_yours/.test((await helpr(db, `select public.rpc_guarantee_poster_answer('${c.id}', true)`)).err ?? ""));
  check("the poster confirms it's fixed: closed", val(await poster(db, `select public.rpc_guarantee_poster_answer('${c.id}', true)`)) === "closed");
  const after = await claimOf(1);
  check("closed as poster_confirmed", after?.status === "closed" && after.close_reason === "poster_confirmed");
  const paid = await payoutClaim(1);
  check("closed: the payout claim goes through (the Helpr is paid)", paid.ok, paid.err);
  check("a closed claim cannot be answered again", /guarantee_answer_closed/.test((await poster(db, `select public.rpc_guarantee_poster_answer('${c.id}', false, 'It is still crooked on the left side.')`)).err ?? ""));
  const closes = val(await server(db, `select public.job_messaging_closes_at('${J(1)}') > now() + interval '23 hours'`));
  check("the chat stays open 24 h after the claim closed", closes === true);
}

// 2. Poster silent after "fixed": the sweep closes it, the Helpr is paid.
{
  await open(poster, 2);
  const c = await claimOf(2);
  await helpr(db, `select public.rpc_guarantee_helpr_answer('${c.id}', true, ${tomorrow})`);
  await helpr(db, `select public.rpc_guarantee_mark_fixed('${c.id}')`);
  check("before the 48 h the sweep leaves it", (await server(db, `select public.guarantee_sweep()`)).ok && (await claimOf(2)).status === "fixed");
  await server(db, `update public.job_guarantee_claims set poster_answer_by = now() - interval '1 minute' where id = '${c.id}'`);
  check("the poster cannot answer after the 48 h", /guarantee_answer_closed/.test((await poster(db, `select public.rpc_guarantee_poster_answer('${c.id}', true)`)).err ?? ""));
  await server(db, `select public.guarantee_sweep()`);
  const after = await claimOf(2);
  check("poster silence closes the claim (poster_silent)", after.status === "closed" && after.close_reason === "poster_silent");
  check("and the payout goes through", (await payoutClaim(2)).ok);
}

// 3-6. Each way to a dispute: ONE platform dispute through open_dispute_as, filed by the sweep.
async function toDispute(n, label, setup) {
  await open(poster, n);
  const c = await claimOf(n);
  await setup(c);
  const mid = await claimOf(n);
  if (mid.status === "escalating") {
    check(`${label}: recorded as escalating; the money stays held`, !(await payoutClaim(n)).ok);
    check(`${label}: no dispute until the sweep (a party's session cannot file it)`,
      val(await server(db, `select count(*)::int from public.disputes where job_id = '${J(n)}'`)) === 0);
  }
  const sw = await server(db, `select public.guarantee_sweep()`);
  check(`${label}: the sweep runs`, sw.ok, sw.err);
  const after = await claimOf(n);
  const d = await server(db, `select d.id, d.opener_id, d.status, d.reason, j.status::text as job_status, j.dispute_status
                                from public.disputes d join public.jobs j on j.id = d.job_id where d.job_id = '${J(n)}'`);
  const row = d.rows?.[0];
  check(`${label}: the claim is disputed and names its dispute`, after.status === "disputed" && after.dispute_id === row?.id, `${after.status}`);
  check(`${label}: one open platform dispute (no opener), the job disputed`,
    d.rows?.length === 1 && row.opener_id === null && row.status === "open" && row.job_status === "disputed" && row.dispute_status === "open");
  check(`${label}: the dispute says it came from the Helpr Guarantee, in the poster's words`, /^Helpr Guarantee: .*Two of the shelves are crooked/.test(row?.reason ?? ""));
  check(`${label}: nobody is told "Revision deadline passed" (the platform filing's own notice is dropped)`,
    val(await server(db, `select count(*)::int from public.notifications where title = 'Revision deadline passed — dispute opened' and link like '%${J(n)}'`)) === 0);
  check(`${label}: both are told it is now a dispute`,
    val(await server(db, `select count(distinct user_id)::int from public.notifications where job_id = '${J(n)}' and title like '%Helpr Guarantee request is now a dispute'`)) === 2);
  await server(db, `select public.guarantee_sweep()`);
  check(`${label}: a second sweep files nothing more`, val(await server(db, `select count(*)::int from public.disputes where job_id = '${J(n)}'`)) === 1);
  const g = val(await service(db, `select public.guarantee_claim_for_dispute('${row?.id}')`));
  check(`${label}: execute-dispute-split can tell the dispute came from a claim`, g?.refund_basis === "job_price_only");
  check(`${label}: the payout still waits (the job is disputed, not completed)`, (await claimOf(n)).status === "disputed");
  return after;
}
await toDispute(3, "Helpr can't fix", async (c) => {
  check("Can't fix records escalating", val(await helpr(db, `select public.rpc_guarantee_helpr_answer('${c.id}', false)`)) === "escalating");
});
await toDispute(4, "Helpr no answer in 48 h", async (c) => {
  await server(db, `update public.job_guarantee_claims set helpr_answer_by = now() - interval '1 minute' where id = '${c.id}'`);
  check("the Helpr cannot answer after the 48 h", /guarantee_answer_closed/.test((await helpr(db, `select public.rpc_guarantee_helpr_answer('${c.id}', true, ${tomorrow})`)).err ?? ""));
});
await toDispute(5, "fix not done by the day after the fix date", async (c) => {
  await helpr(db, `select public.rpc_guarantee_helpr_answer('${c.id}', true, ${tomorrow})`);
  await server(db, `update public.job_guarantee_claims set fix_date = (now() at time zone 'America/Chicago')::date - 3 where id = '${c.id}'`);
});
await toDispute(6, "poster says still not right", async (c) => {
  await helpr(db, `select public.rpc_guarantee_helpr_answer('${c.id}', true, ${tomorrow})`);
  await helpr(db, `select public.rpc_guarantee_mark_fixed('${c.id}')`);
  check("still not right needs a sentence", /guarantee_needs_note/.test((await poster(db, `select public.rpc_guarantee_poster_answer('${c.id}', false, 'no')`)).err ?? ""));
  check("still not right records escalating",
    val(await poster(db, `select public.rpc_guarantee_poster_answer('${c.id}', false, 'The left shelf still tilts and the bracket wobbles.')`)) === "escalating");
});
check("the reject note reaches the dispute", /After the fix: The left shelf still tilts/.test(
  (await server(db, `select reason from public.disputes where job_id = '${J(6)}'`)).rows?.[0]?.reason ?? ""));
{
  // An admin supersedes a decision: the old dispute is retired and a new one opened on the same job.
  const old = (await server(db, `select id from public.disputes where job_id = '${J(3)}' and status = 'open'`)).rows?.[0]?.id;
  await server(db, `update public.disputes set status = 'superseded' where id = '${old}'`);
  const fresh = val(await server(db, `insert into public.disputes (job_id, opener_id, reason) values ('${J(3)}', null, 'Superseded decision, re-opened by an admin') returning id`));
  const g = val(await service(db, `select public.guarantee_claim_for_dispute('${fresh}')`));
  check("a superseded decision's new dispute keeps the price-only rule (found by the job)", g?.refund_basis === "job_price_only");
  const other = val(await service(db, `select public.guarantee_claim_for_dispute('${(await server(db, `select id from public.disputes where job_id = '${J(10)}'`)).rows?.[0]?.id}')`));
  check("a dispute on a job with no guarantee claim is not price-only", other === null || other === undefined);
}
check("a disputed job takes no second claim", /guarantee_already_used/.test((await open(poster, 3)).err ?? ""));

// 7-10. Refusals at open.
check("48 h after done: refused", /guarantee_window_closed/.test((await open(poster, 7)).err ?? ""));
check("already paid out: refused", /guarantee_already_paid/.test((await open(poster, 8)).err ?? ""));
check("a crew job: refused", /guarantee_not_available/.test((await open(poster, 9)).err ?? ""));
check("a job with an open dispute: refused", /guarantee_not_available/.test((await open(poster, 10)).err ?? ""));
{
  // A live payout claim (sent or sending) refuses too, even with payout_pending.
  await server(db, `insert into public.payout_transfers (job_id, helper_id, status, stripe_transfer_id, amount_cents) values ('${J(12)}', '${A}', 'paid', 'tr_x', 3500)`);
  check("a payout already claimed: refused", /guarantee_already_paid/.test((await open(poster, 12)).err ?? ""));
}

// 11. The job moves on (an admin refunds it) while the claim is open: the sweep closes the claim, no dispute.
{
  await open(poster, 11);
  await server(db, `update public.jobs set payment_status = 'refunded' where id = '${J(11)}'`);
  await server(db, `select public.guarantee_sweep()`);
  const c = await claimOf(11);
  check("a job that moved on closes its claim (job_moved_on), no dispute",
    c.status === "closed" && c.close_reason === "job_moved_on" && val(await server(db, `select count(*)::int from public.disputes where job_id = '${J(11)}'`)) === 0);
}

// 13. A chargeback inquiry while the claim is open: the claim keeps holding; dismissed, it is still there.
{
  await open(poster, 13);
  await server(db, `update public.jobs set payment_status = 'chargeback' where id = '${J(13)}'`);
  await server(db, `select public.guarantee_sweep()`);
  check("a chargeback inquiry does not close the claim", (await claimOf(13)).status === "awaiting_helpr");
  await server(db, `update public.jobs set payment_status = 'payout_pending' where id = '${J(13)}'`);
  check("the inquiry dismissed: the claim still holds the payout", !(await payoutClaim(13)).ok);
  await server(db, `update public.jobs set payment_status = 'cancelling' where id = '${J(13)}'`);
  await server(db, `select public.guarantee_sweep()`);
  check("a cancel in flight does not close the claim", (await claimOf(13)).status === "awaiting_helpr");
  // The bank rules for the cardholder (lost): the webhook closes the request, which otherwise never ends.
  await server(db, `update public.jobs set payment_status = 'chargeback' where id = '${J(13)}'`);
  check("members cannot close a request as a lost chargeback", !(await poster(db, `select public.guarantee_close_on_lost_chargeback('${J(13)}')`)).ok);
  check("a lost chargeback closes the request (job_moved_on)", val(await service(db, `select public.guarantee_close_on_lost_chargeback('${J(13)}')`)) === 1);
  const c13 = await claimOf(13);
  check("closed as job_moved_on, and a second call does nothing", c13.status === "closed" && c13.close_reason === "job_moved_on"
    && val(await service(db, `select public.guarantee_close_on_lost_chargeback('${J(13)}')`)) === 0);
}
{
  // Another filing (no guarantee flag) still writes its "Revision deadline passed" notice.
  await server(db, `insert into public.notifications (user_id, title, message, type) values ('${P}', 'Revision deadline passed — dispute opened', 'x', 'warning')`);
  check("outside a guarantee filing the revision notice is written as before",
    val(await server(db, `select count(*)::int from public.notifications where title = 'Revision deadline passed — dispute opened' and user_id = '${P}'`)) === 1);
}

// Photos: the poster's own uploads for this job, path form only.
{
  await server(db, `update public.jobs set payment_status = 'payout_pending' where id = '${J(11)}'`);
  await server(db, `delete from public.payout_transfers where job_id = '${J(12)}'`);
  const mine = `ARRAY['${P}/disputes/${J(12)}/a.jpg']::text[]`;
  const theirs = `ARRAY['${A}/disputes/${J(12)}/a.jpg']::text[]`;
  const signed = `ARRAY['https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/sign/proof-photos/${P}/disputes/${J(12)}/a.jpg?token=x']::text[]`;
  check("someone else's photo is refused", /guarantee_bad_photo/.test((await open(poster, 12, NOTE, theirs)).err ?? ""));
  check("a signed URL (expires) is refused: paths only", /guarantee_bad_photo/.test((await open(poster, 12, NOTE, signed)).err ?? ""));
  const seven = `ARRAY[${Array.from({ length: 7 }, (_, i) => `'${P}/disputes/${J(12)}/${i}.jpg'`).join(",")}]::text[]`;
  check("7 photos are refused", /guarantee_too_many_photos/.test((await open(poster, 12, NOTE, seven)).err ?? ""));
  const r = await open(poster, 12, NOTE, mine);
  check("the poster's own photo path is kept", r.ok && (await claimOf(12)).photo_paths?.[0] === `${P}/disputes/${J(12)}/a.jpg`, r.err);
}

// RLS and ACLs.
{
  check("the poster reads the claim", (await poster(db, `select id from public.job_guarantee_claims where job_id = '${J(1)}'`)).rows?.length === 1);
  check("the Helpr reads the claim", (await helpr(db, `select id from public.job_guarantee_claims where job_id = '${J(1)}'`)).rows?.length === 1);
  check("a stranger reads nothing", (await stranger(db, `select id from public.job_guarantee_claims`)).rows?.length === 0);
  check("no member writes the table directly", !(await poster(db, `update public.job_guarantee_claims set status = 'closed' where job_id = '${J(12)}'`)).ok);
  check("no member runs the sweep", !(await poster(db, `select public.guarantee_sweep()`)).ok);
  check("no member escalates directly", !(await poster(db, `select public.guarantee_escalate('${(await claimOf(12)).id}', 'helpr_cant_fix')`)).ok);
  check("anon cannot open a claim", !(await as(db, "anon", null, `select public.rpc_guarantee_open('${J(12)}', '${NOTE}')`)).ok);
  check("no cron defect was logged", val(await server(db, `select count(*)::int from public.cron_defects_seen`)) === 0);
}

console.log(`\n${failures() === 0 ? "ALL PASS" : `${failures()} FAIL`}`);
process.exit(failures() === 0 ? 0 : 1);
