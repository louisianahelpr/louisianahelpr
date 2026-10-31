/**
 * Shops M3 (20261019071055_shops_refunds_cancels_strikes): the static half of the
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
 * @mutate supabase/migrations/20261031200034_declutter_payout_tries_restart.sql | attempts = 0, reversals = least(reversals + 1, 100), | attempts = 0,
 * @mutate supabase/migrations/20261019071055_shops_refunds_cancels_strikes.sql |     UPDATE public.payout_settlements SET voided_at = now(), voided_reason = v_why | PERFORM 1; UPDATE public.payout_settlements SET voided_reason = voided_reason
 * @mutate supabase/migrations/20261019071055_shops_refunds_cancels_strikes.sql |   SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;\n  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid THEN\n    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  o := public.shop_lock_open_charged_order(o.id, false);\n  -- 2. |
 * @mutate supabase/migrations/20261019071055_shops_refunds_cancels_strikes.sql |     WHEN p_reason IN ('buyer_cancelled', 'problem_no_fault') THEN 'keep_card_fee'\n | \n
 * @mutate supabase/migrations/20261019071055_shops_refunds_cancels_strikes.sql |              ELSE ceil(p_kept::numeric * p_tax / (p_paid - p_tax))::integer END; |              ELSE 0 END;
 * @mutate supabase/migrations/20261019071055_shops_refunds_cancels_strikes.sql |   CONSTRAINT shop_refunds_policy CHECK (fee_policy = public.shop_refund_fee_policy(reason)), |
 * @mutate supabase/functions/shop-checkout/index.ts |   const { data, error } = await asShop.rpc("shops_shop_cancel_order", { p_order_id: orderId, p_reason: reason });\n  if (error) return rpcRefusal(error);\n  const d = data as DecidedRow;\n  const refund = await sendRefundNow(admin, orderId, d?.refund_id); |   const refund = await sendRefundNow(admin, orderId, null);\n  const { data, error } = await asShop.rpc("shops_shop_cancel_order", { p_order_id: orderId, p_reason: reason });\n  if (error) return rpcRefusal(error);\n  const d = data as DecidedRow;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, "20261019071055_shops_refunds_cancels_strikes.sql"), "utf8"));
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
  it("a released held Shops refund starts a NEW run of idempotency keys; a reopen voids its settle entry (run-3 review M1, L4)", () => {
    const rel = body("admin_payout_release");
    const branch = rel.slice(rel.indexOf("UPDATE public.shop_refunds SET status = 'pending'"));
    // shopRefundKey(id, attempts, reversals): attempts back to 0 alone rebuilds a key Stripe already answered.
    expect(branch).toMatch(/^UPDATE public\.shop_refunds SET status = 'pending', next_attempt_at = now\(\), attempts = 0, reversals = least\(reversals \+ 1, 100\),/);
    const failed = body("shop_hand_refund_failed");
    expect(failed).toMatch(/UPDATE public\.payout_settlements SET voided_at = now\(\)/);
    expect(failed).toMatch(/executed_at = NULL/);
  });

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

  it("shop_refunds holds reason -> fee policy -> amount as CHECKs, through the ONE shared formula", () => {
    const table = MIG.slice(MIG.indexOf("CREATE TABLE IF NOT EXISTS public.shop_refunds"), MIG.indexOf("ALTER TABLE public.shop_refunds ENABLE"));
    // /code-review of shops-m3-v1 #7: the CHECKs call the functions the quote and the write use.
    expect(table).toMatch(/CONSTRAINT shop_refunds_policy CHECK \(fee_policy = public\.shop_refund_fee_policy\(reason\)\)/);
    expect(table).toMatch(/CONSTRAINT shop_refunds_tax_kept CHECK \(tax_kept_cents = public\.shop_refund_tax_kept\(kept_cents, tax_cents, paid_cents\)\)/);
    const policy = body("shop_refund_fee_policy");
    expect(policy).toMatch(/WHEN p_reason IN \('shop_cancelled', 'no_ready_photo', 'shop_removed', 'problem_shop_fault'\) THEN 'full_shop_pays_fee'/);
    expect(policy).toMatch(/WHEN p_reason IN \('buyer_cancelled', 'problem_no_fault'\) THEN 'keep_card_fee'/);
    // Only our mistake is left for the platform to carry (any other reason has no policy, so no row).
    expect(policy).toMatch(/WHEN p_reason = 'problem_our_mistake' THEN 'full_platform_absorbs'\s+END/);
    expect(table).toMatch(/kept_cents = CASE WHEN fee_policy = 'keep_card_fee' THEN card_fee_cents ELSE 0 END/);
    expect(body("shop_refund_tax_kept")).toMatch(/ceil\(p_kept::numeric \* p_tax \/ \(p_paid - p_tax\)\)::integer/);
    for (const fn of ["shop_write_refund", "shops_order_cancel_quote"]) {
      expect(body(fn), fn).toMatch(/shop_refund_amounts\(/);
      expect(/ceil\(|declutter_card_fee_estimate/.test(body(fn)), fn).toBe(false);
    }
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
