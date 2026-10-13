/**
 * A pinned band on a marketing-chrome page pins UNDER the fixed marketing
 * Navbar, never behind it (seen on prod 2026-10-12 proving Q965: /legal's
 * Terms / Rules / Privacy band was `sticky; top: 0; z-30`, the Navbar is
 * `fixed; top: 0; z-50` and stays put through a scroll, so at 375 and 1440 the
 * pinned tabs sat hidden behind the nav). For a guest on the web the band's
 * top is the Navbar's own height, the same expression PublicLayout's spacer
 * clears it with; signed in, PublicLayout drops the marketing nav for AppShell
 * and the band pins at the scroll box's top.
 *
 * Class: every sticky element in a page that renders the marketing chrome
 * (imports PublicHeaderPage or PublicLayout) is listed in STICKY, exactly, with
 * why its top is right, so a new pinned band there must answer the same
 * question.
 *
 * @mutate src/pages/info/Legal.tsx | const webBandStickyTop = user ? "0px" : "calc(max(var(--safe-area-top, 0px), 0.25rem) + var(--public-nav-h))"; | const webBandStickyTop = "0px";
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

/** `file` -> how many sticky elements it holds, and why each one's top is right. */
const STICKY: Record<string, { count: number; why: string }> = {
  "src/pages/info/Legal.tsx": {
    count: 2,
    why: "the web band's top is webBandStickyTop (asserted below); the native band lives in AppShell's own scroll box, which has no marketing nav above it, so top-0 is its top",
  },
};

describe("pinned bands on marketing pages clear the fixed Navbar", () => {
  it("/legal's web band pins at the Navbar's height for a guest, at 0 when signed in", () => {
    const legal = read("src/pages/info/Legal.tsx");
    const m = legal.match(/const webBandStickyTop = user \? "0px" : "([^"]+)";/);
    expect(m, "webBandStickyTop: 0 signed in, the Navbar's height for a guest").not.toBeNull();
    const spacer = read("src/components/marketing/PublicLayout.tsx").match(/style=\{\{ height: "(calc\([^"]+\))" \}\}/);
    expect(spacer, "PublicLayout's nav spacer").not.toBeNull();
    expect(m![1]).toBe(spacer![1]);
    expect(legal).toMatch(/top: webBandStickyTop,/);
  });

  it("every sticky element on a marketing-chrome page is accounted for (exact, two-way)", () => {
    const files = walkSource([join(ROOT, "src/pages")]).filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f));
    expect(files.length).toBeGreaterThan(50);
    const found: Record<string, number> = {};
    let chromePages = 0;
    for (const f of files) {
      const src = blankComments(readFileSync(f, "utf8"));
      if (!/from "@\/components\/marketing\/(PublicHeaderPage|PublicLayout)"/.test(src)) continue;
      chromePages++;
      const n = (src.match(/className=\{?["`][^"`]*\bsticky\b/g) ?? []).length;
      if (n) found[f.slice(ROOT.length + 1)] = n;
    }
    // Floor: Legal, HelpCenter, Support, UserProfile, JobDetail, Index, NotFound, DashboardGuest import it today.
    expect(chromePages).toBeGreaterThan(4);
    expect(found).toEqual(Object.fromEntries(Object.entries(STICKY).map(([k, v]) => [k, v.count])));
  });
});
