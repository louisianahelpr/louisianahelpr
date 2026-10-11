/**
 * confirmSessionLost() reports what it absorbs (review of the no-false-signout
 * fix, 2026-10-11):
 * - a would-be sign-out it judged transient goes to error_logs once a minute at
 *   most, tagged source "sessionLoss.transient" with the error's name and
 *   status, never its message or a token;
 * - a throw it swallows (a storage read failure, say) is reported too, still
 *   answering "not lost".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const refreshSession = vi.fn();
const report = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => report(...a) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: () => getSession(), refreshSession: () => refreshSession() } },
}));

const NO_SESSION = { data: { session: null }, error: null };
const NETWORK = { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch refresh_token=SECRET" };

// Fresh module per test: the once-a-minute limiter is module state.
const load = async () => {
  vi.resetModules();
  return (await import("./sessionLoss")).confirmSessionLost;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
  getSession.mockReset();
  refreshSession.mockReset();
  report.mockReset();
});
afterEach(() => vi.useRealTimers());

const tagsOf = (call: unknown[]) => (call[1] as { tags: Record<string, unknown>; severity: string });

describe("confirmSessionLost() reporting", () => {
  it("reports a network-failed refresh it absorbed: warning, name and status only", async () => {
    const confirmSessionLost = await load();
    getSession.mockResolvedValue(NO_SESSION);
    refreshSession.mockResolvedValue({ data: { session: null }, error: NETWORK });
    expect(await confirmSessionLost()).toBe(false);
    expect(report).toHaveBeenCalledTimes(1);
    const opts = tagsOf(report.mock.calls[0]);
    expect(opts.severity).toBe("warning");
    expect(opts.tags).toEqual({ source: "sessionLoss.transient", reason: "not-definite", error_name: "AuthRetryableFetchError", error_status: 0 });
    // Never the error's own message (it can carry anything).
    expect(JSON.stringify(report.mock.calls[0])).not.toContain("SECRET");
  });

  it("a burst of denials reports once per minute at most", async () => {
    const confirmSessionLost = await load();
    getSession.mockResolvedValue(NO_SESSION);
    refreshSession.mockResolvedValue({ data: { session: null }, error: NETWORK });
    for (let i = 0; i < 5; i++) expect(await confirmSessionLost()).toBe(false);
    expect(report).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-11T12:00:59Z"));
    await confirmSessionLost();
    expect(report).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-11T12:01:00Z"));
    await confirmSessionLost();
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("reports a refresh that brought the session back", async () => {
    const confirmSessionLost = await load();
    getSession.mockResolvedValue(NO_SESSION);
    refreshSession.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    expect(await confirmSessionLost()).toBe(false);
    expect(tagsOf(report.mock.calls[0]).tags).toMatchObject({ source: "sessionLoss.transient", reason: "refreshed" });
  });

  it("does not report a denial with the session still present (nothing was absorbed)", async () => {
    const confirmSessionLost = await load();
    getSession.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    expect(await confirmSessionLost()).toBe(false);
    expect(report).not.toHaveBeenCalled();
  });

  it("does not report a real loss as transient", async () => {
    const confirmSessionLost = await load();
    getSession.mockResolvedValue(NO_SESSION);
    refreshSession.mockResolvedValue({ data: { session: null }, error: { name: "AuthSessionMissingError", status: 400 } });
    expect(await confirmSessionLost()).toBe(true);
    expect(report).not.toHaveBeenCalled();
  });

  it("reports a swallowed throw at warning level and still answers not lost", async () => {
    const confirmSessionLost = await load();
    const boom = new Error("storage read failed");
    getSession.mockRejectedValue(boom);
    expect(await confirmSessionLost()).toBe(false);
    expect(report).toHaveBeenCalledWith(boom, { severity: "warning", tags: { source: "sessionLoss.threw" } });
    // Rate-limited too, so a throwing storage cannot flood error_logs.
    await confirmSessionLost();
    expect(report).toHaveBeenCalledTimes(1);
  });
});

// @mutate src/lib/sessionLoss.ts |       report(err, { severity: "warning", tags: { source: "sessionLoss.threw" } }); |       void err;
// @mutate src/lib/sessionLoss.ts |       reportTransient("not-definite", error); |       void error;
// @mutate src/lib/sessionLoss.ts |   if (now - lastReportAt[kind] < REPORT_EVERY_MS) return false; |   void REPORT_EVERY_MS;
