#!/usr/bin/env node
/**
 * PGlite proof for 20261030155159_declutter_cart_links_open_buying (Q2489): a real sender's ?view=cart notice is STORED as
 * ?tab=buying, through the real declutter_notify -> declutter_notify_strict -> declutter_notice_link path.
 *
 *   node src/test/pglite/declutterCartLinksOpenBuying.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterCartLinksOpenBuying.pglite.mjs # RED: the previous bodies
 *   MUTANT=<name> node src/test/pglite/declutterCartLinksOpenBuying.pglite.mjs      # a planted defect: must FAIL
 *
 * REAL bodies, read from the newest definition in the migrations: declutter_setup_fee_refunded and
 * declutter_seller_cancel_sale (two real senders), declutter_pickup_remind, declutter_notify, declutter_notify_strict,
 * declutter_notice_link, declutter_notice_type, declutter_notice_names_item, declutter_price_words.
 * Stubbed, said so: is_caller_banned, declutter_give_strike, log_cron_defect, auth.uid, net.http_post records the body;
 * the tables hold only the columns those bodies read.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261030155159_declutter_cart_links_open_buying.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The helper no longer rewrites ?view=cart.
  noCart: [`    WHEN p_link ~ '^/declutter\\?view=cart(&|#|$)'\n      THEN regexp_replace(p_link, '^/declutter\\?view=cart', '/declutter?tab=buying')\n`, ``],
  // It rewrites to the wrong side.
  wrongTab: [`'^/declutter\\?view=cart', '/declutter?tab=buying')`, `'^/declutter\\?view=cart', '/declutter?tab=selling')`],
  // It drops the rest of the link.
  dropsRest: [`THEN regexp_replace(p_link, '^/declutter\\?view=cart', '/declutter?tab=buying')`, `THEN '/declutter?tab=buying'`],
  // It also takes any view starting with "cart".
  noBoundary: [`p_link ~ '^/declutter\\?view=cart(&|#|$)'`, `p_link ~ '^/declutter\\?view=cart'`],
  // The reminder email keeps the raw link.
  emailRaw: [`'link', public.declutter_notice_link(p_link))`, `'link', p_link)`],
};
const skip = process.env.NEW_MIGRATION === "skip";

function definitionBefore(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = rest.slice(0, end + tag[1].length) + ";";
    }
  }
  if (!last) throw new Error(`no definition of ${name} before ${before}`);
  return last;
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), BUYER = U(2), BUYER2 = U(3), BUYER3 = U(4);
const ORDER = "22222222-0000-4000-8000-000000000001", ITEM = "44444444-0000-4000-8000-000000000001";

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create schema auth; create schema net; create schema vault;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create table net.calls (body jsonb);
create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as $$ insert into net.calls values (body); select 1::bigint $$;
create table vault.decrypted_secrets (name text, decrypted_secret text);
insert into vault.decrypted_secrets values ('supabase_url','http://x'),('service_role_key','k');
create function public.is_caller_banned() returns boolean language sql as $$ select false $$;
create function public.declutter_give_strike(u uuid, s text, r text, i uuid, w text, l uuid) returns integer language sql as $$ select 1 $$;
create table public.defects (fn text, ref text, msg text);
create function public.log_cron_defect(f text, r text, m text, c jsonb default null) returns void language sql as $$ insert into public.defects values (f, r, m) $$;
create table public.error_logs (severity text, message text, tags jsonb, context jsonb);
create table public.profiles (user_id uuid primary key, is_seed boolean default false);
insert into public.profiles values ('${SELLER}'), ('${BUYER}'), ('${BUYER2}'), ('${BUYER3}');
create table public.notifications (user_id uuid, type text, title text, message text, link text);
create table public.declutter_orders (id uuid primary key, buyer_id uuid, seller_id uuid, status text default 'awaiting_payment', close_reason text, closed_at timestamptz,
  setup_fee_cents int, setup_fee_state text, setup_fee_refund_id text);
insert into public.declutter_orders (id, buyer_id, seller_id, setup_fee_cents, setup_fee_state) values ('${ORDER}', '${BUYER}', '${SELLER}', 500, 'refund_due');
create table public.declutter_items (id uuid primary key, seller_id uuid, status text default 'reserved', title text, updated_at timestamptz);
insert into public.declutter_items (id, seller_id, title) values ('${ITEM}', '${SELLER}', 'Blue lamp');
create table public.declutter_cart_items (id uuid primary key default gen_random_uuid(), item_id uuid, order_id uuid, buyer_id uuid, seller_id uuid, status text default 'in_cart',
  price_cents int not null default 1500, source text default 'buy', closed_at timestamptz, created_at timestamptz default now());
insert into public.declutter_cart_items (item_id, buyer_id, seller_id) values ('${ITEM}', '${BUYER2}', '${SELLER}');
`);

// The path as main + the queued writer leave it, read from the files.
for (const fn of ["declutter_price_words", "declutter_notice_names_item", "declutter_notice_type", "declutter_notice_link",
  "declutter_notify_strict", "declutter_notify", "declutter_pickup_remind", "declutter_setup_fee_refunded", "declutter_seller_cancel_sale"]) {
  await db.exec(definitionBefore(fn, THIS));
}
if (!skip) {
  let mig = readFileSync(MIG_DIR + THIS, "utf8");
  if (MUTANT) {
    const m = MUTANTS[MUTANT];
    if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
    mig = mig.replace(m[0], m[1]);
  }
  for (let k = 1; k <= 3; k++) {
    try { await db.exec(mig); check(true, `the migration applies (run ${k})`); } catch (e) { check(false, `the migration applies (run ${k}): ${e.message}`); }
  }
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
const stored = async (u, title) => (await q(`select type, link from public.notifications where user_id = $1 and title = $2`, [u, title]));

// 1. A real money sender, through the real writer path.
const res = (await q(`select public.declutter_setup_fee_refunded($1, 're_test') r`, [ORDER]))[0].r;
const fee = await stored(BUYER, "Setup fee coming back");
check(res === "recorded" && fee.length === 1, `declutter_setup_fee_refunded ran and wrote one notice (${res}, ${fee.length})`);
check(fee[0]?.link === "/declutter?tab=buying", `its stored link is the buyer's tab (${fee[0]?.link})`);
check(fee[0]?.type === "declutter_sales", `its kind did not move (${fee[0]?.type})`);

// 2. A real member-called sender.
await db.exec(`select set_config('t.uid', '${SELLER}', false)`);
await q(`select public.declutter_seller_cancel_sale($1)`, [ITEM]);
const cancel = await stored(BUYER2, "The seller cancelled");
check(cancel.length === 1 && cancel[0].link === "/declutter?tab=buying", `declutter_seller_cancel_sale stores the buyer's tab (${cancel[0]?.link})`);

// 3. The reminder wrapper: bell and email.
await q(`select public.declutter_pickup_remind($1, 'Pickup tomorrow', 'm', '/declutter?view=cart', $2)`, [BUYER3, SELLER]);
const remind = await stored(BUYER3, "Pickup tomorrow");
const mail = (await q(`select body from net.calls where body->>'user_id' = $1`, [BUYER3]))[0]?.body;
check(remind[0]?.link === "/declutter?tab=buying", `the reminder's bell row opens Buying (${remind[0]?.link})`);
check(mail?.link === "/declutter?tab=buying", `the reminder's email opens Buying (${mail?.link})`);

// 4. Nothing stored by this run still holds the old address.
const left = (await q(`select count(*)::int n from public.notifications where link ~ 'view=(cart|offers)'`))[0].n;
const total = (await q(`select count(*)::int n from public.notifications`))[0].n;
check(total === 3 && left === 0, `0 of ${total} stored notices hold ?view=cart or ?view=offers (${left})`);

// 5. The helper's edges.
const link = async (l) => (await q(`select public.declutter_notice_link($1) l`, [l]))[0].l;
for (const [input, want] of [
  ["/declutter?view=cart&paid=1", "/declutter?tab=buying&paid=1"],
  ["/declutter?view=cart#x", "/declutter?tab=buying#x"],
  ["/declutter?view=cartoon", "/declutter?view=cartoon"],
  ["/declutter?view=deliver", "/declutter?view=deliver"],
  ["/declutter?view=sales", "/declutter?tab=selling"],
  ["/declutter?view=bought", "/declutter?tab=buying"],
  ["/declutter/item/1", "/declutter/item/1"],
  ["/jobs?view=cart", "/jobs?view=cart"],
]) {
  const got = await link(input);
  check(got === want, `${input} -> ${want} (${got})`);
}
check((await link(null)) === null, "a null link stays null");

// 6. Grants on what this migration restates.
if (!skip) {
  const acl = (await q(`select has_function_privilege('anon', 'public.declutter_notice_link(text)', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.declutter_notice_link(text)', 'EXECUTE') u,
    has_function_privilege('anon', 'public.declutter_pickup_remind(uuid,text,text,text,uuid)', 'EXECUTE') a2,
    has_function_privilege('authenticated', 'public.declutter_pickup_remind(uuid,text,text,text,uuid)', 'EXECUTE') u2,
    has_function_privilege('service_role', 'public.declutter_notice_link(text)', 'EXECUTE') s`))[0];
  check(!acl.a && !acl.u && !acl.a2 && !acl.u2 && acl.s, `grants: service_role only (${JSON.stringify(acl)})`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
