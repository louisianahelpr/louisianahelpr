/*
 * A SPAWN TIMEOUT MUST NEVER SCORE AS A KILL.
 *
 * `spawnSync({ timeout })` kills the child with SIGTERM when the budget runs
 * out, and the run exits NON-ZERO. The mutation phase reads non-zero as "the
 * guard noticed", so a run that merely ran out of wall clock was recorded as
 * `killed` — a green verdict manufactured out of a timeout, with the guard
 * having observed nothing at all.
 *
 * Reported 2026-09-21 by the lane registering `overlay-sweep`: that spec is
 * ~22 minutes against a 900s budget, so EVERY mutation of it would have
 * "passed" without running. The same channel exists on the vitest path at 180s.
 *
 * This is the THIRD way this gate has manufactured a proof it never performed:
 *   1. the unescaped `||` parse bug (17 registrations),
 *   2. baselining batched while mutating solo,
 *   3. this.
 * All three are the same shape — something that is not evidence being read as
 * evidence because it happened to be non-zero. That is why this guard checks
 * the VERDICT WIRING and not just the predicate: the predicate being correct
 * while nothing consults it is exactly how the first two survived.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs script, no types
import { timedOut } from "../../scripts/vacuity/run.mjs";

const RUN_MJS = readFileSync(resolve(__dirname, "..", "..", "scripts", "vacuity", "run.mjs"), "utf8");

describe("timedOut — what counts as 'the run never finished'", () => {
  it("recognises the spawnSync timeout error", () => {
    expect(timedOut({ error: { code: "ETIMEDOUT" }, status: null })).toBe(true);
  });

  it("recognises the signal spawnSync uses to kill the child", () => {
    // Node reports the kill as a signal, not always as an error code.
    expect(timedOut({ signal: "SIGTERM", status: null })).toBe(true);
    expect(timedOut({ signal: "SIGKILL", status: null })).toBe(true);
  });

  it("does NOT claim a timeout for an ordinary failing run", () => {
    // This is the half that matters in the other direction: if every non-zero
    // run were called a timeout, no mutation could ever be scored killed.
    expect(timedOut({ status: 1, signal: null })).toBe(false);
    expect(timedOut({ status: 0, signal: null })).toBe(false);
    expect(timedOut({ status: 1, signal: null, error: undefined })).toBe(false);
  });
});

describe("the verdict actually consults it", () => {
  it("checks timedOut BEFORE assigning killed", () => {
    // A correct predicate nobody calls is how the first two fake-kill channels
    // survived. Pin the wiring, not just the function.
    const verdictAt = RUN_MJS.indexOf('verdict = r.green ? "SURVIVED" : "killed"');
    expect(verdictAt, "the verdict assignment moved — re-point this guard").toBeGreaterThan(0);
    const before = RUN_MJS.slice(Math.max(0, verdictAt - 400), verdictAt);
    expect(
      before,
      "nothing checks r.timedOut before the killed/SURVIVED verdict is assigned, so a run killed " +
        "at its spawn budget is scored as a proof it never performed",
    ).toMatch(/r\.timedOut/);
    expect(before, "a timeout must be inconclusive, not killed").toMatch(/inconclusive/);
  });

  it("both runners report the flag the verdict reads", () => {
    // runVitest and runPlaywright each spawn with their own budget; a flag set
    // by only one of them leaves the other path still manufacturing kills.
    expect(RUN_MJS.match(/timedOut: true/g) ?? [], "both spawn paths must set timedOut").toHaveLength(2);
  });
});

// Remove the timeout branch and the verdict falls straight back to
// `killed` for a run that was killed at its spawn budget — the fake kill
// this file exists to prevent, and the way overlay-sweep's every mutation
// would have "passed" without the spec finishing once.
// @mutate scripts/vacuity/run.mjs | if (r.timedOut) { | if (false) {
