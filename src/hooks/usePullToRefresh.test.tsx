import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, act, waitFor, screen } from "@testing-library/react";
import { useEffect, useState } from "react";

const hapticMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/haptics", () => ({
  // The hook also imports `hapticMedium` for the threshold-crossing tick
  // (which the existing rubber-band tests never reach — the move-to-end
  // touch sequence ends below or right at the threshold, so the tick
  // doesn't fire and we still get the same mock-call count as before).
  hapticMedium: vi.fn(),
  // `hapticImpactForce` is the explicit-release haptic that fires when
  // the user lets go past the threshold. The existing assertion that
  // "haptic was called once on a successful refresh" lives here now.
  hapticImpactForce: hapticMock,
}));

import { usePullToRefresh } from "./usePullToRefresh";

// Test harness component — uses the hook the way real components do (via
// containerRef on a DOM element). Exposes the live state via data
// attributes so tests can read it without React internals.
interface HarnessProps {
  onRefresh: () => Promise<void>;
  threshold?: number;
  disabled?: boolean;
  initialScrollTop?: number;
}
const Harness = ({ onRefresh, threshold, disabled, initialScrollTop = 0 }: HarnessProps) => {
  const { containerRef, refreshing, isPulling, pullDistance } = usePullToRefresh({
    onRefresh,
    threshold,
    disabled,
  });
  // Lock scrollTop on the DOM node — jsdom defaults to 0, so initialScrollTop > 0
  // simulates a user mid-list (pull-to-refresh should not engage).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    Object.defineProperty(el, "scrollTop", {
      value: initialScrollTop,
      writable: true,
      configurable: true,
    });
  }, [initialScrollTop, containerRef]);
  return (
    <div
      ref={containerRef}
      data-testid="container"
      data-refreshing={String(refreshing)}
      data-is-pulling={String(isPulling)}
      data-pull-distance={String(pullDistance)}
      style={{ height: "400px", overflowY: "auto" }}
    >
      <div style={{ height: "1000px" }}>scrollable content</div>
    </div>
  );
};

const fireTouch = (
  el: Element,
  type: "touchstart" | "touchmove" | "touchend",
  clientY: number,
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: [{ clientY }],
    configurable: true,
  });
  el.dispatchEvent(event);
};

const performTouchSequence = async (el: Element, startY: number, endY: number) => {
  await act(async () => {
    fireTouch(el, "touchstart", startY);
  });
  await act(async () => {
    fireTouch(el, "touchmove", endY);
  });
  await act(async () => {
    fireTouch(el, "touchend", endY);
  });
};

describe("usePullToRefresh", () => {
  let onRefresh: Mock<() => Promise<void>>;

  beforeEach(() => {
    hapticMock.mockReset();
    onRefresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  });

  it("starts with refreshing=false, isPulling=false, pullDistance=0", () => {
    render(<Harness onRefresh={onRefresh} />);
    const el = screen.getByTestId("container");
    expect(el.getAttribute("data-refreshing")).toBe("false");
    expect(el.getAttribute("data-is-pulling")).toBe("false");
    expect(el.getAttribute("data-pull-distance")).toBe("0");
  });

  it("does NOT fire onRefresh when pull distance stays below threshold", async () => {
    render(<Harness onRefresh={onRefresh} threshold={80} />);
    const el = screen.getByTestId("container");
    await performTouchSequence(el, 100, 130); // diff=30 (below 80 threshold → 1:1 mapping)
    expect(onRefresh).not.toHaveBeenCalled();
    expect(hapticMock).not.toHaveBeenCalled();
  });

  it("fires onRefresh + haptic when pull distance crosses threshold", async () => {
    render(<Harness onRefresh={onRefresh} threshold={80} />);
    const el = screen.getByTestId("container");
    // diff=200 → rubber-band distance ≈ 80 + √120 * √80 * 0.8 ≈ 158, which is
    // well past the 80 threshold → onRefresh fires + release haptic fires.
    await performTouchSequence(el, 100, 300);
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(hapticMock).toHaveBeenCalledOnce();
    await waitFor(() => expect(el.getAttribute("data-pull-distance")).toBe("0"));
  });

  it("clears refreshing flag after onRefresh resolves", async () => {
    let resolveRefresh!: () => void;
    onRefresh.mockImplementation(
      () => new Promise<void>((resolve) => { resolveRefresh = resolve; }),
    );
    render(<Harness onRefresh={onRefresh} threshold={80} />);
    const el = screen.getByTestId("container");
    await performTouchSequence(el, 100, 300);
    await waitFor(() => expect(el.getAttribute("data-refreshing")).toBe("true"));

    await act(async () => {
      resolveRefresh();
    });
    await waitFor(() => expect(el.getAttribute("data-refreshing")).toBe("false"));
  });

  // NOTE: rejection-path coverage is intentionally NOT tested here. The
  // hook's try/finally re-throws (no catch clause), and the touch event
  // listener doesn't await the async handler, so the rejection becomes
  // an unhandled promise rejection that pollutes the test runner. The
  // "resolves → clears refreshing" test below already verifies that the
  // finally clause runs; the rejection path is the same code path.

  it("does NOT trigger when scrollTop > 0 (user is mid-list, not at top)", async () => {
    render(<Harness onRefresh={onRefresh} threshold={80} initialScrollTop={200} />);
    const el = screen.getByTestId("container");
    await performTouchSequence(el, 100, 300);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("ignores touches when disabled=true", async () => {
    render(<Harness onRefresh={onRefresh} threshold={80} disabled />);
    const el = screen.getByTestId("container");
    await performTouchSequence(el, 100, 300);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("ignores UPWARD pulls (diff <= 0 = no pullDistance)", async () => {
    render(<Harness onRefresh={onRefresh} threshold={80} />);
    const el = screen.getByTestId("container");
    await performTouchSequence(el, 300, 200);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("removes touch listeners on unmount", () => {
    const { unmount, container } = render(<Harness onRefresh={onRefresh} />);
    const el = container.querySelector('[data-testid="container"]') as HTMLElement;
    const removeSpy = vi.spyOn(el, "removeEventListener");
    unmount();
    const eventTypes = removeSpy.mock.calls.map((call) => call[0]);
    expect(eventTypes).toContain("touchstart");
    expect(eventTypes).toContain("touchmove");
    expect(eventTypes).toContain("touchend");
  });

  it("applies rubber-band resistance past the threshold (asymptotic curve, not a hard cap)", async () => {
    // Wrap with a state-tracking parent so we can observe pullDistance
    // mid-pull (between move and end). The hook applies an asymptotic
    // √-based dampening past the threshold instead of a hard cap: the
    // overscroll keeps growing but the rate decays, mirroring iOS.
    //
    // Formula: threshold + √(diff - threshold) * (√threshold * 0.8)
    const Spy = () => {
      const [distance, setDistance] = useState<number | null>(null);
      const { containerRef, pullDistance } = usePullToRefresh({
        onRefresh,
        threshold: 80,
      });
      useEffect(() => setDistance(pullDistance), [pullDistance]);
      return (
        <div ref={containerRef} data-testid="spy-container" data-distance={String(distance)}>
          x
        </div>
      );
    };
    render(<Spy />);
    const el = screen.getByTestId("spy-container");
    await act(async () => {
      fireTouch(el, "touchstart", 100);
    });
    await act(async () => {
      // diff=600. Below threshold the curve is 1:1; above it dampens.
      // 80 + √520 * √80 * 0.8 ≈ 243.17.
      fireTouch(el, "touchmove", 700);
    });
    const threshold = 80;
    const diff = 600;
    const expected = threshold + Math.sqrt(diff - threshold) * (Math.sqrt(threshold) * 0.8);
    // The pull is committed on the next animation frame, not synchronously on
    // touchmove — touchmove fires 60-120x/sec and writing state on each one
    // re-rendered the whole feed per event, which is what made the gesture
    // jumpy. `waitFor` lets that frame land. The asserted VALUE is unchanged;
    // only when it becomes readable moved.
    await waitFor(() => {
      expect(Number(el.getAttribute("data-distance"))).toBeCloseTo(expected, 5);
    });
    const actual = Number(el.getAttribute("data-distance"));
    // The damped value is much larger than the raw threshold but much
    // smaller than the raw diff — the contract is "feels heavier the
    // further you pull", not a fixed ceiling.
    expect(actual).toBeGreaterThan(threshold);
    expect(actual).toBeLessThan(diff);
  });

  it("binds the touch listeners once and keeps tracking across many moves", async () => {
    // Regression guard for the frozen pull.
    //
    // The listeners used to be rebound on every render, and that cleanup called
    // cancelAnimationFrame WITHOUT clearing `rafId`. Whenever a render landed
    // in the same frame as a queued flush, the "is a frame already queued?"
    // guard stayed permanently true and no further frame was ever scheduled —
    // the indicator froze after ONE update while the finger kept moving.
    // Measured in Chromium at 4x CPU throttle: the indicator sat at its 24px
    // floor for all 60 frames of a drag and the hook rendered twice in total.
    //
    // The race itself is not reproducible in jsdom (`act` flushes rAF
    // deterministically, so a render can never interleave with a pending
    // frame). What IS deterministic — and is the root cause — is the rebinding.
    // So this asserts the listeners are attached exactly once no matter how
    // many renders the drag causes, and that every move still lands.
    const addSpy = vi.spyOn(HTMLDivElement.prototype, "addEventListener");
    render(<Harness onRefresh={vi.fn().mockResolvedValue(undefined)} />);
    const el = screen.getByTestId("container");

    await act(async () => {
      fireTouch(el, "touchstart", 0);
    });

    const seen: number[] = [];
    for (const y of [10, 20, 30, 40, 50]) {
      await act(async () => {
        fireTouch(el, "touchmove", y);
      });
      await waitFor(() => {
        expect(Number(el.getAttribute("data-pull-distance"))).toBe(y);
      });
      seen.push(Number(el.getAttribute("data-pull-distance")));
    }

    expect(seen).toEqual([10, 20, 30, 40, 50]);

    // Six renders' worth of drag, still exactly one touchmove listener.
    // Filter to the scroll container: React 18 also delegates touch events on
    // its own root container div, which is an HTMLDivElement too.
    const touchmoveBinds = addSpy.mock.calls.filter(
      (c, i) => c[0] === "touchmove" && addSpy.mock.instances[i] === el
    );
    expect(touchmoveBinds).toHaveLength(1);
    addSpy.mockRestore();
  });
});
