/**
 * The Messages badge's shop chat count is read ONCE per page, not once per nav (the Q103 rule for the message part).
 * MobileNav and DesktopSidebarNav both mount useShopTalksInBadge on every signed-in page; each ran its own
 * shops_my_talks read, and the bell's first count (null -> a number) started a second round. Prod-audit run
 * 43691657529 (11-15): 2,895 shops_my_talks calls, 3.0 per signed-in page (980 against 326 feature_switches_for_me
 * in leg 4), the largest single shape of a run whose busiest minute hit 408 of its 400/min ceiling.
 *
 * @mutate src/components/mobileNav/useShopTalksInBadge.ts | if (prev && prev.front === front && (prev.bell === bell \|\| prev.bell === null \|\| bell === null)) { | if (false) {
 * @mutate src/components/mobileNav/useShopTalksInBadge.ts | (prev.bell === bell \|\| prev.bell === null \|\| bell === null) | (prev.bell === bell \|\| bell === null)
 * @mutate src/components/mobileNav/useShopTalksInBadge.ts | frontCount += 1; | frontCount += 0;
 * @mutate src/components/mobileNav/useShopTalksInBadge.ts | if (prev) prev.promise = Promise.resolve(unread); | void prev;
 * @mutate src/components/mobileNav/useShopTalksInBadge.ts | promise.catch(() => { if (reads.get(userId) === entry) reads.delete(userId); }); | promise.catch(() => {});
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";

const calls = vi.hoisted(() => ({ n: 0, unread: 1, fail: false }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/shops/talkUnread", async (io) => ({
  ...(await io<typeof import("@/lib/shops/talkUnread")>()),
  fetchShopTalkSummary: async () => {
    calls.n++;
    if (calls.fail) throw new Error("read failed");
    return { total: 3, unread: calls.unread };
  },
}));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => k === "shops" }));
vi.mock("@/hooks/usePageReadsSettled", async (io) => ({
  ...(await io<typeof import("@/hooks/usePageReadsSettled")>()),
  useChromeReadsMayStart: () => true,
}));

import { useShopTalksInBadge, __resetShopTalksBadgeReads } from "@/components/mobileNav/useShopTalksInBadge";
import { stores, type UnreadStore } from "@/components/mobileNav/navUnreadStore";
import { __resetNotificationStore, setNotificationUser, setUnreadTotal } from "@/components/notificationPanel/notificationStore";

const USER = { id: "u-one-read" } as User;
let shop = -1;

function bothNavs() {
  // MobileNav and DesktopSidebarNav: two consumers on one page.
  renderHook(() => useShopTalksInBadge(USER));
  renderHook(() => useShopTalksInBadge(USER));
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

beforeEach(() => {
  calls.n = 0;
  calls.unread = 1;
  calls.fail = false;
  shop = -1;
  __resetShopTalksBadgeReads();
  __resetNotificationStore();
  setNotificationUser(USER.id);
  const store: UnreadStore = {
    count: 0, messages: 0, listeners: new Set(),
    publish: () => {}, setShop: (n) => { shop = n; }, close: () => {},
  };
  stores.set(USER.id, store);
});

afterEach(() => {
  cleanup();
  stores.clear();
});

describe("shop chat badge: one read per page", () => {
  it("both navs share one read, and the bell's first count does not start another", async () => {
    bothNavs();
    await settle();
    expect(calls.n).toBe(1);
    act(() => setUnreadTotal(3)); // the bell counts for the first time
    await settle();
    expect(calls.n).toBe(1);
    expect(shop).toBe(1);
  });

  it("a real change of the bell count reads again, once for both navs", async () => {
    act(() => setUnreadTotal(3));
    bothNavs();
    await settle();
    expect(calls.n).toBe(1);
    calls.unread = 2;
    act(() => setUnreadTotal(4));
    await waitFor(() => expect(shop).toBe(2));
    await settle();
    expect(calls.n).toBe(2);
  });

  it("coming back to the front reads again, once for both navs", async () => {
    bothNavs();
    await settle();
    expect(calls.n).toBe(1);
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await settle();
    expect(calls.n).toBe(2);
  });

  it("Messages' fresh count is the answer a nav mounted later gets, with no read of its own", async () => {
    renderHook(() => useShopTalksInBadge(USER));
    await settle();
    expect(calls.n).toBe(1);
    act(() => { window.dispatchEvent(new CustomEvent("lh-shop-talks-unread", { detail: { unread: 5 } })); });
    cleanup();
    shop = -1;
    renderHook(() => useShopTalksInBadge(USER));
    await waitFor(() => expect(shop).toBe(5));
    expect(calls.n).toBe(1);
  });

  it("a failed read is not kept: the next mount reads again", async () => {
    calls.fail = true;
    renderHook(() => useShopTalksInBadge(USER));
    await settle();
    expect(calls.n).toBe(1);
    cleanup();
    calls.fail = false;
    renderHook(() => useShopTalksInBadge(USER));
    await settle();
    expect(calls.n).toBe(2);
    // Inventory floor: the two navs that mount this hook are still the consumers this guard models.
    const navs = ["src/components/MobileNav.tsx", "src/components/DesktopSidebarNav.tsx"]
      .filter((f) => blankComments(readFileSync(f, "utf8")).includes("useShopTalksInBadge(user)"));
    expect(navs.length).toBeGreaterThan(1);
  });
});
