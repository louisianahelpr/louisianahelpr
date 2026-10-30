/**
 * DC-4 (Selling audit 2026-10-30; owner 2026-10-29): buyers can ALWAYS choose Helpr delivery for what they buy.
 * The class: one of the places that decide whether Helpr delivery is offered or allowed still reads the seller's
 * ticks, so the sell form, the checkout screen, the checkout edge function and the checkout RPC disagree. All four
 * are read here (newest migration definition, the edge mirror, the client rule, the sell form).
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/declutterHelprDeliveryAlways.pglite.mjs (11 PASS after;
 * NEW_MIGRATION=skip 4 FAIL, measured 2026-10-30). The old refusal was measured on prod in a rolled-back transaction.
 *
 * @mutate supabase/migrations/20261030045905_declutter_helpr_delivery_always.sql |      AND NOT (p_handover = 'delivery' AND s.all_paid)\n |
 * @mutate supabase/functions/declutter-checkout/index.ts |   if (handover === "delivery" && allPaid) return false; |
 * @mutate src/lib/declutter/handovers.ts |   return (paid && way === "delivery") \|\| ways === null \|\| ways.includes(way); |   return ways === null \|\| ways.includes(way);
 * @mutate src/components/declutter/DeclutterTradeViews.tsx | wayAllowed(ways, "delivery", true) | wayAllowed(ways, "delivery")
 * @mutate src/components/declutter/SellHandoverChoices.tsx | .filter((w) => w !== "delivery"); | ;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { newestFunction } from "./helpers/parityReaders";
import { wayAllowed } from "@/lib/declutter/handovers";
import { SELLER_WAYS } from "@/components/declutter/SellHandoverChoices";

const code = (p: string) => blankComments(readFileSync(p, "utf8"));

describe("DC-4: Helpr delivery is always a buyer's choice for what they buy", () => {
  it("the checkout RPC's rule never refuses Helpr delivery for paid lines (newest definition)", () => {
    const def = newestFunction("declutter_handover_refused");
    expect(def.file).toContain("20261030045905");
    const body = blankSqlComments(def.body).replace(/\s+/g, " ");
    expect(body).toContain("AND NOT (p_handover = 'delivery' AND s.all_paid)");
    expect(body).toContain("(c.price_cents > 0 AND i.price_cents > 0) AS paid");
  });

  it("the checkout edge function's mirror says the same", () => {
    const edge = code("supabase/functions/declutter-checkout/index.ts");
    expect(edge).toMatch(/function handoverRefusedFor\(lineWays: \(string\[\] \| null\)\[\], handover: string, allPaid: boolean\): boolean \{[\s\S]{0,200}if \(handover === "delivery" && allPaid\) return false;/);
    expect(edge).toContain(": null)), handover, allPaid);");
  });

  it("the buyer's checkout offers it on a porch-only paid listing; a free claim does not", () => {
    expect(wayAllowed(["porch"], "delivery", true)).toBe(true);
    expect(wayAllowed(["porch"], "delivery")).toBe(false);
    expect(wayAllowed(["porch"], "meetup", true)).toBe(false);
    expect(code("src/components/declutter/DeclutterTradeViews.tsx")).toContain('deliveryOpen && wayAllowed(ways, "delivery", true)');
  });

  it("the sell form never offers it as a tick, and says plainly that buyers can choose it", () => {
    expect(SELLER_WAYS).not.toContain("delivery");
    expect(SELLER_WAYS.length).toBeGreaterThan(2);
    expect(code("src/components/declutter/SellHandoverChoices.tsx")).toContain("{!free && <p className=\"text-ds-13 text-muted-foreground\" data-helpr-delivery-always=\"\">{HELPR_DELIVERY_ALWAYS}</p>}");
  });
});
