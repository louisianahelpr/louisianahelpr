/**
 * #1582, press-every-control run 36208184593 (shard 2, /jobs/:id customer):
 * six "Done — <date>" rail dots NOT CLICKABLE, "still moving (not stable)".
 * On a completed job the Done dot is the rail's CURRENT step and wore
 * `step-current-pulse`, an infinite scale(1)↔scale(1.06) animation
 * (src/index.css), so a finished job said "live, waiting" forever and the box
 * never held still. Q294 had carried these six as "not clickable, reason
 * unknown" since run 35837735324.
 *
 * Fix (2026-09-26): a rail rule decided the pulse; no pulse once the rail reached Done or on a disputed step.
 * 2026-10-21: the rail itself is gone (the one four-segment <JobProgress>, owner "we need 1 tracker",
 * src/test/oneJobTracker.test.ts), and it never pulses. What stays is the CLASS, from the app's own source:
 * every `step-current-pulse` in src/ sits on a <span> with no click handler (a status pill, not a control; the
 * owner asked for the Subscription "current plan" pill to pulse), so nothing tappable ever wobbles.
 *
 * @mutate src/components/tracker/StepTracker.tsx | <span aria-hidden className={`block h-1 rounded-full ${i <= at ? "bg-primary" : "bg-muted"}`} /> | <button type="button" onClick={() => {}} className={`block h-1 rounded-full step-current-pulse ${i <= at ? "bg-primary" : "bg-muted"}`} />
 */
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = resolve(__dirname, "..", "..");

describe("nothing tappable pulses (#1582, Q294)", () => {
  it("every step-current-pulse in src/ sits on a non-control span", () => {
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
    // Inventory floor, measured 2026-10-21: SubscriptionTab's pill (the job rail's dot left with the rail).
    expect(uses.length).toBeGreaterThanOrEqual(1);
    const bad = uses.filter((u) => !(/^<span\b/.test(u.tag) && !/onClick/.test(u.tag)));
    expect(bad.map((u) => `${u.file}: ${u.line}`)).toEqual([]);
  });
});
