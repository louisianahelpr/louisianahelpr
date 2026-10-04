/*
 * CLASS GUARD: a nightly-red issue is MAIN's state, so only a run on main may
 * open, comment on, or close it.
 *
 * Found 2026-09-26 on #1719 (e2e-journeys): its notify job reported every
 * unpinned workflow_dispatch, whatever branch it ran on. A fix branch that goes
 * green would have CLOSED the issue while main was still red (until the branch
 * merged), and a red probe on a scratch branch added "Still red" to main's
 * issue for a tree main never ran (issuecomment-5842376019, run 36211786791 on
 * wip/vac1797-probe-journeys, which had to be disowned by hand).
 *
 * THE RULE (Q414, every reporter): the job (or, for a job that does other work
 * too, the step) that runs ./.github/actions/nightly-issue-sync has an `if:`
 * naming `github.ref == 'refs/heads/main'`. The inventory is read from source
 * (every workflow using the action) and the ungated list must be EMPTY. The one
 * other accepted form is a `workflow_run` reporter (main-red-watch), where
 * github.ref is always the default branch and the real gate is
 * `github.event.workflow_run.head_branch == 'main'`.
 */

// @mutate .github/workflows/e2e-journeys.yml | !cancelled() && github.ref == 'refs/heads/main' && (github.event_name | !cancelled() && (github.event_name
// @mutate .github/workflows/nightly-webkit.yml | !cancelled() && github.ref == 'refs/heads/main' | !cancelled()
// @mutate .github/workflows/uptime.yml | if: always() && github.ref == 'refs/heads/main' | if: always()
// @mutate .github/workflows/main-red-watch.yml | github.event.workflow_run.head_branch == 'main' && | true &&

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const WORKFLOWS = join(__dirname, "..", "..", ".github", "workflows");

function stripComments(src: string): string {
  return src
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => l.replace(/\s+#.*$/, ""))
    .join("\n");
}

/** The `jobs:` blocks, keyed by job id (a two-space key under `jobs:`). */
function jobBlocks(src: string): Record<string, string> {
  const lines = stripComments(src).split("\n");
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  const out: Record<string, string> = {};
  if (start < 0) return out;
  let id: string | null = null;
  let buf: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
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

/** A job's own `if:` (4-space key), flattened across a folded block. */
function jobIf(block: string): string {
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
  return "";
}

/** The `if:` of the step (6-space `- name:` list item) that uses the action. */
function stepIfUsingAction(block: string): string {
  const steps = block.split(/^ {6}- /m).filter((st) => st.includes("nightly-issue-sync"));
  return steps
    .map((st) => {
      const m = /^ {8}if:\s*(.*)$/m.exec(st);
      return m ? m[1] : "";
    })
    .join(" ");
}

const REF_GATE = /github\.ref\s*==\s*'refs\/heads\/main'/;
const WORKFLOW_RUN_GATE = /github\.event\.workflow_run\.head_branch\s*==\s*'main'/;

function gated(block: string): boolean {
  const cond = `${jobIf(block)} ${stepIfUsingAction(block)}`;
  return REF_GATE.test(cond) || WORKFLOW_RUN_GATE.test(jobIf(block));
}

describe("nightly-red issues are reported only from main", () => {
  const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
  const reporting = files.filter((f) => stripComments(readFileSync(join(WORKFLOWS, f), "utf8")).includes("nightly-issue-sync"));
  const ungated = reporting
    .filter((f) => {
      const blocks = jobBlocks(readFileSync(join(WORKFLOWS, f), "utf8"));
      return Object.values(blocks)
        .filter((b) => b.includes("nightly-issue-sync"))
        .some((b) => !gated(b));
    })
    .sort();

  it("reads the workflows (floor)", () => {
    expect(reporting.length).toBeGreaterThan(20);
    expect(reporting).toContain("e2e-journeys.yml");
  });

  it("every reporter reports only from main (Q414)", () => {
    expect(ungated).toEqual([]);
  });

  it("the gate reads the step form and the workflow_run form", () => {
    expect(reporting).toContain("uptime.yml");
    expect(reporting).toContain("main-red-watch.yml");
  });
});
