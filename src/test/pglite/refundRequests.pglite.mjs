#!/usr/bin/env node
/**
 * PGlite proof for 20261021102943_refund_requests (board 141, Jobs side,
 * docs/OPEN.md Q2272; owner 2026-10-21: the money moves automatically when the
 * other side agrees).
 *
 *   node src/test/pglite/refundRequests.pglite.mjs                    # AFTER: the migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/refundRequests.pglite.mjs # RED: the chain on main
 *
 * World: seriesWorld.mjs (the real jobs column locks and ban gate), plus the
 * NEWEST definitions of open_dispute_as, check_dispute_velocity,
 * enforce_job_status_transition, enforce_dispute_markers_server_owned,
 * enforce_job_completion_server_owned, enforce_helper_completion_gates,
 * enforce_dispute_opener_column_whitelist, request_job_schedule_change,
 * member_display_name and the feature switch trio (require_feature,
 * feature_enabled_for, feature_enabled_for_user), read from the migrations,
 * not retyped. Stubbed, and said so: auth.uid()/auth.role() (the JWT claims),
 * has_role (no admins), dispute_evidence_url_ok and notify_ops_dispute_filed
 * (no evidence is attached; Slack is not under test), update_updated_at_column.
 *
 * Checks: the switch refuses an ordinary account; only the job's poster asks,
 * only its Helpr answers; the amount is the server's ('all' ignores the
 * client's figure, 'part' is bounded by the job's own price); RLS lets the two
 * parties read and nobody write; Agree records a decided dispute
 * (decided_via 'agreement', both named, shares from the stored amounts, an
 * audit row); refund_agreement_for_dispute returns the proof ONLY for a
 * recorded agreement; a client cannot forge the agreement columns; no
 * escrow -> payout_pending while a request is live; the service hand-out is
 * once per 30 minutes, 3 times at most, and closes the job as a decision
 * does; I don't agree and no answer in 2 days open a normal dispute (in
 * server context, where the Helpr's own session would be refused); Come back
 * and finish sends the existing date/time request; the sweep closes a request
 * whose job moved on.
 */
import { PGlite, readMigration, baseSchema, newestFunctionSql, as, checker, USERS } from "./seriesWorld.mjs";

const FIX_FILE = "20261021102943_refund_requests.sql";
const BEFORE = FIX_FILE.slice(0, 14);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running the chain on main (expect FAILs)`);
const { P, A, B, X } = USERS; // P posts, A is the hired Helpr, B another Helpr, X an ordinary (non-tester) member
const { check, failures } = checker();
const J = (n) => `d0000000-0000-0000-0000-0000000001${String(n).padStart(2, "0")}`;
const fn = (n) => newestFunctionSql(n, BEFORE).sql;
const service = (db, sql) => as(db, "service_role", null, sql);
const server = (db, sql) => as(db, "postgres", null, sql);

const db = new PGlite();
await db.exec(baseSchema(BEFORE));
await db.exec(`
  alter table public.jobs
    add column if not exists disputed_by uuid, add column if not exists disputed_at timestamptz,
    add column if not exists dispute_status text, add column if not exists dispute_reason text,
    add column if not exists dispute_helper_response text, add column if not exists dispute_resolved_at timestamptz,
    add column if not exists dispute_evidence_urls text[] default '{}', add column if not exists dispute_deadline timestamptz,
    add column if not exists poster_completed_at timestamptz, add column if not exists payout_scheduled_at timestamptz,
    add column if not exists poster_confirmed_arrival_at timestamptz, add column if not exists helper_arrival_verified_at timestamptz,
    add column if not exists helper_arrived_at timestamptz, add column if not exists poster_confirmed_working_at timestamptz,
    add column if not exists proof_before_urls text[], add column if not exists proof_after_urls text[];
  alter table public.group_job_helpers add column if not exists helper_completed_at timestamptz;
  create table public.disputes (
    id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id) on delete cascade,
    opener_id uuid references auth.users(id) on delete set null, reason text not null,
    evidence_urls text[] not null default '{}', status text not null default 'open'
      check (status in ('open','decided','withdrawn','superseded')),
    created_at timestamptz not null default now(), decided_at timestamptz,
    decided_by uuid references auth.users(id) on delete set null, decision_text text, payout_split jsonb,
    execution_status text check (execution_status is null or execution_status in ('pending','executing','executed','failed','crew_fanout')),
    execution_started_at timestamptz, executed_at timestamptz, execution_transfer_id text, execution_refund_id text,
    execution_helper_cents integer, execution_refund_cents integer, execution_error text, helper_response text);
  create unique index disputes_one_open_per_job_idx on public.disputes (job_id) where status = 'open';
  alter table public.disputes enable row level security;
  grant select, update on public.disputes to authenticated;
  grant all on public.disputes to service_role;
  create policy "disputes opener select" on public.disputes for select using ((select auth.uid()) = opener_id);
  create policy "disputes opener update while open" on public.disputes for update
    using ((select auth.uid()) = opener_id and status = 'open') with check ((select auth.uid()) = opener_id and status = 'open');
  create table public.dispute_settlement_claims (job_id uuid primary key, action text, claimed_by uuid, token uuid,
    claimed_at timestamptz default now(), money_step_at timestamptz);
  create table public.fraud_flags (id serial primary key, user_id uuid, job_id uuid, flag_type text, details text, resolved boolean default false);
  create table public.user_roles (user_id uuid, role public.app_role);
  create table public.admin_audit_log (id uuid primary key default gen_random_uuid(), admin_id uuid, action text not null,
    target_type text, target_id text, details jsonb, created_at timestamptz not null default now());
  grant all on public.admin_audit_log to service_role;
  create table public.feature_switches (key text primary key, audience text not null default 'off', description text not null,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  create table public.test_accounts (user_id uuid primary key, enrolled_at timestamptz default now(), note text);
  insert into public.test_accounts (user_id) values ('${P}'), ('${A}'), ('${B}');
  create table public.job_schedule_change_requests (
    id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id) on delete cascade,
    requested_by uuid not null, responder_id uuid not null, old_date date not null, old_start_time time,
    new_date date not null, new_start_time time, status text not null default 'pending',
    expires_at timestamptz not null, created_at timestamptz not null default now(), decided_at timestamptz);
  create unique index on public.job_schedule_change_requests (job_id) where status = 'pending';
  create function public.update_updated_at_column() returns trigger language plpgsql as
    $f$ begin new.updated_at := now(); return new; end $f$;
  create function public.dispute_evidence_url_ok(text, uuid, uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.notify_ops_dispute_filed(uuid, text, text, uuid, boolean) returns void language sql as $f$ select $f$;
`);
for (const n of [
  "member_display_name", "feature_enabled_for_user", "feature_enabled_for", "require_feature", "check_dispute_velocity",
  "open_dispute_as", "enforce_job_status_transition", "enforce_dispute_markers_server_owned",
  "enforce_job_completion_server_owned", "enforce_helper_completion_gates", "enforce_dispute_opener_column_whitelist",
  "request_job_schedule_change",
]) await db.exec(fn(n));
await db.exec(`
  create trigger trg_enforce_job_status_transition before update of status on public.jobs
    for each row execute function public.enforce_job_status_transition();
  create trigger trg_dispute_markers_server_owned before insert or update of status, disputed_at, disputed_by, dispute_status,
    dispute_deadline, dispute_resolved_at, dispute_reason, dispute_helper_response on public.jobs
    for each row execute function public.enforce_dispute_markers_server_owned();
  create trigger trg_helper_completion_gates before update of helper_completed_at, status on public.jobs
    for each row execute function public.enforce_helper_completion_gates();
  create trigger zz_jobs_completion_server_owned before insert or update of status, helper_completed_at on public.jobs
    for each row execute function public.enforce_job_completion_server_owned();
  create trigger trg_enforce_dispute_opener_column_whitelist before update on public.disputes
    for each row execute function public.enforce_dispute_opener_column_whitelist();
  create trigger trg_ban_gate_disputes_insert before insert on public.disputes
    for each row execute function public.enforce_ban_gate();
`);

// Jobs. All $40, one-time, Helpr A hired, money held, unless said.
//  1 part + agree   2 all + agree   3 decline   4 no answer   5 completed   6 crew
//  7 unpaid         8 booked, start ahead (come back and finish)
//  9 decline after a withdrawn dispute (dispute_resolved_at stamped)
// 10 an ordinary member's job (X posts)   11 moves on before an answer   12 limit
await db.exec(`
  insert into public.jobs (id, title, budget, customer_id, helper_id, status, payment_status, date_needed, start_time,
                           is_group_job, helpers_needed, estimated_hours)
  values ('${J(1)}', 'Assemble a bookshelf', 40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 1, '10:00', false, 1, 2),
         ('${J(2)}', 'Hang shelves',         40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 1, '10:00', false, 1, 2),
         ('${J(3)}', 'Paint a fence',        40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 1, '10:00', false, 1, 2),
         ('${J(4)}', 'Rake leaves',          40, '${P}', '${A}', 'revision_requested', 'escrow', current_date - 1, '10:00', false, 1, 2),
         ('${J(5)}', 'Done job',             40, '${P}', '${A}', 'completed', 'payout_pending', current_date - 1, '10:00', false, 1, 2),
         ('${J(6)}', 'Crew job',             40, '${P}', NULL,   'in_progress', 'escrow', current_date - 1, '10:00', true, 2, 2),
         ('${J(7)}', 'Unpaid',               40, '${P}', '${A}', 'accepted', 'unpaid', current_date + 3, '10:00', false, 1, 2),
         ('${J(8)}', 'Mow the lawn',         40, '${P}', '${A}', 'accepted', 'escrow', current_date + 3, '10:00', false, 1, 2),
         ('${J(9)}', 'Clean gutters',        40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 1, '10:00', false, 1, 2),
         ('${J(10)}', 'Ordinary',            40, '${X}', '${A}', 'in_progress', 'escrow', current_date - 1, '10:00', false, 1, 2),
         ('${J(11)}', 'Moves on',            40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 1, '10:00', false, 1, 2),
         ('${J(12)}', 'Limit',               40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 1, '10:00', false, 1, 2),
         ('${J(13)}', 'Ordinary Helpr',      40, '${P}', '${X}', 'in_progress', 'escrow', current_date - 1, '10:00', false, 1, 2),
         ('${J(14)}', 'Back out after agree', 40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 1, '10:00', false, 1, 2),
         ('${J(15)}', 'Helpr changes',       40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 1, '10:00', false, 1, 2),
         ('${J(16)}', 'Withdraw',            40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 1, '10:00', false, 1, 2);
  -- A sanctioned cancel as an RPC runs it: a definer function in the poster's session, under its own flag.
  create function public.test_poster_cancel(p_job uuid) returns void language plpgsql security definer set search_path = public as $f$
  begin
    perform set_config('app.sanctioned_cancel', 'on', true);
    update public.jobs set status = 'cancelled' where id = p_job;
  end $f$;
  grant execute on function public.test_poster_cancel(uuid) to authenticated;
  update public.jobs set dispute_resolved_at = now() - interval '1 day' where id = '${J(9)}';
  insert into public.disputes (job_id, opener_id, reason, status, decided_at)
    values ('${J(9)}', '${P}', 'An earlier complaint, withdrawn', 'withdrawn', now() - interval '1 day');
  update public.profiles set full_name = 'Lexi Lombas' where user_id = '${P}';
  update public.profiles set full_name = 'Jolie Thibodeaux' where user_id = '${A}';
`);

if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(readMigration(FIX_FILE));
check(MODE === "skip" ? "the chain on main applies" : "the migration applies 3x on top of the chain (replay-safe)", true);

// On main the objects under test do not exist, so a read can throw: that is
// recorded as one more FAIL (and the run stays red), never a crash.
try {

const sw = await db.query(`select count(*)::int n, max(audience) a from public.feature_switches where key = 'refund_requests'`);
check("S1: the switch exists once, for testers", sw.rows[0].n === 1 && sw.rows[0].a === "testers", JSON.stringify(sw.rows[0]));

const open = (uid, job, scope, cents, reason = "Two shelves are still missing their back panel.") =>
  as(db, "authenticated", uid, `select public.rpc_open_refund_request('${job}', ${scope === null ? "NULL" : `'${scope}'`}, ${cents === null ? "NULL" : cents}, $r$${reason}$r$) as id`);
const answer = (uid, id, ans, date = null, time = null) =>
  as(db, "authenticated", uid, `select public.rpc_answer_refund_request('${id}', '${ans}', ${date ? `current_date + ${date}` : "NULL"}, ${time ? `'${time}'` : "NULL"}) as v`);
const req = async (job) => (await db.query(`select * from public.refund_requests where job_id = '${job}' order by created_at desc limit 1`)).rows[0];
const refusedWith = (r, code) => !r.ok && r.err.includes(code);

// ── The switch and who may ask ───────────────────────────────────────────
let r = await open(X, J(10), "part", 2000);
check("F1: an ordinary (non-tester) account is refused by the switch", refusedWith(r, "feature_disabled"), r.err ?? "allowed");
r = await open(P, J(13), "part", 2000);
check("F2: a tester cannot send a request to a Helpr the switch is off for (no frozen pay, no dispute later)",
  refusedWith(r, "refund_request_helpr_not_enabled") && (await db.query(`select count(*)::int n from public.refund_requests where job_id = '${J(13)}'`)).rows[0].n === 0,
  r.err ?? "allowed");
r = await open(B, J(1), "part", 2000);
check("O1: someone not on the job cannot ask", refusedWith(r, "refund_request_not_poster"), r.err ?? "allowed");
r = await open(A, J(1), "part", 2000);
check("O2: the Helpr cannot ask on the poster's behalf", refusedWith(r, "refund_request_not_poster"), r.err ?? "allowed");
r = await as(db, "anon", null, `select public.rpc_open_refund_request('${J(1)}', 'part', 2000, 'Two shelves are still missing.')`);
check("O3: anon cannot call it at all", !r.ok && /permission denied/.test(r.err), r.err ?? "allowed");

// ── The amount is the server's ───────────────────────────────────────────
for (const [name, cents] of [["equal to the price", 4000], ["over the price", 9000], ["under $1", 99], ["missing", null]]) {
  r = await open(P, J(1), "part", cents);
  check(`O4: a part ${name} is refused`, refusedWith(r, "refund_request_amount_invalid"), r.err ?? "allowed");
}
r = await open(P, J(1), "part", 2000, "too short");
check("O5: a reason under 15 characters is refused", refusedWith(r, "refund_request_needs_reason"), r.err ?? "allowed");
r = await open(P, J(1), "maybe", 2000);
check("O6: an unknown scope is refused", refusedWith(r, "refund_request_invalid"), r.err ?? "allowed");

r = await open(P, J(1), "part", 2000);
check("O7: the poster asks for $20 of $40", r.ok, r.err);
let q1 = await req(J(1));
check("O7: stored as asked, priced from the job, answer clock 2 days", q1?.amount_cents === 2000 && q1?.budget_cents === 4000
  && q1?.status === "open" && Math.abs(new Date(q1.answer_by) - new Date(q1.created_at) - 2 * 86400e3) < 5000, JSON.stringify(q1 && { a: q1.amount_cents, b: q1.budget_cents, s: q1.status }));
r = await open(P, J(1), "part", 1000);
check("O8: one open request per job", refusedWith(r, "refund_request_already_open"), r.err ?? "allowed");
const note = await db.query(`select title, message, link from public.notifications where user_id = '${A}' and job_id = '${J(1)}'`);
check("O9: the Helpr is told, by first name and last initial, with the amount", note.rows.length === 1
  && note.rows[0].message.startsWith("Lexi L. asked for $20 back") && note.rows[0].link === `/jobs?job=${J(1)}`, JSON.stringify(note.rows));

r = await open(P, J(2), "all", 1);
check("O10: 'all' is asked", r.ok, r.err);
const q2 = await req(J(2));
check("O10: 'all' ignores the client's figure: the whole price", q2?.amount_cents === 4000 && q2?.refund_scope === "all", JSON.stringify(q2 && { a: q2.amount_cents }));

for (const [name, job, code] of [["a completed job", J(5), "refund_request_job_not_active"], ["a crew job", J(6), "refund_request_crew_job"],
  ["a job whose money is not held", J(7), "refund_request_not_held"]]) {
  r = await open(P, job, "part", 1000);
  check(`O11: ${name} is refused`, refusedWith(r, code), r.err ?? "allowed");
}

// ── RLS and grants ───────────────────────────────────────────────────────
const seen = async (uid) => (await as(db, "authenticated", uid, `select job_id from public.refund_requests where job_id = '${J(1)}'`)).rows?.length ?? -1;
check("R1: the poster reads their request", (await seen(P)) === 1);
check("R2: the Helpr asked reads it", (await seen(A)) === 1);
check("R3: anyone else reads nothing", (await seen(B)) === 0);
r = await as(db, "anon", null, `select 1 from public.refund_requests`);
check("R4: anon cannot read the table", !r.ok && /permission denied/.test(r.err), r.err ?? "allowed");
for (const [name, sql] of [
  ["insert", `insert into public.refund_requests (job_id, requester_id, responder_id, refund_scope, amount_cents, budget_cents, reason, answer_by) values ('${J(3)}', '${P}', '${A}', 'part', 100, 4000, 'A reason that is long enough', now())`],
  ["update", `update public.refund_requests set amount_cents = 100`],
  ["delete", `delete from public.refund_requests`],
]) {
  r = await as(db, "authenticated", P, sql);
  check(`R5: a client cannot ${name} the table`, !r.ok && /permission denied/.test(r.err), r.err ?? `allowed (${r.affected})`);
}
const priv = await db.query(`select
  has_function_privilege('anon', 'public.rpc_open_refund_request(uuid,text,integer,text)', 'execute') a1,
  has_function_privilege('anon', 'public.rpc_answer_refund_request(uuid,text,date,time)', 'execute') a2,
  has_function_privilege('authenticated', 'public.refund_agreements_due(integer)', 'execute') s1,
  has_function_privilege('authenticated', 'public.refund_agreement_for_dispute(uuid)', 'execute') s2,
  has_function_privilege('authenticated', 'public.refund_requests_sweep()', 'execute') s3,
  has_function_privilege('authenticated', 'public.refund_request_assert_job_open(uuid)', 'execute') s4,
  has_function_privilege('service_role', 'public.refund_agreements_due(integer)', 'execute') v1`).catch((e) => ({ rows: [{ err: e.message }] }));
const p = priv.rows[0];
check("G1: neither client RPC is executable by anon", p.a1 === false && p.a2 === false, JSON.stringify(p));
check("G2: the sweep, hand-out, proof and job check are service-only", p.s1 === false && p.s2 === false && p.s3 === false && p.s4 === false && p.v1 === true, JSON.stringify(p));

// ── No payout toward the Helpr while a request is live ──────────────────
r = await server(db, `update public.jobs set status = 'completed', payment_status = 'payout_pending' where id = '${J(1)}'`);
check("H1: escrow -> payout_pending is refused while the request is open (auto-release, the release button)", refusedWith(r, "refund_request_open"), r.err ?? "allowed");

// ── Who may answer ───────────────────────────────────────────────────────
r = await answer(P, q1?.id, "agree");
check("A1: the poster cannot answer their own request", refusedWith(r, "refund_request_not_yours"), r.err ?? "allowed");
r = await answer(B, q1?.id, "agree");
check("A2: another Helpr cannot answer it", refusedWith(r, "refund_request_not_yours"), r.err ?? "allowed");
r = await answer(A, q1?.id, "shrug");
check("A3: an unknown answer is refused", refusedWith(r, "refund_request_invalid"), r.err ?? "allowed");
check("A4: no dispute exists before the Helpr's answer", (await db.query(`select count(*)::int n from public.disputes where job_id = '${J(1)}'`)).rows[0].n === 0);

// ── Agree ────────────────────────────────────────────────────────────────
r = await answer(A, q1?.id, "agree");
check("AG1: the Helpr agrees", r.ok && r.rows[0].v.status === "agreed", r.err ?? JSON.stringify(r.rows?.[0]));
q1 = await req(J(1));
const d1 = (await db.query(`select * from public.disputes where job_id = '${J(1)}'`)).rows[0];
check("AG2: a DECIDED dispute, decided_via 'agreement', both parties named, no admin",
  d1?.status === "decided" && d1?.decided_via === "agreement" && d1?.agreed_poster_id === P && d1?.agreed_helper_id === A
  && d1?.decided_by === null && d1?.opener_id === P, JSON.stringify(d1 && { s: d1.status, v: d1.decided_via }));
check("AG3: shares from the stored amounts ($20 of $40 = poster 0.5 / Helpr 0.5), execution pending",
  Number(d1?.payout_split?.poster) === 0.5 && Number(d1?.payout_split?.helper) === 0.5 && d1?.execution_status === "pending", JSON.stringify(d1?.payout_split));
check("AG4: the request is agreed and linked to that dispute", q1?.status === "agreed" && q1?.dispute_id === d1?.id && q1?.answered_by === A);
const audit = await db.query(`select details from public.admin_audit_log where action = 'refund_agreement_recorded' and target_id = '${d1?.id}'`);
check("AG5: an audit row names both parties and the amount", audit.rows.length === 1 && audit.rows[0].details.poster_id === P
  && audit.rows[0].details.helper_id === A && audit.rows[0].details.amount_cents === 2000, JSON.stringify(audit.rows));
const job1 = (await db.query(`select status::text s, payment_status p from public.jobs where id = '${J(1)}'`)).rows[0];
check("AG6: nothing moved in the answer: the job is untouched and the money still held", job1.s === "in_progress" && job1.p === "escrow", JSON.stringify(job1));
r = await answer(A, q1?.id, "decline");
check("AG7: an answered request cannot be answered again", refusedWith(r, "refund_request_answered"), r.err ?? "allowed");
r = await server(db, `update public.jobs set payment_status = 'payout_pending' where id = '${J(1)}'`);
check("AG8: still no payout_pending while the agreement is unsettled", refusedWith(r, "refund_request_open"), r.err ?? "allowed");
r = await server(db, `select public.open_dispute_as('${J(1)}', '${P}', 'A complaint long enough to file', '{}')`);
check("AG8b: no second dispute can be opened over the agreement", refusedWith(r, "dispute_already_decided"), r.err ?? "allowed");
const pn = await db.query(`select message from public.notifications where user_id = '${P}' and job_id = '${J(1)}' and title = 'Refund agreed'`);
check("AG9: the poster is told, by name, that the refund is on its way", pn.rows.length === 1 && pn.rows[0].message.startsWith("Jolie T. agreed to your refund on \"Assemble a bookshelf\": $20 of the $40 price"), JSON.stringify(pn.rows));

// ── The proof of agreement ───────────────────────────────────────────────
const proof = async (d) => (await service(db, `select public.refund_agreement_for_dispute(${d === null ? "NULL" : `'${d}'`}) as v`)).rows?.[0]?.v ?? null;
const pr1 = await proof(d1?.id);
check("P1: the recorded agreement is proven (poster, Helpr, amount)", pr1?.poster_id === P && pr1?.helper_id === A && pr1?.amount_cents === 2000, JSON.stringify(pr1));
check("P2: a NULL dispute id proves nothing", (await proof(null)) === null);
const adminDecided = (await db.query(`insert into public.disputes (job_id, opener_id, reason, status, decided_at, decision_text, payout_split, execution_status)
  values ('${J(12)}', '${P}', 'An admin decided this one', 'decided', now(), 'admin', '{"poster":0.5,"helper":0.5}', 'pending') returning id`)).rows[0].id;
check("P3: an admin-decided dispute is not an agreement", (await proof(adminDecided)) === null);
await db.exec(`update public.disputes set decided_via = 'agreement', agreed_poster_id = '${P}', agreed_helper_id = '${A}' where id = '${adminDecided}'`);
check("P4: agreement columns on a dispute with no recorded answer prove nothing", (await proof(adminDecided)) === null);
await db.exec(`delete from public.disputes where id = '${adminDecided}'`);
const forged = (await db.query(`select id from public.disputes where job_id = '${J(9)}'`)).rows[0].id;
await db.exec(`update public.disputes set status = 'open' where id = '${forged}'`);
r = await as(db, "authenticated", P, `update public.disputes set decided_via = 'agreement', agreed_helper_id = '${A}' where id = '${forged}'`);
check("P5: a party cannot write the agreement columns on their own open dispute", refusedWith(r, "dispute_agreement_server_owned"), r.err ?? `allowed (${r.affected})`);
await db.exec(`update public.disputes set status = 'withdrawn' where id = '${forged}'`);
await db.exec(`update public.disputes set payout_split = '{"poster":0.9,"helper":0.1}' where id = '${d1?.id}'`);
check("P6: shares that do not match the stored amounts prove nothing", (await proof(d1?.id)) === null);
await db.exec(`update public.disputes set payout_split = '{"poster":0.5,"helper":0.5}' where id = '${d1?.id}'`);
await db.exec(`update public.refund_requests set answered_by = '${P}' where id = '${q1?.id}'`);
check("P7: an 'agreement' answered by the poster themself proves nothing", (await proof(d1?.id)) === null);
await db.exec(`update public.refund_requests set answered_by = '${A}' where id = '${q1?.id}'`);
check("P8: restored, the proof stands again", (await proof(d1?.id))?.helper_id === A);

// ── The service hand-out ─────────────────────────────────────────────────
r = await as(db, "authenticated", A, `select * from public.refund_agreements_due(20)`);
check("D1: a client cannot take the hand-out", !r.ok && /permission denied/.test(r.err), r.err ?? "allowed");
r = await service(db, `select * from public.refund_agreements_due(20)`);
check("D2: the agreement is handed out once", r.ok && r.rows.length === 1 && r.rows[0].dispute_id === d1?.id, r.err ?? JSON.stringify(r.rows));
const j1b = (await db.query(`select status::text s, payment_status p, dispute_status ds, dispute_resolved_at is not null rs from public.jobs where id = '${J(1)}'`)).rows[0];
check("D3: the hand-out closes the job as a decision does (completed, resolved, money still held for the split)",
  j1b.s === "completed" && j1b.ds === "resolved" && j1b.rs && j1b.p === "escrow", JSON.stringify(j1b));
r = await service(db, `select * from public.refund_agreements_due(20)`);
check("D4: not again within 30 minutes (one move per agreement in flight)", r.ok && r.rows.length === 0, JSON.stringify(r.rows));
await db.exec(`update public.refund_requests set last_settle_at = now() - interval '31 minutes' where id = '${q1?.id}'`);
await db.exec(`update public.disputes set execution_status = 'failed' where id = '${d1?.id}'`);
r = await service(db, `select * from public.refund_agreements_due(20)`);
check("D5: a failed attempt is retried after 30 minutes", r.ok && r.rows.length === 1, JSON.stringify(r.rows));
await db.exec(`update public.refund_requests set last_settle_at = now() - interval '31 minutes', settle_attempts = 3 where id = '${q1?.id}'`);
r = await service(db, `select * from public.refund_agreements_due(20)`);
check("D6: never a 4th attempt (an admin's from there)", r.ok && r.rows.length === 0, JSON.stringify(r.rows));
await db.exec(`update public.disputes set execution_status = 'executed' where id = '${d1?.id}'`);
await db.exec(`update public.refund_requests set settle_attempts = 0, last_settle_at = null where id = '${q1?.id}'`);
r = await service(db, `select * from public.refund_agreements_due(20)`);
check("D7: an executed agreement is never handed out again", r.ok && r.rows.length === 0, JSON.stringify(r.rows));
const live = (await db.query(`select public.refund_request_is_live(status, dispute_id) l from public.refund_requests where id = '${q1?.id}'`)).rows[0].l;
check("D8: once executed the request is no longer live", live === false);

// ── All of it ────────────────────────────────────────────────────────────
r = await answer(A, q2?.id, "agree");
const d2 = (await db.query(`select payout_split from public.disputes where job_id = '${J(2)}'`)).rows[0];
check("AL1: all of it = poster 1 / Helpr 0", r.ok && Number(d2?.payout_split?.poster) === 1 && Number(d2?.payout_split?.helper) === 0, r.err ?? JSON.stringify(d2));
r = await service(db, `select * from public.refund_agreements_due(20)`);
const j2 = (await db.query(`select status::text s from public.jobs where id = '${J(2)}'`)).rows[0];
check("AL2: the hand-out cancels the job when all of it comes back", r.ok && j2.s === "cancelled", r.err ?? JSON.stringify(j2));

// ── I don't agree ────────────────────────────────────────────────────────
r = await open(P, J(3), "part", 1500);
const q3 = await req(J(3));
r = await answer(A, q3?.id, "decline");
const q3b = await req(J(3));
check("DC1: I don't agree records the answer; no money, no dispute yet", r.ok && q3b?.status === "declined" && q3b?.dispute_id === null, r.err ?? JSON.stringify(q3b && { s: q3b.status, d: q3b.dispute_id }));
r = await server(db, `update public.jobs set payment_status = 'payout_pending' where id = '${J(3)}'`);
check("DC2: declined and not yet disputed is still live (no payout_pending)", refusedWith(r, "refund_request_open"), r.err ?? "allowed");
r = await open(P, J(9), "part", 1500);
const q9 = await req(J(9));
r = await answer(A, q9?.id, "decline");
check("DC3: I don't agree on a job with an earlier withdrawn dispute", r.ok, r.err);
r = await as(db, "authenticated", A, `select public.open_dispute_as('${J(9)}', '${P}', 'Two shelves are still missing their back panel.', '{}')`);
check("DC4: (why the sweep files it) opening it from the Helpr's own session is refused", !r.ok && /dispute_resolved_at/.test(r.err), r.err ?? "allowed");
r = await service(db, `select public.refund_requests_sweep() as v`);
check("DC5: the sweep opens both disputes", r.ok && r.rows[0].v.declined === 2 && r.rows[0].v.failed === 0, r.err ?? JSON.stringify(r.rows?.[0]?.v));
for (const [job, q] of [[J(3), q3], [J(9), q9]]) {
  const row = await req(job);
  const dj = (await db.query(`select j.status::text s, d.opener_id o, d.status ds, d.reason from public.jobs j join public.disputes d on d.job_id = j.id and d.status = 'open' where j.id = '${job}'`)).rows[0];
  check(`DC6: a normal dispute, in the poster's words, linked (${job.slice(-2)})`, dj?.s === "disputed" && dj?.o === P && row.dispute_id
    && dj?.reason === q.reason, JSON.stringify(dj));
}
r = await service(db, `select public.refund_requests_sweep() as v`);
check("DC7: a second sweep files nothing more", r.ok && r.rows[0].v.declined === 0 && (await db.query(`select count(*)::int n from public.disputes where job_id in ('${J(3)}', '${J(9)}') and status = 'open'`)).rows[0].n === 2, JSON.stringify(r.rows?.[0]?.v));

// ── No answer within 2 days ──────────────────────────────────────────────
r = await open(P, J(4), "part", 1000);
const q4 = await req(J(4));
await db.exec(`update public.refund_requests set answer_by = now() - interval '1 minute' where id = '${q4?.id}'`);
r = await answer(A, q4?.id, "agree");
check("E1: an answer after the clock is refused", refusedWith(r, "refund_request_expired"), r.err ?? "allowed");
r = await service(db, `select public.refund_requests_sweep() as v`);
const q4b = await req(J(4));
const j4 = (await db.query(`select status::text s from public.jobs where id = '${J(4)}'`)).rows[0];
check("E2: no answer in 2 days opens a normal dispute", r.ok && r.rows[0].v.expired === 1 && q4b.status === "expired" && q4b.dispute_id && j4.s === "disputed", r.err ?? JSON.stringify({ v: r.rows?.[0]?.v, s: q4b?.status, j: j4 }));
const en = await db.query(`select message from public.notifications where user_id = '${P}' and job_id = '${J(4)}' and title = 'Your refund request goes to Helpr'`);
check("E3: the poster is told who did not answer", en.rows.length === 1 && en.rows[0].message.startsWith("Jolie T. didn't answer"), JSON.stringify(en.rows));

// ── Come back and finish ─────────────────────────────────────────────────
r = await open(P, J(8), "part", 1000);
const q8 = await req(J(8));
r = await answer(A, q8?.id, "finish");
check("FN1: Come back and finish needs a time", refusedWith(r, "refund_request_needs_time"), r.err ?? "allowed");
r = await answer(A, q8?.id, "finish", 5, "09:00");
const q8b = await req(J(8));
const sc = (await db.query(`select requested_by, responder_id, new_date - current_date d, status from public.job_schedule_change_requests where id = '${q8b?.schedule_change_id}'`)).rows[0];
check("FN2: it sends the existing date/time request to the poster", r.ok && q8b.status === "finish_offered" && sc?.requested_by === A
  && sc?.responder_id === P && sc?.d === 5 && sc?.status === "pending", r.err ?? JSON.stringify({ s: q8b?.status, sc }));
r = await open(P, J(11), "part", 1000);
const q11 = await req(J(11));
r = await answer(A, q11?.id, "finish", 5, "09:00");
check("FN3: on a job already under way the schedule-change rule refuses (nothing recorded)", refusedWith(r, "schedule_change_not_booked") && (await req(J(11))).status === "open", r.err ?? "allowed");

// ── Moved on before an answer ────────────────────────────────────────────
await server(db, `update public.jobs set status = 'cancelled', payment_status = 'refunded' where id = '${J(11)}'`);
r = await service(db, `select public.refund_requests_sweep() as v`);
const q11b = await req(J(11));
check("C1: the sweep closes a request whose job moved on, with the reason", r.ok && q11b.status === "closed" && q11b.closed_reason === "refund_request_job_not_active", r.err ?? JSON.stringify({ s: q11b?.status, c: q11b?.closed_reason }));

// ── A limit per job ──────────────────────────────────────────────────────
for (let i = 0; i < 3; i++) {
  await open(P, J(12), "part", 1000);
  await db.exec(`update public.refund_requests set status = 'closed' where job_id = '${J(12)}' and status = 'open'`);
}
r = await open(P, J(12), "part", 1000);
check("L1: at most 3 requests per job", refusedWith(r, "refund_request_limit"), r.err ?? "allowed");

// ── No back-out, cancel or Helpr swap under a live request (money review #1) ─
r = await open(P, J(14), "part", 1000);
const q14 = await req(J(14));
r = await answer(A, q14?.id, "agree");
check("M0: agreed on job 14", r.ok, r.err);
r = await as(db, "authenticated", A, `update public.jobs set helper_id = NULL, status = 'open' where id = '${J(14)}'`);
check("M1: the Helpr cannot back out (reopen, helper cleared) after agreeing", refusedWith(r, "refund_request_live"), r.err ?? "allowed");
r = await as(db, "authenticated", P, `select public.test_poster_cancel('${J(14)}')`);
check("M2: the poster cannot cancel (a fee nobody pays, a split that can never run) while it settles", refusedWith(r, "refund_request_live"), r.err ?? "allowed");
r = await service(db, `select * from public.refund_agreements_due(20)`);
const j14 = (await db.query(`select status::text s, helper_id h from public.jobs where id = '${J(14)}'`)).rows[0];
check("M3: the hand-out (server) still closes the job as a decision does, Helpr kept for the split", r.ok && j14.s === "completed" && j14.h === A, r.err ?? JSON.stringify(j14));

// ── The Helpr asked is no longer the job's Helpr (money review #2) ──────────
r = await open(P, J(15), "part", 1000);
await server(db, `update public.jobs set helper_id = '${B}' where id = '${J(15)}'`);
r = await service(db, `select public.refund_requests_sweep() as v`);
const q15 = await req(J(15));
check("H2: the sweep closes a request whose Helpr changed (never the new Helpr's to answer or pay for)", q15?.status === "closed" && q15?.closed_reason === "refund_request_helpr_changed", JSON.stringify(q15 && { s: q15.status, c: q15.closed_reason }));

// ── The poster withdraws (money review #3) ───────────────────────────────────
r = await open(P, J(16), "part", 1000);
const q16 = await req(J(16));
const withdraw = (uid, id) => as(db, "authenticated", uid, `select public.rpc_withdraw_refund_request('${id}') as v`);
r = await withdraw(A, q16?.id);
check("W1: the Helpr cannot withdraw the poster's request", refusedWith(r, "refund_request_not_poster"), r.err ?? "allowed");
r = await withdraw(P, q16?.id);
const q16b = await req(J(16));
check("W2: the poster withdraws it: closed, nothing moved", r.ok && q16b.status === "closed" && q16b.closed_reason === "withdrawn_by_poster"
  && (await db.query(`select count(*)::int n from public.disputes where job_id = '${J(16)}'`)).rows[0].n === 0, r.err ?? JSON.stringify(q16b?.status));
const wn = await db.query(`select message from public.notifications where user_id = '${A}' and job_id = '${J(16)}' and title = 'Refund request withdrawn'`);
check("W3: the Helpr is told, by name", wn.rows.length === 1 && wn.rows[0].message.startsWith("Lexi L. withdrew"), JSON.stringify(wn.rows));
r = await server(db, `update public.jobs set status = 'completed', payment_status = 'payout_pending' where id = '${J(16)}'`);
check("W4: once withdrawn the job can be paid out as usual", r.ok, r.err);
r = await withdraw(P, q1?.id);
check("W5: an agreed request cannot be withdrawn", refusedWith(r, "refund_request_answered"), r.err ?? "allowed");
r = await as(db, "anon", null, `select public.rpc_withdraw_refund_request('${q16?.id}')`);
check("W6: anon cannot call it", !r.ok && /permission denied/.test(r.err), r.err ?? "allowed");
} catch (e) {
  check("the proof ran to the end", false, String(e?.message ?? e).split("\n")[0]);
}

console.log(failures() ? `\n${failures()} FAILED` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
