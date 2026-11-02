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
import { CONNECTION_TROUBLE_COPY, isNetworkFailure } from "@/lib/networkFailure";
import { isConfirmedOffline } from "@/lib/connectivity";

export const DECLUTTER_ERROR_COPY: Record<string, string> = {
  // The Free section (20261027170717).
  free_item_claim_it: "This item is free. Tap Ask for it.",
  // A2-8 (20261028221904): taking an item out of the cart.
  checkout_open: "You opened checkout for this. Close the payment page, then try again in a few minutes.",
  not_in_cart: "This item isn't in your cart any more.",
  not_free: "This item isn't free any more. Check its price.",
  free_claim_limit: "You have 3 free items asked for or waiting. Pick those up or take back an ask first.",
  // The Free change (Q2487, 20261030064021): asks, the giver's pick, the 30-day pause.
  free_paused: "You missed a free pickup, so you can't ask for free items for 30 days.",
  pickup_time_unavailable: "That pickup time isn't open any more. Pick one of the giver's pickup times in the next week.",
  request_not_found: "That ask isn't open any more.",
  request_not_open: "That person took back their ask. Pick someone else.",
  request_time_passed: "Their pickup time has passed. Pick someone else.",
  requester_unavailable: "That person can't take items right now. Pick someone else.",
  free_order: "These items are free. Choose a pickup and tap Confirm and pick a time.",
  not_free_order: "Some of these items have a price. Check out to pay for them.",
  checkout_page_open: "A payment page for this seller is still open. Close it, then try again in a few minutes.",
  feature_disabled: "Declutter isn't open for your account yet.",
  not_authenticated: "Please sign in again to continue.",
  account_restricted: "Your account is restricted, so Declutter is not available right now.",
  declutter_strikes_blocked:
    "You have 3 Declutter strikes, so Declutter is paused for you. It opens again when one of them expires.",
  under_18: "You must be 18 or older to buy or sell on Declutter.",
  // Stripe Identity once, at the first purchase or listing (owner 2026-10-22); the ID sheet opens with it.
  identity_required_to_buy: "Verify your ID with Stripe first. It takes about 2 minutes, once, then buy again.",
  identity_required_to_list: "Verify your ID with Stripe first. It takes about 2 minutes, once, then publish again.",
  // Owner 2026-10-30: a first free claim: the one-time fee first, then the ID check. Their own screens answer these.
  identity_required_to_claim: "Verify your ID with Stripe first. It takes about 2 minutes, once, then confirm again.",
  setup_fee_required_to_claim: "Your first free item needs the one-time ID check, because a claim shares a real person's address. Pay its fee once, then verify. The item stays free.",
  // Q2352 (owner 2026-10-23): the one-time account setup fee, by card at the first listing; the fee page is offered with it.
  setup_fee_required_to_list:
    "Your first listing needs the one-time account setup fee. Pay it once, then publish again. If you already paid it for Jobs, you won't pay it again.",
  payout_setup_incomplete: "Set up your payouts first, so we can pay you when your item sells.",
  photos_required: "Add at least 1 photo of the item (up to 12).",
  attestation_required: "Tick the box under the four statements before you list this item.",
  attestation_incomplete: "The box under the four statements isn't ticked yet. Tick it to list this item.",
  pickup_windows_required: "Add at least one pickup time so buyers know when they can come.",
  invalid_pickup_windows: "Each pickup time needs a day, and a start time before its end time.",
  invalid_input: "Something in that request wasn't right. Try again.",
  price_above_listed: "You can lower the price, or raise it back up to the price you listed it at.",
  invalid_price: "The price must be between $1 and $1,000.",
  invalid_floor_price: "Your lowest price must be at least $1 and no more than your asking price.",
  invalid_location: "We couldn't find that pickup address. Check it and try again.",
  item_not_found: "This item isn't available.",
  item_not_a_draft: "This item has already been listed.",
  item_not_editable: "This item can't be changed now.",
  photo_not_uploaded: "That photo didn't finish uploading. Try adding it again.",
  photo_not_found: "That photo was already removed.",
  too_many_photos: "A listing can have up to 12 photos.",
  // DC-8 (20261030061927): a listing on sale keeps at least one photo.
  too_few_photos: "A listing needs at least one photo. Add the new one before you remove the last.",
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
  card_required: "Save a card first. It is charged only when you buy, or automatically where you turned on automatic charges.",
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
  // Smart offers (20261029162620): the seller turned offers off; Buy still works.
  offers_off: "This seller isn't taking offers. You can still buy it.",
  invalid_offer_rules: "Choose whether you take offers, and whether to answer them automatically.",
  price_changed: "The price changed. Check the new price and try again.",
  handover_unavailable: "Choose porch pickup, pickup at the seller's home, or Helpr delivery.",
  seller_tax_not_ready: "Checkout for this seller isn't available yet.",
  cart_empty: "Nothing from this seller is waiting for checkout.",
  // Row 101 porch default (20261017055504).
  porch_unavailable: "The seller asked to meet at their home for this item, so porch pickup isn't available. Choose pickup at the seller's home.",
  // 20261028235247 (owner 2026-10-28): the ways the seller ticks for each item.
  handover_not_offered: "The seller doesn't offer that way for one of these items. Choose another way to get it.",
  // 20261028235249 (owner 2026-10-28, Q2462): the handover chat when no way the seller offers works.
  no_agreed_sale: "This chat is only for a buyer and seller with an item waiting in the buyer's cart.",
  talk_blocked: "You can't message this person.",
  handover_way_open: "Porch pickup works for these items. Choose it at checkout.",
  talk_recently_closed: "You already talked about this sale this week. Check out with a way the seller offers.",
  talk_not_found: "We couldn't find this chat. It may have ended.",
  talk_closed: "This chat has ended.",
  invalid_message: "Write a message of up to 1,000 characters.",
  message_rate_limited: "Slow down a little, then send again.",
  invalid_handovers: "Tick at least one way buyers can get it. A free item is picked up from your porch.",
  invalid_porch_choice: "Choose whether buyers can pick this item up from your porch.",
  // declutter_set_porch_days (20261029161347).
  invalid_porch_days: "Pick porch days from Sunday to Saturday.",
  // Porch places (D-NEW14, 20261030164712).
  invalid_porch_place: "Give the place a name and its full address.",
  porch_places_full: "You can save up to 5 pickup places.",
  // Place hours (LEAD-PLACE-TIMES, 20261031145652).
  invalid_place_hours: "Each pickup time must end at least 30 minutes after it starts.",
  porch_place_not_found: "We couldn't find that pickup place. It may have been removed.",
  porch_place_unavailable: "That pickup place isn't available. Pick another.",
  porch_place_needed: "Pick which of the seller's pickup places you'll use.",
  // declutter_set_drop_pct (owner 2026-10-28).
  invalid_drop_pct: "Pick a price drop of 5, 10, 15 or 20 percent, or turn price drops off.",
  order_not_payable: "This checkout is no longer open. Start checkout again.",
  no_sale_to_cancel: "There's no sale to cancel on this item.",
  sale_already_paid: "The buyer already paid. Contact support to cancel.",
  // Slice 4 (20261015042253): pickup, handover, porch, no-shows, problems, reviews, money queues.
  order_not_paid: "This sale isn't paid, so this can't be done.",
  problem_open: "A problem was reported on this sale. Louisiana Helpr will decide it before anyone is paid.",
  already_paid_out: "The seller was already paid for this sale.",
  invalid_slot: "Pick a time inside the seller's pickup times, before your 7-day pickup deadline.",
  reschedule_used: "You already moved this pickup once.",
  // Porch pickup day (20261028225038).
  invalid_day: "Pick one of the seller's pickup days, before your 7-day pickup deadline.",
  not_booked_yet: "The pickup time isn't booked yet. The buyer books it first.",
  not_a_porch_pickup: "This sale isn't a porch pickup.",
  photo_first: "Take the porch photo first, then add where it is.",
  note_too_long: "Keep the note to 200 letters.",
  invalid_tags: "One of those tags can't be used here. Pick again.",
  invalid_sale_name: "Name the sale in 3 to 60 letters.",
  invalid_reply_amount: "Your price has to be at most their Wanted price and at most your listing's price.",
  already_replied: "You already answered this Wanted post.",
  reply_rate_limited: "You can answer 10 Wanted posts a day. Try again tomorrow.",
  listing_has_open_offer: "That listing has an open offer. Answer with another listing, or after the offer closes.",
  wanted_busy: "This post has enough answers for today. Try again tomorrow.",
  sale_name_contact_info: "Keep phone numbers, emails and links out of the sale name.",
  invalid_sale_dates: "The sale has to start on or before your move-out date.",
  no_moving_sale: "Add your moving-sale items first.",
  before_pickup_time: "You can mark it picked up from the booked pickup time.",
  not_delivered_yet: "You can confirm you got it from the delivery day, or once the seller marks it delivered.",
  got_it_too_early: "You can tap \"I got it\" from an hour before the booked time.",
  not_a_door_pickup: "Only a pickup at the door is marked \"Picked up\" by the seller. For porch pickups the buyer confirms.",
  invalid_porch_time: "Pick a time after the booked pickup, on the same day.",
  invalid_method: "Something went wrong with the handover. Please try again.",
  // The handover table refuses a NEW code confirmation (20261018183715 trigger); the RPCs refuse it first.
  code_handover_removed: "Handovers no longer use a code. Update the app, then tap \"I got it\" when you have the item.",
  wrong_side: "Only the buyer taps \"I got it\", and only the seller taps \"Picked up\".",
  location_required: "Turn on location so we can confirm you're at the pickup address.",
  not_at_pickup: "Take the photo at the pickup address.",
  // Anti-lying #1 (20261028235709): the seller's "Picked up" photo at a safe meeting spot is taken at the spot.
  not_at_meetup: "Take the photo at the meeting spot.",
  // Anti-lying #2 (20261029002010): handover photos come from the camera at that moment.
  photo_too_old: "That photo was taken more than 10 minutes ago. Take a new one now with your camera.",
  // Audit 1a #4 (20261029201542): the seller puts it out on the buyer's booked day, never before.
  porch_day_not_yet: "Put it out on the day the buyer picked. You can post the porch photo from that day.",
  already_picked_up: "The buyer already picked up this item.",
  seller_set_out: "The seller set the item out. If it isn't there, report a problem.",
  seller_confirmed: "The seller says it was handed over. If you don't have it, report a problem.",
  already_confirmed: "You said it was handed over. If that's wrong, report a problem.",
  no_show_reported: "The buyer says you didn't show. Answer that report on this order.",
  no_show_not_reported: "The buyer hasn't reported anything on this order.",
  no_show_waiting: "A no-show report on this order is waiting for an answer, so the time can't move.",
  no_show_answer_late: "The 24 hours to answer are over.",
  // BUY-2 (20261031133938): the buyer's cancel after no Helpr took the delivery.
  pickup_booked: "You booked a pickup time, so this sale goes ahead. If something is wrong, report a problem.",
  not_a_no_helpr_order: "This sale can't be cancelled here.",
  // soldstates-5 (20261031134217): the seller's "The Helpr didn't come" and the Helpr's answer.
  not_a_helpr_delivery: "This sale isn't a Helpr delivery.",
  no_helpr_booked: "No Helpr is booked for this pickup now.",
  already_handed_over: "You said you handed it over to this Helpr. If something is wrong, report a problem.",
  already_answered: "You already answered. Louisiana Helpr looks at both sides and tells you what it decides.",
  no_return_needed: "The buyer says they never got it, so there is nothing to bring back.",
  drop_off_not_offered: "Your address stays private on this sale, so you pick it up from the buyer.",
  too_early: "You can report a no-show 15 minutes after the booked time, or for a porch pickup day, once that day is over.",
  // 141d (20261026155251): a handed-over sale is final once its 24-hour window is over.
  sale_final: "The time to report a problem is over, so this sale is final.",
  invalid_reason: "Pick what went wrong.",
  note_required: "Tell us what happened (up to 1,000 characters).",
  not_authorized: "Only Louisiana Helpr staff can do this.",
  problem_not_found: "That problem report wasn't found.",
  problem_already_decided: "This problem was already decided.",
  // D2-3 (20261029225634): a second report is refused with where to add it; the other side adds theirs.
  problem_already_open: "A problem is already open on this sale. Add your side to it, with photos, and Louisiana Helpr reads both.",
  problem_already_reported: "You already reported a problem on this sale. Louisiana Helpr is looking at it and will tell you both what it decides.",
  problem_side_is_yours: "You reported this problem. Louisiana Helpr is looking at it.",
  // B100 (20261030134109): "Take back my report" until Louisiana Helpr decides.
  problem_has_return: "A return was agreed on this sale, so Louisiana Helpr decides it.",
  problem_has_refund_request: "The buyer's refund request went to Louisiana Helpr with your report, so it stays with them.",
  problem_taken_back: "You took back your report on this sale, so it can't be reported again.",
  too_many_problem_photos: "Add up to 3 photos.",
  // D2-14 (20261029231235): Louisiana Helpr's part refund is for an item the buyer keeps.
  part_refund_after_handover_only: "A part refund is for an item the buyer keeps. Before the handover, refund in full or pay the seller.",
  // LEAD-ADMIN-HELPR-FAULT (20261101000817): the Helpr's fault is one outcome only.
  helpr_fault_not_possible: "The Helpr's fault is a full refund, before the handover, on a delivery a Helpr took and never picked up.",
  not_handed_over: "Reviews open after the handover.",
  invalid_stars: "Pick 1 to 5 stars.",
  comment_too_long: "Keep your review under 1,000 characters.",
  already_reviewed: "You already reviewed this sale.",
  review_contact_info: "Reviews can't include phone numbers, emails or links.",
  refund_amount_unknown: "We couldn't work out this refund. Louisiana Helpr will sort it out.",
  refund_not_found: "That refund wasn't found.",
  // Board 141, Declutter side (20261026155251): a refund request after the handover.
  refund_before_handover: "You can ask for a refund once you have the item. Before that, report a problem.",
  refund_already_asked: "You already asked for a refund on this sale.",
  refund_window_over: "The 24 hours to ask for a refund are over, so this sale is final.",
  refund_already_answered: "This refund request was already answered.",
  // Declutter returns (20261030071818_declutter_returns.sql): the two free ways back.
  invalid_return_way: "Choose how the item comes back: the buyer brings it, or you pick it up.",
  invalid_return_day: "Pick a day in the next 7 days.",
  invalid_return_time: "Pick a time from now on, within the next 7 days.",
  not_a_drop_off: "This item isn't coming back by drop-off.",
  before_return_day: "You can drop it off from the day the seller picked.",
  not_a_collect: "The seller isn't picking this one up.",
  address_required: "Type the address (up to 300 characters).",
  address_not_found: "We couldn't find that address. Check the street number, street and town.",
  refund_answer_late: "The 24 hours to answer are over, so Louisiana Helpr decides this one.",
  invalid_answer: "Pick an answer.",
  invalid_amount: "Offer an amount above $0 and below the item price. To give it all back, choose Refund in full.",
  part_refund_unavailable: "A part refund isn't possible on this sale. Refund it in full, or say no and Louisiana Helpr decides.",
  payout_already_sent: "The seller was already paid for this sale. Louisiana Helpr will sort it out.",
  // Service-only (declutter_refund_after_handover / declutter_rebook_payout); worded for the ops log.
  payout_missing: "This sale has no payout row to change.",
  already_refunded: "This sale was already refunded.",
  order_not_handed_over: "This sale isn't handed over yet.",
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
  // Audit 10-30 #8: a block from a Wanted post never cancels a job (declutter_block_wanted_poster).
  wanted_block_shared_job: "You have a job with this person, so nothing changed. To block them, open that job. You'll see any fee first.",
  own_post: "This is your own post, so you can't act on it here.",
  report_not_allowed: "You can't report this post.",
  report_not_for_post: "That report isn't about this post.",
  report_target_not_found: "We couldn't find that post. It may have been removed.",
  // Wanted photos (20261030064727).
  wanted_not_open: "That wanted post is closed. Post a new one to add photos.",
  wanted_too_many_photos: "A wanted post can have up to 3 photos.",
  // "I have this" (audit W6, 20261030064727): the listing itself must be inside the post's distance.
  listing_too_far: "That listing is farther away than this buyer will travel. Answer with a listing closer to them.",
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
  // BUY-39 (20261031082308): the buyer's I got it while the Helpr is still bringing it.
  delivery_on_the_way: "The Helpr is still bringing it. Tap I got it once it's dropped off.",
  invalid_address: "Enter the full drop-off address: street number, street, and town.",
  order_handover_frozen: "How you get this order can't be changed after checkout.",
  order_amounts_frozen: "The amounts of this order can't be changed after checkout.",
  no_delivery_fee: "This order has no delivery to refund.",
  not_a_delivery_in_transit: "Only a delivery the Helpr picked up can be decided as damaged in delivery.",
  delivery_decision_needed: "The Helpr has this item. Decide it as damaged in delivery, or pay the seller.",
  // AL-5 (20261029000048): "The report was false" goes against whoever reported it.
  false_report_mismatch: "A false report goes against the person who reported it: their side is at fault, and the decision goes the other way. A Helpr's report can't be marked false here.",
  task_not_found: "This delivery isn't available.",
  // Tips on deliveries (20261028014848, Q2453).
  invalid_tip: "Tips are $3 to $1,000.",
  tip_not_yet: "You can add a tip once the delivery is done.",
  tip_unavailable: "This delivery can't take a tip.",
  // BUY-43 (20261101051951): helpr_task_tip_start refuses it too now (declutter-checkout's own ID check answers the same code).
  tip_waits_on_identity: "This Helpr can receive tips once verified. Nothing was charged.",
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
  // Raise the delivery pay (20261021185418, Q1929).
  invalid_raise: "Raise the pay by whole dollars, at least $5.",
  delivery_not_waiting: "A Helpr already took this delivery, or it closed.",
  raise_too_late: "Less than an hour is left to find a Helpr, so the pay can't be raised now.",
  raise_limit: "The pay can be raised by up to $150 in all on one delivery.",
  raise_not_waiting: "That raise was replaced by a newer one. Try again.",
  raise_not_found: "That raise couldn't be found.",
  invalid_session: "That payment page couldn't be recorded.",
  raise_transfer_mismatch: "That raise was already paid to a Helpr with another transfer.",
  // Add a Helpr (20261017073146): the link is for the job just posted, before its checkout.
  job_already_funded: "This job is already paid for, so it can't be added to your Declutter purchase. It's under your posted jobs.",
  // A10 (20261017073146): the seller-fault cancel's hand tool and the seller's fee debt (staff and server only).
  not_seller_fault: "This refund was not the seller's fault, so the setup job keeps the normal cancel rules.",
  order_gone: "This order no longer exists, so its setup jobs have to be settled by hand.",
  invalid_fee: "That amount isn't valid.",
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
  // The address lookup (src/lib/addressLookup.ts): the lookup itself failed, so this is never about what was typed.
  address_lookup_unavailable: "We can't look up addresses just now. Your address may be fine, so try again in a minute.",
  // Found the area but not the house: AddressNeedsExactSpot under the address says what to do.
  address_not_exact: "We found your area, but not your house on the map. See the note under the address.",
  location_far_from_address: "You seem to be far from that address. Check the address, or try again when you're there.",
  // The buyer's read of a seller's pickup places missed its deadline (useSellerPorchPlaces).
  porch_places_slow: "The pickup places are taking too long to load. Check your connection and try again.",
  // declutter-checkout (seller delivery, 20261027153244): the price the screen showed is no longer the seller's.
  delivery_rate_changed: "The seller's delivery price just changed. Check the new price, then tap Pay again.",
  ai_unavailable: "The photo tool isn't available right now. You can fill in the details yourself.",
  ai_photos_required: "Add at least one photo first, so the photo tool can see the item.",
  // The app's own timeout on the photo tool (AI_TIMEOUT_MS, api.ts).
  ai_timed_out: "The photo tool took too long. Try again, or fill in the details yourself.",
  // declutter-card / declutter-checkout (slice 3b) when no code came back.
  payment_unavailable: "The payment page isn't available right now. Please try again. Nothing was charged.",
  // The delivery price and address checks (delivery.ts, sellerDelivery.ts): no payment page is involved.
  delivery_check_unavailable: "We couldn't check delivery for that address. Please try again. Nothing was charged.",
  // declutter-ai-draft room mode (moving-out mode).
  room_photos_invalid: "Add 1 to 4 room photos. Use photos you took, not screenshots.",
  // setDropPct before 20261028160637 reaches prod (PGRST202): only the old 5% step exists.
  drop_pct_unavailable: "Choosing how much the price drops isn't ready yet. Pick 5% for now, or turn price drops off.",
  // declutter-ai-draft draft mode for a NEW listing (photos in the request, owner 2026-10-28).
  item_photos_invalid: "We couldn't read those photos. Use photos you took, not screenshots, or fill in the details yourself.",
  ai_rate_limited: "The photo tool needs a break. Wait a few minutes, then try again.",
  // declutter-checkout's delivery_quote (slice 5): the geocoder found no such address.
  geocode_unavailable: "We couldn't look up addresses just now. Try again in a minute.",
  photo_unavailable: "That photo couldn't load. Try again.",
  // declutter-checkout's raise_pay before its migration is deployed (PGRST202).
  raise_unavailable: "Raising the pay isn't available yet. Nothing was charged.",
  // declutter-checkout's delivery_tip (Q2453): the job tip's own refusals, word for word (create-payment action "tip").
  payment_review: "This payment can't go through right now. Please contact support.",
  tip_helpr_no_payout: "This Helpr hasn't set up their payout account yet and cannot receive tips at this time.",
  tip_helpr_held: "This Helpr can't receive tips right now. Please try again later.",
  tip_check_failed: "Could not verify the Helpr's payout account. Please try again.",
  tip_not_sent: "Your tip couldn't be sent, so nothing was charged. Please try again later.",
  tip_already_paid: "This tip already went through. Thank you!",
  tip_page_closed: "That tip page closed. Close this and open it again to tip.",
};

/**
 * A listing photo refused before upload (src/lib/declutter/photos.ts). Its
 * message is plain words this app wrote for the member, so
 * declutterErrorMessage shows it as it is.
 */
export class ListingPhotoError extends Error {}

const GENERIC = "Something went wrong. Please try again.";

/** Audit 1d D4-14: the device is offline (the browser says so). Any typed text stays where it was. */
export const DECLUTTER_OFFLINE_COPY = "You're offline. Try again when you're back online.";

/** True once offline is CONFIRMED (src/lib/connectivity.ts): navigator.onLine=false alone is only a hint (owner, 10-31). */
function deviceOffline(): boolean {
  return isConfirmedOffline();
}

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
  // D4-14: a call that never reached the server (offline, signal lost) says so, never "Something went wrong".
  if (deviceOffline()) return DECLUTTER_OFFLINE_COPY;
  if (isNetworkFailure(err)) return CONNECTION_TROUBLE_COPY;
  // The contact-leak filter (check_violation) speaks to the member already.
  // Other check_violations are table constraints written for developers.
  if (e.code === "23514" && /Keep contact details and payment (off the listing|out)/.test(message)) return message;
  if (e.code === "23514") return "Check the details: the title needs 3 to 80 characters and each field must be filled in.";
  return GENERIC;
}
