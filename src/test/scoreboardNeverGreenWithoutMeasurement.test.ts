// @mutate scripts/scoreboard.mjs | if (ageDays(last.updatedAt ?? last.createdAt, now) > MAX_RUN_AGE_DAYS) return "STALE"; | if (false) return "STALE";
/*
 * THE SCOREBOARD NEVER SHOWS GREEN FOR SOMETHING IT DID NOT MEASURE (Q59).
 *
 * Owner, 2026-09-23: "always keep a current ledger to show numbers ... what's
 * passing / failing". A scoreboard is worse than none if it can go green on a
 * fetch that failed, a run from last month, or a log with no summary: that is
 * the false green every guard in this repo exists to stop. So:
 *   - the committed docs/SCOREBOARD.md and OPEN.md's Everything-open block are
 *     well-formed: every row has a known status and a measured-at stamp, and
 *     every UNKNOWN says why (scripts/scoreboard.mjs shapeProblems);
 *   - an old success is STALE, a missing run is UNKNOWN, a failure is FAIL;
 *   - the log parsers read the real `gh run view --log` shapes (ESC printed as
 *     a literal "^[") and return null — never zeros — when the summary is
 *     absent;
 *   - check-staleness.mjs fails once the live section is older than 72h.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script, no declaration file
import * as sb from "../../scripts/scoreboard.mjs";
// @ts-expect-error — plain .mjs script, no declaration file
import { checkScoreboardLive } from "../../scripts/check-staleness.mjs";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const NOW = new Date("2026-09-23T12:00:00Z");
const run = (conclusion: string, daysAgo: number) => {
  const t = new Date(NOW.getTime() - daysAgo * 864e5).toISOString();
  return { id: 1, conclusion, event: "push", createdAt: t, updatedAt: t, url: "u" };
};

describe("the committed scoreboard is well-formed", () => {
  const board = read("docs/SCOREBOARD.md");
  const open = read("docs/OPEN.md");

  it("has rows (cannot pass vacuously)", () => {
    const rows = board.split("\n").filter((l) => /^\| (?!group \||---)/.test(l));
    expect(rows.length).toBeGreaterThan(20);
    // one row per workflow file, derived from the repo's own inventory
    expect(sb.workflowFiles().length).toBeGreaterThan(30);
  });

  it("every row has a status, a stamp, and a reason when UNKNOWN", () => {
    expect(sb.shapeProblems(board, open)).toEqual([]);
  });

  it("is RED on an UNKNOWN with no reason, a bad status, or a missing stamp", () => {
    const planted = (row: string) => board.replace(sb.LIVE_END, `${row}\n${sb.LIVE_END}`);
    expect(sb.shapeProblems(planted("| CI | x | **UNKNOWN** | — | — | — | — | attempted 2026-09-23T00:00Z | — | — |"), open).join()).toMatch(/without a reason/);
    expect(sb.shapeProblems(planted("| CI | x | **GREEN** | — | — | — | — | 2026-09-23T00:00Z | — | — |"), open).join()).toMatch(/not one of/);
    expect(sb.shapeProblems(planted("| CI | x | **PASS** | — | — | — | — | — | — | — |"), open).join()).toMatch(/no measured-at/);
    expect(sb.shapeProblems(board, open.replace(sb.EO_START, ""))).not.toEqual([]);
  });
});

describe("a CI result is never green unless it is a recent, conclusive success", () => {
  it("success within the window is PASS; old success is STALE; failure is FAIL; nothing is UNKNOWN", () => {
    expect(sb.ciStatus(run("success", 1), NOW)).toBe("PASS");
    expect(sb.ciStatus(run("success", sb.MAX_RUN_AGE_DAYS + 1), NOW)).toBe("STALE");
    expect(sb.ciStatus(run("failure", 1), NOW)).toBe("FAIL");
    expect(sb.ciStatus(null, NOW)).toBe("UNKNOWN");
  });

  it("a cancelled run is skipped, and red-since walks back to the last success", () => {
    const s = sb.streak([run("cancelled", 0), run("failure", 1), run("failure", 2), run("success", 3)]);
    expect(s.last.conclusion).toBe("failure");
    expect(s.cancelledAfter).toBe(1);
    expect(s.redSince).toBe(run("failure", 2).createdAt);
    expect(s.redSinceFloor).toBe(false);
    expect(sb.streak([run("cancelled", 0)]).last).toBeNull();
  });

  it("an UNKNOWN row always carries its reason", () => {
    const r = sb.unknown("CI", "x", "gh failed");
    expect(r.status).toBe("UNKNOWN");
    expect(sb.renderRow({ ...r, at: "attempted 2026-09-23T00:00Z" })).toMatch(/UNKNOWN: gh failed/);
  });
});

describe("the log parsers read real gh log shapes and never invent zeros", () => {
  const line = (s: string) => `Vitest unit tests\tRun Vitest\t2026-09-23T05:51:05.1369883Z ${s}`;

  it("vitest summary (ESC printed as a literal ^[)", () => {
    const log = [
      line("^[[2m Test Files ^[[22m ^[[1m^[[31m8 failed^[[39m^[[22m^[[2m | ^[[22m^[[1m^[[32m655 passed^[[39m^[[22m^[[90m (663)^[[39m"),
      line("^[[2m      Tests ^[[22m ^[[1m^[[31m31 failed^[[39m^[[22m^[[2m | ^[[22m^[[1m^[[32m6657 passed^[[39m^[[22m^[[2m | ^[[22m^[[33m1 skipped^[[39m^[[90m (6689)^[[39m"),
    ].join("\n");
    expect(sb.parseVitest(log)).toMatchObject({ pass: 6657, fail: 31, skipped: 1, total: 6689 });
    expect(sb.parseVitest(line("nothing here"))).toBeNull();
  });

  it("playwright summary", () => {
    const log = ["  10 failed", "  17 skipped", "  198 passed (1.2h)"].map(line).join("\n");
    expect(sb.parsePlaywright(log)).toMatchObject({ pass: 198, fail: 10, skipped: 17, total: 225 });
    expect(sb.parsePlaywright(line("Running 225 tests"))).toBeNull();
  });

  it("press-every-control and vacuity summaries", () => {
    expect(sb.parsePress(line("found=1049 pressed=834 failed=6 undocumented-skips=0 coverage=100.0%"))).toMatchObject({ fail: 6, total: 1049, skipped: 215 });
    expect(sb.parseVacuity(line("✓ mutation: 368/369 killed, 0 known-vacuous, 0 not run"))).toMatchObject({ pass: 368, fail: 1, total: 369 });
    expect(sb.parseVacuity(line("  ^[[31mSURVIVED^[[0m src/test/a.test.ts ⟵ src/a.tsx"))).toMatchObject({ fail: 1, total: 1 });
    expect(sb.parseVacuity(line("registration: 716/724"))).toBeNull();
  });
});

describe("the live section ages out", () => {
  const stamped = (iso: string) => `**Live rows measured at ${iso}.**`;
  it("fresh is fine; older than 72h, or never measured, is stale", () => {
    expect(checkScoreboardLive(stamped("2026-09-23T10:00Z"), NOW, sb.liveAgeHours)).toEqual([]);
    expect(checkScoreboardLive(stamped("2026-09-20T10:00Z"), NOW, sb.liveAgeHours)).toHaveLength(1);
    expect(checkScoreboardLive("no stamp", NOW, sb.liveAgeHours)).toHaveLength(1);
  });
});
