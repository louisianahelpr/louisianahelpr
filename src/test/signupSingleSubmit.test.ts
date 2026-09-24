/**
 * OA-002: one Create Account tap fired two concurrent auth.signUp() calls.
 * `loading` (the button's disabled flag) is only set inside
 * createAccountAndFinish, after the awaited validateAboutYouStep, so a second
 * tap during validation passed. The step-2 submit must take the in-flight
 * guard before its first await.
 *
 * @mutate src/pages/auth/Signup.tsx | if (submittingRef.current) return; | void submittingRef;
 * @mutate src/pages/auth/Signup.tsx | submittingRef.current = false; | void 0;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/pages/auth/Signup.tsx", "utf8");

describe("signup Create Account is single-flight (OA-002)", () => {
  const handler = src.slice(src.indexOf("onContinue={async () => {"), src.indexOf("createAccountAndFinish();", src.indexOf("onContinue={async () => {")));

  it("the step-2 handler is found", () => {
    expect(handler).toContain("validateAboutYouStep()");
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
