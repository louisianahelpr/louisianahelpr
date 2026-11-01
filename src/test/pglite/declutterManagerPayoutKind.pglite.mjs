#!/usr/bin/env node
/**
 * PGlite proof for *_declutter_manager_payout_kind (manager mode phase 2b, the SQL half; lead conditions a and b on
 * 87b3df401b). The world and helpers are those of declutterManagerShareSplit.pglite.mjs; the split migration is applied
 * verbatim first, then this one 3x.
 *
 *   npx tsx src/test/pglite/declutterManagerPayoutKind.pglite.mjs                 # the migration applied 3x
 *   NEW_MIGRATION=skip npx tsx src/test/pglite/declutterManagerPayoutKind.pglite.mjs   # RED: the split alone
 *   PLANT=<name> npx tsx ...   # planted defects, each must FAIL its check (see PLANTS below)
 *
 * Added to the split's world: the REAL payout_payee_waits / payout_send_marks / payout_payee_reminders / payout_holds
 * CREATE TABLEs from 20261019070737 and 20261004162921 (their kind CHECKs), the ban columns on profiles, and the
 * columns payout_defer / payout_payee_waits_prune read on the other payout tables.
 * Below, the split proof's own notes:
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
const SPLIT = readdirSync(DIR).find((f) => f.endsWith("_declutter_manager_share_split.sql"));
const FILE = readdirSync(DIR).find((f) => f.endsWith("_declutter_manager_payout_kind.sql"));
const SKIP = process.env.NEW_MIGRATION === "skip";
const PLANT = process.env.PLANT ?? "";
const PLANTS = {
  // the waits table keeps the old kind CHECK: a manager payout cannot wait for the manager's setup
  no_kind: ["'delivery_refund', 'declutter_manager'));\n  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.payout_send_marks", "'delivery_refund'));\n  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.payout_send_marks"],
  // payout_defer has no manager branch (invalid_kind)
  no_defer: ["  ELSIF p_kind = 'declutter_manager' THEN\n    UPDATE public.declutter_manager_payouts SET next_attempt_at", "  ELSIF false THEN\n    UPDATE public.declutter_manager_payouts SET next_attempt_at"],
  // condition a: a banned manager is offered
  no_ban: ["AND (mp.ban_status IN ('banned', 'temp_banned', 'permanently_banned')", "AND (false"],
  // condition a: a manager on an admin payout hold is offered
  no_hold: ["AND NOT EXISTS (SELECT 1 FROM public.payout_holds ph WHERE ph.helper_id = m.manager_id)", ""],
  // condition b: the old items + delivery proportion
  old_ratio: ["(p.items_cents - least(p_refunded_cents, p.items_cents))\n                               / p.items_cents)", "(p.items_cents + p.delivery_cents - p_refunded_cents)\n                               / (p.items_cents + p.delivery_cents))"],
  // the prune drops a pending manager row's send mark (a re-send after a lost record)
  prune_mark: ["        AND p.status IN ('pending', 'failed', 'held_for_review'));", "        AND false);"],
};
let FIX = readFileSync(DIR + FILE, "utf8");
if (PLANT) {
  const [find, repl] = PLANTS[PLANT] ?? [];
  if (!find || !FIX.includes(find)) throw new Error(`PLANT=${PLANT}: not found in the migration`);
  FIX = FIX.replace(find, repl);
  console.log(`PLANT=${PLANT}: planted`);
}
if (SKIP) console.log("NEW_MIGRATION=skip: the newest bodies before this migration (expect FAILs)");

const DEFS = effectiveDefs(DIR, { before: SPLIT });
const SPLIT_SQL = readFileSync(DIR + SPLIT, "utf8");
const W = readFileSync(DIR + readdirSync(DIR).find((f) => f.endsWith("_payout_waits_for_payee_setup.sql")), "utf8");
const H = readFileSync(DIR + readdirSync(DIR).find((f) => f.endsWith("_payout_holds_server_side.sql")), "utf8");
const table = (src, name) => {
  const i = src.indexOf(`CREATE TABLE IF NOT EXISTS public.${name} (`);
  if (i < 0) throw new Error(`no CREATE TABLE ${name}`);
  return src.slice(i, src.indexOf("\n);", i) + 3);
};
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
  create table public.declutter_refunds (id uuid default gen_random_uuid(), order_id uuid, stripe_payment_intent_id text, reason text, status text,
    attempts int default 0, next_attempt_at timestamptz);
  create table public.declutter_seller_fee_debts (id uuid primary key default gen_random_uuid(), seller_id uuid, refund_id uuid,
    amount_cents integer, remaining_cents integer, created_at timestamptz not null default now());
  create table public.declutter_fee_debt_deductions (debt_id uuid, payout_ref text, deducted_cents integer);
  ${table(W, "payout_send_marks")}
  ${table(W, "payout_payee_waits")}
  ${table(W, "payout_payee_reminders")}
  ${table(H, "payout_holds")}
  alter table public.profiles add column ban_status text, add column auto_suspended_until timestamptz, add column is_seed boolean default false;
  create table public.helpr_task_payouts (id uuid primary key, status text, attempts int default 0, next_attempt_at timestamptz);
  create table public.shop_payouts (id uuid primary key, status text, attempts int default 0, next_attempt_at timestamptz);
  create table public.declutter_delivery_refunds (id uuid primary key, status text, attempts int default 0, next_attempt_at timestamptz);
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
await db.exec(SPLIT_SQL);
for (const n of ["payout_defer", "payout_hold_for_review", "payout_payee_wait_seen", "payout_payee_waits_prune",
  "payout_mark_sending", "payout_send_marks_for", "payout_payee_wait_cleared", "payout_payee_paged"]) await db.exec(real(n));
if (!SKIP) {
  for (let i = 0; i < 3; i++) await db.exec(FIX);
  console.log(`applied ${SPLIT}, then ${FILE} 3x`);
}
const one = async (sql) => {
  try {
    return (await db.query(sql)).rows[0];
  } catch (e) {
    // NEW_MIGRATION=skip: the manager kind is refused; the check reading the answer FAILs on undefined.
    if (SKIP || PLANT) return { error: String(e.message).split("\n")[0] };
    throw e;
  }
};
const all = async (sql) => {
  try {
    return (await db.query(sql)).rows;
  } catch (e) {
    // NEW_MIGRATION=skip, as above.
    if (SKIP || PLANT) return [];
    throw e;
  }
};

const ex = async (sql) => {
  try {
    await db.exec(sql);
  } catch (e) {
    // NEW_MIGRATION=skip: a write the old CHECKs refuse fails; the checks after it FAIL on what is missing.
    if (SKIP || PLANT) return;
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

const mgrId = async (o) => (await one(`select id from public.declutter_manager_payouts where order_id = '${o}'`))?.id;
const offered = async (o) => (await all(`select 1 from public.declutter_manager_payouts_due(50) d join public.declutter_manager_payouts m on m.id = d.payout_id where m.order_id = '${o}'`)).length === 1;

// A final $40 sale at 20%: the manager's $8 row, offered.
await grantRow("percent", 20);
let o = await sale([["Lamp", 4000]]);
await handover(o);
await ex(`insert into public.t_final values ('${o}')`);
let id = await mgrId(o);
check("K0 the control: the manager row is offered", await offered(o));

// K1: the manager's payout can wait for the manager's Stripe setup (the waits CHECK and payout_payee_wait_seen).
let w = await one(`select public.payout_payee_wait_seen('declutter_manager', '${id}', '${M}', 800, 'no_account', 'no payout account') as r`);
let wr = await one(`select category from public.payout_payee_waits where payout_kind = 'declutter_manager' and payout_id = '${id}'`);
check("K1 a manager payout waits on the manager's setup (a wait row, the manager reminded)", wr?.category === "no_account" && w?.r?.reminded === true, JSON.stringify({ w, wr }));
await ex(`select public.payout_payee_wait_cleared('declutter_manager', '${id}')`);

// K2: payout_defer moves the row out of the queue without using a try.
await ex(`select public.payout_defer('declutter_manager', '${id}', 60)`);
let r = await one(`select attempts, next_attempt_at > now() + interval '50 minutes' as later from public.declutter_manager_payouts where id = '${id}'`);
check("K2 payout_defer moves the manager row an hour on, no try used", r?.later === true && r?.attempts === 0 && !(await offered(o)), JSON.stringify(r));
await ex(`update public.declutter_manager_payouts set next_attempt_at = now() where id = '${id}'`);

// K3: the send mark before the transfer; then a refund is refused (declutter_payout_unsent sees it).
await ex(`select public.payout_mark_sending('declutter_manager', '${id}')`);
let marks = await all(`select * from public.payout_send_marks_for('declutter_manager', array['${id}']::uuid[]) x`);
let unsent = await one(`select public.declutter_payout_unsent('${o}') as u`);
check("K3 the manager row is marked before its transfer, and the order no longer counts as unsent", marks.length === 1 && unsent?.u === false, JSON.stringify({ marks, unsent }));

// K4: the prune keeps the mark of a row still pending, and drops it once the row is paid.
await ex(`select public.payout_payee_wait_seen('declutter_manager', '${id}', '${M}', 800, 'transient', 'x')`);
await ex(`select public.payout_payee_waits_prune()`);
let kept = await one(`select (select count(*)::int from public.payout_send_marks where payout_kind = 'declutter_manager' and payout_id = '${id}') as m,
  (select count(*)::int from public.payout_payee_waits where payout_kind = 'declutter_manager' and payout_id = '${id}') as w`);
check("K4 a pending manager row keeps its send mark and its wait through the prune", kept?.m === 1 && kept?.w === 1, JSON.stringify(kept));
await ex(`select public.declutter_manager_payout_executed('${id}', 'tr_k4', true, null); select public.payout_payee_waits_prune();`);
kept = await one(`select (select count(*)::int from public.payout_send_marks where payout_kind = 'declutter_manager' and payout_id = '${id}') as m,
  (select count(*)::int from public.payout_payee_waits where payout_kind = 'declutter_manager' and payout_id = '${id}') as w`);
check("K5 once paid, the prune drops both", kept?.m === 0 && kept?.w === 0, JSON.stringify(kept));

// K6: held for review: out of the queue for good.
o = await sale([["Rug", 4000]]);
await handover(o);
await ex(`insert into public.t_final values ('${o}')`);
id = await mgrId(o);
let held = await one(`select public.payout_hold_for_review('declutter_manager', '${id}', 'rejected', 'stripe rejected') as h`);
r = await one(`select status, review_reason from public.declutter_manager_payouts where id = '${id}'`);
check("K6 a manager row can be held for review, and leaves the queue", held?.h === true && r?.status === "held_for_review" && !(await offered(o)), JSON.stringify({ held, r }));

// K7-K10, lead condition a: a banned, suspended or held MANAGER is never offered.
o = await sale([["Desk", 4000]]);
await handover(o);
await ex(`insert into public.t_final values ('${o}')`);
check("K7 control: offered while the manager is clear", await offered(o));
await ex(`update public.profiles set ban_status = 'banned' where user_id = '${M}'`);
check("K8 not while the manager is banned", !(await offered(o)));
await ex(`update public.profiles set ban_status = 'temp_banned', auto_suspended_until = now() + interval '3 days' where user_id = '${M}'`);
check("K9 not while the manager is suspended", !(await offered(o)));
await ex(`update public.profiles set ban_status = null, auto_suspended_until = null where user_id = '${M}';
          insert into public.payout_holds (helper_id, reason) values ('${M}', 'admin hold');`);
check("K10 not while the manager has a payout_holds row", !(await offered(o)));
await ex(`delete from public.payout_holds`);
check("K11 offered again once clear", await offered(o));

// K12-K13, lead condition b: the share is cut by the ITEMS refund only.
const so = (await one(`insert into public.declutter_orders (buyer_id, seller_id, items_cents, delivery_cents, handover)
  values ('${B}', '${K}', 4000, 1000, 'pickup_home') returning id`)).id;
await ex(`update public.declutter_orders set status = 'paid' where id = '${so}'`);
await handover(so);
// The seller-delivery rate on the seller's row (the pickup world's handover books none): as a seller delivery would.
await ex(`update public.declutter_payouts set delivery_cents = 1000, amount_cents = amount_cents + 1000 where order_id = '${so}'`);
let before = await one(`select m.share_cents, p.items_cents, p.delivery_cents from public.declutter_manager_payouts m join public.declutter_payouts p on p.order_id = m.order_id where m.order_id = '${so}'`);
await one(`select public.declutter_rebook_payout('${so}', 1000) as r`);
let after = await one(`select m.amount_cents as m, p.amount_cents as s, p.manager_share_cents as ms from public.declutter_manager_payouts m join public.declutter_payouts p on p.order_id = m.order_id where m.order_id = '${so}'`);
const want = Math.floor((before?.share_cents * (before?.items_cents - 1000)) / before?.items_cents);
check("K12 a $10 part refund of $40 items (+$10 delivery) at 20%: the $8 share becomes $6, from the items alone (not $6.40)",
  before?.delivery_cents === 1000 && after?.m === want && want === 600 && after?.ms === 600, JSON.stringify({ before, after, want }));
await one(`select public.declutter_rebook_payout('${so}', 5000) as r`);
after = await one(`select m.amount_cents as m, m.status from public.declutter_manager_payouts m where m.order_id = '${so}'`);
check("K13 a full refund (items + delivery) leaves the share 0", after?.m === 0 && after?.status === "nothing_due", JSON.stringify(after));

// K14: authz: every restated function stays service_role only.
const priv = await one(`select bool_or(has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')) as any
  from unnest(array['public.payout_defer(text,uuid,integer)', 'public.payout_hold_for_review(text,uuid,text,text)',
    'public.payout_payee_wait_seen(text,uuid,uuid,integer,text,text)', 'public.payout_payee_waits_prune()',
    'public.declutter_rebook_payout(uuid,integer)', 'public.declutter_manager_payouts_due(integer)']) f`);
check("K14 no client runs any of them", priv?.any === false, JSON.stringify(priv));

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
