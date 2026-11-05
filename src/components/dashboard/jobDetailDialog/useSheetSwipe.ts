import { useRef, type TouchEvent } from "react";
import type { EnrichedJob } from "../types";

/* Moved verbatim from JobDetailDialog.tsx (Q806 god-component ratchet, a pure move): the sheet's swipe-between-jobs
   touch handlers, spread onto DialogContent. */
export function useSheetSwipe(job: EnrichedJob | null, _allJobs: EnrichedJob[] | undefined, _onSelect: ((job: EnrichedJob) => void) | undefined) {
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  return {
    onTouchStart: (e: TouchEvent) => {
      if (!_allJobs || !_onSelect) return;
      const t = e.touches[0];
      touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    },
    onTouchEnd: (e: TouchEvent) => {
      // Mobile swipe to navigate between jobs in the filtered list.
      // Threshold: 60px horizontal movement, less than 50px vertical
      // (so accidental scroll-swipes don't fire), under 600ms total.
      if (!_allJobs || !_onSelect) return;
      const start = touchStartRef.current;
      touchStartRef.current = null;
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const dt = Date.now() - start.t;
      if (Math.abs(dx) < 60 || Math.abs(dy) > 50 || dt > 600) return;
      const idx = _allJobs.findIndex((j) => j.id === job!.id);
      if (idx < 0) return;
      const nextIdx = dx < 0 ? idx + 1 : idx - 1;
      if (nextIdx < 0 || nextIdx >= _allJobs.length) return;
      _onSelect(_allJobs[nextIdx]);
    },
  };
}
