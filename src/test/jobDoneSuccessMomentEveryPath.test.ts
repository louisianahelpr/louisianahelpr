/**
 * Q2029 (small success moments): "job done" plays the checkmark beat on EVERY
 * path that completes a job, not only the poster's release.
 *
 * Completion is a server answer (create-payment `release` -> `bothDone`), and
 * every client site that reads that answer calls trackJobCompleted. The
 * poster's release in Activity (useLifecycleHandlers, source "activity")
 * played fireSuccessMoment({ label: "Job completed" }); the Helpr's Done that
 * finished a job the poster had already approved (JobTracking, source
 * "job_tracking") completed the same job with only a step toast. This guard
 * finds every trackJobCompleted caller in src/ and requires each to either
 * play the moment right after the call or be on the short exempt list with a
 * reason. A new completion path that plays nothing fails here.
 *
 * Exempt: "dispute_resolved" (closing a dispute releases the money; a
 * celebration overlay on a dispute is the wrong tone).
 */
// @mutate src/components/JobTracking.tsx |             fireSuccessMoment({ label: "Job completed" }); |             void 0;
// @mutate src/components/job-card/activityActions/useLifecycleHandlers.ts |         fireSuccessMoment({ label: "Job completed" }); |         void 0;
import { describe, expect, it } from "vitest";
import { relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readSource, walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const MOMENT = 'fireSuccessMoment({ label: "Job completed" })';
/** How far after the trackJobCompleted call the moment must be played. */
const WINDOW = 900;

const CELEBRATES = new Set(["activity", "job_tracking"]);
// @two-way src/test/jobDoneSuccessMomentEveryPath.test.ts:stale exempt entry
const EXEMPT = new Set(["dispute_resolved"]);

interface Site { file: string; source: string; after: string; gated: boolean; code: string }

function sites(): Site[] {
  const out: Site[] = [];
  for (const abs of walkSource([resolve(ROOT, "src")])) {
    const file = relative(ROOT, abs);
    if (file.startsWith("src/test/") || /\.test\.tsx?$/.test(file)) continue;
    if (file === "src/lib/jobCompletedEvent.ts") continue;
    const raw = readSource(abs);
    if (!raw || !raw.includes("trackJobCompleted(")) continue;
    const code = blankComments(raw);
    const re = /trackJobCompleted\(([^;]*?)"([a-z_]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      const before = code.slice(Math.max(0, m.index - 6), m.index);
      out.push({
        file,
        source: m[2],
        after: code.slice(m.index, m.index + WINDOW),
        gated: /if \($/.test(before),
        code,
      });
    }
  }
  return out;
}

describe("Q2029: every job-completion path plays the success moment", () => {
  const found = sites();

  it("finds the completion call sites (inventory floor)", () => {
    expect(found.length).toBeGreaterThan(2);
    expect(new Set(found.map((s) => s.source))).toEqual(new Set(["activity", "job_tracking", "dispute_resolved"]));
  });

  it("every exempt entry still has its call site (two-way)", () => {
    const live = new Set(found.map((s) => s.source));
    const stale = [...EXEMPT].filter((x) => !live.has(x)).map((x) => `stale exempt entry ${x}: remove it`);
    expect(stale).toEqual([]);
  });

  it("every site is classified: celebrates or exempt with a reason", () => {
    const unknown = found.filter((s) => !CELEBRATES.has(s.source) && !EXEMPT.has(s.source));
    expect(unknown.map((s) => `${s.file}: ${s.source}`)).toEqual([]);
  });

  it("each celebrating site plays the moment right after a NEW completion, with the success haptic in the file", () => {
    const missing = found
      .filter((s) => CELEBRATES.has(s.source))
      .filter((s) => !s.after.includes(MOMENT) || !s.code.includes("hapticSuccess()"))
      .map((s) => `${s.file}: ${s.source}`);
    expect(missing).toEqual([]);
  });

  it("the Helpr's finishing Done plays it only when trackJobCompleted says the completion is new (no replay)", () => {
    const tracking = found.find((s) => s.source === "job_tracking");
    expect(tracking?.gated).toBe(true);
  });
});
