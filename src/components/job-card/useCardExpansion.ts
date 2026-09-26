import { useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "@/components/job-card/activityConstants";

export type CompletedJobMeta = Record<string, { tipped: boolean; reviewed: boolean; crewToReview?: Array<{ id: string; name: string }> }>;

/** sessionStorage key for the default-open cards the user collapsed by hand. */
export const COLLAPSED_AWAITING_KEY = "activity:collapsed-awaiting-tip-review";

/**
 * Does this posted job still owe the poster a tip or a review?
 *
 * Only a `completed` job whose meta has loaded counts: before the meta arrives
 * we do not know, and a card that opened and then snapped shut when the
 * answer came in would be exactly the load-time jump VN-32 is about.
 */
export function awaitsTipOrReview(
  job: Pick<Job, "id" | "status">,
  meta: CompletedJobMeta,
): boolean {
  if (job.status !== "completed") return false;
  const m = meta[job.id];
  if (!m) return false;
  return !(m.tipped && m.reviewed);
}

function readCollapsed(): string[] {
  try {
    const raw = sessionStorage.getItem(COLLAPSED_AWAITING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    // Unreadable storage (private mode) or a malformed value: fall back to the
    // defaults. This is a UI preference, not data — nothing to report.
    return [];
  }
}

/**
 * useCardExpansion — which job cards on Activity are open.
 *
 * Every card still expands and collapses independently, and only when the
 * user taps it (owner, 2026-08-31: "it should only close if i click it back to
 * close it not if i click another one").
 *
 * ONE DEFAULT CHANGED (owner, 2026-09-14, VN-29): "if they have a tip or review
 * still needing to be done on a done job, leave it expanded until tip and
 * review are both done, when they're done then collapse". Every posted card
 * used to open collapsed (owner, 2026-08-27); a completed job with a tip or a
 * review outstanding now opens EXPANDED, so the loose end is in front of the
 * poster instead of behind a tap.
 *
 *  - Default open: `awaitsTipOrReview`. The user's own tap always wins over the
 *    default, in both directions.
 *  - A card the user collapses stays collapsed for the rest of the browser
 *    session (sessionStorage), even across a navigation away and back — a meta
 *    refetch must never force it back open.
 *  - The moment the second of tip/review lands, the card collapses, whatever
 *    the user last did with it. That happens once per card: if they open it
 *    again afterwards, it stays open.
 */
export function useCardExpansion(postedJobs: Job[], completedJobMeta: CompletedJobMeta) {
  // The user's explicit choice per id: true = open, false = shut. Absent =
  // follow the default. Seeded with the default-open cards they collapsed
  // earlier this session.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(
    () => new Map(readCollapsed().map((id) => [id, false] as const)),
  );

  const defaultOpen = useMemo(() => {
    const s = new Set<string>();
    for (const job of postedJobs) if (awaitsTipOrReview(job, completedJobMeta)) s.add(job.id);
    return s;
  }, [postedJobs, completedJobMeta]);

  const expandedJobIds = useMemo(() => {
    const s = new Set(defaultOpen);
    for (const [id, open] of overrides) {
      if (open) s.add(id);
      else s.delete(id);
    }
    return s;
  }, [defaultOpen, overrides]);

  // Auto-collapse on the second of tip/review. Tracked by id rather than by
  // diffing the previous meta, because the meta can be briefly empty during a
  // refetch — a diff would read that as "no longer awaiting" and fire early.
  const seenAwaiting = useRef<Set<string>>(new Set());
  const collapsedOnDone = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const id of defaultOpen) seenAwaiting.current.add(id);
    const landed: string[] = [];
    for (const job of postedJobs) {
      const m = completedJobMeta[job.id];
      if (
        job.status === "completed" &&
        m?.tipped &&
        m?.reviewed &&
        seenAwaiting.current.has(job.id) &&
        !collapsedOnDone.current.has(job.id)
      ) {
        collapsedOnDone.current.add(job.id);
        landed.push(job.id);
      }
    }
    if (landed.length === 0) return;
    // Dropping the override hands the card back to its default, which is now
    // collapsed.
    setOverrides((prev) => {
      if (!landed.some((id) => prev.has(id))) return prev;
      const next = new Map(prev);
      for (const id of landed) next.delete(id);
      return next;
    });
  }, [defaultOpen, postedJobs, completedJobMeta]);

  useEffect(() => {
    try {
      const shut = [...overrides].filter(([, open]) => !open).map(([id]) => id);
      sessionStorage.setItem(COLLAPSED_AWAITING_KEY, JSON.stringify(shut));
    } catch {
      /* private mode / quota — the in-memory state still holds for this mount */
    }
  }, [overrides]);

  const toggleExpandedJobId = (id: string) => {
    setOverrides((prev) => {
      const current = prev.has(id) ? prev.get(id)! : defaultOpen.has(id);
      const next = new Map(prev);
      next.set(id, !current);
      return next;
    });
  };

  return { expandedJobIds, toggleExpandedJobId };
}
