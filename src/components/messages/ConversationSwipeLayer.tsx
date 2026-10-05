import type { ReactNode, Ref } from "react";
import { motion, useMotionValue, useTransform, animate, useReducedMotion, type PanInfo } from "framer-motion";
import { Pin, PinOff, Archive } from "lucide-react";
import { hapticHeavy, hapticLight } from "@/lib/haptics";

// Pull distance at which an action fires. Past the threshold the row
// snaps back; the action is committed without the row sticking open.
const SWIPE_THRESHOLD = 90;

/**
 * The swipe gesture of a SwipeableConversationRow: the archive and pin trails
 * and the draggable surface. This file is the inbox row's ONLY framer-motion
 * import, loaded behind `import("./ConversationSwipeLayer")` once the page has
 * settled or on the first touch of a row, so /messages draws its first frame
 * without the framer chunk (Q1299; the same split as SwipeMotionLayer, Q1172).
 * SwipeableConversationRow.tsx explains how the row's content survives the swap.
 */
export default function ConversationSwipeLayer({
  surfaceRef,
  isPinned,
  onArchive,
  onTogglePin,
  onDragStart,
  onDragEnd,
}: {
  /** Attaches the row content to the draggable surface. */
  surfaceRef: Ref<HTMLDivElement>;
  isPinned: boolean;
  onArchive: () => void;
  onTogglePin?: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}): ReactNode {
  const reducedMotion = useReducedMotion();
  const x = useMotionValue(0);
  // Archive trail (left swipe → negative x): sienna gradient
  const archiveOpacity = useTransform(x, [-160, -40, 0], [1, 0.55, 0]);
  const archiveScale = useTransform(x, [-160, -80, 0], [1.15, 0.85, 0.5]);
  // Pin trail (right swipe → positive x). Was a gold-warm gradient; gold is
  // reserved for prestige (P1), so the trail now uses the bark accent below.
  const pinOpacity = useTransform(x, [0, 40, 160], [0, 0.55, 1]);
  const pinScale = useTransform(x, [0, 80, 160], [0.5, 0.85, 1.15]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const offset = info.offset.x;
    if (offset < -SWIPE_THRESHOLD) {
      hapticHeavy();
      onArchive();
    } else if (offset > SWIPE_THRESHOLD && onTogglePin) {
      hapticHeavy();
      onTogglePin();
    }
    // Always snap back — the callbacks own any "row removed" / "row
    // moved to top" reflow. Snap before the next paint so the trail
    // doesn't linger after the row reaches its commit position.
    if (reducedMotion) { x.set(0); } else { animate(x, 0, { type: "spring", stiffness: 500, damping: 35 }); }
    onDragEnd();
  };

  return (
    <>
      {/* Archive trail (revealed by a left swipe). */}
      <motion.div
        className="absolute inset-y-0 right-0 flex items-center justify-end pr-5 rounded-2xl"
        style={{ opacity: archiveOpacity }}
        aria-hidden="true"
      >
        <motion.div
          className="flex flex-col items-center gap-1 px-3 py-2 rounded-ds-md"
          style={{
            scale: archiveScale,
            /* Tint and border stay burnt-sienna; the LABEL and ICON above use
               --danger-ink. A raw brand hue has no dark sibling, so on the dark
               canvas these read rgb(212,103,53) over their own tint and
               measured 3.5-3.7:1 at 10px — under AA, on the only thing telling
               you what the swipe you are mid-way through will do. Same fix as
               the SOS chip and the job feed's "Not interested". */
            background: "hsl(var(--burnt-sienna) / 0.14)",
            border: "0.5px solid hsl(var(--burnt-sienna) / 0.32)",
          }}
        >
          <Archive className="w-5 h-5" style={{ color: "hsl(var(--danger-ink))" }} strokeWidth={2.4} />
          <span
            className="text-ds-10 font-sans uppercase tracking-[0.18em]"
            style={{ color: "hsl(var(--danger-ink))" }}
          >
            Archive
          </span>
        </motion.div>
      </motion.div>

      {/* Pin trail (revealed by a right swipe). */}
      {onTogglePin && (
      <motion.div
        className="absolute inset-y-0 left-0 flex items-center justify-start pl-5 rounded-2xl"
        style={{ opacity: pinOpacity }}
        aria-hidden="true"
      >
        <motion.div
          className="flex flex-col items-center gap-1 px-3 py-2 rounded-ds-md"
          style={{
            scale: pinScale,
            background: "hsl(var(--burnt-sienna) / 0.18)",
            border: "0.5px solid hsl(var(--burnt-sienna) / 0.42)",
          }}
        >
          {isPinned ? (
            <PinOff className="w-5 h-5" style={{ color: "hsl(var(--danger-ink))" }} strokeWidth={2.4} />
          ) : (
            <Pin className="w-5 h-5" style={{ color: "hsl(var(--danger-ink))" }} strokeWidth={2.4} />
          )}
          <span
            className="text-ds-10 font-sans uppercase tracking-[0.18em]"
            style={{ color: "hsl(var(--danger-ink))" }}
          >
            {isPinned ? "Unpin" : "Pin"}
          </span>
        </motion.div>
      </motion.div>
      )}

      <motion.div
        ref={surfaceRef}
        style={{ x }}
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -180, right: onTogglePin ? 180 : 0 }}
        dragElastic={0.18}
        onDragStart={() => {
          hapticLight();
          onDragStart();
        }}
        onDragEnd={handleDragEnd}
        className="relative z-10"
      />
    </>
  );
}
