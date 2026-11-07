import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Q2705 (11-06): the public info pages (Help center, /hire/<service>/<town>) start their page chunk
 * from the ENTRY, beside the app (routePreload.ts PATH_PAGE_PATH, pathPageRoute.ts). Before, nothing in the entry started them, so the page chunk waited for App.tsx to
 * run: live /help (www, Slow 4G + 4x, 375, guest) drew its frame at ~3.1 s and its LCP topic list at 4.9-5.0 s.
 *
 * @mutate src/boot/routePreload.ts | PATH_PAGE_PATH.test(path) ? { guest: [pathPageRoute], | PATH_PAGE_PATH.test(path) ? { guest: [],
 * @mutate src/boot/routePreload.ts | \|help\|hire\/[^/]+\/[^/]+)$/; | \|helpx\|hire\/[^/]+\/[^/]+)$/;
 * @mutate src/boot/pathPageRoute.ts | } else if (path === "/help") { | } else if (path === "/helps") {
 * @mutate src/boot/pathPageRoute.ts | } else if (path.startsWith("/hire/")) { | } else if (path.startsWith("/hirex/")) {
 */

const loaded: string[] = [];
const PAGES = [
  ["@/pages/info/HelpCenter", "HelpCenter"],
  ["@/pages/info/Legal", "Legal"],
  ["@/pages/info/HireTownPage", "HireTownPage"],
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

/** preloadEntryRoute runs from the entry with the page's own URL, so infoPageRoute.ts reads the same path. */
async function open(path: string, signedIn = false) {
  if (signedIn) localStorage.setItem("sb-test-auth-token", "{}");
  window.history.replaceState(null, "", path);
  const { preloadEntryRoute } = await import("./routePreload");
  preloadEntryRoute(path);
  await settle();
}

describe("a public info page's chunk starts on the first network round", () => {
  it.each([
    ["/help", "HelpCenter"],
    ["/help/", "HelpCenter"],
    ["/hire/assembly/abbeville", "HireTownPage"],
  ])("a guest on %s starts %s, and only it", async (path, page) => {
    await open(path);
    expect(loaded).toEqual([page]);
  });

  it("a signed-in member on /help starts it too", async () => {
    await open("/help", true);
    expect(loaded).toEqual(["HelpCenter"]);
  });

  it("paths that are not these pages start none of them", async () => {
    // The policy pages too: measured, Legal draws with the app already and a preload here made it later.
    for (const p of ["/hire", "/hire/assembly", "/hire/assembly/abbeville/x", "/helpers", "/legal", "/rules", "/terms", "/privacy"]) await open(p);
    expect(loaded.filter((n) => PAGES.some(([, name]) => name === n))).toEqual([]);
  });
});
