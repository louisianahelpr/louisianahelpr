// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.louisianahelpr.com/sponsor"}
/**
 * THE BOOT WATCHDOG NEVER RELOADS IN A LOOP, AND A SCANNER IS NOT LOGGED
 * (hourly error sweep, 2026-11-17). One "Firefox/116.0" client sent 10 boot-stall
 * and 9 "Boot failed" rows in 19 s. Every stall row said attempt 0, and the
 * rows came ~2 s apart though each one is written 20 s after its own page
 * opened: ten pages opened side by side, not one page reloading itself.
 * Every row had url and route null, which a real browser cannot send
 * (location.pathname is always a string), and none of the 14 boot scripts
 * was ever fetched: an email link scanner, not a person.
 *
 * Runs the REAL inline watchdog out of index.html:
 *  - one session, page after page stalling: at most 4 reloads, then the
 *    "Helpr couldn't load." screen and no more reloads;
 *  - storage blocked on a page that is itself a recovery reload: no reload;
 *  - an emulated page whose location has no pathname posts nothing.
 */
// @mutate index.html |           if (typeof location.pathname !== "string") return; |           void 0;
// @mutate index.html |           if (count >= SCHEDULE.length) return -1; |           if (false) return -1;
// @mutate index.html |            if (!writeAttempt(st.count + 1) && (st.count > 0 \|\| recentRecoveryReload())) { |            if (!writeAttempt(st.count + 1) && false) {
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { scriptElements } from "../../scripts/csp/inline-scripts.mjs";

const html = readFileSync(resolve(__dirname, "../..", "index.html"), "utf8");
const watchdog = (scriptElements(html) as { body: string }[]).find((s) => s.body.includes('"helpr_chunk_reload_at"'))!;

let fetchMock: ReturnType<typeof vi.fn>;
let removeListeners: (() => void) | null = null;

const rows = () =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith("/rest/v1/error_logs"))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
// reloadFresh re-fetches the stalled script with cache: "reload" right before
// it navigates; one such fetch is one reload.
const reloads = () =>
  fetchMock.mock.calls.filter(([url, init]) => url === "/assets/index-stuck.js" && (init as RequestInit)?.cache === "reload").length;

const freshPage = () => {
  document.head.innerHTML =
    '<meta name="lh-supabase-url" content="https://proj.supabase.co" />' +
    '<meta name="lh-supabase-key" content="sb_publishable_test" />' +
    '<script type="module" src="/assets/index-stuck.js"></script>';
  document.body.innerHTML = '<div id="boot-loader"></div>';
};

beforeEach(() => {
  vi.useFakeTimers();
  freshPage();
  localStorage.clear();
  sessionStorage.clear();
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => "visible");
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

describe("index.html boot watchdog: no reload loop", () => {
  it("one session, every page stalls: 4 reloads at most, then the failure screen and no more", async () => {
    const pages = 8;
    for (let i = 0; i < pages; i++) {
      freshPage();
      new Function(watchdog.body)();
      await vi.advanceTimersByTimeAsync(65_000);
    }
    // Floor: the probe sees reloads at all, so the cap below is not a probe that counts nothing.
    expect(reloads()).toBeGreaterThan(0);
    expect(reloads()).toBe(4);
    expect(document.getElementById("boot-loader")?.textContent).toMatch(/Helpr couldn't load\./);
    expect(sessionStorage.getItem("helpr_chunk_reload_count")).toBe("4");
  });

  it("storage blocked on a page that is already a recovery reload: no reload, the failure screen", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    window.history.replaceState(null, "", "/sponsor?_v=" + Date.now());
    new Function(watchdog.body)();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(reloads()).toBe(0);
    expect(document.getElementById("boot-loader")?.textContent).toMatch(/Helpr couldn't load\./);
    window.history.replaceState(null, "", "/sponsor");
  });

  it("an emulated page whose location has no pathname posts nothing (the 2026-11-17 Firefox/116 scanner)", async () => {
    const fake = { hostname: "www.louisianahelpr.com", href: undefined, pathname: undefined };
    new Function("location", watchdog.body)(fake);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(rows()).toEqual([]);
  });

  it("control: the same run with a real location posts the stall row", async () => {
    new Function("location", watchdog.body)(window.location);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(rows().length).toBeGreaterThan(0);
    expect(rows()[0].tags.kind).toBe("boot-stall");
    expect(rows()[0].url).toBe("/sponsor");
  });
});
