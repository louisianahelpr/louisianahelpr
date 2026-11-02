/**
 * Q2509: a Helpr task RPC's designed refusal (a code src/lib/helprTasks/errorCopy.ts has words for)
 * is shown to the member and is NOT logged by the QueryCache/MutationCache hooks as a defect, the
 * same rule Q1882 gave Declutter's rpcData. Measured 2026-11-02 (Builder 9): Sentry JAVASCRIPT-42,
 * 2026-10-22 05:45:38Z, /declutter, key "helpr-tasks": helpr_tasks_open_near answered
 * payout_setup_incomplete (a member who has not set up payouts opens the delivery list) and the
 * QueryCache logged it at error severity, though the screen had the words for it. src/lib/helprTasks/
 * api.ts's own data() helper set userMessage but not designedRefusal.
 *
 * @mutate src/lib/helprTasks/api.ts | Object.assign(e, { userMessage: msg, designedRefusal: true }); | Object.assign(e, { userMessage: msg });
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const report = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => report(...a) }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

beforeEach(() => {
  report.mockClear();
  rpc.mockReset();
});

async function openTasksThrown(code: string): Promise<unknown> {
  rpc.mockResolvedValue({ data: null, error: { message: code } });
  const { fetchOpenTasks } = await import("@/lib/helprTasks/api");
  try {
    await fetchOpenTasks(null);
  } catch (e) {
    return e;
  }
  throw new Error("fetchOpenTasks did not throw");
}

describe("designed Helpr task refusals are not reported as defects (Q2509)", () => {
  it("payout_setup_incomplete from helpr_tasks_open_near carries its words and is skipped by both cache hooks", async () => {
    const { reportCacheError } = await import("@/lib/queryClient");
    const { HELPR_TASK_RPC_ERROR_COPY } = await import("@/lib/helprTasks/errorCopy");
    const e = await openTasksThrown("payout_setup_incomplete");
    expect(rpc).toHaveBeenCalledWith("helpr_tasks_open_near", expect.anything());
    expect((e as { userMessage?: string }).userMessage).toBe(HELPR_TASK_RPC_ERROR_COPY.helpr_tasks_open_near.payout_setup_incomplete);
    reportCacheError("QueryCache", e, ["helpr-tasks"]);
    reportCacheError("MutationCache", e, ["helpr-tasks"]);
    expect(report).not.toHaveBeenCalled();
  });

  it("an error with no words is still reported at error severity", async () => {
    const { reportCacheError } = await import("@/lib/queryClient");
    const e = await openTasksThrown('relation "x" does not exist');
    expect((e as { designedRefusal?: unknown }).designedRefusal).toBeUndefined();
    reportCacheError("QueryCache", e, ["helpr-tasks"]);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][1]).toMatchObject({ severity: "error" });
  });
});
