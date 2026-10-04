/*
 * GUARD (Q1183): the bell's list loads ONCE when a page mounts. The shared
 * feed and the panel each start a load 800 ms after mount; the panel reaches
 * the feed after its session read, often just after the feed's own request
 * finished, so joining only an in-flight load still sent the list twice. The
 * panel's mount now reuses a load that succeeded within the last few seconds;
 * a forced refresh (pull-to-refresh, Try again) and a stale or failed feed
 * still load.
 */
// @mutate src/components/notificationPanel/notificationFeed.ts |   if (lastLoaded?.userId === userId && Date.now() - lastLoaded.at < maxAgeMs && listHeldFor(userId)) return Promise.resolve(); |   if (false) return Promise.resolve();
// @mutate src/components/NotificationPanel.tsx |     const timer = setTimeout(() => loadNotifications(false), 800); |     const timer = setTimeout(() => loadNotifications(), 800);
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const calls = { n: 0, fail: false };
vi.mock("@/integrations/supabase/client", () => {
  const chain = () => {
    const q: Record<string, unknown> = {};
    for (const k of ["select", "eq", "order"]) q[k] = () => q;
    q.limit = async () => (calls.fail ? { data: null, error: { message: "boom" } } : { data: [], error: null });
    q.then = undefined;
    return q;
  };
  return { supabase: { from: () => { calls.n += 1; return chain(); } } };
});

import { loadNotificationFeed, ensureFreshNotificationFeed, __resetNotificationFeedLoad } from "./notificationFeed";
import { setNotificationUser } from "./notificationStore";

const U = "11111111-1111-1111-1111-111111111111";

beforeEach(() => { calls.n = 0; calls.fail = false; __resetNotificationFeedLoad(); setNotificationUser(U); vi.useFakeTimers({ toFake: ["Date"] }); });
afterEach(() => vi.useRealTimers());

describe("the bell's list loads once per mount (Q1183)", () => {
  it("the panel's mount reuses the feed's load that just finished", async () => {
    await loadNotificationFeed(U);
    const afterFeed = calls.n;
    expect(afterFeed).toBeGreaterThan(0);
    await ensureFreshNotificationFeed(U);
    expect(calls.n).toBe(afterFeed);
  });

  it("a stale feed, a failed load and a forced refresh still load", async () => {
    await loadNotificationFeed(U);
    const one = calls.n;
    vi.setSystemTime(Date.now() + 6_000);
    await ensureFreshNotificationFeed(U);
    expect(calls.n).toBe(one * 2);
    await loadNotificationFeed(U);
    expect(calls.n).toBe(one * 3);
    __resetNotificationFeedLoad();
    calls.fail = true;
    await expect(loadNotificationFeed(U)).rejects.toBeTruthy();
    calls.fail = false;
    const before = calls.n;
    await ensureFreshNotificationFeed(U);
    expect(calls.n).toBeGreaterThan(before);
  });

  // @mutate src/components/notificationPanel/notificationFeed.ts |   }, (e: unknown) => {\n    lastLoaded = null;\n    throw e; |   }, (e: unknown) => {\n    throw e;
  it("a failed reload clears the stamp: the next mount loads instead of reusing the earlier success", async () => {
    await loadNotificationFeed(U);
    calls.fail = true;
    await expect(loadNotificationFeed(U)).rejects.toBeTruthy();
    calls.fail = false;
    const before = calls.n;
    await ensureFreshNotificationFeed(U);
    expect(calls.n).toBeGreaterThan(before);
  });

  // @mutate src/components/notificationPanel/notificationFeed.ts | && Date.now() - lastLoaded.at < maxAgeMs && listHeldFor(userId)) | && Date.now() - lastLoaded.at < maxAgeMs)
  it("a sign-out or user switch inside the window empties the store, so the next mount loads again", async () => {
    await loadNotificationFeed(U);
    setNotificationUser("22222222-2222-2222-2222-222222222222");
    setNotificationUser(U);
    const before = calls.n;
    await ensureFreshNotificationFeed(U);
    expect(calls.n).toBeGreaterThan(before);
  });

  it("the panel's mount asks for a fresh feed, and Try again forces one", () => {
    const panel = readFileSync(join(__dirname, "..", "NotificationPanel.tsx"), "utf8");
    expect(panel).toContain("setTimeout(() => loadNotifications(false), 800)");
    expect(panel).toContain("force ? loadNotificationFeed(session.user.id) : ensureFreshNotificationFeed(session.user.id)");
  });
});
