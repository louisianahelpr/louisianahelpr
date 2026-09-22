/*
 * CLASS GUARD: every money/trust-critical path must declare HOW YOU WOULD KNOW
 * IT EVER RAN in production.
 *
 * Owner, 2026-09-22, after being told three core paths had never once executed:
 * "there is no point of launch if we cant even tell if it can execute."
 *
 * WHAT WENT WRONG, and why no existing check could see it. This repo already
 * holds the line that a TEST must be shown able to fail (the vacuity gate, 663
 * of 671 guards mutation-proven). That standard was never applied to
 * PRODUCTION EXECUTION, so nothing anywhere could answer "has this code ever
 * actually run?" — and on 2026-09-22 a hand-written row count found four money
 * paths at ZERO executions, each of which every audit had previously called
 * healthy after reading the code:
 *
 *   gift_cards                 0 rows  — the whole gift feature
 *   dispute_settlement_claims  0 rows  — execute-dispute-split
 *   user_strikes               0 rows  — the entire enforcement system
 *   referral_credits           0 rows  — no referral ever credited
 *
 * and a fifth that was worse because it LOOKED exercised: 41 jobs had reached
 * `payout_pending`/`released`, 100% of them `is_seed = true`, while both payout
 * crons filter `is_seed = false`. The fixtures and the production code were
 * mutually exclusive by construction, so the tests could never have executed
 * the real path no matter how green they went.
 *
 * WHY THIS IS A DECLARATION CHECK AND NOT AN EXECUTION ASSERTION. A test that
 * failed on "zero executions" would be permanently and correctly red before
 * launch — nobody has bought a gift card yet, and that is not a defect. What is
 * a defect is being UNABLE TO TELL. So this guard does not demand that a path
 * has run; it demands that every critical path names the observable production
 * side effect by which you could check. The count itself is reported by
 * scripts/audit/production-execution-inventory.mjs, which reads these same
 * declarations and queries prod.
 *
 * The inventory is DERIVED from supabase/functions/, never hand-listed: a new
 * money function cannot be added without also saying how you would know it ran.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const FUNCTIONS_DIR = resolve(ROOT, "supabase", "functions");
const DECLARATIONS_PATH = resolve(ROOT, "scripts", "audit", "production-execution-inventory.json");

/**
 * What makes a function money/trust critical. Derived from its NAME, so the
 * set grows automatically — the failure mode this guards against is somebody
 * adding `create-something-payment` and nobody noticing it is unobservable.
 */
const CRITICAL = /payout|payment|release|refund|dispute|strike|referral|gift|credit|subscri|boost|tip|cash-out|instant/i;

/** Edge functions that are money/trust critical, read from the filesystem. */
function criticalFunctions(): string[] {
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .filter((n) => CRITICAL.test(n))
    .sort();
}

interface Declaration {
  /** The production side effect that proves this ran: a table, or a documented reason it has none. */
  observable: string;
  /** Why this is the right signal, in one line. */
  why: string;
}

function declarations(): Record<string, Declaration> {
  if (!existsSync(DECLARATIONS_PATH)) return {};
  return JSON.parse(readFileSync(DECLARATIONS_PATH, "utf8")) as Record<string, Declaration>;
}

describe("every money path declares how you would know it ran", () => {
  it("the scan finds real critical functions (an empty inventory passes vacuously)", () => {
    const fns = criticalFunctions();
    expect(fns.length, "no money/trust-critical edge functions were found").toBeGreaterThanOrEqual(15);
    // Spot-check the two that were actually unobservable on 2026-09-22.
    expect(fns).toContain("process-scheduled-payouts");
    expect(fns).toContain("execute-dispute-split");
  });

  it("every critical function declares an observable production side effect", () => {
    const declared = declarations();
    const undeclared = criticalFunctions().filter((fn) => !declared[fn]?.observable);
    expect(
      undeclared,
      "These money/trust-critical functions do not say how you would know they ever ran in " +
        "production. On 2026-09-22 four such paths were found at ZERO executions, each " +
        "previously reported healthy on a code read alone, and a fifth looked exercised only " +
        "because its 41 rows were all `is_seed = true` while the real cron filters seed rows " +
        "out.\n\nAdd an entry to scripts/audit/production-execution-inventory.json naming the " +
        "table (or the documented reason there is no observable side effect). Declaring it is " +
        "not the same as having run it — the count is reported separately by " +
        "production-execution-inventory.mjs.\n\nUndeclared:",
    ).toEqual([]);
  });

  it("no declaration is an empty promise", () => {
    const bad = Object.entries(declarations())
      .filter(([, d]) => !d.why || d.why.trim().length < 12)
      .map(([fn]) => fn);
    expect(bad, "a declaration must say WHY its signal is the right one").toEqual([]);
  });
});

// Proof this is able to fail: remove a declaration and the guard names the
// function that can no longer be checked. Targets the DECLARATIONS, not this
// file's own pattern — a guard whose inventory is also its oracle cannot fail.
// @mutate scripts/audit/production-execution-inventory.json | "execute-dispute-split":       { "observable": "dispute_settlement_claims", | "execute-dispute-split":       { "observable": "",
