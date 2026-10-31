#!/usr/bin/env node
/**
 * PGlite proof for 20261031200034_declutter_payout_tries_restart (B24 10-31): a Declutter payout put back in the
 * queue (rebooked after a refund, or held for review and released) starts a fresh run of tries, so the payout run
 * offers it again.
 *
 *   node src/test/pglite/declutterPayoutTriesRestart.pglite.mjs                     # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPayoutTriesRestart.pglite.mjs  # RED: the newest bodies before it
 *
 * World: declutter_rebook_payout, admin_payout_release and declutter_payouts_due loaded from their NEWEST CREATE
 * (before this migration when skipped; this migration's own file otherwise, applied 3x), on tables with the columns
 * they read. Stubbed, and said so: has_role (a table of admins), declutter_payout_unsent (true: nothing sent),
 * declutter_consume_fee_debt (0: no fee debt), declutter_order_refunds_recorded_cents (0), declutter_sale_final
 * (true), shop_order_unaccounted_hand_refund (false). None of them decides the try count.
 * [fix] checks FAIL on the before state; [keep] checks pass in both.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261031200034_declutter_payout_tries_restart.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";

/** The newest CREATE of `name` in a migration up to `upTo` (exclusive unless `incl`), any dollar-quote tag. */
function newest(name, upTo, incl) {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (incl ? FILES[i] > upTo : FILES[i] >= upTo) continue;
    const src = readFileSync(MIG_DIR + FILES[i], "utf8");
    const start = src.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (start < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    return { file: FILES[i], sql: src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";" };
  }
  throw new Error(`${name}: no definition up to ${upTo}`);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

const ADMIN = "11111111-1111-1111-1111-111111111111";
const SELLER = "22222222-2222-2222-2222-222222222222";
const BUYER = "33333333-3333-3333-3333-333333333333";
const O1 = "a0000000-0000-4000-8000-000000000001";
const O2 = "a0000000-0000-4000-8000-000000000002";
const P_REBOOK = "b0000000-0000-4000-8000-000000000001";
const P_HELD = "b0000000-0000-4000-8000-000000000002";
const H_HELD = "c0000000-0000-4000-8000-000000000001";

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  create table public.admins (user_id uuid primary key);
  insert into public.admins values ('${ADMIN}');
  create function public.has_role(u uuid, r text) returns boolean language sql stable as
    $f$ select r = 'admin' and exists (select 1 from public.admins a where a.user_id = u) $f$;
  create table public.profiles (user_id uuid primary key, stripe_account_id text);
  insert into public.profiles values ('${SELLER}', 'acct_s');
  create table public.declutter_orders (id uuid primary key, buyer_id uuid, stripe_payment_intent_id text);
  insert into public.declutter_orders values ('${O1}', '${BUYER}', 'pi_1'), ('${O2}', '${BUYER}', 'pi_2');
  create table public.declutter_problems (order_id uuid, status text);
  create table public.declutter_refunds (id uuid primary key default gen_random_uuid(), order_id uuid, stripe_payment_intent_id text,
    reason text, status text, next_attempt_at timestamptz, attempts int default 0, review_reason text, review_held_at timestamptz);
  create table public.declutter_delivery_refunds (id uuid primary key, status text, next_attempt_at timestamptz,
    review_reason text, review_held_at timestamptz);
  create table public.declutter_payouts (id uuid primary key, order_id uuid, seller_id uuid, items_cents int, delivery_cents int,
    refunded_cents int default 0, debt_cents int default 0, amount_cents int, status text,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100), next_attempt_at timestamptz NOT NULL DEFAULT now(),
    review_reason text, review_held_at timestamptz);
  create table public.helpr_task_payouts (id uuid primary key, status text,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100), next_attempt_at timestamptz NOT NULL DEFAULT now(),
    review_reason text, review_held_at timestamptz);
  create table public.shop_orders (id uuid primary key, status text, close_reason text);
  create table public.shop_payouts (id uuid primary key, order_id uuid, status text, next_attempt_at timestamptz, attempts int,
    review_reason text, review_held_at timestamptz);
  create table public.shop_refunds (id uuid primary key, order_id uuid, status text, next_attempt_at timestamptz, attempts int,
    reversals int default 0, review_reason text, review_held_at timestamptz);
  create table public.shop_handovers (order_id uuid, problem_at timestamptz, confirmed_how text);
  create table public.payout_payee_waits (payout_kind text, payout_id uuid);
  create table public.admin_audit_log (admin_id uuid, action text, target_type text, target_id text, details jsonb);
  create table public.declutter_seller_fee_debts (id uuid primary key, seller_id uuid, remaining_cents int);
  create table public.declutter_fee_debt_deductions (debt_id uuid, payout_ref text, deducted_cents int);
  create function public.declutter_payout_unsent(p uuid) returns boolean language sql stable as $f$ select true $f$;
  create function public.declutter_consume_fee_debt(s uuid, r text, c int) returns int language sql as $f$ select 0 $f$;
  create function public.declutter_order_refunds_recorded_cents(o uuid) returns int language sql stable as $f$ select 0 $f$;
  create function public.declutter_sale_final(o uuid) returns boolean language sql stable as $f$ select true $f$;
  create function public.shop_order_unaccounted_hand_refund(o uuid) returns boolean language sql stable as $f$ select false $f$;
  -- Both payouts used all 12 tries; one is now rebooked after a refund, the other was held and is released.
  insert into public.declutter_payouts (id, order_id, seller_id, items_cents, delivery_cents, amount_cents, status, attempts, next_attempt_at)
    values ('${P_REBOOK}', '${O1}', '${SELLER}', 5000, 0, 5000, 'failed', 12, now() + interval '1 day'),
           ('${P_HELD}', '${O2}', '${SELLER}', 4000, 0, 4000, 'held_for_review', 12, now() + interval '1 day');
  insert into public.helpr_task_payouts (id, status, attempts, next_attempt_at)
    values ('${H_HELD}', 'held_for_review', 12, now() + interval '1 day');
`);

const NAMES = ["declutter_rebook_payout", "admin_payout_release", "declutter_payouts_due"];
const defs = NAMES.map((n) => newest(n, THIS, !SKIP));
for (const d of defs) console.log(`      loaded ${d.sql.slice(27, d.sql.indexOf("("))} from ${d.file}`);
if (SKIP) {
  for (const d of defs) await db.exec(d.sql);
  // The grants as their files set them.
  await db.exec(`REVOKE ALL ON FUNCTION public.declutter_rebook_payout(uuid, integer) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.declutter_rebook_payout(uuid, integer) TO service_role;
    REVOKE ALL ON FUNCTION public.admin_payout_release(text, uuid, text, boolean) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.admin_payout_release(text, uuid, text, boolean) TO authenticated, service_role;`);
} else {
  check(defs[0].file === THIS && defs[1].file === THIS, "[keep] both changed functions' newest CREATE is this migration");
  // Restated from the NEWEST CREATE before it: only the try-count lines differ.
  for (const n of NAMES.slice(0, 2)) {
    const strip = (s) => s.replace(/--[^\n]*/g, "").replace(/,\s*attempts = 0(, next_attempt_at = now\(\))?/g, "").replace(/\s+/g, " ");
    check(strip(newest(n, THIS, false).sql) === strip(newest(n, THIS, true).sql), `[keep] ${n}: restated from its newest CREATE, only attempts changed`);
  }
  const mig = readFileSync(MIG_DIR + THIS, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied three times
  await db.exec(defs[2].sql);
}

const asAdmin = async (sql) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${ADMIN}', false);`);
  try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { error: String(e.message) }; } finally { await db.exec("reset role;"); }
};
const row = async (t, id) => (await db.query(`select status, attempts, next_attempt_at <= now() as due_now from public.${t} where id = '${id}'`)).rows[0];
const offered = async () => (await db.query(`select payout_id from public.declutter_payouts_due(100)`)).rows.map((r) => r.payout_id);

check(!(await offered()).includes(P_REBOOK), "[keep] a payout at 12 tries is not offered");

// 1. Rebooked after a part refund.
await db.query(`select public.declutter_rebook_payout('${O1}'::uuid, 1000)`).catch((e) => check(false, `rebook threw ${e.message}`));
const r1 = await row("declutter_payouts", P_REBOOK);
check(r1.status === "pending", "[keep] rebooked: back to pending");
check(r1.attempts === 0, `[fix] rebooked: its tries restart at 0 (got ${r1.attempts})`);
check(r1.due_now === true, "[fix] rebooked: due now, not after the old back-off");
check(Number((await db.query(`select amount_cents from public.declutter_payouts where id = '${P_REBOOK}'`)).rows[0].amount_cents) === 4000,
  "[keep] rebooked: amount is items - refund (4000)");
check((await offered()).includes(P_REBOOK), "[fix] rebooked: the payout run offers it again");

// 2. Held for review, released by an admin.
const rel = await asAdmin(`select public.admin_payout_release('declutter', '${P_HELD}', 'payee fixed their account', true) as r`);
check(rel.rows?.[0]?.r?.result === "released", `[keep] release answers released ${rel.error ?? ""}`);
const r2 = await row("declutter_payouts", P_HELD);
check(r2.status === "pending", "[keep] released: back to pending");
check(r2.attempts === 0, `[fix] released Declutter payout: its tries restart at 0 (got ${r2.attempts})`);
check((await offered()).includes(P_HELD), "[fix] released Declutter payout: the payout run offers it again");
const relH = await asAdmin(`select public.admin_payout_release('helpr_task', '${H_HELD}', 'checked in Stripe', true) as r`);
check(relH.rows?.[0]?.r?.result === "released", "[keep] release of a Helpr payout answers released");
const r3 = await row("helpr_task_payouts", H_HELD);
check(r3.attempts === 0 && r3.status === "pending", `[fix] released Helpr payout: pending, tries restart at 0 (got ${r3.attempts})`);

// The guards around it are unchanged.
check(/admin_only/.test((await (async () => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${SELLER}', false);`);
  try { await db.query(`select public.admin_payout_release('declutter', '${P_HELD}', 'x', true)`); return ""; } catch (e) { return e.message; } finally { await db.exec("reset role;"); } })())),
  "[keep] a member cannot release");
check(/not_held_for_review/.test((await asAdmin(`select public.admin_payout_release('declutter', '${P_HELD}', 'again', true)`)).error ?? ""),
  "[keep] a row not held is refused");
const grants = (await db.query(`select has_function_privilege('anon', 'public.declutter_rebook_payout(uuid, integer)', 'execute') as a,
  has_function_privilege('authenticated', 'public.declutter_rebook_payout(uuid, integer)', 'execute') as m,
  has_function_privilege('anon', 'public.admin_payout_release(text, uuid, text, boolean)', 'execute') as r`)).rows[0];
check(!grants.a && !grants.m && !grants.r, "[keep] grants: rebook service_role only; release not anon");

console.log(failures ? `\n${failures} FAILED${SKIP ? " (expected: NEW_MIGRATION=skip is the before state)" : ""}` : "\nALL PASS");
process.exit(failures ? 1 : 0);
