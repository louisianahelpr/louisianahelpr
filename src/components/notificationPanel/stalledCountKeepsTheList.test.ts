/*
 * Sentry JAVASCRIPT-4M (2 users, iPhone, /jobs): "notifications load timed out after 15000ms". The event's
 * breadcrumbs show both list selects answered (200) and the unread HEAD count never came back; its 15 s timer
 * then failed the WHOLE load. Since Q104 (2026-11-01) there is no separate count: the total rides on the unread
 * read (count: "exact"), so no third request can stall the load. A HEAD count that never settles must never be
 * awaited by the load again.
 */
// @mutate src/components/notificationPanel/notificationFeed.ts |   if (typeof unread.count === "number") setUnreadTotal(unread.count); |   await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("read", false);
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const reported: unknown[] = [];
vi.mock("@/lib/errorLogger", () => ({ report: (e: unknown) => { reported.push(e); } }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = () => {
    const q: Record<string, unknown> = { head: false };
    q.select = (_c: string, o?: { head?: boolean }) => { q.head = !!o?.head; return q; };
    for (const k of ["eq", "order"]) q[k] = () => q;
    q.limit = async () => ({ data: [{ id: "n1", user_id: U, created_at: "2026-11-01T17:00:00Z", read: false }], error: null });
    // The HEAD count is awaited directly: it never settles (the stalled request).
    q.then = (res: (v: unknown) => void) => { if (!q.head) res({ data: [], error: null }); };
    return q;
  };
  return { supabase: { from: () => chain() } };
});

const U = "11111111-1111-1111-1111-111111111111";
import { loadNotificationFeed, __resetNotificationFeedLoad } from "./notificationFeed";
import { getNotificationSnapshot, setNotificationUser } from "./notificationStore";

beforeEach(() => { reported.length = 0; __resetNotificationFeedLoad(); setNotificationUser(U); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe("a stalled unread count never fails the bell's load (JAVASCRIPT-4M)", () => {
  it("the list loads without waiting on any HEAD count, and nothing times out", async () => {
    const done = loadNotificationFeed(U).then(() => "ok", (e: unknown) => `failed: ${String(e)}`);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(await done).toBe("ok");
    const snap = getNotificationSnapshot();
    expect(snap.listLoaded).toBe(true);
    expect(reported.map(String).join()).not.toMatch(/timed out/);
  });
});
