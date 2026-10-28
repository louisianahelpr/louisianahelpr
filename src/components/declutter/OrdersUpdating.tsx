import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useIsFetching } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { isOrderQueryKey } from "@/lib/declutter/orderFreshness";

/** A read shorter than this shows no cue (a blink would be noise). */
const UPDATING_CUE_DELAY_MS = 400;

/**
 * "Updating…" while an order or money read is fetching again over data already on screen (Declutter deep audit #17:
 * old order state showed for 6 to 20 s with no cue). A first load shows its own skeleton, so it never counts. A small
 * pill fixed at the bottom of the page column, portaled to <body>, so it never pushes the list down or covers the tabs.
 */
export function OrdersUpdating() {
  const fetching = useIsFetching({ predicate: (q) => isOrderQueryKey(q.queryKey) && q.state.data !== undefined });
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!fetching) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), UPDATING_CUE_DELAY_MS);
    return () => clearTimeout(t);
  }, [fetching]);
  if (!shown || typeof document === "undefined") return null;
  return createPortal(
    // A full-width strip so data-rail-inset centres the pill in the page column at 1440 (index.css); on a phone it
    // sits where toasts sit, just above the dock, never over the tabs.
    <div data-rail-inset="" className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--safe-area-bottom,0px)+var(--bottom-nav-h,96px))] z-50 flex justify-center md:bottom-6">
      <p
        role="status"
        aria-live="polite"
        data-orders-updating=""
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-ds-12 font-medium text-muted-foreground shadow-sm"
      >
        <RefreshCw className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        Updating…
      </p>
    </div>,
    document.body,
  );
}
