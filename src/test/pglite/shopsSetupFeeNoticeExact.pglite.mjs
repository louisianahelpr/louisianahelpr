#!/usr/bin/env node
/**
 * PGlite proof for 20261112093000_shops_setup_fee_notice_exact.sql (S011 money note): when another unsent payout of the
 * account could take the one-time setup fee first, the "Order picked up / finished" notice does not subtract it and
 * says it comes out of the first payout sent. Base: 20261112081213 (whole file), then this migration 3x.
 * Schema and stubs as src/test/pglite/shopsNoticeWords.pglite.mjs, plus the payout columns the rule reads.
 *
 *   node src/test/pglite/shopsSetupFeeNoticeExact.pglite.mjs                    # ALL PASS
 *   NEW_MIGRATION=skip node src/test/pglite/shopsSetupFeeNoticeExact.pglite.mjs # RED: both notices subtract the fee
 *
 * (Original header of the template follows.)
 *   S011: the shop's payout notice names the amount really sent (the one-time setup fee taken out of the first payout,
 *         as shop_payout_take_setup_fee does, never under $1) and says "Verify your ID" while the payout waits for it.
 *   S017: ready / handed over / problem / done notices say "done" for a service and "delivered" for a delivery.
 *
 *   node src/test/pglite/shopsNoticeWords.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsNoticeWords.pglite.mjs # RED: the newest CREATEs before it
 *   MIGRATION_PATH=<planted copy> node ...                               # RED on a planted defect
 *
 * Stubbed, and said so: tables cut to the columns read; auth.uid() from a setting; is_caller_banned false;
 * contact_leak_reason NULL; declutter_consume_fee_debt from a setting; declutter_setup_fee_from_payout_cents and
 * payout_waits_on_identity from tables; declutter_notify records; storage.objects empty (in-person needs no photo).
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261112093000_shops_setup_fee_notice_exact.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `5a0b5a0f-0000-0000-0000-${String(n).padStart(12, "0")}`;
const BUYER = U(1), SELLER = U(2);
function fnFrom(file, name) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const tag = t.slice(s).match(/\nAS (\$[a-z_]*\$)/)[1];
  const open = t.indexOf(`\nAS ${tag}`, s) + 4 + tag.length;
  return t.slice(s, t.indexOf(`\n${tag}`, open) + 1 + tag.length) + ";";
}
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE TABLE storage.objects (bucket_id text, name text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$f\$ SELECT nullif(current_setting('test.uid', true), '')::uuid \$f\$;
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
CREATE TABLE public.notices (user_id uuid, title text, message text);
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.contact_leak_reason(text) RETURNS text LANGUAGE sql AS 'SELECT NULL::text';
CREATE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql AS \$f\$ SELECT (now() AT TIME ZONE 'America/Chicago')::date \$f\$;
CREATE FUNCTION public.declutter_consume_fee_debt(uuid, text, integer) RETURNS integer LANGUAGE sql AS
  \$f\$ SELECT least(\$3, coalesce(nullif(current_setting('test.debt', true), ''), '0')::integer) \$f\$;
CREATE FUNCTION public.declutter_setup_fee_from_payout_cents(uuid) RETURNS integer LANGUAGE sql AS 'SELECT 200';
CREATE FUNCTION public.payout_waits_on_identity(u uuid) RETURNS boolean LANGUAGE sql AS
  \$f\$ SELECT EXISTS (SELECT 1 FROM public.id_waits w WHERE w.user_id = u) \$f\$;
CREATE FUNCTION public.declutter_notify(u uuid, ty text, ti text, m text, l text, a uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  \$f\$ INSERT INTO public.notices VALUES (u, ti, m) \$f\$;
INSERT INTO public.profiles (user_id, stripe_account_id) VALUES ('${BUYER}', NULL), ('${SELLER}', 'acct_1');
`);

await db.exec(readFileSync(MIG_DIR + "20261112081213_shops_notice_words_s011_s017.sql", "utf8"));
if (!skip) {
  const mig = readFileSync(THIS, "utf8");
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}
const q = async (s) => (await db.query(s)).rows;
const order = async ({ items = 5000 } = {}) => {
  const id = (await q(`INSERT INTO public.shop_orders (buyer_id, seller_id, status, captured_at, ready_date, items_cents)
    VALUES ('${BUYER}', '${SELLER}', 'accepted', now(), current_date - 1, ${items}) RETURNING id`))[0].id;
  await db.exec(`INSERT INTO public.shop_order_lines VALUES ('${id}', 'made', false)`);
  return id;
};
const last = async (u) => (await q(`SELECT title, message FROM public.notices WHERE user_id = '${u}' ORDER BY ctid DESC LIMIT 1`))[0] ?? {};
const run = async (sql) => { try { await q(sql); return null; } catch (e) { return e.message; } };
const finish = async (id) => { const e = await run(`SELECT public.shop_complete_handover('${id}', 'buyer')`); return { e, n: await last(SELLER) }; };
const LATER = /The one-time \$2\.00 setup fee comes out of the first payout we send\. We tell you when it does\.$/;
try {
  // Alone: the fee comes out of this payout, as before.
  const a = await order();
  let { e, n } = await finish(a);
  check(!e && /^\$48\.00 is on its way/.test(n.message ?? "") && !LATER.test(n.message ?? ""), "alone: $50 - $2 = $48, as before", e ?? JSON.stringify(n));
  // A second order finishing while the first payout is unsent: the full amount, and which payout pays the fee.
  const b = await order();
  ({ e, n } = await finish(b));
  check(!e && /^\$50\.00 is on its way to your payout account\./.test(n.message ?? "") && LATER.test(n.message ?? ""),
    "two orders before the first send: the second notice does not subtract the fee again", e ?? JSON.stringify(n));
  // Once the first payout was tried (it took the fee), the next order is not told the fee is still to come.
  await q(`UPDATE public.shop_payouts SET send_tried = true, attempts = 1, setup_fee_cents = 200 WHERE order_id IN ('${a}', '${b}')`);
  await q(`UPDATE public.profiles SET onboarding_fee_paid = true WHERE user_id = '${SELLER}'`);
  const c = await order();
  ({ e, n } = await finish(c));
  check(!e && /^\$50\.00 is on its way to your payout account\.$/.test(n.message ?? ""), "fee paid: whole amount, no fee words", e ?? JSON.stringify(n));
  await q(`UPDATE public.profiles SET onboarding_fee_paid = false WHERE user_id = '${SELLER}'`);
  await q(`UPDATE public.shop_payouts SET status = 'succeeded'`);
  // A Declutter payout waiting to be sent counts too.
  await q(`INSERT INTO public.declutter_payouts (seller_id, amount_cents, status) VALUES ('${SELLER}', 3000, 'pending')`);
  const d = await order();
  ({ e, n } = await finish(d));
  check(!e && /^\$50\.00 is on its way/.test(n.message ?? "") && LATER.test(n.message ?? ""), "an unsent Declutter payout may take the fee first", e ?? JSON.stringify(n));
  await q(`UPDATE public.declutter_payouts SET status = 'succeeded'`);
  await q(`UPDATE public.shop_payouts SET status = 'succeeded'`);
  // A Helpr task payout too; one too small to take the fee does not count.
  await q(`INSERT INTO public.helpr_task_payouts (helpr_id, amount_cents, status) VALUES ('${SELLER}', 250, 'pending')`);
  const f = await order();
  ({ e, n } = await finish(f));
  check(!e && /^\$48\.00 is on its way/.test(n.message ?? ""), "a payout too small to take the fee does not count", e ?? JSON.stringify(n));
  await q(`UPDATE public.shop_payouts SET status = 'succeeded'`);
  await q(`UPDATE public.helpr_task_payouts SET amount_cents = 4000`);
  const g = await order();
  ({ e, n } = await finish(g));
  check(!e && LATER.test(n.message ?? ""), "an unsent Helpr payout may take the fee first", e ?? JSON.stringify(n));
  await q(`UPDATE public.helpr_task_payouts SET status = 'succeeded'`);
  await q(`UPDATE public.shop_payouts SET status = 'succeeded'`);
  // A payout already tried keeps its amount (cannot take the fee): not a rival.
  await q(`INSERT INTO public.declutter_payouts (seller_id, amount_cents, status, send_tried) VALUES ('${SELLER}', 3000, 'failed', true)`);
  const h = await order();
  ({ e, n } = await finish(h));
  check(!e && /^\$48\.00 is on its way/.test(n.message ?? ""), "a payout already tried is not a rival", e ?? JSON.stringify(n));
  await q(`UPDATE public.shop_payouts SET status = 'succeeded'`);
  // A payout with a send mark (a send started) cannot take the fee: not a rival.
  const mk = (await q(`INSERT INTO public.declutter_payouts (seller_id, amount_cents, status) VALUES ('${SELLER}', 3000, 'pending') RETURNING id`))[0].id;
  await q(`INSERT INTO public.payout_send_marks VALUES ('declutter', '${mk}')`);
  const m1 = await order();
  ({ e, n } = await finish(m1));
  check(!e && /^\$48\.00 is on its way/.test(n.message ?? ""), "a payout with a send mark is not a rival", e ?? JSON.stringify(n));
  await q(`UPDATE public.declutter_payouts SET status = 'succeeded'`);
  await q(`UPDATE public.shop_payouts SET status = 'succeeded'`);
  // A Helpr payout whose raise leaves too little after the fee is not a rival (helpr_task_payout_take_setup_fee).
  await q(`INSERT INTO public.helpr_tasks VALUES ('5a0b5a0f-0000-0000-0000-0000000000aa', 3900)`);
  await q(`INSERT INTO public.helpr_task_payouts (helpr_id, task_id, amount_cents, status) VALUES ('${SELLER}', '5a0b5a0f-0000-0000-0000-0000000000aa', 4000, 'pending')`);
  const r1 = await order();
  ({ e, n } = await finish(r1));
  check(!e && /^\$48\.00 is on its way/.test(n.message ?? ""), "a raised Helpr payout too small after the fee is not a rival", e ?? JSON.stringify(n));
  await q(`UPDATE public.helpr_task_payouts SET status = 'succeeded'`);
  await q(`UPDATE public.shop_payouts SET status = 'succeeded'`);
  // ID wait with a rival: the full amount and the fee words.
  await q(`INSERT INTO public.declutter_payouts (seller_id, amount_cents, status) VALUES ('${SELLER}', 3000, 'pending')`);
  await db.exec(`INSERT INTO public.id_waits VALUES ('${SELLER}')`);
  const i = await order();
  ({ e, n } = await finish(i));
  check(!e && /^Verify your ID in Settings to get your \$50\.00\./.test(n.message ?? "") && LATER.test(n.message ?? ""), "ID wait with a rival: full amount + fee words", e ?? JSON.stringify(n));
  const acl = (await q(`SELECT proname, proacl::text a FROM pg_proc WHERE proname IN ('setup_fee_other_payout_first', 'setup_fee_later_words')`));
  check(acl.length === 2 && acl.every((r) => /service_role=X/.test(r.a) && !/authenticated=|anon=/.test(r.a)), "both helpers service_role only", JSON.stringify(acl));
} catch (err) { check(false, `threw: ${err.message}`); }
console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
