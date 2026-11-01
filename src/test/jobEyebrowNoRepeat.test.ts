/**
 * THE JOB PAGE'S EYEBROW NEVER SAYS A WORD TWICE (audit 2026-10-29 A2-L16).
 *
 * The bug: the job page's eyebrow printed the group then the category, so a job whose category repeats its group
 * read "Yard · Yard work" (p2b-ownjob-open-p1-1440.png). Enumerated from the app's own category list on 2026-10-29,
 * six of the 25 categories did it: Yard · Yard work, Moving and errands · Moving, Moving and errands · Errands,
 * Auto · Auto & small engine, Pets · Pet care, Events · Events.
 *
 * The fix: jobEyebrow (src/pages/jobs/jobPage/jobEyebrow.ts) prints the category alone when it already says the
 * group; otherwise "Home · Cleaning". This test walks EVERY category of every group, so a new one is checked too.
 *
 * @mutate src/pages/jobs/jobPage/jobEyebrow.ts | return [...stems(group)].some((w) => own.has(w)) ? label : `${group} · ${label}`; | return `${group} · ${label}`;
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | {eyebrow}</p> | {`Yard · ${eyebrow}`}</p>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { JOB_CATEGORY_GROUPS } from "@/lib/jobCategoryGroups";
import { jobEyebrow } from "@/pages/jobs/jobPage/jobEyebrow";

const stem = (w: string) => (w.length > 3 ? w.replace(/s$/, "") : w);
const words = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 1 && w !== "and").map(stem);

describe("the job page's eyebrow never says a word twice (A2-L16)", () => {
  const all = JOB_CATEGORY_GROUPS.flatMap((g) => g.items.map((it) => ({ group: g.label, value: it.value })));

  it("every category of every group: no word appears twice", () => {
    expect(all.length).toBeGreaterThan(20);
    for (const { value } of all) {
      const w = words(jobEyebrow(value));
      expect(new Set(w).size, `${value}: "${jobEyebrow(value)}"`).toBe(w.length);
    }
  });

  it("the group still leads when it adds something; the category alone when it repeats it", () => {
    expect(jobEyebrow("cleaning")).toBe("Home · Cleaning");
    expect(jobEyebrow("plumbing")).toBe("Trades · Plumbing");
    expect(jobEyebrow("yard_work")).toBe("Yard work");
    expect(jobEyebrow("events")).toBe("Events");
    expect(jobEyebrow("moving")).toBe("Moving");
    expect(jobEyebrow("pet_care")).toBe("Pet care");
    expect(jobEyebrow("other")).toBe("Other");
  });

  it("the job page prints the eyebrow from jobEyebrow and nothing else", () => {
    const page = blankComments(readFileSync(resolve(__dirname, "../pages/jobs/jobPage/JobPage.tsx"), "utf8"));
    expect(page).toMatch(/const eyebrow = jobEyebrow\(job\.category\);/);
    expect(page).toMatch(/text-primary">\{eyebrow\}<\/p>/);
  });
});
