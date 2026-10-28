#!/usr/bin/env node
/**
 * PGlite proof for 20261028204431_declutter_paid_notice_next_step (deep audit 2026-10-28, #26): the buyer's
 * "Payment received" (both paths) and the free claim's "It's yours" say what is true next, and keep "at the
 * time you chose" only where a booking exists.
 *
 *   node src/test/pglite/declutterPaidNoticeNextStep.pglite.mjs                 # BEFORE (prod's bodies) then AFTER (3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPaidNoticeNextStep.pglite.mjs  # RED: prod's bodies
 *   MUTANT=<name> node src/test/pglite/declutterPaidNoticeNextStep.pglite.mjs   # a planted defect: must FAIL
 *
 * World: the notice-copy proof's (src/test/pglite/declutterNoticeCopy.pglite.mjs: the tables these RPCs read,
 * columns as on prod), plus declutter_bookings and declutter_seller_deliveries (the columns the step reads, as on
 * prod 2026-10-28), then prod's bodies: 20261028162048 and 20261028171944 once (declutter_mark_order_paid as on
 * prod), declutter_checkout_free from 20261027170717 (both md5-equal to prod, read 2026-10-28). Stubbed, and said
 * so: the refund/fee helpers off the happy path, seed_hidden_for, auth.uid, is_caller_banned,
 * declutter_assert_member, member_display_name, net and vault. The seller-delivery status trigger
 * (trg_declutter_orders_seller_delivery, AFTER UPDATE OF status FOR EACH ROW) is a stand-in with the same timing
 * that books the slot, or sends it to needs_time when the slot was taken; the real one's other work (notices,
 * the slot lock) is not what this proves.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const KINDS = "20261028162048_declutter_notice_kinds.sql";
const COPY = "20261028171944_declutter_notice_copy.sql";
const THIS = "20261028204431_declutter_paid_notice_next_step.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The fixed line again on the normal path.
  fixed: ["format('You paid %s. %s', public.declutter_price_text(p_amount_cents), public.declutter_paid_next_step(p_order_id)),",
    "format('You paid %s. Next: pick up your items at the time you chose.', public.declutter_price_text(p_amount_cents)),"],
  // The late-payment path left with the fixed line.
  late: ["format('You paid %s in time, so the sale stands and there is no strike. %s',\n               public.declutter_price_text(p_amount_cents), public.declutter_paid_next_step(p_order_id)),",
    "format('You paid %s in time, so the sale stands and there is no strike. Next: pick up your items at the time you chose.',\n               public.declutter_price_text(p_amount_cents)),"],
  // A booking with no time counted as a booking.
  slotless: ["WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN", "WHERE b.order_id = o.id) THEN"],
  // Any seller-delivery row counted as booked.
  sdstatus: ["WHERE d.order_id = o.id AND d.status = 'booked' AND d.slot_start IS NOT NULL)", "WHERE d.order_id = o.id)"],
  // Helpr delivery told to pick up.
  helpr: ["    WHEN o.handover = 'delivery' THEN\n", "    WHEN false THEN\n"],
  // The free claim keeps its old line.
  free: ["'Your free item is set. Next: choose when to pick it up. Nothing was charged.',", "'Your free item is set. Next: pick it up at the time you chose. Nothing was charged.',"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replaceAll(m[0], m[1]);
}

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
const I = (n) => `33333333-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), BUYER = U(2);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create table public.profiles (user_id uuid primary key, is_seed boolean default false, full_name text);
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
  create function public.are_users_blocked(p1 uuid, p2 uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.feature_enabled_for_user(p_key text, p_user uuid) returns boolean language sql stable as $f$ select true $f$;
  create function public.declutter_member_out(p_user uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.member_under_18(p_user uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.seed_hidden_for(p_user uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.is_caller_banned() returns boolean language sql stable as $f$ select false $f$;
  create function public.declutter_assert_member(p_card boolean) returns uuid language sql stable as $f$ select auth.uid() $f$;
  create function public.member_display_name(p_full_name text, p_fallback text default 'A neighbor') returns text language sql immutable as
    $f$ select coalesce(nullif(p_full_name, ''), p_fallback) $f$;
  create table public.user_blocks (blocker_id uuid, blocked_id uuid);
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
    stripe_paid_at timestamptz, setup_fee_cents integer default 0, setup_fee_state text, paid_with text, created_at timestamptz default now());
  create table public.declutter_refunds (id uuid primary key default gen_random_uuid(), stripe_payment_intent_id text);
  create table public.declutter_strikes (id uuid, cart_line_id uuid, reason text, removed_at timestamptz);
  create table public.declutter_bookings (order_id uuid primary key, buyer_id uuid, seller_id uuid, slot_start timestamptz, slot_end timestamptz,
    buyer_rebooked boolean not null default false, created_at timestamptz default now());
  create table public.declutter_seller_deliveries (order_id uuid primary key, buyer_id uuid, seller_id uuid,
    status text not null check (status in ('held', 'booked', 'needs_time', 'released', 'cancelled', 'done')),
    slot_start timestamptz, slot_end timestamptz, slot_taken boolean not null default false);
  create function public.declutter_record_refund(p_order uuid, p_pi text, p_reason text, p_amount integer, p_fee integer) returns uuid language sql as
    $f$ insert into public.declutter_refunds (stripe_payment_intent_id) values (p_pi) returning id $f$;
  create function public.declutter_refund_answer(p_refund uuid) returns jsonb language sql as $f$ select jsonb_build_object('result', 'refunded') $f$;
  create function public.declutter_seller_out(p_user uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.declutter_seller_out_fee_notice(p_refund uuid) returns void language sql as $f$ select $f$;
  create function public.declutter_card_fee_estimate(p_cents integer) returns integer language sql immutable as $f$ select 0 $f$;
  create function public.declutter_claim_setup_fee(p_order uuid) returns void language sql as $f$ select $f$;
  -- Stand-in for trg_declutter_orders_seller_delivery (same timing: AFTER UPDATE OF status, FOR EACH ROW).
  create function public.sd_stand_in() returns trigger language plpgsql as $f$
  begin
    if new.handover = 'seller_delivery' and new.status = 'paid' and old.status is distinct from 'paid' then
      update public.declutter_seller_deliveries
         set status = case when slot_taken then 'needs_time' else 'booked' end,
             slot_start = case when slot_taken then null else slot_start end,
             slot_end = case when slot_taken then null else slot_end end
       where order_id = new.id and status in ('held', 'released');
    end if;
    return new;
  end $f$;
  create trigger trg_sd_stand_in after update of status on public.declutter_orders for each row execute function public.sd_stand_in();
`);
// Prod's bodies: the notice kinds and the notice copy once (mark_order_paid as on prod), the free checkout as on prod.
await db.exec(newestBefore("declutter_take_item", KINDS));
await db.exec(newestBefore("declutter_mark_order_paid", KINDS));
await db.exec(newestBefore("declutter_price_drop_alert", KINDS));
await db.exec(readFileSync(MIG_DIR + KINDS, "utf8"));
await db.exec(readFileSync(MIG_DIR + COPY, "utf8"));
await db.exec(newestBefore("declutter_checkout_free", THIS));
await db.exec(`insert into auth.users values ('${SELLER}'), ('${BUYER}');
  insert into public.profiles (user_id, full_name) values ('${SELLER}', 'Sam Seller'), ('${BUYER}', 'Bea Buyer');
  insert into public.notification_preferences (user_id) values ('${SELLER}'), ('${BUYER}');`);

const msg = async (title) => (await db.query(`select message from public.notifications where user_id = $1 and title = $2 order by created_at desc limit 1`, [BUYER, title])).rows[0]?.message;
const reset = () => db.exec(`delete from public.notifications; delete from public.declutter_cart_items; delete from public.declutter_orders;
  delete from public.declutter_items; delete from public.declutter_bookings; delete from public.declutter_seller_deliveries;
  delete from public.declutter_strikes;`);
let n = 0;
/** A paid order for `handover` (normal path). `setup(orderId)` runs before the payment lands. */
async function pay(handover, setup) {
  n++;
  await db.query(`insert into public.declutter_items (id, seller_id, title, status) values ($1, $2, $3, 'reserved')`, [I(n), SELLER, `Lamp ${n}`]);
  await db.query(`insert into public.declutter_orders (id, buyer_id, seller_id, status, handover, items_cents, total_cents) values ($1, $2, $3, 'awaiting_payment', $4, 3000, 3000)`, [I(100 + n), BUYER, SELLER, handover]);
  await db.query(`insert into public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, order_id, status, checkout_by) values ($1, $2, $3, 3000, $4, 'in_cart', now() + interval '1 day')`, [I(n), BUYER, SELLER, I(100 + n)]);
  if (setup) await setup(I(100 + n));
  await db.query(`select public.declutter_mark_order_paid($1, $2, 3000, now(), 0)`, [I(100 + n), `pi_ns${n}`]);
  return msg("Payment received");
}
/** The late-payment path (B41): the order expired for a missed checkout and the payment was in time. */
async function payLate(handover) {
  n++;
  await db.query(`insert into public.declutter_items (id, seller_id, title, status) values ($1, $2, $3, 'live')`, [I(n), SELLER, `Lamp ${n}`]);
  await db.query(`insert into public.declutter_orders (id, buyer_id, seller_id, status, handover, items_cents, total_cents, close_reason, closed_at) values ($1, $2, $3, 'expired', $4, 3000, 3000, 'missed_checkout', now())`, [I(100 + n), BUYER, SELLER, handover]);
  await db.query(`insert into public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, order_id, status, checkout_by) values ($1, $2, $3, 3000, $4, 'missed', now() - interval '10 minutes')`, [I(n), BUYER, SELLER, I(100 + n)]);
  const r = (await db.query(`select public.declutter_mark_order_paid($1, $2, 3000, now() - interval '20 minutes', 0) r`, [I(100 + n), `pi_ns${n}`])).rows[0].r;
  return { r, m: await msg("Payment received") };
}
async function claimFree(handover) {
  n++;
  await db.query(`insert into public.declutter_items (id, seller_id, title, status, price_cents, current_price_cents) values ($1, $2, $3, 'reserved', 0, 0)`, [I(n), SELLER, `Chair ${n}`]);
  await db.query(`insert into public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, status, checkout_by) values ($1, $2, $3, 0, 'in_cart', now() + interval '1 day')`, [I(n), BUYER, SELLER]);
  await db.exec(`set request.jwt.claim.sub = '${BUYER}'`);
  try { await db.query(`select public.declutter_checkout_free($1, $2)`, [SELLER, handover]); } finally { await db.exec(`reset request.jwt.claim.sub`); }
  return msg("It's yours");
}
const slot = (o, taken = false) => db.query(`insert into public.declutter_seller_deliveries (order_id, buyer_id, seller_id, status, slot_start, slot_end, slot_taken)
  values ($1, $2, $3, 'held', now() + interval '2 days', now() + interval '2 days 1 hour', $4)`, [o, BUYER, SELLER, taken]);

const PICK = "You paid $30. Next: choose your pickup time in Buying.";
const BOOKED = "You paid $30. Next: pick up your items at the time you chose.";
const HELPR = "You paid $30. Next: we're finding a Helpr to bring it to your door. We'll tell you when one takes it.";
const SD = "You paid $30. Next: the seller delivers at the time you chose.";
const SDNEW = "You paid $30. Next: pick a new delivery time in Buying.";
const LATE = "You paid $30 in time, so the sale stands and there is no strike. Next: choose your pickup time in Buying.";
const FREE = "Your free item is set. Next: choose when to pick it up. Nothing was charged.";

async function scenarios(tag) {
  const out = {};
  for (const h of ["pickup_home", "porch", "meetup"]) { out[h] = await pay(h); await reset(); }
  out.booked = await pay("pickup_home", (o) => db.query(`insert into public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end) values ($1, $2, $3, now() + interval '1 day', now() + interval '1 day 30 minutes')`, [o, BUYER, SELLER]));
  await reset();
  out.slotless = await pay("pickup_home", (o) => db.query(`insert into public.declutter_bookings (order_id, buyer_id, seller_id, buyer_rebooked) values ($1, $2, $3, false)`, [o, BUYER, SELLER]));
  await reset();
  out.delivery = await pay("delivery"); await reset();
  out.sd = await pay("seller_delivery", (o) => slot(o)); await reset();
  out.sdTaken = await pay("seller_delivery", (o) => slot(o, true)); await reset();
  out.late = await payLate("pickup_home"); await reset();
  out.free = await claimFree("pickup_home"); await reset();
  out.freePorch = await claimFree("porch"); await reset();
  console.log(`${tag}  pickup: ${out.pickup_home} | delivery: ${out.delivery} | free: ${out.free}`);
  return out;
}

// ── BEFORE: prod's bodies ──
const before = await scenarios("BEFORE");
check(before.pickup_home === BOOKED && before.delivery === BOOKED && before.free === "Your free item is set. Next: pick it up at the time you chose. Nothing was charged.",
  "[before] prod says \"at the time you chose\" with no time chosen (pickup, Helpr delivery, free)");

// ── AFTER: this migration, three times ──
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: the AFTER checks run on prod's bodies (expect FAILs)");
for (let i = 0; i < (skip ? 0 : 3); i++) {
  try { await db.exec(mig); check(true, `the migration applies (run ${i + 1} of 3)`); } catch (e) { check(false, `the migration applies (run ${i + 1} of 3): ${e.message}`); }
}
const a = await scenarios("AFTER ");
for (const h of ["pickup_home", "porch", "meetup"]) check(a[h] === PICK, `[pickup] ${h}, nothing booked yet: "${a[h]}"`);
check(a.booked === BOOKED, `[pickup] a booked pickup keeps "at the time you chose": "${a.booked}"`);
check(a.slotless === PICK, `[pickup] a booking row with no time (given up, not rebooked) is not a time chosen: "${a.slotless}"`);
check(a.delivery === HELPR, `[delivery] a Helpr delivery: "${a.delivery}"`);
check(a.sd === SD, `[seller delivery] booked by the status trigger in the same update: "${a.sd}"`);
check(a.sdTaken === SDNEW, `[seller delivery] slot taken meanwhile (needs_time): "${a.sdTaken}"`);
check(a.late.r?.result === "paid" && a.late.m === LATE, `[late] the in-time late payment: "${a.late.m}" (${JSON.stringify(a.late.r)})`);
check(a.free === FREE && a.freePorch === FREE, `[free] the free claim, home and porch: "${a.free}" / "${a.freePorch}"`);
const r = (await db.query(`select p is not null e, p is not null and has_function_privilege('anon', p, 'execute') a,
  p is not null and has_function_privilege('authenticated', p, 'execute') b
  from (select to_regprocedure('public.declutter_paid_next_step(uuid)')::oid p) x`)).rows[0];
check(r.e && !r.a && !r.b, "[grants] declutter_paid_next_step exists and is not callable by anon or authenticated");

console.log(failures ? `\n${failures} FAILED${MUTANT ? ` (mutant ${MUTANT})` : ""}` : `\nALL PASS${MUTANT ? ` (mutant ${MUTANT} was NOT caught)` : ""}`);
process.exit(failures ? 1 : 0);
