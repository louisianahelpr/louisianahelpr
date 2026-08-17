// The Messages inbox used to live in `useState` with `loading` initialised to
// `true`, so every navigation back to /messages blanked the list and refetched
// 200 rows + five RPCs from scratch (owner-reported: "Messages jumps/loads
// every time I go on it"). It is now a React Query query.
//
// These tests pin the property that fix depends on: with a warm cache the hook
// hands back the conversations on its FIRST render, with `loading` already
// false and no second fetch. If someone reintroduces local state — or drops the
// `cachedUser.id` fallback that makes the query key correct on frame one — the
// warm-cache test fails.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NavigateFunction } from "react-router-dom";
import type { Conversation } from "@/components/messages/types";

/** A spy that also satisfies react-router's NavigateFunction overloads. */
const makeNavigate = () =>
  vi.fn() as unknown as NavigateFunction & ReturnType<typeof vi.fn>;

const fetchConversationsMock = vi.fn();
const buildDeepLinkPlaceholderMock = vi.fn();

vi.mock("./messagesData/loadConversations", () => ({
  fetchConversations: (...args: unknown[]) => fetchConversationsMock(...args),
  buildDeepLinkPlaceholder: (...args: unknown[]) =>
    buildDeepLinkPlaceholderMock(...args),
}));

import { useMessagesData } from "./useMessagesData";

const CONVO: Conversation = {
  otherUserId: "other-1",
  otherUserName: "Dana R.",
  jobTitle: "Fix the fence",
  jobId: "job-1",
  lastMessage: "On my way",
  lastAt: "2026-08-17T10:00:00.000Z",
  unread: 2,
};

const USER_ID = "user-1";

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function renderMessagesData(
  client: QueryClient,
  opts: {
    deepLinkJobId?: string | null;
    deepLinkUserId?: string | null;
    navigate?: NavigateFunction & ReturnType<typeof vi.fn>;
  } = {},
) {
  return renderHook(
    () =>
      useMessagesData({
        userId: null,
        // Mirrors the real page: `userId` is seeded by an effect, so the
        // already-cached auth user is what keys the query on frame one.
        cachedUser: { id: USER_ID },
        deepLinkJobId: opts.deepLinkJobId ?? null,
        deepLinkUserId: opts.deepLinkUserId ?? null,
        navigate: opts.navigate ?? makeNavigate(),
        scrollToBottom: vi.fn(),
        activeConvoRef: { current: null },
        chatContainerRef: { current: null },
      }),
    { wrapper: makeWrapper(client) },
  );
}

beforeEach(() => {
  fetchConversationsMock.mockReset();
  buildDeepLinkPlaceholderMock.mockReset();
  fetchConversationsMock.mockResolvedValue([CONVO]);
});

describe("useMessagesData — inbox caching", () => {
  it("shows the skeleton only on a cold cache, then resolves the inbox", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderMessagesData(client);

    // Cold: nothing cached, so the page is entitled to its skeleton.
    expect(result.current.loading).toBe(true);
    expect(result.current.conversations).toEqual([]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.conversations).toEqual([CONVO]);
    expect(fetchConversationsMock).toHaveBeenCalledTimes(1);
  });

  it("renders cached conversations on the first render of a revisit — no blank flash, no refetch", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const first = renderMessagesData(client);
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    // Re-entering /messages remounts the hook against the same cache.
    const second = renderMessagesData(client);

    // The assertion that matters: populated and NOT loading on render one.
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.conversations).toEqual([CONVO]);
    // Still inside the 60s staleTime, so the revisit costs zero requests.
    expect(fetchConversationsMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed inbox fetch as loadError instead of an empty inbox", async () => {
    fetchConversationsMock.mockRejectedValue(new Error("permission denied"));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderMessagesData(client);

    await waitFor(() => expect(result.current.loadError).toBe(true));
    expect(result.current.loading).toBe(false);
    expect(result.current.conversations).toEqual([]);
  });

  it("setConversations writes through to the cache so optimistic edits survive a remount", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const first = renderMessagesData(client);
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    // Same shape the mark-as-read / mute / patch callers use.
    first.result.current.setConversations((prev) =>
      prev.map((c) => ({ ...c, unread: 0 })),
    );
    await waitFor(() =>
      expect(first.result.current.conversations[0].unread).toBe(0),
    );
    first.unmount();

    const second = renderMessagesData(client);
    expect(second.result.current.conversations[0].unread).toBe(0);
  });
});

describe("useMessagesData — deep links against the cache", () => {
  it("opens a thread that is already in the cached inbox", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const navigate = makeNavigate();
    const { result } = renderMessagesData(client, {
      deepLinkJobId: CONVO.jobId,
      deepLinkUserId: CONVO.otherUserId,
      navigate,
    });

    await waitFor(() => expect(result.current.activeConvo).toEqual(CONVO));
    expect(navigate).toHaveBeenCalledWith("/messages?chat=1", { replace: true });
    expect(buildDeepLinkPlaceholderMock).not.toHaveBeenCalled();
  });

  it("revalidates before falling back to a placeholder — a cached inbox that predates the thread must not render it as empty", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // Warm the cache with an inbox that does NOT contain the deep-linked
    // thread (the "user just applied and was sent straight here" case).
    const warm = renderMessagesData(client);
    await waitFor(() => expect(warm.result.current.loading).toBe(false));
    warm.unmount();

    // The revalidation the deep link forces now returns the real thread.
    const fresh: Conversation = {
      ...CONVO,
      jobId: "job-2",
      otherUserId: "other-2",
      otherUserName: "Sam T.",
    };
    fetchConversationsMock.mockResolvedValue([CONVO, fresh]);

    const navigate = makeNavigate();
    const { result } = renderMessagesData(client, {
      deepLinkJobId: "job-2",
      deepLinkUserId: "other-2",
      navigate,
    });

    await waitFor(() => expect(result.current.activeConvo).toEqual(fresh));
    // Resolved from the refetch, not invented as a placeholder.
    expect(buildDeepLinkPlaceholderMock).not.toHaveBeenCalled();
    expect(fetchConversationsMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to a placeholder once the revalidation confirms there is no thread", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const placeholder: Conversation = {
      otherUserId: "other-9",
      otherUserName: "New Person",
      jobTitle: "Brand new job",
      jobId: "job-9",
      lastMessage: "",
      lastAt: "2026-08-17T11:00:00.000Z",
      unread: 0,
    };
    buildDeepLinkPlaceholderMock.mockResolvedValue(placeholder);

    const navigate = makeNavigate();
    const { result } = renderMessagesData(client, {
      deepLinkJobId: "job-9",
      deepLinkUserId: "other-9",
      navigate,
    });

    // Inbox settles first (job-9 is genuinely absent), then the deep link
    // forces its one confirming refetch before the placeholder is built.
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() =>
      expect(buildDeepLinkPlaceholderMock).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(result.current.activeConvo).toEqual(placeholder),
    );
    expect(fetchConversationsMock).toHaveBeenCalledTimes(2);
    expect(result.current.conversations[0]).toEqual(placeholder);
    expect(navigate).toHaveBeenCalledWith("/messages?chat=1", { replace: true });
  });
});
