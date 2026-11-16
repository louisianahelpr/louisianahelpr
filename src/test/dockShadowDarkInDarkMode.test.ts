/**
 * L4 (iOS design audit 11-16): in dark mode the bottom dock threw a pale glow under itself. Its drop shadows were
 * tinted hsl(var(--olivewood) / a), and dark mode's olivewood is LIGHT (measured in the Simulator: rgba(242, 239, 233,
 * 0.2) under the dock). The drops now read --nav-drop, olivewood on the light theme and black on the dark one.
 *
 * @mutate src/index.css |   --nav-drop:          0 0% 0%; |   --nav-drop:          var(--olivewood);
 * @mutate src/components/MobileNav.tsx | 0 18px 36px -8px hsl(var(--nav-drop) / 0.16) | 0 18px 36px -8px hsl(var(--olivewood) / 0.16)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** The CSS block (selector line to its closing brace) that holds a given line index. */
function blockAround(css: string, at: number): string {
  const open = css.lastIndexOf("{", at);
  const selStart = css.lastIndexOf("}", open) + 1;
  return css.slice(selStart, css.indexOf("}", at) + 1);
}

describe("the dock's drop shadow is dark in dark mode (L4)", () => {
  it("every drop shadow on the dock pill reads --nav-drop, never olivewood", () => {
    const nav = blankComments(read("src/components/MobileNav.tsx"));
    const start = nav.indexOf("boxShadow: scrolled");
    expect(start).toBeGreaterThan(-1);
    const shadows = nav.slice(start, nav.indexOf("}}", start));
    // Inventory floor: three drops on each of the two states.
    expect(shadows.match(/hsl\(var\(--nav-drop\) \//g)?.length ?? 0).toBeGreaterThan(5);
    expect(shadows).not.toContain("--olivewood");
  });

  it("--nav-drop is olivewood on the light theme and black under [data-theme=\"dark\"]", () => {
    const css = blankComments(read("src/index.css"));
    const defs = [...css.matchAll(/--nav-drop:\s*([^;]+);/g)];
    expect(defs.length).toBe(2);
    const dark = defs.find((d) => blockAround(css, d.index ?? 0).includes('[data-theme="dark"]'));
    const light = defs.find((d) => d !== dark);
    expect(dark?.[1].trim()).toBe("0 0% 0%");
    expect(light?.[1].trim()).toBe("var(--olivewood)");
  });
});
