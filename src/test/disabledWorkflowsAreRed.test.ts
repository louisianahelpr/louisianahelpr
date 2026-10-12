/**
 * CLASS GUARD (docs/OPEN.md Q1652): a workflow that is not `active` is a red
 * heartbeat row whether or not it has a cron. open-auto-tick.yml (workflow_run,
 * no cron) sat disabled_manually 2026-10-07 to 2026-10-12 and nothing alerted,
 * because schedule-heartbeat only read the state of its WATCHED cron list.
 *
 * @mutate scripts/ci/disabled-workflows.mjs |     if (src !== null && hasSchedule(src)) continue; // the WATCHED loop reports it |     continue;
 * @mutate scripts/ci/disabled-workflows.mjs |     if (w.state === "active") { |     if (w.state !== "nope") {
 * @mutate scripts/ci/disabled-workflows.mjs |     if (w.state === "deleted") continue; |     if (false) continue;
 * @mutate .github/workflows/schedule-heartbeat.yml | STALE_COUNT=$((STALE_COUNT + DISABLED)) | STALE_COUNT=$((STALE_COUNT + 0))
 * @mutate .github/workflows/schedule-heartbeat.yml | node scripts/ci/disabled-workflows.mjs > /tmp/disabled.txt | echo disabled=0 > /tmp/disabled.txt
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INTENTIONALLY_OFF, judgeWorkflows } from "../../scripts/ci/disabled-workflows.mjs";

const DIR = ".github/workflows";
const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
const readFile = (f: string) => (existsSync(`${DIR}/${f}`) ? readFileSync(`${DIR}/${f}`, "utf8") : null);
const asApi = (state: (f: string) => string) => files.map((f) => ({ path: `${DIR}/${f}`, state: state(f) }));

describe("a disabled workflow is red, scheduled or not (Q1652)", () => {
  it("the inventory is the real workflow directory", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it("all active: no rows", () => {
    expect(judgeWorkflows(asApi(() => "active"), readFile).count).toBe(0);
  });

  it("the 2026-10-07 state (open-auto-tick.yml disabled_manually) is one red row", () => {
    const { rows, count } = judgeWorkflows(
      asApi((f) => (f === "open-auto-tick.yml" ? "disabled_manually" : "active")),
      readFile,
    );
    expect(count).toBe(1);
    expect(rows[0]).toContain("open-auto-tick.yml");
  });

  it("every non-scheduled workflow is covered; scheduled ones are left to the WATCHED loop", () => {
    const off = judgeWorkflows(asApi(() => "disabled_inactivity"), readFile);
    const unscheduled = files.filter((f) => !/^\s*schedule:\s*$/m.test(readFileSync(`${DIR}/${f}`, "utf8")));
    expect(unscheduled.length).toBeGreaterThan(10);
    expect(off.count).toBe(unscheduled.length);
  });

  it("a deleted workflow the API still lists (it has run history) is not a row", () => {
    const api = [...asApi(() => "active"), { path: `${DIR}/retired-old.yml`, state: "deleted" }];
    expect(judgeWorkflows(api, readFile).count).toBe(0);
  });

  it("INTENTIONALLY_OFF is exact both ways", () => {
    const allow = { "open-auto-tick.yml": "test" };
    expect(judgeWorkflows(asApi(() => "active"), readFile, allow).count).toBe(1);
    expect(judgeWorkflows(asApi((f) => (f === "open-auto-tick.yml" ? "disabled_manually" : "active")), readFile, allow).count).toBe(0);
    expect(judgeWorkflows(asApi(() => "active"), readFile, { "gone.yml": "x" }).count).toBe(1);
    for (const f of Object.keys(INTENTIONALLY_OFF)) expect(files).toContain(f);
  });

  it("schedule-heartbeat runs it and counts its rows as stale", () => {
    const hb = readFileSync(`${DIR}/schedule-heartbeat.yml`, "utf8");
    expect(hb).toContain("node scripts/ci/disabled-workflows.mjs > /tmp/disabled.txt");
    expect(hb).toContain("STALE_COUNT=$((STALE_COUNT + DISABLED))");
    expect(hb.indexOf("STALE_COUNT=$((STALE_COUNT + DISABLED))")).toBeLessThan(hb.indexOf('echo "stale=$STALE_COUNT"'));
  });
});
