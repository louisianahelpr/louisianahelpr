import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHUNK_RELOAD_BACKOFF_MS,
  CHUNK_RELOAD_EPISODE_MS,
  CHUNK_RELOAD_MAX_ATTEMPTS,
  __resetChunkReloadForTests,
  markChunkLoadSucceeded,
  recoverFromChunkError,
} from "./chunkReload";

/**
 * The reload itself is `window.location.replace(...)` at the end of
 * hardReloadBypassCache (after its awaited SW/cache purges), so that is what
 * these tests count. sessionStorage is real jsdom storage, which survives a
 * "reload" here exactly as it does across a real one.
 */
let replace: ReturnType<typeof vi.fn>;
const originalLocation = window.location;

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const setOnline = (online: boolean) => {
  Object.defineProperty(window.navigator, "onLine", { value: online, configurable: true });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
  sessionStorage.clear();
  __resetChunkReloadForTests();
  setOnline(true);
  replace = vi.fn();
  Object.defineProperty(window, "location", {
    value: { href: "https://www.louisianahelpr.com/browse", replace },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  __resetChunkReloadForTests();
  vi.useRealTimers();
  Object.defineProperty(window, "location", { value: originalLocation, configurable: true, writable: true });
  setOnline(true);
});

describe("recoverFromChunkError", () => {
  it("(a) a first reload that lands on the stale build gets exactly one more attempt after the backoff", async () => {
    expect(recoverFromChunkError()).toBe(true);
    await flush();
    expect(replace).toHaveBeenCalledTimes(1);

    // The reload landed on the OLD build: the chunk 404s again 1s later.
    vi.advanceTimersByTime(1_000);
    expect(recoverFromChunkError()).toBe(false); // honest card now, retry pending
    await flush();
    expect(replace).toHaveBeenCalledTimes(1);

    // Just before the backoff elapses: still nothing.
    vi.advanceTimersByTime(CHUNK_RELOAD_BACKOFF_MS - 1_000 - 1);
    await flush();
    expect(replace).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await flush();
    expect(replace).toHaveBeenCalledTimes(2);

    // And nothing further, however long we wait.
    await vi.advanceTimersByTimeAsync(10 * CHUNK_RELOAD_BACKOFF_MS);
    expect(replace).toHaveBeenCalledTimes(2);
  });

  it("(b) N consecutive failures never exceed the cap", async () => {
    for (let i = 0; i < 50; i++) {
      recoverFromChunkError();
      await vi.advanceTimersByTimeAsync(CHUNK_RELOAD_BACKOFF_MS / 3);
    }
    // 50 failures x 10s = 500s, longer than an episode: steady failure must
    // keep the episode alive rather than earn a fresh pair of reloads.
    await vi.advanceTimersByTimeAsync(CHUNK_RELOAD_BACKOFF_MS * 2);
    expect(replace.mock.calls.length).toBeLessThanOrEqual(CHUNK_RELOAD_MAX_ATTEMPTS);
    expect(replace).toHaveBeenCalledTimes(CHUNK_RELOAD_MAX_ATTEMPTS);
    expect(recoverFromChunkError()).toBe(false);
  });

  it("(b) repeated calls while the retry is pending schedule only one timer", async () => {
    recoverFromChunkError();
    for (let i = 0; i < 20; i++) recoverFromChunkError();
    await vi.advanceTimersByTimeAsync(CHUNK_RELOAD_BACKOFF_MS * 3);
    expect(replace).toHaveBeenCalledTimes(2);
  });

  it("(c) offline never reloads, immediately or via the pending retry", async () => {
    setOnline(false);
    expect(recoverFromChunkError()).toBe(false);
    await vi.advanceTimersByTimeAsync(CHUNK_RELOAD_EPISODE_MS);
    expect(replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("helpr_chunk_reload_count")).toBeNull();

    // Online for attempt 1, then offline before the backoff retry fires.
    setOnline(true);
    expect(recoverFromChunkError()).toBe(true);
    await flush();
    vi.advanceTimersByTime(1_000);
    expect(recoverFromChunkError()).toBe(false);
    setOnline(false);
    await vi.advanceTimersByTimeAsync(CHUNK_RELOAD_BACKOFF_MS * 2);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("(d) a successful load resets the counter", async () => {
    // Exhaust both attempts.
    recoverFromChunkError();
    await flush();
    vi.advanceTimersByTime(1_000);
    recoverFromChunkError();
    await vi.advanceTimersByTimeAsync(CHUNK_RELOAD_BACKOFF_MS);
    expect(replace).toHaveBeenCalledTimes(2);
    expect(recoverFromChunkError()).toBe(false);

    // A success right after an attempt must NOT reset (that would loop).
    markChunkLoadSucceeded();
    expect(sessionStorage.getItem("helpr_chunk_reload_count")).toBe("2");

    // Once the app has run stably, a successful chunk load clears it.
    vi.advanceTimersByTime(CHUNK_RELOAD_EPISODE_MS);
    markChunkLoadSucceeded();
    expect(sessionStorage.getItem("helpr_chunk_reload_count")).toBeNull();
    expect(sessionStorage.getItem("helpr_chunk_reload_at")).toBeNull();

    // The next deploy gets a fresh immediate attempt.
    expect(recoverFromChunkError()).toBe(true);
    await flush();
    expect(replace).toHaveBeenCalledTimes(3);
  });

  it("without usable sessionStorage, reloads once and never again from the reloaded page", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      expect(recoverFromChunkError()).toBe(true);
      await flush();
      expect(replace).toHaveBeenCalledTimes(1);
      // Simulate landing on the reloaded URL (module state would be fresh too).
      window.location.href = String(replace.mock.calls[0][0]);
      __resetChunkReloadForTests();
      vi.advanceTimersByTime(2_000);
      for (let i = 0; i < 10; i++) expect(recoverFromChunkError()).toBe(false);
      await vi.advanceTimersByTimeAsync(CHUNK_RELOAD_BACKOFF_MS * 3);
      expect(replace).toHaveBeenCalledTimes(1);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it("honours a guard armed the old way (timestamp only) as one spent attempt", async () => {
    sessionStorage.setItem("helpr_chunk_reload_at", String(Date.now()));
    expect(recoverFromChunkError()).toBe(false);
    await flush();
    expect(replace).not.toHaveBeenCalled();
  });
});
