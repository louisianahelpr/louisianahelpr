/**
 * Every Declutter refusal has plain words (docs/specs/declutter-auctions.md,
 * "For slice 2 (screens)": the UI must map each code). Two-way and EXACT:
 * every code a declutter migration RAISEs (newest + every file, codes are
 * additive) has a line in DECLUTTER_ERROR_COPY, and every line there is a
 * code some declutter migration raises. App/edge-only codes live in
 * DECLUTTER_CLIENT_ERROR_COPY and must NOT be raised by a migration.
 *
 * @mutate src/lib/declutter/errors.ts |   photos_required: "Add at least 3 photos of the item (up to 12).",\n | \n
 * @mutate src/lib/declutter/errors.ts |   ai_check_stale: "The listing changed while it was being checked. Try again.",\n | \n
 * @mutate src/lib/declutter/errors.ts |   if (err instanceof ListingPhotoError && err.message) return err.message;\n | \n
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";
import { DECLUTTER_CLIENT_ERROR_COPY, DECLUTTER_ERROR_COPY, ListingPhotoError, declutterErrorMessage } from "@/lib/declutter/errors";
import { LISTING_PHOTO_UNCLEANABLE } from "@/lib/declutter/photos";

const DIR = join(process.cwd(), "supabase/migrations");
const DECLUTTER_FILES = [
  "20261014193955_declutter_foundation.sql",
  "20261014200728_declutter_slice2_followups.sql",
  "20261014210518_declutter_slice3_offers_checkout.sql",
  "20261015042253_declutter_slice4_handover_payout.sql",
  "20261016053541_declutter_wanted_price_hint.sql",
  "20261016053625_declutter_moving_out.sql",
  "20261016050402_declutter_porch_default.sql",
];
// require_feature (20261012031120) raises feature_disabled on every RPC; declutter_consume_fee_debt (3b, whose
// other codes are service-only) raises invalid_payout, which slice 4's member handover paths reach.
const SHARED = ["feature_disabled", "invalid_payout"];

function raisedCodes(): Set<string> {
  const out = new Set<string>(SHARED);
  for (const f of DECLUTTER_FILES) {
    const sql = blankSqlComments(readFileSync(join(DIR, f), "utf8"));
    // Every RAISE in these files counts (export_my_data, restated in the
    // follow-ups migration, raises not_authenticated, which is mapped anyway).
    for (const m of sql.matchAll(/RAISE\s+EXCEPTION\s+'([a-z_0-9]+)'/g)) out.add(m[1]);
  }
  return out;
}

describe("Declutter error copy is exact (both ways)", () => {
  const codes = raisedCodes();

  it("reads a real inventory", () => {
    expect(readdirSync(DIR).filter((f: string) => DECLUTTER_FILES.includes(f))).toHaveLength(6);
    expect(codes.size).toBeGreaterThan(25);
  });

  it("every code a declutter migration raises has plain words", () => {
    expect([...codes].filter((c) => !(c in DECLUTTER_ERROR_COPY)).sort()).toEqual([]);
  });

  it("every line in the copy is a code a declutter migration raises", () => {
    expect(Object.keys(DECLUTTER_ERROR_COPY).filter((c) => !codes.has(c)).sort()).toEqual([]);
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
