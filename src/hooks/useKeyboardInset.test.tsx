import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

  it("web: removes both visualViewport listeners on unmount", async () => {
    const vv = installFakeVisualViewport(800, 0);
    const { unmount } = renderHook(() => useKeyboardInset());
    await flushAsync();
    unmount();
    expect(vv.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(vv.removeEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});
