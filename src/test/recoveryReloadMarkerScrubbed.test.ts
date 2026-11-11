/**
 * F359n (audit 11-10): after an offline recovery the address read
 * /declutter/item/<id>?_v=1794341313312 and a shared or copied link carried the
 * number. Boot scrubs `_v` with replaceState once #boot-loader is gone (index.html's
 * watchdog reads `_v` from the address until then), and the storage-blocked guard
 * (landedFromRecentRecoveryReload) still knows this page was a recovery reload.
 */
// @mutate src/lib/chunkReload.ts | scrubbedRecoveryMarker = Number(url.searchParams.get("_v") \|\| "0") \|\| 0;\n  url.searchParams.delete("_v"); | scrubbedRecoveryMarker = Number(url.searchParams.get("_v") \|\| "0") \|\| 0;\n  url.searchParams.delete("_nope");
// @mutate src/lib/chunkReload.ts | const booted = () => document.readyState !== "loading" && !document.getElementById("boot-loader"); | const booted = () => true;
// @mutate src/lib/chunkReload.ts | const v = scrubbedRecoveryMarker \|\| Number( | const v = Number(
// @mutate src/main.tsx | scrubRecoveryReloadMarker();\n// WebKit | // WebKit
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetChunkReloadForTests,
  getChunkRecoveryDecline,
  recoverFromChunkError,
  SCRUB_POLL_MS,
  scrubRecoveryReloadMarker,
} from "@/lib/chunkReload";

const originalLocation = window.location;
const setHref = (href: string) =>
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, href, pathname: new URL(href).pathname, replace: vi.fn() },
    configurable: true,
    writable: true,
  });

beforeEach(() => {
  __resetChunkReloadForTests();
  sessionStorage.clear();
});
afterEach(() => {
  __resetChunkReloadForTests();
  vi.restoreAllMocks();
  Object.defineProperty(window, "location", { value: originalLocation, configurable: true, writable: true });
});

describe("the recovery reload's _v is scrubbed from the address (F359n)", () => {
  it("takes only _v off the address, keeping the path and the other params", () => {
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    setHref(`http://localhost/declutter/item/de8ae5ef?tab=photos&_v=${Date.now() - 1_000}`);
    scrubRecoveryReloadMarker();
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(String(replaceState.mock.calls[0][2])).toBe("http://localhost/declutter/item/de8ae5ef?tab=photos");
  });

  it("waits for the boot loader to go (index.html's watchdog reads _v from the address until then)", () => {
    vi.useFakeTimers();
    try {
      const loader = document.createElement("div");
      loader.id = "boot-loader";
      document.body.appendChild(loader);
      const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
      setHref(`http://localhost/declutter/item/de8ae5ef?_v=${Date.now() - 1_000}`);
      scrubRecoveryReloadMarker();
      vi.advanceTimersByTime(SCRUB_POLL_MS * 4);
      expect(replaceState).not.toHaveBeenCalled();
      loader.remove();
      vi.advanceTimersByTime(SCRUB_POLL_MS);
      expect(replaceState).toHaveBeenCalledTimes(1);
      expect(String(replaceState.mock.calls[0][2])).toBe("http://localhost/declutter/item/de8ae5ef");
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves an address without _v alone", () => {
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    setHref("http://localhost/declutter/item/de8ae5ef");
    scrubRecoveryReloadMarker();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("still remembers it was a recovery reload: with storage blocked, recovery declines instead of looping", () => {
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    setHref(`http://localhost/declutter/item/de8ae5ef?_v=${Date.now() - 1_000}`);
    scrubRecoveryReloadMarker();
    setHref("http://localhost/declutter/item/de8ae5ef"); // what replaceState did to the address
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(recoverFromChunkError()).toBe(false);
    expect(getChunkRecoveryDecline()).toMatchObject({ reason: "storage_blocked_after_reload", count: 0 });
  });
});
