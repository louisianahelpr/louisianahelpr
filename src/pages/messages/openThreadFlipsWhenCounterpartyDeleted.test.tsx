/**
 * Q510 — an OPEN thread flips to the deleted-account notice when the other
 * party deletes their account, not only when the viewer next sends (Q334).
 *
 * `messages_receiver_id_fkey ... ON DELETE SET NULL` rewrites every message the
 * viewer sent to that person: `receiver_id` becomes NULL, which reaches the
 * viewer as a realtime UPDATE of their OWN row (the `sender_id=eq.<me>` UPDATE
 * listener). That event, or a reconnect after one was missed, is the hint; the
 * server (get_thread_counterparty_deleted) is the authority.
 *
 *   1. the realtime hook raises the hint only for that event,
 *   2. the page asks the server and flips the open thread (and only that one),
 *   3. a "no" or an unanswerable ask changes nothing,
 *   4. Messages.tsx really wires both the event and the reconnect to it.
 */
// @mutate src/pages/messages/useMessagesRealtime.ts | updated.receiver_id === null && | true &&
// @mutate src/pages/messages/useMessagesRealtime.ts | !updated.is_system && | true &&
// @mutate src/pages/messages/useMessagesData.ts | if ((await fetchCounterpartyDeleted(jobId, otherUserId)) !== true) return; | if ((await fetchCounterpartyDeleted(jobId, otherUserId)) === null) return;
// @mutate src/pages/messages/useMessagesData.ts | setActiveConvo((prev) => flipToDeletedAccountThread(prev, jobId, otherUserId)); | void flipToDeletedAccountThread;
// @mutate src/pages/messages/Messages.tsx | onOwnMessageOrphaned: checkCounterpartyDeleted, | onOwnMessageOrphaned: () => {},
// @mutate src/pages/messages/Messages.tsx | void checkCounterpartyDeleted(open.jobId, open.otherUserId); | void open;
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NavigateFunction } from "react-router-dom";
import type { Conversation, Message } from "@/components/messages/types";

const hoisted = vi.hoisted(() => ({
  listeners: [] as { event: string; filter?: string; handler: (payload: unknown) => void }[],
  deleted: { value: true as boolean | null },
  asked: [] as [string, string][],
}));

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/realtimeRecovery", () => ({
  subscribeWithRecovery: (factory: (name: string) => unknown) => {
    factory("test-channel");
    return { close: vi.fn() };
  },
}));
vi.mock("@/lib/userRealtimeBus", () => ({ subscribeUserRealtime: () => vi.fn() }));
vi.mock("./messagesData/loadConversations", () => ({
  fetchConversations: vi.fn(async () => []),
  buildDeepLinkPlaceholder: vi.fn(),
}));
vi.mock("@/lib/deletedCounterparty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deletedCounterparty")>()),
  fetchCounterpartyDeleted: vi.fn(async (jobId: string, other: string) => {
    hoisted.asked.push([jobId, other]);
    return hoisted.deleted.value;
  }),
}));
vi.mock("@/integrations/supabase/client", () => {
  const builder: Record<string, unknown> = new Proxy({}, {
    get: (_t, prop) =>
      prop === "then" ? (fn: (r: unknown) => unknown) => fn({ data: [], error: null }) : () => builder,
  });
  return {
    supabase: {
      channel: () => {
        const chan = {
          on: (event: string, cfg: { event?: string; filter?: string }, handler: (p: unknown) => void) => {
            hoisted.listeners.push({ event: cfg.event ?? event, filter: cfg.filter, handler });
            return chan;
          },
        };
        return chan;
      },
      from: () => builder,
      rpc: () => builder,
      auth: { refreshSession: () => Promise.resolve({ data: {}, error: null }) },
    },
  };
});

import { useMessagesRealtime } from "./useMessagesRealtime";
import { useMessagesData } from "./useMessagesData";
import { flipToDeletedAccountThread } from "@/lib/deletedCounterparty";
import { FORMER_MEMBER_LABEL } from "@/lib/deletedPerson";

const OPEN: Conversation = {
  otherUserId: "other-1",
  otherUserName: "Dana R.",
  otherUserAvatarUrl: "https://example.test/a.png",
  jobTitle: "Fix the fence",
  jobId: "job-1",
  lastMessage: "On my way",
  lastAt: "2026-08-17T10:00:00.000Z",
  unread: 0,
} as Conversation;

const row = (over: Partial<Message> = {}) =>
  ({
    id: "m-1", job_id: "job-1", sender_id: "me", receiver_id: null,
    content: "see you Saturday", created_at: "2026-08-17T09:00:00.000Z",
    read: true, is_system: false, ...over,
  }) as Message;

beforeEach(() => {
  hoisted.listeners.length = 0;
  hoisted.asked.length = 0;
  hoisted.deleted.value = true;
});
afterEach(() => vi.clearAllMocks());

describe("1. the realtime hook raises the hint", () => {
  function mount(active: Conversation | null) {
    const onOwnMessageOrphaned = vi.fn();
    renderHook(() =>
      useMessagesRealtime({
        userId: "me",
        activeConvoRef: { current: active },
        setMessages: vi.fn(),
        scrollToBottom: vi.fn(),
        patchConversationForMessage: vi.fn(),
        onJobStatusAnnouncement: vi.fn(),
        onOwnMessageOrphaned,
        onRecovered: vi.fn(),
      }),
    );
    const update = hoisted.listeners.find((l) => l.event === "UPDATE" && l.filter === "sender_id=eq.me")!;
    return { onOwnMessageOrphaned, update };
  }

  it("subscribes the sender-side UPDATE listener (floor: else every case below is vacuous)", () => {
    const { update } = mount(OPEN);
    expect(update).toBeDefined();
    expect(hoisted.listeners.length).toBeGreaterThan(2);
  });

  it("receiver_id -> NULL on my message in the open thread names that thread", () => {
    const { onOwnMessageOrphaned, update } = mount(OPEN);
    update.handler({ eventType: "UPDATE", new: row() });
    expect(onOwnMessageOrphaned).toHaveBeenCalledWith("job-1", "other-1");
  });

  it.each([
    ["an ordinary edit (receiver intact)", row({ receiver_id: "other-1" })],
    ["a null receiver on a system row", row({ is_system: true })],
    ["another job's message", row({ job_id: "job-2" })],
  ])("%s raises nothing", (_n, updated) => {
    const { onOwnMessageOrphaned, update } = mount(OPEN);
    update.handler({ eventType: "UPDATE", new: updated });
    expect(onOwnMessageOrphaned).not.toHaveBeenCalled();
  });

  it("nothing open, or the deleted-account thread already open, raises nothing", () => {
    for (const active of [null, { ...OPEN, otherUserId: null } as Conversation]) {
      hoisted.listeners.length = 0;
      const { onOwnMessageOrphaned, update } = mount(active);
      update.handler({ eventType: "UPDATE", new: row() });
      expect(onOwnMessageOrphaned).not.toHaveBeenCalled();
    }
  });
});

describe("2. the page asks the server and flips only the open thread", () => {
  function mountPage(active: Conversation) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
      () =>
        useMessagesData({
          userId: "me",
          cachedUser: { id: "me" },
          deepLinkJobId: null,
          deepLinkUserId: null,
          navigate: vi.fn() as unknown as NavigateFunction,
          scrollToBottom: vi.fn(),
          activeConvoRef: { current: null },
          chatContainerRef: { current: null },
        }),
      { wrapper },
    );
    act(() => hook.result.current.setActiveConvo(active));
    return hook;
  }

  it("a server 'yes' turns the open thread into the deleted-account thread", async () => {
    const hook = mountPage(OPEN);
    await act(async () => { await hook.result.current.checkCounterpartyDeleted("job-1", "other-1"); });
    await waitFor(() => expect(hook.result.current.activeConvo?.otherUserId).toBeNull());
    expect(hook.result.current.activeConvo?.otherUserName).toBe(FORMER_MEMBER_LABEL);
    expect(hook.result.current.activeConvo?.otherUserAvatarUrl).toBeNull();
    expect(hoisted.asked).toEqual([["job-1", "other-1"]]);
  });

  it.each([false, null])("a server %s leaves the thread live", async (answer) => {
    hoisted.deleted.value = answer;
    const hook = mountPage(OPEN);
    await act(async () => { await hook.result.current.checkCounterpartyDeleted("job-1", "other-1"); });
    expect(hoisted.asked.length).toBe(1);
    expect(hook.result.current.activeConvo?.otherUserId).toBe("other-1");
  });

  it("a late 'yes' for a thread the viewer has left does not rewrite the one they are in", async () => {
    const hook = mountPage({ ...OPEN, jobId: "job-2" });
    await act(async () => { await hook.result.current.checkCounterpartyDeleted("job-1", "other-1"); });
    expect(hook.result.current.activeConvo?.otherUserId).toBe("other-1");
    expect(hook.result.current.activeConvo?.jobId).toBe("job-2");
  });

  it("a burst of orphaned-row events for one thread costs one ask", async () => {
    const hook = mountPage(OPEN);
    await act(async () => {
      await Promise.all([1, 2, 3].map(() => hook.result.current.checkCounterpartyDeleted("job-1", "other-1")));
    });
    expect(hoisted.asked.length).toBe(1);
  });
});

describe("the flip itself", () => {
  it("only the named thread, and a null convo, pass through", () => {
    expect(flipToDeletedAccountThread(null, "job-1", "other-1")).toBeNull();
    expect(flipToDeletedAccountThread(OPEN, "job-9", "other-1")).toBe(OPEN);
    expect(flipToDeletedAccountThread(OPEN, "job-1", "someone-else")).toBe(OPEN);
    expect(flipToDeletedAccountThread(OPEN, "job-1", "other-1")?.otherUserId).toBeNull();
  });
});

describe("4. Messages.tsx wires the event and the reconnect to it", () => {
  const src = readFileSync(resolve(__dirname, "Messages.tsx"), "utf8");
  it("passes the page's check as onOwnMessageOrphaned and runs it on recovery", () => {
    expect(src).toMatch(/onOwnMessageOrphaned:\s*checkCounterpartyDeleted/);
    expect(src).toMatch(/void checkCounterpartyDeleted\(open\.jobId, open\.otherUserId\)/);
  });
});
