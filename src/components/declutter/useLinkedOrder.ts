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

/** Once per mount: the linked card opens (onOpen), scrolls into view and takes focus. */
export function useScrollToLinkedOrder(ref: RefObject<HTMLElement>, linked: boolean, onOpen: () => void) {
  const done = useRef(false);
  useEffect(() => {
    if (!linked || done.current || !ref.current) return;
    done.current = true;
    onOpen();
    ref.current.scrollIntoView?.({ block: "start" });
    ref.current.focus({ preventScroll: true });
  }, [linked, ref, onOpen]);
}
