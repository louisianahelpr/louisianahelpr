/**
 * Q2706/Q2708 (Builder 3, 11-04): /home's layout shift on Fast 4G at 375 was 0.38 live (dpl_DatvNXtz, helper persona,
 * cwv-lab, 3 runs: 0.381 / 0.378 / 0.381). Attribution, same in every run:
 *   (1) 0.20  PosterFirstJobCard arrived above Next up after the rest of Home was drawn (Your sections 392 -> 594 px);
 *   (3)+(4) 0.03 + 0.10  Next up said "You're all caught up" (106 px) once ONE side's activity read answered, then grew
 *           to "Next up · 1 of 9" when the other side's to-dos landed.
 *   Left after that fix (Builder 3, 11-04 PM, prod build, Fast 4G helper x3, CLS 0.1089 each run): the money strip
 *   arriving above Coming up (0.050) and Next up growing from its loading lines to "1 of 9" (0.059), first visit only
 *   (no saved height to hold). Fix: on a first visit the blocks BELOW Next up wait for the to-dos and money reads
 *   (useHoldWhileFirstVisitReads); Next up is not held, so the greeting stays the LCP.
 * Fixes: Home draws one placeholder in place of its columns until the first-week cards' reads answer
 * (homeTopSettled.ts), and the to-dos are loading until BOTH activity reads have answered (useNeedsYouTodos.ts).
 *
 * @mutate src/pages/home/homeDashboard/homeTopSettled.ts |   return firstSettled && (!needPoster \|\| posterSettled); |   return true;
 * @mutate src/pages/home/homeDashboard/homeTopSettled.ts |   return firstSettled && (!needPoster \|\| posterSettled); |   return firstSettled;
 * @mutate src/pages/home/homeDashboard/homeTopSettled.ts |   if (!userId \|\| timedOut) return true; |   if (!userId) return true;
 * @mutate src/pages/home/HomeDashboard.tsx |         {topSettled && <div data-home-columns | {<div data-home-columns
 * @mutate src/pages/home/homeDashboard/homeTopSettled.ts |   if (!pending \|\| timedOut) released.current = true; |   if (timedOut) released.current = true;
 * @mutate src/pages/home/homeDashboard/homeTopSettled.ts |   if (!pending \|\| timedOut) released.current = true; |   if (!pending) released.current = true;
 * @mutate src/pages/home/homeDashboard/homeTopSettled.ts |   return !released.current; |   return pending && !timedOut;
 * @mutate src/pages/home/HomeDashboard.tsx | useHoldWhileFirstVisitReads(firstVisit && (summary.todosLoading \|\| !!money.pending)) | useHoldWhileFirstVisitReads(false)
 * @mutate src/pages/home/HomeDashboard.tsx |             {!holdBelowNextUp && <> |             {<>
 * @mutate src/pages/home/HomeDashboard.tsx |           {!holdBelowNextUp && <section data-home-side |           {<section data-home-side
 * @mutate src/pages/home/homeDashboard/useNeedsYouTodos.ts | loading: !derive \|\| posted.isPending \|\| applied.isPending, | loading: !derive \|\| (posted.data === undefined && applied.data === undefined),
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderHook, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { blankComments } from "./helpers/blankNonCode";

const poster = vi.hoisted(() => ({ resolve: null as null | ((v: unknown) => void), calls: 0 }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: () => {
            poster.calls += 1;
            return new Promise((r) => { poster.resolve = r; });
          },
        }),
      }),
    }),
  },
}));

const { useHomeTopSettled, useHoldWhileFirstVisitReads, HOME_TOP_MAX_WAIT_MS } = await import("@/pages/home/homeDashboard/homeTopSettled");

const code = (rel: string) => blankComments(readFileSync(resolve(__dirname, "../..", rel), "utf8"));

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  poster.resolve = null;
  poster.calls = 0;
});

describe("Home's columns wait for the first-week cards' reads (Q2706/Q2708)", () => {
  it("holds while the first-job read is out, then while the poster read is out, then opens", async () => {
    const { qc, wrapper } = setup();
    let answerFirst!: (v: { isNew: boolean; alertsOff: boolean }) => void;
    void qc.prefetchQuery({ queryKey: ["home", "first-job-state", "u1"], queryFn: () => new Promise((r) => { answerFirst = r; }) });
    const { result, rerender } = renderHook(({ fj }: { fj: { isNew: boolean } | null }) => useHomeTopSettled("u1", fj), { wrapper, initialProps: { fj: null as { isNew: boolean } | null } });
    expect(result.current).toBe(false);
    await act(async () => { answerFirst({ isNew: false, alertsOff: false }); await Promise.resolve(); });
    // The render the first-job state answers: the poster card's read is required and asked here, so still held.
    rerender({ fj: { isNew: false } });
    expect(result.current).toBe(false);
    expect(poster.calls).toBe(1);
    await act(async () => { poster.resolve!({ data: [], error: null }); await new Promise((r) => setTimeout(r, 10)); });
    expect(result.current).toBe(true);
  });

  it("a newcomer needs no poster read; a read nobody asked for is settled", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useHomeTopSettled("u1", { isNew: true }), { wrapper });
    expect(result.current).toBe(true);
    expect(poster.calls).toBe(0);
  });

  it("never hides Home longer than the cap, even on a hung read", async () => {
    vi.useFakeTimers();
    const { qc, wrapper } = setup();
    void qc.prefetchQuery({ queryKey: ["home", "first-job-state", "u1"], queryFn: () => new Promise(() => {}) });
    const { result } = renderHook(() => useHomeTopSettled("u1", null), { wrapper });
    expect(result.current).toBe(false);
    await act(async () => { vi.advanceTimersByTime(HOME_TOP_MAX_WAIT_MS + 1); });
    expect(result.current).toBe(true);
    expect(HOME_TOP_MAX_WAIT_MS).toBeGreaterThan(1000);
  });

  it("first visit: the blocks below Next up wait for the to-dos and money reads, then stay released, capped", async () => {
    vi.useFakeTimers();
    const { wrapper } = setup();
    const { result, rerender } = renderHook(({ p }: { p: boolean }) => useHoldWhileFirstVisitReads(p), { wrapper, initialProps: { p: true } });
    expect(result.current).toBe(true);
    rerender({ p: false });
    expect(result.current).toBe(false);
    // A read going out again after the blocks are drawn must never hide them.
    rerender({ p: true });
    expect(result.current).toBe(false);
    const hung = renderHook(() => useHoldWhileFirstVisitReads(true), { wrapper });
    expect(hung.result.current).toBe(true);
    await act(async () => { vi.advanceTimersByTime(HOME_TOP_MAX_WAIT_MS + 1); });
    expect(hung.result.current).toBe(false);
  });

  it("Home holds the money strip, Coming up and Your sections (not Next up) on a first visit", () => {
    const home = code("src/pages/home/HomeDashboard.tsx");
    expect(home).toContain("!readReservedHeight(`next-up:${user.id}`)");
    expect(home).toContain("const holdBelowNextUp = useHoldWhileFirstVisitReads(firstVisit && (summary.todosLoading || !!money.pending));");
    const nextUp = home.indexOf('data-testid="next-up"');
    const held = home.indexOf("{!holdBelowNextUp && <>");
    const money = home.indexOf('<HomeMoneyTiles money={money} placement="main" />');
    const coming = home.indexOf('<GroupSection title="Coming up">');
    expect(nextUp).toBeGreaterThan(0);
    expect(held).toBeGreaterThan(nextUp);
    expect(money).toBeGreaterThan(held);
    expect(coming).toBeGreaterThan(money);
    expect(home).toContain("{!holdBelowNextUp && <section data-home-side");
  });

  it("Home draws its columns only once settled, and the to-dos load until both activity reads answer", () => {
    const home = code("src/pages/home/HomeDashboard.tsx");
    expect(home).toContain("const topSettled = useHomeTopSettled(user?.id, firstJob);");
    expect(home).toContain("{topSettled && <div data-home-columns");
    expect(home).toContain('{!topSettled && (');
    const todos = code("src/pages/home/homeDashboard/useNeedsYouTodos.ts");
    expect(todos).toContain("loading: !derive || posted.isPending || applied.isPending,");
    // Inventory floor: the gate covers both first-week cards.
    const gate = code("src/pages/home/homeDashboard/homeTopSettled.ts");
    const keys = gate.match(/"first-job-state"|usePosterFirstJob\(/g) ?? [];
    expect(keys.length).toBeGreaterThan(1);
  });
});
