/**
 * EVERYTHING STARTS OPEN (owner 2026-11-22, reviewing the live guides: "im having to click the drop downs for each
 * section a few times. instead of having them be collapsed just have all sections expanded when they are opened";
 * then "make everything open expanded. black friday, small business, cyber monday keep it all open").
 *
 * Two halves, one class (a collapsible that starts closed on a gift guide or Holiday Hub page):
 *  - the walk: every live guide page (LIVE_GUIDES_1121: Her, Him, Kids, the 25 Days sponsors page, Black Friday, Small
 *    Business Saturday, Cyber Monday), the guides landing, every relationship view of Her and Him and the Holiday Hub
 *    render with no closed <details>, no control saying aria-expanded="false" (menus and the search box excepted: they
 *    pop over, they fold nothing), no "+N more" / "See all deals" button, and every price section listing all its gifts;
 *  - the source inventory: every <details> and every show-all state in src/pages/info/giftGuides and
 *    src/pages/info/holidays reads the one shared default, START_OPEN (src/pages/info/giftGuides/startOpen.ts), so a page
 *    the walk does not reach cannot start closed either.
 *
 * @mutate src/pages/info/giftGuides/startOpen.ts | export const START_OPEN: boolean = true; | export const START_OPEN: boolean = false;
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   const isOpen = (id?: string) => !bandHeads \|\| !id \|\| (flipped.has(id) ? !START_OPEN : START_OPEN); |   const isOpen = (id?: string) => !bandHeads \|\| !id \|\| flipped.has(id);
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |   const isOpen = (id: string) => open[id] ?? START_OPEN; |   const isOpen = (id: string) => open[id] ?? id === "deals";
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx |   const [all, setAll] = useState(START_OPEN);\n  const shown = all ? sales : sales.slice(0, SALE_LINES); |   const [all, setAll] = useState(false);\n  const shown = all ? sales : sales.slice(0, SALE_LINES);
 * @mutate src/pages/info/holidays/holidayParts.tsx |   const [open, setOpen] = useState(START_OPEN); |   const [open, setOpen] = useState(false);
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

// The Small Business Saturday page reads the free approved listings (SmallBizLocal); never the network in a unit test.
vi.mock("@/lib/sbsFeaturedApi", () => ({ listFeaturedLocal: async () => [], sbsLogoUrl: () => "" }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null }) }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import HolidayHub from "@/pages/info/holidays/HolidayHub";
import { LIVE_GUIDES_1121 } from "@/content/giftGuideLive.mjs";
import { DEAL_DAY_SLUGS } from "@/content/giftGuideDeals.mjs";
import { RELATION_PAGES } from "@/content/giftGuidePeople.mjs";
import { loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { START_OPEN } from "@/pages/info/giftGuides/startOpen";

await loadAllGuidePicks();
const ROOT = resolve(__dirname, "..", "..");
afterEach(() => { cleanup(); vi.useRealTimers(); });

const renderAt = async (url: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
  let out!: ReturnType<typeof render>;
  await act(async () => {
    out = render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/gift-guides" element={<GiftGuides />} />
          <Route path="/gift-guides/:slug" element={<GiftGuides />} />
          <Route path="/holidays" element={<HolidayHub />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return out.container;
};

/** Every place on the page that is folded shut on arrival (an empty list = nothing collapsed). */
function closedOnLoad(c: HTMLElement): string[] {
  const out: string[] = [];
  for (const d of c.querySelectorAll<HTMLDetailsElement>("details")) {
    // The guides menu's Kids row folds its themed guides off Kids (owner 2026-11-24 ~7:50 PM: "like when you click Kids
    // they expand down"; giftGuideSideThemes1124): menu navigation, it folds no page content away.
    if (d.closest("[data-gift-sidebar], [data-gift-menu-sheet]")) continue;
    if (!d.open) out.push(`closed <details> "${d.querySelector("summary")?.textContent?.trim()}"`);
  }
  for (const b of c.querySelectorAll<HTMLElement>('[aria-expanded="false"]')) {
    // A menu or a search box (the guides' and the Holiday Hub's) pops over the page; it folds no content away.
    if (b.hasAttribute("aria-haspopup") || b.hasAttribute("data-gift-search-button") || b.getAttribute("role") === "combobox" || /^search\b/i.test(b.getAttribute("aria-label") ?? "")) continue;
    out.push(`aria-expanded=false on "${b.textContent?.trim() || b.getAttribute("aria-label")}"`);
  }
  for (const m of c.querySelectorAll("[data-gift-code-more], [data-gift-sale-more], [data-gift-all-deals]")) out.push(`"${m.textContent?.trim()}" button`);
  return out;
}

const GUIDE_URLS = ["/gift-guides", ...LIVE_GUIDES_1121.map((s) => `/gift-guides/${s}`)];
const RELATION_URLS = Object.keys(RELATION_PAGES).map((slug) => `/gift-guides/${slug}`);

describe("every gift guide and Holiday Hub page opens with everything expanded (owner 2026-11-22)", () => {
  it("the shared default is open", () => {
    expect(START_OPEN).toBe(true);
  });

  it.each(GUIDE_URLS)("%s: nothing collapsed on load", async (url) => {
    const c = await renderAt(url);
    const slug = url.split("/")[2] ?? "";
    // A deals day loads its own chunk (lazy, off the guide pages' critical path): wait for its sections.
    if ((DEAL_DAY_SLUGS as readonly string[]).includes(slug)) await waitFor(() => expect(c.querySelector("[data-gift-deal-day-page]"), url).not.toBeNull());
    if (slug === "black-friday" || slug === "cyber-monday") await waitFor(() => expect(c.querySelectorAll("section[data-gift-deal-sub]").length, url).toBeGreaterThan(1));
    expect(closedOnLoad(c), url).toEqual([]);
  });

  it("Her, Him and Kids: every price section is open on load with all its gifts, and one tap closes it (one tap opens it again)", async () => {
    let sections = 0;
    for (const slug of ["her", "him", "kids"]) {
      const c = await renderAt(`/gift-guides/${slug}`);
      const toggles = [...c.querySelectorAll<HTMLButtonElement>("[data-gift-section-toggle]")];
      expect(toggles.length, slug).toBeGreaterThan(2);
      for (const t of toggles) {
        const id = t.getAttribute("data-gift-section-toggle")!;
        const count = Number(/\((\d+)\)/.exec(t.textContent ?? "")![1]);
        expect(t.getAttribute("aria-expanded"), `${slug} ${id}`).toBe("true");
        expect(c.querySelectorAll(`#gg-sec-${id}-list > li[data-gift-pick]`).length, `${slug} ${id}`).toBe(count);
        sections++;
      }
      const t = toggles[1];
      const id = t.getAttribute("data-gift-section-toggle")!;
      await act(async () => { fireEvent.click(t); });
      expect(t.getAttribute("aria-expanded")).toBe("false");
      expect(c.querySelector(`#gg-sec-${id}-list`)).toBeNull();
      await act(async () => { fireEvent.click(t); });
      expect(t.getAttribute("aria-expanded")).toBe("true");
      expect(c.querySelector(`#gg-sec-${id}-list`)).not.toBeNull();
      cleanup();
    }
    expect(sections).toBeGreaterThan(10);
  });

  it("a price-section link (#25-to-50) still leaves every section open", async () => {
    window.history.replaceState(null, "", "#25-to-50");
    const c = await renderAt("/gift-guides/kids");
    window.history.replaceState(null, "", window.location.pathname);
    const toggles = [...c.querySelectorAll("[data-gift-section-toggle]")];
    expect(toggles.length).toBeGreaterThan(2);
    expect(toggles.filter((b) => b.getAttribute("aria-expanded") !== "true")).toEqual([]);
  });

  it("every relationship view of Her and Him (/mom, /dad ...) opens with everything expanded", async () => {
    expect(RELATION_URLS.length).toBeGreaterThan(5);
    for (const url of RELATION_URLS) {
      const c = await renderAt(url);
      expect(closedOnLoad(c), url).toEqual([]);
      cleanup();
    }
  });

  it("the deals days list every code and every sale of a store (no \"+N more\")", async () => {
    let extras = 0;
    for (const slug of ["black-friday", "cyber-monday"]) {
      const c = await renderAt(`/gift-guides/${slug}`);
      await waitFor(() => expect(c.querySelectorAll("section[data-gift-deal-sub]").length, slug).toBeGreaterThan(1));
      // Owner 2026-11-22: each subsection is a guide section; open = its header button says aria-expanded="true".
      for (const d of c.querySelectorAll<HTMLElement>("section[data-gift-deal-sub]")) expect(d.querySelector("button[data-gift-deal-toggle]")?.getAttribute("aria-expanded"), `${slug} ${d.getAttribute("data-gift-deal-sub")}`).toBe("true");
      extras += c.querySelectorAll("[data-gift-code-extra]").length;
      cleanup();
    }
    // Stores with more than one code show the others right away (Bonheur Jewelry had three).
    expect(extras).toBeGreaterThan(0);
  });

  it("/holidays: every band section (the chosen day, then Dates not announced yet) starts open", async () => {
    const c = await renderAt("/holidays");
    // Consistency audit 1122 #3: the Hub's sections are the guides' band headers (aria-expanded buttons), not <details>.
    // Polish audit 11-27 #15: the two undated bands are one, so the day's band plus that one.
    const bands = [...c.querySelectorAll<HTMLElement>("[data-holiday-section-toggle]")];
    expect(bands.length).toBeGreaterThan(1);
    expect(bands.every((b) => b.getAttribute("aria-expanded") === "true")).toBe(true);
    expect(closedOnLoad(c)).toEqual([]);
  });
});

describe("source inventory: every collapsible under the guides and the Holiday Hub reads START_OPEN", () => {
  const files = (dir: string): string[] =>
    readdirSync(join(ROOT, dir), { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)).map((f) => join(dir, f));
  const all = [...files("src/pages/info/giftGuides"), ...files("src/pages/info/holidays"), "src/pages/info/GiftGuides.tsx"];
  const src = (f: string) => blankComments(readFileSync(join(ROOT, f), "utf8"));

  it("every <details> sets open from START_OPEN (directly or through the page's own open state)", () => {
    expect(all.length).toBeGreaterThan(30);
    const details: string[] = [];
    for (const f of all) for (const m of src(f).matchAll(/<details\b[^>]*>/g)) details.push(`${f}: ${m[0]}`);
    // None left: the deals days' subsections (owner 2026-11-22) and the Holiday Hub's sections (consistency audit 1122 #3)
    // are guide band sections with a header button now, checked in the walk above, by the open[id] ?? START_OPEN line
    // below and by the Hub's band open state below. A <details> added later must still read START_OPEN.
    expect(details.length).toBeGreaterThanOrEqual(0);
    // The one exception: the guides menu's Kids row (owner 2026-11-24 ~7:50 PM: the themed guides "show as subsections
    // of kids in the left, like when you click Kids they expand down"), open on Kids and the theme pages only.
    const MENU_KIDS = "src/pages/info/giftGuides/GiftGuidesSidebar.tsx: <details open={onKids}>";
    expect(details).toContain(MENU_KIDS);
    const bad = details.filter((d) => d !== MENU_KIDS && !/\bopen=\{(START_OPEN|isOpen\()/.test(d));
    expect(bad).toEqual([]);
    // The deals page's own open state falls back to START_OPEN.
    expect(src("src/pages/info/giftGuides/GiftGuideDeals.tsx")).toContain("open[id] ?? START_OPEN");
    // The Holiday Hub's band sections (HolidaySection) start at START_OPEN.
    expect(src("src/pages/info/holidays/holidayParts.tsx")).toContain("const [open, setOpen] = useState(START_OPEN);");
  });

  it("every show-all list state (\"+N more\", \"See all deals\") starts at START_OPEN", () => {
    const states: string[] = [];
    for (const f of all) for (const m of src(f).matchAll(/const \[(all|showAll|more|seeAll|expanded), set\w+\] = useState(?:<[^>]*>)?\(([^)]*)\)/g)) states.push(`${f}: ${m[1]} = ${m[2]}`);
    expect(states.length).toBeGreaterThan(2);
    expect(states.filter((s) => !s.endsWith("= START_OPEN"))).toEqual([]);
  });
});
