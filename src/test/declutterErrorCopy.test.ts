/**
 * Every Declutter refusal has plain words (docs/specs/declutter-auctions.md,
 * "For slice 2 (screens)": the UI must map each code). Two-way and EXACT:
 * every code a declutter migration RAISEs (newest + every file, codes are
 * additive) has a line in DECLUTTER_ERROR_COPY, and every line there is a
 * code some declutter migration raises. App/edge-only codes live in
 * DECLUTTER_CLIENT_ERROR_COPY and must NOT be raised by a migration.
 *
 * @mutate src/lib/declutter/errors.ts |   photos_required: "Add at least 1 photo of the item (up to 12).",\n | \n
 * @mutate src/lib/declutter/errors.ts |   ai_check_stale: "The listing changed while it was being checked. Try again.",\n | \n
 * @mutate src/lib/declutter/errors.ts |   if (err instanceof ListingPhotoError && err.message) return err.message;\n | \n
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";
import { DECLUTTER_CLIENT_ERROR_COPY as SHARED_CLIENT_COPY, DECLUTTER_ERROR_COPY as SHARED_COPY, ListingPhotoError, declutterErrorMessage } from "@/lib/declutter/errors";
import { HAUL_AWAY_CLIENT_ERROR_COPY, HAUL_AWAY_ERROR_COPY } from "@/lib/declutter/haulAwayErrors";
import { SELLER_DELIVERY_ERROR_COPY } from "@/lib/declutter/sellerDeliveryErrors";
import { MEETUP_ERROR_COPY } from "@/lib/declutter/meetupErrors";
import { DONATE_ERROR_COPY } from "@/lib/declutter/donateErrors";
import { BUNDLE_ERROR_COPY } from "@/lib/declutter/bundleErrors";
import { LISTING_PHOTO_UNCLEANABLE } from "@/lib/declutter/photos";

// Haul-away's and seller delivery's words live in their own lazily loaded
// modules (Q178); the rule is the same, so they are read as one table (and no
// code is in two of them).
const DECLUTTER_ERROR_COPY: Record<string, string> = { ...SHARED_COPY, ...HAUL_AWAY_ERROR_COPY, ...SELLER_DELIVERY_ERROR_COPY, ...MEETUP_ERROR_COPY, ...DONATE_ERROR_COPY, ...BUNDLE_ERROR_COPY };
const DECLUTTER_CLIENT_ERROR_COPY: Record<string, string> = { ...SHARED_CLIENT_COPY, ...HAUL_AWAY_CLIENT_ERROR_COPY };

const DIR = join(process.cwd(), "supabase/migrations");
const DECLUTTER_FILES = [
  "20261014193955_declutter_foundation.sql",
  "20261014200728_declutter_slice2_followups.sql",
  "20261014210518_declutter_slice3_offers_checkout.sql",
  "20261015042253_declutter_slice4_handover_payout.sql",
  "20261016053541_declutter_wanted_price_hint.sql",
  "20261016053625_declutter_moving_out.sql",
  "20261017055504_declutter_porch_default.sql",
  // Slice 5, Helpr delivery and the shared Helpr task module.
  "20261017055505_declutter_helpr_delivery.sql",
  "20261017070827_declutter_haul_away.sql",
  // Add a Helpr: account_restricted and job_already_funded on the link.
  "20261017073146_declutter_add_a_helpr.sql",
  // No QR, no code (owner 2026-10-18): the seller's "Picked up" adds before_pickup_time and not_a_door_pickup.
  "20261018183715_declutter_handover_no_qr_no_code.sql",
  // Board 158, manage a listing: invalid_price, price_above_listed, invalid_input (and the paused status).
  "20261020064354_declutter_manage_listing.sql",
  "20261021023158_declutter_porch_note.sql",
  "20261021023530_declutter_review_tags.sql",
  "20261021030654_declutter_moving_sale_name.sql",
  "20261021031757_declutter_wanted_public_replies.sql",
  // Stripe Identity once at the first purchase or listing (owner 2026-10-22): identity_required_to_buy / _to_list.
  "20261021202226_declutter_identity_first_buy_or_list.sql",
  // Q1929: the buyer raises a delivery's pay (invalid_raise, delivery_not_waiting, raise_too_late, raise_limit, ...).
  "20261021185418_declutter_delivery_raise_pay.sql",
  // Q2352: the one-time setup fee at the first listing (setup_fee_required_to_list).
  "20261026154738_declutter_setup_fee_once.sql",
  // Board 141, Declutter side: the refund request after the handover (refund_window_over, invalid_amount, ...).
  "20261026155251_declutter_refund_requests.sql",
  // Seller delivery (switch declutter_seller_delivery): its codes are in sellerDeliveryErrors.ts.
  "20261027153244_declutter_seller_delivery.sql",
  // Q2428 donate what doesn't sell: its codes are in donateErrors.ts.
  "20261027222743_declutter_donate.sql",
  // The Free section: free_item_claim_it, not_free, free_claim_limit, free_order, not_free_order, checkout_page_open.
  "20261027170717_declutter_free_section.sql",
  // Q2425 safe meetup spots: its codes are in meetupErrors.ts.
  "20261027204500_declutter_safe_meetup.sql",
  // Q2427 bundle discounts: its codes are in bundleErrors.ts.
  "20261027211754_declutter_bundle_discount.sql",
  // Q2453 tips on deliveries: invalid_tip, tip_not_yet, tip_unavailable.
  "20261028014848_helpr_task_tips.sql",
  // BUY-43: a tip waits for the Helpr's ID check (tip_waits_on_identity).
  "20261101051951_tips_wait_for_helpr_id.sql",
  // Owner 2026-10-28: the seller's price-drop step (invalid_drop_pct).
  "20261028160637_declutter_seller_drop_percent.sql",
  // #7: a seller delivery's "I got it" waits for its day (not_delivered_yet).
  "20261028202844_declutter_sd_confirm_waits_for_delivery_day.sql",
  // #36: which items a bundle discount can apply to (invalid_request; its copy is in bundleErrors.ts).
  "20261028214524_declutter_bundle_applies.sql",
  // D-NEW12: which sellers have a bundle discount (invalid_request; its copy is in bundleErrors.ts).
  "20261030135334_declutter_bundle_sellers.sql",
  "20261028221904_declutter_remove_cart_item.sql",
  // AL-5: a strike for a proven false report (false_report_mismatch).
  "20261029000048_declutter_false_report_strike.sql",
  // Porch pickup is a DAY (owner 2026-10-28): invalid_day.
  "20261028225038_declutter_porch_pick_a_day.sql",
  // Anti-lying #1: every handover photo is taken at the right place: not_at_meetup, not_at_dropoff.
  "20261028235709_declutter_handover_photos_at_the_address.sql",
  // Anti-lying #2: live camera only: photo_too_old.
  "20261029002010_declutter_handover_photos_live_only.sql",
  // Audit 1a #4: the seller's porch photo waits for the booked day (porch_day_not_yet).
  "20261029201542_declutter_porch_photo_not_before_the_day.sql",
  "20261029225634_declutter_problem_both_sides_and_photos.sql",
  "20261029231235_declutter_admin_part_refund.sql",
  // Q2477 (owner 2026-10-29): a paid order is never cancelled (paid_order_not_cancellable; its copy is in sellerDeliveryErrors.ts).
  "20261030002630_declutter_paid_order_never_cancelled.sql",
  // Audit 1030 DB-3: a meeting-spot "I got it" waits for the hour before the meeting (got_it_too_early).
  "20261030061753_declutter_meetup_got_it_waits.sql",
  // Q2487: free items are asked for, the giver picks.
  "20261030064021_declutter_free_requests.sql",
  "20261030164712_declutter_porch_places.sql",
  // Owner 2026-10-28: the ways the seller ticks (invalid_handovers, handover_not_offered).
  "20261028235247_declutter_handover_choices.sql",
  // Q2462: the handover chat (no_agreed_sale, talk_blocked, handover_way_open, talk_recently_closed, talk_not_found,
  // talk_closed, invalid_message, message_rate_limited).
  "20261028235249_declutter_handover_talk.sql",
  // Smart offers (owner 2026-10-29): offers_off, invalid_offer_rules.
  "20261029162620_declutter_smart_offers.sql",
  // Porch days (owner 2026-10-29): invalid_porch_days.
  "20261029161347_declutter_porch_weekdays.sql",
  // DC-8 (Q2476): a live listing's photos; too_few_photos (the last photo of a listing on sale stays).
  "20261030061927_declutter_live_listing_photos.sql",
  // Declutter returns: the two free ways back (invalid_return_way/day/time, not_a_drop_off, before_return_day,
  // not_a_collect, address_required, address_not_found).
  "20261030071818_declutter_returns.sql",
  // B77/B82 Wanted photos and replies: wanted_not_open, wanted_too_many_photos, listing_too_far.
  "20261030064727_declutter_wanted_photos_and_replies.sql",
  // Take back my report (owner 2026-10-30, B100): problem_has_return, problem_has_refund_request, problem_taken_back.
  "20261030134109_declutter_take_back_problem_report.sql",
  // A Wanted block refused when it would settle a shared job: wanted_block_shared_job.
  "20261030225143_declutter_wanted_report_block_photo_check.sql",
  // Handover money (owner 10-30): seller_confirmed, already_confirmed, the no-show report and its answer.
  "20261031004529_declutter_handover_both_confirm.sql",
  // BUY-25 and BUY-23: no_return_needed, drop_off_not_offered.
  "20261031010243_declutter_never_got_it_no_return.sql",
  "20261031082308_helpr_task_confirm_not_on_the_road.sql",
  "20261031133938_declutter_no_helpr_buyer_refund.sql",
  "20261031134217_helpr_delivery_seller_reports_no_show.sql",
  "20261031145652_declutter_place_hours.sql",
  // Owner 2026-10-30: the first free claim's fee, then ID (setup_fee_required_to_claim, identity_required_to_claim).
  "20261031211922_free_claim_fee_then_id_restated.sql",
  "20261101000817_declutter_admin_helpr_fault.sql",
  // Owner 11-01 (B103): a free ask picks a pickup time inside the giver's hours (pickup_time_unavailable).
  "20261101174857_free_ask_picks_a_pickup_time.sql",
];
// require_feature (20261012031120) raises feature_disabled on every RPC; declutter_consume_fee_debt (3b, whose
// other codes are service-only) raises invalid_payout, which slice 4's member handover paths reach.
const SHARED = ["feature_disabled", "invalid_payout"];
// 20261020064354 restates declutter_mark_order_paid (service_role only, never a member's call) for the
// paused status; its invalid_payment is a webhook-side code with no member-facing words.
// Q2352 (20261026154738): declutter_setup_fee_refunded is service_role only (the stripe-webhook records a setup
// fee it sent back); its invalid_refund and order_not_found never reach a member.
const SERVICE_ONLY = ["invalid_payment", "invalid_refund", "order_not_found"];

function raisedCodes(): Set<string> {
  const out = new Set<string>(SHARED);
  for (const f of DECLUTTER_FILES) {
    const sql = blankSqlComments(readFileSync(join(DIR, f), "utf8"));
    // Every RAISE in these files counts (export_my_data, restated in the
    // follow-ups migration, raises not_authenticated, which is mapped anyway).
    for (const m of sql.matchAll(/RAISE\s+EXCEPTION\s+'([a-z_0-9]+)'/g)) out.add(m[1]);
  }
  for (const c of SERVICE_ONLY) out.delete(c);
  return out;
}

describe("Declutter error copy is exact (both ways)", () => {
  const codes = raisedCodes();

  it("reads a real inventory", () => {
    expect(readdirSync(DIR).filter((f: string) => DECLUTTER_FILES.includes(f))).toHaveLength(61); // 61: + a free ask picks a pickup time (20261101174857, B103); 60: + a tip waits for the Helpr's ID check (20261101051951, BUY-43); 59: + an admin decides a disputed delivery as the Helpr's fault (20261101000817, LEAD-ADMIN-HELPR-FAULT); 58: + the first free claim's fee, then ID (20261031211922, owner 2026-10-30); 57: + each pickup place's own hours (20261031145652, LEAD-PLACE-TIMES); 56: + the buyer's cancel after no Helpr and the seller's "The Helpr didn't come" (20261031133938, 20261031134217, BUY-2, soldstates-5); 54: + no I got it while a Helpr delivery is on the road (20261031082308, BUY-39); 53: + handover money and never-got-it (20261031004529, 20261031010243); 51: + the Wanted block; 50: + porch places (20261030164712, D-NEW14); 49: + which sellers have a bundle discount (20261030135334, D-NEW12, 2026-10-30); 48: + take back my report (20261030134109, owner 2026-10-30); 47: + Wanted photos and replies (20261030064727, B77/B82); 46: + free items are asked for, the giver picks (20261030064021, Q2487); 45: + a meeting-spot or door-pickup "I got it" waits for the booked time (20261030061753, audit 1030 DB-3); 44: + returns, the two free ways back (20261030071818); 43: + a live listing's photos (20261030061927, DC-8); 42: + a paid order is never cancelled (20261030002630, Q2477); 41: + Louisiana Helpr refunds part of the price (20261029231235, audit 1b #14); 40: + both sides of a problem and photos on refund requests (20261029225634, audit 1b #3); 39: + the porch photo waits for the booked day (20261029201542, audit 1a #4); 38: + porch days (20261029161347, owner 2026-10-29); 37: + smart offers (20261029162620, owner 2026-10-29); 36: + the ways the seller ticks (20261028235247) and the handover chat (20261028235249, Q2462); 34: + a strike for a proven false report (20261029000048, AL-5); 33: + handover photos are live (20261029002010, anti-lying #2); 32: + every handover photo taken at the address (20261028235709, anti-lying #1); 31: + a buyer removes a cart line (20261028221904, A2-8); 30: + porch pickup day (20261028225038, owner 2026-10-28); 29: + which items a bundle discount can apply to (20261028214524, #36); 28: + a seller delivery's "I got it" waits for its day (20261028202844, #7); 27: + the seller's price-drop step (20261028160637, owner 2026-10-28); 26: + tips on deliveries (20261028014848, Q2453); 25: + bundle discounts (20261027211754, Q2427, 2026-10-27); 24: + donate what doesn't sell (20261027222743, Q2428); 23 before that: + the one-time setup fee (20261026154738, Q2352) + board 141's refund request after the handover (20261026155251, 2026-10-23) + seller delivery (20261027153244, 2026-10-27) + the Free section (20261027170717, 2026-10-27) + safe meetup spots (20261027204500, Q2425, 2026-10-27)
    expect(codes.size).toBeGreaterThan(25);
  });

  it("every code a declutter migration raises has plain words", () => {
    expect([...codes].filter((c) => !(c in DECLUTTER_ERROR_COPY)).sort()).toEqual([]);
  });

  it("every line in the copy is a code a declutter migration raises", () => {
    expect(Object.keys(DECLUTTER_ERROR_COPY).filter((c) => !codes.has(c)).sort()).toEqual([]);
  });

  it("the haul-away tables repeat no shared code", () => {
    expect(Object.keys(HAUL_AWAY_ERROR_COPY).filter((c) => c in SHARED_COPY)).toEqual([]);
    expect(Object.keys(SELLER_DELIVERY_ERROR_COPY).filter((c) => c in SHARED_COPY || c in HAUL_AWAY_ERROR_COPY)).toEqual([]);
    expect(Object.keys(MEETUP_ERROR_COPY).filter((c) => c in SHARED_COPY || c in HAUL_AWAY_ERROR_COPY || c in SELLER_DELIVERY_ERROR_COPY)).toEqual([]);
    expect(Object.keys(BUNDLE_ERROR_COPY).filter((c) => c in SHARED_COPY || c in HAUL_AWAY_ERROR_COPY || c in SELLER_DELIVERY_ERROR_COPY || c in MEETUP_ERROR_COPY || c in DONATE_ERROR_COPY)).toEqual([]);
    expect(Object.keys(HAUL_AWAY_CLIENT_ERROR_COPY).filter((c) => c in SHARED_CLIENT_COPY)).toEqual([]);
  });

  it("client-only codes are not raised by a migration", () => {
    expect(Object.keys(DECLUTTER_CLIENT_ERROR_COPY).filter((c) => codes.has(c))).toEqual([]);
  });

  it("maps a Supabase error, passes the contact-leak sentence through, hides other constraint text", () => {
    expect(declutterErrorMessage({ message: "under_18", code: "42501" })).toBe(DECLUTTER_ERROR_COPY.under_18);
    expect(declutterErrorMessage(new Error("ai_unavailable"))).toBe(DECLUTTER_CLIENT_ERROR_COPY.ai_unavailable);
    const leak = "Phone number detected in the title. Keep contact details and payment off the listing; questions, payment and pickup happen in the app.";
    expect(declutterErrorMessage({ message: leak, code: "23514" })).toBe(leak);
    expect(declutterErrorMessage({ message: 'new row for relation "declutter_items" violates check constraint', code: "23514" })).not.toMatch(/relation|constraint/);
    expect(declutterErrorMessage({ message: "some_unknown_code" })).toBe("Couldn't do that just now. Check your connection and try again.");
    expect(declutterErrorMessage(null)).toBe("Couldn't do that just now. Check your connection and try again.");
  });

  it("shows a refused photo's own plain words (the app wrote them), and hides any other Error's text", () => {
    // The photo picker's toast reads declutterErrorMessage only (toastCopy.test.ts:
    // no toast shows an error's raw .message).
    expect(declutterErrorMessage(new ListingPhotoError(LISTING_PHOTO_UNCLEANABLE))).toBe(LISTING_PHOTO_UNCLEANABLE);
    expect(declutterErrorMessage(new Error("pg_temp.x does not exist"))).toBe("Couldn't do that just now. Check your connection and try again.");
    // Audit 1d D4-14: a request that never reached the server says so (declutterAudit1dGaps.test.ts), never its raw text.
    expect(declutterErrorMessage(new Error("Failed to fetch"))).toBe("Connection trouble. Check your signal and try again.");
  });
});
