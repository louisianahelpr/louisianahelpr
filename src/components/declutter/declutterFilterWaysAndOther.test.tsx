/**
 * A3-109 (Auditor 8, 11-01): Declutter's "How you get it" filter had one chip, "Porch pickup only"; a buyer with no
 * truck could not narrow to items that are delivered or met at a safe spot. Now every way checkout offers is a chip in
 * checkout's words (HANDOVER_TITLE), any picked way passes an item that offers it (checkout's rule: porch_ok, the
 * seller's ticks, Helpr delivery on every paid item), and the pick survives in the URL.
 * A3-110: the Category filter ended with an "Other" heading over an "Other" chip; the heading is now "More".
 *
 * @mutate src/components/declutter/DeclutterFilterPanel.tsx |           {otherWays.map((w) => ( |           {[].map((w: OtherWay) => (
 * @mutate src/components/declutter/DeclutterFilterPanel.tsx | const otherWays = OTHER_WAYS.filter((w) => w !== "seller_delivery" \|\| sellerDelivery); | const otherWays = [...OTHER_WAYS];
 * @mutate src/lib/declutter/browseFilters.ts |   return !picked.some((w) => offersWay(item, w, ways?.get(item.id))); |   return !picked.every((w) => offersWay(item, w, ways?.get(item.id)));
 * @mutate src/lib/declutter/browseFilters.ts |   if (way === "delivery") return item.current_price_cents > 0; |   if (way === "delivery") return true;
 * @mutate src/lib/declutter/browseFilters.ts |   return ticks === null \|\| ticks.includes(way); |   return ticks !== null && ticks.includes(way);
 * @mutate src/lib/declutter/browseFilters.ts |   if (ticks === undefined) return false; |   if (ticks === undefined) return true;
 * @mutate src/lib/declutter/browseFilters.ts |       ways: OTHER_WAYS.filter((w) => (p.get("ways") ?? "").split(",").includes(w)), |       ways: [],
 * @mutate src/lib/declutter/categoryIcons.ts | "Hobbies and fun", "More"] as const; | "Hobbies and fun", "Other"] as const;
 * @mutate src/lib/declutter/categoryIcons.ts | icon: Package, group: "More" }, | icon: Package, group: "Other" },
 */
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { declutterFilterSections } from "./DeclutterFilterPanel";
import { NO_FILTERS, OTHER_WAYS, activeFilterCount, applyBrowseFilters, browseStateFromParams, browseStateInParams, type DeclutterFilters } from "@/lib/declutter/browseFilters";
import { CATEGORY_GROUPS, CATEGORY_LABEL } from "@/lib/declutter/categoryIcons";

function renderSections(filters: DeclutterFilters, onChange: (f: DeclutterFilters) => void, sellerDelivery = true) {
  const sections = declutterFilterSections({
    filters,
    onChange,
    maxMiles: null,
    onMaxMiles: () => {},
    ask: { origin: { status: "pending" }, asked: false, asking: false, canAskAgain: false, deviceNote: null, askDevice: () => {} },
    showDrops: false,
    sellerDelivery,
  });
  render(<div>{sections.map((s) => <section key={s.key} aria-label={s.title}>{s.content}</section>)}</div>);
}

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `Item ${id}`, status: "live", category: "furniture", condition_stars: 4, current_price_cents: 4000,
  porch_ok: false, live_at: "2026-11-01T12:00:00Z", created_at: "2026-11-01T12:00:00Z", ...over,
});
const ROWS = [
  { item: item("porch", { porch_ok: true }), miles: null },
  { item: item("meet"), miles: null },
  { item: item("door"), miles: null },
  { item: item("old"), miles: null },               // ticked nothing: every way, as at checkout
  { item: item("free", { current_price_cents: 0 }), miles: null },
];
const WAYS = new Map<string, string[] | null>([
  ["porch", ["porch"]], ["meet", ["meetup"]], ["door", ["seller_delivery"]], ["old", null], ["free", ["porch"]],
]);
const ids = (f: DeclutterFilters, ways: Map<string, string[] | null> | undefined = WAYS) =>
  applyBrowseFilters(ROWS, f, "", undefined, new Date("2026-11-01T18:00:00Z"), ways).map((r) => r.item.id);

describe("A3-109: How you get it offers every way checkout offers", () => {
  it("shows a chip per way, in checkout's words, each toggling its way", () => {
    const onChange = vi.fn();
    renderSections(NO_FILTERS, onChange);
    const section = screen.getByRole("region", { name: "How you get it" });
    const names = within(section).getAllByRole("button").map((b) => b.textContent);
    expect(names).toEqual(["Porch pickup", "Meet at a safe spot", "Seller delivers", "Helpr delivery"]);
    fireEvent.click(within(section).getByRole("button", { name: "Helpr delivery" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ways: ["delivery"] }));
    cleanup();
    renderSections({ ...NO_FILTERS, ways: ["delivery", "meetup"] }, onChange);
    const pressed = within(screen.getByRole("region", { name: "How you get it" })).getByRole("button", { name: "Meet at a safe spot" });
    expect(pressed).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pressed);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ways: ["delivery"] }));
    cleanup();
  });

  it("hides Seller delivers while its switch is off, as checkout does", () => {
    renderSections(NO_FILTERS, () => {}, false);
    expect(within(screen.getByRole("region", { name: "How you get it" })).queryByRole("button", { name: "Seller delivers" })).toBeNull();
    cleanup();
  });

  it("keeps an item that offers ANY picked way, by checkout's rule", () => {
    expect(ids({ ...NO_FILTERS, porchOnly: true })).toEqual(["porch"]);
    expect(ids({ ...NO_FILTERS, ways: ["meetup"] })).toEqual(["meet", "old"]);
    expect(ids({ ...NO_FILTERS, ways: ["seller_delivery"] })).toEqual(["door", "old"]);
    // Helpr delivery: every paid item (DC-4), never a free claim.
    expect(ids({ ...NO_FILTERS, ways: ["delivery"] })).toEqual(["porch", "meet", "door", "old"]);
    expect(ids({ ...NO_FILTERS, porchOnly: true, ways: ["meetup"] })).toEqual(["porch", "meet", "old"]);
    expect(ids(NO_FILTERS)).toHaveLength(ROWS.length);
  });

  it("never guesses before the sellers' ticks are read", () => {
    expect(ids({ ...NO_FILTERS, ways: ["meetup"] }, new Map())).toEqual([]);
  });

  it("the group counts once on the Filters button, and survives in the URL", () => {
    expect(activeFilterCount({ ...NO_FILTERS, porchOnly: true, ways: ["meetup", "delivery"] }, null)).toBe(1);
    const f = { ...NO_FILTERS, ways: ["meetup", "delivery"] as DeclutterFilters["ways"] };
    const p = browseStateInParams(new URLSearchParams(), { query: "", filters: f, maxMiles: null });
    expect(p.get("ways")).toBe("meetup,delivery");
    expect(browseStateFromParams(p).filters.ways).toEqual(["meetup", "delivery"]);
    expect(browseStateFromParams(new URLSearchParams("ways=bogus,meetup")).filters.ways).toEqual(["meetup"]);
    expect(OTHER_WAYS.length).toBeGreaterThan(2);
  });
});

describe("A3-110: the Category filter says Other once", () => {
  it("no heading repeats a chip's name, and Other is the last chip", () => {
    renderSections(NO_FILTERS, () => {});
    const groups = screen.getAllByRole("group");
    expect(groups.length).toBe(CATEGORY_GROUPS.length);
    expect(CATEGORY_GROUPS.length).toBeGreaterThan(3);
    const labels = new Set(Object.values(CATEGORY_LABEL));
    for (const g of CATEGORY_GROUPS) expect(labels.has(g.heading), g.heading).toBe(false);
    expect(screen.getAllByText("Other")).toHaveLength(1);
    expect(CATEGORY_GROUPS.at(-1)?.heading).toBe("More");
    cleanup();
  });
});
