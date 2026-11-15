/**
 * /jobs AT 375 KEEPS ITS PANEL IN PLACE WHEN THE FEED ARRIVES (prod-audit run 43691657529, 2026-11-15, page-settle
 * 0.097 at ~497 ms: "section.page-panel 155→62 h657→750 ↑div.page-title-card h58").
 *
 * The phone tabs and chips overlay the feed's top only while a ScrollAwaySpacer is drawn (ScrollAway.tsx). Dashboard's
 * loading frame drew none, so the title card held the rows at their full height (151px card); when the feed's spacer
 * arrived the card dropped to 58px and the whole panel moved up 93px. The loading frame now draws the same spacer and
 * the same title-card class, so the overlay holds from the first frame and the feed's spacer takes over in one commit.
 *
 *  1. Rendered: a loading child with a spacer swapped for a loaded child with its own spacer; the rows' overlay margin
 *     is on in the loading frame and on at the loaded child's commit (no frame without it).
 *  2. Wired: Dashboard's phone loading branch draws ScrollAwaySpacer before DashboardSkeleton, and its title card
 *     class lets the rows overflow the card as the loaded page's does.
 *
 * @mutate src/pages/home/Dashboard.tsx |             <ScrollAwaySpacer />\n            <DashboardSkeleton /> |             <DashboardSkeleton />
 * @mutate src/pages/home/Dashboard.tsx |         titleCardClassName={!isWebDesktop ? "!overflow-visible z-10" : ""} |         titleCardClassName=""
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { ScrollAwayRows, ScrollAwayScope, ScrollAwaySpacer } from "@/components/sections/ScrollAway";

const ROOT = join(__dirname, "..", "..");
const ROWS_H = 93;
const realMatchMedia = window.matchMedia;
const realOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

beforeEach(() => {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return (this as HTMLElement).hasAttribute("data-scroll-away") ? ROWS_H : 0; } });
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
  if (realOffset) Object.defineProperty(HTMLElement.prototype, "offsetHeight", realOffset);
});

const margin = () => document.querySelector<HTMLElement>("[data-scroll-away]")?.style.marginBottom ?? "";
const seenAtCommit: string[] = [];
function Loaded() {
  useLayoutEffect(() => { seenAtCommit.push(margin()); }, []);
  return <div data-testid="feed"><ScrollAwaySpacer /><p>job cards</p></div>;
}
function Loading() {
  return <div data-testid="loading"><ScrollAwaySpacer /><p>bones</p></div>;
}
const page = (loading: boolean) => (
  <ScrollAwayScope>
    <header><ScrollAwayRows><div role="tablist" /></ScrollAwayRows></header>
    <section>{loading ? <Loading /> : <Loaded />}</section>
  </ScrollAwayScope>
);

describe("1. the overlay holds from the loading frame through the feed's arrival", () => {
  it("is on in the loading frame and still on when the feed commits", () => {
    seenAtCommit.length = 0;
    const r = render(page(true));
    expect(margin()).toBe(`-${ROWS_H}px`);
    r.rerender(page(false));
    expect(seenAtCommit).toEqual([`-${ROWS_H}px`]);
    expect(margin()).toBe(`-${ROWS_H}px`);
    expect(document.querySelectorAll("[data-scroll-away-spacer]").length).toBe(1);
  });
});

describe("2. Dashboard's loading frame is wired the same way", () => {
  const src = blankComments(readFileSync(join(ROOT, "src/pages/home/Dashboard.tsx"), "utf8"));
  const loadingBranch = src.slice(src.indexOf("if (loading) {"), src.indexOf("const rawName"));
  it("draws the spacer before the skeleton on a phone", () => {
    expect(loadingBranch.length).toBeGreaterThan(200);
    expect(loadingBranch).toMatch(/<ScrollAwaySpacer \/>\s*<DashboardSkeleton \/>/);
  });
  it("lets the rows overflow the title card, as the loaded page does", () => {
    expect(loadingBranch).toContain('titleCardClassName={!isWebDesktop ? "!overflow-visible z-10" : ""}');
    expect(src).toContain('titleCardClassName={isWebDesktop ? "" : "!overflow-visible z-10"}');
  });
});
