/**
 * #1582, press-every-control run 36208184593 (shard 2, /jobs/:id customer):
 * six "Done — <date>" rail dots NOT CLICKABLE, "still moving (not stable)".
 * On a completed job the Done dot is the rail's CURRENT step and wore
 * `step-current-pulse`, an infinite scale(1)↔scale(1.06) animation
 * (src/index.css), so a finished job said "live, waiting" forever and the box
 * never held still. Q294 had carried these six as "not clickable, reason
 * unknown" since run 35837735324.
 *
 * Fix: railStepPulses (jobRailTone.ts) decides the pulse; no pulse once the
 * rail reached Done or on a disputed step.
 *
 * CLASS, from the app's own source: every `step-current-pulse` in src/ is
 * either decided by railStepPulses on its own line, or sits on a <span> with no
 * click handler (a status pill, not a control; the owner asked for the
 * Subscription "current plan" pill to pulse).
 *
 * @mutate src/components/job-card/jobRailTone.ts |   return isCurrent && !allDone && !disputed; |   return isCurrent && !disputed;
 * @mutate src/components/JobTracking.tsx | ${railStepPulses({ isCurrent, allDone, disputed: !!disputedStep }) ? "step-current-pulse" : ""} | ${isCurrent ? "step-current-pulse" : ""}
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { railStepPulses } from "@/components/job-card/jobRailTone";

const ROOT = resolve(__dirname, "..", "..");

describe("a finished job's rail does not pulse (#1582, Q294)", () => {
  it("the current step of a live job pulses; Done on a finished job and a disputed step do not", () => {
    expect(railStepPulses({ isCurrent: true, allDone: false, disputed: false })).toBe(true);
    expect(railStepPulses({ isCurrent: true, allDone: true, disputed: false })).toBe(false);
    expect(railStepPulses({ isCurrent: true, allDone: false, disputed: true })).toBe(false);
    expect(railStepPulses({ isCurrent: false, allDone: false, disputed: false })).toBe(false);
  });

  it("every step-current-pulse in src/ is decided by railStepPulses or sits on a non-control span", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx$/.test(f) && !/\.test\.tsx$/.test(f)) files.push(p);
      }
    };
    walk(resolve(ROOT, "src"));
    const uses: { file: string; line: string; tag: string }[] = [];
    for (const f of files) {
      const src = blankComments(readFileSync(f, "utf8"));
      let i = src.indexOf("step-current-pulse");
      while (i !== -1) {
        const lineStart = src.lastIndexOf("\n", i) + 1;
        const line = src.slice(lineStart, src.indexOf("\n", i));
        const open = src.lastIndexOf("<", i);
        const tag = src.slice(open, i);
        uses.push({ file: f.replace(ROOT + "/", ""), line: line.trim(), tag });
        i = src.indexOf("step-current-pulse", i + 1);
      }
    }
    // Inventory floor, measured 2026-09-26: JobTracking's rail dot, SubscriptionTab's pill.
    expect(uses.length).toBeGreaterThanOrEqual(2);
    const bad = uses.filter((u) => !/railStepPulses\(/.test(u.line) && !(/^<span\b/.test(u.tag) && !/onClick/.test(u.tag)));
    expect(bad.map((u) => `${u.file}: ${u.line}`)).toEqual([]);
  });
});
