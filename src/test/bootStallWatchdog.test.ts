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
// @mutate index.html | (boot scripts unfinished: " + pending.length + ")" | (" + pending.join(", ") + ")"
// @mutate index.html |           try { sessionStorage.setItem(STALL_FLAG, String(Date.now())); } catch (e) { /* no storage: no recovery report */ } |           void STALL_FLAG;
// @mutate index.html |           if (document.readyState === "loading" \|\| !booted()) { |           if (!booted()) {
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
    // Q1633: the class, not the hashed file names (they change every deploy
    // and the ledger keys its item on the message); the files are in context.
    expect(stall.message).toBe("Boot stalled 20s on the startup screen (boot scripts unfinished: 1)");
    expect(stall.message).not.toMatch(/\/assets\//);
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
    // Floor: the same probe that read no rows above reads one now, so that
    // empty list was the watchdog waiting, not a probe that sees nothing.
    expect(rows().length).toBeGreaterThan(0);
    expect(rows()[0].tags.kind).toBe("boot-stall");
  });

  it("Q1633: the page after a stall's reload reports, once, that it booted", async () => {
    run();
    await vi.advanceTimersByTimeAsync(20_100);
    expect(rows()[0].tags.kind).toBe("boot-stall");
    const at = sessionStorage.getItem("helpr_boot_stall_at");
    expect(Number(at)).toBeGreaterThan(0);
    // The reload: a fresh document runs the watchdog again, with #boot-loader
    // parsed, and the app commits (removes it) a moment later.
    removeListeners?.();
    fetchMock.mockClear();
    document.body.innerHTML = '<div id="boot-loader"></div>';
    run();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(rows()).toEqual([]);
    document.getElementById("boot-loader")!.remove();
    await vi.advanceTimersByTimeAsync(600);
    const recovered = rows();
    expect(recovered.length).toBe(1);
    expect(recovered[0]).toMatchObject({ severity: "info", tags: { kind: "boot-stall-recovered", source: "BootWatchdog" } });
    expect(sessionStorage.getItem("helpr_boot_stall_at")).toBeNull();
    // Once only.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rows().length).toBe(1);
  });

  it("control: no stall before, no recovery row; a page still loading is not 'booted'", async () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    sessionStorage.setItem("helpr_boot_stall_at", String(Date.now()));
    document.body.innerHTML = ""; // <head> time: #boot-loader not parsed yet
    run();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(rows().filter((r) => r.tags.kind === "boot-stall-recovered")).toEqual([]);
    vi.restoreAllMocks();
    sessionStorage.clear();
    fetchMock = vi.fn(async () => ({ status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    document.body.innerHTML = "";
    run();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(rows()).toEqual([]);
  });
});
