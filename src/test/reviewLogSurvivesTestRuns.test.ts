/**
 * THE REVIEW LOG MUST NOT LIVE WHERE A TEST RUNNER WILL DELETE IT.
 *
 * CLAUDE.md's first rule is that nothing visual is done until someone has
 * LOOKED at a screenshot, and `e2e/reviewLog.ts` is the only thing that makes
 * "I looked" falsifiable rather than a claim.
 *
 * It was written to `test-results/review-log.jsonl` until 2026-09-20 — which
 * is Playwright's default `outputDir`, and Playwright CLEARS that directory at
 * the start of every run. A lane found it by noticing its own eight records
 * had vanished mid-session; checked that day, ONE entry survived out of a
 * day's reviewing.
 *
 * The failure mode is the dangerous kind: `npm run review:report` goes GREEN
 * on an empty log, because "zero unreviewed failures" is exactly what a wiped
 * file looks like. So the strongest verification rule in the project silently
 * degraded to an honour system, and the report that was supposed to police it
 * agreed that everything was fine.
 *
 * This guard pins the property, not the path: the log may live anywhere that
 * no runner owns. It fails if it moves back under `test-results/` (or any
 * other declared output directory), and it fails if the reporter reads a
 * different file from the one the recorder writes — the two drifting apart
 * would produce the same green-on-nothing result by a different route.
 *
 * @mutate e2e/reviewLog.ts | resolve(process.cwd(), ".review", "review-log.jsonl") | resolve(process.cwd(), "test-results", "review-log.jsonl")
 * @mutate scripts/review-report.mjs | const LOG = join(canon(".review"), "review-log.jsonl"); | const LOG = join(RESULTS, "review-log.jsonl");
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
/** Declarations only — this file's own prose names the bad path. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** Directories a test runner owns and may clear without warning. */
function runnerOutputDirs(): string[] {
  const dirs = new Set<string>(["test-results"]); // Playwright's default outputDir
  for (const cfg of ["playwright.config.ts", "vitest.config.ts"]) {
    if (!existsSync(resolve(ROOT, cfg))) continue;
    for (const m of code(read(cfg)).matchAll(/(?:outputDir|outputFile)\s*:\s*["'`]\.?\/?([^"'`]+)["'`]/g)) {
      dirs.add(m[1].replace(/\/+$/, "").split("/")[0]);
    }
  }
  expect(dirs.size, "the runner-output inventory is empty — the scan broke").toBeGreaterThan(0);
  return [...dirs];
}

function logPathFrom(src: string): string {
  const m = /REVIEW_LOG\s*=\s*resolve\(\s*process\.cwd\(\)\s*,\s*["'`]([^"'`]+)["'`]/.exec(code(src));
  expect(m, "could not find REVIEW_LOG's first path segment in e2e/reviewLog.ts").not.toBeNull();
  return m![1];
}

describe("the record that someone looked at a screenshot is durable", () => {
  it("does not live in a directory a test runner clears", () => {
    const segment = logPathFrom(read("e2e/reviewLog.ts"));
    expect(
      runnerOutputDirs(),
      `the review log is written under "${segment}", which a test runner owns and clears ` +
        `between runs. That silently empties the proof that anyone looked at anything — and ` +
        `review:report reports GREEN on an empty log, because zero unreviewed failures is ` +
        `what a wiped file looks like.`,
    ).not.toContain(segment);
  });

  it("the reporter reads the same file the recorder writes", () => {
    // Drift here reproduces the original defect by a different route: the
    // report would be green because it is reading a file nobody writes to.
    const recorderDir = logPathFrom(read("e2e/reviewLog.ts"));
    const reporter = code(read("scripts/review-report.mjs"));
    const m = /const LOG\s*=\s*join\(\s*(?:canon\(\s*["'`]([^"'`]+)["'`]\s*\)|(\w+))\s*,\s*["'`]review-log\.jsonl["'`]/.exec(reporter);
    expect(m, "scripts/review-report.mjs no longer resolves a review-log.jsonl path").not.toBeNull();
    const reporterDir = m![1] ?? m![2];
    expect(
      reporterDir,
      `the recorder writes under "${recorderDir}" but the reporter reads "${reporterDir}" — ` +
        `the report would be green while reading a file nobody writes`,
    ).toBe(recorderDir);
  });

  it("the directory is gitignored — the log is evidence, not source", () => {
    const segment = logPathFrom(read("e2e/reviewLog.ts"));
    expect(read(".gitignore")).toMatch(new RegExp(`^${segment}/?$`, "m"));
  });
});
