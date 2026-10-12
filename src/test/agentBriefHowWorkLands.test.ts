/*
 * GUARD (lead, 2026-10-12): .claude/AGENT-BRIEF.md keeps its "How work lands"
 * rules. On 2026-10-12, 144 PRs were open, and one change often had 2-4 of
 * them. Lanes ran land.sh and opened PRs on their own. Subjects named Q numbers
 * that moved at landing. Each branch got a full local test run on an 8 GB Mac.
 * One train builder now lands everything. This test fails if any of those rules
 * drops out of the brief that every agent reads first.
 */
// @mutate .claude/AGENT-BRIEF.md | Agents never run land.sh and\n  never open PRs. | Agents may open PRs.
// @mutate .claude/AGENT-BRIEF.md | a commit subject carries no Q number | a commit subject names its Q number
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BRIEF = readFileSync(join(__dirname, "..", "..", ".claude", "AGENT-BRIEF.md"), "utf8");
const section = (() => {
  const at = BRIEF.indexOf("## How work lands");
  const end = BRIEF.indexOf("\n## ", at + 1);
  return at < 0 ? "" : BRIEF.slice(at, end < 0 ? undefined : end).replace(/\s+/g, " ");
})();

describe('AGENT-BRIEF "How work lands"', () => {
  it("the section exists and is read before the Landing section", () => {
    expect(section.length).toBeGreaterThan(200);
    expect(BRIEF.indexOf("## How work lands")).toBeLessThan(BRIEF.indexOf("## Landing"));
  });

  it.each([
    ["ready branches from fresh main, appended to the land queue", /ready\/<topic>.*fresh `origin\/main`.*~\/\.lh-landq\/queue\.txt/],
    ["agents never run land.sh or open PRs", /Agents never run land\.sh and never open PRs\./],
    ["no Q numbers in commit subjects", /a commit subject carries no Q number\. Put Q numbers in the body\./],
    ["light local checks; CI runs the full suite once per train", /inventories:refresh.*typecheck.*eslint on the changed files.*tests you touched.*GitHub CI runs the full suite once per train/],
    ["money branches keep their trailer and land in a money train", /money branch carries its `Sensitive-Review:` trailer and lands in a money train/],
    ["same-area follow-ups are fixed in place", /small follow-up in the same area is fixed in the same branch, not filed as a new item/],
    ["one train builder, one big train plus one money train in flight", /one train builder lands everything.*one big train and one money train in flight/],
  ])("keeps the rule: %s", (_name, re) => {
    expect(section).toMatch(re);
  });
});
