/**
 * Sign-up as the owner finally asked (2026-10-26, via the lead):
 *   Screen 1: First name + Last name side by side (required), then email,
 *             password and the Terms box, all required.
 *   Screen 2: photo, city, ZIP, bio and referral code, all OPTIONAL, with
 *             "Skip for now".
 *   Apple/Google: Complete Profile asks first + last only when the provider
 *             gave no full name.
 * This replaces zipRequiredAtSignup.test.ts (owner 2026-09-05: ZIP required),
 * which the 2026-10-26 ask overrules. A typed ZIP must still be five digits:
 * a half one resolves no parish.
 *
 * Three layers, each read or driven here: the two screens (rendered), the
 * account write ("Skip" sends none of screen 2's fields), and the gate
 * (isProfileComplete, called for real): a skipped city must not send an email
 * sign-up to /complete-profile, or "Skip for now" is a redirect loop.
 *
 * @mutate src/pages/auth/signup/SignupStep1.tsx |     if (!firstName.trim()) {\n      firstNameRef.current?.focus();\n      return;\n    } |
 * @mutate src/pages/auth/Signup.tsx |     if (!firstName.trim()) { toast.error("Add your first name."); return false; } |
 * @mutate src/pages/auth/Signup.tsx |       if (zip && zip.length !== 5) errors.zipCode = "Enter a 5-digit ZIP code"; |       if (!zip) errors.zipCode = "Add your ZIP code";
 * @mutate src/pages/auth/Signup.tsx |         location: skipped ? "" : location, |         location,
 * @mutate src/pages/auth/Signup.tsx |             onSkip={() => finishStep2(true)} |             onSkip={() => finishStep2(false)}
 * @mutate src/pages/auth/Signup.tsx |         referralCode: (skipped ? linkReferralCode : referralCode.trim().toUpperCase()) \|\| null, |         referralCode: referralCode.trim().toUpperCase() \|\| null,
 * @mutate src/components/ProtectedRoute.tsx |   if (!signupFinished(profile)) return false; |
 * @mutate src/pages/auth/signup/SignupStep2.tsx |         onClick={onSkip} |         onClick={onContinue}
 * @mutate src/components/ProtectedRoute.tsx |   { key: "full_name", label: "Full name" }, |   { key: "full_name", label: "Full name" }, { key: "location", label: "City" },
 * @mutate src/pages/auth/CompleteProfile.tsx |             {!providerGaveName && ( |             {true && (
 * @mutate src/pages/auth/CompleteProfile.tsx |     { const zip = zipCode.replace(/\D/g, ""); if (zip && zip.length !== 5) return fail( |     { const zip = zipCode.replace(/\D/g, ""); if (zip.length !== 5) return fail(
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { useState } from "react";
import { blankComments } from "./helpers/blankNonCode";
import { SignupStep1 } from "@/pages/auth/signup/SignupStep1";
import { SignupStep2 } from "@/pages/auth/signup/SignupStep2";
import { isProfileComplete } from "@/components/ProtectedRoute";

afterEach(cleanup);

const read = (p: string) => blankComments(readFileSync(p, "utf8"));
const SIGNUP = read("src/pages/auth/Signup.tsx");
const STEP1 = read("src/pages/auth/signup/SignupStep1.tsx");
const STEP2 = read("src/pages/auth/signup/SignupStep2.tsx");
const COMPLETE = read("src/pages/auth/CompleteProfile.tsx");

function Step1({ onContinue }: { onContinue: () => void }) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("ann@example.com");
  const [password, setPassword] = useState("Abcdefghij1!x");
  const [show, setShow] = useState(false);
  const [mk, setMk] = useState(false);
  return (
    <MemoryRouter>
      <SignupStep1
        firstName={first} setFirstName={setFirst} lastName={last} setLastName={setLast}
        email={email} setEmail={setEmail} password={password} setPassword={setPassword}
        showPassword={show} setShowPassword={setShow}
        acceptedPolicies setAcceptedPolicies={() => {}} ageConfirmed setAgeConfirmed={() => {}}
        marketingConsent={mk} setMarketingConsent={setMk}
        inputCls="" labelCls="" onContinue={onContinue}
      />
    </MemoryRouter>
  );
}

describe("screen 1: first and last name, side by side, required", () => {
  it("Continue with no names stops and names both", () => {
    const onContinue = vi.fn();
    render(<Step1 onContinue={onContinue} />);
    const first = screen.getByLabelText("First name");
    const last = screen.getByLabelText("Last name");
    // Side by side: one two-column row holds both.
    expect(first.closest(".grid-cols-2")).toBe(last.closest(".grid-cols-2"));
    expect(first.closest(".grid-cols-2")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText("Add your first name")).toBeTruthy();
    expect(screen.getByText("Add your last name")).toBeTruthy();
    // Each name stops Continue on its own.
    fireEvent.change(last, { target: { value: "Lee" } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(onContinue).not.toHaveBeenCalled();
    fireEvent.change(last, { target: { value: "" } });
    fireEvent.change(first, { target: { value: "Ann" } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(onContinue).not.toHaveBeenCalled();
    fireEvent.change(last, { target: { value: "Lee" } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("the names come before the email, and the parent refuses a step without them too", () => {
    expect(STEP1.indexOf('htmlFor="firstName"')).toBeGreaterThan(0);
    expect(STEP1.indexOf('htmlFor="firstName"')).toBeLessThan(STEP1.indexOf('htmlFor="email"'));
    expect(SIGNUP).toContain('if (!firstName.trim()) { toast.error("Add your first name."); return false; }');
    expect(SIGNUP).toContain('if (!lastName.trim()) { toast.error("Add your last name."); return false; }');
  });
});

describe("screen 2: photo, city, ZIP, bio and referral code, all optional, with Skip for now", () => {
  it("asks no name, marks City and ZIP optional, and Skip calls its own handler", () => {
    expect(STEP2).not.toMatch(/id="firstName"|id="lastName"/);
    const onSkip = vi.fn();
    const onContinue = vi.fn();
    render(
      <SignupStep2
        avatarPreview={null} onAvatarChange={() => {}}
        location="" setLocation={() => {}} zipCode="" setZipCode={() => {}}
        bio="" setBio={() => {}} referralCode="" setReferralCode={() => {}}
        inputCls="" labelCls="" onContinue={onContinue} onSkip={onSkip}
      />,
    );
    expect(screen.getByText(/^City/).textContent).toBe("City (optional)");
    expect(screen.getByText(/^ZIP/).textContent).toBe("ZIP (optional)");
    fireEvent.click(screen.getByTestId("signup-skip"));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByTestId("signup-skip").textContent).toBe("Skip for now");
  });

  it("requires nothing on screen 2, but a typed ZIP is five digits", () => {
    expect(SIGNUP).not.toMatch(/errors\.location\s*=/);
    expect(SIGNUP).not.toMatch(/errors\.firstName\s*=|errors\.lastName\s*=/);
    expect(SIGNUP).not.toMatch(/errors\.zipCode\s*=\s*"Add your ZIP code"/);
    expect(SIGNUP).toContain('if (zip && zip.length !== 5) errors.zipCode = "Enter a 5-digit ZIP code";');
  });

  it("Skip creates the account with none of screen 2's fields (only a ?ref= link's code still counts)", () => {
    expect(SIGNUP).toContain("onSkip={() => finishStep2(true)}");
    expect(SIGNUP).toContain("onContinue={() => finishStep2(false)}");
    expect(SIGNUP).toMatch(/if \(!skip && !\(await validateAboutYouStep\(\)\)\) return;[^]*?await createAccountAndFinish\(skip\);/);
    expect(SIGNUP).toContain("completeProfile(userId, gaveUp.signal, skipped)");
    expect(SIGNUP).toContain('bio: skipped ? "" : bio,');
    expect(SIGNUP).toContain('location: skipped ? "" : location,');
    expect(SIGNUP).toContain('zipCode: skipped ? "" : zipCode.trim(),');
    expect(SIGNUP).toContain("const parish = skipped ? null : resolvedZipParish;");
    expect(SIGNUP).toContain("if (avatarFile && !skipped) {");
    expect(SIGNUP).toContain("referralCode: (skipped ? linkReferralCode : referralCode.trim().toUpperCase()) || null,");
    expect(SIGNUP).toContain('const linkReferralCode = (searchParams.get("ref") || "").trim().toUpperCase();');
  });
});

describe("the gate lets a skipped city through", () => {
  const email = { app_metadata: { provider: "email" } };
  const google = { app_metadata: { provider: "google" } };
  const base = { full_name: "Ann Lee", location: "", is_legacy_user: false } as Parameters<typeof isProfileComplete>[0];

  it("an email sign-up with a name, no city and a finished sign-up is complete", () => {
    // accepted_terms_at: written only by complete-signup and Complete Profile.
    expect(isProfileComplete({ ...base!, accepted_terms_at: "2026-10-27T00:00:00Z" } as Parameters<typeof isProfileComplete>[0], email)).toBe(true);
    // A city also marks a finished sign-up (the accounts from before 2026-09-01).
    expect(isProfileComplete({ ...base!, location: "Lafayette, LA" }, email)).toBe(true);
  });

  it("a sign-up whose completion never ran (name from signUp, no city, no consent) still goes to Complete Profile", () => {
    expect(isProfileComplete(base, email)).toBe(false);
  });

  it("a name is still required, and Google/Apple still need the 18+ box", () => {
    expect(isProfileComplete({ ...base!, full_name: " " }, email)).toBe(false);
    expect(isProfileComplete(base, google)).toBe(false);
    expect(isProfileComplete({ ...base!, accepted_terms_at: "2026-10-27T00:00:00Z", age_attested_at: "2026-10-27T00:00:00Z" } as Parameters<typeof isProfileComplete>[0], google)).toBe(true);
  });
});

describe("Complete Profile (Apple/Google)", () => {
  it("asks first and last only when the provider gave no full name", () => {
    expect(COMPLETE).toContain("if (parsedFirst && parsedLast) setProviderGaveName(true);");
    expect(COMPLETE).toMatch(/\{!providerGaveName && \(\s*<div className="grid grid-cols-2 gap-3" data-testid="complete-profile-names">/);
  });

  it("City and ZIP are optional there too; a typed ZIP is five digits; empty never overwrites", () => {
    expect(COMPLETE).not.toMatch(/label: "City"|label: "ZIP code"/);
    expect(COMPLETE).not.toContain('return fail("Tell us your city to continue.")');
    expect(COMPLETE).toContain('{ const zip = zipCode.replace(/\\D/g, ""); if (zip && zip.length !== 5) return fail(');
    expect(COMPLETE).toContain("...(location.trim() ? { location: location.trim() } : {}),");
    expect(COMPLETE).toContain("...(zipCode.trim() ? { zip_code: zipCode.trim() } : {}),");
  });
});
