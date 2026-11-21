import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Speed 2026-11-20: the gift guides and the 25 Days page start their page chunk from the ENTRY, beside the app
 * (routePreload.ts PATH_PAGE_PATH, pathPageRoute.ts), as /help and /hire do (Q2705). Before, nothing in the entry started
 * them, so the page waited for App.tsx to run and render the route: on prod (cwv-lab, Slow 4G + 4x, 375, guest)
 * /sponsor's first words drew at 8.0-8.6 s and the landing's covers at 7.3 s.
 *
 * @mutate src/boot/routePreload.ts | \|gift-guides(?:\/[^/]+)?\|sponsor\|25days)$/i; | )$/i;
 * @mutate src/boot/pathPageRoute.ts | } else if (path === "/sponsor" \|\| path === "/25days") { | } else if (path === "/sponsorx") {
 * @mutate src/boot/pathPageRoute.ts | } else if (path.startsWith("/gift-guides") && | } else if (path.startsWith("/gift-guidesx") &&
 */

const loaded: string[] = [];
const PAGES = [
  ["@/pages/info/GiftGuides", "GiftGuides"],
  ["@/pages/sponsor/SponsorPage", "SponsorPage"],
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
  ])("a guest on %s starts %s, and only it", async (path, page) => {
    await open(path);
    // 2026-11-20 (train 1120f CI): the first cold import in a loaded shard outlasted settle()'s five ticks; wait for it.
    await vi.waitFor(() => expect(loaded).toEqual([page]), { timeout: 5000 });
  });

  it("a signed-in member on a guide starts it too", async () => {
    await open("/gift-guides/dad", true);
    await vi.waitFor(() => expect(loaded).toEqual(["GiftGuides"]), { timeout: 5000 });
  });

  it("the fun pages (their own chunks), deeper paths and look-alikes start neither", async () => {
    for (const p of ["/gift-guides/draw-names", "/gift-guides/swipe", "/gift-guides/planner", "/gift-guides/list/abc", "/gift-guides/secret-santa/a/b", "/25days/rules", "/sponsors", "/gift-guidesx"]) await open(p);
    expect(loaded).toEqual([]);
  });
});
