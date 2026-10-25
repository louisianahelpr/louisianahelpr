/**
 * A read's deadline counts only time the page could run (src/lib/visibleDeadline.ts).
 *
 * The 2026-10-09/10 alerts "Profile request timed out" and "notifications
 * load timed out after 15000ms" came from iPhones put away mid-read: the
 * server answered in 140-360 ms, but the overdue timer fired first on return.
 *
 * @mutate src/lib/visibleDeadline.ts |       const frozen = now - dueAt > FROZEN_SLACK_MS; |       const frozen = false;
 * @mutate src/lib/visibleDeadline.ts |       const wentHidden = lastHiddenAt >= windowStart; |       const wentHidden = false;
 * @mutate src/lib/visibleDeadline.ts |       if (pageHidden()) { |       if (false) {
 * @mutate src/lib/visibleDeadline.ts |       if ((frozen \|\| wentHidden) && restarts < MAX_RESTARTS) { |       if (frozen \|\| wentHidden) {
 * @mutate src/lib/visibleDeadline.ts |         arm(ms);\n        return;\n      }\n      const frozen |         return;\n      }\n      const frozen
 * @mutate src/lib/visibleDeadline.ts |       if (err instanceof Error && err.message === message) ctrl.abort(err); |       void err;
 * @mutate src/lib/visibleDeadline.ts |   else outer?.addEventListener("abort", onOuter, { once: true }); |   else void onOuter;
 * @mutate src/hooks/useDashboardData.ts |           .abortSignal(abort)), JOBS_QUERY_TIMEOUT_MS, JOBS_TIMEOUT_MESSAGE, signal)) | ), JOBS_QUERY_TIMEOUT_MS, JOBS_TIMEOUT_MESSAGE, signal))
 * @mutate src/hooks/useDashboardData.ts |         ? shouldRetryQuery(failureCount, error, 1) |         ? false
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { FROZEN_SLACK_MS, MAX_RESTARTS, __resetVisibleDeadlineForTests, raceVisibleDeadline, raceVisibleDeadlineAbortable } from "./visibleDeadline";
import { blankComments } from "@/test/helpers/blankNonCode";

let visibility: DocumentVisibilityState = "visible";

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

/** A read that answers only when told to. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Settled state of a promise, read without awaiting forever. */
async function stateOf(p: Promise<unknown>): Promise<"pending" | "resolved" | "rejected"> {
  let state: "pending" | "resolved" | "rejected" = "pending";
  p.then(() => { state = "resolved"; }, () => { state = "rejected"; });
  await Promise.resolve();
  await Promise.resolve();
  return state;
}

describe("raceVisibleDeadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    __resetVisibleDeadlineForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a visible, on-time wait still fails at exactly its budget (a real stall still reaches the error state)", async () => {
    const read = deferred<string>();
    const raced = raceVisibleDeadline(read.promise, 6_000, "Profile request timed out");
    raced.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(5_999);
    expect(await stateOf(raced)).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    await expect(raced).rejects.toThrow("Profile request timed out");
  });

  it("an answer inside the budget wins and clears the timer", async () => {
    const read = deferred<string>();
    const raced = raceVisibleDeadline(read.promise, 6_000, "late");
    await vi.advanceTimersByTimeAsync(300);
    read.resolve("row");
    await expect(raced).resolves.toBe("row");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the page put away mid-read: the clock restarts when it comes back, so the answer that arrives on return wins", async () => {
    const read = deferred<string>();
    const raced = raceVisibleDeadline(read.promise, 6_000, "Profile request timed out");
    raced.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1_000);
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(60_000); // away for a minute
    expect(await stateOf(raced)).toBe("pending");
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(360); // the server's answer, measured on prod
    read.resolve("row");
    await expect(raced).resolves.toBe("row");
  });

  it("hidden and back before the deadline: the time away does not count, so the budget runs from the return", async () => {
    const read = deferred<string>();
    const raced = raceVisibleDeadline(read.promise, 6_000, "Profile request timed out");
    raced.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1_000);
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(3_000);
    setVisibility("visible"); // back at 4 s
    await vi.advanceTimersByTimeAsync(3_000); // 7 s of wall time, 3 s since the return
    expect(await stateOf(raced)).toBe("pending");
    read.resolve("row");
    await expect(raced).resolves.toBe("row");
  });

  it("a frozen event loop with no visibility event (timer fires late): the clock restarts from the return", async () => {
    const read = deferred<string>();
    const raced = raceVisibleDeadline(read.promise, 15_000, "notifications load timed out after 15000ms");
    raced.catch(() => undefined);
    // Freeze: wall time moves on without the timer running, then it fires late.
    vi.setSystemTime(Date.now() + 15_000 + FROZEN_SLACK_MS + 5_000);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await stateOf(raced)).toBe("pending");
    read.resolve("list");
    await expect(raced).resolves.toBe("list");
  });

  it("after coming back, a read that still never answers fails one full visible budget later", async () => {
    const read = deferred<string>();
    const raced = raceVisibleDeadline(read.promise, 6_000, "Profile request timed out");
    raced.catch(() => undefined);
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(10_000);
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(5_999);
    expect(await stateOf(raced)).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    await expect(raced).rejects.toThrow("Profile request timed out");
  });

  it("a read that fails passes its own error through", async () => {
    const raced = raceVisibleDeadline(Promise.reject(new Error("boom")), 6_000, "late");
    await expect(raced).rejects.toThrow("boom");
  });

  it("a page frozen at every due time still ends: at most MAX_RESTARTS restarts, then the timeout", async () => {
    const read = deferred<string>();
    const raced = raceVisibleDeadline(read.promise, 6_000, "Profile request timed out");
    raced.catch(() => undefined);
    for (let i = 0; i < MAX_RESTARTS; i += 1) {
      vi.setSystemTime(Date.now() + 6_000 + FROZEN_SLACK_MS + 1_000);
      await vi.advanceTimersByTimeAsync(6_000);
      expect(await stateOf(raced), `restart ${i + 1}`).toBe("pending");
    }
    vi.setSystemTime(Date.now() + 6_000 + FROZEN_SLACK_MS + 1_000);
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(raced).rejects.toThrow("Profile request timed out");
  });

  it("a WebView that never delivers the 'shown' event still settles once the page is visible again", async () => {
    const read = deferred<string>();
    const raced = raceVisibleDeadline(read.promise, 6_000, "Profile request timed out");
    raced.catch(() => undefined);
    visibility = "hidden"; // no visibilitychange event at all
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await stateOf(raced)).toBe("pending");
    visibility = "visible"; // and none on the way back either
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(raced).rejects.toThrow("Profile request timed out");
  });
});

// JAVASCRIPT-44 "Loading jobs timed out" (18 events, 13 people, 10-22..10-25):
// on its two newest events the edge logs hold every other read the phone sent
// in that second and no open_jobs_browse request at all, so the read never
// reached the server. A timed-out read is now CANCELLED and the feed tries
// once more with a fresh request. RED on origin/main 8ca225a0e3 (no
// raceVisibleDeadlineAbortable; the feed's timeout retried 0 times).
describe("raceVisibleDeadlineAbortable", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    __resetVisibleDeadlineForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("aborts the request when the deadline fires", async () => {
    let seen: AbortSignal | null = null;
    const p = raceVisibleDeadlineAbortable((signal) => {
      seen = signal;
      return new Promise<never>(() => {});
    }, 1_000, "Loading jobs timed out");
    const settled = p.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(await settled).toBe("Loading jobs timed out");
    expect(seen!.aborted).toBe(true);
  });

  it("does not abort a request that answered in time", async () => {
    let seen: AbortSignal | null = null;
    const d = deferred<string>();
    const p = raceVisibleDeadlineAbortable((signal) => {
      seen = signal;
      return d.promise;
    }, 1_000, "late");
    d.resolve("rows");
    expect(await p).toBe("rows");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(seen!.aborted).toBe(false);
  });

  it("aborts the request when the caller's own signal does (React Query cancel)", async () => {
    let seen: AbortSignal | null = null;
    const outer = new AbortController();
    const p = raceVisibleDeadlineAbortable((signal) => {
      seen = signal;
      return new Promise<never>(() => {});
    }, 60_000, "late", outer.signal);
    void p.catch(() => {});
    expect(seen!.aborted).toBe(false);
    outer.abort();
    expect(seen!.aborted).toBe(true);
  });

  it("the browse feed cancels its read at the deadline and retries a timeout once", () => {
    const src = blankComments(readFileSync(resolvePath(__dirname, "../hooks/useDashboardData.ts"), "utf8"));
    const browse = src.slice(src.indexOf('.from("open_jobs_browse")') - 400, src.indexOf('.from("open_jobs_browse")') + 900);
    expect(browse).toMatch(/raceVisibleDeadlineAbortable\(\(abort\) =>/);
    expect(browse).toMatch(/\.abortSignal\(abort\)\)/);
    expect(src).toMatch(/error\.message === JOBS_TIMEOUT_MESSAGE\s*\?\s*shouldRetryQuery\(failureCount, error, 1\)/);
  });
});
