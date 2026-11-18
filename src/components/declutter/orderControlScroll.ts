/**
 * Where a Buying order card's Details opens to (DeclutterHandoverViews OrderCard). Split out to keep that file under
 * its size ratchet.
 */
/** Area 05 #20: the card actions whose control is the time picker (buyerNextAction's English names). */
export const BOOKING_ACTIONS = new Set(["Book a pickup time", "Pick a pickup time", "Book a time to meet"]);

/**
 * Opening Details scrolls to the next action's control. Area 05 #20 (design audit 11-18): "Book a pickup time" did
 * nothing visible: the Book button stays disabled until a time is picked (so the old selector skipped it) and the
 * seller's times load after the body opens. A booking action now waits (up to 3 s) for the picker itself
 * ([data-booking-picker], BookingPanel) and scrolls to it. Returns the cleanup.
 */
export function goToOrderControl(body: HTMLElement | null, booking: boolean): (() => void) | undefined {
  if (!body) return undefined;
  const scroll = (el: HTMLElement) => { el.scrollIntoView?.({ block: "center" }); el.focus({ preventScroll: true }); };
  if (!booking) {
    const go = body.querySelector<HTMLElement>(".btn-grad-primary:not([disabled]), input, select");
    if (go) scroll(go);
    return undefined;
  }
  const tryPicker = () => {
    const picker = body.querySelector<HTMLElement>("[data-booking-picker]");
    if (!picker) return false;
    scroll(picker);
    return true;
  };
  if (tryPicker() || typeof MutationObserver === "undefined") return undefined;
  const watch = new MutationObserver(() => { if (tryPicker()) stop(); });
  const timer = setTimeout(() => stop(), 3000);
  const stop = () => { watch.disconnect(); clearTimeout(timer); };
  watch.observe(body, { childList: true, subtree: true });
  return stop;
}
