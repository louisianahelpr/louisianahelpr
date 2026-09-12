import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * THE ONE CASE A REFRESH FAILURE MAY TOAST — executed, not read.
 *
 * NotificationPanel reserves `toast.error("Couldn't load notifications — try
 * again?")` for a single situation: the panel is OPEN and already showing rows,
 * so its inline error card is deliberately suppressed (a background hiccup must
 * not blow away a list mid-read) and nothing else would say the refresh failed.
 * A closed panel must stay silent, because the page's own error state speaks.
 *
 * That branch was fixed in f2b63d921 and logged as "code-verified but NOT
 * runtime-verified": its only triggers are pull-to-refresh and a realtime
 * reconnect, and a headless browser could fire neither. So this renders the
 * real component and drives the real `loadNotifications` through the
 * pull-to-refresh callback it hands the hook.
 */

const state = vi.hoisted(() => ({
  fail: false,
  rows: [
    { id: "n1", user_id: "u1", type: "info", title: "Hello", message: "row", read: false, link: null, created_at: new Date().toISOString() },
  ] as Array<Record<string, unknown>>,
  onRefresh: null as null | (() => Promise<void>),
}));

// Any chain of query-builder calls ends in a thenable resolving to the current
// scenario: rows, or an error.
const chain = (): unknown =>
  new Proxy(function () {}, {
    get: (_t, prop) => {
      if (prop === "then") {
        const result = state.fail
          ? { data: null, error: { message: "boom" }, count: null }
          : { data: state.rows, error: null, count: state.rows.length };
        return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      }
      return () => chain();
    },
    apply: () => chain(),
  });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from: () => chain(),
    channel: () => chain(),
    removeChannel: () => {},
  },
}));
vi.mock("@/lib/realtimeRecovery", () => ({
  subscribeWithRecovery: () => ({ close: () => {}, unsubscribe: () => {}, dispose: () => {} }),
}));
vi.mock("@/lib/pushNotifications", () => ({
  isPushSupported: () => false,
  registerServiceWorker: () => {},
  showLocalNotification: () => {},
  getPushPermission: () => "default",
}));
vi.mock("@/lib/nativePush", () => ({ useRequestPushPermission: () => async () => false }));
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {} }));
vi.mock("@/lib/errorLogger", () => ({ report: () => {} }));
vi.mock("@/hooks/usePullToRefresh", () => ({
  usePullToRefresh: ({ onRefresh }: { onRefresh: () => Promise<void> }) => {
    state.onRefresh = onRefresh;
    return { containerRef: { current: null }, pullDistance: 0, refreshing: false, isPulling: false, canTrigger: false };
  },
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() }),
}));

import NotificationPanelModule from "./NotificationPanel";

const Panel = (NotificationPanelModule as unknown as { default?: React.ComponentType }).default ?? NotificationPanelModule;

const renderPanel = async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(
    <MemoryRouter>
      <Panel />
    </MemoryRouter>,
  );
  // The initial load is deferred 800ms after mount.
  await act(async () => {
    vi.advanceTimersByTime(900);
  });
  vi.useRealTimers();
};

describe("NotificationPanel refresh failure", () => {
  beforeEach(() => {
    state.fail = false;
    toastError.mockReset();
  });

  it("toasts when a refresh fails while the panel is OPEN and showing rows", async () => {
    await renderPanel();
    fireEvent.click(screen.getAllByRole("button", { name: /notifications/i })[0]);
    await waitFor(() => expect(screen.getAllByText("Hello").length).toBeGreaterThan(0));

    state.fail = true;
    await act(async () => {
      await state.onRefresh?.();
    });
    expect(toastError).toHaveBeenCalledWith("Couldn't load notifications — try again?");
  });

  it("stays silent when a refresh fails while the panel is CLOSED", async () => {
    await renderPanel();
    // Rows loaded, panel never opened.
    state.fail = true;
    await act(async () => {
      await state.onRefresh?.();
    });
    expect(toastError).not.toHaveBeenCalled();
  });
});
