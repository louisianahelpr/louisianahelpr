import { useEffect, useRef, useState } from "react";

/**
 * `/posts?highlight=<id>&manage=1` (the job page's "Manage job", board 14):
 * that Posted card opens its live controls in place, once, because the card
 * face itself is a link to the job page now.
 *
 * The id is captured on first render (JobListPage strips both params from the
 * URL right after). Once per link: a toggle is not idempotent, and the effect
 * can run twice before the expand lands (StrictMode / two renders), which shut
 * the card again (measured at 375 on the dev server, 2026-10-20).
 */
export function useManageDeepLink(
  idFromUrl: string | null,
  postedJobs: ReadonlyArray<{ id: string }>,
  cards: { expandedJobIds: Set<string>; toggleExpandedJobId: (id: string) => void },
): void {
  const [target, setTarget] = useState(idFromUrl);
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!target || done.current === target || !postedJobs.some((j) => j.id === target)) return;
    done.current = target;
    if (!cards.expandedJobIds.has(target)) cards.toggleExpandedJobId(target);
    setTarget(null);
  }, [target, postedJobs, cards]);
}
