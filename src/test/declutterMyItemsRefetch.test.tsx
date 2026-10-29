/**
 * Audit 1028 D1-8 (1a-s-manage-failed-click-375): the seller's listing still said "Waiting for a review" after the
 * admin approved it, on a fresh page load about a minute later. The listings read is kept on the device and counts as
 * fresh for 60 s, so a reload inside that minute showed the old row without asking again. While a listing waits for
 * review the read runs again on every mount, and a new notice (the approval sends one) reads it again at once.
 *
 * @mutate src/components/declutter/myItemsQuery.ts |     refetchOnMount: (q: Query<DeclutterItem[]>) => (waiting(q) ? ("always" as const) : true), |     refetchOnMount: true,
 * @mutate src/components/declutter/myItemsQuery.ts | () => subscribeUserRealtime(userId, "notifications:insert", | () => subscribeUserRealtime(userId, "messages:inbound",
 */
import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

const fetchMyItems = vi.fn(async () => [{ id: "i1", status: "live" }]);
vi.mock("@/lib/declutter/api", () => ({ fetchMyItems: () => fetchMyItems() }));
const listeners = new Map<string, () => void>();
vi.mock("@/lib/userRealtimeBus", () => ({
  subscribeUserRealtime: (_uid: string, topic: string, fn: () => void) => { listeners.set(topic, fn); return () => listeners.delete(topic); },
}));

import { myItemsQuery, useMyItemsFollowNotices } from "@/components/declutter/myItemsQuery";

function Mine() {
  useQuery(myItemsQuery("u1"));
  useMyItemsFollowNotices("u1");
  return null;
}
function client(status: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  // What the device kept from a read a few seconds ago (fresh under the app's 60 s staleTime).
  qc.setQueryData(["declutter", "mine", "u1"], [{ id: "i1", status }]);
  return qc;
}

describe("D1-8: the seller's listings read again while one waits for review", () => {
  it("a kept read with a listing in review is read again on mount; an all-live one is not", async () => {
    fetchMyItems.mockClear();
    const a = render(<QueryClientProvider client={client("pending_review")}><Mine /></QueryClientProvider>);
    await waitFor(() => expect(fetchMyItems).toHaveBeenCalledTimes(1));
    a.unmount();
    fetchMyItems.mockClear();
    render(<QueryClientProvider client={client("live")}><Mine /></QueryClientProvider>);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMyItems).toHaveBeenCalledTimes(0);
  });

  it("a new notice reads the listings again", async () => {
    fetchMyItems.mockClear();
    render(<QueryClientProvider client={client("live")}><Mine /></QueryClientProvider>);
    await waitFor(() => expect(listeners.has("notifications:insert")).toBe(true));
    listeners.get("notifications:insert")!();
    await waitFor(() => expect(fetchMyItems).toHaveBeenCalledTimes(1));
  });
});
