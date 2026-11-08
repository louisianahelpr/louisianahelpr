/**
 * Declutter trades slice 4 (OWNER-DECISIONS 11-06 10:50 AM): the handover end of an accepted trade.
 * Behaviour (real Postgres, the REAL declutter_close_paid_order): src/test/pglite/declutterTradesHandover.pglite.mjs
 * (27 PASS; NEW_MIGRATION=skip is red, 12 fail). This guard pins, on the NEWEST declutter_swap_sweep (any dollar tag,
 * comments blanked), the lines that proof exercises: a checked-out side's order is closed only when it is a free
 * order, with NO strike side, and only when the trade line is its only paid line (declutter_checkout_free bundles a
 * seller's free lines into one order; then only the trade line is released); the order is locked and re-read as paid
 * first; a trade whose two orders were handed over is 'completed'.
 *
 * The trades fixes (20261108195151) moved the release into declutter_end_swap (one trade notice, offers reopen on
 * both items): the checks below read the NEWEST declutter_end_swap for the release and the newest sweep for the
 * completed rule. Behaviour: src/test/pglite/declutterTradesFixes.pglite.mjs.
 *
 * @mutate supabase/migrations/20261108195151_declutter_trades_fixes.sql |     ELSIF c.status = 'paid' AND c.order_status = 'paid' AND c.paid_with = 'free' THEN |     ELSIF c.status = 'paid' AND c.order_status = 'paid' THEN
 * @mutate supabase/migrations/20261108195151_declutter_trades_fixes.sql |       IF NOT EXISTS (SELECT 1 FROM public.declutter_cart_items z WHERE z.order_id = c.order_id AND z.status = 'paid') THEN |       IF true THEN
 * @mutate supabase/migrations/20261108195151_declutter_trades_fixes.sql |       UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now() WHERE id = c.id AND status = 'paid'; |       UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now() WHERE order_id = c.order_id AND status = 'paid';
 * @mutate supabase/migrations/20261108195151_declutter_trades_fixes.sql |   UPDATE public.declutter_swap_offers s SET status = 'completed', updated_at = now() |   UPDATE public.declutter_swap_offers s SET status = 'lapsed', updated_at = now()
 * @mutate supabase/migrations/20261106184913_declutter_trades_handover.sql |   'completed'   -- both items handed over (slice 4) |   'lapsed_'
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = "supabase/migrations";

const endSwap = (): string => {
  const def = effectiveDefs(DIR).get("declutter_end_swap");
  expect(def, "declutter_end_swap is gone").toBeTruthy();
  return blankSqlComments(def!.stmt);
};

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
  it("a checked-out side's order is released only when free, and never with a strike", () => {
    const e = endSwap();
    expect(e).toMatch(/ELSIF c\.status = 'paid' AND c\.order_status = 'paid' AND c\.paid_with = 'free' THEN/i);
    expect(e).not.toMatch(/declutter_give_strike|declutter_close_paid_order\([^)]*'(buyer|seller)'/i);
    expect(sweep()).toMatch(/declutter_end_swap\(r\.id,\s*NULL\)/i);
  });

  it("a bundled free order loses only the trade line; the order closes only when nothing else is paid on it", () => {
    const e = endSwap();
    expect(e).toMatch(/UPDATE public\.declutter_cart_items SET status = 'missed', closed_at = now\(\) WHERE id = c\.id AND status = 'paid';/i);
    expect(e).toMatch(/IF NOT EXISTS \(SELECT 1 FROM public\.declutter_cart_items z WHERE z\.order_id = c\.order_id AND z\.status = 'paid'\) THEN\s+UPDATE public\.declutter_orders SET status = 'refunded'[^;]*AND paid_with = 'free';/i);
  });

  it("two handed-over orders complete the trade, and 'completed' is an allowed status", () => {
    expect(sweep()).toMatch(/SET\s+status\s*=\s*'completed'[\s\S]*?o\.status\s*=\s*'handed_over'\)\s*=\s*2/i);
    const check = newestStatusCheck();
    expect(check).toMatch(/'completed'/);
    expect((check.match(/'[a-z_]+'/g) ?? []).length).toBeGreaterThan(7);
  });
});
