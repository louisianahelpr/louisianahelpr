/**
 * OA-002: one Create Account tap fired two concurrent auth.signUp() calls.
 * `loading` (the button's disabled flag) is only set inside
 * createAccountAndFinish, after the awaited validation, so a second tap during
 * validation passed. The submit must take the in-flight guard before its first
 * await. Since owner 11-23 the one sign-up screen's "Create account" is that submit.
 * @mutate src/pages/auth/Signup.tsx | if (submittingRef.current) return; | void submittingRef;
 * @mutate src/pages/auth/Signup.tsx | submittingRef.current = false; | void 0;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/pages/auth/Signup.tsx", "utf8");

describe("signup Create Account is single-flight (OA-002)", () => {
  const handler = src.slice(src.indexOf("const submit = async () => {"), src.indexOf("await createAccountAndFinish();", src.indexOf("const submit = async () => {")));

  it("the submit handler is found and is what Create account calls", () => {
    expect(handler).toContain("validateAccountStep()");
    expect(src).toContain("onContinue={submit}");
  });

  it("takes the in-flight guard before the first await", () => {
    const firstAwait = handler.indexOf("await ");
    const check = handler.indexOf("if (submittingRef.current) return;");
    const take = handler.indexOf("submittingRef.current = true;");
    expect(check).toBeGreaterThan(-1);
    expect(take).toBeGreaterThan(check);
    expect(firstAwait).toBeGreaterThan(take);
  });

  it("releases the guard in a finally", () => {
    const after = src.slice(src.indexOf("await createAccountAndFinish();"));
    expect(after.slice(0, 200)).toMatch(/finally \{\s*submittingRef\.current = false;/);
  });
});
