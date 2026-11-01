/**
 * THE DESKTOP PAGE HEAD IS LEVEL WITH THE RAIL (owner, 2026-10-28, desktop /jobs at ~1390 wide: "jobs is still not
 * even with the h", then "browse posted working needs to be even with create").
 *
 * Measured with getBoundingClientRect on a local build (WebKit, faked backend; ~/.lh-shots/ui-polish-1028/):
 *   before (bar 56px, logo 8px down):  H 30 / title 28;  Create 92 / tabs 99.5 (Jobs), 103.5 (Declutter), 102.5
 *                                       (Shops, Homes) at 1280 and 1440;
 *   after:                              H 42 / title 42 on Jobs, Declutter, Shops, Homes, Messages, You, Admin;
 *                                       Create 104 / tabs 104.5 (Declutter, Shops, Homes), Jobs within 2px.
 *
 * Layout is not measurable in jsdom, so this guard holds the ARITHMETIC every layer shares: each number below is read
 * from the class or constant that draws it, and the two pairs must agree within 2px. A layer that stops reading the
 * shared constants (src/lib/desktopBar.ts) fails here too.
 *
 * @mutate src/components/DesktopSidebarNav.tsx |       <div className="px-5 pt-5 pb-4 shrink-0"> |       <div className="px-5 pt-2 pb-4 shrink-0">
 * @mutate src/lib/desktopBar.ts | export const DESKTOP_BAR_PAD_TOP = 14; | export const DESKTOP_BAR_PAD_TOP = 0;
 * @mutate src/components/header/PageTitleBar.tsx |         {desktopGap && <div aria-hidden className="h-2 shrink-0" data-page-title-gap="" />} |         {desktopGap && <div aria-hidden className="h-5 shrink-0" data-page-title-gap="" />}
 * @mutate src/components/ui/PageScaffold.tsx | ${headerInBar ? "lg:pt-3" : "lg:pt-5"} | ${headerInBar ? "lg:pt-5" : "lg:pt-5"}
 * @mutate src/components/AppShell.tsx |     const topBarOffset = useIsWebDesktop() ? DESKTOP_BAR_H : 0; |     const topBarOffset = useIsWebDesktop() ? 56 : 0;
 * @mutate src/index.css |   --desktop-bar-h: 70px; |   --desktop-bar-h: 56px;
 * @mutate src/components/DesktopTopNav.tsx |         paddingTop: DESKTOP_BAR_PAD_TOP, |
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { DESKTOP_BAR_H, DESKTOP_BAR_PAD_TOP, DESKTOP_BAR_ROW, DESKTOP_CONTENT_GAP, DESKTOP_SCAFFOLD_GAP } from "@/lib/desktopBar";

const ROOT = resolve(__dirname, "../..");
const code = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));
/** Tailwind spacing unit -> px. */
const tw = (unit: string) => Number(unit) * 4;
const num = (re: RegExp, src: string, what: string) => {
  const m = re.exec(src);
  expect(m, what).not.toBeNull();
  return tw(m![1]);
};

describe("the desktop page head is level with the rail (owner 2026-10-28)", () => {
  const rail = code("src/components/DesktopSidebarNav.tsx");
  const logoBox = rail.match(/<div className="px-5 pt-(\d+(?:\.\d+)?) pb-(\d+(?:\.\d+)?) shrink-0">\s*<HelprMark to="\/home" size="md" emblemOnly \/>/);
  const createH = num(/data-testid="sidebar-create"[\s\S]{0,400}?\bh-(\d+)\b/, rail, "Create's height");
  const logoTop = tw(logoBox?.[1] ?? "NaN");
  const logoBottomPad = tw(logoBox?.[2] ?? "NaN");
  // The emblem's link box is 44px (HelprMark's min-h-11: the tap floor).
  const logoH = num(/className=\{`\$\{cls\} min-h-(\d+)`\}/, code("src/components/HelprMark.tsx"), "the logo link's min height");
  const hMiddle = logoTop + logoH / 2;
  const createMiddle = logoTop + logoH + logoBottomPad + createH / 2;

  it("the rail's numbers are read from its source (else this checks nothing)", () => {
    expect(logoBox, "the rail's logo block").not.toBeNull();
    expect([logoTop, logoH, logoBottomPad, createH].every((n) => n > 0)).toBe(true);
  });

  it("the bar's row is centred on the logo's middle (the page title is level with the H)", () => {
    const nav = code("src/components/DesktopTopNav.tsx");
    expect(nav).toContain("paddingTop: DESKTOP_BAR_PAD_TOP,");
    expect(num(/<div className="w-full flex h-(\d+) items-center/, nav, "the bar's row height")).toBe(DESKTOP_BAR_ROW);
    expect(DESKTOP_BAR_H).toBe(DESKTOP_BAR_PAD_TOP + DESKTOP_BAR_ROW);
    expect(Math.abs(DESKTOP_BAR_PAD_TOP + DESKTOP_BAR_ROW / 2 - hMiddle), `title ${DESKTOP_BAR_PAD_TOP + DESKTOP_BAR_ROW / 2} vs H ${hMiddle}`).toBeLessThanOrEqual(2);
  });

  it("every layer that reserves the bar reserves the same height", () => {
    expect(code("src/components/AppShell.tsx")).toContain("const topBarOffset = useIsWebDesktop() ? DESKTOP_BAR_H : 0;");
    const css = code("src/index.css");
    expect(css).toContain(`--desktop-bar-h: ${DESKTOP_BAR_H}px;`);
    // The bar's height, plus the offline banner's while it shows (the bar sits under it: offlineBannerOverDesktopBar).
    expect(css).toMatch(/html\.web-desktop\.desktop-rail:not\(\.app-shell\) #root \{\s*padding-top: calc\(var\(--desktop-bar-h\) \+ var\(--offline-banner-offset, 0px\)\);/);
    expect(code("src/components/admin/AdminSidebar.tsx")).toContain("!top-[var(--desktop-bar-h)] !h-[calc(100svh-var(--desktop-bar-h))]");
  });

  it("a section's tabs row is level with Create: SectionScreen's head and Jobs' PageScaffold head alike", () => {
    const gap = num(/\{desktopGap && <div aria-hidden className="h-(\d+(?:\.\d+)?) shrink-0" data-page-title-gap="" \/>\}/, code("src/components/header/PageTitleBar.tsx"), "the bar gap");
    expect(gap).toBe(DESKTOP_CONTENT_GAP);
    const scaffoldGap = num(/\$\{headerInBar \? "lg:pt-(\d+(?:\.\d+)?)" : "lg:pt-5"\}/, code("src/components/ui/PageScaffold.tsx"), "the scaffold's gap under the bar");
    expect(scaffoldGap).toBe(DESKTOP_SCAFFOLD_GAP);
    const headGap = num(/data-explore-header="" className="explore-header page-measure w-full shrink-0 flex flex-col gap-(\d+(?:\.\d+)?)"/, code("src/components/sections/SectionScreen.tsx"), "SectionScreen's header gap");
    const tabs = code("src/components/sections/SectionTabs.tsx");
    const tabH = num(/"section-tab relative inline-flex h-(\d+) /, tabs, "a tab's height");
    expect(tabs).toContain('data-testid="section-tabs" className="flex items-end gap-1 border-b border-border/60"');
    const tabsRowH = tabH + 1; // + its 1px rule
    const sectionTabs = DESKTOP_BAR_H + gap + headGap + tabsRowH / 2;
    const jobsTabs = DESKTOP_BAR_H + scaffoldGap + tabsRowH / 2;
    expect(Math.abs(sectionTabs - createMiddle), `section tabs ${sectionTabs} vs Create ${createMiddle}`).toBeLessThanOrEqual(2);
    expect(Math.abs(jobsTabs - createMiddle), `Jobs tabs ${jobsTabs} vs Create ${createMiddle}`).toBeLessThanOrEqual(2);
  });
});
