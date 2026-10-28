#!/usr/bin/env node
/**
 * PGlite proof for 20261028171944_declutter_notice_copy (lead 2026-10-28, from the Declutter audit's read of
 * live notice text): "Reserved for you" instead of "It's yours" before payment, prices the way the app shows
 * them ("$30", "$30.50"), and the seller's "Sold: waiting..." / "Buyer paid" notices opening Selling.
 *
 *   node src/test/pglite/declutterNoticeCopy.pglite.mjs                  # BEFORE (prod's bodies) then AFTER (3x)
 *   MUTANT=<name> node src/test/pglite/declutterNoticeCopy.pglite.mjs    # a planted defect: must FAIL
 *
 * World: the tables declutter_take_item and declutter_mark_order_paid's paid path read (columns as on prod,
 * read 2026-10-28), notifications with a uuid id, the 20261028162048 notice kinds applied once as the base, and
 * prod's bodies of the two RPCs (newest repo definitions, md5-equal to prod's prosrc 2026-10-28). Stubbed, and
 * said so: seed_hidden_for, the refund/fee helpers mark_order_paid calls only off the happy path
 * (declutter_record_refund, declutter_refund_answer, declutter_seller_out_fee_notice), declutter_seller_out,
 * declutter_card_fee_estimate, declutter_claim_setup_fee, log_cron_defect (a table), net and vault.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const BASE = "20261028162048_declutter_notice_kinds.sql";
const THIS = "20261028171944_declutter_notice_copy.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The old title.
  title: ["  PERFORM public.declutter_notify(p_buyer, 'payment', 'Reserved for you: check out within 48 hours',", "  PERFORM public.declutter_notify(p_buyer, 'payment', 'It''s yours: check out within 48 hours',"],
  // The price rule dropped from the one writer.
  words: ["          public.declutter_price_words(p_message), p_link);", "          p_message, p_link);"],
  // Cents shown as ".00" again.
  cents: ["              WHEN p_cents % 100 = 0 THEN '$' || (p_cents / 100)::text", "              WHEN false THEN NULL"],
  // A rule that also cuts "$30.50" to "$30".
  greedy: ["'\\$([0-9]+)\\.00(?![0-9])'", "'\\$([0-9]+)\\.[0-9]{2}'"],
  // The seller's sold notice opens Offers again.
  soldlink: ["    format('\"%s\" sold for %s. The buyer has 48 hours to check out and pay.', v_title, v_price),\n    '/declutter?view=selling', p_buyer);", "    format('\"%s\" sold for %s. The buyer has 48 hours to check out and pay.', v_title, v_price),\n    '/declutter?view=offers', p_buyer);"],
  // "Buyer paid" opens Offers again.
  paidlink: ["    format('The buyer paid for %s of your items. You get paid when the buyer has them.', public.declutter_price_text(o.items_cents)),\n    '/declutter?view=selling', o.buyer_id);", "    format('The buyer paid for %s of your items. You get paid when the buyer has them.', public.declutter_price_text(o.items_cents)),\n    '/declutter?view=offers', o.buyer_id);"],
  // (The renamed title dropped from the Sales list still routes to Sales by its old type, so that defect is
  // caught by src/test/declutterNoticeKinds.test.ts, which requires every title listed explicitly.)
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
const I = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), BUYER = U(2), OTHER = U(3);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema auth; create table auth.users (id uuid primary key);
  create table public.profiles (user_id uuid primary key, is_seed boolean default false);
  create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text,
    type text, read boolean default false, link text, created_at timestamptz default now(), job_id uuid);
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
  create table public.user_blocks (blocker_id uuid, blocked_id uuid);
  create table public.declutter_items (id uuid primary key, seller_id uuid not null, status text not null default 'live', title text not null,
    price_cents integer not null default 5000, current_price_cents integer not null default 5000, is_seed boolean not null default false,
    seller_hidden boolean not null default false, updated_at timestamptz default now());
  create table public.declutter_questions (id uuid primary key default gen_random_uuid(), item_id uuid, asker_id uuid, question text, answer text,
    answered_at timestamptz, removed_at timestamptz, created_at timestamptz default now());
  create table public.declutter_watchlist (user_id uuid, item_id uuid, primary key (user_id, item_id));
  create table public.declutter_price_alerts (id uuid primary key default gen_random_uuid(), item_id uuid, user_id uuid, price_cents integer, sent_at timestamptz default now());
  create table public.declutter_offers (id uuid primary key default gen_random_uuid(), item_id uuid, buyer_id uuid, status text, closed_at timestamptz, updated_at timestamptz);
  create table public.declutter_offer_events (offer_id uuid, actor_side text, action text);
  create table public.declutter_cart_items (id uuid primary key default gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid, price_cents integer,
    source text, offer_id uuid, order_id uuid, status text default 'in_cart', checkout_by timestamptz, is_seed boolean default false,
    created_at timestamptz default now(), closed_at timestamptz, list_price_cents integer);
  create table public.declutter_orders (id uuid primary key, buyer_id uuid, seller_id uuid, status text, handover text, items_cents integer,
    premium_cents integer default 0, tax_cents integer default 0, total_cents integer, stripe_payment_intent_id text, paid_at timestamptz,
    closed_at timestamptz, close_reason text, card_fee_cents integer, stripe_paid_at timestamptz, setup_fee_cents integer default 0,
    setup_fee_state text, paid_with text);
  create table public.declutter_refunds (id uuid primary key default gen_random_uuid(), stripe_payment_intent_id text);
  create table public.declutter_strikes (id uuid, cart_line_id uuid, reason text, removed_at timestamptz);
  create function public.declutter_record_refund(p_order uuid, p_pi text, p_reason text, p_amount integer, p_fee integer) returns uuid language sql as
    $f$ insert into public.declutter_refunds (stripe_payment_intent_id) values (p_pi) returning id $f$;
  create function public.declutter_refund_answer(p_refund uuid) returns jsonb language sql as $f$ select jsonb_build_object('result', 'refunded') $f$;
  create function public.declutter_seller_out(p_user uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.declutter_seller_out_fee_notice(p_refund uuid) returns void language sql as $f$ select $f$;
  create function public.declutter_card_fee_estimate(p_cents integer) returns integer language sql immutable as $f$ select 0 $f$;
  create function public.declutter_claim_setup_fee(p_order uuid) returns void language sql as $f$ select $f$;
`);
// Prod's bodies of the two RPCs (newest before 20261028162048), then the notice kinds once, as on prod after it lands.
await db.exec(newestBefore("declutter_take_item", BASE));
await db.exec(newestBefore("declutter_mark_order_paid", BASE));
await db.exec(newestBefore("declutter_price_drop_alert", BASE));
await db.exec(`create trigger trg_declutter_items_price_drop_alert after update of current_price_cents on public.declutter_items
  for each row execute function public.declutter_price_drop_alert();`);
await db.exec(readFileSync(MIG_DIR + BASE, "utf8"));
await db.exec(`insert into auth.users values ('${SELLER}'), ('${BUYER}'), ('${OTHER}');
  insert into public.profiles values ('${SELLER}', false), ('${BUYER}', false), ('${OTHER}', false);
  insert into public.notification_preferences (user_id) values ('${SELLER}'), ('${BUYER}'), ('${OTHER}');`);

const notes = async (u) => (await db.query(`select type, title, message, link from public.notifications where user_id = $1 order by created_at, id`, [u])).rows;
const reset = () => db.exec(`delete from public.notifications; delete from public.declutter_cart_items; delete from public.declutter_orders;
  delete from public.declutter_items; delete from public.declutter_watchlist; delete from public.declutter_price_alerts;`);
async function takeAndPay(n, cents) {
  await db.query(`insert into public.declutter_items (id, seller_id, title, price_cents, current_price_cents) values ($1, $2, $3, $4, $4)`, [I(n), SELLER, `Lamp ${n}`, cents]);
  const line = (await db.query(`select public.declutter_take_item($1, $2, $3, 'buy_now', null) id`, [I(n), BUYER, cents])).rows[0].id;
  await db.query(`insert into public.declutter_orders (id, buyer_id, seller_id, status, items_cents, total_cents) values ($1, $2, $3, 'awaiting_payment', $4, $4)`, [I(100 + n), BUYER, SELLER, cents]);
  await db.query(`update public.declutter_cart_items set order_id = $1 where id = $2`, [I(100 + n), line]);
  await db.query(`select public.declutter_mark_order_paid($1, 'pi_test${n}', $2, now(), 0)`, [I(100 + n), cents]);
}

// ── BEFORE: prod's bodies ──
await takeAndPay(1, 3000);
const bBuyer = await notes(BUYER), bSeller = await notes(SELLER);
console.log(`BEFORE  buyer told: ${bBuyer.map((n) => `${n.title} | ${n.message}`).join(" || ")}`);
console.log(`BEFORE  seller told: ${bSeller.map((n) => `${n.title} -> ${n.link}`).join(" || ")}`);
await reset();

// ── AFTER: this migration, three times ──
for (let i = 0; i < 3; i++) await db.exec(mig);
const words = async (t) => (await db.query(`select public.declutter_price_words($1) w`, [t])).rows[0].w;
const text = async (c) => (await db.query(`select public.declutter_price_text($1) t`, [c])).rows[0].t;
check((await text(3000)) === "$30" && (await text(3050)) === "$30.50" && (await text(5)) === "$0.05" && (await text(100000)) === "$1000",
  "[price] declutter_price_text is the app's formatPrice: $30, $30.50, $0.05, $1000");
check((await words("All $30.00 back, $30.50 kept, $1000.00 total, $5.005 odd.")) === "All $30 back, $30.50 kept, $1000 total, $5.005 odd.",
  "[price] the message rule drops .00 only from whole dollars");

await takeAndPay(2, 3000);
let b = await notes(BUYER), s = await notes(SELLER);
const reserved = b.find((n) => n.title.startsWith("Reserved for you"));
check(reserved?.title === "Reserved for you: check out within 48 hours" && reserved.type === "declutter_sales" && reserved.message.includes("for $30.")
  && !b.some((n) => n.title.startsWith("It's yours: check out")),
  `[title] the buyer reads "Reserved for you", typed declutter_sales, at $30 (${JSON.stringify(reserved ?? null)})`);
const sold = s.find((n) => n.title === "Sold: waiting for the buyer to pay");
check(sold?.link === "/declutter?view=selling" && sold.message === '"Lamp 2" sold for $30. The buyer has 48 hours to check out and pay.',
  `[link] "Sold: waiting..." opens Selling, at $30 (${JSON.stringify(sold ?? null)})`);
const paid = s.find((n) => n.title === "Buyer paid");
check(paid?.link === "/declutter?view=selling" && paid.message === "The buyer paid for $30 of your items. You get paid when the buyer has them.",
  `[link] "Buyer paid" opens Selling, at $30 (${JSON.stringify(paid ?? null)})`);
const recv = b.find((n) => n.title === "Payment received");
check(recv?.message === "You paid $30. Next: pick up your items at the time you chose.", "[price] the buyer's receipt notice says $30");
await reset();

await takeAndPay(3, 3050);
check((await notes(SELLER)).find((n) => n.title === "Buyer paid")?.message.includes("$30.50"), "[price] cents stay when there are cents ($30.50)");
await reset();

// A caller that still formats with to_char gets the rule through the one writer.
await db.query(`select public.declutter_notify($1, 'payment', 'Refund on its way', 'All $45.00 is coming back to your card.', '/declutter?view=cart')`, [BUYER]);
check((await notes(BUYER))[0]?.message === "All $45 is coming back to your card.", "[price] an unrestated caller's \"$45.00\" reads \"$45\"");
await reset();

// Free claim: the seller's notice opens Selling too.
await db.query(`insert into public.declutter_items (id, seller_id, title, price_cents, current_price_cents) values ($1, $2, 'Chair', 0, 0)`, [I(9), SELLER]);
await db.query(`select public.declutter_take_item($1, $2, 0, 'free', null)`, [I(9), BUYER]);
check((await notes(SELLER)).find((n) => n.title === "Someone claimed your free item")?.link === "/declutter?view=selling", "[link] a free claim's seller notice opens Selling");
await reset();

// Price drops write their own row.
await db.query(`insert into public.declutter_items (id, seller_id, title, price_cents, current_price_cents) values ($1, $2, 'Desk', 5000, 5000)`, [I(10), SELLER]);
await db.query(`insert into public.declutter_watchlist values ($1, $2)`, [OTHER, I(10)]);
await db.query(`update public.declutter_items set current_price_cents = 4000 where id = $1`, [I(10)]);
check((await notes(OTHER))[0]?.message === '"Desk" dropped to $40.', `[price] a price-drop notice says $40 (${JSON.stringify((await notes(OTHER))[0] ?? null)})`);

for (const sig of ["public.declutter_price_text(bigint)", "public.declutter_price_words(text)"]) {
  const r = (await db.query(`select has_function_privilege('anon', '${sig}', 'execute') a, has_function_privilege('authenticated', '${sig}', 'execute') b`)).rows[0];
  check(!r.a && !r.b, `[grants] ${sig} is not callable by anon or authenticated`);
}

console.log(failures ? `\n${failures} FAILED${MUTANT ? ` (mutant ${MUTANT})` : ""}` : `\nALL PASS${MUTANT ? ` (mutant ${MUTANT} was NOT caught)` : ""}`);
process.exit(failures ? 1 : 0);
