/*
 * GUARD (Q169, owner 2026-09-23): pages must not "jump" while they load —
 * "the public browse-jobs page loads, jumps, more cards appear, it loads
 * again, and more jobs load; they don't all load together."
 *
 * Measured on a production build against prod (scripts/audit/measure-page-
 * settle.mjs, 375, Fast 3G + 4x CPU): three separate causes, each fixed at a
 * shared layer and each pinned here.
 *
 *   1. JobCard (the one card every job feed renders) faded in on its own
 *      index x 70ms delay, so a list that arrived in ONE commit still reached
 *      the eye card by card. The class of defect is any list item animating
 *      in on an index-derived delay, so that is what is scanned for, app-wide.
 *   2. /browse painted its list, then re-sorted it ~400ms later when poster
 *      tiers arrived. useArrivalGate holds a page's skeleton until the primary
 *      query is in AND the secondary ones have settled (bounded by a cap).
 *   3. DashboardGuest must render its skeleton off that gate, not off the
 *      list query's own isLoading.
 *
 * The runtime half of this guard is e2e/happy-path/page-settle.spec.ts (CLS
 * and content waves per route, on the preview build).
 */
// @mutate src/components/dashboard/JobCard.tsx | : "group relative h-full rounded-2xl | : "motion-safe:animate-fade-in group relative h-full rounded-2xl
// @mutate src/hooks/useArrivalGate.ts | const ready = latched \|\| (primaryReady && (secondaryReady \|\| capped)); | const ready = latched \|\| primaryReady;
// @mutate src/pages/DashboardGuest.tsx | {!feedReady ? ( | {isLoading ? (
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { useArrivalGate, ARRIVAL_CAP_MS } from "@/hooks/useArrivalGate";

const SRC = resolve(__dirname, "..");
const read = (rel: string) => blankComments(readFileSync(join(SRC, rel), "utf8"));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "__tests__") continue;
      walk(p, out);
    } else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * An animation or transition delay computed from a list index: the staggered
 * entry that makes a list arrive one item at a time.
 */
const INDEX_DELAY = [
  /(animationDelay|transitionDelay)\s*:[^,}\n]*\b(i|idx|index)\b\s*\*/,
  /\bdelay\s*:\s*\(?\s*(i|idx|index)\b[^,}\n]*\*/,
  /\$\{[^}\n]*\b(i|idx|index)\s*\*[^}\n]*\}m?s\b/,
];

/**
 * Staggers that are NOT data arriving: exact, and two-way (each entry must
 * still match, or it is stale and must be removed).
 *   - HowItWorksSection: the landing page's three marketing steps, revealed on
 *     scroll. Static copy, never loaded data.
 *   - PayoutCelebration: confetti particles after a payout.
 */
const ALLOWED = ["components/landing/HowItWorksSection.tsx", "components/wallet/PayoutCelebration.tsx"];

describe("lists arrive in one wave (Q169)", () => {
  it("no component staggers items in on an index-derived delay", () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(400);
    const hits = files
      .filter((f) => INDEX_DELAY.some((re) => re.test(blankComments(readFileSync(f, "utf8")))))
      .map((f) => relative(SRC, f))
      .sort();
    expect(hits).toEqual([...ALLOWED].sort());
  });

  it("JobCard has no entry animation of its own", () => {
    const card = read("components/dashboard/JobCard.tsx");
    expect(card).toMatch(/group relative h-full rounded-2xl/);
    expect(card).not.toMatch(/animate-fade-in|animate-in\b|animationDelay/);
  });

  it("the guest browse feed renders its skeleton off the arrival gate", () => {
    const page = read("pages/DashboardGuest.tsx");
    expect(page).toMatch(/const feedReady = useArrivalGate\(!isLoading, enrichmentSettled\)/);
    expect(page).toMatch(/\{!feedReady \? \(/);
    expect(page).not.toMatch(/\{isLoading \? \(/);
  });
});

describe("useArrivalGate", () => {
  afterEach(() => vi.useRealTimers());

  it("waits for the primary data", () => {
    const { result } = renderHook(() => useArrivalGate(false, true));
    expect(result.current).toBe(false);
  });

  it("holds while the secondary data is pending, then opens at the cap", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useArrivalGate(true, false));
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(ARRIVAL_CAP_MS - 1); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
  });

  it("opens at once when both are in", () => {
    const { result } = renderHook(() => useArrivalGate(true, true));
    expect(result.current).toBe(true);
  });

  it("latches: a later refetch never brings the skeleton back", () => {
    const { result, rerender } = renderHook(({ p, s }) => useArrivalGate(p, s), { initialProps: { p: true, s: true } });
    expect(result.current).toBe(true);
    rerender({ p: false, s: false });
    expect(result.current).toBe(true);
  });

  it("the cap is short enough that a hung call cannot strand the page", () => {
    expect(ARRIVAL_CAP_MS).toBeGreaterThan(0);
    expect(ARRIVAL_CAP_MS).toBeLessThanOrEqual(2000);
  });
});
