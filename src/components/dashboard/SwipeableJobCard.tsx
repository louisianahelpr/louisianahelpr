import { memo, useState, useRef, useEffect } from "react";
import { motion, useMotionValue, useTransform, animate, PanInfo } from "framer-motion";
import { X } from "lucide-react";
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
  dismissPending?: boolean;
  index?: number;
  isExpanded?: boolean;
  onToggleExpand?: (jobId: string) => void;
  isSaved?: boolean;
  onToggleSave?: (jobId: string, saved: boolean) => void;
  /** Viewer's cached location — forwarded to JobCard for the distance pill. */
  userLat?: number | null;
  userLng?: number | null;
  /** Long-press handler — forwarded to JobCard for the quick-action sheet. */
  onLongPress?: (jobId: string) => void;
  /** Marks this as a top recommended pick — forwarded to JobCard's pill. */
  recommended?: boolean;
}

const SWIPE_THRESHOLD = -100;

const SwipeableJobCard = ({
  job,
  effectiveFee,
  currentUserId,
  showApply,
  onApply,
  onReport,
  onSelect,
  onDismiss,
  dismissPending,
  index,
  isExpanded,
  onToggleExpand,
  isSaved,
  onToggleSave,
  userLat = null,
  userLng = null,
  onLongPress,
  recommended = false,
}: SwipeableJobCardProps) => {
  const x = useMotionValue(0);
  const backgroundOpacity = useTransform(x, [-150, -50, 0], [1, 0.6, 0]);
  const iconScale = useTransform(x, [-150, -80, 0], [1.2, 0.8, 0.5]);
  const [swiping, setSwiping] = useState(false);
  const [held, setHeld] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // When dismiss is cancelled (dialog closed without confirming), snap back
  useEffect(() => {
    if (!dismissPending && held) {
      animate(x, 0, { type: "spring", stiffness: 500, damping: 30 });
      setHeld(false);
    }
  }, [dismissPending, held]);

  const handleDragEnd = (_: any, info: PanInfo) => {
    if (info.offset.x < SWIPE_THRESHOLD) {
      // Hold in swiped position, show confirm dialog
      animate(x, -120, { type: "spring", stiffness: 500, damping: 30 });
      setHeld(true);
      onDismiss(job.id);
    } else {
      animate(x, 0, { type: "spring", stiffness: 500, damping: 30 });
    }
    setSwiping(false);
  };

  // "Just in" pulsing dot for jobs posted in the last 30 minutes — gives
  // browsing helprs a live signal that the marketplace is active.
  const isJustIn = (() => {
    const createdRaw = job.created_at;
    if (!createdRaw) return false;
    const ageMs = Date.now() - new Date(createdRaw).getTime();
    return ageMs > 0 && ageMs < 30 * 60 * 1000;
  })();

  return (
    <div ref={containerRef} className="relative overflow-hidden rounded-2xl">
      {/* "Just in" freshness pill — surfaces on jobs posted in the last
          30 min so browsing helprs see the feed is live, not stale.
          Positioned top-left (offset past the category tab) so it never
          overlaps the price chip in the top-right corner.
          pointer-events-none since SwipeableJobCard owns the drag gesture. */}
      {isJustIn && (
        <span
          aria-label="Just posted"
          className="absolute top-2 left-20 z-20 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full pointer-events-none"
          style={{
            background: "hsl(var(--burnt-sienna) / 0.10)",
            border: "0.5px solid hsl(var(--burnt-sienna) / 0.28)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{
              background: "hsl(var(--burnt-sienna))",
              boxShadow: "0 0 6px hsl(var(--burnt-sienna) / 0.55)",
            }}
            aria-hidden
          />
          <span
            className="text-[0.62rem] font-serif italic uppercase tracking-[0.16em]"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            Just in
          </span>
        </span>
      )}
      {/* Swipe-to-dismiss trail — gradient deepens from the right edge as
          you pull left, so you feel the action growing rather than just
          a flat tinted background. */}
      <motion.div
        className="absolute inset-0 rounded-2xl"
        style={{
          opacity: backgroundOpacity,
          background:
            "linear-gradient(to right, transparent 0%, hsl(var(--burnt-sienna) / 0.04) 40%, hsl(var(--burnt-sienna) / 0.16) 100%)",
        }}
      />
      {/* Swipe-reveal underlay. Purely decorative for the mobile
          swipe-to-dismiss gesture — announced by screen readers as
          "NOT INTERESTED" between every job card (Chrome-drove
          /dashboard 2026-07-08 → real defect), and desktop users
          can never trigger the gesture at all. `aria-hidden` so the
          a11y tree stays focused on the JobCard's real action set. */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-y-0 right-0 flex items-center justify-end pr-5 rounded-2xl"
        style={{ opacity: backgroundOpacity }}
      >
        <motion.div
          className="flex flex-col items-center gap-1 px-3 py-2 rounded-ds-md"
          style={{
            scale: iconScale,
            background: "hsl(var(--burnt-sienna) / 0.15)",
            border: "0.5px solid hsl(var(--burnt-sienna) / 0.35)",
          }}
        >
          <X className="w-5 h-5" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={2.5} />
          <span
            className="text-[0.62rem] font-serif italic uppercase tracking-[0.18em]"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            Not interested
          </span>
        </motion.div>
      </motion.div>

      <motion.div
        style={{ x }}
        drag={held ? false : "x"}
        dragConstraints={{ left: -160, right: 0 }}
        dragElastic={0.1}
        onDragStart={() => setSwiping(true)}
        onDragEnd={handleDragEnd}
        className="relative z-10"
      >
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
            onLongPress={onLongPress}
            recommended={recommended}
          />
        </div>
      </motion.div>
    </div>
  );
};

// Memoized so unrelated Dashboard state changes don't re-render every
// row of the feed. Effective only while BrowseTasksFeed passes
// referentially-stable props (stable callbacks + primitive per-card flags).
const MemoizedSwipeableJobCard = memo(SwipeableJobCard);
MemoizedSwipeableJobCard.displayName = "SwipeableJobCard";

export default MemoizedSwipeableJobCard;
