// @mutate .github/workflows/vitest.yml |   merge_group:\n  workflow_dispatch: |   workflow_dispatch:
// @mutate .github/workflows/test.yml |           if [ "$EVENT" = "merge_group" ]; then\n            : "${MG_BASE |           if [ "$EVENT" = "never" ]; then\n            : "${MG_BASE
// @mutate .github/workflows/test.yml | github.event.merge_group.base_sha \|\| github.event.before | github.event.before
// @mutate .github/workflows/vitest.yml |     if: ${{ always() && github.event_name != 'merge_group' }} |     if: ${{ always() }}
// @mutate .github/workflows/mobile-viewports.yml |   cancel-in-progress: ${{ github.event_name == 'pull_request' }} |   cancel-in-progress: true
// @mutate .github/workflows/e2e-happy-path.yml |         if: github.event_name != 'merge_group'\n | 
// @mutate .github/workflows/db-smoke.yml |     needs: [changes, smoke]\n    if: ${{ always() }} |     needs: [changes, smoke]
// @mutate .github/workflows/db-smoke.yml |             test "$SMOKE" = "success" |             true
// @mutate .github/workflows/db-smoke.yml |       - "scripts/ci/null-uid-trust.sql"\n | 
// @mutate .github/workflows/codeql.yml |   merge_group:\n | 
// @mutate .github/workflows/land-queue.yml |  && github.event.workflow_run.event != 'merge_group' | 
// @mutate .github/workflows/secret-scan.yml | , "gh-readonly-queue/**"] | ]
/*
 * The repo side of GitHub's merge queue (owner 2026-10-30; ruleset 24543186).
 *
 * A required check that does not report on the queue's merge_group event leaves
 * every PR in the queue waiting. These are the ways the workflows can fail that
 * without any file looking wrong:
 *   - no merge_group trigger, or a paths filter that stops the check starting;
 *   - an `$EVENT = pull_request` branch that sends the queue down the push path:
 *     inventories drift only warns, the fixes-update-items step has no base and
 *     judges nothing, the asset-weight check loses its base;
 *   - a required job skipped on the queue instead of reporting;
 *   - a queue run reaching a deploy, or waking a listener that does work.
 *
 * The GitHub side (the ruleset's merge_queue rule, CodeQL default setup off) is
 * a setting, so nothing here can prove it: one real PR through the queue does.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { WORKFLOW_CHECKS } from "./helpers/requiredChecks";
import { readdirSync } from "./helpers/trackedFiles";
import { isProtected, isStranded } from "../../scripts/prune-stale-branches.mjs";

const ROOT = join(__dirname, "..", "..");
const DIR = join(ROOT, ".github/workflows");
type Step = { name?: string; id?: string; if?: string; run?: string; uses?: string; env?: Record<string, string>; with?: Record<string, string> };
type Job = { name?: string; if?: string; needs?: string | string[]; steps?: Step[] };
type Wf = { on: Record<string, unknown>; concurrency?: { group?: string; "cancel-in-progress"?: unknown }; jobs: Record<string, Job> };

const text = (f: string) => readFileSync(join(DIR, f), "utf8");
const wf = (f: string) => {
  const d = parse(text(f)) as Record<string | number, unknown>;
  return { ...d, on: (d.on ?? d["true"]) as Record<string, unknown> } as unknown as Wf;
};
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".yml"));
const QUEUE_FILES = [...WORKFLOW_CHECKS.map((c) => c.workflow.replace(".github/workflows/", "")), "codeql.yml"].sort();
const stepsOf = (f: string) => Object.values(wf(f).jobs).flatMap((j) => j.steps ?? []);

describe("merge queue: every required check reports", () => {
  it("the queue's workflows are found, and only they run on merge_group", () => {
    expect(QUEUE_FILES.length).toBeGreaterThan(4);
    const onQueue = FILES.filter((f) => typeof wf(f).on === "object" && wf(f).on && "merge_group" in wf(f).on).sort();
    // Exact both ways: a new merge_group workflow has to be judged for deploys here.
    expect(onQueue).toEqual(QUEUE_FILES);
  });

  it.each(QUEUE_FILES)("%s starts on the queue and on every PR", (f) => {
    const on = wf(f).on as Record<string, { paths?: unknown; "paths-ignore"?: unknown } | null>;
    expect(on).toHaveProperty("merge_group");
    expect(on.pull_request?.paths).toBeUndefined();
    expect(on.pull_request?.["paths-ignore"]).toBeUndefined();
    expect(on.merge_group).toBeNull();
  });

  it.each(QUEUE_FILES)("%s is never cancelled on the queue, and each entry has its own group", (f) => {
    const c = wf(f).concurrency;
    expect(c?.group).toContain("github.ref");
    expect(c?.["cancel-in-progress"]).toBe("${{ github.event_name == 'pull_request' }}");
  });

  it.each(WORKFLOW_CHECKS.map((c) => [c.name, c.workflow.replace(".github/workflows/", "")]))(
    "the job carrying %s cannot be skipped on the queue",
    (name, f) => {
      const jobs = Object.values(wf(f).jobs).filter((j) => j.name === name);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].if ?? "always()").toContain("always()");
    },
  );
});

describe("merge queue: nothing takes the push path by accident", () => {
  it("every test.yml step that branches on the event handles merge_group", () => {
    const branching = stepsOf("test.yml").filter((s) => /\$EVENT" (=|!=) "pull_request"/.test(s.run ?? ""));
    expect(branching.length).toBeGreaterThan(1);
    for (const s of branching) {
      expect(s.run, s.name).toMatch(/\$EVENT" = "merge_group"/);
      expect(s.env?.MG_BASE, s.name).toBe("${{ github.event.merge_group.base_sha }}");
      expect(s.env?.MG_HEAD, s.name).toBe("${{ github.event.merge_group.head_sha }}");
    }
  });

  it("the queue's inventory check judges the entry; it does not stop at the push warning", () => {
    const run = stepsOf("test.yml").find((s) => s.name?.startsWith("Committed inventories"))?.run ?? "";
    const queue = run.indexOf('"$EVENT" = "merge_group"');
    expect(queue).toBeGreaterThan(-1);
    expect(queue).toBeLessThan(run.indexOf("::warning::"));
    expect(run.slice(queue, run.indexOf("::warning::"))).toContain("--attribute --head \"$MG_HEAD\" --base \"$MG_BASE\"");
  });

  it("the asset-weight check has the queue's base", () => {
    const run = stepsOf("test.yml").find((s) => s.name === "No oversized binary enters git history")?.run ?? "";
    expect(run).toContain("github.event.merge_group.base_sha || github.event.before");
  });

  it("Vitest's first scope step diffs the queue entry and fails to the whole suite", () => {
    const scope = wf("vitest.yml").jobs["vitest-shard"].steps?.find((s) => s.id === "scope")?.run ?? "";
    expect(scope).toContain('elif [ "$EVENT" = "merge_group" ]');
    expect(scope).toContain('git diff --no-renames --name-only "$MG_BASE" "$MG_HEAD"');
    expect(scope).toMatch(/not readable: the whole suite runs"\n\s*echo '\{"docsOnly":false/);
  });

  it("the coverage jobs stay out of the queue, and the required Vitest job stays in", () => {
    const jobs = wf("vitest.yml").jobs;
    expect(jobs["coverage-shard"].if).toContain("github.event_name != 'merge_group'");
    expect(jobs.coverage.if).toContain("github.event_name != 'merge_group'");
    expect(jobs["vitest-shard"].if).toBeUndefined();
    expect(jobs.vitest.if).toBe("${{ always() }}");
  });

  it.each(["e2e-happy-path.yml", "mobile-viewports.yml"])("%s runs in full on the queue, with no filter step to fail", (f) => {
    const steps = stepsOf(f);
    expect(steps.find((s) => s.id === "filter")?.if).toBe("github.event_name != 'merge_group'");
    const gated = steps.filter((s) => (s.if ?? "").includes("steps.filter.outputs.ui"));
    expect(gated.length).toBeGreaterThan(2);
    for (const s of gated) expect(s.if).toMatch(/^github\.event_name != 'pull_request' \|\|/);
  });
});

describe("merge queue: DB Smoke reports every time", () => {
  const smoke = wf("db-smoke.yml");
  const report = smoke.jobs.report;
  const reportRun = report?.steps?.[0].run ?? "";

  it("the required name is on a job that always runs and needs both sides", () => {
    expect(report?.name).toBe("Apply migrations + post-job trigger smoke");
    expect(report?.if).toBe("${{ always() }}");
    expect(report?.needs).toEqual(["changes", "smoke"]);
  });

  it("it is green only for a passed smoke or a skip that `changes` decided", () => {
    expect(reportRun).toContain('test "$CHANGES" = "success"');
    expect(reportRun).toMatch(/if \[ "\$RUN" = "false" \]; then\n\s*test "\$SMOKE" = "skipped"\n\s*else\n\s*test "\$SMOKE" = "success"\n\s*fi/);
    expect(report?.steps?.[0].env).toMatchObject({ CHANGES: "${{ needs.changes.result }}", RUN: "${{ needs.changes.outputs.run }}", SMOKE: "${{ needs.smoke.result }}" });
  });

  it("only a clear false from a PR or the queue skips; db-deploy's call always runs it all", () => {
    expect(Object.keys(smoke.on)).toContain("workflow_call");
    expect(smoke.jobs.smoke.if).toBe("${{ needs.changes.outputs.run != 'false' }}");
    const decide = smoke.jobs.changes.steps?.find((s) => s.id === "decide")?.run ?? "";
    expect(decide).toMatch(/^RUN=true$/m);
    expect(decide).toContain('{ [ "$EVENT" = "pull_request" ] || [ "$EVENT" = "merge_group" ]; } && [ "$SQL" = "false" ]');
    expect((parse(text("db-deploy.yml")) as Wf).jobs["guard-db-smoke"]).toMatchObject({ uses: "./.github/workflows/db-smoke.yml" });
  });

  it("the filter names every script the smoke steps read", () => {
    const filter = smoke.jobs.changes.steps?.find((s) => s.id === "filter")?.with?.filters ?? "";
    const smokeRuns = (smoke.jobs.smoke.steps ?? []).map((s) => s.run ?? "").join("\n");
    const read = [...new Set(smokeRuns.match(/scripts\/(?:ci|sql)\/[\w-]+\.(?:sql|sh)/g) ?? [])];
    expect(read.length).toBeGreaterThan(8);
    for (const f of read) expect(filter, f).toContain(`"${f}"`);
    expect(filter).toContain('"supabase/migrations/**"');
  });
});

describe("merge queue: CodeQL has its own workflow", () => {
  it("same languages and suite as default setup, and it can upload", () => {
    const y = text("codeql.yml");
    const job = wf("codeql.yml").jobs.analyze as Job & { strategy: { matrix: { language: string[] } }; permissions: Record<string, string> };
    expect(job.strategy.matrix.language).toEqual(["actions", "javascript-typescript"]);
    expect(job.permissions["security-events"]).toBe("write");
    expect(y).toContain("queries: security-extended");
    expect(wf("codeql.yml").on).toHaveProperty("schedule");
  });

  it("refresh-pr's fallback dispatch has it and DB Smoke", () => {
    const list = readFileSync(join(ROOT, ".github/actions/refresh-pr/action.yml"), "utf8").match(/\$\{CHECK_WORKFLOWS:-([^}]*)\}/)?.[1].split(/\s+/) ?? [];
    expect(list).toEqual(expect.arrayContaining(QUEUE_FILES));
  });
});

describe("merge queue: a queue run deploys nothing and wakes nothing", () => {
  it("no merge_group workflow deploys", () => {
    for (const f of QUEUE_FILES) {
      const runs = stepsOf(f).map((s) => `${s.run ?? ""} ${s.uses ?? ""}`).join("\n");
      expect(runs, f).not.toMatch(/supabase\s+db\s+push|functions\s+deploy|vercel\s+(?:deploy|--prod)|v13\/deployments|fastlane|gh workflow run/);
    }
  });

  it("every deploy workflow still runs only from main, a tag or a dispatch", () => {
    const deploys = ["prod-deploy.yml", "db-deploy.yml", "functions-deploy.yml", "sentry-release.yml", "deploy.yml"];
    for (const f of deploys) {
      const on = wf(f).on as Record<string, { branches?: string[]; tags?: string[] }>;
      expect(on, f).not.toHaveProperty("merge_group");
      expect(on, f).not.toHaveProperty("workflow_run");
      expect(on.push?.branches ?? on.push?.tags, f).toBeDefined();
      if (on.push?.branches) expect(on.push.branches, f).toEqual(["main"]);
    }
  });

  it("every workflow_run listener on a queue workflow filters queue runs out", () => {
    const names = new Set(QUEUE_FILES.map((f) => (parse(text(f)) as { name: string }).name));
    const listeners = FILES.filter((f) => {
      const run = (wf(f).on as { workflow_run?: { workflows?: string[] } } | null)?.workflow_run;
      return run?.workflows?.some((w) => names.has(w));
    });
    expect(listeners.length).toBeGreaterThan(1);
    for (const f of listeners) {
      const run = (wf(f).on as { workflow_run: { branches?: string[] } }).workflow_run;
      const jobIfs = Object.values(wf(f).jobs).map((j) => String(j.if ?? ""));
      const filtered = !!run.branches?.length || jobIfs.every((i) => i.includes("github.event.workflow_run.event != 'merge_group'"));
      expect(filtered, `${f} would start work for every merge queue run`).toBe(true);
    }
  });

  it("the queue's branch is left alone by push scans and by branch prune", () => {
    expect((wf("secret-scan.yml").on as { push: { "branches-ignore": string[] } }).push["branches-ignore"]).toContain("gh-readonly-queue/**");
    const name = "gh-readonly-queue/main/pr-1-abc";
    expect(isProtected(name)).toBe(true);
    expect(isStranded({ name, hasOpenPr: false, ageHours: 5, uncovered: [{}] })).toBe(false);
    expect(isStranded({ name: "fix/other", hasOpenPr: false, ageHours: 5, uncovered: [{}] })).toBe(true);
  });
});
