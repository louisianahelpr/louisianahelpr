/**
 * THE MESSY-INPUT SWEEPS PRESS NAMES AND IDS THE APP STILL RENDERS
 * (nightly-red #2245, prod-audit run 39102037116, 2026-10-18).
 *
 * Six messy-input tests failed on selectors the app had dropped: the four
 * applicant sweeps waited for `button /^edit job$/i` on the card (every chip
 * moved under `More` on 2026-10-08, so it is not there until More is pressed;
 * the note button became "Add a private note on <name>"),
 * and the two targeted rules clicked `#dob` (sign-up step 2 and Complete
 * Profile stopped asking a birthday on 2026-10-09 / 2026-10-14). Each failure
 * restarted the Playwright worker and rebuilt messy-input's beforeAll fixtures
 * (a new funded applicant job and two Declutter listings, ~50 s), which is
 * where leg 1's 42 minutes went: it timed out at test 90 of 100.
 *
 * Two checks, both read from the app's own source:
 *  1. every name in e2e/prod-audit/applicantCardNames.ts matches the name the
 *     app composes for that control (JobActionRow, OpenStep, ApplicantsPanel,
 *     ApplicantHireRow);
 *  2. every single-id `locator("#id")` in messy-input.spec.ts and
 *     messyInputForms.ts names an `id` that exists in src/.
 *
 * @mutate src/components/job-card/JobStepCard.tsx | const isMoreOnly = (_c: ReactNode) => true; | const isMoreOnly = (_c: ReactNode) => false;
 * @mutate e2e/prod-audit/applicantCardNames.ts | export const PRIVATE_NOTE_BUTTON = /^(add a\|edit your) private note on /i; | export const PRIVATE_NOTE_BUTTON = /add private note/i;
 * @mutate e2e/prod-audit/applicantCardNames.ts | export const MORE_PANEL = /^more actions for this job$/i; | export const MORE_PANEL = /^more$/i;
 * @mutate e2e/prod-audit/messy-input.spec.ts | (owner, 2026-10-09)").toHaveCount(0);\n    await page.locator("#zipCode").fill("1234"); | (owner, 2026-10-09)").toHaveCount(0);\n    await page.locator("#dob").fill("1234");
 */
import { readFileSync, statSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import {
  APPLICANTS_PRIMARY,
  CANCEL_JOB_CHIP,
  DECLINE_BUTTON,
  EDIT_JOB_CHIP,
  MORE_BUTTON,
  MORE_PANEL,
  PRIVATE_NOTE_BUTTON,
} from "../../e2e/prod-audit/applicantCardNames";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => blankComments(read(p));

/** A template literal's text with every `${…}` replaced by `value`. */
const fill = (tpl: string, value: string) => tpl.replace(/\$\{[^}]*\}/g, value);

describe("the applicant sweeps' names match what the app renders", () => {
  const row = code("src/components/job-card/JobActionRow.tsx");
  const open = code("src/pages/posts/postedJobCard/steps/OpenStep.tsx");

  it("every chip lives under More, which is why the sweep presses Edit/Cancel through it", () => {
    expect(code("src/components/job-card/JobStepCard.tsx")).toMatch(/const isMoreOnly = \(_c: ReactNode\) => true;/);
  });

  it("JobActionChip still composes `label — ariaLabel` (the shape EDIT/CANCEL expect)", () => {
    expect(row).toMatch(/return starts \? ariaLabel : `\$\{label\} — \$\{ariaLabel\}`;/);
  });

  for (const [key, re] of [["edit", EDIT_JOB_CHIP], ["cancel", CANCEL_JOB_CHIP]] as const) {
    it(`OpenStep's ${key} chip name matches ${re}`, () => {
      const m = open.match(new RegExp(`<JobActionChip key="${key}"[^>]*?label="([^"]+)"[^>]*?ariaLabel="([^"]+)"`));
      expect(m, `OpenStep has no JobActionChip key="${key}" with label + ariaLabel`).not.toBeNull();
      const [, label, aria] = m!;
      const name = aria.toLowerCase().startsWith(label.toLowerCase()) ? aria : `${label} — ${aria}`;
      expect(name).toMatch(re);
    });
  }

  it("the More trigger and its popover match MORE_BUTTON / MORE_PANEL", () => {
    const trigger = row.match(/aria-label=\{`(More — [^`]*)`\}/);
    expect(trigger, "JobStepOverflowChip's trigger aria-label moved").not.toBeNull();
    expect(fill(trigger![1], "4")).toMatch(MORE_BUTTON);
    const panel = row.match(/<PopoverContent[\s\S]*?aria-label="([^"]+)"/);
    expect(panel, "JobStepOverflowChip's PopoverContent lost its aria-label").not.toBeNull();
    expect(panel![1]).toMatch(MORE_PANEL);
  });

  it("an open job's primary is Applicants", () => {
    // label={`Applicants${count > 0 ? ` (${count})` : ""}`}: the word leads, a count may follow.
    expect(open, "OpenStep's Applicants primary label moved").toMatch(/label=\{`Applicants\$\{/);
    for (const name of ["Applicants", "Applicants (1)"]) expect(name).toMatch(APPLICANTS_PRIMARY);
  });

  it("the private-note and decline buttons match", () => {
    const panel = code("src/pages/posts/postedJobs/ApplicantsPanel.tsx");
    const notes = [...panel.matchAll(/`((?:Add a|Edit your) private note on [^`]*)`/g)].map((m) => fill(m[1], "Hallie"));
    expect(notes.length, "ApplicantsPanel's note button names moved").toBe(2);
    for (const n of notes) expect(n).toMatch(PRIVATE_NOTE_BUTTON);
    const hire = code("src/pages/posts/postedJobs/applicantsPanel/ApplicantHireRow.tsx");
    const decline = hire.match(/aria-label=\{`(Decline [^`]*)`\}/);
    expect(decline, "ApplicantHireRow's decline name moved").not.toBeNull();
    expect(fill(decline![1], "Hallie")).toMatch(DECLINE_BUTTON);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("every #id the messy-input sweep drives exists in src/", () => {
  const srcIds = new Set<string>();
  for (const f of walk(join(process.cwd(), "src"))) {
    for (const m of blankComments(readFileSync(f, "utf8")).matchAll(/\bid=(?:"([\w-]+)"|\{"([\w-]+)"\})/g)) srcIds.add(m[1] ?? m[2]);
  }
  const files = ["e2e/prod-audit/messy-input.spec.ts", "e2e/prod-audit/messyInputForms.ts"];
  const used = new Map<string, string>();
  for (const f of files) for (const m of code(f).matchAll(/\.locator\("#([\w-]+)"\)/g)) used.set(m[1], f);

  it("the scan reads real inventories", () => {
    expect(srcIds.size).toBeGreaterThan(200);
    expect(used.size).toBeGreaterThan(10);
  });

  it("no driven id is missing from the app", () => {
    const missing = [...used].filter(([id]) => !srcIds.has(id)).map(([id, f]) => `#${id} (${f})`);
    expect(missing, "these ids are driven by the sweep but rendered nowhere in src/").toEqual([]);
  });
});
