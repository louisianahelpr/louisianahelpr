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
 * UPDATED 2026-09-05 — the anchor moved, and so did the reason.
 *
 *   The helper is now jobLocalStartMs(dateNeeded, startTime), not
 *   jobLocalMidnightMs(dateNeeded). The zone half of the story above is
 *   unchanged and still the reason the `new Date(d + "T00:00:00")` guard below
 *   exists. What changed is WHICH INSTANT is correct: the ladder used to
 *   measure notice from MIDNIGHT of the job's day because start_time was never
 *   consulted, so a 6:00 PM job was priced as if it began at 00:00 and every
 *   cancellation landed a tier harsher than the policy discloses. Midnight is
 *   never later than the real start, so it could only ever overcharge.
 *
 *   The parity this file protects is therefore now two-dimensional: the quote
 *   we SHOW and the fee we PERSIST must agree on the zone (as before) AND on
 *   the anchor. Asserting the component imports jobLocalStartMs is what stops
 *   the displayed estimate drifting back to midnight while the server charges
 *   from the start — which would reinstate the original split with a friendlier
 *   face, quoting free and charging 25%.
 *
 * This is a SOURCE check on purpose: the defect is "a second implementation
 * exists", and no value-level test can see that — the mirror will always agree
 * with itself. What must be true is that the file contains no hand-rolled date
 * parse or inline ladder at all.
 *
 * Since 20260828020000 the file must also contain no PERSISTED fee: the write
 * moved server-side into poster_cancel_job, because a client that can write
 * the fee can forge it and a client that can write status='cancelled' can skip
 * the reliability ladder. The last test below pins that.
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
    expect(SRC).toContain("jobLocalStartMs");
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

  it("does not persist the fee at all — the server derives it", () => {
    // SUPERSEDES the old "both the quote and the write call the shared percent
    // fn" assertion. That test encoded a weaker architecture: the client wrote
    // status/cancelled_by/cancellation_fee/cancellation_fee_status onto `jobs`
    // itself, so the best it could ask for was that the write agree with the
    // quote. It could not ask whether the write should exist.
    //
    // It should not. Any client that can write `cancellation_fee` can write
    // ANY cancellation_fee, and any client that can write `status='cancelled'`
    // can do it without the reliability ladder that lives in the RPC — which
    // is exactly what a helper did (migration 20260828020000). The columns are
    // now server-owned (trg_cancellation_requires_rpc) and the fee is derived
    // inside poster_cancel_job from the SQL twins of this same ladder
    // (cancellation_fee_percent / job_hours_until_start), so the quote below
    // is display-only and there is no second number to disagree with it.
    //
    // The invariant that must not regress: this file cancels through the RPC
    // and never through a direct write of a cancellation column.
    expect(SRC).toContain("poster_cancel_job");

    const guarded = [
      "cancellation_fee",
      "cancellation_fee_status",
      "cancelled_by",
      "cancelled_at",
      "late_cancellation",
    ];
    // Guarded columns may only appear as object KEYS in a write payload —
    // which is precisely what must not exist here any more.
    for (const col of guarded) {
      const asWriteKey = new RegExp(`\\b${col}\\s*:`, "g");
      const hits = SRC.match(asWriteKey) ?? [];
      expect(
        hits,
        `${col} is written client-side; it is set by poster_cancel_job`,
      ).toEqual([]);
    }

    // And no client-side status flip to 'cancelled' either.
    expect(SRC).not.toMatch(/status\s*:\s*["']cancelled["']/);

    // The display quote still runs the shared ladder, exactly once.
    const calls = SRC.match(/sharedCancellationFeePercent\(/g) ?? [];
    expect(calls.length, "the displayed quote must use the shared ladder").toBe(1);
  });
});
