/**
 * A3-81 remainder (audit 11-01, HIGH; B124): Home's to-do HOOK reads the member's refund requests that wait on them
 * (declutter_my_refund_todos) and the giver's free asks, and puts them on the list. homeCountsDeclutter.test.tsx proves
 * the rules on deriveNeedsYouTodos; this proves the hook feeds them in (a dropped input passes the rules test).
 *
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts | declutterRefunds: refundRows, declutterFreeAsks: freeAskRows }), | }),
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |   const refundRows = (declutterOn && refundsOn ? dRefunds.data : undefined) ?? EMPTY_REFUNDS; |   const refundRows = EMPTY_REFUNDS;
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |   const freeAskRows = (declutterOn ? dFreeAsks.data : undefined) ?? EMPTY_FREE_ASKS; |   const freeAskRows = EMPTY_FREE_ASKS;
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User as SupaUser } from "@supabase/supabase-js";
import { useNeedsYouTodos } from "@/pages/home/homeDashboard/needsYouTodos";

const rig = vi.hoisted(() => ({ refundReads: 0, freeReads: 0, flags: new Set<string>(["declutter", "declutter_refund_requests"]) }));

vi.mock("@/hooks/useActivityData", () => ({
  CORE_STALE: 60_000,
  fetchPostedActivity: async () => ({ postedJobs: [], applicantCounts: {}, pendingApplicantCounts: {}, closedApplicantSummaries: {} }),
  fetchAppliedActivity: async () => ({ appliedApps: [], declinedJobIds: new Set(), helperReviewedJobIds: new Set() }),
}));
vi.mock("@/lib/backoutNotices", () => ({
  backoutNoticeApplies: () => false,
  backoutNoticesKey: (u: string) => ["activity", "backout", u],
  useBackoutNotices: () => new Map(),
}));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => rig.flags.has(k) }));
vi.mock("@/lib/userRealtimeBus", () => ({ subscribeUserRealtime: () => () => {} }));
// The real Declutter reads run (src/lib/declutter/api.ts, refundRequests.ts) against a fake client: the RPCs by name,
// and the giver's open free asks from declutter_free_requests.
vi.mock("@/integrations/supabase/client", () => {
  const free = {
    select: () => free, eq: () => free, order: () => free,
    then: (res: (v: unknown) => unknown) => {
      rig.freeReads++;
      return Promise.resolve({ data: [{ item_id: "f1", created_at: "2026-11-01T10:00:00Z", declutter_items: { title: "Patio chairs" } }, { item_id: "f1", created_at: "2026-11-01T11:00:00Z", declutter_items: { title: "Patio chairs" } }], error: null }).then(res);
    },
  };
  return {
    supabase: {
      auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
      rpc: (name: string) => {
        if (name === "declutter_my_refund_todos") {
          rig.refundReads++;
          const due = new Date(Date.now() + 20 * 3_600_000).toISOString();
          return Promise.resolve({ data: [{ request_id: "r1", order_id: "o1", my_side: "seller", status: "open", due_at: due, title: "Oak rocking chair", item_count: 1 }], error: null });
        }
        return Promise.resolve({ data: [], error: null });
      },
      from: () => free,
    },
  };
});

const user = { id: "u1" } as SupaUser;
function run() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(() => useNeedsYouTodos(user), { wrapper });
}

describe("Home's to-do hook reads refund requests and free asks (A3-81 remainder)", () => {
  afterEach(() => {
    cleanup();
    rig.refundReads = 0;
    rig.freeReads = 0;
    rig.flags = new Set(["declutter", "declutter_refund_requests"]);
  });

  it("puts the seller's refund answer and the giver's pick on Home's list", async () => {
    const { result } = run();
    await waitFor(() => expect(result.current.todos.map((t) => t.title)).toEqual(["Answer a refund request", "Pick who gets Patio chairs"]));
    expect(result.current.todos.every((t) => t.section === "declutter")).toBe(true);
  });

  it("makes no refund read while the refund switch is off for the member, and no Declutter read with Declutter off", async () => {
    rig.flags = new Set(["declutter"]);
    const { result } = run();
    await waitFor(() => expect(result.current.todos.map((t) => t.title)).toEqual(["Pick who gets Patio chairs"]));
    expect(rig.refundReads).toBe(0);
    cleanup();
    rig.flags = new Set();
    rig.freeReads = 0;
    const off = run();
    await new Promise((r) => setTimeout(r, 20));
    expect(off.result.current.todos).toEqual([]);
    expect(rig.freeReads + rig.refundReads).toBe(0);
  });
});
