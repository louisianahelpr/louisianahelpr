/**
 * Q2804 (Sentry JAVASCRIPT-5K, 2026-11-14 22:45Z, release 391ec43df8, /home, iOS in-app browser):
 * "TypeError: undefined is not an object (evaluating '(await p(()=>import(`./NotificationPanel-DiGIjVix.js`),
 * __vite__mapDeps([0,...]))).default')", source NotificationBell.load.
 *
 * The bell fetched its panel with a bare import(). When main.tsx's vite:preloadError handler starts a stale-chunk
 * recovery reload it calls preventDefault(), and Vite's preload helper then RESOLVES the import with `undefined`;
 * `mod.default` threw, and the catch reported the reload under way as a member error. The bell now loads through
 * loadModule (the hands-off helper src/test/lazyLoadersUseChunkRecovery.test.ts holds to the shared recovery):
 * null while the page reloads, quiet, and the next tap retries; any other failure is still reported. And WebKit's
 * wording of that read (the whole `(await p(...)).default` expression) is now a chunk error to isChunkLoadError, so
 * a boundary that meets it shows the reloading state instead of reporting it.
 *
 * @mutate src/components/notificationPanel/NotificationBell.tsx |     const mod = await loadModule(() => import("@/components/NotificationPanel")); |     const mod = await import("@/components/NotificationPanel");
 * @mutate src/lib/chunkReload.ts | /undefined is not an object \(evaluating '[^']*\.default'\)/i | /undefined is not an object \(evaluating '[\w$.]*\.default'\)/i
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const report = vi.fn();
const panelLoad = vi.hoisted(() => ({ mode: "undefined" as "undefined" | "reject" | "real" }));

vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => report(...a), installGlobalErrorHandlers: vi.fn() }));
vi.mock("@/lib/loadModule", async (orig) => {
  const real = await orig<typeof import("@/lib/loadModule")>();
  return {
    ...real,
    // What the build's preload helper hands loadModule: undefined while a recovery reload is under way, or a rejection.
    loadModule: (load: () => Promise<unknown>) =>
      panelLoad.mode === "undefined" ? real.loadModule(async () => undefined)
        : panelLoad.mode === "reject" ? real.loadModule(async () => { throw new TypeError("Cannot read properties of undefined (reading 'title')"); })
          : real.loadModule(load),
  };
});
vi.mock("@/components/NotificationPanel", () => ({ default: () => <p>the real panel</p> }));
vi.mock("@/lib/routePrefetch", () => ({ whenPageSettled: (fn: () => void) => { fn(); return () => {}; } }));
vi.mock("@/components/notificationPanel/notificationFeed", () => ({ prefetchNotificationList: vi.fn(), prefetchOnIntent: {} }));
vi.mock("@/components/notificationPanel/useBellMessagesUnread", () => ({ useBellMessagesUnread: () => 0 }));
vi.mock("@/components/notificationPanel/NotificationTrigger", () => ({
  NotificationTrigger: (p: { onClick?: () => void }) => <button type="button" onClick={p.onClick}>bell</button>,
}));

import { isChunkLoadError } from "@/lib/chunkReload";

const SENTRY_5K = "undefined is not an object (evaluating '(await p(()=>import(`./NotificationPanel-DiGIjVix.js`),__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61]))).default')";

afterEach(() => { report.mockReset(); vi.resetModules(); });

const renderBell = async () => {
  const { default: NotificationBell } = await import("@/components/notificationPanel/NotificationBell");
  render(<NotificationBell />);
};

describe("the bell's panel import during a stale-chunk recovery (Q2804)", () => {
  it("WebKit's wording of the prevented import's read is a chunk error", () => {
    expect(isChunkLoadError(new TypeError(SENTRY_5K))).toBe(true);
    // Not every undefined read: a bug reading another field is not a chunk error.
    expect(isChunkLoadError(new TypeError("undefined is not an object (evaluating 'job.title')"))).toBe(false);
  });

  it("an import resolved undefined (recovery reload under way) is quiet and leaves the bell a bell", async () => {
    panelLoad.mode = "undefined";
    await renderBell();
    await waitFor(() => expect(screen.getByRole("button", { name: "bell" })).toBeTruthy());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("the real panel")).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });

  it("any other load failure is still reported", async () => {
    panelLoad.mode = "reject";
    await renderBell();
    await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    expect(report.mock.calls[0][1]).toEqual({ tags: { source: "NotificationBell.load" } });
  });

  it("a module that loads swaps in the real panel (floor: the path is live)", async () => {
    panelLoad.mode = "real";
    await renderBell();
    expect(await screen.findByText("the real panel")).toBeTruthy();
    expect(report).not.toHaveBeenCalled();
  });
});
