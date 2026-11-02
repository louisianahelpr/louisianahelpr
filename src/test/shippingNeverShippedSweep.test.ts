/**
 * Q2259 shipping S6 part 2b: the newest declutter_ship_sweep closes a paid, captured ship order never handed to USPS by
 * its ship-by (label bought, no acceptance scan, no open problem) as a seller-fault cancel, and asks to void a TEST label
 * only. Behaviour proven in PGlite: src/test/pglite/shippingNeverShippedSweep.pglite.mjs (57/57; 8 planted defects RED).
 *
 * @mutate supabase/migrations/20261102045035_shipping_never_shipped_sweep.sql |        AND s.label_state = 'bought' AND s.accepted_at IS NULL\n       AND now() >= public.declutter_ship_by(o2.paid_at) |        AND s.label_state = 'bought'\n       AND now() >= public.declutter_ship_by(o2.paid_at)
 * @mutate supabase/migrations/20261102045035_shipping_never_shipped_sweep.sql |        AND now() >= public.declutter_ship_by(o2.paid_at)\n |
 * @mutate supabase/migrations/20261102045035_shipping_never_shipped_sweep.sql | declutter_close_paid_order(o.id, 'seller_backed_out', 'seller', 'item_gone_after_sale', | declutter_close_paid_order(o.id, 'buyer_cancelled', NULL, NULL,
 * @mutate supabase/migrations/20261102045035_shipping_never_shipped_sweep.sql |         IF v_mode = 'test' THEN | IF true THEN
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = join(process.cwd(), "supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const flat = (s: string) => s.replace(/\s+/g, " ");

function newestSweep(): { file: string; body: string } {
  for (const f of [...files].reverse()) {
    const sql = blankSqlComments(readFileSync(join(DIR, f), "utf8"));
    const at = sql.search(/CREATE OR REPLACE FUNCTION public\.declutter_ship_sweep\(\)/);
    if (at < 0) continue;
    const end = sql.indexOf("$function$;", at);
    return { file: f, body: flat(sql.slice(at, end < 0 ? undefined : end)) };
  }
  throw new Error("no declutter_ship_sweep");
}

describe("a shipped order never handed to USPS by its ship-by is cancelled on the seller", () => {
  const { file, body } = newestSweep();
  const loopAt = body.indexOf("never_shipped") >= 0 ? body.indexOf("s.label_state = 'bought'") : -1;

  it("the newest sweep has the never-shipped loop with every condition", () => {
    expect(file >= "20261102045035").toBe(true);
    expect(loopAt).toBeGreaterThan(0);
    const loop = body.slice(loopAt - 200);
    for (const cond of [
      "o2.status = 'paid' AND o2.handover = 'ship' AND o2.ship_capture = 'captured'",
      "AND s.label_state = 'bought' AND s.accepted_at IS NULL AND now() >= public.declutter_ship_by(o2.paid_at)",
      "AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')",
    ]) expect(loop, cond).toContain(cond);
  });

  it("closes as the seller's fault, with a strike, and voids only a test label", () => {
    expect(body).toContain("PERFORM public.declutter_close_paid_order(o.id, 'seller_backed_out', 'seller', 'item_gone_after_sale',");
    expect(body).toMatch(/IF v_mode = 'test' THEN UPDATE public\.shipments SET label_state = 'void_requested'/);
    expect(body).toContain("'declutter_ship_sweep-live-void'");
  });
});
