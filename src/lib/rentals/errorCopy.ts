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
  feature_disabled: "Rentals isn't open for your account yet.",
  not_authenticated: "Please sign in again to continue.",
  account_restricted: "Your account is restricted, so Rentals is not available right now.",
  under_18: "You must be 18 or older to use Rentals.",
  identity_not_verified: "Verify your ID first. Every landlord on Louisiana Helpr is ID-verified.",
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
};
