#!/usr/bin/env node
/**
 * PGlite proof for *_declutter_buy_funnel_events (Declutter buy audit 11-08, H3).
 *
 *   node src/test/pglite/declutterBuyFunnel.pglite.mjs                  # GREEN, the migration applied 3x
 *   MUTANT=<name> node src/test/pglite/declutterBuyFunnel.pglite.mjs    # each must FAIL
 *
 * World, stubbed and said so: auth.uid() from request.jwt.claim.sub, auth.role() from request.jwt.claim.role;
 * is_server_context (the real definition, newest); has_role (admin = ADMIN); is_test_member (TESTER); the tables the
 * functions read (declutter_items, declutter_orders, declutter_cart_items) with only the columns they use.
 */
import { readdirSync } from "node:fs";
import { PGlite, readMigration, newestFunctionSql, as, checker } from "./seriesWorld.mjs";

const FILE = readdirSync(new URL("../../../supabase/migrations/", import.meta.url).pathname).find((f) => f.endsWith("_declutter_buy_funnel_events.sql"));
if (!FILE) throw new Error("migration *_declutter_buy_funnel_events.sql not found");
let FIX = readMigration(FILE);
const MUTANTS = {
  // The server step trusts any caller (a member could write "paid").
  noserver: ["  IF NOT public.is_server_context() THEN\n    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';\n  END IF;\n  IF p_step IS NULL OR p_step NOT IN ('paid'", "  IF p_step IS NULL OR p_step NOT IN ('paid'"],
  // No guest cap.
  nocap: ["          WHERE e.device_id = v_device AND e.created_at > now() - interval '1 hour') >= 60 THEN", "          WHERE e.device_id = v_device AND e.created_at > now() - interval '1 hour') >= 100000 THEN"],
  // Test accounts are counted.
  testcounted: ["    IF public.is_test_member(v_uid) THEN\n      RETURN;\n    END IF;\n    v_device := NULL;", "    v_device := NULL;"],
  // The decline code is not stored on the order.
  nodecline: ["       SET last_payment_error_code = v_err, last_decline_code = v_decline, last_payment_failed_at = now()", "       SET last_payment_failed_at = now()"],
  // Anyone reads the counts.
  openread: ["  IF v_uid IS NULL OR NOT COALESCE(public.has_role(v_uid, 'admin'::public.app_role), false) THEN\n    RAISE", "  IF false THEN\n    RAISE"],
  // Someone else's order id is kept.
  otherorder: ["    IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.declutter_orders o\n                                      WHERE o.id = v_order AND o.buyer_id = v_uid AND o.is_seed IS NOT TRUE) THEN", "    IF false THEN"],
};
for (const m of (process.env.MUTANT ?? "").split(",").filter(Boolean)) {
  const [from, to] = MUTANTS[m] ?? [];
  if (!from || !FIX.includes(from)) throw new Error(`mutant ${m}: anchor not found`);
  FIX = FIX.replace(from, to);
  console.log(`MUTANT=${m} (expect FAILs)`);
}
const { check, failures } = checker();

const BUYER = "a0000000-0000-0000-0000-000000000001";
const OTHER = "a0000000-0000-0000-0000-000000000002";
const TESTER = "a0000000-0000-0000-0000-000000000003";
const ADMIN = "a0000000-0000-0000-0000-000000000004";
const ITEM = "b0000000-0000-0000-0000-000000000001";
const SEED_ITEM = "b0000000-0000-0000-0000-000000000002";
const ORDER = "c0000000-0000-0000-0000-000000000001";
const OTHER_ORDER = "c0000000-0000-0000-0000-000000000002";
const DEV = "d0000000-0000-0000-0000-000000000001";

const db = new PGlite();
const q = async (sql) => (await db.query(sql)).rows;
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key);
  insert into auth.users values ('${BUYER}'), ('${OTHER}'), ('${TESTER}'), ('${ADMIN}');
  create role anon; create role authenticated; create role service_role;
  grant usage on schema public, auth to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create function auth.role() returns text language sql stable as $f$ select nullif(current_setting('request.jwt.claim.role', true), '') $f$;
  grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
  create type public.app_role as enum ('admin', 'user');
  create function public.has_role(u uuid, r public.app_role) returns boolean language sql stable as $f$ select u = '${ADMIN}'::uuid and r = 'admin' $f$;
  create function public.is_test_member(p uuid) returns boolean language sql stable as $f$ select p = '${TESTER}'::uuid $f$;
  create table public.declutter_items (id uuid primary key, is_seed boolean default false);
  insert into public.declutter_items values ('${ITEM}', false), ('${SEED_ITEM}', true);
  create table public.declutter_orders (id uuid primary key, buyer_id uuid, is_seed boolean default false);
  insert into public.declutter_orders values ('${ORDER}', '${BUYER}', false), ('${OTHER_ORDER}', '${OTHER}', false);
  create table public.declutter_cart_items (id uuid primary key default gen_random_uuid(), item_id uuid, order_id uuid);
  insert into public.declutter_cart_items (item_id, order_id) values ('${ITEM}', '${ORDER}');
`);
await db.exec(newestFunctionSql("is_server_context").sql);
for (let i = 0; i < 3; i++) await db.exec(FIX);
check("applied 3x (replay-safe)", true);

const ev = (role, uid, args) => as(db, role, uid, `select public.declutter_funnel_event(${args})`);
const count = async (where = "true") => Number((await q(`select count(*)::int n from public.declutter_funnel_events where ${where}`))[0].n);

// Client steps
let r = await ev("authenticated", BUYER, `'item_view', '${ITEM}'`);
check("a member records an item view", r.ok && (await count(`step = 'item_view' and member_id = '${BUYER}' and device_id is null`)) === 1, r.err);
r = await ev("authenticated", BUYER, `'buy_now_tap', '${ITEM}', null, '${DEV}'`);
check("a member's device id is ignored (counted by account)", r.ok && (await count(`step = 'buy_now_tap' and member_id = '${BUYER}' and device_id is null`)) === 1, r.err);
r = await ev("anon", null, `'item_view', '${ITEM}', null, '${DEV}'`);
check("a guest records an item view by device id, no member id", r.ok && (await count(`device_id = '${DEV}' and member_id is null`)) === 1, r.err);
r = await ev("anon", null, `'item_view', '${ITEM}'`);
check("a guest with no device id records nothing", r.ok && (await count(`member_id is null and device_id is null`)) === 0, r.err);
r = await ev("authenticated", TESTER, `'item_view', '${ITEM}'`);
check("a test account records nothing", r.ok && (await count(`member_id = '${TESTER}'`)) === 0, r.err);
r = await ev("authenticated", BUYER, `'item_view', '${SEED_ITEM}'`);
check("a test item records nothing", r.ok && (await count(`item_id = '${SEED_ITEM}'`)) === 0, r.err);
r = await ev("authenticated", BUYER, `'paid', null, '${ORDER}'`);
check("a member cannot record a server step ('paid')", r.ok && (await count(`step = 'paid'`)) === 0, r.err);
r = await ev("authenticated", BUYER, `'checkout_opened', '${ITEM}', '${OTHER_ORDER}'`);
check("someone else's order id is dropped", r.ok && (await count(`step = 'checkout_opened' and order_id is null`)) === 1, r.err);
r = await ev("authenticated", BUYER, `'returned_from_stripe', null, '${ORDER}', null, 'paid'`);
check("a return records its order and 'paid'", r.ok && (await count(`step = 'returned_from_stripe' and order_id = '${ORDER}' and detail = 'paid'`)) === 1, r.err);
r = await ev("authenticated", BUYER, `'returned_from_stripe', null, null, null, 'some free text'`);
check("free text never lands in detail", r.ok && (await count(`detail = 'some free text'`)) === 0, r.err);
const DEV2 = "d0000000-0000-0000-0000-000000000002";
for (let i = 0; i < 70; i++) await ev("anon", null, `'item_view', '${ITEM}', null, '${DEV2}'`);
check("the guest cap: at most 60 events per device per hour", (await count(`device_id = '${DEV2}'`)) === 60, String(await count(`device_id = '${DEV2}'`)));

// Server steps
r = await as(db, "authenticated", BUYER, `select public.declutter_funnel_server_event('paid', '${ORDER}')`);
check("a member calling the server step is refused (42501 or no grant)", !r.ok, r.err ?? "ran");
// The null-uid pattern: a request that carries a member's uid is not a server write, even on a role that holds EXECUTE.
await db.exec(`set request.jwt.claim.sub = '${BUYER}'`);
r = await db.query(`select public.declutter_funnel_server_event('paid', '${ORDER}')`).then(() => ({ ok: true }), (e) => ({ ok: false, err: String(e.message) }));
await db.exec(`reset request.jwt.claim.sub`);
check("a member-uid request is refused by is_server_context (not only by the grant)", !r.ok && /not_allowed/.test(r.err ?? ""), r.err ?? "ran");
r = await as(db, "service_role", null, `select public.declutter_funnel_server_event('payment_failed', '${ORDER}', 'card_declined', 'insufficient_funds')`);
const o = (await q(`select last_payment_error_code e, last_decline_code d, last_payment_failed_at t from public.declutter_orders where id = '${ORDER}'`))[0];
check("a failure stores the error and decline code on the attempt", r.ok && o.e === "card_declined" && o.d === "insufficient_funds" && o.t !== null, r.err ?? JSON.stringify(o));
check("a failure is a funnel row with the decline code and the buyer", (await count(`step = 'payment_failed' and detail = 'insufficient_funds' and member_id = '${BUYER}' and item_id = '${ITEM}'`)) === 1);
r = await as(db, "service_role", null, `select public.declutter_funnel_server_event('payment_failed', '${ORDER}', 'Card Declined; 4242', null)`);
check("a malformed code is not stored (no free text, no card digits)", r.ok && (await count(`detail like '%4242%'`)) === 0 && (await q(`select last_payment_error_code e from public.declutter_orders where id = '${ORDER}'`))[0].e === null, r.err);
r = await as(db, "service_role", null, `select public.declutter_funnel_server_event('paid', '${ORDER}')`);
check("the server records 'paid'", r.ok && (await count(`step = 'paid' and order_id = '${ORDER}'`)) === 1, r.err);

// Admin read
r = await as(db, "authenticated", BUYER, `select * from public.declutter_funnel_counts(7)`);
check("a member cannot read the counts", !r.ok && /not_allowed/.test(r.err), r.err ?? "read");
r = await as(db, "anon", null, `select * from public.declutter_funnel_counts(7)`);
check("a guest cannot read the counts", !r.ok, r.err ?? "read");
r = await as(db, "authenticated", ADMIN, `select * from public.declutter_funnel_counts(7)`);
const rows = r.rows ?? [];
const iv = rows.find((x) => x.step === "item_view" && x.detail === null);
check("an admin reads count by step over 7 days", r.ok && rows.length >= 5 && iv?.events === 62 && iv?.people === 3, r.err ?? JSON.stringify(iv));
check("the first row is item_view (funnel order)", rows[0]?.step === "item_view", rows[0]?.step);
check("decline codes are broken out", rows.some((x) => x.step === "payment_failed" && x.detail === "insufficient_funds" && x.events === 1));

// No PII columns exist
const cols = (await q(`select column_name c from information_schema.columns where table_name = 'declutter_funnel_events'`)).map((x) => x.c);
check("the table has no email, IP or card column", !cols.some((c) => /email|ip|card|address|name/.test(c)), cols.join(","));
const acl = (await q(`select relacl::text a from pg_class where relname = 'declutter_funnel_events'`))[0]?.a ?? "";
check("no client grant on the table", !/(anon|authenticated)=/.test(acl), acl);

console.log(failures() ? `\n${failures()} FAIL` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
