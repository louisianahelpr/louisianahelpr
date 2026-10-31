/**
 * BUY-51: the sheet said in-app alerts were "Always on for saved searches", yet the Declutter sender obeys
 * notification_preferences.job_matches, labelled "Job matches" in settings, which reads as jobs only.
 *
 * @mutate src/components/savedSearches/SaveSearchSheet.tsx | Follows New matches in your notification settings | Always on for saved searches
 * @mutate src/components/notificationPreferences/constants.tsx | label: "New matches", icon: | label: "Job matches", icon:
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const src = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));

describe("saved-search alerts name the setting that controls them", () => {
  it("the Declutter sender still obeys job_matches, so the sheet's sentence is true", () => {
    const defs = effectiveDefs(join(process.cwd(), "supabase", "migrations"));
    expect(defs.size).toBeGreaterThan(500);
    expect(blankSqlComments(defs.get("deliver_saved_search_item_alerts")?.stmt ?? "")).toContain("COALESCE(np.job_matches, true) IS TRUE");
    expect(src("src/components/savedSearches/SaveSearchSheet.tsx")).toContain("Follows New matches in your notification settings");
    expect(src("src/components/savedSearches/SaveSearchSheet.tsx")).not.toContain("Always on");
  });

  it("the setting reads for jobs and Declutter alike", () => {
    expect(src("src/components/notificationPreferences/constants.tsx")).toContain('{ key: "job_matches", emailKey: "email_job_matches", label: "New matches"');
  });
});
