/**
 * /home settles in one paint at 375 (builder3g-1115 handoff §4, Builder 3h 11-15; Q1816 page-settle family).
 *
 * Shift 1: Needs you grew 157 -> 208px. useNeedsYouTodos said "loaded" once the two jobs reads answered, so the card
 * painted "1 of 1" and then grew the dots row and the wrapped action row when a Declutter to-do landed from the badge
 * read. The hook now stays loading until every source it builds the list from has answered (data or error), capped
 * at ARRIVAL_CAP_MS after the jobs reads, and latched once settled.
 * Shift 2: the section chips. Their "near you" counts are asked after the page settles, so "Declutter · N items near
 * you" arrived late and wrapped onto a new row. The chips (the last blocks on the page) now wait for those counts,
 * capped, and paint once. Behaviour at the cap: dashboardsShell.test.tsx ("shows the member's sections").
 *
 * @mutate src/pages/home/homeDashboard/useNeedsYouTodos.ts |   const loading = jobsLoading \|\| (settledFor !== uid && othersPending && !capped); |   const loading = jobsLoading;
 * @mutate src/pages/home/homeDashboard/useNeedsYouTodos.ts |   const loading = jobsLoading \|\| (settledFor !== uid && othersPending && !capped); |   const loading = jobsLoading \|\| (settledFor !== uid && othersPending);
 * @mutate src/pages/home/homeDashboard/useNeedsYouTodos.ts |     \|\| (declutterOn && (!answered(dCart) \|\| !answered(dOffers) \|\| !answered(dFreeAsks))) |     \|\| (declutterOn && (!answered(dCart) \|\| !answered(dOffers)))
 * @mutate src/pages/home/homeDashboard/useNeedsYouTodos.ts |   const answered = (q: { data: unknown; isError: boolean }) => q.data !== undefined \|\| q.isError; |   const answered = (q: { data: unknown; isError: boolean }) => q.data !== undefined;
 * @mutate src/pages/home/HomeDashboard.tsx |   const chipsReady = useArrivalGate(!holdBelowNextUp, !summary.tilesPending); |   const chipsReady = !holdBelowNextUp;
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts |         \|\| (declutterOn && declutterNear.data === undefined && !declutterNear.isError), |         \|\| false,
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User as SupaUser } from "@supabase/supabase-js";
import { useNeedsYouTodos } from "@/pages/home/homeDashboard/needsYouTodos";
import { blankComments } from "./helpers/blankNonCode";

const rig = vi.hoisted(() => ({
  badge: null as null | Promise<{ data: unknown; error: unknown }>,
  release: null as null | ((v: { data: unknown; error: unknown }) => void),
  free: null as null | Promise<{ data: unknown; error: unknown }>,
  releaseFree: null as null | ((v: { data: unknown; error: unknown }) => void),
}));

const FREE = [{ item_id: "f1", created_at: "2026-11-01T10:00:00Z", declutter_items: { title: "Patio chairs" } }];
const SECTIONS = { cart: [], offers: [], refund_todos: [], free_asks: FREE, backout: [], shop_orders: [] };

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
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "not", "order", "limit", "in"]) q[m] = () => q;
    q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      (name === "declutter_free_requests" && rig.free ? rig.free : Promise.resolve({ data: [], error: null })).then(res, rej);
    return q;
  };
  return {
    supabase: {
      auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
      rpc: (name: string) => (name === "my_badge_reads" && rig.badge ? rig.badge : Promise.resolve({ data: [], error: null })),
      from: (name: string) => table(name),
    },
  };
});

function run() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(() => useNeedsYouTodos({ id: "u1" } as SupaUser), { wrapper });
}
const hold = () => { rig.badge = new Promise((r) => { rig.release = r; }); };
const code = (rel: string) => blankComments(readFileSync(resolve(__dirname, "../..", rel), "utf8"));

describe("/home's Needs you and section chips paint once (page settle 375)", () => {
  afterEach(() => { cleanup(); rig.badge = null; rig.release = null; rig.free = null; rig.releaseFree = null; });

  it("Needs you stays loading while the Declutter to-dos are out, then shows them in the same paint", async () => {
    hold();
    const { result } = run();
    const seen: { loading: boolean; n: number }[] = [];
    const watch = () => seen.push({ loading: result.current.loading, n: result.current.todos.length });
    // The jobs reads answer at once; the badge read (Declutter's free asks) is still out.
    await new Promise((r) => setTimeout(r, 150));
    watch();
    expect(result.current.loading).toBe(true);
    rig.release!({ data: SECTIONS, error: null });
    await waitFor(() => { watch(); expect(result.current.loading).toBe(false); });
    expect(result.current.todos.map((t) => t.title)).toContain("Pick who gets Patio chairs");
    // Never "loaded" with the list still short.
    expect(seen.filter((s) => !s.loading).every((s) => s.n === 1)).toBe(true);
  });

  it("a section on its own old call (free asks) is waited on too, and its failure is an answer, not a wait", async () => {
    rig.badge = Promise.resolve({ data: { ...SECTIONS, free_asks: null }, error: null });
    rig.free = new Promise((r) => { rig.releaseFree = r; });
    const { result } = run();
    await new Promise((r) => setTimeout(r, 150));
    expect(result.current.loading).toBe(true);
    const t0 = Date.now();
    rig.releaseFree!({ data: null, error: { code: "500", message: "upstream timeout" } });
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 2500 });
    // Well inside ARRIVAL_CAP_MS (1500): the failed read ended the wait, not the cap.
    expect(Date.now() - t0).toBeLessThan(800);
  });

  it("a Declutter read that never answers holds Needs you for at most the cap", async () => {
    hold();
    const { result } = run();
    await new Promise((r) => setTimeout(r, 150));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 2500 });
  });

  it("the section chips wait, capped, on their near-you counts", () => {
    const home = code("src/pages/home/HomeDashboard.tsx");
    expect(home).toContain("const chipsReady = useArrivalGate(!holdBelowNextUp, !summary.tilesPending);");
    const held = home.indexOf("{chipsReady ? <>");
    const chips = home.indexOf('<div data-section-chips="" ');
    const soon = home.indexOf('data-testid="sections-opening-soon"');
    expect(held).toBeGreaterThan(-1);
    expect(chips).toBeGreaterThan(held);
    expect(soon).toBeGreaterThan(chips);
    const summary = code("src/pages/home/homeDashboard/useHomeSummary.ts");
    const pending = summary.match(/tilesPending:[^,]+,[^,]+,/)?.[0] ?? "";
    // Inventory floor: both near counts the chips show (Jobs and Declutter) are waited on.
    expect((pending.match(/Near\.data === undefined/g) ?? []).length).toBeGreaterThan(1);
  });
});
