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
// @mutate scripts/lib/prodDeployDebounce.mjs | if (pendingMigrations.length > 0) { | if (false) {
// @mutate scripts/lib/prodDeployDebounce.mjs | if (!Array.isArray(pendingMigrations)) { | if (false) {
// @mutate scripts/lib/prodDeployDebounce.mjs | const stuck = now - oldest >= MIGRATION_STUCK_MS; | const stuck = false;
// @mutate scripts/lib/prodDeployDebounce.mjs | .filter((v) => v && !have.has(v)) | .filter((v) => v && have.has(v))
// @mutate scripts/prod-deploy.mjs | if (d.fail) throw | if (false) throw
// @mutate scripts/prod-deploy.mjs | pendingMigrations: pending, edgeDeploy | pendingMigrations: [], edgeDeploy
// @mutate .github/workflows/prod-deploy.yml | SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }} | SUPABASE_ACCESS_TOKEN_OFF: x
// @mutate .github/workflows/prod-freshness.yml | if: github.event_name != 'push' | if: always()
// @mutate scripts/lib/prodDeployDebounce.mjs | if (edgeDeploy.state !== "ok") { | if (false) {
// @mutate scripts/lib/prodDeployDebounce.mjs | if (!edgeDeploy) { | if (false) {
// @mutate scripts/lib/prodDeployDebounce.mjs | fail: edgeDeploy.state === "failed", | fail: false,
// @mutate scripts/lib/prodDeployDebounce.mjs | if (run.status !== "completed") return { state: "pending", ...base }; | if (false) return { state: "pending", ...base };
// @mutate scripts/lib/prodDeployDebounce.mjs | .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)); | .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
// @mutate scripts/lib/prodDeployDebounce.mjs | .filter((r) => r && r.head_sha && isOnHead(r.head_sha)) | .filter((r) => r && r.head_sha)
// @mutate scripts/prod-deploy.mjs | pendingMigrations: pending, edgeDeploy: edge }); | pendingMigrations: pending, edgeDeploy: { state: "ok" } });
// @mutate .github/workflows/prod-deploy.yml | GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} | GITHUB_TOKEN_OFF: x

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
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { parse } from "yaml";
import {
  decide as decideRaw,
  summarize,
  pendingMigrationVersions,
  edgeDeployState,
  DEBOUNCE_MS,
  MIGRATION_STUCK_MS,
} from "../../scripts/lib/prodDeployDebounce.mjs";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const NOW = Date.parse("2026-09-23T18:00:00Z");
const MIN = 60_000;
// The Q271 cases below are about the debounce: prod has applied every migration
// and functions-deploy is green for HEAD.
const EDGE_OK = { state: "ok" as const, runId: null, sha: null, status: null };
const decide = (input: Omit<Parameters<typeof decideRaw>[0], "pendingMigrations" | "edgeDeploy">) =>
  decideRaw({ pendingMigrations: [], edgeDeploy: EDGE_OK, ...input });
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

/*
 * GUARD (docs/OPEN.md Q1824): the web app never goes live before the migration
 * it needs. On 2026-10-14 one push's prod-deploy finished 19:52:53Z and its
 * db-deploy 19:55:30Z (gh run list), so a client writing a column the same
 * merge added failed on prod in that window. prod-deploy now reads
 * supabase_migrations.schema_migrations and holds while any migration on HEAD
 * is unapplied; it goes red when that lasts an hour or prod cannot be read.
 */
describe("prod deploy waits for main's migrations (Q1824)", () => {
  const base = row(OLD, 90);
  const ready = { head: HEAD, now: NOW, newest: base, base, deployPathsChanged: true, edgeDeploy: EDGE_OK };

  it("deploys when prod has applied every migration on HEAD", () => {
    expect(decideRaw({ ...ready, pendingMigrations: [] }).action).toBe("deploy");
  });

  it("HOLDS (without failing) while a migration on HEAD is not applied on prod yet", () => {
    const d = decideRaw({ ...ready, pendingMigrations: [{ version: "20261014205016", committedAt: NOW - 5 * MIN }] });
    expect(d.action).toBe("skip");
    expect(d.fail).toBe(false);
    expect(d.reason).toMatch(/waiting for db-deploy.*20261014205016/);
  });

  it("goes RED when a migration has sat unapplied for an hour (db-deploy stuck)", () => {
    expect(MIGRATION_STUCK_MS).toBe(60 * MIN);
    const d = decideRaw({ ...ready, pendingMigrations: [{ version: "20261014205016", committedAt: NOW - 61 * MIN }] });
    expect(d.action).toBe("skip");
    expect(d.fail).toBe(true);
  });

  it("does NOT ship when prod's applied migrations cannot be read (fail closed, red)", () => {
    const d = decideRaw({ ...ready, pendingMigrations: null });
    expect(d.action).toBe("skip");
    expect(d.fail).toBe(true);
  });

  it("pendingMigrationVersions: repo versions prod lacks, ignoring non-migration files", () => {
    const files = ["20261014184909_a.sql", "20261014205016_b.sql", "README.md", "20261015000000_c.sql"];
    expect(pendingMigrationVersions(files, ["20261014184909"])).toEqual(["20261014205016", "20261015000000"]);
    expect(pendingMigrationVersions(files, ["20261014184909", "20261014205016", "20261015000000"])).toEqual([]);
  });

  it("pendingMigrationVersions on the real supabase/migrations: the newest file unapplied is the one pending", () => {
    const real = readdirSync(join(root, "supabase/migrations"));
    const versions = real.filter((f) => /^\d{14}_.*\.sql$/.test(f)).map((f) => f.slice(0, 14)).sort();
    expect(versions.length).toBeGreaterThan(1000); // 1090 on 2026-10-14, equal to prod's schema_migrations count
    const newest = versions[versions.length - 1];
    expect(pendingMigrationVersions(real, versions.slice(0, -1))).toEqual([newest]);
    expect(pendingMigrationVersions(real, versions).length).toBe(0);
  });

  it("the script and workflow wire the check in (prod read with the Management API, a held deploy fails red)", () => {
    const src = read("scripts/prod-deploy.mjs");
    expect(src).toMatch(/select version from supabase_migrations\.schema_migrations/);
    expect(src).toMatch(/pendingMigrations: pending, edgeDeploy: edge \}\);/);
    expect(src).toMatch(/if \(d\.fail\) throw/);
    const wfSrc = read(".github/workflows/prod-deploy.yml");
    expect(wfSrc).toMatch(/SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
    expect(wfSrc).toMatch(/SUPABASE_PROJECT_REF: \$\{\{ secrets\.SUPABASE_PROJECT_REF \}\}/);
  });
});

describe("prod deploy waits for functions-deploy (edge gate, 2026-10-31)", () => {
  const base = row(OLD, 90);
  const ready = { head: HEAD, now: NOW, newest: base, base, deployPathsChanged: true, pendingMigrations: [] };
  const ANC = "c".repeat(40); // an ancestor of HEAD
  const OTHER = "d".repeat(40); // not in HEAD's history
  const onHead = (sha: string) => sha === HEAD || sha === ANC || sha === OLD;
  const run = (id: number, head_sha: string, status: string, conclusion: string | null, agoMin: number) => ({
    id,
    head_sha,
    status,
    conclusion,
    created_at: new Date(NOW - agoMin * MIN).toISOString(),
  });

  it("2026-10-31's case: migrations applied, edge still deploying, a push run -> SKIP (not deploy)", () => {
    // #3892: 8b68c21a77 merged; functions-deploy 41232537450 in progress on it;
    // the bot push 7121ae45e9 (a child of it) ran prod-deploy once db-deploy had applied the migrations.
    const edge = edgeDeployState([run(41232537450, ANC, "in_progress", null, 6), run(41200000000, OLD, "completed", "success", 300)], onHead);
    expect(edge.state).toBe("pending");
    const d = decideRaw({ ...ready, edgeDeploy: edge });
    expect(d.action).toBe("skip");
    expect(d.fail).toBe(false);
    expect(d.reason).toMatch(/^waiting for functions-deploy/);
    expect(d.reason).toMatch(/41232537450/);
  });

  it("a queued run holds too", () => {
    const d = decideRaw({ ...ready, edgeDeploy: edgeDeployState([run(2, HEAD, "queued", null, 1)], onHead) });
    expect(d.action).toBe("skip");
    expect(d.reason).toMatch(/waiting for functions-deploy/);
  });

  it("a FAILED edge deploy on HEAD's history holds and goes red", () => {
    for (const conclusion of ["failure", "cancelled", "timed_out", "startup_failure"]) {
      const edge = edgeDeployState([run(3, ANC, "completed", conclusion, 10)], onHead);
      expect(edge.state).toBe("failed");
      const d = decideRaw({ ...ready, edgeDeploy: edge });
      expect(d.action).toBe("skip");
      expect(d.fail).toBe(true);
      expect(d.reason).toMatch(/waiting for functions-deploy/);
    }
  });

  it("cannot read the runs -> holds, red (fail closed)", () => {
    const d = decideRaw({ ...ready, edgeDeploy: null });
    expect(d.action).toBe("skip");
    expect(d.fail).toBe(true);
    expect(d.reason).toMatch(/waiting for functions-deploy/);
  });

  it("the NEWEST run on HEAD's history decides: a later green clears an older red", () => {
    const edge = edgeDeployState([run(4, OLD, "completed", "failure", 60), run(5, ANC, "completed", "success", 20)], onHead);
    expect(edge).toMatchObject({ state: "ok", runId: 5 });
    expect(decideRaw({ ...ready, edgeDeploy: edge }).action).toBe("deploy");
    // ...and a later red after an older green holds.
    const red = edgeDeployState([run(6, OLD, "completed", "success", 60), run(7, ANC, "completed", "failure", 20)], onHead);
    expect(red).toMatchObject({ state: "failed", runId: 7 });
  });

  it("ignores runs whose commit is not HEAD or an ancestor (another branch, a dispatch on old code)", () => {
    const edge = edgeDeployState([run(8, OTHER, "in_progress", null, 1), run(9, ANC, "completed", "success", 30)], onHead);
    expect(edge).toMatchObject({ state: "ok", runId: 9 });
  });

  it("no functions-deploy run in HEAD's history -> ok", () => {
    expect(edgeDeployState([], onHead).state).toBe("ok");
    expect(decideRaw({ ...ready, edgeDeploy: edgeDeployState([], onHead) }).action).toBe("deploy");
  });

  it("the script and workflow wire it in (GitHub runs API, ancestor check, actions: read, GITHUB_TOKEN)", () => {
    const src = read("scripts/prod-deploy.mjs");
    expect(src).toMatch(/actions\/workflows\/functions-deploy\.yml\/runs\?branch=main/);
    expect(src).toMatch(/"merge-base", "--is-ancestor", sha, head/);
    expect(src).toMatch(/pendingMigrations: pending, edgeDeploy: edge \}\);/);
    const wfDoc = parse(read(".github/workflows/prod-deploy.yml")) as {
      jobs: { deploy: { permissions: Record<string, string>; steps: { id?: string; env?: Record<string, string> }[] } };
    };
    expect(wfDoc.jobs.deploy.permissions.actions).toBe("read");
    const step = wfDoc.jobs.deploy.steps.find((s) => s.id === "run");
    expect(step?.env?.GITHUB_TOKEN).toBe("${{ secrets.GITHUB_TOKEN }}");
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
    expect(src).toMatch(/import \{ decide, summarize, pendingMigrationVersions, edgeDeployState \} from "\.\/lib\/prodDeployDebounce\.mjs"/);
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
    expect(rules).toBeGreaterThan(4);
  });
});
