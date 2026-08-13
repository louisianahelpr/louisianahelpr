import { memo, useState, type ReactNode } from "react";
import { motion, useMotionValue, useTransform, animate, useReducedMotion, type PanInfo } from "framer-motion";
import { Pin, PinOff, Archive } from "lucide-react";
import { hapticHeavy, hapticLight } from "@/lib/haptics";

interface SwipeableConversationRowProps {
  /** Composed conversation-row content — kept opaque so this wrapper
   *  owns nothing but the swipe gesture and the action trails. */
  children: ReactNode;
  /** Whether the row is currently pinned — flips the right-swipe action
   *  copy and icon ("Pin" ↔ "Unpin"). */
  isPinned: boolean;
  /** Fires when the user completes a left-swipe past the threshold. */
  onArchive: () => void;
  /** Fires when the user completes a right-swipe past the threshold. */
  onTogglePin: () => void;
}

// Pull distance at which an action fires. Past the threshold the row
// snaps back; the action is committed without the row sticking open.
const SWIPE_THRESHOLD = 90;

/**
 * SwipeableConversationRow — adds the inbox row's left/right swipe
 * gestures (archive / pin) without re-implementing the row itself.
 *
 * Left swipe past threshold → archive (calls `onArchive`).
 * Right swipe past threshold → toggle pin (calls `onTogglePin`).
 *
 * Mirrors the gesture pattern in `SwipeableJobCard` (the dashboard
 * dismiss-job swipe) so the inbox feels consistent with the rest of
 * the app: rubber-band drag, action trail with growing icon, single
 * haptic on commit. Both actions are commit-on-release: the row snaps
 * back so the fired callback owns the visual outcome (the row is
 * removed from the list on archive; the pinned chip reflows on pin).
 */
function SwipeableConversationRowBase({
  children,
  isPinned,
  onArchive,
  onTogglePin,
}: SwipeableConversationRowProps) {
  const reducedMotion = useReducedMotion();
  const x = useMotionValue(0);
  // Archive trail (left swipe → negative x): sienna gradient
  const archiveOpacity = useTransform(x, [-160, -40, 0], [1, 0.55, 0]);
  const archiveScale = useTransform(x, [-160, -80, 0], [1.15, 0.85, 0.5]);
  // Pin trail (right swipe → positive x). Was a gold-warm gradient; gold is
  // reserved for prestige (P1), so the trail now uses the bark accent below.
  const pinOpacity = useTransform(x, [0, 40, 160], [0, 0.55, 1]);
  const pinScale = useTransform(x, [0, 80, 160], [0.5, 0.85, 1.15]);
  const [dragging, setDragging] = useState(false);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const offset = info.offset.x;
    if (offset < -SWIPE_THRESHOLD) {
      hapticHeavy();
      onArchive();
    } else if (offset > SWIPE_THRESHOLD) {
      hapticHeavy();
      onTogglePin();
    }
    // Always snap back — the callbacks own any "row removed" / "row
    // moved to top" reflow. Snap before the next paint so the trail
    // doesn't linger after the row reaches its commit position.
    if (reducedMotion) { x.set(0); } else { animate(x, 0, { type: "spring", stiffness: 500, damping: 35 }); }
    setDragging(false);
  };

  // No rounding on the wrapper — rows are now a flat, contiguous iOS list,
  // so a rounded clip would round the active-row tint and the inset
  // hairline. `overflow-hidden` stays to clip the row's horizontal drag
  // (prevents any transient horizontal overflow during a swipe).
  return (
    <div className="relative overflow-hidden">
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
            background: "hsl(var(--burnt-sienna) / 0.14)",
            border: "0.5px solid hsl(var(--burnt-sienna) / 0.32)",
          }}
        >
          <Archive className="w-5 h-5" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={2.4} />
          <span
            className="text-ds-10 font-serif italic uppercase tracking-[0.18em]"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            Archive
          </span>
        </motion.div>
      </motion.div>

      {/* Pin trail (revealed by a right swipe). */}
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
            <PinOff className="w-5 h-5" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={2.4} />
          ) : (
            <Pin className="w-5 h-5" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={2.4} />
          )}
          <span
            className="text-ds-10 font-serif italic uppercase tracking-[0.18em]"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            {isPinned ? "Unpin" : "Pin"}
          </span>
        </motion.div>
      </motion.div>

      <motion.div
        style={{ x }}
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -180, right: 180 }}
        dragElastic={0.18}
        onDragStart={() => {
          hapticLight();
          setDragging(true);
        }}
        onDragEnd={handleDragEnd}
        className="relative z-10"
      >
        {/* Block taps mid-drag so a swipe never accidentally opens the
            conversation. Inner row regains pointer events on release. */}
        <div style={{ pointerEvents: dragging ? "none" : "auto" }}>
          {children}
        </div>
      </motion.div>
    </div>
  );
}

export const SwipeableConversationRow = memo(SwipeableConversationRowBase);
SwipeableConversationRow.displayName = "SwipeableConversationRow";
