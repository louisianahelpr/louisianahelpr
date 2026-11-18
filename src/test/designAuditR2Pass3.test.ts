/**
 * Design audit round 2 (~/.lh-shots/design-audit-r2/FINDINGS.md), pass 3: the layout fixes read from source (comments
 * blanked). The render-level checks live beside their components (declutterSellPhotos.test.tsx #12 #14 #15,
 * declutterYourOffer.test.tsx #16, routeSkeletonMirrorsItsTitleBar.test.ts + homeShellMatchesSkeleton #40).
 *
 * @mutate src/components/DesktopSidebarNav.tsx | <div className="helpr-emblem-disc px-5 pt-5 pb-4 shrink-0"> | <div className="px-5 pt-5 pb-4 shrink-0">
 * @mutate src/index.css | [data-theme="dark"] .helpr-emblem-disc .helpr-emblem { | [data-theme="dark"] .helpr-emblem-disk .helpr-emblem {
 * @mutate src/index.css |   background: hsl(45 40% 96%);\n  box-shadow: 0 0 0 3px hsl(45 40% 96%);\n  filter: none; |   background: hsl(var(--parchment));\n  box-shadow: 0 0 0 3px hsl(var(--parchment));\n  filter: none;
 * @mutate src/pages/home/HomeDashboard.tsx | className={`flex flex-col gap-section${isWebDesktop ? "" : " pt-2.5"}`}> | className="flex flex-col gap-section">
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const src = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

describe("design audit round 2, pass 3", () => {
  it("#39: in dark mode the desktop sidebar's H sits on a fixed cream disc, in its own colours", () => {
    const rail = src("src/components/DesktopSidebarNav.tsx");
    const at = rail.indexOf('<HelprMark to="/home" size="md" emblemOnly />');
    expect(at).toBeGreaterThan(0);
    expect(rail.slice(rail.lastIndexOf("<div", at), at)).toContain('className="helpr-emblem-disc ');
    const css = src("src/index.css");
    const start = css.indexOf('[data-theme="dark"] .helpr-emblem-disc .helpr-emblem {');
    expect(start).toBeGreaterThan(0);
    const rule = css.slice(start, css.indexOf("}", start));
    // A fixed cream, never --parchment (it turns charcoal in dark mode, the very thing the disc is for).
    expect(rule).toMatch(/background: hsl\(45 40% 9\d%\);/);
    expect(rule).not.toContain("var(--parchment)");
    expect(rule).toContain("filter: none;");
    expect(rule).toContain("height: 2.5rem;");
  });

  it("#40: on a phone the first Home card clears the search bar like the cards below it", () => {
    const home = src("src/pages/home/HomeDashboard.tsx");
    expect(home).toContain('data-testid="home-dashboard" className={`flex flex-col gap-section${isWebDesktop ? "" : " pt-2.5"}`}');
    const skeleton = src("src/components/DashboardRouteSkeleton.tsx");
    expect(skeleton).toContain('<div className={`flex flex-col gap-section${desktop ? "" : " pt-2.5"}`}>');
    // index.html's phone copy of the skeleton carries it too (homeShellMatchesSkeleton keeps it byte-exact).
    const shell = readFileSync(resolve(ROOT, "index.html"), "utf8");
    expect(shell).toContain('<div class="flex flex-col gap-section pt-2.5">');
  });
});
