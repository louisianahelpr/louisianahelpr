/**
 * Lead's product call on the LEAD-PLACE-TIMES review (2026-10-31): places govern porch, door and Helpr pickup; the
 * usual times are only for meetups ("Meetup times"); a meetup-only item never shows places; never both lists for
 * the same way.
 *
 * @mutate src/components/declutter/ItemHandoverTimes.tsx |   return { places, usual: !hasPlaces && pickup ? "Pickup and meetup times" : "Meetup times" }; |   return { places, usual: pickup ? "Pickup and meetup times" : "Meetup times" };
 * @mutate src/components/declutter/ItemHandoverTimes.tsx |   const places = hasPlaces && placeWay; |   const places = hasPlaces;
 * @mutate src/components/declutter/ItemHandoverTimes.tsx |   const placeWay = pickup \|\| !!ways?.includes("delivery"); |   const placeWay = pickup;
 * @mutate src/components/declutter/DeclutterItemView.tsx |             {forSale && user && <ItemHandoverTimes itemId={itemId} handovers={ways.data} />} |
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";
import { itemTimesPlan } from "./ItemHandoverTimes";

describe("the item page shows one list per way of getting it", () => {
  it("porch, pickup and delivery items with places: the places, never the usual times as pickup times", () => {
    expect(itemTimesPlan(["porch"], true)).toEqual({ places: true, usual: null });
    expect(itemTimesPlan(null, true)).toEqual({ places: true, usual: null });
    expect(itemTimesPlan(["delivery"], true)).toEqual({ places: true, usual: null });
    expect(itemTimesPlan(["porch", "meetup"], true)).toEqual({ places: true, usual: "Meetup times" });
  });

  it("a meetup-only item: Meetup times, never places", () => {
    expect(itemTimesPlan(["meetup"], true)).toEqual({ places: false, usual: "Meetup times" });
    expect(itemTimesPlan(["meetup"], false)).toEqual({ places: false, usual: "Meetup times" });
    expect(itemTimesPlan(["meetup"], null)).toEqual({ places: false, usual: "Meetup times" });
    expect(itemTimesPlan(["seller_delivery"], true)).toEqual({ places: false, usual: null });
  });

  it("no saved places: the usual times are the pickup times (as the server falls back), porch-only keeps its day", () => {
    expect(itemTimesPlan(null, false)).toEqual({ places: false, usual: "Pickup times" });
    expect(itemTimesPlan(["delivery"], false)).toEqual({ places: false, usual: null });
    expect(itemTimesPlan(["meetup", "delivery"], false)).toEqual({ places: false, usual: "Meetup times" });
    expect(itemTimesPlan(["porch", "meetup"], false)).toEqual({ places: false, usual: "Pickup and meetup times" });
    expect(itemTimesPlan(["porch"], false)).toEqual({ places: false, usual: null });
  });

  it("while the places read is pending nothing for pickup shows (no flash of the usual times)", () => {
    expect(itemTimesPlan(["porch"], null)).toEqual({ places: false, usual: null });
    expect(itemTimesPlan(["porch", "meetup"], null)).toEqual({ places: false, usual: null });
  });

  it("the item page uses it (source)", () => {
    const src = blankComments(readFileSync("src/components/declutter/DeclutterItemView.tsx", "utf8"));
    expect(src).toContain("<ItemHandoverTimes itemId={itemId} handovers={ways.data} />");
    expect(src).not.toContain("<ItemPickupTimes ");
    expect(src).not.toContain("<ItemPickupPlaces ");
  });
});
