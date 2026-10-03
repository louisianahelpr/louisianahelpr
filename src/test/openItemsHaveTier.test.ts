// @mutate docs/OPEN.md | **Q7 MEDIUM WebKit only | **Q7 WebKit only
// @mutate scripts/lib/openFeeds.mjs | POLISH: "LOW" }) | POLISH: "POLISH" })
/*
 * Every open (`- [ ]`) and partly-done (`- [~]`) top-level item in
 * docs/OPEN.md carries exactly one priority tier: HIGH, MEDIUM or LOW
 * (owner order, 2026-10-02: "all items needs a tier").
 *   HIGH   launch blocker, money/escrow, auth/RLS/data exposure, live prod defect, main red
 *   MEDIUM real user-visible defect that is not a blocker; nightly/monitor reliability
 *   LOW    polish, docs, cleanup, dead code, tooling
 * Q items carry it right after the id (`**Q797 MEDIUM ...`); others as the
 * first word after `- [ ] `. scripts/open-sync-trackers.mjs emits one on
 * every item it mirrors (bus severity, POLISH -> LOW, unknown -> MEDIUM).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyFeeds, tierOf } from "../../scripts/lib/openFeeds.mjs";
// @ts-expect-error — plain .mjs script, no declaration file
import { queueCounts } from "../../scripts/queue-count.mjs";

const ROOT = join(__dirname, "..", "..");
const md = readFileSync(join(ROOT, "docs/OPEN.md"), "utf8");
const TIER = /\b(HIGH|MEDIUM|LOW)\b/;

describe("every open OPEN.md item has a tier", () => {
  const items = md.split("\n").map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => /^- \[[ ~]\] /.test(l));

  // Not a magic floor: a fixed "more than 300" (2026-10-03) would fail the day
  // the list honestly shrinks below it, and the owner's goal is 0. What this
  // must prove is that the regex reads the REAL set, so it has to equal what
  // queue-count computes from the same file (numbered open + partly done +
  // unnumbered open lines), and be non-empty while that count is.
  it("measures the real set of open items (agrees with queue-count)", () => {
    const c = queueCounts(md);
    expect(items.length).toBe(c.open + c.partial + c.unnumbered);
    if (c.open + c.partial > 0) expect(items.length).toBeGreaterThan(0);
  });

  it("no open or partly-done item lacks HIGH/MEDIUM/LOW", () => {
    const missing = items.filter(({ l }) => !TIER.test(l)).map(({ l, n }) => `OPEN.md:${n} ${l.slice(0, 100)}`);
    expect(missing, "add HIGH, MEDIUM or LOW after the Q-number").toEqual([]);
  });
});

describe("open-sync-trackers emits a tier on every mirrored item", () => {
  it("maps bus severity to a tier, POLISH to LOW, unknown to MEDIUM", () => {
    expect(["HIGH", "MEDIUM", "LOW", "POLISH", "BOGUS", undefined].map(tierOf)).toEqual(["HIGH", "MEDIUM", "LOW", "LOW", "MEDIUM", "MEDIUM"]);
  });

  it("a created item carries its tier once, and a tierless group gets MEDIUM", () => {
    const groups = [
      { keys: ["bus X-1"], title: "POLISH audit finding X-1 (s): c", origin: "o", markers: ["done-when: bus X-1 closed"], tier: tierOf("POLISH") },
      { keys: ["bus X-2"], title: "HIGH audit finding X-2 (s): c", origin: "o", markers: ["done-when: bus X-2 closed"], tier: tierOf("HIGH") },
      { keys: ["issue #9999"], title: "nightly-red: foo is red", origin: "o", markers: ["done-when: issue #9999 closed"] },
    ];
    const out = applyFeeds("# OPEN\n", groups, { status: () => "open", nextFree: 9000, today: "2026-10-02" });
    const made = out.md.split("\n").filter((l) => /^- \[ \] \*\*Q900\d/.test(l));
    expect(made.map((l) => l.match(/^- \[ \] \*\*Q\d+ (\S+ \S+)/)?.[1])).toEqual(["LOW POLISH", "HIGH audit", "MEDIUM nightly-red:"]);
    expect(made.every((l) => TIER.test(l))).toBe(true);
  });
});
