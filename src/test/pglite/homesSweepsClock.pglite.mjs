/**
 * Q1424 (Homes leg) PGlite proof: rentals_rent_sweep and rentals_deposit_sweep on a fixed clock
 * (./lib/fixedClock.mjs, newest CREATE of each, with shop_local_today, their Louisiana "today", on the same clock).
 * homesRentTracker / homesDepositTracker move due dates and ended_at; this one moves the clock and reads each
 * edge 1 ms either side of a Louisiana midnight:
 *   rent row      written once the Louisiana date reaches due_on            (WHILE v_due <= v_today)
 *   reminder      3 days before the due date, from that Louisiana midnight  (v_next = v_today + 3)
 *   late fee      the day after due + grace days                            (due_on + grace_days < v_today)
 *   ended 90 d    an ended tenancy still gets late fees for 90 days         (ended_at > now - 90 days)
 *   deposit       due back one month after the Louisiana end date; "due soon" from 7 days before; overdue the day after
 * and both 2026 DST Sundays (8 Mar spring-forward, 1 Nov fall-back), where Louisiana midnight moves 05:00Z <-> 06:00Z.
 *
 *   node src/test/pglite/homesSweepsClock.pglite.mjs
 *   RENT_DUE_STRICT=1 ...        # RED: a rent row waits a day past its due date
 *   FEE_GRACE_LOOSE=1 ...        # RED: the late fee lands on the last grace day
 *   ENDED_90_LOOSE=1 ...         # RED: an ended tenancy exactly 90 days ago still gets a fee
 *   DEPOSIT_OVERDUE_LOOSE=1 ...  # RED: "overdue" on the due-back day itself
 *   DEPOSIT_SOON_STRICT=1 ...    # RED: "due soon" a day late
 *   LOCAL_DAY_UTC=1 ...          # RED: "today" read in UTC, not Louisiana time
 *   DEPOSIT_END_UTC=1 ...        # RED: the end date read in UTC, not Louisiana time
 *
 * The switch, ban and notify helpers (their own proofs) are stubbed. pglite is loaded from ~/.lh-pglite (CLAUDE.md).
 * Registered in src/test/clockFunctionsProven.test.ts.
 */
import os from "node:os";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
await installClock(db);
await db.exec(`
SET TIME ZONE 'UTC';
CREATE ROLE service_role;
CREATE ROLE authenticated;
CREATE ROLE anon;
CREATE TABLE public.profiles (user_id uuid, ban_status text, auto_suspended_until timestamptz);
CREATE TABLE public.rental_tenancies (
  id uuid PRIMARY KEY, tenant_id uuid, landlord_id uuid, status text, ended_at timestamptz, ended_by text, lease_ends_on date);
CREATE TABLE public.rental_rent_plans (
  tenancy_id uuid PRIMARY KEY, first_due_on date, frequency text DEFAULT 'monthly', amount_cents bigint DEFAULT 100000,
  late_fee_cents bigint DEFAULT 5000, grace_days int DEFAULT 3, reminded_for date);
CREATE TABLE public.rental_rent_sweep_skips (tenancy_id uuid PRIMARY KEY, periods jsonb, updated_at timestamptz);
CREATE TABLE public.rental_rent_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenancy_id uuid, kind text, due_on date, amount_cents bigint,
  late_fee_cents bigint DEFAULT 0, grace_days int DEFAULT 0, rent_charge_id uuid, waived_at timestamptz, on_time_at timestamptz);
CREATE UNIQUE INDEX ON public.rental_rent_charges (tenancy_id, due_on) WHERE kind = 'rent';
CREATE UNIQUE INDEX ON public.rental_rent_charges (rent_charge_id) WHERE kind = 'late_fee';
CREATE TABLE public.rental_rent_payments (
  tenancy_id uuid, status text, amount_cents bigint, paid_on date, reported_by text, created_at timestamptz);
CREATE TABLE public.rental_deposits (
  tenancy_id uuid PRIMARY KEY, amount_cents bigint, reminded_stage smallint DEFAULT 0, settled_at timestamptz,
  forwarding_address text, address_shared_noticed_at timestamptz, updated_at timestamptz);
CREATE TABLE public.sent (title text, body text);
CREATE FUNCTION public.feature_enabled_for_user(k text, u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.rentals_notify(p_user uuid, p_title text, p_body text, p_link text, p_push boolean) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.sent VALUES (p_title, p_body) $$;
`);

const mutations = {
  RENT_DUE_STRICT: ["rentals_rent_sweep", "WHILE v_due <= v_today LOOP", "WHILE v_due < v_today LOOP"],
  FEE_GRACE_LOOSE: ["rentals_rent_sweep", "AND c.due_on + c.grace_days < v_today", "AND c.due_on + c.grace_days <= v_today"],
  ENDED_90_LOOSE: ["rentals_rent_sweep", "t.ended_at > public._probe_now() - interval '90 days'", "t.ended_at >= public._probe_now() - interval '90 days'"],
  DEPOSIT_OVERDUE_LOOSE: ["rentals_deposit_sweep", "WHEN v_today > v_due THEN 3", "WHEN v_today >= v_due THEN 3"],
  DEPOSIT_SOON_STRICT: ["rentals_deposit_sweep", "WHEN v_today >= v_due - 7 THEN 2", "WHEN v_today > v_due - 7 THEN 2"],
  LOCAL_DAY_UTC: ["shop_local_today", "AT TIME ZONE 'America/Chicago'", "AT TIME ZONE 'UTC'"],
  DEPOSIT_END_UTC: ["rentals_deposit_sweep", "(v.ended_at AT TIME ZONE 'America/Chicago')::date", "(v.ended_at AT TIME ZONE 'UTC')::date"],
};
// Loaded by name, in dependency order: the sweeps call shop_local_today and rentals_rent_next_due.
const LOADED = {
  shop_local_today: newestFunction("shop_local_today"),
  rentals_rent_next_due: newestFunction("rentals_rent_next_due"),
  rentals_rent_sweep: newestFunction("rentals_rent_sweep"),
  rentals_deposit_sweep: newestFunction("rentals_deposit_sweep"),
};
for (const [fn, { file, stmt }] of Object.entries(LOADED)) {
  const base = onFixedClock(stmt);
  let fixed = base;
  if (/now|current_|localtimestamp/i.test(stmt.replace(/\$fn\$[\s\S]*?\$fn\$/, ""))) throw new Error(`${fn}: a clock read outside the body`);
  check(`${fn}: every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)|\bcurrent_timestamp\b|\bcurrent_date\b/i.test(fixed));
  for (const [env, [target, from, to]] of Object.entries(mutations)) {
    if (target !== fn || !process.env[env]) continue;
    console.log(`${env}=1 (expect FAILs)`);
    check(`${env}: the text to change is in the newest ${fn}`, fixed.includes(from));
    fixed = fixed.replace(from, to);
  }
  // Replay-safe: applies 3x.
  for (let i = 0; i < 3; i++) await db.exec(fixed);
}

const T = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const LANDLORD = "33333333-3333-4333-8333-333333333333";
const iso = (ms) => new Date(ms).toISOString();
const D = 24 * 3_600_000;

const reset = async () => {
  await db.exec(`DELETE FROM public.sent; DELETE FROM public.rental_rent_charges; DELETE FROM public.rental_rent_plans;
    DELETE FROM public.rental_rent_sweep_skips; DELETE FROM public.rental_rent_payments; DELETE FROM public.rental_deposits;
    DELETE FROM public.rental_tenancies;`);
};
const tenancy = async ({ status = "active", endedAt = null } = {}) =>
  q(`INSERT INTO public.rental_tenancies (id, tenant_id, landlord_id, status, ended_at, ended_by) VALUES ($1, $2, $3, $4, $5, 'landlord')`,
    [T, TENANT, LANDLORD, status, endedAt == null ? null : iso(endedAt)]);
const plan = async (firstDue, extra = {}) =>
  q(`INSERT INTO public.rental_rent_plans (tenancy_id, first_due_on, grace_days) VALUES ($1, $2, $3)`, [T, firstDue, extra.grace ?? 3]);
const rentSweep = async (nowMs) => {
  await setClock(db, iso(nowMs));
  await db.exec(`DELETE FROM public.sent;`);
  const r = (await q(`SELECT public.rentals_rent_sweep() AS r`))[0].r;
  const sent = (await q(`SELECT title, body FROM public.sent`)).map((x) => `${x.title}: ${x.body}`);
  return { ...r, sent };
};
const depositSweep = async (nowMs) => {
  await setClock(db, iso(nowMs));
  await db.exec(`DELETE FROM public.sent;`);
  const r = (await q(`SELECT public.rentals_deposit_sweep() AS r`))[0].r;
  const [{ stage }] = await q(`SELECT reminded_stage AS stage FROM public.rental_deposits WHERE tenancy_id = $1`, [T]);
  const sent = (await q(`SELECT title, body FROM public.sent`)).map((x) => `${x.title}: ${x.body}`);
  return { reminders: r.reminders, stage, sent };
};

// Louisiana midnights (CDT = UTC-5, CST = UTC-6).
const CDT_MIDNIGHT = (y, m, d) => Date.UTC(y, m - 1, d, 5, 0, 0);
const CST_MIDNIGHT = (y, m, d) => Date.UTC(y, m - 1, d, 6, 0, 0);

// 1. Rent row: due 15 July, written from Louisiana midnight (05:00Z), not 1 ms before.
{
  await reset(); await tenancy(); await plan("2026-07-15");
  const before = await rentSweep(CDT_MIDNIGHT(2026, 7, 15) - 1);
  check("rent due 15 July, 11:59:59.999 PM on the 14th in Louisiana: no rent row yet", before.rent_rows === 0, JSON.stringify(before));
  const at = await rentSweep(CDT_MIDNIGHT(2026, 7, 15));
  check("rent due 15 July, Louisiana midnight: the rent row is written, and 'due today' is sent",
    at.rent_rows === 1 && at.sent.includes("Rent reminder: Rent is due today."), JSON.stringify(at));
}
// 2. Reminder 3 days before (12 July), from that Louisiana midnight.
{
  await reset(); await tenancy(); await plan("2026-07-15");
  const before = await rentSweep(CDT_MIDNIGHT(2026, 7, 12) - 1);
  check("3 days before, 1 ms short of the Louisiana midnight: no reminder", before.reminders === 0, JSON.stringify(before));
  const at = await rentSweep(CDT_MIDNIGHT(2026, 7, 12));
  check("3 days before, at the Louisiana midnight: one reminder naming the due day",
    at.reminders === 1 && at.sent[0] === "Rent reminder: Rent is due Wednesday, Jul 15.", JSON.stringify(at));
}
// 3. Late fee: due 15 July + 3 grace days, so from Louisiana midnight on 19 July.
{
  await reset(); await tenancy(); await plan("2026-07-15");
  const before = await rentSweep(CDT_MIDNIGHT(2026, 7, 19) - 1);
  check("last grace day (18 July), 1 ms before midnight: no late fee", before.late_fees === 0, JSON.stringify(before));
  const at = await rentSweep(CDT_MIDNIGHT(2026, 7, 19));
  check("19 July, Louisiana midnight: the late fee is added and the tenant told",
    at.late_fees === 1 && at.sent.includes("Late fee added: Rent due Jul 15 is still open, so the late fee in your rent schedule was added."), JSON.stringify(at));
}
// 4. An ended tenancy keeps getting late fees for 90 days after it ended, and not one ms more.
{
  const N = CDT_MIDNIGHT(2026, 7, 19) + 15 * 3_600_000;
  const seedEnded = async (endedAt) => {
    await reset(); await tenancy({ status: "ended", endedAt }); await plan("2026-04-01");
    await q(`INSERT INTO public.rental_rent_charges (tenancy_id, kind, due_on, amount_cents, late_fee_cents, grace_days)
             VALUES ($1, 'rent', '2026-04-01', 100000, 5000, 3)`, [T]);
  };
  await seedEnded(N - 90 * D);
  const at = await rentSweep(N);
  check("ended exactly 90 days ago: no late fee (out of the window)", at.late_fees === 0, JSON.stringify(at));
  await seedEnded(N - 90 * D + 1);
  const inside = await rentSweep(N);
  check("ended 90 days minus 1 ms ago: the late fee is still added", inside.late_fees === 1, JSON.stringify(inside));
  check("an ended tenancy never gets a new rent row or a reminder", inside.rent_rows === 0 && inside.reminders === 0, JSON.stringify(inside));
}
// 5. Both DST Sundays: Louisiana midnight is 05:00Z in CDT and 06:00Z in CST.
{
  await reset(); await tenancy(); await plan("2026-03-09");
  const before = await rentSweep(CDT_MIDNIGHT(2026, 3, 9) - 1);
  const at = await rentSweep(CDT_MIDNIGHT(2026, 3, 9));
  check("spring-forward (8 Mar): rent due 9 Mar is written at 05:00Z (CDT midnight), not 1 ms before",
    before.rent_rows === 0 && at.rent_rows === 1, JSON.stringify([before.rent_rows, at.rent_rows]));
  await reset(); await tenancy(); await plan("2026-11-02");
  const b2 = await rentSweep(CST_MIDNIGHT(2026, 11, 2) - 1);
  const a2 = await rentSweep(CST_MIDNIGHT(2026, 11, 2));
  check("fall-back (1 Nov): rent due 2 Nov waits until 06:00Z (CST midnight), not 05:00Z",
    b2.rent_rows === 0 && a2.rent_rows === 1, JSON.stringify([b2.rent_rows, a2.rent_rows]));
}

// 6. Deposit: ended 30 June (Louisiana), due back 30 July; "due soon" from 23 July; overdue from 31 July.
const seedDeposit = async (endedAt) => {
  await reset(); await tenancy({ status: "ended", endedAt });
  await q(`INSERT INTO public.rental_deposits (tenancy_id, amount_cents) VALUES ($1, 120000)`, [T]);
};
{
  const ENDED = Date.UTC(2026, 5, 30, 15, 0, 0);
  await seedDeposit(ENDED);
  const first = await depositSweep(ENDED + 3_600_000);
  check("tenancy ended: the landlord is told the one-month date (Jul 30)",
    first.stage === 1 && first.sent[0]?.includes("until Jul 30,"), JSON.stringify(first));
  const b = await depositSweep(CDT_MIDNIGHT(2026, 7, 23) - 1);
  check("8 days before, 1 ms short of Louisiana midnight: not 'due soon' yet", b.stage === 1 && b.reminders === 0, JSON.stringify(b));
  const s = await depositSweep(CDT_MIDNIGHT(2026, 7, 23));
  check("7 days before (23 July), Louisiana midnight: 'Deposit return due soon'", s.stage === 2 && s.sent[0]?.startsWith("Deposit return due soon:"), JSON.stringify(s));
  const b3 = await depositSweep(CDT_MIDNIGHT(2026, 7, 31) - 1);
  check("the due-back day itself (30 July), last ms: not overdue", b3.stage === 2 && b3.reminders === 0, JSON.stringify(b3));
  const o = await depositSweep(CDT_MIDNIGHT(2026, 7, 31));
  check("31 July, Louisiana midnight: 'Deposit return is overdue', naming Jul 30",
    o.stage === 3 && o.sent[0] === "Deposit return is overdue: The deposit ($1,200.00) was due back by Jul 30. Louisiana law can make a landlord pay more for a late return. Record it under Homes.",
    JSON.stringify(o));
}
{
  // The end date is the Louisiana date: 11:59:59.999 PM on 30 June ends on the 30th, midnight ends on 1 July.
  await seedDeposit(CDT_MIDNIGHT(2026, 7, 1) - 1);
  const late = await depositSweep(CDT_MIDNIGHT(2026, 7, 1));
  check("ended 11:59:59.999 PM 30 June in Louisiana: due back Jul 30", late.sent[0]?.includes("until Jul 30,"), JSON.stringify(late));
  await seedDeposit(CDT_MIDNIGHT(2026, 7, 1));
  const next = await depositSweep(CDT_MIDNIGHT(2026, 7, 1) + 1);
  check("ended at Louisiana midnight 1 July: due back Aug 1", next.sent[0]?.includes("until Aug 1,"), JSON.stringify(next));
}
{
  // Fall-back: ended 1 Oct, due back 1 Nov (the DST Sunday); overdue from CST midnight 2 Nov (06:00Z), not 05:00Z.
  await seedDeposit(Date.UTC(2026, 9, 1, 15, 0, 0));
  await depositSweep(Date.UTC(2026, 9, 1, 16, 0, 0));
  const b = await depositSweep(CST_MIDNIGHT(2026, 11, 2) - 1);
  const o = await depositSweep(CST_MIDNIGHT(2026, 11, 2));
  check("fall-back: due back 1 Nov, overdue from 06:00Z on 2 Nov (CST midnight), not 1 ms before",
    b.stage === 2 && o.stage === 3, JSON.stringify([b.stage, o.stage]));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
