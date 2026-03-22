import { useState, useRef } from "react";
import { motion, useMotionValue, useTransform, PanInfo } from "framer-motion";
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
  index?: number;
  isExpanded?: boolean;
  onToggleExpand?: (jobId: string) => void;
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
  index,
  isExpanded,
  onToggleExpand,
}: SwipeableJobCardProps) => {
  const x = useMotionValue(0);
  const backgroundOpacity = useTransform(x, [-150, -50, 0], [1, 0.6, 0]);
  const iconScale = useTransform(x, [-150, -80, 0], [1.2, 0.8, 0.5]);
  const [swiping, setSwiping] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDragEnd = (_: any, info: PanInfo) => {
    if (info.offset.x < SWIPE_THRESHOLD) {
      onDismiss(job.id);
    }
    setSwiping(false);
  };

  return (
    <div ref={containerRef} className="relative overflow-hidden rounded-2xl">
      {/* Background reveal on swipe */}
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

      {/* Draggable card */}
      <motion.div
        style={{ x }}
        drag="x"
        dragConstraints={{ left: -160, right: 0 }}
        dragElastic={0.1}
        onDragStart={() => setSwiping(true)}
        onDragEnd={handleDragEnd}
        className="relative z-10"
      >
        <div style={{ pointerEvents: swiping ? "none" : "auto" }}>
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
