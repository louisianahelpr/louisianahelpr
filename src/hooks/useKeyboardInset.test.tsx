import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
/**
 * @mutate src/hooks/useKeyboardInset.ts |       return () => {\n        cancelled = true;\n        subs.forEach((s) => s.remove());\n      };\n |       void 0;\n
 */
import { renderHook, act, waitFor } from "@testing-library/react";

// Mock the Capacitor + Keyboard plugin paths so the hook can be exercised
// in both "native" and "web" modes by toggling Capacitor.isNativePlatform().
const mocks = vi.hoisted(() => {
  const showListeners: Array<(info: { keyboardHeight: number }) => void> = [];
  const hideListeners: Array<() => void> = [];
  const showRemove = vi.fn();
  const hideRemove = vi.fn();
  const isNativePlatformMock = vi.fn(() => false);
  const addListenerMock = vi.fn(async (event: string, fn: (info: unknown) => void) => {
    if (event === "keyboardWillShow") {
      showListeners.push(fn as (info: { keyboardHeight: number }) => void);
      return { remove: showRemove };
    }
    if (event === "keyboardWillHide") {
      hideListeners.push(fn as () => void);
      return { remove: hideRemove };
    }
    return { remove: vi.fn() };
  });
  return {
    showListeners,
    hideListeners,
    showRemove,
    hideRemove,
    isNativePlatformMock,
    addListenerMock,
    fireKeyboardWillShow: (h: number) =>
      showListeners.forEach((fn) => fn({ keyboardHeight: h })),
    fireKeyboardWillHide: () => hideListeners.forEach((fn) => fn()),
  };
});

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mocks.isNativePlatformMock() },
}));
vi.mock("@capacitor/keyboard", () => ({
  Keyboard: { addListener: mocks.addListenerMock },
}));

import { useKeyboardInset } from "./useKeyboardInset";

const flushAsync = async () => {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
};

describe("useKeyboardInset", () => {
  let originalVisualViewport: typeof window.visualViewport;
  let vvListeners: Record<string, Array<EventListener>>;

  beforeEach(() => {
    mocks.showListeners.length = 0;
    mocks.hideListeners.length = 0;
    mocks.showRemove.mockReset();
    mocks.hideRemove.mockReset();
    mocks.isNativePlatformMock.mockReset().mockReturnValue(false);
    mocks.addListenerMock.mockClear();

    originalVisualViewport = window.visualViewport as typeof window.visualViewport;
    vvListeners = { resize: [], scroll: [] };
  });

  afterEach(() => {
    Object.defineProperty(window, "visualViewport", {
      value: originalVisualViewport,
      configurable: true,
    });
  });

  // Helper to install a fake visualViewport object for the web fallback tests.
  const installFakeVisualViewport = (height: number, offsetTop: number) => {
    const vv = {
      get height() {
        return this._height as number;
      },
      get offsetTop() {
        return this._offsetTop as number;
      },
      _height: height,
      _offsetTop: offsetTop,
      addEventListener: vi.fn((evt: string, fn: EventListener) => {
        vvListeners[evt] = vvListeners[evt] || [];
        vvListeners[evt].push(fn);
      }),
      removeEventListener: vi.fn((evt: string, fn: EventListener) => {
        vvListeners[evt] = (vvListeners[evt] || []).filter((f) => f !== fn);
      }),
    };
    Object.defineProperty(window, "visualViewport", {
      value: vv,
      configurable: true,
    });
    // Force window.innerHeight to a known value so the diff math is stable.
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
    });
    return vv;
  };

  it("starts at 0 inset on mount (no keyboard)", () => {
    const { result } = renderHook(() => useKeyboardInset());
    expect(result.current).toBe(0);
  });

  it("native: subscribes to keyboardWillShow + keyboardWillHide on mount", async () => {
    mocks.isNativePlatformMock.mockReturnValue(true);
    renderHook(() => useKeyboardInset());
    await flushAsync();
    expect(mocks.addListenerMock).toHaveBeenCalledWith(
      "keyboardWillShow",
      expect.any(Function),
    );
    expect(mocks.addListenerMock).toHaveBeenCalledWith(
      "keyboardWillHide",
      expect.any(Function),
    );
  });

  it("native: updates inset to keyboard height when keyboardWillShow fires", async () => {
    mocks.isNativePlatformMock.mockReturnValue(true);
    const { result } = renderHook(() => useKeyboardInset());
    await flushAsync();
    await act(async () => {
      mocks.fireKeyboardWillShow(312);
    });
    await waitFor(() => expect(result.current).toBe(312));
  });

  it("native: resets inset to 0 when keyboardWillHide fires", async () => {
    mocks.isNativePlatformMock.mockReturnValue(true);
    const { result } = renderHook(() => useKeyboardInset());
    await flushAsync();
    await act(async () => {
      mocks.fireKeyboardWillShow(312);
    });
    await waitFor(() => expect(result.current).toBe(312));
    await act(async () => {
      mocks.fireKeyboardWillHide();
    });
    await waitFor(() => expect(result.current).toBe(0));
  });

  it("native: removes both Capacitor listeners on unmount", async () => {
    mocks.isNativePlatformMock.mockReturnValue(true);
    const { unmount } = renderHook(() => useKeyboardInset());
    await flushAsync();
    unmount();
    await flushAsync();
    expect(mocks.showRemove).toHaveBeenCalled();
    expect(mocks.hideRemove).toHaveBeenCalled();
  });

  // NB-010: native must NOT also attach visualViewport. With Keyboard.resize
  // = 'body', visualViewport reads ~0 and overwrote the real keyboard height.
  it("native: never subscribes to visualViewport, and keeps the keyboard height", async () => {
    mocks.isNativePlatformMock.mockReturnValue(true);
    const vv = installFakeVisualViewport(800, 0);
    const { result } = renderHook(() => useKeyboardInset());
    await flushAsync();
    expect(vv.addEventListener).not.toHaveBeenCalled();
    act(() => mocks.fireKeyboardWillShow(300));
    act(() => vvListeners.resize.forEach((fn) => fn(new Event("resize"))));
    expect(result.current).toBe(300);
  });

  it("web: subscribes to visualViewport resize + scroll", async () => {
    const vv = installFakeVisualViewport(800, 0);
    renderHook(() => useKeyboardInset());
    await flushAsync();
    expect(vv.addEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(vv.addEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));
  });

  it("web: ignores tiny offsets (browser-chrome diff < 80px)", async () => {
    const vv = installFakeVisualViewport(750, 0); // diff = 50, below threshold
    const { result } = renderHook(() => useKeyboardInset());
    await flushAsync();
    // Fire a resize so the update handler runs
    await act(async () => {
      vvListeners.resize.forEach((fn) => fn(new Event("resize")));
    });
    expect(result.current).toBe(0);
    expect(vv).toBeDefined();
  });

  it("web: reports the inset when diff exceeds the 80px threshold", async () => {
    const vv = installFakeVisualViewport(500, 0); // diff = 300, real keyboard
    const { result } = renderHook(() => useKeyboardInset());
    await flushAsync();
    await act(async () => {
      vvListeners.resize.forEach((fn) => fn(new Event("resize")));
    });
    expect(result.current).toBe(300);
    expect(vv).toBeDefined();
  });

  it("web: subtracts visualViewport.offsetTop from the diff", async () => {
    // viewport is 600 tall, scrolled down by 50 — only 150 is "real" keyboard
    const vv = installFakeVisualViewport(600, 50);
    const { result } = renderHook(() => useKeyboardInset());
    await flushAsync();
    await act(async () => {
      vvListeners.resize.forEach((fn) => fn(new Event("resize")));
    });
    // 800 (innerHeight) - 600 (vv.height) - 50 (offsetTop) = 150 → above threshold
    expect(result.current).toBe(150);
    expect(vv).toBeDefined();
  });

  it("web: reports an already-open keyboard on mount, before any event fires", async () => {
    // HOLLOW UNTIL 2026-09-21: every web assertion above fired a `resize`
    // first, so deleting the hook's own `update()` call at subscribe time left
    // all of them green. That call is the whole reason the chat input is not
    // buried on mount — navigating to a thread with the keyboard already up
    // (tap "Message" from a card, iOS keeps the keyboard) fires no resize at
    // all, so the only reading the hook ever gets is this one.
    installFakeVisualViewport(500, 0); // diff = 300, keyboard already up
    const { result } = renderHook(() => useKeyboardInset());
    await flushAsync();
    // No vvListeners.resize.forEach(...) here, deliberately.
    expect(vvListeners.resize.length).toBeGreaterThan(0); // subscribed...
    expect(result.current).toBe(300); // ...and it read the viewport itself.
  });

  it("web: removes both visualViewport listeners on unmount", async () => {
    const vv = installFakeVisualViewport(800, 0);
    const { unmount } = renderHook(() => useKeyboardInset());
    await flushAsync();
    unmount();
    expect(vv.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(vv.removeEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});

// Shown able to fail:
// The 80px threshold is what separates a real keyboard from Safari's own
// collapsing toolbar; without it every scroll nudge would pad the chat by a
// few pixels. Dropping it leaves the 50px "tiny offset" case reporting 50.
// @mutate src/hooks/useKeyboardInset.ts | setInset(diff > 80 ? diff : 0) | setInset(diff)
// The offsetTop subtraction: a viewport scrolled 50px down is not 50px of
// keyboard, and double-counting it lifts the input bar off the keyboard.
// @mutate src/hooks/useKeyboardInset.ts | window.innerHeight - vv.height - vv.offsetTop | window.innerHeight - vv.height
// The subscribe-time read — the only reading a keyboard-already-open mount gets.
// @mutate src/hooks/useKeyboardInset.ts | vv.addEventListener("scroll", update);\n    update(); | vv.addEventListener("scroll", update);
