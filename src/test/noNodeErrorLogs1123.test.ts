/**
 * prod error_logs 2026-11-23 (hourly error sweep, 2:30 PM): ~30 rows from ~11 AM with user_agent "Node.js/22", origin
 * client, no user, in bursts of 3 at one timestamp: "live guide data: https://www.louisianahelpr.com/gift-guides/data/
 * manifest.json answered 404" (source liveGuideData, what=manifest) plus "background import failed: posthog" and
 * "...: sentry". Path: `npm run build` → scripts/prerender-static-pages.mjs → Vite ssrLoadModule (mode "production",
 * Node) → src/prerender/seoData.ts → src/content/giftGuideCatalog.ts loadGuidePicks → liveCopy → scheduleRefresh's
 * timer → fetch of the live manifest (no window, so the absolute origin) → 404 → report() → a row to prod, and the
 * Sentry/PostHog fan-out failing to import under Node → two more rows.
 *
 * Pins: outside a real browser (no window/document, or a Node.js/Deno/Bun navigator) the reporter sends nothing and
 * liveGuideData fetches nothing; in a browser both still work (the floor). The windowless cases hide window and
 * document per test (src/test/setup.ts needs jsdom, so a file set to the node environment cannot load).
 *
 * @mutate src/lib/automatedBrowser.ts |   if (typeof window === "undefined" \|\| typeof document === "undefined") return true; |   if (typeof window === "undefined") return false;
 * @mutate src/lib/automatedBrowser.ts |     return typeof navigator !== "undefined" && /^(Node\.js\|Deno\|Bun)\//.test(String(navigator.userAgent)); |     return false;
 * @mutate src/lib/liveGuideData.ts |   if (typeof fetch !== "function" \|\| isServerRuntime()) return; |   if (typeof fetch !== "function") return;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchSpy = vi.hoisted(() => vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 201 })));
vi.stubGlobal("fetch", fetchSpy);
vi.mock("@/lib/sentry", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/posthog", () => ({ captureException: vi.fn() }));

import { report } from "@/lib/errorLogger";
import { isServerRuntime } from "@/lib/automatedBrowser";
import { _resetLiveGuideDataForTests, isLivePickChunk, liveCopy, refreshLiveGuideData } from "@/lib/liveGuideData";

const settle = () => new Promise((r) => setTimeout(r, 300));
const urls = () => fetchSpy.mock.calls.map((c) => String(c[0]));
const chunk = { picks: [{ name: "Gift", brand: "", line: "", href: "https://example.com/g" }] };

let ua: ReturnType<typeof vi.spyOn> | null = null;
const pretendNode = () => {
  ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Node.js/22");
};

beforeEach(() => {
  Object.defineProperty(window, "location", { value: new URL("https://www.louisianahelpr.com/gift-guides/her"), writable: true });
  fetchSpy.mockClear();
  _resetLiveGuideDataForTests({ builtAt: "", origin: "" });
});
afterEach(() => {
  ua?.mockRestore();
  ua = null;
  vi.unstubAllGlobals();
  vi.stubGlobal("fetch", fetchSpy);
});

/** The prerender's runtime: no window, no document (src/test/setup.ts needs jsdom, so they are hidden per test). */
const pretendWindowless = () => {
  vi.stubGlobal("window", undefined);
  vi.stubGlobal("document", undefined);
};

describe("a windowless runtime (the build's prerender under Node) sends nothing to prod", () => {
  it("counts as not a browser", () => {
    pretendWindowless();
    expect(isServerRuntime()).toBe(true);
  });

  it("report() makes no network call", async () => {
    pretendWindowless();
    report(new Error("live guide data: manifest answered 404"), { severity: "warning", tags: { source: "liveGuideData", what: "manifest" } });
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("liveGuideData never fetches the manifest", async () => {
    _resetLiveGuideDataForTests({ builtAt: "" });
    liveCopy("her", chunk, isLivePickChunk);
    pretendWindowless();
    await refreshLiveGuideData();
    await settle();
    expect(urls()).toEqual([]);
  });
});

describe("a Node-like runtime sends nothing to prod", () => {
  it("a Node.js navigator counts as not a browser", () => {
    pretendNode();
    expect(isServerRuntime()).toBe(true);
  });

  it("report() under a Node.js navigator makes no network call", async () => {
    pretendNode();
    report(new Error("live guide data: manifest answered 404"), { severity: "warning", tags: { source: "liveGuideData", what: "manifest" } });
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("liveGuideData never fetches the manifest under a Node.js navigator", async () => {
    pretendNode();
    liveCopy("her", chunk, isLivePickChunk);
    await refreshLiveGuideData();
    await settle();
    expect(urls().filter((u) => u.includes("/gift-guides/data/"))).toEqual([]);
  });
});

describe("in a real browser both still work (the floor)", () => {
  it("jsdom is a browser here", () => {
    expect(isServerRuntime()).toBe(false);
  });

  it("report() still posts the row", async () => {
    report(new Error("a real bug"), { tags: { source: "floor" } });
    await settle();
    const posted = fetchSpy.mock.calls.filter((c) => String(c[0]).includes("error_logs"));
    expect(posted.length).toBeGreaterThan(0);
  });

  it("liveGuideData still reads the manifest", async () => {
    liveCopy("her", chunk, isLivePickChunk);
    await refreshLiveGuideData();
    expect(urls()).toContain("/gift-guides/data/manifest.json");
  });
});
