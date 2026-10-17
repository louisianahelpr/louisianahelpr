/**
 * Declutter: every refusal the server can give, in plain words
 * (docs/specs/declutter-auctions.md, "For slice 2 (screens)": the UI must map
 * each slice-1 code, plus the slice-2 ones, plus the contact-leak message).
 *
 * The server RAISEs the code as the error MESSAGE (e.g. 'photos_required');
 * the contact-leak trigger raises a sentence (check_violation, 23514) that is
 * already written for the member, so it is shown as it is.
 *
 * EXACT: src/test/declutterErrorCopy.test.ts reads every RAISE EXCEPTION code
 * in the declutter migrations and fails on one that has no line here, and on a
 * line here no migration raises.
 */
export const DECLUTTER_ERROR_COPY: Record<string, string> = {
  feature_disabled: "Declutter isn't open for your account yet.",
  not_authenticated: "Please sign in again to continue.",
  account_restricted: "Your account is restricted, so Declutter is not available right now.",
  declutter_strikes_blocked:
    "You have 3 Declutter strikes, so Declutter is paused for you. It opens again when one of them expires.",
  under_18: "You must be 18 or older to buy or sell on Declutter.",
  payout_setup_incomplete: "Set up your payouts first, so we can pay you when your item sells.",
  photos_required: "Add at least 3 photos of the item (up to 12).",
  attestation_required: "Confirm the four statements about this item before you list it.",
  attestation_incomplete: "All four statements need a check before you can list this item.",
  pickup_windows_required: "Add at least one pickup time so buyers know when they can come.",
  invalid_pickup_windows: "Each pickup time needs a day, and a start time before its end time.",
  invalid_floor_price: "Your lowest price must be at least $1 and no more than your asking price.",
  invalid_location: "We couldn't find that pickup address. Check it and try again.",
  item_not_found: "This item isn't available.",
  item_not_a_draft: "This item has already been listed.",
  item_not_editable: "This item can't be changed now.",
  photo_not_uploaded: "That photo didn't finish uploading. Try adding it again.",
  photo_not_found: "That photo was already removed.",
  too_many_photos: "A listing can have up to 12 photos.",
  own_item: "This is your own item.",
  question_rate_limited: "You've asked a lot of questions today. Try again tomorrow.",
  question_not_found: "That question isn't available anymore.",
  sale_mode_unavailable: "Bidding isn't available yet. Items sell by offers for now.",
  area_looks_like_address: "Use your neighborhood or town for the area, not a street address.",
  not_admin: "Only an admin can do that.",
  invalid_decision: "Choose approve or reject.",
  review_note_required: "Say why the listing isn't approved, so the seller knows what to fix.",
  review_note_too_long: "Keep the reason under 500 characters.",
  item_not_pending: "This listing was already reviewed.",
  own_listing: "Another admin has to review your own listing.",
  seller_not_eligible: "This seller can't sell right now (account restricted, strikes, age or payouts). Reject it instead.",
  ai_check_stale: "The listing changed while it was being checked. Try again.",
  // Slice 3: offers, Buy, checkout, strikes (20261014210518).
  card_required: "Save a card first. It is never charged until you check out.",
  item_not_available: "Someone else got this item first.",
  invalid_offer_amount: "Offer less than the price. To pay the price, tap Buy.",
  offer_too_low: "Offers must be at least half the current price.",
  offer_already_open: "You already have an offer on this item. Change it under Offers.",
  offer_rate_limited: "You can make 3 offers a day on one item. Try again tomorrow.",
  invalid_action: "That can't be done to this offer.",
  offer_not_found: "That offer isn't available.",
  offer_not_open: "This offer is already closed.",
  not_your_turn: "Waiting for the other side to answer.",
  offer_expired: "This offer ran out of time.",
  other_side_unavailable: "The other side can't trade on Declutter right now, so this can't go ahead.",
  counter_same_amount: "That's the same amount. To agree to it, tap Accept.",
  price_changed: "The price changed. Check the new price and try again.",
  handover_unavailable: "Choose porch pickup, pickup at the seller's home, or Helpr delivery.",
  seller_tax_not_ready: "Checkout for this seller isn't available yet.",
  cart_empty: "Nothing from this seller is waiting for checkout.",
  // Row 101 porch default (20261017055504).
  porch_unavailable: "The seller asked to meet at their home for this item, so porch pickup isn't available. Choose pickup at the seller's home.",
  invalid_porch_choice: "Choose whether buyers can pick this item up from your porch.",
  order_not_payable: "This checkout is no longer open. Start checkout again.",
  no_sale_to_cancel: "There's no sale to cancel on this item.",
  sale_already_paid: "The buyer already paid. Contact support to cancel.",
  // Slice 4 (20261015042253): pickup, handover, porch, no-shows, problems, reviews, money queues.
  order_not_paid: "This sale isn't paid, so this can't be done.",
  problem_open: "A problem was reported on this sale. Louisiana Helpr will decide it before anyone is paid.",
  already_paid_out: "The seller was already paid for this sale.",
  invalid_slot: "Pick a time inside the seller's pickup times, before your 7-day pickup deadline.",
  reschedule_used: "You already moved this pickup once.",
  not_booked_yet: "The pickup time isn't booked yet. The buyer books it first.",
  not_a_porch_pickup: "This sale isn't a porch pickup.",
  invalid_porch_time: "Pick a time after the booked pickup, on the same day.",
  invalid_method: "Something went wrong with the handover. Please try again.",
  wrong_side: "Only the seller scans or types the code, and only the buyer taps \"I got it\".",
  location_required: "Turn on location so we can confirm you're at the pickup address.",
  not_at_pickup: "Take the photo at the pickup address.",
  already_picked_up: "The buyer already picked up this item.",
  seller_set_out: "The seller set the item out. If it isn't there, report a problem.",
  too_early: "You can report a no-show 15 minutes after the booked time.",
  sale_final: "The seller was paid, so this sale is final.",
  invalid_reason: "Pick what went wrong.",
  note_required: "Tell us what happened (up to 1,000 characters).",
  not_authorized: "Only Louisiana Helpr staff can do this.",
  problem_not_found: "That problem report wasn't found.",
  problem_already_decided: "This problem was already decided.",
  not_handed_over: "Reviews open after the handover.",
  invalid_stars: "Pick 1 to 5 stars.",
  comment_too_long: "Keep your review under 1,000 characters.",
  already_reviewed: "You already reviewed this sale.",
  review_contact_info: "Reviews can't include phone numbers, emails or links.",
  refund_amount_unknown: "We couldn't work out this refund. Louisiana Helpr will sort it out.",
  refund_not_found: "That refund wasn't found.",
  // Service-only (the webhook records a refund's Stripe mode); worded for the ops log.
  invalid_mode: "That refund's payment mode is missing.",
  refund_mode_conflict: "That refund was already recorded in the other payment mode.",
  invalid_transfer: "The payout couldn't be recorded. Please try again.",
  invalid_payout: "The payout couldn't be worked out. Please try again.",
  payout_not_found: "That payout wasn't found.",
  // Wanted posts + fair-price hint (20261016053541).
  invalid_wanted_text: "Say what you want in 3 to 60 letters, like \"crib\" or \"oak dresser\". No links or phone numbers.",
  invalid_category: "Pick a category.",
  invalid_max_price: "Set your highest price in whole dollars, $1 to $1,000.",
  invalid_radius: "Pick how far you'd go: 5, 10, 25 or 50 miles.",
  wanted_rate_limited: "You can post up to 5 wanted items a day. Try again tomorrow.",
  wanted_open_limit: "You have 10 wanted posts open. Close one to post another.",
  wanted_not_found: "That wanted post isn't available.",
  wanted_area_unknown: "We couldn't work out your area. Use your location, or add your ZIP code in your profile.",
  // Moving-out mode (20261016053625).
  invalid_move_out_date: "Pick a move-out date from today to 6 months from now.",
  invalid_items: "Something in that list didn't save. Check each item's name and price, then try again.",
  too_many_items: "Save 1 to 15 items at a time.",
  move_draft_limit: "You have 60 unfinished moving-sale items. List or delete some before you add more.",
  // Slice 5, Helpr delivery (20261017055505): delivery checkout, the Helpr's job, money queues.
  delivery_address_needed: "Enter the address to deliver to.",
  delivery_one_address: "These items are at different addresses, so they can't be delivered together. Choose pickup.",
  delivery_unavailable: "Helpr delivery isn't available for this order. Choose pickup.",
  delivery_order: "A Helpr is delivering this order and picks the pickup time.",
  delivery_not_done: "The Helpr hasn't picked the item up yet.",
  invalid_address: "Enter the full drop-off address: street number, street, and town.",
  order_handover_frozen: "How you get this order can't be changed after checkout.",
  order_amounts_frozen: "The amounts of this order can't be changed after checkout.",
  no_delivery_fee: "This order has no delivery fee to refund.",
  not_a_delivery_in_transit: "Only a delivery the Helpr picked up can be decided as damaged in delivery.",
  delivery_decision_needed: "The Helpr has this item. Decide it as damaged in delivery, or pay the seller.",
  task_not_found: "This delivery isn't available.",
  task_taken: "Another Helpr took this delivery, or it closed.",
  too_many_releases: "You backed out of or missed 3 deliveries this week. You can take new ones again in a few days.",
  too_many_taken: "Pick up one of your deliveries before you take another.",
  task_not_active: "This delivery isn't in progress.",
  own_task: "You can't deliver your own sale.",
  vehicle_too_small: "This item needs a truck (and a second person for extra large). Add your truck under Your vehicle.",
  invalid_vehicle: "A second person is only asked for with a truck.",
  vehicle_photo_required: "Add a photo of your truck.",
  not_picked_up_yet: "Take the \"Picked up\" photo first.",
  not_at_dropoff: "Take the photo at the drop-off address.",
  // Add a Helpr (20261017073146): the link is for the job just posted, before its checkout.
  job_already_funded: "This job is already paid for, so it can't be added to your Declutter purchase. It's under your posted jobs.",
  // A10 (20261017073146): the seller-fault cancel's hand tool and the seller's fee debt (staff and server only).
  not_seller_fault: "This refund was not the seller's fault, so the setup job keeps the normal cancel rules.",
  order_gone: "This order no longer exists, so its setup jobs have to be settled by hand.",
  invalid_fee: "That card fee amount isn't valid.",
  setup_job_not_cancelled: "The setup job could not be cancelled. Try again.",
  // Service-only (a source or the money cron); worded for the ops log.
  invalid_result: "That payout or refund result couldn't be recorded.",
  invalid_status: "That delivery can't be closed that way.",
  unknown_task_source: "That delivery's source isn't known.",
  // Haul-away (20261017070827): its words are in ./haulAwayErrors (loaded only with the haul-away code, Q178).
};

/**
 * Codes the APP or the declutter-ai-draft edge function raises (no migration
 * does). Kept apart so the two-way check against the migrations stays exact.
 */
export const DECLUTTER_CLIENT_ERROR_COPY: Record<string, string> = {
  ai_unavailable: "The photo tool isn't available right now. You can fill in the details yourself.",
  ai_photos_required: "Add at least one photo first, so the photo tool can see the item.",
  // The app's own timeout on the photo tool (AI_TIMEOUT_MS, api.ts).
  ai_timed_out: "The photo tool took too long. Try again, or fill in the details yourself.",
  // declutter-card / declutter-checkout (slice 3b) when no code came back.
  payment_unavailable: "The payment page isn't available right now. Please try again. Nothing was charged.",
  // declutter-ai-draft room mode (moving-out mode).
  room_photos_invalid: "Add 1 to 4 room photos. Use photos you took, not screenshots.",
  ai_rate_limited: "The photo tool needs a break. Wait a few minutes, then try again.",
  // declutter-checkout's delivery_quote (slice 5): the geocoder found no such address.
  address_not_found: "We couldn't find that address. Check the street number, street and town.",
  geocode_unavailable: "We couldn't look up addresses just now. Try again in a minute.",
  photo_unavailable: "That photo couldn't load. Try again.",
};

/**
 * A listing photo refused before upload (src/lib/declutter/photos.ts). Its
 * message is plain words this app wrote for the member, so
 * declutterErrorMessage shows it as it is.
 */
export class ListingPhotoError extends Error {}

const GENERIC = "Something went wrong. Please try again.";

/** The plain-words message for any error a Declutter call threw or returned. */
export function declutterErrorMessage(err: unknown): string {
  if (!err) return GENERIC;
  if (err instanceof ListingPhotoError && err.message) return err.message;
  const e = err as { message?: unknown; code?: unknown; userMessage?: unknown };
  // Set by src/lib/declutter/api.ts from RPC_ERROR_COPY at the call site.
  if (typeof e.userMessage === "string" && e.userMessage) return e.userMessage;
  const message = typeof e.message === "string" ? e.message.trim() : typeof err === "string" ? err.trim() : "";
  if (message && Object.prototype.hasOwnProperty.call(DECLUTTER_ERROR_COPY, message)) {
    return DECLUTTER_ERROR_COPY[message];
  }
  if (message && Object.prototype.hasOwnProperty.call(DECLUTTER_CLIENT_ERROR_COPY, message)) {
    return DECLUTTER_CLIENT_ERROR_COPY[message];
  }
  // The contact-leak filter (check_violation) speaks to the member already.
  // Other check_violations are table constraints written for developers.
  if (e.code === "23514" && /Keep contact details and payment (off the listing|out)/.test(message)) return message;
  if (e.code === "23514") return "Check the details: the title needs 3 to 80 characters and each field must be filled in.";
  return GENERIC;
}
