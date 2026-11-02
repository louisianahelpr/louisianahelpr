/**
 * BUY-51: the sheet said in-app alerts were "Always on for saved searches", yet the sender obeys a notification switch.
 * Q2464 (lead 2026-11-01): a Declutter saved search alerts as "Wanted matches" (type declutter_wanted, gated by
 * notification_preferences.declutter_wanted), no longer under the Jobs "New matches" switch (job_matches). A Jobs
 * search still follows New matches. Backend proof: src/test/pglite/declutterSavedSearchWantedMatches.pglite.mjs.
 *
 * @mutate src/components/savedSearches/SaveSearchSheet.tsx | "Follows Wanted matches in your notification settings" | "Follows New matches in your notification settings"
 * @mutate src/components/savedSearches/SaveSearchSheet.tsx | : "Follows New matches in your notification settings"} | : "Always on for saved searches"}
 * @mutate src/components/notificationPreferences/constants.tsx | label: "New matches", icon: | label: "Job matches", icon:
 * @mutate src/components/notificationPreferences/constants.tsx | description: "Your Wanted posts and saved Declutter searches.", |
 * @mutate supabase/migrations/20261102025235_declutter_saved_search_alerts_wanted_matches.sql | AND COALESCE(np.declutter_wanted, true) IS TRUE | AND COALESCE(np.job_matches, true) IS TRUE
 * @mutate supabase/migrations/20261102025235_declutter_saved_search_alerts_wanted_matches.sql | PERFORM public.declutter_notify(r.user_id, 'declutter_wanted', | PERFORM public.declutter_notify(r.user_id, 'job_match',
 * @mutate supabase/migrations/20261102025235_declutter_saved_search_alerts_wanted_matches.sql | 'type', 'declutter_wanted', | 'type', 'job_match',
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const src = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("saved-search alerts name the setting that controls them", () => {
  it("the Declutter sender obeys declutter_wanted and sends declutter_wanted on the bell and the email", () => {
    const defs = effectiveDefs(join(process.cwd(), "supabase", "migrations"));
    expect(defs.size).toBeGreaterThan(500);
    const fn = flat(blankSqlComments(defs.get("deliver_saved_search_item_alerts")?.stmt ?? ""));
    expect(fn.length).toBeGreaterThan(2000);
    expect(fn).toContain("AND COALESCE(np.declutter_wanted, true) IS TRUE");
    expect(fn).not.toContain("job_matches");
    expect(fn).not.toContain("'job_match'");
    expect(fn).toContain("PERFORM public.declutter_notify(r.user_id, 'declutter_wanted', v_title");
    expect(fn).toContain("'type', 'declutter_wanted',");
  });

  it("the sheet names Wanted matches for a Declutter search and New matches for a Jobs search", () => {
    const sheet = src("src/components/savedSearches/SaveSearchSheet.tsx");
    expect(sheet).toContain('section === "declutter" ? "Follows Wanted matches in your notification settings" : "Follows New matches in your notification settings"');
    expect(sheet).not.toContain("Always on");
  });

  it("the settings rows say what each switch covers", () => {
    const c = src("src/components/notificationPreferences/constants.tsx");
    expect(c).toContain('{ key: "job_matches", emailKey: "email_job_matches", label: "New matches"');
    expect(c).toContain('label: "Wanted matches", description: "Your Wanted posts and saved Declutter searches.",');
  });
});
