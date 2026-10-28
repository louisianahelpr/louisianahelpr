#!/usr/bin/env node
/**
 * PGlite proof for 20261028232338_declutter_damage_no_enjoy_notice: on "Damaged in delivery" the buyer is no longer
 * told "Enjoy your item ... the sale is final" (they are refunded in full); every other handover still sends it.
 *
 *   node src/test/pglite/declutterDamageNoEnjoyNotice.pglite.mjs                  # BEFORE then AFTER (3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterDamageNoEnjoyNotice.pglite.mjs # RED: the bodies before it
 *   MUTANT=<name> node src/test/pglite/declutterDamageNoEnjoyNotice.pglite.mjs    # a planted defect: must FAIL
 *
 * World: the A2-14 proof's (src/test/pglite/declutterProblemDecisionNotices.pglite.mjs), with the bodies before this
 * migration: declutter_admin_decide_delivery_damage from 20261028223738 (A2-14) and declutter_complete_handover
 * from 20261028223036 (#37). Stubs as there.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const KINDS = "20261028162048_declutter_notice_kinds.sql";
const COPY = "20261028171944_declutter_notice_copy.sql";
const WRITER_NAMES = "20261028191646_declutter_notices_name_the_item.sql";
const NO_FEE_WORDS = "20261027172503_declutter_notices_name_no_fee.sql";
const NEXT_STEP = "20261028204431_declutter_paid_notice_next_step.sql";
const ITEM3 = "20261028210552_declutter_sale_notices_name_inline.sql";
const A214 = "20261028223738_declutter_problem_decision_notices.sql";
const THIS = "20261028232338_declutter_damage_no_enjoy_notice.sql";
// declutter_delivery_on_task_event is 20261028200440's body (ready/b1-audit3-notices, under this migration in
// the stack: prod's 60c8ecd04abf90821dad40abf08e61fd with the seller's links to Selling), so it is not md5-checked.
const PROD_MD5 = {};
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The damage decision no longer names its order.
  unset: ["  PERFORM set_config('declutter.no_enjoy_notice', o.id::text, true);\n", ""],
  // The handover skips "Enjoy your item" for every admin handover.
  everyadmin: ["  IF COALESCE(current_setting('declutter.no_enjoy_notice', true), '') IS DISTINCT FROM o.id::text THEN", "  IF p_by <> 'admin' THEN"],
};
const skip = process.env.NEW_MIGRATION === "skip";
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replaceAll(m[0], m[1]);
}

/** The newest CREATE FUNCTION text for `name` in migrations strictly before `before` (raw text, no rewrites). */
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
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
const I = (n) => `44444444-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), BUYER = U(2), HELPR = U(3), HELPR_NOACCT = U(4);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create table public.profiles (user_id uuid primary key, is_seed boolean default false, full_name text, stripe_account_id text);
  create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text,
    type text, read boolean default false, link text, created_at timestamptz default clock_timestamp(), job_id uuid);
  alter table public.notifications add constraint notifications_type_check check (type in (
    'info', 'success', 'warning', 'job_update', 'application', 'review', 'payment', 'job_match', 'job_updates', 'work_status',
    'transit_updates', 'system_alert', 'new_offers', 'expired', 'financial_alerts', 'verified', 'message', 'admin_alert'));
  create table public.notification_preferences (user_id uuid primary key, new_offers boolean default true, email_new_offers boolean default true,
    job_updates boolean default true, email_job_updates boolean default true);
  create table public.notification_type_pref_map (type text primary key, pref_column text not null, description text);
  create table public.error_logs (id bigint generated always as identity, severity text, message text, tags jsonb, context jsonb);
  create table public.defects (fn text, ref text, err text, ctx jsonb);
  create function public.log_cron_defect(p_fn text, p_ref text, p_err text, p_context jsonb default '{}'::jsonb) returns void language sql as
    $f$ insert into public.defects values (p_fn, p_ref, p_err, p_context) $f$;
  create schema net; create table net.calls (url text, body jsonb);
  create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as $f$ insert into net.calls values (url, body) returning 1::bigint $f$;
  create schema vault; create table vault.decrypted_secrets (name text, decrypted_secret text);
  create table public.user_blocks (blocker_id uuid, blocked_id uuid);
  create function public.are_users_blocked(p1 uuid, p2 uuid) returns boolean language sql stable as
    $f$ select exists (select 1 from public.user_blocks b where (b.blocker_id = p1 and b.blocked_id = p2) or (b.blocker_id = p2 and b.blocked_id = p1)) $f$;
  create function public.feature_enabled_for_user(p_key text, p_user uuid) returns boolean language sql stable as $f$ select true $f$;
  create function public.declutter_member_out(p_user uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.member_under_18(p_user uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.seed_hidden_for(p_user uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.is_caller_banned() returns boolean language sql stable as $f$ select false $f$;
  create function public.helpr_task_source_require_feature(p_kind text) returns void language sql as $f$ select $f$;
  create table public.declutter_items (id uuid primary key, seller_id uuid not null, status text not null default 'live', title text not null,
    price_cents integer not null default 5000, current_price_cents integer not null default 5000, is_seed boolean not null default false,
    seller_hidden boolean not null default false, porch_ok boolean not null default true, updated_at timestamptz default now());
  create table public.declutter_questions (id uuid primary key default gen_random_uuid(), item_id uuid, asker_id uuid, question text, answer text,
    answered_at timestamptz, removed_at timestamptz, created_at timestamptz default now());
  create table public.declutter_watchlist (user_id uuid, item_id uuid, primary key (user_id, item_id));
  create table public.declutter_price_alerts (id uuid primary key default gen_random_uuid(), item_id uuid, user_id uuid, price_cents integer, sent_at timestamptz default now());
  create table public.declutter_offers (id uuid primary key default gen_random_uuid(), item_id uuid, buyer_id uuid, status text, closed_at timestamptz, updated_at timestamptz);
  create table public.declutter_offer_events (offer_id uuid, actor_side text, action text);
  create table public.declutter_cart_items (id uuid primary key default gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid, price_cents integer,
    source text, offer_id uuid, order_id uuid, status text default 'in_cart', checkout_by timestamptz, is_seed boolean default false,
    created_at timestamptz default now(), closed_at timestamptz, list_price_cents integer);
  create table public.declutter_orders (id uuid primary key default gen_random_uuid(), buyer_id uuid, seller_id uuid,
    status text not null default 'awaiting_payment', handover text, items_cents integer, premium_cents integer default 0,
    tax_cents integer default 0, delivery_cents integer default 0, total_cents integer, stripe_payment_intent_id text,
    stripe_checkout_session_id text, paid_at timestamptz, closed_at timestamptz, close_reason text, card_fee_cents integer,
    stripe_paid_at timestamptz, setup_fee_cents integer default 0, setup_fee_state text, paid_with text, handed_over_at timestamptz,
    is_seed boolean default false, created_at timestamptz default now());
  create table public.declutter_refunds (id uuid primary key default gen_random_uuid(), stripe_payment_intent_id text);
  create table public.declutter_strikes (id uuid, cart_line_id uuid, reason text, removed_at timestamptz);
  create table public.declutter_bookings (order_id uuid primary key, buyer_id uuid, seller_id uuid, slot_start timestamptz, slot_end timestamptz,
    buyer_rebooked boolean not null default false, created_at timestamptz default now());
  create table public.declutter_seller_deliveries (order_id uuid primary key, status text not null, slot_start timestamptz);
  create table public.declutter_handovers (order_id uuid primary key, code text, confirmed_at timestamptz, confirmed_by text);
  create table public.declutter_problems (id uuid primary key default gen_random_uuid(), order_id uuid, status text default 'open',
    reporter_id uuid, reporter_side text, reason text, note text, photo_paths text[], is_seed boolean default false);
  create table public.declutter_payouts (id uuid primary key default gen_random_uuid(), order_id uuid unique, seller_id uuid, items_cents integer,
    delivery_cents integer, debt_cents integer, amount_cents integer, status text);
  create table public.helpr_tasks (id uuid primary key, status text not null, helpr_id uuid, customer_id uuid, title text,
    source_kind text default 'declutter_delivery', pickup_slot_start timestamptz, pay_cents integer default 2000, fee_cents integer default 0);
  create table public.declutter_order_deliveries (order_id uuid primary key, task_id uuid);
  create table public.helpr_task_payouts (id uuid primary key default gen_random_uuid(), task_id uuid unique, helpr_id uuid, status text);
  create table public.helpr_task_tips (id uuid primary key default gen_random_uuid(), task_id uuid not null, tipper_id uuid, helpr_id uuid,
    tip_cents integer not null, attempt_id uuid not null, stripe_session_id text, payment_status text not null default 'pending',
    held boolean not null default false, constraint one_per_attempt unique (task_id, tipper_id, attempt_id, tip_cents));
  create function public.declutter_record_refund(p_order uuid, p_pi text, p_reason text, p_amount integer, p_fee integer) returns uuid language sql as
    $f$ insert into public.declutter_refunds (stripe_payment_intent_id) values (p_pi) returning id $f$;
  create function public.declutter_refund_answer(p_refund uuid) returns jsonb language sql as $f$ select jsonb_build_object('result', 'refunded') $f$;
  create function public.declutter_seller_out(p_user uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.declutter_seller_out_fee_notice(p_refund uuid) returns void language sql as $f$ select $f$;
  create function public.declutter_card_fee_estimate(p_cents integer) returns integer language sql immutable as $f$ select 0 $f$;
  create function public.declutter_claim_setup_fee(p_order uuid) returns void language sql as $f$ select $f$;
  create function public.declutter_new_handover_code() returns text language sql as $f$ select '1234' $f$;
  create function public.declutter_consume_fee_debt(p_user uuid, p_ref text, p_cents integer) returns integer language sql as $f$ select 0 $f$;
  create function public.declutter_delivery_refund(p_order uuid, p_reason text) returns uuid language sql as $f$ select null::uuid $f$;
  create function public.helpr_task_close(p_task uuid, p_status text, p_reason text) returns void language sql as $f$ select $f$;
  create function public.declutter_close_paid_order(p_order uuid, p_reason text, a text, b text, c text) returns jsonb language sql as $f$ select '{}'::jsonb $f$;
  -- Stand-in for helpr_task_confirm: the task is confirmed and its payout row written ('pending'), as the real one does.
  create function public.helpr_task_confirm(p_task uuid, p_by text, p_actor uuid) returns jsonb language plpgsql as $f$
  declare v uuid;
  begin
    update public.helpr_tasks set status = 'confirmed' where id = p_task and status in ('picked_up', 'delivered');
    insert into public.helpr_task_payouts (task_id, helpr_id, status) select id, helpr_id, 'pending' from public.helpr_tasks where id = p_task
      on conflict (task_id) do nothing returning id into v;
    return jsonb_build_object('result', 'confirmed', 'helpr_payout_id', v);
  end $f$;
`);
// The bodies before this migration (see the header), then the notice writer as on prod.
await db.exec(newestBefore("declutter_take_item", KINDS));
await db.exec(newestBefore("declutter_mark_order_paid", KINDS));
await db.exec(newestBefore("declutter_price_drop_alert", KINDS));
await db.exec(newestBefore("declutter_complete_handover", NO_FEE_WORDS));
await db.exec(newestBefore("declutter_delivery_on_task_event", THIS));
await db.exec(newestBefore("helpr_task_tip_start", THIS));
await db.exec(readFileSync(MIG_DIR + NO_FEE_WORDS, "utf8"));
await db.exec(readFileSync(MIG_DIR + KINDS, "utf8"));
await db.exec(readFileSync(MIG_DIR + COPY, "utf8"));
await db.exec(readFileSync(MIG_DIR + WRITER_NAMES, "utf8"));
await db.exec(readFileSync(MIG_DIR + NEXT_STEP, "utf8"));
await db.exec(`create table public.user_roles (user_id uuid, role text);
  create function public.has_role(p_user uuid, p_role text) returns boolean language sql stable as
    $f$ select exists (select 1 from public.user_roles r where r.user_id = p_user and r.role = p_role) $f$;
  alter table public.declutter_problems add column if not exists decision text, add column if not exists fault text,
    add column if not exists strike_given boolean, add column if not exists admin_note text, add column if not exists decided_by uuid,
    add column if not exists decided_at timestamptz;
  create table public.admin_audit_log (id bigint generated always as identity, admin_id uuid, action text, target_type text, target_id text, details jsonb);
  create or replace function public.declutter_close_paid_order(p_order uuid, p_reason text, a text, b text, c text) returns jsonb language plpgsql as $f$
  declare o public.declutter_orders;
  begin
    select * into o from public.declutter_orders where id = p_order;
    update public.declutter_orders set status = 'refunded', closed_at = now() where id = p_order;
    perform public.declutter_notify(o.buyer_id, 'payment', 'Refund on its way', 'Your money is coming back to your card.', '/declutter?view=cart', o.seller_id);
    return jsonb_build_object('result', 'refunded');
  end $f$;
  create or replace function public.declutter_refund_after_handover(p_order uuid, p_reason text, p_cents integer) returns jsonb language plpgsql as $f$
  declare o public.declutter_orders;
  begin
    select * into o from public.declutter_orders where id = p_order;
    perform public.declutter_notify(o.buyer_id, 'payment', 'Refund on its way', 'Your money is coming back to your card.', '/declutter?view=cart', o.seller_id);
    return jsonb_build_object('result', 'refunded');
  end $f$;
  create or replace function public.declutter_give_strike(p_user uuid, p_side text, p_reason text, p_item uuid, p_why text, p_line uuid default null)
    returns integer language sql as $f$ select 1 $f$;
  create or replace function public.helpr_task_log(p_task uuid, p_event text, p_actor uuid, p_note text) returns void language sql as $f$ select $f$;
  create or replace function public.helpr_task_give_job_strike(p_user uuid, p_reason text, p_task uuid, p_why text) returns void language sql as $f$ select $f$;
  alter table public.helpr_tasks add column if not exists closed_at timestamptz, add column if not exists close_note text, add column if not exists updated_at timestamptz;`);
await db.exec(readFileSync(MIG_DIR + WRITER_NAMES, "utf8").match(/CREATE OR REPLACE FUNCTION public\.declutter_lock_order[\s\S]*?\n\$fn\$;/)[0]);
await db.exec(readFileSync(MIG_DIR + ITEM3, "utf8"));
await db.exec(newestBefore("declutter_admin_decide_problem", THIS));
await db.exec(newestBefore("declutter_admin_decide_delivery_damage", THIS));
await db.exec(newestBefore("declutter_complete_handover", THIS));
for (const [fn, md5] of Object.entries(PROD_MD5)) {
  const got = (await db.query(`select md5(prosrc) m from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [fn])).rows[0]?.m;
  check(got === md5, `[world] ${fn} is prod's body (md5 ${got})`);
}
await db.exec(`insert into auth.users values ('${SELLER}'), ('${BUYER}'), ('${HELPR}'), ('${HELPR_NOACCT}');
  insert into public.profiles (user_id, full_name, stripe_account_id) values ('${SELLER}', 'Sam Seller', 'acct_s'), ('${BUYER}', 'Bea Buyer', null),
    ('${HELPR}', 'Hal Helpr', 'acct_h'), ('${HELPR_NOACCT}', 'Nia Newhelpr', null);
  insert into public.notification_preferences (user_id) values ('${SELLER}'), ('${BUYER}'), ('${HELPR}'), ('${HELPR_NOACCT}');`);

const ADMIN = U(9);
await db.exec(`insert into auth.users values ('${ADMIN}'); insert into public.user_roles values ('${ADMIN}', 'admin');`);
const titles = async (u) => (await db.query(`select title from public.notifications where user_id = $1 order by created_at`, [u])).rows.map((r) => r.title);
const reset = () => db.exec(`delete from public.notifications; delete from public.declutter_cart_items; delete from public.declutter_orders;
  delete from public.declutter_items; delete from public.declutter_handovers; delete from public.declutter_payouts; delete from public.declutter_problems;
  delete from public.admin_audit_log; delete from public.helpr_tasks; delete from public.declutter_order_deliveries; delete from public.declutter_refunds;`);
let n = 0;
async function order(handover) {
  const o = I(800 + ++n), it = I(++n);
  await db.query(`insert into public.declutter_orders (id, buyer_id, seller_id, status, handover, items_cents, total_cents, stripe_payment_intent_id, card_fee_cents)
    values ($1, $2, $3, 'paid', $4, 3000, 3000, $5, 100)`, [o, BUYER, SELLER, handover, `pi_${n}`]);
  await db.query(`insert into public.declutter_items (id, seller_id, title, status) values ($1, $2, 'Lamp', 'sold')`, [it, SELLER]);
  await db.query(`insert into public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, order_id, status) values ($1, $2, $3, 3000, $4, 'paid')`, [it, BUYER, SELLER, o]);
  return o;
}
async function asAdmin(sql, args) {
  await db.exec(`set request.jwt.claim.sub = '${ADMIN}'`);
  try { return (await db.query(sql, args)).rows; } finally { await db.exec(`reset request.jwt.claim.sub`); }
}
async function scenarios() {
  const r = {};
  // Damaged in delivery: a Helpr delivery the Helpr picked up, reported damaged.
  let o = await order("delivery");
  const t = I(900 + n);
  await db.query(`insert into public.helpr_tasks (id, status, helpr_id, customer_id, title) values ($1, 'picked_up', $2, $3, 'Delivery')`, [t, HELPR, BUYER]);
  await db.query(`insert into public.declutter_order_deliveries values ($1, $2)`, [o, t]);
  let pid = (await db.query(`insert into public.declutter_problems (order_id, status, reporter_id, reporter_side, reason, note) values ($1, 'open', $2, 'buyer', 'damaged', 'Broken') returning id`, [o, BUYER])).rows[0].id;
  await asAdmin(`select public.declutter_admin_decide_delivery_damage($1, 'crushed')`, [pid]);
  r.damageBuyer = await titles(BUYER);
  r.damageSeller = await titles(SELLER);
  await reset();
  // An admin's "Pay the seller" on a paid pickup: the buyer still gets "Enjoy your item".
  o = await order("pickup_home");
  pid = (await db.query(`insert into public.declutter_problems (order_id, status, reporter_id, reporter_side, reason, note) values ($1, 'open', $2, 'buyer', 'not_as_described', 'Cracked') returning id`, [o, BUYER])).rows[0].id;
  await asAdmin(`select public.declutter_admin_decide_problem($1, 'pay_seller', 'none', false, null)`, [pid]);
  r.payBuyer = await titles(BUYER);
  await reset();
  // A plain handover by the buyer: unchanged.
  o = await order("pickup_home");
  await db.query(`select public.declutter_complete_handover($1, 'buyer')`, [o]);
  r.plainBuyer = await titles(BUYER);
  await reset();
  // The damage decision, then a second order's admin handover in the SAME transaction: that buyer is still told.
  const o1 = await order("delivery"), t1 = I(950 + n);
  await db.query(`insert into public.helpr_tasks (id, status, helpr_id, customer_id, title) values ($1, 'picked_up', $2, $3, 'Delivery')`, [t1, HELPR, BUYER]);
  await db.query(`insert into public.declutter_order_deliveries values ($1, $2)`, [o1, t1]);
  const p1 = (await db.query(`insert into public.declutter_problems (order_id, status, reporter_id, reporter_side, reason, note) values ($1, 'open', $2, 'buyer', 'damaged', 'Broken') returning id`, [o1, BUYER])).rows[0].id;
  const o2 = await order("pickup_home");
  await db.exec(`set request.jwt.claim.sub = '${ADMIN}'`);
  try {
    await db.exec(`begin; select public.declutter_admin_decide_delivery_damage('${p1}', 'crushed'); select public.declutter_complete_handover('${o2}', 'admin'); commit;`);
  } finally { await db.exec(`reset request.jwt.claim.sub`); }
  r.sameTxn = await titles(BUYER);
  await reset();
  return r;
}
const count = (list, t) => list.filter((x) => x === t).length;
const b = await scenarios();
console.log(`BEFORE  damage buyer: ${JSON.stringify(b.damageBuyer)}`);
check(count(b.damageBuyer, "Enjoy your item") === 1, "[before] the damaged-in-delivery buyer was told \"Enjoy your item ... final\"");
if (skip) console.log("NEW_MIGRATION=skip: the AFTER checks run on the bodies before it (expect FAILs)");
for (let i = 0; i < (skip ? 0 : 3); i++) {
  try { await db.exec(mig); check(true, `the migration applies (run ${i + 1} of 3)`); } catch (e) { check(false, `the migration applies (run ${i + 1} of 3): ${e.message}`); }
}
const a = await scenarios();
console.log(`AFTER   damage buyer: ${JSON.stringify(a.damageBuyer)}`);
check(count(a.damageBuyer, "Enjoy your item") === 0, "[damage] the buyer is not told \"Enjoy your item ... final\"");
check(count(a.damageBuyer, "Refund on its way") === 1 && count(a.damageBuyer, "Louisiana Helpr decided") === 1, "[damage] the buyer still hears the refund and the decision");
check(count(a.damageSeller, "Handover done") === 1 && count(a.damageSeller, "Louisiana Helpr decided") === 1, "[damage] the seller's notices are unchanged");
check(count(a.payBuyer, "Enjoy your item") === 1, "[pay the seller] an admin's other handover still tells the buyer");
check(count(a.plainBuyer, "Enjoy your item") === 1, "[plain] the buyer's own handover still tells the buyer");
check(count(a.sameTxn, "Enjoy your item") === 1, `[same transaction] the setting names one order: a different order's handover is still told (${JSON.stringify(a.sameTxn)})`);

console.log(failures ? `\n${failures} FAILED${MUTANT ? ` (mutant ${MUTANT})` : ""}` : `\nALL PASS${MUTANT ? ` (mutant ${MUTANT} was NOT caught)` : ""}`);
process.exit(failures ? 1 : 0);
