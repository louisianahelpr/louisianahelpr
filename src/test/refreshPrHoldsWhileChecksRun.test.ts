/*
 * Owner, 2026-10-05: "fix this PR ... and stop this from always happening".
 * The refresh bots (.github/actions/refresh-pr) rebuilt their PR on every
 * deploy; each push cancelled the PR's in-flight test runs (vitest.yml has
 * cancel-in-progress on pull_request), so the tick-bot PR sat red with
 * "Cancelled after 19m" and never merged. The action must hold while the PR's
 * checks are still running, and only after that may it push.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const ACTION = readFileSync(join(ROOT, ".github/actions/refresh-pr/action.yml"), "utf8");
const WORKFLOWS = readdirSync(join(ROOT, ".github/workflows")).filter((f) => f.endsWith(".yml"));

describe("refresh bots never replace their PR while its checks run", () => {
  it("the inventory of bots using the action is real", () => {
    const users = WORKFLOWS.filter((f) =>
      readFileSync(join(ROOT, ".github/workflows", f), "utf8").includes("./.github/actions/refresh-pr"));
    expect(users.length).toBeGreaterThan(1);
  });

  it("the hold runs before the bot pushes, and exits without pushing", () => {
    const hold = ACTION.indexOf('not replacing it mid-run');
    const push = ACTION.indexOf('bash "$PUSHER" push', ACTION.indexOf('CHANGED=$(git diff --cached --name-only)') - 4000);
    const commitPush = ACTION.lastIndexOf('bash "$PUSHER" push');
    expect(hold).toBeGreaterThan(0);
    expect(hold).toBeLessThan(commitPush);
    expect(push).toBeGreaterThan(0);
    const block = ACTION.slice(ACTION.indexOf("# HOLD (owner, 2026-10-05)"), commitPush);
    expect(block).toMatch(/status != "COMPLETED"/);
    expect(block).toMatch(/\[ "\$RUNNING" -gt 0 \] && \[ "\$FAILED" -eq 0 \]/);
    expect(block).toMatch(/exit 0/);
  });
});
// @mutate .github/actions/refresh-pr/action.yml | [ "$RUNNING" -gt 0 ] && [ "$FAILED" -eq 0 ] | [ "$RUNNING" -gt 999 ] && [ "$FAILED" -eq 0 ]
