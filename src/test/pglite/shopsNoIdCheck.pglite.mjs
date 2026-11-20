#!/usr/bin/env node
/**
 * PGlite proof for 20261120203904_shops_no_id_check (owner 2026-11-20: no ID check for Shops, sellers or buyers).
 *
 *   node src/test/pglite/shopsNoIdCheck.pglite.mjs                     # ALL PASS (the migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsNoIdCheck.pglite.mjs  # RED: every [RED] check fails
 *
 * Base: 20261105174853_shops_identity_check (the two triggers), 20261112081213 and 20261112093000 (the effective
 * shop_complete_handover before this change), then this migration applied 3x.
 * Stubbed, and said so (schema as src/test/pglite/shopsSetupFeeNoticeExact.pglite.mjs): tables cut to the columns
 * read; declutter_identity_gate refuses every member who is not in verified_ids (the gate's real carve-outs are not
 * the subject here); declutter_setup_fee_from_payout_cents 200; payout_waits_on_identity from id_waits;
 * declutter_notify records.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261120203904_shops_no_id_check.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
let redFails = 0;
let reds = 0;
const check = (ok, name, red = false, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${red ? "[RED] " : ""}${name}${!ok && detail ? `  (${detail})` : ""}`);
  if (red) reds++;
  if (!ok) {
    failures++;
    if (red) redFails++;
  }
};
const U = (n) => `5a0b5a0f-0000-0000-0000-${String(n).padStart(12, "0")}`;
const BUYER = U(1), SELLER = U(2), VERIFIED = U(3);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE TABLE storage.objects (bucket_id text, name text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$f\$ SELECT nullif(current_setting('test.uid', true), '')::uuid \$f\$;
CREATE TABLE public.shop_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid, status text NOT NULL DEFAULT 'draft');
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, status text NOT NULL,
  captured_at timestamptz, close_reason text, closed_at timestamptz, handed_over_at timestamptz, ready_date date,
  handover_mode text NOT NULL DEFAULT 'in_person', fulfillment text NOT NULL DEFAULT 'pickup', helpr_unfilled_at timestamptz,
  items_cents integer NOT NULL DEFAULT 5000, delivery_cents integer NOT NULL DEFAULT 0, is_digital boolean NOT NULL DEFAULT false);
CREATE TABLE public.shop_order_lines (order_id uuid, kind text, at_buyer boolean);
CREATE TABLE public.shop_handovers (order_id uuid PRIMARY KEY, ready_at timestamptz, ready_photo_path text, shop_confirmed_at timestamptz,
  confirmed_at timestamptz, confirmed_how text, problem_at timestamptz, problem_note text);
CREATE TABLE public.shop_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid UNIQUE, items_cents integer, debt_cents integer,
  amount_cents integer, status text, next_attempt_at timestamptz, setup_fee_cents integer NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0,
  send_tried boolean NOT NULL DEFAULT false);
CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, amount_cents integer, status text,
  setup_fee_cents integer NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0, send_tried boolean NOT NULL DEFAULT false);
CREATE TABLE public.payout_send_marks (payout_kind text, payout_id uuid);
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, raised_cents integer);
CREATE TABLE public.helpr_task_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helpr_id uuid, task_id uuid, amount_cents integer, status text,
  setup_fee_cents integer NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0, send_tried boolean NOT NULL DEFAULT false);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, stripe_account_id text, onboarding_fee_paid boolean DEFAULT false);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.id_waits (user_id uuid);
CREATE TABLE public.verified_ids (user_id uuid);
CREATE TABLE public.notices (user_id uuid, title text, message text);
CREATE FUNCTION public.declutter_identity_gate(u uuid, code text) RETURNS void LANGUAGE plpgsql AS \$f\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.verified_ids v WHERE v.user_id = u) THEN RAISE EXCEPTION '%', code USING ERRCODE = '42501'; END IF;
END \$f\$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.contact_leak_reason(text) RETURNS text LANGUAGE sql AS 'SELECT NULL::text';
CREATE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql AS \$f\$ SELECT (now() AT TIME ZONE 'America/Chicago')::date \$f\$;
CREATE FUNCTION public.declutter_consume_fee_debt(uuid, text, integer) RETURNS integer LANGUAGE sql AS 'SELECT 0';
CREATE FUNCTION public.declutter_setup_fee_from_payout_cents(uuid) RETURNS integer LANGUAGE sql AS 'SELECT 200';
CREATE FUNCTION public.payout_waits_on_identity(u uuid) RETURNS boolean LANGUAGE sql AS
  \$f\$ SELECT EXISTS (SELECT 1 FROM public.id_waits w WHERE w.user_id = u) \$f\$;
CREATE FUNCTION public.declutter_notify(u uuid, ty text, ti text, m text, l text, a uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  \$f\$ INSERT INTO public.notices VALUES (u, ti, m) \$f\$;
INSERT INTO public.profiles (user_id, stripe_account_id) VALUES ('${BUYER}', NULL), ('${SELLER}', 'acct_1'), ('${VERIFIED}', 'acct_2');
INSERT INTO public.verified_ids VALUES ('${VERIFIED}');
`);

for (const f of ["20261105174853_shops_identity_check.sql", "20261112081213_shops_notice_words_s011_s017.sql", "20261112093000_shops_setup_fee_notice_exact.sql"]) {
  await db.exec(readFileSync(MIG_DIR + f, "utf8"));
}
if (!skip) {
  const mig = readFileSync(THIS, "utf8");
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}
const q = async (s) => (await db.query(s)).rows;
const run = async (sql) => { try { await q(sql); return null; } catch (e) { return e.message; } };
const last = async (u) => (await q(`SELECT title, message FROM public.notices WHERE user_id = '${u}' ORDER BY ctid DESC LIMIT 1`))[0] ?? {};
const order = async (seller) => {
  const id = (await q(`INSERT INTO public.shop_orders (buyer_id, seller_id, status, captured_at, ready_date)
    VALUES ('${VERIFIED}', '${seller}', 'accepted', now(), current_date - 1) RETURNING id`))[0].id;
  await db.exec(`INSERT INTO public.shop_order_lines VALUES ('${id}', 'made', false)`);
  return id;
};

try {
  // 1. Listing: an unverified seller's draft goes live.
  const item = (await q(`INSERT INTO public.shop_items (owner_id) VALUES ('${SELLER}') RETURNING id`))[0].id;
  let e = await run(`UPDATE public.shop_items SET status = 'live' WHERE id = '${item}'`);
  check(e === null, "an unverified seller's first item goes live", true, e ?? "");
  e = await run(`INSERT INTO public.shop_items (owner_id, status) VALUES ('${SELLER}', 'pending_review')`);
  check(e === null, "an unverified seller's item inserted for review is accepted", true, e ?? "");
  // 2. Buying: an unverified buyer's first order is accepted.
  e = await run(`INSERT INTO public.shop_orders (buyer_id, seller_id, status) VALUES ('${BUYER}', '${SELLER}', 'held')`);
  check(e === null, "an unverified buyer's first order is accepted", true, e ?? "");
  // A verified member was always fine (control: the stub gate passes them before and after).
  e = await run(`INSERT INTO public.shop_orders (buyer_id, seller_id, status) VALUES ('${VERIFIED}', '${SELLER}', 'held')`);
  check(e === null, "a verified buyer's order is accepted (control)", false, e ?? "");
  // 3. The trigger functions are gone.
  const fns = await q(`SELECT proname FROM pg_proc WHERE proname IN ('shop_identity_before_list', 'shop_identity_before_buy')`);
  check(fns.length === 0, "shop_identity_before_list / _buy are dropped", true, JSON.stringify(fns));
  // 4. The payout notice: a seller whose ID is outstanding is told the money is on its way, never "Verify your ID".
  await q(`INSERT INTO public.id_waits VALUES ('${SELLER}')`);
  const o1 = await order(SELLER);
  e = await run(`SELECT public.shop_complete_handover('${o1}', 'buyer')`);
  const n1 = await last(SELLER);
  check(e === null && /^\$48\.00 is on its way to your payout account \(the one-time \$2\.00 setup fee was taken out\)\.$/.test(n1.message ?? ""),
    "ID outstanding: the notice says $48.00 is on its way, with the setup-fee words unchanged", true, e ?? JSON.stringify(n1));
  check(!/Verify your ID/.test(n1.message ?? ""), "no 'Verify your ID in Settings' notice", true, JSON.stringify(n1));
  // 5. Money unchanged: the payout row is the same as before (amount = items - debt, pending).
  const p1 = (await q(`SELECT items_cents, debt_cents, amount_cents, status FROM public.shop_payouts WHERE order_id = '${o1}'`))[0];
  check(p1 && p1.items_cents === 5000 && p1.debt_cents === 0 && p1.amount_cents === 5000 && p1.status === "pending", "the payout row is unchanged", false, JSON.stringify(p1));
  // 6. No payout account still says set up payouts first (unchanged precedence).
  await q(`UPDATE public.profiles SET stripe_account_id = NULL WHERE user_id = '${SELLER}'`);
  const o2 = await order(SELLER);
  e = await run(`SELECT public.shop_complete_handover('${o2}', 'buyer')`);
  const n2 = await last(SELLER);
  check(e === null && /^Set up payouts in Settings to get your \$50\.00\./.test(n2.message ?? ""), "no payout account: 'Set up payouts' as before", false, e ?? JSON.stringify(n2));
  // 7. Grants: service_role only.
  const acl = (await q(`SELECT proacl::text a FROM pg_proc WHERE proname = 'shop_complete_handover'`))[0]?.a ?? "";
  check(/service_role=X/.test(acl) && !/authenticated=|anon=|=X\//.test(acl.replace(/service_role=X\/\w+/, "").replace(/postgres=X\/\w+/, "")), "shop_complete_handover is service_role only", false, acl);
} catch (err) {
  check(false, `threw: ${err.message}`);
}
console.log(`\n${reds} RED checks, ${redFails} failed`);
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
