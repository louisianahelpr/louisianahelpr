/*
 * Sentry JAVASCRIPT-4M (2 users as of 2026-11-01, iPhone, /jobs): "notifications load timed out after 15000ms". The event's
 * breadcrumbs show both list selects answered (200) and the unread HEAD count never came back; its 15 s timer
 * then failed the WHOLE load. A stalled count must leave unreadTotal unset (the bell counts the page) and the
 * loaded list in place, never fail the load.
 */
// @mutate src/components/notificationPanel/notificationFeed.ts |   } catch (e: unknown) {\n    report(e, { severity: "warning", tags: { source: "NotificationPanel.unreadCount" } });\n    return;\n  } |   } catch (e: unknown) {\n    throw e;\n  }
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
  it("the list stays loaded, the count stays unknown, the stall is reported as the count's", async () => {
    const done = loadNotificationFeed(U).then(() => "ok", (e: unknown) => `failed: ${String(e)}`);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(await done).toBe("ok");
    const snap = getNotificationSnapshot();
    expect(snap.listLoaded).toBe(true);
    expect(snap.unreadTotal ?? null).toBeNull();
    expect(reported.map(String).join()).toMatch(/timed out after 15000ms/);
  });
});
