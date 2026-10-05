import { useEffect, useRef } from "react";

/**
 * Sentinel for infinite scroll — fires `fetchNextPage` when the returned ref's
 * element is ~80% of the way into view. Moved out of Dashboard.tsx
 * (component-size ratchet) with no change of behaviour.
 */
export function useLoadMoreSentinel({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  itemCount,
}: {
  hasNextPage: boolean | undefined;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
  itemCount: number;
}) {
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) fetchNextPage();
      },
      // rootMargin pulls the trigger ~20% of viewport early (~80% scroll point)
      { root: null, rootMargin: "0px 0px 20% 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, itemCount]);
  return loadMoreRef;
}
