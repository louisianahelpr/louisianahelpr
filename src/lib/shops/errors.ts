/**
 * Shops: every refusal the server can give, in plain words
 * (docs/specs/local-shops-prep.md; migration 20261015123029_shops_profiles).
 *
 * The server RAISEs the code as the error MESSAGE (e.g. 'invalid_category');
 * the contact-leak trigger raises a sentence (check_violation, 23514) already
 * written for the member, so it is shown as it is.
 *
 * EXACT: src/test/shopsProfiles.test.ts reads every RAISE EXCEPTION code in the
 * shops migrations (slice 1 and slice 2's 20261016212915_shops_items) and
 * fails on one with no line here, and on a line here no shops migration raises.
 */
export const SHOPS_ERROR_COPY: Record<string, string> = {
  feature_disabled: "Shops isn't open for your account yet.",
  not_authenticated: "Please sign in again to continue.",
  account_restricted: "Your account is restricted, so Shops is not available right now.",
  under_18: "You must be 18 or older to have a shop.",
  shop_strikes_blocked:
    "You have 3 marketplace strikes, so your shop is paused. It opens again when one of them expires.",
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
  shop_hidden: "Louisiana Helpr hid your shop, so it can't be closed here. Contact support.",
  invalid_hours: "Each time needs a day, and an opening time before its closing time.",
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
  // Slice 2: items (20261016212915_shops_items).
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
  own_item: "Another admin must review your own item.",
  owner_not_eligible:
    "This shop can't sell right now (restricted, strikes, age, payouts, hidden, or at the home-food limit). Reject it instead.",
};

/** The AI helper's own answers (the declutter-ai-draft edge function, target 'shop_item'): not RPC codes. */
const SHOP_ITEM_AI_COPY: Record<string, string> = {
  ai_unavailable: "The photo helper isn't available right now. You can fill in the details yourself.",
  ai_photos_required: "Add a photo first, then the helper can suggest the details.",
};

const GENERIC = "Something went wrong. Please try again.";

/** The plain-words message for any error a Shops call threw or returned. */
export function shopsErrorMessage(err: unknown): string {
  if (!err) return GENERIC;
  const e = err as { message?: unknown; code?: unknown; userMessage?: unknown };
  // Set by src/lib/shops/api.ts from RPC_ERROR_COPY at the call site.
  if (typeof e.userMessage === "string" && e.userMessage) return e.userMessage;
  const message = typeof e.message === "string" ? e.message.trim() : typeof err === "string" ? err.trim() : "";
  if (message && Object.prototype.hasOwnProperty.call(SHOPS_ERROR_COPY, message)) return SHOPS_ERROR_COPY[message];
  if (message && Object.prototype.hasOwnProperty.call(SHOP_ITEM_AI_COPY, message)) return SHOP_ITEM_AI_COPY[message];
  // The contact-leak filter (check_violation) speaks to the member already.
  if (e.code === "23514" && /members reach you with the Message button/.test(message)) return message;
  if (e.code === "23514") return "Check the details: each field must be filled in.";
  return GENERIC;
}
