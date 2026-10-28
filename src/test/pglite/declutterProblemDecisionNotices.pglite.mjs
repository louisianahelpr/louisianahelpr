#!/usr/bin/env node
/**
 * PGlite proof for 20261028223738_declutter_problem_decision_notices.sql (Declutter audit 2, SH2-5 / A2-14): after an admin decides a reported problem,
 * both sides are told the decision, on every path: before or after the handover, "Pay the seller" or a refund,
 * paid or free, and "Damaged in delivery". The one path that already told both (handed over, "Pay the seller") is not told twice.
 *
 *   node src/test/pglite/declutterProblemDecisionNotices.pglite.mjs                  # BEFORE then AFTER (3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterProblemDecisionNotices.pglite.mjs # RED: the body before it
 *   MUTANT=<name> node src/test/pglite/declutterProblemDecisionNotices.pglite.mjs    # a planted defect: must FAIL
 *
 * World: the sale-notice proof's (src/test/pglite/declutterSaleNoticesNameInline.pglite.mjs: tables as on prod,
 * the notice writer through 20261028191646, the stack's bodies through 20261028210552), plus prod's
 * declutter_admin_decide_problem (20261026155251) and declutter_admin_decide_delivery_damage (20261017055505), both
 * md5-equal to prod's prosrc, and declutter_lock_order
 * (20261028191646). Stubbed, and said so: as there, plus has_role (a table of admins), declutter_close_paid_order
 * and declutter_refund_after_handover (they close the order and send their own refund notice, as the real ones
 * do; the amounts are not what this proves), declutter_give_strike, helpr_task_log, helpr_task_give_job_strike,
 * and the admin audit log table.
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
const THIS = "20261028223738_declutter_problem_decision_notices.sql";
// declutter_delivery_on_task_event is 20261028200440's body (ready/b1-audit3-notices, under this migration in
// the stack: prod's 60c8ecd04abf90821dad40abf08e61fd with the seller's links to Selling), so it is not md5-checked.
const PROD_MD5 = { declutter_admin_decide_problem: "66b2b598b83648f9b596099c3ac73179", declutter_admin_decide_delivery_damage: "b39f9cdbebc1012e6a6ba5db4ff76055" };
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The block skipped everywhere.
  none: ["  IF NOT (o.status = 'handed_over' AND p_decision = 'pay_seller') THEN\n", "  IF false THEN\n"],
  // The handed-over "Pay the seller" path told twice.
  twice: ["  IF NOT (o.status = 'handed_over' AND p_decision = 'pay_seller') THEN\n", "  IF true THEN\n"],
  // Only the buyer told.
  buyeronly: ["    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Louisiana Helpr decided',\n      format('We looked at both sides of the problem with %s. %s', public.declutter_order_items_named(o.id),", "    PERFORM public.declutter_notify(NULL, 'payment', 'Louisiana Helpr decided',\n      format('We looked at both sides of the problem with %s. %s', public.declutter_order_items_named(o.id),"],
  // "Damaged in delivery" still tells the seller nothing.
  damage: ["  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Louisiana Helpr decided',\n    format(", "  PERFORM public.declutter_notify(NULL, 'payment', 'Louisiana Helpr decided',\n    format("],
  // A free order told about money.
  free: ["        CASE WHEN o.paid_with = 'free' AND p_decision = 'pay_seller' THEN 'The handover stands.'\n             WHEN o.paid_with = 'free' THEN 'This free pickup is cancelled.'\n             WHEN p_decision = 'pay_seller' THEN 'The seller keeps", "        CASE WHEN p_decision = 'pay_seller' THEN 'The seller keeps"],
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
const told = async (u) => (await db.query(`select message, link from public.notifications where user_id = $1 and title = 'Louisiana Helpr decided' order by created_at`, [u])).rows;
const reset = () => db.exec(`delete from public.notifications; delete from public.declutter_cart_items; delete from public.declutter_orders;
  delete from public.declutter_items; delete from public.declutter_handovers; delete from public.declutter_payouts; delete from public.declutter_problems;
  delete from public.admin_audit_log;`);
let n = 0;
async function decide(status, decision, { free = false } = {}) {
  const o = I(800 + ++n), it = I(++n);
  await db.query(`insert into public.declutter_orders (id, buyer_id, seller_id, status, handover, items_cents, total_cents, paid_with)
    values ($1, $2, $3, $4, 'pickup_home', $5, $5, $6)`, [o, BUYER, SELLER, status, free ? 0 : 3000, free ? "free" : null]);
  await db.query(`insert into public.declutter_items (id, seller_id, title, status) values ($1, $2, 'Lamp', 'sold')`, [it, SELLER]);
  await db.query(`insert into public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, order_id, status) values ($1, $2, $3, $4, $5, 'paid')`, [it, BUYER, SELLER, free ? 0 : 3000, o]);
  const pid = (await db.query(`insert into public.declutter_problems (order_id, status, reporter_id, reporter_side, reason, note) values ($1, 'open', $2, 'buyer', 'not_as_described', 'Cracked') returning id`, [o, BUYER])).rows[0].id;
  await db.exec(`set request.jwt.claim.sub = '${ADMIN}'`);
  try { await db.query(`select public.declutter_admin_decide_problem($1, $2, 'none', false, 'internal: looked at the photos')`, [pid, decision]); }
  finally { await db.exec(`reset request.jwt.claim.sub`); }
  const r = { buyer: await told(BUYER), seller: await told(SELLER) };
  await reset();
  return r;
}
async function damage() {
  const o = I(800 + ++n), it = I(++n), t = I(900 + n);
  await db.query(`insert into public.declutter_orders (id, buyer_id, seller_id, status, handover, items_cents, total_cents, stripe_payment_intent_id, card_fee_cents) values ($1, $2, $3, 'paid', 'delivery', 3000, 3000, 'pi_dmg', 100)`, [o, BUYER, SELLER]);
  await db.query(`insert into public.declutter_items (id, seller_id, title, status) values ($1, $2, 'Lamp', 'sold')`, [it, SELLER]);
  await db.query(`insert into public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, order_id, status) values ($1, $2, $3, 3000, $4, 'paid')`, [it, BUYER, SELLER, o]);
  await db.query(`insert into public.helpr_tasks (id, status, helpr_id, customer_id, title) values ($1, 'picked_up', $2, $3, 'Delivery')`, [t, HELPR, BUYER]);
  await db.query(`insert into public.declutter_order_deliveries values ($1, $2)`, [o, t]);
  const pid = (await db.query(`insert into public.declutter_problems (order_id, status, reporter_id, reporter_side, reason, note) values ($1, 'open', $2, 'buyer', 'damaged', 'Broken') returning id`, [o, BUYER])).rows[0].id;
  await db.exec(`set request.jwt.claim.sub = '${ADMIN}'`);
  try { await db.query(`select public.declutter_admin_decide_delivery_damage($1, 'internal: crushed box')`, [pid]); }
  finally { await db.exec(`reset request.jwt.claim.sub`); }
  const r = { buyer: await told(BUYER), seller: await told(SELLER) };
  await reset();
  await db.exec(`delete from public.helpr_tasks; delete from public.declutter_order_deliveries; delete from public.declutter_refunds;`);
  return r;
}
async function scenarios() {
  return {
    damage: await damage(),
    paidPay: await decide("paid", "pay_seller"),
    paidRefund: await decide("paid", "refund_buyer"),
    afterPay: await decide("handed_over", "pay_seller"),
    afterRefund: await decide("handed_over", "refund_buyer"),
    freePay: await decide("paid", "pay_seller", { free: true }),
    freeRefund: await decide("paid", "refund_buyer", { free: true }),
  };
}
const b = await scenarios();
console.log(`BEFORE  paid/pay buyer told: ${b.paidPay.buyer.length}, seller: ${b.paidPay.seller.length}; paid/refund: ${b.paidRefund.buyer.length}/${b.paidRefund.seller.length}; after/refund: ${b.afterRefund.buyer.length}/${b.afterRefund.seller.length}`);
check(b.paidPay.buyer.length === 0 && b.paidRefund.seller.length === 0 && b.damage.seller.length === 0 && b.afterPay.buyer.length === 1,
  "[before] only the handed-over \"Pay the seller\" path told anyone the decision");
if (skip) console.log("NEW_MIGRATION=skip: the AFTER checks run on the body before it (expect FAILs)");
for (let i = 0; i < (skip ? 0 : 3); i++) {
  try { await db.exec(mig); check(true, `the migration applies (run ${i + 1} of 3)`); } catch (e) { check(false, `the migration applies (run ${i + 1} of 3): ${e.message}`); }
}
const a = await scenarios();
const one = (x) => (x.length === 1 ? x[0] : { message: `(${x.length} notices)`, link: "" });
const W = 'We looked at both sides of the problem with "Lamp". ';
const exp = [
  ["paidPay", "buyer", W + "The seller keeps the payment, and the sale is final.", "/declutter?tab=buying"],
  ["paidPay", "seller", W + "You keep the payment.", "/declutter?tab=selling"],
  ["paidRefund", "buyer", W + "We are refunding you. A separate notice says how much.", "/declutter?tab=buying"],
  ["paidRefund", "seller", W + "We are refunding the buyer, so this sale is cancelled.", "/declutter?tab=selling"],
  ["afterRefund", "buyer", W + "We are refunding you. A separate notice says how much.", "/declutter?tab=buying"],
  ["afterRefund", "seller", W + "We are refunding the buyer, so this sale is cancelled.", "/declutter?tab=selling"],
  ["freePay", "buyer", W + "The handover stands.", "/declutter?tab=buying"],
  ["freePay", "seller", W + "The handover stands.", "/declutter?tab=selling"],
  ["freeRefund", "buyer", W + "This free pickup is cancelled.", "/declutter?tab=buying"],
  ["freeRefund", "seller", W + "This free pickup is cancelled.", "/declutter?tab=selling"],
  ["damage", "buyer", W + "It was damaged in delivery, so all of your money is coming back.", "/declutter?tab=buying"],
  ["damage", "seller", W + "It was damaged in delivery, which is not on you: you keep the payment.", "/declutter?tab=selling"],
];
for (const [s, who, msg, link] of exp) {
  const got = one(a[s][who]);
  check(got.message === msg && got.link === link, `[${s}] the ${who} is told once: "${got.message}" -> ${got.link}`);
}
check(a.afterPay.buyer.length === 1 && a.afterPay.seller.length === 1, `[afterPay] the path that already told both is not told twice (${a.afterPay.buyer.length}/${a.afterPay.seller.length})`);
const leaked = Object.values(a).flatMap((x) => [...x.buyer, ...x.seller]).filter((m) => /internal|photos/.test(m.message));
check(leaked.length === 0, `[note] the admin's note is never shown to a member (${leaked.length})`);

console.log(failures ? `\n${failures} FAILED${MUTANT ? ` (mutant ${MUTANT})` : ""}` : `\nALL PASS${MUTANT ? ` (mutant ${MUTANT} was NOT caught)` : ""}`);
process.exit(failures ? 1 : 0);
