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
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FROZEN_SLACK_MS, __resetVisibleDeadlineForTests, raceVisibleDeadline } from "./visibleDeadline";

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
});
