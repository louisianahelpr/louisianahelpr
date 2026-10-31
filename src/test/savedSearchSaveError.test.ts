/**
 * NIGHT-SAVEDS1-SS-3 (audit 1030 night, save-cap-375-cap.png): saving an 11th search said "We couldn't save your
 * search. Please try again." though trying again can never work: the saved_searches trigger (20260426132214) refuses
 * it with "You can save up to 10 searches. Delete one to add another." Both save screens now say the limit.
 *
 * @mutate src/lib/savedSearches.ts |   if (/save up to 10 searches/i.test(message)) return SAVED_SEARCH_CAP_COPY; |   if (false) return SAVED_SEARCH_CAP_COPY;
 * @mutate src/components/savedSearches/SaveSearchSheet.tsx | toast.error(savedSearchSaveError(err, "We couldn't save your search. Please try again.")); | toast.error("We couldn't save your search. Please try again.");
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SAVED_SEARCH_CAP_COPY, savedSearchSaveError } from "@/lib/savedSearches";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = resolve(__dirname, "../..");
const trigger = effectiveDefs(resolve(ROOT, "supabase", "migrations")).get("enforce_saved_search_limit")?.stmt ?? "";
const FALLBACK = "We couldn't save your search. Please try again.";

describe("the saved-search limit is said, not 'try again' (SS-3)", () => {
  it("the trigger still refuses with the words this matches", () => {
    expect(trigger).toContain("RAISE EXCEPTION 'You can save up to 10 searches. Delete one to add another.';");
  });

  it("the trigger's refusal reads as the limit; anything else keeps the fallback", () => {
    expect(savedSearchSaveError({ message: "You can save up to 10 searches. Delete one to add another.", code: "P0001" }, FALLBACK)).toBe(SAVED_SEARCH_CAP_COPY);
    expect(savedSearchSaveError({ message: "Failed to fetch" }, FALLBACK)).toBe(FALLBACK);
    expect(savedSearchSaveError(null, FALLBACK)).toBe(FALLBACK);
  });

  it("both save screens use it", () => {
    for (const f of ["src/components/savedSearches/SaveSearchSheet.tsx", "src/components/SavedSearches.tsx"]) {
      expect(readFileSync(resolve(ROOT, f), "utf8"), f).toMatch(/toast\.error\(savedSearchSaveError\(err, "We couldn't save your search/);
    }
  });
});
