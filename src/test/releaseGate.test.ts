import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
// @ts-expect-error — plain ESM script, no declaration file
import { REQUIRED_CHECKS, evaluate } from "../../scripts/release-gate.mjs";

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
 */

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
