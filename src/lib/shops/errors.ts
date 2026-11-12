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

/**
 * The most a shop item may cost, in cents (owner 11-05, answer 5: raised for catering and big orders). The SQL holds
 * the same number (shops_check_item_fields and the shop_items / shop_order_lines CHECKs, 20261105191330_shops_caps);
 * src/test/shopsCaps.test.ts fails when they disagree.
 */
export const SHOP_ITEM_MAX_PRICE_CENTS = 500_000;
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;

/**
 * Shops H4 (20261105174853): the shop owner's first live item and the buyer's first order need the one ID check,
 * raised by Declutter's gate with its codes. These words, and the ID sheet, answer them.
 */
const SHOPS_IDENTITY_COPY: Record<"buy" | "list", string> = {
  buy: "Verify your ID with Stripe first. It takes about 2 minutes, once, then order again.",
  list: "Verify your ID with Stripe first. It takes about 2 minutes, once, then publish again.",
};

/**
 * The two ID-check codes Shops can meet (Declutter's gate, 20261105174853), read the way identityRefusal reads them.
 * Kept here, not imported from @/lib/identityCheck: src/lib/shops/orders.ts rides in Home's home-shop-reads chunk,
 * and a static import of identityCheck (and its awardGate) pulled another signed-in chunk into Home's reach
 * (homeLazyReadsStayLight).
 */
function shopIdentityKind(err: unknown): "buy" | "list" | null {
  const raw = typeof err === "string" ? err : (err as { message?: unknown } | null)?.message;
  const m = typeof raw === "string" ? raw : "";
  if (/(^|[^a-z_])identity_required_to_buy($|[^a-z_])/.test(m)) return "buy";
  if (/(^|[^a-z_])identity_required_to_list($|[^a-z_])/.test(m)) return "list";
  return null;
}

/**
 * Open the ID sheet for a Shops refusal that is the ID check. Resolves true when it opened (false when the refusal is
 * not the ID check, or the identity_check switch is off). The sheet's module loads on demand, only on that refusal.
 */
export async function openShopsIdentityCheckFor(err: unknown): Promise<boolean> {
  const kind = shopIdentityKind(err);
  if (!kind) return false;
  const { openIdentityCheck } = await import("@/lib/identityCheck");
  if (kind === "buy") return openIdentityCheck("shop_buy");
  return openIdentityCheck("shop_list");
}

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
  // Q1956: shop-photo-check read the file's own bytes and they are not a picture.
  photo_not_an_image: "That file isn't a photo. Choose a JPG, PNG or WebP picture.",
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
  invalid_price: `Set a price from $1 to ${dollars(SHOP_ITEM_MAX_PRICE_CENTS)}.`,
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
  // Variants (20261106165310): option lists and their combinations.
  variant_required: "Pick an option for each item that has them, then try again.",
  variant_not_available: "An option you picked isn't offered any more. Pick another and try again.",
  invalid_option_name: "Name each option list (like Size or Scent) in 1 to 30 characters, each with its own name.",
  invalid_option_value: "Keep each choice from 1 to 30 characters.",
  too_many_option_lists: "An item can have up to 3 option lists.",
  // S2-003 (20261112222000): a download sells at one price; options are for things made or handed over.
  options_not_for_downloads: "A download has one price. Remove its options first, or pick another kind.",
  too_many_option_values: "Each option list can have up to 10 choices.",
  too_many_variants: "An item can have up to 100 combinations.",
  // S2-009: the server says this for a price out of range, a stock that is not a whole number, or none offered.
  invalid_variants: "Check each combination: a price from $1, a whole-number stock (or empty), and at least one offered.",
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
  invalid_custom_orders: "Pick one of the three choices for custom orders.",
  // Custom orders (20261106202917): a buyer's ask.
  custom_orders_off: "This shop isn't taking custom orders right now.",
  // The same code met by the shop owner sending a price (shops_quote_custom_request).
  custom_orders_off_shop: "Turn custom orders on, and your shop back on if it is paused, before you send a price.",
  invalid_description: "Describe what you'd like in 1 to 1,000 characters.",
  invalid_wanted_date: "Pick a date from tomorrow to 6 months out.",
  too_many_custom_requests: "You already have 3 open requests with this shop, or sent a lot of requests today. Wait for an answer, withdraw one, or try again tomorrow.",
  under_18_to_order: "You must be 18 or older to order from Shops.",
  // Custom orders (20261106205852): the shop's price and the buyer's order of it.
  request_not_found: "This request is no longer here. Reload the page.",
  request_not_open: "This request has already been answered or closed.",
  quote_not_open: "This price is no longer open. Ask the shop again.",
  deposit_orders_closed: "Half up front isn't open yet. Pick custom orders paid in full for now.",
  deposit_not_ready: "Paying half up front isn't open yet. Send the shop a new request and it will be paid in full.",
  // Custom orders, 50% deposit (20261106212437, 20261106215722).
  balance_not_paid: "The rest of this order is not paid yet, so it can't be handed over. We've asked the buyer to pay it.",
  nothing_owed: "Nothing more is owed on this order.",
  payment_plan_frozen: "An order keeps the payment plan it was placed under.",
  deposit_split_frozen: "An order keeps the deposit it was placed with.",
  ready_tap_cancel_frozen: "An order keeps the cancel rule it was placed under.",
  // M2 (20261018211820): the handover.
  invalid_handover_mode: "Pick how buyers get their orders: in person or left out.",
  order_not_charged_yet: "The buyer's card isn't charged yet. Try again in a few minutes.",
  problem_open: "The buyer reported a problem with this order. Louisiana Helpr looks at it before anyone is paid.",
  // H5 (20261105182903): the shop's "Handed over".
  porch_uses_photo: "This order is left out for pickup. Take the ready photo instead; it tells the buyer.",
  not_ready_date_yet: "You can mark it handed over from the ready date on.",
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
  // H8 (b): carpet or furniture cleaning done at the buyer's place (shop-checkout, 20261106164313).
  service_address_needed: "Add the address where the work will be done.",
  invalid_service_address: "Check the address: a street address, a city and a Louisiana ZIP code.",
  service_address_unusable: "We couldn't use that address for sales tax. Check it and try again.",
  service_at_buyer_alone: "Work done at your place is ordered on its own. Order the other items separately.",
  at_buyer_not_allowed: "Only carpet or furniture cleaning can be done at the buyer's place.",
  // Delivery (20261106180902): the shop's own delivery.
  invalid_delivery: "Choose whether you deliver.",
  invalid_delivery_fee: "Make delivery free, or a whole-dollar fee from $5 to $150.",
  invalid_delivery_radius: "Deliver within 1 to 50 miles.",
  shop_does_not_deliver: "This shop doesn't deliver. Choose pickup.",
  delivery_too_far: "That address is farther than this shop delivers. Choose pickup or another address.",
  delivery_outside_louisiana: "Enter a Louisiana address. Shops deliver in Louisiana only.",
  at_buyer_no_delivery: "Work done at your place has nothing to deliver. Choose pickup.",
  delivery_frozen: "This order's delivery can't change now. Start a new order to change it.",
  // Helpr delivery (20261106194913, 20261106223244): a Helpr delivers at Declutter's price for the road miles.
  shop_no_helpr_delivery: "This shop doesn't offer Helpr delivery. Choose pickup.",
  pickup_point_missing: "Save your pickup address first, so a Helpr knows where to pick up.",
  invalid_choice: "Choose on or off.",
  // The shop reports "the Helpr didn't come" (20261106211136).
  not_a_helpr_delivery: "A Helpr isn't delivering this order.",
  no_helpr_booked: "No Helpr is booked for this pickup now.",
  already_handed_over: "You said you handed it over to this Helpr. If something is wrong, report a problem.",
  too_early: "Wait 15 minutes after the pickup time, then tell us.",
  // Service steps: a member only meets these through shop-checkout, which answers "try again".
  invalid_payment: "We couldn't open the payment page just now. Please try again.",
  invalid_session: "We couldn't open the payment page just now. Please try again.",
  order_not_payable: "This order can't be paid any more. Start a new order.",
  order_not_accepted: "This order isn't accepted yet.",
  // M3 (20261019071055): refunds, cancels and strikes.
  invalid_expect: "Something changed. Reload the order and try again.",
  cancel_terms_changed: "The free-cancel time for this order has changed. Look again before cancelling.",
  order_final: "This order was picked up and is final.",
  not_in_person: "A left-out order can't be a no-show; it finishes on its own after the ready date.",
  too_early_for_no_show: "You can report a no-show once the ready date is over.",
  // S004 (Shops audit 11-12): a Helpr-delivered order is never the buyer's no-show.
  helpr_delivery_no_show: "A Helpr delivers this order, so it can't be a buyer no-show. If the Helpr didn't come, report it on the order.",
  // S002 (Shops audit 11-12): "I got it" waits for the ready day, a ready mark or the shop's handover.
  not_ready_yet: "You can confirm once it's ready.",
  // S015 (Shops audit 11-12): a Helpr-delivered order finishes on the drop-off.
  helpr_delivers_handover: "A Helpr delivers this order. It finishes when the buyer has it, so there is nothing to mark.",
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
  // Shops H1 (20261105185006): messages with a shop.
  talk_not_found: "This chat isn't available.",
  talk_closed: "This shop isn't on Helpr right now, so the chat is closed.",
  talk_blocked: "You can't message each other because one of you blocked the other.",
  invalid_message: "Write a message of up to 1,000 characters.",
  message_rate_limited: "Slow down a little, then send again.",
  // Shops H9 (20261105230819): reviews.
  not_handed_over: "Reviews open after the handover.",
  invalid_stars: "Choose 1 to 5 stars.",
  comment_too_long: "Keep the review to 1,000 characters.",
  review_contact_info: "Reviews can't include phone numbers, emails or links.",
  already_reviewed: "You already reviewed this order.",
  // Preorders (20261108184654): the shop's settings.
  preorder_running: "This item has open preorders. You can move the ready-by date once, or change the preorder after they're done.",
  preorder_kind: "Only things you make, home-kitchen food and farm items can be preordered.",
  preorder_options: "Items with options (like sizes) can't be preordered yet.",
  preorder_stock: "Turn off \"I have some ready now\" first. A preorder uses its own limit instead.",
  preorder_ready_by: "Pick a ready-by date from tomorrow to 120 days out.",
  preorder_goal: "A goal needs both a number (2 to 1,000) and a date.",
  preorder_goal_by: "Pick a goal date between today and the ready-by date.",
  preorder_cap: "Set a limit from 1 to 1,000, and at least the goal.",
  not_a_preorder: "This item has no running preorder.",
  preorder_already_moved: "The ready-by date can be moved only once.",
  preorder_too_late: "It's too late to move this date. Buyers whose orders aren't marked ready get refunded automatically.",
  preorder_push_range: "Move the date later, by 30 days at most.",
  // The shop's ready tap opens 14 days before ready-by (money review 11-08).
  preorder_not_ready_yet: "You can mark a preorder ready from 14 days before its ready-by date.",
  // The buyer's preorder and its cancel.
  preorder_closed: "This preorder is closed.",
  preorder_full: "Not that many are left to preorder. Lower the number and try again.",
  preorder_use_preorder_checkout: "This item is a preorder. Order it on its own as a preorder.",
  preorder_ready: "The shop already marked this order ready, so it can't be cancelled.",
  use_preorder_cancel: "This is a preorder. Cancel it with Cancel preorder on the order.",
  // Digital downloads (20261108182917 + 20261108185110).
  already_bought: "You already bought this. It is in Shops > My orders.",
  digital_not_cancellable: "A download can't be cancelled. If the file is broken or not as described, report a problem on the order.",
  digital_no_pickup: "A download has no pickup to confirm.",
  digital_no_stock: "A download has no stock count and no wait.",
  files_required: "Add 1 to 5 files for buyers to download.",
  file_type_not_allowed: "Upload a PDF, ZIP, PNG or JPG file.",
  file_too_big: "Each file can be up to 100 MB.",
  too_many_files: "An item can have up to 5 files.",
  last_file: "Add the new file first, then remove this one.",
  item_not_digital: "Files can only be added to a digital download.",
  file_not_found: "We couldn't find that file. Reload the page and try again.",
  not_digital: "That order isn't a download.",
  too_soon: "A download is paid out 72 hours after the sale.",
  // shop_digital_dispute_event (stripe-webhook only): never reaches a member.
  invalid_event: "Something went wrong. Please try again.",
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
  // Custom orders (50% deposit): the buyer's page for the rest.
  nothing_owed: "Nothing more is owed on this order.",
  // Delivery (shop-checkout geocodes the drop-off address before the order freezes).
  invalid_address: "Enter the street, city and 5-digit ZIP code to deliver to.",
  address_not_found: "We couldn't find that address. Check the street, city and ZIP code.",
  geocode_unavailable: "We couldn't look up that address just now. Nothing was charged. Try again in a minute.",
  // Helpr delivery (slice 2): the price the buyer saw must be the price charged.
  invalid_delivery_choice: "Choose pickup or a delivery, then look again at the price.",
  delivery_rate_changed: "The Helpr delivery price changed. Look at the new price, then send the order again. Nothing was charged.",
  // The pickup point a Helpr goes to, looked up when the shop saves its pickup address.
  address_changed: "Your pickup address changed while we looked it up. Save it again.",
  pickup_outside_louisiana: "We found that address outside Louisiana. Check the street, city and ZIP code.",
  // Digital downloads (20261108185110).
  digital_on_website: "Downloads are bought on louisianahelpr.com. Open the shop there to buy it.",
  invalid_billing_address: "Enter your billing street, city, two-letter state and 5-digit ZIP code.",
  billing_address_unusable: "We couldn't figure the sales tax for that address. Check the street, city, state and ZIP code.",
  // shop-digital's own answers (a download's files).
  upload_missing: "The upload didn't finish. Try adding the file again.",
  file_unreadable: "We couldn't read that file. Try adding it again.",
  file_does_not_match_type: "That file isn't really the type its name says. Upload a real PDF, ZIP, PNG or JPG.",
  zip_unreadable: "We couldn't read that ZIP file. Make it again and upload it.",
  zip_empty: "That ZIP file is empty. Add the files to it and upload it again.",
  zip_has_program: "That ZIP file has a program or script inside. Take it out and upload the ZIP again.",
  file_not_allowed: "Upload a PDF, ZIP, PNG or JPG file up to 100 MB.",
};

/** The AI helper's own answers (the declutter-ai-draft edge function, target 'shop_item'): not RPC codes. */
const SHOP_ITEM_AI_COPY: Record<string, string> = {
  ai_unavailable: "Photo suggestions aren't available right now. You can fill in the details yourself.",
  ai_photos_required: "Add a photo first, then we can suggest the details.",
  ai_busy: "Photo suggestions are busy. Try again in a minute.",
  // S2-011 (Shops audit 2): the photo-draft function refused the photos (Declutter's words).
  item_photos_invalid: "We couldn't read those photos. Use photos you took, not screenshots, or fill in the details yourself.",
};

const GENERIC = "Couldn't do that just now. Check your connection and try again.";

/** The plain-words message for any error a Shops call threw or returned. */
export function shopsErrorMessage(err: unknown): string {
  if (!err) return GENERIC;
  // Thrown by cleanListingPhoto (shop and item photos alike) in plain words
  // already, as declutterErrorMessage reads it (lh-silent-failure re-review).
  if (err instanceof ListingPhotoError && err.message) return err.message;
  const e = err as { message?: unknown; code?: unknown; userMessage?: unknown };
  const idKind = shopIdentityKind(err);
  if (idKind === "buy" || idKind === "list") return SHOPS_IDENTITY_COPY[idKind];
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
