/**
 * A pressed Log Out / Sign Out button shows that it is working.
 *
 * Owner, 2026-10-09: "I pressed Log Out and nothing happened." The Log Out
 * dialog closed on the press (BrandConfirmDialog's primary is a Dialog Close),
 * and sign-out then awaited the network with nothing on screen. The fix has
 * two halves: signOutWithPushCleanup caps every network step
 * (src/lib/authSignOut.test.ts), and every button a person presses goes
 * through useSignOutAction, whose `signingOut` the button binds to BOTH
 * `disabled` and its label ("Logging Out…"). The three confirm dialogs
 * (Profile, Admin, Security) do that through SignOutConfirmDialog, whose own
 * behaviour test is src/components/auth/SignOutConfirmDialog.test.tsx.
 *
 * The CLASS, from the app's own inventory:
 *  1. Every non-test file that calls signOutWithPushCleanup( is the helper,
 *     the hook, or one of an EXACT allowlist of callers that are not a pressed
 *     Log Out button. Two-way: a new caller fails it, and so does an allowlisted
 *     one that stops calling it (lower the list in the same commit).
 *  2. Every file that calls useSignOutAction( binds `signingOut` to disabled
 *     and to the "Logging Out…" label once per signOut({ … }) it makes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

const HELPER = "src/lib/authSignOut.ts";
const HOOK = "src/hooks/useSignOutAction.ts";

// Not a pressed Log Out button, so they keep their own handling:
//  - Login.tsx: sign-outs inside the sign-in flow (unverified email, a failed
//    MFA lookup) under the form's own `loading` state, and Cancel on the MFA
//    step, which leaves the challenge screen before it signs out.
//  - useSessionTimeout.ts: automatic, nobody pressed anything.
//  - useDeleteAccount.ts: the last step of a confirmed deletion, ref-guarded
//    and run under the delete flow's own state.
const NOT_A_LOG_OUT_BUTTON = [
  "src/hooks/useDeleteAccount.ts",
  "src/hooks/useSessionTimeout.ts",
  "src/pages/auth/Login.tsx",
];

const sources = trackedFiles("src")
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/"))
  .map((f) => ({ f, code: blankComments(readFileSync(f, "utf8")) }));

const count = (code: string, re: RegExp) => (code.match(re) ?? []).length;
const CALLS_HELPER = /\bsignOutWithPushCleanup\s*\(/g;
const CALLS_HOOK = /\buseSignOutAction\s*\(/g;
const SIGN_OUT_CALL = /\bsignOut\s*\(\s*\{/g;
const DISABLED_BOUND = /\b(?:primaryDisabled|disabled)=\{signingOut\}/g;
const LABEL_BOUND = /signingOut\s*\?\s*"Logging Out…"/g;

/** What is wrong with one useSignOutAction caller, or null. */
export function bindingProblem(code: string): string | null {
  const calls = count(code, SIGN_OUT_CALL);
  if (calls === 0) return "calls useSignOutAction() but never signOut({ … })";
  const disabled = count(code, DISABLED_BOUND);
  const label = count(code, LABEL_BOUND);
  if (disabled !== calls) return `${calls} signOut({ … }) call(s) but ${disabled} disabled={signingOut} binding(s)`;
  if (label !== calls) return `${calls} signOut({ … }) call(s) but ${label} signingOut ? "Logging Out…" label(s)`;
  return null;
}

describe("pressed Log Out buttons show progress (owner, 2026-10-09)", () => {
  it("the binding check catches a button with no disabled or no label, and passes a bound one", () => {
    const bound = `const { signingOut, signOut } = useSignOutAction();
      <Button onClick={() => void signOut({ after })} disabled={signingOut}>{signingOut ? "Logging Out…" : "Sign Out"}</Button>`;
    expect(bindingProblem(bound)).toBeNull();
    expect(bindingProblem(bound.replace("disabled={signingOut}", ""))).toMatch(/disabled/);
    expect(bindingProblem(bound.replace('signingOut ? "Logging Out…" : "Sign Out"', '"Sign Out"'))).toMatch(/Logging Out/);
    expect(bindingProblem(bound + `<Button onClick={() => void signOut({ after })}>Sign Out</Button>`)).not.toBeNull();
  });

  it("every caller of signOutWithPushCleanup is the hook or an allowlisted non-button caller (exact, two-way)", () => {
    const callers = sources.filter(({ f, code }) => f !== HELPER && count(code, CALLS_HELPER) > 0).map(({ f }) => f).sort();
    expect(callers.length).toBeGreaterThan(2);
    expect(callers, "a pressed Log Out button must use useSignOutAction (src/hooks/useSignOutAction.ts)").toEqual(
      [HOOK, ...NOT_A_LOG_OUT_BUTTON].sort(),
    );
  });

  it("every useSignOutAction caller binds signingOut to disabled and the Logging Out… label", () => {
    const users = sources.filter(({ f, code }) => f !== HOOK && count(code, CALLS_HOOK) > 0);
    // SignOutConfirmDialog (Profile, Admin, SecurityTab), AccountBanned and
    // CompleteProfile on 2026-10-09.
    expect(users.length).toBeGreaterThan(2);
    const problems = users.map(({ f, code }) => [f, bindingProblem(code)] as const).filter(([, p]) => p);
    expect(problems).toEqual([]);
  });
});

// PROVEN RED 2026-10-09: each mutation below restores one piece of the old
// "nothing happened" wiring and fails this guard (and so did checking out the
// five wired files from origin/main: both inventory tests failed).
// @mutate src/components/auth/SignOutConfirmDialog.tsx | primaryDisabled={signingOut} |
// @mutate src/pages/auth/AccountBanned.tsx | {signingOut ? "Logging Out…" : "Sign Out"} | Sign Out
// @mutate src/pages/profile/Profile.tsx | after={() => navigate("/")} | after={async () => { await signOutWithPushCleanup(); navigate("/"); }}
