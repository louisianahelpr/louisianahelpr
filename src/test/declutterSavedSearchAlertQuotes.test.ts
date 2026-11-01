/**
 * The saved-search alert does not double-quote a name (gap sweep D4-15; migration 20261030153722).
 *
 * The bug: `Something new matches "“mug” in Declutter": Blue mug ($5)`, because defaultName in src/lib/savedSearches.ts
 * already writes the quotes and "in Declutter". Reads the EFFECTIVE function. Backend proof:
 * src/test/pglite/declutterSavedSearchAlertQuotes.pglite.mjs (3x; red without the migration and on its planted defects).
 */
// @mutate supabase/migrations/20261031222115_saved_search_keeps_declutter_filters.sql | CASE WHEN r.search_name ~ '["“”]' OR r.search_name | CASE WHEN r.search_name
// @mutate supabase/migrations/20261031222115_saved_search_keeps_declutter_filters.sql | OR r.search_name ~ ' in Declutter$' THEN | THEN
// @mutate supabase/migrations/20261031222115_saved_search_keeps_declutter_filters.sql | ELSE '"' \|\| r.search_name \|\| '"' END | ELSE r.search_name END
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { defaultName } from "@/lib/savedSearches";

const fn = blankSqlComments(effectiveDefs(resolve(__dirname, "../../supabase/migrations")).get("deliver_saved_search_item_alerts")?.stmt ?? "");
const line = fn.slice(fn.indexOf("v_message :="), fn.indexOf("PERFORM public.declutter_notify"));

describe("saved-search alert words", () => {
  it("reads the function's message", () => {
    expect(line.length).toBeGreaterThan(80);
    expect(line).toContain("Something new matches ");
  });
  it("the name is never wrapped unconditionally", () => {
    expect(line).not.toContain(`matches "' || r.search_name`);
  });
  it("names that carry their own quotes or the section are written as they are", () => {
    expect(line).toContain(`r.search_name ~ '["“”]'`);
    expect(line).toContain(`r.search_name ~ ' in Declutter$'`);
  });
  it("any other name keeps its quotes", () => {
    expect(line).toContain(`ELSE '"' || r.search_name || '"' END`);
  });
  it("the default names are the shape the rule expects", () => {
    expect(defaultName({ section: "declutter", query: "mug", category: null })).toBe("“mug” in Declutter");
    expect(defaultName({ section: "declutter", query: "", category: null })).toBe("Everything in Declutter");
  });
});
