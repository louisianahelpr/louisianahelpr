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

/**
 * For a whole-page gate that waits on useCurrentUser().isLoading (Q571): is
 * that wait one that cannot end? "offline-empty" when the device is offline
 * at all, not only when the profile query is paused. Measured on the local
 * build 2026-10-07 at 375: a returning visitor whose access token had expired
 * loaded /profile?tab=pets with the connection cut; the cached profile made
 * the query "success", but the token refresh could not complete offline, so
 * isLoading never cleared and the skeleton held. Only call it from inside the
 * gate's loading branch: offline with the page already loaded is not a wait.
 */
export function useProfileWaitPhase(profileQuery?: {
  status: "pending" | "error" | "success";
  fetchStatus: "fetching" | "paused" | "idle";
}): FeedPhase {
  const { online } = useOnlineStatus();
  return online ? feedPhase(profileQuery ?? { status: "pending", fetchStatus: "idle" }, online) : "offline-empty";
}
