/**
 * Q821: a nightly reporter (any job or step that runs the
 * `nightly-issue-sync` action) must not run on `always()`. `always()` also
 * runs after a CANCELLED run, which then files or comments "still red" for a
 * run that tested nothing (Q703: run 36211786791 commented on #1719). Use
 * `!cancelled()`: it still runs after a failure, and a job killed by its own
 * timeout does not cancel the run, so a timeout still reports as red.
 *
 * The one exception is exact: uptime.yml reports from a STEP inside the probe
 * job, and its own comment says why that step stays on `always()` (a crashed
 * probe is the case the job exists to catch).
 *
 * @mutate .github/workflows/nightly-webkit.yml | if: ${{ !cancelled() }} | if: always()
 * @mutate .github/workflows/e2e-real-backend.yml |       !cancelled() && github.event_name != 'pull_request' |       always() && github.event_name != 'pull_request'
 * @mutate .github/workflows/vacuity.yml | if: ${{ !cancelled() && (github | if: ${{ always() && (github
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

const DIR = resolve(__dirname, "../../.github/workflows");
const ALWAYS_ALLOWED = ["uptime.yml"];

type Reporter = { file: string; job: string; cond: string };

function reporters(): Reporter[] {
  const out: Reporter[] = [];
  for (const file of readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f))) {
    const wf = parse(readFileSync(resolve(DIR, file), "utf8")) ?? {};
    for (const [job, j] of Object.entries<Record<string, unknown>>(wf.jobs ?? {})) {
      for (const s of (j.steps as Array<Record<string, unknown>>) ?? []) {
        if (!String(s.uses ?? "").includes("nightly-issue-sync")) continue;
        out.push({ file, job, cond: `${String(j.if ?? "")} ${String(s.if ?? "")}` });
      }
    }
  }
  return out;
}

describe("nightly reporters skip cancelled runs", () => {
  const all = reporters();

  it("finds the reporters (the inventory is not empty)", () => {
    expect(all.length).toBeGreaterThan(30);
  });

  it("only the allowed reporters run on always()", () => {
    const onAlways = all.filter((r) => /\balways\(\)/.test(r.cond)).map((r) => r.file).sort();
    expect(onAlways).toEqual(ALWAYS_ALLOWED);
  });
});
