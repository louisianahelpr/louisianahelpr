/**
 * The bottom nav is ICONS ONLY (owner, nav redesign 2026-11-06 11:40 AM: "the phone bottom bar is icons only (no
 * words); the names stay as aria-labels"). This replaced the 2026-10-19 one-word label under each icon, so the old
 * "one line, never cut" check became this one: no label span is drawn, and every tab still carries its name (in the
 * member's language) as its accessible name. The rendered half (five named tabs, no word painted) is
 * src/test/centerCreateNav.test.tsx; the pixel half (no word, >= 44px, none touching, at 320 and 375) is
 * e2e/journeys/nav-hide-on-scroll.spec.ts "dock icons only".
 *
 * @mutate src/components/MobileNav.tsx |       </TabButton> |         <span data-dock-label className="relative z-10 block whitespace-nowrap text-ds-10">{shown}</span>\n      </TabButton>
 * @mutate src/components/MobileNav.tsx | ariaLabel={locked ? `${shown} — locked until your account is approved` : showBadge ? `${dockBadgeText(badgeCount)} ${shown}` : shown} | ariaLabel={locked ? `${label} — locked until your account is approved` : showBadge ? `${dockBadgeText(badgeCount)} ${label}` : label}
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const nav = blankComments(readFileSync(resolve(__dirname, "../components/MobileNav.tsx"), "utf8"));
const tab = nav.match(/<TabButton[\s\S]*?<\/TabButton>/)?.[0] ?? "";

describe("dock tabs are icons only", () => {
  it("the tab's markup was found (vacuity floor)", () => {
    expect(tab.length, "the TabButton block was not found").toBeGreaterThan(500);
    expect(tab).toMatch(/<Icon\b/);
  });
  it("no word is drawn under the icon: no data-dock-label span, the name never rendered as text", () => {
    expect(tab).not.toMatch(/data-dock-label/);
    // `shown` (the dictionary word) may only appear inside the ariaLabel expression, never as a JSX child.
    const children = tab.replace(/ariaLabel=\{[^\n]*\}/, "");
    expect(children).not.toMatch(/\{shown\}/);
  });
  it("the name lives in the aria-label, in the member's language (Spanish option, 2026-10-29)", () => {
    expect(nav).toMatch(/const shown = shownKey \? tr\(shownKey\) : label;/);
    expect(tab).toMatch(/ariaLabel=\{[^\n]*\bshown\b[^\n]*\}/);
  });
});
