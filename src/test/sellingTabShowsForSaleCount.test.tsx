/**
 * Owner request 11-05: "add the number next to sell so I can see how many items I'm selling". Declutter's Selling tab
 * shows how many of the member's listings are live (for sale); its to-dos stay visible as a dot beside it (and are
 * still counted by the row's chevrons through data-tab-count). The same rule (liveListingCount) feeds Home's
 * "You're selling" line, so the two never disagree.
 *
 * @mutate src/components/declutter/DeclutterHomeView.tsx | quiet: forSale, count: | count:
 * @mutate src/components/declutter/DeclutterHomeView.tsx | l.value === "selling" ? { ...l, countAsDot: true } : l | l
 * @mutate src/lib/declutter/liveListingCount.ts | i.status === "live" | i.status !== "withdrawn"
 * @mutate src/components/sections/SectionTabs.tsx | {o.countAsDot && o.count !== undefined && o.count > 0 && ( | {false && (
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts | selling: liveListingCount(items), | selling: items.length,
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "@/test/helpers/blankNonCode";
import { SectionTabs } from "@/components/sections/SectionTabs";
import { liveListingCount } from "@/lib/declutter/liveListingCount";

vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));

const ROOT = join(__dirname, "..", "..");
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

const mount = (count: number | undefined, quiet: number | undefined) =>
  render(
    <MemoryRouter>
      <SectionTabs label="Declutter" value="selling" onChange={() => {}}
        tabs={[{ value: "buying", label: "Buying", count: 2 }, { value: "selling", label: "Selling", quiet, count, countAsDot: true }]} />
    </MemoryRouter>,
  );

describe("Selling tab: how many items are for sale, to-dos as a dot", () => {
  it("counts only live listings", () => {
    const items = ["live", "live", "paused", "pending_review", "sold", "withdrawn", "draft", "live"].map((status) => ({ status }));
    expect(liveListingCount(items)).toBe(3);
    expect(liveListingCount([])).toBe(0);
  });

  it("shows the for-sale number plainly and the to-dos as a dot that still feeds the chevrons", () => {
    const { container } = mount(4, 12);
    const tab = container.querySelector('[data-section-tab="selling"]') as HTMLElement;
    expect(tab.querySelector('[data-testid="tab-quiet-count"]')?.textContent).toBe("12");
    expect(tab.querySelector('[data-testid="tab-todo-dot"]')).not.toBeNull();
    expect(tab.textContent).toContain("4 to do");
    // The to-do number is not drawn as a second pill.
    expect(tab.querySelector(".segmented-count-attention")).toBeNull();
    expect(tab.getAttribute("data-tab-count")).toBe("4");
    // A tab without countAsDot keeps its pill.
    const buying = container.querySelector('[data-section-tab="buying"]') as HTMLElement;
    expect(buying.querySelector(".segmented-count-attention")?.textContent).toBe("2");
    expect(screen.getAllByRole("tab").length).toBeGreaterThan(2);
  });

  it("no to-dos: no dot; nothing for sale: no number", () => {
    const { container } = mount(0, 0);
    const tab = container.querySelector('[data-section-tab="selling"]') as HTMLElement;
    expect(tab.querySelector('[data-testid="tab-todo-dot"]')).toBeNull();
    expect(tab.querySelector('[data-testid="tab-quiet-count"]')).toBeNull();
  });

  it("Declutter's Selling tab and Home's selling line read the same rule", () => {
    const home = code("src/components/declutter/DeclutterHomeView.tsx");
    // One list row feeds both the desktop tabs (Selling's to-dos as a dot) and the phone's My Declutter sheet (the
    // Vinted header, owner 11-08: the same quiet for-sale number beside the row).
    // Owner 11-11 (F363/F396): its to-do dot is the Home To-do Selling count (declutterBadgesReadHomeTodo.test.tsx).
    expect(home).toMatch(/\{ value: "selling", label: "Selling", labelKey: "decl\.tab\.selling", quiet: forSale, count: needsYou\.declutterSelling \}/);
    expect(home).toContain('const tabDefs = lists.map((l) => l.value === "selling" ? { ...l, countAsDot: true } : l);');
    expect(home.match(/tabs=\{tabDefs\}/g)?.length, "desktop and (F153) phone rows").toBe(2);
    expect(home).toContain("count: l.count, quiet: l.quiet }))");
    expect(home).toMatch(/const forSale = mineForCount\.data \? liveListingCount\(mineForCount\.data\) : undefined;/);
    expect(code("src/pages/home/homeDashboard/useHomeSummary.ts")).toContain("selling: liveListingCount(items),");
  });
});
