#!/usr/bin/env node
/**
 * PGlite proof for 20261021081258_stripe_identity_before_first_accept_post_and_start
 * (owner, 2026-10-21: Stripe Identity, photo ID + selfie, before a member's first
 * accepted job, first posted job, and before a Helpr heads out; payout setup is
 * not an ID check).
 *
 *   node src/test/pglite/identityBeforeAcceptPostAndStart.pglite.mjs                     # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/identityBeforeAcceptPostAndStart.pglite.mjs  # RED: before it
 *
 * World: seriesWorld.mjs (the real jobs trigger chain) plus, at their newest
 * CREATE before this migration and read from the tree: identity_is_verified,
 * is_identity_verified, helper_accept_missing, helper_accept_block_reason,
 * job_posted_by_seed, helper_mark_on_the_way, group_member_slot,
 * rpc_group_member_on_the_way. Stubbed, and said so: has_role (no admins, from
 * seriesWorld) and the profile/roster columns this proof reads.
 *
 * Members: N = no ID, I = Stripe Identity verified, C = Connect (payouts) only,
 * P = poster with no ID, X = an enrolled test account (is_seed + test_accounts).
 * [fix] checks FAIL on the before state; [keep] checks pass in both.
 */
import { PGlite, baseSchema, newestFunctionSql, readMigration, USERS, as as asRole, checker } from "./seriesWorld.mjs";

const THIS = "20261021081258_stripe_identity_before_first_accept_post_and_start.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const { check: checkNamed, failures } = checker();
const check = (ok, name) => checkNamed(name, ok);
const { P: POSTER, A: NOID, B: IDV, C: CONNECT, X: TEST } = USERS;

const PATH = [
  "identity_is_verified", "is_identity_verified", "helper_accept_missing", "helper_accept_block_reason",
  "job_posted_by_seed", "helper_mark_on_the_way", "group_member_slot", "rpc_group_member_on_the_way",
];

const db = new PGlite();
await db.exec(baseSchema(THIS));
await db.exec(`
  alter table public.profiles add column stripe_account_id text, add column stripe_payouts_enabled boolean,
    add column is_seed boolean default false, add column idv_status text default 'not_started',
    add column stripe_identity_verified boolean default false;
  alter table public.jobs add column helper_on_the_way_at timestamptz, add column helper_arrived_at timestamptz;
  alter table public.group_job_helpers add column helper_confirmed_at timestamptz, add column helper_on_the_way_at timestamptz,
    add column helper_arrived_at timestamptz, add column slot_no int;
  grant select, update on public.group_job_helpers to authenticated, service_role;
  create table public.test_accounts (user_id uuid primary key);
  create table public.job_tracking (id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid,
    status text, latitude double precision, longitude double precision, created_at timestamptz default now(),
    updated_at timestamptz default now());
  grant all on public.job_tracking to authenticated, service_role;
  ${PATH.map((n) => newestFunctionSql(n, THIS).sql).join("\n")}
  update public.profiles set stripe_account_id = 'acct_' || left(user_id::text, 1), stripe_payouts_enabled = true;
  update public.profiles set idv_status = 'verified' where user_id = '${IDV}';
  update public.profiles set stripe_identity_verified = true where user_id = '${CONNECT}';
  update public.profiles set is_seed = true where user_id = '${TEST}';
  insert into public.test_accounts values ('${TEST}');
`);
// Who the one notice is for, as it stands when the migration runs: a booked,
// upcoming job for N (no ID) and for I (verified); an open job posted by P (no
// ID) and by X (test account).
await db.exec(`
  insert into public.jobs (customer_id, title, status, payment_status, helper_id, helper_confirmed_at, date_needed)
    values ('${POSTER}', 'Pre', 'accepted', 'escrow', '${NOID}', now(), (now() at time zone 'America/Chicago')::date + 1),
           ('${POSTER}', 'Pre2', 'accepted', 'escrow', '${IDV}', now(), (now() at time zone 'America/Chicago')::date + 1);
  insert into public.jobs (customer_id, title, status) values ('${POSTER}', 'Open', 'open'), ('${TEST}', 'Open2', 'open');
`);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(readMigration(THIS));

const q = async (sql) => (await db.query(sql)).rows;
const as = async (uid, sql) => {
  const r = await asRole(db, "authenticated", uid, sql);
  return r.ok ? { ok: true, rows: r.rows } : { ok: false, err: r.err };
};

// ---- the one rule ----------------------------------------------------------
const rule = (await q(`select public.identity_is_verified('not_started', true) connect_only,
  public.identity_is_verified('verified', false) idv, public.identity_is_verified(null, null) nothing`))[0];
check(rule.connect_only === false, `[fix] R1: payout setup alone (Connect's flag) is not an ID check (${JSON.stringify(rule)})`);
check(rule.idv === true && rule.nothing === false, `[keep] R2: Stripe Identity verified passes, nothing fails`);

// ---- accept: the existing gate now reads Identity only ---------------------
const acc = (await q(`select public.helper_accept_block_reason('${CONNECT}') c, public.helper_accept_block_reason('${IDV}') i,
  public.helper_accept_block_reason('${NOID}') n`))[0];
check(acc.c === "helper_identity_unverified", `[fix] A1: a payouts-only Helpr's accept waits on Stripe Identity (${JSON.stringify(acc)})`);
check(acc.i === null && acc.n === "helper_identity_unverified", `[keep] A2: Identity passes, no ID waits`);

// ---- posting ---------------------------------------------------------------
const post = (uid) => as(uid, `insert into public.jobs (customer_id, title, status, payment_status) values ('${uid}', 'Mow', 'open', 'unpaid') returning id`);
const p1 = await post(NOID);
check(!p1.ok && /identity_required_to_post/.test(p1.err), `[fix] P1: a member without Identity cannot post (${p1.err ?? "inserted"})`);
const p1c = await post(CONNECT);
check(!p1c.ok && /identity_required_to_post/.test(p1c.err), `[fix] P2: payout setup alone does not let a member post (${p1c.err ?? "inserted"})`);
const p2 = await post(IDV);
check(p2.ok, `[keep] P3: an Identity-verified member posts (${p2.err ?? "ok"})`);
const p3 = await post(TEST);
check(p3.ok, `[keep] P4: an enrolled test account posts (${p3.err ?? "ok"})`);
const srv = await db.query(`insert into public.jobs (customer_id, title, status) values ('${NOID}', 'Visit', 'open') returning id`).then(() => true, (e) => e.message);
check(srv === true, `[keep] P5: a server write (recurring visit) for an unverified poster is untouched (${srv})`);
await q(`update public.profiles set is_seed = true where user_id = '${POSTER}'`);
const p6 = await post(POSTER);
check(!p6.ok && /identity_required_to_post/.test(p6.err), `[fix] P6: is_seed alone (not an enrolled test account) is judged like anyone (${p6.err ?? "inserted"})`);
await q(`update public.profiles set is_seed = false where user_id = '${POSTER}'`);

// ---- heading out: single Helpr ---------------------------------------------
const booked = async (helper) => (await q(`insert into public.jobs (customer_id, title, status, payment_status, helper_id,
  helper_confirmed_at, helper_dayof_confirmed_at, date_needed, start_time)
  values ('${POSTER}', 'Lawn', 'accepted', 'escrow', '${helper}', now(), null, (now() at time zone 'America/Chicago')::date, (now() at time zone 'America/Chicago')::time)
  returning id`))[0].id;
for (const [who, uid] of [["no ID", NOID], ["payouts only", CONNECT]]) {
  const j = await booked(uid);
  // The day-of confirm is NOT gated (owner: confirm, then Identity, then On the way).
  const conf = await asRole(db, "postgres", uid, `update public.jobs set helper_dayof_confirmed_at = now() where id = '${j}'`);
  check(conf.ok, `[keep] D1 (${who}): the day-of "Confirm you'll be at the job" is never held by the ID (${conf.err ?? "ok"})`);
  const otw = await as(uid, `select public.helper_mark_on_the_way('${j}', 30.2, -92.0)`);
  const row = (await q(`select status::text s, helper_on_the_way_at from public.jobs where id='${j}'`))[0];
  check(!otw.ok && /identity_required_to_start/.test(otw.err) && row.s === "accepted" && row.helper_on_the_way_at === null,
    `[fix] S1 (${who}): On the way is refused until Stripe Identity, nothing written (${otw.err ?? "marked"}; ${JSON.stringify(row)})`);
  // mark_helper_arrival is a SECURITY DEFINER RPC the column whitelist lets
  // through; the whitelist is set aside for this one write to stand in for it.
  await q(`alter table public.jobs disable trigger trg_helper_jobs_column_whitelist`);
  const arr = await asRole(db, "postgres", uid, `update public.jobs set helper_arrived_at = now() where id = '${j}'`);
  await q(`alter table public.jobs enable trigger trg_helper_jobs_column_whitelist`);
  check(!arr.ok && /identity_required_to_start/.test(arr.err), `[fix] S2 (${who}): checking in is refused too (${arr.err ?? "written"})`);
  const st = await asRole(db, "postgres", uid, `update public.jobs set status = 'in_progress' where id = '${j}'`);
  check(!st.ok && /identity_required_to_start/.test(st.err), `[fix] S3 (${who}): moving the job to in progress is refused too (${st.err ?? "written"})`);
}
const jv = await booked(IDV);
await q(`update public.jobs set helper_dayof_confirmed_at = now() where id = '${jv}'`);
const otwV = await as(IDV, `select public.helper_mark_on_the_way('${jv}', 30.2, -92.0)`);
check(otwV.ok, `[keep] S4: an Identity-verified Helpr heads out (${otwV.err ?? "ok"})`);

// The POSTER's side is never held by the Helpr's ID (confirm/release run as the poster).
const jp = await booked(NOID);
const posterSide = await asRole(db, "postgres", POSTER, `update public.jobs set status = 'in_progress', helper_arrived_at = now() where id = '${jp}'`);
check(posterSide.ok, `[keep] S5: a write by the poster is never judged on the Helpr's ID (${posterSide.err ?? "ok"})`);
const sweep = await db.query(`update public.jobs set status = 'in_progress' where id = '${await booked(NOID)}'`).then(() => true, (e) => e.message);
check(sweep === true, `[keep] S6: a server sweep (no member) is untouched (${sweep})`);

// ---- heading out: crew member ----------------------------------------------
const crew = (await q(`insert into public.jobs (customer_id, title, status, payment_status, is_group_job, helpers_needed)
  values ('${POSTER}', 'Crew', 'accepted', 'escrow', true, 2) returning id`))[0].id;
await q(`insert into public.group_job_helpers (job_id, helper_id, slot_no, helper_confirmed_at) values
  ('${crew}', '${NOID}', 0, now()), ('${crew}', '${IDV}', 1, now())`);
const c1 = await as(NOID, `select public.rpc_group_member_on_the_way('${crew}', 30.2, -92.0)`);
check(!c1.ok && /identity_required_to_start/.test(c1.err), `[fix] C1: a crew member without Identity cannot head out (${c1.err ?? "marked"})`);
const c2 = await as(IDV, `select public.rpc_group_member_on_the_way('${crew}', 30.2, -92.0)`);
check(c2.ok, `[keep] C2: an Identity-verified crew member heads out (${c2.err ?? "ok"})`);

// ---- the one notice ---------------------------------------------------------
if (!SKIP) {
  const n = (await q(`select user_id::text u, count(*)::int c, max(message) m from public.notifications
    where title = 'Verify your ID with Stripe' group by 1 order by 1`));
  const who = new Set(n.map((r) => r.u));
  check(n.length === 2 && who.has(NOID) && who.has(POSTER) && n.every((r) => r.c === 1),
    `[fix] N1: exactly one notice each to the booked Helpr and the poster without Identity, across 3 replays (${JSON.stringify(n)})`);
  check(!who.has(IDV) && !who.has(TEST), `[fix] N2: never to an Identity-verified member or a test account`);
  check(n.every((r) => r.m === "Before your next job, verify your ID with Stripe. It takes about 2 minutes."),
    `[fix] N3: the plain, honest copy`);
} else {
  check(false, "[fix] N1-N3: the notice does not exist before the migration");
}

if (failures()) {
  console.log(`\n${failures()} check(s) FAILED${SKIP ? " (expected on the before state)" : ""}`);
  process.exit(1);
}
console.log("\nall checks passed");
