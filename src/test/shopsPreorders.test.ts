/**
 * Shops PREORDERS (20261108184654_shops_preorders; owner 11-08): the static half. Reads the NEWEST definition of each
 * function (any dollar tag, src/test/helpers/effectiveFunctionDefs.ts), comments blanked.
 *
 *   1. Card age: every automatic preorder refund falls inside Stripe's ~180-day refund window
 *      (120 days at set + one push of 30 + 7 late days = 157), held by a table CHECK and by both setters.
 *   2. Fee policy: a missed goal, the shop's lateness and its pushed date refund the buyer in full with the card fee the
 *      shop's (owner 10-14: we never absorb a fee); a buyer's own cancel keeps the card fee.
 *   3. Every preorder refund path takes the order's row lock before it writes the refund, and the sweep is written
 *      reconcile-safe (one refund row per order: it skips orders that already have one).
 *   4. A preorder's hold is accepted at once (pay in full at order), the old free-window cancel can never close one,
 *      the day cap and the porch no-photo clock skip preorders.
 *   5. The edge: shop-checkout runs shops_cancel_preorder BEFORE it sends the refund; the webhook captures a preorder
 *      at the hold; declutter-money runs the sweep before shop_refunds_due sends.
 *   6. Money review 11-08: a preorder's ready tap counts only from ready-by - 14 days (trigger on shop_handovers); a
 *      preorder item can never be on an ordinary order (trigger on shop_order_lines: shops_request_order would skip
 *      the cap, the goal and the refunds); a buyer's cancel after the goal-missed stamp or after ready-by + 7 is filed
 *      as the sweep would file it (the shop pays the card fee).
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/shopsPreorders.pglite.mjs (61 checks, measured 2026-11-08; red without the migration).
 *
 * @mutate supabase/migrations/20261108184654_shops_preorders.sql |   preorder_ready_by IS NULL OR preorder_ready_by - preorder_set_on <= 150); |   preorder_ready_by IS NULL OR preorder_ready_by - preorder_set_on <= 200);
 * @mutate supabase/migrations/20261112160014_shops_preorder_buyer_cancel_full_refund.sql |     WHEN p_reason IN ('preorder_shop_late', 'preorder_date_moved', 'preorder_goal_missed', 'preorder_buyer_cancelled') THEN 'full_shop_pays_fee' |     WHEN p_reason IN ('preorder_shop_late', 'preorder_date_moved', 'preorder_goal_missed') THEN 'keep_card_fee'
 * @mutate supabase/migrations/20261109224952_notices_card_fee_and_our_team.sql |       AND NOT EXISTS (SELECT 1 FROM public.shop_refunds x WHERE x.order_id = so.id)\n     ORDER BY so.id LIMIT 200\n  LOOP\n    BEGIN\n      o := public.shop_lock_open_charged_order(c.id, false);\n      UPDATE public.shop_orders SET status = 'refunded', close_reason = 'preorder_goal_missed' |       AND NOT EXISTS (SELECT 1 FROM public.shop_refunds x WHERE x.order_id = so.id)\n     ORDER BY so.id LIMIT 200\n  LOOP\n    BEGIN\n      UPDATE public.shop_orders SET status = 'refunded', close_reason = 'preorder_goal_missed'
 * @mutate supabase/functions/shop-checkout/index.ts |   const { data, error } = await asBuyer.rpc("shops_cancel_preorder", { p_order_id: orderId });\n  if (error) return rpcRefusal(error);\n  const d = data as { refund_id?: string; refund_cents?: number } \| null;\n  const refund = await sendRefundNow(admin, orderId, d?.refund_id); |   const refund = await sendRefundNow(admin, orderId, null);\n  const { data, error } = await asBuyer.rpc("shops_cancel_preorder", { p_order_id: orderId });\n  if (error) return rpcRefusal(error);\n  const d = data as { refund_id?: string; refund_cents?: number } \| null;
 * @mutate supabase/functions/stripe-webhook/handlers/shopCheckout.ts |         const done = await captureShopHold(stripe, supabase, answer.order_id, piId, 0); |         const done = "skipped";
 * @mutate supabase/migrations/20261108184654_shops_preorders.sql |   IF v_ready IS NOT NULL AND public.shop_local_today() < v_ready - 14 THEN | IF v_ready IS NOT NULL AND public.shop_local_today() < v_ready - 140 THEN
 * @mutate supabase/migrations/20261108184654_shops_preorders.sql |     AND NOT EXISTS (SELECT 1 FROM public.shop_orders o WHERE o.id = NEW.order_id AND o.preorder_item_id = NEW.item_id) THEN |     AND NOT EXISTS (SELECT 1 FROM public.shop_orders o WHERE o.id = NEW.order_id) THEN
 * @mutate supabase/migrations/20261112160014_shops_preorder_buyer_cancel_full_refund.sql |     WHEN ((o.ready_date + 8)::timestamp AT TIME ZONE 'America/Chicago') <= now() THEN 'preorder_shop_late'\n | \n
 * @mutate supabase/migrations/20261112160014_shops_preorder_buyer_cancel_full_refund.sql |       THEN 'preorder_goal_missed'\n    WHEN ((o.ready_date + 8) |       THEN 'buyer_cancelled'\n    WHEN ((o.ready_date + 8)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, "20261108184654_shops_preorders.sql"), "utf8"));
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => {
  const stmt = blankSqlComments(DEFS.get(name)?.stmt ?? "");
  const m = /\bAS\s+\$\w*\$/i.exec(stmt);
  return m ? stmt.slice(m.index) : "";
};
const flat = (t: string) => t.replace(/\s+/g, " ");
const src = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));
const fnSlice = (code: string, name: string) => {
  const start = code.indexOf(`async function ${name}(`);
  const end = code.indexOf("\nasync function ", start + 10);
  return start < 0 ? "" : code.slice(start, end > 0 ? end : undefined);
};

/** Stripe refunds a card charge up to about 180 days after it (Stripe docs, "Refund and cancel payments"). */
const STRIPE_REFUND_WINDOW_DAYS = 180;
const PREORDER_MAX_DAYS_AT_SET = 120;
const PREORDER_MAX_PUSH_DAYS = 30;
const PREORDER_LATE_DAYS = 7;

const REFUND_PATHS = ["shops_cancel_preorder", "shop_preorder_sweep"];

describe("Shops preorders: card age, fee policy, row locks, auto-accept", () => {
  it("reads a real inventory (floors)", () => {
    for (const fn of [...REFUND_PATHS, "shops_set_item_preorder", "shops_push_preorder_date", "shops_request_preorder",
      "shops_item_preorders", "shop_preorder_units", "shop_mark_order_held", "shop_refund_sweep", "shop_day_count"]) {
      expect(DEFS.has(fn), fn).toBe(true);
    }
    expect(REFUND_PATHS.length).toBeGreaterThan(1);
    expect(body("shop_preorder_sweep").length).toBeGreaterThan(2000);
  });

  it("every automatic refund is inside Stripe's refund window (120 + 30 + 7 < 180)", () => {
    const worst = PREORDER_MAX_DAYS_AT_SET + PREORDER_MAX_PUSH_DAYS + PREORDER_LATE_DAYS;
    expect(worst).toBeLessThan(STRIPE_REFUND_WINDOW_DAYS);
    const check = /CONSTRAINT shop_items_preorder_card_age CHECK \(\s*preorder_ready_by IS NULL OR preorder_ready_by - preorder_set_on <= (\d+)\)/.exec(MIG);
    expect(check, "the card-age CHECK").not.toBeNull();
    expect(Number(check?.[1]) + PREORDER_LATE_DAYS).toBeLessThan(STRIPE_REFUND_WINDOW_DAYS);
    expect(Number(check?.[1])).toBe(PREORDER_MAX_DAYS_AT_SET + PREORDER_MAX_PUSH_DAYS);
    expect(body("shops_set_item_preorder")).toContain(`p_ready_by > v_today + ${PREORDER_MAX_DAYS_AT_SET}`);
    expect(body("shops_push_preorder_date")).toContain(`p_new_ready_by > i.preorder_ready_by + ${PREORDER_MAX_PUSH_DAYS}`);
    // The late refunds start at the end of ready-by + 7 (midnight of day 8, Louisiana time).
    expect(body("shop_preorder_sweep")).toContain(`(so.ready_date + ${PREORDER_LATE_DAYS + 1})::timestamp AT TIME ZONE 'America/Chicago'`);
  });

  it("who carries the card fee, by preorder reason", () => {
    const policy = body("shop_refund_fee_policy");
    expect(policy).toMatch(/WHEN p_reason IN \('preorder_shop_late', 'preorder_date_moved', 'preorder_goal_missed', 'preorder_buyer_cancelled'\) THEN 'full_shop_pays_fee'/);
    expect(policy).not.toMatch(/preorder_[a-z_]+'\)? THEN 'full_platform_absorbs'/);
    const cancel = flat(body("shops_cancel_preorder"));
    // Money review 11-08 (3): the sweep's own triggers first (the shop pays), then a pushed date, then the buyer's own.
    expect(cancel).toContain("v_reason := CASE WHEN EXISTS (SELECT 1 FROM public.shop_items i WHERE i.id = o.preorder_item_id AND i.preorder_goal_missed_at IS NOT NULL) THEN 'preorder_goal_missed' "
      + "WHEN ((o.ready_date + 8)::timestamp AT TIME ZONE 'America/Chicago') <= now() THEN 'preorder_shop_late' "
      + "WHEN o.preorder_moved_at IS NOT NULL THEN 'preorder_date_moved' ELSE 'preorder_buyer_cancelled' END;");
    // S2-019 (owner-approved): the buyer's own preorder cancel is a full refund; the shop carries the card fee.
    // The late time is the sweep's own (ready-by + 7, end of day).
    expect(flat(body("shop_preorder_sweep"))).toContain("AND ((so.ready_date + 8)::timestamp AT TIME ZONE 'America/Chicago') <= now()");
  });

  it("money review 11-08: no early ready tap on a preorder, no preorder item on an ordinary order", () => {
    const ready = flat(body("shop_handovers_preorder_ready_guard"));
    expect(ready).toContain("IF v_ready IS NOT NULL AND public.shop_local_today() < v_ready - 14 THEN RAISE EXCEPTION 'preorder_not_ready_yet'");
    expect(MIG).toMatch(/CREATE TRIGGER trg_shop_handovers_preorder_ready_guard\s+BEFORE INSERT OR UPDATE OF ready_at ON public\.shop_handovers/);
    const lines = flat(body("shop_order_lines_preorder_guard"));
    expect(lines).toContain("AND NOT EXISTS (SELECT 1 FROM public.shop_orders o WHERE o.id = NEW.order_id AND o.preorder_item_id = NEW.item_id) THEN RAISE EXCEPTION 'preorder_use_preorder_checkout'");
    expect(MIG).toMatch(/CREATE TRIGGER trg_shop_order_lines_preorder_guard\s+BEFORE INSERT OR UPDATE OF item_id, order_id ON public\.shop_order_lines/);
    // No later migration drops either trigger.
    for (const f of readdirSync(MIG_DIR).filter((x) => x > "20261108184654_shops_preorders.sql" && x.endsWith(".sql"))) {
      const later = blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"));
      expect(later, f).not.toMatch(/DROP TRIGGER[^;]*trg_shop_(handovers_preorder_ready|order_lines_preorder)_guard/);
    }
  });

  it("every preorder refund path locks the order before it writes, and never calls the network", () => {
    for (const fn of REFUND_PATHS) {
      const b = body(fn);
      const writes = [...b.matchAll(/shop_write_refund\(/g)].map((m) => m.index ?? 0);
      expect(writes.length, fn).toBeGreaterThan(0);
      for (const w of writes) {
        const before = b.slice(0, w);
        expect(before.lastIndexOf("shop_lock_open_charged_order("), `${fn}: lock before the write at ${w}`).toBeGreaterThan(before.lastIndexOf("LOOP"));
      }
      expect(/net\.http|http_post|pg_net/i.test(b), fn).toBe(false);
    }
  });

  it("a preorder's hold is accepted at once; the old cancel, the day cap and the porch clock skip preorders", () => {
    expect(body("shop_mark_order_held")).toMatch(/IF o\.preorder_item_id IS NOT NULL THEN\s+UPDATE public\.shop_orders SET status = 'accepted', accepted_at = now\(\)/);
    expect(body("shop_mark_order_held")).toMatch(/IF o\.preorder_item_id IS NULL AND v_cap IS NOT NULL/);
    expect(body("shop_day_count")).toMatch(/AND preorder_item_id IS NULL/);
    expect(body("shop_refund_sweep")).toMatch(/AND so\.preorder_item_id IS NULL/);
    expect(body("shop_orders_preorder_cancel_guard")).toMatch(/NEW\.close_reason IN \('buyer_cancelled_free', 'buyer_cancelled_late'\)/);
  });

  it("the edge: RPC before refund, capture at the hold, sweep before the sender", () => {
    const checkout = fnSlice(src("supabase/functions/shop-checkout/index.ts"), "preorderCancel");
    const call = checkout.indexOf('.rpc("shops_cancel_preorder"');
    const refusal = checkout.indexOf("if (error) return rpcRefusal(error);");
    const send = checkout.indexOf("sendRefundNow(");
    expect(call).toBeGreaterThan(0);
    expect(refusal).toBeGreaterThan(call);
    expect(send).toBeGreaterThan(refusal);
    const hook = src("supabase/functions/stripe-webhook/handlers/shopCheckout.ts");
    expect(hook).toMatch(/answer\.preorder === true[\s\S]{0,200}captureShopHold\(stripe, supabase, answer\.order_id, piId, 0\)/);
    const money = src("supabase/functions/declutter-money/index.ts");
    const sweep = money.indexOf('admin.rpc("shop_preorder_sweep"');
    expect(sweep).toBeGreaterThan(0);
    expect(money.indexOf('admin.rpc("shop_refunds_due"')).toBeGreaterThan(sweep);
  });
});
