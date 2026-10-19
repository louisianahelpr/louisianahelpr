/**
 * Homes -> Rent listings: every fixed choice the editor offers is exactly the
 * set the migration's CHECK accepts (both ways), and no choice is about WHO
 * may live in a home (fair housing, spec 6a; Q61 vouchers Yes/Ask only).
 *
 * @mutate src/lib/rentals/listingCopy.ts |   lawn_care: "Lawn care",\n | \n
 * @mutate src/lib/rentals/listingCopy.ts | export const VOUCHERS_LABEL: Record<string, string> = { yes: "Housing vouchers accepted", ask: "Ask about housing vouchers" }; | export const VOUCHERS_LABEL: Record<string, string> = { yes: "Housing vouchers accepted", ask: "Ask about housing vouchers", no: "No vouchers" };
 * @mutate src/lib/rentals/listingCopy.ts |   if (status === "live" && !listingShowing(status, expiresAt, now)) return "Expired, renew to show it again"; |   if (false) return "";
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";
import {
  ACCESSIBILITY_LABEL,
  PARKING_LABEL,
  PETS_LABEL,
  RENT_FREQUENCY_LABEL,
  UTILITY_LABEL,
  VOUCHERS_LABEL,
  availableLine,
  bedsBathsLine,
  listingStatusLabel,
  rentLine,
} from "@/lib/rentals/listingCopy";

/** The newest migration that creates public.rental_listings (its CHECKs are the inventory), found by
 *  content rather than pinned by name: a later migration restating the listing RPCs does not move it. */
const MIG_DIR = join(process.cwd(), "supabase/migrations");
const SQL =
  readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8")))
    .filter((s) => /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.rental_listings\s*\(/i.test(s))
    .pop() ?? "";

/** The quoted values of a CHECK on `col` (IN (...) or ARRAY[...]). */
function checkValues(col: string): string[] {
  const re = new RegExp(String.raw`\b${col}\b[^\n]*?(?:IN\s*\(|<@\s*ARRAY\[)([^\])]*)`, "s");
  const m = SQL.match(re);
  if (!m) return [];
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
}

describe("Homes listing choices match the migration's CHECKs (both ways)", () => {
  const cases: [string, Record<string, string>][] = [
    ["rent_frequency", RENT_FREQUENCY_LABEL],
    ["pets", PETS_LABEL],
    ["parking", PARKING_LABEL],
    ["accepts_vouchers", VOUCHERS_LABEL],
    ["utilities_included", UTILITY_LABEL],
    ["accessibility", ACCESSIBILITY_LABEL],
  ];
  it("reads a real inventory", () => {
    for (const [col] of cases) expect(checkValues(col).length, col).toBeGreaterThan(1);
  });
  for (const [col, labels] of cases) {
    it(`${col}: the editor's choices are exactly the CHECK's`, () => {
      expect(Object.keys(labels).sort()).toEqual(checkValues(col));
    });
  }
  it("vouchers: Yes or Ask, never No (Q61)", () => {
    expect(Object.keys(VOUCHERS_LABEL).sort()).toEqual(["ask", "yes"]);
  });
});

describe("listing lines", () => {
  it("rent, beds/baths, availability, expired status", () => {
    expect(rentLine(120000, "monthly")).toBe("$1,200 / month");
    expect(rentLine(45050, "weekly")).toBe("$450.50 / week");
    expect(bedsBathsLine(0, 1)).toBe("Studio · 1 bath");
    expect(bedsBathsLine(3, 2.5)).toBe("3 beds · 2.5 baths");
    expect(availableLine("2020-01-01")).toBe("Available now");
    expect(availableLine("2099-03-05")).toBe("Available Mar 5, 2099");
    expect(listingStatusLabel("live", "2000-01-01T00:00:00Z")).toBe("Expired, renew to show it again");
    expect(listingStatusLabel("live", "2999-01-01T00:00:00Z")).toBe("Showing");
  });
});
