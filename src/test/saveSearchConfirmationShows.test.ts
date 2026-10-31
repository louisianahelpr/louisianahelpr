/**
 * NIGHT-SAVEDS1-SS-2 (audit 1030 night, save-declutter-375-saved.png): tapping Save search closed the sheet and showed
 * nothing, because "Search saved" went through toast.success with no action, which src/lib/toastPolicy.ts makes a
 * no-op. Nothing told the member the search was saved or where it went. It now goes through the bare toast(), which
 * renders, with a View action to the Saved searches tab (a real tab: resolveTab keeps it).
 *
 * @mutate src/components/savedSearches/SaveSearchSheet.tsx |     toast("Search saved", { |     toast.success("Search saved", {
 * @mutate src/components/savedSearches/SaveSearchSheet.tsx | onClick: () => navigate("/profile?tab=saved_searches") | onClick: () => navigate("/profile?tab=saved-searches")
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { resolveTab } from "@/pages/profile/types";

const src = blankComments(readFileSync(resolve(__dirname, "../..", "src/components/savedSearches/SaveSearchSheet.tsx"), "utf8"));

describe("Saving a search says so, with a way to the list (SS-2)", () => {
  it("reads the sheet (floor)", () => {
    expect(src).toContain("createSavedSearch(");
    expect(src.length).toBeGreaterThan(2000);
  });

  it("the confirmation goes through a toast that renders", () => {
    expect(src).not.toMatch(/\btoast\.(success|info|message)\(/);
    expect(src).toMatch(/\btoast\("Search saved", \{/);
  });

  it("its View action opens the Saved searches tab, which the profile page resolves", () => {
    // BUY-54: the action is shared with "You already saved this search" (const toList).
    const m = /const toList = \{ label: "View", onClick: \(\) => navigate\("\/profile\?tab=([a-z_]+)"\) \};/.exec(src);
    expect(m).not.toBeNull();
    expect(src).toMatch(/toast\("Search saved", \{\s*description: [^}]*action: toList,/);
    expect(resolveTab(m![1])).toBe("saved_searches");
  });
});
