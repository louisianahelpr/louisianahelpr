/**
 * Q756: THE BELL'S FEED IS BOUND ON EVERY ROUTE, EXACTLY ONCE.
 *
 * The bell's count query and its realtime `notifications:insert` binding used
 * to live inside <NotificationPanel />. On a phone only DashboardTitleBar
 * mounts a bell, so a cold launch into /messages (a push tap) never loaded the
 * store, and leaving the dashboard unbound it: the app-icon badge
 * (useNavUnreadCount, N-006 = messages + bell) could not follow a new
 * notification anywhere else. The feed now opens from useNavUnreadCount,
 * which MobileNav runs on every route before any early return.
 *
 * This drives the real hook with NO panel mounted and asserts the store loads,
 * the binding exists, and a live INSERT moves the icon badge. Then it mounts
 * two navs AND the panel and asserts ONE binding (no duplicate handler that
 * would double-count every arrival).
 *
 * @mutate src/components/mobileNav/useNavUnreadCount.ts | useNotificationFeed(user?.id); | // feed not bound
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { User } from "@supabase/supabase-js";
import { blankNonCode } from "./helpers/blankNonCode";

type Sub = { userId: string; key: string; handler: (p: { new: unknown }) => void; live: boolean };
const bus = vi.hoisted(() => ({ subs: [] as Sub[] }));
vi.mock("@/lib/userRealtimeBus", () => ({
  subscribeUserRealtime: (userId: string, key: string, handler: Sub["handler"]) => {
    const s: Sub = { userId, key, handler, live: true };
    bus.subs.push(s);
    return () => { s.live = false; };
  },
}));

const badgeCalls = vi.hoisted(() => [] as number[]);
vi.mock("@/lib/appBadge", () => ({
  setAppIconBadge: (n: number) => { badgeCalls.push(n); return Promise.resolve(); },
}));
vi.mock("@/lib/userBlocks", () => ({ getBlockedUserIds: () => Promise.resolve(new Set<string>()) }));
vi.mock("@/lib/archivedConversations", () => ({ isArchived: () => false, ARCHIVE_CHANGED_EVENT: "lh-archive-test" }));
vi.mock("@/components/mobileNav/mobileNavHelpers", () => ({ readCachedUnread: () => 0, writeCachedUnread: () => {} }));
vi.mock("@/lib/pushNotifications", () => ({
  isPushSupported: () => false,
  registerServiceWorker: () => {},
  showLocalNotification: () => {},
  getPushPermission: () => "default",
}));
vi.mock("@/lib/nativePush", () => ({ useRequestPushPermission: () => async () => false }));
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {} }));
vi.mock("@/lib/errorLogger", () => ({ report: () => {} }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() }),
}));

// Every read answers "nothing": no unread messages, no notifications, count 0.
const chain = (): unknown =>
  new Proxy(function () {}, {
    get: (_t, prop) => {
      if (prop === "then") {
        return (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);
      }
      return () => chain();
    },
    apply: () => chain(),
  });
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-q756" } } }, error: null }) },
    from: () => chain(),
    channel: () => chain(),
    removeChannel: () => {},
  },
}));

import { useNavUnreadCount } from "@/components/mobileNav/useNavUnreadCount";
import NotificationPanel from "@/components/NotificationPanel";
import {
  __resetNotificationStore,
  bellUnreadCount,
  getNotificationSnapshot,
} from "@/components/notificationPanel/notificationStore";

const USER = { id: "user-q756" } as User;
const bellBindings = () => bus.subs.filter((s) => s.live && s.key === "notifications:insert" && s.userId === USER.id);
const last = () => badgeCalls[badgeCalls.length - 1];
const insert = (id: string) => act(() => { for (const s of bellBindings()) s.handler({ new: { id, read: false, title: "t", message: "m", created_at: new Date().toISOString() } }); });

beforeEach(() => {
  bus.subs.length = 0;
  badgeCalls.length = 0;
  __resetNotificationStore();
});
afterEach(() => {
  cleanup();
  __resetNotificationStore();
});

describe("the bell's feed is bound for every signed-in user, no bell required (Q756)", () => {
  it("with NO NotificationPanel mounted, the store loads and a live notification moves the icon badge", async () => {
    renderHook(() => useNavUnreadCount(USER));
    expect(bellBindings()).toHaveLength(1);
    // The deferred (800ms) load answers: 0 messages + 0 notifications.
    await waitFor(() => expect(last()).toBe(0), { timeout: 3000 });
    insert("n-live-1");
    expect(bellUnreadCount(getNotificationSnapshot())).toBe(1);
    await waitFor(() => expect(last()).toBe(1));
  });

  it("two navs plus a mounted panel share ONE binding, and an arrival counts once", async () => {
    renderHook(() => useNavUnreadCount(USER)); // MobileNav
    renderHook(() => useNavUnreadCount(USER)); // DesktopSidebarNav
    render(<MemoryRouter><NotificationPanel /></MemoryRouter>);
    await waitFor(() => expect(last()).toBe(0), { timeout: 3000 });
    expect(bellBindings()).toHaveLength(1);
    insert("n-live-2");
    insert("n-live-2"); // realtime racing the fetch: same row twice
    expect(bellUnreadCount(getNotificationSnapshot())).toBe(1);
    cleanup();
    expect(bellBindings()).toHaveLength(0); // last consumer out closes it
  });

  it("the hook that binds it runs on every route: App mounts the navs outside the router outlet, before any early return", () => {
    const read = (p: string) => blankNonCode(readFileSync(join(process.cwd(), p), "utf8"));
    const hook = read("src/components/mobileNav/useNavUnreadCount.ts");
    expect(hook).toContain("useNotificationFeed(user?.id)");
    const panel = read("src/components/NotificationPanel.tsx");
    expect(panel).not.toContain("subscribeUserRealtime(");
    const callers = ["src/components/MobileNav.tsx", "src/components/DesktopSidebarNav.tsx"].filter((p) => read(p).includes("useNavUnreadCount(user)"));
    expect(callers.length).toBeGreaterThan(1);
    const nav = read("src/components/MobileNav.tsx");
    const firstReturn = nav.search(/\n {2}if \([^\n]*\) return|\n {2}return /);
    expect(firstReturn).toBeGreaterThan(-1);
    expect(nav.indexOf("useNavUnreadCount(user)")).toBeLessThan(firstReturn);
    const app = read("src/App.tsx");
    expect(app.indexOf("<MobileNav />")).toBeGreaterThan(app.indexOf("<RoutedBoundary />"));
  });
});
