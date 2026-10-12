// @mutate scripts/lib/requiredActiveWorkflows.mjs |     .filter((w) => w.state !== "active"); |     .filter((w) => w.state === "deleted");
// @mutate scripts/lib/requiredActiveWorkflows.mjs |   "open-auto-tick.yml", |   // "open-auto-tick.yml",
// @mutate scripts/lib/requiredActiveWorkflows.mjs |     .map((file) => ({ file, state: state.get(file) ?? "missing from the API listing" })) |     .map((file) => ({ file, state: state.get(file) ?? "active" }))
// @mutate scripts/check-workflows-active.mjs |   if (rows.length < REQUIRED_ACTIVE.length) { |   if (false) {
// @mutate scripts/check-workflows-active.mjs |   process.exit(bad.length ? 1 : 0); |   process.exit(0);
// @mutate .github/workflows/branch-prune.yml |     needs: [prune, stranded, workflows-active] |     needs: [prune, stranded]
// @mutate .github/workflows/staleness-watch.yml |         run: node scripts/check-workflows-active.mjs |         run: echo skipped
/*
 * Bot-workflow watchdog (owner, 2026-10-12: "make sure nothing can be messed
 * up so we can finish the open list smoothly").
 *
 * open-auto-tick.yml was `disabled_manually` from ~2026-10-07 until the lead
 * re-enabled it 2026-10-12 03:45Z, with no record of why: a disabled workflow
 * has no run, so no red run and no alert, and nothing ticked for five days.
 * scripts/check-workflows-active.mjs now reads every workflow's state over
 * REST and fails on any REQUIRED_ACTIVE workflow that is not `active`; it runs
 * in staleness-watch.yml and branch-prune.yml.
 *
 * The inventory is DERIVED from .github/workflows: every workflow with a
 * `schedule:` or `workflow_run:` trigger, and every user of the refresh-PR
 * step, is in exactly one of REQUIRED_ACTIVE / EXEMPT_FROM_ACTIVE (with a
 * reason); both lists name only files that exist.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { EXEMPT_FROM_ACTIVE, REQUIRED_ACTIVE, inactiveRequired } from "../../scripts/lib/requiredActiveWorkflows.mjs";
import { parseStates } from "../../scripts/check-workflows-active.mjs";

const ROOT = join(__dirname, "..", "..");
const WF = join(ROOT, ".github/workflows");
const files = readdirSync(WF).filter((f) => f.endsWith(".yml")).sort();
const docs = files.map((file) => {
  const text = readFileSync(join(WF, file), "utf8");
  const d = parse(text) as Record<string | number, unknown>;
  const on = (d.on ?? d["true"]) as unknown;
  const triggers = typeof on === "string" ? [on] : Array.isArray(on) ? (on as string[]) : Object.keys((on ?? {}) as object);
  const steps = Object.values((d.jobs ?? {}) as Record<string, { steps?: { uses?: string }[] }>).flatMap((j) => j.steps ?? []);
  return { file, triggers, refreshBot: steps.some((s) => s.uses === "./.github/actions/refresh-pr") };
});

describe("every bot workflow must stay enabled (watchdog inventory)", () => {
  const runsOnItsOwn = docs.filter((d) => d.triggers.includes("schedule") || d.triggers.includes("workflow_run") || d.refreshBot).map((d) => d.file);

  it("reads the real workflows (floors)", () => {
    expect(files.length).toBeGreaterThan(60);
    expect(runsOnItsOwn.length).toBeGreaterThan(40);
    expect(REQUIRED_ACTIVE.length).toBeGreaterThan(40);
  });

  it("every workflow that runs on its own is in exactly one list", () => {
    const exempt = Object.keys(EXEMPT_FROM_ACTIVE);
    const missing = runsOnItsOwn.filter((f) => !REQUIRED_ACTIVE.includes(f) && !exempt.includes(f));
    expect(missing, "add each to REQUIRED_ACTIVE (scripts/lib/requiredActiveWorkflows.mjs), or to EXEMPT_FROM_ACTIVE with the reason it may be disabled").toEqual([]);
    expect(REQUIRED_ACTIVE.filter((f) => exempt.includes(f)), "in both lists").toEqual([]);
    expect(new Set(REQUIRED_ACTIVE).size).toBe(REQUIRED_ACTIVE.length);
  });

  it("both lists are two-way: every entry is a real workflow; an exempt one still runs on its own and says why", () => {
    for (const f of [...REQUIRED_ACTIVE, ...Object.keys(EXEMPT_FROM_ACTIVE)]) expect(files, `${f} does not exist`).toContain(f);
    for (const [f, why] of Object.entries(EXEMPT_FROM_ACTIVE)) {
      expect(runsOnItsOwn, `${f} no longer runs on its own: drop it from EXEMPT_FROM_ACTIVE`).toContain(f);
      expect(why.length).toBeGreaterThan(60);
    }
  });

  it("the owner's named workflows are required", () => {
    const named = [
      "open-auto-tick.yml", "open-done-when.yml", "db-deploy.yml", "functions-deploy.yml", "prod-deploy.yml", "db-backup.yml",
      "branch-prune.yml", "staleness-watch.yml", "scoreboard.yml", "loading-states-refresh.yml", "morning-page.yml",
      "write-contract-refresh.yml",
      "e2e-real-backend.yml", "e2e-journeys.yml", "nightly-webkit.yml",
    ];
    for (const f of named) {
      expect(REQUIRED_ACTIVE, f).toContain(f);
    }
  });

  it("two watchers run the check, and branch-prune reports its result", () => {
    expect(readFileSync(join(WF, "staleness-watch.yml"), "utf8")).toMatch(/^\s+run: node scripts\/check-workflows-active\.mjs$/m);
    const bp = parse(readFileSync(join(WF, "branch-prune.yml"), "utf8"));
    const job = bp.jobs["workflows-active"];
    expect(job.steps.map((s: { run?: string }) => s.run)).toContain("node scripts/check-workflows-active.mjs");
    expect(job.permissions).toMatchObject({ actions: "read" });
    expect(bp.jobs.notify.needs).toContain("workflows-active");
    const sync = bp.jobs.notify.steps.find((s: { uses?: string }) => String(s.uses).includes("nightly-issue-sync"));
    expect(sync.with.status).toContain("needs.workflows-active.result == 'success'");
  });
});

describe("the watchdog's decision", () => {
  const active = REQUIRED_ACTIVE.map((f) => ({ path: `.github/workflows/${f}`, state: "active" }));

  it("all active: nothing reported", () => {
    expect(inactiveRequired(active)).toEqual([]);
  });

  it("re-disabling open-auto-tick (the 2026-10-07 defect) is reported", () => {
    const rows = active.map((r) => (r.path.endsWith("/open-auto-tick.yml") ? { ...r, state: "disabled_manually" } : r));
    expect(inactiveRequired(rows)).toEqual([{ file: "open-auto-tick.yml", state: "disabled_manually" }]);
  });

  it("a required workflow missing from the listing is reported, never assumed active", () => {
    const rows = active.filter((r) => !r.path.endsWith("/db-backup.yml"));
    expect(inactiveRequired(rows)).toEqual([{ file: "db-backup.yml", state: "missing from the API listing" }]);
  });

  // The CLI end to end on a fixture listing: exit 1 on a disabled workflow,
  // exit 2 on a truncated read, exit 0 when all are active.
  it("the CLI fails closed", () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-active-"));
    const run = (rows: { path: string; state: string }[]) => {
      const f = join(dir, `${Math.random()}.tsv`);
      writeFileSync(f, rows.map((r) => `${r.path}\t${r.state}`).join("\n"));
      expect(parseStates(readFileSync(f, "utf8"))).toEqual(rows);
      return spawnSync("node", [join(ROOT, "scripts/check-workflows-active.mjs"), "--from", f], { cwd: ROOT, encoding: "utf8" });
    };
    expect(run(active).status).toBe(0);
    const disabled = run(active.map((r) => (r.path.endsWith("/open-auto-tick.yml") ? { ...r, state: "disabled_manually" } : r)));
    expect(disabled.status).toBe(1);
    expect(disabled.stdout).toMatch(/open-auto-tick\.yml is disabled_manually/);
    expect(run(active.slice(0, 3)).status).toBe(2);
  });
});
