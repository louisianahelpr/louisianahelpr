#!/usr/bin/env node
/**
 * PGlite proof for 20261027163240_payout_setup_only_when_owed (owner
 * 2026-10-27: payout setup only when money is owed; Declutter "list first, set
 * up at first sale", Shops the same, Rentals out).
 *
 *   node src/test/pglite/payoutSetupOnlyWhenOwed.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/payoutSetupOnlyWhenOwed.pglite.mjs # RED: prod's bodies
 *
 * The "before" bodies are prod's (the migration's header lists their prosrc
 * md5, equal to the files' bodies cut here from the newest repo definitions
 * at the time of writing): payout_setup_hire_allowed, shop_owner_sell_block_reason,
 * shops_assert_owner_eligible and helpr_task_assert_helpr run for real on
 * prod-shaped stubs. declutter_publish_item and declutter_relist_listing are
 * pinned by src/test/payoutSetupOnlyWhenOwed.test.ts (their fixtures are the
 * whole Declutter schema).
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261027163240_payout_setup_only_when_owed.sql";
const NEW = readFileSync(MIG + NEW_FILE, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against prod's bodies (expect FAILs)`);

function prodBody(name) {
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
  let found = null;
  for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql") && x < NEW_FILE).sort()) {
    const sql = readFileSync(MIG + f, "utf8");
    const m = [...sql.matchAll(re)].at(-1);
    if (!m) continue;
    const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
    const close = sql.indexOf(open[1], m.index + open.index + open[0].length);
    found = sql.slice(m.index, sql.indexOf(";", close) + 1);
  }
  if (!found) throw new Error(`no definition of ${name}`);
  return found;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.caller (uid uuid);
  INSERT INTO auth.caller VALUES (NULL);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM auth.caller $$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, stripe_account_id text, stripe_payouts_enabled boolean,
    is_seed boolean DEFAULT false, ban_status text DEFAULT 'active', auto_suspended_until timestamptz);
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, helper_id uuid, payment_status text);
  CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
  CREATE TABLE public.job_accept_pending (job_id uuid, helper_id uuid);
  CREATE TABLE public.cancellation_fee_transfers (helper_id uuid);
  CREATE TABLE public.crew_cancellation_fee_shares (helper_id uuid);
  CREATE TABLE public.crew_block_fees (helper_id uuid);
  CREATE TABLE public.payout_transfers (helper_id uuid);
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, seller_id uuid, status text);
  CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid);
  CREATE TABLE public.shop_orders (id uuid PRIMARY KEY, seller_id uuid, status text, captured_at timestamptz);
  CREATE TABLE public.shop_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid);
  CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helpr_id uuid, status text);
  CREATE TABLE public.helpr_task_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helpr_id uuid);
  CREATE TABLE public.feature_on (key text, uid uuid);
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY); -- the two Declutter bodies declare %ROWTYPE of it
  CREATE FUNCTION public.feature_enabled_for_user(k text, u uuid) RETURNS boolean LANGUAGE sql STABLE
    AS $$ SELECT EXISTS (SELECT 1 FROM public.feature_on f WHERE f.key = k AND f.uid = u) $$;
  CREATE FUNCTION public.job_payment_is_funded(s text) RETURNS boolean LANGUAGE sql IMMUTABLE
    AS $$ SELECT s IN ('escrow', 'payout_pending') $$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE FUNCTION public.member_under_18(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE FUNCTION public.shop_active_strike_count(u uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
  CREATE FUNCTION public.declutter_active_strike_count(u uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
`);
// helper_award_block_reason as prod has it (the Helprs' payout-ready gate).
for (const n of ["helper_award_block_reason", "payout_setup_hire_allowed", "shop_owner_sell_block_reason",
  "shops_assert_owner_eligible", "helpr_task_assert_helpr"]) await db.exec(prodBody(n));
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(NEW);

const u = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const LISTER = u(1), SOLD = u(2), SHOP_OPEN = u(3), SHOP_SOLD = u(4), LANDLORD = u(5), HIRED = u(6), DRIVER = u(7), HELD = u(8), REFUNDED = u(9);
for (const x of [LISTER, SOLD, SHOP_OPEN, SHOP_SOLD, LANDLORD, HIRED, DRIVER, HELD, REFUNDED]) {
  await db.exec(`INSERT INTO public.profiles (user_id) VALUES ('${x}');`);
}
await db.exec(`
  -- Every one of them has the sections on (as testers do today).
  INSERT INTO public.feature_on SELECT k, p.user_id FROM public.profiles p, unnest(ARRAY['declutter','shops','rentals']) k;
  INSERT INTO public.declutter_orders VALUES ('${u(101)}', '${SOLD}', 'paid'), ('${u(102)}', '${REFUNDED}', 'refunded');
  INSERT INTO public.shop_orders VALUES ('${u(201)}', '${SHOP_SOLD}', 'accepted', now()), ('${u(202)}', '${HELD}', 'held', NULL);
  INSERT INTO public.jobs VALUES ('${u(301)}', '${HIRED}', 'escrow');
  INSERT INTO public.helpr_tasks (helpr_id, status) VALUES ('${DRIVER}', 'accepted');
`);
const allowed = async (x) => (await db.query(`SELECT public.payout_setup_hire_allowed('${x}') a`)).rows[0].a;

check("a Declutter seller with only a listing may NOT set up payouts", (await allowed(LISTER)) === false);
check("a Shops owner with a shop and no captured order may NOT", (await allowed(SHOP_OPEN)) === false);
check("a Shops order only HELD (not captured) does not count", (await allowed(HELD)) === false);
check("a Declutter order refunded in full does not count", (await allowed(REFUNDED)) === false);
check("Rentals gives no access (no money moves through us)", (await allowed(LANDLORD)) === false);
check("a seller with a PAID Declutter order may", (await allowed(SOLD)) === true);
check("a Shops owner with a captured order may", (await allowed(SHOP_SOLD)) === true);
check("a Helpr hired on a funded job still may", (await allowed(HIRED)) === true);
check("a Helpr who took a Declutter delivery may", (await allowed(DRIVER)) === true);
await db.exec(`INSERT INTO public.declutter_payouts (seller_id) VALUES ('${LISTER}')`);
check("a recorded Declutter payout makes the seller eligible", (await allowed(LISTER)) === true);

// The listing-side gates: an owner with no payout account can open a shop and sell.
const asUser = (x) => db.exec(`UPDATE auth.caller SET uid = ${x ? `'${x}'` : "NULL"}`);
const sellReason = (await db.query(`SELECT public.shop_owner_sell_block_reason('${SHOP_OPEN}') r`)).rows[0].r;
check("Shops: an owner with no payout account is not blocked from selling", sellReason === null, String(sellReason));
await asUser(SHOP_OPEN);
const own = await db.query(`SELECT public.shops_assert_owner_eligible() v`).then((r) => r.rows[0].v, (e) => e.message);
check("Shops: an owner with no payout account can open a shop", own === SHOP_OPEN, String(own));
// Deliveries (independent money review 2026-10-27): a new delivery Helpr with no
// payout account and no delivery yet can see and take one (else: no delivery
// without an account, no account without a delivery).
const NEW_DRIVER = u(10);
await db.exec(`INSERT INTO public.profiles (user_id) VALUES ('${NEW_DRIVER}')`);
check("a new delivery Helpr may not set up payouts before taking a delivery", (await allowed(NEW_DRIVER)) === false);
await asUser(NEW_DRIVER);
const drv = await db.query(`SELECT public.helpr_task_assert_helpr() v`).then((r) => r.rows[0].v, (e) => e.message);
check("Deliveries: a Helpr with no payout account can see and take a delivery", drv === NEW_DRIVER, String(drv));
await asUser(null);
const drvAnon = await db.query(`SELECT public.helpr_task_assert_helpr() v`).then(() => "ran", (e) => e.message);
check("Deliveries: still refuses a signed-out caller", /not_authenticated/.test(drvAnon), drvAnon);
const anon = await db.query(`SELECT public.shops_assert_owner_eligible() v`).then(() => "ran", (e) => e.message);
check("still refuses a signed-out caller", /not_authenticated/.test(anon), anon);

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
