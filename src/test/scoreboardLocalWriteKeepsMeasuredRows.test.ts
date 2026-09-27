// @mutate scripts/scoreboard.mjs | return kept.get(key(c)) ?? l; | return l;
// @mutate scripts/scoreboard.mjs | if (!at \|\| (now - new Date(at[1])) / 36e5 > MAX_LIVE_HOURS) continue; | if (!at) continue;
// @mutate scripts/scoreboard.mjs | sbLive = carryForwardMeasured(renderLiveScoreboard(live), committedLive(sbText)); | sbLive = renderLiveScoreboard(live);
/**
 * Q66 follow-up (2026-09-27): a local `node scripts/scoreboard.mjs --write`
 * without CI's secrets measured the SLO rows as UNKNOWN and, in 2b93a3d83,
 * replaced scoreboard.yml's measured verdicts (3f08262f2: payment success
 * PASS 99.00%, API error rate PASS, ...) on main. The class: any live row a
 * less-privileged run cannot measure overwrote a fresher, measured one.
 * A fresh UNKNOWN now keeps the committed measured row while it is within
 * MAX_LIVE_HOURS; past that the UNKNOWN stands.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs script, no declaration file
import { carryForwardMeasured, MAX_LIVE_HOURS } from "../../scripts/scoreboard.mjs";

const row = (signal: string, status: string, at: string, note: string) =>
  `| targets (SLOs) | ${signal} | **${status}** | 99 | 1 | — | 100 | ${at} | src | ${note} |`;
const now = new Date("2026-09-27T12:00:00Z");
const header = "| group | signal | status | pass | fail | skipped | total | measured | source | note |\n|---|---|---|---|---|---|---|---|---|---|";

describe("scoreboard --write keeps measured live rows over a local UNKNOWN", () => {
  const committed = `**Live rows measured at 2026-09-26T21:59Z.**\n\n${header}\n${row("payment success rate", "PASS", "2026-09-26T21:59Z", "99.00%")}`;

  it("a fresh UNKNOWN row keeps the recent measured row for the same signal", () => {
    const fresh = `**Live rows measured at 2026-09-27T07:11Z.**\n\n${header}\n${row("payment success rate", "UNKNOWN", "2026-09-27T07:11Z", "UNKNOWN: measurement failed: no token")}`;
    const out = carryForwardMeasured(fresh, committed, now);
    expect(out).toContain("**PASS**");
    expect(out).toContain("2026-09-26T21:59Z | src | 99.00%");
    expect(out).not.toContain("UNKNOWN: measurement failed");
    expect(out.startsWith("**Live rows measured at 2026-09-27T07:11Z.**")).toBe(true);
  });

  it("a fresh measured row always wins", () => {
    const fresh = `${header}\n${row("payment success rate", "FAIL", "2026-09-27T07:11Z", "80%")}`;
    expect(carryForwardMeasured(fresh, committed, now)).toContain("**FAIL**");
  });

  it("past MAX_LIVE_HOURS the UNKNOWN stands (a lasting failure still shows)", () => {
    const later = new Date(new Date("2026-09-26T21:59Z").getTime() + (MAX_LIVE_HOURS + 1) * 36e5);
    const fresh = `${header}\n${row("payment success rate", "UNKNOWN", "2026-09-30T00:00Z", "UNKNOWN: measurement failed: x")}`;
    expect(carryForwardMeasured(fresh, committed, later)).toContain("**UNKNOWN**");
  });

  it("a committed UNKNOWN is never carried forward", () => {
    const committedUnknown = `${header}\n${row("payment success rate", "UNKNOWN", "2026-09-27T07:06Z", "UNKNOWN: a")}`;
    const fresh = `${header}\n${row("payment success rate", "UNKNOWN", "2026-09-27T07:11Z", "UNKNOWN: b")}`;
    expect(carryForwardMeasured(fresh, committedUnknown, now)).toContain("UNKNOWN: b");
  });

  it("--write passes the committed live section through carryForwardMeasured", () => {
    const src = readFileSync("scripts/scoreboard.mjs", "utf8");
    expect(src).toMatch(/sbLive = carryForwardMeasured\(renderLiveScoreboard\(live\), committedLive\(sbText\)\);/);
  });
});
