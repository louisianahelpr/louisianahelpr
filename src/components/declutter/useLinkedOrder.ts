/**
 * BUY-30 (2026-10-31): a notice about one order opens that order. The writer
 * (declutter_notify_strict, migration 20261031111949) adds &order=<id> to the
 * member's own tab link; Buying and Selling show that order's card even when a
 * chip or the finished-sales fold would hide it, scroll to it and open it.
 */
import { useEffect, useRef, type RefObject } from "react";
import { useSearchParams } from "react-router-dom";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The order a notice opened, or null. A just-paid return (?paid=1&order=) belongs to BoughtWhatNext's sheet. */
function linkedOrderId(params: URLSearchParams): string | null {
  if (params.get("paid")) return null;
  const id = params.get("order");
  return id && UUID.test(id) ? id : null;
}

export function useLinkedOrder(): string | null {
  const [params] = useSearchParams();
  return linkedOrderId(params);
}

/**
 * Q2660 (2026-11-02): an offer notice ("New offer", "New counteroffer") opens that offer. The writer
 * (declutter_notice_order_link, migration 20261102124421) adds &offer=<id> to the member's own tab link.
 */
export function useLinkedOffer(): string | null {
  const [params] = useSearchParams();
  const id = params.get("offer");
  return id && UUID.test(id) ? id : null;
}

/**
 * F157 (lab 11-09): how long the linked card is kept in place while the tab settles. Measured on prod at 1440, cold:
 * the card scrolled into view at once, then the offers and trades above it landed and pushed it out of sight (the
 * office-chair order ended off screen, focus on <body>).
 */
export const LINKED_ORDER_SETTLE_MS = 4000;

/**
 * Once per mount: the linked card opens (onOpen), scrolls into view and takes focus (keyboard and screen readers land
 * on it). Until the tab settles (LINKED_ORDER_SETTLE_MS) or the member scrolls, taps or types, a card that moves (what
 * loads above it) is scrolled back into view and keeps the focus.
 */
export function useScrollToLinkedOrder(ref: RefObject<HTMLElement>, linked: boolean, onOpen: () => void) {
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!linked || done.current || !el) return;
    done.current = true;
    onOpen();
    const place = () => {
      el.scrollIntoView?.({ block: "start" });
      const a = document.activeElement;
      if (a !== el && (!a || a === document.body)) el.focus({ preventScroll: true });
    };
    el.scrollIntoView?.({ block: "start" });
    el.focus({ preventScroll: true });
    let top = el.getBoundingClientRect().top;
    const started = Date.now();
    let frame = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      for (const ev of USER_MOVES) window.removeEventListener(ev, stop, true);
    };
    for (const ev of USER_MOVES) window.addEventListener(ev, stop, { capture: true, passive: true });
    const tick = () => {
      if (!el.isConnected || Date.now() - started > LINKED_ORDER_SETTLE_MS) return stop();
      const now = el.getBoundingClientRect().top;
      if (Math.abs(now - top) > 2) {
        place();
        top = el.getBoundingClientRect().top;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return stop;
  }, [linked, ref, onOpen]);
}

/** What the member does that ends the keep-in-place (their own scroll wins). */
const USER_MOVES = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
