// @mutate .github/workflows/asc-iap.yml | permissions:\n  contents: read\n\njobs: | jobs:
// @mutate .github/workflows/db-backup.yml | permissions:\n  contents: read\n\njobs: | jobs:
/*
 * CLASS GUARD: every workflow states what its GITHUB_TOKEN may do.
 *
 * A workflow with no `permissions:` block (top level, or on every job) runs
 * with the repository's default token scope, so a compromised step or action
 * gets more than the job needs. CodeQL reports it as
 * actions/missing-workflow-permissions. On 2026-10-02 it had two open alerts
 * of this kind, #100 (asc-iap.yml) and #126 (db-backup.yml). 65 of the 67
 * workflows already declared permissions, and nothing stopped the other two.
 *
 * The test reads the workflow files themselves, so the next new workflow
 * cannot ship without a block. Fixing it here means CI fails before CodeQL
 * would have to file another alert.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const DIR = join(__dirname, "..", "..", ".github", "workflows");
const files = readdirSync(DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

type Workflow = { permissions?: unknown; jobs?: Record<string, { permissions?: unknown } | null> };

/** Jobs that fall back to the default token scope: none if the workflow has a top-level block. */
function unscopedJobs(file: string): string[] {
  const wf = parse(readFileSync(join(DIR, file), "utf8")) as Workflow;
  if (wf && Object.prototype.hasOwnProperty.call(wf, "permissions")) return [];
  return Object.entries(wf?.jobs ?? {})
    .filter(([, job]) => !job || !Object.prototype.hasOwnProperty.call(job, "permissions"))
    .map(([name]) => name);
}

describe("every workflow declares GITHUB_TOKEN permissions", () => {
  it("reads the real workflow inventory", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it.each(files)("%s: top-level permissions, or permissions on every job", (file) => {
    expect(unscopedJobs(file)).toEqual([]);
  });
});
