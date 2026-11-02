#!/usr/bin/env node
/**
 * PGlite proof for 20261102040952_declutter_card_fee_prorated (Q1935): a refund of what is left of a delivery order
 * (total - reserved) passes the card fee prorated to that part, so the seller's debt (seller fault) or the fee kept from
 * the buyer (keep_card_fee) no longer carries card cost on a delivery fee already given back or paid to the Helpr.
 *
 *   node src/test/pglite/declutterCardFeeProrated.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterCardFeeProrated.pglite.mjs # RED: no proration exists
 *   MUTANT=<name> node src/test/pglite/declutterCardFeeProrated.pglite.mjs      # a planted defect: must FAIL
 *
 * Real: declutter_record_refund (its newest CREATE before this file) and declutter_card_fee_estimate; the migration's
 * own restated callers are applied (3x) and their one changed line is checked by the source guard
 * (refundsKeepTheCardFee.test.ts pins them). Stubbed, said so: declutter_orders, declutter_refunds,
 * declutter_seller_fee_debts, helpr_tasks reduced to the columns read; declutter_notify, declutter_order_items_named and
 * declutter_delivery_reserved_cents record or answer fixed values. Supabase's default anon/authenticated EXECUTE grant
 * on new functions is emulated.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261102040952_declutter_card_fee_prorated.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The whole fee again.
  noProration: ["    ELSE round(p_card_fee_cents::numeric * (p_total_cents - p_reserved_cents) / p_total_cents)::integer\n", "    ELSE p_card_fee_cents\n"],
  // Prorated to the reserved part instead of what is refunded.
  wrongPart: ["(p_total_cents - p_reserved_cents) / p_total_cents)::integer", "p_reserved_cents / p_total_cents)::integer"],
  // A missing fee becomes 0 (record_refund would then not estimate it).
  nullToZero: ["    WHEN p_card_fee_cents IS NULL THEN NULL\n", "    WHEN p_card_fee_cents IS NULL THEN 0\n"],
  // close_paid_order keeps passing the whole fee.
  callerWhole: ["p_reason, o.total_cents - v_reserved,\n    public.declutter_card_fee_left(o.card_fee_cents, o.total_cents, v_reserved));", "p_reason, o.total_cents - v_reserved,\n    o.card_fee_cents);"],
  // Left open to members.
  openGrant: ["REVOKE ALL ON FUNCTION public.declutter_card_fee_left(integer, integer, integer) FROM PUBLIC, anon, authenticated;", ""],
};
const skip = process.env.NEW_MIGRATION === "skip";

function definitionBefore(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = rest.slice(0, end + tag[1].length) + ";";
    }
  }
  if (!last) throw new Error(`no definition of ${name} before ${before}`);
  return last;
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `eeeeeeee-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, seller_id uuid, items_cents int, premium_cents int, tax_cents int, delivery_cents int);
CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, stripe_payment_intent_id text UNIQUE,
  reason text, fee_policy text, paid_cents int, card_fee_cents int, kept_cents int, refund_cents int);
CREATE TABLE public.declutter_seller_fee_debts (seller_id uuid, refund_id uuid UNIQUE, amount_cents int, remaining_cents int);
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, helpr_id uuid, source_kind text, source_id uuid);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
CREATE FUNCTION public.declutter_order_items_named(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'the lamp' $$;
CREATE FUNCTION public.declutter_delivery_reserved_cents(p uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
`);
await db.exec(definitionBefore("declutter_card_fee_estimate", THIS));
await db.exec(definitionBefore("declutter_record_refund", THIS));

if (!skip) {
  let mig = readFileSync(MIG_DIR + THIS, "utf8");
  if (MUTANT) {
    const m = MUTANTS[MUTANT];
    if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
    mig = mig.replace(m[0], m[1]);
  }
  for (let k = 1; k <= 3; k++) {
    try { await db.exec(mig); check(true, `the migration applies (run ${k})`); } catch (e) { check(false, `the migration applies (run ${k}): ${e.message}`); }
  }
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
const tryQ = async (s, p = []) => { try { return await q(s, p); } catch (e) { return { error: e.message }; } };
const left = async (fee, total, reserved) => {
  const r = await tryQ(`SELECT public.declutter_card_fee_left($1, $2, $3) AS v`, [fee, total, reserved]);
  return r.error ? r.error : r[0].v;
};

// A $60.00 order whose $15.00 delivery fee is reserved; Stripe kept $2.04 on the whole $60.00.
check(await left(204, 6000, 1500) === 153, `[fix] $2.04 on $60.00 with $15.00 reserved -> $1.53 (${await left(204, 6000, 1500)})`);
check(await left(204, 6000, 0) === 204, `nothing reserved -> the whole fee (${await left(204, 6000, 0)})`);
check(await left(null, 6000, 1500) === null, `[fix] an unknown fee stays unknown, so record_refund estimates it (${await left(null, 6000, 1500)})`);
check(await left(204, 6000, 6000) === 0, `everything reserved -> no fee (${await left(204, 6000, 6000)})`);

// Through the real declutter_record_refund: a seller-fault refund of the $45.00 left books $1.53 of debt, not $2.04.
await q(`INSERT INTO public.declutter_orders VALUES ($1, $2, 4000, 300, 200, 1500)`, [U(10), SELLER]);
const fee = skip ? 204 : await left(204, 6000, 1500);
const r = await tryQ(`SELECT public.declutter_record_refund($1, 'pi_q1935', 'seller_backed_out', 4500, $2) AS id`, [U(10), fee]);
const debt = (await q(`SELECT amount_cents FROM public.declutter_seller_fee_debts WHERE seller_id = $1`, [SELLER]))[0]?.amount_cents;
check(!r.error && debt === 153, `[fix] the seller owes the card cost on the $45.00 refunded only: ${debt} cents (${r.error ?? "ok"})`);
// keep_card_fee: the buyer gets back $45.00 less the prorated fee.
await q(`INSERT INTO public.declutter_orders VALUES ($1, $2, 4000, 300, 200, 1500)`, [U(11), SELLER]);
await tryQ(`SELECT public.declutter_record_refund($1, 'pi_q1935b', 'buyer_cancelled', 4500, $2)`, [U(11), fee]);
const kept = (await q(`SELECT refund_cents FROM public.declutter_refunds WHERE stripe_payment_intent_id = 'pi_q1935b'`))[0]?.refund_cents;
check(kept === 4500 - 153, `[fix] a buyer-side refund keeps only the prorated fee: refund ${kept} cents`);

// Both restated callers pass the prorated fee (the applied text, after any planted defect).
if (!skip) {
  const defs = (await q(`SELECT proname, prosrc FROM pg_proc WHERE proname IN ('declutter_close_paid_order', 'declutter_refund_after_handover')`));
  for (const d of defs) {
    check(/declutter_card_fee_left\(o\.card_fee_cents, o\.total_cents, v_reserved\)/.test(d.prosrc) && !/v_reserved, o\.card_fee_cents\)|v_paid, o\.card_fee_cents\)/.test(d.prosrc),
      `[fix] ${d.proname} passes the prorated fee`);
  }
  check(defs.length === 2, `both callers are restated (${defs.length})`);
  const acl = (await q(`SELECT has_function_privilege('anon', 'public.declutter_card_fee_left(integer, integer, integer)', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.declutter_card_fee_left(integer, integer, integer)', 'EXECUTE') u`))[0];
  check(!acl.a && !acl.u, `grants: anon ${acl.a} authenticated ${acl.u}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
