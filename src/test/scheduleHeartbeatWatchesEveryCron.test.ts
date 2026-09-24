/**
 * CJ-009 (measured 2026-09-24): schedule-heartbeat.yml watched 11 of the 35 workflows that carry a
 * cron, and nothing watched the heartbeat itself. Its WATCHED list must equal
 * the set of cron workflows (minus itself), both ways, and staleness-watch.yml
 * must check the heartbeat's own state and last scheduled run.
 *
 * @mutate .github/workflows/schedule-heartbeat.yml | uptime.yml:1 | uptime-gone.yml:1
 * @mutate .github/workflows/schedule-heartbeat.yml |           vacuity.yml:8 | #
 * @mutate .github/workflows/staleness-watch.yml | "$AGE" -le 2 ] | "$AGE" -le 999 ]
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = ".github/workflows";
const withCron = readdirSync(DIR)
  .filter((f) => f.endsWith(".yml"))
  .filter((f) => /^\s+- cron:/m.test(readFileSync(`${DIR}/${f}`, "utf8")))
  .sort();
const hb = readFileSync(`${DIR}/schedule-heartbeat.yml`, "utf8");
const block = hb.slice(hb.indexOf('WATCHED="') + 9, hb.indexOf('"', hb.indexOf('WATCHED="') + 9));
const watched = block.split(/\s+/).filter(Boolean);
// Watched another way: the heartbeat itself by staleness-watch.yml (below),
// privacy-journey.yml by the heartbeat's month-aware marker check (Q293).
// @two-way src/test/scheduleHeartbeatWatchesEveryCron.test.ts:stale EXEMPT entry
const EXEMPT = ["privacy-journey.yml", "schedule-heartbeat.yml"];

describe("the heartbeat watches every scheduled workflow (CJ-009)", () => {
  it("the inventory is real", () => {
    expect(withCron.length).toBeGreaterThan(30);
  });
  it("WATCHED is exactly the cron workflows other than itself, each with a budget", () => {
    const names = watched.map((e) => e.split(":")[0]).sort();
    expect(names).toEqual(withCron.filter((f) => !EXEMPT.includes(f)));
    for (const e of watched) expect(e).toMatch(/^[\w.-]+\.yml:[1-9]\d*$/);
  });
  it("every EXEMPT entry is still a cron workflow", () => {
    for (const f of EXEMPT) expect(withCron, `stale EXEMPT entry ${f} — remove it`).toContain(f);
  });
  it("each exemption is watched elsewhere", () => {
    expect(hb).toContain("CURRENT_MONTH=$(date -u +%Y-%m)");
  });
  it("staleness-watch checks the heartbeat itself", () => {
    const sw = readFileSync(`${DIR}/staleness-watch.yml`, "utf8");
    expect(sw).toMatch(/actions\/workflows\/schedule-heartbeat\.yml"\s+--jq '\.state'/);
    expect(sw).toMatch(/\[ "\$AGE" -le 2 \] \|\| \{ echo "::error::schedule-heartbeat\.yml last ran/);
  });
});
