import type { ReactNode, Ref } from "react";
import { motion, useMotionValue, useTransform, animate, useReducedMotion, type PanInfo } from "framer-motion";
import { Send, X } from "lucide-react";

/**
 * The swipe gesture of a SwipeableJobCard: the two reveal trails, their
 * underlays, and the draggable surface. This file is the card's ONLY
 * framer-motion import, loaded behind `import("./SwipeMotionLayer")` once the
 * page has settled, so /home draws its first frame without the framer chunk
 * (Q1172). SwipeableJobCard.tsx explains how the card's content survives the
 * swap.
 */

const DISMISS_THRESHOLD = -100;
// Owner, 2026-08-30: right = Apply, left = Not interested — the Tinder/Mail
// convention (right = positive/accept), mirroring the LEFT dismiss gesture
// that already existed rather than a new invented direction.
const APPLY_THRESHOLD = 100;

export default function SwipeMotionLayer({
  surfaceRef,
  held,
  onSwipeStart,
  onSwipeEnd,
  onHold,
  onApply,
  onDismiss,
}: {
  /** Attaches the card content to the draggable surface. */
  surfaceRef: Ref<HTMLDivElement>;
  held: boolean;
  onSwipeStart: () => void;
  onSwipeEnd: () => void;
  onHold: () => void;
  onApply: () => void;
  onDismiss: () => void;
}): ReactNode {
  const reducedMotion = useReducedMotion();
  const x = useMotionValue(0);
  const backgroundOpacity = useTransform(x, [-150, -50, 0], [1, 0.6, 0]);
  const iconScale = useTransform(x, [-150, -80, 0], [1.2, 0.8, 0.5]);
  // Right-swipe (Apply) trail — mirrors the left/dismiss transforms above.
  const applyBackgroundOpacity = useTransform(x, [0, 50, 150], [0, 0.6, 1]);
  const applyIconScale = useTransform(x, [0, 80, 150], [0.5, 0.8, 1.2]);

  // All 4 snap-back animations below use a FIXED-duration tween (was
  // spring physics, same stiffness/damping everywhere) — a spring's settle
  // time is proportional to how far it has to travel, so two cards
  // released after different drag distances visibly finished at different
  // real times even though both used identical spring params (owner,
  // 2026-08-31: "the jobs have different transition. they open at
  // different times. this should not be happening"). A fixed duration
  // makes every card settle in exactly 220ms regardless of drag distance.
  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.x < DISMISS_THRESHOLD) {
      // Hold in swiped position — the dismiss is immediate (toast+Undo, no
      // confirm dialog), so the card just stays swiped-out until the parent
      // re-renders without it a moment later.
      if (reducedMotion) { x.set(-120); } else { animate(x, -120, { type: "tween", duration: 0.22, ease: "easeOut" }); }
      onHold();
      onDismiss();
    } else if (info.offset.x > APPLY_THRESHOLD) {
      // Apply has its own confirm flow (handleApplyRequest opens the confirm
      // dialog) — the card just snaps back rather than holding, since
      // nothing here needs to stay swiped while that dialog is open.
      if (reducedMotion) { x.set(0); } else { animate(x, 0, { type: "tween", duration: 0.22, ease: "easeOut" }); }
      onApply();
    } else {
      if (reducedMotion) { x.set(0); } else { animate(x, 0, { type: "tween", duration: 0.22, ease: "easeOut" }); }
    }
    onSwipeEnd();
  };

  return (
    <>
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
      {/* Swipe-to-apply trail — the mirror, deepening from the left edge as
          you pull right. */}
      <motion.div
        className="absolute inset-0 rounded-2xl"
        style={{
          opacity: applyBackgroundOpacity,
          background:
            "linear-gradient(to left, transparent 0%, hsl(var(--bark) / 0.04) 40%, hsl(var(--bark) / 0.16) 100%)",
        }}
      />
      {/* Swipe-reveal underlay. Purely decorative for the mobile
          swipe-to-dismiss gesture — announced by screen readers as
          "NOT INTERESTED" between every job card (Chrome-drove
          /home 2026-07-08 → real defect), and desktop users
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
          {/* --danger-ink, not raw --burnt-sienna: the brand hue has no dark
              sibling, so on the dark canvas this label resolved to
              rgb(212,103,53) over its own 0.15 tint and measured 3.68:1 at
              10px — under AA, on the only thing telling the user what the
              swipe they are mid-way through will do. Same fix, same reason, as
              the SOS chip. Tint and border unchanged. */}
          <X className="w-5 h-5" style={{ color: "hsl(var(--danger-ink))" }} strokeWidth={2.5} />
          <span
            className="text-ds-10 font-sans uppercase tracking-[0.18em]"
            style={{ color: "hsl(var(--danger-ink))" }}
          >
            Not interested
          </span>
        </motion.div>
      </motion.div>

      {/* Swipe-right-reveal underlay — Apply, the mirror of the dismiss
          underlay above. Same reasons for `aria-hidden` + `pointer-events`
          handling apply: purely decorative, the real Apply action already
          exists on the card itself (JobCard's own button / tap-through). */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 flex items-center justify-start pl-5 rounded-2xl"
        style={{ opacity: applyBackgroundOpacity }}
      >
        <motion.div
          className="flex flex-col items-center gap-1 px-3 py-2 rounded-ds-md"
          style={{
            scale: applyIconScale,
            background: "hsl(var(--bark) / 0.15)",
            border: "0.5px solid hsl(var(--bark) / 0.35)",
          }}
        >
          <Send className="w-5 h-5" style={{ color: "hsl(var(--bark))" }} strokeWidth={2.5} />
          <span
            className="text-ds-10 font-sans uppercase tracking-[0.18em]"
            style={{ color: "hsl(var(--bark))" }}
          >
            Apply
          </span>
        </motion.div>
      </motion.div>

      <motion.div
        ref={surfaceRef}
        style={{ x }}
        drag={held ? false : "x"}
        dragConstraints={{ left: -160, right: 160 }}
        dragElastic={0.1}
        onDragStart={onSwipeStart}
        onDragEnd={handleDragEnd}
        className="relative z-10"
      />
    </>
  );
}
