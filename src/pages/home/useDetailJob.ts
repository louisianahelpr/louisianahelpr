import { useState, useCallback, useEffect, useRef, type SetStateAction } from "react";
import type { useSearchParams } from "react-router-dom";
import type { EnrichedJob } from "@/components/dashboard/types";

type SetSearchParams = ReturnType<typeof useSearchParams>[1];

type UseDetailJobArgs = {
  containerRef: React.RefObject<HTMLDivElement>;
  searchParams: URLSearchParams;
  setSearchParams: SetSearchParams;
  allJobs: EnrichedJob[];
};

// The job-detail dialog's open/close lifecycle: which job is open, the
// feed-scroll snapshot restored on close, the ?job=<id> URL mirroring, and
// the one-shot restore of the dialog from that URL param on mount. Extracted
// verbatim from Dashboard so the page focuses on composition.
export function useDetailJob({ containerRef, searchParams, setSearchParams, allJobs }: UseDetailJobArgs) {
  const [detailJob, setDetailJob] = useState<EnrichedJob | null>(null);
  // Scroll-position snapshot — captured the moment a detail dialog opens,
  // then restored to the same scrollTop on close. Without it the dashboard
  // feed silently snaps back to the top when the user dismisses the dialog,
  // which feels broken on a long-scroll session. The container is the
  // PullToRefreshWrapper's div (PageScaffold panel scroll surface) so the
  // restore lands on the same surface the user was scrolling.
  const detailScrollSnapshotRef = useRef<number | null>(null);

  // Open a job detail dialog while snapshotting the feed's scroll position
  // so it can be restored when the dialog closes (see closeDetailJob).
  // Accepts a setter-style arg matching React.Dispatch so the
  // BrowseTasksFeed prop signature (Dispatch<SetStateAction<...>>) keeps
  // its existing call sites untouched.
  const openDetailJob = useCallback((value: SetStateAction<EnrichedJob | null>) => {
    const el = containerRef.current;
    if (el) detailScrollSnapshotRef.current = el.scrollTop;
    setDetailJob(value);
    // Mirror the open job into the URL (?job=<id>, replacing the entry so we
    // don't spam history). This is what lets a jump to a sub-route from inside
    // the dialog — e.g. the Helper Pro "Learn more" → /subscription — return to
    // the open job on Back, instead of dropping onto the bare dashboard.
    if (value && typeof value !== "function") {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("job", value.id);
        return next;
      }, { replace: true });
    }
  }, [containerRef, setSearchParams]);

  // Close the detail dialog and restore the feed scroll position captured
  // at open time. We restore after a microtask to outlast any layout-shift
  // the closing dialog might cause, and clear the snapshot so a future
  // open captures a fresh value.
  const closeDetailJob = useCallback(() => {
    setDetailJob(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("job");
      return next;
    }, { replace: true });
    const snapshot = detailScrollSnapshotRef.current;
    detailScrollSnapshotRef.current = null;
    if (snapshot == null) return;
    // Two rAFs: first lets React commit the dialog-close, second runs
    // after the browser paints so the restored scrollTop sticks.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = containerRef.current;
        if (el) el.scrollTop = snapshot;
      });
    });
  }, [containerRef, setSearchParams]);

  // Re-open the detail dialog from the URL on mount (?job=<id>). Add-only and
  // one-shot: it restores the dialog after returning from a sub-route like
  // /subscription, but never clears the param (close handles that), so it can't
  // race the open/close writers above. Retries until the job feed has loaded.
  const restoredJobParam = useRef(false);
  useEffect(() => {
    if (restoredJobParam.current) return;
    const id = searchParams.get("job");
    if (!id) {
      restoredJobParam.current = true;
      return;
    }
    const match = allJobs.find((j) => j.id === id);
    if (match) {
      setDetailJob(match);
      restoredJobParam.current = true;
    }
  }, [searchParams, allJobs]);

  return { detailJob, openDetailJob, closeDetailJob };
}
