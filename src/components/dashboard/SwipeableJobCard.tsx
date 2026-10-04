import { memo, useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { createLazyModule } from "@/lib/lazyModule";
import { whenPageSettled } from "@/lib/routePrefetch";
import JobCard from "./JobCard";
import type { EnrichedJob } from "./types";

interface SwipeableJobCardProps {
  job: EnrichedJob;
  effectiveFee: number;
  currentUserId?: string;
  showApply?: boolean;
  onApply: (jobId: string) => void;
  onReport: (jobId: string) => void;
  onSelect: (job: EnrichedJob) => void;
  onDismiss: (jobId: string) => void;
  index?: number;
  isExpanded?: boolean;
  onToggleExpand?: (jobId: string) => void;
  isSaved?: boolean;
  onToggleSave?: (jobId: string, saved: boolean) => void;
  /** Viewer's cached location — forwarded to JobCard for the distance pill. */
  userLat?: number | null;
  userLng?: number | null;
  /** Marks this as a top recommended pick — forwarded to JobCard's pill. */
  recommended?: boolean;
}

/**
 * framer-motion rides this card's swipe gesture only (SwipeMotionLayer), and
 * that chunk is fetched once the page has settled, or on the first touch of a
 * card, not before /home's first draw (Q1172: proxy.js + animate.js, ~40 kB
 * brotli, sat on /home's route closure through BrowseTasksFeed). Until it
 * arrives the card is its content in a plain `relative z-10` div: the swipe
 * trails and underlays are invisible at rest, so the first frame is the same.
 *
 * THE CONTENT MUST NOT REMOUNT when the layer arrives (a remount restarts
 * OptimizedImage's fade and drops JobCard's local state on every card that is
 * already on screen). React remounts a subtree whose parent element type
 * changes, `div` -> `motion.div`, so the card is portaled into one DOM node
 * (`slot`, `display: contents`) that React never recreates; the host that
 * currently stands in for the surface, the plain div or the motion.div, adopts
 * that node through its ref. The swap moves the DOM node; JobCard's fibers and
 * its images stay where they are.
 */
const swipeLayer = createLazyModule(() => import("./SwipeMotionLayer"), "SwipeableJobCard.loadSwipeLayer");

let swipeLayerScheduled = false;
/** One page-settle watch for the whole list, not one per card. */
function scheduleSwipeLayer() {
  if (swipeLayerScheduled) return;
  swipeLayerScheduled = true;
  whenPageSettled(swipeLayer.start);
}

const SwipeableJobCard = ({
  job,
  effectiveFee,
  currentUserId,
  showApply,
  onApply,
  onReport,
  onSelect,
  onDismiss,
  index,
  isExpanded,
  onToggleExpand,
  isSaved,
  onToggleSave,
  userLat = null,
  userLng = null,
  recommended = false,
}: SwipeableJobCardProps) => {
  const Layer = swipeLayer.use();
  const [swiping, setSwiping] = useState(false);
  const [held, setHeld] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(scheduleSwipeLayer, []);
  const [slot] = useState(() => {
    const el = document.createElement("div");
    el.style.display = "contents";
    return el;
  });
  const adoptSlot = useCallback((el: HTMLDivElement | null) => {
    if (el) el.appendChild(slot);
  }, [slot]);

  // The "Just in" freshness pill used to be rendered HERE — an absolutely
  // positioned overlay at `top-2 left-20`, painted over the finished JobCard
  // from outside it, with a hardcoded guess at where the category tab ended.
  // It is now a first-class chip on JobCard's own badge rail (owner,
  // 2026-08-31: "Just in needs to be better aligned"), which is the only
  // place that knows how wide the other badges actually are. A card's badges
  // must not be authored in two components: the one that does not own the
  // layout can only ever guess, and it guessed wrong at every width.
  // See the BADGE RAIL block in JobCard.tsx.

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-2xl"
      onPointerDownCapture={swipeLayer.start}
    >
      {Layer ? (
        <Layer.default
          surfaceRef={adoptSlot}
          held={held}
          onSwipeStart={() => setSwiping(true)}
          onSwipeEnd={() => setSwiping(false)}
          onHold={() => setHeld(true)}
          onApply={() => onApply(job.id)}
          onDismiss={() => onDismiss(job.id)}
        />
      ) : (
        <div ref={adoptSlot} className="relative z-10" />
      )}
      {/* After the host above, so the slot is in the document before JobCard's
          layout effects measure. */}
      {createPortal(
        <div style={{ pointerEvents: swiping || held ? "none" : "auto" }}>
          <JobCard
            job={job}
            effectiveFee={effectiveFee}
            currentUserId={currentUserId}
            showApply={showApply}
            onApply={onApply}
            onReport={onReport}
            onSelect={onSelect}
            index={index}
            isExpanded={isExpanded}
            onToggleExpand={onToggleExpand}
            isSaved={isSaved}
            onToggleSave={onToggleSave}
            userLat={userLat}
            userLng={userLng}
            recommended={recommended}
          />
        </div>,
        slot,
      )}
    </div>
  );
};

// Memoized so unrelated Dashboard state changes don't re-render every
// row of the feed. Effective only while BrowseTasksFeed passes
// referentially-stable props (stable callbacks + primitive per-card flags).
const MemoizedSwipeableJobCard = memo(SwipeableJobCard);
MemoizedSwipeableJobCard.displayName = "SwipeableJobCard";

export default MemoizedSwipeableJobCard;
