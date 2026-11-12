/**
 * F276a / F359p (whole-app audit 11-10, keyboard at 1440): after "Skip to content" the Tab key went through the page,
 * then the rail, and only then the page's own Back, Share and menu. On the desktop website PageTitleBar portals the
 * page's title row into a slot DesktopTopNav registers, and App.tsx mounted DesktopTopNav and DesktopSidebarNav AFTER
 * <main>, so both came last in the tab order. They are position:fixed, so the DOM order is free: App.tsx now mounts the
 * top bar, then the rail, before <main>.
 *
 * @mutate src/App.tsx |           <SignedInChrome>\n            <WebDesktopOnly>\n              <Suspense fallback={null}><DesktopTopNav /></Suspense>\n              <Suspense fallback={null}><DesktopSidebarNav /></Suspense>\n            </WebDesktopOnly>\n          </SignedInChrome>\n          <main |           <main
 * @mutate src/App.tsx |               <Suspense fallback={null}><DesktopTopNav /></Suspense>\n              <Suspense fallback={null}><DesktopSidebarNav /></Suspense> |               <Suspense fallback={null}><DesktopSidebarNav /></Suspense>\n              <Suspense fallback={null}><DesktopTopNav /></Suspense>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const read = (f: string) => blankComments(readFileSync(resolve(process.cwd(), f), "utf8"));
const app = read("src/App.tsx");

describe("the desktop top bar and rail come before the page in the tab order", () => {
  it("App.tsx mounts exactly one <main>, one DesktopTopNav and one DesktopSidebarNav", () => {
    expect(app.match(/<main\b/g)?.length).toBe(1);
    expect(app.match(/<DesktopTopNav\s*\/>/g)?.length).toBe(1);
    expect(app.match(/<DesktopSidebarNav\s*\/>/g)?.length).toBe(1);
  });

  it("the top bar, then the rail, then <main>", () => {
    const top = app.search(/<DesktopTopNav\s*\/>/);
    const rail = app.search(/<DesktopSidebarNav\s*\/>/);
    const main = app.search(/<main\b/);
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThan(rail);
    expect(rail).toBeLessThan(main);
  });

  it("the page's Back and actions live in the top bar on the desktop (PageTitleBar portals into DesktopTopNav's slot)", () => {
    expect(read("src/components/header/PageTitleBar.tsx")).toMatch(/createPortal\(<DesktopRow /);
    expect(read("src/components/DesktopTopNav.tsx")).toMatch(/ref=\{registerDesktopTitleSlot\}/);
  });

  it("both are fixed to the screen, so the mount order moves nothing", () => {
    expect(read("src/components/DesktopTopNav.tsx")).toMatch(/className="fixed top-0 left-0 right-0 z-50/);
  });
});
