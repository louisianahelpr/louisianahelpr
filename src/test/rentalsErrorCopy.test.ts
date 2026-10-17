/**
 * Every Rentals refusal has plain words. Two-way and EXACT: every code a
 * rentals migration RAISEs has a line in RENTALS_ERROR_COPY, and every line
 * there is a code a rentals migration raises.
 *
 * @mutate src/lib/rentals/copy.ts |   ownership_not_approved: "You can invite tenants once an admin has checked your ownership proof.",\n | \n
 * @mutate src/lib/rentals/copy.ts |   return RENTALS_ERROR_COPY[code] ?? "Something went wrong. Please try again."; |   return code;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { RENTALS_ERROR_COPY, rentalsErrorMessage } from "@/lib/rentals/copy";

const DIR = join(process.cwd(), "supabase/migrations");
const RENTALS_FILES = ["20261017061457_rentals_maintenance_requests.sql"];
// require_feature (20261012031120) raises feature_disabled on every RPC.
const SHARED = ["feature_disabled"];

function raisedCodes(): Set<string> {
  const out = new Set<string>(SHARED);
  for (const f of RENTALS_FILES) {
    const sql = blankSqlComments(readFileSync(join(DIR, f), "utf8"));
    for (const m of sql.matchAll(/RAISE\s+EXCEPTION\s+'([a-z_0-9]+)'/g)) out.add(m[1]);
  }
  return out;
}

describe("Rentals error copy is exact (both ways)", () => {
  const codes = raisedCodes();
  it("reads a real inventory", () => {
    expect(codes.size).toBeGreaterThan(25);
  });
  it("every code a rentals migration raises has plain words", () => {
    expect([...codes].filter((c) => !(c in RENTALS_ERROR_COPY)).sort()).toEqual([]);
  });
  it("every line in the copy is a code a rentals migration raises", () => {
    expect(Object.keys(RENTALS_ERROR_COPY).filter((c) => !codes.has(c)).sort()).toEqual([]);
  });
  it("maps a server error to its words, and an unknown one to a generic line", () => {
    expect(rentalsErrorMessage({ message: "ownership_not_approved" })).toMatch(/admin has checked/);
    expect(rentalsErrorMessage({ message: "weird" })).toBe("Something went wrong. Please try again.");
  });
});
