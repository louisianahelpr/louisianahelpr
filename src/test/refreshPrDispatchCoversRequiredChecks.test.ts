// Q57: a refresh bot PR opened with github.token triggers no pull_request
// workflows that run on their own (GitHub parks them as "action_required"), so
// .github/actions/refresh-pr dispatches its default check workflows on the bot
// branch. Those dispatched runs are the ONLY way the PR's required checks can
// report, and auto-merge waits on them forever otherwise.
//
// Measured 2026-09-24: PR #1722 sat with auto-merge on for 5 h. Main's required
// contexts (`gh api repos/louisianahelpr/louisianahelpr/branches/main/protection
// -q .required_status_checks.contexts`) are the three names below, but the
// default dispatch list was "test.yml vitest.yml": two of the three required
// checks were never produced.
//
// REQUIRED_CHECKS is a copy of a GitHub setting; re-measure it with the command
// above when branch protection changes.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const REQUIRED_CHECKS = [
  "Playwright happy-path smoke (mocked Supabase, mobile viewport)",
  "Playwright mobile viewports (320 / 375 / 414 / 768 / 1024)",
  "Vitest unit tests",
];

const ROOT = join(__dirname, "..", "..");
const WF_DIR = join(ROOT, ".github", "workflows");
const ACTION = readFileSync(join(ROOT, ".github", "actions", "refresh-pr", "action.yml"), "utf8");

function defaultDispatchList(): string[] {
  const m = ACTION.match(/for wf in \$\{CHECK_WORKFLOWS:-([^}]*)\}/);
  return m ? m[1].trim().split(/\s+/) : [];
}

function workflowsHosting(checkName: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(WF_DIR).filter((n) => /\.ya?ml$/.test(n))) {
    const wf = parse(readFileSync(join(WF_DIR, f), "utf8")) as {
      on?: unknown;
      jobs?: Record<string, { name?: string }>;
    };
    if (Object.values(wf?.jobs ?? {}).some((j) => j?.name === checkName)) out.push(f);
  }
  return out;
}

describe("refresh-pr dispatches every required check (Q57)", () => {
  const list = defaultDispatchList();

  it("the default list and the workflow inventory are found", () => {
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(readdirSync(WF_DIR).filter((n) => /\.ya?ml$/.test(n)).length).toBeGreaterThan(30);
  });

  for (const check of REQUIRED_CHECKS) {
    it(`"${check}" is produced by a dispatched workflow that accepts workflow_dispatch`, () => {
      const hosts = workflowsHosting(check);
      expect(hosts, `no workflow defines a job named "${check}"`).not.toEqual([]);
      const dispatched = hosts.filter((h) => list.includes(h));
      expect(dispatched, `${hosts.join(", ")} not in the refresh-pr default dispatch list`).not.toEqual([]);
      for (const h of dispatched) {
        expect(readFileSync(join(WF_DIR, h), "utf8"), `${h} cannot be dispatched`).toMatch(/^\s*workflow_dispatch:/m);
      }
    });
  }
});

// @mutate .github/actions/refresh-pr/action.yml | CHECK_WORKFLOWS:-test.yml vitest.yml e2e-happy-path.yml mobile-viewports.yml} | CHECK_WORKFLOWS:-test.yml vitest.yml}
