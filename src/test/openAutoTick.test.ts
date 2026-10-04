/**
 * Owner, 2026-10-04: items verified live are ticked automatically after each
 * deploy (scripts/open-done-when.mjs --tick, .github/workflows/open-auto-tick.yml).
 * tickReady must tick ONLY the READY ids, only `[~]` lines, and carry the evidence;
 * the workflow must run after the three prod deploys and land through a refresh PR.
 */
// @mutate scripts/open-done-when.mjs |       if (!id \|\| !ready.has(id)) return line; |       if (!id) return line;
// @mutate scripts/open-done-when.mjs |       const id = /^- \[~\] \*\*(Q\d+)\b/.exec(line)?.[1]; |       const id = /^- \[.\] \*\*(Q\d+)\b/.exec(line)?.[1];
// @mutate .github/workflows/open-auto-tick.yml |     workflows: ["Supabase DB Deploy", "Supabase Edge Functions Deploy", "Prod deploy"] |     workflows: ["Prod deploy"]
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
// @ts-expect-error — plain .mjs script, no declaration file for this export
import { tickReady } from "../../scripts/open-done-when.mjs";

const ROOT = join(__dirname, "..", "..");

describe("auto-tick (open-done-when --tick)", () => {
  const md = [
    "- [~] **Q1 MEDIUM a.** done-when: sql `SELECT 1` => 1",
    "- [~] **Q2 LOW b.** done-when: sql `SELECT 2` => 2",
    "- [ ] **Q3 LOW c.**",
    "- [x] **Q4 LOW d.**",
  ].join("\n");

  it("ticks only the READY [~] items and writes the evidence", () => {
    const out = tickReady(md, new Map([["Q1", "sql reads 1"]]), "2026-10-04").split("\n");
    expect(out[0]).toMatch(/^- \[x\] \*\*Q1 MEDIUM a\..*\*\*DONE 2026-10-04 \(auto-tick, verified live\): .*\(sql reads 1\)\.\*\*$/);
    expect(out.slice(1)).toEqual(md.split("\n").slice(1));
  });

  it("never ticks a to-do [ ] line, even if named", () => {
    const out = tickReady(md, new Map([["Q3", "x"]]), "2026-10-04");
    expect(out).toBe(md);
  });

  it("the workflow runs after the three prod deploys and lands through a refresh PR", () => {
    const wf = parse(readFileSync(join(ROOT, ".github/workflows/open-auto-tick.yml"), "utf8"));
    const names: string[] = wf.on.workflow_run.workflows;
    for (const f of ["db-deploy.yml", "functions-deploy.yml", "prod-deploy.yml"]) {
      const n = /^name:\s*(.+)$/m.exec(readFileSync(join(ROOT, ".github/workflows", f), "utf8"))![1].trim();
      expect(names, `${f} (${n})`).toContain(n);
    }
    const steps = wf.jobs.tick.steps as { uses?: string; with?: Record<string, string> }[];
    const pr = steps.find((s) => s.uses === "./.github/actions/refresh-pr");
    expect(pr?.with?.regenerate).toMatch(/open-done-when\.mjs --tick --no-test/);
  });
});
