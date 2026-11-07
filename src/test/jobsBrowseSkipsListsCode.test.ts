/**
 * Signed-in /jobs' Browse screen keeps the lists' code off its first round (Q1158, 11-06). Browse statically reached a
 * few signed-in-pages modules (the save toast, useJobRef, the keyboard inset, the apply checks), which made every cold
 * /jobs fetch that whole chunk (the job lists', Messages' and Post a job's code) and signed-in-late behind it; the
 * "Application sent" sheet and useManageDeepLink rode along statically too. vite.config.ts now puts the part of
 * signed-in-pages that Browse reaches in jobs-browse, the sheet is lazy, and the manage-link rule is its own file.
 * Local vite build with bundle-size.yml's env: /jobs 414 -> 389 KB gz (critical-path-budget.json).
 *
 * @mutate vite.config.ts |               test: (id: string) => jobsBrowseFirstScreen.has(id.split("?")[0].replace(/\\/g, "/")), |               test: (id: string) => false && jobsBrowseFirstScreen.has(id),
 * @mutate src/pages/home/DashboardDialogs.tsx | import { QuickApplyHandler } from "./QuickApplyHandler"; | import { QuickApplyHandler } from "./QuickApplyHandler"; import "@/components/dashboard/ApplicationSentDialog";
 * @mutate src/pages/jobs/JobsSection.tsx | from "@/components/job-card/manageLinkOpensJobPage"; | from "@/components/job-card/useManageDeepLink";
 */
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { jobsBrowseFirstScreenModules, signedInSplit, staticReach } from "../../scripts/perf/bootReach.mjs";

const root = process.cwd();
const config = blankComments(readFileSync(resolve(root, "vite.config.ts"), "utf8"));

describe("signed-in /jobs Browse first round", () => {
  it("has a jobs-browse group above signed-in-pages that holds Browse's signed-in-pages modules", () => {
    const at = config.indexOf('name: "jobs-browse"');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(config.indexOf('name: "signed-in-pages"'));
    const group = config.slice(at, config.indexOf("}", at));
    expect(group).toContain('test: (id: string) => jobsBrowseFirstScreen.has(id.split("?")[0].replace(/\\\\/g, "/")),');
    const { homeOff } = signedInSplit(root);
    const held = jobsBrowseFirstScreenModules(root, { homeOff });
    expect(held.size).toBeGreaterThan(3);
    expect(homeOff.size - held.size).toBeGreaterThan(20);
  });

  it("does not statically reach the Application-sent sheet or the lists' deep-link hook", () => {
    const reach = staticReach(root, [resolve(root, "src/pages/jobs/JobsSection.tsx")]);
    expect(reach.size).toBeGreaterThan(50);
    const rel = [...reach].map((f) => f.slice(root.length + 1).replace(/\\/g, "/"));
    expect(rel).toContain("src/components/job-card/manageLinkOpensJobPage.ts");
    expect(rel).not.toContain("src/components/dashboard/ApplicationSentDialog.tsx");
    expect(rel).not.toContain("src/components/job-card/useManageDeepLink.ts");
  });
});
