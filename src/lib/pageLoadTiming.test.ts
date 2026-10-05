// Q762: real-user page-load samples for the p95 page-load SLO (scripts/slo.mjs).
// @mutate src/lib/pageLoadTiming.ts |     if (navigator.webdriver) return; |
// @mutate src/lib/pageLoadTiming.ts |   if (!(load > 0) \|\| load > 600_000) return null; |   if (false) return null;
// @mutate src/lib/pageLoadTiming.ts |       sent = true; |
import { afterEach, describe, expect, it, vi } from "vitest";

const track = vi.fn();
vi.mock("@/lib/analytics", () => ({ AhaEvent: { PageLoad: "page_load" }, track: (...a: unknown[]) => track(...a) }));

const nav = (over: Partial<PerformanceNavigationTiming> = {}) =>
  ({ loadEventEnd: 2345.6, responseStart: 120.4, domContentLoadedEventEnd: 1500.2, type: "navigate", ...over }) as PerformanceNavigationTiming;

describe("pageLoadSample", () => {
  it("turns a finished navigation into whole-ms durations", async () => {
    const { pageLoadSample } = await import("./pageLoadTiming");
    expect(pageLoadSample(nav())).toEqual({ load_ms: 2346, ttfb_ms: 120, dcl_ms: 1500, nav_type: "navigate" });
  });

  it("is null for no entry, an unfinished load, or an implausible one (a backgrounded tab)", async () => {
    const { pageLoadSample } = await import("./pageLoadTiming");
    expect(pageLoadSample(undefined)).toBeNull();
    expect(pageLoadSample(nav({ loadEventEnd: 0 }))).toBeNull();
    expect(pageLoadSample(nav({ loadEventEnd: 700_000 }))).toBeNull();
  });
});

describe("reportPageLoadOnce", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    track.mockReset();
  });

  const setup = async (webdriver: boolean) => {
    vi.resetModules();
    // jsdom defines neither; the browser does.
    Object.defineProperty(navigator, "webdriver", { value: webdriver, configurable: true });
    Object.defineProperty(performance, "getEntriesByType", {
      value: () => [nav()] as unknown as PerformanceEntryList,
      configurable: true,
    });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const mod = await import("./pageLoadTiming");
    return mod;
  };

  it("sends one page_load sample per document, however often it is called", async () => {
    const { reportPageLoadOnce } = await setup(false);
    reportPageLoadOnce();
    reportPageLoadOnce();
    vi.runAllTimers();
    reportPageLoadOnce();
    vi.runAllTimers();
    vi.useRealTimers();
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("page_load", expect.objectContaining({ load_ms: 2346 }));
  });

  it("an automated browser (navigator.webdriver) sends nothing: CI journeys are not users", async () => {
    const { reportPageLoadOnce } = await setup(true);
    reportPageLoadOnce();
    vi.runAllTimers();
    vi.useRealTimers();
    expect(track).not.toHaveBeenCalled();
  });
});
