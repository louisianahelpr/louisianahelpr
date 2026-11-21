/**
 * A budget section never shows a pick whose checked price is over its cap (gg-live-1120, live check 11-20): Under $25
 * showed the Rainbow Loom Mighty Loom ($34.99), the Loomi-Pals Glow ($43.99) and Malbon socks ($28), and Stocking
 * Stuffers a $66.40 Rare Beauty set. scripts/giftGuideBudgetCaps.mjs runs last in scripts/gift-guide-picks.mjs: an
 * over-cap pick moves to the cheapest budget section that fits, else leaves; hand-picked in-budget refills come from
 * scripts/gift-guide-budget-1120.json.
 *
 * @mutate scripts/giftGuideBudgetCaps.mjs |   const over = (p) => typeof p.price === "number" && capOf(p) != null && p.price > capOf(p); |   const over = (p) => false;
 * @mutate scripts/giftGuideBudgetCaps.mjs |       const to = budget.find((id) => BUDGET_SECTION_CAPS[id] >= p.price && size(id) < SECTION_ROOM); |       const to = budget[0];
 * @mutate scripts/giftGuideBudgetCaps.mjs |     if (typeof src.price !== "number" \|\| src.price > cap) { |     if (false) {
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { describe, expect, it } from "vitest";
import { BUDGET_SECTION_CAPS, applyBudgetCaps } from "../../scripts/giftGuideBudgetCaps.mjs";

const DIR = "src/content/giftGuidePicks";
type Row = { name: string; href: string; price?: number; section?: string; sectionId?: string };
const chunks = readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => ({ slug: f.replace(/\.json$/, ""), picks: (JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")) as { picks: Row[] }).picks }));

describe("budget sections hold no pick over their cap (gg-live-1120)", () => {
  it("every priced pick in a budget section, on every guide, costs at most the section's cap", () => {
    let checked = 0;
    const over: string[] = [];
    for (const { slug, picks } of chunks) for (const p of picks) {
      const cap = BUDGET_SECTION_CAPS[p.sectionId ?? ""];
      if (cap == null || typeof p.price !== "number") continue;
      checked += 1;
      if (p.price > cap) over.push(`${slug}/${p.sectionId}: ${p.name} $${p.price} > $${cap}`);
    }
    expect(over).toEqual([]);
    expect(checked).toBeGreaterThan(30);
  });

  it("the live check's picks: no Rainbow Loom over $25 in Under $25, no Rare Beauty set in Stocking Stuffers", () => {
    const budget = chunks.find((c) => c.slug === "gifts-by-budget")!.picks;
    expect(budget.filter((p) => p.sectionId === "under-25" && /mighty loom|loomi-pals|malbon/i.test(p.name))).toEqual([]);
    expect(budget.filter((p) => p.sectionId === "stocking-stuffers" && /rare beauty blush, bronze/i.test(p.name))).toEqual([]);
  });

  it("moves an over-cap pick to the cheapest section that fits, drops one nothing fits, and refills only in budget", () => {
    const U25 = "under-25"; // a guide section id (not a saved_searches row)
    const row = (name: string, sectionId: string, price?: number) => ({ name, href: `https://x.test/${name}`, sectionId, section: sectionId.toUpperCase(), ...(price === undefined ? {} : { price }) });
    const pages: Record<string, Row[]> = {
      "gifts-by-budget": [row("a", "under-25", 20), row("loom", "under-25", 34.99), row("b", "stocking-stuffers", 30), row("set", "stocking-stuffers", 66.4), row("c", "under-50", 45), row("amazon", "under-25")],
      "store-x": [{ name: "cheap", href: "https://x.test/cheap", price: 9 }, { name: "dear", href: "https://x.test/dear", price: 31 }],
    };
    const t = applyBudgetCaps(pages, { adds: [
      { guide: "gifts-by-budget", section: U25, href: "https://x.test/cheap" },
      { guide: "gifts-by-budget", section: U25, href: "https://x.test/dear" },
    ] });
    const g = pages["gifts-by-budget"];
    expect(g.find((p) => p.name === "loom")?.sectionId).toBe("under-50");
    expect(g.some((p) => p.name === "set")).toBe(false);
    expect(g.find((p) => p.name === "cheap")?.sectionId).toBe("under-25");
    expect(g.some((p) => p.name === "dear")).toBe(false);
    expect(g.find((p) => p.name === "amazon")?.sectionId).toBe("under-25");
    expect(t.counts).toEqual({ moved: 1, out: 1, added: 1 });
    expect(t.missing.join(" ")).toMatch(/dear: price 31 over 25/);
  });
});
