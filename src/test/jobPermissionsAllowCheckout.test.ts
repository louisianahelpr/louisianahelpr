// @mutate .github/workflows/quota-monitor.yml |     permissions:\n      contents: read\n      issues: write |     permissions:\n      issues: write
/*
 * GUARD (2026-10-03): a job that checks the repo out may read it.
 *
 * quota-monitor's "Report nightly result" job failed at actions/checkout with
 * "fatal: repository not found" x3 (run 37088059034, 2026-10-03 01:57Z), so the
 * red run could neither file nor close its nightly-red issue. Cause: the job sets
 * its own `permissions: { issues: write }`, and a job-level block REPLACES the
 * workflow's `contents: read`; with no contents permission the token cannot read
 * a private repo. 33 workflows had the same notify job. They worked again only
 * because the repo went public at ~03:11Z; made private again, every red run
 * would lose its own alert.
 *
 * Class check, from the workflow files themselves: every job that runs
 * actions/checkout and declares job-level permissions must grant contents
 * read (or write), or use read-all / write-all.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const WF = join(__dirname, "..", "..", ".github", "workflows");
type Step = { uses?: string };
type Job = { permissions?: string | Record<string, string>; steps?: Step[] };

function offenders(): string[] {
  const out: string[] = [];
  for (const file of readdirSync(WF).filter((f) => /\.ya?ml$/.test(f))) {
    const wf = parse(readFileSync(join(WF, file), "utf8")) as { jobs?: Record<string, Job> };
    for (const [name, job] of Object.entries(wf?.jobs ?? {})) {
      const checksOut = (job?.steps ?? []).some((s) => /^actions\/checkout@/.test(String(s?.uses ?? "")));
      if (!checksOut || job?.permissions === undefined) continue;
      const p = job.permissions;
      if (typeof p === "string") { if (!/^(read-all|write-all)$/.test(p)) out.push(`${file} ${name}: permissions "${p}"`); continue; }
      if (!/^(read|write)$/.test(String(p?.contents ?? ""))) out.push(`${file} ${name}`);
    }
  }
  return out.sort();
}

describe("jobs that check the repo out can read it", () => {
  it("reads the real workflows (floor)", () => {
    expect(readdirSync(WF).filter((f) => /\.ya?ml$/.test(f)).length).toBeGreaterThan(40);
  });

  it("no job with its own permissions block drops contents: read and then runs actions/checkout", () => {
    expect(offenders(), "add `contents: read` to the job's permissions block").toEqual([]);
  });
});
