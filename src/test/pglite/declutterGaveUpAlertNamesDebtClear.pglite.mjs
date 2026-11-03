#!/usr/bin/env node
/**
 * PGlite proof for 20261103223546_declutter_gave_up_alert_names_debt_clear (Q1927): the gave-up alert for a Declutter
 * refund also tells the admin how to clear the seller's card-fee debt when no refund will be made, and nothing else
 * about the function changes (same ledger title, same buyer notice, once a day).
 *
 *   node src/test/pglite/declutterGaveUpAlertNamesDebtClear.pglite.mjs                     # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterGaveUpAlertNamesDebtClear.pglite.mjs  # RED: the old alert
 *
 * Real: the 20261017055500 body verbatim (its prosrc md5 checked against prod, read-only 11-03), then this migration
 * 3x. Tables reduced to the columns read; declutter_notify is a recording stub. pglite loads from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261103223546_declutter_gave_up_alert_names_debt_clear.sql";
const OLD = "20261017055500_declutter_refund_hand_settle.sql";
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid);
CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY, order_id uuid, refund_cents integer, attempts integer, is_seed boolean DEFAULT false,
  last_error text, gave_up_notified_at timestamptz, status text, created_at timestamptz DEFAULT now());
CREATE TABLE public.error_logs (id serial, severity text, message text, tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.notices (user_id uuid, title text, body text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.notices VALUES (p_user, p_title, p_body) $$;
`);
const old = readFileSync(MIG_DIR + OLD, "utf8");
const a = old.indexOf("CREATE OR REPLACE FUNCTION public.declutter_refund_gave_up_check(");
await db.exec(old.slice(a, old.indexOf("$fn$;", a) + 5));
const m = (await db.query(`SELECT md5(prosrc) AS m FROM pg_proc WHERE proname = 'declutter_refund_gave_up_check'`)).rows[0].m;
check(m === "b901f02d1a831a618c03193377c7ced0", "the old body rebuilt here is prod's (prosrc md5 b901f02d)", m);
if (!skip) {
  const sql = readFileSync(MIG_DIR + THIS, "utf8");
  let applied = true;
  for (let i = 0; i < 3; i++) { try { await db.exec(sql); } catch (e) { applied = false; check(false, `migration applies (run ${i + 1})`, e.message); } }
  check(applied, "migration applies 3x");
}
const q = async (s, p = []) => (await db.query(s, p)).rows;
await q(`INSERT INTO public.declutter_orders VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2')`);
await q(`INSERT INTO public.declutter_refunds (id, order_id, refund_cents, attempts, status, last_error)
         VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 2599, 12, 'failed', 'card closed')`);
const n = (await q(`SELECT public.declutter_refund_gave_up_check('00000000-0000-0000-0000-0000000000a1') AS n`))[0].n;
await q(`SELECT public.declutter_refund_gave_up_check()`); // the daily re-raise in the same day adds nothing
const logs = await q(`SELECT message, tags FROM public.error_logs`);
check(n === 1 && logs.length === 1, "one gave-up row, one alert a day", JSON.stringify({ n, logs: logs.length }));
const msg = logs[0]?.message ?? "";
check(msg.startsWith("Declutter refund gave up after 12 tries: refund it by hand in Stripe — refund row 00000000-0000-0000-0000-0000000000a1 ($25.99"),
  "the ledger title (before ' — ') and the row detail are unchanged", msg);
check(/If you decide not to refund, clear the seller's card-fee debt for it: Admin, the seller's page, Owed from Declutter refunds, Clear what's left\.$/.test(msg),
  "the alert says how to clear the seller's card-fee debt when no refund will be made", msg);
check(logs[0]?.tags?.source === "declutter-refund-gave-up", "same tags", JSON.stringify(logs[0]?.tags));
const notices = await q(`SELECT title FROM public.notices`);
check(notices.length === 1 && notices[0].title === "Your refund is being sent by hand", "the buyer is still told once", JSON.stringify(notices));
const g = (await q(`SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS a, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS s FROM pg_proc p WHERE p.proname = 'declutter_refund_gave_up_check'`))[0];
check(g && !g.a && !g.u && g.s, "grants: service_role only", JSON.stringify(g));

console.log(failures ? `\n${failures} FAILED` : "\nall PASS");
process.exit(failures ? 1 : 0);
