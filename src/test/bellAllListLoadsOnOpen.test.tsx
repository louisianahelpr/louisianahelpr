/**
 * GUARD (Q104, lead decision 2026-11-02, option b): the bell's "All" list loads
 * only when the panel is about to open.
 *
 * Release gate (E2E real backend, chromium-authenticated): 12.8 requests per
 * test against a 12.1 budget, which is never raised (owner). Every signed-in
 * page load read the bell's recency page (`notifications?...&limit=50`, 29 of
 * 61 tests) although no gate test opens the bell. Now:
 *  - a page load with the panel shut reads only the unread page (rows + exact
 *    count), so the badge is unchanged;
 *  - a hover, focus or touch on the bell (either bell: the placeholder or the
 *    loaded panel's) starts the list, so a tap opens onto it (owner rule:
 *    nothing slow for users);
 *  - the open itself loads it if nothing did;
 *  - until the list has loaded, All shows the loading row, never the badge's
 *    unread rows as if they were everything, and never the empty state.
 */
// @mutate src/components/notificationPanel/notificationFeed.ts | () => void load((id) => (listHeldFor(id) ? ensureFreshNotificationFeed(id) : loadBadgeFeed(id))), | () => void load(loadNotificationFeed),
// @mutate src/components/NotificationPanel.tsx |     if (open) void loadNotifications(false); |     void loadNotifications(false);
// @mutate src/components/NotificationPanel.tsx |     if (open) void loadNotifications(false); |     if (false) void loadNotifications(false);
// @mutate src/components/NotificationPanel.tsx |           onPointerEnter={prefetchNotificationList} |           onPointerEnter={undefined}
// @mutate src/components/NotificationPanel.tsx |           onFocus={prefetchNotificationList} |           onFocus={undefined}
// @mutate src/components/notificationPanel/NotificationBell.tsx |       onPointerEnter={prefetchNotificationList} |       onPointerEnter={undefined}
// @mutate src/components/notificationPanel/NotificationBell.tsx |       onTouchStart={prefetchNotificationList} |       onTouchStart={undefined}
// @mutate src/components/notificationPanel/notificationFeed.ts |   setNotifications((prev) => mergeRows(prev, unread.data as Notification[] \| null));\n  applyUnreadCount(unread.count); |   setNotifications((prev) => mergeRows(prev, unread.data as Notification[] \| null));
// @mutate src/components/NotificationPanel.tsx |   const listShowable = listLoaded \|\| (filter === "unread" && notifications.length > 0); |   const listShowable = listLoaded \|\| notifications.length > 0;
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const net = vi.hoisted(() => ({
  recent: 0,
  unread: 0,
  // When set, recency-page reads wait on this promise (an in-flight list).
  holdRecent: null as null | Promise<void>,
}));

const UNREAD_ROW = {
  id: "u-1", user_id: "u1", type: "info", title: "Unread one", message: "m", read: false, link: null,
  created_at: new Date(Date.now() - 1_000).toISOString(),
};
const READ_ROW = {
  id: "r-1", user_id: "u1", type: "info", title: "Read one", message: "m", read: true, link: null,
  created_at: new Date(Date.now() - 60_000).toISOString(),
};

vi.mock("@/integrations/supabase/client", () => {
  const notifications = () => {
    let unread = false;
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.order = () => q;
    q.eq = (col: string, v: unknown) => { if (col === "read" && v === false) unread = true; return q; };
    q.limit = async () => {
      if (unread) {
        net.unread += 1;
        return { data: [UNREAD_ROW], error: null, count: 7 };
      }
      net.recent += 1;
      if (net.holdRecent) await net.holdRecent;
      return { data: [UNREAD_ROW, READ_ROW], error: null, count: null };
    };
    return q;
  };
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } }, error: null }) },
      from: (table: string) => {
        if (table !== "notifications") throw new Error(`unexpected table ${table}`);
        return notifications();
      },
    },
  };
});
vi.mock("@/lib/userRealtimeBus", () => ({ subscribeUserRealtime: () => () => {} }));
vi.mock("@/lib/pushNotifications", () => ({
  isPushSupported: () => false,
  registerServiceWorker: () => {},
  showLocalNotification: () => {},
  getPushPermission: () => "default",
}));
vi.mock("@/lib/nativePush", () => ({ useRequestPushPermissionOutcome: () => async () => "dismissed" }));
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {} }));
vi.mock("@/lib/errorLogger", () => ({ report: () => {} }));
vi.mock("@/hooks/usePullToRefresh", () => ({
  usePullToRefresh: () => ({ containerRef: { current: null }, pullDistance: 0, refreshing: false, isPulling: false, canTrigger: false }),
}));
// The placeholder bell stays a placeholder: the page never "settles" here.
vi.mock("@/lib/routePrefetch", () => ({ whenPageSettled: () => () => {} }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() }),
}));

import NotificationPanelModule from "@/components/NotificationPanel";
import NotificationBell from "@/components/notificationPanel/NotificationBell";
import { useNotificationFeed, __resetNotificationFeedLoad } from "@/components/notificationPanel/notificationFeed";
import { __resetNotificationStore } from "@/components/notificationPanel/notificationStore";

const Panel = (NotificationPanelModule as unknown as { default?: React.ComponentType }).default ?? NotificationPanelModule;
const U = "u1";

/** A signed-in page: the shared feed (useNavUnreadCount's) plus a bell, 2 s past mount. */
async function pageLoad(bell: "panel" | "placeholder") {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const feed = renderHook(() => useNotificationFeed(U));
  const view = render(<MemoryRouter>{bell === "panel" ? <Panel /> : <NotificationBell />}</MemoryRouter>);
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  vi.useRealTimers();
  return { feed, view, trigger: () => screen.getAllByRole("button", { name: /notifications/i })[0] };
}

beforeEach(() => {
  net.recent = 0;
  net.unread = 0;
  net.holdRecent = null;
  __resetNotificationFeedLoad();
  __resetNotificationStore();
});
afterEach(() => vi.useRealTimers());

describe("the bell's All list loads only when the panel is about to open (Q104)", () => {
  it("a page load with the panel shut reads the unread page only, and the badge shows the true count", async () => {
    const { feed, trigger } = await pageLoad("panel");
    expect(net.unread).toBe(1);
    expect(net.recent).toBe(0);
    // Badge: the exact unread total from the unread read's count, not the rows in the page.
    expect(trigger().textContent).toContain("7");
    feed.unmount();
  });

  it("hovering the loaded bell starts the list before any tap", async () => {
    const { feed, trigger } = await pageLoad("panel");
    expect(net.recent).toBe(0);
    fireEvent.pointerEnter(trigger());
    await waitFor(() => expect(net.recent).toBe(1));
    feed.unmount();
  });

  it("focusing the loaded bell starts the list", async () => {
    const { feed, trigger } = await pageLoad("panel");
    fireEvent.focus(trigger());
    await waitFor(() => expect(net.recent).toBe(1));
    feed.unmount();
  });

  it("the placeholder bell prefetches on hover and on touch", async () => {
    const { feed, trigger } = await pageLoad("placeholder");
    expect(net.recent).toBe(0);
    fireEvent.pointerEnter(trigger());
    await waitFor(() => expect(net.recent).toBe(1));
    feed.unmount();
    __resetNotificationFeedLoad();
    __resetNotificationStore();
    net.recent = 0;
    const again = await pageLoad("placeholder");
    fireEvent.touchStart(again.trigger());
    await waitFor(() => expect(net.recent).toBe(1));
    again.feed.unmount();
  });

  it("opening the panel loads the list", async () => {
    const { feed, trigger } = await pageLoad("panel");
    fireEvent.click(trigger());
    await waitFor(() => expect(net.recent).toBe(1));
    fireEvent.click(screen.getAllByText("All")[0]);
    expect((await screen.findAllByText("Read one")).length).toBeGreaterThan(0);
    feed.unmount();
  });

  it("a hover then a tap reads the list once", async () => {
    const { feed, trigger } = await pageLoad("panel");
    fireEvent.pointerEnter(trigger());
    await waitFor(() => expect(net.recent).toBe(1));
    fireEvent.click(trigger());
    fireEvent.click(screen.getAllByText("All")[0]);
    expect((await screen.findAllByText("Read one")).length).toBeGreaterThan(0);
    expect(net.recent).toBe(1);
    feed.unmount();
  });

  it("before the list answers, All shows the loading row: not the unread rows as the whole list, not the empty state", async () => {
    let release: () => void = () => {};
    net.holdRecent = new Promise<void>((r) => { release = r; });
    const { feed, trigger } = await pageLoad("panel");
    fireEvent.click(trigger());
    await waitFor(() => expect(net.recent).toBe(1));
    // Unread (the default with unread rows) may show the badge's unread page.
    expect((await screen.findAllByText("Unread one")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByText("All")[0]);
    await waitFor(() => expect(screen.getAllByText("Loading notifications…").length).toBeGreaterThan(0));
    expect(screen.queryAllByText("Unread one")).toHaveLength(0);
    await act(async () => { release(); });
    expect((await screen.findAllByText("Read one")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unread one").length).toBeGreaterThan(0);
    feed.unmount();
  });
});
