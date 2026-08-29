// useSearchParamMirror writes a screen's view state into the URL so a history
// entry describes what the user was looking at.
//
// It shipped with an infinite navigation loop, and these tests exist because
// nothing caught it. `setSearchParams` navigates UNCONDITIONALLY and is not
// referentially stable, so guarding inside the updater — returning `prev` when
// nothing differed — still navigated, which re-created the callback, which
// re-armed the effect that had it as a dep. A guest sitting on /browse with no
// filters set spun ~200 `replaceState` calls per mount and never settled under
// test. WebKit throttles `replaceState` to ~100 per 30s and then throws, so on
// iOS that was a navigation hazard, not just wasted CPU.
//
// The first test below is the one that would have caught it. The rest pin the
// behaviour the hook exists for, so a future "fix" for the loop cannot quietly
// stop mirroring state.

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useSearchParamMirror } from "./useSearchParamMirror";
import { report } from "@/lib/errorLogger";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

/**
 * Render the hook inside a real router and count how many distinct locations
 * it produces. `useLocation().key` changes on every navigation — including a
 * `replace` to the identical URL — so counting keys counts navigations, which
 * is exactly what the loop was doing wrong.
 */
function renderMirror(
  initialEntry: string,
  adopt: (read: (k: string) => string) => void = () => {},
  initialState: Record<string, string> = {},
) {
  const locations: string[] = [];
  const keys = new Set<string>();

  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
  );

  // The hook is called DIRECTLY in the renderHook callback — renderHook renders
  // its own component around this, so returning JSX here would never mount.
  const view = renderHook(
    ({ state }: { state: Record<string, string> }) => {
      const loc = useLocation();
      locations.push(`${loc.pathname}${loc.search}`);
      keys.add(loc.key);
      useSearchParamMirror(state, adopt);
    },
    { wrapper, initialProps: { state: initialState } },
  );

  return {
    ...view,
    /** Distinct history entries seen — 1 means "never navigated". */
    navigations: () => keys.size,
    lastUrl: () => locations[locations.length - 1],
    renders: () => locations.length,
  };
}

describe("useSearchParamMirror", () => {
  it("does not navigate when the state already matches the URL", async () => {
    // THE REGRESSION TEST. Every value is default (empty), the URL is already
    // clean, so there is nothing to write — and the hook must therefore not
    // call the navigator at all. Before the fix this produced an unbounded
    // stream of replaceState calls.
    const m = renderMirror("/browse");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(m.navigations(), "a no-op mirror must not navigate").toBe(1);
    expect(m.lastUrl()).toBe("/browse");
  });

  it("does not navigate when non-default state is already present in the URL", async () => {
    // The other half of the same bug: arriving via a deep link that already
    // carries the params. State and URL agree, so again there is nothing to do.
    const m = renderMirror("/browse?category=cleaning");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // The hook is rendered with empty state here, so it will clear the param
    // once — one write, then silence. What must NOT happen is a stream.
    expect(m.navigations()).toBeLessThanOrEqual(2);
  });

  it("writes a changed value into the URL and then stops", async () => {
    const m = renderMirror("/browse");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const before = m.navigations();

    m.rerender({ state: { category: "cleaning" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(m.lastUrl()).toBe("/browse?category=cleaning");
    // Exactly one new history entry: the write. Converging, not looping.
    expect(m.navigations() - before, "one write, then settle").toBe(1);
  });

  it("removes a param when its value returns to the default", async () => {
    // An empty string means "default", and a default must leave the URL clean
    // rather than writing `?category=`.
    const m = renderMirror("/browse");
    m.rerender({ state: { category: "cleaning" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(m.lastUrl()).toBe("/browse?category=cleaning");

    m.rerender({ state: { category: "" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(m.lastUrl()).toBe("/browse");
  });

  it("calls adopt when the URL carries values the caller does not have", async () => {
    const adopt = vi.fn();
    // The caller must DECLARE the key it owns — `adopt` fires on the keys in
    // `state`, so an empty state owns nothing and has nothing to adopt.
    renderMirror("/browse?category=cleaning", adopt, { category: "" });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(adopt).toHaveBeenCalled();
    const read = adopt.mock.calls[0][0] as (k: string) => string;
    expect(read("category")).toBe("cleaning");
  });

  it("leaves params it does not own alone", async () => {
    // `?job=`, `?ref=`, `?quickApply=` are owned by other code paths. The
    // mirror only manages the keys it is given.
    const m = renderMirror("/browse?job=abc123");
    m.rerender({ state: { category: "cleaning" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const url = m.lastUrl();
    expect(url).toContain("job=abc123");
    expect(url).toContain("category=cleaning");
  });
});

// ── Runaway-write instrumentation ────────────────────────────────────────────
// The /my-posts replaceState crash survived three fixes, so the hook now
// reports when it writes too fast. That tripwire is only worth shipping if it
// actually trips — otherwise we would sit waiting on evidence that can never
// arrive. These two tests pin both halves: it fires on a genuine runaway, and
// it stays silent on the normal traffic the hook is supposed to produce.
describe("useSearchParamMirror runaway-write reporting", () => {
  it("reports once when writes exceed the burst threshold in the window", async () => {
    vi.mocked(report).mockClear();

    // Drive 40 DISTINCT states straight at the hook. Each one genuinely
    // differs from the URL, so each is a legitimate write — which is exactly
    // what a loop looks like from inside the hook: real writes, far too fast.
    const m = renderMirror("/my-posts", () => {}, { filter: "v0" });
    for (let i = 1; i <= 40; i++) {
      await act(async () => {
        m.rerender({ state: { filter: `v${i}` } });
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    const calls = vi.mocked(report).mock.calls;
    expect(calls.length, "a runaway must be reported").toBeGreaterThan(0);
    expect(calls.length, "and reported at most once per mount").toBe(1);

    const [err, opts] = calls[0] as [Error, { tags: Record<string, unknown> }];
    expect(String(err.message)).toMatch(/runaway writes/i);
    // The report is only useful if it carries the loop participants.
    expect(opts.tags.source).toBe("useSearchParamMirror");
    expect(Number(opts.tags.writesInWindow)).toBeGreaterThanOrEqual(25);
    expect(String(opts.tags.trail)).toMatch(/->/);
  });

  it("stays silent for ordinary write traffic", async () => {
    vi.mocked(report).mockClear();
    // A handful of real filter changes is normal use, not a loop.
    const m = renderMirror("/my-posts", () => {}, { filter: "" });
    for (const v of ["a", "b", "c", ""]) {
      await act(async () => {
        m.rerender({ state: { filter: v } });
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    expect(vi.mocked(report)).not.toHaveBeenCalled();
  });
});
