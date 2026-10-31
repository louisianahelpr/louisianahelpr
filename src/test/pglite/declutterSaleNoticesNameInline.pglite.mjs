#!/usr/bin/env node
/**
 * PGlite proof for 20261028210552_declutter_sale_notices_name_inline (Declutter audits 2026-10-28, A3-8 / A2-18):
 * "Payment received", "Buyer paid", "Helpr pickup booked", "Picked up", "Delivered", "Handover done" and "Enjoy
 * your item" name the item, and "Enjoy your item" after a Helpr delivery says the buyer can tip, exactly when
 * helpr_task_tip_start (prod's body) would take a tip.
 *
 *   node src/test/pglite/declutterSaleNoticesNameInline.pglite.mjs                  # BEFORE then AFTER (3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSaleNoticesNameInline.pglite.mjs # RED: the bodies before it
 *   MUTANT=<name> node src/test/pglite/declutterSaleNoticesNameInline.pglite.mjs    # a planted defect: must FAIL
 *
 * World: the tables these functions read (columns as on prod), the notice writer from 20261028162048 +
 * 20261028171944 + 20261028191646 (its "Lamp: " prefix; the checks below read the combined text, so a double name fails), and the bodies before this migration: declutter_mark_order_paid from 20261028204431 (#26, this
 * branch), declutter_complete_handover from 20261027170717 rewritten by 20261027172503 (applied whole, as on
 * prod), declutter_delivery_on_task_event from 20261028200440 (the stack's seller-links fix), helpr_task_tip_start
 * from 20261028014848. complete_handover and tip_start are checked md5-equal to prod's pg_proc.prosrc (read
 * 2026-10-28) before anything runs. Stubbed, and said
 * so: helpr_task_confirm (confirms the task and writes its payout row, as the real one does), the fee-debt,
 * refund, close and handover-code helpers, the feature switch, auth.uid, net and vault.
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
const THIS = "20261028210552_declutter_sale_notices_name_inline.sql";
// declutter_delivery_on_task_event is 20261028200440's body (ready/b1-audit3-notices, under this migration in
// the stack: prod's 60c8ecd04abf90821dad40abf08e61fd with the seller's links to Selling), so it is not md5-checked.
const PROD_MD5 = {
  declutter_complete_handover: "67f7cfeedaa470fbda5bf93e7cd488d7",
  helpr_task_tip_start: "476bc26f4caa4648abcccf1806ae60ca",
};
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // "Buyer paid" without the item.
  buyerpaid: ["format('The buyer paid %s for %s. You get paid after the handover.', public.declutter_price_text(o.items_cents),\n           public.declutter_order_items_named(p_order_id)),",
    "format('The buyer paid for %s of your items. You get paid when the buyer has them.', public.declutter_price_text(o.items_cents)),"],
  // "Delivered" without the item.
  delivered: ["format('The Helpr left %s at the drop-off address. Tap \"I got it\", or report a problem within 24 hours.',\n             public.declutter_order_items_named(o.id)),",
    "'The Helpr left your item at the drop-off address. Tap \"I got it\", or report a problem within 24 hours.',"],
  // The tip line on every delivery, ready or not.
  tipalways: ["THEN ' You can add a tip for your Helpr in Buying.'", "OR o.handover = 'delivery' THEN ' You can add a tip for your Helpr in Buying.'"],
  // The tip check ignoring a block.
  tipblock: ["       AND NOT public.are_users_blocked(o.buyer_id, t.helpr_id)\n", ""],
  // The tip check ignoring a Helpr with no payout account and no pay waiting.
  tipheld: ["       AND (EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = t.helpr_id AND pr.stripe_account_id IS NOT NULL)\n            OR EXISTS", "       AND (true\n            OR EXISTS"],
  // Only the first of two items named.
  two: ["           WHEN 2 THEN format('\"%s\" and \"%s\"', (array_agg(i.title ORDER BY i.title))[1], (array_agg(i.title ORDER BY i.title))[2])\n", ""],
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
for (const [fn, md5] of Object.entries(PROD_MD5)) {
  const got = (await db.query(`select md5(prosrc) m from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [fn])).rows[0]?.m;
  check(got === md5, `[world] ${fn} is prod's body (md5 ${got})`);
}
await db.exec(`insert into auth.users values ('${SELLER}'), ('${BUYER}'), ('${HELPR}'), ('${HELPR_NOACCT}');
  insert into public.profiles (user_id, full_name, stripe_account_id) values ('${SELLER}', 'Sam Seller', 'acct_s'), ('${BUYER}', 'Bea Buyer', null),
    ('${HELPR}', 'Hal Helpr', 'acct_h'), ('${HELPR_NOACCT}', 'Nia Newhelpr', null);
  insert into public.notification_preferences (user_id) values ('${SELLER}'), ('${BUYER}'), ('${HELPR}'), ('${HELPR_NOACCT}');`);

const last = async (u, title) => (await db.query(`select message from public.notifications where user_id = $1 and title = $2 order by created_at desc limit 1`, [u, title])).rows[0]?.message;
const reset = () => db.exec(`delete from public.notifications; delete from public.declutter_cart_items; delete from public.declutter_orders;
  delete from public.declutter_items; delete from public.declutter_handovers; delete from public.declutter_payouts; delete from public.helpr_tasks;
  delete from public.declutter_order_deliveries; delete from public.helpr_task_payouts; delete from public.helpr_task_tips; delete from public.user_blocks;`);
let n = 0;
/** An order of `titles` for `handover`, awaiting payment; returns its id. */
async function order(handover, titles, { free = false } = {}) {
  const o = I(500 + ++n);
  await db.query(`insert into public.declutter_orders (id, buyer_id, seller_id, status, handover, items_cents, total_cents, paid_with)
    values ($1, $2, $3, 'awaiting_payment', $4, $5, $5, $6)`, [o, BUYER, SELLER, handover, free ? 0 : 3000, free ? "free" : null]);
  for (const [k, t] of titles.entries()) {
    const it = I(++n);
    await db.query(`insert into public.declutter_items (id, seller_id, title, status) values ($1, $2, $3, 'reserved')`, [it, SELLER, t]);
    // "In the order added": each line one second after the last. Two inserts can share now(), and the tie then falls
    // to the random line id (declutter_order_items_named orders by created_at, id), so the check flaked (b25 10-31:
    // red 4 of 4 runs on main 6a2acdd012, a different item first each time).
    await db.query(`insert into public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, order_id, status, checkout_by, created_at)
      values ($1, $2, $3, $4, $5, 'in_cart', now() + interval '1 day', now() + make_interval(secs => $6))`, [it, BUYER, SELLER, free ? 0 : Math.round(3000 / titles.length), o, k]);
  }
  return o;
}
const pay = (o) => db.query(`select public.declutter_mark_order_paid($1, $2, 3000, now(), 0)`, [o, `pi_${o.slice(-6)}`]);
/** A paid Helpr delivery whose Helpr has picked it up. */
async function deliveryPickedUp(titles, helpr = HELPR) {
  const o = await order("delivery", titles);
  await pay(o);
  const t = I(900 + n);
  await db.query(`insert into public.helpr_tasks (id, status, helpr_id, customer_id, title, pickup_slot_start) values ($1, 'picked_up', $2, $3, 'Delivery', now() + interval '1 day')`, [t, helpr, BUYER]);
  await db.query(`insert into public.declutter_order_deliveries values ($1, $2)`, [o, t]);
  return { o, t };
}
const event = (o, t, ev) => db.query(`select public.declutter_delivery_on_task_event($1, $2, $3, 'customer')`, [o, t, ev]);
const handover = (o, by = "buyer") => db.query(`select public.declutter_complete_handover($1, $2)`, [o, by]);
async function tipWorks(t) {
  await db.exec(`set request.jwt.claim.sub = '${BUYER}'`);
  try { await db.query(`select public.helpr_task_tip_start($1, 500, gen_random_uuid())`, [t]); return true; }
  catch { return false; }
  finally { await db.exec(`reset request.jwt.claim.sub`); }
}

async function scenarios() {
  const r = {};
  let o = await order("pickup_home", ["Lamp"]);
  await pay(o);
  r.received = await last(BUYER, "Payment received");
  r.buyerPaid = await last(SELLER, "Buyer paid");
  await handover(o);
  r.handoverDone = await last(SELLER, "Handover done");
  r.enjoy = await last(BUYER, "Enjoy your item");
  await reset();
  o = await order("pickup_home", ["Lamp", "Chair"]); await pay(o); r.two = await last(BUYER, "Payment received"); await reset();
  o = await order("pickup_home", ["Lamp", "Chair", "Rug"]); await pay(o); r.three = await last(SELLER, "Buyer paid"); await reset();
  o = await order("pickup_home", ["Chair"], { free: true });
  await db.query(`update public.declutter_orders set status = 'paid', paid_at = now() where id = $1`, [o]);
  await db.query(`update public.declutter_cart_items set status = 'paid' where order_id = $1`, [o]);
  await handover(o);
  r.freeSeller = await last(SELLER, "Handover done");
  r.freeBuyer = await last(BUYER, "Enjoy your item");
  await reset();
  // A Helpr delivery, end to end: booked, picked up, delivered, "I got it".
  let d = await deliveryPickedUp(["Desk"]);
  await event(d.o, d.t, "accepted");
  r.pickupBooked = await last(SELLER, "Helpr pickup booked");
  await event(d.o, d.t, "picked_up");
  r.pickedUp = await last(SELLER, "Picked up");
  await db.query(`update public.helpr_tasks set status = 'delivered' where id = $1`, [d.t]);
  await event(d.o, d.t, "delivered");
  r.delivered = await last(BUYER, "Delivered");
  await handover(d.o);
  r.deliveryEnjoy = await last(BUYER, "Enjoy your item");
  r.deliveryTip = await tipWorks(d.t);
  await reset();
  // The buyer blocked the Helpr: no tip, so no tip line.
  d = await deliveryPickedUp(["Desk"]);
  await db.query(`insert into public.user_blocks values ($1, $2)`, [BUYER, HELPR]);
  await handover(d.o);
  r.blockedEnjoy = await last(BUYER, "Enjoy your item");
  r.blockedTip = await tipWorks(d.t);
  await reset();
  // A Helpr with no payout account whose pay is no longer waiting (sent elsewhere): no tip, so no tip line.
  d = await deliveryPickedUp(["Desk"], HELPR_NOACCT);
  await db.query(`insert into public.helpr_task_payouts (task_id, helpr_id, status) values ($1, $2, 'nothing_due')`, [d.t, HELPR_NOACCT]);
  await handover(d.o);
  r.heldEnjoy = await last(BUYER, "Enjoy your item");
  r.heldTip = await tipWorks(d.t);
  await reset();
  // The same Helpr with pay still waiting: the tip is held with it, so the line shows.
  d = await deliveryPickedUp(["Desk"], HELPR_NOACCT);
  await handover(d.o);
  r.waitEnjoy = await last(BUYER, "Enjoy your item");
  r.waitTip = await tipWorks(d.t);
  await reset();
  return r;
}

const b = await scenarios();
console.log(`BEFORE  received: ${b.received} | buyer paid: ${b.buyerPaid} | delivered: ${b.delivered} | enjoy (delivery): ${b.deliveryEnjoy}`);
check(b.received === "Lamp: You paid $30. Next: choose your pickup time in Buying." && !/tip/.test(b.deliveryEnjoy ?? ""),
  `[before] the writer's prefix only ("${b.received}"), and no tip line`);

if (skip) console.log("NEW_MIGRATION=skip: the AFTER checks run on the bodies before it (expect FAILs)");
for (let i = 0; i < (skip ? 0 : 3); i++) {
  try { await db.exec(mig); check(true, `the migration applies (run ${i + 1} of 3)`); } catch (e) { check(false, `the migration applies (run ${i + 1} of 3): ${e.message}`); }
}
const a = await scenarios();
const TIP = " You can add a tip for your Helpr in Buying.";
check(a.received === 'You paid $30 for "Lamp". Next: choose your pickup time in Buying.', `[Payment received] "${a.received}"`);
check(a.buyerPaid === 'The buyer paid $30 for "Lamp". You get paid after the handover.', `[Buyer paid] "${a.buyerPaid}"`);
check(a.two === 'You paid $30 for "Lamp" and "Chair". Next: choose your pickup time in Buying.', `[two items] in the order added, no prefix: "${a.two}"`);
check(a.three === 'The buyer paid $30 for "Lamp" and 2 more items. You get paid after the handover.', `[three items] no prefix: "${a.three}"`);
check(a.handoverDone?.startsWith('The handover of "Lamp" is done. We send your $30 once the sale is final'), `[Handover done] "${a.handoverDone}"`);
check(a.enjoy === 'The handover of "Lamp" is done. If something is wrong with it, you can ask the seller for a refund within 24 hours. Leave the seller a review.',
  `[Enjoy your item] a pickup, no tip line: "${a.enjoy}"`);
check(a.freeSeller === 'Thank you for giving away "Chair". It has a new home.', `[Handover done, free] "${a.freeSeller}"`);
check(a.freeBuyer === 'The handover of "Chair" is done. Leave the giver a review.', `[Enjoy your item, free] "${a.freeBuyer}"`);
check(/^A Helpr picks up "Desk" \w{3} \w{3} \d+ at \d+:\d\d [AP]M\. Have it ready\.$/.test(a.pickupBooked ?? ""), `[Helpr pickup booked] "${a.pickupBooked}"`);
check(a.pickedUp === 'The Helpr picked up "Desk". You\'re paid when the buyer has it.', `[Picked up] "${a.pickedUp}"`);
check(a.delivered === 'The Helpr left "Desk" at the drop-off address. Tap "I got it", or report a problem within 24 hours.', `[Delivered] "${a.delivered}"`);
check(a.deliveryTip && a.deliveryEnjoy?.endsWith(TIP) && a.deliveryEnjoy.startsWith('The handover of "Desk" is done.'),
  `[tip] a done delivery: the tip line, and helpr_task_tip_start takes a tip (${a.deliveryTip}): "${a.deliveryEnjoy}"`);
check(!a.blockedTip && !a.blockedEnjoy?.includes("tip"), `[tip] the buyer blocked the Helpr: no tip (${a.blockedTip}), no line`);
check(!a.heldTip && !a.heldEnjoy?.includes("tip"), `[tip] a Helpr with no payout account and no pay waiting: no tip (${a.heldTip}), no line`);
check(a.waitTip && a.waitEnjoy?.endsWith(TIP), `[tip] a Helpr with no payout account and pay waiting: a held tip (${a.waitTip}), the line`);
for (const sig of ["public.declutter_order_items_named(uuid)", "public.declutter_delivery_tip_open(uuid)"]) {
  const r = (await db.query(`select p is not null e, p is not null and has_function_privilege('anon', p, 'execute') a,
    p is not null and has_function_privilege('authenticated', p, 'execute') b from (select to_regprocedure($1)::oid p) x`, [sig])).rows[0];
  check(r.e && !r.a && !r.b, `[grants] ${sig} exists and is not callable by anon or authenticated`);
}

console.log(failures ? `\n${failures} FAILED${MUTANT ? ` (mutant ${MUTANT})` : ""}` : `\nALL PASS${MUTANT ? ` (mutant ${MUTANT} was NOT caught)` : ""}`);
process.exit(failures ? 1 : 0);
