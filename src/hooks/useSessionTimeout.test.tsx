// useSessionTimeout signs the user out after 30 minutes of inactivity.
// Bugs here either log users out too aggressively (UX regression) or
// fail to log them out at all (security regression — abandoned device
// stays signed in indefinitely).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSessionTimeout } from "./useSessionTimeout";

const getSessionMock = vi.fn();
const signOutMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => getSessionMock(),
      signOut: () => signOutMock(),
    },
  },
}));

const toastInfoMock = vi.fn();
vi.mock("sonner", () => ({
  toast: { info: (...args: unknown[]) => toastInfoMock(...args) },
}));

const TIMEOUT_MS = 30 * 60 * 1000;

beforeEach(() => {
  getSessionMock.mockReset();
  signOutMock.mockReset();
  toastInfoMock.mockReset();
  vi.useFakeTimers();
  // jsdom doesn't define location.href reassignment; mock it
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { href: "/dashboard" },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSessionTimeout", () => {
  it("does NOT sign out before 30 minutes of inactivity", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    renderHook(() => useSessionTimeout());

    // 29 minutes — not yet
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
    });
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("signs out after 30 minutes of inactivity (when a session exists)", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    renderHook(() => useSessionTimeout());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    });

    expect(signOutMock).toHaveBeenCalledOnce();
    expect(window.location.href).toBe("/login");
  });

  it("does NOT sign out when no active session (already signed out)", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    renderHook(() => useSessionTimeout());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    });

    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("user activity resets the timer (a keypress at 29min postpones logout)", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    renderHook(() => useSessionTimeout());

    // 29 min — about to expire
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
    });
    // User presses a key
    act(() => {
      window.dispatchEvent(new Event("keydown"));
    });
    // Another 29 min — should still NOT sign out (timer reset)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
    });
    expect(signOutMock).not.toHaveBeenCalled();

    // But after another 1 min (= 30 since the keypress), should fire
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
    });
    expect(signOutMock).toHaveBeenCalledOnce();
  });

  // Regression guard for the mid-session-logout bug: on AppShell pages the
  // scroll happens inside an internal overflow container, and `scroll` does
  // not bubble. A bubble-phase window listener never saw it, so actively
  // scrolling users were logged out. The hook now listens in the CAPTURE
  // phase, which reaches the window for non-bubbling inner-container scrolls.
  it("resets the timer on a non-bubbling scroll from an inner container", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    renderHook(() => useSessionTimeout());

    const inner = document.createElement("div");
    document.body.appendChild(inner);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
    });
    // A scroll dispatched on the inner element does NOT bubble to window; only
    // a capture-phase listener catches it.
    act(() => {
      inner.dispatchEvent(new Event("scroll"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
    });
    expect(signOutMock).not.toHaveBeenCalled();

    document.body.removeChild(inner);
  });

  it("listens to the activity event types (pointerdown, pointermove, keydown, wheel, scroll, touchstart)", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    renderHook(() => useSessionTimeout());

    const registeredEvents = addSpy.mock.calls.map((c) => c[0]);
    expect(registeredEvents).toContain("pointerdown");
    expect(registeredEvents).toContain("pointermove");
    expect(registeredEvents).toContain("keydown");
    expect(registeredEvents).toContain("wheel");
    expect(registeredEvents).toContain("scroll");
    expect(registeredEvents).toContain("touchstart");

    // scroll must be registered in the capture phase, or inner-container
    // scrolls never reach the window (the mid-session-logout bug).
    const scrollCall = addSpy.mock.calls.find((c) => c[0] === "scroll");
    expect(scrollCall?.[2]).toMatchObject({ capture: true });

    addSpy.mockRestore();
  });

  it("removes event listeners on unmount (no leak)", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useSessionTimeout());

    unmount();

    const removedEvents = removeSpy.mock.calls.map((c) => c[0]);
    expect(removedEvents).toContain("pointerdown");
    expect(removedEvents).toContain("keydown");
    expect(removedEvents).toContain("scroll");
    expect(removedEvents).toContain("touchstart");

    removeSpy.mockRestore();
  });
});
