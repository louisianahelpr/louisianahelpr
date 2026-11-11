/**
 * Whole-app audit 11-10, Builder 2.
 *
 * F260n: sign-up's step 2 added no history entry, so the browser's Back left sign-up and Forward came back to a
 * blank step 1. Step 2 is now its own entry (location.state.step === 2): Back returns to step 1 with the typed
 * fields still in state, Forward returns to step 2, and the header's back walks the same history.
 * F219: the password rules were written twice (a sentence, then a five-item checklist). The checklist is the one
 * visible copy; the sentence stays as the list's aria-label.
 *
 * @mutate src/pages/auth/signup/signupHelpers.ts |   return (state as { step?: unknown } \| null \| undefined)?.step === 2 ? 2 : 1; |   return 1;
 * @mutate src/pages/auth/signup/useSignupStepHistory.ts | setStep(signupStepFromHistory(routerLocation.state)); | setStep(1);
 * @mutate src/pages/auth/Signup.tsx |               goToStep2(); |               setStep(2);
 * @mutate src/pages/auth/signup/useSignupStepHistory.ts |     if (signupStepFromHistory(routerLocation.state) === 2) navigate(-1); |     if (false) navigate(-1);
 * @mutate src/components/auth/PasswordRuleList.tsx |       <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label={hint}> |       <p className="text-ds-11 text-muted-foreground">{hint}</p><ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label={hint}>
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { blankComments } from "@/test/helpers/blankNonCode";
import { signupStepFromHistory } from "@/pages/auth/signup/signupHelpers";
import { PasswordRuleList } from "@/components/auth/PasswordRuleList";

const ROOT = resolve(__dirname, "../..");
const src = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

describe("F260n: sign-up step 2 is a history entry", () => {
  it("the entry's state names the step; anything else is step 1", () => {
    expect(signupStepFromHistory({ step: 2 })).toBe(2);
    expect(signupStepFromHistory({ step: 2, redirect: "/jobs" })).toBe(2);
    expect(signupStepFromHistory({ step: 1 })).toBe(1);
    expect(signupStepFromHistory({ step: "2" })).toBe(1);
    expect(signupStepFromHistory(null)).toBe(1);
    expect(signupStepFromHistory(undefined)).toBe(1);
    expect(signupStepFromHistory({})).toBe(1);
  });

  it("Continue pushes the entry, popstate reads it, and the header's back walks history", () => {
    const s = src("src/pages/auth/Signup.tsx");
    const hook = src("src/pages/auth/signup/useSignupStepHistory.ts");
    // Continue on step 1 pushes a same-URL entry whose state says step 2 (other state, like ?redirect, is kept).
    expect(s).toContain("goToStep2();");
    expect(hook).toMatch(/navigate\(\{ pathname: routerLocation\.pathname, search: routerLocation\.search \}, \{ state: \{ \.\.\.\(\(routerLocation\.state as object \| null\) \?\? \{\}\), step: 2, \[KEEP_PAGE\]: true \} \}\);/);
    // The step follows the history entry on Back/Forward only (a replace or push elsewhere never resets the wizard;
    // the lead's 11-10 fix for the signed-in bounce), and the first render keeps the dev-only ?step seed.
    expect(hook).toContain("if (routerLocation.key === seenKey.current) return;");
    expect(hook).toContain('if (navigationType === "POP") setStep(signupStepFromHistory(routerLocation.state));');
    expect(hook).toMatch(/\}, \[navigationType, routerLocation\.key, routerLocation\.state, setStep\]\);/);
    // Back from the pushed second step pops that entry instead of forking the history.
    expect(hook).toContain("if (signupStepFromHistory(routerLocation.state) === 2) navigate(-1);");
    expect(s).toContain("backOnClick: backToStep1 }");
    // No bare jump to step 2 remains in the page; the hook's goToStep2 is the one.
    expect(s.match(/setStep\(2\)/g) ?? []).toHaveLength(0);
    expect(hook.match(/setStep\(2\)/g) ?? []).toHaveLength(1);
  });
});

describe("F219: the password rules are written once", () => {
  it("the checklist is the visible copy and keeps the sentence as its label", () => {
    render(<PasswordRuleList password="" />);
    const list = screen.getByRole("list");
    expect(list.getAttribute("aria-label")).toMatch(/^At least 12 characters/);
    expect(list.querySelectorAll("li")).toHaveLength(5);
    expect(screen.queryByText(/^At least 12 characters/)).toBeNull();
    const rules = src("src/components/auth/PasswordRuleList.tsx");
    expect(rules).not.toMatch(/<p[^>]*>\{hint\}<\/p>/);
  });
});
