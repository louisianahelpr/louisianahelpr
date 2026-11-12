#!/usr/bin/env node
/**
 * PGlite proof for 20261112084138_shops_service_no_show.sql (Shops audit 11-12 S049): an at-home service's no-show needs no
 * ready mark (services never get one), only that its day is over; a goods order still needs its ready mark.
 *
 *   node src/test/pglite/shopsServiceNoShow.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsServiceNoShow.pglite.mjs # RED: the newest CREATE before it
 *   MIGRATION_PATH=<planted copy> node ...                                 # RED on a planted defect
 *
 * Stubbed, and said so: tables cut to the columns read; auth.uid() from a setting; is_caller_banned false;
 * shop_lock_open_charged_order returns the row; shop_owe_shop 100; shop_give_strike no-op; declutter_notify records.
 * Real: shop_order_is_service (20261112081213).
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261112084138_shops_service_no_show.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const BUYER = "6e0b6e0c-0000-0000-0000-000000000001", SELLER = "6e0b6e0c-0000-0000-0000-000000000002";
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
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, status text NOT NULL,
  captured_at timestamptz, close_reason text, closed_at timestamptz, ready_date date, handover_mode text NOT NULL DEFAULT 'in_person',
  fulfillment text NOT NULL DEFAULT 'pickup', helpr_unfilled_at timestamptz);
CREATE TABLE public.shop_order_lines (order_id uuid, kind text, at_buyer boolean);
CREATE TABLE public.shop_handovers (order_id uuid PRIMARY KEY, ready_at timestamptz, shop_confirmed_at timestamptz, confirmed_at timestamptz, problem_at timestamptz);
CREATE TABLE public.notices (user_id uuid, title text, message text);
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.shop_lock_open_charged_order(p uuid, b boolean) RETURNS public.shop_orders LANGUAGE sql AS
  $f$ SELECT * FROM public.shop_orders WHERE id = p $f$;
CREATE FUNCTION public.shop_owe_shop(uuid) RETURNS integer LANGUAGE sql AS 'SELECT 100';
CREATE FUNCTION public.shop_give_strike(uuid, text, text, uuid) RETURNS void LANGUAGE sql AS 'SELECT NULL::void';
CREATE FUNCTION public.declutter_notify(u uuid, ty text, ti text, m text, l text, a uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO public.notices VALUES (u, ti, m) $f$;
CREATE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql AS $f$ SELECT (now() AT TIME ZONE 'America/Chicago')::date $f$;
${fnFrom("20261112081213_shops_notice_words_s011_s017.sql", "shop_order_is_service")}
`);
if (skip) await db.exec(fnFrom("20261112075006_shops_audit_mediums.sql", "shops_report_no_show"));
else { const mig = readFileSync(THIS, "utf8"); for (let k = 1; k <= 3; k++) await db.exec(mig); }
const q = async (s) => (await db.query(s)).rows;
const order = async (kind, days) => {
  const id = (await q(`INSERT INTO public.shop_orders (buyer_id, seller_id, status, captured_at, ready_date)
    VALUES ('${BUYER}', '${SELLER}', 'accepted', now(), (now() AT TIME ZONE 'America/Chicago')::date + ${days}) RETURNING id`))[0].id;
  await db.exec(`INSERT INTO public.shop_order_lines VALUES ('${id}', '${kind}', false)`);
  return id;
};
const noShow = async (id) => { await db.exec(`SELECT set_config('test.uid', '${SELLER}', false)`); try { return { r: (await q(`SELECT public.shops_report_no_show('${id}') AS r`))[0].r }; } catch (e) { return { error: e.message }; } };
try {
  const s1 = await order("service", -1);
  const a = await noShow(s1);
  check(a.r?.result === "no_show", "S049: a service whose day is over can be a no-show without a ready mark", a.error ?? JSON.stringify(a.r));
  const n = (await q(`SELECT title, message FROM public.notices WHERE user_id = '${BUYER}' ORDER BY ctid DESC LIMIT 1`))[0];
  check(n?.title === "Missed appointment" && !/pick up/.test(n?.message ?? ""), "S049: the buyer reads a missed appointment, not a pickup", JSON.stringify(n));
  const s2 = await order("service", 0);
  const b = await noShow(s2);
  check(/too_early_for_no_show/.test(b.error ?? ""), "S049: not before the service day is over", b.error ?? "allowed");
  const g = await order("made", -1);
  const c = await noShow(g);
  check(/not_ready/.test(c.error ?? ""), "S049: a goods order still needs its ready mark", c.error ?? "allowed");
} catch (e) { check(false, `threw: ${e.message}`); }
console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
