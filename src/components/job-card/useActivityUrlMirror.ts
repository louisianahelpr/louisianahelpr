import { useSearchParamMirror } from "@/hooks/useSearchParamMirror";

/* Moved out of JobListPage.tsx unchanged (Q806): Posted / Working's filter + search URL mirror. */
export function useActivityUrlMirror(
  statusFilter: string,
  setStatusFilter: (f: string) => void,
  searchQuery: string,
  setSearchQuery: (q: string) => void,
  defaultFilter: string,
): void {
  // Mirror filter + search into the URL through the SHARED hook.
  //
  // This screen used to hand-roll the same job in three interacting effects,
  // and it is the reason /jobs and /posts kept crashing into the route
  // error boundary. The failure mode is not obvious: `setSearchParams`
  // navigates unconditionally AND its identity churns on every location
  // change, so an effect that both writes it and depends on it re-arms itself.
  // WebKit throws at ~100 replaceState calls in 10s, which unmounts the route.
  // error_logs shows 19 of the last 20 RouteErrorBoundary entries are exactly
  // that message, across /browse, /jobs and /posts.
  //
  // /browse had the identical bug and was cured by moving onto
  // useSearchParamMirror, which decides OUTSIDE the updater (so the navigator
  // is never called on a no-op) and reaches setSearchParams through a ref (so
  // its identity cannot feed back into the deps). /browse has been clean since.
  // Activity was the last screen still hand-rolling it; this converges it.
  //
  // Empty string means "default" to the hook, so the param is DROPPED rather
  // than written when the filter is at its default and the search is blank —
  // preserving the previous behaviour of keeping a pristine view's URL clean.
  // `highlight` is not listed here and is therefore left untouched by the
  // hook; JobListPage's one-shot effect still strips it on mount.
  useSearchParamMirror(
    {
      filter: statusFilter === defaultFilter ? "" : statusFilter,
      q: searchQuery.trim(),
    },
    (read) => {
      const nextFilter = read("filter") || defaultFilter;
      if (nextFilter !== statusFilter) setStatusFilter(nextFilter);
      const nextQuery = read("q");
      if (nextQuery !== searchQuery.trim()) setSearchQuery(nextQuery);
    },
    "activity",
  );
}
