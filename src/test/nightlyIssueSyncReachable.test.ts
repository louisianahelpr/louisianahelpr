/**
 * A nightly red must be clearable by the action a person takes to clear it.
 *
 * WHAT THIS CATCHES (2026-09-21, issue #1595). `.github/actions/nightly-issue-sync`
 * opens ONE `nightly-red` issue per workflow on a failure and closes it on the
 * next green run for that workflow. The close is the only way an issue ever
 * goes away — `nightly-red-age.yml` can read the list and turn a push red, but
 * it holds `issues: read` and deliberately cannot close anything.
 *
 * e2e-journeys.yml gated the job holding that step on
 * `github.event_name == 'schedule'`. So the loop a session actually runs —
 * read the red, fix the journeys, DISPATCH them to prove it — could never
 * close the issue, however green the run came back. Issue #1595 stayed open
 * for 207 hours over four journey failures that had all been fixed days
 * earlier; the proof was waiting on a Tue/Thu/Fri cron. The workflow reported
 * a result to nobody precisely on the runs a human was watching.
 *
 * THE RULE. If a workflow uses nightly-issue-sync and accepts
 * `workflow_dispatch`, the job carrying that step must be reachable on a
 * dispatch: either its `if:` says nothing about `github.event_name`, or it
 * names `workflow_dispatch` among the events it allows.
 *
 * WHAT THE RULE DELIBERATELY ALLOWS. Narrowing a dispatch further is correct
 * and stays green here — e2e-journeys reports only when its `scenario` input
 * is empty, because a run pinned to one test has not earned the right to close
 * a suite's issue, and race-runner.yml has made that same `inputs.* == ''`
 * check since before this rule existed. What is banned is excluding dispatch
 * as an EVENT, which bans the verification run as a category rather than
 * distinguishing a whole run from a pinned one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// NIGHTLY_WORKFLOWS_DIR: point at another checkout's workflows for a red proof.
const WORKFLOWS = process.env.NIGHTLY_WORKFLOWS_DIR ?? resolve(__dirname, "../../.github/workflows");

const SYNC = "nightly-issue-sync";

function stripComments(src: string): string {
  return src
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => l.replace(/\s+#.*$/, ""))
    .join("\n");
}

export function declaresDispatch(src: string): boolean {
  return /^\s*workflow_dispatch:/m.test(stripComments(src));
}

/**
 * The `jobs:` blocks of a workflow, keyed by job id. A job starts at a
 * two-space key under `jobs:` and runs until the next one. Regex rather than a
 * YAML parser on purpose: `yaml` is only a transitive dependency here, and
 * src/test/prodWorkflowSpacing.test.ts already reads these files this way.
 */
export function jobBlocks(src: string): Record<string, string> {
  const lines = stripComments(src).split("\n");
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  const out: Record<string, string> = {};
  if (start < 0) return out;
  let id: string | null = null;
  let buf: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    // A non-indented line ends the jobs mapping entirely.
    if (l.trim() !== "" && !/^\s/.test(l)) break;
    const m = /^ {2}([A-Za-z_][\w-]*):\s*$/.exec(l);
    if (m) {
      if (id) out[id] = buf.join("\n");
      id = m[1];
      buf = [];
      continue;
    }
    if (id) buf.push(l);
  }
  if (id) out[id] = buf.join("\n");
  return out;
}

/**
 * A job's own `if:` (4-space key), flattened. Handles the folded forms
 * (`if: >-` / `if: |`) by absorbing the more-indented lines beneath it, which
 * is how a condition long enough to need explaining is written.
 */
export function jobIf(block: string): string | null {
  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {4}if:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const head = m[1].trim();
    if (head !== "" && !/^[>|][-+]?$/.test(head)) return head;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === "") continue;
      if (!/^ {5,}/.test(lines[j])) break;
      body.push(lines[j].trim());
    }
    return body.join(" ");
  }
  return null;
}

/**
 * Is this condition satisfiable when `github.event_name` is `workflow_dispatch`?
 *
 * Everything that is NOT about the event is treated as satisfiable, because
 * the person dispatching chooses it: `inputs.scenario == ''` is a run they can
 * ask for, `needs.x.result == 'success'` is an outcome the suite can have. Only
 * `github.event_name` is fixed by the act of dispatching, so only it is
 * substituted. A rule that collapsed the input checks too would ban
 * race-runner's correct narrowing along with #1595's wrong one.
 */
export function reachableOnDispatch(cond: string): boolean {
  let e = cond
    .replace(/github\.event_name\s*==\s*'([^']*)'/g, (_, v) => (v === "workflow_dispatch" ? "true" : "false"))
    .replace(/github\.event_name\s*!=\s*'([^']*)'/g, (_, v) => (v === "workflow_dispatch" ? "false" : "true"))
    // Status functions: all satisfiable by some run of the suite.
    .replace(/\b(always|success|failure|cancelled)\(\)/g, "true")
    // Anything else compared to a literal is the dispatcher's to choose.
    .replace(/[A-Za-z_][\w.\-[\]'"*]*\s*(===?|!==?)\s*('[^']*'|"[^"]*"|true|false|\d+)/g, "true")
    // A bare context reference used as a truthy flag.
    .replace(/(?<![\w.])(github|inputs|needs|env|vars|steps|matrix|job)\.[\w.\-[\]'"*]+/g, "true");
  e = e.replace(/\s+/g, " ").trim();
  if (!/^[\s()!&|truefals]*$/.test(e.replace(/true|false/g, ""))) {
    throw new Error(`unsupported condition after substitution: "${cond}" -> "${e}"`);
  }
  // Token set is now closed: only true/false/&&/||/!/parens/space remain.
  return Function(`"use strict";return (${e});`)() === true;
}

export interface Wf {
  file: string;
  src: string;
}

export function violations(wfs: Wf[]): string[] {
  const out: string[] = [];
  for (const w of wfs) {
    if (!stripComments(w.src).includes(SYNC)) continue;
    if (!declaresDispatch(w.src)) continue;
    for (const [id, block] of Object.entries(jobBlocks(w.src))) {
      if (!block.includes(SYNC)) continue;
      const cond = jobIf(block);
      if (!cond) continue;
      // Says nothing about which event it is -> reachable on every event.
      if (!/github\.event_name/.test(cond)) continue;
      if (reachableOnDispatch(cond)) continue;
      out.push(
        `${w.file}: job "${id}" syncs the nightly-red issue but its condition excludes workflow_dispatch — ` +
          `a dispatched verification run can never close the red it was dispatched to clear. if: ${cond}`,
      );
    }
  }
  return out;
}

function loadWorkflows(): Wf[] {
  return readdirSync(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((file) => ({ file, src: readFileSync(join(WORKFLOWS, file), "utf8") }));
}

describe("a nightly red is clearable by a dispatch", () => {
  const wfs = loadWorkflows();

  it("derives a non-trivial set of issue-syncing workflows from the files", () => {
    // A broken derivation (a renamed action, a regex that matches nothing)
    // would otherwise report green while checking zero workflows.
    const syncing = wfs.filter((w) => stripComments(w.src).includes(SYNC)).map((w) => w.file);
    for (const f of ["e2e-journeys.yml", "nightly-webkit.yml", "prod-audit.yml", "press-every-control.yml"]) {
      expect(syncing).toContain(f);
    }
    // And the job parser really finds the job that holds the step.
    const journeys = wfs.find((w) => w.file === "e2e-journeys.yml")!;
    expect(Object.keys(jobBlocks(journeys.src))).toContain("notify");
    expect(jobBlocks(journeys.src).notify).toContain(SYNC);
  });

  it("every dispatchable issue-syncing job is reachable on a dispatch", () => {
    expect(violations(wfs)).toEqual([]);
  });

  it("can fail: the shape that held #1595 open for 207 hours is red", () => {
    const wf = (cond: string): Wf => ({
      file: "e2e-journeys.yml",
      src:
        `on:\n  schedule:\n    - cron: "17 3 * * 2"\n  workflow_dispatch:\n    inputs:\n      scenario:\n        type: string\n` +
        `jobs:\n  journeys:\n    runs-on: ubuntu-latest\n  notify:\n    needs: [journeys]\n    if: ${cond}\n` +
        `    steps:\n      - uses: ./.github/actions/${SYNC}\n`,
    });
    // THE ORIGINAL BUG, verbatim.
    expect(violations([wf("always() && github.event_name == 'schedule'")])).toHaveLength(1);
    // The fix: a dispatch reports too, as long as it is a whole-suite run.
    expect(
      violations([
        wf("always() && (github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.scenario == ''))"),
      ]),
    ).toEqual([]);
    // Narrowing a dispatch on an INPUT is fine — that is race-runner's shape.
    expect(violations([wf("always() && github.event.inputs.exclude_migrations == ''")])).toEqual([]);
    // Saying nothing about the event at all is fine (nightly-webkit's shape).
    expect(violations([wf("always()")])).toEqual([]);
    // A schedule-ONLY workflow cannot lose a dispatch it cannot receive.
    expect(
      violations([
        {
          file: "cron-only.yml",
          src: `on:\n  schedule:\n    - cron: "17 3 * * 2"\njobs:\n  notify:\n    if: always() && github.event_name == 'schedule'\n    steps:\n      - uses: ./.github/actions/${SYNC}\n`,
        },
      ]),
    ).toEqual([]);
    // A workflow that does not sync an issue is none of this rule's business.
    expect(
      violations([
        {
          file: "other.yml",
          src: "on:\n  workflow_dispatch:\njobs:\n  notify:\n    if: always() && github.event_name == 'schedule'\n    steps:\n      - run: echo hi\n",
        },
      ]),
    ).toEqual([]);
    // The folded `if: >-` form is read, not skipped — the fix uses it.
    const folded = `jobs:\n  notify:\n    if: >-\n      always() && (github.event_name == 'schedule'\n      || github.event_name == 'workflow_dispatch')\n    steps:\n      - uses: x\n`;
    expect(jobIf(jobBlocks(folded).notify)).toBe(
      "always() && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')",
    );
    // A comment naming the event does not make the condition allow it.
    expect(declaresDispatch("on:\n  # workflow_dispatch:\n  schedule:\n")).toBe(false);

    // The evaluator, directly. An EXCLUSION of some other event still leaves
    // dispatch reachable — prod-freshness and e2e-real-backend are written
    // that way, and reading `!=` as "does not mention dispatch" reported both
    // as broken when neither is.
    expect(reachableOnDispatch("always() && github.event_name != 'pull_request'")).toBe(true);
    expect(reachableOnDispatch("always() && github.event_name != 'workflow_dispatch'")).toBe(false);
    expect(reachableOnDispatch("always() && github.event_name == 'schedule'")).toBe(false);
    expect(reachableOnDispatch("always() && github.event_name == 'workflow_dispatch'")).toBe(true);
    expect(
      reachableOnDispatch(
        "always() && (github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.scenario == ''))",
      ),
    ).toBe(true);
    // An input narrowing is the dispatcher's to satisfy, so it stays reachable.
    expect(reachableOnDispatch("always() && github.event_name == 'workflow_dispatch' && inputs.full == 'true'")).toBe(true);
    // Two exclusions, neither of them dispatch.
    expect(
      reachableOnDispatch("always() && github.event_name != 'push' && github.event_name != 'pull_request'"),
    ).toBe(true);
  });
});
