/**
 * AUD31-53: a server weak_password refusal (a leaked password GoTrue knows, or a rule the client's list does not)
 * arrives after step 2 "About you". It showed as a raw GoTrue toast on step 2, away from step 1's password field,
 * which had read "Strong". Now Signup goes back to step 1 and the reason sits under the password field (role alert,
 * aria-invalid), until the password changes.
 *
 * @mutate src/pages/auth/Signup.tsx |       if (isWeakPasswordError(err)) { |       if (false) {
 * @mutate src/pages/auth/signup/SignupStep1.tsx | \|\| !!serverPasswordError; | ;
 * @mutate src/lib/authErrors.ts |   if (reasons.includes("pwned")) return | if (false) return
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { SignupStep1 } from "@/pages/auth/signup/SignupStep1";
import { weakPasswordWords } from "@/lib/authErrors";

afterEach(cleanup);

function step1(serverPasswordError: string | null) {
  return render(
    <MemoryRouter>
      <SignupStep1
        firstName="Ann" setFirstName={vi.fn()} lastName="Lee" setLastName={vi.fn()}
        email="ann@example.com" setEmail={vi.fn()} password="Abcdefghij1!x" setPassword={vi.fn()}
        serverPasswordError={serverPasswordError}
        showPassword={false} setShowPassword={vi.fn()}
        acceptedPolicies setAcceptedPolicies={vi.fn()} ageConfirmed setAgeConfirmed={vi.fn()}
        marketingConsent={false} setMarketingConsent={vi.fn()}
        inputCls="" labelCls="" onContinue={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe("a server refusal of the password lands on the password field", () => {
  it("names a leaked password in plain words, and restates GoTrue's rules otherwise", () => {
    expect(weakPasswordWords({ code: "weak_password", reasons: ["pwned"], message: "Password is known to be weak and easy to guess, please choose a different one." }))
      .toBe("That password has shown up in a data breach. Pick a different one.");
    expect(weakPasswordWords({ code: "weak_password", reasons: ["length"], message: "Password should be at least 12 characters." }))
      .toBe("Your password needs at least 12 characters.");
  });

  it("step 1 shows the server's reason under the field and marks it invalid", () => {
    step1("That password has shown up in a data breach. Pick a different one.");
    const field = screen.getByLabelText(/password/i, { selector: "input" });
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAttribute("aria-describedby", "signup-password-error");
    expect(document.getElementById("signup-password-error")?.textContent).toContain("That password has shown up in a data breach.");
  });

  it("with no server reason, a strong password shows no error", () => {
    step1(null);
    expect(document.getElementById("signup-password-error")).toBeNull();
  });

  it("Signup sends a weak_password refusal back to step 1 before any toast, and a new password clears it", () => {
    const code = blankComments(readFileSync("src/pages/auth/Signup.tsx", "utf8"));
    const branch = code.indexOf("if (isWeakPasswordError(err)) {");
    expect(branch).toBeGreaterThan(0);
    expect(branch).toBeLessThan(code.indexOf("toast.error(authCopy ?? userFacingError("));
    expect(code.slice(branch, branch + 200)).toMatch(/setServerPasswordError\(weakPasswordWords\(err\)\);[\s\S]*setStep\(1\);[\s\S]*return;/);
    expect(code).toContain("setPassword={(v: string) => { setServerPasswordError(null); setPassword(v); }}");
  });
});
