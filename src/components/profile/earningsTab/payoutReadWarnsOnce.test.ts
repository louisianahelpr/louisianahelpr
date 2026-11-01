/**
 * MONEY'S PAYOUT READ WARNS ONCE (B77, 2026-11-01). ProfileTabPanels starts Money's stripe-payouts and
 * payout_transfers reads before EarningsTab's chunk (prefetchEarningsReads, 6d9cca89d2); when that read fails, the
 * hook mounting a moment later reads again and fails the same way. Both used to send the same warning to the error
 * log. The same failure of the same read inside the reads' 60 s freshness window is reported once; a different
 * message, the other read, or a failure after the window is reported again.
 *
 * @mutate src/components/profile/earningsTab/useEarningsData.ts |   if (last && last.message === message && now - last.at < REPORT_WINDOW_MS) return; |
 * @mutate src/components/profile/earningsTab/useEarningsData.ts |   if (last && last.message === message && now - last.at < REPORT_WINDOW_MS) return; |   if (last) return;
 * @mutate src/components/profile/earningsTab/useEarningsData.ts |         reportPayoutReadOnce(err, "EarningsTab.fetchPayouts"); |         report(err, { severity: "warning", tags: { source: "EarningsTab.fetchPayouts" } });
 * @mutate src/components/profile/earningsTab/useEarningsData.ts |       if (result.error) reportPayoutReadOnce(result.error, "EarningsTab.fetchLedger"); |       if (result.error) report(result.error, { severity: "warning", tags: { source: "EarningsTab.fetchLedger" } });
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const report = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => report(...a) }));

const invoke = vi.fn();
const ledgerResult = { data: null, error: { message: "permission denied", code: "42501" } };
vi.mock("@/integrations/supabase/client", () => {
  const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: () => Promise.resolve(ledgerResult) };
  return { supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) }, from: () => chain } };
});

const { prefetchEarningsReads, reportPayoutReadOnce } = await import("./useEarningsData");

function sources() {
  return report.mock.calls.map((c) => (c[1] as { tags: { source: string } }).tags.source).sort();
}

describe("Money's payout reads send one warning per failure", () => {
  beforeEach(() => {
    report.mockReset();
    invoke.mockReset();
    invoke.mockResolvedValue({ data: null, error: new Error("stripe down") });
  });

  it("a failed prefetch then the hook's own read of the same failure reports each read once", async () => {
    const helper = `h-${Math.random()}`;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const settled = () => qc.getQueryCache().getAll().length === 2 && qc.getQueryCache().getAll().every((q) => q.state.status === "error" && q.state.fetchStatus === "idle");
    // ProfileTabPanels' prefetch fails...
    prefetchEarningsReads(qc, helper);
    await vi.waitFor(() => expect(settled()).toBe(true));
    // ...then the hook's mount reads again (an errored query has no data, so it refetches) and fails the same way.
    prefetchEarningsReads(qc, helper);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(settled()).toBe(true));
    const first = qc;
    expect(first.getQueryCache().getAll().length).toBe(2);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(sources()).toEqual(["EarningsTab.fetchLedger", "EarningsTab.fetchPayouts"]);
  });

  it("a different failure, another read, or the same failure after the window is reported", () => {
    const t = 1_000_000;
    reportPayoutReadOnce(new Error("a"), "X.read", t);
    reportPayoutReadOnce(new Error("a"), "X.read", t + 59_000);
    expect(report).toHaveBeenCalledTimes(1);
    reportPayoutReadOnce(new Error("b"), "X.read", t + 59_500);
    reportPayoutReadOnce(new Error("b"), "Y.read", t + 59_500);
    reportPayoutReadOnce(new Error("b"), "X.read", t + 59_500 + 60_000);
    expect(report).toHaveBeenCalledTimes(4);
    expect(report.mock.calls[0][1]).toEqual({ severity: "warning", tags: { source: "X.read" } });
  });
});
