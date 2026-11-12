/**
 * Seller delivery's refusals in English (F260q), keyed by CODE: sd.<code> = sellerDeliveryErrors.ts
 * SELLER_DELIVERY_ERROR_COPY, sd.d.<name> = its delivery wording D. English is NOT read from here at runtime (the tables
 * stay the English); these keys exist so esSellerDeliveryErrors.ts (es.ts only) has a key per line.
 * sellerDeliveryErrorsInSpanish.test.ts holds every key equal to the table.
 */
import { addEnglish } from "./enRegistry";

export const enSellerDeliveryErrors = {
  "sd.invalid_delivery_setting": "Choose whether you deliver, then save.",
  "sd.invalid_delivery_rate": "Deliver for free, or pick a whole-dollar delivery rate from $5 to $150.",
  "sd.invalid_free_delivery_amount": "Pick a whole-dollar amount from $1 to $10,000 for free delivery, or turn it off.",
  "sd.invalid_delivery_distance": "Pick one of the distances shown.",
  "sd.invalid_delivery_windows": "Each delivery time needs a day, and a start at least an hour before its end, with no repeats.",
  "sd.invalid_days_off": "Pick up to 60 days off within the next year.",
  "sd.delivery_out_of_range": "This seller doesn't deliver that far. Choose pickup or another delivery.",
  "sd.seller_delivery_unavailable": "This seller can't deliver these items. Choose another way to get them.",
  "sd.slot_unavailable": "That delivery time was just taken or is no longer open. Pick another time.",
  "sd.not_a_seller_delivery": "This sale isn't a delivery by the seller.",
  "sd.before_delivery_time": "You can mark it delivered from the booked delivery time.",
  "sd.seller_delivered": "The seller marked it delivered with a photo. If something is wrong, report a problem.",
  "sd.not_reschedulable": "This delivery can't be moved now.",
  "sd.no_proposal": "There's no new time waiting for an answer.",
  "sd.invalid_handoff": "Choose \"Leave it at my door\" or \"Hand it to me\".",
  "sd.cancel_window_closed": "It's less than 24 hours to the delivery, so you can't cancel now. Report a problem if something is wrong.",
  "sd.paid_order_not_cancellable": "A paid order can't be cancelled. You can ask for a new delivery time once, or report a problem.",
  "sd.d.not_booked_yet": "The delivery time isn't booked yet.",
  "sd.d.too_early": "You can say it wasn't delivered 15 minutes after the delivery time ends.",
  "sd.d.wrong_side_delivered": "Only the seller marks it delivered.",
  "sd.d.wrong_side_not_delivered": "Only the buyer can say it wasn't delivered.",
  "sd.d.wrong_side_accept": "The other side accepts the time you asked for.",
  "sd.d.reschedule_used": "You can't ask for another new time on this order.",
  "sd.d.location_required_buyer": "Turn on location so we can confirm you're at the buyer's address.",
  "sd.d.not_at_dropoff_buyer": "Take the photo at the buyer's address.",
  "sd.d.handoff_delivered": "The seller already marked it delivered, so this can't be changed now.",
  "sd.d.handoff_wrong_side": "Only the buyer chooses how the delivery is handed over.",
} as const;

addEnglish(enSellerDeliveryErrors);
