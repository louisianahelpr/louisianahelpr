/**
 * THE PROFILE COLUMN IS CAPPED ONCE (lead review, 2026-10-20). At 1440 every
 * Profile settings tab (/profile?tab=auto_tip, ?tab=security, ...) ran its cards
 * and its Save button across the whole content width (~1150-1590px) and read
 * stretched and empty. The fix is ONE measure, PROFILE_COLUMN in
 * src/pages/profile/types.ts, applied by Profile.tsx (which owns the single
 * centred column) to the tab bodies, the landing and their skeleton.
 *
 * CLASS, not instance: no other tracked file under the Profile tree may set a
 * page-level max width of its own (the lead: "no per-page max-widths"), so a
 * tab can never drift back to its own measure.
 *
 * The same review: the "After a job" settings label is sentence case in both
 * places it is typed (the tab title and the Jobs settings row).
 *
 * @mutate src/pages/profile/Profile.tsx | <div className={PROFILE_COLUMN}> | <div>
 * @mutate src/pages/profile/types.ts | export const PROFILE_COLUMN = "mx-auto w-full max-w-[640px]"; | export const PROFILE_COLUMN = "mx-auto w-full";
 * @mutate src/pages/profile/types.ts | auto_tip: "After a job", | auto_tip: "After a Job",
 * @mutate src/components/profile/profileLanding/jobsSettingsGroups.tsx | label: "After a job" | label: "After a Job"
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";
import { PROFILE_COLUMN, TAB_TITLES } from "@/pages/profile/types";
import { JOBS_SETTINGS_GROUPS } from "@/components/profile/profileLanding/jobsSettingsGroups";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => blankComments(fs.readFileSync(path.join(ROOT, p), "utf8"));

/** A page-level measure: max-w-[NNNpx] of 480px or more, or a named max-w-xl..7xl/screen-*. */
const PAGE_MEASURE = /\bmax-w-(?:\[(?:4[89]\d|[5-9]\d\d|\d{4,})px\]|(?:[2-7]?xl|screen-\w+)\b)/g;

describe("the Profile column is capped once (lead 2026-10-20)", () => {
  it("PROFILE_COLUMN is a centred 640px measure", () => {
    expect(PROFILE_COLUMN).toMatch(/\bmax-w-\[640px\]/);
    expect(PROFILE_COLUMN).toMatch(/\bmx-auto\b/);
    expect(PROFILE_COLUMN).toMatch(/\bw-full\b/);
  });

  it("Profile.tsx wraps the tab bodies, the landing and the skeleton in it", () => {
    const src = read("src/pages/profile/Profile.tsx");
    expect(src).toMatch(/<div className=\{PROFILE_COLUMN\}>\s*<ProfileTabPanels/);
    expect(src).toMatch(/<div className=\{`\$\{PROFILE_COLUMN\}[^`]*`\}>\s*<ProfileLanding/);
    expect(src).toMatch(/className=\{`page-measure \$\{PROFILE_COLUMN\}`\}/);
  });

  it("no Profile tab or component sets a page measure of its own", () => {
    const files = trackedFiles("src").filter(
      (f) => /^src\/(pages\/profile|components\/profile)\/.*\.tsx$/.test(f),
    );
    expect(files.length).toBeGreaterThan(40);
    const hits: string[] = [];
    for (const f of files) {
      const src = read(f);
      for (const m of src.matchAll(PAGE_MEASURE)) hits.push(`${f}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });

  it('"After a job" is sentence case in the tab title and the settings row', () => {
    expect(TAB_TITLES.auto_tip).toBe("After a job");
    const row = JOBS_SETTINGS_GROUPS.flatMap((g) => g.items).find((i) => i.key === "auto-tip");
    expect(row?.label).toBe("After a job");
  });
});
