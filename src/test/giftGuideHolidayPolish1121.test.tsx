/**
 * Holiday gift guides audit 1121, the Medium / Low / Suggestion findings (Audit-Holiday-Guides-1121.json). One guard
 * per class, each shown red on the broken state:
 *   - the landing's head and pre-JS body name only what is live (they promised budget, career and store guides);
 *   - search matches word starts (not the inside of words) and every meaning-word points to a live guide.
 *
 * @mutate src/lib/publicPageMeta.mjs |     description: "Gift ideas for her, him and the kids from Louisiana Helpr, every pick with its price and sorted by budget.", |     description: "Gift ideas for everyone on your list, from Louisiana Helpr: by person, budget, career and store, plus Louisiana favorites.",
 * @mutate src/content/giftGuideCatalog.ts |   if (w.length >= 5) return hay.includes(w); |   return hay.includes(w);
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |   const pages = query.trim() ? searchPages(query) : []; |   const pages: { to: string; title: string; tint: string }[] = [];
 * @mutate src/content/giftGuideCatalog.ts |     budgetSlugs.push("her", "him", "kids"); |     budgetSlugs.push();
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |       {!guide.children && guide.picks.length === 0 && ( |       {!guide.children && guide.picks.length === 0 && guide.links.length === 0 && (
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   const banded = guide.picks.filter((p) => p.band !== undefined && showsPrice(p)).length; |   const banded = guide.picks.filter((p) => p.band !== undefined).length;
 * @mutate src/content/giftGuideShipping.ts |   instant: "Too late to ship? Print a free gift tag or coloring book today", |   instant: "Last-minute? Gift cards and digital gifts arrive instantly",
 * @mutate src/content/giftGuideShipping.ts |   if (month !== 12) return null; |   if (month !== 12) return SHIP_LINES.early;
 * @mutate src/pages/info/GiftGuides.tsx | <GiftGuidesSidebar active={guide} myList={myList \|\| shared} page= | <GiftGuidesSidebar active={guide} myList={myList} page=
 * @mutate src/pages/info/GiftGuides.tsx |   if (rawSlug && rawSlug !== rawSlug.toLowerCase()) return | if (false) return
 * @mutate src/pages/info/giftGuides/GiftGuideDealsAndCodes.tsx |       <h2 className="gg-deals-sub">{G.codesLabel}</h2> |       <h3 className="gg-deals-sub">{G.codesLabel}</h3>
 * @mutate src/pages/info/giftGuides/GiftGuideCover.tsx |             <h1 id={titleId}><span className="sr-only">{lead}</span>{" "}{title}</h1> |             <h1 id={titleId}>{title}</h1>
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { FUN_WORDS } from "@/content/giftGuideFun1120";
import { SHIP_LINES, shippingLine } from "@/content/giftGuideShipping";
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
import GiftGuides from "@/pages/info/GiftGuides";
import { GiftGuideView } from "@/pages/info/giftGuides/GiftGuideView";
import { GiftGuideTools } from "@/pages/info/giftGuides/GiftGuideShare";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { giftGuidesLandingBody } from "@/lib/seoBodies.mjs";
import { SEARCH_SYNONYMS, guideBySlug, loadAllGuidePicks, searchGuides, searchItems, searchPages, type SearchItem } from "@/content/giftGuideCatalog";
import INDEX from "@/content/giftGuideSearchIndex.json";

afterEach(cleanup);
/** Words naming a retired guide family. */
const RETIRED_WORDS = /\b(careers?|by store|store pages?|budget guides?|louisiana favorites|louisiana-made|grandma|fishermen)\b/i;

describe("the landing's head names only the live guides (holiday audit 1121)", () => {
  it("description, share description and the pre-JS body promise no retired guide family", () => {
    const m = PUBLIC_PAGE_META["/gift-guides"];
    for (const text of [m.description, m.ogDescription, giftGuidesLandingBody([])]) {
      expect(text).toMatch(/her, him and the kids/);
      expect(text, text).not.toMatch(RETIRED_WORDS);
    }
  });
});

describe("gift guide search (holiday audit 1121)", () => {
  const titles = (q: string) => searchGuides(q).map((g) => g.slug);
  it("matches word starts, never the inside of a word: 'her' finds no Brother, 'teen' no Steens", async () => {
    await loadAllGuidePicks();
    expect(titles("her")[0]).toBe("her");
    expect(titles("her")).not.toEqual(expect.arrayContaining(["brother", "dad", "him"]));
    const items = INDEX as SearchItem[];
    expect(items.length).toBeGreaterThan(100); // inventory floor: the live lists' items
    expect(searchItems(items, "teen", 20).filter(([n]) => /steens/i.test(n))).toEqual([]);
    expect(searchItems(items, "her", 50).filter(([, g]) => g === "him")).toEqual([]);
  });
  it("a budget, 'cheap', 'hunting', 'grandma' and a kid's age each open a live guide", async () => {
    await loadAllGuidePicks();
    for (const q of ["under $25", "under 50", "cheap", "stocking stuffers", "hunting", "grandma", "4 year old niece"]) {
      expect(titles(q).length, q).toBeGreaterThan(0);
    }
    expect(titles("under $25")).toEqual(expect.arrayContaining(["her", "him", "kids"]));
  });
  it("the deals days and Shop Small are found by their words ('deals', 'black friday', 'codes', 'shop small')", () => {
    const to = (q: string) => searchPages(q).map((p) => p.to);
    expect(to("deals")).toEqual(expect.arrayContaining(["/gift-guides/black-friday", "/gift-guides/cyber-monday"]));
    expect(to("black friday")).toEqual(["/gift-guides/black-friday"]);
    expect(to("cyber monday")).toEqual(["/gift-guides/cyber-monday"]);
    expect(to("codes").length).toBeGreaterThan(0);
    expect(to("shop small")).toContain("/shop-small");
    expect(to("small business")).toContain("/gift-guides/small-business-saturday");
    expect(to("leggings")).toEqual([]);
    // The search box lists them instead of "No guides match".
    const { container } = render(<MemoryRouter><GiftGuideTools path="/gift-guides" title="t" many /></MemoryRouter>);
    // Owner 11-21 ("make search an icon always"): the field opens from the magnifier.
    fireEvent.click(container.querySelector("[data-gift-search-button]")!);
    fireEvent.change(container.querySelector("[data-gift-search]")!, { target: { value: "black friday" } });
    expect(container.querySelector('[data-gift-found-page="/gift-guides/black-friday"]')).not.toBeNull();
  });
  it("every synonym points only to live guides (and the menu's fun tools carry the pages' own names)", () => {
    expect(FUN_WORDS.tools.find((t) => t.to === "/gift-guides/draw-names")?.title).toBe(FUN_WORDS.santaTitle);
    expect(SEARCH_SYNONYMS.length).toBeGreaterThan(5);
    const dead = SEARCH_SYNONYMS.flatMap((s) => s.slugs.filter((slug) => { const g = guideBySlug(slug); return !g || g.empty; }));
    expect(dead).toEqual([]);
  });
});

describe("heading order never skips a level (holiday audit 1121: h1 then h3 on the guides, deals and sponsors pages)", () => {
  it("Her, a relationship view, the sponsors page and a deals day go h1, h2, h3 without a jump", async () => {
    await loadAllGuidePicks();
    for (const path of ["/gift-guides/her", "/gift-guides/wife", "/gift-guides/25-days-sponsors", "/gift-guides/black-friday"]) {
      const { container } = renderAt(path);
      if (path.endsWith("black-friday")) await waitFor(() => expect(document.querySelector("[data-gift-deal]")).not.toBeNull());
      const levels = [...container.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => Number(h.tagName[1]));
      expect(levels.length, path).toBeGreaterThan(1);
      expect(levels[0], path).toBe(1);
      // The h1 carries the lead: "gifts for Her", not just "Her" (the lead's drawn copy is aria-hidden).
      if (path.endsWith("/her")) expect(screen.getByRole("heading", { level: 1, name: "gifts for Her" })).toBeTruthy();
      const jumps = levels.flatMap((l, i) => (i > 0 && l > levels[i - 1] + 1 ? [`h${levels[i - 1]}→h${l}`] : []));
      expect(jumps, path).toEqual([]);
      cleanup();
    }
  });
});

describe("budget chips need prices a shopper can see (holiday audit 1121)", () => {
  it("the sponsors page shows its budget chips while its prices show, and none once they have aged out", async () => {
    await loadAllGuidePicks();
    vi.useFakeTimers({ toFake: ["Date"] });
    const chips = (iso: string) => {
      vi.setSystemTime(new Date(iso));
      const { container } = renderAt("/gift-guides/25-days-sponsors");
      const has = container.querySelector("[data-gift-budget]") !== null;
      cleanup();
      return has;
    };
    expect(chips("2026-11-22T18:00:00Z")).toBe(true);
    expect(chips("2027-02-01T18:00:00Z")).toBe(false);
    vi.useRealTimers();
  });
});

describe("an empty view says so (holiday audit 1121)", () => {
  it("a relationship view whose filter leaves no items shows the coming-soon note, even with an old collection link", async () => {
    await loadAllGuidePicks();
    const mom = guideBySlug("mom")!;
    expect(mom.links.length).toBeGreaterThan(0); // the old ShopMy collection link that hid the note
    const { container } = render(<MemoryRouter><GiftGuideView guide={{ ...mom, picks: [] }} /></MemoryRouter>);
    expect(container.querySelector("[data-gift-coming-soon]")).not.toBeNull();
  });
});

describe("the shipping pill (holiday audit 1121)", () => {
  const at = (iso: string) => new Date(iso);
  it("shows only Nov 1 through Dec 25 (it came back every January)", () => {
    expect(shippingLine(at("2027-01-15T18:00:00Z"))).toBeNull();
    expect(shippingLine(at("2027-06-15T18:00:00Z"))).toBeNull();
    expect(shippingLine(at("2026-11-01T18:00:00Z"))).toBe(SHIP_LINES.early);
    // Owner 2026-11-21: "Just don't mention gift cards." (they left the guides 11-20).
    expect(Object.values(SHIP_LINES).filter((l) => /gift card/i.test(l))).toEqual([]);
  });
});

function Where() {
  const { pathname, search, hash } = useLocation();
  return <p data-test-where="">{pathname + search + hash}</p>;
}
const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides" element={<><GiftGuides /><Where /></>} />
        <Route path="/gift-guides/:slug" element={<><GiftGuides /><Where /></>} />
        <Route path="/gift-guides/list/:code" element={<><GiftGuides /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
const where = (c: HTMLElement) => c.querySelector("[data-test-where]")?.textContent;

describe("gift guide addresses and the menu (holiday audit 1121)", () => {
  it("a capitalised slug opens its guide; the old #gift-codes anchor opens the codes on the deals day", () => {
    expect(where(renderAt("/gift-guides/HER").container)).toBe("/gift-guides/her");
    cleanup();
    expect(where(renderAt("/gift-guides#gift-codes").container)).toBe("/gift-guides/black-friday#gift-codes");
  });
  it("someone's shared list marks no menu entry as the current page", () => {
    const { container } = renderAt("/gift-guides/list/abcdef0123");
    expect(container.querySelector("[data-gift-sidebar]")).not.toBeNull();
    expect(container.querySelectorAll('[data-gift-sidebar] a[aria-current="page"]').length).toBe(0);
  });
});
