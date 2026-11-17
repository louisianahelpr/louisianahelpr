// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.louisianahelpr.com/sponsor"}
/**
 * Q2818/Q2819 (owner 11-17, "fix all the health alerts"): visitors from the sponsor emails sat on the startup screen
 * for 20 s on /sponsor and /gift-guides with "boot scripts unfinished: 0": every boot script had arrived, yet the app
 * never drew, and only the watchdog's reload at 20 s cured it (a `boot-stall-recovered` row ~3 s later each time).
 *
 * With nothing left downloading and the entry module dead (it threw, or never started: main.tsx sets
 * window.__lhEntryRan first thing), waiting is pointless. The REAL inline watchdog from index.html now takes the
 * same budgeted reload at 8 s, and the stall row carries what was missing before: the uncaught errors before the
 * first commit, whether the entry ran, and navigator.webdriver (link scanners).
 * Controls: an entry that ran cleanly keeps the full 20 s, and so does a script still downloading.
 */
// @mutate index.html |         setTimeout(earlyCheck, EARLY_MS); |         void earlyCheck;
// @mutate index.html |           if (window.__lhEntryRan && !preBootErrors.length) return; |           if (window.__lhEntryRan \|\| true) return;
// @mutate index.html |           if (unfinished().length) return;\n          stallCheck(true); |           stallCheck(true);
// @mutate index.html |           if (!t \|\| t === window \|\| !t.tagName) { notePreBoot(ev.message); return; } |           if (!t \|\| t === window \|\| !t.tagName) { return; }
// @mutate index.html | early: early === true, entryRan: !!window.__lhEntryRan, errors: preBootErrors, | early: early === true, entryRan: !!window.__lhEntryRan, errors: [],
// @mutate src/main.tsx | window.__lhEntryRan = Date.now(); | void Date.now();
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { scriptElements } from "../../scripts/csp/inline-scripts.mjs";

const html = readFileSync(resolve(__dirname, "../..", "index.html"), "utf8");
const mainSrc = readFileSync(resolve(__dirname, "..", "main.tsx"), "utf8");
const watchdog = (scriptElements(html) as { body: string }[]).find((s) => s.body.includes('"helpr_chunk_reload_at"'))!;
const run = () => new Function(watchdog.body)();
const w = window as unknown as { __lhEntryRan?: number };

let fetchMock: ReturnType<typeof vi.fn>;
let arrived: string[] = [];
let removeListeners: (() => void) | null = null;

const rows = () =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith("/rest/v1/error_logs"))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));

beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML =
    '<meta name="lh-supabase-url" content="https://proj.supabase.co" />' +
    '<meta name="lh-supabase-key" content="sb_publishable_test" />' +
    '<script type="module" src="/assets/index-a.js"></script>' +
    '<link rel="modulepreload" href="/assets/react-vendor-b.js" />';
  document.body.innerHTML = '<div id="boot-loader"></div>';
  localStorage.clear();
  sessionStorage.clear();
  delete w.__lhEntryRan;
  arrived = ["/assets/index-a.js", "/assets/react-vendor-b.js"];
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(document, "readyState", "get").mockReturnValue("interactive");
  vi.spyOn(performance, "getEntriesByType").mockImplementation(
    () => arrived.map((p) => ({ name: "https://www.louisianahelpr.com" + p, responseEnd: 120 })) as unknown as PerformanceEntryList,
  );
  fetchMock = vi.fn(async () => ({ status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  const added: [string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined][] = [];
  const orig = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((t, l, o) => {
    added.push([t, l, o]);
    orig(t, l, o);
  });
  removeListeners = () => added.forEach(([t, l, o]) => window.removeEventListener(t, l, o));
});

afterEach(() => {
  removeListeners?.();
  delete w.__lhEntryRan;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("index.html boot watchdog: everything arrived, nothing drew (Q2818)", () => {
  it("main.tsx marks the entry as run, as the watchdog reads it", () => {
    expect(mainSrc).toMatch(/^window\.__lhEntryRan = Date\.now\(\);$/m);
  });

  it("entry never ran: reloads at 8 s, not 20 s, and says so in the row", async () => {
    run();
    await vi.advanceTimersByTimeAsync(7_900);
    expect(rows()).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    const [stall] = rows();
    expect(stall.message).toBe("Boot stalled 8s on the startup screen (boot scripts unfinished: 0)");
    expect(stall.tags).toMatchObject({ source: "BootWatchdog", kind: "boot-stall", screen: "/sponsor" });
    expect(stall.context).toMatchObject({ early: true, entryRan: false, pending: [], errors: [], webdriver: false });
    expect(sessionStorage.getItem("helpr_chunk_reload_count")).toBe("1");
    // One row only: the later full-length check sees the episode already handled.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(rows().filter((r) => r.tags.kind === "boot-stall").length).toBe(1);
  });

  it("entry ran but threw before the first commit: the error rides on the row, reload at 8 s", async () => {
    run();
    w.__lhEntryRan = Date.now();
    window.dispatchEvent(new ErrorEvent("error", { message: "TypeError: boom in App" }));
    await vi.advanceTimersByTimeAsync(8_100);
    const [stall] = rows();
    expect(stall.context.early).toBe(true);
    expect(stall.context.entryRan).toBe(true);
    expect(stall.context.errors).toEqual(["TypeError: boom in App"]);
  });

  it("control: an entry that ran cleanly keeps the full 20 s", async () => {
    run();
    w.__lhEntryRan = Date.now();
    await vi.advanceTimersByTimeAsync(19_900);
    // Floor: the probe that reads none here reads the full-length row below.
    expect(rows()).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(rows().length).toBeGreaterThan(0);
    expect(rows()[0].context).toMatchObject({ early: false, entryRan: true });
    expect(rows()[0].message).toBe("Boot stalled 20s on the startup screen (boot scripts unfinished: 0)");
  });

  it("control: a script still downloading keeps the full 20 s", async () => {
    arrived = ["/assets/index-a.js"];
    run();
    await vi.advanceTimersByTimeAsync(19_900);
    expect(rows()).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(rows()[0].context).toMatchObject({ early: false, pending: ["/assets/react-vendor-b.js"] });
  });

  it("control: a booted page is left alone", async () => {
    run();
    document.getElementById("boot-loader")!.remove();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
