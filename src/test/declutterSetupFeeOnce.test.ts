/**
 * Q2352 (owner 2026-10-22, Declutter terms #9): the one-time account setup fee
 * is charged ONCE per account, whichever comes first, and a member's first
 * Declutter purchase is one of the places it is charged.
 *
 * CLASS (never charged twice): every writer anywhere that marks
 * profiles.onboarding_fee_paid true (edge functions and the NEWEST SQL
 * definitions) does it as a one-winner conditional write: TS
 * `.update({ onboarding_fee_paid: true ... }) ... .eq("onboarding_fee_paid", false)`,
 * SQL `SET onboarding_fee_paid = true ... WHERE ... onboarding_fee_paid IS NOT TRUE`.
 * An unconditional writer would let two paths each keep the fee.
 *
 * Declutter (read from the NEWEST definitions):
 *   - declutter_start_checkout freezes declutter_setup_fee_due_cents on the
 *     order, outside total_cents (the CHECK on total_cents never names it);
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
 * @mutate supabase/migrations/20261101191500_declutter_checkout_pickup_time.sql |   PERFORM public.declutter_claim_setup_fee(p_order_id);\n  RETURN jsonb_build_object('result', 'paid');\nEND; |   RETURN jsonb_build_object('result', 'paid');\nEND;
 * @mutate supabase/migrations/20261101191500_declutter_checkout_pickup_time.sql |   v_setup := public.declutter_setup_fee_due_cents(v_uid); |   v_setup := 0;
 * @mutate supabase/migrations/20261026154738_declutter_setup_fee_once.sql |     OR NEW.setup_fee_cents IS DISTINCT FROM OLD.setup_fee_cents THEN |     OR false THEN
 * @mutate supabase/functions/declutter-checkout/index.ts |   const chargeCents = order.total_cents + setupFeeCents; |   const chargeCents = order.total_cents;
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |   if (answer.result === "paid" \|\| answer.result === "already_paid") { |   if (answer.result === "paid") {
 * @mutate supabase/migrations/20261101191500_declutter_checkout_pickup_time.sql |     UPDATE public.declutter_orders SET setup_fee_state = 'not_charged' WHERE id = p_order_id;\n |
 * @mutate supabase/migrations/20261031214749_seller_setup_fee_from_payout_restated.sql |     IF public.declutter_setup_fee_due_cents(auth.uid()) > 0 THEN |     IF false THEN
 * @mutate supabase/migrations/20261031214749_seller_setup_fee_from_payout_restated.sql |     IF public.has_role(auth.uid(), 'admin') OR COALESCE(( |     IF public.has_role(auth.uid(), 'admin') OR public.identity_check_exempt(auth.uid()) OR COALESCE((
 * @mutate src/lib/declutter/api.ts |   else if (setupFeeRefusal(err)) promptAccountSetupFee(); |
 * @mutate src/lib/declutter/setupFee.ts | "declutter_free_claim" = "declutter_selling") | "declutter_free_claim" = "declutter_free_claim")
 * @mutate src/components/declutter/BunchFeeGate.tsx | const outcome = await payAccountSetupFee(); | const outcome = await payAccountSetupFee("declutter_free_claim");
 * @mutate src/lib/declutter/setupFee.ts |   return typeof raw === "string" && /(^\|[^a-z_])setup_fee_required_to_list($\|[^a-z_])/.test(raw); |   return false;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { setupFeeRefusal } from "@/lib/declutter/setupFee";

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
    expect(start).toContain("v_setup := public.declutter_setup_fee_due_cents(v_uid);");
    expect(start).toContain("AND v_existing.setup_fee_cents = v_setup AND v_existing.items_cents = v_items AND (p_handover <> 'seller_delivery'");
    expect(start).toMatch(/delivery_cents, total_cents, setup_fee_cents, bundle_discount_cents\) VALUES \(v_uid, p_seller_id, p_handover, v_items, v_premium, 0, v_delivery, v_items \+ v_premium \+ v_delivery, v_setup, v_bundle_off\)/);
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
    expect(paid).toContain("IF p_amount_cents IS DISTINCT FROM o.total_cents + o.setup_fee_cents AND NOT (o.setup_fee_cents > 0 AND p_amount_cents = o.total_cents) THEN");
    expect(paid).toContain("IF o.setup_fee_cents > 0 AND p_amount_cents = o.total_cents AND o.setup_fee_state IS NULL THEN UPDATE public.declutter_orders SET setup_fee_state = 'not_charged' WHERE id = p_order_id; END IF;");
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

  it("the first listing (owner 2026-10-23, #3557): by card at the first listing, never if already paid", () => {
    const gate = body("declutter_setup_fee_before_list");
    expect(gate).toContain("IF NEW.status IN ('pending_review', 'live') AND (TG_OP = 'INSERT' OR OLD.status IN ('draft', 'paused')) THEN");
    expect(gate).toContain("IF public.declutter_setup_fee_due_cents(auth.uid()) > 0 THEN RAISE EXCEPTION 'setup_fee_required_to_list'");
    // identity_check_exempt() is true for every member while identity_check is off (20261023213857), so the gate spells
    // out its own admin / enrolled-tester carve-out. Off, the card stays. On, the fee comes out of the payout instead
    // (owner 2026-10-30, Builder 49's 20261031002445 rebuilt as 20261031214749): a NOT exempt member is let through,
    // and only that way round.
    expect(gate).toContain("IF NOT public.identity_check_exempt(auth.uid()) THEN RETURN NEW;");
    expect(gate.indexOf("identity_check_exempt")).toBeLessThan(gate.indexOf("setup_fee_required_to_list"));
    expect(gate.indexOf("SELECT p.is_seed IS TRUE")).toBeLessThan(gate.indexOf("identity_check_exempt"));
    expect(gate).toContain("SELECT p.is_seed IS TRUE AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id) FROM public.profiles p WHERE p.user_id = auth.uid()");
    // The newest trigger on declutter_items runs it, after the ID check (trigger names fire in name order).
    const sql = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
      .map((f) => ws(blankSqlComments(readFileSync(resolve(MIG, f), "utf8")))).join(" ");
    expect(sql).toContain("CREATE TRIGGER trg_declutter_items_setup_fee_before_list BEFORE INSERT OR UPDATE OF status ON public.declutter_items FOR EACH ROW EXECUTE FUNCTION public.declutter_setup_fee_before_list();");
    expect("trg_declutter_items_identity_before_list" < "trg_declutter_items_setup_fee_before_list").toBe(true);
    // The app reads the refusal and offers the one-time fee page (pay-onboarding-fee), back to the member's listings.
    expect(setupFeeRefusal(new Error("setup_fee_required_to_list"))).toBe(true);
    expect(setupFeeRefusal(new Error("identity_required_to_list"))).toBe(false);
    expect(code("src/lib/declutter/api.ts")).toContain("else if (setupFeeRefusal(err)) promptAccountSetupFee();");
    // The return is now a parameter (a first free claim lands on Buying, owner 2026-10-30); the first listing's two callers
    // pass nothing, so they still come back to their listings, and the edge still reads that value.
    const fee = code("src/lib/declutter/setupFee.ts");
    expect(fee).toContain('payAccountSetupFee(returnTo: "declutter_selling" | "declutter_free_claim" = "declutter_selling")');
    expect(fee).toContain('supabase.functions.invoke("pay-onboarding-fee", { body: { native: isNativePlatform, return_to: returnTo }, });');
    expect(fee).toContain("onClick: () => void payAccountSetupFee() }");
    expect(code("src/components/declutter/BunchFeeGate.tsx")).toContain("const outcome = await payAccountSetupFee();");
    expect(code("supabase/functions/pay-onboarding-fee/index.ts")).toContain('const toDeclutter = (rawBody as { return_to?: unknown })?.return_to === "declutter_selling";');
  });

  it("the edge charges the fee on its own line and settles a fee owed back", () => {
    const checkout = code("supabase/functions/declutter-checkout/index.ts");
    expect(checkout).toContain('product_data: { name: "One-time account setup fee", tax_code: NONTAXABLE_TAX_CODE }');
    expect(checkout).toContain("const chargeCents = order.total_cents + setupFeeCents;");
    expect(checkout).toContain("if (session.amount_total !== chargeCents) {");
    const hook = code("supabase/functions/stripe-webhook/handlers/declutterCheckout.ts");
    expect(hook).toContain('if (answer.result === "paid" || answer.result === "already_paid") { await settleSetupFee(ctx, paymentIntentId, orderId); return; }');
    expect(hook).toContain('if (!row || row.setup_fee_state !== "refund_due") return;');
  });
});
