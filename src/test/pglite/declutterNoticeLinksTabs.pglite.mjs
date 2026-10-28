#!/usr/bin/env node
/**
 * PGlite proof for 20261028223036_declutter_notice_links_open_the_right_tab (deep audit 2026-10-28, #37): the
 * restated Declutter notices open the recipient's own tab (?tab=selling / ?tab=buying), and a strike follows the
 * side it was given for. All twelve restated functions are applied 3x on top of this stack's previous migrations.
 *
 *   node src/test/pglite/declutterNoticeLinksTabs.pglite.mjs                  # BEFORE then AFTER (3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterNoticeLinksTabs.pglite.mjs # RED: the links before it
 *   MUTANT=<name> node src/test/pglite/declutterNoticeLinksTabs.pglite.mjs    # a planted defect: must FAIL
 *
 * World: the sale-notice proof's (src/test/pglite/declutterSaleNoticesNameInline.pglite.mjs: the tables these
 * functions read, columns as on prod, the notice writer, and the stack's bodies through 20261028210552), plus the
 * strike columns declutter_give_strike writes. Stubbed, and said so: as there, plus declutter_active_strike_count
 * (counts the rows) and declutter_assert_member. The other nine restated functions are applied (3x) but not run
 * here; the class guard reads their links (src/test/declutterSellerNoticesOpenSelling.test.ts).
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
const THIS = "20261028223036_declutter_notice_links_open_the_right_tab.sql";
const PROD_MD5 = {};
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // A seller's "Handover done" back to the old address.
  handover: ["'/declutter?tab=selling', o.buyer_id);\n  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Enjoy your item',", "'/declutter?view=selling', o.buyer_id);\n  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Enjoy your item',"],
  // Every strike to the buyer's side.
  strike: ["'/declutter?tab=' || CASE WHEN p_side = 'seller' THEN 'selling' ELSE 'buying' END", "'/declutter?tab=buying'"],
  // The free claim's seller notice to the either-side offers address again.
  free: ["COALESCE(v_taker, 'Someone') || ' is picking up your free item. Nothing to pay and nothing to set up.',\n    '/declutter?tab=selling', v_uid);", "COALESCE(v_taker, 'Someone') || ' is picking up your free item. Nothing to pay and nothing to set up.',\n    '/declutter?view=offers', v_uid);"],
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
await db.exec(`alter table public.declutter_strikes add column if not exists user_id uuid, add column if not exists offender_side text,
    add column if not exists item_id uuid, add column if not exists given_at timestamptz, add column if not exists expires_at timestamptz;
  alter table public.declutter_strikes alter column id set default gen_random_uuid();
  -- Row types the restated functions declare (only the type is needed to apply them; they are not run here).
  create table if not exists public.declutter_haul_aways (id uuid primary key default gen_random_uuid(), seller_id uuid, job_id uuid, status text);
  create function public.declutter_active_strike_count(p_user uuid) returns integer language sql stable as
    $f$ select count(*)::int from public.declutter_strikes s where s.user_id = p_user and s.removed_at is null $f$;
  create function public.declutter_assert_member(p_card boolean) returns uuid language sql stable as $f$ select auth.uid() $f$;
  create function public.member_display_name(p_full_name text, p_fallback text default 'A neighbor') returns text language sql immutable as
    $f$ select coalesce(nullif(p_full_name, ''), p_fallback) $f$;`);
await db.exec(newestBefore("declutter_give_strike", THIS));
await db.exec(newestBefore("declutter_checkout_free", ITEM3));
await db.exec(readFileSync(MIG_DIR + ITEM3, "utf8"));
for (const [fn, md5] of Object.entries(PROD_MD5)) {
  const got = (await db.query(`select md5(prosrc) m from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [fn])).rows[0]?.m;
  check(got === md5, `[world] ${fn} is prod's body (md5 ${got})`);
}
await db.exec(`insert into auth.users values ('${SELLER}'), ('${BUYER}'), ('${HELPR}'), ('${HELPR_NOACCT}');
  insert into public.profiles (user_id, full_name, stripe_account_id) values ('${SELLER}', 'Sam Seller', 'acct_s'), ('${BUYER}', 'Bea Buyer', null),
    ('${HELPR}', 'Hal Helpr', 'acct_h'), ('${HELPR_NOACCT}', 'Nia Newhelpr', null);
  insert into public.notification_preferences (user_id) values ('${SELLER}'), ('${BUYER}'), ('${HELPR}'), ('${HELPR_NOACCT}');`);

const link = async (u, title) => (await db.query(`select link from public.notifications where user_id = $1 and title = $2 order by created_at desc limit 1`, [u, title])).rows[0]?.link;
const reset = () => db.exec(`delete from public.notifications; delete from public.declutter_cart_items; delete from public.declutter_orders;
  delete from public.declutter_items; delete from public.declutter_handovers; delete from public.declutter_payouts; delete from public.declutter_strikes;`);
let n = 0;
async function scenarios() {
  const r = {};
  // A paid pickup, handed over: the seller's "Handover done".
  let o = I(700 + ++n), it = I(++n);
  await db.query(`insert into public.declutter_orders (id, buyer_id, seller_id, status, handover, items_cents, total_cents) values ($1, $2, $3, 'paid', 'pickup_home', 3000, 3000)`, [o, BUYER, SELLER]);
  await db.query(`insert into public.declutter_items (id, seller_id, title, status) values ($1, $2, 'Lamp', 'sold')`, [it, SELLER]);
  await db.query(`insert into public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, order_id, status) values ($1, $2, $3, 3000, $4, 'paid')`, [it, BUYER, SELLER, o]);
  await db.query(`select public.declutter_complete_handover($1, 'buyer')`, [o]);
  r.handoverDone = await link(SELLER, "Handover done");
  r.enjoy = await link(BUYER, "Enjoy your item");
  await reset();
  // Strikes, one for each side.
  await db.query(`select public.declutter_give_strike($1, 'buyer', 'missed_checkout', null, 'You did not check out in time.')`, [BUYER]);
  await db.query(`select public.declutter_give_strike($1, 'seller', 'seller_no_show', null, 'You were not there for the pickup.')`, [SELLER]);
  r.buyerStrike = await link(BUYER, "You got a Declutter strike");
  r.sellerStrike = await link(SELLER, "You got a Declutter strike");
  await reset();
  // A free claim: the giver's "Free item claimed", the taker's "It's yours".
  it = I(++n);
  await db.query(`insert into public.declutter_items (id, seller_id, title, status, price_cents, current_price_cents) values ($1, $2, 'Chair', 'reserved', 0, 0)`, [it, SELLER]);
  await db.query(`insert into public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, status, checkout_by) values ($1, $2, $3, 0, 'in_cart', now() + interval '1 day')`, [it, BUYER, SELLER]);
  await db.exec(`set request.jwt.claim.sub = '${BUYER}'`);
  try { await db.query(`select public.declutter_checkout_free($1, 'pickup_home')`, [SELLER]); } finally { await db.exec(`reset request.jwt.claim.sub`); }
  r.freeClaimed = await link(SELLER, "Free item claimed");
  r.itsYours = await link(BUYER, "It's yours");
  await reset();
  return r;
}

const b = await scenarios();
console.log(`BEFORE  ${JSON.stringify(b)}`);
check(b.handoverDone === "/declutter?view=selling" && b.sellerStrike === "/declutter?view=offers" && b.freeClaimed === "/declutter?view=offers",
  "[before] the seller's notices used the old addresses (a strike and a free claim the either-side ?view=offers)");
if (skip) console.log("NEW_MIGRATION=skip: the AFTER checks run on the links before it (expect FAILs)");
for (let i = 0; i < (skip ? 0 : 3); i++) {
  try { await db.exec(mig); check(true, `the migration applies, all twelve functions (run ${i + 1} of 3)`); } catch (e) { check(false, `the migration applies (run ${i + 1} of 3): ${e.message}`); }
}
const a = await scenarios();
console.log(`AFTER   ${JSON.stringify(a)}`);
check(a.handoverDone === "/declutter?tab=selling", `[seller] "Handover done" opens Selling: ${a.handoverDone}`);
check(a.enjoy === "/declutter?view=cart", `[buyer] "Enjoy your item" is unchanged: ${a.enjoy}`);
check(a.buyerStrike === "/declutter?tab=buying", `[strike] a buyer's strike opens Buying: ${a.buyerStrike}`);
check(a.sellerStrike === "/declutter?tab=selling", `[strike] a seller's strike opens Selling: ${a.sellerStrike}`);
check(a.freeClaimed === "/declutter?tab=selling", `[seller] "Free item claimed" opens Selling: ${a.freeClaimed}`);
check(a.itsYours === "/declutter?view=cart", `[buyer] "It's yours" is unchanged: ${a.itsYours}`);
for (const fn of ["declutter_handover_sweep", "declutter_seller_delivery_on_order", "declutter_deadline_sweep", "declutter_respond_offer",
  "declutter_make_offer", "declutter_pause_listing", "declutter_withdraw_item", "declutter_listing_round_close_offers", "declutter_link_haul_away"]) {
  const src = (await db.query(`select string_agg(prosrc, '') s from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [fn])).rows[0]?.s ?? "";
  check(src.length > 0 && !src.includes("?view=offers"), `[applied] ${fn} is in the database with no ?view=offers link`);
}

console.log(failures ? `\n${failures} FAILED${MUTANT ? ` (mutant ${MUTANT})` : ""}` : `\nALL PASS${MUTANT ? ` (mutant ${MUTANT} was NOT caught)` : ""}`);
process.exit(failures ? 1 : 0);
