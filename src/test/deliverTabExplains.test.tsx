/**
 * The Deliver tab explains itself (owner 2026-10-28: "it's still under declutter, not separate, just explain it
 * better"; lead walkthrough shots 09, 10, 38):
 *   - the opening card says what Deliver is and what a driver earns, in the driver's own pay, from the real rule
 *     (deliveryPriceCents then helprTakeHomeCents), and shows no fee number;
 *   - the "Busy right now" map frames Louisiana's land, never a coastal parish zoomed out to Houston and the Gulf.
 *
 * @mutate src/components/declutter/DeclutterDeliverExplainer.tsx |   const large = helprTakeHomeCents(deliveryPriceCents(EXAMPLE_MILES, ["large"])); |   const large = deliveryPriceCents(EXAMPLE_MILES, ["large"]);
 * @mutate src/components/declutter/DeclutterDeliverExplainer.tsx | Not picked up within 2 hours of the pickup time, | Not picked up in time,
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   const intro = <DeliverExplainer />; |   const intro = <p>Deliver Declutter items near you.</p>;
 * @mutate src/components/busyAreas/BusyAreasCard.tsx |   [29.0, -94.05], // SW: Sabine Pass |   [28.5, -94.6], // SW: Sabine Pass
 * @mutate src/components/busyAreas/BusyAreasCard.tsx |   const summary = useMemo(() => busyAreas([], deliveries), [deliveries]); |   const summary = useMemo(() => busyAreas([{ parish: "Vermilion" }], deliveries), [deliveries]);
 * @mutate src/components/busyAreas/BusyAreasCard.tsx |             <li key={a.parish} className="text-sm text-foreground">{busyAreaLabel(a)}</li> |             <li key={a.parish} className="text-sm text-foreground">{busyAreaLabel(a)}<span>{a.total}</span></li>
 * Audit DD D2 (lead 2026-10-30): on Deliver the card counts open DELIVERIES only, and prints each count once.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { DeliverExplainer, EXAMPLE_MILES } from "@/components/declutter/DeclutterDeliverExplainer";
import { BusyAreasCard, LOUISIANA_LAND } from "@/components/busyAreas/BusyAreasCard";
import { deliveryPriceCents, helprTakeHomeCents } from "@/lib/declutter/delivery";
import { formatPrice } from "@/lib/declutter/distance";

// One open job in Vermilion on the Browse map's read, which the Deliver card must NOT count; no MapKit (the list is
// the reading).
vi.mock("@/components/browseMap/useMapJobs", () => ({ useMapJobs: () => ({ jobs: [{ parish: "Vermilion" }], loadError: null }) }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "missing-token" }));

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
    // BUY-45: the limit and the no-show strike the server applies (helpr_task_accept: 2 taken; helpr_task_sweep: 2 hours).
    expect(container.querySelector("[data-deliver-rules]")?.textContent?.replace(/\s+/g, " ").trim()).toBe("You can have 2 deliveries taken and not yet picked up at a time. Not picked up within 2 hours of the pickup time, a delivery goes to another Helpr and you get a delivery strike.");
  });

  it("the Deliver page opens on that card", () => {
    expect(code("src/components/declutter/DeclutterDeliveryViews.tsx")).toMatch(/const intro = <DeliverExplainer \/>;/);
  });

  it("Busy right now counts open deliveries only, each count printed once (audit DD D2)", () => {
    const deliveries = [{ pickup_area: "Broussard, LA" }, { pickup_area: "Youngsville, LA" }, { pickup_area: "Downtown, Baton Rouge" }];
    const { container } = render(<BusyAreasCard deliveries={deliveries} />);
    const rows = [...container.querySelectorAll('[aria-label="Where work is waiting"] li')].map((li) => li.textContent);
    expect(rows).toEqual(["Lafayette Parish: 2 deliveries", "East Baton Rouge Parish: 1 delivery"]);
    // No job is counted on Deliver (the open job in Vermilion stays on the Jobs map).
    expect(container.textContent).not.toMatch(/Vermilion|\bjobs?\b/);
    // Each count once: no second bare number beside the row, no total line repeating the sum.
    for (const n of ["1", "2", "3"]) expect(screen.queryByText(n)).toBeNull();
    expect(container.textContent).not.toMatch(/deliveries are waiting|delivery is waiting/);
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
