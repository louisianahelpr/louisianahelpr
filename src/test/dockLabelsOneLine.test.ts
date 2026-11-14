/**
 * The bottom nav shows each tab's NAME under its icon again (owner UI audit F147, 2026-11-09, replacing the 11-06
 * icons-only dock): "Home · Jobs · Declutter · Messages · You", one line and never cut, bold on the current tab. The
 * name is the dictionary word (Spanish option, 2026-10-29), and the tab's accessible name starts with the visible
 * text (WCAG 2.5.3). The rendered half (five named tabs, lit tab) is src/test/centerCreateNav.test.tsx; the pixel half
 * (labels on one line, none touching, at 320 and 375) is e2e/journeys/nav-hide-on-scroll.spec.ts "dock labels".
 *
 * @mutate src/components/MobileNav.tsx | leading-none whitespace-nowrap ${isActive ? "font-bold" : "font-medium"}`}>{shown}</span> | leading-none whitespace-nowrap ${isActive ? "font-bold" : "font-medium"}`}>{""}</span>
 * @mutate src/components/MobileNav.tsx | text-ds-10 leading-none whitespace-nowrap | text-ds-10 leading-none truncate
 * @mutate src/index.css | html.senior-mode .text-ds-10[data-dock-label] { font-size: 11px | html.senior-mode .text-ds-10[data-dock-label] { font-size: 13px
 * @mutate src/index.css | html.senior-mode .text-ds-10[data-dock-label] | html.senior-mode .text-ds-10[data-dock-labels]
 * @mutate src/components/MobileNav.tsx | ariaLabel={locked ? `${shown} — locked until your account is approved` : showBadge ? `${dockBadgeText(badgeCount)} ${shown}` : soon ? `${shown}, ${tr("soon.short")}` : shown} | ariaLabel={locked ? `${label} — locked until your account is approved` : showBadge ? `${dockBadgeText(badgeCount)} ${label}` : soon ? `${label}, Soon` : label}
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const nav = blankComments(readFileSync(resolve(__dirname, "../components/MobileNav.tsx"), "utf8"));
const tab = nav.match(/<TabButton[\s\S]*?<\/TabButton>/)?.[0] ?? "";
const span = tab.match(/<span\s+data-dock-label[\s\S]*?<\/span>/)?.[0] ?? "";

describe("dock labels (F147)", () => {
  it("the tab's markup and its label span were found (vacuity floor)", () => {
    expect(tab.length, "the TabButton block was not found").toBeGreaterThan(500);
    expect(tab).toMatch(/<Icon\b/);
    expect(span.length, "the data-dock-label span was not found").toBeGreaterThan(20);
  });
  it("each tab draws its name (the dictionary word) under the icon", () => {
    expect(span).toMatch(/>\{shown\}<\/span>/);
    expect(nav).toMatch(/const shown = shownKey \? tr\(shownKey\) : label;/);
  });
  it("one line, never cut: nowrap, no truncate / ellipsis / overflow clip, 10px; bold when current", () => {
    expect(span).toContain("whitespace-nowrap");
    expect(span).not.toMatch(/truncate|text-ellipsis|overflow-hidden|line-clamp/);
    expect(span).toMatch(/text-ds-10/);
    expect(span).toMatch(/isActive \? "font-bold"/);
  });
  it("the accessible name is the same word, in the member's language", () => {
    expect(tab).toMatch(/ariaLabel=\{[^\n]*\bshown\b[^\n]*\}/);
  });
  it("F462: under Bigger text the names keep their default 11px (13px made Declutter and Messages touch)", () => {
    const css = blankComments(readFileSync(resolve(__dirname, "../index.css"), "utf8"));
    const tw = readFileSync(resolve(__dirname, "../../tailwind.config.ts"), "utf8");
    const base = tw.match(/"ds-10":\s*\["(\d+)px"/)?.[1];
    expect(base, "tailwind ds-10 size not found").toBe("11");
    const rule = css.match(/html\.senior-mode \.text-ds-10\[data-dock-label\]\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule, "the senior-mode dock label rule is missing").toMatch(/font-size:\s*(\d+)px\s*!important/);
    expect(rule.match(/font-size:\s*(\d+)px/)?.[1]).toBe(base);
    // It must come AFTER the senior-mode .text-ds-10 rung, or the rung wins on equal weight elsewhere.
    expect(css.indexOf("html.senior-mode .text-ds-10[data-dock-label]")).toBeGreaterThan(css.indexOf("html.senior-mode .text-ds-10 {"));
    expect(span).toContain("data-dock-label");
  });
});
