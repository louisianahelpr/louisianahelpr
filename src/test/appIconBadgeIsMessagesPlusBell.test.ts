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
 * @mutate src/components/mobileNav/useNavUnreadCount.ts | void setAppIconBadge(user ? unreadCount + notificationsUnread : 0); // N-006 | void setAppIconBadge(user ? unreadCount : 0); // N-006
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
  bellUnreadCount,
  getNotificationSnapshot,
} from "@/components/notificationPanel/notificationStore";

const USER = { id: "user-n006" } as User;

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
    await waitFor(() => expect(badgeCalls.at(-1)).toBe(MESSAGE_ROWS.length + bell));
  });

  it("follows the bell when a notification is read", async () => {
    setNotificationUser(USER.id);
    setUnreadTotal(5);
    renderHook(() => useNavUnreadCount(USER));
    await waitFor(() => expect(badgeCalls.at(-1)).toBe(8));
    act(() => setUnreadTotal(4));
    await waitFor(() => expect(badgeCalls.at(-1)).toBe(7));
  });

  it("uses the bell's own fallback (page-derived) before the total is counted", async () => {
    setNotificationUser(USER.id);
    setNotifications([
      { id: "n1", read: false },
      { id: "n2", read: true },
    ] as never);
    renderHook(() => useNavUnreadCount(USER));
    await waitFor(() => expect(badgeCalls.at(-1)).toBe(MESSAGE_ROWS.length + 1));
  });

  it("never counts another account's bell", async () => {
    setNotificationUser("someone-else");
    setUnreadTotal(40);
    renderHook(() => useNavUnreadCount(USER));
    await waitFor(() => expect(badgeCalls.at(-1)).toBe(MESSAGE_ROWS.length));
  });

  it("a signed-out user badges zero", async () => {
    setNotificationUser(USER.id);
    setUnreadTotal(5);
    renderHook(() => useNavUnreadCount(null));
    await waitFor(() => expect(badgeCalls.at(-1)).toBe(0));
    expect(badgeCalls.length).toBeGreaterThan(0);
  });
});
