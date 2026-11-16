/**
 * PHONE TABS AND CHIPS SLIDE AWAY ON SCROLL (owner 11-14, Depop/Vinted audit item 5: "search sticky; chips hide on scroll
 * down, return on scroll up"). On Jobs Browse and Declutter Browse the one-row top bar stays; the tabs and chips rows under
 * it slide up behind it after 8px of scrolling down and come back after 8px up, by transform only (the list never
 * moves), always shown at the top, never hidden under reduced motion, unchanged on the desktop website (ScrollAway.tsx).
 *
 *  1. The direction rule (nextScrollAway): threshold, the top, iOS's bounce past the end.
 *  2. Rendered (jsdom, a phone): the rows overlay the list by exactly their height, the spacer holds that height, and a
 *     real scroll event on the element that holds the spacer hides and shows them; other scrollers, reduced motion and
 *     focus inside them never leave them hidden; the desktop website draws the rows plainly.
 *  3. Wired: Jobs Browse (rows in JobsSection's phone header, the scope round its Browse page, the spacer first in the
 *     feed's scroll box, the title card no longer clipping them) and Declutter Browse (rows in the phone chrome, the
 *     spacer first in SectionScreen's scroll column).
 * Measured (local dev, 390x844, Chromium, ~/.lh-shots/scroll-chips-1114/): Jobs tabs at y 58 before and after; after
 * 600px of scrolling down at -35 (slid 93px, clipped), after 120px back up at 58 again. Declutter the same (97px rows).
 *
 * @mutate src/components/sections/ScrollAway.tsx |   if (top <= 0) return { hidden: false, anchor: 0 }; |   if (top <= 0) return { hidden, anchor: 0 };
 * @mutate src/components/sections/ScrollAway.tsx |   if (top > max) return { hidden, anchor }; |
 * @mutate src/components/sections/ScrollAway.tsx | export const SCROLL_AWAY_THRESHOLD = 8; | export const SCROLL_AWAY_THRESHOLD = 80;
 * @mutate src/components/sections/ScrollAway.tsx |       if (!el \|\| !el.contains(spacer)) return; |       if (!el) return;
 * @mutate src/components/sections/ScrollAway.tsx |     if (!overlay \|\| !spacer \|\| prefersReducedMotion()) { |     if (!overlay \|\| !spacer) {
 * @mutate src/components/sections/ScrollAway.tsx |       style={overlay ? { marginBottom: -scope!.height } : undefined} |       style={undefined}
 * @mutate src/components/sections/ScrollAway.tsx |       onFocusCapture={() => setHidden(false)} |
 * @mutate src/components/sections/ScrollAway.tsx |   if (desktop) return <>{children}</>; |
 * @mutate src/components/declutter/DeclutterHomeView.tsx |         <ScrollAwayRows off={!browse}>{browse?.chips}</ScrollAwayRows> |         <ScrollAwayRows>{browse?.chips}</ScrollAwayRows>
 * @mutate src/components/declutter/DeclutterHomeView.tsx |         <SectionTabs label={t("decl.hv.view")} value={view} onChange={goTab} tabs={tabDefs} />\n        <ScrollAwayRows off={!browse}>{browse?.chips}</ScrollAwayRows> |         <ScrollAwayRows off={!browse}><SectionTabs label={t("decl.hv.view")} value={view} onChange={goTab} tabs={tabDefs} />{browse?.chips}</ScrollAwayRows>
 * @mutate src/components/sections/ScrollAwayScope.tsx |   if (!scope?.rows) return null; |   if (!scope) return null;
 * @mutate src/components/sections/SectionScreen.tsx |           <ScrollAwaySpacer />\n |\n
 * @mutate src/components/dashboard/BrowseTasksFeed.tsx |         top={view === "map" ? undefined : <ScrollAwaySpacer />} |
 * @mutate src/pages/jobs/JobsSection.tsx |           <ScrollAwayRows>{tab === "browse" && browse?.chips}</ScrollAwayRows> |           <ScrollAwayRows><SectionTabs label={tr("jobs.tabsLabel")} tabs={JOBS_TABS} value={tab} onChange={onTab} />{tab === "browse" && browse?.chips}</ScrollAwayRows>
 * @mutate src/pages/jobs/JobsSection.tsx |   return <><ScrollAwayScope><Dashboard embeddedHeader={makeHeader} /></ScrollAwayScope>{fab}</>; |   return <><Dashboard embeddedHeader={makeHeader} />{fab}</>;
 * @mutate src/pages/home/Dashboard.tsx |       titleCardClassName={isWebDesktop ? "" : "!overflow-visible z-10"} |       titleCardClassName=""
 * @mutate src/components/declutter/DeclutterGuestHome.tsx |   } : { search: browse.search, tabs: <ScrollAwayRows>{browse.chips}</ScrollAwayRows> }; |   } : { search: browse.search, tabs: browse.chips };
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { ScrollAwayRows, ScrollAwayScope, ScrollAwaySpacer, SCROLL_AWAY_THRESHOLD, nextScrollAway } from "@/components/sections/ScrollAway";

const ROOT = join(__dirname, "..", "..");
const code = (f: string) => blankComments(readFileSync(join(ROOT, f), "utf8"));

describe("1. the direction rule", () => {
  it("hides after 8px down, shows after 8px up, measured from the furthest point; the top always shows; a bounce past the end changes nothing", () => {
    expect(SCROLL_AWAY_THRESHOLD).toBe(8);
    expect(nextScrollAway(7, 1000, 0, false)).toEqual({ hidden: false, anchor: 0 });
    expect(nextScrollAway(8, 1000, 0, false)).toEqual({ hidden: true, anchor: 8 });
    expect(nextScrollAway(400, 1000, 8, true)).toEqual({ hidden: true, anchor: 400 });
    expect(nextScrollAway(393, 1000, 400, true)).toEqual({ hidden: true, anchor: 400 });
    expect(nextScrollAway(392, 1000, 400, true)).toEqual({ hidden: false, anchor: 392 });
    expect(nextScrollAway(100, 1000, 392, false)).toEqual({ hidden: false, anchor: 100 });
    expect(nextScrollAway(0, 1000, 100, true)).toEqual({ hidden: false, anchor: 0 });
    expect(nextScrollAway(-30, 1000, 100, true), "iOS rubber band at the top").toEqual({ hidden: false, anchor: 0 });
    expect(nextScrollAway(1040, 1000, 1000, true), "iOS bounce past the end").toEqual({ hidden: true, anchor: 1000 });
    expect(nextScrollAway(1040, 1000, 1000, false)).toEqual({ hidden: false, anchor: 1000 });
  });
});

const ROWS_H = 93;
let reduce = false;
let desktop = false;
const realMatchMedia = window.matchMedia;
const realOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

beforeEach(() => {
  reduce = false;
  desktop = false;
  window.matchMedia = ((q: string) => ({
    matches: q.includes("reduced-motion") ? reduce : q.includes("min-width: 900px") ? desktop : false,
    media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return (this as HTMLElement).hasAttribute("data-scroll-away") ? ROWS_H : 0; } });
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
  if (realOffset) Object.defineProperty(HTMLElement.prototype, "offsetHeight", realOffset);
});

function screen(withSpacer = true) {
  const r = render(
    <ScrollAwayScope>
      <header>
        <div data-testid="bar">top bar</div>
        <ScrollAwayRows><div role="tablist"><button>Browse</button></div><div data-testid="chips">chips</div></ScrollAwayRows>
      </header>
      <div data-testid="list" style={{ overflowY: "auto" }}>
        {withSpacer && <ScrollAwaySpacer />}
        <p>rows</p>
      </div>
      <div data-testid="other" style={{ overflowY: "auto" }}><p>a sheet</p></div>
    </ScrollAwayScope>,
  );
  const list = r.getByTestId("list");
  Object.defineProperty(list, "scrollHeight", { configurable: true, value: 3000 });
  Object.defineProperty(list, "clientHeight", { configurable: true, value: 700 });
  const rows = r.container.querySelector<HTMLElement>("[data-scroll-away]");
  const scrollTo = (el: HTMLElement, top: number) => act(() => { el.scrollTop = top; fireEvent.scroll(el); });
  return { r, list, rows, scrollTo };
}

describe("2. rendered on a phone", () => {
  it("the rows overlay the list by their own height and the spacer holds exactly that, so nothing moves at rest", () => {
    const { rows, r } = screen();
    expect(rows).not.toBeNull();
    expect(rows!.style.marginBottom).toBe(`-${ROWS_H}px`);
    expect(r.container.querySelector<HTMLElement>("[data-scroll-away-spacer]")!.style.height).toBe(`${ROWS_H}px`);
    // The outer box clips and lets taps through; the inner one takes taps and carries the page canvas.
    expect(rows!.className).toMatch(/\boverflow-hidden\b/);
    expect(rows!.className).toMatch(/\bpointer-events-none\b/);
    expect((rows!.firstElementChild as HTMLElement).className).toMatch(/\bpointer-events-auto\b/);
    expect((rows!.firstElementChild as HTMLElement).className).toMatch(/\bbg-premium-page\b/);
    expect((rows!.firstElementChild as HTMLElement).style.transform).toBe("");
  });

  it("scrolling the list down hides them (a transform), scrolling up or reaching the top shows them", () => {
    const { list, rows, scrollTo } = screen();
    const inner = () => (rows!.firstElementChild as HTMLElement).style.transform;
    scrollTo(list, 5);
    expect(rows!.hasAttribute("data-hidden")).toBe(false);
    scrollTo(list, 300);
    expect(rows!.hasAttribute("data-hidden")).toBe(true);
    expect(inner()).toBe("translateY(-100%)");
    expect(rows!.style.marginBottom, "hiding never changes layout").toBe(`-${ROWS_H}px`);
    scrollTo(list, 295);
    expect(rows!.hasAttribute("data-hidden")).toBe(true);
    scrollTo(list, 280);
    expect(rows!.hasAttribute("data-hidden")).toBe(false);
    expect(inner()).toBe("");
    scrollTo(list, 900);
    expect(rows!.hasAttribute("data-hidden")).toBe(true);
    scrollTo(list, 0);
    expect(rows!.hasAttribute("data-hidden")).toBe(false);
  });

  it("only the element holding the spacer counts; focus inside the rows brings them back", () => {
    const { r, list, rows, scrollTo } = screen();
    const other = r.getByTestId("other");
    Object.defineProperty(other, "scrollHeight", { configurable: true, value: 3000 });
    Object.defineProperty(other, "clientHeight", { configurable: true, value: 300 });
    scrollTo(other, 500);
    expect(rows!.hasAttribute("data-hidden")).toBe(false);
    scrollTo(list, 500);
    expect(rows!.hasAttribute("data-hidden")).toBe(true);
    act(() => { r.getByRole("button", { name: "Browse" }).focus(); });
    expect(rows!.hasAttribute("data-hidden")).toBe(false);
  });

  it("reduced motion: they stay put", () => {
    reduce = true;
    const { list, rows, scrollTo } = screen();
    scrollTo(list, 600);
    expect(rows!.hasAttribute("data-hidden")).toBe(false);
  });

  it("with no spacer (Posted, Working, a loading frame, another tab) the rows sit in the flow and never hide", () => {
    const { list, rows, scrollTo } = screen(false);
    expect(rows!.style.marginBottom).toBe("");
    scrollTo(list, 600);
    expect(rows!.hasAttribute("data-hidden")).toBe(false);
  });

  it("`off` (a Declutter tab other than Browse) draws the rows as they are", () => {
    const r = render(<ScrollAwayScope><header><ScrollAwayRows off><div data-testid="chips">chips</div></ScrollAwayRows></header><div><ScrollAwaySpacer /></div></ScrollAwayScope>);
    expect(r.container.querySelector("[data-scroll-away]")).toBeNull();
    expect(r.container.querySelector("[data-scroll-away-spacer]")).toBeNull();
  });

  it("the desktop website draws the rows as they are", () => {
    desktop = true;
    const { rows, r } = screen();
    expect(rows).toBeNull();
    expect(r.getByTestId("chips").parentElement!.tagName).toBe("HEADER");
    expect(r.container.querySelector("[data-scroll-away-spacer]"), "no spacer without the phone rows").toBeNull();
  });
});

describe("3. wired into Jobs Browse and Declutter Browse", () => {
  it("Jobs: the tabs stay pinned (M14) and only the chips slide, the scope wraps Browse, the feed draws the spacer first, the title card lets the rows overlay", () => {
    const jobs = code("src/pages/jobs/JobsSection.tsx");
    // M14 (owner 11-16): the Browse | Posted | Working tabs are OUTSIDE the sliding rows; only the chips are inside.
    expect(jobs).toMatch(/<SectionTabs [^>]*\/>\s*<ScrollAwayRows>\{tab === "browse" && browse\?\.chips\}<\/ScrollAwayRows>/);
    expect(jobs).not.toMatch(/<ScrollAwayRows>\s*<SectionTabs/);
    expect(jobs).toContain("<ScrollAwayScope><Dashboard embeddedHeader={makeHeader} /></ScrollAwayScope>");
    const feed = code("src/components/dashboard/BrowseTasksFeed.tsx");
    expect(feed).toContain('top={view === "map" ? undefined : <ScrollAwaySpacer />}');
    const ptr = code("src/components/PullToRefreshWrapper.tsx");
    expect(ptr).toMatch(/data-thread-area=\{threadArea\}\s*>\s*\{top\}/);
    const dash = code("src/pages/home/Dashboard.tsx");
    expect(dash).toContain('titleCardClassName={isWebDesktop ? "" : "!overflow-visible z-10"}');
  });

  it("Declutter: the tabs stay pinned and the chips slide (member), the guest chips slide, SectionScreen draws the spacer first in its scroll column", () => {
    const decl = code("src/components/declutter/DeclutterHomeView.tsx");
    // A guest's Browse chrome lives in its own file since Q2705 (11-14).
    expect(code("src/components/declutter/DeclutterGuestHome.tsx")).toContain("tabs: <ScrollAwayRows>{browse.chips}</ScrollAwayRows>");
    // The tabs stay pinned like Jobs' (M14, owner 11-16 "keep tabs pinned"); only Browse's chips slide.
    expect(decl).toMatch(/tabs: \(\s*<>\s*<SectionTabs [^>]*\/>\s*<ScrollAwayRows off=\{!browse\}>\{browse\?\.chips\}<\/ScrollAwayRows>/);
    expect(decl).not.toMatch(/<ScrollAwayRows[^>]*>\s*<SectionTabs/);
    const screenSrc = code("src/components/sections/SectionScreen.tsx");
    expect(screenSrc).toMatch(/data-app-page-scroll=""[^>]*>\s*<ScrollAwaySpacer \/>/);
    expect(screenSrc).toMatch(/<ScrollAwayScope>\s*<AppShell/);
  });
});
