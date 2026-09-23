/**
 * GUARD: the scheduled-workflow heartbeat gives a NEWLY scheduled workflow its
 * first chance to fire before calling it dead (2026-09-23: scoreboard.yml's
 * schedule was added at 06:07Z, its first slot is 19:17Z, and the heartbeat
 * filed nightly-red #1696 at 15:28Z for "never had a schedule-triggered run").
 *
 * The never-ran branch must measure the schedule's age from git history (the
 * first commit adding a `cron:` line) and skip while it is younger than the
 * workflow's budget; the checkout must fetch full history for that to work.
 *
 * @mutate .github/workflows/schedule-heartbeat.yml | if [ -n "$ADDED" ] && [ $(( (NOW - ADDED) / 86400 )) -lt "$MAX_DAYS" ]; then | if false; then
 * @mutate .github/workflows/schedule-heartbeat.yml | fetch-depth: 0 | fetch-depth: 1
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const wf = readFileSync(join(process.cwd(), ".github/workflows/schedule-heartbeat.yml"), "utf8");

describe("schedule heartbeat: grace for a schedule not yet due", () => {
  it("reads the schedule's age from git and skips while younger than its budget", () => {
    const i = wf.indexOf('if [ -z "$LAST" ]; then');
    expect(i).toBeGreaterThan(0);
    const branch = wf.slice(i, wf.indexOf("STALE_COUNT=$((STALE_COUNT + 1))", i));
    expect(branch).toMatch(/git log --reverse --format=%ct -S "cron:"/);
    expect(branch).toContain('if [ -n "$ADDED" ] && [ $(( (NOW - ADDED) / 86400 )) -lt "$MAX_DAYS" ]; then');
    expect(branch).toMatch(/continue/);
  });

  it("checks out full history so git log can see when the schedule was added", () => {
    expect(wf).toMatch(/fetch-depth: 0/);
  });
});
