/**
 * CLASS CHECK: a fixed top bar never sits UNDER the global OfflineBanner.
 *
 * B44, 10-31 (lead item 1, from B41's note): offline at 1440 the burnt-sienna banner (`fixed top-0`, 32px) painted
 * over DesktopTopNav, which was also `fixed top-0`, and clipped the top of the "Jobs" title. Measured in a headless
 * Chromium with a mocked session, offline simulated: banner bottom 31.9, "Jobs" h1 top 28.4. AppShell already starts
 * its frame at banner + bar (101.9), so only the bar was wrong. After: bar 31.9 -> 101.9, h1 top 60.3; with no banner
 * the bar stays 0 -> 70 and the h1 28.4 (unchanged).
 *
 * Inventory from source: every tracked component/page that renders a `fixed top-0` bar. Each must read
 * useOfflineBannerOffset() and move its `top` by it, or be listed in NOT_UNDER_THE_BANNER with the reason.
 *
 * B47, 10-31: AdminTopBar (the phone admin bar, z-50 under the banner's z-60) was the last listed exception. Measured
 * offline at 375 on /admin: banner 0-31.9, bar 0-56 (emblem, bell and menu cut), content from 87.9. After: bar 31.9-87.9.
 *
 * Plus the CSS half: on a document-scroll page at desktop width the #root padding rule for the bar out-ranks the plain
 * offline-banner padding rule, so it must add the banner offset itself (measured on /user/:id: 70px padding under a
 * bar ending at 101.9 before, 101.9 after).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments, blankCssComments } from "./helpers/blankNonCode";

// @mutate src/components/DesktopTopNav.tsx |         top: bannerOffset, |         top: 0,
// @mutate src/components/admin/AdminTopBar.tsx |         top: bannerOffset, |         top: 0,
// @mutate src/index.css |     padding-top: calc(var(--desktop-bar-h) + var(--offline-banner-offset, 0px)); |     padding-top: var(--desktop-bar-h);

const REPO = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(resolve(REPO, f), "utf8");

/** Fixed top bars that do not move for the banner, and why. Two-way: each must still exist and still not read it. */
const NOT_UNDER_THE_BANNER: Record<string, string> = {
  "src/components/OfflineBanner.tsx": "the banner itself",
  "src/components/GuestBrowseSkeleton.tsx": "aria-hidden loading skeleton; its spacer must equal PublicLayout's verbatim (listArrivesInOneWave)",
};

const FIXED_TOP_BAR = /className=\{?["'`][^"'`]*\bfixed top-0\b/;
const READS_OFFSET = /useOfflineBannerOffset\(\)/;
const MOVES_TOP = /\btop:\s*bannerOffset\b|\btop:\s*bannerOffset\s*\?/;

const bars = () =>
  trackedFiles("src")
    .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) && !f.startsWith("src/test/"))
    .filter((f) => FIXED_TOP_BAR.test(blankComments(read(f))));

describe("a fixed top bar sits below the offline banner", () => {
  it("every fixed top-0 bar reads the banner offset and moves its top by it", () => {
    const found = bars();
    expect(found.length).toBeGreaterThan(3);
    expect(found).toContain("src/components/DesktopTopNav.tsx");
    expect(found).toContain("src/components/admin/AdminTopBar.tsx");
    const offenders = found
      .filter((f) => !(f in NOT_UNDER_THE_BANNER))
      .filter((f) => {
        const code = blankComments(read(f));
        return !(READS_OFFSET.test(code) && MOVES_TOP.test(code));
      });
    expect(offenders).toEqual([]);
  });

  it("the exceptions are still real (two-way)", () => {
    const found = new Set(bars());
    for (const f of Object.keys(NOT_UNDER_THE_BANNER)) {
      expect(found.has(f), `${f} no longer renders a fixed top-0 bar: drop it from NOT_UNDER_THE_BANNER`).toBe(true);
      if (f === "src/components/OfflineBanner.tsx") continue;
      const code = blankComments(read(f));
      expect(READS_OFFSET.test(code) && MOVES_TOP.test(code), `${f} now moves for the banner: drop its exception`).toBe(false);
    }
  });

  it("the desktop #root padding for the bar also carries the banner offset", () => {
    const css = blankCssComments(read("src/index.css"));
    const values: string[] = [];
    postcss.parse(css).walkRules((rule) => {
      if (!rule.selectors.some((s) => s.trim().replace(/\s+/g, " ") === "html.web-desktop.desktop-rail:not(.app-shell) #root")) return;
      rule.walkDecls("padding-top", (d) => { values.push(d.value.replace(/\s+/g, " ").trim()); });
    });
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      expect(v).toContain("var(--desktop-bar-h)");
      expect(v).toContain("var(--offline-banner-offset");
    }
  });
});
