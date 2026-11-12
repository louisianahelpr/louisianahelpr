/**
 * Shops H4 part 2 (audit ~/.lh-shots/audit-1105-shops.md H4, NOT-LAUNCHED Q1954; owner 10-30 "once per account"):
 * the one-time $2 account setup fee in Shops, reusing Declutter's seller and buyer rules
 * (migration 20261105181603_shops_setup_fee.sql).
 *
 * Read from the NEWEST definitions and the edge code:
 *   - the shop owner's fee comes out of a payout only through shop_payout_take_setup_fee, which skips a row a send
 *     was tried for, and declutter-money calls it before the send, only when no send can have started;
 *   - the buyer's fee is frozen at insert by a trigger, claimed with the one-winner UPDATE when the hold lands, kept
 *     out of total_cents, and put back when a hold ends uncaptured;
 *   - shop-checkout puts it on its own line and checks Stripe's subtotal against it.
 *
 * Behaviour: src/test/pglite/shopsSetupFee.pglite.mjs (33/33 applied 3x; --before 30 FAIL).
 *
 * @mutate supabase/migrations/20261112075702_shops_cottage_limit_strict.sql | so the fee is never charged twice.\n  IF v_fee_charged THEN\n    UPDATE public.profiles\n       SET onboarding_fee_paid = true, onboarding_fee_charged_at = now()\n     WHERE user_id = o.buyer_id AND onboarding_fee_paid IS NOT TRUE | so the fee is never charged twice.\n  IF v_fee_charged THEN\n    UPDATE public.profiles\n       SET onboarding_fee_paid = true, onboarding_fee_charged_at = now()\n     WHERE user_id = o.buyer_id
 * @mutate supabase/migrations/20261105181603_shops_setup_fee.sql |   IF p.status NOT IN ('pending', 'failed') OR p.setup_fee_cents > 0 OR p.attempts > 0 OR p.send_tried | IF p.status NOT IN ('pending', 'failed') OR p.setup_fee_cents > 0
 * @mutate supabase/migrations/20261105181603_shops_setup_fee.sql | CREATE TRIGGER trg_shop_orders_setup_fee_put_back BEFORE UPDATE OF hold_released_at ON public.shop_orders | CREATE TRIGGER trg_shop_orders_setup_fee_put_back BEFORE UPDATE OF closed_at ON public.shop_orders
 * @mutate supabase/migrations/20261112075702_shops_cottage_limit_strict.sql |          total_cents = p_amount_total + o.gift_cents - CASE WHEN v_fee_charged THEN o.setup_fee_cents ELSE 0 END,\n         setup_fee_state = CASE WHEN v_fee_charged THEN 'claimed' WHEN o.setup_fee_cents > 0 THEN 'not_charged' ELSE NULL END,\n         held_at = now(), accept_by = now() + interval |          total_cents = p_amount_total + o.gift_cents,\n         setup_fee_state = CASE WHEN v_fee_charged THEN 'claimed' WHEN o.setup_fee_cents > 0 THEN 'not_charged' ELSE NULL END,\n         held_at = now(), accept_by = now() + interval
 * @mutate supabase/functions/declutter-money/index.ts |               p.amount_cents = shopToSend; |               void shopToSend;
 * @mutate supabase/functions/shop-checkout/index.ts |   const chargedCents = o.items_cents + o.premium_cents + deliveryCents + setupFeeCents + tax.cents; |   const chargedCents = o.items_cents + o.premium_cents + deliveryCents + tax.cents;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
const migration = ws(blankSqlComments(readFileSync(resolve(MIG, "20261105181603_shops_setup_fee.sql"), "utf8")));

describe("Shops H4: the one-time setup fee", () => {
  it("the shop owner's fee: one winner, never after a send, before the transfer", () => {
    const take = body("shop_payout_take_setup_fee");
    expect(take).toContain("p.attempts > 0 OR p.send_tried");
    expect(take).toContain("payout_kind = 'shop'");
    expect(take).toMatch(/SET onboarding_fee_paid = true, onboarding_fee_charged_at = now\(\) WHERE user_id = v_seller AND onboarding_fee_paid IS NOT TRUE/);
    expect(take).toContain("public.declutter_setup_fee_from_payout_cents(v_seller)");
    expect(take).toContain("debt_cents = debt_cents + v_fee");
    expect(migration).toMatch(/CREATE TRIGGER trg_shop_payouts_send_tried BEFORE INSERT OR UPDATE ON public\.shop_payouts/);

    const money = code("supabase/functions/declutter-money/index.ts");
    const at = money.indexOf('admin.rpc("shop_payout_take_setup_fee"');
    expect(at, "declutter-money calls shop_payout_take_setup_fee").toBeGreaterThan(0);
    const send = money.indexOf('markSending("shop"', at);
    const transfer = money.indexOf("idempotencyKey: `shop-payout-", at);
    expect(send).toBeGreaterThan(at);
    expect(transfer).toBeGreaterThan(send);
    // Only when no send can have started.
    expect(money.slice(Math.max(0, at - 200), at)).toContain("if (!maybeSent_shop(p))");
  });

  it("the buyer's fee: frozen at insert, claimed once when the hold lands, outside total_cents", () => {
    expect(migration).toMatch(/CREATE TRIGGER trg_shop_orders_setup_fee_frozen BEFORE INSERT OR UPDATE OF setup_fee_cents ON public\.shop_orders/);
    const frozen = body("shop_orders_setup_fee_frozen");
    expect(frozen).toContain("NEW.setup_fee_cents := public.declutter_setup_fee_due_cents(NEW.buyer_id)");
    expect(frozen).toContain("order_amounts_frozen");

    const held = body("shop_mark_order_held");
    expect(held).toMatch(/SET onboarding_fee_paid = true, onboarding_fee_charged_at = now\(\) WHERE user_id = o\.buyer_id AND onboarding_fee_paid IS NOT TRUE/);
    expect(held).toContain("total_cents = p_amount_total + o.gift_cents - CASE WHEN v_fee_charged THEN o.setup_fee_cents ELSE 0 END");
    expect(held).toContain("'setup_fee_paid_elsewhere'");
    // The claim only on the branch that holds (after the amount and the day checks).
    expect(held.indexOf("onboarding_fee_paid = true")).toBeGreaterThan(held.indexOf("'day_full'"));
  });

  it("a hold that ends uncaptured puts the buyer's fee back", () => {
    expect(migration).toMatch(/CREATE TRIGGER trg_shop_orders_setup_fee_put_back BEFORE UPDATE OF hold_released_at ON public\.shop_orders/);
    const back = body("shop_orders_setup_fee_put_back");
    expect(back).toContain("NEW.setup_fee_state = 'claimed' AND NEW.captured_at IS NULL");
    expect(back).toContain("SET onboarding_fee_paid = false");
    // Every writer of hold_released_at is a service-only function (prevent_self_escalation would undo a member's).
    for (const fn of ["shop_hold_released", "shop_order_capture_failed"]) {
      expect(body(fn)).toContain("hold_released_at");
    }
  });

  it("the Checkout page carries the fee on its own line and checks it", () => {
    const sc = code("supabase/functions/shop-checkout/index.ts");
    expect(sc).toContain('taxed("One-time account setup fee", NONTAXABLE_TAX_CODE)');
    // Delivery (20261106180902) adds the shop's own delivery fee to the page.
    expect(sc).toContain("const chargedCents = o.items_cents + o.premium_cents + deliveryCents + setupFeeCents + tax.cents;");
    expect(sc).toContain("session.amount_subtotal !== chargedCents");
  });
});
