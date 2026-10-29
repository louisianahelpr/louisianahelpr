import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/** The id of the Gift card tab's "Gift cards sent to you" block. */
export const GIFT_RECEIVED_ID = "gift-cards-received";
/** Where "See them" on Post a Job's gift banner goes: the received cards, not the send form above them. */
export const GIFT_RECEIVED_HREF = "/profile?tab=gift_card&show=received";

/**
 * "SEE THEM" SHOWS THE CARDS (audit 2026-10-29 A2-C26). Post a Job's "18 Helpr gift cards waiting for you · See them"
 * opened the Gift card tab at its top, the send-a-gift form; the cards waiting for the viewer sat below it, off the
 * first screen. With `?show=received` the tab scrolls to "Gift cards sent to you" once its list has loaded (once:
 * a later refetch never pulls the page back). Guard: src/test/giftBannerOpensReceived.test.tsx.
 */
export function useShowReceivedGifts(ready: boolean): void {
  const [params] = useSearchParams();
  const wanted = params.get("show") === "received";
  const done = useRef(false);
  useEffect(() => {
    if (!wanted || !ready || done.current) return;
    const el = document.getElementById(GIFT_RECEIVED_ID);
    if (!el) return;
    done.current = true;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView?.({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [wanted, ready]);
}
