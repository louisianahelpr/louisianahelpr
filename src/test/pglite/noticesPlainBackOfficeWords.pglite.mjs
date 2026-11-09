#!/usr/bin/env node
/**
 * PGlite proof for 20261109211412_notices_plain_back_office_words (Part 3: F196 + F199, wording only).
 *
 *   npx tsx src/test/pglite/noticesPlainBackOfficeWords.pglite.mjs [--replay] [--before]
 *
 * --before installs each function's previous definition (the newest one before this migration, byte-equal to LIVE
 * prosrc on 11-09) instead: W1-W5 FAIL, S1 still PASS.
 *
 *   S1 wording only: in every one of the five functions, the body with its string literals blanked is identical to
 *      the previous definition's (no logic, threshold, column, link or type changed), and grants stay service_role only
 *   W1 "You're all set" says "payout setup and ID check are done", never "Stripe ID"
 *   W2 the direct-offer lapse says "ID check", never "Stripe ID"
 *   W3 both regular-offer lapses say "ID check", never "Stripe ID"
 *   W4 "Message hidden" says "a phone number, email or outside payment", never "off-platform"
 *   W5 the seller-fault notice is titled "Setup job cancelled" and says "except the one-time account setup fee"
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261109211412_notices_plain_back_office_words.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");
const FNS = ["complete_pending_accepts_on_setup", "expire_pending_direct_offers", "expire_unanswered_offers", "apply_message_scan_consequence", "declutter_apply_seller_fault"];

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
-- The one row type a DECLARE names (declutter_apply_seller_fault: rf public.declutter_refunds).
CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY, order_id uuid, fee_policy text, reason text, is_seed boolean);
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
  if (!BEFORE) check(`grants: ${fn} executable by service_role, never PUBLIC/anon/authenticated`, /service_role=X/.test(acl) && !/anon=|authenticated=|[{,]=/.test(acl), acl);
}
const prevBody = (fn) => { const d = prev[fn]; const tag = d.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/); const s = tag.index + tag[0].length; return d.slice(s, d.indexOf(tag[1], s)); };
check("S1 wording only: every body equals its previous definition with the string literals blanked",
  FNS.every((fn) => shape(src[fn]) === shape(prevBody(fn))),
  FNS.filter((fn) => shape(src[fn]) !== shape(prevBody(fn))).join(", "));
check("W1 You're all set says ID check", src.complete_pending_accepts_on_setup.includes("payout setup and ID check are done") && !src.complete_pending_accepts_on_setup.includes("Stripe ID are done"));
check("W2 direct-offer lapse says ID check", src.expire_pending_direct_offers.includes("payout setup and ID check were done") && !/'[^']*Stripe ID[^']*'/.test(src.expire_pending_direct_offers));
check("W3 regular-offer lapses say ID check", (src.expire_unanswered_offers.match(/payout setup and ID check were done/g) ?? []).length === 2 && !/'[^']*Stripe ID[^']*'/.test(src.expire_unanswered_offers));
check("W4 Message hidden names what it looked like", src.apply_message_scan_consequence.includes("a phone number, email or outside payment. Keep contact and payments in the app.") && !/'[^']*off-platform contact or payment info[^']*'/.test(src.apply_message_scan_consequence));
check("W5 seller-fault notice: title and setup-fee words", src.declutter_apply_seller_fault.includes("'Setup job cancelled',") && src.declutter_apply_seller_fault.includes("except the one-time account setup fee.") && !src.declutter_apply_seller_fault.includes("no fee',") && !src.declutter_apply_seller_fault.includes("excepted"));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
