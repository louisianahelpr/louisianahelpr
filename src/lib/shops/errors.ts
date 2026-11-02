/**
 * Shops: every refusal the server can give, in plain words
 * (docs/specs/local-shops-prep.md; migration 20261017061155_shops_profiles).
 *
 * The server RAISEs the code as the error MESSAGE (e.g. 'invalid_category');
 * the contact-leak trigger raises a sentence (check_violation, 23514) already
 * written for the member, so it is shown as it is.
 *
 * EXACT: src/test/shopsProfiles.test.ts reads every RAISE EXCEPTION code in the
 * shops migrations (slice 1, slice 2's 20261017061157_shops_items and M1's
 * 20261018164442_shops_orders_checkout) and
 * fails on one with no line here, and on a line here no shops migration raises.
 */
import { ListingPhotoError } from "@/lib/declutter/errors";

export const SHOPS_ERROR_COPY: Record<string, string> = {
  feature_disabled: "Shops isn't open for your account yet.",
  not_authenticated: "Please sign in again to continue.",
  account_restricted: "Your account is restricted, so Shops is not available right now.",
  under_18: "You must be 18 or older to have a shop.",
  shop_strikes_blocked:
    "You have 3 Shops strikes, so Shops is paused for you. It opens again when one of them expires.",
  payout_setup_incomplete: "Set up your payouts first. Opening a shop needs payout setup, which includes an ID check.",
  invalid_name: "Give your shop a name of 2 to 60 characters.",
  about_too_long: "Keep the About section under 2,000 characters.",
  invalid_area: "Add your town or neighborhood (2 to 80 characters).",
  invalid_category: "Pick a category from the list.",
  invalid_location: "We couldn't place that area in Louisiana. Check the town and try again.",
  invalid_parishes: "Pick the parishes you serve from the list.",
  offers_required: "Choose what your shop offers: selling, quotes, or both.",
  invalid_sos_number: "Check the Secretary of State number: letters, numbers and dashes only.",
  area_looks_like_address: "Use your town or neighborhood for the area, not a street address.",
  shop_not_found: "This shop isn't available.",
  // One neutral line for every write it is mapped to (item writes, FAQs and closing; lead 2026-10-19).
  shop_hidden: "This shop is hidden by Louisiana Helpr right now, so it can't be changed. Contact support.",
  invalid_hours: "Each time needs a day, and an opening time before its closing time.",
  invalid_faqs: "Each question needs 3 to 140 characters and an answer of up to 600, with at most 10 questions.",
  invalid_paused: "Choose whether the shop is open or paused.",
  invalid_photo_kind: "Choose where the photo goes: logo, cover, or gallery.",
  photo_not_uploaded: "That photo didn't finish uploading. Try adding it again.",
  too_many_photos: "A shop can have up to 12 gallery photos.",
  photo_already_attached: "That photo is already on your shop.",
  photo_not_found: "That photo was already removed.",
  own_shop: "This is your own shop.",
  invalid_follow: "Choose follow or unfollow.",
  not_admin: "Only an admin can do that.",
  hide_reason_required: "Say why the shop is hidden, so its owner knows what to fix.",
  invalid_hidden: "Choose hide or show.",
  // Slice 2: items (20261017061157_shops_items).
  rental_not_available: "Renting things out is coming later. For now, list things you made or grew.",
  invalid_kind: "Choose what kind of item this is: made by you, home-kitchen food, or from your farm.",
  invalid_subtype:
    "Pick a type from the list. Some things can't be sold in Shops yet: plate lunches and other foods that need a health permit, plants, children's items, and soap or lotion.",
  invalid_title: "Give the item a title of 3 to 80 characters.",
  description_too_long: "Keep the description under 2,000 characters.",
  invalid_price: "Set a price from $1 to $1,000.",
  invalid_lead_time: "Set how many days you need, from 0 (same day) to 60.",
  invalid_stock: "Set how many you have ready, from 0 to 9,999, or leave it blank if you make each order.",
  item_not_found: "This item isn't available.",
  shop_not_selling: "Turn on selling for your shop first (My shop, What your shop offers).",
  too_many_items: "A shop can list up to 100 items. Take one down to add another.",
  item_not_editable: "This item can't be changed any more.",
  invalid_daily_cap: "Set the most orders you take a day, from 1 to 200, or leave it blank.",
  attestation_incomplete: "Tick every statement for this kind of item.",
  item_not_a_draft: "This item is already listed or waiting for a review.",
  order_days_required: "Add the days your shop fills orders (your opening hours) first.",
  photos_required: "Add at least 3 photos (up to 12).",
  attestation_required: "Tick the statements for this item first.",
  cottage_confirmation_required: "Confirm this year's home-kitchen sales are under the state limit first.",
  cottage_cap_reached:
    "You've reached this year's limit for home-kitchen food sales, so new home-kitchen items can't be listed until January.",
  ai_check_stale: "The item changed while the photo check was running. Try again.",
  invalid_decision: "Choose approve or reject.",
  review_note_required: "Say why the item is not approved, so its owner knows what to fix.",
  review_note_too_long: "Keep the reason under 500 characters.",
  item_not_pending: "This item is no longer waiting for a review.",
  item_changed: "The owner changed this item after you opened it. Reload the list and review it again.",
  own_item: "Another admin must review your own item.",
  owner_not_eligible:
    "This shop can't sell right now (restricted, strikes, age, payouts, hidden, or at the home-food limit). Reject it instead.",
  // M1: orders and the card hold (20261018164442_shops_orders_checkout).
  shop_paused: "This shop is taking a break and isn't taking new orders right now.",
  invalid_order_lines: "Pick 1 to 20 items, each one once, with how many you want.",
  invalid_quantity: "Order 1 to 20 of each item.",
  item_unavailable: "An item in this order isn't listed any more. Take it out and try again.",
  out_of_stock: "There aren't enough of an item left for this order. Lower the number and try again.",
  invalid_note: "Keep the note under 500 characters.",
  ready_date_too_soon: "That date is too soon for these items. Pick a later day.",
  ready_date_too_far: "Pick a date in the next 90 days.",
  shop_closed_that_day: "The shop doesn't fill orders on that day. Pick another day.",
  day_full: "That day is full. Pick another day.",
  cottage_limit_reached:
    "This home kitchen has reached its yearly sales limit, so home-kitchen food can't be ordered or accepted this year.",
  order_not_found: "This order isn't available.",
  order_not_open: "This order isn't waiting for an answer any more.",
  order_expired: "The 24 hours to accept this order have passed, so it dropped. Nothing was charged.",
  order_accepted: "The shop already accepted this order, so its cancel policy applies.",
  buyer_unavailable: "This order can't be accepted any more. Decline it so the buyer's card hold is released.",
  // Q345: a block between the two since the order was sent (never says who blocked).
  applicant_blocked: "This order can't be accepted any more. Decline it so the buyer's card hold is released.",
  invalid_cancel_policy: "Pick one of the three cancel policies.",
  invalid_ready_tap_cancel: "Pick one of the three choices for marking an order ready early.",
  ready_tap_cancel_frozen: "An order keeps the cancel rule it was placed under.",
  // M2 (20261018211820): the handover.
  invalid_handover_mode: "Pick how buyers get their orders: in person or left out.",
  order_not_charged_yet: "The buyer's card isn't charged yet. Try again in a few minutes.",
  problem_open: "The buyer reported a problem with this order. Louisiana Helpr looks at it before anyone is paid.",
  handover_mode_frozen: "An order keeps the pickup way it was placed under.",
  invalid_method: "That action isn't available. Reload the page and try again.",
  invalid_transfer: "We couldn't send this payout just now. We'll try again.",
  payout_not_found: "This payout isn't available.",
  invalid_reason: "Keep the reason under 200 characters.",
  shop_has_open_orders: "Finish or decline your open orders before closing your shop.",
  too_many_order_requests: "You've started a lot of orders in the last hour. Wait a while and try again.",
  // M1b part 2 (20261018210400): the private pickup address.
  invalid_pickup_address: "Enter the street and city where buyers pick up.",
  pickup_address_not_in_louisiana: "Enter a Louisiana ZIP code. Shops are for Louisiana pickups only.",
  pickup_address_missing: "This shop isn't taking orders yet. It still needs to add its pickup address.",
  pickup_address_unusable: "This shop's pickup address needs fixing before it can take orders. Try again later.",
  // Service steps: a member only meets these through shop-checkout, which answers "try again".
  invalid_payment: "We couldn't open the payment page just now. Please try again.",
  invalid_session: "We couldn't open the payment page just now. Please try again.",
  order_not_payable: "This order can't be paid any more. Start a new order.",
  order_not_accepted: "This order isn't accepted yet.",
  variant_not_available: "That option isn't available. Pick the item without it.",
  // M3 (20261019071055): refunds, cancels and strikes.
  invalid_expect: "Something changed. Reload the order and try again.",
  cancel_terms_changed: "The free-cancel time for this order has changed. Look again before cancelling.",
  order_final: "This order was picked up and is final.",
  not_in_person: "A left-out order can't be a no-show; it finishes on its own after the ready date.",
  too_early_for_no_show: "You can report a no-show once the ready date is over.",
  refunded_in_stripe: "This order was refunded by Louisiana Helpr, so it can't be changed here. Louisiana Helpr will tell you what happens next.",
  not_ready: "Mark the order ready first. A no-show can only be reported for an order you had ready.",
  refund_not_found: "We couldn't find that refund in Stripe for this order. Check the refund id (it starts with re_) and try again.",
  invalid_refund: "We couldn't send this refund just now. We'll try again.",
  // M4 admin tools (20261019071055).
  admin_only: "Only admins can do that.",
  invalid_side: "Pick the buyer or the shop.",
  strike_not_found: "That strike was already removed or has ended. Refresh the list.",
  member_gone: "That member's account is gone, so there is nobody to give a strike to.",
  strike_exists: "That side already has an admin strike for this order.",
  // A refund made by hand in Stripe, recorded by an admin (/code-review of shops-m3-v1 #1).
  invalid_stripe_ref: "Paste the Stripe refund id (it starts with re_).",
  invalid_amount: "Enter the amount refunded, at most what the buyer paid.",
  invalid_hand_refund: "Check the refund id and the amount, then try again.",
  ref_already_used: "That Stripe id is already recorded on another payout or refund. Check you have the right one.",
  // Settle a held Shops refund with a refund made in Stripe (admin, Payouts held for review; run-3 review).
  not_held_for_review: "This refund isn't held for review any more. Another admin may have handled it. Refresh the list.",
  hand_refund_short: "That Stripe refund is less than this refund owes. Once the buyer has the rest, use \"other:\" with the refund ids.",
};

/** shop-checkout's own answers (not RPC codes). */
const SHOP_CHECKOUT_COPY: Record<string, string> = {
  // M3: the shop changed its cancel terms after the buyer loaded them; the sheet reloads them.
  terms_changed: "The shop changed its cancel terms. Look again before paying.",
  // Record a refund made in Stripe: what Stripe says about the refund id (v2 rule B).
  refund_not_on_this_order: "That Stripe refund is not on this order's payment. Check the refund id and the order.",
  refund_amount_differs: "That Stripe refund is for a different amount. Enter the amount Stripe shows.",
  refund_not_live: "Stripe says that refund failed or was canceled, so no money went back.",
  refund_pending: "Stripe hasn't finished this refund yet. Wait until it shows Succeeded in Stripe, then settle it.",
  invalid_terms: "Something changed. Reload the shop and try again.",
  hold_lost: "The buyer's card could not be charged, so this order is cancelled. Don't make it; nothing was charged.",
  payment_unavailable: "Payments aren't available right now. Nothing was charged. Please try again in a few minutes.",
  invalid_action: "That action isn't available. Reload the page and try again.",
};

/** The AI helper's own answers (the declutter-ai-draft edge function, target 'shop_item'): not RPC codes. */
const SHOP_ITEM_AI_COPY: Record<string, string> = {
  ai_unavailable: "Photo suggestions aren't available right now. You can fill in the details yourself.",
  ai_photos_required: "Add a photo first, then we can suggest the details.",
  ai_busy: "Photo suggestions are busy. Try again in a minute.",
};

const GENERIC = "Couldn't do that just now. Check your connection and try again.";

/** The plain-words message for any error a Shops call threw or returned. */
export function shopsErrorMessage(err: unknown): string {
  if (!err) return GENERIC;
  // Thrown by cleanListingPhoto (shop and item photos alike) in plain words
  // already, as declutterErrorMessage reads it (lh-silent-failure re-review).
  if (err instanceof ListingPhotoError && err.message) return err.message;
  const e = err as { message?: unknown; code?: unknown; userMessage?: unknown };
  // Set by src/lib/shops/api.ts from RPC_ERROR_COPY at the call site.
  if (typeof e.userMessage === "string" && e.userMessage) return e.userMessage;
  const message = typeof e.message === "string" ? e.message.trim() : typeof err === "string" ? err.trim() : "";
  if (message && Object.prototype.hasOwnProperty.call(SHOPS_ERROR_COPY, message)) return SHOPS_ERROR_COPY[message];
  if (message && Object.prototype.hasOwnProperty.call(SHOP_ITEM_AI_COPY, message)) return SHOP_ITEM_AI_COPY[message];
  if (message && Object.prototype.hasOwnProperty.call(SHOP_CHECKOUT_COPY, message)) return SHOP_CHECKOUT_COPY[message];
  // The contact-leak filters (check_violation; reject_contact_leak_in_shop and
  // _in_shop_item, 20261017061157) speak to the member already.
  if (e.code === "23514" && /does not allow contact details in Shops\.$/.test(message)) return message;
  if (e.code === "23514") return "Check the details: each field must be filled in.";
  return GENERIC;
}
