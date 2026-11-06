/**
 * Declutter trades slice 4 (OWNER-DECISIONS 11-06 10:50 AM): the handover end of an accepted trade.
 * Behaviour (real Postgres, the REAL declutter_close_paid_order): src/test/pglite/declutterTradesHandover.pglite.mjs
 * (27 PASS; NEW_MIGRATION=skip is red, 12 fail). This guard pins, on the NEWEST declutter_swap_sweep (any dollar tag,
 * comments blanked), the lines that proof exercises: a checked-out side's order is closed only when it is a free
 * order, with NO strike side, and only when the trade line is its only paid line (declutter_checkout_free bundles a
 * seller's free lines into one order; then only the trade line is released); the order is locked and re-read as paid
 * first; a trade whose two orders were handed over is 'completed'.
 *
 * @mutate supabase/migrations/20261106184913_declutter_trades_handover.sql |       JOIN public.declutter_orders o ON o.id = k.order_id AND o.status = 'paid' AND o.paid_with = 'free' |       JOIN public.declutter_orders o ON o.id = k.order_id AND o.status = 'paid'
 * @mutate supabase/migrations/20261106184913_declutter_trades_handover.sql |     PERFORM public.declutter_close_paid_order(r.order_id, 'trade_lapsed', NULL, NULL, NULL); |     PERFORM public.declutter_close_paid_order(r.order_id, 'trade_lapsed', 'buyer', 'trade_lapsed', NULL);
 * @mutate supabase/migrations/20261106184913_declutter_trades_handover.sql |   UPDATE public.declutter_swap_offers s SET status = 'completed', updated_at = now() |   UPDATE public.declutter_swap_offers s SET status = 'lapsed', updated_at = now()
 * @mutate supabase/migrations/20261106184913_declutter_trades_handover.sql |   'completed'   -- both items handed over (slice 4) |   'lapsed_'
 * @mutate supabase/migrations/20261106184913_declutter_trades_handover.sql |                     WHERE z.order_id = r.order_id AND z.id <> r.line_id AND z.status = 'paid') THEN |                     WHERE z.order_id = r.order_id AND z.status = 'paid') THEN
 * @mutate supabase/migrations/20261106184913_declutter_trades_handover.sql |      WHERE o.id = r.order_id AND o.status = 'paid' AND o.paid_with = 'free' FOR UPDATE; |      WHERE o.id = r.order_id;
 * @mutate supabase/migrations/20261106184913_declutter_trades_handover.sql |       UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now() WHERE id = r.line_id AND status = 'paid'; |       UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now() WHERE order_id = r.order_id AND status = 'paid';
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = "supabase/migrations";

const sweep = (): string => {
  const def = effectiveDefs(DIR).get("declutter_swap_sweep");
  expect(def, "declutter_swap_sweep is gone").toBeTruthy();
  return blankSqlComments(def!.stmt);
};

/** The newest status CHECK on declutter_swap_offers (comments blanked). */
const newestStatusCheck = (): string => {
  let last = "";
  for (const f of migrationFiles(DIR)) {
    const sql = blankSqlComments(readFileSync(`${DIR}/${f}`, "utf8"));
    for (const m of sql.matchAll(/ADD CONSTRAINT declutter_swap_offers_status_check CHECK \(status IN \(([\s\S]*?)\)\)/gi)) last = m[1];
  }
  return last;
};

describe("Declutter trades (slice 4, handover end)", () => {
  it("a checked-out side's order is closed only when free, and never with a strike", () => {
    const b = sweep();
    const closes = b.match(/declutter_close_paid_order\([^;]*\);/gi) ?? [];
    expect(closes.length).toBeGreaterThan(0);
    for (const c of closes) expect(c).toMatch(/declutter_close_paid_order\(r\.order_id,\s*'trade_lapsed',\s*NULL,\s*NULL,\s*NULL\)/i);
    expect(b).toMatch(/JOIN public\.declutter_orders o ON o\.id = k\.order_id AND o\.status\s*=\s*'paid'\s+AND\s+o\.paid_with\s*=\s*'free'/i);
  });

  it("a bundled free order loses only the trade line, and the order is locked and re-read first", () => {
    const b = sweep();
    expect(b).toMatch(/FROM public\.declutter_orders o\s+WHERE o\.id = r\.order_id AND o\.status = 'paid' AND o\.paid_with = 'free' FOR UPDATE;\s*IF NOT FOUND THEN CONTINUE; END IF;/i);
    expect(b).toMatch(/IF NOT EXISTS \(SELECT 1 FROM public\.declutter_cart_items z\s+WHERE z\.order_id = r\.order_id AND z\.id <> r\.line_id AND z\.status = 'paid'\) THEN\s+PERFORM public\.declutter_close_paid_order/i);
    expect(b).toMatch(/ELSE\s+UPDATE public\.declutter_cart_items SET status = 'missed', closed_at = now\(\) WHERE id = r\.line_id AND status = 'paid';/i);
    expect((b.match(/Trade item taken off/g) ?? []).length).toBeGreaterThan(1);
  });

  it("two handed-over orders complete the trade, and 'completed' is an allowed status", () => {
    expect(sweep()).toMatch(/SET\s+status\s*=\s*'completed'[\s\S]*?o\.status\s*=\s*'handed_over'\)\s*=\s*2/i);
    const check = newestStatusCheck();
    expect(check).toMatch(/'completed'/);
    expect((check.match(/'[a-z_]+'/g) ?? []).length).toBeGreaterThan(7);
  });
});
