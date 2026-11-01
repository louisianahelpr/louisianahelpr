#!/usr/bin/env node
/**
 * PGlite proof for *_declutter_manager_share_split (manager mode phase 2, the money split; lead plan + additions 11-01).
 *
 *   npx tsx src/test/pglite/declutterManagerShareSplit.pglite.mjs              # the migration applied 3x
 *   NEW_MIGRATION=skip npx tsx src/test/pglite/declutterManagerShareSplit.pglite.mjs   # RED: no split
 *   PLANT=<name> npx tsx ...   # planted defects, each must FAIL its check (see PLANTS below)
 *
 * World: the tables the path reads (real columns and the real payout CHECKs), the NEWEST real bodies of
 * declutter_consume_fee_debt, declutter_order_items_named and declutter_manager_first_name, then this migration
 * verbatim (it restates declutter_complete_handover, declutter_rebook_payout, declutter_payout_unsent). Stubs, said
 * so: declutter_notify (records), declutter_new_handover_code, declutter_setup_fee_from_payout_cents (0),
 * declutter_delivery_tip_open (false), declutter_sale_final (a table), declutter_order_refunds_recorded_cents (0).
 * Pickup orders only (the delivery branch is unchanged and never reached).
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILE = readdirSync(DIR).find((f) => f.endsWith("_declutter_manager_share_split.sql"));
const SKIP = process.env.NEW_MIGRATION === "skip";
const PLANT = process.env.PLANT ?? "";
const PLANTS = {
  // the share is taken AFTER the debt (a debt reduces the manager's share's base): the debt-order check fails
  debt_first: ["o.items_cents + v_rate - v_share);", "o.items_cents + v_rate);"],
  // a flat share is not capped at the sale price
  no_cap: ["                        o.items_cents)::integer", "                        1000000000)::integer"],
  // the trigger re-fires on a second 'paid' write
  refire: ["IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid'", "IF NEW.status = 'paid'"],
  // a refund does not cut the manager's share
  no_cut: ["       SET amount_cents = v_share, status = CASE WHEN v_share = 0", "       SET amount_cents = amount_cents, status = CASE WHEN amount_cents = 0"],
  // the manager row is offered while the seller's row is held for review
  ignore_hold: ["AND sp.review_held_at IS NULL", ""],
};
let FIX = readFileSync(DIR + FILE, "utf8");
if (PLANT) {
  const [find, repl] = PLANTS[PLANT] ?? [];
  if (!find || !FIX.includes(find)) throw new Error(`PLANT=${PLANT}: not found in the migration`);
  FIX = FIX.replace(find, repl);
  console.log(`PLANT=${PLANT}: planted`);
}
if (SKIP) console.log("NEW_MIGRATION=skip: the newest bodies before this migration (expect FAILs)");

const DEFS = effectiveDefs(DIR, SKIP ? { before: FILE } : {});
const real = (n) => {
  const d = DEFS.get(n);
  if (!d) throw new Error(`no definition of ${n}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  return `${d.stmt.slice(0, d.stmt.indexOf(open[1], open.index + open[0].length) + open[1].length)};`;
};

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const K = U(1), M = U(2), B = U(3), M2 = U(4);

const WORLD = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  insert into auth.users values ('${K}'), ('${M}'), ('${B}'), ('${M2}');
  create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create table public.profiles (user_id uuid primary key, full_name text, stripe_account_id text);
  insert into public.profiles values ('${K}', 'Kaci Lombas', 'acct_k'), ('${M}', 'Dana Helper', 'acct_m'), ('${B}', 'Ben Buyer', null), ('${M2}', 'Remy New', null);
  create table public.user_blocks (blocker_id uuid, blocked_id uuid);
  create table public.declutter_items (id uuid primary key default gen_random_uuid(), title text not null, status text not null default 'sold', updated_at timestamptz);
  create table public.declutter_orders (id uuid primary key default gen_random_uuid(), buyer_id uuid, seller_id uuid,
    status text not null default 'awaiting_payment', handover text not null default 'pickup_home', items_cents integer not null,
    delivery_cents integer not null default 0, paid_with text not null default 'card', stripe_payment_intent_id text default 'pi_1',
    close_reason text, handed_over_at timestamptz, closed_at timestamptz);
  create table public.declutter_cart_items (id uuid primary key default gen_random_uuid(), item_id uuid, order_id uuid,
    status text not null default 'in_cart', created_at timestamptz not null default now());
  create table public.declutter_handovers (order_id uuid primary key, code text, confirmed_at timestamptz, confirmed_by text);
  create table public.declutter_problems (order_id uuid, status text);
  create table public.declutter_refunds (order_id uuid, stripe_payment_intent_id text, reason text, status text);
  create table public.declutter_seller_fee_debts (id uuid primary key default gen_random_uuid(), seller_id uuid, refund_id uuid,
    amount_cents integer, remaining_cents integer, created_at timestamptz not null default now());
  create table public.declutter_fee_debt_deductions (debt_id uuid, payout_ref text, deducted_cents integer);
  create table public.payout_send_marks (payout_kind text, payout_id uuid);
  create table public.admin_audit_log (action text, target_type text, target_id text);
  create table public.declutter_manager_grants (id uuid primary key default gen_random_uuid(), seller_id uuid, manager_id uuid,
    status text not null, share_type text not null, share_pct integer, share_cents integer);
  create table public.declutter_payouts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE REFERENCES public.declutter_orders(id),
    seller_id uuid, items_cents integer NOT NULL CHECK (items_cents > 0), debt_cents integer NOT NULL CHECK (debt_cents >= 0),
    amount_cents integer NOT NULL, status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'nothing_due')),
    stripe_transfer_id text, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
    refunded_cents integer NOT NULL DEFAULT 0, delivery_cents integer NOT NULL DEFAULT 0, setup_fee_cents integer NOT NULL DEFAULT 0,
    review_held_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), executed_at timestamptz, last_error text,
    CONSTRAINT declutter_payouts_amount CHECK (amount_cents = items_cents + delivery_cents - refunded_cents - debt_cents AND amount_cents >= 0),
    CONSTRAINT declutter_payouts_nothing_due CHECK ((status = 'nothing_due') = (amount_cents = 0)));
  -- The delivery branch's types (never reached: pickup orders only).
  create table public.helpr_tasks (id uuid primary key, status text, stuck_stage text);
  create table public.declutter_order_deliveries (order_id uuid, task_id uuid);
  create table public.notices (user_id uuid, title text, body text);
  create function public.declutter_notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_actor uuid default null)
    returns void language sql as $f$ insert into public.notices values (p_user, p_title, p_body) $f$;
  create function public.declutter_new_handover_code() returns text language sql as $f$ select '1234' $f$;
  create function public.declutter_setup_fee_from_payout_cents(uuid) returns integer language sql as $f$ select 0 $f$;
  create function public.declutter_delivery_tip_open(uuid) returns boolean language sql as $f$ select false $f$;
  create table public.t_final (order_id uuid primary key);
  create function public.declutter_sale_final(p uuid) returns boolean language sql stable as $f$ select exists (select 1 from public.t_final where order_id = p) $f$;
  create function public.declutter_order_refunds_recorded_cents(uuid) returns integer language sql as $f$ select 0 $f$;
  create function public.has_role(uuid, text) returns boolean language sql as $f$ select false $f$;
  ${real("declutter_consume_fee_debt")}
  ${real("declutter_order_items_named")}
  ${real("declutter_manager_first_name")}
`;
const db = new PGlite();
await db.exec(WORLD);
if (SKIP) {
  for (const n of ["declutter_complete_handover", "declutter_rebook_payout", "declutter_payout_unsent"]) await db.exec(real(n));
} else {
  for (let i = 0; i < 3; i++) await db.exec(FIX);
  console.log(`applied ${FILE} 3x`);
}
const one = async (sql) => {
  try {
    return (await db.query(sql)).rows[0];
  } catch (e) {
    // NEW_MIGRATION=skip: the split's tables and functions don't exist; the check reading them FAILs on undefined.
    if (SKIP) return { error: String(e.message).split("\n")[0] };
    throw e;
  }
};
const all = async (sql) => {
  try {
    return (await db.query(sql)).rows;
  } catch (e) {
    // NEW_MIGRATION=skip, as above.
    if (SKIP) return [];
    throw e;
  }
};

const ex = async (sql) => {
  try {
    await db.exec(sql);
  } catch (e) {
    // NEW_MIGRATION=skip: a write naming the split's tables fails; the checks after it FAIL on what is missing.
    if (SKIP) return;
    throw e;
  }
};
/** A paid pickup order of `items` (each [title, cents]) from Kaci; the grant (if any) is made first. */
async function sale(items, { grant = null, free = false, delivery = 0 } = {}) {
  const total = items.reduce((s, [, c]) => s + c, 0);
  const o = (await one(`insert into public.declutter_orders (buyer_id, seller_id, items_cents, delivery_cents, paid_with, handover)
    values ('${B}', '${K}', ${total}, ${delivery}, '${free ? "free" : "card"}', '${delivery ? "seller_delivery" : "pickup_home"}') returning id`)).id;
  for (const [t] of items) {
    const it = (await one(`insert into public.declutter_items (title) values ('${t}') returning id`)).id;
    await ex(`insert into public.declutter_cart_items (item_id, order_id) values ('${it}', '${o}')`);
  }
  // As every paying path does: the order first, then its lines.
  await ex(`update public.declutter_orders set status = 'paid' where id = '${o}';
                 update public.declutter_cart_items set status = 'paid' where order_id = '${o}';`);
  return o;
}
const grantRow = async (type, value, status = "active", mgr = M) => {
  await ex(`update public.declutter_manager_grants set status = 'ended' where seller_id = '${K}' and status = 'active'`);
  return (await one(`insert into public.declutter_manager_grants (seller_id, manager_id, status, share_type, share_pct, share_cents)
    values ('${K}', '${mgr}', '${status}', '${type}', ${type === "percent" ? value : "null"}, ${type === "flat" ? value : "null"}) returning id`)).id;
};
const handover = async (o) => {
  try {
    return await one(`select public.declutter_complete_handover('${o}', 'code') as r`);
  } catch (e) {
    // A refused handover (a payout CHECK) is reported by the check that reads its rows, never a crash.
    console.log(`  handover ${o} refused: ${String(e.message).split("\n")[0]}`);
    return { error: e.message };
  }
};
const sellerRow = (o) => one(`select amount_cents, manager_share_cents, debt_cents, status from public.declutter_payouts where order_id = '${o}'`);
const mgrRow = (o) => one(`select amount_cents, share_cents, status, manager_id from public.declutter_manager_payouts where order_id = '${o}'`);
const lastNotice = (u) => one(`select title, body from public.notices where user_id = '${u}' order by ctid desc limit 1`);

// S1: 20% of a $40 sale.
await grantRow("percent", 20);
let o = await sale([["Lamp", 4000]]);
await handover(o);
let s = await sellerRow(o), m = await mgrRow(o);
check("S1 20% of $40: the seller's row is $32, the manager's own row is $8", s?.amount_cents === 3200 && s?.manager_share_cents === 800
  && m?.amount_cents === 800 && m?.status === "pending" && m?.manager_id === M, JSON.stringify({ s, m }));
let ns = await lastNotice(K), nm = await lastNotice(M);
check("S1b the seller's notice shows the split and ends with the next step",
  /\$40\.00 sale · \$8\.00 to Dana \(20%\) · \$32\.00 to you\./.test(ns?.body ?? "") && /once the sale is final/.test(ns?.body ?? ""), ns?.body);
check("S1c the manager is told \"You earned $8 from Kaci's sale\" with the next step",
  /^You earned \$8\.00 from Kaci's sale of "Lamp"\. We send it once the sale is final/.test(nm?.body ?? ""), nm?.body);

// S2: flat $5 per item on a 3-item order, and a flat share above the sale price.
await grantRow("flat", 500);
o = await sale([["Mug", 300], ["Plate", 1200], ["Bowl", 1500]]);
await handover(o);
s = await sellerRow(o); m = await mgrRow(o);
check("S2 flat $5 x 3 items = $15 of $30", m?.amount_cents === 1500 && s?.amount_cents === 1500, JSON.stringify({ s, m }));
await grantRow("flat", 5000);
o = await sale([["Spoon", 200]]);
await handover(o);
s = await sellerRow(o); m = await mgrRow(o);
check("S3 a flat $50 share on a $2 sale is capped at $2; the seller's row is $0 (nothing_due), never negative",
  m?.amount_cents === 200 && s?.amount_cents === 0 && s?.status === "nothing_due", JSON.stringify({ s, m }));

// S4: the fee debt comes from the seller's part only; what doesn't fit carries forward.
await grantRow("percent", 50);
await ex(`insert into public.declutter_seller_fee_debts (seller_id, amount_cents, remaining_cents) values ('${K}', 3000, 3000)`);
o = await sale([["Desk", 4000]]);
await handover(o);
s = await sellerRow(o); m = await mgrRow(o);
const left = (await one(`select sum(remaining_cents)::int as n from public.declutter_seller_fee_debts where seller_id = '${K}'`)).n;
check("S4 a $30 debt on a $40 sale at 50%: the manager keeps $20, the seller's $20 pays $20 of the debt, $10 carries forward",
  m?.amount_cents === 2000 && s?.debt_cents === 2000 && s?.amount_cents === 0 && left === 1000, JSON.stringify({ s, m, left }));
await ex(`delete from public.declutter_seller_fee_debts; delete from public.declutter_fee_debt_deductions;`);

// S5: the share at the time of sale. A grant ended after payment keeps it; one created after payment gives none.
await grantRow("percent", 10);
o = await sale([["Chair", 5000]]);
await ex(`update public.declutter_manager_grants set status = 'ended' where seller_id = '${K}'`);
await grantRow("percent", 90, "active", M2);
await handover(o);
m = await mgrRow(o);
check("S5 ended after the payment: the old manager still gets 10% ($5); the new 90% grant changes nothing",
  m?.amount_cents === 500 && m?.manager_id === M, JSON.stringify(m));
await ex(`update public.declutter_manager_grants set status = 'ended'`);
const o6 = (await one(`insert into public.declutter_orders (buyer_id, seller_id, items_cents) values ('${B}', '${K}', 3000) returning id`)).id;
await ex(`update public.declutter_orders set status = 'paid' where id = '${o6}'`);
await grantRow("percent", 50);
// A replayed 'paid' write (paid -> paid, e.g. a webhook delivered twice) after the grant was made: must not lock it.
await ex(`update public.declutter_orders set status = 'paid' where id = '${o6}'`);
check("S7 a second 'paid' write never locks a share later (the trigger does not re-fire)",
  !(await one(`select 1 as x from public.declutter_order_manager_shares where order_id = '${o6}'`))?.x);
await handover(o6);
s = await sellerRow(o6); m = await mgrRow(o6);
check("S6 a grant made AFTER the order was paid gives no share: the seller gets it all", s?.amount_cents === 3000 && !m?.amount_cents, JSON.stringify({ s, m }));

// S8: a free claim gets no share.
o = await sale([["Free box", 1]], { free: true });
check("S8 a free claim locks no share", !(await one(`select 1 as x from public.declutter_order_manager_shares where order_id = '${o}'`))?.x);

// S9: a partial refund of one item on a multi-item order cuts both shares in proportion; a full refund leaves 0.
await grantRow("percent", 20);
o = await sale([["Table", 6000], ["Rug", 4000]]);
await handover(o);
await one(`select public.declutter_rebook_payout('${o}', 4000) as r`);
s = await sellerRow(o); m = await mgrRow(o);
check("S9 the $40 rug refunded from a $100 order at 20%: the manager $12 (was $20), the seller $48",
  m?.amount_cents === 1200 && s?.manager_share_cents === 1200 && s?.amount_cents === 4800, JSON.stringify({ s, m }));
await one(`select public.declutter_rebook_payout('${o}', 10000) as r`);
s = await sellerRow(o); m = await mgrRow(o);
check("S10 refunded in full: both rows 0, nothing_due", m?.amount_cents === 0 && m?.status === "nothing_due" && s?.amount_cents === 0, JSON.stringify({ s, m }));

// S11: once the manager's transfer may have started, a refund is refused (payout_already_sent).
o = await sale([["Shelf", 5000]]);
await handover(o);
const mid = (await one(`select id from public.declutter_manager_payouts where order_id = '${o}'`))?.id;
await ex(`insert into public.payout_send_marks values ('declutter_manager', '${mid}')`);
const late = await one(`select public.declutter_rebook_payout('${o}', 1000) as r`).catch((e) => ({ error: e.message }));
check("S11 a refund after the manager's send started is refused (payout_already_sent)", /payout_already_sent/.test(late?.error ?? ""), JSON.stringify(late));

// S12: the send order. A manager row is offered only once the seller's row is payable too.
o = await sale([["Vase", 2000]]);
await handover(o);
let due = await all(`select payout_id from public.declutter_manager_payouts_due(50) d join public.declutter_manager_payouts m on m.id = d.payout_id where m.order_id = '${o}'`);
check("S12 not before the sale is final", due.length === 0);
await ex(`insert into public.t_final values ('${o}')`);
due = await all(`select payout_id, stripe_account_id from public.declutter_manager_payouts_due(50) d join public.declutter_manager_payouts m on m.id = d.payout_id where m.order_id = '${o}'`);
check("S13 once final, the manager row is offered, to the MANAGER's account", due.length === 1 && due[0].stripe_account_id === "acct_m", JSON.stringify(due));
await ex(`update public.declutter_payouts set review_held_at = now() where order_id = '${o}'`);
due = await all(`select 1 from public.declutter_manager_payouts_due(50) d join public.declutter_manager_payouts m on m.id = d.payout_id where m.order_id = '${o}'`);
check("S14 not while the seller's row is held for review", due.length === 0);
await ex(`update public.declutter_payouts set review_held_at = null where order_id = '${o}';
               insert into public.declutter_problems values ('${o}', 'open');`);
due = await all(`select 1 from public.declutter_manager_payouts_due(50) d join public.declutter_manager_payouts m on m.id = d.payout_id where m.order_id = '${o}'`);
check("S15 not while a problem is open on the order", due.length === 0);
await ex(`delete from public.declutter_problems; insert into public.user_blocks values ('${K}', '${M}');`);
due = await all(`select 1 from public.declutter_manager_payouts_due(50) d join public.declutter_manager_payouts m on m.id = d.payout_id where m.order_id = '${o}'`);
check("S16 not while the two are blocked", due.length === 0);
await ex(`delete from public.user_blocks`);
const recId = (await one(`select id from public.declutter_manager_payouts where order_id = '${o}'`))?.id;
const rec = await one(`select public.declutter_manager_payout_executed('${recId}', 'tr_1', true, null) as s`);
check("S17 a sent manager transfer is recorded once", rec?.s === "succeeded", JSON.stringify(rec));

// S18: a manager with no payout account: the row waits (no account to send to), never paid to the seller.
await ex(`update public.declutter_manager_grants set status = 'ended'`);
await grantRow("percent", 25, "active", M2);
o = await sale([["Clock", 4000]]);
await handover(o);
s = await sellerRow(o); m = await mgrRow(o); nm = await lastNotice(M2);
await ex(`insert into public.t_final values ('${o}')`);
due = await all(`select stripe_account_id from public.declutter_manager_payouts_due(50) d join public.declutter_manager_payouts m on m.id = d.payout_id where m.order_id = '${o}'`);
check("S18 no payout account: the share stays the manager's ($10, offered with no account so declutter-money waits), the seller's row is $30",
  m?.amount_cents === 1000 && s?.amount_cents === 3000 && due.length === 1 && due[0].stripe_account_id === null, JSON.stringify({ s, m, due }));
check("S18b ...and the manager is told the next step: set up payouts", /Next: set up payouts in Settings to get it/.test(nm?.body ?? ""), nm?.body);

// S19: no grant at all: unchanged behaviour.
await ex(`update public.declutter_manager_grants set status = 'ended'`);
o = await sale([["Book", 1500]]);
await handover(o);
s = await sellerRow(o); m = await mgrRow(o);
check("S19 no manager: the seller's row is the whole $15 and there is no manager row", s?.amount_cents === 1500 && s?.manager_share_cents === 0 && !m, JSON.stringify({ s, m }));

// S20: authz: the tables are readable only by the two people, and nobody writes them.
const roles = await one(`select has_table_privilege('authenticated', 'public.declutter_manager_payouts', 'INSERT') as ins,
  has_table_privilege('anon', 'public.declutter_manager_payouts', 'SELECT') as anon_sel,
  has_table_privilege('authenticated', 'public.declutter_order_manager_shares', 'UPDATE') as upd,
  has_function_privilege('authenticated', 'public.declutter_manager_payouts_due(integer)', 'EXECUTE') as due_exec,
  has_function_privilege('authenticated', 'public.declutter_manager_payout_executed(uuid,text,boolean,text)', 'EXECUTE') as exec_exec`);
check("S20 no client writes; anon reads nothing; only the service role runs the payout queue",
  roles && !roles.ins && !roles.anon_sel && !roles.upd && !roles.due_exec && !roles.exec_exec, JSON.stringify(roles));

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
