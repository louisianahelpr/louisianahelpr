#!/usr/bin/env node
/**
 * PGlite proof for *_declutter_notices_email_and_honest_sold (Declutter buy audit 11-08: H1, M1, M3, M4).
 *
 *   node src/test/pglite/declutterNoticesEmail.pglite.mjs                    # GREEN, the migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/declutterNoticesEmail.pglite.mjs # RED: the chain before it
 *   MUTANT=<name> node src/test/pglite/declutterNoticesEmail.pglite.mjs      # each must FAIL
 *
 * World, stubbed and said so: a notifications table with the columns the trigger reads; is_test_member (a fixed test
 * id); get_supabase_url/get_service_role_key (fixed strings); net.http_post (records each call in net_calls: the real
 * one queues a request to send-notification-email); log_notification (records); declutter_notify (records the notice
 * in notices; the real one runs declutter_notify_strict, which inserts the notifications row); declutter_notice_ref,
 * declutter_hold_length (30 min / 24 h / 48 h), declutter_price_text, seed_hidden_for, declutter_free_hold_charge_words,
 * member_display_name, needs_you_reminder_quiet (false), log_cron_defect. send_notice_email is the NEWEST real
 * definition before this migration (read from the migrations, never retyped).
 */
import { readdirSync } from "node:fs";
import { PGlite, readMigration, newestFunctionSql, checker } from "./seriesWorld.mjs";

const FILE = readdirSync(new URL("../../../supabase/migrations/", import.meta.url).pathname).find((f) => f.endsWith("_declutter_notices_email_and_honest_sold.sql"));
if (!FILE) throw new Error("migration *_declutter_notices_email_and_honest_sold.sql not found");
const VERSION = FILE.slice(0, 14);
let FIX = readMigration(FILE);
const MUTANTS = {
  // H1: the trigger emails nothing.
  noemail: ["  PERFORM public.send_notice_email(NEW.user_id, NEW.title, NEW.message, NEW.type, NEW.link, NULL);\n  RETURN NULL;", "  RETURN NULL;"],
  // H1: a test account is emailed.
  testmailed: ["  IF NEW.user_id IS NULL OR public.is_test_member(NEW.user_id) THEN", "  IF NEW.user_id IS NULL THEN"],
  // H1: the receipts are emailed twice.
  doublereceipt: ["          'Payment received', 'Buyer paid', 'Refund on its way',", "          'Refund on its way',"],
  // M1: the seller is told "Sold" on a Buy now tap again.
  soldtap: ["PERFORM public.declutter_notify(v_seller, 'declutter_sales', 'Someone''s buying your item',\n        format('Someone is checking out", "PERFORM public.declutter_notify(v_seller, 'new_offers', 'Sold: waiting for the buyer to pay',\n        format('Someone is checking out"],
  // M3: an ask with no time never closes.
  notimeopen: ["            OR (q.pickup_at IS NULL AND q.created_at <= p_now - interval '48 hours'))", "            OR false)"],
  // M3: an ask with no time closes at once.
  notimenow: ["OR (q.pickup_at IS NULL AND q.created_at <= p_now - interval '48 hours'))", "OR (q.pickup_at IS NULL))"],
  // M4: the old "charged automatically" words.
  oldcard: ["'We saved this card for your next Declutter buy. It''s charged only when you press Pay", "'Your card is saved. It is charged only when you buy"],
};
const MODE = process.env.NEW_MIGRATION ?? "";
for (const m of (process.env.MUTANT ?? "").split(",").filter(Boolean)) {
  const [from, to] = MUTANTS[m] ?? [];
  if (!from || !FIX.includes(from)) throw new Error(`mutant ${m}: anchor not found`);
  FIX = FIX.replace(from, to);
  console.log(`MUTANT=${m} (expect FAILs)`);
}
if (MODE) console.log(`NEW_MIGRATION=${MODE}: the chain before the fix (expect FAILs)`);
const { check, failures } = checker();

const BUYER = "a0000000-0000-0000-0000-000000000001";
const SELLER = "a0000000-0000-0000-0000-000000000002";
const TESTER = "a0000000-0000-0000-0000-000000000003";
const ITEM = "b0000000-0000-0000-0000-000000000001";
const ITEM2 = "b0000000-0000-0000-0000-000000000002";

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
await db.exec(`
  create schema auth; create schema net;
  create table auth.users (id uuid primary key);
  insert into auth.users values ('${BUYER}'), ('${SELLER}'), ('${TESTER}');
  create role anon; create role authenticated; create role service_role;
  create table public.profiles (user_id uuid primary key, full_name text, is_seed boolean default false);
  insert into public.profiles values ('${BUYER}', 'Bea Buyer', false), ('${SELLER}', 'Sam Seller', false), ('${TESTER}', 'Test T', true);
  create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, type text, title text,
    message text, link text, job_id uuid, declutter_ref uuid, created_at timestamptz default now());
  create table public.notices (id serial primary key, user_id uuid, type text, title text, message text, link text);
  create table public.net_calls (id serial primary key, url text, body jsonb);
  create table public.notification_logs (user_id uuid, category text, channel text, status text, subject text, job_id uuid, error text);
  create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as
    $f$ insert into public.net_calls (url, body) values (url, body) returning id::bigint $f$;
  create function public.get_supabase_url() returns text language sql stable as $f$ select 'https://x.supabase.co' $f$;
  create function public.get_service_role_key() returns text language sql stable as $f$ select 'k' $f$;
  create function public.log_notification(_user_id uuid, _category text, _channel text, _status text, _subject text default null,
    _job_id uuid default null, _error text default null, _message_id text default null) returns void language sql as
    $f$ insert into public.notification_logs values (_user_id, _category, _channel, _status, _subject, _job_id, _error) $f$;
  create function public.is_test_member(p uuid) returns boolean language sql stable as $f$ select p = '${TESTER}'::uuid $f$;
  create function public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid default null)
    returns void language sql as $f$ insert into public.notices (user_id, type, title, message, link) values (p_user, p_type, p_title, p_message, p_link) $f$;
  create function public.declutter_notify_strict(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid default null)
    returns void language sql as $f$ insert into public.notices (user_id, type, title, message, link) values (p_user, p_type, p_title, p_message, p_link) $f$;
  create function public.declutter_notice_ref(p uuid) returns void language sql as $f$ select null::void $f$;
  create function public.declutter_hold_length(p_price integer, p_source text) returns interval language sql immutable as
    $f$ select case when p_price = 0 then interval '48 hours' when p_source = 'buy' then interval '30 minutes' else interval '24 hours' end $f$;
  create function public.declutter_price_text(p integer) returns text language sql immutable as $f$ select '$' || (p / 100)::text $f$;
  create function public.seed_hidden_for(p uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.declutter_free_hold_charge_words(p uuid) returns text language sql stable as $f$ select '' $f$;
  create function public.member_display_name(n text, f text) returns text language sql immutable as $f$ select coalesce(split_part(n, ' ', 1), f) $f$;
  create function public.needs_you_reminder_quiet(p timestamptz) returns boolean language sql stable as $f$ select false $f$;
  create function public.log_cron_defect(a text, b text, c text, d jsonb) returns void language sql as $f$ select null::void $f$;
  create table public.declutter_items (id uuid primary key, seller_id uuid, title text, status text, is_seed boolean default false,
    current_price_cents integer default 300, updated_at timestamptz);
  create table public.declutter_offers (id uuid primary key default gen_random_uuid(), item_id uuid, buyer_id uuid, status text,
    closed_at timestamptz, updated_at timestamptz, voided_by_line uuid);
  create table public.declutter_offer_events (offer_id uuid, actor_side text, action text);
  create table public.declutter_cart_items (id uuid primary key default gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid,
    price_cents integer, source text, offer_id uuid, checkout_by timestamptz);
  create table public.declutter_free_requests (id uuid primary key default gen_random_uuid(), item_id uuid, requester_id uuid,
    seller_id uuid, status text default 'open', pickup_at timestamptz, created_at timestamptz default now(), closed_at timestamptz,
    giver_reminded_at timestamptz);
  create table public.declutter_buyer_cards (user_id uuid primary key, stripe_customer_id text, payment_method_id text, brand text,
    last4 text, card_mode text, saved_at timestamptz);
  create table public.stripe_customers (user_id uuid, wallet_mode text, stripe_customer_id text unique, primary key (user_id, wallet_mode));
`);
// The real chain before the fix, newest definitions only.
for (const n of ["send_notice_email", "declutter_take_item", "declutter_save_card", "sweep_declutter_free_asks"]) {
  await db.exec(newestFunctionSql(n, VERSION).sql);
}
if (MODE !== "skip") {
  // declutter_answer_bundle needs tables this world doesn't model: its body is created (plpgsql bodies are not
  // resolved at creation) and its one change is checked as text below.
  for (let i = 0; i < 3; i++) await db.exec(FIX);
}

// ── H1: which notices are emailed ────────────────────────────────────────────────────────────────────────────────
const before = Number((await q("select count(*)::int n from public.net_calls"))[0].n);
const rows = [
  [BUYER, "declutter_sales", "Reserved for you: check out within 30 minutes", true],
  [BUYER, "declutter_sales", "Reserved for you: check out within 24 hours", true],
  [SELLER, "declutter_offers", "New offer", true],
  [BUYER, "declutter_pickups", "It's on the porch: pick it up today", true],
  [BUYER, "declutter_refunds", "Send the item back", true],
  [SELLER, "declutter_sales", "Handover done", true],
  [BUYER, "declutter_sales", "Payment received", false],
  [SELLER, "declutter_sales", "Buyer paid", false],
  [SELLER, "declutter_sales", 'Your payout for "Lamp" is on its way', false],
  [BUYER, "declutter_sales", "Card saved", false],
  [BUYER, "declutter_sales", "New message about your order", false],
  [SELLER, "declutter_listings", "Your listing is live", false],
  [BUYER, "declutter_questions", "The seller answered", false],
  [BUYER, "job_updates", "Not Declutter", false],
  [TESTER, "declutter_sales", "Reserved for you: check out within 30 minutes", false],
];
for (const [u, t, title, want] of rows) {
  const n0 = Number((await q("select count(*)::int n from public.net_calls"))[0].n);
  await q("insert into public.notifications (user_id, type, title, message, link) values ($1, $2, $3, 'm', '/declutter?view=cart')", [u, t, title]);
  const n1 = Number((await q("select count(*)::int n from public.net_calls"))[0].n);
  check(`H1 ${want ? "emails" : "does not email"}: ${t} "${title}"${u === TESTER ? " (test account)" : ""}`, (n1 - n0 === 1) === want, `${n1 - n0} call(s)`);
}
const call = (await q("select url, body from public.net_calls order by id limit 1"))[0];
check("H1 the email goes to send-notification-email with the notice's own type (its email switch decides)",
  !!call && call.url.endsWith("/functions/v1/send-notification-email") && call.body.type === "declutter_sales" && call.body.user_id === BUYER,
  call ? `${call.url} ${call.body.type}` : "no call");
check("H1 floor: the action notices sent at least 6 emails", Number((await q("select count(*)::int n from public.net_calls"))[0].n) - before >= 6);

// ── M1: the seller is not told "Sold" on a tap ───────────────────────────────────────────────────────────────────
await q(`insert into public.declutter_items (id, seller_id, title, status) values ('${ITEM}', '${SELLER}', 'Brita bottle', 'live'), ('${ITEM2}', '${SELLER}', 'Cup', 'live')`);
await q(`select public.declutter_take_item('${ITEM}', '${BUYER}', 300, 'buy', null)`);
const tap = (await q(`select title, message from public.notices where user_id = '${SELLER}' order by id desc limit 1`))[0];
check('M1 Buy now: the seller hears "Someone\'s buying your item", not "Sold"', tap?.title === "Someone's buying your item" && /held for them for 30 minutes/.test(tap?.message ?? ""), tap?.title);
await q(`insert into public.declutter_offers (id, item_id, buyer_id, status) values ('c0000000-0000-0000-0000-000000000001', '${ITEM2}', '${BUYER}', 'open')`);
await q(`select public.declutter_take_item('${ITEM2}', '${BUYER}', 200, 'offer', 'c0000000-0000-0000-0000-000000000001')`);
const acc = (await q(`select title, message from public.notices where user_id = '${SELLER}' order by id desc limit 1`))[0];
check('M1 accepted offer: the seller hears "Someone\'s buying your item" with 24 hours', acc?.title === "Someone's buying your item" && /24 hours/.test(acc?.message ?? ""), acc?.title);
check("M1 no seller notice says Sold before payment", Number((await q(`select count(*)::int n from public.notices where user_id = '${SELLER}' and title ilike 'sold%'`))[0].n) === 0);
const bundle = (await q(`select prosrc from pg_proc where proname = 'declutter_answer_bundle'`))[0]?.prosrc ?? "";
check("M1 bundle: 'Bundle accepted: waiting for the buyer to pay', not 'Bundle sold'", bundle.includes("'Bundle accepted: waiting for the buyer to pay'") && !bundle.includes("Bundle sold"));

// ── M3: a free ask with no time ends after 48 hours ──────────────────────────────────────────────────────────────
const FREE = "b0000000-0000-0000-0000-000000000003";
await q(`insert into public.declutter_items (id, seller_id, title, status, current_price_cents) values ('${FREE}', '${SELLER}', 'Free chair', 'live', 0)`);
await q(`insert into public.declutter_free_requests (id, item_id, requester_id, seller_id, created_at) values
  ('d0000000-0000-0000-0000-000000000001', '${FREE}', '${BUYER}', '${SELLER}', now() - interval '49 hours'),
  ('d0000000-0000-0000-0000-000000000002', '${FREE}', '${TESTER}', '${SELLER}', now() - interval '47 hours')`);
await q("delete from public.notices");
await q("select public.sweep_declutter_free_asks(now())");
const st = Object.fromEntries((await q("select id::text, status from public.declutter_free_requests")).map((r) => [r.id.slice(-1), r.status]));
check("M3 an ask with no time made 49 h ago is closed", st["1"] === "expired", st["1"]);
check("M3 an ask with no time made 47 h ago stays open", st["2"] === "open", st["2"]);
const asker = (await q(`select title, message from public.notices where user_id = '${BUYER}'`))[0];
check('M3 the asker is told "Your ask ended" (48 hours, not "your time")', asker?.title === "Your ask ended" && /48 hours/.test(asker?.message ?? ""), asker?.title);
const giver = (await q(`select title, message from public.notices where user_id = '${SELLER}'`))[0];
check('M3 the giver is told "An ask ended" with the 48-hour words', giver?.title === "An ask ended" && /within 48 hours/.test(giver?.message ?? ""), giver?.message);

// ── M4: the card notice matches the payment page's consent line ──────────────────────────────────────────────────
await q("delete from public.notices");
await q(`select public.declutter_save_card('${BUYER}', 'cus_A1', 'pm_1', 'visa', '4242', 'live')`);
const card = (await q(`select title, message from public.notices where user_id = '${BUYER}'`))[0];
check('M4 "Card saved" uses the consent words, no bare "charged automatically" warning',
  card?.message === "We saved this card for your next Declutter buy. It's charged only when you press Pay, or automatically where you turned on automatic charges.", card?.message);

// ── grants ───────────────────────────────────────────────────────────────────────────────────────────────────────
const acl = (await q(`select proacl::text a from pg_proc where proname = 'email_declutter_notice'`))[0]?.a ?? "";
check("the trigger function is nobody's to call (no PUBLIC/anon/authenticated EXECUTE)", MODE === "skip" ? false : !/(^|[{,])(=|anon=|authenticated=)X/.test(acl), acl);

console.log(failures() ? `\n${failures()} FAIL` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
