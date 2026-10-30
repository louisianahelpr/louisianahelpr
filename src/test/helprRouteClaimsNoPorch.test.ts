/**
 * The Helpr's route never says "On the seller's porch" when the seller never chose the porch (Declutter audit 2,
 * 2026-10-28: D2-1 / A2-12; lead decision (a); migration 20261028231116). An item's porch_ok defaults to true
 * (20261017055504), so it is not a choice, and nothing records a porch-or-door choice for a Helpr pickup.
 *
 * Reads helpr_my_route's EFFECTIVE definition: a pickup stop's place is 'seller' and no place is derived from
 * porch_ok; and the route card has words for 'seller' that claim neither.
 */
// @mutate supabase/migrations/20261030012018_helpr_delivery_seller_handover.sql | 'place', CASE WHEN p->>'kind' = 'dropoff' THEN 'door' ELSE 'seller' END, | 'place', CASE WHEN p->>'kind' = 'dropoff' THEN 'door' ELSE 'porch' END,
// @mutate src/components/declutter/DeliveryRoute.tsx | seller: "At the seller's door, or on the porch if they leave it out" | seller: "On the seller's porch"
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const route = blankSqlComments(DEFS.get("helpr_my_route")?.stmt ?? "").replace(/\s+/g, " ");
const card = blankComments(readFileSync(resolve(__dirname, "../components/declutter/DeliveryRoute.tsx"), "utf8"));

describe("the Helpr's route claims no porch the seller did not choose", () => {
  it("reads the definition (floor)", () => {
    expect(route.length).toBeGreaterThan(1500);
  });

  it("a pickup stop is 'seller'; no place comes from porch_ok", () => {
    expect(route).toContain("'place', CASE WHEN p->>'kind' = 'dropoff' THEN 'door' ELSE 'seller' END,");
    expect(route).not.toMatch(/porch_ok'\)::boolean/);
    expect(route).not.toMatch(/THEN 'porch'/);
  });

  it("the route card says both for 'seller', never the porch alone", () => {
    expect(card).toContain(`seller: "At the seller's door, or on the porch if they leave it out"`);
  });
});
