/**
 * The nav's To-do badge makes ONE read for its six sections (Blockers 7/8, 2026-11-03, lead PASS; "Nothing slow for
 * users"; a11y-prod 41598471444 counted each of the six old reads ~480-530 times over 605 tests).
 * public.my_badge_reads(p_keys) answers cart, offers, refund todos, free asks, back-out notices and shop orders in one
 * request (src/lib/badgeReads.ts seeds each into the key its screens read). This drives the real useNeedsYouTodos
 * against a fake client that counts every call:
 *   1. the RPC answers every section: ONE request, no old call, and the to-dos still come from the seeded rows;
 *   2. one section comes back null: ONLY that section makes its old call, and its to-do still shows;
 *   3. the RPC is not deployed (PGRST202): all six old calls, as before;
 *   4. the RPC fails any other way: all six old calls at once (the badge never goes blank).
 * PGlite proof of the RPC: src/test/pglite/myBadgeReads.pglite.mjs.
 *
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts | enabled: !!uid && declutterOn && fallback("cart"), | enabled: !!uid && declutterOn,
 * @mutate src/lib/badgeReads.ts |       answered[s] = false; |       answered[s] = true;
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts | (badge.isError \|\| badge.data === null \|\| | (badge.isError \|\|
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts | (badge.isError \|\| badge.data === null \|\| | (badge.data === null \|\|
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |     retry: false, |     retry: 3,
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User as SupaUser } from "@supabase/supabase-js";
import { useNeedsYouTodos } from "@/pages/home/homeDashboard/needsYouTodos";

type BadgeAnswer = { data: unknown; error: unknown };
const rig = vi.hoisted(() => ({
  calls: [] as string[],
  keys: [] as string[][],
  badge: null as null | (() => BadgeAnswer),
}));

const DUE = () => new Date(Date.now() + 20 * 3_600_000).toISOString();
const REFUND = () => ({ request_id: "r1", order_id: "o1", my_side: "seller", status: "open", due_at: DUE(), title: "Oak rocking chair", item_count: 1 });
const FREE = [
  { item_id: "f1", created_at: "2026-11-01T10:00:00Z", declutter_items: { title: "Patio chairs" } },
  { item_id: "f1", created_at: "2026-11-01T11:00:00Z", declutter_items: { title: "Patio chairs" } },
];
const ORDER = { id: "so1", status: "held", accept_by: "2099-01-01T00:00:00Z", total_cents: 1240, shop_order_lines: [{ title: "Pecan pralines" }] };
const ALL_SECTIONS = { cart: [], offers: [], refund_todos: [REFUND()], free_asks: FREE, backout: [], shop_orders: [ORDER] };

vi.mock("@/hooks/useActivityData", () => ({
  CORE_STALE: 60_000,
  fetchPostedActivity: async () => ({ postedJobs: [], applicantCounts: {}, pendingApplicantCounts: {}, closedApplicantSummaries: {} }),
  fetchAppliedActivity: async () => ({ appliedApps: [], declinedJobIds: new Set(), helperReviewedJobIds: new Set() }),
}));
const ON = new Set(["declutter", "declutter_refund_requests", "shops"]);
vi.mock("@/hooks/useFeature", () => ({
  useFeature: (k: string) => ON.has(k),
  useFeatureStatus: (k: string) => ({ on: ON.has(k), settled: true, lastAnswer: ON.has(k) }),
}));
vi.mock("@/lib/userRealtimeBus", () => ({ subscribeUserRealtime: () => () => {} }));
vi.mock("@/integrations/supabase/client", () => {
  const table = (name: string) => {
    const rows = name === "declutter_free_requests" ? FREE : name === "shop_orders" ? [ORDER] : [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "not", "order", "limit", "in"]) q[m] = () => q;
    q.then = (res: (v: unknown) => unknown) => {
      rig.calls.push(`from:${name}`);
      return Promise.resolve({ data: rows, error: null }).then(res);
    };
    return q;
  };
  return {
    supabase: {
      auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
      rpc: (name: string, args?: { p_keys?: string[] }) => {
        rig.calls.push(`rpc:${name}`);
        if (name === "my_badge_reads") {
          rig.keys.push([...(args?.p_keys ?? [])].sort());
          return Promise.resolve(rig.badge ? rig.badge() : { data: {}, error: null });
        }
        if (name === "declutter_my_refund_todos") return Promise.resolve({ data: [REFUND()], error: null });
        return Promise.resolve({ data: [], error: null });
      },
      from: (name: string) => table(name),
    },
  };
});

const OLD_CALLS = ["rpc:declutter_my_cart", "rpc:declutter_my_offers", "rpc:declutter_my_refund_todos", "from:declutter_free_requests", "from:backout_notices", "from:shop_orders"];
const WANT_TODOS = ["Answer a refund request", "Pick who gets Patio chairs"];

function run(opts: { appRetry?: boolean } = {}) {
  // appRetry: the app's own QueryClient retries (React Query's default, 3 with backoff); the badge read must not.
  const qc = new QueryClient(opts.appRetry ? {} : { defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(() => useNeedsYouTodos({ id: "u1" } as SupaUser), { wrapper });
}
const titles = (r: { current: { todos: { title: string }[] } }) => r.current.todos.map((t) => t.title);
const settle = () => new Promise((r) => setTimeout(r, 50));

describe("the To-do badge's one read (my_badge_reads)", () => {
  afterEach(() => {
    cleanup();
    rig.calls = [];
    rig.keys = [];
    rig.badge = null;
  });

  it("asks once for every switched-on section and makes no old call; the to-dos come from its rows", async () => {
    rig.badge = () => ({ data: ALL_SECTIONS, error: null });
    const { result } = run();
    await waitFor(() => expect(titles(result)).toEqual(expect.arrayContaining(WANT_TODOS)));
    expect(titles(result).some((t) => /Pecan pralines/.test(t))).toBe(true);
    await settle();
    expect(rig.keys).toEqual([["backout", "cart", "free_asks", "offers", "refund_todos", "shop_orders"]]);
    expect(rig.calls).toEqual(["rpc:my_badge_reads"]);
    // Inventory floor: the read covers all six sections this guard counts.
    expect(rig.keys[0].length).toBeGreaterThan(5);
  });

  it("a section the server could not read (null) falls back to ONLY its own old call, and its to-do still shows", async () => {
    rig.badge = () => ({ data: { ...ALL_SECTIONS, refund_todos: null }, error: null });
    const { result } = run();
    await waitFor(() => expect(titles(result)).toEqual(expect.arrayContaining(WANT_TODOS)));
    await settle();
    expect(rig.calls.sort()).toEqual(["rpc:declutter_my_refund_todos", "rpc:my_badge_reads"]);
  });

  it("not deployed yet (PGRST202): every old call, as before", async () => {
    rig.badge = () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.my_badge_reads(p_keys) in the schema cache", hint: null } });
    const { result } = run();
    await waitFor(() => expect(titles(result)).toEqual(expect.arrayContaining(WANT_TODOS)));
    await settle();
    expect(rig.calls.filter((c) => c !== "rpc:my_badge_reads").sort()).toEqual([...OLD_CALLS].sort());
  });

  it("any other failure: every old call, so the badge never goes blank", async () => {
    rig.badge = () => ({ data: null, error: { code: "500", message: "upstream timeout" } });
    const { result } = run();
    await waitFor(() => expect(titles(result)).toEqual(expect.arrayContaining(WANT_TODOS)));
    await settle();
    expect(rig.calls.filter((c) => c !== "rpc:my_badge_reads").sort()).toEqual([...OLD_CALLS].sort());
  });

  it("does not retry a failed read: under the app's default retries the fallback still starts at once", async () => {
    rig.badge = () => ({ data: null, error: { code: "500", message: "upstream timeout" } });
    const { result } = run({ appRetry: true });
    await waitFor(() => expect(titles(result)).toEqual(expect.arrayContaining(WANT_TODOS)), { timeout: 900 });
    expect(rig.calls.filter((c) => c === "rpc:my_badge_reads")).toHaveLength(1);
  });
});
