/**
 * A pressed Log Out / Sign Out button shows that it is working.
 *
 * Owner, 2026-10-09: "I pressed Log Out and nothing happened." The Log Out
 * dialog closed on the press (BrandConfirmDialog's primary is a Dialog Close),
 * and sign-out then awaited the network with nothing on screen. The fix has
 * two halves: signOutWithPushCleanup caps every network step
 * (src/lib/authSignOut.test.ts), and every button a person presses goes
 * through useSignOutAction, whose `signingOut` the button binds to BOTH
 * `disabled` and its label ("Logging out…"). The three confirm dialogs
 * (Profile, Admin, Security) do that through SignOutConfirmDialog, whose own
 * behaviour test is src/components/auth/SignOutConfirmDialog.test.tsx.
 *
 * The CLASS, from the app's own inventory:
 *  1. Every non-test file that calls signOutWithPushCleanup( is the helper,
 *     the hook, or one of an EXACT allowlist of callers that are not a pressed
 *     Log Out button. Two-way: a new caller fails it, and so does an allowlisted
 *     one that stops calling it (lower the list in the same commit).
 *  2. Every file that calls useSignOutAction( binds `signingOut` to disabled
 *     and to the "Logging out…" label once per signOut({ … }) it makes.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";
import { en } from "@/lib/i18n/en";

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
// The label written in, or (Spanish option, 2026-10-29) a dictionary key whose English is that label.
const LABEL_BOUND = /signingOut\s*\?\s*(?:"Logging out…"|t\("([\w.]+)"\))/g;
const countLabels = (code: string) =>
  [...code.matchAll(LABEL_BOUND)].filter((m) => !m[1] || (en as Record<string, string>)[m[1]] === "Logging out…").length;

/**
 * A caller may hand its button to a child component (CompleteProfile's wait card, moved into
 * src/pages/auth/completeProfile/CheckingProfileCard.tsx by Q806, 2026-11-07): `<Child signingOut={signingOut} …>`.
 * The binding then lives in the child, so each such hand-off counts once, for disabled and for the label
 * separately, only when the child's own source (resolved from the caller's import) binds them.
 */
const HAND_OFF = /<([A-Z]\w*)\b[^>]*?\bsigningOut=\{signingOut\}/g;
function handOffs(code: string, readChild: (name: string) => string | null): { disabled: number; label: number } {
  let disabled = 0;
  let label = 0;
  for (const m of code.matchAll(HAND_OFF)) {
    const child = readChild(m[1]);
    if (!child) continue;
    if (count(child, DISABLED_BOUND) > 0) disabled++;
    if (countLabels(child) > 0) label++;
  }
  return { disabled, label };
}

/** The source of the component `name` that `file` imports from a relative or @/ path, or null. */
function importedSource(file: string, code: string, name: string): string | null {
  const m = code.match(new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*"([^"]+)"`));
  if (!m) return null;
  const spec = m[1];
  const base = spec.startsWith("@/") ? `src/${spec.slice(2)}` : spec.startsWith(".") ? join(dirname(file), spec) : null;
  if (!base) return null;
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    if (existsSync(base + ext)) return blankComments(readFileSync(base + ext, "utf8"));
  }
  return null;
}

/** What is wrong with one useSignOutAction caller, or null. */
export function bindingProblem(code: string, readChild: (name: string) => string | null = () => null): string | null {
  const calls = count(code, SIGN_OUT_CALL);
  if (calls === 0) return "calls useSignOutAction() but never signOut({ … })";
  const handed = handOffs(code, readChild);
  const disabled = count(code, DISABLED_BOUND) + handed.disabled;
  const label = countLabels(code) + handed.label;
  if (disabled !== calls) return `${calls} signOut({ … }) call(s) but ${disabled} disabled={signingOut} binding(s)`;
  if (label !== calls) return `${calls} signOut({ … }) call(s) but ${label} signingOut ? "Logging out…" label(s)`;
  return null;
}

describe("pressed Log Out buttons show progress (owner, 2026-10-09)", () => {
  it("the binding check catches a button with no disabled or no label, and passes a bound one", () => {
    const bound = `const { signingOut, signOut } = useSignOutAction();
      <Button onClick={() => void signOut({ after })} disabled={signingOut}>{signingOut ? "Logging out…" : "Sign out"}</Button>`;
    expect(bindingProblem(bound)).toBeNull();
    expect(bindingProblem(bound.replace("disabled={signingOut}", ""))).toMatch(/disabled/);
    expect(bindingProblem(bound.replace('signingOut ? "Logging out…" : "Sign out"', '"Sign out"'))).toMatch(/Logging out/);
    expect(bindingProblem(bound + `<Button onClick={() => void signOut({ after })}>Sign Out</Button>`)).not.toBeNull();
    // A dictionary key counts only when its English is the progress label.
    expect(bindingProblem(bound.replace('"Logging out…"', 't("profileGate.loggingOut")'))).toBeNull();
    expect(bindingProblem(bound.replace('"Logging out…"', 't("profileGate.signOut")'))).toMatch(/Logging out/);
    // A hand-off to a child counts only when the child binds both.
    const handing = `const { signingOut, signOut } = useSignOutAction();
      <Card signingOut={signingOut} onSignOut={() => { void signOut({ after }); }} />`;
    const goodChild = `<Button onClick={onSignOut} disabled={signingOut}>{signingOut ? "Logging out…" : "Sign out"}</Button>`;
    expect(bindingProblem(handing, () => goodChild)).toBeNull();
    expect(bindingProblem(handing, () => goodChild.replace("disabled={signingOut}", ""))).toMatch(/disabled/);
    expect(bindingProblem(handing, () => null)).toMatch(/disabled/);
  });

  it("every caller of signOutWithPushCleanup is the hook or an allowlisted non-button caller (exact, two-way)", () => {
    const callers = sources.filter(({ f, code }) => f !== HELPER && count(code, CALLS_HELPER) > 0).map(({ f }) => f).sort();
    expect(callers.length).toBeGreaterThan(2);
    expect(callers, "a pressed Log Out button must use useSignOutAction (src/hooks/useSignOutAction.ts)").toEqual(
      [HOOK, ...NOT_A_LOG_OUT_BUTTON].sort(),
    );
  });

  it("every useSignOutAction caller binds signingOut to disabled and the Logging out… label", () => {
    const users = sources.filter(({ f, code }) => f !== HOOK && count(code, CALLS_HOOK) > 0);
    // SignOutConfirmDialog (Profile, Admin, SecurityTab), AccountBanned and
    // CompleteProfile on 2026-10-09.
    expect(users.length).toBeGreaterThan(2);
    const problems = users.map(({ f, code }) => [f, bindingProblem(code, (name) => importedSource(f, code, name))] as const).filter(([, p]) => p);
    expect(problems).toEqual([]);
  });
});

// PROVEN RED 2026-10-09: each mutation below restores one piece of the old
// "nothing happened" wiring and fails this guard (and so did checking out the
// five wired files from origin/main: both inventory tests failed).
// @mutate src/components/auth/SignOutConfirmDialog.tsx | primaryDisabled={signingOut} |
// @mutate src/pages/auth/AccountBanned.tsx | {signingOut ? "Logging out…" : "Sign out"} | Sign Out
// @mutate src/pages/profile/Profile.tsx | after={() => navigate("/")} | after={async () => { await signOutWithPushCleanup(); navigate("/"); }}
// @mutate src/pages/auth/completeProfile/CheckingProfileCard.tsx |         disabled={signingOut}\n |
