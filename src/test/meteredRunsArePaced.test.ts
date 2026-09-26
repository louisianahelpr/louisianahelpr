/**
 * EVERY BUDGETED PROD RUN PACES ITS NAVIGATIONS UNDER ITS CEILING (Q104 class).
 *
 * The budget step (scripts/e2e/request-budget.mjs --label X) judges a run by
 * its busiest wall-clock minute against e2e/request-budgets.json's
 * ceilingPerMinute. A run that is metered but NOT paced goes red on that step
 * however well it otherwise behaves. It happened three times in two days:
 *   - loading-states-refresh 36158775025 (2026-09-25): 752/min, 3,007 requests,
 *     scripts/audit/measure-loading-states.mjs metered but never paced;
 *   - a11y-webkit-prod 36148473443 (2026-09-25, at 511c83ef9, before the
 *     prodTest fixture paced): a11y-prod 504/min, a11y-prod-webkit 478/min;
 *   - press-every-control 36069319716: 599 and 587/min (fixed by its own
 *     paceToCeiling, src/test/pressPacesToLoadCeiling.test.ts).
 *
 * So, for EVERY workflow job that runs a budget step, this reads what the job
 * runs to produce that label and requires a paced path:
 *   - a Playwright project: the metered fixture (e2e/prodTest.ts) turns the
 *     gate on for its label, and every page a metered context opens gets it
 *     (e2e/requestMeter.mjs `context.on("page", ...)`);
 *   - a node script (`node <file>` or `npm run <script>`): the script turns the
 *     shared gate on for its OWN label (`.paceTo(ceilingFor("<label>"`), or it
 *     is press-every-control's documented equivalent (paceToCeiling around
 *     ceilingWaitMs, the ceiling read for its own label).
 * And TWO-WAY: the labels the workflows judge are exactly the labels the
 * budgets file lists, so a budget entry cannot outlive its run and a new run
 * cannot be judged without a pacing check here.
 *
 * @mutate scripts/audit/measure-loading-states.mjs | requestMeter.paceTo(ceilingFor("loading-states", resolve(REPO, "e2e", "request-budgets.json")), { workers: CONCURRENCY }); | void CONCURRENCY;
 * @mutate e2e/prodTest.ts | meter.paceTo(ceilingFor(label), { workers: workerInfo.config.workers }); | void ceilingFor;
 * @mutate e2e/requestMeter.mjs | context.on("page", (page) => this.pacePage(page)); | void 0;
 * @mutate scripts/audit/press-every-control.mjs | const wait = ceilingWaitMs({ | const wait = 0 && ceilingWaitMs({
 * @mutate e2e/request-budgets.json | "a11y-prod-webkit": { | "a11y-prod-webkit-retired": {
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The jobs of a workflow, comment lines dropped: [jobName, body]. */
function jobs(text: string): [string, string][] {
  const code = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const start = code.search(/^jobs:\s*$/m);
  if (start < 0) return [];
  const parts = code.slice(start).split(/^(?= {2}[A-Za-z0-9_-]+:\s*$)/m).slice(1);
  return parts.map((p) => [p.split(":")[0].trim(), p]);
}

type Driver = { kind: "playwright" } | { kind: "script"; file: string };
type Run = { where: string; label: string; drivers: Driver[] };

/** Does this node script launch a Playwright browser? */
const launchesBrowser = (file: string) => /\b(?:chromium|webkit|firefox)\.launch\(/.test(blankComments(read(file)));

const pkgScripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;

/** Every budget step in every workflow, with what its job runs to produce the label. */
function budgetedRuns(): Run[] {
  const out: Run[] = [];
  const files = readdirSync(join(ROOT, ".github/workflows")).filter((f) => f.endsWith(".yml"));
  for (const file of files) {
    const text = read(`.github/workflows/${file}`);
    for (const [job, code] of jobs(text)) {
      const budget = [...code.matchAll(/run: node scripts\/e2e\/request-budget\.mjs --label (\$\{\{[^}]*\}\}|\S+)[^\n]*$/gm)];
      if (!budget.length) continue;
      const drivers: Driver[] = [];
      if (/npx playwright test\b[^\n]*--project=/.test(code)) drivers.push({ kind: "playwright" });
      const scripts: string[] = [];
      for (const m of code.matchAll(/run: npm run ([\w:-]+)\s*$/gm)) {
        const f = /^node (\S+\.mjs)/.exec(pkgScripts[m[1]] ?? "");
        if (f) scripts.push(f[1]);
      }
      for (const m of code.matchAll(/run: node (scripts\/\S+\.mjs)\s*$/gm)) scripts.push(m[1]);
      // A wrapper shell script (press-wave.sh runs the sharded press waves)
      // drives whatever node scripts it launches.
      for (const m of code.matchAll(/run: bash (scripts\/\S+\.sh)\b/gm)) {
        for (const n of read(m[1]).matchAll(/\bnode (scripts\/\S+\.mjs)/g)) scripts.push(n[1]);
      }
      // Only a script that LAUNCHES a browser sends the metered load; the
      // budget checker itself and the loading-state verdict do not.
      for (const f of scripts) if (launchesBrowser(f)) drivers.push({ kind: "script", file: f });
      // The label is the flag's own value; anything after it (--dir <shard>,
      // --ceiling-only) is an option of the checker, not part of the label.
      for (const b of budget) {
        const raw = b[1];
        const labels = raw.startsWith("${{")
          ? [...text.matchAll(/^\s*-?\s*project:\s*(\S+)\s*$/gm)].map((m) => m[1])
          : [raw];
        for (const label of labels) out.push({ where: `${file} ${job}`, label, drivers });
      }
    }
  }
  return out;
}

/** Why a driver does NOT pace `label`, or null when it does. */
function unpaced(d: Driver, label: string): string | null {
  if (d.kind === "playwright") {
    const fixture = blankComments(read("e2e/prodTest.ts"));
    const meter = blankComments(read("e2e/requestMeter.mjs"));
    if (!/meter\.paceTo\(ceilingFor\(label\),\s*\{\s*workers:\s*workerInfo\.config\.workers\s*\}\);/.test(fixture)) {
      return "e2e/prodTest.ts does not turn the pacing gate on for the project's label";
    }
    if (!/context\.on\("page",\s*\(page\)\s*=>\s*this\.pacePage\(page\)\);/.test(meter)) {
      return "e2e/requestMeter.mjs no longer puts the gate in front of every page a metered context opens";
    }
    return null;
  }
  const src = blankComments(read(d.file));
  if (new RegExp(`\\.paceTo\\(\\s*ceilingFor\\(\\s*"${esc(label)}"`).test(src)) return null;
  // press-every-control's own gate: paceToCeiling around ceilingWaitMs, called
  // per press cycle, with the ceiling read for its own label.
  const def = /const paceToCeiling = async \(page\) => \{([\s\S]*?)\n {2}\};/.exec(src);
  if (
    def && /const wait = ceilingWaitMs\(\{/.test(def[1]) && /if \(wait > 0\) await page\.waitForTimeout\(wait\);/.test(def[1]) && /await paceToCeiling\(page\);/.test(src) &&
    new RegExp(`"${esc(label)}"\\)\\.ceilingPerMinute`).test(src)
  ) return null;
  return `${d.file} runs label "${label}" with no pacing gate (e2e/requestMeter.mjs paceTo(ceilingFor("${label}")))`;
}

describe("every budgeted prod run paces itself under its per-minute ceiling", () => {
  const runs = budgetedRuns();

  it("finds the budget steps and what drives each (the scan is alive)", () => {
    expect(runs.length, "found almost no budget steps: the workflow scan is broken").toBeGreaterThan(10);
    const noDriver = runs.filter((r) => r.drivers.length === 0).map((r) => `${r.where}: ${r.label}`);
    expect(noDriver, "a budget step whose job runs nothing this guard can read").toEqual([]);
    expect(runs.some((r) => r.drivers.some((d) => d.kind === "script"))).toBe(true);
  });

  it("every driver of every budgeted label goes through a paced path", () => {
    const bad: string[] = [];
    for (const r of runs) for (const d of r.drivers) {
      const why = unpaced(d, r.label);
      if (why) bad.push(`${r.where}: ${why}`);
    }
    expect(bad).toEqual([]);
  });

  it("two-way: the judged labels are exactly the budgets file's labels", () => {
    const { budgets } = JSON.parse(read("e2e/request-budgets.json")) as { budgets: Record<string, unknown> };
    const listed = Object.keys(budgets).filter((k) => k !== "*").sort();
    const judged = [...new Set(runs.map((r) => r.label))].sort();
    expect(judged).toEqual(listed);
  });
});
