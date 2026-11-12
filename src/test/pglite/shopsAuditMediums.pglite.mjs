#!/usr/bin/env node
/**
 * PGlite proof for 20261112075006_shops_audit_mediums.sql (Shops audit 11-12 S015, S019).
 *
 *   node src/test/pglite/shopsAuditMediums.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsAuditMediums.pglite.mjs # RED: the old bodies from their newest CREATEs
 *   MUTANT=<name> node ...                                                # each must FAIL
 *
 * Stubbed, and said so: tables cut to the columns read; auth.uid() from a setting; is_caller_banned false;
 * shop_lock_open_charged_order returns the row; shop_owe_shop 100; shop_give_strike no-op; declutter_notify records;
 * shop_local_today is today in Louisiana.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261112075006_shops_audit_mediums.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const MUTANTS = {
  helprMarkable: ["  IF o.fulfillment = 'helpr_delivers' AND o.helpr_unfilled_at IS NULL THEN\n    RAISE EXCEPTION 'helpr_delivers_handover'", "  IF false THEN\n    RAISE EXCEPTION 'helpr_delivers_handover'"],
  fallbackRefused: ["  IF o.fulfillment = 'helpr_delivers' AND o.helpr_unfilled_at IS NULL THEN\n    RAISE EXCEPTION 'helpr_delivers_handover'", "  IF o.fulfillment = 'helpr_delivers' THEN\n    RAISE EXCEPTION 'helpr_delivers_handover'"],
  backwards: ["The shop says you weren''t there for the delivery", "The shop says you didn''t receive the delivery"],
};
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `7f0b7f0c-0000-0000-0000-${String(n).padStart(12, "0")}`;
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
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, status text NOT NULL,
  captured_at timestamptz, close_reason text, closed_at timestamptz, ready_date date, handover_mode text NOT NULL DEFAULT 'in_person',
  fulfillment text NOT NULL DEFAULT 'pickup', helpr_unfilled_at timestamptz);
CREATE TABLE public.shop_handovers (order_id uuid PRIMARY KEY, ready_at timestamptz, shop_confirmed_at timestamptz, confirmed_at timestamptz,
  problem_at timestamptz);
CREATE TABLE public.notices (user_id uuid, title text, message text);
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.shop_lock_open_charged_order(p uuid, b boolean) RETURNS public.shop_orders LANGUAGE sql AS
  $f$ SELECT * FROM public.shop_orders WHERE id = p $f$;
CREATE FUNCTION public.shop_owe_shop(uuid) RETURNS integer LANGUAGE sql AS 'SELECT 100';
CREATE FUNCTION public.shop_give_strike(uuid, text, text, uuid) RETURNS void LANGUAGE sql AS 'SELECT NULL::void';
CREATE FUNCTION public.declutter_notify(u uuid, ty text, ti text, m text, l text, a uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO public.notices VALUES (u, ti, m) $f$;
CREATE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql AS $f$ SELECT (now() AT TIME ZONE 'America/Chicago')::date $f$;
`);
if (skip) {
  await db.exec(fnFrom("20261105182903_shops_handover_rule.sql", "shops_mark_handed_over"));
  await db.exec(fnFrom("20261112073633_shops_audit_highs.sql", "shops_report_no_show"));
} else {
  let mig = readFileSync(MIG_DIR + THIS, "utf8");
  const M = process.env.MUTANT ?? "";
  if (M) { const m = MUTANTS[M]; if (!m || mig.split(m[0]).length !== 2) throw new Error(`mutant ${M} did not apply`); mig = mig.replace(m[0], m[1]); }
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}
const q = async (s) => (await db.query(s)).rows;
const order = async (cols) => (await q(`INSERT INTO public.shop_orders (buyer_id, seller_id, status, captured_at, ready_date, fulfillment, helpr_unfilled_at)
  VALUES ('${BUYER}', '${SELLER}', 'accepted', now(), ${cols.date ?? "current_date"}, '${cols.f ?? "pickup"}', ${cols.unfilled ? "now()" : "NULL"}) RETURNING id`))[0].id;
const asSeller = async (sql) => { await db.exec(`SELECT set_config('test.uid', '${SELLER}', false)`); try { return { rows: await q(sql) }; } catch (e) { return { error: e.message }; } };
try {
  const hd = await order({ f: "helpr_delivers" });
  const r1 = await asSeller(`SELECT public.shops_mark_handed_over('${hd}') AS r`);
  const h1 = await q(`SELECT shop_confirmed_at FROM public.shop_handovers WHERE order_id = '${hd}'`);
  check(/helpr_delivers_handover/.test(r1.error ?? "") && h1.length === 0, "S015: the shop cannot mark a Helpr-delivered order handed over (no 48-hour auto-pay starts)", r1.error ?? "no error");
  const fb = await order({ f: "helpr_delivers", unfilled: true });
  const r2 = await asSeller(`SELECT public.shops_mark_handed_over('${fb}') AS r`);
  check(r2.rows?.[0]?.r?.result === "marked", "S015: one that fell back to pickup (no Helpr took it) can be", r2.error ?? JSON.stringify(r2.rows));
  const pk = await order({});
  const r3 = await asSeller(`SELECT public.shops_mark_handed_over('${pk}') AS r`);
  check(r3.rows?.[0]?.r?.result === "marked", "S015: a pickup order is unchanged", r3.error ?? "");
  const sd = await order({ f: "shop_delivers", date: "current_date - 2" });
  await db.exec(`INSERT INTO public.shop_handovers (order_id, ready_at) VALUES ('${sd}', now())`);
  const r4 = await asSeller(`SELECT public.shops_report_no_show('${sd}')`);
  const n = await q(`SELECT message FROM public.notices WHERE user_id = '${BUYER}' AND title = 'Missed delivery'`);
  check(!r4.error && /The shop says you weren't there for the delivery/.test(n[0]?.message ?? "") && /If you were there, contact/.test(n[0]?.message ?? ""),
    "S019: the missed-delivery notice says \"you weren't there for the delivery ... If you were there\"", r4.error ?? JSON.stringify(n));
} catch (e) { check(false, `threw: ${e.message}`); }
console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
