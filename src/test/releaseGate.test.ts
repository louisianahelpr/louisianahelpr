// @mutate scripts/release-gate.mjs | .filter((r) => !String(r.displayTitle ?? "").includes("(main batch ")) | .filter(Boolean)
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
// @ts-expect-error — plain ESM script, no declaration file
import { REQUIRED_CHECKS, evaluate, applyWaivers, resolveWaivers, OWNER_WAIVERS } from "../../scripts/release-gate.mjs";

/**
 * The pre-release gate (scripts/release-gate.mjs) and its wiring.
 *
 * WHAT THIS CATCHES
 * -----------------
 * 1. A release path that no longer runs the gate. The gate is one function
 *    call in the Fastfile and one step in ios-beta.yml; either can be edited
 *    away in a "cleanup". Every lane that uploads to Apple must call it.
 * 2. A required check whose workflow was renamed or deleted: the gate keys on
 *    the workflow `name:` and file, and a stale entry would report MISSING
 *    forever — which reads as "blocked" and gets bypassed.
 * 3. The verdict logic itself, shown able to fail in each direction: a red run,
 *    a HOLLOW green (run succeeded, audit job skipped), a run in flight, no
 *    run, a superseding re-run.
 *
 * WHAT IT CANNOT SEE: live Actions state. `evaluate()` is exercised against
 * hand-built run/job records, and the wiring assertions read repo text. A
 * workflow disabled on github.com, or a required check that stops running for
 * a reason the files do not express, is invisible here — that is
 * prod-freshness.yml's and the nightly-red issues' job, not this file's.
 *
 * Proven able to fail 2026-09-21: neutering the audit-job clause (`const ran =
 * true`) — which is what makes a green run with every real job SKIPPED count
 * as green, the exact e2e-real-backend push shape — turns this red.
 */
// @mutate scripts/release-gate.mjs | "--limit", "1000", | "--limit", "100",
// @mutate scripts/release-gate.mjs | const ran = auditJobs.some((j) => j.conclusion === "success"); | const ran = true;
// @mutate scripts/release-gate.mjs | auditJobs.length > 0 && auditJobs.every((j) => j.conclusion === "success"); | true;
// @mutate scripts/release-gate.mjs | check.ownJobOnly && done.conclusion === "failure"; | done.conclusion === "failure";
// @mutate scripts/release-gate.mjs | const bad = ids.filter((id) => !entry.checks.includes(id)); | const bad = [];
// @mutate scripts/release-gate.mjs | waived.has(v.id) && v.state !== "green" | v.state !== "green"

const REPO = resolve(__dirname, "../..");
const WORKFLOWS = join(REPO, ".github/workflows");

type Check = { id: string; workflow: string; file: string; job: RegExp };
type Run = { databaseId: number; workflowName: string; conclusion: string; status: string; createdAt: string; headSha: string; url?: string };
const CHECKS = REQUIRED_CHECKS as Check[];
const SHA = "a".repeat(40);

function run(workflowName: string, conclusion: string, status = "completed", id = 1, createdAt = "2026-09-12T00:00:00Z"): Run {
  return { databaseId: id, workflowName, conclusion, status, createdAt, headSha: SHA };
}

describe("release gate wiring", () => {
  it("every required check names a workflow file that exists, with that exact name", () => {
    for (const c of CHECKS) {
      const src = readFileSync(join(WORKFLOWS, c.file), "utf8");
      const name = /^name:\s*(.+?)\s*$/m.exec(src)?.[1];
      expect(name, `${c.file} name:`).toBe(c.workflow);
      // The job pattern must match a job `name:` (or key) in that file, else the
      // check can never be anything but HOLLOW.
      const jobNames = [...src.matchAll(/^ {4}name:\s*(.+?)\s*$/gm)].map((m) => m[1].replace(/\$\{\{[^}]*\}\}/g, "x"));
      const jobKeys = [...src.matchAll(/^ {2}([a-z0-9_-]+):\s*$/gm)].map((m) => m[1]);
      expect([...jobNames, ...jobKeys].some((n) => c.job.test(n)), `${c.file}: no job matches ${c.job}`).toBe(true);
    }
  });

  it("every lane that uploads to Apple is gated, and ios-beta.yml runs the gate before the macOS job", () => {
    const fastfile = readFileSync(join(REPO, "fastlane/Fastfile"), "utf8");
    // Lanes that call upload_to_testflight / upload_to_app_store with an ipa.
    const shipping = [...fastfile.matchAll(/lane :(\w+) do([\s\S]*?)\n {2}end\n/g)]
      .filter(([, , body]) => /upload_to_testflight|ipa:\s*"build\//.test(body))
      .map(([, name]) => name);
    expect(shipping.length).toBeGreaterThanOrEqual(2);
    const gated = /release_gate! if %i\[([^\]]+)\]\.include\?\(lane\)/.exec(fastfile)?.[1].split(/\s+/) ?? [];
    for (const lane of shipping) expect(gated, `lane :${lane} ships an ipa but before_all does not gate it`).toContain(lane);

    const beta = readFileSync(join(WORKFLOWS, "ios-beta.yml"), "utf8");
    const gateAt = beta.indexOf("scripts/release-gate.mjs");
    const macosAt = beta.indexOf("runs-on: macos");
    expect(gateAt).toBeGreaterThan(0);
    expect(gateAt, "the gate must run before the macOS job is declared").toBeLessThan(macosAt);
    expect(beta).toMatch(/actions:\s*read/);
  });

  it("no other workflow uploads to TestFlight without the gate", () => {
    for (const f of readdirSync(WORKFLOWS).filter((x) => x.endsWith(".yml"))) {
      const src = readFileSync(join(WORKFLOWS, f), "utf8");
      if (/fastlane ios (beta|release)\b/.test(src)) expect(src, `${f} runs a shipping lane`).toContain("release-gate.mjs");
    }
  });
});

describe("release gate verdicts", () => {
  const allGreenJobs = () => CHECKS.flatMap((c) => ({ name: sampleJobName(c), conclusion: "success" }));
  function sampleJobName(c: Check): string {
    // A name each pattern accepts.
    return {
      test: "Lint, type-check, build, test",
      "e2e-real-backend": "Authenticated journeys (real account)",
      journeys: "Journeys (journeys-webkit)",
      "press-every-control": "Press every control (shard 1/4)",
      "a11y-prod": "WebKit-only violations",
      "write-contract": "refresh",
    }[c.id] as string;
  }
  const green = CHECKS.map((c, i) => run(c.workflow, "success", "completed", i + 1));

  it("is green only when every check has a successful run whose audit job ran", () => {
    const v = evaluate(SHA, green, allGreenJobs) as { id: string; state: string }[];
    expect(v.map((x) => x.state)).toEqual(CHECKS.map(() => "green"));
  });

  it("MISSING when a workflow has no run for the sha", () => {
    const v = evaluate(SHA, green.filter((r) => r.workflowName !== "Test"), allGreenJobs) as { id: string; state: string }[];
    expect(v.find((x) => x.id === "test")?.state).toBe("missing");
  });

  it("RED when the newest completed run failed or was cancelled", () => {
    const runs = green.map((r) => (r.workflowName === "Test" ? { ...r, conclusion: "cancelled" } : r));
    const v = evaluate(SHA, runs, allGreenJobs) as { id: string; state: string }[];
    expect(v.find((x) => x.id === "test")?.state).toBe("red");
  });

  it("HOLLOW when the run is green but every audit job was skipped (the e2e-real-backend push shape)", () => {
    const jobs = (id: number) =>
      id === 2
        ? [{ name: "What can run", conclusion: "success" }, { name: "Authenticated journeys (real account)", conclusion: "skipped" }]
        : allGreenJobs();
    const v = evaluate(SHA, green, jobs) as { id: string; state: string; jobs?: string[] }[];
    const e2e = v.find((x) => x.id === "e2e-real-backend");
    expect(e2e?.state).toBe("hollow");
    expect(e2e?.jobs).toEqual(["Authenticated journeys (real account)=skipped"]);
  });

  it("a newer main batch (anon tier by design) does not supersede a full run of the sha", () => {
    const batchRun = { ...run("E2E real backend", "success", "completed", 77, "2026-09-12T09:00:00Z"), displayTitle: `E2E real backend (main batch ${SHA})` };
    const jobs = (id: number) => (id === 77 ? [{ name: "Authenticated journeys (real account)", conclusion: "skipped" }] : allGreenJobs());
    const v = evaluate(SHA, [batchRun, ...green], jobs) as { id: string; state: string }[];
    expect(v.find((x) => x.id === "e2e-real-backend")?.state).toBe("green");
  });

  it("e2e-real-backend is judged by its own job: other legs failing do not turn it red (owner 11-03)", () => {
    type V = { id: string; state: string };
    const ev = (r: Run[], j: (id: number) => { name: string; conclusion: string }[]) => evaluate(SHA, r, j) as V[];
    const runs = green.map((r) => (r.workflowName === "E2E real backend" ? { ...r, conclusion: "failure" } : r));
    const legs = (ownConclusion: string) => (id: number) =>
      runs.find((r) => r.databaseId === id)?.workflowName === "E2E real backend"
        ? [{ name: "Authenticated journeys (real account)", conclusion: ownConclusion }, { name: "Full money loop", conclusion: "failure" }, { name: "Gift card", conclusion: "failure" }]
        : allGreenJobs();
    expect(ev(runs, legs("success")).find((v: V) => v.id === "e2e-real-backend")?.state).toBe("green");
    expect(ev(runs, legs("failure")).find((v: V) => v.id === "e2e-real-backend")?.state).toBe("red");
    expect(ev(runs, legs("skipped")).find((v: V) => v.id === "e2e-real-backend")?.state).toBe("red");
    // Only e2e-real-backend has this rule: any other check's failed run stays red even if its job passed.
    const testRed = green.map((r) => (r.workflowName === "Test" ? { ...r, conclusion: "failure" } : r));
    expect(ev(testRed, () => allGreenJobs()).find((v: V) => v.id === "test")?.state).toBe("red");
    // A cancelled run stays red.
    const cancelled = green.map((r) => (r.workflowName === "E2E real backend" ? { ...r, conclusion: "cancelled" } : r));
    expect(ev(cancelled, () => allGreenJobs()).find((v: V) => v.id === "e2e-real-backend")?.state).toBe("red");
  });

  it("RUNNING while a run is in flight and nothing completed", () => {
    const runs = green.map((r) => (r.workflowName === "Test" ? { ...r, status: "in_progress", conclusion: "" } : r));
    const v = evaluate(SHA, runs, allGreenJobs) as { id: string; state: string }[];
    expect(v.find((x) => x.id === "test")?.state).toBe("running");
  });

  it("a later green re-run supersedes an earlier red", () => {
    const runs = [
      run("Test", "success", "completed", 99, "2026-09-12T02:00:00Z"),
      ...green.map((r) => (r.workflowName === "Test" ? { ...r, conclusion: "failure" } : r)),
    ];
    const v = evaluate(SHA, runs, allGreenJobs) as { id: string; state: string }[];
    expect(v.find((x) => x.id === "test")?.state).toBe("green");
  });
});

describe("release gate reads every run of the sha", () => {
  it("does not cut the run list off at a page that per-push workflows can fill", () => {
    const script = readFileSync(resolve(process.cwd(), "scripts/release-gate.mjs"), "utf8");
    expect(script).toContain('"--commit", sha, "--limit", "1000",');
  });
});

describe("owner waivers are exact: named checks, named version, nothing else", () => {
  it("OWNER_WAIVERS holds only the 1.0.4 owner decisions (Press + A11y at 11:50 AM; all six at 6:21 PM)", () => {
    expect(OWNER_WAIVERS).toEqual({
      "1.0.4": {
        checks: ["press-every-control", "a11y-prod", "test", "e2e-real-backend", "journeys", "write-contract"],
        decision: expect.stringContaining("Waive GitHub checks, build now"),
      },
    });
    for (const id of OWNER_WAIVERS["1.0.4"].checks) expect(CHECKS.map((c) => c.id)).toContain(id);
  });

  it("refuses a check the owner did not waive, and any other version", () => {
    expect(() => resolveWaivers(["no-such-check"], "1.0.4")).toThrow(/not an owner-approved waiver/);
    expect(() => resolveWaivers(["journeys"], "1.0.5")).toThrow(/no owner waiver exists for version 1.0.5/);
    expect(() => resolveWaivers(["a11y-prod"], "1.0.5")).toThrow(/no owner waiver exists for version 1.0.5/);
    expect([...resolveWaivers([], "9.9.9")]).toEqual([]);
  });

  it("a waived red does not block; an unwaived red still does", () => {
    const v = [
      { id: "press-every-control", state: "red", conclusion: "failure" },
      { id: "a11y-prod", state: "running" },
      { id: "journeys", state: "red", conclusion: "failure" },
      { id: "test", state: "green" },
    ];
    const out = applyWaivers(v, resolveWaivers(["press-every-control", "a11y-prod"], "1.0.4"), "why") as { id: string; state: string; realState?: string }[];
    expect(out.map((x) => [x.id, x.state])).toEqual([
      ["press-every-control", "waived"],
      ["a11y-prod", "waived"],
      ["journeys", "red"],
      ["test", "green"],
    ]);
    expect(out[0].realState).toBe("red");
  });

  it("ios-beta.yml offers only none or the owner's waived sets, and feeds both gate runs", () => {
    const yml = readFileSync(join(WORKFLOWS, "ios-beta.yml"), "utf8");
    const opts = /waive_checks:[\s\S]*?options:\n((?:\s+- .+\n)+)/.exec(yml)?.[1].trim().split(/\n\s*/).map((l) => l.replace(/^- /, ""));
    expect(opts).toEqual(["none", "press-every-control,a11y-prod", "press-every-control,a11y-prod,test,e2e-real-backend,journeys,write-contract"]);
    expect(yml.match(/LH_RELEASE_GATE_WAIVE:/g)?.length).toBe(2);
  });
});
