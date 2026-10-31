/**
 * BUY-38 (buying audit 10-30 #38): a delivery card told every Helpr "Exact addresses unlock when you accept", but a
 * Helpr with no finished delivery sees the drop-off only 2 hours before the booked pickup. The server's rule
 * (helpr_task_view / helpr_my_route via helpr_task_dropoff_shows_at, owner 2026-10-27, issue #3684): the pickup once
 * the delivery is theirs; the drop-off at once for a Helpr with a finished delivery, else 2 hours before the booked
 * pickup or after Picked up. One line for the open delivery card and the "On your way" suggestions.
 */
export const DELIVERY_ADDRESSES_SHOW =
  "The pickup address shows when you accept. The drop-off shows 2 hours before the pickup time, or at once after your first finished delivery.";
