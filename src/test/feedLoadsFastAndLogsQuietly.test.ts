/**
 * THE JOBS FEED TRIES FAST, THEN WAITS; A DROPPED CONNECTION IS ONE LOG LINE
 * (owner-approved loading fix, builder 67, 2026-10-29).
 *
 * Measured on prod error_logs, 2026-10-23..10-29 (read-only):
 *   - "Loading jobs timed out": 7 rows from the browse catch (severity error)
 *     plus 5 more from QueryCache (severity error) for the same failures, each
 *     only after 12 s + a second 12 s attempt.
 *   - "TypeError: Load failed" / "Failed to fetch" from the best-effort reads:
 *     fetchJobOfferTargets 14 rows in 8 distinct seconds, fetchMyScheduleClashes
 *     11 rows in 7 seconds: one WebKit resume burst logged once per read, and
 *     never retried, so the card simply lost its notice.
 *
 * So:
 *   (a) each feed phase gets a 4 s first try, then one fresh 12 s try
 *       (raceVisibleDeadlineRetrying, the stalled read aborted at 4 s);
 *   (b) a feed timeout is logged once, as a warning, and only when the second
 *       try also timed out;
 *   (c) the best-effort reads throw a transport failure (isNetworkFailure) so
 *       React Query retries them, and QueryCache logs a burst of transport
 *       failures as ONE event.
 *
 * @mutate src/lib/visibleDeadline.ts |     if (!(err instanceof Error && err.message === message) \|\| outer?.aborted \|\| i === budgets.length - 1) throw err; |     throw err;
 * @mutate src/hooks/useDashboardData.ts | const JOBS_DEADLINES = [4_000, JOBS_QUERY_TIMEOUT_MS] as const; | const JOBS_DEADLINES = [JOBS_QUERY_TIMEOUT_MS, JOBS_QUERY_TIMEOUT_MS] as const;
 * @mutate src/hooks/useDashboardData.ts |         ? shouldRetryQuery(failureCount, error, 0) |         ? shouldRetryQuery(failureCount, error, 1)
 * @mutate src/hooks/useDashboardData.ts |         if (!isJobsTimeout(viewErr)) report(viewErr, { |         report(viewErr, {
 * @mutate src/lib/queryClient.ts |   if (kind === "QueryCache" && isNetworkFailure(error)) return noteNetworkBurst(error, kind, keyName); |   void isNetworkFailure;
 * @mutate src/lib/queryClient.ts |   const severity = timeoutMessage !== undefined && error instanceof Error && error.message === timeoutMessage ? "warning" : "error"; |   const severity = "error";
 * @mutate src/lib/scheduleClashes.ts |     if (isNetworkFailure(error)) unwrap(res); |     void isNetworkFailure;
 * @mutate src/lib/jobOfferTargets.ts |     if (opts.throwOnNetwork && isNetworkFailure(error)) unwrap(res); |     void isNetworkFailure;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const report = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => report(...a) }));
let rpcResult: { data: unknown; error: unknown } = { data: [], error: null };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: () => Promise.resolve(rpcResult) },
}));

const REPO = resolve(__dirname, "../..");
const read = (rel: string) => blankComments(readFileSync(resolve(REPO, rel), "utf8"));
const LOAD_FAILED = { code: "", message: "TypeError: Load failed", details: "", hint: "" };

beforeEach(() => {
  report.mockClear();
  rpcResult = { data: [], error: null };
});
afterEach(() => {
  vi.useRealTimers();
});

describe("(a) a 4 s first try, then one fresh 12 s try", () => {
  it("aborts the stalled first read at 4 s and answers from the second", async () => {
    vi.useFakeTimers();
    const { raceVisibleDeadlineRetrying, __resetVisibleDeadlineForTests } = await import("@/lib/visibleDeadline");
    __resetVisibleDeadlineForTests();
    const signals: AbortSignal[] = [];
    const starts: number[] = [];
    const t0 = Date.now();
    const p = raceVisibleDeadlineRetrying((signal) => {
      signals.push(signal);
      starts.push(Date.now() - t0);
      return signals.length === 1 ? new Promise<string>(() => {}) : Promise.resolve("jobs");
    }, [4_000, 12_000], "Loading jobs timed out");
    await vi.advanceTimersByTimeAsync(3_999);
    expect(signals).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe("jobs");
    expect(starts).toEqual([0, 4_000]);
    expect(signals[0].aborted).toBe(true);
  });

  it("fails at 4 + 12 s when the second try stalls too, and never tries a third time", async () => {
    vi.useFakeTimers();
    const { raceVisibleDeadlineRetrying, __resetVisibleDeadlineForTests } = await import("@/lib/visibleDeadline");
    __resetVisibleDeadlineForTests();
    let tries = 0;
    const p = raceVisibleDeadlineRetrying(() => { tries += 1; return new Promise<string>(() => {}); }, [4_000, 12_000], "Loading jobs timed out");
    const settled = p.then(() => "resolved", (e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(15_999);
    expect(tries).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(settled).resolves.toBe("Loading jobs timed out");
    expect(tries).toBe(2);
  });

  it("a refused read is not retried: only a timeout earns the second try", async () => {
    const { raceVisibleDeadlineRetrying } = await import("@/lib/visibleDeadline");
    let tries = 0;
    const refused = new Error("permission denied for table jobs");
    await expect(raceVisibleDeadlineRetrying(() => { tries += 1; return Promise.reject(refused); }, [4_000, 12_000], "Loading jobs timed out")).rejects.toBe(refused);
    expect(tries).toBe(1);
  });

  it("every network phase of the feed goes through the 4 s / 12 s pair, and a timeout is not retried again by React Query", () => {
    const src = read("src/hooks/useDashboardData.ts");
    expect(src).toMatch(/const JOBS_DEADLINES = \[4_000, JOBS_QUERY_TIMEOUT_MS\] as const;/);
    expect(src).toMatch(/raceVisibleDeadlineRetrying\(start, JOBS_DEADLINES, JOBS_TIMEOUT_MESSAGE, signal\)/);
    const phases = [...src.matchAll(/\bfeedPhase\(/g)].length;
    expect(phases, "browse read, block list, enrichment").toBeGreaterThanOrEqual(3);
    // No phase left on a single 12 s deadline.
    expect(src).not.toMatch(/withTimeout\([^;]*JOBS_QUERY_TIMEOUT_MS/);
    expect(src).not.toMatch(/raceVisibleDeadlineAbortable\(/);
    expect(src).toMatch(/\? shouldRetryQuery\(failureCount, error, 0\)/);
  });
});

describe("(b) a feed timeout is one warning, only after the retry also failed", () => {
  it("the browse catch no longer logs a timeout (QueryCache logs it once)", () => {
    const src = read("src/hooks/useDashboardData.ts");
    expect(src).toMatch(/if \(!isJobsTimeout\(viewErr\)\) report\(viewErr, \{/);
    expect(src).toMatch(/meta: \{ warnOnMessage: JOBS_TIMEOUT_MESSAGE \}/);
  });

  it("QueryCache logs the feed's timeout as a warning, any other failure as an error", async () => {
    const { reportCacheError } = await import("@/lib/queryClient");
    reportCacheError("QueryCache", new Error("Loading jobs timed out"), ["dashboard", "jobs"], "Loading jobs timed out");
    reportCacheError("QueryCache", new Error("permission denied for table jobs"), ["dashboard", "jobs"], "Loading jobs timed out");
    expect(report.mock.calls.map((c) => (c[1] as { severity: string }).severity)).toEqual(["warning", "error"]);
  });
});

describe("(c) best-effort reads retry a dropped connection; a burst is one event", () => {
  it("fetchMyScheduleClashes throws a transport failure, still degrades quietly on anything else", async () => {
    const { fetchMyScheduleClashes } = await import("@/lib/scheduleClashes");
    rpcResult = { data: null, error: LOAD_FAILED };
    await expect(fetchMyScheduleClashes()).rejects.toThrow("TypeError: Load failed");
    expect(report).not.toHaveBeenCalled();
    rpcResult = { data: null, error: { code: "42501", message: "permission denied", details: "", hint: "" } };
    await expect(fetchMyScheduleClashes()).resolves.toEqual(new Map());
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("fetchJobOfferTargets throws a transport failure for a React Query caller, degrades for the rest", async () => {
    const { fetchJobOfferTargets } = await import("@/lib/jobOfferTargets");
    rpcResult = { data: null, error: LOAD_FAILED };
    await expect(fetchJobOfferTargets(undefined, { throwOnNetwork: true })).rejects.toThrow("TypeError: Load failed");
    expect(report).not.toHaveBeenCalled();
    await expect(fetchJobOfferTargets(["j1"])).resolves.toEqual(new Map());
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("Activity's posted read asks for the throwing form", () => {
    expect(read("src/hooks/useActivityData.ts")).toMatch(/fetchJobOfferTargets\(undefined, \{ throwOnNetwork: true \}\)/);
  });

  it("five transport failures in one WebKit resume burst are logged as ONE event, with the count", async () => {
    vi.useFakeTimers();
    const { reportCacheError, NETWORK_BURST_MS, __resetNetworkBurstForTests } = await import("@/lib/queryClient");
    __resetNetworkBurstForTests();
    for (const key of ["activity", "activity", "messages", "dashboard", "profile"]) {
      reportCacheError("QueryCache", new Error("TypeError: Load failed"), [key]);
    }
    expect(report).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(NETWORK_BURST_MS);
    expect(report).toHaveBeenCalledTimes(1);
    const [, opts] = report.mock.calls[0] as [unknown, { severity: string; context: { burst_count: number; burst_keys: string[] } }];
    expect(opts.severity).toBe("warning");
    expect(opts.context.burst_count).toBe(5);
    expect(opts.context.burst_keys).toEqual(["activity", "messages", "dashboard", "profile"]);
    // A later, separate drop is its own event.
    reportCacheError("QueryCache", new Error("TypeError: Failed to fetch"), ["activity"]);
    await vi.advanceTimersByTimeAsync(NETWORK_BURST_MS);
    expect(report).toHaveBeenCalledTimes(2);
  });
});
