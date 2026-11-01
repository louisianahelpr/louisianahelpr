/**
 * ONE job tracker (owner, 2026-10-21: "we need 1 tracker"). Chat, the job page and the job cards (poster and
 * Helpr) each drew their own: 4 bars twice and an 8-icon stepper. Every job-progress render goes through
 * <JobProgress> (src/components/tracker/JobProgress.tsx) fed by jobProgress (src/components/tracker/jobProgressState.ts); no other
 * file keeps a job step list, and StepTracker is used for jobs only through JobProgress.
 * @mutate src/components/messages/chatView/DealCard.tsx | <JobProgress progress={step ? { ...stage, next: "" } : stage} compact /> | <StepTracker steps={["Posted", "Hired", "Working", "Done"]} at={0} />
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |       <JobProgress progress={step \|\| hideNext ? { ...progress, next: "" } : progress} /> |       <ol aria-label="Job progress">{["Posted", "Hired", "Working", "Done"].map((s) => <li key={s}>{s}</li>)}</ol>
 * EIGHT steps on the job cards too (owner, 2026-10-22): MineJobFace draws the bar under a collapsed card's face,
 * fed by jobProgress on both the poster's Posted card and the Helpr's Working card.
 * @mutate src/pages/posts/PostedJobCard.tsx |               progress={isExpanded ? null : jobProgress(job, | progress={null && jobProgress(job,
 * @mutate src/pages/jobs/AppliedJobCard.tsx |             progress={!isExpanded && job.helper_id === userId ? jobProgress(job, | progress={false && job.helper_id === userId ? jobProgress(job,
 * @mutate src/components/job-card/MineJobFace.tsx |             <JobProgress progress={progress} barOnly /> |             <span />
 * @mutate src/components/JobTracking.tsx |       <JobProgress\n        progress={jobProgress( |       <div role="group" aria-label="Job progress">{displaySteps.map((s) => s.label)}</div>\n      <JobProgress\n        progress={jobProgress(
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = process.cwd();
const read = (f: string) => blankComments(readFileSync(join(ROOT, f), "utf8"));

/** Every place a job's progress shows. Each renders <JobProgress>. */
const RENDERERS = [
  "src/components/messages/chatView/DealCard.tsx",
  "src/pages/jobs/jobPage/JobPageParts.tsx",
  "src/components/JobTracking.tsx",
];
/** Surfaces that render <JobProgress> with a state they already hold (Home's Live now carries jobProgress from
 *  nextUpStates.ts; the payment screen shows its step with a caption). */
const ALSO_RENDER = ["src/pages/home/HomeDashboard.tsx", "src/components/postjob/PaymentLifecycleSteps.tsx"];
/** StepTracker users, none of them a job's progress (Declutter delivery and porch handover): jobs draw JobStepBar. */
const STEP_TRACKER_OK = [
  "src/components/declutter/DeclutterDeliveryViews.tsx",
  // A Declutter order's own steps (deep audit #1, 2026-10-28), not a job. The porch handover card draws them
  // through OrderSteps since the porch DAY (20261028225038), so it no longer uses StepTracker itself.
  "src/components/declutter/OrderSteps.tsx",
];

const files = walkSource([join(ROOT, "src")])
  .map((f) => f.slice(ROOT.length + 1).replace(/\\/g, "/"))
  .filter((f) => /\.(tsx?)$/.test(f) && !/\.test\.|\/test\/|__preview/.test(f));

describe("one job tracker (owner 2026-10-21)", () => {
  it("scans the app", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("every job-progress surface renders <JobProgress> from jobProgress", () => {
    for (const f of RENDERERS) {
      const src = read(f);
      expect(src, f).toMatch(/<JobProgress\b/);
      expect(src, f).toMatch(/\bjobProgress\(/);
    }
  });

  it("Home's Live now and the payment screen render it too", () => {
    for (const f of ALSO_RENDER) expect(read(f), f).toMatch(/<JobProgress\b/);
    expect(read("src/pages/home/homeDashboard/nextUpStates.ts")).toMatch(/progress: jobProgress\(/);
  });

  it("no file but jobProgress.ts keeps a job step list (Posted … Done)", () => {
    const lists = files
      .filter((f) => f !== "src/components/tracker/jobProgressState.ts")
      .filter((f) => /\[[^\]]*"Posted"[^\]]*"(?:Hired|Offered|Accepted)"[^\]]*"(?:Done|Released)"[^\]]*\]/.test(read(f)));
    expect(lists).toEqual([]);
  });

  it("the card tracker draws no stepper of its own", () => {
    const src = read("src/components/JobTracking.tsx");
    expect(src).not.toMatch(/aria-label="Job progress"/);
    expect(src).not.toMatch(/displaySteps\.map\(/);
  });

  it("both job cards hand the face the one tracker, collapsed", () => {
    expect(read("src/pages/posts/PostedJobCard.tsx")).toMatch(/progress=\{isExpanded \? null : jobProgress\(job, \{ viewer: "poster"/);
    expect(read("src/pages/jobs/AppliedJobCard.tsx")).toMatch(/progress=\{!isExpanded && job\.helper_id === userId \? jobProgress\(job, \{ viewer: "helpr"/);
    expect(read("src/components/job-card/MineJobFace.tsx")).toMatch(/<JobProgress progress=\{progress\} barOnly \/>/);
  });

  it("StepTracker is not used for jobs at all (exact, two-way)", () => {
    const users = files.filter((f) => /<StepTracker\b/.test(read(f))).sort();
    expect(users).toEqual([...STEP_TRACKER_OK].sort());
  });
});
