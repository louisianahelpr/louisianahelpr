/**
 * useLongPress (MobileNav, MessageBubble, JobCardMetaRow, BulkDismissibleWrapper):
 * a press held past the threshold fires onLongPress once and never onTap; a
 * short press is a tap; drifting past the tolerance, leaving, or the system
 * cancelling the pointer/touch fires nothing.
 *
 * @mutate src/hooks/useLongPress.ts |       if (Math.hypot(dx, dy) > moveTolerance) clear(); |       void dx;
 * @mutate src/hooks/useLongPress.ts |     if (!fired && onTap) onTap(); |     if (onTap) onTap();
 * @mutate src/hooks/useLongPress.ts |     onPointerCancel: () => clear(), |     onPointerCancel: () => undefined,
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type React from "react";
import { useLongPress } from "./useLongPress";

const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] }) as unknown as React.TouchEvent;
const mouse = (x: number, y: number) => ({ clientX: x, clientY: y }) as unknown as React.MouseEvent;

function setup(opts: { threshold?: number; moveTolerance?: number; tap?: boolean } = {}) {
  const onLongPress = vi.fn();
  const onTap = opts.tap === false ? undefined : vi.fn();
  const { result } = renderHook(() =>
    useLongPress({ onLongPress, onTap, threshold: opts.threshold, moveTolerance: opts.moveTolerance }),
  );
  return { props: () => result.current, onLongPress, onTap };
}

describe("useLongPress", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a touch held past the default 500 ms fires onLongPress once, and its release is not a tap", () => {
    const { props, onLongPress, onTap } = setup();
    props().onTouchStart(touch(10, 10));
    vi.advanceTimersByTime(499);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    props().onTouchEnd();
    expect(onTap).not.toHaveBeenCalled();
  });

  it("a short press is a tap and never a long press", () => {
    const { props, onLongPress, onTap } = setup();
    props().onMouseDown(mouse(0, 0));
    vi.advanceTimersByTime(200);
    props().onMouseUp();
    vi.advanceTimersByTime(1000);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("a short press with no onTap does nothing", () => {
    const { props, onLongPress } = setup({ tap: false });
    props().onMouseDown(mouse(0, 0));
    props().onMouseUp();
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("drifting past the tolerance cancels; drifting within it does not", () => {
    const within = setup({ moveTolerance: 8 });
    within.props().onTouchStart(touch(0, 0));
    within.props().onTouchMove(touch(3, 4)); // 5 px
    vi.advanceTimersByTime(500);
    expect(within.onLongPress).toHaveBeenCalledTimes(1);

    const past = setup({ moveTolerance: 8 });
    past.props().onMouseDown(mouse(0, 0));
    past.props().onMouseMove(mouse(6, 8)); // 10 px
    vi.advanceTimersByTime(1000);
    expect(past.onLongPress).not.toHaveBeenCalled();
  });

  it("a move with no press in progress is ignored", () => {
    const { props, onLongPress } = setup();
    props().onMouseMove(mouse(100, 100));
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("leaving the element, a touch cancel, or a pointer cancel fires nothing", () => {
    for (const cancel of ["onMouseLeave", "onTouchCancel", "onPointerCancel"] as const) {
      const { props, onLongPress, onTap } = setup();
      props().onTouchStart(touch(0, 0));
      (props()[cancel] as () => void)();
      vi.advanceTimersByTime(1000);
      expect(onLongPress, cancel).not.toHaveBeenCalled();
      expect(onTap, cancel).not.toHaveBeenCalled();
    }
  });

  it("honours a custom threshold", () => {
    const { props, onLongPress } = setup({ threshold: 250 });
    props().onMouseDown(mouse(0, 0));
    vi.advanceTimersByTime(250);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });
});
