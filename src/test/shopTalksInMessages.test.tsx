/**
 * S2-016 (Shops audit 2, 11-12): shop chats were missing from most of Messages. They showed only under the Shops chip
 * (hidden for testers until Shops opens to everyone), never under All or Unread, and the Messages badge and
 * "Unread · n" left them out. Now:
 *   1. Messages: a member with the shops switch and any shop chat gets the Shops chip (even before Shops opens), the
 *      chats sit above the threads under All (every one) and Unread (unread ones), and "Unread · n" counts them;
 *   2. the badge: the shared unread store adds unread shop chats to unread message threads (setShop), keeps that
 *      part when the message part changes, and the navs fill it (useShopTalksInBadge).
 *
 * @mutate src/pages/messages/useMessageSections.tsx | (k === "declutter" && hasOrderTalks) \|\| (k === "shops" && hasShopTalks), | (k === "declutter" && hasOrderTalks),
 * @mutate src/pages/messages/useMessageSections.tsx | const unread = conversations.filter((c) => c.unread > 0).length + shopUnread; | const unread = conversations.filter((c) => c.unread > 0).length;
 * @mutate src/pages/messages/useMessageSections.tsx |     section === "all" && hasShopTalks ? ShopTalkLead | section === "all" && false ? ShopTalkLead
 * @mutate src/components/mobileNav/useNavUnreadCount.ts |     store.count = store.messages + shop; |     store.count = store.messages;
 * @mutate src/components/mobileNav/useShopTalksInBadge.ts |       s.setShop(shown); |       void shown;
 * @mutate src/pages/messages/useMessageSections.tsx | window.dispatchEvent(new CustomEvent(SHOP_TALKS_UNREAD_EVENT | void (new CustomEvent(SHOP_TALKS_UNREAD_EVENT
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import type { SectionKey } from "@/components/sections/sectionsConfig";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/declutter/orderTalk", () => ({ MY_ORDER_TALKS_KEY: ["declutter", "my-order-talks"], fetchMyOrderTalks: async () => [] }));
const summary = vi.hoisted(() => ({ total: 2, unread: 1, calls: 0 }));
vi.mock("@/lib/shops/talkUnread", async (io) => ({
  ...(await io<typeof import("@/lib/shops/talkUnread")>()),
  SHOP_TALKS_SUMMARY_KEY: ["shops", "my-talks", "summary"],
  fetchShopTalkSummary: async () => { summary.calls++; return { total: summary.total, unread: summary.unread }; },
}));
const featureOn: Record<string, boolean> = { declutter: false, shops: true, rentals: false };
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => featureOn[k] ?? false }));
// A TESTER: Shops is switched on for them but not open to everyone, so before this the Shops chip stayed hidden.
vi.mock("@/components/landing/useSectionsOpen", async (io) => ({
  ...(await io<typeof import("@/components/landing/useSectionsOpen")>()),
  useOpenToEveryoneAnswer: () => new Set<string>(),
}));
const prefs = { order: ["jobs", "declutter", "shops", "homes"] as SectionKey[], hidden: [] as SectionKey[] };
vi.mock("@/components/sections/useSectionPrefs", async () => {
  const { SECTIONS: S } = await import("@/components/sections/sectionsConfig");
  return { useSectionPrefs: () => ({ prefs, visible: prefs.order.map((k) => S.find((s) => s.key === k)!), setHidden: vi.fn(), move: vi.fn() }) };
});
vi.mock("@/hooks/usePageReadsSettled", async (io) => ({
  ...(await io<typeof import("@/hooks/usePageReadsSettled")>()),
  useChromeReadsMayStart: () => true,
}));

import { useMessageSections } from "@/pages/messages/useMessageSections";
import { useShopTalksInBadge } from "@/components/mobileNav/useShopTalksInBadge";
import { stores, type UnreadStore } from "@/components/mobileNav/navUnreadStore";
import { summarizeShopTalks } from "@/lib/shops/talkUnread";

const wrap = (entry: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter></QueryClientProvider>;
  };

afterEach(() => {
  cleanup();
  stores.clear();
  summary.total = 2;
  summary.unread = 1;
});

describe("S2-016: shop chats in Messages", () => {
  it("a tester with shop chats gets the Shops chip, 'Unread · n' counts them, All lists them", async () => {
    const { result } = renderHook(() => useMessageSections([], []), { wrapper: wrap("/messages") });
    await waitFor(() => expect(result.current.inboxLead).not.toBeNull());
    render(<MemoryRouter>{result.current.strip}</MemoryRouter>);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["All", "Unread · 1", "Jobs", "Shops"]);
  });

  it("Unread lists only unread shop chats; with none, nothing is added", async () => {
    const { result } = renderHook(() => useMessageSections([], []), { wrapper: wrap("/messages?section=unread") });
    // No unread thread: the Unread empty state carries the unread shop chats as its Lead.
    await waitFor(() => expect(result.current.sectionEmpty?.Lead).toBeTruthy());
    summary.unread = 0;
    summary.total = 0;
    const second = renderHook(() => useMessageSections([], []), { wrapper: wrap("/messages") });
    await waitFor(() => expect(summary.calls).toBeGreaterThan(1));
    expect(second.result.current.inboxLead).toBeNull();
  });

  it("without the shops switch nothing is read", () => {
    featureOn.shops = false;
    try {
      const before = summary.calls;
      const { result } = renderHook(() => useMessageSections([], []), { wrapper: wrap("/messages") });
      expect(result.current.inboxLead).toBeNull();
      expect(summary.calls).toBe(before);
    } finally {
      featureOn.shops = true;
    }
  });

  it("summarizeShopTalks counts rows and unread rows only", () => {
    expect(summarizeShopTalks([{ unread: true }, { unread: false }, { unread: "yes" }])).toEqual({ total: 3, unread: 1 });
    expect(summarizeShopTalks(null)).toEqual({ total: 0, unread: 0 });
  });
});

describe("S2-016: shop chats in the Messages badge", () => {
  it("the navs put unread shop chats into the shared badge store, beside unread threads", async () => {
    const seen: number[] = [];
    let shop = 0;
    let messages = 3;
    const store: UnreadStore = {
      count: 3, messages: 3, listeners: new Set([(n) => seen.push(n)]),
      publish: (n) => { messages = n; store.messages = n; store.count = messages + shop; store.listeners.forEach((l) => l(store.count)); },
      setShop: (n) => { shop = n; store.count = messages + shop; store.listeners.forEach((l) => l(store.count)); },
      close: () => {},
    };
    stores.set("u-shop", store);
    renderHook(() => useShopTalksInBadge({ id: "u-shop" } as User), { wrapper: wrap("/") });
    await waitFor(() => expect(store.count).toBe(4));
  });
});

describe("S2-016: Messages hands the badge each fresh count", () => {
  it("the shop chat read on Messages tells the badge (opening a chat clears the badge without waiting)", async () => {
    const got: number[] = [];
    const on = (e: Event) => got.push((e as CustomEvent<{ unread: number }>).detail.unread);
    window.addEventListener("lh-shop-talks-unread", on);
    try {
      summary.unread = 2;
      renderHook(() => useMessageSections([], []), { wrapper: wrap("/messages") });
      await waitFor(() => expect(got).toContain(2));
    } finally {
      window.removeEventListener("lh-shop-talks-unread", on);
    }
  });
});

describe("S2-016: the real store adds the shop part and keeps it", () => {
  it("setShop adds to the message threads; publish (a new thread count) keeps the shop part", async () => {
    vi.doMock("@/lib/userRealtimeBus", () => ({ subscribeUserRealtime: () => () => {} }));
    vi.doMock("@/lib/userBlocks", () => ({ getBlockedUserIds: () => new Promise(() => {}) }));
    vi.doMock("@/components/notificationPanel/notificationFeed", () => ({ useNotificationFeed: () => {} }));
    vi.doMock("@/lib/appBadge", () => ({ setAppIconBadge: () => Promise.resolve() }));
    vi.doMock("@/components/mobileNav/mobileNavHelpers", () => ({ readCachedUnread: () => 2, writeCachedUnread: () => {} }));
    const { useNavUnreadCount } = await import("@/components/mobileNav/useNavUnreadCount");
    const navStore = { stores };
    const { result } = renderHook(() => useNavUnreadCount({ id: "u-real" } as User));
    await waitFor(() => expect(navStore.stores.get("u-real")).toBeTruthy());
    const s = navStore.stores.get("u-real")!;
    act(() => s.setShop(3));
    expect(result.current.unreadCount).toBe(5);
    act(() => s.publish(1));
    expect(result.current.unreadCount).toBe(4);
    expect(s.messages).toBe(1);
  });
});
