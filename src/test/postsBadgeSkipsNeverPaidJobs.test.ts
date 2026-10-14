/**
 * Q1734: the Posts dock badge counted pending applications on never-paid jobs
 * that My Posts hides (prod 2026-10-12, helper-e2e at 375: badge 1, all five
 * buckets empty). Measured 2026-10-14 with this exact query on prod as the
 * test accounts: helper-e2e 1 -> 0, poster-e2e 2 -> 0.
 *
 * Both the main read and its 42703 fallback must carry the paid-only filter on
 * the joined job, built from NEVER_PAID_STATUSES (the list My Posts reads).
 *
 * @mutate src/hooks/useActivityBadgeCounts.ts | const PAID_JOBS_ONLY = `payment_status.is.null,payment_status.not.in.(${NEVER_PAID_STATUSES.join(",")})`; | const PAID_JOBS_ONLY = "id.not.is.null";
 */
import { renderHook, act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NEVER_PAID_STATUSES } from "@/lib/neverPaidStatuses";

const rig = vi.hoisted(() => ({
  calls: [] as Array<Array<[string, unknown[]]>>,
  firstError: true,
}));

vi.mock("@/integrations/supabase/client", () => {
  const chainFor = (table: string) => {
    const log: Array<[string, unknown[]]> = [];
    if (table === "applications") rig.calls.push(log);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "order", "limit", "not", "update", "in", "or"]) {
      chain[m] = (...args: unknown[]) => {
        log.push([m, args]);
        return chain;
      };
    }
    chain.then = (res: (v: unknown) => unknown) => {
      if (table === "applications" && rig.firstError) {
        rig.firstError = false;
        return res({ data: null, count: null, error: { code: "42703", message: "column missing" } });
      }
      return res({ data: [], count: 0, error: null });
    };
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => chainFor(table),
      rpc: () => ({ then: (res: (v: unknown) => unknown) => res({ data: [], error: null }) }),
    },
  };
});
vi.mock("@/lib/userRealtimeBus", () => ({ subscribeUserRealtime: () => () => {} }));
vi.mock("@/lib/appBadge", () => ({ setAppIconBadge: () => Promise.resolve() }));

import { useActivityBadgeCounts } from "@/hooks/useActivityBadgeCounts";

afterEach(() => cleanup());

describe("Posts badge counts only applications on jobs that were paid for (Q1734)", () => {
  it("the main read and its fallback both filter the joined job by NEVER_PAID_STATUSES", async () => {
    const h = renderHook(() => useActivityBadgeCounts("user-q1734"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    h.unmount();
    // main read + 42703 fallback
    expect(rig.calls.length).toBeGreaterThanOrEqual(2);
    for (const log of rig.calls.slice(0, 2)) {
      const or = log.find(([m]) => m === "or");
      expect(or, "a Posts badge read has no paid-only filter on its job").toBeTruthy();
      const [filter, opts] = or![1] as [string, { referencedTable?: string }];
      expect(opts?.referencedTable).toBe("jobs");
      expect(filter).toContain("payment_status.is.null");
      expect(NEVER_PAID_STATUSES.length).toBeGreaterThan(2);
      for (const s of NEVER_PAID_STATUSES) expect(filter).toMatch(new RegExp(`payment_status\\.not\\.in\\.\\([^)]*\\b${s}\\b`));
    }
  });
});
