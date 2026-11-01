/**
 * CMP-4 (lead 2026-11-01): the booked Helpr's job page reads their instant booking off the same row that says the
 * offer is theirs (get_my_pending_direct_offers, one query key for useOfferedToMe and useMyInstantBooking), and keeps
 * it while the page is open, so the card's answer ("You're booked", "Booking declined") stays after the row goes.
 * The page's rendering of the card is src/pages/jobs/jobPage/JobPage.test.tsx.
 *
 * @mutate src/pages/jobs/jobPage/useJobPage.ts | .select("id, instant_decline_until"), | .select("id"),
 * @mutate src/pages/jobs/jobPage/useJobPage.ts |   return live ?? (seen && seen.jobId === jobId ? seen.until : null); |   return live;
 * @mutate src/pages/jobs/jobPage/useJobPage.ts |   return live ?? (seen && seen.jobId === jobId ? seen.until : null); |   return live ?? (seen ? seen.until : null);
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], selects: [] as string[], calls: 0 }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string) => {
      db.calls++;
      const q = {
        eq: () => q,
        select: (cols: string) => {
          db.selects.push(`${fn}:${cols}`);
          return Promise.resolve({ data: db.rows, error: null });
        },
      };
      return q;
    },
  },
}));

import { useMyInstantBooking, useOfferedToMe } from "@/pages/jobs/jobPage/useJobPage";

const UNTIL = "2026-11-03T16:42:00.000Z";

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  db.rows = [];
  db.selects = [];
  db.calls = 0;
});

describe("useMyInstantBooking (CMP-4, the booked Helpr's job page)", () => {
  it("reads instant_decline_until off the viewer's own pending offer, in the same read useOfferedToMe makes", async () => {
    db.rows = [{ id: "j1", instant_decline_until: UNTIL }];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => ({ until: useMyInstantBooking("j1", true), offered: useOfferedToMe("j1", true) }), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.until).toBe(UNTIL));
    expect(result.current.offered).toBe(true);
    expect(db.selects).toEqual(["get_my_pending_direct_offers:id, instant_decline_until"]);
  });

  it("a plain direct offer (no decline window) is no instant booking", async () => {
    db.rows = [{ id: "j1", instant_decline_until: null }];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => ({ until: useMyInstantBooking("j1", true), offered: useOfferedToMe("j1", true) }), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.offered).toBe(true));
    expect(result.current.until).toBeNull();
  });

  it("not asked when no offer is pending", () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useMyInstantBooking("j1", false), { wrapper: wrapper(qc) });
    expect(result.current).toBeNull();
    expect(db.calls).toBe(0);
  });

  it("after the answer the row goes, and the booking is kept for this job only", async () => {
    db.rows = [{ id: "j1", instant_decline_until: UNTIL }];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result, rerender } = renderHook(({ id }) => useMyInstantBooking(id, true), { wrapper: wrapper(qc), initialProps: { id: "j1" } });
    await waitFor(() => expect(result.current).toBe(UNTIL));
    db.rows = [];
    await act(async () => { await qc.invalidateQueries(); });
    await waitFor(() => expect(db.calls).toBeGreaterThan(1));
    expect(result.current).toBe(UNTIL);
    rerender({ id: "j2" });
    await waitFor(() => expect(db.calls).toBeGreaterThan(2));
    expect(result.current).toBeNull();
  });
});
