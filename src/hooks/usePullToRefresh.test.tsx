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
    await performTouchSequence(el, 100, 130); // diff=30 → distance=15
    expect(onRefresh).not.toHaveBeenCalled();
    expect(hapticMock).not.toHaveBeenCalled();
  });

  it("fires onRefresh + haptic when pull distance crosses threshold", async () => {
    render(<Harness onRefresh={onRefresh} threshold={80} />);
    const el = screen.getByTestId("container");
    // diff=200 → distance=100 (capped at threshold*1.5=120). 100 >= 80 → fires.
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

  it("caps pullDistance at threshold*1.5 (rubber-band stop)", async () => {
    // Wrap with a state-tracking parent so we can observe pullDistance
    // mid-pull (between move and end).
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
      // diff=600 → raw distance=300, but cap is threshold*1.5 = 120
      fireTouch(el, "touchmove", 700);
    });
    expect(Number(el.getAttribute("data-distance"))).toBe(120);
  });
});
