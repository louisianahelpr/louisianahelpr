import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHUNK_RELOAD_EPISODE_MS,
  CHUNK_RELOAD_MAX_ATTEMPTS,
  CHUNK_RELOAD_SCHEDULE_MS,
  __resetChunkReloadForTests,
  decideChunkReload,
  isRecoveryReloadInFlight,
  markChunkLoadSucceeded,
  PURGE_STEP_TIMEOUT_MS,
  hardReloadBypassCache,
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

/** Total of the schedule: how long a steadily failing page keeps trying. */
const WHOLE_SCHEDULE_MS = CHUNK_RELOAD_SCHEDULE_MS.reduce((a, b) => a + b, 0);

describe("recoverFromChunkError", () => {
  it("(a) Q199: reloads that land on the stale build keep going on the schedule, quietly, up to the cap", async () => {
    expect(recoverFromChunkError()).toBe(true);
    await flush();
    expect(replace).toHaveBeenCalledTimes(1);

    for (let attempt = 1; attempt < CHUNK_RELOAD_MAX_ATTEMPTS; attempt++) {
      // The reload landed on the OLD build again: the chunk fails 1s later.
      vi.advanceTimersByTime(1_000);
      // Still recovering, so the caller shows its quiet state, not the error card.
      expect(recoverFromChunkError()).toBe(true);
      expect(isRecoveryReloadInFlight()).toBe(true);
      await flush();
      expect(replace).toHaveBeenCalledTimes(attempt);
      // Just before this attempt's delay elapses: nothing yet.
      vi.advanceTimersByTime(CHUNK_RELOAD_SCHEDULE_MS[attempt] - 1_000 - 1);
      await flush();
      expect(replace).toHaveBeenCalledTimes(attempt);
      vi.advanceTimersByTime(1);
      await flush();
      expect(replace).toHaveBeenCalledTimes(attempt + 1);
      __resetChunkReloadForTests(); // the reload replaced the page's module state
    }

    // Spent: the honest card now, and nothing further however long we wait.
    vi.advanceTimersByTime(1_000);
    expect(recoverFromChunkError()).toBe(false);
    await vi.advanceTimersByTimeAsync(10 * WHOLE_SCHEDULE_MS);
    expect(replace).toHaveBeenCalledTimes(CHUNK_RELOAD_MAX_ATTEMPTS);
  });

  it("(a) the schedule rides out about a minute of deploy, and no more than two minutes", () => {
    expect(CHUNK_RELOAD_SCHEDULE_MS).toHaveLength(CHUNK_RELOAD_MAX_ATTEMPTS);
    expect(CHUNK_RELOAD_SCHEDULE_MS[0]).toBe(0);
    expect(WHOLE_SCHEDULE_MS).toBeGreaterThanOrEqual(45_000);
    expect(WHOLE_SCHEDULE_MS).toBeLessThanOrEqual(120_000);
    expect(WHOLE_SCHEDULE_MS).toBeLessThan(CHUNK_RELOAD_EPISODE_MS);
  });

  it("(b) N consecutive failures never exceed the cap", async () => {
    for (let i = 0; i < 80; i++) {
      recoverFromChunkError();
      await vi.advanceTimersByTimeAsync(5_000);
      if (i % 3 === 0) __resetChunkReloadForTests();
    }
    // 80 failures x 5s = 400s, longer than an episode: steady failure must
    // keep the episode alive rather than earn a fresh round of reloads.
    await vi.advanceTimersByTimeAsync(WHOLE_SCHEDULE_MS * 2);
    expect(replace).toHaveBeenCalledTimes(CHUNK_RELOAD_MAX_ATTEMPTS);
    expect(recoverFromChunkError()).toBe(false);
  });

  it("(b) the cap is four reloads, counted independently of the constant", async () => {
    for (let i = 0; i < 20; i++) {
      recoverFromChunkError();
      await vi.advanceTimersByTimeAsync(60_000);
      __resetChunkReloadForTests();
    }
    expect(replace).toHaveBeenCalledTimes(4);
  });

  it("(b) repeated calls while a retry is pending schedule only one timer", async () => {
    recoverFromChunkError();
    await flush();
    for (let i = 0; i < 20; i++) expect(recoverFromChunkError()).toBe(true);
    await vi.advanceTimersByTimeAsync(CHUNK_RELOAD_SCHEDULE_MS[1] + 1);
    expect(replace).toHaveBeenCalledTimes(2);
  });

  it("(c) offline never reloads; a retry pending when the network drops waits for it to return", async () => {
    setOnline(false);
    expect(recoverFromChunkError()).toBe(false);
    await vi.advanceTimersByTimeAsync(CHUNK_RELOAD_EPISODE_MS);
    expect(replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("helpr_chunk_reload_count")).toBeNull();

    // Online for attempt 1, then offline before the scheduled retry fires.
    setOnline(true);
    expect(recoverFromChunkError()).toBe(true);
    await flush();
    vi.advanceTimersByTime(1_000);
    expect(recoverFromChunkError()).toBe(true);
    setOnline(false);
    await vi.advanceTimersByTimeAsync(WHOLE_SCHEDULE_MS);
    expect(replace).toHaveBeenCalledTimes(1);

    setOnline(true);
    window.dispatchEvent(new Event("online"));
    await flush();
    expect(replace).toHaveBeenCalledTimes(2);
  });

  it("(d) a successful load resets the counter", async () => {
    sessionStorage.setItem("helpr_chunk_reload_at", String(Date.now()));
    sessionStorage.setItem("helpr_chunk_reload_count", String(CHUNK_RELOAD_MAX_ATTEMPTS));
    expect(recoverFromChunkError()).toBe(false);

    // A success right after an attempt must NOT reset (that would loop).
    markChunkLoadSucceeded();
    expect(sessionStorage.getItem("helpr_chunk_reload_count")).toBe(String(CHUNK_RELOAD_MAX_ATTEMPTS));

    // Once the app has run stably, a successful chunk load clears it.
    vi.advanceTimersByTime(CHUNK_RELOAD_EPISODE_MS);
    markChunkLoadSucceeded();
    expect(sessionStorage.getItem("helpr_chunk_reload_count")).toBeNull();
    expect(sessionStorage.getItem("helpr_chunk_reload_at")).toBeNull();

    // The next deploy gets a fresh immediate attempt.
    expect(recoverFromChunkError()).toBe(true);
    await flush();
    expect(replace).toHaveBeenCalledTimes(1);
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
      await vi.advanceTimersByTimeAsync(WHOLE_SCHEDULE_MS * 3);
      expect(replace).toHaveBeenCalledTimes(1);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it("honours a guard armed the old way (timestamp only) as one spent attempt: the next waits its turn", async () => {
    sessionStorage.setItem("helpr_chunk_reload_at", String(Date.now()));
    expect(recoverFromChunkError()).toBe(true);
    await flush();
    expect(replace).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CHUNK_RELOAD_SCHEDULE_MS[1]);
    expect(replace).toHaveBeenCalledTimes(1);
  });
});

describe("decideChunkReload (the one decision both layers make)", () => {
  const T = Date.parse("2026-09-12T12:00:00Z");
  it("reloads now on a first failure, waits its turn after, gives up at the cap", () => {
    expect(decideChunkReload({ count: 0, last: 0 }, T, false)).toEqual({ reload: true, delayMs: 0 });
    expect(decideChunkReload({ count: 1, last: T - 1_000 }, T, false)).toEqual({ reload: true, delayMs: 4_000 });
    expect(decideChunkReload({ count: 2, last: T - 1_000 }, T, false)).toEqual({ reload: true, delayMs: 14_000 });
    expect(decideChunkReload({ count: 3, last: T - 50_000 }, T, false)).toEqual({ reload: true, delayMs: 0 });
    expect(decideChunkReload({ count: 4, last: T - 1_000 }, T, false)).toEqual({ reload: false });
  });
  it("never reloads offline", () => {
    expect(decideChunkReload({ count: 0, last: 0 }, T, true)).toEqual({ reload: false });
  });
  it("a spent episode older than the window starts over", () => {
    expect(decideChunkReload({ count: 4, last: T - CHUNK_RELOAD_EPISODE_MS - 1 }, T, false)).toEqual({ reload: true, delayMs: 0 });
    expect(decideChunkReload({ count: 4, last: T - CHUNK_RELOAD_EPISODE_MS }, T, false)).toEqual({ reload: false });
  });
});

/**
 * index.html's boot watchdog runs before the bundle exists, so it carries its
 * own ES5 copy of decideChunkReload between BEGIN/END markers. Q199 was the two
 * layers disagreeing (the watchdog gave up 10s after ANY reload). This runs
 * the watchdog's copy, read from the real index.html, over a grid of states
 * and requires the same answer as the TypeScript one.
 */
describe("index.html boot watchdog agrees with decideChunkReload", () => {
  const html = readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");
  const m = /\/\/ BEGIN decideChunkReload[^\n]*\n([\s\S]*?)\/\/ END decideChunkReload/.exec(html);
  it("finds the watchdog's decide()", () => {
    expect(m, "index.html: BEGIN/END decideChunkReload markers").not.toBeNull();
  });
  it("gives the same decision for every state in the grid", () => {
    const decide = new Function(`${m![1]}; return decide;`)() as (c: number, l: number, n: number, o: boolean) => number;
    const T = Date.parse("2026-09-12T12:00:00Z");
    let checked = 0;
    for (const count of [0, 1, 2, 3, 4, 5, 9]) {
      for (const ago of [0, 500, 4_999, 5_000, 14_999, 15_001, 39_999, 40_001, 120_000, CHUNK_RELOAD_EPISODE_MS, CHUNK_RELOAD_EPISODE_MS + 1]) {
        for (const offline of [false, true]) {
          const last = count === 0 && ago > 0 ? 0 : T - ago;
          const ts = decideChunkReload({ count, last }, T, offline);
          const es5 = decide(count, last, T, offline);
          expect(es5, `count=${count} ago=${ago} offline=${offline}`).toBe(ts.reload ? ts.delayMs : -1);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(150);
  });
});

describe("hardReloadBypassCache follow-ups", () => {
  it("a hung cache delete does not strand the page: the reload still happens after the step timeout", async () => {
    const hung = new Promise<boolean>(() => {});
    Object.defineProperty(window, "caches", {
      value: { keys: async () => ["precache"], delete: () => hung },
      configurable: true,
    });
    void hardReloadBypassCache();
    await flush();
    expect(replace).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PURGE_STEP_TIMEOUT_MS + 10);
    await flush();
    expect(replace).toHaveBeenCalledTimes(1);
    // @ts-expect-error test cleanup
    delete window.caches;
  });

  it("going offline between the attempt and the reload refunds the attempt", async () => {
    sessionStorage.setItem("helpr_chunk_reload_count", "1");
    setOnline(false);
    await hardReloadBypassCache();
    expect(replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("helpr_chunk_reload_count")).toBe("0");
  });
});

// Shown able to fail:
// The cap itself. Without it a tab whose chunk keeps 404ing reloads forever.
// @mutate src/lib/chunkReload.ts | if (count >= CHUNK_RELOAD_MAX_ATTEMPTS) return { reload: false }; | if (count >= 99) return { reload: false };
// The cap's VALUE, checked independently of the constant the tests import —
// test (b) asserts `toHaveBeenCalledTimes(CHUNK_RELOAD_MAX_ATTEMPTS)`, so the
// constant is both input and oracle there; this one is not.
// @mutate src/lib/chunkReload.ts | export const CHUNK_RELOAD_MAX_ATTEMPTS = 4; | export const CHUNK_RELOAD_MAX_ATTEMPTS = 5;
// The offline guard. A chunk that failed because the device is offline is not
// stale, and hardReloadBypassCache deletes the precache that serves offline.html.
// @mutate src/lib/chunkReload.ts | if (offline) return { reload: false }; | if (false) return { reload: false };
// Fail-closed with no usable sessionStorage: without the counter there is no
// cap across reloads, so the `_v` cache-buster is the only thing left.
// @mutate src/lib/chunkReload.ts | if (state.count > 0 \|\| landedFromRecentRecoveryReload()) return false; | if (state.count > 0) return false;
// Q199: while a retry waits, the caller must get true (quiet state), not the error card.
// @mutate src/lib/chunkReload.ts | pendingRetry = setTimeout(fire, decision.delayMs);\n  }\n  return true; | pendingRetry = setTimeout(fire, decision.delayMs);\n  }\n  return false;
// Q199: the watchdog's own copy of the decision (the 10s give-up was the bug).
// @mutate index.html | var wait = count === 0 ? 0 : SCHEDULE[count] - (now - last); | var wait = count === 0 ? 0 : -1; return -1;
