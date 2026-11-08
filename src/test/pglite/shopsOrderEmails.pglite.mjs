#!/usr/bin/env node
/**
 * PGlite proof for 20261108201655_shops_order_emails.sql (shops audit 11-08 #7, Builder 5): the key Shops notices are
 * emailed (New order to the shop; accepted / ready / refunded / cancelled by the shop to the buyer; Payment sent to the
 * shop), and nothing else is. The router is the real one (declutter_notice_type from 20261108201153), so a sender's
 * old Jobs type still lands as shops_orders before the email trigger reads it. send_notice_email is a recorder: the
 * switch, master switch and test/seed recipient refusal live in send-notification-email.
 *
 *   node src/test/pglite/shopsOrderEmails.pglite.mjs                     # ALL PASS (applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsOrderEmails.pglite.mjs  # RED: no Shops email, no payout notice
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261108201655_shops_order_emails.sql"), "utf8");

function cutFn(file, name) {
  const s = readFileSync(url(file), "utf8");
  const at = s.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (at < 0) throw new Error(`${name} not in ${file}`);
  const tag = /AS\s+(\$[a-zA-Z_]*\$)/.exec(s.slice(at));
  const bodyStart = at + tag.index + tag[0].length;
  const end = s.indexOf(tag[1], bodyStart) + tag[1].length;
  return `${s.slice(at, end)};`;
}

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [BUYER, SELLER, ORDER] = [1, 11, 51].map(id);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text NOT NULL,
  title text, message text, link text);
${cutFn("20261108201153_shops_notice_kinds.sql", "declutter_notice_type")}
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  INSERT INTO public.notifications (user_id, type, title, message, link)
  VALUES (p_user, public.declutter_notice_type(p_type, p_title, p_link), p_title, p_message, p_link);
END $$;
CREATE TABLE public.emails (user_id uuid, title text, message text, type text, link text);
CREATE FUNCTION public.send_notice_email(p_user_id uuid, p_title text, p_message text, p_type text, p_link text, p_job_id uuid)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.emails VALUES (p_user_id, p_title, p_message, p_type, p_link) $$;
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid);
CREATE TABLE public.shop_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, amount_cents integer NOT NULL,
  status text NOT NULL);
INSERT INTO public.shop_orders VALUES ('${ORDER}', '${BUYER}', '${SELLER}');
`;

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`PASS ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); }
};

const db = new PGlite();
await db.exec(SCHEMA);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
}
const q = async (sql) => (await db.query(sql)).rows;
const notify = (user, type, title, link) =>
  q(`SELECT public.declutter_notify('${user}', '${type}', '${title.replace(/'/g, "''")}', 'words', '${link}')`);
const mailed = async (title, user) =>
  (await q(`SELECT count(*)::int AS n FROM public.emails WHERE title = '${title.replace(/'/g, "''")}' AND user_id = '${user}'`))[0].n;

// The senders' real calls (type, title, link as the newest Shops functions write them).
await notify(SELLER, "new_offers", "New order", "/shops/dashboard");
await notify(BUYER, "payment", "Order accepted", "/shops/orders");
await notify(BUYER, "payment", "Your order is ready", "/shops/orders");
await notify(BUYER, "payment", "Order refunded", "/shops/orders");
await notify(SELLER, "warning", "Order refunded", "/shops/dashboard");
await notify(BUYER, "payment", "Order cancelled by the shop", "/shops/orders");
await notify(SELLER, "info", "New message for your shop", "/shops/91?talk=7");
await notify(BUYER, "new_offers", "New order", "/jobs/1");

ok((await mailed("New order", SELLER)) === 1, "the shop is emailed a new order");
ok((await mailed("Order accepted", BUYER)) === 1, "the buyer is emailed when the shop accepts");
ok((await mailed("Your order is ready", BUYER)) === 1, "the buyer is emailed when the order is ready");
ok((await mailed("Order refunded", BUYER)) === 1, "the buyer is emailed a refund");
ok((await mailed("Order cancelled by the shop", BUYER)) === 1, "the buyer is emailed when the shop cancels");
ok((await mailed("Order refunded", SELLER)) === 0, "the shop's own refund notice stays in the app");
ok((await mailed("New message for your shop", SELLER)) === 0, "shop chat messages are not emailed");
ok((await mailed("New order", BUYER)) === 0, "a non-Shops notice with the same title is not emailed");
const types = await q(`SELECT DISTINCT type FROM public.emails`);
ok(types.length === 1 && types[0].type === "shops_orders", "every Shops email goes out as shops_orders (the Orders email switch)");

// Payment sent.
const [{ id: payout }] = await q(`INSERT INTO public.shop_payouts (order_id, amount_cents, status) VALUES ('${ORDER}', 2350, 'pending') RETURNING id`);
await q(`UPDATE public.shop_payouts SET status = 'failed' WHERE id = '${payout}'`);
ok((await mailed("Payment sent", SELLER)) === 0, "a failed send is not called sent");
await q(`UPDATE public.shop_payouts SET status = 'succeeded' WHERE id = '${payout}'`);
const sent = await q(`SELECT message, type FROM public.notifications WHERE title = 'Payment sent'`);
ok(sent.length === 1 && sent[0].type === "shops_orders" && /\$23\.50/.test(sent[0].message), "the shop gets Payment sent with the amount");
ok((await mailed("Payment sent", SELLER)) === 1, "and the receipt is emailed");
await q(`UPDATE public.shop_payouts SET status = 'succeeded' WHERE id = '${payout}'`);
ok((await mailed("Payment sent", SELLER)) === 1, "a repeated write never sends a second receipt");

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
