/**
 * THE LOADING-STATE MEASUREMENT REPEATS (nightly-red #1654, docs/OPEN.md Q201).
 *
 * docs/audit/loading-states/baseline.json is two-way: a new breach fails, and
 * so does an entry that no longer breaches. That only works on a measurement
 * that gives the same answer twice for the same build and data. Two things
 * decide whether it does, and each is pinned here:
 *
 *  1. WHICH FRAME is measured. scripts/audit/measure-loading-states.mjs holds
 *     every data request at a gate and takes the loading frame at a SETTLED
 *     STAGE (nextStage): nothing in flight but held requests, the screen
 *     unchanged for SETTLE_MS, placeholders on it. A frame taken at the first
 *     instant any placeholder shows is whichever stage the poll happened to
 *     land in (route fallback, or the page's own skeleton), and a cluster's
 *     `#index` then names a different box from one run to the next.
 *  2. WHAT a breach is CALLED. A baseline key must name the same surface on
 *     every run. The measured job is the newest on prod at measuring time, so
 *     its id is keyed as `/jobs/:id` (stableUrl); a key carrying the id can
 *     never match a later run and reads as "no longer breaches" forever.
 *
 * @mutate scripts/audit/measure-loading-states.mjs | if (DATA_RX.test(u) && !gateOpen) await new Promise((go) => held.push(go)); | if (DATA_RX.test(u)) await sleep(1200);
 * @mutate scripts/audit/measure-loading-states.mjs | if (placeholders > 0) return "capture"; | if (placeholders >= 0) return "capture";
 * @mutate scripts/audit/measure-loading-states.mjs | return booted ? "empty" : "wait"; | return "empty";
 * @mutate scripts/audit/measure-loading-states.mjs | seedJobId = fixtureJobId = job.id; | seedJobId = job.id;
 * @mutate scripts/audit/measure-loading-states.mjs | if (gone.note === "already gone") { | if (gone.note === "never") {
 * @mutate scripts/audit/measure-loading-states.mjs | const job = await createPressJob(poster, process.env.GITHUB_RUN_ID ?? String(Date.now()), "", "loading-states-refresh"); | const [job] = await (await fetch("about:blank")).json();
 * @mutate scripts/audit/measure-loading-states.mjs | if (moving > 0 \|\| quietFor < settleMs) return "wait"; | if (moving > 0) return "wait";
 * @mutate scripts/audit/measure-loading-states.mjs | if (step === "capture") { | if (step === "capture" \|\| scr?.count) {
 * @mutate scripts/check-loading-state-shape.mjs | url.replace(/^\/jobs\/[^/?#]+/, "/jobs/:id") | url
 * @mutate docs/audit/loading-states/baseline.json | "key": "customer /jobs/:id #0", | "key": "customer /jobs/c9b3bd7a-9db4-48bf-a2d8-0477f6746524 #0",
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nextStage, SETTLE_MS } from "../../scripts/audit/measure-loading-states.mjs";
import { clusterKey, stableUrl } from "../../scripts/check-loading-state-shape.mjs";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const MEASURER = "scripts/audit/measure-loading-states.mjs";
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

describe("loading-state measurement: the frame is a settled stage, not an instant", () => {
  const settled = { quietFor: SETTLE_MS, moving: 0 };

  it("waits while anything but a held request is in flight, or the screen is still changing", () => {
    expect(nextStage({ placeholders: 3, held: 0, moving: 1, quietFor: 10_000 })).toBe("wait");
    expect(nextStage({ placeholders: 3, held: 2, moving: 0, quietFor: SETTLE_MS - 1 })).toBe("wait");
    expect(nextStage({ placeholders: 0, held: 2, moving: 0, quietFor: 0 })).toBe("wait");
  });

  it("captures a settled stage that shows placeholders, with requests still held", () => {
    expect(nextStage({ placeholders: 4, held: 3, ...settled })).toBe("capture");
    expect(nextStage({ placeholders: 1, held: 0, ...settled })).toBe("capture");
  });

  it("lets one held wave through only when the settled stage shows nothing", () => {
    expect(nextStage({ placeholders: 0, held: 2, ...settled })).toBe("release");
  });

  it("reports no loading state when settled, empty and nothing is held", () => {
    expect(nextStage({ placeholders: 0, held: 0, booted: true, ...settled })).toBe("empty");
  });

  it("never calls the blank boot frame 'no loading state' (#1773: runs 36201048187, 36202873061)", () => {
    // Between the last chunk landing and the app's first query the screen is
    // quiet, nothing is held and nothing is in flight, but the app has not
    // rendered: that frame is not the page, so it must wait, not end.
    expect(nextStage({ placeholders: 0, held: 0, booted: false, ...settled })).toBe("wait");
  });

  it("the measurer holds data at the gate and measures only at a capture step", () => {
    const src = blankComments(read(MEASURER));
    const handler = src.slice(src.indexOf("await page.route("), src.indexOf("const openGate"));
    expect(handler.length, "the route handler was not found — guard rotted").toBeGreaterThan(100);
    expect(handler, "data requests must wait at the gate, not for a fixed delay").toMatch(
      /if \(DATA_RX\.test\(u\) && !gateOpen\) await new Promise\(\(go\) => held\.push\(go\)\);/,
    );
    expect(handler).not.toMatch(/DATA_RX\.test\(u\)\)\s*await sleep/);

    // The loading frame (MEASURE with no probes) is taken in ONE place, and
    // that place is the "capture" branch of nextStage.
    const takes = [...src.matchAll(/page\.evaluate\(MEASURE, \[PLACEHOLDER_SEL, null\]\)/g)];
    expect(takes.length, "the loading frame must be taken in exactly one place").toBe(1);
    const before = src.slice(Math.max(0, (takes[0].index ?? 0) - 120), takes[0].index);
    expect(before, "the loading frame must be taken only at a capture step").toMatch(/if \(step === "capture"\) \{\s*loading = await $/);
    expect(src, "the step must come from nextStage").toMatch(/const step = nextStage\(\{/);
    // The gate opens after the frame is photographed, and on the no-placeholder path.
    expect([...src.matchAll(/\bopenGate\(\);/g)].length).toBeGreaterThanOrEqual(2);
  });
});

describe("loading-state baseline keys name the same surface on every run", () => {
  it("a job page is keyed by its route, not the job measured that night", () => {
    const a = clusterKey({ persona: "customer", url: "/jobs/c9b3bd7a-9db4-48bf-a2d8-0477f6746524" }, 0);
    const b = clusterKey({ persona: "customer", url: "/jobs/ca7ae96f-4dad-4931-9c69-3e194c91c631" }, 0);
    expect(a).toBe("customer /jobs/:id #0");
    expect(b).toBe(a);
    // The two test accounts' pages keep their ids: stable, and two surfaces.
    expect(stableUrl("/user/437de07d-1bd7-46c8-a451-6b46aa3bcad5")).not.toBe(stableUrl("/user/71c56dfb-b326-4010-b960-b18dd3966e7f"));
    expect(stableUrl("/profile?tab=earnings")).toBe("/profile?tab=earnings");
  });

  it("every baseline key is already in its run-stable form", () => {
    const base = JSON.parse(read("docs/audit/loading-states/baseline.json")) as {
      allow: { key: string }[];
      byDesign: { key: string }[];
    };
    const keys = [...base.allow, ...base.byDesign].map((e) => e.key);
    expect(keys.length, "the baseline read as empty — guard rotted").toBeGreaterThan(40);
    const unstable = keys.filter((k) => {
      const m = /^(\S+) (\S+) (#\d+)$/.exec(k);
      if (!m) return true;
      return clusterKey({ persona: m[1], url: m[2] }, Number(m[3].slice(1))) !== k;
    });
    expect(unstable, "keys that cannot match a later run").toEqual([]);
  });

  it("/jobs/:id measures a job the run creates and removes, never 'the newest job on prod' (Q430)", () => {
    // Run 36207939493: the newest job on prod made one page send 675 backend
    // requests (past the 400/min ceiling alone) and changed every run, so
    // neither the budget nor the two-way baseline could settle on /jobs/:id.
    const src = blankComments(read(MEASURER));
    expect(src, "the newest-job lookup must be gone").not.toMatch(/order=created_at\.desc&limit=1/);
    const made = /seedJobId\s*=\s*fixtureJobId\s*=\s*job\.id/.exec(src);
    expect(made, "the measured job is the one createPressJob returned").not.toBeNull();
    expect(src.slice(0, made!.index)).toMatch(/const job = await createPressJob\(poster,/);
    const fin = src.indexOf("} finally {");
    expect(fin, "the fixture is removed in a finally").toBeGreaterThan(made!.index);
    expect(src.slice(fin, fin + 400)).toMatch(/removeFixtureJob\(poster, fixtureJobId\)/);
  });

  it("fails the run when another suite deleted the fixture job mid-run (run 36214822852)", () => {
    // press-every-control's clean-up removes every PRESS-marker job; a /jobs/:id
    // result measured after that is not a measurement of the fixture.
    const src = blankComments(read(MEASURER));
    const fin = src.indexOf("} finally {");
    const tail = src.slice(fin, fin + 1500);
    expect(tail).toMatch(/if \(gone\.note === "already gone"\) \{[\s\S]*?process\.exitCode = 1;/);
    expect(read("scripts/audit/pressProdSafety.mjs")).toMatch(/return \{ ok: true, note: "already gone" \}/);
  });
});
