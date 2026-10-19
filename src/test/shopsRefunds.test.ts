/**
 * Shops M3 (20261019043209_shops_refunds_cancels_strikes): the static half of the
 * refund/cancel guards. Reads the NEWEST definition of each function (any dollar
 * tag, src/test/helpers/effectiveFunctionDefs.ts), comments blanked.
 *
 *   1. The buyer's cancel of an accepted order locks the order row FOR UPDATE,
 *      THEN reads shop_order_free_cancel_until exactly once, THEN writes the
 *      order's status (lh-money-escrow of a90c008a0 / a1890a0fa #3).
 *   2. Every member/admin refund path takes the row lock before it writes, and no
 *      SQL path calls the network (Stripe runs only after commit, in the edge).
 *   3. shop_refunds holds reason -> fee policy -> amount as table CHECKs (never
 *      absorb a fee except our mistake; J3 tax on a kept amount kept).
 *   4. shop-checkout runs the member RPC BEFORE it sends a refund, in each action.
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/shopsRefunds.pglite.mjs.
 * Stripe call order and keys, executed: src/test/edge/shop-refunds.test.ts.
 *
 * @mutate supabase/migrations/20261019043209_shops_refunds_cancels_strikes.sql |   SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;\n  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid THEN\n    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  o := public.shop_lock_open_charged_order(o.id, false);\n  -- 2. |
 * @mutate supabase/migrations/20261019043209_shops_refunds_cancels_strikes.sql |     WHEN reason IN ('buyer_cancelled', 'problem_no_fault') THEN 'keep_card_fee'\n    ELSE 'full_platform_absorbs' END), |     ELSE 'full_platform_absorbs' END),
 * @mutate supabase/migrations/20261019043209_shops_refunds_cancels_strikes.sql |     ELSE ceil(kept_cents::numeric * tax_cents / (paid_cents - tax_cents))::integer END), |     ELSE 0 END),
 * @mutate supabase/functions/shop-checkout/index.ts |   const { data, error } = await asShop.rpc("shops_shop_cancel_order", { p_order_id: orderId, p_reason: reason });\n  if (error) return rpcRefusal(error);\n  const d = data as DecidedRow;\n  const refund = await sendRefundNow(admin, orderId, d?.refund_id); |   const refund = await sendRefundNow(admin, orderId, null);\n  const { data, error } = await asShop.rpc("shops_shop_cancel_order", { p_order_id: orderId, p_reason: reason });\n  if (error) return rpcRefusal(error);\n  const d = data as DecidedRow;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, "20261019043209_shops_refunds_cancels_strikes.sql"), "utf8"));
const DEFS = effectiveDefs(MIG_DIR);
/** The body after AS $tag$ (the header names the function itself). */
const body = (name: string) => {
  const stmt = blankSqlComments(DEFS.get(name)?.stmt ?? "");
  const m = /\bAS\s+\$\w*\$/i.exec(stmt);
  return m ? stmt.slice(m.index) : "";
};
const EDGE = blankComments(readFileSync(join(ROOT, "supabase/functions/shop-checkout/index.ts"), "utf8"));

const REFUND_PATHS = ["shops_buyer_cancel_order", "shops_shop_cancel_order", "shops_report_no_show", "shop_refund_sweep",
  "shops_admin_refund_order", "shops_admin_pay_shop"];

describe("Shops M3: refunds and cancels decide under the row lock, Stripe after commit", () => {
  it("reads a real inventory (floors)", () => {
    for (const fn of [...REFUND_PATHS, "shop_write_refund", "shop_lock_open_charged_order", "shop_order_free_cancel_until"]) {
      expect(DEFS.has(fn), fn).toBe(true);
    }
    expect(REFUND_PATHS.length).toBeGreaterThan(5);
    expect(body("shops_buyer_cancel_order").length).toBeGreaterThan(500);
  });

  it("the buyer's cancel: FOR UPDATE, then ONE free-cancel reading, then the status write", () => {
    const b = body("shops_buyer_cancel_order");
    const lock = b.search(/FROM\s+public\.shop_orders\s+WHERE\s+id\s*=\s*p_order_id\s+FOR\s+UPDATE/i);
    const read = b.indexOf("shop_order_free_cancel_until(");
    const write = b.search(/UPDATE\s+public\.shop_orders\s+SET\s+status/i);
    expect(lock).toBeGreaterThan(0);
    expect(read).toBeGreaterThan(lock);
    expect(write).toBeGreaterThan(read);
    expect(b.split("shop_order_free_cancel_until(").length - 1).toBe(1);
  });

  it("every refund path locks the order before writing and never calls the network", () => {
    for (const fn of REFUND_PATHS) {
      const b = body(fn);
      const lock = Math.max(b.search(/FOR\s+UPDATE/i), b.indexOf("shop_lock_open_charged_order("));
      const firstLock = [b.search(/FOR\s+UPDATE/i), b.indexOf("shop_lock_open_charged_order(")].filter((i) => i >= 0);
      const write = b.search(/UPDATE\s+public\.shop_orders\s+SET\s+status|shop_write_refund\(|shop_complete_handover\(/i);
      expect(lock, fn).toBeGreaterThanOrEqual(0);
      expect(write, fn).toBeGreaterThan(Math.min(...firstLock));
      expect(/net\.http|http_post|pg_net/i.test(b), fn).toBe(false);
    }
  });

  it("shop_refunds holds reason -> fee policy -> amount as CHECKs", () => {
    const table = MIG.slice(MIG.indexOf("CREATE TABLE IF NOT EXISTS public.shop_refunds"), MIG.indexOf("ALTER TABLE public.shop_refunds ENABLE"));
    expect(table).toMatch(/WHEN reason IN \('shop_cancelled', 'no_ready_photo', 'shop_removed', 'problem_shop_fault'\) THEN 'full_shop_pays_fee'/);
    expect(table).toMatch(/WHEN reason IN \('buyer_cancelled', 'problem_no_fault'\) THEN 'keep_card_fee'/);
    // Only our mistake is left for the platform to carry.
    expect(table).toMatch(/'problem_our_mistake'\)\),/);
    expect(table).toMatch(/kept_cents = CASE WHEN fee_policy = 'keep_card_fee' THEN card_fee_cents ELSE 0 END/);
    expect(table).toMatch(/ceil\(kept_cents::numeric \* tax_cents \/ \(paid_cents - tax_cents\)\)::integer/);
    expect(table).toMatch(/refund_cents = paid_cents - kept_cents - tax_kept_cents AND refund_cents > 0/);
    expect(MIG).toMatch(/order_id uuid NOT NULL UNIQUE REFERENCES public\.shop_orders/);
  });

  it("shop-checkout runs each member RPC before it sends a refund", () => {
    for (const [fn, rpc] of [["buyerCancel", "shops_buyer_cancel_order"], ["shopCancel", "shops_shop_cancel_order"], ["adminRefund", "shops_admin_refund_order"]]) {
      const start = EDGE.indexOf(`async function ${fn}(`);
      expect(start, fn).toBeGreaterThan(0);
      const end = EDGE.indexOf("\nasync function ", start + 10);
      const src = EDGE.slice(start, end > 0 ? end : undefined);
      const call = src.indexOf(`.rpc("${rpc}"`);
      const refusal = src.indexOf("if (error) return rpcRefusal(error);");
      const send = src.indexOf("sendRefundNow(");
      expect(call, fn).toBeGreaterThan(0);
      expect(refusal, fn).toBeGreaterThan(call);
      expect(send, fn).toBeGreaterThan(refusal);
    }
  });
});
