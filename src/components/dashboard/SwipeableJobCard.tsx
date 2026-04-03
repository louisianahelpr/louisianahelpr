import { useState, useRef, useEffect } from "react";
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

  return (
    <div ref={containerRef} className="relative overflow-hidden rounded-2xl">
      <motion.div
        className="absolute inset-0 flex items-center justify-end pr-6 rounded-2xl bg-destructive/10"
        style={{ opacity: backgroundOpacity }}
      >
        <motion.div
          className="flex flex-col items-center gap-1"
          style={{ scale: iconScale }}
        >
          <X className="w-6 h-6 text-destructive" />
          <span className="text-xs font-semibold text-destructive">Not Interested</span>
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
          />
        </div>
      </motion.div>
    </div>
  );
};

export default SwipeableJobCard;
