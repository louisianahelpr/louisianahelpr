/**
 * Audit 2026-10-28 P5-10 (BROKEN): Admin > Users' per-member "N completed" and
 * money chips never loaded. loadJobsCompletedSummary and loadPaySummary sent ONE
 * GET /rest/v1/jobs whose `or=(helper_id.eq.<id>,customer_id.eq.<id>,…)` named
 * all 243 members (~25 KB of URL) and got 400 Bad Request; the error went to the
 * console only.
 *
 * Now the ids go out JOBS_OR_CHUNK (50) per request and the rows merge by job id;
 * a failed chunk shows an inline error with Try again on the Users list.
 *
 * Driven with 243 ids against a fake client that records every `or` filter.
 *
 * @mutate src/components/admin/useAdminUserSummaries.ts |   const results = await Promise.all(chunkIds(userIds).map((ids) => read(jobPartiesFilter(ids)))); |   const results = await Promise.all([userIds].map((ids) => read(jobPartiesFilter(ids))));
 * @mutate src/components/admin/useAdminUserSummaries.ts |   for (const r of results) for (const row of r.data ?? []) byId.set(row.id, row); |   for (const r of results) for (const row of r.data ?? []) byId.set(`${byId.size}`, row);
 * @mutate src/components/admin/useAdminUserSummaries.ts |     markFailed("jobs completed", !!error); |     markFailed("jobs completed", false);
 * @mutate src/components/admin/AdminUsers.tsx |             onRetry={retryFailedSummaries} |             onRetry={undefined}
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny PostgREST stand-in: records the table and every `or` filter, and answers
// each jobs read from `answer(orFilter)`.
const net = vi.hoisted(() => ({
  ors: [] as string[],
  failOr: null as null | ((or: string) => boolean),
  jobs: [] as { id: string; helper_id: string | null; customer_id: string | null; status: string; payment_status: string; budget: number; stripe_payment_intent_id: string }[],
}));
vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    let or: string | null = null;
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "not", "is", "order", "limit"]) b[m] = () => b;
    b.or = (f: string) => { or = f; net.ors.push(f); return b; };
    b.then = (resolve: (v: unknown) => unknown) => {
      if (table !== "jobs" || or === null) return Promise.resolve({ data: [], error: null }).then(resolve);
      if (net.failOr?.(or)) return Promise.resolve({ data: null, error: { message: "Bad Request", code: "400" } }).then(resolve);
      const ids = new Set([...or.matchAll(/_id\.eq\.([^,]+)/g)].map((m) => m[1]));
      const rows = net.jobs.filter((j) => ids.has(j.helper_id ?? "") || ids.has(j.customer_id ?? ""));
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    };
    return b;
  };
  return { supabase: { from: builder, rpc: async () => ({ data: [], error: null }) } };
});
vi.mock("@/components/admin/giftCardPaidJobIds", () => ({ loadGiftCardPaidJobIds: async () => ({ ids: new Set<string>(), error: null }) }));

import { JOBS_OR_CHUNK, useAdminUserSummaries } from "./useAdminUserSummaries";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const IDS = Array.from({ length: 243 }, (_, i) => uuid(i + 1));

beforeEach(() => {
  net.ors = [];
  net.failOr = null;
  net.jobs = [
    // Helpr in the first chunk, poster in the last: comes back from two chunks, counted once each.
    { id: "j1", helper_id: IDS[0], customer_id: IDS[242], status: "completed", payment_status: "escrow", budget: 40, stripe_payment_intent_id: "pi_1" },
    { id: "j2", helper_id: IDS[120], customer_id: IDS[121], status: "completed", payment_status: "escrow", budget: 25, stripe_payment_intent_id: "pi_2" },
  ];
});

describe("Admin > Users summaries with 243 members (P5-10)", () => {
  it("no jobs read names more than one chunk of members, every member is asked about, and rows merge by job", async () => {
    const { result } = renderHook(() => useAdminUserSummaries());
    act(() => result.current.loadSummaries(IDS, []));
    await waitFor(() => expect(result.current.summariesSettled).toBe(true));

    // Two reads (completed + money) x ceil(243/50) chunks.
    const chunks = Math.ceil(IDS.length / JOBS_OR_CHUNK);
    expect(chunks).toBe(5);
    expect(net.ors).toHaveLength(2 * chunks);
    for (const or of net.ors) {
      const named = new Set([...or.matchAll(/_id\.eq\.([^,]+)/g)].map((m) => m[1]));
      expect(named.size).toBeLessThanOrEqual(JOBS_OR_CHUNK);
      // A chunk's filter stays a few KB (the failing one was ~25 KB).
      expect(or.length).toBeLessThan(6000);
    }
    const asked = new Set(net.ors.flatMap((or) => [...or.matchAll(/helper_id\.eq\.([^,]+)/g)].map((m) => m[1])));
    expect(asked.size).toBe(243);

    expect(result.current.jobsCompletedSummary).toEqual({ [IDS[0]]: 1, [IDS[242]]: 1, [IDS[120]]: 1, [IDS[121]]: 1 });
    expect(result.current.moneySummary?.[IDS[0]]?.heldCents).toBe(4000);
    expect(result.current.summaryFailures).toEqual([]);
  });

  it("a failed chunk is shown (not console-only) and Try again re-reads it", async () => {
    net.failOr = (or) => or.includes(IDS[200]);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useAdminUserSummaries());
    act(() => result.current.loadSummaries(IDS, []));
    await waitFor(() => expect(result.current.summariesSettled).toBe(true));
    expect(result.current.summaryFailures.sort()).toEqual(["jobs completed", "money"]);
    expect(result.current.moneySummary).toBeNull();

    net.failOr = null;
    act(() => result.current.retryFailedSummaries());
    await waitFor(() => expect(result.current.summaryFailures).toEqual([]));
    expect(result.current.jobsCompletedSummary[IDS[0]]).toBe(1);
    err.mockRestore();
  });

  it("the Users list renders the failure with Try again wired to the retry", () => {
    const src = readFileSync(resolve(__dirname, "AdminUsers.tsx"), "utf8");
    expect(src).toMatch(/summaryFailures\.length > 0 && \(/);
    expect(src).toMatch(/onRetry=\{retryFailedSummaries\}/);
  });
});
