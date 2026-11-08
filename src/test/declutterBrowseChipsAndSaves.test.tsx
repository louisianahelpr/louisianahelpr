/*
 * GUARD (owner 11-07, after reviewing Vinted): Browse's grid has a row of category chips at the top, and each
 * photo-first card shows its heart with the save count, the title, the condition and the price.
 *   - the card shows the condition in the item page's words; the heart shows "N" and says "saved by N"; no count
 *     (none, or not read yet) shows no number; a guest sees the count without a heart to press;
 *   - a heart tap moves the number at once (shownSaves), never below zero;
 *   - the chips: All first, then the categories on the list, busiest first, the chosen one kept; no row for one;
 *   - SPEED: the counts are read AFTER the cards paint, never inside Browse's first-screen loading gate;
 *   - the read asks at most PER_READ items per call (the server cap) and, before the server read is deployed, shows
 *     no numbers (never zeros).
 * Server rules (visibility, a number never a name, grants): src/test/pglite/declutterItemSaveCounts.pglite.mjs.
 */
// @mutate src/components/declutter/DeclutterItemCard.tsx | {condition && <span data-card-condition={item.condition_stars} | {false && <span data-card-condition={item.condition_stars}
// @mutate src/components/declutter/DeclutterItemCard.tsx |   return n && n > 0 ? (n > 999 ? "999+" : String(n)) : null; |   return null;
// @mutate src/components/declutter/DeclutterItemCard.tsx |     if (!savesText) return card; |     return card;
// @mutate src/lib/declutter/saveCounts.ts |   return Math.max(0, serverCount - (savedAtRead ? 1 : 0) + (savedNow ? 1 : 0)); |   return serverCount;
// @mutate src/components/declutter/DeclutterCategoryChips.tsx |     return keys.sort((a, b) => (n.get(b) ?? 0) - (n.get(a) ?? 0) \|\| (order.get(a) ?? 99) - (order.get(b) ?? 99)); |     return keys;
// @mutate src/components/declutter/DeclutterCategoryChips.tsx |     if (value && CATEGORY_LABEL[value] && !n.has(value)) keys.push(value); | /* gone */
// @mutate src/components/declutter/DeclutterBrowseView.tsx |     enabled: cardsPainted && others.length > 0, |     enabled: others.length > 0,
// @mutate src/lib/declutter/saveCounts.ts |     if (res.error && isMissingRpcNamed(res.error, "declutter_item_save_counts")) return null; | /* gone */
// @mutate src/lib/declutter/saveCounts.ts | const PER_READ = 200; | const PER_READ = 1000;
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "@/test/helpers/blankNonCode";

const rpc = vi.hoisted(() => ({ calls: [] as string[][], missing: false }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (_name: string, args: { p_item_ids: string[] }) => {
      rpc.calls.push(args.p_item_ids);
      if (rpc.missing) return { data: null, error: { code: "PGRST202", message: "Could not find the function public.declutter_item_save_counts" } };
      return { data: args.p_item_ids.filter((id) => id.endsWith("7")).map((id) => ({ item_id: id, saves: 2 })), error: null };
    },
  },
}));

import { ItemCard } from "@/components/declutter/DeclutterItemCard";
import { DeclutterCategoryChips } from "@/components/declutter/DeclutterCategoryChips";
import { fetchSaveCounts, shownSaves } from "@/lib/declutter/saveCounts";

const item = {
  id: "i1", seller_id: "s1", status: "live", title: "Oak rocking chair", category: "furniture", condition_stars: 5,
  price_cents: 4000, current_price_cents: 4000, area_label: "Mid-City", area_lat: 30.4, area_lng: -91.1, porch_ok: true,
} as never;
const card = (props: Record<string, unknown>) =>
  render(<MemoryRouter><ItemCard item={item} miles={null} approximate={false} {...props} /></MemoryRouter>);

describe("Browse cards: condition and the heart's save count", () => {
  it("shows the condition under the title, in the item page's words", () => {
    const { container } = card({});
    expect(container.querySelector("[data-card-condition]")?.textContent).toBe("Like new");
  });

  it("a member's heart shows the count and says it; none or not read shows no number", () => {
    const save = { on: false, toggle: vi.fn() };
    const a = card({ save, saves: 3 });
    const heart = a.container.querySelector("[data-card-heart]") as HTMLElement;
    expect(heart.getAttribute("aria-label")).toBe("Save Oak rocking chair, saved by 3");
    expect(heart.textContent).toBe("3");
    a.unmount();
    for (const saves of [0, null, undefined]) {
      const b = card({ save, saves });
      const h = b.container.querySelector("[data-card-heart]") as HTMLElement;
      expect(h.getAttribute("aria-label")).toBe("Save Oak rocking chair");
      expect(h.textContent).toBe("");
      b.unmount();
    }
  });

  it("a guest sees the count with no heart to press; no count, nothing over the photo", () => {
    const a = card({ saves: 2 });
    expect(a.container.querySelector("[data-card-heart]")).toBeNull();
    expect(within(a.container.querySelector("[data-card-saves]") as HTMLElement).getByText("Saved by 2 people")).toBeTruthy();
    a.unmount();
    const b = card({ saves: 0 });
    expect(b.container.querySelector("[data-card-saves]")).toBeNull();
  });

  it("a heart tap moves the number at once, never below zero", () => {
    expect(shownSaves(3, false, true)).toBe(4);
    expect(shownSaves(3, true, false)).toBe(2);
    expect(shownSaves(3, true, true)).toBe(3);
    expect(shownSaves(0, true, false)).toBe(0);
  });
});

describe("Browse's category chips", () => {
  const items = [{ category: "toys_games" }, { category: "furniture" }, { category: "kitchen" }, { category: "kitchen" }, { category: "kitchen" }, { category: "furniture" }];
  it("All first, then the categories on the list, busiest first; a tap picks one, a second tap shows all", () => {
    const onChange = vi.fn();
    const { rerender } = render(<DeclutterCategoryChips items={items} value={null} onChange={onChange} />);
    const row = screen.getByRole("group", { name: "Categories" });
    expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual(["All", "Kitchen", "Furniture", "Toys and games"]);
    expect(within(row).getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(row).getByRole("button", { name: "Kitchen" }));
    expect(onChange).toHaveBeenLastCalledWith("kitchen");
    rerender(<DeclutterCategoryChips items={items} value="kitchen" onChange={onChange} />);
    fireEvent.click(within(row).getByRole("button", { name: "Kitchen" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("keeps the chosen category even with nothing in it; no row for a single category", () => {
    const { unmount } = render(<DeclutterCategoryChips items={items} value="bikes" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Bikes" }).getAttribute("aria-pressed")).toBe("true");
    unmount();
    const { container } = render(<DeclutterCategoryChips items={[{ category: "kitchen" }]} value={null} onChange={vi.fn()} />);
    expect(container.querySelector("[data-chip-row]")).toBeNull();
  });
});

describe("save counts: speed and the read", () => {
  it("are read after the cards paint, never inside the first screen's loading gate", () => {
    const src = blankComments(readFileSync("src/components/declutter/DeclutterBrowseView.tsx", "utf8"));
    const gate = /const listLoading = [^;]*;/.exec(src)?.[0] ?? "";
    expect(gate).toMatch(/photos\.isLoading/);
    expect(gate).not.toMatch(/saveCounts/);
    expect(src).toMatch(/queryKey: \["declutter", "save-counts"[\s\S]{0,400}enabled: cardsPainted && others\.length > 0,/);
    expect(src).toMatch(/if \(listLoading \|\| cardsPainted\) return;/);
  });

  it("asks 200 items at a time; before the read is deployed, no numbers (never zeros)", async () => {
    rpc.calls = [];
    const ids = Array.from({ length: 450 }, (_, i) => `id-${i}`);
    const counts = await fetchSaveCounts(ids);
    expect(rpc.calls.map((c) => c.length)).toEqual([200, 200, 50]);
    expect(counts?.get("id-7")).toBe(2);
    expect(counts?.get("id-8")).toBeUndefined();
    rpc.missing = true;
    expect(await fetchSaveCounts(["id-7"])).toBeNull();
    rpc.missing = false;
  });
});
