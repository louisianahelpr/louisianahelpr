/** helpr_task_sweep's first "still not delivered" nudge (20261031014011): 24 hours after Picked up. */
const STILL_IN_HAND_MS = 24 * 3_600_000;

/**
 * LEAD-GOTIT30H: the Helpr has held the picked-up item 24 hours without marking it delivered, so the buyer may say they
 * got it (helpr_task_customer_confirm accepts picked_up only from then, 20261031082308). One rule for the card's chip and
 * action, the closed card's line and the open panel.
 */
export function heldPastADay(pickedUpAt: string | null | undefined, now: number = Date.now()): boolean {
  return !!pickedUpAt && now - new Date(pickedUpAt).getTime() >= STILL_IN_HAND_MS;
}

/**
 * BUY-37: what the buyer reads once a Helpr has held a picked-up item 24 hours without marking it delivered.
 * Null before then, when "on the way" is still true. One sentence for the closed card and the open panel.
 */
export function stillInHandLine(who: string, pickedUpAt: string | null | undefined): string | null {
  if (!pickedUpAt || !heldPastADay(pickedUpAt)) return null;
  const at = new Date(pickedUpAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${who} picked it up ${at} and hasn't marked it delivered. If you have it, tap "I got it". If not, report a problem. Your money stays held until then.`;
}
