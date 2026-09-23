// @mutate scripts/lib/prodDeployDebounce.mjs | if (base && base.sha === head) { | if (false) {
// @mutate scripts/lib/prodDeployDebounce.mjs | if (base && deployPathsChanged === false) { | if (base && deployPathsChanged !== true) {
// @mutate scripts/lib/prodDeployDebounce.mjs | if (newest && now - newest.created < debounceMs) { | if (false) {
// @mutate scripts/lib/prodDeployDebounce.mjs | export const DEBOUNCE_MS = 20 * 60 * 1000; | export const DEBOUNCE_MS = 2 * 60 * 1000;
// @mutate scripts/lib/prodDeployDebounce.mjs | LIVE_OR_COMING.has(r.state) && r.sha | r.sha
// @mutate scripts/lib/prodDeployDebounce.mjs | .sort((a, b) => b.created - a.created); | .sort((a, b) => a.created - b.created);
// @mutate vercel.json | "deploymentEnabled": false | "deploymentEnabled": true
// @mutate .github/workflows/prod-deploy.yml | - cron: "*/20 * * * *" | - cron: "0 * * * *"
// @mutate .github/workflows/prod-deploy.yml | cancel-in-progress: false | cancel-in-progress: true
// @mutate .github/workflows/prod-deploy.yml | run: node scripts/prod-deploy.mjs | run: node scripts/prod-deploy.mjs --dry-run
// @mutate .github/workflows/prod-freshness.yml | if: github.event_name != 'push' | if: always()

/*
 * GUARD (docs/OPEN.md Q271): production web deploys are BATCHED.
 *
 * 2026-09-23: pushes to main made 100 Vercel deployments between 03:42Z and
 * 17:20Z (87 READY production) and hit the Hobby cap of 100/day; at the cap
 * prod stops updating behind green CI. Owner decision: batch, free, a fix may
 * go live up to ~20 minutes later.
 *
 * Pins: (1) vercel.json turns off per-push Git deployments; (2) the skip rules
 * of scripts/lib/prodDeployDebounce.mjs, as a pure function; (3) the workflow
 * that is now the only thing shipping main runs on push AND every 20 minutes
 * (so a debounced push still ships), never cancels a running deploy, and
 * really deploys; (4) prod-freshness no longer demands the just-pushed commit
 * be live on push.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { decide, summarize, DEBOUNCE_MS } from "../../scripts/lib/prodDeployDebounce.mjs";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const NOW = Date.parse("2026-09-23T18:00:00Z");
const MIN = 60_000;
const row = (sha: string, agoMin: number, state = "READY", id = `dpl_${sha.slice(0, 3)}${agoMin}`) => ({
  id,
  created: NOW - agoMin * MIN,
  state,
  sha,
});

describe("prod deploy debounce rules (Q271)", () => {
  it("debounces for 20 minutes", () => {
    expect(DEBOUNCE_MS).toBe(20 * MIN);
  });

  it("skips when prod is already at main HEAD", () => {
    const base = row(HEAD, 90);
    const d = decide({ head: HEAD, now: NOW, newest: base, base, deployPathsChanged: true });
    expect(d.action).toBe("skip");
    expect(d.reason).toMatch(/already at main HEAD/);
  });

  it("skips when no deploy path changed since prod's commit", () => {
    const base = row(OLD, 90);
    const d = decide({ head: HEAD, now: NOW, newest: base, base, deployPathsChanged: false });
    expect(d).toEqual(expect.objectContaining({ action: "skip" }));
    expect(d.reason).toMatch(/no deploy path changed/);
  });

  it("DEPLOYS when it cannot tell whether a deploy path changed (fail toward shipping)", () => {
    const base = row(OLD, 90);
    expect(decide({ head: HEAD, now: NOW, newest: base, base, deployPathsChanged: null }).action).toBe("deploy");
  });

  it("skips while the newest production deployment is under 20 minutes old", () => {
    const base = row(OLD, 19);
    const d = decide({ head: HEAD, now: NOW, newest: base, base, deployPathsChanged: true });
    expect(d.action).toBe("skip");
    expect(d.reason).toMatch(/debounced/);
  });

  it("deploys once the newest deployment is 20 minutes old or more", () => {
    const base = row(OLD, 20);
    expect(decide({ head: HEAD, now: NOW, newest: base, base, deployPathsChanged: true }).action).toBe("deploy");
  });

  it("an ERROR or CANCELED deployment still sets the debounce clock (it counted against the cap)", () => {
    const newest = row(HEAD, 5, "ERROR");
    const base = row(OLD, 90);
    const d = decide({ head: HEAD, now: NOW, newest, base, deployPathsChanged: true });
    expect(d.action).toBe("skip");
    expect(d.reason).toMatch(/debounced/);
  });

  it("deploys when there is no production deployment at all", () => {
    expect(decide({ head: HEAD, now: NOW, newest: null, base: null, deployPathsChanged: null }).action).toBe("deploy");
  });

  it("summarize: newest is the newest of any state; base is the newest live-or-coming one", () => {
    const s = summarize([
      { uid: "dpl_old", created: NOW - 90 * MIN, state: "READY", meta: { githubCommitSha: OLD } },
      { uid: "dpl_err", created: NOW - 5 * MIN, state: "ERROR", meta: { githubCommitSha: HEAD } },
      { uid: "dpl_can", created: NOW - 30 * MIN, state: "CANCELED", meta: { githubCommitSha: HEAD } },
    ]);
    expect(s.newest?.id).toBe("dpl_err");
    expect(s.base?.id).toBe("dpl_old");
    expect(s.base?.sha).toBe(OLD);
  });

  it("summarize: a BUILDING deployment of HEAD counts as prod-at-HEAD (no duplicate deploy)", () => {
    const s = summarize([
      { uid: "dpl_b", created: NOW - 25 * MIN, state: "BUILDING", meta: { githubCommitSha: HEAD } },
      { uid: "dpl_r", created: NOW - 90 * MIN, state: "READY", meta: { githubCommitSha: OLD } },
    ]);
    expect(decide({ head: HEAD, now: NOW, ...s, deployPathsChanged: true }).action).toBe("skip");
  });
});

describe("the wiring around the rules (Q271)", () => {
  it("vercel.json turns off per-push Git deployments for every branch", () => {
    const cfg = JSON.parse(read("vercel.json"));
    expect(cfg.git?.deploymentEnabled).toBe(false);
  });

  const wf = parse(read(".github/workflows/prod-deploy.yml")) as Record<string, unknown>;
  const on = (wf.on ?? (wf as Record<string, unknown>)["true"]) as Record<string, unknown>;

  it("prod-deploy.yml runs on push to main, every 20 minutes and on demand", () => {
    expect((on.push as { branches: string[] }).branches).toContain("main");
    expect((on.schedule as { cron: string }[]).map((s) => s.cron)).toContain("*/20 * * * *");
    expect("workflow_dispatch" in on).toBe(true);
  });

  it("never cancels a running deploy, and really deploys (not a dry run)", () => {
    expect((wf.concurrency as { "cancel-in-progress": boolean })["cancel-in-progress"]).toBe(false);
    const src = read(".github/workflows/prod-deploy.yml");
    const runs = src.split("\n").filter((l) => /^\s+run: node scripts\/prod-deploy\.mjs/.test(l));
    expect(runs.map((l) => l.trim())).toEqual(["run: node scripts/prod-deploy.mjs"]);
    expect(src).toMatch(/VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/);
    expect(src).toMatch(/fetch-depth: 0/);
    expect(src).toMatch(/nightly-issue-sync/);
  });

  it("the script creates a production deployment of main through the API, using the pure rules", () => {
    const src = read("scripts/prod-deploy.mjs");
    expect(src).toMatch(/import \{ decide, summarize \} from "\.\/lib\/prodDeployDebounce\.mjs"/);
    expect(src).toMatch(/target: "production"/);
    expect(src).toMatch(/gitSource: \{ type: "github", org: ORG, repo: REPO, ref: "main", sha: head \}/);
    expect(src).toMatch(/bash", \["scripts\/deploy-paths\.sh"\]/);
  });

  it("prod-freshness does not demand the just-pushed commit be live on push (deploys are batched)", () => {
    const pf = parse(read(".github/workflows/prod-freshness.yml")) as { jobs: Record<string, { if?: string }> };
    expect(pf.jobs["served-commit"].if).toBe("github.event_name != 'push'");
    expect(read(".github/workflows/prod-freshness.yml")).toMatch(/PUSH_GRACE_MINUTES: "45"/);
  });

  it("the watchers know the workflow exists", () => {
    expect(read(".github/workflows/schedule-heartbeat.yml")).toMatch(/^\s+prod-deploy\.yml:1$/m);
    expect(read(".github/workflows/main-red-watch.yml")).toMatch(/^\s+- Prod deploy$/m);
  });

  it("inventory floor: the rules file has every rule this suite pins", () => {
    const lib = read("scripts/lib/prodDeployDebounce.mjs");
    const rules = (lib.match(/return \{\s*action: "skip"/g) ?? []).length;
    expect(rules).toBeGreaterThan(2);
  });
});
