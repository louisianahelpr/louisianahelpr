/*
 * A RED BASELINE MUST KEEP ITS REASON (OPEN.md Q410).
 *
 * The vacuity gate prints the tail of a guard's output when it was already red
 * before any mutation. For a Playwright guard that output is stdout + stderr,
 * and the webServer's build warnings land on stderr last, so the kept 25 lines
 * were all `[WebServer]` warnings. Measured on PR #1809 (2026-09-26):
 * e2e/prod-audit/shell-spacing.spec.ts came back "RED before any mutation" in
 * three runs with no failing test, error or assertion in the log.
 *
 * Checks the behaviour (the reason survives 30 lines of server chatter) and the
 * wiring (every place a baseline reason is recorded goes through it).
 *
 * @mutate scripts/vacuity/run.mjs | .filter((l) => !/^\s*\[WebServer\]/.test(l)) | .filter(Boolean)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs script, no types
import { failureTail } from "../../scripts/vacuity/run.mjs";
import { blankComments } from "./helpers/blankNonCode";

const RUN_MJS = blankComments(readFileSync(resolve(__dirname, "..", "..", "scripts", "vacuity", "run.mjs"), "utf8"));

const reporter = [
  "Running 3 tests using 1 worker",
  "  1) [prod-audit] › e2e/prod-audit/shell-spacing.spec.ts:148:1 › every route holds the one phone rhythm",
  "    Error: expect(received).toEqual(expected)",
  "    Expected: []",
  '    Received: ["legal@375: header→title 20, want 12"]',
  "  1 failed",
];
const serverChatter = Array.from({ length: 30 }, (_, i) => `[WebServer] warn - The class \`duration-[${i}ms]\` is ambiguous`);

describe("failureTail keeps the reason a run was red", () => {
  it("drops webServer chatter printed after the reporter", () => {
    const tail: string = failureTail([...reporter, ...serverChatter].join("\n"));
    expect(tail).toContain("Received: [\"legal@375: header→title 20, want 12\"]");
    expect(tail).toContain("1 failed");
    expect(tail).not.toContain("[WebServer]");
  });

  it("still caps at the last n lines", () => {
    const long = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
    const tail: string[] = failureTail(long).split("\n");
    expect(tail.length).toBe(25);
    expect(tail[24]).toBe("line 59");
  });

  it("keeps the first failure's assertion when attachment paths fill the tail", () => {
    const pw = [
      "Running 3 tests using 1 worker",
      "  1) [prod-audit] › e2e/prod-audit/shell-spacing.spec.ts:148:1 › every route holds the one phone rhythm",
      "    Error: phone rhythm drifted",
      "    Expected: []",
      '    Received: ["legal@375: header→title 20, want 12"]',
      "    attachment #1: screenshot (image/png) ───",
      ...Array.from({ length: 30 }, (_, i) => `    test-results/shell-spacing-${i}/test-failed-1.png`),
      "  2 failed",
    ];
    const tail: string = failureTail(pw.join("\n"));
    expect(tail).toContain('Received: ["legal@375: header→title 20, want 12"]');
    expect(tail).toContain("2 failed");
  });

  it("keeps EVERY failure's assertion, not only the first", () => {
    const block = (n: number, line: number, got: string) => [
      `  ${n}) [prod-audit] › e2e/prod-audit/shell-spacing.spec.ts:${line}:1 › test ${n}`,
      "    Error: drifted",
      `    Received: ["${got}"]`,
      "    attachment #1: screenshot (image/png) ───",
      ...Array.from({ length: 20 }, (_, i) => `    test-results/t${n}-${i}/test-failed-1.png`),
    ];
    const out = [...block(1, 148, "profile-landing@375: header→title 0px"), ...block(2, 297, "posts@375: section gaps [16]"), "  2 failed"];
    const tail: string = failureTail(out.join("\n"));
    expect(tail).toContain("profile-landing@375: header→title 0px");
    expect(tail).toContain("posts@375: section gaps [16]");
  });

  it("is safe on empty output", () => {
    expect(failureTail("")).toBe("");
    expect(failureTail(undefined)).toBe("");
  });
});

describe("every recorded baseline reason goes through failureTail", () => {
  it("no raw `.slice(-25)` of a run's output is left", () => {
    expect(RUN_MJS).not.toMatch(/\.out\.trim\(\)\.split\("\\n"\)\.slice\(-\d+\)/);
  });

  it("the three baseline-reason sites use it (inventory floor)", () => {
    const uses = RUN_MJS.match(/failureTail\((?:r|again)\.out\)/g) ?? [];
    expect(uses.length).toBeGreaterThan(2);
  });
});
