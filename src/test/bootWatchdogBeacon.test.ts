// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://louisianahelpr.com/browse"}
/**
 * Q229 — a boot-watchdog failure reaches error_logs from the device that saw it.
 *
 * index.html's inline watchdog shows "Helpr couldn't load. We've logged it."
 * when the entry module graph will not load. It used to write only a
 * localStorage record that main.tsx reports on the NEXT successful boot of the
 * same device, so a visitor who never came back was never seen, and "We've
 * logged it" was untrue. The watchdog now POSTs the row itself.
 *
 * This runs the REAL inline script out of index.html (not a copy), on a prod
 * host, with the retry budget spent, and asserts the request, its tags (the
 * ones trg_error_logs_zz_user_error_screen keys on), and that a landed post
 * marks the record `sent` so main.tsx does not report it twice. Controls:
 * offline and localhost never post.
 */
// @mutate index.html | if (!offline) beacon(rec); | if (false) beacon(rec);
// @mutate index.html | tags: { source: "BootWatchdog", kind: "user-error-screen", | tags: { source: "BootWatchdog",
// @mutate src/main.tsx | if (!rec.offline && !rec.sent) { | if (!rec.offline) {
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { scriptElements } from "../../scripts/csp/inline-scripts.mjs";

const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const watchdogs = (scriptElements(html) as { body: string }[]).filter((s) => s.body.includes('"helpr_chunk_reload_at"'));

const run = (body: string) => new Function(body)();

let fetchMock: ReturnType<typeof vi.fn>;
let removeListeners: (() => void) | null = null;

beforeEach(() => {
  document.head.innerHTML =
    '<meta name="lh-supabase-url" content="https://proj.supabase.co" />' +
    '<meta name="lh-supabase-key" content="sb_publishable_test" />';
  document.body.innerHTML = '<div id="boot-loader"></div>';
  localStorage.clear();
  sessionStorage.clear();
  // The retry budget is spent: the watchdog shows the failure now.
  sessionStorage.setItem("helpr_chunk_reload_at", String(Date.now()));
  sessionStorage.setItem("helpr_chunk_reload_count", "4");
  fetchMock = vi.fn(async () => ({ status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  // Every run adds a capture listener to window; drop them between tests.
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const failEntry = () => {
  const s = document.createElement("script");
  s.src = "/assets/index-deadbeef.js";
  document.head.appendChild(s);
  s.dispatchEvent(new Event("error"));
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("index.html boot watchdog (Q229)", () => {
  it("inventory: exactly one watchdog script in index.html", () => {
    expect(watchdogs.length).toBe(1);
  });

  it("posts the failure to error_logs at once, tagged as a user error screen", async () => {
    run(watchdogs[0].body);
    failEntry();
    await flush();
    expect(document.getElementById("boot-loader")?.textContent).toMatch(/Helpr couldn't load\./);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/rest/v1/error_logs");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect((init.headers as Record<string, string>).apikey).toBe("sb_publishable_test");
    const row = JSON.parse(String(init.body));
    expect(row.severity).toBe("error");
    expect(row.message).toMatch(/^Boot failed: entry module graph did not load \(\/assets\/index-deadbeef\.js\)$/);
    expect(row.tags).toMatchObject({ source: "BootWatchdog", kind: "user-error-screen", screen: "/browse" });
    // The post landed: the record says so, so main.tsx does not report it again.
    await flush();
    expect(JSON.parse(localStorage.getItem("helpr_boot_failure") ?? "{}").sent).toBe(true);
  });

  it("a post that fails leaves the record unsent, for main.tsx to report on the next boot", async () => {
    fetchMock.mockImplementation(async () => ({ status: 500 }));
    run(watchdogs[0].body);
    failEntry();
    await flush();
    await flush();
    const rec = JSON.parse(localStorage.getItem("helpr_boot_failure") ?? "{}");
    expect(rec.src).toBe("/assets/index-deadbeef.js");
    expect(rec.sent).toBeUndefined();
  });

  it("control: offline never posts", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    run(watchdogs[0].body);
    failEntry();
    await flush();
    expect(document.getElementById("boot-loader")?.textContent).toMatch(/You're offline\./);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("control: an unsubstituted %VITE_…% placeholder never posts", async () => {
    document.head.innerHTML =
      '<meta name="lh-supabase-url" content="%VITE_SUPABASE_URL%" />' +
      '<meta name="lh-supabase-key" content="%VITE_SUPABASE_PUBLISHABLE_KEY%" />';
    run(watchdogs[0].body);
    failEntry();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("main.tsx skips a record the beacon already sent", () => {
    const main = readFileSync(resolve(ROOT, "src/main.tsx"), "utf8");
    const block = main.slice(main.indexOf("helpr_boot_failure"));
    expect(block).toMatch(/if \(!rec\.offline && !rec\.sent\)/);
  });
});
