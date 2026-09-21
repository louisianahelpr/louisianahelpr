/*
 * CLASS CHECK — every biometric gate must have a test that REFUSES.
 *
 * `requireBiometric()` short-circuits on web:
 *
 *     if (!isNativePlatform) return true;
 *
 * so under vitest it always succeeds. A test that does not mock
 * `@/lib/biometricGate` cannot observe the gate at all — the whole Face ID
 * confirmation can be deleted and the suite stays green.
 *
 * FOUND TWICE TODAY, both on account-takeover primitives:
 *   - `DeleteUserDialog` — the confirmation in front of permanently deleting a
 *     member's account was unobservable; `if (!ok) return;` was deletable with
 *     4/4 green. Fixed.
 *   - `EditEmailDialog` — the gate in front of repointing a user's LOGIN EMAIL
 *     could be deleted with all 5 tests green. Still open.
 *
 * Measured 2026-09-21: **twelve** components call `requireBiometric`, guarding
 * instant cash-outs, referral cash-outs, four payout-account operations,
 * refunds, single AND bulk payout runs, dispute settlements, bans, granting and
 * removing admin, account deletion, and the login-email change. **Two** had a
 * test that drove a refusal.
 *
 * Worse than absent: three of the five files that DO mock the gate mock it to
 * return `true`. That is not coverage, it is the opposite — it removes the gate
 * from the test's world so the surrounding assertions pass. A reader counting
 * "files that mock biometricGate" would have called this covered.
 *
 * THE RULE: a component that calls `requireBiometric` has a test that drives it
 * to `false` and asserts the action did not happen. This file checks the first
 * half statically — that some test mocks the gate AND resolves it false for
 * that component. It cannot check the second half; that is what the mutation
 * registered at the bottom of each such test is for.
 *
 * RATCHET: the ten below are today's debt and the list may only SHRINK.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");

const files = () =>
  execFileSync("git", ["ls-files", "--", "src/*.ts", "src/*.tsx"], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 1 << 24,
  })
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);

/** Components that actually CALL the gate (comments blanked — several discuss it). */
function gatedComponents(): string[] {
  return files()
    .filter((f) => !/\.(test|spec)\.tsx?$/.test(f) && f !== "src/lib/biometricGate.ts")
    .filter((f) => /\brequireBiometric\s*\(/.test(blankComments(readFileSync(resolve(REPO, f), "utf8"))))
    .sort();
}

/** Test files that mock the gate AND drive it to a refusal. */
function testsThatRefuse(): { file: string; body: string }[] {
  return files()
    .filter((f) => /\.(test|spec)\.tsx?$/.test(f))
    .map((f) => ({ file: f, body: readFileSync(resolve(REPO, f), "utf8") }))
    .filter((t) => /vi\.mock\(\s*["']@\/lib\/biometricGate["']/.test(t.body))
    .filter((t) => /mockResolvedValue(Once)?\(\s*false\s*\)|=>\s*false\b|:\s*false\b/.test(t.body));
}

/**
 * Known, reported, NOT covered. MAY ONLY SHRINK.
 *
 * 2026-09-21, ten → four. The six highest-stakes gates now each have a test
 * that mocks `@/lib/biometricGate`, drives `requireBiometric` to `false`, and
 * asserts the ACTION DID NOT HAPPEN — the RPC or edge invoke called zero
 * times, no success toast, the dialog still open — with a mutation registered
 * on that component's own `if (!ok)` so the assertion is shown able to fail:
 *
 *   EditEmailDialog (login email), AdminPayoutBatches (single AND bulk payout,
 *   two gates), InstantPayoutDialog (instant cash-out), AdminJobs (refund),
 *   AdminSettings (grant AND remove admin, two gates), BanDialog (ban).
 *
 * The four left are a second lane's work and are named, not hidden.
 */
const UNPROVEN: readonly string[] = [
  "src/components/PayoutSetupForm.tsx",
  "src/components/ReferralSection.tsx",
  "src/components/admin/AdminDisputes.tsx",
  "src/components/profile/SecurityTab.tsx",
];

describe("every biometric gate has a test that refuses", () => {
  const gated = gatedComponents();
  const refusing = testsThatRefuse();

  it("the inventory is real (a check that finds nothing cannot fail)", () => {
    expect(gated.length, "no components call requireBiometric — this guard has rotted").toBeGreaterThan(8);
    expect(gated).toContain("src/components/admin/DeleteUserDialog.tsx");
    expect(refusing.length, "no test drives the gate to false at all").toBeGreaterThan(0);
  });

  /** A component is covered when some refusing test names it. */
  const coveredBy = (component: string) => {
    const stem = basename(component).replace(/\.tsx?$/, "");
    return refusing.filter((t) => t.body.includes(stem)).map((t) => t.file);
  };

  /*
   * ONLY the components that are supposed to be covered. A first cut looped
   * ALL of them and `return`ed early for the ratcheted ten — so the runner
   * printed "src/components/admin/EditEmailDialog.tsx — its gate is driven to
   * a refusal ✓" for a component whose gate is driven to nothing at all.
   *
   * A green line that states a falsehood is worse than no line: it is exactly
   * the thing this whole effort exists to remove, and it was in the guard
   * written to remove it. The ratcheted ten are asserted below, by name, as
   * DEBT.
   */
  const shouldBeCovered = gated.filter((c) => !UNPROVEN.includes(c));

  it("the ratcheted debt is real, and named", () => {
    // Not decoration: if this ever reaches zero the list should be deleted and
    // every component held to the rule above.
    expect(UNPROVEN.length, "the unproven list is empty — delete it and drop the filter").toBeGreaterThan(0);
    expect(shouldBeCovered.length, "every gated component is ratcheted — nothing is being checked").toBeGreaterThan(0);
  });

  it.each(shouldBeCovered.map((c) => [c] as const))("%s — its gate is driven to a refusal", (component) => {
    expect(
      coveredBy(component),
      `${component} calls requireBiometric, and no test mocks the gate and drives it FALSE. ` +
        `requireBiometric returns true on web, so under vitest the confirmation is invisible — the ` +
        `whole gate can be deleted and the suite stays green. That happened twice today, both times ` +
        `in front of an account-takeover primitive.`,
    ).not.toEqual([]);
  });

  it("the unproven list only shrinks", () => {
    const stale = UNPROVEN.filter((c) => !gated.includes(c) || coveredBy(c).length > 0);
    expect(
      stale,
      "these either no longer call requireBiometric, or now have a refusal test — remove them from " +
        "UNPROVEN so the ratchet records the progress",
    ).toEqual([]);
  });

  it("mocking the gate to TRUE is not counted as coverage", () => {
    /*
     * Three of the five files that mock this gate mock it to `true`. That is
     * the opposite of coverage — it removes the gate from the test's world so
     * the surrounding assertions pass. Pin the distinction so a future
     * refactor of this file cannot quietly start counting them.
     */
    const mocksAtAll = files()
      .filter((f) => /\.(test|spec)\.tsx?$/.test(f))
      .filter((f) => /vi\.mock\(\s*["']@\/lib\/biometricGate["']/.test(readFileSync(resolve(REPO, f), "utf8")));
    expect(mocksAtAll.length).toBeGreaterThan(refusing.length);
  });
});

// PROVEN RED 2026-09-21: removing DeleteUserDialog's `mockResolvedValue(false)`
// (its refusal case) fails "src/components/admin/DeleteUserDialog.tsx — its
// gate is driven to a refusal". Removing an entry from UNPROVEN while that
// component still has no refusal test fails the same case.
// SOURCE-TEXT PIN: this proves a refusal is DRIVEN, not that the component
// then does nothing — a test could drive false and assert nothing. That half
// is each guard's own registered mutation. It also matches a test to a
// component by file stem, so a test covering a component it never names is
// invisible to it.
// @mutate src/components/admin/DeleteUserDialog.test.tsx | mockResolvedValue(false) | mockResolvedValue(true)
