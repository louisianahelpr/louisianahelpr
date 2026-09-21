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

/*
 * THE RATCHET IS SPENT — and so the list is gone.
 *
 * 2026-09-21 it read ten, then four, then zero. Every component that calls
 * `requireBiometric` now has a test that mocks `@/lib/biometricGate`, drives
 * the gate to `false`, and asserts the ACTION DID NOT HAPPEN — the RPC or edge
 * invoke called zero times, no audit row, no success toast, the dialog still
 * open and not stuck on a processing label — with a mutation registered on
 * that component's own guard so the assertion is shown able to fail:
 *
 *   EditEmailDialog (login email), AdminPayoutBatches (single AND bulk payout),
 *   InstantPayoutDialog (instant cash-out), AdminJobs (refund), AdminSettings
 *   (grant AND remove admin), BanDialog (ban), AppLockGate (app unlock),
 *   PayoutSetupForm (onboard, dashboard, remove method, reset — four),
 *   ReferralSection (referral cash-out), AdminDisputes (quick release/refund,
 *   decide-and-settle, retry settlement — three), SecurityTab (arming the lock).
 *
 * There is deliberately NO exemption list left to add to. A new gated
 * component with no refusal test fails the per-component case below on the
 * commit that adds it, which is the whole point: the debt was paid, and the
 * door it came through is closed.
 */

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
   * EVERY gated component, with no filter. A first cut looped all of them and
   * `return`ed early for the ratcheted ten — so the runner printed
   * "src/components/admin/EditEmailDialog.tsx — its gate is driven to a
   * refusal ✓" for a component whose gate was driven to nothing at all. A
   * green line that states a falsehood is worse than no line. The ratchet that
   * replaced it is now empty, so the filter is gone with it.
   */
  it.each(gated.map((c) => [c] as const))("%s — its gate is driven to a refusal", (component) => {
    expect(
      coveredBy(component),
      `${component} calls requireBiometric, and no test mocks the gate and drives it FALSE. ` +
        `requireBiometric returns true on web, so under vitest the confirmation is invisible — the ` +
        `whole gate can be deleted and the suite stays green. That happened twice today, both times ` +
        `in front of an account-takeover primitive.`,
    ).not.toEqual([]);
  });

  /*
   * THE OTHER WAY A GATE DIES: it is called, and its answer is thrown away.
   *
   * A refusal test can only see a guard that exists. `await
   * requireBiometric(...)` with nothing branching on the result raises the OS
   * sheet, lets the user cancel it, and proceeds anyway — and it LOOKS gated
   * in review, in a grep, and in the component's own comments.
   *
   * Both shapes are legitimate and both are counted: `if (!ok) return;` (abort
   * on refusal — every money action) and `if (ok) { ... }` (act on success —
   * AppLockGate's unlock). What is not legitimate is neither.
   */
  it("every gate BRANCHES on its answer — no call site drops the result", () => {
    const offenders = gated
      .map((f) => {
        const src = blankComments(readFileSync(resolve(REPO, f), "utf8"));
        return {
          file: f,
          calls: (src.match(/\brequireBiometric\s*\(/g) ?? []).length,
          branches: (src.match(/if\s*\(\s*!?\s*ok\b/g) ?? []).length,
        };
      })
      .filter((r) => r.branches < r.calls);
    expect(
      offenders,
      "these call requireBiometric more times than they branch on its result — at least one prompt " +
        "is raised, answered, and ignored. That is worse than no gate: it looks confirmed in review " +
        "and in the component's own comments, and the user's refusal changes nothing.",
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
// gate is driven to a refusal". Adding a new gated component with no refusal
// test fails the same case, now that the exemption list is gone.
// SOURCE-TEXT PIN: this proves a refusal is DRIVEN, not that the component
// then does nothing — a test could drive false and assert nothing. That half
// is each guard's own registered mutation. It also matches a test to a
// component by file stem, so a test covering a component it never names is
// invisible to it, and it reads the git INDEX (`git ls-files`), so a brand-new
// test file is invisible until it is staged.
// @mutate src/components/admin/DeleteUserDialog.test.tsx | mockResolvedValue(false) | mockResolvedValue(true)
// Second half: a gate whose answer is dropped. Deleting ReferralSection's
// guard leaves one `requireBiometric` call and zero branches on `ok`, which is
// the shape "every gate BRANCHES on its answer" exists to find.
// @mutate src/components/ReferralSection.tsx | if (!ok) return; | void ok;
