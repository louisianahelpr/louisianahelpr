/**
 * Shops: every refusal the server can give, in plain words
 * (docs/specs/local-shops-prep.md; migration 20261015123029_shops_profiles).
 *
 * The server RAISEs the code as the error MESSAGE (e.g. 'invalid_category');
 * the contact-leak trigger raises a sentence (check_violation, 23514) already
 * written for the member, so it is shown as it is.
 *
 * EXACT: src/test/shopsProfiles.test.ts reads every RAISE EXCEPTION code in the
 * shops migration and fails on one with no line here, and on a line here the
 * migration no longer raises.
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
  // The contact-leak filter (check_violation) speaks to the member already.
  if (e.code === "23514" && /members reach you with the Message button/.test(message)) return message;
  if (e.code === "23514") return "Check the details: each field must be filled in.";
  return GENERIC;
}
