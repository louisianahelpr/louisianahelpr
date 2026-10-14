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
  under_18: "You must be 18 or older to sell on Declutter.",
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
};

/**
 * Codes the APP or the declutter-ai-draft edge function raises (no migration
 * does). Kept apart so the two-way check against the migrations stays exact.
 */
export const DECLUTTER_CLIENT_ERROR_COPY: Record<string, string> = {
  ai_unavailable: "The photo tool isn't available right now. You can fill in the details yourself.",
  ai_photos_required: "Add at least one photo first, so the photo tool can see the item.",
};

const GENERIC = "Something went wrong. Please try again.";

/** The plain-words message for any error a Declutter call threw or returned. */
export function declutterErrorMessage(err: unknown): string {
  if (!err) return GENERIC;
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
  if (e.code === "23514" && /Keep contact details and payment off the listing/.test(message)) return message;
  if (e.code === "23514") return "Check the details: the title needs 3 to 80 characters and each field must be filled in.";
  return GENERIC;
}
