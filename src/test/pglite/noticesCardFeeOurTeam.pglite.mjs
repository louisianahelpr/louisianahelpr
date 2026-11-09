#!/usr/bin/env node
/**
 * PGlite proof for 20261109224952_notices_card_fee_and_our_team (Part 3: F197 + F198 + F193 rest, wording only).
 *
 *   npx tsx src/test/pglite/noticesCardFeeOurTeam.pglite.mjs [--replay] [--before]
 *
 * --before installs each function's previous definition (byte-equal to LIVE prosrc on 11-09): W1-W3 FAIL, S1 PASS.
 *
 *   S1 wording only: each of the 32 bodies equals its previous definition with the string literals blanked (no amount,
 *      condition, column, link, type or refusal changed); grants exactly as live
 *   W1 no literal names the card cost any way but "the card fee"
 *   W2 no literal says "Louisiana Helpr decides", "a real person at Helpr", "goes to Helpr" or "Someone from Louisiana Helpr"
 *   W3 F198: the strike-removed notice is three plain sentences; the last names the block as why the card fee is kept.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261109224952_notices_card_fee_and_our_team.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");
const FNS = ["declutter_accept_refund_with_return","declutter_admin_decide_problem","declutter_admin_decide_stuck_delivery","declutter_answer_refund","declutter_answer_refund_offer","declutter_ask_refund","declutter_complete_handover","declutter_delivery_return_finish","declutter_handover_sweep","declutter_hold_unchecked_listings","declutter_mark_order_paid","declutter_porch_photo","declutter_record_ai_check","declutter_refund_after_handover","declutter_seller_picked_up","declutter_ship_sweep","declutter_withdraw_problem","helpr_task_cant_finish","helpr_task_confirm","helpr_task_customer_confirm","helpr_task_sweep","refund_agreements_due","refund_requests_sweep","respond_job_schedule_change","rpc_open_refund_request","shop_complete_handover","shop_handover_sweep","shop_lock_open_charged_order","shop_preorder_sweep","shops_admin_refund_order","shops_buyer_cancel_order","sweep_needs_you_reminders"];
const AUTH = new Set(["declutter_accept_refund_with_return","declutter_admin_decide_problem","declutter_admin_decide_stuck_delivery","declutter_answer_refund","declutter_answer_refund_offer","declutter_ask_refund","declutter_porch_photo","declutter_seller_picked_up","declutter_withdraw_problem","helpr_task_cant_finish","helpr_task_customer_confirm","respond_job_schedule_change","rpc_open_refund_request","shops_admin_refund_order","shops_buyer_cancel_order"]);

/** The newest CREATE FUNCTION public.<fn> statement in `sql` (any dollar tag), or null. */
function lastDefinition(sql, fn) {
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fn}\\s*\\(`, "gi");
  let out = null;
  for (const m of sql.matchAll(head)) {
    const rest = sql.slice(m.index);
    const tag = rest.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/);
    const close = rest.indexOf(tag[1], tag.index + tag[0].length);
    out = rest.slice(0, close + tag[1].length) + ";";
  }
  return out;
}
/** The previous definition: the newest one in any migration BEFORE this one. */
function previousDefinition(fn) {
  let out = null;
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql") && x < THIS).sort()) {
    const d = lastDefinition(readFileSync(DIR + f, "utf8"), fn);
    if (d) out = d;
  }
  return out;
}
/** A body with every '...' literal blanked and -- comments dropped: what must not change. */
const shape = (src) => src.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''").replace(/\s+/g, " ").trim();

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
-- plpgsql bodies are parsed at CREATE, not planned: the tables they name need not exist for this proof.
SET check_function_bodies = on;
-- The one row type a DECLARE names (the row types the DECLARE blocks name).
CREATE TABLE public.declutter_handovers (id uuid PRIMARY KEY);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY);
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY);
CREATE TABLE public.declutter_problems (id uuid PRIMARY KEY);
CREATE TABLE public.declutter_refund_requests (id uuid PRIMARY KEY);
CREATE TABLE public.shop_refunds (id uuid PRIMARY KEY);
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY);
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY);
CREATE TABLE public.declutter_order_manager_shares (id uuid PRIMARY KEY);
CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY);
`);
const prev = Object.fromEntries(FNS.map((fn) => [fn, previousDefinition(fn)]));
for (const fn of FNS) if (!prev[fn]) throw new Error(`no previous definition of ${fn}`);
if (BEFORE) {
  for (const fn of FNS) await db.exec(prev[fn]);
} else {
  for (let i = 1; i <= (REPLAY ? 3 : 1); i++) await db.exec(MIGRATION);
}
const src = {};
for (const fn of FNS) {
  const r = await db.query(`SELECT prosrc, proacl::text AS acl FROM pg_proc WHERE proname = $1`, [fn]);
  src[fn] = r.rows[0]?.prosrc ?? "";
  const acl = r.rows[0]?.acl ?? "";
  const authOk = AUTH.has(fn);
  if (!BEFORE) check(`grants: ${fn} as live (service_role${authOk ? " + authenticated" : ""}), never PUBLIC/anon`, /service_role=X/.test(acl) && !/anon=|[{,]=/.test(acl) && (authOk ? /authenticated=X/.test(acl) : !/authenticated=/.test(acl)), acl);
}
const prevBody = (fn) => { const d = prev[fn]; const tag = d.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/); const s = tag.index + tag[0].length; return d.slice(s, d.indexOf(tag[1], s)); };
check("S1 wording only: every body equals its previous definition with the string literals blanked",
  FNS.every((fn) => shape(src[fn]) === shape(prevBody(fn))),
  FNS.filter((fn) => shape(src[fn]) !== shape(prevBody(fn))).join(", "));
/** The string literals of a body, its -- comments dropped first (an apostrophe in a comment is not a quote). */
const lit = (fn) => [...src[fn].replace(/--[^\n]*/g, "").matchAll(/'(?:[^']|'')*'/g)].map((m) => m[0]);
const all = FNS.flatMap((fn) => lit(fn).map((t) => `${fn}: ${t}`));
const badFee = all.filter((t) => /card network kept|what your card company charged|card payment cost|card-processing cost|what the card company keeps/.test(t));
check("W1 one name for the card cost: the card fee", badFee.length === 0, badFee.slice(0, 3).join(" | "));
const badWho = all.filter((t) => /Louisiana Helpr decides|real person at Helpr|goes to Helpr|Someone from Louisiana Helpr/.test(t));
check("W2 one name for who decides: our team", badWho.length === 0, badWho.slice(0, 3).join(" | "));
check("W3 F198: one fact a sentence, the block named as why the card fee is kept", src.declutter_mark_order_paid.includes("The item''s hold had already ended, so we''re refunding your payment. You blocked the seller, so the card fee isn''t refunded.") && !src.declutter_mark_order_paid.includes("minus what your card company charged, because you blocked the seller"));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
