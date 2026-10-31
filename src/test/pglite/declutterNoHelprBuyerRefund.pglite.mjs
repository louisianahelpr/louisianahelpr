#!/usr/bin/env node
/**
 * PGlite proof for 20261031133938_declutter_no_helpr_buyer_refund.sql (BUY-2, owner 10-31): when no Helpr took a
 * delivery, the buyer may cancel for a refund, and the BUYER bears the card fee.
 *
 *   node src/test/pglite/declutterNoHelprBuyerRefund.pglite.mjs                  # applies the migration 3x
 *   NEW_MIGRATION=skip node src/test/pglite/declutterNoHelprBuyerRefund.pglite.mjs # RED: the functions don't exist
 *   MUTANT=<name> node src/test/pglite/declutterNoHelprBuyerRefund.pglite.mjs    # a planted defect: must FAIL
 *
 * World: the columns the new functions read. REAL bodies (newest CREATE in the migrations before this one):
 * declutter_record_refund (the money: policy, card fee kept), declutter_delivery_reserved_cents,
 * declutter_card_fee_estimate. Stubbed, and said so: declutter_close_paid_order (records its arguments, marks the
 * order refunded and calls the REAL declutter_record_refund with the same sums the real one passes:
 * total - reserved, card_fee_cents), declutter_notify, declutter_order_items_named, declutter_lock_order (SELECT ...
 * FOR UPDATE), declutter_order_side, is_caller_banned (a table), declutter_refund_answer, auth.uid() (a setting).
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = "20261031133938_declutter_no_helpr_buyer_refund.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The cancel no longer leaves the card fee with the buyer (reason with a full refund paid by us).
  fee: ["declutter_close_paid_order(o.id, 'buyer_cancelled', NULL, NULL, NULL)", "declutter_close_paid_order(o.id, 'order_closed', NULL, NULL, NULL)"],
  // A booked pickup no longer stops the cancel.
  booked: ["RETURN 'pickup_booked';", "NULL;"],
  // Any pickup order (not one no Helpr took) can be cancelled.
  anyorder: ["OR NOT EXISTS (SELECT 1 FROM public.declutter_delivery_refunds d WHERE d.order_id = o.id AND d.reason = 'no_helpr') THEN", "THEN"],
  // The seller may cancel too.
  side: ["IF v_side <> 'buyer' THEN\n    RAISE EXCEPTION 'wrong_side'", "IF false THEN\n    RAISE EXCEPTION 'wrong_side'"],
};
const skip = process.env.NEW_MIGRATION === "skip";
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replaceAll(m[0], m[1]);
}

/** The newest CREATE FUNCTION text for `name` in migrations strictly before `before` (any dollar tag). */
function newestBefore(name, before) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "gi");
    let m;
    while ((m = re.exec(sql))) {
      const as = /\bAS\s+(\$\w*\$)/g;
      as.lastIndex = m.index;
      const t = as.exec(sql);
      const end = sql.indexOf(t[1], t.index + t[0].length);
      found = `${sql.slice(m.index, end + t[1].length)};`;
    }
  }
  if (!found) throw new Error(`no definition of ${name}`);
  return found;
}

let failures = 0;
const check = (ok, name, got = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${got})`}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), BUYER = U(2), STRANGER = U(3), BANNED = U(4);
const O = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('test.uid', true), '')::uuid $f$;
  create table public.banned (user_id uuid primary key);
  create function public.is_caller_banned() returns boolean language sql stable as $f$ select exists (select 1 from public.banned where user_id = auth.uid()) $f$;
  create table public.notes (user_id uuid, kind text, title text, message text, link text, actor uuid);
  create function public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_actor uuid default null)
    returns void language sql as $f$ insert into public.notes values (p_user, p_type, p_title, p_message, p_link, p_actor) $f$;
  create function public.declutter_order_items_named(p uuid) returns text language sql as $f$ select 'the lamp' $f$;
  create table public.declutter_orders (id uuid primary key, buyer_id uuid, seller_id uuid, status text, handover text,
    paid_with text default 'card', stripe_payment_intent_id text, total_cents integer, items_cents integer, premium_cents integer default 0,
    tax_cents integer default 0, delivery_cents integer, card_fee_cents integer, paid_at timestamptz default now(), close_reason text, closed_at timestamptz);
  create function public.declutter_lock_order(p uuid) returns public.declutter_orders language plpgsql as $f$
    declare o public.declutter_orders; begin select * into o from public.declutter_orders where id = p for update;
    if o.id is null then raise exception 'item_not_found' using errcode = 'P0002'; end if; return o; end $f$;
  create function public.declutter_order_side(b uuid, s uuid, u uuid) returns text language sql immutable as $f$
    select case when u = b then 'buyer' when u = s then 'seller' end $f$;
  create table public.declutter_delivery_refunds (order_id uuid unique, stripe_payment_intent_id text, reason text, refund_cents integer);
  create table public.declutter_order_deliveries (order_id uuid, task_id uuid);
  create table public.helpr_tasks (id uuid primary key, status text);
  create table public.declutter_problems (order_id uuid, status text);
  create table public.declutter_bookings (order_id uuid primary key, slot_start timestamptz);
  create table public.declutter_handovers (order_id uuid primary key, seller_confirmed_at timestamptz, picked_up_at timestamptz, confirmed_at timestamptz);
  create table public.declutter_payouts (order_id uuid);
  create table public.declutter_seller_fee_debts (seller_id uuid, refund_id uuid unique, amount_cents integer, remaining_cents integer);
  create table public.declutter_refunds (id uuid primary key default gen_random_uuid(), order_id uuid, stripe_payment_intent_id text unique,
    reason text, fee_policy text, paid_cents integer, card_fee_cents integer, kept_cents integer, refund_cents integer);
  create table public.closes (order_id uuid, reason text, strike_side text);
  create function public.declutter_refund_answer(p uuid) returns jsonb language sql as $f$ select jsonb_build_object('result', 'refunding', 'refund_id', p) $f$;
`);
for (const fn of ["declutter_card_fee_estimate", "declutter_delivery_reserved_cents", "declutter_record_refund"]) {
  await db.exec(newestBefore(fn, THIS));
}
// The close, stubbed to the two lines of the real one that decide the money (20261027170717).
await db.exec(`
  create function public.declutter_close_paid_order(p_order_id uuid, p_reason text, p_strike_side text, p_strike_reason text, p_why text)
  returns jsonb language plpgsql as $f$
  declare o public.declutter_orders; v uuid; begin
    select * into o from public.declutter_orders where id = p_order_id;
    insert into public.closes values (o.id, p_reason, p_strike_side);
    v := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, p_reason,
           o.total_cents - public.declutter_delivery_reserved_cents(o.id), o.card_fee_cents);
    update public.declutter_orders set status = 'refunded', close_reason = 'refunded', closed_at = now() where id = o.id;
    return public.declutter_refund_answer(v); end $f$;
`);

async function as(uid, sql, params = []) {
  await db.query(`select set_config('test.uid', $1, false)`, [uid ?? ""]);
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: e.message }; }
}
// 1: no Helpr took it (fee back, switched to pickup_home). 2: a plain pickup order. 3: no Helpr, pickup booked.
// 4: no Helpr, problem open. 5: no Helpr, banned buyer. 6: no Helpr, handed over.
async function reset() {
  await db.exec(`truncate public.declutter_orders, public.declutter_delivery_refunds, public.declutter_problems, public.declutter_bookings,
    public.declutter_handovers, public.declutter_payouts, public.declutter_refunds, public.closes, public.notes, public.banned;`);
  for (let n = 1; n <= 6; n++) {
    await db.query(`insert into public.declutter_orders (id, buyer_id, seller_id, status, handover, stripe_payment_intent_id, total_cents, items_cents, delivery_cents, card_fee_cents)
      values ($1, $2, $3, 'paid', 'pickup_home', $4, 6300, 4000, 1800, 213)`, [O(n), n === 5 ? BANNED : BUYER, SELLER, `pi_${n}`]);
    if (n !== 2) await db.query(`insert into public.declutter_delivery_refunds values ($1, $2, 'no_helpr', 1800)`, [O(n), `pi_${n}`]);
  }
  await db.exec(`insert into public.declutter_bookings values ('${O(3)}', now() + interval '1 day');
    insert into public.declutter_problems values ('${O(4)}', 'open');
    insert into public.banned values ('${BANNED}');
    insert into public.declutter_handovers (order_id, seller_confirmed_at) values ('${O(6)}', now());`);
}

if (skip) {
  await reset();
  const r = await as(BUYER, `select public.declutter_no_helpr_choice($1) c`, [O(1)]);
  check(!r.error, "[skip] declutter_no_helpr_choice exists", r.error);
} else {
  for (let pass = 1; pass <= 3; pass++) {
    await db.exec(mig);
    await reset();
    const P = `[apply ${pass}]`;
    const choice = (uid, n) => as(uid, `select public.declutter_no_helpr_choice($1) c`, [O(n)]);
    const cancel = (uid, n) => as(uid, `select public.declutter_cancel_after_no_helpr($1) c`, [O(n)]);

    const c1 = (await choice(BUYER, 1)).rows?.[0]?.c;
    check(c1?.refund_cents === 6300 - 1800 - 213 && c1?.card_fee_cents === 213 && c1?.delivery_refunded_cents === 1800,
      `${P} the buyer's read: $42.87 back, the $2.13 card fee kept, the $18 delivery fee already refunded`, JSON.stringify(c1));
    check((await choice(SELLER, 1)).rows?.[0]?.c == null, `${P} the seller reads nothing`);
    check((await choice(STRANGER, 1)).rows?.[0]?.c == null, `${P} a stranger reads nothing`);
    check((await choice(BUYER, 2)).rows?.[0]?.c == null, `${P} a plain pickup order (no Helpr refund) offers no cancel`);
    check((await choice(BUYER, 3)).rows?.[0]?.c == null, `${P} a booked pickup offers no cancel`);
    check((await choice(BUYER, 4)).rows?.[0]?.c == null, `${P} an open problem offers no cancel`);
    check((await choice(BUYER, 6)).rows?.[0]?.c == null, `${P} a handed-over order offers no cancel`);

    check(/wrong_side/.test((await cancel(SELLER, 1)).error ?? ""), `${P} the seller can't cancel`);
    check(/item_not_found/.test((await cancel(STRANGER, 1)).error ?? ""), `${P} a stranger learns nothing`);
    check(/not_authenticated/.test((await cancel(null, 1)).error ?? ""), `${P} signed out: refused`);
    check(/not_a_no_helpr_order/.test((await cancel(BUYER, 2)).error ?? ""), `${P} a plain pickup order: refused`);
    check(/pickup_booked/.test((await cancel(BUYER, 3)).error ?? ""), `${P} a booked pickup: refused`);
    check(/problem_open/.test((await cancel(BUYER, 4)).error ?? ""), `${P} an open problem: refused`);
    check(/account_restricted/.test((await cancel(BANNED, 5)).error ?? ""), `${P} a banned buyer: refused`);
    check(/not_a_no_helpr_order/.test((await cancel(BUYER, 6)).error ?? ""), `${P} handed over: refused`);
    check((await db.query(`select count(*)::int n from public.declutter_refunds`)).rows[0].n === 0, `${P} no refusal moved money`);

    const ok = await cancel(BUYER, 1);
    check(ok.rows?.[0]?.c?.result === "refunding", `${P} the buyer's cancel goes through`, JSON.stringify(ok));
    const rf = (await db.query(`select reason, fee_policy, paid_cents, card_fee_cents, refund_cents from public.declutter_refunds where order_id = $1`, [O(1)])).rows[0];
    check(rf?.reason === "buyer_cancelled" && rf?.fee_policy === "keep_card_fee", `${P} refund policy: the buyer bears the card fee`, JSON.stringify(rf));
    check(rf?.refund_cents === c1?.refund_cents && rf?.card_fee_cents === c1?.card_fee_cents, `${P} the read's sums are the refund's sums`, JSON.stringify(rf));
    const cl = (await db.query(`select reason, strike_side from public.closes where order_id = $1`, [O(1)])).rows;
    check(cl.length === 1 && cl[0].strike_side === null, `${P} closed once, no strike`, JSON.stringify(cl));
    check((await db.query(`select status from public.declutter_orders where id = $1`, [O(1)])).rows[0].status === "refunded", `${P} the order is refunded`);
    check((await cancel(BUYER, 1)).rows?.[0]?.c?.result === "already", `${P} a second tap answers the same`);
    check((await db.query(`select count(*)::int n from public.closes`)).rows[0].n === 1, `${P} a second tap moves no money`);
    check((await choice(BUYER, 1)).rows?.[0]?.c == null, `${P} after the cancel the read offers nothing`);
    const acl = (await db.query(`select proname, has_function_privilege('anon', oid, 'execute') a, has_function_privilege('authenticated', oid, 'execute') u
      from pg_proc where proname in ('declutter_no_helpr_refusal', 'declutter_no_helpr_choice', 'declutter_cancel_after_no_helpr') order by proname`)).rows;
    check(acl.length === 3 && acl.every((r) => !r.a) && acl.find((r) => r.proname === "declutter_no_helpr_refusal")?.u === false
      && acl.filter((r) => r.proname !== "declutter_no_helpr_refusal").every((r) => r.u), `${P} grants: anon none; the rule is internal`, JSON.stringify(acl));
  }
}
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
