/**
 * A likely email typo stops sign-up until it is answered (lead, 2026-10-25).
 *
 * Measured on prod 2026-10-25 (auth.users, sign-ups since 2026-09-01): one
 * account each at gmai.com and icloud.con, both never confirmed. The old check
 * already suggested the fix, but as one small line under a GREEN check mark,
 * and Continue went on regardless, so a mistyped address made an account whose
 * confirmation email could never arrive.
 *
 * Now: Continue with a pending suggestion focuses the email and goes no
 * further; the hint offers "Use gmail.com" and "Keep gmai.com"; no green check
 * shows over a likely typo; and real domains a near-miss rule would "fix"
 * (ymail.com is one edit from gmail.com, me.com two from msn.com) are never
 * suggested.
 *
 * @mutate src/pages/auth/signup/SignupStep1.tsx |     if (emailSuggestion) {\n      emailRef.current?.focus();\n      return;\n    } |
 * @mutate src/pages/auth/signup/signupHelpers.ts |   return keptEmail !== null && keptEmail.trim().toLowerCase() === email.trim().toLowerCase() ? null : suggestion; |   return suggestion;
 * @mutate src/pages/auth/signup/signupHelpers.ts | \|\| KNOWN_EMAIL_DOMAINS.includes(domain)) return null; | ) return null;
 * @mutate src/pages/auth/signup/SignupStep1.tsx |             {emailValid && !emailSuggestion && ( |             {emailValid && (
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import { pendingEmailTypo, suggestEmailCorrection, KNOWN_EMAIL_DOMAINS } from "@/pages/auth/signup/signupHelpers";
import { SignupStep1 } from "@/pages/auth/signup/SignupStep1";

afterEach(cleanup);

describe("the typo check (pure)", () => {
  it("suggests the provider for the two measured typos", () => {
    expect(suggestEmailCorrection("ann@gmai.com")).toBe("ann@gmail.com");
    expect(suggestEmailCorrection("ann@icloud.con")).toBe("ann@icloud.com");
  });

  it("never 'corrects' a real domain one or two edits from a provider", () => {
    expect(KNOWN_EMAIL_DOMAINS.length).toBeGreaterThan(5);
    for (const d of KNOWN_EMAIL_DOMAINS) expect(suggestEmailCorrection(`ann@${d}`), d).toBeNull();
  });

  it("asks until the member takes it or keeps THIS address", () => {
    expect(pendingEmailTypo("ann@gmai.com", null)).toBe("ann@gmail.com");
    expect(pendingEmailTypo("ann@gmai.com", "ann@gmai.com")).toBeNull();
    expect(pendingEmailTypo("Ann@Gmai.com ", "ann@gmai.com")).toBeNull();
    // Keeping one address never waves through a different one.
    expect(pendingEmailTypo("bob@gmai.com", "ann@gmai.com")).toBe("bob@gmail.com");
    expect(pendingEmailTypo("ann@gmail.com", null)).toBeNull();
  });
});

function Harness({ onContinue, initial }: { onContinue: () => void; initial: string }) {
  const [email, setEmail] = useState(initial);
  const [password, setPassword] = useState("Abcdefghij1!x");
  const [show, setShow] = useState(false);
  const [policies, setPolicies] = useState(true);
  const [age, setAge] = useState(true);
  const [mk, setMk] = useState(false);
  return (
    <MemoryRouter>
      <SignupStep1
        email={email} setEmail={setEmail} password={password} setPassword={setPassword}
        showPassword={show} setShowPassword={setShow}
        acceptedPolicies={policies} setAcceptedPolicies={setPolicies}
        ageConfirmed={age} setAgeConfirmed={setAge}
        marketingConsent={mk} setMarketingConsent={setMk}
        inputCls="" labelCls="" onContinue={onContinue}
      />
    </MemoryRouter>
  );
}

const continueButton = () => screen.getByRole("button", { name: /^continue$/i });

describe("sign-up step 1 with a likely typo", () => {
  it("Continue stops, and the hint offers both answers", () => {
    const onContinue = vi.fn();
    render(<Harness onContinue={onContinue} initial="ann@gmai.com" />);
    fireEvent.click(continueButton());
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByTestId("signup-email-typo").textContent).toContain("ann@gmail.com");
    expect(screen.getByRole("button", { name: "Use gmail.com" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep gmai.com" })).toBeTruthy();
  });

  it("Use fixes the address and Continue goes on", () => {
    const onContinue = vi.fn();
    render(<Harness onContinue={onContinue} initial="ann@gmai.com" />);
    fireEvent.click(screen.getByRole("button", { name: "Use gmail.com" }));
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("ann@gmail.com");
    fireEvent.click(continueButton());
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("Keep accepts the address as typed and Continue goes on", () => {
    const onContinue = vi.fn();
    render(<Harness onContinue={onContinue} initial="ann@gmai.com" />);
    fireEvent.click(screen.getByRole("button", { name: "Keep gmai.com" }));
    expect(screen.queryByTestId("signup-email-typo")).toBeNull();
    fireEvent.click(continueButton());
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("a clean address goes straight on", () => {
    const onContinue = vi.fn();
    render(<Harness onContinue={onContinue} initial="ann@gmail.com" />);
    expect(screen.queryByTestId("signup-email-typo")).toBeNull();
    fireEvent.click(continueButton());
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
