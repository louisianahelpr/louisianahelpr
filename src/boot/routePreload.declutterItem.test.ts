import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Q2708 (11-05): a Declutter item page's gate and page chunks start from the ENTRY, beside the app, for a guest and a
 * member. Before, /declutter/item/:id had no ENTRY_ROUTE_CHUNKS row (exact-path table), so both chunks waited for
 * App.tsx to run. Lab (local dummy-backend dists, guest cold, 375 Fast 4G + 4x, 5 interleaved runs, 0 requests past
 * localhost): DeclutterItemPage request start 1080 -> 596 ms, LCP (the first photo) median 1756 -> 1416 ms.
 *
 * Since 11-06 the item page shares pathPageRoute.ts with the info pages (one entry loader, PATH_PAGE_PATH).
 *
 * @mutate src/boot/routePreload.ts | const PATH_PAGE_PATH = /^\/(?:declutter\/item\/[^/]+\|help | const PATH_PAGE_PATH = /^\/(?:declutter\/items\/[^/]+\|help
 * @mutate src/boot/pathPageRoute.ts |   import("@/pages/declutter/DeclutterItemPage").catch(() => { |   Promise.resolve().catch(() => {
 * @mutate src/boot/routePreload.ts | PATH_PAGE_PATH.test(path) ? { guest: [pathPageRoute], | PATH_PAGE_PATH.test(path) ? { guest: [],
 * @mutate src/boot/pathPageRoute.ts | if (path.startsWith("/declutter/item/")) { | if (path.startsWith("/declutter/items/")) {
 */

const loaded: string[] = [];
// doMock per test (not vi.mock): after resetModules each test's import must run the factory again, or a module the
// previous test already loaded would never be counted.
beforeEach(() => {
  for (const [path, name] of [
    ["@/pages/declutter/DeclutterItemPage", "DeclutterItemPage"],
    ["@/components/declutter/DeclutterGuestRoute", "DeclutterGuestRoute"],
    ["@/pages/declutter/DeclutterPage", "DeclutterPage"],
  ] as const) {
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

const ITEM = "/declutter/item/55e18296-0000-4000-8000-000000000001";
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
/** entry.ts passes the page's own URL, and pathPageRoute.ts reads the same one. */
async function open(path: string) {
  window.history.replaceState(null, "", path);
  const { preloadEntryRoute } = await import("./routePreload");
  preloadEntryRoute(path);
}

describe("a Declutter item page's chunks start on the first network round", () => {
  it("a guest (an item link is how most guests arrive) starts the gate and the page", async () => {
    await open(ITEM);
    await vi.waitFor(() => expect(loaded).toEqual(expect.arrayContaining(["DeclutterGuestRoute", "DeclutterItemPage"])));
  });

  it("a signed-in member starts the same two, and not the Declutter home page", async () => {
    localStorage.setItem("sb-test-auth-token", "{}");
    await open(`${ITEM}/`);
    await vi.waitFor(() => expect(loaded).toEqual(expect.arrayContaining(["DeclutterGuestRoute", "DeclutterItemPage"])));
    await settle();
    expect(loaded).not.toContain("DeclutterPage");
  });

  it("a path that is not an item page starts neither", async () => {
    await open("/declutter/item");
    vi.resetModules();
    await open(`${ITEM}/extra`);
    await settle();
    await settle();
    expect(loaded).not.toContain("DeclutterItemPage");
  });
});
