/*
 * GUARD (owner 11-07, after reviewing Vinted): the Sell form's category picker is a drill-down with a search box on
 * top and an icon per heading, inside the existing posting form, with no new field (11-01 six-field design).
 *   - every heading shows with its own icon; tapping one shows only its categories, and "All categories" goes back;
 *   - a search lists matching categories across headings (with the heading beside each) and picking one sets it;
 *   - a search with no match says so and points at Other;
 *   - both posting screens (the one-screen new listing and a saved draft's steps) use the drill-down, not chips.
 */
// @mutate src/components/declutter/CategoryDrillDown.tsx | .filter((k) => words(`${CATEGORY_LABEL[k] ?? k} ${g.heading} ${catWords(k)} ${headingWords(g.heading)}`).includes(q)) | .filter(() => false)
// @mutate src/components/declutter/CategoryDrillDown.tsx | onClick={() => setOpen(g.heading)} | onClick={() => setOpen(null)}
// @mutate src/components/declutter/CategoryDrillDown.tsx |               const Icon = CATEGORY_GROUP_ICON[g.heading]; |               const Icon = () => null;
// @mutate src/components/declutter/CategoryDrillDown.tsx | <FieldClearButton aria-label={t("sf.clearSearch")} onClick={() => setQuery("")} | <FieldClearButton aria-label={t("sf.clearSearch")} onClick={() => undefined}
// @mutate src/components/declutter/SellSummaryCard.tsx | <CategoryDrillDown label={t("sell.category")} | <ChipGroup options={[]} label={t("sell.category")}
// @mutate src/components/declutter/DeclutterSellView.tsx | <CategoryDrillDown label="Category" | <ChipGroup options={[]} label="Category"
import { readFileSync } from "node:fs";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { blankComments } from "@/test/helpers/blankNonCode";
import { CategoryDrillDown } from "@/components/declutter/CategoryDrillDown";
import { CATEGORY_GROUPS, CATEGORY_GROUP_ICON, CATEGORY_LABEL } from "@/lib/declutter/categoryIcons";

function Harness({ start = "other" }: { start?: string }) {
  const [v, setV] = useState(start);
  return (
    <>
      <CategoryDrillDown label="Category" groups={CATEGORY_GROUPS} value={v} onChange={setV} />
      <output data-testid="value">{v}</output>
    </>
  );
}

describe("Sell form category drill-down", () => {
  it("every heading has an icon, and the top level shows each heading with it", () => {
    expect(CATEGORY_GROUPS.length).toBeGreaterThan(3);
    for (const g of CATEGORY_GROUPS) expect(CATEGORY_GROUP_ICON[g.heading], g.heading).toBeTruthy();
    const { container } = render(<Harness />);
    const rows = container.querySelectorAll("[data-category-heading]");
    expect(rows.length).toBe(CATEGORY_GROUPS.length);
    for (const r of rows) expect(r.querySelector("span svg"), r.getAttribute("data-category-heading") ?? "").not.toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search categories" })).toBeTruthy();
  });

  it("tapping a heading shows only its categories; picking one sets it; All categories goes back", () => {
    const { container } = render(<Harness />);
    const home = CATEGORY_GROUPS.find((g) => g.heading === "Home")!;
    fireEvent.click(container.querySelector('[data-category-heading="Home"]')!);
    const leaves = [...container.querySelectorAll("[data-category-leaf]")].map((e) => e.getAttribute("data-category-leaf"));
    expect(leaves).toEqual(home.values);
    fireEvent.click(container.querySelector('[data-category-leaf="kitchen"]')!);
    expect(screen.getByTestId("value").textContent).toBe("kitchen");
    expect(container.querySelector('[data-category-leaf="kitchen"]')!.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "All categories" }));
    expect(container.querySelectorAll("[data-category-heading]").length).toBe(CATEGORY_GROUPS.length);
    expect(screen.getByRole("button", { name: "Home, Kitchen chosen" })).toBeTruthy();
  });

  it("a search lists matches across headings, with the heading beside each", () => {
    const { container } = render(<Harness />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search categories" }), { target: { value: "fish" } });
    const leaf = container.querySelector('[data-category-leaf="hunting_fishing"]') as HTMLElement;
    expect(leaf).not.toBeNull();
    expect(within(leaf).getByText("Outdoors")).toBeTruthy();
    expect(container.querySelector("[data-category-heading]")).toBeNull();
    fireEvent.click(leaf);
    expect(screen.getByTestId("value").textContent).toBe("hunting_fishing");
    // "&" reads as "and"; a heading word finds its categories.
    fireEvent.change(screen.getByRole("searchbox", { name: "Search categories" }), { target: { value: "toys & games" } });
    expect(container.querySelector('[data-category-leaf="toys_games"]')).not.toBeNull();
    // Q913: the field's own ✕ clears it and the headings come back; no ✕ on an empty field.
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect((screen.getByRole("searchbox", { name: "Search categories" }) as HTMLInputElement).value).toBe("");
    expect(container.querySelectorAll("[data-category-heading]").length).toBe(CATEGORY_GROUPS.length);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  it("a search with no match says so and points at Other", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search categories" }), { target: { value: "zzqx" } });
    expect(screen.getByText(/No category matches "zzqx"\. Choose Other/).getAttribute("role")).toBe("status");
    expect(CATEGORY_LABEL.other).toBe("Other");
  });

  it("both posting screens use the drill-down (no category chip list)", () => {
    for (const f of ["src/components/declutter/SellSummaryCard.tsx", "src/components/declutter/DeclutterSellView.tsx"]) {
      const src = blankComments(readFileSync(f, "utf8"));
      // F260q: the Sell summary card reads its label from the dictionary.
      expect(src, f).toMatch(/<CategoryDrillDown label=(?:"Category"|\{t\("sell\.category"\)\}) groups=\{CATEGORY_GROUPS\}/);
      expect(src, f).not.toMatch(/<ChipGroup[^>]*label="Category"/);
    }
  });
});
