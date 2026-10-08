import { useIsFetching } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

/**
 * May a `?job=` / `?highlight=` link be resolved now? (Q1563, owner 2026-10-08:
 * "I applied to a job and when I clicked view application it took me to a
 * screen that did not show the job".) My Jobs opens from its cached list, which
 * does not have a brand-new application yet; resolving then consumed the link
 * on the default tab. A link whose card is missing waits for the refetch.
 */
export function deepLinkReady({ named, fetching }: { named: boolean; fetching: boolean }): boolean {
  return named || !fetching;
}

/** Is the Activity list refetching right now (the link's wait condition)? */
export function useActivityFetching(): boolean {
  return useIsFetching({ queryKey: queryKeys.activity.all }) > 0;
}
