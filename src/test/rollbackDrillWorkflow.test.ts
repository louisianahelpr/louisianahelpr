/**
 * Q69: the LIVE web rollback drill (owner decision 2026-09-27 night: a
 * workflow_dispatch job on repo secrets) can never run by itself, never
 * interleaves with a batched prod deploy, and always hands prod back.
 *
 *  - rollback-drill.yml is dispatch-only (a push/schedule trigger would roll
 *    prod back unasked);
 *  - it holds prod-deploy.yml's concurrency group, so no deploy lands mid-drill;
 *  - drill-web.mjs promotes the original deployment back in a `finally`, and
 *    the workflow has a failure-only restore step as the second net;
 *  - pickDrillTargets picks the deployment prod SERVES and an OLDER, different
 *    sha (behavioural, two-way).
 *
 * @mutate .github/workflows/rollback-drill.yml | on:\n  workflow_dispatch: | on:\n  push:\n    branches: [main]\n  workflow_dispatch:
 * @mutate .github/workflows/rollback-drill.yml | group: prod-deploy | group: rollback-drill
 * @mutate .github/workflows/rollback-drill.yml | if: failure() && steps.drill.outputs.current | if: false && steps.drill.outputs.current
 * @mutate scripts/rollback/drill-web.mjs | } finally {\n    restoreMs = await restore(cur, sha0); | } catch {\n    restoreMs = await restore(cur, sha0);
 * @mutate scripts/rollback/drillPlan.mjs | < created && deploymentSha | !== 0 && deploymentSha
 * @mutate scripts/rollback/drillPlan.mjs | && deploymentSha(d) !== liveSha) | )
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pickDrillTargets } from "../../scripts/rollback/drillPlan.mjs";

const root = process.cwd();
const wf = readFileSync(join(root, ".github/workflows/rollback-drill.yml"), "utf8");
const deployWf = readFileSync(join(root, ".github/workflows/prod-deploy.yml"), "utf8");
const script = readFileSync(join(root, "scripts/rollback/drill-web.mjs"), "utf8");

const dep = (uid: string, sha: string, created: number, readyState = "READY") => ({
  uid,
  created,
  readyState,
  meta: { githubCommitSha: sha },
});

describe("rollback-drill.yml (Q69)", () => {
  it("runs only when dispatched", () => {
    const on = wf.match(/^on:\n((?:[ ].*\n|\n)*?)(?=^\S)/m)?.[1] ?? "";
    expect(on).toMatch(/workflow_dispatch/);
    expect(on).not.toMatch(/\b(push|schedule|pull_request|workflow_run|repository_dispatch)\b/);
  });

  it("shares prod-deploy.yml's concurrency group", () => {
    const group = (s: string) => s.match(/^concurrency:\n\s+(?:#.*\n\s+)*group:\s*(\S+)/m)?.[1];
    expect(group(deployWf)).toBe("prod-deploy");
    expect(group(wf)).toBe(group(deployWf));
  });

  it("restores on failure, and the script restores in finally", () => {
    expect(wf).toMatch(/if: failure\(\) && steps\.drill\.outputs\.current[^\n]*\n[\s\S]*?drill-web\.mjs --restore/);
    expect(script).toMatch(/\} finally \{\s*\n\s*restoreMs = await restore\(cur, sha0\);/);
  });
});

describe("pickDrillTargets", () => {
  it("rolls back from the live deployment to the newest older, different sha", () => {
    const list = [
      dep("d4", "ddd", 400, "ERROR"),
      dep("d3", "ccc", 300),
      dep("d2", "ccc", 250),
      dep("d1", "bbb", 200),
      dep("d0", "aaa", 100),
    ];
    expect(list.filter((d) => d.readyState === "READY").length).toBeGreaterThan(3);
    const r = pickDrillTargets(list, "ccc");
    expect(r.current?.uid).toBe("d3");
    expect(r.previous?.uid).toBe("d1");
  });

  it("never picks a NEWER deployment as the rollback target", () => {
    const r = pickDrillTargets([dep("new", "zzz", 900), dep("live", "ccc", 500)], "ccc");
    expect(r.current?.uid).toBe("live");
    expect(r.previous).toBeNull();
  });

  it("refuses when nothing READY serves the live sha", () => {
    const r = pickDrillTargets([dep("a", "aaa", 1)], "ccc");
    expect(r.current).toBeNull();
    expect(r.reason).toMatch(/no READY/);
  });
});
