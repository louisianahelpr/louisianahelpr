import { memo, useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createLazyModule } from "@/lib/lazyModule";
import { whenPageSettled } from "@/lib/routePrefetch";

interface SwipeableConversationRowProps {
  /** Composed conversation-row content — kept opaque so this wrapper
   *  owns nothing but the swipe gesture and the action trails. */
  children: ReactNode;
  /** Whether the row is currently pinned — flips the right-swipe action
   *  copy and icon ("Pin" ↔ "Unpin"). */
  isPinned: boolean;
  /** Fires when the user completes a left-swipe past the threshold. */
  onArchive: () => void;
  /** Fires when the user completes a right-swipe past the threshold.
   *  Omitted = the row cannot be pinned (a deleted-account thread, Q335):
   *  no pin trail, and the row only drags left. */
  onTogglePin?: () => void;
}

/**
 * framer-motion rides this row's swipe gesture only (ConversationSwipeLayer),
 * and that chunk is fetched once the page has settled, or on the first touch
 * of a row, not before /messages' first draw (Q1299: it was the last
 * framer-motion import on the Messages route closure,
 * check-deferred-vendors.mjs KNOWN_ROUTE_CLOSURE_VIOLATIONS). Until it arrives
 * the row is its content in a plain `relative z-10` div: the trails are
 * invisible at rest, so the first frame is the same.
 *
 * THE CONTENT MUST NOT REMOUNT when the layer arrives (the same rule and the
 * same fix as SwipeableJobCard, Q1172): React remounts a subtree whose parent
 * element type changes, `div` -> `motion.div`, so the row is portaled into one
 * DOM node (`slot`, `display: contents`) that React never recreates, and the
 * host that currently stands in for the surface adopts that node by its ref.
 *
 * Left swipe past threshold → archive (calls `onArchive`).
 * Right swipe past threshold → toggle pin (calls `onTogglePin`).
 */
const swipeLayer = createLazyModule(
  () => import("./ConversationSwipeLayer"),
  "SwipeableConversationRow.loadSwipeLayer",
);

let swipeLayerScheduled = false;
/** One page-settle watch for the whole inbox, not one per row. */
function scheduleSwipeLayer() {
  if (swipeLayerScheduled) return;
  swipeLayerScheduled = true;
  whenPageSettled(swipeLayer.start);
}

function SwipeableConversationRowBase({
  children,
  isPinned,
  onArchive,
  onTogglePin,
}: SwipeableConversationRowProps) {
  const Layer = swipeLayer.use();
  const [dragging, setDragging] = useState(false);
  useEffect(scheduleSwipeLayer, []);
  const [slot] = useState(() => {
    const el = document.createElement("div");
    el.style.display = "contents";
    return el;
  });
  const adoptSlot = useCallback((el: HTMLDivElement | null) => {
    if (el) el.appendChild(slot);
  }, [slot]);

  // No rounding on the wrapper — rows are now a flat, contiguous iOS list,
  // so a rounded clip would round the active-row tint and the inset
  // hairline. `overflow-hidden` stays to clip the row's horizontal drag
  // (prevents any transient horizontal overflow during a swipe).
  return (
    <div className="relative overflow-hidden" onPointerDownCapture={swipeLayer.start}>
      {Layer ? (
        <Layer.default
          surfaceRef={adoptSlot}
          isPinned={isPinned}
          onArchive={onArchive}
          onTogglePin={onTogglePin}
          onDragStart={() => setDragging(true)}
          onDragEnd={() => setDragging(false)}
        />
      ) : (
        <div ref={adoptSlot} className="relative z-10" />
      )}
      {/* After the host above, so the slot is in the document before the
          row's layout effects measure. Block taps mid-drag so a swipe never
          accidentally opens the conversation. */}
      {createPortal(
        <div style={{ pointerEvents: dragging ? "none" : "auto" }}>{children}</div>,
        slot,
      )}
    </div>
  );
}

export const SwipeableConversationRow = memo(SwipeableConversationRowBase);
SwipeableConversationRow.displayName = "SwipeableConversationRow";
