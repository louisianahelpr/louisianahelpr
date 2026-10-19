/**
 * Rentals S1: the words for every code the rentals RPCs RAISE. Its own module
 * because src/lib/lifecycleErrors.ts (RPC_ERROR_COPY) imports it, and that sits
 * in the signed-in-shared chunk every signed-in first screen loads (/posts
 * budget, scripts/perf/critical-path.mjs): the rest of Rentals (copy.ts, api.ts)
 * stays in its own `rentals` chunk (vite.config.ts), loaded only by its screens.
 *
 * EXACT: src/test/rentalsErrorCopy.test.ts reads every RAISE EXCEPTION code in
 * the rentals migrations and fails on one with no line here, and on a line
 * here no migration raises.
 */
export const RENTALS_ERROR_COPY: Record<string, string> = {
  feature_disabled: "Homes isn't open for your account yet.",
  not_authenticated: "Please sign in again to continue.",
  account_restricted: "Your account is restricted, so Homes is not available right now.",
  under_18: "You must be 18 or older to use Homes.",
  // Owner 2026-10-19: Stripe's ID check (payout setup) or a photo of your ID
  // that an admin approves; no charge either way.
  identity_not_verified: "Verify your ID first: send a photo of your ID for review (free), or set up payouts. Every landlord on Louisiana Helpr is ID-verified.",
  already_verified: "Your ID is already verified.",
  bad_id_path: "Your ID photo didn't upload. Try adding it again.",
  id_photo_missing: "Your ID photo didn't upload. Try adding it again.",
  profile_not_found: "We couldn't find that account.",
  review_changed: "The landlord sent a new photo since you opened this. Refresh and look again.",
  too_many_properties: "You've added the most properties one account can have.",
  property_not_found: "That property isn't available.",
  already_approved: "This property's ownership is already approved.",
  bad_proof_path: "That file didn't upload. Try adding it again.",
  not_authorized: "Only an admin can do that.",
  decision_required: "Choose approve or reject.",
  reason_required: "Pick a reason. Your tenant will see it.",
  not_pending_review: "This property isn't waiting for a review.",
  too_many_units: "This property has the most units it can have.",
  unit_exists: "This property already has a unit with that name.",
  bad_limit: "Enter an amount between $1 and $10,000, or turn auto-approve off.",
  unit_not_found: "That unit isn't available.",
  ownership_not_approved: "You can invite tenants once an admin has checked your ownership proof.",
  too_many_open_invites: "This unit has 10 open invites. Cancel one first.",
  invite_not_found: "This invite link has expired or was already used. Ask your landlord for a new one.",
  own_invite: "This is your own invite link. Send it to your tenant.",
  tenancy_not_found: "This home is no longer connected: the tenancy ended or the invite was cancelled.",
  bad_urgency: "Choose how urgent it is.",
  bad_category: "Choose what kind of problem it is.",
  bad_description: "Describe the problem in at least 10 characters.",
  too_long: "That's too long. Shorten it and try again.",
  contact_info_not_allowed: "Remove phone numbers, emails and links. Keep the conversation in the app.",
  too_many_photos: "A request can have up to 10 photos.",
  too_many_requests: "You've sent a lot of requests today. Try again tomorrow.",
  bad_photo_path: "A photo didn't upload. Try adding it again.",
  request_not_found: "This request can't be changed now.",
  answer_required: "Choose yes or no.",
  note_too_long: "Keep your note under 500 characters.",
  job_not_found: "This job can't take a visit time now.",
  visit_time_invalid: "Pick a time in the next 90 days.",
  no_visit_proposed: "The Helpr hasn't offered a time yet.",
  visit_time_changed: "The Helpr changed the time. Check the new one.",
  visit_time_passed: "That time has passed. Ask the Helpr to offer a new one.",
  job_not_cancellable: "That job can't be cancelled here now. It may have just been paid. Refresh to see it.",
  // Homes -> Rent listings (20261019043000).
  listing_not_found: "This listing isn't available.",
  bad_listing: "Check the listing: every box needs a valid answer (rent, beds, baths, move-in date).",
  listing_not_editable: "This listing was sold or removed. Start a new one.",
  wording_flagged: "Some words say who may live here, which fair housing law doesn't allow. Describe the home instead.",
  unit_already_listed: "This unit already has a listing. Open that one instead.",
  photo_not_uploaded: "A photo didn't upload. Try adding it again.",
  photo_already_attached: "That photo is already on this listing.",
  too_few_photos: "Add at least 5 photos to show the listing.",
  bad_status: "That change isn't possible for this listing now. Refresh and try again.",
  // Homes -> Buy (20261019061241).
  property_already_listed: "This home already has a for-sale listing. Open that one instead.",
  listing_fee_not_ready: "Listing a home for sale isn't open yet. We'll let you know here when it is.",
  sale_wording_flagged: "Some words can't be shown on a for-sale listing. Give one price and describe the home, not who may live there.",
  // The admin take-down (20261019062540): admin card words live in ADMIN_RPC_ERROR_COPY; these are the plain fallbacks.
  listing_not_live: "Only a live or paused listing can be taken down.",
  listing_taken_down: "Louisiana Helpr removed the listings for this home, so nothing on it can be listed until that is lifted. Contact support if you think that was a mistake.",
  property_taken_down: "Louisiana Helpr removed the listings for this address, so it can't be added again. Contact support if you think that was a mistake.",
  bad_query: "Search with 100 characters or fewer.",
  too_many: "Too many at once. Try again with fewer.",
  // The lift while the photo purge runs (20261019071203).
  photos_purging: "This home's photos are being deleted right now. Try again in 15 minutes.",
  // The rent tracker, pay direct (20261019073106).
  bad_rent_plan: "Check the rent schedule: an amount of at least $1, how often, a first due date from today on (a monthly one on day 1 to 28), and at least one way to pay.",
  bad_rent_payment: "Check the payment: an amount, a date that isn't in the future, and how it was paid.",
  payment_not_found: "That payment isn't available.",
  payment_already_decided: "That payment was already confirmed or declined.",
  charge_not_found: "That charge isn't available.",
  payment_not_correctable: "Only a received payment can be changed, within 30 days of confirming it.",
  payment_over_balance: "That's more than is owed now plus one rent. Check the amount.",
  payment_not_disputable: "Only a payment that was turned down, taken back or changed can be disputed: once for each, within 30 days.",
  payment_not_disputable: "Only a payment that was turned down, taken back or changed can be disputed, once, within 30 days.",
  // The deposit tracker, track only (20261019082216).
  bad_deposit: "Check the deposit: an amount of at least $1 and the day you received it (not in the future).",
  deposit_settled: "This deposit was already settled. The statement your tenant got is final.",
  bad_address: "Enter the full forwarding address (street, city, ZIP).",
  deposit_not_found: "No deposit is recorded for this home.",
  tenancy_not_ended: "Settle the deposit after the tenancy ends.",
  bad_settlement: "What you return plus what you keep must equal the deposit, and each amount kept needs a reason. The date can't be in the future.",
};
