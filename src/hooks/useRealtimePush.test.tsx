// useRealtimePush listens for new notifications via Supabase Realtime
// and surfaces browser push notifications when the user has granted
// permission AND isn't currently focused on the app tab. Bugs here
// either spam users with pushes while they're actively reading the
// notifications panel, or fail to push at all when they're in another
// tab.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRealtimePush } from "./useRealtimePush";

const channelMock = vi.fn();
const onMock = vi.fn();
const subscribeMock = vi.fn();
const removeChannelMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (...args: unknown[]) => channelMock(...args),
    removeChannel: (...args: unknown[]) => removeChannelMock(...args),
  },
}));

const showLocalMock = vi.fn();
const registerSWMock = vi.fn();
vi.mock("@/lib/pushNotifications", () => ({
  showLocalNotification: (...args: unknown[]) => showLocalMock(...args),
  registerServiceWorker: () => registerSWMock(),
  // The hook reads permission through this helper rather than touching
  // `Notification.permission` directly (that global does not exist in the
  // iOS WebView). Mirror the real web behaviour so the cases below, which
  // drive `window.Notification.permission`, keep testing what they say.
  getPushPermission: () =>
    (window as unknown as { Notification?: { permission?: string } }).Notification
      ?.permission ?? "unsupported",
}));

let capturedHandler: ((payload: { new: unknown }) => void) | null = null;

beforeEach(() => {
  channelMock.mockReset();
  onMock.mockReset();
  subscribeMock.mockReset();
  removeChannelMock.mockReset();
  showLocalMock.mockReset();
  registerSWMock.mockReset();
  capturedHandler = null;

  // Build chainable channel mock that captures the postgres_changes handler
  channelMock.mockImplementation(() => ({
    on: (
      event: string,
      _opts: unknown,
      handler: (payload: { new: unknown }) => void,
    ) => {
      if (event === "postgres_changes") capturedHandler = handler;
      return { subscribe: () => ({}) };
    },
  }));
});

afterEach(() => {
  // Reset Notification.permission and document.hidden between tests
  Object.defineProperty(window, "Notification", {
    configurable: true,
    writable: true,
    value: { permission: "default" },
  });
  Object.defineProperty(document, "hidden", {
    configurable: true,
    writable: true,
    value: false,
  });
});

describe("useRealtimePush", () => {
  it("does NOT subscribe when userId is null", () => {
    renderHook(() => useRealtimePush(null));
    expect(channelMock).not.toHaveBeenCalled();
    expect(registerSWMock).not.toHaveBeenCalled();
  });

  it("subscribes to a per-user channel when userId is provided", () => {
    renderHook(() => useRealtimePush("user-1"));
    expect(channelMock).toHaveBeenCalledWith(expect.stringMatching(/^push-notifications-user-1-/));
  });

  it("registers the service worker on first mount", () => {
    renderHook(() => useRealtimePush("user-1"));
    expect(registerSWMock).toHaveBeenCalledOnce();
  });

  it("shows local notification when tab is hidden + permission granted", () => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      writable: true,
      value: { permission: "granted" },
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      writable: true,
      value: true,
    });

    renderHook(() => useRealtimePush("user-1"));
    expect(capturedHandler).toBeTruthy();

    capturedHandler!({
      new: { title: "Marie B.", message: "Are you free Sunday?", link: "/messages?job=j1" },
    });
    expect(showLocalMock).toHaveBeenCalledWith(
      "Marie B.",
      "Are you free Sunday?",
      "/messages?job=j1",
    );
  });

  it("does NOT show local notification when tab is focused (user already sees it)", () => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      writable: true,
      value: { permission: "granted" },
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      writable: true,
      value: false, // tab focused
    });

    renderHook(() => useRealtimePush("user-1"));
    capturedHandler!({ new: { title: "T", message: "M" } });
    expect(showLocalMock).not.toHaveBeenCalled();
  });

  it("does NOT show local notification when permission is not granted", () => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      writable: true,
      value: { permission: "denied" },
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      writable: true,
      value: true,
    });

    renderHook(() => useRealtimePush("user-1"));
    capturedHandler!({ new: { title: "T", message: "M" } });
    expect(showLocalMock).not.toHaveBeenCalled();
  });

  it("removes the channel on unmount (cleans up subscription)", () => {
    const { unmount } = renderHook(() => useRealtimePush("user-1"));
    unmount();
    expect(removeChannelMock).toHaveBeenCalledOnce();
  });

  it("re-subscribes when userId changes (new account swap)", () => {
    const { rerender } = renderHook(({ uid }) => useRealtimePush(uid), {
      initialProps: { uid: "user-1" as string | null },
    });
    expect(channelMock).toHaveBeenCalledTimes(1);

    rerender({ uid: "user-2" });
    expect(channelMock).toHaveBeenCalledTimes(2);
    expect(channelMock).toHaveBeenLastCalledWith(expect.stringMatching(/^push-notifications-user-2-/));
    // Old channel removed
    expect(removeChannelMock).toHaveBeenCalled();
  });
});
