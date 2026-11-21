/**
 * Q2352 (owner 2026-10-22, Declutter terms #9): the one-time account setup fee
 * is charged ONCE per account, whichever comes first. Owner 2026-11-20: Declutter
 * no longer charges it at all (declutter_start_checkout freezes 0; the first
 * listing's card fee is gone; src/test/declutterNoIdNoSetupFee.test.ts). What
 * stays here: the one-winner class, and the machinery that settles an order
 * that carried a fee before the change (claim, refund_due, the edge's line).
 *
 * CLASS (never charged twice): every writer anywhere that marks
 * profiles.onboarding_fee_paid true (edge functions and the NEWEST SQL
 * definitions) does it as a one-winner conditional write: TS
 * `.update({ onboarding_fee_paid: true ... }) ... .eq("onboarding_fee_paid", false)`,
 * SQL `SET onboarding_fee_paid = true ... WHERE ... onboarding_fee_paid IS NOT TRUE`.
 * An unconditional writer would let two paths each keep the fee.
 *
 * Declutter (read from the NEWEST definitions):
 *   - declutter_start_checkout freezes setup_fee_cents = 0 on the order
 *     (owner 2026-11-20), outside total_cents (the CHECK never names it);
 *   - declutter_mark_order_paid checks the payment against total + setup fee,
 *     and EVERY 'paid' answer claims the fee first;
 *   - no refund of a sale includes the setup fee (no declutter_record_refund
 *     amount names setup_fee_cents); the fee frozen; a fee sent back counts as
 *     a known refund;
 *   - the edge: declutter-checkout puts it on its own line and checks Stripe's
 *     total against sale + fee; the webhook settles a fee owed back on paid and
 *     replayed answers.
 *
 * Behaviour: src/test/pglite/declutterSetupFeeOnce.pglite.mjs (23/23 applied
 * 3x; RED 20/22 with NEW_MIGRATION=skip; 9 planted mutants each RED) and
 * src/test/edge/declutter-payments.test.ts (the Q2352 cases).
 *
 * @mutate supabase/migrations/20261026154738_declutter_setup_fee_once.sql |    WHERE user_id = o.buyer_id AND onboarding_fee_paid IS NOT TRUE\n |    WHERE user_id = o.buyer_id\n
 * @mutate supabase/functions/release-payout/index.ts |       .eq("user_id", job.helper_id)\n      .eq("onboarding_fee_paid", false)\n |       .eq("user_id", job.helper_id)\n
 * @mutate supabase/migrations/20261109224952_notices_card_fee_and_our_team.sql |   PERFORM public.declutter_claim_setup_fee(p_order_id);\n  RETURN jsonb_build_object('result', 'paid');\nEND; |   RETURN jsonb_build_object('result', 'paid');\nEND;
 * @mutate supabase/migrations/20261026154738_declutter_setup_fee_once.sql |     OR NEW.setup_fee_cents IS DISTINCT FROM OLD.setup_fee_cents THEN |     OR false THEN
 * @mutate supabase/functions/declutter-checkout/index.ts |   const fullChargeCents = order.total_cents + setupFeeCents; |   const fullChargeCents = order.total_cents;
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |   if (answer.result === "paid" \|\| answer.result === "already_paid") { |   if (answer.result === "paid") {
 * @mutate supabase/migrations/20261109224952_notices_card_fee_and_our_team.sql |     UPDATE public.declutter_orders SET setup_fee_state = 'not_charged' WHERE id = p_order_id;\n |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const root = resolve(__dirname, "../..");
const MIG = resolve(root, "supabase/migrations");
const EFFECTIVE = effectiveDefs(MIG);
const ws = (s: string) => s.replace(/\s+/g, " ");
const body = (fn: string) => {
  const stmt = EFFECTIVE.get(fn)?.stmt;
  expect(stmt, `${fn} has a definition`).toBeTruthy();
  return ws(blankSqlComments(stmt ?? ""));
};
const code = (p: string) => ws(blankComments(readFileSync(resolve(root, p), "utf8")));

/** Every .ts under supabase/functions (tracked files). */
function edgeFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(resolve(root, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
    }
  };
  walk("supabase/functions");
  return out;
}

describe("Q2352 the setup fee is charged once per account", () => {
  it("CLASS: every writer that marks the fee paid is a one-winner conditional write", () => {
    const sites: string[] = [];
    const bad: string[] = [];
    for (const f of edgeFiles()) {
      const src = code(f);
      for (const m of src.matchAll(/\.update\(\{[^}]*\bonboarding_fee_paid: true\b[^}]*\}\)([^;]*);/g)) {
        sites.push(f);
        if (!/\.eq\("onboarding_fee_paid", false\)/.test(m[1])) bad.push(`${f}: ${m[0].slice(0, 160)}`);
      }
    }
    for (const [name, def] of EFFECTIVE) {
      const b = ws(blankSqlComments(def.stmt));
      for (const m of b.matchAll(/UPDATE public\.profiles SET ([^;]*?\bonboarding_fee_paid = true\b[^;]*);/gi)) {
        sites.push(`sql:${name}`);
        if (!/\bonboarding_fee_paid IS NOT TRUE\b|\bonboarding_fee_paid = false\b|\bNOT onboarding_fee_paid\b/i.test(m[1])) {
          bad.push(`${name}: ${m[0].slice(0, 160)}`);
        }
      }
    }
    // Floor: the Jobs webhook, release-payout, process-scheduled-payouts and the Declutter claim.
    expect(sites.length).toBeGreaterThan(3);
    expect(sites).toContain("sql:declutter_claim_setup_fee");
    expect(bad).toEqual([]);
  });

  it("checkout freezes the fee on the order, outside the sale's total", () => {
    const start = body("declutter_start_checkout");
    expect(start).toContain("v_setup := 0;");
    expect(start).toContain("AND v_existing.setup_fee_cents = v_setup AND v_existing.items_cents = v_items AND (p_handover <> 'seller_delivery'");
    // Shipping S3 (20261101201500): the total adds the shipping the buyer pays; the setup fee stays its own column.
    expect(start).toMatch(/delivery_cents,\s+total_cents,\s+setup_fee_cents,\s+bundle_discount_cents,\s+shipping_cents,\s+shipping_quote_id\)\s+VALUES \(v_uid, p_seller_id, p_handover, v_items, v_premium, 0, v_delivery, v_items \+ v_premium \+ v_delivery \+ v_shipping,\s+v_setup, v_bundle_off, v_shipping, p_quote_id\)/);
    const due = body("declutter_setup_fee_due_cents");
    expect(due).toContain("WHEN COALESCE((SELECT p.onboarding_fee_paid FROM public.profiles p WHERE p.user_id = p_user), false) THEN 0");
    // The sale's total never names the fee (so every refund computed from it keeps the fee).
    const allSql = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
      .map((f) => ws(blankSqlComments(readFileSync(resolve(MIG, f), "utf8")))).join(" ");
    const totals = [...allSql.matchAll(/ADD CONSTRAINT declutter_orders_total CHECK \(([^;]*?)\);/g)].map((m) => m[1]);
    expect(totals.length).toBeGreaterThan(0);
    expect(totals[totals.length - 1]).not.toContain("setup_fee");
    expect(body("declutter_orders_fee_rule_frozen")).toContain("OR NEW.setup_fee_cents IS DISTINCT FROM OLD.setup_fee_cents THEN");
  });

  it("a payment is the sale plus the fee, and every 'paid' answer claims the fee first", () => {
    const paid = body("declutter_mark_order_paid");
    // The sale + fee, or (a page made before the edge knew the fee) the sale alone, then marked not charged.
    expect(paid).toContain("IF p_amount_cents + o.gift_cents IS DISTINCT FROM o.total_cents + o.setup_fee_cents AND NOT (o.setup_fee_cents > 0 AND o.gift_cents = 0 AND p_amount_cents = o.total_cents) THEN");
    expect(paid).toContain("IF o.setup_fee_cents > 0 AND o.gift_cents = 0 AND p_amount_cents = o.total_cents AND o.setup_fee_state IS NULL THEN UPDATE public.declutter_orders SET setup_fee_state = 'not_charged' WHERE id = p_order_id; END IF;");
    const answers = [...paid.matchAll(/RETURN jsonb_build_object\('result', 'paid'\);/g)];
    // BUY-1 (20261101030040): one 'paid' answer left (a payment on a released hold is refunded, never honoured).
    expect(answers.length).toBeGreaterThan(0);
    for (const a of answers) {
      expect(paid.slice(Math.max(0, a.index! - 70), a.index)).toContain("PERFORM public.declutter_claim_setup_fee(p_order_id);");
    }
    const claim = body("declutter_claim_setup_fee");
    expect(claim).toContain("SET setup_fee_state = CASE WHEN v_won IS TRUE THEN 'claimed' ELSE 'refund_due' END");
  });

  it("no refund of a sale returns the fee; a fee sent back is a known refund", () => {
    const amounts: string[] = [];
    for (const [name, def] of EFFECTIVE) {
      const b = ws(blankSqlComments(def.stmt));
      for (const m of b.matchAll(/declutter_record_refund\(([^;]*?)\)/g)) amounts.push(`${name}: ${m[1]}`);
    }
    expect(amounts.length).toBeGreaterThan(5);
    expect(amounts.filter((a) => /setup_fee/.test(a))).toEqual([]);
    expect(body("declutter_order_refunds_recorded_cents")).toContain("+ CASE WHEN o.setup_fee_state = 'refunded' THEN o.setup_fee_cents ELSE 0 END");
  });

  it("the first listing never charges it (owner 2026-11-20; it was a card fee from 2026-10-23, #3557)", () => {
    expect(EFFECTIVE.has("declutter_setup_fee_before_list")).toBe(false);
    const sql = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
      .map((f) => ws(blankSqlComments(readFileSync(resolve(MIG, f), "utf8")))).join(" ");
    expect(sql.lastIndexOf("DROP TRIGGER IF EXISTS trg_declutter_items_setup_fee_before_list ON public.declutter_items;"))
      .toBeGreaterThan(sql.lastIndexOf("CREATE TRIGGER trg_declutter_items_setup_fee_before_list"));
  });

  it("the edge charges the fee on its own line and settles a fee owed back", () => {
    const checkout = code("supabase/functions/declutter-checkout/index.ts");
    expect(checkout).toContain('product_data: { name: "One-time account setup fee", tax_code: NONTAXABLE_TAX_CODE }');
    expect(checkout).toContain("const fullChargeCents = order.total_cents + setupFeeCents;");
    expect(checkout).toContain("if (session.amount_total !== chargeCents) {");
    const hook = code("supabase/functions/stripe-webhook/handlers/declutterCheckout.ts");
    expect(hook).toContain('if (answer.result === "paid" || answer.result === "already_paid") { await settleSetupFee(ctx, paymentIntentId, orderId); await saveOrderCard(event, session.id, paymentIntentId, meta.buyer_id, ctx); return; }');
    expect(hook).toContain('if (!row || row.setup_fee_state !== "refund_due") return;');
  });
});
