/*
 * GUARD (one open list, 2026-10-02): every open line in docs/OPEN.md carries a
 * Q number, ratcheted down to zero.
 *
 * A `- [ ] ` line with no **Q<n>** was counted by NOTHING: not the queue-count
 * line, not the scoreboard block, not the session-start hook. On 2026-10-02
 * origin/main 672ffe2e7 held 261 of them beside "178 open" — more
 * untracked open work than tracked. queue-count.mjs and the scoreboard now
 * name them; this pins the number EXACTLY so it can only fall, and falls in
 * the same commit that numbers or ticks one.
 *
 * Red when: the count is not exactly UNNUMBERED_OPEN_LINES — above it (a new
 * unnumbered line: give it a Q number, `node scripts/queue-count.mjs` prints
 * the next free) or below it (you numbered some: lower the constant to the
 * printed count in the same commit). land.sh runs this after every rebase.
 */
// @mutate scripts/queue-count.mjs | OPEN_LINE.test(l) && !NUMBERED_LINE.test(l) | OPEN_LINE.test(l) && false
import { describe, it, expect } from "vitest";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module, no declaration file
import { queueText } from "../../scripts/lib/openQueue.mjs";
// @ts-expect-error — plain .mjs script, no declaration file
import { queueCounts, unnumberedLines } from "../../scripts/queue-count.mjs";

const ROOT = join(__dirname, "..", "..");

/** Unnumbered open lines in docs/OPEN.md + archives, measured 2026-10-02 after the 34-line triage archive plus 4 Stripe-live lines, 2 verified fixes, the EF5 leak fix and the boost_auto_extended migration. */
const UNNUMBERED_OPEN_LINES = 213;

describe("open lines carry a Q number", () => {
  const md = queueText(ROOT) as string;

  it("reads the real queue (floor)", () => {
    expect(queueCounts(md).total).toBeGreaterThan(300);
  });

  it("the detector sees an unnumbered line and ignores numbered/done ones", () => {
    const fixture = ["- [ ] **Q1 numbered.**", "- [ ] no number", "- [~] partly, no number", "- [x] done, no number", "  - [ ] nested sub-step"].join("\n");
    expect(unnumberedLines(fixture)).toEqual(["- [ ] no number", "- [~] partly, no number"]);
  });

  it("unnumbered open lines are exactly the baseline (lower it when you number one)", () => {
    const lines = unnumberedLines(md) as string[];
    expect(
      lines.length,
      `${lines.length} unnumbered open line(s), baseline ${UNNUMBERED_OPEN_LINES}. ` +
        (lines.length > UNNUMBERED_OPEN_LINES
          ? "Give the new line a **Q<n>** number (next free: node scripts/queue-count.mjs)."
          : `Lower UNNUMBERED_OPEN_LINES to ${lines.length} in this commit.`),
    ).toBe(UNNUMBERED_OPEN_LINES);
  });
});
