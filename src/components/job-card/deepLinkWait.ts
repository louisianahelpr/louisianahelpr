import { useEffect, useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

/**
 * May a `?job=` / `?highlight=` link be resolved now? (Q1563, owner 2026-10-08:
 * "I applied to a job and when I clicked view application it took me to a
 * screen that did not show the job".) My Jobs opens from its cached list, which
 * does not have a brand-new application yet; resolving then consumed the link
 * on the default tab. A link whose card is missing waits until the list has
 * SETTLED: refreshed since the page opened (or never needed refreshing).
 */
export function deepLinkReady({ named, settled }: { named: boolean; settled: boolean }): boolean {
  return named || settled;
}

/** The longest a missing card is waited for before the link falls back to the default tab. */
export const DEEP_LINK_WAIT_MS = 6000;

type ActivityQuery = { isFetching: boolean; stale: boolean; updatedAt: number };

/**
 * Has the Activity list settled since `openedAt`? Owner, 2026-10-08 ("after
 * application sent, i clicked view in my jobs but then it took me to needs you
 * instead of waiting"): the first render reads "not fetching" BEFORE the stale
 * list's refetch has started, so "not fetching" alone is not "settled". A
 * stale query counts only once it has been refreshed after the page opened.
 */
export function activitySettled(queries: ActivityQuery[], openedAt: number): boolean {
  if (queries.some((q) => q.isFetching)) return false;
  return queries.every((q) => !q.stale || q.updatedAt >= openedAt);
}

/** `activitySettled` for the live cache, with a ceiling so a link never waits forever. */
export function useActivitySettled(): boolean {
  const qc = useQueryClient();
  const fetching = useIsFetching({ queryKey: queryKeys.activity.all }); // re-renders as fetches start and end
  const [openedAt] = useState(() => Date.now());
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), DEEP_LINK_WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  if (timedOut) return true;
  if (fetching > 0) return false;
  const queries = qc.getQueryCache().findAll({ queryKey: queryKeys.activity.all }).map((q) => ({
    isFetching: q.state.fetchStatus === "fetching",
    stale: q.isStale() || q.state.isInvalidated,
    updatedAt: q.state.dataUpdatedAt,
  }));
  return activitySettled(queries, openedAt);
}
