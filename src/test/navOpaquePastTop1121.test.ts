/**
 * Holiday audit 1121 #78 (first part): on the public pages (deals, sponsors, Shop Small and every other non-landing
 * page) the fixed top bar was 72% glass, so once scrolled the card text showed through and ran into the nav's own
 * words at 375 ("Gift idea..." behind "Guides Log in"). Past the top it is now the page's own colour, fully opaque.
 * The landing keeps its own rules (landingHeaderOpaque.test.ts).
 *
 * @mutate src/index.css | .glass-nav.nav-past-top { background-color: hsl(var(--background)); } | .glass-nav.nav-past-top { background-color: hsl(var(--background) / 0.72); }
 * @mutate src/components/Navbar.tsx |         !landing && !atTop && "nav-past-top", |         false && "nav-past-top",
 * @mutate src/components/Navbar.tsx |     const read = () => setAtTop(window.scrollY <= 0); |     const read = () => setAtTop(true);
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const CSS = blankComments(readFileSync(join(ROOT, "src/index.css"), "utf8"));
const NAV = blankComments(readFileSync(join(ROOT, "src/components/Navbar.tsx"), "utf8"));
const translucent = (v: string) => /transparent|hsla|rgba|\/\s*0?\.\d|,\s*0?\.\d+\s*\)|#[0-9a-f]{8}\b/i.test(v);

describe("the public top bar is opaque once scrolled (holiday audit 1121 #78)", () => {
  it("every .nav-past-top paint rule (light and dark) is an opaque colour", () => {
    const rules = [...CSS.matchAll(/([^{}]*\.glass-nav\.nav-past-top[^{}]*)\{([^}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(1);
    const bgs = rules.flatMap((r) => [...r[2].matchAll(/background(?:-color)?:\s*([^;]+);/g)].map((m) => m[1].trim()));
    expect(bgs.length).toBe(rules.length);
    expect(bgs.filter(translucent)).toEqual([]);
  });
  it("the Navbar reads the scroll on every page and sets nav-past-top off the landing once scrolled", () => {
    expect(NAV).toMatch(/!landing && !atTop && "nav-past-top"/);
    expect(NAV).toMatch(/setAtTop\(window\.scrollY <= 0\)/);
    // The scroll listener is not limited to the landing any more.
    expect(NAV).not.toMatch(/if \(!landing\) return;\s*const read = \(\) => setAtTop/);
  });
});
