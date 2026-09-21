import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * A FAILED LIST LOAD RENDERS AN ERROR WITH RETRY, NEVER "NOTHING HERE".
 *
 * Class check for the 2026-09-14 outage report (the bell said "Nothing new
 * yet." for a poster with 313 unread). Every list surface that can say
 * "nothing here" is covered by one test that fails its query and asserts the
 * error state:
 *
 *   notifications  → src/components/NotificationPanel.failedLoad.test.tsx
 *   My Posts/Jobs  → src/pages/activity/ActivityEmptyState.loadError.test.tsx
 *   messages list  → below (hook: rejected fetch → loadError; view: ErrorState)
 *   browse feed    → below (view: loadError + no jobs → ErrorState)
 *
 * Messages and Browse already routed a failure to their ErrorState when this
 * was written; these pin that, and each was shown able to fail by inverting
 * the view's `loadError` guard.
 */

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(), hapticHeavy: vi.fn(),
}));

const fetchConversationsMock = vi.fn();
vi.mock("@/pages/messages/messagesData/loadConversations", () => ({
  fetchConversations: (...args: unknown[]) => fetchConversationsMock(...args),
  buildDeepLinkPlaceholder: vi.fn(),
}));

import { useMessagesData } from "@/pages/messages/useMessagesData";
import { ConversationList } from "@/components/messages/ConversationList";

const retry = () => screen.queryByRole("button", { name: /try again/i });

describe("Messages list: a rejected inbox query shows the error state", () => {
  it("the rejected query reaches the view as ErrorState, not 'No messages yet'", async () => {
    fetchConversationsMock.mockRejectedValue(new Error("canceling statement due to statement timeout"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () =>
        useMessagesData({
          userId: null,
          cachedUser: { id: "user-1" },
          deepLinkJobId: null,
          deepLinkUserId: null,
          navigate: vi.fn() as never,
          scrollToBottom: vi.fn(),
          activeConvoRef: { current: null },
          chatContainerRef: { current: null },
        } as never),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loadError).toBe(true));

    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ConversationList
            conversations={result.current.conversations}
            loading={result.current.loading}
            loadError={result.current.loadError}
            retryInbox={vi.fn()}
            userId="user-1"
            loadConversations={vi.fn(async () => {})}
            openConvo={vi.fn()}
            setDeleteConvoConfirm={vi.fn()}
            onBatchArchive={vi.fn()}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByText("We couldn't load your messages.")).not.toBeNull();
    expect(retry()).not.toBeNull();
    expect(screen.queryByText("No messages yet")).toBeNull();
  });
});

vi.mock("@/hooks/useProfile", () => ({ useProfile: () => ({ data: null }) }));
vi.mock("@/hooks/useHelprActivity", () => ({ useHelprActivity: () => ({ activity: null }) }));

import { BrowseTasksFeed } from "@/components/dashboard/BrowseTasksFeed";

describe("Browse feed: a failed jobs query shows the error state", () => {
  it("loadError with no jobs renders ErrorState, not 'Nothing today'", () => {
    const filters = {
      filteredJobs: [],
      nearbyJobs: [],
      hasFilters: false,
      sortBy: "smart",
      userLoc: null,
      nearbyMiles: null,
      locationFilter: "all",
      boostedOnly: false,
      mapFilter: "all",
      clearFilters: vi.fn(),
      setLocationFilter: vi.fn(),
    };
    const noop = vi.fn();
    render(
      <MemoryRouter>
        <BrowseTasksFeed
          view="list"
          density={"comfortable" as never}
          filters={filters as never}
          user={{ id: "user-1" } as never}
          allJobs={[]}
          loadError
          refresh={noop}
          recommendedJobs={[]}
          recommendedLoading={false}
          effectiveFee={10}
          handleApplyRequest={noop}
          handleDismissRequest={noop}
          handleToggleSave={noop}
          expandedCardId={null}
          setExpandedCardId={noop}
          savedJobIds={new Set()}
          setReportJobId={noop}
          setDetailJob={noop}
          containerRef={{ current: null }}
          pullDistance={0}
          refreshing={false}
          isPulling={false}
          loadMoreRef={{ current: null }}
          hasNextPage={false}
          isFetchingNextPage={false}
          fetchNextPage={noop}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText("We couldn't load jobs.")).not.toBeNull();
    expect(retry()).not.toBeNull();
    expect(screen.queryByText(/Nothing today/)).toBeNull();
  });
});
