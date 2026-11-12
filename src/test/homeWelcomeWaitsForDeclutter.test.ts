// @mutate src/pages/home/HomeDashboard.tsx | !summary.usesDeclutter && !summary.declutterPending && !next | !summary.usesDeclutter && !next
// @mutate src/pages/home/homeDashboard/useHomeSummary.ts | declutterPending: !declutterSettled || declutter.isLoading || | declutterPending: declutter.isLoading ||
/**
 * F259p (whole-app audit 11-10; measured B3g 11-12 on a local build against read-only prod data, poster test account,
 * cold /home at 375: CLS 0.21-0.34 before, 0.055-0.085 after). A member with no jobs who sells on Declutter saw the
 * new-member welcome card (and the first-job checklist) for ~300 ms, then Needs you once their Declutter items and cart
 * arrived: a card swap that moved everything under it. Home now decides "new member" only once the Declutter switch
 * has answered and the item and cart reads are in (declutterPending), and Needs you keeps its loading size meanwhile.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const home = fs.readFileSync(path.resolve(__dirname, "../pages/home/HomeDashboard.tsx"), "utf8");
const summary = fs.readFileSync(path.resolve(__dirname, "../pages/home/homeDashboard/useHomeSummary.ts"), "utf8");

describe("F259p: Home's welcome waits for the Declutter reads", () => {
  it("useHomeSummary reports declutterPending from the switch, the item read and the cart", () => {
    expect(summary).toMatch(/declutterPending: !declutterSettled \|\| declutter\.isLoading \|\| \(declutterOn && cart\.data === undefined && !cart\.isError\)/);
    expect(summary).toContain('useFeatureStatus("declutter")');
  });
  it("the welcome card, the first-job checklist and Needs you's loading state all wait on it", () => {
    expect(home).toMatch(/const welcome = [^;]*!summary\.declutterPending/);
    expect(home).toMatch(/firstJob\?\.isNew && !summary\.usesDeclutter && !summary\.declutterPending && <FirstJobHome/);
    expect(home).toMatch(/summary\.todosLoading \|\| money\.pending \|\| \(!!firstJob\?\.isNew && summary\.declutterPending\)/);
  });
});
