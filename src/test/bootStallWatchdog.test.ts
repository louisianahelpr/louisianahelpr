// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.louisianahelpr.com/?fbclid=x"}
/**
 * A BOOT THAT STALLS IS RETRIED AND SEEN (owner, 2026-10-09). A Facebook link
 * sat on the startup screen (the H + sliding bar) until the owner refreshed
 * by hand, and error_logs had nothing: index.html's watchdog only woke on a
 * script "error" event, and a request that simply never finishes fires none.
 *
 * Runs the REAL inline watchdog out of index.html. Still on the boot screen
 * after 20 s, visible and online: it posts a `boot-stall` row naming the
 * /assets/ script that never finished, then takes the same budgeted recovery
 * as the error path (a fresh reload, or "Helpr couldn't load." once spent).
 * Controls: a booted page, and a hidden tab until it is looked at.
 */
// @mutate index.html |         setTimeout(stallCheck, STALL_MS);\n      })(); |       })();
// @mutate index.html |           recover(pending[0] \|\| ""); |           void pending;
// @mutate index.html |           if (document.visibilityState === "hidden") { setTimeout(stallCheck, 5000); return; } |           if (false) { setTimeout(stallCheck, 5000); return; }
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { scriptElements } from "../../scripts/csp/inline-scripts.mjs";

const html = readFileSync(resolve(__dirname, "../..", "index.html"), "utf8");
const watchdog = (scriptElements(html) as { body: string }[]).find((s) => s.body.includes('"helpr_chunk_reload_at"'))!;
const run = () => new Function(watchdog.body)();

let fetchMock: ReturnType<typeof vi.fn>;
let visibility: DocumentVisibilityState = "visible";
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
    '<script type="module" src="/assets/index-stuck.js"></script>';
  document.body.innerHTML = '<div id="boot-loader"></div>';
  localStorage.clear();
  sessionStorage.clear();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const spendBudget = () => {
  sessionStorage.setItem("helpr_chunk_reload_at", String(Date.now()));
  sessionStorage.setItem("helpr_chunk_reload_count", "4");
};

describe("index.html boot watchdog: a stall with no error", () => {
  it("logs the stalled script at 20 s and, with the retries spent, says so", async () => {
    spendBudget();
    run();
    await vi.advanceTimersByTimeAsync(19_900);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    const [stall, screen] = rows();
    expect(stall.message).toBe("Boot stalled 20s on the startup screen (/assets/index-stuck.js)");
    expect(stall.tags).toMatchObject({ source: "BootWatchdog", kind: "boot-stall", screen: "/" });
    expect(stall.context.pending).toEqual(["/assets/index-stuck.js"]);
    expect(screen.tags.kind).toBe("user-error-screen");
    expect(document.getElementById("boot-loader")?.textContent).toMatch(/Helpr couldn't load\./);
  });

  it("with retries left, takes a budgeted fresh reload (the refresh the owner had to do by hand)", async () => {
    run();
    await vi.advanceTimersByTimeAsync(20_100);
    expect(rows()[0].tags.kind).toBe("boot-stall");
    expect(sessionStorage.getItem("helpr_chunk_reload_count")).toBe("1");
    // It re-fetches the stalled script fresh before reloading.
    expect(fetchMock.mock.calls.some(([url, init]) => url === "/assets/index-stuck.js" && (init as RequestInit).cache === "reload")).toBe(true);
    // No failure screen: a reload is under way, not a give-up.
    expect(document.getElementById("boot-loader")?.textContent).not.toMatch(/couldn't load/);
  });

  it("control: a page that booted is left alone", async () => {
    run();
    document.getElementById("boot-loader")!.remove();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("helpr_chunk_reload_count")).toBeNull();
  });

  it("control: a hidden tab is not judged until it is looked at", async () => {
    visibility = "hidden";
    run();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rows()).toEqual([]);
    visibility = "visible";
    await vi.advanceTimersByTimeAsync(5_100);
    expect(rows()[0].tags.kind).toBe("boot-stall");
  });
});
