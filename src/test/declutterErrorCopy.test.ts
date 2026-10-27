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
    expect(readdirSync(DIR).filter((f: string) => DECLUTTER_FILES.includes(f))).toHaveLength(25); // 25: + bundle discounts (20261027211754, Q2427, 2026-10-27); 24: + donate what doesn't sell (20261027222743, Q2428); 23 before that: + the one-time setup fee (20261026154738, Q2352) + board 141's refund request after the handover (20261026155251, 2026-10-23) + seller delivery (20261027153244, 2026-10-27) + the Free section (20261027170717, 2026-10-27) + safe meetup spots (20261027204500, Q2425, 2026-10-27)
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
    expect(declutterErrorMessage({ message: "some_unknown_code" })).toBe("Something went wrong. Please try again.");
    expect(declutterErrorMessage(null)).toBe("Something went wrong. Please try again.");
  });

  it("shows a refused photo's own plain words (the app wrote them), and hides any other Error's text", () => {
    // The photo picker's toast reads declutterErrorMessage only (toastCopy.test.ts:
    // no toast shows an error's raw .message).
    expect(declutterErrorMessage(new ListingPhotoError(LISTING_PHOTO_UNCLEANABLE))).toBe(LISTING_PHOTO_UNCLEANABLE);
    expect(declutterErrorMessage(new Error("Failed to fetch"))).toBe("Something went wrong. Please try again.");
  });
});
