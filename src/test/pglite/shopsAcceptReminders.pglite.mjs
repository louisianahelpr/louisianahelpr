#!/usr/bin/env node
/**
 * PGlite proof for 20261112075428_shops_accept_reminders.sql (Shops audit 11-12 S016): a shop is reminded about an order
 * waiting on its answer, ~12 h before accept_by and in the last 2 h, once per rung, never for a test order; Declutter's
 * reminders unchanged.
 *
 *   node src/test/pglite/shopsAcceptReminders.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsAcceptReminders.pglite.mjs # RED: the old sweep (20261109224952)
 *   MUTANT=<name> node ...                                                   # each must FAIL
 *
 * Stubbed, and said so: tables cut to the columns read (Declutter's empty but for one offer); needs_you_reminder_quiet
 * false; declutter_notify_strict records; log_cron_defect records. The real sends table and its CHECK (20261102002011).
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261112075428_shops_accept_reminders.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const MUTANTS = {
  noBranch: ["     WHERE so.status = 'held' AND so.accept_by IS NOT NULL", "     WHERE false AND so.accept_by IS NOT NULL"],
  seedReminded: ["       AND COALESCE(so.is_seed, false) = false\n  LOOP", "\n  LOOP"],
  wrongSide: ["    SELECT 'shop_order', so.id, so.accept_by, so.seller_id, so.buyer_id, 'seller',", "    SELECT 'shop_order', so.id, so.accept_by, so.buyer_id, so.seller_id, 'seller',"],
  noCheck: ["  CHECK (step IN ('offer', 'refund_answer', 'refund_offer', 'shop_order'));", "  CHECK (step IN ('offer', 'refund_answer', 'refund_offer'));"],
};
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `8a0b8a0c-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), BUYER = U(2), SHOP = U(3);
function fnFrom(file, name) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const tag = t.slice(s).match(/\nAS (\$[a-z_]*\$)/)[1];
  const open = t.indexOf(`\nAS ${tag}`, s) + 4 + tag.length;
  return t.slice(s, t.indexOf(`\n${tag}`, open) + 1 + tag.length) + ";";
}
const db = new PGlite();
const sends = readFileSync(MIG_DIR + "20261102002011_needs_you_deadline_reminders.sql", "utf8");
const tbl = sends.slice(sends.indexOf("CREATE TABLE IF NOT EXISTS public.needs_you_reminder_sends"), sends.indexOf(");", sends.indexOf("CREATE TABLE IF NOT EXISTS public.needs_you_reminder_sends")) + 2);
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
INSERT INTO auth.users VALUES ('${SELLER}'), ('${BUYER}');
${tbl}
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, title text);
CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid,
  status text, awaiting text, respond_by timestamptz, is_seed boolean DEFAULT false);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid);
CREATE TABLE public.declutter_cart_items (order_id uuid, item_id uuid, created_at timestamptz, id uuid);
CREATE TABLE public.declutter_refund_requests (id uuid PRIMARY KEY, order_id uuid, status text, answer_by timestamptz,
  offer_answer_by timestamptz, is_seed boolean DEFAULT false);
CREATE TABLE public.shops (id uuid PRIMARY KEY, name text);
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, buyer_id uuid, seller_id uuid,
  status text, accept_by timestamptz, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.sent (user_id uuid, type text, title text, message text, link text);
CREATE FUNCTION public.needs_you_reminder_quiet(timestamptz) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.declutter_notify_strict(u uuid, ty text, ti text, m text, l text, a uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO public.sent VALUES (u, ty, ti, m, l) $f$;
CREATE TABLE public.defects (what text);
CREATE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb) RETURNS void LANGUAGE sql AS $f$ INSERT INTO public.defects VALUES (c) $f$;
INSERT INTO public.shops VALUES ('${SHOP}', 'Mimi''s Kitchen');
INSERT INTO public.declutter_items VALUES ('${U(9)}', 'Lamp');
`);
if (skip) {
  await db.exec(fnFrom("20261109224952_notices_card_fee_and_our_team.sql", "sweep_needs_you_reminders"));
} else {
  let mig = readFileSync(MIG_DIR + THIS, "utf8");
  const M = process.env.MUTANT ?? "";
  if (M) { const m = MUTANTS[M]; if (!m || mig.split(m[0]).length !== 2) throw new Error(`mutant ${M} did not apply`); mig = mig.replace(m[0], m[1]); }
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}
const q = async (s) => (await db.query(s)).rows;
// A fixed "now" at 10 AM Louisiana time.
const NOW = "2026-11-12 16:00:00+00";
const sweep = async (now = NOW) => (await q(`SELECT public.sweep_needs_you_reminders('${now}'::timestamptz) AS n`))[0].n;
try {
  await db.exec(`INSERT INTO public.shop_orders (shop_id, buyer_id, seller_id, status, accept_by) VALUES
    ('${SHOP}', '${BUYER}', '${SELLER}', 'held', '${NOW}'::timestamptz + interval '10 hours'),
    ('${SHOP}', '${BUYER}', '${SELLER}', 'held', '${NOW}'::timestamptz + interval '20 hours'),
    ('${SHOP}', '${BUYER}', '${SELLER}', 'accepted', '${NOW}'::timestamptz + interval '10 hours')`);
  await db.exec(`INSERT INTO public.shop_orders (shop_id, buyer_id, seller_id, status, accept_by, is_seed) VALUES
    ('${SHOP}', '${BUYER}', '${SELLER}', 'held', '${NOW}'::timestamptz + interval '10 hours', true)`);
  await db.exec(`INSERT INTO public.declutter_offers (item_id, buyer_id, seller_id, status, awaiting, respond_by) VALUES
    ('${U(9)}', '${BUYER}', '${SELLER}', 'open', 'seller', '${NOW}'::timestamptz + interval '5 hours')`);
  await sweep();
  const shopSent = await q(`SELECT * FROM public.sent WHERE link = '/shops/dashboard'`);
  check(shopSent.length === 1 && shopSent[0].user_id === SELLER && shopSent[0].title === "Answer the new order"
    && /A new order at Mimi's Kitchen is waiting on you\. Next: accept or decline it by 8:00 PM today/.test(shopSent[0].message),
    "S016: the shop gets one \"Answer the new order\" reminder ~12 h before the order drops (not for one 20 h out, an accepted one or a test one)",
    JSON.stringify(shopSent) + JSON.stringify(await q(`SELECT * FROM public.defects`)));
  check(shopSent[0]?.type === "new_offers", "S016: filed like the shop's other order notices (routed to the Shops Orders switch)");
  check((await q(`SELECT * FROM public.sent WHERE link LIKE '/declutter%'`)).length === 1, "Declutter's offer reminder is unchanged");
  await sweep();
  check((await q(`SELECT * FROM public.sent WHERE link = '/shops/dashboard'`)).length === 1, "S016: the same rung is never sent twice");
  await sweep("2026-11-13 00:30:00+00");
  const last = await q(`SELECT title FROM public.sent WHERE link = '/shops/dashboard' ORDER BY title`);
  check(last.map((r) => r.title).includes("Order drops soon"), "S016: in the last 2 hours the shop gets \"Order drops soon\"", JSON.stringify(last));
} catch (e) { check(false, `threw: ${e.message}`); }
console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
