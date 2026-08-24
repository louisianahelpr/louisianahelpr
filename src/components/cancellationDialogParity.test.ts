import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The fee we SHOW and the fee we PERSIST must come from the same place.
 *
 * `cancellationFee.parity.test.ts` pins the ladder, but it declares its own
 * `clientPercent()` mirror inside the test file rather than importing the path
 * the component actually calls — so it proved the ladder was right while the
 * caller quietly did something else. That is exactly how this shipped:
 *
 *   CancellationDialog computed the DISPLAYED quote with jobLocalMidnightMs()
 *   + the shared ladder, then re-inlined `new Date(date + "T00:00:00")` and a
 *   hand-copied ladder twenty lines later for the PERSISTED write. The string
 *   parse resolves in the runtime's zone, so the browser and the platform
 *   disagreed by 5-6 hours. A $200 job cancelled 24.5h out was quoted 0% and
 *   written as 25% + late_cancellation=true from America/New_York. Chicago
 *   agreed with itself, which is why nobody saw it.
 *
 * This is a SOURCE check on purpose: the defect is "a second implementation
 * exists", and no value-level test can see that — the mirror will always agree
 * with itself. What must be true is that the file contains no hand-rolled date
 * parse or inline ladder at all.
 */
const RAW = readFileSync(
  resolve(__dirname, "CancellationDialog.tsx"),
  "utf8",
);

/**
 * CODE ONLY — comments stripped.
 *
 * The file documents the defect it used to have, quoting the offending
 * `new Date(... + "T00:00:00")` verbatim so the next reader understands why the
 * shared module is mandatory. Scanning the raw text would match that prose and
 * fail on its own explanation, which would push someone to delete the
 * explanation to get green. Strip comments, then assert.
 */
const SRC = RAW
  .replace(/\/\*[\s\S]*?\*\//g, "")  // block comments, including JSDoc
  .replace(/(^|[^:])\/\/.*$/gm, "$1");  // line comments, sparing `://` in URLs

describe("CancellationDialog derives every fee from the shared module", () => {
  it("imports the shared helpers", () => {
    expect(SRC).toMatch(/from\s+["'].*_shared\/cancellationFee["']/);
    expect(SRC).toContain("jobLocalMidnightMs");
    expect(SRC).toContain("sharedCancellationFeePercent");
  });

  it('contains no local-zone `new Date(... + "T00:00:00")` parse', () => {
    // The exact construct that caused the split. It parses in the RUNTIME's
    // zone; jobLocalMidnightMs() resolves midnight in the PLATFORM's zone.
    const localParse = /new Date\(\s*[\w.]+\s*\+\s*["']T00:00:00["']\s*\)/g;
    const hits = SRC.match(localParse) ?? [];
    expect(hits, `local-zone date parse(s) found: ${hits.join(", ")}`).toEqual([]);
  });

  it("contains no second, inline copy of the fee ladder", () => {
    // The hand-copied ladder read `< 2 ? 50 : < 24 ? 25 : 0`. Any reappearance
    // of those magic percentages next to an hours comparison means a caller has
    // started deciding the fee for itself again.
    const inlineLadder = /<\s*2\s*\?\s*50|<\s*24\s*\?\s*25/g;
    const hits = SRC.match(inlineLadder) ?? [];
    expect(hits, `inline fee ladder found: ${hits.join(", ")}`).toEqual([]);
  });

  it("computes the persisted fee from the same percent as the quote", () => {
    // Both the display quote and the write must run the shared percent fn.
    const calls = SRC.match(/sharedCancellationFeePercent\(/g) ?? [];
    expect(
      calls.length,
      "expected the shared percent fn on BOTH the quote and the persisted write",
    ).toBeGreaterThanOrEqual(2);
  });
});
