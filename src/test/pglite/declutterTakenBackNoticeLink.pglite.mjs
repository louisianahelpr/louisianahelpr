#!/usr/bin/env node
/**
 * PGlite proof for 20261031103443_declutter_taken_back_notice_opens_the_tab (LEAD-TAKENBACK-LINK): the "Problem report
 * taken back" notice names the tab address (?tab=selling for the seller, ?tab=buying for the buyer) in the source.
 *
 *   node src/test/pglite/declutterTakenBackNoticeLink.pglite.mjs                     # ALL PASS (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterTakenBackNoticeLink.pglite.mjs  # RED: the 20261031004529 body
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterTakenBackNoticeLink.pglite.mjs
 *
 * The "before" body is 20261031004529's declutter_withdraw_problem, read verbatim. The notice writer is a stub that
 * records the link AS SENT (declutter_notify_strict's rewrite is not part of this proof), and the leaf helpers
 * (lock order, order side, banned, items named) are stubs shaped as the body calls them.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261031103443_declutter_taken_back_notice_opens_the_tab.sql";
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
const before = readFileSync(`${MIG_DIR}20261031004529_declutter_handover_both_confirm.sql`, "utf8");
const fnFrom = (src, name) => {
  const m = src.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS (\\$[a-z_]*\\$)\\n[\\s\\S]*?\\1;`));
  if (!m) throw new Error(`no ${name}`);
  return m[0];
};

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`PASS ${what}`); } else { fail++; console.log(`FAIL ${what}`); } };

const db = new PGlite();
const SELLER = "11111111-1111-4111-8111-111111111111", BUYER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "55555555-5555-4555-8555-555555555555", OTHER = "44444444-4444-4444-8444-444444444444";
const ORDER = "a0000000-0000-4000-8000-000000000001";
const P_BUYER = "b0000000-0000-4000-8000-000000000001", P_SELLER = "b0000000-0000-4000-8000-000000000002";
await db.exec(`
set timezone = 'UTC';
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
-- Stubs: the columns the body reads.
create table public.declutter_orders(id uuid primary key, buyer_id uuid, seller_id uuid);
create table public.declutter_problems(id uuid primary key, order_id uuid, reporter_id uuid, reporter_side text, status text,
  withdrawn_at timestamptz);
create table public.declutter_refund_requests(id bigserial, problem_id uuid, status text, return_agreed_at timestamptz);
create table public.declutter_handovers(order_id uuid, no_show_reported_at timestamptz, no_show_answer_by timestamptz);
create table public.user_roles(user_id uuid, role text);
create table public.notices(user_id uuid, kind text, title text, message text, link text);
create function public.is_caller_banned() returns boolean language sql stable as $$ select false $$;
create function public.declutter_lock_order(p uuid) returns public.declutter_orders language sql as $$ select * from public.declutter_orders where id = p $$;
create function public.declutter_order_side(p_buyer uuid, p_seller uuid, p_uid uuid) returns text language sql stable as $$
  select case when p_uid = p_buyer then 'buyer' when p_uid = p_seller then 'seller' end $$;
create function public.declutter_order_items_named(uuid) returns text language sql stable as $$ select '"Oak chair"' $$;
create function public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid default null)
  returns void language sql as $$ insert into public.notices values (p_user, p_type, p_title, p_message, p_link) $$;
insert into declutter_orders values ('${ORDER}', '${BUYER}', '${SELLER}');
insert into user_roles values ('${ADMIN}', 'admin');
`);
await db.exec(fnFrom(before, "declutter_withdraw_problem"));
let failedApply = "";
if (process.env.NEW_MIGRATION !== "skip") {
  try { for (let i = 0; i < 3; i++) await db.exec(mig); } catch (e) { failedApply = e.message; }
}
ok(failedApply === "", `migration applies 3x ${failedApply}`);

const as = async (uid, sql) => { await db.exec(`select set_config('t.uid', '${uid ?? ""}', false)`); return db.query(sql); };
const err = async (uid, sql) => { try { await as(uid, sql); return ""; } catch (e) { return e.message; } };
const withdraw = (p) => `select public.declutter_withdraw_problem('${p}') r`;
await db.exec(`insert into declutter_problems values
  ('${P_BUYER}', '${ORDER}', '${BUYER}', 'buyer', 'open', null),
  ('${P_SELLER}', '${ORDER}', '${SELLER}', 'seller', 'open', null);
  insert into declutter_handovers values ('${ORDER}', now(), now() + interval '1 day');`);

ok((await err(OTHER, withdraw(P_BUYER))).includes("problem_not_found"), "a stranger cannot take it back (unchanged)");
ok((await err(SELLER, withdraw(P_BUYER))).includes("problem_not_found"), "the other side cannot take it back (unchanged)");

const r1 = (await as(BUYER, withdraw(P_BUYER))).rows[0].r;
ok(r1.result === "withdrawn", "the buyer takes back their report");
const toSeller = (await db.query(`select * from notices where user_id = '${SELLER}'`)).rows;
ok(toSeller.length === 1 && toSeller[0].title === "Problem report taken back" && toSeller[0].message.includes("Oak chair"),
  "the seller is told, naming the item (unchanged)");
ok(toSeller[0]?.link === "/declutter?tab=selling", `the seller's notice opens Selling by its tab address (${toSeller[0]?.link})`);
ok((await db.query(`select no_show_reported_at from declutter_handovers`)).rows[0].no_show_reported_at === null,
  "the buyer's take-back still ends the no-show clock (unchanged)");

const r2 = (await as(SELLER, withdraw(P_SELLER))).rows[0].r;
ok(r2.result === "withdrawn", "the seller takes back their report");
const toBuyer = (await db.query(`select * from notices where user_id = '${BUYER}'`)).rows;
ok(toBuyer.length === 1 && toBuyer[0].kind === "declutter_refunds", "the buyer is told (unchanged kind)");
ok(toBuyer[0]?.link === "/declutter?tab=buying", `the buyer's notice opens Buying by its tab address (${toBuyer[0]?.link})`);
ok((await db.query(`select count(*)::int n from notices where user_id = '${ADMIN}' and link = '/admin'`)).rows[0].n === 2,
  "the admin notice is unchanged");
ok((await as(BUYER, withdraw(P_BUYER))).rows[0].r.result === "already", "a second take-back answers already (unchanged)");

const acl = (await db.query(`select proacl::text a, prosecdef d, proconfig::text c from pg_proc where oid = 'public.declutter_withdraw_problem(uuid)'::regprocedure`)).rows[0];
ok(acl.d === true && /search_path=public, pg_temp/.test(acl.c ?? ""), "SECURITY DEFINER with search_path public, pg_temp");
ok(/authenticated=X/.test(acl.a ?? "") && !/(^|[{,])anon=/.test(acl.a ?? "") && !/(^|[{,])=X/.test(acl.a ?? ""),
  `members only, not anon or PUBLIC (${acl.a})`);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
