import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Speed 2026-11-20: the gift guides and the 25 Days page start their page chunk from the ENTRY, beside the app
 * (routePreload.ts PATH_PAGE_PATH, pathPageRoute.ts), as /help and /hire do (Q2705). Before, nothing in the entry started
 * them, so the page waited for App.tsx to run and render the route: on prod (cwv-lab, Slow 4G + 4x, 375, guest)
 * /sponsor's first words drew at 8.0-8.6 s and the landing's covers at 7.3 s.
 *
 * @mutate src/boot/routePreload.ts | \|gift-guides(?:\/[^/]+)?\|sponsor\|25days\|holidays)$/i; | )$/i;
 * @mutate src/boot/routePreload.ts | \|25days\|holidays)$/i; | \|25days)$/i;
 * @mutate src/boot/pathPageRoute.ts | } else if (path === "/holidays") { | } else if (path === "/holidaysx") {
 * @mutate src/boot/pathPageRoute.ts | (?:black-friday\|small-business-saturday\|cyber-monday)$/.test(path)) { | (?:x)$/.test(path)) {
 * @mutate src/boot/pathPageRoute.ts | if (path === "/gift-guides/small-business-saturday") { | if (path === "/gift-guides/sbs-x") {
 * @mutate src/boot/coldPatternPages.ts | ?.[1].preload(); | ?.[1];
 * @mutate src/boot/coldPatternPages.ts | (?:draw-names\|swipe\|planner\|printables) | (?:draw-names\|swipe\|planner)
 * @mutate src/App.tsx | preloadColdPatternPage([[COLD_GUIDE_PAGE, GiftGuides], [COLD_HUB_PAGE, HolidayHub]]); | preloadColdPatternPage([[COLD_GUIDE_PAGE, GiftGuides]]);
 *
 * Guide speed 1124 (speed-1122n S1-S5): the Holiday Hub starts here too, a deals day page starts its deals file
 * beside its page (GiftGuides.tsx starts the deals chunk as it runs) (they waited one after the other: "Loading your list…", then "Loading deals…"), and
 * App.tsx takes a guide's or the Hub's already-started module at once (COLD_PATTERN_PAGES), so the route never draws
 * its blank fallback first.
 * @mutate src/boot/pathPageRoute.ts | } else if (path === "/sponsor" \|\| path === "/25days") { | } else if (path === "/sponsorx") {
 * @mutate src/boot/pathPageRoute.ts | } else if (path.startsWith("/gift-guides") && | } else if (path.startsWith("/gift-guidesx") &&
 */

const loaded: string[] = [];
const PAGES = [
  ["@/pages/info/GiftGuides", "GiftGuides"],
  ["@/pages/sponsor/SponsorPage", "SponsorPage"],
  ["@/pages/info/holidays/HolidayHub", "HolidayHub"],
  ["@/content/giftGuideDeals.json", "dealsFile"],
  ["@/content/giftGuideSmallBiz.json", "smallBizFile"],
] as const;
// doMock per test (not vi.mock): after resetModules each test's import must run the factory again.
beforeEach(() => {
  for (const [path, name] of PAGES) {
    vi.doMock(path, () => {
      loaded.push(name);
      return { default: () => null };
    });
  }
});

afterEach(() => {
  localStorage.clear();
  loaded.length = 0;
  vi.resetModules();
  window.history.replaceState(null, "", "/");
});

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** preloadEntryRoute runs from the entry with the page's own URL, so pathPageRoute.ts reads the same path. */
async function open(path: string, signedIn = false) {
  if (signedIn) localStorage.setItem("sb-test-auth-token", "{}");
  window.history.replaceState(null, "", path);
  const { preloadEntryRoute } = await import("./routePreload");
  preloadEntryRoute(path);
  await settle();
}

describe("the gift guides and the 25 Days page start on the first network round", () => {
  it.each([
    ["/gift-guides", "GiftGuides"],
    ["/gift-guides/", "GiftGuides"],
    ["/gift-guides/mom", "GiftGuides"],
    ["/gift-guides/my-list", "GiftGuides"],
    ["/sponsor", "SponsorPage"],
    ["/25days", "SponsorPage"],
    ["/holidays", "HolidayHub"],
    ["/holidays/", "HolidayHub"],
  ])("a guest on %s starts %s, and only it", async (path, page) => {
    await open(path);
    // 2026-11-20 (train 1120f CI): the first cold import in a loaded shard outlasted settle()'s five ticks; wait for it.
    await vi.waitFor(() => expect(loaded).toEqual([page]), { timeout: 5000 });
  });

  it("a signed-in member on a guide starts it too", async () => {
    await open("/gift-guides/dad", true);
    await vi.waitFor(() => expect(loaded).toEqual(["GiftGuides"]), { timeout: 5000 });
  });

  it.each([
    ["/gift-guides/black-friday", ["GiftGuides", "dealsFile"]],
    ["/gift-guides/cyber-monday", ["GiftGuides", "dealsFile"]],
    ["/gift-guides/small-business-saturday", ["GiftGuides", "dealsFile", "smallBizFile"]],
  ])("a deals day page (%s) starts its page and its data files side by side", async (path, files) => {
    await open(path);
    await vi.waitFor(() => expect([...loaded].sort()).toEqual(files), { timeout: 5000 });
  });

  it("App.tsx takes a cold guide's or the Hub's module before the first render (no blank route fallback)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { blankComments } = await import("@/test/helpers/blankNonCode");
    const { COLD_GUIDE_PAGE, COLD_HUB_PAGE, preloadColdPatternPage } = await import("./coldPatternPages");
    const started: string[] = [];
    const page = (name: string) => ({ preload: () => void started.push(name) });
    const rows = [[COLD_GUIDE_PAGE, page("GiftGuides")], [COLD_HUB_PAGE, page("HolidayHub")]] as const;
    const pick = (p: string) => {
      started.length = 0;
      preloadColdPatternPage(rows, p);
      return started.join(",") || undefined;
    };
    // Inventory floor: both rows answer.
    expect(rows.length).toBeGreaterThan(1);
    for (const p of ["/gift-guides", "/gift-guides/", "/gift-guides/her", "/gift-guides/black-friday", "/gift-guides/my-list"]) expect(pick(p), p).toBe("GiftGuides");
    expect(pick("/holidays")).toBe("HolidayHub");
    for (const p of ["/gift-guides/swipe", "/gift-guides/draw-names", "/gift-guides/planner", "/gift-guides/printables", "/gift-guides/list/abc", "/holidays/hire-a-helpr"]) expect(pick(p), p).toBeUndefined();
    // App.tsx calls it as the file runs, with both pages.
    const app = blankComments(readFileSync(resolve(__dirname, "../App.tsx"), "utf8"));
    expect(app).toMatch(/\npreloadColdPatternPage\(\[\[COLD_GUIDE_PAGE, GiftGuides\], \[COLD_HUB_PAGE, HolidayHub\]\]\);/);
  });

  it("the fun pages (their own chunks), deeper paths and look-alikes start neither", async () => {
    for (const p of ["/gift-guides/draw-names", "/gift-guides/swipe", "/gift-guides/planner", "/gift-guides/list/abc", "/gift-guides/secret-santa/a/b", "/25days/rules", "/sponsors", "/gift-guidesx", "/holidays/hire-a-helpr"]) await open(p);
    expect(loaded).toEqual([]);
  });
});
