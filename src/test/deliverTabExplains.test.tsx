/**
 * The Deliver tab explains itself (owner 2026-10-28: "it's still under declutter, not separate, just explain it
 * better"; lead walkthrough shots 09, 10, 38):
 *   - the opening card says what Deliver is and what a driver earns, in the driver's own pay, from the real rule
 *     (deliveryPriceCents then helprTakeHomeCents), and shows no fee number;
 *   - the "Busy right now" map frames Louisiana's land, never a coastal parish zoomed out to Houston and the Gulf.
 *
 * @mutate src/components/declutter/DeclutterDeliverExplainer.tsx |   const large = helprTakeHomeCents(deliveryPriceCents(EXAMPLE_MILES, ["large"])); |   const large = deliveryPriceCents(EXAMPLE_MILES, ["large"]);
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   const intro = <DeliverExplainer />; |   const intro = <p>Deliver Declutter items near you.</p>;
 * @mutate src/components/busyAreas/BusyAreasCard.tsx |   [29.0, -94.05], // SW: Sabine Pass |   [28.5, -94.6], // SW: Sabine Pass
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { DeliverExplainer, EXAMPLE_MILES } from "@/components/declutter/DeclutterDeliverExplainer";
import { LOUISIANA_LAND } from "@/components/busyAreas/BusyAreasCard";
import { deliveryPriceCents, helprTakeHomeCents } from "@/lib/declutter/delivery";
import { formatPrice } from "@/lib/declutter/distance";

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

describe("the Deliver tab explains itself", () => {
  it("says what it is and what a driver earns, from the real pay rule, with no fee number", () => {
    const { container } = render(<DeliverExplainer />);
    const card = container.querySelector("[data-deliver-explainer]")!;
    expect(card.querySelector("h2")?.textContent).toBe("Deliver Declutter items and get paid");
    expect(card.textContent).toMatch(/You need a car, and a truck for large items\./);
    const pay = container.querySelector("[data-deliver-pay]")!.textContent ?? "";
    const small = formatPrice(helprTakeHomeCents(deliveryPriceCents(EXAMPLE_MILES, ["small"])));
    const large = formatPrice(helprTakeHomeCents(deliveryPriceCents(EXAMPLE_MILES, ["large"])));
    // 5 road miles: $20 small -> $18 to the driver; $40 large -> $37 (2026-10-28 rule: less 5% + 70c, rounded down).
    expect([small, large]).toEqual(["$18", "$37"]);
    expect(pay).toBe(`A ${EXAMPLE_MILES}-mile trip pays you ${small}, or ${large} for a large item. Every delivery shows your pay before you take it, and tips are all yours.`);
    expect(card.textContent).not.toMatch(/fee|%|¢|70c/i);
  });

  it("the Deliver page opens on that card", () => {
    expect(code("src/components/declutter/DeclutterDeliveryViews.tsx")).toMatch(/const intro = <DeliverExplainer \/>;/);
  });

  it("the busy map frames Louisiana's land and never re-zooms to the busy parishes", () => {
    const [[s, w], [n, e]] = LOUISIANA_LAND;
    // The state's land, not the Gulf: its south edge is the coast (Louisiana's mainland reaches ~29.0 N), its centre inland.
    expect(s).toBeGreaterThanOrEqual(28.9);
    expect(n).toBeLessThanOrEqual(33.1);
    expect(w).toBeGreaterThanOrEqual(-94.1);
    expect(e).toBeLessThanOrEqual(-88.7);
    const centre = { lat: (s + n) / 2, lng: (w + e) / 2 };
    expect(centre.lat).toBeGreaterThan(30.5);
    expect(centre.lng).toBeGreaterThan(-92.5);
    expect(centre.lng).toBeLessThan(-90.5);
    const card = code("src/components/busyAreas/BusyAreasCard.tsx");
    expect(card).toContain("regionFromBounds(mk, LOUISIANA_LAND, 1.02)");
    expect(card).not.toMatch(/setRegionAnimated|setRegion\(/);
  });
});
