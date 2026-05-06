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
    expect(toastInfoMock).toHaveBeenCalledWith(expect.stringMatching(/inactivity/i));
    expect(window.location.href).toBe("/login");
  });

  it("does NOT sign out when no active session (already signed out)", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    renderHook(() => useSessionTimeout());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    });

    expect(signOutMock).not.toHaveBeenCalled();
    expect(toastInfoMock).not.toHaveBeenCalled();
  });

  it("user activity resets the timer (a click at 29min postpones logout)", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    renderHook(() => useSessionTimeout());

    // 29 min — about to expire
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
    });
    // User clicks
    act(() => {
      window.dispatchEvent(new Event("mousedown"));
    });
    // Another 29 min — should still NOT sign out (timer reset)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
    });
    expect(signOutMock).not.toHaveBeenCalled();

    // But after another 1 min (= 30 since the click), should fire
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
    });
    expect(signOutMock).toHaveBeenCalledOnce();
  });

  it("listens to all 4 activity event types (mousedown, keydown, scroll, touchstart)", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    renderHook(() => useSessionTimeout());

    const registeredEvents = addSpy.mock.calls.map((c) => c[0]);
    expect(registeredEvents).toContain("mousedown");
    expect(registeredEvents).toContain("keydown");
    expect(registeredEvents).toContain("scroll");
    expect(registeredEvents).toContain("touchstart");

    addSpy.mockRestore();
  });

  it("removes event listeners on unmount (no leak)", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useSessionTimeout());

    unmount();

    const removedEvents = removeSpy.mock.calls.map((c) => c[0]);
    expect(removedEvents).toContain("mousedown");
    expect(removedEvents).toContain("keydown");
    expect(removedEvents).toContain("scroll");
    expect(removedEvents).toContain("touchstart");

    removeSpy.mockRestore();
  });
});
