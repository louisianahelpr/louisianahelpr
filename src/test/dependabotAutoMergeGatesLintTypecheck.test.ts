// @mutate .github/workflows/dependabot-auto-merge.yml | workflows: ["Test"] | workflows: ["Something Else"]
// @mutate .github/workflows/dependabot-auto-merge.yml | github.event.workflow_run.conclusion == 'success' | true
// @mutate .github/workflows/dependabot-auto-merge.yml | gh pr merge "$PR_NUMBER" --repo "$REPO" --auto --squash | gh pr merge "$PR_NUMBER" --repo "$REPO" --squash
// @mutate .github/workflows/dependabot-auto-merge.yml | if [ "$AUTHOR" != "dependabot[bot]" ]; then | if false; then
// @mutate .github/workflows/test.yml | run: npm run lint | run: echo "lint skipped"
// @mutate .github/workflows/test.yml | run: npx tsc -b --noEmit | run: echo "typecheck skipped"
/*
 * CLASS GUARD (Q312, docs/OPEN.md): dependency-bump PRs (dependabot; weekly,
 * .github/dependabot.yml) must pass lint AND typecheck before they auto-merge.
 *
 * MEASURED on 2026-09-23:
 *   - main's branch-protection required-checks list is exactly
 *     ["Playwright happy-path smoke (mocked Supabase, mobile viewport)",
 *      "Playwright mobile viewports (320 / 375 / 414 / 768 / 1024)",
 *      "Vitest unit tests"] — "Lint, type-check, build, test" (test.yml,
 *     the job that runs `npm run lint` + `npx tsc -b --noEmit`) is NOT
 *     required by branch protection.
 *   - No dependabot PR had auto-merge enabled at all (`gh pr view --json
 *     autoMergeRequest` was null on open PRs #1653/#1652), and both had
 *     "Lint, type-check, build, test" failing red at the same time.
 *
 * So the gap was not "lint/typecheck don't run on dependency PRs" (test.yml
 * already runs both on every `pull_request`) — it was that nothing tied
 * auto-merge to that job's result, so a future auto-merge setup could ignore
 * it entirely (branch protection alone would not have caught a red lint or
 * typecheck run).
 *
 * This guard reads the workflow YAML as TEXT/structure (never executes it)
 * and fails if either becomes true again:
 *   1. Dependency PRs stop getting lint or typecheck on pull_request.
 *   2. Any auto-merge path for a dependabot PR could fire without first
 *      confirming the Test workflow (lint+typecheck) succeeded.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";

const ROOT = resolve(__dirname, "../..");
const WF_DIR = join(ROOT, ".github/workflows");
const TEST_WF = join(WF_DIR, "test.yml");
const AUTOMERGE_WF = join(WF_DIR, "dependabot-auto-merge.yml");

type Step = { run?: string; uses?: string; if?: string };
type Job = { steps?: Step[]; if?: string };
type Wf = { on: Record<string, unknown>; jobs: Record<string, Job> };

function loadWf(path: string): Wf {
  const d = parse(readFileSync(path, "utf8")) as Record<string | number, unknown>;
  const on = (d.on ?? d["true"]) as unknown;
  return {
    on: on && typeof on === "object" ? (on as Record<string, unknown>) : {},
    jobs: (d.jobs ?? {}) as Record<string, Job>,
  };
}

function allRunText(w: Wf): string {
  return Object.values(w.jobs)
    .flatMap((j) => (j.steps ?? []).map((s) => s.run ?? ""))
    .join("\n");
}

/** Every workflow file in .github/workflows, parsed. */
function allWorkflows(): Map<string, Wf> {
  const out = new Map<string, Wf>();
  for (const file of readdirSync(WF_DIR).filter((f) => f.endsWith(".yml"))) {
    out.set(file, loadWf(join(WF_DIR, file)));
  }
  return out;
}

describe("dependency-bump PRs get lint + typecheck, and auto-merge cannot bypass them (Q312)", () => {
  it("the Test workflow runs on pull_request and actually runs lint AND typecheck", () => {
    const wf = loadWf(TEST_WF);
    expect(wf.on, "test.yml must still trigger on pull_request — dependabot PRs are PRs").toHaveProperty("pull_request");
    const text = allRunText(wf);
    expect(text, "no step runs `npm run lint` (eslint)").toMatch(/npm run lint(\s|$)/m);
    expect(text, "no step runs the TypeScript type check").toMatch(/tsc -b --noEmit|npm run typecheck(\s|$)/m);
  });

  it("test.yml's pull_request trigger is not paths-ignored for dependency manifests", () => {
    const wf = loadWf(TEST_WF);
    const pr = (wf.on as Record<string, unknown>).pull_request as { "paths-ignore"?: string[] } | undefined;
    const ignored = pr?.["paths-ignore"] ?? [];
    for (const manifest of ["package.json", "package-lock.json"]) {
      expect(ignored.some((p) => p.includes(manifest)), `${manifest} must not be paths-ignored on pull_request, or dependabot PRs would never run lint/typecheck at all`).toBe(false);
    }
  });

  it("dependabot-auto-merge.yml exists and is keyed off the Test workflow's completion, not off pull_request directly", () => {
    const wf = loadWf(AUTOMERGE_WF);
    const wr = (wf.on as Record<string, unknown>).workflow_run as { workflows?: string[]; types?: string[] } | undefined;
    expect(wr, "dependabot-auto-merge.yml must trigger on workflow_run, so it only fires once the Test workflow has a real conclusion").toBeTruthy();
    expect(wr!.workflows).toContain("Test");
    expect(wr!.types).toContain("completed");
    expect(wf.on, "must not ALSO trigger directly on pull_request — that could race ahead of Test's conclusion").not.toHaveProperty("pull_request");
  });

  it("the auto-merge job gates on conclusion == success before calling `gh pr merge --auto`", () => {
    // Run-step text only (never the file's own comments) — a mention of
    // "gh pr merge --auto" or "dependabot[bot]" in prose must not satisfy this.
    const wf = loadWf(AUTOMERGE_WF);
    const runText = allRunText(wf);
    const jobs = Object.values(wf.jobs);
    expect(jobs.length).toBeGreaterThan(0);
    const guarded = jobs.some((j) => /workflow_run\.conclusion\s*==\s*'success'/.test(j.if ?? ""));
    expect(guarded, "the job (or a step in it) must check github.event.workflow_run.conclusion == 'success' before merging").toBe(true);
    expect(runText, "a run step must actually call gh pr merge with --auto (auto-merge, not an immediate merge)").toMatch(/gh pr merge\b[^\n]*--auto\b/);
    // Not just "the string dependabot[bot] appears somewhere" (an unreachable
    // branch's echo would satisfy that) — an actual live comparison against it
    // that can exit before the merge call.
    expect(
      runText,
      "a LIVE comparison against dependabot[bot] must gate the merge (e.g. `if [ \"$AUTHOR\" != \"dependabot[bot]\" ]`), not just a mention in an unreachable branch",
    ).toMatch(/if\s*\[[^\n]*!=\s*"dependabot\[bot\]"[^\n]*\][^\n]*;\s*then/);
  });

  it("no OTHER workflow enables auto-merge or merges a PR keyed on dependabot without going through the Test-gated workflow", () => {
    const offenders: string[] = [];
    for (const [file, wf] of allWorkflows()) {
      if (file === "dependabot-auto-merge.yml") continue;
      const text = allRunText(wf);
      if (/dependabot/i.test(text) && /gh pr merge\b/.test(text)) offenders.push(file);
    }
    expect(offenders, "only dependabot-auto-merge.yml may merge dependabot PRs; a second path could skip the Test-conclusion gate").toEqual([]);
  });

  it("fixture: the completed-conclusion check is real (a workflow_run without a success gate must fail this guard's own logic)", () => {
    const guardedYes = { on: { workflow_run: { workflows: ["Test"], types: ["completed"] } }, jobs: { a: { if: "github.event.workflow_run.conclusion == 'success'", steps: [{ run: "echo hi" }] } } } as Wf;
    const guardedNo = { on: { workflow_run: { workflows: ["Test"], types: ["completed"] } }, jobs: { a: { steps: [{ run: "echo hi" }] } } } as Wf;
    const check = (w: Wf) => Object.values(w.jobs).some((j) => /workflow_run\.conclusion\s*==\s*'success'/.test(j.if ?? ""));
    expect(check(guardedYes)).toBe(true);
    expect(check(guardedNo)).toBe(false);
  });
});
