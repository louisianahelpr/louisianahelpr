#!/usr/bin/env node
/**
 * PGlite proof for 20261108201153_shops_notice_kinds.sql (shops audit 11-08 #6, Builder 5): Shops notices get their
 * own kinds (shops_orders / shops_messages / shops_updates), each with a push column and an email twin, default ON,
 * and declutter_notify's router files every Shops notice under one of them instead of a Jobs switch.
 *
 *   node src/test/pglite/shopsNoticeKinds.pglite.mjs                     # ALL PASS (applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsNoticeKinds.pglite.mjs  # RED: Shops notices on Jobs switches
 *
 * The OLD router is cut verbatim from its newest CREATE (20261104123305); the CHECK and the map start as prod's.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261108201153_shops_notice_kinds.sql"), "utf8");

function cutFn(file, name) {
  const s = readFileSync(url(file), "utf8");
  const at = s.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (at < 0) throw new Error(`${name} not in ${file}`);
  const tag = /AS\s+(\$[a-zA-Z_]*\$)/.exec(s.slice(at));
  const bodyStart = at + tag.index + tag[0].length;
  const end = s.indexOf(tag[1], bodyStart) + tag[1].length;
  return `${s.slice(at, end)};`;
}

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, new_offers boolean NOT NULL DEFAULT true);
CREATE TABLE public.notification_type_pref_map (type text PRIMARY KEY, pref_column text, description text);
INSERT INTO public.notification_type_pref_map VALUES ('new_offers', 'new_offers', 'Job offers'), ('payment', 'payments', 'Job payments');
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text NOT NULL,
  CONSTRAINT notifications_type_check CHECK (type IN (
    'info', 'success', 'warning', 'job_update', 'application', 'review', 'payment',
    'job_match', 'job_updates', 'work_status', 'transit_updates',
    'system_alert', 'new_offers', 'expired', 'financial_alerts', 'verified', 'message', 'admin_alert',
    'declutter_listings', 'declutter_offers', 'declutter_sales', 'declutter_pickups',
    'declutter_refunds', 'declutter_price_drops', 'declutter_wanted', 'declutter_questions')));
${cutFn("20261104123305_bundle_request_export_and_notice_kinds.sql", "declutter_notice_type")}
INSERT INTO public.notification_preferences (user_id, new_offers) VALUES ('00000000-0000-0000-0000-000000000001', false);
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
const kind = async (type, title, link) =>
  (await q(`SELECT public.declutter_notice_type('${type}', '${title.replace(/'/g, "''")}', ${link === null ? "NULL" : `'${link}'`}) AS k`))[0].k;

// The senders' real calls (type, title, link as written in the Shops migrations).
ok((await kind("new_offers", "New order", "/shops/dashboard")) === "shops_orders", "the seller's New order is a Shops order, not Job offers");
ok((await kind("payment", "Order accepted", "/shops/orders")) === "shops_orders", "money notices are Shops orders, not Job payments");
ok((await kind("warning", "Order cancelled", "/shops/dashboard")) === "shops_orders", "a cancel is a Shops order, not System alerts");
ok((await kind("info", "That day filled up", "/shops/91")) === "shops_orders", "a notice that opens the shop page is a Shops order");
ok((await kind("info", "New custom order request", "/shops/dashboard")) === "shops_orders", "a custom request is a Shops order");
ok((await kind("info", "New message for your shop", "/shops/91?talk=7")) === "shops_messages", "a shop chat message is a Shops message, not Work status");
ok((await kind("info", "New message from a shop", "/shops/91?talk=7")) === "shops_messages", "the buyer's chat notice is a Shops message");
ok((await kind("warning", "Shops strike", "/shops/orders")) === "shops_updates", "a Shops strike is a Shops update");
ok((await kind("info", "Custom orders are paid in full for now", "/shops/mine")) === "shops_updates", "a notice about the shop's own settings is a Shops update");
ok((await kind("shops_orders", "Anything", "/jobs")) === "shops_orders", "a caller's own Shops kind is kept");
// Nothing else moves.
ok((await kind("new_offers", "New offer on your job", "/jobs/1")) === "new_offers", "a Jobs notice keeps its type");
ok((await kind("new_offers", "New offer", "/declutter?tab=selling")) === "declutter_offers", "a Declutter notice keeps its Declutter kind");
ok((await kind("admin_alert", "Shop reported", "/admin/shops")) === "admin_alert", "an admin alert about a shop keeps its type");

let err = null;
try { await q(`INSERT INTO public.notifications (type) VALUES ('shops_orders'), ('shops_messages'), ('shops_updates')`); } catch (e) { err = e; }
ok(!err, "the three Shops types are allowed by notifications_type_check");
err = null;
try { await q(`INSERT INTO public.notifications (type) VALUES ('declutter_questions'), ('job_match')`); } catch (e) { err = e; }
ok(!err, "every earlier type is still allowed");
const map = await q(`SELECT type, pref_column FROM public.notification_type_pref_map WHERE type LIKE 'shops_%' ORDER BY type`);
ok(map.length === 3 && map.every((r) => r.pref_column === r.type), "each Shops type is gated by its own push column");
const cols = await q(`SELECT column_name, column_default FROM information_schema.columns
  WHERE table_name = 'notification_preferences' AND column_name LIKE '%shops_%' ORDER BY column_name`);
ok(cols.length === 6 && cols.every((c) => c.column_default === "true"), "six switches (push + email), all ON by default");
const muted = await q(`SELECT shops_orders, email_shops_orders FROM public.notification_preferences WHERE NOT new_offers`).catch(() => []);
ok(muted.length === 1 && muted[0].shops_orders === true && muted[0].email_shops_orders === true,
  "a member who muted Job offers still gets new shop orders");

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
