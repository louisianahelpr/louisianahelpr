/**
 * "Nightly reds nobody read" (.github/workflows/nightly-red-age.yml) fails a
 * push while any nightly-red issue is older than a day, and its own notify job
 * files `nightly-red: nightly-red-age` when it is red. Counting that issue as a
 * blocker made the gate a deadlock: the issue closes only on a green run, and a
 * green run needed the issue gone (2026-09-26: #1657 open 65h, listed as
 * blocking by the very run that kept it open; ops alert ledger item
 * 74dde298, 32 occurrences). Its own issue must never block it.
 *
 * Runs the workflow's REAL jq program (extracted from the YAML) on fixtures.
 *
 * @mutate .github/workflows/nightly-red-age.yml | map(select(.title != $self)) | map(select(.title != "x"))
 * @mutate .github/workflows/nightly-red-age.yml | SELF_TITLE: "nightly-red: nightly-red-age" | SELF_TITLE: "nightly-red: other"
 * @mutate .github/workflows/nightly-red-age.yml | | map(select([.labels[].name] \| index($ack) \| not)) | | map(.)
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const YML = readFileSync(resolve(__dirname, "../../.github/workflows/nightly-red-age.yml"), "utf8");

function blockingProgram(): string {
  const m = /BLOCKING=\$\(jq -r [^']*'([\s\S]*?)' \/tmp\/issues\.json\)/.exec(YML);
  expect(m, "BLOCKING=$(jq … '<program>' /tmp/issues.json) not found").not.toBeNull();
  return m![1];
}

function selfTitle(): string {
  const m = /SELF_TITLE:\s*"([^"]+)"/.exec(YML);
  expect(m, "SELF_TITLE env not found").not.toBeNull();
  return m![1];
}

/** The notify job's workflow-name, as nightly-issue-sync titles it. */
function ownIssueTitle(): string {
  const m = /uses: \.\/\.github\/actions\/nightly-issue-sync\s+with:\s+workflow-name:\s*([\w-]+)/.exec(YML);
  expect(m, "notify job's nightly-issue-sync workflow-name not found").not.toBeNull();
  return `nightly-red: ${m![1]}`;
}

function blocking(issues: unknown[]): string[] {
  const now = Date.parse("2026-09-26T04:00:00Z") / 1000;
  const out = execFileSync(
    "jq",
    ["-r", "--argjson", "now", String(now), "--argjson", "max", String(24 * 3600),
      "--arg", "ack", "nightly-red-ack", "--arg", "self", selfTitle(), blockingProgram()],
    { input: JSON.stringify(issues), encoding: "utf8" },
  );
  return out.split("\n").filter(Boolean);
}

const issue = (number: number, title: string, createdAt: string, labels: string[] = ["nightly-red"]) => ({
  number, title, createdAt, url: `https://example.test/${number}`, labels: labels.map((name) => ({ name })),
});

describe("nightly-red-age never blocks on its own issue", () => {
  it("SELF_TITLE is the title its own notify job files", () => {
    expect(selfTitle()).toBe(ownIssueTitle());
  });

  it("its own 3-day-old issue does not block; another 3-day-old red does", () => {
    const own = issue(1657, selfTitle(), "2026-09-23T08:05:00Z");
    const other = issue(1719, "nightly-red: e2e-journeys", "2026-09-23T19:21:00Z");
    expect(blocking([own])).toEqual([]);
    const lines = blocking([own, other]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^#1719 nightly-red: e2e-journeys — open \d+h/);
  });

  it("an acknowledged or young red still does not block (behaviour kept)", () => {
    expect(blocking([issue(1, "nightly-red: x", "2026-09-23T00:00:00Z", ["nightly-red", "nightly-red-ack"])])).toEqual([]);
    expect(blocking([issue(2, "nightly-red: y", "2026-09-26T03:00:00Z")])).toEqual([]);
  });
});
