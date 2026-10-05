import { feedPhase, type FeedPhase } from "@/lib/feedPhase";
import { useOnlineStatus } from "@/lib/useOnlineStatus";

/**
 * feedPhase() for one React Query result, with the app's connectivity read in
 * (Q332, Q571). Use it wherever a screen chooses between skeleton, empty
 * state, error and content from a query: `!isLoading` is NOT "the data is
 * in" (a query paused offline has isLoading false and no data), and a screen
 * that reads it that way shows "nothing here" to someone who is offline.
 * src/test/offlineIsNotEmpty.test.ts holds every such screen to it.
 */
export function useFeedPhase(q: {
  status: "pending" | "error" | "success";
  fetchStatus: "fetching" | "paused" | "idle";
}): FeedPhase {
  const { online } = useOnlineStatus();
  return feedPhase(q, online);
}
