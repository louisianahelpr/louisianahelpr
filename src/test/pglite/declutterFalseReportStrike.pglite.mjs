#!/usr/bin/env node
/**
 * PGlite proof for 20261029000048_declutter_false_report_strike.sql (Declutter anti-lying #5, owner 2026-10-28):
 * when an admin decides a reported problem was false, the REPORTER gets a Declutter strike (reason 'false_report',
 * the existing strike system: 3 active = locked out of Declutter). The choice is explicit (p_false_report), goes
 * against the reporter only, and the five-argument call an installed admin screen sends still decides as before.
 *
 *   node src/test/pglite/declutterFalseReportStrike.pglite.mjs                  # BEFORE then AFTER (3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterFalseReportStrike.pglite.mjs # RED: the body before it
 *   MUTANT=<name> node src/test/pglite/declutterFalseReportStrike.pglite.mjs    # a planted defect: must FAIL
 *
 * World: the decision-notice proof's (src/test/pglite/declutterProblemDecisionNotices.pglite.mjs, verbatim up to
 * its scenarios: tables as on prod, its stubs, prod's declutter_admin_decide_problem md5-checked), then
 * 20261028223738 (the newest body this migration restates). REAL here, not stubbed: the declutter_strikes table
 * (its CREATE from 20261014193955 + cart_line_id from 20261014224914), declutter_give_strike (20261028223036),
 * declutter_active_strike_count and declutter_assert_member (20261014193955).
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
const MINE = "20261029000048_declutter_false_report_strike.sql";
// declutter_delivery_on_task_event is 20261028200440's body (ready/b1-audit3-notices, under this migration in
// the stack: prod's 60c8ecd04abf90821dad40abf08e61fd with the seller's links to Selling), so it is not md5-checked.
const PROD_MD5 = { declutter_admin_decide_problem: "66b2b598b83648f9b596099c3ac73179", declutter_admin_decide_delivery_damage: "b39f9cdbebc1012e6a6ba5db4ff76055" };
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The reporter never gets the strike.
  nostrike: ["  IF p_false_report THEN\n    UPDATE public.declutter_problems SET strike_given = true", "  IF false THEN\n    UPDATE public.declutter_problems SET strike_given = true"],
  // The strike always goes to the buyer, whoever reported.
  tobuyer: ["    PERFORM public.declutter_give_strike(p.reporter_id, p.reporter_side, 'false_report',", "    PERFORM public.declutter_give_strike(o.buyer_id, 'buyer', 'false_report',"],
  // A false report decided in the reporter's favour (or on a Helpr's report) is not refused.
  nomatch: ["  IF p_false_report AND (p.reporter_side NOT IN ('buyer', 'seller')", "  IF false AND (p.reporter_side NOT IN ('buyer', 'seller')"],
  // Two strikes for one false report (the at-fault strike on top).
  double: ["     OR p_false_report IS NULL OR (p_false_report AND p_strike) THEN", "     OR p_false_report IS NULL THEN"],
  // NULL treated as "no".
  nullok: ["     OR p_false_report IS NULL OR (p_false_report AND p_strike) THEN", "     OR (p_false_report AND p_strike) THEN"],
  // The wrong reason (the sale's failure, as the old at-fault strike).
  reason: ["    PERFORM public.declutter_give_strike(p.reporter_id, p.reporter_side, 'false_report',", "    PERFORM public.declutter_give_strike(p.reporter_id, p.reporter_side, 'not_as_described',"],
  // The grant left open to anon.
  anon: ["boolean) FROM PUBLIC, anon;", "boolean) FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION public.declutter_admin_decide_problem(uuid, text, text, boolean, text, boolean) TO anon;"],
};
const skip = process.env.NEW_MIGRATION === "skip";
let mig = readFileSync(MIG_DIR + MINE, "utf8");
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


// The newest body before this migration, and the REAL strike system.
await db.exec(readFileSync(MIG_DIR + THIS, "utf8"));
const FOUNDATION = readFileSync(MIG_DIR + "20261014193955_declutter_foundation.sql", "utf8");
await db.exec(`drop table public.declutter_strikes;
  ${FOUNDATION.match(/CREATE TABLE IF NOT EXISTS public\.declutter_strikes \([\s\S]*?\n\);/)[0]}
  alter table public.declutter_strikes add column if not exists cart_line_id uuid references public.declutter_cart_items(id) on delete set null;`);
await db.exec(newestBefore("declutter_give_strike", MINE));
await db.exec(newestBefore("declutter_active_strike_count", MINE));
await db.exec(newestBefore("declutter_assert_member", MINE));
const conname = (await db.query(`select conname from pg_constraint where conrelid = 'public.declutter_strikes'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%missed_checkout%'`)).rows[0]?.conname;
check(conname === "declutter_strikes_reason_check", `[world] the reason CHECK has prod's name (${conname})`);

const ADMIN = U(9), MEMBER = U(8);
await db.exec(`insert into auth.users values ('${ADMIN}'), ('${MEMBER}'); insert into public.user_roles values ('${ADMIN}', 'admin');
  insert into public.profiles (user_id, full_name) values ('${MEMBER}', 'Mo Member');`);
let n = 0;
/** A paid sale with an open problem reported by `side`. */
async function problem({ side = "buyer", status = "paid", reason = "not_received" } = {}) {
  const o = I(800 + ++n), it = I(++n);
  await db.query(`insert into public.declutter_orders (id, buyer_id, seller_id, status, handover, items_cents, total_cents) values ($1, $2, $3, $4, 'pickup_home', 3000, 3000)`, [o, BUYER, SELLER, status]);
  await db.query(`insert into public.declutter_items (id, seller_id, title, status) values ($1, $2, 'Lamp', 'sold')`, [it, SELLER]);
  await db.query(`insert into public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, order_id, status) values ($1, $2, $3, 3000, $4, 'paid')`, [it, BUYER, SELLER, o]);
  const who = side === "buyer" ? BUYER : side === "seller" ? SELLER : HELPR;
  return (await db.query(`insert into public.declutter_problems (order_id, status, reporter_id, reporter_side, reason, note) values ($1, 'open', $2, $3, $4, 'It never came') returning id`, [o, who, side, reason])).rows[0].id;
}
async function as(uid, sql, params = []) {
  await db.exec(`set request.jwt.claim.sub = '${uid}'`);
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: e.message }; } finally { await db.exec(`reset request.jwt.claim.sub`); }
}
const decide6 = (pid, decision, fault, strike, fr, uid = ADMIN) =>
  as(uid, `select public.declutter_admin_decide_problem($1, $2, $3, $4, 'checked', $5) as r`, [pid, decision, fault, strike, fr]);
const strikes = async (u) => (await db.query(`select reason, offender_side from public.declutter_strikes where user_id = $1 order by given_at, id`, [u])).rows;
const status = async (pid) => (await db.query(`select status, strike_given from public.declutter_problems where id = $1`, [pid])).rows[0];
const clearStrikes = () => db.exec(`delete from public.declutter_strikes; delete from public.notifications;`);

// BEFORE: there is no explicit false-report choice; the only strike is the at-fault one, with the sale's reason.
const b0 = await problem();
const before6 = await decide6(b0, "pay_seller", "buyer", false, true);
check(/does not exist/.test(before6.error ?? ""), `[before] no six-argument decision exists (${before6.error ?? "it ran"})`);
await clearStrikes();
if (skip) console.log("NEW_MIGRATION=skip: the AFTER checks run on the body before it (expect FAILs)");
for (let i = 0; i < (skip ? 0 : 3); i++) {
  try { await db.exec(mig); check(true, `the migration applies (run ${i + 1} of 3)`); } catch (e) { check(false, `the migration applies (run ${i + 1} of 3): ${e.message}`); }
}

// 1. A buyer's false report: the seller is paid, the BUYER gets a 'false_report' strike, told so; the seller none.
const p1 = await problem();
const r1 = await decide6(p1, "pay_seller", "buyer", false, true);
check(!r1.error, `[buyer] the admin decides "the report was false" (${r1.error ?? "ok"})`);
const s1 = await strikes(BUYER);
check(s1.length === 1 && s1[0].reason === "false_report" && s1[0].offender_side === "buyer", `[buyer] the reporter has one false_report strike (${JSON.stringify(s1)})`);
check((await strikes(SELLER)).length === 0, "[buyer] the seller gets no strike");
const st1 = await status(p1);
check(st1?.status === "decided" && st1?.strike_given === true, `[buyer] the problem is decided, strike_given recorded (${JSON.stringify(st1)})`);
const told1 = (await db.query(`select message from public.notifications where user_id = $1 and title = 'You got a Declutter strike'`, [BUYER])).rows;
check(told1.length === 1 && /found it was not true\. You have 1 of 3 strikes/.test(told1[0].message), `[buyer] told why, and the count (${told1[0]?.message})`);
const audit1 = (await db.query(`select details from public.admin_audit_log where target_id = $1`, [p1])).rows[0]?.details;
check(audit1?.false_report === true, "[buyer] the audit row says false_report");
await clearStrikes();

// 2. A seller's false report: the buyer is refunded, the SELLER gets the strike.
const p2 = await problem({ side: "seller", reason: "no_show" });
const r2 = await decide6(p2, "refund_buyer", "seller", false, true);
check(!r2.error, `[seller] decided (${r2.error ?? "ok"})`);
const s2 = await strikes(SELLER);
check(s2.length === 1 && s2[0].reason === "false_report" && s2[0].offender_side === "seller", `[seller] the reporter (seller) has the strike (${JSON.stringify(s2)})`);
check((await strikes(BUYER)).length === 0, "[seller] the buyer gets no strike");
await clearStrikes();

// 3. Refused, and nothing changes: the decision in the reporter's favour, the wrong side at fault, nobody's fault,
//    a Helpr's report, a second strike on top, and NULL.
for (const [label, opts, args, code] of [
  ["buyer's report, refund the buyer", {}, ["refund_buyer", "buyer", false, true], "false_report_mismatch"],
  ["buyer's report, the seller at fault", {}, ["pay_seller", "seller", false, true], "false_report_mismatch"],
  ["buyer's report, nobody at fault", {}, ["pay_seller", "none", false, true], "false_report_mismatch"],
  ["seller's report, pay the seller", { side: "seller", reason: "no_show" }, ["pay_seller", "seller", false, true], "false_report_mismatch"],
  ["a Helpr's report", { side: "helpr" }, ["refund_buyer", "seller", false, true], "false_report_mismatch"],
  ["the at-fault strike on top", {}, ["pay_seller", "buyer", true, true], "invalid_decision"],
  ["NULL", {}, ["pay_seller", "buyer", false, null], "invalid_decision"],
]) {
  const pid = await problem(opts);
  const r = await decide6(pid, ...args);
  const st = await status(pid);
  check((r.error ?? "").includes(code) && st?.status === "open" && (await strikes(BUYER)).length === 0 && (await strikes(SELLER)).length === 0,
    `[refused] ${label}: ${code}, still open, no strike (${r.error ?? "it ran"})`);
}

// 4. The five arguments an installed admin screen sends still decide as before: no false-report strike; the
//    at-fault strike keeps its reason.
const p4 = await problem();
const r4 = await as(ADMIN, `select public.declutter_admin_decide_problem(p_problem_id => $1, p_decision => 'pay_seller', p_fault => 'buyer', p_strike => true, p_note => 'x') as r`, [p4]);
const s4 = await strikes(BUYER);
check(!r4.error && s4.length === 1 && s4[0].reason === "not_picked_up", `[old call] five named arguments decide as before (${r4.error ?? JSON.stringify(s4)})`);
await clearStrikes();
const p4b = await problem();
const r4b = await as(ADMIN, `select public.declutter_admin_decide_problem($1, 'pay_seller', 'none', false, 'x') as r`, [p4b]);
check(!r4b.error && (await strikes(BUYER)).length === 0, `[old call] five positional arguments, no strike (${r4b.error ?? "ok"})`);
const oldFn = (await db.query(`select to_regprocedure('public.declutter_admin_decide_problem(uuid, text, text, boolean, text)')::text as f`)).rows[0].f;
check(oldFn === null, `[old call] the five-argument function itself is gone, one function for PostgREST (${oldFn})`);

// 5. Three proven false reports: locked out of Declutter (the existing rule, declutter_assert_member).
for (let k = 0; k < 3; k++) await decide6(await problem(), "pay_seller", "buyer", false, true);
check((await db.query(`select public.declutter_active_strike_count($1) as c`, [BUYER])).rows[0].c === 3, "[3 strikes] three false_report strikes count");
const locked = await as(BUYER, `select public.declutter_assert_member(false)`);
check((locked.error ?? "").includes("declutter_strikes_blocked"), `[3 strikes] the reporter is locked out of Declutter (${locked.error ?? "not locked"})`);
await clearStrikes();

// 6. Only an admin decides; grants.
const p6 = await problem();
const r6 = await decide6(p6, "pay_seller", "buyer", false, true, MEMBER);
check((r6.error ?? "").includes("not_authorized") && (await strikes(BUYER)).length === 0, `[authz] an ordinary account is refused (${r6.error ?? "it ran"})`);
const SIG = "public.declutter_admin_decide_problem(uuid, text, text, boolean, text, boolean)";
const priv = skip ? { anon: null, auth: null } : (await db.query(`select has_function_privilege('anon', '${SIG}', 'execute') as anon, has_function_privilege('authenticated', '${SIG}', 'execute') as auth`)).rows[0];
check(priv.anon === false && priv.auth === true, `[grants] anon cannot call it, the signed-in admin screen can (${JSON.stringify(priv)})`);

console.log(failures ? `\n${failures} FAILED${MUTANT ? ` (mutant ${MUTANT})` : ""}` : `\nALL PASS${MUTANT ? ` (mutant ${MUTANT} was NOT caught)` : ""}`);
process.exit(failures ? 1 : 0);
