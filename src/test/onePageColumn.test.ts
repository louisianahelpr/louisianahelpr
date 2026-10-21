/**
 * ONE PAGE COLUMN (owner, 2026-10-21: "it should all be wide"). On a ~2000px
 * window, You › Money and Notifications sat in a 640px column and the Jobs list
 * in a 960px one under a full-width Jobs header, while Home, Explore and
 * Declutter filled the frame. Every signed-in page column is now PAGE_COLUMN
 * (src/lib/pageColumn.ts), whose width is the one token --page-column-max.
 *
 * Measured 2026-10-21 at 2000 (frame 1752px, content box 1704px), before:
 * Home 1704, Jobs header 1662 / Jobs list 960, You and every You tab 640.
 *
 * CLASS, not instance:
 *  - the Profile tree (landing, every tab body, the skeleton) and the Jobs list
 *    render through PAGE_COLUMN;
 *  - no tracked file in the signed-in page trees (Profile, the Jobs list and
 *    cards, sections, Messages, Home) sets a desktop page measure of its own
 *    (lg:/xl:/2xl:max-w-* of 480px or a named max-w-xl..7xl), so no page can
 *    drift back to a narrow column. A text block may still cap its own line
 *    length with an unprefixed max-w (that is a reading measure, not a page).
 *
 * @mutate src/pages/profile/Profile.tsx | <div className={PAGE_COLUMN}> | <div className="mx-auto w-full max-w-[640px]">
 * @mutate src/lib/pageColumn.ts | export const PAGE_COLUMN = "page-column"; | export const PAGE_COLUMN = "page-column max-w-[640px]";
 * @mutate src/index.css |     --page-column-max: none; |     --page-column-max: 640px;
 * @mutate src/components/job-card/JobListPage.tsx | className={`min-h-full flex flex-col ${PAGE_COLUMN}`} | className="min-h-full flex flex-col w-full lg:mx-auto lg:max-w-[960px]"
 * @mutate src/pages/profile/types.ts |   auto_tip: "After a job", |   auto_tip: "After a Job",
 * @mutate src/components/profile/profileLanding/jobsSettingsGroups.tsx | label: "After a job" | label: "After a Job"
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";
import { TAB_TITLES } from "@/pages/profile/types";
import { PAGE_COLUMN } from "@/lib/pageColumn";
import { JOBS_SETTINGS_GROUPS } from "@/components/profile/profileLanding/jobsSettingsGroups";

const ROOT = path.resolve(__dirname, "../..");
const raw = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const read = (p: string) => blankComments(raw(p));

/** A DESKTOP page measure: a breakpoint-prefixed max-w of 480px+ or a named max-w-xl..7xl/screen-*. */
const DESKTOP_MEASURE = /\b(?:md|lg|xl|2xl):max-w-(?:\[(?:4[89]\d|[5-9]\d\d|\d{4,})px\]|(?:[2-7]?xl|screen-\w+)\b)/g;
/** Any page measure (Profile tree only, where a tab body has no business capping itself at all). */
const PAGE_MEASURE = /\bmax-w-(?:\[(?:4[89]\d|[5-9]\d\d|\d{4,})px\]|(?:[2-7]?xl|screen-\w+)\b)/g;

describe("one page column for every signed-in page (owner 2026-10-21)", () => {
  it("PAGE_COLUMN is the shared class, and its width is the one token, full-frame", () => {
    expect(PAGE_COLUMN).toBe("page-column");
    const css = raw("src/index.css");
    expect(css).toMatch(/\.page-column \{\s*width: 100%;\s*margin-inline: auto;\s*max-width: var\(--page-column-max\);\s*\}/);
    expect(css.match(/--page-column-max:\s*([^;]+);/)?.[1]).toBe("none");
  });

  it("Profile wraps the tab bodies, the landing and the skeleton in it; the Jobs list uses it", () => {
    const src = read("src/pages/profile/Profile.tsx");
    expect(src).toMatch(/<div className=\{PAGE_COLUMN\}>\s*<ProfileTabPanels/);
    expect(src).toMatch(/<div className=\{`\$\{PAGE_COLUMN\}[^`]*`\}>\s*<ProfileLanding/);
    expect(src).toMatch(/className=\{`page-measure \$\{PAGE_COLUMN\}`\}/);
    expect(read("src/components/job-card/JobListPage.tsx")).toContain("className={`min-h-full flex flex-col ${PAGE_COLUMN}`}");
  });

  it("no Profile tab or component sets a page measure of its own", () => {
    const files = trackedFiles("src").filter((f) => /^src\/(pages\/profile|components\/profile)\/.*\.tsx$/.test(f));
    expect(files.length).toBeGreaterThan(40);
    const hits: string[] = [];
    for (const f of files) for (const m of read(f).matchAll(PAGE_MEASURE)) hits.push(`${f}: ${m[0]}`);
    expect(hits).toEqual([]);
  });

  it("no signed-in page tree sets a desktop page measure (lg:/xl:max-w-*)", () => {
    const files = trackedFiles("src").filter(
      (f) =>
        /^src\/(pages\/(profile|home|jobs|posts)|components\/(profile|job-card|sections|messages))\/.*\.tsx$/.test(f) &&
        !/\.test\.tsx$/.test(f),
    );
    expect(files.length).toBeGreaterThan(100);
    const hits: string[] = [];
    for (const f of files) for (const m of read(f).matchAll(DESKTOP_MEASURE)) hits.push(`${f}: ${m[0]}`);
    expect(hits).toEqual([]);
  });

  it('"After a job" is sentence case in the tab title and the settings row', () => {
    expect(TAB_TITLES.auto_tip).toBe("After a job");
    const row = JOBS_SETTINGS_GROUPS.flatMap((g) => g.items).find((i) => i.key === "auto-tip");
    expect(row?.label).toBe("After a job");
  });
});
