/*
 * CLASS GUARD: a journey may not click a switch its own parents gate, without
 * first turning those parents on.
 *
 * `NotificationPreferences` renders CHILD switches disabled when a parent is
 * off — e.g. "Daily match digest" is
 * `disabled={!loaded || !prefs.push_enabled || !prefs.job_matches}`. That is
 * correct product behaviour. A test that clicks such a child while a parent is
 * off can only ever time out, and the message it prints
 * ("locator.click: Timeout 20000ms exceeded") says nothing about the cause.
 *
 * WHY THIS IS A CLASS AND NOT ONE TEST. The failure POISONS THE ACCOUNT and so
 * guarantees its own repeat. `keyboard-focus.spec.ts` walks
 * `page.getByRole("switch")` — every switch on the screen — and activates
 * them, which turns the master push toggle off and leaves it off. Measured on
 * prod 2026-09-22: both E2E accounts had `push_enabled = false` with
 * `updated_at` inside that night's run (helper 23:02:59, poster 23:03:20),
 * while every other seed account had it true. e2e-journeys (#1595) had then
 * been red for 221 hours.
 *
 * A shared account plus state-mutating tests means order is not guaranteed and
 * yesterday's run is part of today's fixture. The only robust answer is that a
 * step ASSERTS its preconditions rather than inheriting them.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const PREFS = join(root, "src/components/NotificationPreferences.tsx");
const JOURNEYS = join(root, "e2e/journeys");

const prefsSrc = readFileSync(PREFS, "utf8");

/**
 * Child switches, derived from the component rather than hand-listed: any
 * `ariaLabel="…"` whose row is disabled by something beyond `!loaded`.
 */
function gatedChildLabels(): string[] {
  const out: string[] = [];
  // Each SwitchRow spans from its `disabled={…}` to its `ariaLabel="…"`.
  for (const m of prefsSrc.matchAll(/disabled=\{([^}]*)\}\s*\n\s*ariaLabel="([^"]+)"/g)) {
    const cond = m[1];
    if (/prefs\.\w+/.test(cond)) out.push(m[2]);
  }
  return out;
}

describe("journeys establish a gated switch's preconditions", () => {
  it("the component still has gated child switches (inventory is real)", () => {
    const gated = gatedChildLabels();
    expect(
      gated.length,
      "No gated child switches found. Either the component changed shape or this " +
        "scan broke — a guard that silently finds nothing is the failure mode this " +
        "repo keeps hitting, so fix the scan rather than deleting the test.",
    ).toBeGreaterThan(0);
    expect(gated).toContain("Daily match digest");
  });

  it("no journey clicks a gated child without enabling its parents first", () => {
    const gated = new Set(gatedChildLabels());
    const offenders: string[] = [];

    for (const f of readdirSync(JOURNEYS).filter((n) => n.endsWith(".spec.ts"))) {
      const src = readFileSync(join(JOURNEYS, f), "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const label of gated) {
        if (!code.includes(`"${label}"`)) continue;
        // It touches a gated child. It must ALSO turn a parent on, or assert
        // the child is enabled before clicking it.
        const establishes =
          code.includes("master toggle") ||
          /toBeEnabled\(/.test(code);
        if (!establishes) offenders.push(`${f} → "${label}"`);
      }
    }

    expect(
      offenders,
      "These journeys click a switch that the component disables when a parent " +
        "preference is off, without establishing that parent. On a SHARED test " +
        "account another spec can leave the parent off — keyboard-focus.spec.ts " +
        "activates every switch on the screen — and the click then times out with " +
        "a message that names nothing. Turn the parents on first, or assert " +
        "toBeEnabled() and fail with a real reason:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("03-account turns BOTH of the digest's parents on", () => {
    // Named explicitly because this is the one that cost 221 hours.
    const code = readFileSync(join(JOURNEYS, "03-account.spec.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toContain("Push notifications master toggle");
    expect(code).toContain("Job Matches push");
    expect(code).toMatch(/toBeEnabled\(/);
  });
});

// Proof this is able to fail: remove the precondition loop and the step goes
// back to assuming a state another spec is free to destroy.
// @mutate e2e/journeys/03-account.spec.ts | for (const parent of ["Push notifications master toggle", "Job Matches push"]) { | for (const parent of []) {
