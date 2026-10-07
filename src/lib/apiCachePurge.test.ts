/**
 * Q1264 (1) (lh-authz-rls review of Q1174): an old service worker still in
 * control after the sign-out purge can re-write `api-cache` (control passes to
 * the new worker asynchronously), so the purge runs again on every
 * `controllerchange`, and main.tsx wires it on load.
 *
 * @mutate src/lib/apiCachePurge.ts |   navigator.serviceWorker.addEventListener("controllerchange", onChange); |   void onChange;
 * @mutate src/main.tsx |     purgeApiCacheOnControllerChange(); |
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { purgeApiCache, purgeApiCacheOnControllerChange } from "./apiCachePurge";

describe("api-cache purge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deletes the legacy api-cache", async () => {
    const del = vi.fn(async () => true);
    vi.stubGlobal("caches", { delete: del });
    await purgeApiCache();
    expect(del).toHaveBeenCalledWith("api-cache");
  });

  it("Q1264 (1): purges again each time a new service worker takes control", async () => {
    const del = vi.fn(async () => true);
    vi.stubGlobal("caches", { delete: del });
    const sw = new EventTarget();
    Object.defineProperty(navigator, "serviceWorker", { value: sw, configurable: true });
    const stop = purgeApiCacheOnControllerChange();
    sw.dispatchEvent(new Event("controllerchange"));
    await Promise.resolve();
    expect(del).toHaveBeenCalledTimes(1);
    stop();
    sw.dispatchEvent(new Event("controllerchange"));
    await Promise.resolve();
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("main.tsx subscribes on load in production", () => {
    const main = readFileSync("src/main.tsx", "utf8");
    expect(main).toMatch(/purgeApiCacheOnControllerChange\(\);/);
  });
});
