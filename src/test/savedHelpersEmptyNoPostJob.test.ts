/**
 * Owner, 2026-09-24 (screenshot of the empty Saved Helprs tab): "Remove post a
 * job from this". The never-saved empty state offers no action; the body says
 * how a Helpr lands here. Only the no-search-match state keeps its button.
 */
// @mutate src/components/profile/SavedHelpersTab.tsx | helpers.length === 0 ? undefined : ( | helpers.length === 0 ? (<BarkPillButton onClick={() => navigate("/post-job")}>Post a Job</BarkPillButton>) : (
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "..", "components", "profile", "SavedHelpersTab.tsx"), "utf8");

describe("Saved Helprs empty state", () => {
  it("offers no Post a Job button when nothing is saved", () => {
    const empty = src.slice(src.indexOf('"No saved Helprs yet."'), src.indexOf("<div className=\"grid gap-3"));
    expect(empty.length).toBeGreaterThan(100);
    expect(empty).toContain("helpers.length === 0 ? undefined : (");
    expect(empty).not.toContain("/post-job");
    expect(empty).toContain("Clear search");
  });
});
