/**
 * THE BOTTOM BAR'S RESTING LABELS ARE THE --muted TOKEN, NOT A HEX (spec v2
 * §2: inactive tab labels are --muted, 5.0:1 on ground).
 *
 * Found 2026-10-20 (builder1f, the a11y-prod pre-push sweep of /home): the
 * dock's inactive tabs (Explore, Messages, You) and the dock's quick menus wore
 * a hard-coded `hsl(48 9% 47%)` (#837e6d), 3.93-3.99:1 on the light dock, under
 * WCAG AA's 4.5:1 for 11px text; and the same grey in dark mode, where it never
 * followed the theme.
 *
 * CLASS: no tracked source file may carry that literal again, and the dock's
 * resting colour reads --muted-foreground, whose light value is checked here
 * to clear 4.5:1 on the dock's measured near-white (#fdfbf9).
 *
 * @mutate src/components/MobileNav.tsx | style={{ color: isActive ? "hsl(var(--bark))" : "hsl(var(--muted-foreground))" }} | style={{ color: isActive ? "hsl(var(--bark))" : "hsl(48 9% 47%)" }}
 * @mutate src/components/mobileNav/NavQuickMenuItem.tsx | style={{ color: "hsl(var(--muted-foreground))" }} | style={{ color: "hsl(48 9% 47%)" }}
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
const lum = ([r, g, b]: number[]) => {
  const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe("the dock's resting labels are the muted token (AA)", () => {
  it("no tracked source carries the old hard-coded grey", () => {
    const files = trackedFiles("src").filter((f) => /^src\/.*\.tsx?$/.test(f) && !f.startsWith("src/test/"));
    expect(files.length).toBeGreaterThan(500);
    const hits = files.filter((f) => /hsl\(48 9% 47%\)/.test(blankComments(read(f))));
    expect(hits).toEqual([]);
  });

  it("the inactive tab reads --muted-foreground", () => {
    const nav = blankComments(read("src/components/MobileNav.tsx"));
    expect(nav).toContain('style={{ color: isActive ? "hsl(var(--bark))" : "hsl(var(--muted-foreground))" }}');
  });

  it("light --stormy-sky (= --muted-foreground) clears 4.5:1 on the dock", () => {
    const css = read("src/index.css");
    const m = /--stormy-sky:\s*(\d+)\s+(\d+)%\s+(\d+)%/.exec(css);
    expect(m).not.toBeNull();
    expect(css).toMatch(/--muted-foreground:\s*var\(--stormy-sky\)/);
    const fg = hslToRgb(+m![1], +m![2], +m![3]);
    expect(ratio(fg, [0xfd, 0xfb, 0xf9])).toBeGreaterThanOrEqual(4.5);
    // The literal it replaced fails, so this check can see the defect.
    expect(ratio(hslToRgb(48, 9, 47), [0xfd, 0xfb, 0xf9])).toBeLessThan(4.5);
  });
});
