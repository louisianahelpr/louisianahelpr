/**
 * Deep audit 11-22 #18: at the bottom of a guest item page, both language buttons (the site footer's LanguageToggle)
 * sat under the fixed Make offer / Buy now bar, so neither could be tapped. A flush fixed bar holds the dock aside with
 * the html `dock-yield` class (useDockYield); while it does, the site footer keeps the bar's height clear under its last
 * line, so whatever the footer holds at its end can be reached.
 * Class: the rule keys on the shared class every flush fixed bar sets (StickyActionBar and every useDockYield caller)
 * and the one site footer, so it covers every public page with such a bar, not only the item page.
 *
 * @mutate src/index.css | html.dock-yield footer[data-site-footer] { | html.never footer[data-site-footer] {
 * @mutate src/components/Footer.tsx |     data-site-footer=""\n |
 * @mutate src/index.css |   padding-bottom: calc(64px + var(--safe-area-bottom, 0px));\n} |   padding-bottom: 0;\n}
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("#18: a fixed bottom bar never covers the site footer's last line", () => {
  it("while a bar holds the dock aside, the footer keeps the bar's height clear", () => {
    const css = blankComments(read("src/index.css"));
    const rule = css.match(/html\.dock-yield footer\[data-site-footer\] \{([^}]*)\}/);
    expect(rule, "the rule exists").not.toBeNull();
    // StickyActionBar's height above the safe area is 64px (BAR_BODY_PX); the rule clears exactly that.
    const bar = read("src/components/ui/StickyActionBar.tsx");
    const px = Number(/const BAR_BODY_PX = (\d+);/.exec(bar)?.[1]);
    expect(px).toBeGreaterThan(40);
    expect(rule![1]).toContain(`padding-bottom: calc(${px}px + var(--safe-area-bottom, 0px));`);
  });

  it("the one site footer carries the marker, and the bar sets the class the rule reads", () => {
    expect(blankComments(read("src/components/Footer.tsx"))).toMatch(/<footer\s+data-site-footer=""/);
    expect(blankComments(read("src/components/ui/StickyActionBar.tsx"))).toContain("useDockYield(active && phone);");
    expect(read("src/components/mobileNav/useDockYield.ts")).toContain('export const DOCK_YIELD_CLASS = "dock-yield";');
  });
});
