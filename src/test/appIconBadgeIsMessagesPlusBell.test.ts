/**
 * N-006 (owner decision 2026-09-27): the iOS app-icon badge is unread MESSAGES
 * plus unread NOTIFICATIONS, so the springboard number agrees with what the app
 * shows (Messages tab + bell). Before the fix useNavUnreadCount passed the
 * messages count alone, so the icon and the bell disagreed by up to 108.
 *
 * The count sources are the app's own: the Messages-tab store inside
 * useNavUnreadCount and the bell's shared notificationStore (bellUnreadCount,
 * the same function NotificationPanel renders). This test drives the real hook
 * with the network edges stubbed and asserts the value handed to
 * setAppIconBadge is the sum.
 *
 * @mutate src/components/mobileNav/useNavUnreadCount.ts | void setAppIconBadge(user ? unreadCount + (notificationsUnread ?? 0) : 0); // N-006 | void setAppIconBadge(user ? unreadCount : 0); // N-006
 * @mutate src/components/mobileNav/useNavUnreadCount.ts | if (user && notificationsUnread === null) return; // bell not counted yet: no partial badge | // removed
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { User } from "@supabase/supabase-js";

const badgeCalls: number[] = [];
vi.mock("@/lib/appBadge", () => ({
  setAppIconBadge: (n: number) => {
    badgeCalls.push(n);
    return Promise.resolve();
  },
}));
vi.mock("@/lib/userBlocks", () => ({ getBlockedUserIds: () => Promise.resolve(new Set<string>()) }));
vi.mock("@/lib/userRealtimeBus", () => ({ subscribeUserRealtime: () => () => {} }));
vi.mock("@/lib/archivedConversations", () => ({ isArchived: () => false, ARCHIVE_CHANGED_EVENT: "lh-archive-test" }));
vi.mock("@/components/mobileNav/mobileNavHelpers", () => ({ readCachedUnread: () => 0, writeCachedUnread: () => {} }));

const MESSAGE_ROWS = [
  { job_id: "j1", sender_id: "s1", created_at: "2026-09-20T00:00:00Z" },
  { job_id: "j2", sender_id: "s2", created_at: "2026-09-21T00:00:00Z" },
  { job_id: "j3", sender_id: "s3", created_at: "2026-09-22T00:00:00Z" },
];
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "not", "update"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: MESSAGE_ROWS, error: null });
  return { supabase: { from: () => chain } };
});

import { useNavUnreadCount } from "@/components/mobileNav/useNavUnreadCount";
import {
  __resetNotificationStore,
  setNotificationUser,
  setUnreadTotal,
  setNotifications,
  markNotificationsLoaded,
  bellUnreadCount,
  getNotificationSnapshot,
} from "@/components/notificationPanel/notificationStore";

const USER = { id: "user-n006" } as User;
const last = () => badgeCalls[badgeCalls.length - 1];

beforeEach(() => {
  badgeCalls.length = 0;
  __resetNotificationStore();
});
afterEach(() => __resetNotificationStore());

describe("app-icon badge = unread messages + bell unread (N-006)", () => {
  it("hands setAppIconBadge the sum of the Messages tab and the bell", async () => {
    setNotificationUser(USER.id);
    setUnreadTotal(5);
    const { result } = renderHook(() => useNavUnreadCount(USER));
    await waitFor(() => expect(result.current.unreadCount).toBe(MESSAGE_ROWS.length));
    const bell = bellUnreadCount(getNotificationSnapshot());
    expect(bell).toBe(5);
    await waitFor(() => expect(last()).toBe(MESSAGE_ROWS.length + bell));
  });

  it("follows the bell when a notification is read", async () => {
    setNotificationUser(USER.id);
    setUnreadTotal(5);
    renderHook(() => useNavUnreadCount(USER));
    await waitFor(() => expect(last()).toBe(8));
    act(() => setUnreadTotal(4));
    await waitFor(() => expect(last()).toBe(7));
  });

  it("uses the bell's own fallback (page-derived) before the total is counted", async () => {
    setNotificationUser(USER.id);
    setNotifications([
      { id: "n1", read: false },
      { id: "n2", read: true },
    ] as never);
    markNotificationsLoaded(); // the bell's list load succeeded; the head count has not answered
    renderHook(() => useNavUnreadCount(USER));
    await waitFor(() => expect(last()).toBe(MESSAGE_ROWS.length + 1));
  });

  it("never sends a partial (messages-only) badge before the bell has counted for this user", async () => {
    // Another account's bell, then an unanswered one for ours: neither may
    // overwrite the icon (a push may just have set the correct sum).
    setNotificationUser("someone-else");
    setUnreadTotal(40);
    const { result } = renderHook(() => useNavUnreadCount(USER));
    await waitFor(() => expect(result.current.unreadCount).toBe(MESSAGE_ROWS.length));
    act(() => setNotificationUser(USER.id));
    await new Promise((r) => setTimeout(r, 50));
    expect(badgeCalls).toEqual([]);
    act(() => setUnreadTotal(2));
    await waitFor(() => expect(last()).toBe(MESSAGE_ROWS.length + 2));
  });

  it("a signed-out user badges zero", async () => {
    setNotificationUser(USER.id);
    setUnreadTotal(5);
    renderHook(() => useNavUnreadCount(null));
    await waitFor(() => expect(last()).toBe(0));
    expect(badgeCalls.length).toBeGreaterThan(0);
  });
});
